import {
  ConnectionConfig,
  ConnectionStats,
  HPKVOperation,
  HPKVRequestMessage,
  HPKVResponse,
  HPKVGetResponse,
  HPKVSetResponse,
  HPKVPatchResponse,
  HPKVDeleteResponse,
  HPKVRangeResponse,
  HPKVAtomicResponse,
  RangeQueryOptions,
  ThrottlingConfig,
  ThrottlingMetrics,
  HPKVErrorResponse,
} from './types';
import { ConnectionError, TimeoutError } from './errors';
import SimpleEventEmitter from '../utilities/event-emitter';
import { IWebSocket, RetryConfig, WS_CONSTANTS, ConnectionState } from './types';
import { createWebSocket } from './websocket-adapter';
import { MessageHandler } from './message-handler';
import { ThrottlingManager } from './throttling-manager';

const CLEANUP_CONFIRMATION_TIMEOUT_MS = 200;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;

/**
 * Base WebSocket client that handles connection management and message passing
 * for the HPKV WebSocket API.
 */
export abstract class BaseWebSocketClient {
  protected ws: IWebSocket | null = null;
  protected baseUrl: string;
  protected connectionPromise: Promise<void> | null = null;
  protected connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  protected reconnectAttempts = 0;
  protected connectionTimeout: NodeJS.Timeout | number | null = null;
  protected emitter = new SimpleEventEmitter();
  protected messageHandler: MessageHandler;
  protected throttlingManager: ThrottlingManager;
  protected retry: RetryConfig;
  protected isGracefulDisconnect = false;
  protected connectionTimeoutDuration: number;

  /**
   * Creates a new BaseWebSocketClient instance
   * @param baseUrl - The base URL of the HPKV API
   * @param config - The connection configuration including timeouts and retry options
   */
  constructor(baseUrl: string, config?: ConnectionConfig) {
    let processedBaseUrl = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    if (!processedBaseUrl.endsWith('/ws')) {
      processedBaseUrl += '/ws';
    }
    this.baseUrl = processedBaseUrl;
    this.retry = {
      maxReconnectAttempts: config?.maxReconnectAttempts || 3,
      initialDelayBetweenReconnects: config?.initialDelayBetweenReconnects || 1000,
      maxDelayBetweenReconnects: config?.maxDelayBetweenReconnects || 30000,
      jitterMs: 500,
    };
    this.connectionTimeoutDuration = config?.connectionTimeout || DEFAULT_CONNECTION_TIMEOUT_MS;
    this.messageHandler = new MessageHandler();
    this.throttlingManager = new ThrottlingManager(config?.throttling);
    this.messageHandler.onRateLimitExceeded = (_error: HPKVErrorResponse) => {
      this.throttlingManager.notify429();
    };
  }

  // Public API Methods
  /**
   * Retrieves a value from the key-value store
   * @param key - The key to retrieve
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async get(key: string, timeoutMs?: number): Promise<HPKVGetResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.GET,
        key,
      },
      timeoutMs
    ) as Promise<HPKVGetResponse>;
  }

  /**
   * Stores a value in the key-value store
   * @param key - The key to store the value under
   * @param value - The value to store (will be stringified if not a string)
   * @param partialUpdate - If true, performs a partial update/patch instead of replacing the entire value
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the operation fails or connection is lost
   */
  async set(
    key: string,
    value: unknown,
    partialUpdate = false,
    timeoutMs?: number
  ): Promise<HPKVSetResponse | HPKVPatchResponse> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const operation = partialUpdate ? HPKVOperation.PATCH : HPKVOperation.SET;

    return this.sendMessage(
      {
        op: operation,
        key,
        value: stringValue,
      },
      timeoutMs
    ) as Promise<HPKVSetResponse | HPKVPatchResponse>;
  }

  /**
   * Deletes a value from the key-value store
   * @param key - The key to delete
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async delete(key: string, timeoutMs?: number): Promise<HPKVDeleteResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.DELETE,
        key,
      },
      timeoutMs
    ) as Promise<HPKVDeleteResponse>;
  }

  /**
   * Performs a range query to retrieve multiple keys within a specified range
   * @param key - The start key of the range
   * @param endKey - The end key of the range
   * @param options - Additional options for the range query including result limit
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response containing matching records
   * @throws Error if the operation fails or connection is lost
   */
  async range(
    key: string,
    endKey: string,
    options?: RangeQueryOptions,
    timeoutMs?: number
  ): Promise<HPKVRangeResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.RANGE,
        key,
        endKey,
        limit: options?.limit,
      },
      timeoutMs
    ) as Promise<HPKVRangeResponse>;
  }

  /**
   * Performs an atomic increment operation on a numeric value
   * @param key - The key of the value to increment
   * @param value - The amount to increment by
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the key does not contain a numeric value or connection fails
   */
  async atomicIncrement(
    key: string,
    value: number,
    timeoutMs?: number
  ): Promise<HPKVAtomicResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.ATOMIC,
        key,
        value,
      },
      timeoutMs
    ) as Promise<HPKVAtomicResponse>;
  }

  // Connection Lifecycle Methods
  /**
   * Establishes a WebSocket connection to the HPKV API
   * @returns A promise that resolves when the connection is established
   * @throws ConnectionError if the connection fails or times out
   */
  async connect(): Promise<void> {
    this.isGracefulDisconnect = false;
    this.syncConnectionState();

    if (this.connectionState === ConnectionState.CONNECTED && this.isWebSocketOpen()) {
      return;
    }

    if (
      (this.connectionState === ConnectionState.CONNECTING ||
        this.connectionState === ConnectionState.RECONNECTING) &&
      this.connectionPromise
    ) {
      return this.connectionPromise;
    }

    this.connectionState = ConnectionState.CONNECTING;

    this.connectionPromise = new Promise<void>((resolve, reject) =>
      this._initiateConnectionAttempt(resolve, reject)
    );

    return this.connectionPromise;
  }

  private _initiateConnectionAttempt(
    resolve: () => void,
    reject: (reason?: TimeoutError | ConnectionError) => void
  ): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout as NodeJS.Timeout | number);
      this.connectionTimeout = null;
    }

    this.connectionTimeout = setTimeout(() => {
      if (this.connectionState !== ConnectionState.CONNECTED) {
        if (this.ws) {
          const currentWs = this.ws;
          currentWs.removeListener('open', onOpen);
          currentWs.removeListener('error', onErrorDuringConnect);
          currentWs.removeListener('close', onCloseDuringConnect);
          // Only nullify if it's the instance from this attempt and not yet closed/reassigned
          if (this.ws === currentWs) {
            currentWs.removeAllListeners();
            this.ws = null;
          }
        }
        this.connectionState = ConnectionState.DISCONNECTED;
        const timeoutError = new TimeoutError(
          `Connection timeout after ${this.connectionTimeoutDuration}ms (client-side)`
        );
        this.emitter.emit('error', timeoutError);
        reject(timeoutError);
      }
    }, this.connectionTimeoutDuration);

    let wsInstance: IWebSocket;
    try {
      const urlToConnect = this.buildConnectionUrl();
      wsInstance = createWebSocket(urlToConnect);
      this.ws = wsInstance;
    } catch (error) {
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout as NodeJS.Timeout | number);
        this.connectionTimeout = null;
      }
      this.connectionState = ConnectionState.DISCONNECTED;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error creating WebSocket';
      const connError = new ConnectionError(errorMessage);
      this.emitter.emit('error', connError);
      reject(connError);
      return;
    }

    const removeConnectAttemptListeners = (): void => {
      if (wsInstance) {
        wsInstance.removeListener('open', onOpen);
        wsInstance.removeListener('error', onErrorDuringConnect);
        wsInstance.removeListener('close', onCloseDuringConnect);
      }
    };

    const onOpen = (): void => {
      removeConnectAttemptListeners();
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout as NodeJS.Timeout | number);
        this.connectionTimeout = null;
      }
      this.connectionState = ConnectionState.CONNECTED;
      this.emitter.emit('connected');
      this.reconnectAttempts = 0;
      if (this.ws === wsInstance) {
        // Setting up persistent listeners on the correct instance
        this.ws.on('message', (data: HPKVResponse) => this.handleMessage(data));
        this.ws.on('error', (err: Error) => this.handleWebSocketError(err));
        this.ws.on('close', (code?: number, reason?: string) =>
          this.handleWebSocketClose(code, reason)
        );
      }

      resolve();
    };

    const onErrorDuringConnect = (error: Error): void => {
      if (this.connectionState !== ConnectionState.CONNECTING) {
        removeConnectAttemptListeners();
        return;
      }

      removeConnectAttemptListeners();

      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout as NodeJS.Timeout | number);
        this.connectionTimeout = null;
      }

      this.connectionState = ConnectionState.DISCONNECTED;
      if (this.ws === wsInstance) {
        this.ws = null;
      }

      const connError = new ConnectionError(
        `WebSocket connection error during connect: ${error.message || 'Unknown WebSocket Error'}`
      );

      this.emitter.emit('error', connError);

      reject(connError);
    };

    const onCloseDuringConnect = (code?: number, reason?: string): void => {
      if (this.connectionState !== ConnectionState.CONNECTING) {
        removeConnectAttemptListeners();
        return;
      }
      removeConnectAttemptListeners();
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout as NodeJS.Timeout | number);
        this.connectionTimeout = null;
      }
      this.connectionState = ConnectionState.DISCONNECTED;
      if (this.ws === wsInstance) {
        // If this.ws still refers to the instance that closed
        this.ws = null;
      }
      const connError = new ConnectionError(
        `WebSocket closed before opening (code: ${code ?? 'N/A'}, reason: ${reason ?? 'N/A'})`
      );
      this.emitter.emit('error', connError);
      reject(connError);
    };

    wsInstance.on('open', onOpen);
    wsInstance.on('error', onErrorDuringConnect);
    wsInstance.on('close', onCloseDuringConnect);
  }

  /**
   * Gracefully closes the WebSocket connection
   * @param cancelPendingRequests - Whether to cancel all pending requests (default: true)
   * @returns A promise that resolves when the connection is closed and cleaned up
   */
  async disconnect(cancelPendingRequests = true): Promise<void> {
    this.isGracefulDisconnect = true;
    this.reconnectAttempts = 0; // Prevent reconnections during/after graceful disconnect

    this.syncConnectionState();

    if (this.connectionState === ConnectionState.DISCONNECTED && !this.ws) {
      this.isGracefulDisconnect = false;
      return Promise.resolve();
    }

    this.connectionState = ConnectionState.DISCONNECTING;

    if (cancelPendingRequests) {
      this.messageHandler.cancelAllRequests(new ConnectionError('Connection closed by client'));
    }

    return this.cleanup(1000, 'Normal closure by client').finally(() => {
      this.connectionState = ConnectionState.DISCONNECTED;
      this.connectionPromise = null;
      if (this.isGracefulDisconnect) {
        // Only reset if this was the one setting it.
        this.isGracefulDisconnect = false;
      }
    });
  }

  /**
   * Attempts to reconnect to the WebSocket server with exponential backoff
   * @returns A promise that resolves when the connection is reestablished
   * @throws ConnectionError if reconnection fails after max attempts
   */
  protected async reconnect(): Promise<void> {
    this.reconnectAttempts++;
    this.connectionState = ConnectionState.RECONNECTING;

    const baseDelay = Math.min(
      (this.retry.initialDelayBetweenReconnects as number) *
        Math.pow(2, this.reconnectAttempts - 1),
      this.retry.maxDelayBetweenReconnects as number
    );
    const jitter = this.retry.jitterMs ? Math.floor(Math.random() * this.retry.jitterMs) : 0;
    const delay = baseDelay + jitter;

    this.emitter.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.retry.maxReconnectAttempts,
      delay,
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
      this.emitter.emit('connected');
    } catch (error) {
      if (this.reconnectAttempts < (this.retry.maxReconnectAttempts as number)) {
        return this.reconnect();
      } else {
        this.connectionState = ConnectionState.DISCONNECTED;
        const connectionError = new ConnectionError(
          error instanceof Error
            ? `Reconnection failed after ${this.retry.maxReconnectAttempts} attempts: ${error.message}`
            : `Reconnection failed after ${this.retry.maxReconnectAttempts} attempts`
        );
        this.emitter.emit('reconnectFailed', connectionError);
        this.messageHandler.cancelAllRequests(connectionError);
        throw connectionError;
      }
    }
  }

  // Connection State & Info
  /**
   * Get the current connection state
   * @returns The current connection state
   */
  getConnectionState(): ConnectionState {
    this.syncConnectionState();
    return this.connectionState;
  }

  /**
   * Get current connection statistics
   * @returns Statistics about the current connection
   */
  getConnectionStats(): ConnectionStats {
    this.syncConnectionState();

    const throttlingMetrics = this.throttlingManager.getMetrics();

    return {
      isConnected: this.connectionState === ConnectionState.CONNECTED,
      reconnectAttempts: this.reconnectAttempts,
      messagesPending: this.messageHandler.pendingCount,
      connectionState: this.connectionState,
      throttling: this.throttlingManager.config.enabled
        ? {
            currentRate: throttlingMetrics.currentRate,
            queueLength: throttlingMetrics.queueLength,
          }
        : null,
    } as ConnectionStats;
  }

  /**
   * Checks if the WebSocket connection is currently established and open
   * @returns True if the connection is established and ready
   */
  private isWebSocketOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_CONSTANTS.OPEN;
  }

  /**
   * Updates the connection state based on WebSocket readyState
   * to ensure consistency between the two state tracking mechanisms
   */
  private syncConnectionState(): void {
    if (!this.ws) {
      this.connectionState = ConnectionState.DISCONNECTED;
      return;
    }

    switch (this.ws.readyState) {
      case WS_CONSTANTS.CONNECTING:
        this.connectionState = ConnectionState.CONNECTING;
        break;
      case WS_CONSTANTS.OPEN:
        this.connectionState = ConnectionState.CONNECTED;
        break;
      case WS_CONSTANTS.CLOSING:
        this.connectionState = ConnectionState.DISCONNECTING;
        break;
      case WS_CONSTANTS.CLOSED:
        this.connectionState = ConnectionState.DISCONNECTED;
        break;
    }
  }

  // Event Emitter Methods
  /**
   * Register event listeners
   * @param event - The event to listen for
   * @param listener - The callback function to execute when the event is emitted
   */
  on(
    event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnectFailed' | 'error',
    listener: (...args: any[]) => void
  ): void {
    this.emitter.on(event, listener);
  }

  /**
   * Remove event listeners
   * @param event - The event to stop listening for
   * @param listener - The callback function to remove
   */
  off(
    event: 'connected' | 'disconnected' | 'reconnecting' | 'reconnectFailed' | 'error',
    listener: (...args: any[]) => void
  ): void {
    this.emitter.off(event, listener);
  }

  // Throttling Management
  /**
   * Gets current throttling settings and metrics
   * @returns Current throttling configuration and metrics
   */
  getThrottlingStatus(): {
    enabled: boolean;
    config: ThrottlingConfig;
    metrics: ThrottlingMetrics;
  } {
    return {
      enabled: this.throttlingManager.config.enabled,
      config: this.throttlingManager.config,
      metrics: this.throttlingManager.getMetrics(),
    };
  }

  /**
   * Updates throttling configuration
   * @param config - New throttling configuration parameters
   */
  updateThrottlingConfig(config: Partial<ThrottlingConfig>): void {
    this.throttlingManager.updateConfig(config);
  }

  // Protected Core Logic
  /**
   * Sends a message to the WebSocket server and handles the response
   * @param message - The message to send
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the server response
   * @throws Error if the message times out or connection fails
   */
  protected async sendMessage(
    message: Omit<HPKVRequestMessage, 'messageId'>,
    timeoutMs?: number
  ): Promise<HPKVResponse> {
    await this.throttlingManager.throttleRequest();
    this.syncConnectionState();
    const messageWithId = this.messageHandler.createMessage(message);
    const { promise, cancel } = this.messageHandler.registerRequest(
      messageWithId.messageId as number,
      message.op.toString(),
      timeoutMs || undefined
    );

    try {
      if (this.ws && this.isWebSocketOpen()) {
        this.ws.send(JSON.stringify(messageWithId));
      } else {
        cancel('WebSocket is not open');
      }
    } catch (error) {
      cancel(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return promise;
  }

  /**
   * Processes WebSocket messages and resolves corresponding promises
   * @param message - The message received from the WebSocket server
   * @returns True if the message was handled, false if no matching request was found
   */
  protected handleMessage(message: HPKVResponse): void {
    this.messageHandler.handleMessage(message);
  }

  // Protected WebSocket Event Handlers
  /**
   * Persistent handler for WebSocket 'error' events.
   */
  protected handleWebSocketError(error: Error): void {
    // An error event on the WebSocket usually precedes a 'close' event.
    // Log the error and emit an event. The 'close' event will handle state changes and reconnections.
    const connectionError = new ConnectionError(
      error.message || 'Unknown WebSocket error occurred'
    );
    this.emitter.emit('error', connectionError);
  }

  /**
   * Persistent handler for WebSocket 'close' events.
   */
  protected handleWebSocketClose(code?: number, reason?: string): void {
    const wasConnected = this.connectionState === ConnectionState.CONNECTED;
    const previousState = this.connectionState;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    this.connectionState = ConnectionState.DISCONNECTED;
    this.connectionPromise = null;

    this.emitter.emit('disconnected', {
      code,
      reason,
      previousState,
      gracefully: this.isGracefulDisconnect,
    });

    if (!this.isGracefulDisconnect) {
      this.messageHandler.cancelAllRequests(
        new ConnectionError(
          `Connection closed unexpectedly (code: ${code ?? 'N/A'}, reason: ${reason ?? 'N/A'})`
        )
      );

      if (code !== 1000 || (code === 1000 && wasConnected)) {
        this.initiateReconnectionCycle();
      }
    } else {
      this.isGracefulDisconnect = false;
    }
  }

  // Protected Helper Methods
  /**
   * Builds the WebSocket connection URL with authentication
   * @returns The WebSocket connection URL
   */
  protected abstract buildConnectionUrl(): string;

  /**
   * Cleans up resources and closes the WebSocket connection.
   */
  protected async cleanup(code?: number, reason?: string): Promise<void> {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout as NodeJS.Timeout);
      this.connectionTimeout = null;
    }

    if (!this.ws) {
      this.connectionState = ConnectionState.DISCONNECTED;
      this.connectionPromise = null;
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      const wsInstanceToCleanup = this.ws!;
      let timeoutId: NodeJS.Timeout | null = null;
      let finalized = false;

      const finalizeCleanup = (): void => {
        if (finalized) return;
        finalized = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        wsInstanceToCleanup.removeListener('close', onCloseHandlerForCleanup);

        if (this.ws === wsInstanceToCleanup) {
          if (wsInstanceToCleanup.readyState !== WS_CONSTANTS.CLOSED) {
            wsInstanceToCleanup.removeAllListeners();
          }
          this.ws = null;
        }

        this.connectionState = ConnectionState.DISCONNECTED;
        this.connectionPromise = null;
        resolve();
      };

      const onCloseHandlerForCleanup = (): void => {
        finalizeCleanup();
      };

      if (wsInstanceToCleanup.readyState === WS_CONSTANTS.CLOSED) {
        finalizeCleanup();
        return;
      }

      wsInstanceToCleanup.on('close', onCloseHandlerForCleanup);

      if (
        wsInstanceToCleanup.readyState === WS_CONSTANTS.OPEN ||
        wsInstanceToCleanup.readyState === WS_CONSTANTS.CONNECTING
      ) {
        wsInstanceToCleanup.close(code, reason);
      }

      // Fallback timeout for this cleanup operation.
      timeoutId = setTimeout(() => {
        finalizeCleanup();
      }, CLEANUP_CONFIRMATION_TIMEOUT_MS);
    });
  }

  /**
   * Handles unexpected disconnect events and decides whether to initiate reconnection.
   * This method is called by handleWebSocketClose.
   */
  protected initiateReconnectionCycle(): void {
    if (this.isGracefulDisconnect) {
      if (this.connectionState !== ConnectionState.DISCONNECTED) {
        this.connectionState = ConnectionState.DISCONNECTED;
      }
      return;
    }

    if (
      this.connectionState === ConnectionState.RECONNECTING ||
      this.connectionState === ConnectionState.CONNECTING
    ) {
      return;
    }

    this.connectionState = ConnectionState.RECONNECTING;
    this.reconnectAttempts = 0;

    this.reconnect().catch(_finalError => {
      if (this.connectionState !== ConnectionState.DISCONNECTED) {
        this.connectionState = ConnectionState.DISCONNECTED;
      }
    });
  }

  /**
   * Clean up resources when instance is no longer needed
   */
  destroy(): void {
    this.messageHandler.cancelAllRequests(new ConnectionError('Client destroyed'));
    this.messageHandler.destroy();
    this.throttlingManager.destroy();
  }
}

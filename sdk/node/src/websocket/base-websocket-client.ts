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
} from './types';
import { ConnectionError, TimeoutError } from './errors';
import SimpleEventEmitter from '../utilities/event-emitter';
import { IWebSocket, RetryConfig, WS_CONSTANTS, ConnectionState } from './types';
import { createWebSocket } from './websocket-adapter';
import { DEFAULT_TIMEOUTS, MessageHandler } from './message-handler';
import { ThrottlingManager } from './throttling-manager';

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

  // Event emitter for client events
  protected emitter = new SimpleEventEmitter();

  // Managers for different aspects of functionality
  protected messageHandler: MessageHandler;
  protected throttlingManager: ThrottlingManager;

  // Retry configuration
  protected retry: RetryConfig;

  /**
   * Creates a new BaseWebSocketClient instance
   * @param baseUrl - The base URL of the HPKV API
   * @param config - The connection configuration including timeouts and retry options
   */
  constructor(baseUrl: string, config?: ConnectionConfig) {
    this.baseUrl = baseUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');

    // Initialize retry configuration
    this.retry = {
      maxAttempts: config?.maxReconnectAttempts || 3,
      initialDelayMs: config?.initialDelayBetweenReconnects || 1000,
      maxDelayMs: config?.maxDelayBetweenReconnects || 30000,
      jitterMs: 500, // Add some randomness to prevent thundering herd
    };

    // Initialize message handler
    this.messageHandler = new MessageHandler();

    // Initialize throttling manager with the event emitter
    this.throttlingManager = new ThrottlingManager(config?.throttling);
    this.messageHandler.onRequestLimitExceeded(() => {
      this.throttlingManager.notify429();
    });

    this.initPing();
  }

  /**
   * Initialize the ping functionality
   */
  private initPing(): void {
    this.throttlingManager.initPingInterval(async () => {
      const response = await this.ping();
      return response;
    });
  }

  /**
   * Pings the server to measure round-trip time
   */
  private async ping(): Promise<{ status: number; rtt: number }> {
    const baseUrl = this.baseUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://')
      .replace(/\/ws$/, '');
    const pingUrl = `${baseUrl}/ping`;
    const start = Date.now();
    return fetch(pingUrl).then(response => {
      const rtt = Date.now() - start;
      return {
        status: response.status,
        rtt,
      };
    });
  }

  /**
   * Builds the WebSocket connection URL with authentication
   * @returns The WebSocket connection URL
   */
  protected abstract buildConnectionUrl(): string;

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

  /**
   * Retrieves a value from the key-value store
   * @param key - The key to retrieve
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async get(key: string, timeoutMs?: number): Promise<HPKVGetResponse> {
    // Wait for throttling if enabled
    if (this.throttlingManager.config.enabled) {
      await this.throttlingManager.throttleRequest();
    }

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
    await this.throttlingManager.throttleRequest();

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
    await this.throttlingManager.throttleRequest();

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
    await this.throttlingManager.throttleRequest();

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
    await this.throttlingManager.throttleRequest();

    return this.sendMessage(
      {
        op: HPKVOperation.ATOMIC,
        key,
        value,
      },
      timeoutMs
    ) as Promise<HPKVAtomicResponse>;
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

  /**
   * Establishes a WebSocket connection to the HPKV API
   * @returns A promise that resolves when the connection is established
   * @throws ConnectionError if the connection fails or times out
   */
  async connect(): Promise<void> {
    // Sync connection state first
    this.syncConnectionState();

    // If already connected, resolve immediately
    if (this.connectionState === ConnectionState.CONNECTED && this.isWebSocketOpen()) {
      return;
    }

    // If connection is in progress, return the existing promise
    if (this.connectionState === ConnectionState.CONNECTING && this.connectionPromise) {
      return this.connectionPromise;
    }

    // Start a new connection
    this.connectionState = ConnectionState.CONNECTING;
    this.connectionPromise = new Promise<void>((resolve, reject) => {
      try {
        // Set up connection timeout
        this.connectionTimeout = setTimeout(() => {
          if (this.connectionState !== ConnectionState.CONNECTED) {
            this.cleanup();
            reject(new TimeoutError(`Connection timeout after ${DEFAULT_TIMEOUTS.CONNECTION}ms`));
          }
        }, DEFAULT_TIMEOUTS.CONNECTION);

        const ws = createWebSocket(this.buildConnectionUrl());
        this.ws = ws;

        ws.on('open', () => {
          this.connectionState = ConnectionState.CONNECTED;
          this.emitter.emit('connected');

          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout as NodeJS.Timeout);
            this.connectionTimeout = null;
          }

          this.reconnectAttempts = 0;
          resolve();
        });

        ws.on('message', (data: HPKVResponse) => {
          try {
            this.handleMessage(data);
          } catch (error) {
            console.error('Error parsing message:', error);
          }
        });

        ws.on('close', (code: number, reason: string) => {
          const wasConnected = this.connectionState === ConnectionState.CONNECTED;
          this.connectionState = ConnectionState.DISCONNECTED;

          if (wasConnected) {
            this.emitter.emit('disconnected', { code, reason });
          }

          this.handleDisconnect(code, reason);
        });

        ws.on('error', (error: Error) => {
          if (this.connectionState === ConnectionState.CONNECTING) {
            if (this.connectionTimeout) {
              clearTimeout(this.connectionTimeout as NodeJS.Timeout);
              this.connectionTimeout = null;
            }
            this.connectionState = ConnectionState.DISCONNECTED;
            reject(new ConnectionError(error.message));
            this.emitter.emit('error', error);
          }
        });
      } catch (error) {
        this.cleanup();
        this.connectionState = ConnectionState.DISCONNECTED;
        reject(new ConnectionError(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

    return this.connectionPromise;
  }

  /**
   * Gracefully closes the WebSocket connection
   * @param cancelPendingRequests - Whether to cancel all pending requests (default: true)
   * @returns A promise that resolves when the connection is closed
   */
  async disconnect(cancelPendingRequests = true): Promise<void> {
    // Sync connection state first
    this.syncConnectionState();

    if (this.connectionState === ConnectionState.DISCONNECTED) {
      return;
    }

    this.connectionState = ConnectionState.DISCONNECTING;

    if (cancelPendingRequests) {
      this.messageHandler.cancelAllRequests(new ConnectionError('Connection closed by client'));
    }

    return new Promise<void>(resolve => {
      if (!this.ws || this.ws.readyState === WS_CONSTANTS.CLOSED) {
        this.connectionState = ConnectionState.DISCONNECTED;
        resolve();
        return;
      }

      const ws = this.ws;
      ws.removeAllListeners();

      const onClose = (): void => {
        this.connectionState = ConnectionState.DISCONNECTED;
        this.emitter.emit('disconnected');
        resolve();
      };

      ws.on('close', onClose);
      this.cleanup();
    });
  }

  /**
   * Get the current connection state
   * @returns The current connection state
   */
  getConnectionState(): ConnectionState {
    // Sync connection state before returning
    this.syncConnectionState();
    return this.connectionState;
  }

  /**
   * Get current connection statistics
   * @returns Statistics about the current connection
   */
  getConnectionStats(): ConnectionStats {
    // Sync connection state first
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
            avgRtt: throttlingMetrics.avgRtt,
            queueLength: throttlingMetrics.queueLength,
          }
        : null,
    } as ConnectionStats;
  }

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

    // If changed from disabled to enabled, initialize ping
    if (!this.throttlingManager.config.enabled && config.enabled) {
      this.initPing();
    }
  }

  /**
   * Attempts to reconnect to the WebSocket server with exponential backoff
   * @returns A promise that resolves when the connection is reestablished
   * @throws ConnectionError if reconnection fails after max attempts
   */
  protected async reconnect(): Promise<void> {
    this.syncConnectionState();

    if (
      this.connectionState === ConnectionState.DISCONNECTING ||
      this.connectionState === ConnectionState.CONNECTING
    ) {
      return;
    }

    this.reconnectAttempts++;

    // Calculate delay with exponential backoff and jitter
    const baseDelay = Math.min(
      this.retry.initialDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.retry.maxDelayMs
    );

    // Add jitter to prevent thundering herd problem
    const jitter = this.retry.jitterMs ? Math.floor(Math.random() * this.retry.jitterMs) : 0;

    const delay = baseDelay + jitter;

    this.emitter.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.retry.maxAttempts,
      delay,
    });

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
      this.emitter.emit('reconnected');
    } catch (error) {
      if (this.reconnectAttempts < this.retry.maxAttempts) {
        // Try again
        return this.reconnect();
      } else {
        // Give up after max attempts
        const connectionError = new ConnectionError(
          error instanceof Error
            ? `Connection lost after ${this.retry.maxAttempts} reconnect attempts: ${error.message}`
            : `Connection lost after ${this.retry.maxAttempts} reconnect attempts`
        );

        this.emitter.emit('reconnectFailed', connectionError);
        this.messageHandler.cancelAllRequests(connectionError);
        throw connectionError;
      }
    }
  }

  /**
   * Cleans up resources and closes the WebSocket connection
   */
  protected cleanup(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout as NodeJS.Timeout);
      this.connectionTimeout = null;
    }

    if (this.ws) {
      if (
        this.ws.readyState === WS_CONSTANTS.OPEN ||
        this.ws.readyState === WS_CONSTANTS.CONNECTING
      ) {
        this.ws.close();
      }

      this.ws = null;
    }

    // Clear connection promise
    this.connectionPromise = null;
  }

  /**
   * Clean up resources when instance is no longer needed
   */
  destroy(): void {
    this.throttlingManager.destroy();
    this.messageHandler.cancelAllRequests(new ConnectionError('Client destroyed'));
    this.cleanup();
    this.messageHandler.destroy();
    this.emitter.removeAllListeners();
  }

  /**
   * Handles disconnect events and attempts to reconnect
   * @param code - The close code from the WebSocket
   * @param reason - The close reason from the WebSocket
   */
  protected handleDisconnect(code?: number, reason?: string): void {
    if (this.connectionState === ConnectionState.DISCONNECTING) {
      this.connectionState = ConnectionState.DISCONNECTED;
      return;
    }

    if (this.reconnectAttempts < this.retry.maxAttempts) {
      this.reconnect().catch(error => {
        this.emitter.emit(
          'error',
          new ConnectionError(
            `Reconnection failed: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      });
    } else {
      // Max reconnect attempts reached
      const connectionError = new ConnectionError(
        `Connection lost after ${this.retry.maxAttempts} reconnect attempts` +
          (code ? ` (code: ${code}${reason ? `, reason: ${reason}` : ''})` : '')
      );

      this.messageHandler.cancelAllRequests(connectionError);
    }
  }

  /**
   * Processes WebSocket messages and resolves corresponding promises
   * @param message - The message received from the WebSocket server
   * @returns True if the message was handled, false if no matching request was found
   */
  protected handleMessage(message: HPKVResponse): boolean {
    // Let the message handler process this message
    return this.messageHandler.handleMessage(message);
  }

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
    // Sync connection state first
    this.syncConnectionState();

    if (this.connectionState !== ConnectionState.CONNECTED) {
      throw new ConnectionError('Client is not connected');
    }

    // Create message with ID
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
        throw new ConnectionError('WebSocket is not open');
      }
    } catch (error) {
      cancel(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new ConnectionError(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return promise;
  }
}

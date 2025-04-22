import WebSocketNode from 'ws';
import {
  HPKVResponse,
  HPKVRequestMessage,
  HPKVOperation,
  RangeQueryOptions,
  ConnectionStats,
  ConnectionConfig,
} from '../types';
import { ConnectionError, HPKVError, TimeoutError } from './errors';
import SimpleEventEmitter from '../event-emitter';

// Define a type that works for timeouts in both Node.js and browser environments
type TimeoutHandle = NodeJS.Timeout | number;

// Define a common interface for both Node.js and Browser WebSockets
interface IWebSocket {
  readyState: number;
  on(event: string, listener: (...args: any[]) => void): IWebSocket;
  removeAllListeners(): IWebSocket;
  send(data: string): void;
  close(): void;
}

/**
 * WebSocket adapter for browser environments
 * Makes the browser WebSocket API compatible with the Node.js ws package API
 */
class BrowserWebSocketAdapter implements IWebSocket {
  private socket: WebSocket;
  private eventHandlers: Record<string, ((...args: any[]) => void)[]> = {
    message: [],
    open: [],
    close: [],
    error: [],
  };

  constructor(url: string) {
    this.socket = new WebSocket(url);

    // Set up event listeners for the native WebSocket
    this.socket.addEventListener('message', event => {
      this.eventHandlers.message.forEach(handler => handler(event.data));
    });

    this.socket.addEventListener('open', _event => {
      this.eventHandlers.open.forEach(handler => handler());
    });

    this.socket.addEventListener('close', event => {
      this.eventHandlers.close.forEach(handler => handler(event.code, event.reason));
    });

    this.socket.addEventListener('error', event => {
      this.eventHandlers.error.forEach(handler => handler(event));
    });
  }

  on(event: string, listener: (...args: any[]) => void): IWebSocket {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(listener);
    }
    return this;
  }

  removeAllListeners(): IWebSocket {
    // Clear all event handlers
    Object.keys(this.eventHandlers).forEach(event => {
      this.eventHandlers[event] = [];
    });
    return this;
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  get readyState(): number {
    return this.socket.readyState;
  }
}

/**
 * Constants to match WebSocket states across environments
 */
const WS_CONSTANTS = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/**
 * Creates a WebSocket instance that works in both Node.js and browser environments
 * @param url - The WebSocket URL to connect to
 * @returns A WebSocket instance that implements the IWebSocket interface
 */
function createWebSocket(url: string): IWebSocket {
  if (
    (typeof window !== 'undefined' && window.WebSocket) ||
    (typeof self !== 'undefined' && self.WebSocket) ||
    (typeof global !== 'undefined' && global.WebSocket)
  ) {
    return new BrowserWebSocketAdapter(url);
  }

  const ws = new WebSocketNode(url);
  return ws as IWebSocket;
}

/**
 * Connection state for WebSocket client
 */
enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTING = 'DISCONNECTING',
}

/**
 * Interface for a pending request
 */
interface PendingRequest {
  resolve: (value: HPKVResponse) => void;
  reject: (reason?: unknown) => void;
  timer: TimeoutHandle;
  timestamp: number;
  operation: HPKVOperation;
}

/**
 * Configuration for the exponential backoff retry strategy
 */
interface RetryConfig {
  /** Maximum number of reconnection attempts */
  maxAttempts: number;

  /** Initial delay between reconnection attempts in milliseconds */
  initialDelayMs: number;

  /** Maximum delay between reconnection attempts in milliseconds */
  maxDelayMs: number;

  /** Random jitter in milliseconds to add to reconnection delay */
  jitterMs?: number;
}

/**
 * Default timeout values in milliseconds
 */
const DEFAULT_TIMEOUTS = {
  CONNECTION: 30000, // 30 seconds for connection
  OPERATION: 10000, // 10 seconds for operations
  CLEANUP: 60000, // 60 seconds for stale request cleanup
} as const;

/**
 * Base WebSocket client that handles connection management and message passing
 * for the HPKV WebSocket API.
 */
export abstract class BaseWebSocketClient {
  protected ws: IWebSocket | null = null;
  protected baseUrl: string;

  // Use a safe message ID counter that wraps around when it reaches MAX_SAFE_INTEGER
  protected messageId = 0;
  protected connectionPromise: Promise<void> | null = null;
  protected connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  protected reconnectAttempts = 0;
  protected connectionTimeout: TimeoutHandle | null = null;
  protected operationTimeoutMs: number | null = null;

  protected cleanupInterval: TimeoutHandle | null = null;
  protected emitter = new SimpleEventEmitter();
  protected messageMap = new Map<number, PendingRequest>();

  // Retry configuration
  protected retry: RetryConfig;

  // Timeout values
  protected timeouts = { ...DEFAULT_TIMEOUTS };

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

    // Setup automatic cleanup of stale requests
    this.initCleanupInterval();
  }

  /**
   * Initializes the cleanup interval for stale requests
   */
  private initCleanupInterval(): void {
    // Clear any existing interval first
    this.clearCleanupInterval();

    // Set up a new cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupStaleRequests(), this.timeouts.CLEANUP);
  }

  /**
   * Clears the cleanup interval
   */
  private clearCleanupInterval(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
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
  async get(key: string, timeoutMs?: number): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.GET,
        key,
      },
      timeoutMs
    );
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
  ): Promise<HPKVResponse> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    return this.sendMessage(
      {
        op: partialUpdate ? HPKVOperation.PATCH : HPKVOperation.SET,
        key,
        value: stringValue,
      },
      timeoutMs
    );
  }

  /**
   * Deletes a value from the key-value store
   * @param key - The key to delete
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the key is not found or connection fails
   */
  async delete(key: string, timeoutMs?: number): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.DELETE,
        key,
      },
      timeoutMs
    );
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
  ): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.RANGE,
        key,
        endKey,
        limit: options?.limit,
      },
      timeoutMs
    );
  }

  /**
   * Performs an atomic increment operation on a numeric value
   * @param key - The key of the value to increment
   * @param value - The amount to increment by
   * @param timeoutMs - Optional custom timeout for this operation in milliseconds
   * @returns A promise that resolves with the API response
   * @throws Error if the key does not contain a numeric value or connection fails
   */
  async atomicIncrement(key: string, value: number, timeoutMs?: number): Promise<HPKVResponse> {
    return this.sendMessage(
      {
        op: HPKVOperation.ATOMIC,
        key,
        value,
      },
      timeoutMs
    );
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
            reject(new TimeoutError(`Connection timeout after ${this.timeouts.CONNECTION}ms`));
          }
        }, this.timeouts.CONNECTION);

        const ws = createWebSocket(this.buildConnectionUrl());
        this.ws = ws;

        ws.on('open', () => {
          this.connectionState = ConnectionState.CONNECTED;
          this.emitter.emit('connected');

          if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
          }

          this.reconnectAttempts = 0;
          resolve();
        });

        ws.on('message', (data: string) => {
          const message = JSON.parse(data);
          this.handleMessage(message);
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
              clearTimeout(this.connectionTimeout);
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
      this.cancelAllRequests(new ConnectionError('Connection closed by client'));
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

    return {
      isConnected: this.connectionState === ConnectionState.CONNECTED,
      reconnectAttempts: this.reconnectAttempts,
      messagesPending: this.messageMap.size,
      connectionState: this.connectionState,
    } as ConnectionStats;
  }

  /**
   * Attempts to reconnect to the WebSocket server with exponential backoff
   * @returns A promise that resolves when the connection is reestablished
   * @throws ConnectionError if reconnection fails after max attempts
   */
  protected async reconnect(): Promise<void> {
    // Sync connection state first
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
        this.cancelAllRequests(connectionError);
        throw connectionError;
      }
    }
  }

  /**
   * Cleans up resources and closes the WebSocket connection
   */
  protected cleanup(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
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
    this.cancelAllRequests(new ConnectionError('Client destroyed'));
    this.cleanup();
    this.clearCleanupInterval();
    this.emitter.removeAllListeners();
  }

  /**
   * Cancel all pending requests with the given error
   * @param error - The error to reject pending requests with
   */
  protected cancelAllRequests(error: Error): void {
    // Reject all pending messages
    for (const [id, request] of this.messageMap.entries()) {
      clearTimeout(request.timer);
      request.reject(error);
      this.messageMap.delete(id);
    }
  }

  /**
   * Remove stale requests that have been pending for too long
   */
  protected cleanupStaleRequests(): void {
    const now = Date.now();
    const staleThreshold = this.timeouts.OPERATION * 3; // 3x the operation timeout

    for (const [id, request] of this.messageMap.entries()) {
      const age = now - request.timestamp;

      if (age > staleThreshold) {
        clearTimeout(request.timer);
        request.reject(
          new TimeoutError(`Request ${id} (${request.operation}) timed out after ${age}ms`)
        );
        this.messageMap.delete(id);
      }
    }
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

      this.cancelAllRequests(connectionError);
    }
  }

  /**
   * Processes WebSocket messages and resolves corresponding promises
   * @param message - The message received from the WebSocket server
   */
  protected handleMessage(message: HPKVResponse): void {
    const messageId = message.messageId;
    if (!messageId) {
      return;
    }
    const pendingRequest = this.messageMap.get(messageId);

    if (!pendingRequest) {
      // This might happen if a request timed out but the server still responded
      return;
    }

    // Clean up the request
    clearTimeout(pendingRequest.timer);
    this.messageMap.delete(messageId);

    // Handle error responses
    if (message.success === false || message.code !== 200 || message.error) {
      pendingRequest.reject(
        new HPKVError(message.error || message.message || 'Unknown error', message.code)
      );
      return;
    }

    // Handle successful responses
    pendingRequest.resolve(message);
  }

  /**
   * Gets the next message ID, ensuring it doesn't overflow
   * @returns A safe message ID number
   */
  private getNextMessageId(): number {
    // Reset messageId if it approaches MAX_SAFE_INTEGER to prevent overflow
    if (this.messageId >= Number.MAX_SAFE_INTEGER - 1000) {
      this.messageId = 0;
    }
    return ++this.messageId;
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
    return new Promise((resolve, reject) => {
      // Sync connection state first
      this.syncConnectionState();

      if (this.connectionState !== ConnectionState.CONNECTED) {
        reject(new ConnectionError('Client is not connected'));
        return;
      }

      const id = this.getNextMessageId();
      const messageWithId: HPKVRequestMessage = {
        ...message,
        messageId: id,
      };

      // Use custom timeout or default
      const actualTimeoutMs = timeoutMs || this.timeouts.OPERATION;

      // Set up message timeout
      const timer = setTimeout(() => {
        if (this.messageMap.has(id)) {
          this.messageMap.delete(id);
          reject(new TimeoutError(`Operation timed out after ${actualTimeoutMs}ms: ${message.op}`));
        }
      }, actualTimeoutMs);

      // Store the promise in the map
      this.messageMap.set(id, {
        resolve,
        reject,
        timer,
        timestamp: Date.now(),
        operation: message.op,
      });

      try {
        if (this.ws && this.isWebSocketOpen()) {
          this.ws.send(JSON.stringify(messageWithId));
        } else {
          clearTimeout(timer);
          this.messageMap.delete(id);
          reject(new ConnectionError('WebSocket is not open'));
        }
      } catch (error) {
        clearTimeout(timer);
        this.messageMap.delete(id);
        reject(
          new ConnectionError(
            `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        );
      }
    });
  }
}

/**
 * Common interface for both Node.js and Browser WebSockets
 */
export interface IWebSocket {
  readyState: number;
  on(event: string, listener: (...args: any[]) => void): IWebSocket;
  removeAllListeners(): IWebSocket;
  send(data: string): void;
  close(): void;
}

/**
 * Constants to match WebSocket states across environments
 */
export const WS_CONSTANTS = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/**
 * Connection state for WebSocket client
 */
export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTING = 'DISCONNECTING',
}

/**
 * Configuration for the exponential backoff retry strategy
 */
export interface RetryConfig {
  /** Maximum number of reconnection attempts before giving up */
  maxReconnectAttempts?: number;
  /** Initial delay in milliseconds between reconnection attempts */
  initialDelayBetweenReconnects?: number;
  /** Maximum delay in milliseconds between reconnection attempts */
  maxDelayBetweenReconnects?: number;
  /** Random jitter in milliseconds to add to reconnection delay */
  jitterMs?: number;
}

/**
 * Configuration for the dynamic throttling mechanism
 */
export interface ThrottlingConfig {
  enabled: boolean;
  rateLimit?: number; // Requests per second
}

/**
 * Metrics returned by the throttling manager
 */
export interface ThrottlingMetrics {
  currentRate: number;
  queueLength: number;
}

/**
 * Configuration options for WebSocket connection behavior
 */
export interface ConnectionConfig extends RetryConfig {
  /** Configuration for the throttling mechanism */
  throttling?: ThrottlingConfig;
}

/**
 * Statistics about the current WebSocket connection
 */
export interface ConnectionStats {
  isConnected: boolean;
  reconnectAttempts: number;
  messagesPending: number;
  connectionState?: ConnectionState;
  throttling?: {
    currentRate: number;
    queueLength: number;
  } | null;
}

/**
 * Represents the available operations for HPKV database interactions
 */
export enum HPKVOperation {
  GET = 1,
  SET = 2,
  PATCH = 3,
  DELETE = 4,
  RANGE = 5,
  ATOMIC = 6,
}

/**
 * Configuration for generating authentication tokens
 */
export interface HPKVTokenConfig {
  /** Array of keys the token will be authorized to subscribe to */
  subscribeKeys: string[];
  /** Optional access pattern for key-based permissions */
  accessPattern?: string;
}

/**
 * Structure of a request message sent to the HPKV server
 */
export interface HPKVRequestMessage {
  /** Operation to perform */
  op: HPKVOperation;
  /** Key to operate on */
  key: string;
  /** Value to set (for SET and PATCH operations) */
  value?: string | number;
  /** Optional message ID for tracking responses */
  messageId?: number;
  /** End key for range queries */
  endKey?: string;
  /** Maximum number of records to return */
  limit?: number;
}

/**
 * Base response interface with common fields for all response types
 */
export interface HPKVBaseResponse {
  /** Status code */
  code?: number;
  /** Human-readable message */
  message?: string;
  /** ID matching the request message */
  messageId?: number;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Response for GET operations
 */
export interface HPKVGetResponse extends HPKVBaseResponse {
  /** Key that was operated on */
  key: string;
  /** Value retrieved */
  value: string | number;
}

/**
 * Response for SET operations
 */
export interface HPKVSetResponse extends HPKVBaseResponse {
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Response for PATCH operations
 */
export interface HPKVPatchResponse extends HPKVBaseResponse {
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Response for DELETE operations
 */
export interface HPKVDeleteResponse extends HPKVBaseResponse {
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Response for RANGE operations
 */
export interface HPKVRangeResponse extends HPKVBaseResponse {
  /** Records returned for RANGE queries */
  records: Array<{
    key: string;
    value: string;
  }>;
  /** Number of records returned */
  count: number;
  /** Whether the result was truncated due to size limits */
  truncated: boolean;
}

/**
 * Response for ATOMIC operations
 */
export interface HPKVAtomicResponse extends HPKVBaseResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Key that was operated on */
  key?: string;
  /** New value after atomic operation */
  newValue: number;
}

/**
 * Response for key notifications (pub-sub)
 */
export interface HPKVNotificationResponse {
  /** Type of response */
  type: 'notification';
  /** Key that was operated on */
  key: string;
  /** Value retrieved (null if key was deleted) */
  value: string | number | null;
  /** Timestamp of the operation */
  timestamp: number;
}

/**
 * Response for error responses
 */
export interface HPKVErrorResponse extends HPKVBaseResponse {
  /** Error message if operation failed */
  error: string;
}

/**
 * Union type for all possible HPKV response types
 */
export type HPKVResponse =
  | HPKVGetResponse
  | HPKVSetResponse
  | HPKVPatchResponse
  | HPKVDeleteResponse
  | HPKVRangeResponse
  | HPKVAtomicResponse
  | HPKVNotificationResponse
  | HPKVErrorResponse;

/**
 * Interface for a pending request
 */
export interface PendingRequest {
  resolve: (value: HPKVResponse) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout | number;
  timestamp: number;
  operation: string;
}

/**
 * Event handler function type for HPKV responses
 */
export type HPKVEventHandler = (data: HPKVNotificationResponse) => void;

/**
 * Options for configuring range queries
 */
export interface RangeQueryOptions {
  /** Maximum number of records to return */
  limit?: number;
}

export enum HPKVOperation {
  GET = 1,
  SET = 2,
  PATCH = 3,
  DELETE = 4,
  RANGE = 5,
  ATOMIC = 6,
}

export interface HPKVConfig {
  // Either apiKey or token must be provided
  apiKey?: string;
  token?: string;
  baseUrl?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  connectionTimeout?: number;
}

export interface HPKVTokenConfig {
  subscribeKeys?: string[];
  accessPattern?: string;
}

export interface HPKVRequestMessage {
  op: HPKVOperation;
  key: string;
  value?: string;
  messageId?: number;
  endKey?: string;
  limit?: number;
}

export interface HPKVResponse {
  code: number;
  messageId?: number;
  key?: string;
  value?: string;
  error?: string;
  success?: boolean;
  records?: Array<{
    key: string;
    value: string;
  }>;
  count?: number;
  truncated?: boolean;
}

export interface HPKVSubscription {
  key: string;
  callback: (data: HPKVResponse) => void;
}

export type HPKVEventHandler = (data: HPKVResponse) => void;

export interface HPKVClient {
  connect(): Promise<void>;
  disconnect(): void;
  get(key: string): Promise<HPKVResponse>;
  set(key: string, value: unknown): Promise<HPKVResponse>;
  delete(key: string): Promise<HPKVResponse>;
  subscribe(key: string, callback: HPKVEventHandler): void;
  unsubscribe(key: string): void;
  on(event: string, handler: HPKVEventHandler): void;
  off(event: string, handler: HPKVEventHandler): void;
}

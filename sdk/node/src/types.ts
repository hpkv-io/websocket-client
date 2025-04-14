export enum HPKVOperation {
  GET = 1,
  SET = 2,
  PATCH = 3,
  DELETE = 4,
  RANGE = 5,
  ATOMIC = 6,
}

export interface ConnectionStats {
  isConnected: boolean;
  reconnectAttempts: number;
  messagesPending: number;
}

export interface ConnectionConfig {
  maxReconnectAttempts?: number;
  initialDelayBetweenReconnects?: number;
  maxDelayBetweenReconnects?: number;
}

export interface HPKVTokenConfig {
  subscribeKeys: string[];
  accessPattern?: string;
}

export interface HPKVRequestMessage {
  op: HPKVOperation;
  key: string;
  value?: string | number;
  messageId?: number;
  endKey?: string;
  limit?: number;
}

export interface HPKVResponse {
  type?: string;
  code: number;
  message?: string;
  messageId?: number;
  key?: string;
  value?: string | number;
  newValue?: number;
  error?: string;
  success?: boolean;
  records?: Array<{
    key: string;
    value: string;
  }>;
  count?: number;
  truncated?: boolean;
  timestamp?: number;
}

export type HPKVEventHandler = (data: HPKVResponse) => void;

export interface RangeQueryOptions {
  limit?: number;
}

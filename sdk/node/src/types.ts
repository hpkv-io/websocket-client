export enum HPKVOperation {
  GET = 1,
  SET = 2,
  PATCH = 3,
  DELETE = 4,
  RANGE = 5,
  ATOMIC = 6,
}

export interface HPKVTokenConfig {
  subscribeKeys: string[];
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

export type HPKVEventHandler = (data: HPKVResponse) => void;

export interface RangeQueryOptions {
  limit?: number;
}

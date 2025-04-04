import { BaseWebSocketClient } from './base-client';
import { HPKVResponse, HPKVOperation } from '../types';

export interface RangeQueryOptions {
  limit?: number;
}

export class HPKVApiClient extends BaseWebSocketClient {
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl: string) {
    super(baseUrl);
    this.apiKey = apiKey;
  }

  protected buildConnectionUrl(): string {
    const baseUrl = this.baseUrl.endsWith('/ws') ? this.baseUrl : `${this.baseUrl}/ws`;
    return `${baseUrl}?apiKey=${this.apiKey}`;
  }

  async get(key: string): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.GET,
      key,
    });
  }

  async set(key: string, value: unknown): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.SET,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    });
  }

  async delete(key: string): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.DELETE,
      key,
    });
  }

  async patch(key: string, value: unknown): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.PATCH,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    });
  }

  async range(key: string, endKey: string, options: RangeQueryOptions): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.RANGE,
      key,
      endKey,
      limit: options.limit,
    });
  }

  async atomicIncrement(key: string, value: number): Promise<HPKVResponse> {
    return this.sendMessage({
      op: HPKVOperation.ATOMIC,
      key,
      value: value.toString(),
    });
  }
}

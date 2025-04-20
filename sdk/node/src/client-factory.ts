import { HPKVApiClient } from './clients/api-client';
import { HPKVSubscriptionClient } from './clients/subscription-client';
import { ConnectionConfig } from './types';

export class HPKVClientFactory {
  /**
   * Creates a client for server-side operations using an API key
   */
  static createApiClient(
    apiKey: string,
    baseUrl: string,
    config?: ConnectionConfig
  ): HPKVApiClient {
    return new HPKVApiClient(apiKey, baseUrl, config);
  }

  /**
   * Creates a client for subscription-based operations using a token
   */
  static createSubscriptionClient(
    token: string,
    baseUrl: string,
    config?: ConnectionConfig
  ): HPKVSubscriptionClient {
    return new HPKVSubscriptionClient(token, baseUrl, config);
  }
}

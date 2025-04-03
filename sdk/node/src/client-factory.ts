import { HPKVApiClient } from './clients/api-client';
import { HPKVSubscriptionClient } from './clients/subscription-client';

export class HPKVClientFactory {
  /**
   * Creates a client for server-side operations using an API key
   */
  static createApiClient(apiKey: string, baseUrl: string): HPKVApiClient {
    return new HPKVApiClient(apiKey, baseUrl);
  }

  /**
   * Creates a client for subscription-based operations using a token
   */
  static createSubscriptionClient(token: string, baseUrl: string): HPKVSubscriptionClient {
    return new HPKVSubscriptionClient(token, baseUrl);
  }
}

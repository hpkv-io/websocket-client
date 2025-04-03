/// <reference types="jest" />
import { WebsocketTokenManager } from '../src';
import { HPKVApiClient } from '../src/clients/api-client';
import { HPKVSubscriptionClient } from '../src/clients/subscription-client';
import { HPKVResponse } from '../src/types';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.HPKV_API_KEY || '';
const BASE_URL = process.env.HPKV_API_BASE_URL || '';

describe('HPKV Integration Tests', () => {
  let apiClient: HPKVApiClient;
  let subscriptionClient: HPKVSubscriptionClient;
  let testToken: string;

  beforeAll(() => {
    apiClient = new HPKVApiClient(API_KEY, BASE_URL);
  });

  afterAll(() => {
    apiClient.disconnect();
    subscriptionClient.disconnect();
  });

  describe('API Client Tests', () => {
    const testKey = 'test-key';
    const testValue = 'test-value';

    it('should set and get a value', async () => {
      // Set a value
      const setResponse = await apiClient.set(testKey, testValue);
      expect(setResponse.success).toBe(true);
      expect(setResponse.code).toBe(200);

      // Get the value
      const getResponse = await apiClient.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe(testValue);
    });

    it('should delete a value', async () => {
      // Delete the value
      const deleteResponse = await apiClient.delete(testKey);
      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.code).toBe(200);
    });

    it('should patch a value', async () => {
      const initialValue = { name: 'test', value: 123 };
      const patchValue = { value: 456 };

      // Set initial value
      await apiClient.set(testKey, initialValue);

      // Patch the value
      const patchResponse = await apiClient.patch(testKey, patchValue);
      expect(patchResponse.success).toBe(true);
      expect(patchResponse.code).toBe(200);

      // Verify the patched value
      const getResponse = await apiClient.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(JSON.parse(getResponse.value as string)).toEqual({
        name: 'test',
        value: 456,
      });
    });

    it('should perform range queries', async () => {
      // Set multiple values
      await apiClient.set('range-test-1', 'value1');
      await apiClient.set('range-test-2', 'value2');
      await apiClient.set('range-test-3', 'value3');

      // Query the range
      const rangeResponse = await apiClient.range('range-test-1', 'range-test-3', {
        limit: 2,
      });

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(2);
    });

    it('should perform atomic increment', async () => {
      const counterKey = 'counter-key';
      await apiClient.set(counterKey, '0');

      const incrementResponse = await apiClient.atomicIncrement(counterKey, 1);
      expect(incrementResponse.success).toBe(true);
      expect(incrementResponse.code).toBe(200);

      const getResponse = await apiClient.get(counterKey);
      expect(getResponse.code).toBe(200);
      expect(parseInt(getResponse.value as string)).toBe(1);
    });
  });

  describe('Subscription Client Tests', () => {
    const testKey = 'subscription-test-key';
    let receivedEvents: HPKVResponse[] = [];

    beforeEach(() => {
      receivedEvents = [];
    });

    it('should receive subscription events', async () => {
      await apiClient.set(testKey, 'test-value');
      const tokenManager = new WebsocketTokenManager(API_KEY, BASE_URL);
      testToken = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: testKey,
      });
      subscriptionClient = new HPKVSubscriptionClient(testToken, BASE_URL);
      await subscriptionClient.connect();
      subscriptionClient.subscribe(testKey, event => {
        receivedEvents.push(event);
      });
      await apiClient.set(testKey, 'new-value');
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].key).toBe(testKey);
      expect(receivedEvents[0].value).toBe('new-value');
    });
  });
});

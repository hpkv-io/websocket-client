/// <reference types="jest" />
import { HPKVClientFactory, WebsocketTokenManager } from '../src';
import { HPKVApiClient } from '../src/clients/api-client';
import { HPKVSubscriptionClient } from '../src/clients/subscription-client';
import { HPKVResponse } from '../src/types';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.HPKV_API_KEY || '';
const BASE_URL = process.env.HPKV_API_BASE_URL || '';
const TEST_KEY_PREFIX = 'sub-test-';

describe('HPKVSubscriptionClient Integration Tests', () => {
  let apiClient: HPKVApiClient;
  let tokenManager: WebsocketTokenManager;
  const keysToCleanup: string[] = [];

  // We'll use these for various test scenarios
  let subscriptionClient1: HPKVSubscriptionClient;
  let subscriptionClient2: HPKVSubscriptionClient;
  let restrictedClient: HPKVSubscriptionClient;

  // Helper to generate unique test keys
  function generateTestKey(testName: string): string {
    const key = `${TEST_KEY_PREFIX}${testName}-${Date.now()}`;
    keysToCleanup.push(key);
    return key;
  }

  beforeAll(async () => {
    apiClient = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
    tokenManager = new WebsocketTokenManager(API_KEY, BASE_URL);
  });

  afterAll(async () => {
    try {
      // Clean up clients
      if (subscriptionClient1) subscriptionClient1.disconnect();
      if (subscriptionClient2) subscriptionClient2.disconnect();
      if (restrictedClient) restrictedClient.disconnect();

      // Ensure API client is connected for cleanup
      await apiClient.connect();

      // Clean up all keys created during tests
      for (const key of keysToCleanup) {
        try {
          // Try to delete the key directly - if it doesn't exist, that's fine
          await apiClient.delete(key);
        } catch (error) {
          // Only log non-"Record not found" errors as actual issues
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes('Record not found')) {
            console.error(`Failed to clean up key ${key}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error during test cleanup:', error);
    } finally {
      apiClient.disconnect();
    }
  });

  describe('Connection Management', () => {
    it('should connect successfully with a valid token', async () => {
      const testKey = generateTestKey('connect');
      await apiClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      expect(subscriptionClient1.getConnectionStatus()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      const testKey = generateTestKey('disconnect');
      await apiClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const tempClient = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await tempClient.connect();
      tempClient.disconnect();

      expect(tempClient.getConnectionStatus()).toBe(false);
    });

    it('should fail to connect with an invalid token', async () => {
      const invalidClient = HPKVClientFactory.createSubscriptionClient('invalid-token', BASE_URL);

      await expect(invalidClient.connect()).rejects.toThrow();
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      // Disconnect any existing clients
      if (subscriptionClient1) subscriptionClient1.disconnect();
    });

    afterEach(() => {
      if (subscriptionClient1) {
        subscriptionClient1.disconnect();
      }
    });

    it('should set and get a value', async () => {
      const testKey = generateTestKey('set-get');
      const testValue = 'subscription-test-value';

      await apiClient.set(testKey, 'initial-value');

      // Create a client with access to the test key pattern
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      // Set a value
      const setResponse = await subscriptionClient1.set(testKey, testValue);
      expect(setResponse.code).toBe(200);

      // Get the value
      const getResponse = await subscriptionClient1.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe(testValue);
    });

    it('should delete a value', async () => {
      const testKey = generateTestKey('delete');
      const testValue = 'delete-test-value';

      await apiClient.set(testKey, 'initial-value');

      // Create a client with access to the test key pattern
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      // First ensure the key exists
      await subscriptionClient1.set(testKey, testValue);

      // Delete the value
      const deleteResponse = await subscriptionClient1.delete(testKey);
      expect(deleteResponse.code).toBe(200);

      // Verify it's deleted - should throw an error
      try {
        await subscriptionClient1.get(testKey);
        fail('Expected an error to be thrown when getting a deleted key');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should perform operations on keys matching the access pattern', async () => {
      const testKey1 = generateTestKey('access-1');
      const testKey2 = generateTestKey('access-2');

      await apiClient.set(testKey1, 'initial-value-1');
      await apiClient.set(testKey2, 'initial-value-2');

      // Create a client with access to the test key pattern
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey1],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      // Should be able to operate on testKey2 too because it matches the access pattern
      await subscriptionClient1.set(testKey2, 'new-value');
      const getResponse = await subscriptionClient1.get(testKey2);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe('new-value');
    });

    it('should fail to perform operations on keys not matching the access pattern', async () => {
      const testKey = generateTestKey('access-pattern');
      const restrictedKey = 'restricted-key-' + Date.now();

      await apiClient.set(testKey, 'initial-value');
      await apiClient.set(restrictedKey, 'restricted-value');

      // Add restricted key to cleanup
      keysToCleanup.push(restrictedKey);

      // Create a client with access to only the test key pattern
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      try {
        await subscriptionClient1.set(restrictedKey, 'unauthorized-update');
        fail('Expected operation to fail due to access pattern restriction');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Subscription Features', () => {
    beforeEach(async () => {
      // Disconnect any existing clients
      if (subscriptionClient1) subscriptionClient1.disconnect();
      if (subscriptionClient2) subscriptionClient2.disconnect();
      if (restrictedClient) restrictedClient.disconnect();
    });

    afterEach(() => {
      subscriptionClient1?.disconnect();
      subscriptionClient2?.disconnect();
      restrictedClient?.disconnect();
    });

    it('should receive notifications for subscribed keys', async () => {
      const testKey = generateTestKey('notification');
      await apiClient.set(testKey, 'initial-value');

      // Create token and client with access to the test key
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      // Store events received by the subscription
      const receivedEvents: HPKVResponse[] = [];

      // Subscribe to changes
      subscriptionClient1.subscribe(event => {
        receivedEvents.push(event);
      });

      // Update the key via API client to trigger notification
      await apiClient.set(testKey, 'updated-via-api');

      // Wait for the notification to be delivered
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if we received the notification
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect(receivedEvents[0].key).toBe(testKey);
      expect(receivedEvents[0].value).toBe('updated-via-api');
    });

    it('should not receive notifications for keys not subscribed to', async () => {
      const subscribedKey = generateTestKey('subscribed');
      const unsubscribedKey = generateTestKey('unsubscribed');

      await apiClient.set(subscribedKey, 'initial-subscribed');
      await apiClient.set(unsubscribedKey, 'initial-unsubscribed');

      // Create token and client with subscription only to the subscribed key
      const token = await tokenManager.generateToken({
        subscribeKeys: [subscribedKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      const receivedEvents: HPKVResponse[] = [];

      // Subscribe to only one key
      subscriptionClient1.subscribe(event => {
        receivedEvents.push(event);
      });

      // Update the unsubscribed key
      await apiClient.set(unsubscribedKey, 'updated-unsubscribed-key');

      // Wait for any potential notifications
      await new Promise(resolve => setTimeout(resolve, 1000));

      // We should not receive notifications for the unsubscribed key
      expect(receivedEvents.length).toBe(0);
    });

    it('should allow multiple clients to receive notifications for the same key', async () => {
      const testKey = generateTestKey('multi-client');
      await apiClient.set(testKey, 'initial-value');

      // Create tokens and clients with access to the test key
      const token1 = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const token2 = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token1, BASE_URL);
      subscriptionClient2 = HPKVClientFactory.createSubscriptionClient(token2, BASE_URL);

      await subscriptionClient1.connect();
      await subscriptionClient2.connect();

      const eventsClient1: HPKVResponse[] = [];
      const eventsClient2: HPKVResponse[] = [];

      // Set up subscriptions for both clients
      subscriptionClient1.subscribe(event => {
        eventsClient1.push(event);
      });

      subscriptionClient2.subscribe(event => {
        eventsClient2.push(event);
      });

      // Update the key to trigger notifications
      await apiClient.set(testKey, 'notify-multiple-clients');

      // Wait for notifications to be delivered
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Both clients should receive the notification
      expect(eventsClient1.length).toBeGreaterThanOrEqual(1);
      expect(eventsClient2.length).toBeGreaterThanOrEqual(1);
      expect(eventsClient1[0].value).toBe('notify-multiple-clients');
      expect(eventsClient2[0].value).toBe('notify-multiple-clients');
    });

    it('should stop receiving notifications after unsubscribing', async () => {
      const testKey = generateTestKey('unsubscribe');
      await apiClient.set(testKey, 'initial-value');

      // Create token and client with access to the test key
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(token, BASE_URL);
      await subscriptionClient1.connect();

      const receivedEvents: HPKVResponse[] = [];

      // Subscribe to changes
      const callbackId = subscriptionClient1.subscribe(event => {
        receivedEvents.push(event);
      });

      // Make a change to verify subscription is working
      await apiClient.set(testKey, 'before-unsubscribe');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should have received the notification
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

      // Clear the events array and unsubscribe
      receivedEvents.length = 0;
      subscriptionClient1.unsubscribe(callbackId);

      // Make another change after unsubscribing
      await apiClient.set(testKey, 'after-unsubscribe');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should not have received any notifications after unsubscribing
      expect(receivedEvents.length).toBe(0);
    });

    it('should fail operations on keys not matching the access pattern', async () => {
      const testKey = generateTestKey('restricted-access');
      const restrictedKey = 'restricted-key-' + Date.now();

      await apiClient.set(testKey, 'regular-value');
      await apiClient.set(restrictedKey, 'restricted-value');

      // Add restricted key to cleanup
      keysToCleanup.push(restrictedKey);

      // Create tokens with different access patterns
      const regularToken = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const restrictedToken = await tokenManager.generateToken({
        subscribeKeys: [restrictedKey],
        accessPattern: 'restricted-key-*',
      });

      subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(regularToken, BASE_URL);
      restrictedClient = HPKVClientFactory.createSubscriptionClient(restrictedToken, BASE_URL);

      await subscriptionClient1.connect();
      await restrictedClient.connect();

      try {
        // regularClient should not access restrictedKey
        await subscriptionClient1.get(restrictedKey);
        fail('Expected operation to fail due to access pattern restriction');
      } catch (error: unknown) {
        expect(error).toBeDefined();
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Access denied: Key does not match allowed pattern');
      }

      try {
        // restrictedClient should not access testKey
        await restrictedClient.get(testKey);
        fail('Expected operation to fail due to access pattern restriction');
      } catch (error: unknown) {
        expect(error).toBeDefined();
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Access denied: Key does not match allowed pattern');
      }
    });
  });
});

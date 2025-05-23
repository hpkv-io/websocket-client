/// <reference types="jest" />
import {
  ConnectionError,
  HPKVClientFactory,
  HPKVSubscriptionClient,
  WebsocketTokenManager,
  HPKVError,
} from '../../src';
import { HPKVApiClient } from '../../src/clients/api-client';
import { HPKVNotificationResponse, HPKVResponse } from '../../src/websocket';
import dotenv from 'dotenv';
import { jest, expect, describe, it, beforeAll, afterAll, afterEach } from '@jest/globals';

dotenv.config();

const API_KEY = process.env.HPKV_API_KEY || '';
const BASE_URL = process.env.HPKV_API_BASE_URL || '';
const TEST_KEY_PREFIX = 'sub-test-';

describe('HPKVSubscriptionClient Integration Tests', () => {
  let helperClient: HPKVApiClient;
  let tokenManager: WebsocketTokenManager;
  const keysToCleanup: string[] = [];
  const activeClients: HPKVSubscriptionClient[] = [];
  const activeTimers: NodeJS.Timeout[] = [];

  // Helper to generate unique test keys
  function generateTestKey(testName: string): string {
    const key = `${TEST_KEY_PREFIX}${testName}-${Date.now()}`;
    keysToCleanup.push(key);
    return key;
  }

  // Helper to track and clean up timers
  function safeSetTimeout(callback: (value: unknown) => void, ms: number): NodeJS.Timeout {
    const timer = setTimeout(callback, ms);
    activeTimers.push(timer);
    return timer;
  }

  // Helper to track clients for cleanup
  function trackClient(client: HPKVSubscriptionClient): HPKVSubscriptionClient {
    activeClients.push(client);
    return client;
  }

  beforeAll(async () => {
    jest.clearAllMocks();
    global.WebSocket = undefined as unknown as typeof WebSocket;

    helperClient = HPKVClientFactory.createApiClient(API_KEY, BASE_URL, {
      throttling: {
        enabled: true,
        rateLimit: 30,
      },
    });
    tokenManager = new WebsocketTokenManager(API_KEY, BASE_URL);
    await helperClient.connect();
  });

  afterEach(async () => {
    // Clean up any active timers after each test
    activeTimers.forEach(timer => clearTimeout(timer));
    activeTimers.length = 0;

    // Properly destroy any clients that weren't properly closed
    await Promise.all(
      activeClients.map(async client => {
        try {
          if (client.getConnectionStats().isConnected) {
            await client.disconnect(false);
          }
          client.destroy();
        } catch (error) {
          console.error('Error during cleanup:', error);
        }
      })
    );
    activeClients.length = 0;
  });

  afterAll(async () => {
    try {
      await helperClient.connect();

      for (const key of keysToCleanup) {
        try {
          await helperClient.delete(key);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!errorMessage.includes('Record not found')) {
            console.error(`Failed to clean up key ${key}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error during test cleanup:', error);
    } finally {
      await helperClient.disconnect();
      if (typeof helperClient.destroy === 'function') {
        helperClient.destroy();
      }
    }
  });

  describe('Connection Management', () => {
    it('should connect successfully with a valid token', async () => {
      const testKey = generateTestKey('connect');
      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      expect(subscriptionClient.getConnectionStats().isConnected).toBe(true);
    });

    it('should disconnect successfully', async () => {
      const testKey = generateTestKey('disconnect');
      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const tempClient = trackClient(HPKVClientFactory.createSubscriptionClient(token, BASE_URL));
      await tempClient.connect();
      await tempClient.disconnect();

      expect(tempClient.getConnectionStats().isConnected).toBe(false);
    });

    it('should fail to connect with an invalid token', async () => {
      const invalidClient = trackClient(
        HPKVClientFactory.createSubscriptionClient('invalid-token', BASE_URL)
      );

      await expect(invalidClient.connect()).rejects.toThrow(ConnectionError);
      await expect(invalidClient.connect()).rejects.toHaveProperty(
        'message',
        expect.stringContaining('403')
      );

      expect(invalidClient.getConnectionStats().isConnected).toBe(false);
    });
  });

  describe('CRUD Operations', () => {
    it('should set and get a value', async () => {
      const testKey = generateTestKey('set-get');
      const testValue = 'subscription-test-value';

      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      // Set a value
      const setResponse = await subscriptionClient.set(testKey, testValue);
      expect(setResponse.code).toBe(200);

      // Get the value
      const getResponse = await subscriptionClient.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe(testValue);
    });

    it('should delete a key', async () => {
      const testKey = generateTestKey('delete');
      const testValue = 'delete-test-value';

      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      // First ensure the key exists
      await subscriptionClient.set(testKey, testValue);

      // Delete the value
      const deleteResponse = await subscriptionClient.delete(testKey);
      expect(deleteResponse.code).toBe(200);

      // Verify it's deleted - should throw an error (e.g., HPKVError with code 404)
      await expect(subscriptionClient.get(testKey)).rejects.toThrow(HPKVError);
      await expect(subscriptionClient.get(testKey)).rejects.toHaveProperty('code', 404);
    });

    it('should perform operations on keys matching the access pattern', async () => {
      const testKey1 = generateTestKey('access-1');
      const testKey2 = generateTestKey('access-2');

      await helperClient.set(testKey1, 'initial-value-1');
      await helperClient.set(testKey2, 'initial-value-2');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey1],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      // Should be able to operate on testKey2 too because it matches the access pattern
      await subscriptionClient.set(testKey2, 'new-value');
      const getResponse = await subscriptionClient.get(testKey2);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe('new-value');
    });

    it('should fail to perform operations on keys not matching the access pattern', async () => {
      const testKey = generateTestKey('access-pattern');
      const restrictedKey = 'restricted-key-' + Date.now();

      await helperClient.set(testKey, 'initial-value');
      await helperClient.set(restrictedKey, 'restricted-value');

      // Add restricted key to cleanup
      keysToCleanup.push(restrictedKey);

      // Create a client with access to only the test key pattern
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      await expect(subscriptionClient.set(restrictedKey, 'unauthorized-update')).rejects.toThrow(
        HPKVError
      );

      await expect(
        subscriptionClient.set(restrictedKey, 'unauthorized-update')
      ).rejects.toHaveProperty('code', 403);
    });
  });

  describe('Subscription Features', () => {
    it('should receive notifications for subscribed keys', async () => {
      const testKey = generateTestKey('notification');
      await helperClient.set(testKey, 'initial-value');

      // Create token and client with access to the test key
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL, {
          throttling: {
            enabled: true,
            rateLimit: 10,
          },
        })
      );
      await subscriptionClient.connect();

      // Store events received by the subscription
      const receivedEvents: HPKVNotificationResponse[] = [];

      // Subscribe to changes
      subscriptionClient.subscribe(event => {
        receivedEvents.push(event);
      });

      // Update the key via API client to trigger notification
      await helperClient.set(testKey, 'updated-via-api');

      // Wait for the notification to be delivered
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // Check if we received the notification
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect((receivedEvents[0] as HPKVNotificationResponse).key).toBe(testKey);
      expect((receivedEvents[0] as HPKVNotificationResponse).value).toBe('updated-via-api');
    });

    it('should not receive notifications for keys not subscribed to', async () => {
      const subscribedKey = generateTestKey('subscribed');
      const unsubscribedKey = generateTestKey('unsubscribed');

      await helperClient.set(subscribedKey, 'initial-subscribed');
      await helperClient.set(unsubscribedKey, 'initial-unsubscribed');

      // Create token and client with subscription only to the subscribed key
      const token = await tokenManager.generateToken({
        subscribeKeys: [subscribedKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      const receivedEvents: HPKVNotificationResponse[] = [];

      // Subscribe to only one key
      subscriptionClient.subscribe(event => {
        receivedEvents.push(event);
      });

      // Update the unsubscribed key
      await helperClient.set(unsubscribedKey, 'updated-unsubscribed-key');

      // Wait for any potential notifications
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // We should not receive notifications for the unsubscribed key
      expect(receivedEvents.length).toBe(0);
    });

    it('should allow multiple clients to receive notifications for the same key', async () => {
      const testKey = generateTestKey('multi-client');
      await helperClient.set(testKey, 'initial-value');

      // Create tokens and clients with access to the test key
      const token1 = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const token2 = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient1 = trackClient(
        HPKVClientFactory.createSubscriptionClient(token1, BASE_URL)
      );
      const subscriptionClient2 = trackClient(
        HPKVClientFactory.createSubscriptionClient(token2, BASE_URL)
      );

      await subscriptionClient1.connect();
      await subscriptionClient2.connect();

      const eventsClient1: HPKVNotificationResponse[] = [];
      const eventsClient2: HPKVNotificationResponse[] = [];

      // Set up subscriptions for both clients
      subscriptionClient1.subscribe(event => {
        eventsClient1.push(event);
      });

      subscriptionClient2.subscribe(event => {
        eventsClient2.push(event);
      });

      // Update the key to trigger notifications
      await helperClient.set(testKey, 'notify-multiple-clients');

      // Wait for notifications to be delivered
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // Both clients should receive the notification
      expect(eventsClient1.length).toBeGreaterThanOrEqual(1);
      expect(eventsClient2.length).toBeGreaterThanOrEqual(1);
      expect((eventsClient1[0] as HPKVNotificationResponse).value).toBe('notify-multiple-clients');
      expect((eventsClient2[0] as HPKVNotificationResponse).value).toBe('notify-multiple-clients');
    });

    it('should stop receiving notifications after unsubscribing', async () => {
      const testKey = generateTestKey('unsubscribe');
      await helperClient.set(testKey, 'initial-value');

      // Create token and client with access to the test key
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      const receivedEvents: HPKVResponse[] = [];

      // Subscribe to changes
      const callbackId = subscriptionClient.subscribe(event => {
        receivedEvents.push(event);
      });

      // Make a change to verify subscription is working
      await helperClient.set(testKey, 'before-unsubscribe');
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // Should have received the notification
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

      // Clear the events array and unsubscribe
      receivedEvents.length = 0;
      subscriptionClient.unsubscribe(callbackId);

      // Make another change after unsubscribing
      await helperClient.set(testKey, 'after-unsubscribe');
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // Should not have received any notifications after unsubscribing
      expect(receivedEvents.length).toBe(0);
    });

    it('should fail operations on keys not matching the access pattern', async () => {
      const testKey = generateTestKey('restricted-access');
      const restrictedKey = 'restricted-key-' + Date.now();

      await helperClient.set(testKey, 'regular-value');
      await helperClient.set(restrictedKey, 'restricted-value');

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

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(regularToken, BASE_URL)
      );
      const restrictedClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(restrictedToken, BASE_URL)
      );

      await subscriptionClient.connect();
      await restrictedClient.connect();

      // regularClient should not access restrictedKey
      await expect(subscriptionClient.get(restrictedKey)).rejects.toThrow(HPKVError);
      await expect(subscriptionClient.get(restrictedKey)).rejects.toHaveProperty('code', 403);

      // restrictedClient should not access testKey
      await expect(restrictedClient.get(testKey)).rejects.toThrow(HPKVError);
      await expect(restrictedClient.get(testKey)).rejects.toHaveProperty('code', 403);
    });
  });

  describe('Event Handling', () => {
    it('should emit connected event when connection is established', async () => {
      const testKey = generateTestKey('event-connected');
      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );

      let connectedEventFired = false;

      subscriptionClient.on('connected', () => {
        connectedEventFired = true;
      });

      await subscriptionClient.connect();

      expect(connectedEventFired).toBe(true);
    });

    it('should emit disconnected event when connection is closed', async () => {
      const testKey = generateTestKey('event-disconnected');
      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );

      let disconnectedEventFired = false;

      subscriptionClient.on('disconnected', () => {
        disconnectedEventFired = true;
      });

      await subscriptionClient.connect();
      await subscriptionClient.disconnect();

      expect(disconnectedEventFired).toBe(true);
    });

    it('should allow removing event listeners', async () => {
      const testKey = generateTestKey('event-off');
      await helperClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );

      let eventCounter = 0;

      const listener = (): void => {
        eventCounter++;
      };

      // Add and then remove the listener
      subscriptionClient.on('connected', listener);
      subscriptionClient.off('connected', listener);

      await subscriptionClient.connect();

      expect(eventCounter).toBe(0);
    });
  });
});

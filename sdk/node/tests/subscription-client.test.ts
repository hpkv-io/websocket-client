/// <reference types="jest" />
import { HPKVClientFactory, HPKVSubscriptionClient, WebsocketTokenManager } from '../src';
import { HPKVApiClient } from '../src/clients/api-client';
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
    apiClient = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
    tokenManager = new WebsocketTokenManager(API_KEY, BASE_URL);
    await apiClient.connect();
  });

  afterEach(async () => {
    // Clean up any active timers after each test
    activeTimers.forEach(timer => clearTimeout(timer));
    activeTimers.length = 0;

    // Properly destroy any clients that weren't properly closed
    await Promise.all(
      activeClients.map(async client => {
        try {
          client.off('connected', () => {});
          client.off('disconnected', () => {});
          client.off('reconnecting', () => {});
          // First disconnect if still connected
          if (client.getConnectionStats().isConnected) {
            await client.disconnect(false);
          }

          // Then destroy to clean up all resources
          if (typeof client.destroy === 'function') {
            client.destroy();
          }
        } catch (error) {
          // Ignore errors during cleanup
        }
      })
    );
    activeClients.length = 0;
  });

  afterAll(async () => {
    try {
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
      // Properly destroy the API client
      await apiClient.disconnect();
      if (typeof apiClient.destroy === 'function') {
        apiClient.destroy();
      }

      // Give event loop a chance to clean up before test suite exits
      await new Promise(resolve => safeSetTimeout(resolve, 500));
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

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      expect(subscriptionClient.getConnectionStats().isConnected).toBe(true);
    });

    it('should disconnect successfully', async () => {
      const testKey = generateTestKey('disconnect');
      await apiClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const tempClient = trackClient(HPKVClientFactory.createSubscriptionClient(token, BASE_URL));
      await tempClient.connect();

      // Give some time for connection to establish fully
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      await tempClient.disconnect();

      // Disconnection may not be instant, allow time for it to complete
      await new Promise(resolve => safeSetTimeout(resolve, 300));

      expect(tempClient.getConnectionStats().isConnected).toBe(false);
    });

    it('should fail to connect with an invalid token', async () => {
      const invalidClient = trackClient(
        HPKVClientFactory.createSubscriptionClient('invalid-token', BASE_URL)
      );

      try {
        await invalidClient.connect();
        fail('Expected connection to fail with invalid token');
      } catch (error) {
        // Connection should fail with an error
        expect(error).toBeDefined();
      }

      // Either the error event fired or the connection failed
      expect(invalidClient.getConnectionStats().isConnected).toBe(false);
    });
  });

  describe('CRUD Operations', () => {
    it('should set and get a value', async () => {
      const testKey = generateTestKey('set-get');
      const testValue = 'subscription-test-value';

      await apiClient.set(testKey, 'initial-value');

      // Create a client with access to the test key pattern
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

    it('should delete a value', async () => {
      const testKey = generateTestKey('delete');
      const testValue = 'delete-test-value';

      await apiClient.set(testKey, 'initial-value');

      // Create a client with access to the test key pattern
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

      // Verify it's deleted - should throw an error
      try {
        await subscriptionClient.get(testKey);
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

      await apiClient.set(testKey, 'initial-value');
      await apiClient.set(restrictedKey, 'restricted-value');

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

      try {
        await subscriptionClient.set(restrictedKey, 'unauthorized-update');
        fail('Expected operation to fail due to access pattern restriction');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Subscription Features', () => {
    it('should receive notifications for subscribed keys', async () => {
      const testKey = generateTestKey('notification');
      await apiClient.set(testKey, 'initial-value');

      // Create token and client with access to the test key
      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      // Store events received by the subscription
      const receivedEvents: HPKVResponse[] = [];

      // Subscribe to changes
      subscriptionClient.subscribe(event => {
        receivedEvents.push(event);
      });

      // Update the key via API client to trigger notification
      await apiClient.set(testKey, 'updated-via-api');

      // Wait for the notification to be delivered
      await new Promise(resolve => safeSetTimeout(resolve, 1000));

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

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );
      await subscriptionClient.connect();

      const receivedEvents: HPKVResponse[] = [];

      // Subscribe to only one key
      subscriptionClient.subscribe(event => {
        receivedEvents.push(event);
      });

      // Update the unsubscribed key
      await apiClient.set(unsubscribedKey, 'updated-unsubscribed-key');

      // Wait for any potential notifications
      await new Promise(resolve => safeSetTimeout(resolve, 1000));

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

      const subscriptionClient1 = trackClient(
        HPKVClientFactory.createSubscriptionClient(token1, BASE_URL)
      );
      const subscriptionClient2 = trackClient(
        HPKVClientFactory.createSubscriptionClient(token2, BASE_URL)
      );

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
      await new Promise(resolve => safeSetTimeout(resolve, 1000));

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
      await apiClient.set(testKey, 'before-unsubscribe');
      await new Promise(resolve => safeSetTimeout(resolve, 1000));

      // Should have received the notification
      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);

      // Clear the events array and unsubscribe
      receivedEvents.length = 0;
      subscriptionClient.unsubscribe(callbackId);

      // Make another change after unsubscribing
      await apiClient.set(testKey, 'after-unsubscribe');
      await new Promise(resolve => safeSetTimeout(resolve, 1000));

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

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(regularToken, BASE_URL)
      );
      const restrictedClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(restrictedToken, BASE_URL)
      );

      await subscriptionClient.connect();
      await restrictedClient.connect();

      try {
        // regularClient should not access restrictedKey
        await subscriptionClient.get(restrictedKey);
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

  describe('Event Handling', () => {
    it('should emit connected event when connection is established', async () => {
      const testKey = generateTestKey('event-connected');
      await apiClient.set(testKey, 'initial-value');

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
      await apiClient.set(testKey, 'initial-value');

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

      // Give some time for connection to establish fully
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      await subscriptionClient.disconnect(false);

      // Disconnection may not be instant, allow more time for the event to fire
      await new Promise(resolve => safeSetTimeout(resolve, 500));

      expect(disconnectedEventFired).toBe(true);
    });

    it('should allow removing event listeners', async () => {
      const testKey = generateTestKey('event-off');
      await apiClient.set(testKey, 'initial-value');

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

  describe('Request Queue and Reconnection', () => {
    it('should automatically connect when sending a request', async () => {
      const testKey = generateTestKey('auto-connect');
      const testValue = 'auto-connect-value';

      await apiClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      // Create client but don't connect
      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );

      // Verify not connected initially
      expect(subscriptionClient.getConnectionStats().isConnected).toBe(false);

      // This should automatically establish connection before sending
      const response = await subscriptionClient.set(testKey, testValue);

      // Verify it connected and operation succeeded
      expect(subscriptionClient.getConnectionStats().isConnected).toBe(true);
      expect(response.code).toBe(200);

      // Verify value was set
      const getResponse = await subscriptionClient.get(testKey);
      expect(getResponse.value).toBe(testValue);
    });

    it('should reconnect and process queued messages after disconnection', async () => {
      const testKey = generateTestKey('reconnect-queue');
      await apiClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );

      // Setup disconnection event tracking
      let disconnectedFired = false;
      let reconnectingFired = false;
      let connectedAgainFired = false;

      subscriptionClient.on('disconnected', () => {
        disconnectedFired = true;
      });

      subscriptionClient.on('reconnecting', () => {
        reconnectingFired = true;
      });

      subscriptionClient.on('connected', () => {
        if (disconnectedFired) {
          connectedAgainFired = true;
        }
      });

      // Connect initially
      await subscriptionClient.connect();

      // Give some time for connection to establish fully
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // Force disconnect but do not cancel pending requests
      await subscriptionClient.disconnect(false);

      // Wait for disconnect to complete - increasing timeout
      await new Promise(resolve => safeSetTimeout(resolve, 500));
      expect(disconnectedFired).toBe(true);

      // Send a message while disconnected - should reconnect automatically
      const response = await subscriptionClient.set(testKey, 'reconnected-value');

      // Verify reconnection events and successful operation
      expect(reconnectingFired || connectedAgainFired).toBe(true);
      expect(response.code).toBe(200);

      // Get the value to confirm it was set correctly
      const getResponse = await subscriptionClient.get(testKey);
      expect(getResponse.value).toBe('reconnected-value');
    });

    it('should process multiple queued operations in order', async () => {
      const testKey = generateTestKey('multiple-queue');
      await apiClient.set(testKey, 'initial-value');

      const token = await tokenManager.generateToken({
        subscribeKeys: [testKey],
        accessPattern: `${TEST_KEY_PREFIX}*`,
      });

      const subscriptionClient = trackClient(
        HPKVClientFactory.createSubscriptionClient(token, BASE_URL)
      );

      // Connect and then disconnect
      await subscriptionClient.connect();
      await subscriptionClient.disconnect(false);

      // Wait for disconnect to complete
      await new Promise(resolve => safeSetTimeout(resolve, 100));

      // Queue multiple operations while disconnected
      const setPromise1 = subscriptionClient.set(testKey, 'value-1');
      const setPromise2 = subscriptionClient.set(testKey, 'value-2');
      const setPromise3 = subscriptionClient.set(testKey, 'value-3');

      // Wait for all operations to complete
      await Promise.all([setPromise1, setPromise2, setPromise3]);

      // The final value should be the last one set
      const getResponse = await subscriptionClient.get(testKey);
      expect(getResponse.value).toBe('value-3');

      // All responses should have been successful
      const responses = await Promise.all([setPromise1, setPromise2, setPromise3]);
      responses.forEach(response => {
        expect(response.code).toBe(200);
      });
    });
  });
});

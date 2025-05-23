/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/// <reference types="jest" />

import { ConnectionError, HPKVClientFactory, HPKVError } from '../../src';
import { HPKVApiClient } from '../../src/clients/api-client';
import dotenv from 'dotenv';
import { jest, expect, describe, it, beforeAll, afterAll } from '@jest/globals';

dotenv.config();

const API_KEY = process.env.HPKV_API_KEY || '';
const BASE_URL = process.env.HPKV_API_BASE_URL || '';
const TEST_KEY_PREFIX = 'api-test-';

describe('HPKVApiClient Integration Tests', () => {
  const keysToCleanup: string[] = [];
  function generateTestKey(testName: string): string {
    const key = `${TEST_KEY_PREFIX}${testName}-${Date.now()}`;
    keysToCleanup.push(key);
    return key;
  }

  let originalWebSocket: typeof global.WebSocket;

  beforeAll(() => {
    // Set global.WebSocket to undefined to force the use of the Node.js WebSocket implementation
    originalWebSocket = global.WebSocket;
    global.WebSocket = undefined as unknown as typeof global.WebSocket;
  });

  afterAll(async () => {
    const cleanupClient = HPKVClientFactory.createApiClient(API_KEY, BASE_URL, {
      throttling: { enabled: true, rateLimit: 30 },
    });
    try {
      await cleanupClient.connect();

      for (const key of keysToCleanup) {
        try {
          await cleanupClient.delete(key);
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
      await cleanupClient.disconnect();
      cleanupClient.destroy();
    }

    global.WebSocket = originalWebSocket;
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      await client.connect();
      expect(client.getConnectionStats().isConnected).toBe(true);
      await client.disconnect();
      client.destroy();
    });

    it('should handle multiple concurrent connect attempts', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      const connectPromise = client.connect();
      const connectPromise2 = client.connect();
      await connectPromise;
      await connectPromise2;
      expect(client.getConnectionStats().isConnected).toBe(true);
      await client.disconnect();
      client.destroy();
    });

    it('should disconnect successfully', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      await client.connect();
      await client.disconnect();
      expect(client.getConnectionStats().isConnected).toBe(false);
      client.destroy();
    });

    it('should handle multiple concurrent disconnect attempts', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      await client.connect();
      const disconnectPromise = client.disconnect();
      const disconnectPromise2 = client.disconnect();
      await disconnectPromise;
      await disconnectPromise2;
      expect(client.getConnectionStats().isConnected).toBe(false);
      client.destroy();
    });

    it('should invoke connect and disconnect event handlers when connection state changes', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      const onConnected = jest.fn();
      const onDisconnected = jest.fn();
      client.on('connected', onConnected);
      await client.connect();
      expect(onConnected).toHaveBeenCalled();
      client.on('disconnected', onDisconnected);
      await client.disconnect();
      expect(onDisconnected).toHaveBeenCalled();
      client.destroy();
    });

    it('should invoke error event handler when connection fails', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, 'invalid-url');
      const onError = jest.fn();
      client.on('error', onError);
      await expect(client.connect()).rejects.toThrow(ConnectionError);
      expect(onError).toHaveBeenCalled();
      client.destroy();
    });
  });

  describe('CRUD Operations', () => {
    let client: HPKVApiClient;
    beforeAll(async () => {
      client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL, {
        throttling: { enabled: true, rateLimit: 30 },
      });
      await client.connect();
    });
    afterAll(async () => {
      await client.disconnect();
      client.destroy();
    });
    it('should set and get a value', async () => {
      const testKey = generateTestKey('set-get');
      const testValue = 'set-get-test-value';

      const setResponse = await client.set(testKey, testValue);
      expect(setResponse.success).toBe(true);
      expect(setResponse.code).toBe(200);

      const getResponse = await client.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe(testValue);
    });

    it('should allow setting an object as a value', async () => {
      const testKey = generateTestKey('set-object');
      const testValue = { name: 'test', value: 123 };
      const setResponse = await client.set(testKey, testValue);
      expect(setResponse.success).toBe(true);
      expect(setResponse.code).toBe(200);

      const getResponse = await client.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(JSON.parse(getResponse.value as string).name).toBe('test');
      expect(JSON.parse(getResponse.value as string).value).toBe(123);
    });

    it('should delete a value', async () => {
      const testKey = generateTestKey('delete');
      const testValue = 'delete-test-value';
      await client.set(testKey, testValue);

      const deleteResponse = await client.delete(testKey);
      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.code).toBe(200);

      await expect(client.get(testKey)).rejects.toThrow(HPKVError);
      await expect(client.get(testKey)).rejects.toHaveProperty('code', 404);
    });

    it('should patch a value', async () => {
      const testKey = generateTestKey('patch');
      const initialValue = { name: 'test', value: 123 };
      const patchValue = { value: 456, newField: 'new-field' };
      await client.set(testKey, initialValue);

      const patchResponse = await client.set(testKey, patchValue, true);
      expect(patchResponse.code).toBe(200);
      expect(patchResponse.success).toBe(true);

      const getResponse = await client.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(JSON.parse(getResponse.value as string).name).toBe('test');
      expect(JSON.parse(getResponse.value as string).value).toBe(456);
      expect(JSON.parse(getResponse.value as string).newField).toBe('new-field');
    });

    it('should perform range queries', async () => {
      const keyPrefix = 'testing-range';

      await client.set(`${keyPrefix}-1`, 'value1');
      await client.set(`${keyPrefix}-2`, 'value2');
      await client.set(`${keyPrefix}-3`, 'value3');
      keysToCleanup.push(`${keyPrefix}-1`, `${keyPrefix}-2`, `${keyPrefix}-3`);

      const rangeResponse = await client.range(`${keyPrefix}-1`, `${keyPrefix}-3`);

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(3);
      expect(rangeResponse.records?.[0].key).toBe(`${keyPrefix}-1`);
      expect(rangeResponse.records?.[1].key).toBe(`${keyPrefix}-2`);
      expect(rangeResponse.records?.[2].key).toBe(`${keyPrefix}-3`);
    });

    it('should limit range query results when limit is provided', async () => {
      const keyPrefix = 'testing-range-limit';
      await client.set(`${keyPrefix}-1`, 'value1');
      await client.set(`${keyPrefix}-2`, 'value2');
      await client.set(`${keyPrefix}-3`, 'value3');
      keysToCleanup.push(`${keyPrefix}-1`, `${keyPrefix}-2`, `${keyPrefix}-3`);

      const rangeResponse = await client.range(`${keyPrefix}-1`, `${keyPrefix}-3`, { limit: 2 });

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(2);
    });

    it('should perform atomic increment', async () => {
      const counterKey = generateTestKey('atomic-increment');

      let incrementResponse = await client.atomicIncrement(counterKey, 1);
      expect(incrementResponse.code).toBe(200);
      expect(incrementResponse.success).toBe(true);
      expect(incrementResponse.newValue).toBe(1);
      incrementResponse = await client.atomicIncrement(counterKey, 5);
      expect(incrementResponse.code).toBe(200);
      expect(incrementResponse.success).toBe(true);
      expect(incrementResponse.newValue).toBe(6);
    });
  });

  describe('Error Handling', () => {
    let client: HPKVApiClient;
    beforeAll(async () => {
      client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      await client.connect();
    });
    afterAll(async () => {
      await client.disconnect();
      client.destroy();
    });
    it('should throw not found error when getting non-existent keys', async () => {
      const nonExistentKey = generateTestKey('non-existent');
      await expect(client.get(nonExistentKey)).rejects.toThrow(HPKVError);
      await expect(client.get(nonExistentKey)).rejects.toHaveProperty('code', 404);
    });

    it('should throw not founderror when deleting non-existent keys', async () => {
      const nonExistentKey = generateTestKey('non-existent');
      await expect(client.delete(nonExistentKey)).rejects.toThrow(HPKVError);
      await expect(client.delete(nonExistentKey)).rejects.toHaveProperty('code', 404);
    });

    it('should throw 400 error when using empty key', async () => {
      await expect(client.set('', 'value')).rejects.toThrow(HPKVError);
      await expect(client.set('', 'value')).rejects.toHaveProperty('code', 400);
    });
    it('should throw 400 error when using empty value', async () => {
      const testKey = generateTestKey('empty-value');
      await expect(client.set(testKey, '')).rejects.toThrow(HPKVError);
      await expect(client.set(testKey, '')).rejects.toHaveProperty('code', 400);
    });
    it('should throw connection error when client is not connected', async () => {
      const disconnectedClient = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      const testKey = generateTestKey('connection-error');
      await expect(disconnectedClient.set(testKey, 'value')).rejects.toThrow(
        'WebSocket is not open'
      );
      disconnectedClient.destroy();
    });
  });

  describe('Throttling', () => {
    it('should respect rate limits when throttling is enabled', async () => {
      const rateLimit = 3;
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL, {
        throttling: {
          enabled: true,
          rateLimit,
        },
      });

      try {
        await client.connect();

        const testKey = generateTestKey('throttle-test');
        const testValue = 'throttle-test-value';

        // Set up an array to track request completion times
        const completionTimes: number[] = [];

        // Make multiple requests in quick succession
        const requestCount = 10;
        const operations = Array(requestCount)
          .fill(null)
          .map((_, index) => {
            return async () => {
              // Alternate between set and get operations
              if (index % 2 === 0) {
                await client.set(`${testKey}-${index}`, `${testValue}-${index}`);
                keysToCleanup.push(`${testKey}-${index}`);
              } else {
                try {
                  await client.get(`${testKey}-${index - 1}`);
                } catch (error) {
                  console.error('Error getting key:', error);
                }
              }
              completionTimes.push(Date.now());
            };
          });

        // Execute all operations
        await Promise.all(operations.map(op => op()));

        // Calculate time differences between consecutive requests
        const timeDifferences: number[] = [];
        for (let i = 1; i < completionTimes.length; i++) {
          timeDifferences.push(completionTimes[i] - completionTimes[i - 1]);
        }

        // Calculate requests per second
        const totalTimeMs = completionTimes[completionTimes.length - 1] - completionTimes[0];
        const totalTimeSeconds = totalTimeMs / 1000;
        const requestsPerSecond = (requestCount - 1) / totalTimeSeconds;

        // The requests per second should not exceed the rate limit
        // Add some margin for timing variations
        expect(requestsPerSecond).toBeLessThanOrEqual(rateLimit * 1.1);

        // If throttling is working, we expect to see some minimal spacing between requests
        // Check that not all requests happened instantly
        const hasThrottledRequests = timeDifferences.some(diff => diff > 50); // At least some requests should have a gap
        expect(hasThrottledRequests).toBe(true);
      } finally {
        await client.disconnect();
        client.destroy();
      }
    });

    it('should not throttle when throttling is disabled', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL, {
        throttling: {
          enabled: false,
          rateLimit: 10,
        },
      });

      try {
        await client.connect();

        const testKey = generateTestKey('no-throttle-test');
        const testValue = 'no-throttle-test-value';

        // Set up an array to track request start and completion times
        const startTimes: number[] = [];
        const completionTimes: number[] = [];

        // Make several requests in quick succession
        const requestCount = 5;
        const operations = Array(requestCount)
          .fill(null)
          .map((_, index) => {
            return async () => {
              startTimes.push(Date.now());
              await client.set(`${testKey}-${index}`, `${testValue}-${index}`);
              completionTimes.push(Date.now());
              keysToCleanup.push(`${testKey}-${index}`);
            };
          });

        // Execute all operations
        await Promise.all(operations.map(op => op()));

        // Calculate time differences between consecutive request starts
        const timeDifferences: number[] = [];
        for (let i = 1; i < startTimes.length; i++) {
          timeDifferences.push(startTimes[i] - startTimes[i - 1]);
        }

        // With throttling disabled, requests should start very close to each other
        // Check that most requests started with minimal delay
        const quickStartRequests = timeDifferences.filter(diff => diff < 20).length;
        const duration = completionTimes[completionTimes.length - 1] - startTimes[0];
        expect(quickStartRequests).toBeGreaterThan(requestCount / 2);
        expect(duration).toBeLessThan(1000);
      } finally {
        await client.disconnect();
        client.destroy();
      }
    });
  });

  describe('Reconnection Handling', () => {
    it('should attempt to reconnect and succeed after an unexpected disconnection', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL, {
        maxReconnectAttempts: 3,
        initialDelayBetweenReconnects: 200,
        maxDelayBetweenReconnects: 1000,
      });

      try {
        const onReconnecting = jest.fn();
        const onConnected = jest.fn();
        const onDisconnected = jest.fn();
        const onReconnectFailed = jest.fn();

        client.on('reconnecting', onReconnecting);
        client.on('connected', onConnected);
        client.on('disconnected', onDisconnected);
        client.on('reconnectFailed', onReconnectFailed);

        await client.connect();
        expect(client.getConnectionStats().isConnected).toBe(true);
        const initialConnectionEventCount = onConnected.mock.calls.length;
        expect(initialConnectionEventCount).toBe(1);

        const internalWs = (client as unknown as { ws: import('ws').WebSocket }).ws as
          | import('ws').WebSocket
          | null;
        if (internalWs) {
          const rawSocket = (internalWs as any)._socket || (internalWs as any).socket || internalWs;
          if (rawSocket && typeof rawSocket.terminate === 'function') {
            rawSocket.terminate();
          } else if (typeof internalWs.close === 'function') {
            internalWs.close(1002, 'Test-induced abrupt disconnect');
          } else {
            throw new Error(
              'Client internal WebSocket instance not found or no means to close/terminate.'
            );
          }
        } else {
          throw new Error('Client internal NodeWebSocket adapter not found.');
        }

        await new Promise<void>((resolve, reject) => {
          const checkEvents = (): void => {
            if (onDisconnected.mock.calls.length > 0 && onReconnecting.mock.calls.length > 0) {
              resolve();
            } else if (onReconnectFailed.mock.calls.length > 0) {
              reject(
                new Error('Reconnect failed prematurely while waiting for reconnecting event.')
              );
            }
          };

          client.on('disconnected', checkEvents);
          client.on('reconnecting', checkEvents);
          client.on('reconnectFailed', checkEvents);

          setTimeout(
            () => reject(new Error('Timeout waiting for disconnected/reconnecting events.')),
            3000
          );
          checkEvents();
        });

        expect(onDisconnected).toHaveBeenCalled();
        expect(onReconnecting).toHaveBeenCalled();

        await new Promise<void>((resolve, reject) => {
          const checkReconnected = (): void => {
            if (onConnected.mock.calls.length > initialConnectionEventCount) {
              resolve();
            } else if (onReconnectFailed.mock.calls.length > 0) {
              reject(new Error('Reconnect failed while waiting for re-established connection.'));
            }
          };

          client.on('connected', checkReconnected);
          client.on('reconnectFailed', checkReconnected);

          setTimeout(
            () => reject(new Error('Timeout waiting for re-established connection.')),
            10000
          );
          checkReconnected();
        });

        expect(onConnected.mock.calls.length).toBeGreaterThan(initialConnectionEventCount);
        expect(client.getConnectionStats().isConnected).toBe(true);
        expect(onReconnectFailed).not.toHaveBeenCalled();

        const testKey = generateTestKey('reconnect-op');
        const testValue = 'reconnect-op-value';
        const setResponse = await client.set(testKey, testValue);
        expect(setResponse.success).toBe(true);
        expect(setResponse.code).toBe(200);
      } finally {
        if (client) {
          await client.disconnect();
          client.destroy();
        }
      }
    }, 20000);
  });
});

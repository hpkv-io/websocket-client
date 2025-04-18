/// <reference types="jest" />
import { HPKVClientFactory } from '../src';
import { HPKVApiClient } from '../src/clients/api-client';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.HPKV_API_KEY || '';
const BASE_URL = process.env.HPKV_API_BASE_URL || '';
const TEST_KEY_PREFIX = 'api-test-';

describe('HPKVApiClient Integration Tests', () => {
  let apiClient: HPKVApiClient;
  const keysToCleanup: string[] = [];

  // Helper to generate unique test keys
  function generateTestKey(testName: string): string {
    const key = `${TEST_KEY_PREFIX}${testName}-${Date.now()}`;
    keysToCleanup.push(key);
    return key;
  }

  beforeAll(() => {
    apiClient = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
  });

  afterAll(async () => {
    try {
      // Ensure we're connected for cleanup
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
      await apiClient.disconnect();
      if (typeof apiClient.destroy === 'function') {
        apiClient.destroy();
      }
    }
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      await client.connect();
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
  });

  describe('CRUD Operations', () => {
    it('should set and get a value', async () => {
      const testKey = generateTestKey('set-get');
      const testValue = 'set-get-test-value';
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      // Set a value
      const setResponse = await client.set(testKey, testValue);
      expect(setResponse.success).toBe(true);
      expect(setResponse.code).toBe(200);

      // Get the value
      const getResponse = await client.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(getResponse.value).toBe(testValue);
      await client.disconnect();
      client.destroy();
    });

    it('should delete a value', async () => {
      const testKey = generateTestKey('delete');
      const testValue = 'delete-test-value';
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      // First ensure the key exists
      await client.set(testKey, testValue);

      // Delete the value
      const deleteResponse = await client.delete(testKey);
      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.code).toBe(200);

      // Verify it's deleted - should throw an error
      try {
        await client.get(testKey);
        fail('Expected an error to be thrown when getting a deleted key');
      } catch (error) {
        expect(error).toBeDefined();
      }
      await client.disconnect();
      client.destroy();
    });

    it('should patch a value', async () => {
      const testKey = generateTestKey('patch');
      const initialValue = { name: 'test', value: 123 };
      const patchValue = { value: 456 };
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      // Set initial value
      await client.set(testKey, initialValue);

      // Patch the value
      const patchResponse = await client.set(testKey, patchValue, true);
      expect(patchResponse.code).toBe(200);
      expect(patchResponse.success).toBe(true);

      // Verify the patched value
      const getResponse = await client.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(JSON.parse(getResponse.value as string).value).toBe(456);
      await client.disconnect();
      client.destroy();
    });

    it('should perform range queries', async () => {
      const keyPrefix = generateTestKey('range');
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      // Set multiple values with sequential keys
      await client.set(`${keyPrefix}-1`, 'value1');
      await client.set(`${keyPrefix}-2`, 'value2');
      await client.set(`${keyPrefix}-3`, 'value3');

      // Add these keys to cleanup
      keysToCleanup.push(`${keyPrefix}-1`, `${keyPrefix}-2`, `${keyPrefix}-3`);

      // Query the range
      const rangeResponse = await client.range(`${keyPrefix}-1`, `${keyPrefix}-3`);

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(3);
      await client.disconnect();
      client.destroy();
    });

    it('should limit range query results when limit is provided', async () => {
      const keyPrefix = generateTestKey('range-limit');
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      // Set multiple values with sequential keys
      await client.set(`${keyPrefix}-1`, 'value1');
      await client.set(`${keyPrefix}-2`, 'value2');
      await client.set(`${keyPrefix}-3`, 'value3');

      // Add these keys to cleanup
      keysToCleanup.push(`${keyPrefix}-1`, `${keyPrefix}-2`, `${keyPrefix}-3`);

      // Query the range with limit
      const rangeResponse = await client.range(`${keyPrefix}-1`, `${keyPrefix}-3`, { limit: 2 });

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(2);
      await client.disconnect();
      client.destroy();
    });

    it('should perform atomic increment', async () => {
      const counterKey = generateTestKey('atomic-increment');
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      await client.set(counterKey, '0');

      const incrementResponse = await client.atomicIncrement(counterKey, 1);
      expect(incrementResponse.code).toBe(200);

      const getResponse = await client.get(counterKey);
      expect(getResponse.code).toBe(200);
      expect(parseInt(getResponse.value as string)).toBe(1);
      await client.disconnect();
      client.destroy();
    });
  });

  describe('Error Handling', () => {
    it('should throw error when getting non-existent keys', async () => {
      const nonExistentKey = generateTestKey('non-existent');
      // Don't set this key, just try to get it
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      try {
        await client.get(nonExistentKey);
        fail('Expected an error to be thrown when getting a non-existent key');
      } catch (error) {
        expect(error).toBeDefined();
      }
      await client.disconnect();
      client.destroy();
    });

    it('should handle malformed API requests', async () => {
      const client = HPKVClientFactory.createApiClient(API_KEY, BASE_URL);
      try {
        // Attempt to use invalid key format

        await client.set('', 'value');
        fail('Expected an error but none was thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
      await client.disconnect();
      client.destroy();
    });
  });
});

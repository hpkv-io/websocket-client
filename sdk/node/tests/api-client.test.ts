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
      apiClient.disconnect();
    }
  });

  describe('Connection Management', () => {
    it('should connect successfully', async () => {
      await apiClient.connect();
      expect(apiClient.getConnectionStatus()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await apiClient.connect();
      apiClient.disconnect();
      expect(apiClient.getConnectionStatus()).toBe(false);

      // Reconnect for further tests
      await apiClient.connect();
    });
  });

  describe('CRUD Operations', () => {
    it('should set and get a value', async () => {
      const testKey = generateTestKey('set-get');
      const testValue = 'set-get-test-value';

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
      const testKey = generateTestKey('delete');
      const testValue = 'delete-test-value';

      // First ensure the key exists
      await apiClient.set(testKey, testValue);

      // Delete the value
      const deleteResponse = await apiClient.delete(testKey);
      expect(deleteResponse.success).toBe(true);
      expect(deleteResponse.code).toBe(200);

      // Verify it's deleted - should throw an error
      try {
        await apiClient.get(testKey);
        fail('Expected an error to be thrown when getting a deleted key');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should patch a value', async () => {
      const testKey = generateTestKey('patch');
      const initialValue = { name: 'test', value: 123 };
      const patchValue = { value: 456 };

      // Set initial value
      await apiClient.set(testKey, initialValue);

      // Patch the value
      const patchResponse = await apiClient.set(testKey, patchValue, true);
      expect(patchResponse.code).toBe(200);
      expect(patchResponse.success).toBe(true);

      // Verify the patched value
      const getResponse = await apiClient.get(testKey);
      expect(getResponse.code).toBe(200);
      expect(JSON.parse(getResponse.value as string).value).toBe(456);
    });

    it('should perform range queries', async () => {
      const keyPrefix = generateTestKey('range');

      // Set multiple values with sequential keys
      await apiClient.set(`${keyPrefix}-1`, 'value1');
      await apiClient.set(`${keyPrefix}-2`, 'value2');
      await apiClient.set(`${keyPrefix}-3`, 'value3');

      // Add these keys to cleanup
      keysToCleanup.push(`${keyPrefix}-1`, `${keyPrefix}-2`, `${keyPrefix}-3`);

      // Query the range
      const rangeResponse = await apiClient.range(`${keyPrefix}-1`, `${keyPrefix}-3`);

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(3);
    });

    it('should limit range query results when limit is provided', async () => {
      const keyPrefix = generateTestKey('range-limit');

      // Set multiple values with sequential keys
      await apiClient.set(`${keyPrefix}-1`, 'value1');
      await apiClient.set(`${keyPrefix}-2`, 'value2');
      await apiClient.set(`${keyPrefix}-3`, 'value3');

      // Add these keys to cleanup
      keysToCleanup.push(`${keyPrefix}-1`, `${keyPrefix}-2`, `${keyPrefix}-3`);

      // Query the range with limit
      const rangeResponse = await apiClient.range(`${keyPrefix}-1`, `${keyPrefix}-3`, { limit: 2 });

      expect(rangeResponse.code).toBe(200);
      expect(Array.isArray(rangeResponse.records)).toBe(true);
      expect(rangeResponse.records?.length).toBe(2);
    });

    it('should perform atomic increment', async () => {
      const counterKey = generateTestKey('atomic-increment');
      await apiClient.set(counterKey, '0');

      const incrementResponse = await apiClient.atomicIncrement(counterKey, 1);
      expect(incrementResponse.code).toBe(200);

      const getResponse = await apiClient.get(counterKey);
      expect(getResponse.code).toBe(200);
      expect(parseInt(getResponse.value as string)).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when getting non-existent keys', async () => {
      const nonExistentKey = generateTestKey('non-existent');
      // Don't set this key, just try to get it

      try {
        await apiClient.get(nonExistentKey);
        fail('Expected an error to be thrown when getting a non-existent key');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle malformed API requests', async () => {
      try {
        // Attempt to use invalid key format
        await apiClient.set('', 'value');
        fail('Expected an error but none was thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});

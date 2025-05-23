# HPKV WebSocket Client for Node.js

[![npm version](https://img.shields.io/npm/v/@hpkv/websocket-client.svg)](https://www.npmjs.com/package/@hpkv/websocket-client)
[![npm downloads](https://img.shields.io/npm/dm/@hpkv/websocket-client.svg)](https://www.npmjs.com/package/@hpkv/websocket-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./License)

This is the official Node.js client for the HPKV WebSocket API, providing high-performance access to HPKV's real-time key-value store capabilities.

For more details, refer to the [SDK Documentation Page](https://hpkv.io/docs/sdk-guides)

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Subscription Client](#subscription-client)
- [Error Handling](#error-handling)
- [Request Throttling](#request-throttling)
  - [Key Throttling Features](#key-throttling-features)
  - [Configuring Throttling](#configuring-throttling)
  - [Monitoring Throttling Metrics](#monitoring-throttling-metrics)
- [Connection Management](#connection-management)
  - [Connection Features](#connection-features)
  - [Connection Lifecycle Events](#connection-lifecycle-events)
  - [Connection Configuration](#connection-configuration)
  - [Monitoring Connection State](#monitoring-connection-state)
- [Reference](#reference)
  - [Core Classes](#core-classes)
  - [Key Types and Interfaces](#key-types-and-interfaces)
- [Response Types](#response-types)
- [License](#license)

## Features

- WebSocket-based communication for low-latency operations
- Automatic reconnection with exponential backoff
- Support for key monitoring (pub-sub) for real-time updates
- Request throttling
- Support for atomic operations
- Range queries for efficient data retrieval
- Robust error handling and type safety

## Installation

```bash
npm install @hpkv/websocket-client
```

## Quick Start

```javascript
import { HPKVClientFactory } from '@hpkv/websocket-client';

// Create an API client for server-side operations
const apiClient = HPKVClientFactory.createApiClient(
  'your-api-key',
  'your-api-base-url',
);

// Connect to the HPKV service
await apiClient.connect();

// Store a value
await apiClient.set('user:123', { name: 'John', age: 30 });

// Retrieve a value
const response = await apiClient.get('user:123');
console.log(response.value); // '{"name":"John","age":30}'

// Update a value (JSON patch)
await apiClient.set('user:123', { city: 'New York' }, true);

// Delete a value
await apiClient.delete('user:123');

// Range query
const users = await apiClient.range('user:', 'user:~');
console.log(users.records); // Array of user records

// Atomic increment
const counter = await apiClient.atomicIncrement('visits:page1', 1);
console.log(counter.newValue); // Current counter value

// Close connection when done
await apiClient.disconnect();
```

## Subscription Client

For real-time updates on key changes:

```javascript
import { HPKVClientFactory } from '@hpkv/websocket-client';

// First gnerate a token to be used for connection to websocket with subscription to provided changes.
const tokenManager = new WebsocketTokenManager(API_KEY, BASE_URL);

const token = await tokenManager.generateToken({
        subscribeKeys: ['product:headphone:modelA','product:headphone:modelB'], // subscribe to changes in the value of headphone models A and B
        accessPattern: `^product:*$`,// to allow CRUD operations on all product keys
      });

// Create a subscription client for real-time updates
const subscriptionClient = HPKVClientFactory.createSubscriptionClient(
  'your-subscription-token',
  'your-api-base-url',
);

// Connect to the service
await subscriptionClient.connect();

// Subscribe to changes in the headphone keys
const subscriptionId = subscriptionClient.subscribe((notification) => {
  console.log(`Key ${notification.key} changed to ${notification.value}`);
  
  // Value is null if the key was deleted
  if (notification.value === null) {
    console.log(`Key ${notification.key} was deleted`);
  }
});

// This get operation will succeed as the key starts with 'product:'
await subscriptionClient.get('product:phone:modelA')

// This get operation will fail as the key does not start with 'product:'
await subscriptionClient.get('order:1') 

// Later, unsubscribe when no longer needed
subscriptionClient.unsubscribe(subscriptionId);

// Disconnect when done
await subscriptionClient.disconnect();
```

## Error Handling

All operations can throw exceptions for network issues, timeouts, or server errors:

```javascript
try {
  const result = await apiClient.get('nonexistent-key');
  console.log(result.value);
} catch (error) {
  if (error.code === 404) {
    console.error('Key not found');
  } else {
    console.error('Operation failed:', error.message);
  }
}
```

## Request Throttling

The HPKV WebSocket client includes a request throttling system to help manage request rates and prevent overwhelming the server.

### Key Throttling Features

- **Rate Limiting**: Enforces a maximum number of requests per second.
- **Exponential Backoff**: Handles 429 (Too Many Requests) responses with intelligent retry logic, reducing the request rate when signaled by the server.
- **Queue Management**: Queues requests when the rate limit is exceeded, processing them as slots become available according to the limit.
- **Configurable Limits**: Customize throttling behavior to match your application needs.

### Configuring Throttling

```javascript
const apiClient = HPKVClientFactory.createApiClient('your-api-key', 'your-api-base-url', {
  throttling: {
    enabled: true,       // Enable/disable throttling (default: true)
    rateLimit: 10        // Default rate limit in requests per second
  }
});

// Later, update throttling configuration
apiClient.updateThrottlingConfig({
  enabled: true,
  rateLimit: 20          // Increase rate limit to 20 requests per second
});
```

### Monitoring Throttling Metrics

```javascript
// Get detailed throttling metrics
const status = apiClient.getThrottlingStatus();
console.log(`Current allowed rate: ${status.metrics.currentRate} req/sec`);
console.log(`Queue length: ${status.metrics.queueLength}`);
```

The throttling system queues requests if they exceed the `currentRate`. When the server returns a 429 response, the client significantly reduces the `currentRate` and applies exponential backoff, gradually increasing the rate back towards the configured `rateLimit` once the backoff period expires.

## Connection Management

The HPKV WebSocket client implements robust connection management with automatic reconnection capabilities:

### Connection Features

- **Automatic Reconnection**: Handles network disruptions with exponential backoff
- **Connection Events**: Subscribe to connection lifecycle events
- **Connection Statistics**: Monitor connection health and performance
- **Configurable Retry Logic**: Customize reconnection behavior

### Connection Lifecycle Events

```javascript
// Subscribe to connection events
apiClient.on('connected', () => {
  console.log('Connected to HPKV service');
});

apiClient.on('disconnected', (details) => {
  console.log(`Disconnected: ${details.reason}`);
});

apiClient.on('reconnecting', (attempt) => {
  console.log(`Reconnection attempt ${attempt.attempt}/${attempt.maxAttempts}`);
});

apiClient.on('reconnectFailed', (error) => {
  console.error('Failed to reconnect after multiple attempts:', error.message);
});

apiClient.on('error', (error) => {
  console.error('Connection error:', error.message);
});
```

### Connection Configuration

```javascript
const apiClient = HPKVClientFactory.createApiClient('your-api-key', 'your-api-base-url', {
  // Reconnection settings
  maxReconnectAttempts: 5,                 // Maximum reconnection attempts
  initialDelayBetweenReconnects: 1000,     // Initial delay in ms
  maxDelayBetweenReconnects: 30000,        // Maximum delay in ms
});
```

### Monitoring Connection State

```javascript
// Get current connection statistics
const stats = apiClient.getConnectionStats();
console.log(`Connected: ${stats.isConnected}`);
console.log(`State: ${stats.connectionState}`);
console.log(`Reconnect attempts: ${stats.reconnectAttempts}`);
console.log(`Pending messages: ${stats.messagesPending}`);

// Log throttling info if enabled
if (stats.throttling) {
  console.log(`Throttling Rate: ${stats.throttling.currentRate} req/sec`);
  console.log(`Throttling Queue: ${stats.throttling.queueLength}`);
}
```

## Reference

### Core Classes

#### `HPKVClientFactory`

Factory class for creating API and subscription clients.

| Method | Description |
| ------ | ----------- |
| `createApiClient(apiKey, baseUrl, config?)` | Creates a client for server-side operations using an API key |
| `createSubscriptionClient(token, baseUrl, config?)` | Creates a client for subscription-based operations using a token |

#### `BaseWebSocketClient`

Abstract base class for WebSocket communication with the HPKV service.

| Method | Description |
| ------ | ----------- |
| `connect()` | Establishes a WebSocket connection |
| `disconnect(cancelPendingRequests?)` | Closes the WebSocket connection |
| `get(key, timeoutMs?)` | Retrieves a value from the store |
| `set(key, value, partialUpdate?, timeoutMs?)` | Stores or updates a value |
| `delete(key, timeoutMs?)` | Deletes a value |
| `range(key, endKey, options?, timeoutMs?)` | Performs a range query |
| `atomicIncrement(key, value, timeoutMs?)` | Performs an atomic increment operation |
| `on(event, listener)` | Registers an event listener |
| `off(event, listener)` | Removes an event listener |
| `getConnectionState()` | Returns the current connection state |
| `getConnectionStats()` | Returns statistics about the connection |
| `getThrottlingStatus()` | Returns throttling configuration and metrics (current rate, queue length) |
| `updateThrottlingConfig(config)` | Updates the throttling configuration |

#### `HPKVApiClient`

Client for performing CRUD operations with API key authentication.

- Extends `BaseWebSocketClient` with API key authentication
- Used for server-side operations with full read/write access

#### `HPKVSubscriptionClient`

Client for subscribing to real-time updates using token authentication.

| Method | Description |
| ------ | ----------- |
| `subscribe(callback)` | Subscribes to changes with the provided callback |
| `unsubscribe(callbackId)` | Unsubscribes a callback |

#### `WebsocketTokenManager`

Utility for generating authentication tokens for WebSocket connections.

| Method | Description |
| ------ | ----------- |
| `generateToken(config)` | Generates an authentication token for subscription access |

### Key Types and Interfaces

This section details key exported types and interfaces you'll work with when using the SDK.

#### `ConnectionConfig`

Configuration options for the WebSocket connection.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `maxReconnectAttempts` | `number` | Maximum number of reconnection attempts |
| `initialDelayBetweenReconnects` | `number` | Initial delay between reconnection attempts (ms) |
| `maxDelayBetweenReconnects` | `number` | Maximum delay between reconnection attempts (ms) |
| `connectionTimeout` | `number` | Timeout for connection attempts (ms) |
| `throttling` | `ThrottlingConfig` | Configuration for request throttling |

#### `ThrottlingConfig`

Configuration for the throttling mechanism.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `enabled` | `boolean` | Whether throttling is enabled |
| `rateLimit` | `number` | Maximum requests per second |

#### `HPKVTokenConfig`

Configuration for generating authentication tokens.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `subscribeKeys` | `string[]` | Keys the token can subscribe to |
| `accessPattern` | `string` | Optional regex pattern for key access control |

#### `ConnectionState`

Enum representing the connection state.

| Value | Description |
| ----- | ----------- |
| `DISCONNECTED` | Not connected |
| `CONNECTING` | Connection in progress |
| `CONNECTED` | Successfully connected |
| `DISCONNECTING` | Disconnection in progress |

#### `ConnectionStats`

Interface representing connection statistics.

| Property | Type | Description |
| -------- | ---- | ----------- |
| `isConnected` | `boolean` | Whether the client is currently connected |
| `reconnectAttempts` | `number` | Number of reconnect attempts since the last successful connection |
| `messagesPending` | `number` | Number of messages awaiting a response |
| `connectionState` | `string` (`ConnectionState` enum) | Current state of the connection |
| `throttling` | `object \| null` | Throttling metrics if enabled (contains `currentRate`, `queueLength`) |

#### `HPKVResponse`

Union type for all possible response types from the HPKV service. Most responses may include an optional `messageId` (number, linking back to the request) and `code` (number, often an HTTP-like status code).

- **`HPKVGetResponse`**: Response for GET operations.
  ```typescript
  interface HPKVGetResponse {
    key: string;
    value: string | number;
    code?: number;
    messageId?: number;
  }
  ```

- **`HPKVSetResponse`**: Response for SET operations.
  ```typescript
  interface HPKVSetResponse {
    success: boolean;
    message?: string;
    code?: number;
    messageId?: number;
  }
  ```

- **`HPKVPatchResponse`**: Response for PATCH operations (partial updates). Typically similar to `HPKVSetResponse`.
  ```typescript
  interface HPKVPatchResponse {
    success: boolean;
    message?: string;
    code?: number;
    messageId?: number;
  }
  ```

- **`HPKVDeleteResponse`**: Response for DELETE operations.
  ```typescript
  interface HPKVDeleteResponse {
    success: boolean;
    message?: string;
    code?: number;
    messageId?: number;
  }
  ```

- **`HPKVRangeResponse`**: Response for RANGE operations.
  ```typescript
  interface HPKVRangeRecord {
    key: string;
    value: string | number;
  }
  interface HPKVRangeResponse {
    records: HPKVRangeRecord[];
    code?: number;
    messageId?: number;
  }
  ```

- **`HPKVAtomicResponse`**: Response for ATOMIC operations (e.g., increment).
  ```typescript
  interface HPKVAtomicResponse {
    newValue: number;
    success: boolean;
    code?: number;
    messageId?: number;
  }
  ```

- **`HPKVNotificationResponse`**: Data structure for key notifications in pub-sub subscriptions.
  ```typescript
  interface HPKVNotificationResponse {
    key: string;
    value: string | number | null; // Value is null if the key was deleted
  }
  ```

- **`HPKVErrorResponse`**: Structure of the error payload from the server, often wrapped by client-side exceptions.
  ```typescript
  interface HPKVErrorResponse {
    error: string;
  }
  ```
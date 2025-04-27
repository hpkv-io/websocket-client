import { HPKVClientFactory } from '../src/client-factory';
import { WebsocketTokenManager } from '../src/utilities/token-manager';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * This example demonstrates a usage of the HPKV WebSocket client
 * in a basic scenario.
 */
async function main(): Promise<void> {
  // Example 1: Using HPKVApiClient (server-side)
  // This is the scenario where you have a server-side application that needs to access the HPKV database to perform operations like storing, updating, and deleting data.
  // Using websockets enhances the performance as it does not require connection to the server for each operation.
  console.log('\n=== Example 1: Using HPKVApiClient (Server-side) ===');
  const serverClient = HPKVClientFactory.createApiClient(
    process.env.HPKV_API_KEY!,
    process.env.HPKV_API_BASE_URL!
  );

  try {
    await serverClient.connect();
    console.log('Connected to HPKV using API key');

    // Store user data
    const userData = {
      name: 'John Doe',
      email: 'john@example.com',
      preferences: {
        theme: 'dark',
        notifications: true,
      },
    };

    console.log('Storing user data...');
    const setResponse = await serverClient.set('user:123', userData);
    console.log('User data stored successfully:', setResponse.success);

    // Retrieve user data
    console.log('Retrieving user data...');
    const getResponse = await serverClient.get('user:123');
    console.log(
      'Retrieved user data:',
      getResponse.value ? JSON.parse(getResponse.value.toString()) : null
    );

    // Example of partial update (patch)
    console.log('\nUpdating user preferences...');
    const patchResponse = await serverClient.set(
      'user:123',
      {
        preferences: {
          theme: 'light',
          notifications: false,
        },
      },
      true
    );

    if (patchResponse.success) {
      console.log('User preferences updated:', patchResponse.message);
    } else {
      console.log('User preferences update failed:', patchResponse.error);
    }

    // Example of range query
    console.log('\nQuerying users in range...');
    const rangeResult = await serverClient.range('user:100', 'user:200', {
      limit: 10,
    });

    if (rangeResult.records) {
      console.log(
        'Users in range:',
        rangeResult.records.map(record => ({
          key: record.key,
          value: record.value, // The value is already a string, no need to parse
        }))
      );
    } else {
      console.log('No records found in range');
    }

    console.log('Total count:', rangeResult.count);
    console.log('Truncated:', rangeResult.truncated);

    // Example of atomic increment
    console.log('\nIncrementing user visit count...');
    const incrementResponse = await serverClient.atomicIncrement('user:123:visits', 1);
    console.log('Increment successful:', incrementResponse.success);

    const visitsResponse = await serverClient.get('user:123:visits');
    console.log('User visit count:', visitsResponse.value);

    // Example 2: Subscription Client
    console.log('\n=== Example 2: Subscription Client ===');

    // In real examples, token generation should be done on the server side.
    // Here we are generating tokens for demonstration purposes.
    const tokenManager = new WebsocketTokenManager(
      process.env.HPKV_API_KEY!,
      process.env.HPKV_API_BASE_URL!
    );
    const client1Token = await tokenManager.generateToken({
      subscribeKeys: ['user:123'],
      accessPattern: '^user:[0-9]+$',
    });
    const client2Token = await tokenManager.generateToken({
      subscribeKeys: ['user:123'],
      accessPattern: '^user:[0-9]+$',
    });

    const subscriptionClient1 = HPKVClientFactory.createSubscriptionClient(
      client1Token,
      process.env.HPKV_API_BASE_URL!
    );

    const subscriptionClient2 = HPKVClientFactory.createSubscriptionClient(
      client2Token,
      process.env.HPKV_API_BASE_URL!
    );

    await subscriptionClient1.connect();
    await subscriptionClient2.connect();
    console.log('Both clients connected to HPKV using token and subscribed to a key');

    // Subscribe to changes (client will receive notifications)
    console.log('Adding handlers for subscribed key changes...');
    subscriptionClient1.subscribe(data => {
      if (data.value) {
        console.log('Client 1 received user data change:', JSON.parse(data.value.toString()));
      }
    });

    subscriptionClient2.subscribe(data => {
      if (data.value) {
        console.log('Client 2 received user data change:', JSON.parse(data.value.toString()));
      }
    });

    // Update user data from server (this will trigger notifications)
    console.log('Updating user data (theme changed to light) using server client...');
    await serverClient.set('user:123', {
      ...userData,
      preferences: {
        ...userData.preferences,
        theme: 'light',
      },
    });

    console.log(
      'Client 1 Updating user data from client (added age property with value of 30) using subscription client...'
    );
    await subscriptionClient1.set('user:123', {
      ...userData,
      preferences: {
        ...userData.preferences,
        theme: 'light',
      },
      age: 30,
    });

    // Wait for 1 second to ensure the subscription client has received the update
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\nCleaning up...');
    await serverClient.delete('user:123');
    await serverClient.delete('user:123:visits');
    await serverClient.disconnect(false);
    await subscriptionClient1.disconnect(false);
    await subscriptionClient2.disconnect(false);
    serverClient.destroy();
    subscriptionClient1.destroy();
    subscriptionClient2.destroy();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
main().catch(console.error);

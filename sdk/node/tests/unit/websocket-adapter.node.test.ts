/* eslint-disable @typescript-eslint/no-explicit-any */
import { createWebSocket, createNodeWebSocket } from '../../src/websocket/websocket-adapter';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

const mockNodeWebSocketInstance = {
  readyState: 1, // OPEN
  send: jest.fn(),
  close: jest.fn(),
  _listeners: {} as { [event: string]: Set<(...args: any[]) => void> },
  on: jest.fn<any>(function (this: any, event: string, handler: (...args: any[]) => void) {
    if (!this._listeners[event]) {
      this._listeners[event] = new Set();
    }
    this._listeners[event].add(handler);
    return this; // Node's 'on' is chainable
  }),
  removeListener: jest.fn<any>(function (
    this: any,
    event: string,
    handler: (...args: any[]) => void
  ) {
    this._listeners[event]?.delete(handler);
    return this; // Node's 'removeListener' is chainable
  }),
  removeAllListeners: jest.fn<any>(function (this: any, event?: string) {
    if (event) {
      delete this._listeners[event];
    } else {
      this._listeners = {};
    }
    return this; // Node's 'removeAllListeners' is chainable
  }),
  _clearListeners: function () {
    // Helper to reset for each test instantiation by the mock factory
    this._listeners = {};
  },
  _simulateMessage: function (this: any, data: unknown) {
    // Node adapter tries to parse JSON from string/buffer
    this._listeners['message']?.forEach((h: any) => h(data));
  },
  _simulateOpen: function (this: any) {
    this.readyState = 1; // OPEN
    this._listeners['open']?.forEach((h: any) => h());
  },
  _simulateClose: function (this: any, code?: number, reasonBuffer?: Buffer) {
    this.readyState = 3; // CLOSED
    // Node adapter expects reason as Buffer, converts to string
    this._listeners['close']?.forEach((h: any) => h(code, reasonBuffer));
  },
  _simulateError: function (this: any, error: Error) {
    this.readyState = 3; // CLOSED
    this._listeners['error']?.forEach((h: any) => h(error));
  },
};

jest.mock('ws', () => ({
  __esModule: true,
  WebSocket: jest.fn().mockImplementation(() => {
    // Reset mock instance state for each new WebSocket creation
    mockNodeWebSocketInstance.send.mockClear();
    mockNodeWebSocketInstance.close.mockClear();
    // Crucially, clear our internal listener store and Jest's records of on/removeListener/removeAllListeners calls
    mockNodeWebSocketInstance._clearListeners();
    mockNodeWebSocketInstance.on.mockClear();
    mockNodeWebSocketInstance.removeListener.mockClear();
    mockNodeWebSocketInstance.removeAllListeners.mockClear();
    mockNodeWebSocketInstance.readyState = 1; // Default to OPEN for new instances
    return mockNodeWebSocketInstance;
  }),
}));

describe('WebSocketAdapter - Node.js Environment', () => {
  let originalGlobalWebSocket: typeof global.WebSocket | undefined;
  let originalWindow: Window | undefined;
  let originalSelf: Window | undefined;

  beforeEach(() => {
    // Save and remove any global/window/self WebSocket constructors to force Node.js path
    originalGlobalWebSocket = global.WebSocket;
    global.WebSocket = undefined as unknown as typeof WebSocket;

    if (typeof window !== 'undefined') {
      originalWindow = window;
      window = undefined as unknown as typeof window & typeof globalThis;
    } else {
      originalWindow = undefined;
    }

    if (typeof self !== 'undefined') {
      originalSelf = self;
      self = undefined as unknown as typeof self & typeof globalThis;
    } else {
      originalSelf = undefined;
    }
  });

  afterEach(() => {
    // Restore global/window/self WebSocket constructors
    global.WebSocket = originalGlobalWebSocket as unknown as typeof WebSocket;
    if (originalWindow) {
      window = originalWindow as unknown as typeof window & typeof globalThis;
    }
    if (originalSelf) {
      self = originalSelf as unknown as typeof self & typeof globalThis;
    }
    jest.clearAllMocks();
  });

  it('createWebSocket should use NodeWebSocket when no browser WebSocket is available', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { WebSocket: MockedNodeWS } = require('ws');
    const adapter = createWebSocket('ws://node-url');
    expect(MockedNodeWS).toHaveBeenCalledWith('ws://node-url');
    expect(adapter).toBeDefined();
  });

  describe('createNodeWebSocket specific tests', () => {
    it('should handle JSON string messages and parse them', () => {
      const adapter = createNodeWebSocket('ws://node-json-string');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const testData = { type: 'data', value: 'test1' };
      // Simulate ws sending a JSON string

      (mockNodeWebSocketInstance as any)._simulateMessage(JSON.stringify(testData));
      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should handle Buffer messages and parse them as JSON', () => {
      const adapter = createNodeWebSocket('ws://node-buffer');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const testData = { type: 'data', value: 'test2' };
      // Simulate ws sending a Buffer

      (mockNodeWebSocketInstance as any)._simulateMessage(Buffer.from(JSON.stringify(testData)));
      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should handle already parsed object messages', () => {
      const adapter = createNodeWebSocket('ws://node-object');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const testData = { type: 'data', value: 'test3' };
      // Simulate ws sending an object (if underlying mock ws.on passes it as object)

      (mockNodeWebSocketInstance as any)._simulateMessage(testData);
      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should distinguish HPKVNotificationResponse', () => {
      const adapter = createNodeWebSocket('ws://node-notification');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const notificationData = { type: 'notification', event: 'new_val', key: 'some_key' };

      (mockNodeWebSocketInstance as any)._simulateMessage(JSON.stringify(notificationData));
      expect(messageHandler).toHaveBeenCalledWith(notificationData);
    });

    it('should pass raw string data if JSON parsing fails', () => {
      const adapter = createNodeWebSocket('ws://node-raw-string');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const rawData = 'this is not json';

      (mockNodeWebSocketInstance as any)._simulateMessage(rawData);
      expect(messageHandler).toHaveBeenCalledWith(rawData);
    });

    it('should pass raw buffer data as string if JSON parsing fails', () => {
      const adapter = createNodeWebSocket('ws://node-raw-buffer');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const rawBufferData = Buffer.from('this is not json buffer');

      (mockNodeWebSocketInstance as any)._simulateMessage(rawBufferData);
      expect(messageHandler).toHaveBeenCalledWith(rawBufferData.toString());
    });

    it('should forward send calls to the underlying WebSocket', () => {
      const adapter = createNodeWebSocket('ws://node-send');
      const dataToSend = JSON.stringify({ message: 'hello' });
      adapter.send(dataToSend);
      expect(mockNodeWebSocketInstance.send).toHaveBeenCalledWith(dataToSend);
    });

    it('should forward close calls to the underlying WebSocket', () => {
      const adapter = createNodeWebSocket('ws://node-close');
      adapter.close();
      expect(mockNodeWebSocketInstance.close).toHaveBeenCalled();
    });

    it('should forward removeAllListeners calls to the underlying WebSocket', () => {
      const adapter = createNodeWebSocket('ws://node-remove-listeners');
      adapter.removeAllListeners();
      expect(mockNodeWebSocketInstance.removeAllListeners).toHaveBeenCalled();
    });

    describe('removeListener', () => {
      it('should remove a specific listener and not affect others', () => {
        const adapter = createNodeWebSocket('ws://node-remove-listener');
        const listener1 = jest.fn();
        const listener2 = jest.fn();

        adapter.on('message', listener1);
        adapter.on('message', listener2);

        adapter.removeListener('message', listener1);
        (mockNodeWebSocketInstance as any)._simulateMessage({ data: 'test' });

        expect(listener1).not.toHaveBeenCalled();
        expect(listener2).toHaveBeenCalledWith({ data: 'test' });
      });

      it('should do nothing if attempting to remove a non-existent listener', () => {
        const adapter = createNodeWebSocket('ws://node-remove-non-existent');
        const listener1 = jest.fn();
        const nonExistentListener = jest.fn();

        adapter.on('message', listener1);
        adapter.removeListener('message', nonExistentListener);
        (mockNodeWebSocketInstance as any)._simulateMessage({ data: 'test' });

        expect(listener1).toHaveBeenCalledWith({ data: 'test' });
      });

      it('should do nothing if attempting to remove a listener from an event with no listeners', () => {
        const adapter = createNodeWebSocket('ws://node-remove-from-empty');
        const listener = jest.fn();

        adapter.removeListener('message', listener);
        // No error should be thrown, and nothing should happen
        expect(() => {
          (mockNodeWebSocketInstance as any)._simulateMessage({ data: 'test' });
        }).not.toThrow();
      });
    });

    it('should get readyState from the underlying WebSocket', () => {
      const adapter = createNodeWebSocket('ws://node-readystate');

      (mockNodeWebSocketInstance as any).readyState = 2; // CLOSING
      expect(adapter.readyState).toBe(2);
    });

    it('should propagate "open" event', () => {
      const adapter = createNodeWebSocket('ws://node-open');
      const openHandler = jest.fn();
      adapter.on('open', openHandler);

      (mockNodeWebSocketInstance as any)._simulateOpen();
      expect(openHandler).toHaveBeenCalled();
    });

    it('should propagate "close" event with code and reason', () => {
      const adapter = createNodeWebSocket('ws://node-on-close');
      const closeHandler = jest.fn();
      adapter.on('close', closeHandler);

      (mockNodeWebSocketInstance as any)._simulateClose(1000, Buffer.from('Normal closure'));
      expect(closeHandler).toHaveBeenCalledWith(1000, 'Normal closure');
    });

    it('should propagate "error" event', () => {
      const adapter = createNodeWebSocket('ws://node-on-error');
      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);
      const testError = new Error('Test error');

      (mockNodeWebSocketInstance as any)._simulateError(testError);
      expect(errorHandler).toHaveBeenCalledWith(testError);
    });

    it('should throw an error when subscribing to an unhandled event type', () => {
      const adapter = createNodeWebSocket('ws://node-unhandled-event');
      expect(() => adapter.on('someUnhandledEvent', jest.fn())).toThrow(
        'Attaching direct listener for unhandled websocket event type "someUnhandledEvent"'
      );
    });
  });
});

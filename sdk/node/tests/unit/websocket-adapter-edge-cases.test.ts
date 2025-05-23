/// <reference types="jest" />
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import {
  createWebSocket,
  createBrowserWebSocket,
  createNodeWebSocket,
} from '../../src/websocket/websocket-adapter';
import { HPKVError } from '../../src/websocket/errors';
import { IWebSocket } from '../../src/websocket/types';
import { WebSocket as MockNodeWebSocket } from 'ws'; // Import the mocked version
import { ConnectionError } from '../../src/websocket/errors';

// Mock the 'ws' library for NodeWebSocket tests if not already globally mocked in setup
jest.mock('ws', () => ({
  __esModule: true,
  WebSocket: jest.fn().mockImplementation(() => ({
    readyState: 0,
    on: jest.fn(),
    send: jest.fn(),
    close: jest.fn(),
    removeListener: jest.fn(),
    removeAllListeners: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })),
}));

describe('WebSocketAdapter - Edge Cases and Uncovered Paths', () => {
  let originalWindow: Window & typeof globalThis;
  let originalSelf: Window & typeof globalThis;
  let MockBrowserWebSocketClass: jest.Mock;
  let mockBrowserInstance: unknown;

  beforeEach(() => {
    // Save originals
    originalWindow = global.window;
    originalSelf = global.self;

    // Mock browser WebSocket
    mockBrowserInstance = {
      readyState: 0,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
    };
    MockBrowserWebSocketClass = jest.fn(() => mockBrowserInstance);

    // Clear mocks for ws
    (MockNodeWebSocket as unknown as jest.Mock).mockClear();
    const mockWsInstance = (MockNodeWebSocket as unknown as jest.Mock).mock.results[0]?.value;
    if (mockWsInstance) {
      Object.values(mockWsInstance).forEach(mockFn => {
        if (typeof mockFn === 'function' && 'mockClear' in mockFn) {
          (mockFn as jest.Mock).mockClear();
        }
      });
    }
  });

  afterEach(() => {
    // Restore originals
    global.window = originalWindow;
    global.self = originalSelf;
    jest.resetModules(); // Important to reset module cache for ws import
  });

  describe('createWebSocket (environment detection)', () => {
    it('should use self.WebSocket if window.WebSocket is undefined', () => {
      global.window = undefined as unknown as typeof globalThis.window;
      global.self = { WebSocket: MockBrowserWebSocketClass } as unknown as typeof globalThis.self;
      global.WebSocket = undefined as unknown as typeof globalThis.WebSocket; // Ensure NodeWebSocket from global is not picked

      createWebSocket('ws://test-self');
      expect(MockBrowserWebSocketClass).toHaveBeenCalledWith('ws://test-self');
      expect(MockNodeWebSocket).not.toHaveBeenCalled();
    });

    it('should use global.WebSocket if window and self WebSockets are undefined (Node context, but not "ws" module)', () => {
      // This scenario is a bit artificial as 'ws' module is usually present in Node
      // or createNodeWebSocket would be picked first if 'ws' module is available.
      // We are testing the conditional logic.
      global.window = undefined as unknown as typeof globalThis.window;
      global.self = undefined as unknown as typeof globalThis.self;
      global.WebSocket = MockBrowserWebSocketClass as unknown as typeof globalThis.WebSocket; // Treat global.WebSocket like a browser one for testing this path

      createWebSocket('ws://test-global');
      expect(MockBrowserWebSocketClass).toHaveBeenCalledWith('ws://test-global');
    });
  });

  describe('createBrowserWebSocket - Edge Cases', () => {
    let adapter: IWebSocket;

    beforeEach(() => {
      adapter = createBrowserWebSocket(
        'ws://browser-edge',
        MockBrowserWebSocketClass as unknown as typeof WebSocket
      );
    });

    it('on() should throw for unhandled event types', () => {
      expect(() => adapter.on('unhandledEvent', jest.fn())).toThrow(
        '[HPKV Websocket Client] createBrowserWebSocket: Attaching direct listener for unhandled event type "unhandledEvent"'
      );
    });

    it('on("message") should console.error for non-SyntaxError during processing', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mockListener = jest.fn();
      adapter.on('message', mockListener);

      const errorEvent = { data: '{ "validJson": true }' }; // Valid JSON
      mockListener.mockImplementationOnce(() => {
        throw new Error('Test processing error');
      });

      // Simulate message event: find the wrapper and call it
      const messageWrapper = (
        mockBrowserInstance as unknown as { addEventListener: jest.Mock }
      ).addEventListener.mock.calls.find(call => call[0] === 'message')?.[1];
      if (messageWrapper && typeof messageWrapper === 'function') {
        messageWrapper(errorEvent);
      }

      expect(mockListener).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[HPKV Websocket Client] createBrowserWebSocket: Error processing "message" or in listener callback:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });

    it('removeListener should do nothing if event type has no listeners', () => {
      expect(() => adapter.removeListener('nonExistentEvent', jest.fn())).not.toThrow();
      expect(
        (mockBrowserInstance as unknown as { removeEventListener: jest.Mock }).removeEventListener
      ).not.toHaveBeenCalled();
    });

    it('removeListener should do nothing if listener was not added for that event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      adapter.on('open', listener1);
      adapter.removeListener('open', listener2); // Try to remove a different listener
      expect(
        (mockBrowserInstance as unknown as { removeEventListener: jest.Mock }).removeEventListener
      ).not.toHaveBeenCalledWith('open', expect.anything()); // Or be more specific if needed
    });

    it('removeListener should remove the correct listener and delete event from internalListeners if last one', () => {
      const listener = jest.fn();
      adapter.on('open', listener);
      // Simulate the call to get the wrapper
      const openWrapper = (
        mockBrowserInstance as unknown as { addEventListener: jest.Mock }
      ).addEventListener.mock.calls.find(call => call[0] === 'open')?.[1];

      adapter.removeListener('open', listener);
      expect(
        (mockBrowserInstance as unknown as { removeEventListener: jest.Mock }).removeEventListener
      ).toHaveBeenCalledWith('open', openWrapper);
      // Check internal state if possible (not directly exposed, but can infer from subsequent calls)
      // For example, trying to remove it again should not call removeEventListener again
      (
        mockBrowserInstance as unknown as { removeEventListener: jest.Mock }
      ).removeEventListener.mockClear();
      adapter.removeListener('open', listener);
      expect(
        (mockBrowserInstance as unknown as { removeEventListener: jest.Mock }).removeEventListener
      ).not.toHaveBeenCalled();
    });

    it('removeAllListeners should clear all internal listeners and call removeEventListener for each', () => {
      const openListener = jest.fn();
      const messageListener = jest.fn();
      adapter.on('open', openListener);
      adapter.on('message', messageListener);

      const openWrapper = (
        mockBrowserInstance as unknown as { addEventListener: jest.Mock }
      ).addEventListener.mock.calls.find(call => call[0] === 'open')?.[1];
      const messageWrapper = (
        mockBrowserInstance as unknown as { addEventListener: jest.Mock }
      ).addEventListener.mock.calls.find(call => call[0] === 'message')?.[1];

      adapter.removeAllListeners();

      expect(
        (mockBrowserInstance as unknown as { removeEventListener: jest.Mock }).removeEventListener
      ).toHaveBeenCalledWith('open', openWrapper);
      expect(
        (mockBrowserInstance as unknown as { removeEventListener: jest.Mock }).removeEventListener
      ).toHaveBeenCalledWith('message', messageWrapper);

      // Check that internalListeners is effectively cleared (e.g., adding a new listener works fresh)
      (
        mockBrowserInstance as unknown as { addEventListener: jest.Mock }
      ).addEventListener.mockClear();
      adapter.on('open', jest.fn());
      expect(
        (mockBrowserInstance as unknown as { addEventListener: jest.Mock }).addEventListener
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('createNodeWebSocket - Edge Cases', () => {
    let adapter: IWebSocket;
    let mockWsInstance:
      | {
          on: jest.Mock;
          removeListener: jest.Mock;
          // Add other methods if directly called by adapter and need to be part of the mockWsInstance type
        }
      | undefined;

    beforeEach(() => {
      // Get the current mock instance used by createNodeWebSocket
      adapter = createNodeWebSocket('ws://node-edge');
      // Ensure mockWsInstance is correctly typed or cast
      const latestMockResult = (MockNodeWebSocket as unknown as jest.Mock).mock.results.slice(
        -1
      )[0];
      mockWsInstance = latestMockResult?.value as typeof mockWsInstance;
    });

    it('on() should throw for unhandled event types', () => {
      expect(() => adapter.on('unhandledEvent', jest.fn())).toThrow(HPKVError);
      expect(() => adapter.on('unhandledEvent', jest.fn())).toThrow(
        'Attaching direct listener for unhandled websocket event type "unhandledEvent"'
      );
    });

    it('on("message") should throw non-SyntaxError during processing', () => {
      const mockListener = jest.fn();
      adapter.on('message', mockListener);

      const errorEventData = '{ "validJson": true }'; // Valid JSON
      mockListener.mockImplementationOnce(() => {
        throw new Error('Test processing error from node listener');
      });

      const messageWrapper = mockWsInstance?.on.mock.calls.find(call => call[0] === 'message')?.[1];

      expect(() => {
        if (messageWrapper && typeof messageWrapper === 'function') {
          messageWrapper(errorEventData);
        }
      }).toThrow('Test processing error from node listener');
      expect(mockListener).toHaveBeenCalled();
    });

    it('on("message") should call listener with rawData for unknown data types', () => {
      const mockListener = jest.fn();
      adapter.on('message', mockListener);
      const unknownData = 12345; // e.g., a number

      const messageWrapper = mockWsInstance?.on.mock.calls.find(call => call[0] === 'message')?.[1];
      if (messageWrapper && typeof messageWrapper === 'function') {
        messageWrapper(unknownData);
      }
      expect(mockListener).toHaveBeenCalledWith(unknownData);
    });

    it('removeListener should do nothing if event type has no listeners', () => {
      expect(() => adapter.removeListener('nonExistentEvent', jest.fn())).not.toThrow();
      expect(mockWsInstance?.removeListener).not.toHaveBeenCalled();
    });

    it('removeListener should do nothing if listener was not added for that event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      adapter.on('open', listener1);
      adapter.removeListener('open', listener2);
      // removeListener on the mockWsInstance should not have been called for 'open' with any handler
      const openRemoveCalls =
        mockWsInstance?.removeListener.mock.calls.filter(call => call[0] === 'open') || [];
      expect(openRemoveCalls.length).toBe(0);
    });

    it('removeListener should remove the correct listener and delete event from internalListeners if last one', () => {
      const listener = jest.fn();
      adapter.on('open', listener);
      const openWrapper = mockWsInstance?.on.mock.calls.find(call => call[0] === 'open')?.[1];

      adapter.removeListener('open', listener);
      expect(mockWsInstance?.removeListener).toHaveBeenCalledWith('open', openWrapper);

      mockWsInstance?.removeListener.mockClear();
      adapter.removeListener('open', listener);
      expect(mockWsInstance?.removeListener).not.toHaveBeenCalled();
    });

    it('removeAllListeners should clear internalListeners', () => {
      const openListener = jest.fn();
      adapter.on('open', openListener); // Add a listener to populate internalListeners

      adapter.removeAllListeners(); // This calls ws.removeAllListeners and clears internal state

      // To verify internalListeners is cleared, try adding a new listener.
      // The internalListeners[event] should be undefined before push.
      // This is an indirect way to test internal state.
      mockWsInstance?.on.mockClear(); // Clear previous 'on' calls
      adapter.on('open', jest.fn());
      expect(mockWsInstance?.on).toHaveBeenCalledTimes(1); // Indicates it was treated as a new event setup
    });

    it('should throw ConnectionError if NodeWebSocket constructor fails', () => {
      // Ensure the global mock is used and set its implementation for this test
      const WsMock = MockNodeWebSocket as unknown as jest.Mock;
      WsMock.mockImplementationOnce(() => {
        throw new Error('Simulated constructor failure specific');
      });

      expect(() => createNodeWebSocket('ws://node-init-fail-1')).toThrow(ConnectionError);

      // For the second assertion (checking the message), we need another mock setup
      WsMock.mockImplementationOnce(() => {
        throw new Error('Simulated constructor failure specific');
      });
      expect(() => createNodeWebSocket('ws://node-init-fail-2')).toThrow(
        'Failed to initialize WebSocket for Node.js: Simulated constructor failure specific'
      );
    });

    it('should re-throw errors from listeners in Node.js adapter', () => {
      const adapter = createNodeWebSocket('ws://node-listener-throw');
      const faultyListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      adapter.on('message', faultyListener);

      const mockWsInstance = (MockNodeWebSocket as unknown as jest.Mock).mock.results.slice(-1)[0]
        ?.value as { on: jest.Mock; [key: string]: unknown } | undefined;

      const messageCallbackRetrieved = mockWsInstance?.on.mock.calls.find(
        call => (call[0] as string) === 'message'
      )?.[1];

      if (!(messageCallbackRetrieved && typeof messageCallbackRetrieved === 'function')) {
        // Throw an error in the test itself if the setup is wrong, making it fail clearly
        throw new Error(
          'Test setup error: message callback not found or not a function on mockWsInstance'
        );
      }

      expect(() => {
        messageCallbackRetrieved(Buffer.from(JSON.stringify({ data: 'test' })));
      }).toThrow('Listener error');
      expect(faultyListener).toHaveBeenCalled();
    });
  });
});

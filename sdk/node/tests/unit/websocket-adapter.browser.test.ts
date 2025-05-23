/* eslint-disable @typescript-eslint/no-explicit-any */
import { createWebSocket } from '../../src/websocket/websocket-adapter';
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { IWebSocket } from '../../src/websocket/types'; // Import IWebSocket for type usage

// Helper type for the mock browser WebSocket
interface MockBrowserWebSocket {
  readyState: number;
  send: jest.Mock;
  close: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  // Methods to simulate events
  _simulateOpen: () => void;
  _simulateMessage: (data: any) => void;
  _simulateClose: (code?: number, reason?: string) => void;
  _simulateError: (event?: Event) => void;
  // WebSocket constants, useful for setting readyState
  CONNECTING: 0;
  OPEN: 1;
  CLOSING: 2;
  CLOSED: 3;
  // Internal listener store for more accurate simulation
  _listeners: { [event: string]: Set<(...args: any[]) => void> };
}

describe('WebSocketAdapter - Browser Environment', () => {
  let mockBrowserWsInstance: MockBrowserWebSocket;
  let OriginalWebSocket: typeof WebSocket;
  let adapter: IWebSocket;

  beforeEach(() => {
    mockBrowserWsInstance = {
      readyState: 0, // WebSocket.CONNECTING
      send: jest.fn(),
      close: jest.fn(),
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
      _listeners: {},
      addEventListener: jest.fn<any>((event: string, handler: (...args: any[]) => void) => {
        if (!mockBrowserWsInstance._listeners[event]) {
          mockBrowserWsInstance._listeners[event] = new Set();
        }
        mockBrowserWsInstance._listeners[event].add(handler);
      }),
      removeEventListener: jest.fn<any>((event: string, handler: (...args: any[]) => void) => {
        mockBrowserWsInstance._listeners[event]?.delete(handler);
      }),
      _simulateOpen: function () {
        this.readyState = this.OPEN;
        this._listeners['open']?.forEach(h => h({} as Event));
      },
      _simulateMessage: function (data) {
        this._listeners['message']?.forEach(h => h({ data } as MessageEvent));
      },
      _simulateClose: function (code, reason) {
        this.readyState = this.CLOSED;
        this._listeners['close']?.forEach(h => h({ code, reason } as CloseEvent));
      },
      _simulateError: function (event = {} as Event) {
        this.readyState = this.CLOSED;
        this._listeners['error']?.forEach(h => h(event));
      },
    };

    const MockWebSocketConstructor = jest.fn(() => mockBrowserWsInstance);
    OriginalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocketConstructor as any;
  });

  afterEach(() => {
    global.WebSocket = OriginalWebSocket;
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('createWebSocket should use global.WebSocket and return a browser WebSocket adapter', () => {
      adapter = createWebSocket('ws://localhost:8080');
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8080');
      expect(adapter).toBeDefined();
    });
  });

  describe('Event Handling', () => {
    beforeEach(() => {
      adapter = createWebSocket('ws://localhost:events');
    });

    it('should attach and trigger "open" event', () => {
      const openHandler = jest.fn();
      adapter.on('open', openHandler);
      mockBrowserWsInstance._simulateOpen();
      expect(openHandler).toHaveBeenCalled();
    });

    it('should attach and trigger "message" event with JSON data', () => {
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);
      const data = { foo: 'bar' };
      mockBrowserWsInstance._simulateMessage(JSON.stringify(data));
      expect(messageHandler).toHaveBeenCalledWith(data);
    });

    it('should attach and trigger "message" event with non-JSON string data', () => {
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);
      const data = 'not-json';
      mockBrowserWsInstance._simulateMessage(data);
      expect(messageHandler).toHaveBeenCalledWith(data);
    });

    it('should attach and trigger "close" event', () => {
      const closeHandler = jest.fn();
      adapter.on('close', closeHandler);
      mockBrowserWsInstance._simulateClose(1000, 'Normal');
      expect(closeHandler).toHaveBeenCalledWith(1000, 'Normal');
    });

    it('should attach and trigger "error" event', () => {
      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);
      const errEvent = { type: 'error' } as Event;
      mockBrowserWsInstance._simulateError(errEvent);
      expect(errorHandler).toHaveBeenCalledWith(errEvent);
    });

    it('should throw error for unhandled event types via on()', () => {
      expect(() => adapter.on('unhandled', jest.fn())).toThrowError(
        '[HPKV Websocket Client] createBrowserWebSocket: Attaching direct listener for unhandled event type "unhandled"'
      );
    });
  });

  describe('Method Forwarding and Properties', () => {
    beforeEach(() => {
      adapter = createWebSocket('ws://localhost:methods');
    });

    it('should forward send() calls', () => {
      const data = JSON.stringify({ test: 'data' });
      adapter.send(data);
      expect(mockBrowserWsInstance.send).toHaveBeenCalledWith(data);
    });

    it('should forward close() calls', () => {
      adapter.close(1001, 'Going away');
      expect(mockBrowserWsInstance.close).toHaveBeenCalledWith(1001, 'Going away');
    });

    it('should get readyState', () => {
      mockBrowserWsInstance.readyState = mockBrowserWsInstance.OPEN;
      expect(adapter.readyState).toBe(mockBrowserWsInstance.OPEN);
      mockBrowserWsInstance.readyState = mockBrowserWsInstance.CLOSED;
      expect(adapter.readyState).toBe(mockBrowserWsInstance.CLOSED);
    });
  });

  describe('Listener Management (removeListener, removeAllListeners)', () => {
    beforeEach(() => {
      adapter = createWebSocket('ws://localhost:listeners');
    });

    it('should remove a specific listener using removeListener()', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      adapter.on('message', listener1);
      adapter.on('message', listener2);
      adapter.removeListener('message', listener1); // Remove listener1
      mockBrowserWsInstance._simulateMessage('test message');
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith('test message');
      expect(mockBrowserWsInstance.removeEventListener).toHaveBeenCalled();
    });

    it('removeListener() should not fail for non-existent listeners', () => {
      const listener1 = jest.fn();
      adapter.removeListener('message', listener1);
      expect(mockBrowserWsInstance.removeEventListener).not.toHaveBeenCalled(); // Or check calls if it was called with undefined
    });

    it('should remove all listeners for a specific event if removeAllListeners() is called (or all if no event)', () => {
      const messageHandler = jest.fn();
      const openHandler = jest.fn();
      adapter.on('message', messageHandler);
      adapter.on('open', openHandler);
      adapter.removeAllListeners();
      mockBrowserWsInstance._simulateMessage('test');
      mockBrowserWsInstance._simulateOpen();
      expect(messageHandler).not.toHaveBeenCalled();
      expect(openHandler).not.toHaveBeenCalled();
      // Check if removeEventListener was called for each attached listener
      expect(mockBrowserWsInstance.removeEventListener).toHaveBeenCalledTimes(2); // Assuming two listeners were attached via addEventListener
    });
  });
});

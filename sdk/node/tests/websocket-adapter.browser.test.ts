import { createWebSocket, createBrowserWebSocket } from '../src/websocket/websocket-adapter';

describe('WebSocketAdapter - Browser Environment', () => {
  let mockWebSocketInstance: unknown;
  let OriginalWebSocket: typeof WebSocket;

  beforeEach(() => {
    // Mock WebSocket instance
    mockWebSocketInstance = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: jest.fn(),
      close: jest.fn(),
      removeEventListener: jest.fn(),
      addEventListener: jest.fn(),
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    };
    // Mock WebSocket constructor
    const MockWebSocket = jest.fn(() => mockWebSocketInstance) as unknown as typeof WebSocket;

    OriginalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    // Restore original WebSocket
    global.WebSocket = OriginalWebSocket;
    jest.clearAllMocks();
  });

  describe('createWebSocket in browser', () => {
    it('should use global.WebSocket and return a browser WebSocket adapter', () => {
      const ws = createWebSocket('ws://localhost:8080');
      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:8080');
      expect(ws).toBeDefined();
    });
  });

  describe('createBrowserWebSocket', () => {
    it('should correctly setup event listeners and parse JSON messages', () => {
      const adapter = createBrowserWebSocket('ws://fake-url');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      // Simulate receiving a JSON message
      const testData = { type: 'test', payload: 'hello' };
      (mockWebSocketInstance as unknown as WebSocket)?.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify(testData) })
      );

      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should pass raw data if JSON parsing fails', () => {
      const adapter = createBrowserWebSocket('ws://fake-url');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      // Simulate receiving a non-JSON message
      const rawData = 'not json';
      (mockWebSocketInstance as unknown as WebSocket)?.onmessage?.(
        new MessageEvent('message', { data: rawData })
      );

      expect(messageHandler).toHaveBeenCalledWith(rawData);
    });

    it('should handle pre-parsed JSON objects as data (some browser behavior)', () => {
      const adapter = createBrowserWebSocket('ws://fake-url');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      // Simulate receiving data that's already an object
      const objectData = { already: 'parsed' };
      (mockWebSocketInstance as unknown as WebSocket)?.onmessage?.(
        new MessageEvent('message', { data: objectData })
      );

      expect(messageHandler).toHaveBeenCalledWith(objectData);
    });
  });
});

import { createWebSocket, createNodeWebSocket } from '../src/websocket/websocket-adapter';

const mockNodeWebSocketInstance = {
  readyState: 1,
  on: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  removeAllListeners: jest.fn(),
  _simulateMessage: function (data: unknown) {
    const messageCallback = this.on.mock.calls.find(call => call[0] === 'message')?.[1];
    if (messageCallback) {
      messageCallback(data);
    }
  },
  _simulateOpen: function () {
    this.readyState = 1;
    const openCallback = this.on.mock.calls.find(call => call[0] === 'open')?.[1];
    if (openCallback) {
      openCallback();
    }
  },
  _simulateClose: function (code?: number, reason?: string) {
    this.readyState = 3;
    const closeCallback = this.on.mock.calls.find(call => call[0] === 'close')?.[1];
    if (closeCallback) {
      closeCallback(code, reason);
    }
  },
  _simulateError: function (error: Error) {
    this.readyState = 3;
    const errorCallback = this.on.mock.calls.find(call => call[0] === 'error')?.[1];
    if (errorCallback) {
      errorCallback(error);
    }
  },
};

jest.mock('ws', () => ({
  __esModule: true,
  WebSocket: jest.fn().mockImplementation(() => {
    mockNodeWebSocketInstance.on.mockClear();
    mockNodeWebSocketInstance.send.mockClear();
    mockNodeWebSocketInstance.close.mockClear();
    mockNodeWebSocketInstance.removeAllListeners.mockClear();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateMessage(JSON.stringify(testData));
      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should handle Buffer messages and parse them as JSON', () => {
      const adapter = createNodeWebSocket('ws://node-buffer');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const testData = { type: 'data', value: 'test2' };
      // Simulate ws sending a Buffer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateMessage(Buffer.from(JSON.stringify(testData)));
      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should handle already parsed object messages', () => {
      const adapter = createNodeWebSocket('ws://node-object');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const testData = { type: 'data', value: 'test3' };
      // Simulate ws sending an object (if underlying mock ws.on passes it as object)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateMessage(testData);
      expect(messageHandler).toHaveBeenCalledWith(testData);
    });

    it('should distinguish HPKVNotificationResponse', () => {
      const adapter = createNodeWebSocket('ws://node-notification');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const notificationData = { type: 'notification', event: 'new_val', key: 'some_key' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateMessage(JSON.stringify(notificationData));
      expect(messageHandler).toHaveBeenCalledWith(notificationData);
    });

    it('should pass raw string data if JSON parsing fails', () => {
      const adapter = createNodeWebSocket('ws://node-raw-string');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const rawData = 'this is not json';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateMessage(rawData);
      expect(messageHandler).toHaveBeenCalledWith(rawData);
    });

    it('should pass raw buffer data as string if JSON parsing fails', () => {
      const adapter = createNodeWebSocket('ws://node-raw-buffer');
      const messageHandler = jest.fn();
      adapter.on('message', messageHandler);

      const rawBufferData = Buffer.from('this is not json buffer');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    it('should get readyState from the underlying WebSocket', () => {
      const adapter = createNodeWebSocket('ws://node-readystate');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any).readyState = 2; // CLOSING
      expect(adapter.readyState).toBe(2);
    });

    it('should propagate "open" event', () => {
      const adapter = createNodeWebSocket('ws://node-open');
      const openHandler = jest.fn();
      adapter.on('open', openHandler);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateOpen();
      expect(openHandler).toHaveBeenCalled();
    });

    it('should propagate "close" event with code and reason', () => {
      const adapter = createNodeWebSocket('ws://node-on-close');
      const closeHandler = jest.fn();
      adapter.on('close', closeHandler);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateClose(1000, 'Normal closure');
      expect(closeHandler).toHaveBeenCalledWith(1000, 'Normal closure');
    });

    it('should propagate "error" event', () => {
      const adapter = createNodeWebSocket('ws://node-on-error');
      const errorHandler = jest.fn();
      adapter.on('error', errorHandler);
      const testError = new Error('Test error');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockNodeWebSocketInstance as any)._simulateError(testError);
      expect(errorHandler).toHaveBeenCalledWith(testError);
    });
  });
});

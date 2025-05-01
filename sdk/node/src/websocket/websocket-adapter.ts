import { IWebSocket } from './types';
import { HPKVNotificationResponse, HPKVBaseResponse } from './types';

/**
 * WebSocket adapter for browser environments
 * Makes the browser WebSocket API compatible with the Node.js ws package API
 */
export class BrowserWebSocketAdapter implements IWebSocket {
  private socket: WebSocket;
  private eventHandlers: Record<string, ((...args: any[]) => void)[]> = {
    message: [],
    open: [],
    close: [],
    error: [],
  };

  constructor(url: string) {
    this.socket = new WebSocket(url);

    // Set up event listeners for the native WebSocket
    this.socket.addEventListener('message', event => {
      this.eventHandlers.message.forEach(handler => handler(event.data));
    });

    this.socket.addEventListener('open', _event => {
      this.eventHandlers.open.forEach(handler => handler());
    });

    this.socket.addEventListener('close', event => {
      this.eventHandlers.close.forEach(handler => handler(event.code, event.reason));
    });

    this.socket.addEventListener('error', event => {
      this.eventHandlers.error.forEach(handler => handler(event));
    });
  }

  on(event: string, listener: (...args: any[]) => void): IWebSocket {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(listener);
    }
    return this;
  }

  removeAllListeners(): IWebSocket {
    // Clear all event handlers
    Object.keys(this.eventHandlers).forEach(event => {
      this.eventHandlers[event] = [];
    });
    return this;
  }

  send(data: string): void {
    this.socket.send(data);
  }

  close(): void {
    this.socket.close();
  }

  get readyState(): number {
    return this.socket.readyState;
  }
}

/**
 * Creates a WebSocket instance that works with Node.js or browser environments
 * @param url - The WebSocket URL to connect to
 * @returns A WebSocket instance with normalized interface
 */
export function createWebSocket(url: string): IWebSocket {
  let ws = null;
  if (typeof global !== 'undefined' && typeof global.WebSocket === 'function') {
    ws = global.WebSocket;
  } else if (typeof window !== 'undefined' && typeof window.WebSocket === 'function') {
    ws = window.WebSocket;
  } else if (typeof self !== 'undefined' && typeof self.WebSocket === 'function') {
    ws = self.WebSocket;
  }
  if (ws !== null) {
    // Browser environment
    return createBrowserWebSocket(url, ws);
  } else {
    // Node.js environment
    return createNodeWebSocket(url);
  }
}

/**
 * Creates a WebSocket instance for browser environments
 * @param url - The WebSocket URL to connect to
 * @param WebSocketClass - The WebSocket constructor to use
 * @returns A WebSocket instance with normalized interface
 */
export function createBrowserWebSocket(
  url: string,
  WebSocketClass: typeof WebSocket = WebSocket
): IWebSocket {
  const ws = new WebSocketClass(url);

  return {
    get readyState(): number {
      return ws.readyState;
    },
    on(event: string, listener: (...args: any[]) => void): IWebSocket {
      if (event === 'open') {
        ws.onopen = listener;
      } else if (event === 'message') {
        ws.onmessage = event => {
          try {
            // If the data is already an object (happens in some browsers), don't parse it
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            listener(data);
          } catch (e) {
            // If parsing fails, pass the raw data
            listener(event.data);
          }
        };
      } else if (event === 'close') {
        ws.onclose = event => {
          listener(event.code, event.reason);
        };
      } else if (event === 'error') {
        ws.onerror = listener;
      }
      return this;
    },
    removeAllListeners(): IWebSocket {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      return this;
    },
    send(data: string): void {
      ws.send(data);
    },
    close(): void {
      ws.close();
    },
  };
}

/**
 * Creates a WebSocket instance for Node.js environments
 * @param url - The WebSocket URL to connect to
 * @returns A WebSocket instance with normalized interface
 */
export function createNodeWebSocket(url: string): IWebSocket {
  // Dynamically import WebSocket for Node.js to avoid issues in browser environments
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WebSocket = require('ws');
    const ws = new WebSocket(url);

    return {
      get readyState(): number {
        return ws.readyState;
      },
      on(event: string, listener: (...args: any[]) => void): IWebSocket {
        if (event === 'message') {
          ws.on(event, (data: Buffer | string | object) => {
            try {
              // Handle different data types
              let jsonData;

              if (typeof data === 'object' && !Buffer.isBuffer(data)) {
                // Already an object, no need to parse
                jsonData = data;
              } else if (Buffer.isBuffer(data) || typeof data === 'string') {
                // Parse buffer or string
                const stringData = Buffer.isBuffer(data) ? data.toString() : data;
                jsonData = JSON.parse(stringData);
              } else {
                // Unknown type, just pass it through
                listener(data);
                return;
              }

              // Check if this is a notification or a regular response
              if ('type' in jsonData && jsonData.type === 'notification') {
                // Handle as notification response
                listener(jsonData as HPKVNotificationResponse);
              } else {
                // Handle as base response
                listener(jsonData as HPKVBaseResponse);
              }
            } catch (e) {
              // If parsing fails, just pass the raw data
              if (Buffer.isBuffer(data)) {
                listener(data.toString());
              } else {
                listener(data);
              }
            }
          });
        } else {
          ws.on(event, listener);
        }
        return this;
      },
      removeAllListeners(): IWebSocket {
        ws.removeAllListeners();
        return this;
      },
      send(data: string): void {
        ws.send(data);
      },
      close(): void {
        ws.close();
      },
    };
  } catch (error) {
    throw new Error(
      "Failed to initialize WebSocket: 'ws' package is not installed. Please install it with 'npm install ws' or add it to your dependencies."
    );
  }
}

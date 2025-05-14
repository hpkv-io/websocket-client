import { IWebSocket } from './types';
import { HPKVNotificationResponse, HPKVBaseResponse } from './types';
import { WebSocket as NodeWebSocket } from 'ws';

/**
 * Creates a WebSocket instance that works with Node.js or browser environments
 * @param url - The WebSocket URL to connect to
 * @returns A WebSocket instance with normalized interface
 */
export function createWebSocket(url: string): IWebSocket {
  let browserWebSocketConstructor: typeof WebSocket | null = null;
  if (typeof global !== 'undefined' && typeof global.WebSocket === 'function') {
    browserWebSocketConstructor = global.WebSocket;
  } else if (typeof window !== 'undefined' && typeof window.WebSocket === 'function') {
    browserWebSocketConstructor = window.WebSocket;
  } else if (typeof self !== 'undefined' && typeof self.WebSocket === 'function') {
    browserWebSocketConstructor = self.WebSocket;
  }

  if (browserWebSocketConstructor) {
    // Browser environment
    return createBrowserWebSocket(url, browserWebSocketConstructor);
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
            if (e instanceof SyntaxError) {
              listener(event.data);
            }
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
    const ws = new NodeWebSocket(url);

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
              if (e instanceof SyntaxError && Buffer.isBuffer(data)) {
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
      "Failed to initialize WebSocket: 'ws' package is not installed. Please install it with 'npm install ws' or add it to your dependencies." +
        (error as Error).message
    );
  }
}

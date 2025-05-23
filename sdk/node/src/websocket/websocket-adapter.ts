import { WebSocket as NodeWebSocket } from 'ws';
import { ConnectionError, HPKVError } from './errors';
import { HPKVNotificationResponse, IWebSocket } from './types';
import { HPKVBaseResponse } from './types';

/**
 * Creates a WebSocket instance that works with Node.js or browser environments
 * @param url - The WebSocket URL to connect to
 * @returns A WebSocket instance with normalized interface
 */
export function createWebSocket(url: string): IWebSocket {
  let browserWebSocketConstructor: typeof WebSocket | null = null;

  if (typeof window !== 'undefined' && typeof window.WebSocket === 'function') {
    browserWebSocketConstructor = window.WebSocket;
  } else if (typeof self !== 'undefined' && typeof self.WebSocket === 'function') {
    // Check for Web Worker environments or other self-scoped environments
    browserWebSocketConstructor = self.WebSocket;
  } else if (typeof global !== 'undefined' && typeof global.WebSocket === 'function') {
    browserWebSocketConstructor = global.WebSocket;
  }

  if (browserWebSocketConstructor) {
    return createBrowserWebSocket(url, browserWebSocketConstructor);
  } else if (typeof NodeWebSocket !== 'undefined') {
    return createNodeWebSocket(url);
  } else {
    throw new HPKVError('No suitable WebSocket implementation found.');
  }
}

/**
 * Creates a WebSocket instance for browser environments
 */
export function createBrowserWebSocket(url: string, WebSocketClass: typeof WebSocket): IWebSocket {
  const ws = new WebSocketClass(url);

  // Store pairs of { original: Function, wrapper: Function }
  const internalListeners = {} as {
    [key: string]: { original: (...args: any[]) => void; wrapper: (...args: any[]) => void }[];
  };

  return {
    get readyState(): number {
      return ws.readyState;
    },

    on(event: string, listener: (...args: any[]) => void): IWebSocket {
      let eventHandler: (...args: any[]) => void;

      switch (event) {
        case 'open':
          eventHandler = (_nativeEvent: Event): void => listener();
          break;
        case 'message':
          eventHandler = (nativeEvent: MessageEvent): void => {
            try {
              const data =
                typeof nativeEvent.data === 'string'
                  ? JSON.parse(nativeEvent.data)
                  : nativeEvent.data;
              listener(data);
            } catch (e) {
              if (e instanceof SyntaxError) {
                listener(nativeEvent.data); // Fallback with raw data
              } else {
                console.error(
                  '[HPKV Websocket Client] createBrowserWebSocket: Error processing "message" or in listener callback:',
                  e
                );
              }
            }
          };
          break;
        case 'close':
          eventHandler = (nativeEvent: CloseEvent): void =>
            listener(nativeEvent?.code, nativeEvent?.reason);
          break;
        case 'error':
          eventHandler = (nativeEvent: Event): void => listener(nativeEvent);
          break;
        default:
          throw new Error(
            `[HPKV Websocket Client] createBrowserWebSocket: Attaching direct listener for unhandled event type "${event}"`
          );
      }

      ws.addEventListener(event, eventHandler as EventListener);
      internalListeners[event] = internalListeners[event] || [];
      internalListeners[event].push({ original: listener, wrapper: eventHandler });
      return this;
    },

    removeAllListeners(): IWebSocket {
      Object.keys(internalListeners).forEach(event => {
        internalListeners[event].forEach(listenerPair => {
          ws.removeEventListener(event, listenerPair.wrapper as EventListener);
        });
        delete internalListeners[event];
      });
      return this;
    },

    removeListener(event: string, listener: (...args: any[]) => void): IWebSocket {
      if (!internalListeners[event]) {
        return this;
      }

      const listenerIndex = internalListeners[event].findIndex(
        listenerPair => listenerPair.original === listener
      );

      if (listenerIndex !== -1) {
        const { wrapper } = internalListeners[event][listenerIndex];
        ws.removeEventListener(event, wrapper as EventListener);
        internalListeners[event].splice(listenerIndex, 1);
        if (internalListeners[event].length === 0) {
          delete internalListeners[event];
        }
      }
      return this;
    },

    send(data: string): void {
      ws.send(data);
    },

    close(code?: number, reason?: string): void {
      ws.close(code, reason);
    },
  };
}

/**
 * Creates a WebSocket instance for Node.js environments
 */
export function createNodeWebSocket(url: string): IWebSocket {
  try {
    const ws = new NodeWebSocket(url);

    const internalListeners = {} as {
      [key: string]: { original: (...args: any[]) => void; wrapper: (...args: any[]) => void }[];
    };

    return {
      get readyState(): number {
        return ws.readyState;
      },

      on(event: string, listener: (...args: any[]) => void): IWebSocket {
        let nodeEventHandler: (...args: any[]) => void;

        switch (event) {
          case 'open':
            nodeEventHandler = (): void => listener();
            break;
          case 'message':
            nodeEventHandler = (rawData: Buffer | string | object) => {
              try {
                let jsonData;
                if (typeof rawData === 'object' && !Buffer.isBuffer(rawData)) {
                  jsonData = rawData;
                } else if (Buffer.isBuffer(rawData) || typeof rawData === 'string') {
                  const stringData = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : rawData;
                  jsonData = JSON.parse(stringData);
                } else {
                  listener(rawData);
                  return;
                }

                if ('type' in jsonData && jsonData.type === 'notification') {
                  listener(jsonData as HPKVNotificationResponse);
                } else {
                  listener(jsonData as HPKVBaseResponse);
                }
              } catch (e) {
                if (e instanceof SyntaxError) {
                  if (Buffer.isBuffer(rawData)) {
                    listener(rawData.toString('utf8'));
                  } else {
                    listener(rawData);
                  }
                } else {
                  throw e;
                }
              }
            };
            break;
          case 'close':
            nodeEventHandler = (code: number, reasonBuffer: Buffer): void => {
              const reason = reasonBuffer ? reasonBuffer.toString('utf8') : '';
              listener(code, reason);
            };
            break;
          case 'error':
            nodeEventHandler = (error: Error): void => listener(error);
            break;
          default:
            throw new HPKVError(
              `Attaching direct listener for unhandled websocket event type "${event}"`
            );
        }

        ws.on(event, nodeEventHandler);
        internalListeners[event] = internalListeners[event] || [];
        internalListeners[event].push({ original: listener, wrapper: nodeEventHandler });
        return this;
      },

      removeAllListeners(): IWebSocket {
        ws.removeAllListeners();
        Object.keys(internalListeners).forEach(event => {
          delete internalListeners[event];
        });

        return this;
      },

      removeListener(event: string, listener: (...args: any[]) => void): IWebSocket {
        if (!internalListeners[event]) {
          return this;
        }
        const listenerIndex = internalListeners[event].findIndex(
          listenerPair => listenerPair.original === listener
        );

        if (listenerIndex !== -1) {
          const { wrapper } = internalListeners[event][listenerIndex];
          ws.removeListener(event, wrapper);
          internalListeners[event].splice(listenerIndex, 1);
          if (internalListeners[event].length === 0) {
            delete internalListeners[event];
          }
        }
        return this;
      },

      send(data: string): void {
        ws.send(data);
      },

      close(code?: number, reason?: string): void {
        ws.close(code, reason);
      },
    };
  } catch (error) {
    throw new ConnectionError(
      `Failed to initialize WebSocket for Node.js: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

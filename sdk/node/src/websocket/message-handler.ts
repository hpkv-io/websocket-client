import { HPKVRequestMessage, HPKVResponse, HPKVErrorResponse, HPKVBaseResponse } from './types';
import { HPKVError, TimeoutError } from './errors';
import { PendingRequest } from './types';

/**
 * Defines default timeout values in milliseconds
 */
const DEFAULT_TIMEOUTS = {
  OPERATION: 10000,
  CLEANUP: 60000,
} as const;

/**
 * Manages WebSocket message handling and pending requests
 */
export class MessageHandler {
  private messageId = 0;
  private messageMap = new Map<number, PendingRequest>();
  private timeouts = { ...DEFAULT_TIMEOUTS };
  private cleanupInterval: NodeJS.Timeout | number | null = null;

  /**
   * Callback to be invoked when a rate limit error (e.g., 429) is detected.
   * The consumer (e.g., BaseWebSocketClient) can set this to react accordingly.
   */
  public onRateLimitExceeded: ((error: HPKVErrorResponse) => void) | null = null;

  /**
   * Creates a new MessageHandler
   * @param timeouts - Optional custom timeout values
   */
  constructor(timeouts?: Partial<typeof DEFAULT_TIMEOUTS>) {
    if (timeouts) {
      this.timeouts = { ...this.timeouts, ...timeouts };
    }
    this.initCleanupInterval();
  }

  /**
   * Initializes the cleanup interval for stale requests
   */
  private initCleanupInterval(): void {
    this.clearCleanupInterval();
    this.cleanupInterval = setInterval(() => this.cleanupStaleRequests(), this.timeouts.CLEANUP);
  }

  /**
   * Clears the cleanup interval
   */
  private clearCleanupInterval(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval as NodeJS.Timeout);
      this.cleanupInterval = null;
    }
  }

  /**
   * Gets the next message ID, ensuring it doesn't overflow
   * @returns A safe message ID number
   */
  getNextMessageId(): number {
    if (this.messageId >= Number.MAX_SAFE_INTEGER - 1000) {
      this.messageId = 0;
    }
    return ++this.messageId;
  }

  /**
   * Creates a message with an assigned ID
   * @param message - Base message without ID
   * @returns Message with ID
   */
  createMessage(message: Omit<HPKVRequestMessage, 'messageId'>): HPKVRequestMessage {
    const id = this.getNextMessageId();
    return {
      ...message,
      messageId: id,
    };
  }

  /**
   * Registers a pending request
   * @param messageId - The ID of the message
   * @param operation - The operation being performed
   * @param timeoutMs - Optional custom timeout for this operation
   * @returns A promise and cleanup functions
   */
  registerRequest(
    messageId: number,
    operation: string,
    timeoutMs?: number
  ): {
    promise: Promise<HPKVResponse>;
    cancel: (reason: string) => void;
  } {
    const actualTimeoutMs = timeoutMs || this.timeouts.OPERATION;

    let resolve!: (value: HPKVResponse) => void;
    let reject!: (reason: unknown) => void;

    const promise = new Promise<HPKVResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timer = setTimeout(() => {
      if (this.messageMap.has(messageId)) {
        this.messageMap.delete(messageId);
        reject(new TimeoutError(`Operation timed out after ${actualTimeoutMs}ms: ${operation}`));
      }
    }, actualTimeoutMs);

    this.messageMap.set(messageId, {
      resolve,
      reject,
      timer,
      timestamp: Date.now(),
      operation,
    });

    const cancel = (reason: string): void => {
      if (this.messageMap.has(messageId)) {
        clearTimeout(timer as NodeJS.Timeout);
        this.messageMap.delete(messageId);
        reject(new Error(reason));
      }
    };

    return { promise, cancel };
  }

  /**
   * Processes an incoming WebSocket message
   * @param message - The message received from the WebSocket server
   * @returns True if the message was handled, false if no matching request was found
   */
  handleMessage(message: HPKVResponse): void {
    const baseMessage = message as HPKVBaseResponse;
    const messageId = baseMessage.messageId;

    if (!messageId) {
      return;
    }

    const pendingRequest = this.messageMap.get(messageId);
    if (!pendingRequest) {
      // This might happen if a request timed out but the server still responded
      return;
    }

    if (baseMessage.code === 200) {
      pendingRequest.resolve(message);
    } else {
      Promise.resolve().then(() => {
        if ('code' in message && message.code === 429) {
          this.onRateLimitExceeded?.(message as HPKVErrorResponse);
        }
      });
      pendingRequest.reject(
        new HPKVError(
          baseMessage.error || baseMessage.message || 'Unknown error',
          baseMessage.code || 500
        )
      );
    }
    clearTimeout(pendingRequest.timer as NodeJS.Timeout);
    this.messageMap.delete(messageId);
  }

  /**
   * Type guard to check if a response is a notification
   */
  private isNotification(
    message: HPKVResponse
  ): message is import('./types').HPKVNotificationResponse {
    return 'type' in message && message.type === 'notification';
  }

  /**
   * Type guard to check if a response is an error response
   */
  private isErrorResponse(message: HPKVResponse): message is HPKVErrorResponse {
    return ('code' in message && message.code !== 200) || 'error' in message;
  }

  /**
   * Cancels all pending requests with the given error
   * @param error - The error to reject pending requests with
   */
  cancelAllRequests(error: Error): void {
    for (const [id, request] of this.messageMap.entries()) {
      clearTimeout(request.timer as NodeJS.Timeout);
      request.reject(error);
      this.messageMap.delete(id);
    }
  }

  /**
   * Removes stale requests that have been pending for too long
   */
  protected cleanupStaleRequests(): void {
    const now = Date.now();
    const staleThreshold = this.timeouts.OPERATION * 3;

    for (const [id, request] of this.messageMap.entries()) {
      const age = now - request.timestamp;

      if (age > staleThreshold) {
        clearTimeout(request.timer as NodeJS.Timeout);
        request.reject(
          new TimeoutError(`Request ${id} (${request.operation}) timed out after ${age}ms`)
        );
        this.messageMap.delete(id);
      }
    }
  }

  /**
   * Gets the number of pending requests
   */
  get pendingCount(): number {
    return this.messageMap.size;
  }

  /**
   * Destroys this handler and cleans up resources
   */
  destroy(): void {
    this.cancelAllRequests(new Error('Handler destroyed'));
    this.clearCleanupInterval();
  }
}

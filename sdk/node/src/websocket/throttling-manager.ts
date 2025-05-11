import { ThrottlingConfig, ThrottlingMetrics } from './types';

/**
 * Default throttling configuration
 */
const DEFAULT_THROTTLING: ThrottlingConfig = {
  enabled: true,
  rateLimit: 10, // Default to 10 requests per second
};

/**
 * Manages throttling of requests based on RTT and 429 errors
 */
export class ThrottlingManager {
  private currentRate: number;
  private throttleQueue: Array<() => void> = [];
  private processingQueue = false;
  private nextAvailableSlotTime = 0;
  private backoffUntil = 0;
  private backoffExponent = 0;
  private throttlingConfig: ThrottlingConfig;

  constructor(config?: Partial<ThrottlingConfig>) {
    this.throttlingConfig = {
      ...DEFAULT_THROTTLING,
      ...(config || {}),
    };
    this.currentRate = this.throttlingConfig.rateLimit || (DEFAULT_THROTTLING.rateLimit as number);
  }

  /**
   * Returns current throttling configuration
   */
  get config(): ThrottlingConfig {
    return { ...this.throttlingConfig };
  }

  /**
   * Returns current throttling metrics
   */
  getMetrics(): ThrottlingMetrics {
    return {
      currentRate: this.currentRate,
      queueLength: this.throttleQueue.length,
    };
  }

  /**
   * Updates the throttling configuration
   */
  updateConfig(config: Partial<ThrottlingConfig>): void {
    const wasEnabled = this.throttlingConfig.enabled;
    this.throttlingConfig = {
      ...this.throttlingConfig,
      ...config,
    };
    this.currentRate = Math.min(
      this.currentRate,
      this.throttlingConfig.rateLimit || (DEFAULT_THROTTLING.rateLimit as number)
    );

    if (wasEnabled && !this.throttlingConfig.enabled) {
      while (this.throttleQueue.length > 0) {
        const next = this.throttleQueue.shift();
        if (next) next();
      }
    }
  }

  /**
   * Notifies the throttler of a 429 error to apply backpressure
   */
  notify429(): void {
    if (Date.now() < this.backoffUntil) return; // Already in backoff

    this.currentRate = Math.max(
      (this.throttlingConfig.rateLimit || (DEFAULT_THROTTLING.rateLimit as number)) * 0.1,
      this.currentRate * 0.5
    );
    const backoffDelay = 1000 * Math.min(60, 2 ** this.backoffExponent);
    this.backoffUntil = Date.now() + backoffDelay;
    this.backoffExponent++;
  }

  /**
   * Adds a request to the throttle queue if needed, or executes immediately.
   */
  async throttleRequest(): Promise<void> {
    if (!this.throttlingConfig.enabled) {
      return Promise.resolve();
    }

    const now = Date.now();
    const minTimeBetweenRequests = 1000 / this.currentRate;

    // Determine the earliest time this request could run
    // Ensure the next slot isn't before the current time or any backoff period
    const earliestRunTime = Math.max(now, this.nextAvailableSlotTime, this.backoffUntil);

    if (earliestRunTime <= now) {
      // Fast path: Can run immediately without violating rate limit
      this.nextAvailableSlotTime = now + minTimeBetweenRequests; // Reserve slot for the next one
      return Promise.resolve(); // Allow request to proceed immediately
    } else {
      // Slow path: Must wait for the calculated slot
      return new Promise<void>(resolve => {
        this.throttleQueue.push(resolve); // Add to the queue
        if (!this.processingQueue) {
          // Start processing the queue if it wasn't already active
          this.processThrottleQueue();
        }
      });
    }
  }

  /**
   * Processes the throttle queue based on the current rate
   */
  private processThrottleQueue(): void {
    if (this.throttleQueue.length === 0) {
      this.processingQueue = false;
      return;
    }

    this.processingQueue = true;
    const now = Date.now();

    // Ensure next slot is not in the past relative to now
    this.nextAvailableSlotTime = Math.max(now, this.nextAvailableSlotTime);

    // Check for backoff period
    if (now < this.backoffUntil) {
      // If backing off, the next available slot should also respect the backoff period
      this.nextAvailableSlotTime = Math.max(this.nextAvailableSlotTime, this.backoffUntil);

      const backoffWait = this.nextAvailableSlotTime - now;
      setTimeout(() => this.processThrottleQueue(), backoffWait);
      return;
    }

    const minTimeBetweenRequests = 1000 / this.currentRate; // in ms

    // Calculate time to wait until the next available slot
    const timeToWait = this.nextAvailableSlotTime - now;

    // Schedule the next request processing
    setTimeout(() => {
      // Dequeue *before* resolving, in case resolve() triggers another request quickly
      const next = this.throttleQueue.shift();
      if (next) {
        next(); // Resolve the promise, allowing the request to proceed
      }

      // Check if more items are waiting and continue processing
      // This recursive call ensures the queue keeps moving
      if (this.throttleQueue.length > 0) {
        this.processThrottleQueue();
      } else {
        this.processingQueue = false;
      }
    }, timeToWait);

    // Increment the next available slot time for the *subsequent* request
    this.nextAvailableSlotTime += minTimeBetweenRequests;
  }

  /**
   * Cleans up resources
   */
  destroy(): void {
    while (this.throttleQueue.length > 0) {
      const next = this.throttleQueue.shift();
      if (next) next();
    }
  }
}

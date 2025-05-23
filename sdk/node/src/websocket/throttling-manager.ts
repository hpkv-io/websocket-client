import { ThrottlingConfig, ThrottlingMetrics } from './types';

/**
 * Default throttling configuration
 */
const DEFAULT_THROTTLING: ThrottlingConfig = {
  enabled: true,
  rateLimit: 10,
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
    this.currentRate = this.throttlingConfig.rateLimit || (DEFAULT_THROTTLING.rateLimit as number);

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
    if (Date.now() < this.backoffUntil) return;

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

    const earliestRunTime = Math.max(now, this.nextAvailableSlotTime, this.backoffUntil);

    if (earliestRunTime <= now) {
      this.nextAvailableSlotTime = now + minTimeBetweenRequests;
      return Promise.resolve();
    } else {
      return new Promise<void>(resolve => {
        this.throttleQueue.push(resolve);
        if (!this.processingQueue) {
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

    this.nextAvailableSlotTime = Math.max(now, this.nextAvailableSlotTime);

    if (now < this.backoffUntil) {
      this.nextAvailableSlotTime = Math.max(this.nextAvailableSlotTime, this.backoffUntil);

      const backoffWait = this.nextAvailableSlotTime - now;
      setTimeout(() => this.processThrottleQueue(), backoffWait);
      return;
    }

    const minTimeBetweenRequests = 1000 / this.currentRate;

    const timeToWait = this.nextAvailableSlotTime - now;

    setTimeout(() => {
      const next = this.throttleQueue.shift();
      if (next) {
        next();
      }

      if (this.throttleQueue.length > 0) {
        this.processThrottleQueue();
      } else {
        this.processingQueue = false;
      }
    }, timeToWait);

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

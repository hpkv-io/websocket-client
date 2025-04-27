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
  private rttSamples: number[] = [];
  private throttleQueue: Array<() => void> = [];
  private processingQueue = false;
  private lastRequestTime = 0;
  private lastRtt = 0;
  private backoffUntil = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private throttlingConfig: ThrottlingConfig;

  constructor(config?: Partial<ThrottlingConfig>) {
    this.throttlingConfig = {
      ...DEFAULT_THROTTLING,
      ...(config || {}),
    };
    this.currentRate = this.throttlingConfig.rateLimit;
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
      avgRtt:
        this.rttSamples.length > 0
          ? this.rttSamples.reduce((sum, val) => sum + val, 0) / this.rttSamples.length
          : null,
      queueLength: this.throttleQueue.length,
      rttSamples: [...this.rttSamples],
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
    this.currentRate = Math.min(this.currentRate, this.throttlingConfig.rateLimit);

    if (!wasEnabled && this.throttlingConfig.enabled && this.pingInterval === null) {
      // Client should call initPingInterval
    } else if (wasEnabled && !this.throttlingConfig.enabled) {
      this.clearPingInterval();
      while (this.throttleQueue.length > 0) {
        const next = this.throttleQueue.shift();
        if (next) next();
      }
    }
  }

  /**
   * Initializes periodic RTT measurement
   */
  initPingInterval(pingFunction: () => Promise<{ status: number; rtt: number }>): void {
    this.clearPingInterval();
    if (!this.throttlingConfig.enabled) return;

    this.pingInterval = setInterval(async () => {
      try {
        const { status, rtt } = await pingFunction();
        if (status === 200) {
          this.updateRtt(rtt);
        }
      } catch (error) {
        console.warn('Ping failed:', error);
      }
    }, 1000); // Ping every second
  }

  /**
   * Clears the ping interval
   */
  private clearPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Updates RTT samples and adjusts rate based on RTT trend
   */
  private updateRtt(rtt: number): void {
    this.rttSamples.push(rtt);
    if (this.rttSamples.length > 5) this.rttSamples.shift(); // Keep last 5 samples

    const avgRtt = this.rttSamples.reduce((sum, val) => sum + val, 0) / this.rttSamples.length;

    // Detect RTT trend
    if (rtt > this.lastRtt && rtt > avgRtt) {
      // RTT increasing: apply backpressure
      this.currentRate = Math.max(this.config.rateLimit * 0.1, this.currentRate * 0.5);
    } else if (rtt < this.lastRtt && rtt < avgRtt && Date.now() > this.backoffUntil) {
      // RTT decreasing: cautiously increase rate
      this.currentRate = Math.min(this.config.rateLimit, this.currentRate * 1.2);
    }

    this.lastRtt = rtt;
  }

  /**
   * Notifies the throttler of a 429 error to apply backpressure
   */
  notify429(): void {
    if (Date.now() < this.backoffUntil) return; // Already in backoff

    this.currentRate = Math.max(this.throttlingConfig.rateLimit * 0.1, this.currentRate * 0.5);
    this.backoffUntil = Date.now() + 1000 * Math.min(60, 2 ** this.rttSamples.length); // Exponential backoff
  }

  /**
   * Adds a request to the throttle queue
   */
  async throttleRequest(): Promise<void> {
    if (!this.throttlingConfig.enabled) return Promise.resolve();

    return new Promise<void>(resolve => {
      this.throttleQueue.push(resolve);
      if (!this.processingQueue) {
        this.processThrottleQueue();
      }
    });
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

    if (now < this.backoffUntil) {
      setTimeout(() => this.processThrottleQueue(), this.backoffUntil - now);
      return;
    }

    const minTimeBetweenRequests = 1000 / this.currentRate; // in ms
    const timeToWait = Math.max(0, this.lastRequestTime + minTimeBetweenRequests - now);

    setTimeout(() => {
      const next = this.throttleQueue.shift();
      if (next) {
        this.lastRequestTime = Date.now();
        next();
      }
      this.processThrottleQueue();
    }, timeToWait);
  }

  /**
   * Cleans up resources
   */
  destroy(): void {
    this.clearPingInterval();
    while (this.throttleQueue.length > 0) {
      const next = this.throttleQueue.shift();
      if (next) next();
    }
  }
}

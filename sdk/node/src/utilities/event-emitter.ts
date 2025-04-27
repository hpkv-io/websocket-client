/**
 * SimpleEventEmitter
 *
 * A lightweight implementation of the EventEmitter pattern.
 * Provides methods to register event listeners, emit events, and manage subscriptions.

 */
class SimpleEventEmitter {
  private events: Record<string, Array<(...args: any[]) => void>> = {};

  /**
   * Register an event listener for the specified event
   *
   * @param event - The event name to listen for
   * @param listener - The callback function to execute when the event is emitted
   * @returns The emitter instance for chaining

   */
  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return this;
  }

  /**
   * Remove a previously registered event listener
   *
   * @param event - The event name
   * @param listener - The callback function to remove
   * @returns The emitter instance for chaining
   */
  off(event: string, listener: (...args: any[]) => void): this {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter(l => l !== listener);
    }
    return this;
  }

  /**
   * Emit an event with the specified arguments
   *
   * @param event - The event name to emit
   * @param args - Arguments to pass to the event listeners
   * @returns `true` if the event had listeners, `false` otherwise
   */
  emit(event: string, ...args: any[]): boolean {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
      return true;
    }
    return false;
  }

  /**
   * Remove all listeners for the specified event, or all events if no event is provided
   *
   * @param event - Optional event name. If not provided, all events will be cleared.
   * @returns The emitter instance for chaining
   */
  removeAllListeners(event?: string): this {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
    return this;
  }
}

export default SimpleEventEmitter;

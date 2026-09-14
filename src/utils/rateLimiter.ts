interface RateLimitState {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private windows = new Map<string, RateLimitState>();

  constructor(
    private maxRequests: number,
    private windowMs: number
  ) {}

  isAllowed(key: string): boolean {
    const now = Date.now();
    const state = this.windows.get(key) ?? { timestamps: [] };

    // Remove expired timestamps
    state.timestamps = state.timestamps.filter(t => now - t < this.windowMs);

    if (state.timestamps.length >= this.maxRequests) {
      this.windows.set(key, state);
      return false;
    }

    state.timestamps.push(now);
    this.windows.set(key, state);
    return true;
  }

  getRemaining(key: string): number {
    const now = Date.now();
    const state = this.windows.get(key) ?? { timestamps: [] };
    state.timestamps = state.timestamps.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxRequests - state.timestamps.length);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, state] of this.windows) {
      state.timestamps = state.timestamps.filter(t => now - t < this.windowMs);
      if (state.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}

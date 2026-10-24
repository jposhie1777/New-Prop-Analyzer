export interface RateBudgetOptions {
  requestsPerMinute: number;
  windowMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export class RateBudget {
  readonly requestsPerMinute: number;
  private readonly windowMs: number;
  private readonly currentTime: () => number;
  private readonly sleepFor: (delayMs: number) => Promise<void>;
  private grantTimestamps: number[] = []; // start times of calls inside the sliding window
  private pendingChain: Promise<void> = Promise.resolve(); // serializes acquire() so concurrent callers can't overshoot
  private peakPerMinute = 0;

  constructor(options: RateBudgetOptions) {
    this.requestsPerMinute = Math.max(1, Math.floor(options.requestsPerMinute));
    this.windowMs = options.windowMs ?? 60_000;
    this.currentTime = options.now ?? Date.now;
    this.sleepFor = options.sleep ?? defaultSleep;
  }

  acquire(): Promise<void> {
    const grant = this.pendingChain.then(() => this.waitForSlot());
    this.pendingChain = grant.catch(() => undefined);
    return grant;
  }

  usedInWindow(): number {
    this.pruneOld(this.currentTime());
    return this.grantTimestamps.length;
  }

  peakObservedPerMinute(): number {
    return this.peakPerMinute;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const nowMs = this.currentTime();
      this.pruneOld(nowMs);
      if (this.grantTimestamps.length < this.requestsPerMinute) {
        this.grantTimestamps.push(nowMs);
        this.peakPerMinute = Math.max(this.peakPerMinute, this.grantTimestamps.length);
        return;
      }
      const oldestGrant = this.grantTimestamps[0];
      await this.sleepFor(Math.max(1, oldestGrant + this.windowMs - nowMs + 5)); // wait until the oldest call leaves the window
    }
  }

  private pruneOld(nowMs: number): void {
    while (this.grantTimestamps.length > 0 && this.grantTimestamps[0] <= nowMs - this.windowMs) this.grantTimestamps.shift();
  }
}

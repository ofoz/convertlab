type Bucket = { hits: number[]; blockedUntil: number };

/**
 * Small in-process sliding-window limiter. Adequate for the single-node
 * deployment this project targets; a multi-node setup should move this to Redis.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(windowMs: number, maxKeys = 20_000) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  hit(key: string, limit: number, windowMs = this.windowMs): { allowed: boolean; retryAfterMs: number; remaining: number } {
    const now = Date.now();
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { hits: [], blockedUntil: 0 };
      this.buckets.set(key, bucket);
    }
    if (bucket.blockedUntil > now) {
      return { allowed: false, retryAfterMs: bucket.blockedUntil - now, remaining: 0 };
    }
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length >= limit) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
      bucket.blockedUntil = now + retryAfterMs;
      return { allowed: false, retryAfterMs, remaining: 0 };
    }
    bucket.hits.push(now);
    return { allowed: true, retryAfterMs: 0, remaining: limit - bucket.hits.length };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000 && this.buckets.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      const stale = bucket.hits.length === 0 || now - (bucket.hits.at(-1) ?? now) > this.windowMs * 4;
      if (stale && bucket.blockedUntil <= now) this.buckets.delete(key);
    }
  }
}

export const limiters = {
  login: new RateLimiter(15 * 60 * 1000),
  register: new RateLimiter(60 * 60 * 1000),
  password: new RateLimiter(15 * 60 * 1000),
  jobs: new RateLimiter(60 * 1000),
  admin: new RateLimiter(60 * 1000),
};

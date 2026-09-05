export type RateLimitResult = {
  allowed: boolean;
  count: number;
  resetAt: number;
};

/**
 * Single-process rate-limit abstraction.
 * Replace this implementation with a shared Redis/database implementation
 * when the API is deployed on multiple instances.
 * Multi-instance deployments are NOT supported by this implementation.
 */
export interface RateLimiter {
  consume(key: string, limit: number, windowMs?: number): RateLimitResult;
  clearExpired(now?: number): void;
  clear(): void;
}

type Bucket = { count: number; resetAt: number };

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMs = 60_000): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
    }
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return { allowed: bucket.count <= limit, count: bucket.count, resetAt: bucket.resetAt };
  }

  clearExpired(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  clear(): void {
    this.buckets.clear();
  }
}

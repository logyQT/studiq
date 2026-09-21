/**
 * In-memory sliding-window rate limiter. No shared cache (Redis/Upstash etc.)
 * exists anywhere in this codebase yet, so this is scoped to a single server
 * process — correct for one Node instance, not for multiple instances behind
 * a load balancer sharing no state. Good enough to stop single-instance
 * burst abuse now; swap the Map for a shared store if the deployment target
 * ever needs cross-instance limits.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export function createRateLimiter(windowMs: number, maxRequests: number) {
  const requestLog = new Map<string, number[]>();

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      const recent = (requestLog.get(key) ?? []).filter((t) => now - t < windowMs);

      if (recent.length >= maxRequests) {
        requestLog.set(key, recent);
        return { allowed: false, retryAfterMs: windowMs - (now - recent[0]) };
      }

      recent.push(now);
      requestLog.set(key, recent);
      return { allowed: true };
    },
  };
}

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
  let lastPruneAt = -Infinity;

  return {
    check(key: string, now: number = Date.now()): RateLimitResult {
      // At most one O(n) prune per window: running it on every call while the
      // map stays above the threshold would turn the limiter into the bottleneck.
      if (requestLog.size > 10_000 && now - lastPruneAt >= windowMs) {
        lastPruneAt = now;
        // Prune only keys with no request left in the current window. Clearing
        // the whole map would hand every active user a fresh budget at exactly
        // the traffic level the limiter exists to bound.
        for (const [entryKey, timestamps] of requestLog) {
          const recent = timestamps.filter((t) => now - t < windowMs);
          if (recent.length === 0) requestLog.delete(entryKey);
          else requestLog.set(entryKey, recent);
        }
      }

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

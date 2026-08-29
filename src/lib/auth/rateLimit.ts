/**
 * Login attempt throttling (credential brute-force / password spraying).
 *
 * SCOPE — read this before deploying more than one instance:
 * The counters live in a plain in-process Map. That is genuinely sufficient
 * for the single-instance app this is today (see the README note on the
 * in-process job runner, which has the same constraint), but it means:
 *   - counters reset on restart;
 *   - with N instances behind a load balancer an attacker gets N x the
 *     allowance, since each process counts separately.
 * Moving to Redis is the fix when a second instance appears. Deliberately not
 * building a distributed limiter for a one-box app.
 *
 * TWO KEYS, BOTH ENFORCED:
 *   - per email: stops someone grinding one account from many addresses;
 *   - per IP: stops password spraying, where one host tries one password
 *     across many accounts and never trips a per-email counter.
 * Either being locked blocks the attempt.
 */

export interface RateLimitConfig {
  maxAttempts: number;
  /** How long failures are remembered, ms. */
  windowMs: number;
  /** How long the lockout lasts once tripped, ms. */
  lockoutMs: number;
}

export const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
};

interface Entry {
  failures: number[];
  lockedUntil: number;
}

const buckets = new Map<string, Entry>();

/** Stops the Map growing without bound on a long-running process. */
function sweep(now: number, config: RateLimitConfig): void {
  if (buckets.size < 5000) return;
  for (const [key, entry] of buckets) {
    const stale =
      entry.lockedUntil <= now &&
      entry.failures.every((t) => now - t > config.windowMs);
    if (stale) buckets.delete(key);
  }
}

export interface LimitStatus {
  limited: boolean;
  /** Seconds until the caller may try again. 0 when not limited. */
  retryAfterSeconds: number;
}

/**
 * Checks a key WITHOUT recording anything. `now` is injectable so tests can
 * advance the clock instead of sleeping through a 15-minute window.
 */
export function checkLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): LimitStatus {
  const entry = buckets.get(key);
  if (!entry) return { limited: false, retryAfterSeconds: 0 };

  if (entry.lockedUntil > now) {
    return {
      limited: true,
      retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/** Records a failure and locks the key once the threshold is crossed. */
export function recordFailure(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
): LimitStatus {
  const entry = buckets.get(key) ?? { failures: [], lockedUntil: 0 };

  // Sliding window: forget failures older than windowMs.
  entry.failures = entry.failures.filter((t) => now - t < config.windowMs);
  entry.failures.push(now);

  if (entry.failures.length >= config.maxAttempts) {
    entry.lockedUntil = now + config.lockoutMs;
    // Reset the counter so the lockout is not immediately re-armed by stale
    // failures the moment it expires.
    entry.failures = [];
  }

  buckets.set(key, entry);
  sweep(now, config);
  return checkLimit(key, config, now);
}

/**
 * Clears a key after a successful login.
 *
 * Only the EMAIL key should be cleared on success — clearing the IP key would
 * let an attacker reset their spraying budget by logging into any account they
 * legitimately control.
 */
export function clearKey(key: string): void {
  buckets.delete(key);
}

/** Test hook — wipes all counters. */
export function resetAllLimits(): void {
  buckets.clear();
}

export const emailKey = (email: string) => `email:${email.trim().toLowerCase()}`;
export const ipKey = (ip: string) => `ip:${ip}`;

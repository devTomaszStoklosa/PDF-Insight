import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { RateLimitDecision, RateLimiter } from './rateLimit.ts';

/** Analyses one client may request: a short window against bursts, a daily one for volume. */
export const RATE_LIMITS = { perMinute: 5, perDay: 30 } as const;

// After this long the store counts as unavailable, so a slow Redis cannot delay analyses.
const STORE_TIMEOUT_MS = 1_000;
const KEY_PREFIX = 'pdf-insight:ratelimit';

/** The part of a @upstash/ratelimit limiter this adapter uses. */
export interface WindowLimiter {
  limit(identifier: string): Promise<{ success: boolean; reset: number; reason?: string }>;
}

/** Allows a request only when every window allows it, checking them in order. */
export class UpstashRateLimiter implements RateLimiter {
  readonly #windows: readonly WindowLimiter[];
  readonly #now: () => number;

  constructor(windows: readonly WindowLimiter[], now: () => number = Date.now) {
    this.#windows = windows;
    this.#now = now;
  }

  async check(clientId: string): Promise<RateLimitDecision> {
    for (const window of this.#windows) {
      const result = await window.limit(clientId);
      // @upstash/ratelimit lets the request through on a timeout; report it instead, so the
      // caller decides and logs it.
      if (result.reason === 'timeout') {
        throw new Error('Rate limit store timed out');
      }
      if (!result.success) {
        const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - this.#now()) / 1000));
        return { allowed: false, retryAfterSeconds };
      }
    }
    return { allowed: true };
  }
}

export function createUpstashRateLimiter(options: { url: string; token: string }): RateLimiter {
  const redis = new Redis({
    url: options.url,
    token: options.token,
    enableTelemetry: false,
    retry: { retries: 1 },
  });
  const window = (name: string, limiter: ConstructorParameters<typeof Ratelimit>[0]['limiter']) =>
    new Ratelimit({
      redis,
      limiter,
      prefix: `${KEY_PREFIX}:${name}`,
      timeout: STORE_TIMEOUT_MS,
      analytics: false,
    });

  return new UpstashRateLimiter([
    window('minute', Ratelimit.slidingWindow(RATE_LIMITS.perMinute, '1 m')),
    window('day', Ratelimit.slidingWindow(RATE_LIMITS.perDay, '1 d')),
  ]);
}

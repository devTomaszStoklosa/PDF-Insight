import { createHash } from 'node:crypto';

export type RateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/** Limits how often one client may request an analysis. */
export interface RateLimiter {
  /** Rejects when the limit store fails or does not answer in time. */
  check(clientId: string): Promise<RateLimitDecision>;
}

// Requests without an address share one bucket. On Vercel both headers are always set.
const UNKNOWN_CLIENT = 'unknown';

/**
 * Identifies the client by its IP address, hashed so the limit store never holds raw
 * addresses. Vercel sets x-real-ip and x-forwarded-for itself and overwrites the values a
 * client sends; the local dev server passes them through, which is acceptable on loopback.
 */
export function clientIdOf(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0];
  const address = (headers.get('x-real-ip') ?? forwardedFor)?.trim();
  const client = address === undefined || address === '' ? UNKNOWN_CLIENT : address;
  return createHash('sha256').update(client).digest('hex');
}

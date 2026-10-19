// CORS only tells browsers which sites may read responses. It does not authenticate
// callers: any non-browser client can send an allowed Origin header.

const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Exact match only: the request origin is never reflected unless it is allowlisted. */
export function isOriginAllowed(
  origin: string | null,
  allowedOrigins: ReadonlySet<string>,
): origin is string {
  return origin !== null && allowedOrigins.has(origin);
}

/** Sent on every response, so caches never reuse a response across origins. */
export const VARY_ORIGIN: Readonly<Record<string, string>> = { Vary: 'Origin' };

export function corsHeaders(origin: string): Record<string, string> {
  return { ...VARY_ORIGIN, 'Access-Control-Allow-Origin': origin };
}

export function preflightHeaders(origin: string): Record<string, string> {
  return {
    ...corsHeaders(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
  };
}

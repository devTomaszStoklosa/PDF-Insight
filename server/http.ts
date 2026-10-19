import type { HttpError } from './errors.ts';

export type HeaderInput = Headers | Readonly<Record<string, string>>;

// Responses carry document data, so no shared cache may store them.
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function mergeHeaders(extra: HeaderInput | undefined): Headers {
  const headers = new Headers(BASE_HEADERS);
  new Headers(extra).forEach((value, name) => {
    headers.set(name, value);
  });
  return headers;
}

export function jsonResponse(body: unknown, status: number, headers?: HeaderInput): Response {
  const responseHeaders = mergeHeaders(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

export function emptyResponse(status: number, headers?: HeaderInput): Response {
  return new Response(null, { status, headers: mergeHeaders(headers) });
}

export function errorResponse(error: HttpError, headers?: HeaderInput): Response {
  const responseHeaders = mergeHeaders(headers);
  if (error.retryAfterSeconds !== undefined) {
    responseHeaders.set('Retry-After', String(error.retryAfterSeconds));
  }
  return jsonResponse(error.toBody(), error.status, responseHeaders);
}

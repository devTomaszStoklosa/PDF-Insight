import { analyzeDocument, InvalidLlmOutputError } from './analyzeDocument.ts';
import type { ServerConfig } from './config.ts';
import { corsHeaders, isOriginAllowed, preflightHeaders, VARY_ORIGIN } from './cors.ts';
import { HttpError, type ApiErrorCode } from './errors.ts';
import { emptyResponse, errorResponse, jsonResponse, type HeaderInput } from './http.ts';
import { LlmError, type LlmClient, type LlmErrorKind } from './llmClient.ts';
import { clientIdOf, type RateLimitDecision, type RateLimiter } from './rateLimit.ts';
import { parseAnalyzeRequest } from './requestBody.ts';

/**
 * What may be logged about a failure: codes only, never document content, client addresses
 * or secrets. RATE_LIMIT_UNAVAILABLE is logged without failing the request.
 */
export interface ErrorLogEntry {
  readonly code: ApiErrorCode | 'RATE_LIMIT_UNAVAILABLE';
  readonly upstreamStatus?: number;
}

export interface RequestDependencies {
  /** Throws an HttpError (SERVER_MISCONFIGURED) when the environment is invalid. */
  readonly loadConfig: () => ServerConfig;
  readonly createLlmClient: (config: ServerConfig) => LlmClient;
  readonly createRateLimiter: (config: ServerConfig) => RateLimiter;
  readonly logError: (entry: ErrorLogEntry) => void;
}

// Client errors (4xx) are expected and not logged, except these, which show quota pressure.
const LOGGED_CLIENT_ERRORS: ReadonlySet<ApiErrorCode> = new Set([
  'LLM_QUOTA_EXCEEDED',
  'RATE_LIMITED',
]);

const LLM_ERROR_CODES: Readonly<Record<LlmErrorKind, ApiErrorCode>> = {
  quota_exceeded: 'LLM_QUOTA_EXCEEDED',
  misconfigured: 'SERVER_MISCONFIGURED',
  unavailable: 'LLM_UNAVAILABLE',
  timeout: 'LLM_TIMEOUT',
};

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof LlmError) {
    return new HttpError(LLM_ERROR_CODES[error.kind], {
      retryAfterSeconds: error.retryAfterSeconds,
      cause: error,
    });
  }
  if (error instanceof InvalidLlmOutputError) {
    return new HttpError('LLM_INVALID_OUTPUT', { cause: error });
  }
  return new HttpError('INTERNAL_ERROR', { cause: error });
}

function upstreamStatusOf(error: HttpError): number | undefined {
  return error.cause instanceof LlmError ? error.cause.upstreamStatus : undefined;
}

function failure(
  error: unknown,
  logError: RequestDependencies['logError'],
  headers: HeaderInput,
): Response {
  const httpError = toHttpError(error);
  if (httpError.status >= 500 || LOGGED_CLIENT_ERRORS.has(httpError.code)) {
    const upstreamStatus = upstreamStatusOf(httpError);
    logError(
      upstreamStatus === undefined
        ? { code: httpError.code }
        : { code: httpError.code, upstreamStatus },
    );
  }
  return errorResponse(httpError, headers);
}

async function checkRateLimit(
  request: Request,
  limiter: RateLimiter,
  logError: RequestDependencies['logError'],
): Promise<RateLimitDecision> {
  try {
    return await limiter.check(clientIdOf(request.headers));
  } catch {
    // Fail open: an unreachable limit store must not take the demo down. The LLM key has no
    // billing, so the worst case is the same as reaching the provider's quota.
    logError({ code: 'RATE_LIMIT_UNAVAILABLE' });
    return { allowed: true };
  }
}

/** Handles POST /api/analyze and its CORS preflight. */
export async function handleRequest(
  request: Request,
  dependencies: RequestDependencies,
): Promise<Response> {
  let config: ServerConfig;
  try {
    config = dependencies.loadConfig();
  } catch (error) {
    return failure(error, dependencies.logError, VARY_ORIGIN);
  }

  const origin = request.headers.get('origin');
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return errorResponse(new HttpError('ORIGIN_NOT_ALLOWED'), VARY_ORIGIN);
  }

  if (request.method === 'OPTIONS') {
    return emptyResponse(204, preflightHeaders(origin));
  }
  if (request.method !== 'POST') {
    return errorResponse(new HttpError('METHOD_NOT_ALLOWED'), {
      ...corsHeaders(origin),
      Allow: 'POST, OPTIONS',
    });
  }

  try {
    // Checked before the body is read, so a limited request costs one store call only.
    const decision = await checkRateLimit(
      request,
      dependencies.createRateLimiter(config),
      dependencies.logError,
    );
    if (!decision.allowed) {
      throw new HttpError('RATE_LIMITED', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    const input = await parseAnalyzeRequest(request);
    const insight = await analyzeDocument(input, dependencies.createLlmClient(config));
    return jsonResponse(insight, 200, corsHeaders(origin));
  } catch (error) {
    return failure(error, dependencies.logError, corsHeaders(origin));
  }
}

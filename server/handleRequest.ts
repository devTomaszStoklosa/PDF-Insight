import { analyzeDocument, InvalidLlmOutputError } from './analyzeDocument.ts';
import type { ServerConfig } from './config.ts';
import { corsHeaders, isOriginAllowed, preflightHeaders, VARY_ORIGIN } from './cors.ts';
import { HttpError, type ApiErrorCode } from './errors.ts';
import { emptyResponse, errorResponse, jsonResponse, type HeaderInput } from './http.ts';
import { LlmError, type LlmClient, type LlmErrorKind } from './llmClient.ts';
import { parseAnalyzeRequest } from './requestBody.ts';

/** What may be logged about a failure: codes only, never document content or secrets. */
export interface ErrorLogEntry {
  readonly code: ApiErrorCode;
  readonly upstreamStatus?: number;
}

export interface RequestDependencies {
  /** Throws an HttpError (SERVER_MISCONFIGURED) when the environment is invalid. */
  readonly loadConfig: () => ServerConfig;
  readonly createLlmClient: (config: ServerConfig) => LlmClient;
  readonly logError: (entry: ErrorLogEntry) => void;
}

const LLM_ERROR_CODES: Readonly<Record<LlmErrorKind, ApiErrorCode>> = {
  quota_exceeded: 'LLM_QUOTA_EXCEEDED',
  misconfigured: 'SERVER_MISCONFIGURED',
  unavailable: 'LLM_UNAVAILABLE',
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
  // Client errors (4xx) are expected and not logged; quota exhaustion is worth knowing about.
  if (httpError.status >= 500 || httpError.code === 'LLM_QUOTA_EXCEEDED') {
    const upstreamStatus = upstreamStatusOf(httpError);
    logError(
      upstreamStatus === undefined
        ? { code: httpError.code }
        : { code: httpError.code, upstreamStatus },
    );
  }
  return errorResponse(httpError, headers);
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
    const input = await parseAnalyzeRequest(request);
    const insight = await analyzeDocument(input, dependencies.createLlmClient(config));
    return jsonResponse(insight, 200, corsHeaders(origin));
  } catch (error) {
    return failure(error, dependencies.logError, corsHeaders(origin));
  }
}

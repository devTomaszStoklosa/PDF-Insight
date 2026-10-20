import { loadConfig } from '../server/config.ts';
import {
  ANALYSIS_BUDGET_MS,
  createGeminiLlmClient,
  type TransientErrorEvent,
} from '../server/geminiLlmClient.ts';
import { handleRequest, type RequestDependencies } from '../server/handleRequest.ts';
import { withAppVersion } from '../server/http.ts';
import { createUpstashRateLimiter } from '../server/upstashRateLimiter.ts';

// A warning, not an error: after a successful retry the analysis still succeeds. A failure
// that reaches the user is logged once more by handleRequest. Codes and statuses only; a
// timeout has no upstream status, and JSON.stringify leaves the undefined field out.
function logTransientError(event: TransientErrorEvent): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      source: 'api/analyze',
      code: 'LLM_TRANSIENT_ERROR',
      kind: event.kind,
      upstreamStatus: event.kind === 'server_error' ? event.upstreamStatus : undefined,
      retry: event.retry,
    }),
  );
}

// Vercel Node.js function using Web-standard Request/Response. The LLM API key and the
// Upstash token are read from server-side environment variables only and never reach the
// browser.
const dependencies: RequestDependencies = {
  loadConfig: () => loadConfig(process.env),
  // Created once per analysis, after the request is checked, so the deadline counts from there.
  createLlmClient: (config) =>
    createGeminiLlmClient({
      apiKey: config.llmApiKey,
      model: config.llmModel,
      deadline: Date.now() + ANALYSIS_BUDGET_MS,
      onTransientError: logTransientError,
    }),
  createRateLimiter: (config) => createUpstashRateLimiter(config.rateLimitStore),
  logError: (entry) => {
    console.error(JSON.stringify({ level: 'error', source: 'api/analyze', ...entry }));
  },
};

// Vercel sets VERCEL_GIT_COMMIT_SHA to the deployment's commit; the post-deploy check in the
// Pages workflow compares it with the commit it deployed.
async function respond(request: Request): Promise<Response> {
  return withAppVersion(
    await handleRequest(request, dependencies),
    process.env.VERCEL_GIT_COMMIT_SHA,
  );
}

export function POST(request: Request): Promise<Response> {
  return respond(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return respond(request);
}

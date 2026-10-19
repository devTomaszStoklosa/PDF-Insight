import { loadConfig } from '../server/config.ts';
import { createGeminiLlmClient } from '../server/geminiLlmClient.ts';
import { handleRequest, type RequestDependencies } from '../server/handleRequest.ts';
import { createUpstashRateLimiter } from '../server/upstashRateLimiter.ts';

// Vercel Node.js function using Web-standard Request/Response. The LLM API key and the
// Upstash token are read from server-side environment variables only and never reach the
// browser.
const dependencies: RequestDependencies = {
  loadConfig: () => loadConfig(process.env),
  createLlmClient: (config) =>
    createGeminiLlmClient({ apiKey: config.llmApiKey, model: config.llmModel }),
  createRateLimiter: (config) => createUpstashRateLimiter(config.rateLimitStore),
  logError: (entry) => {
    console.error(JSON.stringify({ level: 'error', source: 'api/analyze', ...entry }));
  },
};

export function POST(request: Request): Promise<Response> {
  return handleRequest(request, dependencies);
}

export function OPTIONS(request: Request): Promise<Response> {
  return handleRequest(request, dependencies);
}

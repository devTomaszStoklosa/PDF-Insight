import { loadConfig } from '../server/config.ts';
import { createGeminiLlmClient } from '../server/geminiLlmClient.ts';
import { handleRequest, type RequestDependencies } from '../server/handleRequest.ts';

// Vercel Node.js function using Web-standard Request/Response. The LLM API key is read
// from server-side environment variables only and never reaches the browser.
const dependencies: RequestDependencies = {
  loadConfig: () => loadConfig(process.env),
  createLlmClient: (config) =>
    createGeminiLlmClient({ apiKey: config.llmApiKey, model: config.llmModel }),
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

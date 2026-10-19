import { describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from './config.ts';
import { HttpError, type ApiErrorBody } from './errors.ts';
import { handleRequest, type RequestDependencies } from './handleRequest.ts';
import { LlmError, type LlmReply } from './llmClient.ts';
import { FEW_SHOT_EXAMPLES } from './prompt.ts';
import { createFakeLlmClient, textReply } from './test/fakeLlmClient.ts';

const ALLOWED_ORIGIN = 'https://devtomaszstoklosa.github.io';
const ENDPOINT = 'https://pdf-insight.example.test/api/analyze';
const DOCUMENT_TEXT = 'Poufna treść faktury nr 7/2024.';

const config: ServerConfig = {
  llmApiKey: 'test-key-secret',
  llmModel: 'gemini-test',
  allowedOrigins: new Set([ALLOWED_ORIGIN]),
};

const validOutput = FEW_SHOT_EXAMPLES[0]?.output;

function setup(replies: readonly (LlmReply | Error)[] = [textReply(validOutput)]) {
  const llm = createFakeLlmClient(replies);
  const logError = vi.fn<RequestDependencies['logError']>();
  const dependencies: RequestDependencies = {
    loadConfig: () => config,
    createLlmClient: () => llm.client,
    logError,
  };
  return { llm, logError, dependencies };
}

function analyzeRequest(
  options: { origin?: string | null; method?: string; body?: unknown } = {},
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const origin = options.origin === undefined ? ALLOWED_ORIGIN : options.origin;
  if (origin !== null) {
    headers.set('Origin', origin);
  }
  const method = options.method ?? 'POST';
  return new Request(ENDPOINT, {
    method,
    headers,
    body:
      method === 'POST'
        ? JSON.stringify(options.body ?? { fileName: 'f.pdf', pages: 1, text: DOCUMENT_TEXT })
        : undefined,
  });
}

async function errorBody(response: Response): Promise<ApiErrorBody> {
  return (await response.json()) as ApiErrorBody;
}

describe('handleRequest', () => {
  it('returns the validated analysis for an allowed origin', async () => {
    const { dependencies } = setup();

    const response = await handleRequest(analyzeRequest(), dependencies);

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    await expect(response.json()).resolves.toMatchObject({
      type: 'faktura',
      document: { fileName: 'f.pdf', pages: 1 },
    });
  });

  it('answers the CORS preflight', async () => {
    const { dependencies, llm } = setup();

    const response = await handleRequest(analyzeRequest({ method: 'OPTIONS' }), dependencies);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(llm.sentMessages).toHaveLength(0);
  });

  it.each([
    ['an unknown origin', 'https://evil.example'],
    ['a look-alike origin', 'https://devtomaszstoklosa.github.io.evil.example'],
    ['a missing origin', null],
  ])('rejects %s without calling the LLM', async (_case, origin) => {
    const { dependencies, llm } = setup();

    const response = await handleRequest(analyzeRequest({ origin }), dependencies);

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Origin');
    expect((await errorBody(response)).error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(llm.sentMessages).toHaveLength(0);
  });

  it('rejects other methods', async () => {
    const { dependencies } = setup();

    const response = await handleRequest(analyzeRequest({ method: 'GET' }), dependencies);

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    expect((await errorBody(response)).error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('rejects an invalid body with a Polish message', async () => {
    const { dependencies, llm } = setup();

    const response = await handleRequest(analyzeRequest({ body: { text: 1 } }), dependencies);

    expect(response.status).toBe(400);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(await errorBody(response)).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        message:
          'Nieprawidłowe dane wejściowe. Wymagane pola: fileName, pages i text z tekstem dokumentu.',
      },
    });
    expect(llm.sentMessages).toHaveLength(0);
  });

  it('returns 502 after two invalid LLM replies', async () => {
    const { dependencies, llm, logError } = setup([textReply('nope'), textReply('still nope')]);

    const response = await handleRequest(analyzeRequest(), dependencies);

    expect(response.status).toBe(502);
    expect(await errorBody(response)).toEqual({
      error: {
        code: 'LLM_INVALID_OUTPUT',
        message: 'Nie udało się uzyskać poprawnej analizy dokumentu. Spróbuj ponownie później.',
      },
    });
    expect(llm.sentMessages).toHaveLength(2);
    expect(logError).toHaveBeenCalledWith({ code: 'LLM_INVALID_OUTPUT' });
  });

  it('returns 429 with Retry-After when the free quota is exhausted', async () => {
    const { dependencies, logError } = setup([
      new LlmError('quota_exceeded', { upstreamStatus: 429, retryAfterSeconds: 30 }),
    ]);

    const response = await handleRequest(analyzeRequest(), dependencies);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect((await errorBody(response)).error.code).toBe('LLM_QUOTA_EXCEEDED');
    expect(logError).toHaveBeenCalledWith({ code: 'LLM_QUOTA_EXCEEDED', upstreamStatus: 429 });
  });

  it.each<[string, LlmError, number, string]>([
    [
      'an unavailable provider',
      new LlmError('unavailable', { upstreamStatus: 503 }),
      503,
      'LLM_UNAVAILABLE',
    ],
    [
      'a rejected API key',
      new LlmError('misconfigured', { upstreamStatus: 401 }),
      500,
      'SERVER_MISCONFIGURED',
    ],
  ])('maps %s', async (_case, error, status, code) => {
    const { dependencies } = setup([error]);

    const response = await handleRequest(analyzeRequest(), dependencies);

    expect(response.status).toBe(status);
    expect((await errorBody(response)).error.code).toBe(code);
  });

  it('returns 500 when the server configuration is invalid', async () => {
    const { dependencies, logError } = setup();
    const response = await handleRequest(analyzeRequest(), {
      ...dependencies,
      loadConfig: () => {
        throw new HttpError('SERVER_MISCONFIGURED');
      },
    });

    expect(response.status).toBe(500);
    expect((await errorBody(response)).error.code).toBe('SERVER_MISCONFIGURED');
    expect(logError).toHaveBeenCalledWith({ code: 'SERVER_MISCONFIGURED' });
  });

  it('hides unexpected errors behind a generic message', async () => {
    const { dependencies } = setup([new Error(`crash while reading ${DOCUMENT_TEXT}`)]);

    const response = await handleRequest(analyzeRequest(), dependencies);
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain(DOCUMENT_TEXT);
  });

  it('never logs document content or the API key', async () => {
    const { dependencies, logError } = setup([new Error(DOCUMENT_TEXT)]);

    await handleRequest(analyzeRequest(), dependencies);

    const logged = JSON.stringify(logError.mock.calls);
    expect(logged).not.toContain(DOCUMENT_TEXT);
    expect(logged).not.toContain(config.llmApiKey);
  });
});

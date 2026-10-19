import { readFileSync } from 'node:fs';
import type {
  GoogleGenAIInteraction,
  GoogleGenAIRequestOptions,
  Interactions,
} from '@google/genai';
import { describe, expect, it } from 'vitest';
import { ANALYZE_TIMEOUT_MS } from '../src/api/analyzeClient.ts';
import {
  ANALYSIS_BUDGET_MS,
  GeminiLlmClient,
  REQUEST_TIMEOUT_MS,
  toGeminiSchema,
  toLlmError,
  type InteractionsApi,
} from './geminiLlmClient.ts';
import { LlmError } from './llmClient.ts';
import { LLM_RESPONSE_JSON_SCHEMA } from './llmOutputSchema.ts';

type CreateParams = Interactions.CreateModelInteractionParamsNonStreaming;

const SESSION_OPTIONS = {
  systemInstruction: 'Return JSON.',
  responseSchema: { type: 'object', properties: { a: { type: 'string', minLength: 1 } } },
};

function interaction(
  status: GoogleGenAIInteraction['status'],
  steps: Interactions.Step[],
  outputText?: string,
): GoogleGenAIInteraction {
  return { id: 'interaction-1', status, steps, output_text: outputText };
}

function modelOutput(text: string): Interactions.Step {
  return { type: 'model_output', content: [{ type: 'text', text }] };
}

const thought: Interactions.Step = { type: 'thought', signature: 'signature-1' };

/** Records create() calls and answers with scripted interactions or errors. */
function fakeInteractions(responses: readonly (GoogleGenAIInteraction | Error)[]) {
  const queue = [...responses];
  const calls: CreateParams[] = [];
  const requestOptions: (GoogleGenAIRequestOptions | undefined)[] = [];
  const api: InteractionsApi = {
    create(params, options) {
      // Copy the input: the session must not mutate what it already sent.
      calls.push(structuredClone(params));
      requestOptions.push(options);
      const response = queue.shift();
      if (response === undefined) {
        return Promise.reject(new Error('Unexpected create call'));
      }
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    },
  };
  return { api, calls, requestOptions };
}

/** Mirrors the SDK error for `timeout_ms` running out: no status, matched by name. */
class FakeTimeoutError extends Error {
  constructor() {
    super('Request timed out.');
    this.name = 'APIConnectionTimeoutError';
  }
}

class FakeApiError extends Error {
  readonly status: number;
  readonly headers: Headers;

  constructor(status: number, headers: Record<string, string> = {}) {
    super(`${String(status)} upstream message quoting the document text`);
    this.status = status;
    this.headers = new Headers(headers);
  }
}

function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasKeyDeep(item, key));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(
      ([entryKey, entry]) => entryKey === key || hasKeyDeep(entry, key),
    );
  }
  return false;
}

describe('toGeminiSchema', () => {
  it('removes unsupported keywords at every level and keeps the rest', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        code: { type: 'string', pattern: '^[A-Z]{3}$', minLength: 3, maxLength: 3 },
        list: { type: 'array', minItems: 3, maxItems: 7, items: { type: 'string', minLength: 1 } },
        date: { anyOf: [{ type: 'string', format: 'date', pattern: '^\\d{4}' }, { type: 'null' }] },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['code', 'list', 'date', 'kind'],
      additionalProperties: false,
    };

    expect(toGeminiSchema(schema)).toEqual({
      type: 'object',
      properties: {
        code: { type: 'string' },
        list: { type: 'array', minItems: 3, maxItems: 7, items: { type: 'string' } },
        date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['code', 'list', 'date', 'kind'],
      additionalProperties: false,
    });
  });

  it('leaves no unsupported keyword in the analysis schema', () => {
    const schema = toGeminiSchema(LLM_RESPONSE_JSON_SCHEMA);

    for (const keyword of ['$schema', 'pattern', 'minLength', 'maxLength']) {
      expect(hasKeyDeep(schema, keyword)).toBe(false);
    }
    expect(hasKeyDeep(schema, 'minItems')).toBe(true);
  });
});

describe('GeminiLlmClient', () => {
  it('sends a stateless request constrained to JSON and returns the text', async () => {
    const fake = fakeInteractions([
      interaction('completed', [modelOutput('{"a":"b"}')], '{"a":"b"}'),
    ]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    const reply = await session.send('Analyze.');

    expect(reply).toEqual({ kind: 'text', text: '{"a":"b"}' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      model: 'gemini-test',
      store: false,
      system_instruction: 'Return JSON.',
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'Analyze.' }] }],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: { type: 'object', properties: { a: { type: 'string' } } },
      },
    });
    expect(fake.calls[0]?.previous_interaction_id).toBeUndefined();
  });

  it('asks for a low thinking level and limits each request to the timeout', async () => {
    const fake = fakeInteractions([interaction('completed', [modelOutput('{}')], '{}')]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    await session.send('Analyze.');

    expect(fake.calls[0]?.generation_config).toMatchObject({ thinking_level: 'low' });
    expect(fake.requestOptions[0]).toEqual({
      timeout_ms: REQUEST_TIMEOUT_MS,
      retries: { strategy: 'none' },
    });
  });

  it('cuts the request timeout to the time left before the deadline', async () => {
    const fake = fakeInteractions([
      interaction('completed', [modelOutput('{}')], '{}'),
      interaction('completed', [modelOutput('{}')], '{}'),
    ]);
    let now = 1_000;
    const client = new GeminiLlmClient(fake.api, 'gemini-test', {
      deadline: 1_000 + REQUEST_TIMEOUT_MS + 5_000,
      now: () => now,
    });

    await client.startSession(SESSION_OPTIONS).send('Analyze.');
    now += 15_000;
    await client.startSession(SESSION_OPTIONS).send('Analyze.');

    expect(fake.requestOptions.map((options) => options?.timeout_ms)).toEqual([
      REQUEST_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS - 10_000,
    ]);
  });

  it('fails as a timeout without a request once the deadline has passed', async () => {
    const fake = fakeInteractions([interaction('completed', [modelOutput('{}')], '{}')]);
    const client = new GeminiLlmClient(fake.api, 'gemini-test', {
      deadline: 5_000,
      now: () => 5_000,
    });

    const error: unknown = await client
      .startSession(SESSION_OPTIONS)
      .send('Analyze.')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('timeout');
    expect(fake.calls).toHaveLength(0);
  });

  it('fits a single-call analysis in the budget, and the budget in the outer time limits', () => {
    const vercelConfig = JSON.parse(
      readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
    ) as { functions: Record<string, { maxDuration: number }> };
    const maxDurationMs = (vercelConfig.functions['api/analyze.ts']?.maxDuration ?? 0) * 1000;

    // A request and its correction retry are never cut short by the deadline.
    expect(2 * REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(ANALYSIS_BUDGET_MS);
    expect(ANALYSIS_BUDGET_MS).toBeLessThan(ANALYZE_TIMEOUT_MS);
    expect(ANALYSIS_BUDGET_MS).toBeLessThan(maxDurationMs);
  });

  it('resends the full history, model steps unchanged, on the next message', async () => {
    const fake = fakeInteractions([
      interaction('completed', [thought, modelOutput('bad')], 'bad'),
      interaction('completed', [modelOutput('{}')], '{}'),
    ]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    await session.send('Analyze.');
    await session.send('Fix it.');

    expect(fake.calls[1]?.input).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: 'Analyze.' }] },
      thought,
      modelOutput('bad'),
      { type: 'user_input', content: [{ type: 'text', text: 'Fix it.' }] },
    ]);
  });

  it('does not duplicate user input echoed back in the response steps', async () => {
    const echoedInput: Interactions.Step = {
      type: 'user_input',
      content: [{ type: 'text', text: 'Analyze.' }],
    };
    const fake = fakeInteractions([
      interaction('completed', [echoedInput, modelOutput('bad')], 'bad'),
      interaction('completed', [modelOutput('{}')], '{}'),
    ]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    await session.send('Analyze.');
    await session.send('Fix it.');

    const inputs = fake.calls[1]?.input;
    expect(Array.isArray(inputs) ? inputs.length : 0).toBe(3);
  });

  it('reports an incomplete interaction as truncated output', async () => {
    const fake = fakeInteractions([interaction('incomplete', [modelOutput('{"a":')], '{"a":')]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    await expect(session.send('Analyze.')).resolves.toEqual({ kind: 'truncated' });
  });

  it.each<[string, GoogleGenAIInteraction]>([
    ['a failed interaction', interaction('failed', [])],
    ['a completed interaction without text', interaction('completed', [])],
  ])('treats %s as the provider being unavailable', async (_case, response) => {
    const fake = fakeInteractions([response]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    await expect(session.send('Analyze.')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('maps SDK errors to LlmError', async () => {
    const fake = fakeInteractions([new FakeApiError(429, { 'retry-after': '30' })]);
    const session = new GeminiLlmClient(fake.api, 'gemini-test').startSession(SESSION_OPTIONS);

    await expect(session.send('Analyze.')).rejects.toMatchObject({
      kind: 'quota_exceeded',
      retryAfterSeconds: 30,
    });
  });
});

describe('toLlmError', () => {
  it.each<[string, unknown, LlmError['kind'], number | undefined]>([
    ['a 429', new FakeApiError(429), 'quota_exceeded', 429],
    ['a 401', new FakeApiError(401), 'misconfigured', 401],
    ['a 403', new FakeApiError(403), 'misconfigured', 403],
    ['a 404', new FakeApiError(404), 'misconfigured', 404],
    ['a 400', new FakeApiError(400), 'misconfigured', 400],
    ['a 503', new FakeApiError(503), 'unavailable', 503],
    ['the request timeout', new FakeTimeoutError(), 'timeout', undefined],
    ['another error without a status', new Error('connection reset'), 'unavailable', undefined],
    ['a non-error value', 'boom', 'unavailable', undefined],
  ])('maps %s', (_case, error, kind, upstreamStatus) => {
    const llmError = toLlmError(error);

    expect(llmError).toBeInstanceOf(LlmError);
    expect(llmError.kind).toBe(kind);
    expect(llmError.upstreamStatus).toBe(upstreamStatus);
  });

  it('drops the provider message', () => {
    expect(toLlmError(new FakeApiError(500)).message).not.toContain('document text');
  });

  it('ignores an invalid Retry-After header', () => {
    expect(toLlmError(new FakeApiError(429, { 'retry-after': 'soon' })).retryAfterSeconds).toBe(
      undefined,
    );
  });
});

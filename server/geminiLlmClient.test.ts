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
  MIN_RETRY_TIME_MS,
  REQUEST_TIMEOUT_MS,
  toGeminiSchema,
  toLlmError,
  type InteractionsApi,
  type TransientErrorEvent,
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

describe('GeminiLlmClient retry after a transient error', () => {
  const completed = (text: string): GoogleGenAIInteraction =>
    interaction('completed', [modelOutput(text)], text);

  /** A client on a fake clock: waiting advances the clock instead of taking real time. */
  function clientOnClock(
    responses: readonly (GoogleGenAIInteraction | Error)[],
    {
      deadline = Number.POSITIVE_INFINITY,
      random = (): number => 0.5,
    }: { deadline?: number; random?: () => number } = {},
  ) {
    const fake = fakeInteractions(responses);
    const waits: number[] = [];
    const events: TransientErrorEvent[] = [];
    let now = 0;
    const client = new GeminiLlmClient(fake.api, 'gemini-test', {
      deadline,
      now: () => now,
      sleep: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
      random,
      onTransientError: (event) => events.push(event),
    });
    return { fake, waits, events, session: client.startSession(SESSION_OPTIONS) };
  }

  it.each([503, 500])('retries once after a %i and returns the reply', async (status) => {
    const { fake, waits, session } = clientOnClock([new FakeApiError(status), completed('{}')]);

    await expect(session.send('Analyze.')).resolves.toEqual({ kind: 'text', text: '{}' });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]).toEqual(fake.calls[0]);
    expect(waits).toHaveLength(1);
  });

  it.each([
    [0, 1_000],
    [0.5, 1_500],
    [0.999, 1_999],
  ])('waits 1 s plus jitter before the retry (random %f)', async (random, expectedWait) => {
    const { waits, session } = clientOnClock([new FakeApiError(503), completed('{}')], {
      random: () => random,
    });

    await session.send('Analyze.');

    expect(waits).toEqual([expectedWait]);
  });

  it('fails with the error of the retry when it fails too, after two requests', async () => {
    const { fake, session } = clientOnClock([new FakeApiError(503), new FakeApiError(500)]);

    await expect(session.send('Analyze.')).rejects.toMatchObject({
      kind: 'unavailable',
      upstreamStatus: 500,
    });
    expect(fake.calls).toHaveLength(2);
  });

  it('reports the error at once, without waiting, when too little time is left', async () => {
    // With the 1.5 s wait, 500 ms less than MIN_RETRY_TIME_MS would be left.
    const { fake, waits, session } = clientOnClock([new FakeApiError(503), completed('{}')], {
      deadline: MIN_RETRY_TIME_MS + 1_000,
    });

    await expect(session.send('Analyze.')).rejects.toMatchObject({
      kind: 'unavailable',
      upstreamStatus: 503,
    });
    expect(fake.calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('retries when exactly MIN_RETRY_TIME_MS is left after the wait', async () => {
    const { fake, session } = clientOnClock([new FakeApiError(503), completed('{}')], {
      deadline: MIN_RETRY_TIME_MS + 1_500,
    });

    await session.send('Analyze.');

    expect(fake.calls).toHaveLength(2);
  });

  it('cuts the timeout of the retry to the time left after the wait', async () => {
    const { fake, session } = clientOnClock([new FakeApiError(503), completed('{}')], {
      deadline: 20_000,
    });

    await session.send('Analyze.');

    expect(fake.requestOptions.map((options) => options?.timeout_ms)).toEqual([20_000, 18_500]);
  });

  it.each<[string, GoogleGenAIInteraction | Error]>([
    ['a 429', new FakeApiError(429)],
    ['a 400', new FakeApiError(400)],
    ['a 404', new FakeApiError(404)],
    ['a 504', new FakeApiError(504)],
    ['a timeout', new FakeTimeoutError()],
    ['a failed interaction', interaction('failed', [])],
  ])('does not retry after %s', async (_case, response) => {
    const { fake, waits, session } = clientOnClock([response, completed('{}')]);

    await expect(session.send('Analyze.')).rejects.toBeInstanceOf(LlmError);
    expect(fake.calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('reports a transient error whose retry succeeded', async () => {
    const { events, session } = clientOnClock([new FakeApiError(503), completed('{}')]);

    await session.send('Analyze.');

    expect(events).toEqual([{ upstreamStatus: 503, retry: 'succeeded' }]);
  });

  it('reports a transient error whose retry failed, with the status of the first error', async () => {
    const { events, session } = clientOnClock([new FakeApiError(500), new FakeApiError(503)]);

    await expect(session.send('Analyze.')).rejects.toBeInstanceOf(LlmError);

    expect(events).toEqual([{ upstreamStatus: 500, retry: 'failed' }]);
  });

  it('reports a transient error skipped for lack of time', async () => {
    const { events, session } = clientOnClock([new FakeApiError(503)], {
      deadline: MIN_RETRY_TIME_MS,
    });

    await expect(session.send('Analyze.')).rejects.toBeInstanceOf(LlmError);

    expect(events).toEqual([{ upstreamStatus: 503, retry: 'skipped' }]);
  });

  it.each<[string, GoogleGenAIInteraction | Error]>([
    ['a successful request', completed('{}')],
    ['a 429', new FakeApiError(429)],
    ['a 504', new FakeApiError(504)],
    ['a timeout', new FakeTimeoutError()],
  ])('reports nothing after %s', async (_case, response) => {
    const { events, session } = clientOnClock([response]);

    await session.send('Analyze.').catch(() => undefined);

    expect(events).toEqual([]);
  });

  it('keeps one copy of the message in the history after a retry', async () => {
    const { fake, session } = clientOnClock([
      new FakeApiError(503),
      completed('bad'),
      completed('{}'),
    ]);

    await session.send('Analyze.');
    await session.send('Fix it.');

    expect(fake.calls[2]?.input).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: 'Analyze.' }] },
      modelOutput('bad'),
      { type: 'user_input', content: [{ type: 'text', text: 'Fix it.' }] },
    ]);
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

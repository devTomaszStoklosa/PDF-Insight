import {
  GoogleGenAI,
  type GoogleGenAIInteraction,
  type GoogleGenAIRequestOptions,
  type Interactions,
} from '@google/genai';
import {
  LlmError,
  type JsonSchema,
  type LlmClient,
  type LlmReply,
  type LlmSession,
  type LlmSessionOptions,
} from './llmClient.ts';

type CreateParams = Interactions.CreateModelInteractionParamsNonStreaming;

/** The part of the SDK's `interactions` client this adapter uses. */
export interface InteractionsApi {
  create(
    params: CreateParams,
    options?: GoogleGenAIRequestOptions,
  ): Promise<GoogleGenAIInteraction>;
}

const MAX_OUTPUT_TOKENS = 16_000;
// Extraction and summarising need little reasoning. Not every model accepts 'minimal'
// (gemini-3.8-flash answers 400), so 'low' is the lowest level used.
const THINKING_LEVEL = 'low';
// Short enough that a single-call analysis, one request and its correction retry, always fits
// within ANALYSIS_BUDGET_MS.
export const REQUEST_TIMEOUT_MS = 25_000;
/**
 * Time the server gives one analysis. It stays below the browser's ANALYZE_TIMEOUT_MS (60 s,
 * src/api/analyzeClient.ts) and maxDuration in vercel.json, so the user gets the server's own
 * timeout error. A document analyzed in parts makes more requests, so their timeouts are cut
 * to the time left.
 */
export const ANALYSIS_BUDGET_MS = 50_000;

// No SDK retries: the SDK gives every attempt the full timeout and cannot check the analysis
// deadline, so the session retries transient errors itself.
function requestOptions(timeoutMs: number): GoogleGenAIRequestOptions {
  return { timeout_ms: timeoutMs, retries: { strategy: 'none' } };
}

// Server errors that the Gemini API documentation says to retry: 500 ("retry the request")
// and 503 ("temporarily overloaded or down", "wait and retry with exponential backoff").
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([500, 503]);
// The wait before the one retry: 1 s, as the documentation suggests, plus up to 1 s of jitter,
// so parts that failed together do not all retry at the same moment.
const RETRY_DELAY_MS = { base: 1_000, jitter: 1_000 } as const;
/**
 * A retry is made only if this much time is left after the wait. Part-sized requests took
 * 3.5–14 s on the free tier; with less time left, a retry would likely spend a request of the
 * quota and end as a timeout instead of the provider's error.
 */
export const MIN_RETRY_TIME_MS = 15_000;

function isTransient(error: unknown): error is LlmError {
  return (
    error instanceof LlmError &&
    error.upstreamStatus !== undefined &&
    TRANSIENT_STATUSES.has(error.upstreamStatus)
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Keywords Gemini does not document for response schemas. Zod still enforces them
// when the reply is validated.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set(['$schema', 'pattern', 'minLength', 'maxLength']);

/** Returns a copy of the schema without keywords Gemini does not support. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(toGeminiSchema);
  }
  if (typeof schema === 'object' && schema !== null) {
    return Object.fromEntries(
      Object.entries(schema)
        .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYWORDS.has(key))
        .map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  return schema;
}

function readStatus(error: unknown): number | undefined {
  // The SDK's interaction error classes are not exported, so match on their `status` field.
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

function isTimeout(error: unknown): boolean {
  // The SDK reports `timeout_ms` running out as APIConnectionTimeoutError, which has no
  // status and is not exported either.
  return error instanceof Error && error.name === 'APIConnectionTimeoutError';
}

function readRetryAfterSeconds(error: unknown): number | undefined {
  if (!(error instanceof Error && 'headers' in error && error.headers instanceof Headers)) {
    return undefined;
  }
  const seconds = Number(error.headers.get('retry-after'));
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}

/** Maps SDK errors to LlmError; provider messages are dropped, as they may quote the request. */
export function toLlmError(error: unknown): LlmError {
  if (isTimeout(error)) {
    return new LlmError('timeout', { cause: error });
  }

  const upstreamStatus = readStatus(error);

  if (upstreamStatus === 429) {
    return new LlmError('quota_exceeded', {
      upstreamStatus,
      retryAfterSeconds: readRetryAfterSeconds(error),
      cause: error,
    });
  }
  // Invalid key (400 API_KEY_INVALID, 401/403), unknown model (404) or another request the
  // proxy built and Gemini rejected (400): not transient, fixable only on the server.
  if (
    upstreamStatus === 400 ||
    upstreamStatus === 401 ||
    upstreamStatus === 403 ||
    upstreamStatus === 404
  ) {
    return new LlmError('misconfigured', { upstreamStatus, cause: error });
  }
  return new LlmError('unavailable', { upstreamStatus, cause: error });
}

function userInput(text: string): Interactions.UserInputStep {
  return { type: 'user_input', content: [{ type: 'text', text }] };
}

/** How the session paces its requests: the time left before the deadline and the retry wait. */
interface RequestTiming {
  readonly timeLeft: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1) for the retry jitter. */
  readonly random: () => number;
}

class GeminiSession implements LlmSession {
  readonly #interactions: InteractionsApi;
  readonly #model: string;
  readonly #systemInstruction: string;
  readonly #responseSchema: JsonSchema;
  readonly #timing: RequestTiming;
  // Stateless multi-turn: with `store: false` the server keeps no history, so each request
  // resends every step. Model steps are kept unchanged, including thought signatures.
  #steps: Interactions.Step[] = [];

  constructor(
    interactions: InteractionsApi,
    model: string,
    timing: RequestTiming,
    options: LlmSessionOptions,
  ) {
    this.#interactions = interactions;
    this.#model = model;
    this.#timing = timing;
    this.#systemInstruction = options.systemInstruction;
    this.#responseSchema = options.responseSchema;
  }

  async send(message: string): Promise<LlmReply> {
    const input = [...this.#steps, userInput(message)];
    const interaction = await this.#createWithRetry(input);

    this.#steps = [...input, ...interaction.steps.filter((step) => step.type !== 'user_input')];

    if (interaction.status === 'incomplete') {
      return { kind: 'truncated' };
    }
    if (interaction.status !== 'completed' || interaction.output_text === undefined) {
      throw new LlmError('unavailable');
    }
    return { kind: 'text', text: interaction.output_text };
  }

  /**
   * Sends the request and, after a transient server error, sends it once more if a retry can
   * still finish before the deadline. A failed request leaves the history unchanged, so the
   * retry sends exactly the same input.
   */
  async #createWithRetry(input: Interactions.Step[]): Promise<GoogleGenAIInteraction> {
    try {
      return await this.#create(input);
    } catch (error) {
      if (!isTransient(error)) {
        throw error;
      }
      const delayMs = RETRY_DELAY_MS.base + this.#timing.random() * RETRY_DELAY_MS.jitter;
      // Too little time for a retry: report the provider's error at once.
      if (this.#timing.timeLeft() - delayMs < MIN_RETRY_TIME_MS) {
        throw error;
      }
      await this.#timing.sleep(delayMs);
      return this.#create(input);
    }
  }

  async #create(input: Interactions.Step[]): Promise<GoogleGenAIInteraction> {
    const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, this.#timing.timeLeft());
    // The deadline has passed: fail as a timeout without spending a request of the quota.
    if (timeoutMs <= 0) {
      throw new LlmError('timeout');
    }

    try {
      return await this.#interactions.create(
        {
          model: this.#model,
          input,
          system_instruction: this.#systemInstruction,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: this.#responseSchema,
          },
          generation_config: {
            max_output_tokens: MAX_OUTPUT_TOKENS,
            thinking_level: THINKING_LEVEL,
          },
          // Do not keep document text on Google's servers after the call.
          store: false,
        },
        requestOptions(timeoutMs),
      );
    } catch (error) {
      throw toLlmError(error);
    }
  }
}

export interface GeminiClientOptions {
  /** Epoch milliseconds by which every request must end; each timeout is cut to fit. */
  readonly deadline?: number;
  readonly now?: () => number;
  /** Waits before a retry; tests replace it so that they do not wait. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Returns a number in [0, 1) for the retry jitter. */
  readonly random?: () => number;
}

/** Gemini Developer API adapter (Interactions API). */
export class GeminiLlmClient implements LlmClient {
  readonly #interactions: InteractionsApi;
  readonly #model: string;
  readonly #timing: RequestTiming;

  constructor(
    interactions: InteractionsApi,
    model: string,
    {
      deadline = Number.POSITIVE_INFINITY,
      now = Date.now,
      sleep = wait,
      random = Math.random,
    }: GeminiClientOptions = {},
  ) {
    this.#interactions = interactions;
    this.#model = model;
    this.#timing = { timeLeft: () => deadline - now(), sleep, random };
  }

  startSession(options: LlmSessionOptions): LlmSession {
    return new GeminiSession(this.#interactions, this.#model, this.#timing, {
      ...options,
      responseSchema: toGeminiSchema(options.responseSchema) as JsonSchema,
    });
  }
}

export function createGeminiLlmClient(options: {
  apiKey: string;
  model: string;
  deadline?: number;
}): LlmClient {
  return new GeminiLlmClient(
    new GoogleGenAI({ apiKey: options.apiKey }).interactions,
    options.model,
    { deadline: options.deadline },
  );
}

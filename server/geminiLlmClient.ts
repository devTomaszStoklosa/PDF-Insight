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
/**
 * The first attempt of each request. Measured on the free tier on 2026-10-20 (#51): 20 of 21
 * replies took 2.2–8.8 s and one 15.6 s, while 2 of 9 analyses on the demo stalled past 25 s.
 * A first attempt that runs this long has most likely stalled, so it is sent once more.
 */
export const FIRST_ATTEMPT_TIMEOUT_MS = 15_000;
/**
 * The retry after a transient failure gets longer, so a slow but healthy reply is not cut
 * twice. A stalled first attempt, the wait and this retry fit within ANALYSIS_BUDGET_MS.
 */
export const RETRY_TIMEOUT_MS = 25_000;
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
export const RETRY_DELAY_MS = { base: 1_000, jitter: 1_000 } as const;
/**
 * A retry is made only if this much time is left after the wait. Part-sized requests took
 * 3.5–14 s on the free tier; with less time left, a retry would likely spend a request of the
 * quota and end as a timeout instead of the provider's error.
 */
export const MIN_RETRY_TIME_MS = 15_000;

/** A failure after which the session sends the same request once more, if time allows. */
type TransientFailure =
  { readonly kind: 'server_error'; readonly upstreamStatus: number } | { readonly kind: 'timeout' };

/**
 * The transient failure behind an error, or undefined for any other error. A timeout counts
 * only if the attempt had its full FIRST_ATTEMPT_TIMEOUT_MS: an attempt cut short by the
 * deadline did not stall, the analysis ran out of time.
 */
function transientFailure(error: unknown, hadFullTime: boolean): TransientFailure | undefined {
  if (!(error instanceof LlmError)) {
    return undefined;
  }
  if (error.kind === 'timeout') {
    return hadFullTime ? { kind: 'timeout' } : undefined;
  }
  return error.upstreamStatus !== undefined && TRANSIENT_STATUSES.has(error.upstreamStatus)
    ? { kind: 'server_error', upstreamStatus: error.upstreamStatus }
    : undefined;
}

/** A transient failure and what the session did about it. */
export type TransientErrorEvent = TransientFailure & {
  /** `skipped`: too little time was left before the deadline for a retry. */
  readonly retry: 'succeeded' | 'failed' | 'skipped';
};

export type TransientErrorListener = (event: TransientErrorEvent) => void;

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
  readonly #onTransientError: TransientErrorListener;
  // Stateless multi-turn: with `store: false` the server keeps no history, so each request
  // resends every step. Model steps are kept unchanged, including thought signatures.
  #steps: Interactions.Step[] = [];

  constructor(
    interactions: InteractionsApi,
    model: string,
    timing: RequestTiming,
    onTransientError: TransientErrorListener,
    options: LlmSessionOptions,
  ) {
    this.#interactions = interactions;
    this.#model = model;
    this.#timing = timing;
    this.#onTransientError = onTransientError;
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
   * Sends the request and, after a transient failure (a server error or a stalled first
   * attempt), sends it once more if a retry can still finish before the deadline. A failed
   * request leaves the history unchanged, so the retry sends exactly the same input. Every
   * transient failure is reported with its outcome.
   */
  async #createWithRetry(input: Interactions.Step[]): Promise<GoogleGenAIInteraction> {
    const firstTimeoutMs = this.#timeout(FIRST_ATTEMPT_TIMEOUT_MS);
    try {
      return await this.#create(input, firstTimeoutMs);
    } catch (error) {
      const failure = transientFailure(error, firstTimeoutMs === FIRST_ATTEMPT_TIMEOUT_MS);
      if (failure === undefined) {
        throw error;
      }
      const delayMs = RETRY_DELAY_MS.base + this.#timing.random() * RETRY_DELAY_MS.jitter;
      // Too little time for a retry: fail at once with the first error.
      if (this.#timing.timeLeft() - delayMs < MIN_RETRY_TIME_MS) {
        this.#onTransientError({ ...failure, retry: 'skipped' });
        throw error;
      }
      await this.#timing.sleep(delayMs);
      try {
        const interaction = await this.#create(input, this.#timeout(RETRY_TIMEOUT_MS));
        this.#onTransientError({ ...failure, retry: 'succeeded' });
        return interaction;
      } catch (retryError) {
        this.#onTransientError({ ...failure, retry: 'failed' });
        throw retryError;
      }
    }
  }

  /** The attempt's own time limit, cut to the time left before the deadline. */
  #timeout(limitMs: number): number {
    return Math.min(limitMs, this.#timing.timeLeft());
  }

  async #create(input: Interactions.Step[], timeoutMs: number): Promise<GoogleGenAIInteraction> {
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
  /** Told about every transient server error and its retry, e.g. to log how often they occur. */
  readonly onTransientError?: TransientErrorListener;
}

/** Gemini Developer API adapter (Interactions API). */
export class GeminiLlmClient implements LlmClient {
  readonly #interactions: InteractionsApi;
  readonly #model: string;
  readonly #timing: RequestTiming;
  readonly #onTransientError: TransientErrorListener;

  constructor(
    interactions: InteractionsApi,
    model: string,
    {
      deadline = Number.POSITIVE_INFINITY,
      now = Date.now,
      sleep = wait,
      random = Math.random,
      onTransientError = () => undefined,
    }: GeminiClientOptions = {},
  ) {
    this.#interactions = interactions;
    this.#model = model;
    this.#timing = { timeLeft: () => deadline - now(), sleep, random };
    this.#onTransientError = onTransientError;
  }

  startSession(options: LlmSessionOptions): LlmSession {
    return new GeminiSession(
      this.#interactions,
      this.#model,
      this.#timing,
      this.#onTransientError,
      {
        ...options,
        responseSchema: toGeminiSchema(options.responseSchema) as JsonSchema,
      },
    );
  }
}

export function createGeminiLlmClient(options: {
  apiKey: string;
  model: string;
  deadline?: number;
  onTransientError?: TransientErrorListener;
}): LlmClient {
  return new GeminiLlmClient(
    new GoogleGenAI({ apiKey: options.apiKey }).interactions,
    options.model,
    { deadline: options.deadline, onTransientError: options.onTransientError },
  );
}

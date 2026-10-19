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
// The analyzer sends at most two requests, so the server answers within about 50 s, before
// the browser gives up after ANALYZE_TIMEOUT_MS (60 s, src/api/analyzeClient.ts) and within
// maxDuration in vercel.json.
export const REQUEST_TIMEOUT_MS = 25_000;

// No transport retries: every request counts against the free-tier quota, and the
// analyzer already makes exactly one self-correction retry.
const REQUEST_OPTIONS: GoogleGenAIRequestOptions = {
  timeout_ms: REQUEST_TIMEOUT_MS,
  retries: { strategy: 'none' },
};

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

class GeminiSession implements LlmSession {
  readonly #interactions: InteractionsApi;
  readonly #model: string;
  readonly #systemInstruction: string;
  readonly #responseSchema: JsonSchema;
  // Stateless multi-turn: with `store: false` the server keeps no history, so each request
  // resends every step. Model steps are kept unchanged, including thought signatures.
  #steps: Interactions.Step[] = [];

  constructor(interactions: InteractionsApi, model: string, options: LlmSessionOptions) {
    this.#interactions = interactions;
    this.#model = model;
    this.#systemInstruction = options.systemInstruction;
    this.#responseSchema = options.responseSchema;
  }

  async send(message: string): Promise<LlmReply> {
    const input = [...this.#steps, userInput(message)];

    let interaction: GoogleGenAIInteraction;
    try {
      interaction = await this.#interactions.create(
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
        REQUEST_OPTIONS,
      );
    } catch (error) {
      throw toLlmError(error);
    }

    this.#steps = [...input, ...interaction.steps.filter((step) => step.type !== 'user_input')];

    if (interaction.status === 'incomplete') {
      return { kind: 'truncated' };
    }
    if (interaction.status !== 'completed' || interaction.output_text === undefined) {
      throw new LlmError('unavailable');
    }
    return { kind: 'text', text: interaction.output_text };
  }
}

/** Gemini Developer API adapter (Interactions API). */
export class GeminiLlmClient implements LlmClient {
  readonly #interactions: InteractionsApi;
  readonly #model: string;

  constructor(interactions: InteractionsApi, model: string) {
    this.#interactions = interactions;
    this.#model = model;
  }

  startSession(options: LlmSessionOptions): LlmSession {
    return new GeminiSession(this.#interactions, this.#model, {
      ...options,
      responseSchema: toGeminiSchema(options.responseSchema) as JsonSchema,
    });
  }
}

export function createGeminiLlmClient(options: { apiKey: string; model: string }): LlmClient {
  return new GeminiLlmClient(
    new GoogleGenAI({ apiKey: options.apiKey }).interactions,
    options.model,
  );
}

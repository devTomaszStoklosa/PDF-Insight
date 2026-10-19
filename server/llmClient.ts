/** JSON Schema (draft 2020-12) object describing the expected model output. */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface LlmSessionOptions {
  readonly systemInstruction: string;
  readonly responseSchema: JsonSchema;
}

export type LlmReply =
  | { readonly kind: 'text'; readonly text: string }
  /** The output hit the token limit, so the text is incomplete. */
  | { readonly kind: 'truncated' };

/** A conversation with the model; the session keeps the history between messages. */
export interface LlmSession {
  send(message: string): Promise<LlmReply>;
}

/** Provider-neutral LLM access; each provider gets its own adapter. */
export interface LlmClient {
  startSession(options: LlmSessionOptions): LlmSession;
}

export type LlmErrorKind = 'quota_exceeded' | 'misconfigured' | 'unavailable';

/** A provider failure, already stripped of provider error messages and request data. */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly upstreamStatus: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    kind: LlmErrorKind,
    options: { upstreamStatus?: number; retryAfterSeconds?: number; cause?: unknown } = {},
  ) {
    super(kind, { cause: options.cause });
    this.name = 'LlmError';
    this.kind = kind;
    this.upstreamStatus = options.upstreamStatus;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

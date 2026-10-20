import { z } from 'zod';
import { HttpError } from './errors.ts';

// On the free tier, gemini-3.8-flash took 20–35 s per analysis and sometimes answered 503;
// this model took 6–9 s, within FIRST_ATTEMPT_TIMEOUT_MS and the brief's 30 s target.
export const DEFAULT_LLM_MODEL = 'gemini-3.1-flash-lite';

export interface ServerConfig {
  readonly llmApiKey: string;
  readonly llmModel: string;
  readonly allowedOrigins: ReadonlySet<string>;
  /** Upstash Redis REST endpoint and token for the request limit. */
  readonly rateLimitStore: { readonly url: string; readonly token: string };
}

/** An origin is scheme + host + optional port, with no path or trailing slash. */
function isOrigin(value: string): boolean {
  return URL.canParse(value) && new URL(value).origin === value;
}

// An empty variable (e.g. `LLM_MODEL=` copied from .env.example) means "not set".
const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

const envSchema = z.object({
  LLM_API_KEY: z.string().trim().min(1),
  LLM_MODEL: optionalText,
  ALLOWED_ORIGIN: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    )
    .pipe(z.array(z.string().refine(isOrigin)).min(1)),
  // Required, so a deployment cannot run without the request limit.
  UPSTASH_REDIS_REST_URL: z
    .string()
    .trim()
    .pipe(z.url({ protocol: /^https$/ })),
  UPSTASH_REDIS_REST_TOKEN: z.string().trim().min(1),
});

/**
 * Reads the server configuration from environment variables.
 * Throws SERVER_MISCONFIGURED without echoing any value, as the variables hold secrets.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new HttpError('SERVER_MISCONFIGURED');
  }

  return {
    llmApiKey: result.data.LLM_API_KEY,
    llmModel: result.data.LLM_MODEL ?? DEFAULT_LLM_MODEL,
    allowedOrigins: new Set(result.data.ALLOWED_ORIGIN),
    rateLimitStore: {
      url: result.data.UPSTASH_REDIS_REST_URL,
      token: result.data.UPSTASH_REDIS_REST_TOKEN,
    },
  };
}

import { z } from 'zod';
import type { LlmReply, LlmSession } from './llmClient.ts';
import { buildCorrectionPrompt } from './prompt.ts';

/** The model returned no valid output, even after the self-correction retry. */
export class InvalidLlmOutputError extends Error {
  constructor() {
    super('LLM output failed validation twice');
    this.name = 'InvalidLlmOutputError';
  }
}

type ReplyValidation<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: string };

function parseJson(text: string): { success: true; value: unknown } | { success: false } {
  try {
    return { success: true, value: JSON.parse(text) as unknown };
  } catch {
    return { success: false };
  }
}

function validateReply<T>(reply: LlmReply, schema: z.ZodType<T>): ReplyValidation<T> {
  if (reply.kind === 'truncated') {
    return {
      success: false,
      error: 'the output was cut off at the token limit; keep every text field shorter',
    };
  }

  const json = parseJson(reply.text);
  if (!json.success) {
    return { success: false, error: 'the response is not valid JSON' };
  }

  const result = schema.safeParse(json.value);
  if (!result.success) {
    return { success: false, error: z.prettifyError(result.error) };
  }
  return { success: true, value: result.data };
}

/**
 * Sends the message and returns the reply parsed with `schema`. If the reply is not valid
 * JSON or does not match the schema, makes exactly one retry that tells the model what was
 * wrong.
 */
export async function requestStructuredReply<T>(
  session: LlmSession,
  message: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const first = validateReply(await session.send(message), schema);
  if (first.success) {
    return first.value;
  }

  const retry = validateReply(await session.send(buildCorrectionPrompt(first.error)), schema);
  if (retry.success) {
    return retry.value;
  }

  throw new InvalidLlmOutputError();
}

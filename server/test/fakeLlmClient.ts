import type { LlmClient, LlmReply, LlmSessionOptions } from '../llmClient.ts';

type ScriptedReply = LlmReply | Error;

export interface FakeLlmClient {
  readonly client: LlmClient;
  /** Messages sent to the model, in order, across all sessions. */
  readonly sentMessages: string[];
  readonly sessionOptions: LlmSessionOptions[];
}

/** An LlmClient that answers with scripted replies and fails on any unexpected call. */
export function createFakeLlmClient(replies: readonly ScriptedReply[]): FakeLlmClient {
  const queue = [...replies];
  const sentMessages: string[] = [];
  const sessionOptions: LlmSessionOptions[] = [];

  const client: LlmClient = {
    startSession(options) {
      sessionOptions.push(options);
      return {
        send(message) {
          sentMessages.push(message);
          const reply = queue.shift();
          if (reply === undefined) {
            return Promise.reject(new Error('Unexpected LLM call'));
          }
          return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
        },
      };
    },
  };

  return { client, sentMessages, sessionOptions };
}

export function textReply(value: unknown): LlmReply {
  return { kind: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) };
}

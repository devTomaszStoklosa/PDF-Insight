import type { LlmClient, LlmReply, LlmSessionOptions } from '../llmClient.ts';

type ScriptedReply = LlmReply | Error;

export interface FakeLlmClient {
  readonly client: LlmClient;
  /** Messages sent to the model, in order, across all sessions. */
  readonly sentMessages: string[];
  readonly sessionOptions: LlmSessionOptions[];
  /** The most requests that were waiting for a reply at the same time. */
  readonly maxConcurrentRequests: () => number;
}

/** An LlmClient that answers with scripted replies and fails on any unexpected call. */
export function createFakeLlmClient(replies: readonly ScriptedReply[]): FakeLlmClient {
  const queue = [...replies];
  const sentMessages: string[] = [];
  const sessionOptions: LlmSessionOptions[] = [];
  let pending = 0;
  let maxPending = 0;

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
          pending += 1;
          maxPending = Math.max(maxPending, pending);
          const result = reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
          return result.finally(() => {
            pending -= 1;
          });
        },
      };
    },
  };

  return { client, sentMessages, sessionOptions, maxConcurrentRequests: () => maxPending };
}

export function textReply(value: unknown): LlmReply {
  return { kind: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) };
}

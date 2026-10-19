import { z } from 'zod';
import { formatNumber } from '../lib/formatters.ts';
import { UserFacingError } from '../lib/userFacingError.ts';
import { documentInsightSchema, type DocumentInsight } from '../types/schema.ts';

/** Must match MAX_TEXT_CHARS in server/requestBody.ts, which rejects longer text with 413. */
export const MAX_TEXT_CHARS = 150_000;
/**
 * Must stay above two LLM requests (REQUEST_TIMEOUT_MS in server/geminiLlmClient.ts), so the
 * browser receives the server's answer, including its timeout error, instead of giving up first.
 */
export const ANALYZE_TIMEOUT_MS = 60_000;
const ANALYZE_PATH = '/api/analyze';

export interface AnalyzeInput {
  readonly fileName: string;
  readonly pages: number;
  readonly text: string;
}

export type AnalyzeText = (input: AnalyzeInput, signal: AbortSignal) => Promise<DocumentInsight>;

export interface AnalyzeClientOptions {
  /** Base URL of the API proxy (VITE_API_URL); validated on each call. */
  readonly apiUrl: string | undefined;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export const ANALYZE_MESSAGES = {
  notConfigured:
    'Aplikacja nie ma skonfigurowanego adresu usługi analizy. Skontaktuj się z autorem strony.',
  textTooLong: `Dokument zawiera za dużo tekstu do analizy (maksymalnie ${formatNumber(MAX_TEXT_CHARS)} znaków). Wybierz krótszy plik.`,
  // Neutral on purpose: the same error appears when the API is down, not only when the
  // user's connection fails.
  network: 'Nie udało się połączyć z usługą analizy. Spróbuj ponownie za chwilę.',
  timeout: 'Analiza trwa zbyt długo. Spróbuj ponownie za chwilę.',
  invalidResponse: 'Usługa analizy zwróciła niepoprawną odpowiedź. Spróbuj ponownie.',
  payloadTooLarge: 'Dokument jest za duży do analizy. Wybierz krótszy plik.',
  quotaExceeded: 'Wyczerpano limit zapytań do usługi analizy. Spróbuj ponownie później.',
  unavailable: 'Usługa analizy jest chwilowo niedostępna. Spróbuj ponownie później.',
  requestFailed: 'Nie udało się przeanalizować dokumentu. Spróbuj ponownie.',
} as const;

// The proxy's error messages are written in Polish for the user and never echo request data.
const apiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string().trim().min(1) }),
});

function resolveEndpoint(apiUrl: string | undefined): string {
  const baseUrl = apiUrl?.trim().replace(/\/+$/, '') ?? '';
  if (!URL.canParse(baseUrl) || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    throw new UserFacingError(ANALYZE_MESSAGES.notConfigured);
  }
  return `${baseUrl}${ANALYZE_PATH}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return undefined;
  }
}

/** Used when the error body is missing or not from the proxy, e.g. a platform error page. */
function messageForStatus(status: number): string {
  if (status === 413) {
    return ANALYZE_MESSAGES.payloadTooLarge;
  }
  if (status === 429) {
    return ANALYZE_MESSAGES.quotaExceeded;
  }
  if (status >= 500) {
    return ANALYZE_MESSAGES.unavailable;
  }
  return ANALYZE_MESSAGES.requestFailed;
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

/** Creates the client for POST /api/analyze; the response is validated against the contract. */
export function createAnalyzeClient({
  apiUrl,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = ANALYZE_TIMEOUT_MS,
}: AnalyzeClientOptions): AnalyzeText {
  return async (input, signal) => {
    const endpoint = resolveEndpoint(apiUrl);
    // Checked before sending, so an oversized document fails at once instead of after upload.
    if (input.text.length > MAX_TEXT_CHARS) {
      throw new UserFacingError(ANALYZE_MESSAGES.textTooLong);
    }

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new UserFacingError(
        isTimeout(error) ? ANALYZE_MESSAGES.timeout : ANALYZE_MESSAGES.network,
        {
          cause: error,
        },
      );
    }

    const body = await readJson(response);
    signal.throwIfAborted();
    if (!response.ok) {
      const apiError = apiErrorBodySchema.safeParse(body);
      throw new UserFacingError(
        apiError.success ? apiError.data.error.message : messageForStatus(response.status),
      );
    }

    const insight = documentInsightSchema.safeParse(body);
    if (!insight.success) {
      throw new UserFacingError(ANALYZE_MESSAGES.invalidResponse, { cause: insight.error });
    }
    return insight.data;
  };
}

import { describe, expect, it } from 'vitest';
import { createInsight } from '../test/insightFixture.ts';
import {
  ANALYZE_MESSAGES,
  createAnalyzeClient,
  MAX_TEXT_CHARS,
  type AnalyzeInput,
} from './analyzeClient.ts';

const API_URL = 'https://api.example.test/';
const input: AnalyzeInput = { fileName: 'faktura-03-2024.pdf', pages: 2, text: 'Faktura VAT.' };

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch double that records requests and answers with the given handler. */
function fakeFetch(handler: () => Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = (url, init) => {
    requests.push({ url: url instanceof Request ? url.url : url.toString(), init });
    return handler();
  };
  return { fetchImpl, requests };
}

function analyze(handler: () => Promise<Response>) {
  const { fetchImpl } = fakeFetch(handler);
  return createAnalyzeClient({ apiUrl: API_URL, fetch: fetchImpl })(
    input,
    new AbortController().signal,
  );
}

describe('createAnalyzeClient', () => {
  it('posts the extracted text and returns the validated analysis', async () => {
    const insight = createInsight();
    const { fetchImpl, requests } = fakeFetch(() => Promise.resolve(jsonResponse(insight)));

    const result = await createAnalyzeClient({ apiUrl: API_URL, fetch: fetchImpl })(
      input,
      new AbortController().signal,
    );

    expect(result).toEqual(insight);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.example.test/api/analyze');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.body).toBe(JSON.stringify(input));
  });

  it.each([undefined, '', 'not a url', 'ftp://api.example.test'])(
    'rejects the API URL %j before sending anything',
    async (apiUrl) => {
      const { fetchImpl, requests } = fakeFetch(() => Promise.resolve(jsonResponse({})));
      const client = createAnalyzeClient({ apiUrl, fetch: fetchImpl });

      await expect(client(input, new AbortController().signal)).rejects.toThrow(
        ANALYZE_MESSAGES.notConfigured,
      );
      expect(requests).toHaveLength(0);
    },
  );

  it('rejects text over the server limit without calling the API', async () => {
    const { fetchImpl, requests } = fakeFetch(() => Promise.resolve(jsonResponse({})));
    const client = createAnalyzeClient({ apiUrl: API_URL, fetch: fetchImpl });

    await expect(
      client({ ...input, text: 'a'.repeat(MAX_TEXT_CHARS + 1) }, new AbortController().signal),
    ).rejects.toThrow(ANALYZE_MESSAGES.textTooLong);
    expect(requests).toHaveLength(0);
  });

  it('shows the Polish message from the API error body', async () => {
    const body = { error: { code: 'LLM_QUOTA_EXCEEDED', message: 'Wyczerpano darmowy limit.' } };

    await expect(analyze(() => Promise.resolve(jsonResponse(body, 429)))).rejects.toThrow(
      'Wyczerpano darmowy limit.',
    );
  });

  it('falls back to a message by status when the error body is not from the API', async () => {
    const htmlError = () =>
      Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(analyze(htmlError)).rejects.toThrow(ANALYZE_MESSAGES.unavailable);
  });

  it('rejects a response that does not match the contract', async () => {
    const insight = createInsight();
    const invalid = { ...insight, document: { ...insight.document, type: 'list' } };

    await expect(analyze(() => Promise.resolve(jsonResponse(invalid)))).rejects.toThrow(
      ANALYZE_MESSAGES.invalidResponse,
    );
  });

  it('reports a network failure', async () => {
    await expect(analyze(() => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow(
      ANALYZE_MESSAGES.network,
    );
  });

  it('reports a timeout', async () => {
    const timeout = () => Promise.reject(new DOMException('Timed out', 'TimeoutError'));

    await expect(analyze(timeout)).rejects.toThrow(ANALYZE_MESSAGES.timeout);
  });

  it('rethrows the abort reason when the caller cancels', async () => {
    const controller = new AbortController();
    const { fetchImpl } = fakeFetch(() => {
      controller.abort();
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });

    await expect(
      createAnalyzeClient({ apiUrl: API_URL, fetch: fetchImpl })(input, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

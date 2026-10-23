# Server

The server is plain TypeScript run as one Vercel function. `api/analyze.ts` is the
composition root; everything else lives in [`server/`](../server). Tests sit next to the
files they cover (`*.test.ts`).

## Module map

| Module                                                         | Responsibility                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`api/analyze.ts`](../api/analyze.ts)                          | builds the dependencies, exports `POST` and `OPTIONS`, adds `X-App-Version` |
| [`handleRequest.ts`](../server/handleRequest.ts)               | request pipeline, error mapping, logging policy                             |
| [`config.ts`](../server/config.ts)                             | parses and validates environment variables                                  |
| [`cors.ts`](../server/cors.ts)                                 | exact-match origin allowlist, CORS and preflight headers                    |
| [`http.ts`](../server/http.ts)                                 | JSON/empty/error responses with the base security headers                   |
| [`errors.ts`](../server/errors.ts)                             | `ApiErrorCode`, HTTP status and Polish message per code, `HttpError`        |
| [`requestBody.ts`](../server/requestBody.ts)                   | streaming body read with a byte cap, request schema, text sanitizing        |
| [`rateLimit.ts`](../server/rateLimit.ts)                       | `RateLimiter` interface and `clientIdOf` (SHA-256 of the IP)                |
| [`upstashRateLimiter.ts`](../server/upstashRateLimiter.ts)     | Redis-backed implementation, two sliding windows                            |
| [`analyzeDocument.ts`](../server/analyzeDocument.ts)           | chooses one call or parts, merges, validates the final result               |
| [`textChunks.ts`](../server/textChunks.ts)                     | splits long text at page, line or word boundaries                           |
| [`concurrency.ts`](../server/concurrency.ts)                   | `mapWithConcurrency`: bounded parallelism, stops after the first failure    |
| [`mergePartialInsights.ts`](../server/mergePartialInsights.ts) | combines the analyses of parts in code                                      |
| [`prompt.ts`](../server/prompt.ts)                             | system instruction, few-shot examples, user prompts, correction prompt      |
| [`overviewPrompt.ts`](../server/overviewPrompt.ts)             | system instruction and prompt for the final overview call                   |
| [`llmOutputSchema.ts`](../server/llmOutputSchema.ts)           | Zod and JSON schemas of what the model returns                              |
| [`structuredReply.ts`](../server/structuredReply.ts)           | parse, validate and the single correction retry                             |
| [`llmClient.ts`](../server/llmClient.ts)                       | provider-neutral `LlmClient`, `LlmSession`, `LlmError`                      |
| [`geminiLlmClient.ts`](../server/geminiLlmClient.ts)           | Gemini adapter: timeouts, deadline, transient retry, error mapping          |

## Request pipeline

`handleRequest(request, dependencies)`:

1. `loadConfig()`; on failure respond `SERVER_MISCONFIGURED` (500).
2. `isOriginAllowed`; otherwise `ORIGIN_NOT_ALLOWED` (403).
3. `OPTIONS` returns the 204 preflight; any method but `POST` returns 405.
4. Rate limit check (before the body is read). A limiter error is logged as
   `RATE_LIMIT_UNAVAILABLE` and the request is allowed; a refusal becomes `RATE_LIMITED`
   with `Retry-After`.
5. `parseAnalyzeRequest`: content type, streamed body, JSON, schema, length, sanitizing.
6. `createLlmClient(config)` and `analyzeDocument`. The client is created here, so its
   50 s deadline starts after the request is checked.
7. `200` with the result, or the error mapped by `toHttpError`:
   `HttpError` as is, `LlmError` by kind (`quota_exceeded` to 429, `misconfigured` to 500,
   `unavailable` to 503, `timeout` to 504), `InvalidLlmOutputError` to 502, anything else to
   `INTERNAL_ERROR`.

### Logging policy

Status 5xx, `LLM_QUOTA_EXCEEDED` and `RATE_LIMITED` are logged as one JSON line
(`level`, `source`, `code`, optional `upstreamStatus`). Other 4xx are expected and not
logged. Logs hold codes and statuses only: no document text, no file names, no client
addresses, no provider messages. Transient Gemini failures are logged as warnings:

```json
{
  "level": "warn",
  "source": "api/analyze",
  "code": "LLM_TRANSIENT_ERROR",
  "kind": "server_error",
  "upstreamStatus": 503,
  "retry": "succeeded"
}
```

`kind` is `server_error` or `timeout`; `retry` is `succeeded`, `failed` or `skipped`.

## Analysis

`analyzeDocument(input, llm)`:

- `splitIntoChunks(text)` returns one chunk for text up to 37,500 characters. Longer text is
  split into `ceil(length / 37,500)` parts of similar length (at most 6). Each cut is the
  nearest page break (`\n\n`), then line break, then space within 2,500 characters before the
  ideal position; otherwise it cuts at the ideal position, never inside a surrogate pair.
  Joining the parts returns the original text.
- **One part:** a single call with `SYSTEM_INSTRUCTION` and the response schema.
- **Several parts:** `mapWithConcurrency` runs the part calls, 3 at a time, in order of the
  document. The first failure fails the whole analysis and starts no more parts, because a
  partial result would look complete. `mergePartialInsights` then combines the results:
  - `language`: most frequent across parts, ties to the earliest;
  - `type`: first part with a type other than `inne`;
  - `title`: from the first part; `date`: first non-null date;
  - organizations, people, amounts, dates: de-duplicated (case and whitespace ignored);
    amounts and dates count as repeats only when their context repeats too;
  - keywords: ranked by the number of parts that name them, at most 10.
    One more call (`OVERVIEW_SYSTEM_INSTRUCTION`) writes `summary` and `keyPoints` of the
    whole document from the summaries and key points of the parts.
- The result is completed with `fileName` and `pages` from the request and parsed once more
  with `documentInsightSchema`, so nothing that breaks the contract leaves the server.

### Prompts

`SYSTEM_INSTRUCTION` states the role, treats the document as data, requires a bare JSON
object, defines each field, forbids guessing and requires descriptive text in the document's
language. Two few-shot examples are appended: a Polish invoice and an English note that
contains an injected instruction, which the expected output ignores. User messages wrap
metadata and text in `<metadata>` and `<document>` tags; `escapeDelimiters` turns any
`<document`, `</document`, `<metadata`, `<parts` inside the text into `&lt;...`.

### Self-correction

`requestStructuredReply` parses the reply and validates it against the Zod schema. On a
truncated reply, invalid JSON or a schema error it sends one correction message that quotes
the problem (at most 2,000 characters) in the same session, then validates again. A second
failure throws `InvalidLlmOutputError`, which becomes `LLM_INVALID_OUTPUT`.

## Gemini adapter

`GeminiLlmClient` uses the Interactions API with `store: false`, `max_output_tokens: 16000`,
`thinking_level: 'low'` and a JSON response schema. A session is stateless on the provider
side: it resends all previous steps with every request.

### Time budget

| Constant                   | Value                  | Meaning                                                       |
| -------------------------- | ---------------------- | ------------------------------------------------------------- |
| `ANALYSIS_BUDGET_MS`       | 50 s                   | deadline for the whole analysis, counted from client creation |
| `FIRST_ATTEMPT_TIMEOUT_MS` | 15 s                   | limit of the first attempt of each request                    |
| `RETRY_TIMEOUT_MS`         | 25 s                   | limit of the one retry                                        |
| `RETRY_DELAY_MS`           | 1 s + up to 1 s jitter | wait before the retry                                         |
| `MIN_RETRY_TIME_MS`        | 15 s                   | a retry starts only if this much time is left after the wait  |

Every timeout is cut to the time left before the deadline. When the deadline has passed,
a request fails as `timeout` without calling Gemini. The SDK's own retries are disabled
(`retries: { strategy: 'none' }`), because they would give every attempt the full timeout.

### Retry rule

After a failure of the first attempt the session retries once when the failure is transient:
status 500 or 503, or a timeout of an attempt that had its full 15 s. A timeout of an attempt
that was cut short by the deadline is not retried. A failed request leaves the session
history unchanged, so the retry sends exactly the same input. One model call can therefore
make up to 4 requests (first, retry, correction, retry of the correction), and only when
errors occur.

### Error mapping (`toLlmError`)

| Gemini result                                                           | `LlmError.kind`  | API code               |
| ----------------------------------------------------------------------- | ---------------- | ---------------------- |
| `APIConnectionTimeoutError`                                             | `timeout`        | `LLM_TIMEOUT`          |
| 429 (`Retry-After` kept when valid)                                     | `quota_exceeded` | `LLM_QUOTA_EXCEEDED`   |
| 400, 401, 403, 404 (key, model, bad request)                            | `misconfigured`  | `SERVER_MISCONFIGURED` |
| any other status, or a reply that is neither completed nor `incomplete` | `unavailable`    | `LLM_UNAVAILABLE`      |

A reply with status `incomplete` is returned as `truncated` and handled by the correction
retry. Provider messages are dropped.

## Request limit

`UpstashRateLimiter` checks two sliding windows in order, `5 / 1 m` and `30 / 1 d`, with the
key prefix `pdf-insight:ratelimit:<window>`. The identifier is the SHA-256 of the client
address: `x-real-ip`, else the first `x-forwarded-for` entry, else the shared bucket
`unknown`. Vercel sets both headers itself and overwrites client values. The Redis timeout is
1 s; `@upstash/ratelimit` reports a timeout as `reason: 'timeout'`, which the adapter turns
into an error so the caller can log it and allow the request.

## Extending

- **Another LLM provider:** implement `LlmClient` and `LlmSession` (`send` returns
  `{kind: 'text'}` or `{kind: 'truncated'}`, failures throw `LlmError`), then change
  `createLlmClient` in `api/analyze.ts`. No other file needs to change.
- **A new error code:** add it to `ApiErrorCode` and `API_ERRORS` in `errors.ts`, map its
  source in `toHttpError`, and document it in [api.md](api.md).
- **A new field in the result:** see [Development](development.md#changing-the-result-schema).

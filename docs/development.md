# Development

## Setup

Requirements: Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local
```

Frontend only (upload works, analysis needs the API):

```bash
npm run dev
```

Whole flow. In `.env.local` set `LLM_API_KEY`, `ALLOWED_ORIGIN=http://localhost:5173`,
`VITE_API_URL=http://localhost:3000`, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`,
then run in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev
```

`dev:api` serves the real `api/analyze.ts` through `scripts/devApiServer.ts`, which converts
Node requests to Web `Request`/`Response`, answers only `/api/analyze` and listens on
`127.0.0.1`. Every request spends the quota of your Gemini key, which is why it never listens
on other interfaces. If Vite picks a port other than 5173, add that origin to
`ALLOWED_ORIGIN`, comma-separated. Restart `dev:api` after changing `.env.local`.

## Checks

Run all of them before a pull request; CI runs the same set.

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Tests

Vitest in the Node environment; no browser is involved. Files sit next to the code they test.

| Area                 | Tests                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract             | `src/types/schema.test.ts`, `currencyCodes.test.ts`                                                                                                  |
| Request handling     | `server/handleRequest.test.ts`, `requestBody.test.ts`, `http.test.ts`, `config.test.ts`                                                              |
| Analysis             | `analyzeDocument.test.ts`, `textChunks.test.ts`, `mergePartialInsights.test.ts`, `concurrency.test.ts`, `prompt.test.ts`, `overviewPrompt.test.ts`   |
| LLM adapter          | `geminiLlmClient.test.ts` (timeouts, retry, error mapping, schema conversion)                                                                        |
| Request limit        | `rateLimit.test.ts`, `upstashRateLimiter.test.ts`                                                                                                    |
| Vercel build         | `vercelBuild.test.ts` compiles `api/analyze.ts` and its imports the way Vercel does, so a config change that would crash the deployed API fails here |
| Pipeline and state   | `src/hooks/analysisState.test.ts`, `src/api/analyzeClient.test.ts`                                                                                   |
| Browser-side helpers | `pdfExtractor.test.ts`, `historyStorage.test.ts`, `validatePdfFile.test.ts`, `formatters.test.ts`, `jsonExport.test.ts`, `countSentences.test.ts`    |

Test doubles: `server/test/fakeLlmClient.ts` (scripted replies and errors) and
`src/test/insightFixture.ts` (a valid `DocumentInsight`). Dependencies are injected, so the
tests need no network, no Redis and no API key. Timers and randomness are injected into the
Gemini client (`now`, `sleep`, `random`), so retry tests do not wait.

## Code conventions

- TypeScript strict; no `any`; no `console` in `src/` and `server/`; relative imports
  end in `.ts`/`.tsx`.
- Code, identifiers and comments are in English. User-facing text is Polish.
- Comments explain why (a measurement, a provider quirk, a security reason), not what.
- Dependencies come in through parameters or props, never created inside business logic
  (the composition roots are `api/analyze.ts` and `src/main.tsx`).
- Untrusted data (PDF text, model output, `localStorage`, request bodies) is validated at the
  boundary with Zod before use.
- Never log document text, file names, client addresses, secrets or provider messages.
- One issue, one branch (`<type>/<issue>-<description>`), one pull request that ends with
  `Closes #<issue>`. Commit messages follow Conventional Commits.

## Recipes

### Changing the result schema

1. Edit `src/types/schema.ts`. Keep the key order and strict objects.
2. `llmInsightSchema` and the JSON Schema for the model follow automatically; check
   `server/llmOutputSchema.ts` if the field is set by the server instead of the model.
3. Update the prompt in `server/prompt.ts`, including the few-shot examples (they are typed
   as `LlmInsight`, so the compiler points at them).
4. For long documents decide how `mergePartialInsights` combines the field.
5. Update `src/test/insightFixture.ts`, the dashboard in `InsightDashboard.tsx` and the
   tests.
6. Bump `STORAGE_KEY` in `src/lib/historyStorage.ts` (`v2` to `v3`) so old history entries
   stop loading instead of failing validation one by one.
7. Update [api.md](api.md).

### Adding an LLM provider

Implement `LlmClient` and `LlmSession` from `server/llmClient.ts` in a new adapter next to
`geminiLlmClient.ts`: map provider failures to `LlmError` kinds, drop provider messages, honor
the deadline and report truncation as `{kind: 'truncated'}`. Switch `createLlmClient` in
`api/analyze.ts`. Add the matching config variables to `server/config.ts`, `.env.example`
and [configuration.md](configuration.md).

### Adding an API error code

See [Server: Extending](server.md#extending).

### Changing the prompt

Prompt behavior is covered by `prompt.test.ts`, but quality is not. After a change, run the
local API against a few real PDFs (invoice, contract, a note with an injected instruction)
and compare the output with the schema's expectations. Keep the rule that the document is
data, and keep the delimiter escaping.

## Troubleshooting local setup

| Symptom                                           | Cause and fix                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| "Aplikacja nie ma skonfigurowanego adresu usługi" | `VITE_API_URL` missing in `.env.local`; restart `npm run dev`                       |
| `ORIGIN_NOT_ALLOWED` (403)                        | the Vite origin is not in `ALLOWED_ORIGIN` (check the port)                         |
| `SERVER_MISCONFIGURED` (500)                      | a required variable is missing or malformed, or the Gemini key or model is rejected |
| CJK PDF yields no text                            | Vite was started without `predev`; run `npm run dev`, not `vite`                    |
| `RATE_LIMITED` (429) while testing                | 5 per minute and 30 per day per address; wait for `Retry-After`                     |

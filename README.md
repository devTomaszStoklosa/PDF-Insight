# PDF Insight

Upload a PDF and get a summary with structured data. The text is extracted in the browser;
only the text goes to an API proxy that calls the LLM (Gemini), so the key never reaches
the browser.

Demo: https://devtomaszstoklosa.github.io/PDF-Insight/

![The result of an invoice analysis: document type, page count, language and date badges,
the summary, the key points and the recent-analyses panel](docs/screenshot.jpg)

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser: React SPA on GitHub Pages"]
    PDF["PDF file, max. 10 MB"] --> Extract["Text extraction<br/>pdf.js in a web worker"]
    Extract --> Client["API client<br/>max. 150,000 characters, 60 s"]
    Client --> Check["Zod validation<br/>same schema as the server"]
    Check --> UI["Dashboard, JSON download,<br/>last 3 analyses in localStorage"]
  end
  subgraph Vercel["API proxy: Vercel function api/analyze.ts"]
    Guard["CORS allowlist, body limits,<br/>request limit per IP"] --> Prompt["Prompt with the document<br/>as untrusted data"]
    Prompt --> Validate["Zod validation,<br/>one self-correction retry"]
  end
  Redis[("Upstash Redis<br/>request counters")]
  Gemini["Google Gemini API<br/>free tier"]
  Client -- "POST /api/analyze: text only" --> Guard
  Guard <--> Redis
  Prompt <--> Gemini
  Validate -- "JSON in the brief's schema" --> Client
```

1. The browser checks the file (PDF, max. 10 MB) and extracts its text layer with pdf.js. The
   file never leaves the device; only the text, the file name and the page count are sent.
2. The Vercel function checks the origin, the body size and the request limit, then asks
   Gemini for a JSON object constrained by a response schema.
3. The server validates the reply with Zod. An invalid reply gets exactly one correction
   request that quotes the validation error; a second invalid reply ends with 502
   `LLM_INVALID_OUTPUT`. Errors reach the user as Polish messages with a stable code.
4. The browser validates the response again with the same schema before it shows anything,
   and keeps the last 3 analyses in `localStorage`, re-validated whenever they are read.

## Key decisions

- **Gemini free tier, `gemini-3.1-flash-lite` by default.** The demo costs nothing and the key
  belongs to a Google Cloud project without billing, so requests above the quota are rejected,
  not charged. On the free tier, `gemini-3.8-flash` took 20–35 s for a one-page invoice and
  sometimes answered 503; the lite model took about 4–10 s with valid output (#31). The provider sits
  behind the `LlmClient` interface, so another one needs only a new adapter.
- **Text extraction in the browser.** The PDF never reaches a server, uploads stay small, and
  scanned files are rejected before any API call. pdf.js loads only when the first file
  arrives, and its Adobe CMaps are served with the app, so CID-keyed fonts (common in CJK
  documents) also yield text.
- **One data contract.** `src/types/schema.ts` defines the result once with Zod. The server
  derives the JSON schema for the model from it, and both the server and the browser validate
  with it. It follows the layout and key order of the schema in the brief, uses strict objects
  (unknown keys fail), and checks ISO 639-1 languages, ISO 4217 currencies, ISO 8601 dates,
  3–5 summary sentences and 3–7 key points.
- **Analysis in the document's language.** The summary, key points, contexts and keywords are
  written in the document's main language (`document.language`); keys stay in English.
- **One self-correction retry.** Enough to fix a typical schema slip, while capping one
  analysis at two model calls of the free quota.
- **A fixed time budget.** Each Gemini request is limited to 25 s, so two requests fit within
  the browser's 60 s limit and the function's 60 s `maxDuration`. A timeout ends as 504
  `LLM_TIMEOUT` with its own message.
- **A post-deploy check.** After each deploy from `main`, the Pages workflow sends a CORS
  preflight to the API and waits until it answers 204 and reports the deployed commit, so a
  crashing, misconfigured or outdated API fails the run.

## Security

- **The API key stays on the server.** Only the Vercel function reads `LLM_API_KEY`; `VITE_*`
  variables are public and hold no secrets.
- **CORS with an exact allowlist** of origins from `ALLOWED_ORIGIN`; look-alike origins and
  wildcards are rejected. CORS limits which websites can read responses; it is not
  authentication.
- **Limits:** the file (10 MB, checked in the browser), the text (150,000 characters), the
  request body (JSON only, 1 MB, counted while it is read) and the file name (255
  characters), plus the request limit per IP described below.
- **Untrusted input:** the document text is wrapped in delimiters that the text cannot close,
  and the prompt tells the model to treat instructions inside the document as content.
- **No document content in logs:** the function logs error codes and upstream status codes
  only; provider error messages are dropped because they may quote the request.
- **No storage at the provider:** Gemini requests use `store: false`. The UI asks users not to
  upload confidential documents, as the free-tier terms require.
- **Hardening headers:** `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` on
  every API response.

## Known limitations

- **Long documents:** text above 150,000 characters is rejected; there is no splitting into
  chunks yet (#24).
- **Scans:** there is no OCR. A PDF without a text layer ends with a message asking for one.
- **Free-tier quota and load:** when the quota is used up, the API answers 429
  `LLM_QUOTA_EXCEEDED`. Gemini sometimes answers 503 under load; trying again usually works.
- **Safety blocks:** Gemini's Interactions API gives no explicit safety signal, so a blocked
  reply ends as 503 `LLM_UNAVAILABLE`, not as a dedicated error.
- **Request limit per IP:** users behind one shared address share it.
- **Sentence counting is heuristic:** it uses `Intl.Segmenter`, which can misjudge rare
  abbreviations; a wrong count triggers the correction retry.
- **History stays in one browser:** the last 3 analyses live in `localStorage` and disappear
  with the browser data.
- **AI output can be wrong:** the UI says so; check important values against the document.

## Local development

Requirements: Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

`npm run dev` serves only the frontend. To run the whole flow, upload → analysis → result,
start the API proxy locally as well:

1. In `.env.local` set:
   - `LLM_API_KEY`: a Gemini API key from Google AI Studio,
   - `ALLOWED_ORIGIN=http://localhost:5173`,
   - `VITE_API_URL=http://localhost:3000`,
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: an Upstash Redis database for
     the request limit (see below).
2. In one terminal run `npm run dev:api`. It serves the real `api/analyze.ts` at
   `http://localhost:3000/api/analyze`, on loopback only.
3. In another terminal run `npm run dev` and open http://localhost:5173.

If port 5173 is taken, Vite picks the next free one. Add that origin to `ALLOWED_ORIGIN`
(comma-separated), or the API rejects the request.

Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run format:check`.

## Deployment

### Frontend: GitHub Pages

[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) runs the checks
and the build on every pull request, and deploys `dist` to GitHub Pages on every push to
`main`. The build uses `VITE_BASE_PATH=/PDF-Insight/`.

One-time setup in the repository settings:

- Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- Settings → Secrets and variables → Actions → **Variables**: `VITE_API_URL` with the base
  URL of the deployed API, without `/api/analyze`. It ends up in the public bundle, so it is
  a variable, not a secret. Deploys fail while it is missing.

### API proxy: Vercel

`api/analyze.ts` is a Vercel function. Every other path on the Vercel domain redirects to the
GitHub Pages demo (`vercel.json`). Set these environment variables in the Vercel project:

- `LLM_API_KEY` (secret): use a Google Cloud project without billing, so requests above the
  free tier are rejected instead of charged.
- `LLM_MODEL` (optional): defaults to `gemini-3.1-flash-lite`.
- `ALLOWED_ORIGIN`: must include `https://devtomaszstoklosa.github.io`. An origin has no
  path, so it does not include `/PDF-Insight/`.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (secret): the REST endpoint and
  token of an Upstash Redis database (the free plan is enough). Both are required; without
  them the API answers `SERVER_MISCONFIGURED`.

Keep "Automatically expose System Environment Variables" on (the default): every API
response carries the deployed commit in `X-App-Version`, read from `VERCEL_GIT_COMMIT_SHA`.
After each deploy, the Pages workflow waits until the API reports the commit it deployed,
so a failed or unpromoted Vercel deployment fails the run.

CORS limits which websites can read the responses; it does not authenticate callers.

#### Request limit

Each client may request 5 analyses per minute and 30 per day; further requests get HTTP 429
`RATE_LIMITED` with a `Retry-After` header. Clients are identified by IP address, which the
API hashes before storing it in Redis. Users behind one shared address share the limit. If
Redis is unreachable or slower than 1 s, the request is allowed and
`RATE_LIMIT_UNAVAILABLE` is logged, so a Redis outage does not take the demo down.

# AI Log: PDF Insight

This log documents how AI was used to build PDF Insight: the tools, the key prompts, where the
AI agent went wrong and how it was corrected. Every entry can be traced to a Claude Code
session in this repository, an issue or pull request (#1–#14), or the git history. It describes
the state on 2026-10-19.

The log itself was drafted with Claude Code from the session transcripts and the git history,
and reviewed by me.

## Narzędzia (Tools)

- **Claude Code** (Anthropic), desktop app on Windows 10: the coding agent. It read the
  repository, proposed plans, wrote the code and tests, ran the checks and managed issues and
  pull requests.
- **Model: Claude Opus 5.5** (`claude-opus-5-5`), used in every development session as an
  architectural co-pilot. It proposed designs, alternatives and risks; I made the decisions.
- **Claude Code's built-in browser pane:** used to check every visible change before its pull
  request (UI states, keyboard navigation, 360 px layout, light and dark themes, the GitHub
  Pages base path).
- **GitHub CLI (`gh`):** issues, pull requests and CI status.
- **Inside the product, not a development tool:** the Google Gemini API (free tier, default
  model `gemini-3.1-flash-lite`), called only through the server-side proxy `api/analyze.ts`.

### Working rules for the agent

These rules come from my global Claude Code instructions (`CLAUDE.md`) and applied to every
session:

- **Plan before change.** The agent first describes the files it will change, why, which
  alternatives it rejects and what can break. It writes no code until I approve the plan.
- **One ticket, one branch, one pull request.** Branches are named
  `<type>/<issue>-<description>`, and each pull request ends with `Closes #<issue>`. The agent
  never commits to `main` and never merges; I merge after review.
- **Verification before every pull request:** typecheck, lint with `--max-warnings 0`, tests,
  format check and build, plus a browser check for visible changes.
- **No fixes on the side.** Problems found outside the current task become separate tickets
  (for example #7, #11 and #13) instead of unreviewed changes. Security findings are never
  described in public issues.

## Kluczowe Prompty (Key Prompts)

Every main prompt had the same four-part structure:

- **Role:** a persona with a matching area of expertise ("You are a Senior TypeScript
  Engineer…").
- **Context:** why the task exists and what the result is for.
- **Detailed instructions:** numbered requirements with exact file names, field names and
  behaviours.
- **Constraints & Repeat:** the hard rules, repeated at the end (no `any`, never log secrets,
  fail fast).

### 1. Project setup ("Senior Full-Stack Engineer and AI Architect")

- **Asked for:** React 18 + Vite + strict TypeScript, a fixed folder structure, a `base` path
  for GitHub Pages read from `VITE_BASE_PATH`, strict ESLint and Prettier that block `any` and
  `console`, and `.env.example`. The recruitment brief was attached as context.
- **Outcome:** #1 / PR #2. Before planning, the agent checked package compatibility: TypeScript
  7 was not supported by `typescript-eslint`, and ESLint 10 was not supported by
  `eslint-plugin-jsx-a11y`. It pinned TypeScript `~6.0` and ESLint 9, and pinned React to 18.3
  because the current Vite template ships React 19.

### 2. Data contract ("Senior TypeScript Engineer")

- **Asked for:** a Zod schema in `src/types/schema.ts` with exact fields: a `type` enum
  (`umowa`, `faktura`, `oferta`, `raport`, `inne`), and a `document` object with metadata, a
  3–5 sentence summary, 3–7 key points, entities, amounts (ISO 4217), dates (ISO 8601) and
  keywords. Missing data must be `null` or `[]`. Inferred types and Vitest tests for valid and
  invalid payloads were also required.
- **Outcome:** #3 / PR #4. Every object uses `z.strictObject`, so an unknown key fails
  validation. Dates use `z.iso.date()`, which also rejects impossible dates such as
  `2024-02-30`. Currencies must match `/^[A-Z]{3}$/`. Sentences are counted with
  `Intl.Segmenter`, so Polish abbreviations and dates ("Sp. z o.o.", "1.02.2024 r.") do not
  split a sentence.

### 3. LLM proxy with self-correction ("Backend and Security Expert")

- **Asked for:** a serverless endpoint `api/analyze.ts` that limits the request size, accepts
  only plain extracted text and treats it purely as data (prompt injection), restricts CORS to
  allowed origins and reads the key only from `process.env.LLM_API_KEY`. It needed a few-shot
  system prompt (extraction-engine role, the schema rules, pure JSON only) and exactly one
  retry with the message "Your previous JSON did not match the required schema due to:
  [error]. Fix this and return a valid JSON.", followed by a Polish error if the retry also
  fails. Secrets must never be logged.
- **Outcome:** #5 / PR #6. The body is read as a stream with a hard byte limit, without
  trusting `Content-Length`, and raw PDF bytes (`%PDF-`) are rejected. The PDF text goes inside
  `<document>` tags, with copies of those tags escaped. The system prompt has two worked
  examples, one of them a document that tries to give the model instructions. The JSON schema
  sent to Gemini is generated from the Zod contract with `z.toJSONSchema()`, and Zod still
  validates every reply. A second invalid reply returns 502 `LLM_INVALID_OUTPUT`.

### 4. Frontend UX ("Senior Frontend and UX Engineer")

- **Asked for:** the Definition of Done: a reviewer with no instructions uploads a PDF by drag
  & drop (max 10 MB), sees a summary and structured data in under 30 seconds and downloads a
  valid `.json` file. That meant a dropzone with Polish validation messages, text extraction in
  the browser with `pdfjs-dist` and a worker that works under Vite and GitHub Pages, empty,
  loading, error ("Spróbuj ponownie") and result states, a JSON tab with a `Blob` download, the
  last 3 analyses in `localStorage` (F-09), and a responsive, accessible layout from 360 px.
- **Outcome:** #9 / PR #10. PDF.js loads only when the first file arrives. Its worker is
  imported with `?url`, so Vite emits it under `base`; this was in the first plan and was
  checked in the build output (`/PDF-Insight/assets/pdf.worker.min-*.mjs`) and later in a
  preview served under `/PDF-Insight/`. The analysis flow is a `useReducer` state machine with
  `extractText` and `analyzeText` injected. History entries are re-validated with the Zod
  schema when read, because `localStorage` is untrusted.

### 5. CI/CD ("DevOps Engineer")

- **Asked for:** a GitHub Actions workflow that lints, tests and builds with the Vite base path,
  deploys `dist` with `actions/deploy-pages`, has `pages: write` and `id-token: write`, and
  fails fast.
- **Outcome:** the workflow already existed in PR #12 (ticket #11, which the agent had drafted
  as an out-of-scope finding while working on #9). The agent checked the prompt against it item
  by item. The only gap was the file name: the prompt asks for `deploy.yml`, the file is
  `deploy-pages.yml`. The agent proposed a rename, which is still undecided. PR #12 also adds
  `npm run dev:api`, a local server for the real API handler.

### Short steering prompts

Short replies that changed the agent's direction:

- **"Chcę użyć w pełni darmowego API"** ("I want to use a fully free API"): replaced the paid
  LLM provider (see mistake 1).
- **"Follow the pasted spec layout as written: type at the top level, everything else inside
  document."**: settled the schema layout (see mistake 3).
- **"Plan approved, including the pull_request trigger (checks and build only)."**: accepted a
  CI extension that the agent proposed but would not add without my consent.
- **"Yes, create the ticket about the invalid Gemini key mapping as drafted."**: turned a
  finding into ticket #13 instead of an unreviewed fix (see mistake 2).

## Potknięcia AI i Poprawki (AI Mistakes & Fixes)

### 1. A paid LLM provider by default

- **What the AI did:** the first backend plan assumed Claude through `@anthropic-ai/sdk`, with
  `claude-opus-5-5` as the default model, prompt caching and refusal fallbacks. That is a paid
  API behind a public demo that anyone can call.
- **Why it was a problem:** every analysis on the public demo would cost money, and Anthropic
  has no free API tier. The agent listed the provider as an assumption to confirm, but chose a
  paid default.
- **How I corrected it:** before approving the plan, I replied "Chcę użyć w pełni darmowego
  API".
- **The fix:** a revised plan, before any code was written:
  - The provider became the Gemini Developer API free tier (`gemini-3.8-flash`). The agent
    compared alternatives and rejected them: Groq (the tokens-per-minute limit is too low for
    one document), OpenRouter free models (low daily caps, and the providers behind them may
    log prompts) and GitHub Models (about 8,000 input tokens per request).
  - The provider sits behind the `LlmClient` interface (`server/llmClient.ts`), with the Gemini
    adapter in `server/geminiLlmClient.ts`. Changing providers means writing a new adapter.
  - The key comes from a Google Cloud project without billing, so requests over the free limit
    are rejected instead of charged. Requests use `store: false`, so Google keeps no document
    text, and there are no automatic transport retries, so each request counts once against
    the quota.
  - The free-tier terms ask users not to submit confidential data. That became issue #7: a
    confidentiality notice in the UI (PR #8).

### 2. An invalid API key reported as a temporary outage

- **What the AI did:** in `toLlmError` (`server/geminiLlmClient.ts`), the agent mapped only
  HTTP 401, 403 and 404 from Gemini to a configuration error, assuming the usual status codes
  for authentication failures.
- **How it was found:** while verifying the local API server for #11 with a fake key, Gemini
  answered HTTP 400 (`INVALID_ARGUMENT`). The proxy returned 503 `LLM_UNAVAILABLE` ("Usługa
  analizy dokumentów jest chwilowo niedostępna") instead of `SERVER_MISCONFIGURED`. To users
  and in the logs, a configuration error looked like a temporary outage.
- **How it was handled:** the fix was outside the ticket, so the agent did not patch it on the
  side. It reported the file, the lines and the evidence, and I approved ticket #13 (`bug`).
- **Status: open, not fixed yet.**
- **Lesson:** the unit tests used a fake LLM client with the status codes the agent assumed.
  Tests with fakes verify assumptions, not the provider's real behaviour; only a run against
  the real API exposed it.

### 3. Proposing to change the specified schema layout

- **What the AI did:** while planning the Zod contract, the agent pointed out that the spec puts
  `summary`, `keyPoints`, `entities`, `amounts`, `dates` and `keywords` inside `document`. It
  suggested the "more common" layout: metadata in `document`, the analysis fields at the top
  level. It said it would follow the spec unless told otherwise.
- **Why it was a problem:** the spec is the contract that the frontend, the backend and the
  reviewers rely on. A "cleaner" layout would have broken the JSON structure every consumer
  expects.
- **How I corrected it:** "Follow the pasted spec layout as written: type at the top level,
  everything else inside document."
- **The fix:** `documentInsightSchema` follows the spec exactly, and `z.strictObject` turns any
  deviation (a missing or extra key) into a validation error. This was a design suggestion, not
  a code bug, and the agent raised it as a decision instead of changing the layout on its own.

### Smaller findings

- **A file just over the limit showed as "10 MB".** In the browser check before PR #10, a file
  of 10 MB + 1 byte was rejected correctly, but the message said "(10 MB)". The agent fixed it
  before the pull request with `roundingMode: 'ceil'` in `src/lib/formatters.ts`, so it now
  shows "10,1 MB". The mandatory browser check found this, not the unit tests.
- **A planned error code that could not be implemented.** The backend plan promised a 422
  `LLM_REFUSED` for safety blocks, but Gemini's Interactions API gives no explicit safety
  signal, so a safety block ends as 503. The agent reported this deviation in PR #6 instead of
  leaving it out.
- **The base path mangled by the local shell.** During local builds, Git Bash (MSYS path
  conversion) rewrote `VITE_BASE_PATH=/PDF-Insight/` into a Windows path. This was an
  environment problem, not a code bug: local builds run with `MSYS_NO_PATHCONV=1`, and CI on
  Linux is not affected.

## Developer Ownership Statement

I directed this project and made every decision recorded in this log: the scope of each ticket,
the approval or change of each plan, and every merge. The AI agent wrote most of the code under
that direction, and no change reached `main` without my review of its pull request.

I have read and understood every line of code in this repository, including the architecture,
the data contract, the security measures and the tests. I take full ownership of it, including
the known limitations described above and in the open issues, and I can explain, defend and
change any part of it.

Tomasz (devTomaszStoklosa)

# AI Log: PDF Insight

This log documents how AI was used to build PDF Insight: the tools, the key prompts, where the
AI agent went wrong and how it was corrected. Every entry can be traced to a Claude Code
session in this repository, an issue or pull request (#1–#53), or the git history. It describes
the state at submission, on 2026-10-20.

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
- **Inside the product, not development tools:** the Google Gemini API (free tier, default
  model `gemini-3.1-flash-lite`), called only through the server-side proxy `api/analyze.ts`,
  and Upstash Redis (free plan), which counts requests for the request limit.

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

Every build prompt (1–4) had the same four-part structure; the review prompts (5) were short
requests with the brief attached:

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
  split a sentence. Two later fixes came from the review (prompt 6): the layout was moved to
  the brief's schema (#19, see mistake 3), and currencies are checked against a list of ISO
  4217 codes, not just three capital letters (#27).

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

### 5. Pre-submission reviews ("Principal developer", "senior developer and architect")

- **Asked for:** two short requests, each with the brief attached. On 2026-10-19: "Zrób
  dokładny review jako Principal developer czy wszystko w tym projekcie jest już gotowe zgodnie
  z załączonymi wymaganiami. Jeśli widzisz cokolwiek do dopracowania daj znać" ("Review this
  project as a principal developer: is everything ready according to the attached
  requirements? Tell me about anything that needs work."). On 2026-10-20: "Jesteś senior
  developerem i senior architektem. przeanalizuj dokładnie czy wszystko jest zaimplementowane
  zgodnie z wymaganiami klienta i czy nie ma miejsc gdzie warto coś poprawić, zoptymalizować
  lub zrobić zgodnie z jakimiś wzorcami. To jest zadanie rekrutacyjne i ma być zrobione
  idealnie." ("You are a senior developer and a senior architect. Check carefully that
  everything is implemented according to the client's requirements, and whether anything is
  worth improving, optimizing or doing according to a pattern. This is a recruitment task, and
  it has to be perfect.")
- **Outcome of the first review:** the agent compared the repository with the brief section by
  section and called the deployed API. It found that every request to the deployed API crashed
  (#18), that the JSON layout and the output language did not match the brief (#19, #20), and
  smaller gaps (#16, #21, #22, #24–#27). One security-related finding was reported privately
  instead of in a public issue, and fixed in PR #34. I approved an order, and each finding went
  through its own plan and pull request (PRs #28–#41). #24, splitting long documents into
  parts, was postponed and then implemented in PR #43, followed by a retry after transient
  Gemini errors (#44) and warnings for them (#46).
- **Outcome of the second review:** the agent checked the brief point by point and sent 9
  analyses to the demo API; 2 ended with 504 after 25 s (see mistake 7). It also found that this
  log contradicted the README about #24 and listed 6 key prompts instead of 3–5 (#49), and that
  the demo had no favicon (#48). It reported the findings by priority, with a plan; each
  approved finding got its own ticket and pull request (PRs #50, #52, #53).

### Other prompts

- **CI/CD ("DevOps Engineer"):** asked for a GitHub Actions workflow that lints, tests, builds
  with the Vite base path and deploys `dist` with `actions/deploy-pages`. The workflow already
  existed in PR #12 (ticket #11, which the agent had drafted as an out-of-scope finding while
  working on #9), so the agent checked the prompt against it item by item. The only gap was the
  file name: the prompt asks for `deploy.yml`, the file is `deploy-pages.yml`, and I kept it,
  because the name says what the workflow does. After the first review, the workflow gained a
  format check and a post-deploy check that the API answers and runs the deployed commit (#22,
  #36).

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
- **Pasting the Vercel build log for #18:** replaced the agent's first, assumed diagnosis with
  the real one (see mistake 4).
- **"I set LLM_API_KEY"** (in a local, git-ignored `.env.local`): allowed four measured calls
  that found the real cause of the timeouts (see mistake 5).
- **"In Vercel Hobby plan I don't have Vercel Firewall, so let's go with Option 2: Upstash
  Redis"**: chose how the request limit is stored (PR #34).
- **"Pomiń #24"** ("Skip #24"): postponed the optional chunking of long documents; it was
  implemented later, in PR #43.
- **"Zatwierdzam plan: pomiar na kluczu z .env.local, tickety A, B, C i porządki repo
  (usunięcie zmergowanych branchy)."** ("I approve the plan: the measurement with the key in
  .env.local, tickets A, B and C (#51, #49, #48), and the clean-up of merged branches."):
  allowed the 21 measured calls behind the fix for mistake 7.

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
  - The provider became the Gemini Developer API free tier (`gemini-3.8-flash`, later replaced
    by `gemini-3.1-flash-lite`, see mistake 5). The agent
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
- **Status: fixed** in PR #17: an upstream 400 now maps to `SERVER_MISCONFIGURED`.
- **Lesson:** the unit tests used a fake LLM client with the status codes the agent assumed.
  Tests with fakes verify assumptions, not the provider's real behaviour; only a run against
  the real API exposed it.

### 3. A schema layout checked against the prompt instead of the brief

- **What the AI did:** while planning the Zod contract, the agent pointed out that the spec in
  the prompt puts `summary`, `keyPoints`, `entities`, `amounts`, `dates` and `keywords` inside
  `document`, and suggested the "more common" layout: metadata in `document`, the analysis at
  the top level. I told it: "Follow the pasted spec layout as written: type at the top level,
  everything else inside document." It did, without checking the pasted spec against the
  brief, which had been attached at project setup.
- **Why it was a problem:** the brief is the acceptance contract, and its schema (section 04)
  has exactly the layout the agent first suggested: only the metadata, including `type`, in
  `document`. The JSON preview and the downloaded file did not match it.
- **How it was found:** the pre-submission review (prompt 6) compared the contract with the
  brief's schema (#19).
- **The fix:** PR #29 moved to the brief's layout and key order, generated the model's output
  schema from it, and changed the history storage key, so entries in the old layout are
  ignored. A test parses the example JSON from the brief.
- **Lesson:** when a prompt restates a source document, check the restatement against the
  source. The agent's suggestion was right, but it argued from "common practice" instead of
  pointing to the brief, so the correction went the wrong way.

### 4. The API was never checked where it runs

- **What the AI did:** the proxy had unit tests and a local server, but the agent never called
  the deployed Vercel function. Every production request crashed with
  `FUNCTION_INVOCATION_FAILED` (#18). Its first fix plan then assumed the cause: switch the
  imports from `.ts` to `.js` and run the local server with `tsx`.
- **How it was found:** the pre-submission review called the deployed API. The real cause came
  from the Vercel build log I pasted: Vercel compiles `api/*.ts` with the nearest
  `tsconfig.json`, the root file without compiler options, so the output was CommonJS with
  `.ts` import paths.
- **The fix:** a revised plan before any code. PR #28 gives the root `tsconfig.json` ES module
  options with `rewriteRelativeImportExtensions`, and a test repeats Vercel's compile. Later,
  the Pages workflow started checking the deployed API after every deploy (#22, #36).
- **Lesson:** passing local tests do not prove a deployment works, and a fix plan needs the
  log, not a guess.

### 5. Tuning the model without measuring it

- **What the AI did:** the demo timed out, and the agent blamed the model's default thinking
  level without measuring it. It planned `thinking_level: 'low'` and a 25 s limit per request
  (#16). That plan also named the wrong SDK error class for a timeout; a quick test against a
  local server that never answers showed the right one (`APIConnectionTimeoutError`) before
  any code was written.
- **How it was found:** after PR #30, every analysis still ended with 504 after 25 s. With my
  key in a git-ignored `.env.local`, the agent made four measured calls: `gemini-3.8-flash`
  wrote about 500 tokens in 21.6–35 s with 0 thinking tokens, answered 503 once, and rejected
  `thinking_level: 'minimal'`. Two lite models answered in 2.5 and 5.6 s.
- **The fix:** PR #30 kept the time budget and the new 504 `LLM_TIMEOUT`; PR #32 made
  `gemini-3.1-flash-lite` the default and corrected the comment that blamed thinking (#31).
- **Lesson:** measure before tuning. One timed call would have saved a release.

### 6. Analysis always in Polish

- **What the AI did:** the system prompt required Polish descriptive text "even when the
  document is in another language", and the English few-shot example had Polish output.
- **Why it was a problem:** the brief requires the summary and all values in the document's
  language (#20).
- **The fix:** PR #33 asks for the document's main language (`document.language`) and rewrote
  the English example in English; tests check the rule and each example's language. On the
  demo, an English agreement then got English output, and a Polish invoice Polish output.
- **Lesson:** the same as mistake 3: every rule in a prompt should trace back to the brief.

### 7. A stalled request treated as a final answer

- **What the AI did:** the time budget from #16 ended the analysis when a request to Gemini
  timed out, and the retry added in #44 covered only the 500 and 503 answers. A timeout was
  final, although half of the 50 s budget was still left.
- **How it was found:** the second pre-submission review (prompt 5) sent 9 analyses to the demo
  API. 2 ended with 504 after 25 s, both for a short Polish contract that passed in 5–12 s in
  four other attempts.
- **The fix:** this time the agent measured first. With my key in the git-ignored `.env.local`,
  it made 21 direct calls with a 90 s timeout: 20 replies took 2.2–8.8 s and one 15.6 s, all
  with normal token counts, so the requests stall on the provider's side instead of generating
  too much. PR #52 limits the first attempt to 15 s and sends a stalled request once more with
  25 s, if the deadline allows it (#51). A local run with the real SDK and a forced first
  timeout logged the retry and returned the analysis in 6.6 s; after the deploy, 7 analyses on
  the demo took 3.1–5.8 s, and none stalled.
- **Lesson:** a retry policy should follow the failures measured on the deployed system, not
  only the error codes the provider documents.

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
- **Production on an older deployment.** After PR #34 was merged, six quick requests to the
  demo API never got 429, and Redis held no counters for them. The agent traced it to a
  redeploy of an older commit that was still the current production deployment in Vercel.
  Nothing had reported it, which led to the commit check after each deploy (#36).
- **A protection that protected nothing.** An early suggestion for the request limit included
  a global daily cap. While planning PR #34, the agent dropped it: once used up, it blocks
  everyone, exactly as the provider's own quota does.
- **A lost executable bit.** On Windows, the commit for #22 stored
  `scripts/check-api-preflight.sh` without its executable bit. The workflow calls it with
  `bash`, so nothing broke; PR #41 restored the bit.

## Developer Ownership Statement

I directed this project and made every decision recorded in this log: the scope of each ticket,
the approval or change of each plan, and every merge. The AI agent wrote most of the code under
that direction, and no change reached `main` without my review of its pull request.

I have read and understood every line of code in this repository, including the architecture,
the data contract, the security measures and the tests. I take full ownership of it, including
the known limitations described above and in the open issues, and I can explain, defend and
change any part of it.

Tomasz (devTomaszStoklosa)

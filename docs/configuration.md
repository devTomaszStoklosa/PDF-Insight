# Configuration

## Environment variables

Local values go in `.env.local` (git-ignored); [`.env.example`](../.env.example) is the only
tracked env file. Vite inlines every `VITE_*` variable into the public bundle, so a secret
must never use that prefix.

### Frontend (public)

| Variable         | Required          | Purpose                                                                                                                                                                       |
| ---------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`   | for a working app | base URL of the API proxy, without `/api/analyze`; locally `http://localhost:3000`. In CI it comes from the repository variable of the same name, and deploys fail without it |
| `VITE_BASE_PATH` | no, default `/`   | path the app is served from; CI sets `/PDF-Insight/`                                                                                                                          |

### API proxy (secret, set in Vercel)

| Variable                   | Required      | Rules                                                                                                                                                                |
| -------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LLM_API_KEY`              | yes           | Gemini API key; create it in a Google Cloud project without billing, so quota overruns are rejected, not charged                                                     |
| `LLM_MODEL`                | no            | Gemini model ID; empty or unset means `gemini-3.1-flash-lite`                                                                                                        |
| `ALLOWED_ORIGIN`           | yes           | comma-separated origins, each scheme + host (+ port), no path, no trailing slash; compared exactly. Must include `https://devtomaszstoklosa.github.io` in production |
| `UPSTASH_REDIS_REST_URL`   | yes           | `https://` REST endpoint of an Upstash Redis database                                                                                                                |
| `UPSTASH_REDIS_REST_TOKEN` | yes           | token of that database                                                                                                                                               |
| `VERCEL_GIT_COMMIT_SHA`    | set by Vercel | exposed as `X-App-Version`; keep "Automatically expose System Environment Variables" on                                                                              |

Any invalid or missing required variable makes every request answer `SERVER_MISCONFIGURED`
(500) without echoing a value, including preflights. That is intentional: the post-deploy
check uses a preflight to detect a broken configuration.

## Build and runtime files

| File                                 | Purpose                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `vite.config.ts`                     | `base` from `VITE_BASE_PATH`, React plugin                                                                                              |
| `vercel.json`                        | `maxDuration: 60` for `api/analyze.ts`; redirects every non-`/api/` path to the GitHub Pages demo                                       |
| `tsconfig.json`                      | project references; its own `compilerOptions` are what Vercel uses to compile `api/*.ts` (ES modules, `.ts` imports rewritten to `.js`) |
| `tsconfig.app.json`                  | `src/`: DOM, `react-jsx`, bundler resolution                                                                                            |
| `tsconfig.api.json`                  | `api/`, `server/`, `scripts/`: Node ESM (`nodenext`)                                                                                    |
| `tsconfig.node.json`                 | `vite.config.ts`                                                                                                                        |
| `eslint.config.js`                   | flat config, see below                                                                                                                  |
| `.prettierrc.json`                   | single quotes, semicolons, trailing commas, 100 columns, LF                                                                             |
| `.github/workflows/deploy-pages.yml` | CI, Pages deploy, post-deploy API check                                                                                                 |

All TypeScript projects are strict, with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
and `erasableSyntaxOnly` (no enums or constructor parameter properties), so Node can run the
sources directly with `--experimental-strip-types`.

### Lint rules worth knowing

- `typescript-eslint` strict and stylistic type-checked sets; `no-explicit-any` is an error.
- `no-console` is an error in `src/` and `server/`; `api/` may use `console.warn` and
  `console.error`; `scripts/` may use `console.info` and `console.error`.
- `dangerouslySetInnerHTML` is forbidden.
- `consistent-type-imports`, `eqeqeq`, React hooks, React refresh and `jsx-a11y` strict.
- `--max-warnings 0`: a warning fails `npm run lint`.

## npm scripts

| Script                 | Command / effect                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server (runs `predev`: copies pdf.js CMaps into `public/pdfjs/`)                     |
| `npm run dev:api`      | serves the real `api/analyze.ts` on `127.0.0.1:3000` (`PORT` overrides), reading `.env.local` |
| `npm run build`        | `prebuild` (CMaps), `tsc -b`, `vite build` into `dist/`                                       |
| `npm run preview`      | serves the production build                                                                   |
| `npm run typecheck`    | `tsc -b`                                                                                      |
| `npm run lint`         | ESLint, no warnings allowed                                                                   |
| `npm run format`       | Prettier, writes changes                                                                      |
| `npm run format:check` | Prettier, check only (covers Markdown too)                                                    |
| `npm test`             | Vitest, single run                                                                            |
| `npm run test:watch`   | Vitest in watch mode                                                                          |

Node.js 22 and npm are required. `public/pdfjs/` is generated and not tracked; starting Vite
without the `predev` script leaves CID-keyed CJK PDFs unreadable.

## Tunable constants

| Constant                                  | Value            | File                           |
| ----------------------------------------- | ---------------- | ------------------------------ |
| `MAX_TEXT_CHARS`                          | 225,000          | `src/types/analyzeLimits.ts`   |
| `MAX_PDF_BYTES`                           | 10 MB            | `src/lib/validatePdfFile.ts`   |
| `ANALYZE_TIMEOUT_MS`                      | 60 s             | `src/api/analyzeClient.ts`     |
| `HISTORY_LIMIT`                           | 3                | `src/lib/historyStorage.ts`    |
| `MAX_BODY_BYTES`                          | 1,500,000        | `server/requestBody.ts`        |
| `TARGET_CHUNK_CHARS`                      | 37,500           | `server/textChunks.ts`         |
| `MAX_PARALLEL_REQUESTS`                   | 3                | `server/analyzeDocument.ts`    |
| `RATE_LIMITS`                             | 5/min, 30/day    | `server/upstashRateLimiter.ts` |
| `ANALYSIS_BUDGET_MS` and attempt timeouts | 50 s, 15 s, 25 s | `server/geminiLlmClient.ts`    |
| `MAX_OUTPUT_TOKENS`                       | 16,000           | `server/geminiLlmClient.ts`    |

Keep these relations: `ANALYZE_TIMEOUT_MS` above `ANALYSIS_BUDGET_MS`, and `maxDuration`
in `vercel.json` above both; `MAX_BODY_BYTES` large enough for `MAX_TEXT_CHARS` of multi-byte
text; `MAX_CHUNKS` is derived from `MAX_TEXT_CHARS / TARGET_CHUNK_CHARS` (6 today), so raising
the text limit raises the number of model calls per analysis.

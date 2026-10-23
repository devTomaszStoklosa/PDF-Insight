# Operations

## Environments

| Environment      | Where                                                          | Deployed by                                            |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| Frontend         | GitHub Pages, https://devtomaszstoklosa.github.io/PDF-Insight/ | `.github/workflows/deploy-pages.yml` on push to `main` |
| API              | Vercel project (function `api/analyze.ts`)                     | Vercel's Git integration on push to `main`             |
| Request counters | Upstash Redis (free plan)                                      | managed in Upstash                                     |
| LLM              | Gemini API, Google Cloud project without billing               | n/a                                                    |

The two deploys are independent. That is why the workflow ends with a check that the API runs
the commit that was just deployed.

## CI/CD

The workflow runs on pull requests to `main`, on pushes to `main` and manually.

1. **build** (every run): `npm ci`, `typecheck`, `lint`, `format:check`, `test`. For deploys
   it requires the repository variable `VITE_API_URL`, builds with
   `VITE_BASE_PATH=/PDF-Insight/` and uploads `dist` as the Pages artifact. Pull requests
   stop after the checks and the build.
2. **deploy** (push to `main` only): publishes the artifact to GitHub Pages.
3. **check-api** (after deploy): full clone, then `scripts/check-api-preflight.sh`.

Concurrency: deploys run one at a time and a newer push waits; pull request runs are
replaced by newer pushes on the same branch.

### Post-deploy check

`scripts/check-api-preflight.sh <api-url> <origin> <commit>` sends `OPTIONS /api/analyze`
with the Pages origin, up to 30 times 10 s apart (5 times without a commit). It succeeds when
the API answers `204` with `Access-Control-Allow-Origin` equal to the origin and
`X-App-Version` equal to the commit, or a newer full commit that contains it (found with
`git merge-base --is-ancestor`, fetching the commit when needed). It uses no model or limiter
quota. It fails when the API crashes, rejects the configuration, or serves an older commit.
`CHECK_API_ATTEMPTS` and `CHECK_API_DELAY_SECONDS` override the retry settings.

Do not re-run an old deploy run: it would publish that run's older build over a newer one.
Start a new run from `main` instead.

## One-time setup

1. **GitHub:** Settings, Pages, Source: GitHub Actions. Settings, Secrets and variables,
   Actions, Variables: `VITE_API_URL` (the API base URL, public).
2. **Google Cloud / AI Studio:** create a project without billing, create a Gemini API key.
3. **Upstash:** create a Redis database; copy the REST URL and token.
4. **Vercel:** import the repository; set `LLM_API_KEY`, `ALLOWED_ORIGIN`,
   `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and optionally `LLM_MODEL`; keep
   system environment variables exposed.

Details of each variable are in [Configuration](configuration.md).

## Monitoring

There is no metrics stack; Vercel function logs are the source. Each line is JSON.

| Log entry                                                    | Meaning                                                | Action                             |
| ------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------- |
| `level: error`, `code: SERVER_MISCONFIGURED`                 | bad environment variable, rejected key or model        | fix Vercel variables, redeploy     |
| `code: LLM_QUOTA_EXCEEDED`                                   | Gemini free-tier quota used up                         | wait, or lower traffic             |
| `code: RATE_LIMITED`                                         | a client hit the 5/min or 30/day limit                 | normal; many of them mean abuse    |
| `code: RATE_LIMIT_UNAVAILABLE`                               | Redis unreachable or slower than 1 s; requests allowed | check Upstash status               |
| `code: LLM_UNAVAILABLE`, `LLM_TIMEOUT` with `upstreamStatus` | Gemini overloaded or stalled after the retry           | usually passes; check frequency    |
| `level: warn`, `code: LLM_TRANSIENT_ERROR`                   | a 500, 503 or stall; `retry` says what happened        | track `skipped` and `failed` rates |
| `code: LLM_INVALID_OUTPUT`                                   | two invalid replies in a row                           | inspect prompt or model change     |

Check a live deployment without spending quota:

```bash
curl -si -X OPTIONS https://<api-host>/api/analyze \
  -H 'Origin: https://devtomaszstoklosa.github.io' \
  -H 'Access-Control-Request-Method: POST'
```

Expect `204`, the CORS headers and `X-App-Version` with the deployed commit.

## Troubleshooting

| Symptom for the user / operator                       | Likely cause                                                 | Fix                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Demo shows "not configured"                           | `VITE_API_URL` was empty at build time                       | set the variable, run a new deploy                              |
| Browser console: CORS error                           | origin not in `ALLOWED_ORIGIN`, or the API crashes           | add `https://devtomaszstoklosa.github.io` (no path), check logs |
| 500 `SERVER_MISCONFIGURED` for every request          | variable missing or malformed; key invalid; model name wrong | check Vercel variables and the Gemini key                       |
| 429 `LLM_QUOTA_EXCEEDED`                              | free-tier quota                                              | wait; try later                                                 |
| 429 `RATE_LIMITED`                                    | per-IP limit; users behind one address share it              | wait for `Retry-After`                                          |
| 503 / 504 on long documents                           | Gemini load; many calls in one analysis                      | retry; see the README's limitations                             |
| Post-deploy check fails with an older `X-App-Version` | Vercel deployment failed or was not promoted                 | open the Vercel deployments and promote or fix                  |
| Post-deploy check fails on the preflight              | function crashes or configuration invalid                    | read the function log, fix, redeploy                            |
| iOS users cannot extract text                         | a modern pdf.js build was imported                           | keep the `pdfjs-dist/legacy` imports (#56)                      |

## Security notes for operators

- Rotate `LLM_API_KEY` and the Upstash token in Vercel if they may have leaked, then redeploy.
- Keep the Google Cloud project without billing; it is the cost ceiling.
- Do not add document content or client addresses to logs.
- CORS is not authentication. Anyone can call the API from a script within the per-IP limit.
- Report vulnerabilities privately (repository Security tab), not in public issues.

## Known limitations

See the README section [Known limitations](../README.md#known-limitations): long documents,
no OCR, free-tier quota and load, safety blocks, shared-IP limits, heuristic sentence
counting, browser-local history and possible AI mistakes.

# PDF Insight

Upload a PDF and get a summary with structured data. The text is extracted in the browser;
only the text goes to an API proxy that calls the LLM (Gemini), so the key never reaches
the browser.

Demo: https://devtomaszstoklosa.github.io/PDF-Insight/

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
   - `VITE_API_URL=http://localhost:3000`.
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

`api/analyze.ts` is a Vercel function. Set these environment variables in the Vercel
project:

- `LLM_API_KEY` (secret): use a Google Cloud project without billing, so requests above the
  free tier are rejected instead of charged.
- `LLM_MODEL` (optional): defaults to `gemini-3.1-flash-lite`.
- `ALLOWED_ORIGIN`: must include `https://devtomaszstoklosa.github.io`. An origin has no
  path, so it does not include `/PDF-Insight/`.

CORS limits which websites can read the responses; it does not authenticate callers.

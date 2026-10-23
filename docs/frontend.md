# Frontend

A single-page React 18 app built with Vite. It has one view, no router and no global state
library. The UI text is Polish. Code lives in [`src/`](../src).

## Composition

[`src/main.tsx`](../src/main.tsx) is the composition root. It creates the concrete
implementations and passes them to `App` as props:

```text
createAnalyzeClient({ apiUrl: VITE_API_URL })  ->  analyzeText
extractPdfText                                 ->  extractText
createHistoryStore(getLocalStorage())          ->  historyStore
```

`App`, the hooks and the components know only the interfaces (`AnalyzeText`,
`ExtractPdfText`, `HistoryStore`), so tests inject fakes.

## Analysis pipeline

`useDocumentAnalysis` runs one file at a time. A new `analyze(file)` aborts the previous run
through an `AbortController`; a cancelled run never writes to the state.

```text
idle -> extracting -> analyzing -> success
              \            \-----> error  (retry re-runs the whole pipeline)
               \-----------------> error
any state -> idle (reset)         any state -> success (showResult from history)
```

The state machine is the pure reducer in [`analysisState.ts`](../src/hooks/analysisState.ts);
actions that arrive in the wrong state are ignored (`progressed` outside `extracting`,
`failed` outside a running state).

| Status       | Payload                         | Shown by                                 |
| ------------ | ------------------------------- | ---------------------------------------- |
| `idle`       | none                            | `EmptyState` (dropzone, how it works)    |
| `extracting` | `file`, `progress` (page/total) | `LoadingState`, step 1 with progress bar |
| `analyzing`  | `file`, `pages`                 | `LoadingState`, step 2                   |
| `error`      | `file`, `message`               | `ErrorState` (retry, choose other file)  |
| `success`    | `insight`                       | `ResultView`                             |

On success `onSuccess` saves the insight in the history.

## Modules

### `src/lib`

| Module               | Responsibility                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `validatePdfFile.ts` | accepts `.pdf` with MIME `application/pdf`, `application/x-pdf` or empty; not empty; at most 10 MB |
| `pdfExtractor.ts`    | lazy-loads pdf.js (legacy build) and its worker, extracts text page by page                        |
| `userFacingError.ts` | `UserFacingError` (safe Polish message) and `toUserMessage`                                        |
| `historyStorage.ts`  | last 3 analyses in `localStorage`, validated on read                                               |
| `browserStorage.ts`  | `KeyValueStorage` type, `localStorage` with an in-memory fallback                                  |
| `formatters.ts`      | Polish formatting of sizes, numbers, amounts, dates, page counts                                   |
| `jsonExport.ts`      | pretty JSON, safe download file name, download through an object URL                               |
| `countSentences.ts`  | sentence counter used by the schema (`Intl.Segmenter`)                                             |

### Text extraction

`extractPdfText` returns `{text, pages}`.

- pdf.js is imported on first use (`import()`), so it is not in the initial bundle. The
  **legacy** build is used because the modern one calls the newest JavaScript methods
  without polyfills and fails on iOS (#56). The worker is imported with `?url`, so Vite
  emits it as a hashed asset under `base`, which keeps it working on `/PDF-Insight/`.
- A failed library load is forgotten (`pdfJsPromise = undefined`), so the next attempt loads
  it again.
- `getDocument` receives `cMapUrl` (an absolute URL built from `import.meta.env.BASE_URL`
  and `pdfjs/cmaps/`) with `cMapPacked: true`; CID-keyed fonts without a ToUnicode map need
  the Adobe CMaps to yield text.
- Page text is the concatenation of text items, with a line break where an item has `hasEOL`.
  Pages are joined with a blank line, which the server uses as the preferred cut point.
- Errors map to Polish messages: password protected, invalid PDF, no text (scan), other.
  There is no OCR. Aborting destroys the loading task and rethrows the abort.

### `src/api/analyzeClient.ts`

`createAnalyzeClient({ apiUrl })` returns `analyzeText(input, signal)`.

- The endpoint is `<VITE_API_URL without trailing slashes>/api/analyze`; a missing or
  non-http(s) URL gives a "not configured" message.
- Text over 225,000 characters is rejected before sending.
- The request is aborted by the caller's signal or after 60 s (`ANALYZE_TIMEOUT_MS`), which
  must stay above the server's 50 s budget.
- An error body from the proxy contributes its Polish `message`; without a valid body the
  message follows the status (413, 429, 5xx, other).
- A 200 response is validated with `documentInsightSchema`; a mismatch gives "invalid
  response".

### History

`createHistoryStore` keeps up to `HISTORY_LIMIT = 3` entries under the key
`pdf-insight:history:v2`, each `{id, savedAt, insight}`, newest first. A new analysis of a
file with the same name replaces the old one. Each entry is validated separately on every
read, so one broken entry does not drop the others; storage failures (quota, blocked) are
swallowed and the history lives for the current visit. Bump the key version when the entry
shape changes. `useAnalysisHistory` mirrors the store in React state.

## Components

| Component                           | Role                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `App`                               | layout, header, footer, switches the view by state, shows the history                                    |
| `EmptyState`                        | intro, `Dropzone`, three-step explanation, `ConfidentialityNotice`                                       |
| `Dropzone`                          | drag and drop plus native file input; blocks the browser opening a stray dropped PDF; validates the file |
| `LoadingState`                      | two-step progress, elapsed seconds (`useElapsedSeconds`), live status text                               |
| `ErrorState`                        | message, retry, choose another file                                                                      |
| `ResultView`                        | header with title and badges, download, tabs                                                             |
| `InsightDashboard`                  | cards: summary, key points, amounts, dates, keywords, entities                                           |
| `InsightSection`                    | card with title and an empty-state message                                                               |
| `DocumentMetaBadges`                | type, pages, language, date                                                                              |
| `JsonPreview`, `DownloadJsonButton` | the JSON tab and the `<name>-insight.json` download                                                      |
| `Tabs`                              | accessible tablist for the result view                                                                   |
| `HistoryList`                       | last analyses, select and clear                                                                          |
| `ProgressBar`, `icons`              | small presentational pieces                                                                              |

### Security and accessibility rules

- All model output is rendered as React text. `dangerouslySetInnerHTML` is banned by ESLint.
- A skip link, a focusable `<main>`, focus moved to the result heading after an analysis,
  `role="status"` for progress, keyboard-operable tabs and `jsx-a11y/strict` linting.
- The footer and the confidentiality notice tell the user that results come from AI and
  that confidential documents should not be uploaded.

## Styling

One stylesheet, [`src/index.css`](../src/index.css), with plain CSS (custom properties, light
and dark themes, layouts down to 360 px). There is no CSS framework.

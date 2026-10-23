# API reference

One endpoint: `POST /api/analyze`, implemented by [`api/analyze.ts`](../api/analyze.ts) and
[`server/handleRequest.ts`](../server/handleRequest.ts). Every other path on the Vercel domain
redirects to the GitHub Pages demo (`vercel.json`).

## Request

```http
POST /api/analyze
Content-Type: application/json
Origin: https://devtomaszstoklosa.github.io
```

```json
{ "fileName": "invoice.pdf", "pages": 1, "text": "FAKTURA VAT nr FV/2024/03/118 ..." }
```

| Field      | Type    | Rules                                                                               |
| ---------- | ------- | ----------------------------------------------------------------------------------- |
| `fileName` | string  | trimmed, 1–255 characters                                                           |
| `pages`    | integer | 1–10,000                                                                            |
| `text`     | string  | at most 225,000 characters; not empty after sanitizing; must not start with `%PDF-` |

Unknown keys are rejected. The body is JSON only (`application/json`, charset parameter
allowed), at most 1,500,000 bytes, counted while it is read, so a missing or false
`Content-Length` does not help. The text is normalized to NFC, line endings become `\n`, and
control characters other than tab and newline are removed.

## Success response: `200`

A `DocumentInsight` ([`src/types/schema.ts`](../src/types/schema.ts)). Key order follows the
recruitment brief.

```json
{
  "document": {
    "fileName": "invoice.pdf",
    "pages": 1,
    "language": "pl",
    "type": "faktura",
    "title": "Faktura VAT nr FV/2024/03/118",
    "date": "2024-03-15"
  },
  "summary": "Three to five sentences ...",
  "keyPoints": ["...", "...", "..."],
  "entities": { "organizations": ["Hostico Sp. z o.o."], "people": ["Jan Kowalski"] },
  "amounts": [{ "value": 1230, "currency": "PLN", "context": "Kwota brutto do zapłaty" }],
  "dates": [{ "date": "2024-03-29", "context": "Termin płatności" }],
  "keywords": ["faktura", "hosting"]
}
```

| Field                | Type / rule                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `document.fileName`  | copied from the request                                                   |
| `document.pages`     | copied from the request                                                   |
| `document.language`  | ISO 639-1, two lowercase letters                                          |
| `document.type`      | `umowa`, `faktura`, `oferta`, `raport` or `inne`                          |
| `document.title`     | string or `null`; as written in the document, never invented              |
| `document.date`      | ISO 8601 `YYYY-MM-DD` or `null`; impossible dates such as 2024-02-30 fail |
| `summary`            | 3–5 sentences (counted with `Intl.Segmenter`)                             |
| `keyPoints`          | 3–7 non-empty strings                                                     |
| `entities`           | `organizations` and `people`, arrays of non-empty strings, may be empty   |
| `amounts[].value`    | number; negative allowed (correction invoices)                            |
| `amounts[].currency` | ISO 4217 code that exists in `src/types/currencyCodes.ts`                 |
| `amounts[].context`  | what the amount is                                                        |
| `dates[].date`       | `YYYY-MM-DD`                                                              |
| `dates[].context`    | what the date is                                                          |
| `keywords`           | non-empty strings (the prompt asks for 3–10)                              |

Descriptive text (`summary`, `keyPoints`, every `context`, `keywords`) is written in the
document's language; keys and enum values stay as listed. Missing information is `null` or
`[]`, never an empty string.

## Error response

```json
{ "error": { "code": "RATE_LIMITED", "message": "Wykonano zbyt wiele analiz ..." } }
```

`message` is Polish, written for the user; it never contains request data or provider
details. Clients should branch on `code`.

| Code                     | HTTP | Meaning                                                             |
| ------------------------ | ---- | ------------------------------------------------------------------- |
| `METHOD_NOT_ALLOWED`     | 405  | method other than POST or OPTIONS (`Allow: POST, OPTIONS`)          |
| `ORIGIN_NOT_ALLOWED`     | 403  | `Origin` missing or not on the allowlist                            |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | content type is not `application/json`                              |
| `PAYLOAD_TOO_LARGE`      | 413  | body over 1.5 MB or text over 225,000 characters                    |
| `INVALID_REQUEST`        | 400  | invalid JSON or UTF-8, schema mismatch, empty text, raw PDF bytes   |
| `RATE_LIMITED`           | 429  | per-client limit reached; has `Retry-After`                         |
| `LLM_QUOTA_EXCEEDED`     | 429  | Gemini free-tier quota used up; `Retry-After` when Gemini sends it  |
| `LLM_INVALID_OUTPUT`     | 502  | the model's reply failed validation twice                           |
| `LLM_UNAVAILABLE`        | 503  | Gemini error, overload or blocked reply, after the one retry        |
| `LLM_TIMEOUT`            | 504  | the 50 s analysis budget or an attempt timeout ran out              |
| `SERVER_MISCONFIGURED`   | 500  | missing or invalid environment variable, bad API key, unknown model |
| `INTERNAL_ERROR`         | 500  | anything unexpected                                                 |

Check order: configuration, origin, method, request limit, body, analysis. A request with a
forbidden origin never reaches the limiter, and a limited request never reads its body.

## Preflight

`OPTIONS /api/analyze` with an allowed `Origin` returns `204` with:

```text
Access-Control-Allow-Origin: <origin>
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 600
```

A preflight loads the configuration but never touches the limiter or the model, so the
post-deploy check can call it without spending quota.

## Response headers

| Header                            | On              | Purpose                                               |
| --------------------------------- | --------------- | ----------------------------------------------------- |
| `Cache-Control: no-store`         | every response  | responses carry document data                         |
| `X-Content-Type-Options: nosniff` | every response  | hardening                                             |
| `Vary: Origin`                    | every response  | caches never reuse a response across origins          |
| `Access-Control-Allow-Origin`     | allowed origins | exact echo of an allowlisted origin, never a wildcard |
| `Retry-After` (seconds)           | 429             | wait before retrying                                  |
| `X-App-Version`                   | every response  | deployed commit (`VERCEL_GIT_COMMIT_SHA`), when known |

## Limits

| Limit               | Value                                         | Enforced by           |
| ------------------- | --------------------------------------------- | --------------------- |
| PDF file            | 10 MB                                         | browser               |
| Extracted text      | 225,000 characters                            | browser and server    |
| Request body        | 1,500,000 bytes                               | server                |
| File name           | 255 characters                                | server                |
| Requests per client | 5 per minute and 30 per day (sliding windows) | server, Upstash Redis |
| Analysis time       | 50 s on the server, 60 s in the browser       | server and browser    |
| Function duration   | 60 s (`maxDuration`)                          | Vercel                |

## Example

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://localhost:5173' \
  -d '{"fileName":"note.pdf","pages":1,"text":"Meeting notes about moving the reporting service to the cloud."}'
```

This spends the Gemini quota of the configured key. Start the local API first with
`npm run dev:api` (see [Development](development.md)).

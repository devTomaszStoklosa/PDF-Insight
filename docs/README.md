# PDF Insight documentation

PDF Insight turns a PDF into a summary and structured data. The text is extracted in the
browser; only the text reaches an API proxy that calls Google Gemini. The top-level
[README](../README.md) gives the overview, the key design decisions, the security model and
the known limitations. These pages are the developer reference.

| Page                              | Read it to                                                            |
| --------------------------------- | --------------------------------------------------------------------- |
| [Architecture](architecture.md)   | see the parts of the system, the data flow and the trust boundaries   |
| [API reference](api.md)           | call `POST /api/analyze`: request, response, errors, headers, limits  |
| [Server](server.md)               | understand `api/` and `server/`: request handling, LLM calls, limiter |
| [Frontend](frontend.md)           | understand `src/`: pipeline, state, extraction, history, components   |
| [Configuration](configuration.md) | set environment variables, build settings and npm scripts             |
| [Development](development.md)     | run, test and extend the project                                      |
| [Operations](operations.md)       | deploy, monitor and troubleshoot                                      |

Related files: [`AI_LOG.md`](../AI_LOG.md) documents how AI was used to build the project.

## Repository layout

```text
api/analyze.ts          Vercel function: wires the dependencies, exports POST and OPTIONS
server/                 API logic: request handling, prompts, LLM adapter, rate limiting
src/
  api/                  client for POST /api/analyze
  components/           React UI
  hooks/                analysis pipeline, history, timer
  lib/                  PDF extraction, validation, storage, formatting, export
  types/                shared contract (Zod schema) and limits
scripts/                local API server, pdf.js asset copy, post-deploy API check
.github/workflows/      CI and GitHub Pages deploy
docs/                   this documentation
```

`src/types/` and `src/lib/countSentences.ts` are the only parts of `src/` that the server
imports: they are the contract shared by both sides.

## Glossary

- **Insight:** the structured result of one analysis (`DocumentInsight`).
- **Part:** one piece of a long document, analyzed in its own model call.
- **Overview:** the last model call for a long document; it writes the summary and key points
  of the whole document from the analyses of the parts.
- **Session:** a conversation with the model that keeps the history, so the correction retry
  sees the original request.
- **Transient failure:** a Gemini 500, 503 or a stalled first attempt; retried once.

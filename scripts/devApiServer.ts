import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { OPTIONS, POST } from '../api/analyze.ts';

// Local stand-in for the Vercel runtime: serves the real api/analyze.ts handlers, so the UI
// can be tested end to end without a deploy. It listens on loopback only, because every
// request spends the LLM key from .env.local. Never deployed: it lives outside api/.

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const ANALYZE_PATH = '/api/analyze';

type Handler = (request: Request) => Promise<Response>;

const handlers = new Map<string, Handler>([
  ['POST', POST],
  ['OPTIONS', OPTIONS],
]);

function toWebRequest(message: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        headers.append(name, item);
      }
    }
  }

  return new Request(url, {
    method: message.method,
    headers,
    body: message.method === 'POST' ? Readable.toWeb(message) : null,
    duplex: 'half',
  });
}

async function sendWebResponse(response: Response, res: ServerResponse): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
}

async function handle(message: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(message.url ?? '/', `http://${HOST}`);
  if (url.pathname !== ANALYZE_PATH) {
    res.writeHead(404).end();
    return;
  }

  const handler = handlers.get(message.method ?? '');
  if (handler === undefined) {
    res.writeHead(405, { Allow: [...handlers.keys()].join(', ') }).end();
    return;
  }

  await sendWebResponse(await handler(toWebRequest(message, url)), res);
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);

createServer((message, res) => {
  handle(message, res).catch((error: unknown) => {
    console.error('Local API request failed:', error);
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  });
}).listen(port, HOST, () => {
  console.info(`Local API listening on http://localhost:${String(port)}${ANALYZE_PATH}`);
});

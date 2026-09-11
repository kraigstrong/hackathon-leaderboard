// Local dev server that mimics Vercel: serves public/ with clean URLs and routes
// /api/scores to the function in api/scores.js. Uses the in-memory store unless
// Upstash env vars are set.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import * as scores from './api/scores.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

process.env.ADMIN_CODE ??= 'dev';

async function handleApi(req, res, url) {
  const handler = scores[req.method];
  if (!handler) return send(res, 405, { 'content-type': 'application/json' }, '{"error":"Method not allowed"}');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });

  const response = await handler(request);
  send(res, response.status, Object.fromEntries(response.headers), Buffer.from(await response.arrayBuffer()));
}

async function handleStatic(res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (!extname(file)) file += '.html'; // cleanUrls: /admin -> admin.html
  const path = normalize(join(PUBLIC_DIR, file));
  if (!path.startsWith(PUBLIC_DIR)) return send(res, 404, {}, 'Not found');
  try {
    send(res, 200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }, await readFile(path));
  } catch {
    send(res, 404, {}, 'Not found');
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/scores') await handleApi(req, res, url);
    else await handleStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, {}, 'Internal server error');
  }
}).listen(PORT, () => {
  console.log(`Leaderboard: http://localhost:${PORT}`);
  console.log(`Admin:       http://localhost:${PORT}/admin  (code: ${process.env.ADMIN_CODE})`);
});

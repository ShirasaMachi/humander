import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { requireThat, digest } from './protocol.js';
import { safePath } from './workspace.js';

const html = readFileSync(new URL('./panel.html', import.meta.url), 'utf8');

export async function startPanel(runtime, config) {
  const tokenPath = join(config.stateDir, 'operator.token');
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  const token = readFileSync(tokenPath, 'utf8').trim();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
      if (req.method === 'GET' && url.pathname.startsWith('/releases/')) {
        const path = decodeURIComponent(url.pathname.slice('/releases/'.length));
        requireThat(/^[a-f0-9]{64}\//.test(path), 'Unknown release');
        const [releaseHash, ...parts] = path.split('/');
        const file = safePath(join(runtime.artifacts.root, releaseHash), parts.join('/'));
        res.writeHead(200, { 'Content-Type': path.endsWith('.json') ? 'application/json' : path.endsWith('.pdf') ? 'application/pdf' : 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' });
        createReadStream(file).on('error', () => res.destroy()).pipe(res); return;
      }
      const supplied = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      requireThat(Buffer.byteLength(supplied) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)), 'Operator token required');
      if (req.headers.origin) requireThat(new URL(req.headers.origin).host === req.headers.host, 'Cross-origin management request denied');
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const status = runtime.status(); if (status.project?.definitionDraft) status.definitionDraftHash = digest(status.project.definitionDraft);
        send(200, status); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/models') {
        send(200, await runtime.modelCatalog(url.searchParams.get('provider'))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/document') {
        const path = url.searchParams.get('path') ?? '';
        const publications = runtime.protocol.state?.publications ?? [];
        const allowed = publications.flatMap(p => [p.publication.path, p.publication.definitionPath, p.publication.path?.replace('paper.pdf', 'record.json'), p.publication.definitionPath?.replace('paper.pdf', 'record.json')]);
        requireThat(allowed.includes(path), 'Only published organizational documents may be downloaded');
        const file = safePath(runtime.artifacts.root, path);
        res.writeHead(200, { 'Content-Type': path.endsWith('.pdf') ? 'application/pdf' : 'application/json', 'Content-Disposition': 'attachment' });
        createReadStream(file).on('error', () => res.destroy()).pipe(res); return;
      }
      requireThat(req.method === 'POST' && url.pathname === '/api/action', 'Unknown endpoint');
      let body = ''; for await (const chunk of req) { body += chunk; requireThat(Buffer.byteLength(body) < 200000, 'Request too large'); }
      const input = JSON.parse(body);
      await runtime.humanAction(input);
      send(200, { ok: true, phase: runtime.protocol.state?.phase });
    } catch (error) { if (!res.headersSent) send(error.message.includes('token') ? 401 : 400, { error: error.message }); else res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  return { server, port: server.address().port, tokenPath, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }) };
}

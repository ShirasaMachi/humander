// Called only after the deployment gateway has authenticated its human session.
// The operator credential stays on the server; the browser uses its login cookie.
import http from 'node:http';
import { readFileSync } from 'node:fs';

export function forwardPanel(req, res, { mount, port, tokenPath, secure = true }) {
  const pathname = req.url.split('?')[0];
  if (pathname === mount) {
    res.writeHead(302, { location: mount + '/', 'Cache-Control': 'no-store' });
    res.end(); return;
  }
  const reject = (status, error) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error }));
  };
  if (!pathname.startsWith(mount + '/')) { reject(404, 'Unknown panel route'); return; }
  if (!['GET', 'POST'].includes(req.method)) { reject(405, 'Method not allowed'); return; }
  // Credential injection makes strict CSRF checks essential for mutations.
  if (req.method === 'POST' && (req.headers.origin !== `${secure ? 'https' : 'http'}://${req.headers.host}` ||
    req.headers['content-type']?.split(';')[0].trim() !== 'application/json')) {
    reject(403, 'Same-origin JSON request required'); return;
  }
  let token;
  try { token = readFileSync(tokenPath, 'utf8').trim(); }
  catch { reject(503, 'Humander is unavailable'); return; }
  const headers = { host: req.headers.host, authorization: 'Bearer ' + token };
  for (const name of ['origin', 'content-type', 'content-length']) if (req.headers[name]) headers[name] = req.headers[name];
  const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url.slice(mount.length), headers }, response => {
    const outgoing = { ...response.headers, 'x-frame-options': 'SAMEORIGIN', 'cache-control': 'no-store' };
    delete outgoing['set-cookie'];
    if (outgoing['content-security-policy']) outgoing['content-security-policy'] = outgoing['content-security-policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    if (req.method === 'GET' && pathname === mount + '/' && response.statusCode === 200) {
      let html = '';
      response.setEncoding('utf8'); response.on('data', chunk => { html += chunk; });
      response.on('end', () => {
        delete outgoing['content-length']; delete outgoing['transfer-encoding'];
        res.writeHead(200, outgoing);
        res.end(html.replace('</title>', '</title><meta name="humander-gateway" content="true">'));
      });
    } else {
      res.writeHead(response.statusCode ?? 502, outgoing); response.pipe(res);
    }
    response.on('error', () => res.destroy());
  });
  upstream.setTimeout(30000, () => upstream.destroy(new Error('Panel timeout')));
  upstream.on('error', () => { if (!res.headersSent) reject(502, 'Humander is unavailable'); else res.destroy(); });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

// This route exposes only frozen releases, never the operator API or token.
export function forwardPublicRelease(req, res, port) {
  if (req.method !== 'GET' || !/^\/releases\/[a-f0-9]{64}\//.test(req.url.split('?')[0])) {
    res.writeHead(req.method === 'GET' ? 404 : 405); res.end(); return;
  }
  const upstream = http.request({ host: '127.0.0.1', port, method: 'GET', path: req.url }, response => {
    const headers = { 'content-type': response.headers['content-type'] || 'application/octet-stream', 'cache-control': response.headers['cache-control'] || 'no-store', 'x-content-type-options': 'nosniff' };
    res.writeHead(response.statusCode ?? 502, headers);
    response.pipe(res);
  });
  upstream.setTimeout(30000, () => upstream.destroy(new Error('Release timeout')));
  upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } else res.destroy(); });
  req.on('aborted', () => upstream.destroy());
  upstream.end();
}

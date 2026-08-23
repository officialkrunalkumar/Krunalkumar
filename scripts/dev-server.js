#!/usr/bin/env node
/* ==========================================================================
   dev-server.js — a local stand-in for how Vercel serves this repository.
   --------------------------------------------------------------------------
   `npm run dev`. Static files, no dependencies, no build step — same as the
   real thing.

   It exists because a plain static server is NOT a fair preview of this site.
   vercel.json sets "cleanUrls": true and "trailingSlash": false, so in
   production /birthday serves birthday.html and /labs/timestamp serves
   labs/timestamp.html. Open the same repo through `python -m http.server` and
   every one of those is a 404, which sends you hunting for a bug that only
   exists locally. The resolution order below is the same one Vercel applies.

   It also serves /partials/header and /partials/footer without the .html,
   because include-partials.js fetches them that way.

   NOT A PRODUCTION SERVER, and not trying to be: no compression, no caching
   headers, no HTTP/2. It binds to localhost only. The one thing it does take
   seriously is path traversal — every resolved path is checked to be inside
   the repository root before it is read, because a dev server that will
   happily serve C:\Users\...\.ssh\id_rsa to anything that can reach the port
   is a real problem even on a laptop.
   ========================================================================== */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
};

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/* Vercel's resolution order for cleanUrls + trailingSlash:false. The partials
   case is last because it is this site's own convention rather than Vercel's:
   /partials/header has no extension and no index, and include-partials.js
   asks for it exactly like that. */
function resolveFile(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const base = path.join(ROOT, rel);

  const candidates = rel === ''
    ? [path.join(ROOT, 'index.html')]
    : [base, base + '.html', path.join(base, 'index.html')];

  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const pathname = url.parse(req.url).pathname || '/';
  const file = resolveFile(pathname);

  /* Traversal guard. resolveFile joins user input onto ROOT, and path.join
     collapses "..", so "/../../.ssh/id_rsa" resolves to a real path outside
     the repo. Checked after resolution, before the read — the only ordering
     that catches every route into it. */
  if (file) {
    const real = path.resolve(file);
    if (real !== ROOT && !real.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      console.log('403  ' + pathname);
      return;
    }
  }

  if (!file) {
    const notFound = path.join(ROOT, '404.html');
    const body = isFile(notFound) ? fs.readFileSync(notFound) : Buffer.from('404 Not Found');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
    console.log('404  ' + pathname);
    return;
  }

  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

  /* no-store, deliberately: the whole point of a dev server is that a reload
     shows the edit you just made. */
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
  console.log('200  ' + pathname + '  ->  ' + path.relative(ROOT, file).split(path.sep).join('/'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Serving ' + ROOT);
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  cleanUrls is emulated, so these work the way they will in production:');
  console.log('    http://localhost:' + PORT + '/birthday?name=Krunal&theme=candlelight&from=Riya');
  console.log('    http://localhost:' + PORT + '/festival?name=Diwali');
  console.log('    http://localhost:' + PORT + '/labs/wish-generator');
  console.log('');
});

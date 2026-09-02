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

   For the same reason it now READS vercel.json rather than approximating it.
   Hardcoding "the resolution order Vercel applies" was already the right
   instinct applied to one field; the rest of that file — seven security
   headers, four Content-Security-Policies, eight redirects — was simply not
   here, so a lab could violate the production CSP all afternoon locally and
   only fail once it was live. Headers, redirects, cleanUrls and trailingSlash
   are all taken from the config now, and anything in it this server cannot
   faithfully reproduce is named at startup instead of silently skipped.

   NOT A PRODUCTION SERVER, and not trying to be: no compression, no HTTP/2,
   and Cache-Control is deliberately NOT the one vercel.json asks for — a dev
   server whose whole purpose is that a reload shows the edit you just made
   cannot also honour `max-age=31536000, immutable`. That one divergence is
   printed at startup so it is a decision rather than a surprise. It binds to
   localhost only. The two things it does take seriously are path traversal —
   every resolved path is checked to be inside the repository root before it
   is read, because a dev server that will happily serve
   C:\Users\...\.ssh\id_rsa to anything that can reach the port is a real
   problem even on a laptop — and the shape of the Location it sends, which is
   forced back on-origin at redirectFor() for the same "cheap to fix, awkward
   to explain" reason.
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
  /* An ES module is served as JavaScript or it does not run: a browser refuses
     to execute `import`ed code that arrives as application/octet-stream. The
     PHP lab is nine .mjs files deep, so without this line /labs/php works in
     production and is dead locally — the single most confusing shape a dev
     server bug can take. */
  '.mjs': 'text/javascript; charset=utf-8',
  /* Yes, really. The TypeScript lab ships assets/vendor/typescript/lib/*.d.ts,
     and mime-db — which is what Vercel resolves extensions through — has owned
     .ts for MPEG transport streams since long before TypeScript existed.
     Measured rather than assumed: a HEAD of
     /assets/vendor/typescript/lib/lib.es5.d.ts on the live site comes back
     `Content-Type: video/mp2t`. Nothing in the lab reads the header, so this
     buys no behaviour — it buys the guarantee that when something eventually
     does, it breaks here first instead of only in production.

     .data and .bin (perl, pglite, the v86 BIOS blobs) get no rows on purpose:
     both measure as application/octet-stream on the live site, which is
     already exactly what the fallback below produces. A row that restates the
     default is one more thing to keep true for no gain. */
  '.ts': 'video/mp2t',

  /* The explainer videos and their narration source. Without these rows a .mp4
     falls through to application/octet-stream, and because vercel.json sets
     X-Content-Type-Options: nosniff for every path — which this server
     faithfully replays — the browser is forbidden from sniffing its way out of
     that. Firefox refuses a non-media type on <video> outright and Chrome's
     media sniffing is disabled by nosniff, so the videos play in production,
     where Vercel resolves .mp4 through mime-db, and are dead locally. That is
     exactly the local-only divergence the .mjs and .ts rows above exist to
     prevent, which is the whole argument for adding these too. */
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',

  /* Captions, and this one is not merely cosmetic: a <track> whose file comes
     back as anything but text/vtt is rejected outright, so the subtitles would
     be silently absent locally while working in production. Same trap as the
     .mp4 row above, one step further along. */
  '.vtt': 'text/vtt; charset=utf-8',
};

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/* --------------------------------------------------------------------------
   vercel.json, applied rather than paraphrased
   --------------------------------------------------------------------------
   Vercel matches `source` with path-to-regexp. Every pattern this repo uses —
   /(.*), /(birthday|festival), /assets/(js|css)/(.*), /(site.webmanifest|
   favicon.ico) — is written with plain regex groups, and on those two engines
   agree exactly, so anchoring the source as a JS RegExp is faithful, not an
   approximation. Where they would NOT agree — a :param, a bare * wildcard, an
   {optional} segment, or a `has`/`missing` condition — this refuses to guess:
   the rule is skipped and named at startup. Same stance as build.js, for the
   same reason: a confidently wrong local answer costs more than a missing one.

    The policies go out verbatim except for `upgrade-insecure-requests` when
    this plain-http server is used. A LAN IP is not treated like localhost by
    every mobile browser, so that directive upgrades the page's own CSS and JS
    to https:// where this server cannot answer. Production remains responsible
    for the original policy; local HTTP must keep its same-origin assets HTTP.
   -------------------------------------------------------------------------- */
const UNSUPPORTED = /[:{]|(^|[^.])\*/;
const notes = [];

let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
} catch (e) {
  notes.push('vercel.json could not be read (' + e.message + '), so NO headers or redirects are applied');
}

function compile(rules, kind) {
  const out = [];
  for (const rule of rules || []) {
    const src = String(rule.source || '');
    if (UNSUPPORTED.test(src) || rule.has || rule.missing) {
      notes.push(kind + ' "' + src + '" uses a matcher this server does not reproduce — not applied');
      continue;
    }
    try {
      out.push(Object.assign({ re: new RegExp('^' + src + '$') }, rule));
    } catch (e) {
      notes.push(kind + ' "' + src + '" will not compile here (' + e.message + ') — not applied');
    }
  }
  return out;
}

const REDIRECTS = compile(config.redirects, 'redirect');
const REWRITES = compile(config.rewrites, 'rewrite');
const HEADERS = compile(config.headers, 'header');
const CLEAN_URLS = config.cleanUrls === true;
const TRAILING_SLASH = config.trailingSlash === true;
notes.push('Cache-Control comes out as no-store, not the value in vercel.json — see the header of this file');

/* The FIRST matching rewrite wins and the rest are not consulted, which is how
   Vercel treats them and the opposite of the header rule below. Returns the
   destination path, or null when nothing matches — the caller then resolves
   the original pathname as usual, so a rewrite can only ever add a place to
   look and never take one away. */
function rewriteFor(pathname) {
  for (const rule of REWRITES) {
    if (rule.re.test(pathname)) return String(rule.destination || '');
  }
  return null;
}

/* Every matching rule is applied in file order and a later one overwrites an
   earlier one key by key. That ordering is load-bearing, not incidental: the
   labs get their looser connect-src precisely because /labs/(.*) sits below
   the site-wide /(.*) policy it shares a prefix with. */
function headersFor(pathname) {
  const out = {};
  for (const rule of HEADERS) {
    if (!rule.re.test(pathname)) continue;
    for (const h of rule.headers || []) out[h.key] = h.value;
  }
  return out;
}

/* Every Location this server derives FROM THE REQUEST PATH is forced back to
   a single-slash, same-origin, absolute path before it goes out.

   The cleanUrls and trailingSlash branches build their target by editing the
   requested path, and a request line may legally begin with two slashes: GET
   //evil.example/foo.html gave `Location: //evil.example/foo`, which is
   protocol-relative, so the browser left the site. That is an open redirect —
   textbook shape, and pointless to leave standing even on a localhost-bound
   dev server, because the cost of not having it is one regex. A backslash run
   is collapsed too: the URL parser folds \ into / for http(s), so /\evil is
   the same trick wearing a different slash.

   Config redirects are the deliberate exception. Their destination is written
   by hand in vercel.json, and one of them (/generate) is MEANT to leave for
   another origin; rewriting that into a local path would invent a divergence
   from production in the one file whose whole job is not having any. So an
   authored destination that is already absolute or protocol-relative goes out
   untouched, and only a path-shaped one — which is the only kind a request
   path can have flowed into, via a capture group — gets normalised. */
const AUTHORED_OFFSITE = /^(?:[a-z][a-z0-9+.\-]*:)?\/\//i;

function sameOriginPath(to) {
  const cut = to.search(/[?#]/);
  const p = cut === -1 ? to : to.slice(0, cut);
  const rest = cut === -1 ? '' : to.slice(cut);
  return '/' + p.replace(/^[/\\]+/, '') + rest;
}

/* Config redirects first, then the two the config asks for implicitly.
   cleanUrls does not merely let /about serve about.html — it also stops
   /about.html being a URL at all, and trailingSlash:false does the same to
   /about/. Both answer 308 in production, and a local 200 for a URL that
   redirects live is exactly the divergence this file exists to remove. */
function redirectFor(pathname, search) {
  for (const rule of REDIRECTS) {
    if (!rule.re.test(pathname)) continue;
    let to = pathname.replace(rule.re, rule.destination);
    if (search && to.indexOf('?') === -1) to += search;
    if (!AUTHORED_OFFSITE.test(String(rule.destination || ''))) to = sameOriginPath(to);
    return { to: to, status: rule.statusCode || (rule.permanent ? 308 : 307) };
  }

  let to = null;
  if (CLEAN_URLS && /\.html$/i.test(pathname)) {
    to = pathname.replace(/\.html$/i, '').replace(/(^|\/)index$/, '$1');
    if (to.length > 1 && to.endsWith('/')) to = to.slice(0, -1);
    if (to === '') to = '/';
  } else if (!TRAILING_SLASH && pathname.length > 1 && pathname.endsWith('/')) {
    to = pathname.slice(0, -1);
  }
  if (to && to !== pathname) return { to: sameOriginPath(to + (search || '')), status: 308 };
  return null;
}

/* Vercel's resolution order for cleanUrls + trailingSlash:false. The partials
   case is last because it is this site's own convention rather than Vercel's:
   /partials/header has no extension and no index, and include-partials.js
   asks for it exactly like that. */
function resolveFile(pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const base = path.join(ROOT, rel);

  /* REWRITES, applied here rather than as a redirect, because that is what
     Vercel does with them: the address the visitor asked for is kept and a
     different file answers it. This server used to print "vercel.json declares
     rewrites, which this server does not apply" and then 404 — which meant
     /buddha worked in production and was a dead link locally, the exact class
     of local-only divergence this file exists to prevent. */
  const rewritten = rewriteFor(pathname);
  const rbase = rewritten ? path.join(ROOT, rewritten.replace(/^\/+/, '')) : null;

  const candidates = rel === ''
    ? [path.join(ROOT, 'index.html')]
    : [base, base + '.html', path.join(base, 'index.html')];

  if (rbase) candidates.push(rbase, rbase + '.html', path.join(rbase, 'index.html'));

  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname || '/';

  /* Computed for the 404 as well as the 200: measured against the live site,
     https://krunalkumar.dpdns.org/nope-does-not-exist comes back 404 carrying
     the full set, so the security headers are not conditional on a hit. */
  const sent = headersFor(pathname);
  if (sent['Content-Security-Policy']) {
    sent['Content-Security-Policy'] = sent['Content-Security-Policy']
      .replace(/;?\s*upgrade-insecure-requests\s*;?/i, ';')
      .replace(/^\s*;|;\s*$/g, '');
  }

  /* Redirects are the exception, and it is a measured one rather than a guess:
     both /linux and /about.html answer on the live site with a Location and
     nothing else from this config — Vercel stops routing when a redirect wins,
     so the headers rules never run. Sending them here would be the same class
     of local-only difference this file exists to remove, pointed the other way. */
  const redirect = redirectFor(pathname, parsed.search);
  if (redirect) {
    res.writeHead(redirect.status, {
      Location: redirect.to,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(redirect.status + ' -> ' + redirect.to);
    console.log(redirect.status + '  ' + pathname + '  ->  ' + redirect.to);
    return;
  }

  const file = resolveFile(pathname);

  /* Traversal guard. resolveFile joins user input onto ROOT, and path.join
     collapses "..", so "/../../.ssh/id_rsa" resolves to a real path outside
     the repo. Checked after resolution, before the read — the only ordering
     that catches every route into it. */
  if (file) {
    const real = path.resolve(file);
    if (real !== ROOT && !real.startsWith(ROOT + path.sep)) {
      /* Same header shape as the 404 below, and for the same measured reason:
         production answers a refusal with the full config header set, so a
         403 that arrives here bare would be a local-only difference in the
         one file whose whole job is not having any. */
      res.writeHead(403, Object.assign({}, sent, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      }));
      res.end('403 Forbidden');
      console.log('403  ' + pathname);
      return;
    }
  }

  if (!file) {
    const notFound = path.join(ROOT, '404.html');
    const body = isFile(notFound) ? fs.readFileSync(notFound) : Buffer.from('404 Not Found');
    res.writeHead(404, Object.assign({}, sent, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    }));
    res.end(body);
    console.log('404  ' + pathname);
    return;
  }

  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';

  /* RANGE REQUESTS, because a <video> needs them.

     Without a 206 the browser cannot seek, and for a fragmented MP4 it also
     cannot learn the running time up front — the scrubber starts empty and
     grows as the file streams in, which looks broken and is the sort of thing
     you only discover locally if the dev server behaves like the real host.
     Vercel serves ranges; this now does too, so the two agree. */
  const stat = fs.statSync(file);
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && stat.size > 0) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null) {                    // "-N": the last N bytes
      start = Math.max(0, stat.size - (end || 0));
      end = stat.size - 1;
    } else if (end === null || end >= stat.size) {
      end = stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, Object.assign({}, sent, {
        'Content-Range': 'bytes */' + stat.size,
        'Cache-Control': 'no-store',
      }));
      res.end();
      console.log('416  ' + pathname + '  ' + range);
      return;
    }
    res.writeHead(206, Object.assign({}, sent, {
      'Content-Type': type,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Content-Length': (end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }));
    fs.createReadStream(file, { start, end }).pipe(res);
    console.log('206  ' + pathname + '  ' + start + '-' + end + '/' + stat.size);
    return;
  }

  /* no-store, deliberately: the whole point of a dev server is that a reload
     shows the edit you just made. It goes on last so it wins over whatever
     Cache-Control vercel.json had for this path. */
  res.writeHead(200, Object.assign({}, sent, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }));
  fs.createReadStream(file).pipe(res);
  console.log('200  ' + pathname + '  ->  ' + path.relative(ROOT, file).split(path.sep).join('/'));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Serving ' + ROOT);
  console.log('  http://localhost:' + PORT);
  console.log('');
  console.log('  From vercel.json: ' + HEADERS.length + ' header rules, ' + REDIRECTS.length +
              ' redirects, cleanUrls ' + (CLEAN_URLS ? 'on' : 'off') +
              ', trailingSlash ' + (TRAILING_SLASH ? 'on' : 'off') + '.');
  notes.forEach((n) => console.log('  NOTE  ' + n));
  console.log('');
  console.log('  cleanUrls is emulated, so these work the way they will in production:');
  console.log('    http://localhost:' + PORT + '/birthday?name=Krunal&theme=candlelight&from=Riya');
  console.log('    http://localhost:' + PORT + '/festival?name=Diwali');
  console.log('    http://localhost:' + PORT + '/labs/wish-generator');
  console.log('');
});

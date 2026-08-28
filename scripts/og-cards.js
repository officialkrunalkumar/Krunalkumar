/* ==========================================================================
   scripts/og-cards.js — renders the 1200x630 share cards.
   --------------------------------------------------------------------------
   A page with no og:image of its own posts the site's generic card, so a link
   to /privacy and a link to /glossary look identical in a chat window. This
   builds a real card per page, in the same construction the blog covers and
   lab cards already use: dark diagonal ground, one soft accent glow, a motif,
   and the title set on the left.

   THE RASTERISER IS A BROWSER, ON PURPOSE. og:image has to be a raster — no
   social platform renders SVG — and this repo has no image library and wants
   none. Chromium already ships a JPEG encoder, so the card is drawn as SVG,
   painted onto a canvas, and read back with canvas.toDataURL. Nothing is added
   to package.json, and the output is committed, which is the artefact that
   matters.

       node scripts/og-cards.js --check     list pages with no card of their own
       node scripts/og-cards.js             serve the renderer, then open the URL

   The second form prints a localhost URL. Open it in any browser; it draws
   every missing card, posts each one back, and prints DONE. The server exits
   on its own once every card is written.

   Adding a card: one entry in CARDS below. `dest` is the committed path,
   relative to the repo root.
   ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.OG_PORT) || 4399;

// ---------------------------------------------------------------------------
// Motifs. Drawn to the right of the text, inside roughly x 690-1130, y 130-480.
// ---------------------------------------------------------------------------
const MOTIFS = {
  /* ---- The arcade ----------------------------------------------------
     Seven motifs rather than sixty-seven. A bespoke drawing per game would
     be the nicer thing and is not the sustainable thing: the next game
     added would ship with a blank right-hand side and nobody would notice
     until it was posted somewhere. One per CATEGORY means a new game
     inherits a correct card the moment it joins the manifest, and the card
     still says something true about what kind of game it is — an arcade
     card does not look like a quiz card.

     Drawn to the same box as the motifs above, roughly x 690-1130,
     y 130-480. */
  gameArcade: `
  <g fill="#7dd3fc" opacity="0.9">
    <rect x="716" y="180" width="46" height="46" rx="8"/>
    <rect x="778" y="180" width="46" height="46" rx="8" opacity="0.75"/>
    <rect x="840" y="180" width="46" height="46" rx="8" opacity="0.5"/>
    <rect x="716" y="242" width="46" height="46" rx="8" opacity="0.75"/>
    <rect x="778" y="242" width="46" height="46" rx="8" opacity="0.5"/>
  </g>
  <g fill="none" stroke="#38bdf8" stroke-width="6" opacity="0.9">
    <rect x="716" y="330" width="300" height="130" rx="18"/>
    <path d="M756 372 v46 M733 395 h46" stroke-linecap="round"/>
  </g>
  <g fill="#7dd3fc"><circle cx="946" cy="382" r="16"/><circle cx="986" cy="412" r="16" opacity="0.7"/></g>`,
  gamePuzzle: `
  <g fill="none" stroke="#7dd3fc" stroke-width="5" opacity="0.85">
    <rect x="716" y="170" width="132" height="132" rx="12"/>
    <rect x="868" y="170" width="132" height="132" rx="12" opacity="0.7"/>
    <rect x="716" y="322" width="132" height="132" rx="12" opacity="0.7"/>
  </g>
  <g fill="#38bdf8" opacity="0.9">
    <rect x="884" y="338" width="100" height="100" rx="10"/>
    <text x="900" y="404" font-family="'Segoe UI',sans-serif" font-size="52" font-weight="800" fill="#0b1220">?</text>
  </g>`,
  gameTerminal: `
  <g fill="none" stroke="#7dd3fc" stroke-width="5" opacity="0.85">
    <rect x="716" y="170" width="330" height="290" rx="14"/>
  </g>
  <g font-family="'Consolas','Segoe UI',monospace" font-size="24" fill="#38bdf8">
    <text x="748" y="234">$ play</text>
    <text x="748" y="278" opacity="0.75">&gt; loading…</text>
    <text x="748" y="322" opacity="0.55">&gt; ready</text>
  </g>
  <rect x="748" y="348" width="20" height="30" fill="#7dd3fc" opacity="0.95"/>`,
  gameBoard: `
  <g opacity="0.9">
    <rect x="716" y="170" width="290" height="290" rx="12" fill="none" stroke="#7dd3fc" stroke-width="5"/>
    <g fill="#38bdf8" opacity="0.55">
      <rect x="716" y="170" width="72" height="72"/><rect x="861" y="170" width="72" height="72"/>
      <rect x="788" y="242" width="73" height="73"/><rect x="933" y="242" width="73" height="73"/>
      <rect x="716" y="315" width="72" height="72"/><rect x="861" y="315" width="72" height="72"/>
      <rect x="788" y="388" width="73" height="72"/><rect x="933" y="388" width="73" height="72"/>
    </g>
  </g>
  <circle cx="1046" cy="420" r="26" fill="#7dd3fc" opacity="0.9"/>`,
  gameCs: `
  <g font-family="'Consolas','Segoe UI',monospace" font-weight="800" fill="#7dd3fc" opacity="0.9">
    <text x="716" y="270" font-size="120">{</text>
    <text x="978" y="270" font-size="120">}</text>
  </g>
  <g fill="#38bdf8" opacity="0.85">
    <rect x="772" y="196" width="190" height="12" rx="6"/>
    <rect x="772" y="228" width="150" height="12" rx="6" opacity="0.75"/>
    <rect x="772" y="260" width="176" height="12" rx="6" opacity="0.6"/>
  </g>
  <g font-family="'Consolas','Segoe UI',monospace" font-size="26" fill="#7dd3fc" opacity="0.7">
    <text x="716" y="380">01001000</text>
    <text x="716" y="420" opacity="0.6">01101001</text>
  </g>`,
  gameToy: `
  <g fill="#7dd3fc">
    <circle cx="760" cy="220" r="18" opacity="0.9"/><circle cx="846" cy="188" r="13" opacity="0.7"/>
    <circle cx="930" cy="242" r="22" opacity="0.85"/><circle cx="1012" cy="196" r="11" opacity="0.55"/>
    <circle cx="792" cy="316" r="14" opacity="0.7"/><circle cx="884" cy="352" r="19" opacity="0.8"/>
    <circle cx="982" cy="316" r="12" opacity="0.6"/><circle cx="1046" cy="382" r="16" opacity="0.7"/>
    <circle cx="742" cy="402" r="10" opacity="0.5"/><circle cx="916" cy="438" r="12" opacity="0.55"/>
  </g>
  <g stroke="#38bdf8" stroke-width="3" opacity="0.4" fill="none">
    <path d="M760 220 L846 188 L930 242 L1012 196"/>
    <path d="M792 316 L884 352 L982 316 L1046 382"/>
  </g>`,
  gameFun: `
  <g fill="none" stroke="#7dd3fc" stroke-width="6" opacity="0.9">
    <circle cx="866" cy="300" r="130"/>
    <path d="M806 350 q60 56 120 0" stroke-linecap="round"/>
  </g>
  <g fill="#38bdf8" opacity="0.9">
    <circle cx="822" cy="262" r="15"/><circle cx="910" cy="262" r="15"/>
  </g>
  <g fill="#7dd3fc" opacity="0.6">
    <rect x="1024" y="196" width="16" height="16" rx="3" transform="rotate(20 1032 204)"/>
    <rect x="1058" y="256" width="14" height="14" rx="3" transform="rotate(-15 1065 263)"/>
    <rect x="1016" y="326" width="18" height="18" rx="4" transform="rotate(35 1025 335)"/>
  </g>`,
  glossary: `
  <g font-family="'Segoe UI',sans-serif" font-weight="800" fill="#7dd3fc" opacity="0.9">
    <text x="716" y="230" font-size="86">A</text><text x="806" y="230" font-size="62" opacity="0.7">B</text>
    <text x="876" y="230" font-size="48" opacity="0.5">C</text><text x="936" y="230" font-size="40" opacity="0.35">D</text>
  </g>
  <g fill="#38bdf8" opacity="0.85">
    <rect x="716" y="268" width="300" height="12" rx="6"/>
    <rect x="716" y="300" width="238" height="12" rx="6" opacity="0.75"/>
    <rect x="716" y="332" width="286" height="12" rx="6" opacity="0.6"/>
    <rect x="716" y="364" width="200" height="12" rx="6" opacity="0.45"/>
  </g>
  <g fill="none" stroke="#7dd3fc" stroke-width="4" opacity="0.8">
    <circle cx="1046" cy="404" r="34"/><path d="M1070 428 l32 32" stroke-linecap="round"/>
  </g>`,
  colophon: `
  <g fill="none" stroke="#7dd3fc" stroke-width="4" opacity="0.85">
    <rect x="716" y="170" width="300" height="290" rx="14"/>
  </g>
  <g font-family="'Consolas','Segoe UI',monospace" font-size="21" fill="#38bdf8">
    <text x="748" y="222">&lt;html&gt;</text>
    <text x="774" y="258">&lt;head&gt;</text>
    <text x="800" y="294">&lt;style&gt;</text>
    <text x="774" y="330">&lt;body&gt;</text>
    <text x="748" y="366">&lt;/html&gt;</text>
  </g>
  <g fill="#7dd3fc" opacity="0.8"><circle cx="1044" cy="416" r="10"/><circle cx="1078" cy="416" r="10" opacity="0.6"/></g>`,
  privacy: `
  <path d="M886 150 l150 56 v112 c0 92 -62 148 -150 178 c-88 -30 -150 -86 -150 -178 v-112z"
        fill="none" stroke="#7dd3fc" stroke-width="6"/>
  <path d="M886 190 l112 42 v84 c0 68 -46 110 -112 133 c-66 -23 -112 -65 -112 -133 v-84z"
        fill="#38bdf8" opacity="0.18"/>
  <g fill="none" stroke="#7dd3fc" stroke-width="6" stroke-linecap="round">
    <path d="M846 306 l30 30 l60 -64"/>
  </g>`,
  terms: `
  <rect x="742" y="146" width="290" height="344" rx="12" fill="none" stroke="#7dd3fc" stroke-width="5"/>
  <g fill="#38bdf8" opacity="0.85">
    <rect x="778" y="192" width="150" height="13" rx="6"/>
    <rect x="778" y="228" width="218" height="9" rx="4" opacity="0.7"/>
    <rect x="778" y="252" width="196" height="9" rx="4" opacity="0.7"/>
    <rect x="778" y="276" width="212" height="9" rx="4" opacity="0.7"/>
    <rect x="778" y="312" width="120" height="13" rx="6"/>
    <rect x="778" y="348" width="206" height="9" rx="4" opacity="0.7"/>
    <rect x="778" y="372" width="184" height="9" rx="4" opacity="0.7"/>
  </g>
  <path d="M786 424 q40 -26 80 -6 q40 20 78 -12" fill="none" stroke="#7dd3fc" stroke-width="5" stroke-linecap="round"/>`,
  refund: `
  <circle cx="886" cy="308" r="128" fill="none" stroke="#7dd3fc" stroke-width="6" opacity="0.85"/>
  <path d="M886 196 a112 112 0 1 1 -79 33" fill="none" stroke="#38bdf8" stroke-width="10" stroke-linecap="round"/>
  <path d="M792 206 l16 44 l-46 -8z" fill="#38bdf8"/>
  <text x="886" y="332" font-family="'Segoe UI',sans-serif" font-size="72" font-weight="800" fill="#7dd3fc" text-anchor="middle">&#8377;</text>`,
  verify: `
  <rect x="716" y="180" width="340" height="230" rx="14" fill="none" stroke="#7dd3fc" stroke-width="5"/>
  <g fill="#38bdf8" opacity="0.8">
    <rect x="752" y="220" width="150" height="12" rx="6"/>
    <rect x="752" y="250" width="220" height="9" rx="4" opacity="0.7"/>
    <rect x="752" y="274" width="188" height="9" rx="4" opacity="0.7"/>
  </g>
  <g transform="translate(944,300)">
    <circle r="56" fill="#0f1a28" stroke="#7dd3fc" stroke-width="6"/>
    <path d="M-24 2 l16 18 l34 -40" fill="none" stroke="#7dd3fc" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g fill="#7dd3fc" opacity="0.6">
    <rect x="752" y="330" width="14" height="14"/><rect x="774" y="330" width="14" height="14"/>
    <rect x="796" y="330" width="14" height="14"/><rect x="752" y="352" width="14" height="14"/>
    <rect x="796" y="352" width="14" height="14"/><rect x="752" y="374" width="14" height="14"/>
    <rect x="774" y="374" width="14" height="14"/><rect x="796" y="374" width="14" height="14"/>
  </g>`,
};

// ---------------------------------------------------------------------------
// The cards. `dest` is relative to the repo root and is what gets committed.
// ---------------------------------------------------------------------------
/* --------------------------------------------------------------------------
   The game cards, derived rather than typed.

   66 games and a hub is far too many entries to keep by hand, and a card list
   maintained separately from the manifest is a list that goes stale silently:
   every game page already ships <meta property="og:image"> pointing at
   og-game-<slug>.jpg, so a game missing from here does not degrade to the
   generic card — it points at a 404, and the link posts with no image at all.
   That is exactly what had happened: all 66 were referenced and none existed.

   Reading scripts/games-data.js makes the two impossible to disagree. A new
   game gets a correct card by existing.
   -------------------------------------------------------------------------- */
const CATEGORY_MOTIF = {
  arcade: 'gameArcade',
  puzzle: 'gamePuzzle',
  terminal: 'gameTerminal',
  board: 'gameBoard',
  cs: 'gameCs',
  toy: 'gameToy',
  fun: 'gameFun',
};

const CATEGORY_EYEBROW = {
  arcade: 'Arcade',
  puzzle: 'Puzzle',
  terminal: 'Terminal',
  board: 'Board game',
  cs: 'For programmers',
  toy: 'Toy',
  fun: 'Just for fun',
};

/* Titles are set at 56px in a 1200px card with the motif taking the right
   half, so a line longer than this overruns the artwork. Broken on spaces,
   never mid-word. */
function wrapTitle(title, max) {
  const words = String(title).split(/\s+/);
  const out = [];
  let line = '';
  words.forEach((w) => {
    const next = line ? line + ' ' + w : w;
    if (next.length > max && line) { out.push(line); line = w; }
    else { line = next; }
  });
  if (line) out.push(line);
  return out.slice(0, 2);          // two lines is all the card has room for
}

function gameCards() {
  let GAMES = [];
  try {
    GAMES = require(path.join(ROOT, 'scripts/games-data.js')).GAMES || [];
  } catch (err) {
    return [];                     // no manifest, no game cards; the six above still work
  }

  const cards = GAMES.map((g) => ({
    id: 'game-' + g.slug,
    /* `cat`, not `category`. Guessing the latter silently handed every one
       of the sixty-six the arcade motif, because an undefined key falls
       through the lookup to the default and nothing complains. */
    motif: CATEGORY_MOTIF[g.cat] || 'gameArcade',
    dest: 'assets/images/og-game-' + g.slug + '.jpg',
    eyebrow: CATEGORY_EYEBROW[g.cat] || 'Game',
    /* `name` is "Snake". `title` is the whole page title, ending in
       "| Krunalkumar Shah", which is right for a <title> and absurd set at
       56px across a share card. */
    lines: wrapTitle(g.name || g.slug, 22),
    /* The card carries the tagline, not the meta description: the
       description is written for search results and runs to two sentences,
       which at 25px is a wall. */
    sub: String(g.short || 'Free in your browser, no ads, no sign-up')
      .replace(/\s+/g, ' ')
      .slice(0, 76),
  }));

  cards.push({
    id: 'games-hub',
    motif: 'gameArcade',
    dest: 'assets/images/og-games.jpg',
    eyebrow: 'Games',
    lines: ['Sixty-six games,', 'nothing to install'],
    sub: 'No ads, no sign-up, and they keep working offline',
  });

  return cards;
}

const CARDS = [
  { id: 'glossary', dest: 'assets/images/og-glossary.jpg', eyebrow: 'Glossary',
    lines: ['Security, systems', 'and code terms'], sub: 'Every word, linked to the lab that shows it' },
  { id: 'colophon', dest: 'assets/images/og-colophon.jpg', eyebrow: 'Colophon',
    lines: ['How this site', 'is built'], sub: 'Hand-written HTML · zero dependencies' },
  { id: 'privacy',  dest: 'assets/images/og-privacy.jpg',  eyebrow: 'Privacy',
    lines: ['Privacy policy'], sub: 'What is collected, and what never leaves your device' },
  { id: 'terms',    dest: 'assets/images/og-terms.jpg',    eyebrow: 'Terms',
    lines: ['Terms of service'], sub: 'Engagement ground rules, plainly stated' },
  { id: 'refund',   dest: 'assets/images/og-refund.jpg',   eyebrow: 'Refunds',
    lines: ['Refund policy'], sub: 'The mentorship guarantee, in writing' },
  { id: 'verify',   dest: 'assets/images/og-verify.jpg',   eyebrow: 'Verify',
    lines: ['Certificate', 'verification'], sub: 'Check any certificate ID issued here' },

  /* Every game and the arcade hub, derived from the manifest by gameCards()
     below rather than listed by hand. A function declaration is hoisted, so
     it is callable from this initialiser. */
].concat(gameCards());


/* HTML entities decoded BEFORE escaping. The manifest is written for HTML
   and uses &mdash;, &middot; and friends; an SVG is XML, which defines only
   amp, lt, gt, quot and apos, so anything else makes the document
   unparseable. Chromium then fails the image load silently and the card is
   simply skipped — which is how four games came out with no card at all
   while the run reported success. */
const ENTITIES = {
  mdash: '—', ndash: '–', middot: '·', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  nbsp: ' ', times: '×', amp: '&', lt: '<', gt: '>', quot: '"',
};
const deEntity = (s) =>
  String(s)
    .replace(/&#(d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/&([a-z]+);/gi, (m, k) => (k.toLowerCase() in ENTITIES ? ENTITIES[k.toLowerCase()] : m));

const esc = (s) =>
  deEntity(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg(card) {
  const lines = card.lines;
  // Width/height are set here, not just a viewBox: an SVG with only a viewBox
  // has no intrinsic size and Chromium rasterises it at a default 300x150
  // before scaling, which comes out soft.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(card.eyebrow + ' — ' + lines.join(' '))}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#121b2c"/>
      <stop offset="1" stop-color="#1f2c3f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.4" r="0.6">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>${MOTIFS[card.motif || card.id] || ''}
  <g font-family="'Segoe UI', Tahoma, sans-serif">
    <text x="80" y="200" fill="#7dd3fc" font-size="26" font-weight="800" letter-spacing="8">${esc(card.eyebrow.toUpperCase())}</text>
${lines.map((l, i) => `    <text x="80" y="${280 + i * 66}" fill="#f8fafc" font-size="56" font-weight="800">${esc(l)}</text>`).join('\n')}
    <text x="80" y="${280 + lines.length * 66 + 14}" fill="#e2e8f0" font-size="25" font-weight="600">${esc(card.sub)}</text>
    <text x="80" y="545" fill="#94a3b8" font-size="24" font-weight="700">krunalkumar.dpdns.org</text>
  </g>
</svg>
`;
}

const missing = () => CARDS.filter((c) => !fs.existsSync(path.join(ROOT, c.dest)));

function main() {
  if (process.argv.includes('--check')) {
    const m = missing();
    console.log('og cards');
    console.log('  ' + CARDS.length + ' defined, ' + (CARDS.length - m.length) + ' present, ' + m.length + ' missing');
    m.forEach((c) => console.log('    missing  ' + c.dest));
    process.exit(m.length ? 1 : 0);
  }

  const todo = process.argv.includes('--force') ? CARDS : missing();
  if (!todo.length) { console.log('og cards: all present, nothing to render'); return; }

  const page = `<!doctype html><meta charset="utf-8"><title>og cards</title>
<body style="background:#111;color:#eee;font:14px system-ui;padding:16px">
<div id="log">rendering ${todo.length} card(s)…</div>
<script>
const TODO = ${JSON.stringify(todo.map((c) => c.id))};
const log = (m) => { document.getElementById('log').innerHTML += '<br>' + m; };
function draw(id) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 630;
      const ctx = c.getContext('2d');
      // JPEG has no alpha, so flatten onto an opaque ground first or any
      // transparent pixel comes out black.
      ctx.fillStyle = '#121b2c';
      ctx.fillRect(0, 0, 1200, 630);
      ctx.drawImage(img, 0, 0, 1200, 630);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('svg load failed: ' + id));
    img.src = '/svg/' + id;
  });
}
(async () => {
  try { await document.fonts.ready; } catch (e) {}
  for (const id of TODO) {
    try {
      const dataUrl = await draw(id);
      const r = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, dataUrl }) });
      const j = await r.json();
      log(j.ok ? (id + ' → ' + j.bytes + ' bytes') : (id + ' FAILED: ' + j.error));
    } catch (e) { log(id + ' FAILED: ' + e.message); }
  }
  log('<b>DONE</b>');
  fetch('/done');
})();
</script>`;

  let written = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page);
    }
    if (req.url.startsWith('/svg/')) {
      const card = CARDS.find((c) => c.id === req.url.slice(5));
      if (!card) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
      return res.end(svg(card));
    }
    if (req.url === '/save' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { id, dataUrl } = JSON.parse(body);
          const card = CARDS.find((c) => c.id === id);
          if (!card) throw new Error('unknown card ' + id);
          const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
          if (buf.slice(0, 3).toString('hex') !== 'ffd8ff') throw new Error('not a JPEG');
          fs.writeFileSync(path.join(ROOT, card.dest), buf);
          written++;
          console.log('  wrote ' + card.dest + '  (' + buf.length + ' bytes)');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, bytes: buf.length }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    if (req.url === '/done') {
      res.writeHead(200); res.end('ok');
      console.log(written + ' card(s) written — stopping.');
      setTimeout(() => server.close(() => process.exit(0)), 150);
      return;
    }
    res.writeHead(404); res.end();
  });

  server.listen(PORT, () => {
    console.log('og cards: rendering ' + todo.length + ' card(s)');
    console.log('  open  http://localhost:' + PORT + '/   (the server stops itself when done)');
  });
}

main();

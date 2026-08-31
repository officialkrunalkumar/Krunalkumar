#!/usr/bin/env node
/* ==========================================================================
   scripts/games.js — writes games/index.html and every games/<slug>.html
   from the manifest in games-data.js.
   --------------------------------------------------------------------------
       node scripts/games.js            regenerate every page
       node scripts/games.js --check    report what would change, write nothing
       node scripts/games.js <slug>     regenerate one page

   WHY THIS IS GENERATED WHEN THE REST OF THE SITE IS HAND-WRITTEN
   ---------------------------------------------------------------
   Every other page here is typed by hand and served exactly as committed,
   and that is worth keeping. But a game page is ~90% chrome: the head, the
   two structured-data blocks, the static header, the whole footer, the
   consent-free shell markup, the pad, the report strip. Across thirty-odd
   games that is thirty identical copies of four hundred lines, and
   build.js's own static-chrome gate exists precisely because copies like
   that drift — its comment says so: "a link added to the partial but not to
   97 static copies is invisible exactly to the people browsing without
   JavaScript".

   So this reads partials/header.html and partials/footer.html and stamps
   the real thing into every page. Chrome parity stops being a property the
   build checks after the fact and becomes one the pages cannot lose. The
   OUTPUT is still ordinary committed HTML — no runtime templating, nothing
   resolved at request time, and a game page opened from the repository is
   the page a visitor gets. Same arrangement glossary.js already has with
   glossary-terms.js.

   The prose is not generated. Every heading, fact, FAQ answer and info card
   in a game page is hand-written in games-data.js; this file only decides
   where it goes.
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'games');
const ORIGIN = 'https://krunalkumar.dpdns.org';

const { GAMES, CATEGORIES, HUB } = require('./games-data.js');

const CHECK = process.argv.includes('--check');
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0] || null;

/* --------------------------------------------------------------------------
   Escaping
   --------------------------------------------------------------------------
   Two different jobs, and mixing them up is how the C++ lab once rendered
   "so  and lambdas work" — see the README's "Escape < in prose" rule.

   esc()  is for HTML text and attributes.
   jstr() is for JSON-LD, whose <script> content is NOT HTML-parsed; escaping
          there would put a literal &lt; into the structured data.
   -------------------------------------------------------------------------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Prose written with HTML entities (&mdash;, &rsquo;) stays as typed; this
   only fixes the raw characters that would break the parse. */
function prose(s) {
  return String(s == null ? '' : s).replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;');
}

function jstr(s) {
  return JSON.stringify(String(s == null ? '' : s));
}

/* Entities have no meaning inside JSON-LD or a meta description, so the few
   the manifest uses are resolved back to real characters first. */
function plain(s) {
  return String(s == null ? '' : s)
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&times;/g, '×')
    .replace(/&rarr;/g, '→').replace(/&sup2;/g, '²');
}

/* --------------------------------------------------------------------------
   The static chrome, lifted out of partials/
   --------------------------------------------------------------------------
   build.js compares the ordered href list of .nav-link anchors and the three
   footer link regions against the partials. Taking them FROM the partials is
   the only way that comparison can never fail.

   The static header legitimately differs from the partial in two ways, both
   of which the gate already tolerates because it compares hrefs and not
   markup: the hamburger button and the More dropdown are dropped, since both
   are JavaScript-only and are dead weight in the copy that exists for people
   without it.
   -------------------------------------------------------------------------- */
function readPartial(rel) {
  return fs.readFileSync(path.join(ROOT, 'partials', rel), 'utf8')
    .replace(/^<!--[\s\S]*?-->\s*/, '');
}

function staticHeader() {
  const src = readPartial('header.html');

  /* The Games link is pre-marked active, the way blog pages and the root
     pages already mark their own. The gate compares href lists, not markup
     ("the active-link class differs per page by design" — build.js), and
     without this a no-JS visitor — the person the static header exists
     for — got a header with no current-page mark at all. */
  const links = Array.from(src.matchAll(/<a class="nav-link" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g))
    .map((m) => m[1] === '/games'
      ? `            <a class="nav-link active" aria-current="page" href="${m[1]}">${m[2].trim()}</a>`
      : `            <a class="nav-link" href="${m[1]}">${m[2].trim()}</a>`)
    .join('\n');
  if (!links) throw new Error('games.js: no nav links found in partials/header.html');

  const tools = src.match(/<div class="nav-tools">[\s\S]*?<\/div>\s*<\/nav>/);
  if (!tools) throw new Error('games.js: no nav-tools block found in partials/header.html');
  const toolsBlock = tools[0].replace(/\s*<\/nav>$/, '');

  const brand = src.match(/<a class="brand" href="([^"]*)">([\s\S]*?)<\/a>/);
  if (!brand) throw new Error('games.js: no brand link found in partials/header.html');

  return `          <header class="site-header noscript-header">
        <nav class="nav" aria-label="Main">
          <a class="brand" href="${brand[1]}">${brand[2].trim()}</a>
          <div class="nav-list">
${links}
          </div>
          ${toolsBlock.trim()}
        </nav>
      </header>`;
}

function staticFooter() {
  const src = readPartial('footer.html');
  const m = src.match(/<footer[\s\S]*<\/footer>/);
  if (!m) throw new Error('games.js: no <footer> found in partials/footer.html');
  return m[0];
}

/* --------------------------------------------------------------------------
   Head
   -------------------------------------------------------------------------- */
function head(page) {
  const url = ORIGIN + page.url;
  const img = ORIGIN + (page.ogImage || '/assets/images/og-games.jpg');
  const desc = plain(page.description);
  const ogTitle = plain(page.ogTitle || page.title);

  const styles = ['/assets/css/main.css', '/assets/css/games.css']
    .concat(page.styles || [])
    .map((href) => `    <link rel="stylesheet" href="${href}" />`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${esc(desc)}" />
    <meta name="author" content="Krunalkumar Shah" />
    <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1" />
    <meta name="theme-color" content="#121b2c" />
    <link rel="canonical" href="${url}" />
    <link rel="sitemap" type="application/xml" title="Sitemap" href="${ORIGIN}/sitemap.xml" />
    <meta property="og:title" content="${esc(ogTitle)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(plain(page.h1))}" />
    <meta property="og:site_name" content="Krunalkumar Shah" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(ogTitle)}" />
    <meta name="twitter:description" content="${esc(desc)}" />
    <meta name="twitter:image" content="${img}" />
    <title>${esc(plain(page.title))}</title>
${page.jsonld.map(indentJson).join('\n')}
    <script src="/assets/js/boot.js"></script>
${styles}
    <link rel="preload" href="/partials/header" as="fetch" crossorigin />
    <link rel="preload" href="/partials/footer" as="fetch" crossorigin />
    <script defer src="/assets/js/include-partials.js"></script>
    <script defer src="/assets/js/site-search.js"></script>
    <script defer src="/assets/js/theme.js"></script>
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
  </head>`;
}

/* JSON-LD is emitted with tab indentation to match every hand-written block
   already in the repository, so a diff between a generated page and a lab
   page shows a difference in content and not in whitespace. */
function indentJson(obj) {
  return '    <script type="application/ld+json">\n' +
         JSON.stringify(obj, null, '\t').replace(/\t/g, '        ').replace(/^ {8}/gm, (m) => m) +
         '\n    </script>';
}

/* --------------------------------------------------------------------------
   Structured data
   -------------------------------------------------------------------------- */
function gameJsonLd(g) {
  const url = ORIGIN + '/games/' + g.slug;
  const blocks = [];

  /* Embedded, not referenced. These pages used to say author/publisher =
     {"@id": ".../#person"} with no Person node anywhere on the page — the
     node lives on the homepage, and Google parses each page on its own, so
     the reference resolved to nothing. A small Person carried in full costs
     a hundred bytes and always resolves. */
  const PERSON = {
    '@type': 'Person',
    '@id': ORIGIN + '/#person',
    name: 'Krunalkumar Shah',
    url: ORIGIN + '/',
  };

  blocks.push({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    /* jsonldName lets the trademark-encumbered classics present as what
       they are in structured data — "Tetris (fan remake)" — without
       renaming the page. Claiming authorship of a VideoGame named plainly
       "Tetris" is a claim about the wrong work: the implementation here is
       original, the title is somebody's registered mark. */
    name: plain(g.jsonldName || g.name),
    url: url,
    /* Genuinely a browser game: no download, no install, no account. */
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any modern web browser',
    description: plain(g.description),
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    /* players is the seat count from the manifest; soloAI marks the games
       that can also be played alone against the computer, which schema.org
       expresses as both modes at once. No field means what it always
       meant: a single-player game. */
    playMode: g.players >= 2
      ? (g.soloAI ? ['SinglePlayer', 'MultiPlayer'] : 'MultiPlayer')
      : 'SinglePlayer',
    author: PERSON,
    publisher: { '@id': ORIGIN + '/#person' },
  });

  if (g.faq && g.faq.length) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: g.faq.map((f) => ({
        '@type': 'Question',
        name: plain(f.q),
        acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
      })),
    });
  }

  blocks.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
      { '@type': 'ListItem', position: 2, name: 'Games', item: ORIGIN + '/games' },
      { '@type': 'ListItem', position: 3, name: plain(g.name), item: url },
    ],
  });

  return blocks;
}

/* --------------------------------------------------------------------------
   The playfield: HUD, stage, overlay, pad, key legend
   --------------------------------------------------------------------------
   All of it is real markup rather than JS-built DOM, for the reason
   games.css states about the pad: a control that appears after hydration
   makes the page jump under the visitor's thumb.
   -------------------------------------------------------------------------- */
function hud(g) {
  const stats = (g.hud || [{ key: 'score', label: 'Score' }, { key: 'best', label: 'Best', accent: true }])
    .map((s) => `            <div class="game-stat">
              <span class="game-stat-label">${esc(s.label)}</span>
              <span class="game-stat-value${s.accent ? ' is-accent' : ''}" data-stat="${esc(s.key)}">${esc(s.init == null ? '0' : s.init)}</span>
            </div>`)
    .join('\n');

  const extras = (g.controls || [])
    .map((c) => '            ' + c.trim())
    .join('\n');

  /* TWO ROWS, NOT ONE.
     This used to be a single flex row holding the score, the best, the
     level, a difficulty select, a toggle or two and four chrome buttons.
     On a laptop it wrapped into a ragged two-and-a-bit lines; on a phone it
     wrapped into five, and the score — the one thing a player looks at
     mid-game — ended up wherever there happened to be room. Numbers and
     controls are different kinds of thing and now sit in different rows:
     the stats read left to right at a glance, the controls line up
     underneath and can wrap without ever pushing the score around. */
  return `        <div class="game-bar">
          <div class="game-stats">
${stats}
          </div>
          <div class="game-toolbar">
${extras ? extras + '\n' : ''}            <span class="spacer"></span>
            <button class="game-btn" type="button" id="game-pause">Pause</button>
            <button class="game-btn" type="button" id="game-restart">Restart</button>
            <button class="game-btn game-btn-icon game-sound" type="button" id="game-sound" aria-pressed="false" title="Sound is off &mdash; click to turn it on" aria-label="Toggle sound">
            <svg class="game-sound-on" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 17.5a2.5 2.5 0 1 1-2-2.45V6.2l10-2v7.3a2.5 2.5 0 1 1-2-2.45V6.65L9 8.05v9.45z" fill="currentColor"/>
            </svg>
            <svg class="game-sound-off" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 17.5a2.5 2.5 0 1 1-2-2.45V6.2l10-2v7.3a2.5 2.5 0 1 1-2-2.45V6.65L9 8.05v9.45z" fill="currentColor" opacity=".45"/>
              <path d="M4 20L20 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>
            </svg>
          </button>
            <button class="game-btn game-btn-icon" type="button" id="game-fullscreen" title="Fullscreen (Esc to exit)" aria-label="Fullscreen (Esc to exit)">&#9974;</button>
          </div>
        </div>`;
}

const PADS = {
  dpad: `          <div class="game-dpad">
            <button type="button" class="pad-up" data-key="up" aria-label="Up">&#9650;</button>
            <button type="button" class="pad-left" data-key="left" aria-label="Left">&#9664;</button>
            <button type="button" class="pad-right" data-key="right" aria-label="Right">&#9654;</button>
            <button type="button" class="pad-down" data-key="down" aria-label="Down">&#9660;</button>
          </div>
          <div class="game-pad-actions">
            <button type="button" data-key="action" aria-label="Action">Action</button>
          </div>`,
  lr: `          <div class="game-dpad">
            <button type="button" class="pad-left" data-key="left" aria-label="Left">&#9664;</button>
            <button type="button" class="pad-right" data-key="right" aria-label="Right">&#9654;</button>
          </div>
          <div class="game-pad-actions">
            <button type="button" data-key="action" aria-label="Action">Action</button>
          </div>`,
  rotate: `          <div class="game-dpad">
            <button type="button" class="pad-up" data-key="up" aria-label="Rotate">&#8635;</button>
            <button type="button" class="pad-left" data-key="left" aria-label="Left">&#9664;</button>
            <button type="button" class="pad-right" data-key="right" aria-label="Right">&#9654;</button>
            <button type="button" class="pad-down" data-key="down" aria-label="Drop">&#9660;</button>
          </div>
          <div class="game-pad-actions">
            <button type="button" data-key="action" aria-label="Hard drop">Drop</button>
          </div>`,
  action: `          <div class="game-pad-actions">
            <button type="button" data-key="action" aria-label="Action">Action</button>
          </div>`,
  /* Two distinct verbs, so a phone player is not asked to guess which of
     them one button means. Jump is placed first and larger because it is the
     one that keeps you alive. */
  /* Left, right and a jump. The platformer used 'jumpfire' — a pad built for
     moon buggy, which auto-scrolls and so needs no left or right. The
     platformer reads held.left and held.right for all its movement and binds
     no swipe of its own, so on a phone there was no input in existence that
     could move the runner sideways: it hopped on the spot at the spawn point
     while the coins, the enemies and the flag stayed permanently out of
     reach. The page copy promised "left, right, and two jump buttons" the
     whole time.

     Both action buttons say Jump because the platformer treats 'up' and
     'action' as the same jump and has no fire at all — the old pad's second
     button was labelled Fire and did nothing of the kind. */
  runjump: `          <div class="game-dpad">
            <button type="button" class="pad-left" data-key="left" aria-label="Left">&#9664;</button>
            <button type="button" class="pad-right" data-key="right" aria-label="Right">&#9654;</button>
          </div>
          <div class="game-pad-actions game-pad-two">
            <button type="button" class="pad-primary" data-key="up" aria-label="Jump">Jump</button>
            <button type="button" data-key="action" aria-label="Jump">Jump</button>
          </div>`,
  jumpfire: `          <div class="game-pad-actions game-pad-two">
            <button type="button" class="pad-primary" data-key="up" aria-label="Jump">Jump</button>
            <button type="button" data-key="action" aria-label="Fire">Fire</button>
          </div>`,
};

function pad(g) {
  const kind = g.pad || 'dpad';
  if (kind === 'none') return '        <div class="game-pad" data-pad="none"></div>';
  return `        <div class="game-pad">
${PADS[kind] || PADS.dpad}
        </div>`;
}

function keys(g) {
  let out = '';

  if (g.keys && g.keys.length) {
    const items = g.keys
      .map((k) => `          <li>${k.k.split(' ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')} ${prose(k.d)}</li>`)
      .join('\n');
    out += `        <ul class="game-keys">
${items}
        </ul>\n`;
  }

  /* The touch counterpart. games.css hides .game-keys on a coarse pointer,
     which used to leave a phone player with a D-pad and no explanation of
     what the gestures were — the keyboard legend is a list of keys they do
     not have. This says the same thing in the vocabulary they do have, and
     is hidden in turn on anything with a mouse. */
  if (g.touch) {
    out += `        <p class="game-touch">${prose(g.touch)}</p>\n`;
  }

  return out;
}

/* The reset strip. Every game gets one, including the handful that keep no
   best score — those still keep a difficulty or a saved board, and the
   visitor has no way to know which is which without being told. The strip
   says what is held and removes exactly that, rather than sending anybody to
   the browser's own "clear all site data", which is not a control so much as
   a threat. game-shell.js fills in the readout and wires the button. */
function dataStrip(g) {
  return `        <div class="game-data">
          <p class="game-data-line">
            Kept on this device: <strong data-best-readout>nothing yet</strong>
            <span class="game-data-note" data-reset-note></span>
          </p>
          <button class="game-btn game-btn-quiet" type="button" id="game-reset-best">Reset this game&rsquo;s data</button>
        </div>`;
}

function stage(g) {
  /* A DOM-board game (Minesweeper, 2048, Wordle) gets a .game-board it can
     fill; a canvas game gets a canvas. Never both: the shell picks up
     whichever is present. */
  /* The canvas carries fallback text: a browser that renders the page but
     not the canvas (and a screen reader before game-shell.js has stamped
     role and label on it) should meet a sentence, not a void. The no-JS
     case is the <noscript> block's job; this is for everything between. */
  const surface = g.board
    ? `          <div class="game-board" id="game-board"></div>`
    : `          <canvas class="game-canvas${g.pixel ? ' is-pixel' : ''}" id="game-canvas">The ${esc(plain(g.name))} playfield. The game draws here once it starts.</canvas>`;

  /* The two stage kinds want opposite height rules and cannot share one.
     A canvas stage needs a height CSS decides, so game-shell.js has a
     container to measure and fit the canvas into. A board stage (2048,
     the typing trainer) has to grow with its own content instead, because
     a paragraph of text has a height of its own. A modifier class rather
     than :has(), which is newer than the browsers this site still serves. */
  const kind = g.board ? 'game-stage--board' : 'game-stage--canvas';

  return `        <div class="game-stage ${kind}">
${surface}
          <div class="game-overlay" id="game-overlay">
            <div class="game-overlay-card">
              <span class="game-overlay-best" data-overlay="best" hidden>New best</span>
              <h2 data-overlay="title">Ready?</h2>
              <p class="game-overlay-score" data-overlay="score" hidden>0</p>
              <p data-overlay="text"></p>
              <div class="game-overlay-actions">
                <button class="btn btn-primary" type="button" id="game-start">Play</button>
                <button class="btn btn-primary" type="button" id="game-again" hidden>Play again</button>
                <!-- Pausing needs its own button. It used to show "Play again", which
                     offered a RESTART as the obvious action in the middle of a run and
                     took keyboard focus, so Escape-then-Space threw the game away. The
                     first fix removed every button from the pause overlay, which fixed
                     the trap and left a mouse user with an overlay telling them to press
                     a key. This is the actual answer: the safe action, as a button. -->
                <button class="btn btn-primary" type="button" id="game-resume" hidden>Resume</button>
              </div>
            </div>
          </div>
        </div>`;
}

/* --------------------------------------------------------------------------
   Page body sections
   -------------------------------------------------------------------------- */
function facts(list) {
  if (!list || !list.length) return '';
  return `        <ul class="game-facts">
${list.map((f) => `          <li>${prose(f)}</li>`).join('\n')}
        </ul>\n`;
}

function infoCards(g) {
  if (!g.info || !g.info.length) return '';
  return `
      <section class="section-card">
        <div class="section-heading">
          <h2>${prose(g.infoHeading || 'How it works')}</h2>
        </div>
        <div class="content-grid two-up">
${g.info.map((c) => `          <article class="info-card">
            <h3>${prose(c.h)}</h3>
            <p>${prose(c.p)}</p>
          </article>`).join('\n')}
        </div>
      </section>
`;
}

function faqSection(g) {
  if (!g.faq || !g.faq.length) return '';
  return `
      <section class="section-card">
        <div class="section-heading">
          <h2>Questions people ask</h2>
        </div>
${g.faq.map((f) => `          <details class="lab-faq">
            <summary>${prose(f.q)}</summary>
            <div>${prose(f.a)}</div>
          </details>`).join('\n')}
      </section>
`;
}

function relatedSection(g) {
  const rel = (g.related || []).map((slug) => GAMES.find((x) => x.slug === slug)).filter(Boolean);
  if (!rel.length) return '';
  return `
      <section class="section-card">
        <div class="section-heading">
          <h2>More in the arcade</h2>
        </div>
        <div class="game-grid">
${rel.map((r) => card(r, true)).join('\n')}
        </div>
      </section>
`;
}

function reportSection(g) {
  const wa = encodeURIComponent('Hi Krunalkumar, about ' + plain(g.name) + ': ');
  return `
      <section class="section-card lab-report">
        <div class="section-heading">
          <p class="eyebrow">Something not working?</p>
          <h2>Tell me and I will fix it</h2>
          <p>If a control does nothing or it will not start, I would like to know your browser.</p>
        </div>
        <div class="lab-report-actions">
          <a class="btn btn-primary" href="/labs?from=${esc(g.slug)}&amp;area=games#lab-feedback">Report a problem or send feedback</a>
          <a class="game-btn" href="https://wa.me/918200713617?text=${wa}" target="_blank" rel="noopener">Message on WhatsApp</a>
        </div>
      </section>
`;
}

/* A card, used on the hub and in the "more in the arcade" strip. The canvas
   is NOT emitted here — hub.js inserts it — so a no-JS visitor gets the
   glyph tile, which is a complete card rather than an empty frame. */
function card(g, compact) {
  const tag = g.tag ? `\n          <span class="game-tag">${esc(g.tag)}</span>` : '';
  const meta = compact ? 'Runs in your browser' : (g.engine || 'Runs in your browser');
  return `          <a class="game-card" data-cat="${esc(g.cat)}" data-slug="${esc(g.slug)}" href="/games/${esc(g.slug)}">${tag}
            <span class="game-thumb" data-thumb="${esc(g.thumb || g.slug)}">
              <span class="game-thumb-glyph" aria-hidden="true">${esc(g.glyph || '?')}</span>
            </span>
            <span class="game-card-body">
              <h3 class="game-card-name">${prose(g.name)}</h3>
              <p class="game-card-desc">${prose(compact ? (g.short || g.description) : g.description)}</p>
              <span class="game-card-meta">${prose(meta)}<span class="game-card-best" data-best="${esc(g.slug)}"></span></span>
            </span>
          </a>`;
}

/* --------------------------------------------------------------------------
   A whole game page
   -------------------------------------------------------------------------- */
function gamePage(g, chrome) {
  /* game-storage.js first: game-shell.js reads window.GameStorage at
     definition time and throws without it.

     term-shell.js sits between game-shell.js and the terminal games, so it
     loads only for those — a canvas game has no use for a character grid and
     should not pay for one. Order matters: all three are `defer`, which
     guarantees execution in document order, so TermShell exists by the time
     a terminal game's own module runs. */
  const scripts = ['/assets/js/games/game-storage.js', '/assets/js/games/game-shell.js']
    .concat(g.term ? ['/assets/js/games/term-shell.js'] : [])
    .concat(g.quiz ? ['/assets/js/games/fun/quiz-kit.js'] : [])
    .concat(['/assets/js/games/' + g.script])
    .map((s) => `    <script defer src="${s}"></script>`)
    .join('\n');

  return `${head({
    url: '/games/' + g.slug,
    title: g.title,
    ogTitle: g.ogTitle,
    description: g.description,
    h1: g.h1 || g.name,
    ogImage: '/assets/images/og-game-' + g.slug + '.jpg',
    styles: g.styles,
    jsonld: gameJsonLd(g),
  })}
  <body id="top">
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <canvas id="bg-canvas" aria-hidden="true"></canvas>
${chrome.header}

    <main id="main-content" class="page-shell">
      <section class="page-hero">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href="/">Home</a></li>
            <li><a href="/games">Games</a></li>
            <li aria-current="page">${prose(g.name)}</li>
          </ol>
        </nav>
        <h1>${prose(g.h1 || g.name)}</h1>
        <p class="hero-text">${prose(g.hero)}</p>
${facts(g.facts)}      </section>

      <!-- A game cannot degrade to anything: there is no static version of
           Snake. boot.js adds html.js synchronously, so games.css hides the
           inert shell and this takes its place, rather than leaving a dead
           canvas and a Play button that does nothing. -->
      <noscript>
        <div class="game-noscript">
          <h2>This one needs JavaScript</h2>
          <p>${prose(g.noscript || 'This is a game. It is drawn and played in your browser, and there is no version of it that works without JavaScript.')}</p>
          <p>Turn JavaScript on for this site and reload, and it will work.
            In the meantime the <a href="/blog">writing</a> and the rest of the
            <a href="/">site</a> read perfectly well without it.</p>
        </div>
      </noscript>

      <div class="game" id="game-${esc(g.slug)}"${g.wide ? ' data-wide="1"' : ''}>
${hud(g)}
${stage(g)}
${g.wide ? `        <p class="game-rotate">This one is ${g.cols || 80} columns wide — turn your phone sideways and it gets a great deal easier to read.</p>\n` : ''}${g.extra ? '        ' + g.extra.trim() + '\n' : ''}${keys(g)}${pad(g)}
${dataStrip(g)}
      </div>
${infoCards(g)}${faqSection(g)}${reportSection(g)}${relatedSection(g)}    </main>

${chrome.footer}

    <script src="/assets/js/particle-bg.js" defer></script>
${scripts}
  </body>
</html>
`;
}

/* --------------------------------------------------------------------------
   The hub
   -------------------------------------------------------------------------- */
function hubPage(chrome) {
  const sections = CATEGORIES.map((cat) => {
    const list = GAMES.filter((g) => g.cat === cat.key);
    if (!list.length) return '';
    return `
      <section class="section-card" id="${esc(cat.key)}-games">
        <div class="section-heading">
          <p class="eyebrow">${prose(cat.eyebrow)}</p>
          <h2>${prose(cat.title)}</h2>
          <p>${prose(cat.blurb)}</p>
        </div>
        <div class="game-grid">
${list.map((g) => card(g)).join('\n')}
        </div>
      </section>
`;
  }).join('');

  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Browser games by Krunalkumar Shah',
      description: 'Games that run entirely in your own browser — no account, no server, nothing uploaded.',
      itemListElement: GAMES.map((g, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: plain(g.name),
        url: ORIGIN + '/games/' + g.slug,
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: HUB.faq.map((f) => ({
        '@type': 'Question',
        name: plain(f.q),
        acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
        { '@type': 'ListItem', position: 2, name: 'Games', item: ORIGIN + '/games' },
      ],
    },
  ];

  const chips = CATEGORIES.map((c) =>
    `          <li><button type="button" data-cat="${esc(c.key)}" aria-pressed="false">${prose(c.chip)}</button></li>`
  ).join('\n');

  return `${head({
    url: '/games',
    title: HUB.title,
    ogTitle: HUB.ogTitle,
    description: HUB.description,
    h1: HUB.h1,
    ogImage: '/assets/images/og-games.jpg',
    jsonld: jsonld,
  })}
  <body id="top">
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <canvas id="bg-canvas" aria-hidden="true"></canvas>
${chrome.header}

    <main id="main-content" class="page-shell">
      <section class="page-hero">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href="/">Home</a></li>
            <li aria-current="page">Games</li>
          </ol>
        </nav>
        <h1>${prose(HUB.h1)}</h1>
        <p class="hero-text">${prose(HUB.hero)}</p>
        <ul class="game-facts">
${HUB.facts.map((f) => `          <li>${prose(f)}</li>`).join('\n')}
        </ul>

        <!-- Type-to-filter over the cards below, exactly the shape /labs
             uses. It is a view on this one page — site-wide search is "/" —
             so it ships as plain markup and hub.js wires it up. Hidden
             without JS by games.css, because a box that filters nothing is a
             broken promise rather than progressive enhancement. -->
        <div class="game-filter" id="game-filter">
          <label class="sr-only" for="game-filter-input">Filter the games on this page</label>
          <div class="game-filter-row">
            <svg class="game-filter-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 5h16M7 12h10m-7 7h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <input type="search" id="game-filter-input" class="game-filter-input"
                   placeholder="Filter the games&hellip; try &lsquo;snake&rsquo;, &lsquo;typing&rsquo;, &lsquo;puzzle&rsquo;"
                   autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" />
            <button type="button" class="game-filter-clear" id="game-filter-clear" hidden>Clear</button>
          </div>
          <ul class="game-cats" id="game-cats">
${chips}
          </ul>
          <p class="game-filter-count" id="game-filter-count" role="status" aria-live="polite"></p>
          <div class="game-filter-empty" id="game-filter-empty" hidden>
            <p>Nothing here matches. This box only filters the games on this page &mdash;
               try the site search (press <kbd>/</kbd>), or clear the filter.</p>
            <button type="button" class="game-filter-clear" id="game-filter-empty-clear">Clear the filter</button>
          </div>
        </div>
      </section>

      <!-- The two walkthroughs. Same construction as the pair on /labs, which
           is where .explainer-* is defined (main.css, loaded here too).

           THE ASTERISK IS LOAD-BEARING. Both the narration and the recorded
           interface in the desktop cut quote the number of games as it stood
           on the day it was recorded, and that number is baked into the
           picture rather than supplied by the caption track — so it cannot be
           corrected by editing a file, only by re-recording. Every other
           figure on this site is recounted at deploy; this one cannot be, so
           it gets a note instead of a silent lie. -->
      <section class="section-card explainer-section">
        <div class="section-heading">
          <h2>How the games work</h2>
          <p>Two short walkthroughs, with sound. Nothing plays until you press play.</p>
        </div>
        <div class="explainer-grid">
          <figure class="explainer">
            <video controls preload="none" playsinline width="1920" height="1080"
                   poster="/assets/video/games-desktop-poster.jpg">
              <source src="/assets/video/games-desktop.mp4" type="video/mp4" />
            <track kind="captions" src="/assets/video/games-desktop.vtt" srclang="en" label="English" default />
              Your browser cannot play this video. Everything it points at is on this page already: the filter above, the category chips, and the storage panel further down.
            </video>
            <figcaption><strong>On a computer</strong> &mdash; the categories, the type-to-filter box, and the storage panel where you can read your saved scores, clear them, or switch saving off.</figcaption>
          </figure>
          <figure class="explainer">
            <video controls preload="none" playsinline width="1920" height="1080"
                   poster="/assets/video/games-mobile-poster.jpg">
              <source src="/assets/video/games-mobile.mp4" type="video/mp4" />
            <track kind="captions" src="/assets/video/games-mobile.vtt" srclang="en" label="English" default />
              Your browser cannot play this video. Everything it points at is on this page already: the filter above, the category chips, and the storage panel further down.
            </video>
            <figcaption><strong>On a phone</strong> &mdash; your scores shown as the real rows the browser is holding, cleared in one tap.</figcaption>
          </figure>
        </div>
        <p class="explainer-note">
          <span aria-hidden="true">*</span> The walkthrough was recorded when the arcade was smaller, so the
          number of games it quotes is already behind. Games are still being added. The count on this page is
          the one to trust &mdash; it is counted at every deploy rather than typed.
        </p>
      </section>
${sections}
      <section class="section-card">
        <div class="section-heading">
          <h2>${prose(HUB.aboutHeading)}</h2>
        </div>
        <div class="content-grid two-up">
${HUB.about.map((c) => `          <article class="info-card">
            <h3>${prose(c.h)}</h3>
            <p>${prose(c.p)}</p>
          </article>`).join('\n')}
        </div>
      </section>

      <!-- The data panel. Real markup rather than JS-built, so a visitor with
           no JavaScript still reads what the section would store and is not
           quietly shown an empty box. hub.js fills in the live list. -->
      <section class="section-card" id="games-data">
        <div class="section-heading">
          <p class="eyebrow">Your data</p>
          <h2>What this section keeps, and how to remove it</h2>
          <p>
            Best scores, the difficulty you last picked and the odd half-finished board are kept in your own
            browser&rsquo;s storage, on this device. None of it is sent anywhere, none of it identifies you, and
            there is no account it could be attached to &mdash; but it is yours, so here it is, and here are the
            switches.
          </p>
        </div>

        <div class="data-panel" id="data-panel">
          <p class="data-empty" id="data-empty">Nothing is stored yet. Play something and this fills in.</p>
          <table class="data-table" id="data-table" hidden>
            <thead>
              <tr><th scope="col">Game</th><th scope="col">What</th><th scope="col">Value</th></tr>
            </thead>
            <tbody id="data-rows"></tbody>
          </table>

          <div class="data-actions">
            <button class="game-btn" type="button" id="data-clear">Clear everything</button>
            <button class="game-btn" type="button" id="data-optout" aria-pressed="false">Store nothing at all</button>
            <p class="data-said" id="data-said" role="status" aria-live="polite"></p>
          </div>

          <p class="data-note">
            Turning storage off also deletes what is already there &mdash; a switch that only stops future writes
            is a pause, not an opt-out. One key does survive, holding the word <code>off</code>, because a
            preference to store nothing still has to be remembered or it is forgotten the moment you reload.
            Nothing under <code>site.</code> or <code>lab.</code> is touched by any of these buttons, so your
            theme and anything the labs keep are left alone.
          </p>
        </div>
      </section>

      <section class="section-card">
        <div class="section-heading">
          <h2>Questions people ask</h2>
        </div>
${HUB.faq.map((f) => `          <details class="lab-faq">
            <summary>${prose(f.q)}</summary>
            <div>${prose(f.a)}</div>
          </details>`).join('\n')}
      </section>
    </main>

${chrome.footer}

    <script src="/assets/js/particle-bg.js" defer></script>
    <script defer src="/assets/js/games/game-storage.js"></script>
    <script defer src="/assets/js/games/hub.js"></script>
  </body>
</html>
`;
}

/* --------------------------------------------------------------------------
   Write
   -------------------------------------------------------------------------- */
function writeIf(rel, contents, stats) {
  const abs = path.join(ROOT, rel);
  const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (prev === contents) { stats.same++; return; }
  stats[prev === null ? 'added' : 'changed']++;
  stats.names.push((prev === null ? '+ ' : '~ ') + rel);
  if (!CHECK) fs.writeFileSync(abs, contents);
}

function main() {
  if (!fs.existsSync(OUT_DIR)) {
    if (CHECK) { console.log('games/ does not exist yet'); }
    else fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  /* A duplicate slug would silently overwrite a page, and the only symptom
     would be a card on the hub linking to the wrong game. */
  const seen = new Set();
  for (const g of GAMES) {
    if (seen.has(g.slug)) throw new Error('games.js: duplicate slug "' + g.slug + '"');
    seen.add(g.slug);
    if (!CATEGORIES.some((c) => c.key === g.cat)) {
      throw new Error('games.js: "' + g.slug + '" has unknown category "' + g.cat + '"');
    }
    for (const r of g.related || []) {
      if (!GAMES.some((x) => x.slug === r)) {
        throw new Error('games.js: "' + g.slug + '" links to unknown game "' + r + '"');
      }
    }
  }

  const chrome = { header: staticHeader(), footer: staticFooter() };
  const stats = { added: 0, changed: 0, same: 0, names: [] };

  if (!ONLY) writeIf('games/index.html', hubPage(chrome), stats);
  for (const g of GAMES) {
    if (ONLY && g.slug !== ONLY) continue;
    writeIf('games/' + g.slug + '.html', gamePage(g, chrome), stats);
  }

  console.log('games pages');
  console.log('  ' + GAMES.length + ' games in ' + CATEGORIES.length + ' categories');
  console.log('  ' + (CHECK ? 'would add ' : 'added ') + stats.added +
              (CHECK ? ', would update ' : ', updated ') + stats.changed +
              ', unchanged ' + stats.same);
  stats.names.slice(0, 40).forEach((n) => console.log('    ' + n));
  if (stats.names.length > 40) console.log('    … and ' + (stats.names.length - 40) + ' more');
}

if (require.main === module) main();

module.exports = { GAMES, CATEGORIES, main };

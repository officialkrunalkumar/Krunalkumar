#!/usr/bin/env node
/* ==========================================================================
   search-index.js — rebuilds assets/data/search-index.json from the pages.
   --------------------------------------------------------------------------
   The README has always said "the index is a committed artefact: regenerate it
   when page content changes", but there was no tool to regenerate it with, so
   it drifted. By the time this was written the committed index still described
   /privacy, /refund and /terms as having no <h1>, still spelled the HackLab
   heading with a hyphen where the page had long since moved to an em dash, and
   carried the pre-edit title for /labs/leak. A manual step with no command
   behind it is a manual step that gets skipped.

   The rules below were not invented. They were recovered by regenerating the
   index and comparing field by field against the committed one, then adjusting
   until the untouched pages matched. That is why breadcrumbs are stripped:
   the stored body text for /about starts "Professional profile", not "Home
   About Professional profile". See BODY_CAP for the one rule deliberately
   changed rather than reproduced.

   Usage:
     node scripts/search-index.js            rebuild and write
     node scripts/search-index.js --check    report what would change, write nothing

   build.js calls buildIndex() so a deploy is never served a stale index.
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/data/search-index.json');
const ORIGIN_SUFFIX = ' | Krunalkumar Shah';
/* Body text per page. The hand-built index used 1400, which truncated 86 of
   the 88 pages: "pyodide" did not find /labs/python, and a lab FAQ near the
   foot of a page was not searchable at all. Four pages predating that cap
   carried up to 2404 characters, so regenerating everything at 1400 would also
   have quietly removed text that used to be findable.

   2500 is the smallest value where no page loses anything it had before.
   Together with the FAQ text appended below it, the index has grown with the
   site to about a third of a MB gzipped (roughly 1 MB raw) as of 2026-09 —
   a cost paid only by visitors who actually open the search overlay, since
   site-search.js fetches this file on first use, never on page load, and one
   that keeps rising as pages are added. */
const BODY_CAP = 2500;

/* Extra room for the FAQ text appended after BODY_CAP. Questions come first,
   so even a page whose answers overflow this keeps every question searchable. */
const FAQ_CAP = 1600;

/* Pages that exist but are deliberately not searchable: the Search Console
   token, the sandboxed guestbook document, the two header/footer partials, the
   error page, and the noindex easter eggs (the teapot, the fake terminal and
   Einstein's laboratory, all three reached deliberately rather than found). */
const EXCLUDE = new Set([
  '404.html',
  'google46d0a7ad3f01b5a6.html',
  'labs/hacklab-guestbook.html',
  'partials/header.html',
  'partials/footer.html',
  'fun/teapot.html',
  'fun/terminal.html',
  'fun/einstein.html',
  // The wish cards render from the query string, so an indexed copy would be
  // a blank greeting. Searching "birthday" here should land on the tool that
  // makes one — /labs/wish-generator, which IS in the index.
  'fun/birthday.html',
  'fun/festival.html',
  'offline.html',   // the SW's navigation fallback: only ever seen offline,
                    // where search could not fetch this index anyway
]);

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&nbsp;': ' ',
  '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘',
  '&ldquo;': '“', '&rdquo;': '”', '&times;': '×', '&middot;': '·',
};

function decode(s) {
  return s.replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => {
    if (ENTITIES[m] !== undefined) return ENTITIES[m];
    const num = m.match(/^&#(\d+);$/);
    return num ? String.fromCharCode(Number(num[1])) : m;
  });
}

function listPages() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'scripts', '.well-known', '.vercel'].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.html')) {
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        if (!EXCLUDE.has(rel)) out.push(rel);
      }
    }
  })(ROOT);
  // The committed index is ordered by file path, not by URL: "/" sits between
  // /contact and /internships because index.html sorts there.
  return out.sort();
}

/* Must agree with build.js's fileToUrl, and for the same reason: the seven
   pages in fun/ are SERVED at the root by a vercel.json rewrite, so /buddha is
   their address and /fun/buddha is not one a visitor should ever be handed.
   Search results link to whatever this returns, so getting it wrong sends the
   reader to a URL the sitemap does not list and the canonical disowns. */
function urlFor(rel) {
  if (rel === 'index.html') return '/';
  const stripped = rel.replace(/\.html$/, '').replace(/\/index$/, '');
  if (stripped.indexOf('fun/') === 0) return '/' + stripped.slice(4);
  return '/' + stripped;
}

function sectionFor(url) {
  if (url.startsWith('/labs')) return 'Labs';
  if (url.startsWith('/games')) return 'Games';
  if (url.startsWith('/blog')) return 'Blog';
  return 'Site';
}

/* Text a reader actually sees, with JavaScript enabled.
   - <nav> goes because breadcrumbs are navigation, not content.
   - <noscript> goes because a visitor running the search never sees it.
   - <template> and <svg> carry no readable prose. */
function visibleText(html) {
  return decode(
    html
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<template[\s\S]*?<\/template>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/* The <details class="lab-faq"> questions and answers, flattened. Questions
   first so the words a searcher is most likely to type survive FAQ_CAP. */
function collectFaq(main) {
  const blocks = [...main.matchAll(/<details class="lab-faq">([\s\S]*?)<\/details>/g)];
  if (!blocks.length) return '';
  const questions = [];
  const answers = [];
  for (const b of blocks) {
    const q = b[1].match(/<summary>([\s\S]*?)<\/summary>/);
    const a = b[1].match(/<div>([\s\S]*?)<\/div>/);
    if (q) questions.push(decode(q[1].replace(/<[^>]+>/g, ' ')));
    if (a) answers.push(decode(a[1].replace(/<[^>]+>/g, ' ')));
  }
  return (questions.join(' ') + ' ' + answers.join(' ')).replace(/\s+/g, ' ').trim();
}

function entryFor(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const headEnd = html.indexOf('</head>');
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  const title = decode((head.match(/<title>([^<]*)<\/title>/) || [])[1] || '').trim();
  const desc = decode((head.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/) || [])[1] || '').trim();

  const mainMatch = html.match(/<main[\s\S]*?<\/main>/i);
  const main = mainMatch ? mainMatch[0] : '';
  const h1Match = main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = h1Match ? decode(h1Match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';

  const url = urlFor(rel);
  /* The body gets the DISPLAY title, with the " | Krunalkumar Shah" suffix
     already stripped — the same trim the t field below applies. Fed the raw
     <title>, every search snippet led with the site's own name as noise
     before a single word of content. */
  const shownTitle = title.endsWith(ORIGIN_SUFFIX) ? title.slice(0, -ORIGIN_SUFFIX.length) : title;
  const prose = (shownTitle + ' ' + visibleText(main)).replace(/\s+/g, ' ').trim();
  let body = prose.slice(0, BODY_CAP);

  /* The FAQ sits at the foot of every lab page, which puts it past any cap
     worth paying for — "pyodide" appears 4,114 characters into /labs/python,
     and "How big a file can I send?" 4,398 into /labs/chat. Those are the
     questions people actually type into a search box, so they are appended
     after the cap instead of being lost to it. Roughly 250 characters of
     question text per lab, which is a far better trade than raising the cap
     for every page to reach the same words. */
  const faq = collectFaq(main);
  if (faq && body.indexOf(faq.slice(0, 40)) === -1) {
    body += ' ' + faq.slice(0, FAQ_CAP);
  }

  // Key order matters: the committed file is u,t,h,d,s,b and a reordered file
  // is a pointless diff even though it parses the same.
  return {
    u: url,
    t: shownTitle,
    h: heading,
    d: desc,
    s: sectionFor(url),
    b: body,
  };
}

function buildIndex(opts) {
  const check = !!(opts && opts.check);
  const log = (opts && opts.log) || ((s) => process.stdout.write(s + '\n'));

  const files = listPages();
  const pages = files.map(entryFor);

  // Guardrails. A silently emptied index is worse than a stale one, because
  // search keeps working and just stops finding things.
  const problems = [];
  if (pages.length < 80) problems.push('only ' + pages.length + ' pages found, expected at least 80');
  for (const p of pages) {
    if (!p.t) problems.push(p.u + ': no <title>');
    if (!p.b || p.b.length < 100) problems.push(p.u + ': body text is ' + (p.b || '').length + ' chars');
  }
  if (problems.length) {
    problems.slice(0, 10).forEach((x) => log('    - ' + x));
    throw new Error('search index: ' + problems.length + ' problem(s) — refusing to write');
  }

  const json = JSON.stringify({ v: 1, pages });

  let before = null;
  try { before = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }

  let changed = 0, added = 0, removed = 0;
  if (before) {
    const oldByUrl = new Map(before.pages.map((p) => [p.u, p]));
    const newUrls = new Set(pages.map((p) => p.u));
    for (const p of pages) {
      const o = oldByUrl.get(p.u);
      if (!o) { added++; continue; }
      if (JSON.stringify(o) !== JSON.stringify(p)) changed++;
    }
    removed = before.pages.filter((p) => !newUrls.has(p.u)).length;
  }

  log('search index');
  log('  ' + pages.length + ' pages   ' +
      (before ? (changed + ' changed, ' + added + ' added, ' + removed + ' removed') : 'first build'));
  log('  ' + (check ? 'would write' : 'wrote') + ' ' + json.length + ' bytes');

  if (!check) fs.writeFileSync(OUT, json);
  return { pages: pages.length, changed, added, removed, bytes: json.length };
}

module.exports = { buildIndex };

if (require.main === module) {
  buildIndex({ check: process.argv.includes('--check') });
}

#!/usr/bin/env node
/* ==========================================================================
   mayuri-index.js — builds assets/data/mayuri-index.json for the corner chat.
   --------------------------------------------------------------------------
   Mayuri answers questions by RETRIEVAL, not by generation. There is no model
   and no API: everything she can say is something already written by hand
   somewhere on this site. This script is what collects it.

   Three sources, in descending order of how good an answer they make:

     1. FAQ pairs   — every "@type":"Question" in the FAQPage JSON-LD, which
                      is around 1,270 hand-written question/answer pairs
                      across 230-odd pages. These are the best answers on the
                      site because they are already in question form: the
                      matching problem is "which of these questions is the
                      visitor asking", which is a far easier problem than
                      summarising prose.
     2. Glossary    — scripts/glossary-terms.js, ~180 terms that each carry a
                      definition, a category, cross-references, and often the
                      lab that demonstrates the thing and the post that
                      explains it. That last part is why the glossary is worth
                      more than its word count: it turns an answer into a
                      route ("...and you can try it in /labs/linux").
     3. Page cards  — title, h1 and description per page, so "which lab does
                      X" can be answered for pages that carry no FAQ.

   WHY THIS DOES NOT JUST READ search-index.json. It would be less code: that
   file already holds the page list and the body text. But it is written by a
   different script that only writes in non-check mode, so reading it here
   would make this script's output depend on whether a *different* step had
   run and written first — a stale-read bug that appears only in --check. One
   self-contained pass over the pages cannot have that problem. The cost is
   about thirty lines that look like search-index.js; the exclusion list and
   the section labels are deliberately identical to it, and if either changes
   there, change it here too.

   BODY TEXT IS DELIBERATELY NOT INCLUDED. search-index.json carries ~887 KB
   of page prose, and pulling it in here would roughly triple this file for
   almost no gain: prose is what makes a *search result*, and a chat answer
   needs a sentence that already answers something. The excerpt below is
   capped hard for the same reason.

   Usage:
     node scripts/mayuri-index.js            rebuild and write
     node scripts/mayuri-index.js --check    report what would change, write nothing
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets/data/mayuri-index.json');
const ORIGIN_SUFFIX = ' | Krunalkumar Shah';

/* A page card is a routing hint, not an answer, so it needs only enough text
   to be matched and shown as a one-liner. */
const EXCERPT_CAP = 240;

/* Identical to search-index.js's EXCLUDE, and for the same reasons — the
   Search Console token, the sandboxed guestbook, the partials, the error page,
   the noindex eggs, the query-string greeting cards, and the offline
   fallback. If that list changes, this one changes with it. */
const EXCLUDE = new Set([
  '404.html',
  'google46d0a7ad3f01b5a6.html',
  'labs/hacklab-guestbook.html',
  'partials/header.html',
  'partials/footer.html',
  'fun/teapot.html',
  'fun/terminal.html',
  'fun/einstein.html',
  'fun/birthday.html',
  'fun/festival.html',
  'offline.html',
]);

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&nbsp;': ' ',
  '&hellip;': '…', '&rsquo;': '’', '&lsquo;': '‘',
  '&ldquo;': '“', '&rdquo;': '”', '&times;': '×', '&middot;': '·',
};

function decode(s) {
  return String(s == null ? '' : s).replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => {
    if (ENTITIES[m] !== undefined) return ENTITIES[m];
    const num = m.match(/^&#(\d+);$/);
    return num ? String.fromCharCode(Number(num[1])) : m;
  });
}

/* Answers in the JSON-LD may carry markup — one of them legitimately holds two
   <a> tags, because Google's FAQPage spec allows a small set of HTML in an
   answer. The chat renders text, so tags come out here rather than in the
   browser: doing it at build time means the shipped file has nothing in it
   that could be injected into the panel later. */
function plainText(s) {
  return decode(String(s == null ? '' : s).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function listPages() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'scripts', '.well-known', '.vercel', 'assets'].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.name.endsWith('.html')) continue;
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (EXCLUDE.has(rel)) continue;
      out.push(rel);
    }
  })(ROOT);
  return out.sort();
}

function urlFor(rel) {
  let u = '/' + rel.replace(/\.html$/, '');
  if (u.endsWith('/index')) u = u.slice(0, -'/index'.length);
  if (u === '/index') u = '/';
  return u;
}

function sectionFor(url) {
  if (url.startsWith('/labs')) return 'Labs';
  if (url.startsWith('/games')) return 'Games';
  if (url.startsWith('/blog')) return 'Blog';
  return 'Site';
}

function firstMatch(html, re) {
  const m = html.match(re);
  return m ? decode(m[1]).trim() : '';
}

/* Every FAQPage node on the page, wherever it sits in the graph. Pages carry
   several JSON-LD blocks and some wrap their nodes in @graph, so both shapes
   are walked rather than assuming one. A block that does not parse is skipped
   rather than fatal: the JSON-LD gate in build.js already fails the deploy on
   a malformed block, so throwing here would only duplicate that error in a
   less useful place. */
function faqFrom(html, url, title) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch (e) { continue; }
    const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
    for (const node of nodes) {
      if (!node || node['@type'] !== 'FAQPage' || !Array.isArray(node.mainEntity)) continue;
      for (const q of node.mainEntity) {
        if (!q || q['@type'] !== 'Question') continue;
        const question = plainText(q.name);
        const answer = plainText(q.acceptedAnswer && q.acceptedAnswer.text);
        if (!question || !answer) continue;
        out.push({ q: question, a: answer, u: url, t: title });
      }
    }
  }
  return out;
}

function buildIndex(opts) {
  const check = !!(opts && opts.check);
  const log = (opts && opts.log) || ((s) => process.stdout.write(s + '\n'));

  const faq = [];
  const pages = [];

  for (const rel of listPages()) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const url = urlFor(rel);
    let title = firstMatch(html, /<title>([\s\S]*?)<\/title>/i);
    if (title.endsWith(ORIGIN_SUFFIX)) title = title.slice(0, -ORIGIN_SUFFIX.length);
    const h1 = plainText(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
    const desc = firstMatch(html, /<meta[^>]+name="description"[^>]+content="([^"]*)"/i);

    pages.push({
      u: url,
      t: title,
      h: h1,
      d: desc.slice(0, EXCERPT_CAP),
      s: sectionFor(url),
    });

    for (const item of faqFrom(html, url, h1 || title)) faq.push(item);
  }

  /* The glossary is required rather than parsed, because it is already a Node
     module and the generated page is downstream of it. `see` is kept because
     it is what lets one answer offer the next one. */
  const terms = require('./glossary-terms.js').map((t) => ({
    t: t.t,
    d: t.d,
    c: t.c || '',
    see: t.see || [],
    lab: t.lab || '',
    post: t.post || '',
  }));

  const index = { v: 1, faq: faq, terms: terms, pages: pages };
  const json = JSON.stringify(index);

  /* Refuse to write a suspicious index, the same guard search-index.js keeps.
     An empty or collapsed corpus would not error at runtime — Mayuri would
     simply answer nothing and fall back to "message my boss" every time,
     which looks like a design choice rather than a broken build. */
  if (faq.length < 500) {
    throw new Error('mayuri-index: only ' + faq.length + ' FAQ pairs found (expected 1000+) — refusing to write');
  }
  if (terms.length < 100) {
    throw new Error('mayuri-index: only ' + terms.length + ' glossary terms — refusing to write');
  }
  if (pages.length < 200) {
    throw new Error('mayuri-index: only ' + pages.length + ' pages — refusing to write');
  }

  let before = null;
  try { before = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { before = null; }
  const changed = !before || JSON.stringify(before) !== json;

  log('mayuri index');
  log('  ' + faq.length + ' FAQ pairs, ' + terms.length + ' glossary terms, ' + pages.length + ' page cards');
  log('  ' + (check ? 'would write' : 'wrote') + ' ' + json.length + ' bytes' +
      (changed ? '' : ' (unchanged)'));

  if (!check && changed) fs.writeFileSync(OUT, json);
  return { faq: faq.length, terms: terms.length, pages: pages.length, bytes: json.length, changed: changed };
}

module.exports = { buildIndex };

if (require.main === module) {
  buildIndex({ check: process.argv.includes('--check') });
}

#!/usr/bin/env node
/* ==========================================================================
   build.js — the deploy-time pass. Runs on Vercel, never on your repo.
   --------------------------------------------------------------------------
   Vercel clones this repository into a throwaway container, runs this script
   there, uploads the result to the CDN and discards the container. Nothing is
   written back to git, so the source keeps every comment while visitors get
   the smaller file. That is the whole point: the comments in main.css record
   measurements ("#008f34 measured 2.83:1 on the teal end of the .lab-cta
   gradient") and deleting them by hand to save bytes would destroy the most
   valuable documentation in the codebase.

   It does three transformations, then verifies what it produced:

     1. Strips CSS comments.  main.css is 41.7% comments and render-blocking
        on all 89 pages. Saves roughly 44 KB raw / 12 KB brotli off the
        critical path.
     2. Rewrites sitemap.xml <lastmod> per file from git, instead of the one
        hardcoded date every URL currently shares.
     3. Rebuilds assets/data/search-index.json from the pages, so the search
        box can never describe content the site no longer has. See
        scripts/search-index.js for why that stopped being a manual step.

   It then checks its own output — critical files present, above a size floor,
   and enough HTML pages on disk — and throws if anything looks wrong. Vercel
   keeps serving the previous deployment when a build exits non-zero, so failing
   the deploy is always safer than publishing the damage. Every step reports
   what it did, so a deploy log shows the numbers.

   SAFE TO RUN LOCALLY. It is idempotent — a second run finds no comments left
   and writes the same bytes back — and `node scripts/build.js --check` makes
   no changes at all, it only prints what would happen. Every write is gated on
   the parsed rule list coming out unchanged, so a bug in the scanner throws
   rather than shipping a broken stylesheet.

   It deliberately does NOT minify beyond comment removal. Collapsing
   whitespace would save a little more and make every future diff unreadable
   in the deploy preview, which is a bad trade for a site this size.
   ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');

const CSS_FILES = [
  'assets/css/main.css',
  'assets/css/labs.css',
  'assets/css/blog.css',
  'assets/css/buddha.css',
  /* Added when /party and /einstein arrived. A stylesheet missing from this
     list is not merely un-stripped — it also never goes through the selector-
     order and brace-balance check below, so it is the one file a bad edit
     could corrupt without the build noticing. Any new stylesheet belongs
     here on the day it is created. */
  'assets/css/party.css',
  'assets/css/einstein.css',
  'assets/css/synth.css',
];

let totalBefore = 0;
let totalAfter = 0;

function log(line) {
  process.stdout.write(line + '\n');
}

/* --------------------------------------------------------------------------
   1. CSS comments
   --------------------------------------------------------------------------
   A hand-rolled scanner rather than a regex. `/\*[\s\S]*?\*\//g` looks right
   and is wrong: it happily matches inside a string, so a rule like
   content: "/*" would have its quotes eaten and the file would break from
   that point on. This walks the file and tracks whether it is inside a
   string, so a comment is only a comment where CSS says it is.
   -------------------------------------------------------------------------- */
function stripCssComments(src) {
  let out = '';
  let i = 0;
  let quote = null;

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (quote) {
      out += c;
      if (c === '\\') {                 // escaped char inside a string
        out += src[i + 1] || '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;            // unterminated: drop the remainder
      i = end + 2;
      // Leave the line tidy: if the comment was the only thing on its line,
      // take the newline with it rather than leaving a blank.
      const lineStart = out.lastIndexOf('\n') + 1;
      if (out.slice(lineStart).trim() === '') {
        out = out.slice(0, lineStart);
        while (src[i] === ' ' || src[i] === '\t') i += 1;
        if (src[i] === '\r') i += 1;
        if (src[i] === '\n') i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }

  // Collapse runs of blank lines left behind, but keep single ones: the file
  // stays readable in a Vercel deploy preview.
  return out.replace(/\n{3,}/g, '\n\n');
}

/* The ordered list of selectors (and at-rule preludes) in a stylesheet, with
   comments and strings ignored. Two files with identical lists describe
   identical rules, whatever whitespace or commentary sits between them — which
   is exactly the invariant a comment-stripping pass must preserve. */
function selectors(src) {
  const found = [];
  let buf = '';
  let i = 0;
  let quote = null;

  while (i < src.length) {
    const c = src[i];

    if (quote) {
      buf += c;
      if (c === '\\') { buf += src[i + 1] || ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;                                  // comments never reach buf
    }
    if (c === '{') { found.push(buf.replace(/\s+/g, ' ').trim()); buf = ''; i += 1; continue; }
    if (c === '}' || c === ';') { buf = ''; i += 1; continue; }
    buf += c;
    i += 1;
  }
  return found;
}

/* Net brace depth, ignoring comments and strings. Zero means balanced. */
function balance(src) {
  let depth = 0, i = 0, quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1; continue;
    }
    if (c === '"' || c === "'") { quote = c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}') depth -= 1;
    i += 1;
  }
  return depth;
}

function doCss() {
  log('CSS comment stripping');
  for (const rel of CSS_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      log('  SKIP  ' + rel + ' (not found)');
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');
    const out = stripCssComments(src);

    // Guardrails. If any of these trip, throw rather than write a stylesheet
    // that might be subtly broken.
    //
    // Counting raw braces before/after is NOT a valid check: a comment may
    // legitimately contain one. main.css has exactly such a comment, quoting
    // `a { color: inherit; text-decoration: none }` to explain why a link
    // inside .error-pill needed its own underline. Comparing counts flagged
    // that as corruption. The real invariant is that the RULES are untouched,
    // so compare the ordered list of selectors instead — computed with the
    // same comment-aware scan, so comments never enter the comparison.
    const selBefore = selectors(src);
    const selAfter = selectors(out);

    if (selBefore.length !== selAfter.length) {
      throw new Error(rel + ': rule count changed (' + selBefore.length + ' -> ' +
                      selAfter.length + ') — refusing to write');
    }
    for (let k = 0; k < selBefore.length; k++) {
      if (selBefore[k] !== selAfter[k]) {
        throw new Error(rel + ': rule ' + (k + 1) + ' changed\n  before: ' +
                        selBefore[k] + '\n  after:  ' + selAfter[k] + '\n  refusing to write');
      }
    }
    if (balance(out) !== 0) {
      throw new Error(rel + ': braces unbalanced after strip — refusing to write');
    }
    if (out.length > src.length) {
      throw new Error(rel + ': output grew — refusing to write');
    }

    totalBefore += src.length;
    totalAfter += out.length;
    const saved = src.length - out.length;
    const pct = src.length ? ((saved / src.length) * 100).toFixed(1) : '0.0';
    log('  ' + (CHECK ? 'would strip' : 'stripped  ') + '  ' + rel.padEnd(26) +
        (src.length + '').padStart(7) + ' -> ' + (out.length + '').padStart(7) +
        '  (-' + pct + '%)');
    if (!CHECK) fs.writeFileSync(abs, out);
  }
}

/* --------------------------------------------------------------------------
   2. sitemap lastmod
   --------------------------------------------------------------------------
   Every URL currently carries the same hardcoded date, which tells a crawler
   nothing and is wrong the day after it is written. The real answer is the
   last commit that touched the file backing each URL.
   -------------------------------------------------------------------------- */
function urlToFile(loc) {
  let p = loc.replace(/^https?:\/\/[^/]+/, '');
  p = p.split('?')[0].split('#')[0];
  if (p === '' || p === '/') return 'index.html';
  p = p.replace(/^\//, '').replace(/\/$/, '');
  const candidates = [p, p + '.html', path.join(p, 'index.html')];
  for (const c of candidates) {
    if (fs.existsSync(path.join(ROOT, c))) return c;
  }
  return null;
}

function lastCommitDate(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file],
                             { cwd: ROOT, encoding: 'utf8' }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch (e) {
    return null;   // shallow clone, or git unavailable
  }
}

function doSitemap() {
  log('');
  log('sitemap lastmod');
  const abs = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(abs)) { log('  SKIP  sitemap.xml (not found)'); return; }

  // A deploy clone usually has only the last handful of commits, so `git log`
  // cannot see far enough back to date most files. Those entries keep the date
  // they already carry, which is the correct fallback — but a partial result
  // that looks like a complete one is worth one line of log.
  let shallow = false;
  try {
    shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'],
                           { cwd: ROOT, encoding: 'utf8' }).trim() === 'true';
  } catch (e) { /* no git at all: every lookup returns null, all dates stay */ }
  if (shallow) {
    log('  NOTE  shallow clone: only files touched in the fetched history can');
    log('        be dated. The rest keep their existing <lastmod>.');
  }

  const src = fs.readFileSync(abs, 'utf8');
  const before = new Set((src.match(/<lastmod>([^<]+)<\/lastmod>/g) || [])
    .map((m) => m.replace(/<\/?lastmod>/g, '')));

  let changed = 0, unresolved = 0;
  const out = src.replace(
    /<loc>([^<]+)<\/loc>(\s*)<lastmod>([^<]+)<\/lastmod>/g,
    (whole, loc, gap, current) => {
      const file = urlToFile(loc);
      if (!file) { unresolved += 1; return whole; }
      const date = lastCommitDate(file);
      if (!date || date === current) return whole;
      changed += 1;
      return '<loc>' + loc + '</loc>' + gap + '<lastmod>' + date + '</lastmod>';
    });

  const after = new Set((out.match(/<lastmod>([^<]+)<\/lastmod>/g) || [])
    .map((m) => m.replace(/<\/?lastmod>/g, '')));

  log('  distinct dates before: ' + before.size + '   after: ' + after.size);
  log('  ' + (CHECK ? 'would update' : 'updated') + ' ' + changed + ' entries' +
      (unresolved ? ('   (' + unresolved + ' URLs had no backing file)') : ''));

  if (!CHECK && changed) fs.writeFileSync(abs, out);
}

/* --------------------------------------------------------------------------
   3. Search index
   --------------------------------------------------------------------------
   assets/data/search-index.json is generated from the pages. It used to be a
   hand-maintained artefact with a README note asking you to regenerate it when
   content changed, which is exactly the kind of step that gets forgotten — by
   the time this ran for the first time, 75 of the 88 entries had drifted from
   the pages they described. Rebuilding it on every deploy makes that
   impossible. The generator refuses to write a suspicious index, and a throw
   here fails the deploy rather than shipping a search box that finds nothing.
   -------------------------------------------------------------------------- */
function doSearchIndex() {
  log('');
  const { buildIndex } = require('./search-index.js');
  buildIndex({ check: CHECK, log: log });
}

/* --------------------------------------------------------------------------
   4. Output check
   --------------------------------------------------------------------------
   This runs against the deploy's outputDirectory, which is the repository root.
   The point is to turn any structural damage into a FAILED DEPLOY rather than a
   broken live site: Vercel keeps serving the previous deployment when a build
   exits non-zero, so throwing here is always safer than returning.

   These are floors, not fingerprints. They are set well below the real sizes so
   ordinary editing never trips them — only a truncated or emptied file does.
   -------------------------------------------------------------------------- */
const MUST_EXIST = [
  ['index.html', 20000, '</html>'],
  ['404.html', 8000, '</html>'],
  ['labs/index.html', 20000, '</html>'],
  ['blog/index.html', 12000, '</html>'],
  ['partials/header.html', 800, null],
  ['partials/footer.html', 2000, null],
  ['assets/css/main.css', 30000, '--ink'],
  ['assets/css/labs.css', 20000, '.lab'],
  ['assets/css/blog.css', 3000, null],
  ['assets/css/buddha.css', 8000, null],
  ['assets/js/boot.js', 1000, 'data-theme'],
  ['assets/js/theme.js', 2000, null],
  ['assets/js/include-partials.js', 2000, null],
  ['sw.js', 1500, null],
  ['sitemap.xml', 5000, '<urlset'],
  ['robots.txt', 200, null],
  ['vercel.json', 1000, 'cleanUrls'],
  ['assets/data/search-index.json', 50000, '"pages"'],
  ['colophon.html', 6000, 'data-colophon'],
];

/* --------------------------------------------------------------------------
   colophon.html — the numbers, counted rather than typed
   --------------------------------------------------------------------------
   The prose on that page is hand-written and stays that way. Every FIGURE in
   it is a <span data-colophon="key"> whose text this rewrites at deploy, for
   the same reason the search index stopped being a manual step: a page that
   has to be edited by hand every time a lab is added is a page that is wrong
   within a week.

   The values committed to the file are the last deploy's, so the page is still
   correct when nobody has built it — opening the repo copy shows real numbers,
   not empty placeholders. This is deliberately the last thing the build does
   to the HTML, after the page count is known.
   -------------------------------------------------------------------------- */

function countLines(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').length; }
  catch (e) { return null; }
}

function walkFiles(dir, test, acc) {
  acc = acc || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'vendor') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, test, acc);
    else if (test(full)) acc.push(full);
  }
  return acc;
}

function colophonFacts(pages) {
  const facts = {};
  facts.pages = String(pages);
  facts.labs = String(fs.readdirSync(path.join(ROOT, 'labs')).filter((f) => f.endsWith('.html') && f !== 'index.html').length);
  facts.posts = String(fs.readdirSync(path.join(ROOT, 'blog')).filter((f) => f.endsWith('.html') && f !== 'index.html').length);

  /* Scripts I wrote. assets/js/vendor is skipped by walkFiles, and so is
     assets/vendor — counting somebody else's runtime as mine would make the
     one number on this page that is a claim about effort into a lie. */
  facts.js = String(walkFiles(path.join(ROOT, 'assets/js'), (f) => f.endsWith('.js')).length);

  let deps = 0;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    deps = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
  } catch (e) { deps = 0; }
  facts.deps = String(deps);

  const kb = (n) => Math.round(n / 1024) + ' KB';
  facts.cssbefore = kb(totalBefore);
  facts.cssafter = kb(totalAfter);
  facts.csspct = (totalBefore ? Math.round(((totalBefore - totalAfter) / totalBefore) * 100) : 0) + '%';

  const readme = countLines('README.md');
  if (readme) facts.readme = readme.toLocaleString('en-US');

  /* Comment lines across the four stylesheets, counted on the REPOSITORY copy.
     By the time this runs the files on disk have been stripped, so reading them
     now would report zero — the count has to come from git's copy. */
  try {
    let commentLines = 0;
    for (const f of CSS_FILES) {
      const src = execFileSync('git', ['show', 'HEAD:' + f], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = src.match(/\/\*[\s\S]*?\*\//g) || [];
      commentLines += m.reduce((n, c) => n + c.split('\n').length, 0);
    }
    if (commentLines) facts.csscomments = commentLines.toLocaleString('en-US');
  } catch (e) { /* no git, or the file is not committed yet: keep what is there */ }

  /* A shallow clone only has the commits it fetched, so reporting its count
     would understate the history badly. Better to leave the committed number
     than to publish a smaller wrong one — the same call the sitemap makes. */
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (shallow === 'false') {
      facts.commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
  } catch (e) { /* keep the committed value */ }

  facts.updated = new Date().toISOString().slice(0, 10);
  return facts;
}

function writeColophon(pages) {
  const rel = 'colophon.html';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;

  log('');
  log('colophon');
  const facts = colophonFacts(pages);
  const before = fs.readFileSync(abs, 'utf8');
  let changed = 0;

  const after = before.replace(
    /(<span([^>]*\sdata-colophon="([a-z]+)"[^>]*)>)([^<]*)(<\/span>)/g,
    (all, open, attrs, key, value, close) => {
      if (!(key in facts) || facts[key] === value) return all;
      changed += 1;
      return open + facts[key] + close;
    }
  );

  if (!changed) { log('  already current, nothing to write'); return; }
  if (CHECK) { log('  would update ' + changed + ' figure(s)'); return; }
  fs.writeFileSync(abs, after);
  log('  updated ' + changed + ' figure(s)');
}

function verifyOutput() {
  log('');
  log('output check');

  const problems = [];
  for (const [rel, floor, marker] of MUST_EXIST) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { problems.push(rel + ': missing'); continue; }
    const body = fs.readFileSync(abs, 'utf8');
    if (body.length < floor) {
      problems.push(rel + ': ' + body.length + ' bytes, below the ' + floor + ' floor');
    } else if (marker && body.indexOf(marker) === -1) {
      problems.push(rel + ': does not contain ' + JSON.stringify(marker));
    }
  }

  // The page count is the other thing worth pinning. A build that somehow
  // emptied a directory would still pass the per-file checks above.
  let pages = 0;
  (function count(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'scripts') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) count(p);
      else if (e.name.endsWith('.html')) pages += 1;
    }
  })(ROOT);

  const MIN_PAGES = 80;
  if (pages < MIN_PAGES) problems.push('only ' + pages + ' HTML pages found, expected at least ' + MIN_PAGES);

  if (problems.length) {
    log('  FAILED:');
    problems.forEach((p) => log('    - ' + p));
    throw new Error('output check failed — refusing to publish this build');
  }

  log('  ' + MUST_EXIST.length + ' critical files present and intact, ' + pages + ' HTML pages');
  writeColophon(pages);
}

/* -------------------------------------------------------------------------- */

function main() {
  log(CHECK ? '=== build --check (no files will be written) ===' : '=== build ===');
  doCss();
  doSitemap();
  doSearchIndex();
  verifyOutput();
  log('');
  const saved = totalBefore - totalAfter;
  log('CSS total: ' + totalBefore + ' -> ' + totalAfter +
      '  (saved ' + saved + ' bytes, ' +
      (totalBefore ? ((saved / totalBefore) * 100).toFixed(1) : '0') + '%)');
  log(CHECK ? '=== check complete, nothing written ===' : '=== build complete ===');
}

main();

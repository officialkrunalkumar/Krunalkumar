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

   It does seven transformations, then verifies what it produced. They are
   numbered for the section banners further down this file rather than counted
   1..7, so 1b, 7c and 8 are labels and not gaps — 5 through 7b are the gates,
   which write nothing:

     1. Strips CSS comments.  main.css is 41.7% comments and render-blocking
        on every page that loads it — which is nearly all of them. Saves
        roughly 44 KB raw / 12 KB brotli off the critical path. (It said
        "all 89 pages" until the output check started reporting 109.)
     1b. Strips JS comments from the two every-page scripts written in the
        same house style: boot.js (synchronous in every <head>, ~59%
        comments) and particle-bg.js (deferred on every page, ~41%). Same
        rationale, same verify-then-write stance — see the JS scanner below
        for why its lexer is longer than the CSS one.
     2. Rewrites sitemap.xml <lastmod> per file from git — the date of the
        newest commit that touched that file — instead of the one hardcoded
        date every URL currently shares. There is NO size-based filter. One
        lived here: it discarded any commit touching more than twenty files,
        so that a footer-link sweep could not reset every page's date. This
        repository's ordinary commits touch 48, 57 and 146 files, so that
        filter threw away nearly the whole history and 94 of 100 URLs fell
        back to the stale hardcoded date — the failure it was written to
        prevent, only harder to see. It is gone and does not come back; the
        measurements are recorded at lastCommitDate(). Exactly one commit is
        still skipped, and by shape rather than by size: in a clone that is
        STILL shallow after the unshallow fetch, the oldest fetched commit has
        had its parent cut off, so git diffs it against the empty tree and
        reports the entire repository as added by it. With a complete history
        there is no such boundary and nothing is skipped at all.
     3. Rebuilds assets/data/search-index.json from the pages, so the search
        box can never describe content the site no longer has. See
        scripts/search-index.js for why that stopped being a manual step.
     4. Rewrites the page counts quoted in llms.txt and llms-full.txt from the
        index it just built, for the same reason every figure on the colophon
        is counted rather than typed — the committed values had drifted to 88
        pages in a repository that held 95.
     7c. Rewrites VENDOR_FINGERPRINT in sw.js to a digest of everything under
        assets/vendor that a browser actually fetches (attribution files are
        excluded on purpose — the reason is at doVendorPairing), and sw.js
        derives its runtime cache name from that constant. It carries the
        number of the section that does it because it was born as one of the
        gates and stopped being one: it used to fail the deploy and ask for
        two constants to be edited by hand. It still throws, but only over
        sw.js ceasing to derive CACHE from the fingerprint.
     8. Rewrites the figures in colophon.html — every <span data-colophon>,
        counted rather than typed — which is why it is numbered for the output
        check: it runs from inside it, once the page count it publishes has
        been established.

   It then checks its own output — critical files present, above a size floor,
   enough HTML pages on disk, every JSON-LD block parseable, the sitemap and
   the pages agreeing about what exists, the static header/footer each page
   ships matching the partials they get swapped for, and sw.js's offline
   precache list covering what the doc-maker pages actually load — and throws
   if anything looks wrong. Vercel keeps serving the previous deployment when
   a build exits non-zero, so failing the deploy is always safer than
   publishing the damage. Every step reports what it did, so a deploy log
   shows the numbers.

   `node scripts/build.js --check` IS SAFE ANYWHERE: it writes no file and
   only prints what would happen. One caveat, stated because a "no side
   effects" promise with an asterisk is worse than no promise: on a shallow
   clone it still runs the unshallow fetch described at deepenHistory(), which
   writes to .git and can take up to two minutes. Nothing in the working tree
   is touched and no commit you have is lost — the repository only gains the
   history it was cloned without. A bare `node scripts/build.js` is meant for
   the Vercel container and REWRITES THE WORKING TREE — it strips the
   comments out of the committed CSS/JS (the documentation this header calls
   the most valuable in the codebase) and rewrites the sitemap, search index,
   llms counts, sw.js's vendor fingerprint and colophon. After an accidental local run, `git checkout --`
   the touched files; uncommitted edits to them are lost. It is idempotent —
   a second run finds no comments left and writes the same bytes back — and
   every write is gated on the parsed rule list coming out unchanged, so a
   bug in a scanner throws rather than shipping a broken file.

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
  /* The document-maker labs. Each carries its own stylesheet because the two
     tools are siblings, not twins — shared rules would couple five resume
     templates to five biodata templates for the sake of a few bytes. */
  'assets/css/resume-maker.css',
  'assets/css/biodata-maker.css',
  /* The greeting pages, added late because they were written after this list
     and nobody came back to it — which is exactly the drift the comment above
     warns about. celebrate.css is the ONLY stylesheet /birthday and /festival
     load, so until it landed here those two pages were the only ones on the
     site whose entire render-blocking CSS shipped with every comment intact,
     and the only ones no brace-balance check ever looked at. */
  'assets/css/celebrate.css',
  'assets/css/wish-generator.css',
];

/* The two scripts every page pays for, written in the same comment-heavy
   house style as the CSS. boot.js loads synchronously in every <head> —
   ahead of the stylesheet — and particle-bg.js is deferred on every page.
   Other first-party JS is fetched per page and stays readable on the wire;
   these two are the ones whose comment bytes are a sitewide tax. */
const JS_FILES = [
  'assets/js/boot.js',
  'assets/js/particle-bg.js',
];

let totalBefore = 0;
let totalAfter = 0;
let totalJsBefore = 0;
let totalJsAfter = 0;

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
   1b. JS comments
   --------------------------------------------------------------------------
   Same trade as the CSS pass — the comments are documentation for the repo
   and dead weight on the wire — but JS needs a longer lexer than CSS before
   a comment can be believed: 'https://example' must not open a line comment,
   a / after `return` is a regex while a / after a value is division, and a
   template literal can hold real code inside ${}. Regex-vs-division is
   decided the way an engine's lexer does it, from the previous significant
   token; the one ambiguity this scanner refuses to guess (a / straight after
   `)` `]` `}` or an identifier) falls back to "division", and if that guess
   is ever wrong the output stops parsing — which the guardrails below turn
   into a refused write and a failed deploy, never a broken script. Vercel
   answers a failed build by keeping the previous deployment live.
   -------------------------------------------------------------------------- */
function stripJsComments(src) {
  const KEYWORD = /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/;
  let out = '';
  let i = 0;
  let mode = 'code';          // code | squote | dquote | template | regex | regexclass
  const tplDepth = [];        // one brace counter per ${ } we are inside
  let lastSig = '';           // last significant char emitted in code mode
  let lastWord = '';          // trailing identifier, so `return /re/` lexes as a regex

  function regexCanStart() {
    if (lastSig === '') return true;                      // start of file
    if (/[A-Za-z0-9_$]/.test(lastSig)) return KEYWORD.test(lastWord);
    return '(,=:[!&|?;{+-*%<>~^'.indexOf(lastSig) !== -1;
  }

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];

    if (mode === 'squote' || mode === 'dquote') {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if ((mode === 'squote' && c === "'") || (mode === 'dquote' && c === '"')) {
        mode = 'code'; lastSig = ')'; lastWord = '';      // a closed string is a value
      }
      i += 1;
      continue;
    }

    if (mode === 'template') {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === '$' && n === '{') { out += '{'; i += 2; tplDepth.push(0); mode = 'code'; lastSig = '{'; lastWord = ''; continue; }
      if (c === '`') { mode = 'code'; lastSig = ')'; lastWord = ''; }
      i += 1;
      continue;
    }

    if (mode === 'regex') {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === '[') { mode = 'regexclass'; i += 1; continue; }
      if (c === '/') { mode = 'code'; lastSig = ')'; lastWord = ''; }
      i += 1;
      continue;
    }
    if (mode === 'regexclass') {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === ']') mode = 'regex';
      i += 1;
      continue;
    }

    /* code */
    if (c === '/' && n === '/') {
      let end = src.indexOf('\n', i + 2);
      if (end === -1) end = src.length;
      // Same line-tidying as the CSS pass: a comment alone on its line takes
      // the line with it; a trailing comment leaves the code and its newline.
      const lineStart = out.lastIndexOf('\n') + 1;
      if (out.slice(lineStart).trim() === '') {
        out = out.slice(0, lineStart);
        i = end < src.length ? end + 1 : end;
      } else {
        i = end;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;            // unterminated: drop the remainder
      i = end + 2;
      const lineStart = out.lastIndexOf('\n') + 1;
      if (out.slice(lineStart).trim() === '') {
        out = out.slice(0, lineStart);
        while (src[i] === ' ' || src[i] === '\t') i += 1;
        if (src[i] === '\r') i += 1;
        if (src[i] === '\n') i += 1;
      }
      continue;
    }
    if (c === '/' && regexCanStart()) { mode = 'regex'; out += c; i += 1; continue; }
    if (c === "'") { mode = 'squote'; out += c; i += 1; continue; }
    if (c === '"') { mode = 'dquote'; out += c; i += 1; continue; }
    if (c === '`') { mode = 'template'; out += c; i += 1; continue; }
    if (c === '}' && tplDepth.length) {
      if (tplDepth[tplDepth.length - 1] === 0) { tplDepth.pop(); mode = 'template'; out += c; i += 1; continue; }
      tplDepth[tplDepth.length - 1] -= 1;
    } else if (c === '{' && tplDepth.length) {
      tplDepth[tplDepth.length - 1] += 1;
    }

    out += c;
    if (!/\s/.test(c)) {
      lastSig = c;
      lastWord = /[A-Za-z0-9_$]/.test(c) ? lastWord + c : '';
    }
    i += 1;
  }

  // No blank-line collapse here, unlike the CSS pass: a global regex could
  // reach inside a template literal and change string content. The per-
  // comment line tidying above already prevents stacked blanks.
  return out;
}

function doJs() {
  log('');
  log('JS comment stripping');
  const vm = require('vm');
  for (const rel of JS_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      log('  SKIP  ' + rel + ' (not found)');
      continue;
    }
    const src = fs.readFileSync(abs, 'utf8');

    // A file the engine cannot parse is a file this scanner has no business
    // rewriting — skip it loudly rather than guess.
    try { new vm.Script(src, { filename: rel }); }
    catch (e) { log('  SKIP  ' + rel + ' (does not parse: ' + e.message + ')'); continue; }

    const out = stripJsComments(src);

    // Guardrails, same stance as the CSS pass: any trip throws, the write is
    // refused, and the deploy fails instead of shipping a broken script.
    try { new vm.Script(out, { filename: rel }); }
    catch (e) {
      throw new Error(rel + ': stripped output no longer parses (' + e.message + ') — refusing to write');
    }
    if (stripJsComments(out) !== out) {
      throw new Error(rel + ': strip is not idempotent — refusing to write');
    }
    if (out.length > src.length) {
      throw new Error(rel + ': output grew — refusing to write');
    }

    totalJsBefore += src.length;
    totalJsAfter += out.length;
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
function urlToFile(loc, root) {
  root = root || ROOT;   // overridable so the parity gate can be tested on a scratch tree
  let p = loc.replace(/^https?:\/\/[^/]+/, '');
  p = p.split('?')[0].split('#')[0];
  if (p === '' || p === '/') return 'index.html';
  p = p.replace(/^\//, '').replace(/\/$/, '');
  const candidates = [p, p + '.html', path.join(p, 'index.html')];
  for (const c of candidates) {
    /* isFile, not exists. /blog and /labs are real DIRECTORIES on disk, so the
       first candidate satisfied a bare existence test and this returned "blog"
       — a path no commit has ever touched, which is why those two URLs were
       the last ones git could not date. The page behind them is the third
       candidate. Every other caller only asks whether the URL resolves at all,
       so they see no change. */
    const abs = path.join(root, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
  }
  return null;
}

/* Vercel clones this repository shallow, so out of the box `git log` sees the
   handful of commits it fetched and `rev-list --count HEAD` reports the fetch
   depth rather than the history. Two things on this page want the real answer
   — the sitemap's per-file dates and the colophon's commit count — so ask for
   it once, here, and let both read the result.

   A blobless unshallow is the cheap way to ask: it downloads every commit and
   tree but no file contents, which is all either caller needs. It is allowed
   to fail — a container with no network, no credentials, or a remote that
   refuses partial clones is not a reason to fail a deploy — so callers get a
   state back and degrade on their own terms rather than getting an exception.

   THIS IS THE ONE THING --check DOES THAT IS NOT READ-ONLY, and it runs there
   deliberately. The fetch writes to .git — never to the working tree — and can
   spend up to two minutes doing it. Gating it behind !CHECK was the obvious
   alternative and it is the wrong one: --check exists to print the numbers the
   real build would publish, and a --check that skips the deepening prints a
   commit count and a set of sitemap dates the real build would never produce,
   which is a more expensive lie than a slow preflight. So the fetch stays and
   the banner says so. */
let historyState = null;

function git(args, extra) {
  return execFileSync('git', args,
    Object.assign({ cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }, extra || {}));
}

function isShallow() {
  return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
}

function deepenHistory() {
  if (historyState) return historyState;
  try {
    if (!isShallow()) return (historyState = 'complete');
  } catch (e) {
    return (historyState = 'nogit');
  }
  /* --filter=blob:none first because it is a fraction of the bytes; not every
     remote serves partial clones, so a plain --unshallow is the retry. The
     timeout is the point of the whole guard — a build that hangs on a fetch
     is worse than a build that publishes a coarser number. */
  const attempts = [
    ['fetch', '--unshallow', '--filter=blob:none', '--quiet'],
    ['fetch', '--unshallow', '--quiet'],
  ];
  /* The probe is deliberately OUTSIDE the fetch's own try. `git fetch
     --unshallow` can deepen the history and STILL exit non-zero — a tag it
     could not update, a partial-clone capability the remote half-honours —
     and while the two shared a try block that throw jumped straight past the
     probe, so this reported 'shallow' for a repository it had just finished
     unshallowing. Neither caller could tell: the colophon published the '+'
     floor instead of the exact count git could now prove, and the sitemap
     went on skipping a grafted boundary commit the fetch had already
     repaired. Ask git what the repository looks like now rather than
     inferring it from an exit status; it already knows. */
  for (const args of attempts) {
    try {
      git(args, { timeout: 60000 });
    } catch (e) { /* may still have deepened the history — the probe decides */ }
    try {
      if (!isShallow()) return (historyState = 'deepened');
    } catch (e) { /* no answer from git: try the next form, then give up */ }
  }
  return (historyState = 'shallow');
}

/* A file is dated by the newest commit that touched it — the same answer
   `git log -1 --format=%cs -- <file>` gives, computed in one pass because one
   `git log` beats a hundred git invocations.

   This used to also discard any commit touching more than twenty files, on the
   theory that a footer-link sweep should not reset every page's <lastmod>. The
   theory was right and the threshold was wrong: this repository's ordinary
   commits touch 48, 57 and 146 files, so the filter threw away nearly every
   commit in the history and 94 of 100 URLs fell back to one stale hardcoded
   date — the exact "lastmod that moves in blankets" the filter was written to
   prevent, only harder to see from the outside. A date that is coarser than
   you would like still beats a date that is wrong, so the heuristic is gone;
   the one commit that really does lie about what it touched is handled below,
   by name rather than by size. */
let fileDates = null;

function lastCommitDate(file) {
  if (fileDates === null) {
    fileDates = {};
    /* The one commit whose file list cannot be believed: in a clone that is
       still shallow, the oldest fetched commit has had its parent cut off, so
       git diffs it against the empty tree and --name-only reports the ENTIRE
       repository as added by it. Taking that at face value dates every URL in
       the sitemap to the same day — a lastmod that moves in blankets, which is
       the one outcome worse than a stale one. A parentless commit is that
       boundary, so skip it. With a complete history there is no boundary and
       nothing is skipped, so the real root commit still dates the handful of
       files nothing has touched since. */
    const truncated = deepenHistory() === 'shallow';
    try {
      // One `git log` for the whole history instead of one per file:
      // \x01-separated blocks of "date and parents, then the files touched".
      const raw = execFileSync('git', ['log', '--format=%x01%cs%x02%p', '--name-only'],
                               { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      for (const block of raw.split('\x01')) {
        const lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!lines.length) continue;
        const head = lines.shift().split('\x02');
        const date = head[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (truncated && !head[1]) continue;               // the grafted boundary
        for (const f of lines) {
          if (!(f in fileDates)) fileDates[f] = date;      // log is newest-first
        }
      }
    } catch (e) {
      /* shallow clone with no usable history, or git unavailable:
         the map stays empty and every entry keeps its committed date */
    }
  }
  return fileDates[file.split(path.sep).join('/')] || null;
}

function doSitemap() {
  log('');
  log('sitemap lastmod');
  const abs = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(abs)) { log('  SKIP  sitemap.xml (not found)'); return; }

  // A deploy clone starts with only the last handful of commits, so `git log`
  // cannot see far enough back to date most files. deepenHistory() fixes that
  // where it can; where it cannot, the undateable entries keep the date they
  // already carry, which is the correct fallback — but a partial result that
  // looks like a complete one is worth one line of log.
  const history = deepenHistory();
  if (history === 'deepened') {
    log('  NOTE  shallow clone unshallowed, so every file can be dated from');
    log('        its own history.');
  } else if (history !== 'complete') {
    log('  NOTE  ' + (history === 'nogit' ? 'no git here' : 'shallow clone and the unshallow fetch failed') +
        ': only files touched in the');
    log('        fetched history can be dated. The rest keep their <lastmod>.');
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
  // The return value carries the freshly computed page count, which is the
  // number the llms rewrite below wants — fresh in --check mode too, since
  // buildIndex always regenerates in memory and only gates the write.
  return buildIndex({ check: CHECK, log: log });
}

/* --------------------------------------------------------------------------
   4. llms.txt / llms-full.txt page counts
   --------------------------------------------------------------------------
   Both files quote how many pages the search index covers and how many of
   them are labs. Those numbers were hand-typed, and hand-typed numbers drift:
   by the time this ran for the first time both files still said 88 pages and
   58 labs against a repository holding 95 and 62. Same cure as the colophon —
   the prose stays hand-written, the figures inside it get rewritten from what
   the build just counted. The committed values are the last deploy's, so the
   repo copy is right until the next page lands, at which point the next
   deploy corrects it without anyone remembering to.

   The patterns anchor on the surrounding words, not the number, so a future
   rewording of either sentence simply stops matching — that is reported as a
   NOTE rather than an error, because a sentence that no longer quotes a
   count cannot be wrong about it.
   -------------------------------------------------------------------------- */
const LLMS_COUNT_RULES = [
  ['llms.txt', [
    [/(prebuilt index of all )\d+( pages)/, 'pages'],
    [/(The )\d+( lab pages)/, 'labs'],
  ]],
  ['llms-full.txt', [
    [/(index covering all )\d+( pages)/, 'pages'],
  ]],
];

/* How many labs there actually are, i.e. how many cards the hub lists: 62.

   TWO files under labs/ are not labs and both have to come off the count.
   `index.html` is the hub itself — it lists the labs, it is not one of them —
   and `hacklab-guestbook.html` is the sandboxed document loaded inside
   HackLab's iframe, which is noindex and reachable from nowhere.

   This used to drop only the guestbook and published 63, while colophonFacts()
   below dropped only the hub and also published 63. Each had exactly half the
   filter, so the two disagreed with the hub and agreed with each other, which
   is the hardest kind of wrong number to notice. There is now one definition
   and colophonFacts() calls it. */
const NON_LAB_FILES = new Set(['index.html', 'hacklab-guestbook.html']);

function labPageCount(root) {
  return walkFiles(path.join(root, 'labs'), (f) => f.endsWith('.html'))
    .filter((f) => !NON_LAB_FILES.has(path.basename(f))).length;
}

function doLlmsCounts(indexStats, root) {
  root = root || ROOT;
  log('');
  log('llms page counts');
  const facts = {
    pages: String(indexStats.pages),
    labs: String(labPageCount(root)),
  };
  for (const [rel, rules] of LLMS_COUNT_RULES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) { log('  SKIP  ' + rel + ' (not found)'); continue; }
    const src = fs.readFileSync(abs, 'utf8');
    let out = src;
    let missing = 0;
    for (const [re, key] of rules) {
      if (!re.test(out)) { missing += 1; continue; }
      out = out.replace(re, '$1' + facts[key] + '$2');
    }
    const state = out === src ? 'already current'
      : (CHECK ? 'would update' : 'updated');
    log('  ' + rel.padEnd(14) + state +
        ' (' + facts.pages + ' pages, ' + facts.labs + ' labs)' +
        (missing ? '   NOTE: ' + missing + ' count phrase(s) no longer present' : ''));
    if (!CHECK && out !== src) fs.writeFileSync(abs, out);
  }
}

/* --------------------------------------------------------------------------
   5. JSON-LD gate
   --------------------------------------------------------------------------
   The structured data blocks are the one place this site allows an inline
   <script>, and nothing on the page exercises them — a JSON-LD block with a
   stray trailing comma renders identically to a valid one, and the only
   party that ever parses it is a crawler that silently drops it. So the
   build parses every block on every page, exactly the way a crawler would,
   and a block that does not parse fails the deploy with the file named.

   HTML comments are stripped first, so a deliberately commented-out block is
   dead text rather than a false alarm — the same reason the CSS scanner
   tracks strings before believing it found a comment.
   -------------------------------------------------------------------------- */
function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, ' ');
}

function jsonLdErrors(html) {
  const errors = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const src = stripHtmlComments(html);
  let m;
  let blocks = 0;
  while ((m = re.exec(src)) !== null) {
    blocks += 1;
    try { JSON.parse(m[1]); }
    catch (e) { errors.push('ld+json block ' + blocks + ' does not parse: ' + e.message); }
  }
  return { blocks: blocks, errors: errors };
}

function listHtmlPages(root) {
  return walkFiles(root, (f) => f.endsWith('.html'))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
}

function doJsonLd(root) {
  root = root || ROOT;   // overridable for the same testing reason as urlToFile
  log('');
  log('JSON-LD gate');
  const problems = [];
  let pages = 0;
  let blocks = 0;
  for (const rel of listHtmlPages(root)) {
    if (rel.startsWith('partials/')) continue;   // fragments, not pages
    pages += 1;
    const res = jsonLdErrors(fs.readFileSync(path.join(root, rel), 'utf8'));
    blocks += res.blocks;
    for (const e of res.errors) problems.push(rel + ': ' + e);
  }
  if (problems.length) {
    log('  FAILED:');
    problems.forEach((p) => log('    - ' + p));
    throw new Error('JSON-LD gate: ' + problems.length + ' invalid block(s) — refusing to publish');
  }
  log('  ' + blocks + ' blocks across ' + pages + ' pages, all parse');
}

/* --------------------------------------------------------------------------
   6. Sitemap parity gate
   --------------------------------------------------------------------------
   Two failure modes, both silent in production: a new page that never made it
   into sitemap.xml simply is not surfaced to crawlers, and a sitemap entry
   whose page was deleted has crawlers requesting 404s under the site's name.
   So the two lists are held equal — every indexable page must have a <loc>,
   and every <loc> must resolve to a real file (the same resolver the
   <lastmod> rewrite uses, which is also what lets the two llms .txt entries
   through: they are in the sitemap on purpose and they exist on disk).

   NOINDEX_PAGES is the documented exception list, and it should stay short:
   the error page, the three easter eggs reached deliberately rather than
   found, the sandboxed guestbook document, and the Search Console token.
   partials/ are excluded wholesale because they are fragments, not pages.
   -------------------------------------------------------------------------- */
const NOINDEX_PAGES = new Set([
  '404.html',
  'teapot.html',
  'terminal.html',
  'einstein.html',
  // The two wish cards. They have no content of their own — everything on
  // them arrives in the query string — so a crawled copy shows no name at
  // all, and indexing them would put three pages in front of the same query.
  // The tool that BUILDS them, /labs/wish-generator, is indexed instead.
  'birthday.html',
  'festival.html',
  'labs/hacklab-guestbook.html',
  'google46d0a7ad3f01b5a6.html',
  'offline.html',   // the SW's navigation fallback — reachable only offline
]);

function fileToUrl(rel) {
  if (rel === 'index.html') return '/';
  return '/' + rel.replace(/\.html$/, '').replace(/\/index$/, '');
}

function doSitemapParity(root) {
  root = root || ROOT;
  log('');
  log('sitemap parity gate');
  const abs = path.join(root, 'sitemap.xml');
  if (!fs.existsSync(abs)) throw new Error('sitemap parity: sitemap.xml is missing');
  const src = fs.readFileSync(abs, 'utf8');

  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(src)) !== null) locs.push(m[1].trim());

  // Normalise a <loc> to the URL path the pages map to, tolerating a
  // trailing slash — /labs/ and /labs are the same entry, not a mismatch.
  const locPaths = new Set(locs.map((l) => {
    let p = l.replace(/^https?:\/\/[^/]+/, '');
    if (p === '') p = '/';
    if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  }));

  const problems = [];
  const indexable = listHtmlPages(root)
    .filter((rel) => !rel.startsWith('partials/') && !NOINDEX_PAGES.has(rel));
  for (const rel of indexable) {
    if (!locPaths.has(fileToUrl(rel))) {
      problems.push('page not in sitemap.xml: ' + fileToUrl(rel) + '  (' + rel + ')');
    }
  }
  for (const loc of locs) {
    if (!urlToFile(loc, root)) {
      problems.push('sitemap <loc> has no file behind it: ' + loc);
    }
  }

  if (problems.length) {
    log('  FAILED:');
    problems.forEach((p) => log('    - ' + p));
    throw new Error('sitemap parity gate: ' + problems.length + ' mismatch(es) — refusing to publish');
  }
  log('  ' + indexable.length + ' indexable pages all listed, ' + locs.length + ' sitemap URLs all resolve');
}

/* --------------------------------------------------------------------------
   7. Static chrome gate
   --------------------------------------------------------------------------
   Every page ships a complete static copy of the header nav and footer so
   there is something real at first paint, and include-partials.js swaps it
   for the canonical version in partials/ once JavaScript arrives. The README
   asks for the static copies to be kept in sync by hand, which is the same
   promise the search index used to run on, and it will break the same way:
   a link added to the partial but not to 97 static copies is invisible
   exactly to the people browsing without JavaScript — the ones the static
   copy exists for.

   The comparison is the ordered href lists, not the markup: the static
   header legitimately lacks the hamburger and the More dropdown (both are
   JS-only, dead weight without it), and the active-link class differs per
   page by design. What must agree is which links exist and in what order.
   Pages outside CHROMELESS that carry no chrome at all fail the gate too —
   a page that lost its static header is damage, not a new exclusion.
   -------------------------------------------------------------------------- */
const CHROMELESS = new Set([
  'teapot.html',                  // full-screen easter egg, no navigation by design
  'terminal.html',                // ditto
  'birthday.html',                // a card somebody was sent; a nav bar would make it a website
  'festival.html',                // ditto
  'labs/hacklab-guestbook.html',  // sandboxed document inside HackLab's iframe
  'google46d0a7ad3f01b5a6.html',  // Search Console token, never rendered
  'offline.html',                 // self-contained by design: it must render with zero network
]);

function navHrefs(html) {
  const src = stripHtmlComments(html);
  const m = src.match(/<header[^>]*class="[^"]*site-header[^"]*"[^>]*>[\s\S]*?<\/header>/);
  if (!m) return null;
  return Array.from(m[0].matchAll(/<a[^>]*class="[^"]*nav-link[^"]*"[^>]*>/g))
    .map((a) => ((a[0].match(/href\s*=\s*"([^"]*)"/) || [])[1] || '').trim());
}

function footerColHrefs(html) {
  const src = stripHtmlComments(html);
  const m = src.match(/<footer[\s\S]*?<\/footer>/);
  if (!m) return null;
  const out = [];
  // The three .footer-col columns hold only headings and links, so the first
  // closing </nav> or </div> after each opener really is the column's end.
  for (const col of m[0].matchAll(/class="footer-col"[^>]*>[\s\S]*?<\/(?:nav|div)>/g)) {
    for (const a of col[0].matchAll(/<a\s[^>]*href\s*=\s*"([^"]*)"/g)) out.push(a[1].trim());
  }
  return out;
}

/* The three footer regions the column check above does not reach, plus the
   header brand link. All of them are duplicated statically into every page,
   so before these were gated a rename of /refund in the partial would have
   left ~99 stale no-JS copies without failing the build — exactly the drift
   this gate's own comment warns about. Neither .footer-cta-group nor
   .footer-bottom contains a nested <div>, so the first </div> really closes
   the region. */
function footerCtaHrefs(html) {
  const src = stripHtmlComments(html);
  const m = src.match(/class="footer-cta-group"[^>]*>[\s\S]*?<\/div>/);
  if (!m) return null;
  return Array.from(m[0].matchAll(/<a\s[^>]*href\s*=\s*"([^"]*)"/g)).map((a) => a[1].trim());
}

function footerBottomHrefs(html) {
  const src = stripHtmlComments(html);
  const m = src.match(/class="footer-bottom"[^>]*>[\s\S]*?<\/div>/);
  if (!m) return null;
  return Array.from(m[0].matchAll(/<a\s[^>]*href\s*=\s*"([^"]*)"/g)).map((a) => a[1].trim());
}

function brandHref(html) {
  const src = stripHtmlComments(html);
  const m = src.match(/<header[^>]*class="[^"]*site-header[^"]*"[^>]*>[\s\S]*?<\/header>/);
  if (!m) return null;
  const a = m[0].match(/<a[^>]*class="[^"]*brand[^"]*"[^>]*href\s*=\s*"([^"]*)"/) ||
            m[0].match(/<a[^>]*href\s*=\s*"([^"]*)"[^>]*class="[^"]*brand[^"]*"/);
  return a ? a[1].trim() : null;
}

function doChromeParity(root) {
  root = root || ROOT;
  log('');
  log('static chrome gate');
  const readRel = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const headerPartial = readRel('partials/header.html');
  const footerPartial = readRel('partials/footer.html');
  const canonNav = navHrefs(headerPartial);
  const canonFooter = footerColHrefs(footerPartial);
  const canonCta = footerCtaHrefs(footerPartial);
  const canonBottom = footerBottomHrefs(footerPartial);
  const canonBrand = brandHref(headerPartial);
  if (!canonNav || !canonNav.length || !canonFooter || !canonFooter.length ||
      !canonCta || !canonCta.length || !canonBottom || !canonBottom.length || !canonBrand) {
    throw new Error('static chrome gate: could not read link lists out of partials/ — refusing to publish');
  }

  const problems = [];
  let matched = 0;
  for (const rel of listHtmlPages(root)) {
    if (rel.startsWith('partials/') || CHROMELESS.has(rel)) continue;
    const html = readRel(rel);
    const nav = navHrefs(html);
    const foot = footerColHrefs(html);
    const cta = footerCtaHrefs(html);
    const bottom = footerBottomHrefs(html);
    const brand = brandHref(html);
    if (!nav) { problems.push(rel + ': no static header nav found'); continue; }
    if (!foot || !foot.length) { problems.push(rel + ': no static footer columns found'); continue; }
    if (!cta || !cta.length) { problems.push(rel + ': no static footer CTA group found'); continue; }
    if (!bottom || !bottom.length) { problems.push(rel + ': no static footer bottom row found'); continue; }
    const navOk = nav.join('\n') === canonNav.join('\n');
    const footOk = foot.join('\n') === canonFooter.join('\n');
    const ctaOk = cta.join('\n') === canonCta.join('\n');
    const bottomOk = bottom.join('\n') === canonBottom.join('\n');
    const brandOk = brand === canonBrand;
    if (navOk && footOk && ctaOk && bottomOk && brandOk) { matched += 1; continue; }
    if (!navOk) {
      problems.push(rel + ': static header nav drifted from partials/header.html\n' +
                    '        partial: ' + canonNav.join(' ') + '\n' +
                    '        page:    ' + nav.join(' '));
    }
    if (!footOk) {
      problems.push(rel + ': static footer links drifted from partials/footer.html' +
                    ' (' + canonFooter.length + ' links expected, ' + foot.length + ' found)');
    }
    if (!ctaOk) {
      problems.push(rel + ': static footer CTA links drifted from partials/footer.html\n' +
                    '        partial: ' + canonCta.join(' ') + '\n' +
                    '        page:    ' + cta.join(' '));
    }
    if (!bottomOk) {
      problems.push(rel + ': static footer bottom links drifted from partials/footer.html\n' +
                    '        partial: ' + canonBottom.join(' ') + '\n' +
                    '        page:    ' + bottom.join(' '));
    }
    if (!brandOk) {
      problems.push(rel + ': header brand link is "' + brand + '", partial says "' + canonBrand + '"');
    }
  }

  if (problems.length) {
    log('  FAILED:');
    problems.forEach((p) => log('    - ' + p));
    throw new Error('static chrome gate: ' + problems.length + ' page(s) drifted — refusing to publish');
  }
  log('  ' + matched + ' pages match partials/ (' + canonNav.length + ' nav links, ' +
      canonFooter.length + ' footer links, ' + canonCta.length + ' CTA links, ' +
      canonBottom.length + ' bottom links, brand)');
}

/* --------------------------------------------------------------------------
   7b. Service-worker precache gate
   --------------------------------------------------------------------------
   sw.js promises the resume maker and the biodata maker work offline, backed
   by DOC_URLS — a hand-enumerated file list whose own comment admits the
   failure mode: "if a page grows a new stylesheet or script, it must be
   added here or offline quietly breaks." That is the identical hand-sync
   promise the search index and the llms counts used to run on, and it broke
   the identical way. So the list is now held to the pages: every stylesheet
   and script the two documents load must appear in DOC_URLS (as the clean
   URL the browser actually requests), and every DOC_URLS entry must resolve
   to a real file. Extra precached entries (icons, partials, /offline) are
   fine — the gate only refuses a page dependency the list is missing.
   -------------------------------------------------------------------------- */
const SW_PRECACHED_PAGES = [
  'labs/resume-maker.html',
  'labs/biodata-maker.html',
  'labs/wish-generator.html',
  'birthday.html',
  'festival.html',
];

function pageAssetUrls(html) {
  const src = stripHtmlComments(html);
  const urls = [];
  for (const tag of src.matchAll(/<link\s[^>]*>/g)) {
    if (!/rel\s*=\s*"stylesheet"/.test(tag[0])) continue;
    const href = tag[0].match(/href\s*=\s*"([^"]*)"/);
    if (href) urls.push(href[1]);
  }
  for (const tag of src.matchAll(/<script\s[^>]*src\s*=\s*"([^"]*)"[^>]*>/g)) {
    urls.push(tag[1]);
  }
  return urls.map((u) => u.split('?')[0].split('#')[0]).filter((u) => u.startsWith('/'));
}

function doSwPrecacheParity(root) {
  root = root || ROOT;
  log('');
  log('sw precache gate');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const arr = sw.match(/var DOC_URLS = \[([\s\S]*?)\];/);
  if (!arr) throw new Error('sw precache gate: could not find DOC_URLS in sw.js — refusing to publish');
  // Comments between the entries can contain apostrophes ("the browser's…"),
  // which a bare quote-scan would read as string delimiters — so the array
  // text goes through the JS comment stripper before the entries are read.
  const listed = new Set(Array.from(stripJsComments(arr[1]).matchAll(/'([^']+)'/g)).map((m) => m[1]));

  const problems = [];
  let covered = 0;
  for (const rel of SW_PRECACHED_PAGES) {
    const pageUrl = fileToUrl(rel);
    if (!listed.has(pageUrl)) problems.push('sw.js DOC_URLS is missing the page itself: ' + pageUrl);
    for (const u of pageAssetUrls(fs.readFileSync(path.join(root, rel), 'utf8'))) {
      if (listed.has(u)) { covered += 1; continue; }
      problems.push(rel + ' loads ' + u + ' but sw.js DOC_URLS does not precache it — offline would quietly break');
    }
  }
  for (const u of listed) {
    if (!urlToFile(u, root)) problems.push('sw.js DOC_URLS entry has no file behind it: ' + u);
  }

  if (problems.length) {
    log('  FAILED:');
    problems.forEach((p) => log('    - ' + p));
    throw new Error('sw precache gate: ' + problems.length + ' mismatch(es) — refusing to publish');
  }
  log('  ' + covered + ' page assets all precached, ' + listed.size + ' DOC_URLS entries all resolve');
}

/* --------------------------------------------------------------------------
   7c. Vendor fingerprint
   --------------------------------------------------------------------------
   sw.js serves /assets/vendor/ cache-first, while the vendor URLs carry no
   version and ship with a one-year immutable Cache-Control. Nothing used to
   pair the two: replace a runtime file in place, forget to bump the cache
   name, and every returning visitor kept the old bytes with no expiry.

   This was a gate that failed the deploy and told you to edit two constants by
   hand. It now just does the edit: the digest is written into sw.js, and sw.js
   derives CACHE from it, so the cache name changes exactly when the vendor
   bytes change and never otherwise. A promise that cannot be forgotten beats a
   reminder to keep it — and the hand-edit had already been got wrong once, by
   being generated on a CRLF checkout where the hash meant nothing.

   The one thing still worth refusing to publish over is sw.js quietly ceasing
   to derive CACHE from the fingerprint: that would leave this function
   rewriting a constant nobody reads, which is the original bug wearing a hash.
   Hashing the ~150 MB tree costs a couple of seconds of build time.
   -------------------------------------------------------------------------- */
function doVendorPairing(root) {
  root = root || ROOT;
  log('');
  log('vendor fingerprint');
  const dir = path.join(root, 'assets/vendor');
  if (!fs.existsSync(dir)) { log('  SKIP  assets/vendor (not found)'); return; }

  const crypto = require('crypto');
  /* Attribution files are deliberately outside the fingerprint. The digest
     exists to name the runtime cache, so it must move only when a byte the
     browser actually fetches moves. LICENSE, NOTICE, COPYING and README files
     ship for legal reasons and are never requested by a lab, so folding them
     in would evict every visitor's 151 MB of cached WebAssembly to publish a
     copyright notice — the precise cost this fingerprint exists to avoid. */
  const isAttribution = (f) =>
    /(^|[\\/])(LICENSE|NOTICE|COPYING|README)[^\\/]*$/i.test(f);
  const files = walkFiles(dir, (f) => !isAttribution(f))
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  const h = crypto.createHash('sha256');
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(root, rel)));
  }
  const digest = h.digest('hex').slice(0, 16);

  const abs = path.join(root, 'sw.js');
  const sw = fs.readFileSync(abs, 'utf8');
  const m = sw.match(/var VENDOR_FINGERPRINT = '([^']*)'/);
  if (!m) throw new Error('vendor fingerprint: sw.js has no VENDOR_FINGERPRINT — refusing to publish');

  /* The derivation is the entire mechanism. If CACHE is ever hard-coded again,
     rewriting the fingerprint below would silently stop invalidating anything. */
  if (sw.indexOf("var CACHE = 'lab-runtimes-' + VENDOR_FINGERPRINT;") === -1) {
    throw new Error('vendor fingerprint: sw.js no longer derives CACHE from ' +
                    'VENDOR_FINGERPRINT — the runtime cache would never ' +
                    'invalidate. Refusing to publish.');
  }

  if (m[1] === digest) {
    log('  ' + files.length + ' files, ' + digest + ' unchanged');
    return;
  }

  if (!CHECK) fs.writeFileSync(abs, sw.replace(m[0], "var VENDOR_FINGERPRINT = '" + digest + "'"));
  log('  ' + files.length + ' files, ' + m[1] + ' -> ' + digest);
  log('  ' + (CHECK ? 'would name' : 'named') + ' the runtime cache lab-runtimes-' + digest);
  log('  returning visitors refill on their next visit to a lab that uses it');
}

/* --------------------------------------------------------------------------
   8. Output check
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
  ['offline.html', 800, '</html>'],
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

/* `committed` is the current colophon.html source. Only the commit count reads
   it, and only when git cannot be made to tell the truth — see below. */
function colophonFacts(pages, committed) {
  const facts = {};
  facts.pages = String(pages);
  /* Same count the llms.txt facts use — one definition, so the colophon and
     the AI-facing files can never quote different numbers again. */
  facts.labs = String(labPageCount(ROOT));
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

  /* Comment lines across every stylesheet in CSS_FILES, counted on the
     REPOSITORY copy. By the time this runs the files on disk have been
     stripped, so reading them now would report zero — the count has to come
     from git's copy. (Named by list rather than by number on purpose: this
     said "the four stylesheets" while CSS_FILES held nine, and then eleven.) */
  try {
    let commentLines = 0;
    for (const f of CSS_FILES) {
      const src = execFileSync('git', ['show', 'HEAD:' + f], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = src.match(/\/\*[\s\S]*?\*\//g) || [];
      commentLines += m.reduce((n, c) => n + c.split('\n').length, 0);
    }
    if (commentLines) facts.csscomments = commentLines.toLocaleString('en-US');
  } catch (e) { /* no git, or the file is not committed yet: keep what is there */ }

  /* A shallow clone only has the commits it fetched, so its `rev-list --count`
     is the fetch depth, not the history. This used to answer that by leaving
     the committed number alone — but Vercel is ALWAYS shallow, so the branch
     that recounts never ran there and the tile sat frozen at a hand-typed 143
     while the repository passed 160, under a hero paragraph promising every
     number on the page is counted at deploy. A figure that cannot self-correct
     is exactly what this whole pass exists to abolish.
     So: deepenHistory() first, and count for real whenever that works. When it
     cannot (no network, no credentials), publish a FLOOR rather than either a
     lie or the fetch depth — the larger of what git can see and what the page
     already claims, marked with a + so it reads as "at least this many", which
     is the one thing still provable. It never moves backwards and it corrects
     itself upward on the first deploy that can reach the remote. */
  try {
    const state = deepenHistory();                 // before the count, so it counts the deepened history
    const reachable = Number(git(['rev-list', '--count', 'HEAD']).trim());
    if (reachable && (state === 'complete' || state === 'deepened')) {
      facts.commits = String(reachable);
    } else if (reachable) {
      const m = /data-colophon="commits"[^>]*>([^<]*)</.exec(committed || '');
      const onPage = m ? Number(m[1].replace(/[^0-9]/g, '')) : 0;
      facts.commits = String(Math.max(reachable, onPage || 0)) + '+';
      log('  NOTE  history is still shallow after the unshallow fetch, so the');
      log('        commit count publishes as a floor: ' + facts.commits);
    }
  } catch (e) { /* no git at all: keep the committed value, as before */ }

  facts.updated = new Date().toISOString().slice(0, 10);
  return facts;
}

function writeColophon(pages) {
  const rel = 'colophon.html';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;

  log('');
  log('colophon');
  const before = fs.readFileSync(abs, 'utf8');
  const facts = colophonFacts(pages, before);
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
  log(CHECK ? '=== build --check (no files will be written; git history may be deepened) ==='
            : '=== build ===');
  doCss();
  doJs();
  doSitemap();
  const index = doSearchIndex();
  doLlmsCounts(index);
  doJsonLd();
  doSitemapParity();
  doChromeParity();
  doSwPrecacheParity();
  doVendorPairing();
  verifyOutput();
  log('');
  const saved = totalBefore - totalAfter;
  log('CSS total: ' + totalBefore + ' -> ' + totalAfter +
      '  (saved ' + saved + ' bytes, ' +
      (totalBefore ? ((saved / totalBefore) * 100).toFixed(1) : '0') + '%)');
  const savedJs = totalJsBefore - totalJsAfter;
  log('JS total:  ' + totalJsBefore + ' -> ' + totalJsAfter +
      '  (saved ' + savedJs + ' bytes, ' +
      (totalJsBefore ? ((savedJs / totalJsBefore) * 100).toFixed(1) : '0') + '%)');
  /* Same wording as the opening banner on purpose. This said "nothing
     written" while the banner above already admitted the unshallow fetch, so
     the run that had just spent two minutes writing to .git closed by denying
     it — and the closing line is the one a reader scrolls back to. */
  log(CHECK ? '=== check complete (no files written; git history may have been deepened) ==='
            : '=== build complete ===');
}

/* Exported so the gates can be pointed at a deliberately broken scratch tree
   and proven to throw — a gate nobody has ever seen fail is a gate nobody
   knows works. `node scripts/build.js` behaves exactly as before. */
module.exports = {
  jsonLdErrors: jsonLdErrors,
  navHrefs: navHrefs,
  footerColHrefs: footerColHrefs,
  footerCtaHrefs: footerCtaHrefs,
  footerBottomHrefs: footerBottomHrefs,
  brandHref: brandHref,
  stripJsComments: stripJsComments,
  doJsonLd: doJsonLd,
  doSitemapParity: doSitemapParity,
  doChromeParity: doChromeParity,
  doSwPrecacheParity: doSwPrecacheParity,
  doVendorPairing: doVendorPairing,
};

if (require.main === module) main();

#!/usr/bin/env node
/* ==========================================================================
   check-labs.js — the gate that actually PRESSES RUN on every tool lab.
   --------------------------------------------------------------------------
   `npm run check:labs`. No dependencies: it drives headless Chrome over the
   DevTools Protocol through scripts/cdp.js, on Node's built-in WebSocket.

   WHY IT EXISTS.

   Every other gate in build.js checks that files exist and agree with each
   other — sitemap parity, precache coverage, manifest fields, JSON-LD, share
   images. Not one of them ever presses a button, so a lab can be completely
   dead and still pass the entire suite. One was. labs/ansi-escapes read an
   identifier, MAX_COLS, that no file declared; under 'use strict' that throws
   on the first printable character, the rendered-screen pane stayed empty in
   all three modes, and the tool's own try/catch turned the crash into "Could
   not finish reading that input", which blames the visitor for a missing var.
   It shipped. It passed every gate. It even survived a manual sweep, because
   the report ABOVE the error rendered perfectly and the reader stopped there.

   So: a lab that looks fine and does nothing. That is the one failure this
   file exists to make impossible.

   WHAT IT CHECKS, and why each line earns its place.

     1. Nothing was thrown. No uncaught exception, no console.error, while
        loading or running. Unambiguous, and true of every page.

     2. The consent gate closed. Until it does, tool-shell.js marks everything
        behind it `inert`, so the Run click lands on nothing and the pane keeps
        its placeholder — which would otherwise pass check 3 while testing
        nothing at all.

     3. The output pane is not empty, and CHANGED when Run was pressed. The
        second half matters: "Paste a JWT above." is eighteen perfectly good
        characters, and a gate that accepts it is checking that the page has
        markup rather than that the lab works.

     4. The output contains no failure text — 'is not defined', 'is not a
        function', 'Cannot read properties', '[object Object]'. Note that
        check 1 would NOT have caught MAX_COLS, because the lab caught its own
        exception; only this one does. It scans the WHOLE pane, never a
        prefix, because the manual sweep that missed it had read the first 55
        characters and they were a perfectly good report.

   WHAT IT DOES NOT DO, on purpose.

   It does not check that an answer is RIGHT. A lab can print a confidently
   wrong CVSS score and pass everything here. Judging correctness means
   knowing the specification, which belongs beside the code it judges, not in
   a runner that has to be true of every page. This is the floor, not the
   ceiling — and keeping that boundary sharp is why the failure list below
   stays short and mechanical instead of growing into per-lab string matching
   nobody can reason about.

   WHAT IT SKIPS, and why that is not laziness.

   Only the labs built on tool-shell.js are driven — the ones with a #tool-run
   button and a #tool-out pane, discovered from the markup rather than listed
   here, so adding a tool lab needs no edit to this file. That deliberately
   leaves out the three v86 machines, the eleven WebAssembly language runtimes
   and the canvas visualisers. Those need per-lab timeouts, boot detection and
   bespoke selectors — most of this file's possible complexity for the labs
   LEAST able to fail quietly. If Python stops running you find out in a day;
   a dead ANSI renderer sits there for months. The skipped list is printed on
   every run so the report states its own blind spots rather than implying
   coverage it does not have.
   ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const cdp = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.LABGATE_PORT) || 4399;
const BASE = 'http://127.0.0.1:' + PORT;

const argv = process.argv.slice(2);
const WANT_NET = argv.includes('--net');
const VERBOSE = argv.includes('--verbose');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',') : null;
})();
const WORKERS = Number(process.env.LABGATE_WORKERS) || 4;

/* Text that should never reach a pane a visitor reads. Kept short on purpose:
   each entry is unambiguous JavaScript failure text. A sentinel that fires on
   legitimate content trains people to ignore the gate, which is worse than
   not having one — note that plain 'undefined' is absent, because labs/ieee754
   and labs/mojibake both print it as genuine subject matter. */
const SENTINELS = [
  'is not defined', 'is not a function',
  'Cannot read properties', 'Cannot set property',
  '[object Object]', 'undefined is not'
];

/* Pressing Run here reaches a real service. ct-log is rate-limited to about
   nine unauthenticated queries an hour, so including these by default would
   fail the gate whenever the wifi dropped — and a gate that cries wolf gets
   switched off. `--net` opts in. */
const NETWORK = ['dns', 'rdap', 'ct-log', 'breach-check', 'email-security', 'api', 'chat'];

/* Sample input for labs whose Run does nothing useful on an empty box. Only
   needed where the lab has no default of its own; everything else is left
   alone deliberately, so the gate exercises what a visitor first sees. */
const SAMPLE = {
  hash: 'hello',
  subnet: '192.168.1.10/26',
  cipher: 'attack at dawn',
  password: 'correct horse battery staple',
  unicode: 'café 😀',
  encoding: 'hello',
  timestamp: '1700000000',
  qr: 'https://example.com'
};

/* Discovered, not listed: a lab is driveable here if its markup has both the
   shared Run button and the shared output pane. Add a tool lab and it is
   picked up; build one on a different shell and it is skipped and named. */
function labs() {
  return fs.readdirSync(path.join(ROOT, 'labs'))
    .filter((f) => f.endsWith('.html') && f !== 'index.html')
    .map((f) => {
      const slug = f.replace(/\.html$/, '');
      const html = fs.readFileSync(path.join(ROOT, 'labs', f), 'utf8');
      return { slug, driveable: html.includes('id="tool-run"') && html.includes('id="tool-out"') };
    })
    .sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'dev-server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve) => {
    let out = '';
    const onData = (d) => { out += d.toString(); if (/http:\/\/localhost:\d+/.test(out)) resolve(child); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    setTimeout(() => resolve(child), 5000);
  });
}

const PANE = '(document.getElementById("tool-out") || { textContent: "" }).textContent.trim()';

async function check(page, slug) {
  page.clearErrors();
  await page.goto(BASE + '/labs/' + slug);

  await page.click('#lab-agree');
  await page.eval('new Promise(function (z) { setTimeout(z, 250); })');

  const gateUp = await page.eval(
    '(function () { var g = document.getElementById("lab-gate");' +
    ' return !!(g && g.offsetParent !== null); })()'
  );

  const before = await page.eval(PANE);

  if (SAMPLE[slug]) {
    await page.eval(
      '(function () { var i = document.querySelector("#tool-text, #tool-in, textarea.lab-toolinput");' +
      ' if (i && !String(i.value || "").trim()) { i.value = ' + JSON.stringify(SAMPLE[slug]) + ';' +
      ' i.dispatchEvent(new Event("input", { bubbles: true })); } return 1; })()'
    );
  }

  const ran = await page.click('#tool-run');

  /* Poll instead of sleeping the whole budget: most of these answer in a few
     milliseconds and should not each cost the run twelve seconds. */
  const after = await page.eval(
    '(async function () {' +
    '  var was = ' + JSON.stringify(before) + ';' +
    '  var deadline = Date.now() + 10000;' +
    '  while (Date.now() < deadline) {' +
    '    await new Promise(function (z) { setTimeout(z, 150); });' +
    '    var now = ' + PANE + ';' +
    '    if (now && now !== was) return now;' +
    '  }' +
    '  return ' + PANE + ';' +
    '})()', 40000);

  const why = [];
  for (const e of page.errors) why.push(e);
  if (gateUp) why.push('consent gate did not close, so every control stayed inert');
  if (!ran) why.push('could not click #tool-run (hidden, or off-screen)');
  if (!after) why.push('output pane is empty after Run');
  else if (after === before && SAMPLE[slug]) {
    /* Only assert this where we typed something in. Several labs render a
       complete result from their own defaults on load, so pressing Run
       reproduces identical text — correct behaviour, not a dead button, and
       asserting on it failed rent-vs-buy, salary-breakdown and timezones for
       doing exactly what they should. Where input WAS supplied, the output
       has to answer it. */
    why.push('Run changed nothing though ' + JSON.stringify(SAMPLE[slug]) +
             ' was entered — pane still reads ' + JSON.stringify(before.slice(0, 50)));
  }
  for (const s of SENTINELS) {
    if (after.indexOf(s) !== -1) why.push('output contains "' + s + '"');
  }

  return { slug, ok: why.length === 0, why, chars: after ? after.length : 0 };
}

async function main() {
  if (!cdp.findBrowser()) {
    console.error('\n  No Chrome or Edge found. Set CHROME_PATH to a browser binary.');
    console.error('  This gate needs a real one: the labs run WebAssembly and canvas.\n');
    process.exit(2);
  }

  const all = labs();
  const skipped = [];
  let queue = [];

  for (const { slug, driveable } of all) {
    if (ONLY) { if (ONLY.includes(slug)) queue.push(slug); continue; }
    if (!driveable) { skipped.push([slug, 'not a tool-shell lab (no #tool-run + #tool-out)']); continue; }
    if (!WANT_NET && NETWORK.includes(slug)) { skipped.push([slug, 'reaches the network — use --net']); continue; }
    queue.push(slug);
  }

  console.log('\n  lab runtime gate');
  console.log('  ' + queue.length + ' labs to run, ' + skipped.length + ' not covered, ' +
              WORKERS + ' at a time\n');

  const server = await startServer();
  const browser = await cdp.open();
  const results = [];
  const started = Date.now();

  try {
    const workers = [];
    for (let w = 0; w < Math.min(WORKERS, queue.length); w++) {
      workers.push((async () => {
        const page = await browser.newPage();
        try {
          for (;;) {
            const slug = queue.shift();
            if (!slug) break;
            let r;
            try { r = await check(page, slug); }
            catch (e) { r = { slug, ok: false, why: ['harness error: ' + String(e.message).slice(0, 130)] }; }
            results.push(r);
            process.stdout.write(r.ok ? '.' : 'X');
          }
        } finally { await page.close(); }
      })());
    }
    await Promise.all(workers);
  } finally {
    await browser.close();
    try { server.kill(); } catch (e) {}
  }

  results.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const bad = results.filter((r) => !r.ok);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n');

  if (VERBOSE) {
    for (const r of results) if (r.ok) console.log('  ok    ' + r.slug.padEnd(24) + r.chars + ' chars');
    console.log('');
  }
  if (skipped.length && VERBOSE) {
    console.log('  not covered by this gate:');
    for (const [s, w] of skipped) console.log('    ' + s.padEnd(24) + w);
    console.log('');
  }
  if (bad.length) {
    console.log('  FAILED\n');
    for (const r of bad) {
      console.log('  ' + r.slug);
      for (const w of r.why) console.log('      ' + w);
      console.log('');
    }
  }

  console.log('  ' + (results.length - bad.length) + '/' + results.length +
              ' labs ran clean in ' + secs + 's' +
              (skipped.length ? '   (' + skipped.length + ' not covered — run with --verbose to list)' : ''));
  console.log(bad.length ? '  === ' + bad.length + ' FAILING ===\n' : '  === all clear ===\n');
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\n  gate could not run: ' + e.message + '\n');
  process.exit(2);
});

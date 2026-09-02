#!/usr/bin/env node
/* ==========================================================================
   check-forms.js — the gate that actually SUBMITS every WhatsApp form.
   --------------------------------------------------------------------------
   `npm run check:forms`. Same recipe as check-labs.js: no dependencies,
   headless Chrome over the DevTools Protocol through scripts/cdp.js.

   WHY IT EXISTS.

   Four pages carry a form[data-wa-form] — contact, internships, the labs hub
   and the games hub — and until this file, nothing tested any of them. The
   known silent failure mode is nastier than a lab that throws: wa-form.js
   looks up #form-status with getElementById, DOCUMENT-wide, and returns
   early when it is missing or when a duplicate id elsewhere shadows it. The
   visible symptom of that early return is a submit button that ships
   disabled (so a no-JS Enter press cannot fire the raw POST) and never gets
   enabled — no exception, no console.error, nothing in any pane. A visitor
   sees a button that will not press and leaves; every existing gate passes.

   WHAT IT CHECKS, per page, and why each line earns its place.

     1. Exactly ONE element with id="form-status". One is the wiring
        contract; zero is the early return above; two means getElementById
        answers with whichever comes first in the document and the OTHER
        form is silently dead — the exact trap the games hub's comment warns
        about.

     2. The submit button is ENABLED after load. This is the one observable
        proof that initWhatsAppForm ran to completion, because enabling the
        button is the first thing it does after the early-return guards.

     3. Exactly one form[data-wa-form] on the page, and its
        data-wa-analytics-prefix is unique ACROSS the four pages — two forms
        sharing a prefix merge their gtag events and nobody can tell which
        page a report came from.

     4. Filling every declared field and submitting produces a
        https://wa.me/ URL whose decoded text contains the name and the
        free-text message that were typed. This drives the whole pipeline:
        FormData collection, the required-field validation (which must NOT
        fire), the template's \n and {field} substitution, and the
        encodeURIComponent at the end. window.open is stubbed to capture
        the URL instead of opening a tab — the stub returns a plain object
        so the handler takes its success branch, not the pop-up-blocked one.

     5. Nothing was thrown and no console.error fired along the way — same
        free, unambiguous check every page should pass.

   WHAT IT DOES NOT DO, on purpose.

   It does not press the button with a real synthesized mouse click the way
   check-labs.js does. That lesson was about gesture-gated APIs — and the
   only gesture-gated call on this path, window.open, is exactly the one we
   stub out. form.requestSubmit() runs the same constraint validation and
   fires the same submit event a click would, without the scroll-measure-
   click dance that made check-labs flaky to write. It also does not test
   the pop-up-blocked branch, the visibilitychange follow-up, or the tel
   input filter: those need timing games (fake tab switches) whose flakiness
   would cost more trust than the coverage is worth. The floor here is "a
   filled form yields the right wa.me URL"; correctness of the copy around
   it stays a human's job.
   ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const cdp = require('./cdp');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.FORMGATE_PORT) || 4471;
const BASE = 'http://127.0.0.1:' + PORT;

/* Listed, not discovered — deliberately unlike check-labs.js. The labs are a
   directory of same-shaped files; these four forms live on four differently
   shaped pages, and a new data-wa-form page should force whoever adds it to
   decide what "filled in" means for its fields. Grepping the tree for
   data-wa-form is the reviewer's cross-check, and the summary line prints
   this list's size so a stale list is visible on every run. */
const PAGES = [
  { slug: 'contact', url: '/contact' },
  { slug: 'internships', url: '/internships' },
  { slug: 'labs-hub', url: '/labs' },
  { slug: 'games-hub', url: '/games' }
];

/* Distinctive values, so finding them in the decoded wa.me text proves the
   template substitution ran on OUR input rather than matching boilerplate.
   The phone value must survive wa-form.js's tel filter ([0-9+ ] only). */
const NAME = 'Formgate Tester';
const MESSAGE = 'FORMGATE probe message 8181';
const PHONE = '+91 90000 00001';
const EMAIL = 'formgate@example.com';

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

/* Runs in the page: fill every field data-wa-fields declares, stub
   window.open, submit, and hand back what happened as one JSON blob. Built
   as a string because cdp.eval takes source text; setTimeout (never rAF —
   see cdp.js's click comment) gives the DOMContentLoaded auto-init a beat
   to settle before we measure anything. */
const PROBE =
  '(async function () {' +
  '  await new Promise(function (z) { setTimeout(z, 250); });' +
  '  var r = { statusCount: 0, formCount: 0, prefix: null, btnDisabled: null, waUrl: null, fillProblem: null };' +
  /* querySelectorAll, not getElementById: getElementById can only ever
     return one node, which is precisely why a duplicate id is invisible to
     the code under test and must be counted here another way. */
  '  r.statusCount = document.querySelectorAll(\'[id="form-status"]\').length;' +
  '  var forms = document.querySelectorAll("form[data-wa-form]");' +
  '  r.formCount = forms.length;' +
  '  var form = forms[0];' +
  '  if (!form) return JSON.stringify(r);' +
  '  r.prefix = form.getAttribute("data-wa-analytics-prefix");' +
  '  var btn = form.querySelector(\'button[type="submit"]\');' +
  '  r.btnDisabled = btn ? btn.disabled : null;' +
  '  var fields = (form.getAttribute("data-wa-fields") || "").split(/\\s+/).filter(Boolean);' +
  '  for (var i = 0; i < fields.length; i++) {' +
  '    var el = form.elements.namedItem(fields[i]);' +
  '    if (!el || !el.tagName) { r.fillProblem = "no control named " + fields[i]; return JSON.stringify(r); }' +
  '    if (el.tagName === "SELECT") {' +
  /* First real option: the placeholder is value="" and disabled, and a
     select whose only pickable options are placeholders is itself a bug
     worth surfacing as a fill failure. */
  '      var opt = null;' +
  '      for (var j = 0; j < el.options.length; j++) {' +
  '        if (el.options[j].value && !el.options[j].disabled) { opt = el.options[j]; break; }' +
  '      }' +
  '      if (!opt) { r.fillProblem = "select " + fields[i] + " has no pickable option"; return JSON.stringify(r); }' +
  '      el.value = opt.value;' +
  '      el.dispatchEvent(new Event("change", { bubbles: true }));' +
  '    } else {' +
  '      el.value = el.type === "tel" ? ' + JSON.stringify(PHONE) + ' :' +
  '                 el.type === "email" ? ' + JSON.stringify(EMAIL) + ' :' +
  '                 el.tagName === "TEXTAREA" ? ' + JSON.stringify(MESSAGE) + ' :' +
  '                 fields[i] === "name" ? ' + JSON.stringify(NAME) + ' : "formgate";' +
  /* A real input event, bubbling, so the delegated tel filter runs against
     our value the way it would against typing — if it mangles the number,
     the mangled form is what reaches the template and the report says so. */
  '      el.dispatchEvent(new Event("input", { bubbles: true }));' +
  '    }' +
  '  }' +
  /* The stub returns a plain object, not null: null is the pop-up-blocked
     branch, and we want the success path — which then sets .opener on the
     stub, harmlessly. requestSubmit (not submit()) so the constraint
     validation and the submit handler both run, exactly as a click would. */
  '  var captured = null;' +
  '  window.open = function (u) { captured = u; return { opener: null }; };' +
  '  form.requestSubmit();' +
  '  await new Promise(function (z) { setTimeout(z, 100); });' +
  '  r.waUrl = captured;' +
  '  return JSON.stringify(r);' +
  '})()';

async function check(page, spec) {
  page.clearErrors();
  await page.goto(BASE + spec.url);
  const raw = await page.eval(PROBE, 20000);
  const r = JSON.parse(raw);

  const why = [];
  for (const e of page.errors) why.push(e);

  if (r.statusCount !== 1) {
    why.push(r.statusCount === 0
      ? 'no #form-status — wa-form.js returns early and the submit button stays disabled forever'
      : r.statusCount + ' elements with id="form-status" — getElementById serves the first, the rest of the page is wired to the wrong one');
  }
  if (r.formCount !== 1) why.push(r.formCount + ' form[data-wa-form] elements (expected exactly 1)');
  if (r.btnDisabled === null) why.push('no button[type="submit"] inside the form');
  else if (r.btnDisabled === true) why.push('submit button still disabled after load — initWhatsAppForm never ran to completion');
  if (r.fillProblem) why.push('could not fill the form: ' + r.fillProblem);

  if (!r.waUrl) {
    if (!r.fillProblem) why.push('submit produced no window.open call — validation refused the filled form, or the handler never bound');
  } else if (!/^https:\/\/wa\.me\//.test(r.waUrl)) {
    why.push('window.open got ' + JSON.stringify(r.waUrl.slice(0, 80)) + ' — not a https://wa.me/ URL');
  } else {
    let text = '';
    try { text = new URL(r.waUrl).searchParams.get('text') || ''; }
    catch (e) { why.push('wa.me URL would not parse: ' + e.message); }
    if (text.indexOf(NAME) === -1) why.push('decoded WhatsApp text is missing the name that was typed (' + NAME + ')');
    if (text.indexOf(MESSAGE) === -1) why.push('decoded WhatsApp text is missing the message that was typed (' + MESSAGE + ')');
  }

  return { slug: spec.slug, ok: why.length === 0, why, prefix: r.prefix };
}

async function main() {
  if (!cdp.findBrowser()) {
    console.error('\n  No Chrome or Edge found. Set CHROME_PATH to a browser binary.');
    console.error('  This gate needs a real one: it drives the actual submit pipeline.\n');
    process.exit(2);
  }

  console.log('\n  form runtime gate');
  console.log('  ' + PAGES.length + ' pages carry a data-wa-form\n');

  const server = await startServer();
  const browser = await cdp.open();
  const results = [];
  const started = Date.now();

  /* Four pages, one tab, in order — a worker pool would save under a second
     here and cost the determinism that makes a red run easy to re-run. */
  try {
    const page = await browser.newPage();
    try {
      for (const spec of PAGES) {
        let r;
        try { r = await check(page, spec); }
        catch (e) { r = { slug: spec.slug, ok: false, why: ['harness error: ' + String(e.message).slice(0, 130)], prefix: null }; }
        results.push(r);
        process.stdout.write(r.ok ? '.' : 'X');
      }
    } finally { await page.close(); }
  } finally {
    await browser.close();
    try { server.kill(); } catch (e) {}
  }

  /* Cross-page assertion: analytics prefixes must not collide, or two forms'
     gtag events merge into one stream. Checked here, after all pages, since
     no single page can see the collision. */
  const seen = new Map();
  for (const r of results) {
    if (!r.prefix) continue;
    if (seen.has(r.prefix)) {
      r.ok = false;
      r.why.push('data-wa-analytics-prefix "' + r.prefix + '" is also used by ' + seen.get(r.prefix) + ' — their analytics events merge');
    } else {
      seen.set(r.prefix, r.slug);
    }
  }

  const bad = results.filter((r) => !r.ok);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log('\n');

  if (bad.length) {
    console.log('  FAILED\n');
    for (const r of bad) {
      console.log('  ' + r.slug);
      for (const w of r.why) console.log('      ' + w);
      console.log('');
    }
  }

  console.log('  ' + (results.length - bad.length) + '/' + results.length +
              ' forms submitted clean in ' + secs + 's');
  console.log(bad.length ? '  === ' + bad.length + ' FAILING ===\n' : '  === all clear ===\n');
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error('\n  gate could not run: ' + e.message + '\n');
  process.exit(2);
});

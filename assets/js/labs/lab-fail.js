/* ==========================================================================
   lab-fail.js — the "this did not load" banner, shared by every lab that
   downloads something large enough to fail.
   --------------------------------------------------------------------------
   A runtime that never arrived and a program with a bug in it look identical
   once they reach the output pane: red text. They are not the same thing. The
   first means the user's code never ran and retrying is the right move; the
   second means their code ran and is wrong. Conflating them sends people
   hunting for a fault that does not exist.

   This is shared rather than repeated because five different lab shells need
   the same sentence and the same button: the runtime labs (lab-app.js), the
   three v86 machines (bsd/dos/linux-app.js), and the two sql.js tools
   (hacklab.js, tools/sqlite-browser.js).

   The banner is built here rather than written into markup so that adding it
   to a lab costs one call, not another near-identical block of HTML.

   Note: lab-worker.js carries its own copy of classify(). That is deliberate,
   not an oversight — it runs inside a Web Worker, which cannot see this file's
   globals, and importing this file there would add a network fetch that can
   itself fail on exactly the bad connection this code exists to report.
   ========================================================================== */

(function (root) {
  'use strict';

  /* %s is what failed, phrased as a noun: "Ruby runtime", "v86 emulator". */
  var TEXT = {
    network: 'The %s could not be downloaded. It is a large file, so a dropped ' +
             'or throttled connection is the usual cause. Nothing has run yet, ' +
             'so there is nothing to fix on your side.',
    memory: 'The browser ran out of memory loading the %s. Closing other tabs ' +
            'frees some up, and the lighter labs need a fraction of it.',
    unsupported: 'This browser cannot run the %s — the WebAssembly support it ' +
                 'needs is missing or switched off. A current Chrome, Firefox, ' +
                 'Edge or Safari will run it.',
    unknown: 'The %s did not start. Nothing has run yet, so there is nothing to ' +
             'fix on your side — trying again usually settles it.'
  };

  var node = null;
  var textEl = null;
  var retryEl = null;
  var retryFn = null;

  /* Best-effort cause, used only to choose wording. A wrong guess costs a less
     helpful sentence, never a wrong result. */
  function classify(err) {
    if (typeof WebAssembly === 'undefined') return 'unsupported';
    if (err instanceof RangeError) return 'memory';
    var text = String((err && err.message) || err || '');
    if (/out of memory|\bOOM\b|enlarge memory|allocation failed|buffer allocation/i.test(text)) return 'memory';
    // A download failure wearing a compiler error's clothes: the bytes arrived,
    // they were just an error page. Must be tested before the support rule
    // below, which would otherwise blame the browser and hide the retry button.
    if (/magic word|magic number|MIME type|fetching of the wasm failed|status code is not ok/i.test(text)) return 'network';
    if (/failed to fetch|load failed|network|importScripts|net::|ERR_|failed to load/i.test(text)) return 'network';
    if (/refused to compile|blocked by CSP|wasm-unsafe-eval/i.test(text)) return 'unsupported';
    if (/WebAssembly|\bwasm\b/i.test(text) && /not supported|unsupported|disabled/i.test(text)) return 'unsupported';
    return 'unknown';
  }

  function build(anchor) {
    node = document.createElement('div');
    node.className = 'lab-fail';
    node.hidden = true;
    node.setAttribute('role', 'alert');

    textEl = document.createElement('p');
    textEl.className = 'lab-fail-text';

    var actions = document.createElement('div');
    actions.className = 'lab-fail-actions';

    retryEl = document.createElement('button');
    retryEl.type = 'button';
    retryEl.className = 'lab-fail-retry';
    retryEl.textContent = 'Try again';
    retryEl.addEventListener('click', function () {
      var fn = retryFn;
      hide();
      // Guard against a double click firing the handler twice while the first
      // attempt is still setting itself up.
      retryFn = null;
      if (fn) fn();
    });

    var link = document.createElement('a');
    link.className = 'lab-fail-link';
    link.href = '/labs';
    link.textContent = 'Other labs';

    actions.appendChild(retryEl);
    actions.appendChild(link);
    node.appendChild(textEl);
    node.appendChild(actions);
    anchor.parentNode.insertBefore(node, anchor.nextSibling);
  }

  /* show({ anchor, what, kind, retry })
       anchor  element the banner is placed directly after (required)
       what    noun for the thing that failed, e.g. 'Ruby runtime'
       kind    'network' | 'memory' | 'unsupported' | 'unknown'
       retry   optional function; omit it and the button is not shown */
  function show(opts) {
    if (!opts || !opts.anchor || !opts.anchor.parentNode) return;
    if (!node) build(opts.anchor);

    var kind = TEXT[opts.kind] ? opts.kind : 'unknown';
    textEl.textContent = TEXT[kind].replace('%s', opts.what || 'runtime');

    // Retrying an unsupported browser only fails again the same way.
    retryFn = (kind === 'unsupported') ? null : (opts.retry || null);
    retryEl.hidden = !retryFn;

    node.hidden = false;
  }

  function hide() {
    if (node) node.hidden = true;
  }

  root.LabFail = { show: show, hide: hide, classify: classify };
}(typeof window !== 'undefined' ? window : this));

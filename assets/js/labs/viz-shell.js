/* ==========================================================================
   viz-shell.js — the small shared shell for the visualiser labs.
   --------------------------------------------------------------------------
   tool-shell.js exists for the forensics tools, and those are request/response:
   drop a file, click Run, read a pane. The visualiser toys are the opposite —
   a canvas that redraws every frame, a WebGL context, a simulation that never
   "finishes". They share almost none of the tool chrome (no output pane, no
   file drop, no copy buttons), so bolting them onto tool-shell would only drag
   dead weight into both. What they DO share is the consent gate — agreeing once
   in Labs covers the whole section — and the same flat promise that nothing
   here opens a network connection. That is all this file is: the gate, a couple
   of DOM/rAF helpers, and a Blob-URL worker factory for the toys that need to
   push heavy math off the main thread.

   Two decisions worth spelling out:

   1. onReady() fires only once consent is actually granted, not merely after
      the gate is wired. tool-shell can call onReady immediately because a tool
      that computes on a click does no work while the overlay is up. A live toy
      would — a requestAnimationFrame loop or a GPU context spinning behind the
      consent screen wastes the visitor's battery for something they haven't
      agreed to look at yet. So here the loop starts on grant, not on load.

   2. Workers are built from a Blob URL, never a separate .js file and never
      eval/new Function. The production CSP is
        script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:
      which forbids unsafe-eval but permits blob: workers, so a Blob URL is the
      only way to spin up off-thread code inline. The URL is revoked on a short
      timer once the Worker has fetched it — revoking after the fetch does not
      stop the running worker.
   ========================================================================== */

(function (root) {
  'use strict';

  var PREFIX = 'lab.';

  /* Consent gate — identical storage to tool-shell (key 'lab.consent', value
     'yes'), so agreeing in either place covers all of Labs. Unlike tool-shell
     the granted callback is deferred until consent truly exists: either it is
     already stored, or the visitor clicks agree. */
  function gate(rootId, onGranted) {
    var el = document.getElementById(rootId);
    if (!el) return;

    /* See the note in tool-shell.js: the gate is a painted panel, so without
       `inert` everything it covers stays tabbable and screen-reader visible
       while consent is still pending. Unsupported browsers ignore it. */
    var gateEl = document.getElementById('lab-gate');
    var setInert = function (on) {
      if (!gateEl) return;
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i] !== gateEl) kids[i].inert = on;
      }
    };

    var agreed;
    try { agreed = localStorage.getItem(PREFIX + 'consent'); } catch (err) { agreed = null; }
    if (agreed === 'yes') {
      el.setAttribute('data-consent', 'granted');
      if (onGranted) onGranted();
      return;
    }

    setInert(true);
    var yes = document.getElementById('lab-agree');
    var no = document.getElementById('lab-leave');
    if (yes) yes.addEventListener('click', function () {
      try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (err) {}
      el.setAttribute('data-consent', 'granted');
      setInert(false);
      if (onGranted) onGranted();
    });
    if (no) no.addEventListener('click', function () { window.location.href = '/'; });
  }

  var LabViz = {
    /* Register a visualiser. gate() runs the consent flow; onReady() is called
       once, the moment consent is granted, and is where the toy should build
       its canvas and start its loop. run() is optional: if supplied it is bound
       to Ctrl/Cmd + Enter as a live restart, matching how tool-shell binds run.
       There is no run button — these are live. */
    define: function (spec) {
      gate(spec.id, function () {
        if (spec.run) {
          var el = document.getElementById(spec.id);
          if (el) el.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              spec.run();
            }
          });
        }
        if (spec.onReady) spec.onReady();
      });
    },

    /* Terse element builder: tag, optional class, optional text. */
    el: function (tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text != null) node.textContent = text;
      return node;
    },

    /* requestAnimationFrame with a setTimeout fallback that still hands the
       callback a timestamp, so a loop written against rAF keeps working. */
    raf: function (fn) {
      if (root.requestAnimationFrame) return root.requestAnimationFrame(fn);
      return root.setTimeout(function () { fn(Date.now()); }, 16);
    },

    cancelRaf: function (handle) {
      if (handle == null) return;
      if (root.cancelAnimationFrame) root.cancelAnimationFrame(handle);
      else root.clearTimeout(handle);
    },

    /* Spin up an off-thread worker from a string of source. The caller owns the
       full worker source; this only wraps it in a Blob URL (CSP-permitted) and
       returns the live Worker. The URL is stashed on the worker and revoked on
       a short timer once it has been fetched — the worker keeps running. */
    worker: function (source) {
      var url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      var w = new Worker(url);
      w._blobUrl = url;
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return w;
    },

    /* Thousands separators. Integers get grouped; any fractional part is left
       alone. Non-numbers pass straight through. */
    humanNumber: function (n) {
      if (n == null || (typeof n === 'number' && isNaN(n))) return String(n);
      var neg = n < 0;
      var parts = String(Math.abs(n)).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return (neg ? '-' : '') + parts.join('.');
    }
  };

  root.LabViz = LabViz;
})(typeof self !== 'undefined' ? self : this);

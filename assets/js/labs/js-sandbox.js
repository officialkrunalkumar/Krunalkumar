/* ==========================================================================
   js-sandbox.js — preamble for the JavaScript / TypeScript blob Worker.
   --------------------------------------------------------------------------
   This file is never loaded as a script by itself. lab-app.js fetches it as
   text, substitutes __LAB_STDIN__, appends the user's program and turns the
   whole thing into a Blob that becomes a Worker's source.

   Why a blob Worker instead of eval() in a shared worker:
   the site's CSP allows 'wasm-unsafe-eval' but NOT 'unsafe-eval', so
   eval() and new Function() are both blocked — deliberately, because
   permitting them site-wide is the single biggest CSP concession available.
   Making the user's program *be* the worker's source sidesteps the whole
   question: it needs `worker-src blob:` and nothing else.

   Everything below is top-level on purpose. The user's code is appended after
   it in the same script, so `stdin` has to be a real top-level binding for
   their program to see it.
   ========================================================================== */

'use strict';

// Replaced with a JSON string literal by lab-app.js before the Blob is made.
var stdin = __LAB_STDIN__;

(function () {
  function render(value, depth) {
    depth = depth || 0;
    if (typeof value === 'string') return depth === 0 ? value : JSON.stringify(value);
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'bigint') return value.toString() + 'n';
    if (typeof value === 'function') return '[Function: ' + (value.name || 'anonymous') + ']';
    if (value instanceof Error) return tidyStack(value.stack || (value.name + ': ' + value.message));
    if (typeof value === 'object') {
      // Depth-limited so a cyclic or very deep structure cannot hang the run
      // before the user sees any output at all.
      if (depth > 4) return Array.isArray(value) ? '[Array]' : '[Object]';
      try {
        if (Array.isArray(value)) {
          return '[ ' + value.map(function (v) { return render(v, depth + 1); }).join(', ') + ' ]';
        }
        var keys = Object.keys(value);
        if (!keys.length) return '{}';
        return '{ ' + keys.map(function (k) {
          return k + ': ' + render(value[k], depth + 1);
        }).join(', ') + ' }';
      } catch (err) {
        return '[unserialisable object]';
      }
    }
    return String(value);
  }

  // The program is the source of a Blob Worker, so every stack frame carries a
  // "blob:https://host/<uuid>:" prefix that means nothing to the reader. Strip
  // it back to bare line:column, which is what they actually need.
  function tidyStack(text) {
    return String(text).replace(/blob:[^\s)]*?:(\d+:\d+)/g, 'line $1');
  }

  function emit(cls) {
    return function () {
      var parts = [];
      for (var i = 0; i < arguments.length; i++) parts.push(render(arguments[i], 0));
      self.postMessage({ type: 'out', cls: cls, text: parts.join(' ') + '\n' });
    };
  }

  self.console = {
    log: emit('t-out'),
    info: emit('t-info'),
    debug: emit('t-dim'),
    warn: emit('t-warn'),
    error: emit('t-err'),
    trace: emit('t-dim'),
    table: emit('t-out'),
    dir: emit('t-out'),
    group: emit('t-dim'),
    groupEnd: function () {},
    time: function () {},
    timeEnd: function () {},
    assert: function (ok) {
      if (!ok) emit('t-err')('Assertion failed');
    }
  };

  // Exactly one 'done' must ever be sent. A synchronous throw reports failure
  // from onerror, and the timer below would otherwise report success straight
  // afterwards and overwrite it in the toolbar.
  var finished = false;
  function finish(ok) {
    if (finished) return;
    finished = true;
    self.postMessage({ type: 'done', ok: ok });
  }

  // Uncaught throws and rejected promises both have to reach the terminal —
  // a silent failure looks identical to a program that printed nothing.
  self.onerror = function (message, source, lineno, colno, error) {
    var text = error && error.stack ? error.stack : message;
    self.postMessage({ type: 'out', cls: 't-err', text: tidyStack(text) + '\n' });
    finish(false);
    return true;
  };

  self.onunhandledrejection = function (event) {
    var reason = event && event.reason;
    var text = reason && reason.stack ? reason.stack : String(reason);
    self.postMessage({ type: 'out', cls: 't-err',
                      text: 'Unhandled rejection: ' + tidyStack(text) + '\n' });
  };

  // The user's program has finished *synchronously* by the time this runs.
  // setTimeout(0) rather than an immediate post so that already-queued
  // microtasks and zero-delay timers flush first and their output lands
  // before the "finished" line. Longer timers keep printing after that, which
  // is why the worker is left alive until Stop or the next Run.
  setTimeout(function () {
    finish(true);   // via finish(), so a throw already reported stays reported
  }, 0);
})();

/* --- the user's program is appended below this line --------------------- */

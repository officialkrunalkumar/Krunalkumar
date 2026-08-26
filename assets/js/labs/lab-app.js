/* ==========================================================================
   lab-app.js — the /labs playground shell.
   --------------------------------------------------------------------------
   Owns the editor, the terminal pane, the consent gate, the storage meter and
   the resource watchdog. Actual execution happens in a Worker; see
   lab-worker.js (WASM runtimes) and js-sandbox.js (JavaScript/TypeScript).

   Nothing here talks to a server. There is no fetch() to any origin other
   than this one, and the only things fetched are the runtime files under
   /assets/vendor/. The user's program exists in a textarea, a Blob and a
   Worker — it is never serialised anywhere it could leave the machine.

   Contents:
     1. Config & small helpers
     2. Site-scoped storage
     3. Terminal output (buffered)
     4. Resource watchdog
     5. Runner (worker lifecycle)
     6. Editor
     7. Consent gate
     8. Storage meter
     9. Language switching & boot
   ========================================================================== */

/* global CodeJar, Prism, LAB_RUNTIMES, LAB_LIST, LabCache */
(function () {
  'use strict';

  var lab = document.getElementById('lab');
  if (!lab) return;

  /* ========================================================================
     1. Config & small helpers
     ======================================================================== */

  var CFG = {
    // A program still running after this long gets the amber "still going"
    // banner and the escalated Cancel.
    SOFT_WARN_MS: 8000,
    // Hard ceiling. Past this the worker is killed whatever it is doing.
    HARD_KILL_MS: 60000,
    // The same two, for the phase BEFORE the program starts — while the
    // runtime itself is downloading and instantiating.
    //
    // These have to be their own numbers. The pair above is sized for a
    // program: 8s of a `while(1)` is a bug, 60s is certainly one. But a cold
    // start is not the program, it is a multi-megabyte download the visitor
    // cannot influence — measured over the wire, Brotli-encoded: the clang
    // toolchain is ~18 MB (9.8 + 6.3 + 1.7), Ruby ~5 MB, Postgres ~4 MB,
    // CPython ~3 MB. Timing those from the Run click meant ~18 MB had to land
    // inside HARD_KILL_MS, i.e. a sustained ~2.4 Mbps, or the worker was
    // killed mid-download and the terminal printed "the program never
    // finished" — accusing source code that had not run yet. Worse, sw.js
    // only caches complete 200 responses, so the killed partial was discarded
    // and every retry restarted from byte 0.
    //
    // 10 minutes is not a program budget, it is a "this download is never
    // going to finish" backstop: enough for the largest runtime on a poor
    // connection, still bounded so a wedged fetch cannot hang forever.
    LOAD_SOFT_WARN_MS: 45000,
    LOAD_HARD_KILL_MS: 600000,
    // A program printing more than this is looping on output. Rendering it
    // would take the page down long before the user could read any of it.
    MAX_OUTPUT_BYTES: 4 * 1024 * 1024,
    // Sampling interval for the watchdog.
    TICK_MS: 500,
    // Heap growth across the sample window that counts as "climbing fast".
    MEM_GROWTH_MB: 220,
    MEM_SAMPLES: 8,
    PREFIX: 'lab.'
  };

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    gate: $('lab-gate'), gateAgree: $('lab-agree'), gateLeave: $('lab-leave'),
    select: $('lab-lang'), run: $('lab-run'), stop: $('lab-stop'),
    status: $('lab-status'), warn: $('lab-warn'), warnText: $('lab-warn-text'),
    warnKill: $('lab-warn-kill'),
    editor: $('lab-editor'), terminal: $('lab-terminal'), stdin: $('lab-stdin'),
    stdinPane: $('lab-stdin-pane'), fileLabel: $('lab-file'), engine: $('lab-engine'),
    persist: $('lab-persist'), reset: $('lab-reset'),
    storeBtn: $('lab-storage-btn'), storePanel: $('lab-storage-panel'),
    storeRing: $('lab-meter-value'), storeSite: $('lab-store-site'),
    storeQuota: $('lab-store-quota'), storeBar: $('lab-store-bar'),
    storeClear: $('lab-store-clear')
  };

  var current = lab.getAttribute('data-lang') || 'javascript';
  var jar = null;
  var worker = null;
  var workerLang = null;   // which language the live worker has loaded
  var running = false;

  function setStatus(text, cls) {
    // #lab-status is a live region (see initStatusLive). Rewriting it with the
    // text it already holds is still a mutation, and a screen reader would
    // read the same sentence a second time — so only touch it when it moved.
    if (el.status.textContent !== text) el.status.textContent = text;
    el.status.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  /* The status line carries the only running commentary this lab has —
     "Running…", "Finished with errors", "Stopped", "gave up waiting for the
     download" — and none of it reached anyone using a screen reader: it is a
     plain <span> that JavaScript rewrites, which is silent by definition.
     Sighted users were told; everyone else pressed Run and got nothing.

     role="status" is the right role (a passive, advisory region), and the
     explicit aria-live spells out the same thing for the combinations that
     honour the attribute but not the implicit value. Polite, never assertive:
     none of this is urgent, and an assertive region would interrupt the user
     mid-sentence while they read their own output.

     Two things keep it from becoming noise rather than help. setStatus above
     ignores a write that does not change the text, so a repeated state cannot
     announce twice. And download progress deliberately does NOT come through
     here — it goes to the progress bar, which is a progressbar precisely
     because those are not announced as they change. Four announcements a
     second for a minute would be far worse than the silence it replaced.

     Called after the first setStatus has already painted "Ready", so that
     initial text is not announced as though something had just happened. */
  function initStatusLive() {
    if (!el.status) return;
    el.status.setAttribute('role', 'status');
    el.status.setAttribute('aria-live', 'polite');
  }

  /* ========================================================================
     2. Site-scoped storage
     --------------------------------------------------------------------
     Every key this app writes is prefixed, so "clear site data" can find and
     remove exactly what the lab owns and nothing else the site (or another
     site on this browser) may have stored.
     ======================================================================== */

  var store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem(CFG.PREFIX + key);
        return v === null ? fallback : v;
      } catch (err) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(CFG.PREFIX + key, value); } catch (err) { /* quota or private mode */ }
    },
    remove: function (key) {
      try { localStorage.removeItem(CFG.PREFIX + key); } catch (err) {}
    },
    ownKeys: function () {
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(CFG.PREFIX) === 0) keys.push(k);
        }
      } catch (err) {}
      return keys;
    },
    ownBytes: function () {
      return this.ownKeys().reduce(function (total, k) {
        var v = '';
        try { v = localStorage.getItem(k) || ''; } catch (err) {}
        // UTF-16 in practice, so 2 bytes per code unit for key and value.
        return total + (k.length + v.length) * 2;
      }, 0);
    }
  };

  function humanBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  /* ========================================================================
     3. Terminal output
     --------------------------------------------------------------------
     Output arrives one postMessage per print. Appending a DOM node each time
     makes a chatty program janky and a runaway one fatal, so writes are
     buffered and flushed once per frame, and consecutive writes of the same
     class are merged into a single text node.
     ======================================================================== */

  var pending = [];
  var flushQueued = false;
  var outputBytes = 0;
  var outputCapped = false;

  function flush() {
    flushQueued = false;
    if (!pending.length) return;

    var frag = document.createDocumentFragment();
    var run = null;
    pending.forEach(function (item) {
      if (run && run.cls === item.cls) { run.text += item.text; return; }
      if (run) frag.appendChild(makeSpan(run));
      run = { cls: item.cls, text: item.text };
    });
    if (run) frag.appendChild(makeSpan(run));
    pending = [];

    // Stick to the bottom only if the user has not scrolled up to read.
    var atBottom = el.terminal.scrollHeight - el.terminal.scrollTop - el.terminal.clientHeight < 40;
    el.terminal.appendChild(frag);
    if (atBottom) el.terminal.scrollTop = el.terminal.scrollHeight;
  }

  function makeSpan(run) {
    var span = document.createElement('span');
    span.className = run.cls;
    span.textContent = run.text;
    return span;
  }

  function write(text, cls) {
    if (outputCapped) return;
    outputBytes += text.length;
    if (outputBytes > CFG.MAX_OUTPUT_BYTES) {
      outputCapped = true;
      pending.push({
        cls: 't-err',
        text: '\n[output limit reached — ' + humanBytes(CFG.MAX_OUTPUT_BYTES) +
              '. The program was still printing, so it has been stopped.]\n'
      });
      stopRun('output limit');
    } else {
      pending.push({ cls: cls || 't-out', text: text });
    }
    if (!flushQueued) {
      flushQueued = true;
      // setTimeout rather than requestAnimationFrame: rAF is paused in a
      // hidden tab, so a program run just before switching away would print
      // nothing until the user came back.
      setTimeout(flush, 16);
    }
  }

  function clearTerminal() {
    pending = [];
    outputBytes = 0;
    outputCapped = false;
    el.terminal.textContent = '';
    hideFailure();
  }

  /* ========================================================================
     4. Resource watchdog
     --------------------------------------------------------------------
     A tight `while (true) {}` cannot be interrupted from inside — not in a
     worker, not anywhere. The only reliable remedy is worker.terminate()
     from the main thread, which is why every run happens in a worker and why
     the main thread never blocks on it.

     It runs in two phases, because "taking a long time" means two different
     things. Until the worker reports the runtime is ready the page is waiting
     on a download the visitor cannot influence; after that it is waiting on
     their program. Only the second deserves the tight limits and the
     infinite-loop wording — see startWatchdog() and beginExecPhase().

     The watchdog escalates rather than killing silently:
       load:  elapsed > LOAD_SOFT_WARN_MS -> "still downloading" banner
              elapsed > LOAD_HARD_KILL_MS -> gave up on the download
       exec:  elapsed > SOFT_WARN_MS      -> amber banner + prominent Cancel
              heap climbing across window -> banner says memory, not just time
              elapsed > HARD_KILL_MS      -> terminated
       both:  output over the byte cap    -> stopped immediately (see write())
     ======================================================================== */

  var watchdog = { timer: null, started: 0, warned: false, samples: [], phase: 'load' };

  function memoryMB() {
    // performance.memory is Chromium-only and non-standard. Where it is
    // missing the watchdog still works, just on time and output alone.
    var m = window.performance && window.performance.memory;
    return m ? m.usedJSHeapSize / (1024 * 1024) : null;
  }

  function showWarning(message) {
    el.warnText.textContent = message;
    el.warn.hidden = false;
  }

  function hideWarning() {
    el.warn.hidden = true;
    el.warnText.textContent = '';
  }

  /* ------------------------------------------------------------------------
     Runtime failure banner — the wording, markup and retry button live in
     assets/js/labs/lab-fail.js, shared with the v86 and sql.js labs.
     ---------------------------------------------------------------------- */
  function runtimeName(lang) {
    var meta = LAB_RUNTIMES[lang];
    return ((meta && meta.name) || lang) + ' runtime';
  }

  function showFailure(info) {
    if (!window.LabFail) return;   // page did not include lab-fail.js
    window.LabFail.show({
      anchor: el.terminal,
      what: runtimeName((info && info.lang) || current),
      kind: info && info.kind,
      retry: function () {
        // A runtime that died half-way can leave the worker holding a broken
        // module, so the retry starts a new worker rather than reusing it.
        killWorker();
        run();
      }
    });
  }

  function hideFailure() {
    if (window.LabFail) window.LabFail.hide();
  }

  /* ------------------------------------------------------------------------
     Download progress bar
     ------------------------------------------------------------------------
     The C and C++ lab fetches about 19 MB of clang and lld before the first
     compile finishes — 30 to 65 seconds on a typical 4G connection. Until now
     that was one static status string, and a slow download looked exactly
     like a hung page. lab-worker.js counts the bytes; this draws them.

     Built here rather than written into markup because eleven lab pages would
     otherwise carry eleven copies of an element that only two of them ever
     show, and they would drift. Styled inline for the same reason: labs.css
     does not know this element exists, so no rule there can move it and no
     rule here can disturb the toolbar — which, hidden, it does not occupy at
     all. Colours go through the same custom properties the rest of the
     toolbar uses, so it follows the theme rather than fighting it.

     role="progressbar", NOT a live region. A progress bar is read when the
     user asks for it, not announced every time it moves, which is exactly
     right for a value that ticks four times a second. The coarse state is
     what gets announced, and that belongs to #lab-status.
     ---------------------------------------------------------------------- */

  var progressEl = null;
  var progressFill = null;
  var progressText = null;

  function buildProgress() {
    if (!el.status || !el.status.parentNode) return;   // no toolbar: no bar

    progressEl = document.createElement('span');
    progressEl.id = 'lab-progress';
    progressEl.className = 'lab-progress';
    progressEl.setAttribute('role', 'progressbar');
    progressEl.setAttribute('aria-label', 'Runtime download');
    progressEl.setAttribute('aria-valuemin', '0');
    progressEl.setAttribute('aria-valuemax', '100');
    progressEl.style.alignItems = 'center';
    progressEl.style.gap = '0.45rem';
    progressEl.style.fontFamily = "'Cascadia Code', 'Fira Code', Consolas, Menlo, monospace";
    progressEl.style.fontSize = '0.72rem';
    progressEl.style.color = 'var(--ink-4)';

    var track = document.createElement('span');
    track.style.display = 'inline-block';
    track.style.width = '7rem';
    track.style.maxWidth = '35vw';
    track.style.height = '0.4rem';
    track.style.borderRadius = '999px';
    track.style.overflow = 'hidden';
    track.style.background = 'rgb(var(--accent-rgb) / 0.18)';

    // No width transition on purpose: the value already moves four times a
    // second, so a tween would only make it lag behind the number beside it.
    progressFill = document.createElement('i');
    progressFill.style.display = 'block';
    progressFill.style.height = '100%';
    progressFill.style.width = '0%';
    progressFill.style.background = '#14b8a6';   // the Run button's teal

    // aria-hidden because the same figure is on the progressbar itself as
    // aria-valuetext; without this it would be read out twice.
    progressText = document.createElement('span');
    progressText.setAttribute('aria-hidden', 'true');

    track.appendChild(progressFill);
    progressEl.appendChild(track);
    progressEl.appendChild(progressText);
    hideProgress();
    el.status.parentNode.insertBefore(progressEl, el.status.nextSibling);
  }

  /* display is toggled as well as `hidden`, not instead of it. `hidden` works
     by setting display:none in the UA stylesheet, and an inline display of
     our own would outrank it — so the two have to be kept in step or the bar
     would never go away. */
  function hideProgress() {
    if (!progressEl) return;
    progressEl.hidden = true;
    progressEl.style.display = 'none';
  }

  function updateProgress(msg) {
    if (!progressEl) return;
    if (msg.done) { hideProgress(); return; }

    progressEl.hidden = false;
    progressEl.style.display = 'inline-flex';
    if (msg.label) progressEl.setAttribute('aria-label', 'Downloading ' + msg.label);

    var loaded = msg.loaded || 0;
    var total = msg.total || 0;

    if (total > 0) {
      var pct = Math.max(0, Math.min(100, (loaded / total) * 100));
      var readout = humanBytes(loaded) + ' of ' + humanBytes(total);
      progressFill.style.width = pct.toFixed(1) + '%';
      progressText.textContent = readout;
      progressEl.setAttribute('aria-valuenow', String(Math.round(pct)));
      progressEl.setAttribute('aria-valuetext', readout + ' downloaded');
    } else {
      // The worker could not learn a size — no Content-Length, or a browser
      // with no readable stream to count. A percentage would be invented, so
      // show the one figure that is true: bytes so far. It keeps climbing,
      // which is the entire question a stuck-looking page raises.
      progressFill.style.width = '0%';
      progressText.textContent = loaded ? humanBytes(loaded) + ' downloaded…' : 'Starting…';
      progressEl.removeAttribute('aria-valuenow');   // absent = indeterminate
      progressEl.setAttribute('aria-valuetext',
        loaded ? humanBytes(loaded) + ' downloaded' : 'Starting');
    }
  }

  /* The watchdog runs in two phases.

     'load' covers fetching and instantiating the runtime — generous limits,
     and wording that talks about the download. 'exec' covers the visitor's
     program — the tight limits, and the infinite-loop wording.

     beginExecPhase() is what moves between them, driven by the worker's
     'exec' message (lab-worker.js posts it the moment a runtime is ready).
     It restarts the clock, so a 40-second download does not eat into the
     60 seconds the program itself is entitled to. */
  function startWatchdog() {
    watchdog.started = Date.now();
    watchdog.warned = false;
    watchdog.samples = [];
    watchdog.phase = 'load';
    stopWatchdogTimer();
    watchdog.timer = setInterval(function () {
      var elapsed = Date.now() - watchdog.started;
      var loading = watchdog.phase === 'load';
      var softMs = loading ? CFG.LOAD_SOFT_WARN_MS : CFG.SOFT_WARN_MS;
      var killMs = loading ? CFG.LOAD_HARD_KILL_MS : CFG.HARD_KILL_MS;

      var mb = memoryMB();
      if (mb !== null) {
        watchdog.samples.push(mb);
        if (watchdog.samples.length > CFG.MEM_SAMPLES) watchdog.samples.shift();
      }

      // Memory climbing steeply across the whole sample window is the signal
      // that matters most: it means the program is allocating without bound
      // and will end in an out-of-memory kill if it is left alone.
      //
      // Only while the program is the thing running, though. Instantiating a
      // runtime legitimately claims hundreds of megabytes — Pyodide and the
      // clang toolchain both clear MEM_GROWTH_MB on their own during load —
      // and warning there would blame the visitor's code for the allocation
      // of a compiler it did not ask for and cannot shrink.
      if (!loading && watchdog.samples.length === CFG.MEM_SAMPLES) {
        var growth = watchdog.samples[watchdog.samples.length - 1] - watchdog.samples[0];
        if (growth > CFG.MEM_GROWTH_MB && !watchdog.warned) {
          watchdog.warned = true;
          showWarning(
            'This program is allocating memory very quickly (about ' +
            Math.round(growth) + ' MB in the last few seconds). It will run out ' +
            'of memory if it keeps going. Everything is happening in this tab, ' +
            'so cancelling is safe.'
          );
          return;
        }
      }

      if (elapsed > killMs) {
        if (loading) {
          // Never phrased as the program failing: it never started.
          write('\n[gave up waiting for the ' + runtimeName(current) +
                ' to download]\n', 't-err');
          showFailure({ kind: 'network', lang: current });
          stopRun('download timed out');
        } else {
          write('\n[stopped automatically after ' + Math.round(killMs / 1000) +
                ' seconds — the program never finished]\n', 't-err');
          stopRun('time limit');
        }
        return;
      }

      if (elapsed > softMs && !watchdog.warned) {
        watchdog.warned = true;
        showWarning(
          loading
            ? 'Still downloading the ' + runtimeName(current) + ' after ' +
              Math.round(elapsed / 1000) + ' seconds. It is a large one-time download and ' +
              'it is cached afterwards, so later runs start immediately. Nothing is wrong ' +
              'with your code — it has not run yet.'
            : 'Still running after ' + Math.round(elapsed / 1000) + ' seconds. If this ' +
              'was not meant to take long, it is probably an infinite loop. It will be ' +
              'stopped automatically at ' + Math.round(killMs / 1000) + 's.'
        );
      }
    }, CFG.TICK_MS);
  }

  /* The runtime is up; everything from here is the visitor's program. */
  function beginExecPhase(text) {
    if (!running) return;
    watchdog.phase = 'exec';
    watchdog.started = Date.now();
    watchdog.warned = false;
    watchdog.samples = [];
    hideWarning();
    // Whatever was downloading has arrived, or this phase would not have
    // started. A bar left on screen would sit at its last value for the whole
    // run and read as a download that never finished.
    hideProgress();
    if (text) setStatus(text, 'is-busy');
  }

  function stopWatchdogTimer() {
    if (watchdog.timer) { clearInterval(watchdog.timer); watchdog.timer = null; }
  }

  /* ========================================================================
     5. Runner
     ======================================================================== */

  /* True when the live worker is a one-shot blob worker running the visitor's
     JavaScript, rather than a language runtime deliberately kept warm.

     The distinction decides everything below. js-sandbox.js reports 'done' as
     soon as top-level code returns, and leaves the worker alive on purpose so
     later setTimeout/setInterval output still arrives. A generic worker is
     ALSO alive after a run — but for the opposite reason: it is holding an
     instantiated runtime so the next Run costs 3ms instead of 3535ms. Treating
     those two the same is how a naive "reap any surviving worker" fix throws
     away the Python cache and relabels a successful run as "Stopped".

     _blobUrl is set only in runInBlobWorker, never by newGenericWorker, so it
     is an exact discriminator rather than a guess. */
  function hasLiveBlobWorker() {
    return !!(worker && worker._blobUrl);
  }

  function killWorker() {
    if (worker) {
      worker.terminate();       // the only thing that stops a wedged program
      if (worker._blobUrl) URL.revokeObjectURL(worker._blobUrl);
      worker = null;
    }
    workerLang = null;
  }

  function finishRun(ok, ms, note, loadFailed) {
    // A completed run means the runtime downloaded and instantiated, which is
    // exactly when the storage meter's figure becomes true. A run that ended
    // because the runtime never arrived proves the opposite, so it must not
    // bank bytes that are not on disk.
    if (!note && !loadFailed) markRuntimeFetched(current);
    running = false;
    stopWatchdogTimer();
    hideWarning();
    hideProgress();
    el.run.disabled = false;
    // "Finished" on the JS path means top-level code returned, not that the
    // program is over — timers keep printing. Leaving Stop greyed out there
    // made the only control that could reap the worker unreachable, so a
    // setInterval ran until the visitor reloaded, and the output-cap message
    // ("it has been stopped") was simply untrue.
    el.stop.disabled = !hasLiveBlobWorker();
    flush();
    if (note) setStatus(note, 'is-err');
    else if (ok) setStatus('Finished in ' + ms + ' ms', 'is-ok');
    else setStatus('Finished with errors', 'is-err');
  }

  function stopRun(reason) {
    // The second clause is the orphan case: the run already "finished" but a
    // blob worker is still alive with timers. Deliberately NOT `|| worker` —
    // that would also fire for a warm runtime worker and destroy the cache.
    if (!running && !hasLiveBlobWorker()) return;
    var orphan = !running;
    killWorker();
    // An orphaned worker's run already reported its own outcome; overwriting
    // "Finished in 3 ms" with "Stopped" would be a lie about the program.
    // Say what actually happened: the leftover timers were stopped.
    if (orphan) {
      el.stop.disabled = true;
      hideProgress();
      setStatus('Timers stopped', 'is-ok');
      return;
    }
    finishRun(false, 0, reason === 'user' ? 'Stopped' : 'Stopped (' + reason + ')');
  }

  // Bump when lab-worker.js changes. Browsers cache worker scripts in a store
  // separate from the normal HTTP cache — a plain reload does not refresh
  // them, so without a version in the URL a deployed fix can keep running the
  // previous worker for as long as the entry survives.
  var WORKER_VERSION = '2026-08-26-1';

  function newGenericWorker() {
    var w = new Worker('/assets/js/labs/lab-worker.js?v=' + WORKER_VERSION);
    w.onmessage = function (event) {
      var msg = event.data || {};
      if (msg.type === 'out') write(msg.text, msg.cls);
      else if (msg.type === 'status') setStatus(msg.text, 'is-busy');
      // Byte counts for a large runtime. Kept out of setStatus deliberately:
      // the status line is announced, and this fires four times a second.
      else if (msg.type === 'progress') updateProgress(msg);
      // The runtime finished downloading: from here the clock times the
      // visitor's program, not their connection.
      else if (msg.type === 'exec') beginExecPhase(msg.text);
      else if (msg.type === 'done') {
        if (msg.failure) showFailure(msg.failure);
        finishRun(msg.ok, msg.ms, null, !!msg.failure);
      }
      else if (msg.type === 'transpiled') onTranspiled(msg);
    };
    w.onerror = function (event) {
      // Reaching here means the worker script itself never started \u2014 the
      // worker's own try/catch reports everything after that point.
      write('Runtime error: ' + (event.message || 'worker failed to start') + '\n', 't-err');
      showFailure({ kind: 'network', lang: current });
      finishRun(false, 0, null, true);
    };
    return w;
  }

  // JavaScript and TypeScript both end up here: the program becomes the
  // source of a Blob worker, so no eval() and no 'unsafe-eval' in the CSP.
  var sandboxSource = null;

  function runInBlobWorker(js) {
    var start = function (preamble) {
      var source = preamble.replace(/__LAB_STDIN__/g, JSON.stringify(el.stdin.value)) +
                   '\n' + js + '\n';
      var url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      killWorker();
      worker = new Worker(url);
      worker._blobUrl = url;
      var t0 = Date.now();
      worker.onmessage = function (event) {
        var msg = event.data || {};
        if (msg.type === 'out') write(msg.text, msg.cls);
        else if (msg.type === 'done') finishRun(msg.ok, Date.now() - t0);
      };
      worker.onerror = function (event) {
        write(String(event.message || 'Script error') + '\n', 't-err');
        finishRun(false, Date.now() - t0);
      };
      // JavaScript has no runtime to download, and TypeScript has already
      // paid for its compiler by the time it reaches here — either way the
      // program starts now, so the clock starts now.
      beginExecPhase('Running…');
    };

    if (sandboxSource) { start(sandboxSource); return; }
    fetch('/assets/js/labs/js-sandbox.js')
      .then(function (r) { return r.text(); })
      .then(function (text) { sandboxSource = text; start(text); })
      .catch(function (err) {
        write('Could not load the sandbox: ' + err + '\n', 't-err');
        showFailure({ kind: 'network', lang: current });
        finishRun(false, 0, null, true);
      });
  }

  function onTranspiled(msg) {
    if (!msg.js) {
      if (msg.failure) showFailure(msg.failure);
      finishRun(false, 0, null, !!msg.failure);
      return;
    }
    killWorker();
    runInBlobWorker(msg.js);
  }

  function run() {
    if (running) return;
    var code = jar ? jar.toString() : el.editor.textContent;
    var meta = LAB_RUNTIMES[current];

    running = true;
    el.run.disabled = true;
    el.stop.disabled = false;
    clearTerminal();
    hideWarning();
    hideProgress();     // a bar left over from a previous run is a lie
    setStatus('Starting…', 'is-busy');
    startWatchdog();

    if (meta.mode === 'jsblob' && current === 'javascript') {
      runInBlobWorker(code);
      return;
    }

    // Reuse the worker when the language has not changed. A worker keeps its
    // instantiated runtime in memory, so a second Run of the same language
    // costs milliseconds instead of seconds — measured at 3535ms for a cold
    // Python and 3ms for the next run in the same worker. Discarding it every
    // time also made the "Downloading CPython…" status reappear on every run,
    // which read as though nothing was ever being cached.
    if (!worker || workerLang !== current) {
      killWorker();
      worker = newGenericWorker();
      workerLang = current;
    }
    if (meta.mode === 'jsblob') {
      // TypeScript: compile in the generic worker, then run the emitted JS.
      worker.postMessage({ type: 'transpile', code: code });
    } else {
      worker.postMessage({ type: 'run', lang: current, code: code, stdin: el.stdin.value });
    }
  }

  /* ========================================================================
     6. Editor
     ======================================================================== */

  function highlight(editor) {
    var grammar = Prism.languages[LAB_RUNTIMES[current].prism] || Prism.languages.clike;
    editor.innerHTML = Prism.highlight(editor.textContent, grammar, LAB_RUNTIMES[current].prism);
  }

  function initEditor(code) {
    if (jar) { jar.destroy(); jar = null; }
    el.editor.textContent = code;
    jar = CodeJar(el.editor, highlight, { tab: '    ', indentOn: /[({[]$/ });
    jar.onUpdate(function (value) {
      if (el.persist.getAttribute('aria-pressed') === 'true') {
        store.set('code.' + current, value);
      }
    });
  }

  /* ========================================================================
     7. Consent gate
     --------------------------------------------------------------------
     Covers the lab panel only — never the article. A full-page interstitial
     is what Google's intrusive-interstitial guidance penalises on mobile,
     and it would hide the content these pages exist to rank for.
     ======================================================================== */

  /* The gate is only a painted panel. .lab-gate is position:absolute with a
     94%-opaque background, so everything underneath it stays in the tab order
     and in the accessibility tree: a keyboard user could Tab straight past the
     two gate buttons into the editor, the toolbar and the storage controls —
     about ten controls they cannot see, with the focus ring drawn behind the
     scrim, and a screen reader happily reading out a lab they have not agreed
     to enter yet.

     `inert` is the native one-property fix: it removes a subtree from focus,
     from hit-testing and from assistive technology at once. It goes on .lab's
     children rather than on .lab itself, because the gate lives inside .lab
     and has to stay usable. Browsers without inert support (pre-2022) simply
     ignore the property — the page behaves exactly as it does today, so this
     cannot regress anything. */
  function setLabInert(on) {
    if (!el.gate) return;              // no gate on this page: never inert anything
    var kids = lab.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] === el.gate) continue;
      kids[i].inert = on;
    }
  }

  function initGate() {
    if (store.get('consent') === 'yes') {
      lab.setAttribute('data-consent', 'granted');
      return;
    }
    setLabInert(true);
    el.gateAgree.addEventListener('click', function () {
      store.set('consent', 'yes');
      lab.setAttribute('data-consent', 'granted');
      setLabInert(false);
      el.editor.focus();
    });
    el.gateLeave.addEventListener('click', function () {
      window.location.href = '/';
    });
  }

  /* ========================================================================
     8. Storage meter
     --------------------------------------------------------------------
     Two numbers, deliberately separated, because only one of them is ours to
     clear: the code and settings this lab wrote (clearable here), and the
     browser's own HTTP cache holding the downloaded runtimes (browser
     managed — no web page can clear another origin's cache, or its own HTTP
     cache, from JavaScript).
     ======================================================================== */

  /* Record that a language's runtime has now been fetched, so the meter can
     report a real figure. navigator.storage.estimate() cannot: the runtimes
     live in the browser's HTTP cache, which the Storage API does not measure
     and no page is allowed to inspect. It reported 0 B against a 1.9 GB quota
     no matter how much had been downloaded, which was worse than saying
     nothing. Summing the known sizes of the runtimes actually used is a number
     we can stand behind. */
  function markRuntimeFetched(id) {
    var meta = LAB_RUNTIMES[id];
    if (!meta || !meta.bytes) return;
    if (store.get('rt.' + id, null) !== null) return;
    store.set('rt.' + id, String(meta.bytes));
    refreshMeter();
  }

  function cachedRuntimeBytes() {
    var total = 0;
    var names = [];
    LAB_LIST.forEach(function (meta) {
      var v = store.get('rt.' + meta.id, null);
      if (v !== null) { total += parseInt(v, 10) || 0; names.push(meta.name); }
    });
    return { bytes: total, names: names };
  }

  // Every runtime downloaded, summed, as a reference for the ring. Roughly what
  // fetching all seven languages plus the Linux image would come to.
  var ALL_RUNTIME_BYTES = 150 * 1024 * 1024;

  function refreshMeter() {
    el.storeSite.textContent = humanBytes(store.ownBytes());

    // Real measured bytes from the service worker's cache, not a guess. The
    // language list beside it comes from what has actually been run here.
    LabCache.stats().then(function (stats) {
      var rt = cachedRuntimeBytes();
      if (stats.unavailable) {
        el.storeQuota.textContent = rt.names.length
          ? '~' + humanBytes(rt.bytes) + ' · ' + rt.names.join(', ')
          : 'none downloaded yet';
      } else if (!stats.files) {
        el.storeQuota.textContent = 'none downloaded yet';
      } else {
        el.storeQuota.textContent =
          humanBytes(stats.bytes) + ' · ' + stats.files +
          (stats.files === 1 ? ' file' : ' files') +
          (rt.names.length ? ' · ' + rt.names.join(', ') : '');
      }
      var bytes = stats.unavailable ? rt.bytes : stats.bytes;
      var pct = Math.min(100, (bytes / ALL_RUNTIME_BYTES) * 100);
      el.storeBar.style.width = pct.toFixed(1) + '%';
      // 2 * pi * r with r = 8 is a circumference of 50.27.
      el.storeRing.setAttribute('stroke-dasharray', (pct * 0.5027).toFixed(2) + ' 50.27');
    });
  }

  function initStorage() {
    el.storeBtn.addEventListener('click', function () {
      var open = el.storePanel.hidden;
      el.storePanel.hidden = !open;
      el.storeBtn.setAttribute('aria-expanded', String(open));
      if (open) refreshMeter();
    });

    document.addEventListener('click', function (event) {
      if (!el.storePanel.hidden &&
          !el.storePanel.contains(event.target) &&
          !el.storeBtn.contains(event.target)) {
        el.storePanel.hidden = true;
        el.storeBtn.setAttribute('aria-expanded', 'false');
      }
    });

    var clearRuntimes = $('lab-store-clear-rt');
    if (clearRuntimes) {
      clearRuntimes.addEventListener('click', function () {
        clearRuntimes.disabled = true;
        clearRuntimes.textContent = 'Removing…';
        LabCache.clear().then(function () {
          // The "which languages have run" flags describe a cache that no
          // longer exists, so they go with it.
          LAB_LIST.forEach(function (m) { store.remove('rt.' + m.id); });
          clearRuntimes.disabled = false;
          clearRuntimes.textContent = 'Remove downloaded runtimes';
          refreshMeter();
          write('\n[removed the downloaded runtimes — the next run will fetch them again]\n', 't-info');
        });
      });
    }

    el.storeClear.addEventListener('click', function () {
      store.ownKeys().forEach(function (k) {
        try { localStorage.removeItem(k); } catch (err) {}
      });
      el.persist.setAttribute('aria-pressed', 'false');
      lab.setAttribute('data-consent', 'granted'); // don't re-gate mid-session
      setLabInert(false);                          // ...and don't leave it inert either
      refreshMeter();
      write('\n[cleared this site’s saved code and settings]\n', 't-info');
    });

    refreshMeter();
  }

  /* ========================================================================
     9. Language switching & boot
     ======================================================================== */

  /* Set the panel up for a language that is ALREADY the page's language.
     This never rewrites the URL any more — see the select handler in
     initToolbar for why. */
  function applyLanguage(id) {
    current = id;
    var meta = LAB_RUNTIMES[id];
    lab.setAttribute('data-lang', id);
    el.select.value = id;
    if (el.fileLabel) el.fileLabel.textContent = 'main' + fileExt(id);
    if (el.engine) el.engine.textContent = meta.engine;
    el.stdinPane.hidden = !meta.stdin;

    initEditor(store.get('code.' + id, meta.sample));
    clearTerminal();
    // "to download" rather than a bare size: meta.size is the over-the-wire
    // figure, and "~19 MB first run" read to more than one person as the size
    // of the page rather than of a one-time download.
    setStatus('Ready — ' + meta.size + ' to download on the first run, then cached');
    // store.get returns its fallback when the key is absent, and the fallback
    // defaults to undefined — so comparing against null marked every language
    // as already pinned, and the first click then *deleted* instead of saving.
    el.persist.setAttribute('aria-pressed',
      store.get('code.' + id, null) === null ? 'false' : 'true');
  }

  // All eleven languages, not the seven this used to list: php, ruby, perl and
  // postgres fell through to the '.txt' fallback, so the editor tab on
  // /labs/php read "main.txt".
  function fileExt(id) {
    return { javascript: '.js', typescript: '.ts', python: '.py', c: '.c',
             cpp: '.cpp', sql: '.sql', lua: '.lua', php: '.php', ruby: '.rb',
             perl: '.pl', postgres: '.sql' }[id] || '.txt';
  }

  /* Fullscreen. The real Fullscreen API rather than a CSS fake, so Esc is
     handled by the browser itself — it behaves the way people already expect,
     and nothing we write can trap them in it. */
  function initFullscreen() {
    var btn = $('lab-fullscreen');
    if (!btn) return;

    var supported = !!(lab.requestFullscreen || lab.webkitRequestFullscreen);
    if (!supported) { btn.hidden = true; return; }

    btn.addEventListener('click', function () {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (fsEl) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        (lab.requestFullscreen || lab.webkitRequestFullscreen).call(lab);
      }
    });

    function sync() {
      var on = (document.fullscreenElement || document.webkitFullscreenElement) === lab;
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen (Esc to exit)';
      // CodeJar measures the editor on focus; nudge it after the resize so the
      // caret lands where the user clicks rather than at the old geometry.
      if (on) setTimeout(function () { el.editor.focus(); }, 60);
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  /* Phone-only pane tabs. The buttons are hidden by CSS above 900px, so this
     just keeps data-pane and aria-selected in step at every width. */
  function initTabs() {
    var tabs = lab.querySelectorAll('.lab-tab');
    if (!tabs.length) return;

    function select(pane) {
      lab.setAttribute('data-pane', pane);
      Array.prototype.forEach.call(tabs, function (t) {
        t.setAttribute('aria-selected', String(t.getAttribute('data-pane') === pane));
      });
    }

    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener('click', function () { select(t.getAttribute('data-pane')); });
    });

    // Running is a request to see output; on a phone that pane is hidden, so
    // switch to it rather than leaving the user looking at an idle editor.
    el.run.addEventListener('click', function () {
      if (window.matchMedia('(max-width: 900px)').matches) select('output');
    });
  }

  function initToolbar() {
    LAB_LIST.forEach(function (meta) {
      var option = document.createElement('option');
      option.value = meta.id;
      option.textContent = meta.name;
      el.select.appendChild(option);
    });

    /* Switching language is a real navigation, not an in-page swap.
       This used to pushState the new /labs/<slug> and re-skin the panel, which
       left every other thing on the page describing the language the visitor
       had just left: the h1 above the editor, the "How to run X online" prose,
       the worked examples, the FAQ, the breadcrumb and — worst for search —
       <link rel=canonical>, which then pointed a Python URL at the JavaScript
       page. Only the panel and the tab title ever caught up.
       Each target is a real, pre-rendered page with its own correct copy, and
       the runtimes are service-worker cached, so the load costs a document and
       nothing else. */
    el.select.addEventListener('change', function () {
      var meta = LAB_RUNTIMES[el.select.value];
      if (!meta) return;
      stopRun('user');
      window.location.href = '/labs/' + meta.slug;
    });

    el.run.addEventListener('click', run);
    el.stop.addEventListener('click', function () { stopRun('user'); });
    el.warnKill.addEventListener('click', function () { stopRun('user'); });

    el.persist.addEventListener('click', function () {
      var on = el.persist.getAttribute('aria-pressed') === 'true';
      if (on) {
        store.remove('code.' + current);
        el.persist.setAttribute('aria-pressed', 'false');
      } else {
        store.set('code.' + current, jar.toString());
        el.persist.setAttribute('aria-pressed', 'true');
      }
      refreshMeter();
    });

    el.reset.addEventListener('click', function () {
      stopRun('user');
      store.remove('code.' + current);
      el.persist.setAttribute('aria-pressed', 'false');
      initEditor(LAB_RUNTIMES[current].sample);
      clearTerminal();
      el.stdin.value = '';
      setStatus('Reset to the starter program');
      refreshMeter();
    });

    // Ctrl/Cmd+Enter runs, matching every other editor people use.
    lab.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        run();
      }
    });

    initFullscreen();
    initTabs();
    // No popstate listener: nothing pushes state any more, so Back is a
    // normal document navigation the browser handles by itself.
    //
    // Back out of a bfcache restore is the one case that still needs help.
    // Switching language now leaves the page, so the picker is sitting on the
    // language we navigated AWAY to; a bfcache restore replays the DOM exactly
    // as it was and re-runs no script, so /labs/python came back with "Ruby"
    // showing above a Python editor. The old in-page swap never had this
    // because popstate called applyLanguage, which reset the picker.
    // Assigning .value does not fire 'change', so this cannot re-navigate.
    window.addEventListener('pageshow', function (event) {
      if (event.persisted && el.select.value !== current) el.select.value = current;
    });
  }

  LabCache.register();
  initGate();
  initToolbar();
  initStorage();
  buildProgress();
  applyLanguage(current);
  // Last, so applyLanguage's opening "Ready — …" is painted before the element
  // becomes a live region and is therefore not announced on arrival.
  initStatusLive();
})();

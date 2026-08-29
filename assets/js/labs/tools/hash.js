/* ==========================================================================
   hash.js — hashing, HMAC, verification and hash identification.
   --------------------------------------------------------------------------
   Text is hashed with WebCrypto — the browser's own audited implementations.
   Files are streamed through hash-engines.js instead, because WebCrypto
   cannot hash anything it is not handed whole. See the note on size below.

   MD5 is not in WebCrypto — deliberately, because it is broken for anything
   security-critical — but forensics still runs into it constantly in old
   evidence manifests and malware feeds, so it ships here, clearly labelled
   as unsafe for integrity claims.

   Nothing is uploaded: the file is read and hashed in this tab. That is the
   difference between this and every other online hash tool, and it is the
   entire reason it is safe to drop evidence into.

   THERE IS NO FILE SIZE LIMIT, and that took work. crypto.subtle.digest() is
   one-shot — it wants the whole message as a single ArrayBuffer — so the old
   version read the file into memory with FileReader and then let a pure-JS MD5
   allocate a second padded copy of it. Peak memory ran to roughly twice the
   file size, which is why there used to be a 256 MB ceiling here.

   Files now stream: hash-worker.js pulls the file through in 4 MB chunks and
   feeds each chunk to five incremental engines (hash-engines.js), so memory
   stays flat whatever the size and the main thread keeps painting. A 40 GB
   disk image is a progress bar, not a crash.

   Text and text-keyed HMAC still use WebCrypto, which is the browser's own
   audited code and the right choice when the input is small enough to hold.
   ========================================================================== */

/* global LabTool, HashEngines */
(function () {
  'use strict';

  /* ---- MD5 -------------------------------------------------------------
     Not in WebCrypto — deliberately, because it is broken for anything
     security-critical — but forensics runs into it constantly in old evidence
     manifests, so it comes from hash-engines.js along with the streaming
     implementations, rather than being written a second time here. */
  function md5(bytes) {
    var h = HashEngines.create('md5');
    h.update(bytes);
    return h.digest();
  }

  /* ---- hash identification --------------------------------------------- */
  var SHAPES = [
    { re: /^[a-f0-9]{32}$/i,  names: 'MD5, MD4, NTLM or LM — 128 bits' },
    { re: /^[a-f0-9]{40}$/i,  names: 'SHA-1 or RIPEMD-160 — 160 bits' },
    { re: /^[a-f0-9]{56}$/i,  names: 'SHA-224 or SHA3-224 — 224 bits' },
    { re: /^[a-f0-9]{64}$/i,  names: 'SHA-256, SHA3-256 or BLAKE2s — 256 bits' },
    { re: /^[a-f0-9]{96}$/i,  names: 'SHA-384 or SHA3-384 — 384 bits' },
    { re: /^[a-f0-9]{128}$/i, names: 'SHA-512, SHA3-512 or BLAKE2b — 512 bits' },
    { re: /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, names: 'bcrypt' },
    { re: /^\$argon2(id|i|d)\$/, names: 'Argon2' },
    { re: /^\$6\$/, names: 'SHA-512 crypt (Linux /etc/shadow)' },
    { re: /^\$5\$/, names: 'SHA-256 crypt (Linux /etc/shadow)' },
    { re: /^\$1\$/, names: 'MD5 crypt' },
    { re: /^\$y\$/, names: 'yescrypt (modern Linux /etc/shadow)' },
    { re: /^[A-Za-z0-9+/]{43}=$/, names: 'base64-encoded 256-bit digest' }
  ];

  function identify(text) {
    var value = String(text).trim();
    if (!value) return null;
    for (var i = 0; i < SHAPES.length; i++) {
      if (SHAPES[i].re.test(value)) return SHAPES[i].names;
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  var out = LabTool.out('tool-out');
  var lastFile = null;
  var lastName = '';

  function encoder(text) { return new TextEncoder().encode(text); }

  async function webHash(algo, bytes) {
    var digest = await crypto.subtle.digest(algo, bytes);
    return LabTool.toHex(new Uint8Array(digest));
  }

  /* ---- the streaming worker ---------------------------------------------
     Created on first use rather than at load, so a visitor who only ever
     pastes text never pays for it. If a second file arrives while one is still
     hashing, the worker is terminated outright rather than queued: the first
     result is not wanted any more, and a multi-gigabyte hash left running in
     the background would keep a core busy for minutes after the visitor moved
     on. */
  var worker = null;

  /* Bumped whenever hash-worker.js or hash-engines.js changes. `new Worker(url)`
     is fetched under its own URL, so without a version in the query a visitor
     can keep running the previous build's worker for as long as the cached copy
     lives. lab-app.js does the same thing for lab-worker.js, and README says to
     — this file has to obey the same rule, more so than most, because what a
     stale worker here produces is a wrong digest rather than a stale pixel.
     The value rides along to the importScripts() inside the worker too. */
  var WORKER_VERSION = '2026-08-26-1';

  /* Every run gets a number. A worker that is torn down mid-hash can still have
     a 'done' message in flight, and without this the digests from a file the
     visitor already replaced would render over the top of the current run. */
  var runToken = 0;

  /* Thrown into a run that has been replaced. terminate() guarantees the
     worker's onmessage and onerror never fire again, so without settling the
     old promise here it would stay pending forever, holding its File and its
     progress-line closure. run() swallows this one value and nothing else. */
  var SUPERSEDED = { superseded: true };
  var pendingAbort = null;

  function stopWorker() {
    if (pendingAbort) {
      var abort = pendingAbort;
      pendingAbort = null;
      abort(SUPERSEDED);
    }
    if (worker) { worker.terminate(); worker = null; }
  }

  function streamFile(file, hmacKeyBytes, onProgress, algs) {
    var token = ++runToken;
    return new Promise(function (resolve, reject) {
      stopWorker();
      try {
        worker = new Worker('/assets/js/labs/tools/hash-worker.js?v=' + WORKER_VERSION);
      } catch (err) {
        reject(new Error('This browser would not start the background worker, ' +
          'so a file cannot be hashed here. Text mode still works.'));
        return;
      }
      pendingAbort = reject;
      function settle(fn, value) {
        pendingAbort = null;   // cleared first: stopWorker() would fire it
        stopWorker();
        if (token !== runToken) return;   // superseded by a newer run
        fn(value);
      }
      worker.onmessage = function (event) {
        var data = event.data || {};
        if (data.type === 'progress') {
          if (token === runToken && onProgress) onProgress(data.loaded, data.total);
        } else if (data.type === 'done') {
          settle(resolve, data);
        } else if (data.type === 'error') {
          settle(reject, new Error(data.message));
        } else if (data.type === 'cancelled') {
          settle(reject, SUPERSEDED);
        }
      };
      worker.onerror = function () {
        settle(reject, new Error('The hashing worker stopped unexpectedly.'));
      };
      worker.postMessage({
        op: 'file',
        file: file,
        algs: algs || HashEngines.names,
        hmacKey: hmacKeyBytes || null,
        version: WORKER_VERSION
      });
    });
  }

  /* A live progress line appended straight to the output node rather than
     through out.line(), deliberately: out.line() feeds the aria-live announcer,
     and a screen reader reciting a percentage several times a second is
     unusable. The figure is rewritten inside one span, so assistive tech sees a
     single quiet element and the announcer stays free for the result. */
  function progressLine() {
    var span = document.createElement('span');
    span.className = 't-dim';
    out.node.appendChild(span);
    var lastPct = -1;
    return {
      update: function (loaded, total) {
        var pct = total ? Math.floor((loaded / total) * 100) : 0;
        if (pct === lastPct) return;
        lastPct = pct;
        span.textContent = 'hashing               ' + pct + '%  (' +
          LabTool.humanBytes(loaded) + ' of ' + LabTool.humanBytes(total) + ')\n';
      },
      done: function () {
        if (span.parentNode) span.parentNode.removeChild(span);
      }
    };
  }

  function reportDigests(digests) {
    out.row('MD5', digests.md5, 't-warn');
    out.row('SHA-1', digests.sha1, 't-warn');
    out.row('SHA-256', digests.sha256, 't-ok');
    out.row('SHA-384', digests.sha384);
    out.row('SHA-512', digests.sha512);
    out.rule();
    out.dim('MD5 and SHA-1 above are weak: both have practical collision');
    out.dim('attacks and neither should back an integrity claim today. They');
    out.dim('remain here because old evidence manifests are full of them.');

    // Verification against a hash the visitor already holds.
    var expected = document.getElementById('tool-expect').value.trim().toLowerCase();
    if (!expected) return;
    out.rule();
    var matched = Object.keys(digests).filter(function (k) { return digests[k] === expected; });
    if (matched.length) {
      out.ok('MATCH \u2014 the ' + matched.join('/').toUpperCase() + ' digest is identical.');
    } else {
      out.err('NO MATCH \u2014 none of the digests above equal the expected value.');
      var guess = identify(expected);
      if (guess) out.dim('The value you pasted looks like: ' + guess);
    }
  }

  /* Text is small by definition, so it is hashed whole with WebCrypto. */
  async function hashText(bytes, label) {
    out.clear();
    out.heading(label);
    out.row('size', LabTool.humanBytes(bytes.length) + '  (' + bytes.length + ' bytes)');
    out.rule();
    var digests = {
      md5: md5(bytes),
      sha1: await webHash('SHA-1', bytes),
      sha256: await webHash('SHA-256', bytes),
      sha384: await webHash('SHA-384', bytes),
      sha512: await webHash('SHA-512', bytes)
    };
    reportDigests(digests);
  }

  /* Files are streamed. There is no size limit. */
  async function hashFile(file, label) {
    out.clear();
    out.heading(label);
    out.row('size', LabTool.humanBytes(file.size) + '  (' + file.size + ' bytes)');
    out.rule();
    var progress = progressLine();
    progress.update(0, file.size);
    try {
      var result = await streamFile(file, null, progress.update);
      progress.done();
      reportDigests(result.digests);
    } catch (err) {
      progress.done();
      throw err;
    }
  }

  async function hmacText(bytes, keyText, algo) {
    var key = await crypto.subtle.importKey(
      'raw', encoder(keyText), { name: 'HMAC', hash: algo }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', key, bytes);
    return LabTool.toHex(new Uint8Array(sig));
  }

  async function run() {
    var mode = document.getElementById('tool-mode').value;
    var text = document.getElementById('tool-text').value;

    /* Whatever is still hashing belongs to a request the visitor has moved on
       from — switching to text mode, or picking another file. Drop it here so
       a gigabyte-sized run does not keep a core busy for minutes behind a
       result nobody is waiting for. */
    stopWorker();

    try {
      if (mode === 'text') {
        if (!text) { out.clear().warn('Type or paste some text first.'); return; }
        await hashText(encoder(text), 'Text \u2014 ' + text.length + ' characters');
      } else if (mode === 'file') {
        if (!lastFile) { out.clear().warn('Choose or drop a file first.'); return; }
        await hashFile(lastFile, lastName);
      } else if (mode === 'hmac') {
        var key = document.getElementById('tool-key').value;
        if (!key) { out.clear().warn('An HMAC needs a key.'); return; }
        out.clear();
        out.heading('HMAC \u2014 ' + (lastFile ? lastName : 'text input'));
        out.row('key length', key.length + ' characters');
        out.rule();
        if (lastFile) {
          /* Same streaming path: HMAC is H(opad || H(ipad || message)), and the
             inner hash takes the message incrementally, so a keyed digest of a
             40 GB file costs no more memory than an unkeyed one. */
          var progress = progressLine();
          progress.update(0, lastFile.size);
          try {
            var result = await streamFile(lastFile, encoder(key), progress.update,
              ['sha1', 'sha256', 'sha512']);   // the three this page displays
            progress.done();
            out.row('HMAC-SHA-1', result.digests.sha1, 't-warn');
            out.row('HMAC-SHA-256', result.digests.sha256, 't-ok');
            out.row('HMAC-SHA-512', result.digests.sha512);
          } catch (err) {
            progress.done();
            throw err;
          }
        } else {
          var data = encoder(text);
          out.row('HMAC-SHA-1', await hmacText(data, key, 'SHA-1'), 't-warn');
          out.row('HMAC-SHA-256', await hmacText(data, key, 'SHA-256'), 't-ok');
          out.row('HMAC-SHA-512', await hmacText(data, key, 'SHA-512'));
        }
        out.rule();
        out.dim('HMAC-SHA-1 above rests on SHA-1, a hash with practical collision');
        out.dim('attacks. The HMAC construction is not itself known to fall with');
        out.dim('them, but no new design should rest on a broken hash \u2014 prefer');
        out.dim('SHA-256 or better.');
        out.dim('HMAC proves both integrity and that the sender held the key \u2014');
        out.dim('a plain hash proves only integrity.');
      } else if (mode === 'identify') {
        var guess = identify(text);
        out.clear();
        out.heading('Hash identification');
        if (!text.trim()) { out.warn('Paste a hash to identify.'); return; }
        out.row('length', text.trim().length + ' characters');
        if (guess) {
          out.row('likely', guess, 't-ok');
          out.rule();
          out.dim('Length alone cannot separate algorithms that share a digest');
          out.dim('size \u2014 MD5 and NTLM are both 32 hex characters, and nothing');
          out.dim('in the value itself distinguishes them. Context does.');
        } else {
          out.err('No match. It may be truncated, salted, or an encoding rather');
          out.err('than a hash \u2014 try the encoding tool if it looks like base64.');
        }
      }
    } catch (err) {
      /* A newer run replaced this one and owns the output pane now. */
      if (err === SUPERSEDED) return;
      out.clear().err('Failed: ' + (err && err.message ? err.message : err));
    }
  }

  function syncMode() {
    var mode = document.getElementById('tool-mode').value;
    document.getElementById('pane-text').hidden = (mode === 'file');
    document.getElementById('pane-file').hidden = (mode !== 'file' && mode !== 'hmac');
    document.getElementById('pane-key').hidden = (mode !== 'hmac');
    document.getElementById('pane-expect').hidden = (mode !== 'file' && mode !== 'text');
  }

  LabTool.define({
    id: 'hashtool',
    run: run,
    onReady: function () {
      document.getElementById('tool-mode').addEventListener('change', syncMode);
      syncMode();
      LabTool.onFile({
        /* raw: the worker streams the file, so it must NOT be read into
           memory here. maxBytes is deliberately absent — there is no
           ceiling any more; see the note at the top of this file. */
        dropId: 'tool-drop', inputId: 'tool-file', raw: true,
        onFile: function (bytes, file) {
          lastFile = file;
          lastName = file.name + '  (' + LabTool.humanBytes(file.size) + ')';
          document.getElementById('tool-dropname').textContent = file.name;
          run();
        },
        onError: function (msg) { out.clear().err(msg); }
      });
      out.dim('Choose a mode, then Run — or press Ctrl + Enter.');
    }
  });
})();

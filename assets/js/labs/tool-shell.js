/* ==========================================================================
   tool-shell.js — the chrome every security/forensics tool shares.
   --------------------------------------------------------------------------
   The consent gate, the storage meter, file drag-and-drop, copy buttons and
   the "nothing leaves this page" guarantee are identical across all of them,
   so they live here once. A tool module registers itself with
   LabTool.define({ id, run }) and gets the rest for free.

   The privacy claim matters more here than anywhere else in Labs. A hash of an
   evidence file, a production JWT, a photograph with GPS in it — these are
   exactly the things people paste into a random website without thinking, and
   every other online tool of this kind uploads them. Nothing in this file, or
   in any tool built on it, sends your data anywhere. There is no fetch() and no
   XHR over what you loaded: the only reads are over a file the visitor chose
   (FileReader, or the raw File itself where a tool opts into `raw: true` and
   streams it), and everything else is arithmetic in this tab.

   One measurement call does leave, and it is named here so this paragraph stays
   literally true: when a tool hands the visitor a produced file, download()
   reports `lab_used` to analytics, carrying the lab's slug from the URL and the
   fixed word "export". Only the four tools that build a file reach it — the
   others emit nothing, because the shell learns a file's name before it knows
   whether the bytes were readable, and counting there would count refused files
   as understood ones. It never carries the filename, the bytes, or anything
   computed from them: it records THAT a tool worked, never WHAT it worked on.
   See /privacy.
   ========================================================================== */

(function (root) {
  'use strict';

  var PREFIX = 'lab.';

  var LabTool = {
    /* ------------------------------------------------------------------
       Byte and text helpers shared by nearly every tool.
       ------------------------------------------------------------------ */
    humanBytes: function (n) {
      if (!n) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    },

    toHex: function (bytes) {
      var out = '';
      for (var i = 0; i < bytes.length; i++) {
        out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
      }
      return out;
    },

    /* Parse hex, tolerating the ways hex is actually written down, and
       refusing the ways it is not.

       The old version stripped every non-hex character and carried on. That
       silently mangled a completely legitimate paste: in "0x48, 0x65" only the
       'x' is non-hex, so the leading '0' of each byte survived, every pair
       shifted, and "Hello" decoded as garbage — with no error. Text that is not
       hex at all fared no better: "hello world" kept e-l-l-d-a-d and printed one
       replacement glyph under the heading "Result — 1 characters".

       So: strip 0x prefixes and real separators first, then, in strict mode,
       reject whatever is left rather than pretending. Non-strict stays lenient
       for callers that want best-effort. */
    fromHex: function (text, strict) {
      var clean = String(text)
        .replace(/0[xX]/g, '')          // 0x48 -> 48, before anything else
        .replace(/[\s:,;\-_|]/g, '');   // spaces, colons, commas, dashes, pipes

      if (strict) {
        var bad = clean.replace(/[0-9a-f]/gi, '');
        if (bad) {
          throw new Error('"' + bad.charAt(0) + '" is not a hex digit. Hex uses 0-9 and a-f.');
        }
        if (clean.length % 2) {
          throw new Error('That is ' + clean.length + ' hex digits — an odd number, so the last byte is incomplete.');
        }
      } else {
        clean = clean.replace(/[^0-9a-f]/gi, '');
      }

      if (clean.length % 2) clean = '0' + clean;
      var out = new Uint8Array(clean.length / 2);
      for (var i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
      }
      return out;
    },

    /* Shannon entropy in bits per byte. 0 means every byte identical, 8 means
       uniformly random — which is what encrypted or compressed data looks
       like, and the reason this number is worth showing on a file. */
    entropy: function (bytes) {
      if (!bytes.length) return 0;
      var counts = new Uint32Array(256);
      for (var i = 0; i < bytes.length; i++) counts[bytes[i]]++;
      var total = bytes.length;
      var h = 0;
      for (var b = 0; b < 256; b++) {
        if (!counts[b]) continue;
        var p = counts[b] / total;
        h -= p * (Math.log(p) / Math.LN2);
      }
      return h;
    },

    escapeHtml: function (text) {
      return String(text).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    /* ------------------------------------------------------------------
       Output pane
       ------------------------------------------------------------------ */
    out: function (paneId) {
      var pane = document.getElementById(paneId);

      /* Every tool renders into a <pre tabindex="0"> with no accessible name
         and no announcement, so a screen reader user could tab into an unnamed
         box and never learn that pressing Run had produced anything. Fixed here
         rather than in 26 pages of markup, since every tool comes through this
         function.

         Deliberately NOT aria-live on the pane itself: these panes hold hex
         dumps, certificate chains and packet listings, and making the whole
         thing live would read the entire dump aloud on every run. A short
         summary in its own region says that output arrived and how much, and
         leaves reading it to the user, at the pace they choose. */
      var status = null;
      if (pane) {
        if (!pane.getAttribute('aria-label')) {
          pane.setAttribute('aria-label', 'Tool output');
        }
        if (!pane.getAttribute('role')) pane.setAttribute('role', 'region');
        status = document.getElementById(paneId + '-status');
        if (!status) {
          status = document.createElement('p');
          status.id = paneId + '-status';
          status.className = 'sr-only';
          status.setAttribute('role', 'status');
          status.setAttribute('aria-live', 'polite');
          if (pane.parentNode) pane.parentNode.insertBefore(status, pane.nextSibling);
        }
      }

      /* One announcement per burst. Tools emit output a line at a time, so
         announcing per write() would queue dozens of interruptions for a single
         run; the timer collapses a burst into one message once it settles. */
      var lines = 0;
      var announceTimer = null;
      /* Silent until the first run.

         Most tools print their help text from onReady at page load — 13 of them
         do it without clearing first — and announcing that would fire a
         role="status" region over the page title while a screen reader is still
         reading the heading. It would also be a lie: nothing was updated, and
         the lines are instructions, not results.

         clear() is the reliable arming signal. Every tool calls it at the top of
         its run path and none calls it at load, so the announcer wakes up on the
         first thing the visitor actually asks for. */
      var armed = false;
      function announce() {
        if (!status || !armed) return;
        if (announceTimer) clearTimeout(announceTimer);
        announceTimer = setTimeout(function () {
          if (!lines) return;
          status.textContent = 'Output updated, ' + lines +
            (lines === 1 ? ' line.' : ' lines.');
        }, 250);
      }

      var api = {
        clear: function () {
          pane.textContent = '';
          lines = 0;
          armed = true;
          // Emptied so the next run's message is heard as a change even when
          // the line count happens to be identical.
          if (status) status.textContent = '';
          return api;
        },
        write: function (text, cls) {
          var span = document.createElement('span');
          if (cls) span.className = cls;
          span.textContent = text;
          pane.appendChild(span);
          var breaks = String(text).split('\n').length - 1;
          if (breaks > 0) { lines += breaks; announce(); }
          return api;
        },
        line: function (text, cls) { return api.write((text || '') + '\n', cls); },
        heading: function (text) { return api.line(text, 't-info'); },
        dim: function (text) { return api.line(text, 't-dim'); },
        ok: function (text) { return api.line(text, 't-ok'); },
        warn: function (text) { return api.line(text, 't-warn'); },
        err: function (text) { return api.line(text, 't-err'); },
        /* Aligned "label: value" rows, which is most of what these tools print.
           A label longer than the column still gets a gap — padEnd returns the
           string unchanged when it is already too long, which would otherwise
           run the label straight into the value. */
        row: function (label, value, cls) {
          var text = String(label);
          api.write(text.length >= 22 ? text + '  ' : text.padEnd(22, ' '), 't-dim');
          return api.line(String(value), cls);
        },
        rule: function () { return api.dim('─'.repeat(52)); },
        node: pane
      };
      return api;
    },

    /* ------------------------------------------------------------------
       File input: click or drag-and-drop, handed back as a Uint8Array.
       ------------------------------------------------------------------ */
    onFile: function (opts) {
      var zone = document.getElementById(opts.dropId);
      var input = document.getElementById(opts.inputId);
      if (!zone || !input) return;

      function deliver(file) {
        if (!file) return;
        if (opts.maxBytes && file.size > opts.maxBytes) {
          opts.onError && opts.onError(
            'That file is ' + LabTool.humanBytes(file.size) + '. This tool stops at ' +
            LabTool.humanBytes(opts.maxBytes) + ' so the page stays responsive — ' +
            'the work happens in this tab, on your processor.');
          return;
        }
        /* Opt-in passthrough for tools that stream the file themselves rather
           than wanting it as one Uint8Array. /labs/hash uses it: reading a
           4 GB disk image into a buffer here is precisely the thing that used
           to force a size ceiling on that tool. Everything else keeps the
           read-it-all behaviour, so no other lab is affected. */
        if (opts.raw) {
          opts.onFile(null, file);
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          opts.onFile(new Uint8Array(reader.result), file);
        };
        reader.onerror = function () {
          opts.onError && opts.onError('That file could not be read.');
        };
        reader.readAsArrayBuffer(file);
      }

      input.addEventListener('change', function () { deliver(input.files[0]); });
      zone.addEventListener('click', function (e) {
        if (e.target !== input) input.click();
      });
      zone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (name) {
        zone.addEventListener(name, function (e) {
          e.preventDefault(); zone.classList.add('is-over');
        });
      });
      ['dragleave', 'drop'].forEach(function (name) {
        zone.addEventListener(name, function (e) {
          e.preventDefault(); zone.classList.remove('is-over');
        });
      });
      zone.addEventListener('drop', function (e) {
        deliver(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
      });
    },

    /* Hand the visitor a file back. Uses a blob URL, which never leaves the
       browser — there is no upload step and no server round trip. */
    download: function (bytes, filename, type) {
      var blob = new Blob([bytes], { type: type || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      /* The one place in this shell where a tool has demonstrably finished its
         job, which is why the success counter lives here and nowhere else.

         The obvious candidate — the output pane — cannot carry it. Reports and
         refusals go through the same write() calls, so the pane has no way to
         tell them apart: har.js prints the same aligned rows for "your JSON
         broke at line 400" as it does for a clean capture, and exif.js,
         archive.js and sqlite-browser.js all echo the file name and its size
         before they have decided whether the bytes are readable at all. A
         counter sitting there would count refused files as understood ones.

         A produced file has no such ambiguity. Every caller of this function
         builds its bytes out of input it has already parsed — a stripped
         photograph, a redacted HAR, a CSV of query results, a PNG carrying a
         message — so reaching this line means the parse happened, the work
         happened, and the visitor is holding the result. */
      if (window.KSLab) window.KSLab.used('export');

      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    copy: function (text, button) {
      var done = function (ok) {
        if (!button) return;
        var original = button.textContent;
        button.textContent = ok ? 'Copied' : 'Press Ctrl+C';
        setTimeout(function () { button.textContent = original; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); },
                                                 function () { done(false); });
      } else {
        done(false);
      }
    },

    /* ------------------------------------------------------------------
       Consent gate — the same stored flag as the rest of Labs, so agreeing
       once covers the whole section.
       ------------------------------------------------------------------ */
    gate: function (rootId) {
      var el = document.getElementById(rootId);
      if (!el) return;
      /* The gate only paints over the tool — it is position:absolute with an
         opaque background, so without this every control underneath stays
         tabbable and readable by a screen reader while the visitor is still
         being asked to agree. `inert` removes them from focus, hit-testing and
         assistive tech together. Browsers that do not support it ignore the
         property, so this cannot regress older ones. */
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
      if (agreed === 'yes') { el.setAttribute('data-consent', 'granted'); return; }
      setInert(true);
      var yes = document.getElementById('lab-agree');
      var no = document.getElementById('lab-leave');
      yes && yes.addEventListener('click', function () {
        try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (err) {}
        el.setAttribute('data-consent', 'granted');
        setInert(false);
        /* Agreeing hides the gate — and with it the button that held focus.
           A hidden element cannot keep focus, so the browser silently dumps
           it on <body>, and a keyboard or screen reader user has to tab back
           through the whole page to reach the tool they just unlocked. Hand
           focus to the tool's natural starting point instead: the main input
           where the page has one, else the Run button. preventScroll because
           the gate sat over the tool, so the viewport is already in the right
           place; try/catch because old browsers throw on the options object
           and a focus nicety must never break the unlock itself. */
        var first = document.getElementById('tool-text') ||
                    document.getElementById('tool-run');
        if (first) {
          try { first.focus({ preventScroll: true }); } catch (err) {}
        }
      });
      no && no.addEventListener('click', function () { window.location.href = '/'; });
    },

    /* Wire a tool up: gate, run button, Ctrl+Enter, and an optional file drop.
       Fullscreen is handled separately by lab-fullscreen.js, which every tool
       page loads and which self-guards against double-wiring — so it is not
       touched here. */
    define: function (spec) {
      LabTool.gate(spec.id);
      var runBtn = document.getElementById(spec.runId || 'tool-run');
      if (runBtn && spec.run) runBtn.addEventListener('click', spec.run);

      /* Copy buttons on result fields. lab-copy.js only decorates
         <pre class="lab-example">, so these need wiring here. */
      Array.prototype.forEach.call(
        document.querySelectorAll('[data-copy-target]'), function (btn) {
          btn.addEventListener('click', function () {
            var target = document.getElementById(btn.getAttribute('data-copy-target'));
            if (target) LabTool.copy(target.value !== undefined ? target.value
                                                               : target.textContent, btn);
          });
        });
      var el = document.getElementById(spec.id);
      if (el && spec.run) {
        el.addEventListener('keydown', function (event) {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            spec.run();
          }
        });
      }
      if (spec.onReady) spec.onReady();
    }
  };

  root.LabTool = LabTool;
})(typeof self !== 'undefined' ? self : this);

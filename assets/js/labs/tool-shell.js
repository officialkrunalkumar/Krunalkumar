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
   in any tool built on it, opens a network connection. There is no fetch(), no
   XHR, no beacon: the only reads are FileReader over a file the visitor chose,
   and everything else is arithmetic in this tab.
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

    fromHex: function (text) {
      var clean = String(text).replace(/[^0-9a-f]/gi, '');
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
      var api = {
        clear: function () { pane.textContent = ''; return api; },
        write: function (text, cls) {
          var span = document.createElement('span');
          if (cls) span.className = cls;
          span.textContent = text;
          pane.appendChild(span);
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

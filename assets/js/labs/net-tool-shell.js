/* ==========================================================================
   net-tool-shell.js — the chrome for the Labs tools that DO use the network.
   --------------------------------------------------------------------------
   This is the deliberate opposite of tool-shell.js, and the two must never be
   confused. That file's header promises that nothing built on it opens a
   network connection, and fifteen pages depend on that being literally true —
   so the tools here get their own shell rather than quietly falsifying it.

   Everything on this shell makes real requests to real third parties. The
   design follows from one observation: on /labs/api the visitor types the
   destination, so the only party learning anything is the one they chose. Here
   the destination is picked by the tool, and what reaches it is not the
   visitor's payload but the *subject of their inquiry* — the domain they are
   auditing, the password that worries them. The vendor is not the party under
   investigation, so the request discloses to an uninvolved third party what
   this person is looking into, and when.

   That is a constraint to design around, not a reason to refuse. The rules it
   produces, all enforced here rather than left to each tool:

     1. The vendor is named in the UI, with what it learns, BEFORE anything
        fires — not in a footnote afterwards.
     2. Nothing ever fires on page load, on a keystroke, or on a debounce.
        A lookup happens because somebody pressed a button.
     3. Every request is echoed into the output pane as it goes out, so the
        visitor sees the traffic they are causing.
     4. A running count of requests this page has made is always visible.
     5. Results are labelled with their source. Never rendered as though the
        page worked them out locally.

   The consent gate uses `lab.consent.network`, the same key as /labs/api and
   deliberately NOT the `lab.consent` that the offline tools share. Agreeing
   that a hash calculator keeps your file local says nothing about agreeing to
   send a domain name to Cloudflare.
   ========================================================================== */

(function (root) {
  'use strict';

  var PREFIX = 'lab.';
  var NET_CONSENT = PREFIX + 'consent.network';
  var DEFAULT_TIMEOUT_MS = 12000;

  var requestCount = 0;

  var LabNet = {

    /* ------------------------------------------------------------------
       Formatting helpers. Duplicated from tool-shell.js on purpose: these
       pages must not load that file, because loading it would put its
       "no tool built on this opens a network connection" promise on a page
       that does exactly that.
       ------------------------------------------------------------------ */
    humanBytes: function (n) {
      if (!n) return '0 B';
      var units = ['B', 'KB', 'MB', 'GB'];
      var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    },

    escapeHtml: function (text) {
      return String(text).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },

    out: function (paneId) {
      var pane = document.getElementById(paneId);

      /* Same treatment as LabTool.out in tool-shell.js, and it has to be
         repeated because these five labs (dns, rdap, breach-check, ct-log,
         email-security) call LabNet.out rather than LabTool.out — fixing the
         other shell alone left exactly these behind.

         As there: the pane is named and given a role, but is deliberately NOT
         itself a live region. These panes hold DNS answer sections and full
         certificate chains, and making the pane live would read the whole thing
         aloud on every lookup. A short summary in its own region says that an
         answer arrived; reading it stays the user's choice. */
      var status = null;
      if (pane) {
        if (!pane.getAttribute('aria-label')) {
          pane.setAttribute('aria-label', 'Lookup results');
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
          status.textContent = 'Results updated, ' + lines +
            (lines === 1 ? ' line.' : ' lines.');
        }, 250);
      }

      var api = {
        clear: function () {
          pane.textContent = '';
          lines = 0;
          armed = true;
          if (status) status.textContent = '';
          return api;
        },
        write: function (text, cls) {
          var span = document.createElement('span');
          if (cls) span.className = cls;
          span.textContent = text;
          pane.appendChild(span);
          pane.scrollTop = pane.scrollHeight;
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
      } else { done(false); }
    },

    download: function (bytes, filename, type) {
      var blob = new Blob([bytes], { type: type || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    /* ------------------------------------------------------------------
       The request counter, shown in the toolbar. The point is that the
       visitor can always see how much traffic this page has generated on
       their behalf without having to open developer tools.
       ------------------------------------------------------------------ */
    bumpCounter: function () {
      requestCount++;
      var el = document.getElementById('net-count');
      if (el) {
        el.textContent = requestCount + (requestCount === 1 ? ' request' : ' requests');
        el.hidden = false;
      }
    },

    requestCount: function () { return requestCount; },

    /* ------------------------------------------------------------------
       fetch with an echo, a timeout, and honest failure reporting.

       The honesty matters most in the error path. A browser deliberately
       refuses to tell JavaScript why a cross-origin request failed — a CORS
       rejection, a DNS failure, a dropped connection and a rate-limit
       response that omits CORS headers all arrive as the same opaque
       TypeError. Reporting that as "the service is down" would be a guess.
       So the shell says exactly what it knows and what it cannot know.

       `viaJson` is set only by LabNet.json below. It suppresses the success
       event here because the JSON callers have a stricter idea of what a
       working lookup is than a 2xx does: a 200 carrying a rate-limit page or
       a registry's HTML error is a failure to them, and json() is the place
       that can tell. The one caller that reads its own body — breach-check,
       whose answer is plain text, not JSON — comes through without the flag
       and is counted here.
       ------------------------------------------------------------------ */
    request: function (opts, viaJson) {
      var out = opts.out;
      var url = opts.url;
      var timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

      if (out) {
        out.write('→ ', 't-dim');
        out.line((opts.method || 'GET') + ' ' + url, 't-info');
      }
      LabNet.bumpCounter();

      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        if (controller) controller.abort();
      }, timeout);

      var init = {
        method: opts.method || 'GET',
        headers: opts.headers || {},
        // No cookies, no credentials — this page has no relationship with
        // these vendors and must not create one.
        credentials: 'omit',
        cache: opts.cache || 'default'
      };
      if (opts.body) init.body = opts.body;
      if (controller) init.signal = controller.signal;

      var started = (typeof performance !== 'undefined' ? performance.now() : Date.now());

      return fetch(url, init).then(function (res) {
        clearTimeout(timer);
        var ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
        if (out) {
          out.write('← ', 't-dim');
          out.line(res.status + ' ' + (res.statusText || '') + '   ' + ms + ' ms',
                   res.ok ? 't-ok' : 't-warn');
        }
        /* The point at which the third party has actually answered these
           tools' question. Deliberately not the press and not the line above
           that echoes the outgoing request: a lookup that is dispatched and
           then times out, is refused, or comes back 404/429 never reaches
           here with res.ok, and a lab nobody got an answer out of should not
           read as a lab that worked. */
        if (res.ok && !viaJson && window.KSLab) window.KSLab.used('lookup');
        return { res: res, ms: ms };
      }).catch(function (err) {
        clearTimeout(timer);
        if (out) {
          out.write('← ', 't-dim');
          out.line(timedOut ? 'no response within ' + (timeout / 1000) + ' s'
                            : 'request failed', 't-err');
        }
        var e = new Error(timedOut ? 'timeout' : 'network');
        e.timedOut = timedOut;
        e.original = err;
        throw e;
      });
    },

    json: function (opts) {
      return LabNet.request(opts, true).then(function (r) {
        return r.res.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { /* leave null */ }
          /* A 2xx whose body parsed into something is the earliest moment the
             answer these tools render actually exists — everything after this
             is formatting. The three excluded cases are the ones that reach
             this line looking like a response and are not one: a non-2xx
             (RDAP's 404 for an unregistered domain, Cert Spotter's 429 when
             the hourly budget is spent), a 200 whose body is not JSON at all
             (a captive portal or a proxy's error page, which every caller
             rejects a moment later), and an empty array, which is the shape
             "the log has nothing for this domain" arrives in. */
          if (r.res.ok && data !== null &&
              !(Array.isArray(data) && !data.length) &&
              window.KSLab) {
            window.KSLab.used('lookup');
          }
          return { res: r.res, ms: r.ms, data: data, text: text };
        });
      });
    },

    /* Print the standard explanation for an opaque failure. Every tool hits
       this path eventually, and guessing at the cause would be worse than
       saying plainly that the browser does not reveal it. */
    explainFailure: function (out, err, vendor) {
      out.line('');
      if (err && err.timedOut) {
        out.err('No response in time.');
        out.dim(vendor + ' did not answer before the timeout. It may be slow,');
        out.dim('rate-limiting, or unreachable from your network.');
        return;
      }
      out.err('The request failed, and the browser will not say why.');
      out.line('');
      out.dim('This is not evasion on my part — it is deliberate in the web');
      out.dim('platform. A cross-origin failure is reported to JavaScript as a');
      out.dim('single opaque error, so all of these look identical from here:');
      out.dim('  · ' + vendor + ' is down or unreachable');
      out.dim('  · your network or DNS blocked it');
      out.dim('  · a rate-limit response came back without CORS headers');
      out.dim('  · an extension or corporate proxy intercepted it');
      out.line('');
      out.dim('Your browser\'s Network tab will show the real status. That is');
      out.dim('the only place it exists.');
    },

    /* ------------------------------------------------------------------
       Consent gate — the network key, never the offline one.
       ------------------------------------------------------------------ */
    gate: function (rootId) {
      var el = document.getElementById(rootId);
      if (!el) return;

      /* .lab-gate is position:absolute over an opaque background, so it hides
         the lab visually and does nothing else: every control underneath stays
         focusable and stays in the accessibility tree. `inert` takes them out
         of focus, hit-testing and assistive tech together, and browsers without
         support ignore the property, so it cannot regress anything.

         Every other lab shell already did this — tool-shell, viz-shell,
         lab-app, hacklab, typing, api, linux, bsd, dos. This one, the shell in
         front of the only labs that talk to a third party at all, was the one
         that missed it: a keyboard user could tab straight past the consent
         overlay and fire a DNS, RDAP, breach or CT-log lookup about a domain
         they had typed, having never agreed to anything. Of the ten shells this
         is the one where it actually sends data somewhere. */
      var gateEl = document.getElementById('lab-gate');
      var setInert = function (on) {
        if (!gateEl) return;
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i] !== gateEl) kids[i].inert = on;
        }
      };

      var agreed;
      try { agreed = localStorage.getItem(NET_CONSENT); } catch (err) { agreed = null; }
      if (agreed === 'yes') { el.setAttribute('data-consent', 'granted'); return; }
      setInert(true);
      var yes = document.getElementById('lab-agree');
      var no = document.getElementById('lab-leave');
      yes && yes.addEventListener('click', function () {
        try { localStorage.setItem(NET_CONSENT, 'yes'); } catch (err) {}
        el.setAttribute('data-consent', 'granted');
        setInert(false);
      });
      no && no.addEventListener('click', function () { window.location.href = '/'; });
    },

    /* ------------------------------------------------------------------
       Wire a network tool up.

       Note what is deliberately absent compared with LabTool.define: there is
       no input listener and no debounce. On the offline tools, re-running as
       you type is free and pleasant. Here every keystroke would be a request
       to a third party about a half-typed domain, so a lookup only ever
       happens on an explicit press.
       ------------------------------------------------------------------ */
    define: function (spec) {
      LabNet.gate(spec.id);

      var runBtn = document.getElementById(spec.runId || 'tool-run');
      if (runBtn && spec.run) {
        runBtn.addEventListener('click', function () { spec.run(); });
      }

      // Enter in a single-line field is an explicit action, so it counts.
      Array.prototype.forEach.call(
        document.querySelectorAll('.lab-toolfield, .lab-toolfield-lg'), function (field) {
          if (field.tagName !== 'INPUT') return;
          field.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') { event.preventDefault(); spec.run && spec.run(); }
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

      Array.prototype.forEach.call(
        document.querySelectorAll('[data-copy-target]'), function (btn) {
          btn.addEventListener('click', function () {
            var target = document.getElementById(btn.getAttribute('data-copy-target'));
            if (target) LabNet.copy(target.value !== undefined ? target.value
                                                              : target.textContent, btn);
          });
        });

      if (spec.onReady) spec.onReady();
    }
  };

  root.LabNet = LabNet;
})(typeof self !== 'undefined' ? self : this);

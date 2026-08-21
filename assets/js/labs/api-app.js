/* ==========================================================================
   api-app.js — an HTTP request tester, run from the visitor's own browser.
   --------------------------------------------------------------------------
   This is the one lab that touches the network, and it is worth being precise
   about what that means, because the rest of Labs promises the opposite.

   Every other playground runs code locally and sends nothing anywhere. This
   one sends a request you wrote, from your browser, straight to the address
   you typed. There is still no server of ours in the path — no proxy, no
   relay, nothing logged here — but the request genuinely leaves your machine,
   because that is the entire point of it. The page says so plainly.

   The consequence is CORS, and it is not a bug we can fix: a browser will
   only hand back a cross-origin response if that server opts in with an
   Access-Control-Allow-Origin header. A tool like Postman is not a browser
   and has no such rule. So a blocked request here means the API did not opt
   in — not that the API is down — and the error text says exactly that,
   because "failed to fetch" on its own sends people hunting for the wrong
   problem entirely.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.getElementById('apilab');
  if (!root) return;

  var PREFIX = 'lab.';
  var MAX_BODY = 512 * 1024;   // beyond this the pane is the bottleneck, not the API

  /* fetch() has no timeout of its own. A host that completes the handshake and
     then never finishes answering left this page stuck on "Sending…" with Send
     disabled for the rest of the session — the promise simply never settled.
     12 s, the same budget net-tool-shell.js uses for the network tools.

     The timer is cleared in the `finally`, i.e. after `await res.text()`, not
     when fetch() resolves. fetch() settles as soon as the response headers
     arrive, so a body that streams forever would sail straight past a
     header-only deadline — and that is the realistic hang, not a slow
     handshake. Aborting the signal tears down the in-flight body read too. */
  var TIMEOUT_MS = 12000;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    agree: $('lab-agree'), leave: $('lab-leave'),
    method: $('api-method'), url: $('api-url'), send: $('api-send'),
    headers: $('api-headers'), body: $('api-body'),
    out: $('api-out'), status: $('api-status'),
    preset: $('api-preset'), bodyPane: $('api-body-pane')
  };

  var PRESETS = {
    'json-get': {
      method: 'GET',
      url: 'https://api.github.com/repos/pyodide/pyodide',
      headers: 'Accept: application/vnd.github+json',
      body: ''
    },
    'json-post': {
      method: 'POST',
      url: 'https://httpbin.org/post',
      headers: 'Content-Type: application/json',
      body: '{\n  "name": "Asha",\n  "role": "engineer"\n}'
    },
    'status': {
      method: 'GET',
      url: 'https://httpbin.org/status/404',
      headers: '',
      body: ''
    },
    'headers': {
      method: 'GET',
      url: 'https://httpbin.org/headers',
      headers: 'X-Demo-Header: from-labs',
      body: ''
    }
  };

  function write(text, cls) {
    var span = document.createElement('span');
    span.className = cls || 't-out';
    span.textContent = text;
    el.out.appendChild(span);
    el.out.scrollTop = el.out.scrollHeight;
  }

  function clear() { el.out.textContent = ''; }

  function setStatus(text, cls) {
    el.status.textContent = text;
    el.status.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  /* "Name: value" per line, which is how everyone writes headers by hand. */
  function parseHeaders(text) {
    var out = {};
    String(text || '').split('\n').forEach(function (line) {
      var at = line.indexOf(':');
      if (at < 1) return;
      var name = line.slice(0, at).trim();
      var value = line.slice(at + 1).trim();
      if (name) out[name] = value;
    });
    return out;
  }

  function prettyJson(text) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch (err) {
      return null;
    }
  }

  function methodAllowsBody(method) {
    return method !== 'GET' && method !== 'HEAD';
  }

  function syncBodyPane() {
    el.bodyPane.hidden = !methodAllowsBody(el.method.value);
  }

  async function send() {
    var url = el.url.value.trim();
    if (!url) { setStatus('Enter a URL first', 'is-err'); el.url.focus(); return; }
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
      el.url.value = url;
    }

    var method = el.method.value;
    var headers = parseHeaders(el.headers.value);
    var options = { method: method, headers: headers, redirect: 'follow' };
    if (methodAllowsBody(method) && el.body.value.trim()) options.body = el.body.value;

    clear();
    el.send.disabled = true;
    setStatus('Sending…', 'is-busy');
    write(method + ' ' + url + '\n\n', 't-info');

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) options.signal = controller.signal;
    var timedOut = false;
    // No AbortController means no timer either: setting the flag without being
    // able to abort would only relabel some later, genuine failure as a
    // timeout. Pre-2017 browsers keep the old behaviour, nothing worse.
    var timer = controller ? setTimeout(function () {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS) : null;

    var started = performance.now();
    try {
      var res = await fetch(url, options);
      var ms = Math.round(performance.now() - started);

      var cls = res.ok ? 't-ok' : 't-warn';
      write(res.status + ' ' + res.statusText + '  ·  ' + ms + ' ms\n', cls);

      var seen = 0;
      res.headers.forEach(function (value, name) {
        write(name + ': ' + value + '\n', 't-dim');
        seen++;
      });
      if (!seen) {
        write('(no readable headers — a cross-origin response only exposes a\n' +
              ' handful unless the server lists more in Access-Control-Expose-Headers)\n',
              't-dim');
      }
      write('\n');

      var text = await res.text();
      if (text.length > MAX_BODY) {
        text = text.slice(0, MAX_BODY);
        write('[response truncated at ' + Math.round(MAX_BODY / 1024) + ' KB]\n\n', 't-warn');
      }
      var pretty = prettyJson(text);
      write(pretty !== null ? pretty + '\n' : (text || '(empty body)\n'));

      setStatus(res.status + ' ' + res.statusText + ' in ' + ms + ' ms',
                res.ok ? 'is-ok' : 'is-err');
    } catch (err) {
      var ms2 = Math.round(performance.now() - started);

      /* An abort is our own doing and has nothing to do with CORS — a CORS
         rejection fails at once, it does not hang for twelve seconds. Blaming
         it here sent people to check Access-Control headers on a server whose
         only fault was being slow. */
      if (timedOut) {
        write('No response within ' + (TIMEOUT_MS / 1000) + ' s — request aborted.\n\n', 't-err');
        write('The connection was made but the answer never finished arriving.\n' +
              'That is a host that is slow, hung, or streaming a body with no\n' +
              'end. It is not CORS: a CORS rejection fails immediately.\n', 't-dim');
        setStatus('No response in ' + (TIMEOUT_MS / 1000) + ' s — aborted', 'is-err');
        return;
      }

      // A network-level failure in fetch() is almost always CORS, and the
      // browser deliberately refuses to say so. Explaining that here saves
      // people from debugging an API that is working perfectly well.
      write('Request failed after ' + ms2 + ' ms.\n\n', 't-err');
      write(String((err && err.message) || err) + '\n\n', 't-err');
      write('The most likely cause is CORS. A browser only hands back a\n' +
            'cross-origin response when the server sends an\n' +
            'Access-Control-Allow-Origin header permitting this page. Tools like\n' +
            'curl and Postman are not browsers and have no such restriction, so\n' +
            'the same request can succeed there and fail here — that means the\n' +
            'API did not opt in, not that it is broken.\n\n' +
            'Other possibilities: the host does not exist, it is HTTP-only (this\n' +
            'page is HTTPS, and browsers block mixed content), or you are offline.\n',
            't-dim');
      setStatus('Request failed — see the response pane', 'is-err');
    } finally {
      clearTimeout(timer);
      el.send.disabled = false;
    }
  }

  /* This gate gets its OWN storage key, and that is the whole point.
     Every other lab shares 'lab.consent', because they all make the same
     promise — nothing you type leaves the machine — so agreeing once covers
     all of them. This page makes the opposite promise: your request really
     does go out over the network. Sharing the key meant a visitor who
     accepted "nothing you paste is uploaded" on any of the fifteen offline
     tools arrived here with the network warning already dismissed, having
     never seen it. The one notice that actually matters was the one almost
     nobody read. Accepting it here does not dismiss the others either, which
     is the correct direction for that asymmetry. */
  var NET_CONSENT = PREFIX + 'consent.network';

  /* The gate only paints over the lab: .lab-gate is position:absolute with an
     opaque background, so without this every control beneath it stays in the
     tab order and in the accessibility tree while the visitor is still being
     asked to agree. `inert` removes a subtree from focus, hit-testing and
     assistive tech in one property. Browsers without support ignore it, so
     this cannot regress anything. */
  function setGateInert(on) {
    var g = document.getElementById('lab-gate');
    if (!g || !root) return;
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== g) kids[i].inert = on;
    }
  }

  function initGate() {
    var agreed;
    try { agreed = localStorage.getItem(NET_CONSENT); } catch (err) { agreed = null; }
    if (agreed === 'yes') { root.setAttribute('data-consent', 'granted'); return; }
    setGateInert(true);
    el.agree.addEventListener('click', function () {
      try { localStorage.setItem(NET_CONSENT, 'yes'); } catch (err) {}
      root.setAttribute('data-consent', 'granted');
      setGateInert(false);
      el.url.focus();
    });
    el.leave.addEventListener('click', function () { window.location.href = '/'; });
  }

  el.send.addEventListener('click', send);
  el.method.addEventListener('change', syncBodyPane);

  el.preset.addEventListener('change', function () {
    var p = PRESETS[el.preset.value];
    if (!p) return;
    el.method.value = p.method;
    el.url.value = p.url;
    el.headers.value = p.headers;
    el.body.value = p.body;
    syncBodyPane();
  });

  root.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      // The click path is guarded by the disabled button; this one was not, so
      // holding Ctrl+Enter fired a second request over the top of the first.
      if (el.send.disabled) return;
      send();
    }
  });

  initGate();
  syncBodyPane();
  setStatus('Ready — Ctrl + Enter sends');
})();

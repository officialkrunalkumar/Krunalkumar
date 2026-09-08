/* ==========================================================================
   header-grader.js — grade a set of HTTP response headers.
   --------------------------------------------------------------------------
   csp-playground already takes one header apart in detail. This takes the
   whole set and says which ones are missing, which are present but weak, and
   which are doing nothing because of how they are written — the check a
   person actually wants before shipping, rather than after.

   IT PARSES WHAT YOU PASTE. IT DOES NOT FETCH ANYTHING. There is no server
   here to fetch from and no proxy to borrow, which turns out to be the honest
   design anyway: a scanner that fetches your URL grades what an anonymous
   request from a datacentre sees, which is frequently not what a logged-in
   visitor from a browser sees. Pasting the response you actually got grades
   the response you actually got. Curl or the network tab will hand it over.

   THE GRADE IS ADVISORY AND SAYS SO. Header presence is a floor, not a
   posture: a site can score full marks here and still be wide open. Every
   grading tool of this kind gets quoted at people as though it measured
   security, so this one states its own limit in the output rather than in a
   footnote below the fold.

   WEIGHTS, NOT A CHECKLIST. Missing HSTS on an HTTPS site is not the same
   size of problem as a missing Referrer-Policy, and scoring them equally
   produces the grade inflation that makes these tools useless. Each check
   carries its own weight and its own reason.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  function parse(raw) {
    var text = String(raw).replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
    var map = {};
    var status = null;
    text.split('\n').forEach(function (line) {
      var s = line.match(/^HTTP\/[\d.]+\s+(\d{3})/i);
      if (s) { status = s[1]; return; }
      var m = line.match(/^([A-Za-z0-9-]+):\s*([\s\S]*)$/);
      if (!m) return;
      var k = m[1].toLowerCase();
      var v = m[2].trim();
      /* Duplicates are joined rather than overwritten. Two CSP headers are a
         real and confusing configuration — the browser intersects them — and
         a parser that silently kept the last one would grade a policy the
         visitor is not actually served. */
      map[k] = map[k] == null ? v : map[k] + ', ' + v;
    });
    return { headers: map, status: status };
  }

  function has(h, name) { return h[name] != null; }
  function val(h, name) { return (h[name] || '').toLowerCase(); }

  /* Each check returns { score, max, level, title, note }. */
  function checks(h) {
    var list = [];

    /* ---- Content-Security-Policy ----

       PARSED PER DIRECTIVE, NOT SEARCHED AS ONE STRING. The first version
       looked for 'unsafe-inline' anywhere in the header, which is wrong in
       the direction that matters: almost every real site carries
       style-src 'unsafe-inline' because component libraries and inline
       style attributes require it, and that is a cosmetic risk. Inline
       SCRIPT is the one CSP exists to stop. Scoring them the same took 12
       points off policies that had done nothing wrong — this site's own
       among them — which is exactly the false confidence a grader must not
       manufacture.

       'wasm-unsafe-eval' is likewise not 'unsafe-eval'. It permits
       WebAssembly compilation and not string-to-code, so a token match
       has to be exact rather than a substring. */
    (function () {
      var v = val(h, 'content-security-policy');
      var max = 25;
      if (!v) {
        return list.push({ score: 0, max: max, level: 'err', title: 'Content-Security-Policy',
          note: 'Absent. This is the one header that turns an injected script from a compromise into a blocked console message.' });
      }

      var dir = {};
      v.split(';').forEach(function (part) {
        var bits = part.trim().split(/\s+/);
        if (!bits[0]) return;
        dir[bits[0]] = bits.slice(1);
      });
      function hasToken(name, token) {
        var srcs = dir[name] || dir['default-src'] || [];
        for (var i = 0; i < srcs.length; i++) if (srcs[i] === token) return true;
        return false;
      }

      var score = max;
      var notes = [];
      if (hasToken('script-src', "'unsafe-inline'")) {
        score -= 12; notes.push("script-src allows 'unsafe-inline', which is most of what CSP exists to stop");
      }
      if (hasToken('script-src', "'unsafe-eval'")) {
        score -= 6; notes.push("script-src allows 'unsafe-eval'");
      }
      if (!dir['default-src'] && !dir['script-src']) {
        score -= 8; notes.push('neither default-src nor script-src is set, so scripts are unrestricted');
      }
      if (!dir['object-src'] && !dir['default-src']) { score -= 2; notes.push('no object-src'); }
      if (!dir['base-uri']) { score -= 2; notes.push('no base-uri, so an injected <base> can redirect every relative URL'); }

      /* Noted, never scored. It is worth telling someone it is there; it is
         not worth taking marks for the thing nearly everyone must do. */
      var styleInline = (dir['style-src'] || []).indexOf("'unsafe-inline'") !== -1;

      if (score < 0) score = 0;
      list.push({ score: score, max: max, level: score === max ? 'ok' : 'warn',
        title: 'Content-Security-Policy',
        note: (notes.length ? notes.join('; ') + '.' : 'Present, with no script escape hatches.') +
          (styleInline ? " style-src allows 'unsafe-inline', which is common and not scored here." : '') });
    })();

    /* ---- HSTS ---- */
    (function () {
      var v = val(h, 'strict-transport-security');
      var max = 20;
      if (!v) {
        return list.push({ score: 0, max: max, level: 'err', title: 'Strict-Transport-Security',
          note: 'Absent. Without it the first request of every visit can still be plaintext and downgradeable.' });
      }
      var age = v.match(/max-age=(\d+)/);
      var secs = age ? Number(age[1]) : 0;
      var score = max;
      var notes = [];
      if (secs < 15552000) { score -= 8; notes.push('max-age is ' + secs + 's, under the six months preload asks for'); }
      if (v.indexOf('includesubdomains') === -1) { score -= 4; notes.push('no includeSubDomains, so a forgotten subdomain is still downgradeable'); }
      list.push({ score: score < 0 ? 0 : score, max: max, level: score === max ? 'ok' : 'warn',
        title: 'Strict-Transport-Security',
        note: notes.length ? notes.join('; ') + '.' : 'Long max-age with subdomains covered.' });
    })();

    /* ---- X-Content-Type-Options ---- */
    (function () {
      var v = val(h, 'x-content-type-options');
      list.push(v.indexOf('nosniff') !== -1
        ? { score: 10, max: 10, level: 'ok', title: 'X-Content-Type-Options', note: 'nosniff set.' }
        : { score: 0, max: 10, level: 'err', title: 'X-Content-Type-Options',
            note: 'Absent. Without nosniff a browser may decide an upload is a script regardless of the type you sent.' });
    })();

    /* ---- Referrer-Policy ---- */
    (function () {
      var v = val(h, 'referrer-policy');
      var strong = /no-referrer|same-origin|strict-origin/;
      if (!v) {
        return list.push({ score: 0, max: 10, level: 'warn', title: 'Referrer-Policy',
          note: 'Absent. Most browsers now default to strict-origin-when-cross-origin, so this is a smaller gap than it was — but the default is not yours to rely on.' });
      }
      list.push(strong.test(v)
        ? { score: 10, max: 10, level: 'ok', title: 'Referrer-Policy', note: v + '.' }
        : { score: 4, max: 10, level: 'warn', title: 'Referrer-Policy',
            note: v + ' — this still leaks the full URL somewhere. Paths carry tokens more often than people expect.' });
    })();

    /* ---- Permissions-Policy ---- */
    (function () {
      var v = val(h, 'permissions-policy') || val(h, 'feature-policy');
      list.push(v
        ? { score: 8, max: 8, level: 'ok', title: 'Permissions-Policy', note: 'Present.' }
        : { score: 0, max: 8, level: 'warn', title: 'Permissions-Policy',
            note: 'Absent. Camera, microphone and geolocation stay available to anything that ends up running on the page, including an injected iframe.' });
    })();

    /* ---- Framing ---- */
    (function () {
      var csp = val(h, 'content-security-policy');
      var xfo = val(h, 'x-frame-options');
      var framed = csp.indexOf('frame-ancestors') !== -1;
      if (framed) {
        return list.push({ score: 12, max: 12, level: 'ok', title: 'Framing (frame-ancestors)',
          note: 'CSP frame-ancestors is set, which supersedes X-Frame-Options.' });
      }
      if (xfo) {
        return list.push({ score: 8, max: 12, level: 'warn', title: 'Framing (X-Frame-Options)',
          note: 'X-Frame-Options only. It works, but it is the superseded mechanism — frame-ancestors is the one still being specified.' });
      }
      list.push({ score: 0, max: 12, level: 'err', title: 'Framing',
        note: 'Neither frame-ancestors nor X-Frame-Options. The page can be framed, which is clickjacking.' });
    })();

    /* ---- Cross-origin isolation ---- */
    (function () {
      var n = 0;
      if (has(h, 'cross-origin-opener-policy')) n++;
      if (has(h, 'cross-origin-resource-policy')) n++;
      list.push({ score: n * 3, max: 6, level: n === 2 ? 'ok' : 'warn',
        title: 'Cross-origin policies',
        note: n === 2 ? 'COOP and CORP both set.'
          : n + ' of 2 set. COOP and CORP are what keep a cross-origin window or resource from sharing your process.' });
    })();

    /* ---- Leaky headers ----

       A NAME IS NOT A VERSION. "Server: nginx/1.24.0" tells an attacker
       exactly which advisories to read. "Server: Vercel" tells them the
       host, which they could get from a DNS lookup, and which no platform
       lets you remove anyway. Scoring those the same made the check punish
       people for something true, unavoidable and harmless — and this is a
       check literally named "version disclosure", so it should be looking
       for a version. */
    (function () {
      var versioned = [];
      var named = [];
      ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator'].forEach(function (k) {
        if (!has(h, k)) return;
        var v = String(h[k] || '').trim();
        if (!v) return;
        if (/\d+\.\d|\/\s*\d/.test(v)) versioned.push(k + ': ' + v);
        else named.push(k + ': ' + v);
      });

      var penalty = versioned.length * 3 + named.length;
      var score = Math.max(0, 9 - penalty);
      if (!versioned.length && !named.length) {
        return list.push({ score: 9, max: 9, level: 'ok', title: 'Version disclosure',
          note: 'Nothing advertising the server or framework.' });
      }
      list.push({ score: score, max: 9, level: versioned.length ? 'warn' : 'ok',
        title: 'Version disclosure',
        note: versioned.length
          ? versioned.concat(named).join(' · ') + '. A version number is the part worth removing — it hands an attacker the advisories to read.'
          : named.join(' · ') + '. A platform name with no version, which is nearly always unavoidable and of little use to anyone.' });
    })();

    return list;
  }

  function grade(pct) {
    if (pct >= 93) return 'A+';
    if (pct >= 85) return 'A';
    if (pct >= 75) return 'B';
    if (pct >= 62) return 'C';
    if (pct >= 45) return 'D';
    if (pct >= 25) return 'E';
    return 'F';
  }

  function run() {
    var raw = document.getElementById('tool-text').value;
    out.clear();

    if (!raw.trim()) {
      out.warn('Paste a set of HTTP response headers.');
      out.dim('curl -sSI https://example.com');
      out.dim('or: DevTools → Network → click the document → Response Headers → copy');
      return;
    }

    var parsed = parse(raw);
    var h = parsed.headers;
    var names = Object.keys(h);

    if (!names.length) {
      out.err('No headers found. Each line needs to look like "Name: value" —');
      out.err('paste the response block, not the request and not the body.');
      return;
    }

    var list = checks(h);
    var got = 0, max = 0;
    for (var i = 0; i < list.length; i++) { got += list[i].score; max += list[i].max; }
    var pct = Math.round((got / max) * 100);

    out.heading('Grade ' + grade(pct) + '  —  ' + got + ' of ' + max + ' (' + pct + '%)');
    if (parsed.status) out.dim('Status line seen: HTTP ' + parsed.status);
    out.dim(names.length + ' headers parsed');
    out.rule();

    for (i = 0; i < list.length; i++) {
      var c = list[i];
      var label = c.title + '  [' + c.score + '/' + c.max + ']';
      if (c.level === 'ok') out.ok(label);
      else if (c.level === 'warn') out.warn(label);
      else out.err(label);
      out.dim('    ' + c.note);
    }

    out.rule();
    out.dim('This grades the presence and shape of eight response headers and nothing');
    out.dim('else. It is a floor, not a posture: a site can score A+ here and still');
    out.dim('be wide open, because none of this looks at authentication, authorisation,');
    out.dim('injection, or anything behind the response. Treat a good grade as the');
    out.dim('absence of one class of easy mistake, not as evidence of security.');
  }

  LabTool.define({
    id: 'headergradertool',
    run: run,
    onReady: function () {
      out.dim('Paste HTTP response headers and press Grade.');
      out.dim('');
      out.dim('curl -sSI https://example.com');
      out.dim('DevTools → Network → the document request → Response Headers');
      out.dim('');
      out.dim('Nothing is fetched and nothing is sent. The headers are parsed in this tab.');
    }
  });
})();

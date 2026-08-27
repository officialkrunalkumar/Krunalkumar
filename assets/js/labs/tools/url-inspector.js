/* ==========================================================================
   url-inspector.js — pull a suspicious link apart without visiting it.
   --------------------------------------------------------------------------
   The point is that nothing here opens the link. A phishing URL can be
   examined completely — host, path, parameters, encoding layers, lookalike
   characters — using only string analysis, and doing it in a page that never
   makes a request means examining one costs nothing and warns nobody.

   The homograph check is the part people underestimate. "аpple.com" with a
   Cyrillic а renders identically to the real thing in most fonts; the only
   reliable tell is the codepoints, which is exactly what a computer is good at
   and a human is not.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* Latin lookalikes from other scripts — the ones actually used in attacks. */
  var CONFUSABLES = {
    'а': 'a (Cyrillic)', 'е': 'e (Cyrillic)', 'о': 'o (Cyrillic)',
    'р': 'p (Cyrillic)', 'с': 'c (Cyrillic)', 'у': 'y (Cyrillic)',
    'х': 'x (Cyrillic)', 'ѕ': 's (Cyrillic)', 'і': 'i (Cyrillic)',
    'ј': 'j (Cyrillic)', 'ԁ': 'd (Cyrillic)', 'ɡ': 'g (Latin script)',
    'α': 'a (Greek)', 'ο': 'o (Greek)', 'ρ': 'p (Greek)', 'ν': 'v (Greek)',
    'ｅ': 'e (fullwidth)', 'ａ': 'a (fullwidth)',
    /* Written as escapes rather than as the characters themselves. The entry
       that used to be here WAS a literal U+200B, and it did not survive being
       stored invisibly: the key ended up an empty string, which Array.from can
       never produce, so the one check in this table aimed at invisible
       characters was dead. Something you cannot see cannot be reviewed in a
       diff either — hence the escapes, which can never silently go missing.
       Zero-width characters do not render, so a hostname carrying one looks
       exactly like the domain it is impersonating. */
    '\u200B': 'zero-width space', '\u200C': 'zero-width non-joiner',
    '\u200D': 'zero-width joiner', '\uFEFF': 'zero-width no-break space (BOM)'
  };

  var SHORTENERS = ['bit.ly','tinyurl.com','t.co','goo.gl','ow.ly','is.gd','buff.ly',
    'rebrand.ly','cutt.ly','shorturl.at','rb.gy','tiny.cc','lnkd.in'];

  /* Punycode decoder, RFC 3492.
     This is needed because the two forms of a homograph domain hide the
     problem from opposite directions. new URL() normalises an IDN hostname to
     its xn-- form, so inspecting url.hostname never sees the Cyrillic letters
     that were pasted; and a link written directly in xn-- form gives no hint
     of what it renders as. Decoding closes both gaps. */
  var BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72,
      INITIAL_N = 128;

  function adapt(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    var k = 0;
    while (delta > ((BASE - TMIN) * TMAX) >> 1) {
      delta = Math.floor(delta / (BASE - TMIN));
      k += BASE;
    }
    return k + Math.floor((BASE - TMIN + 1) * delta / (delta + SKEW));
  }

  function decodeLabel(input) {
    var output = [], i = 0, n = INITIAL_N, bias = INITIAL_BIAS;
    var basic = input.lastIndexOf('-');
    for (var j = 0; j < (basic < 0 ? 0 : basic); j++) {
      output.push(input.charCodeAt(j));
    }
    for (var index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
      var oldi = i, w = 1;
      for (var k = BASE; ; k += BASE) {
        if (index >= input.length) return null;
        var code = input.charCodeAt(index++);
        var digit;
        if (code >= 0x30 && code <= 0x39) digit = code - 0x30 + 26;
        else if (code >= 0x61 && code <= 0x7a) digit = code - 0x61;
        else if (code >= 0x41 && code <= 0x5a) digit = code - 0x41;
        else return null;
        if (digit >= BASE) return null;
        i += digit * w;
        var t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
        if (digit < t) break;
        w *= BASE - t;
      }
      var out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      n += Math.floor(i / out);
      i %= out;
      output.splice(i++, 0, n);
    }
    try { return String.fromCodePoint.apply(String, output); }
    catch (e) { return null; }
  }

  function punyDecode(hostname) {
    var changed = false;
    var decoded = String(hostname).split('.').map(function (label) {
      if (label.slice(0, 4).toLowerCase() !== 'xn--') return label;
      var out = decodeLabel(label.slice(4));
      if (out === null) return label;
      changed = true;
      return out;
    }).join('.');
    return changed ? decoded : null;
  }

  /* The hostname exactly as it was typed, before the URL parser rewrites it. */
  function rawHost(text) {
    var m = String(text).trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^[^/@]*@/, '')
      .match(/^([^/?#:]+)/);
    return m ? m[1] : '';
  }

  var SUSPICIOUS_TLD = ['zip','mov','xyz','top','click','link','gq','cf','tk','ml',
    'work','fit','review','country','stream','download'];

  /* Multi-part public suffixes. Taking the last two labels blindly reported
     the registrable domain of news.bbc.co.uk as "co.uk" — a suffix nobody can
     register, and the wrong half of the name to be reading in a phishing
     check. The full public suffix list is ~10,000 entries and changes weekly;
     that is a bigger download than this entire page, so this is the subset
     that actually turns up: the country second-level domains, and the hosting
     suffixes where every customer gets a neighbour on the same parent name.
     Anything not listed falls back to the previous last-two-labels rule. */
  var MULTI_SUFFIX = [
    'co.uk','org.uk','me.uk','ac.uk','gov.uk','net.uk','sch.uk','ltd.uk','plc.uk',
    'co.jp','ne.jp','or.jp','ac.jp','go.jp','com.au','net.au','org.au','edu.au',
    'gov.au','co.nz','net.nz','org.nz','govt.nz','ac.nz','co.za','org.za',
    'co.in','net.in','org.in','gov.in','ac.in','edu.in','co.kr','or.kr',
    'co.il','ac.il','org.il','co.th','ac.th','in.th','com.br','com.cn','net.cn',
    'org.cn','gov.cn','com.mx','com.tr','gov.tr','com.ar','com.sg','com.hk',
    'com.tw','com.pl','com.ua','com.my','com.ph','com.vn','com.pk','com.eg',
    'com.sa','com.ng','com.co','com.pe','com.ec','com.uy','com.ve','com.es',
    'ac.at','co.at','or.at','com.de','com.ru','net.ru','org.ru',
    'github.io','gitlab.io','pages.dev','workers.dev','vercel.app','netlify.app',
    'herokuapp.com','firebaseapp.com','web.app','glitch.me','repl.co',
    'blogspot.com','wordpress.com','000webhostapp.com','azurewebsites.net',
    'duckdns.org','dpdns.org','no-ip.org','ddns.net','hopto.org','serveo.net',
    'ngrok.io','ngrok-free.app','trycloudflare.com','onion.to'
  ];

  /* The registrable domain: suffix plus the one label to its left — the part
     somebody actually bought. Returns null when there is nothing registrable,
     which is the honest answer for "localhost" and for an IP literal. */
  function registrableDomain(labels) {
    if (labels.length < 2) return null;
    var lastTwo = labels.slice(-2).join('.').toLowerCase();
    var take = MULTI_SUFFIX.indexOf(lastTwo) !== -1 ? 3 : 2;
    if (labels.length < take) return null;
    return labels.slice(-take).join('.');
  }

  function analyse(raw) {
    out.clear();
    var text = String(raw).trim();
    if (!text) { out.warn('Paste a URL above. It is never opened or requested.'); return; }

    var url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'http://' + text);
    } catch (err) {
      out.err('That does not parse as a URL.');
      return;
    }

    out.heading('Structure');
    out.row('scheme', url.protocol.replace(':', ''),
            url.protocol === 'https:' ? 't-ok' : 't-warn');
    out.row('host', url.hostname);
    if (url.port) out.row('port', url.port, 't-warn');
    out.row('path', url.pathname || '/');
    if (url.hash) out.row('fragment', url.hash);

    if (url.username || url.password) {
      out.line('');
      out.err('CREDENTIALS IN THE URL — "' + url.username + (url.password ? ':***' : '') + '@"');
      out.err('Everything before the @ is a username, not the destination. This is');
      out.err('the classic trick: http://www.paypal.com@evil.example goes to');
      out.err('evil.example, and the familiar name is decoration.');
    }

    // ---- host analysis ----
    out.rule();
    out.heading('Host');
    var labels = url.hostname.split('.');
    var tld = labels[labels.length - 1].toLowerCase();
    var ipLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) ||
                    url.hostname.charAt(0) === '[';   // [::1] and friends
    var registrable = ipLiteral ? null : registrableDomain(labels);
    if (registrable) {
      out.row('registrable domain', registrable);
      // Depth is counted from the registrable domain, not from a fixed two
      // labels. The old arithmetic gave news.bbc.co.uk a depth of 2 and gave
      // a single-label host such as localhost a depth of -1.
      var depth = labels.length - registrable.split('.').length;
      out.row('subdomain depth', depth + ' level(s)', depth > 2 ? 't-warn' : null);
      if (depth > 2) {
        out.dim('Deep subdomains are often used to bury a real domain far to the');
        out.dim('right, where a phone browser truncates it out of view.');
      }
    } else if (!ipLiteral) {
      if (labels.length < 2) {
        out.row('registrable domain', 'none — "' + url.hostname + '" is a single label');
        out.dim('A bare name with no dot is not a public domain: it resolves through');
        out.dim('the hosts file, or through local DNS suffix search on this network.');
      } else {
        out.row('registrable domain',
                'none — "' + url.hostname + '" is a public suffix, not a registered name');
      }
    }
    if (!ipLiteral && SUSPICIOUS_TLD.indexOf(tld) !== -1) {
      out.row('TLD', '.' + tld + ' — over-represented in abuse reports', 't-warn');
    }
    if (registrable && SHORTENERS.indexOf(registrable.toLowerCase()) !== -1) {
      out.line('');
      out.warn('This is a link shortener. The real destination is hidden until it');
      out.warn('is followed — which this tool deliberately will not do.');
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) {
      out.warn('The host is a bare IP address. Legitimate services almost always');
      out.warn('use a name; an IP avoids leaving a domain to take down.');
    }

    // ---- homograph ----
    /* Check the host as typed and, separately, the decoded form of any xn--
       label. url.hostname is useless for this on its own: the URL parser has
       already converted anything non-ASCII into punycode. */
    var typed = rawHost(text);
    var decoded = punyDecode(url.hostname);
    var display = decoded || typed;

    var found = [];
    Array.from(display).forEach(function (ch, i) {
      if (CONFUSABLES[ch]) found.push({ ch: ch, at: i, note: CONFUSABLES[ch] });
      else if (ch.charCodeAt(0) > 127) found.push({ ch: ch, at: i, note: 'non-ASCII' });
    });

    out.rule();
    out.heading('Lookalike characters');
    if (decoded) {
      out.row('punycode form', url.hostname, 't-warn');
      out.row('renders as', decoded, 't-err');
      out.line('');
    }
    if (!found.length) {
      out.ok('All ASCII — no homograph substitution in the hostname.');
    } else {
      out.err('NON-ASCII CHARACTERS IN THE HOSTNAME');
      found.forEach(function (f) {
        out.row('position ' + f.at, JSON.stringify(f.ch) +
          '  U+' + f.ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') +
          '  — ' + f.note, 't-err');
      });
      out.line('');
      out.warn('These render like Latin letters and are not. This is how a');
      out.warn('convincing copy of a well-known domain is registered.');
      if (url.hostname !== display) {
        out.dim('registered as: ' + url.hostname);
        out.dim('That xn-- form is what the domain actually is. Your browser');
        out.dim('shows the pretty version, which is the entire attack.');
      }
    }

    // ---- parameters ----
    var params = Array.from(url.searchParams.entries());
    out.rule();
    out.heading('Query parameters (' + params.length + ')');
    if (!params.length) {
      out.dim('none');
    } else {
      params.forEach(function (pair) {
        out.row(pair[0], pair[1]);
        // Nested URLs in parameters are how open redirects are exploited.
        if (/^https?:\/\//i.test(pair[1])) {
          out.line('    → contains a full URL: possible open redirect', 't-warn');
        }
        if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(pair[1])) {
          try {
            var decoded = atob(pair[1]);
            if (/^[\x20-\x7e]+$/.test(decoded)) {
              out.line('    → base64 decodes to: ' + decoded, 't-info');
            }
          } catch (e) { /* not base64 after all */ }
        }
      });
    }

    // ---- encoding layers ----
    out.rule();
    out.heading('Encoding');
    var layers = 0, current = text;
    while (/%[0-9a-fA-F]{2}/.test(current) && layers < 5) {
      try {
        var next = decodeURIComponent(current);
        if (next === current) break;
        current = next; layers++;
      } catch (e) { break; }
    }
    if (layers) {
      out.row('percent-encoding layers', layers, layers > 1 ? 't-warn' : null);
      out.line('fully decoded:', 't-dim');
      out.line('  ' + current);
      if (layers > 1) {
        out.warn('Multiple layers of encoding is rarely accidental — it is done to');
        out.warn('get past filters that only decode once.');
      }
    } else {
      out.dim('no percent-encoding');
    }

    out.rule();
    out.dim('Nothing above required opening the link. No request was made, so');
    out.dim('whoever owns it has no idea you looked.');
  }

  LabTool.define({
    id: 'urlinspectortool',
    run: function () { analyse(document.getElementById('tool-text').value); },
    onReady: function () {
      out.dim('Paste a suspicious link. It is taken apart as text — this tool');
      out.dim('never opens it, never resolves it, and never tells its owner.');
    }
  });
})();

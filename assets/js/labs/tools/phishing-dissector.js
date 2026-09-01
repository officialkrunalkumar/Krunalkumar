/* ==========================================================================
   phishing-dissector.js — take a suspicious email apart and say why.
   --------------------------------------------------------------------------
   The question people actually ask is not "is this spam". It is "why do you
   think this one is fake, and where exactly does it say so". So every finding
   here carries the offset of the bytes that produced it and prints that stretch
   of the message back with the trigger highlighted. A finding you cannot point
   at is an opinion, and an opinion is not much use to someone deciding whether
   to pay an invoice.

   Deliberately NOT in here: the Received: chain, hop timing and originating IP.
   That is /labs/email-headers, it is a whole tool on its own, and duplicating it
   badly here would be worse than linking to it. This one reads the parts of a
   message that a human is asked to trust — the name in the From line, the text
   of a link against where it goes, the name of an attachment, and the wording.

   There is no score. A percentage would imply a calibration that does not exist
   behind it, and the number is what people would remember instead of the
   reasons. Findings are grouped by severity, and a clean pass says out loud
   that it is not proof of anything.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  /* Big enough for a forwarded thread with a quoted chain; small enough that
     the whole-text regex passes below stay instant on a phone. */
  var MAX_INPUT = 512 * 1024;

  /* Ceilings on how much of one message is examined. A bulk mailout can carry
     two hundred tracked links; past a certain point another one teaches
     nobody anything and the page stops responding while it is counted. Every
     one of these is announced in the output when it bites. */
  var MAX_LINKS = 200;
  var MAX_NAMES = 60;
  var MAX_SHOWN = 60;

  var out = LabTool.out('tool-out');

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

  /* Characters that do their damage precisely by not rendering get printed as
     a visible name instead. An excerpt containing a right-to-left override is
     useless if the excerpt is also reordered by it.

     Written as escapes throughout, here and in the confusable table below, and
     that is not a style preference. A list of invisible characters stored as
     invisible characters cannot be reviewed in a diff — which is the whole
     problem it exists to solve — and it does not survive a re-encode or a
     careless copy: the key quietly becomes an empty string, and the one check
     aimed at unprintable characters silently stops existing. */
  var INVISIBLE = {
    '\u202A': '[LRE]', '\u202B': '[RLE]', '\u202C': '[PDF]',
    '\u202D': '[LRO]', '\u202E': '[RLO]',
    '\u2066': '[LRI]', '\u2067': '[RLI]',
    '\u2068': '[FSI]', '\u2069': '[PDI]',
    '\u200B': '[ZWSP]', '\u200C': '[ZWNJ]', '\u200D': '[ZWJ]',
    '\u200E': '[LRM]', '\u200F': '[RLM]',
    '\uFEFF': '[BOM]', '\u00A0': '[NBSP]', '\u00AD': '[SHY]'
  };
  var INVISIBLE_RE =
    /[\u00A0\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

  function visible(text) {
    return String(text == null ? '' : text)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(INVISIBLE_RE, function (c) {
        return INVISIBLE[c] || '[U+' + c.charCodeAt(0).toString(16).toUpperCase() + ']';
      });
  }

  function hasInvisible(text) {
    INVISIBLE_RE.lastIndex = 0;
    return INVISIBLE_RE.test(String(text || ''));
  }

  /* Levenshtein with an early exit. Nothing here cares whether two strings are
     nine edits apart or ninety, and the cap keeps a pathological paste cheap. */
  function levenshtein(a, b, cap) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var best = cur[0];
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (best > cap) return cap + 1;
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  /* Each row is one ASCII letter followed by the characters that render close
     enough to it to fool a reader at normal size.

     Written as \u escapes on purpose. A homoglyph table full of literal
     lookalikes cannot be reviewed in a diff — which is the exact problem the
     table exists to solve — and an invisible character stored literally has a
     habit of disappearing during a copy or a re-encode. */
  var CONFUSABLE_ROWS = [
    ['a', '\u0430\u03B1\u0251\uFF41\u04D1'],
    /* Cyrillic a, Greek alpha, Latin script a, fullwidth a, Cyrillic a-breve */
    ['b', '\u0184\u042C\uFF42'],
    /* Latin tone six, Cyrillic soft sign, fullwidth b */
    ['c', '\u0441\u03F2\u217D\uFF43'],
    /* Cyrillic es, Greek lunate sigma, small Roman hundred, fullwidth c */
    ['d', '\u0501\u217E\uFF44'],
    /* Cyrillic komi de, small Roman five hundred, fullwidth d */
    ['e', '\u0435\u04BD\u212E\uFF45'],
    /* Cyrillic ie, Cyrillic abkhasian che, estimated sign, fullwidth e */
    ['g', '\u0261\u01E5\uFF47'],
    /* Latin script g, g with stroke, fullwidth g */
    ['h', '\u04BB\u0570\uFF48'],
    /* Cyrillic shha, Armenian ho, fullwidth h */
    ['i', '\u0456\u03B9\u2170\uFF49'],
    /* Cyrillic byelorussian i, Greek iota, small Roman one, fullwidth i */
    ['j', '\u0458\uFF4A'],
    /* Cyrillic je, fullwidth j */
    ['k', '\u03BA\u043A\uFF4B'],
    /* Greek kappa, Cyrillic ka, fullwidth k */
    ['l', '\u217C\u0142\uFF4C'],
    /* small Roman fifty, l with stroke, fullwidth l */
    ['m', '\u043C\u217F\uFF4D'],
    /* Cyrillic em, small Roman thousand, fullwidth m */
    ['n', '\u03B7\uFF4E'],
    /* Greek eta, fullwidth n */
    ['o', '\u043E\u03BF\u0585\u0966\u0AE6\u06F0\uFF4F'],
    /* Cyrillic o, Greek omicron, Armenian oh, Devanagari zero, Gujarati zero, extended Arabic zero, fullwidth o */
    ['p', '\u0440\u03C1\uFF50'],
    /* Cyrillic er, Greek rho, fullwidth p */
    ['q', '\u051B\uFF51'],
    /* Cyrillic qa, fullwidth q */
    ['s', '\u0455\uFF53'],
    /* Cyrillic dze, fullwidth s */
    ['t', '\u03C4\uFF54'],
    /* Greek tau, fullwidth t */
    ['u', '\u03C5\u0446\uFF55'],
    /* Greek upsilon, Cyrillic tse, fullwidth u */
    ['v', '\u03BD\u2174\uFF56'],
    /* Greek nu, small Roman five, fullwidth v */
    ['w', '\u0448\u051D\uFF57'],
    /* Cyrillic sha, Cyrillic we, fullwidth w */
    ['x', '\u0445\u03C7\u2179\uFF58'],
    /* Cyrillic ha, Greek chi, small Roman ten, fullwidth x */
    ['y', '\u0443\u03B3\u04AF\uFF59'],
    /* Cyrillic u, Greek gamma, Cyrillic straight u, fullwidth y */
    ['z', '\u0290\uFF5A'],
    /* Latin z with retroflex hook, fullwidth z */
    ['-', '\u2010\u2011\u2012\u2013\u2014\u2212\uFF0D'],
    /* hyphen, non-breaking hyphen, figure dash, en dash, em dash, minus sign, fullwidth hyphen */
    ['.', '\u3002\uFF0E\uFF61\u06D4']
    /* ideographic full stop, fullwidth full stop, halfwidth ideographic stop, Arabic full stop */
  ];

  var CONFUSABLE = {};
  (function buildConfusables() {
    for (var r = 0; r < CONFUSABLE_ROWS.length; r++) {
      var ascii = CONFUSABLE_ROWS[r][0], chars = CONFUSABLE_ROWS[r][1];
      for (var c = 0; c < chars.length; c++) CONFUSABLE[chars.charAt(c)] = ascii;
    }
  })();

  /* Fold a string to the shape a human eye sees. Two different strings with the
     same skeleton are, on screen, the same word. That is a stronger signal than
     edit distance: "rn" and "m" are two edits apart and indistinguishable. */
  function skeleton(text) {
    var s = lower(text), o = '', i;
    for (i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      o += CONFUSABLE[ch] !== undefined ? CONFUSABLE[ch] : ch;
    }
    return o
      .replace(INVISIBLE_RE, '')
      .replace(/rn/g, 'm')
      .replace(/vv/g, 'w')
      .replace(/[il1|!]/g, 'i')
      .replace(/0/g, 'o')
      .replace(/5/g, 's');
  }

  function confusablesIn(text) {
    var found = [], s = String(text || ''), i, seen = {};
    for (i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (CONFUSABLE[ch] !== undefined && ch.charCodeAt(0) > 127 && !seen[ch]) {
        seen[ch] = true;
        found.push({
          ch: ch,
          ascii: CONFUSABLE[ch],
          code: 'U+' + ('000' + ch.charCodeAt(0).toString(16).toUpperCase()).slice(-4)
        });
      }
    }
    return found;
  }

  /* ------------------------------------------------------------------
     Punycode, both directions.

     Both are needed, for opposite reasons. A hostname written with real
     Cyrillic letters has to be shown in the xn-- form that the resolver will
     actually look up, or the reader has no idea what they are dealing with; a
     hostname already written as xn-- has to be shown as what it renders as, or
     they cannot see the impersonation. RFC 3492.
     ------------------------------------------------------------------ */
  var BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700,
      INITIAL_BIAS = 72, INITIAL_N = 128;

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

  function ucs2decode(str) {
    var output = [], counter = 0, value, extra;
    while (counter < str.length) {
      value = str.charCodeAt(counter++);
      if (value >= 0xD800 && value <= 0xDBFF && counter < str.length) {
        extra = str.charCodeAt(counter++);
        if ((extra & 0xFC00) === 0xDC00) {
          output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
        } else { output.push(value); counter--; }
      } else output.push(value);
    }
    return output;
  }

  function digitToBasic(digit) {
    /* 0-25 map to a-z, 26-35 map to 0-9. */
    return String.fromCharCode(digit + 22 + (digit < 26 ? 75 : 0));
  }

  function punyEncodeLabel(label) {
    var codes = ucs2decode(label);
    var n = INITIAL_N, delta = 0, bias = INITIAL_BIAS;
    var output = [], basicLength = 0, i, cp;
    for (i = 0; i < codes.length; i++) {
      if (codes[i] < 0x80) { output.push(String.fromCharCode(codes[i])); basicLength++; }
    }
    var handled = basicLength;
    if (basicLength) output.push('-');
    while (handled < codes.length) {
      var m = 0x7FFFFFFF;
      for (i = 0; i < codes.length; i++) {
        if (codes[i] >= n && codes[i] < m) m = codes[i];
      }
      delta += (m - n) * (handled + 1);
      n = m;
      for (i = 0; i < codes.length; i++) {
        cp = codes[i];
        if (cp < n) delta++;
        if (cp === n) {
          var q = delta;
          for (var k = BASE; ; k += BASE) {
            var t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
            if (q < t) break;
            output.push(digitToBasic(t + (q - t) % (BASE - t)));
            q = Math.floor((q - t) / (BASE - t));
          }
          output.push(digitToBasic(q));
          bias = adapt(delta, handled + 1, handled === basicLength);
          delta = 0;
          handled++;
        }
      }
      delta++; n++;
    }
    return output.join('');
  }

  function punyDecodeLabel(input) {
    var output = [], i = 0, n = INITIAL_N, bias = INITIAL_BIAS;
    var basic = input.lastIndexOf('-');
    for (var j = 0; j < (basic < 0 ? 0 : basic); j++) output.push(input.charCodeAt(j));
    for (var index = basic > 0 ? basic + 1 : 0; index < input.length;) {
      var oldi = i, w = 1;
      for (var k = BASE; ; k += BASE) {
        if (index >= input.length) return null;
        var code = input.charCodeAt(index++), digit;
        if (code >= 0x30 && code <= 0x39) digit = code - 0x30 + 26;
        else if (code >= 0x61 && code <= 0x7A) digit = code - 0x61;
        else if (code >= 0x41 && code <= 0x5A) digit = code - 0x41;
        else return null;
        if (digit >= BASE) return null;
        i += digit * w;
        var t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
        if (digit < t) break;
        w *= BASE - t;
      }
      var len = output.length + 1;
      bias = adapt(i - oldi, len, oldi === 0);
      n += Math.floor(i / len);
      i %= len;
      output.splice(i++, 0, n);
    }
    try { return String.fromCodePoint.apply(String, output); }
    catch (err) { return null; }
  }

  /* Returns the ASCII form a resolver would use, or null when the host is
     already plain ASCII and nothing needed converting. */
  function toAscii(host) {
    var changed = false;
    var ascii = String(host).split('.').map(function (label) {
      if (!/[^\x00-\x7F]/.test(label)) return label;
      changed = true;
      return 'xn--' + punyEncodeLabel(label);
    }).join('.');
    return changed ? ascii : null;
  }

  /* Returns what an xn-- host renders as, or null when nothing was encoded. */
  function toUnicode(host) {
    var changed = false;
    var uni = String(host).split('.').map(function (label) {
      if (lower(label).slice(0, 4) !== 'xn--') return label;
      var decoded = punyDecodeLabel(label.slice(4));
      if (decoded === null) return label;
      changed = true;
      return decoded;
    }).join('.');
    return changed ? uni : null;
  }

  /* ------------------------------------------------------------------
     Domains
     ------------------------------------------------------------------ */

  /* Enough of the public suffix list to stop the obvious mistakes. It is not
     the whole thing — that file is megabytes and changes weekly, and shipping a
     stale copy would be a different kind of wrong answer. Where it is short,
     the tool over-reports rather than under-reports. */
  var MULTI_SUFFIX = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk',
    'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in', 'firm.in',
    'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
    'co.nz', 'co.za', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.mx', 'com.ar',
    'com.sg', 'com.my', 'com.hk', 'com.cn', 'com.tw', 'com.tr', 'com.ua',
    'com.pl', 'com.ph', 'com.vn', 'com.sa', 'com.eg', 'com.ng', 'com.pk'];

  function registrable(host) {
    var parts = lower(host).replace(/\.$/, '').split('.');
    if (parts.length < 3) return parts.join('.');
    var lastTwo = parts.slice(-2).join('.');
    if (MULTI_SUFFIX.indexOf(lastTwo) !== -1) return parts.slice(-3).join('.');
    return lastTwo;
  }

  /* The label that carries the brand: "vantexa" out of "vantexa.co.uk". */
  function brandLabel(host) {
    return registrable(host).split('.')[0];
  }

  var FREEMAIL = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
    'live.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com', 'aol.com', 'gmx.com',
    'gmx.net', 'mail.com', 'zoho.com', 'proton.me', 'protonmail.com',
    'yandex.com', 'mail.ru', 'icloud.com', 'me.com', 'rediffmail.com'];

  /* A defensive list, not a copy of anyone's campaign: these are simply the
     names most often worn by a message that is not from them. */
  var BRANDS = ['paypal.com', 'microsoft.com', 'office.com', 'office365.com',
    'outlook.com', 'apple.com', 'icloud.com', 'amazon.com', 'amazon.in',
    'google.com', 'gmail.com', 'netflix.com', 'dhl.com', 'fedex.com', 'ups.com',
    'dpd.com', 'linkedin.com', 'facebook.com', 'instagram.com', 'whatsapp.com',
    'adobe.com', 'dropbox.com', 'docusign.com', 'zoom.us', 'slack.com',
    'github.com', 'gitlab.com', 'atlassian.com', 'salesforce.com', 'oracle.com',
    'hsbc.com', 'chase.com', 'wellsfargo.com', 'citibank.com', 'barclays.co.uk',
    'hdfcbank.com', 'icicibank.com', 'axisbank.com', 'onlinesbi.sbi',
    'coinbase.com', 'binance.com', 'ledger.com', 'metamask.io',
    'incometax.gov.in', 'irs.gov', 'gov.uk', 'nic.in'];

  var SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
    'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc',
    'lnkd.in', 'trib.al', 's.id', 'shorte.st', 'bl.ink', 'urlz.fr', 'v.gd'];

  var ODD_TLD = ['zip', 'mov', 'xyz', 'top', 'click', 'link', 'gq', 'cf', 'tk',
    'ml', 'ga', 'work', 'fit', 'review', 'country', 'stream', 'download',
    'loan', 'men', 'kim', 'rest', 'quest', 'cam', 'sbs', 'monster'];

  function tldOf(host) {
    var parts = lower(host).split('.');
    return parts.length > 1 ? parts[parts.length - 1] : '';
  }

  function isIpLiteral(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
           /^\[[0-9a-f:]+\]$/i.test(host) ||
           /^0x[0-9a-f]+$/i.test(host) ||
           /^\d{8,12}$/.test(host);
  }

  /* Compare one hostname against a name the message itself claims to be, and
     say how they differ. Returns null when they are the same organisation or
     plainly unrelated. */
  function compareDomain(host, claim) {
    var a = registrable(host), b = registrable(claim);
    if (!a || !b || a === b) return null;
    var la = brandLabel(host), lb = brandLabel(claim);
    if (lb.length < 4) return null;

    if (skeleton(a) === skeleton(b)) {
      return { kind: 'twin', claim: b,
               why: 'renders as the same string once lookalike characters are folded' };
    }
    if (skeleton(la) === skeleton(lb)) {
      return { kind: 'twin', claim: b,
               why: 'the name reads identically; only the suffix differs' };
    }
    var d = levenshtein(la, lb, 2);
    if (d <= 2 && la !== lb) {
      return { kind: 'cousin', claim: b, edits: d,
               why: d + (d === 1 ? ' character' : ' characters') + ' away from the name it is imitating' };
    }
    /* vantexa.com.secure-pay.top — the real name sits in a subdomain where it
       carries no authority at all. */
    if (lower(host).indexOf(b + '.') !== -1 && a !== b) {
      return { kind: 'subdomain', claim: b,
               why: 'the real name appears as a subdomain, which anybody can create' };
    }
    /* vantexa-billing.com, secure-vantexa.net */
    if (la !== lb && new RegExp('(^|[^a-z0-9])' + escapeRe(lb) + '($|[^a-z0-9])').test(la)) {
      return { kind: 'affix', claim: b,
               why: 'the name with something bolted on, registered as a separate domain' };
    }
    /* dir-northwind.com against northwind-freight.example. A hyphenated name
       gives an attacker a free half to reuse, and "northwind" in front of a
       stranger's domain does most of the work on its own. */
    var segments = lb.split('-');
    for (var s = 0; s < segments.length; s++) {
      if (segments[s].length < 5) continue;
      if (new RegExp('(^|[^a-z0-9])' + escapeRe(segments[s]) + '($|[^a-z0-9])').test(la)) {
        return { kind: 'affix', claim: b,
                 why: 'it borrows "' + segments[s] + '" from that name and puts it on a ' +
                      'registration of its own' };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------
     Findings
     ------------------------------------------------------------------ */

  var RAW = '';          /* the pasted text, index-preserving */
  var ASCII_ONLY = true; /* lets byteAt skip the walk on the common case */
  var findings = [];

  var SEV_ORDER = ['high', 'medium', 'low', 'note'];
  var SEV_CLASS = { high: 't-err', medium: 't-warn', low: 't-info', note: 't-dim' };
  var SEV_LABEL = { high: 'HIGH  ', medium: 'MEDIUM', low: 'LOW   ', note: 'NOTE  ' };

  function add(sev, title, at, len, why) {
    findings.push({
      sev: sev, title: title,
      at: (typeof at === 'number' && at >= 0) ? at : null,
      len: len || 0,
      why: why || []
    });
  }

  /* Both of these are asked the same question — where in the message is this —
     dozens of times per run, and both used to answer it by counting from the
     start of the text. On a forwarded thread with a long quoted tail that is a
     full scan of half a megabyte per finding, and a hundred findings turned a
     click into an eight-second freeze. The positions never change during a run,
     so they are indexed once and looked up after that. */
  var LINE_STARTS = [0];
  var BYTE_MARKS = null;
  var BYTE_STEP = 4096;

  function indexPositions() {
    LINE_STARTS = [0];
    for (var i = 0; i < RAW.length; i++) {
      if (RAW.charCodeAt(i) === 10) LINE_STARTS.push(i + 1);
    }
    BYTE_MARKS = null;
  }

  /* The pasted string is indexed in UTF-16 code units; a byte offset is what
     you would count in a hex editor, and the two only agree while the message
     is ASCII. Any message worth running the homoglyph checks on is not.

     Counted per code unit, so each half of a surrogate pair contributes two and
     the pair still totals four. That keeps a checkpoint from ever landing in
     the middle of a character and getting a different answer than a full scan. */
  function unitBytes(code) {
    if (code < 0x80) return 1;
    if (code < 0x800) return 2;
    if (code >= 0xD800 && code <= 0xDFFF) return 2;
    return 3;
  }

  function buildByteMarks() {
    BYTE_MARKS = [0];
    var bytes = 0;
    for (var i = 0; i < RAW.length; i++) {
      bytes += unitBytes(RAW.charCodeAt(i));
      if ((i + 1) % BYTE_STEP === 0) BYTE_MARKS.push(bytes);
    }
  }

  function byteAt(index) {
    if (ASCII_ONLY) return index;
    if (index > RAW.length) index = RAW.length;
    if (!BYTE_MARKS) buildByteMarks();
    var mark = Math.floor(index / BYTE_STEP);
    var bytes = BYTE_MARKS[mark];
    for (var i = mark * BYTE_STEP; i < index; i++) bytes += unitBytes(RAW.charCodeAt(i));
    return bytes;
  }

  function lineAt(index) {
    var low = 0, high = LINE_STARTS.length - 1;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (LINE_STARTS[mid] <= index) low = mid; else high = mid - 1;
    }
    return low + 1;
  }

  /* ------------------------------------------------------------------
     Parsing. Every transform below preserves string length, so an index into
     the parsed form is still an index into what the visitor pasted — which is
     the whole premise of pointing at the bytes.
     ------------------------------------------------------------------ */

  function normalise(raw) {
    /* CR becomes a space rather than disappearing: same length, and a header
       value that ends in one is trimmed later anyway. */
    return String(raw).replace(/\r/g, ' ');
  }

  function unfoldHeaderBlock(text) {
    /* RFC 5322 folding: a line beginning with whitespace continues the one
       above. Replacing the newline and the indent with the same number of
       spaces joins them without moving anything after it. */
    return text.replace(/\n[ \t]+/g, function (match) {
      return new Array(match.length + 1).join(' ');
    });
  }

  function splitMessage(text) {
    var m = /\n[ \t]*\n/.exec(text);
    if (!m) return { headerText: text, bodyStart: text.length, hasBody: false };
    return {
      headerText: text.slice(0, m.index),
      bodyStart: m.index + m[0].length,
      hasBody: true
    };
  }

  function parseHeaders(headerText) {
    var flat = unfoldHeaderBlock(headerText);
    var headers = [], offset = 0;
    flat.split('\n').forEach(function (line) {
      var m = line.match(/^([A-Za-z0-9-]+):([ \t]*)/);
      if (m) {
        headers.push({
          name: m[1],
          value: line.slice(m[0].length).replace(/\s+$/, ''),
          valueAt: offset + m[0].length,
          lineAt: offset
        });
      }
      offset += line.length + 1;
    });
    return headers;
  }

  function pick(headers, name) {
    var want = lower(name);
    for (var i = 0; i < headers.length; i++) {
      if (lower(headers[i].name) === want) return headers[i];
    }
    return null;
  }

  function pickAll(headers, name) {
    var want = lower(name);
    return headers.filter(function (h) { return lower(h.name) === want; });
  }

  /* "Name <local@domain>" or a bare address, with offsets for both halves. */
  function parseAddress(header) {
    if (!header) return null;
    var value = header.value, base = header.valueAt;
    var angled = value.match(/^\s*(.*?)\s*<([^>]*)>/);
    var display = null, displayAt = -1, addr = null, addrAt = -1;
    if (angled) {
      /* Decode RFC 2047 here, not just when printing. Every display-name
         check downstream — the look-alike test, the name-claims-a-different-
         domain test — is a string comparison, and an encoded word is opaque
         to all of them. Leaving it raw meant base64-ing the display name was
         a one-step way to pass all of them. displayAt still points at the
         RAW span, which is what the highlighter needs. */
      display = decodeMimeWords(angled[1].replace(/^["']|["']$/g, ''));
      addr = angled[2].trim();
      displayAt = base + value.indexOf(angled[1]);
      addrAt = base + value.indexOf(angled[2]);
    } else {
      var bare = value.match(/[^\s<>,;]+@[^\s<>,;]+/);
      if (bare) { addr = bare[0]; addrAt = base + bare.index; }
    }
    var domain = null, domainAt = -1;
    if (addr) {
      var at = addr.lastIndexOf('@');
      if (at !== -1) {
        domain = lower(addr.slice(at + 1)).replace(/[>\s.]+$/, '');
        domainAt = addrAt + at + 1;
      }
    }
    return {
      raw: value, at: base,
      display: display, displayAt: displayAt,
      addr: addr, addrAt: addrAt,
      domain: domain, domainAt: domainAt
    };
  }

  /* ------------------------------------------------------------------
     URLs
     ------------------------------------------------------------------ */

  function safeDecode(text) {
    try { return decodeURIComponent(text); } catch (err) { return text; }
  }

  /* Parsed by hand rather than with new URL(). The point of this tool is what
     was literally typed — new URL() normalises an IDN host to xn-- before you
     can look at it, lowercases, drops the userinfo from .host, and throws on
     exactly the malformed input worth examining. */
  function parseUrl(text) {
    var m = String(text).match(
      /^([A-Za-z][A-Za-z0-9+.-]*:)?(\/\/)?(?:([^/?#@]*)@)?([^/?#:]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/);
    if (!m) return null;
    return {
      scheme: lower(m[1] || '').replace(':', ''),
      userinfo: m[3] || '',
      host: m[4] || '',
      port: m[5] || '',
      path: m[6] || '',
      query: (m[7] || '').replace(/^\?/, ''),
      fragment: (m[8] || '').replace(/^#/, '')
    };
  }

  var CRED_PARAMS = ['email', 'e', 'mail', 'user', 'username', 'usr', 'login',
    'account', 'acct', 'id', 'uid', 'token', 'key', 'session', 'sid', 'auth',
    'password', 'pass', 'pwd', 'otp'];

  var REDIRECT_PARAMS = ['url', 'redirect', 'redirect_uri', 'redir', 'next',
    'r', 'u', 'dest', 'destination', 'target', 'continue', 'return', 'returnurl',
    'goto', 'link', 'out', 'to', 'relaystate'];

  /* Peel percent-encoding until it stops changing, collecting every absolute
     URL that turns up on the way. Three rounds is more than any real tracker
     uses and stops a hand-made loop from spinning. */
  function embeddedUrls(text) {
    var seen = [], out2 = [], cur = String(text || ''), rounds = 0;
    while (rounds < 4) {
      var re = /https?:\/\/[^\s&"'<>\\)]+/gi, m;
      while ((m = re.exec(cur)) !== null) {
        if (seen.indexOf(m[0]) === -1) { seen.push(m[0]); out2.push(m[0]); }
      }
      var next = safeDecode(cur);
      if (next === cur) break;
      cur = next;
      rounds++;
    }
    return out2;
  }

  function analyseUrl(url, at, context, fromDomain, claims, promisedHost) {
    var parsed = parseUrl(url);
    if (!parsed) return null;
    var host = parsed.host;
    var where = context ? ' (' + context + ')' : '';

    /* A name written in front of the @ is a claim like any other, and in a
       link pasted on its own it is often the only claim there is. */
    if (parsed.userinfo && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(parsed.userinfo)) {
      claims = [lower(parsed.userinfo)].concat(claims);
    }

    if (parsed.scheme === 'javascript') {
      add('high', 'A javascript: link' + where, at, url.length, [
        'This is not a link to a page. It is code, and clicking it runs that',
        'code inside whichever page is open at the time. No legitimate email',
        'has ever needed one.'
      ]);
      return null;
    }
    if (parsed.scheme === 'data') {
      add('high', 'A data: link carries the page with it' + where, at, url.length, [
        'The whole page travels inside the link, so there is no domain to check',
        'and nothing for a blocklist to match. A login form delivered this way',
        'shows your browser the address bar of nowhere in particular.',
        'Decode the payload in /labs/encoding rather than opening it.'
      ]);
      return null;
    }
    if (!host) return null;

    if (parsed.userinfo) {
      add('high', 'Everything before the @ in this link is ignored', at, url.length, [
        'Reads as: ' + parsed.userinfo + '@' + host,
        'A browser sends this request to ' + host + '. The part in front of the',
        '@ is a username field left over from the days of FTP, and it is the',
        'oldest way there is to put a trusted name in front of somebody else’s',
        'server.'
      ]);
    }

    if (isIpLiteral(host)) {
      add('high', 'The link points at a raw IP address, not a name', at, url.length, [
        'Host: ' + host,
        'An organisation that owns a domain uses it. A bare address means there',
        'is no certificate to check and no name to recognise — and in the',
        'decimal or hexadecimal forms, nothing readable at all.'
      ]);
    } else {
      var ascii = toAscii(host);
      if (ascii) {
        add('high', 'The link host is not the ASCII it appears to be', at, url.length, [
          'Displayed: ' + visible(host),
          'Actually resolves: ' + ascii,
          'Those are different domains. The characters in the first are drawn',
          'from other alphabets and render like Latin letters.'
        ]);
      }
      var uni = toUnicode(host);
      if (uni) {
        add('medium', 'The link host is punycode', at, url.length, [
          'Written: ' + host,
          'Renders as: ' + visible(uni),
          'xn-- is how a non-ASCII domain is written on the wire. It is legal and',
          'sometimes legitimate; it is also how a homoglyph domain reaches you.'
        ]);
      }
      var probe = uni || host;
      for (var c = 0; c < claims.length; c++) {
        var cmp = compareDomain(probe, claims[c]);
        if (cmp) {
          add(cmp.kind === 'twin' ? 'high' : 'medium',
              'Link host imitates ' + cmp.claim, at, url.length, [
            'Host: ' + visible(host),
            'Name it is dressed as: ' + cmp.claim,
            cmp.why.charAt(0).toUpperCase() + cmp.why.slice(1) + '.'
          ]);
          break;
        }
      }
      if (SHORTENERS.indexOf(registrable(host)) !== -1) {
        add('medium', 'Shortened link hides its destination', at, url.length, [
          'Host: ' + host,
          'Nothing about where this ends up is visible until it is followed, and',
          'following it tells the sender the message was opened. Nothing here',
          'fetches it. Expand it somewhere disposable, or treat it as unknown.'
        ]);
      }
      if (ODD_TLD.indexOf(tldOf(host)) !== -1) {
        add('low', 'Unusual top-level domain: .' + tldOf(host), at, url.length, [
          'Cheap or free registration makes these common in bulk campaigns.',
          'Plenty of ordinary sites use them too, so this is context, not proof.'
        ]);
      }
      var labels = lower(host).split('.').length;
      if (labels >= 5) {
        add('low', 'Deeply nested hostname (' + labels + ' labels)', at, url.length, [
          'Long chains of subdomains are used to push the real domain off the',
          'end of a narrow screen, where only the left-hand side is readable.'
        ]);
      }
    }

    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      add('medium', 'Link uses port ' + parsed.port, at, url.length, [
        'Public sites answer on 80 and 443. A high port usually means somebody',
        'is running a server on a machine that is not theirs, or is dodging a',
        'filter that only watches the usual two.'
      ]);
    }

    if (parsed.scheme === 'http' && !isIpLiteral(host)) {
      add('low', 'Plain http, not https', at, url.length, [
        'Anything typed into the page at the other end travels unencrypted.'
      ]);
    }

    /* Redirect chains and credential parameters both live in the query. */
    var tail = parsed.query + (parsed.fragment ? '#' + parsed.fragment : '');
    if (tail) {
      var hops = embeddedUrls(tail);
      if (hops.length) {
        var chain = [host];
        for (var h = 0; h < hops.length; h++) {
          var hopParsed = parseUrl(hops[h]);
          chain.push(hopParsed ? hopParsed.host : hops[h]);
        }
        var last = chain[chain.length - 1];

        /* What decides whether a chain is ordinary is not whether the far end
           belongs to the sender — an attacker's own redirector satisfies that
           trivially, and reading it as reassurance is how a credential-harvest
           link gets waved through. It is whether the far end is the place the
           reader was told they were going. When the link text names a host,
           that is the promise; without one there is nothing to compare and the
           chain is reported as it is. */
        var promised = promisedHost && registrable(last) === registrable(promisedHost);
        var homeward = !promisedHost && fromDomain &&
                       registrable(last) === registrable(fromDomain);
        var quiet = promised || homeward;
        var why = ['Chain: ' + chain.join('  →  ')];
        if (promised) {
          why.push('The far end is the host the link text named, so the visible');
          why.push('text is telling the truth and what sits in between is a');
          why.push('click-tracker. Ordinary in bulk mail, and the reason this');
          why.push('check on its own convicts a great deal of honest email.');
        } else if (homeward) {
          why.push('The far end is the sending domain itself. That is consistent');
          why.push('with a tracker, and it proves nothing on its own: a redirect');
          why.push('to the sender’s own domain is trivial for the sender to set up.');
        } else {
          why.push('You are sent to the first host, which forwards you to the next.');
          why.push('The first one never has to look suspicious. It only has to be');
          why.push('trusted enough to click, and the address bar you end up reading');
          why.push('is the last one in the chain.');
        }
        add(quiet ? 'low' : 'high', 'The link carries another link inside it',
            at, url.length, why);
      }

      /* Offsets inside the query are offsets inside the URL, not inside the
         query string on its own. Pointing at byte 0 of the link when the
         parameter sits eighty characters in is worse than not pointing. */
      var queryAt = at + (url.indexOf('?') + 1);
      var pairs = parsed.query.split('&'), cursor = 0;
      for (var p = 0; p < pairs.length; p++) {
        var pair = pairs[p];
        var eq = pair.indexOf('=');
        var key = lower(eq === -1 ? pair : pair.slice(0, eq));
        var val = eq === -1 ? '' : pair.slice(eq + 1);
        var decoded = safeDecode(val);
        if (CRED_PARAMS.indexOf(key) !== -1 && decoded) {
          if (/@/.test(decoded)) {
            add('medium', 'The link pre-fills an address: ' + key + '=', at, url.length, [
              'Value: ' + visible(decoded),
              'The fake page opens with the address already in the box, so it',
              'looks like it recognises you and only the password is missing.',
              'It also confirms to the sender that this address is live.'
            ]);
          } else if (/^(password|pass|pwd|otp)$/.test(key)) {
            add('high', 'A credential is being passed in the URL: ' + key + '=', at, url.length, [
              'Values in a URL end up in browser history, server logs and any',
              'proxy in between. Nothing legitimate puts one there.'
            ]);
          } else if (decoded.length >= 20 && /^[A-Za-z0-9._~-]+$/.test(decoded)) {
            add('low', 'Long identifier in the query: ' + key + '=', at, url.length, [
              'A per-recipient token. Following the link tells whoever sent it',
              'exactly which copy of the message was opened.'
            ]);
          }
        }
        if (REDIRECT_PARAMS.indexOf(key) !== -1 && /%3a%2f%2f|:\/\//i.test(val)) {
          /* Already reported by the chain check above; the parameter name is
             worth naming so the reader can find it in the URL. */
          add('low', 'Redirect parameter: ' + key + '=', queryAt + cursor, pair.length, [
            'This is the field carrying the onward address.'
          ]);
        }
        cursor += pair.length + 1;
      }
    }
    return parsed;
  }

  /* ------------------------------------------------------------------
     Attachments
     ------------------------------------------------------------------ */

  var DANGEROUS_EXT = ['exe', 'scr', 'com', 'pif', 'cpl', 'msi', 'msp', 'bat',
    'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'jar', 'wsf', 'wsh', 'hta',
    'lnk', 'chm', 'reg', 'inf', 'application', 'gadget', 'dll', 'sys', 'apk',
    'iso', 'img', 'vhd', 'vhdx', 'diagcab', 'appx', 'msix'];

  var MACRO_EXT = ['docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm',
    'ppam', 'sldm', 'xls', 'doc', 'ppt', 'one', 'slk', 'iqy'];

  var ARCHIVE_EXT = ['zip', 'rar', '7z', 'gz', 'tgz', 'bz2', 'xz', 'tar',
    'cab', 'ace', 'arj', 'z'];

  var LOOKS_LIKE_DOC = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'txt', 'csv', 'rtf', 'jpg', 'jpeg', 'png', 'gif', 'htm', 'html', 'msg', 'eml'];

  /* RFC 2047 encoded words, because a filename that has been base64'd is a
     filename nobody has read. */
  function decodeMimeWords(text) {
    return String(text).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
      function (whole, charset, enc, data) {
        try {
          if (lower(enc) === 'b') {
            var bin = atob(data.replace(/\s/g, ''));
            /* Assume UTF-8, which is what everything writes now. */
            return decodeURIComponent(bin.split('').map(function (ch) {
              return '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
          }
          return safeDecode(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, '%$1'));
        } catch (err) {
          return whole;
        }
      });
  }

  function extensionsOf(name) {
    var clean = String(name).replace(INVISIBLE_RE, '');
    var parts = clean.split('.');
    return parts.slice(1).map(function (p) { return lower(p); });
  }

  function analyseAttachments(text, bodyLower) {
    var re = /(?:filename\*?|(?:^|;\s*)name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\n]+))/gi;
    var m, seen = {}, count = 0;
    while ((m = re.exec(text)) !== null) {
      var rawName = (m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]) || '').trim();
      if (!rawName || rawName.indexOf('.') === -1) continue;
      var at = m.index + m[0].indexOf(rawName);
      /* RFC 2231: filename*=UTF-8''percent%20encoded */
      var name = rawName.replace(/^[A-Za-z0-9-]+''/, '');
      name = decodeMimeWords(safeDecode(name));
      if (seen[name]) continue;
      seen[name] = true;
      count++;
      if (count > MAX_NAMES) break;

      var exts = extensionsOf(name);
      var finalExt = exts.length ? exts[exts.length - 1] : '';
      var shown = visible(name);

      if (hasInvisible(rawName)) {
        var stripped = String(name).replace(INVISIBLE_RE, '');
        add('high', 'Attachment name contains a text-direction override', at, rawName.length, [
          'Stored as: ' + shown,
          'Real ending: .' + finalExt,
          'A right-to-left override tells the mail client to draw part of the',
          'name backwards, so the ending on screen is not the ending that runs.',
          'What is written in the bytes is what the operating system obeys.'
        ]);
      }

      if (exts.length >= 2 && LOOKS_LIKE_DOC.indexOf(exts[exts.length - 2]) !== -1 &&
          finalExt !== exts[exts.length - 2]) {
        add(DANGEROUS_EXT.indexOf(finalExt) !== -1 ? 'high' : 'medium',
            'Attachment has two extensions: ' + shown, at, rawName.length, [
          'Looks like: .' + exts[exts.length - 2],
          'Actually is: .' + finalExt,
          'Windows hides known extensions by default, so the last one is the',
          'one that runs and the one nobody sees.'
        ]);
      } else if (DANGEROUS_EXT.indexOf(finalExt) !== -1) {
        add('high', 'Executable attachment: ' + shown, at, rawName.length, [
          'A .' + finalExt + ' file runs code. There is no version of an invoice,',
          'a delivery note or a payslip that needs to.'
        ]);
      }

      if (MACRO_EXT.indexOf(finalExt) !== -1) {
        add('medium', 'Attachment can carry macros: ' + shown, at, rawName.length, [
          'The .' + finalExt + ' format holds executable content. If the document',
          'asks you to "enable editing" or "enable content" to see it, that',
          'request is the attack.'
        ]);
      }

      if (ARCHIVE_EXT.indexOf(finalExt) !== -1) {
        if (exts.length >= 2 && ARCHIVE_EXT.indexOf(exts[exts.length - 2]) !== -1) {
          add('high', 'An archive inside an archive: ' + shown, at, rawName.length, [
            'Nesting one archive in another is done for one reason: a scanner that',
            'unpacks a single layer stops before it reaches the file that matters.',
            'Nothing here can see inside either layer from the name alone.'
          ]);
        } else if (/\bpassword\b|\bpasscode\b|\bpin is\b/.test(bodyLower)) {
          add('high', 'Password-protected archive: ' + shown, at, rawName.length, [
            'The message supplies the password, which means the recipient can',
            'open it and every scanner between here and there cannot. That is',
            'the entire purpose of sending one.'
          ]);
        } else {
          add('low', 'Archive attachment: ' + shown, at, rawName.length, [
            'Nothing here can see inside an archive from its name. Open it in',
            '/labs/archive-inspector, which lists the contents without running',
            'anything, before you unpack it anywhere real.'
          ]);
        }
      }

      if (rawName !== name) {
        add('low', 'Attachment name was encoded: ' + shown, at, rawName.length, [
          'Written in the message as: ' + visible(rawName.slice(0, 60)),
          'Encoding a filename is normal for non-English names and is also a way',
          'to keep a suspicious one out of a simple filter.'
        ]);
      }
    }
    return count;
  }

  /* ------------------------------------------------------------------
     Language
     ------------------------------------------------------------------ */

  var LANGUAGE = [
    { key: 'urgency', label: 'Urgency', sev: 'low',
      note: 'Pressure exists to stop you checking. It is also how real deadlines sound.',
      phrases: ['within 24 hours', 'within 12 hours', 'within the hour', 'immediately',
        'urgent', 'asap', 'as soon as possible', 'right away', 'expires today',
        'expires tomorrow', 'final notice', 'last warning', 'before end of day',
        'time-sensitive', 'time sensitive', 'act now', 'overdue', 'past due',
        'will be suspended', 'will be closed', 'avoid interruption', 'failure to',
        'deadline', 'today only', 'do this now'] },
    { key: 'authority', label: 'Authority', sev: 'low',
      note: 'A title in the text carries no weight. Anyone can type "IT Helpdesk".',
      phrases: ['managing director', 'chief executive', 'ceo', 'cfo', 'head office',
        'it department', 'it helpdesk', 'service desk', 'system administrator',
        'compliance team', 'legal department', 'internal audit', 'hr department',
        'payroll department', 'on behalf of the director', 'authorised by',
        'board approved'] },
    { key: 'secrecy', label: 'Secrecy', sev: 'medium',
      note: 'A genuine instruction survives being checked with a colleague. This is the single strongest wording signal there is.',
      phrases: ['do not tell', 'don’t tell', 'keep this between us', 'strictly confidential',
        'keep this confidential', 'discreet', 'discretion', 'do not discuss',
        'without informing', 'do not inform', 'handle this personally',
        'keep this quiet', 'nobody else', 'no one else needs to know',
        'i am in a meeting', 'i cannot talk right now', 'only reply by email'] },
    { key: 'consequence', label: 'Threatened consequence', sev: 'low',
      note: 'Real organisations do warn about consequences. They rarely do it in the first message.',
      phrases: ['legal action', 'penalty', 'you will be fined', 'terminated',
        'disciplinary', 'permanently deleted', 'permanently removed', 'lose access',
        'account will be closed', 'account will be suspended', 'reported to',
        'police', 'court'] },
    { key: 'credentials', label: 'Asks for credentials or identity', sev: 'medium',
      note: 'No organisation needs you to confirm a password over email. Not one.',
      phrases: ['verify your account', 'confirm your account', 'confirm your identity',
        'confirm your password', 'update your password', 'reset your password now',
        're-enter your', 'validate your', 'update your payment', 'update your billing',
        'confirm your details', 'sign in to confirm', 'log in to verify',
        'click here to log in', 'unlock your account', 'reactivate your account',
        'scan the qr code', 'enter the code'] },
    { key: 'payment', label: 'Moves money or changes payment details', sev: 'medium',
      note: 'Every bank-detail change deserves a phone call to a number you already had.',
      phrases: ['new bank account', 'updated bank details', 'change the account',
        'change of bank', 'bank details have changed', 'account number has changed',
        'wire transfer', 'remit to', 'beneficiary', 'gift card', 'gift cards',
        'buy vouchers', 'crypto wallet', 'process this payment', 'release the payment',
        'update the vendor'] }
  ];

  function escapeRe(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* Words are joined with \s+ rather than a literal space. Mail wraps at
     seventy-odd columns, so "bank details have changed" arrives with a newline
     somewhere in the middle of it perhaps half the time, and a phrase list that
     only matches unwrapped text finds the careless messages and misses the
     ordinary ones. The matched text is taken from the region rather than from
     the phrase, so the highlight covers whatever was actually written,
     line break and all. */
  function phraseRegex(phrase) {
    var words = lower(phrase).split(/\s+/).map(escapeRe);
    return new RegExp('(^|[^a-z0-9])(' + words.join('\\s+') + ')([^a-z0-9]|$)', 'g');
  }

  function analyseLanguage(text, from, length) {
    var results = [];
    var region = text.substr(from, length);
    var regionLower = lower(region);
    LANGUAGE.forEach(function (group) {
      var hits = [];
      group.phrases.forEach(function (phrase) {
        var re = phraseRegex(phrase);
        var m;
        while ((m = re.exec(regionLower)) !== null) {
          var start = m.index + m[1].length;
          hits.push({ phrase: region.substr(start, m[2].length), at: from + start });
          /* Step back one so a match that begins inside this one's trailing
             boundary character is still found. */
          re.lastIndex = m.index + m[0].length - 1;
          if (hits.length > 12) break;
        }
      });
      if (hits.length) results.push({ group: group, hits: hits });
    });
    return results;
  }

  /* ------------------------------------------------------------------
     Authentication-Results
     ------------------------------------------------------------------ */

  function authVerdict(text, mech) {
    var m = new RegExp('(^|[\\s;])' + mech + '\\s*=\\s*([a-z]+)', 'i').exec(text || '');
    return m ? lower(m[2]) : null;
  }

  var AUTH_PLAIN = {
    spf: 'was the sending server allowed to send for that domain',
    dkim: 'is the message signed, and unaltered since it was signed',
    dmarc: 'does the domain owner’s published policy accept the combination'
  };

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */

  function excerpt(at, len) {
    if (at === null) return;
    var lineStart = RAW.lastIndexOf('\n', at) + 1;
    var lineEnd = RAW.indexOf('\n', at + len);
    if (lineEnd < 0) lineEnd = RAW.length;
    var before = RAW.slice(lineStart, at);
    var hit = RAW.substr(at, len);
    var after = RAW.slice(at + len, lineEnd);
    if (before.length > 40) before = '…' + before.slice(before.length - 40);
    if (after.length > 58) after = after.slice(0, 58) + '…';
    if (hit.length > 96) hit = hit.slice(0, 96) + '…';
    out.write('      ', 't-dim');
    out.write(visible(before), 't-dim');
    out.write(visible(hit), 'pd-hit');
    out.line(visible(after), 't-dim');
    out.line('      └ byte ' + byteAt(at) + '–' + byteAt(at + len) +
             ', line ' + lineAt(at), 't-dim');
  }

  function renderFindings() {
    var counts = { high: 0, medium: 0, low: 0, note: 0 };
    findings.forEach(function (f) { counts[f.sev]++; });

    out.heading('Findings');
    out.row('high', counts.high, counts.high ? 't-err' : 't-dim');
    out.row('medium', counts.medium, counts.medium ? 't-warn' : 't-dim');
    out.row('low', counts.low, counts.low ? 't-info' : 't-dim');
    out.line('');
    out.dim('There is no score and no percentage. Two of these can be enough and');
    out.dim('twenty can be a newsletter; what matters is which ones, and whether');
    out.dim('the message is asking you to do something irreversible.');
    out.line('');

    /* A bulk newsletter with two hundred tracked links produces a finding per
       link, and printing all of them buries the three that matter under a
       thousand identical paragraphs. The cap is announced rather than silent —
       an analysis that quietly stops is worse than one that says it stopped. */
    var shown = 0;
    SEV_ORDER.forEach(function (sev) {
      var group = findings.filter(function (f) { return f.sev === sev; });
      if (!group.length) return;
      group.forEach(function (f) {
        if (shown >= MAX_SHOWN) return;
        shown++;
        out.write(SEV_LABEL[sev] + '  ', SEV_CLASS[sev]);
        out.line(f.title, SEV_CLASS[sev]);
        excerpt(f.at, f.len);
        f.why.forEach(function (line) { out.line('      ' + line, 't-dim'); });
        out.line('');
      });
    });
    if (findings.length > shown) {
      out.warn((findings.length - shown) + ' further findings are not printed. They are counted');
      out.warn('above and they are the lower-severity ones, since the list is');
      out.warn('ordered worst-first.');
      out.line('');
    }
  }

  /* ------------------------------------------------------------------
     The pass itself
     ------------------------------------------------------------------ */

  function dissect(raw) {
    findings = [];
    RAW = normalise(raw);
    ASCII_ONLY = !/[^\x00-\x7F]/.test(RAW);
    indexPositions();

    var split = splitMessage(RAW);
    var headers = parseHeaders(split.headerText);
    /* A single URL on its own line is a legitimate thing to paste here, and it
       is not a header just because it contains a colon. */
    var trimmed = RAW.replace(/^\s+|\s+$/g, '');
    var urlOnly = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+$/.test(trimmed) ||
                  /^www\.\S+$/.test(trimmed);
    var looksLikeHeaders = !urlOnly && headers.length >= 2 &&
      (pick(headers, 'From') || pick(headers, 'Received') ||
       pick(headers, 'Subject') || pick(headers, 'Return-Path'));

    var mode = urlOnly ? 'url' : (looksLikeHeaders ? 'email' : 'body');
    var bodyStart = mode === 'email' ? split.bodyStart : 0;
    var bodyLength = RAW.length - bodyStart;
    var bodyLower = lower(RAW.slice(bodyStart));

    out.heading('Input');
    out.row('read as', mode === 'email' ? 'a full message, headers and body'
                     : (mode === 'url' ? 'a single URL' : 'a message body with no headers'));
    out.row('length', RAW.length + ' characters');
    if (mode === 'email') out.row('headers', headers.length);
    if (mode === 'body') {
      out.dim('No header block found, so the sender checks below are skipped.');
      out.dim('Paste from the top of the raw message to get those as well.');
    }
    out.rule();

    /* Everything the message claims to be, gathered once: the sender domain,
       the recipient's domain, anything domain-shaped in the display name, and
       the well-known names worth impersonating. Every host in the message is
       measured against this set. */
    var claims = [];
    var fromHeader = pick(headers, 'From');
    var from = parseAddress(fromHeader);
    var to = parseAddress(pick(headers, 'To'));
    var replyTo = parseAddress(pick(headers, 'Reply-To'));
    var returnPath = parseAddress(pick(headers, 'Return-Path'));
    var sender = parseAddress(pick(headers, 'Sender'));
    var fromDomain = from && from.domain;

    /* A claim is any name this message asks the reader to believe in. The
       recipient's own domain counts, because impersonating the reader's
       employer is the commonest internal lure; so does the receiving server's
       name, which survives even when the To line is hidden; so does anything
       domain-shaped in the display name or written as visible link text, since
       that is the name the reader will remember seeing. */
    if (to && to.domain) claims.push(to.domain);
    var deliveredTo = parseAddress(pick(headers, 'Delivered-To')) ||
                      parseAddress(pick(headers, 'X-Original-To'));
    if (deliveredTo && deliveredTo.domain) claims.push(deliveredTo.domain);

    var authServ = pick(headers, 'Authentication-Results');
    if (authServ) {
      var servId = authServ.value.split(/[;\s]+/)[0];
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(servId)) claims.push(lower(servId));
    }
    if (from && from.display) {
      (from.display.match(/\b(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}\b(?![.-])/gi) || [])
        .forEach(function (d) { claims.push(lower(d)); });
    }
    /* Anchor text is read before any link is analysed, so a host promised in
       the visible text can be used to judge the host it actually points at. */
    var labelRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi, labelMatch;
    while ((labelMatch = labelRe.exec(RAW)) !== null) {
      var labelText = labelMatch[1].replace(/<[^>]*>/g, '');
      var labelHostMatch = labelText.match(/\b(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}\b(?![.-])/i);
      if (labelHostMatch) claims.push(lower(labelHostMatch[0]));
    }
    /* The well-known names go last on purpose. A name this particular message
       claims is a better explanation of a near-miss domain than a global brand
       that happens to be a similar length, and the comparison stops at its
       first hit. */
    claims = claims.concat(BRANDS).filter(function (name, i, all) {
      return name && all.indexOf(name) === i;
    });

    if (mode === 'email') {
      out.heading('Who it says it is from');
      out.row('From', from ? visible(from.raw) : '(missing)', from ? null : 't-warn');
      if (replyTo) out.row('Reply-To', visible(replyTo.raw));
      if (returnPath) out.row('Return-Path', visible(returnPath.raw));
      if (sender) out.row('Sender', visible(sender.raw));
      var subjectHeader = pick(headers, 'Subject');
      out.row('Subject', subjectHeader ? visible(decodeMimeWords(subjectHeader.value)) : '(none)');
      if (to) out.row('To', visible(to.raw));
      out.line('');

      if (!from) {
        add('medium', 'No From header', null, 0, [
          'Every message has one. Either this is a partial paste or the block',
          'was assembled by hand.'
        ]);
      }

      /* --- display name against the address it hides --- */
      if (from && from.display) {
        var display = from.display;
        var nameAddr = display.match(/[^\s<>,;()"']+@[^\s<>,;()"']+/);
        if (nameAddr && fromDomain) {
          var nameDomain = lower(nameAddr[0].split('@').pop());
          if (registrable(nameDomain) !== registrable(fromDomain)) {
            add('high', 'The display name contains a different address', from.displayAt,
                display.length, [
              'Shown to the reader: ' + visible(display),
              'Delivers from: ' + from.addr,
              'Most mail clients show only the name. Putting an address in the',
              'name field is the cheapest spoof there is and needs no access to',
              'anything.'
            ]);
          }
        } else if (fromDomain) {
          var nameDomains = display.match(/\b(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}\b(?![.-])/gi) || [];
          for (var d = 0; d < nameDomains.length; d++) {
            if (registrable(nameDomains[d]) !== registrable(fromDomain)) {
              add('high', 'The display name claims a domain the address does not use',
                  from.displayAt, display.length, [
                'Name says: ' + visible(nameDomains[d]),
                'Address is: ' + from.addr,
                'The name is free text. It is written by whoever sent the message',
                'and checked by nobody.'
              ]);
              break;
            }
          }
        }
        if (hasInvisible(display) || confusablesIn(display).length) {
          var conf = confusablesIn(display);
          var lines = ['Name: ' + visible(display)];
          conf.slice(0, 6).forEach(function (c) {
            lines.push('  ' + c.code + ' renders as "' + c.ascii + '"');
          });
          lines.push('Characters chosen to look like Latin letters, or not to render');
          lines.push('at all. In a name field there is no innocent reason for either.');
          add('medium', 'The display name contains lookalike characters',
              from.displayAt, display.length, lines);
        }
      }

      /* --- the sending domain against everything the message claims --- */
      if (fromDomain) {
        var ascii = toAscii(fromDomain);
        if (ascii) {
          add('high', 'The sending domain is not the ASCII it appears to be',
              from.domainAt, fromDomain.length, [
            'Displayed: ' + visible(fromDomain),
            'Actually: ' + ascii,
            'This is a different registration from the one it imitates, and it',
            'can hold a valid certificate and pass every authentication check.'
          ]);
        }
        var uni = toUnicode(fromDomain);
        if (uni) {
          add('high', 'The sending domain is punycode', from.domainAt, fromDomain.length, [
            'Written: ' + fromDomain,
            'Renders as: ' + visible(uni)
          ]);
        }
        var probeDomain = uni || fromDomain;
        for (var ci = 0; ci < claims.length; ci++) {
          var cmp = compareDomain(probeDomain, claims[ci]);
          if (cmp) {
            add(cmp.kind === 'twin' ? 'high' : 'medium',
                'Sending domain imitates ' + cmp.claim, from.domainAt, fromDomain.length, [
              'Sends from: ' + visible(fromDomain),
              'Resembles:  ' + cmp.claim,
              cmp.why.charAt(0).toUpperCase() + cmp.why.slice(1) + '.',
              'A separate registration passes SPF, DKIM and DMARC on its own name.',
              'Authentication proves origin. It says nothing about honesty.'
            ]);
            break;
          }
        }
        if (FREEMAIL.indexOf(registrable(fromDomain)) !== -1 &&
            from.display && /\b(ltd|limited|inc|llc|plc|gmbh|pvt|bank|support|team|department|helpdesk|billing|payroll|hr)\b/i.test(from.display)) {
          add('medium', 'A company role, sent from a free mailbox', from.domainAt,
              fromDomain.length, [
            'Domain: ' + fromDomain,
            'Organisations that have a domain send from it. A free mailbox with a',
            'departmental name in front of it is the cheapest impersonation there',
            'is, and it costs nothing to register another when this one is closed.'
          ]);
        }
      }

      /* --- replies and the envelope --- */
      if (replyTo && replyTo.domain && fromDomain &&
          registrable(replyTo.domain) !== registrable(fromDomain)) {
        var free = FREEMAIL.indexOf(registrable(replyTo.domain)) !== -1;
        add('high', 'Replies go somewhere other than the sender', replyTo.domainAt,
            replyTo.domain.length, [
          'From:     ' + fromDomain,
          'Reply-To: ' + replyTo.domain + (free ? '  (a free mailbox)' : ''),
          'Hitting reply sends your answer to the second one. This is the whole',
          'mechanism behind invoice fraud: the thread looks continuous and every',
          'answer lands with the attacker.'
        ]);
      }
      if (returnPath && returnPath.domain && fromDomain &&
          registrable(returnPath.domain) !== registrable(fromDomain)) {
        add('low', 'Envelope sender differs from the From line', returnPath.domainAt,
            returnPath.domain.length, [
          'Envelope (Return-Path): ' + returnPath.domain,
          'Header (From):          ' + fromDomain,
          'Normal for mailing lists and any company that sends through a bulk',
          'provider. Also what a spoofed envelope looks like, so read it next to',
          'the authentication results rather than on its own.'
        ]);
      }
      if (to && /undisclosed[- ]recipients/i.test(to.raw)) {
        add('low', 'The recipient list is hidden', to.at, to.raw.length, [
          'Your address is not in the To line, so this went out in bulk with',
          'everyone bcc’d. Rare for anything genuinely addressed to you.'
        ]);
      }

      /* --- authentication --- */
      var authHeaders = pickAll(headers, 'Authentication-Results')
        .concat(pickAll(headers, 'ARC-Authentication-Results'));
      var authText = authHeaders.map(function (h) { return h.value; }).join(' ; ');
      var receivedSpf = pick(headers, 'Received-SPF');
      var spf = authVerdict(authText, 'spf');
      if (!spf && receivedSpf) spf = lower(receivedSpf.value.split(/\s+/)[0]);
      var dkim = authVerdict(authText, 'dkim');
      var dmarc = authVerdict(authText, 'dmarc');

      out.rule();
      out.heading('Authentication, as the receiving server recorded it');
      if (!authHeaders.length && !receivedSpf) {
        out.dim('None present. Either the server does not stamp them or the paste');
        out.dim('starts below the line that carried them.');
      } else {
        [['SPF', spf], ['DKIM', dkim], ['DMARC', dmarc]].forEach(function (row) {
          var verdict = row[1];
          var cls = verdict === 'pass' ? 't-ok'
                  : (verdict === 'fail' || verdict === 'softfail' ||
                     verdict === 'permerror' || verdict === 'temperror') ? 't-err'
                  : verdict ? 't-warn' : 't-dim';
          out.row(row[0], verdict || 'not stated', cls);
          out.dim('    ' + AUTH_PLAIN[lower(row[0])]);
        });
        out.line('');
        if (spf === 'pass' && dkim === 'pass' && dmarc === 'pass') {
          out.ok('All three pass, so the message really did come from ' +
                 (fromDomain || 'that domain') + '.');
          out.dim('Read that literally. It proves which domain sent the message. It');
          out.dim('does not prove the domain is who you think it is, that the domain');
          out.dim('is not one character away from the real one, or that the account');
          out.dim('behind it has not been taken over. Every finding above still');
          out.dim('stands after a clean pass.');
        } else if (dmarc === 'fail' || spf === 'fail' || dkim === 'fail') {
          out.err('At least one check failed outright.');
          out.dim('For a message claiming to be a real organisation this is close to');
          out.dim('conclusive: their mail passes, and this did not.');
        } else {
          out.warn('Not a clean set. Missing is weaker evidence than failing, but a');
          out.warn('domain that publishes nothing has also chosen not to be checkable.');
        }
        if (dmarc === 'fail') {
          var dmarcHeader = authHeaders.length ? authHeaders[0] : null;
          add('high', 'DMARC failed', dmarcHeader ? dmarcHeader.valueAt : null,
              dmarcHeader ? dmarcHeader.value.length : 0, [
            'The domain in the From line publishes a policy, and this message did',
            'not satisfy it. That is the domain owner telling you, in advance,',
            'that mail like this is not theirs.'
          ]);
        } else if (spf === 'fail' || dkim === 'fail') {
          add('medium', 'An authentication check failed',
              authHeaders.length ? authHeaders[0].valueAt : null,
              authHeaders.length ? authHeaders[0].value.length : 0, [
            'SPF: ' + (spf || 'not stated') + ', DKIM: ' + (dkim || 'not stated') +
            ', DMARC: ' + (dmarc || 'not stated'),
            'Read the delivery path in /labs/email-headers to see which hop said so.'
          ]);
        }
        out.dim('');
        out.dim('The hop-by-hop path, the timing and the originating IP are a');
        out.dim('separate job: /labs/email-headers does that one properly.');
      }
      out.rule();
    }

    /* --- links --- */
    var linkRanges = [];
    var urlCount = 0;

    if (mode === 'url') {
      urlCount = 1;
      analyseUrl(trimmed, RAW.indexOf(trimmed), null, null, claims, null);
    } else {
      var anchorRe = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
      var a;
      while ((a = anchorRe.exec(RAW)) !== null && urlCount < MAX_LINKS) {
        var href = (a[1] !== undefined ? a[1] : (a[2] !== undefined ? a[2] : a[3]) || '').trim();
        var label = a[4].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
        if (!href) continue;
        var hrefAt = a.index + a[0].indexOf(href);
        linkRanges.push([a.index, a.index + a[0].length]);
        urlCount++;

        /* Anchor text that is itself a domain is a promise about where the
           link goes, and it is the promise people read. Worked out before the
           link is analysed, because the redirect check needs it. */
        var labelHost = null;
        var labelUrl = label.match(/^(?:https?:\/\/)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:[/?#]|$)/);
        if (labelUrl) labelHost = labelUrl[1];

        analyseUrl(href, hrefAt, 'linked from "' + label.slice(0, 40) + '"',
                   fromDomain, claims, labelHost);

        var hrefParsed = parseUrl(href);
        if (labelHost && hrefParsed && hrefParsed.host &&
            registrable(labelHost) !== registrable(hrefParsed.host)) {
          var onward = embeddedUrls(hrefParsed.query + hrefParsed.fragment);
          var finalHost = hrefParsed.host;
          if (onward.length) {
            var lastParsed = parseUrl(onward[onward.length - 1]);
            if (lastParsed && lastParsed.host) finalHost = lastParsed.host;
          }
          var honest = registrable(finalHost) === registrable(labelHost);
          var labelAt = a.index + a[0].lastIndexOf(label);
          add(honest ? 'low' : 'high',
              honest ? 'Link text and destination differ, but only by a redirect'
                     : 'The link text says one place and the link goes to another',
              labelAt, label.length,
              honest ? [
                'Text: ' + labelHost,
                'Href: ' + hrefParsed.host + '  →  ' + finalHost,
                'The visible text is where you actually end up. What sits in',
                'between is a click-tracker, which is ordinary in bulk mail and',
                'is also why this check alone convicts a lot of innocent email.'
              ] : [
                'Text: ' + labelHost,
                'Href: ' + visible(hrefParsed.host),
                'Written text has no relationship to the target. This is the',
                'oldest trick in the file and still the most effective, because',
                'the address is the one thing a reader is told to check.'
              ]);
        }
      }

      var bareRe = /(?:https?|ftp|data|javascript):[^\s<>"'()\]]+/gi;
      var b;
      while ((b = bareRe.exec(RAW)) !== null && urlCount < MAX_LINKS) {
        var inside = false;
        for (var r = 0; r < linkRanges.length; r++) {
          if (b.index >= linkRanges[r][0] && b.index < linkRanges[r][1]) { inside = true; break; }
        }
        if (inside) continue;
        /* Skip the ones that are only there as evidence in a header. */
        if (b.index < bodyStart && mode === 'email' &&
            !/^https?:/i.test(b[0])) continue;
        urlCount++;
        analyseUrl(b[0].replace(/[.,;:]+$/, ''), b.index, null, fromDomain, claims, null);
      }
    }

    /* --- attachments --- */
    var attachments = mode === 'url' ? 0 : analyseAttachments(RAW, bodyLower);

    /* --- language --- */
    var languageHits = [];
    if (mode !== 'url') {
      var subjectHeaderForLang = pick(headers, 'Subject');
      if (subjectHeaderForLang) {
        var subjRaw = subjectHeaderForLang.value;
        var subjDecoded = decodeMimeWords(subjRaw);
        if (subjDecoded === subjRaw) {
          languageHits = languageHits.concat(
            analyseLanguage(RAW, subjectHeaderForLang.valueAt, subjRaw.length));
        } else {
          /* An encoded subject has no character-for-character mapping back
             into RAW, so the phrase list has to run over the decoded text and
             every hit is anchored at the start of the subject's raw value.
             The highlight lands on the header rather than the exact word,
             which is the price of detecting it at all — scanning the raw
             encoded word found nothing, so base64-ing the subject skipped
             every wording check in the tool. */
          languageHits = languageHits.concat(
            analyseLanguage(subjDecoded, 0, subjDecoded.length).map(function (r) {
              r.hits.forEach(function (h) { h.at = subjectHeaderForLang.valueAt; });
              return r;
            }));
        }
      }
      languageHits = languageHits.concat(analyseLanguage(RAW, bodyStart, bodyLength));
    }

    /* Merge the two passes so a phrase in both the subject and the body is one
       group, not two. */
    var merged = {};
    languageHits.forEach(function (entry) {
      var key = entry.group.key;
      if (!merged[key]) merged[key] = { group: entry.group, hits: [] };
      merged[key].hits = merged[key].hits.concat(entry.hits);
    });
    var languageGroups = Object.keys(merged).map(function (k) { return merged[k]; });

    var pressure = 0;
    languageGroups.forEach(function (entry) {
      if (entry.group.sev === 'medium') pressure++;
    });

    renderFindings();

    /* --- language section, printed separately because it is evidence of a
           different kind: it never proves anything on its own. --- */
    if (languageGroups.length) {
      out.heading('Wording');
      out.dim('Matched phrases, shown where they appear. Wording is the weakest');
      out.dim('signal in this whole tool — urgent emails from real people exist,');
      out.dim('and a careful attacker writes calmly. Read it as pressure, not proof.');
      out.line('');
      languageGroups.forEach(function (entry) {
        out.line(entry.group.label + '  (' + entry.hits.length +
                 (entry.hits.length === 1 ? ' phrase)' : ' phrases)'),
                 entry.group.sev === 'medium' ? 't-warn' : 't-info');
        out.line('  ' + entry.group.note, 't-dim');
        entry.hits.sort(function (x, y) { return x.at - y.at; });
        entry.hits.slice(0, 8).forEach(function (hit) {
          excerpt(hit.at, hit.phrase.length);
        });
        if (entry.hits.length > 8) {
          out.dim('      …and ' + (entry.hits.length - 8) + ' more');
        }
        out.line('');
      });
    }

    /* --- what to do --- */
    out.rule();
    out.heading('Reading this');
    var high = findings.filter(function (f) { return f.sev === 'high'; }).length;
    var medium = findings.filter(function (f) { return f.sev === 'medium'; }).length;

    if (high) {
      out.err(high === 1 ? 'There is one high-severity finding. It is quoted above with the'
                         : 'There are ' + high + ' high-severity findings. Each is quoted above with the');
      out.err('offset it came from, so you can check the claim rather than take my');
      out.err('word for it.');
    } else if (medium || pressure) {
      out.warn('Nothing here is conclusive on its own, and several things are worth');
      out.warn('a second look. Messages that move money or ask for a credential');
      out.warn('deserve a phone call to a number you already had.');
    } else {
      out.ok('Nothing in this message matched a check here.');
      out.line('');
      out.warn('That is not proof of safety, and it is important that it is not read');
      out.warn('as one. A plain-text message from a compromised real account, with a');
      out.warn('real signature and a genuine reply address, passes everything above');
      out.warn('and is still fraud. The checks here catch impersonation and');
      out.warn('misdirection. They cannot catch a legitimate mailbox in the wrong');
      out.warn('hands.');
    }
    out.line('');
    out.dim('Counts: ' + urlCount + ' link' + (urlCount === 1 ? '' : 's') + ', ' +
            attachments + ' attachment name' + (attachments === 1 ? '' : 's') +
            ' examined.');
    if (urlCount >= MAX_LINKS) {
      out.warn('That is the ceiling, not the total — this message has more links');
      out.warn('than that and the rest were not read. A mailout with hundreds of');
      out.warn('them is worth pasting in pieces if you need all of them checked.');
    }
    if (attachments > MAX_NAMES) {
      out.warn('Attachment names stop at ' + MAX_NAMES + ' as well.');
    }
    out.line('');
    out.dim('Nothing above left this tab. No link was fetched, no domain was');
    out.dim('resolved, no address was checked against a list held anywhere else.');
    out.dim('Opening a phishing link tells the sender the address is live and that');
    out.dim('somebody read it, which is why this tool refuses to touch one.');
    out.line('');
    out.dim('Next: the delivery path in /labs/email-headers, one link in depth in');
    out.dim('/labs/url-inspector, the domain’s own records in /labs/dns.');
  }

  /* ------------------------------------------------------------------
     Worked examples. Every one is invented — the brands, the people, the
     invoice numbers and the domains are all made up, and the addresses use
     reserved documentation ranges. Real campaign text is not reproduced here;
     these are constructed to demonstrate one technique each.
     ------------------------------------------------------------------ */

  /* The right-to-left override used by the helpdesk example, kept as an
     escape for the same reason as the table at the top of this file: a
     sample whose whole point is an invisible character is worthless if the
     character can vanish from the source without anyone noticing. */
  var RLO = '\u202E';

  var SAMPLES = {
    invoice: [
      'Return-Path: <bounce@mail-vantexa-billing.com>',
      'Received: from mail-vantexa-billing.com (mail-vantexa-billing.com [198.51.100.24])',
      '        by mx.northwind-freight.example with ESMTPS id 8f21ac',
      '        for <accounts.payable@northwind-freight.example>;',
      '        Tue, 12 Aug 2025 09:14:02 +0000',
      'Authentication-Results: mx.northwind-freight.example;',
      '        spf=pass smtp.mailfrom=mail-vantexa-billing.com;',
      '        dkim=pass header.d=vantexa-billing.com;',
      '        dmarc=fail header.from=vantexa-billing.com',
      'From: "Vantexa Billing (vantexa.com)" <accounts@vantexa-billing.com>',
      'Reply-To: <vantexa.accounts@mail.com>',
      'To: accounts.payable@northwind-freight.example',
      'Subject: FINAL NOTICE - invoice VX-88421 overdue, account will be suspended',
      'Date: Tue, 12 Aug 2025 09:14:02 +0000',
      'Message-ID: <88421.vx@mail-vantexa-billing.com>',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Dear Accounts Payable,</p>',
      '<p>Invoice VX-88421 is now past due. This is the final notice. Payment must',
      'be received within 24 hours or the account will be suspended and the matter',
      'passed to our legal department.</p>',
      '<p>Statement: <a href="http://198.51.100.77:8080/vantexa/pay?email=accounts.payable@northwind-freight.example">https://billing.vantexa.com/statement</a></p>',
      '<p>The signed copy is attached.</p>',
      '',
      '--b1',
      'Content-Type: application/octet-stream; name="Invoice_VX-88421.pdf.exe"',
      'Content-Disposition: attachment; filename="Invoice_VX-88421.pdf.exe"',
      '',
      '--b1',
      'Content-Type: application/zip; name="Statements_July.zip.zip"',
      'Content-Disposition: attachment; filename="Statements_July.zip.zip"',
      '',
      '--b1--'
    ].join('\n'),

    credential: [
      'Return-Path: <bounce@mx3.secure-alerts.top>',
      'Received: from mx3.secure-alerts.top (mx3.secure-alerts.top [203.0.113.66])',
      '        by mx.northwind-freight.example with ESMTP id 41bb02;',
      '        Wed, 03 Sep 2025 22:41:19 +0000',
      'Authentication-Results: mx.northwind-freight.example;',
      '        spf=pass smtp.mailfrom=mx3.secure-alerts.top;',
      '        dkim=none;',
      '        dmarc=none header.from=secure-alerts.top',
      'From: "Vantexa Account Security" <alerts@secure-alerts.top>',
      'To: r.mehta@northwind-freight.example',
      'Subject: Unusual sign-in blocked - confirm your identity within 12 hours',
      'Date: Wed, 03 Sep 2025 22:41:19 +0000',
      'Message-ID: <a41bb02@mx3.secure-alerts.top>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>We blocked a sign-in to your Vantexa account from a device we do not',
      'recognise. Verify your account within 12 hours or access will be',
      'permanently removed.</p>',
      '<p><a href="https://xn--vntexa-3nf.com/login?email=r.mehta@northwind-freight.example&amp;next=https%3A%2F%2Flogin-capture.secure-alerts.top%2Fdone">https://vantexa.com/security/verify</a></p>',
      '<p>If the link does not open, use this one instead:',
      'https://bit.ly/EXAMPLE-not-a-real-link</p>',
      '<p>The sign-in report is attached. The archive password is 4471.</p>',
      '',
      'Content-Type: application/zip; name="Sign-in_report.zip"',
      'Content-Disposition: attachment; filename="Sign-in_report.zip"'
    ].join('\n'),

    payroll: [
      'Return-Path: <d.osei@dir-northwind.com>',
      'Received: from mail.dir-northwind.com (mail.dir-northwind.com [198.51.100.9])',
      '        by mx.northwind-freight.example with ESMTPS id 77c0de;',
      '        Mon, 01 Sep 2025 07:02:44 +0000',
      'Authentication-Results: mx.northwind-freight.example;',
      '        spf=pass smtp.mailfrom=dir-northwind.com;',
      '        dkim=pass header.d=dir-northwind.com;',
      '        dmarc=pass header.from=dir-northwind.com',
      'From: "Daniel Osei - Managing Director" <d.osei@dir-northwind.com>',
      'Reply-To: <northwind.dosei@gmail.com>',
      'To: payroll@northwind-freight.example',
      'Subject: Quick one before the run',
      'Date: Mon, 01 Sep 2025 07:02:44 +0000',
      'Message-ID: <77c0de@mail.dir-northwind.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Morning,',
      '',
      'I am in a meeting most of today so email is easiest. My bank details have',
      'changed and I need this done before the payroll run closes. Please update',
      'the account on my record to the new bank account below and confirm once it',
      'is done.',
      '',
      'Account name: D Osei',
      /* 00-00-00 is not issued to any institution, which is the point: every
         other string in these samples is an invented brand, a .example domain
         or an RFC 5737 address, and a sort code that happens to resolve to a
         real bank would have been the one piece of bank-adjacent data in the
         batch. The sample teaches the same thing either way. */
      'Sort code: 00-00-00',
      'Account number: 00000000',
      '',
      'Keep this between us until the announcement on Friday - I do not want the',
      'rest of the team asking about it. Do not discuss it with finance, I will',
      'brief them myself.',
      '',
      'Thanks,',
      'Daniel'
    ].join('\n'),

    helpdesk: [
      'Return-Path: <helpdesk@northwlnd-freight.com>',
      'Received: from vps-41.hosting-example.net (vps-41.hosting-example.net [203.0.113.42])',
      '        by mx.northwind-freight.example with ESMTP id 0091fe;',
      '        Thu, 14 Aug 2025 08:55:10 +0000',
      'Authentication-Results: mx.northwind-freight.example;',
      '        spf=softfail smtp.mailfrom=northwlnd-freight.com;',
      '        dkim=none;',
      '        dmarc=fail header.from=northwlnd-freight.com',
      'From: "Northwind IT Helpdesk" <helpdesk@northwlnd-freight.com>',
      'To: undisclosed-recipients:;',
      'Subject: URGENT: multi-factor re-enrolment required today, failure to act will lock your account',
      'Date: Thu, 14 Aug 2025 08:55:10 +0000',
      'Message-ID: <0091fe@vps-41.hosting-example.net>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>All staff must re-enrol in multi-factor authentication before end of day.',
      'Accounts not re-enrolled will lose access at 18:00.</p>',
      '<p>Re-enrol here: <a href="http://203.0.113.42:8443/owa/re-enrol?user=staff">https://portal.northwind-freight.example/mfa</a></p>',
      '<p>If the portal is slow, the offline form works too:',
      '<a href="data:text/html,&lt;form&gt;Username&lt;input&gt;Password&lt;input&gt;&lt;/form&gt;">offline enrolment form</a></p>',
      '<p>The desktop helper is attached. Run it and sign in to confirm.</p>',
      '',
      'Content-Type: application/octet-stream;',
      '        name="MFA_Setup_2025' + RLO + 'gpj.exe"',
      'Content-Disposition: attachment; filename="MFA_Setup_2025' + RLO + 'gpj.exe"'
    ].join('\n'),

    legit: [
      'Return-Path: <bounce-8842-4471@bounce.mailer-sendspring.example>',
      'Received: from mta-14.mailer-sendspring.example (mta-14.mailer-sendspring.example [198.51.100.140])',
      '        by mx.northwind-freight.example with ESMTPS id 5512ab;',
      '        Fri, 29 Aug 2025 06:30:02 +0000',
      'Authentication-Results: mx.northwind-freight.example;',
      '        spf=pass smtp.mailfrom=bounce.mailer-sendspring.example;',
      '        dkim=pass header.d=vantexa.com;',
      '        dmarc=pass header.from=vantexa.com',
      'From: "Vantexa Cloud Billing" <billing@vantexa.com>',
      'To: accounts.payable@northwind-freight.example',
      'Subject: Action required: your subscription renews on 3 September',
      'Date: Fri, 29 Aug 2025 06:30:02 +0000',
      'Message-ID: <5512ab.8842@mailer-sendspring.example>',
      'List-Unsubscribe: <https://click.mailer-sendspring.example/u/8842>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hello,</p>',
      '<p>Your Vantexa Cloud subscription renews on 3 September. The card ending',
      '4471 expires before then, so please update your payment method to avoid',
      'interruption of service.</p>',
      '<p><a href="https://click.mailer-sendspring.example/f/a/9x2?url=https%3A%2F%2Fvantexa.com%2Fbilling%2Fmethods&amp;id=8842-4471-a">vantexa.com/billing/methods</a></p>',
      '<p>Your invoice history is attached as a PDF.</p>',
      '',
      'Content-Type: application/pdf; name="Vantexa_invoices_2025.pdf"',
      'Content-Disposition: attachment; filename="Vantexa_invoices_2025.pdf"'
    ].join('\n'),

    link: 'https://vantexa.com@xn--vntexa-3nf.top:8443/verify' +
          '?redirect=https%3A%2F%2Fbit.ly%2FEXAMPLE-not-a-real-link' +
          '&email=a.rao%40northwind-freight.example'
  };

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  function run() {
    var field = document.getElementById('tool-text');
    var raw = field ? field.value : '';
    out.clear();
    if (!raw.replace(/\s/g, '')) {
      out.warn('Paste a message first, or load one of the worked examples above.');
      out.line('');
      out.dim('A full raw message gives the most: Gmail → ⋮ → "Show original",');
      out.dim('Outlook → File → Properties → Internet headers. A body on its own,');
      out.dim('or a single URL, both work too — you just get fewer checks.');
      return;
    }
    if (raw.length > MAX_INPUT) {
      out.err('That is ' + raw.length + ' characters. This tool stops at ' +
              MAX_INPUT + ',');
      out.err('because every check below scans the whole text and the work happens');
      out.err('on your processor, in this tab. Paste the message without the');
      out.err('quoted thread underneath it.');
      return;
    }
    /* Same reasoning as the report() wrapper in exif.js: this runs bare from a
       click handler, out.clear() has already fired, and a throw would leave an
       empty pane and no explanation. Malformed input is the normal case here. */
    try {
      dissect(raw);
    } catch (err) {
      out.rule();
      out.err('The dissection stopped part-way through. Whatever printed above is');
      out.err('still correct; the rest did not run.');
      out.line('');
      out.dim('Nothing was uploaded. Details: ' + ((err && err.message) || String(err)));
      out.dim('If you can share the shape of the message that did this, I will fix it.');
    }
  }

  function loadSample(key) {
    var field = document.getElementById('tool-text');
    if (!field || !SAMPLES[key]) return;
    field.value = SAMPLES[key];
    field.scrollTop = 0;
    run();
    /* Focus the output rather than the textarea: the visitor pressed a button
       to see a result, and a screen reader should land on the result. */
    if (out.node && out.node.focus) out.node.focus();
  }

  LabTool.define({
    id: 'phishingtool',
    run: run,
    onReady: function () {
      var buttons = document.querySelectorAll('[data-sample]');
      Array.prototype.forEach.call(buttons, function (btn) {
        btn.addEventListener('click', function () {
          loadSample(btn.getAttribute('data-sample'));
        });
      });
      var clear = document.getElementById('tool-clear');
      if (clear) {
        clear.addEventListener('click', function () {
          var field = document.getElementById('tool-text');
          if (field) { field.value = ''; field.focus(); }
          out.clear();
          out.dim('Cleared. Nothing was stored anywhere in the first place.');
        });
      }
      out.dim('Paste a raw email and press Dissect, or load a worked example.');
      out.dim('');
      out.dim('A whole message gives the most to work with, but a body on its own');
      out.dim('or a single URL are both fine — the checks that need headers are');
      out.dim('skipped and the rest still run.');
      out.dim('');
      out.dim('Nothing is uploaded, no link is fetched and no domain is resolved.');
    }
  });
})();

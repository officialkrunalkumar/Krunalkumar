/* ==========================================================================
   cookie-inspector.js — read a Set-Cookie header the way a browser reads it.
   --------------------------------------------------------------------------
   Almost every cookie bug I have watched somebody hit is the same bug: the
   header was written, the browser quietly disagreed, and nothing anywhere
   said so. A cookie named __Secure-session sent without the Secure attribute
   is not stored as an ordinary cookie — it is thrown away, and the only
   symptom is a login that will not stick. SameSite=None without Secure goes
   the same way. Unrecognised attributes are dropped in silence, so writing
   HttpsOnly instead of HttpOnly buys you a readable session cookie and no
   error in any console.

   So this parses the header the way RFC 6265 says to, including the parts
   that feel wrong when you first read them: the split on ';' happens before
   quotes are ever considered, so a semicolon inside a quoted value truncates
   the cookie; Max-Age beats Expires whatever order the two appear in; and a
   two-digit year in a cookie date means 19xx or 20xx depending on which side
   of 70 it falls on. Matching the browser matters more here than matching
   intuition, because the browser is the thing that will actually decide.

   Where 6265 and its revision disagree, the browser wins here too. A header
   with no '=' in it is the case that matters: the 2011 RFC says to ignore it,
   and 6265bis says the name is empty and the whole string is the value — a
   nameless cookie, which is what the browsers store. Reporting that as
   "ignored, nothing happened" would have been the comfortable answer and the
   wrong one, so the output states both readings and says the outcome depends
   on what is reading it.

   The honest half. This reads text. It makes no request, so it cannot tell
   you whether the cookie was really stored, what your framework wrote after
   its own middleware got hold of it, or whether the value is a guessable
   session id — which is the worst thing a cookie can carry and the one thing
   the header never shows. Browser behaviour also moves: third-party cookie
   policy and the Lax carve-outs have changed more than once, so where a rule
   is in flux this says so rather than stating a version-specific fact as if
   it were permanent. The score at the end is mine, not a standard; every
   deduction prints with its reason so the weights can be argued with.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  var MAX_CHARS = 200000;   // whole paste
  var MAX_COOKIES = 40;     // rendered per run
  var MAX_ECHO = 240;       // characters of a header echoed back
  var DAY = 86400;
  var CAP_DAYS = 400;       // the expiry ceiling current browsers apply

  /* An attribute name comes out of the paste, so it can be anything at all —
     including "constructor", "toString" or "__proto__", every one of which an
     ordinary object already answers to. Looking a name up with obj[key] and
     believing a truthy answer classified "; constructor=1" as a known
     attribute. Every lookup on a table keyed by untrusted text goes through
     here instead. */
  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  var KNOWN = {
    'expires': 1, 'max-age': 1, 'domain': 1, 'path': 1, 'secure': 1,
    'httponly': 1, 'samesite': 1, 'partitioned': 1, 'priority': 1
  };

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function clip(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + ' (cut, ' + s.length + ' characters total)' : s;
  }

  /* UTF-8 byte length, because the browser limits are counted in bytes and a
     value full of emoji or Devanagari is three or four times its character
     count. A lone surrogate is counted as 3, which is what an encoder that
     substitutes U+FFFD would produce. */
  function utf8Len(s) {
    var n = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length &&
               s.charCodeAt(i + 1) >= 0xDC00 && s.charCodeAt(i + 1) <= 0xDFFF) {
        n += 4; i++;
      } else n += 3;
    }
    return n;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* A Date tops out at ±8.64e15 ms, and "Max-Age=99999999999999999999" — which
     is exactly the kind of thing that gets pasted into a tool like this — sails
     past it. Before this guard the row read "expires at  NaN-NaN-NaN
     NaN:NaN:NaN UTC", which reads as the tool being broken rather than as the
     header being absurd. */
  var MAX_TIME = 8.64e15;

  function fmtUtc(ms) {
    if (!isFinite(ms) || Math.abs(ms) > MAX_TIME) {
      return 'further away than a date can be written';
    }
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' +
           pad2(d.getUTCDate()) + ' ' + pad2(d.getUTCHours()) + ':' +
           pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) + ' UTC';
  }

  function imfDate(ms) {
    var d = new Date(ms);
    return WDAY[d.getUTCDay()] + ', ' + pad2(d.getUTCDate()) + ' ' +
           MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' +
           pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' +
           pad2(d.getUTCSeconds()) + ' GMT';
  }

  function humanDuration(sec) {
    var past = sec < 0;
    var s = Math.abs(Math.round(sec));
    var days = Math.floor(s / DAY);
    var hours = Math.floor((s % DAY) / 3600);
    var mins = Math.floor((s % 3600) / 60);
    var secs = s % 60;
    var parts = [];
    if (days) parts.push(days + (days === 1 ? ' day' : ' days'));
    if (hours) parts.push(hours + (hours === 1 ? ' hour' : ' hours'));
    if (mins && days === 0) parts.push(mins + (mins === 1 ? ' minute' : ' minutes'));
    if (secs && days === 0 && hours === 0) {
      parts.push(secs + (secs === 1 ? ' second' : ' seconds'));
    }
    if (!parts.length) parts.push('0 seconds');
    var text = parts.join(' ');
    if (days >= 365) text += ', about ' + (days / 365.25).toFixed(1) + ' years';
    return past ? text + ' ago' : text;
  }

  /* --- the cookie-date parser, RFC 6265 section 5.1.1 --------------------
     Deliberately not Date.parse(). Date.parse accepts things a browser cookie
     store does not and rejects the two-digit-year Netscape form that plenty of
     old server code still emits, so a header that a real browser reads
     perfectly well would have come back "unparseable" here.

     The RFC tokenises on its own delimiter set — note that ':' is NOT a
     delimiter, which is the whole reason 10:18:14 survives as one token — then
     takes the first thing that looks like a time, the first that looks like a
     day, the first that looks like a month and the first that looks like a
     year, in that order of preference. The day production is 1*2DIGIT followed
     by a non-digit, which is what stops a four-digit year being eaten as the
     day of the month. */
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function parseCookieDate(text) {
    var tokens = String(text).split(/[\x09\x20-\x2F\x3B-\x40\x5B-\x60\x7B-\x7E]+/);
    var h = -1, mi = -1, se = -1, day = -1, mon = -1, year = -1;
    var i, t, m, idx;
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i];
      if (!t) continue;
      if (h < 0) {
        m = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?!\d)/.exec(t);
        if (m) { h = +m[1]; mi = +m[2]; se = +m[3]; continue; }
      }
      if (day < 0) {
        m = /^(\d{1,2})(?!\d)/.exec(t);
        if (m) { day = +m[1]; continue; }
      }
      if (mon < 0) {
        idx = MONTHS.indexOf(t.slice(0, 3).toLowerCase());
        if (idx >= 0) { mon = idx; continue; }
      }
      if (year < 0) {
        m = /^(\d{2,4})(?!\d)/.exec(t);
        if (m) { year = +m[1]; continue; }
      }
    }
    if (h < 0 || day < 0 || mon < 0 || year < 0) return null;
    /* Two-digit years split at 70, so 99 is 1999 and 24 is 2024. Cookies
       written this way are still in the wild; the rule is in the RFC. */
    if (year >= 70 && year <= 99) year += 1900;
    else if (year >= 0 && year <= 69) year += 2000;
    if (day < 1 || day > 31) return null;
    if (year < 1601) return null;
    if (h > 23 || mi > 59 || se > 59) return null;
    /* Step 6 of the same section: if no such date exists, fail. Date.UTC does
       not fail, it rolls over — Expires="Sat, 31 Feb 2027" came back here as
       3 March and was reported as a cookie with six months to live. A browser
       cannot parse that date at all, drops the attribute and stores a SESSION
       cookie, so the two answers are not close: persistent versus gone when
       the window closes. Read the parts back and check they survived. */
    var ms = Date.UTC(year, mon, day, h, mi, se);
    var back = new Date(ms);
    if (back.getUTCFullYear() !== year || back.getUTCMonth() !== mon ||
        back.getUTCDate() !== day) return null;
    return ms;
  }

  /* --- parsing the header ------------------------------------------------ */

  var SEPARATORS = '()<>@,;:\\"/[]?={} \t';

  /* One entry per distinct character, not per occurrence — the same rule
     badValueChars already followed. A name of eight spaces reported "space,
     space, space, space, space, space, and 1 more", which says nothing six
     times and then counts. */
  function badNameChars(name) {
    var bad = [], i, ch, code;
    for (i = 0; i < name.length; i++) {
      ch = name.charAt(i);
      code = name.charCodeAt(i);
      if ((code < 0x20 || code === 0x7f || SEPARATORS.indexOf(ch) >= 0) &&
          bad.indexOf(ch) < 0) bad.push(ch);
    }
    return bad;
  }

  /* cookie-octet: %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E. That excludes
     space, comma, semicolon, backslash, double quote and every control
     character. Browsers are more forgiving than the grammar in practice, but
     proxies, WAFs and server libraries are not uniformly forgiving, so it is
     worth knowing when a value has left the paved road. */
  function badValueChars(value) {
    var bad = [], i, code, ch, ok;
    for (i = 0; i < value.length; i++) {
      code = value.charCodeAt(i);
      ch = value.charAt(i);
      ok = code === 0x21 || (code >= 0x23 && code <= 0x2b) ||
           (code >= 0x2d && code <= 0x3a) || (code >= 0x3c && code <= 0x5b) ||
           (code >= 0x5d && code <= 0x7e);
      if (!ok && bad.indexOf(ch) < 0) bad.push(ch);
    }
    return bad;
  }

  function describeChar(ch) {
    var code = ch.charCodeAt(0);
    if (ch === ' ') return 'space';
    if (ch === '\t') return 'tab';
    if (ch === ',') return 'comma';
    if (ch === ';') return 'semicolon';
    if (ch === '"') return 'double quote';
    if (ch === '\\') return 'backslash';
    if (code < 0x20 || code === 0x7f) {
      return 'control character U+' +
             code.toString(16).toUpperCase().padStart(4, '0');
    }
    if (code > 0x7e) {
      return '"' + ch + '" U+' +
             code.toString(16).toUpperCase().padStart(4, '0');
    }
    return '"' + ch + '"';
  }

  /* A value written in a non-Latin script produces one entry per character,
     and the full list ran off the right of the pane for a single Devanagari
     word. Six is enough to see what kind of character is involved. */
  function describeChars(list) {
    var shown = list.slice(0, 6).map(describeChar).join(', ');
    return list.length > 6 ? shown + ', and ' + (list.length - 6) + ' more' : shown;
  }

  function parseSetCookie(line) {
    var c = {
      raw: line, header: line, name: '', value: '', hasPair: true,
      quoted: false, inner: '', attrs: [], seen: Object.create(null),
      unknown: [], dupes: []
    };
    var text = line;
    var m = /^\s*set-cookie2?\s*:\s*/i.exec(text);
    if (m) text = text.slice(m[0].length);
    c.header = text;

    /* The name/value pair is everything up to the first semicolon, and the
       RFC gets there before it has any opinion about quotes. A value written
       as "a;b" therefore becomes the value "a and the rest is read as a
       broken attribute. Browsers do exactly this, so this does too. */
    var semi = text.indexOf(';');
    var pair = semi < 0 ? text : text.slice(0, semi);
    var rest = semi < 0 ? '' : text.slice(semi + 1);

    /* No '=' at all is the one place the two specifications give different
       answers. RFC 6265 says ignore the header. RFC 6265bis says the name is
       empty and the whole string is the VALUE, which is what the browsers do
       and is why a nameless cookie exists at all. Filling it in the browser's
       way and keeping hasPair to record which case this was lets the output
       say both things instead of picking the comfortable one. */
    var eq = pair.indexOf('=');
    if (eq < 0) {
      c.hasPair = false;
      c.value = trim(pair);
    } else {
      c.name = trim(pair.slice(0, eq));
      c.value = trim(pair.slice(eq + 1));
    }
    if (c.value.length >= 2 && c.value.charAt(0) === '"' &&
        c.value.charAt(c.value.length - 1) === '"') {
      c.quoted = true;
      c.inner = c.value.slice(1, c.value.length - 1);
    }

    rest.split(';').forEach(function (chunk) {
      if (!trim(chunk)) return;          // a trailing or doubled semicolon
      var at = chunk.indexOf('=');
      var an = at < 0 ? trim(chunk) : trim(chunk.slice(0, at));
      var av = at < 0 ? '' : trim(chunk.slice(at + 1));
      var rec = { name: an, value: av, key: an.toLowerCase(), hasValue: at >= 0 };
      if (has(KNOWN, rec.key)) {
        if (has(c.seen, rec.key)) c.dupes.push(rec);
      } else {
        c.unknown.push(rec);
      }
      c.attrs.push(rec);
      /* Last one wins. RFC 6265 section 5.3 walks the attribute list in order
         and each one overwrites the previous of the same name.

         The table this writes into is Object.create(null) rather than {} for
         one specific reason: on an ordinary object, seen["__proto__"] = rec
         does not create a property at all — it runs the inherited setter and
         changes the object's prototype. A cookie carrying a "; __proto__=x"
         attribute therefore reshaped the record it was being stored in. With
         no prototype there is no setter, and the name is treated as the
         ordinary text it is. */
      c.seen[rec.key] = rec;
    });
    return c;
  }

  function attr(c, key) { return has(c.seen, key) ? c.seen[key] : null; }
  function flag(c, key) { return has(c.seen, key); }

  /* Secure, HttpOnly and Partitioned are presence-only. The parsing algorithm
     never reads their value, so "Secure=false" sets Secure, and so does
     "HttpOnly=0". Worth printing, because a templating language that stamps
     out HttpOnly={{flag}} produces a cookie that is HttpOnly no matter what
     the flag says, and the author has no way to tell from the header. */
  function noteFlagValue(c, key) {
    var a = attr(c, key);
    if (!a || !a.hasValue) return;
    out.warn('  "' + a.name + '=' + clip(a.value, 30) + '" — the value is ignored.');
    out.dim('  This is a presence-only attribute. Writing =false does not turn it');
    out.dim('  off; the only way to not have it is to not write it.');
  }

  /* --- the origin the response came from, if the visitor typed one -------- */

  function parseOrigin(text) {
    var t = trim(text);
    if (!t) return null;
    var o = { scheme: '', schemeGiven: false, host: '', path: '/', trustworthy: false };
    var m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t);
    if (m) { o.scheme = m[1].toLowerCase(); o.schemeGiven = true; t = t.slice(m[0].length); }
    var slash = t.indexOf('/');
    var host = slash < 0 ? t : t.slice(0, slash);
    o.path = slash < 0 ? '/' : t.slice(slash);
    var q = o.path.indexOf('?');
    if (q >= 0) o.path = o.path.slice(0, q);
    var hash = o.path.indexOf('#');
    if (hash >= 0) o.path = o.path.slice(0, hash);
    host = host.replace(/^[^@]*@/, '').replace(/:\d+$/, '');
    o.host = host.toLowerCase();
    if (!o.host) return null;
    /* localhost is a trustworthy origin over plain http, which is why Secure
       cookies work on a dev machine and then fail the moment the same code
       meets a real hostname over http. */
    o.trustworthy = o.scheme === 'https' || o.scheme === 'wss' ||
                    o.host === 'localhost' || /\.localhost$/.test(o.host) ||
                    o.host === '127.0.0.1' || o.host === '[::1]';
    return o;
  }

  /* RFC 6265 section 5.1.4. Worth computing because "no Path attribute" does
     not mean "/" — it means the directory of the request URI, which is a much
     narrower cookie than most people expect to have created. */
  function defaultPath(p) {
    if (!p || p.charAt(0) !== '/') return '/';
    var i = p.lastIndexOf('/');
    if (i <= 0) return '/';
    return p.slice(0, i);
  }

  /* Only a shape test, and only used to stop the tool talking about subdomains
     of something that cannot have any. A hostname made entirely of digits and
     dots is an address for cookie purposes even when it is not a valid one. */
  function looksLikeIp(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.charAt(0) === '[';
  }

  function domainMatches(host, domain) {
    if (host === domain) return true;
    return host.length > domain.length &&
           host.slice(host.length - domain.length) === domain &&
           host.charAt(host.length - domain.length - 1) === '.';
  }

  /* The real check is the Public Suffix List: roughly ten thousand entries
     that change every week, which is a bigger download than this whole page.
     This is the subset that actually turns up in a paste. Anything not listed
     is simply not flagged — a miss here is silence, never a false alarm. */
  var PUBLIC_SUFFIX = ['com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'io',
    'co', 'me', 'uk', 'in', 'de', 'fr', 'jp', 'us', 'ca', 'au', 'app', 'dev',
    'xyz', 'info', 'biz', 'eu', 'ru', 'cn', 'br', 'za', 'nl', 'it', 'es',
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.in', 'org.in', 'net.in',
    'com.au', 'co.jp', 'com.br', 'co.za', 'com.sg', 'com.mx',
    'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app',
    'netlify.app', 'herokuapp.com', 'azurewebsites.net', 'web.app',
    'blogspot.com', 'wordpress.com', 'duckdns.org', 'dpdns.org'];

  /* --- verdict bookkeeping ------------------------------------------------ */

  function newVerdict() {
    return { score: 100, cuts: [], passes: [], fatal: [] };
  }

  function cut(v, points, label, why) {
    v.score -= points;
    v.cuts.push({ points: points, label: label, why: why || [] });
  }

  function pass(v, label) { v.passes.push(label); }

  function kill(v, label, why) { v.fatal.push({ label: label, why: why || [] }); }

  /* --- rendering one cookie ---------------------------------------------- */

  function renderCookie(c, origin, index, total) {
    var v = newVerdict();

    /* Read once, up front, because the verdict at the bottom needs the same
       answers as the sections above it and there is no reason for the two to
       be able to disagree. */
    var lower = c.name.toLowerCase();
    var secure = flag(c, 'secure');
    var httpOnly = flag(c, 'httponly');
    var partitioned = flag(c, 'partitioned');
    var domainAttr = attr(c, 'domain');
    /* The effective domain, computed once. A Domain attribute whose value is
       empty (or a bare ".") is not a domain, and the three places that cared
       each used to decide for themselves: "Domain=" was reported as ignored in
       one paragraph, scored as if it had widened the cookie to every subdomain
       in the next, and used to declare a __Host- cookie rejected in a third.
       One answer, computed here, and everything below reads it. */
    var domainValue = domainAttr
      ? trim(domainAttr.value).toLowerCase().replace(/^\./, '') : '';
    var domainSet = !!domainValue;
    var pathAttr = attr(c, 'path');
    var pathValue = pathAttr && pathAttr.value.charAt(0) === '/' ? pathAttr.value : null;
    var ss = attr(c, 'samesite');
    var ssValue = ss ? ss.value.toLowerCase() : '';
    var ssKnown = ssValue === 'strict' || ssValue === 'lax' || ssValue === 'none';
    var isHost = lower.indexOf('__host-') === 0;
    var isSecurePrefix = !isHost && lower.indexOf('__secure-') === 0;
    var shape = {
      secure: secure, httpOnly: httpOnly, partitioned: partitioned,
      domainSet: domainSet, pathValue: pathValue, ss: ss,
      ssValue: ssValue, ssKnown: ssKnown
    };

    out.heading('Cookie ' + index + ' of ' + total);
    out.line(clip(c.header, MAX_ECHO));
    out.line('');

    /* ---- name and value ---- */
    out.heading('Name and value');
    if (!c.name && !c.value) {
      out.err('There is neither a name nor a value here.');
      out.err('Both readings of the specification throw this header away: there is');
      out.err('nothing to store, so nothing is stored and nothing is reported.');
      kill(v, 'no name and no value, so the header is ignored entirely');
      renderVerdict(v, c, shape);
      return v;
    }
    if (!c.name) {
      if (!c.hasPair) out.err('There is no "=" before the first semicolon.');
      else out.err('The name is empty — the pair begins with "=".');
      out.dim('The specifications disagree about this one, so what happens depends on');
      out.dim('what is reading it. RFC 6265, from 2011, says to ignore the header');
      out.dim('entirely. RFC 6265bis, the revision written to describe what browsers');
      out.dim('actually do, says the name is empty and the rest is the VALUE, and');
      out.dim('stores a NAMELESS cookie. Under that reading the next request carries');
      out.dim('it with no name and no "=" in front of it:');
      out.dim('  Cookie: ' + clip(c.value, 60));
      out.dim('Two readings, two outcomes, neither of them the one you meant. It is');
      out.dim('also a present for anyone attacking the cookie parser at the other end,');
      out.dim('which now has to decide what a value with no name belongs to. This page');
      out.dim('makes no requests, so it cannot try it in the browser in front of you.');
      cut(v, 30, 'no cookie name',
          ['Give it a name and an "=". A cookie whose storage depends on which',
           'specification the client followed is not a cookie you can reason about,',
           'and the attributes below only matter under one of the two readings.']);
    }
    out.row('name', c.name || '(empty)');
    out.row('value', c.value === '' ? '(empty)' : clip(c.value, 120));
    var nameBytes = utf8Len(c.name);
    var valueBytes = utf8Len(c.value);
    /* Name and value only, with no '=' between them, because that is the sum
       the 4096-byte check below compares against and the one Chrome measures.
       Counting the '=' here made the printed number one larger than the number
       being tested, so a cookie reported as "4097 bytes" sat quietly under the
       ceiling and got the mild warning instead of the error. */
    out.row('name + value', (nameBytes + valueBytes) + ' bytes as UTF-8');

    if (c.value === '') {
      out.dim('An empty value is legal and common: it is how a cookie is used as a');
      out.dim('present-or-absent flag, and how frameworks blank one before expiring it.');
    }
    if (c.quoted) {
      out.warn('The value is wrapped in double quotes.');
      out.dim('The grammar allows that form, but the parsing algorithm does not strip');
      out.dim('them: a browser stores the quotes as part of the value and sends them');
      out.dim('back. Server libraries vary — many strip them, which is exactly how a');
      out.dim('value ends up compared against itself and losing.');
      out.row('stored as', clip(c.value, 90));
      out.row('inside the quotes', clip(c.inner, 90));
    } else if (c.value.charAt(0) === '"') {
      out.err('The value opens with a double quote and never closes it.');
      out.dim('That is what a semicolon inside a quoted value does. The parsing');
      out.dim('algorithm cuts at the first semicolon before it has any opinion about');
      out.dim('quotes, so the value ends there and everything after it is being read');
      out.dim('as attributes. Browsers do exactly this — the quotes buy nothing.');
      out.dim('Percent-encode or base64 a value that has to contain a semicolon.');
      cut(v, 10, 'value cut short at a semicolon in the quotes',
          ['What the browser stores is ' + clip(c.value, 40) + ', not what was',
           'written. The remainder became attributes, listed below.']);
    }

    var badName = badNameChars(c.name);
    if (badName.length) {
      out.warn('The name contains characters a token may not contain: ' +
               describeChars(badName));
      cut(v, 4, 'characters the grammar does not allow in a name',
          ['Browsers differ on what they do with these. Some accept, some drop the',
           'cookie. Nothing warns you either way.']);
    }
    var badValue = badValueChars(c.quoted ? c.inner : c.value);
    if (badValue.length) {
      out.warn('The value contains characters outside cookie-octet: ' +
               describeChars(badValue));
      out.dim('Most browsers take them anyway. Proxies, WAFs and server libraries are');
      out.dim('less consistent, and a comma in particular is where header-splitting');
      out.dim('code goes wrong. Percent-encode or base64 the value if you can.');
      cut(v, 4, 'value uses characters outside the RFC 6265 set',
          ['Handling is inconsistent once the cookie leaves the browser.']);
    }

    /* Chrome refuses a cookie whose name and value together exceed 4096
       bytes, and the RFC asks user agents to support at least that much per
       cookie. Other browsers land near the same number by different routes,
       so the ceiling is real but the exact behaviour at the ceiling is not
       uniform. */
    if (nameBytes + valueBytes > 4096) {
      out.err('name + value is over 4096 bytes.');
      kill(v, 'over the 4096-byte per-cookie limit',
           ['Chrome rejects the cookie outright at this size. Other browsers cap or',
            'truncate at a similar number by their own route. Either way what comes',
            'back is not what was sent.']);
    } else if (nameBytes + valueBytes > 3000) {
      cut(v, 5, 'name + value is close to the 4096-byte ceiling',
          ['Every request to a matching path carries this. It is also one middleware',
           'header-size limit away from a 431 that nobody can reproduce.']);
    }

    /* ---- prefixes: the rule almost nobody knows ---- */
    if (isHost || isSecurePrefix) {
      out.line('');
      out.heading(isHost ? 'The __Host- prefix' : 'The __Secure- prefix');
      out.dim('The prefix is not decoration and it is not a naming convention. The');
      out.dim('browser reads it and enforces it. A cookie that carries the prefix and');
      out.dim('breaks the rule is REJECTED — not stored with weaker settings, not');
      out.dim('logged, not downgraded. Dropped. The match on the prefix itself is');
      out.dim('case-insensitive.');
      out.line('');
      if (isHost) {
        out.row('needs Secure', secure ? 'yes — present' : 'yes — MISSING',
                secure ? 't-ok' : 't-err');
        out.row('needs Path=/', pathValue === '/' ? 'yes — present'
                              : 'yes — ' + (pathAttr ? 'Path is "' + pathAttr.value + '"'
                                                     : 'no Path attribute'),
                pathValue === '/' ? 't-ok' : 't-err');
        out.row('needs NO Domain', domainSet
                ? 'yes — Domain=' + clip(domainAttr.value, 60) + ' is present'
                : (domainAttr ? 'the Domain value is empty, which is undefined'
                              : 'yes — absent, correct'),
                domainSet ? 't-err' : (domainAttr ? 't-warn' : 't-ok'));
        if (!secure) kill(v, '__Host- without Secure', ['The browser rejects the cookie.']);
        if (pathValue !== '/') {
          kill(v, '__Host- without Path=/', ['The browser rejects the cookie.']);
        }
        if (domainSet) {
          kill(v, '__Host- with a Domain attribute',
               ['The point of __Host- is that the cookie cannot be widened to',
                'subdomains. A Domain attribute contradicts it, so the browser',
                'rejects the cookie rather than picking a winner.']);
        } else if (domainAttr) {
          /* Not a rejection, because an empty Domain value is not a domain: the
             specification calls the empty case undefined and then says the
             attribute SHOULD be ignored, which leaves the cookie host-only and
             the prefix satisfied. Calling it rejected was this tool
             contradicting its own next paragraph. Calling it fine would be
             promising something no specification promises. */
          cut(v, 10, '__Host- carrying an empty Domain attribute',
              ['An empty Domain value is undefined behaviour: a client that ignores',
               'the attribute stores the cookie, and one that keeps it rejects the',
               'cookie for breaking the prefix rule. Delete the attribute rather',
               'than emitting it empty.']);
        }
        if (secure && pathValue === '/' && !domainAttr) {
          pass(v, '__Host- satisfied, so no subdomain can overwrite this cookie');
        }
      } else {
        out.row('needs Secure', secure ? 'yes — present' : 'yes — MISSING',
                secure ? 't-ok' : 't-err');
        if (!secure) {
          kill(v, '__Secure- without the Secure attribute',
               ['The browser rejects the cookie. This is the failure that looks like',
                'a broken login and produces no error message anywhere.']);
        } else {
          pass(v, '__Secure- prefix satisfied');
        }
      }
      if (origin && origin.schemeGiven && !origin.trustworthy) {
        out.err('Set from ' + origin.scheme + '://' + origin.host +
                ', which is not a trustworthy origin.');
        kill(v, 'a prefixed cookie set from a non-secure origin',
             ['Both prefixes require the response to come from a secure origin.',
              'http://localhost counts as secure; http://anything-else does not.']);
      }
    } else if (lower.indexOf('__') === 0) {
      out.warn('The name starts with "__" but is not __Host- or __Secure-.');
      out.dim('No browser gives it any special treatment. Only those two prefixes');
      out.dim('exist, and a near miss such as "_Host-" or "__host_" buys nothing.');
    }

    /* ---- attributes ---- */
    out.line('');
    out.heading('Attributes, in plain language');
    var explained = 0;

    if (secure) {
      explained++;
      out.row('Secure', 'present', 't-ok');
      out.dim('  Sent only over https. It also stops a plain-http response from');
      out.dim('  overwriting this cookie, which is the half people forget: without');
      out.dim('  Secure, anyone on the network path can not only read the cookie but');
      out.dim('  set one, and a session you were handed is a session someone chose.');
      noteFlagValue(c, 'secure');
      pass(v, 'Secure is set');
    } else {
      out.row('Secure', 'absent', 't-err');
      cut(v, 25, 'no Secure attribute',
          ['The cookie goes out in cleartext on any http request to a matching host,',
           'including one the visitor never intended — an image, a typo, a captive',
           'portal. And an active attacker can overwrite it over http even when the',
           'real site is https-only.']);
    }

    if (httpOnly) {
      explained++;
      out.row('HttpOnly', 'present', 't-ok');
      out.dim('  document.cookie cannot see it, so injected script cannot read the');
      out.dim('  value out and post it somewhere. Worth being precise: XSS can still');
      out.dim('  USE the cookie by making requests from the page it already owns.');
      out.dim('  HttpOnly stops the theft of the value, not the abuse of the session.');
      noteFlagValue(c, 'httponly');
      pass(v, 'HttpOnly is set');
    } else {
      out.row('HttpOnly', 'absent', 't-err');
      cut(v, 20, 'no HttpOnly attribute',
          ['Any script on any matching page reads this with document.cookie. One',
           'XSS anywhere on the site — an ad frame, a stale dependency, a review',
           'field — and the value has been posted somewhere you do not control.',
           'If this is a session cookie, script has no business reading it at all.']);
    }

    if (ss && ssKnown) {
      explained++;
      out.row('SameSite', ss.value);
      if (ssValue === 'strict') {
        out.dim('  Never attached to a request that started on another site — not even');
        out.dim('  a plain link. Follow a link from an email into a Strict-protected');
        out.dim('  app and you arrive logged out, which is why few teams use it for');
        out.dim('  the main session cookie and many use it for a second one.');
        pass(v, 'SameSite=Strict: no cross-site request carries this cookie');
      } else if (ssValue === 'lax') {
        out.dim('  Attached to top-level GET navigation only: a link, a redirect, a');
        out.dim('  typed URL. NOT attached to a cross-site POST, iframe, image, fetch');
        out.dim('  or XHR. That removes most of CSRF and, importantly, not all of it.');
        pass(v, 'SameSite=Lax is stated rather than left to the browser default');
      } else {
        out.dim('  Attached to every cross-site request, of any kind. This is the');
        out.dim('  setting that makes a third-party cookie work at all, and it is');
        out.dim('  also the delivery mechanism CSRF depends on, handed back on');
        out.dim('  purpose.');
        if (!secure) {
          out.err('  SameSite=None without Secure. The cookie is REJECTED.');
          kill(v, 'SameSite=None without Secure',
               ['This pairing has been required for years. The browser drops the',
                'cookie entirely rather than falling back to Lax.']);
        } else {
          cut(v, 12, 'SameSite=None',
              ['Deliberate cross-site delivery. Justified for a genuine third-party',
               'integration, and a liability on anything else. Safari has blocked',
               'these by default for years and Firefox partitions them; treat a',
               'cookie that depends on this as one that will stop arriving.']);
        }
      }
    } else if (ss) {
      out.row('SameSite', (ss.hasValue ? ss.value : '(written with no value)') +
              ' — not a recognised value', 't-warn');
      out.dim('  Only Strict, Lax and None exist. An unrecognised value is not an');
      out.dim('  error: the attribute is discarded and the cookie falls back to');
      out.dim('  whatever the browser default is, which is the next entry.');
      cut(v, 12, 'SameSite value the browser cannot understand',
          ['It behaves as if you had not written the attribute at all.']);
    } else {
      out.row('SameSite', 'absent', 't-warn');
      out.dim('  Chromium treats a cookie with no SameSite as Lax. This is the honest');
      out.dim('  version: that default is a browser decision, not a property of the');
      out.dim('  cookie. Firefox has trialled the same default without applying it to');
      out.dim('  everyone, and older browsers still send the cookie on every');
      out.dim('  cross-site request. Chromium also shipped a carve-out where a cookie');
      out.dim('  younger than two minutes was still sent on a top-level cross-site');
      out.dim('  POST, so SSO flows kept working. It was published as temporary. This');
      out.dim('  page makes no requests, so it cannot tell you whether the browser in');
      out.dim('  front of you still has it — assume it might.');
      cut(v, 15, 'no SameSite attribute',
          ['You are relying on a default that differs by browser and by version.',
           'Writing SameSite=Lax explicitly costs nothing and removes the question.']);
    }

    if (partitioned) {
      explained++;
      out.row('Partitioned', 'present' + (secure ? '' : ' — but Secure is missing'),
              secure ? 't-ok' : 't-err');
      out.dim('  CHIPS: cookies having independent partitioned state. The cookie is');
      out.dim('  stored in a jar keyed by the TOP-LEVEL site as well as by its own');
      out.dim('  host. The same widget embedded on shop.example and on news.example');
      out.dim('  gets two separate cookies with the same name and no way to see');
      out.dim('  across. That is the point, and it is also the cost: a widget that');
      out.dim('  relied on one shared cookie to recognise a visitor everywhere');
      out.dim('  cannot do that any more. Per-embedding state survives. Cross-site');
      out.dim('  identity does not.');
      noteFlagValue(c, 'partitioned');
      if (!secure) {
        out.err('  Partitioned requires Secure.');
        kill(v, 'Partitioned without Secure',
             ['Chrome requires Secure here. Whether the result is a rejected cookie',
              'or a cookie stored unpartitioned depends on the browser and the',
              'version — and both outcomes are wrong. Either the cookie is gone, or',
              'it is in the shared jar you were trying to leave.']);
      } else {
        pass(v, 'Partitioned with Secure: scoped per top-level site');
      }
    }

    if (domainAttr && !domainSet) {
      explained++;
      out.row('Domain', (trim(domainAttr.value) || '(empty)') +
              ' — no domain to set', 't-warn');
      out.dim('  There is no domain here: the value is empty, or is a bare dot, which');
      out.dim('  strips to empty. The specification calls that case undefined and then');
      out.dim('  says the attribute SHOULD be ignored, which leaves the cookie');
      out.dim('  host-only — narrower than intended rather than wider, so it fails in');
      out.dim('  the safe direction. Undefined is still undefined though: this is what');
      out.dim('  a template renders when the domain variable is unset, and nothing');
      out.dim('  tells anyone it happened. Emit no attribute instead of an empty one.');
      /* Not charged twice. When the name carries the __Host- prefix the section
         above has already taken 10 for exactly this attribute, with a more
         specific reason than this one. */
      if (!isHost) {
        cut(v, 3, 'a Domain attribute with an empty value',
            ['Ignored by browsers, and undefined by the specification, so the scope',
             'of the cookie depends on the client rather than on the header.']);
      }
    } else if (domainAttr) {
      explained++;
      out.row('Domain', clip(domainAttr.value, 80) +
              (trim(domainAttr.value).charAt(0) === '.' ? '  — leading dot stripped' : ''));
      if (trim(domainAttr.value).charAt(0) === '.') {
        out.dim('  The leading dot has meant nothing since RFC 6265 in 2011. In the old');
        out.dim('  Netscape rules it was the difference between the domain itself and');
        out.dim('  its subdomains; now the parser strips it and both forms behave the');
        out.dim('  same. Code that still writes it is not wrong, only out of date.');
      }
      /* An IP address has no subdomains, so none of the widening language below
         is true of one — and 127.0.0.1 is precisely where people develop, so
         this is not an exotic paste. The tool used to offer "subdomains of
         127.0.0.1 now receive it", which is not a thing. */
      if (looksLikeIp(domainValue)) {
        out.dim('  The value is an IP address, and an address has no subdomains, so');
        out.dim('  this attribute cannot widen anything. It either names the exact host');
        out.dim('  the response came from — in which case the cookie ends up host-only');
        out.dim('  anyway — or it does not, and the cookie is rejected for not matching.');
        out.dim('  Either way it is doing nothing for you. Leave it out.');
      } else {
        out.dim('  A Domain attribute only ever WIDENS. It sends the cookie to the named');
        out.dim('  host and to every subdomain beneath it, now and forever. There is no');
        out.dim('  way to narrow with Domain; the narrow cookie is the one with no');
        out.dim('  Domain attribute at all, which matches that exact host and nothing');
        out.dim('  else.');
      }
      if (PUBLIC_SUFFIX.indexOf(domainValue) >= 0) {
        out.err('  "' + domainValue + '" is a public suffix. No one can set a cookie on it.');
        kill(v, 'Domain is a public suffix',
             ['A cookie scoped to a registry name would be readable by every site',
              'under it, so browsers refuse. The cookie is rejected.']);
      }
      if (!looksLikeIp(domainValue)) {
        cut(v, 8, 'Domain attribute present at all',
            ['Every subdomain of ' + domainValue + ' receives this cookie.',
             'Drop the attribute unless a second hostname genuinely needs it.']);
      }
    } else {
      out.row('Domain', 'absent — host-only', 't-ok');
      out.dim('  The narrowest scope there is: this exact host, no subdomains.');
      pass(v, 'no Domain attribute, so the cookie is host-only');
    }

    if (pathAttr) {
      explained++;
      out.row('Path', pathAttr.value + (pathValue ? '' : ' — ignored, it must start with /'));
      out.dim('  A prefix match on the URL path. Worth saying out loud: Path is not a');
      out.dim('  security boundary. Same-origin script at /a can read and set cookies');
      out.dim('  for /b, because the same-origin policy does not partition by path.');
      out.dim('  Path reduces how often the cookie is sent. It protects nothing.');
    } else {
      var dp = origin ? defaultPath(origin.path) : null;
      out.row('Path', 'absent' + (dp ? ' — default-path is "' + dp + '"' : ''));
      out.dim('  With no Path attribute the cookie does not get "/". It gets the');
      out.dim('  DIRECTORY of the request URI. A response from /account/settings');
      out.dim('  yields a cookie scoped to /account, which then does not arrive at');
      out.dim('  /billing and produces a bug that looks like random session loss.');
      if (!origin) {
        out.dim('  Type the response URL in the field above and this is computed for you.');
      }
    }

    var priority = attr(c, 'priority');
    if (priority) {
      explained++;
      out.row('Priority', priority.value);
      out.dim('  Chromium only, from a draft that never became a standard. It orders');
      out.dim('  eviction when the cookie jar for a domain is full: Low goes first.');
      out.dim('  Firefox and Safari ignore it. It is not a security control and it');
      out.dim('  changes nothing about who can read the cookie.');
    }

    if (c.dupes.length) {
      out.line('');
      c.dupes.forEach(function (d) {
        out.warn('Duplicate attribute: ' + d.name + ' appears more than once.');
      });
      out.dim('The last occurrence wins — the parser walks the list in order and each');
      out.dim('one overwrites the previous. Two Path attributes is not an error, it is');
      out.dim('a silent choice you did not make.');
      cut(v, 3, 'repeated attribute, and the last one wins');
    }

    if (c.unknown.length) {
      out.line('');
      c.unknown.forEach(function (u) {
        out.warn('Unknown attribute: ' + clip(u.name, 40) +
                 (u.hasValue ? '=' + clip(u.value, 40) : ''));
      });
      out.dim('Browsers ignore attributes they do not recognise, in complete silence.');
      out.dim('That is why a typo is so expensive here: "HttpsOnly" is not HttpOnly,');
      out.dim('"SameSite = Lax" with spaces around the equals is fine, but "Same-Site"');
      out.dim('is not, and in every case you get a working cookie with a missing');
      out.dim('protection and nothing in any log.');
      cut(v, Math.min(9, 3 * c.unknown.length),
          'unrecognised attribute: ' +
          c.unknown.map(function (u) { return u.name; }).join(', '),
          ['If one of these was meant to be a real attribute, that protection is',
           'simply not there.']);
    }

    if (!explained) {
      out.dim('No attributes at all. That is a host-only session cookie, sent over');
      out.dim('http and https alike, readable by script.');
    }

    /* ---- lifetime ---- */
    out.line('');
    out.heading('How long it lives');
    var now = Date.now();
    var maxAge = attr(c, 'max-age');
    var expires = attr(c, 'expires');
    var maxAgeSeconds = null, maxAgeValid = false;
    if (maxAge) {
      /* The RFC is strict here: an optional '-' then digits, nothing else. A
         value such as "3600s" or "1 hour" is not a small number, it is an
         ignored attribute, and the cookie becomes a session cookie without
         saying so. */
      if (/^-?\d+$/.test(maxAge.value)) {
        maxAgeSeconds = parseInt(maxAge.value, 10);
        maxAgeValid = true;
      }
    }
    var expiresMs = expires ? parseCookieDate(expires.value) : null;

    if (maxAge) {
      out.row('Max-Age', maxAge.value + (maxAgeValid ? ' seconds'
              : ' — not a plain integer, so the attribute is ignored'),
              maxAgeValid ? null : 't-warn');
    }
    if (expires) {
      out.row('Expires', expires.value + (expiresMs === null
              ? ' — this reader could not parse that date' : ''),
              expiresMs === null ? 't-warn' : null);
      if (expiresMs !== null) out.row('parsed as', fmtUtc(expiresMs));
    }

    var lifetime = null, source = '';
    if (maxAgeValid) {
      lifetime = maxAgeSeconds;
      source = 'Max-Age';
      if (expires) {
        out.line('');
        out.warn('Both Max-Age and Expires are present. Max-Age wins.');
        out.dim('It wins regardless of which came first in the header, and regardless');
        out.dim('of which date is later. Expires is only consulted when Max-Age is');
        out.dim('absent or unparseable.');
        if (expiresMs !== null) {
          var diff = Math.round((expiresMs - now) / 1000) - maxAgeSeconds;
          if (Math.abs(diff) > 60) {
            out.dim('The two disagree by ' + humanDuration(Math.abs(diff)) +
                    '. The Expires value is dead text.');
          }
        }
      }
    } else if (expiresMs !== null) {
      lifetime = Math.round((expiresMs - now) / 1000);
      source = 'Expires';
    }

    out.line('');
    if (lifetime === null) {
      out.row('lifetime', 'session cookie');
      out.dim('No usable Max-Age and no usable Expires, so it lives until the browser');
      out.dim('session ends. Which is less reassuring than it sounds: Chrome and');
      out.dim('Firefox both restore session cookies when they reopen tabs after a');
      out.dim('crash or on "continue where you left off", so a session cookie can');
      out.dim('outlive the browser being closed by days.');
      if (!flag(c, 'httponly')) {
        out.warn('A session cookie without HttpOnly is readable by any script on the');
        out.warn('page for as long as that session lasts.');
      }
    } else if (lifetime <= 0) {
      out.row('lifetime', 'already expired', 't-warn');
      out.dim('An expiry in the past is how a cookie gets DELETED. The browser');
      out.dim('accepts the header, matches the existing cookie by name, domain and');
      out.dim('path, and removes it. If a logout is not working, the usual cause is');
      out.dim('that the deleting header domain or path does not match the one that');
      out.dim('created the cookie, so the browser deletes a different cookie, or none.');
    } else {
      out.row('lifetime', humanDuration(lifetime) + '  (from ' + source + ')');
      /* Printed from the parsed instant when there is one, rather than rebuilt
         from the rounded lifetime — the round trip through whole seconds put
         "expires at" one second before the "parsed as" line directly above it,
         two timestamps for the same moment on the same screen. */
      out.row('expires at', fmtUtc(source === 'Expires' && expiresMs !== null
              ? expiresMs : now + lifetime * 1000));
      out.dim('Measured against this machine clock, right now. A wrong clock on the');
      out.dim('visitor device changes the answer, which is one more reason Max-Age is');
      out.dim('the better attribute: it is a duration, not a date.');
      if (lifetime > CAP_DAYS * DAY) {
        out.line('');
        out.warn('That is longer than ' + CAP_DAYS + ' days. Current Chrome and Firefox');
        out.warn('clamp cookie expiry to ' + CAP_DAYS + ' days, so the real expiry is');
        out.warn(fmtUtc(now + CAP_DAYS * DAY * 1000) + ' whatever the header says.');
        cut(v, 8, 'expiry beyond the ' + CAP_DAYS + '-day ceiling',
            ['Clamped by the browser anyway, so the header is describing something',
             'that will not happen. A stolen cookie also stays valid for every one',
             'of those days unless the server can revoke it.']);
      } else if (lifetime > 90 * DAY) {
        cut(v, 5, 'a lifetime over 90 days',
            ['However long this cookie lives is how long a copy of it is useful to',
             'somebody else, unless the server keeps a revocation list.']);
      }
      if (/sess|sid|auth|token|jwt|login|remember/i.test(c.name) && lifetime > 30 * DAY) {
        cut(v, 8, 'long lived, and the name says credential',
            ['The name suggests a credential. A credential that persists for',
             humanDuration(lifetime) + ' should be revocable server-side, and a',
             'refresh pair is usually the better shape.']);
      }
    }

    /* ---- scope against the origin ---- */
    if (origin) {
      out.line('');
      out.heading('Scope, against ' + (origin.schemeGiven ? origin.scheme + '://' : '') +
                 origin.host);
      if (origin.schemeGiven && !origin.trustworthy && secure) {
        out.err('Secure set from a non-secure origin.');
        kill(v, 'Secure cookie set over ' + origin.scheme,
             ['A non-secure origin has not been allowed to set a Secure cookie for',
              'years. http://localhost is exempt, which is exactly why this passes',
              'in development and fails in staging.']);
      }
      if (domainSet) {
        var d = domainValue;
        if (!domainMatches(origin.host, d)) {
          out.err('Domain="' + d + '" does not match ' + origin.host + '.');
          kill(v, 'Domain does not domain-match the origin host',
               ['A host can set cookies for itself and for its parents, never for a',
                'name it does not sit under. The browser rejects this outright.']);
        } else if (looksLikeIp(d)) {
          out.dim('Domain names the address the response came from. An address has no');
          out.dim('subdomains, so nothing is widened and the cookie is host-only for ' +
                  d + '.');
        } else if (d !== origin.host) {
          out.err('Widened from ' + origin.host + ' up to ' + d + '.');
          out.dim('Every host under ' + d + ' now receives this cookie, not only');
          out.dim(origin.host + '. That includes the siblings you may not own or may');
          out.dim('have forgotten: an old staging box, a marketing page somebody put on');
          out.dim('a hosted platform, a customer subdomain, a CNAME pointed at a');
          out.dim('vendor. Any one of them can read this cookie, and any one of them');
          out.dim('can OVERWRITE it, because cookies do not obey the same-origin');
          out.dim('policy — they answer to the registrable domain and ignore scheme,');
          out.dim('port and host. So a compromised sibling gets the session, and can');
          out.dim('also hand the visitor a session of its own choosing.');
          cut(v, 8, 'scope widened from the host to a parent domain',
              ['Whoever controls any subdomain of ' + d + ' controls this cookie.']);
        } else {
          out.dim('Domain names the same host the response came from. It still widens:');
          out.dim('subdomains of ' + d + ' now receive it where a host-only cookie');
          out.dim('would not.');
        }
      } else if (domainAttr) {
        out.warn('The Domain attribute is empty, so there is nothing to match against ' +
                 origin.host + '.');
        out.dim('Treated as host-only here, for the reason given above.');
      } else {
        out.ok('Host-only: ' + origin.host + ' and nothing else.');
      }
      if (!pathAttr) {
        out.row('default-path', defaultPath(origin.path));
        if (defaultPath(origin.path) !== '/') {
          out.warn('Not "/" — the cookie will not be sent to paths outside ' +
                   defaultPath(origin.path) + '.');
        }
      }
    } else {
      out.line('');
      out.dim('No response URL given, so the Domain match, the default-path and the');
      out.dim('secure-origin rules could not be checked. Type one above to run them.');
    }

    renderVerdict(v, c, shape);
    return v;
  }

  /* --- the verdict, with every deduction spelled out --------------------- */

  function renderVerdict(v, c, shape) {
    out.line('');
    out.heading('Verdict');

    if (v.fatal.length) {
      out.err('REJECTED BY THE BROWSER. This cookie is not stored at all.');
      out.line('');
      v.fatal.forEach(function (f) {
        out.line('  * ' + f.label, 't-err');
        f.why.forEach(function (w) { out.line('      ' + w, 't-dim'); });
      });
      out.line('');
      out.dim('Nothing above this line matters until that is fixed. There is no');
      out.dim('console warning for most of these, no server-side signal, and the');
      out.dim('cookie simply never comes back on the next request.');
      out.line('');
    }

    if (v.passes.length) {
      out.line('What is right:', 't-dim');
      v.passes.forEach(function (p) { out.line('  + ' + p, 't-ok'); });
      out.line('');
    }

    if (v.cuts.length) {
      out.line('Deductions:', 't-dim');
      v.cuts.forEach(function (d) {
        out.row('  -' + d.points, d.label, 't-warn');
        d.why.forEach(function (w) { out.line('      ' + w, 't-dim'); });
      });
      out.line('');
    } else if (!v.fatal.length) {
      out.line('No deductions. Every check above passed.', 't-ok');
      out.line('');
    }

    var score = v.fatal.length ? 0 : Math.max(0, v.score);
    var band;
    if (v.fatal.length) band = 'rejected, so the score is moot — fix the list above first';
    else if (score >= 90) band = 'about as tight as a Set-Cookie line gets';
    else if (score >= 70) band = 'workable, with the gaps listed above';
    else if (score >= 45) band = 'weak — the deductions are the work';
    else band = 'broken in practice, whatever it does in your tests';
    out.row('score', score + ' / 100 — ' + band,
            score >= 70 ? 't-ok' : (score >= 45 ? 't-warn' : 't-err'));
    out.dim('The weights are mine, not a standard. Every one is printed above so you');
    out.dim('can disagree with it. Nothing here knows what the cookie is FOR: an');
    out.dim('analytics preference losing marks for a missing HttpOnly may be exactly');
    out.dim('right, and the tool cannot tell.');

    /* A concrete rewrite is more useful than a list of adjectives. Only
       offered when there is something to change, and only in the conservative
       shape — a cookie that genuinely needs cross-site delivery cannot use it,
       which is said out loud rather than assumed away. */
    var wantsCrossSite = shape.ssValue === 'none';
    /* Nothing is gained by printing a "hardened" line identical to the one the
       visitor already wrote. A cookie can lose marks — SameSite=None costs 12
       whatever else is right — and still be in the best shape available to it,
       and repeating it back would read as a correction that is not one. */
    var alreadyRight = !!c.name && shape.secure && shape.httpOnly &&
      shape.pathValue === '/' && !shape.domainSet && shape.ss && shape.ssKnown &&
      (!wantsCrossSite || shape.partitioned);

    /* Guarded on the name rather than on hasPair, because a nameless cookie
       reaches here now instead of aborting above, and the rewrite it produced
       was "Set-Cookie: __Host-=VALUE", which is itself a nameless cookie.
       There is nothing to rewrite until the cookie has a name. */
    if (c.name && !alreadyRight && (v.fatal.length || v.cuts.length)) {
      var name = c.name;
      var canPrefix = !wantsCrossSite && name.toLowerCase().indexOf('__') !== 0;
      out.line('');
      out.line('The conservative shape of the same cookie:', 't-dim');
      out.line('  Set-Cookie: ' + (canPrefix ? '__Host-' : '') + name + '=' +
               (c.value === '' ? '' : 'VALUE') + '; Path=/; Secure; HttpOnly; SameSite=' +
               (wantsCrossSite ? 'None; Partitioned' : 'Lax'), 't-info');
      if (canPrefix) {
        out.dim('  The __Host- prefix is not cosmetic: it makes the browser refuse the');
        out.dim('  cookie if a future change adds a Domain, drops Secure or narrows the');
        out.dim('  path. It is a rule you cannot accidentally undo. Renaming a cookie');
        out.dim('  does log everyone out once, which is a deployment problem, not a');
        out.dim('  reason not to.');
      }
      if (wantsCrossSite) {
        out.dim('  Kept as SameSite=None because the original asked for cross-site');
        out.dim('  delivery. Partitioned added, since an unpartitioned third-party');
        out.dim('  cookie is already blocked in Safari and partitioned in Firefox.');
      }
    }
  }

  /* --- the part that is not about any one cookie -------------------------- */

  function renderCsrf() {
    out.rule();
    out.heading('Why any of this touches CSRF');
    out.line('');
    out.dim('A browser attaches cookies by DESTINATION, not by who asked. A form on');
    out.dim('evil.example that posts to bank.example gets the bank cookies attached,');
    out.dim('because that is precisely what cookies were designed to do. That');
    out.dim('automatic attachment is not a step in CSRF. It is the whole of CSRF.');
    out.dim('Everything else in the attack is set dressing.');
    out.line('');
    out.dim('SameSite=Lax removes most of it. A cross-site POST, an iframe, an image');
    out.dim('tag, a fetch and an XHR all arrive without the cookie. What Lax still');
    out.dim('permits is top-level GET navigation: a link, a redirect, a window.open.');
    out.dim('So any state-changing GET is still exposed. If');
    out.dim('GET /account/delete?id=7 does something, a link on any page on the');
    out.dim('internet can still do it with the visitor session attached. That is not');
    out.dim('a SameSite failure; it is a reminder that GET was never meant to change');
    out.dim('anything.');
    out.line('');
    out.dim('SameSite is defence in depth, not a replacement for a token. Three');
    out.dim('reasons, all of which have bitten real applications:');
    out.dim('  1. It is a browser behaviour. An old browser, an unusual browser or a');
    out.dim('     non-browser client sends the cookie cross-site regardless.');
    out.dim('  2. "Site" means the registrable domain, not the origin. A page on');
    out.dim('     cdn.example.com is SAME-site with app.example.com, so a subdomain');
    out.dim('     that hosts user content can mount the attack and SameSite will not');
    out.dim('     notice.');
    out.dim('  3. Chromium shipped a temporary carve-out letting a cross-site');
    out.dim('     top-level POST through for cookies younger than two minutes, so');
    out.dim('     that SSO flows kept working. Published as temporary; this page');
    out.dim('     makes no requests and cannot tell you whether the browser you are');
    out.dim('     reading this in still has it.');
    out.line('');
    out.dim('So: SameSite=Lax on the session cookie, an anti-CSRF token or a strict');
    out.dim('Origin header check on every state-changing request, and no');
    out.dim('state-changing GETs. The cookie settings make the token harder to');
    out.dim('reach. They do not replace it.');
  }

  function renderLimits() {
    out.rule();
    out.heading('What this cannot tell you');
    out.dim('It reads the text you pasted. It makes no request, resolves no name and');
    out.dim('looks nothing up, so:');
    out.dim('  * it does not know whether your server actually sent this, or what');
    out.dim('    your framework or CDN rewrote on the way out;');
    out.dim('  * it cannot judge the VALUE. A predictable session id is the worst');
    out.dim('    thing a cookie can carry and the header never shows it;');
    out.dim('  * browser behaviour moves. Third-party cookie policy and the Lax');
    out.dim('    carve-outs have changed more than once. Where a rule is in flux,');
    out.dim('    the output says so instead of quoting a version;');
    out.dim('  * the public-suffix check uses a short built-in list, not the real');
    out.dim('    ten-thousand-entry one, so it can miss;');
    out.dim('  * the score is mine, not a standard.');
    out.dim('Nothing you paste leaves this tab. There is no server here to send it to.');
  }

  /* --- driver ------------------------------------------------------------- */

  function candidateLines(text) {
    var tagged = [], plain = [], sawRequestHeader = false;
    String(text).split(/\r\n|\r|\n/).forEach(function (raw) {
      var t = trim(raw);
      if (!t) return;
      if (/^cookie\s*:/i.test(t)) { sawRequestHeader = true; return; }
      if (/^set-cookie2?\s*:/i.test(t)) tagged.push(t);
      else plain.push(t);
    });
    return {
      lines: tagged.length ? tagged : plain,
      sawRequestHeader: sawRequestHeader,
      mixed: tagged.length > 0 && plain.length > 0
    };
  }

  function analyse() {
    out.clear();
    var text = document.getElementById('tool-text').value;
    if (text.length > MAX_CHARS) {
      out.warn('That paste is ' + text.length + ' characters. Only the first ' +
               MAX_CHARS + ' are read, so the page stays responsive — the work');
      out.warn('happens in this tab, on your processor.');
      text = text.slice(0, MAX_CHARS);
    }
    if (!trim(text)) {
      out.warn('Paste one or more Set-Cookie header lines above.');
      out.dim('The "Set-Cookie:" prefix is optional. One cookie per line.');
      return;
    }

    var origin = parseOrigin(document.getElementById('tool-origin').value);
    var found = candidateLines(text);
    if (found.sawRequestHeader) {
      out.warn('A line starting "Cookie:" was skipped. That is the REQUEST header the');
      out.warn('browser sends back, and it carries names and values only — every');
      out.warn('attribute has already been stripped by then. This tool needs the');
      out.warn('Set-Cookie header from the response.');
      out.line('');
    }
    if (found.mixed) {
      out.dim('Some lines carried a "Set-Cookie:" prefix and some did not; only the');
      out.dim('prefixed ones were read, on the assumption the rest are other headers.');
      out.line('');
    }
    if (!found.lines.length) {
      out.warn('Nothing here looks like a Set-Cookie line.');
      return;
    }

    var lines = found.lines;
    if (lines.length > MAX_COOKIES) {
      out.warn('Reading the first ' + MAX_COOKIES + ' of ' + lines.length + ' lines.');
      out.line('');
      lines = lines.slice(0, MAX_COOKIES);
    }
    if (origin) {
      out.row('response URL', (origin.schemeGiven ? origin.scheme + '://' : '') +
              origin.host + origin.path);
      if (!origin.schemeGiven) {
        out.dim('No scheme given, so the secure-origin checks were skipped. Write');
        out.dim('https:// or http:// in front of the host to include them.');
      }
      out.line('');
    }

    var rejected = 0, worst = 100;
    lines.forEach(function (line, i) {
      if (i) { out.line(''); out.rule(); }
      var v = renderCookie(parseSetCookie(line), origin, i + 1, lines.length);
      if (v.fatal.length) { rejected++; worst = 0; }
      else worst = Math.min(worst, Math.max(0, v.score));
    });

    if (lines.length > 1) {
      out.line('');
      out.rule();
      out.heading('Across all ' + lines.length + ' cookies');
      out.row('rejected outright', rejected, rejected ? 't-err' : 't-ok');
      out.row('lowest score', worst + ' / 100', worst >= 70 ? 't-ok' : 't-warn');
      out.dim('A page is only as good as its weakest cookie: the session cookie and');
      out.dim('the analytics cookie share one jar, and an attacker reads whichever');
      out.dim('one is reachable.');
    }

    out.line('');
    renderCsrf();
    out.line('');
    renderLimits();
  }

  /* analyse() is called bare from the Run button and from Ctrl+Enter, and the
     first thing it does is out.clear(). A throw halfway down would therefore
     leave a wiped pane and a silent page — the tool would look broken with no
     message to search for. A header parser is fed malformed text by
     definition, so whatever did print stays on screen and the failure is
     appended under it, which also shows how far the read got. */
  function run() {
    try {
      analyse();
    } catch (err) {
      out.rule();
      out.err('That input broke the reader partway through.');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
    }
  }

  /* The sample Expires is built from the clock rather than typed as a literal
     date, so the worked example never quietly becomes a demonstration of an
     already-expired cookie six months after it was written. */
  function sampleText() {
    var soon = imfDate(Date.now() + 45 * DAY * 1000);
    return [
      'Set-Cookie: sessionid=8f2b9c1e4a7d; Path=/; Domain=example.com; HttpsOnly; Expires=' + soon,
      'Set-Cookie: __Host-csrf=Ux9a2KpQ; Path=/; Secure; HttpOnly; SameSite=Strict',
      'Set-Cookie: __Secure-theme=dark; Path=/; HttpOnly; SameSite=Lax',
      'Set-Cookie: ads_id="a1b2,c3"; Max-Age=63072000; SameSite=None; HttpOnly; Priority=Low',
      'Set-Cookie: widget_state=; Path=/; Secure; HttpOnly; SameSite=None; Partitioned'
    ].join('\n');
  }

  LabTool.define({
    id: 'cookieinspector',
    run: run,
    onReady: function () {
      var sample = document.getElementById('tool-sample');
      var clear = document.getElementById('tool-clear');
      sample && sample.addEventListener('click', function () {
        document.getElementById('tool-text').value = sampleText();
        document.getElementById('tool-origin').value = 'https://app.example.com/account/settings';
        run();
      });
      clear && clear.addEventListener('click', function () {
        document.getElementById('tool-text').value = '';
        out.clear();
        out.dim('Cleared.');
      });
      out.dim('Paste one or more Set-Cookie lines from a response and press Inspect.');
      out.dim('Every attribute is explained, the rules that get a cookie silently');
      out.dim('rejected are checked, and the expiry arithmetic is done against this');
      out.dim('machine clock. The "Set-Cookie:" prefix is optional.');
      out.line('');
      out.dim('Nothing you paste is uploaded. There is no server here to upload to,');
      out.dim('which matters more than usual when the thing being pasted is a live');
      out.dim('session cookie from a system you are responsible for.');
    }
  });
})();

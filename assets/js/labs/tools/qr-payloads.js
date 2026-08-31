/* ==========================================================================
   qr-payloads.js — build the strings that go inside a QR code, and read them
   back out again.
   --------------------------------------------------------------------------
   /labs/qr is the general encoder and inspector: it draws the square and it
   decodes a photograph of one. This page is the half in between — the payload
   itself, the string that sits inside the modules. There is deliberately no
   second QR encoder here. The encoder in tools/qr.js lives inside its own IIFE
   and puts nothing on a global, and that file belongs to that lab, so the
   honest arrangement is that this page produces the exact string and hands it
   to /labs/qr to be drawn. One encoder, checked once.

   The two things this page exists for:

   First, escaping. vCard, MECARD and the Wi-Fi string all use punctuation as
   structure — semicolon, comma, colon, backslash — and every one of them has a
   rule for what to do when that punctuation appears inside a value instead.
   Almost every online builder skips it, so a company called "Shah, Sons & Co"
   arrives on the phone as an organisation called "Shah" and a stray field
   called "Sons & Co". Everything built here is escaped, and then parsed back
   and compared field by field, so the round trip is shown rather than claimed.

   Second, UPI. A UPI QR code is a payment instruction, and there is no such
   thing as a UPI QR that pays money into your account. The parser pulls a
   pasted upi:// URI apart and says in plain words who gets paid, how much, and
   which parts of it are simply text that whoever printed the code typed in.
   What it cannot do is check any of that against reality: a VPA can only be
   verified by asking NPCI, which is a network call this page will never make,
   and the sign= parameter can only be checked against a key this page does not
   have. Both limits are printed on screen every time, not buried here.

   Where the model is simplified: the PSP handle list is short and advisory,
   the merchant category code is printed as a claim rather than looked up, and
   the timezone conversion for calendar events leans on the browser's own IANA
   database through Intl — when that database cannot answer, the tool says so
   instead of printing a confident timestamp.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ======================================================================
     PART 1 — octets
     ----------------------------------------------------------------------
     Every length rule in these formats counts octets, not characters, and
     the difference is the whole game once a name is written in Devanagari or
     a note carries an emoji. JavaScript strings are UTF-16, so a character
     can be one or two units on the way in and one to four octets on the way
     out, and folding at 75 has to respect both at once.
     ====================================================================== */

  /* How many UTF-16 units the character starting at i occupies. Two only for
     a well-formed surrogate pair; a lone high surrogate is treated as one
     unit, which is what it is. */
  function unitsAt(text, i) {
    var c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      var d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) return 2;
    }
    return 1;
  }

  function octetsAt(text, i) {
    var c = text.charCodeAt(i);
    if (c < 0x80) return 1;
    if (c < 0x800) return 2;
    if (unitsAt(text, i) === 2) return 4;
    return 3;
  }

  function utf8Array(text) {
    var bytes = [];
    var i = 0;
    while (i < text.length) {
      var cp = text.charCodeAt(i);
      if (unitsAt(text, i) === 2) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
        i += 2;
      } else {
        i += 1;
      }
      if (cp < 0x80) {
        bytes.push(cp);
      } else if (cp < 0x800) {
        bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      } else if (cp < 0x10000) {
        bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                   0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      }
    }
    return bytes;
  }

  function utf8Len(text) {
    var n = 0;
    var i = 0;
    while (i < text.length) {
      n += octetsAt(text, i);
      i += unitsAt(text, i);
    }
    return n;
  }

  /* RFC 5545 section 3.1 and RFC 6350 section 3.2 say the same thing: a
     content line SHOULD NOT exceed 75 octets excluding the line break, and a
     longer one is split by inserting a line break followed by a single space.
     That leading space is not part of the value, so a continuation line
     carries 74 octets of content, not 75.

     The part almost nothing implements is the last sentence of the rule: the
     split must not fall inside a multi-octet character. Counting characters
     instead of octets produces a file that is fine in English and corrupt in
     every other script, and the failure is silent — the receiving app shows a
     replacement glyph in the middle of a name and nobody knows why. So this
     walks character by character and never lets a character straddle the
     boundary. */
  function foldLine(text, eol) {
    var pieces = [];
    var cur = '';
    var used = 0;
    var i = 0;
    while (i < text.length) {
      var units = unitsAt(text, i);
      var oct = octetsAt(text, i);
      if (used + oct > 75) {
        pieces.push(cur);
        cur = '';
        used = 1;                    // the leading space costs one octet
      }
      cur += text.substr(i, units);
      used += oct;
      i += units;
    }
    pieces.push(cur);
    if (pieces.length === 1) return pieces[0];
    var joined = pieces[0];
    for (var p = 1; p < pieces.length; p++) joined += eol + ' ' + pieces[p];
    return joined;
  }

  /* The inverse, for the parse direction. A line whose first character is a
     space or a tab is a continuation of the one before it, and exactly one
     leading whitespace character is removed — a second space is real content,
     which is how a folded value keeps a genuine double space. */
  function unfold(text) {
    var raw = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      if (lines.length && (line.charAt(0) === ' ' || line.charAt(0) === '\t')) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
    }
    return lines;
  }

  /* ======================================================================
     PART 2 — escaping, and taking it back off
     ====================================================================== */

  /* vCard 3.0 (RFC 2426) and vCard 4.0 (RFC 6350) agree on the four
     characters that have to be escaped in a text value: backslash, comma,
     semicolon and the newline. Backslash goes first or it doubles the
     backslashes the other rules have just written. */
  function escText(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  function unescText(s) {
    var res = '';
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '\\' && i + 1 < s.length) {
        var nx = s.charAt(i + 1);
        if (nx === 'n' || nx === 'N') res += '\n';
        else res += nx;
        i += 2;
      } else {
        res += ch;
        i += 1;
      }
    }
    return res;
  }

  /* MECARD escapes with a backslash too, but its separators are different:
     semicolon between fields, colon between key and value, comma inside the
     name and address. It has no defined escape for a line break at all, so a
     newline in a note is replaced by a space and the tool says so rather than
     inventing an encoding that half the scanners would read as the letter n. */
  function escMecard(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/[\r\n]+/g, ' ')
      .replace(/([;:,])/g, '\\$1');
  }

  /* The Wi-Fi string escapes backslash, semicolon, comma, colon and the double
     quote. The quote is in that list because of the rule below. */
  function escWifi(s) {
    return String(s).replace(/([\\;,:"])/g, '\\$1');
  }

  /* A value made entirely of hex digits is ambiguous: the original ZXing
     format says a bare hex string may be taken as the raw hex form of the
     value rather than as its characters. A network genuinely called "ABCDEF"
     therefore has to be quoted to be read as six letters. Quoting is cheap and
     wrong-reading is not, so it is applied whenever the value could be read
     the other way. */
  function looksHex(s) {
    return s.length > 0 && /^[0-9a-fA-F]+$/.test(s);
  }

  function wifiValue(s) {
    if (looksHex(s)) return '"' + escWifi(s) + '"';
    return escWifi(s);
  }

  /* The password is the one field where the quoting rule above has an
     exception, and getting it backwards produces a code that simply does not
     join. A WPA passphrase is 8 to 63 characters; a raw PSK is exactly 64 hex
     digits and is not a passphrase at all. So a 64-hex-digit password cannot
     be characters-to-be-hashed, and quoting it — which the general hex rule
     does — hands the supplicant a 64-character passphrase, which is not a
     legal one. That single case goes out bare. Every other all-hex password
     stays quoted, because there the digits really are what was typed. */
  function wifiPassword(s) {
    if (s.length === 64 && looksHex(s)) return escWifi(s);
    return wifiValue(s);
  }

  /* Splitting on a separator that can itself be escaped. Doing this with
     String.split is the single most common bug in these parsers: split(';')
     on an ADR whose street contains an escaped semicolon cuts the address in
     half, and no amount of unescaping afterwards puts it back. */
  function splitUnescaped(s, sep) {
    var parts = [];
    var cur = '';
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '\\' && i + 1 < s.length) {
        cur += ch + s.charAt(i + 1);
        i += 2;
        continue;
      }
      if (ch === sep) {
        parts.push(cur);
        cur = '';
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
    }
    parts.push(cur);
    return parts;
  }

  /* Which characters a value actually needed escaping for, so the report can
     name them rather than just asserting that escaping happened.

     The set differs by format and reporting the union would be a lie in both
     directions. A colon is structure in MECARD and in the Wi-Fi string, so
     https:// has to become https\:// there — and it is ordinary content in
     vCard and iCalendar, where escaping it is wrong. An earlier version used
     one list for all four and told you a vCard URL had been escaped when
     nothing had happened to it. */
  var SEPARATORS = {
    text: [['backslash', /\\/g], ['semicolon', /;/g], ['comma', /,/g],
           ['line break', /\n/g]],
    mecard: [['backslash', /\\/g], ['semicolon', /;/g], ['comma', /,/g],
             ['colon', /:/g], ['line break', /\n/g]],
    wifi: [['backslash', /\\/g], ['semicolon', /;/g], ['comma', /,/g],
           ['colon', /:/g], ['double quote', /"/g]]
  };

  function escapeCounts(raw, which) {
    var s = String(raw);
    var names = [];
    (SEPARATORS[which] || SEPARATORS.text).forEach(function (p) {
      var m = s.match(p[1]);
      if (m) names.push(p[0] + (m.length > 1 ? ' x' + m.length : ''));
    });
    return names;
  }

  /* ======================================================================
     PART 3 — what the characters actually are
     ----------------------------------------------------------------------
     A payee name in a QR code is arbitrary text chosen by whoever printed the
     code, so it is the natural place to put a Cyrillic 'а' inside an English
     word. Nothing below is a verdict — mixed script is normal in India and a
     name in Devanagari or Gujarati is not a signal of anything. Latin mixed
     with Cyrillic or Greek is a different matter, because those two scripts
     contain letters drawn identically to Latin ones and there is no ordinary
     reason for them to share a word.
     ====================================================================== */

  var SCRIPTS = [
    ['Latin', 0x0041, 0x005a], ['Latin', 0x0061, 0x007a], ['Latin', 0x00c0, 0x024f],
    ['Greek', 0x0370, 0x03ff], ['Greek', 0x1f00, 0x1fff],
    ['Cyrillic', 0x0400, 0x052f],
    ['Armenian', 0x0530, 0x058f], ['Hebrew', 0x0590, 0x05ff],
    ['Arabic', 0x0600, 0x06ff],
    ['Devanagari', 0x0900, 0x097f], ['Bengali', 0x0980, 0x09ff],
    ['Gurmukhi', 0x0a00, 0x0a7f], ['Gujarati', 0x0a80, 0x0aff],
    ['Oriya', 0x0b00, 0x0b7f], ['Tamil', 0x0b80, 0x0bff],
    ['Telugu', 0x0c00, 0x0c7f], ['Kannada', 0x0c80, 0x0cff],
    ['Malayalam', 0x0d00, 0x0d7f], ['Thai', 0x0e00, 0x0e7f],
    ['Han', 0x4e00, 0x9fff], ['Kana', 0x3040, 0x30ff],
    ['Hangul', 0xac00, 0xd7af]
  ];

  function scriptOf(cp) {
    for (var i = 0; i < SCRIPTS.length; i++) {
      if (cp >= SCRIPTS[i][1] && cp <= SCRIPTS[i][2]) return SCRIPTS[i][0];
    }
    return null;                     // digits, spaces, punctuation, symbols
  }

  /* Held as code points rather than as literal characters on purpose: a
     confusables table written out in the source is a table nobody can proof-
     read, because by definition every entry looks like the thing beside it. */
  var CONFUSABLE = [
    [0x0430, 'a'], [0x0435, 'e'], [0x043e, 'o'], [0x0440, 'p'], [0x0441, 'c'],
    [0x0443, 'y'], [0x0445, 'x'], [0x0456, 'i'], [0x0458, 'j'], [0x0455, 's'],
    [0x04bb, 'h'], [0x0501, 'd'], [0x051b, 'q'], [0x0261, 'g'],
    [0x0410, 'A'], [0x0412, 'B'], [0x0415, 'E'], [0x041a, 'K'], [0x041c, 'M'],
    [0x041d, 'H'], [0x041e, 'O'], [0x0420, 'P'], [0x0421, 'C'], [0x0422, 'T'],
    [0x0423, 'Y'], [0x0425, 'X'], [0x0405, 'S'], [0x0406, 'I'], [0x0408, 'J'],
    [0x03b1, 'a'], [0x03bf, 'o'], [0x03c1, 'p'], [0x03bd, 'v'], [0x03c4, 't'],
    [0x0391, 'A'], [0x0392, 'B'], [0x0395, 'E'], [0x0396, 'Z'], [0x0397, 'H'],
    [0x0399, 'I'], [0x039a, 'K'], [0x039c, 'M'], [0x039d, 'N'], [0x039f, 'O'],
    [0x03a1, 'P'], [0x03a4, 'T'], [0x03a5, 'Y'], [0x03a7, 'X'], [0x03bc, 'u']
  ];

  var INVISIBLE = [
    [0x00ad, 'soft hyphen'], [0x180e, 'Mongolian vowel separator'],
    [0x200b, 'zero width space'], [0x200c, 'zero width non-joiner'],
    [0x200d, 'zero width joiner'], [0x200e, 'left-to-right mark'],
    [0x200f, 'right-to-left mark'], [0x202a, 'left-to-right embedding'],
    [0x202b, 'right-to-left embedding'], [0x202c, 'pop directional formatting'],
    [0x202d, 'left-to-right override'], [0x202e, 'right-to-left override'],
    [0x2060, 'word joiner'], [0x2066, 'left-to-right isolate'],
    [0x2067, 'right-to-left isolate'], [0x2068, 'first strong isolate'],
    [0x2069, 'pop directional isolate'], [0xfeff, 'zero width no-break space']
  ];

  function lookup(table, cp) {
    for (var i = 0; i < table.length; i++) if (table[i][0] === cp) return table[i][1];
    return null;
  }

  function hex4(cp) {
    var s = cp.toString(16).toUpperCase();
    while (s.length < 4) s = '0' + s;
    return 'U+' + s;
  }

  function textReport(label, text) {
    var scripts = [];
    var confusables = [];
    var invisibles = [];
    var i = 0;
    while (i < text.length) {
      var units = unitsAt(text, i);
      var cp = text.charCodeAt(i);
      if (units === 2) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      }
      var sc = scriptOf(cp);
      if (sc && scripts.indexOf(sc) === -1) scripts.push(sc);
      var conf = lookup(CONFUSABLE, cp);
      if (conf) confusables.push(hex4(cp) + ' at position ' + (i + 1) + ', drawn like "' + conf + '"');
      var inv = lookup(INVISIBLE, cp);
      if (inv) invisibles.push(hex4(cp) + ' at position ' + (i + 1) + ', ' + inv);
      i += units;
    }
    return {
      label: label, scripts: scripts, confusables: confusables, invisibles: invisibles,
      mixedLatin: scripts.indexOf('Latin') !== -1 &&
                  (scripts.indexOf('Cyrillic') !== -1 || scripts.indexOf('Greek') !== -1)
    };
  }

  /* ======================================================================
     PART 4 — dates, and the one thing this page cannot do alone
     ====================================================================== */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function stampUtc(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  function stampLocal(w) {
    return w.y + pad2(w.mo) + pad2(w.d) + 'T' + pad2(w.h) + pad2(w.mi) + '00';
  }

  /* datetime-local hands back "2026-09-01T09:30", sometimes with seconds. */
  function parseWall(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
    if (!m) return null;
    return {
      y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10),
      h: parseInt(m[4], 10), mi: parseInt(m[5], 10)
    };
  }

  /* The offset a zone was actually running at a given instant, read out of the
     browser's own IANA database through Intl. Format the instant in the zone,
     read the wall clock back, and the gap between that and the UTC wall clock
     is the offset. No table of offsets is kept here — a hardcoded one goes
     stale the next time a government moves a clock. */
  function zoneOffsetMinutes(date, tz) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    var map = {};
    dtf.formatToParts(date).forEach(function (p) { map[p.type] = p.value; });
    var hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;       // some engines print midnight as 24
    var asUtc = Date.UTC(parseInt(map.year, 10), parseInt(map.month, 10) - 1,
                         parseInt(map.day, 10), hour, parseInt(map.minute, 10),
                         parseInt(map.second, 10));
    return (asUtc - date.getTime()) / 60000;
  }

  /* Wall clock in a named zone back to an instant. Two passes, because the
     first guess uses the offset at the wrong moment and a zone that changed
     offset between the two needs correcting once.

     The verification pass is the point. An hour that a spring-forward skipped
     does not exist, and an hour that an autumn fall-back repeated happens
     twice, and in both cases there is no single correct answer to print. India
     has run no daylight saving since 1945 so the common case here is clean,
     but a conference call scheduled in a zone that does have it is exactly
     where a builder that guesses silently does damage.

     Finding the repeated hour took two attempts, and the first one was wrong
     in the worst way — it never fired. It asked whether the offsets from the
     two passes above disagreed, which sounds right and cannot work: on a
     fall-back the naive "treat the wall clock as UTC" probe lands on the same
     side of the change as the real answer does, so both passes return the same
     number. Swept over every quarter hour of 2026 in America/New_York and
     Europe/London it found nothing at all, while the warning underneath it
     claimed on screen to handle a case it could not see. What does work is
     asking the zone what offset it was running a day either side of the
     answer — a window that straddles any single change — and testing whether
     that other offset also lands on this wall clock. */
  function wallToInstant(w, tz) {
    var target = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, 0);
    var off1, off2;
    try {
      off1 = zoneOffsetMinutes(new Date(target), tz);
      off2 = zoneOffsetMinutes(new Date(target - off1 * 60000), tz);
    } catch (err) {
      return { error: 'zone' };
    }
    var t = target - off2 * 60000;
    var back = zoneOffsetMinutes(new Date(t), tz);
    if (back !== off2) {
      /* The answer does not read back as the wall clock that was asked for.
         Before calling that a gap, try the offset it did read back at: the
         pass above can overshoot to the far side of a change. */
      var alt = target - back * 60000;
      if (zoneOffsetMinutes(new Date(alt), tz) !== back) return { error: 'gap' };
      t = alt;
      off2 = back;
    }
    var other = null;
    var otherOffset = null;
    var day = 86400000;
    [zoneOffsetMinutes(new Date(t - day), tz),
     zoneOffsetMinutes(new Date(t + day), tz)].forEach(function (side) {
      if (other !== null || side === off2) return;
      var cand = target - side * 60000;
      if (zoneOffsetMinutes(new Date(cand), tz) === side) {
        other = cand;
        otherOffset = side;
      }
    });
    return {
      time: t, offset: off2, ambiguous: other !== null,
      otherTime: other, otherOffset: otherOffset
    };
  }

  function offsetLabel(mins) {
    var sign = mins < 0 ? '-' : '+';
    var a = Math.abs(mins);
    return 'UTC' + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  function browserZone() {
    try {
      var z = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return z || '';
    } catch (err) { return ''; }
  }

  /* FNV-1a over the event's own fields. A UID has to be stable: pressing Build
     twice on the same event should give the same string, or a poster reprinted
     with a fresh QR adds a second copy of the event to everyone's calendar
     instead of updating the one they already have. The cost of that choice is
     the opposite failure — two genuinely different events that happen to carry
     identical text and times collide — so the tool says which way it went. */
  function fnv1a(text) {
    var bytes = utf8Array(text);
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var s = h.toString(16);
    while (s.length < 8) s = '0' + s;
    return s;
  }

  /* ======================================================================
     PART 5 — building
     ----------------------------------------------------------------------
     Every builder returns the same shape: the payload, the raw values it was
     given (so the round trip can check them), and any notes worth printing.
     ====================================================================== */

  function el(id) { return document.getElementById(id); }
  function val(id) { var n = el(id); return n ? String(n.value).trim() : ''; }
  function rawVal(id) { var n = el(id); return n ? String(n.value) : ''; }
  function isOn(id) { var n = el(id); return !!(n && n.checked); }

  function eol() { return val('tool-eol') === 'lf' ? '\n' : '\r\n'; }

  function assemble(lines, useEol, fold) {
    var joined = [];
    lines.forEach(function (line) {
      joined.push(fold ? foldLine(line, useEol) : line);
    });
    return joined.join(useEol);
  }

  var TEL_TYPES = {
    cell: ['CELL', 'cell'], home: ['HOME,VOICE', 'home,voice'],
    work: ['WORK,VOICE', 'work,voice'], fax: ['WORK,FAX', 'work,fax'],
    main: ['MAIN', 'main']
  };

  function contactFields() {
    return {
      family: val('c-family'), given: val('c-given'), middle: val('c-middle'),
      prefix: val('c-prefix'), suffix: val('c-suffix'),
      fn: val('c-fn'), org: val('c-org'), title: val('c-title'),
      tel: val('c-tel'), telType: val('c-teltype'), email: val('c-email'),
      street: val('c-street'), city: val('c-city'), region: val('c-region'),
      post: val('c-post'), country: val('c-country'),
      url: val('c-url'), note: rawVal('c-note')
    };
  }

  function displayName(f) {
    if (f.fn) return f.fn;
    var bits = [f.prefix, f.given, f.middle, f.family, f.suffix].filter(function (b) { return !!b; });
    return bits.join(' ');
  }

  function buildVcard(version) {
    var f = contactFields();
    var fn = displayName(f);
    if (!fn && !f.family && !f.given) {
      return { error: 'A contact card needs at least a name. FN is mandatory in both vCard 3.0 and 4.0.' };
    }
    var four = version === '4.0';
    var lines = ['BEGIN:VCARD', 'VERSION:' + version];
    var fields = [];
    var notes = [];

    var nParts = [f.family, f.given, f.middle, f.prefix, f.suffix];
    lines.push('N:' + nParts.map(escText).join(';'));
    fields.push({ name: 'N', parts: nParts });

    lines.push('FN:' + escText(fn));
    fields.push({ name: 'FN', raw: fn });

    if (f.org) { lines.push('ORG:' + escText(f.org)); fields.push({ name: 'ORG', raw: f.org }); }
    if (f.title) { lines.push('TITLE:' + escText(f.title)); fields.push({ name: 'TITLE', raw: f.title }); }

    if (f.tel) {
      var t = TEL_TYPES[f.telType] || TEL_TYPES.cell;
      if (four) {
        lines.push('TEL;TYPE="' + t[1] + '";VALUE=uri:tel:' + f.tel.replace(/\s+/g, ''));
        notes.push('vCard 4.0 wants a phone number as a tel: URI, so the spaces are');
        notes.push('removed and VALUE=uri is set. 3.0 carries it as plain text.');
      } else {
        lines.push('TEL;TYPE=' + t[0] + ':' + escText(f.tel));
      }
      fields.push({ name: 'TEL', raw: four ? f.tel.replace(/\s+/g, '') : f.tel, uri: four });
    }
    if (f.email) {
      lines.push(four ? 'EMAIL:' + escText(f.email)
                      : 'EMAIL;TYPE=INTERNET:' + escText(f.email));
      fields.push({ name: 'EMAIL', raw: f.email });
    }
    if (f.street || f.city || f.region || f.post || f.country) {
      var adr = ['', '', f.street, f.city, f.region, f.post, f.country];
      lines.push('ADR;TYPE=' + (four ? 'home' : 'HOME') + ':' + adr.map(escText).join(';'));
      fields.push({ name: 'ADR', parts: adr });
      notes.push('ADR has seven components in a fixed order: post office box,');
      notes.push('extended address, street, locality, region, postcode, country.');
      notes.push('The first two are left empty here, which is what the spec asks');
      notes.push('for when there is nothing to put in them.');
    }
    if (f.url) { lines.push('URL:' + escText(f.url)); fields.push({ name: 'URL', raw: f.url }); }
    if (f.note) { lines.push('NOTE:' + escText(f.note)); fields.push({ name: 'NOTE', raw: f.note }); }
    lines.push('END:VCARD');

    return {
      kind: 'vcard', version: version, fields: fields, notes: notes,
      text: assemble(lines, eol(), isOn('tool-fold')),
      unfolded: assemble(lines, eol(), false)
    };
  }

  function buildMecard() {
    var f = contactFields();
    var fn = displayName(f);
    if (!fn && !f.family && !f.given) {
      return { error: 'A MECARD needs at least a name.' };
    }
    var parts = [];
    var fields = [];
    var notes = [];

    var nVal = escMecard(f.family) + ',' + escMecard(f.given);
    parts.push('N:' + nVal);
    fields.push({ name: 'N', parts: [f.family, f.given] });

    if (f.org) { parts.push('ORG:' + escMecard(f.org)); fields.push({ name: 'ORG', raw: f.org }); }
    if (f.tel) { parts.push('TEL:' + escMecard(f.tel)); fields.push({ name: 'TEL', raw: f.tel }); }
    if (f.email) { parts.push('EMAIL:' + escMecard(f.email)); fields.push({ name: 'EMAIL', raw: f.email }); }
    if (f.street || f.city || f.region || f.post || f.country) {
      var adr = ['', '', f.street, f.city, f.region, f.post, f.country];
      parts.push('ADR:' + adr.map(escMecard).join(','));
      fields.push({ name: 'ADR', parts: adr });
    }
    if (f.url) { parts.push('URL:' + escMecard(f.url)); fields.push({ name: 'URL', raw: f.url }); }
    if (f.note) {
      parts.push('NOTE:' + escMecard(f.note));
      fields.push({ name: 'NOTE', raw: String(f.note).replace(/[\r\n]+/g, ' ') });
    }

    if (f.title) {
      notes.push('MECARD has no job title field, so TITLE was dropped. If the');
      notes.push('title matters, use vCard.');
    }
    if (/[\r\n]/.test(f.note)) {
      notes.push('MECARD has no escape for a line break, so the newlines in the');
      notes.push('note became spaces. A backslash-n would be read as the letter n');
      notes.push('by most scanners, which is worse than losing the break.');
    }
    notes.push('MECARD is shorter than the same card in vCard, which is why');
    notes.push('a lot of Japanese and Indian scanners prefer it, and why the');
    notes.push('printed code comes out smaller and easier to scan.');

    return {
      kind: 'mecard', fields: fields, notes: notes,
      text: 'MECARD:' + parts.map(function (p) { return p + ';'; }).join('') + ';'
    };
  }

  function buildWifi() {
    var ssid = rawVal('w-ssid');
    if (!ssid) return { error: 'A Wi-Fi string needs a network name.' };
    var sec = val('w-sec');
    var pass = rawVal('w-pass');
    var parts = ['T:' + sec, 'S:' + wifiValue(ssid)];
    var fields = [{ name: 'S', raw: ssid }];
    var notes = [];

    if (sec !== 'nopass') {
      parts.push('P:' + wifiPassword(pass));
      fields.push({ name: 'P', raw: pass });
    } else if (pass) {
      notes.push('Security is set to nopass, so the password field was dropped.');
    }
    if (sec === 'WPA2-EAP') {
      var eap = val('w-eap');
      var identity = rawVal('w-identity');
      var anon = rawVal('w-anon');
      var ph2 = val('w-ph2');
      if (eap) { parts.push('E:' + escWifi(eap)); fields.push({ name: 'E', raw: eap }); }
      if (anon) { parts.push('A:' + wifiValue(anon)); fields.push({ name: 'A', raw: anon }); }
      if (identity) { parts.push('I:' + wifiValue(identity)); fields.push({ name: 'I', raw: identity }); }
      if (ph2 && ph2 !== 'none') { parts.push('PH2:' + escWifi(ph2)); fields.push({ name: 'PH2', raw: ph2 }); }
      notes.push('WPA2-EAP support in scanners is patchy. Android has read it');
      notes.push('since 10; a good number of third-party scanners ignore the E,');
      notes.push('A, I and PH2 fields entirely and try to join with a password.');
    }
    if (isOn('w-hidden')) { parts.push('H:true'); fields.push({ name: 'H', raw: 'true' }); }

    if (looksHex(ssid)) {
      notes.push('The network name is all hex digits, so it is wrapped in quotes.');
      notes.push('Without them a scanner is entitled to read it as raw hex bytes');
      notes.push('and join the wrong network, or none.');
    }
    if (sec !== 'nopass' && looksHex(pass)) {
      if (pass.length === 64) {
        notes.push('The password is exactly 64 hex digits, so it is a raw WPA PSK');
        notes.push('and not a passphrase — a passphrase is 8 to 63 characters. It');
        notes.push('is written unquoted, which is the reading that is correct here.');
        notes.push('Quoting it would make it a 64-character passphrase, and no');
        notes.push('supplicant will accept one of those.');
      } else {
        notes.push('The password is all hex digits and is quoted for the same');
        notes.push('reason as the name. Without the quotes a scanner is entitled');
        notes.push('to read it as raw hex bytes rather than as these characters.');
      }
    }

    return {
      kind: 'wifi', fields: fields, notes: notes,
      text: 'WIFI:' + parts.map(function (p) { return p + ';'; }).join('') + ';'
    };
  }

  function buildIcal() {
    var summary = val('e-summary');
    if (!summary) return { error: 'An event needs a summary. That is the line the calendar shows.' };
    var startW = parseWall(val('e-start'));
    var endW = parseWall(val('e-end'));
    if (!startW) return { error: 'Fill in a start date and time.' };
    if (!endW) return { error: 'Fill in an end date and time.' };

    var mode = val('e-tzmode');
    var tzid = val('e-tzid');
    var notes = [];
    var warns = [];
    var startLine, endLine;
    var startInst = null, endInst = null;

    if (mode === 'utc') {
      startLine = 'DTSTART:' + stampLocal(startW) + 'Z';
      endLine = 'DTEND:' + stampLocal(endW) + 'Z';
      startInst = Date.UTC(startW.y, startW.mo - 1, startW.d, startW.h, startW.mi, 0);
      endInst = Date.UTC(endW.y, endW.mo - 1, endW.d, endW.h, endW.mi, 0);
      notes.push('Times written in UTC with a trailing Z. This is the form that');
      notes.push('cannot be misread, and the form nobody can read at a glance.');
    } else {
      var zone = mode === 'browser' ? browserZone() : tzid;
      if (!zone) {
        return { error: 'No timezone to use. Type an IANA zone name such as Asia/Kolkata.' };
      }
      var s = wallToInstant(startW, zone);
      var e = wallToInstant(endW, zone);
      if (s.error === 'zone' || e.error === 'zone') {
        return { error: '"' + zone + '" is not a zone this browser knows. IANA names look like Asia/Kolkata or Europe/London.' };
      }
      startLine = 'DTSTART;TZID=' + zone + ':' + stampLocal(startW);
      endLine = 'DTEND;TZID=' + zone + ':' + stampLocal(endW);
      if (s.error === 'gap' || e.error === 'gap') {
        warns.push('One of those wall-clock times does not exist in ' + zone + '.');
        warns.push('A daylight-saving change skipped it. The TZID line above is');
        warns.push('written as you typed it, but no UTC equivalent is printed,');
        warns.push('because there is no correct one to print.');
      } else {
        startInst = s.time;
        endInst = e.time;
        notes.push('Zone offset read from this browser’s own IANA database');
        notes.push('through Intl, at the instant in question rather than today.');
        if (s.ambiguous || e.ambiguous) {
          /* Which of the two readings this lands on is not fixed, so it is
             computed rather than asserted. In America/New_York the answer is
             the earlier of the pair; in Europe/London, for the same kind of
             fall-back, it is the later one. An earlier draft printed "the
             earlier reading is used above" flat, and it was wrong for London
             every autumn. */
          var amb = s.ambiguous ? s : e;
          var apart = Math.abs(amb.otherTime - amb.time) / 60000;
          warns.push('One of those wall-clock times happens twice in ' + zone + '.');
          warns.push('A clock went back over it, so it is not one moment but two.');
          warns.push('The reading used here is the one at ' + offsetLabel(amb.offset) +
                     '; the same wall');
          warns.push('clock also exists at ' + offsetLabel(amb.otherOffset) + ', ' +
                     apart + ' minutes ' +
                     (amb.time < amb.otherTime ? 'later' : 'earlier') + '. A');
          warns.push('calendar app is free to pick either, and they disagree.');
        }
      }
      warns.push('A TZID with no matching VTIMEZONE block is not conformant');
      warns.push('RFC 5545. A VTIMEZONE is far too big for a QR code, so this');
      warns.push('leans on the receiving app having its own IANA database.');
      warns.push('Most do. The ones that do not fall back to floating time.');
    }

    if (startInst !== null && endInst !== null && endInst <= startInst) {
      warns.push('The end is not after the start. Calendar apps handle that');
      warns.push('inconsistently — some clamp it, some refuse the whole file.');
    }

    var location = val('e-location');
    var desc = rawVal('e-desc');
    var uid = fnv1a(summary + '|' + stampLocal(startW) + '|' + location) + '@qr-payloads.invalid';

    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0',
                 'PRODID:-//krunalkumar.dpdns.org//qr payload builder//EN',
                 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
                 'UID:' + uid, 'DTSTAMP:' + stampUtc(new Date()),
                 startLine, endLine, 'SUMMARY:' + escText(summary)];
    var fields = [{ name: 'SUMMARY', raw: summary }];
    if (location) { lines.push('LOCATION:' + escText(location)); fields.push({ name: 'LOCATION', raw: location }); }
    if (desc) { lines.push('DESCRIPTION:' + escText(desc)); fields.push({ name: 'DESCRIPTION', raw: desc }); }
    lines.push('END:VEVENT', 'END:VCALENDAR');

    notes.push('UID is an FNV-1a hash of the summary, start and location, so');
    notes.push('rebuilding the same event gives the same UID and a re-scan');
    notes.push('updates rather than duplicates. Two different events with');
    notes.push('identical text and times would collide; vary one field.');
    notes.push('DTSTAMP is the moment you pressed Build, which is what the');
    notes.push('field means — when this object was created, not when it happens.');

    return {
      kind: 'ical', fields: fields, notes: notes, warns: warns,
      text: assemble(lines, eol(), isOn('tool-fold')),
      unfolded: assemble(lines, eol(), false)
    };
  }

  function decimalsOf(s) {
    var m = /\.(\d+)$/.exec(String(s).trim());
    return m ? m[1].length : 0;
  }

  /* Degree lengths from the standard WGS-84 series approximation. Good to
     about a metre, which is far finer than the question being asked. */
  function metresPerDegreeLat(lat) {
    var p = lat * Math.PI / 180;
    return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) -
           0.0023 * Math.cos(6 * p);
  }

  function metresPerDegreeLon(lat) {
    var p = lat * Math.PI / 180;
    return Math.abs(111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) +
                    0.118 * Math.cos(5 * p));
  }

  function metresLabel(m) {
    if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';
    if (m >= 1) return m.toFixed(m >= 10 ? 0 : 1) + ' m';
    return (m * 100).toFixed(0) + ' cm';
  }

  function buildGeo() {
    var latS = val('g-lat');
    var lonS = val('g-lon');
    if (!latS || !lonS) return { error: 'A geo point needs a latitude and a longitude.' };
    var lat = parseFloat(latS);
    var lon = parseFloat(lonS);
    if (isNaN(lat) || isNaN(lon)) return { error: 'Latitude and longitude have to be plain decimal numbers.' };
    var warns = [];
    if (lat < -90 || lat > 90) warns.push('Latitude is outside -90 to 90, so this is not a point on Earth.');
    if (lon < -180 || lon > 180) warns.push('Longitude is outside -180 to 180.');

    var unc = val('g-unc');
    var label = val('g-label');
    var text = 'geo:' + latS + ',' + lonS;
    if (unc && !isNaN(parseFloat(unc))) text += ';u=' + parseFloat(unc);

    var notes = [];
    notes.push('geo: is RFC 5870. The default coordinate system is WGS-84,');
    notes.push('which is what a phone GPS reports, so crs= is left off.');
    if (label) {
      notes.push('RFC 5870 has no field for a place name. The labelled form');
      notes.push('below is an Android convention, not part of the standard.');
    }

    return {
      kind: 'geo', fields: [], notes: notes, warns: warns, text: text,
      lat: lat, lon: lon, latS: latS, lonS: lonS, label: label
    };
  }

  /* --- UPI ------------------------------------------------------------- */

  /* Short, partial and advisory. NPCI adds handles continually and this list
     will be out of date; a handle that is not on it is not a finding, and a
     handle that is on it vouches for nothing at all — anyone can open an
     account at any of these providers, in any name they like. It exists only
     so the tool can tell "this is a shape I recognise" apart from "this is a
     shape I have never seen", and it says which it is.

     Deliberately trimmed to handles I would stand behind rather than padded
     out to look thorough. The two ways to be wrong here are not symmetrical: a
     handle missing from the list produces "I do not recognise this, go and
     check", which costs the reader a minute, while a handle wrongly ON the
     list produces "recognised" for something that does not exist, which is the
     reassurance a fraud page would like to borrow. So when unsure, leave out. */
  var KNOWN_HANDLES = [
    'ybl', 'ibl', 'axl', 'okaxis', 'oksbi', 'okhdfcbank', 'okicici',
    'paytm', 'ptaxis', 'ptsbi', 'ptyes', 'pthdfc', 'apl', 'yapl', 'upi',
    'waaxis', 'wahdfcbank', 'wasbi', 'waicici', 'sbi', 'hdfcbank', 'icici',
    'axisbank', 'kotak', 'yesbank', 'idfcbank', 'federal', 'fbl',
    'barodampay', 'pnb', 'rbl', 'indus', 'cnrb', 'slice', 'freecharge',
    'airtel', 'jio', 'abfspay', 'jupiteraxis', 'naviaxis'
  ];

  /* Names that borrow authority. None of these is proof of anything on its
     own — a shop genuinely called "Bank Street Stores" trips the first one —
     which is why the output says "worth a second look", not "fraud".

     Each entry carries a flag saying whether it may match inside a longer
     word. Substring matching is the point for the long entries: it is what
     catches "sbirefund" and "kycverify", where the word is glued to another
     with no space to split on. It is also exactly how a list like this cries
     wolf. "pf" was in here and fired on "Shopfront"; "fine" fired on
     "Refined"; "court" fired on "Courtyard". Those three were deleted, and
     the three-letter acronyms had the same fault and were missed: "rbi" is
     inside Serbia, turbine and herbivore, so a Serbian restaurant was being
     flagged for borrowing the central bank's name. They are worth keeping, so
     they are matched only when they stand on their own. The cost is real and
     is the right way round — "SBIRefund" written with no space now slips past
     the acronym and is still caught by "refund". */
  var AUTHORITY_WORDS = [
    ['bank', true], ['rbi', false], ['npci', false], ['sbi', false],
    ['hdfc', true], ['icici', true], ['kotak', true], ['epfo', false],
    ['government', true], ['govt', false], ['ministry', true],
    ['yojana', true], ['sarkar', true], ['aadhaar', true], ['aadhar', true],
    ['income tax', true], ['incometax', true], ['pmkisan', true],
    ['pm kisan', true], ['penalty', true], ['refund', true],
    ['cashback', true], ['reward', true], ['prize', true], ['lottery', true],
    ['kyc', false], ['helpline', true], ['customer care', true],
    ['customercare', true], ['verify', true], ['verification', true],
    ['police', true], ['subsidy', true], ['scholarship', true]
  ];

  /* "Standing on its own" means no letter or digit immediately either side.
     Done with indexOf and a character test rather than by building a RegExp
     out of the entry, because nothing in the list should ever have to be
     escaped and no entry should be able to turn into a pattern by accident. */
  function wordish(ch) { return ch !== '' && /[a-z0-9]/.test(ch); }

  function authorityHits(name) {
    var lower = String(name).toLowerCase();
    var hits = [];
    AUTHORITY_WORDS.forEach(function (entry) {
      var needle = entry[0];
      var from = 0;
      while (from <= lower.length) {
        var at = lower.indexOf(needle, from);
        if (at === -1) return;
        if (entry[1]) { hits.push(needle); return; }
        if (!wordish(lower.charAt(at - 1)) &&
            !wordish(lower.charAt(at + needle.length))) {
          hits.push(needle);
          return;
        }
        from = at + 1;
      }
    });
    return hits;
  }

  function upiParams() {
    return [
      ['pa', val('u-pa')], ['pn', val('u-pn')], ['am', val('u-am')],
      ['cu', val('u-am') ? 'INR' : ''], ['tn', val('u-tn')], ['tr', val('u-tr')],
      ['mc', val('u-mc')], ['mode', val('u-mode')], ['sign', val('u-sign')]
    ];
  }

  function buildUpi() {
    var pairs = upiParams();
    var map = {};
    pairs.forEach(function (p) { map[p[0]] = p[1]; });
    if (!map.pa) return { error: 'A UPI intent needs a payee address (pa). Everything else is optional.' };

    var warns = [];
    var notes = [];
    if (map.am) {
      if (!/^\d+(\.\d{1,2})?$/.test(map.am)) {
        return { error: 'The amount has to be a plain number with at most two decimals, such as 250 or 249.50.' };
      }
      map.am = parseFloat(map.am).toFixed(2);
    }
    if (map.mc && !/^\d{4}$/.test(map.mc)) {
      warns.push('A merchant category code is four digits (ISO 18245). "' +
                 map.mc + '" is not, so apps may ignore it.');
    }
    if (map.tn && map.tn.length > 50) {
      warns.push('The note is ' + map.tn.length + ' characters. NPCI caps tn at');
      warns.push('50, so it will be truncated somewhere you cannot see.');
    }
    if (map.sign) {
      warns.push('Whatever is in sign= is copied through verbatim. This page');
      warns.push('did not compute a signature and cannot: that needs a merchant');
      warns.push('key it does not have. No app will accept this as signed.');
    }

    var query = [];
    var order = ['pa', 'pn', 'am', 'cu', 'tn', 'tr', 'mc', 'mode', 'sign'];
    order.forEach(function (k) {
      if (map[k]) query.push(k + '=' + encodeURIComponent(map[k]));
    });

    notes.push('Values are percent-encoded, so a space becomes %20. Plenty of');
    notes.push('printed codes use + for a space instead, which is form encoding');
    notes.push('rather than URI encoding, and some apps then show a literal +.');

    return {
      kind: 'upi', fields: [], notes: notes, warns: warns,
      text: 'upi://pay?' + query.join('&'), params: map
    };
  }

  /* ======================================================================
     PART 6 — parsing, in the other direction
     ====================================================================== */

  /* NAME[;PARAM=VALUE]*:VALUE, where the colon that ends the header is the
     first one not inside a quoted parameter value. A vCard 4.0 phone line
     reads TEL;VALUE=uri:tel: and then the number, so the separator is not
     the first colon on the line. That is the case a naive indexOf(':')
     gets wrong. */
  function parseContentLine(line) {
    var i = 0;
    var quoted = false;
    while (i < line.length) {
      var ch = line.charAt(i);
      if (ch === '"') quoted = !quoted;
      else if (ch === ':' && !quoted) break;
      i += 1;
    }
    if (i >= line.length) return null;
    var head = line.slice(0, i);
    var value = line.slice(i + 1);
    var bits = splitUnescaped(head, ';');
    var name = bits.shift();
    var group = '';
    var dot = name.indexOf('.');
    if (dot > 0) { group = name.slice(0, dot); name = name.slice(dot + 1); }
    var params = [];
    bits.forEach(function (b) {
      var eq = b.indexOf('=');
      if (eq < 0) params.push({ k: 'TYPE', v: b });
      else params.push({ k: b.slice(0, eq), v: b.slice(eq + 1).replace(/^"|"$/g, '') });
    });
    return { name: name.toUpperCase(), group: group, params: params, value: value };
  }

  var ADR_PARTS = ['post office box', 'extended address', 'street', 'locality',
                   'region', 'postcode', 'country'];
  var N_PARTS = ['family name', 'given name', 'additional names', 'prefixes', 'suffixes'];

  function parseVcard(text) {
    var lines = unfold(text);
    var props = [];
    var version = '';
    lines.forEach(function (line) {
      if (!line) return;
      var p = parseContentLine(line);
      if (!p) return;
      if (p.name === 'VERSION') version = p.value;
      if (p.name === 'BEGIN' || p.name === 'END') return;
      props.push(p);
    });
    return { type: 'vcard', version: version, props: props, lineCount: lines.length };
  }

  function parseMecard(text) {
    var body = text.replace(/^MECARD:/i, '');
    var chunks = splitUnescaped(body, ';');
    var props = [];
    chunks.forEach(function (chunk) {
      if (!chunk) return;
      var idx = -1;
      var i = 0;
      while (i < chunk.length) {
        var ch = chunk.charAt(i);
        if (ch === '\\') { i += 2; continue; }
        if (ch === ':') { idx = i; break; }
        i += 1;
      }
      if (idx < 0) return;
      props.push({
        name: chunk.slice(0, idx).toUpperCase(), params: [], value: chunk.slice(idx + 1)
      });
    });
    return { type: 'mecard', props: props };
  }

  function parseWifi(text) {
    var body = text.replace(/^WIFI:/i, '');
    var chunks = splitUnescaped(body, ';');
    var fields = [];
    chunks.forEach(function (chunk) {
      if (!chunk) return;
      var idx = -1;
      var i = 0;
      while (i < chunk.length) {
        var ch = chunk.charAt(i);
        if (ch === '\\') { i += 2; continue; }
        if (ch === ':') { idx = i; break; }
        i += 1;
      }
      if (idx < 0) { fields.push({ k: chunk.toUpperCase(), v: '', bare: true }); return; }
      var key = chunk.slice(0, idx).toUpperCase();
      var raw = chunk.slice(idx + 1);
      var quotedHex = raw.length > 1 && raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"';
      if (quotedHex) raw = raw.slice(1, -1);
      fields.push({ k: key, v: unescText(raw), quoted: quotedHex, raw: raw });
    });
    return { type: 'wifi', fields: fields };
  }

  function parseIcal(text) {
    var lines = unfold(text);
    var props = [];
    lines.forEach(function (line) {
      if (!line) return;
      var p = parseContentLine(line);
      if (p) props.push(p);
    });
    return { type: 'ical', props: props, lineCount: lines.length };
  }

  function parseGeo(text) {
    var body = text.replace(/^geo:/i, '');
    var bits = body.split(';');
    var coords = bits.shift().split(',');
    var params = {};
    bits.forEach(function (b) {
      var eq = b.indexOf('=');
      if (eq > 0) params[b.slice(0, eq).toLowerCase()] = b.slice(eq + 1);
    });
    return {
      type: 'geo',
      latS: (coords[0] || '').trim(), lonS: (coords[1] || '').trim(),
      altS: coords.length > 2 ? coords[2].trim() : '',
      params: params
    };
  }

  function parseUpi(text) {
    var q = text.indexOf('?');
    var head = q < 0 ? text : text.slice(0, q);
    var query = q < 0 ? '' : text.slice(q + 1);
    var scheme = '';
    var colon = head.indexOf(':');
    if (colon > 0) scheme = head.slice(0, colon).toLowerCase();
    var action = head.slice(colon + 1).replace(/^\/+/, '') || 'pay';
    var params = {};
    var order = [];
    var repeated = [];
    if (query) {
      query.split('&').forEach(function (pair) {
        if (!pair) return;
        var eq = pair.indexOf('=');
        var key = (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
        var raw = eq < 0 ? '' : pair.slice(eq + 1);
        var value = raw;
        try { value = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (err) { value = raw; }
        if (Object.prototype.hasOwnProperty.call(params, key)) repeated.push(key);
        else order.push(key);
        params[key] = value;
      });
    }
    return { type: 'upi', scheme: scheme, action: action, params: params, order: order, repeated: repeated };
  }

  function detect(text) {
    var t = String(text).replace(/^\uFEFF/, '').trim();
    var lower = t.toLowerCase();
    if (lower.indexOf('begin:vcard') === 0) return 'vcard';
    if (lower.indexOf('mecard:') === 0) return 'mecard';
    if (lower.indexOf('wifi:') === 0) return 'wifi';
    if (lower.indexOf('begin:vcalendar') === 0 || lower.indexOf('begin:vevent') === 0) return 'ical';
    if (lower.indexOf('geo:') === 0) return 'geo';
    /* A upi:// URI, or one of the app-specific wrappers around the same
       parameters — phonepe://pay?pa=, paytmmp://pay?pa=, tez://upi/pay?pa=.
       http and https are excluded deliberately. An ordinary web link is
       perfectly entitled to carry a parameter called pa, and an earlier
       version of this line read https://shop.example/checkout?pa=12345 as a
       payment request and printed "scanning this asks your UPI app to send
       money to 12345" over a shop's checkout URL. Being loudly wrong about
       money is the one failure this page cannot afford, so those fall through
       to the link branch instead. */
    if (/^[a-z][a-z0-9+.\-]*:/.test(lower) && !/^https?:/.test(lower) &&
        /(^|[?&])pa=/.test(lower)) return 'upi';
    if (lower.indexOf('upi:') === 0) return 'upi';
    if (/^000201/.test(t)) return 'emvco';
    return 'other';
  }

  /* ======================================================================
     PART 7 — reporting
     ====================================================================== */

  /* Version 40 at each correction level, from the specification. The point of
     printing these is that a payload can be too long for any QR code at all,
     and the failure mode of not knowing that is a code you print, laminate and
     put on a wall before discovering it. */
  var QR_MAX = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  function reportSize(text) {
    var bytes = utf8Len(text);
    out.row('payload', bytes + ' octets, ' + text.length + ' UTF-16 units');
    if (bytes > QR_MAX.L) {
      out.err('That is longer than any QR code can hold. The largest, version');
      out.err('40 at correction level L, stops at ' + QR_MAX.L + ' octets.');
    } else if (bytes > QR_MAX.M) {
      out.warn('Too long for correction level M (' + QR_MAX.M + ' octets). Level L');
      out.warn('will take it, at the price of less damage tolerance.');
    } else if (bytes > 400) {
      out.warn('Over 400 octets. It will encode, but the modules get small and');
      out.warn('phone cameras start failing on a printed code at that size.');
    }
    out.dim('/labs/qr draws the square and reports the exact version it needed.');
  }

  function reportLines(text, unfolded) {
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    var long = 0;
    out.heading('Line by line, in octets');
    lines.forEach(function (line, i) {
      var oct = utf8Len(line);
      if (oct > 75) long += 1;
      out.row(pad2(i + 1) + '   ' + oct + ' oct', line, oct > 75 ? 't-warn' : null);
    });
    if (long) {
      out.warn(long + ' line' + (long === 1 ? '' : 's') + ' over 75 octets. Folding is off,');
      out.warn('so this is outside the specification. Most apps cope; the ones');
      out.warn('that do not truncate the description silently.');
    } else if (unfolded && unfolded !== text) {
      var saved = utf8Len(text) - utf8Len(unfolded);
      out.ok('Every line is within 75 octets.');
      out.dim('Folding cost ' + saved + ' extra octets in the QR code — one line');
      out.dim('break and one space per fold. That is the trade: a conformant');
      out.dim('file, or a slightly smaller square.');
    } else {
      out.ok('Every line is within 75 octets with no folding needed.');
    }
  }

  function reportEscaping(fields, which) {
    var any = false;
    fields.forEach(function (f) {
      var raw = f.parts ? f.parts.join('') : String(f.raw);
      var names = escapeCounts(raw, which);
      if (!names.length) return;
      if (!any) {
        out.heading('Characters that had to be escaped');
        any = true;
      }
      out.row(f.name, names.join(', '));
    });
    if (any) {
      out.dim('Each of those is a separator in this format. Left alone, the app');
      out.dim('reading the code splits the value there and everything after the');
      out.dim('first one lands in the wrong field. This is where most builders');
      out.dim('quietly get it wrong.');
    } else {
      out.dim('Nothing needed escaping — no separators appear inside any value.');
    }
  }

  /* The round trip is the only honest way to make the escaping claim. Build
     the string, parse it back with this page's own parser, and compare each
     value to what was typed. A mismatch is printed rather than hidden.

     Structured properties are compared component by component, never as one
     joined string. Joining N or ADR back together with a space before
     comparing would hide precisely the bug this check exists to catch: a
     component that split in the wrong place still concatenates to the same
     text, so the comparison would pass while the address was in pieces. */
  function roundTrip(res) {
    if (!res.fields || !res.fields.length) return;
    var parsed = null;
    if (res.kind === 'vcard') parsed = parseVcard(res.text);
    else if (res.kind === 'mecard') parsed = parseMecard(res.text);
    else if (res.kind === 'ical') parsed = parseIcal(res.text);
    else if (res.kind === 'wifi') parsed = parseWifi(res.text);
    if (!parsed) return;

    var checked = 0;
    var bad = [];
    res.fields.forEach(function (f) {
      var got = null;
      var gotParts = null;
      if (res.kind === 'wifi') {
        for (var i = 0; i < parsed.fields.length; i++) {
          if (parsed.fields[i].k === f.name) { got = parsed.fields[i].v; break; }
        }
      } else {
        for (var j = 0; j < parsed.props.length; j++) {
          if (parsed.props[j].name === f.name) {
            var v = parsed.props[j].value;
            if (f.parts) {
              gotParts = splitUnescaped(v, res.kind === 'mecard' ? ',' : ';')
                .map(unescText);
              got = '';
            } else if (f.uri) {
              got = unescText(v).replace(/^tel:/i, '');
            } else {
              got = unescText(v);
            }
            break;
          }
        }
      }
      if (got === null) { bad.push(f.name + ': did not come back at all'); return; }
      checked += 1;
      if (f.parts) {
        if (gotParts.length !== f.parts.length) {
          bad.push(f.name + ': came back as ' + gotParts.length +
                   ' components instead of ' + f.parts.length);
          return;
        }
        for (var c = 0; c < f.parts.length; c++) {
          if (gotParts[c] !== f.parts[c]) {
            bad.push(f.name + ': component ' + (c + 1) + ' came back different');
            return;
          }
        }
        return;
      }
      if (got !== String(f.raw)) bad.push(f.name + ': went in and came back different');
    });

    out.heading('Round trip');
    if (!bad.length) {
      out.ok('Parsed the string back and all ' + checked + ' value' +
             (checked === 1 ? '' : 's') + ' came out identical.');
      out.dim('That is this page checking its own escaping, not a claim about');
      out.dim('the app on the other phone. A scanner with its own bug will');
      out.dim('still get it wrong, and there is no way to test that from here.');
    } else {
      bad.forEach(function (b) { out.err(b); });
      out.err('That is a bug in this tool. Please report it.');
    }
  }

  function reportNotes(res) {
    if (res.warns && res.warns.length) {
      out.line('');
      res.warns.forEach(function (w) { out.warn(w); });
    }
    if (res.notes && res.notes.length) {
      out.line('');
      res.notes.forEach(function (n) { out.dim(n); });
    }
  }

  /* --- the UPI explanation ---------------------------------------------- */

  function upiHeadline() {
    out.err('A PAY QR AND A RECEIVE QR LOOK IDENTICAL.');
    out.err('On UPI there is no such thing as a "receive money" QR. Every UPI');
    out.err('QR is a request for YOU to PAY. Anyone who tells you to scan a');
    out.err('code to receive a refund is taking your money.');
    out.line('');
  }

  function handleShape(pa) {
    var at = pa.indexOf('@');
    if (at < 0) return { ok: false, why: 'There is no @ in it. A VPA is always name@handle.' };
    if (pa.indexOf('@', at + 1) !== -1) return { ok: false, why: 'There is more than one @ in it.' };
    var local = pa.slice(0, at);
    var handle = pa.slice(at + 1);
    if (!local) return { ok: false, why: 'There is nothing before the @.' };
    if (!handle) return { ok: false, why: 'There is nothing after the @.' };
    if (!/^[A-Za-z0-9.\-_]{1,64}$/.test(local)) {
      return { ok: false, handle: handle, why: 'The part before the @ has characters a VPA does not normally carry.' };
    }
    if (/\./.test(handle)) {
      return {
        ok: false, handle: handle,
        why: 'The handle contains a dot, so it reads as an email domain rather ' +
             'than a PSP handle. Real handles look like ybl or okaxis, with no dot.'
      };
    }
    if (!/^[A-Za-z0-9]{2,30}$/.test(handle)) {
      return { ok: false, handle: handle, why: 'The handle is not the 2 to 30 plain letters and digits a PSP handle is.' };
    }
    return { ok: true, handle: handle, local: local };
  }

  function reportUpiParsed(p, sourceLabel) {
    var params = p.params;
    upiHeadline();

    /* A zero amount and an absent amount are the same instruction — the payer
       fills the box in — and printing "fixed at 0" for the first one read as
       though nothing could be taken. They are separated only in the signals
       section, where the difference is worth naming. */
    var amountSet = !!params.am && parseFloat(params.am) > 0;

    out.heading('What this string says');
    out.row('scheme', p.scheme || '(none)');
    if (p.scheme && p.scheme !== 'upi') {
      out.dim('That is an app-specific wrapper around the same parameters. It');
      out.dim('opens one particular payment app rather than letting the phone');
      out.dim('ask which one you want.');
    }
    out.row('action', p.action);
    out.rule();

    var pa = params.pa || '';
    out.row('payee address (pa)', pa || '(missing)', pa ? null : 't-err');
    if (!pa) {
      out.err('With no pa there is nobody to pay. Either this is not a payment');
      out.err('URI or it is truncated.');
    }
    out.row('payee name (pn)', params.pn || '(not set)');
    if (amountSet) out.row('amount (am)', (params.cu || 'no currency given') + ' ' + params.am);
    else if (params.am) out.row('amount (am)', params.am + ' — the payer types the real one in');
    else out.row('amount (am)', 'blank — the payer types it in');
    if (params.cu) out.row('currency (cu)', params.cu);
    if (params.tn) out.row('note (tn)', params.tn);
    if (params.tr) out.row('transaction ref (tr)', params.tr);
    if (params.mc) out.row('merchant code (mc)', params.mc);
    if (params.mode) out.row('mode', params.mode);
    if (params.sign) out.row('signature (sign)', params.sign.length + ' characters');
    if (params.mam) out.row('minimum amount (mam)', params.mam);
    if (params.tid) out.row('transaction id (tid)', params.tid);
    if (params.url) out.row('invoice url (url)', params.url);
    var extras = p.order.filter(function (k) {
      return ['pa', 'pn', 'am', 'cu', 'tn', 'tr', 'mc', 'mode', 'sign',
              'mam', 'tid', 'url'].indexOf(k) === -1;
    });
    if (extras.length) {
      out.row('other parameters', extras.join(', '));
      out.dim('Printed rather than interpreted. Guessing at a parameter I do not');
      out.dim('recognise would be worse than saying I do not recognise it.');
    }

    out.rule();
    out.heading('In plain language');
    if (pa) {
      out.line('Scanning this asks your UPI app to send money to ' + pa + '.');
    }
    if (amountSet) {
      out.line('The amount is fixed at ' + params.am + ' in the code itself.');
    } else {
      out.line('No amount is fixed, so your app will ask you to type one.');
    }
    out.line('Completing it takes money OUT of the account that scans it.');
    out.line('Nothing about this string can put money in.');
    out.line('');
    out.warn('Your UPI PIN is only ever needed to SEND. If you are being paid');
    out.warn('and something asks for your PIN, stop there.');

    out.rule();
    out.heading('Signals');
    var flags = 0;

    /* 1 — the amount */
    if (!amountSet) {
      flags += 1;
      out.warn('The amount is ' + (params.am ? 'zero' : 'absent') + ', so the payer fills it in.');
      out.warn('This matters more than it looks: a screenshot showing "you will');
      out.warn('receive 5,000" proves nothing, because the figure on screen came');
      out.warn('from whoever typed it, not from the code. It is also the version');
      out.warn('that arrives with a story — "just enter one rupee to verify".');
      out.line('');
    }

    /* 2 — the handle */
    if (pa) {
      var shape = handleShape(pa);
      if (!shape.ok) {
        flags += 1;
        out.err('The address is not the shape a VPA normally takes.');
        out.err(shape.why);
        out.line('');
      } else {
        out.row('provider handle', shape.handle);
        if (KNOWN_HANDLES.indexOf(shape.handle.toLowerCase()) === -1) {
          flags += 1;
          out.warn('That handle is not on this page’s short list of ones I have');
          out.warn('seen. That is not a verdict — NPCI adds handles constantly and');
          out.warn('the list here is partial and out of date by design. It means');
          out.warn('only that I cannot recognise it, so check it yourself.');
        } else {
          out.dim('That handle is one I recognise. It vouches for nothing: anyone');
          out.dim('can open an account at any provider, in any name. The handle');
          out.dim('is the payment company, not the person.');
        }
        out.line('');
      }
      var paText = textReport('pa', pa);
      if (paText.confusables.length || paText.invisibles.length) {
        flags += 1;
        out.err('The address contains characters that are not what they look like:');
        paText.confusables.forEach(function (c) { out.err('  ' + c); });
        paText.invisibles.forEach(function (c) { out.err('  ' + c); });
        out.line('');
      }
    }

    /* 3 — a name that borrows authority */
    if (params.pn) {
      out.warn('pn is attacker-controlled text, not a verified name. It is typed');
      out.warn('by whoever built the code and nobody checks it. Trust the name');
      out.warn('your UPI app resolves from the address instead, and stop if the');
      out.warn('two disagree.');
      out.line('');
      var hits = authorityHits(params.pn);
      if (hits.length) {
        flags += 1;
        out.err('The payee name borrows authority: ' + hits.join(', '));
        out.err('No bank, no government scheme and no refund desk collects money');
        out.err('through a QR code you were sent. A real shop called "Bank Street');
        out.err('Stores" would trip this too, so it is a reason to look twice,');
        out.err('not a verdict.');
        out.line('');
      }
      var pnText = textReport('pn', params.pn);
      if (pnText.confusables.length) {
        flags += 1;
        out.err('The payee name contains letters drawn like Latin ones but taken');
        out.err('from another alphabet:');
        pnText.confusables.forEach(function (c) { out.err('  ' + c); });
        out.line('');
      }
      if (pnText.invisibles.length) {
        flags += 1;
        out.err('The payee name contains invisible characters:');
        pnText.invisibles.forEach(function (c) { out.err('  ' + c); });
        out.err('Those exist to make a name read differently from what it is.');
        out.line('');
      }
      if (pnText.mixedLatin) {
        flags += 1;
        out.err('The payee name mixes Latin with ' +
                pnText.scripts.filter(function (s) { return s === 'Cyrillic' || s === 'Greek'; }).join(' and ') +
                '.');
        out.err('There is no ordinary reason for one word to do that.');
        out.line('');
      } else if (pnText.scripts.length > 1) {
        out.dim('Scripts in the payee name: ' + pnText.scripts.join(', ') + '.');
        out.dim('Mixed script is completely normal in India and is not a signal.');
        out.line('');
      }
      if (/[\r\n]/.test(params.pn)) {
        flags += 1;
        out.err('The payee name contains a line break, which a preview can use to');
        out.err('push the real content out of view.');
        out.line('');
      }
    }

    /* 4 — the rest */
    if (amountSet && params.cu && params.cu.toUpperCase() !== 'INR') {
      flags += 1;
      out.warn('The currency is ' + params.cu + '. UPI settles in INR; a different');
      out.warn('currency code is either a mistake or an attempt to confuse.');
      out.line('');
    }
    if (amountSet && !params.cu) {
      out.warn('An amount is set but cu is missing. Apps assume INR, which is');
      out.warn('almost certainly right and is still an assumption.');
      out.line('');
    }
    if (params.tn && params.tn.length > 50) {
      out.warn('The note is ' + params.tn.length + ' characters. NPCI caps tn at 50,');
      out.warn('so part of what you read here will not reach the other side.');
      out.line('');
    }
    if (params.mc) {
      if (/^\d{4}$/.test(params.mc)) {
        out.dim('mc is a four-digit merchant category code (ISO 18245). It says');
        out.dim('what the payee claims to be, and like pn it is text in the code,');
        out.dim('not something assigned to them when you scan. 0000 is what I');
        out.dim('usually see on person-to-person codes.');
      } else {
        out.warn('mc is not four digits, so it is malformed.');
      }
      out.line('');
    }
    if (params.mode) {
      out.dim('mode is a transaction-mode hint from NPCI’s linking spec. 04 is');
      out.dim('what printed static codes usually carry. I am not printing a full');
      out.dim('table of values here, because I cannot check one against the');
      out.dim('string in front of me and a wrong table is worse than none.');
      out.line('');
    }
    if (params.sign) {
      out.warn('sign= is present. That does NOT mean this code is verified. A');
      out.warn('signature is checked against a key issued by NPCI, which means a');
      out.warn('network call, which this page will never make. Present and valid');
      out.warn('are different words.');
      out.line('');
    }
    if (params.url) {
      flags += 1;
      out.warn('This code also carries a URL. It is printed above as inert text');
      out.warn('and nothing here opened, resolved or previewed it. Take it apart');
      out.warn('at /labs/url-inspector before you touch it.');
      out.line('');
    }
    if (p.repeated.length) {
      flags += 1;
      out.err('These parameters appear more than once: ' + p.repeated.join(', ') + '.');
      out.err('Everything printed above uses the LAST copy of each, because that');
      out.err('is the one this parser kept. Plenty of apps keep the first, so what');
      out.err('you have just read is not necessarily what your phone would do. A');
      out.err('duplicated pa or am is the classic way to make a preview disagree');
      out.err('with what gets executed, and there is no innocent reason for one.');
      out.line('');
    }

    if (!flags) {
      out.ok('Nothing in the string itself stands out.');
      out.line('');
    }

    out.rule();
    out.err('What this page cannot do, and will not pretend to:');
    out.err('It cannot verify that a VPA exists or belongs to anyone. That');
    out.err('needs a lookup against NPCI, which is a network call, and this');
    out.err('page makes none. Every judgement above is made on the text.');
    out.line('');
    out.dim('Read the parsed intent before you approve it, and read the name');
    out.dim('your own app resolves rather than the one in the code.');
    out.dim('The rest of the family — collect requests, mandates, and the phone');
    out.dim('call that comes with them — is at /labs/upi-fraud, and the money');
    out.dim('path is written up at');
    out.dim('/blog/upi-fraud-how-the-money-actually-leaves.');
    if (sourceLabel) {
      out.line('');
      sourceLabel.forEach(function (l) { out.dim(l); });
    }
  }

  /* --- the other parse reports ------------------------------------------ */

  function reportProps(props, unesc) {
    props.forEach(function (p) {
      var label = p.name;
      if (p.params && p.params.length) {
        label += ';' + p.params.map(function (x) { return x.k + '=' + x.v; }).join(';');
      }
      var value = unesc(p.value);
      if (value.indexOf('\n') !== -1) {
        out.row(label, '(' + (value.split('\n').length) + ' lines)');
        value.split('\n').forEach(function (v) { out.line('    ' + v); });
      } else {
        out.row(label, value);
      }
    });
  }

  function reportStructured(props, name, partNames, sep, unesc) {
    for (var i = 0; i < props.length; i++) {
      if (props[i].name !== name) continue;
      var parts = splitUnescaped(props[i].value, sep);
      out.rule();
      out.heading(name + ' broken into its components');
      partNames.forEach(function (pn, k) {
        out.row(pn, parts.length > k ? unesc(parts[k]) : '(absent)');
      });
      if (parts.length > partNames.length) {
        out.warn('There are ' + parts.length + ' components where the spec has ' +
                 partNames.length + '.');
        out.warn('That is what an unescaped separator inside a value looks like');
        out.warn('from the reading end: the value split where it should not have.');
      }
      return;
    }
  }

  function reportVcard(text) {
    var v = parseVcard(text);
    out.heading('vCard');
    out.row('version', v.version || '(no VERSION line — that is mandatory)',
            v.version ? null : 't-warn');
    out.row('content lines', v.props.length + ' after unfolding');
    var raw = String(text).replace(/\r\n/g, '\n').split('\n').length;
    if (raw !== v.lineCount) {
      out.row('folded lines rejoined', (raw - v.lineCount) + '');
    }
    out.rule();
    reportProps(v.props, unescText);
    reportStructured(v.props, 'N', N_PARTS, ';', unescText);
    reportStructured(v.props, 'ADR', ADR_PARTS, ';', unescText);
    out.rule();
    out.dim('Values above are shown unescaped — the backslashes in the source');
    out.dim('are structure, not content. Every semicolon and comma you can see');
    out.dim('here was inside a value in the original.');
    if (v.version !== '3.0' && v.version !== '4.0') {
      out.warn('Only 3.0 and 4.0 are widely implemented. 2.1 uses a different');
      out.warn('escaping scheme and this reader will get it subtly wrong.');
    }
  }

  function reportMecard(text) {
    var m = parseMecard(text);
    out.heading('MECARD');
    out.row('fields', m.props.length + '');
    out.rule();
    reportProps(m.props, unescText);
    reportStructured(m.props, 'N', ['family name', 'given name'], ',', unescText);
    reportStructured(m.props, 'ADR', ADR_PARTS, ',', unescText);
    out.rule();
    if (!/;;\s*$/.test(text)) {
      out.warn('A MECARD ends with a double semicolon. This one does not, so');
      out.warn('some scanners will read the last field as unterminated.');
    }
    out.dim('MECARD carries no version and no job title, and has no defined');
    out.dim('escape for a line break. It is smaller than vCard and that is the');
    out.dim('whole reason it is still around.');
  }

  var WIFI_KEYS = {
    T: 'security type', S: 'network name (SSID)', P: 'password',
    H: 'hidden network', E: 'EAP method', A: 'anonymous identity',
    I: 'identity', PH2: 'phase 2 method'
  };

  function reportWifi(text) {
    var w = parseWifi(text);
    out.heading('Wi-Fi join string');
    var map = {};
    w.fields.forEach(function (f) {
      map[f.k] = f.v;
      var label = WIFI_KEYS[f.k] || ('unknown field ' + f.k);
      out.row(label + ' (' + f.k + ')', f.v || '(empty)');
      if (f.quoted) {
        out.dim('  quoted, so it is read as these characters and not as hex');
      } else if (f.k === 'P' && f.v.length === 64 && looksHex(f.v)) {
        out.dim('  64 hex digits and unquoted, so this is a raw WPA PSK rather');
        out.dim('  than a passphrase. That is the correct form for one.');
      }
    });
    out.rule();
    var type = (map.T || 'WPA').toUpperCase();
    if (type === 'NOPASS' || type === '') {
      out.line('This joins an open network with no password.');
      out.warn('Open Wi-Fi is readable by anyone in range. That is a property of');
      out.warn('the network, not of this QR code.');
    } else {
      out.line('This joins ' + (map.S || 'a network') + ' using ' + type + '.');
    }
    if (map.P) {
      out.line('');
      out.err('THE PASSWORD IS IN THE CODE IN CLEAR TEXT.');
      out.err('It is not encrypted, hashed or protected in any way — the string');
      out.err('above is exactly what is printed in the square. Anyone who');
      out.err('photographs the code has the password, forever, including people');
      out.err('who were never in the building. There is no way to make a Wi-Fi');
      out.err('QR that hides its password; the format has no room for one.');
      out.line('');
      out.warn('That is exactly why a guest network is the right place for one:');
      out.warn('the thing on the wall should give access to the internet, not to');
      out.warn('the printer, the NAS and the cameras.');
    }
    if (type === 'WEP') {
      out.line('');
      out.err('WEP has been broken since 2001 and can be cracked in minutes.');
      out.err('If a network still offers it, the password is not the weak part.');
    }
    if (type === 'WPA2-EAP') {
      out.line('');
      out.dim('Enterprise EAP. Scanner support is patchy and a scanner that');
      out.dim('ignores the E, A, I and PH2 fields will try to join with a plain');
      out.dim('password and fail with a message that explains nothing.');
    }
    out.line('');
    out.dim('More on what a network does and does not protect: /labs/wifi-security.');
  }

  function reportIcal(text) {
    var c = parseIcal(text);
    out.heading('iCalendar');
    out.row('content lines', c.props.length + ' after unfolding');
    out.rule();
    reportProps(c.props, unescText);
    out.rule();

    var tzids = [];
    var hasVtimezone = false;
    var utcStamps = 0;
    c.props.forEach(function (p) {
      if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VTIMEZONE') hasVtimezone = true;
      if (p.name !== 'DTSTART' && p.name !== 'DTEND') return;
      if (/Z$/.test(p.value)) utcStamps += 1;
      p.params.forEach(function (x) {
        if (x.k.toUpperCase() === 'TZID' && tzids.indexOf(x.v) === -1) tzids.push(x.v);
      });
    });

    if (utcStamps) {
      out.ok(utcStamps + ' time' + (utcStamps === 1 ? ' is' : 's are') +
             ' written in UTC with a trailing Z.');
      out.dim('That form is unambiguous everywhere and readable nowhere.');
    }
    if (tzids.length) {
      out.row('TZID used', tzids.join(', '));
      if (!hasVtimezone) {
        out.warn('There is a TZID and no VTIMEZONE block. RFC 5545 requires the');
        out.warn('zone definition to travel with the file, so strictly this is');
        out.warn('not conformant. In practice the receiving app looks the name up');
        out.warn('in its own IANA database and gets it right — until it does not,');
        out.warn('and then the event floats.');
      }
      tzids.forEach(function (z) {
        var probe = wallToInstant({ y: 2026, mo: 6, d: 15, h: 12, mi: 0 }, z);
        if (probe.error === 'zone') {
          out.err('This browser does not know the zone "' + z + '".');
        } else {
          out.dim('This browser knows "' + z + '" and had it at ' +
                  offsetLabel(probe.offset) + ' in mid-2026.');
        }
      });
    }
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    var over = 0;
    lines.forEach(function (l) { if (utf8Len(l) > 75) over += 1; });
    if (over) {
      out.warn(over + ' raw line' + (over === 1 ? '' : 's') + ' exceed 75 octets, so');
      out.warn('whoever wrote this did not fold. That is the bug that truncates');
      out.warn('long descriptions in real calendar apps.');
    } else {
      out.ok('Every raw line is within 75 octets, so folding was done properly');
      out.ok('or was never needed.');
    }
  }

  function reportGeo(text) {
    var g = parseGeo(text);
    out.heading('Geographic point');
    var lat = parseFloat(g.latS);
    var lon = parseFloat(g.lonS);
    if (isNaN(lat) || isNaN(lon)) {
      out.err('The coordinates do not parse as numbers.');
      return;
    }
    out.row('latitude', g.latS);
    out.row('longitude', g.lonS);
    if (g.altS) out.row('altitude', g.altS + ' m');
    if (g.params.u) out.row('uncertainty (u)', g.params.u + ' m');
    if (g.params.crs) out.row('coordinate system', g.params.crs);
    if (lat < -90 || lat > 90) out.err('Latitude is outside -90 to 90.');
    if (lon < -180 || lon > 180) out.err('Longitude is outside -180 to 180.');
    out.rule();
    reportPrecision(lat, Math.max(decimalsOf(g.latS), decimalsOf(g.lonS)));
  }

  function reportPrecision(lat, decimals) {
    var mLat = metresPerDegreeLat(lat);
    var mLon = metresPerDegreeLon(lat);
    out.heading('What the decimal places actually mean');
    out.dim('At latitude ' + lat.toFixed(3) + ', one degree is about ' +
            metresLabel(mLat) + ' north to south');
    out.dim('and about ' + metresLabel(mLon) + ' east to west. Longitude lines');
    out.dim('converge towards the poles, so the two are only equal at the');
    out.dim('equator. Computed here from the WGS-84 series approximation.');
    out.line('');
    for (var d = 1; d <= 7; d++) {
      var step = Math.pow(10, -d);
      var mark = d === decimals ? ' <- what this point carries' : '';
      out.row(d + ' decimal place' + (d === 1 ? '' : 's'),
              metresLabel(mLat * step) + ' / ' + metresLabel(mLon * step) + mark,
              d === decimals ? 't-info' : 't-dim');
    }
    out.line('');
    if (decimals === 0) {
      out.warn('No decimal places at all, so this names a region, not a place.');
    } else if (decimals >= 7) {
      out.warn('Seven or more decimals is below the noise floor of any consumer');
      out.warn('GPS. The extra digits are not accuracy, they are the output of a');
      out.warn('float conversion, and printing them implies a certainty the');
      out.warn('measurement does not have.');
    } else if (decimals >= 5) {
      out.warn('Five or six decimals puts this within a metre or two, which for');
      out.warn('a home address is the difference between a neighbourhood and a');
      out.warn('front door. Four is usually enough to find a shop.');
    } else {
      out.ok(decimals + ' decimal places is around ' + metresLabel(mLat * Math.pow(10, -decimals)) + '.');
    }
    out.line('');
    out.dim('A photograph carries the same coordinates without asking: see');
    out.dim('/labs/exif.');
  }

  /* ======================================================================
     PART 8 — the page
     ====================================================================== */

  var GROUPS = {
    vcard3: 'fields-contact', vcard4: 'fields-contact', mecard: 'fields-contact',
    wifi: 'fields-wifi', ical: 'fields-cal', geo: 'fields-geo', upi: 'fields-upi'
  };

  function mode() { return val('tool-mode'); }
  function kind() { return val('tool-kind'); }

  function showFields() {
    var want = GROUPS[kind()];
    ['fields-contact', 'fields-wifi', 'fields-cal', 'fields-geo', 'fields-upi']
      .forEach(function (id) {
        var node = el(id);
        if (node) node.hidden = id !== want;
      });
    var eap = el('fields-eap');
    if (eap) eap.hidden = !(kind() === 'wifi' && val('w-sec') === 'WPA2-EAP');
    var tz = el('e-tzid-wrap');
    if (tz) tz.hidden = !(kind() === 'ical' && val('e-tzmode') === 'named');
    var textOpts = el('tool-textopts');
    if (textOpts) {
      var needs = kind() === 'vcard3' || kind() === 'vcard4' || kind() === 'ical';
      textOpts.hidden = !needs;
    }
  }

  function syncPanels() {
    var m = mode();
    el('tool-buildpanel').hidden = m !== 'build';
    el('tool-parsepanel').hidden = m !== 'parse';
    el('tool-run').textContent = m === 'build' ? '▶ Build' : '▶ Read it';
    el('tool-handoff').hidden = m !== 'build';
  }

  function build() {
    out.clear();
    var k = kind();
    var res;
    if (k === 'vcard3') res = buildVcard('3.0');
    else if (k === 'vcard4') res = buildVcard('4.0');
    else if (k === 'mecard') res = buildMecard();
    else if (k === 'wifi') res = buildWifi();
    else if (k === 'ical') res = buildIcal();
    else if (k === 'geo') res = buildGeo();
    else if (k === 'upi') res = buildUpi();
    else { out.warn('Pick a payload type.'); return; }

    if (res.error) {
      out.warn(res.error);
      el('tool-result').value = '';
      return;
    }

    var titles = {
      vcard3: 'vCard 3.0 contact card', vcard4: 'vCard 4.0 contact card',
      mecard: 'MECARD contact card', wifi: 'Wi-Fi join string',
      ical: 'iCalendar VEVENT', geo: 'Geographic point',
      upi: 'UPI payment intent'
    };
    out.heading(titles[k]);
    reportSize(res.text);
    out.rule();

    if (res.kind === 'vcard' || res.kind === 'ical') {
      reportLines(res.text, res.unfolded);
      out.rule();
    }

    out.heading('The exact string');
    out.line(res.text);
    out.rule();

    if (res.fields && res.fields.length) {
      reportEscaping(res.fields,
        res.kind === 'mecard' ? 'mecard' : (res.kind === 'wifi' ? 'wifi' : 'text'));
      out.rule();
      roundTrip(res);
      out.rule();
    }

    if (k === 'geo') {
      out.heading('The maps URI, for comparison');
      out.line('https://www.google.com/maps?q=' + res.latS + ',' + res.lonS);
      if (res.label) {
        out.line('geo:0,0?q=' + res.latS + ',' + res.lonS + '(' +
                 res.label.replace(/[()]/g, '') + ')');
        out.dim('The second form carries a label and is an Android convention.');
        out.dim('iOS ignores it. Brackets in the label are removed because the');
        out.dim('form has no escape for them.');
      }
      out.dim('Neither URL was opened or requested. A geo: URI opens whichever');
      out.dim('map app the phone prefers; a maps.google.com link opens one');
      out.dim('company’s, and tells them you looked.');
      out.rule();
      reportPrecision(res.lat, Math.max(decimalsOf(res.latS), decimalsOf(res.lonS)));
      out.rule();
    }

    if (k === 'upi') {
      reportUpiParsed(parseUpi(res.text), [
        'Everything above is this page reading back the string it just built,',
        'through exactly the same parser a pasted code goes through. Build one,',
        'then read a real one, and compare what the two say.'
      ]);
      out.rule();
    }

    if (k === 'wifi') {
      out.line('');
      out.err('THE PASSWORD IS IN THE CODE IN CLEAR TEXT.');
      out.err('Anyone who photographs the printed square has it forever. Put');
      out.err('this on a guest network and nowhere else.');
      out.rule();
    }

    reportNotes(res);

    out.line('');
    out.dim('Copy the string below and paste it into /labs/qr to draw the');
    out.dim('square. There is only one QR encoder on this site and it lives');
    out.dim('there, which is the only way anyone can check it once.');

    el('tool-result').value = res.text;
    el('tool-in').value = res.text;
  }

  function parse() {
    out.clear();
    var text = rawVal('tool-in');
    if (!text.trim()) {
      out.warn('Paste a payload string first — the thing inside the QR code, not');
      out.warn('a picture of it. /labs/qr decodes the picture and prints this.');
      return;
    }
    var trimmed = text.replace(/^\uFEFF/, '').trim();
    var type = detect(trimmed);
    out.row('length', utf8Len(trimmed) + ' octets');
    out.rule();
    if (type === 'vcard') reportVcard(trimmed);
    else if (type === 'mecard') reportMecard(trimmed);
    else if (type === 'wifi') reportWifi(trimmed);
    else if (type === 'ical') reportIcal(trimmed);
    else if (type === 'geo') reportGeo(trimmed);
    else if (type === 'upi') reportUpiParsed(parseUpi(trimmed), null);
    else if (type === 'emvco') {
      out.heading('An EMVCo QR, not a URI');
      out.line('This starts 000201, which is the payload format indicator of an');
      out.line('EMVCo code — the family Bharat QR belongs to. It is tag-length-');
      out.line('value binary-ish text, not a upi:// URI, and this page does not');
      out.line('decode it. Saying so is better than half-decoding it.');
      out.line('');
      out.warn('It is still a payment instruction. Everything above about pay');
      out.warn('versus receive applies to it exactly the same way.');
    } else {
      out.heading('Not one of the payload types this page handles');
      out.line('This page builds and reads vCard, MECARD, Wi-Fi, iCalendar,');
      out.line('geo and UPI. What you pasted is none of those.');
      out.line('');
      if (/^https?:/i.test(trimmed)) {
        out.warn('It looks like a link. Take it apart at /labs/url-inspector,');
        out.warn('which does the host, the punycode and the redirect chain.');
      } else {
        out.dim('/labs/qr inspects general text and links from a decoded code.');
      }
    }
  }

  function run() {
    try {
      if (mode() === 'build') build();
      else parse();
    } catch (err) {
      /* run() is called bare from a click handler, and build() and parse()
         both begin with out.clear() — so anything that escapes leaves the pane
         wiped and silent, and the tool looks broken with no error to search
         for. Whatever printed before the throw stays on screen, which also
         says how far it got. */
      out.rule();
      out.err('That input broke the reader.');
      out.err('Details: ' + ((err && err.message) || String(err)));
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('If you can share the string, I would like to fix it.');
    }
  }

  function prime() {
    if (mode() === 'build') {
      out.dim('Fill in the fields and press Build. You get the exact string, the');
      out.dim('escaping that was applied, and a round-trip check that parses it');
      out.dim('back and compares every value to what you typed.');
      out.dim('Paste the result into /labs/qr to draw the square.');
    } else {
      out.dim('Paste a payload string — a vCard, a MECARD, a WIFI: string, a');
      out.dim('VEVENT, a geo: point or a upi:// URI — and press Read it.');
      out.dim('Nothing is opened, resolved or requested. Not the URLs, not the');
      out.dim('VPAs, not the network names.');
    }
  }

  function onModeChange() {
    syncPanels();
    out.clear();
    prime();
  }

  LabTool.define({
    id: 'qrpayloads',
    run: run,
    onReady: function () {
      el('tool-mode').addEventListener('change', onModeChange);
      el('tool-kind').addEventListener('change', function () {
        showFields();
        out.clear();
        prime();
      });
      el('w-sec').addEventListener('change', showFields);
      el('e-tzmode').addEventListener('change', showFields);
      el('tool-handoff').addEventListener('click', function () {
        var text = el('tool-result').value;
        if (!text) { out.clear().warn('Build something first.'); return; }
        el('tool-in').value = text;
        el('tool-mode').value = 'parse';
        onModeChange();
        parse();
      });

      var zone = browserZone();
      if (zone) {
        var opt = el('e-tzmode-browser');
        if (opt) opt.textContent = 'Times are wall clock in ' + zone;
      }

      showFields();
      syncPanels();
      prime();
    }
  });
})();

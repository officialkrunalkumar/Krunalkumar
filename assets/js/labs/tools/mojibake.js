/* ==========================================================================
   mojibake.js — name the wrong decode that broke a piece of text, and undo it.
   --------------------------------------------------------------------------
   Mojibake is not corruption of the bytes. It is a correct decode of the right
   bytes under the wrong table, which is why it can usually be undone exactly:
   encode the glyphs back into the bytes that produced them, then decode those
   bytes properly. This tool does that literally. Every hypothesis it prints is
   a charset it re-encoded through and a strict UTF-8 decode that either passed
   or failed, and the hex view under each stage is the actual evidence — the
   glyphs are only the symptom.

   The Windows-1252 table is written out in full here rather than borrowed from
   TextDecoder, because 0x80-0x9F is the entire subject. Latin-1 leaves that
   range as C1 controls; Windows-1252 fills it with the curly quotes, the two
   dashes, the euro sign and the ellipsis — which is to say, with exactly the
   characters that turn up broken. A tool that treats the two as
   interchangeable gets "a-hat euro trademark" right and "a-hat euro" wrong,
   and the second is the common one, because U+201D encodes to E2 80 9D and
   0x9D is one of the five slots the original cp1252 leaves undefined.

   Which is the other reason to write the table out. Browsers do not implement
   the original cp1252. The WHATWG encoding standard fills those five slots
   (0x81 0x8D 0x8F 0x90 0x9D) with the matching C1 controls, so a round trip
   through a browser survives where a round trip through a strict cp1252
   implementation would have dropped the byte outright. The report says so
   whenever one of the five is involved, because that is the whole difference
   between "reversible" and "the byte is gone and nothing brings it back".

   Three things this deliberately does not do. It does not guess at charsets
   beyond the four it tries and names. It does not re-decode a whole UTF-16
   file, because a textarea is not a byte channel — it recognises the UTF-16
   byte order marks and stops there. And it never pretends to repair a U+FFFD:
   a replacement character is not damage waiting to be undone, it is the
   receipt for damage that already happened somewhere upstream.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_CHARS = 20000;   // input ceiling, so a pasted book cannot hang the tab
  var MAX_ROUNDS = 6;      // repair iterations before the loop gives up
  var HEX_BYTES = 640;     // bytes drawn in the hex view per stage
  var ECHO = 90;           // characters echoed into any single report line

  var out = LabTool.out('tool-out');

  /* ------------------------------------------------------------------
     Code point helpers
     ------------------------------------------------------------------ */

  function fromCp(cp) {
    if (cp <= 0xffff) return String.fromCharCode(cp);
    cp -= 0x10000;
    return String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
  }

  function hex(n, width) {
    var s = n.toString(16).toUpperCase();
    while (s.length < width) s = '0' + s;
    return s;
  }

  function uPlus(cp) { return 'U+' + hex(cp, cp > 0xffff ? 5 : 4); }

  /* charCodeAt hands back UTF-16 code units, and half a surrogate pair is not
     a character. Everything below works in code units on purpose — the tables
     are all BMP — but a failure message that says "U+D83D has no byte in
     Windows-1252" names something that does not exist. An emoji in a subject
     line is exactly the sort of thing that arrives in broken text, so the
     report reads the pair and names the code point the visitor actually has. */
  function cpAt(text, i) {
    var c = text.charCodeAt(i), next;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        return (c - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
      }
    }
    return c;
  }

  function pad(text, width) {
    var s = String(text);
    while (s.length < width) s += ' ';
    return s;
  }

  /* Nothing the visitor pastes is echoed into the report as raw text.

     The same reasoning as /labs/unicode: a pasted right-to-left override would
     reorder the tool's own findings, and a report that can be rearranged by
     its subject is not a report. Here it matters twice over, because a stray
     BOM and a U+FFFD are two of the things being diagnosed and both are
     invisible or near-invisible when printed straight. */
  function visible(text, limit) {
    var s = '', i, code, next, cut = limit || ECHO;
    for (i = 0; i < text.length && i < cut; i++) {
      code = text.charCodeAt(i);
      /* A well-formed pair goes through whole. An unpaired surrogate does not:
         printing one puts a broken code unit into the report itself, which is
         the failure this tool is supposed to be describing, not committing. */
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          s += text.charAt(i) + text.charAt(i + 1);
          i += 1;
          continue;
        }
      }
      if (code < 0x20 || (code >= 0x7f && code <= 0xa0) ||
          code === 0xad || code === 0xfeff || code === 0xfffe ||
          code === 0xfffd || (code >= 0xd800 && code <= 0xdfff) ||
          (code >= 0x200b && code <= 0x200f) ||
          (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) {
        s += '[' + uPlus(code) + ']';
      } else {
        s += text.charAt(i);
      }
    }
    if (text.length > cut) s += '…';
    return s;
  }

  /* ------------------------------------------------------------------
     The tables. These are the whole point, so they are written out.
     ------------------------------------------------------------------ */

  /* Windows-1252, bytes 0x80-0x9F. 0xA0-0xFF is Latin-1 and is filled in
     below rather than typed twice.

     The five entries that read 0081 008D 008F 0090 009D are the slots the
     original Microsoft code page leaves undefined. The values here are what
     the WHATWG encoding standard — and therefore every browser — puts in
     them. UNDEFINED_1252 remembers which five they are so the report can say
     that a different implementation might have dropped the byte instead. */
  var W1252_HIGH =
    '20AC 0081 201A 0192 201E 2026 2020 2021 02C6 2030 0160 2039 0152 008D 017D 008F ' +
    '0090 2018 2019 201C 201D 2022 2013 2014 02DC 2122 0161 203A 0153 009D 017E 0178';

  var UNDEFINED_1252 = { 0x81: true, 0x8d: true, 0x8f: true, 0x90: true, 0x9d: true };

  /* CP437 — the IBM PC ROM character set. Still the default code page of a
     Windows console in a great many installations, which is why exports from
     old tooling arrive looking like line-drawing art. */
  var CP437_HIGH =
    '00C7 00FC 00E9 00E2 00E4 00E0 00E5 00E7 00EA 00EB 00E8 00EF 00EE 00EC 00C4 00C5 ' +
    '00C9 00E6 00C6 00F4 00F6 00F2 00FB 00F9 00FF 00D6 00DC 00A2 00A3 00A5 20A7 0192 ' +
    '00E1 00ED 00F3 00FA 00F1 00D1 00AA 00BA 00BF 2310 00AC 00BD 00BC 00A1 00AB 00BB ' +
    '2591 2592 2593 2502 2524 2561 2562 2556 2555 2563 2551 2557 255D 255C 255B 2510 ' +
    '2514 2534 252C 251C 2500 253C 255E 255F 255A 2554 2569 2566 2560 2550 256C 2567 ' +
    '2568 2564 2565 2559 2558 2552 2553 256B 256A 2518 250C 2588 2584 258C 2590 2580 ' +
    '03B1 00DF 0393 03C0 03A3 03C3 00B5 03C4 03A6 0398 03A9 03B4 221E 03C6 03B5 2229 ' +
    '2261 00B1 2265 2264 2320 2321 00F7 2248 00B0 2219 00B7 221A 207F 00B2 25A0 00A0';

  /* KOI8-R — the Cyrillic encoding of the Russian internet before UTF-8, and
     still what a good deal of archived mail is stored in. Its 0x80-0xBF block
     is nearly all line drawing, which is exactly where UTF-8 continuation
     bytes land, so its mojibake has a very recognisable shape: a Cyrillic
     letter followed immediately by a box-drawing character. */
  var KOI8_HIGH =
    '2500 2502 250C 2510 2514 2518 251C 2524 252C 2534 253C 2580 2584 2588 258C 2590 ' +
    '2591 2592 2593 2320 25A0 2219 221A 2248 2264 2265 00A0 2321 00B0 00B2 00B7 00F7 ' +
    '2550 2551 2552 0451 2553 2554 2555 2556 2557 2558 2559 255A 255B 255C 255D 255E ' +
    '255F 2560 2561 0401 2562 2563 2564 2565 2566 2567 2568 2569 256A 256B 256C 00A9 ' +
    '044E 0430 0431 0446 0434 0435 0444 0433 0445 0438 0439 043A 043B 043C 043D 043E ' +
    '043F 044F 0440 0441 0442 0443 0436 0432 044C 044B 0437 0448 044D 0449 0447 044A ' +
    '042E 0410 0411 0426 0414 0415 0424 0413 0425 0418 0419 041A 041B 041C 041D 041E ' +
    '041F 042F 0420 0421 0422 0423 0416 0412 042C 042B 0417 0428 042D 0429 0427 042A';

  /* byte -> code point, code point -> byte, and the subset of the table that
     is symbols rather than letters. That last one is the damage metric for
     CP437 and KOI8-R: it is derived from the table itself rather than
     hand-listed, so it cannot drift away from it. */
  function makeCharset(label, high, tailFrom) {
    var cs = { label: label, byte: {}, cp: {}, symbols: {} };
    var parts = high ? high.split(/\s+/) : [];
    var i, b, v;
    for (i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      cs.byte[0x80 + i] = parseInt(parts[i], 16);
    }
    if (tailFrom !== undefined) {
      for (b = tailFrom; b <= 0xff; b++) cs.byte[b] = b;
    }
    for (b = 0x80; b <= 0xff; b++) {
      v = cs.byte[b];
      if (v === undefined) continue;
      if (cs.cp[v] === undefined) cs.cp[v] = b;
      if (v >= 0x2000) cs.symbols[v] = true;
    }
    return cs;
  }

  var CS = {
    w1252: makeCharset('Windows-1252', W1252_HIGH, 0xa0),
    latin1: makeCharset('ISO-8859-1', null, 0x80),
    cp437: makeCharset('CP437', CP437_HIGH),
    koi8: makeCharset('KOI8-R', KOI8_HIGH)
  };
  var ORDER = ['w1252', 'latin1', 'cp437', 'koi8'];

  /* ------------------------------------------------------------------
     The mojibake signature, counted rather than guessed at
     ------------------------------------------------------------------ */

  /* A UTF-8 lead byte is 0xC2-0xF4. Under Latin-1 and under Windows-1252 alike
     those bytes decode to U+00C2-U+00F4, so a lead byte always shows up as one
     of that run of accented capitals and small letters. */
  function isLead(code) { return code >= 0xc2 && code <= 0xf4; }

  /* A continuation byte is 0x80-0xBF. Under Latin-1 that is a C1 control;
     under Windows-1252 it is a curly quote, a dash, the euro sign, the
     trademark sign, or — from 0xA0 up — a Latin-1 punctuation mark. Both
     readings go in, because a mis-decode may have used either table. */
  var CONT = {};
  (function () {
    var b;
    for (b = 0x80; b <= 0xbf; b++) {
      CONT[b] = true;
      if (CS.w1252.byte[b] !== undefined) CONT[CS.w1252.byte[b]] = true;
    }
  })();

  /* The count of lead-then-continuation runs. This is the number the whole
     Latin-1 / Windows-1252 diagnosis turns on: if a repair does not reduce it,
     the repair is not accepted, whatever it did to the text. */
  function sigLatin(text) {
    var n = 0, i = 0, k;
    while (i < text.length) {
      if (isLead(text.charCodeAt(i))) {
        k = 0;
        while (k < 3 && i + 1 + k < text.length && CONT[text.charCodeAt(i + 1 + k)]) k++;
        if (k > 0) { n += 1; i += k + 1; continue; }
      }
      i += 1;
    }
    return n;
  }

  function symbolCount(text, cs) {
    var n = 0, i;
    for (i = 0; i < text.length; i++) {
      if (cs.symbols[text.charCodeAt(i)]) n += 1;
    }
    return n;
  }

  function damage(text, key) {
    if (key === 'w1252' || key === 'latin1') return sigLatin(text);
    return symbolCount(text, CS[key]);
  }

  function damageLabel(key) {
    if (key === 'w1252' || key === 'latin1') return 'lead+continuation runs';
    return 'drawing characters from the table';
  }

  /* ------------------------------------------------------------------
     Encode back to legacy bytes, decode strictly as UTF-8
     ------------------------------------------------------------------ */

  function toBytes(text, cs) {
    var bytes = [], i, code, b;
    for (i = 0; i < text.length; i++) {
      code = text.charCodeAt(i);
      if (code < 0x80) { bytes.push(code); continue; }
      b = cs.cp[code];
      if (b === undefined) return { ok: false, at: i, cp: cpAt(text, i) };
      bytes.push(b);
    }
    return { ok: true, bytes: bytes };
  }

  /* A strict UTF-8 decoder, written out rather than delegated to
     TextDecoder({fatal:true}), for one reason: the position and the kind of
     the failure are the diagnosis. "A missing continuation byte at index 14"
     is what a dropped 0x81 looks like from the outside, and a decoder that
     only says "malformed" cannot tell you that.

     Overlongs, surrogates and anything above U+10FFFF are refused, because a
     lenient decoder that accepts them will happily "repair" text that was
     never Windows-1252 in the first place. */
  function utf8Decode(bytes) {
    var s = '', i = 0, n = bytes.length, b0, need, cp, min, j, b;
    function fail(at, why) { return { ok: false, at: at, why: why }; }
    while (i < n) {
      b0 = bytes[i];
      if (b0 < 0x80) { s += String.fromCharCode(b0); i += 1; continue; }
      if (b0 < 0xc0) return fail(i, 'a continuation byte ' + hex(b0, 2) + ' with no lead byte in front of it');
      if (b0 < 0xc2) return fail(i, 'byte ' + hex(b0, 2) + ', an overlong two-byte lead that UTF-8 forbids');
      if (b0 < 0xe0) { need = 1; cp = b0 & 0x1f; min = 0x80; }
      else if (b0 < 0xf0) { need = 2; cp = b0 & 0x0f; min = 0x800; }
      else if (b0 < 0xf5) { need = 3; cp = b0 & 0x07; min = 0x10000; }
      else return fail(i, 'byte ' + hex(b0, 2) + ', which cannot start any UTF-8 sequence');
      if (i + need >= n) return fail(i, 'a sequence that runs off the end of the text');
      for (j = 1; j <= need; j++) {
        b = bytes[i + j];
        if (b < 0x80 || b > 0xbf) {
          return fail(i + j, 'a missing continuation byte after lead ' + hex(b0, 2) +
                             ' (found ' + hex(b, 2) + ')');
        }
        cp = (cp << 6) | (b & 0x3f);
      }
      if (cp < min) return fail(i, 'an overlong encoding of ' + uPlus(cp));
      if (cp >= 0xd800 && cp <= 0xdfff) return fail(i, 'a surrogate, ' + uPlus(cp) + ', which UTF-8 may not carry');
      if (cp > 0x10ffff) return fail(i, 'a code point above U+10FFFF');
      s += fromCp(cp);
      i += need + 1;
    }
    return { ok: true, text: s };
  }

  /* UTF-8 bytes of a string, for the hex view. TextEncoder does this and is
     not a network call; the hand-written path is only there so the hex pane
     still fills on a browser old enough to lack it. */
  function utf8Encode(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    var bytes = [], i = 0, cp, c, next;
    while (i < text.length) {
      c = text.charCodeAt(i);
      cp = c;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          cp = (c - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
          i += 1;
        }
      }
      i += 1;
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return bytes;
  }

  /* ------------------------------------------------------------------
     Hypothesis 1: the whole text came through one wrong table
     ------------------------------------------------------------------ */

  /* Scoring. Four measured components, printed alongside the number so it is
     never a magic figure:

       25  every character maps to a byte in this charset
       35  those bytes decode as strict UTF-8
       30  scaled by how far the damage count fell
       10  nothing recognisable as damage is left

     It caps at 99 on purpose. Nothing here can prove that the result is what
     the author typed — only that one specific wrong-decode story explains
     every byte. 100% would be a claim this tool is not in a position to make.

     All four are pushed whether or not they earn anything, because the page
     promises the visitor four printed lines and a breakdown that silently
     drops its fourth row when the news is bad is not a breakdown. A repair
     that leaves markers behind scores +0 on the last one and says how many. */
  function scoreOf(parts) {
    var total = 0, i;
    for (i = 0; i < parts.length; i++) total += parts[i].points;
    return Math.min(99, Math.round(total));
  }

  function markersPart(after) {
    if (after === 0) return { text: 'no damage markers remain', points: 10 };
    return {
      text: after + ' damage marker' + (after === 1 ? '' : 's') + ' still left over',
      points: 0
    };
  }

  function wholeText(text, key) {
    var cs = CS[key];
    var h = { key: key, label: cs.label, mode: 'whole', ok: false, parts: [] };
    h.before = damage(text, key);

    var enc = toBytes(text, cs);
    if (!enc.ok) {
      /* The glyph is worth printing next to the code point when it has one.
         For a BOM or a U+FFFD it does not: visible() hands back the bracketed
         token, which would print the code point twice in the same sentence. */
      var glyph = visible(fromCp(enc.cp), 4);
      h.why = uPlus(enc.cp) + (glyph.charAt(0) === '[' ? '' : ' "' + glyph + '"') +
              ' at index ' + enc.at + ' has no byte in ' + cs.label;
      return h;
    }
    h.parts.push({ text: 'every character maps to a byte in ' + cs.label, points: 25 });

    var dec = utf8Decode(enc.bytes);
    if (!dec.ok) {
      h.why = 'those bytes are not valid UTF-8 — byte ' + dec.at + ' is ' + dec.why;
      h.decodeFail = dec;
      return h;
    }
    h.parts.push({ text: 'the bytes decode as strict UTF-8', points: 35 });

    if (dec.text === text) { h.why = 'the round trip changed nothing'; return h; }

    h.after = damage(dec.text, key);
    if (h.before === 0) { h.why = 'there was no ' + damageLabel(key) + ' to explain'; return h; }
    if (h.after >= h.before) {
      h.why = 'the damage count did not fall (' + h.before + ' before, ' + h.after + ' after)';
      return h;
    }

    h.parts.push({
      text: damageLabel(key) + ': ' + h.before + ' before, ' + h.after + ' after',
      points: 30 * (h.before - h.after) / h.before
    });
    h.parts.push(markersPart(h.after));

    h.ok = true;
    h.text = dec.text;
    h.confidence = scoreOf(h.parts);

    if (key === 'w1252') {
      var slots = [], i;
      for (i = 0; i < enc.bytes.length; i++) {
        if (UNDEFINED_1252[enc.bytes[i]] && slots.length < 6) slots.push(hex(enc.bytes[i], 2) + '@' + i);
      }
      if (slots.length) h.slots = slots;
    }
    return h;
  }

  /* ------------------------------------------------------------------
     Hypothesis 2: only some runs are damaged
     ------------------------------------------------------------------ */

  /* Real damage is often partial. Half a table gets fixed and half does not;
     one column of a CSV goes through a broken importer and the rest does not.
     A whole-text round trip fails on that input for a good reason — an
     already-correct "é" encodes to a bare E9, which is not valid UTF-8 — and
     failing there would be the wrong answer, so the runs are tried separately.

     A run is a maximal stretch of characters that all have a byte above 0x7F
     in the charset, and that contains at least one lead byte. Anything else is
     left exactly as it is. This is weaker evidence than a whole-text round
     trip and scores lower: repairing a run in isolation means trusting a
     boundary the tool chose. The report names the runs it touched and the runs
     it refused — the first five of each, with a count of anything past that —
     so the guess is checkable rather than silent.

     The boundary caveat used to be scored, as a line reading "+15 run
     boundaries were chosen by this tool, not observed", which awarded fifteen
     points of confidence for the weakest thing about the method. It is printed
     as a caveat now. The fifteen points went to the property that actually
     makes a partial repair safe to offer: every character outside the repaired
     runs comes through unchanged.

     Only tried for Windows-1252 and Latin-1. For CP437 and KOI8-R the
     high-byte set includes ordinary Cyrillic letters and box art that real
     documents use on purpose, so there is no honest way to draw a run
     boundary — those two are whole-text or nothing. */
  function runTargeted(text, key) {
    var cs = CS[key];
    var h = { key: key, label: cs.label, mode: 'runs', ok: false, parts: [] };
    h.before = sigLatin(text);
    if (h.before === 0) { h.why = 'there was no lead+continuation run to explain'; return h; }

    var result = '', i = 0, j, run, enc, dec, code;
    var fixed = 0, refusedCount = 0, touched = [], refused = [];
    while (i < text.length) {
      code = text.charCodeAt(i);
      if (code < 0x80 || cs.cp[code] === undefined) { result += text.charAt(i); i += 1; continue; }
      j = i;
      while (j < text.length) {
        code = text.charCodeAt(j);
        if (code < 0x80 || cs.cp[code] === undefined) break;
        j += 1;
      }
      run = text.slice(i, j);
      enc = toBytes(run, cs);
      dec = enc.ok ? utf8Decode(enc.bytes) : { ok: false, why: 'unmappable' };
      if (dec.ok && dec.text !== run && sigLatin(run) > 0) {
        result += dec.text;
        fixed += 1;
        if (touched.length < 5) {
          touched.push('"' + visible(run, 12) + '" at ' + i + ' → "' + visible(dec.text, 12) + '"');
        }
      } else {
        result += run;
        refusedCount += 1;
        if (refused.length < 5) {
          refused.push('"' + visible(run, 12) + '" at ' + i + ' — ' +
                       (dec.ok ? 'the round trip changed nothing' : dec.why || 'not valid UTF-8'));
        }
      }
      i = j;
    }

    if (!fixed) { h.why = 'no high-byte run decoded as UTF-8'; return h; }
    h.after = sigLatin(result);
    if (h.after >= h.before) {
      h.why = 'the damage count did not fall (' + h.before + ' before, ' + h.after + ' after)';
      return h;
    }

    h.parts.push({ text: fixed + (fixed === 1 ? ' run' : ' runs') + ' decoded as strict UTF-8', points: 35 });
    h.parts.push({
      text: 'every character outside those runs came through unchanged',
      points: 15
    });
    h.parts.push({
      text: 'lead+continuation runs: ' + h.before + ' before, ' + h.after + ' after',
      points: 30 * (h.before - h.after) / h.before
    });
    h.parts.push(markersPart(h.after));

    h.ok = true;
    h.text = result;
    h.fixed = fixed;
    h.touched = touched;
    h.touchedMore = fixed - touched.length;
    h.refused = refused;
    h.refusedMore = refusedCount - refused.length;
    h.confidence = Math.min(90, scoreOf(h.parts));
    return h;
  }

  /* ------------------------------------------------------------------
     HTML entities
     ------------------------------------------------------------------ */

  /* A partial named table, and it says so on screen. The full HTML5 named
     character reference set is over 2200 entries and most of them are
     mathematical; what is here is the Latin-1 block, the punctuation people
     actually paste, and the handful of arrows and symbols that turn up in
     exported content. Numeric references are handled algorithmically, so
     those are complete. */
  var NAMED = {
    amp: 38, lt: 60, gt: 62, quot: 34, apos: 39,
    nbsp: 160, iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165,
    brvbar: 166, sect: 167, uml: 168, copy: 169, ordf: 170, laquo: 171,
    not: 172, shy: 173, reg: 174, macr: 175, deg: 176, plusmn: 177,
    sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182, middot: 183,
    cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188, frac12: 189,
    frac34: 190, iquest: 191,
    Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197,
    AElig: 198, Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203,
    Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209,
    Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, times: 215,
    Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221,
    THORN: 222, szlig: 223,
    agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229,
    aelig: 230, ccedil: 231, egrave: 232, eacute: 233, ecirc: 234, euml: 235,
    igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240, ntilde: 241,
    ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247,
    oslash: 248, ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253,
    thorn: 254, yuml: 255,
    OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402,
    circ: 710, tilde: 732,
    ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206,
    rlm: 8207, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218,
    ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225,
    bull: 8226, hellip: 8230, permil: 8240, prime: 8242, Prime: 8243,
    lsaquo: 8249, rsaquo: 8250, oline: 8254, frasl: 8260, euro: 8364,
    trade: 8482, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596,
    infin: 8734, lowast: 8727, minus: 8722, ne: 8800, le: 8804, ge: 8805,
    spades: 9824, clubs: 9827, hearts: 9829, diams: 9830
  };
  var NAMED_COUNT = Object.keys(NAMED).length;

  /* NAMED[name] is not a safe lookup and this was found the hard way: the
     entity grammar accepts any run of letters, so "&constructor;" reaches the
     object literal, misses every key in it, and finds Object.prototype's
     constructor on the way up the chain. That is not undefined, so the old
     code took it for a code point, fed a function to fromCp, and got NaN — and
     NaN >> 10 is 0, so every one of "&constructor;" "&toString;" "&valueOf;"
     "&hasOwnProperty;" came out as U+10000, counted as a successful decode,
     under a report line reading "every reference has one expansion".
     A tool that destroys text while reporting a clean repair is worse than one
     that refuses, so the lookup asks for an own property and nothing else. */
  function namedCp(name) {
    if (!Object.prototype.hasOwnProperty.call(NAMED, name)) return null;
    return NAMED[name];
  }

  var ENT_RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

  /* HTML5 requires a numeric reference in the 0x80-0x9F range to be
     re-interpreted through Windows-1252 rather than taken at face value, so
     &#151; is an em dash and not U+0097. It is the one place a standard bakes
     the mojibake in deliberately, for compatibility with documents that were
     already wrong, and a decoder that skips it turns a working page into a
     line of C1 controls. */
  function entityCp(body) {
    var cp;
    if (body.charAt(0) === '#') {
      if (body.charAt(1) === 'x' || body.charAt(1) === 'X') cp = parseInt(body.slice(2), 16);
      else cp = parseInt(body.slice(1), 10);
      if (isNaN(cp)) return null;
      if (cp >= 0x80 && cp <= 0x9f && CS.w1252.byte[cp] !== undefined) return CS.w1252.byte[cp];
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      return cp;
    }
    return namedCp(body);
  }

  function entityRound(text) {
    var count = 0, unknown = [], numeric = 0;
    var res = text.replace(ENT_RE, function (whole, body) {
      var cp = entityCp(body);
      if (cp === null) {
        if (unknown.indexOf(body) < 0 && unknown.length < 6) unknown.push(body);
        return whole;
      }
      count += 1;
      if (body.charAt(0) === '#') numeric += 1;
      return fromCp(cp);
    });
    return { text: res, count: count, unknown: unknown, numeric: numeric };
  }

  /* ------------------------------------------------------------------
     Byte order marks
     ------------------------------------------------------------------ */

  /* A BOM at offset zero is a nuisance. A BOM in the middle of a file is
     evidence: it means two files were concatenated by something that copied
     bytes and did not look at them, which is the normal outcome of a shell
     "cat a.csv b.csv > all.csv" when both were written by an editor that
     stamps one at the front of everything it saves. The
     interior copy is the one that breaks the parser twelve steps downstream,
     so the positions are reported rather than just the count. */
  function findBoms(text) {
    var hits = [], i, code;
    for (i = 0; i < text.length; i++) {
      code = text.charCodeAt(i);
      if (code === 0xfeff || code === 0xfffe) hits.push({ at: i, cp: code });
    }
    return hits;
  }

  function stripBoms(text) {
    var s = '', i, code;
    for (i = 0; i < text.length; i++) {
      code = text.charCodeAt(i);
      if (code === 0xfeff || code === 0xfffe) continue;
      s += text.charAt(i);
    }
    return s;
  }

  /* The UTF-8 BOM and the two UTF-16 BOMs as they look after a mis-decode.
     EF BB BF read as Latin-1 is the first; FF FE and FE FF are the UTF-16
     pair, which arrive here as two accented capitals and nothing else, because
     the rest of a UTF-16 file is half NUL bytes and a textarea is not a
     reliable channel for those. Recognised and named; not re-decoded.

     Escapes, for the same reason the samples at the bottom of this file are
     escapes, only with more at stake: these three strings are what the
     detector matches on, not a demonstration of it. They were written out as
     literal characters first, which put the byte sequence EF BB BF, mangled
     once, into a file that a tool might well be pointed at. If a save or a
     clipboard ever bent them, the detector would quietly stop finding the one
     thing it is best at finding and nothing on screen would say so. */
  var BOM_GLYPHS = [
    { s: '\u00EF\u00BB\u00BF', what: 'the UTF-8 BOM (EF BB BF) read through a Latin-1 or Windows-1252 decoder' },
    { s: '\u00FF\u00FE', what: 'the UTF-16 little-endian BOM (FF FE) read as two single bytes' },
    { s: '\u00FE\u00FF', what: 'the UTF-16 big-endian BOM (FE FF) read as two single bytes' }
  ];

  function findBomGlyphs(text) {
    var found = [], i, at;
    for (i = 0; i < BOM_GLYPHS.length; i++) {
      at = text.indexOf(BOM_GLYPHS[i].s);
      if (at >= 0) found.push({ at: at, what: BOM_GLYPHS[i].what });
    }
    return found;
  }

  /* ------------------------------------------------------------------
     The diagnosis
     ------------------------------------------------------------------ */

  var state = { stages: [], chain: [], at: 0, findings: [], round1: [],
                truncated: false, ceiling: '', unknownEntities: null };

  function pushStage(label, text, detail) {
    state.stages.push({ label: label, text: text, detail: detail || '' });
  }

  function diagnose(input) {
    var text = input;
    state = { stages: [], chain: [], at: 0, findings: [], round1: [],
              truncated: false, ceiling: '', unknownEntities: null };

    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      state.truncated = true;
    }
    pushStage('As pasted', text, 'nothing applied yet');

    /* U+FFFD first, because it changes how everything below should be read.
       Whatever else is repaired, these positions stay empty. */
    var fffd = [], i;
    for (i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 0xfffd) fffd.push(i);
    }
    if (fffd.length) {
      state.findings.push({
        title: fffd.length + ' replacement ' + (fffd.length === 1 ? 'character' : 'characters') + ' (U+FFFD)',
        verdict: 'LOSSY',
        confidence: 100,
        lines: [
          'Positions: ' + fffd.slice(0, 12).join(', ') + (fffd.length > 12 ? ', …' : ''),
          'A decoder met bytes it could not read and substituted U+FFFD for them.',
          'The original bytes were discarded at that moment, by that decoder, and',
          'are not present in what you pasted. No tool can bring them back — this',
          'one will not pretend to. Go back to the file before that decode ran.'
        ]
      });
    }

    /* Mis-decoded BOMs, named while they are still visible as glyphs. After
       the charset step they turn back into U+FEFF and the reason is harder to
       see, so the note is taken here. */
    var glyphs = findBomGlyphs(text);
    for (i = 0; i < glyphs.length; i++) {
      state.findings.push({
        title: 'Byte order mark, mis-decoded, at index ' + glyphs[i].at,
        verdict: 'REVERSIBLE',
        confidence: 95,
        lines: [
          'What sits at that index is ' + glyphs[i].what + '.',
          'It carries no text. Removing it is safe; it is only there because a',
          'writer stamped it and a reader did not expect it.'
        ]
      });
    }

    /* Entities before charsets. Entity decoding is a pure text transform that
       reveals the characters the charset step then has to look at: text that
       was mangled and then HTML-escaped hides its own mojibake behind
       "&amp;Atilde;" until the entities come off. The reverse order cannot
       work, so it is not offered as an option. */
    var entRounds = 0, entTotal = 0, entUnknown = [], entNumeric = 0, r;
    while (entRounds < MAX_ROUNDS) {
      r = entityRound(text);
      var k;
      for (k = 0; k < r.unknown.length; k++) {
        if (entUnknown.indexOf(r.unknown[k]) < 0 && entUnknown.length < 6) entUnknown.push(r.unknown[k]);
      }
      if (!r.count) break;
      entRounds += 1;
      entTotal += r.count;
      entNumeric += r.numeric;
      text = r.text;
      state.chain.push({
        label: 'Decode HTML entities, round ' + entRounds,
        detail: r.count + ' reference' + (r.count === 1 ? '' : 's') + ' replaced'
      });
      pushStage('HTML entities decoded, round ' + entRounds, text,
                r.count + ' reference' + (r.count === 1 ? '' : 's') + ' replaced');
    }

    /* The loop stops at MAX_ROUNDS whether or not it has finished, and the
       first version stopped silently: nine rounds of "&amp;" nesting came back
       as "x &amp;amp;amp;eacute; y" under a finding that read "each round is
       exactly invertible", with nothing anywhere saying the tool had given up
       three rounds short. A half-done repair presented as a whole one is the
       worst thing a tool like this can hand over, so the ceiling is probed and
       announced. The probe is a wasted pass in the rare case and no work at
       all in the ordinary one, where the loop has already broken out. */
    /* The unknown names were collected and then never shown, which made the
       partial-table limit a claim rather than something the visitor could
       check. They are printed under "what this cannot do" now, where the size
       of the table is already stated, so the limit and the evidence for it sit
       together. "&constructor;" lands here too, which is the visible half of
       the prototype-lookup bug fixed in namedCp. */
    if (entUnknown.length) state.unknownEntities = entUnknown;

    var entLeft = 0;
    if (entRounds === MAX_ROUNDS) entLeft = entityRound(text).count;
    if (entLeft) {
      state.ceiling = 'Entity decoding stopped after ' + MAX_ROUNDS + ' rounds with ' +
        entLeft + ' reference' + (entLeft === 1 ? '' : 's') +
        ' still undecoded. Run the result through again to go further.';
    }

    if (entRounds) {
      state.findings.push({
        title: entRounds > 1
          ? 'HTML entities encoded ' + entRounds + ' times over'
          : 'HTML entities left undecoded',
        verdict: 'REVERSIBLE',
        confidence: entRounds > 1 ? 97 : 92,
        lines: [
          entTotal + ' reference' + (entTotal === 1 ? '' : 's') + ' decoded across ' +
            entRounds + ' round' + (entRounds === 1 ? '' : 's') + '; ' + entNumeric + ' numeric.',
          entRounds > 1
            ? 'Round ' + entRounds + ' only had work to do because an earlier round produced'
            : 'One pass was enough, so the text was escaped exactly once.',
          entRounds > 1
            ? 'text that still looked like markup — an escaper ran over already'
            : 'Entity decoding loses nothing: every reference has one expansion.',
          entRounds > 1
            ? 'escaped text. Nothing is lost: each round is exactly invertible.'
            : ''
        ]
      });
    }

    /* Charset rounds. Every hypothesis is scored every round; the highest
       accepted score wins the round. Two accepted rounds is double encoding,
       and the count is the answer to "how many times did this happen", which
       is worth more than a yes or no. */
    var csRounds = 0, list, best, j, h, applied = [];
    while (csRounds < MAX_ROUNDS) {
      list = [];
      for (j = 0; j < ORDER.length; j++) list.push(wholeText(text, ORDER[j]));
      list.push(runTargeted(text, 'w1252'));
      list.push(runTargeted(text, 'latin1'));
      if (csRounds === 0) state.round1 = list;

      best = null;
      for (j = 0; j < list.length; j++) {
        h = list[j];
        if (h.ok && (!best || h.confidence > best.confidence)) best = h;
      }
      if (!best) break;
      csRounds += 1;
      applied.push(best);
      text = best.text;
      state.chain.push({
        label: (best.mode === 'runs' ? 'Repair damaged runs through ' : 'Re-encode to ') +
               best.label + (best.mode === 'runs' ? '' : ' bytes and decode as UTF-8') +
               ', round ' + csRounds,
        detail: 'confidence ' + best.confidence + '%'
      });
      pushStage('After ' + best.label + ' round ' + csRounds, text, 'confidence ' + best.confidence + '%');
    }

    /* Same ceiling, same probe, same reason. Six rounds of re-encoding is far
       past anything I have seen in real data, but "far past anything I have
       seen" is not a guarantee and the visitor is owed the difference between
       "there was nothing left to do" and "I stopped counting". */
    if (csRounds === MAX_ROUNDS) {
      var more = null;
      for (j = 0; j < ORDER.length; j++) {
        h = wholeText(text, ORDER[j]);
        if (h.ok && (!more || h.confidence > more.confidence)) more = h;
      }
      if (more) {
        state.ceiling = (state.ceiling ? state.ceiling + ' ' : '') +
          'The charset loop also stopped at its ' + MAX_ROUNDS +
          '-round ceiling with another round still on offer (' + more.label +
          ', ' + more.confidence + '%). Run the result through again.';
      }
    }

    for (j = 0; j < applied.length; j++) {
      h = applied[j];
      var lines = [
        h.mode === 'runs'
          ? 'UTF-8 bytes decoded as ' + h.label + ' in ' + h.fixed + ' run' + (h.fixed === 1 ? '' : 's') + ', the rest left alone.'
          : 'The whole text is UTF-8 bytes that were decoded as ' + h.label + '.',
        'Damage count ' + h.before + ' → ' + h.after + '. Round ' + (j + 1) + ' of ' + applied.length + '.'
      ];
      /* Right-aligned in two columns. A "+0" row is the one that matters most
         — it is the component that earned nothing — and left-aligning it put
         the only bad news in the breakdown half a character out of the stack.

         The cap gets its own row when it bites. A perfect whole-text repair
         scores 25 + 35 + 30 + 10, and a column that adds to 100 under a
         headline reading 99% is exactly the sort of thing this page tells
         people to go and check. So the missing point is shown being taken. */
      var p, pts, raw = 0, n;
      for (p = 0; p < h.parts.length; p++) {
        n = Math.round(h.parts[p].points);
        raw += n;
        pts = String(n);
        lines.push('  ' + (pts.length < 2 ? ' ' : '') + '+' + pts + '  ' + h.parts[p].text);
      }
      if (raw !== h.confidence) {
        pts = String(raw - h.confidence);
        lines.push('  ' + (pts.length < 2 ? ' ' : '') + '-' + pts +
                   '  the cap: one wrong-decode story explaining every byte is the most');
        lines.push('       this can ever be, and that is worth 99, not 100.');
      }
      if (h.slots) {
        lines.push('Bytes in the five undefined cp1252 slots: ' + h.slots.join(', ') + '.');
        lines.push('Reversible here only because a browser follows the WHATWG table and');
        lines.push('keeps 0x81 0x8D 0x8F 0x90 0x9D as C1 controls. A strict cp1252 has no');
        lines.push('character for them and may have dropped the byte instead — if that is');
        lines.push('what happened upstream, the sequence is gone and this repair is a guess.');
      }
      if (h.mode === 'runs') {
        if (h.touched.length) {
          lines.push('Runs repaired:');
          for (p = 0; p < h.touched.length; p++) lines.push('  ' + h.touched[p]);
          if (h.touchedMore > 0) {
            lines.push('  and ' + h.touchedMore + ' more, not listed — the list stops at five.');
          }
        }
        if (h.refused.length) {
          lines.push('Runs left untouched:');
          for (p = 0; p < h.refused.length; p++) lines.push('  ' + h.refused[p]);
          if (h.refusedMore > 0) {
            lines.push('  and ' + h.refusedMore + ' more, not listed — the list stops at five.');
          }
          lines.push('A run that will not decode is usually a run that was never damaged:');
          lines.push('a lone E9 is a correct Latin-1 "e-acute" and not the start of anything.');
        }
        lines.push('The run boundaries above were chosen by this tool, not observed in the');
        lines.push('text. That is the weakness of this mode and the reason it caps at 90');
        lines.push('where a whole-text round trip reaches 99: check the boundaries yourself.');
      }
      state.findings.push({
        title: (h.mode === 'runs' ? 'Partial ' : '') + 'UTF-8 read as ' + h.label +
               (applied.length > 1 ? ', round ' + (j + 1) : ''),
        verdict: 'REVERSIBLE',
        confidence: h.confidence,
        lines: lines
      });
    }

    if (applied.length > 1) {
      state.findings.push({
        title: 'Double encoding — the same mistake applied ' + applied.length + ' times',
        verdict: 'REVERSIBLE',
        confidence: 96,
        lines: [
          'Each round was accepted on its own evidence: re-encode, decode strictly,',
          'check the damage count fell. It fell ' + applied.length + ' times running, which is what',
          'happens when text is repaired-and-re-broken, or written through a broken',
          'pipe twice. In UTF-8 bytes an "e-acute" goes C3 A9, then C3 83 C2 A9, then',
          'C3 83 C6 92 C3 82 C2 A9 if the second pass read Windows-1252, or',
          'C3 83 C2 83 C3 82 C2 A9 if it read Latin-1 — they differ because byte 83',
          'is a florin in one table and a C1 control in the other. Step through the',
          'stages and watch the hex view shrink to match.'
        ]
      });
    }

    /* BOMs last, once the charset work has turned any mis-decoded ones back
       into real U+FEFF characters. */
    var boms = findBoms(text);
    if (boms.length) {
      var leading = boms[0].at === 0;
      var interior = [];
      for (i = 0; i < boms.length; i++) if (boms[i].at !== 0) interior.push(boms[i].at);
      text = stripBoms(text);
      state.chain.push({
        label: 'Remove ' + boms.length + ' byte order mark' + (boms.length === 1 ? '' : 's'),
        detail: leading ? 'one at offset 0' + (interior.length ? ', ' + interior.length + ' inside' : '')
                        : interior.length + ' inside the text'
      });
      pushStage('Byte order marks removed', text, boms.length + ' removed');
      state.findings.push({
        title: boms.length + ' byte order mark' + (boms.length === 1 ? '' : 's') + ' in the text',
        verdict: 'REVERSIBLE',
        confidence: 94,
        lines: [
          'Offsets: ' + boms.slice(0, 12).map(function (b) { return b.at + ' (' + uPlus(b.cp) + ')'; }).join(', ') +
            (boms.length > 12 ? ', …' : '') + '.',
          leading ? 'One sits at offset 0, which is the ordinary and mostly harmless kind.'
                  : 'None is at offset 0.',
          interior.length
            ? 'The ' + interior.length + ' inside the text ' + (interior.length === 1 ? 'is' : 'are') +
              ' the interesting one' + (interior.length === 1 ? '' : 's') + ': a BOM only lands'
            : 'A BOM carries no text and no encoding guarantee, only a hint.',
          interior.length
            ? 'mid-file when something concatenated two files byte-for-byte without'
            : 'It is safe to remove and nothing in the text depends on it.',
          interior.length ? 'looking at them. That is the bug; this is only its fingerprint.' : ''
        ]
      });
    }

    if (!state.findings.length) {
      state.findings.push({
        title: 'No damage this tool can name',
        verdict: 'CLEAN, as far as these seven checks go',
        confidence: 0,
        lines: [
          'Nothing here matched. That is not the same as "the text is correct":',
          'it means none of the seven patterns below explains it. Damage that',
          'produces plausible text — a transliteration, a truncation, a decode',
          'that landed on real letters — leaves no signature to find.'
        ]
      });
    }

    return text;
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */

  function hexDump(bytes) {
    var lines = [], i, j, row, gutter, b, n = Math.min(bytes.length, HEX_BYTES);
    for (i = 0; i < n; i += 16) {
      row = '';
      gutter = '';
      for (j = 0; j < 16; j++) {
        if (i + j < n) {
          b = bytes[i + j];
          row += hex(b, 2) + ' ';
          gutter += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.';
        } else {
          row += '   ';
        }
        if (j === 7) row += ' ';
      }
      lines.push(hex(i, 8) + '  ' + row + ' |' + gutter + '|');
    }
    if (bytes.length > n) {
      lines.push('');
      lines.push('… ' + (bytes.length - n) + ' more bytes not drawn (the view stops at ' +
                 HEX_BYTES + ').');
    }
    if (!bytes.length) lines.push('(empty)');
    return lines.join('\n');
  }

  function renderReport(input, finalText) {
    var inBytes = utf8Encode(input);
    var outBytes = utf8Encode(finalText);
    var i, j, f;

    out.clear();
    out.heading('Mojibake diagnosis');
    out.row('input', input.length + ' characters, ' + inBytes.length + ' UTF-8 bytes');
    out.row('after repair', finalText.length + ' characters, ' + outBytes.length + ' UTF-8 bytes');
    out.row('steps proposed', String(state.chain.length));
    if (state.truncated) {
      out.warn('Input was longer than ' + MAX_CHARS + ' characters and was cut there.');
    }
    if (state.ceiling) out.warn(state.ceiling);
    out.rule();

    out.heading('Findings');
    for (i = 0; i < state.findings.length; i++) {
      f = state.findings[i];
      out.line('');
      out.line((i + 1) + '. ' + f.title, f.verdict === 'LOSSY' ? 't-err' : 't-info');
      out.row('   reversible?', f.verdict, f.verdict === 'LOSSY' ? 't-err' : 't-ok');
      if (f.confidence) out.row('   confidence', f.confidence + '%');
      for (j = 0; j < f.lines.length; j++) {
        if (f.lines[j]) out.dim('   ' + f.lines[j]);
      }
    }

    out.line('');
    out.rule();
    out.heading('Every charset hypothesis, scored — first round');
    out.dim('Each one is a real attempt on the text as it stands after any entity');
    out.dim('decoding: encode it back to that charset, decode those bytes as strict');
    out.dim('UTF-8, then check that the damage count actually fell.');
    out.line('');
    for (i = 0; i < state.round1.length; i++) {
      var h = state.round1[i];
      var name = h.label + (h.mode === 'runs' ? ', run-targeted' : ', whole text');
      if (h.ok) out.line('  ' + pad(name, 27) + h.confidence + '%  accepted', 't-ok');
      else out.line('  ' + pad(name, 27) + 'rejected — ' + (h.why || 'no reason recorded'), 't-dim');
    }
    if (!state.round1.length) out.dim('  (no charset round ran — nothing reached that stage)');

    out.line('');
    out.rule();
    out.heading('Repair chain');
    if (!state.chain.length) {
      out.dim('Nothing to apply.');
    } else {
      for (i = 0; i < state.chain.length; i++) {
        out.line('  ' + (i + 1) + '. ' + state.chain[i].label + ' — ' + state.chain[i].detail);
      }
      out.line('');
      out.dim('Use "Apply next step" to walk them one at a time and watch the bytes');
      out.dim('under each stage. Nothing is applied to your input until you do.');
    }

    out.line('');
    out.rule();
    out.heading('What this cannot do');
    out.dim('Four charsets are tried and named: Windows-1252, ISO-8859-1, CP437,');
    out.dim('KOI8-R. Anything else is not detected, and no attempt is made to guess');
    out.dim('the original charset of text that was never UTF-8.');
    out.dim('U+FFFD is never repaired. The bytes are already gone.');
    out.dim('The named-entity table holds ' + NAMED_COUNT + ' names, not the full HTML5 set of');
    out.dim('roughly 2200. Numeric references are complete.');
    if (state.unknownEntities) {
      out.dim('Names in your text it did not recognise, and therefore left exactly as');
      out.dim('they were (the first six only): &' + state.unknownEntities.join('; &') + ';');
    }
    out.dim('A UTF-16 file is recognised by its BOM and not re-decoded: a textarea');
    out.dim('is not a reliable channel for the NUL bytes half of it consists of.');
    out.dim('Entity and charset repair both stop after ' + MAX_ROUNDS + ' rounds. If either');
    out.dim('ceiling is reached with work still to do, it is said above, not hidden.');
    out.dim('A charset confidence is a score over four measured signals, printed');
    out.dim('above so you can disagree with it. It is not a proof and it caps at 99:');
    out.dim('one wrong-decode story explaining every byte is not the same as knowing');
    out.dim('what the author typed. A finding that is an observation rather than a');
    out.dim('hypothesis — a replacement character is on the page or it is not — is');
    out.dim('the one kind recorded at 100.');
  }

  function renderChain() {
    var list = document.getElementById('tool-chain');
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var i, li, tag;
    for (i = 0; i < state.chain.length; i++) {
      li = document.createElement('li');
      if (i < state.at) tag = 'applied';
      else if (i === state.at) tag = 'next to apply';
      else tag = 'not yet applied';
      li.textContent = state.chain[i].label + ' — ' + state.chain[i].detail + ' — ' + tag;
      li.className = i < state.at ? 'mjb-done' : (i === state.at ? 'mjb-next' : 'mjb-later');
      list.appendChild(li);
    }
    if (!state.chain.length) {
      li = document.createElement('li');
      li.textContent = 'No repair step was proposed.';
      list.appendChild(li);
    }
  }

  function renderStage() {
    var stage = state.stages[state.at] || { label: '—', text: '', detail: '' };
    var status = document.getElementById('tool-stage');
    var field = document.getElementById('tool-text');
    var pane = document.getElementById('tool-hex');
    var bytes = utf8Encode(stage.text);

    if (status) {
      status.textContent = 'Stage ' + state.at + ' of ' + (state.stages.length - 1) + ' — ' +
        stage.label + (stage.detail ? ' (' + stage.detail + ')' : '') +
        ' — ' + stage.text.length + ' characters, ' + bytes.length + ' UTF-8 bytes';
    }
    if (field) field.value = stage.text;
    if (pane) pane.textContent = hexDump(bytes);

    var step = document.getElementById('tool-step');
    var all = document.getElementById('tool-all');
    var done = state.at >= state.stages.length - 1;
    if (step) step.disabled = done;
    if (all) all.disabled = done;
  }

  function renderAll() {
    renderChain();
    renderStage();
    var result = document.getElementById('tool-result');
    if (result) result.value = state.stages.length ? state.stages[state.stages.length - 1].text : '';
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  /* run() is called bare from the button and from Ctrl+Enter, so anything that
     escapes it lands in the console where the visitor will never see it — and
     renderReport starts with out.clear(), so a throw halfway down would leave
     a wiped pane and no explanation. This tool is fed deliberately broken text
     by definition. Whatever printed before the throw stays on screen and the
     message is appended under it. */
  function run() {
    var field = document.getElementById('tool-in');
    var text = field ? field.value : '';
    if (!text) {
      out.clear();
      out.warn('Paste some broken text first, or pick one of the examples.');
      return;
    }
    try {
      var repaired = diagnose(text);
      state.at = 0;
      renderReport(text, repaired);
      renderAll();
    } catch (err) {
      out.rule();
      out.err('Could not finish the diagnosis of that text.');
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
    }
  }

  /* Every character above ASCII in these examples is a \u escape, and that is
     not fussiness. The first draft stored them as literal text and the first
     example lost a character on the way to disk: the closing curly quote
     U+201D encodes to E2 80 9D, and 0x9D reads as an invisible C1 control,
     which vanished. What was left ended "â€," — three bytes short of anything
     that decodes — so the example built to demonstrate the classic repair was
     the one input the tool could not repair.

     A file about mojibake that keeps its own examples as literal high
     characters is one careless save away from being its own bug report. These
     are escapes so that no editor, no clipboard and no re-encode can touch
     them, and so that the intended bytes are readable in the source. */
  var SAMPLES = [
    {
      name: 'The classic \u2014 UTF-8 read as Windows-1252',
      text: 'Caf\u00C3\u00A9 \u00E2\u20AC\u201D \u00C2\u00A34.50 for the ' +
            '\u00E2\u20AC\u0153house blend\u00E2\u20AC\u009D, and that\u00E2\u20AC\u2122s before tax.'
    },
    {
      name: 'Double encoded \u2014 the same mistake, twice',
      text: 'Caf\u00C3\u0192\u00C2\u00A9 \u00C3\u00A2\u00E2\u201A\u00AC\u00E2\u20AC\u009D ' +
            '\u00C3\u201A\u00C2\u00A34.50, exported, re-imported, exported again.'
    },
    {
      name: 'Stray BOMs \u2014 one leading, one from a concatenation',
      text: '\uFEFFid,name,note\n1,Ada,fine\n' +
            '\u00EF\u00BB\u00BFid,name,note\n2,Grace,also fine'
    },
    {
      name: 'Double-encoded HTML entities',
      text: 'Caf&amp;eacute; &amp;mdash; 50&amp;#37; off &amp;amp; ' +
            'free delivery &amp;#8212; today only'
    },
    {
      name: 'Mixed \u2014 entities plus half-repaired UTF-8',
      text: 'Row 1: Caf&amp;eacute;\nRow 2: Caf\u00C3\u00A9\n' +
            'Row 3: Caf\u00E9 (this one was always fine)'
    },
    {
      name: 'UTF-8 read as CP437 \u2014 a DOS-era export',
      text: 'Caf\u251C\u2310 \u0393\u00C7\u00F6 \u252C\u00FA4.50 out of a console ' +
            'still on the old code page'
    },
    {
      name: 'UTF-8 read as KOI8-R \u2014 an old mailbox',
      text: 'Caf\u0446\u2558 \u0411\u2500\u25A0 \u0431\u04514.50 out of a KOI8-R ' +
            'mailbox, the rarer one'
    },
    {
      name: 'Already destroyed \u2014 replacement characters',
      text: 'The na\uFFFDve r\uFFFDsum\uFFFD came back from the importer like this.'
    }
  ];

  LabTool.define({
    id: 'mojibake',
    run: run,
    onReady: function () {
      var field = document.getElementById('tool-in');
      var select = document.getElementById('tool-sample');
      var i, opt;

      if (select) {
        for (i = 0; i < SAMPLES.length; i++) {
          opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = SAMPLES[i].name;
          select.appendChild(opt);
        }
        select.addEventListener('change', function () {
          var idx = parseInt(select.value, 10);
          if (isNaN(idx) || !SAMPLES[idx] || !field) return;
          field.value = SAMPLES[idx].text;
          select.selectedIndex = 0;
          run();
        });
      }

      var step = document.getElementById('tool-step');
      if (step) {
        step.addEventListener('click', function () {
          if (state.at < state.stages.length - 1) { state.at += 1; renderAll(); }
        });
      }
      var all = document.getElementById('tool-all');
      if (all) {
        all.addEventListener('click', function () {
          state.at = Math.max(0, state.stages.length - 1);
          renderAll();
        });
      }
      var reset = document.getElementById('tool-reset');
      if (reset) {
        reset.addEventListener('click', function () {
          state.at = 0;
          renderAll();
        });
      }

      pushStage('Nothing loaded', '', '');
      renderAll();

      out.dim('Paste text that came out wrong, or pick an example, then press');
      out.dim('Diagnose. Every hypothesis is scored and every score is broken down.');
      out.dim('Nothing is uploaded; the tables and the decoder are in this file.');
    }
  });
})();

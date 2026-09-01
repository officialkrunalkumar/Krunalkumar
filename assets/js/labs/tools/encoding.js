/* ==========================================================================
   encoding.js — the conversions that come up constantly in security work.
   --------------------------------------------------------------------------
   Base64 and hex are not encryption, and the single most useful thing this
   page can do is make that obvious: everything here is reversible by anyone,
   with no key. Data "protected" by base64 is not protected at all, and seeing
   it flip back and forth in one click is a faster lesson than being told.

   Includes an auto-detect pass, because in practice you are usually handed a
   blob of something and have to work out what it is first.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');
  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBytes(text) {
    var bin = atob(String(text).replace(/\s+/g, ''));
    var b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function toBase32(bytes) {
    var bits = 0, value = 0, output = '';
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { output += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) output += B32[(value << (5 - bits)) & 31];
    while (output.length % 8) output += '=';
    return output;
  }
  function fromBase32(text) {
    // Whitespace first, THEN padding: a pasted block ends "===\n", and stripping
    // the padding before the newline leaves the '=' in place for the loop below,
    // which now refuses it instead of quietly skipping it.
    var clean = String(text).toUpperCase().replace(/\s+/g, '').replace(/=+$/, '');
    var bits = 0, value = 0, out = [], idx;
    for (var i = 0; i < clean.length; i++) {
      idx = B32.indexOf(clean[i]);
      // This used to `continue`, which is how "hello!!!" came back as three
      // bytes of garbage under a confident "Result — 3 characters" heading.
      // Base32's alphabet excludes 0, 1, 8 and 9 on purpose, so a character
      // outside it means the input is not Base32 — the same reasoning, and the
      // same wording, as fromBase58 below.
      if (idx === -1) throw new Error('"' + clean[i] + '" is not a Base32 character');
      value = (value << 5) | idx; bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return new Uint8Array(out);
  }

  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function toBase58(bytes) {
    var digits = [0];
    for (var i = 0; i < bytes.length; i++) {
      var carry = bytes[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    var out = '';
    for (var k = 0; k < bytes.length && bytes[k] === 0; k++) out += '1';
    /* `digits` is seeded with a single 0 so the carry loop has somewhere to
       start, and that seed is only a real digit once the value is non-zero.
       Emitting it unconditionally put an extra '1' in front of everything
       whose value is zero, and in Base58 a leading '1' IS a zero byte — so
       the empty input encoded to "1" and decoded back to a NUL character,
       and a single 0x00 byte encoded to "11" and came back as two of them.
       The loop above already represents those bytes; this must not repeat
       them. */
    var isZero = digits.length === 1 && digits[0] === 0;
    if (!isZero) {
      for (var m = digits.length - 1; m >= 0; m--) out += B58[digits[m]];
    }
    return out;
  }
  function fromBase58(text) {
    var clean = String(text).replace(/\s+/g, '');
    var bytes = [];
    for (var i = 0; i < clean.length; i++) {
      var val = B58.indexOf(clean[i]);
      // 0, O, I and l are absent from the alphabet on purpose, so a character
      // outside it means this is not Base58 rather than a typo worth guessing.
      if (val === -1) throw new Error('"' + clean[i] + '" is not a Base58 character');
      var carry = val;
      // bytes[] is a little-endian accumulator: multiply by 58, add the digit.
      // Peak carry is (255 * 58 + carry) >> 8, which settles at 57 — nowhere
      // near the 32-bit limit, so plain arithmetic is safe here.
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
    }
    // A leading '1' encodes a leading zero byte — that is how the version byte
    // at the front of a Bitcoin address survives the round trip.
    for (var z = 0; z < clean.length && clean[z] === '1'; z++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  /* Binary and decimal decode to BYTES, not to a string.

     The encoders produce UTF-8 (`enc.encode(text)`), but the decoders used to
     reassemble with String.fromCharCode, which reads each byte as a UTF-16 code
     unit. That is not the inverse of UTF-8: "café" round-tripped to "cafÃ©",
     "નમસ્તે" and "😀" came back as mojibake, and nothing said so. Returning
     bytes lets convert() put them through the same TextDecoder every other
     decode mode already uses, which makes the round trip exact — and drops the
     String.fromCharCode.apply spread, which throws RangeError on a long input.

     They also refuse a token that is not a byte. parseInt('abc', 2) is NaN and
     String.fromCharCode(NaN) is U+0000, so "hello world" in Decimal → text used
     to produce two NUL characters and call them a result. */
  function binToBytes(text) {
    var clean = String(text).trim();
    if (!clean) return new Uint8Array(0);
    var tokens = clean.split(/\s+/);
    // One unbroken run of bits is exactly what detect() calls "binary", so cut
    // it into bytes rather than rejecting the shape this page has just told the
    // visitor it is looking at.
    if (tokens.length === 1 && /^[01]+$/.test(tokens[0]) && tokens[0].length % 8 === 0) {
      tokens = tokens[0].match(/.{8}/g);
    }
    var bytes = new Uint8Array(tokens.length);
    for (var i = 0; i < tokens.length; i++) {
      if (!/^[01]{1,8}$/.test(tokens[i])) {
        throw new Error('"' + tokens[i] + '" is not a binary byte — expected up to eight 0s and 1s');
      }
      bytes[i] = parseInt(tokens[i], 2);
    }
    return bytes;
  }

  function decToBytes(text) {
    var clean = String(text).trim();
    if (!clean) return new Uint8Array(0);
    var tokens = clean.split(/\s+/);
    var bytes = new Uint8Array(tokens.length);
    for (var i = 0; i < tokens.length; i++) {
      if (!/^\d{1,3}$/.test(tokens[i]) || Number(tokens[i]) > 255) {
        throw new Error('"' + tokens[i] + '" is not a byte value — expected 0 to 255');
      }
      bytes[i] = Number(tokens[i]);
    }
    return bytes;
  }

  var MORSE = { A:'.-',B:'-...',C:'-.-.',D:'-..',E:'.',F:'..-.',G:'--.',H:'....',
    I:'..',J:'.---',K:'-.-',L:'.-..',M:'--',N:'-.',O:'---',P:'.--.',Q:'--.-',
    R:'.-.',S:'...',T:'-',U:'..-',V:'...-',W:'.--',X:'-..-',Y:'-.--',Z:'--..',
    '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....',
    '6':'-....','7':'--...','8':'---..','9':'----.' };

  function detect(text) {
    var t = String(text).trim();
    var guesses = [];
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(t) && t.length % 4 === 0 && t.length > 3)
      guesses.push('base64');
    if (/^[A-Za-z0-9\-_]+={0,2}$/.test(t) && /[-_]/.test(t)) guesses.push('base64url');
    if (/^[0-9a-fA-F\s]+$/.test(t) && t.replace(/\s/g, '').length % 2 === 0)
      guesses.push('hex');
    if (/^[A-Z2-7=]+$/.test(t.toUpperCase()) && t.length % 8 === 0) guesses.push('base32');
    if (/%[0-9a-fA-F]{2}/.test(t)) guesses.push('URL-encoded');
    if (/&(amp|lt|gt|quot|#\d+);/.test(t)) guesses.push('HTML entities');
    if (/^[.\-\s/]+$/.test(t)) guesses.push('morse');
    if (/^[01\s]+$/.test(t) && t.replace(/\s/g, '').length % 8 === 0) guesses.push('binary');
    if (/^\{|\[/.test(t)) guesses.push('JSON');
    return guesses;
  }

  function convert(text, mode) {
    var bytes;
    switch (mode) {
      case 'b64-enc':  return bytesToB64(enc.encode(text));
      case 'b64-dec':  return dec.decode(b64ToBytes(text));
      case 'b64url-enc':
        return bytesToB64(enc.encode(text)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      case 'b64url-dec': {
        var s = text.replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        return dec.decode(b64ToBytes(s));
      }
      case 'hex-enc':  return LabTool.toHex(enc.encode(text));
      case 'hex-dec':  return dec.decode(LabTool.fromHex(text, true));
      case 'b32-enc':  return toBase32(enc.encode(text));
      case 'b32-dec':  return dec.decode(fromBase32(text));
      case 'b58-enc':  return toBase58(enc.encode(text));
      case 'b58-dec':  return dec.decode(fromBase58(text));
      case 'url-enc':  return encodeURIComponent(text);
      case 'url-dec':  return decodeURIComponent(text);
      case 'html-enc': return LabTool.escapeHtml(text);
      case 'html-dec': {
        var d = document.createElement('textarea');
        d.innerHTML = text;
        return d.value;
      }
      case 'bin-enc':
        bytes = enc.encode(text);
        return Array.from(bytes).map(function (b) {
          return ('0000000' + b.toString(2)).slice(-8);
        }).join(' ');
      case 'bin-dec':  return dec.decode(binToBytes(text));
      case 'dec-enc':
        return Array.from(enc.encode(text)).join(' ');
      case 'dec-dec':  return dec.decode(decToBytes(text));
      case 'morse-enc':
        return text.toUpperCase().split('').map(function (c) {
          if (c === ' ') return '/';
          return MORSE[c] || '';
        }).filter(Boolean).join(' ');
      case 'morse-dec': {
        var rev = {};
        Object.keys(MORSE).forEach(function (k) { rev[MORSE[k]] = k; });
        return text.trim().split(/\s+/).map(function (c) {
          return c === '/' ? ' ' : (rev[c] || '');
        }).join('');
      }
      case 'json-pretty': return JSON.stringify(JSON.parse(text), null, 2);
      case 'json-min':    return JSON.stringify(JSON.parse(text));
      default: return text;
    }
  }

  function run() {
    var text = document.getElementById('tool-text').value;
    var mode = document.getElementById('tool-mode').value;
    out.clear();
    if (!text) { out.warn('Type or paste something above.'); return; }

    var guesses = detect(text);
    if (guesses.length) {
      out.dim('looks like: ' + guesses.join(', '));
      out.rule();
    }

    try {
      var result = convert(text, mode);
      out.heading('Result — ' + result.length + ' characters');
      out.line(result);
      document.getElementById('tool-result').value = result;
    } catch (err) {
      out.err('Could not convert: ' + (err && err.message ? err.message : err));
      out.dim('That usually means the input is not valid for the chosen mode —');
      out.dim('the detection line above is a better guide than the dropdown.');
      return;
    }

    if (/^(b64|hex|b32|b58|url|bin|dec|morse)/.test(mode)) {
      out.rule();
      out.warn('None of this is encryption. Every conversion here is reversible');
      out.warn('by anyone, with no key — encoding changes the alphabet, not the');
      out.warn('secrecy. If data needs protecting, it needs a cipher and a key.');
    }
  }

  LabTool.define({
    id: 'encodingtool',
    run: run,
    onReady: function () {
      document.getElementById('tool-swap').addEventListener('click', function () {
        var box = document.getElementById('tool-text');
        var res = document.getElementById('tool-result');
        if (res.value) { box.value = res.value; res.value = ''; run(); }
      });
      out.dim('Paste anything and press Run. The detector will say what it');
      out.dim('probably is before you pick a mode.');
    }
  });
})();

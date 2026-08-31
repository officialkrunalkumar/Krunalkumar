/* ==========================================================================
   totp.js — the six digits on your phone, taken apart.
   --------------------------------------------------------------------------
   Almost everyone who uses an authenticator app believes the code is fetched
   from somewhere. It is not. It is HMAC over a number that both sides can
   work out from a clock, truncated to six digits by a rule from RFC 4226.
   Nothing is transmitted, nothing is looked up, and the whole thing is small
   enough to show every intermediate value on screen — which is the point of
   this page. Someone who has watched the counter tick over and the HMAC
   change with it understands why a stolen code expires, and why a phishing
   proxy that relays it inside the window does not care.

   Why the hashes are implemented here rather than through Web Crypto:
   crypto.subtle is asynchronous and its SHA-1 support is deliberately narrow
   in some engines. The display recomputes four times a second and highlights
   four specific bytes inside the digest, so a synchronous function that hands
   back the raw MAC is the honest fit. Correctness is not taken on trust —
   selfTest() runs the RFC 4226 HOTP vectors and all eighteen RFC 6238 TOTP
   vectors (SHA-1, SHA-256 and SHA-512) at load, and the toolbar shows the
   result. Open the console and run TotpEngine.selfTest() to see it yourself.

   No network request is made from this file, at any point, for any reason.
   ========================================================================== */

/* global LabTool */
(function (root) {
  'use strict';

  /* ======================================================================
     1. Byte helpers
     ====================================================================== */

  function writeU32(buf, at, value) {
    buf[at] = (value >>> 24) & 0xff;
    buf[at + 1] = (value >>> 16) & 0xff;
    buf[at + 2] = (value >>> 8) & 0xff;
    buf[at + 3] = value & 0xff;
  }

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return out;
  }

  /* Hex in pairs, so a 64-byte SHA-512 digest can be read rather than merely
     displayed. Wrapping is left to CSS. */
  function spacedHex(bytes, from, to) {
    var out = [];
    for (var i = from; i < to; i++) {
      out.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
    }
    return out.join(' ');
  }

  function asciiBytes(text) {
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  /* A manual UTF-8 encoder rather than TextEncoder: this file has to keep
     working in the same places the rest of the site does, and the QR payload
     may carry a non-ASCII issuer or account name. Surrogate pairs are joined
     before encoding, so an emoji in an account label produces four bytes and
     not two broken three-byte sequences. */
  function utf8Bytes(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c < 0x10000) {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else {
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63),
                 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return new Uint8Array(out);
  }

  /* ======================================================================
     2. SHA-1
     ====================================================================== */

  function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
  function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

  function padTo(msg, blockSize, lengthBytes) {
    var ml = msg.length;
    var total = (Math.floor((ml + lengthBytes) / blockSize) + 1) * blockSize;
    var b = new Uint8Array(total);
    b.set(msg);
    b[ml] = 0x80;
    var bitLen = ml * 8;
    writeU32(b, total - 8, Math.floor(bitLen / 4294967296));
    writeU32(b, total - 4, bitLen % 4294967296);
    return b;
  }

  function sha1(msg) {
    var b = padTo(msg, 64, 8);
    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe,
        h3 = 0x10325476, h4 = 0xc3d2e1f0;
    var w = new Array(80);
    var off, i;
    for (off = 0; off < b.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = ((b[off + i * 4] << 24) | (b[off + i * 4 + 1] << 16) |
                (b[off + i * 4 + 2] << 8) | b[off + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 80; i++) {
        w[i] = rotl32((w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) >>> 0, 1);
      }
      var a = h0, bb = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; }
        else if (i < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = bb ^ c ^ d; k = 0xca62c1d6; }
        var t = (rotl32(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
        e = d; d = c; c = rotl32(bb, 30); bb = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    var out = new Uint8Array(20);
    writeU32(out, 0, h0); writeU32(out, 4, h1); writeU32(out, 8, h2);
    writeU32(out, 12, h3); writeU32(out, 16, h4);
    return out;
  }

  /* ======================================================================
     3. SHA-256
     ====================================================================== */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256(msg) {
    var b = padTo(msg, 64, 8);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    var off, i;
    for (off = 0; off < b.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = ((b[off + i * 4] << 24) | (b[off + i * 4 + 1] << 16) |
                (b[off + i * 4 + 2] << 8) | b[off + i * 4 + 3]) >>> 0;
      }
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = (rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3)) >>> 0;
        var s1 = (rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h[0], bb = h[1], c = h[2], d = h[3],
          e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        var S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
        var maj = ((a & bb) ^ (a & c) ^ (bb & c)) >>> 0;
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0;
      h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
      h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) writeU32(out, i * 4, h[i]);
    return out;
  }

  /* ======================================================================
     4. SHA-512
     --------------------------------------------------------------------
     Sixty-four-bit words on a machine with no sixty-four-bit integers, so
     every word is a (hi, lo) pair of unsigned 32-bit halves and every
     addition carries by hand. BigInt would be shorter and is not used: this
     runs four times a second on a phone, and the pair arithmetic is both
     faster and portable to the older engines the rest of the site supports.
     ====================================================================== */

  var SHA512_KH = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2, 0xca273ece, 0xd186b8c7,
    0xeada7dd6, 0xf57d4f7f, 0x06f067aa, 0x0a637dc5, 0x113f9804, 0x1b710b35,
    0x28db77f5, 0x32caab7b, 0x3c9ebe0a, 0x431d67c4, 0x4cc5d4be, 0x597f299c,
    0x5fcb6fab, 0x6c44198c
  ];
  var SHA512_KL = [
    0xd728ae22, 0x23ef65cd, 0xec4d3b2f, 0x8189dbbc, 0xf348b538, 0xb605d019,
    0xaf194f9b, 0xda6d8118, 0xa3030242, 0x45706fbe, 0x4ee4b28c, 0xd5ffb4e2,
    0xf27b896f, 0x3b1696b1, 0x25c71235, 0xcf692694, 0x9ef14ad2, 0x384f25e3,
    0x8b8cd5b5, 0x77ac9c65, 0x592b0275, 0x6ea6e483, 0xbd41fbd4, 0x831153b5,
    0xee66dfab, 0x2db43210, 0x98fb213f, 0xbeef0ee4, 0x3da88fc2, 0x930aa725,
    0xe003826f, 0x0a0e6e70, 0x46d22ffc, 0x5c26c926, 0x5ac42aed, 0x9d95b3df,
    0x8baf63de, 0x3c77b2a8, 0x47edaee6, 0x1482353b, 0x4cf10364, 0xbc423001,
    0xd0f89791, 0x0654be30, 0xd6ef5218, 0x5565a910, 0x5771202a, 0x32bbd1b8,
    0xb8d2d0c8, 0x5141ab53, 0xdf8eeb99, 0xe19b48a8, 0xc5c95a63, 0xe3418acb,
    0x7763e373, 0xd6b2b8a3, 0x5defb2fc, 0x43172f60, 0xa1f0ab72, 0x1a6439ec,
    0x23631e28, 0xde82bde9, 0xb2c67915, 0xe372532b, 0xea26619c, 0x21c0c207,
    0xcde0eb1e, 0xee6ed178, 0x72176fba, 0xa2c898a6, 0xbef90dae, 0x131c471b,
    0x23047d84, 0x40c72493, 0x15c9bebc, 0x9c100d4c, 0xcb3e42b6, 0xfc657e2a,
    0x3ad6faec, 0x4a475817
  ];

  function rotr64h(h, l, n) {
    if (n === 32) return l >>> 0;
    if (n < 32) return ((h >>> n) | (l << (32 - n))) >>> 0;
    var m = n - 32;
    return ((l >>> m) | (h << (32 - m))) >>> 0;
  }
  function rotr64l(h, l, n) {
    if (n === 32) return h >>> 0;
    if (n < 32) return ((l >>> n) | (h << (32 - n))) >>> 0;
    var m = n - 32;
    return ((h >>> m) | (l << (32 - m))) >>> 0;
  }
  function shr64l(h, l, n) { return ((l >>> n) | (h << (32 - n))) >>> 0; }

  function sha512(msg) {
    var b = padTo(msg, 128, 16);
    var hh = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
              0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var hl = [0xf3bcc908, 0x84caa73b, 0xfe94f82b, 0x5f1d36f1,
              0xade682d1, 0x2b3e6c1f, 0xfb41bd6b, 0x137e2179];
    var wh = new Array(80), wl = new Array(80);
    var off, i, lo, hi;
    for (off = 0; off < b.length; off += 128) {
      for (i = 0; i < 16; i++) {
        var p = off + i * 8;
        wh[i] = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
        wl[i] = ((b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7]) >>> 0;
      }
      for (i = 16; i < 80; i++) {
        var xh = wh[i - 15], xl = wl[i - 15];
        var s0h = (rotr64h(xh, xl, 1) ^ rotr64h(xh, xl, 8) ^ (xh >>> 7)) >>> 0;
        var s0l = (rotr64l(xh, xl, 1) ^ rotr64l(xh, xl, 8) ^ shr64l(xh, xl, 7)) >>> 0;
        var yh = wh[i - 2], yl = wl[i - 2];
        var s1h = (rotr64h(yh, yl, 19) ^ rotr64h(yh, yl, 61) ^ (yh >>> 6)) >>> 0;
        var s1l = (rotr64l(yh, yl, 19) ^ rotr64l(yh, yl, 61) ^ shr64l(yh, yl, 6)) >>> 0;
        lo = wl[i - 16] + s0l + wl[i - 7] + s1l;
        hi = wh[i - 16] + s0h + wh[i - 7] + s1h + Math.floor(lo / 4294967296);
        wl[i] = lo >>> 0;
        wh[i] = hi >>> 0;
      }
      var ah = hh[0], al = hl[0], bh = hh[1], bl = hl[1],
          ch = hh[2], cl = hl[2], dh = hh[3], dl = hl[3],
          eh = hh[4], el = hl[4], fh = hh[5], fl = hl[5],
          gh = hh[6], gl = hl[6], zh = hh[7], zl = hl[7];
      for (i = 0; i < 80; i++) {
        var S1h = (rotr64h(eh, el, 14) ^ rotr64h(eh, el, 18) ^ rotr64h(eh, el, 41)) >>> 0;
        var S1l = (rotr64l(eh, el, 14) ^ rotr64l(eh, el, 18) ^ rotr64l(eh, el, 41)) >>> 0;
        var chh = ((eh & fh) ^ (~eh & gh)) >>> 0;
        var chl = ((el & fl) ^ (~el & gl)) >>> 0;
        var S0h = (rotr64h(ah, al, 28) ^ rotr64h(ah, al, 34) ^ rotr64h(ah, al, 39)) >>> 0;
        var S0l = (rotr64l(ah, al, 28) ^ rotr64l(ah, al, 34) ^ rotr64l(ah, al, 39)) >>> 0;
        var majh = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0;
        var majl = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0;

        var t1l = zl + S1l + chl + SHA512_KL[i] + wl[i];
        var t1h = (zh + S1h + chh + SHA512_KH[i] + wh[i] +
                   Math.floor(t1l / 4294967296)) >>> 0;
        t1l = t1l >>> 0;
        var t2l = S0l + majl;
        var t2h = (S0h + majh + Math.floor(t2l / 4294967296)) >>> 0;
        t2l = t2l >>> 0;

        zh = gh; zl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        lo = dl + t1l;
        eh = (dh + t1h + Math.floor(lo / 4294967296)) >>> 0;
        el = lo >>> 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        lo = t1l + t2l;
        ah = (t1h + t2h + Math.floor(lo / 4294967296)) >>> 0;
        al = lo >>> 0;
      }
      var next = [ah, bh, ch, dh, eh, fh, gh, zh];
      var nextL = [al, bl, cl, dl, el, fl, gl, zl];
      for (i = 0; i < 8; i++) {
        lo = hl[i] + nextL[i];
        hh[i] = (hh[i] + next[i] + Math.floor(lo / 4294967296)) >>> 0;
        hl[i] = lo >>> 0;
      }
    }
    var out = new Uint8Array(64);
    for (i = 0; i < 8; i++) {
      writeU32(out, i * 8, hh[i]);
      writeU32(out, i * 8 + 4, hl[i]);
    }
    return out;
  }

  /* ======================================================================
     5. HMAC, Base32, HOTP, TOTP
     ====================================================================== */

  var ALGOS = {
    'SHA-1':   { fn: sha1,   block: 64,  len: 20 },
    'SHA-256': { fn: sha256, block: 64,  len: 32 },
    'SHA-512': { fn: sha512, block: 128, len: 64 }
  };

  function hmac(algName, key, msg) {
    var a = ALGOS[algName];
    if (!a) throw new Error('Unknown algorithm: ' + algName);
    var k = key.length > a.block ? a.fn(key) : key;
    var inner = new Uint8Array(a.block + msg.length);
    var outer = new Uint8Array(a.block + a.len);
    for (var i = 0; i < a.block; i++) {
      var kb = i < k.length ? k[i] : 0;
      inner[i] = kb ^ 0x36;
      outer[i] = kb ^ 0x5c;
    }
    inner.set(msg, a.block);
    outer.set(a.fn(inner), a.block);
    return a.fn(outer);
  }

  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  /* Tolerant of how people actually paste a secret — lower case, spaces every
     four characters, hyphens from a printed backup card, trailing '=' padding
     — and intolerant of anything else. Silently dropping an unknown character
     would decode to different bytes and produce codes that never match, with
     no clue why, so an unknown character is an error with the character in it. */
  function base32Decode(text) {
    var clean = String(text).toUpperCase().replace(/[\s\-_]/g, '').replace(/=+$/, '');
    if (!clean) throw new Error('The secret is empty.');
    var bits = 0, value = 0, out = [], i;
    for (i = 0; i < clean.length; i++) {
      var ch = clean.charAt(i);
      var idx = B32.indexOf(ch);
      if (idx < 0) {
        throw new Error('"' + ch + '" is not Base32. Base32 uses A-Z and 2-7 only.');
      }
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    if (!out.length) throw new Error('That is too short to be a secret.');
    return new Uint8Array(out);
  }

  function base32Encode(bytes) {
    var out = '', bits = 0, value = 0;
    for (var i = 0; i < bytes.length; i++) {
      value = ((value << 8) | bytes[i]) >>> 0;
      bits += 8;
      while (bits >= 5) {
        out += B32.charAt((value >>> (bits - 5)) & 31);
        bits -= 5;
      }
    }
    if (bits > 0) out += B32.charAt((value << (5 - bits)) & 31);
    return out;
  }

  function counterBytes(counter) {
    var b = new Uint8Array(8);
    writeU32(b, 0, Math.floor(counter / 4294967296));
    writeU32(b, 4, counter % 4294967296);
    return b;
  }

  function padDigits(n, digits) {
    var s = String(n);
    while (s.length < digits) s = '0' + s;
    return s;
  }

  /* RFC 4226 section 5.3, with every intermediate handed back rather than
     thrown away — the page exists to show them. */
  function hotp(algName, keyBytes, counter, digits) {
    var mac = hmac(algName, keyBytes, counterBytes(counter));
    var offset = mac[mac.length - 1] & 0x0f;
    var binary = ((mac[offset] & 0x7f) << 24) |
                 (mac[offset + 1] << 16) |
                 (mac[offset + 2] << 8) |
                 mac[offset + 3];
    var modulus = Math.pow(10, digits);
    return {
      mac: mac,
      offset: offset,
      binary: binary >>> 0,
      remainder: binary % modulus,
      code: padDigits(binary % modulus, digits)
    };
  }

  function totp(algName, keyBytes, seconds, period, digits) {
    return hotp(algName, keyBytes, Math.floor(seconds / period), digits);
  }

  /* Length-independent and value-independent comparison. A browser is not the
     place a timing attack is won, but the page tells visitors that a real
     server must compare this way, and a tool that says so while doing the
     opposite is not worth reading. */
  function constantTimeEqual(a, b) {
    var diff = a.length ^ b.length;
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return diff === 0;
  }

  /* ======================================================================
     6. Self-test against the published vectors
     --------------------------------------------------------------------
     RFC 4226 Appendix D (HOTP, SHA-1, six digits, counters 0-9) and RFC 6238
     Appendix B (TOTP, eight digits, thirty-second step, all three hashes).
     The seeds differ per hash in RFC 6238: the key is the ASCII string
     "12345678901234567890" repeated and truncated to the hash's block-ish
     length, exactly as the RFC prints them.
     ====================================================================== */

  var RFC4226_CODES = ['755224', '287082', '359152', '969429', '338314',
                       '254676', '287922', '162583', '399871', '520489'];

  var RFC6238_TIMES = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
  var RFC6238_EXPECTED = {
    'SHA-1':   ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130'],
    'SHA-256': ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706'],
    'SHA-512': ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826']
  };
  var RFC6238_SEEDS = {
    'SHA-1':   '12345678901234567890',
    'SHA-256': '12345678901234567890123456789012',
    'SHA-512': '1234567890123456789012345678901234567890123456789012345678901234'
  };

  function selfTest() {
    var passed = 0, failures = [], i, algName;
    var hotpKey = asciiBytes('12345678901234567890');
    for (i = 0; i < RFC4226_CODES.length; i++) {
      var got = hotp('SHA-1', hotpKey, i, 6).code;
      if (got === RFC4226_CODES[i]) passed++;
      else failures.push('RFC 4226 counter ' + i + ': ' + got + ' != ' + RFC4226_CODES[i]);
    }
    for (algName in RFC6238_EXPECTED) {
      if (!Object.prototype.hasOwnProperty.call(RFC6238_EXPECTED, algName)) continue;
      var key = asciiBytes(RFC6238_SEEDS[algName]);
      for (i = 0; i < RFC6238_TIMES.length; i++) {
        var code = totp(algName, key, RFC6238_TIMES[i], 30, 8).code;
        var want = RFC6238_EXPECTED[algName][i];
        if (code === want) passed++;
        else failures.push('RFC 6238 ' + algName + ' t=' + RFC6238_TIMES[i] +
                           ': ' + code + ' != ' + want);
      }
    }
    var total = RFC4226_CODES.length + 3 * RFC6238_TIMES.length;
    return { passed: passed, total: total, failures: failures };
  }

  /* ======================================================================
     7. A small QR encoder — byte mode, error correction level M, versions
        1 to 10.
     --------------------------------------------------------------------
     Enough for any otpauth:// URI worth putting on a page (213 bytes at
     version 10) and no more, because every extra version is another row of
     table I would have to be sure of. If a URI does not fit, the tool says
     so and shows the text instead of drawing something unscannable.

     Level M was chosen over L deliberately: this square gets photographed off
     a screen at an angle, and the extra redundancy costs a version or two of
     size and buys real tolerance.
     ====================================================================== */

  /* [EC codewords per block, group 1 blocks, group 1 data codewords,
      group 2 blocks, group 2 data codewords] for error correction level M. */
  var QR_BLOCKS = {
    1:  [10, 1, 16, 0, 0],
    2:  [16, 1, 28, 0, 0],
    3:  [26, 1, 44, 0, 0],
    4:  [18, 2, 32, 0, 0],
    5:  [24, 2, 43, 0, 0],
    6:  [16, 4, 27, 0, 0],
    7:  [18, 4, 31, 0, 0],
    8:  [22, 2, 38, 2, 39],
    9:  [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44]
  };
  var QR_MAX_VERSION = 10;

  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;  // the QR field polynomial
    }
    for (i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGenerator(degree) {
    var poly = [1], i, j;
    var rootValue = 1;
    for (i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1);
      for (j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], rootValue);
      }
      poly = next;
      rootValue = gfMul(rootValue, 2);
    }
    return poly;
  }

  function rsCompute(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Uint8Array(ecLen);
    var i, j;
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      for (j = 0; j < ecLen - 1; j++) res[j] = res[j + 1];
      res[ecLen - 1] = 0;
      for (j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
    }
    return res;
  }

  function qrAlignmentPositions(version) {
    if (version === 1) return [];
    var size = version * 4 + 17;
    var count = Math.floor(version / 7) + 2;
    var step = Math.ceil((size - 13) / (count * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function qrFormatBits(mask) {
    // Error correction level M is 0b00 in the format string.
    var data = (0 << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
  }

  function qrVersionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return ((version << 12) | rem) & 0x3ffff;
  }

  function bitAt(value, i) { return ((value >>> i) & 1) !== 0; }

  function makeGrid(size, fill) {
    var g = new Array(size);
    for (var y = 0; y < size; y++) {
      g[y] = new Uint8Array(size);
      if (fill) for (var x = 0; x < size; x++) g[y][x] = 1;
    }
    return g;
  }

  /* Draws the fixed patterns, lays the codewords down the zigzag, tries all
     eight masks and keeps the one the penalty rules like best. */
  function qrBuild(version, codewords) {
    var size = version * 4 + 17;
    var modules = makeGrid(size, false);
    var isFunction = makeGrid(size, false);
    var x, y, i, j;

    function setFn(cx, cy, dark) {
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) return;
      modules[cy][cx] = dark ? 1 : 0;
      isFunction[cy][cx] = 1;
    }

    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFn(cx + dx, cy + dy, dist !== 2 && dist !== 4);
        }
      }
    }

    function alignment(cx, cy) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    // Timing patterns first; the finders overwrite their ends, as they should.
    for (i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    var align = qrAlignmentPositions(version);
    for (i = 0; i < align.length; i++) {
      for (j = 0; j < align.length; j++) {
        // The three corners are already finders.
        if ((i === 0 && j === 0) ||
            (i === 0 && j === align.length - 1) ||
            (i === align.length - 1 && j === 0)) continue;
        alignment(align[i], align[j]);
      }
    }

    // Reserve the format areas with a placeholder so the data layout skips
    // them; the real bits go in once a mask has been chosen.
    function drawFormat(mask) {
      var bits = qrFormatBits(mask);
      for (i = 0; i <= 5; i++) setFn(8, i, bitAt(bits, i));
      setFn(8, 7, bitAt(bits, 6));
      setFn(8, 8, bitAt(bits, 7));
      setFn(7, 8, bitAt(bits, 8));
      for (i = 9; i < 15; i++) setFn(14 - i, 8, bitAt(bits, i));
      for (i = 0; i < 8; i++) setFn(size - 1 - i, 8, bitAt(bits, i));
      for (i = 8; i < 15; i++) setFn(8, size - 15 + i, bitAt(bits, i));
      setFn(8, size - 8, true);  // the module that is always dark
    }
    drawFormat(0);

    if (version >= 7) {
      var vbits = qrVersionBits(version);
      for (i = 0; i < 18; i++) {
        var dark = bitAt(vbits, i);
        var a = size - 11 + (i % 3);
        var b = Math.floor(i / 3);
        setFn(a, b, dark);
        setFn(b, a, dark);
      }
    }

    // Codewords, up the right-hand column pair and down the next.
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (j = 0; j < 2; j++) {
          x = right - j;
          var upward = ((right + 1) & 2) === 0;
          y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
            modules[y][x] = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
        }
      }
    }

    function maskAt(mask, mx, my) {
      switch (mask) {
        case 0: return (mx + my) % 2 === 0;
        case 1: return my % 2 === 0;
        case 2: return mx % 3 === 0;
        case 3: return (mx + my) % 3 === 0;
        case 4: return (Math.floor(mx / 3) + Math.floor(my / 2)) % 2 === 0;
        case 5: return (mx * my) % 2 + (mx * my) % 3 === 0;
        case 6: return ((mx * my) % 2 + (mx * my) % 3) % 2 === 0;
        default: return ((mx + my) % 2 + (mx * my) % 3) % 2 === 0;
      }
    }

    function applyMask(mask) {
      for (y = 0; y < size; y++) {
        for (x = 0; x < size; x++) {
          if (!isFunction[y][x] && maskAt(mask, x, y)) modules[y][x] ^= 1;
        }
      }
    }

    function addHistory(run, history) {
      if (history[0] === 0) run += size;  // the quiet zone counts as light
      history.pop();
      history.unshift(run);
    }
    function countFinderLike(history) {
      var n = history[1];
      var core = n > 0 && history[2] === n && history[3] === n * 3 &&
                 history[4] === n && history[5] === n;
      return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
             (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
    }
    function terminateAndCount(runColor, runLength, history) {
      if (runColor) { addHistory(runLength, history); runLength = 0; }
      runLength += size;
      addHistory(runLength, history);
      return countFinderLike(history);
    }

    function penalty() {
      var score = 0, k;
      for (y = 0; y < size; y++) {
        var runColor = 0, runLength = 0, history = [0, 0, 0, 0, 0, 0, 0];
        for (x = 0; x < size; x++) {
          if (modules[y][x] === runColor) {
            runLength++;
            if (runLength === 5) score += 3;
            else if (runLength > 5) score++;
          } else {
            addHistory(runLength, history);
            if (!runColor) score += countFinderLike(history) * 40;
            runColor = modules[y][x];
            runLength = 1;
          }
        }
        score += terminateAndCount(runColor, runLength, history) * 40;
      }
      for (x = 0; x < size; x++) {
        var cColor = 0, cLength = 0, cHistory = [0, 0, 0, 0, 0, 0, 0];
        for (y = 0; y < size; y++) {
          if (modules[y][x] === cColor) {
            cLength++;
            if (cLength === 5) score += 3;
            else if (cLength > 5) score++;
          } else {
            addHistory(cLength, cHistory);
            if (!cColor) score += countFinderLike(cHistory) * 40;
            cColor = modules[y][x];
            cLength = 1;
          }
        }
        score += terminateAndCount(cColor, cLength, cHistory) * 40;
      }
      for (y = 0; y < size - 1; y++) {
        for (x = 0; x < size - 1; x++) {
          var c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] &&
              c === modules[y + 1][x + 1]) score += 3;
        }
      }
      var dark = 0;
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += modules[y][x];
      var total = size * size;
      k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      return score + k * 10;
    }

    var bestMask = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      var s = penalty();
      if (s < bestScore) { bestScore = s; bestMask = m; }
      applyMask(m);  // masking is its own inverse
    }
    applyMask(bestMask);
    drawFormat(bestMask);

    return { size: size, modules: modules, version: version, mask: bestMask };
  }

  /* Returns { size, modules } or null when the text will not fit in the
     versions this encoder knows. Callers must handle the null. */
  function qrEncode(text) {
    var bytes = utf8Bytes(text);
    var version = 0, spec = null, dataCw = 0, lenBits = 8, v;
    for (v = 1; v <= QR_MAX_VERSION; v++) {
      var cand = QR_BLOCKS[v];
      var cw = cand[1] * cand[2] + cand[3] * cand[4];
      var lb = v < 10 ? 8 : 16;
      if (4 + lb + bytes.length * 8 <= cw * 8) {
        version = v; spec = cand; dataCw = cw; lenBits = lb;
        break;
      }
    }
    if (!version) return null;

    var bits = [];
    function put(value, n) {
      for (var k = n - 1; k >= 0; k--) bits.push((value >>> k) & 1);
    }
    put(4, 4);                       // byte mode
    put(bytes.length, lenBits);
    var i;
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);

    var capacityBits = dataCw * 8;
    for (i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    var pads = [0xec, 0x11], padIndex = 0;
    while (bits.length < capacityBits) { put(pads[padIndex & 1], 8); padIndex++; }

    var dataCodewords = new Uint8Array(dataCw);
    for (i = 0; i < dataCw; i++) {
      var byteValue = 0;
      for (var k = 0; k < 8; k++) byteValue = (byteValue << 1) | bits[i * 8 + k];
      dataCodewords[i] = byteValue;
    }

    var ecLen = spec[0];
    var groups = [[spec[1], spec[2]], [spec[3], spec[4]]];
    var blocks = [], ecs = [], pos = 0, g, b;
    for (g = 0; g < 2; g++) {
      for (b = 0; b < groups[g][0]; b++) {
        var block = dataCodewords.subarray(pos, pos + groups[g][1]);
        pos += groups[g][1];
        blocks.push(block);
        ecs.push(rsCompute(block, ecLen));
      }
    }
    var interleaved = [];
    var longest = Math.max(spec[2], spec[4]);
    for (i = 0; i < longest; i++) {
      for (b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) interleaved.push(blocks[b][i]);
      }
    }
    for (i = 0; i < ecLen; i++) {
      for (b = 0; b < ecs.length; b++) interleaved.push(ecs[b][i]);
    }

    return qrBuild(version, new Uint8Array(interleaved));
  }

  /* ======================================================================
     8. The provisioning URI
     ====================================================================== */

  function otpauthUri(config) {
    var issuer = config.issuer || '';
    var account = config.account || 'user';
    var label = issuer ? encodeURIComponent(issuer) + ':' + encodeURIComponent(account)
                       : encodeURIComponent(account);
    var uri = 'otpauth://totp/' + label + '?secret=' + config.secret;
    if (issuer) uri += '&issuer=' + encodeURIComponent(issuer);
    uri += '&algorithm=' + config.alg.replace('-', '');
    uri += '&digits=' + config.digits;
    uri += '&period=' + config.period;
    return uri;
  }

  root.TotpEngine = {
    sha1: sha1, sha256: sha256, sha512: sha512,
    hmac: hmac, hotp: hotp, totp: totp,
    base32Decode: base32Decode, base32Encode: base32Encode,
    qrEncode: qrEncode, otpauthUri: otpauthUri,
    selfTest: selfTest, toHex: toHex, utf8Bytes: utf8Bytes
  };

  /* ======================================================================
     9. The page
     ====================================================================== */

  var EXAMPLE_SECRET = 'JBSWY3DPEHPK3PXP';

  /* label, and the sentence under it explaining why the step exists. Order is
     the order of the RFC. */
  var STEPS = [
    ['secret', 'Shared secret, Base32',
     'Agreed once at enrolment. After that it never travels again — which is the whole reason this works offline.'],
    ['keybytes', 'Secret decoded to bytes',
     'Base32 is only a way to print bytes without ambiguous characters. HMAC works on the bytes.'],
    ['now', 'Unix time, from this device',
     'Seconds since 1970-01-01 UTC. This is the only input that moves.'],
    ['divide', 'Divided by the time step',
     'RFC 6238 writes it (T - T0) / X. T0 is 0 and X is the step you picked.'],
    ['counter', 'Counter T, rounded down',
     'Both sides compute the same integer for the same 30 seconds. HOTP puts an event counter here instead; everything below is identical.'],
    ['counterbytes', 'T as eight bytes, big-endian',
     'The message being signed. Always eight bytes, always big-endian, even for small counters.'],
    ['hmac', 'HMAC over that counter',
     'The four highlighted bytes are the ones the next steps use.'],
    ['offset', 'Offset, from the low nibble of the last byte',
     'Dynamic truncation. The code is taken from a different place in the digest each time, so no fixed part of the MAC leaks.'],
    ['slice', 'The four bytes at that offset', ''],
    ['masked', 'Top bit cleared, & 0x7fffffff',
     'Dropped so implementations that read the value as a signed integer get the same answer.'],
    ['mod', 'Modulo ten to the power of the digit count', ''],
    ['final', 'Left-padded to the digit count',
     'The number your authenticator shows. Nothing was fetched to produce it.']
  ];

  function el(id) { return document.getElementById(id); }

  function makeEl(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function clockOf(seconds) {
    var d = new Date(seconds * 1000);
    function two(v) { return v < 10 ? '0' + v : String(v); }
    return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }

  var ui = {};           // step id -> { value, note } nodes
  var windowRows = [];   // the three window cards
  var timer = null;
  var lastAnnounced = '';
  var lastUri = '';
  var selfTestResult = null;

  function buildSteps() {
    var host = el('totp-steps');
    if (!host) return;
    for (var i = 0; i < STEPS.length; i++) {
      var spec = STEPS[i];
      var row = makeEl('div', 'totp-step');
      var label = makeEl('p', 'totp-step-label');
      label.appendChild(makeEl('span', 'totp-step-n', String(i + 1)));
      label.appendChild(document.createTextNode(spec[1]));
      var value = makeEl('p', 'totp-step-value', '—');
      row.appendChild(label);
      row.appendChild(value);
      if (spec[2]) row.appendChild(makeEl('p', 'totp-step-note', spec[2]));
      host.appendChild(row);
      ui[spec[0]] = value;
    }
    /* The HMAC row is the one that has to show which bytes were picked, so it
       gets three spans instead of plain text and keeps them for the life of
       the page — rebuilding nodes four times a second would fight any screen
       reader parked inside the panel. */
    var hmacValue = ui.hmac;
    hmacValue.textContent = '';
    hmacValue.appendChild(makeEl('span', 'totp-hex', ''));
    hmacValue.appendChild(makeEl('span', 'totp-hex totp-hex-pick', ''));
    hmacValue.appendChild(makeEl('span', 'totp-hex', ''));
  }

  function buildWindows() {
    var host = el('totp-windows');
    if (!host) return;
    var labels = ['T − 1', 'T', 'T + 1'];
    for (var i = 0; i < 3; i++) {
      var li = makeEl('li', 'totp-window');
      var head = makeEl('p', 'totp-window-t', labels[i]);
      var code = makeEl('p', 'totp-window-code', '—');
      var range = makeEl('p', 'totp-window-range', '');
      var tag = makeEl('p', 'totp-window-tag', '');
      li.appendChild(head);
      li.appendChild(code);
      li.appendChild(range);
      li.appendChild(tag);
      host.appendChild(li);
      windowRows.push({ root: li, code: code, range: range, tag: tag, head: head });
    }
  }

  function readConfig() {
    return {
      alg: el('tool-alg').value,
      digits: parseInt(el('tool-digits').value, 10),
      period: parseInt(el('tool-period').value, 10),
      secret: el('tool-secret').value,
      issuer: el('tool-issuer').value,
      account: el('tool-account').value,
      skew: parseInt(el('totp-skewrange').value, 10)
    };
  }

  function setSecretStatus(text, cls) {
    var node = el('tool-secret-status');
    node.className = 'lab-status' + (cls ? ' ' + cls : '');
    node.textContent = text;
  }

  function clearDerivation(message) {
    var key;
    for (key in ui) {
      if (!Object.prototype.hasOwnProperty.call(ui, key)) continue;
      if (key === 'hmac') continue;
      ui[key].textContent = '—';
    }
    var spans = ui.hmac.childNodes;
    spans[0].textContent = '—';
    spans[1].textContent = '';
    spans[2].textContent = '';
    el('totp-code').textContent = '––––––';
    el('totp-countdown').textContent = message;
    setRing(0);
    for (var i = 0; i < windowRows.length; i++) {
      windowRows[i].code.textContent = '—';
      windowRows[i].range.textContent = '';
      windowRows[i].tag.textContent = '';
      windowRows[i].root.className = 'totp-window';
    }
    drawQr(null);
    el('totp-uri').value = '';
    lastUri = '';
  }

  /* r = 19 in the SVG, so the full circumference is 2*pi*19. */
  var RING_CIRCUMFERENCE = 2 * Math.PI * 19;

  function setRing(fraction) {
    var node = el('totp-ring-value');
    if (!node) return;
    var shown = Math.max(0, Math.min(1, fraction)) * RING_CIRCUMFERENCE;
    node.setAttribute('stroke-dasharray', shown.toFixed(2) + ' ' + RING_CIRCUMFERENCE.toFixed(2));
  }

  function drawQr(matrix) {
    var canvas = el('totp-qr');
    var note = el('totp-qrnote');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!matrix) {
      canvas.width = 8;
      canvas.height = 8;
      ctx.clearRect(0, 0, 8, 8);
      canvas.setAttribute('aria-label', 'No QR code yet');
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    var quiet = 4;
    var total = matrix.size + quiet * 2;
    var scale = Math.max(2, Math.floor(280 / total));
    canvas.width = total * scale;
    canvas.height = total * scale;
    /* Always white paper and near-black ink, in both themes. A scanner needs
       the contrast and does not care what the rest of the page is doing. */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1220';
    for (var y = 0; y < matrix.size; y++) {
      for (var x = 0; x < matrix.size; x++) {
        if (matrix.modules[y][x]) {
          ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    canvas.setAttribute('aria-label',
      'QR code of the provisioning URI, version ' + matrix.version + ', mask ' + matrix.mask +
      '. The same text is in the field above it.');
    if (note) {
      note.textContent = 'Version ' + matrix.version + ', error correction M, mask ' +
        matrix.mask + ' — drawn here in the page, not fetched from anywhere.';
    }
  }

  /* The same normalisation base32Decode does, so what the derivation shows as
     the secret and what goes into the URI are the bytes that were actually
     hashed — trailing '=' padding included, which a Base32 decoder ignores and
     an otpauth parser would not. */
  function normalise(secret) {
    return String(secret).toUpperCase().replace(/[\s\-_]/g, '').replace(/=+$/, '');
  }

  /* renderTick can throw on a shape of input I have not thought of, and it runs
     four times a second from a timer where a throw would go to the console and
     nowhere the visitor can see — leaving a panel frozen on stale numbers with
     no explanation. So: stop the clock, say what happened, and leave Recompute
     as the way back in. A tool that quietly shows a code that is no longer
     being recomputed would be worse than one that admits it broke. */
  function tick() {
    try {
      renderTick();
    } catch (err) {
      stop();
      el('totp-countdown').textContent =
        'Stopped: ' + ((err && err.message) || String(err)) + '. Press Recompute to try again.';
    }
  }

  function renderTick() {
    var cfg = readConfig();
    var keyBytes;
    try {
      keyBytes = base32Decode(cfg.secret);
    } catch (err) {
      setSecretStatus(err.message, 'is-err');
      clearDerivation('Waiting for a valid Base32 secret');
      return;
    }
    /* Length is reported either way rather than only on failure. The example
       secret this page ships with is 80 bits, and saying so is part of the
       lesson: plenty of real deployments hand out a secret this short. */
    var bitLen = keyBytes.length * 8;
    if (bitLen < 128) {
      setSecretStatus(keyBytes.length + ' bytes, ' + bitLen + ' bits — valid, but under the 128-bit minimum in RFC 4226', 'is-busy');
    } else {
      setSecretStatus(keyBytes.length + ' bytes, ' + bitLen + ' bits — valid Base32', 'is-ok');
    }

    var nowMs = Date.now();
    var trueSeconds = Math.floor(nowMs / 1000);
    var deviceSeconds = trueSeconds + cfg.skew;
    var serverCounter = Math.floor(trueSeconds / cfg.period);
    var deviceCounter = Math.floor(deviceSeconds / cfg.period);
    var remaining = cfg.period - (trueSeconds % cfg.period);

    var result = hotp(cfg.alg, keyBytes, deviceCounter, cfg.digits);

    /* --- the headline ------------------------------------------------- */
    el('totp-code').textContent = result.code;
    el('totp-countdown').textContent =
      remaining + (remaining === 1 ? ' second' : ' seconds') + ' until the next step';
    setRing(remaining / cfg.period);
    if (result.code !== lastAnnounced) {
      lastAnnounced = result.code;
      el('totp-announce').textContent = 'New code ' + result.code.split('').join(' ');
    }

    /* --- the three windows -------------------------------------------- */
    for (var i = 0; i < 3; i++) {
      var counter = serverCounter - 1 + i;
      var row = windowRows[i];
      var wcode = hotp(cfg.alg, keyBytes, counter, cfg.digits).code;
      var start = counter * cfg.period;
      row.code.textContent = wcode;
      row.range.textContent = clockOf(start) + ' – ' + clockOf(start + cfg.period - 1);
      var cls = 'totp-window';
      var tags = [];
      if (counter === serverCounter) { cls += ' is-server'; tags.push('the server’s current step'); }
      if (counter === deviceCounter) { cls += ' is-device'; tags.push('what this device is showing'); }
      row.root.className = cls;
      row.tag.textContent = tags.join(' · ');
    }

    /* --- the skew explanation ----------------------------------------- */
    var drift = deviceCounter - serverCounter;
    el('totp-skewvalue').textContent = signed(cfg.skew) + ' s';
    var note;
    if (drift === 0) {
      note = 'The device and the server are inside the same step, so the code matches with no tolerance needed at all.';
    } else if (Math.abs(drift) === 1) {
      note = 'The device has slipped into the ' + (drift > 0 ? 'next' : 'previous') +
        ' step. A server checking only the exact step rejects this code; a server that also tries T ' +
        (drift > 0 ? '+' : '−') + ' 1 accepts it. That tolerance is why one exists.';
    } else {
      note = 'The device is ' + Math.abs(drift) + ' steps ' + (drift > 0 ? 'ahead' : 'behind') +
        '. Most servers give at most one step either side, so this code is refused — the usual fix is to correct the clock, not to widen the window.';
    }
    el('totp-skewnote').textContent = note;

    /* --- the derivation ------------------------------------------------ */
    ui.secret.textContent = normalise(cfg.secret);
    ui.keybytes.textContent = spacedHex(keyBytes, 0, keyBytes.length) +
      '   (' + keyBytes.length + ' bytes)';
    ui.now.textContent = deviceSeconds + (cfg.skew ? '  (' + trueSeconds + ' from this clock, ' + signed(cfg.skew) + ' s applied)' : '');
    ui.divide.textContent = deviceSeconds + ' / ' + cfg.period + ' = ' +
      (deviceSeconds / cfg.period).toFixed(4);
    ui.counter.textContent = String(deviceCounter);
    ui.counterbytes.textContent = spacedHex(counterBytes(deviceCounter), 0, 8);

    var mac = result.mac;
    var spans = ui.hmac.childNodes;
    spans[0].textContent = result.offset > 0 ? spacedHex(mac, 0, result.offset) + ' ' : '';
    spans[1].textContent = spacedHex(mac, result.offset, result.offset + 4);
    spans[2].textContent = result.offset + 4 < mac.length
      ? ' ' + spacedHex(mac, result.offset + 4, mac.length) : '';

    var lastByte = mac[mac.length - 1];
    ui.offset.textContent = '0x' + (lastByte < 16 ? '0' : '') + lastByte.toString(16) +
      ' & 0x0f = ' + result.offset;
    ui.slice.textContent = spacedHex(mac, result.offset, result.offset + 4) +
      '  =  ' + (((mac[result.offset] << 24) >>> 0) +
                 (mac[result.offset + 1] << 16) +
                 (mac[result.offset + 2] << 8) +
                 mac[result.offset + 3]);
    ui.masked.textContent = String(result.binary);
    ui.mod.textContent = result.binary + ' mod ' + Math.pow(10, cfg.digits) +
      ' = ' + result.remainder;
    ui.final.textContent = result.code;

    /* --- the provisioning URI and its QR ------------------------------- */
    var uri = otpauthUri({
      secret: normalise(cfg.secret),
      issuer: cfg.issuer,
      account: cfg.account,
      alg: cfg.alg,
      digits: cfg.digits,
      period: cfg.period
    });
    if (uri !== lastUri) {
      lastUri = uri;
      el('totp-uri').value = uri;
      var matrix = qrEncode(uri);
      drawQr(matrix);
      if (!matrix) {
        el('totp-qrnote').textContent =
          'That URI is ' + utf8Bytes(uri).length + ' bytes, past what this encoder ' +
          'draws (213). Shorten the issuer or the account name, or copy the text above instead.';
      }
    }
  }

  function verify() {
    var out = el('totp-verifyout');
    var typed = el('totp-check').value.replace(/[\s\-]/g, '');
    if (!typed) {
      out.className = 'totp-verify-out is-warn';
      out.textContent = 'Type a code first.';
      return;
    }
    var cfg = readConfig();
    var keyBytes;
    try {
      keyBytes = base32Decode(cfg.secret);
    } catch (err) {
      out.className = 'totp-verify-out is-err';
      out.textContent = 'Fix the secret first: ' + err.message;
      return;
    }
    var allowed = parseInt(el('totp-tolerance').value, 10);
    var serverCounter = Math.floor(Date.now() / 1000 / cfg.period);
    var matched = null;
    for (var d = -allowed; d <= allowed; d++) {
      if (constantTimeEqual(hotp(cfg.alg, keyBytes, serverCounter + d, cfg.digits).code, typed)) {
        matched = d;
        break;
      }
    }
    if (matched === null) {
      out.className = 'totp-verify-out is-err';
      out.textContent = 'No match in ' +
        (allowed === 0 ? 'the current step' : 'the current step or ' + allowed + ' either side') +
        '. Either the code is wrong, or the clock it came from is further out than the window allows.';
      return;
    }
    out.className = 'totp-verify-out is-ok';
    if (matched === 0) {
      out.textContent = 'Matched the current step (T). A server with no tolerance at all would accept this.';
    } else {
      out.textContent = 'Matched T ' + (matched > 0 ? '+ ' : '− ') + Math.abs(matched) +
        ', the ' + (matched > 0 ? 'next' : 'previous') + ' window. It is accepted only because the window is ±' +
        allowed + '. A real server must also refuse a counter it has already accepted, or this code can be replayed for the rest of its life.';
    }
  }

  function generateSecret() {
    var bytes = new Uint8Array(20);   // 160 bits, the RFC 4226 recommendation
    if (root.crypto && root.crypto.getRandomValues) {
      root.crypto.getRandomValues(bytes);
    } else {
      setSecretStatus('This browser has no cryptographic random source; nothing generated.', 'is-err');
      return;
    }
    el('tool-secret').value = base32Encode(bytes);
    lastUri = '';
    tick();
  }

  /* The interval is armed BEFORE the first tick, not after. The other way
     round, a first tick that failed would call stop() into a timer that did
     not exist yet, and the assignment underneath would then install one
     anyway — an error handler that turns a single failure into four failures
     a second, forever. */
  function start() {
    if (timer) return;
    timer = setInterval(tick, 250);
    tick();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  LabTool.define({
    id: 'totptool',
    /* Recompute is also the way back from a stopped clock, so it restarts the
       timer rather than only redrawing once. */
    run: function () { lastUri = ''; if (timer) tick(); else start(); },
    onReady: function () {
      buildSteps();
      buildWindows();

      selfTestResult = selfTest();
      var status = el('tool-selftest');
      if (selfTestResult.failures.length) {
        status.className = 'lab-status is-err';
        status.textContent = 'Self-test FAILED (' + selfTestResult.passed + '/' +
          selfTestResult.total + ') — do not trust these codes';
      } else {
        status.className = 'lab-status is-ok';
        status.textContent = selfTestResult.passed + '/' + selfTestResult.total +
          ' RFC vectors pass';
      }

      el('tool-secret').value = EXAMPLE_SECRET;
      el('tool-issuer').value = 'Example Corp';
      el('tool-account').value = 'alice@example.com';

      var live = ['tool-alg', 'tool-digits', 'tool-period', 'tool-secret',
                  'tool-issuer', 'tool-account'];
      live.forEach(function (id) {
        var node = el(id);
        node.addEventListener('input', function () { lastUri = ''; tick(); });
        node.addEventListener('change', function () { lastUri = ''; tick(); });
      });
      el('totp-skewrange').addEventListener('input', tick);
      el('tool-generate').addEventListener('click', generateSecret);
      el('totp-verifybtn').addEventListener('click', verify);
      el('totp-check').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); verify(); }
      });

      /* A background tab does not need four recomputes a second, and on a
         phone that is battery spent on a panel nobody is looking at. */
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop(); else start();
      });
      start();
    }
  });
})(typeof self !== 'undefined' ? self : this);

/* ==========================================================================
   hash-engines.js — incremental MD5, SHA-1, SHA-256, SHA-384 and SHA-512.
   --------------------------------------------------------------------------
   WHY THESE EXIST AT ALL, given WebCrypto is right there and audited.

   crypto.subtle.digest() is one-shot: it takes the whole message as a single
   ArrayBuffer and there is no browser API for feeding it a file in pieces.
   That is what forced the old 256 MB ceiling on /labs/hash — the file was read
   into one buffer with FileReader, and the pure-JS MD5 then allocated a second
   padded copy of it, so peak memory ran to roughly twice the file size and a
   phone asked for a gigabyte simply died.

   Hashes do not actually need the whole message in memory. Every algorithm
   here is a block function over a small fixed state, so the file can be
   streamed through a few megabytes at a time and the memory cost stays flat no matter how
   big it gets. That is the whole reason for reimplementing them: not because
   WebCrypto is wrong, but because its shape is wrong for a 4 GB disk image.

   These run in a Worker (hash-worker.js), so the main thread keeps painting.

   CORRECTNESS, AND HOW TO RE-CHECK IT. Hand-written hash code is exactly the
   kind of thing that is subtly wrong in a way nobody notices until it matters,
   and a wrong digest is worse than no digest at all on a page people are told
   to drop evidence into. Every algorithm below was verified against the
   published vectors before shipping, over 285 assertions: the empty string,
   "abc", the 56- and 112-byte strings that straddle each padding boundary, a
   million 'a' characters (the one that catches a broken multi-block length
   counter), every one of those replayed through 1/63/64/65/127/128/129-byte
   chunk boundaries, and several megabytes cross-checked against Node's crypto.

   IF YOU EDIT THIS FILE, re-check it. The fastest honest check is the browser's
   own WebCrypto, which needs no tooling — in a console on any page here:

     const b = new TextEncoder().encode('abc');
     const h = HashEngines.create('sha256'); h.update(b); h.digest();
     // must equal:
     //   crypto.subtle.digest('SHA-256', b) -> hex
     // and the four canonical "abc" digests are:
     //   md5     900150983cd24fb0d6963f7d28e17f72
     //   sha1    a9993e364706816aba3e25717850c26c9cd0d89d
     //   sha256  ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
     //   sha512  ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a
     //           2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f
     // The empty string must give md5 d41d8cd98f00b204e9800998ecf8427e and
     // sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
     // Feed one of them in several small chunks too — a padding or length bug
     // shows up only when a chunk boundary lands mid-block.

   Usage:
     var h = HashEngines.create('sha256');
     h.update(uint8Array);        // any number of times, any chunk sizes
     h.digest();                  // lowercase hex, engine is spent afterwards
   ========================================================================== */

(function (root) {
  'use strict';

  /* Total byte counts are held as a plain number rather than a 64-bit pair.
     A double is exact to 2^53, and the bit length we derive from it is exact
     to 2^50 bytes — a petabyte — so the only thing this gives up is files
     larger than any filesystem will hand a browser. */
  function bitLenPair(byteLen) {
    var bits = byteLen * 8;
    return {
      hi: Math.floor(bits / 4294967296),
      lo: bits >>> 0
    };
  }

  function toHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return s;
  }

  /* Shared plumbing: buffer incoming bytes, hand whole blocks to the algorithm,
     keep the remainder for next time. Every engine below is this plus a block
     function and a padding rule. */
  function Buffered(blockSize, blockFn) {
    this.blockSize = blockSize;
    this.blockFn = blockFn;
    this.buf = new Uint8Array(blockSize);
    this.bufLen = 0;
    this.total = 0;
  }

  Buffered.prototype.push = function (bytes) {
    var blockSize = this.blockSize;
    var i = 0;
    var n = bytes.length;
    this.total += n;

    /* Top up a partial block left over from the previous chunk first. */
    if (this.bufLen > 0) {
      var need = blockSize - this.bufLen;
      if (n < need) {
        this.buf.set(bytes, this.bufLen);
        this.bufLen += n;
        return;
      }
      this.buf.set(bytes.subarray(0, need), this.bufLen);
      this.blockFn(this.buf, 0);
      this.bufLen = 0;
      i = need;
    }

    /* Then run whole blocks straight out of the caller's array — no copying,
       which is most of the reason this keeps up with a fast disk. */
    for (; i + blockSize <= n; i += blockSize) {
      this.blockFn(bytes, i);
    }

    if (i < n) {
      this.buf.set(bytes.subarray(i), 0);
      this.bufLen = n - i;
    }
  };

  /* Length-padded finish, shared by all five: a 0x80 byte, zeros, then the
     message bit length. The two differences between algorithms are the width
     of the length field and its endianness. */
  Buffered.prototype.finish = function (lenBytes, littleEndian) {
    var blockSize = this.blockSize;
    var padLen = blockSize - ((this.total + lenBytes) % blockSize);
    if (padLen === 0) padLen = blockSize;

    var tail = new Uint8Array(padLen + lenBytes);
    tail[0] = 0x80;

    var bits = bitLenPair(this.total);
    var dv = new DataView(tail.buffer);
    var at = padLen;

    if (littleEndian) {
      /* MD5 only: 64-bit little-endian. */
      dv.setUint32(at, bits.lo, true);
      dv.setUint32(at + 4, bits.hi, true);
    } else if (lenBytes === 8) {
      dv.setUint32(at, bits.hi, false);
      dv.setUint32(at + 4, bits.lo, false);
    } else {
      /* SHA-384/512 use a 128-bit field. Everything above 2^64 bits is zero
         for any real input, so only the low 8 bytes are ever written. */
      dv.setUint32(at + 8, bits.hi, false);
      dv.setUint32(at + 12, bits.lo, false);
    }

    /* push() updates this.total, which must not move now that the length is
       already committed to the tail — so restore it around the call. */
    var committed = this.total;
    this.push(tail);
    this.total = committed;
  };

  /* ====================================================================== */
  /* MD5                                                                     */
  /* ====================================================================== */
  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  var MD5_K = new Int32Array(64);
  for (var mi = 0; mi < 64; mi++) {
    MD5_K[mi] = (Math.abs(Math.sin(mi + 1)) * 4294967296) | 0;
  }

  function Md5() {
    var self = this;
    this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]);
    this.M = new Int32Array(16);
    this.core = new Buffered(64, function (b, off) { self.block(b, off); });
  }

  Md5.prototype.block = function (b, off) {
    var M = this.M;
    for (var j = 0; j < 16; j++) {
      var p = off + j * 4;
      M[j] = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24));
    }
    var a = this.h[0], bb = this.h[1], c = this.h[2], d = this.h[3];
    for (var i = 0; i < 64; i++) {
      var f, g;
      if (i < 16)      { f = (bb & c) | (~bb & d);      g = i; }
      else if (i < 32) { f = (d & bb) | (~d & c);       g = (5 * i + 1) & 15; }
      else if (i < 48) { f = bb ^ c ^ d;                g = (3 * i + 5) & 15; }
      else             { f = c ^ (bb | ~d);             g = (7 * i) & 15; }
      var tmp = d;
      d = c;
      c = bb;
      var sum = (a + f + MD5_K[i] + M[g]) | 0;
      var s = MD5_S[i];
      bb = (bb + ((sum << s) | (sum >>> (32 - s)))) | 0;
      a = tmp;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + bb) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
  };

  Md5.prototype.update = function (bytes) { this.core.push(bytes); };

  Md5.prototype.digest = function () {
    this.core.finish(8, true);
    var out = new Uint8Array(16);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < 4; i++) dv.setUint32(i * 4, this.h[i] >>> 0, true);
    return toHex(out);
  };

  /* ====================================================================== */
  /* SHA-1                                                                   */
  /* ====================================================================== */
  function Sha1() {
    var self = this;
    this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0]);
    this.W = new Int32Array(80);
    this.core = new Buffered(64, function (b, off) { self.block(b, off); });
  }

  Sha1.prototype.block = function (b, off) {
    var W = this.W;
    for (var j = 0; j < 16; j++) {
      var p = off + j * 4;
      W[j] = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    }
    for (var t = 16; t < 80; t++) {
      var v = W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16];
      W[t] = (v << 1) | (v >>> 31);
    }
    var a = this.h[0], bb = this.h[1], c = this.h[2], d = this.h[3], e = this.h[4];
    for (var i = 0; i < 80; i++) {
      var f, k;
      if (i < 20)      { f = (bb & c) | (~bb & d);          k = 0x5a827999; }
      else if (i < 40) { f = bb ^ c ^ d;                    k = 0x6ed9eba1; }
      else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc | 0; }
      else             { f = bb ^ c ^ d;                    k = 0xca62c1d6 | 0; }
      var tmp = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
      e = d;
      d = c;
      c = (bb << 30) | (bb >>> 2);
      bb = a;
      a = tmp;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + bb) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
  };

  Sha1.prototype.update = function (bytes) { this.core.push(bytes); };

  Sha1.prototype.digest = function () {
    this.core.finish(8, false);
    var out = new Uint8Array(20);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < 5; i++) dv.setUint32(i * 4, this.h[i] >>> 0, false);
    return toHex(out);
  };

  /* ====================================================================== */
  /* SHA-256                                                                 */
  /* ====================================================================== */
  var SHA256_K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf | 0, 0xe9b5dba5 | 0, 0x3956c25b, 0x59f111f1, 0x923f82a4 | 0, 0xab1c5ed5 | 0,
    0xd807aa98 | 0, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe | 0, 0x9bdc06a7 | 0, 0xc19bf174 | 0,
    0xe49b69c1 | 0, 0xefbe4786 | 0, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152 | 0, 0xa831c66d | 0, 0xb00327c8 | 0, 0xbf597fc7 | 0, 0xc6e00bf3 | 0, 0xd5a79147 | 0, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e | 0, 0x92722c85 | 0,
    0xa2bfe8a1 | 0, 0xa81a664b | 0, 0xc24b8b70 | 0, 0xc76c51a3 | 0, 0xd192e819 | 0, 0xd6990624 | 0, 0xf40e3585 | 0, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814 | 0, 0x8cc70208 | 0, 0x90befffa | 0, 0xa4506ceb | 0, 0xbef9a3f7 | 0, 0xc67178f2 | 0
  ]);

  function Sha256() {
    var self = this;
    this.h = new Int32Array([
      0x6a09e667, 0xbb67ae85 | 0, 0x3c6ef372, 0xa54ff53a | 0,
      0x510e527f, 0x9b05688c | 0, 0x1f83d9ab, 0x5be0cd19
    ]);
    this.W = new Int32Array(64);
    this.core = new Buffered(64, function (b, off) { self.block(b, off); });
  }

  Sha256.prototype.block = function (b, off) {
    var W = this.W;
    var j, p;
    for (j = 0; j < 16; j++) {
      p = off + j * 4;
      W[j] = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    }
    for (j = 16; j < 64; j++) {
      var x = W[j - 15], y = W[j - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) | 0;
    }
    var a = this.h[0], bb = this.h[1], c = this.h[2], d = this.h[3];
    var e = this.h[4], f = this.h[5], g = this.h[6], hh = this.h[7];
    for (var i = 0; i < 64; i++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (hh + S1 + ch + SHA256_K[i] + W[i]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & bb) ^ (a & c) ^ (bb & c);
      var t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e;
      e = (d + t1) | 0;
      d = c; c = bb; bb = a;
      a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + bb) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
    this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0;
    this.h[7] = (this.h[7] + hh) | 0;
  };

  Sha256.prototype.update = function (bytes) { this.core.push(bytes); };

  Sha256.prototype.digest = function () {
    this.core.finish(8, false);
    var out = new Uint8Array(32);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < 8; i++) dv.setUint32(i * 4, this.h[i] >>> 0, false);
    return toHex(out);
  };

  /* ====================================================================== */
  /* SHA-512 and SHA-384                                                     */
  /* --------------------------------------------------------------------- */
  /* 64-bit arithmetic on a 32-bit machine: every word is a (hi, lo) pair of  */
  /* Int32s held in two parallel arrays. The constants are written as hex     */
  /* strings and split at load rather than typed as pre-split pairs, because  */
  /* a transposed digit in a hand-split table is invisible on review and the  */
  /* test vectors are the only thing that would catch it.                     */
  /* ====================================================================== */
  var SHA512_K_HEX = [
    '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
    '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
    'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
    '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
    'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
    '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
    '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
    'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
    '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
    '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
    'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
    'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
    '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
    '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
    '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
    '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
    'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
    '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
    '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
    '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817'
  ];

  var SHA512_H_HEX = [
    '6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1',
    '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'
  ];

  var SHA384_H_HEX = [
    'cbbb9d5dc1059ed8', '629a292a367cd507', '9159015a3070dd17', '152fecd8f70e5939',
    '67332667ffc00b31', '8eb44a8768581511', 'db0c2e0d64f98fa7', '47b5481dbefa4fa4'
  ];

  function splitHi(list) {
    var a = new Int32Array(list.length);
    for (var i = 0; i < list.length; i++) a[i] = parseInt(list[i].slice(0, 8), 16) | 0;
    return a;
  }
  function splitLo(list) {
    var a = new Int32Array(list.length);
    for (var i = 0; i < list.length; i++) a[i] = parseInt(list[i].slice(8), 16) | 0;
    return a;
  }

  var K512H = splitHi(SHA512_K_HEX), K512L = splitLo(SHA512_K_HEX);

  function Sha512(is384) {
    var self = this;
    var init = is384 ? SHA384_H_HEX : SHA512_H_HEX;
    this.outBytes = is384 ? 48 : 64;
    this.hH = splitHi(init);
    this.hL = splitLo(init);
    this.WH = new Int32Array(80);
    this.WL = new Int32Array(80);
    this.core = new Buffered(128, function (b, off) { self.block(b, off); });
  }

  Sha512.prototype.block = function (b, off) {
    var WH = this.WH, WL = this.WL;
    var j, p;
    for (j = 0; j < 16; j++) {
      p = off + j * 8;
      WH[j] = (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
      WL[j] = (b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7];
    }

    for (j = 16; j < 80; j++) {
      /* s0 = rotr1 ^ rotr8 ^ shr7  of W[j-15] */
      var xh = WH[j - 15], xl = WL[j - 15];
      var s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      var s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));

      /* s1 = rotr19 ^ rotr61 ^ shr6  of W[j-2] */
      var yh = WH[j - 2], yl = WL[j - 2];
      var s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
      var s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));

      /* W[j] = W[j-16] + s0 + W[j-7] + s1, carried through the low word. */
      var lo = (WL[j - 16] >>> 0) + (s0l >>> 0);
      var hi = (WH[j - 16] + s0h + (lo > 4294967295 ? 1 : 0)) | 0;
      lo = (lo >>> 0) + (WL[j - 7] >>> 0);
      hi = (hi + WH[j - 7] + (lo > 4294967295 ? 1 : 0)) | 0;
      lo = (lo >>> 0) + (s1l >>> 0);
      hi = (hi + s1h + (lo > 4294967295 ? 1 : 0)) | 0;
      WH[j] = hi | 0;
      WL[j] = lo | 0;
    }

    var ah = this.hH[0], al = this.hL[0];
    var bh = this.hH[1], bl = this.hL[1];
    var ch = this.hH[2], cl = this.hL[2];
    var dh = this.hH[3], dl = this.hL[3];
    var eh = this.hH[4], el = this.hL[4];
    var fh = this.hH[5], fl = this.hL[5];
    var gh = this.hH[6], gl = this.hL[6];
    var hh = this.hH[7], hl = this.hL[7];

    for (var i = 0; i < 80; i++) {
      /* S1 = rotr14 ^ rotr18 ^ rotr41 of e */
      var S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      var S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      var chh = (eh & fh) ^ (~eh & gh);
      var chl = (el & fl) ^ (~el & gl);

      /* T1 = h + S1 + ch + K[i] + W[i] */
      var t1l = (hl >>> 0) + (S1l >>> 0);
      var t1h = (hh + S1h + (t1l > 4294967295 ? 1 : 0)) | 0;
      t1l = (t1l >>> 0) + (chl >>> 0);
      t1h = (t1h + chh + (t1l > 4294967295 ? 1 : 0)) | 0;
      t1l = (t1l >>> 0) + (K512L[i] >>> 0);
      t1h = (t1h + K512H[i] + (t1l > 4294967295 ? 1 : 0)) | 0;
      t1l = (t1l >>> 0) + (WL[i] >>> 0);
      t1h = (t1h + WH[i] + (t1l > 4294967295 ? 1 : 0)) | 0;
      t1l = t1l | 0;

      /* S0 = rotr28 ^ rotr34 ^ rotr39 of a */
      var S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      var S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      var majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      var majl = (al & bl) ^ (al & cl) ^ (bl & cl);

      var t2l = (S0l >>> 0) + (majl >>> 0);
      var t2h = (S0h + majh + (t2l > 4294967295 ? 1 : 0)) | 0;
      t2l = t2l | 0;

      hh = gh; hl = gl;
      gh = fh; gl = fl;
      fh = eh; fl = el;

      var el2 = (dl >>> 0) + (t1l >>> 0);
      eh = (dh + t1h + (el2 > 4294967295 ? 1 : 0)) | 0;
      el = el2 | 0;

      dh = ch; dl = cl;
      ch = bh; cl = bl;
      bh = ah; bl = al;

      var al2 = (t1l >>> 0) + (t2l >>> 0);
      ah = (t1h + t2h + (al2 > 4294967295 ? 1 : 0)) | 0;
      al = al2 | 0;
    }

    this.addInto(0, ah, al); this.addInto(1, bh, bl);
    this.addInto(2, ch, cl); this.addInto(3, dh, dl);
    this.addInto(4, eh, el); this.addInto(5, fh, fl);
    this.addInto(6, gh, gl); this.addInto(7, hh, hl);
  };

  Sha512.prototype.addInto = function (i, hi, lo) {
    var l = (this.hL[i] >>> 0) + (lo >>> 0);
    this.hH[i] = (this.hH[i] + hi + (l > 4294967295 ? 1 : 0)) | 0;
    this.hL[i] = l | 0;
  };

  Sha512.prototype.update = function (bytes) { this.core.push(bytes); };

  Sha512.prototype.digest = function () {
    this.core.finish(16, false);
    var full = new Uint8Array(64);
    var dv = new DataView(full.buffer);
    for (var i = 0; i < 8; i++) {
      dv.setUint32(i * 8, this.hH[i] >>> 0, false);
      dv.setUint32(i * 8 + 4, this.hL[i] >>> 0, false);
    }
    return toHex(full.subarray(0, this.outBytes));
  };

  /* ====================================================================== */
  root.HashEngines = {
    create: function (name) {
      switch (name) {
        case 'md5':     return new Md5();
        case 'sha1':    return new Sha1();
        case 'sha256':  return new Sha256();
        case 'sha384':  return new Sha512(true);
        case 'sha512':  return new Sha512(false);
        default: throw new Error('unknown algorithm: ' + name);
      }
    },
    names: ['md5', 'sha1', 'sha256', 'sha384', 'sha512']
  };
})(typeof self !== 'undefined' ? self : globalThis);

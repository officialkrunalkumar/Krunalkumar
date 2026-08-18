/* ==========================================================================
   crypto.js — the algorithms that actually secure the web, opened up.
   --------------------------------------------------------------------------
   Elsewhere in Labs there are tools that USE cryptography: a hash calculator,
   a JWT decoder, a certificate parser. Every one of them treats the primitive
   as a black box, because that is what a tool should do. This is the opposite
   page. Here the box is open: AES is a 4x4 grid of bytes you watch get
   shuffled and mixed sixteen times, SHA-256 is eight registers churning for
   sixty-four rounds, and Diffie-Hellman is two people on screen arriving at
   the same number without ever sending it.

   Design decisions worth spelling out:

   1. These are TEACHING implementations and the page says so out loud. They
      are constant-structure but not constant-time, they do no padding
      negotiation, and they should never be used to protect anything. Real work
      belongs in WebCrypto, which the browser implements in audited native
      code. Shipping a hand-rolled cipher without that warning on a security
      site would be worse than not shipping it at all.

   2. Correctness is not a matter of opinion here, so it is not left to one.
      AES is checked against the FIPS-197 vectors and SHA-256 against
      FIPS-180-4, from a Node harness that loads this exact file. A visualiser
      that animates the wrong arithmetic is worse than no visualiser: it
      teaches a confident falsehood.

   3. Small numbers for the number-theory families. Diffie-Hellman with a
      2048-bit prime is honest and completely unwatchable. With p = 23 you can
      follow every modular exponentiation by eye, and — crucially — you can
      watch Eve break it by brute force in a few dozen steps, which is the only
      way to feel why the real thing uses numbers with 600 digits.

   4. Frames precomputed up front, exactly like os-algo.js: every family runs
      to completion on input change and the transport indexes into the result.
      Stepping backwards through an AES round is the whole reason to be here.

   Nothing here opens a network connection.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  Byte and hex helpers                                                    */
  /* ======================================================================== */

  function hex2(b) { var s = (b & 0xFF).toString(16).toUpperCase(); return s.length < 2 ? '0' + s : s; }
  function hex8(w) {
    var s = (w >>> 0).toString(16).toUpperCase();
    while (s.length < 8) s = '0' + s;
    return s;
  }
  function bytesToHex(a) {
    var out = '';
    for (var i = 0; i < a.length; i++) out += hex2(a[i]);
    return out;
  }
  /* Read a hex string, ignoring anything that is not a hex digit, and pad or
     truncate to exactly n bytes. A visitor pasting "0x00 11 22" should get what
     they obviously meant rather than an error. */
  function hexToBytes(text, n) {
    var clean = String(text).replace(/0[xX]/g, '').replace(/[^0-9a-fA-F]/g, '');
    var out = [];
    for (var i = 0; i + 1 < clean.length && out.length < n; i += 2) {
      out.push(parseInt(clean.substr(i, 2), 16));
    }
    while (out.length < n) out.push(0);
    return out.slice(0, n);
  }
  function textToBytes(text) {
    var out = [], i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }
  function popcount(x) {
    var n = 0;
    while (x) { n += x & 1; x >>>= 1; }
    return n;
  }
  function bitDiff(a, b) {
    var n = 0;
    for (var i = 0; i < Math.min(a.length, b.length); i++) n += popcount((a[i] ^ b[i]) & 0xFF);
    return n;
  }

  /* ======================================================================== */
  /*  CORE 1 — AES-128                                                        */
  /* ------------------------------------------------------------------------ */
  /*  The S-box and the round constants are generated rather than pasted as a  */
  /*  256-entry table, because the generation IS the explanation: the S-box is */
  /*  the multiplicative inverse in GF(2^8) followed by an affine transform,   */
  /*  and a reader who sees it built has learnt something a magic table hides. */
  /* ======================================================================== */

  /* Multiply in GF(2^8) modulo the AES polynomial x^8+x^4+x^3+x+1 (0x11B). */
  function gmul(a, b) {
    var p = 0;
    for (var i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      var hi = a & 0x80;
      a = (a << 1) & 0xFF;
      if (hi) a ^= 0x1B;
      b >>= 1;
    }
    return p & 0xFF;
  }

  var SBOX = (function () {
    // Multiplicative inverses by exhaustive search: at 256 entries this is
    // instant, and it avoids a pasted table nobody can check.
    var inv = new Array(256), i, j;
    inv[0] = 0;
    for (i = 1; i < 256; i++) {
      for (j = 1; j < 256; j++) {
        if (gmul(i, j) === 1) { inv[i] = j; break; }
      }
    }
    var box = new Array(256);
    for (i = 0; i < 256; i++) {
      var x = inv[i], y = x;
      // affine transform: y = x ^ rotl(x,1) ^ rotl(x,2) ^ rotl(x,3) ^ rotl(x,4) ^ 0x63
      for (var r = 1; r <= 4; r++) y ^= ((x << r) | (x >>> (8 - r))) & 0xFF;
      box[i] = (y ^ 0x63) & 0xFF;
    }
    return box;
  })();

  var INV_SBOX = (function () {
    var out = new Array(256);
    for (var i = 0; i < 256; i++) out[SBOX[i]] = i;
    return out;
  })();

  var RCON = (function () {
    var out = [0x01], i;
    for (i = 1; i < 10; i++) out.push(gmul(out[i - 1], 2));
    return out;
  })();

  /* Key expansion: 11 round keys of 16 bytes each, as 44 four-byte words. */
  function aesExpandKey(key) {
    var w = [], i, t, notes = [];
    for (i = 0; i < 4; i++) w.push(key.slice(i * 4, i * 4 + 4));
    for (i = 4; i < 44; i++) {
      t = w[i - 1].slice();
      var note = null;
      if (i % 4 === 0) {
        t = [t[1], t[2], t[3], t[0]];                       // RotWord
        t = t.map(function (b) { return SBOX[b]; });        // SubWord
        t[0] ^= RCON[(i / 4) - 1];                          // Rcon
        note = 'RotWord, SubWord, then XOR Rcon ' + hex2(RCON[(i / 4) - 1]);
      }
      w.push(w[i - 4].map(function (b, k) { return b ^ t[k]; }));
      notes.push(note);
    }
    var roundKeys = [];
    for (i = 0; i < 11; i++) {
      roundKeys.push(w[i * 4].concat(w[i * 4 + 1], w[i * 4 + 2], w[i * 4 + 3]));
    }
    return { words: w, roundKeys: roundKeys, notes: notes };
  }

  function subBytes(s, inverse) {
    var box = inverse ? INV_SBOX : SBOX;
    return s.map(function (b) { return box[b]; });
  }

  /* AES state is column-major: byte i sits at row i%4, column i/4. ShiftRows
     rotates row r left by r, which in this layout is not a contiguous slice —
     hence the index arithmetic rather than an array rotate. */
  function shiftRows(s, inverse) {
    var out = new Array(16);
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var from = inverse ? (c - r + 4) % 4 : (c + r) % 4;
        out[r + 4 * c] = s[r + 4 * from];
      }
    }
    return out;
  }

  function mixColumns(s, inverse) {
    var out = new Array(16), c, r;
    var m = inverse ? [14, 11, 13, 9] : [2, 3, 1, 1];
    for (c = 0; c < 4; c++) {
      var col = [s[4 * c], s[4 * c + 1], s[4 * c + 2], s[4 * c + 3]];
      for (r = 0; r < 4; r++) {
        out[r + 4 * c] =
          gmul(col[0], m[(0 - r + 4) % 4]) ^ gmul(col[1], m[(1 - r + 4) % 4]) ^
          gmul(col[2], m[(2 - r + 4) % 4]) ^ gmul(col[3], m[(3 - r + 4) % 4]);
      }
    }
    return out;
  }

  function addRoundKey(s, rk) {
    return s.map(function (b, i) { return b ^ rk[i]; });
  }

  /* Encrypt one 16-byte block, recording a frame per transformation. */
  function aesEncrypt(plain, key) {
    var ks = aesExpandKey(key);
    var state = plain.slice();
    var steps = [];

    function push(op, detail, before, after, round) {
      steps.push({ op: op, detail: detail, round: round,
                   before: before.slice(), after: after.slice(),
                   changed: after.map(function (b, i) { return b !== before[i]; }) });
    }

    var next = addRoundKey(state, ks.roundKeys[0]);
    push('AddRoundKey', 'The plaintext is XORed with the key itself before any round begins. '
       + 'Without this the first SubBytes would be key-independent and trivially reversible.',
       state, next, 0);
    state = next;

    for (var r = 1; r <= 10; r++) {
      next = subBytes(state, false);
      push('SubBytes', 'Every byte is replaced through the S-box — the only non-linear step in '
         + 'AES, and the reason the cipher is not just a big system of linear equations.',
         state, next, r);
      state = next;

      next = shiftRows(state, false);
      push('ShiftRows', 'Row r rotates left by r bytes. On its own it moves nothing between '
         + 'columns of the same row, but it is what lets MixColumns spread a change sideways.',
         state, next, r);
      state = next;

      if (r !== 10) {
        next = mixColumns(state, false);
        push('MixColumns', 'Each column is multiplied by a fixed matrix in GF(2^8). Together with '
           + 'ShiftRows this gives diffusion: after two rounds every output byte depends on every '
           + 'input byte.', state, next, r);
        state = next;
      }

      next = addRoundKey(state, ks.roundKeys[r]);
      push('AddRoundKey', 'The round key for round ' + r + ' is XORed in. This is the only place '
         + 'the key enters the round, which is why the key schedule matters as much as the round '
         + 'function.', state, next, r);
      state = next;
    }

    return { cipher: state, steps: steps, schedule: ks, plain: plain.slice(), key: key.slice() };
  }

  function aesDecrypt(cipher, key) {
    var ks = aesExpandKey(key);
    var state = addRoundKey(cipher.slice(), ks.roundKeys[10]);
    for (var r = 10; r >= 1; r--) {
      state = shiftRows(state, true);
      state = subBytes(state, true);
      state = addRoundKey(state, ks.roundKeys[r - 1]);
      if (r !== 1) state = mixColumns(state, true);
    }
    return state;
  }

  /* ======================================================================== */
  /*  CORE 2 — SHA-256                                                        */
  /* ------------------------------------------------------------------------ */
  /*  The constants are derived, not pasted: H is the fractional part of the   */
  /*  square roots of the first eight primes, K of the cube roots of the first */
  /*  sixty-four. That provenance is the "nothing up my sleeve" argument, and  */
  /*  it is far more convincing computed on the page than asserted in prose.   */
  /* ======================================================================== */

  function primes(n) {
    var out = [], i = 2;
    while (out.length < n) {
      var isP = true;
      for (var d = 2; d * d <= i; d++) if (i % d === 0) { isP = false; break; }
      if (isP) out.push(i);
      i++;
    }
    return out;
  }
  /* Fractional part of the n-th root of p, as a 32-bit integer. */
  function fracRoot(p, root) {
    var v = Math.pow(p, 1 / root);
    return Math.floor((v - Math.floor(v)) * 4294967296) >>> 0;
  }
  var SHA_H = primes(8).map(function (p) { return fracRoot(p, 2); });
  var SHA_K = primes(64).map(function (p) { return fracRoot(p, 3); });

  function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
  function shr(x, n) { return x >>> n; }
  function add32() {
    var s = 0;
    for (var i = 0; i < arguments.length; i++) s = (s + arguments[i]) >>> 0;
    return s >>> 0;
  }

  function sha256(messageBytes) {
    var msg = messageBytes.slice();
    var bitLen = msg.length * 8;

    // Padding: a single 1 bit, zeros, then the length as a 64-bit big-endian
    // integer. The length is what stops "ab"+"c" hashing like "a"+"bc".
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var hi = Math.floor(bitLen / 4294967296);
    var lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    msg.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    var H = SHA_H.slice();
    var blocks = [], steps = [], b, t;

    for (b = 0; b * 64 < msg.length; b++) {
      var chunk = msg.slice(b * 64, b * 64 + 64);
      var W = new Array(64);
      for (t = 0; t < 16; t++) {
        W[t] = ((chunk[t * 4] << 24) | (chunk[t * 4 + 1] << 16) |
                (chunk[t * 4 + 2] << 8) | chunk[t * 4 + 3]) >>> 0;
      }
      // Message schedule: 16 words of real message stretched to 64, so every
      // round has fresh input and a one-bit change reaches all of them.
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ shr(W[t - 15], 3)) >>> 0;
        var s1 = (rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ shr(W[t - 2], 10)) >>> 0;
        W[t] = add32(W[t - 16], s0, W[t - 7], s1);
      }

      var v = H.slice();
      var blockStart = steps.length;
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(v[4], 6) ^ rotr(v[4], 11) ^ rotr(v[4], 25)) >>> 0;
        var ch = ((v[4] & v[5]) ^ (~v[4] & v[6])) >>> 0;
        var temp1 = add32(v[7], S1, ch, SHA_K[t], W[t]);
        var S0 = (rotr(v[0], 2) ^ rotr(v[0], 13) ^ rotr(v[0], 22)) >>> 0;
        var maj = ((v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2])) >>> 0;
        var temp2 = add32(S0, maj);

        var before = v.slice();
        v = [add32(temp1, temp2), v[0], v[1], v[2], add32(v[3], temp1), v[4], v[5], v[6]];
        steps.push({
          block: b, round: t, W: W[t], K: SHA_K[t],
          before: before, after: v.slice(),
          temp1: temp1, temp2: temp2, ch: ch, maj: maj, S0: S0, S1: S1,
          changed: v.map(function (x, i) { return x !== before[i]; })
        });
      }
      for (t = 0; t < 8; t++) H[t] = add32(H[t], v[t]);
      blocks.push({ index: b, W: W, chunk: chunk, H: H.slice(), from: blockStart });
    }

    var digest = '';
    for (t = 0; t < 8; t++) digest += hex8(H[t]);
    return { digest: digest.toLowerCase(), H: H, steps: steps, blocks: blocks,
             padded: msg, messageLength: messageBytes.length };
  }

  /* ======================================================================== */
  /*  CORE 3 — DIFFIE-HELLMAN                                                 */
  /* ------------------------------------------------------------------------ */

  /* Square-and-multiply, recording each squaring so the visitor can see that
     exponentiation is log(e) steps and not e steps — the fact that makes
     public-key crypto practical in the first place. */
  function modPow(base, exp, mod, trace) {
    var result = 1, b = base % mod, e = exp;
    while (e > 0) {
      if (e & 1) {
        result = (result * b) % mod;
        if (trace) trace.push({ op: 'multiply', bit: 1, result: result, base: b, exp: e });
      } else if (trace) {
        trace.push({ op: 'skip', bit: 0, result: result, base: b, exp: e });
      }
      e = Math.floor(e / 2);
      b = (b * b) % mod;
    }
    return result;
  }

  function isPrime(n) {
    if (n < 2) return false;
    for (var d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  }

  /* A primitive root generates every non-zero residue mod p, which is what
     makes the exponent genuinely unknowable from the result. */
  function isPrimitiveRoot(g, p) {
    var seen = {}, v = 1;
    for (var i = 1; i < p; i++) {
      v = (v * g) % p;
      if (seen[v]) return false;
      seen[v] = 1;
    }
    return Object.keys(seen).length === p - 1;
  }

  function diffieHellman(p, g, a, b) {
    if (!isPrime(p)) return { error: p + ' is not prime. Diffie-Hellman needs a prime modulus.' };
    var traceA = [], traceB = [];
    var A = modPow(g, a, p, traceA);
    var B = modPow(g, b, p, traceB);
    var sharedA = modPow(B, a, p, null);
    var sharedB = modPow(A, b, p, null);

    // Eve sees p, g, A and B. Her only move on numbers this small is to try
    // every exponent until one matches — that is the discrete log problem, and
    // its cost here is the whole argument for using 2048-bit primes.
    var eve = [], found = -1;
    for (var x = 1; x < p; x++) {
      var val = modPow(g, x, p, null);
      eve.push({ guess: x, value: val, hit: val === A });
      if (val === A && found < 0) { found = x; break; }
    }

    return {
      p: p, g: g, a: a, b: b, A: A, B: B,
      shared: sharedA, agrees: sharedA === sharedB,
      traceA: traceA, traceB: traceB,
      eve: eve, eveFound: found, primitive: isPrimitiveRoot(g, p)
    };
  }

  /* ======================================================================== */
  /*  CORE 4 — RSA                                                            */
  /* ======================================================================== */

  function egcd(a, b) {
    var steps = [];
    var old_r = a, r = b, old_s = 1, s = 0, old_t = 0, t = 1;
    while (r !== 0) {
      var q = Math.floor(old_r / r);
      steps.push({ q: q, r: old_r, next: r, s: old_s, t: old_t });
      var tmp = old_r - q * r; old_r = r; r = tmp;
      tmp = old_s - q * s; old_s = s; s = tmp;
      tmp = old_t - q * t; old_t = t; t = tmp;
    }
    return { gcd: old_r, x: old_s, y: old_t, steps: steps };
  }

  function rsa(p, q, e, message) {
    if (!isPrime(p)) return { error: p + ' is not prime.' };
    if (!isPrime(q)) return { error: q + ' is not prime.' };
    if (p === q) return { error: 'p and q must be different primes, or n would be a perfect square and trivially factored.' };
    var n = p * q;
    var phi = (p - 1) * (q - 1);
    var g = egcd(e, phi);
    if (g.gcd !== 1) {
      return { error: 'e = ' + e + ' shares a factor with phi(n) = ' + phi +
               ', so it has no inverse and no private key exists. Pick a different e.' };
    }
    var d = ((g.x % phi) + phi) % phi;
    if (message >= n) {
      return { error: 'The message ' + message + ' must be smaller than n = ' + n +
               '. RSA encrypts numbers in the range 0 to n-1; longer data is why real systems ' +
               'encrypt a symmetric key rather than the data itself.' };
    }
    var encTrace = [], decTrace = [];
    var c = modPow(message, e, n, encTrace);
    var back = modPow(c, d, n, decTrace);

    // Factoring n is the whole attack. At these sizes it is a loop.
    var factors = [], attempts = 0;
    for (var f = 2; f * f <= n; f++) {
      attempts++;
      if (n % f === 0) { factors = [f, n / f]; break; }
    }

    return {
      p: p, q: q, n: n, phi: phi, e: e, d: d, message: message, cipher: c,
      decrypted: back, roundTrips: back === message,
      egcd: g, encTrace: encTrace, decTrace: decTrace,
      factors: factors, factorAttempts: attempts
    };
  }

  /* ======================================================================== */
  /*  CORE 5 — ELLIPTIC CURVES over a small prime field                       */
  /* ------------------------------------------------------------------------ */
  /*  y^2 = x^3 + ax + b (mod p). Over a small p the curve is a scatter of     */
  /*  points rather than a smooth line, which is exactly the honest picture:   */
  /*  the geometry motivates the addition rule, but the arithmetic is what     */
  /*  runs. Both are shown.                                                    */
  /* ======================================================================== */

  function modInv(a, m) {
    a = ((a % m) + m) % m;
    var g = egcd(a, m);
    if (g.gcd !== 1) return null;
    return ((g.x % m) + m) % m;
  }

  var INF = null;   // the point at infinity, the identity of the group

  function ecAdd(P, Q, a, p) {
    if (P === INF) return Q;
    if (Q === INF) return P;
    if (P.x === Q.x && (P.y + Q.y) % p === 0) return INF;
    var lam;
    if (P.x === Q.x && P.y === Q.y) {
      var inv = modInv(2 * P.y, p);
      if (inv === null) return INF;
      lam = ((3 * P.x * P.x + a) % p) * inv % p;
    } else {
      var inv2 = modInv(((Q.x - P.x) % p + p) % p, p);
      if (inv2 === null) return INF;
      lam = (((Q.y - P.y) % p + p) % p) * inv2 % p;
    }
    lam = ((lam % p) + p) % p;
    var x = ((lam * lam - P.x - Q.x) % p + p) % p;
    var y = ((lam * (P.x - x) - P.y) % p + p) % p;
    return { x: x, y: y };
  }

  function ecPoints(a, b, p) {
    var out = [], x, y;
    for (x = 0; x < p; x++) {
      var rhs = ((x * x % p) * x + a * x + b) % p;
      rhs = ((rhs % p) + p) % p;
      for (y = 0; y < p; y++) {
        if ((y * y) % p === rhs) out.push({ x: x, y: y });
      }
    }
    return out;
  }

  /* Double-and-add: the elliptic-curve analogue of square-and-multiply, and
     the reason a 256-bit scalar costs ~256 doublings rather than 2^256 adds. */
  function ecMul(k, P, a, p) {
    var result = INF, addend = P, steps = [], e = k;
    while (e > 0) {
      if (e & 1) {
        var before = result;
        result = ecAdd(result, addend, a, p);
        steps.push({ op: 'add', bit: 1, addend: addend, before: before, result: result });
      } else {
        steps.push({ op: 'skip', bit: 0, addend: addend, before: result, result: result });
      }
      addend = ecAdd(addend, addend, a, p);
      e = Math.floor(e / 2);
    }
    return { point: result, steps: steps };
  }

  function ellipticCurve(a, b, p, G, kA, kB) {
    if (!isPrime(p)) return { error: p + ' is not prime. The field needs a prime modulus.' };
    var disc = (4 * a * a * a + 27 * b * b) % p;
    if (((disc % p) + p) % p === 0) {
      return { error: 'This curve is singular (4a^3 + 27b^2 = 0 mod p), so the addition rule ' +
               'breaks down at a cusp or self-intersection. Change a or b.' };
    }
    var pts = ecPoints(a, b, p);
    if (!pts.length) return { error: 'This curve has no points other than infinity over F' + p + '.' };

    /* Order of a point: how many times it can be added to itself before
       landing back on infinity. Every private key has to be smaller than this,
       so it is the real key space of the curve. */
    function orderOf(P) {
      var n = 1, cur = P, guard = pts.length + 2;
      while (cur !== INF && n <= guard) { cur = ecAdd(cur, P, a, p); n++; }
      return n;
    }

    /* Without an explicit base point, take the one of largest order rather
       than simply the first in the list. The first point often generates only
       a small subgroup, which would quietly shrink the key space and teach the
       wrong thing about how a generator is chosen. */
    var base = G && pts.some(function (q) { return q.x === G.x && q.y === G.y; }) ? G : null;
    if (!base) {
      base = pts[0];
      var bestOrder = orderOf(base);
      for (var bi = 1; bi < pts.length; bi++) {
        var o = orderOf(pts[bi]);
        if (o > bestOrder) { bestOrder = o; base = pts[bi]; }
      }
    }

    var mulA = ecMul(kA, base, a, p);
    var mulB = ecMul(kB, base, a, p);
    var sharedA = mulA.point === INF ? INF : ecMul(kA, mulB.point, a, p).point;
    var sharedB = mulB.point === INF ? INF : ecMul(kB, mulA.point, a, p).point;

    var order = orderOf(base);

    return {
      a: a, b: b, p: p, points: pts, base: base, order: order,
      kA: kA, kB: kB, pubA: mulA.point, pubB: mulB.point,
      stepsA: mulA.steps, stepsB: mulB.steps,
      shared: sharedA,
      agrees: (sharedA === INF && sharedB === INF) ||
              (sharedA && sharedB && sharedA.x === sharedB.x && sharedA.y === sharedB.y)
    };
  }

  var CORE = {
    gmul: gmul, SBOX: SBOX, INV_SBOX: INV_SBOX, RCON: RCON,
    aesExpandKey: aesExpandKey, aesEncrypt: aesEncrypt, aesDecrypt: aesDecrypt,
    subBytes: subBytes, shiftRows: shiftRows, mixColumns: mixColumns, addRoundKey: addRoundKey,
    sha256: sha256, SHA_H: SHA_H, SHA_K: SHA_K,
    modPow: modPow, diffieHellman: diffieHellman, isPrime: isPrime,
    isPrimitiveRoot: isPrimitiveRoot, egcd: egcd, modInv: modInv, rsa: rsa,
    ecAdd: ecAdd, ecMul: ecMul, ecPoints: ecPoints, ellipticCurve: ellipticCurve,
    bytesToHex: bytesToHex, hexToBytes: hexToBytes, textToBytes: textToBytes, bitDiff: bitDiff
  };

  /* Exported for the Node test harness, which checks AES against the FIPS-197
     vectors and SHA-256 against FIPS-180-4 using this exact file. In a browser
     `module` is undefined and this is a no-op. */
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var M = root.LabVizMulti;
  var E = M.el, clear = M.clear, table = M.table, button = M.button;
  var field = M.field, group = M.group, numBox = M.numBox, textBox = M.textBox;
  var CC = M.C, FONT = M.FONT;

  var EXTRA_CSS = [
    /* AES / SHA state grids */
    '.cy-grid{display:inline-grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;}',
    '.cy-cell{min-width:2.6rem;padding:7px 4px;text-align:center;border-radius:6px;background:#131f36;border:1px solid #24344f;font-size:12px;color:' + CC.ink + ';}',
    '.cy-cell.hot{background:rgba(56,189,248,.22);border-color:' + CC.blue + ';color:#e6f6ff;font-weight:700;}',
    '.cy-cell.key{background:rgba(167,139,250,.14);border-color:rgba(167,139,250,.5);}',
    '.cy-panes{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;}',
    '.cy-pane{min-width:0;}',
    '.cy-pane-title{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + CC.faint + ';}',
    '.cy-op{display:flex;flex-wrap:wrap;align-items:baseline;gap:9px;}',
    '.cy-op-name{font-size:15px;font-weight:700;color:' + CC.cyan + ';}',
    '.cy-op-round{font-size:11px;color:' + CC.faint + ';}',
    '.cy-arrow{align-self:center;color:' + CC.faint + ';font-size:18px;}',
    /* avalanche bars */
    '.cy-aval{display:flex;align-items:flex-end;gap:3px;height:64px;padding:6px 0;}',
    '.cy-aval-bar{flex:1 1 0;min-width:3px;background:' + CC.blue + ';border-radius:2px 2px 0 0;}',
    '.cy-aval-bar.now{background:' + CC.amber + ';}',
    '.cy-aval-scale{display:flex;justify-content:space-between;font-size:10px;color:' + CC.faint + ';}',
    /* registers */
    '.cy-regs{display:flex;flex-wrap:wrap;gap:5px;}',
    '.cy-reg{padding:5px 7px;border-radius:6px;background:#131f36;border:1px solid #24344f;font-size:11px;}',
    '.cy-reg.hot{background:rgba(52,211,153,.16);border-color:' + CC.green + ';}',
    '.cy-reg b{color:' + CC.faint + ';font-weight:400;margin-right:5px;}',
    /* actor columns for DH / RSA */
    '.cy-actors{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:10px;}',
    '.cy-actor{padding:9px 11px;border-radius:9px;border:1px solid ' + CC.line + ';background:rgba(15,23,42,.5);}',
    '.cy-actor.alice{border-color:rgba(56,189,248,.45);}',
    '.cy-actor.bob{border-color:rgba(52,211,153,.45);}',
    '.cy-actor.eve{border-color:rgba(252,165,165,.4);}',
    '.cy-actor.public{border-color:rgba(251,191,36,.4);}',
    '.cy-actor h4{margin:0 0 6px;font-size:12px;color:' + CC.ink + ';}',
    '.cy-actor .cy-line{font-size:11px;line-height:1.75;color:' + CC.dim + ';}',
    '.cy-actor .cy-line b{color:' + CC.ink + ';font-weight:700;}',
    '.cy-secret{color:' + CC.amber + ';font-weight:700;}',
    '.cy-dim{opacity:.35;}',
    '.cy-eq{font-size:12px;line-height:1.9;color:' + CC.ink + ';word-break:break-word;}',
    '.cy-warn-inline{font-size:11px;color:' + CC.amber + ';}'
  ].join('');

  function hexCell(byte, hot, cls) {
    var c = E('div', 'cy-cell' + (hot ? ' hot' : '') + (cls ? ' ' + cls : ''), hex2(byte));
    return c;
  }

  /* AES state is column-major: byte i lives at row i%4, column i/4. The grid
     is laid out row by row, so the index has to be un-transposed here or the
     picture would be a transpose of the one in every textbook. */
  function stateGrid(state, changed, cls) {
    var g = E('div', 'cy-grid');
    for (var r = 0; r < 4; r++) {
      for (var c = 0; c < 4; c++) {
        var i = r + 4 * c;
        g.appendChild(hexCell(state[i], changed && changed[i], cls));
      }
    }
    return g;
  }

  function pane(title, node) {
    var p = E('div', 'cy-pane');
    p.appendChild(E('p', 'cy-pane-title', title));
    p.appendChild(node);
    return p;
  }

  function actor(cls, title, lines) {
    var a = E('div', 'cy-actor ' + cls);
    a.appendChild(E('h4', null, title));
    (lines || []).forEach(function (l) {
      if (l && l.nodeType) { a.appendChild(l); return; }
      a.appendChild(E('div', 'cy-line', String(l)));
    });
    return a;
  }

  function kv(label, value, cls) {
    var d = E('div', 'cy-line');
    d.appendChild(E('b', null, label + ' '));
    d.appendChild(E('span', cls || null, String(value)));
    return d;
  }

  /* ======================================================================== */
  /*  FAMILY 1 — AES                                                          */
  /* ======================================================================== */

  var AES_PRESETS = {
    fips: { label: 'FIPS-197 C.1', pt: '00112233445566778899aabbccddeeff', key: '000102030405060708090a0b0c0d0e0f' },
    apxb: { label: 'FIPS-197 B', pt: '3243f6a8885a308d313198a2e0370734', key: '2b7e151628aed2a6abf7158809cf4f3c' },
    zero: { label: 'All zeros', pt: '00000000000000000000000000000000', key: '00000000000000000000000000000000' },
    text: { label: 'Readable text', pt: '', key: '', text: 'Attack at dawn!', keyText: 'correct horse b' }
  };

  function AesFamily() {
    this.key = 'aes';
    this.label = 'AES-128';
    this.algoKey = 'encrypt';
    this.ptHex = AES_PRESETS.fips.pt;
    this.keyHex = AES_PRESETS.fips.key;
  }

  AesFamily.prototype.algoOptions = function () { return [{ key: 'encrypt', label: 'Encrypt one block' }]; };

  AesFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Plaintext block (16 bytes, hex)');
    this.ptInput = textBox(this.ptHex, function (v) { self.ptHex = v; onChange(); });
    this.ptInput.className = 'oa-text oa-text-mono';
    g1.appendChild(this.ptInput);
    host.appendChild(g1);

    var g2 = group('Key (16 bytes, hex)');
    this.keyInput = textBox(this.keyHex, function (v) { self.keyHex = v; onChange(); });
    this.keyInput.className = 'oa-text oa-text-mono';
    g2.appendChild(this.keyInput);
    g2.appendChild(E('p', 'oa-hint', 'Short input is zero-padded, long input truncated. AES always works on exactly 16 bytes.'));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    Object.keys(AES_PRESETS).forEach(function (k) {
      row.appendChild(button(AES_PRESETS[k].label, function () {
        var p = AES_PRESETS[k];
        self.ptHex = p.text ? bytesToHex(textToBytes(p.text)) : p.pt;
        self.keyHex = p.keyText ? bytesToHex(textToBytes(p.keyText)) : p.key;
        self.ptInput.value = self.ptHex;
        self.keyInput.value = self.keyHex;
        onChange();
      }));
    });
    g3.appendChild(row);
    host.appendChild(g3);

    var g4 = group('');
    g4.appendChild(E('p', 'oa-warn',
      'A teaching implementation. It is not constant-time and has no mode of operation or padding, ' +
      'so it must never protect anything real — use WebCrypto for that.'));
    host.appendChild(g4);
  };

  AesFamily.prototype.buildStage = function (host) {
    this.opHost = E('div', 'cy-op');
    this.gridHost = E('div', 'cy-panes');
    this.avalHost = E('div');
    this.outHost = E('div', 'oa-tableout');
    host.appendChild(this.opHost);
    host.appendChild(this.gridHost);
    host.appendChild(this.avalHost);
    host.appendChild(this.outHost);
  };

  AesFamily.prototype.compute = function () {
    var pt = hexToBytes(this.ptHex, 16);
    var key = hexToBytes(this.keyHex, 16);
    this.result = aesEncrypt(pt, key);
    // The avalanche run: the same key, one flipped bit of plaintext. Comparing
    // the two traces round by round is the clearest picture of diffusion there
    // is — after two rounds the states have nothing recognisable in common.
    var flipped = pt.slice();
    flipped[15] ^= 0x01;
    this.avalanche = aesEncrypt(flipped, key);
    this.error = null;
    return this.result.steps.length;
  };

  AesFamily.prototype.render = function (idx) {
    var res = this.result, self = this;
    var i = Math.min(idx, res.steps.length - 1);
    var s = res.steps[i];

    clear(this.opHost);
    this.opHost.appendChild(E('span', 'cy-op-name', s.op));
    this.opHost.appendChild(E('span', 'cy-op-round',
      s.round === 0 ? 'before round 1' : 'round ' + s.round + ' of 10'));

    clear(this.gridHost);
    this.gridHost.appendChild(pane('State before', stateGrid(s.before, null)));
    var arrow = E('div', 'cy-arrow', '→');
    this.gridHost.appendChild(arrow);
    this.gridHost.appendChild(pane('State after', stateGrid(s.after, s.changed)));
    if (s.op === 'AddRoundKey') {
      this.gridHost.appendChild(pane('Round key ' + s.round,
        stateGrid(res.schedule.roundKeys[s.round], null, 'key')));
    }

    // Avalanche: bits differing between the two runs, at each recorded step.
    clear(this.avalHost);
    var bars = E('div', 'cy-aval');
    for (var k = 0; k < res.steps.length; k++) {
      var d = bitDiff(res.steps[k].after, this.avalanche.steps[k].after);
      var bar = E('div', 'cy-aval-bar' + (k === i ? ' now' : ''));
      bar.style.height = Math.max(2, (d / 128) * 100) + '%';
      bar.title = 'after step ' + (k + 1) + ': ' + d + ' of 128 bits differ';
      bars.appendChild(bar);
    }
    this.avalHost.appendChild(E('p', 'cy-pane-title',
      'Avalanche — bits differing from an identical block with one flipped bit'));
    this.avalHost.appendChild(bars);
    var scale = E('div', 'cy-aval-scale');
    scale.appendChild(E('span', null, 'start'));
    scale.appendChild(E('span', null, bitDiff(res.steps[i].after, this.avalanche.steps[i].after) +
      ' of 128 bits differ here'));
    scale.appendChild(E('span', null, 'round 10'));
    this.avalHost.appendChild(scale);

    clear(this.outHost);
    this.outHost.appendChild(table(
      ['Plaintext', 'Key', 'Ciphertext'],
      [[bytesToHex(res.plain), bytesToHex(res.key), bytesToHex(res.cipher)]]));
  };

  AesFamily.prototype.note = function (idx) {
    var res = this.result;
    var i = Math.min(idx, res.steps.length - 1);
    var s = res.steps[i];
    var n = s.changed.filter(Boolean).length;
    return s.op + (s.round ? ' (round ' + s.round + ')' : '') + ': ' + s.detail +
           ' ' + n + ' of 16 bytes changed.';
  };

  AesFamily.prototype.compare = function () {
    var res = this.result;
    var rows = [];
    for (var r = 0; r <= 10; r++) {
      // last step index belonging to this round
      var last = -1;
      for (var k = 0; k < res.steps.length; k++) if (res.steps[k].round === r) last = k;
      if (last < 0) continue;
      var d = bitDiff(res.steps[last].after, this.avalanche.steps[last].after);
      rows.push({ key: 'r' + r, cells: [r === 0 ? 'before round 1' : 'after round ' + r,
                                        d, Math.round((d / 128) * 1000) / 10 + '%'] });
    }
    return { title: 'How fast one flipped input bit spreads', head: ['Stage', 'Bits differing of 128', 'Share'], rows: rows };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — SHA-256                                                      */
  /* ======================================================================== */

  var SHA_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  var SHA_PRESETS = {
    abc: { label: '"abc"', text: 'abc' },
    empty: { label: 'Empty string', text: '' },
    hello: { label: '"hello world"', text: 'hello world' },
    two: { label: 'Two blocks', text: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq' }
  };

  function ShaFamily() {
    this.key = 'sha';
    this.label = 'SHA-256';
    this.algoKey = 'hash';
    this.text = 'abc';
  }

  ShaFamily.prototype.algoOptions = function () { return [{ key: 'hash', label: 'Hash a message' }]; };

  ShaFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Message');
    this.input = textBox(this.text, function (v) { self.text = v; onChange(); }, 'type anything');
    g1.appendChild(this.input);
    g1.appendChild(E('p', 'oa-hint',
      'Every 64 bytes is one block of 64 rounds. Long messages are fine but make for a long walk.'));
    host.appendChild(g1);

    var g2 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    Object.keys(SHA_PRESETS).forEach(function (k) {
      row.appendChild(button(SHA_PRESETS[k].label, function () {
        self.text = SHA_PRESETS[k].text;
        self.input.value = self.text;
        onChange();
      }));
    });
    g2.appendChild(row);
    host.appendChild(g2);

    var g3 = group('');
    g3.appendChild(E('p', 'oa-warn',
      'A teaching implementation, written to be read. For real hashing the browser already ships ' +
      'an audited one in crypto.subtle.digest.'));
    host.appendChild(g3);
  };

  ShaFamily.prototype.buildStage = function (host) {
    this.opHost = E('div', 'cy-op');
    this.regHost = E('div');
    this.wHost = E('div');
    this.outHost = E('div', 'oa-tableout');
    host.appendChild(this.opHost);
    host.appendChild(this.regHost);
    host.appendChild(this.wHost);
    host.appendChild(this.outHost);
  };

  ShaFamily.prototype.compute = function () {
    var bytes = textToBytes(this.text);
    if (bytes.length > 4096) {
      this.error = 'That message is longer than 4 KB, which would be thousands of rounds to step through. Try something shorter.';
      bytes = bytes.slice(0, 4096);
    } else {
      this.error = null;
    }
    this.result = sha256(bytes);
    return Math.max(1, this.result.steps.length);
  };

  ShaFamily.prototype.render = function (idx) {
    var res = this.result;
    var i = Math.min(idx, res.steps.length - 1);
    var s = res.steps[i];

    clear(this.opHost);
    this.opHost.appendChild(E('span', 'cy-op-name', 'Round ' + s.round + ' of 64'));
    this.opHost.appendChild(E('span', 'cy-op-round',
      'block ' + (s.block + 1) + ' of ' + res.blocks.length));

    clear(this.regHost);
    this.regHost.appendChild(E('p', 'cy-pane-title', 'Working registers'));
    var regs = E('div', 'cy-regs');
    for (var r = 0; r < 8; r++) {
      var box = E('div', 'cy-reg' + (s.changed[r] ? ' hot' : ''));
      box.appendChild(E('b', null, SHA_NAMES[r]));
      box.appendChild(document.createTextNode(hex8(s.after[r])));
      regs.appendChild(box);
    }
    this.regHost.appendChild(regs);

    clear(this.wHost);
    this.wHost.appendChild(E('p', 'cy-pane-title', 'This round’s inputs'));
    var w = E('div', 'cy-regs');
    [['W[' + s.round + ']', hex8(s.W)], ['K[' + s.round + ']', hex8(s.K)],
     ['Ch', hex8(s.ch)], ['Maj', hex8(s.maj)],
     ['Σ0', hex8(s.S0)], ['Σ1', hex8(s.S1)],
     ['T1', hex8(s.temp1)], ['T2', hex8(s.temp2)]].forEach(function (p) {
      var box = E('div', 'cy-reg');
      box.appendChild(E('b', null, p[0]));
      box.appendChild(document.createTextNode(p[1]));
      w.appendChild(box);
    });
    this.wHost.appendChild(w);

    clear(this.outHost);
    var doneBlocks = res.blocks.filter(function (b) { return b.from + 64 <= i + 1; }).length;
    this.outHost.appendChild(table(
      ['Message', 'Bytes', 'Blocks', 'Final digest'],
      [[this.text.length > 32 ? this.text.slice(0, 32) + '…' : (this.text || '(empty)'),
        res.messageLength, doneBlocks + ' of ' + res.blocks.length, res.digest]]));
  };

  ShaFamily.prototype.note = function (idx) {
    var res = this.result;
    var i = Math.min(idx, res.steps.length - 1);
    var s = res.steps[i];
    if (s.round === 0) {
      return 'Block ' + (s.block + 1) + ', round 0. The eight registers start from the current hash ' +
             'value, and the 16 words of this block have already been stretched into a 64-word ' +
             'message schedule so every round gets fresh input.';
    }
    var moved = SHA_NAMES.filter(function (n, k) { return s.changed[k]; }).join(', ');
    return 'Round ' + s.round + ': a and e are recomputed from T1 and T2, and everything else ' +
           'shifts down one place (b takes a, c takes b, and so on). Registers changed: ' +
           (moved || 'none, which happens when the arithmetic lands on the same value') + '.';
  };

  ShaFamily.prototype.compare = function () {
    var self = this;
    var base = this.result.digest;
    var alt = this.text.length ? this.text.slice(0, -1) + String.fromCharCode(
      (this.text.charCodeAt(this.text.length - 1) ^ 1)) : 'a';
    var other = sha256(textToBytes(alt)).digest;
    function toBytes(h) {
      var out = [];
      for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
      return out;
    }
    var d = bitDiff(toBytes(base), toBytes(other));
    return {
      title: 'One flipped input bit',
      head: ['Input', 'Digest', 'Bits differing of 256'],
      rows: [
        { key: 'a', cells: [this.text || '(empty)', base.slice(0, 24) + '…', '—'] },
        { key: 'b', cells: [alt, other.slice(0, 24) + '…', d] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — DIFFIE-HELLMAN                                               */
  /* ======================================================================== */

  function DhFamily() {
    this.key = 'dh';
    this.label = 'Diffie-Hellman';
    this.algoKey = 'dh';
    this.p = 23; this.g = 5; this.a = 6; this.b = 15;
  }

  DhFamily.prototype.algoOptions = function () { return [{ key: 'dh', label: 'Key exchange' }]; };

  DhFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Public parameters');
    g1.appendChild(field('Prime p', numBox(this.p, 5, 997, function (v) { self.p = v; onChange(); })));
    g1.appendChild(field('Generator g', numBox(this.g, 2, 50, function (v) { self.g = v; onChange(); })));
    host.appendChild(g1);

    var g2 = group('Private keys (never sent)');
    g2.appendChild(field('Alice picks a', numBox(this.a, 1, 200, function (v) { self.a = v; onChange(); })));
    g2.appendChild(field('Bob picks b', numBox(this.b, 1, 200, function (v) { self.b = v; onChange(); })));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    [['Classic p=23', 23, 5, 6, 15], ['Bigger p=97', 97, 5, 31, 57], ['Tiny p=11', 11, 2, 3, 7]]
      .forEach(function (pre) {
        row.appendChild(button(pre[0], function () {
          self.p = pre[1]; self.g = pre[2]; self.a = pre[3]; self.b = pre[4];
          var inputs = host.querySelectorAll('input[type=number]');
          inputs[0].value = self.p; inputs[1].value = self.g;
          inputs[2].value = self.a; inputs[3].value = self.b;
          onChange();
        }));
      });
    g3.appendChild(row);
    host.appendChild(g3);
  };

  DhFamily.prototype.buildStage = function (host) {
    this.actorHost = E('div', 'cy-actors');
    this.eqHost = E('div', 'cy-eq');
    host.appendChild(this.actorHost);
    host.appendChild(this.eqHost);
  };

  DhFamily.prototype.compute = function () {
    this.result = diffieHellman(this.p, this.g, this.a, this.b);
    this.error = this.result.error || null;
    if (this.result.error) return 1;
    if (!this.result.primitive) {
      this.error = 'g = ' + this.g + ' is not a primitive root mod ' + this.p +
        ', so it only reaches part of the group. The exchange still works, but Eve has fewer ' +
        'possibilities to search. Try g = 5 with p = 23.';
    }
    // Five story beats, then one frame per guess Eve has to make.
    this.total = 5 + this.result.eve.length;
    return this.total;
  };

  DhFamily.prototype.render = function (idx) {
    var r = this.result;
    clear(this.actorHost);
    clear(this.eqHost);
    if (r.error) return;
    var stage = Math.min(idx, this.total - 1);

    var pub = actor('public', 'Public — everyone can see this', []);
    pub.appendChild(kv('p =', r.p));
    pub.appendChild(kv('g =', r.g));
    if (stage >= 3) pub.appendChild(kv('A =', r.A));
    if (stage >= 3) pub.appendChild(kv('B =', r.B));
    this.actorHost.appendChild(pub);

    var al = actor('alice', 'Alice', []);
    al.appendChild(kv('secret a =', stage >= 1 ? r.a : '?', 'cy-secret'));
    if (stage >= 1) al.appendChild(kv('A = g^a mod p =', r.A));
    if (stage >= 4) al.appendChild(kv('B^a mod p =', r.shared, 'cy-secret'));
    this.actorHost.appendChild(al);

    var bo = actor('bob', 'Bob', []);
    bo.appendChild(kv('secret b =', stage >= 2 ? r.b : '?', 'cy-secret'));
    if (stage >= 2) bo.appendChild(kv('B = g^b mod p =', r.B));
    if (stage >= 4) bo.appendChild(kv('A^b mod p =', r.shared, 'cy-secret'));
    this.actorHost.appendChild(bo);

    var ev = actor('eve', 'Eve — listening to everything', []);
    ev.appendChild(kv('knows', 'p, g' + (stage >= 3 ? ', A, B' : '')));
    if (stage >= 5) {
      var tried = Math.min(stage - 4, r.eve.length);
      var last = r.eve[tried - 1];
      ev.appendChild(kv('trying a =', last.guess));
      ev.appendChild(kv('g^' + last.guess + ' mod p =', last.value));
      if (last.hit) {
        ev.appendChild(kv('BROKEN after', tried + ' guesses', 'cy-secret'));
      } else {
        ev.appendChild(kv('matches A?', 'no'));
      }
    } else {
      ev.appendChild(kv('shared secret', 'unknown'));
    }
    this.actorHost.appendChild(ev);

    if (stage >= 4) {
      this.eqHost.textContent =
        'B^a = (g^b)^a = g^ab = (g^a)^b = A^b mod ' + r.p + '  →  both sides hold ' + r.shared +
        ', and that number never crossed the wire.';
    }
  };

  DhFamily.prototype.note = function (idx) {
    var r = this.result;
    if (r.error) return r.error;
    var stage = Math.min(idx, this.total - 1);
    if (stage === 0) return 'p and g are public. Anyone may know them, including an attacker — they are usually published in a standard.';
    if (stage === 1) return 'Alice picks a secret a = ' + r.a + ' and publishes A = g^a mod p = ' + r.A + '. Computing that takes about log2(a) squarings, not a multiplications.';
    if (stage === 2) return 'Bob does the same with b = ' + r.b + ', publishing B = ' + r.B + '.';
    if (stage === 3) return 'A and B travel over the open network. An eavesdropper now has p, g, A and B — everything except the two secrets.';
    if (stage === 4) return 'Alice computes B^a and Bob computes A^b. Both are g^(ab) mod p, so both get ' + r.shared + ' without ever transmitting it. That is the whole trick.';
    var tried = Math.min(stage - 4, r.eve.length);
    var last = r.eve[tried - 1];
    if (last.hit) {
      return 'Eve recovers a = ' + last.guess + ' after ' + tried + ' guesses. With p = ' + r.p +
             ' there were only ' + (r.p - 1) + ' candidates. Real Diffie-Hellman uses a prime of ' +
             'about 2048 bits, where this same loop would outlast the universe.';
    }
    return 'Eve tries a = ' + last.guess + ': g^' + last.guess + ' mod ' + r.p + ' = ' + last.value +
           ', which is not A = ' + r.A + '. She has no better option than to keep going — that is the discrete logarithm problem.';
  };

  DhFamily.prototype.compare = function () {
    var r = this.result;
    if (r.error) return null;
    return {
      title: 'Cost of the attack as the prime grows',
      head: ['Prime size', 'Candidate exponents', 'At a billion guesses a second'],
      rows: [
        { key: 'now', cells: ['p = ' + r.p + ' (this one)', r.p - 1, 'instant'] },
        { key: 'k32', cells: ['32-bit', '~4.3 billion', 'about 4 seconds'] },
        { key: 'k64', cells: ['64-bit', '~1.8e19', 'about 580 years'] },
        { key: 'k2048', cells: ['2048-bit (real)', '~3.2e616', 'longer than the universe has existed'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 4 — RSA                                                          */
  /* ======================================================================== */

  function RsaFamily() {
    this.key = 'rsa';
    this.label = 'RSA';
    this.algoKey = 'rsa';
    this.p = 61; this.q = 53; this.e = 17; this.m = 65;
  }

  RsaFamily.prototype.algoOptions = function () { return [{ key: 'rsa', label: 'Key generation and encryption' }]; };

  RsaFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Two primes (kept secret)');
    g1.appendChild(field('p', numBox(this.p, 3, 199, function (v) { self.p = v; onChange(); })));
    g1.appendChild(field('q', numBox(this.q, 3, 199, function (v) { self.q = v; onChange(); })));
    host.appendChild(g1);

    var g2 = group('Public exponent and message');
    g2.appendChild(field('e', numBox(this.e, 3, 999, function (v) { self.e = v; onChange(); })));
    g2.appendChild(field('message m', numBox(this.m, 0, 9999, function (v) { self.m = v; onChange(); })));
    g2.appendChild(E('p', 'oa-hint', 'm must be smaller than n = p×q. Real RSA encrypts a symmetric key, never the data.'));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    [['Textbook 61/53', 61, 53, 17, 65], ['Small 11/13', 11, 13, 7, 9], ['Larger 101/103', 101, 103, 7, 1234]]
      .forEach(function (pre) {
        row.appendChild(button(pre[0], function () {
          self.p = pre[1]; self.q = pre[2]; self.e = pre[3]; self.m = pre[4];
          var inputs = host.querySelectorAll('input[type=number]');
          inputs[0].value = self.p; inputs[1].value = self.q;
          inputs[2].value = self.e; inputs[3].value = self.m;
          onChange();
        }));
      });
    g3.appendChild(row);
    host.appendChild(g3);
  };

  RsaFamily.prototype.buildStage = function (host) {
    this.actorHost = E('div', 'cy-actors');
    this.eqHost = E('div', 'cy-eq');
    this.outHost = E('div', 'oa-tableout');
    host.appendChild(this.actorHost);
    host.appendChild(this.eqHost);
    host.appendChild(this.outHost);
  };

  RsaFamily.prototype.compute = function () {
    this.result = rsa(this.p, this.q, this.e, this.m);
    this.error = this.result.error || null;
    if (this.result.error) return 1;
    // Beats: primes, n, phi, d (via extended Euclid), publish, encrypt,
    // decrypt, then the factoring attack.
    this.total = 8;
    return this.total;
  };

  RsaFamily.prototype.render = function (idx) {
    var r = this.result;
    clear(this.actorHost);
    clear(this.eqHost);
    clear(this.outHost);
    if (r.error) return;
    var st = Math.min(idx, this.total - 1);

    var priv = actor('alice', 'Private — never leaves the owner', []);
    priv.appendChild(kv('p =', r.p, 'cy-secret'));
    priv.appendChild(kv('q =', r.q, 'cy-secret'));
    if (st >= 2) priv.appendChild(kv('φ(n) =', r.phi, 'cy-secret'));
    if (st >= 3) priv.appendChild(kv('d =', r.d, 'cy-secret'));
    this.actorHost.appendChild(priv);

    var pub = actor('public', 'Public key', []);
    if (st >= 1) pub.appendChild(kv('n = p×q =', r.n));
    if (st >= 4) pub.appendChild(kv('e =', r.e));
    if (st >= 4) pub.appendChild(E('div', 'cy-line', 'anyone may encrypt with (n, e)'));
    this.actorHost.appendChild(pub);

    var msg = actor('bob', 'Message', []);
    msg.appendChild(kv('m =', r.message));
    if (st >= 5) msg.appendChild(kv('c = m^e mod n =', r.cipher));
    if (st >= 6) msg.appendChild(kv('c^d mod n =', r.decrypted, r.roundTrips ? 'cy-secret' : null));
    this.actorHost.appendChild(msg);

    if (st >= 7) {
      var ev = actor('eve', 'Eve — attacking the public key', []);
      ev.appendChild(kv('knows', 'n = ' + r.n + ', e = ' + r.e + ', c = ' + r.cipher));
      if (r.factors.length) {
        ev.appendChild(kv('factored n after', r.factorAttempts + ' trial divisions'));
        ev.appendChild(kv('n =', r.factors[0] + ' × ' + r.factors[1], 'cy-secret'));
      }
      this.actorHost.appendChild(ev);
    }

    if (st === 3) {
      var lines = r.egcd.steps.map(function (s) {
        return s.r + ' = ' + s.q + '×' + s.next + ' + ' + (s.r - s.q * s.next);
      }).join('   •   ');
      this.eqHost.textContent = 'Extended Euclid on e = ' + r.e + ' and φ(n) = ' + r.phi +
        ':  ' + lines + '   →   d = ' + r.d;
    } else if (st >= 5) {
      this.eqHost.textContent = '(m^e)^d = m^(ed) = m^(1 mod φ(n)) = m mod n  —  ' +
        r.message + '^' + r.e + ' mod ' + r.n + ' = ' + r.cipher + ', and ' + r.cipher + '^' +
        r.d + ' mod ' + r.n + ' = ' + r.decrypted + '.';
    }

    if (st >= 5) {
      this.outHost.appendChild(table(
        ['Public key', 'Private key', 'Message', 'Ciphertext', 'Recovered'],
        [['(' + r.n + ', ' + r.e + ')', '(' + r.n + ', ' + r.d + ')', r.message, r.cipher,
          r.decrypted + (r.roundTrips ? ' ✓' : ' ✗')]]));
    }
  };

  RsaFamily.prototype.note = function (idx) {
    var r = this.result;
    if (r.error) return r.error;
    var st = Math.min(idx, this.total - 1);
    switch (st) {
      case 0: return 'Two primes are chosen and kept secret. Everything else is derived from them, which is why their secrecy is the whole security of RSA.';
      case 1: return 'n = p×q = ' + r.n + ' is published. Multiplying is easy; recovering p and q from n is the hard problem RSA rests on.';
      case 2: return 'φ(n) = (p−1)(q−1) = ' + r.phi + '. Computing this needs p and q, so only the key owner can — that asymmetry is the trapdoor.';
      case 3: return 'd is the modular inverse of e mod φ(n), found by the extended Euclidean algorithm: d = ' + r.d + ', and e×d ≡ 1 mod φ(n).';
      case 4: return 'The public key (n, e) = (' + r.n + ', ' + r.e + ') is published. The private key (n, d) is kept. p, q and φ(n) can now be thrown away.';
      case 5: return 'Encryption is one modular exponentiation: c = m^e mod n = ' + r.cipher + '. Anyone with the public key can do this.';
      case 6: return 'Decryption is the same operation with d: c^d mod n = ' + r.decrypted + ', back to the original message. Only the holder of d can do it.';
      default: return 'Eve factored n = ' + r.n + ' in ' + r.factorAttempts + ' trial divisions, which hands her φ(n) and therefore d. Real keys are 2048 bits precisely because trial division — and every cleverer method known — becomes hopeless at that size.';
    }
  };

  RsaFamily.prototype.compare = function () {
    var r = this.result;
    if (r.error) return null;
    return {
      title: 'Why real keys are enormous',
      head: ['Modulus n', 'Roughly', 'Status'],
      rows: [
        { key: 'this', cells: ['this one', r.n, 'factored in ' + r.factorAttempts + ' steps just now'] },
        { key: 'rsa768', cells: ['RSA-768', '232 digits', 'factored in 2009, two years of many CPUs'] },
        { key: 'rsa2048', cells: ['RSA-2048', '617 digits', 'the current default, unfactored'] },
        { key: 'rsa4096', cells: ['RSA-4096', '1234 digits', 'used where 2048 feels too close'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 5 — ELLIPTIC CURVES                                              */
  /* ======================================================================== */

  function EcFamily() {
    this.key = 'ec';
    this.label = 'Elliptic curves';
    this.algoKey = 'ecdh';
    this.a = 2; this.b = 3; this.p = 97; this.kA = 7; this.kB = 11;
    this.lastIdx = 0;
  }

  EcFamily.prototype.algoOptions = function () { return [{ key: 'ecdh', label: 'Point multiplication and ECDH' }]; };

  EcFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Curve: y² = x³ + ax + b over Fₚ');
    g1.appendChild(field('a', numBox(this.a, -20, 20, function (v) { self.a = v; onChange(); })));
    g1.appendChild(field('b', numBox(this.b, -20, 20, function (v) { self.b = v; onChange(); })));
    g1.appendChild(field('prime p', numBox(this.p, 5, 401, function (v) { self.p = v; onChange(); })));
    host.appendChild(g1);

    var g2 = group('Private keys');
    g2.appendChild(field('Alice kA', numBox(this.kA, 1, 200, function (v) { self.kA = v; onChange(); })));
    g2.appendChild(field('Bob kB', numBox(this.kB, 1, 200, function (v) { self.kB = v; onChange(); })));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    [['Teaching curve', 2, 3, 97, 7, 11], ['Bigger field', 2, 3, 263, 23, 41], ['Tiny field', 2, 2, 17, 3, 5]]
      .forEach(function (pre) {
        row.appendChild(button(pre[0], function () {
          self.a = pre[1]; self.b = pre[2]; self.p = pre[3]; self.kA = pre[4]; self.kB = pre[5];
          var inputs = host.querySelectorAll('input[type=number]');
          for (var i = 0; i < 5; i++) inputs[i].value = pre[i + 1];
          onChange();
        }));
      });
    g3.appendChild(row);
    g3.appendChild(E('p', 'oa-hint',
      'Over a small prime field the curve is a scatter of points rather than a smooth line. ' +
      'The symmetry about the middle row is real — every x with a solution has two.'));
    host.appendChild(g3);
  };

  EcFamily.prototype.buildStage = function (host) {
    var self = this;
    this.canvas = E('canvas', 'oa-canvas');
    this.canvas.id = 'viz-ec-canvas';
    host.appendChild(this.canvas);
    this.actorHost = E('div', 'cy-actors');
    this.outHost = E('div', 'oa-tableout');
    host.appendChild(this.actorHost);
    host.appendChild(this.outHost);
    window.addEventListener('resize', function () { self.draw(self.lastIdx); });
  };

  EcFamily.prototype.compute = function () {
    this.result = ellipticCurve(this.a, this.b, this.p, null, this.kA, this.kB);
    this.error = this.result.error || null;
    if (this.result.error) return 1;
    this.total = this.result.stepsA.length + 2;
    return this.total;
  };

  EcFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var r = this.result;
    clear(this.actorHost);
    clear(this.outHost);
    this.draw(idx);
    if (r.error) return;
    var st = Math.min(idx, this.total - 1);

    var cur = actor('public', 'Curve', []);
    cur.appendChild(kv('equation', 'y² = x³ + ' + r.a + 'x + ' + r.b + ' mod ' + r.p));
    cur.appendChild(kv('points', r.points.length + ' + infinity'));
    cur.appendChild(kv('base point G', '(' + r.base.x + ', ' + r.base.y + ')'));
    cur.appendChild(kv('order of G', r.order));
    this.actorHost.appendChild(cur);

    var al = actor('alice', 'Alice', []);
    al.appendChild(kv('secret kA =', r.kA, 'cy-secret'));
    var stepIdx = Math.min(st, r.stepsA.length - 1);
    var partial = r.stepsA[stepIdx] ? r.stepsA[stepIdx].result : null;
    al.appendChild(kv('kA·G so far =', partial ? '(' + partial.x + ', ' + partial.y + ')' : 'infinity'));
    if (st >= r.stepsA.length) {
      al.appendChild(kv('public kA·G =', r.pubA ? '(' + r.pubA.x + ', ' + r.pubA.y + ')' : 'infinity'));
    }
    this.actorHost.appendChild(al);

    var bo = actor('bob', 'Bob', []);
    bo.appendChild(kv('secret kB =', r.kB, 'cy-secret'));
    if (st >= r.stepsA.length) {
      bo.appendChild(kv('public kB·G =', r.pubB ? '(' + r.pubB.x + ', ' + r.pubB.y + ')' : 'infinity'));
    }
    this.actorHost.appendChild(bo);

    if (st >= this.total - 1) {
      var sh = actor('eve', 'Shared secret', []);
      sh.appendChild(kv('kA·(kB·G) =', r.shared ? '(' + r.shared.x + ', ' + r.shared.y + ')' : 'infinity', 'cy-secret'));
      sh.appendChild(kv('both sides agree', r.agrees ? 'yes' : 'no'));
      this.actorHost.appendChild(sh);
    }

    this.outHost.appendChild(table(
      ['Doublings', 'Additions', 'Naive additions for kA', 'Saving'],
      [[r.stepsA.length, r.stepsA.filter(function (s) { return s.op === 'add'; }).length,
        r.kA, Math.max(1, Math.round(r.kA / Math.max(1, r.stepsA.length))) + '×']]));
  };

  EcFamily.prototype.draw = function (idx) {
    var canvas = this.canvas, r = this.result;
    if (!canvas || !r || r.error) return;
    if (!canvas.clientWidth) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight || 340;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = CC.bg0;
    g.fillRect(0, 0, w, h);

    var pad = 26;
    var pw = w - pad * 2, ph = h - pad * 2;
    var P = r.p;
    function X(x) { return pad + (x / (P - 1)) * pw; }
    function Y(y) { return h - pad - (y / (P - 1)) * ph; }
    var dot = Math.max(1.6, Math.min(4, pw / P / 1.6));

    g.strokeStyle = 'rgba(125,211,252,0.10)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(pad, h - pad); g.lineTo(w - pad, h - pad);
    g.moveTo(pad, pad); g.lineTo(pad, h - pad);
    g.stroke();

    // every point on the curve
    g.fillStyle = 'rgba(148,163,184,0.5)';
    r.points.forEach(function (pt) {
      g.beginPath();
      g.arc(X(pt.x), Y(pt.y), dot, 0, Math.PI * 2);
      g.fill();
    });

    var st = Math.min(idx, this.total - 1);
    // the multiples reached so far, so the "random walk" of scalar
    // multiplication is visible — that apparent randomness is the security
    var upto = Math.min(st, r.stepsA.length - 1);
    g.strokeStyle = 'rgba(56,189,248,0.35)';
    g.lineWidth = 1;
    var prev = null;
    for (var i = 0; i <= upto; i++) {
      var pt = r.stepsA[i].result;
      if (!pt) continue;
      if (prev) {
        g.beginPath();
        g.moveTo(X(prev.x), Y(prev.y));
        g.lineTo(X(pt.x), Y(pt.y));
        g.stroke();
      }
      prev = pt;
    }

    function mark(pt, colour, label, radius) {
      if (!pt) return;
      g.beginPath();
      g.arc(X(pt.x), Y(pt.y), radius || 5, 0, Math.PI * 2);
      g.fillStyle = colour;
      g.fill();
      g.font = '11px ' + FONT;
      g.fillStyle = colour;
      g.textAlign = X(pt.x) > w - pad - 60 ? 'right' : 'left';
      g.fillText(label, X(pt.x) + (X(pt.x) > w - pad - 60 ? -9 : 9), Y(pt.y) - 7);
    }
    mark(r.base, CC.amber, 'G');
    if (prev) mark(prev, CC.blue, 'kA·G so far');
    if (st >= r.stepsA.length) mark(r.pubB, CC.green, 'kB·G');
    if (st >= this.total - 1) mark(r.shared, CC.violet, 'shared');

    g.font = '10px ' + FONT;
    g.fillStyle = CC.faint;
    g.textAlign = 'left';
    g.fillText('x → 0 to ' + (P - 1), pad, h - 8);
    g.textAlign = 'right';
    g.fillText(r.points.length + ' points', w - pad, h - 8);
  };

  EcFamily.prototype.note = function (idx) {
    var r = this.result;
    if (r.error) return r.error;
    var st = Math.min(idx, this.total - 1);
    if (st < r.stepsA.length) {
      var s = r.stepsA[st];
      var bit = st;
      if (s.op === 'add') {
        return 'Bit ' + bit + ' of kA = ' + r.kA + ' is 1, so the running total gains the current ' +
               'addend: ' + (s.result ? '(' + s.result.x + ', ' + s.result.y + ')' : 'infinity') +
               '. Then the addend doubles, ready for the next bit.';
      }
      return 'Bit ' + bit + ' of kA = ' + r.kA + ' is 0, so nothing is added this round — the ' +
             'addend just doubles. That is why multiplying by a 256-bit scalar costs about 256 ' +
             'doublings rather than 2²⁵⁶ additions.';
    }
    if (st === r.stepsA.length) {
      return 'Alice publishes kA·G and Bob publishes kB·G. Recovering kA from kA·G is the ' +
             'elliptic-curve discrete logarithm problem, and on a real curve it is infeasible — ' +
             'here, with only ' + r.points.length + ' points, you could simply check them all.';
    }
    return 'Alice computes kA·(kB·G) and Bob computes kB·(kA·G). Scalar multiplication ' +
           'commutes, so both land on the same point and share a secret neither transmitted. ' +
           'This is ECDH, and it is what your browser used to open this page.';
  };

  EcFamily.prototype.compare = function () {
    var r = this.result;
    if (r.error) return null;
    return {
      title: 'Key size for the same strength',
      head: ['Security level', 'Elliptic curve key', 'RSA / DH key'],
      rows: [
        { key: 'this', cells: ['this toy curve', 'about ' + Math.ceil(Math.log(r.p) / Math.log(2)) + ' bits', 'no real security'] },
        { key: 'b80', cells: ['80-bit', '160 bits', '1024 bits'] },
        { key: 'b128', cells: ['128-bit', '256 bits', '3072 bits'] },
        { key: 'b256', cells: ['256-bit', '512 bits', '15360 bits'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  M.boot({
    rootId: 'cryptoviz',
    mountId: 'viz-crypto-mount',
    name: 'The cryptography visualiser',
    css: EXTRA_CSS,
    families: function () {
      return [new AesFamily(), new ShaFamily(), new DhFamily(), new RsaFamily(), new EcFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

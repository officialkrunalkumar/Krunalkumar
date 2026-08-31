/* ==========================================================================
   qr.js — build a QR code, and read one before you trust it.
   --------------------------------------------------------------------------
   Two halves, and the second one is the reason the page exists.

   Generating is the easy half: byte-mode encoding, Reed-Solomon parity, mask
   selection, PNG and SVG out. It is written from the specification here rather
   than pulled from a library because the whole site runs with no dependencies,
   and because a QR encoder is small enough to read end to end — which is the
   only way anyone can check that the thing they printed says what they meant.

   Inspecting is the half that matters. A QR code is a link you cannot hover
   over. You point a camera at a square, and something happens — a site opens,
   or a payment app opens with a stranger's account already filled in. This
   decodes the square and prints what it says as inert text, with an explicit
   copy button and nothing that navigates. Payment strings get pulled apart
   into payee, amount and note in plain language, because "scan this QR to
   RECEIVE money" is a live scam in India and reading the actual intent is the
   whole defence: a UPI QR can only ever move money out of the account that
   scans it.

   Nothing is uploaded. There is no fetch and no XHR in this file; the decoder
   works on pixels the browser already has, and no decoded URL is ever
   requested, previewed or resolved.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ======================================================================
     PART 1 — Galois field GF(2^8)
     ----------------------------------------------------------------------
     Reed-Solomon needs a field where every non-zero value has an inverse and
     addition never carries, so a byte's worth of arithmetic stays inside a
     byte. GF(2^8) is that field: elements are the 256 bytes, addition is XOR,
     and multiplication is polynomial multiplication modulo an irreducible
     polynomial — QR uses x^8 + x^4 + x^3 + x^2 + 1, which is 0x11D.

     Multiplying byte by byte every time would be slow and easy to get wrong,
     so the field is tabulated once. 2 (x) is a generator of the multiplicative
     group: repeatedly doubling and reducing by 0x11D walks through all 255
     non-zero elements before returning to 1. GF_EXP[i] is that walk and GF_LOG
     is its inverse, which turns multiplication into an addition of logs.

     GF_EXP is 512 long, not 255, purely so log(a) + log(b) can be used as an
     index without a modulo on every multiply: the second half repeats the
     first. GF_LOG[0] is meaningless — zero has no logarithm — so every caller
     has to check for zero first, and each one below does.
     ====================================================================== */
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;   // reduce back into 8 bits
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function gfDiv(a, b) {
    if (b === 0) throw new Error('division by zero in GF(256)');
    if (a === 0) return 0;
    return GF_EXP[GF_LOG[a] + 255 - GF_LOG[b]];
  }

  /* alpha^n, for any n including negatives. Used constantly by the decoder,
     where error positions are naturally expressed as negative exponents. */
  function gfAlpha(n) {
    return GF_EXP[((n % 255) + 255) % 255];
  }

  /* ======================================================================
     PART 2 — Reed-Solomon
     ----------------------------------------------------------------------
     QR appends parity bytes so a damaged code still reads. The generator
     polynomial has roots alpha^0 .. alpha^(k-1); the parity is the remainder
     of the message polynomial divided by it, so the transmitted codeword is a
     multiple of the generator and therefore evaluates to zero at every root.
     Any non-zero evaluation at a root — a syndrome — means damage.
     ====================================================================== */

  /* Coefficients most-significant first; poly[0] is always 1 (monic). */
  function rsGenerator(degree) {
    var poly = [1], i, k;
    for (i = 0; i < degree; i++) {
      var next = [];
      for (k = 0; k <= poly.length; k++) next.push(0);
      var root = GF_EXP[i];
      for (k = 0; k < poly.length; k++) {
        next[k] ^= poly[k];                      // the x term
        next[k + 1] ^= gfMul(poly[k], root);     // the alpha^i term
      }
      poly = next;
    }
    return poly;
  }

  /* Polynomial long division, keeping only the remainder. The leading 1 of the
     generator is implicit, which is why the loop reads gen[j + 1]. */
  function rsRemainder(data, gen) {
    var ecLen = gen.length - 1;
    var rem = new Uint8Array(ecLen);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      var j;
      for (j = 0; j < ecLen - 1; j++) rem[j] = rem[j + 1];
      rem[ecLen - 1] = 0;
      for (j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
  }

  /* Correct a block in place. Returns true if it now checks out.

     Without this a photograph of a QR code on a wall almost never decodes:
     glare, print dither and a slightly-off sampling grid all flip codewords,
     and the format is designed on the assumption that the reader repairs them.
     Berlekamp-Massey finds where the errors are, Forney finds what they are. */
  function rsDecode(block, ecLen) {
    var n = block.length, i, j;

    /* Syndromes. block is read as a polynomial with block[0] as the highest
       power, so Horner's method evaluates it left to right. */
    var syn = new Uint8Array(ecLen);
    var damaged = false;
    for (i = 0; i < ecLen; i++) {
      var s = 0, root = GF_EXP[i];
      for (j = 0; j < n; j++) s = gfMul(s, root) ^ block[j];
      syn[i] = s;
      if (s) damaged = true;
    }
    if (!damaged) return true;

    /* Berlekamp-Massey: the shortest shift register that generates the
       syndrome sequence. Its feedback polynomial is the error locator. */
    var sigma = [1], prev = [1];
    var L = 0, m = 1, b = 1;
    for (var r = 0; r < ecLen; r++) {
      var d = syn[r];
      for (i = 1; i <= L; i++) d ^= gfMul(sigma[i] || 0, syn[r - i]);
      if (d === 0) {
        m++;
      } else {
        var scale = gfDiv(d, b);
        var snapshot = sigma.slice();
        for (i = 0; i < prev.length; i++) {
          while (sigma.length <= i + m) sigma.push(0);
          sigma[i + m] ^= gfMul(scale, prev[i]);
        }
        if (2 * L <= r) { L = r + 1 - L; prev = snapshot; b = d; m = 1; }
        else { m++; }
      }
    }

    var numErrors = sigma.length - 1;
    while (numErrors > 0 && sigma[numErrors] === 0) numErrors--;
    // More errors than the parity can locate: refuse rather than invent bytes.
    if (numErrors === 0 || numErrors * 2 > ecLen) return false;

    /* Chien search. An error at block[k] sits at polynomial exponent n-1-k, so
       the locator alpha^(n-1-k) shows up as a root of sigma at its inverse. */
    var positions = [];
    for (var k = 0; k < n; k++) {
      var expo = (n - 1 - k) % 255;
      var invLog = (255 - expo) % 255;
      var v = 0;
      for (j = 0; j < sigma.length; j++) {
        if (sigma[j]) v ^= GF_EXP[(GF_LOG[sigma[j]] + invLog * j) % 255];
      }
      if (v === 0) positions.push(k);
    }
    if (positions.length !== numErrors) return false;

    /* Forney. omega = syndromes * sigma, truncated to the parity length; the
       magnitude at each location is X * omega(X^-1) / sigma'(X^-1). Over
       GF(2) the formal derivative keeps only the odd-power terms, because
       every even coefficient is multiplied by an even number and vanishes. */
    var omega = new Uint8Array(ecLen);
    for (i = 0; i < ecLen; i++) {
      var acc = 0;
      for (j = 0; j <= i && j < sigma.length; j++) acc ^= gfMul(sigma[j], syn[i - j]);
      omega[i] = acc;
    }
    for (var p = 0; p < positions.length; p++) {
      var pos = positions[p];
      var ex = (n - 1 - pos) % 255;
      var xi = (255 - ex) % 255;
      var num = 0, den = 0;
      for (j = 0; j < ecLen; j++) {
        if (omega[j]) num ^= GF_EXP[(GF_LOG[omega[j]] + xi * j) % 255];
      }
      for (j = 1; j < sigma.length; j += 2) {
        if (sigma[j]) den ^= GF_EXP[(GF_LOG[sigma[j]] + xi * (j - 1)) % 255];
      }
      if (den === 0) return false;
      block[pos] ^= gfMul(gfAlpha(ex), gfDiv(num, den));
    }

    // Prove the repair rather than assume it.
    for (i = 0; i < ecLen; i++) {
      var check = 0, rr = GF_EXP[i];
      for (j = 0; j < n; j++) check = gfMul(check, rr) ^ block[j];
      if (check !== 0) return false;
    }
    return true;
  }

  /* ======================================================================
     PART 3 — QR structure tables
     ----------------------------------------------------------------------
     Two tables from ISO/IEC 18004, indexed [error-correction level][version-1]:
     how many parity bytes each block carries, and how many blocks there are.
     Everything else about a version's capacity is arithmetic from the module
     count, so these are the only figures that have to be written down.
     ====================================================================== */
  var ECL = { L: 0, M: 1, Q: 2, H: 3 };
  var ECL_NAMES = ['L', 'M', 'Q', 'H'];
  var ECL_RECOVERY = ['about 7%', 'about 15%', 'about 25%', 'about 30%'];
  // Format-info bit pattern per level — not the same order as the table index.
  var ECL_FORMAT_BITS = [1, 0, 3, 2];

  var ECC_PER_BLOCK = [
    [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
     28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
     26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
     28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
     30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];

  var NUM_BLOCKS = [
    [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
     8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
     17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
     23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
     25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];

  /* Modules available to data and parity, before the format's own furniture is
     subtracted. The square is (4v+17)^2; the finder patterns, separators,
     timing lines and format areas cost a fixed amount, the alignment patterns
     cost a count that grows with the version, and version 7 and up pay another
     36 modules for the two version-information blocks. */
  function rawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function totalCodewords(ver) { return Math.floor(rawDataModules(ver) / 8); }

  function dataCodewords(ver, ecl) {
    return totalCodewords(ver) - ECC_PER_BLOCK[ecl][ver - 1] * NUM_BLOCKS[ecl][ver - 1];
  }

  /* Alignment centres are evenly spaced between 6 and size-7, rounded to an
     even number of modules so they always land on the timing pattern's phase.
     Version 32 is the one case the formula gets wrong and the specification
     lists explicitly, which is why it is special-cased rather than derived. */
  function alignmentPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var size = ver * 4 + 17;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  function getBit(value, i) { return ((value >>> i) & 1) !== 0; }

  /* ======================================================================
     PART 4 — the module grid
     ----------------------------------------------------------------------
     A grid object carries two planes: `mods` (dark or light) and `fn` (is this
     module part of the format's fixed furniture). The second matters twice —
     function modules are never masked, and the data stream skips them — and
     the decoder reuses the exact same map, built from the same code, so the
     two halves of this file cannot drift apart.
     ====================================================================== */
  function makeGrid(ver) {
    var size = ver * 4 + 17;
    var mods = [], fn = [];
    for (var y = 0; y < size; y++) {
      mods.push(new Uint8Array(size));
      fn.push(new Uint8Array(size));
    }
    return { ver: ver, size: size, mods: mods, fn: fn };
  }

  function setFn(g, x, y, dark) {
    if (x < 0 || y < 0 || x >= g.size || y >= g.size) return;
    g.mods[y][x] = dark ? 1 : 0;
    g.fn[y][x] = 1;
  }

  function drawFinder(g, x, y) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(g, x + dx, y + dy, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignment(g, x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        setFn(g, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  /* 15 bits: 5 of payload (level + mask) and 10 of BCH parity, then XORed with
     0x5412 so an all-zero format still has dark modules to lock on to. Written
     twice, in two different places, because losing the format information
     loses the whole code. */
  function drawFormatBits(g, ecl, mask) {
    var data = (ECL_FORMAT_BITS[ecl] << 3) | mask;
    var rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (i = 0; i <= 5; i++) setFn(g, 8, i, getBit(bits, i));
    setFn(g, 8, 7, getBit(bits, 6));
    setFn(g, 8, 8, getBit(bits, 7));
    setFn(g, 7, 8, getBit(bits, 8));
    for (i = 9; i < 15; i++) setFn(g, 14 - i, 8, getBit(bits, i));

    for (i = 0; i < 8; i++) setFn(g, g.size - 1 - i, 8, getBit(bits, i));
    for (i = 8; i < 15; i++) setFn(g, 8, g.size - 15 + i, getBit(bits, i));
    setFn(g, 8, g.size - 8, true);   // the dark module, always set
  }

  function drawVersionBits(g) {
    if (g.ver < 7) return;
    var rem = g.ver, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (g.ver << 12) | rem;
    for (i = 0; i < 18; i++) {
      var dark = getBit(bits, i);
      var a = g.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      setFn(g, a, b, dark);
      setFn(g, b, a, dark);
    }
  }

  function drawFunctionPatterns(g, ecl) {
    var i, j;
    for (i = 0; i < g.size; i++) {
      setFn(g, 6, i, i % 2 === 0);
      setFn(g, i, 6, i % 2 === 0);
    }
    drawFinder(g, 3, 3);
    drawFinder(g, g.size - 4, 3);
    drawFinder(g, 3, g.size - 4);

    var pos = alignmentPositions(g.ver);
    var n = pos.length;
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        // The three corners already hold finder patterns.
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        drawAlignment(g, pos[i], pos[j]);
      }
    }
    drawFormatBits(g, ecl, 0);   // placeholder; rewritten once the mask is chosen
    drawVersionBits(g);
  }

  /* The data stream snakes up and down in two-module columns from the bottom
     right. Column 6 is the vertical timing line and is stepped over entirely,
     which is why `right` jumps from 6 to 5 rather than being skipped per
     module. */
  function walkData(g, visit) {
    var i = 0;
    for (var right = g.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < g.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? g.size - 1 - vert : vert;
          if (!g.fn[y][x]) { visit(x, y, i); i++; }
        }
      }
    }
    return i;
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
    function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
  ];

  /* Penalty scoring, so the chosen mask is the one that scans best rather than
     the one that happens to be first. The four rules punish, in order: long
     same-colour runs, solid 2x2 blocks, anything that looks like a finder
     pattern where there is not one, and an overall light/dark imbalance. */
  var N1 = 3, N2 = 3, N3 = 40, N4 = 10;

  function finderPenaltyAddHistory(run, history, size) {
    if (history[0] === 0) run += size;   // the quiet zone counts as light
    history.pop();
    history.unshift(run);
  }

  function finderPenaltyCount(history) {
    var n = history[1];
    var core = n > 0 && history[2] === n && history[3] === n * 3 &&
               history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
           (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  }

  function finderPenaltyEnd(dark, run, history, size) {
    if (dark) { finderPenaltyAddHistory(run, history, size); run = 0; }
    run += size;
    finderPenaltyAddHistory(run, history, size);
    return finderPenaltyCount(history);
  }

  function penaltyScore(g) {
    var size = g.size, result = 0, x, y, run, runColor, history;

    for (y = 0; y < size; y++) {
      runColor = 0; run = 0; history = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < size; x++) {
        if (g.mods[y][x] === runColor) {
          run++;
          if (run === 5) result += N1;
          else if (run > 5) result++;
        } else {
          finderPenaltyAddHistory(run, history, size);
          if (!runColor) result += finderPenaltyCount(history) * N3;
          runColor = g.mods[y][x];
          run = 1;
        }
      }
      result += finderPenaltyEnd(runColor === 1, run, history, size) * N3;
    }
    for (x = 0; x < size; x++) {
      runColor = 0; run = 0; history = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < size; y++) {
        if (g.mods[y][x] === runColor) {
          run++;
          if (run === 5) result += N1;
          else if (run > 5) result++;
        } else {
          finderPenaltyAddHistory(run, history, size);
          if (!runColor) result += finderPenaltyCount(history) * N3;
          runColor = g.mods[y][x];
          run = 1;
        }
      }
      result += finderPenaltyEnd(runColor === 1, run, history, size) * N3;
    }

    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = g.mods[y][x];
        if (c === g.mods[y][x + 1] && c === g.mods[y + 1][x] && c === g.mods[y + 1][x + 1]) {
          result += N2;
        }
      }
    }

    var dark = 0;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) dark += g.mods[y][x];
    }
    var total = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * N4;
  }

  /* ======================================================================
     PART 5 — the encoder
     ====================================================================== */

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    // Older engine fallback: encodeURIComponent already produces UTF-8 octets.
    var esc = unescape(encodeURIComponent(String(text)));
    var b = new Uint8Array(esc.length);
    for (var i = 0; i < esc.length; i++) b[i] = esc.charCodeAt(i);
    return b;
  }

  function appendBits(bits, value, count) {
    for (var i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  function interleave(data, ver, ecl) {
    var numBlocks = NUM_BLOCKS[ecl][ver - 1];
    var eccLen = ECC_PER_BLOCK[ecl][ver - 1];
    var rawCw = totalCodewords(ver);
    var shortLen = Math.floor(rawCw / numBlocks);
    var numShort = numBlocks - (rawCw % numBlocks);
    var gen = rsGenerator(eccLen);

    var blocks = [], i, j, k = 0;
    for (i = 0; i < numBlocks; i++) {
      var take = shortLen - eccLen + (i < numShort ? 0 : 1);
      var dat = [];
      for (j = 0; j < take; j++) dat.push(data[k++]);
      var ecc = rsRemainder(new Uint8Array(dat), gen);
      // A short block gets one padding slot so every block is the same length
      // and the interleave below is a plain column read; the pad is skipped
      // when it is written out.
      var full = dat.slice();
      if (i < numShort) full.push(0);
      for (j = 0; j < eccLen; j++) full.push(ecc[j]);
      blocks.push(full);
    }

    var result = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (j = 0; j < numBlocks; j++) {
        if (i === shortLen - eccLen && j < numShort) continue;   // the pad slot
        result.push(blocks[j][i]);
      }
    }
    return new Uint8Array(result);
  }

  /* Returns a grid, or an object with .tooLong when the payload will not fit
     into version 40 at the requested level. */
  function encodeQr(bytes, eclName) {
    var ecl = ECL[eclName];
    var ver = 0, i;
    for (i = 1; i <= 40; i++) {
      var ccBits = i <= 9 ? 8 : 16;
      var needBytes = Math.ceil((4 + ccBits + bytes.length * 8) / 8);
      if (needBytes <= dataCodewords(i, ecl)) { ver = i; break; }
    }
    if (!ver) return { tooLong: true, max: dataCodewords(40, ecl) - 3 };

    var capacity = dataCodewords(ver, ecl);
    var bits = [];
    appendBits(bits, 4, 4);                                   // byte mode
    appendBits(bits, bytes.length, ver <= 9 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) appendBits(bits, bytes[i], 8);
    appendBits(bits, 0, Math.min(4, capacity * 8 - bits.length));
    appendBits(bits, 0, (8 - bits.length % 8) % 8);
    // 0xEC / 0x11 alternating is what the specification names as the pad
    // pattern; it is not arbitrary filler, and readers rely on it.
    var pad = 0xec;
    while (bits.length < capacity * 8) { appendBits(bits, pad, 8); pad ^= 0xec ^ 0x11; }

    var dataCw = new Uint8Array(capacity);
    for (i = 0; i < bits.length; i++) dataCw[i >>> 3] |= bits[i] << (7 - (i & 7));

    var all = interleave(dataCw, ver, ecl);

    var g = makeGrid(ver);
    drawFunctionPatterns(g, ecl);
    walkData(g, function (x, y, idx) {
      if (idx < all.length * 8) g.mods[y][x] = (all[idx >>> 3] >>> (7 - (idx & 7))) & 1;
    });

    // Try every mask, keep the least penalised. The differences are not
    // cosmetic: a bad mask leaves finder-lookalikes in the data area and real
    // scanners lose the code.
    var best = -1, bestScore = Infinity, mask;
    for (mask = 0; mask < 8; mask++) {
      applyMask(g, mask);
      drawFormatBits(g, ecl, mask);
      var score = penaltyScore(g);
      if (score < bestScore) { bestScore = score; best = mask; }
      applyMask(g, mask);   // XOR is its own inverse, so this undoes it
    }
    applyMask(g, best);
    drawFormatBits(g, ecl, best);

    g.ecl = ecl;
    g.mask = best;
    g.dataBytes = bytes.length;
    g.capacityBytes = capacity - (ver <= 9 ? 2 : 3);
    return g;
  }

  function applyMask(g, mask) {
    var fn = MASKS[mask];
    for (var y = 0; y < g.size; y++) {
      for (var x = 0; x < g.size; x++) {
        if (!g.fn[y][x] && fn(x, y)) g.mods[y][x] ^= 1;
      }
    }
  }

  /* ======================================================================
     PART 6 — rendering
     ====================================================================== */
  function drawToCanvas(canvas, g, scale, quiet) {
    var dim = (g.size + quiet * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext('2d');
    // Always dark-on-white, whatever the site theme is doing. An inverted QR
    // is not reliably scannable and a preview you cannot photograph off the
    // screen is worse than none.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000000';
    for (var y = 0; y < g.size; y++) {
      for (var x = 0; x < g.size; x++) {
        if (g.mods[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return dim;
  }

  function toSvg(g, scale, quiet) {
    var dim = (g.size + quiet * 2) * scale;
    var path = [];
    for (var y = 0; y < g.size; y++) {
      for (var x = 0; x < g.size; x++) {
        if (g.mods[y][x]) {
          path.push('M' + ((x + quiet) * scale) + ' ' + ((y + quiet) * scale) +
                    'h' + scale + 'v' + scale + 'h-' + scale + 'z');
        }
      }
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
      '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">\n' +
      '  <rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>\n' +
      '  <path fill="#000000" d="' + path.join('') + '"/>\n' +
      '</svg>\n';
  }

  /* ======================================================================
     PART 7 — the decoder
     ----------------------------------------------------------------------
     Photograph to payload, in five steps: threshold the pixels, find the three
     finder squares, work out the grid they imply, sample it, then run the
     encoder's own structure backwards.
     ====================================================================== */

  /* Adaptive thresholding, block by block. A single global threshold fails on
     anything photographed rather than screenshotted: one corner in shadow and
     half the code reads as dark. Each 8x8 block gets its own threshold from
     its own average, and a block with almost no contrast — a patch of plain
     paper — borrows from its neighbours instead of inventing an edge. */
  function binarize(gray, w, h) {
    var BLK = 8;
    var bw = Math.max(1, Math.ceil(w / BLK)), bh = Math.max(1, Math.ceil(h / BLK));
    var points = new Int32Array(bw * bh);
    var bx, by, x, y;

    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        var sum = 0, min = 255, max = 0, count = 0;
        for (y = by * BLK; y < Math.min(h, by * BLK + BLK); y++) {
          for (x = bx * BLK; x < Math.min(w, bx * BLK + BLK); x++) {
            var v = gray[y * w + x];
            sum += v; count++;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        var avg = count ? sum / count : 128;
        if (max - min <= 24) {
          avg = min / 2;
          if (by > 0 && bx > 0) {
            var neighbour = (points[(by - 1) * bw + bx] +
                             2 * points[by * bw + bx - 1] +
                             points[(by - 1) * bw + bx - 1]) / 4;
            if (min < neighbour) avg = neighbour;
          }
        }
        points[by * bw + bx] = avg;
      }
    }

    var bits = new Uint8Array(w * h);
    for (by = 0; by < bh; by++) {
      for (bx = 0; bx < bw; bx++) {
        // Average the 5x5 neighbourhood of block thresholds so the boundary
        // between two blocks is not a visible seam in the binary image.
        var left = Math.max(0, Math.min(bx - 2, bw - 5 > 0 ? bw - 5 : 0));
        var top = Math.max(0, Math.min(by - 2, bh - 5 > 0 ? bh - 5 : 0));
        var total = 0, n = 0;
        for (var dy = 0; dy < 5 && top + dy < bh; dy++) {
          for (var dx = 0; dx < 5 && left + dx < bw; dx++) {
            total += points[(top + dy) * bw + left + dx]; n++;
          }
        }
        var thr = n ? total / n : 128;
        for (y = by * BLK; y < Math.min(h, by * BLK + BLK); y++) {
          for (x = bx * BLK; x < Math.min(w, bx * BLK + BLK); x++) {
            bits[y * w + x] = gray[y * w + x] < thr ? 1 : 0;
          }
        }
      }
    }
    return bits;
  }

  /* The finder pattern is a 1:1:3:1:1 run of dark-light-dark-light-dark, and
     it is deliberately a ratio no ordinary picture produces. Everything below
     is checking that ratio along a row, then confirming it down a column and
     across the diagonal through the same point. */
  function crossCheckRatio(counts) {
    var total = 0, i;
    for (i = 0; i < 5; i++) {
      if (counts[i] === 0) return false;
      total += counts[i];
    }
    if (total < 7) return false;
    var unit = total / 7, slack = unit / 2;
    return Math.abs(unit - counts[0]) < slack &&
           Math.abs(unit - counts[1]) < slack &&
           Math.abs(3 * unit - counts[2]) < 3 * slack &&
           Math.abs(unit - counts[3]) < slack &&
           Math.abs(unit - counts[4]) < slack;
  }

  function centreFromEnd(counts, end) {
    return end - counts[4] - counts[3] - counts[2] / 2;
  }

  function checkVertical(bits, w, h, startX, centreY, maxCount, originalTotal) {
    if (startX < 0 || startX >= w || centreY < 0 || centreY >= h) return -1;
    var counts = [0, 0, 0, 0, 0];
    var y = centreY;
    while (y >= 0 && bits[y * w + startX] && counts[2] <= maxCount) { counts[2]++; y--; }
    if (y < 0 || counts[2] > maxCount) return -1;
    while (y >= 0 && !bits[y * w + startX] && counts[1] <= maxCount) { counts[1]++; y--; }
    if (y < 0 || counts[1] > maxCount) return -1;
    while (y >= 0 && bits[y * w + startX] && counts[0] <= maxCount) { counts[0]++; y--; }
    if (counts[0] > maxCount) return -1;

    y = centreY + 1;
    while (y < h && bits[y * w + startX] && counts[2] <= maxCount) { counts[2]++; y++; }
    if (y === h || counts[2] > maxCount) return -1;
    while (y < h && !bits[y * w + startX] && counts[3] <= maxCount) { counts[3]++; y++; }
    if (y === h || counts[3] > maxCount) return -1;
    while (y < h && bits[y * w + startX] && counts[4] <= maxCount) { counts[4]++; y++; }
    if (counts[4] > maxCount) return -1;

    var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return -1;
    return crossCheckRatio(counts) ? centreFromEnd(counts, y) : -1;
  }

  function checkHorizontal(bits, w, h, centreX, centreY, maxCount, originalTotal) {
    if (centreX < 0 || centreX >= w || centreY < 0 || centreY >= h) return -1;
    var counts = [0, 0, 0, 0, 0];
    var x = centreX;
    var row = centreY * w;
    while (x >= 0 && bits[row + x] && counts[2] <= maxCount) { counts[2]++; x--; }
    if (x < 0 || counts[2] > maxCount) return -1;
    while (x >= 0 && !bits[row + x] && counts[1] <= maxCount) { counts[1]++; x--; }
    if (x < 0 || counts[1] > maxCount) return -1;
    while (x >= 0 && bits[row + x] && counts[0] <= maxCount) { counts[0]++; x--; }
    if (counts[0] > maxCount) return -1;

    x = centreX + 1;
    while (x < w && bits[row + x] && counts[2] <= maxCount) { counts[2]++; x++; }
    if (x === w || counts[2] > maxCount) return -1;
    while (x < w && !bits[row + x] && counts[3] <= maxCount) { counts[3]++; x++; }
    if (x === w || counts[3] > maxCount) return -1;
    while (x < w && bits[row + x] && counts[4] <= maxCount) { counts[4]++; x++; }
    if (counts[4] > maxCount) return -1;

    var total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    if (5 * Math.abs(total - originalTotal) >= originalTotal) return -1;
    return crossCheckRatio(counts) ? centreFromEnd(counts, x) : -1;
  }

  function findFinders(bits, w, h) {
    var found = [];

    function record(cx, cy, unit) {
      for (var i = 0; i < found.length; i++) {
        var p = found[i];
        if (Math.abs(p.x - cx) <= unit && Math.abs(p.y - cy) <= unit) {
          // Average duplicates rather than keeping both: the same square is
          // hit once per scan line that crosses it.
          p.x = (p.x * p.n + cx) / (p.n + 1);
          p.y = (p.y * p.n + cy) / (p.n + 1);
          p.unit = (p.unit * p.n + unit) / (p.n + 1);
          p.n++;
          return;
        }
      }
      found.push({ x: cx, y: cy, unit: unit, n: 1 });
    }

    /* A candidate is only accepted once the same 1:1:1:3:1 ratio holds down
       the column through it as well as along the row. Ordinary photographs
       throw up plenty of horizontal near-misses; almost none of them survive
       the vertical check. */
    function tryCentre(c, endX, y) {
      var total = c[0] + c[1] + c[2] + c[3] + c[4];
      var cx = centreFromEnd(c, endX);
      /* The cross-checks are bounded so a walk cannot run away across a large
         dark area, but the bound has to be generous: a code photographed at an
         angle has a different module size vertically than horizontally, and a
         bound of exactly the horizontal centre run threw away every row of a
         perfectly good finder pattern whose vertical centre measured 23 pixels
         against the row's 21. The ratio test below is what actually decides
         whether this is a finder; this only stops the walk. */
      var maxCount = c[2] * 2;
      var cy = checkVertical(bits, w, h, Math.floor(cx), y, maxCount, total);
      if (cy < 0) return;
      var cx2 = checkHorizontal(bits, w, h, Math.floor(cx), Math.floor(cy), maxCount, total);
      if (cx2 < 0) return;
      record(cx2, cy, total / 7);
    }

    var counts = [0, 0, 0, 0, 0];
    for (var y = 0; y < h; y++) {
      counts[0] = counts[1] = counts[2] = counts[3] = counts[4] = 0;
      var state = 0;
      var row = y * w;
      for (var x = 0; x < w; x++) {
        if (bits[row + x]) {
          if (state % 2 === 1) state++;
          counts[state]++;
        } else if (state % 2 === 1) {
          counts[state]++;
        } else if (state === 4) {
          if (crossCheckRatio(counts)) tryCentre(counts, x, y);
          // Either way, slide the window along: the last dark-light-dark of a
          // failed match may be the first three runs of the next one.
          counts[0] = counts[2]; counts[1] = counts[3]; counts[2] = counts[4];
          counts[3] = 1; counts[4] = 0; state = 3;
        } else {
          state++;
          counts[state]++;
        }
      }
      if (state === 4 && crossCheckRatio(counts)) tryCentre(counts, w, y);
    }

    return found;
  }

  function dist(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Which finder is which. The two furthest apart are the diagonal pair, so
     the remaining one is the top-left corner. The sign of the cross product
     taken at that corner then separates top-right from bottom-left — and it
     has to be taken at the corner, not at one of the arms, or the two come
     back swapped and the whole grid is read transposed. */
  function orderFinders(p) {
    var d01 = dist(p[0], p[1]), d12 = dist(p[1], p[2]), d02 = dist(p[0], p[2]);
    var a, b, c;
    if (d12 >= d01 && d12 >= d02) { a = p[0]; b = p[1]; c = p[2]; }
    else if (d02 >= d12 && d02 >= d01) { a = p[1]; b = p[0]; c = p[2]; }
    else { a = p[2]; b = p[0]; c = p[1]; }
    var cross = (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
    if (cross < 0) { var t = b; b = c; c = t; }
    return { topLeft: a, bottomLeft: b, topRight: c };
  }

  /* Confirm an alignment candidate down its column: light, then one module of
     dark, then light again. Returns the continuous centre, or null. */
  function alignmentVertical(bits, w, h, x, y, unit, slack) {
    if (x < 0 || x >= w || y < 0 || y >= h) return null;
    if (!bits[y * w + x]) return null;
    var up = y, down = y;
    while (up > 0 && bits[(up - 1) * w + x]) up--;
    while (down < h - 1 && bits[(down + 1) * w + x]) down++;
    if (Math.abs(unit - (down - up + 1)) >= slack) return null;

    var a = up - 1, lightUp = 0;
    while (a >= 0 && !bits[a * w + x] && lightUp <= unit * 2) { lightUp++; a--; }
    var b = down + 1, lightDown = 0;
    while (b < h && !bits[b * w + x] && lightDown <= unit * 2) { lightDown++; b++; }
    if (Math.abs(unit - lightUp) >= slack || Math.abs(unit - lightDown) >= slack) return null;
    return (up + down + 1) / 2;
  }

  /* Find the alignment pattern nearest the bottom-right corner. That single
     extra point is what turns a three-point affine guess into a real
     perspective fit, which is the difference between a photo taken square-on
     and one taken from a chair.

     The shape searched for is light-dark-light, not dark-light-dark: the
     centre dot of an alignment pattern is one dark module surrounded by a
     light ring, and that triple is unambiguous. Scanning for dark-light-dark
     matches two different offsets of the same pattern and lands a whole module
     off centre half the time. */
  function findAlignment(bits, w, h, estX, estY, unit, allowance) {
    var r = Math.ceil(unit * allowance);
    var left = Math.max(0, Math.floor(estX - r)), right = Math.min(w - 1, Math.ceil(estX + r));
    var top = Math.max(0, Math.floor(estY - r)), bottom = Math.min(h - 1, Math.ceil(estY + r));
    if (right - left < unit * 3) return null;
    var slack = unit / 2 + 0.5;
    var best = null, bestD = Infinity;

    for (var y = top; y <= bottom; y++) {
      var row = y * w, x = left;
      while (x <= right) {
        while (x <= right && bits[row + x]) x++;         // skip into a light run
        var s0 = x;
        while (x <= right && !bits[row + x]) x++;        // light
        var s1 = x;
        while (x <= right && bits[row + x]) x++;         // dark
        var s2 = x;
        while (x <= right && !bits[row + x]) x++;        // light
        var s3 = x;
        if (s1 <= s0 || s2 <= s1 || s3 <= s2) break;     // ran off the end
        if (Math.abs(unit - (s1 - s0)) < slack &&
            Math.abs(unit - (s2 - s1)) < slack &&
            Math.abs(unit - (s3 - s2)) < slack) {
          var cx = (s1 + s2) / 2;
          var cy = alignmentVertical(bits, w, h, Math.floor(cx), y, unit, slack);
          if (cy !== null) {
            var d = Math.abs(cx - estX) + Math.abs(cy - estY);
            if (d < bestD) { bestD = d; best = { x: cx, y: cy }; }
          }
        }
        x = s2;   // the trailing light run may start the next triple
      }
    }
    return best;
  }

  /* Perspective transform, mapping the ideal grid onto the photographed
     quadrilateral. Three points give an affine fit, which is wrong for
     anything shot at an angle; the fourth (the bottom-right alignment pattern)
     is what makes a tilted photo sample correctly. */
  function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    var dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) {
      return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
    }
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    var den = dx1 * dy2 - dx2 * dy1;
    var a13 = (dx3 * dy2 - dx2 * dy3) / den;
    var a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0,
            y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0,
            a13, a23, 1];
  }

  /* The nine coefficients are stored in the order
        [a11 a21 a31, a12 a22 a32, a13 a23 a33]
     so that a point transforms as
        x' = (a11 x + a21 y + a31) / (a13 x + a23 y + a33)
        y' = (a12 x + a22 y + a32) / (a13 x + a23 y + a33)
     and composing two transforms is an ordinary 3x3 row-major product. The
     inverse is the adjugate rather than a true inverse: the result is only
     used projectively, so the missing 1/det cancels in both fractions. */
  function adjoint(m) {
    return [
      m[4] * m[8] - m[7] * m[5],
      m[7] * m[2] - m[1] * m[8],
      m[1] * m[5] - m[4] * m[2],
      m[6] * m[5] - m[3] * m[8],
      m[0] * m[8] - m[6] * m[2],
      m[3] * m[2] - m[0] * m[5],
      m[3] * m[7] - m[6] * m[4],
      m[6] * m[1] - m[0] * m[7],
      m[0] * m[4] - m[3] * m[1]
    ];
  }

  function matMul(a, b) {
    var r = [], row, col, sum;
    for (row = 0; row < 3; row++) {
      for (col = 0; col < 3; col++) {
        sum = 0;
        for (var k = 0; k < 3; k++) sum += a[row * 3 + k] * b[k * 3 + col];
        r.push(sum);
      }
    }
    return r;
  }

  function applyTransform(m, x, y) {
    var d = m[6] * x + m[7] * y + m[8];
    return { x: (m[0] * x + m[1] * y + m[2]) / d, y: (m[3] * x + m[4] * y + m[5]) / d };
  }

  function sampleGrid(bits, w, h, dimension, transform) {
    var g = { size: dimension, mods: [] };
    for (var y = 0; y < dimension; y++) {
      var row = new Uint8Array(dimension);
      for (var x = 0; x < dimension; x++) {
        var p = applyTransform(transform, x + 0.5, y + 0.5);
        var px = Math.floor(p.x), py = Math.floor(p.y);
        if (px < 0 || py < 0 || px >= w || py >= h) return null;
        row[x] = bits[py * w + px];
      }
      g.mods.push(row);
    }
    return g;
  }

  /* The 32 valid format codes, generated by the same BCH routine the encoder
     uses, so a damaged read is matched by Hamming distance rather than trusted
     outright. Two copies of the format live in every code precisely because
     this information cannot be allowed to be wrong. */
  var FORMAT_CODES = (function () {
    var list = [];
    for (var ecl = 0; ecl < 4; ecl++) {
      for (var mask = 0; mask < 8; mask++) {
        var data = (ECL_FORMAT_BITS[ecl] << 3) | mask;
        var rem = data;
        for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        list.push({ bits: ((data << 10) | rem) ^ 0x5412, ecl: ecl, mask: mask });
      }
    }
    return list;
  })();

  function popcount(n) {
    var c = 0;
    while (n) { c += n & 1; n >>>= 1; }
    return c;
  }

  /* mods is indexed [y][x], and the two copies are read most-significant bit
     first so the result lines up with what drawFormatBits wrote. */
  function readFormat(g) {
    var size = g.size, i, a = 0, b = 0;
    for (i = 0; i <= 5; i++) a = (a << 1) | g.mods[8][i];
    a = (a << 1) | g.mods[8][7];
    a = (a << 1) | g.mods[8][8];
    a = (a << 1) | g.mods[7][8];
    for (i = 5; i >= 0; i--) a = (a << 1) | g.mods[i][8];

    for (i = size - 1; i >= size - 7; i--) b = (b << 1) | g.mods[i][8];
    for (i = size - 8; i < size; i++) b = (b << 1) | g.mods[8][i];

    var best = null, bestD = 4;
    for (i = 0; i < FORMAT_CODES.length; i++) {
      var d = Math.min(popcount(FORMAT_CODES[i].bits ^ a), popcount(FORMAT_CODES[i].bits ^ b));
      if (d < bestD) { bestD = d; best = FORMAT_CODES[i]; }
    }
    return best;
  }

  /* Read the data codewords back out of a sampled grid: rebuild the function
     map for this version from the encoder, walk the same zigzag, undo the
     mask, then undo the interleave and let Reed-Solomon repair what the
     camera got wrong. */
  function extractCodewords(sampled, ver, ecl, mask) {
    var g = makeGrid(ver);
    drawFunctionPatterns(g, ecl);
    var maskFn = MASKS[mask];
    var totalBits = totalCodewords(ver) * 8;
    var raw = new Uint8Array(totalCodewords(ver));
    walkData(g, function (x, y, idx) {
      if (idx >= totalBits) return;
      var bit = sampled.mods[y][x] ^ (maskFn(x, y) ? 1 : 0);
      if (bit) raw[idx >>> 3] |= 1 << (7 - (idx & 7));
    });

    var numBlocks = NUM_BLOCKS[ecl][ver - 1];
    var eccLen = ECC_PER_BLOCK[ecl][ver - 1];
    var rawCw = totalCodewords(ver);
    var shortLen = Math.floor(rawCw / numBlocks);
    var numShort = numBlocks - (rawCw % numBlocks);

    var blocks = [], i, j;
    for (i = 0; i < numBlocks; i++) blocks.push([]);
    var at = 0;
    for (i = 0; i <= shortLen; i++) {
      for (j = 0; j < numBlocks; j++) {
        if (i === shortLen - eccLen && j < numShort) continue;
        if (at < raw.length) blocks[j].push(raw[at++]);
      }
    }

    var data = [], corrected = 0;
    for (j = 0; j < numBlocks; j++) {
      var block = new Uint8Array(blocks[j]);
      var before = new Uint8Array(blocks[j]);
      if (!rsDecode(block, eccLen)) return { unrecoverable: true, block: j + 1 };
      for (i = 0; i < block.length; i++) if (block[i] !== before[i]) corrected++;
      var dataLen = block.length - eccLen;
      for (i = 0; i < dataLen; i++) data.push(block[i]);
    }
    return { data: new Uint8Array(data), corrected: corrected };
  }

  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function bitReader(bytes) {
    var pos = 0;
    return {
      remaining: function () { return bytes.length * 8 - pos; },
      read: function (n) {
        var v = 0;
        for (var i = 0; i < n; i++) {
          if (pos >= bytes.length * 8) throw new Error('data ended mid-segment');
          v = (v << 1) | ((bytes[pos >>> 3] >>> (7 - (pos & 7))) & 1);
          pos++;
        }
        return v;
      }
    };
  }

  function ccBits(mode, ver) {
    var group = ver <= 9 ? 0 : (ver <= 26 ? 1 : 2);
    if (mode === 1) return [10, 12, 14][group];
    if (mode === 2) return [9, 11, 13][group];
    if (mode === 4) return [8, 16, 16][group];
    if (mode === 8) return [8, 10, 12][group];
    return 0;
  }

  function decodeBytesAsText(bytes) {
    var arr = new Uint8Array(bytes);
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(arr); }
      catch (err) { /* fall through to Latin-1 */ }
    }
    // ISO-8859-1 is the format's declared default when there is no ECI, and it
    // never throws — so a non-UTF-8 payload still shows something readable
    // rather than nothing.
    var s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return s;
  }

  function decodeSegments(data, ver) {
    var br = bitReader(data);
    var text = '', notes = [], bytes = [], i, j;

    function flushBytes() {
      if (bytes.length) { text += decodeBytesAsText(bytes); bytes = []; }
    }

    while (br.remaining() >= 4) {
      var mode = br.read(4);
      if (mode === 0) break;                       // terminator
      if (mode === 7) {                            // ECI: a character-set hint
        var first = br.read(8);
        var eci;
        if ((first & 0x80) === 0) eci = first;
        else if ((first & 0xc0) === 0x80) eci = ((first & 0x3f) << 8) | br.read(8);
        else eci = ((first & 0x1f) << 16) | br.read(16);
        notes.push('ECI character-set marker ' + eci);
        continue;
      }
      if (mode === 5) { notes.push('FNC1 in first position (GS1 data)'); continue; }
      if (mode === 9) { br.read(8); notes.push('FNC1 in second position'); continue; }
      if (mode === 3) {                            // structured append
        var idx = br.read(4), total = br.read(4);
        br.read(8);
        notes.push('Structured append: part ' + (idx + 1) + ' of ' + (total + 1) +
                   ' — this is only a fragment');
        continue;
      }

      var n = ccBits(mode, ver);
      if (!n) { notes.push('Unknown segment mode ' + mode + '; stopped here'); break; }
      var count = br.read(n);

      if (mode === 1) {
        flushBytes();
        for (i = 0; i + 3 <= count; i += 3) {
          var t = br.read(10);
          text += String(t + 1000).slice(1);
        }
        if (count - i === 2) { var d2 = br.read(7); text += String(d2 + 100).slice(1); }
        else if (count - i === 1) { text += String(br.read(4)); }
      } else if (mode === 2) {
        flushBytes();
        for (i = 0; i + 2 <= count; i += 2) {
          var pair = br.read(11);
          text += ALNUM.charAt(Math.floor(pair / 45)) + ALNUM.charAt(pair % 45);
        }
        if (count - i === 1) text += ALNUM.charAt(br.read(6));
      } else if (mode === 4) {
        for (j = 0; j < count; j++) bytes.push(br.read(8));
      } else if (mode === 8) {
        for (j = 0; j < count; j++) br.read(13);
        notes.push('A Shift-JIS kanji segment was skipped — this reader does not decode it');
      }
    }
    flushBytes();
    return { text: text, notes: notes };
  }

  /* Walk from a finder centre toward a point and return how far it is to the
     far edge of the outer ring: 1.5 modules of centre block, 1 of light ring,
     1 of dark ring. */
  function runToward(bits, w, h, fromX, fromY, toX, toY) {
    var dx = toX - fromX, dy = toY - fromY;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return NaN;
    var sx = dx / len, sy = dy / len;
    var state = 0;   // 0 centre block, 1 light ring, 2 dark ring
    for (var t = 0; t <= len; t += 0.5) {
      var px = Math.round(fromX + sx * t), py = Math.round(fromY + sy * t);
      if (px < 0 || py < 0 || px >= w || py >= h) return NaN;
      var dark = bits[py * w + px] === 1;
      if (t === 0 && !dark) return NaN;
      if (state === 0 && !dark) state = 1;
      else if (state === 1 && dark) state = 2;
      else if (state === 2 && !dark) return t;
    }
    return NaN;
  }

  /* The module size, measured along the line joining two finder centres.

     Taking it from the run widths in an image row instead — which is what the
     scan already has to hand — overstates it by 1/cos(angle) on a code that is
     not square to the frame, because a horizontal chord across a rotated
     square is longer than its side. That estimate then divides the
     centre-to-centre distance and the computed grid size comes out short: a
     photo held at 30 degrees decoded as the wrong version and failed on the
     format bits. Measuring in the same direction the distance is measured in
     cancels the angle entirely. */
  function moduleSizeAlong(bits, w, h, a, b) {
    var forward = runToward(bits, w, h, a.x, a.y, b.x, b.y);
    var back = runToward(bits, w, h, a.x, a.y, 2 * a.x - b.x, 2 * a.y - b.y);
    if (isNaN(forward) && isNaN(back)) return NaN;
    if (isNaN(forward)) return back / 3.5;
    if (isNaN(back)) return forward / 3.5;
    return (forward + back) / 7;
  }

  function measureUnit(bits, w, h, o) {
    var across = moduleSizeAlong(bits, w, h, o.topLeft, o.topRight);
    var down = moduleSizeAlong(bits, w, h, o.topLeft, o.bottomLeft);
    var fallback = (o.topLeft.unit + o.topRight.unit + o.bottomLeft.unit) / 3;
    if (isNaN(across) && isNaN(down)) return fallback;
    if (isNaN(across)) return down;
    if (isNaN(down)) return across;
    return (across + down) / 2;
  }

  /* Round a centre-to-centre span into a legal module count. QR sizes are
     4v+17, so the dimension is always 1 modulo 4; 0 and 2 are off-by-one
     rounding and are nudged, 3 cannot be rescued. */
  function toDimension(across, down) {
    var dimension = Math.round((across + down) / 2) + 7;
    switch (dimension & 3) {
      case 0: dimension++; break;
      case 2: dimension--; break;
      case 3: return 0;
    }
    return (dimension < 21 || dimension > 177) ? 0 : dimension;
  }

  /* Choose which three candidates are the corners of one code.

     Ranking by hit count alone is not enough: the data area of a large code
     contains runs that pass the 1:1:3:1:1 test by chance, and a version 25
     code threw up three of them. So every triple is scored on the geometry it
     implies — the two sides should be equal, the diagonal should close the
     right angle, the three module sizes should agree, and the resulting
     dimension has to be a legal QR size. A false corner fails at least one of
     those, and usually all four. */
  function pickTriple(bits, w, h, found) {
    var pool = found.slice();
    pool.sort(function (a, b) { return b.n - a.n; });
    pool = pool.slice(0, 12);

    var best = null, bestScore = Infinity;
    for (var i = 0; i < pool.length - 2; i++) {
      for (var j = i + 1; j < pool.length - 1; j++) {
        for (var k = j + 1; k < pool.length; k++) {
          var t = [pool[i], pool[j], pool[k]];
          var minU = Math.min(t[0].unit, t[1].unit, t[2].unit);
          var maxU = Math.max(t[0].unit, t[1].unit, t[2].unit);
          if (!(minU > 0) || maxU > minU * 1.7) continue;
          var o = orderFinders(t);
          var unit = (t[0].unit + t[1].unit + t[2].unit) / 3;
          var across = dist(o.topLeft, o.topRight) / unit;
          var down = dist(o.topLeft, o.bottomLeft) / unit;
          // The closest two finder centres in any QR code are 14 modules
          // apart, and no code is wider than 170. Generous, because this unit
          // is the row-scan estimate and a rotated code inflates it.
          if (across < 9 || down < 9 || across > 240 || down > 240) continue;
          // These two terms are ratios of distances, so the unit cancels: the
          // sides must match each other and the diagonal must close the right
          // angle, whatever the module size turns out to be.
          var diag = dist(o.topRight, o.bottomLeft) / unit;
          var ideal = Math.sqrt(across * across + down * down);
          var score = Math.abs(across - down) / ((across + down) / 2) +
                      Math.abs(diag - ideal) / ideal +
                      (maxU / minU - 1) +
                      3 / (t[0].n + t[1].n + t[2].n);
          if (score < bestScore) { bestScore = score; best = { order: o, unit: unit }; }
        }
      }
    }
    return best;
  }

  /* Sample and decode with a given bottom-right corner. Split out from
     decodeBits so the alignment-pattern fit and the plain three-point fit can
     both be tried: a misidentified alignment pattern skews the transform badly
     enough to sample outside the image, and falling back is cheaper and more
     honest than pretending the code was unreadable. */
  function attemptGrid(bits, w, h, o, dimension, ver, unit, brX, brY, srcBR, tilted) {
    var q2s = adjoint(squareToQuad(3.5, 3.5, dimension - 3.5, 3.5,
                                   srcBR, srcBR, 3.5, dimension - 3.5));
    var s2q = squareToQuad(o.topLeft.x, o.topLeft.y, o.topRight.x, o.topRight.y,
                           brX, brY, o.bottomLeft.x, o.bottomLeft.y);
    var sampled = sampleGrid(bits, w, h, dimension, matMul(s2q, q2s));
    if (!sampled) return { fail: 'sample' };

    var fmt = readFormat(sampled);
    if (!fmt) return { fail: 'format' };

    var cw = extractCodewords(sampled, ver, fmt.ecl, fmt.mask);
    if (cw.unrecoverable) return { fail: 'ecc', block: cw.block };

    var seg;
    try { seg = decodeSegments(cw.data, ver); }
    catch (err) { return { fail: 'segments', message: err.message }; }

    return {
      text: seg.text, notes: seg.notes, version: ver, ecl: fmt.ecl,
      mask: fmt.mask, dimension: dimension, corrected: cw.corrected,
      moduleSize: unit, tilted: tilted
    };
  }

  /* One end-to-end attempt over an already-binarised image. */
  function decodeBits(bits, w, h) {
    var finders = findFinders(bits, w, h);
    if (finders.length < 3) return { fail: 'finders', count: finders.length };

    var picked = pickTriple(bits, w, h, finders);
    if (!picked) return { fail: 'dimension' };
    var o = picked.order;

    /* Two independent module-size estimates, and neither is reliably the
       better one. The row-scan average is precise when the code is square to
       the frame but inflates with rotation; the along-the-axis walk is immune
       to rotation but is quantised by the pixel grid, which on a version 40
       code sampled at three pixels per module is enough to land a version out.
       So both are turned into candidate grid sizes and each is tried: a wrong
       size fails on the format bits or the parity within microseconds, and
       trying one more is cheaper than being wrong. */
    var spanAcross = dist(o.topLeft, o.topRight);
    var spanDown = dist(o.topLeft, o.bottomLeft);
    var candidates = [], seen = {};
    [picked.unit, measureUnit(bits, w, h, o)].forEach(function (u) {
      if (!(u > 0)) return;
      var d = toDimension(spanAcross / u, spanDown / u);
      // The neighbouring versions cover a rounding that fell one step short.
      [d, d - 4, d + 4].forEach(function (cand) {
        if (cand >= 21 && cand <= 177 && (cand & 3) === 1 && !seen[cand]) {
          seen[cand] = true;
          candidates.push(cand);
        }
      });
    });
    if (!candidates.length) return { fail: 'dimension' };

    var lastFail = { fail: 'dimension' };
    for (var c = 0; c < candidates.length; c++) {
      var dimension = candidates[c];
      var ver = (dimension - 17) / 4;
      // The most accurate module size available once the grid size is known.
      var unit = (spanAcross + spanDown) / 2 / (dimension - 7);
      // With no fourth reference point the bottom-right corner is where the
      // parallelogram closes, exact only if the code was shot flat on.
      var flatX = o.topRight.x - o.topLeft.x + o.bottomLeft.x;
      var flatY = o.topRight.y - o.topLeft.y + o.bottomLeft.y;

      if (ver > 1) {
        var correction = 1 - 3 / (dimension - 7);
        var estX = o.topLeft.x + correction * (flatX - o.topLeft.x);
        var estY = o.topLeft.y + correction * (flatY - o.topLeft.y);
        var align = null;
        for (var a = 4; a <= 16 && !align; a *= 2) {
          align = findAlignment(bits, w, h, estX, estY, unit, a);
        }
        if (align) {
          var withAlign = attemptGrid(bits, w, h, o, dimension, ver, unit,
                                      align.x, align.y, dimension - 6.5, true);
          if (withAlign.text !== undefined) return withAlign;
          lastFail = withAlign;
        }
      }
      var flat = attemptGrid(bits, w, h, o, dimension, ver, unit,
                             flatX, flatY, dimension - 3.5, false);
      if (flat.text !== undefined) return flat;
      lastFail = flat;
    }
    return lastFail;
  }

  /* Try the image as printed and, failing that, inverted. Light-on-dark QR
     codes are common in marketing material and on dark app screens, and they
     scan fine on a phone because the camera stack tries both too. */
  function decodeImageData(imageData) {
    var w = imageData.width, h = imageData.height, d = imageData.data;
    var gray = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      // Luma weights, and any transparent pixel is treated as white paper —
      // a PNG QR with a transparent background is otherwise all-dark noise.
      var alpha = d[p + 3];
      var v = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
      gray[i] = alpha < 128 ? 255 : v;
    }

    var normal = decodeBits(binarize(gray, w, h), w, h);
    if (normal.text !== undefined) return normal;

    for (i = 0; i < gray.length; i++) gray[i] = 255 - gray[i];
    var inverted = decodeBits(binarize(gray, w, h), w, h);
    if (inverted.text !== undefined) { inverted.inverted = true; return inverted; }

    return normal;
  }

  /* ======================================================================
     PART 8 — what the payload would actually do
     ----------------------------------------------------------------------
     Nothing below fetches, resolves or opens anything. Every judgement is made
     on the string.
     ====================================================================== */

  var SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd',
    'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc',
    'lnkd.in', 't.ly', 'v.gd', 'bit.do', 'qrco.de', 'shrtco.de', 's.id',
    'clck.ru', 'u.to', 'urlz.fr', 'short.gy', 'tinu.be', 'rblink.in'];

  var REDIRECT_PARAMS = ['url', 'u', 'r', 'next', 'target', 'dest', 'destination',
    'redirect', 'redirect_uri', 'redirect_url', 'return', 'returnto', 'returnurl',
    'continue', 'goto', 'out', 'link', 'to', 'q', 'rurl'];

  /* Multi-part public suffixes, so the last two labels are not mistaken for
     the registered name. Without this, krunalkumar.dpdns.org "reads as"
     dpdns.org — a suffix nobody can register, and the wrong half of the name
     to be reading in a phishing check. The full public suffix list is around
     ten thousand entries and changes weekly, which is a bigger download than
     this entire page, so this is the subset that actually turns up.

     There is a second copy of this list in url-inspector.js. The site has no
     module system, and one wrong answer here is worse than two copies of a
     constant — but if you change one, change the other. */
  var MULTI_SUFFIX = [
    'co.uk', 'org.uk', 'me.uk', 'ac.uk', 'gov.uk', 'net.uk', 'sch.uk', 'ltd.uk', 'plc.uk',
    'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'com.au', 'net.au', 'org.au', 'edu.au',
    'gov.au', 'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'co.za', 'org.za',
    'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in', 'co.kr', 'or.kr',
    'co.il', 'ac.il', 'org.il', 'co.th', 'ac.th', 'in.th', 'com.br', 'com.cn', 'net.cn',
    'org.cn', 'gov.cn', 'com.mx', 'com.tr', 'gov.tr', 'com.ar', 'com.sg', 'com.hk',
    'com.tw', 'com.pl', 'com.ua', 'com.my', 'com.ph', 'com.vn', 'com.pk', 'com.eg',
    'com.sa', 'com.ng', 'com.co', 'com.pe', 'com.ec', 'com.uy', 'com.ve', 'com.es',
    'ac.at', 'co.at', 'or.at', 'com.de', 'com.ru', 'net.ru', 'org.ru',
    'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app',
    'herokuapp.com', 'firebaseapp.com', 'web.app', 'glitch.me', 'repl.co',
    'blogspot.com', 'wordpress.com', '000webhostapp.com', 'azurewebsites.net',
    'duckdns.org', 'dpdns.org', 'no-ip.org', 'ddns.net', 'hopto.org', 'serveo.net',
    'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'onion.to'
  ];

  /* The suffix plus the one label to its left — the part somebody bought.
     Returns null when there is nothing registrable, which is the honest answer
     for a single-label host and for an IP literal. */
  function registrableDomain(labels) {
    if (labels.length < 2) return null;
    var lastTwo = labels.slice(-2).join('.').toLowerCase();
    var take = MULTI_SUFFIX.indexOf(lastTwo) !== -1 ? 3 : 2;
    if (labels.length < take) return null;
    return labels.slice(-take).join('.');
  }

  function looksLikeIpv4(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  }

  function nonAsciiReport(host) {
    var hits = [];
    for (var i = 0; i < host.length; i++) {
      var code = host.charCodeAt(i);
      if (code > 126 || code < 32) {
        hits.push('U+' + ('0000' + code.toString(16).toUpperCase()).slice(-4) +
                  ' at position ' + (i + 1));
      }
    }
    return hits;
  }

  function reportUrl(text) {
    var url;
    try { url = new URL(text); }
    catch (err) { out.warn('That looks like a URL but does not parse as one.'); return; }

    var host = url.hostname || '';
    out.row('scheme', url.protocol.replace(':', ''));
    out.row('host', host || '(none)');
    if (url.port) out.row('port', url.port, 't-warn');
    out.row('path', url.pathname || '/');
    if (url.search) out.row('query', url.search.slice(1));
    if (url.hash) out.row('fragment', url.hash.slice(1));

    var labels = host.split('.');
    var ipLiteral = looksLikeIpv4(host) || host.charAt(0) === '[';
    var registrable = ipLiteral ? null : registrableDomain(labels);
    var depth = 0;
    if (registrable) {
      depth = labels.length - registrable.split('.').length;
      out.row('reads as', registrable);
      out.dim('That is the part somebody registered. Everything to the left of');
      out.dim('it is a subdomain they chose for themselves and means nothing.');
    }

    out.rule();
    var flagged = 0;

    if (url.protocol === 'http:') {
      flagged++;
      out.warn('Plain http. The connection is not encrypted, so anything typed');
      out.warn('into that page crosses the network in the clear.');
    }
    if (url.username || url.password) {
      flagged++;
      out.err('There are credentials before the @ in this URL.');
      out.err('Everything before the @ is a username, not a destination. This');
      out.err('goes to ' + host + ', not to whatever the front half says.');
    }
    if (ipLiteral) {
      flagged++;
      out.err('The host is a bare IP address, not a name.');
      out.err('Legitimate services publish a domain. An IP in a QR code is');
      out.err('almost always someone avoiding a name that could be reported.');
    }
    if (host.toLowerCase().indexOf('xn--') !== -1) {
      flagged++;
      out.err('This hostname is punycode — it contains non-Latin characters');
      out.err('that render as something else entirely. Paste it into the URL');
      out.err('inspector to see what it actually displays as.');
    }
    var weird = nonAsciiReport(host);
    if (weird.length) {
      flagged++;
      out.err('Non-ASCII characters in the hostname: ' + weird.join(', '));
      out.err('A Cyrillic a is a different letter that draws the same shape.');
    }
    if (registrable && SHORTENERS.indexOf(registrable.toLowerCase()) !== -1) {
      flagged++;
      out.warn('That is a link shortener (' + registrable + ').');
      out.warn('The real destination is hidden behind a redirect and nothing');
      out.warn('here will follow it — requesting it would tell whoever made');
      out.warn('the code that someone is looking. A shortener inside a QR code');
      out.warn('is two layers of concealment on one link.');
    }
    // Depth counted from the registrable domain, not from a fixed two labels,
    // or news.bbc.co.uk looks deeper than it is.
    if (depth > 2) {
      flagged++;
      out.warn('That host has ' + depth + ' levels of subdomain above ' + registrable + '.');
      out.warn('Deep subdomains push the real domain off the right-hand edge of');
      out.warn('a phone address bar, where it is the only part that matters.');
    }
    if (url.port && url.port !== '80' && url.port !== '443') {
      flagged++;
      out.warn('Non-standard port ' + url.port + '.');
    }

    var params = url.searchParams;
    var nested = [];
    params.forEach(function (value, key) {
      if (REDIRECT_PARAMS.indexOf(key.toLowerCase()) !== -1 && /https?%3a|https?:/i.test(value)) {
        nested.push(key + ' = ' + value);
      }
    });
    if (nested.length) {
      flagged++;
      out.warn('A parameter carries another URL:');
      nested.forEach(function (n) { out.warn('  ' + n); });
      out.warn('That is the shape of an open redirect: the first host is real,');
      out.warn('and it forwards you to the second one.');
    }
    if (/%25[0-9a-f]{2}/i.test(text)) {
      flagged++;
      out.warn('Double percent-encoding is present. Something is being hidden');
      out.warn('from a filter that only decodes once.');
    }

    if (!flagged) {
      out.ok('Nothing structurally suspicious in the link itself.');
      out.dim('That is not the same as safe. A well-formed URL on a domain');
      out.dim('registered this morning still reads clean here. Ask whether you');
      out.dim('expected this code to point at this domain at all.');
    }
    out.line('');
    out.dim('For the full breakdown — homograph decoding, encoding layers,');
    out.dim('suffix handling — paste it into /labs/url-inspector.');
  }

  /* A UPI intent string. This is the reason the inspect half exists.

     `pa` is the only field that decides where money goes. `pn` is free text
     chosen by whoever made the code and is displayed prominently by most apps,
     which is exactly why it is worth showing separately from the handle. */
  function reportUpi(text) {
    var qIndex = text.indexOf('?');
    var head = qIndex < 0 ? text : text.slice(0, qIndex);
    var query = qIndex < 0 ? '' : text.slice(qIndex + 1);
    var params = {};
    if (query) {
      query.split('&').forEach(function (pair) {
        if (!pair) return;
        var eq = pair.indexOf('=');
        var key = eq < 0 ? pair : pair.slice(0, eq);
        var val = eq < 0 ? '' : pair.slice(eq + 1);
        try { val = decodeURIComponent(val.replace(/\+/g, ' ')); } catch (err) { /* keep raw */ }
        params[key.toLowerCase()] = val;
      });
    }

    var action = head.replace(/^upi:\/{0,2}/i, '') || 'pay';
    out.err('THIS IS A PAYMENT INSTRUCTION');
    out.line('');
    out.row('action', action);
    out.row('payee address (pa)', params.pa || '(missing)', params.pa ? null : 't-warn');
    out.row('payee name (pn)', params.pn || '(not set)');
    if (params.am) out.row('amount (am)', (params.cu || 'INR') + ' ' + params.am, 't-warn');
    else out.row('amount (am)', 'not fixed — the app will ask you', 't-warn');
    if (params.mam) out.row('minimum amount', params.mam);
    if (params.tn) out.row('note (tn)', params.tn);
    if (params.mc) out.row('merchant code (mc)', params.mc);
    if (params.tr) out.row('transaction ref (tr)', params.tr);
    if (params.tid) out.row('transaction id (tid)', params.tid);
    if (params.mode) out.row('mode', params.mode);
    if (params.sign) out.row('signature', 'present (' + params.sign.length + ' chars)');
    if (params.url) out.row('invoice url', params.url, 't-warn');

    out.rule();
    out.err('Scanning this can only take money OUT of your account.');
    out.err('There is no UPI QR code that pays money INTO your account. If');
    out.err('someone sent you this and said it is so you can receive a refund,');
    out.err('a prize, a deposit or a salary, it is a scam, and completing it');
    out.err('pays them. Your UPI PIN is only ever needed to send.');
    out.line('');

    /* Each note below is written to a fixed width rather than interpolating a
       field into the prose. Payee names and handles are arbitrary length, and
       splicing one into a sentence left the terminal pane ragged — a line of
       nine characters followed by a full one. The values are already on their
       own rows above, where they are easier to read anyway. */
    if (params.pa) {
      var at = params.pa.indexOf('@');
      if (at > 0) {
        out.row('provider handle', params.pa.slice(at + 1));
        out.dim('The handle after the @ is the payment provider, not the payee.');
        out.dim('Anyone can open an account there, in any name. It is not a bank');
        out.dim('vouching for this person.');
        out.line('');
      }
    }
    if (params.pn) {
      out.warn('The payee name above is free text typed by whoever built this');
      out.warn('code. Nobody verifies it. Trust the name your UPI app resolves');
      out.warn('from the address instead, and stop if the two disagree.');
      out.line('');
    }
    if (!params.am) {
      out.warn('No amount is fixed, so the app will ask you to type one. That is');
      out.warn('the version that comes with a story — "just enter one rupee to');
      out.warn('verify" — and the field is yours to fill in wrongly.');
      out.line('');
    }
    if (params.url) {
      out.warn('This code also carries a URL. Checking it as a link:');
      out.rule();
      reportUrl(params.url);
      out.line('');
    }
    out.dim('The rest of this family — collect requests, mandates, and the phone');
    out.dim('call that comes with them — is walked through at /labs/upi-fraud.');
  }

  function reportWifi(text) {
    var fields = {};
    // Fields are ; separated, and \ escapes the separators inside a value.
    var buf = '', key = null, i, ch;
    var body = text.slice(5);
    for (i = 0; i < body.length; i++) {
      ch = body.charAt(i);
      if (ch === '\\') { buf += body.charAt(++i); continue; }
      if (ch === ':' && key === null) { key = buf.toUpperCase(); buf = ''; continue; }
      if (ch === ';') { if (key !== null) fields[key] = buf; key = null; buf = ''; continue; }
      buf += ch;
    }
    out.heading('Wi-Fi join instruction');
    out.row('network (SSID)', fields.S || '(missing)');
    out.row('security', fields.T || 'nopass');
    out.row('password', fields.P ? fields.P : '(none)');
    if (fields.H) out.row('hidden network', fields.H);
    out.rule();
    out.warn('Scanning this joins a network. On an open or attacker-run');
    out.warn('network every unencrypted request is readable and captive');
    out.warn('portals can push a convincing login page at you.');
    if ((fields.T || 'nopass').toLowerCase() === 'nopass') {
      out.err('This network has no password at all.');
    }
  }

  function reportContact(text) {
    out.heading(text.indexOf('MECARD:') === 0 ? 'MECARD contact' : 'vCard contact');
    var lines = text.split(/\r?\n/);
    lines.forEach(function (line) {
      var c = line.indexOf(':');
      if (c > 0 && line.indexOf('BEGIN') !== 0 && line.indexOf('END') !== 0 &&
          line.indexOf('VERSION') !== 0) {
        out.row(line.slice(0, c).toLowerCase(), line.slice(c + 1));
      }
    });
    out.rule();
    out.dim('A contact card is harmless on its own. Check any URL inside it');
    out.dim('before tapping it, and treat an unexpected one as an attempt to');
    out.dim('get a number or address into your address book so a later message');
    out.dim('arrives looking like it is from someone you know.');
  }

  var SCHEME_NOTES = {
    'javascript': 'Executable script. Nothing legitimate puts this in a QR code.',
    'data': 'An entire document embedded in the code itself, with no host to check.',
    'file': 'Points at a local file path. Nothing legitimate puts this in a QR code.',
    'intent': 'An Android intent. It can name a specific app and hand it data directly.',
    'market': 'Opens an app store listing. Check the developer name, not the app name.',
    'tel': 'Dials a number. Premium-rate and callback scams start here.',
    'sms': 'Composes a text message, sometimes with the body prefilled.',
    'smsto': 'Composes a text message, sometimes with the body prefilled.',
    'mailto': 'Composes an email, sometimes with the subject and body prefilled.',
    'bitcoin': 'A cryptocurrency payment request. Transfers are irreversible.',
    'ethereum': 'A cryptocurrency payment request. Transfers are irreversible.',
    'otpauth': 'A two-factor seed. Anyone who scans it can generate your codes forever.'
  };

  function analyse(text) {
    var trimmed = String(text);
    var lower = trimmed.toLowerCase();

    out.rule();
    out.heading('What this code says');
    out.row('length', trimmed.length + ' characters');
    out.line('');
    out.line(trimmed);
    out.line('');
    out.dim('Printed as text on purpose. Nothing here is a link, nothing was');
    out.dim('requested, and nothing will open. Use Copy below if you need it.');
    out.rule();
    out.heading('What it would do');

    if (lower.indexOf('upi:') === 0) { reportUpi(trimmed); return; }
    if (lower.indexOf('wifi:') === 0) { reportWifi(trimmed); return; }
    if (lower.indexOf('begin:vcard') === 0 || lower.indexOf('mecard:') === 0) {
      reportContact(trimmed); return;
    }
    if (lower.indexOf('http://') === 0 || lower.indexOf('https://') === 0) {
      out.line('Opens a web page.');
      out.line('');
      reportUrl(trimmed);
      return;
    }

    var m = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
    if (m) {
      var scheme = m[1].toLowerCase();
      if (SCHEME_NOTES[scheme]) {
        out.row('scheme', scheme, 't-warn');
        out.warn(SCHEME_NOTES[scheme]);
        out.line('');
        out.warn('This is not a web link, so it hands the payload straight to an');
        out.warn('app on your phone rather than to a browser you can inspect.');
        if (/^(tel|sms|smsto):/i.test(trimmed)) {
          out.dim('The number is above. Check it against the organisation you');
          out.dim('think this code belongs to before dialling anything.');
        }
        return;
      }
      out.row('scheme', scheme, 't-warn');
      out.warn('An unusual scheme. Whatever app claims it will receive this');
      out.warn('payload directly.');
      return;
    }

    out.ok('Plain text. There is nothing here for a phone to open.');
    out.dim('A text-only QR code is the safe kind: your camera shows the words');
    out.dim('and stops. Everything dangerous about QR codes comes from the');
    out.dim('payload being an instruction rather than a sentence.');
  }

  /* ======================================================================
     PART 9 — the page
     ====================================================================== */

  var MAX_IMAGE = 25 * 1024 * 1024;
  var MAX_SIDE = 1400;   // photographs are downscaled; anything larger is slow
  var current = null;    // last generated grid
  var previewUrl = null;

  function el(id) { return document.getElementById(id); }
  function val(id) { var n = el(id); return n ? n.value : ''; }

  function mode() { return val('tool-mode'); }

  function escapeWifi(s) {
    return String(s).replace(/([\\;,:"])/g, '\\$1');
  }

  function buildPayload() {
    var kind = val('tool-kind');
    if (kind === 'text') return val('f-text');
    if (kind === 'wifi') {
      var ssid = val('f-ssid');
      if (!ssid) return '';
      var sec = val('f-wifisec');
      var s = 'WIFI:T:' + sec + ';S:' + escapeWifi(ssid) + ';';
      if (sec !== 'nopass') s += 'P:' + escapeWifi(val('f-wifipass')) + ';';
      if (el('f-wifihidden').checked) s += 'H:true;';
      return s + ';';
    }
    if (kind === 'vcard') {
      var name = val('f-vname');
      if (!name) return '';
      var parts = name.split(/\s+/);
      var last = parts.length > 1 ? parts.pop() : '';
      var lines = ['BEGIN:VCARD', 'VERSION:3.0',
                   'N:' + last + ';' + parts.join(' ') + ';;;', 'FN:' + name];
      if (val('f-vorg')) lines.push('ORG:' + val('f-vorg'));
      if (val('f-vphone')) lines.push('TEL;TYPE=CELL:' + val('f-vphone'));
      if (val('f-vemail')) lines.push('EMAIL:' + val('f-vemail'));
      if (val('f-vurl')) lines.push('URL:' + val('f-vurl'));
      lines.push('END:VCARD');
      return lines.join('\n');
    }
    if (kind === 'upi') {
      var pa = val('f-upipa');
      if (!pa) return '';
      var q = ['pa=' + encodeURIComponent(pa)];
      if (val('f-upipn')) q.push('pn=' + encodeURIComponent(val('f-upipn')));
      if (val('f-upiam')) { q.push('am=' + encodeURIComponent(val('f-upiam'))); q.push('cu=INR'); }
      if (val('f-upitn')) q.push('tn=' + encodeURIComponent(val('f-upitn')));
      return 'upi://pay?' + q.join('&');
    }
    return '';
  }

  function showFields() {
    var kind = val('tool-kind');
    ['text', 'wifi', 'vcard', 'upi'].forEach(function (k) {
      var node = el('fields-' + k);
      if (node) node.hidden = k !== kind;
    });
  }

  function syncPanels() {
    var m = mode();
    el('tool-genpanel').hidden = m !== 'generate';
    el('tool-inspanel').hidden = m !== 'inspect';
    el('tool-png').hidden = m !== 'generate';
    el('tool-svg').hidden = m !== 'generate';
    el('tool-run').textContent = m === 'generate' ? '▶ Build' : '▶ Read it';
    el('tool-result-label').textContent = m === 'generate'
      ? 'Encoded payload' : 'Decoded payload';
    el('tool-result').placeholder = m === 'generate'
      ? 'The exact string the code contains' : 'The decoded payload, as inert text';
  }

  function prime() {
    if (mode() === 'generate') {
      out.dim('Fill in the fields and press Build. The code is drawn here in the');
      out.dim('tab; nothing is sent anywhere, so a Wi-Fi password or a payment');
      out.dim('address you type stays on this machine.');
    } else {
      out.dim('Drop a photo or a screenshot of a QR code, or paste one with');
      out.dim('Ctrl+V. It will be decoded here and printed as text.');
      out.dim('No decoded link is ever opened, previewed or requested.');
    }
  }

  /* Only the change handler clears. out.clear() is what arms the output pane's
     screen-reader announcer, and doing it at page load would announce three
     lines of help text over the page heading. */
  function onModeChange() {
    syncPanels();
    out.clear();
    prime();
  }

  function generate() {
    out.clear();
    var payload = buildPayload();
    if (!payload) {
      out.warn('Fill in at least the first field for the type you picked.');
      return;
    }
    var bytes = utf8Bytes(payload);
    var ecl = val('tool-ecc');
    var g = encodeQr(bytes, ecl);
    if (g.tooLong) {
      out.err('That is ' + bytes.length + ' bytes. The largest QR code at level ' +
              ecl + ' holds about ' + g.max + '.');
      out.dim('Level L holds the most. Long text in a QR code is a bad idea');
      out.dim('anyway — the modules get small and phone cameras start failing.');
      return;
    }

    current = g;
    var scale = parseInt(val('tool-scale'), 10) || 8;
    var quiet = parseInt(val('tool-quiet'), 10);
    if (isNaN(quiet)) quiet = 4;
    var dim = drawToCanvas(el('tool-canvas'), g, scale, quiet);
    el('tool-canvas').setAttribute('aria-label',
      'QR code, version ' + g.ver + ', ' + g.size + ' by ' + g.size + ' modules');
    el('tool-qrmeta').textContent = 'v' + g.ver + ' · ' + g.size + '×' + g.size +
      ' modules · ' + dim + '×' + dim + ' px';

    out.heading('Encoded');
    out.row('bytes', bytes.length + ' of ' + g.capacityBytes + ' available');
    out.row('version', g.ver + ' (' + g.size + '×' + g.size + ' modules)');
    out.row('correction level', ECL_NAMES[g.ecl] + ' — recovers ' + ECL_RECOVERY[g.ecl]);
    out.row('mask chosen', g.mask + ' of 0-7');
    out.row('quiet zone', quiet + ' modules');
    out.rule();
    out.line(payload);
    out.rule();
    if (quiet < 4) {
      out.warn('A quiet zone under 4 modules is outside the specification. Some');
      out.warn('scanners will still read it; plenty will not, especially when');
      out.warn('the code sits directly against dark artwork.');
    }
    out.dim('The mask is picked by scoring all eight and keeping the least');
    out.dim('penalised, which is what stops a run of data accidentally drawing');
    out.dim('something a scanner mistakes for a finder pattern.');
    out.line('');
    out.dim('Now read it back: switch to Inspect and drop the PNG in. Seeing');
    out.dim('your own code decoded is the quickest way to understand that a QR');
    out.dim('code is a string in a costume, nothing more.');

    el('tool-result').value = payload;
  }

  function loadImage(blob) {
    out.clear();
    out.dim('Reading…');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      // A transparent PNG would otherwise sit on whatever the canvas defaults
      // to, and the luma pass below cannot tell that apart from real ink.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      var preview = el('tool-preview');
      preview.src = previewUrl;
      preview.hidden = false;

      var data;
      try { data = ctx.getImageData(0, 0, w, h); }
      catch (err) {
        out.clear().err('The browser refused to read that image back.');
        return;
      }
      report(data);
    };
    img.onerror = function () {
      out.clear().err('That file could not be decoded as an image.');
    };
    img.src = previewUrl;
  }

  function report(data) {
    out.clear();
    var result;
    try { result = decodeImageData(data); }
    catch (err) {
      out.err('The decoder gave up on that image.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      return;
    }

    if (result.text === undefined) {
      out.err('No QR code could be read from that image.');
      out.line('');
      if (result.fail === 'finders') {
        out.dim('Found ' + result.count + ' of the 3 corner squares. Usually that');
        out.dim('means the code is cropped, too small in the frame, or too');
        out.dim('blurred for the corners to resolve.');
      } else if (result.fail === 'ecc') {
        out.dim('The grid was found and sampled, but block ' + result.block +
                ' had more');
        out.dim('errors than its parity can repair. A sharper or straighter');
        out.dim('photo usually fixes this.');
      } else if (result.fail === 'dimension') {
        out.dim('The corner squares were found but the spacing between them is');
        out.dim('not a valid QR size. That happens with heavy perspective or');
        out.dim('when something else in the picture looks like a finder.');
      } else {
        out.dim('The corners were found but the grid did not resolve.');
      }
      out.line('');
      out.dim('What helps: fill more of the frame, shoot square-on, avoid');
      out.dim('glare, and prefer a screenshot over a photo of a screen.');
      out.dim('This reader handles model 2 QR codes. Micro QR, Data Matrix,');
      out.dim('Aztec and PDF417 all look similar and are not the same format.');
      el('tool-result').value = '';
      return;
    }

    out.heading('Decoded');
    out.row('version', result.version + ' (' + result.dimension + '×' +
            result.dimension + ' modules)');
    out.row('correction level', ECL_NAMES[result.ecl]);
    out.row('mask', String(result.mask));
    out.row('module size', result.moduleSize.toFixed(1) + ' px in the image');
    if (result.corrected) {
      out.row('errors repaired', result.corrected + ' codeword' +
              (result.corrected === 1 ? '' : 's'), 't-warn');
    }
    if (result.inverted) out.row('polarity', 'inverted (light modules on dark)');
    if (result.tilted) out.row('geometry', 'corrected using the alignment pattern');
    if (result.notes && result.notes.length) {
      result.notes.forEach(function (n) { out.warn(n); });
    }

    el('tool-result').value = result.text;
    analyse(result.text);

    out.rule();
    out.dim('Nothing above was opened. If you need the payload elsewhere, use');
    out.dim('the Copy button under the output rather than tapping anything.');
  }

  function downloadPng() {
    if (!current) { out.clear().warn('Build a code first.'); return; }
    var canvas = el('tool-canvas');
    canvas.toBlob(function (blob) {
      if (!blob) { out.err('The browser could not encode that PNG.'); return; }
      blob.arrayBuffer().then(function (buf) {
        LabTool.download(new Uint8Array(buf), 'qr-code.png', 'image/png');
        out.rule();
        out.ok('Saved qr-code.png');
      });
    }, 'image/png');
  }

  function downloadSvg() {
    if (!current) { out.clear().warn('Build a code first.'); return; }
    var scale = parseInt(val('tool-scale'), 10) || 8;
    var quiet = parseInt(val('tool-quiet'), 10);
    if (isNaN(quiet)) quiet = 4;
    var svg = toSvg(current, scale, quiet);
    LabTool.download(utf8Bytes(svg), 'qr-code.svg', 'image/svg+xml');
    out.rule();
    out.ok('Saved qr-code.svg');
    out.dim('SVG is the one to print: it stays sharp at any size, and a QR');
    out.dim('code that has been scaled up from a small bitmap is the usual');
    out.dim('reason a printed code will not scan.');
  }

  LabTool.define({
    id: 'qrtool',
    run: function () {
      if (mode() === 'generate') generate();
      else out.clear().warn('Drop or paste an image of a QR code first.');
    },
    onReady: function () {
      el('tool-mode').addEventListener('change', onModeChange);
      el('tool-kind').addEventListener('change', function () { showFields(); });
      el('tool-png').addEventListener('click', downloadPng);
      el('tool-svg').addEventListener('click', downloadSvg);

      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX_IMAGE, raw: true,
        onFile: function (ignored, file) {
          el('tool-dropname').textContent = file.name;
          loadImage(file);
        },
        onError: function (msg) { out.clear().err(msg); }
      });

      /* Pasting is how most people actually have a QR code to hand — it came
         in a screenshot, a chat message or an email. Only intercepted while
         the inspect half is showing, so a paste into the text field on the
         generate side still behaves normally. */
      document.addEventListener('paste', function (e) {
        if (mode() !== 'inspect') return;
        // Never steal a paste aimed at a text field — the site search overlay
        // and this page's own inputs are both on the document.
        var t = e.target;
        var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf('image/') === 0) {
            var blob = items[i].getAsFile();
            if (blob) {
              e.preventDefault();
              el('tool-dropname').textContent = 'pasted image';
              loadImage(blob);
            }
            return;
          }
        }
      });

      showFields();
      syncPanels();
      prime();
    }
  });
})();

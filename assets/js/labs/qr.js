/* ==========================================================================
   qr.js — a QR encoder, written out rather than pulled in.
   --------------------------------------------------------------------------
   The chat lab's connection code is a couple of hundred characters. Pasting
   that between two phones is miserable; showing it on one screen and pointing
   the other phone's camera at it is not. The length stops mattering the moment
   nobody has to type it.

   Byte mode only, versions 1-20, error-correction level L — which is all this
   needs and keeps the module count (and so the printed size) down. A 243-
   character payload lands around version 10, a 51x51 grid, which is
   comfortable to scan from half a metre away.

   This is a from-scratch implementation of ISO/IEC 18004 rather than a
   dependency: the site has no build step and a script-src 'self' CSP, so a
   CDN is out, and vendoring a library for one lab is more weight than the
   ~250 lines the format actually needs.

   The parts that are easy to get wrong, and what they are:
     - Reed-Solomon over GF(256) with the QR generator polynomial, for the
       error-correction bytes.
     - Data must be interleaved across blocks, not written in order, once a
       version needs more than one block.
     - Eight mask patterns exist; the spec says pick the one with the lowest
       penalty score, and readers genuinely fail on a bad choice.
     - Format information is BCH(15,5)-coded and written twice, in two
       different places, mirrored.
   ========================================================================== */

(function (root) {
  'use strict';

  /* ---- GF(256) arithmetic, the field QR's Reed-Solomon works over ---- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;          // the QR primitive polynomial
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  }());

  function mul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= mul(poly[i], EXP[d]);
        next[i + 1] ^= poly[i];
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, degree) {
    var gen = rsGenerator(degree);
    var rem = new Array(degree).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      for (var j = 0; j < degree; j++) rem[j] ^= mul(gen[j + 1], factor);
    }
    return rem;
  }

  /* ---- capacity tables for error-correction level L, versions 1-20 ----
     [ total codewords, EC codewords per block, number of blocks ] */
  var L = [
    null,
    [26, 7, 1], [44, 10, 1], [70, 15, 1], [100, 20, 1], [134, 26, 1],
    [172, 18, 2], [196, 20, 2], [242, 24, 2], [292, 30, 2], [346, 18, 4],
    [404, 20, 4], [466, 24, 4], [532, 26, 4], [581, 30, 3], [655, 22, 5],
    [733, 24, 5], [815, 28, 5], [901, 30, 5], [991, 28, 5], [1085, 28, 5]
  ];

  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var last = ver * 4 + 10;
    var step = (ver === 32) ? 26 : Math.ceil((last - 6) / (n - 1) / 2) * 2;
    var out = [6];
    for (var i = n - 1; i >= 1; i--) out.push(last - (n - 1 - i) * step);
    return out.sort(function (a, b) { return a - b; });
  }

  function encode(text) {
    var bytes = new TextEncoder().encode(text);

    // smallest version that fits, allowing 4 bits of mode + the length field
    var ver = 0, cap = 0;
    for (var v = 1; v <= 20; v++) {
      var total = L[v][0], ecPer = L[v][1], blocks = L[v][2];
      var dataBytes = total - ecPer * blocks;
      var lenBits = v < 10 ? 8 : 16;
      if (bytes.length * 8 + 4 + lenBits <= dataBytes * 8) { ver = v; cap = dataBytes; break; }
    }
    if (!ver) throw new Error('Too much data for a version-20 QR.');

    /* ---- bit stream: mode nibble, length, payload, terminator, padding ---- */
    var bits = [];
    function put(value, count) {
      for (var i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }
    put(4, 4);                                   // byte mode
    put(bytes.length, ver < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);
    for (i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var words = [];
    for (i = 0; i < bits.length; i += 8) {
      words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    }
    var pad = [0xec, 0x11], p = 0;
    while (words.length < cap) words.push(pad[p++ % 2]);

    /* ---- split into blocks, compute EC, then interleave ---- */
    var ecPerBlock = L[ver][1], numBlocks = L[ver][2];
    var shortLen = Math.floor(cap / numBlocks);
    var longBlocks = cap % numBlocks;
    var dataBlocks = [], ecBlocks = [], off = 0;
    for (var b = 0; b < numBlocks; b++) {
      var len = shortLen + (b >= numBlocks - longBlocks ? 1 : 0);
      var blk = words.slice(off, off + len);
      off += len;
      dataBlocks.push(blk);
      ecBlocks.push(rsRemainder(blk, ecPerBlock));
    }
    var out = [];
    var maxData = Math.max.apply(null, dataBlocks.map(function (d) { return d.length; }));
    for (i = 0; i < maxData; i++) {
      for (b = 0; b < numBlocks; b++) if (i < dataBlocks[b].length) out.push(dataBlocks[b][i]);
    }
    for (i = 0; i < ecPerBlock; i++) {
      for (b = 0; b < numBlocks; b++) out.push(ecBlocks[b][i]);
    }

    /* ---- lay it out ---- */
    var size = ver * 4 + 17;
    var mod = [], used = [];
    for (i = 0; i < size; i++) { mod.push(new Array(size).fill(0)); used.push(new Array(size).fill(0)); }

    function setF(r, c, val) { mod[r][c] = val; used[r][c] = 1; }

    function finder(r, c) {
      var dr, dc;
      for (dr = -1; dr <= 7; dr++) {
        for (dc = -1; dc <= 7; dc++) {
          var rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                   (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                   (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          setF(rr, cc, on ? 1 : 0);
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // timing patterns
    for (i = 8; i < size - 8; i++) {
      setF(6, i, i % 2 === 0 ? 1 : 0);
      setF(i, 6, i % 2 === 0 ? 1 : 0);
    }

    // alignment patterns, skipping the three finder corners
    var ap = alignPositions(ver);
    var dr, dc;
    for (var a = 0; a < ap.length; a++) {
      for (var a2 = 0; a2 < ap.length; a2++) {
        var ar = ap[a], ac = ap[a2];
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
        for (dr = -2; dr <= 2; dr++) {
          for (dc = -2; dc <= 2; dc++) {
            setF(ar + dr, ac + dc,
                 (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0);
          }
        }
      }
    }

    setF(size - 8, 8, 1);                       // the always-dark module

    // reserve the format areas so data does not land there
    for (i = 0; i < 9; i++) { if (!used[8][i]) setF(8, i, 0); if (!used[i][8]) setF(i, 8, 0); }
    for (i = 0; i < 8; i++) { if (!used[8][size - 1 - i]) setF(8, size - 1 - i, 0);
                              if (!used[size - 1 - i][8]) setF(size - 1 - i, 8, 0); }

    // version information, versions 7 and up
    if (ver >= 7) {
      var vd = ver;
      for (i = 0; i < 12; i++) vd = (vd << 1) ^ ((vd >>> 11) * 0x1f25);
      var vbits = (ver << 12) | vd;
      for (i = 0; i < 18; i++) {
        var bit = (vbits >>> i) & 1;
        setF(Math.floor(i / 3), size - 11 + (i % 3), bit);
        setF(size - 11 + (i % 3), Math.floor(i / 3), bit);
      }
    }

    // the data itself, snaking up and down in two-column strips
    var dir = -1, row = size - 1, col = size - 1, bitIdx = 0;
    while (col > 0) {
      if (col === 6) col--;                      // skip the timing column
      for (;;) {
        for (var c2 = 0; c2 < 2; c2++) {
          var cc2 = col - c2;
          if (!used[row][cc2]) {
            var dark = 0;
            if (bitIdx < out.length * 8) {
              dark = (out[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            }
            mod[row][cc2] = dark;
            bitIdx++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
      col -= 2;
    }

    /* ---- masking: try all eight, keep the least penalised ---- */
    function maskAt(m, r, c) {
      switch (m) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return (r * c) % 2 + (r * c) % 3 === 0;
        case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
        default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
      }
    }

    function penalty(g) {
      var score = 0, r, c, run, i2;
      for (r = 0; r < size; r++) {
        run = 1;
        for (c = 1; c < size; c++) {
          if (g[r][c] === g[r][c - 1]) { run++; } else { if (run >= 5) score += run - 2; run = 1; }
        }
        if (run >= 5) score += run - 2;
      }
      for (c = 0; c < size; c++) {
        run = 1;
        for (r = 1; r < size; r++) {
          if (g[r][c] === g[r - 1][c]) { run++; } else { if (run >= 5) score += run - 2; run = 1; }
        }
        if (run >= 5) score += run - 2;
      }
      for (r = 0; r < size - 1; r++) {
        for (c = 0; c < size - 1; c++) {
          var s = g[r][c] + g[r][c + 1] + g[r + 1][c] + g[r + 1][c + 1];
          if (s === 0 || s === 4) score += 3;
        }
      }
      var dark = 0;
      for (r = 0; r < size; r++) for (c = 0; c < size; c++) dark += g[r][c];
      var pct = dark * 100 / (size * size);
      score += Math.floor(Math.abs(pct - 50) / 5) * 10;
      return score;
    }

    var best = null, bestScore = Infinity, bestMask = 0;
    for (var m = 0; m < 8; m++) {
      var g = mod.map(function (r2) { return r2.slice(); });
      for (var r3 = 0; r3 < size; r3++) {
        for (var c3 = 0; c3 < size; c3++) {
          if (!used[r3][c3] && maskAt(m, r3, c3)) g[r3][c3] ^= 1;
        }
      }
      // format info for level L with this mask, BCH(15,5) then XOR 0x5412
      var fmt = (1 << 3) | m;                   // 01 = level L, in the spec's order
      var d2 = fmt << 10;
      for (var k = 0; k < 5; k++) {
        if (d2 & (1 << (14 - k))) d2 ^= 0x537 << (4 - k);
      }
      var fbits = ((fmt << 10) | d2) ^ 0x5412;
      for (i = 0; i < 15; i++) {
        var fb = (fbits >>> i) & 1;
        if (i < 6) g[8][i] = fb;
        else if (i < 8) g[8][i + 1] = fb;
        else if (i === 8) g[7][8] = fb;
        else g[14 - i][8] = fb;

        if (i < 7) g[size - 1 - i][8] = fb;
        else g[8][size - 15 + i] = fb;
      }
      var sc = penalty(g);
      if (sc < bestScore) { bestScore = sc; best = g; bestMask = m; }
    }

    return { size: size, version: ver, mask: bestMask, modules: best };
  }

  /* Draw into a canvas, sized so each module is a whole number of pixels —
     a fractional module size is the most common reason a generated QR will
     not scan. */
  function draw(canvas, text, opts) {
    opts = opts || {};
    var qr = encode(text);
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var target = opts.size || 320;
    var scale = Math.max(1, Math.floor(target / (qr.size + quiet * 2)));
    var px = (qr.size + quiet * 2) * scale;

    canvas.width = px;
    canvas.height = px;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.dark || '#000000';
    for (var r = 0; r < qr.size; r++) {
      for (var c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
        }
      }
    }
    return qr;
  }

  root.LabQR = { encode: encode, draw: draw };
}(typeof window !== 'undefined' ? window : this));

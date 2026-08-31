/* ==========================================================================
   ieee754.js — a float taken apart bit by bit, and the exact decimal value
   those bits actually hold.
   --------------------------------------------------------------------------
   Nearly every explanation of floating point prints 0.30000000000000004 and
   stops there. That number is the wrong thing to stare at: it is the shortest
   decimal that happens to round back to the same double, chosen by the
   printing routine, and it is not the value. The value of 0.1 + 0.2 is
   0.3000000000000000444089209850062616169452667236328125, exactly, with
   nothing left over — because 1/2 is 5/10, so every binary fraction is a
   terminating decimal fraction. Once that number is on the screen the subject
   stops being folklore.

   So the centre of this lab is an exact decimal expansion built on
   big-integer arithmetic over arrays of base-10^7 limbs. A finite double is a
   53-bit integer M times 2^e. When e is positive the value is M shifted left,
   an integer. When e is negative the value is M times 5^|e| with the decimal
   point moved |e| places, because 1/2^k equals 5^k/10^k. That is the entire
   trick, and it is the reason the expansion always terminates.

   Nothing here uses the browser's own number printing to produce a fact. The
   stepped 0.1 + 0.2 walkthrough runs a software adder over bit arrays —
   alignment, guard/round/sticky, round-half-to-even, renormalisation, packing
   — and then compares its own packed result against the bit pattern the
   hardware returned for the same addition. A randomised self-check runs that
   same comparison over several hundred generated pairs when the lab starts,
   and the count it prints is the count it measured. If the two ever disagreed
   the panel would say so rather than quietly showing my version.

   Deliberately missing: float16, float128 and decimal64; division,
   multiplication and square root are not stepped through. Addition is,
   because alignment and cancellation live there and addition is the operation
   people are actually bitten by. The subnormal timing test measures this
   machine, in this tab, in this engine, and nothing else — it is a
   demonstration that the cliff exists on some hardware, not a benchmark of
   your CPU, and a JIT is perfectly capable of confounding it.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  SMALL HELPERS                                                           */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* String.prototype.repeat and padStart are ES6; this file is ES5. */
  function rep(ch, n) {
    var s = '', i;
    for (i = 0; i < n; i++) s += ch;
    return s;
  }
  function padLeft(text, width, ch) {
    var s = String(text);
    return s.length >= width ? s : rep(ch || ' ', width - s.length) + s;
  }
  function num(n) {
    if (typeof LabViz !== 'undefined' && LabViz.humanNumber) return LabViz.humanNumber(n);
    return String(n);
  }

  function button(text, onClick, cls) {
    var el = E('button', 'fp-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }
  function block(title) {
    var box = E('section', 'fp-block');
    if (title) box.appendChild(E('h3', 'fp-block-h', title));
    return box;
  }
  function para(text, cls) { return E('p', 'fp-p' + (cls ? ' ' + cls : ''), text); }
  function note(text, cls) { return E('p', 'fp-note' + (cls ? ' ' + cls : ''), text); }

  /* A label/value pair. The value is monospace and allowed to break anywhere,
     because the exact expansion of a subnormal is over 700 digits long and
     must not be allowed to widen the page. */
  function row(label, value, cls) {
    var r = E('div', 'fp-row' + (cls ? ' ' + cls : ''));
    r.appendChild(E('span', 'fp-row-k', label));
    r.appendChild(E('span', 'fp-row-v', value == null ? '' : String(value)));
    return r;
  }

  /* ======================================================================== */
  /*  BIG INTEGERS                                                            */
  /* ------------------------------------------------------------------------ */
  /*  Little-endian arrays of base-10^7 limbs. Base 10^7 and not something     */
  /*  wider because the only multiply this lab needs is by a small constant,   */
  /*  and limb times multiplier has to stay under 2^53 to be exact: (10^7)^2   */
  /*  is 10^14, comfortably inside, while (10^8)^2 is 10^16 and already past.  */
  /*                                                                          */
  /*  Every division below is written as floor-then-correct rather than a bare */
  /*  Math.floor(a / b). Math.floor of an inexact quotient can land one too    */
  /*  high when the true quotient sits a hair under an integer, and one wrong  */
  /*  limb would corrupt an expansion silently — the single failure mode this  */
  /*  lab could not survive, because the exact digits are the whole product.   */
  /* ======================================================================== */

  var LIMB = 10000000;
  var LIMB_DIGITS = 7;

  function bigTrim(a) {
    while (a.length > 1 && a[a.length - 1] === 0) a.pop();
    return a;
  }
  function bigIsZero(a) { return a.length === 1 && a[0] === 0; }

  function bigFromNumber(n) {
    var out = [], q, r;
    n = Math.floor(n);
    if (!(n > 0)) return [0];
    while (n > 0) {
      q = Math.floor(n / LIMB);
      r = n - q * LIMB;
      if (r < 0) { q -= 1; r += LIMB; } else if (r >= LIMB) { q += 1; r -= LIMB; }
      out.push(r);
      n = q;
    }
    return out;
  }

  function bigCmp(a, b) {
    var i;
    if (a.length !== b.length) return a.length > b.length ? 1 : -1;
    for (i = a.length - 1; i >= 0; i--) {
      if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
  }

  function bigAdd(a, b) {
    var out = [], carry = 0, n = a.length > b.length ? a.length : b.length, i, s;
    for (i = 0; i < n; i++) {
      s = (a[i] || 0) + (b[i] || 0) + carry;
      if (s >= LIMB) { s -= LIMB; carry = 1; } else { carry = 0; }
      out.push(s);
    }
    if (carry) out.push(carry);
    return out;
  }

  /* Requires a >= b; every caller compares first. */
  function bigSub(a, b) {
    var out = [], borrow = 0, i, s;
    for (i = 0; i < a.length; i++) {
      s = a[i] - (b[i] || 0) - borrow;
      if (s < 0) { s += LIMB; borrow = 1; } else { borrow = 0; }
      out.push(s);
    }
    return bigTrim(out);
  }

  function bigMulSmall(a, m) {
    var out = [], carry = 0, i, p, hi, lo;
    if (m === 0) return [0];
    for (i = 0; i < a.length; i++) {
      p = a[i] * m + carry;
      hi = Math.floor(p / LIMB);
      lo = p - hi * LIMB;
      if (lo < 0) { hi -= 1; lo += LIMB; } else if (lo >= LIMB) { hi += 1; lo -= LIMB; }
      out.push(lo);
      carry = hi;
    }
    while (carry > 0) {
      hi = Math.floor(carry / LIMB);
      lo = carry - hi * LIMB;
      if (lo < 0) { hi -= 1; lo += LIMB; } else if (lo >= LIMB) { hi += 1; lo -= LIMB; }
      out.push(lo);
      carry = hi;
    }
    return bigTrim(out);
  }

  /* 5^9 and 2^23 are the largest powers of five and two below the limb base,
     so these are the widest strides one small multiply can take. */
  var POW5_STRIDE = 1953125;
  var POW2_STRIDE = 8388608;

  function bigMulPow5(a, k) {
    while (k >= 9) { a = bigMulSmall(a, POW5_STRIDE); k -= 9; }
    while (k > 0) { a = bigMulSmall(a, 5); k -= 1; }
    return a;
  }
  function bigMulPow2(a, k) {
    while (k >= 23) { a = bigMulSmall(a, POW2_STRIDE); k -= 23; }
    while (k > 0) { a = bigMulSmall(a, 2); k -= 1; }
    return a;
  }
  /* Whole limbs are prepended rather than multiplied — a shift of 10^7 is a
     free operation in this representation and the alignment step in decAdd
     calls this on every term of a 200,000-element sum. */
  function bigMulPow10(a, k) {
    var shift, out, i;
    if (k <= 0 || bigIsZero(a)) return a;
    shift = Math.floor(k / LIMB_DIGITS);
    k -= shift * LIMB_DIGITS;
    while (k > 0) { a = bigMulSmall(a, 10); k -= 1; }
    if (shift > 0) {
      out = [];
      for (i = 0; i < shift; i++) out.push(0);
      for (i = 0; i < a.length; i++) out.push(a[i]);
      a = bigTrim(out);
    }
    return a;
  }

  function bigToString(a) {
    var s = String(a[a.length - 1]), i;
    for (i = a.length - 2; i >= 0; i--) s += padLeft(String(a[i]), LIMB_DIGITS, '0');
    return s;
  }

  /* ======================================================================== */
  /*  EXACT DECIMALS                                                          */
  /* ------------------------------------------------------------------------ */
  /*  { s, d, e } means s * d * 10^-e, with s in -1, 0, 1. Closed under        */
  /*  addition and subtraction, which is all this lab needs: every quantity    */
  /*  it wants exactly — a float's value, a sum of floats, the difference      */
  /*  between two of those — is a sum of terminating decimals.                 */
  /* ======================================================================== */

  var DEC_ZERO = { s: 0, d: [0], e: 0 };

  function dec(sign, digits, scale) { return { s: sign, d: digits, e: scale }; }
  function decIsZero(v) { return v.s === 0 || bigIsZero(v.d); }
  function decNeg(v) { return decIsZero(v) ? DEC_ZERO : dec(-v.s, v.d, v.e); }
  function decAbs(v) { return decIsZero(v) ? DEC_ZERO : dec(1, v.d, v.e); }

  function decAdd(a, b) {
    var scale, da, db, c;
    if (decIsZero(a)) return b;
    if (decIsZero(b)) return a;
    scale = a.e > b.e ? a.e : b.e;
    da = a.e === scale ? a.d : bigMulPow10(a.d, scale - a.e);
    db = b.e === scale ? b.d : bigMulPow10(b.d, scale - b.e);
    if (a.s === b.s) return dec(a.s, bigAdd(da, db), scale);
    c = bigCmp(da, db);
    if (c === 0) return DEC_ZERO;
    if (c > 0) return dec(a.s, bigSub(da, db), scale);
    return dec(b.s, bigSub(db, da), scale);
  }
  function decSub(a, b) { return decAdd(a, decNeg(b)); }

  function decCmp(a, b) {
    var d = decSub(a, b);
    return decIsZero(d) ? 0 : d.s;
  }

  /* The full expansion, trailing zeros trimmed. Nothing is rounded here and
     nothing is abbreviated: the length is the point of the panel. */
  function decToString(v) {
    var s, ip, fp;
    if (decIsZero(v)) return '0';
    s = bigToString(v.d);
    if (v.e === 0) return (v.s < 0 ? '-' : '') + s;
    if (s.length <= v.e) s = rep('0', v.e - s.length + 1) + s;
    ip = s.slice(0, s.length - v.e);
    fp = s.slice(s.length - v.e).replace(/0+$/, '');
    return (v.s < 0 ? '-' : '') + ip + (fp ? '.' + fp : '');
  }

  /* Significant decimal digits: leading zeros do not count, zeros inside the
     number do. */
  function decSigDigits(v) {
    var s = decToString(v).replace(/^-/, '').replace('.', '').replace(/^0+/, '');
    return s.length;
  }

  /* Only ever used to hand a magnitude to the plotter. parseFloat is
     correctly rounded by specification, so this is the nearest double to the
     exact value — and the exact value is what was computed. The rounding
     happens at the last possible step, for pixels. */
  function decToNumber(v) { return parseFloat(decToString(v)); }

  /* ======================================================================== */
  /*  FLOAT DECODE AND ENCODE                                                 */
  /* ------------------------------------------------------------------------ */
  /*  Everything goes through a DataView with an explicit big-endian flag      */
  /*  rather than a Float64Array plus a Uint32Array over the same buffer. The  */
  /*  two-view trick needs an endianness probe, and a wrong guess there would  */
  /*  silently mirror every bit pattern on the page — the sort of bug that     */
  /*  looks plausible for a long time. DataView takes the byte order as an     */
  /*  argument, so there is nothing to guess.                                  */
  /*                                                                          */
  /*  The state of the bit panel is a bit array, never a JS number. That       */
  /*  matters for NaN: a NaN payload can be lost the moment the value is       */
  /*  handled as a number, so the array stays the source of truth and the      */
  /*  number is derived from it only where a number is genuinely wanted.       */
  /* ======================================================================== */

  var DV = new DataView(new ArrayBuffer(8));

  var F64 = { bits: 64, expBits: 11, sigBits: 52, bias: 1023, name: 'float64' };
  var F32 = { bits: 32, expBits: 8, sigBits: 23, bias: 127, name: 'float32' };

  function fmtMaxExp(fmt) { return (1 << fmt.expBits) - 1; }

  /* number -> array of bits, most significant first. */
  function bitsOf(x, fmt) {
    var out = [], i, w, hi, lo;
    if (fmt.bits === 32) {
      DV.setFloat32(0, x, false);
      w = DV.getUint32(0, false);
      for (i = 31; i >= 0; i--) out.push((w >>> i) & 1);
      return out;
    }
    DV.setFloat64(0, x, false);
    hi = DV.getUint32(0, false);
    lo = DV.getUint32(4, false);
    for (i = 31; i >= 0; i--) out.push((hi >>> i) & 1);
    for (i = 31; i >= 0; i--) out.push((lo >>> i) & 1);
    return out;
  }

  function wordsOfBits(bits) {
    var hi = 0, lo = 0, i;
    for (i = 0; i < 32; i++) hi = ((hi << 1) | bits[i]) >>> 0;
    for (i = 32; i < bits.length; i++) lo = ((lo << 1) | bits[i]) >>> 0;
    return { hi: hi, lo: lo };
  }

  /* array of bits -> number. For a NaN pattern the engine is free to hand back
     a different NaN than the one written; that is exactly the canonicalisation
     the NaN panel measures, so nothing here pretends otherwise. */
  function bitsToNumber(bits, fmt) {
    var w;
    if (fmt.bits === 32) {
      w = 0;
      for (var i = 0; i < 32; i++) w = ((w << 1) | bits[i]) >>> 0;
      DV.setUint32(0, w, false);
      return DV.getFloat32(0, false);
    }
    w = wordsOfBits(bits);
    DV.setUint32(0, w.hi, false);
    DV.setUint32(4, w.lo, false);
    return DV.getFloat64(0, false);
  }

  /* Math.fround is ES6 and this file is not, but a round trip through the
     DataView is the same operation and needs nothing beyond what is already
     here: store as float32, read back as a double. */
  function toFloat32(x) {
    DV.setFloat32(0, x, false);
    return DV.getFloat32(0, false);
  }

  function bitsToInt(bits, from, len) {
    var v = 0, i;
    for (i = 0; i < len; i++) v = v * 2 + bits[from + i];
    return v;
  }

  function bitsHex(bits) {
    var s = '', i, nib;
    for (i = 0; i < bits.length; i += 4) {
      nib = bits[i] * 8 + bits[i + 1] * 4 + bits[i + 2] * 2 + bits[i + 3];
      s += '0123456789abcdef'.charAt(nib);
    }
    return '0x' + s;
  }

  function bitsEqual(a, b) {
    var i;
    if (a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* Take the bit pattern apart into the pieces the format defines. The sig field is
     the full significand including the implicit leading bit, so the value is
     always sign * int(sig) * 2^e2 with no special cases left for the caller. */
  function decode(bits, fmt) {
    var E = bitsToInt(bits, 1, fmt.expBits);
    var maxE = fmtMaxExp(fmt);
    var frac = bits.slice(1 + fmt.expBits);
    var sig = [], i, kind;
    if (E === maxE) {
      kind = 'nan';
      for (i = 0; i < frac.length; i++) if (frac[i]) break;
      if (i === frac.length) kind = 'infinity';
    } else if (E === 0) {
      for (i = 0; i < frac.length; i++) if (frac[i]) break;
      kind = i === frac.length ? 'zero' : 'subnormal';
    } else {
      kind = 'normal';
    }
    sig.push(kind === 'normal' ? 1 : 0);
    for (i = 0; i < frac.length; i++) sig.push(frac[i]);
    return {
      fmt: fmt,
      sign: bits[0],
      E: E,
      frac: frac,
      sig: sig,
      /* Exponent of the significand's LAST bit, so value = int(sig) * 2^e2. */
      e2: (E === 0 ? 1 : E) - fmt.bias - fmt.sigBits,
      kind: kind
    };
  }

  /* A significand is at most 53 bits, and 2^53 - 1 is exactly representable as
     a double, so the whole thing can be accumulated in an ordinary number and
     handed to bigFromNumber. The general doubling loop is still here for
     anything longer, but it allocated a big-integer per bit, and the summation
     panel calls this two hundred thousand times in a row. */
  function bigFromBits(bits) {
    var v, i;
    if (bits.length <= 53) {
      v = 0;
      for (i = 0; i < bits.length; i++) v = v * 2 + bits[i];
      return bigFromNumber(v);
    }
    v = [0];
    for (i = 0; i < bits.length; i++) {
      v = bigMulSmall(v, 2);
      if (bits[i]) v = bigAdd(v, [1]);
    }
    return v;
  }

  /* The exact value, as a decimal. M * 2^e2 with e2 negative is
     M * 5^|e2| / 10^|e2| — a shift of the point over an integer this code can
     hold exactly, which is why the expansion terminates and why it is
     sometimes 750 digits long. */
  function exactFromMantissa(sign, M, e2) {
    if (bigIsZero(M)) return DEC_ZERO;
    if (e2 >= 0) return dec(sign ? -1 : 1, bigMulPow2(M, e2), 0);
    return dec(sign ? -1 : 1, bigMulPow5(M, -e2), -e2);
  }

  function exactOfBits(bits, fmt) {
    var d = decode(bits, fmt);
    if (d.kind === 'nan' || d.kind === 'infinity') return null;
    return exactFromMantissa(d.sign, bigFromBits(d.sig), d.e2);
  }

  /* The float64 path avoids building a 64-element bit array and slicing it
     twice, because the summation panel calls this once per term and those
     allocations were most of its running time. Same answer, read straight out
     of the two words. */
  function exactOfNumber(x) {
    DV.setFloat64(0, x, false);
    var hi = DV.getUint32(0, false);
    var lo = DV.getUint32(4, false);
    var E = (hi >>> 20) & 0x7ff;
    var M;
    if (E === 0x7ff) return null;
    M = ((hi & 0xfffff) + (E ? 0x100000 : 0)) * 4294967296 + lo;
    return exactFromMantissa(hi >>> 31, bigFromNumber(M), (E === 0 ? 1 : E) - 1023 - 52);
  }

  function exactOf(x, fmt) {
    if (!fmt || fmt === F64) return exactOfNumber(x);
    return exactOfBits(bitsOf(x, fmt), fmt);
  }

  /* --- neighbours ------------------------------------------------------- */
  /* Stepping to the next representable value is an integer increment of the
     bit pattern, for any positive finite float — including across the
     subnormal/normal boundary, which is the whole elegance of the encoding and
     the reason the boundary has no gap in it. */
  function nextUpBits(bits) {
    var out = bits.slice(0), i;
    for (i = out.length - 1; i >= 0; i--) {
      if (out[i] === 0) { out[i] = 1; return out; }
      out[i] = 0;
    }
    return out;
  }
  function prevDownBits(bits) {
    var out = bits.slice(0), i;
    for (i = out.length - 1; i >= 0; i--) {
      if (out[i] === 1) { out[i] = 0; return out; }
      out[i] = 1;
    }
    return out;
  }

  /* The gap to the next representable value above |x|, exactly. Computed two
     ways and cross-checked: as a difference of two exact expansions, and from
     the exponent alone as a power of two. They must agree. */
  function ulpInfo(bits, fmt) {
    var d = decode(bits, fmt);
    var abs = bits.slice(0);
    abs[0] = 0;
    if (d.kind === 'nan' || d.kind === 'infinity') return null;
    var up = nextUpBits(abs);
    var here = exactOfBits(abs, fmt);
    var there = exactOfBits(up, fmt);
    if (!there) return null;
    var gap = decSub(there, here);
    var power = (d.E === 0 ? 1 : d.E) - fmt.bias - fmt.sigBits;
    var fromPower = exactFromMantissa(0, [1], power);
    return {
      gap: gap,
      power: power,
      agrees: decCmp(gap, fromPower) === 0,
      next: there
    };
  }

  /* --- what the browser prints, and why --------------------------------- */
  /* The shortest decimal that round-trips is found by trying, not asserted.
     toPrecision(p) rounds the value to p significant digits; the first p whose
     result parses back to the identical double is the answer the printing
     routine reaches by a much faster route. */
  function shortestRoundTrip(x) {
    var p, t;
    if (x === 0) return { text: (1 / x === -Infinity) ? '-0' : '0', digits: 1 };
    if (!isFinite(x)) return { text: String(x), digits: 0 };
    for (p = 1; p <= 17; p++) {
      t = x.toPrecision(p);
      if (Number(t) === x) return { text: String(Number(t)), digits: p };
    }
    return { text: String(x), digits: 17 };
  }

  function classLabel(kind) {
    if (kind === 'normal') return 'normal';
    if (kind === 'subnormal') return 'subnormal (denormal)';
    if (kind === 'zero') return 'zero';
    if (kind === 'infinity') return 'infinity';
    return 'NaN';
  }

  /* --- named values, constructed from bits rather than typed in ---------- */
  function writeInt(bits, from, len, value) {
    var i;
    for (i = len - 1; i >= 0; i--) {
      bits[from + i] = value % 2;
      value = Math.floor(value / 2);
    }
  }

  function makeBits(fmt, sign, E, fracBitsOrNull) {
    var bits = [], i;
    for (i = 0; i < fmt.bits; i++) bits.push(0);
    bits[0] = sign ? 1 : 0;
    writeInt(bits, 1, fmt.expBits, E);
    if (fracBitsOrNull) {
      for (i = 0; i < fmt.sigBits; i++) bits[1 + fmt.expBits + i] = fracBitsOrNull[i] || 0;
    }
    return bits;
  }

  /* 2^k as a double, for any k the format can hold, normal or subnormal. */
  function twoToBits(k, fmt) {
    var E = k + fmt.bias;
    var frac, i;
    if (E >= 1 && E <= fmtMaxExp(fmt) - 1) return makeBits(fmt, 0, E, null);
    if (E <= 0) {
      /* Subnormal: the value is frac * 2^(1 - bias - sigBits), so the single
         set bit goes at position (k - (1 - bias - sigBits)) from the bottom. */
      var pos = k - (1 - fmt.bias - fmt.sigBits);
      if (pos < 0 || pos >= fmt.sigBits) return null;
      frac = [];
      for (i = 0; i < fmt.sigBits; i++) frac.push(0);
      frac[fmt.sigBits - 1 - pos] = 1;
      return makeBits(fmt, 0, 0, frac);
    }
    return null;
  }

  /* ======================================================================== */
  /*  A SOFTWARE ADDER, ONE STEP AT A TIME                                    */
  /* ------------------------------------------------------------------------ */
  /*  This is the part that makes 0.1 + 0.2 stop being a party trick. The      */
  /*  addition is carried out here, in JavaScript, over arrays of single bits: */
  /*  align the exponents, add or subtract the significands, renormalise,      */
  /*  round to nearest with ties to even, pack. Every intermediate the panel    */
  /*  shows is one of those arrays, not a re-description of one.               */
  /*                                                                          */
  /*  Three extra bits are carried below the significand — guard, round and    */
  /*  sticky. Guard and round hold real bits; sticky is a running OR of        */
  /*  everything that has already fallen off the bottom. Three is enough for   */
  /*  one addition to round exactly as the hardware does, which is the claim   */
  /*  the self-check at the bottom of this section actually tests rather than  */
  /*  asserts.                                                                 */
  /* ======================================================================== */

  function allZero(arr) {
    var i;
    for (i = 0; i < arr.length; i++) if (arr[i]) return false;
    return true;
  }
  function cmpBitArrays(a, b) {
    var i;
    for (i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
  }
  function bitsString(arr, from, to) {
    var s = '', i;
    for (i = from == null ? 0 : from; i <= (to == null ? arr.length - 1 : to); i++) s += arr[i];
    return s;
  }

  /* Shift right by d places, folding everything that falls past the round bit
     into the sticky slot. The sticky slot is the last entry, so a bit landing
     exactly on it is treated as sticky too — which is the right answer, since
     sticky only ever has to answer "was anything below the round bit set". */
  function shiftRightSticky(arr, d) {
    var n = arr.length, out = [], i, t, lost = 0;
    for (i = 0; i < n; i++) out.push(0);
    for (i = 0; i < n; i++) {
      t = i + d;
      if (t <= n - 2) out[t] = arr[i];
      else if (arr[i]) { out[n - 1] = 1; lost++; }
    }
    return { bits: out, lost: lost };
  }

  function addBitArrays(a, b) {
    var out = [], carry = 0, i, s;
    for (i = a.length - 1; i >= 0; i--) {
      s = a[i] + b[i] + carry;
      out.unshift(s & 1);
      carry = s > 1 ? 1 : 0;
    }
    out.unshift(carry);
    return out;
  }
  function subBitArrays(a, b) {
    var out = [], borrow = 0, i, s;
    for (i = a.length - 1; i >= 0; i--) {
      s = a[i] - b[i] - borrow;
      if (s < 0) { s += 2; borrow = 1; } else { borrow = 0; }
      out.unshift(s);
    }
    return out;
  }
  function incBitArray(arr) {
    var out = arr.slice(0), i;
    for (i = out.length - 1; i >= 0; i--) {
      if (out[i] === 0) { out[i] = 1; return { bits: out, carry: 0 }; }
      out[i] = 0;
    }
    return { bits: out, carry: 1 };
  }

  function softAdd(aBits, bBits, fmt) {
    var SIG = fmt.sigBits + 1;
    var EXT = SIG + 3;
    var MIN_E = 1 - fmt.bias - fmt.sigBits;
    var maxE = fmtMaxExp(fmt);
    var da = decode(aBits, fmt), db = decode(bBits, fmt);
    var st = { fmt: fmt, a: da, b: db, notes: [] };
    var hi, lo, d, extHi, extLoRaw, shifted, sameSign, raw, sign, s, w, i;
    var cmp, sPrime, shiftLeft, g, r, sticky, keep, lsb, roundUp, inc, e, E, frac;

    if (da.kind === 'nan' || db.kind === 'nan') {
      st.special = 'One operand is NaN, so the result is NaN and there is nothing to align. ' +
        'The step-by-step path below only covers finite operands.';
      return st;
    }
    if (da.kind === 'infinity' || db.kind === 'infinity') {
      st.special = 'One operand is an infinity. Infinity plus a finite number is that infinity, ' +
        'and infinity minus infinity is NaN. Neither needs the alignment machinery.';
      return st;
    }
    if (da.kind === 'zero' && db.kind === 'zero') {
      sign = (da.sign && db.sign) ? 1 : 0;
      st.special = 'Both operands are zero. The only interesting part is the sign: under ' +
        'round-to-nearest the answer is negative zero only when both inputs were negative zero.';
      st.bits = makeBits(fmt, sign, 0, null);
      return st;
    }
    if (da.kind === 'zero' || db.kind === 'zero') {
      st.special = 'One operand is zero, so the result is the other operand unchanged. ' +
        'Nothing is rounded and nothing is lost.';
      st.bits = (da.kind === 'zero' ? bBits : aBits).slice(0);
      return st;
    }

    /* Step 1 — order by exponent. The larger exponent stays put and the
       smaller one is the one that gets shifted, because shifting the larger
       one left would need bits the format does not have. */
    if (da.e2 >= db.e2) { hi = da; lo = db; st.swapped = false; }
    else { hi = db; lo = da; st.swapped = true; }
    d = hi.e2 - lo.e2;
    st.hi = hi; st.lo = lo; st.shift = d;

    /* Step 2 — align. Three zero bits are appended to both significands
       first; those are the guard, round and sticky positions. */
    extHi = hi.sig.concat([0, 0, 0]);
    extLoRaw = lo.sig.concat([0, 0, 0]);
    shifted = shiftRightSticky(extLoRaw, d);
    st.extHi = extHi;
    st.extLoRaw = extLoRaw;
    st.extLo = shifted.bits;
    st.lostBits = shifted.lost;
    st.stickySet = shifted.bits[EXT - 1] === 1 && d > 0;

    /* Step 3 — add or subtract the aligned significands. */
    sameSign = hi.sign === lo.sign;
    st.sameSign = sameSign;
    if (sameSign) {
      raw = addBitArrays(extHi, shifted.bits);
      sign = hi.sign;
      st.op = 'add';
    } else {
      cmp = cmpBitArrays(extHi, shifted.bits);
      if (cmp >= 0) { raw = [0].concat(subBitArrays(extHi, shifted.bits)); sign = hi.sign; }
      else { raw = [0].concat(subBitArrays(shifted.bits, extHi)); sign = lo.sign; }
      st.op = 'sub';
    }
    st.raw = raw;
    s = hi.e2 - 3;

    /* Step 4 — renormalise. A carry out of the top means one shift right, and
       the bit that falls off goes into sticky rather than being dropped, which
       is exactly the case that decides a tie later. Leading zeros after a
       subtraction mean shifts left, and those stop at the subnormal floor —
       that floor is gradual underflow, and it is the whole subject of the
       denormals panel. */
    if (raw[0] === 1) {
      w = raw.slice(0, EXT);
      if (raw[EXT]) w[EXT - 1] = 1;
      sPrime = s + 1;
      st.carryOut = true;
    } else {
      w = raw.slice(1);
      sPrime = s;
      st.carryOut = false;
    }
    shiftLeft = 0;
    if (!allZero(w)) {
      while (w[0] === 0 && sPrime > MIN_E - 3) {
        w.shift();
        w.push(0);
        sPrime -= 1;
        shiftLeft += 1;
      }
    }
    st.shiftLeft = shiftLeft;
    st.normalised = w.slice(0);
    e = sPrime + 3;

    /* Step 5 — round to nearest, ties to even. Round up when the guard bit is
       set AND something below it is set; on an exact tie, round up only if
       doing so clears the last bit. That last clause is the "to even" part and
       it is the reason repeated rounding does not drift in one direction. */
    g = w[SIG];
    r = w[SIG + 1];
    sticky = w[SIG + 2];
    keep = w.slice(0, SIG);
    lsb = keep[SIG - 1];
    roundUp = g === 1 && (r === 1 || sticky === 1 || lsb === 1);
    st.guard = g; st.round = r; st.sticky = sticky; st.lsb = lsb;
    st.tie = g === 1 && r === 0 && sticky === 0;
    st.roundUp = roundUp;
    st.beforeRound = keep.slice(0);
    if (roundUp) {
      inc = incBitArray(keep);
      keep = inc.bits;
      if (inc.carry) { keep[0] = 1; e += 1; st.roundCarry = true; }
    }
    st.afterRound = keep.slice(0);
    st.exponentAfter = e;

    /* Step 6 — pack. */
    if (allZero(keep)) {
      E = 0;
      frac = keep.slice(1);
      if (!sameSign) sign = 0;
      st.exactCancellation = true;
    } else if (keep[0] === 1) {
      E = e + fmt.bias + fmt.sigBits;
      if (E >= maxE) {
        st.overflow = true;
        E = maxE;
        frac = [];
        for (i = 0; i < fmt.sigBits; i++) frac.push(0);
      } else {
        frac = keep.slice(1);
      }
    } else {
      E = 0;
      frac = keep.slice(1);
      st.subnormalResult = true;
    }
    st.E = E;
    st.bits = makeBits(fmt, sign, E, frac);
    st.sign = sign;
    return st;
  }

  /* --- the check that this adder is not lying --------------------------- */
  /* Two 32-bit words per draw, from a plain linear congruential generator, so
     the run is identical on every machine and every reload. Math.imul is ES6
     and this file is not, hence the split multiply. */
  function mul32(a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    return ((((ah * b) << 16) >>> 0) + al * b) >>> 0;
  }
  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (mul32(s, 1664525) + 1013904223) >>> 0;
      return s;
    };
  }

  function randomFinite(rnd, forcedE) {
    var frac = [], i, w;
    var sign = rnd() & 1;
    var E = forcedE == null ? rnd() % (fmtMaxExp(F64) - 1) : forcedE;
    for (i = 0; i < 52; i += 32) {
      w = rnd();
      for (var k = 0; k < 32 && i + k < 52; k++) frac.push((w >>> (31 - k)) & 1);
    }
    return makeBits(F64, sign, E, frac);
  }

  /* Four regimes, because they exercise different branches: unconstrained
     pairs, pairs whose exponents are close (cancellation and left shifts),
     pairs pinned into the subnormal floor, and pairs that are far apart (the
     sticky path, where the whole of the smaller operand disappears below the
     round bit). */
  function selfCheck(pairs) {
    var rnd = lcg(20260831);
    var ok = 0, failures = [], i, mode, a, b, res, want, x, y;
    for (i = 0; i < pairs; i++) {
      mode = i % 4;
      if (mode === 0) { a = randomFinite(rnd); b = randomFinite(rnd); }
      else if (mode === 1) {
        var base = 1 + rnd() % 2040;
        a = randomFinite(rnd, base);
        b = randomFinite(rnd, base + (rnd() % 4));
      } else if (mode === 2) {
        a = randomFinite(rnd, rnd() % 3);
        b = randomFinite(rnd, rnd() % 3);
      } else {
        a = randomFinite(rnd, 1500 + rnd() % 400);
        b = randomFinite(rnd, rnd() % 400);
      }
      x = bitsToNumber(a, F64);
      y = bitsToNumber(b, F64);
      res = softAdd(a, b, F64);
      if (!res.bits) continue;
      want = bitsOf(x + y, F64);
      if (bitsEqual(res.bits, want)) ok++;
      else if (failures.length < 3) {
        failures.push({ a: bitsHex(a), b: bitsHex(b), got: bitsHex(res.bits), want: bitsHex(want) });
      }
    }
    return { total: pairs, ok: ok, failures: failures };
  }

  /* ======================================================================== */
  /*  SCOPED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Injected rather than added to labs.css: every selector below is          */
  /*  meaningless outside this lab and only stays in step with the markup by   */
  /*  living next to the code that builds it. The production CSP allows        */
  /*  inline style and forbids inline script, which is why this is a <style>   */
  /*  node and why nothing in this file is built from a string and executed.   */
  /*  Every rule is scoped under #ieee754 so the site stylesheet and the light */
  /*  theme leave the instrument alone.                                        */
  /* ======================================================================== */

  var CSS = [
    '#ieee754 .fp-wrap{font:13px/1.6 ' + FONT + ';color:' + C.ink + ';}',
    '#ieee754 .fp-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,0.6);}',
    '#ieee754 .fp-tab{font:inherit;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#ieee754 .fp-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#ieee754 .fp-tab[aria-selected="true"]{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#ieee754 .fp-tab:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#ieee754 .fp-body{padding:12px;display:flex;flex-direction:column;gap:12px;min-width:0;}',
    '#ieee754 .fp-panel:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:10px;}',

    '#ieee754 .fp-block{padding:12px 13px;border:1px solid ' + C.line + ';border-radius:11px;background:rgba(15,23,42,.55);min-width:0;}',
    '#ieee754 .fp-block-h{margin:0 0 8px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';font-weight:700;}',
    '#ieee754 .fp-p{margin:0 0 8px;font-size:12.5px;line-height:1.75;color:#cbd5e1;}',
    '#ieee754 .fp-p:last-child{margin-bottom:0;}',
    '#ieee754 .fp-p b{color:' + C.ink + ';}',
    '#ieee754 .fp-note{margin:8px 0 0;padding:8px 11px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '#ieee754 .fp-note b{color:' + C.ink + ';}',
    '#ieee754 .fp-warn{border-left-color:' + C.amber + ';background:rgba(251,191,36,.07);}',
    '#ieee754 .fp-bad{border-left-color:' + C.red + ';background:rgba(252,165,165,.07);}',

    '#ieee754 .fp-row{display:flex;flex-wrap:wrap;gap:4px 12px;padding:4px 0;border-bottom:1px solid rgba(28,43,68,.55);}',
    '#ieee754 .fp-row:last-child{border-bottom:0;}',
    '#ieee754 .fp-row-k{flex:0 0 13rem;font-size:11.5px;color:' + C.faint + ';}',
    '#ieee754 .fp-row-v{flex:1 1 14rem;min-width:0;font-size:12px;color:' + C.ink + ';overflow-wrap:anywhere;word-break:break-word;}',
    '#ieee754 .fp-row-hi .fp-row-v{color:' + C.cyan + ';font-weight:700;}',

    '#ieee754 .fp-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;}',
    '#ieee754 .fp-btn:hover{background:#213152;border-color:#40608f;}',
    '#ieee754 .fp-btn:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#ieee754 .fp-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#ieee754 .fp-btn[disabled]{opacity:.45;cursor:default;}',
    '#ieee754 .fp-btnrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}',
    '#ieee754 .fp-btnrow + .fp-btnrow{margin-top:7px;}',
    '#ieee754 .fp-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';margin-right:2px;}',
    '#ieee754 .fp-num{font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:6px 8px;min-width:0;}',
    '#ieee754 .fp-num:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#ieee754 .fp-num-wide{flex:1 1 12rem;}',
    '#ieee754 .fp-range{width:100%;accent-color:' + C.blue + ';cursor:pointer;}',
    '#ieee754 .fp-range:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;}',

    '#ieee754 .fp-bits{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;}',
    '#ieee754 .fp-bitgroup{min-width:0;}',
    '#ieee754 .fp-bitgroup-h{margin:0 0 4px;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:' + C.faint + ';}',
    '#ieee754 .fp-bitcells{display:flex;flex-wrap:wrap;gap:2px;}',
    '#ieee754 .fp-bit{font:inherit;font-size:12px;line-height:1;width:1.35rem;height:1.6rem;display:flex;align-items:center;justify-content:center;border-radius:4px;border:1px solid transparent;padding:0;}',
    '#ieee754 button.fp-bit{cursor:pointer;}',
    '#ieee754 .fp-bit-gap{margin-left:5px;}',
    '#ieee754 .fp-bit-s{background:rgba(252,165,165,.14);color:' + C.red + ';border-color:rgba(252,165,165,.3);}',
    '#ieee754 .fp-bit-e{background:rgba(251,191,36,.13);color:' + C.amber + ';border-color:rgba(251,191,36,.3);}',
    '#ieee754 .fp-bit-m{background:rgba(125,211,252,.11);color:' + C.cyan + ';border-color:rgba(125,211,252,.28);}',
    '#ieee754 button.fp-bit:hover{border-color:' + C.ink + ';}',
    '#ieee754 button.fp-bit:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#ieee754 .fp-bit.is-set{font-weight:700;}',
    '#ieee754 .fp-bit.is-clear{opacity:.55;}',
    '#ieee754 .fp-bit.is-diff{box-shadow:0 0 0 2px ' + C.violet + ';}',

    '#ieee754 .fp-exact{margin:0;padding:11px 12px;border:1px solid rgba(125,211,252,.35);border-radius:10px;background:' + C.bg0 + ';font:inherit;font-size:12.5px;line-height:1.75;color:' + C.cyan + ';overflow-wrap:anywhere;word-break:break-word;}',
    '#ieee754 .fp-exact-lg{font-size:14px;}',
    '#ieee754 .fp-mono{margin:0;padding:9px 11px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg0 + ';font:inherit;font-size:11.5px;line-height:1.7;color:' + C.dim + ';white-space:pre;overflow-x:auto;}',
    '#ieee754 .fp-mono b{color:' + C.ink + ';font-weight:700;}',
    '#ieee754 .fp-scroll{overflow-x:auto;}',

    '#ieee754 .fp-steps{list-style:none;margin:0;padding:0;counter-reset:fpstep;}',
    '#ieee754 .fp-step{position:relative;margin:0 0 10px;padding:10px 12px 10px 40px;border:1px solid ' + C.line + ';border-radius:10px;background:rgba(2,6,23,.45);}',
    '#ieee754 .fp-step:last-child{margin-bottom:0;}',
    '#ieee754 .fp-step-n{position:absolute;left:10px;top:10px;width:21px;height:21px;border-radius:50%;background:' + C.blue + ';color:#04121f;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;}',
    '#ieee754 .fp-step-h{margin:0 0 6px;font-size:12.5px;font-weight:700;color:' + C.ink + ';}',

    '#ieee754 .fp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:10px;}',
    '#ieee754 .fp-card{padding:10px 12px;border:1px solid ' + C.line + ';border-radius:10px;background:rgba(15,23,42,.55);min-width:0;}',
    '#ieee754 .fp-card-h{margin:0 0 5px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';}',
    '#ieee754 .fp-big{margin:0;font-size:19px;font-weight:700;line-height:1.25;color:' + C.cyan + ';overflow-wrap:anywhere;}',
    '#ieee754 .fp-card-good .fp-big{color:' + C.green + ';}',
    '#ieee754 .fp-card-bad .fp-big{color:' + C.red + ';}',
    '#ieee754 .fp-card-note{margin:5px 0 0;font-size:11px;line-height:1.6;color:' + C.dim + ';overflow-wrap:anywhere;}',

    '#ieee754 .fp-table{width:100%;border-collapse:collapse;font-size:11.5px;}',
    '#ieee754 .fp-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#ieee754 .fp-table td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,.6);color:' + C.ink + ';white-space:nowrap;}',

    '#ieee754 .fp-tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;}',
    '#ieee754 .fp-tag-ok{background:rgba(52,211,153,.16);color:' + C.green + ';}',
    '#ieee754 .fp-tag-no{background:rgba(252,165,165,.14);color:' + C.red + ';}',
    '#ieee754 .fp-tag-warn{background:rgba(251,191,36,.14);color:' + C.amber + ';}',

    '#ieee754 .fp-canvas{display:block;width:100%;height:300px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';}',
    '@media (max-width:640px){#ieee754 .fp-canvas{height:230px;}#ieee754 .fp-row-k{flex:0 0 100%;}}',
    '#ieee754 .fp-legend{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 0;font-size:11.5px;color:' + C.dim + ';}',
    '#ieee754 .fp-legend span{display:flex;align-items:center;gap:6px;}',
    '#ieee754 .fp-swatch{width:22px;height:0;border-top-width:3px;border-top-style:solid;display:inline-block;}'
  ].join('');

  /* ======================================================================== */
  /*  THE BIT VIEW                                                            */
  /* ------------------------------------------------------------------------ */
  /*  Sign, exponent and significand are three separate groups with their own  */
  /*  written headings, because colour on its own is not allowed to be the      */
  /*  thing that tells you which field a bit belongs to. Every interactive bit */
  /*  is a real button carrying aria-pressed and a spoken label; the digit is  */
  /*  also printed inside it, so nothing depends on seeing the shade.          */
  /*                                                                          */
  /*  The 64 bits share one tab stop between them. Tabbing through 64 controls */
  /*  to reach the button underneath would be its own small punishment, so the */
  /*  group uses a roving tabindex and the arrow keys walk along the pattern.  */
  /* ======================================================================== */

  function BitView(fmt, interactive, onFlip) {
    var self = this;
    this.fmt = fmt;
    this.interactive = !!interactive;
    this.onFlip = onFlip;
    this.cells = [];
    this.bits = [];
    this.focusIndex = 0;
    this.node = E('div', 'fp-bits');

    var specs = [
      { cls: 'fp-bit-s', from: 0, len: 1, label: 'Sign', kind: 'Sign' },
      { cls: 'fp-bit-e', from: 1, len: fmt.expBits,
        label: 'Exponent (' + fmt.expBits + ' bits, bias ' + fmt.bias + ')', kind: 'Exponent' },
      { cls: 'fp-bit-m', from: 1 + fmt.expBits, len: fmt.sigBits,
        label: 'Fraction (' + fmt.sigBits + ' bits)', kind: 'Fraction' }
    ];

    specs.forEach(function (spec) {
      var g = E('div', 'fp-bitgroup');
      g.appendChild(E('p', 'fp-bitgroup-h', spec.label));
      var cells = E('div', 'fp-bitcells');
      var j;
      for (j = 0; j < spec.len; j++) {
        var index = spec.from + j;
        var cell = E(self.interactive ? 'button' : 'span',
                     'fp-bit ' + spec.cls + (j > 0 && j % 4 === 0 ? ' fp-bit-gap' : ''), '0');
        if (self.interactive) {
          cell.type = 'button';
          cell.tabIndex = index === 0 ? 0 : -1;
          cell.setAttribute('data-index', String(index));
          cell.addEventListener('click', function (ev) {
            var i = parseInt(ev.currentTarget.getAttribute('data-index'), 10);
            self.focusIndex = i;
            self.setTab(i);
            if (self.onFlip) self.onFlip(i);
          });
        }
        cell._kind = spec.kind;
        cell._n = spec.kind === 'Sign' ? 0 : (spec.len - 1 - j);
        self.cells.push(cell);
        cells.appendChild(cell);
      }
      g.appendChild(cells);
      self.node.appendChild(g);
    });

    if (this.interactive) {
      this.node.addEventListener('keydown', function (ev) {
        var k = ev.key, next = -1;
        if (k === 'ArrowRight' || k === 'ArrowDown') next = self.focusIndex + 1;
        else if (k === 'ArrowLeft' || k === 'ArrowUp') next = self.focusIndex - 1;
        else if (k === 'Home') next = 0;
        else if (k === 'End') next = self.cells.length - 1;
        else return;
        if (next < 0) next = 0;
        if (next > self.cells.length - 1) next = self.cells.length - 1;
        ev.preventDefault();
        self.focusIndex = next;
        self.setTab(next);
        self.cells[next].focus();
      });
    }
  }

  BitView.prototype.setTab = function (index) {
    var i;
    for (i = 0; i < this.cells.length; i++) this.cells[i].tabIndex = i === index ? 0 : -1;
  };

  /* diffBits, when given, marks the positions that differ from another
     pattern. Used to show that 0.1 + 0.2 and the literal 0.3 are one bit
     apart, which is the entire story in a single glance. */
  BitView.prototype.paint = function (bits, diffBits) {
    var i, cell, on;
    this.bits = bits.slice(0);
    for (i = 0; i < this.cells.length; i++) {
      cell = this.cells[i];
      on = bits[i] === 1;
      cell.textContent = on ? '1' : '0';
      cell.className = cell.className.replace(/ is-(set|clear|diff)/g, '') +
        (on ? ' is-set' : ' is-clear') +
        (diffBits && diffBits[i] !== bits[i] ? ' is-diff' : '');
      if (this.interactive) {
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
        cell.setAttribute('aria-label',
          cell._kind + (cell._kind === 'Sign' ? '' : ' bit ' + cell._n) +
          ', currently ' + (on ? '1' : '0') + '. Activate to flip it.');
      } else {
        cell.setAttribute('aria-label',
          cell._kind + (cell._kind === 'Sign' ? '' : ' bit ' + cell._n) + ' is ' + (on ? '1' : '0'));
      }
    }
  };

  function staticBitRow(bits, fmt, diffBits) {
    var v = new BitView(fmt, false, null);
    v.paint(bits, diffBits);
    return v.node;
  }

  /* ======================================================================== */
  /*  DECIMAL TEXT IN, EXACT DECIMAL OUT                                      */
  /* ------------------------------------------------------------------------ */
  /*  Needed for one specific comparison: the decimal a person would have      */
  /*  written by hand ("0.1 plus 0.2 is 0.3") against the double the machine   */
  /*  produced. Both sides have to be exact for that to mean anything.         */
  /* ======================================================================== */

  function bigFromDecimalString(s) {
    var v = [0], i;
    for (i = 0; i < s.length; i++) {
      v = bigMulSmall(v, 10);
      v = bigAdd(v, [s.charCodeAt(i) - 48]);
    }
    return bigTrim(v);
  }

  function decParse(text) {
    var m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(String(text));
    var sign, ip, fp, digits, scale, exp;
    if (!m || (!m[2] && !m[3])) return null;
    sign = m[1] === '-' ? -1 : 1;
    ip = m[2] || '';
    fp = m[3] || '';
    exp = m[4] ? parseInt(m[4], 10) : 0;
    scale = fp.length - exp;
    digits = (ip + fp).replace(/^0+/, '');
    if (!digits) return DEC_ZERO;
    var big = bigFromDecimalString(digits);
    if (scale < 0) { big = bigMulPow10(big, -scale); scale = 0; }
    return dec(sign, big, scale);
  }

  /* "2^-53" is allowed because half the interesting operands are powers of two
     and typing 1.1102230246251565e-16 by hand invites a typo that quietly
     changes which case you are looking at. */
  function parseValue(text) {
    var m = /^\s*(-?)2\^(-?\d+)\s*$/.exec(String(text));
    if (m) {
      var k = parseInt(m[2], 10);
      var bits = twoToBits(k, F64);
      if (!bits) return NaN;
      var v = bitsToNumber(bits, F64);
      return m[1] === '-' ? -v : v;
    }
    return Number(text);
  }

  function sigString(arr, sigBits) {
    var SIG = sigBits + 1;
    return arr[0] + '.' + bitsString(arr, 1, SIG - 1) + '  ' + bitsString(arr, SIG, arr.length - 1);
  }

  /* ======================================================================== */
  /*  PANEL 1 — THE BITS                                                      */
  /* ======================================================================== */

  function BitsPanel() {
    this.fmt = F64;
    this.bits = bitsOf(0.1, F64);
    this.view = null;
    this.out = null;
    this.node = null;
  }

  BitsPanel.prototype.presets = function () {
    var fmt = this.fmt;
    var maxE = fmtMaxExp(fmt);
    var ones = [], i;
    for (i = 0; i < fmt.sigBits; i++) ones.push(1);
    var quiet = [];
    for (i = 0; i < fmt.sigBits; i++) quiet.push(i === 0 ? 1 : 0);
    return [
      { name: '0.1', bits: bitsOf(0.1, fmt) },
      { name: '0.2', bits: bitsOf(0.2, fmt) },
      { name: '0.3', bits: bitsOf(0.3, fmt) },
      { name: '1', bits: bitsOf(1, fmt) },
      { name: '-1', bits: bitsOf(-1, fmt) },
      { name: '1/3', bits: bitsOf(1 / 3, fmt) },
      { name: 'pi', bits: bitsOf(Math.PI, fmt) },
      { name: '2^53', bits: twoToBits(53, fmt) || bitsOf(Math.pow(2, 53), fmt) },
      { name: 'smallest normal', bits: twoToBits(1 - fmt.bias, fmt) },
      { name: 'largest subnormal', bits: makeBits(fmt, 0, 0, ones) },
      { name: 'smallest subnormal', bits: twoToBits(1 - fmt.bias - fmt.sigBits, fmt) },
      { name: 'largest finite', bits: makeBits(fmt, 0, maxE - 1, ones) },
      { name: 'zero', bits: makeBits(fmt, 0, 0, null) },
      { name: 'negative zero', bits: makeBits(fmt, 1, 0, null) },
      { name: 'infinity', bits: makeBits(fmt, 0, maxE, null) },
      { name: 'quiet NaN', bits: makeBits(fmt, 0, maxE, quiet) }
    ];
  };

  BitsPanel.prototype.build = function (container) {
    var self = this;
    this.node = container;

    var intro = block('The pattern');
    intro.appendChild(para(
      'Every finite value below is a 53-bit integer multiplied by a power of two — ' +
      'in float32, a 24-bit integer. Click any bit to flip it. Everything under the ' +
      'pattern is recomputed from the bits themselves, including the exact decimal, ' +
      'which is computed digit by digit here and not read out of the browser.'));

    var fmtRow = E('div', 'fp-btnrow');
    fmtRow.appendChild(E('span', 'fp-label', 'Format'));
    this.fmtButtons = [];
    [F64, F32].forEach(function (f) {
      var b = button(f.name, function () { self.setFormat(f); });
      b.setAttribute('aria-pressed', 'false');
      self.fmtButtons.push({ btn: b, fmt: f });
      fmtRow.appendChild(b);
    });
    intro.appendChild(fmtRow);

    var entry = E('div', 'fp-btnrow');
    var label = E('label', 'fp-label', 'Value');
    label.setAttribute('for', 'fp-value-in');
    entry.appendChild(label);
    this.input = E('input', 'fp-num fp-num-wide');
    this.input.type = 'text';
    this.input.id = 'fp-value-in';
    this.input.value = '0.1';
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); self.applyInput(); }
    });
    entry.appendChild(this.input);
    entry.appendChild(button('Set', function () { self.applyInput(); }));
    entry.appendChild(button('Next up', function () {
      self.bits = nextUpBits(self.bits);
      self.update();
    }));
    entry.appendChild(button('Next down', function () {
      self.bits = prevDownBits(self.bits);
      self.update();
    }));
    entry.appendChild(button('Flip sign', function () {
      self.bits[0] = self.bits[0] ? 0 : 1;
      self.update();
    }));
    intro.appendChild(entry);
    intro.appendChild(note(
      'Powers of two can be typed as 2^-1074, which is the smallest positive double ' +
      'and is awkward to type any other way.'));

    this.presetRow = E('div', 'fp-btnrow');
    intro.appendChild(this.presetRow);
    container.appendChild(intro);

    this.bitBlock = block('Sign, exponent, fraction');
    this.viewHolder = E('div');
    this.bitBlock.appendChild(this.viewHolder);
    container.appendChild(this.bitBlock);

    this.out = E('div', 'fp-panel-out');
    container.appendChild(this.out);

    this.rebuildView();
    this.rebuildPresets();
    this.update();
  };

  BitsPanel.prototype.rebuildView = function () {
    var self = this;
    clear(this.viewHolder);
    this.view = new BitView(this.fmt, true, function (i) {
      self.bits[i] = self.bits[i] ? 0 : 1;
      self.update();
    });
    this.viewHolder.appendChild(this.view.node);
  };

  BitsPanel.prototype.rebuildPresets = function () {
    var self = this;
    clear(this.presetRow);
    this.presetRow.appendChild(E('span', 'fp-label', 'Try'));
    this.presets().forEach(function (p) {
      if (!p.bits) return;
      self.presetRow.appendChild(button(p.name, function () {
        self.bits = p.bits.slice(0);
        self.update();
      }));
    });
  };

  BitsPanel.prototype.setFormat = function (fmt) {
    if (fmt === this.fmt) return;
    /* Carry the value across rather than the pattern. Going 64 to 32 rounds,
       and that rounding is itself worth seeing, so it is reported below. */
    var x = bitsToNumber(this.bits, this.fmt);
    this.fmt = fmt;
    this.bits = bitsOf(x, fmt);
    this.rebuildView();
    this.rebuildPresets();
    this.update();
  };

  BitsPanel.prototype.applyInput = function () {
    var x = parseValue(this.input.value);
    if (typeof x !== 'number') return;
    this.bits = bitsOf(x, this.fmt);
    this.update();
  };

  BitsPanel.prototype.update = function () {
    var fmt = this.fmt;
    var bits = this.bits;
    var d = decode(bits, fmt);
    var out = this.out;
    var exact = exactOfBits(bits, fmt);
    var x = bitsToNumber(bits, fmt);
    var i;

    this.view.paint(bits);
    this.fmtButtons.forEach(function (o) {
      var on = o.fmt === fmt;
      o.btn.className = 'fp-btn' + (on ? ' on' : '');
      o.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    clear(out);

    var fields = block('What the fields say');
    fields.appendChild(row('Format', fmt.name + ', ' + fmt.bits + ' bits'));
    fields.appendChild(row('Classification', classLabel(d.kind)));
    fields.appendChild(row('Bit pattern', bitsHex(bits)));
    fields.appendChild(row('Sign bit', d.sign + '  (' + (d.sign ? 'negative' : 'positive') + ')'));
    fields.appendChild(row('Exponent field',
      bitsString(bits, 1, fmt.expBits) + '  =  ' + d.E +
      (d.kind === 'subnormal' || d.kind === 'zero'
        ? '  (all zero: the subnormal encoding, so the exponent is treated as 1)'
        : (d.kind === 'nan' || d.kind === 'infinity'
           ? '  (all ones: reserved for infinity and NaN)'
           : '  unbiased: ' + (d.E - fmt.bias)))));
    fields.appendChild(row('Leading significand bit',
      d.kind === 'normal' ? '1, implicit — it is not stored, it is implied by a nonzero exponent'
        : (d.kind === 'subnormal' ? '0 — this is what makes a subnormal subnormal'
           : 'not applicable for ' + classLabel(d.kind))));
    if (d.kind === 'normal' || d.kind === 'subnormal' || d.kind === 'zero') {
      fields.appendChild(row('Significand as an integer', bigToString(bigFromBits(d.sig))));
      fields.appendChild(row('Value as an exact product',
        (d.sign ? '-' : '') + bigToString(bigFromBits(d.sig)) + ' x 2^' + d.e2));
    }
    out.appendChild(fields);

    if (exact) {
      var ex = block('The exact decimal value these bits hold');
      var p = E('p', 'fp-exact fp-exact-lg', decToString(exact));
      ex.appendChild(p);
      ex.appendChild(row('Significant digits', num(decSigDigits(exact))));
      var srt = shortestRoundTrip(x);
      ex.appendChild(row('What the browser prints', srt.text));
      ex.appendChild(row('Shortest round trip found at',
        srt.digits ? srt.digits + ' significant digit' + (srt.digits === 1 ? '' : 's') : 'not applicable'));
      ex.appendChild(note(
        'The printed form and the exact value are different things. The printed form is ' +
        'the shortest decimal that no other ' + fmt.name + ' is closer to; the exact value ' +
        'is what the bits mean. Every finite binary fraction terminates in decimal, because ' +
        'one half is five tenths, so this expansion is complete and not truncated.'));
      out.appendChild(ex);

      var u = ulpInfo(bits, fmt);
      if (u) {
        var sp = block('Spacing here');
        sp.appendChild(row('Gap to the next value up', decToString(u.gap), 'fp-row-hi'));
        sp.appendChild(row('Which is', '2^' + u.power));
        sp.appendChild(row('Next representable value', decToString(u.next)));
        sp.appendChild(row('Cross-check', u.agrees
          ? 'the difference of the two exact expansions equals 2^' + u.power + ', as it should'
          : 'MISMATCH — please report this, it is a bug in this page'));
        out.appendChild(sp);
      }

      if (fmt === F64) {
        var f = toFloat32(x);
        var f32exact = exactOf(f, F32);
        var lost = f32exact ? decSub(exact, f32exact) : null;
        var conv = block('The same number as a float32');
        conv.appendChild(row('Rounded to float32', shortestRoundTrip(f).text));
        conv.appendChild(row('float32 bits', bitsHex(bitsOf(f, F32))));
        if (f32exact) {
          conv.appendChild(row('Exact float32 value', decToString(f32exact)));
          /* Signed, and labelled as a signed difference. An earlier version
             called this "thrown away" and then printed a negative number,
             because rounding to 24 bits moves the value in whichever
             direction is nearer and here that was up. */
          conv.appendChild(row('float64 value minus float32 value',
            decIsZero(lost) ? 'zero — this value survives in 24 bits' : decToString(lost)));
        }
        out.appendChild(conv);
      }
    } else if (d.kind === 'infinity') {
      var inf = block('Infinity');
      inf.appendChild(para(
        'The exponent field is all ones and the fraction is all zeros. There is no decimal ' +
        'expansion because there is no number here — this is the value arithmetic reaches when ' +
        'a result is too large to represent, and it compares greater than every finite double.'));
      out.appendChild(inf);
    } else {
      var nan = block('NaN');
      nan.appendChild(para(
        'The exponent field is all ones and the fraction is not all zeros. The top fraction bit ' +
        'is the quiet bit: ' + (d.frac[0] ? 'it is set, so this is a quiet NaN.'
          : 'it is clear and the rest is nonzero, so this is a signalling NaN.') +
        ' The remaining ' + (fmt.sigBits - 1) + ' bits are payload and no arithmetic here ' +
        'looks at them. The NaN panel takes that apart.'));
      nan.appendChild(row('Payload bits', bitsString(d.frac, 1, d.frac.length - 1)));
      out.appendChild(nan);
    }
  };

  /* ======================================================================== */
  /*  PANEL 2 — 0.1 + 0.2, EVERY STEP                                         */
  /* ======================================================================== */

  function unbiasedExp(d) { return (d.E === 0 ? 1 : d.E) - d.fmt.bias; }

  /* How many representable values separate two patterns, when that number is
     small. Walked rather than subtracted, because the ordinal of a double is a
     63-bit integer and a double cannot hold one of those exactly — and quietly
     losing precision inside a lab about quietly losing precision would be
     unforgivable. Returns null when they are further apart than the walk. */
  function ulpsApart(a, b, limit) {
    var w = a.slice(0), i;
    if (bitsEqual(a, b)) return 0;
    for (i = 1; i <= limit; i++) {
      w = nextUpBits(w);
      if (bitsEqual(w, b)) return i;
    }
    w = b.slice(0);
    for (i = 1; i <= limit; i++) {
      w = nextUpBits(w);
      if (bitsEqual(w, a)) return -i;
    }
    return null;
  }

  function AddPanel(check) {
    this.check = check;
    this.aText = '0.1';
    this.bText = '0.2';
  }

  AddPanel.prototype.pairs = function () {
    return [
      { label: '0.1 + 0.2', a: '0.1', b: '0.2' },
      { label: '0.1 + 0.7', a: '0.1', b: '0.7' },
      { label: '1 + 2^-53', a: '1', b: '2^-53' },
      { label: '1 + 2^-52', a: '1', b: '2^-52' },
      { label: '2^53 + 1', a: '2^53', b: '1' },
      { label: '2^53 + 3', a: '2^53', b: '3' },
      { label: '1 - 0.9', a: '1', b: '-0.9' },
      { label: '1e17 + 1', a: '1e17', b: '1' },
      { label: 'smallest normal - smallest subnormal', a: '2^-1022', b: '-2^-1074' }
    ];
  };

  AddPanel.prototype.build = function (container) {
    var self = this;
    this.node = container;

    var head = block('Two numbers, added by hand');
    head.appendChild(para(
      'The addition below is carried out in this page, on arrays of single bits, and only ' +
      'then compared against what the processor returned for the same sum. Both operands are ' +
      'rounded to the nearest double first, which is already the first place error enters.'));

    var rowA = E('div', 'fp-btnrow');
    var la = E('label', 'fp-label', 'a'); la.setAttribute('for', 'fp-add-a');
    rowA.appendChild(la);
    this.inA = E('input', 'fp-num');
    this.inA.type = 'text'; this.inA.id = 'fp-add-a'; this.inA.value = this.aText;
    this.inA.spellcheck = false;
    rowA.appendChild(this.inA);
    var lb = E('label', 'fp-label', 'b'); lb.setAttribute('for', 'fp-add-b');
    rowA.appendChild(lb);
    this.inB = E('input', 'fp-num');
    this.inB.type = 'text'; this.inB.id = 'fp-add-b'; this.inB.value = this.bText;
    this.inB.spellcheck = false;
    rowA.appendChild(this.inB);
    rowA.appendChild(button('Step through it', function () {
      self.aText = self.inA.value;
      self.bText = self.inB.value;
      self.update();
    }, 'on'));
    head.appendChild(rowA);

    function onEnter(ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        self.aText = self.inA.value;
        self.bText = self.inB.value;
        self.update();
      }
    }
    this.inA.addEventListener('keydown', onEnter);
    this.inB.addEventListener('keydown', onEnter);

    var presets = E('div', 'fp-btnrow');
    presets.appendChild(E('span', 'fp-label', 'Pairs'));
    this.pairs().forEach(function (p) {
      presets.appendChild(button(p.label, function () {
        self.aText = p.a; self.bText = p.b;
        self.inA.value = p.a; self.inB.value = p.b;
        self.update();
      }));
    });
    head.appendChild(presets);
    container.appendChild(head);

    this.out = E('div');
    container.appendChild(this.out);
    this.update();
  };

  function stepItem(n, title) {
    var li = E('li', 'fp-step');
    li.appendChild(E('span', 'fp-step-n', String(n)));
    li.appendChild(E('h4', 'fp-step-h', title));
    return li;
  }
  function mono(text) { return E('pre', 'fp-mono', text); }

  AddPanel.prototype.update = function () {
    var out = this.out;
    var fmt = F64;
    var a = parseValue(this.aText);
    var b = parseValue(this.bText);
    clear(out);

    if (typeof a !== 'number' || typeof b !== 'number' ||
        (isNaN(a) && !/nan/i.test(this.aText)) || (isNaN(b) && !/nan/i.test(this.bText))) {
      var bad = block('That did not parse');
      bad.appendChild(para('Enter a decimal number, or a power of two written as 2^-53.'));
      out.appendChild(bad);
      return;
    }

    var aBits = bitsOf(a, fmt);
    var bBits = bitsOf(b, fmt);
    var st = softAdd(aBits, bBits, fmt);
    var exA = exactOfBits(aBits, fmt);
    var exB = exactOfBits(bBits, fmt);
    var da = decode(aBits, fmt), db = decode(bBits, fmt);
    var SIG = fmt.sigBits + 1;

    var list = E('ol', 'fp-steps');
    var n = 0, li;

    /* --- step 1 ---------------------------------------------------------- */
    n++;
    li = stepItem(n, 'The two operands, as the machine stores them');
    li.appendChild(row('a, as you wrote it', this.aText));
    li.appendChild(staticBitRow(aBits, fmt));
    if (exA) li.appendChild(E('p', 'fp-exact', decToString(exA)));
    li.appendChild(row('b, as you wrote it', this.bText));
    li.appendChild(staticBitRow(bBits, fmt));
    if (exB) li.appendChild(E('p', 'fp-exact', decToString(exB)));
    if (exA && exB) {
      li.appendChild(note(
        'Neither operand is the decimal you typed. Each is the nearest double to it, and that ' +
        'substitution has already happened before any addition takes place.'));
    }
    list.appendChild(li);

    if (st.special) {
      var sp = stepItem(n + 1, 'A special case, so the walkthrough stops here');
      sp.appendChild(para(st.special));
      if (st.bits) {
        sp.appendChild(staticBitRow(st.bits, fmt));
        sp.appendChild(row('Result', shortestRoundTrip(bitsToNumber(st.bits, fmt)).text));
      }
      list.appendChild(sp);
      out.appendChild(list);
      this.appendSelfCheck(out);
      return;
    }

    /* --- step 2 ---------------------------------------------------------- */
    n++;
    li = stepItem(n, 'Line the binary points up');
    li.appendChild(para(
      'The larger exponent is ' + unbiasedExp(st.hi) + ' and the smaller is ' +
      unbiasedExp(st.lo) + ', so the smaller significand is shifted right by ' +
      st.shift + ' place' + (st.shift === 1 ? '' : 's') +
      '. Three extra positions ride below the significand: guard, round and sticky. ' +
      'Anything shifted past them is folded into the sticky bit, which only has to remember ' +
      'whether something down there was nonzero.'));
    li.appendChild(mono(
      'larger    ' + sigString(st.extHi, fmt.sigBits) + '\n' +
      'smaller   ' + sigString(st.extLoRaw, fmt.sigBits) + '   before the shift\n' +
      'shifted   ' + sigString(st.extLo, fmt.sigBits) + '   after >> ' + st.shift));
    li.appendChild(row('Bits pushed past the round bit', num(st.lostBits)));
    li.appendChild(row('Sticky bit', st.extLo[SIG + 2] +
      (st.extLo[SIG + 2] ? ' — something nonzero was lost down there' : ' — nothing was lost')));
    list.appendChild(li);

    /* --- step 3 ---------------------------------------------------------- */
    n++;
    li = stepItem(n, st.op === 'add' ? 'Add the significands' : 'Subtract the significands');
    li.appendChild(para(st.sameSign
      ? 'The signs agree, so the significands are added as plain binary integers.'
      : 'The signs differ, so the smaller magnitude is subtracted from the larger and the ' +
        'result takes the larger one’s sign. This is where cancellation happens: the ' +
        'leading bits can annihilate each other and leave the answer with far fewer ' +
        'significant bits than either input had.'));
    li.appendChild(mono(
      '  ' + bitsString(st.extHi) + '\n' +
      (st.op === 'add' ? '+ ' : '- ') + bitsString(st.extLo) + '\n' +
      '  ' + rep('-', st.extHi.length) + '\n' +
      ' ' + bitsString(st.raw)));
    list.appendChild(li);

    /* --- step 4 ---------------------------------------------------------- */
    n++;
    li = stepItem(n, 'Renormalise');
    if (st.carryOut) {
      li.appendChild(para(
        'The addition carried out of the top, so the whole thing shifts right one place and ' +
        'the exponent goes up by one. The bit that falls off the bottom is folded into sticky ' +
        'rather than dropped, and that is often the bit that decides the rounding.'));
    } else if (st.shiftLeft > 0) {
      li.appendChild(para(
        'The top ' + st.shiftLeft + ' bit' + (st.shiftLeft === 1 ? ' was' : 's were') +
        ' zero, so the significand shifts left by ' + st.shiftLeft + ' and the exponent drops ' +
        'by the same amount. Those shifts pull in zeros from below: the low bits of the answer ' +
        'are now zeros that carry no information, which is exactly what cancellation costs you.'));
    } else {
      li.appendChild(para('The leading bit is already in place, so nothing shifts.'));
    }
    li.appendChild(mono('normalised  ' + sigString(st.normalised, fmt.sigBits)));
    li.appendChild(row('Exponent of the result so far', String(st.exponentAfter + fmt.sigBits)));
    list.appendChild(li);

    /* --- step 5 ---------------------------------------------------------- */
    n++;
    li = stepItem(n, 'Round to nearest, ties to even');
    li.appendChild(mono(
      'guard   ' + st.guard + '\n' +
      'round   ' + st.round + '\n' +
      'sticky  ' + st.sticky + '\n' +
      'last kept bit  ' + st.lsb));
    li.appendChild(para(
      st.guard === 0
        ? 'The guard bit is zero, so the part being discarded is less than half a place. ' +
          'The significand is kept as it is.'
        : (st.tie
           ? 'The guard bit is one and everything below it is zero: this is an exact tie, ' +
             'dead centre between two representable values. The rule breaks the tie toward ' +
             'the value with an even last bit, so it rounds ' +
             (st.roundUp ? 'up' : 'down') + ' here. Ties-to-even is not arbitrary: always ' +
             'rounding up would bias a long run of sums upward, and this does not.'
           : 'The guard bit is one and something below it is set, so the discarded part is ' +
             'more than half a place and the significand is incremented.')));
    li.appendChild(mono(
      'before  ' + bitsString(st.beforeRound) + '\n' +
      'after   ' + bitsString(st.afterRound) +
      (st.roundCarry ? '\ncarried out of the top, so the exponent went up one more' : '')));
    list.appendChild(li);

    /* --- step 6 ---------------------------------------------------------- */
    n++;
    li = stepItem(n, 'Pack it back into 64 bits');
    li.appendChild(staticBitRow(st.bits, fmt));
    li.appendChild(row('Bit pattern', bitsHex(st.bits)));
    li.appendChild(row('Exponent field', String(st.E)));
    if (st.overflow) li.appendChild(note('The exponent ran off the top, so the result is infinity.', 'fp-warn'));
    if (st.subnormalResult) li.appendChild(note('The result is subnormal: the leading significand bit is zero and the exponent field is at its floor.', 'fp-warn'));
    if (st.exactCancellation) li.appendChild(note('The two values cancelled exactly. Round-to-nearest gives positive zero for that, not negative zero.'));
    list.appendChild(li);

    /* --- step 7 ---------------------------------------------------------- */
    var sum = bitsToNumber(st.bits, fmt);
    var exR = exactOfBits(st.bits, fmt);
    n++;
    li = stepItem(n, 'What the result actually is');
    if (exR) {
      li.appendChild(E('p', 'fp-exact fp-exact-lg', decToString(exR)));
      li.appendChild(row('Significant digits', num(decSigDigits(exR))));
    }
    var srt = shortestRoundTrip(sum);
    li.appendChild(row('What the browser prints', srt.text));
    li.appendChild(para(
      'The printed form stops at ' + srt.digits + ' significant digits because that is the ' +
      'shortest decimal no other double is closer to. It is a name for the value, not the value.'));
    list.appendChild(li);

    /* --- step 8 ---------------------------------------------------------- */
    if (exA && exB && exR) {
      var exactSum = decAdd(exA, exB);
      var err = decSub(exR, exactSum);
      var u = ulpInfo(st.bits, fmt);
      n++;
      li = stepItem(n, 'What the rounding cost');
      li.appendChild(row('Exact sum of the two stored values', decToString(exactSum)));
      li.appendChild(row('Exact value of the double returned', decToString(exR)));
      li.appendChild(row('Difference', decIsZero(err) ? 'zero — this addition was exact' : decToString(err), 'fp-row-hi'));
      if (u && !decIsZero(err)) {
        var half = exactFromMantissa(0, [1], u.power - 1);
        var full = exactFromMantissa(0, [1], u.power);
        var mag = decAbs(err);
        var cmpHalf = decCmp(mag, half);
        li.appendChild(row('Spacing at this magnitude', decToString(u.gap) + '  (2^' + u.power + ')'));
        li.appendChild(row('So the error is',
          cmpHalf === 0 ? 'exactly half a spacing — the largest a correctly rounded addition can be'
            : (cmpHalf < 0 ? 'less than half a spacing, as a correctly rounded result must be'
               : 'MORE than half a spacing, which should be impossible — please report this')));
        if (decCmp(mag, full) === 0) li.appendChild(note('The error is exactly one spacing.', 'fp-warn'));
      }
      /* A double addition is defined to return the nearest representable value
         to the exact answer. This checks that claim against the exact answer
         computed above rather than repeating it. */
      var nearest = bitsOf(decToNumber(exactSum), fmt);
      li.appendChild(row('Nearest double to the exact sum', bitsHex(nearest)));
      li.appendChild(row('Result the hardware gave', bitsHex(st.bits)));
      li.appendChild(note(bitsEqual(nearest, st.bits)
        ? 'Those are the same pattern. That is what "correctly rounded" means, and it was just ' +
          'checked here rather than quoted: the exact sum was computed digit by digit, then ' +
          'rounded once.'
        : 'Those differ, which they should not for a single addition. Please report this.',
        bitsEqual(nearest, st.bits) ? '' : 'fp-bad'));
      list.appendChild(li);

      /* --- step 9 -------------------------------------------------------- */
      var textA = shortestRoundTrip(a).text, textB = shortestRoundTrip(b).text;
      var decA = decParse(textA), decB = decParse(textB);
      if (decA && decB) {
        var handSum = decAdd(decA, decB);
        var handBits = bitsOf(decToNumber(handSum), fmt);
        var apart = ulpsApart(handBits, st.bits, 8);
        n++;
        li = stepItem(n, 'The answer you would have written by hand');
        li.appendChild(row('Decimal ' + textA + ' plus decimal ' + textB, decToString(handSum)));
        li.appendChild(row('Nearest double to that', shortestRoundTrip(decToNumber(handSum)).text));
        li.appendChild(staticBitRow(handBits, fmt, st.bits));
        li.appendChild(para(bitsEqual(handBits, st.bits)
          ? 'Same pattern as the computed result: for this pair the two routes agree.'
          : 'Different pattern. The outlined bits are the ones that differ from the result the ' +
            'machine computed' +
            (apart === null ? '.' : ', and the two are ' + Math.abs(apart) +
             ' representable value' + (Math.abs(apart) === 1 ? '' : 's') + ' apart.')));
        if (!bitsEqual(handBits, st.bits)) {
          var exH = exactOfBits(handBits, fmt);
          if (exH) li.appendChild(row('Exact value of the hand answer', decToString(exH)));
          li.appendChild(note(
            'This is the whole of the folklore, in one line. Nobody rounded badly. The decimal ' +
            'you wrote is not representable, each operand was replaced by its nearest double ' +
            'before anything was added, and the sum of two roundings is not the rounding of the sum.'));
        }
        list.appendChild(li);
      }

      /* --- step 10 ------------------------------------------------------- */
      n++;
      li = stepItem(n, 'The neighbours, so you can see there was nowhere else to land');
      var down = prevDownBits(st.bits), up = nextUpBits(st.bits);
      var exDown = exactOfBits(down, fmt), exUp = exactOfBits(up, fmt);
      if (exDown) li.appendChild(row('One value below', decToString(exDown)));
      li.appendChild(row('The result', decToString(exR), 'fp-row-hi'));
      if (exUp) li.appendChild(row('One value above', decToString(exUp)));
      li.appendChild(para(
        'There is nothing between those three. The exact sum sat somewhere in that gap and had ' +
        'to be moved to one end of it, and the printed name of the result is simply the shortest ' +
        'decimal that is closer to the middle one than to either of its neighbours.'));
      list.appendChild(li);
    }

    /* --- final: agreement with the hardware ------------------------------ */
    n++;
    li = stepItem(n, 'Did this page and the processor agree?');
    var hw = bitsOf(a + b, fmt);
    var same = bitsEqual(hw, st.bits);
    li.appendChild(row('This page computed', bitsHex(st.bits)));
    li.appendChild(row('a + b in JavaScript', bitsHex(hw)));
    var tag = E('p', 'fp-p');
    tag.appendChild(E('span', 'fp-tag ' + (same ? 'fp-tag-ok' : 'fp-tag-no'),
      same ? 'identical bit patterns' : 'MISMATCH'));
    li.appendChild(tag);
    li.appendChild(para(same
      ? 'The software adder above reproduced the hardware result bit for bit. That is the only ' +
        'reason any of the intermediate steps are worth believing.'
      : 'They differ, which means the adder on this page has a bug. Please report it — that is a ' +
        'more interesting finding than anything else on the page.'));
    list.appendChild(li);

    out.appendChild(list);
    this.appendSelfCheck(out);
  };

  AddPanel.prototype.appendSelfCheck = function (out) {
    var c = this.check;
    var b = block('The same check, over several hundred generated pairs');
    b.appendChild(para(
      'One agreement proves very little. When this lab starts it runs the same software adder ' +
      'against the hardware over ' + num(c.total) + ' pseudo-random pairs drawn from four ' +
      'regimes: unconstrained, exponents within three of each other, both pinned into the ' +
      'subnormal range, and exponents far enough apart that one operand vanishes below the ' +
      'round bit. The sequence is fixed, so this run is the same on every machine.'));
    b.appendChild(row('Pairs tested', num(c.total)));
    b.appendChild(row('Reproduced the hardware exactly', num(c.ok), 'fp-row-hi'));
    b.appendChild(row('Disagreements', num(c.total - c.ok)));
    if (c.failures.length) {
      b.appendChild(note('Disagreements found. This is a bug on this page, not in your CPU.', 'fp-bad'));
      c.failures.forEach(function (f) {
        b.appendChild(mono('a ' + f.a + '  b ' + f.b + '\n  page ' + f.got + '\n  cpu  ' + f.want));
      });
    } else {
      b.appendChild(note(
        'No disagreements in this run. That is not a proof of correctness — no finite sample is — ' +
        'but it does mean the intermediate values shown above are the ones the hardware is ' +
        'working with, not a plausible-looking reconstruction.'));
    }
    out.appendChild(b);
  };

  /* ======================================================================== */
  /*  PANEL 3 — SUBNORMALS                                                    */
  /* ======================================================================== */

  function nowMs() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function DenormalPanel() { this.bench = null; }

  DenormalPanel.prototype.build = function (container) {
    var self = this;
    var fmt = F64;
    var tinyBits = twoToBits(-1074, fmt);
    var smallNormalBits = twoToBits(-1022, fmt);
    var ones = [], i;
    for (i = 0; i < fmt.sigBits; i++) ones.push(1);
    var largestSubBits = makeBits(fmt, 0, 0, ones);

    var exTiny = exactOfBits(tinyBits, fmt);
    var exNormal = exactOfBits(smallNormalBits, fmt);
    var exLargestSub = exactOfBits(largestSubBits, fmt);

    var intro = block('The gap that would otherwise sit around zero');
    intro.appendChild(para(
      'A normal double is 1.something times a power of two. That leading 1 is not stored, which ' +
      'buys a free bit of precision, but it also means the smallest normal value is 2^-1022 and ' +
      'there is nothing at all between it and zero. Subnormals are the exception: when the ' +
      'exponent field is all zeros, the leading bit is taken to be 0 instead of 1 and the ' +
      'exponent stops descending. Precision is traded away one bit at a time as the value gets ' +
      'smaller, rather than the whole range collapsing to zero at once. That is gradual underflow.'));
    container.appendChild(intro);

    var cards = block('The three values at the bottom of the format');
    var grid = E('div', 'fp-grid');
    function card(h, big, noteText, cls) {
      var c = E('div', 'fp-card' + (cls ? ' ' + cls : ''));
      c.appendChild(E('p', 'fp-card-h', h));
      c.appendChild(E('p', 'fp-big', big));
      if (noteText) c.appendChild(E('p', 'fp-card-note', noteText));
      return c;
    }
    grid.appendChild(card('Smallest normal', shortestRoundTrip(bitsToNumber(smallNormalBits, fmt)).text,
      '2^-1022, exponent field 1, leading significand bit implied 1'));
    grid.appendChild(card('Largest subnormal', shortestRoundTrip(bitsToNumber(largestSubBits, fmt)).text,
      'exponent field 0, every fraction bit set'));
    grid.appendChild(card('Smallest subnormal', shortestRoundTrip(bitsToNumber(tinyBits, fmt)).text,
      '2^-1074, a single set bit at the very bottom of the fraction'));
    grid.appendChild(card('Positive subnormals that exist',
      num(Math.pow(2, fmt.sigBits) - 1),
      'every fraction pattern except all-zero, which is zero itself'));
    cards.appendChild(grid);
    container.appendChild(cards);

    var exact = block('Those values, exactly');
    exact.appendChild(row('Smallest normal, 2^-1022', ''));
    exact.appendChild(E('p', 'fp-exact', decToString(exNormal)));
    exact.appendChild(row('Smallest subnormal, 2^-1074', ''));
    exact.appendChild(E('p', 'fp-exact', decToString(exTiny)));
    exact.appendChild(row('Digits in that second expansion', num(decToString(exTiny).length - 2)));
    exact.appendChild(note(
      'Both are finite decimals, computed here digit by digit rather than printed by the ' +
      'browser, which would have shown you 2.2250738585072014e-308 and 5e-324 and told you ' +
      'nothing about what is actually stored.'));
    container.appendChild(exact);

    var seam = block('The seam between subnormal and normal');
    seam.appendChild(para(
      'The two patterns below are adjacent. The exponent field steps from 0 to 1 and the ' +
      'implied leading bit switches from 0 to 1 at the same moment, and the value steps by ' +
      'exactly one spacing — no jump, no gap. The encoding was designed so this seam is ' +
      'invisible to arithmetic, which is why the bit-increment trick for "next representable ' +
      'value" works straight across it.'));
    seam.appendChild(row('Largest subnormal', ''));
    seam.appendChild(staticBitRow(largestSubBits, fmt, smallNormalBits));
    seam.appendChild(row('Smallest normal', ''));
    seam.appendChild(staticBitRow(smallNormalBits, fmt, largestSubBits));
    var step = decSub(exNormal, exLargestSub);
    seam.appendChild(row('Difference between them', decToString(step)));
    seam.appendChild(row('Which is', decCmp(step, exTiny) === 0
      ? 'exactly 2^-1074, the same spacing as everywhere else down here — checked, not asserted'
      : 'not 2^-1074, which would be a bug on this page'));
    container.appendChild(seam);

    /* The invariant that flush-to-zero breaks. Both operands and the
       subtraction are real; the flush-to-zero column is what the same
       hardware would have produced with gradual underflow switched off, which
       some DSPs and some compiler flags genuinely do. */
    var b1 = bitsToNumber(smallNormalBits, fmt);
    var b2 = bitsToNumber(nextUpBits(smallNormalBits), fmt);
    var diffBits = softAdd(bitsOf(b2, fmt), bitsOf(-b1, fmt), fmt).bits;
    var gu = block('What you lose without it');
    gu.appendChild(para(
      'Take two distinct doubles just above the smallest normal and subtract them. The answer ' +
      'is smaller than any normal value, so with gradual underflow it lands in the subnormal ' +
      'range and survives. Without it — flush-to-zero, which some hardware and some compiler ' +
      'flags really do — the answer would be zero, and the invariant that x equals y exactly ' +
      'when x minus y is zero would quietly stop being true.'));
    gu.appendChild(row('x', shortestRoundTrip(b2).text));
    gu.appendChild(row('y', shortestRoundTrip(b1).text));
    gu.appendChild(row('x === y', String(b2 === b1)));
    gu.appendChild(row('x - y', shortestRoundTrip(b2 - b1).text));
    gu.appendChild(row('x - y, exactly', decToString(exactOfBits(diffBits, fmt))));
    gu.appendChild(row('Class of that answer', classLabel(decode(diffBits, fmt).kind)));
    gu.appendChild(row('With flush-to-zero it would be', '0, and x !== y would still be true'));
    container.appendChild(gu);

    var perf = block('The performance cliff, measured here');
    perf.appendChild(para(
      'Subnormals are not free. On several generations of x86 an operation with a subnormal ' +
      'operand or result left the fast path and was completed in microcode, costing something ' +
      'like a hundred cycles instead of four. That is why audio and DSP code so often sets ' +
      'flush-to-zero and denormals-are-zero, and why a reverb tail could make a plugin ' +
      'suddenly eat a core as it decayed toward silence.'));
    perf.appendChild(para(
      'The button below sums two arrays of identical length with an identical loop. One array ' +
      'holds subnormal values, the other normal ones. Everything about the two runs is the same ' +
      'except the data.'));
    var out = E('div');
    var runRow = E('div', 'fp-btnrow');
    /* ev.currentTarget is null by the time a setTimeout callback runs — the
       event has finished dispatching — so the button is captured here instead.
       The first version of this read ev.currentTarget inside the timeout and
       threw on every click. */
    var runBtn = button('Run the timing test', function () {
      runBtn.disabled = true;
      runBtn.textContent = 'measuring';
      /* Yielded to the browser first, so the button repaint is not part of
         what gets timed and a slow machine does not look frozen. */
      setTimeout(function () {
        self.renderBench(out);
        runBtn.disabled = false;
        runBtn.textContent = 'Run it again';
      }, 30);
    }, 'on');
    runRow.appendChild(runBtn);
    perf.appendChild(runRow);
    perf.appendChild(out);
    perf.appendChild(note(
      'Whatever it says, it is one machine, one browser, one tab, and a JIT that is entitled to ' +
      'vectorise one loop and not the other. Current x86 handles subnormal addition at full ' +
      'speed and still penalises some other operations; Apple silicon mostly does not penalise ' +
      'them at all. Run it two or three times before believing any of it, and treat a ratio ' +
      'near 1 as "not measurable here", not as "the cliff does not exist".', 'fp-warn'));
    container.appendChild(perf);
  };

  DenormalPanel.prototype.renderBench = function (out) {
    var N = 60000, REPS = 60, i, k;
    var tiny = bitsToNumber(twoToBits(-1074, F64), F64);
    var norm = bitsToNumber(twoToBits(-600, F64), F64);
    var sub, nrm;
    clear(out);

    if (typeof Float64Array === 'undefined') {
      out.appendChild(note('This browser has no Float64Array, so the timing test cannot run.', 'fp-warn'));
      return;
    }
    sub = new Float64Array(N);
    nrm = new Float64Array(N);
    for (i = 0; i < N; i++) {
      sub[i] = tiny * (i + 1);
      nrm[i] = norm * (i + 1);
    }

    function pass(arr, reps) {
      var s = 0, a, b;
      for (a = 0; a < reps; a++) {
        s = 0;
        for (b = 0; b < arr.length; b++) s += arr[b] * 1.0000000000000002;
      }
      return s;
    }

    /* Warm up both, so the first timed run is not paying for the JIT to
       compile the loop it is about to measure. The two totals are kept apart
       rather than added together: added, the subnormal one vanishes into the
       normal one and the readout looks like a copy-paste mistake. */
    var warmSub = pass(sub, 3);
    var warmNrm = pass(nrm, 3);
    var results = [];
    for (k = 0; k < 3; k++) {
      var t0 = nowMs();
      var accSub = pass(sub, REPS);
      var t1 = nowMs();
      var accNrm = pass(nrm, REPS);
      var t2 = nowMs();
      results.push({ subMs: t1 - t0, nrmMs: t2 - t1, accSub: accSub, accNrm: accNrm });
    }
    results.sort(function (x, y) { return (x.subMs / Math.max(x.nrmMs, 1e-9)) - (y.subMs / Math.max(y.nrmMs, 1e-9)); });
    var mid = results[1];
    var ratio = mid.subMs / Math.max(mid.nrmMs, 1e-9);

    var grid = E('div', 'fp-grid');
    function c(h, big, n2, cls) {
      var el = E('div', 'fp-card' + (cls ? ' ' + cls : ''));
      el.appendChild(E('p', 'fp-card-h', h));
      el.appendChild(E('p', 'fp-big', big));
      if (n2) el.appendChild(E('p', 'fp-card-note', n2));
      return el;
    }
    grid.appendChild(c('Subnormal data', mid.subMs.toFixed(1) + ' ms',
      num(N * REPS) + ' multiply-add pairs'));
    grid.appendChild(c('Normal data', mid.nrmMs.toFixed(1) + ' ms',
      'the same loop, the same count'));
    grid.appendChild(c('Ratio', ratio.toFixed(2) + 'x',
      ratio > 1.4 ? 'subnormals are slower here' :
        (ratio < 0.75 ? 'subnormals came out faster, which means this measured noise, not arithmetic'
         : 'no measurable difference on this machine'),
      ratio > 1.4 ? 'fp-card-bad' : 'fp-card-good'));
    out.appendChild(grid);
    out.appendChild(row('Median of', '3 timed rounds, ranked by ratio'));
    out.appendChild(row('Subnormal accumulator', String(mid.accSub) + '  (printed so the loop cannot be optimised away)'));
    out.appendChild(row('Normal accumulator', String(mid.accNrm)));
    out.appendChild(row('Warm-up accumulators', String(warmSub) + '  and  ' + String(warmNrm)));
    out.appendChild(row('Accumulator still subnormal', String(mid.accSub !== 0 && decode(bitsOf(mid.accSub, F64), F64).kind === 'subnormal')));
  };

  /* ======================================================================== */
  /*  PANEL 4 — NaN                                                           */
  /* ------------------------------------------------------------------------ */
  /*  This panel needs a Float64Array and a Uint32Array over the same buffer   */
  /*  rather than the DataView the rest of the file uses, because the question */
  /*  it is asking is precisely what happens when a NaN goes through a JS      */
  /*  number and comes back. DataView.setFloat64 is allowed by specification    */
  /*  to write any NaN it likes, which would answer the question by changing   */
  /*  it. So here, and only here, an endianness probe is unavoidable: write a  */
  /*  1.0 and look at which word came out as 0x3ff00000.                       */
  /* ======================================================================== */

  var NBUF = new ArrayBuffer(8);
  var NF64 = new Float64Array(NBUF);
  var NU32 = new Uint32Array(NBUF);
  NF64[0] = 1;
  var HI = NU32[1] === 0x3ff00000 ? 1 : 0;
  var LO = 1 - HI;

  function wordsToBits(hi, lo) {
    var bits = [], i;
    for (i = 31; i >= 0; i--) bits.push((hi >>> i) & 1);
    for (i = 31; i >= 0; i--) bits.push((lo >>> i) & 1);
    return bits;
  }

  function NaNPanel() {
    this.payload = 'deadbeef';
    this.quiet = true;
  }

  /* The payload is split by hand rather than run through one parseInt. A
     13-digit hex payload is a 52-bit integer, and parseInt would hand back a
     double that cannot hold the low bits — losing payload bits inside the
     panel that exists to show payload bits. */
  NaNPanel.prototype.currentWords = function () {
    var clean = String(this.payload).replace(/[^0-9a-fA-F]/g, '');
    if (clean.length > 13) clean = clean.slice(clean.length - 13);
    var loText = clean.length > 8 ? clean.slice(clean.length - 8) : clean;
    var hiText = clean.length > 8 ? clean.slice(0, clean.length - 8) : '';
    var lo = loText ? (parseInt(loText, 16) >>> 0) : 0;
    var hiPayload = hiText ? (parseInt(hiText, 16) & 0x7ffff) : 0;
    var hi = (0x7ff00000 | (this.quiet ? 0x00080000 : 0) | hiPayload) >>> 0;
    /* A signalling NaN with an empty payload is an infinity, not a NaN, so
       one bit has to stay set for the pattern to mean what the toggle says. */
    if (!this.quiet && hiPayload === 0 && lo === 0) lo = 1;
    return { hi: hi, lo: lo, payloadHi: hiPayload, payloadLo: lo };
  };

  function payloadHex(hi, lo) {
    var h = (hi & 0x7ffff) >>> 0;
    return '0x' + (h ? h.toString(16) : '') + padLeft((lo >>> 0).toString(16), h ? 8 : 1, '0');
  }

  NaNPanel.prototype.build = function (container) {
    var self = this;
    var intro = block('Not a number, and not one value either');
    intro.appendChild(para(
      'An exponent field of all ones with a nonzero fraction is a NaN. That leaves 52 fraction ' +
      'bits free, so a float64 has 2 x (2^52 - 1) distinct NaN patterns — over nine thousand ' +
      'million million of them. The top fraction bit is the quiet bit: set means quiet, clear ' +
      'means signalling. A signalling NaN is meant to raise an invalid-operation exception the ' +
      'first time arithmetic touches it; JavaScript has no way to observe that exception, so ' +
      'here the distinction lives entirely in the bit.'));
    intro.appendChild(row('Distinct NaN patterns in float64', num(2 * (Math.pow(2, 52) - 1))));
    container.appendChild(intro);

    var eq = block('Why NaN is not equal to itself');
    var n = 0 / 0;
    eq.appendChild(para(
      'NaN means "the answer to this is not a number". Two such non-answers have no reason to ' +
      'be the same non-answer, so the standard makes every comparison against NaN false, ' +
      'including equality with itself. Everything in this table was evaluated just now.'));
    eq.appendChild(row('n = 0 / 0; n === n', String(n === n)));
    eq.appendChild(row('n !== n', String(n !== n)));
    eq.appendChild(row('n < n, n > n, n <= n', String(n < n) + ', ' + String(n > n) + ', ' + String(n <= n)));
    eq.appendChild(row('Object.is(n, n)', String(Object.is ? Object.is(n, n) : 'Object.is unavailable')));
    eq.appendChild(row('[n].indexOf(n)', String([n].indexOf(n)) + '  (indexOf uses ===, so it never finds it)'));
    eq.appendChild(row('[n].includes(n)', typeof [].includes === 'function'
      ? String([n].includes(n)) + '  (includes uses SameValueZero, so it does)'
      : 'Array.prototype.includes is unavailable in this browser'));
    eq.appendChild(row('isNaN(n), Number.isNaN(n)', String(isNaN(n)) + ', ' +
      String(Number.isNaN ? Number.isNaN(n) : 'unavailable')));
    container.appendChild(eq);

    var srcs = block('Where NaNs come from, and what they look like');
    srcs.appendChild(para(
      'Five different ways of producing a NaN, with the bit pattern each one actually produced ' +
      'in this browser, read back through a typed-array view.'));
    var table = E('table', 'fp-table');
    var thead = E('tr');
    ['expression', 'bit pattern', 'quiet', 'payload'].forEach(function (h) {
      thead.appendChild(E('th', null, h));
    });
    table.appendChild(thead);
    var sources = [
      { label: '0 / 0', v: 0 / 0 },
      { label: 'Infinity - Infinity', v: Infinity - Infinity },
      { label: 'Math.sqrt(-1)', v: Math.sqrt(-1) },
      { label: '0 * Infinity', v: 0 * Infinity },
      { label: 'Number("abc")', v: Number('abc') }
    ];
    var patterns = {};
    sources.forEach(function (s) {
      NF64[0] = s.v;
      var bits = wordsToBits(NU32[HI], NU32[LO]);
      var hex = bitsHex(bits);
      patterns[hex] = (patterns[hex] || 0) + 1;
      var tr = E('tr');
      tr.appendChild(E('td', null, s.label));
      tr.appendChild(E('td', null, hex));
      tr.appendChild(E('td', null, bits[12] ? 'quiet' : 'signalling'));
      tr.appendChild(E('td', null, (NU32[HI] & 0x7ffff) === 0 && NU32[LO] === 0
        ? 'empty' : payloadHex(NU32[HI], NU32[LO])));
      table.appendChild(tr);
    });
    var distinct = 0, key;
    for (key in patterns) if (Object.prototype.hasOwnProperty.call(patterns, key)) distinct++;
    var scroll = E('div', 'fp-scroll');
    scroll.appendChild(table);
    srcs.appendChild(scroll);
    srcs.appendChild(note(distinct === 1
      ? 'All five produced the identical pattern in this engine. That is the canonical NaN, and ' +
        'it is why you cannot learn anything about where a NaN came from by looking at one.'
      : 'They did not all produce the same pattern in this engine: ' + distinct + ' distinct ' +
        'patterns appeared. The standard permits that, which is exactly why nothing should ' +
        'depend on it.'));
    container.appendChild(srcs);

    var lab = block('Give it a payload and watch what survives');
    lab.appendChild(para(
      'The payload is the 51 bits below the quiet bit. Nothing in JavaScript will read one for ' +
      'you, but the bits are there, and a typed-array view can see them. Type a hexadecimal ' +
      'payload and the experiments below are re-run against it.'));
    var ctl = E('div', 'fp-btnrow');
    var lp = E('label', 'fp-label', 'payload (hex)');
    lp.setAttribute('for', 'fp-nan-payload');
    ctl.appendChild(lp);
    this.input = E('input', 'fp-num');
    this.input.type = 'text';
    this.input.id = 'fp-nan-payload';
    this.input.value = this.payload;
    this.input.spellcheck = false;
    this.input.addEventListener('input', function () {
      self.payload = self.input.value;
      self.render();
    });
    ctl.appendChild(this.input);
    this.qBtn = button('quiet', function () { self.quiet = true; self.render(); });
    this.sBtn = button('signalling', function () { self.quiet = false; self.render(); });
    ctl.appendChild(this.qBtn);
    ctl.appendChild(this.sBtn);
    lab.appendChild(ctl);
    this.out = E('div');
    lab.appendChild(this.out);
    container.appendChild(lab);

    this.render();
  };

  NaNPanel.prototype.render = function () {
    var out = this.out;
    var w = this.currentWords();
    var bits = wordsToBits(w.hi, w.lo);
    clear(out);

    this.qBtn.className = 'fp-btn' + (this.quiet ? ' on' : '');
    this.sBtn.className = 'fp-btn' + (this.quiet ? '' : ' on');
    this.qBtn.setAttribute('aria-pressed', this.quiet ? 'true' : 'false');
    this.sBtn.setAttribute('aria-pressed', this.quiet ? 'false' : 'true');

    out.appendChild(row('Constructed pattern', bitsHex(bits)));
    out.appendChild(staticBitRow(bits, F64));
    out.appendChild(row('Quiet bit', bits[12] + (bits[12] ? ' — quiet NaN' : ' — signalling NaN')));
    out.appendChild(row('Payload bits', bitsString(bits, 13, 63)));
    out.appendChild(row('Payload as hex', payloadHex(w.hi, w.lo)));

    /* Every row below writes the raw words, reads the buffer back as a JS
       number, puts that number through one expression, stores it again and
       reads the words. What comes out is measured, not predicted: the
       standard lets an implementation return any NaN it likes from
       arithmetic, so this is a report on this engine today. */
    var kept = 0, tried = 0;
    function trip(label, fn) {
      NU32[HI] = w.hi;
      NU32[LO] = w.lo;
      var v = NF64[0];
      NF64[0] = fn(v);
      var got = wordsToBits(NU32[HI], NU32[LO]);
      var same = bitsEqual(got, bits);
      tried++;
      if (same) kept++;
      var r = row(label, bitsHex(got) + (same ? '  — payload survived' : '  — payload changed'));
      if (!same) r.className += ' fp-row-hi';
      return r;
    }

    var exp = block('Does the payload survive?');
    exp.appendChild(trip('read and written straight back', function (v) { return v; }));
    exp.appendChild(trip('v * 1', function (v) { return v * 1; }));
    exp.appendChild(trip('v + 0', function (v) { return v + 0; }));
    exp.appendChild(trip('v - v', function (v) { return v - v; }));
    exp.appendChild(trip('-v', function (v) { return -v; }));
    exp.appendChild(trip('Math.abs(v)', function (v) { return Math.abs(v); }));
    exp.appendChild(trip('Math.min(v, 1)', function (v) { return Math.min(v, 1); }));
    exp.appendChild(trip('v treated as a DataView float64', function (v) {
      DV.setFloat64(0, v, false);
      return DV.getFloat64(0, false);
    }));
    /* The counts are read off the rows above rather than predicted. On the
       engine I wrote this against most rows kept the payload and Math.min did
       not, but that is a fact about one build of one engine and the copy is
       not allowed to assert it in advance. */
    exp.appendChild(note(
      'On this engine, just now, ' + kept + ' of those ' + tried + ' round trips came back with ' +
      'the payload intact and ' + (tried - kept) + ' came back with a different NaN. ' +
      'The first row is the point that holds everywhere: a typed-array view moves raw bytes, so ' +
      'an arbitrary payload can be carried into a JavaScript number and read back out, and the ' +
      'payload is genuinely observable. Every other row is a report, not a rule. The standard ' +
      'says the NaN an operation returns is implementation-defined and JavaScript adds no ' +
      'promise on top, so a different engine, a different CPU, or the same engine once the ' +
      'optimiser has warmed up may canonicalise where this one did not. Reading meaning out of ' +
      'a payload that came through arithmetic is not something to build on.'));
    out.appendChild(exp);

    var v2 = block('And through Number formatting');
    NU32[HI] = w.hi;
    NU32[LO] = w.lo;
    var x = NF64[0];
    v2.appendChild(row('String(v)', String(x)));
    v2.appendChild(row('v === v', String(x === x)));
    v2.appendChild(row('JSON.stringify(v)', JSON.stringify(x)));
    v2.appendChild(para(
      'Every NaN prints as the same three letters and compares unequal to itself, whatever is ' +
      'in its payload. That is the sense in which JavaScript has one NaN: not that the bits are ' +
      'the same, but that nothing in the language will show you the difference.'));
    out.appendChild(v2);
  };

  /* ======================================================================== */
  /*  A SMALL PLOTTER                                                         */
  /* ------------------------------------------------------------------------ */
  /*  Canvas rather than SVG because the summation panel draws three lines of  */
  /*  a hundred and forty points each and redraws them on every slider move.   */
  /*  Each series carries a dash pattern as well as a colour, and the legend    */
  /*  names the pattern in words, because a chart that only separates its      */
  /*  lines by hue is unreadable to a good number of people and unprintable    */
  /*  for everyone.                                                            */
  /* ======================================================================== */

  function fitCanvas(cv, fallbackW) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || fallbackW || 640;
    var h = cv.clientHeight || 300;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    var ctx = cv.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function drawPlot(cv, spec) {
    var f = fitCanvas(cv);
    if (!f) return;
    var ctx = f.ctx, W = f.w, H = f.h;
    var L = 58, R = 12, T = 14, B = 34;
    var pw = W - L - R, ph = H - T - B;
    var xs = spec.xMin, xe = spec.xMax, ys = spec.yMin, ye = spec.yMax;
    if (xe <= xs) xe = xs + 1;
    if (ye <= ys) ye = ys + 1;

    function px(x) { return L + (x - xs) / (xe - xs) * pw; }
    function py(y) { return T + ph - (y - ys) / (ye - ys) * ph; }

    ctx.font = '10px ' + FONT;
    ctx.lineWidth = 1;

    var i, t, label;
    ctx.strokeStyle = 'rgba(28,43,68,0.9)';
    ctx.fillStyle = C.faint;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (i = 0; i <= spec.yTicks; i++) {
      t = ys + (ye - ys) * i / spec.yTicks;
      ctx.beginPath();
      ctx.moveTo(L, py(t));
      ctx.lineTo(L + pw, py(t));
      ctx.stroke();
      label = spec.yLabel ? spec.yLabel(t) : String(Math.round(t));
      ctx.fillText(label, L - 6, py(t));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (i = 0; i <= spec.xTicks; i++) {
      t = xs + (xe - xs) * i / spec.xTicks;
      ctx.beginPath();
      ctx.moveTo(px(t), T);
      ctx.lineTo(px(t), T + ph);
      ctx.stroke();
      ctx.fillText(spec.xLabel ? spec.xLabel(t) : String(Math.round(t)), px(t), T + ph + 6);
    }

    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(L, T);
    ctx.lineTo(L, T + ph);
    ctx.lineTo(L + pw, T + ph);
    ctx.stroke();

    spec.series.forEach(function (s) {
      var pts = s.points, j, started = false;
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = 2;
      if (ctx.setLineDash) ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      for (j = 0; j < pts.length; j++) {
        if (pts[j][1] == null) { started = false; continue; }
        if (!started) { ctx.moveTo(px(pts[j][0]), py(pts[j][1])); started = true; }
        else ctx.lineTo(px(pts[j][0]), py(pts[j][1]));
      }
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);
    });
    ctx.lineWidth = 1;

    if (spec.xTitle) {
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText(spec.xTitle, L + pw / 2, H - 12);
    }
  }

  function legend(series) {
    var box = E('div', 'fp-legend');
    series.forEach(function (s) {
      var item = E('span');
      var sw = E('span', 'fp-swatch');
      sw.style.borderTopColor = s.colour;
      sw.style.borderTopStyle = (s.dash && s.dash.length) ? 'dashed' : 'solid';
      item.appendChild(sw);
      item.appendChild(document.createTextNode(s.name + ' (' + s.style + ')'));
      box.appendChild(item);
    });
    return box;
  }

  /* ======================================================================== */
  /*  PANEL 5 — ACCUMULATED ERROR, KAHAN AND NEUMAIER                         */
  /* ======================================================================== */

  function marksUpTo(n, count) {
    var out = [], i, v, last = 0;
    for (i = 0; i < count; i++) {
      v = Math.round(Math.pow(n, (i + 1) / count));
      if (v > last) { out.push(v); last = v; }
    }
    if (out.length === 0 || out[out.length - 1] !== n) out.push(n);
    return out;
  }

  function SumPanel() {
    this.n = 50000;
    this.datasetIndex = 0;
  }

  SumPanel.prototype.datasets = function () {
    return [
      {
        name: 'one tenth, N times',
        blurb: 'The friendliest possible case, and it still drifts: 0.1 is not 0.1, so every ' +
               'term contributes the same small excess and the excess adds up.',
        gen: function () { return function () { return 0.1; }; }
      },
      {
        name: '1/k for k = 1 to N',
        blurb: 'The harmonic series. Terms shrink while the running total grows, so each new ' +
               'term is added at a magnitude where the spacing is coarser than the term itself.',
        gen: function () {
          var k = 0;
          return function () { k++; return 1 / k; };
        }
      },
      {
        name: 'pseudo-random in [0, 1)',
        blurb: 'A fixed linear congruential sequence, so the run is identical on every machine ' +
               'and the shape of the curve is not an accident of your browser.',
        gen: function () {
          var rnd = lcg(987654321);
          return function () { return rnd() / 4294967296; };
        }
      },
      {
        name: 'one value of 1e17, then N ones',
        blurb: 'The absorption case. The spacing at 1e17 is 16, so adding 1 to the running total ' +
               'changes nothing at all and the naive sum simply stops moving.',
        gen: function () {
          var first = true;
          return function () {
            if (first) { first = false; return 1e17; }
            return 1;
          };
        }
      }
    ];
  };

  SumPanel.prototype.build = function (container) {
    var self = this;
    this.node = container;

    var head = block('Adding a lot of numbers, three ways');
    head.appendChild(para(
      'Floating point addition is not associative, so a sum of N values has no single answer — ' +
      'it has an answer per order and per algorithm. Below, the same sequence is added naively, ' +
      'with Kahan compensated summation, and with Neumaier’s correction to Kahan. The true ' +
      'total is computed alongside them in exact decimal arithmetic, term by term, so the ' +
      'errors plotted are differences from the real answer and not from a longer float.'));

    var ctl = E('div', 'fp-btnrow');
    ctl.appendChild(E('span', 'fp-label', 'Sequence'));
    this.dsButtons = [];
    this.datasets().forEach(function (d, i) {
      var b = button(d.name, function () { self.datasetIndex = i; self.update(); });
      self.dsButtons.push(b);
      ctl.appendChild(b);
    });
    head.appendChild(ctl);

    var nrow = E('div', 'fp-btnrow');
    var nl = E('label', 'fp-label', 'How many terms');
    nl.setAttribute('for', 'fp-sum-n');
    nrow.appendChild(nl);
    this.range = E('input', 'fp-range');
    this.range.type = 'range';
    this.range.id = 'fp-sum-n';
    this.range.min = '1000';
    this.range.max = '200000';
    this.range.step = '1000';
    this.range.value = String(this.n);
    this.range.addEventListener('change', function () {
      self.n = parseInt(self.range.value, 10);
      self.update();
    });
    nrow.appendChild(this.range);
    this.nOut = E('span', 'fp-row-v', '');
    nrow.appendChild(this.nOut);
    head.appendChild(nrow);
    head.appendChild(note(
      'The exact total is real big-integer decimal arithmetic over every one of those terms, so ' +
      'the top of the range takes a moment. That cost is the point: nothing here is a formula ' +
      'for the error, it is the error.'));
    container.appendChild(head);

    this.blurb = block('This sequence');
    container.appendChild(this.blurb);

    this.plotBlock = block('How far each method has drifted, against the true total');
    this.canvas = E('canvas', 'fp-canvas');
    this.canvas.setAttribute('role', 'img');
    this.plotBlock.appendChild(this.canvas);
    this.legendHolder = E('div');
    this.plotBlock.appendChild(this.legendHolder);
    this.plotNote = E('div');
    this.plotBlock.appendChild(this.plotNote);
    container.appendChild(this.plotBlock);

    this.results = E('div');
    container.appendChild(this.results);

    this.kahanFail = block('The case plain Kahan gets wrong');
    container.appendChild(this.kahanFail);
    this.renderKahanFail();

    this.update();
  };

  SumPanel.prototype.compute = function () {
    var n = this.n;
    var next = this.datasets()[this.datasetIndex].gen();
    var marks = marksUpTo(n, 140);
    var mi = 0;
    var naive = 0, ksum = 0, kc = 0, nsum = 0, nc = 0;
    var exact = DEC_ZERO;
    var samples = [];
    var i, x, y, t;
    /* Two of the four sequences repeat the same value forever, and converting
       it to an exact decimal every time was the slowest thing on the page. */
    var lastX = NaN, lastDec = DEC_ZERO;

    for (i = 1; i <= n; i++) {
      x = next();

      naive = naive + x;

      /* Kahan: y carries the correction from the previous step, t is the
         provisional total, and c recovers the part of y that did not fit. */
      y = x - kc;
      t = ksum + y;
      kc = (t - ksum) - y;
      ksum = t;

      /* Neumaier: the same idea, but the lost part is taken from whichever
         operand was larger. Kahan assumes the running total dominates the
         term; when the term dominates instead, Kahan recovers the wrong end. */
      t = nsum + x;
      if (Math.abs(nsum) >= Math.abs(x)) nc = nc + ((nsum - t) + x);
      else nc = nc + ((x - t) + nsum);
      nsum = t;

      if (x !== lastX) { lastX = x; lastDec = exactOf(x, F64); }
      exact = decAdd(exact, lastDec);

      if (mi < marks.length && i === marks[mi]) {
        mi++;
        samples.push({
          n: i,
          naive: decToNumber(decAbs(decSub(exactOf(naive, F64), exact))),
          kahan: decToNumber(decAbs(decSub(exactOf(ksum, F64), exact))),
          neumaier: decToNumber(decAbs(decSub(exactOf(nsum + nc, F64), exact)))
        });
      }
    }

    return {
      n: n,
      exact: exact,
      naive: naive,
      kahan: ksum,
      neumaier: nsum + nc,
      compensation: nc,
      samples: samples
    };
  };

  SumPanel.prototype.update = function () {
    var self = this;
    var ds = this.datasets()[this.datasetIndex];
    var i;

    for (i = 0; i < this.dsButtons.length; i++) {
      this.dsButtons[i].className = 'fp-btn' + (i === this.datasetIndex ? ' on' : '');
      this.dsButtons[i].setAttribute('aria-pressed', i === this.datasetIndex ? 'true' : 'false');
    }
    this.nOut.textContent = num(this.n) + ' terms';
    clear(this.blurb);
    this.blurb.appendChild(E('h3', 'fp-block-h', 'This sequence'));
    this.blurb.appendChild(para(ds.blurb));

    var r = this.compute();
    var best = decToNumber(r.exact);
    var series = [
      { name: 'naive left-to-right', style: 'solid, amber', colour: C.amber, dash: [],
        points: r.samples.map(function (s) { return [Math.log(s.n) / Math.LN10, s.naive]; }) },
      { name: 'Kahan compensated', style: 'dashed, cyan', colour: C.cyan, dash: [6, 4],
        points: r.samples.map(function (s) { return [Math.log(s.n) / Math.LN10, s.kahan]; }) },
      { name: 'Neumaier', style: 'dotted, green', colour: C.green, dash: [2, 3],
        points: r.samples.map(function (s) { return [Math.log(s.n) / Math.LN10, s.neumaier]; }) }
    ];

    /* Errors span many orders of magnitude, so the axis is log10 of the
       absolute error. An error of exactly zero has no logarithm and is not
       plotted; the count of those is stated underneath in words instead,
       because dropping them silently would flatter the compensated methods. */
    var lo = Infinity, hi = -Infinity, zeros = { naive: 0, kahan: 0, neumaier: 0 };
    series.forEach(function (s, k) {
      var key = k === 0 ? 'naive' : (k === 1 ? 'kahan' : 'neumaier');
      s.points = s.points.map(function (p) {
        if (!(p[1] > 0)) { zeros[key]++; return [p[0], null]; }
        var v = Math.log(p[1]) / Math.LN10;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        return [p[0], v];
      });
    });
    if (!isFinite(lo)) { lo = -20; hi = -10; }
    if (hi - lo < 2) { hi = lo + 2; }
    lo = Math.floor(lo) - 0.4;
    hi = Math.ceil(hi) + 0.4;

    /* Kept so a tab switch or a window resize can repaint the chart without
       re-running a quarter of a million exact-decimal additions to get the
       same picture back. */
    this.lastPlot = {
      xMin: 0, xMax: Math.log(r.n) / Math.LN10,
      yMin: lo, yMax: hi,
      xTicks: 5, yTicks: 5,
      xLabel: function (t) { return num(Math.round(Math.pow(10, t))); },
      yLabel: function (t) { return '1e' + Math.round(t); },
      xTitle: 'terms added (logarithmic)',
      series: series
    };
    drawPlot(this.canvas, this.lastPlot);
    this.canvas.setAttribute('aria-label',
      'Absolute error against the exact total, on logarithmic axes, for naive, Kahan and ' +
      'Neumaier summation over ' + num(r.n) + ' terms. The figures below the chart repeat every ' +
      'value it plots at the final term.');
    clear(this.legendHolder);
    this.legendHolder.appendChild(legend(series));
    clear(this.plotNote);
    this.plotNote.appendChild(note(
      'Samples where the error was exactly zero cannot be drawn on a logarithmic axis and are ' +
      'left as gaps: naive ' + zeros.naive + ', Kahan ' + zeros.kahan + ', Neumaier ' +
      zeros.neumaier + ' of ' + r.samples.length + ' sample points.'));

    /* --- the numbers under the chart -------------------------------------- */
    clear(this.results);
    var res = block('At ' + num(r.n) + ' terms');
    var exactText = decToString(r.exact);
    res.appendChild(row('The true total, exactly', ''));
    res.appendChild(E('p', 'fp-exact', exactText.length > 400 ? exactText.slice(0, 400) + ' [' +
      (exactText.length - 400) + ' more digits]' : exactText));
    res.appendChild(row('Nearest double to the true total', shortestRoundTrip(best).text, 'fp-row-hi'));

    var methods = [
      { name: 'naive', v: r.naive },
      { name: 'Kahan', v: r.kahan },
      { name: 'Neumaier', v: r.neumaier }
    ];
    var table = E('table', 'fp-table');
    var head = E('tr');
    ['method', 'result', 'absolute error', 'spacings off'].forEach(function (h) {
      head.appendChild(E('th', null, h));
    });
    table.appendChild(head);
    var bestBits = bitsOf(best, F64);
    methods.forEach(function (m) {
      var err = decSub(exactOf(m.v, F64), r.exact);
      var apart = ulpsApart(bitsOf(m.v, F64), bestBits, 60);
      var tr = E('tr');
      tr.appendChild(E('td', null, m.name));
      tr.appendChild(E('td', null, shortestRoundTrip(m.v).text));
      tr.appendChild(E('td', null, decIsZero(err) ? '0 (exact)' : decToString(decAbs(err))));
      tr.appendChild(E('td', null, apart === null ? 'more than 60' : String(Math.abs(apart))));
      table.appendChild(tr);
    });
    var scroll = E('div', 'fp-scroll');
    scroll.appendChild(table);
    res.appendChild(scroll);
    res.appendChild(row('Neumaier’s leftover correction', String(r.compensation)));
    res.appendChild(note(
      '"Spacings off" counts representable doubles between the answer and the correctly rounded ' +
      'true total. Zero means the method landed on the best double there is; it does not mean ' +
      'the answer is exact, because the true total usually is not representable at all.'));
    this.results.appendChild(res);
  };

  SumPanel.prototype.redraw = function () {
    if (this.lastPlot) drawPlot(this.canvas, this.lastPlot);
  };

  /* Kahan's own weakness, on the standard four-element example. Nothing here
     is quoted: both algorithms are run and both answers are read off. */
  SumPanel.prototype.renderKahanFail = function () {
    var data = [1, 1e100, 1, -1e100];
    var b = this.kahanFail;
    var exact = DEC_ZERO, i, x, y, t;
    var ksum = 0, kc = 0, nsum = 0, nc = 0, naive = 0;
    for (i = 0; i < data.length; i++) {
      x = data[i];
      naive = naive + x;
      y = x - kc; t = ksum + y; kc = (t - ksum) - y; ksum = t;
      t = nsum + x;
      if (Math.abs(nsum) >= Math.abs(x)) nc = nc + ((nsum - t) + x);
      else nc = nc + ((x - t) + nsum);
      nsum = t;
      exact = decAdd(exact, exactOf(x, F64));
    }
    b.appendChild(para(
      'Kahan assumes the running total is the larger of the two operands and recovers the low ' +
      'end of the term. When a single huge term arrives instead, the assumption inverts and the ' +
      'correction is taken from the wrong end. Neumaier’s change is one comparison: look at ' +
      'which operand is bigger and recover the other one. The sequence below is the standard ' +
      'demonstration, and both algorithms were just run over it.'));
    b.appendChild(row('The sequence', '1, 1e100, 1, -1e100'));
    b.appendChild(row('True total, computed exactly', decToString(exact), 'fp-row-hi'));
    b.appendChild(row('Naive left-to-right', String(naive)));
    b.appendChild(row('Kahan', String(ksum)));
    b.appendChild(row('Neumaier', String(nsum + nc)));
    b.appendChild(note(
      'Neumaier costs one comparison per term over Kahan and is never worse, which is why it is ' +
      'the version worth remembering. Neither is free: both do roughly four times the arithmetic ' +
      'of a naive sum, and neither survives a compiler allowed to re-associate floating point, ' +
      'because the compensation terms are exactly the ones an optimiser will prove to be zero ' +
      'and delete. That is what -ffast-math does to them.'));
  };

  /* ======================================================================== */
  /*  PANEL 6 — SPACING, AND WHERE THE INTEGERS RUN OUT                       */
  /* ======================================================================== */

  function SpacingPanel() {
    this.text = '1';
  }

  SpacingPanel.prototype.build = function (container) {
    var self = this;
    this.node = container;

    var head = block('How far apart are the doubles here?');
    head.appendChild(para(
      'Doubles are not evenly spaced. They are evenly spaced within each power of two and then ' +
      'the spacing doubles, which means precision is relative, not absolute: about sixteen ' +
      'significant decimal digits everywhere, whether the number is a millimetre or a light ' +
      'year. Every figure below is computed from the bit pattern of the value you enter.'));

    var ctl = E('div', 'fp-btnrow');
    var l = E('label', 'fp-label', 'value');
    l.setAttribute('for', 'fp-ulp-in');
    ctl.appendChild(l);
    this.input = E('input', 'fp-num');
    this.input.type = 'text';
    this.input.id = 'fp-ulp-in';
    this.input.value = this.text;
    this.input.spellcheck = false;
    this.input.addEventListener('input', function () {
      self.text = self.input.value;
      self.update();
    });
    ctl.appendChild(this.input);
    head.appendChild(ctl);

    var presets = E('div', 'fp-btnrow');
    presets.appendChild(E('span', 'fp-label', 'Try'));
    ['0.1', '1', '1000', '2^53', '1e16', '1e17', '1e300', '2^-1022', '2^-1074'].forEach(function (t) {
      presets.appendChild(button(t, function () {
        self.text = t;
        self.input.value = t;
        self.update();
      }));
    });
    head.appendChild(presets);
    container.appendChild(head);

    this.out = E('div');
    container.appendChild(this.out);

    var chart = block('Spacing across the whole range of the format');
    this.canvas = E('canvas', 'fp-canvas');
    this.canvas.setAttribute('role', 'img');
    chart.appendChild(this.canvas);
    this.legendHolder = E('div');
    chart.appendChild(this.legendHolder);
    chart.appendChild(note(
      'Both axes are base-two logarithms. The sloped part is the normal range, where the ' +
      'spacing is always about 2^-52 of the value. The flat part on the left is the subnormal ' +
      'range: the spacing stops shrinking at 2^-1074 and the number of significant bits falls ' +
      'away instead, one per halving, until there are none left and the next value is zero.'));
    container.appendChild(chart);

    var ints = block('Where the integers stop');
    container.appendChild(ints);
    this.renderIntegers(ints);

    var counts = block('How many doubles there are, and where they are');
    container.appendChild(counts);
    this.renderCounts(counts);

    this.update();
  };

  SpacingPanel.prototype.update = function () {
    var x = parseValue(this.text);
    var out = this.out;
    clear(out);
    if (typeof x !== 'number' || isNaN(x)) {
      out.appendChild(note('That did not parse as a number. Powers of two can be written 2^-1074.', 'fp-warn'));
      return;
    }
    var bits = bitsOf(x, F64);
    var d = decode(bits, F64);
    if (d.kind === 'nan' || d.kind === 'infinity') {
      out.appendChild(note('Infinity and NaN have no spacing around them; they are not values on the line.', 'fp-warn'));
      return;
    }
    var u = ulpInfo(bits, F64);
    var ex = exactOfBits(bits, F64);

    var grid = E('div', 'fp-grid');
    function card(h, big, sub) {
      var c = E('div', 'fp-card');
      c.appendChild(E('p', 'fp-card-h', h));
      c.appendChild(E('p', 'fp-big', big));
      if (sub) c.appendChild(E('p', 'fp-card-note', sub));
      return c;
    }
    grid.appendChild(card('The value stored', shortestRoundTrip(x).text, classLabel(d.kind)));
    if (u) {
      grid.appendChild(card('Spacing here', '2^' + u.power,
        shortestRoundTrip(decToNumber(u.gap)).text));
      grid.appendChild(card('Spacing relative to the value',
        d.kind === 'normal' ? '2^-' + F64.sigBits : 'coarser than 2^-52',
        d.kind === 'normal'
          ? 'about 2.22e-16, which is where "sixteen digits" comes from'
          : 'a subnormal has fewer significant bits than a normal value, so the relative spacing is worse'));
    }
    grid.appendChild(card('Unbiased exponent', String(unbiasedExp(d)),
      'the value sits between 2^' + unbiasedExp(d) + ' and 2^' + (unbiasedExp(d) + 1)));
    out.appendChild(grid);

    if (ex && u) {
      var e = block('Exactly');
      e.appendChild(row('This value', decToString(ex)));
      e.appendChild(row('The next value up', decToString(u.next)));
      e.appendChild(row('The gap between them', decToString(u.gap), 'fp-row-hi'));
      e.appendChild(row('Cross-check', u.agrees
        ? 'the difference of the two exact expansions is 2^' + u.power + ', as it must be'
        : 'MISMATCH — please report this'));
      e.appendChild(note(
        'Anything you write between those two values ends up on one of them. That is not an ' +
        'error in the arithmetic; there is nothing in between to land on.'));
      out.appendChild(e);
    }

    this.redraw(unbiasedExp(d));
  };

  SpacingPanel.prototype.redraw = function (markAt) {
    var pts = [], k;
    if (markAt == null) {
      var x = parseValue(this.text);
      markAt = (typeof x === 'number' && isFinite(x) && x !== 0)
        ? unbiasedExp(decode(bitsOf(x, F64), F64)) : 0;
    }
    for (k = -1074; k <= 1023; k += 1) {
      pts.push([k, k < -1022 ? -1074 : k - 52]);
    }
    var series = [
      { name: 'spacing between neighbouring doubles', style: 'solid, cyan',
        colour: C.cyan, dash: [], points: pts },
      { name: 'the value you entered', style: 'dashed, amber', colour: C.amber, dash: [5, 4],
        points: [[markAt, -1100], [markAt, 1000]] }
    ];
    drawPlot(this.canvas, {
      xMin: -1100, xMax: 1050, yMin: -1100, yMax: 1000,
      xTicks: 6, yTicks: 6,
      xLabel: function (t) { return '2^' + Math.round(t); },
      yLabel: function (t) { return '2^' + Math.round(t); },
      xTitle: 'magnitude of the value',
      series: series
    });
    this.canvas.setAttribute('aria-label',
      'Spacing between neighbouring float64 values against magnitude, both on base-two ' +
      'logarithmic axes. The line is flat at 2 to the power minus 1074 below 2 to the power ' +
      'minus 1022, and rises with slope one above it.');
    clear(this.legendHolder);
    this.legendHolder.appendChild(legend(series));
  };

  SpacingPanel.prototype.renderIntegers = function (b) {
    b.appendChild(para(
      'An integer is exactly representable while the spacing at its magnitude is 1 or less. The ' +
      'spacing reaches 1 at 2^53, so 2^53 is the first place two consecutive integers cannot ' +
      'both exist — and the one that loses is the odd one. Everything in the table was ' +
      'evaluated just now, not tabulated.'));
    var table = E('table', 'fp-table');
    var head = E('tr');
    ['magnitude', 'spacing there', 'consecutive integers?'].forEach(function (h) {
      head.appendChild(E('th', null, h));
    });
    table.appendChild(head);
    var k;
    for (k = 50; k <= 57; k++) {
      var v = Math.pow(2, k);
      var u = ulpInfo(bitsOf(v, F64), F64);
      var gapNum = decToNumber(u.gap);
      var tr = E('tr');
      tr.appendChild(E('td', null, '2^' + k));
      tr.appendChild(E('td', null, num(gapNum)));
      tr.appendChild(E('td', null, gapNum <= 1
        ? 'yes, every integer up here is exact'
        : 'no, only multiples of ' + num(gapNum) + ' exist up here'));
      table.appendChild(tr);
    }
    var scroll = E('div', 'fp-scroll');
    scroll.appendChild(table);
    b.appendChild(scroll);

    var two53 = Math.pow(2, 53);
    b.appendChild(row('2^53', String(two53)));
    b.appendChild(row('2^53 + 1 === 2^53', String(two53 + 1 === two53) +
      '  — the odd integer has nowhere to go, so it lands back on 2^53'));
    b.appendChild(row('2^53 + 2 === 2^53', String(two53 + 2 === two53)));
    b.appendChild(row('2^53 + 3', shortestRoundTrip(two53 + 3).text +
      '  — a tie, broken toward the even significand, so it rounds up'));
    b.appendChild(row('Number.MAX_SAFE_INTEGER',
      String(typeof Number.MAX_SAFE_INTEGER === 'number' ? Number.MAX_SAFE_INTEGER : two53 - 1) +
      '  — the largest integer whose successor is also representable'));
    b.appendChild(note(
      'This is why an identifier from a database arrives in JavaScript as a string more often ' +
      'than not. A 64-bit row id above 2^53 cannot survive JSON.parse into a Number, and the ' +
      'failure is silent: the value is not rejected, it is quietly changed to a nearby one.'));
  };

  SpacingPanel.prototype.renderCounts = function (b) {
    var perBinary = bigFromNumber(Math.pow(2, F64.sigBits));
    var belowOne = bigMulSmall(perBinary, F64.bias);
    var normals = bigMulSmall(perBinary, fmtMaxExp(F64) - 1);
    var subnormals = bigSub(perBinary, [1]);
    /* Positive finite values, zero excluded: every normal, plus every
       subnormal except the all-zero pattern. Kept as big integers because two
       of these are past 2^53, and working them out in floating point inside a
       lab about the limits of floating point would be a poor advertisement. */
    var allPositive = bigSub(bigAdd(normals, perBinary), [1]);
    b.appendChild(para(
      'The counts below are exact integers, produced by the same big-integer code that produces ' +
      'the decimal expansions, because two of them are larger than a double can hold and ' +
      'computing them in floating point inside a lab about floating point would be an odd choice.'));
    b.appendChild(row('Doubles between 1 and 2', bigToString(perBinary)));
    b.appendChild(row('Doubles between 0 and 1', bigToString(belowOne), 'fp-row-hi'));
    b.appendChild(row('Positive normal doubles', bigToString(normals)));
    b.appendChild(row('Positive subnormal doubles', bigToString(subnormals)));
    b.appendChild(row('Positive finite doubles, all told', bigToString(allPositive)));
    b.appendChild(note(
      'There are ' + F64.bias + ' times as many doubles between zero and one as there are ' +
      'between one and two, because the exponent field has that many values below 1 and each of ' +
      'them gets a full set of fraction patterns. Compare the second row with the last: just ' +
      'under half of every positive double there is sits below 1, so just under half of the ' +
      'whole format is spent on the interval from -1 to 1. That is the resolution going where ' +
      'numerical work usually needs it least.'));
  };

  /* ======================================================================== */
  /*  THE APP                                                                 */
  /* ======================================================================== */

  function App(root) {
    var self = this;
    this.root = root;
    this.check = selfCheck(600);

    this.panels = [
      { name: 'Bits', obj: new BitsPanel() },
      { name: '0.1 + 0.2', obj: new AddPanel(this.check) },
      { name: 'Subnormals', obj: new DenormalPanel() },
      { name: 'NaN', obj: new NaNPanel() },
      { name: 'Summation', obj: new SumPanel() },
      { name: 'Spacing', obj: new SpacingPanel() }
    ];
    this.active = 0;

    var style = E('style');
    style.textContent = CSS;
    root.appendChild(style);

    var wrap = E('div', 'fp-wrap');
    var tabs = E('div', 'fp-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Floating point topics');
    this.tabs = [];
    this.panels.forEach(function (p, i) {
      var b = E('button', 'fp-tab', p.name);
      b.type = 'button';
      b.id = 'fp-tab-' + i;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'fp-panel-' + i);
      b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener('click', function () { self.select(i); });
      self.tabs.push(b);
      tabs.appendChild(b);
    });
    tabs.addEventListener('keydown', function (ev) {
      var next = -1;
      if (ev.key === 'ArrowRight') next = (self.active + 1) % self.tabs.length;
      else if (ev.key === 'ArrowLeft') next = (self.active + self.tabs.length - 1) % self.tabs.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = self.tabs.length - 1;
      else return;
      ev.preventDefault();
      self.select(next);
      self.tabs[next].focus();
    });
    wrap.appendChild(tabs);

    var body = E('div', 'fp-body');
    this.holders = [];
    this.panels.forEach(function (p, i) {
      var holder = E('div', 'fp-panel');
      holder.id = 'fp-panel-' + i;
      holder.setAttribute('role', 'tabpanel');
      holder.setAttribute('aria-labelledby', 'fp-tab-' + i);
      holder.tabIndex = 0;
      if (i !== 0) holder.hidden = true;
      self.holders.push(holder);
      body.appendChild(holder);
    });
    wrap.appendChild(body);
    root.appendChild(wrap);

    this.built = [];
    this.show(0);

    /* A canvas does not resize itself, and both charts here are drawn in CSS
       pixels. Debounced, because dragging a window edge fires this without
       pause and the summation chart is not cheap to lay out. */
    var timer = null;
    window.addEventListener('resize', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var p = self.panels[self.active].obj;
        if (p.redraw) p.redraw();
      }, 200);
    });
  }

  App.prototype.select = function (i) {
    var k;
    this.active = i;
    for (k = 0; k < this.tabs.length; k++) {
      this.tabs[k].setAttribute('aria-selected', k === i ? 'true' : 'false');
      this.tabs[k].tabIndex = k === i ? 0 : -1;
      this.holders[k].hidden = k !== i;
    }
    this.show(i);
  };

  /* Panels are built the first time they are shown, not up front. The
     summation panel does a hundred thousand exact-decimal additions before it
     can draw anything, and paying for that on page load — for a panel the
     visitor may never open — would make the first paint feel broken. */
  App.prototype.show = function (i) {
    var p = this.panels[i].obj;
    if (!this.built[i]) {
      this.built[i] = true;
      p.build(this.holders[i]);
    } else if (p.redraw) {
      p.redraw();
    }
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var started = false;
  function boot() {
    if (started) return;
    var rootEl = document.getElementById('ieee754');
    if (!rootEl) return;
    started = true;
    var mount = document.getElementById('viz-ieee754-mount') || rootEl;
    clear(mount);
    try {
      var app = new App(mount);
      if (app && window.KSLab && window.KSLab.used) window.KSLab.used('run');
    } catch (err) {
      clear(mount);
      mount.appendChild(E('p', 'lab-viz-error',
        'This lab could not start in your browser: ' + ((err && err.message) || String(err)) +
        ' — the write-up below still explains what it would have shown. Please tell me, and ' +
        'mention which browser you are using.'));
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'ieee754', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

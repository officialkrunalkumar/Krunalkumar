/* ==========================================================================
   contrast.js — colour contrast, with the arithmetic shown.
   --------------------------------------------------------------------------
   Every contrast checker prints a number. Almost none of them print where the
   number came from, and the result is that people argue with it. So this one
   shows the whole chain: 8-bit channel, divided to 0..1, through the piecewise
   sRGB transfer function, weighted into a relative luminance, and finally the
   ratio with its two 0.05 flare terms. Once someone has seen that, the
   disagreements stop being about the tool and start being about the design.

   APCA is computed alongside, and is deliberately NOT presented as a verdict.
   It is a candidate for WCAG 3, which is a draft; nobody is obliged to meet it
   and nobody can be failed for missing it. What it is good for is explaining
   why WCAG 2.x behaves strangely on dark backgrounds — the 2.x formula is
   polarity-blind, so it scores light-on-dark the same as dark-on-light when
   the eye does not.

   The colour-vision simulation uses the Machado, Oliveira and Fernandes (2009)
   severity-1.0 matrices, applied in linear light because that is the space
   they were derived in. Applying them to gamma-encoded bytes — which is what a
   surprising number of implementations do — gives visibly wrong colours.

   Nothing here is uploaded. It is arithmetic on two colours; there would be
   nothing to gain from a server and a great deal to explain.
   ========================================================================== */

/* global LabTool */
(function (root) {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ---------------------------------------------------------------- utils */

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  /* Math.cbrt is ES6 and the rest of this file is ES5, so it is detected
     rather than assumed. Only the OKLab transform needs it, and a wrong cube
     root there would skew every suggested fix without ever throwing. */
  function cbrt(x) {
    if (typeof Math.cbrt === 'function') return Math.cbrt(x);
    var sign = x < 0 ? -1 : 1;
    return sign * Math.pow(Math.abs(x), 1 / 3);
  }

  function fixed(x, n) {
    if (!isFinite(x)) return '--';
    return x.toFixed(n);
  }

  function col(text, width) {
    var s = String(text);
    while (s.length < width) s += ' ';
    return s;
  }

  function hex2(n) {
    var h = Math.round(clamp(n, 0, 255)).toString(16);
    return h.length < 2 ? '0' + h : h;
  }

  function toHex(c) { return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b); }

  function rgbText(c) {
    return 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* -------------------------------------------------------------- parsing */

  /* A short list, not the full 148 CSS names. These are the ones people
     actually type into a box like this; anything else has to be written as a
     value, and the field says so rather than silently returning black. */
  var NAMED = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
    blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
    magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080',
    silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00',
    teal: '#008080', navy: '#000080', purple: '#800080', orange: '#ffa500',
    pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700', indigo: '#4b0082',
    violet: '#ee82ee', tan: '#d2b48c', beige: '#f5f5dc', ivory: '#fffff0',
    crimson: '#dc143c', salmon: '#fa8072', khaki: '#f0e68c', plum: '#dda0dd'
  };

  function parseHex(s) {
    var body = s.slice(1);
    if (!/^[0-9a-f]+$/.test(body)) return null;
    if (body.length === 3 || body.length === 4) {
      var expanded = '';
      for (var i = 0; i < body.length; i++) expanded += body.charAt(i) + body.charAt(i);
      body = expanded;
    }
    if (body.length !== 6 && body.length !== 8) return null;
    return {
      r: parseInt(body.substr(0, 2), 16),
      g: parseInt(body.substr(2, 2), 16),
      b: parseInt(body.substr(4, 2), 16),
      a: body.length === 8 ? parseInt(body.substr(6, 2), 16) / 255 : 1
    };
  }

  /* A component that may be written as a percentage. `full` is what 100%
     means for this component: 255 for an rgb channel, 1 for a lightness. */
  function comp(token, full) {
    if (token === undefined) return NaN;
    if (token.charAt(token.length - 1) === '%') {
      return parseFloat(token) / 100 * full;
    }
    return parseFloat(token);
  }

  function angle(token) {
    if (token === undefined) return NaN;
    var v = parseFloat(token);
    if (/turn$/.test(token)) return v * 360;
    if (/rad$/.test(token)) return v * 180 / Math.PI;
    return v;
  }

  function alphaOf(token) {
    if (token === undefined) return 1;
    var v = comp(token, 1);
    return isFinite(v) ? clamp(v, 0, 1) : 1;
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  function parseColor(input) {
    if (input === null || input === undefined) return null;
    var s = String(input).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!s) return null;
    if (NAMED[s]) s = NAMED[s];
    if (s.charAt(0) === '#') return parseHex(s);

    var open = s.indexOf('(');
    if (open < 0) return null;
    var fn = s.slice(0, open).replace(/\s+$/, '');
    var body = s.slice(open + 1).replace(/\)\s*$/, '');
    var raw = body.replace(/\//g, ' ').replace(/,/g, ' ').split(/\s+/);
    var p = [];
    for (var i = 0; i < raw.length; i++) if (raw[i] !== '') p.push(raw[i]);
    if (p.length < 3) return null;

    var c;
    if (fn === 'rgb' || fn === 'rgba') {
      c = { r: comp(p[0], 255), g: comp(p[1], 255), b: comp(p[2], 255), a: alphaOf(p[3]) };
    } else if (fn === 'hsl' || fn === 'hsla') {
      c = hslToRgb(angle(p[0]), comp(p[1], 1), comp(p[2], 1));
      c.a = alphaOf(p[3]);
    } else if (fn === 'oklch') {
      var L = comp(p[0], 1), C = comp(p[1], 0.4), H = angle(p[2]);
      if (!isFinite(L) || !isFinite(C) || !isFinite(H)) return null;
      var conv = oklchToSrgb(L, C, H);
      c = { r: conv.rgb.r, g: conv.rgb.g, b: conv.rgb.b, a: alphaOf(p[3]) };
    } else if (fn === 'oklab') {
      var lin = oklabToLinear(comp(p[0], 1), parseFloat(p[1]), parseFloat(p[2]));
      c = { r: linTo8(lin.r), g: linTo8(lin.g), b: linTo8(lin.b), a: alphaOf(p[3]) };
    } else {
      return null;
    }
    if (!isFinite(c.r) || !isFinite(c.g) || !isFinite(c.b)) return null;
    c.r = clamp(Math.round(c.r), 0, 255);
    c.g = clamp(Math.round(c.g), 0, 255);
    c.b = clamp(Math.round(c.b), 0, 255);
    return c;
  }

  /* -------------------------------------------------- sRGB and WCAG 2.x */

  var TRANSFER_KNEE = 0.04045;

  function toLinear(byte) {
    var c = byte / 255;
    return c <= TRANSFER_KNEE ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linTo8(v) {
    v = clamp(v, 0, 1);
    var s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return clamp(Math.round(s * 255), 0, 255);
  }

  function luminance(c) {
    return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
  }

  function wcagRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = la > lb ? la : lb;
    var lo = la > lb ? lb : la;
    return (hi + 0.05) / (lo + 0.05);
  }

  /* ------------------------------------------------------------- APCA-W3 */

  /* APCA-W3 0.1.9, the revision published alongside the WCAG 3 working draft.
     Constants are named the way the reference implementation names them so
     they can be checked line by line against it. This is a comparison figure,
     not a conformance result — see the copy on the page. */
  var APCA = {
    mainTRC: 2.4,
    Rco: 0.2126729, Gco: 0.7151522, Bco: 0.0721750,
    normBG: 0.56, normTXT: 0.57, revTXT: 0.62, revBG: 0.65,
    blkThrs: 0.022, blkClmp: 1.414,
    scale: 1.14, loOffset: 0.027, loClip: 0.1, deltaYmin: 0.0005
  };

  function apcaY(c) {
    return APCA.Rco * Math.pow(c.r / 255, APCA.mainTRC) +
           APCA.Gco * Math.pow(c.g / 255, APCA.mainTRC) +
           APCA.Bco * Math.pow(c.b / 255, APCA.mainTRC);
  }

  function apcaClamp(y) {
    return y >= APCA.blkThrs ? y : y + Math.pow(APCA.blkThrs - y, APCA.blkClmp);
  }

  function apcaLc(textColor, bgColor) {
    var ytxt = apcaClamp(apcaY(textColor));
    var ybg = apcaClamp(apcaY(bgColor));
    if (Math.abs(ybg - ytxt) < APCA.deltaYmin) return 0;
    var sapc, result;
    if (ybg > ytxt) {
      sapc = (Math.pow(ybg, APCA.normBG) - Math.pow(ytxt, APCA.normTXT)) * APCA.scale;
      result = sapc < APCA.loClip ? 0 : sapc - APCA.loOffset;
    } else {
      sapc = (Math.pow(ybg, APCA.revBG) - Math.pow(ytxt, APCA.revTXT)) * APCA.scale;
      result = sapc > -APCA.loClip ? 0 : sapc + APCA.loOffset;
    }
    return result * 100;
  }

  /* The published Lc guidance is a lookup, not a line. This is the coarse
     reading of it, and it is described as guidance on the page too. */
  function apcaAdvice(lc) {
    var a = Math.abs(lc);
    if (a >= 90) return 'body text at any weight this design is likely to use';
    if (a >= 75) return 'body text from about 16 px at weight 400';
    if (a >= 60) return 'the practical floor for body text, 18 px at weight 400';
    if (a >= 45) return 'large or heavy text only, roughly 24 px at weight 400';
    if (a >= 30) return 'the absolute minimum for any text; not for reading';
    if (a >= 15) return 'non-text only — borders, dividers, disabled states';
    return 'not usable for anything that has to be seen';
  }

  /* ---------------------------------------------------------- OKLab space */

  function oklabToLinear(L, a, b) {
    var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return {
      r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    };
  }

  function srgbToOklch(c) {
    var r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
    var l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    var h = Math.atan2(B, A) * 180 / Math.PI;
    if (h < 0) h += 360;
    return { l: L, c: Math.sqrt(A * A + B * B), h: h };
  }

  function inGamut(v) {
    var e = 0.0001;
    return v.r >= -e && v.r <= 1 + e &&
           v.g >= -e && v.g <= 1 + e &&
           v.b >= -e && v.b <= 1 + e;
  }

  /* Hue is held exactly and chroma is reduced only as far as it must be to
     land back inside sRGB. Clipping the channels instead is simpler and wrong:
     it shifts the hue, which is the one thing the caller asked to keep. */
  function oklchToSrgb(L, C, H) {
    L = clamp(L, 0, 1);
    var rad = H * Math.PI / 180;
    var used = C;
    var lin = oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad));
    if (!inGamut(lin)) {
      var lo = 0, hi = C;
      for (var i = 0; i < 32; i++) {
        var mid = (lo + hi) / 2;
        if (inGamut(oklabToLinear(L, mid * Math.cos(rad), mid * Math.sin(rad)))) lo = mid;
        else hi = mid;
      }
      used = lo;
      lin = oklabToLinear(L, used * Math.cos(rad), used * Math.sin(rad));
    }
    return {
      rgb: { r: linTo8(lin.r), g: linTo8(lin.g), b: linTo8(lin.b) },
      chroma: used,
      clipped: used < C - 0.000001
    };
  }

  /* ------------------------------------------------- colour-vision models */

  /* Machado, Oliveira and Fernandes (2009), "A physiologically-based model for
     simulation of color vision deficiency", severity 1.0. Row-major, applied
     to LINEAR sRGB — that is the space the paper derives them in, and applying
     them to gamma-encoded bytes instead produces colours that are visibly off.

     Achromatopsia is not from that paper. It is the Rec. 709 luminance of the
     linear colour written to all three channels, which is a reasonable stand-in
     for complete achromatopsia and nothing more. */
  var VISION = [
    {
      key: 'normal',
      name: 'Typical colour vision',
      basis: 'No transform applied.',
      matrix: null
    },
    {
      key: 'protan',
      name: 'Protanopia',
      basis: 'Machado 2009, severity 1.0, in linear sRGB. About 1 in 100 men.',
      matrix: [0.152286, 1.052583, -0.204868,
               0.114503, 0.786281, 0.099216,
               -0.003882, -0.048116, 1.051998]
    },
    {
      key: 'deutan',
      name: 'Deuteranopia',
      basis: 'Machado 2009, severity 1.0, in linear sRGB. The most common form.',
      matrix: [0.367322, 0.860646, -0.227968,
               0.280085, 0.672501, 0.047413,
               -0.011820, 0.042940, 0.968881]
    },
    {
      key: 'tritan',
      name: 'Tritanopia',
      basis: 'Machado 2009, severity 1.0, in linear sRGB. Rare, and not sex-linked.',
      matrix: [1.255528, -0.076749, -0.178779,
               -0.078411, 0.930809, 0.147602,
               0.004733, 0.691367, 0.303900]
    },
    {
      key: 'achroma',
      name: 'Achromatopsia',
      basis: 'Rec. 709 luminance in linear light, not a Machado matrix.',
      matrix: 'luma'
    }
  ];

  function simulate(c, model) {
    if (!model.matrix) return { r: c.r, g: c.g, b: c.b };
    var r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
    if (model.matrix === 'luma') {
      var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return { r: linTo8(y), g: linTo8(y), b: linTo8(y) };
    }
    var m = model.matrix;
    return {
      r: linTo8(m[0] * r + m[1] * g + m[2] * b),
      g: linTo8(m[3] * r + m[4] * g + m[5] * b),
      b: linTo8(m[6] * r + m[7] * g + m[8] * b)
    };
  }

  /* ------------------------------------------------------------- targets */

  var TARGETS = [
    { id: '4.5', value: 4.5, label: 'AA, normal text — 4.5:1' },
    { id: '7', value: 7, label: 'AAA, normal text — 7:1' },
    { id: '3', value: 3, label: 'AA, large text and UI — 3:1' },
    { id: '4.5aaa', value: 4.5, label: 'AAA, large text — 4.5:1' }
  ];

  function targetByValue(id) {
    for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].id === id) return TARGETS[i];
    return TARGETS[0];
  }

  /* ------------------------------------------------------------- fixing */

  function ratioAtL(L, base, other) {
    var conv = oklchToSrgb(L, base.c, base.h);
    return {
      ratio: wcagRatio(conv.rgb, other),
      rgb: conv.rgb,
      chroma: conv.chroma
    };
  }

  /* Bisect on lightness between the colour as it stands and one end of the
     scale, and return the first L that clears the target. Two searches, one
     towards black and one towards white, because which of them is the smaller
     move depends entirely on where the other colour sits. */
  function searchDir(base, other, target, endL) {
    if (ratioAtL(endL, base, other).ratio < target) return null;
    var lo = base.l, hi = endL;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (ratioAtL(mid, base, other).ratio >= target) hi = mid; else lo = mid;
    }
    var got = ratioAtL(hi, base, other);
    return {
      L: hi,
      dL: Math.abs(hi - base.l),
      ratio: got.ratio,
      rgb: got.rgb,
      chroma: got.chroma,
      baseChroma: base.c,
      baseL: base.l,
      hue: base.h
    };
  }

  function smallestFix(moving, other, target) {
    var base = srgbToOklch(moving);
    var down = searchDir(base, other, target, 0);
    var up = searchDir(base, other, target, 1);
    if (!down && !up) return null;
    if (!down) return up;
    if (!up) return down;
    return down.dL <= up.dL ? down : up;
  }

  /* -------------------------------------------------------------- the DOM */

  var fgPick, bgPick, fgField, bgField, fgNote, bgNote, targetSel, statusEl;
  var previewEl, verdictEl, fixEl, simsEl, paletteEl, paletteOutEl, announceEl;
  var sampleNormal, sampleLarge, sampleUi, sampleMuted;

  var state = { fg: null, bg: null };

  function setNote(node, text, cls) {
    node.textContent = text || '';
    node.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  function paintPreview(fg, bg) {
    previewEl.style.backgroundColor = toHex(bg);
    sampleNormal.style.color = toHex(fg);
    sampleLarge.style.color = toHex(fg);
    sampleMuted.style.color = toHex(fg);
    sampleUi.style.borderColor = toHex(fg);
    sampleUi.style.color = toHex(fg);
  }

  function verdictRow(name, threshold, ratio, note) {
    var row = el('div', 'cn-verdict');
    var pass = ratio >= threshold;
    row.appendChild(el('span', 'cn-verdict-name', name));
    var badge = el('span', 'cn-verdict-badge ' + (pass ? 'is-pass' : 'is-fail'),
                   pass ? 'Pass' : 'Fail');
    row.appendChild(badge);
    row.appendChild(el('span', 'cn-verdict-note',
      fixed(ratio, 2) + ':1 against ' + threshold + ':1' + (note ? ' — ' + note : '')));
    return row;
  }

  /* The output pane already has the shell's announcer, but all it can say is
     "output updated, 40 lines" — it cannot know that line 38 is the answer.
     This region carries the actual verdict instead.

     Its own timer, longer than the recompute debounce, because recompute runs
     while someone is still typing a hex and reading a verdict for every
     intermediate value would be unusable. It settles once and says one thing. */
  var announceTimer = null;
  function announceVerdict(ratio) {
    if (!announceEl) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      announceEl.textContent = fixed(ratio, 2) + ' to 1. ' +
        (ratio >= 7 ? 'Passes AAA for normal text.'
         : ratio >= 4.5 ? 'Passes AA for normal text, fails AAA.'
         : ratio >= 3 ? 'Fails AA for normal text; passes for large text and UI components.'
         : 'Fails every threshold.');
    }, 700);
  }

  function announceError(message) {
    if (!announceEl) return;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { announceEl.textContent = message; }, 700);
  }

  function renderVerdicts(ratio) {
    verdictEl.textContent = '';
    verdictEl.appendChild(verdictRow('Normal text, AA', 4.5, ratio, 'SC 1.4.3'));
    verdictEl.appendChild(verdictRow('Normal text, AAA', 7, ratio, 'SC 1.4.6'));
    verdictEl.appendChild(verdictRow('Large text, AA', 3, ratio, '24 px, or 18.66 px bold'));
    verdictEl.appendChild(verdictRow('Large text, AAA', 4.5, ratio, 'SC 1.4.6'));
    verdictEl.appendChild(verdictRow('UI and graphics, AA', 3, ratio, 'SC 1.4.11, no AAA exists'));
  }

  /* ------------------------------------------------------- the derivation */

  function channelTable(label, c) {
    out.line('  ' + label + '  ' + toHex(c) + '   ' + rgbText(c), 't-info');
    out.line('  ' + col('', 4) + col('8-bit', 8) + col('0..1', 12) +
             col('branch', 12) + 'linear', 't-dim');
    var names = ['R', 'G', 'B'];
    var vals = [c.r, c.g, c.b];
    for (var i = 0; i < 3; i++) {
      var eight = vals[i];
      var unit = eight / 255;
      var branch = unit <= TRANSFER_KNEE ? 'c / 12.92' : 'power 2.4';
      out.line('  ' + col(names[i], 4) + col(eight, 8) + col(fixed(unit, 6), 12) +
               col(branch, 12) + fixed(toLinear(eight), 6));
    }
  }

  function renderDerivation(fg, bg, ratio) {
    out.clear();
    out.heading('WCAG 2.x contrast ratio, computed in full');
    out.rule();
    out.line('Step 1 — every channel to 0..1, then through the sRGB transfer');
    out.line('function. It is piecewise: a straight line near black, a 2.4');
    out.line('power curve above it. The knee is at 0.04045.');
    out.line('');
    out.dim('  c <= 0.04045  ->  c / 12.92');
    out.dim('  c >  0.04045  ->  ((c + 0.055) / 1.055) ^ 2.4');
    out.line('');
    channelTable('foreground', fg);
    out.line('');
    channelTable('background', bg);
    out.rule();

    var lf = luminance(fg), lb = luminance(bg);
    out.line('Step 2 — relative luminance. The weights are the Rec. 709');
    out.line('luminance coefficients: green carries most of the brightness');
    out.line('the eye sees, blue almost none.');
    out.line('');
    out.dim('  L = 0.2126 R + 0.7152 G + 0.0722 B');
    out.line('');
    out.line('  foreground  L = 0.2126 * ' + fixed(toLinear(fg.r), 6) +
             ' + 0.7152 * ' + fixed(toLinear(fg.g), 6));
    out.line('                  + 0.0722 * ' + fixed(toLinear(fg.b), 6) +
             '  =  ' + fixed(lf, 6));
    out.line('  background  L = 0.2126 * ' + fixed(toLinear(bg.r), 6) +
             ' + 0.7152 * ' + fixed(toLinear(bg.g), 6));
    out.line('                  + 0.0722 * ' + fixed(toLinear(bg.b), 6) +
             '  =  ' + fixed(lb, 6));
    out.rule();

    var hi = Math.max(lf, lb), lo = Math.min(lf, lb);
    out.line('Step 3 — the ratio. The 0.05 added to both sides is a flare');
    out.line('term: an allowance for light bouncing off the screen, which is');
    out.line('why pure black on pure white is 21:1 and not infinity.');
    out.line('');
    out.dim('  (L_lighter + 0.05) / (L_darker + 0.05)');
    out.line('');
    out.line('  (' + fixed(hi, 6) + ' + 0.05) / (' + fixed(lo, 6) + ' + 0.05)');
    out.line('  = ' + fixed(hi + 0.05, 6) + ' / ' + fixed(lo + 0.05, 6));
    out.line('');
    var verdictClass = ratio >= 4.5 ? 't-ok' : (ratio >= 3 ? 't-warn' : 't-err');
    out.line('  = ' + fixed(ratio, 2) + ' : 1', verdictClass);
    out.rule();

    var lc = apcaLc(fg, bg);
    out.heading('APCA-W3 0.1.9 — for comparison, not for compliance');
    out.line('');
    out.row('polarity', lb > lf ? 'dark text on a lighter background'
                                : 'light text on a darker background');
    out.row('Lc', fixed(lc, 1));
    out.row('reads as', apcaAdvice(lc));
    out.line('');
    out.dim('APCA is polarity-aware: it computes a different curve depending on');
    out.dim('whether the text is lighter or darker than its background. WCAG 2.x');
    out.dim('does not, which is why the two disagree most on dark themes.');
    out.line('');
    out.warn('This number is not a standard. APCA is a candidate for WCAG 3,');
    out.warn('which is a working draft. No audit can require it and no audit');
    out.warn('can fail you for missing it. Ship against the ratio above.');
  }

  /* --------------------------------------------------------- the fix panel */

  function fixCard(title, fix, target, applyTo) {
    var card = el('div', 'cn-fixcard');
    card.appendChild(el('p', 'cn-fixcard-title', title));
    if (!fix) {
      card.appendChild(el('p', 'cn-fixcard-note',
        'No lightness on this hue reaches ' + target.value + ':1 against the other colour. ' +
        'The hue itself has to change, or the other colour does.'));
      return card;
    }
    var swatch = el('span', 'cn-fixcard-swatch');
    swatch.style.backgroundColor = toHex(fix.rgb);
    var head = el('div', 'cn-fixcard-head');
    head.appendChild(swatch);
    head.appendChild(el('code', 'cn-fixcard-hex', toHex(fix.rgb)));
    head.appendChild(el('span', 'cn-fixcard-ratio', fixed(fix.ratio, 2) + ':1'));
    card.appendChild(head);

    card.appendChild(el('p', 'cn-fixcard-note',
      'OKLCH lightness ' + fixed(fix.baseL, 3) + ' to ' + fixed(fix.L, 3) +
      ' — a move of ' + fixed(fix.dL, 3) + '. Hue held at ' + fixed(fix.hue, 1) + ' degrees.'));

    if (fix.chroma < fix.baseChroma - 0.0005) {
      card.appendChild(el('p', 'cn-fixcard-note cn-fixcard-warn',
        'Chroma had to fall from ' + fixed(fix.baseChroma, 3) + ' to ' +
        fixed(fix.chroma, 3) + ' to stay inside sRGB at that lightness.'));
    }

    var btn = el('button', 'lab-btn', 'Use this colour');
    btn.type = 'button';
    btn.setAttribute('data-apply', applyTo);
    btn.setAttribute('data-hex', toHex(fix.rgb));
    card.appendChild(btn);
    return card;
  }

  function renderFix(fg, bg, ratio) {
    var target = targetByValue(targetSel.value);
    fixEl.textContent = '';

    var head = el('p', 'cn-block-note');
    if (ratio >= target.value) {
      head.textContent = 'This pair already clears ' + target.value + ':1, at ' +
        fixed(ratio, 2) + ':1. Nothing to change. Pick a stricter target to see ' +
        'what it would cost.';
      fixEl.appendChild(head);
      return;
    }
    head.textContent = 'At ' + fixed(ratio, 2) + ':1 this pair misses ' + target.value +
      ':1. Below are the smallest lightness moves that reach it, one changing the ' +
      'foreground and one changing the background. Hue is held exactly; chroma is ' +
      'kept unless sRGB will not hold it.';
    fixEl.appendChild(head);

    var grid = el('div', 'cn-fixgrid');
    var fgFix = smallestFix(fg, bg, target.value);
    var bgFix = smallestFix(bg, fg, target.value);
    var fgCard = fixCard('Move the foreground', fgFix, target, 'fg');
    var bgCard = fixCard('Move the background', bgFix, target, 'bg');

    if (fgFix && bgFix) {
      if (fgFix.dL <= bgFix.dL) fgCard.className += ' is-smallest';
      else bgCard.className += ' is-smallest';
    }
    grid.appendChild(fgCard);
    grid.appendChild(bgCard);
    fixEl.appendChild(grid);
  }

  /* ------------------------------------------------------- the simulations */

  function simCard(model, fg, bg) {
    var sfg = simulate(fg, model);
    var sbg = simulate(bg, model);
    var card = el('article', 'cn-sim');
    card.appendChild(el('h3', 'cn-sim-name', model.name));

    var stage = el('div', 'cn-sim-stage');
    stage.style.backgroundColor = toHex(sbg);

    var text = el('p', 'cn-sim-text', 'Body text on this pair');
    text.style.color = toHex(sfg);
    stage.appendChild(text);

    var btn = el('span', 'cn-sim-button', 'Filled button');
    btn.style.backgroundColor = toHex(sfg);
    btn.style.color = toHex(sbg);
    stage.appendChild(btn);

    /* A fixed green and red, simulated with everything else. The pair passes
       WCAG against most backgrounds and still collapses into one colour under
       protanopia and deuteranopia — which is the whole argument for never
       carrying meaning in hue alone. */
    var dots = el('div', 'cn-sim-dots');
    var ok = simulate({ r: 22, g: 163, b: 74 }, model);
    var bad = simulate({ r: 220, g: 38, b: 38 }, model);
    var okDot = el('span', 'cn-sim-dot');
    okDot.style.backgroundColor = toHex(ok);
    var okLabel = el('span', 'cn-sim-dotlabel', 'Saved');
    okLabel.style.color = toHex(sfg);
    var badDot = el('span', 'cn-sim-dot');
    badDot.style.backgroundColor = toHex(bad);
    var badLabel = el('span', 'cn-sim-dotlabel', 'Failed');
    badLabel.style.color = toHex(sfg);
    dots.appendChild(okDot);
    dots.appendChild(okLabel);
    dots.appendChild(badDot);
    dots.appendChild(badLabel);
    stage.appendChild(dots);
    card.appendChild(stage);

    var r = wcagRatio(sfg, sbg);
    card.appendChild(el('p', 'cn-sim-ratio', fixed(r, 2) + ':1  ·  ' +
      toHex(sfg) + ' on ' + toHex(sbg)));
    card.appendChild(el('p', 'cn-sim-basis', model.basis));
    return card;
  }

  function renderSims(fg, bg) {
    simsEl.textContent = '';
    for (var i = 0; i < VISION.length; i++) {
      simsEl.appendChild(simCard(VISION[i], fg, bg));
    }
  }

  /* ------------------------------------------------------- palette matrix */

  var PALETTE_MAX = 14;

  function splitColors(text) {
    var toks = [], depth = 0, cur = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth <= 0 && (ch === ',' || ch === ';' || ch === '\n' ||
                         ch === '\r' || ch === '\t' || ch === ' ')) {
        toks.push(cur); cur = ''; continue;
      }
      cur += ch;
    }
    toks.push(cur);
    var list = [];
    for (var j = 0; j < toks.length; j++) {
      var t = toks[j].replace(/^\s+|\s+$/g, '');
      if (t) list.push(t);
    }
    return list;
  }

  function gradeCell(ratio) {
    if (ratio >= 7) return { cls: 'is-aaa', tag: 'AAA' };
    if (ratio >= 4.5) return { cls: 'is-aa', tag: 'AA' };
    if (ratio >= 3) return { cls: 'is-large', tag: 'large only' };
    return { cls: 'is-fail', tag: 'fail' };
  }

  function renderPalette() {
    paletteOutEl.textContent = '';
    var tokens = splitColors(paletteEl.value || '');
    if (!tokens.length) {
      paletteOutEl.appendChild(el('p', 'cn-block-note',
        'Nothing pasted yet. Put a few colours in the box above — one per line, ' +
        'or separated by commas — and every pairing gets checked.'));
      return;
    }

    var colors = [], bad = [];
    for (var i = 0; i < tokens.length && colors.length < PALETTE_MAX; i++) {
      var c = parseColor(tokens[i]);
      if (c) colors.push({ input: tokens[i], rgb: c });
      else bad.push(tokens[i]);
    }

    if (bad.length) {
      paletteOutEl.appendChild(el('p', 'cn-block-note cn-block-warn',
        'Could not read ' + bad.length + ' of these: ' + bad.join(', ') +
        '. Hex, rgb(), hsl() and oklch() are understood; most colour names are not.'));
    }
    if (tokens.length > PALETTE_MAX) {
      paletteOutEl.appendChild(el('p', 'cn-block-note cn-block-warn',
        'Only the first ' + PALETTE_MAX + ' colours are shown. A matrix wider than ' +
        'that stops being readable, which defeats the point of it.'));
    }
    if (colors.length < 2) {
      paletteOutEl.appendChild(el('p', 'cn-block-note',
        'At least two readable colours are needed before there is a pairing to check.'));
      return;
    }

    var wrap = el('div', 'cn-tablewrap');
    var table = el('table', 'cn-matrix');
    /* Short on purpose. A <caption> takes the table's width, and the table is
       inside a horizontal scroller, so a long caption would scroll sideways
       away from the reader on a phone. The explanation lives in the paragraph
       under the table, which is a normal block at the container's width. */
    var caption = el('caption', null,
      'Every pairing of ' + colors.length + ' colours, as a WCAG 2.x ratio.');
    table.appendChild(caption);

    var thead = el('thead');
    var hrow = el('tr');
    hrow.appendChild(el('th', 'cn-matrix-corner', 'on →'));
    var k;
    for (k = 0; k < colors.length; k++) {
      var th = el('th');
      th.scope = 'col';
      var sw = el('span', 'cn-matrix-swatch');
      sw.style.backgroundColor = toHex(colors[k].rgb);
      th.appendChild(sw);
      th.appendChild(el('span', 'cn-matrix-label', toHex(colors[k].rgb)));
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    for (var row = 0; row < colors.length; row++) {
      var tr = el('tr');
      var rowTh = el('th');
      rowTh.scope = 'row';
      var rsw = el('span', 'cn-matrix-swatch');
      rsw.style.backgroundColor = toHex(colors[row].rgb);
      rowTh.appendChild(rsw);
      rowTh.appendChild(el('span', 'cn-matrix-label', toHex(colors[row].rgb)));
      tr.appendChild(rowTh);
      for (var cell = 0; cell < colors.length; cell++) {
        var td = el('td');
        if (row === cell) {
          td.className = 'is-self';
          td.textContent = '—';
          td.setAttribute('aria-label', 'same colour, no contrast');
        } else {
          var ratio = wcagRatio(colors[row].rgb, colors[cell].rgb);
          var grade = gradeCell(ratio);
          td.className = grade.cls;
          td.appendChild(el('span', 'cn-matrix-ratio', fixed(ratio, 2)));
          td.appendChild(el('span', 'cn-matrix-tag', grade.tag));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    paletteOutEl.appendChild(wrap);
    paletteOutEl.appendChild(el('p', 'cn-block-note',
      'AAA is 7:1, AA is 4.5:1, and 3:1 carries large text and UI components ' +
      'only. Read a row as the text colour and a column as what it sits on — ' +
      'though the matrix is symmetric, because the WCAG formula does not care ' +
      'which of the two is the text. That is one of the things APCA changes.'));
  }

  /* ---------------------------------------------------------- the main run */

  function readField(field, note) {
    var parsed = parseColor(field.value);
    if (!parsed) {
      setNote(note, 'Not a colour I can read', 'is-err');
      return null;
    }
    var alpha = parsed.a === undefined ? 1 : parsed.a;
    if (alpha >= 1) {
      setNote(note, '', '');
      return { rgb: parsed, alpha: 1 };
    }
    return { rgb: parsed, alpha: alpha };
  }

  function composite(over, under) {
    return {
      r: Math.round(over.rgb.r * over.alpha + under.r * (1 - over.alpha)),
      g: Math.round(over.rgb.g * over.alpha + under.g * (1 - over.alpha)),
      b: Math.round(over.rgb.b * over.alpha + under.b * (1 - over.alpha))
    };
  }

  function recompute() {
    var fgRead = readField(fgField, fgNote);
    var bgRead = readField(bgField, bgNote);

    if (!fgRead || !bgRead) {
      out.clear();
      out.err('One of the two colours could not be read.');
      out.line('');
      out.dim('Understood forms:');
      out.dim('  #abc   #aabbcc   #aabbccff');
      out.dim('  rgb(107 124 148)   rgb(107, 124, 148)   rgb(42% 49% 58%)');
      out.dim('  hsl(214 16% 50%)');
      out.dim('  oklch(0.55 0.03 250)');
      out.dim('  a short list of names: black, white, red, teal, orange');
      out.line('');
      out.dim('Anything else is refused rather than guessed at. A checker that');
      out.dim('quietly turns an unreadable value into black would hand you a');
      out.dim('number for a colour you never used.');
      verdictEl.textContent = '';
      verdictEl.appendChild(el('p', 'cn-block-note',
        'No result — one of the two colours could not be read. The output pane ' +
        'lists every form this field accepts.'));
      fixEl.textContent = '';
      simsEl.textContent = '';
      statusEl.textContent = 'Colour not understood';
      statusEl.className = 'lab-status is-err';
      announceError('No result. One of the two colours could not be read.');
      return;
    }

    var bg = bgRead.rgb;
    if (bgRead.alpha < 1) {
      setNote(bgNote, 'Alpha ignored — see the output', 'is-busy');
    }
    var fg = fgRead.alpha < 1
      ? composite(fgRead, bg)
      : { r: fgRead.rgb.r, g: fgRead.rgb.g, b: fgRead.rgb.b };

    state.fg = fg;
    state.bg = bg;

    fgPick.value = toHex(fgRead.rgb);
    bgPick.value = toHex(bg);

    var ratio = wcagRatio(fg, bg);
    paintPreview(fg, bg);
    renderVerdicts(ratio);
    renderDerivation(fg, bg, ratio);
    renderFix(fg, bg, ratio);
    renderSims(fg, bg);

    if (fgRead.alpha < 1) {
      out.line('');
      out.warn('The foreground carries alpha ' + fixed(fgRead.alpha, 2) + '. It was');
      out.warn('composited over the background first, because a translucent');
      out.warn('colour has no contrast ratio of its own.');
    }
    if (bgRead.alpha < 1) {
      out.line('');
      out.warn('The background carries alpha ' + fixed(bgRead.alpha, 2) + ', which was');
      out.warn('ignored. What sits behind it decides the real ratio, and this');
      out.warn('page cannot know that. Composite it yourself and paste the result.');
    }

    statusEl.textContent = fixed(ratio, 2) + ':1';
    statusEl.className = 'lab-status ' + (ratio >= 4.5 ? 'is-ok' : (ratio >= 3 ? 'is-busy' : 'is-err'));
    announceVerdict(ratio);
  }

  /* Colour inputs fire on every drag of the picker, and a full re-render on
     each one makes the picker feel like it is fighting you. One frame's worth
     of coalescing is enough to fix that without introducing a visible lag.

     The palette box gets its OWN timer rather than sharing this one. They had
     shared it, and the two are completely independent inputs: typing a colour
     into the pair fields cancelled a pending palette rebuild and vice versa,
     so whichever box you touched second silently swallowed the other's update. */
  var pairTimer = null;
  function schedule() {
    if (pairTimer) clearTimeout(pairTimer);
    pairTimer = setTimeout(function () { pairTimer = null; recompute(); }, 60);
  }

  var paletteTimer = null;
  function schedulePalette() {
    if (paletteTimer) clearTimeout(paletteTimer);
    paletteTimer = setTimeout(function () { paletteTimer = null; renderPalette(); }, 200);
  }

  function swap() {
    var a = fgField.value;
    fgField.value = bgField.value;
    bgField.value = a;
    recompute();
  }

  var SITE_PALETTE = '#f8fafc\n#e2e8f0\n#cbd5e1\n#94a3b8\n#7dd3fc\n#38bdf8\n' +
                     '#121b2c\n#182439\n#0f172a\n#020617';

  /* ----------------------------------------------------------- self-check */

  /* The claims worth asserting are the ones with a single right answer, so
     that is all this checks. Black on white is 21:1 by definition; a colour
     against itself is 1:1; white has luminance 1 and black 0; the WCAG formula
     is symmetric; APCA is signed by polarity and zero when there is nothing to
     see; and OKLCH must round-trip a colour back to the same bytes, because
     every suggested fix is a trip through that space and back.

     It does NOT assert an APCA figure against a published vector. I have not
     checked this implementation against the reference suite line by line, and
     printing a green tick for something I only eyeballed would be worse than
     printing nothing. The page says as much next to the number. */
  function selfTest() {
    var checks = [], failed = 0;
    function ok(name, pass) {
      checks.push({ name: name, pass: !!pass });
      if (!pass) failed++;
    }
    var white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 };
    ok('black on white is 21:1', Math.abs(wcagRatio(black, white) - 21) < 1e-9);
    ok('white luminance is 1', Math.abs(luminance(white) - 1) < 1e-9);
    ok('black luminance is 0', Math.abs(luminance(black)) < 1e-12);
    var mid = { r: 119, g: 119, b: 119 };
    ok('a colour against itself is 1:1', Math.abs(wcagRatio(mid, mid) - 1) < 1e-12);
    ok('the ratio is symmetric',
       Math.abs(wcagRatio(mid, white) - wcagRatio(white, mid)) < 1e-12);
    ok('APCA is zero on no difference', apcaLc(mid, mid) === 0);
    ok('APCA is positive for dark text on light', apcaLc(black, white) > 0);
    ok('APCA is negative for light text on dark', apcaLc(white, black) < 0);

    var samples = ['#6b7c94', '#020617', '#7dd3fc', '#dc2626', '#f8fafc', '#182439'];
    var trips = 0;
    for (var i = 0; i < samples.length; i++) {
      var c = parseColor(samples[i]);
      var lch = srgbToOklch(c);
      var back = oklchToSrgb(lch.l, lch.c, lch.h).rgb;
      if (toHex(back) === toHex(c)) trips++;
    }
    ok('OKLCH round-trips ' + samples.length + ' colours', trips === samples.length);
    return { checks: checks, failed: failed, passed: checks.length - failed };
  }

  /* Exposed so the arithmetic can be checked without trusting the page around
     it: open the console and call ContrastMath.ratio('#6b7c94', '#020617'). */
  root.ContrastMath = {
    parse: parseColor,
    luminance: function (x) { var c = parseColor(x); return c ? luminance(c) : null; },
    ratio: function (a, b) {
      var x = parseColor(a), y = parseColor(b);
      return x && y ? wcagRatio(x, y) : null;
    },
    apca: function (text, bg) {
      var x = parseColor(text), y = parseColor(bg);
      return x && y ? apcaLc(x, y) : null;
    },
    oklch: function (x) { var c = parseColor(x); return c ? srgbToOklch(c) : null; },
    fix: function (moving, other, target) {
      var m = parseColor(moving), o = parseColor(other);
      if (!m || !o) return null;
      var found = smallestFix(m, o, target || 4.5);
      if (!found) return null;
      return { hex: toHex(found.rgb), ratio: found.ratio, dL: found.dL, chroma: found.chroma };
    },
    simulate: function (x, key) {
      var c = parseColor(x);
      if (!c) return null;
      for (var i = 0; i < VISION.length; i++) {
        if (VISION[i].key === key) return toHex(simulate(c, VISION[i]));
      }
      return null;
    },
    selfTest: selfTest
  };

  LabTool.define({
    id: 'contrasttool',
    run: recompute,
    onReady: function () {
      fgPick = document.getElementById('tool-fgpick');
      bgPick = document.getElementById('tool-bgpick');
      fgField = document.getElementById('tool-fg');
      bgField = document.getElementById('tool-bg');
      fgNote = document.getElementById('tool-fgnote');
      bgNote = document.getElementById('tool-bgnote');
      targetSel = document.getElementById('tool-target');
      statusEl = document.getElementById('tool-ratio');
      previewEl = document.getElementById('cn-preview');
      verdictEl = document.getElementById('cn-verdicts');
      fixEl = document.getElementById('cn-fix');
      simsEl = document.getElementById('cn-sims');
      paletteEl = document.getElementById('cn-palette');
      paletteOutEl = document.getElementById('cn-paletteout');
      announceEl = document.getElementById('cn-announce');
      sampleNormal = document.getElementById('cn-sample-normal');
      sampleLarge = document.getElementById('cn-sample-large');
      sampleMuted = document.getElementById('cn-sample-muted');
      sampleUi = document.getElementById('cn-sample-ui');

      fgField.addEventListener('input', schedule);
      bgField.addEventListener('input', schedule);
      fgPick.addEventListener('input', function () {
        fgField.value = fgPick.value; schedule();
      });
      bgPick.addEventListener('input', function () {
        bgField.value = bgPick.value; schedule();
      });
      targetSel.addEventListener('change', function () {
        if (state.fg && state.bg) renderFix(state.fg, state.bg, wcagRatio(state.fg, state.bg));
      });
      document.getElementById('tool-swap').addEventListener('click', swap);

      /* Delegated, because renderFix destroys and rebuilds these buttons on
         every recompute — including the recompute this handler triggers.

         Which is also why focus has to be moved deliberately. Pressing "Use
         this colour" with the keyboard replaced the button's own panel out
         from under it, so focus fell back to <body> and a keyboard user was
         returned to the top of the document with no idea what had happened.
         Focus lands on the field that changed instead: it holds the new value,
         so the change is both visible and readable where the focus now is. */
      fixEl.addEventListener('click', function (event) {
        var btn = event.target;
        if (!btn || !btn.getAttribute) return;
        var which = btn.getAttribute('data-apply');
        if (!which) return;
        var field = which === 'fg' ? fgField : bgField;
        field.value = btn.getAttribute('data-hex');
        recompute();
        field.focus();
      });

      document.getElementById('cn-palette-run').addEventListener('click', renderPalette);
      document.getElementById('cn-palette-site').addEventListener('click', function () {
        paletteEl.value = SITE_PALETTE;
        renderPalette();
      });
      paletteEl.addEventListener('input', schedulePalette);

      var chip = document.getElementById('tool-selftest');
      if (chip) {
        var result = selfTest();
        chip.textContent = result.failed
          ? result.failed + ' of ' + result.checks.length + ' self-checks FAILED'
          : result.passed + ' self-checks pass';
        chip.className = 'lab-status ' + (result.failed ? 'is-err' : 'is-ok');
      }

      renderPalette();
      recompute();
    }
  });
})(typeof self !== 'undefined' ? self : this);

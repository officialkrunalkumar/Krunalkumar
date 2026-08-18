/* ==========================================================================
   processor.js — CPU Explorer: fly down into a chip, level after level.
   --------------------------------------------------------------------------
   The opening titles of the film Blackhat (2015) plunge the camera down into a
   processor and let you watch signals pulse along the structures as the scale
   drops away — package, die, core, and on down until it is just electrons in a
   switch. This toy is that descent made real and, more importantly, made
   correct: six semantic zoom levels, each labelled, each showing data actually
   moving, so a visitor leaves knowing the real hierarchy rather than just a
   pretty light show.

       Package  →  Die  →  Core  →  Execution unit  →  Logic gate  →  Transistor

   The non-obvious decisions, because they shape the whole file:

   1. SEMANTIC ZOOM, not a magnifying glass. One continuous value `z` in [0,5]
      drives everything. Zooming in does not simply enlarge the same picture —
      as z crosses each integer the scene is REPLACED by the next level of the
      hierarchy. Zoom past the die and you are no longer looking at a bigger die,
      you are looking at one core's pipeline; past that, one adder; past that,
      one gate; past that, one MOSFET. That is what "Google Maps for a CPU"
      means: the map changes meaning as you descend.

   2. CROSS-FADE so the descent flies rather than flips. Around each threshold
      the outgoing level scales up and fades out while the incoming level grows
      from small and fades in (see outgoing()/incoming()). Because the incoming
      level emerges from the centre — exactly where the sub-part you are diving
      into sits — it reads as flying INTO the chip, not as slides advancing.

   3. CANVAS-2D, deliberately. Every level is labelled engineering diagram plus
      animated pulses. 2D keeps text crisp, the labels legible, and the whole
      thing readable on a phone; WebGL would buy nothing here but complexity.
      The pulses are the only motion, drawn as glowing dots walking along wire
      polylines — cheap, and they carry the Blackhat feeling on their own.

   4. REDUCED MOTION is honoured by CALMING, not freezing. Someone with
      prefers-reduced-motion still gets every level fully drawn and still sees
      the structure; the pulse speed and the input-toggle rate are simply turned
      right down so nothing strobes or races. The descent easing is gentle for
      everyone.

   5. HIGH-DPI aware, capped at 2× — a 3× phone would quadruple fill cost for no
      visible gain. The rAF loop runs through LabViz.raf (so it self-parks when
      the tab is hidden) and is cancellable; dt is clamped so returning to a
      backgrounded tab does not fast-forward the animation.

   No network, no eval, no new Function. Everything on screen is drawn from
   arithmetic in this tab — the whole Labs promise. ES5 in an IIFE throughout.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var FONT = '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace';

  /* Virtual drawing space. Every scene draws inside a 1000×640 box; a single
     fit-scale maps that box onto whatever size the canvas actually is, so the
     scenes never need to know the pixel dimensions. */
  var VW = 1000, VH = 640;

  /* ---- palette (kept close to the other Labs canvases) ------------------- */
  var C = {
    bg0: '#020610',
    bg1: '#060d1c',
    ink: '#dce6f5',
    dim: '#7f95b4',
    faint: '#4a5b78',
    line: '#24344e',
    cyan: '#7dd3fc',
    cyanDim: '#2b6c9e',
    amber: '#fbbf24',
    green: '#4ade80',
    red: '#fb7185',
    violet: '#c084fc',
    orange: '#fb923c',
    silicon: '#0a1a2e',
    metal: '#586274',
    metalHi: '#79879d'
  };

  /* The six levels. `blurb` is the one-line "what am I looking at" readout. */
  var LEVELS = [
    { key: 'package', crumb: 'Package', title: 'Package',
      blurb: 'The finished chip as it sits on a board: a silicon die sealed under a metal lid, wired out through hundreds of pins to power and to memory.' },
    { key: 'die', crumb: 'Die', title: 'Silicon die',
      blurb: 'Under the lid: one slab of silicon partitioned into cores, a shared cache, memory and I/O controllers, all stitched together by a ring bus.' },
    { key: 'core', crumb: 'Core', title: 'CPU core — the pipeline',
      blurb: 'One core, unrolled: instructions flow left to right through fetch, decode, rename, dispatch, execute and writeback — an assembly line for computation.' },
    { key: 'exec', crumb: 'Execution', title: 'Execution unit — the ALU',
      blurb: 'Inside "execute": an arithmetic logic unit. This 8-bit ripple-carry adder sums two operand buses, the carry rippling bit by bit from LSB to MSB.' },
    { key: 'gate', crumb: 'Gate', title: 'Logic gate — CMOS NAND',
      blurb: 'Every adder is built from logic gates. Here one NAND, shown as its symbol and its transistor schematic at once, its output tracking the truth table live.' },
    { key: 'transistor', crumb: 'Transistor', title: 'Transistor — one MOSFET',
      blurb: 'The bottom of it all: a single switch. Raise the gate and a channel forms so electrons flow source→drain; drop it and the channel pinches shut. Just a switch.' }
  ];
  var MAXZ = LEVELS.length - 1;

  /* ---- module state ------------------------------------------------------ */
  var root, canvas, ctx;
  var elCrumb, elTitle, elBlurb, elSlider, elPlay, railItems = [];
  var W = 0, H = 0, dpr = 1, fit = 1;
  var z = 0, zTarget = 0;          // continuous zoom position and its glide target
  var flow = 0;                    // seconds of accumulated data-flow animation
  var playing = true;
  var reduced = false;
  var rafHandle = null;
  var lastTs = 0;
  var lastLevelIdx = -1;
  var sliderActive = false;
  var built = false;

  /* ---- tiny helpers ------------------------------------------------------ */
  function raf(fn) {
    if (window.LabViz && LabViz.raf) return LabViz.raf(fn);
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return window.setTimeout(function () { fn(Date.now()); }, 16);
  }
  function cancelRaf(h) {
    if (h == null) return;
    if (window.LabViz && LabViz.cancelRaf) { LabViz.cancelRaf(h); return; }
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(h);
    else window.clearTimeout(h);
  }
  function E(tag, cls, text) {
    if (window.LabViz && LabViz.el) return LabViz.el(tag, cls, text);
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

  /* Walk a polyline and return the point at fraction t (0..1) of its length.
     Used to march glowing pulses along every wire. */
  function pointAt(pts, t) {
    var n = pts.length, i, dx, dy, d, total = 0, seg = [];
    if (n === 1) return { x: pts[0][0], y: pts[0][1] };
    for (i = 0; i < n - 1; i++) {
      dx = pts[i + 1][0] - pts[i][0]; dy = pts[i + 1][1] - pts[i][1];
      d = Math.sqrt(dx * dx + dy * dy); seg.push(d); total += d;
    }
    var target = t * total, acc = 0, f;
    for (i = 0; i < n - 1; i++) {
      if (acc + seg[i] >= target) {
        f = seg[i] === 0 ? 0 : (target - acc) / seg[i];
        return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
                 y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f };
      }
      acc += seg[i];
    }
    return { x: pts[n - 1][0], y: pts[n - 1][1] };
  }

  /* ---- drawing primitives (all in virtual coords) ------------------------ */
  function rrpath(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function box(x, y, w, h, r, fill, stroke, lw) {
    rrpath(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw || 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function txt(s, x, y, size, color, align, weight) {
    ctx.font = (weight || '400') + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  }
  function wire(pts, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width || 2;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  function leader(x1, y1, x2, y2, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.fillStyle = color; ctx.arc(x1, y1, 2.5, 0, TAU); ctx.fill();
  }

  /* March `count` glowing pulses along a polyline. Speed is scaled down under
     reduced motion. The glow is a canvas shadow, set once for the whole batch
     so it stays cheap. */
  function pulses(pts, color, count, speed, radius) {
    var i, t, p, s = reduced ? speed * 0.35 : speed;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = radius * 2.6;
    ctx.fillStyle = color;
    for (i = 0; i < count; i++) {
      t = ((flow * s) + i / count) % 1; if (t < 0) t += 1;
      p = pointAt(pts, t);
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  /* A labelled functional block: filled rounded rect + centred name + sub. */
  function unit(x, y, w, h, name, sub, fill, stroke, nameCol) {
    box(x, y, w, h, 7, fill, stroke, 1.5);
    ctx.textAlign = 'center';
    txt(name, x + w / 2, y + h / 2 + (sub ? -2 : 5), Math.min(17, h * 0.34), nameCol || C.ink, 'center', '600');
    if (sub) txt(sub, x + w / 2, y + h / 2 + 16, 11, C.dim, 'center', '400');
    ctx.textAlign = 'left';
  }

  /* ====================================================================== */
  /*  LEVEL 0 — PACKAGE                                                      */
  /* ====================================================================== */
  function scenePackage() {
    // memory off to both sides, buses pulsing in and out
    var i;
    var ramCols = [[40, 150], [40, 360]];
    for (i = 0; i < ramCols.length; i++) {
      box(ramCols[i][0], ramCols[i][1], 90, 140, 5, '#101d16', '#2a4d3a', 1.5);
      ctx.textAlign = 'center';
      txt('DDR5', ramCols[i][0] + 45, ramCols[i][1] + 66, 13, C.green, 'center', '600');
      txt('DRAM', ramCols[i][0] + 45, ramCols[i][1] + 84, 11, C.dim, 'center');
      ctx.textAlign = 'left';
    }

    // substrate (the green PCB the die is mounted on)
    box(250, 90, 500, 460, 16, '#0e2a22', '#1f5a48', 2);
    // faint hint of the ball grid array underneath (pins are on the far side)
    ctx.globalAlpha *= 0.5;
    for (var gx = 0; gx < 9; gx++) {
      for (var gy = 0; gy < 8; gy++) {
        ctx.beginPath();
        ctx.fillStyle = '#123a2e';
        ctx.arc(292 + gx * 52, 132 + gy * 52, 6, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha /= 0.5;

    // integrated heat spreader (the metal lid), with an etched part marking
    var g = ctx.createLinearGradient(300, 140, 700, 500);
    g.addColorStop(0, '#40485a'); g.addColorStop(0.5, '#59637a'); g.addColorStop(1, '#3a4152');
    box(300, 140, 400, 360, 12, null, '#20262f', 2);
    ctx.save(); rrpath(300, 140, 400, 360, 12); ctx.clip();
    ctx.fillStyle = g; ctx.fillRect(300, 140, 400, 360);
    // etched brushed lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (i = 0; i < 22; i++) { ctx.beginPath(); ctx.moveTo(300, 150 + i * 16); ctx.lineTo(700, 150 + i * 16); ctx.stroke(); }
    ctx.restore();
    ctx.textAlign = 'center';
    txt('PYXIS-9', 500, 305, 44, 'rgba(255,255,255,0.72)', 'center', '700');
    txt('OCTA-CORE  ·  5 nm', 500, 335, 15, 'rgba(255,255,255,0.5)', 'center', '500');
    txt('SR-K9  ·  ∆ MALAYSIA', 500, 356, 11, 'rgba(255,255,255,0.34)', 'center');
    ctx.textAlign = 'left';

    // pin-1 orientation triangle
    ctx.beginPath(); ctx.fillStyle = C.amber;
    ctx.moveTo(270, 110); ctx.lineTo(292, 110); ctx.lineTo(270, 132); ctx.closePath(); ctx.fill();

    // memory buses: substrate edge ⇄ DRAM, packets both directions
    var busL = [[250, 210], [180, 210], [180, 220], [130, 220]];
    var busR = [[750, 300], [820, 300]];
    wire(busL, C.cyanDim, 3); wire([[250, 430], [180, 430], [180, 430], [135, 430]], C.cyanDim, 3);
    pulses([[130, 220], [180, 220], [180, 210], [250, 210]], C.cyan, 4, 0.35, 4);
    pulses([[250, 430], [180, 430], [130, 430]], C.amber, 3, 0.28, 4);

    // labels with leaders
    leader(500, 160, 640, 96, C.cyan);
    txt('Integrated heat spreader (lid)', 646, 96, 13, C.cyan, 'left', '600');
    leader(360, 520, 300, 566, C.green);
    txt('Package substrate', 300, 580, 13, C.green, 'left', '600');
    leader(500, 305, 470, 600, C.dim);
    txt('Etched part marking', 300, 612, 12, C.dim, 'left');
    leader(320, 132, 210, 500, C.faint);
    txt('Ball grid array (BGA) underneath — power + I/O pins', 210, 512, 11, C.faint, 'left');
    leader(160, 215, 90, 130, C.cyan);
    txt('Memory bus ⇄ DRAM', 40, 120, 12, C.cyan, 'left', '600');
  }

  /* ====================================================================== */
  /*  LEVEL 1 — DIE                                                          */
  /* ====================================================================== */
  var RING = [ // ring-bus loop threaded around the die blocks (closed path)
    [200, 110], [560, 110], [560, 130], [600, 130],
    [790, 130], [790, 540], [600, 540], [560, 540],
    [560, 560], [200, 560], [200, 110]
  ];
  function sceneDie() {
    var i, j;
    // die substrate
    box(160, 70, 680, 510, 10, C.silicon, '#28518c', 2);
    ctx.textAlign = 'center';
    txt('SILICON DIE', 500, 60, 12, C.faint, 'center', '600');
    ctx.textAlign = 'left';

    // ring bus (the interconnect) with packets orbiting it
    wire(RING, '#294a72', 6);
    pulses(RING, C.cyan, 7, 0.22, 4.5);
    pulses(RING, C.violet, 5, 0.16, 3.5);

    // eight cores, two columns of four on the left
    var coreX = [190, 320], coreY = [120, 225, 330, 435];
    var n = 0;
    for (j = 0; j < 4; j++) {
      for (i = 0; i < 2; i++) {
        unit(coreX[i], coreY[j], 120, 92, 'Core ' + n, null, '#12233b', '#3f74c0', C.cyan);
        // little branch from each core into the shared cache
        pulses([[coreX[i] + 120, coreY[j] + 46], [470, coreY[j] + 46]], C.cyan, 2, 0.4, 3);
        n++;
      }
    }
    // shared L3 cache down the middle
    unit(460, 120, 90, 407, 'L3', 'shared cache', '#1a1330', '#7a5bd0', C.violet);

    // right-hand blocks: iGPU, memory controller, system agent / I-O
    unit(600, 120, 210, 120, 'Integrated GPU', 'graphics', '#101f2a', '#3f74c0', C.cyan);
    unit(600, 255, 210, 120, 'Memory controller', 'to DRAM', '#221a10', '#c08a3f', C.amber);
    unit(600, 390, 210, 137, 'System agent / I-O', 'PCIe · display', '#101a24', '#3f74c0', C.cyan);

    // cache ⇄ memory-controller traffic, the busy path in a real chip
    pulses([[550, 320], [600, 320]], C.amber, 3, 0.3, 3.5);

    ctx.textAlign = 'center';
    txt('Ring bus — every block is one stop on the loop', 500, 600, 12, C.dim, 'center');
    ctx.textAlign = 'left';
  }

  /* ====================================================================== */
  /*  LEVEL 2 — CORE (the pipeline)                                          */
  /* ====================================================================== */
  var STAGES = ['Fetch', 'Decode', 'Rename', 'Dispatch', 'Execute', 'Writeback'];
  function sceneCore() {
    var i;
    var sx = 40, sw = 150, gap = 4, sy = 250, sh = 150;
    var centers = [];
    // the six pipeline stages, left → right
    for (i = 0; i < STAGES.length; i++) {
      var x = sx + i * (sw + gap);
      var isExec = (i === 4);
      box(x, sy, sw, sh, 8, isExec ? '#141f16' : '#101a2b', isExec ? '#3f7d4e' : '#33517d', 1.5);
      ctx.textAlign = 'center';
      txt('STAGE ' + (i + 1), x + sw / 2, sy - 12, 10, C.faint, 'center', '600');
      txt(STAGES[i], x + sw / 2, sy + 26, 16, isExec ? C.green : C.cyan, 'center', '600');
      ctx.textAlign = 'left';
      centers.push([x + sw / 2, sy + sh / 2]);
      // arrow to the next stage
      if (i < STAGES.length - 1) {
        var ax = x + sw, ay = sy + sh / 2;
        wire([[ax, ay], [ax + gap, ay]], C.faint, 2);
      }
    }
    // execute unit's internals
    var ex = sx + 4 * (sw + gap);
    unit(ex + 12, sy + 44, sw - 24, 28, 'ALU', null, '#16261a', '#3f7d4e', C.green);
    unit(ex + 12, sy + 78, sw - 24, 28, 'FPU', null, '#16261a', '#3f7d4e', C.green);
    unit(ex + 12, sy + 112, sw - 24, 28, 'Load / Store', null, '#16261a', '#3f7d4e', C.green);

    // supporting structures above and below the line
    unit(sx, 90, 300, 80, 'Instruction cache (L1-I)', 'feeds Fetch', '#0f1a2b', '#33517d', C.cyan);
    unit(sx + 320, 90, 300, 80, 'Register file', 'operands ↔ Rename/Writeback', '#1a1330', '#7a5bd0', C.violet);
    unit(sx + 640, 90, 260, 80, 'L2 cache', 'backs L1', '#221a10', '#c08a3f', C.amber);
    unit(sx + 640, sy, 260, sh, 'Data cache (L1-D)', 'Load / Store target', '#0f1a2b', '#33517d', C.cyan);

    // instruction packets flowing through the pipeline, each labelled with the
    // stage it is currently in. Two are in flight, offset so they occupy
    // different stages at any moment.
    var flowPath = [];
    for (i = 0; i < centers.length; i++) flowPath.push(centers[i]);
    var tokens = [
      { off: 0.0, col: C.amber, op: 'ADD' },
      { off: 0.42, col: C.cyan, op: 'LD' },
      { off: 0.72, col: C.red, op: 'MUL' }
    ];
    var s = reduced ? 0.06 : 0.12;
    for (i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      var t = ((flow * s) + tk.off) % 1; if (t < 0) t += 1;
      var p = pointAt(flowPath, t);
      var stageIdx = clamp(Math.floor(t * STAGES.length + 0.0001), 0, STAGES.length - 1);
      // glowing instruction token
      ctx.save();
      ctx.shadowColor = tk.col; ctx.shadowBlur = 14;
      box(p.x - 26, p.y - 16, 52, 32, 7, tk.col, null, 0);
      ctx.restore();
      txt(tk.op, p.x, p.y + 5, 14, '#0b1220', 'center', '700');
      // caption: which stage it is in right now
      txt('in ' + STAGES[stageIdx], p.x, p.y + 34, 11, tk.col, 'center', '600');
    }
    ctx.textAlign = 'left';
  }

  /* ====================================================================== */
  /*  LEVEL 3 — EXECUTION (an 8-bit ripple-carry adder)                     */
  /* ====================================================================== */
  function sceneExec() {
    var i;
    var bits = 8, cw = 96, gap = 8, y = 250, h = 120;
    var totalW = bits * cw + (bits - 1) * gap;
    var x0 = (VW - totalW) / 2;

    ctx.textAlign = 'center';
    txt('8-BIT RIPPLE-CARRY ADDER', VW / 2, 120, 15, C.green, 'center', '700');
    txt('one full-adder per bit; carry ripples right → left', VW / 2, 142, 12, C.dim, 'center');
    ctx.textAlign = 'left';

    // operand buses A and B feeding down into each full-adder from the top
    txt('Operand A [7:0]', x0, 178, 12, C.cyan, 'left', '600');
    txt('Operand B [7:0]', x0, 200, 12, C.amber, 'left', '600');
    wire([[x0 - 6, 184], [x0 + totalW, 184]], C.cyanDim, 2);
    wire([[x0 - 6, 206], [x0 + totalW, 206]], '#7a5a1a', 2);

    // the carry chain runs along the bottom, LSB (right) to carry-out (left).
    // A highlight sweeps along it to show the ripple.
    var carryY = y + h + 40;
    var carryPts = [[x0 + totalW, carryY], [x0 - 30, carryY]];
    wire(carryPts, '#5a3a10', 4);
    pulses(carryPts, C.orange, 3, 0.18, 5);

    for (i = 0; i < bits; i++) {
      // bit 7 is leftmost (MSB), bit 0 rightmost (LSB)
      var bitNo = bits - 1 - i;
      var x = x0 + i * (cw + gap);
      unit(x, y, cw, h, 'FA', 'bit ' + bitNo, '#141f16', '#3f7d4e', C.green);
      // A/B taps down into this adder
      pulses([[x + cw * 0.35, 184], [x + cw * 0.35, y]], C.cyan, 1, 0.5, 3);
      pulses([[x + cw * 0.65, 206], [x + cw * 0.65, y]], C.amber, 1, 0.5, 3);
      // sum bit out the bottom onto the result bus
      pulses([[x + cw / 2, y + h], [x + cw / 2, y + h + 18]], C.green, 1, 0.45, 3);
      // carry link into the next (more significant) adder on the left
      if (i < bits - 1) wire([[x, carryY], [x, y + h]], '#5a3a10', 2);
    }

    // result bus
    var ry = y + h + 20;
    wire([[x0, ry], [x0 + totalW, ry]], '#1f5a3a', 3);
    txt('Result S [7:0]', x0, ry + 22, 12, C.green, 'left', '600');
    txt('Carry-out', x0 - 40, carryY - 12, 11, C.orange, 'left', '600');

    // a shifter sits beside the adder — the ALU's other arithmetic path
    unit(x0 + totalW - 210, 430, 210, 70, 'Barrel shifter', 'the ALU\'s other unit', '#101a2b', '#33517d', C.cyan);
    pulses([[x0 + totalW - 210, 465], [x0 + totalW - 240, 465]], C.cyan, 2, 0.3, 3);
  }

  /* ====================================================================== */
  /*  LEVEL 4 — GATE (a CMOS NAND, symbol + transistors + truth table)      */
  /* ====================================================================== */
  function sceneGate() {
    // current input pair, cycling 00 → 01 → 10 → 11 over time
    var period = reduced ? 2.6 : 1.5;
    var n = Math.floor(flow / period) % 4;
    var A = (n >> 1) & 1, B = n & 1;
    var Y = (A && B) ? 0 : 1;   // NAND
    var onCol = C.green, offCol = C.faint;

    ctx.textAlign = 'center';
    txt('LOGIC GATE — CMOS NAND', VW / 2, 70, 15, C.cyan, 'center', '700');
    txt('the "universal" gate: every other gate can be built from NANDs', VW / 2, 92, 12, C.dim, 'center');
    ctx.textAlign = 'left';

    /* ---- (a) the schematic symbol, left ---- */
    var bx = 90, by = 200, bw = 120, bh = 130;
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + bw * 0.5, by);
    ctx.arc(bx + bw * 0.5, by + bh / 2, bh / 2, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(bx, by + bh); ctx.closePath(); ctx.stroke();
    // inversion bubble
    ctx.beginPath(); ctx.arc(bx + bw * 0.5 + bh / 2 + 9, by + bh / 2, 9, 0, TAU); ctx.stroke();
    // input / output leads
    wire([[bx - 60, by + 28], [bx, by + 28]], A ? onCol : offCol, 3);
    wire([[bx - 60, by + bh - 28], [bx, by + bh - 28]], B ? onCol : offCol, 3);
    var outX = bx + bw * 0.5 + bh / 2 + 18;
    wire([[outX, by + bh / 2], [outX + 70, by + bh / 2]], Y ? onCol : offCol, 3);
    txt('A = ' + A, bx - 60, by + 22, 15, A ? onCol : C.dim, 'left', '700');
    txt('B = ' + B, bx - 60, by + bh - 34, 15, B ? onCol : C.dim, 'left', '700');
    txt('Y = ' + Y, outX + 78, by + bh / 2 + 5, 16, Y ? onCol : C.dim, 'left', '700');
    // output "bulb"
    ctx.save(); if (Y) { ctx.shadowColor = onCol; ctx.shadowBlur = 20; }
    ctx.beginPath(); ctx.fillStyle = Y ? onCol : '#1a2436';
    ctx.arc(outX + 130, by + bh / 2, 14, 0, TAU); ctx.fill(); ctx.restore();
    txt('symbol', bx, by + bh + 40, 12, C.faint, 'left', '600');

    /* ---- (b) the CMOS transistor schematic, right ---- */
    var vdd = 170, gnd = 470, node = 620, railL = 470, railR = 760;
    // rails
    wire([[railL, vdd], [railR, vdd]], C.red, 2.5);
    wire([[railL, gnd], [railR, gnd]], C.dim, 2.5);
    txt('Vdd', railR + 6, vdd + 5, 12, C.red, 'left', '600');
    txt('GND', railR + 6, gnd + 5, 12, C.dim, 'left', '600');

    // helper to draw one MOSFET as a small labelled switch box.
    function fet(cx, cy, label, conducting, kind) {
      var col = conducting ? onCol : C.faint;
      box(cx - 26, cy - 20, 52, 40, 6, conducting ? 'rgba(74,222,128,0.12)' : '#0e1626', col, 2);
      txt(label, cx, cy + 5, 13, col, 'center', '700');
      txt(kind, cx, cy - 24, 9, C.faint, 'center');
    }
    ctx.textAlign = 'center';
    // pull-up network: two PMOS in PARALLEL (conduct when their input is 0)
    var p1x = 540, p2x = 640;
    fet(p1x, 230, 'A', A === 0, 'PMOS');
    fet(p2x, 230, 'B', B === 0, 'PMOS');
    wire([[p1x, vdd], [p1x, 210]], C.red, 2); wire([[p2x, vdd], [p2x, 210]], C.red, 2);
    wire([[p1x, 250], [p1x, 300], [node, 300]], Y ? onCol : offCol, 2);
    wire([[p2x, 250], [p2x, 300]], Y ? onCol : offCol, 2);
    // output node
    wire([[node, 300], [node, 330]], Y ? onCol : offCol, 2.5);
    wire([[node, 300], [745, 300]], Y ? onCol : offCol, 2.5);
    txt('Y', 752, 305, 15, Y ? onCol : C.dim, 'left', '700');
    // pull-down network: two NMOS in SERIES (conduct only when both inputs 1)
    fet(node, 360, 'A', A === 1, 'NMOS');
    fet(node, 420, 'B', B === 1, 'NMOS');
    var pullDown = (A === 1 && B === 1);
    wire([[node, 380], [node, 400]], pullDown ? onCol : offCol, 2);
    wire([[node, 440], [node, gnd]], pullDown ? onCol : offCol, 2);
    ctx.textAlign = 'left';
    txt('transistor schematic', railL, gnd + 34, 12, C.faint, 'left', '600');
    txt('pull-up (PMOS ∥) pulls Y high unless BOTH inputs are 1', railL, gnd + 54, 11, C.dim, 'left');
    txt('pull-down (NMOS series) only then pulls Y low', railL, gnd + 72, 11, C.dim, 'left');

    /* ---- (c) truth table, bottom-left, current row lit ---- */
    var rows = [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]];
    var tx = 90, ty = 430, rh = 26, cwid = 46;
    txt('A', tx + 6, ty - 8, 12, C.dim, 'left', '600');
    txt('B', tx + 6 + cwid, ty - 8, 12, C.dim, 'left', '600');
    txt('Y', tx + 6 + 2 * cwid, ty - 8, 12, C.cyan, 'left', '600');
    for (var r = 0; r < 4; r++) {
      var cur = (rows[r][0] === A && rows[r][1] === B);
      if (cur) box(tx - 4, ty + r * rh - 4, 3 * cwid, rh, 4, 'rgba(125,211,252,0.14)', C.cyan, 1);
      txt(String(rows[r][0]), tx + 6, ty + r * rh + 14, 13, cur ? C.ink : C.dim, 'left', cur ? '700' : '400');
      txt(String(rows[r][1]), tx + 6 + cwid, ty + r * rh + 14, 13, cur ? C.ink : C.dim, 'left', cur ? '700' : '400');
      txt(String(rows[r][2]), tx + 6 + 2 * cwid, ty + r * rh + 14, 13, cur ? C.green : C.dim, 'left', cur ? '700' : '400');
    }
    txt('Y = NOT (A AND B)', tx, ty + 4 * rh + 22, 12, C.cyan, 'left', '600');
  }

  /* ====================================================================== */
  /*  LEVEL 5 — TRANSISTOR (one NMOS MOSFET, in cross-section)              */
  /* ====================================================================== */
  function sceneTransistor() {
    // gate toggles ON/OFF over time; when ON a channel forms and electrons flow
    var period = reduced ? 3.0 : 1.9;
    var on = (Math.floor(flow / period) % 2) === 1;

    ctx.textAlign = 'center';
    txt('MOSFET — one transistor, one switch', VW / 2, 70, 15, C.cyan, 'center', '700');
    ctx.textAlign = 'left';

    // p-type substrate (the body)
    box(180, 300, 640, 250, 6, '#241a33', '#4a3a63', 2);
    txt('p-type silicon substrate (Body)', 200, 530, 12, C.violet, 'left', '600');

    // n+ source and drain wells
    box(250, 268, 150, 90, 5, '#123a5c', '#2f79c0', 1.5);
    box(600, 268, 150, 90, 5, '#123a5c', '#2f79c0', 1.5);
    ctx.textAlign = 'center';
    txt('n+', 325, 320, 16, C.cyan, 'center', '700');
    txt('n+', 675, 320, 16, C.cyan, 'center', '700');
    ctx.textAlign = 'left';

    // gate oxide (thin insulator) + gate electrode on top
    box(400, 256, 200, 12, 2, '#c9b45a', '#8a7a2a', 1);        // oxide
    box(400, 214, 200, 42, 4, on ? '#6f7d95' : '#3c4557', '#20262f', 2); // gate metal
    ctx.textAlign = 'center';
    txt('Gate', 500, 240, 15, on ? C.ink : C.dim, 'center', '700');
    ctx.textAlign = 'left';

    // terminal leads and labels
    wire([[325, 268], [325, 170]], C.cyan, 3); txt('Source', 300, 158, 13, C.cyan, 'left', '600');
    wire([[675, 268], [675, 170]], C.cyan, 3); txt('Drain', 655, 158, 13, C.cyan, 'left', '600');
    wire([[500, 214], [500, 150]], on ? C.green : C.dim, 3);
    txt('Gate  Vg = ' + (on ? 'HIGH' : 'LOW'), 430, 138, 13, on ? C.green : C.dim, 'left', '700');
    wire([[500, 550], [500, 590]], C.violet, 3); txt('Body', 476, 610, 12, C.violet, 'left', '600');

    // the channel region under the oxide, between source and drain
    var chY = 288, chL = 400, chR = 600;
    if (on) {
      // inversion layer: a conductive bridge forms; electrons drift S → D
      ctx.save(); ctx.shadowColor = C.green; ctx.shadowBlur = 14;
      wire([[chL, chY], [chR, chY]], C.green, 5); ctx.restore();
      pulses([[290, chY], [chL, chY], [chR, chY], [710, chY]], '#8ff0ff', 7, 0.5, 4);
      ctx.textAlign = 'center';
      txt('channel formed — electrons flow  →  ON', 500, 470, 13, C.green, 'center', '700');
      ctx.textAlign = 'left';
    } else {
      // no channel: a visible gap, carriers stalled at the source
      ctx.strokeStyle = C.faint; ctx.lineWidth = 3; ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(chL, chY); ctx.lineTo(chR, chY); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#3a4b63';
      for (var i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(300 + i * 16, chY, 4, 0, TAU); ctx.fill(); }
      ctx.textAlign = 'center';
      txt('no channel — pinched off  →  OFF', 500, 470, 13, C.dim, 'center', '700');
      ctx.textAlign = 'left';
    }

    // the punchline
    ctx.textAlign = 'center';
    txt('A modern chip stacks tens of billions of these. That is all a processor is: switches.', VW / 2, 588, 12, C.dim, 'center');
    ctx.textAlign = 'left';
  }

  var SCENES = [scenePackage, sceneDie, sceneCore, sceneExec, sceneGate, sceneTransistor];

  /* ---- cross-fade parameters --------------------------------------------
     At an integer z the base level is shown clean (outgoing s=1,a=1; incoming
     hidden). As frac→1 the base scales up and fades while the next level grows
     from 0.62× and fades in, so the two meet continuously at the threshold. */
  function outgoing(frac) { return { s: 1 + frac * 1.7, a: clamp01(1 - frac * 1.35) }; }
  function incoming(frac) { return { s: 0.62 + frac * 0.38, a: smooth((frac - 0.12) * 1.7) }; }

  function drawScene(index, s, a) {
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H / 2);
    ctx.scale(fit * s, fit * s);
    ctx.translate(-VW / 2, -VH / 2);
    SCENES[index]();
    ctx.restore();
  }

  /* ---- the frame --------------------------------------------------------- */
  function render() {
    if (!ctx) return;
    // background: a deep radial so the scene feels like it sits in a well
    var g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    var base = clamp(Math.floor(z), 0, MAXZ);
    var frac = z - base;
    if (base >= MAXZ) { frac = 0; }

    var o = outgoing(frac), inc = incoming(frac);
    drawScene(base, o.s, o.a);
    if (base < MAXZ) drawScene(base + 1, inc.s, inc.a);

    // subtle vignette to focus the eye
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,6,16,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  /* ---- the loop ---------------------------------------------------------- */
  function tick(ts) {
    if (!ctx) return;
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;          // returning from a hidden tab must not jump
    if (dt < 0) dt = 0;

    // A frame arrived, so the stall watchdog is not needed for this change.
    if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }

    if (playing) flow += dt;
    /* flow drives both a fractional pulse phase (`% 1`) and integer toggle
       counters (`floor(flow / period)`). Left to run for hours it would grow
       large enough that float32-ish precision loss makes the pulses stutter.
       Subtracting a large integer keeps the `% 1` phase continuous and stays
       an exact multiple well above any toggle period, so nothing visibly
       jumps at the wrap. */
    if (flow > 1e5) flow -= 1e5;

    // glide the zoom toward its target (this is what makes the descent fly)
    var ease = reduced ? 0.16 : 0.11;
    z += (zTarget - z) * ease;
    if (Math.abs(zTarget - z) < 0.0005) z = zTarget;

    syncHud();
    render();
    rafHandle = raf(tick);
  }

  /* ---- HUD (kept in DOM so the text stays crisp) ------------------------- */
  function syncHud() {
    var idx = clamp(Math.round(z), 0, MAXZ);
    if (!sliderActive && elSlider) elSlider.value = String(Math.round(z * 100));
    // highlight the active stop on the depth rail
    for (var i = 0; i < railItems.length; i++) {
      if (railItems[i]) railItems[i].className = 'pv-rail-item' + (i === idx ? ' on' : '');
    }
    if (idx === lastLevelIdx) return;   // only rewrite the wordy bits on change
    lastLevelIdx = idx;
    var lv = LEVELS[idx];
    if (elTitle) elTitle.textContent = lv.title;
    if (elBlurb) elBlurb.textContent = lv.blurb;
    if (elCrumb) {
      elCrumb.textContent = '';
      for (i = 0; i < LEVELS.length; i++) {
        if (i) elCrumb.appendChild(E('span', 'pv-sep', ' › '));
        elCrumb.appendChild(E('span', 'pv-crumb-item' + (i === idx ? ' on' : ''), LEVELS[i].crumb));
      }
    }
  }

  /* ---- zoom controls ----------------------------------------------------- */
  /* Changing the target only moves zTarget; the glide toward it — and the
     repaint — happen in the rAF tick. That is right when frames are flowing
     and silently broken when they are not: a browser throttles rAF in a
     background tab, a pane that is not compositing stops it entirely, and in
     both cases every control would appear dead while the state changed behind
     an unchanging picture. So each target change arms a short watchdog: if no
     frame has arrived by the time it fires, the target is applied directly and
     the scene is drawn once. Normal use never reaches it, because a frame
     lands first and cancels it. */
  var stallTimer = null;
  function armStallWatchdog() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(function () {
      stallTimer = null;
      if (Math.abs(zTarget - z) < 0.0005) return;
      z = zTarget;                 // no frames are coming: jump rather than hang
      syncHud();
      render();
    }, 250);
  }
  function setTarget(v) {
    zTarget = clamp(v, 0, MAXZ);
    armStallWatchdog();
  }
  function zoomBy(d) { setTarget(zTarget + d); }
  function goToLevel(i) { setTarget(i); }
  function resetView() { setTarget(0); }
  function togglePlay() {
    playing = !playing;
    if (elPlay) {
      elPlay.textContent = playing ? '❚❚ Pause flow' : '▶ Play flow';
      elPlay.className = 'pv-btn' + (playing ? '' : ' off');
    }
  }

  /* ---- sizing ------------------------------------------------------------ */
  function fitCanvas() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap: a 3× phone gains nothing visible
    W = Math.max(1, Math.round(rect.width || canvas.clientWidth || 900));
    H = Math.round(rect.height || canvas.clientHeight || 0);
    if (H < 60) { H = Math.round(W * 0.62); canvas.style.height = H + 'px'; }
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // fit the 1000×640 virtual box into the canvas with a little breathing room
    fit = Math.min(W / VW, H / VH) * 0.94;
  }

  /* ---- input ------------------------------------------------------------- */
  var dragging = false, dragY = 0;
  function onWheel(e) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.32 : -0.32);
  }
  function onDown(e) {
    dragging = true;
    dragY = e.clientY != null ? e.clientY : (e.touches && e.touches[0].clientY);
    if (e.cancelable) e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    var y = e.clientY != null ? e.clientY : (e.touches && e.touches[0].clientY);
    if (y == null) return;
    // drag up = descend (zoom in), drag down = pull out
    zoomBy((dragY - y) * 0.006);
    dragY = y;
  }
  function onUp() { dragging = false; }
  function onKey(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === '+' || e.key === '=') { zoomBy(1); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { zoomBy(-1); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Spacebar') { togglePlay(); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') { resetView(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { zoomBy(0.5); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { zoomBy(-0.5); e.preventDefault(); }
  }

  /* ---- scoped styles ----------------------------------------------------- */
  var CSS = [
    '#processorviz .pv-wrap{font:13px/1.5 ' + FONT + ';color:' + C.ink + ';}',
    '#processorviz .pv-stage{position:relative;border:1px solid #1c2b44;border-radius:12px;overflow:hidden;background:' + C.bg0 + ';}',
    '#processorviz .pv-canvas{display:block;width:100%;height:520px;touch-action:none;cursor:ns-resize;}',
    '@media (max-width:640px){#processorviz .pv-canvas{height:400px;}}',
    '#processorviz .pv-hud{position:absolute;left:14px;top:12px;right:150px;pointer-events:none;}',
    '#processorviz .pv-crumb{font-size:11px;letter-spacing:.04em;color:' + C.faint + ';margin-bottom:6px;}',
    '#processorviz .pv-crumb-item.on{color:' + C.cyan + ';font-weight:700;}',
    '#processorviz .pv-sep{color:#33435e;}',
    '#processorviz .pv-title{font-size:17px;font-weight:700;color:' + C.ink + ';margin:0 0 4px;}',
    '#processorviz .pv-blurb{font-size:12px;line-height:1.55;color:' + C.dim + ';max-width:560px;}',
    '#processorviz .pv-rail{position:absolute;right:12px;top:12px;bottom:12px;display:flex;flex-direction:column;justify-content:center;gap:6px;pointer-events:none;}',
    '#processorviz .pv-rail-item{pointer-events:auto;cursor:pointer;font-size:11px;text-align:right;padding:4px 9px;border-radius:6px;color:' + C.faint + ';background:rgba(9,15,28,0.55);border:1px solid transparent;white-space:nowrap;}',
    '#processorviz .pv-rail-item:hover{color:' + C.ink + ';}',
    '#processorviz .pv-rail-item.on{color:' + C.cyan + ';border-color:#2c496f;background:rgba(16,28,48,0.85);font-weight:700;}',
    '#processorviz .pv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px;}',
    '#processorviz .pv-btn{font:inherit;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:7px 12px;cursor:pointer;}',
    '#processorviz .pv-btn:hover{background:#213152;border-color:#40608f;}',
    '#processorviz .pv-btn.off{color:#ff9db0;border-color:#5a2c3c;}',
    '#processorviz .pv-btn.round{width:38px;text-align:center;padding:7px 0;font-size:16px;}',
    '#processorviz .pv-slider{flex:1;min-width:160px;display:flex;align-items:center;gap:8px;color:' + C.dim + ';}',
    '#processorviz .pv-slider input{flex:1;accent-color:#1f6feb;}',
    '#processorviz .pv-hint{width:100%;font-size:11px;color:' + C.faint + ';line-height:1.6;margin-top:2px;}'
  ].join('');

  /* ---- build the whole UI inside the root -------------------------------- */
  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var wrap = E('div', 'pv-wrap');

    var stage = E('div', 'pv-stage');
    canvas = document.createElement('canvas');
    canvas.className = 'pv-canvas';
    canvas.id = 'viz-canvas';
    canvas.setAttribute('tabindex', '0');
    stage.appendChild(canvas);

    // HUD overlay: breadcrumb + title + one-line explanation
    var hud = E('div', 'pv-hud');
    elCrumb = E('div', 'pv-crumb');
    elTitle = E('div', 'pv-title');
    elBlurb = E('div', 'pv-blurb');
    hud.appendChild(elCrumb); hud.appendChild(elTitle); hud.appendChild(elBlurb);
    stage.appendChild(hud);

    // depth rail on the right — the "you are here", and clickable navigation
    var rail = E('div', 'pv-rail');
    railItems = [];
    (function () {
      for (var i = 0; i < LEVELS.length; i++) {
        (function (idx) {
          var it = E('div', 'pv-rail-item', (idx + 1) + ' · ' + LEVELS[idx].crumb);
          it.addEventListener('click', function () { goToLevel(idx); });
          rail.appendChild(it);
          railItems.push(it);
        })(i);
      }
    })();
    stage.appendChild(rail);
    wrap.appendChild(stage);

    // control bar
    var bar = E('div', 'pv-bar');
    elPlay = E('button', 'pv-btn', '❚❚ Pause flow');
    elPlay.type = 'button';
    elPlay.addEventListener('click', togglePlay);
    bar.appendChild(elPlay);

    var reset = E('button', 'pv-btn', '⟲ Reset view');
    reset.type = 'button';
    reset.addEventListener('click', resetView);
    bar.appendChild(reset);

    var minus = E('button', 'pv-btn round', '−');
    minus.type = 'button';
    minus.addEventListener('click', function () { zoomBy(-1); });
    bar.appendChild(minus);

    var sli = E('div', 'pv-slider');
    sli.appendChild(E('span', null, 'depth'));
    elSlider = document.createElement('input');
    elSlider.type = 'range';
    elSlider.min = '0'; elSlider.max = String(MAXZ * 100); elSlider.step = '1';
    elSlider.value = '0';
    elSlider.addEventListener('input', function () {
      sliderActive = true;
      setTarget(parseInt(elSlider.value, 10) / 100);
    });
    // release the "user is dragging" latch shortly after the last input
    elSlider.addEventListener('change', function () { sliderActive = false; });
    elSlider.addEventListener('blur', function () { sliderActive = false; });
    sli.appendChild(elSlider);
    bar.appendChild(sli);

    var plus = E('button', 'pv-btn round', '+');
    plus.type = 'button';
    plus.addEventListener('click', function () { zoomBy(1); });
    bar.appendChild(plus);

    var hint = E('div', 'pv-hint',
      'Scroll or drag up/down over the chip to descend, or use +/−, the depth slider, or the level list. ' +
      'Keys: +/− zoom · Space play/pause · R reset. Six levels: package → die → core → execution → gate → transistor.');
    bar.appendChild(hint);

    wrap.appendChild(bar);
    root.appendChild(wrap);

    ctx = canvas.getContext('2d');

    // reduced-motion: calm the animation rather than stopping it
    try {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = mq.matches;
      if (mq.addEventListener) mq.addEventListener('change', function (ev) { reduced = ev.matches; });
      else if (mq.addListener) mq.addListener(function (ev) { reduced = ev.matches; });
    } catch (err) { reduced = false; }

    fitCanvas();
    syncHud();

    // interaction
    stage.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', function (e) { onMove(e); if (e.cancelable) e.preventDefault(); }, { passive: false });
    canvas.addEventListener('touchend', onUp);
    root.addEventListener('keydown', onKey);
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');

    /* Resizing a canvas clears it, so a resize must repaint immediately rather
       than leave the scene blank until the next animation frame. */
    if (window.ResizeObserver) {
      try {
        new window.ResizeObserver(function () { fitCanvas(); render(); }).observe(canvas);
      } catch (e2) {}
    } else {
      window.addEventListener('resize', function () { fitCanvas(); render(); });
    }

    /* Paint once, synchronously, before the loop starts.

       render() used to be reachable only from inside the rAF tick, which meant
       the canvas stayed empty until the first animation frame arrived — and if
       frames never arrive (the tab is in the background at load, the pane is
       not compositing, reduced-motion, a throttled browser), it stayed empty
       forever. A visualiser that shows nothing until it happens to animate is
       indistinguishable from a broken one, so the still scene goes up first and
       the animation is what gets added on top. */
    fitCanvas();
    render();

    // start the live loop — cancel any previous one first, so a re-boot can
    // never leave two loops racing each other on the same canvas.
    cancelRaf(rafHandle);
    lastTs = 0;
    rafHandle = raf(tick);
  }

  /* ---- boot -------------------------------------------------------------- */
  /* If anything in build() throws, the container is left empty and the page
     looks broken with no explanation — which is indistinguishable from a dead
     server or a stale cached script, and impossible for a visitor to report
     usefully. So a failure says so, on the page, in words. */
  function boot() {
    if (built) return;
    root = document.getElementById('processorviz');
    if (!root) return;
    built = true;
    try {
      /* The page ships a visible "starting…" line inside the mount so that a
         failure to build is never an empty container the visitor cannot
         report. Once we are actually building, that line has done its job. */
      var mount = document.getElementById('viz-proc-mount');
      if (mount) mount.parentNode.removeChild(mount);
      build();
    } catch (err) {
      var msg = document.createElement('p');
      msg.style.cssText = 'padding:1.5rem;color:#fca5a5;line-height:1.6;font-family:' +
        "'Cascadia Code','Fira Code',Consolas,monospace;font-size:0.85rem";
      msg.textContent = 'The processor explorer failed to start: ' +
        (err && err.message ? err.message : String(err)) +
        '  —  please report this, it is a bug rather than something you did.';
      root.appendChild(msg);
    }
  }

  // viz-shell drives this: onReady fires only once the Labs consent gate is
  // satisfied, so the loop never spins behind the overlay. Fall back to a bare
  // DOM boot if the shell is absent (a stand-alone test page).
  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'processorviz', run: resetView, onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

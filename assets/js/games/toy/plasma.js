/* ==========================================================================
   plasma.js — the demoscene plasma field, built the way it was built.
   --------------------------------------------------------------------------
   A plasma is not a simulation of anything. It is several periodic functions
   added together and the sum read through a colour table: one sine across x,
   one down y, one along the diagonal, and one measured outward from a point.
   Where the crests agree you get a bright blob, where they disagree you get a
   dark one, and because each term drifts at its own rate the blobs never quite
   repeat. Nothing here models a gas, a fluid or a field. The name came from
   the look, and the look came from arithmetic a machine of the time could
   actually afford.

   THE SINE TABLE IS THE WHOLE POINT, so it is worth counting what it buys.
   At full size this draws 640 x 440 = 281,600 pixels, and with four terms
   that is 1,126,400 sine evaluations per frame, or a shade under 68 million a
   second at sixty frames. Math.sin is a real transcendental call, and asking
   for it that often is where a browser plasma's frame rate goes before
   anybody thinks to blame the canvas. A 2048-entry table turns each one into
   an integer add, a mask and one typed-array read. The Frames cell in the HUD
   is there so the trade can be checked on the machine in front of you rather
   than taken from this comment.

   There is a second gift in the table that is easy to miss. Because the table
   is indexed by an INTEGER angle, adding angles is adding integers — so the
   diagonal term sin((x + y) * f + t) needs no angle-addition identity and no
   second table. Its x half is precomputed per column, its y half per row, and
   the per-pixel work is one addition. The two radial terms are the only ones
   that cannot be split that way, because a distance does not decompose, so
   they pay one Math.sqrt each. Square root is a hardware instruction; sine is
   not. That is the entire performance argument in this file.

   The palette is a 256-entry lookup table and the colours move by adding an
   offset to the index. That is the period trick, faithfully: on a VGA card you
   animated by rewriting the 256-entry hardware palette between frames and
   never touched a single pixel. We have no hardware palette any more, so the
   offset is applied when the index is computed instead — the same idea, done
   in software, and the reason every palette here is built as a closed loop
   with its last colour equal to its first. A palette with a seam shows the
   seam sweeping across the field once per cycle.

   Deliberately missing: no WebGL, no worker, and no adaptive quality that
   changes the picture behind your back. The resolution control is manual and
   the HUD prints the buffer it is actually filling along with the frame rate
   measured in this tab, because a toy that quietly drops to a quarter size to
   flatter its own frame counter is lying about the trade it just made.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  var W = 640;
  var H = 440;

  /* ------------------------------------------------------------------
     The sine table. A power of two so the wrap is an AND rather than a
     modulo, and stored as 0..1 rather than -1..1 so that summing terms
     needs no re-centring afterwards: N terms sum to 0..N whatever N is,
     and one multiply maps that onto the palette.

     2048 entries is 8 KB and about a sixth of a degree of resolution. A
     smaller table is audible as banding in the flattest parts of the
     field, where the sum crawls through a handful of table steps and the
     palette makes each of them a visible contour.
     ------------------------------------------------------------------ */
  var TBITS = 11;
  var TSIZE = 1 << TBITS;
  var TMASK = TSIZE - 1;
  var SIN = new Float32Array(TSIZE);
  (function () {
    for (var i = 0; i < TSIZE; i++) {
      SIN[i] = 0.5 + 0.5 * Math.sin(i * Math.PI * 2 / TSIZE);
    }
  })();

  var PAL = 256;
  var PMASK = PAL - 1;

  /* ------------------------------------------------------------------
     Pixels are written as one 32-bit store rather than four byte stores,
     which means the byte order of the machine matters. Nearly everything
     is little-endian, but "nearly" is not a thing to build a renderer on,
     so it is asked once: write a known word through a Uint32Array and see
     which end of the Uint8Array it came out of.
     ------------------------------------------------------------------ */
  var LITTLE = (function () {
    try {
      var buf = new ArrayBuffer(4);
      var u8 = new Uint8Array(buf);
      var u32 = new Uint32Array(buf);
      u32[0] = 0x01020304;
      return u8[0] === 0x04;
    } catch (err) {
      return true;
    }
  })();

  function pack(r, gr, b) {
    if (LITTLE) return (((255 << 24) | (b << 16) | (gr << 8) | r) >>> 0);
    return (((r << 24) | (gr << 16) | (b << 8) | 255) >>> 0);
  }

  function mix(a, b, k) { return a + (b - a) * k; }

  /* ------------------------------------------------------------------
     The palettes.

     Every one of them is a CLOSED LOOP — the stop at 1 is the same colour
     as the stop at 0 — because the index offset walks the whole table
     every cycle and any discontinuity becomes a hard edge marching across
     the picture. Fire looks wrong the first time you build it this way,
     because a real flame ramp ends at white and starting again from black
     is a cliff; the fix is to bring it back down through ember red on the
     way home rather than to cut.

     Two-tone is the site's own accent pair over the site's own ground:
     #020617 through #0284c7 to #7dd3fc and back. It is the honest test of
     a plasma, because with only one hue there is nowhere for a mistake in
     the arithmetic to hide behind colour.
     ------------------------------------------------------------------ */
  var PALETTES = [
    {
      id: 'fire',
      name: 'Fire',
      stops: [
        [0.00, 4, 2, 8], [0.16, 92, 12, 14], [0.34, 208, 58, 12],
        [0.52, 252, 156, 32], [0.66, 255, 244, 198], [0.84, 128, 26, 16],
        [1.00, 4, 2, 8]
      ]
    },
    {
      id: 'ice',
      name: 'Ice',
      stops: [
        [0.00, 2, 6, 26], [0.20, 12, 48, 110], [0.42, 40, 132, 208],
        [0.58, 148, 224, 250], [0.72, 244, 252, 255], [0.88, 20, 60, 128],
        [1.00, 2, 6, 26]
      ]
    },
    {
      id: 'rainbow',
      name: 'Rainbow',
      stops: [
        [0 / 6, 244, 60, 60], [1 / 6, 244, 214, 62], [2 / 6, 74, 220, 108],
        [3 / 6, 60, 220, 226], [4 / 6, 78, 108, 240], [5 / 6, 210, 82, 232],
        [6 / 6, 244, 60, 60]
      ]
    },
    {
      id: 'grey',
      name: 'Greyscale',
      stops: [[0.00, 6, 6, 8], [0.50, 246, 248, 250], [1.00, 6, 6, 8]]
    },
    {
      id: 'accent',
      name: 'Two-tone',
      stops: [
        [0.00, 2, 6, 23], [0.34, 2, 132, 199], [0.52, 125, 211, 252],
        [0.70, 56, 189, 248], [1.00, 2, 6, 23]
      ]
    }
  ];

  function buildPalette(stops) {
    var out = new Uint32Array(PAL);
    var s = 0;
    for (var i = 0; i < PAL; i++) {
      var t = i / PAL;
      while (s < stops.length - 2 && t >= stops[s + 1][0]) s++;
      var a = stops[s];
      var b = stops[s + 1];
      var span = b[0] - a[0];
      var k = span <= 0 ? 0 : (t - a[0]) / span;
      out[i] = pack(
        Math.round(mix(a[1], b[1], k)),
        Math.round(mix(a[2], b[2], k)),
        Math.round(mix(a[3], b[3], k))
      );
    }
    return out;
  }

  var BY_ID = {};
  (function () {
    for (var i = 0; i < PALETTES.length; i++) {
      PALETTES[i].lut = buildPalette(PALETTES[i].stops);
      BY_ID[PALETTES[i].id] = PALETTES[i];
    }
  })();

  /* How many wavelengths of each term span the width of the field at
     frequency 1. Chosen so no two are a whole-number ratio of another:
     make them harmonics and the field locks into a lattice and stops
     looking like a plasma at all. */
  var WAVE_A = 2.6;      // horizontal
  var WAVE_B = 2.0;      // vertical
  var WAVE_C = 1.7;      // diagonal, both halves
  var WAVE_D = 3.4;      // radial from the origin
  var WAVE_E = 2.9;      // radial from a centre orbiting the origin

  /* Table units a second. Same rule: no two in step, so the field never
     comes back round to an arrangement it has already been in. */
  var RATE_A = TSIZE * 0.070;
  var RATE_B = TSIZE * -0.052;
  var RATE_C = TSIZE * 0.031;
  var RATE_D = TSIZE * 0.043;
  var RATE_E = TSIZE * -0.037;

  var ORBIT_R = W * 0.22;
  var ORBIT_RATE = 0.21;   // radians a second

  /* Asked once, at parse time, because autoStart is a static field on the
     spec below and a visitor who has told their operating system they want
     less movement has told it before this file ran. */
  var reduced = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* A coarse pointer is a phone, and a phone filling 281,600 pixels a frame
     in JavaScript is a phone that gets warm. It opens at half size instead —
     and the dropdown is moved to match, so the control never disagrees with
     what is on screen and the HUD prints the buffer either way. */
  var coarse = !!(window.matchMedia &&
    window.matchMedia('(pointer: coarse)').matches);

  GameShell.define({
    id: 'game-plasma',
    slug: 'plasma',
    title: 'Plasma',
    width: W,
    height: H,

    /* These four are stated here as well as in the manifest on purpose.
       They are the fields the shell reads at RUNTIME, and the manifest is
       build-time data that nothing hands to the shell — so a value set only
       over there is a comment that reads like code. build.js has a gate that
       fails the deploy when the two disagree, and it exists because three
       games shipped with exactly that split. There is no score in a plasma,
       so the Best slot is off; and a tap must not do anything, because the
       whole surface is a drag handle for the field origin. */
    bestKey: null,
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',

    /* A toy autostarts. This one does not when the system has asked for
       reduced motion: it sits on a still frame behind the start overlay,
       which says why, and runs the moment the visitor asks it to. */
    autoStart: !reduced,
    pauseOnBlur: false,
    startTitle: 'Held still',
    startText: 'Your system asks for reduced motion, so this opens on a still frame and the ' +
      'palette cycle starts slow. Press Play when you want it moving.',

    setup: function (g) {
      /* ---------------------------------------------------------------
         The buffer. Pixels are written into an off-screen canvas at the
         chosen resolution and that canvas is then drawn onto the game's
         own, scaled up by the browser.

         putImageData straight onto the game canvas is not an option and
         the reason is worth stating: putImageData ignores the current
         transform, and the shell's whole scaling model is a transform
         from logical units onto device pixels. It would land in the top
         left corner at one buffer pixel per device pixel on every display
         that is not exactly 1x. drawImage respects the transform, and it
         is also what does the upscale for free.
         --------------------------------------------------------------- */
      var off = document.createElement('canvas');
      var offCtx = off.getContext ? off.getContext('2d') : null;
      var img = null;
      var buf = null;
      var cols = 0;
      var rows = 0;
      var broken = !offCtx;

      var scale = coarse ? 0.5 : 1;
      var terms = 4;
      var freq = 1;              // multiplier on every spatial frequency
      var cycle = 0.6;           // palette turns a second
      var pal = PALETTES[0];

      /* The field origin, in logical units. Every term is measured from
         here, so dragging it moves the whole picture rather than only the
         radial rings. */
      var ox = W / 2;
      var oy = H / 2;

      var pA = 0, pB = 0, pC = 0, pD = 0, pE = 0;
      var pOff = 0;              // where the palette has cycled to, 0..256
      var orbit = 0;

      var colA = null, colC = null, colLx = null, colLx2 = null, colEx2 = null;
      var colsDirty = true;

      var frames = 0;
      var fpsLast = 0;
      var sndAcc = 0;
      var cycleForced = false;
      var resForced = false;

      var termsSel = document.getElementById('game-terms');
      var freqIn = document.getElementById('game-freq');
      var cycleIn = document.getElementById('game-cycle');
      var palSel = document.getElementById('game-palette');
      var resSel = document.getElementById('game-res');

      function now() {
        return (window.performance && window.performance.now)
          ? window.performance.now() : +new Date();
      }

      /* ---------------------------------------------------------------
         The drone.

         A plasma has no events in it. Nothing collides, nothing is
         scored, nothing ever happens — it is a condition, and a condition
         wants a held layer rather than a one-shot, or the sound button is
         wired to nothing a visitor could hear.

         So: two sawtooths a few cents apart with a sine underneath, all
         through one lowpass. The filter cutoff TRACKS THE PALETTE CYCLE —
         it is fed the same phase the index offset is at, so the drone
         opens and closes once per turn of the colour table and the ear
         gets the same period the eye does. The detune between the two
         saws drifts on its own very slow oscillator, and how far it
         drifts follows the cycle speed: a still palette barely beats, a
         fast one shimmers. Pitch follows the frequency control, so the
         one slider that changes the mathematics most also moves the
         sound.
         --------------------------------------------------------------- */
      var drone = g.bed(function (a) {
        var ctx = a.ctx;

        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        /* Enough resonance that a sweep is heard as a sweep rather than
           as the thing merely getting louder, and not enough to whistle
           on the way past a harmonic. */
        lp.Q.value = 3.2;

        var out = ctx.createGain();
        out.gain.value = 0.05;
        lp.connect(out);
        out.connect(a.out);

        function voice(type, hz, cents) {
          var osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = hz;
          osc.detune.value = cents;
          osc.connect(lp);
          osc.start();
          return osc;
        }

        /* Sawtooths, because the filter needs harmonics to have anything
           to take away. A pair of sines under a lowpass is a lowpass with
           nothing to do. */
        var sub = voice('sine', 55, 0);
        voice('sawtooth', 110, 0);
        var upper = voice('sawtooth', 110, 9);

        var driftOsc = ctx.createOscillator();
        driftOsc.type = 'sine';
        driftOsc.frequency.value = 0.021;      // one sweep in about 48 s
        var driftDepth = ctx.createGain();
        driftDepth.gain.value = 11;            // cents
        driftOsc.connect(driftDepth);
        driftDepth.connect(upper.detune);
        driftOsc.start();

        function ramp(param, value, secs) {
          var t = ctx.currentTime;
          param.cancelScheduledValues(t);
          param.setValueAtTime(param.value, t);
          /* Longer than the gap between two recomputes so consecutive
             ramps overlap. A ramp that lands early leaves the parameter
             parked, and a sweep then reads as five steps. */
          param.linearRampToValueAtTime(value, t + (secs == null ? 0.32 : secs));
        }

        return {
          set: function (key, value) {
            if (key === 'bright') {
              /* The palette phase, 0..1, straight onto the cutoff. */
              ramp(lp.frequency, 230 + value * 1520);
              return;
            }
            if (key === 'drift') {
              ramp(driftDepth.gain, 5 + value * 26, 1.6);
              ramp(driftOsc.frequency, 0.012 + value * 0.05, 1.6);
              return;
            }
            if (key === 'pitch') {
              var hz = 70 + value * 38;
              ramp(sub.frequency, hz / 2, 0.8);
              ramp(upper.frequency, hz, 0.8);
              return;
            }
          }
        };
      });

      /* ---------------------------------------------------------------
         Buffer sizing.
         --------------------------------------------------------------- */
      function ensureBuffer() {
        if (broken) return false;
        var c = Math.max(8, Math.round(W * scale));
        var r = Math.max(8, Math.round(H * scale));
        if (c === cols && r === rows && buf) return true;
        try {
          off.width = c;
          off.height = r;
          img = offCtx.createImageData(c, r);
          buf = new Uint32Array(img.data.buffer);
        } catch (err) {
          /* No typed view over the image data means no fast path and no
             slow one worth having either. Say so on the canvas rather
             than leaving a black rectangle. */
          broken = true;
          return false;
        }
        cols = c;
        rows = r;
        colA = new Int32Array(cols);
        colC = new Int32Array(cols);
        colLx = new Float64Array(cols);
        colLx2 = new Float64Array(cols);
        colEx2 = new Float64Array(cols);
        colsDirty = true;
        g.stat('res', cols + ' × ' + rows);
        return true;
      }

      /* Everything that depends on the column and not on the clock. It is
         rebuilt when the resolution, the frequency or the origin changes,
         which is a few hundred operations against the few hundred thousand
         the pixel loop does. */
      function rebuildCols() {
        var step = 1 / scale;
        var fa = freq * WAVE_A * TSIZE / W;
        var fc = freq * WAVE_C * TSIZE / W;
        for (var i = 0; i < cols; i++) {
          var lx = i * step - ox;
          colLx[i] = lx;
          colLx2[i] = lx * lx;
          colA[i] = (lx * fa) | 0;
          colC[i] = (lx * fc) | 0;
        }
        colsDirty = false;
      }

      /* ---------------------------------------------------------------
         Controls.
         --------------------------------------------------------------- */
      function sayCycle() {
        g.stat('cycle', cycle.toFixed(2) + ' turns/s');
      }

      function applyTerms(n, announce) {
        terms = n < 2 ? 2 : (n > 5 ? 5 : n);
        g.stat('terms', String(terms));
        if (announce) g.announce(terms + ' sine terms');
      }

      function applyScale(v, announce) {
        scale = v > 0 ? v : 1;
        ensureBuffer();
        colsDirty = true;
        if (announce) g.announce('Rendering at ' + cols + ' by ' + rows + ' pixels');
      }

      if (termsSel) termsSel.addEventListener('change', function () {
        applyTerms(Number(termsSel.value) || 4, true);
      });

      if (freqIn) freqIn.addEventListener('input', function () {
        freq = (Number(freqIn.value) || 100) / 100;
        colsDirty = true;
        drone.set('pitch', freq);
      });

      if (cycleIn) cycleIn.addEventListener('input', function () {
        cycle = (Number(cycleIn.value) || 0) / 100;
        sayCycle();
      });

      if (palSel) palSel.addEventListener('change', function () {
        pal = BY_ID[palSel.value] || PALETTES[0];
        /* The name, not the colours. Somebody who cannot see the
           difference between Fire and Ember still gets told which one is
           on, and the select itself reads it out as well. */
        g.announce('Palette: ' + pal.name);
      });

      if (resSel) resSel.addEventListener('change', function () {
        applyScale(Number(resSel.value) || 1, true);
      });

      /* ---------------------------------------------------------------
         Moving the origin.

         A drag moves it with the finger: the pattern follows the pointer
         rather than sliding the opposite way, which is the one of the two
         that people expect. Clamped to a box a screen wider than the
         field in each direction, so the interesting part cannot be pushed
         somewhere it can never be dragged back from.
         --------------------------------------------------------------- */
      function moveOrigin(dx, dy) {
        ox += dx;
        oy += dy;
        if (ox < -W) ox = -W; else if (ox > W * 2) ox = W * 2;
        if (oy < -H) oy = -H; else if (oy > H * 2) oy = H * 2;
        colsDirty = true;
      }

      function sayOrigin() {
        g.announce('Field origin at ' + Math.round(ox) + ', ' + Math.round(oy));
      }

      if (g.canvas) {
        var dragging = false;
        var lastX = 0;
        var lastY = 0;

        g.canvas.addEventListener('pointerdown', function (event) {
          var p = g.pointAt(event);
          dragging = true;
          lastX = p.x;
          lastY = p.y;
          if (g.canvas.setPointerCapture && event.pointerId != null) {
            try { g.canvas.setPointerCapture(event.pointerId); } catch (err) { /* not fatal */ }
          }
        });

        g.canvas.addEventListener('pointermove', function (event) {
          if (!dragging) return;
          var p = g.pointAt(event);
          moveOrigin(p.x - lastX, p.y - lastY);
          lastX = p.x;
          lastY = p.y;
        });

        var endDrag = function () {
          if (!dragging) return;
          dragging = false;
          sayOrigin();
        };
        g.canvas.addEventListener('pointerup', endDrag);
        g.canvas.addEventListener('pointercancel', endDrag);
        /* The safety net, and only a net: a pointer released over some
           other part of the page with capture unavailable would otherwise
           leave the drag latched on. It clears the flag and moves
           nothing. */
        window.addEventListener('pointerup', function () { dragging = false; });
      }

      return {
        reset: function () {
          pA = 0; pB = 0; pC = 0; pD = 0; pE = 0;
          pOff = 0;
          orbit = 0;
          ox = W / 2;
          oy = H / 2;
          frames = 0;
          fpsLast = 0;
          sndAcc = 0;

          if (termsSel) applyTerms(Number(termsSel.value) || 4, false);
          else applyTerms(4, false);
          if (freqIn) freq = (Number(freqIn.value) || 100) / 100;
          if (palSel) pal = BY_ID[palSel.value] || PALETTES[0];

          /* The dropdown is moved to whatever was actually adopted, in
             both directions: a phone opens at half size and the control
             has to say half, and a desktop reload must not be dragged
             back off a choice the visitor made. So the select is the
             authority once it holds a value, and only the very first pass
             writes into it. */
          if (resSel) {
            if (coarse && !resForced) {
              resForced = true;
              resSel.value = '0.5';
            }
            scale = Number(resSel.value) || 1;
          }

          /* Reduced motion answered by MOVING THE CONTROL rather than by
             quietly refusing to cycle. A slider showing 0.60 while
             nothing moves is indistinguishable from a bug, and a visitor
             has no way to tell which it is. Zeroing it states the
             position and leaves them free to raise it, which is an
             explicit request and outranks a system default. Once only —
             overriding a choice made after boot would be the same
             disrespect the other way round. */
          if (cycleIn) {
            if (reduced && !cycleForced) {
              cycleForced = true;
              cycleIn.value = '20';
              cycleIn.title = 'The palette cycle starts slow because your system asks for reduced motion';
            }
            cycle = (Number(cycleIn.value) || 0) / 100;
          }

          ensureBuffer();
          colsDirty = true;
          /* Restated whether or not the size changed. ensureBuffer only
             writes the cell when it actually reallocates, and a restart
             that adopted the same size would otherwise leave the markup's
             initial 640 x 440 standing on a phone rendering 320 x 220. */
          g.stat('res', cols + ' × ' + rows);
          sayCycle();
          g.stat('fps', '—');
          drone.set('pitch', freq);
          drone.set('drift', cycle / 2 > 1 ? 1 : cycle / 2);
        },

        key: function (name) {
          /* The keyboard equivalent of the drag. Arrows only — the shell
             binds no letters and neither does this. */
          var step = 18;
          if (name === 'left') moveOrigin(-step, 0);
          else if (name === 'right') moveOrigin(step, 0);
          else if (name === 'up') moveOrigin(0, -step);
          else if (name === 'down') moveOrigin(0, step);
          else if (name === 'action') {
            ox = W / 2;
            oy = H / 2;
            colsDirty = true;
            g.announce('Field origin back in the middle');
            return;
          } else return;
          /* Held arrows repeat, so the announcement is thinned or the
             live region spends the whole drag talking over itself. */
          if (g.gate('origin', 0.9)) sayOrigin();
        },

        update: function (dt) {
          pA = (pA + RATE_A * dt) % TSIZE;
          pB = (pB + RATE_B * dt) % TSIZE;
          pC = (pC + RATE_C * dt) % TSIZE;
          pD = (pD + RATE_D * dt) % TSIZE;
          pE = (pE + RATE_E * dt) % TSIZE;
          orbit = (orbit + ORBIT_RATE * dt) % (Math.PI * 2);

          /* One turn of the palette is PAL indices, so a cycle rate in
             turns a second is that many times 256 index steps a second.
             This is the whole of the colour animation: nothing about the
             pixels changes when it moves. */
          pOff = (pOff + cycle * PAL * dt) % PAL;
          if (pOff < 0) pOff += PAL;

          /* Five times a second, not sixty. Every set() below ends in a
             cancelScheduledValues and a ramp on an AudioParam, and
             scheduling those at frame rate costs more than the pixel loop
             they are describing while sounding identical. */
          sndAcc += dt;
          if (sndAcc >= 0.2) {
            sndAcc = 0;
            drone.set('bright', 0.5 + 0.5 * Math.sin(pOff / PAL * Math.PI * 2));
            drone.set('drift', cycle / 2 > 1 ? 1 : cycle / 2);
          }
        },

        draw: function (ctx, w, h) {
          if (!ensureBuffer()) {
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '15px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('This one needs a 2D canvas image buffer, and this browser', w / 2, h / 2 - 10);
            ctx.fillText('will not give one. Nothing else on the page is affected.', w / 2, h / 2 + 12);
            return;
          }
          if (colsDirty) rebuildCols();

          var step = 1 / scale;
          var fb = freq * WAVE_B * TSIZE / W;
          var fc = freq * WAVE_C * TSIZE / W;
          var fr = freq * WAVE_D * TSIZE / W;
          var fs = freq * WAVE_E * TSIZE / W;

          var tA = pA | 0, tB = pB | 0, tC = pC | 0, tD = pD | 0, tE = pE | 0;
          var offi = pOff | 0;
          var use3 = terms >= 3;
          var use4 = terms >= 4;
          var use5 = terms >= 5;

          /* N terms each land in 0..1, so the sum is 0..N whatever N is,
             and this is the one multiply that maps it onto 256 colours.
             Without it, dropping from four terms to two would use half
             the palette and read as the picture going flat rather than as
             the field getting simpler. */
          var mul = PAL / terms;

          var lut = pal.lut;
          var ecx = Math.cos(orbit) * ORBIT_R;
          var ecy = Math.sin(orbit) * ORBIT_R;
          var i, j;

          /* The orbiting centre moves every frame, so this column is the
             one that cannot be cached across frames. It is cols wide, not
             cols by rows. */
          if (use5) {
            for (i = 0; i < cols; i++) {
              var ex = colLx[i] - ecx;
              colEx2[i] = ex * ex;
            }
          }

          var p = 0;
          for (j = 0; j < rows; j++) {
            var ly = j * step - oy;
            var rowB = ((ly * fb) | 0) + tB;
            var rowC = ((ly * fc) | 0) + tC;
            var ly2 = ly * ly;
            var ey = ly - ecy;
            var ey2 = ey * ey;
            /* The vertical term depends on the row alone, so it is one
               table read per row rather than one per pixel. */
            var vB = SIN[rowB & TMASK];

            for (i = 0; i < cols; i++) {
              var v = SIN[(colA[i] + tA) & TMASK] + vB;
              if (use3) v += SIN[(colC[i] + rowC) & TMASK];
              if (use4) v += SIN[((Math.sqrt(colLx2[i] + ly2) * fr + tD) | 0) & TMASK];
              if (use5) v += SIN[((Math.sqrt(colEx2[i] + ey2) * fs + tE) | 0) & TMASK];
              /* The offset added here IS the palette cycling. On a VGA
                 card it went into the hardware colour table instead and
                 these pixels were never touched at all. */
              buf[p++] = lut[((((v * mul) | 0) + offi) & PMASK)];
            }
          }

          offCtx.putImageData(img, 0, 0);
          /* Smoothing on, always. A quarter-size buffer blown up with
             nearest-neighbour is a mosaic of hard squares; a plasma has
             no edges in it to preserve, so bilinear is both faster to
             look at and closer to what a CRT did to a 320x200 mode. */
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(off, 0, 0, w, h);

          /* The frame rate is measured here and printed, because the
             resolution control is a trade and a trade with only one side
             visible is not a control, it is a preference. */
          frames++;
          var t = now();
          if (!fpsLast) fpsLast = t;
          else if (t - fpsLast >= 1000) {
            g.stat('fps', Math.round(frames * 1000 / (t - fpsLast)) + '/s');
            frames = 0;
            fpsLast = t;
          }
        }
      };
    }
  });
})();

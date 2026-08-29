/* ==========================================================================
   rain.js — the BSD rain screensaver, with ripples that spread.
   --------------------------------------------------------------------------
   The 1980s original drew three characters at one spot — a dot, then an o,
   then an O — and called that a raindrop. This keeps the idea and gives it
   the thing it was reaching for: a drop falls, lands, and throws out rings
   that widen and fade.

   Two decisions are worth writing down.

   1. A RIPPLE IS THREE NUMBERS, NOT A GRID. Nothing about a ring is stored.
      A ripple is a centre and a radius, the radius grows with time, and the
      cells are worked out from it every frame by walking the angle. The
      alternative — keeping a buffer of lit cells per ripple and ageing it —
      costs memory per ripple and per cell, and the rings then have to be
      erased in the right order where they overlap. Computing from the radius
      means a ripple costs about one array entry, drawing it costs roughly
      one fillText per cell it actually covers, and two hundred of them at
      once is still a few thousand cheap writes into a buffer that was going
      to be painted anyway. That is the whole reason the Downpour setting is
      allowed to exist.

   2. A ROUND RING IS AN ELLIPSE IN CELLS. A character cell is 8 x 16 logical
      units, so it is twice as tall as it is wide. Plot a circle honestly, in
      cells, and it comes out as a vertical oval. Every vertical offset is
      therefore halved, which is why a ripple here reads as round on screen
      rather than as an egg.

   3. THE SOUND IS A BED, NOT A PLINK PER DROP. This file used to say, right
      here, that it had no sound, because at Downpour a plink per landing
      would be forty a second. That was the correct objection to the wrong
      instrument. Rain is not a sequence of events, it is a condition — two
      loops of filtered noise, a bright patter over a low body, both opened
      up as the density rises, with a slow LFO on the body's cutoff so the
      storm breathes instead of hissing. Individual landings still get a
      plink on top, but the gap between them WIDENS with density, which is
      what really happens: in a downpour you stop being able to pick out one
      drop from the next. Drizzle is a handful of separate plinks over near
      silence; Downpour is a wall with two or three coming through it.

   ES5 throughout, like everything else under assets/js.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 78;
  var ROWS = 26;

  /* Cells are 8 wide and 16 tall — see decision 2 in the header. */
  var ASPECT = 0.5;

  var TAU = Math.PI * 2;
  var OCTANT = Math.PI / 4;

  /* The character to draw at each point of a ring, by octant, starting at
     the right-hand side and going clockwise down the screen. It is the
     TANGENT that decides the glyph, not the direction out from the centre:
     at the right edge of a ring the curve runs vertically, at the bottom it
     runs flat, and on the diagonals it leans. Pick by radius direction
     instead and every ring comes out looking inside out. */
  var RING = ['│', '/', '─', '\\', '│', '/', '─', '\\'];

  /* Four bands rather than a gradient. A sixteen-colour terminal never had
     a smooth fade, and faking one here would only muddy the leading edge. */
  var BANDS = ['white', 'cyan', 'blue', 'dim'];

  /* Gap between the concentric rings of one ripple, in columns. Wider than
     two and they read as separate ripples; narrower and they smear. */
  var GAP = 2.4;

  var FALL = 24;        // rows a second a drop falls
  var SPREAD = 6;       // columns a second a ripple widens
  var MAX_RIPPLES = 260;

  TermShell.define({
    id: 'game-rain',
    slug: 'rain',
    title: 'Rain',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g, t) {
      var drops = [];
      var ripples = [];
      var spawnAcc = 0;
      var density = 6;        // landings a second
      var speedMul = 1;

      var densitySel = document.getElementById('game-density');
      var speedSel = document.getElementById('game-speed');

      /* ---------------------------------------------------------------
         The storm. See decision 3 in the header.

         Rain is two sounds at once and both are needed. The PATTER is the
         thousands of drops you cannot individually pick out: highpassed
         noise, and it is the layer that makes this read as rain rather than
         as wind. The BODY is the low wash underneath it, which is what makes
         a downpour feel heavy rather than merely loud. Ship one without the
         other and you get a hiss or a rumble; you do not get weather.
         --------------------------------------------------------------- */
      var storm = g.bed(function (a) {
        var ctx = a.ctx;

        function layer(type, freq, q, level) {
          var src = ctx.createBufferSource();
          src.buffer = a.noise();
          src.loop = true;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.value = freq;
          filt.Q.value = q;
          var gain = ctx.createGain();
          gain.gain.value = level;
          src.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          src.start();
          return { filt: filt, gain: gain };
        }

        var patter = layer('highpass', 2600, 0.7, 0.012);
        var body = layer('lowpass', 320, 0.9, 0.015);

        /* Gusts. A storm held at one level is a hiss, and the ear writes it
           off as noise inside about ten seconds. One very slow oscillator on
           the body's cutoff — a breath every sixteen seconds or so — is the
           entire difference between weather and a fan. */
        var lfo = ctx.createOscillator();
        var depth = ctx.createGain();
        lfo.frequency.value = 0.062;
        depth.gain.value = 120;
        lfo.connect(depth);
        depth.connect(body.filt.frequency);
        lfo.start();

        function ramp(param, value) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Half a second. A density change is a deliberate act, so it
             should be heard happening rather than appear between frames. */
          param.linearRampToValueAtTime(value, now + 0.5);
        }

        return {
          set: function (key, value) {
            if (key !== 'density') return;
            /* 2..40 drops a second onto 0..1, on a log curve rather than a
               straight line. Loudness is heard logarithmically: map it
               linearly and Drizzle is inaudible while Downpour is a wall,
               with the two useful settings squeezed into the last third. */
            var span = Math.log(40 / 2);
            var k = Math.max(0, Math.min(1, Math.log(value / 2) / span));
            ramp(patter.gain.gain, 0.012 + k * 0.048);
            ramp(body.gain.gain, 0.015 + k * 0.075);
            /* Heavier rain is not just louder, it is lower: the patter's
               highpass opens downward to let more of the mid through. */
            ramp(patter.filt.frequency, 2600 - k * 900);
            ramp(body.filt.frequency, 320 + k * 360);
          }
        };
      });

      if (densitySel) {
        density = Number(densitySel.value) || 6;
        densitySel.addEventListener('change', function () {
          density = Number(densitySel.value) || 6;
          storm.set('density', density);
        });
      }
      storm.set('density', density);

      if (speedSel) {
        speedMul = Number(speedSel.value) || 1;
        speedSel.addEventListener('change', function () {
          speedMul = Number(speedSel.value) || 1;
        });
      }

      /* One landing, heard. The GAP GROWS WITH DENSITY, which is the part
         that makes this work: at Drizzle every one of the two drops a second
         gets its own plink, and at Downpour barely one landing in fifteen
         does. That is not a performance dodge, it is what a downpour sounds
         like — the individual drops stop being separable and become the bed
         that is already playing underneath. The plink also gets quieter as
         the storm thickens, because a real one would be masked by it.

         The pitch is random per drop over a wide range and the filter falls
         across the burst, which is a drop hitting water rather than a stone
         hitting glass. */
      function plink() {
        var span = Math.log(40 / 2);
        var k = Math.max(0, Math.min(1, Math.log(density / 2) / span));
        if (!g.gate('drop', 0.05 + k * 0.35)) return;
        g.noise(0.05 + Math.random() * 0.05, {
          type: 'bandpass',
          freq: 900 + Math.random() * 1500,
          to: 320,
          q: 3.2,
          level: 0.038 - k * 0.016
        });
      }

      function spawn() {
        var land = 2 + Math.floor(Math.random() * (ROWS - 4));
        var fall = 4 + Math.random() * 7;
        drops.push({
          x: 1 + Math.floor(Math.random() * (COLS - 2)),
          y: land - fall,
          land: land,
          /* Every ripple gets its own reach, so a field of them never
             pulses in step. */
          max: 7 + Math.random() * 9
        });
      }

      /* One ring of one ripple. The radius passed in is horizontal, in
         columns; the vertical one is half of it. The number of points is
         proportional to the perimeter, so a small ring is not drawn forty
         times into the same four cells. */
      function ring(term, cx, cy, r, band) {
        if (r < 0.5) return;
        var steps = Math.round(r * 5);
        if (steps < 8) steps = 8;
        if (steps > 80) steps = 80;

        /* The outermost band is drawn at half density, in a fixed pattern
           rather than a random one. Random dropout would make a standing
           ring flicker every frame instead of dissolving. */
        var sparse = band >= 3;
        var colour = BANDS[band];

        for (var i = 0; i < steps; i++) {
          if (sparse && (i & 1)) continue;
          var a = (i / steps) * TAU - Math.PI;
          var x = Math.round(cx + Math.cos(a) * r);
          if (x < 0 || x >= COLS) continue;
          var y = Math.round(cy + Math.sin(a) * r * ASPECT);
          if (y < 0 || y >= ROWS) continue;
          var oct = Math.round(a / OCTANT);
          oct = ((oct % 8) + 8) % 8;
          term.put(x, y, sparse ? '·' : RING[oct], colour);
        }
      }

      return {
        reset: function () {
          drops = [];
          ripples = [];
          spawnAcc = 0;
          g.stat('drops', 0);
          g.stat('ripples', 0);
        },

        update: function (dt) {
          spawnAcc += density * dt;
          while (spawnAcc >= 1) {
            spawnAcc -= 1;
            if (ripples.length < MAX_RIPPLES) spawn();
          }

          var step = speedMul * dt;
          var i;

          for (i = drops.length - 1; i >= 0; i--) {
            var d = drops[i];
            d.y += FALL * step;
            if (d.y >= d.land) {
              drops.splice(i, 1);
              ripples.push({ x: d.x, y: d.land, r: 0, max: d.max });
              plink();
            }
          }

          for (i = ripples.length - 1; i >= 0; i--) {
            var p = ripples[i];
            p.r += SPREAD * step;
            if (p.r > p.max) ripples.splice(i, 1);
          }

          g.stat('drops', drops.length);
          g.stat('ripples', ripples.length);
        },

        draw: function (term) {
          term.clear();

          for (var i = 0; i < ripples.length; i++) {
            var p = ripples[i];
            /* How far through its life this ripple is, which is what fades
               it. The leading ring is always one band brighter than the two
               trailing it. */
            var life = p.r / p.max;
            var base = Math.round(life * 2.4);

            /* Trailing rings first, leading edge last: where two rings land
               on the same cell the brighter one must be the survivor. */
            for (var k = 2; k >= 0; k--) {
              var band = base + k;
              if (band > 3) band = 3;
              ring(term, p.x, p.y, p.r - k * GAP, band);
            }

            /* Before the first ring is wide enough to be a ring, it is the
               splash itself. */
            if (p.r < 1.2) term.put(p.x, p.y, 'o', 'white');
          }

          for (var j = 0; j < drops.length; j++) {
            var d = drops[j];
            var head = Math.floor(d.y);
            term.put(d.x, head, '│', 'cyan');
            term.put(d.x, head - 1, '│', 'blue');
            term.put(d.x, head - 2, '·', 'dim');
          }
        }
      };
    }
  });
})();

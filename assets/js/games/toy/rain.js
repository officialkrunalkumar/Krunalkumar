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

   ES5 throughout, like everything else under assets/js. No sound: at the
   heavier densities a plink per landing would be forty a second.
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

      if (densitySel) {
        density = Number(densitySel.value) || 6;
        densitySel.addEventListener('change', function () {
          density = Number(densitySel.value) || 6;
        });
      }

      if (speedSel) {
        speedMul = Number(speedSel.value) || 1;
        speedSel.addEventListener('change', function () {
          speedMul = Number(speedSel.value) || 1;
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

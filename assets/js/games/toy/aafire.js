/* ==========================================================================
   aafire.js — the aalib fire demo, as characters.
   --------------------------------------------------------------------------
   There is no fire here. There is a grid of numbers, and one pass per frame
   in which each cell becomes the average of the cells below it minus a small
   random decay. Run that upward from a hot bottom edge and heat climbs a row
   per pass, spreading sideways as it goes and running out before the top.
   Everything that looks like flame is that one line of arithmetic.

   Two decisions worth writing down:

   1. WIND IS A WEIGHT, NOT A SHIFT. The obvious way to lean the flame is to
      sample from an offset column, which quantises to whole cells and makes
      the fire jump between three fixed slants. Instead the three samples from
      the row below carry weights 1+w, 1 and 1-w. They still sum to four, so
      it remains a true average — no energy is invented or lost by the wind,
      only moved — and w is continuous, so a half-strength breeze is really
      half a breeze.

   2. THE BED IS NOT RE-ROLLED EVERY FRAME. Two rows sit below the visible
      screen holding the source heat, and only about a quarter of their cells
      are given a new value each pass. Re-rolling all of them turns the base
      into uniform noise, the averaging smooths that into a flat orange band,
      and the fire loses its separate tongues. Persistence is what gives it
      hot cores that survive long enough to climb.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 78;
  var ROWS = 26;
  var HROWS = ROWS + 2;       // two extra rows, below the screen, are the fire bed

  /* The ramp does as much work as the physics. Ten steps from a full stop to
     a dollar sign, chosen for ink coverage rather than for looking like
     anything: '.' is a speck, '$' is nearly a solid cell, and the eye reads
     the gradient between them as heat. Swap in a ramp that is not ordered by
     density and the same buffer stops looking like fire immediately. */
  var RAMP = ' .:^*xsS#$';

  /* Blackbody, in the palette the terminal has: smoky gold at the tips, then
     red, orange, yellow, white at the bed. Index matches RAMP. */
  var TINT = [null, 'brown', 'brown', 'red', 'red', 'orange', 'orange', 'yellow', 'yellow', 'white'];

  /* decay is how much heat a cell loses climbing one row, so it sets the
     height; churn and hot set how fierce the bed is. */
  var LEVELS = {
    low: { decay: 0.062, churn: 0.20, hot: 0.62 },
    normal: { decay: 0.036, churn: 0.28, hot: 0.85 },
    high: { decay: 0.027, churn: 0.42, hot: 1.00 }
  };

  /* The flame rises exactly one row per pass, so this is the speed of the
     fire and not a frame rate. Above about forty it stops reading as flame
     and starts reading as static. */
  var FIRE_HZ = 32;

  TermShell.define({
    id: 'game-aafire',
    slug: 'aafire',
    title: 'aafire',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var heat = [];            // COLS * HROWS, values 0..1
      var bed = [];             // the persistent source row, COLS wide
      var acc = 0;
      var wind = 0;
      var level = LEVELS.normal;
      var lastFlame = -1;
      var lastAlight = -1;

      var windSel = document.getElementById('game-wind');
      var powerSel = document.getElementById('game-intensity');

      function readWind() {
        if (!windSel) return 0;
        /* parseFloat rather than Number(...) || 0, because the still setting
           is '0' and would be thrown away by the truthiness test. */
        var v = parseFloat(windSel.value);
        if (isNaN(v)) return 0;
        return Math.max(-1, Math.min(1, v));
      }

      function readLevel() {
        if (!powerSel) return LEVELS.normal;
        return LEVELS[powerSel.value] || LEVELS.normal;
      }

      if (windSel) {
        wind = readWind();
        windSel.addEventListener('change', function () { wind = readWind(); });
      }
      if (powerSel) {
        level = readLevel();
        powerSel.addEventListener('change', function () { level = readLevel(); });
      }

      /* Outside the grid is cold rather than mirrored, which is why the fire
         tapers at the left and right edges instead of sticking to them. */
      function at(x, y) {
        if (x < 0 || x >= COLS) return 0;
        return heat[y * COLS + x];
      }

      /* The ramp is spanned against the bed temperature rather than against
         1.0, so the hottest cells reach '$' on every setting. Fixing the top
         of the ramp at 1.0 instead meant the low setting never got past the
         middle of it and burned a dull, evenly grey fire. */
      function ink(v) {
        var n = Math.floor((v / level.hot) * RAMP.length);
        if (n < 1) return 0;
        return n > RAMP.length - 1 ? RAMP.length - 1 : n;
      }

      function cold() {
        var i;
        heat = [];
        for (i = 0; i < COLS * HROWS; i++) heat.push(0);
        bed = [];
        for (i = 0; i < COLS; i++) bed.push(0);
      }

      function stoke() {
        for (var x = 0; x < COLS; x++) {
          if (Math.random() >= level.churn) continue;
          /* Two thirds of the re-rolls are hot and one third is nearly cold,
             so the bed keeps gaps in it. A bed with no gaps burns as a wall. */
          bed[x] = Math.random() < 0.66
            ? level.hot * (0.72 + Math.random() * 0.28)
            : level.hot * Math.random() * 0.3;
        }
        for (var i = 0; i < COLS; i++) {
          heat[ROWS * COLS + i] = bed[i];
          heat[(ROWS + 1) * COLS + i] = bed[i];
        }
      }

      /* One pass, and it must run top row first. Start at the bottom instead
         and every row reads a row below that this same pass has already
         updated, so heat propagates the full height of the screen in one go
         and the fire stops moving — it becomes a static gradient. Going down
         the screen means each row reads the previous frame's value beneath
         it, which is what limits the climb to one row per pass. */
      function pass() {
        var wl = 1 + wind;
        var wr = 1 - wind;
        var top = ROWS;
        var lit = 0;
        var visible = level.hot * 0.1;      // the heat at which a cell first prints something

        for (var y = 0; y < ROWS; y++) {
          var b = y + 1;
          var b2 = y + 2;
          for (var x = 0; x < COLS; x++) {
            var v = (wl * at(x - 1, b) + at(x, b) + wr * at(x + 1, b) + at(x, b2)) / 4;
            /* The decay is randomised around its nominal value. A constant
               decay gives a flame with a smooth, obviously computed outline;
               the jitter is the whole of the flicker. */
            v -= level.decay * (0.35 + Math.random() * 1.3);
            if (v < 0) v = 0;
            heat[y * COLS + x] = v;
            if (v >= visible) {
              lit++;
              if (y < top) top = y;
            }
          }
        }

        var flame = ROWS - top;
        if (flame !== lastFlame) {
          lastFlame = flame;
          g.stat('flame', flame + (flame === 1 ? ' row' : ' rows'));
        }
        var pct = Math.round((lit / (COLS * ROWS)) * 100);
        if (pct !== lastAlight) {
          lastAlight = pct;
          g.stat('alight', pct + '%');
        }
      }

      return {
        reset: function () {
          cold();
          acc = 0;
          lastFlame = -1;
          lastAlight = -1;
          /* Burn in off-screen so the toy opens on a fire rather than on an
             empty grid that fills over the first second. */
          for (var i = 0; i < ROWS + 8; i++) { stoke(); pass(); }
        },

        update: function (dt) {
          acc += dt;
          var interval = 1 / FIRE_HZ;
          /* A while rather than an if, for the same reason every other game
             here uses one: a long frame must not leave the fire owing passes
             it never runs. */
          var guard = 0;
          while (acc >= interval && guard < 4) {
            acc -= interval;
            guard++;
            stoke();
            pass();
          }
          if (acc > interval) acc = interval;
        },

        draw: function (term) {
          term.clear();
          for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
              var n = ink(heat[y * COLS + x]);
              if (!n) continue;
              term.put(x, y, RAMP.charAt(n), TINT[n]);
            }
          }
        }
      };
    }
  });
})();

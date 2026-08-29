/* ==========================================================================
   game-of-life.js — Conway's Life.
   --------------------------------------------------------------------------
   Not a game: a zero-player automaton, which is exactly why it belongs in a
   section called toys. Four rules, no randomness after the seed, and
   behaviour nobody can predict from the rules alone.

   The grid WRAPS. An infinite plane is not available, and a bounded one
   quietly changes the rules at the edges — gliders die there, which makes
   the most famous pattern in the whole subject look broken. A torus keeps
   every cell with exactly eight neighbours.
   ========================================================================== */

(function () {
  'use strict';

  var W = 96;
  var H = 64;
  var CELL = 6;               // 96*6 = 576, 64*6 = 384

  /* Seeds worth having on a button. Coordinates are relative. */
  var PATTERNS = {
    glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
    gun: [
      [24, 0], [22, 1], [24, 1], [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
      [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3], [0, 4], [1, 4], [10, 4],
      [16, 4], [20, 4], [21, 4], [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5],
      [22, 5], [24, 5], [10, 6], [16, 6], [24, 6], [11, 7], [15, 7], [12, 8], [13, 8]
    ],
    pulsar: [
      [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
      [0, 2], [5, 2], [7, 2], [12, 2], [0, 3], [5, 3], [7, 3], [12, 3],
      [0, 4], [5, 4], [7, 4], [12, 4], [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
      [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
      [0, 8], [5, 8], [7, 8], [12, 8], [0, 9], [5, 9], [7, 9], [12, 9],
      [0, 10], [5, 10], [7, 10], [12, 10], [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12]
    ],
    rpentomino: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]
  };

  GameShell.define({
    id: 'game-game-of-life',
    slug: 'game-of-life',
    title: 'Game of Life',
    width: W * CELL,
    height: H * CELL,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var cur = new Uint8Array(W * H);
      var next = new Uint8Array(W * H);
      var gen = 0;
      var acc = 0;
      var speed = 12;             // generations a second
      var running = true;
      var painting = 0;           // 1 = drawing alive, 2 = erasing

      var speedSel = document.getElementById('game-speed');
      var patSel = document.getElementById('game-pattern');
      var runBtn = document.getElementById('game-run');
      var clearBtn = document.getElementById('game-clear');
      var randBtn = document.getElementById('game-random');

      if (speedSel) {
        speed = Number(speedSel.value) || 12;
        speedSel.addEventListener('change', function () { speed = Number(speedSel.value) || 12; });
      }
      if (patSel) patSel.addEventListener('change', function () { stamp(patSel.value); });
      if (runBtn) runBtn.addEventListener('click', function () {
        running = !running;
        /* 'Stop', not 'Pause': the shell's own Pause button sits two
           controls away, and two adjacent buttons both reading "Pause" —
           one freezing the loop, one the simulation — was a coin toss. */
        runBtn.textContent = running ? 'Stop' : 'Run';
      });
      if (clearBtn) clearBtn.addEventListener('click', function () { cur = new Uint8Array(W * H); gen = 0; });
      if (randBtn) randBtn.addEventListener('click', randomise);

      function idx(x, y) { return ((y + H) % H) * W + ((x + W) % W); }

      function randomise() {
        cur = new Uint8Array(W * H);
        for (var i = 0; i < cur.length; i++) cur[i] = Math.random() < 0.28 ? 1 : 0;
        gen = 0;
      }

      function stamp(name) {
        var pat = PATTERNS[name];
        if (!pat) return;
        cur = new Uint8Array(W * H);
        var ox = Math.floor(W / 2) - 18;
        var oy = Math.floor(H / 2) - 8;
        for (var i = 0; i < pat.length; i++) cur[idx(ox + pat[i][0], oy + pat[i][1])] = 1;
        gen = 0;
      }

      function step() {
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var n = 0;
            for (var dy = -1; dy <= 1; dy++) {
              for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                n += cur[idx(x + dx, y + dy)];
              }
            }
            var alive = cur[y * W + x];
            /* The four rules, as one line: a live cell survives on 2 or 3,
               a dead cell is born on exactly 3. */
            next[y * W + x] = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
          }
        }
        var swap = cur; cur = next; next = swap;
        gen++;
      }

      if (g.canvas) {
        var paint = function (event) {
          if (!painting) return;
          var p = g.pointAt(event);
          var x = Math.floor(p.x / CELL);
          var y = Math.floor(p.y / CELL);
          if (x < 0 || x >= W || y < 0 || y >= H) return;
          cur[y * W + x] = painting === 1 ? 1 : 0;
        };
        g.canvas.addEventListener('pointerdown', function (event) {
          var p = g.pointAt(event);
          var x = Math.floor(p.x / CELL), y = Math.floor(p.y / CELL);
          /* Drawing on a live cell erases, on a dead one draws — so one
             gesture both adds and removes without a mode switch. */
          painting = (x >= 0 && x < W && y >= 0 && y < H && cur[y * W + x]) ? 2 : 1;
          paint(event);
        });
        g.canvas.addEventListener('pointermove', paint);
        g.canvas.addEventListener('pointerup', function () { painting = 0; });
        g.canvas.addEventListener('pointerleave', function () { painting = 0; });
      }

      return {
        reset: function () {
          stamp('gun');
          running = true;
          if (runBtn) runBtn.textContent = 'Stop';
          g.stat('gen', 0);
        },

        key: function (name) {
          if (name === 'action') {
            running = !running;
            if (runBtn) runBtn.textContent = running ? 'Stop' : 'Run';
          }
        },

        update: function (dt) {
          if (!running) return;
          acc += dt;
          var interval = 1 / speed;
          var guard = 0;
          while (acc >= interval && guard < 8) { acc -= interval; step(); guard++; }
          g.stat('gen', gen);
          var alive = 0;
          for (var i = 0; i < cur.length; i++) alive += cur[i];
          g.stat('alive', alive);
        },

        draw: function (ctx) {
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, W * CELL, H * CELL);
          ctx.fillStyle = '#86efac';
          for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
              if (!cur[y * W + x]) continue;
              ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
            }
          }
        }
      };
    }
  });
})();

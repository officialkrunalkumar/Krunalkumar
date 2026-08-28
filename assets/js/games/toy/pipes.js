/* ==========================================================================
   pipes.js — the pipes screensaver, in a terminal.
   --------------------------------------------------------------------------
   Each pipe walks a cell at a time and, occasionally, turns. The only real
   work is choosing the right box-drawing character for a corner, which
   depends on BOTH the direction it came from and the direction it is going.
   A lookup keyed on "from,to" is four lines and gets every corner right;
   guessing from the new direction alone gets half of them backwards, which
   is the single most common way a pipes clone looks wrong.

   The screen is never cleared. Pipes paint over each other and the picture
   accumulates until it is full, which is the whole appeal — so the buffer
   is only wiped when it gets too dense to read.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 80;
  var ROWS = 26;

  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];    // N E S W

  /* "from,to" -> the character that joins them. `from` is the direction the
     pipe was travelling, `to` is the new one. */
  var CORNER = {
    '0,1': '┌', '0,3': '┐', '2,1': '└', '2,3': '┘',
    '1,0': '┘', '1,2': '┐', '3,0': '└', '3,2': '┌'
  };
  var STRAIGHT = { 0: '│', 2: '│', 1: '─', 3: '─' };

  var TINTS = ['green', 'cyan', 'blue', 'magenta', 'yellow', 'orange', 'white'];

  TermShell.define({
    id: 'game-pipes',
    slug: 'pipes',
    title: 'Pipes',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g, t) {
      var pipes = [];
      var chars = [];
      var tints = [];
      var filled = 0;
      var acc = 0;
      var speed = 26;              // cells a second
      var count = 4;

      var speedSel = document.getElementById('game-speed');
      var countSel = document.getElementById('game-count');
      if (speedSel) {
        speed = Number(speedSel.value) || 26;
        speedSel.addEventListener('change', function () { speed = Number(speedSel.value) || 26; });
      }
      if (countSel) {
        count = Number(countSel.value) || 4;
        countSel.addEventListener('change', function () { count = Number(countSel.value) || 4; seed(); });
      }

      function seed() {
        pipes = [];
        for (var i = 0; i < count; i++) {
          pipes.push({
            x: Math.floor(Math.random() * COLS),
            y: Math.floor(Math.random() * ROWS),
            d: Math.floor(Math.random() * 4),
            tint: TINTS[i % TINTS.length]
          });
        }
      }

      function wipe() {
        chars = [];
        tints = [];
        for (var i = 0; i < COLS * ROWS; i++) { chars.push(' '); tints.push('green'); }
        filled = 0;
      }

      function step() {
        for (var i = 0; i < pipes.length; i++) {
          var p = pipes[i];
          var from = p.d;

          /* Turn about one step in six. Any more and it scribbles; any less
             and it is four straight lines. */
          if (Math.random() < 0.17) {
            var turn = Math.random() < 0.5 ? 1 : 3;
            p.d = (p.d + turn) % 4;
          }

          var ch = from === p.d ? STRAIGHT[p.d] : CORNER[from + ',' + p.d];
          var idx = p.y * COLS + p.x;
          if (chars[idx] === ' ') filled++;
          chars[idx] = ch || STRAIGHT[p.d];
          tints[idx] = p.tint;

          p.x += DIRS[p.d][0];
          p.y += DIRS[p.d][1];

          /* Off the edge and back on the other side, with a fresh colour so
             the reappearance reads as a new pipe rather than a glitch. */
          if (p.x < 0) { p.x = COLS - 1; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
          if (p.x >= COLS) { p.x = 0; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
          if (p.y < 0) { p.y = ROWS - 1; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
          if (p.y >= ROWS) { p.y = 0; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
        }

        /* Once it is too dense to read, start again. The original waits a
           fixed number of frames; going by coverage looks better because a
           slow run is not cut short. */
        if (filled > COLS * ROWS * 0.72) { wipe(); seed(); }
      }

      return {
        reset: function () { wipe(); seed(); },

        update: function (dt) {
          acc += dt;
          var interval = 1 / speed;
          var guard = 0;
          while (acc >= interval && guard < 40) { acc -= interval; step(); guard++; }
          g.stat('filled', Math.round((filled / (COLS * ROWS)) * 100) + '%');
        },

        draw: function (term) {
          term.clear();
          for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
              var i = y * COLS + x;
              if (chars[i] === ' ') continue;
              term.put(x, y, chars[i], tints[i]);
            }
          }
          /* The heads, drawn brighter so you can follow one. */
          for (var p = 0; p < pipes.length; p++) {
            term.put(pipes[p].x, pipes[p].y, '●', 'white');
          }
        }
      };
    }
  });
})();

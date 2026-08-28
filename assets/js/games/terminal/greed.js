/* ==========================================================================
   greed.js — a grid of digits, and one very simple rule.
   --------------------------------------------------------------------------
   Matthew Day's greed (1989). The board is filled with the digits 1 to 9.
   You stand on one. Pick a direction, and you move that many squares that
   way, eating everything you cross. Those squares are gone. Move again.

   That is the entire game, and it is one of the best puzzles ever written
   for a terminal, because the difficulty comes from nowhere except your own
   past moves. There is no opponent, no clock, and no randomness after the
   deal — every dead end you reach, you built.

   The only real implementation decision is the legality check: a move is
   legal only if EVERY square along it is still there. Allowing a move that
   crosses an eaten square makes the game trivially easy and is the usual
   mistake in a rewrite.
   ========================================================================== */

(function () {
  'use strict';

  var W = 60;
  var H = 20;
  var OX = 1;
  var OY = 2;

  var DIRS = {
    up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0]
  };

  /* The tint ramp makes a 9 visibly more expensive than a 1, which is what
     lets you read the board at a glance instead of counting. */
  var TINT = ['dim', 'dim', 'green', 'green', 'cyan', 'cyan', 'blue', 'yellow', 'orange', 'red'];

  TermShell.define({
    id: 'game-greed',
    slug: 'greed',
    title: 'Greed',
    cols: 62,
    rows: 24,
    startTitle: 'Greed',
    startText: 'Arrows move you as far as the digit you are standing on. Everything you cross is eaten.',

    setup: function (g, t) {
      var cells = [];         // 0 = eaten
      var px = 0, py = 0;
      var eaten = 0;
      var total = W * H;

      function idx(x, y) { return y * W + x; }
      function inside(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }

      function deal() {
        cells = [];
        for (var i = 0; i < total; i++) cells.push(1 + Math.floor(Math.random() * 9));
        px = Math.floor(W / 2);
        py = Math.floor(H / 2);
        cells[idx(px, py)] = 0;
        eaten = 1;
      }

      /* A move is legal only if every square along the path is uneaten and
         inside the board. Returns the number of squares, or 0. */
      function moveLength(dir) {
        var d = DIRS[dir];
        if (!d) return 0;
        /* The distance is the digit you are ABOUT to step onto — the first
           square in that direction. Standing on an eaten square, which is
           always true after your first move, means the number that governs
           you is the one in front, not the one beneath. */
        var firstX = px + d[0], firstY = py + d[1];
        if (!inside(firstX, firstY) || !cells[idx(firstX, firstY)]) return 0;
        var n = cells[idx(firstX, firstY)];
        for (var s = 1; s <= n; s++) {
          var x = px + d[0] * s, y = py + d[1] * s;
          if (!inside(x, y) || !cells[idx(x, y)]) return 0;
        }
        return n;
      }

      function anyMove() {
        for (var k in DIRS) {
          if (Object.prototype.hasOwnProperty.call(DIRS, k) && moveLength(k)) return true;
        }
        return false;
      }

      function step(dir) {
        if (g.state !== 'playing') return;
        var n = moveLength(dir);
        if (!n) { g.beep(150, 0.05, 'square', 0.03); return; }
        var d = DIRS[dir];
        for (var s = 1; s <= n; s++) {
          var x = px + d[0] * s, y = py + d[1] * s;
          cells[idx(x, y)] = 0;
          eaten++;
        }
        px += d[0] * n;
        py += d[1] * n;
        g.addScore(n);
        g.stat('cleared', Math.round((eaten / total) * 100) + '%');
        g.beep(300 + n * 40, 0.04, 'sine', 0.04);

        if (!anyMove()) {
          var pct = Math.round((eaten / total) * 100);
          g.over({
            won: pct >= 90,
            score: g.score,
            title: pct >= 90 ? 'Nearly all of it' : 'Boxed in',
            message: pct + '% of the board cleared, and no legal move left.'
          });
        }
      }

      return {
        reset: function () {
          deal();
          g.stat('cleared', '0%');
        },

        key: function (name) {
          if (DIRS[name]) step(name);
        },

        draw: function (term) {
          term.clear();
          term.text(1, 0, 'GREED', 'green');
          term.text(9, 0, 'score ' + g.score + '   cleared ' + Math.round((eaten / total) * 100) + '%', 'dim');

          for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
              var v = cells[idx(x, y)];
              if (!v) continue;
              term.put(OX + x, OY + y, String(v), TINT[v]);
            }
          }
          term.put(OX + px, OY + py, '@', 'white');

          /* The legal moves, spelled out. Greed is a game about seeing what
             is left, and hiding that information does not make it harder,
             only more tedious. */
          var hint = '';
          var order = ['up', 'down', 'left', 'right'];
          var arrow = { up: '↑', down: '↓', left: '←', right: '→' };
          for (var i = 0; i < order.length; i++) {
            var n = moveLength(order[i]);
            hint += arrow[order[i]] + (n ? String(n) : '·') + '  ';
          }
          term.text(1, OY + H + 1, hint, 'dim');
        }
      };
    }
  });
})();

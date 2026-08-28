/* ==========================================================================
   connect-four.js — against a minimax opponent, or pass and play.
   --------------------------------------------------------------------------
   Connect Four is SOLVED: with perfect play the first player wins. This
   opponent is not perfect — it searches six plies with alpha-beta — but it
   is perfect at the two things that matter, because they fall out of the
   search rather than being special-cased: it always takes a win it can see,
   and it always blocks one of yours.

   The evaluation counts every window of four cells on the board and scores
   it by how many of each colour it holds. A window with three of yours and
   an empty is worth a lot; a window containing both colours is worth
   nothing, because nobody can ever complete it. That single rule is most of
   what makes it play sensibly.

   Centre columns are worth more, and that is not a heuristic anybody
   invented — a disc in the middle column participates in far more possible
   fours than one on the edge, so the bonus is really just counting.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 7;
  var ROWS = 6;
  var CELL = 74;
  var W = COLS * CELL;
  var H = ROWS * CELL + 54;      // room for a drop indicator on top
  var TOP = 54;

  var EMPTY = 0, YOU = 1, THEM = 2;

  GameShell.define({
    id: 'game-connect-four',
    slug: 'connect-four',
    title: 'Connect Four',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var board = [];              // ROWS * COLS
      var turn = YOU;
      var over = false;
      var winLine = null;
      var hover = 3;
      var thinking = 0;
      var mode = 'computer';
      var depth = 6;
      var message = '';
      var wins = [0, 0];

      var modeSel = document.getElementById('game-mode');
      var levelSel = document.getElementById('game-level');
      if (modeSel) {
        mode = g.load('mode', 'computer');
        if (mode !== 'computer' && mode !== 'pass') mode = 'computer';
        modeSel.value = mode;
        modeSel.addEventListener('change', function () {
          mode = modeSel.value; g.save('mode', mode); g.start();
        });
      }
      if (levelSel) {
        depth = Number(g.load('depth', '6')) || 6;
        levelSel.value = String(depth);
        levelSel.addEventListener('change', function () {
          depth = Number(levelSel.value) || 6; g.save('depth', depth);
        });
      }

      function at(c, r) { return board[r * COLS + c]; }
      function set(c, r, v) { board[r * COLS + c] = v; }

      function dropRow(c) {
        for (var r = ROWS - 1; r >= 0; r--) if (!at(c, r)) return r;
        return -1;
      }

      function legal() {
        var out = [];
        /* Centre-out ordering. Alpha-beta prunes far more when the best move
           is tried first, and in Connect Four the best move is nearly always
           near the middle. */
        var order = [3, 2, 4, 1, 5, 0, 6];
        for (var i = 0; i < order.length; i++) if (dropRow(order[i]) >= 0) out.push(order[i]);
        return out;
      }

      /* Every window of four, as start cell plus direction. Built once. */
      var WINDOWS = (function () {
        var out = [];
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            if (c + 3 < COLS) out.push([c, r, 1, 0]);
            if (r + 3 < ROWS) out.push([c, r, 0, 1]);
            if (c + 3 < COLS && r + 3 < ROWS) out.push([c, r, 1, 1]);
            if (c - 3 >= 0 && r + 3 < ROWS) out.push([c, r, -1, 1]);
          }
        }
        return out;
      })();

      function winnerLine() {
        for (var i = 0; i < WINDOWS.length; i++) {
          var w = WINDOWS[i];
          var first = at(w[0], w[1]);
          if (!first) continue;
          var ok = true;
          for (var k = 1; k < 4; k++) {
            if (at(w[0] + w[2] * k, w[1] + w[3] * k) !== first) { ok = false; break; }
          }
          if (ok) return { who: first, cells: [[w[0], w[1]], [w[0] + w[2], w[1] + w[3]],
            [w[0] + w[2] * 2, w[1] + w[3] * 2], [w[0] + w[2] * 3, w[1] + w[3] * 3]] };
        }
        return null;
      }

      function full() {
        for (var c = 0; c < COLS; c++) if (dropRow(c) >= 0) return false;
        return true;
      }

      function evaluate() {
        var score = 0;
        for (var i = 0; i < WINDOWS.length; i++) {
          var w = WINDOWS[i];
          var mine = 0, yours = 0;
          for (var k = 0; k < 4; k++) {
            var v = at(w[0] + w[2] * k, w[1] + w[3] * k);
            if (v === THEM) mine++;
            else if (v === YOU) yours++;
          }
          /* A window holding both colours can never be completed by anyone,
             so it is worth exactly nothing. Scoring it anyway is the classic
             mistake and makes the engine chase dead lines. */
          if (mine && yours) continue;
          if (mine === 3) score += 60;
          else if (mine === 2) score += 8;
          else if (mine === 1) score += 1;
          if (yours === 3) score -= 80;         // blocking is worth more than building
          else if (yours === 2) score -= 9;
          else if (yours === 1) score -= 1;
        }
        /* The centre column sits in more windows than any other, so a disc
           there is genuinely worth more. */
        for (var r = 0; r < ROWS; r++) {
          var mid = at(3, r);
          if (mid === THEM) score += 5;
          else if (mid === YOU) score -= 5;
        }
        return score;
      }

      function search(d, alpha, beta, maximising) {
        var line = winnerLine();
        if (line) return line.who === THEM ? 100000 + d : -100000 - d;
        if (full()) return 0;
        if (d <= 0) return evaluate();

        var moves = legal();
        if (maximising) {
          var best = -Infinity;
          for (var i = 0; i < moves.length; i++) {
            var r = dropRow(moves[i]);
            set(moves[i], r, THEM);
            var v = search(d - 1, alpha, beta, false);
            set(moves[i], r, EMPTY);
            if (v > best) best = v;
            if (best > alpha) alpha = best;
            if (alpha >= beta) break;
          }
          return best;
        }
        var worst = Infinity;
        for (var j = 0; j < moves.length; j++) {
          var r2 = dropRow(moves[j]);
          set(moves[j], r2, YOU);
          var v2 = search(d - 1, alpha, beta, true);
          set(moves[j], r2, EMPTY);
          if (v2 < worst) worst = v2;
          if (worst < beta) beta = worst;
          if (alpha >= beta) break;
        }
        return worst;
      }

      function bestColumn() {
        var moves = legal();
        if (!moves.length) return -1;
        var best = moves[0], bestV = -Infinity;
        for (var i = 0; i < moves.length; i++) {
          var r = dropRow(moves[i]);
          set(moves[i], r, THEM);
          var v = search(depth - 1, -Infinity, Infinity, false);
          set(moves[i], r, EMPTY);
          if (depth <= 3) v += Math.random() * 6;
          if (v > bestV) { bestV = v; best = moves[i]; }
        }
        return best;
      }

      function drop(c, who) {
        var r = dropRow(c);
        if (r < 0) return false;
        set(c, r, who);
        g.beep(who === YOU ? 420 : 320, 0.05, 'sine');

        var line = winnerLine();
        if (line) {
          over = true;
          winLine = line.cells;
          wins[line.who === YOU ? 0 : 1]++;
          g.stat('you', wins[0]);
          g.stat('them', wins[1]);
          g.over({
            won: mode === 'pass' ? true : line.who === YOU,
            title: mode === 'pass' ? (line.who === YOU ? 'Red wins' : 'Yellow wins')
                                   : (line.who === YOU ? 'You win' : 'They win'),
            message: 'Four in a row.'
          });
          return true;
        }
        if (full()) {
          over = true;
          g.over({ title: 'Full board', message: 'A draw — nobody got four.' });
          return true;
        }

        turn = who === YOU ? THEM : YOU;
        if (mode === 'computer' && turn === THEM) thinking = 0.35;
        message = mode === 'pass'
          ? (turn === YOU ? 'Red to play' : 'Yellow to play')
          : (turn === YOU ? 'Your turn' : 'Thinking…');
        return true;
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointermove', function (e) {
          var p = g.pointAt(e);
          hover = Math.max(0, Math.min(COLS - 1, Math.floor(p.x / CELL)));
        });
        g.canvas.addEventListener('pointerdown', function (e) {
          if (over || thinking > 0) return;
          if (mode === 'computer' && turn !== YOU) return;
          var p = g.pointAt(e);
          var c = Math.floor(p.x / CELL);
          if (c < 0 || c >= COLS) return;
          drop(c, turn);
        });
      }

      return {
        reset: function () {
          board = [];
          for (var i = 0; i < ROWS * COLS; i++) board.push(EMPTY);
          turn = YOU;
          over = false;
          winLine = null;
          thinking = 0;
          message = mode === 'pass' ? 'Red to play' : 'Your turn — you are red';
          g.stat('you', wins[0]);
          g.stat('them', wins[1]);
        },

        update: function (dt) {
          if (thinking > 0) {
            thinking -= dt;
            if (thinking <= 0) {
              thinking = 0;
              var c = bestColumn();
              if (c >= 0) drop(c, THEM);
            }
          }
        },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);

          // The disc waiting to drop
          if (!over && (mode === 'pass' || turn === YOU) && thinking <= 0) {
            ctx.beginPath();
            ctx.arc(hover * CELL + CELL / 2, TOP / 2, CELL * 0.3, 0, Math.PI * 2);
            ctx.fillStyle = turn === YOU ? 'rgba(248,113,113,0.75)' : 'rgba(250,204,21,0.75)';
            ctx.fill();
          }

          // The board
          ctx.fillStyle = '#1d4ed8';
          ctx.fillRect(0, TOP, W, ROWS * CELL);
          for (var r = 0; r < ROWS; r++) {
            for (var c = 0; c < COLS; c++) {
              var v = at(c, r);
              ctx.beginPath();
              ctx.arc(c * CELL + CELL / 2, TOP + r * CELL + CELL / 2, CELL * 0.38, 0, Math.PI * 2);
              ctx.fillStyle = v === YOU ? '#f87171' : v === THEM ? '#fbbf24' : '#0b1220';
              ctx.fill();
            }
          }

          if (winLine) {
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(winLine[0][0] * CELL + CELL / 2, TOP + winLine[0][1] * CELL + CELL / 2);
            ctx.lineTo(winLine[3][0] * CELL + CELL / 2, TOP + winLine[3][1] * CELL + CELL / 2);
            ctx.stroke();
          }

          if (message) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(message, 12, TOP / 2);
          }
        }
      };
    }
  });
})();

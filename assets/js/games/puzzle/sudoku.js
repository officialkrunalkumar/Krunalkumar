/* ==========================================================================
   sudoku.js — generated, not stored, and guaranteed to have one answer.
   --------------------------------------------------------------------------
   HOW A PUZZLE IS MADE, and why this order:
     1. Fill a complete valid grid by backtracking with shuffled candidates.
     2. Remove clues one at a time, in random order.
     3. After each removal, COUNT the solutions. Put the clue back if the
        count is not exactly one.

   Step 3 is the whole thing. Removing clues until the grid looks sparse
   enough produces puzzles with several answers, which feel broken in a way
   people cannot articulate: you fill it in correctly, and the checker says
   you are wrong. The solution counter stops at two, because "more than one"
   is all the information needed and counting them all is enormously slower.

   The generator runs to completion before the first paint, which takes a
   few tens of milliseconds — fast enough not to need a worker, slow enough
   that it happens in reset() rather than during the frame loop.
   ========================================================================== */

(function () {
  'use strict';

  var N = 9;
  var CELL = 58;
  var W = N * CELL;
  var H = N * CELL;

  var LEVELS = { easy: 40, medium: 32, hard: 27, expert: 24 };   // clues kept

  GameShell.define({
    id: 'game-sudoku',
    slug: 'sudoku',
    /* Declared here and not only in the manifest, because the manifest is
       build-time data: the generator never hands it to the runtime, so a
       tapAction set only there is a comment. The page copy for this game
       promises a tap does nothing; without this line it did something. */
    tapAction: false,
    title: 'Sudoku',
    width: W,
    height: H,
    bestKey: 'sudoku',
    bestOrder: 'low',
    formatBest: function (n) {
      var m = Math.floor(n / 60), s = n % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    startTitle: 'Sudoku',
    startText: 'Every puzzle is generated with exactly one solution. Tap a cell, then a number.',

    setup: function (g) {
      var puzzle = [];        // the givens, 0 for blank
      var grid = [];          // the current state
      var solution = [];
      var notes = [];         // 9 booleans per cell
      var sel = -1;
      var elapsed = 0;
      var noteMode = false;
      var level = 'medium';
      var mistakes = 0;

      var levelSel = document.getElementById('game-level');
      var noteBtn = document.getElementById('game-notes');
      var checkBtn = document.getElementById('game-check');

      if (levelSel) {
        level = g.load('level', 'medium');
        if (!LEVELS[level]) level = 'medium';
        levelSel.value = level;
        levelSel.addEventListener('change', function () {
          level = levelSel.value; g.save('level', level); g.start();
        });
      }
      if (noteBtn) {
        noteBtn.addEventListener('click', function () {
          noteMode = !noteMode;
          noteBtn.setAttribute('aria-pressed', String(noteMode));
        });
      }
      if (checkBtn) checkBtn.addEventListener('click', check);

      function idx(r, c) { return r * N + c; }

      function allowed(cells, r, c, v) {
        for (var i = 0; i < N; i++) {
          if (cells[idx(r, i)] === v) return false;
          if (cells[idx(i, c)] === v) return false;
        }
        var br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
        for (var y = 0; y < 3; y++) {
          for (var x = 0; x < 3; x++) {
            if (cells[idx(br + y, bc + x)] === v) return false;
          }
        }
        return true;
      }

      function shuffled() {
        var a = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      }

      function fill(cells, pos) {
        if (pos >= 81) return true;
        var r = Math.floor(pos / N), c = pos % N;
        var cand = shuffled();
        for (var i = 0; i < cand.length; i++) {
          if (!allowed(cells, r, c, cand[i])) continue;
          cells[idx(r, c)] = cand[i];
          if (fill(cells, pos + 1)) return true;
          cells[idx(r, c)] = 0;
        }
        return false;
      }

      /* Stops at two. "More than one" is the only thing the caller needs,
         and counting every solution of a sparse grid is orders of magnitude
         slower. */
      function countSolutions(cells, limit) {
        var pos = -1;
        for (var i = 0; i < 81; i++) if (!cells[i]) { pos = i; break; }
        if (pos === -1) return 1;
        var r = Math.floor(pos / N), c = pos % N;
        var total = 0;
        for (var v = 1; v <= 9; v++) {
          if (!allowed(cells, r, c, v)) continue;
          cells[pos] = v;
          total += countSolutions(cells, limit);
          cells[pos] = 0;
          if (total >= limit) return total;
        }
        return total;
      }

      function generate() {
        solution = [];
        for (var i = 0; i < 81; i++) solution.push(0);
        fill(solution, 0);

        var work = solution.slice();
        var order = [];
        for (var k = 0; k < 81; k++) order.push(k);
        for (var s = order.length - 1; s > 0; s--) {
          var j = Math.floor(Math.random() * (s + 1));
          var t = order[s]; order[s] = order[j]; order[j] = t;
        }

        var keep = LEVELS[level] || 32;
        var removed = 0;
        var target = 81 - keep;
        for (var o = 0; o < order.length && removed < target; o++) {
          var at = order[o];
          var saved = work[at];
          if (!saved) continue;
          work[at] = 0;
          /* Put it straight back if the grid now has more than one answer.
             This is the step that makes the puzzle honest. */
          if (countSolutions(work.slice(), 2) !== 1) work[at] = saved;
          else removed++;
        }
        puzzle = work.slice();
        grid = work.slice();
        notes = [];
        for (var n = 0; n < 81; n++) notes.push([false, false, false, false, false, false, false, false, false]);
      }

      function place(v) {
        if (sel < 0 || puzzle[sel]) return;
        if (noteMode && v) {
          notes[sel][v - 1] = !notes[sel][v - 1];
          return;
        }
        if (grid[sel] === v) { grid[sel] = 0; return; }
        grid[sel] = v;
        for (var i = 0; i < 9; i++) notes[sel][i] = false;
        if (v && v !== solution[sel]) {
          mistakes++;
          g.stat('mistakes', mistakes);
          g.beep(190, 0.06, 'square');
        } else if (v) {
          g.beep(560, 0.04, 'sine');
        }
        if (solved()) win();
      }

      function solved() {
        for (var i = 0; i < 81; i++) if (grid[i] !== solution[i]) return false;
        return true;
      }

      function win() {
        var secs = Math.floor(elapsed);
        g.over({
          won: true,
          score: secs,
          title: 'Solved',
          message: 'On ' + level + ', in ' + Math.floor(secs / 60) + ' minutes ' + (secs % 60) +
                   ' seconds, with ' + mistakes + ' wrong entries along the way.'
        });
      }

      function check() {
        var wrongCount = 0;
        for (var i = 0; i < 81; i++) if (grid[i] && grid[i] !== solution[i]) wrongCount++;
        g.beep(wrongCount ? 220 : 700, 0.08, wrongCount ? 'square' : 'sine');
        g.stat('mistakes', mistakes);
        showCheck = 1.8;
      }
      var showCheck = 0;

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (e) {
          var p = g.pointAt(e);
          var c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
          if (c < 0 || c >= N || r < 0 || r >= N) return;
          sel = idx(r, c);
        });
      }

      /* Number entry: the shell only gives arrows and space, so digits come
         from a keydown of our own — scoped to the shell element, which is
         where the shell binds too, so it cannot eat the page's own keys. */
      /* The on-screen number pad. There is no keyboard on a phone, and the
         shell only supplies arrows and space — so without this, sudoku is
         unplayable on the device most people will open it on. */
      if (g.el) {
        var pad = g.el.querySelector('.sudoku-pad');
        if (pad) {
          pad.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('[data-num]') : null;
            if (!btn) return;
            place(Number(btn.getAttribute('data-num')));
          });
        }
      }

      if (g.el) {
        g.el.addEventListener('keydown', function (e) {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key >= '1' && e.key <= '9') { e.preventDefault(); place(Number(e.key)); return; }
          if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); place(0); }
        });
      }

      return {
        reset: function () {
          generate();
          sel = -1;
          elapsed = 0;
          mistakes = 0;
          noteMode = false;
          if (noteBtn) noteBtn.setAttribute('aria-pressed', 'false');
          g.stat('mistakes', 0);
          g.stat('time', '0:00');
        },

        key: function (name) {
          if (sel < 0) sel = 40;
          var r = Math.floor(sel / N), c = sel % N;
          if (name === 'up') r = (r + N - 1) % N;
          else if (name === 'down') r = (r + 1) % N;
          else if (name === 'left') c = (c + N - 1) % N;
          else if (name === 'right') c = (c + 1) % N;
          sel = idx(r, c);
        },

        update: function (dt) {
          elapsed += dt;
          if (showCheck > 0) showCheck -= dt;
          var s = Math.floor(elapsed);
          g.stat('time', Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60));
        },

        draw: function (ctx) {
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(0, 0, W, H);

          // Highlight the selection's row, column and box
          if (sel >= 0) {
            var sr = Math.floor(sel / N), sc = sel % N;
            ctx.fillStyle = 'rgba(125,211,252,0.18)';
            ctx.fillRect(0, sr * CELL, W, CELL);
            ctx.fillRect(sc * CELL, 0, CELL, H);
            ctx.fillStyle = 'rgba(125,211,252,0.14)';
            ctx.fillRect(Math.floor(sc / 3) * 3 * CELL, Math.floor(sr / 3) * 3 * CELL, CELL * 3, CELL * 3);
            ctx.fillStyle = 'rgba(56,189,248,0.35)';
            ctx.fillRect(sc * CELL, sr * CELL, CELL, CELL);
          }

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (var r = 0; r < N; r++) {
            for (var c = 0; c < N; c++) {
              var i = idx(r, c);
              var v = grid[i];
              var x = c * CELL + CELL / 2, y = r * CELL + CELL / 2 + 2;
              if (v) {
                var wrong = showCheck > 0 && v !== solution[i];
                ctx.fillStyle = puzzle[i] ? '#0f172a' : wrong ? '#dc2626' : '#0369a1';
                ctx.font = (puzzle[i] ? 'bold ' : '') + '30px "Segoe UI", sans-serif';
                ctx.fillText(String(v), x, y);
              } else {
                ctx.font = '13px "Segoe UI", sans-serif';
                ctx.fillStyle = '#64748b';
                for (var n = 0; n < 9; n++) {
                  if (!notes[i][n]) continue;
                  ctx.fillText(String(n + 1), c * CELL + 12 + (n % 3) * 17, r * CELL + 14 + Math.floor(n / 3) * 16);
                }
              }
            }
          }

          // Grid lines: thin inside a box, thick between boxes.
          for (var k = 0; k <= N; k++) {
            ctx.strokeStyle = (k % 3 === 0) ? '#0f172a' : 'rgba(15,23,42,0.22)';
            ctx.lineWidth = (k % 3 === 0) ? 2.5 : 1;
            ctx.beginPath(); ctx.moveTo(k * CELL, 0); ctx.lineTo(k * CELL, H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, k * CELL); ctx.lineTo(W, k * CELL); ctx.stroke();
          }
        }
      };
    }
  });
})();

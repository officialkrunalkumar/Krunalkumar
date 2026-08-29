/* ==========================================================================
   bastet.js — "Bastard Tetris". The piece you get is the worst one available.
   --------------------------------------------------------------------------
   Federico Poloni's bastet (2005) replaced Tetris's random bag with a solver
   that asks, for each of the seven shapes, "how bad is this player's best
   possible outcome if I hand them this?" — and then hands them the worst.

   It is worth having next to /games/tetris precisely because that one uses a
   proper 7-bag: two games, identical rules, opposite generators. The fair
   one caps your worst drought at twelve pieces. This one is actively hunting
   for the shape you least want, every single time. Playing both is the
   fastest way to understand that "random" is a design decision and not a
   default.

   THE SEARCH. For each candidate shape, every rotation is dropped into every
   column, the resulting board is scored, and the shape keeps its BEST score
   — because that is what a competent player would achieve with it. The
   generator then serves the shape whose best is lowest. That is 7 shapes x 4
   rotations x 10 columns = 280 simulated drops per piece, which is nothing,
   and it is genuinely adversarial rather than merely biased.

   Scoring a board rewards low stacks, punishes holes hardest, and punishes
   bumpiness — the standard heuristic set, because the point is to model a
   decent player rather than a perfect one.

   THE SOUND. A line clear used to be the only thing this game made a noise
   about, which left the two hundred keypresses in between it silent — and a
   falling-block game with silent movement is the likeliest place on the
   whole site for a visitor to decide the sound button is broken. Every
   input now answers, and each answer owns a register so that four of them
   landing inside one second can still be told apart: slides and rotations
   are quiet ticks at the top, a lock is low and wooden, a clear is the only
   pitched figure, and the stack nearing the ceiling is the only thing that
   glides. There is no held layer. A Tetris board between locks really is
   silent, and giving it an atmosphere would be giving it a mood it does not
   have.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 10;
  var ROWS = 20;

  /* Grid origin inside the 40x24 character screen. */
  var OX = 3;
  var OY = 2;

  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
  };
  var NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  var TINT = { I: 'cyan', O: 'yellow', T: 'magenta', S: 'green', Z: 'red', J: 'blue', L: 'orange' };

  function rot(cells) {
    var n = cells.length, out = [];
    for (var y = 0; y < n; y++) { out.push([]); for (var x = 0; x < n; x++) out[y].push(cells[n - 1 - x][y]); }
    return out;
  }
  function clone(c) { var o = []; for (var i = 0; i < c.length; i++) o.push(c[i].slice()); return o; }

  TermShell.define({
    id: 'game-bastet',
    slug: 'bastet',
    title: 'Bastet',
    cols: 40,
    rows: 24,
    startTitle: 'Bastet',
    startText: 'Same rules as Tetris. The difference is that the piece generator is trying to end you.',

    setup: function (g, t) {
      var grid = [];
      var piece = null;
      var nextName = null;
      var lines = 0;
      var level = 1;
      var fallAcc = 0;

      function emptyGrid() {
        var out = [];
        for (var y = 0; y < ROWS; y++) { var row = []; for (var x = 0; x < COLS; x++) row.push(0); out.push(row); }
        return out;
      }

      function collides(cells, px, py, board) {
        for (var y = 0; y < cells.length; y++) {
          for (var x = 0; x < cells.length; x++) {
            if (!cells[y][x]) continue;
            var gx = px + x, gy = py + y;
            if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
            if (gy >= 0 && board[gy][gx]) return true;
          }
        }
        return false;
      }

      /* Drop a shape into a copy of the board and return the resulting
         board, or null if it does not fit at all. */
      function simulate(board, cells, px) {
        var py = -2;
        if (collides(cells, px, py, board)) return null;
        while (!collides(cells, px, py + 1, board)) py++;
        var copy = [];
        for (var y = 0; y < ROWS; y++) copy.push(board[y].slice());
        for (var cy = 0; cy < cells.length; cy++) {
          for (var cx = 0; cx < cells.length; cx++) {
            if (!cells[cy][cx]) continue;
            var gy = py + cy;
            if (gy < 0) return null;              // locked out above the ceiling
            copy[gy][px + cx] = 1;
          }
        }
        return copy;
      }

      /* Higher is better for the player. The weights are the well-known
         Dellacherie-ish set: holes dominate, then height, then bumpiness. */
      function scoreBoard(board) {
        var heights = [];
        var holes = 0;
        for (var x = 0; x < COLS; x++) {
          var h = 0, seen = false;
          for (var y = 0; y < ROWS; y++) {
            if (board[y][x]) { if (!seen) { seen = true; h = ROWS - y; } }
            else if (seen) holes++;
          }
          heights.push(h);
        }
        var cleared = 0;
        for (var r = 0; r < ROWS; r++) {
          var full = true;
          for (var c = 0; c < COLS; c++) if (!board[r][c]) { full = false; break; }
          if (full) cleared++;
        }
        var bump = 0, total = 0, max = 0;
        for (var i = 0; i < COLS; i++) {
          total += heights[i];
          if (heights[i] > max) max = heights[i];
          if (i) bump += Math.abs(heights[i] - heights[i - 1]);
        }
        return (cleared * 90) - (holes * 42) - (total * 1.4) - (bump * 2.1) - (max * 3.0);
      }

      /* The adversary. For each shape, the player's BEST achievable score;
         then serve whichever shape's best is worst. */
      function worstShape(board) {
        var worstName = null;
        var worstScore = Infinity;
        for (var n = 0; n < NAMES.length; n++) {
          var name = NAMES[n];
          var cells = clone(SHAPES[name]);
          var best = -Infinity;
          for (var r = 0; r < 4; r++) {
            for (var x = -2; x < COLS; x++) {
              var res = simulate(board, cells, x);
              if (!res) continue;
              var s = scoreBoard(res);
              if (s > best) best = s;
            }
            cells = rot(cells);
          }
          /* A shape with nowhere to go at all is the cruellest of the lot,
             but serving it is an instant loss and reads as a broken game
             rather than a hard one — so it is skipped unless every shape
             is like that. */
          if (best === -Infinity) continue;
          if (best < worstScore) { worstScore = best; worstName = name; }
        }
        return worstName || NAMES[Math.floor(Math.random() * NAMES.length)];
      }

      function spawn(name) {
        var cells = clone(SHAPES[name]);
        return {
          name: name,
          cells: cells,
          x: Math.floor((COLS - cells.length) / 2),
          y: name === 'I' ? -1 : 0
        };
      }

      function take() {
        var name = nextName || worstShape(grid);
        piece = spawn(name);
        nextName = worstShape(applyPiece(grid, piece));
        if (collides(piece.cells, piece.x, piece.y, grid)) {
          g.over({ message: lines + ' ' + (lines === 1 ? 'line' : 'lines') + ' against a generator that was picking your worst piece every time.' });
          return false;
        }
        return true;
      }

      /* A cheap projection used only to choose the NEXT piece: the current
         piece dropped straight down where it stands. Good enough to keep
         the adversary looking one move ahead. */
      function applyPiece(board, p) {
        var res = simulate(board, p.cells, p.x);
        return res || board;
      }

      function lock() {
        for (var y = 0; y < piece.cells.length; y++) {
          for (var x = 0; x < piece.cells.length; x++) {
            if (!piece.cells[y][x]) continue;
            var gy = piece.y + y;
            if (gy < 0) continue;
            grid[gy][piece.x + x] = piece.name;
          }
        }
        thunk();
        var cleared = 0;
        for (var r = ROWS - 1; r >= 0; r--) {
          var full = true;
          for (var c = 0; c < COLS; c++) if (!grid[r][c]) { full = false; break; }
          if (!full) continue;
          grid.splice(r, 1);
          var row = []; for (var q = 0; q < COLS; q++) row.push(0);
          grid.unshift(row);
          cleared++; r++;
        }
        if (cleared) {
          lines += cleared;
          g.addScore([0, 100, 300, 500, 800][cleared] * level);
          g.stat('lines', lines);
          level = Math.min(15, Math.floor(lines / 10) + 1);
          g.stat('level', level);
          g.beep(cleared === 4 ? 700 : 460, 0.09, 'square');
          if (cleared === 4) tetrisFigure();
        }
        warnIfHigh();
        take();
      }

      function move(dx, dy) {
        if (!piece) return false;
        if (collides(piece.cells, piece.x + dx, piece.y + dy, grid)) return false;
        piece.x += dx; piece.y += dy;
        return true;
      }

      /* Reports whether the piece actually turned. Nothing in the rules
         cares, but the sound does: a rotation that no kick could fit is a
         keypress that changed nothing, and a game that clicks at you for it
         is telling you the move worked. */
      function turn() {
        if (!piece || piece.name === 'O') return false;
        var turned = rot(piece.cells);
        var kicks = [0, -1, 1, -2, 2];
        for (var i = 0; i < kicks.length; i++) {
          if (!collides(turned, piece.x + kicks[i], piece.y, grid)) {
            piece.x += kicks[i]; piece.cells = turned; return true;
          }
        }
        return false;
      }

      /* ---------------------------------------------------------------
         The sound. See the header for what each register is for.
         --------------------------------------------------------------- */

      /* A column of movement. Noise rather than a tone, because this is the
         sound that fires most often by a wide margin: a fixed-pitch beep
         arriving thirteen times a second stops being a tick and becomes a
         note being held, and the ear then follows the pitch instead of the
         movement. Unpitched clicks stack into a rhythm and nothing else.

         The gate is what turns a held arrow from a buzz into a pulse. OS
         key repeat can arrive every 30 ms, and nobody taps an arrow twice
         inside 75 ms deliberately — so a deliberate move is never swallowed
         and only the repeat is thinned, to roughly half. Half of 33 a
         second is still countable as separate ticks; 33 is a tone.

         Soft drop is pointedly not in here. It is the one key held for a
         second at a time on purpose, a tick per row would be exactly the
         buzz this gate exists to prevent, and the lock at the end of it
         says the same thing better. */
      function tick() {
        if (!g.gate('move', 0.075)) return;
        g.noise(0.016, { type: 'highpass', freq: 2800, q: 0.7, level: 0.015 });
      }

      /* Rotation gets a pitched tick where a slide gets an unpitched one.
         Same length and the same quietness — they are siblings, not a
         hierarchy — but a rotation is much rarer than a slide, so it can
         afford to be the one carrying a pitch without becoming the sound
         the game makes. */
      function turnTick() {
        if (!g.gate('turn', 0.09)) return;
        g.beep(620, 0.028, 'sine', 0.028);
      }

      /* The landing. Two voices, because a knock is two things at once: the
         low sine carries the weight, and the noise burst with its lowpass
         falling through it carries the edge — the part that says wood
         rather than tone. Either alone is wrong. The sine on its own is a
         drum machine kick; the noise on its own is a puff of air.

         Deliberately the loudest of the routine sounds, and deliberately an
         octave and a half below the move tick, because a lock is the only
         thing here you cannot take back. No gate: a piece can lock at most
         once, and hard drop is the one key the shell refuses to auto-repeat
         for, so even a fast masher cannot get near the tick rate. */
      function thunk() {
        g.beep(98, 0.075, 'sine', 0.05);
        g.noise(0.07, { type: 'lowpass', freq: 480, to: 140, q: 0.9, level: 0.05 });
      }

      /* The hard drop, scaled by how far the piece actually fell. Dropping
         onto a stack one row below and dropping from the ceiling are the
         same keypress and should not be the same sound; the distance is
         already counted for the score, so reading it costs nothing.

         The bandpass falls through the burst, which is what makes it a
         descent rather than a hiss, and it lands in the register the thunk
         occupies in the same frame — the two overlap on purpose, because a
         hard drop is instantaneous and there is no gap to fill. A drop that
         moved nothing gets no whoosh at all: the piece was already resting,
         and the thunk is the whole truth of it. */
      function whoosh(n) {
        if (n <= 0) return;
        var k = Math.min(1, n / 16);
        g.noise(0.07 + k * 0.06, {
          type: 'bandpass',
          freq: 900 + k * 1200,
          to: 180,
          q: 1.2,
          level: 0.028 + k * 0.026
        });
      }

      /* Four lines at once was already the one event this game singled out,
         with a higher beep than the other clears get. That note is kept
         exactly as it was and is still the first thing you hear; it simply
         has somewhere to go now. 700, 1050, 1400 is a rising 2:3:4 — a
         fifth, then a fourth, an octave in all — and three notes is the
         shortest figure that reads as a phrase rather than as a beep that
         went on too long. Square throughout, because the note it grows out
         of is square and a change of instrument mid-figure would sound like
         two separate events.

         Scheduled with setTimeout because the shell's one-shots all start
         at the context's current time and take no offset, and a game has no
         business reaching into the AudioContext clock to lay out notes. The
         level falls as the pitch climbs so the figure keeps one loudness;
         at equal amplitude the ear hears the top note as the loudest. */
      function tetrisFigure() {
        setTimeout(function () { g.beep(1050, 0.08, 'square', 0.05); }, 80);
        setTimeout(function () { g.beep(1400, 0.16, 'square', 0.042); }, 165);
      }

      /* Rows from the ceiling that count as trouble. Five is about three
         pieces' worth of room, which against a generator that is choosing
         your worst piece is roughly the last moment the board is still
         recoverable. */
      var DANGER_ROWS = 5;

      /* The stack getting away from you — the only sound here that is about
         a condition rather than an event, and the only one that glides. It
         rises, where the shell's own game-over sound falls, so that the
         warning and the thing it is warning about can never be confused for
         each other when they land seconds apart.

         Five seconds between warnings. It is tested once per lock, so in
         practice that is every second or third piece: often enough that a
         board sitting in the danger zone keeps saying so, rare enough that
         it stays a warning instead of becoming the noise the game makes.
         The test also runs AFTER the rows have been cleared, never before —
         a clear that just bought back three rows has un-made the danger,
         and warning about a board that no longer exists is how a warning
         stops being believed. */
      function warnIfHigh() {
        for (var y = 0; y < DANGER_ROWS; y++) {
          for (var x = 0; x < COLS; x++) {
            if (!grid[y][x]) continue;
            if (g.gate('danger', 5)) g.sweep(130, 320, 0.5);
            return;
          }
        }
      }

      return {
        reset: function () {
          grid = emptyGrid();
          lines = 0; level = 1; fallAcc = 0;
          nextName = null;
          g.stat('lines', 0);
          g.stat('level', 1);
          take();
        },

        key: function (name) {
          if (!piece) return;
          if (name === 'left') { if (move(-1, 0)) tick(); }
          else if (name === 'right') { if (move(1, 0)) tick(); }
          else if (name === 'up') { if (turn()) turnTick(); }
          else if (name === 'down') { if (move(0, 1)) { g.addScore(1); fallAcc = 0; } }
          else if (name === 'action') {
            var n = 0;
            while (move(0, 1)) n++;
            g.addScore(n * 2);
            whoosh(n);
            lock();
          }
        },

        update: function (dt) {
          if (!piece) return;
          fallAcc += dt;
          var step = Math.max(0.06, 0.8 - (level - 1) * 0.055);
          while (fallAcc >= step) {
            fallAcc -= step;
            if (!move(0, 1)) { lock(); return; }
          }
        },

        draw: function (term) {
          term.clear();
          term.box(OX - 1, OY - 1, COLS * 2 + 2, ROWS + 2, 'dim');

          for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
              if (!grid[y][x]) continue;
              term.put(OX + x * 2, OY + y, '[', TINT[grid[y][x]] || 'green');
              term.put(OX + x * 2 + 1, OY + y, ']', TINT[grid[y][x]] || 'green');
            }
          }

          if (piece) {
            for (var cy = 0; cy < piece.cells.length; cy++) {
              for (var cx = 0; cx < piece.cells.length; cx++) {
                if (!piece.cells[cy][cx]) continue;
                var gy = piece.y + cy;
                if (gy < 0) continue;
                term.put(OX + (piece.x + cx) * 2, OY + gy, '[', TINT[piece.name]);
                term.put(OX + (piece.x + cx) * 2 + 1, OY + gy, ']', TINT[piece.name]);
              }
            }
          }

          var px = OX + COLS * 2 + 3;
          term.text(px, OY, 'BASTET', 'red');
          term.text(px, OY + 2, 'lines ' + lines, 'dim');
          term.text(px, OY + 3, 'level ' + level, 'dim');
          term.text(px, OY + 5, 'next', 'dim');
          if (nextName) {
            var s = SHAPES[nextName];
            for (var ny = 0; ny < s.length; ny++) {
              for (var nx = 0; nx < s.length; nx++) {
                if (!s[ny][nx]) continue;
                term.put(px + nx * 2, OY + 6 + ny, '[', TINT[nextName]);
                term.put(px + nx * 2 + 1, OY + 6 + ny, ']', TINT[nextName]);
              }
            }
          }
          term.text(px, OY + 12, 'it is', 'dim');
          term.text(px, OY + 13, 'picking', 'dim');
          term.text(px, OY + 14, 'your', 'dim');
          term.text(px, OY + 15, 'worst', 'red');
          term.text(px, OY + 16, 'piece.', 'red');
        }
      };
    }
  });
})();

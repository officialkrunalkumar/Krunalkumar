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

   SOUND SAYS WHERE THE DISC WENT, not merely that one was played. A drop is
   two sounds struck together: a fixed note that says whose disc it was, and
   a resonant rattle under it that slides DOWN in pitch and runs longer the
   further the disc had to fall, so a column filling up can be heard without
   being looked at. Four in a row gets its own short rising figure, struck at
   the moment the line exists rather than left to the shell's game-over sweep
   a beat later — the sweep says how it ended, the figure says what ended it.
   A tap on a full column buzzes, because a click answered by nothing at all
   is indistinguishable from a click the page never received, and the top of
   a full column looks like the top of any other one. There is no held layer:
   between moves this game is meant to be silent.
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

      /* --------------------------------------------------------------
         Sound. Three events and no bed, for the reason in the header:
         nothing here is a condition, everything is a thing that happened,
         and between two moves this game is supposed to be quiet.
         -------------------------------------------------------------- */

      /* A figure needs its notes offset from one another, and every one-shot
         the shell offers fires the instant it is called, so the offset has
         to live here. This is that offset and nothing else: no state the
         game reads is touched from inside the callback, so a note still in
         flight when the board is reset can only ever make a sound. */
      function after(ms, fn) { setTimeout(fn, ms); }

      /* The disc going in. Two facts have to land at once — whose disc it
         was, and how far it fell — and they are deliberately carried by two
         different sounds so that neither can blur the other.

         WHO is the note, and it is the note that was always here: a sine at
         420 for you, 320 for the engine. It does not move with the column or
         with the depth, because the moment it does, "my disc" and "a shallow
         drop" start to sound like each other.

         HOW FAR is the rattle underneath it. A bandpass slid DOWN across the
         burst is a thing falling, where the same noise held at one frequency
         is only a thing hissing, and the burst runs longer the further the
         disc has to go: into an empty column it falls six cells and takes
         well over twice as long about it as one landing on a stack of five.
         That difference is the whole point of the layer — a column filling
         up is audible without being looked at, which on a seven-column board
         is exactly the thing your eye is not on.

         The filter is narrow enough (q 7) to keep a definite pitch, so the
         fall stays in the same voice as the note above it instead of turning
         into a hiss, and it sits below that note in level because it is on
         every single move while everything else here is rare.

         r is the row the disc settles in, counted from the top, so r + 1 is
         the number of cells it fell through. */
      function dropNote(who, r) {
        var base = who === YOU ? 420 : 320;
        var fall = (r + 1) / ROWS;
        g.beep(base, 0.05, 'sine');
        g.noise(0.07 + fall * 0.15, {
          type: 'bandpass',
          freq: base * 2.6,
          to: base * (0.95 - fall * 0.45),
          q: 7,
          level: 0.04
        });
      }

      /* A tap on a column with no room left. It is the only click in the
         game that is answered by nothing at all, and silence made it
         indistinguishable from a click the page never received — worse here
         than in most games, because the disc waiting at the top of a full
         column is drawn exactly like the disc waiting at the top of any
         other one. Low, short and soft, so it reads as the board declining
         rather than as a penalty for asking.

         Gated because a full column stays full: this is the one sound in the
         file a player can retrigger as fast as they can tap, and four
         overlapping sawtooths at one pitch are far louder and nastier than
         one of them. */
      function fullNote() {
        if (!g.gate('full', 0.14)) return;
        g.beep(98, 0.12, 'sawtooth', 0.04);
      }

      /* Four in a row, struck the instant the line exists and ahead of the
         shell's game-over sweep. Left to the sweep alone the win arrives a
         beat late and in a sound every game on the site shares; this way the
         line landing has a noise of its own, at the moment it lands, and the
         sweep that follows is left saying only how the game ended.

         Root, fifth, octave on plucked triangles. Those intervals are doing
         two jobs: an open fifth and an octave read as "arrived" rather than
         as a fanfare, which matters because against the computer this fires
         when the ENGINE completes a four as well — and a triangle stays
         clear of the sawtooth the shell is about to sweep underneath it,
         where a third rising sawtooth would simply have been swallowed. The
         engine's figure sits a third lower, the same distance its disc note
         sits below yours. */
      function fourNote(who) {
        var base = who === YOU ? 523 : 415;
        g.pluck(base, 0.14, 0.05, 'triangle');
        after(85, function () { g.pluck(base * 1.5, 0.14, 0.05, 'triangle'); });
        after(170, function () { g.pluck(base * 2, 0.3, 0.055, 'triangle'); });
      }

      function drop(c, who) {
        var r = dropRow(c);
        if (r < 0) return false;
        set(c, r, who);
        dropNote(who, r);

        var line = winnerLine();
        if (line) {
          over = true;
          winLine = line.cells;
          wins[line.who === YOU ? 0 : 1]++;
          g.stat('you', wins[0]);
          g.stat('them', wins[1]);
          fourNote(line.who);
          g.over({
            won: mode === 'pass' ? true : line.who === YOU,
            title: mode === 'pass' ? (line.who === YOU ? 'Red wins' : 'Yellow wins')
                                   : (line.who === YOU ? 'You win' : 'They win'),
            message: 'Four in a row.',
            /* Connect Four is won or lost, never scored. Without this the
               shell falls back to this.score — a zero nobody set — and
               prints it on the end card as if it were a result. */
            hideScore: true
          });
          return true;
        }
        if (full()) {
          over = true;
          g.over({
            title: 'Full board',
            message: 'A draw — nobody got four.',
            hideScore: true
          });
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
          /* drop() is false for exactly one reason — the column has no room
             left — so the refusal hangs off its return value rather than
             asking dropRow the same question a second time here. */
          if (!drop(c, turn)) fullNote();
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

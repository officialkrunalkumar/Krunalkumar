/* ==========================================================================
   gomoku.js — five in a row on 15x15, against a threat-scoring opponent.
   --------------------------------------------------------------------------
   Two decisions here are worth writing down, and both are about the same
   thing: telling a threat that must be answered from one that can be ignored.

   1. NO SEARCH, ON PURPOSE. connect-four.js in the folder next door gets a
      six-ply alpha-beta, because seven columns is a branching factor you can
      afford. Gomoku offers two hundred-odd legal moves in the middlegame, so
      the same search would not reach three ply, and it does not need to.
      Gomoku is decided by forcing sequences, and every forcing move is
      already visible in the position: a four must be blocked this turn, an
      open three must be blocked next turn, and a move that makes two of
      those at once has won. Scoring every line a candidate square sits on,
      for both colours, sees all of that one move out. And because the score
      is a SUM over the four directions, a square that creates two threats
      beats one that creates a single larger one — without that ever being
      written down as a rule.

   2. OPEN AND CLOSED ARE COUNTED, NOT MATCHED. The usual implementation
      keeps a table of pattern strings — ".XXX.", "OXXX.", ".X.XX." — and
      that table is always missing a case. Here every five-cell window
      through the square is examined instead, a window holding an enemy stone
      is discarded outright because nobody can ever complete it, and what
      decides the verdict is how many DISTINCT empty squares would finish the
      best of them. Two completion points is an open four; one is a plain
      four. A three counts as open when some single addition turns it into a
      four with two completion points — which is the definition rather than a
      proxy for it, and is why the broken three .X.XX. is recognised here
      with no special case of its own.

   Free-style rules: five or more wins and there are no forbidden openings.
   That is the version people actually play away from a tournament table.
   ========================================================================== */

(function () {
  'use strict';

  var N = 15;
  var EMPTY = 0, BLACK = 1, WHITE = 2;

  /* I is skipped, as it is on a Go board, so nobody has to decide whether a
     column letter is a one. Fifteen letters for fifteen files. */
  var LETTERS = 'ABCDEFGHJKLMNOP';

  /* Four directions, not eight: a line and its reverse are the same line. */
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

  var OX = 4, OY = 3;          // board origin, in character cells
  var PX = 35;                 // side panel column

  /* The gaps between the tiers are wide because the tiers are not really
     comparable quantities — an open four has already won, a four merely
     forces a reply. Two open threes summing past one plain four is the
     ordering that makes the engine play a double threat over a single one. */
  var FIVE = 1000000;
  var OPEN4 = 100000;
  var FOUR = 10000;
  var OPEN3 = 8000;
  var THREE = 600;
  var OPEN2 = 300;
  var TWO = 40;
  var ONE = 6;

  var LEVEL_NAME = ['', 'casual', 'sharp', 'ruthless'];

  /* Scratch buffers, reused for every window scan. A gomoku engine scores a
     few hundred thousand cells per move; allocating an array inside that is
     the difference between instant and a visible stutter on a phone. */
  var LINE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var SEEN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  var PTS_A = [];
  var PTS_B = [];

  TermShell.define({
    id: 'game-gomoku',
    slug: 'gomoku',
    title: 'Gomoku',
    cols: 46,
    rows: 24,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,

    setup: function (g, t) {
      var board = [];
      var turn = BLACK;
      var mode = 'computer';
      var level = 2;
      var cx = 7, cy = 7;
      var moves = 0;
      var last = -1;
      var winCells = null;
      var thinking = 0;
      var wins = [0, 0];
      var message = '';

      var modeSel = document.getElementById('game-mode');
      var levelSel = document.getElementById('game-level');

      if (modeSel) {
        mode = g.load('mode', 'computer');
        if (mode !== 'computer' && mode !== 'pass') mode = 'computer';
        modeSel.value = mode;
        modeSel.addEventListener('change', function () {
          mode = modeSel.value;
          g.save('mode', mode);
          /* Swapping sides mid-game would leave a position nobody agreed to,
             so changing the mode deals a fresh board. */
          g.start();
        });
      }

      if (levelSel) {
        level = Number(g.load('level', '2')) || 2;
        if (level < 1 || level > 3) level = 2;
        levelSel.value = String(level);
        levelSel.addEventListener('change', function () {
          level = Number(levelSel.value) || 2;
          g.save('level', level);
        });
      }

      function idx(x, y) { return y * N + x; }
      function inside(x, y) { return x >= 0 && x < N && y >= 0 && y < N; }
      function other(who) { return who === BLACK ? WHITE : BLACK; }
      function coord(i) { return LETTERS.charAt(i % N) + String(((i / N) | 0) + 1); }

      /* ----------------------------------------------------------------
         Threat classification. See decision 2 in the header.
         ---------------------------------------------------------------- */

      /* Eleven cells centred on the candidate square, with the hypothetical
         stone written into the middle. Off-board reads as 3, which is
         neither colour and therefore blocks a window just like an enemy
         stone does — the edge of the board really is a wall. */
      function extract(x, y, dx, dy, me) {
        for (var k = -5; k <= 5; k++) {
          var xx = x + dx * k, yy = y + dy * k;
          LINE[k + 5] = inside(xx, yy) ? board[idx(xx, yy)] : 3;
        }
        LINE[5] = me;
      }

      /* The most stones of "me" in any clean five-window between starts
         lo and hi. A window with an enemy stone in it is dead and scores
         nothing at all, which is the one rule that stops the engine
         chasing lines that can never be completed. */
      function scanBest(L, lo, hi, me) {
        var best = 0;
        for (var s = lo; s <= hi; s++) {
          var cnt = 0, ok = true;
          for (var k = 0; k < 5; k++) {
            var v = L[s + k];
            if (v === me) cnt++;
            else if (v !== EMPTY) { ok = false; break; }
          }
          if (ok && cnt > best) best = cnt;
        }
        return best;
      }

      /* Distinct empty squares inside the clean windows that hold exactly
         "want" stones. The COUNT is the whole point: two means the shape
         can be completed two different ways, which is what "open" means. */
      function scanPoints(L, lo, hi, me, want, out) {
        var n = 0, i, s, k;
        for (i = 0; i < 11; i++) SEEN[i] = 0;
        out.length = 0;
        for (s = lo; s <= hi; s++) {
          var cnt = 0, ok = true;
          for (k = 0; k < 5; k++) {
            var v = L[s + k];
            if (v === me) cnt++;
            else if (v !== EMPTY) { ok = false; break; }
          }
          if (!ok || cnt !== want) continue;
          for (k = 0; k < 5; k++) {
            var j = s + k;
            if (L[j] === EMPTY && !SEEN[j]) { SEEN[j] = 1; out.push(j); n++; }
          }
        }
        return n;
      }

      function classify(L, me) {
        /* Only windows containing the middle count, because the middle is
           the square being considered — a threat somewhere else along the
           same line is not this move's doing. */
        var best = scanBest(L, 1, 5, me);
        if (best >= 5) return FIVE;

        if (best === 4) {
          return scanPoints(L, 1, 5, me, 4, PTS_A) >= 2 ? OPEN4 : FOUR;
        }

        if (best === 3) {
          var m = scanPoints(L, 1, 5, me, 3, PTS_A);
          for (var i = 0; i < m; i++) {
            var p = PTS_A[i];
            L[p] = me;
            /* Widened to every window in the buffer: adding a stone two
               squares out can make a four that the centred windows miss. */
            var b2 = scanBest(L, 0, 6, me);
            var open = b2 >= 5 || (b2 === 4 && scanPoints(L, 0, 6, me, 4, PTS_B) >= 2);
            L[p] = EMPTY;
            if (open) return OPEN3;
          }
          return THREE;
        }

        if (best === 2) return scanPoints(L, 1, 5, me, 2, PTS_A) >= 4 ? OPEN2 : TWO;
        if (best === 1) return ONE;
        return 0;
      }

      /* What the square is worth to "me", summed over all four lines. */
      function scoreAt(x, y, me) {
        var total = 0;
        for (var d = 0; d < 4; d++) {
          extract(x, y, DIRS[d][0], DIRS[d][1], me);
          total += classify(LINE, me);
        }
        return total;
      }

      /* ----------------------------------------------------------------
         Rules
         ---------------------------------------------------------------- */
      function fiveFrom(x, y, who) {
        for (var d = 0; d < 4; d++) {
          var dx = DIRS[d][0], dy = DIRS[d][1];
          var a = 1, b = 1;
          while (inside(x - dx * a, y - dy * a) && board[idx(x - dx * a, y - dy * a)] === who) a++;
          a--;
          while (inside(x + dx * b, y + dy * b) && board[idx(x + dx * b, y + dy * b)] === who) b++;
          b--;
          if (a + b + 1 >= 5) {
            var cells = [];
            for (var k = -a; k <= b; k++) cells.push(idx(x + dx * k, y + dy * k));
            return cells;
          }
        }
        return null;
      }

      function inWin(i) {
        if (!winCells) return false;
        for (var k = 0; k < winCells.length; k++) if (winCells[k] === i) return true;
        return false;
      }

      /* ----------------------------------------------------------------
         The opponent
         ---------------------------------------------------------------- */

      /* Only empty squares within "r" of a stone. On an empty 225-square
         board every move is legal but almost all of them are meaningless:
         a stone nowhere near another stone cannot make or stop a line. */
      function candidates(r) {
        var out = [];
        for (var y = 0; y < N; y++) {
          for (var x = 0; x < N; x++) {
            if (board[idx(x, y)]) continue;
            var near = false;
            for (var j = -r; j <= r && !near; j++) {
              for (var i = -r; i <= r; i++) {
                var xx = x + i, yy = y + j;
                if (inside(xx, yy) && board[idx(xx, yy)]) { near = true; break; }
              }
            }
            if (near) out.push(idx(x, y));
          }
        }
        return out;
      }

      function bestGain(who) {
        var cs = candidates(2);
        var best = 0;
        for (var i = 0; i < cs.length; i++) {
          var v = scoreAt(cs[i] % N, (cs[i] / N) | 0, who);
          if (v > best) best = v;
        }
        return best;
      }

      function chooseMove() {
        var cs = candidates(2);
        if (!cs.length) return idx(7, 7);

        /* How heavily the engine weighs what YOU would gain from a square
           against what it would gain itself. At 1.0 it blocks as hard as it
           attacks; casual drops it so that it misses threats a beginner is
           still learning to make. */
        var defence = level === 1 ? 0.55 : level === 2 ? 0.9 : 1;
        var jitter = level === 1 ? 4000 : level === 2 ? 250 : 0;

        var scored = [];
        for (var i = 0; i < cs.length; i++) {
          var x = cs[i] % N, y = (cs[i] / N) | 0;
          /* The centre nudge is not a style choice: a stone in the middle
             sits on more possible fives than one at the edge, so it is
             worth more by counting alone. */
          var centre = 14 - (Math.abs(x - 7) + Math.abs(y - 7));
          var v = scoreAt(x, y, WHITE) + scoreAt(x, y, BLACK) * defence +
                  centre * 3 + Math.random() * jitter;
          scored.push({ i: cs[i], v: v });
        }
        scored.sort(function (a, b) { return b.v - a.v; });

        /* Ruthless looks one reply further, and only at the six squares that
           already scored best. That is not a search — it is the same
           evaluation run once more — but it is enough to stop the engine
           building a threat that hands you a bigger one in return. */
        if (level >= 3) {
          var top = Math.min(6, scored.length);
          for (var k = 0; k < top; k++) {
            board[scored[k].i] = WHITE;
            scored[k].v -= bestGain(BLACK) * 0.9;
            board[scored[k].i] = EMPTY;
          }
          var pick = scored[0];
          for (var m = 1; m < top; m++) if (scored[m].v > pick.v) pick = scored[m];
          return pick.i;
        }

        return scored[0].i;
      }

      /* ----------------------------------------------------------------
         Turn flow
         ---------------------------------------------------------------- */
      function setMessage() {
        if (winCells) return;
        if (mode === 'pass') message = (turn === BLACK ? 'Black (X) to play.' : 'White (O) to play.');
        else message = turn === BLACK ? 'Your move.' : 'Thinking…';
      }

      function place(x, y, who) {
        var i = idx(x, y);
        if (board[i]) return false;
        board[i] = who;
        last = i;
        moves++;
        g.stat('moves', moves);
        g.beep(who === BLACK ? 470 : 340, 0.05, 'sine', 0.05);

        var five = fiveFrom(x, y, who);
        if (five) {
          winCells = five;
          wins[who === BLACK ? 0 : 1]++;
          g.stat('black', wins[0]);
          g.stat('white', wins[1]);
          message = (who === BLACK ? 'X' : 'O') + ' has five in a row.';
          /* Paint before ending. over() cancels the animation frame, so
             without this the final stone never reaches the screen. */
          g.render();
          g.over({
            won: mode === 'pass' ? true : who === BLACK,
            title: mode === 'pass' ? (who === BLACK ? 'Black wins' : 'White wins')
                                   : (who === BLACK ? 'You win' : 'They win'),
            message: 'Five in a row, from ' + coord(five[0]) + ' to ' + coord(five[five.length - 1]) + '.'
          });
          return true;
        }

        if (moves >= N * N) {
          message = 'Board full — a draw.';
          g.render();
          g.over({ title: 'Full board', message: 'All 225 points played and nobody made five.' });
          return true;
        }

        turn = other(who);
        if (mode === 'computer' && turn === WHITE) thinking = 0.3;
        setMessage();
        g.render();
        return true;
      }

      function moveCursor(dx, dy) {
        cx = Math.max(0, Math.min(N - 1, cx + dx));
        cy = Math.max(0, Math.min(N - 1, cy + dy));
      }

      function tryPlace() {
        if (g.state !== 'playing' || winCells) return;
        if (thinking > 0) return;
        if (mode === 'computer' && turn !== BLACK) return;
        if (board[idx(cx, cy)]) { g.beep(150, 0.05, 'square', 0.03); return; }
        place(cx, cy, turn);
      }

      /* Pointer input moves the cursor onto the point you touched, and the
         shell's own tap-to-act then places there. One tap, one stone, and
         the same cursor a keyboard player is steering — rather than two
         separate notions of "where the next move goes". */
      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          var p = g.pointAt(event);
          var bx = Math.round((Math.floor(p.x / 8) - OX) / 2);
          var by = Math.floor(p.y / 16) - OY;
          if (bx >= 0 && bx < N && by >= 0 && by < N) { cx = bx; cy = by; }
        });
      }

      function isStar(x, y) {
        return (x === 7 && y === 7) ||
               ((x === 3 || x === 11) && (y === 3 || y === 11));
      }

      return {
        reset: function () {
          board = [];
          for (var i = 0; i < N * N; i++) board.push(EMPTY);
          turn = BLACK;
          moves = 0;
          last = -1;
          winCells = null;
          thinking = 0;
          cx = 7;
          cy = 7;
          g.stat('black', wins[0]);
          g.stat('white', wins[1]);
          g.stat('moves', 0);
          setMessage();
        },

        key: function (name) {
          if (g.state !== 'playing') return;
          if (name === 'up') moveCursor(0, -1);
          else if (name === 'down') moveCursor(0, 1);
          else if (name === 'left') moveCursor(-1, 0);
          else if (name === 'right') moveCursor(1, 0);
          else if (name === 'action') tryPlace();
        },

        update: function (dt) {
          if (thinking <= 0) return;
          thinking -= dt;
          if (thinking > 0) return;
          thinking = 0;
          if (winCells || mode !== 'computer' || turn !== WHITE) return;
          var move = chooseMove();
          place(move % N, (move / N) | 0, WHITE);
        },

        draw: function (term) {
          term.clear();
          term.text(1, 0, 'GOMOKU', 'green');
          term.text(9, 0, 'five in a row on a 15×15 board', 'dim');

          var x, y;
          for (x = 0; x < N; x++) term.put(OX + x * 2, OY - 1, LETTERS.charAt(x), 'dark');

          for (y = 0; y < N; y++) {
            var label = String(y + 1);
            term.text(2 - label.length, OY + y, label, 'dark');
            for (x = 0; x < N; x++) {
              var i = y * N + x;
              var v = board[i];
              var ch = v === BLACK ? 'X' : v === WHITE ? 'O' : (isStar(x, y) ? '+' : '·');
              var col = v === BLACK ? 'cyan' : v === WHITE ? 'orange' : 'dim';
              if (v && inWin(i)) col = 'white';
              else if (v && i === last) col = 'yellow';
              term.put(OX + x * 2, OY + y, ch, col);
            }
          }

          /* The cursor is bracketed rather than inverted, so it never hides
             the stone or the grid point underneath it. Red when the square
             is taken, which is the whole of the "you cannot play there"
             feedback a player needs before they press. */
          var yours = mode === 'pass' || turn === BLACK;
          if (g.state === 'playing' && !winCells && yours && thinking <= 0) {
            var cc = board[idx(cx, cy)] ? 'red' : 'white';
            term.put(OX + cx * 2 - 1, OY + cy, '[', cc);
            term.put(OX + cx * 2 + 1, OY + cy, ']', cc);
          }

          term.text(PX, 3, 'MODE', 'dark');
          term.text(PX, 4, mode === 'computer' ? 'computer' : 'two human', 'dim');
          term.text(PX, 6, 'STONES', 'dark');
          term.text(PX, 7, 'X ' + (mode === 'computer' ? 'you' : 'black'), 'cyan');
          term.text(PX, 8, 'O ' + (mode === 'computer' ? 'cpu' : 'white'), 'orange');
          term.text(PX, 10, 'MOVES', 'dark');
          term.text(PX, 11, String(moves), 'dim');
          term.text(PX, 13, 'LAST', 'dark');
          term.text(PX, 14, last < 0 ? '—' : coord(last), 'dim');
          term.text(PX, 16, 'POINT', 'dark');
          term.text(PX, 17, LETTERS.charAt(cx) + String(cy + 1), 'dim');
          if (mode === 'computer') {
            term.text(PX, 19, 'ENGINE', 'dark');
            term.text(PX, 20, LEVEL_NAME[level], 'dim');
          }

          term.text(1, 19, message, winCells ? 'white' : 'green');
          term.text(1, 21, '↑↓←→ move   Space place   or tap a point', 'dim');
        }
      };
    }
  });
})();

/* ==========================================================================
   chess.js — full-rules chess against a minimax engine.
   --------------------------------------------------------------------------
   BOARD REPRESENTATION is 0x88: a 16x8 array where a square is off the board
   if (index & 0x88) is non-zero. That one bitwise test replaces four range
   comparisons in every direction of every slide, which is the whole reason
   the classic trick exists. Ranks are 0..7 from black's back rank down.

   LEGALITY IS CHECKED BY MAKING THE MOVE. Generating pseudo-legal moves and
   then discarding any that leave your own king attacked is slower than
   computing pins directly, and about a tenth of the code. At the depths this
   searches, correctness is worth far more than the speed.

   Everything the rules actually require is here: castling both sides with
   the right-to-castle tracked per rook, en passant with the capture square,
   promotion (to a queen — under-promotion is a UI nobody wants on a phone),
   stalemate, insufficient material, threefold repetition, and the
   fifty-move counter.

   THE ENGINE is negamax with alpha-beta and a quiescence search on captures.
   Without quiescence it plays a bishop en prise on the last ply of the
   search and calls it winning, because the recapture is one move past the
   horizon; that single addition is the difference between an opponent that
   blunders constantly and one that does not.

   SOUND CARRIES THE MOVE, NOT AN ATMOSPHERE. There is no held layer here: a
   board game between moves is silent, and a hum under a game people take
   their time over would be an imposition rather than an atmosphere. What
   there is instead is one short sound per thing that actually happened, and
   they are chosen to be told apart rather than to be pretty — a capture from
   a quiet move, a castle from both, a promotion from all three, and the
   engine's move from yours. Check gets the only square wave and the only
   rising tritone in the file, because it is the one thing a player must not
   miss while reading the far corner of the board. A refused move buzzes,
   because a click that does nothing is indistinguishable from a click the
   page never received, and a pinned piece does not look pinned. Mate,
   stalemate and the draws stay silent here: they end the game, and the
   shell's game-over already sounds.
   ========================================================================== */

(function () {
  'use strict';

  var EMPTY = 0;
  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var WHITE = 8, BLACK = 16;

  var VALUE = [0, 100, 320, 330, 500, 900, 20000];

  /* Piece-square tables, white's point of view, a8 first. Standard
     "simplified evaluation" values — knights want the middle, pawns want to
     advance, the king wants to be tucked away until the endgame. */
  var PST = {};
  PST[P] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0];
  PST[N] = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50];
  PST[B] = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20];
  PST[R] = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0];
  PST[Q] = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20];
  PST[K] = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20];

  var OFFSETS = {};
  OFFSETS[N] = [-33, -31, -18, -14, 14, 18, 31, 33];
  OFFSETS[B] = [-17, -15, 15, 17];
  OFFSETS[R] = [-16, -1, 1, 16];
  OFFSETS[Q] = [-17, -16, -15, -1, 1, 15, 16, 17];
  OFFSETS[K] = [-17, -16, -15, -1, 1, 15, 16, 17];

  var GLYPH = {};
  GLYPH[WHITE | P] = '♙'; GLYPH[WHITE | N] = '♘'; GLYPH[WHITE | B] = '♗';
  GLYPH[WHITE | R] = '♖'; GLYPH[WHITE | Q] = '♕'; GLYPH[WHITE | K] = '♔';
  GLYPH[BLACK | P] = '♟'; GLYPH[BLACK | N] = '♞'; GLYPH[BLACK | B] = '♝';
  GLYPH[BLACK | R] = '♜'; GLYPH[BLACK | Q] = '♛'; GLYPH[BLACK | K] = '♚';

  function kind(p) { return p & 7; }
  function side(p) { return p & 24; }
  function onBoard(sq) { return (sq & 0x88) === 0; }
  function file(sq) { return sq & 15; }
  function rank(sq) { return sq >> 4; }
  function sq64(sq) { return rank(sq) * 8 + file(sq); }

  GameShell.define({
    id: 'game-chess',
    slug: 'chess',
    title: 'Chess',
    width: 560,
    /* 32px taller than the board: the strip below the eighth rank is where
       the status message paints, so it can never cover the bottom rank. */
    height: 592,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var board = new Array(128);
      var turn = WHITE;
      var castle = { wk: true, wq: true, bk: true, bq: true };
      var ep = -1;                 // en-passant target square
      var halfmove = 0;
      var history = [];
      var keys = [];               // position keys for the repetition rule
      var selected = -1;
      var legalForSel = [];
      var lastMove = null;
      var thinking = 0;
      var message = '';
      var depth = 3;
      var flipped = false;
      var over = false;
      /* 'computer' plays Black itself; 'pass' hands the same board to two
         people, which is what a chessboard on a table already is. The only
         differences are whether the engine is asked to move and which
         colours you are allowed to pick up. */
      var mode = 'computer';

      var modeSel = document.getElementById('game-mode');
      var levelSel = document.getElementById('game-level');
      var undoBtn = document.getElementById('game-undo');
      var flipBtn = document.getElementById('game-flip');

      if (modeSel) {
        mode = g.load('mode', 'computer');
        if (mode !== 'computer' && mode !== 'pass') mode = 'computer';
        modeSel.value = mode;
        modeSel.addEventListener('change', function () {
          mode = modeSel.value; g.save('mode', mode); g.start();
        });
      }
      if (levelSel) {
        depth = Number(g.load('depth', '3')) || 3;
        levelSel.value = String(depth);
        levelSel.addEventListener('change', function () {
          depth = Number(levelSel.value) || 3; g.save('depth', depth);
        });
      }
      if (undoBtn) undoBtn.addEventListener('click', undoPair);
      if (flipBtn) flipBtn.addEventListener('click', function () {
        flipped = !flipped;
        flipBtn.setAttribute('aria-pressed', String(flipped));
      });

      /* --------------------------------------------------------------
         Setup
         -------------------------------------------------------------- */
      function reset() {
        for (var i = 0; i < 128; i++) board[i] = EMPTY;
        var back = [R, N, B, Q, K, B, N, R];
        for (var f = 0; f < 8; f++) {
          board[f] = BLACK | back[f];
          board[16 + f] = BLACK | P;
          board[96 + f] = WHITE | P;
          board[112 + f] = WHITE | back[f];
        }
        turn = WHITE;
        castle = { wk: true, wq: true, bk: true, bq: true };
        ep = -1;
        halfmove = 0;
        history = [];
        /* The start position is a repetition candidate too — knights out
           and straight back is the classic three-and-draw. */
        keys = [positionKey()];
        selected = -1;
        legalForSel = [];
        lastMove = null;
        thinking = 0;
        over = false;
        message = mode === 'pass' ? 'White to move' : 'Your move — you are White';
        syncHud();
      }

      /* --------------------------------------------------------------
         Move generation
         -------------------------------------------------------------- */
      function attacked(sq, by) {
        for (var i = 0; i < 128; i++) {
          if (i & 0x88) continue;
          var p = board[i];
          if (!p || side(p) !== by) continue;
          var k = kind(p);
          if (k === P) {
            var dir = by === WHITE ? -16 : 16;
            if (i + dir - 1 === sq || i + dir + 1 === sq) {
              /* Guard the file wrap: -1/+1 can slide off the edge into the
                 next rank without 0x88 noticing, because the target square
                 is still legal. */
              if (Math.abs(file(i) - file(sq)) === 1) return true;
            }
            continue;
          }
          if (k === N || k === K) {
            var offs = OFFSETS[k];
            for (var o = 0; o < offs.length; o++) if (i + offs[o] === sq) return true;
            continue;
          }
          var slides = OFFSETS[k];
          for (var s = 0; s < slides.length; s++) {
            var to = i + slides[s];
            while (onBoard(to)) {
              if (to === sq) return true;
              if (board[to]) break;
              to += slides[s];
            }
          }
        }
        return false;
      }

      function findKing(colour) {
        for (var i = 0; i < 128; i++) {
          if (i & 0x88) continue;
          if (board[i] === (colour | K)) return i;
        }
        return -1;
      }

      function pseudoMoves(colour) {
        var out = [];
        for (var from = 0; from < 128; from++) {
          if (from & 0x88) continue;
          var p = board[from];
          if (!p || side(p) !== colour) continue;
          var k = kind(p);

          if (k === P) {
            var dir = colour === WHITE ? -16 : 16;
            var start = colour === WHITE ? 6 : 1;
            var one = from + dir;
            if (onBoard(one) && !board[one]) {
              out.push({ from: from, to: one, promo: rank(one) === 0 || rank(one) === 7 });
              var two = from + dir * 2;
              if (rank(from) === start && onBoard(two) && !board[two]) {
                out.push({ from: from, to: two, dbl: true });
              }
            }
            var caps = [dir - 1, dir + 1];
            for (var c = 0; c < 2; c++) {
              var t = from + caps[c];
              if (!onBoard(t)) continue;
              if (Math.abs(file(from) - file(t)) !== 1) continue;
              if (board[t] && side(board[t]) !== colour) {
                out.push({ from: from, to: t, promo: rank(t) === 0 || rank(t) === 7 });
              } else if (t === ep) {
                out.push({ from: from, to: t, ep: true });
              }
            }
            continue;
          }

          if (k === N || k === K) {
            var offs = OFFSETS[k];
            for (var o = 0; o < offs.length; o++) {
              var to = from + offs[o];
              if (!onBoard(to)) continue;
              if (board[to] && side(board[to]) === colour) continue;
              out.push({ from: from, to: to });
            }
            if (k === K) {
              var home = colour === WHITE ? 116 : 4;
              if (from === home) {
                var kSide = colour === WHITE ? castle.wk : castle.bk;
                var qSide = colour === WHITE ? castle.wq : castle.bq;
                var enemy = colour === WHITE ? BLACK : WHITE;
                if (kSide && !board[home + 1] && !board[home + 2] &&
                    !attacked(home, enemy) && !attacked(home + 1, enemy) && !attacked(home + 2, enemy)) {
                  out.push({ from: from, to: home + 2, castle: 'k' });
                }
                if (qSide && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
                    !attacked(home, enemy) && !attacked(home - 1, enemy) && !attacked(home - 2, enemy)) {
                  out.push({ from: from, to: home - 2, castle: 'q' });
                }
              }
            }
            continue;
          }

          var dirs = OFFSETS[k];
          for (var d = 0; d < dirs.length; d++) {
            var sq = from + dirs[d];
            while (onBoard(sq)) {
              if (!board[sq]) out.push({ from: from, to: sq });
              else {
                if (side(board[sq]) !== colour) out.push({ from: from, to: sq });
                break;
              }
              sq += dirs[d];
            }
          }
        }
        return out;
      }

      /* Apply a move and return everything needed to take it back. */
      function make(m) {
        var undo = {
          m: m, captured: board[m.to], ep: ep, halfmove: halfmove,
          castle: { wk: castle.wk, wq: castle.wq, bk: castle.bk, bq: castle.bq },
          epCaptured: 0, epSquare: -1
        };
        var piece = board[m.from];
        var colour = side(piece);

        if (m.ep) {
          var victim = m.to + (colour === WHITE ? 16 : -16);
          undo.epCaptured = board[victim];
          undo.epSquare = victim;
          board[victim] = EMPTY;
        }

        board[m.to] = m.promo ? (colour | Q) : piece;
        board[m.from] = EMPTY;

        if (m.castle === 'k') {
          var hk = colour === WHITE ? 116 : 4;
          board[hk + 1] = board[hk + 3];
          board[hk + 3] = EMPTY;
        } else if (m.castle === 'q') {
          var hq = colour === WHITE ? 116 : 4;
          board[hq - 1] = board[hq - 4];
          board[hq - 4] = EMPTY;
        }

        if (kind(piece) === K) {
          if (colour === WHITE) { castle.wk = false; castle.wq = false; }
          else { castle.bk = false; castle.bq = false; }
        }
        /* A rook leaving its corner, or being captured on it, ends that
           side's right to castle — both directions have to be handled or a
           rook can be taken and the king still castles with a ghost. */
        if (m.from === 112 || m.to === 112) castle.wq = false;
        if (m.from === 119 || m.to === 119) castle.wk = false;
        if (m.from === 0 || m.to === 0) castle.bq = false;
        if (m.from === 7 || m.to === 7) castle.bk = false;

        ep = m.dbl ? (m.from + (colour === WHITE ? -16 : 16)) : -1;
        halfmove = (kind(piece) === P || undo.captured) ? 0 : halfmove + 1;
        turn = colour === WHITE ? BLACK : WHITE;
        return undo;
      }

      function unmake(undo) {
        var m = undo.m;
        var piece = board[m.to];
        var colour = side(piece);
        board[m.from] = m.promo ? (colour | P) : piece;
        board[m.to] = undo.captured;

        if (undo.epSquare >= 0) board[undo.epSquare] = undo.epCaptured;

        if (m.castle === 'k') {
          var hk = colour === WHITE ? 116 : 4;
          board[hk + 3] = board[hk + 1];
          board[hk + 1] = EMPTY;
        } else if (m.castle === 'q') {
          var hq = colour === WHITE ? 116 : 4;
          board[hq - 4] = board[hq - 1];
          board[hq - 1] = EMPTY;
        }

        castle = undo.castle;
        ep = undo.ep;
        halfmove = undo.halfmove;
        turn = colour;
      }

      function legalMoves(colour) {
        var pseudo = pseudoMoves(colour);
        var out = [];
        for (var i = 0; i < pseudo.length; i++) {
          var u = make(pseudo[i]);
          var k = findKing(colour);
          var bad = k < 0 || attacked(k, colour === WHITE ? BLACK : WHITE);
          unmake(u);
          if (!bad) out.push(pseudo[i]);
        }
        return out;
      }

      function inCheck(colour) {
        var k = findKing(colour);
        return k >= 0 && attacked(k, colour === WHITE ? BLACK : WHITE);
      }

      /* --------------------------------------------------------------
         Evaluation and search
         -------------------------------------------------------------- */
      function evaluate() {
        var score = 0;
        for (var i = 0; i < 128; i++) {
          if (i & 0x88) continue;
          var p = board[i];
          if (!p) continue;
          var k = kind(p);
          var idx = sq64(i);
          /* The tables are written from White's side, so Black reads them
             through a VERTICAL mirror — same file, flipped rank. Mirroring
             horizontally too (a plain 63 - idx) would be wrong for the king
             tables, which are not left-right symmetric. */
          var pst = side(p) === WHITE ? PST[k][idx] : PST[k][(7 - (idx >> 3)) * 8 + (idx & 7)];
          var v = VALUE[k] + pst;
          score += side(p) === WHITE ? v : -v;
        }
        return turn === WHITE ? score : -score;
      }

      /* Captures only, to a quiet position. Without this the engine happily
         hangs a piece on the last ply because the recapture is one move
         past the horizon. */
      function quiesce(alpha, beta) {
        var stand = evaluate();
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;

        var moves = legalMoves(turn);
        for (var i = 0; i < moves.length; i++) {
          if (!board[moves[i].to] && !moves[i].ep) continue;
          var u = make(moves[i]);
          var score = -quiesce(-beta, -alpha);
          unmake(u);
          if (score >= beta) return beta;
          if (score > alpha) alpha = score;
        }
        return alpha;
      }

      function search(d, alpha, beta) {
        if (d <= 0) return quiesce(alpha, beta);
        var moves = legalMoves(turn);
        if (!moves.length) return inCheck(turn) ? -99999 + (10 - d) : 0;

        /* Captures first — a cheap ordering that makes alpha-beta prune far
           more, and costs one sort. */
        moves.sort(function (a, b) {
          var va = board[a.to] ? VALUE[kind(board[a.to])] : 0;
          var vb = board[b.to] ? VALUE[kind(board[b.to])] : 0;
          return vb - va;
        });

        for (var i = 0; i < moves.length; i++) {
          var u = make(moves[i]);
          var score = -search(d - 1, -beta, -alpha);
          unmake(u);
          if (score >= beta) return beta;
          if (score > alpha) alpha = score;
        }
        return alpha;
      }

      function bestMove() {
        var moves = legalMoves(turn);
        if (!moves.length) return null;
        var best = null;
        var bestScore = -Infinity;
        moves.sort(function (a, b) {
          var va = board[a.to] ? VALUE[kind(board[a.to])] : 0;
          var vb = board[b.to] ? VALUE[kind(board[b.to])] : 0;
          return vb - va;
        });
        for (var i = 0; i < moves.length; i++) {
          var u = make(moves[i]);
          var score = -search(depth - 1, -Infinity, Infinity);
          unmake(u);
          /* A dash of noise at the easiest level, so it does not play the
             identical game every time. */
          if (depth <= 2) score += Math.random() * 25;
          if (score > bestScore) { bestScore = score; best = moves[i]; }
        }
        return best;
      }

      /* --------------------------------------------------------------
         Sound

         Every sound below is a one-shot, for the reason given in the
         header: nothing here is a condition, everything is an event, and
         between two events this game is meant to be quiet.

         The design goal is not prettiness, it is DISTINGUISHABILITY. A
         player watching one corner of the board should be able to tell,
         without moving their eyes, that what just landed was a capture
         rather than a quiet move, a castle rather than either, a promotion,
         a check, or a refusal — and whether it was theirs or the engine's.
         That is why the palette is spread across four waveforms and two
         kinds of noise instead of being a set of pleasant thirds.
         -------------------------------------------------------------- */

      /* A figure needs its second note offset from its first, and every
         one-shot the shell offers fires the instant it is called, so the
         offset has to live here. This is that offset and nothing else: no
         state the game reads is touched from inside the callback, so a note
         still in flight when the board is reset or a move is taken back can
         only ever make a sound. */
      function after(ms, fn) { setTimeout(fn, ms); }

      /* The move that just landed. A capture and a quiet move are a fifth
         apart — far enough to hear across a noisy room, close enough that
         forty moves do not accumulate into a tune.

         The ENGINE plays the same two notes on a triangle and about a
         semitone flat. Sine against triangle is a small difference written
         down and an obvious one in the ear, and it is the cheapest way to
         know whose move just landed while you are still working out what to
         do about the last one. Pitch alone would not have done it: the two
         sides already differ by capture-or-not, and a third pitch pair
         starts to sound like a fourth kind of move.

         In pass-and-play both sides get the sine, because there is no engine
         and the two voices would then be saying something the board and the
         status line have both already said. */
      function moveNote(capture, byEngine) {
        if (byEngine) g.beep(capture ? 300 : 450, 0.06, 'triangle');
        else g.beep(capture ? 320 : 480, 0.05, 'sine');
      }

      /* Two pieces moved, so two thunks: the king set down, then the rook
         arriving beside it a tenth of a second later. Filtered noise falling
         in pitch rather than a tone, because a castle on a real board is
         wood on wood and not a note — and because the one move that is
         audibly not a note is the one move the ear can never confuse with
         anything else. The second thunk is brighter and quieter, a rook
         slid along a rank being a lighter sound than a king lifted over it.
         The engine's pair sits a notch lower, the same offset its move note
         carries. */
      function castleNote(byEngine) {
        var drop = byEngine ? 0.88 : 1;
        g.noise(0.09, { type: 'lowpass', freq: 260 * drop, to: 90, q: 0.7, level: 0.06 });
        after(105, function () {
          g.noise(0.08, { type: 'lowpass', freq: 330 * drop, to: 120, q: 0.7, level: 0.05 });
        });
      }

      /* A pawn became a queen. Three plucked notes climbing a major triad,
         which is the shortest figure that reads as "went up" rather than as
         "two notes happened" — two notes alone are heard as an interval, and
         an interval is what check already is. It plays OVER the move note
         instead of replacing it, because a promotion is still a move and can
         still be a capture, and both of those are worth keeping. */
      function promoNote(byEngine) {
        var base = byEngine ? 494 : 523;
        g.pluck(base, 0.16, 0.05, 'triangle');
        after(80, function () { g.pluck(base * 1.26, 0.16, 0.05, 'triangle'); });
        after(160, function () { g.pluck(base * 1.5, 0.26, 0.055, 'triangle'); });
      }

      /* Check. The one sound in the file that has to cut through, so it gets
         the only square wave and the only rising tritone — the interval that
         has been read as an alarm for centuries, and unmistakably not the
         sine the moves are made of.

         It is HELD BACK a beat rather than struck on top of the move note.
         Played together the square simply masks the sine and the
         capture-or-not information is lost; a tenth of a second later and
         the two read as one thing and then another, which is also the order
         they happened in. A promotion pushes it further out still, because
         the rising triad is using that tenth of a second.

         It does not change with who gave the check. The move note said whose
         move it was a fraction of a second earlier, and two alarms would
         make a player identify which one they were hearing at exactly the
         moment they should be reacting to it. */
      function checkNote(delay) {
        after(delay, function () { g.beep(622, 0.075, 'square', 0.055); });
        after(delay + 95, function () { g.beep(880, 0.13, 'square', 0.055); });
      }

      /* The refusal, and the reason this section exists at all. Every path
         that answers a tap by doing nothing ends up here. Silence was the
         worst thing in the build that had none: a rejected move and a tap
         the page never received are the same event to a player, and the
         reason a move is illegal — a pin, a king still in check — is
         invisible on the board. Low, short and soft, so it reads as the
         board declining rather than as a penalty for asking.

         Gated because it is the only sound here that a person can trigger as
         fast as they can tap, and four overlapping sawtooths at one pitch
         are far louder and nastier than one of them. */
      function reject() {
        if (!g.gate('reject', 0.12)) return;
        g.beep(96, 0.13, 'sawtooth', 0.045);
      }

      /* Picking a piece up. Deliberately almost inaudible: its whole job is
         to be the thing the refusal is not, so that a piece with nowhere to
         go is heard as a different answer to the same tap rather than as the
         only answer the board ever gives. */
      function pickupNote() {
        if (!g.gate('pickup', 0.05)) return;
        g.noise(0.03, { type: 'highpass', freq: 2200, q: 0.8, level: 0.022 });
      }

      /* --------------------------------------------------------------
         Game flow
         -------------------------------------------------------------- */
      /* One cheap string per position, for the repetition rule: placement,
         side to move, castling rights, and the en-passant square — the
         last only when a pawn is actually beside it to use it. A double
         push nobody can capture leaves the position the same for
         repetition purposes, and keying on the bare ep square would make
         those positions look different and hide a real threefold. */
      function positionKey() {
        var s = '';
        for (var i = 0; i < 128; i++) {
          if (i & 0x88) continue;
          s += board[i].toString(32);
        }
        s += turn === WHITE ? 'w' : 'b';
        if (castle.wk) s += 'K';
        if (castle.wq) s += 'Q';
        if (castle.bk) s += 'k';
        if (castle.bq) s += 'q';
        if (ep >= 0) {
          /* The capturing pawn stands beside the pawn that just jumped,
             one rank past the target from the mover's point of view. A
             ±1 that wraps the file lands on an 0x88 square, so onBoard
             is the only guard needed. */
          var beside = ep + (turn === WHITE ? 16 : -16);
          if ((onBoard(beside - 1) && board[beside - 1] === (turn | P)) ||
              (onBoard(beside + 1) && board[beside + 1] === (turn | P))) {
            s += '.' + ep;
          }
        }
        return s;
      }

      function insufficient() {
        var pieces = [];
        for (var i = 0; i < 128; i++) {
          if (i & 0x88) continue;
          if (board[i] && kind(board[i]) !== K) pieces.push(kind(board[i]));
        }
        if (!pieces.length) return true;
        if (pieces.length === 1 && (pieces[0] === B || pieces[0] === N)) return true;
        return false;
      }

      function checkEnd() {
        /* hideScore on every ending: chess keeps no score, and without it
           the overlay prints the shell's default zero as if it were one. */
        var moves = legalMoves(turn);
        if (!moves.length) {
          over = true;
          if (inCheck(turn)) {
            var winner = turn === WHITE ? 'Black' : 'White';
            g.over({
              won: mode === 'pass' ? true : turn === BLACK,
              hideScore: true,
              title: 'Checkmate',
              message: winner + ' wins in ' + Math.ceil(history.length / 2) + ' moves.'
            });
          } else {
            g.over({
              hideScore: true,
              title: 'Stalemate',
              message: 'No legal move, and not in check. A draw.'
            });
          }
          return true;
        }
        if (halfmove >= 100) {
          over = true;
          g.over({
            hideScore: true,
            title: 'Draw',
            message: 'Fifty moves without a capture or a pawn move.'
          });
          return true;
        }
        /* Threefold repetition. Only the tail of the game since the last
           capture or pawn move can hold an earlier copy of this position —
           a taken piece never comes back and a pawn never retreats — so
           the scan is bounded by the same counter the fifty-move rule
           uses. */
        var key = keys[keys.length - 1];
        var seen = 0;
        for (var i = keys.length - 1; i >= 0 && i >= keys.length - 1 - halfmove; i--) {
          if (keys[i] === key) seen++;
        }
        if (seen >= 3) {
          over = true;
          g.over({
            hideScore: true,
            title: 'Draw',
            message: 'The same position has occurred three times.'
          });
          return true;
        }
        if (insufficient()) {
          over = true;
          g.over({
            hideScore: true,
            title: 'Draw',
            message: 'Neither side has enough material to mate.'
          });
          return true;
        }
        return false;
      }

      function applyMove(m) {
        /* Read the captured piece BEFORE the move — after make() the target
           square holds the piece that just arrived, so this was always
           playing the capture note. */
        var wasCapture = !!board[m.to] || !!m.ep;
        /* And who is moving, for exactly the same reason: make() flips the
           side to move, so asked afterwards this question always answers
           about the reply rather than about the move being played. */
        var byEngine = engineTurn();
        history.push(make(m));
        /* Only moves that reach the board are counted — the search calls
           make() thousands of times a turn and none of those positions
           ever happened. */
        keys.push(positionKey());
        lastMove = m;
        selected = -1;
        legalForSel = [];
        /* A castle replaces the move note rather than layering over it: the
           double thunk IS what that move sounds like, and a beep in front of
           it would only say "a move happened" a beat before the pair said
           which one. A promotion layers, because it is still an ordinary
           move underneath. */
        if (m.castle) castleNote(byEngine);
        else moveNote(wasCapture, byEngine);
        if (m.promo) promoNote(byEngine);
        syncHud();
        if (checkEnd()) return;
        /* Check and only check — checkEnd() has already returned for mate,
           stalemate and every draw, and those are the shell's game-over
           sound rather than this file's. Asked once and shared with the
           status line below, which was putting the same question to the same
           unchanged board. The sound is worth more than the line, too: when
           the engine is about to move the strip reads "Black is thinking"
           and never mentions the check you just gave. */
        var check = inCheck(turn);
        if (check) checkNote(m.promo ? 300 : 110);
        var name = turn === WHITE ? 'White' : 'Black';
        if (engineTurn()) {
          message = 'Black is thinking';
          thinking = 0.25;
        } else {
          message = (check ? 'Check — ' : '') +
                    (mode === 'pass' ? name + ' to move' : 'Your move');
        }
      }

      function undoPair() {
        /* Undo with nothing to undo, or while the engine is mid-search, is
           another button that answers with nothing at all. */
        if (thinking > 0 || !history.length) { reject(); return; }
        /* Take back the pair, so it is always your move again. */
        unmake(history.pop());
        keys.pop();
        /* Against the computer, taking back one ply just hands the move
           straight back to the engine, so the pair comes off. In
           pass-and-play a single ply IS the take-back somebody wants. */
        if (mode === 'computer' && history.length && turn === BLACK) {
          unmake(history.pop());
          keys.pop();
        }
        over = false;
        lastMove = null;
        selected = -1;
        legalForSel = [];
        message = mode === 'pass' ? 'Taken back' : 'Taken back — your move';
        g.hideOverlay();
        /* Reviving a FINISHED game needs the loop back as well as the flag.
           over() calls stop(), which cancels the animation frame, so setting
           state on its own produced a board that redrew once and then sat
           there: your piece moved, the clock did not run, and the engine
           never replied. run() is a no-op if a frame is already scheduled,
           so calling it on a take-back mid-game costs nothing. */
        if (g.state !== 'playing') {
          g.state = 'playing';
          /* The shell mirrors state onto the root as data-state at every
             transition it owns; a revive that bypasses start() has to keep
             the mirror honest too, or the site's letter-shortcut guard
             reads a live game as finished. */
          if (g.el) g.el.setAttribute('data-state', 'playing');
          /* over() also disabled the pause button — start() is what
             normally hands it back, but a take-back revives the game
             without going through start(), and Pause would stay dead for
             the whole revived game. Resetting the label covers the other
             way in: a take-back while paused left it reading Resume. */
          if (g.pauseBtn) {
            g.pauseBtn.disabled = false;
            g.pauseBtn.textContent = 'Pause';
          }
          g.run();
        }
        syncHud();
      }

      /* Is the side to move the one the engine plays? */
      function engineTurn() {
        return mode === 'computer' && turn === BLACK;
      }

      function syncHud() {
        g.stat('turn', turn === WHITE ? 'White' : 'Black');
        g.stat('move', Math.floor(history.length / 2) + 1);
        var mat = 0;
        for (var i = 0; i < 128; i++) {
          if (i & 0x88) continue;
          var p = board[i];
          if (!p || kind(p) === K) continue;
          mat += side(p) === WHITE ? VALUE[kind(p)] : -VALUE[kind(p)];
        }
        g.stat('material', (mat > 0 ? '+' : '') + (mat / 100).toFixed(1));
      }

      /* --------------------------------------------------------------
         Input
         -------------------------------------------------------------- */
      function squareAt(px, py) {
        var f = Math.floor(px / 70);
        var r = Math.floor(py / 70);
        if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
        if (flipped) { f = 7 - f; r = 7 - r; }
        return r * 16 + f;
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          /* The square is resolved ahead of the guards so that a tap on the
             status strip below the eighth rank stays silent. A refusal has
             to mean "not that move"; if it also meant "not on the board" it
             would stop meaning anything. pointAt and squareAt are both pure
             reads, so nothing is decided by asking early. */
          var p = g.pointAt(event);
          var sq = squareAt(p.x, p.y);
          if (sq < 0) return;
          /* A finished game has the overlay in front of the canvas saying so,
             which is answer enough. A tap during the engine's turn is
             answered by nothing whatsoever, and is precisely the
             click-that-does-nothing the refusal exists for. */
          if (over) return;
          if (thinking > 0 || engineTurn()) { reject(); return; }

          for (var i = 0; i < legalForSel.length; i++) {
            if (legalForSel[i].to === sq) { applyMove(legalForSel[i]); return; }
          }
          if (board[sq] && side(board[sq]) === turn) {
            selected = sq;
            var all = legalMoves(turn);
            legalForSel = [];
            for (var m = 0; m < all.length; m++) if (all[m].from === sq) legalForSel.push(all[m]);
            /* A piece with nowhere to go looks exactly like a piece with the
               whole board in front of it until you have picked it up and
               watched no dots appear — and on a phone your thumb is over the
               square you just tapped. */
            if (legalForSel.length) pickupNote(); else reject();
          } else {
            /* A piece was up and this square is not one of its dots: the
               illegal move. Usually a pin, and a pin is invisible. */
            if (selected >= 0) reject();
            selected = -1;
            legalForSel = [];
          }
        });
      }

      /* --------------------------------------------------------------
         Drawing
         -------------------------------------------------------------- */
      function draw(ctx) {
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, 0, 560, 560);

        for (var r = 0; r < 8; r++) {
          for (var f = 0; f < 8; f++) {
            var sq = (flipped ? 7 - r : r) * 16 + (flipped ? 7 - f : f);
            var light = ((r + f) % 2) === 0;
            ctx.fillStyle = light ? '#8ca0b8' : '#41546e';
            ctx.fillRect(f * 70, r * 70, 70, 70);

            if (lastMove && (sq === lastMove.from || sq === lastMove.to)) {
              ctx.fillStyle = 'rgba(250, 204, 21, 0.28)';
              ctx.fillRect(f * 70, r * 70, 70, 70);
            }
            if (sq === selected) {
              ctx.fillStyle = 'rgba(125, 211, 252, 0.45)';
              ctx.fillRect(f * 70, r * 70, 70, 70);
            }
          }
        }

        // Legal destinations for the selected piece
        for (var i = 0; i < legalForSel.length; i++) {
          var to = legalForSel[i].to;
          var tf = file(to), tr = rank(to);
          if (flipped) { tf = 7 - tf; tr = 7 - tr; }
          ctx.beginPath();
          if (board[legalForSel[i].to] || legalForSel[i].ep) {
            ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
            ctx.lineWidth = 4;
            ctx.arc(tf * 70 + 35, tr * 70 + 35, 30, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
            ctx.arc(tf * 70 + 35, tr * 70 + 35, 10, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Pieces
        ctx.font = '52px "Segoe UI Symbol", "DejaVu Sans", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var s = 0; s < 128; s++) {
          if (s & 0x88) continue;
          var piece = board[s];
          if (!piece) continue;
          var pf = file(s), pr = rank(s);
          if (flipped) { pf = 7 - pf; pr = 7 - pr; }
          /* A dark outline under every glyph: the white set is drawn as
             outlined figures in most fonts and vanishes on a light square
             without one. */
          ctx.fillStyle = side(piece) === WHITE ? '#f8fafc' : '#0f172a';
          ctx.strokeStyle = side(piece) === WHITE ? '#0f172a' : '#cbd5e1';
          ctx.lineWidth = 1.5;
          ctx.fillText(GLYPH[piece], pf * 70 + 35, pr * 70 + 40);
          ctx.strokeText(GLYPH[piece], pf * 70 + 35, pr * 70 + 40);
        }

        if (inCheck(turn) && !over) {
          var k = findKing(turn);
          if (k >= 0) {
            var kf = file(k), kr = rank(k);
            if (flipped) { kf = 7 - kf; kr = 7 - kr; }
            ctx.strokeStyle = '#f87171';
            ctx.lineWidth = 4;
            ctx.strokeRect(kf * 70 + 2, kr * 70 + 2, 66, 66);
          }
        }

        /* The status strip lives BELOW the board, in the 32px the canvas
           carries past the eighth rank (see the height note in the
           manifest). Drawn at y 528 it sat on top of the bottom rank —
           covering the very pieces a "Check." or "Illegal: king in check"
           message was usually about. */
        ctx.fillStyle = 'rgba(2,6,23,0.72)';
        ctx.fillRect(0, 560, 560, 32);
        if (message) {
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '15px "Segoe UI", sans-serif';
          ctx.fillText(message, 280, 577);
        }
      }

      return {
        reset: reset,

        update: function (dt) {
          if (thinking > 0) {
            thinking -= dt;
            if (thinking <= 0) {
              thinking = 0;
              var m = bestMove();
              if (m) applyMove(m);
              else checkEnd();
            }
          }
        },

        draw: draw
      };
    }
  });
})();

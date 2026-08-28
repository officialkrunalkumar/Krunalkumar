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
   stalemate, insufficient material, and the fifty-move counter.

   THE ENGINE is negamax with alpha-beta and a quiescence search on captures.
   Without quiescence it plays a bishop en prise on the last ply of the
   search and calls it winning, because the recapture is one move past the
   horizon; that single addition is the difference between an opponent that
   blunders constantly and one that does not.
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
    height: 560,
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
         Game flow
         -------------------------------------------------------------- */
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
        var moves = legalMoves(turn);
        if (!moves.length) {
          over = true;
          if (inCheck(turn)) {
            var winner = turn === WHITE ? 'Black' : 'White';
            g.over({
              won: mode === 'pass' ? true : turn === BLACK,
              title: 'Checkmate',
              message: winner + ' wins in ' + Math.ceil(history.length / 2) + ' moves.'
            });
          } else {
            g.over({ title: 'Stalemate', message: 'No legal move, and not in check. A draw.' });
          }
          return true;
        }
        if (halfmove >= 100) {
          over = true;
          g.over({ title: 'Draw', message: 'Fifty moves without a capture or a pawn move.' });
          return true;
        }
        if (insufficient()) {
          over = true;
          g.over({ title: 'Draw', message: 'Neither side has enough material to mate.' });
          return true;
        }
        return false;
      }

      function applyMove(m) {
        /* Read the captured piece BEFORE the move — after make() the target
           square holds the piece that just arrived, so this was always
           playing the capture note. */
        var wasCapture = !!board[m.to] || !!m.ep;
        history.push(make(m));
        lastMove = m;
        selected = -1;
        legalForSel = [];
        g.beep(wasCapture ? 320 : 480, 0.05, 'sine');
        syncHud();
        if (checkEnd()) return;
        var name = turn === WHITE ? 'White' : 'Black';
        if (engineTurn()) {
          message = 'Black is thinking';
          thinking = 0.25;
        } else {
          message = (inCheck(turn) ? 'Check — ' : '') +
                    (mode === 'pass' ? name + ' to move' : 'Your move');
        }
      }

      function undoPair() {
        if (thinking > 0 || !history.length) return;
        /* Take back the pair, so it is always your move again. */
        unmake(history.pop());
        /* Against the computer, taking back one ply just hands the move
           straight back to the engine, so the pair comes off. In
           pass-and-play a single ply IS the take-back somebody wants. */
        if (mode === 'computer' && history.length && turn === BLACK) unmake(history.pop());
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
        if (g.state !== 'playing') { g.state = 'playing'; g.run(); }
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
          if (over || thinking > 0) return;
          if (engineTurn()) return;
          var p = g.pointAt(event);
          var sq = squareAt(p.x, p.y);
          if (sq < 0) return;

          for (var i = 0; i < legalForSel.length; i++) {
            if (legalForSel[i].to === sq) { applyMove(legalForSel[i]); return; }
          }
          if (board[sq] && side(board[sq]) === turn) {
            selected = sq;
            var all = legalMoves(turn);
            legalForSel = [];
            for (var m = 0; m < all.length; m++) if (all[m].from === sq) legalForSel.push(all[m]);
          } else {
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

        if (message) {
          ctx.fillStyle = 'rgba(2,6,23,0.72)';
          ctx.fillRect(0, 528, 560, 32);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '15px "Segoe UI", sans-serif';
          ctx.fillText(message, 280, 545);
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

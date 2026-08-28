/* ==========================================================================
   ludo.js — Ludo, against the computer or around one device.
   --------------------------------------------------------------------------
   THE BOARD is built rather than drawn. A Ludo track is four identical
   thirteen-cell quadrants rotated about the centre, so one quadrant is
   written out by hand and the other three are (x, y) -> (14 - y, x) applied
   once, twice and three times. Home columns and yards come out the same way.
   That is why there is no 52-entry coordinate table here to get wrong.

   WHICH CORNERS PLAY. `players` is a count; `active` is the list of seats it
   means. Two players sit OPPOSITE each other — red and yellow — the way the
   board game is actually played, because seating them adjacent gives one a
   much shorter run to their home column. Every loop runs over `active`, so
   an empty corner is not drawn, cannot be captured, and never takes a turn.

   THERE IS NO ONLINE PLAY HERE, and that is a decision rather than a gap.
   An earlier version packed the whole board into a URL fragment so two
   people could pass a link back and forth. It worked, and it was tedious:
   a link after every single move, for a game whose entire appeal is that it
   moves quickly. Pass-and-play covers two people in the same room and the
   computer covers one person on their own, which is what this game is
   usually reaching for anyway.
   ========================================================================== */

(function () {
  'use strict';

  var N = 15;               // board is 15 x 15 cells
  var CELL = 40;            // logical units per cell -> a 600 x 600 board
  var TOKENS = 4;

  /* One quadrant of the track: 13 cells, from the bottom edge up the left
     side of the bottom arm, along the outer row, and onto the turn cell. */
  var QUADRANT = [
    [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7]
  ];

  /* p0's home column: six cells up the middle from the bottom edge. */
  var HOME_Q = [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]];

  var YARDS = [
    [[2, 11], [4, 11], [2, 13], [4, 13]],
    [[2, 2], [4, 2], [2, 4], [4, 4]],
    [[10, 2], [12, 2], [10, 4], [12, 4]],
    [[10, 11], [12, 11], [10, 13], [12, 13]]
  ];

  var COLORS = ['#f87171', '#4ade80', '#fbbf24', '#7dd3fc'];
  var DARK = ['#7f1d1d', '#14532d', '#78350f', '#075985'];
  var NAMES = ['Red', 'Green', 'Yellow', 'Blue'];

  var START = [0, 13, 26, 39];          // path index each seat enters at
  var TRACK_LEN = 51;                   // pos 0..50 are track squares
  var HOME_POS = 56;                    // pos 51..56 are the home column

  function rot(p) { return [14 - p[1], p[0]]; }
  function rotN(p, times) { for (var i = 0; i < times; i++) p = rot(p); return p; }

  var PATH = [];
  for (var q = 0; q < 4; q++) {
    for (var c = 0; c < QUADRANT.length; c++) PATH.push(rotN(QUADRANT[c].slice(), q));
  }

  var HOME = [];
  for (var h = 0; h < 4; h++) {
    var col = [];
    for (var k = 0; k < HOME_Q.length; k++) col.push(rotN(HOME_Q[k].slice(), h));
    HOME.push(col);
  }

  /* Safe squares: the four entry cells and the four stars eight along. */
  var SAFE = {};
  for (var s = 0; s < 4; s++) { SAFE[START[s]] = true; SAFE[(START[s] + 8) % 52] = true; }

  GameShell.define({
    id: 'game-ludo',
    slug: 'ludo',
    title: 'Ludo',
    width: N * CELL,
    height: N * CELL,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,       // taps pick a token; the shell must not eat them

    setup: function (g) {
      var players = 4;          // 2, 3 or 4 seats
      var mode = 'computer';    // computer | pass
      var turn = 0;
      var sixes = 0;
      var dice = 0;             // 0 = not yet rolled this turn
      var tok = [];             // [seat][token] = pos (-1 yard, 0..56)
      var movable = [];
      var message = '';
      var active = [0, 1, 2, 3];
      var pendingAI = 0;

      /* Delayed actions run on the GAME clock, not on setTimeout, so they
         stop when the game is paused instead of firing into a board nobody
         is looking at. */
      var pending = null;
      var pendingT = 0;
      function after(seconds, fn) { pending = fn; pendingT = seconds; }

      var modeSel = document.getElementById('game-mode');
      var countSel = document.getElementById('game-players');
      var rollBtn = document.getElementById('game-roll');

      if (modeSel) {
        mode = g.load('mode', 'computer');
        if (mode !== 'computer' && mode !== 'pass') mode = 'computer';
        modeSel.value = mode;
        modeSel.addEventListener('change', function () {
          mode = modeSel.value; g.save('mode', mode); g.start();
        });
      }
      if (countSel) {
        players = Number(g.load('players', '4')) || 4;
        countSel.value = String(players);
        countSel.addEventListener('change', function () {
          players = Number(countSel.value) || 4; g.save('players', players); g.start();
        });
      }
      if (rollBtn) rollBtn.addEventListener('click', doRoll);

      function seatsFor(count) {
        if (count === 2) return [0, 2];
        if (count === 3) return [0, 1, 2];
        return [0, 1, 2, 3];
      }

      function nextSeat(seat) {
        var i = active.indexOf(seat);
        return active[(i + 1) % active.length];
      }

      /* Can this device act right now? Pass-and-play shares one screen, so
         every seat is yours. Against the computer you are the first seat and
         the rest play themselves. */
      function myTurn() {
        if (mode === 'computer') return turn === active[0];
        return true;
      }

      /* --------------------------------------------------------------
         Rules
         -------------------------------------------------------------- */
      function absCell(p, pos) {
        if (pos < 0 || pos > TRACK_LEN - 1) return null;
        return (START[p] + pos) % 52;
      }

      function canMove(p, t, roll) {
        var pos = tok[p][t];
        if (pos === HOME_POS) return false;                 // already home
        if (pos === -1) return roll === 6;                  // needs a six to start
        return pos + roll <= HOME_POS;                      // exact roll to finish
      }

      function listMovable(roll) {
        var out = [];
        for (var t = 0; t < TOKENS; t++) if (canMove(turn, t, roll)) out.push(t);
        return out;
      }

      function doRoll() {
        if (g.state !== 'playing' || dice) return;
        if (!myTurn()) return;
        rollDice();
      }

      function rollDice() {
        dice = 1 + Math.floor(Math.random() * 6);
        movable = listMovable(dice);
        g.beep(300 + dice * 60, 0.06, 'sine');
        message = NAMES[turn] + ' rolled ' + dice;

        if (!movable.length) {
          message = NAMES[turn] + ' rolled ' + dice + ' — no legal move';
          after(0.7, endTurn);
          return;
        }
        /* One legal move is not a decision, so it plays itself — making
           somebody click their only option is friction, not agency. */
        if (movable.length === 1) after(0.35, function () { play(movable[0]); });
        else if (!myTurn()) pendingAI = 0.5;
      }

      function play(t) {
        if (!dice || movable.indexOf(t) === -1) return;
        var p = turn;
        var pos = tok[p][t];
        var to = pos === -1 ? 0 : pos + dice;
        tok[p][t] = to;

        var captured = false;
        var cell = absCell(p, to);
        if (cell !== null && !SAFE[cell]) {
          for (var oi = 0; oi < active.length; oi++) {
            var o = active[oi];
            if (o === p) continue;
            for (var ot = 0; ot < TOKENS; ot++) {
              if (absCell(o, tok[o][ot]) === cell) { tok[o][ot] = -1; captured = true; }
            }
          }
        }

        if (captured) { g.beep(200, 0.12, 'square'); message = NAMES[p] + ' captured a token'; }
        else if (to === HOME_POS) { g.beep(900, 0.14, 'sine'); message = NAMES[p] + ' got one home'; }
        else message = '';

        if (allHome(p)) {
          dice = 0;
          movable = [];
          g.over({
            won: (mode === 'pass') || p === active[0],
            title: NAMES[p] + ' wins',
            message: 'All four tokens home.'
          });
          return;
        }

        /* A six, a capture, or getting a token home earns another roll, and
           three sixes in a row forfeits the turn so a streak cannot run on
           forever. */
        var again = (dice === 6 || captured || to === HOME_POS);
        if (dice === 6) sixes++; else sixes = 0;
        if (sixes >= 3) { again = false; sixes = 0; message = 'Three sixes — turn forfeited'; }

        dice = 0;
        movable = [];
        if (again) { if (!myTurn()) pendingAI = 0.6; }
        else endTurn();
      }

      function allHome(p) {
        for (var t = 0; t < TOKENS; t++) if (tok[p][t] !== HOME_POS) return false;
        return true;
      }

      function endTurn() {
        dice = 0;
        movable = [];
        sixes = 0;
        turn = nextSeat(turn);
        if (!myTurn()) pendingAI = 0.6;
      }

      /* A deliberately simple opponent: leave the yard, then capture, then
         finish, then move the furthest token. Enough to be a real game
         without pretending to be an engine. */
      function aiChoose() {
        var best = movable[0];
        var bestScore = -Infinity;
        for (var i = 0; i < movable.length; i++) {
          var t = movable[i];
          var pos = tok[turn][t];
          var to = pos === -1 ? 0 : pos + dice;
          var score = to;
          if (pos === -1) score += 120;
          if (to === HOME_POS) score += 200;
          var cell = absCell(turn, to);
          if (cell !== null && !SAFE[cell]) {
            for (var oi = 0; oi < active.length; oi++) {
              var o = active[oi];
              if (o === turn) continue;
              for (var ot = 0; ot < TOKENS; ot++) {
                if (absCell(o, tok[o][ot]) === cell) score += 160;
              }
            }
          }
          if (cell !== null && SAFE[cell]) score += 25;
          if (score > bestScore) { bestScore = score; best = t; }
        }
        return best;
      }

      /* --------------------------------------------------------------
         Setup
         -------------------------------------------------------------- */
      function newGame() {
        tok = [];
        for (var p = 0; p < 4; p++) {
          var row = [];
          for (var t = 0; t < TOKENS; t++) row.push(-1);
          tok.push(row);
        }
        active = seatsFor(players);
        turn = active[0];
        sixes = 0;
        dice = 0;
        movable = [];
        pending = null;
        pendingAI = 0;
        message = mode === 'computer' ? 'You are Red — roll to start' : 'Red to roll';
        syncHud();
        syncControls();
      }

      /* The controls have to SAY whose turn it is rather than silently
         refusing the click — a Roll button that does nothing reads as a
         broken page, which is exactly how it looked before this existed. */
      function syncControls() {
        if (!rollBtn) return;
        var mine = myTurn();

        /* THE DICE ARE ONLY EVER AVAILABLE ON THE TURN THEY BELONG TO.
           Three separate paths could roll — this button, the Space key, and
           (for the AI) the update loop — and doRoll() gates all of them on
           myTurn(). The disabled attribute here is the visible half of the
           same rule, because a button that looks alive and does nothing when
           pressed reads as a broken page rather than as a rule. */
        rollBtn.disabled = !mine || !!dice || g.state !== 'playing';

        if (dice) {
          rollBtn.textContent = mine ? 'Move a token' : NAMES[turn] + ' is moving';
        } else if (!mine) {
          rollBtn.textContent = NAMES[turn] + ' is thinking';
        } else if (mode === 'pass') {
          /* Pass-and-play is one device shared between people, so every seat
             IS yours to roll — but only one at a time, and the button says
             which. Without the name it is not obvious whose go it is when
             the phone comes back to you mid-game. */
          rollBtn.textContent = 'Roll for ' + NAMES[turn];
        } else {
          rollBtn.textContent = 'Roll';
        }
      }

      function syncHud() {
        g.stat('turn', NAMES[turn]);
        g.stat('dice', dice || '—');
        var home = 0;
        for (var t = 0; t < TOKENS; t++) if (tok[turn][t] === HOME_POS) home++;
        g.stat('home', home + '/4');
      }

      /* --------------------------------------------------------------
         Input
         -------------------------------------------------------------- */
      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing' || !dice) return;
          if (!myTurn()) return;
          var pt = g.pointAt(event);
          var cx = Math.floor(pt.x / CELL);
          var cy = Math.floor(pt.y / CELL);
          for (var i = 0; i < movable.length; i++) {
            var t = movable[i];
            var at = tokenCell(turn, t);
            if (at && at[0] === cx && at[1] === cy) { play(t); return; }
          }
        });
      }

      function tokenCell(p, t) {
        var pos = tok[p][t];
        if (pos === -1) return YARDS[p][t];
        if (pos === HOME_POS) return [7, 7];
        if (pos >= TRACK_LEN) return HOME[p][pos - TRACK_LEN];
        return PATH[(START[p] + pos) % 52];
      }

      /* --------------------------------------------------------------
         Drawing
         -------------------------------------------------------------- */
      function cellRect(ctx, x, y, fill, stroke) {
        ctx.fillStyle = fill;
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x * CELL + 1.5, y * CELL + 1.5, CELL - 3, CELL - 3);
      }

      function draw(ctx) {
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, 0, N * CELL, N * CELL);

        // Yards, only for the seats in play
        for (var pi = 0; pi < active.length; pi++) {
          var p = active[pi];
          var ox = (p === 0 || p === 1) ? 0 : 9;
          var oy = (p === 0 || p === 3) ? 9 : 0;
          ctx.fillStyle = DARK[p];
          ctx.fillRect(ox * CELL, oy * CELL, 6 * CELL, 6 * CELL);
          ctx.strokeStyle = COLORS[p];
          ctx.lineWidth = 2;
          ctx.strokeRect(ox * CELL + 4, oy * CELL + 4, 6 * CELL - 8, 6 * CELL - 8);
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(ox * CELL + CELL, oy * CELL + CELL, 4 * CELL, 4 * CELL);
        }

        // Track
        for (var i = 0; i < PATH.length; i++) {
          cellRect(ctx, PATH[i][0], PATH[i][1], SAFE[i] ? '#1e293b' : '#141f33', '#334155');
          if (SAFE[i]) {
            ctx.fillStyle = '#64748b';
            ctx.font = '18px "Cascadia Code", Consolas, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', PATH[i][0] * CELL + CELL / 2, PATH[i][1] * CELL + CELL / 2 + 1);
          }
        }
        for (var ei = 0; ei < active.length; ei++) {
          var e = active[ei];
          var ec = PATH[START[e]];
          cellRect(ctx, ec[0], ec[1], COLORS[e], '#0b1220');
        }
        for (var hpi = 0; hpi < active.length; hpi++) {
          var hp = active[hpi];
          for (var hc = 0; hc < HOME[hp].length; hc++) {
            cellRect(ctx, HOME[hp][hc][0], HOME[hp][hc][1], DARK[hp], COLORS[hp]);
          }
        }

        // Centre
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(6 * CELL, 6 * CELL, 3 * CELL, 3 * CELL);
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 15px "Cascadia Code", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HOME', 7.5 * CELL, 7.5 * CELL);

        // Tokens
        for (var ppi = 0; ppi < active.length; ppi++) {
          var pp = active[ppi];
          for (var tt = 0; tt < TOKENS; tt++) {
            var at = tokenCell(pp, tt);
            if (!at) continue;
            var isMovable = (pp === turn && movable.indexOf(tt) !== -1 && myTurn());
            var x = at[0] * CELL + CELL / 2;
            var y = at[1] * CELL + CELL / 2;
            if (tok[pp][tt] === HOME_POS) {
              x = 7.5 * CELL + (pp % 2 ? 16 : -16);
              y = 7.5 * CELL + (pp > 1 ? 16 : -16);
            }
            ctx.beginPath();
            ctx.arc(x, y, CELL * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = COLORS[pp];
            ctx.fill();
            ctx.lineWidth = isMovable ? 3 : 1.5;
            ctx.strokeStyle = isMovable ? '#f8fafc' : '#0b1220';
            ctx.stroke();
          }
        }

        // Dice
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fillRect(6.1 * CELL, 9.3 * CELL, 2.8 * CELL, 1.4 * CELL);
        ctx.fillStyle = COLORS[turn];
        ctx.font = 'bold 34px "Cascadia Code", Consolas, monospace';
        ctx.fillText(dice ? String(dice) : '·', 7.5 * CELL, 10 * CELL);

        // Who is playing
        if (mode === 'computer') {
          ctx.textAlign = 'left';
          ctx.font = 'bold 14px "Segoe UI", sans-serif';
          ctx.fillStyle = COLORS[active[0]];
          ctx.fillText('You are ' + NAMES[active[0]], 10, 18);
          ctx.textAlign = 'right';
          ctx.fillStyle = myTurn() ? '#86efac' : '#fde047';
          ctx.fillText(myTurn() ? 'Your move' : NAMES[turn] + ' is thinking', N * CELL - 10, 18);
          ctx.textAlign = 'center';
        }

        if (message) {
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '15px "Segoe UI", sans-serif';
          ctx.fillText(message, N * CELL / 2, N * CELL - 12);
        }
      }

      return {
        reset: newGame,

        key: function (name) {
          if (name === 'action') doRoll();
        },

        update: function (dt) {
          syncHud();
          syncControls();
          if (pending) {
            pendingT -= dt;
            if (pendingT <= 0) { var fn = pending; pending = null; fn(); }
          }
          if (pendingAI > 0) {
            pendingAI -= dt;
            if (pendingAI <= 0) {
              pendingAI = 0;
              if (!dice) rollDice();
              else if (movable.length) play(aiChoose());
            }
          }
        },

        draw: draw
      };
    }
  });
})();

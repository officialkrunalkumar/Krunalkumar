/* ==========================================================================
   snakes-ladders.js — the classic board, walked one square at a time.
   --------------------------------------------------------------------------
   THE NUMBERING IS ARITHMETIC, NOT A TABLE. The board is boustrophedon —
   the row for 1..10 runs left to right, 11..20 runs right to left, and so on
   up the board, the way an ox ploughs a field, which is what the word means.
   That is two lines: the row is (n - 1) / 10, the column is (n - 1) % 10, and
   odd rows mirror the column. A hand-written table of a hundred coordinates
   is the same thing with somewhere to hide a typo.

   ONE CURVE DOES BOTH JOBS. Each snake and ladder stores a quadratic Bezier,
   and that same curve is what gets stroked as the artwork AND what the token
   is interpolated along when it slides. They cannot drift apart, because
   there is only one of them — an earlier version drew a bowed snake and slid
   the token down the straight line between its ends, which looked like the
   token had missed.

   THE TURN IS DRIVEN BY THE ANIMATION, not the other way round. A roll does
   not change whose go it is; the token finishing its walk does. That is why
   there is a phase variable rather than a move() that returns: watching
   yourself climb, and then slide back down, is the entire emotional content
   of this game, and a turn that advanced underneath the animation would let
   the next player roll into a board still in motion.

   The computer opponent makes no decisions because the game contains none.
   It is a timer that presses Roll, and the page says so.
   ========================================================================== */

(function () {
  'use strict';

  var CELL = 52;
  var MARGIN = 20;
  var TOP = 58;                        // status strip above the board
  var W = MARGIN * 2 + CELL * 10;      // 560
  var H = 620;
  var FOOT = TOP + CELL * 10;          // 578 — top edge of the bottom strip

  var STEP_T = 0.10;                   // seconds per square while walking

  /* The Milton Bradley layout that most boards sold as "Snakes and Ladders"
     copy. Nine ladders, ten snakes, no chains: no ladder top is a snake head
     and no snake tail is a ladder foot, so one move can never trigger a
     second. Boards that do chain exist, and they make the last row a
     lottery. */
  var LADDERS = [
    [1, 38], [4, 14], [9, 31], [21, 42], [28, 84],
    [36, 44], [51, 67], [71, 91], [80, 100]
  ];
  var SNAKES = [
    [16, 6], [47, 26], [49, 11], [56, 53], [62, 19],
    [64, 60], [87, 24], [93, 73], [95, 75], [98, 78]
  ];

  /* Green tokens are deliberately absent: every snake on the board is green,
     and a player token the same colour as the hazard is unreadable. */
  var FILL = ['#f87171', '#c084fc', '#fbbf24', '#7dd3fc'];
  var EDGE = ['#7f1d1d', '#5b21b6', '#78350f', '#075985'];
  var NAMES = ['Red', 'Violet', 'Amber', 'Blue'];

  var SNAKE_BODY = ['#166534', '#115e59', '#3f6212', '#14532d'];
  var SNAKE_SKIN = ['#4ade80', '#2dd4bf', '#a3e635', '#86efac'];

  var PEN = { x: 64, y: (FOOT + H) / 2 };
  var OFFSET = [[-9, -9], [9, -9], [-9, 9], [9, 9]];

  var PIPS = [
    [[1, 1]],
    [[0, 0], [2, 2]],
    [[0, 0], [1, 1], [2, 2]],
    [[0, 0], [2, 0], [0, 2], [2, 2]],
    [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]]
  ];

  function cellXY(n) {
    if (n <= 0) return { x: PEN.x, y: PEN.y };
    var r = Math.floor((n - 1) / 10);          // 0 is the bottom row
    var c = (n - 1) % 10;
    if (r % 2 === 1) c = 9 - c;                // the boustrophedon flip
    return { x: MARGIN + c * CELL + CELL / 2, y: TOP + (9 - r) * CELL + CELL / 2 };
  }

  function bezier(cv, t) {
    var u = 1 - t;
    return {
      x: u * u * cv.ax + 2 * u * t * cv.cx + t * t * cv.bx,
      y: u * u * cv.ay + 2 * u * t * cv.cy + t * t * cv.by
    };
  }

  /* Bend alternates so neighbouring snakes do not all bow the same way and
     read as one long ribbon. */
  function curveFor(from, to, index) {
    var a = cellXY(from);
    var b = cellXY(to);
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bend = Math.min(44, len * 0.2) * (index % 2 ? -1 : 1);
    return {
      ax: a.x, ay: a.y, bx: b.x, by: b.y,
      cx: (a.x + b.x) / 2 + (-dy / len) * bend,
      cy: (a.y + b.y) / 2 + (dx / len) * bend,
      len: len
    };
  }

  var JUMP = {};
  var ART = [];
  (function () {
    var i;
    for (i = 0; i < LADDERS.length; i++) {
      var l = { from: LADDERS[i][0], to: LADDERS[i][1], kind: 'ladder', idx: i };
      l.curve = curveFor(l.from, l.to, 0);      // ladders are straight
      JUMP[l.from] = l;
      ART.push(l);
    }
    for (i = 0; i < SNAKES.length; i++) {
      var s = { from: SNAKES[i][0], to: SNAKES[i][1], kind: 'snake', idx: i };
      s.curve = curveFor(s.from, s.to, i);
      JUMP[s.from] = s;
      ART.push(s);
    }
  })();

  GameShell.define({
    id: 'game-snakes-ladders',
    slug: 'snakes-ladders',
    title: 'Snakes and Ladders',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,        // a stray tap on the board must not roll the die

    setup: function (g) {
      var players = 2;
      var mode = 'computer';
      var active = [0, 1];
      var pos = [0, 0, 0, 0];
      var turn = 0;
      var dice = 0;
      var face = 1;
      var faceT = 0;
      var phase = 'idle';      // idle | roll | walk | wait | slide | done
      var timer = 0;
      var then = null;
      var aiT = 0;
      var mover = -1;
      var walkAt = 0;
      var walkTo = 0;
      var stepT = 0;
      var curve = null;
      var slideTo = 0;
      var slideDur = 0.6;
      var message = '';

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
        players = Number(g.load('players', '2')) || 2;
        if (players < 2 || players > 4) players = 2;
        countSel.value = String(players);
        countSel.addEventListener('change', function () {
          players = Number(countSel.value) || 2; g.save('players', players); g.start();
        });
      }
      if (rollBtn) rollBtn.addEventListener('click', function () { doRoll(); });

      function myTurn() {
        if (mode === 'computer') return turn === 0;
        return true;
      }

      /* Delays run on the game clock rather than on setTimeout, so a paused
         or finished board does not resume moving on its own. */
      function after(seconds, fn) { phase = 'wait'; timer = seconds; then = fn; }

      /* --------------------------------------------------------------
         The turn
         -------------------------------------------------------------- */
      function doRoll() {
        if (g.state !== 'playing' || phase !== 'idle') return;
        if (!myTurn()) return;
        rollNow();
      }

      function rollNow() {
        phase = 'roll';
        timer = 0.5;
        faceT = 0;
        dice = 0;
        message = NAMES[turn] + ' is rolling';
        syncControls();
      }

      function resolveRoll() {
        dice = 1 + Math.floor(Math.random() * 6);
        face = dice;
        g.beep(280 + dice * 55, 0.06, 'sine');
        syncHud();

        var target = pos[turn] + dice;
        if (target > 100) {
          /* Exact roll to finish. An over-roll is simply not a legal move,
             so the token stays where it is — it does not bounce back off
             100, which is a different house rule and a worse one. */
          message = NAMES[turn] + ' rolled ' + dice + ' — needs exactly ' + (100 - pos[turn]);
          after(1, afterMove);
          return;
        }

        message = NAMES[turn] + ' rolled ' + dice;
        mover = turn;
        walkAt = pos[turn];
        walkTo = target;
        stepT = STEP_T;
        phase = 'walk';
        syncControls();
      }

      function arrive() {
        pos[turn] = walkTo;
        mover = -1;
        syncHud();
        var j = JUMP[pos[turn]];
        if (j) { after(0.3, function () { startSlide(j); }); return; }
        landed();
      }

      function startSlide(j) {
        mover = turn;
        curve = j.curve;
        slideTo = j.to;
        slideDur = Math.min(1.2, Math.max(0.45, j.curve.len / 430));
        timer = 0;
        phase = 'slide';
        if (j.kind === 'ladder') {
          g.sweep(280, 720, slideDur * 0.8);
          message = NAMES[turn] + ' climbs the ladder to ' + j.to;
        } else {
          g.sweep(660, 130, slideDur * 0.9);
          message = NAMES[turn] + ' hits the snake on ' + j.from + ' — down to ' + j.to;
        }
        syncControls();
      }

      function landed() {
        syncHud();
        if (pos[turn] === 100) { win(turn); return; }
        afterMove();
      }

      function afterMove() {
        mover = -1;
        if (dice === 6) {
          /* A six earns another roll. There is no three-sixes forfeit here;
             see the page copy. */
          dice = 0;
          message = NAMES[turn] + ' rolled a six — another roll';
          phase = 'idle';
          if (!myTurn()) aiT = 0.7;
        } else {
          endTurn();
        }
        syncHud();
        syncControls();
      }

      function endTurn() {
        dice = 0;
        var i = active.indexOf(turn);
        turn = active[(i + 1) % active.length];
        phase = 'idle';
        message = NAMES[turn] + ' to roll';
        if (!myTurn()) aiT = 0.7;
      }

      function win(seat) {
        phase = 'done';
        mover = -1;
        syncHud();
        syncControls();
        g.over({
          won: mode === 'pass' ? true : seat === 0,
          title: NAMES[seat] + ' wins',
          message: mode === 'pass'
            ? 'Home on an exact roll.'
            : (seat === 0 ? 'You landed on 100 exactly.' : 'They got there first.')
        });
      }

      /* --------------------------------------------------------------
         Chrome
         -------------------------------------------------------------- */
      function syncHud() {
        g.stat('turn', NAMES[turn]);
        g.stat('dice', dice || '—');
        g.stat('square', pos[turn]);
      }

      /* A Roll button that looks alive and does nothing when pressed reads
         as a broken page, so it says whose turn it is instead. */
      function syncControls() {
        if (!rollBtn) return;
        var mine = myTurn();
        rollBtn.disabled = !mine || phase !== 'idle' || g.state !== 'playing';
        if (phase === 'done') rollBtn.textContent = 'Roll';
        else if (!mine) rollBtn.textContent = NAMES[turn] + ' is rolling';
        else if (phase !== 'idle') rollBtn.textContent = 'Moving…';
        else if (mode === 'pass') rollBtn.textContent = 'Roll for ' + NAMES[turn];
        else rollBtn.textContent = 'Roll';
      }

      function newGame() {
        active = [];
        for (var i = 0; i < players; i++) active.push(i);
        pos = [0, 0, 0, 0];
        turn = 0;
        dice = 0;
        face = 1;
        phase = 'idle';
        timer = 0;
        then = null;
        aiT = 0;
        mover = -1;
        message = mode === 'computer' ? 'You are Red — roll to start' : NAMES[0] + ' to roll';
        syncHud();
        syncControls();
      }

      /* --------------------------------------------------------------
         Where a token is right now, animation included
         -------------------------------------------------------------- */
      function tokenXY(seat) {
        if (seat === mover && phase === 'walk') {
          var a = cellXY(walkAt);
          var b = cellXY(walkAt + 1);
          var p = 1 - Math.max(0, stepT) / STEP_T;
          return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
        }
        if (seat === mover && phase === 'slide' && curve) {
          return bezier(curve, Math.min(1, timer / slideDur));
        }
        return cellXY(pos[seat]);
      }

      function offsetFor(seat) {
        /* Tokens waiting to start are spread along the pen rather than
           stacked in a corner of it, so four of them are still countable. */
        if (pos[seat] === 0 && seat !== mover) return { x: seat * 21, y: 0 };
        return { x: OFFSET[seat][0], y: OFFSET[seat][1] };
      }

      /* --------------------------------------------------------------
         Drawing
         -------------------------------------------------------------- */
      function drawBoard(ctx) {
        for (var n = 1; n <= 100; n++) {
          var r = Math.floor((n - 1) / 10);
          var c = (n - 1) % 10;
          if (r % 2 === 1) c = 9 - c;
          var x = MARGIN + c * CELL;
          var y = TOP + (9 - r) * CELL;
          ctx.fillStyle = ((r + c) % 2) ? '#101c2f' : '#0b1524';
          ctx.fillRect(x, y, CELL, CELL);
          if (n === 100) {
            ctx.fillStyle = 'rgba(250,204,21,0.16)';
            ctx.fillRect(x, y, CELL, CELL);
          }
          ctx.fillStyle = n === 100 ? '#fde68a' : '#5b6b84';
          ctx.font = '10px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(String(n), x + 4, y + 4);
        }
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (var i = 0; i <= 10; i++) {
          ctx.beginPath();
          ctx.moveTo(MARGIN + i * CELL + 0.5, TOP);
          ctx.lineTo(MARGIN + i * CELL + 0.5, FOOT);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(MARGIN, TOP + i * CELL + 0.5);
          ctx.lineTo(MARGIN + 10 * CELL, TOP + i * CELL + 0.5);
          ctx.stroke();
        }
      }

      function drawLadder(ctx, cv) {
        var dx = cv.bx - cv.ax, dy = cv.by - cv.ay;
        var len = cv.len;
        var nx = -dy / len, ny = dx / len;
        var rail = 7;
        ctx.strokeStyle = '#c98f4e';
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        var s;
        for (s = -1; s <= 1; s += 2) {
          ctx.beginPath();
          ctx.moveTo(cv.ax + nx * rail * s, cv.ay + ny * rail * s);
          ctx.lineTo(cv.bx + nx * rail * s, cv.by + ny * rail * s);
          ctx.stroke();
        }
        var rungs = Math.max(2, Math.round(len / 26));
        ctx.strokeStyle = '#eab676';
        ctx.lineWidth = 2.5;
        for (var i = 1; i < rungs; i++) {
          var t = i / rungs;
          var px = cv.ax + dx * t, py = cv.ay + dy * t;
          ctx.beginPath();
          ctx.moveTo(px + nx * rail, py + ny * rail);
          ctx.lineTo(px - nx * rail, py - ny * rail);
          ctx.stroke();
        }
      }

      function drawSnake(ctx, item) {
        var cv = item.curve;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = SNAKE_BODY[item.idx % SNAKE_BODY.length];
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(cv.ax, cv.ay);
        ctx.quadraticCurveTo(cv.cx, cv.cy, cv.bx, cv.by);
        ctx.stroke();
        ctx.strokeStyle = SNAKE_SKIN[item.idx % SNAKE_SKIN.length];
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cv.ax, cv.ay);
        ctx.quadraticCurveTo(cv.cx, cv.cy, cv.bx, cv.by);
        ctx.stroke();

        /* The head sits on the square you must not land on, so it is drawn
           last and largest — it is the only part of the artwork that carries
           a rule. */
        ctx.beginPath();
        ctx.arc(cv.ax, cv.ay, 9, 0, Math.PI * 2);
        ctx.fillStyle = SNAKE_SKIN[item.idx % SNAKE_SKIN.length];
        ctx.fill();
        var toward = bezier(cv, 0.08);
        var hx = toward.x - cv.ax, hy = toward.y - cv.ay;
        var hl = Math.sqrt(hx * hx + hy * hy) || 1;
        var ex = -hy / hl * 3.6, ey = hx / hl * 3.6;
        ctx.fillStyle = '#0b1220';
        ctx.beginPath();
        ctx.arc(cv.ax + ex, cv.ay + ey, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cv.ax - ex, cv.ay - ey, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      function drawDie(ctx, x, y, size, v) {
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(x, y, size, size);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
        var pips = PIPS[Math.max(1, Math.min(6, v)) - 1];
        ctx.fillStyle = '#0f172a';
        for (var i = 0; i < pips.length; i++) {
          ctx.beginPath();
          ctx.arc(x + size * 0.25 + pips[i][0] * size * 0.25,
                  y + size * 0.25 + pips[i][1] * size * 0.25,
                  size * 0.075, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      function drawToken(ctx, seat) {
        var p = tokenXY(seat);
        var o = offsetFor(seat);
        var x = p.x + o.x, y = p.y + o.y;
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = FILL[seat];
        ctx.fill();
        ctx.strokeStyle = seat === turn && phase !== 'done' ? '#f8fafc' : EDGE[seat];
        ctx.lineWidth = seat === turn && phase !== 'done' ? 2.5 : 1.5;
        ctx.stroke();
      }

      return {
        reset: newGame,

        key: function (name) {
          if (name === 'action') doRoll();
        },

        update: function (dt) {
          if (phase === 'idle') {
            if (!myTurn() && aiT > 0) {
              aiT -= dt;
              if (aiT <= 0) rollNow();
            }
            return;
          }

          if (phase === 'roll') {
            timer -= dt;
            faceT -= dt;
            if (faceT <= 0) { face = 1 + Math.floor(Math.random() * 6); faceT = 0.06; }
            if (timer <= 0) resolveRoll();
            return;
          }

          if (phase === 'walk') {
            stepT -= dt;
            if (stepT <= 0) {
              walkAt++;
              pos[turn] = walkAt;
              g.beep(540, 0.025, 'sine', 0.03);
              if (walkAt >= walkTo) { arrive(); return; }
              stepT += STEP_T;
            }
            return;
          }

          if (phase === 'wait') {
            timer -= dt;
            if (timer <= 0) {
              var fn = then;
              then = null;
              if (fn) fn();
            }
            return;
          }

          if (phase === 'slide') {
            timer += dt;
            if (timer >= slideDur) {
              pos[turn] = slideTo;
              mover = -1;
              curve = null;
              landed();
            }
          }
        },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);

          drawBoard(ctx);

          var i;
          for (i = 0; i < ART.length; i++) {
            if (ART[i].kind === 'ladder') drawLadder(ctx, ART[i].curve);
          }
          for (i = 0; i < ART.length; i++) {
            if (ART[i].kind === 'snake') drawSnake(ctx, ART[i]);
          }

          /* The player about to move is drawn last so it is never hidden
             under a token sharing its square. */
          for (i = 0; i < active.length; i++) {
            if (active[i] !== turn) drawToken(ctx, active[i]);
          }
          drawToken(ctx, turn);

          // Top strip: whose turn, and the die
          ctx.beginPath();
          ctx.arc(30, TOP / 2, 10, 0, Math.PI * 2);
          ctx.fillStyle = FILL[turn];
          ctx.fill();
          ctx.strokeStyle = EDGE[turn];
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#e2e8f0';
          ctx.font = '15px "Segoe UI", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(mode === 'computer' && turn !== 0
            ? NAMES[turn] + ' (computer)'
            : NAMES[turn], 48, TOP / 2);

          drawDie(ctx, W - MARGIN - 38, TOP / 2 - 19, 38, phase === 'roll' ? face : (dice || face));

          // Bottom strip: the pen, then the running commentary
          ctx.fillStyle = '#5b6b84';
          ctx.font = '11px "Cascadia Code", Consolas, monospace';
          ctx.fillText('start', MARGIN, PEN.y);

          ctx.fillStyle = '#94a3b8';
          ctx.font = '13px "Segoe UI", sans-serif';
          ctx.fillText(message, 168, PEN.y);
        }
      };
    }
  });
})();

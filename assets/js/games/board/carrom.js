/* ==========================================================================
   carrom.js — carrom board, against the computer or pass and play.
   --------------------------------------------------------------------------
   Drag back from the striker and let go: an elastic-collision simulation
   with friction. Coins are equal-mass discs, the striker is heavier, and
   every impact is resolved along the line joining the two centres, which is
   the whole of two-dimensional elastic collision and the reason a thin cut
   sends a coin sideways rather than forward.

   TWO DETAILS THAT MAKE OR BREAK IT:

   1. OVERLAP IS PUSHED APART BEFORE THE IMPULSE. Resolving velocity alone
      leaves two discs interpenetrating, they collide again next frame, and
      the pair sticks together vibrating. Separating them along the normal
      first is what stops that.

   2. SUB-STEPPING. A struck coin can move further in one frame than a disc
      is wide, passing clean through another. The physics runs several small
      steps per frame so nothing tunnels — the same problem Breakout solves
      with a swept test, handled here by shortening the step instead,
      because with N moving bodies a sweep would need N-squared tests.
   ========================================================================== */

(function () {
  'use strict';

  var SIZE = 560;               // board is square
  var EDGE = 40;                // wooden border
  var PLAY = SIZE - EDGE * 2;
  var POCKET_R = 26;
  var COIN_R = 13;
  var STRIKER_R = 17;
  var FRICTION = 0.985;
  var STOP = 4;                 // below this speed a disc is at rest
  var SUBSTEPS = 6;

  var POCKETS = [
    [EDGE + 6, EDGE + 6], [SIZE - EDGE - 6, EDGE + 6],
    [EDGE + 6, SIZE - EDGE - 6], [SIZE - EDGE - 6, SIZE - EDGE - 6]
  ];

  GameShell.define({
    id: 'game-carrom',
    slug: 'carrom',
    title: 'Carrom',
    width: SIZE,
    height: SIZE,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var discs = [];           // { x, y, vx, vy, r, type, alive }
      var striker = null;
      var aiming = false;
      var aimFrom = null;
      var aimTo = null;
      var aimId = null;         // pointerId of the finger that owns the aim
      var strikerX = SIZE / 2;
      var turn = 0;             // 0 = you, 1 = opponent
      var mode = 'computer';
      var scores = [0, 0];
      var message = '';
      var settleT = 0;
      var shotTaken = false;
      var pocketedThisShot = [];
      var aiPending = 0;

      var modeSel = document.getElementById('game-mode');
      if (modeSel) {
        mode = g.load('mode', 'computer');
        if (mode !== 'computer' && mode !== 'pass') mode = 'computer';
        modeSel.value = mode;
        modeSel.addEventListener('change', function () {
          mode = modeSel.value; g.save('mode', mode); g.start();
        });
      }

      function newRack() {
        discs = [];
        var cx = SIZE / 2, cy = SIZE / 2;
        /* The queen in the middle, then two rings of alternating black and
           white — the standard opening arrangement. */
        discs.push({ x: cx, y: cy, vx: 0, vy: 0, r: COIN_R, type: 'queen', alive: true });
        var ring1 = 6, r1 = COIN_R * 2.05;
        for (var i = 0; i < ring1; i++) {
          var a = (i / ring1) * Math.PI * 2;
          discs.push({
            x: cx + Math.cos(a) * r1, y: cy + Math.sin(a) * r1,
            vx: 0, vy: 0, r: COIN_R, type: i % 2 ? 'white' : 'black', alive: true
          });
        }
        var ring2 = 12, r2 = COIN_R * 4.05;
        for (var j = 0; j < ring2; j++) {
          var a2 = (j / ring2) * Math.PI * 2 + 0.26;
          discs.push({
            x: cx + Math.cos(a2) * r2, y: cy + Math.sin(a2) * r2,
            vx: 0, vy: 0, r: COIN_R, type: j % 2 ? 'black' : 'white', alive: true
          });
        }
        placeStriker();
      }

      function placeStriker() {
        /* The striker sits on the baseline nearest whoever is to play. */
        var y = turn === 0 ? SIZE - EDGE - 46 : EDGE + 46;
        striker = { x: strikerX, y: y, vx: 0, vy: 0, r: STRIKER_R, type: 'striker', alive: true };
      }

      function allBodies() {
        var out = [];
        for (var i = 0; i < discs.length; i++) if (discs[i].alive) out.push(discs[i]);
        if (striker && striker.alive) out.push(striker);
        return out;
      }

      function moving() {
        var b = allBodies();
        for (var i = 0; i < b.length; i++) {
          if (Math.abs(b[i].vx) > STOP || Math.abs(b[i].vy) > STOP) return true;
        }
        return false;
      }

      function collide(a, b) {
        var dx = b.x - a.x, dy = b.y - a.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var min = a.r + b.r;
        if (d === 0 || d >= min) return;

        var nx = dx / d, ny = dy / d;

        /* 1. Separate. Skipping this leaves the pair overlapping and they
           re-collide every frame, which reads as two coins glued together
           and buzzing. */
        var overlap = (min - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;

        /* 2. Elastic impulse along the normal. Mass is proportional to
           radius squared, so the striker genuinely shoves coins about. */
        var ma = a.r * a.r, mb = b.r * b.r;
        var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        var vn = rvx * nx + rvy * ny;
        if (vn > 0) return;                       // already separating
        var imp = -(1.88 * vn) / (1 / ma + 1 / mb);
        a.vx -= (imp * nx) / ma; a.vy -= (imp * ny) / ma;
        b.vx += (imp * nx) / mb; b.vy += (imp * ny) / mb;
        g.beep(240 + Math.min(400, Math.abs(vn) * 0.6), 0.03, 'sine', 0.03);
      }

      function stepPhysics(dt) {
        var h = dt / SUBSTEPS;
        for (var s = 0; s < SUBSTEPS; s++) {
          var bodies = allBodies();
          for (var i = 0; i < bodies.length; i++) {
            var b = bodies[i];
            b.x += b.vx * h;
            b.y += b.vy * h;
            b.vx *= Math.pow(FRICTION, h * 60);
            b.vy *= Math.pow(FRICTION, h * 60);
            if (Math.abs(b.vx) < STOP && Math.abs(b.vy) < STOP) { b.vx = 0; b.vy = 0; }

            // Cushions
            if (b.x - b.r < EDGE) { b.x = EDGE + b.r; b.vx = Math.abs(b.vx) * 0.82; }
            if (b.x + b.r > SIZE - EDGE) { b.x = SIZE - EDGE - b.r; b.vx = -Math.abs(b.vx) * 0.82; }
            if (b.y - b.r < EDGE) { b.y = EDGE + b.r; b.vy = Math.abs(b.vy) * 0.82; }
            if (b.y + b.r > SIZE - EDGE) { b.y = SIZE - EDGE - b.r; b.vy = -Math.abs(b.vy) * 0.82; }
          }

          for (var a = 0; a < bodies.length; a++) {
            for (var c = a + 1; c < bodies.length; c++) collide(bodies[a], bodies[c]);
          }

          // Pockets
          for (var p = 0; p < bodies.length; p++) {
            var body = bodies[p];
            for (var k = 0; k < POCKETS.length; k++) {
              var pdx = body.x - POCKETS[k][0], pdy = body.y - POCKETS[k][1];
              if (pdx * pdx + pdy * pdy < POCKET_R * POCKET_R) {
                body.alive = false;
                body.vx = 0; body.vy = 0;
                if (body.type !== 'striker') pocketedThisShot.push(body.type);
                else pocketedThisShot.push('striker');
                g.beep(700, 0.1, 'sine');
                break;
              }
            }
          }
        }
      }

      function endShot() {
        var gained = 0;
        var foul = false;
        for (var i = 0; i < pocketedThisShot.length; i++) {
          var t = pocketedThisShot[i];
          if (t === 'striker') foul = true;
          else if (t === 'queen') gained += 3;
          else gained += 1;
        }

        if (foul) {
          /* Pocketing the striker is a foul: no points, and one of your
             coins comes back to the middle if you have any. */
          scores[turn] = Math.max(0, scores[turn] - 1);
          message = (turn === 0 ? 'You' : 'They') + ' pocketed the striker — one point back';
          returnACoin();
          gained = 0;
        } else if (gained) {
          scores[turn] += gained;
          message = (turn === 0 ? 'You' : 'They') + ' scored ' + gained;
        } else {
          message = 'Nothing sunk';
        }

        g.stat('you', scores[0]);
        g.stat('them', scores[1]);

        var left = 0;
        for (var d = 0; d < discs.length; d++) if (discs[d].alive) left++;
        if (!left) {
          g.over({
            won: scores[0] >= scores[1],
            title: scores[0] > scores[1] ? 'You win' : scores[0] === scores[1] ? 'A draw' : 'They win',
            message: 'Final score ' + scores[0] + ' to ' + scores[1] + '.'
          });
          return;
        }

        /* Sinking something (cleanly) keeps the board. */
        if (!gained || foul) turn = turn === 0 ? 1 : 0;
        pocketedThisShot = [];
        shotTaken = false;
        strikerX = SIZE / 2;
        placeStriker();
        if (mode === 'computer' && turn === 1) aiPending = 0.7;
      }

      function returnACoin() {
        for (var i = 0; i < discs.length; i++) {
          if (!discs[i].alive && discs[i].type !== 'queen') {
            discs[i].alive = true;
            discs[i].x = SIZE / 2 + (Math.random() - 0.5) * 20;
            discs[i].y = SIZE / 2 + (Math.random() - 0.5) * 20;
            discs[i].vx = 0; discs[i].vy = 0;
            return;
          }
        }
      }

      function fire(dx, dy) {
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 6) return;
        var power = Math.min(d, 150) / 150;
        var speed = 190 + power * 720;
        striker.vx = (dx / d) * speed;
        striker.vy = (dy / d) * speed;
        shotTaken = true;
        settleT = 0;
        pocketedThisShot = [];
        g.beep(520, 0.06, 'square');
      }

      /* The opponent aims at whichever live coin gives the straightest line
         into a pocket, with a little wobble so it is not perfect. */
      function aiShoot() {
        var best = null, bestScore = -Infinity;
        for (var i = 0; i < discs.length; i++) {
          var c = discs[i];
          if (!c.alive) continue;
          for (var k = 0; k < POCKETS.length; k++) {
            var toPocketX = POCKETS[k][0] - c.x, toPocketY = POCKETS[k][1] - c.y;
            var pl = Math.sqrt(toPocketX * toPocketX + toPocketY * toPocketY);
            // Aim point: just behind the coin, on the line to that pocket.
            var ax = c.x - (toPocketX / pl) * (COIN_R + STRIKER_R);
            var ay = c.y - (toPocketY / pl) * (COIN_R + STRIKER_R);
            var dx = ax - striker.x, dy = ay - striker.y;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) continue;
            /* Prefer short striker travel, short pocket runs, and the queen. */
            var score = -dist * 0.5 - pl * 0.7 + (c.type === 'queen' ? 90 : 0);
            if (score > bestScore) { bestScore = score; best = { dx: dx, dy: dy }; }
          }
        }
        if (!best) { turn = 0; placeStriker(); return; }
        var wobble = 0.10;
        var ang = Math.atan2(best.dy, best.dx) + (Math.random() - 0.5) * wobble;
        var mag = 120 + Math.random() * 30;
        fire(Math.cos(ang) * mag, Math.sin(ang) * mag);
      }

      /* ------------------------------------------------------------------
         Aiming, and every way an aim can end.

         A drag that wandered off the canvas used to take its release with
         it: the pointerup landed on the page, or the toolbar, or on nothing
         at all, the canvas never heard it, and `aiming` was left true with
         the old aimFrom and aimTo still in it. The shot was lost — and then
         it was worse than lost, because the next press near the baseline
         slid the striker and returned early, and that press's own release
         found `aiming` still standing and played the previous drag, measured
         from where the striker had been rather than where it now was. The
         player was handed a shot they had never aimed.

         So every ending goes through endAim(), which owns all four aim
         variables and therefore cannot leave two of them set, and which is
         told whether the ending was a genuine release. A cancel, a restart
         and a fresh press all end an aim WITHOUT playing it, because none of
         them is a finger being lifted off a pull-back.
         ------------------------------------------------------------------ */
      function endAim(shoot) {
        if (!aiming) return;
        var from = aimFrom, to = aimTo;
        aiming = false;
        aimFrom = null;
        aimTo = null;
        aimId = null;
        if (!shoot || !from || !to) return;
        /* These held when the aim began, and the release is a later moment
           that need not still meet them: changing the mode calls g.start()
           and re-racks the board underneath a drag in progress, and a fresh
           rack must not be answered with a shot aimed at the striker it
           replaced. */
        if (shotTaken || moving()) return;
        if (!striker || !striker.alive) return;
        if (mode === 'computer' && turn === 1) return;
        /* Drag BACK to shoot forward, like a real flick. */
        fire(from.x - to.x, from.y - to.y);
      }

      /* A second finger must not steer, end or fire an aim the first one
         began, which matters now that the window is listening as well: a
         touch released anywhere on the page would otherwise loose the shot.
         The pointerId being absent is treated as a match rather than a
         mismatch, since an engine that fires pointer events without ids
         cannot have more than one pointer to confuse. */
      function isAimPointer(event) {
        if (!aiming) return false;
        if (aimId == null || !event || event.pointerId == null) return true;
        return event.pointerId === aimId;
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          /* A press is a new interaction, so nothing of the last one may
             still be standing when it starts. This is the belt to the
             capture's braces: even if some engine loses a release entirely,
             the stale aim dies here rather than firing later. */
          endAim(false);
          if (shotTaken || moving()) return;
          if (mode === 'computer' && turn === 1) return;
          var p = g.pointAt(event);
          var baseY = turn === 0 ? SIZE - EDGE - 46 : EDGE + 46;
          /* Clicking on the baseline slides the striker; clicking anywhere
             else starts an aim. */
          if (Math.abs(p.y - baseY) < 34) {
            strikerX = Math.max(EDGE + 60, Math.min(SIZE - EDGE - 60, p.x));
            striker.x = strikerX;
            return;
          }
          aiming = true;
          aimFrom = { x: striker.x, y: striker.y };
          aimTo = p;
          aimId = event.pointerId == null ? null : event.pointerId;
          /* Capturing the pointer is the real fix and not merely half of
             one. It brings the release back to the canvas however far
             outside the board the finger has gone, and it keeps the
             pointermove stream coming too — without it the aim froze at the
             edge of the canvas, so a hard pull drew a dashed line that
             promised a different shot from the one about to be played.
             Capture is allowed to fail: a synthesised event carries a
             pointerId nothing can be attached to, and it throws rather than
             returning false, which is why the window listeners below are
             kept as a net under it. */
          if (g.canvas.setPointerCapture && event.pointerId != null) {
            try { g.canvas.setPointerCapture(event.pointerId); } catch (err) {}
          }
        });
        g.canvas.addEventListener('pointermove', function (event) {
          if (!isAimPointer(event)) return;
          aimTo = g.pointAt(event);
        });

        var onRelease = function (event) {
          if (!isAimPointer(event)) return;
          endAim(true);
        };
        /* A cancel is the browser taking the pointer away — a touch that
           the page decided was a scroll, a system gesture, a lost capture —
           and it is emphatically not a release, so the aim is dropped
           rather than played. Firing here would give a phantom shot to
           somebody who was trying to scroll past the board. */
        var onCancel = function (event) {
          if (!isAimPointer(event)) return;
          endAim(false);
        };

        g.canvas.addEventListener('pointerup', onRelease);
        g.canvas.addEventListener('pointercancel', onCancel);
        /* The captured events reach the canvas first and endAim() has
           already cleared `aiming` by the time they bubble this far, so
           these two do nothing at all in the normal case; they answer only
           the release capture could not be taken out on. */
        window.addEventListener('pointerup', onRelease);
        window.addEventListener('pointercancel', onCancel);
      }

      function draw(ctx) {
        // Board and border
        ctx.fillStyle = '#5b3a1e';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = '#d8b483';
        ctx.fillRect(EDGE, EDGE, PLAY, PLAY);

        // Centre circle and the decorative arcs
        ctx.strokeStyle = 'rgba(90,60,30,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 62, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, 20, 0, Math.PI * 2); ctx.stroke();

        // Baselines
        ctx.strokeStyle = 'rgba(120,50,40,0.7)';
        ctx.lineWidth = 3;
        var b1 = SIZE - EDGE - 46, b2 = EDGE + 46;
        ctx.beginPath(); ctx.moveTo(EDGE + 52, b1); ctx.lineTo(SIZE - EDGE - 52, b1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(EDGE + 52, b2); ctx.lineTo(SIZE - EDGE - 52, b2); ctx.stroke();

        // Pockets
        for (var k = 0; k < POCKETS.length; k++) {
          ctx.beginPath();
          ctx.arc(POCKETS[k][0], POCKETS[k][1], POCKET_R, 0, Math.PI * 2);
          ctx.fillStyle = '#160d06';
          ctx.fill();
        }

        // Coins
        for (var i = 0; i < discs.length; i++) {
          var c = discs[i];
          if (!c.alive) continue;
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          ctx.fillStyle = c.type === 'queen' ? '#b91c1c' : c.type === 'white' ? '#f5f0e6' : '#2b2b2b';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Striker
        if (striker && striker.alive) {
          ctx.beginPath();
          ctx.arc(striker.x, striker.y, striker.r, 0, Math.PI * 2);
          ctx.fillStyle = '#38bdf8';
          ctx.fill();
          ctx.strokeStyle = '#0c4a6e';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Aim line: drawn FORWARD from the striker, opposite the drag, so it
        // shows where the shot goes rather than where the finger is.
        if (aiming && aimFrom && aimTo) {
          var dx = aimFrom.x - aimTo.x, dy = aimFrom.y - aimTo.y;
          var d = Math.sqrt(dx * dx + dy * dy) || 1;
          var power = Math.min(d, 150) / 150;
          ctx.strokeStyle = 'rgba(248,250,252,0.8)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(striker.x, striker.y);
          ctx.lineTo(striker.x + (dx / d) * 150 * power, striker.y + (dy / d) * 150 * power);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Score strip
        ctx.fillStyle = 'rgba(20,10,4,0.78)';
        ctx.fillRect(0, 0, SIZE, EDGE - 8);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '15px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('You ' + scores[0], 14, EDGE / 2 - 4);
        ctx.textAlign = 'right';
        ctx.fillText((mode === 'computer' ? 'Computer ' : 'Player 2 ') + scores[1], SIZE - 14, EDGE / 2 - 4);
        ctx.textAlign = 'center';
        ctx.fillStyle = turn === 0 ? '#86efac' : '#fde047';
        ctx.fillText(moving() ? '…' : (turn === 0 ? 'Your shot' : (mode === 'computer' ? 'Their shot' : 'Player 2')), SIZE / 2, EDGE / 2 - 4);

        if (message) {
          ctx.fillStyle = 'rgba(20,10,4,0.78)';
          ctx.fillRect(0, SIZE - EDGE + 8, SIZE, EDGE - 8);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '14px "Segoe UI", sans-serif';
          ctx.fillText(message, SIZE / 2, SIZE - EDGE / 2 + 8);
        }
      }

      return {
        reset: function () {
          /* A restart can arrive in the middle of a drag — the mode dropdown
             calls g.start() from its own change handler — and the aim it
             interrupts belongs to a board that no longer exists. Dropped
             here rather than left for the release to sort out, so no aim
             ever outlives the rack it was taken against. */
          endAim(false);
          scores = [0, 0];
          turn = 0;
          strikerX = SIZE / 2;
          shotTaken = false;
          pocketedThisShot = [];
          aiPending = 0;
          message = 'Drag back from the striker and let go';
          g.stat('you', 0);
          g.stat('them', 0);
          newRack();
        },

        update: function (dt) {
          if (aiPending > 0) {
            aiPending -= dt;
            if (aiPending <= 0) { aiPending = 0; aiShoot(); }
            return;
          }
          stepPhysics(dt);
          if (shotTaken && !moving()) {
            settleT += dt;
            if (settleT > 0.25) { settleT = 0; endShot(); }
          }
        },

        draw: draw
      };
    }
  });
})();

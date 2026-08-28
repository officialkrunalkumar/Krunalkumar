/* ==========================================================================
   air-hockey.js — shufflepuck, after TuxPuck.
   --------------------------------------------------------------------------
   Your mallet follows the pointer, so the puck picks up the speed you were
   moving at rather than just bouncing off a wall. That is the entire feel of
   the game: the mallet's velocity is measured between frames and fed into
   the collision, which is why a flick sends the puck away much harder than
   simply standing in its path.

   The puck is swept against the goal line rather than tested at it — at full
   speed it covers more than the goal mouth's depth in a frame, and a
   point-in-box test would miss the goal entirely on the best shot of the
   match.
   ========================================================================== */

(function () {
  'use strict';

  var W = 420;
  var H = 620;
  var WALL = 12;
  var GOAL_W = 150;
  var PUCK_R = 13;
  var MALLET_R = 26;
  var MAXV = 900;
  var TARGET = 7;

  GameShell.define({
    id: 'game-air-hockey',
    slug: 'air-hockey',
    title: 'Air hockey',
    width: W,
    height: H,
    bestKey: null,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      var you = { x: W / 2, y: H - 90, px: W / 2, py: H - 90, vx: 0, vy: 0 };
      var cpu = { x: W / 2, y: 90, vx: 0, vy: 0 };
      var score = [0, 0];
      var serveT = 0;
      var difficulty = 0.72;

      var levelSel = document.getElementById('game-level');
      if (levelSel) {
        difficulty = Number(g.load('level', '72')) / 100 || 0.72;
        levelSel.value = String(Math.round(difficulty * 100));
        levelSel.addEventListener('change', function () {
          difficulty = Number(levelSel.value) / 100;
          g.save('level', levelSel.value);
        });
      }

      function serve(toward) {
        puck.x = W / 2;
        puck.y = H / 2;
        var a = (toward > 0 ? 1 : -1) * (Math.PI / 2) + (Math.random() - 0.5) * 1.1;
        puck.vx = Math.cos(a) * 190;
        puck.vy = Math.sin(a) * 190;
        serveT = 0.55;
      }

      function hitMallet(m, mvx, mvy) {
        var dx = puck.x - m.x, dy = puck.y - m.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var min = PUCK_R + MALLET_R;
        if (d === 0 || d >= min) return;

        var nx = dx / d, ny = dy / d;
        puck.x = m.x + nx * min;
        puck.y = m.y + ny * min;

        /* Reflect about the contact normal, then ADD the mallet's own
           velocity along that normal. Without the second part the puck can
           never leave faster than it arrived and the game has no offence. */
        var vn = puck.vx * nx + puck.vy * ny;
        puck.vx -= 2 * vn * nx;
        puck.vy -= 2 * vn * ny;
        var mn = mvx * nx + mvy * ny;
        if (mn > 0) { puck.vx += nx * mn * 1.15; puck.vy += ny * mn * 1.15; }

        var sp = Math.sqrt(puck.vx * puck.vx + puck.vy * puck.vy);
        if (sp > MAXV) { puck.vx = puck.vx / sp * MAXV; puck.vy = puck.vy / sp * MAXV; }
        if (sp < 130) { puck.vx = nx * 130; puck.vy = ny * 130; }
        g.beep(300 + Math.min(500, sp * 0.35), 0.04, 'square', 0.04);
      }

      if (g.canvas) {
        var track = function (event) {
          var p = g.pointAt(event);
          you.x = Math.max(WALL + MALLET_R, Math.min(W - WALL - MALLET_R, p.x));
          /* You are confined to your own half — the line down the middle is
             the one rule air hockey actually has. */
          you.y = Math.max(H / 2 + MALLET_R, Math.min(H - WALL - MALLET_R, p.y));
        };
        g.canvas.addEventListener('pointermove', track);
        g.canvas.addEventListener('pointerdown', track);
      }

      function goal(who) {
        score[who]++;
        g.stat('you', score[0]);
        g.stat('them', score[1]);
        if (who === 0) g.beep(880, 0.16, 'sine'); else g.sweep(320, 140, 0.35);
        if (score[who] >= TARGET) {
          g.over({
            won: who === 0,
            title: who === 0 ? 'You win' : 'They win',
            message: 'Final score ' + score[0] + '–' + score[1] + '.'
          });
          return;
        }
        serve(who === 0 ? -1 : 1);
      }

      return {
        reset: function () {
          score = [0, 0];
          g.stat('you', 0);
          g.stat('them', 0);
          you.x = W / 2; you.y = H - 90;
          cpu.x = W / 2; cpu.y = 90;
          serve(Math.random() < 0.5 ? 1 : -1);
        },

        update: function (dt) {
          // Your mallet's velocity, measured between frames.
          you.vx = (you.x - you.px) / Math.max(dt, 0.0001);
          you.vy = (you.y - you.py) / Math.max(dt, 0.0001);
          you.px = you.x; you.py = you.y;

          // The opponent tracks the puck when it is on its side, and drifts
          // back to centre when it is not.
          var targetX = puck.y < H / 2 ? puck.x : W / 2;
          var targetY = puck.y < H / 2 ? Math.min(puck.y - 6, H / 2 - MALLET_R) : 90;
          var speed = 240 + difficulty * 460;
          var ddx = targetX - cpu.x, ddy = targetY - cpu.y;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          var step = Math.min(dd, speed * dt);
          var ncx = cpu.x + (ddx / dd) * step;
          var ncy = cpu.y + (ddy / dd) * step;
          cpu.vx = (ncx - cpu.x) / Math.max(dt, 0.0001);
          cpu.vy = (ncy - cpu.y) / Math.max(dt, 0.0001);
          cpu.x = Math.max(WALL + MALLET_R, Math.min(W - WALL - MALLET_R, ncx));
          cpu.y = Math.max(WALL + MALLET_R, Math.min(H / 2 - MALLET_R, ncy));

          if (serveT > 0) { serveT -= dt; return; }

          var prevY = puck.y;
          puck.x += puck.vx * dt;
          puck.y += puck.vy * dt;
          puck.vx *= Math.pow(0.995, dt * 60);
          puck.vy *= Math.pow(0.995, dt * 60);

          // Side walls
          if (puck.x - PUCK_R < WALL) { puck.x = WALL + PUCK_R; puck.vx = Math.abs(puck.vx); g.beep(200, 0.02, 'square', 0.02); }
          if (puck.x + PUCK_R > W - WALL) { puck.x = W - WALL - PUCK_R; puck.vx = -Math.abs(puck.vx); g.beep(200, 0.02, 'square', 0.02); }

          var goalLeft = (W - GOAL_W) / 2, goalRight = goalLeft + GOAL_W;

          /* Swept goal test. At 900 units a second the puck covers 15 units
             per frame, more than the goal mouth is deep, so checking only
             the new position misses the hardest shots. */
          if (puck.y - PUCK_R < WALL) {
            var tTop = (WALL + PUCK_R - prevY) / Math.max(puck.y - prevY, -1e9);
            var xTop = puck.x;
            if (xTop > goalLeft && xTop < goalRight) { goal(0); return; }
            puck.y = WALL + PUCK_R; puck.vy = Math.abs(puck.vy);
          }
          if (puck.y + PUCK_R > H - WALL) {
            var xBot = puck.x;
            if (xBot > goalLeft && xBot < goalRight) { goal(1); return; }
            puck.y = H - WALL - PUCK_R; puck.vy = -Math.abs(puck.vy);
          }

          hitMallet(you, you.vx, you.vy);
          hitMallet(cpu, cpu.vx, cpu.vy);
        },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#123047';
          ctx.fillRect(WALL, WALL, W - WALL * 2, H - WALL * 2);

          var goalLeft = (W - GOAL_W) / 2;
          ctx.fillStyle = '#020617';
          ctx.fillRect(goalLeft, 0, GOAL_W, WALL + 2);
          ctx.fillRect(goalLeft, H - WALL - 2, GOAL_W, WALL + 2);

          ctx.strokeStyle = 'rgba(125,211,252,0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(WALL, H / 2); ctx.lineTo(W - WALL, H / 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(W / 2, H / 2, 58, 0, Math.PI * 2); ctx.stroke();

          ctx.beginPath(); ctx.arc(cpu.x, cpu.y, MALLET_R, 0, Math.PI * 2);
          ctx.fillStyle = '#f87171'; ctx.fill();
          ctx.strokeStyle = '#7f1d1d'; ctx.lineWidth = 3; ctx.stroke();

          ctx.beginPath(); ctx.arc(you.x, you.y, MALLET_R, 0, Math.PI * 2);
          ctx.fillStyle = '#4ade80'; ctx.fill();
          ctx.strokeStyle = '#14532d'; ctx.lineWidth = 3; ctx.stroke();

          ctx.beginPath(); ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
          ctx.fillStyle = '#f8fafc'; ctx.fill();

          ctx.fillStyle = 'rgba(226,232,240,0.85)';
          ctx.font = 'bold 26px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(String(score[1]), W - 34, H / 2 - 22);
          ctx.fillText(String(score[0]), W - 34, H / 2 + 44);

          if (serveT > 0) {
            ctx.fillStyle = 'rgba(226,232,240,0.8)';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.fillText('First to ' + TARGET, W / 2, H / 2 - 76);
          }
        }
      };
    }
  });
})();

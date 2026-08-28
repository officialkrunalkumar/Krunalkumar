/* ==========================================================================
   tux-racer.js — downhill, after Extreme Tux Racer.
   --------------------------------------------------------------------------
   A downhill run drawn in fake perspective: the world is a straight strip of
   slope scrolling toward you, and everything on it is projected by dividing
   its offset by its distance. That is the whole 3D of it — one divide per
   object — and it is exactly how road racers were drawn before anyone had a
   GPU.

   Speed is not a constant. You accelerate down the slope and lose speed to
   drag, so tucking (holding down) is genuinely faster and genuinely harder
   to steer out of. Hitting a tree costs you speed rather than ending the
   run, because a downhill you can lose in the first four seconds is not a
   downhill anybody plays twice.
   ========================================================================== */

(function () {
  'use strict';

  var W = 480;
  var H = 400;
  var HORIZON = 120;
  var ROAD_W = 1.0;             // half-width in world units
  var DRAW_DIST = 60;           // how far ahead objects are drawn

  /* THE RUN HAS AN END. It was endless at first, which meant there was no
     way to win and no reason to stop — the score just crept up until you
     got bored, which is not a race. A fixed course turns it into one: the
     thing you are competing against is your own previous TIME. */
  var COURSE = 1200;            // metres to the finish

  GameShell.define({
    id: 'game-tux-racer',
    slug: 'tux-racer',
    title: 'Downhill',
    width: W,
    height: H,
    bestKey: 'tux-racer',
    /* The score handed to over() is a lap time in seconds, so LOWER is the
       better run. Without this the shell's default of 'higher is better'
       applied, and a slow scrape down the hill overwrote a clean fast one
       and lit up 'New best' for it. */
    bestOrder: 'low',
    startTitle: 'Downhill',
    startText: 'Left and right to steer, down to tuck. Fish are points; trees are not.',

    setup: function (g) {
      var z = 0;                // distance travelled
      var speed = 9;
      var x = 0;                // lateral position, -1..1 across the piste
      var lean = 0;
      var tuck = false;
      var fish = 0;
      var items = [];           // { z, x, kind }
      var nextItemZ = 20;
      var time = 0;
      var flash = 0;

      /* Deterministic-ish scenery, generated ahead and culled behind. */
      function spawnAhead() {
        while (nextItemZ < z + DRAW_DIST) {
          var r = Math.random();
          var kind = r < 0.34 ? 'fish' : r < 0.85 ? 'tree' : 'rock';
          items.push({
            z: nextItemZ,
            x: (Math.random() * 2 - 1) * 0.95,
            kind: kind
          });
          nextItemZ += 2.2 + Math.random() * 3.4;
        }
      }

      /* Project a world point to the screen. Everything perspective in this
         file is these four lines. */
      function project(worldX, dz) {
        var scale = 1 / Math.max(dz, 0.35);
        return {
          sx: W / 2 + worldX * scale * (W * 0.46),
          sy: HORIZON + scale * (H - HORIZON) * 0.92,
          s: scale
        };
      }

      function hit(kind) {
        if (kind === 'fish') {
          fish++;
          g.addScore(50);
          g.stat('fish', fish);
          g.beep(760, 0.05, 'sine');
          return;
        }
        /* A crash costs momentum, not the run. */
        speed = Math.max(5, speed * 0.5);
        flash = 0.25;
        g.sweep(280, 120, 0.22);
      }

      return {
        reset: function () {
          z = 0; speed = 9; x = 0; lean = 0; tuck = false;
          fish = 0; time = 0; flash = 0;
          items = [];
          nextItemZ = 20;
          g.stat('fish', 0);
          g.stat('speed', 0);
          g.stat('togo', COURSE);
          g.stat('time', '0.0');
          spawnAhead();
        },

        key: function (name) {
          if (name === 'down') tuck = true;
        },

        release: function (name) {
          if (name === 'down') tuck = false;
        },

        update: function (dt) {
          time += dt;
          tuck = !!g.held.down;

          /* Gravity down the slope, minus drag. Tucking cuts drag, so it is
             faster and the steering authority below is deliberately worse.

             These numbers were halved after the first version settled at
             about seventy units a second: with objects drawn sixty units
             ahead, that left under a second between a tree appearing and
             hitting it, which is not difficulty, it is a coin toss. Now it
             tops out around twenty-six, giving a bit over two seconds to
             see something and move. */
          var drag = tuck ? 0.005 : 0.011;
          speed += (12 - speed * speed * drag) * dt;
          speed = Math.max(4, Math.min(26, speed));

          var steer = tuck ? 0.85 : 1.65;
          if (g.held.left) lean -= steer * dt * 3.2;
          if (g.held.right) lean += steer * dt * 3.2;
          lean *= Math.pow(0.86, dt * 60);
          lean = Math.max(-1.6, Math.min(1.6, lean));

          x += lean * dt * 1.5;
          if (x < -1.02) { x = -1.02; lean = Math.abs(lean) * 0.3; speed *= 0.985; }
          if (x > 1.02) { x = 1.02; lean = -Math.abs(lean) * 0.3; speed *= 0.985; }

          z += speed * dt;
          spawnAhead();

          for (var i = items.length - 1; i >= 0; i--) {
            var dz = items[i].z - z;
            if (dz < -1) { items.splice(i, 1); continue; }
            if (dz < 0.6 && dz > -0.6 && Math.abs(items[i].x - x) < 0.16) {
              hit(items[i].kind);
              items.splice(i, 1);
            }
          }

          if (flash > 0) flash -= dt;
          g.stat('speed', Math.round(speed * 3.1));
          g.stat('time', time.toFixed(1));
          g.stat('togo', Math.max(0, Math.ceil(COURSE - z)));
          g.setScore(Math.floor(z) + fish * 50);

          if (z >= COURSE) {
            /* Score is the TIME, in tenths, and lower is better — so the
               best you have is a lap record rather than a high score. */
            g.over({
              won: true,
              score: Math.round(time * 10),
              title: time.toFixed(1) + ' seconds',
              message: 'Down the whole ' + COURSE + ' metres with ' + fish + ' fish. ' +
                       (fish >= 12 ? 'Greedy and quick, which is the hard combination.'
                        : fish >= 5 ? 'A decent haul on the way down.'
                        : 'Quick, but you left the fish behind.')
            });
          }
        },

        draw: function (ctx) {
          // Sky and snow
          var sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
          sky.addColorStop(0, '#0b1220');
          sky.addColorStop(1, '#1e3a5f');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, W, HORIZON);
          ctx.fillStyle = '#e8f1ff';
          ctx.fillRect(0, HORIZON, W, H - HORIZON);

          // Piste edges, drawn as a projected trapezium
          var near = project(-ROAD_W, 0.6), far = project(-ROAD_W, DRAW_DIST * 0.5);
          var nearR = project(ROAD_W, 0.6), farR = project(ROAD_W, DRAW_DIST * 0.5);
          ctx.fillStyle = '#f7fbff';
          ctx.beginPath();
          ctx.moveTo(near.sx, near.sy); ctx.lineTo(far.sx, far.sy);
          ctx.lineTo(farR.sx, farR.sy); ctx.lineTo(nearR.sx, nearR.sy);
          ctx.closePath(); ctx.fill();

          /* Moving stripes so speed is visible. Their phase comes from z, so
             they scroll at exactly the rate you are travelling. */
          for (var s = 0; s < 14; s++) {
            var stripeZ = ((s * 3) - (z % 3));
            if (stripeZ < 0.6) continue;
            var a = project(-ROAD_W, stripeZ), b = project(ROAD_W, stripeZ);
            ctx.strokeStyle = 'rgba(148,180,220,' + Math.max(0, 0.5 - stripeZ / 70) + ')';
            ctx.lineWidth = Math.max(1, 8 / stripeZ);
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
          }

          // Objects, far to near so nearer ones paint over
          var sorted = items.slice().sort(function (p, q) { return q.z - p.z; });
          for (var i = 0; i < sorted.length; i++) {
            var dz = sorted[i].z - z;
            if (dz < 0.35 || dz > DRAW_DIST) continue;
            var pr = project(sorted[i].x, dz);
            var size = pr.s * 62;
            if (sorted[i].kind === 'tree') {
              ctx.fillStyle = '#14532d';
              ctx.beginPath();
              ctx.moveTo(pr.sx, pr.sy - size * 1.5);
              ctx.lineTo(pr.sx - size * 0.45, pr.sy);
              ctx.lineTo(pr.sx + size * 0.45, pr.sy);
              ctx.closePath(); ctx.fill();
              ctx.fillStyle = '#78350f';
              ctx.fillRect(pr.sx - size * 0.07, pr.sy, size * 0.14, size * 0.22);
            } else if (sorted[i].kind === 'rock') {
              ctx.fillStyle = '#64748b';
              ctx.beginPath();
              ctx.ellipse(pr.sx, pr.sy - size * 0.2, size * 0.4, size * 0.28, 0, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillStyle = '#fb923c';
              ctx.beginPath();
              ctx.ellipse(pr.sx, pr.sy - size * 0.3, size * 0.3, size * 0.18, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.moveTo(pr.sx + size * 0.28, pr.sy - size * 0.3);
              ctx.lineTo(pr.sx + size * 0.5, pr.sy - size * 0.46);
              ctx.lineTo(pr.sx + size * 0.5, pr.sy - size * 0.14);
              ctx.closePath(); ctx.fill();
            }
          }

          /* The finish, drawn as a banner across the piste once it is
             within view — so the end arrives with warning rather than
             stopping the run out of nowhere. */
          var toFinish = COURSE - z;
          if (toFinish < DRAW_DIST && toFinish > 0.4) {
            var fl = project(-ROAD_W, toFinish), fr = project(ROAD_W, toFinish);
            var bh = Math.max(4, 34 / toFinish * 6);
            ctx.fillStyle = "#f87171";
            ctx.fillRect(fl.sx, fl.sy - bh, fr.sx - fl.sx, bh * 0.5);
            ctx.fillStyle = "#f8fafc";
            ctx.fillRect(fl.sx, fl.sy - bh * 0.5, fr.sx - fl.sx, bh * 0.5);
            if (toFinish < 26) {
              ctx.fillStyle = "#0f172a";
              ctx.font = "bold " + Math.max(9, Math.round(bh * 0.5)) + "px \"Segoe UI\", sans-serif";
              ctx.textAlign = "center";
              ctx.fillText("FINISH", (fl.sx + fr.sx) / 2, fl.sy - bh * 0.15);
            }
          }

          // Tux, fixed near the bottom, leaning with the turn
          var me = project(x, 0.95);
          ctx.save();
          ctx.translate(me.sx, me.sy - 26);
          ctx.rotate(lean * 0.22);
          ctx.fillStyle = '#0f172a';
          ctx.beginPath(); ctx.ellipse(0, 0, 17, 22, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath(); ctx.ellipse(0, 4, 11, 15, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath(); ctx.ellipse(0, -14, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath(); ctx.arc(-5, -18, 3, 0, Math.PI * 2); ctx.arc(5, -18, 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#0f172a';
          ctx.beginPath(); ctx.arc(-5, -18, 1.4, 0, Math.PI * 2); ctx.arc(5, -18, 1.4, 0, Math.PI * 2); ctx.fill();
          ctx.restore();

          if (tuck) {
            ctx.fillStyle = 'rgba(125,211,252,0.5)';
            ctx.font = '11px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('TUCK', me.sx, me.sy + 6);
          }

          if (flash > 0) {
            ctx.fillStyle = 'rgba(248,113,113,' + (flash * 1.6) + ')';
            ctx.fillRect(0, 0, W, H);
          }

          ctx.fillStyle = 'rgba(15,23,42,0.7)';
          ctx.fillRect(0, 0, W, 26);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '13px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(Math.round(speed * 3.1) + ' km/h', 10, 17);
          ctx.textAlign = 'right';
          ctx.fillText(Math.max(0, Math.ceil(COURSE - z)) + ' m to go   fish ' + fish, W - 10, 17);
        }
      };
    }
  });
})();

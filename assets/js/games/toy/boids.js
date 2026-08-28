/* ==========================================================================
   boids.js — Craig Reynolds's flocking, 1986.
   --------------------------------------------------------------------------
   Three rules per bird, each looking only at its nearby neighbours:
     separation  steer away from anyone too close
     alignment   match the average heading of the neighbourhood
     cohesion    steer toward the average position of the neighbourhood
   Nothing knows about the flock. There is no leader, no plan, and no global
   state at all — the shapes that appear are the whole point, and the sliders
   let you break them one rule at a time.

   Neighbours are found through a spatial hash rather than by comparing every
   pair. At 400 birds the naive version is 160,000 distance checks a frame;
   bucketing by cell makes it roughly linear and is the difference between
   this running at sixty frames and at nine.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 420;
  var VIEW = 42;              // neighbourhood radius
  var SEP = 16;               // personal space
  var MAXV = 130;
  var MINV = 55;

  GameShell.define({
    id: 'game-boids',
    slug: 'boids',
    title: 'Boids',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var birds = [];
      var wSep = 1.5, wAli = 1.0, wCoh = 0.9;
      var count = 220;
      var trails = false;
      var predator = null;

      var sepIn = document.getElementById('game-sep');
      var aliIn = document.getElementById('game-ali');
      var cohIn = document.getElementById('game-coh');
      var countSel = document.getElementById('game-count');
      var trailBtn = document.getElementById('game-trails');

      if (sepIn) sepIn.addEventListener('input', function () { wSep = Number(sepIn.value) / 100; });
      if (aliIn) aliIn.addEventListener('input', function () { wAli = Number(aliIn.value) / 100; });
      if (cohIn) cohIn.addEventListener('input', function () { wCoh = Number(cohIn.value) / 100; });
      if (countSel) countSel.addEventListener('change', function () {
        applyCount();
      });
      if (trailBtn) trailBtn.addEventListener('click', function () {
        trails = !trails;
        trailBtn.setAttribute('aria-pressed', String(trails));
      });

      function seed() {
        birds = [];
        for (var i = 0; i < count; i++) {
          var a = Math.random() * Math.PI * 2;
          birds.push({
            x: Math.random() * W, y: Math.random() * H,
            vx: Math.cos(a) * 90, vy: Math.sin(a) * 90
          });
        }
      }

      /* Adopting a flock size is one act, not two: the simulation takes the new
         number and the HUD states it. The dropdown's handler used to do only the
         first, so the Birds cell kept whatever the last reset() had written and
         the page claimed 220 while 450 birds were plainly on screen. Both the
         dropdown and reset() come through here, which leaves nowhere to change
         the size that does not also report it.

         It states count rather than countSel.value because the value passes
         through the || 220 fallback on its way in, and announcing the raw
         selection would report a size the simulation never adopted. Reading
         birds.length from draw() would be just as true and a good deal worse: a
         DOM write every frame for a number that changes three times a session. */
      function applyCount() {
        if (countSel) count = Number(countSel.value) || 220;
        seed();
        g.stat('birds', count);
      }

      /* A grid of buckets, rebuilt each frame. Cell size is the view radius,
         so a bird only has to look at its own cell and the eight around it. */
      var CELLW = Math.ceil(W / VIEW);
      var CELLH = Math.ceil(H / VIEW);

      function build() {
        var buckets = [];
        for (var i = 0; i < CELLW * CELLH; i++) buckets.push(null);
        for (var b = 0; b < birds.length; b++) {
          var cx = Math.min(CELLW - 1, Math.max(0, Math.floor(birds[b].x / VIEW)));
          var cy = Math.min(CELLH - 1, Math.max(0, Math.floor(birds[b].y / VIEW)));
          var k = cy * CELLW + cx;
          if (!buckets[k]) buckets[k] = [];
          buckets[k].push(birds[b]);
        }
        return buckets;
      }

      if (g.canvas) {
        /* The cursor is a hawk. Nothing models fear explicitly — the birds
           simply have a very strong separation from one extra point. */
        g.canvas.addEventListener('pointermove', function (event) {
          predator = g.pointAt(event);
        });
        g.canvas.addEventListener('pointerleave', function () { predator = null; });
      }

      return {
        reset: function () {
          applyCount();
        },

        key: function (name) {
          if (name === 'action') seed();
        },

        update: function (dt) {
          var buckets = build();

          for (var i = 0; i < birds.length; i++) {
            var b = birds[i];
            var sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;

            var gx = Math.min(CELLW - 1, Math.max(0, Math.floor(b.x / VIEW)));
            var gy = Math.min(CELLH - 1, Math.max(0, Math.floor(b.y / VIEW)));

            for (var oy = -1; oy <= 1; oy++) {
              for (var ox = -1; ox <= 1; ox++) {
                var nx = gx + ox, ny = gy + oy;
                if (nx < 0 || nx >= CELLW || ny < 0 || ny >= CELLH) continue;
                var list = buckets[ny * CELLW + nx];
                if (!list) continue;
                for (var j = 0; j < list.length; j++) {
                  var o = list[j];
                  if (o === b) continue;
                  var dx = o.x - b.x, dy = o.y - b.y;
                  var d2 = dx * dx + dy * dy;
                  if (d2 > VIEW * VIEW) continue;
                  n++;
                  ax += o.vx; ay += o.vy;
                  cx += o.x; cy += o.y;
                  if (d2 < SEP * SEP && d2 > 0.01) {
                    /* Scaled by 1/d so a very close neighbour pushes much
                       harder than one at the edge of personal space. */
                    var d = Math.sqrt(d2);
                    sx -= dx / d; sy -= dy / d;
                  }
                }
              }
            }

            if (n) {
              ax = ax / n - b.vx;  ay = ay / n - b.vy;
              cx = cx / n - b.x;   cy = cy / n - b.y;
            }

            b.vx += (sx * 30 * wSep) * dt + (ax * 1.4 * wAli) * dt + (cx * 0.9 * wCoh) * dt;
            b.vy += (sy * 30 * wSep) * dt + (ay * 1.4 * wAli) * dt + (cy * 0.9 * wCoh) * dt;

            if (predator) {
              var px = b.x - predator.x, py = b.y - predator.y;
              var pd = Math.sqrt(px * px + py * py);
              if (pd < 90 && pd > 0.01) {
                b.vx += (px / pd) * 420 * dt;
                b.vy += (py / pd) * 420 * dt;
              }
            }

            var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (sp > MAXV) { b.vx = b.vx / sp * MAXV; b.vy = b.vy / sp * MAXV; }
            if (sp < MINV && sp > 0.01) { b.vx = b.vx / sp * MINV; b.vy = b.vy / sp * MINV; }

            b.x += b.vx * dt;
            b.y += b.vy * dt;

            /* Wrap. A bounded box makes the flock pile into corners. */
            if (b.x < 0) b.x += W; else if (b.x >= W) b.x -= W;
            if (b.y < 0) b.y += H; else if (b.y >= H) b.y -= H;
          }
        },

        draw: function (ctx) {
          if (trails) {
            ctx.fillStyle = 'rgba(2, 6, 23, 0.14)';
            ctx.fillRect(0, 0, W, H);
          } else {
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 0, W, H);
          }

          for (var i = 0; i < birds.length; i++) {
            var b = birds[i];
            var a = Math.atan2(b.vy, b.vx);
            /* Hue follows heading, so the flock's structure is visible as
               colour as well as position — a rotating flock reads instantly. */
            var hue = Math.round(((a + Math.PI) / (Math.PI * 2)) * 300 + 160) % 360;
            ctx.fillStyle = 'hsl(' + hue + ', 80%, 68%)';
            ctx.beginPath();
            ctx.moveTo(b.x + Math.cos(a) * 5, b.y + Math.sin(a) * 5);
            ctx.lineTo(b.x + Math.cos(a + 2.5) * 4, b.y + Math.sin(a + 2.5) * 4);
            ctx.lineTo(b.x + Math.cos(a - 2.5) * 4, b.y + Math.sin(a - 2.5) * 4);
            ctx.closePath();
            ctx.fill();
          }

          if (predator) {
            ctx.strokeStyle = 'rgba(248,113,113,0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(predator.x, predator.y, 90, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      };
    }
  });
})();

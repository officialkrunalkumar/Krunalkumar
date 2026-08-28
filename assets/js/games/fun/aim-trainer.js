/* ==========================================================================
   aim-trainer.js — thirty targets, and the number that matters.
   --------------------------------------------------------------------------
   Speed alone is a bad measure: you can halve your time by spraying at the
   middle and getting lucky. So this records misses, and the headline figure
   is time per target with a penalty for each one — which is the number that
   actually improves with practice.

   Targets never spawn under the cursor. A target that appears where your
   hand already is takes zero milliseconds and quietly inflates the score, so
   each new one is placed at least a set distance from the last click.
   ========================================================================== */

(function () {
  'use strict';

  var W = 560;
  var H = 400;
  var TARGETS = 30;
  var MIN_JUMP = 110;         // targets must appear this far from your cursor

  GameShell.define({
    id: 'game-aim-trainer',
    slug: 'aim-trainer',
    /* Declared here and not only in the manifest, because the manifest is
       build-time data: the generator never hands it to the runtime, so a
       tapAction set only there is a comment. The page copy for this game
       promises a tap does nothing; without this line it did something. */
    tapAction: false,
    title: 'Aim trainer',
    width: W,
    height: H,
    bestKey: 'aim-trainer',
    bestOrder: 'low',
    formatBest: function (n) { return n + ' ms'; },
    startTitle: 'Aim trainer',
    startText: 'Thirty targets as fast as you can. Misses count against you.',

    setup: function (g) {
      var target = { x: W / 2, y: H / 2, r: 26 };
      var hits = 0;
      var misses = 0;
      var elapsed = 0;
      var cursor = { x: W / 2, y: H / 2 };
      var pulse = 0;
      var size = 26;

      var sizeSel = document.getElementById('game-size');
      if (sizeSel) {
        size = Number(g.load('size', '26')) || 26;
        sizeSel.value = String(size);
        sizeSel.addEventListener('change', function () {
          size = Number(sizeSel.value) || 26; g.save('size', size); g.start();
        });
      }

      function place() {
        var guard = 0;
        while (guard < 200) {
          guard++;
          var x = size + 8 + Math.random() * (W - (size + 8) * 2);
          var y = size + 8 + Math.random() * (H - (size + 8) * 2);
          var dx = x - cursor.x, dy = y - cursor.y;
          /* Never spawn under the hand — a zero-distance target is free
             time and it makes the average meaningless. */
          if (Math.sqrt(dx * dx + dy * dy) < MIN_JUMP) continue;
          target.x = x; target.y = y; target.r = size;
          return;
        }
        target.x = W / 2; target.y = H / 2; target.r = size;
      }

      function finish() {
        var raw = Math.round((elapsed / Math.max(hits, 1)) * 1000);
        /* Each miss adds a notional 120 ms, so spraying is not a strategy. */
        var adjusted = raw + Math.round((misses * 120) / Math.max(hits, 1));
        var acc = Math.round((hits / Math.max(1, hits + misses)) * 100);
        g.over({
          won: true,
          score: adjusted,
          title: adjusted + ' ms per target',
          message: hits + ' hits, ' + misses + ' misses, ' + acc + '% accurate. ' +
                   'Raw speed was ' + raw + ' ms; the misses cost you ' + (adjusted - raw) + ' ms of it.'
        });
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointermove', function (event) {
          cursor = g.pointAt(event);
        });
        g.canvas.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing') return;
          var p = g.pointAt(event);
          cursor = p;
          var dx = p.x - target.x, dy = p.y - target.y;
          if (dx * dx + dy * dy <= target.r * target.r) {
            hits++;
            pulse = 0.18;
            g.stat('hits', hits + '/' + TARGETS);
            g.beep(700 + hits * 6, 0.035, 'sine');
            if (hits >= TARGETS) { finish(); return; }
            place();
          } else {
            misses++;
            g.stat('misses', misses);
            g.beep(170, 0.05, 'square', 0.03);
          }
        });
      }

      return {
        reset: function () {
          hits = 0; misses = 0; elapsed = 0; pulse = 0;
          cursor = { x: W / 2, y: H / 2 };
          g.stat('hits', '0/' + TARGETS);
          g.stat('misses', 0);
          g.stat('time', '0.0');
          place();
        },

        update: function (dt) {
          elapsed += dt;
          if (pulse > 0) pulse -= dt;
          g.stat('time', elapsed.toFixed(1));
        },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);

          ctx.strokeStyle = 'rgba(148,163,184,0.07)';
          ctx.lineWidth = 1;
          for (var x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
          for (var y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

          var r = target.r * (1 + Math.max(0, pulse) * 0.7);
          ctx.beginPath(); ctx.arc(target.x, target.y, r, 0, Math.PI * 2);
          ctx.fillStyle = '#f87171'; ctx.fill();
          ctx.beginPath(); ctx.arc(target.x, target.y, r * 0.62, 0, Math.PI * 2);
          ctx.fillStyle = '#f8fafc'; ctx.fill();
          ctx.beginPath(); ctx.arc(target.x, target.y, r * 0.28, 0, Math.PI * 2);
          ctx.fillStyle = '#f87171'; ctx.fill();

          ctx.fillStyle = 'rgba(226,232,240,0.75)';
          ctx.font = '13px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(hits + '/' + TARGETS + '   misses ' + misses + '   ' + elapsed.toFixed(1) + 's', 12, 12);
        }
      };
    }
  });
})();

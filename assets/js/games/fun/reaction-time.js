/* ==========================================================================
   reaction-time.js — five taps, and an honest average.
   --------------------------------------------------------------------------
   The wait before each green is randomised between 1.4 and 5 seconds, which
   matters: a fixed delay lets you learn the rhythm and you end up measuring
   your timing rather than your reaction.

   Timing comes from the game clock, not from Date.now(). The shell runs a
   fixed-step loop with a clamped accumulator, so a frame that ran long
   cannot silently be counted as human slowness — which is exactly the
   failure mode of every reaction tester that measures wall-clock across a
   garbage collection pause.

   Anticipation is caught and refused. Clicking before green does not score
   200 ms, it voids the attempt, because otherwise the way to win is to
   guess.
   ========================================================================== */

(function () {
  'use strict';

  var W = 520;
  var H = 340;
  var ROUNDS = 5;

  var STATE_WAIT = 0, STATE_READY = 1, STATE_GO = 2, STATE_EARLY = 3, STATE_DONE = 4;

  GameShell.define({
    id: 'game-reaction-time',
    slug: 'reaction-time',
    /* This game listens on the canvas itself, because it has to timestamp
       the press rather than merely be told one happened. The shell's stage
       tap therefore delivered every touch a SECOND time: one tap counted
       as two, which on a reaction test either scored a phantom early
       press or skipped straight past the round being measured. */
    tapAction: false,
    title: 'Reaction time',
    width: W,
    height: H,
    bestKey: 'reaction-time',
    bestOrder: 'low',            // faster is better
    startTitle: 'Reaction time',
    startText: 'Wait for green, then click or press space. Five goes, and the average is what counts.',
    formatBest: function (n) { return n + ' ms'; },

    setup: function (g) {
      var state = STATE_WAIT;
      var timer = 0;
      var elapsed = 0;
      var results = [];
      var round = 0;

      function armNext() {
        state = STATE_READY;
        /* 1.4 to 5 seconds. A fixed delay would be learnable, and then this
           measures rhythm rather than reaction. */
        timer = 1.4 + Math.random() * 3.6;
        elapsed = 0;
      }

      function tap() {
        if (g.state !== 'playing') return;

        if (state === STATE_READY) {
          state = STATE_EARLY;
          timer = 1.1;
          g.sweep(300, 120, 0.25);
          return;
        }

        if (state === STATE_GO) {
          var ms = Math.round(elapsed * 1000);
          results.push(ms);
          round++;
          g.stat('last', ms + ' ms');
          g.stat('round', round + '/' + ROUNDS);
          g.beep(760, 0.05, 'sine');
          if (round >= ROUNDS) { finish(); return; }
          armNext();
          return;
        }

        if (state === STATE_EARLY) { armNext(); }
      }

      function finish() {
        state = STATE_DONE;
        var sum = 0, best = Infinity;
        for (var i = 0; i < results.length; i++) { sum += results[i]; best = Math.min(best, results[i]); }
        var avg = Math.round(sum / results.length);
        g.stat('avg', avg + ' ms');

        var verdict = avg < 200 ? 'Faster than most people manage.'
                    : avg < 250 ? 'Around the middle of the range for an adult.'
                    : avg < 320 ? 'A little slower than average — screen and input lag are part of this too.'
                    : 'Well behind the pack. Worth trying again with a wired mouse.';

        g.over({
          won: true,
          score: avg,
          title: avg + ' ms average',
          message: verdict + ' Best single go ' + best + ' ms. ' +
                   'Your screen and input device account for perhaps 20–50 ms of that, so the real number is lower.'
        });
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          event.preventDefault();
          tap();
        });
      }

      return {
        reset: function () {
          results = [];
          round = 0;
          g.stat('round', '0/' + ROUNDS);
          g.stat('last', '—');
          g.stat('avg', '—');
          armNext();
        },

        key: function (name) { if (name === 'action') tap(); },

        update: function (dt) {
          if (state === STATE_READY) {
            timer -= dt;
            if (timer <= 0) { state = STATE_GO; elapsed = 0; g.beep(600, 0.04, 'sine', 0.03); }
            return;
          }
          if (state === STATE_GO) { elapsed += dt; return; }
          if (state === STATE_EARLY) {
            timer -= dt;
            if (timer <= 0) armNext();
          }
        },

        draw: function (ctx) {
          var bgc = state === STATE_GO ? '#16a34a'
                  : state === STATE_EARLY ? '#b91c1c'
                  : '#1e293b';
          ctx.fillStyle = bgc;
          ctx.fillRect(0, 0, W, H);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#f8fafc';

          if (state === STATE_READY) {
            ctx.font = 'bold 30px "Segoe UI", sans-serif';
            ctx.fillText('Wait for green', W / 2, H / 2 - 14);
            ctx.font = '15px "Segoe UI", sans-serif';
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText('Round ' + (round + 1) + ' of ' + ROUNDS, W / 2, H / 2 + 22);
          } else if (state === STATE_GO) {
            ctx.font = 'bold 46px "Segoe UI", sans-serif';
            ctx.fillText('NOW', W / 2, H / 2);
          } else if (state === STATE_EARLY) {
            ctx.font = 'bold 26px "Segoe UI", sans-serif';
            ctx.fillText('Too early', W / 2, H / 2 - 12);
            ctx.font = '15px "Segoe UI", sans-serif';
            ctx.fillStyle = '#fecaca';
            ctx.fillText('That attempt does not count — wait for the green', W / 2, H / 2 + 20);
          }

          /* The runs so far, as dots along the bottom. */
          for (var i = 0; i < ROUNDS; i++) {
            var x = W / 2 - (ROUNDS - 1) * 26 / 2 + i * 26;
            ctx.beginPath();
            ctx.arc(x, H - 40, 8, 0, Math.PI * 2);
            ctx.fillStyle = i < results.length ? '#7dd3fc' : 'rgba(148,163,184,0.3)';
            ctx.fill();
          }
          if (results.length) {
            ctx.fillStyle = 'rgba(226,232,240,0.85)';
            ctx.font = '13px "Cascadia Code", Consolas, monospace';
            ctx.fillText(results.join(' · ') + ' ms', W / 2, H - 14);
          }
        }
      };
    }
  });
})();

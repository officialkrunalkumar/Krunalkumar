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

   The sound is the one place in this file that looks at the flock as a whole,
   which is the exact thing the simulation refuses to do. It is allowed to
   because it only ever reads: the two figures it wants — the mean speed, and
   the mean number of neighbours a bird has — are already sitting in the
   update loop as local variables, so no second pass over the birds exists and
   nothing the audio decides can reach the birds. A flock is air moving, so
   the bed is a band of noise that brightens and swells with the mean speed,
   over a drone whose two oscillators are detuned by how tightly the birds are
   packed: a dense ball beats about once every four seconds, a flock spread
   over the whole canvas shimmers. Those targets are recomputed five times a
   second rather than sixty, because scheduling a ramp on an AudioParam costs
   far more than the arithmetic that decides what to ramp it to.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 420;
  var VIEW = 42;              // neighbourhood radius
  var SEP = 16;               // personal space
  var MAXV = 130;
  var MINV = 55;

  /* How many neighbours one bird would have if the whole flock were spread
     evenly over the canvas, expressed per bird in the flock: the area a bird
     can see as a fraction of the area there is. Dividing the measured figure
     by this and by the flock size gives a number that means "how clumped"
     regardless of how many birds are in the sky, so that going from 80 to 450
     changes the level of the sound without changing its character. */
  var EVEN = Math.PI * VIEW * VIEW / (W * H);

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

      /* What the bed is steered by. All four are filled in by the update
         loop as it goes and emptied when the bed is next told about them,
         so the sums cover whole bird-frames rather than one frame: dividing
         by sndBirds is what turns them back into means. */
      var sndAcc = 0;         // seconds since the last recompute
      var spSum = 0;          // speeds, summed over every bird of every frame
      var nSum = 0;           // neighbour counts, likewise
      var sndBirds = 0;       // how many bird-frames those two sums cover
      var fleeLast = 0;       // birds inside the hawk's radius last frame

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

      /* ---------------------------------------------------------------
         The air. A flock overhead is not a sequence of events, it is a
         sound that continues, so it is a bed. There is nothing in here a
         plink per bird could ever have been.

         Two layers, and both are needed. The WIND is what a few hundred
         pairs of wings actually move, and it carries all of the flock's
         dynamics: its band opens upward and gets louder as the birds fly
         faster. The DRONE under it is two oscillators a few cents apart,
         and the beat between them is the flock's shape — packed tight and
         the two pitches almost agree, scattered across the field and they
         are far enough apart to shimmer. Ship the wind alone and it is a
         desk fan; ship the drone alone and it is a synthesiser warming up.
         --------------------------------------------------------------- */
      var air = g.bed(function (a) {
        var ctx = a.ctx;

        var wind = ctx.createBufferSource();
        wind.buffer = a.noise();
        wind.loop = true;
        var band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 700;
        /* A broad band rather than a resonant one. Push Q much past 1 and
           the noise stops being air and starts being a whistle, which is a
           kettle rather than a sky. */
        band.Q.value = 0.8;
        var windGain = ctx.createGain();
        /* These numbers look loud beside the ceiling on a one-shot, and are
           not: a Q of 0.8 keeps about a twentieth of white noise's power, so
           a gain of 0.03 here arrives as an rms in the low thousandths. What
           the layer is worth is judged by ear against the drone under it,
           not by the figure written in the gain. */
        windGain.gain.value = 0.030;
        wind.connect(band);
        band.connect(windGain);
        windGain.connect(a.out);
        wind.start();

        /* A breath across the band's centre, one cycle every eleven seconds
           or so. Without it the wind sits wherever the mean speed last put
           it, and a held hiss stops being heard as anything at all inside
           about ten seconds. The depth is a fraction of the span the speed
           signal uses, so the two never fight over the same ear. */
        var gust = ctx.createOscillator();
        var gustDepth = ctx.createGain();
        gust.frequency.value = 0.09;
        gustDepth.gain.value = 90;
        gust.connect(gustDepth);
        gustDepth.connect(band.frequency);
        gust.start();

        /* Unfiltered oscillators keep all of their power, so this sits an
           order of magnitude below the wind's figure and still comes out as
           roughly half of it. It is fixed: the drone is the floor the flock
           moves over, and a floor that moves too is just more wind. */
        var droneGain = ctx.createGain();
        droneGain.gain.value = 0.005;
        droneGain.connect(a.out);

        /* Triangles rather than sines. At 96 Hz a pure sine is most of the
           way to inaudible on a laptop speaker, and the beating between the
           pair — the entire reason there are two of them — goes with it. A
           triangle keeps a couple of harmonics high enough to survive. */
        function voice(cents) {
          var osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = 96;
          osc.detune.value = cents;
          osc.connect(droneGain);
          osc.start();
          return osc;
        }
        voice(0);
        var upper = voice(20);

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Longer than the gap between two recomputes, deliberately, so
             consecutive ramps overlap. A ramp that finishes early leaves
             the parameter sitting still until the next one starts, and a
             flock speeding up then reads as five steps rather than a rise. */
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.3 : secs));
        }

        return {
          set: function (key, value) {
            if (key === 'speed') {
              /* Mean speed arrives in pixels a second, between the
                 simulation's own floor and ceiling. Both ends of the wind
                 follow it: faster air is brighter as well as louder, and
                 moving the gain alone gives a flock that comes closer
                 rather than one that flies harder. */
              var k = (value - MINV) / (MAXV - MINV);
              if (k < 0) k = 0; else if (k > 1) k = 1;
              ramp(band.frequency, 620 + k * 980);
              ramp(windGain.gain, 0.026 + k * 0.052);
              return;
            }
            if (key === 'clump') {
              /* How many times denser the neighbourhoods are than an even
                 scatter of the same flock would give. One is birds ignoring
                 each other; a flock that has found its shape runs from
                 about two to thirty. Read logarithmically, because that is
                 both how the ear hears a beat rate and where the ratio
                 actually spends its time.

                 Tight flock, four cents, a beat you have to wait several
                 seconds for. Scattered flock, forty-two cents, which at
                 96 Hz is a shade over two beats a second — a shimmer,
                 where a wider interval would only be roughness. The ramp
                 is slow because the shape of a flock changes slowly, and
                 a detune moved quickly is heard as a bent note. */
              var t = Math.log(value < 1 ? 1 : value) / Math.log(30);
              if (t > 1) t = 1;
              ramp(upper.detune, 42 - t * 38, 1.2);
            }
          }
        };
      });

      /* The startle. A flock has no discrete events of its own — nothing
         collides, nothing scores, nothing is ever caught — so the only
         moment worth striking a one-shot for is a lot of birds breaking at
         once. Noise through a lowpass opening from a rumble to a hiss over
         a quarter of a second is the shape of a burst leaving the ground;
         run the same filter downward instead and it reads as something
         landing.

         Gated, because a hawk crossing a dense band satisfies the
         condition on several consecutive frames, and three whooshes inside
         a tenth of a second is one smeared noise rather than three
         startles. */
      function startle() {
        if (!g.gate('startle', 0.4)) return;
        g.noise(0.25, { type: 'lowpass', freq: 240, to: 2000, q: 0.7, level: 0.05 });
      }

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
        /* More birds, more air — but only a little, and on a log curve.
           Four hundred and fifty is not five and a half times the sound of
           eighty, any more than it is in a real sky, and all three settings
           have to land somewhere between inaudible and startling. This is
           the bed's level in the mix rather than anything inside it,
           because a bigger flock is the same sound with more of it. */
        var k = Math.log(count / 80) / Math.log(450 / 80);
        if (k < 0) k = 0; else if (k > 1) k = 1;
        air.gain(0.72 + k * 0.28);
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
          /* Throwing the flock back into random positions is a scatter like
             any other, and it is the only one a visitor can ask for
             directly, so it gets the same whoosh the hawk earns. */
          if (name === 'action') { seed(); startle(); }
        },

        update: function (dt) {
          var buckets = build();
          var fleeing = 0;

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

            /* Free: the scan above has just counted this bird's neighbours
               for the steering, and averaged over the flock that count is
               the only measure of spread this file can afford. Position
               variance would be the obvious one and is wrong here, because
               the world wraps and a tight ball sitting on the seam would
               read as the most scattered flock possible. */
            nSum += n;

            b.vx += (sx * 30 * wSep) * dt + (ax * 1.4 * wAli) * dt + (cx * 0.9 * wCoh) * dt;
            b.vy += (sy * 30 * wSep) * dt + (ay * 1.4 * wAli) * dt + (cy * 0.9 * wCoh) * dt;

            if (predator) {
              var px = b.x - predator.x, py = b.y - predator.y;
              var pd = Math.sqrt(px * px + py * py);
              if (pd < 90 && pd > 0.01) {
                b.vx += (px / pd) * 420 * dt;
                b.vy += (py / pd) * 420 * dt;
                fleeing++;
              }
            }

            var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (sp > MAXV) { b.vx = b.vx / sp * MAXV; b.vy = b.vy / sp * MAXV; }
            if (sp < MINV && sp > 0.01) { b.vx = b.vx / sp * MINV; b.vy = b.vy / sp * MINV; }

            /* The speed the bird actually leaves the frame at: sp put
               through the same two clamps the velocity has just been
               through. Measuring the vector again afterwards would agree
               to the last bit and cost a second square root per bird. */
            spSum += sp > MAXV ? MAXV : (sp < MINV && sp > 0.01 ? MINV : sp);

            b.x += b.vx * dt;
            b.y += b.vy * dt;

            /* Wrap. A bounded box makes the flock pile into corners. */
            if (b.x < 0) b.x += W; else if (b.x >= W) b.x -= W;
            if (b.y < 0) b.y += H; else if (b.y >= H) b.y -= H;
          }

          /* A burst is a lot of birds breaking in the same frame, which is
             the hawk arriving or swinging into a band rather than drifting
             around in open sky. Six per cent of the flock inside one frame
             is above anything a slow pointer produces and below the first
             frame of a real sweep; it is a fraction of the flock so that it
             means the same thing at 80 birds as at 450. Counting them was
             free — the loop above already tests every bird against the
             hawk — and startle() does the thinning. */
          if (fleeing - fleeLast > birds.length * 0.06) startle();
          fleeLast = fleeing;

          /* Steering the bed, five times a second rather than sixty. Every
             set() below ends in a cancelScheduledValues and a ramp on an
             AudioParam, and scheduling those at frame rate costs more than
             the whole flocking loop that feeds them while sounding
             identical, because nothing in this bed moves fast enough for
             the difference to be heard.

             The clump figure is neighbours per bird against what an even
             scatter of this many birds over this canvas would give. The
             bucket grid does not wrap, so birds near an edge under-report a
             little, but every reading is biased the same way and the bed
             only ever asks how the number compares with itself. */
          sndAcc += dt;
          sndBirds += birds.length;
          if (sndAcc >= 0.2 && sndBirds > 0) {
            air.set('speed', spSum / sndBirds);
            air.set('clump', (nSum / sndBirds) / (EVEN * birds.length));
            sndAcc = 0; spSum = 0; nSum = 0; sndBirds = 0;
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

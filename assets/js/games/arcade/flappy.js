/* ==========================================================================
   flappy.js — one button, gravity, and a gap.
   --------------------------------------------------------------------------
   Three decisions here are worth writing down. The first two are the
   difference between a game that is hard and a game that is unfair; the
   third is what the falling sounds like.

   1. THE FOUR NUMBERS ARE ONE NUMBER. Gravity, the flap impulse, the scroll
      speed and the pipe spacing cannot be tuned separately — pick any three
      and the fourth is decided for you.

      A flap sets the vertical speed to a fixed -380 rather than adding to it,
      so every flap draws the same arc: it rises 380²/(2*1200) = 60 units and
      takes 380/1200 = 0.32 s to reach the top of it. Flap again exactly when
      that arc returns to where it started — 2*380/1200 = 0.63 s — and you
      hover in place. Flap faster and you climb; the fastest cadence worth
      using, one flap per apex, is about 190 units a second upward.

      Pipes arrive every 200 units at 140 units a second, so there are 1.43 s
      between one gap and the next, which buys roughly 270 units of climb and
      a great deal more of fall. That figure is the whole constraint: the
      vertical distance between one gap centre and the next must stay inside
      it, or the game is asking for a move nobody can make. So gap centres are
      drawn as a step from the previous one, clamped to 110 units — well under
      what the arc can actually reach, because a gap you can only just make
      with perfect timing is not fun, it is a coin toss.

      The gap starts at 168 units and loses 1.5 for every gap cleared, down to
      a floor of 132. That is deliberately slight: at ten gaps it has shrunk
      by nine per cent, which nobody notices as a change and everybody feels
      as a run getting harder.

   2. THE CEILING CLAMPS, THE FLOOR KILLS. Hitting the roof zeroes your climb
      and drops you; hitting the ground ends the run. The asymmetry is
      deliberate. A high gap needs a flap taken near the top of the screen,
      and a lethal ceiling turns the correct move into a death — you would be
      punished for playing it right. There is nothing above the roof to be
      punished for.

   3. THE WIND IS THE FALL. The flap and the score were already beeps, and a
      third beep would only have made a busier keypad. What was missing was
      the falling itself, and falling is a condition rather than an event, so
      it is a bed: one band of noise whose centre frequency and loudness both
      follow vy, and nothing else. Climb and it is very nearly silence; hold a
      long drop and it opens into a rush. The mapping is squared so an
      ordinary hop stays quiet and only a real plummet gets loud, and the band
      climbs as it swells so that it moves away from the 620 Hz flap tone
      rather than sitting on it — the one sound that must never be masked here
      is the one that says the button worked.

      Hitting something gets a thud of its own, struck at the collision rather
      than left to the shell's game-over sweep, so that the impact and the
      verdict are two sounds and not one.

   Collision is a plain circle-against-rectangle test with no sweeping, which
   is safe only because the shell steps at a fixed 120 Hz: the bird moves at
   most 3.9 units vertically and 1.2 horizontally per step, against pipes 52
   units thick. Breakout needs a swept test; this does not.
   ========================================================================== */

(function () {
  'use strict';

  var W = 420;
  var H = 560;

  var GROUND_H = 56;
  var GROUND_Y = H - GROUND_H;      // 504 — the top of the ground strip

  var BIRD_X = 128;                 // the bird never moves horizontally
  var R = 11;                       // collision radius

  var GRAV = 1200;                  // units per second per second
  var FLAP = 380;                   // the impulse, set not added
  var VMAX = 470;                   // terminal speed, so a long fall stays readable

  var SPEED = 140;                  // world scroll, units per second
  var PW = 52;                      // pipe width
  var SPACING = 200;                // horizontal distance between pipes

  var GAP0 = 168;                   // opening gap height
  var GAP_MIN = 132;                // and the floor it narrows to
  var GAP_STEP = 1.5;               // units removed per gap cleared
  var MARGIN = 42;                  // keep gaps off the roof and the ground
  var MAX_DELTA = 110;              // see decision 1

  var TILE = 24;                    // ground hatch pitch
  var SKY_W = 46;                   // parallax skyline pitch

  /* A fixed skyline rather than a random one: it repeats every eight bars, so
     the parallax reads as distance instead of as noise. */
  var SKYLINE = [34, 58, 22, 46, 70, 30, 52, 40];

  GameShell.define({
    id: 'game-flappy',
    slug: 'flappy',
    title: 'Flappy',
    width: W,
    height: H,
    bestKey: 'flappy',
    startTitle: 'Flappy',
    startText: 'One button. Space, the up arrow, or a tap anywhere on the playfield. ' +
      'Your best score stays on this device.',

    setup: function (g) {
      var y = 0;
      var vy = 0;
      var pipes = [];
      var launched = false;
      var lastCentre = null;
      var groundX = 0;
      var skyX = 0;
      var clock = 0;
      var wing = 0;                 // seconds since the last flap, for the wing

      /* ---------------------------------------------------------------
         The wind. See decision 3 in the header.

         One layer, steered by one number. A second band was tried and cut:
         this plays continuously underneath a game whose loudest and most
         important sound is a 0.05 sine, so every decibel spent thickening
         the bed is a decibel taken off the flap. What it has to do is
         narrow — say how fast the bird is going down — and one moving
         bandpass says that on its own.
         --------------------------------------------------------------- */
      var wind = g.bed(function (a) {
        var ctx = a.ctx;

        var src = ctx.createBufferSource();
        src.buffer = a.noise();
        src.loop = true;

        var filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = 520;
        /* Broad rather than resonant. Past about Q 2 this stops being air
           going past a bird and starts being a kettle, and a resonant peak
           sweeping up through 620 Hz would collide with the flap tone in
           the one way the whole design is trying to avoid. */
        filt.Q.value = 0.8;

        var gain = ctx.createGain();
        gain.gain.value = 0.010;

        src.connect(filt);
        filt.connect(gain);
        gain.connect(a.out);
        src.start();

        function ramp(param, value) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Deliberately longer than the gap between recomputes, so a
             parameter is always still travelling when its next target
             arrives. Ramp shorter than the update interval instead and the
             wind lands, waits, and jumps — audible as a stair even though
             every individual move was ramped. */
          param.linearRampToValueAtTime(value, now + 0.16);
        }

        return {
          set: function (key, value) {
            if (key !== 'fall') return;
            /* Downward speed only. Climbing is zero and stays zero: a bird
               on the way up is not pushing through anything, and mapping
               the full -380..470 range would put the wind at half strength
               at precisely the moment the flap tone needs the room. */
            var k = value / VMAX;
            if (k < 0) k = 0;
            if (k > 1) k = 1;
            /* Squared, because only the back half of a fall is worth
               hearing. On a straight line the wind is already a third of
               the way up by the time an ordinary hop has peaked, which
               makes every routine flap sound like a plummet and leaves
               nothing in reserve for an actual one. */
            k = k * k;
            ramp(gain.gain, 0.010 + k * 0.045);
            /* The band climbs as well as swells. Loudness alone reads as
               somebody turning a knob; moving the centre up with it is what
               makes it read as air moving faster, and it carries the noise
               up and away from the flap tone as it gets loud. */
            ramp(filt.frequency, 520 + k * 1480);
          }
        };
      });

      function currentGap() {
        var gap = GAP0 - g.score * GAP_STEP;
        return gap < GAP_MIN ? GAP_MIN : gap;
      }

      /* A pipe's gap is fixed at spawn rather than read at collision time, so
         narrowing never closes a gap the player has already committed to. */
      function spawn() {
        var gap = currentGap();
        var lo = gap / 2 + MARGIN;
        var hi = GROUND_Y - gap / 2 - MARGIN;
        var prev = lastCentre === null ? (lo + hi) / 2 : lastCentre;
        var min = Math.max(lo, prev - MAX_DELTA);
        var max = Math.min(hi, prev + MAX_DELTA);
        var centre = min + Math.random() * (max - min);
        lastCentre = centre;
        var x = pipes.length ? pipes[pipes.length - 1].x + SPACING : W + 90;
        pipes.push({ x: x, top: centre - gap / 2, gap: gap, passed: false });
      }

      function reset() {
        y = 220;
        vy = 0;
        pipes = [];
        lastCentre = null;
        launched = false;
        clock = 0;
        wing = 1;
        /* The bed survives the run that built it, so a new run has to be
           told the bird is no longer falling. Skip this and the first
           second of every run after a crash arrives at terminal-velocity
           roar. */
        wind.set('fall', 0);
        g.stat('gap', Math.round(GAP0));
        spawn();
      }

      function flap() {
        if (g.state !== 'playing') return;
        launched = true;
        vy = -FLAP;
        wing = 0;
        g.beep(620, 0.05, 'sine', 0.05);
        /* The tone is the flap; this is the air it shifts. A short band of
           noise falling from 1400 to 480 under the beep is the difference
           between a button being acknowledged and a wing being pulled down,
           and at 0.03 against the tone's 0.05 it colours the beep rather
           than competing with it.

           Gated, because 'up' is one of the four keys the shell lets
           auto-repeat through, so a held arrow can ask for thirty flaps a
           second. The tone is cheap enough to take that; a buffer source
           and a filter each time is not, and past about ten a second the
           ear has stopped hearing separate wingbeats anyway. The beep
           deliberately stays outside the gate — every flap must still be
           confirmed, even the ones too fast to hear the air on. */
        if (g.gate('wingbeat', 0.09)) {
          g.noise(0.06, { type: 'bandpass', freq: 1400, to: 480, q: 0.9, level: 0.03 });
        }
      }

      /* Closest point on the rectangle to the bird's centre. Cheaper and
         kinder than a box-against-box test: the corners of a pipe cap stop
         killing you from a pixel away. */
      function rectHit(rx, ry, rw, rh) {
        var cx = BIRD_X < rx ? rx : (BIRD_X > rx + rw ? rx + rw : BIRD_X);
        var cy = y < ry ? ry : (y > ry + rh ? ry + rh : y);
        var dx = BIRD_X - cx;
        var dy = y - cy;
        return dx * dx + dy * dy < R * R;
      }

      function hits(p) {
        if (BIRD_X + R < p.x || BIRD_X - R > p.x + PW) return false;
        /* The top pipe is extended 200 units above the roof so that clipping
           its inner corner while the body is off-screen still counts. */
        if (rectHit(p.x, -200, PW, p.top + 200)) return true;
        var below = p.top + p.gap;
        return rectHit(p.x, below, PW, GROUND_Y - below);
      }

      /* The impact, struck where the collision is detected instead of being
         left to the game-over sweep the shell fires a moment later. The two
         overlap on purpose and therefore have to stay separable: the sweep
         is a bright sawtooth starting at 320 Hz, so the thud goes underneath
         it and stops before it does.

         Two voices for one event, and both are load-bearing. The sine is the
         weight, low enough to be nowhere near the sweep; the lowpassed burst
         closing from 340 to 90 is the knock. On its own the sine is a
         doorbell and the noise vanishes under the sawtooth — together they
         are something hitting something. */
      function thud() {
        g.beep(96, 0.13, 'sine', 0.07);
        g.noise(0.13, { type: 'lowpass', freq: 340, to: 90, q: 0.7, level: 0.06 });
      }

      function die(what) {
        thud();
        g.over({
          score: g.score,
          title: g.score >= 20 ? 'A proper run' : (g.score >= 10 ? 'Past ten' : 'Down'),
          message: what + ' after ' + g.score + (g.score === 1 ? ' gap.' : ' gaps.')
        });
      }

      function update(dt) {
        clock += dt;
        wing += dt;
        if (!launched) return;      // the world waits for the first flap

        vy += GRAV * dt;
        if (vy > VMAX) vy = VMAX;
        y += vy * dt;

        /* Decision 2: the roof takes your climb, not your run. */
        if (y < R) { y = R; if (vy < 0) vy = 0; }

        /* Decision 3. Eight recomputes a second, not a hundred and twenty:
           the ramp inside the bed runs longer than the gap between them, so
           the wind is always still moving toward a target and the steps are
           inaudible. Placed after the roof clamp because that is where vy
           has settled for the step: the clamp can still rewrite it, and a
           bed steered from a number the simulation has not finished with is
           the kind of bug that only ever shows up against the ceiling. */
        if (g.gate('wind', 0.12)) wind.set('fall', vy);

        var move = SPEED * dt;
        groundX = (groundX + move) % TILE;
        skyX = (skyX + move * 0.25) % SKY_W;

        var i;
        for (i = 0; i < pipes.length; i++) pipes[i].x -= move;
        while (pipes.length && pipes[0].x + PW < -8) pipes.shift();

        var guard = 0;
        while (pipes.length && pipes[pipes.length - 1].x <= W - SPACING && guard < 8) {
          spawn();
          guard++;
        }

        /* Scored only once the pipe is fully behind the bird's leading edge,
           so a gap can never be banked on the frame it kills you. */
        for (i = 0; i < pipes.length; i++) {
          if (!pipes[i].passed && pipes[i].x + PW < BIRD_X - R) {
            pipes[i].passed = true;
            g.addScore(1);
            g.stat('gap', Math.round(currentGap()));
            g.beep(880, 0.05, 'square', 0.05);
          }
        }

        if (y + R >= GROUND_Y) { y = GROUND_Y - R; die('Into the ground'); return; }
        for (i = 0; i < pipes.length; i++) {
          if (hits(pipes[i])) { die('Into a pipe'); return; }
        }
      }

      /* -------------------------------------------------------------
         Drawing
         ------------------------------------------------------------- */
      function drawSky(ctx) {
        var grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        grad.addColorStop(0, '#020617');
        grad.addColorStop(1, '#0d2137');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, GROUND_Y);

        /* The skyline scrolls at a quarter speed, which is the only cue that
           the bird is moving forward rather than the pipes moving back. */
        ctx.fillStyle = 'rgba(30,64,88,0.55)';
        var start = -SKY_W - skyX;
        for (var i = 0; start + i * SKY_W < W + SKY_W; i++) {
          var h = SKYLINE[i % SKYLINE.length];
          ctx.fillRect(start + i * SKY_W, GROUND_Y - h, SKY_W - 6, h);
        }
      }

      function drawPipe(ctx, p) {
        var below = p.top + p.gap;
        var capX = p.x - 5;
        var capW = PW + 10;

        ctx.fillStyle = '#166534';
        ctx.fillRect(p.x, 0, PW, p.top);
        ctx.fillRect(p.x, below, PW, GROUND_Y - below);

        /* A lit left edge on every pipe body and cap. Flat green columns are
           very hard to judge a gap against on a phone. */
        ctx.fillStyle = 'rgba(134,239,172,0.35)';
        ctx.fillRect(p.x + 4, 0, 5, p.top);
        ctx.fillRect(p.x + 4, below, 5, GROUND_Y - below);

        ctx.fillStyle = '#22c55e';
        ctx.fillRect(capX, p.top - 18, capW, 18);
        ctx.fillRect(capX, below, capW, 18);
        ctx.fillStyle = 'rgba(6,20,12,0.35)';
        ctx.fillRect(capX, p.top - 4, capW, 4);
        ctx.fillRect(capX, below + 14, capW, 4);
      }

      function drawBird(ctx) {
        var by = launched ? y : y + Math.sin(clock * 4) * 6;
        /* Nose down when falling, up when climbing. Tied to speed rather than
           to a timer so the tilt always tells you which way you are going. */
        var tilt = vy / 560;
        if (!launched) tilt = 0;
        if (tilt < -0.5) tilt = -0.5;
        if (tilt > 1.1) tilt = 1.1;

        ctx.save();
        ctx.translate(BIRD_X, by);
        ctx.rotate(tilt);

        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.moveTo(11, -2);
        ctx.lineTo(20, 1);
        ctx.lineTo(11, 4);
        ctx.closePath();
        ctx.fill();

        /* The wing is up for the first tenth of a second after a flap, which
           is just long enough to see and short enough not to lie. */
        ctx.fillStyle = '#fde68a';
        var up = wing < 0.1;
        ctx.beginPath();
        ctx.ellipse(-2, up ? -6 : 4, 7, 4, up ? -0.5 : 0.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(6, -3, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      function drawGround(ctx) {
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(0, GROUND_Y, W, GROUND_H);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(0, GROUND_Y, W, 3);
        ctx.fillStyle = 'rgba(134,239,172,0.16)';
        for (var x = -TILE; x < W + TILE; x += TILE) {
          ctx.fillRect(x - groundX, GROUND_Y + 8, 12, 3);
        }
      }

      function draw(ctx) {
        drawSky(ctx);
        for (var i = 0; i < pipes.length; i++) drawPipe(ctx, pipes[i]);
        drawGround(ctx);
        drawBird(ctx);

        if (!launched && g.state === 'playing') {
          ctx.fillStyle = 'rgba(226,232,240,0.85)';
          ctx.font = '15px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Tap, or press Space, to flap', W / 2, GROUND_Y - 70);
          ctx.textAlign = 'left';
        }
      }

      return {
        reset: reset,

        key: function (name) {
          if (name === 'action' || name === 'up') flap();
        },

        update: update,
        draw: draw
      };
    }
  });
})();

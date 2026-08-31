/* ==========================================================================
   fireworks.js — a display, and the half second between seeing it and
   hearing it.
   --------------------------------------------------------------------------
   THE ONE THING THIS FILE IS ABOUT: THE REPORT ARRIVES AFTER THE FLASH.

   Light gets to you in nothing. Sound takes 343 metres a second. A shell
   that breaks 170 m up, seen from 120 m back, is 208 m away and the bang lands
   0.61 s after the flash you are still looking at — long enough that you
   have already seen the stars start to fall by the time you hear what made
   them. That gap is not a nice extra. It is the single detail that decides
   whether a page of moving dots reads as fireworks or as a screensaver,
   because it is the one thing every person watching has felt without ever
   being told about it.

   So the canvas is a real number of metres (M_PER_PX), the viewer stands a
   real distance back from the mortars (STANDOFF_M), and every sound this
   toy makes is scheduled at

       slant distance from the viewer  /  the speed of sound

   ahead of the moment it was made. No sound is ever struck at the instant
   of the thing that caused it. That includes the LAUNCH: the mortar is
   120 m away too, so its thump lags its own muzzle flash by 0.35 s. Leaving
   the launch alone and delaying only the break was the first version, and
   it was wrong in a way that is hard to name and easy to hear — one law,
   applied everywhere, or the ear starts noticing the exception.

   The delay is scheduled INTO THE AUDIO CONTEXT rather than queued in the
   simulation. The break knows its own distance at the moment it happens, so
   it books its report against ctx.currentTime plus the flight time and
   forgets about it: sample-accurate, immune to a dropped frame, and there
   is no pending-sound list anywhere in this file. (fountain.js queues its
   events instead, because it has to be able to CANCEL them when the ring is
   rebuilt. Nothing here can be cancelled — a shell that has broken has
   broken — so the simpler thing is also the correct one.)

   DISTANCE DOES MORE THAN DELAY. Air absorbs high frequencies far faster
   than low ones: around 0.005 dB/m at 1 kHz against roughly 0.09 dB/m at
   8 kHz in ordinary summer air. Over 200 m that is 1 dB of loss down low
   and about 18 dB up top, which is the whole reason a distant firework is a
   soft whump and a close one is a crack that hurts. So the report's top end
   is rolled off with exp(-d/130) while its level follows plain inverse
   distance, and a high break genuinely sounds duller than a low one without
   anything in the sound design saying so.

   ---- THE PHYSICS IS REAL AND THAT MAKES IT SLOW -------------------------
   A six-inch shell leaves the tube at about 72 m/s and takes five and a
   quarter seconds to reach 170 m. That is a long time to watch a dot climb,
   and the first version of this file used a brisker gravity to fix it. It
   could not be kept: with time compressed and distance not, the report
   arrived a quarter of the way through the burst instead of after it, and
   the one detail the toy exists for looked like audio latency. The rise
   stays slow. With more than one shell in the air it is never the thing you
   are looking at anyway, which is exactly why real displays overlap them.

   Same reasoning as fountain.js's flight-time cueing, and apexTime() here
   is that file's integral again: drag and gravity both fight the climb, so
   the vacuum answer v0/G is forty per cent long at these speeds — two and
   a third seconds on the tallest shell here — and cannot be used for
   anything that has to agree with a clock.

   ---- FLASHING -----------------------------------------------------------
   A burst lifts the whole frame for a moment, and a full-field luminance
   change repeated fast enough is a seizure risk — WCAG 2.3.1 puts the
   general threshold at three flashes in any one second. A finale can break
   six shells a second, so the lift is rate-capped at FLASH_HZ (two a
   second, two thirds of the threshold) and peaks at 0.10 alpha over a
   near-black sky, which is roughly a tenth of full luminance and therefore
   under the threshold's amplitude test as well. Under prefers-reduced-
   motion the lift is not reduced, it is not drawn at all, and the whole
   display runs at SLOW_K speed. The stars, the smoke and the sound are all
   still there; nothing is taken away except the flashing and the hurry.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 460;
  var TAU = Math.PI * 2;

  var GROUND_Y = 420;      // where the mortar rack stands
  var ROOF_Y = 392;        // roughly where the town's rooftops sit behind it

  /* THE SCALE, and the only place it is decided. 460 logical pixels of
     canvas is 253 m of sky, which puts 231 m above the ground line and a
     typical break at about 170 m — a six-inch shell over a small town.
     Every acoustic figure below is derived from this one number, so
     changing it changes the delays, the absorption and the loudness
     together, which is the only way they can stay consistent. */
  var M_PER_PX = 0.55;

  /* Dry air at 20 degrees C. It is 331 at freezing and 349 at thirty, and
     a display is a summer evening. */
  var C_AIR = 343;

  /* Where the viewer is: on the ground, level with the middle of the frame,
     this far back from the line of mortars. 120 m is the near edge of a
     spectator line rather than the middle of one — far enough that the
     break's report is plainly late, close enough that the launch thump
     still reads as belonging to the flash that caused it. Push it to 250 m,
     which is what a public display actually ropes off, and every sound in
     the toy detaches from its picture at once. */
  var STANDOFF_M = 120;

  /* Gravity in canvas units. Written as the real figure over the scale so
     that it cannot quietly stop being 9.81. */
  var G = 9.81 / M_PER_PX;

  /* Linear drag on a rising shell, per second. A shell is heavy for its
     size and barely notices the air; this is what turns the 9.2 s vacuum
     climb of a 72 m/s lift into the 5.3 s one a stopwatch measures. */
  var K_SHELL = 0.12;

  /* How high a break is allowed to be, above the mortar. The floor is not a
     safety rule, it is a framing one: below about 90 px the stars reach the
     rooftops before they have finished opening. The ceiling keeps the top
     of a large shell inside the frame, because a break you can only see the
     bottom half of is worse than a smaller one. */
  var MIN_RISE = 100;
  var MAX_RISE = 344;

  /* A mortar is a tube in the ground. It can be leaned, but not aimed: past
     about fifteen degrees the shell is going sideways rather than up, and
     real racks are angled a few degrees at most. tan(15 deg) is 0.27, so
     the horizontal component is capped at that fraction of the lift. Aim at
     the far corner of the sky and you get the closest thing the rack can
     actually throw, which is honest and is also what a display looks like. */
  var LEAN_MAX = 0.27;

  /* Ceiling on flashes per second — see the header. Two thirds of WCAG
     2.3.1's general threshold, enforced through g.gate() so it is measured
     against the wall clock rather than against the simulation, which is the
     clock a nervous system runs on. */
  var FLASH_HZ = 2;

  /* Ceiling on the lift's alpha, and it has to be a clamp rather than the
     natural peak of the expression that feeds it. The lift is scaled by the
     calibre, so at the top of the Size slider 0.10 * (0.6 + 1.4 * 0.5) came
     out at 0.13 — over a near-black sky that is a relative-luminance change
     of about 0.125, which crosses WCAG 2.3.1's 0.10 amplitude test. The rate
     cap above already keeps the display compliant on its own, and that is
     exactly why this is worth pinning: two independent margins, not one and
     a claim. A tenth of full luminance is the figure the header quotes and
     this is the line that makes it true at every calibre. */
  var FLASH_MAX = 0.10;

  /* Reduced motion runs the world at this fraction of speed. Not a pause
     and not a different display: the same shells, the same breaks and the
     same sounds, with time stretched. Every propagation delay is divided by
     it too, or the report would arrive early into a slowed picture. */
  var SLOW_K = 0.6;

  var FINALE_SECS = 14;

  /* Spark budget. The ceiling is where a break stops looking better —
     past about 2400 the stars are drawn inside each other and the extra
     ones are paying for nothing. The floor is where a peony stops being a
     sphere and becomes a scatter of dots, which is worse than a stutter, so
     a machine that cannot hold 420 is left to struggle honestly. */
  var MAX_SPARKS = 2400;
  var MIN_SPARKS = 420;

  /* Bands in a star's colour table. A star is burning metal salts: it
     starts near white, settles into its colour as the surface cools, and
     dies as a dull red ember. Twelve steps is enough that the change is a
     fade rather than a staircase at the two-second span a peony lives. */
  var BANDS = 12;
  var EMBER = [132, 34, 12];

  var PALETTES = {
    classic: [[255, 72, 78], [72, 148, 255], [124, 255, 150], [255, 222, 96], [255, 124, 224], [120, 240, 255]],
    gold: [[255, 198, 86], [255, 234, 158], [255, 152, 62], [255, 216, 118], [255, 178, 74]],
    ember: [[255, 100, 44], [255, 58, 58], [255, 152, 62], [220, 40, 70], [255, 126, 96]],
    cool: [[84, 172, 255], [124, 255, 240], [154, 124, 255], [92, 222, 255], [192, 164, 255]],
    chrome: [[238, 246, 255], [204, 222, 255], [255, 248, 224], [216, 232, 252]]
  };

  /* The six shells, and each one is a different set of four numbers rather
     than a different drawing routine. What separates a peony from a willow
     is not the shape it is drawn as — both are a sphere of stars — it is
     how hard the stars are slowed and how long they burn. Get the drag and
     the span right and the shape falls out of the integrator on its own. */
  var SHELLS = {
    peony: {
      label: 'Peony',
      /* A break with no trail and a clean edge. Stars stop where the drag
         puts them, which is v/k: 100 px/s against 0.95 is about 105 px, or
         58 m of radius. That is a six-inch shell. */
      n: 108, v: 100, k: 0.95, span: 1.85, size: 1.9, glitter: 0
    },
    chrysanthemum: {
      /* The same break, but every star sheds sparks the whole way out, so
         the sphere is drawn twice: once by the stars and once by what they
         leave behind. It is the trail that makes it a chrysanthemum. */
      label: 'Chrysanthemum', n: 96, v: 94, k: 0.78, span: 2.45, size: 1.9, glitter: 26
    },
    willow: {
      /* Low drag and a long burn, so gravity wins. Terminal velocity is
         G/k = 60 px/s, and over three and a half seconds of life that is
         two hundred pixels of droop — the fronds. Nothing here bends the
         stars downward; they simply stop being thrown outward before they
         stop falling. */
      label: 'Willow', n: 74, v: 66, k: 0.30, span: 3.6, size: 2.1, glitter: 12
    },
    crossette: {
      /* Ten fat comets that fly, burn a fuse, and split into four. The
         second break is the point of the shell, and it gets its own report
         from its own position — four small cracks a beat after the big
         one, each with its own distance. */
      label: 'Crossette', n: 11, v: 118, k: 0.55, span: 0.78, size: 2.8, glitter: 34
    },
    ring: {
      /* Stars on a circle rather than on a sphere, in a plane tilted at
         random. Projected flat it is an ellipse, which is exactly what a
         ring shell looks like from anywhere except directly on its axis. */
      label: 'Ring', n: 88, v: 104, k: 0.92, span: 1.9, size: 1.8, glitter: 0
    },
    multi: {
      /* Four sub-shells thrown out on fuses of their own. Each breaks
         where it happens to be, so the four reports arrive at four
         different times — partly because the fuses differ and partly
         because the sub-shells are at four different distances by then.
         The second reason is free and is the more interesting one. */
      label: 'Multi-break', n: 4, v: 88, k: 0.5, span: 0.85, size: 2.6, glitter: 20
    }
  };

  var TYPE_KEYS = ['peony', 'chrysanthemum', 'willow', 'crossette', 'ring', 'multi'];

  function perfNow() {
    return (window.performance && window.performance.now)
      ? window.performance.now() : +new Date();
  }

  /* Time from the tube to the top of the arc, with drag. Going up,
     dv/dt = -(G + k v), which integrates to v(t) = (v0 + G/k) e^(-kt) - G/k
     and is zero at ln(1 + k v0 / G) / k. Measured against it, the vacuum
     answer v0/G is 7.85 s where the real climb is 5.53 s on the tallest
     shell this rack throws: forty per cent long, or two and a third
     seconds. That is not a refinement, it is a different firework. */
  function apexTime(v0) {
    return Math.log(1 + K_SHELL * v0 / G) / K_SHELL;
  }

  function apexRise(v0) {
    var ta = apexTime(v0);
    return (v0 + G / K_SHELL) * (1 - Math.exp(-K_SHELL * ta)) / K_SHELL - G * ta / K_SHELL;
  }

  /* The inverse, by bisection. apexRise() is closed form and strictly
     increasing; going the other way is not, and eighteen halvings of a
     400 px/s bracket lands inside a thousandth of a pixel per second. A
     launch happens at most a couple of times a second, so the cost of not
     being clever here is invisible — and a Newton step would need the
     derivative of a function whose whole point is that it is awkward. */
  function liftFor(rise) {
    var lo = 20, hi = 420, mid, i;
    for (i = 0; i < 18; i++) {
      mid = (lo + hi) * 0.5;
      if (apexRise(mid) < rise) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  GameShell.define({
    id: 'game-fireworks',
    slug: 'fireworks',
    title: 'Fireworks',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    /* OFF, and it has to be: the shell's stage tap fires 'action', which
       carries no position, and this toy's whole tap gesture is "put one
       there". The canvas gets its own pointer handler below that knows
       where the finger landed; leaving the stage tap on as well would
       launch two shells per tap, one of them at random. */
    tapAction: false,

    setup: function (g) {
      /* Asked once, for the reason disco.js gives: a visitor who has told
         their operating system they do not want movement has told every
         page on it, and re-reading the query per frame would only let it
         change under a display that is already running. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      var slow = reduced ? SLOW_K : 1;

      var clock = 0;             // display seconds since the run began
      var wantType = 'random';
      var rate = 1.0;            // shells a second
      var sizeK = 1;             // calibre multiplier
      var pal = PALETTES.classic;
      var finaleUntil = -1;
      var launchAcc = 0;

      var shells = [];           // rising, one break each
      var comets = [];           // crossette pieces and multi-break sub-shells
      var stars = [];
      var puffs = [];
      var tubes = [];

      var flash = 0;             // full-field lift, decays on its own
      var flashCol = [255, 240, 210];
      var breeze = 0;            // px/s of air movement, drifts on its own
      var launched = 0;
      var shotSeq = 0;           // see the bed's `warm` guard
      var lastDelayMs = 0;
      var sndAcc = 0;

      /* Frame measurement, the same two-number method fountain.js uses and
         for the same reason: a frame INTERVAL cannot see spare capacity,
         because requestAnimationFrame fires on vsync whether the frame took
         two milliseconds or fifteen. Overload is read off the interval,
         where a dropped frame shows up honestly; headroom is read off the
         time drawing actually takes. */
      var budget = 1200;
      var workMs = 4;
      var gapMs = 16.7;
      var lastFrame = 0;
      var frames = 0;

      var typeSel = document.getElementById('game-type');
      var rateIn = document.getElementById('game-rate');
      var sizeIn = document.getElementById('game-size');
      var palSel = document.getElementById('game-palette');
      var finaleBtn = document.getElementById('game-finale');

      var tints = {};            // palette name -> [ [near tables], [far tables] ]
      var skyStars = [];
      var buildings = [];
      var smokeSprite = null;
      var skyGrad = null;

      /* ================================================================
         Sound.

         Two held layers and one transient key, all in a single bed.

         The held half is the night: a low band of air that never stops,
         and a brighter band whose level follows how many shells are
         actually climbing — the hiss of a lifted shell is a condition, not
         an event, and it belongs to the same instrument as the wind. Both
         are steered by numbers that change over seconds, which is why
         neither of them is delayed: a level that takes a second to move
         cannot carry a 0.6 s propagation delay that anyone could hear.

         The transient half is one key, 'shot', and it is one key on
         purpose. A bed remembers the last value written to each key and
         replays it when its nodes are finally built, so a visitor who
         unmutes mid-display gets one stale event fired against a frame
         that is long gone. disco.js solves that with a `warm` flag that
         drops the first payload unless it is genuinely the first of the
         run — which works only if there is a single key to drop, because
         two transient keys mean two replayed payloads and the flag has
         already been spent on the first. So the lift and the break are
         one key carrying a kind, rather than two keys carrying nothing.
         ================================================================ */
      var sky = g.bed(function (a) {
        var ctx = a.ctx;
        var noise = a.noise();

        function loopLayer(type, freq, q, level) {
          var src = ctx.createBufferSource();
          src.buffer = noise;
          src.loop = true;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.value = freq;
          filt.Q.value = q;
          var gain = ctx.createGain();
          gain.gain.value = level;
          src.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          src.start();
          return { filt: filt, gain: gain };
        }

        /* The night. Almost nothing — a field at dusk is not silent, it is
           quiet, and the difference between the two is what stops the gaps
           between shells sounding like the page has crashed. */
        var air = loopLayer('lowpass', 250, 0.7, 0.014);
        var rise = loopLayer('bandpass', 900, 1.2, 0);

        /* A breath across the air's cutoff, one cycle every twenty-odd
           seconds. Weather is slow; without it a held hiss stops being
           heard at all inside about ten seconds, which is the same failure
           boids.js's wind layer has and fixes the same way. */
        var breath = ctx.createOscillator();
        var breathDepth = ctx.createGain();
        breath.frequency.value = 0.045;
        breathDepth.gain.value = 70;
        breath.connect(breathDepth);
        breathDepth.connect(air.filt.frequency);
        breath.start();

        /* CRACKLE IS ONE NODE CHAIN, NOT FORTY.

           The first version fired a train of forty two-millisecond noise
           grains per shell, which is exactly what a crackle is and which
           in a finale asks for several hundred buffer sources a second.
           It sounded right and it stuttered on a phone.

           A crackle is a gain that jumps about at random, so it is one
           source through one gain whose value follows a CURVE of random
           spikes. Six curves are built here and picked from at random,
           which is more variation than an ear can tell apart across a
           display, and setValueCurveAtTime stretches whichever one to
           whatever length the shell wants — so a big multi-break crackles
           for longer without needing a curve of its own. Zero allocation
           after this, and four nodes instead of eighty. */
        var CURVES = [];
        (function () {
          var c, i, n = 200, arr, env;
          for (c = 0; c < 6; c++) {
            arr = new Float32Array(n);
            for (i = 0; i < n; i++) {
              env = Math.exp(-3.1 * i / n);
              arr[i] = (Math.random() < 0.17
                ? 0.35 + Math.random() * 0.65
                : Math.random() * 0.05) * env;
            }
            arr[n - 1] = 0;      // a curve that ends above zero clicks
            CURVES.push(arr);
          }
        })();

        /* A shaped burst of filtered noise, booked at an absolute time.
           The shell's own g.noise() cannot be used for any of this: it
           plays now, and every sound in this file plays later. */
        function grain(when, dur, type, f0, f1, q, level) {
          if (level < 0.0006) return;      // below anything a speaker will do
          var src = ctx.createBufferSource();
          src.buffer = noise;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.setValueAtTime(f0, when);
          if (f1) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), when + dur);
          filt.Q.value = q;
          var gain = ctx.createGain();
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(level, when + Math.min(0.010, dur * 0.2));
          gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
          src.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          /* A random read position in the shared buffer. Six shells a
             second all starting at sample zero is one sample retriggering,
             not six explosions. */
          var span = noise.duration - dur - 0.05;
          src.start(when, span > 0 ? Math.random() * span : 0, dur + 0.05);
          src.stop(when + dur + 0.06);
        }

        function crackle(when, dur, level, hp) {
          var src = ctx.createBufferSource();
          src.buffer = noise;
          var filt = ctx.createBiquadFilter();
          filt.type = 'highpass';
          filt.frequency.value = hp;
          var env = ctx.createGain();
          var amp = ctx.createGain();
          amp.gain.value = level;
          /* Set directly rather than with setValueAtTime(0, when). An
             automation event scheduled inside a value curve's own window is
             a NotSupportedError in every engine that implements the spec
             strictly, and one at exactly `when` is inside it. A plain
             assignment is not an automation event, so there is nothing for
             the curve to collide with. */
          env.gain.value = 0;
          env.gain.setValueCurveAtTime(CURVES[(Math.random() * CURVES.length) | 0], when, dur);
          src.connect(filt);
          filt.connect(env);
          env.connect(amp);
          amp.connect(a.out);
          var span = noise.duration - dur - 0.05;
          src.start(when, span > 0 ? Math.random() * span : 0, dur + 0.05);
          src.stop(when + dur + 0.06);
        }

        /* The mortar. Almost all of it is below 100 Hz — you feel a lift
           charge more than you hear it — plus twelve milliseconds of dirt
           on top, which is the part a laptop speaker can actually move air
           at. Same trick as disco's kick, and for the same reason: without
           it the thump is inaudible on half the machines that will load
           this page. */
        function lift(when, level) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(96, when);
          osc.frequency.exponentialRampToValueAtTime(44, when + 0.09);
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(level, when + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
          osc.connect(gain);
          gain.connect(a.out);
          osc.start(when);
          osc.stop(when + 0.28);
          grain(when, 0.05, 'lowpass', 900, 160, 0.8, level * 0.55);
        }

        /* The break. Four things arrive in this order and they are four
           things, not one sound with four settings on it:

             the CRACK   — the shock front, five milliseconds, all top end,
                           and the first casualty of distance
             the BODY    — the burst charge, a lowpassed roar whose length
                           goes with the calibre
             the THUMP   — the part below the speaker, kept because on a
                           phone it is a click and on anything with a woofer
                           it is the whole event
             the ECHO    — a duller copy 300 ms later, off the buildings
                           behind the viewer. It is not decoration: a
                           display over a town has a slap-back, and without
                           one every report sounds like it happened in a
                           field.

           `dist` is doing three separate jobs here, which is the reason it
           is passed in rather than folded into a level upstairs. It set the
           DELAY before this function was called; it sets the LEVEL by plain
           inverse distance; and it sets the TONE through `hi`, the air's
           absorption of the top end. Only the first of those is the thing
           this toy is famous for, but the other two are why a break at the
           top of the frame sounds different from one at the bottom rather
           than merely quieter. */
        function boom(when, o) {
          var d = o.dist < 50 ? 50 : o.dist;
          var near = STANDOFF_M / d;                  // inverse distance
          var hi = Math.exp(-d / 130);                // air eats the highs
          var lvl = 0.125 * near * (0.62 + o.size * 0.55);
          var body = 0.30 + o.size * 0.40;

          grain(when, 0.045, 'highpass', 1300 * hi + 380, 0, 0.7, lvl * 0.60 * hi);
          grain(when + 0.004, body, 'lowpass', 120 + 300 * hi, 70, 1.1, lvl);

          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(76, when);
          osc.frequency.exponentialRampToValueAtTime(33, when + 0.14);
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(lvl * 0.8, when + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);
          osc.connect(gain);
          gain.connect(a.out);
          osc.start(when);
          osc.stop(when + 0.3);

          if (o.echo) {
            grain(when + 0.30, body * 1.5, 'lowpass', 90 + 130 * hi, 60, 0.9, lvl * 0.20);
          }
          if (o.crackle) {
            /* Starts a beat after the report rather than with it: the
               stars have to get out of the fireball before anyone can
               hear them burning. */
            crackle(when + 0.12, 0.75 + o.size * 0.7, lvl * 0.42, 3200);
          }
          if (o.hiss) {
            /* A willow's fronds, which is a long soft rush rather than a
               crackle. One grain does it. */
            grain(when + 0.20, 2.1, 'bandpass', 2600, 1100, 0.8, lvl * 0.13);
          }
        }

        var warm = false;

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.25 : secs));
        }

        return {
          set: function (key, value) {
            if (key === 'shot') {
              /* A SUSPENDED CONTEXT HAS A FROZEN CLOCK. The shell fades
                 the bus on mute and suspends the context about a second
                 later, but update() keeps running because this toy sets
                 pauseOnBlur false — so every report from then on would be
                 booked at the same stopped currentTime, and unmuting would
                 fire an hour of display as one crack. */
              if (ctx.state !== 'running') return;
              /* The replay guard. See the block comment above the bed. */
              if (!warm) { warm = true; if (value.seq > 0) return; }
              var when = ctx.currentTime + (value.at > 0 ? value.at : 0);
              if (value.kind === 'lift') lift(when, value.level);
              else boom(when, value);
              return;
            }
            if (key === 'rise') {
              /* How many shells are climbing, and how fast the fastest of
                 them is going. Both matter: one shell is a hiss and six is
                 a chorus, and a shell slows as it climbs, so the band
                 closing over the layer is the sound of the whole rack
                 running out of speed together. */
              ramp(rise.gain.gain, value.n <= 0 ? 0 : Math.min(0.026, 0.008 + value.n * 0.004), 0.3);
              ramp(rise.filt.frequency, 620 + value.v * 3.4, 0.4);
              return;
            }
            if (key === 'wind') {
              ramp(air.gain.gain, 0.011 + Math.abs(value) * 0.0007, 0.8);
            }
          }
        };
      });

      /* ================================================================
         Colour.

         A table of strings per palette entry, built once. Two thousand
         stars a frame is two thousand string builds and two thousand CSS
         colour parses if the colour is computed; it is two thousand
         assignments of a string that already exists if it is not.

         A star begins near white because that is what burning metal does
         before its surface cools, settles into the salt's own colour, and
         dies as a dull red ember. The alpha is baked into the table as
         well, falling faster than linearly, so a star goes out rather than
         fading evenly to nothing.

         TWO TABLES PER COLOUR, not one. A break is a sphere and half of it
         is pointing away from you; the far half is dimmer and smaller,
         which is the entire reason a peony reads as a ball rather than as
         a disc. Doing that with globalAlpha would be a canvas state change
         per star. A second, dimmer table is free.
         ================================================================ */
      function tintTable(c, dim) {
        var out = [];
        for (var b = 0; b < BANDS; b++) {
          var t = b / (BANDS - 1);
          var r, gg, bb;
          if (t < 0.30) {
            /* White-hot into the star's own colour. */
            var u = t / 0.30;
            r = 255 + (c[0] - 255) * u;
            gg = 255 + (c[1] - 255) * u;
            bb = 255 + (c[2] - 255) * u;
          } else {
            var v = (t - 0.30) / 0.70;
            r = c[0] + (EMBER[0] - c[0]) * v;
            gg = c[1] + (EMBER[1] - c[1]) * v;
            bb = c[2] + (EMBER[2] - c[2]) * v;
          }
          var al = Math.pow(1 - t, 1.7) * dim;
          out.push('rgba(' + (r | 0) + ',' + (gg | 0) + ',' + (bb | 0) + ',' +
            al.toFixed(3) + ')');
        }
        return out;
      }

      function buildTints() {
        var name, list, i;
        for (name in PALETTES) {
          if (!Object.prototype.hasOwnProperty.call(PALETTES, name)) continue;
          list = PALETTES[name];
          var near = [], far = [];
          for (i = 0; i < list.length; i++) {
            near.push(tintTable(list[i], 0.95));
            far.push(tintTable(list[i], 0.52));
          }
          tints[name] = { near: near, far: far };
          /* Trails are the same colour a stop cooler and much dimmer: they
             are what the star has already dropped, not the star. */
        }
      }

      /* Read live off the control rather than cached, and there is no
         change listener anywhere for it. Nothing already in the air can
         change colour: a star holds the tint TABLE it was packed with,
         never a reference to the palette, so switching the rack mid-display
         leaves the shells that have already broken burning out in their old
         colours while the next ones come up in the new one. That is what
         changing a rack does, and here it costs nothing at all. */
      function palName() {
        if (palSel && PALETTES[palSel.value]) return palSel.value;
        return 'classic';
      }

      /* ================================================================
         The scene, laid out once.
         ================================================================ */
      function buildScene() {
        var i;
        skyStars = [];
        for (i = 0; i < 90; i++) {
          skyStars.push({
            x: Math.random() * W,
            y: Math.random() * (ROOF_Y - 40),
            a: 0.12 + Math.random() * 0.35,
            r: Math.random() < 0.85 ? 0.6 : 1.1
          });
        }

        buildings = [];
        var x = -20;
        while (x < W + 20) {
          var bw = 26 + Math.random() * 52;
          var bh = 12 + Math.random() * 44;
          buildings.push({ x: x, w: bw, y: ROOF_Y + (44 - bh), h: bh + 40, lit: [] });
          var b = buildings[buildings.length - 1];
          /* A few lit windows. Not many: it is late, and a skyline with
             every window on is an office block, not a town. */
          for (i = 0; i < 4; i++) {
            if (Math.random() > 0.42) continue;
            b.lit.push({
              x: b.x + 5 + Math.random() * (bw - 12),
              y: b.y + 5 + Math.random() * Math.max(4, b.h - 26)
            });
          }
          x += bw + 2;
        }

        tubes = [];
        for (i = 0; i < 9; i++) {
          tubes.push({ x: 74 + i * ((W - 148) / 8), flash: 0 });
        }
      }

      function nearestTube(x) {
        var best = tubes[0], bd = 1e9, i, d;
        for (i = 0; i < tubes.length; i++) {
          d = Math.abs(tubes[i].x - x);
          if (d < bd) { bd = d; best = tubes[i]; }
        }
        return best;
      }

      /* ================================================================
         Distance, and therefore delay.

         The viewer is on the ground at the middle of the frame, STANDOFF_M
         behind the mortar line. dx is across the frame, dy is height above
         the ground line, and the standoff is the third leg — the one that
         never changes and is therefore the one that makes the geometry a
         slant distance rather than a height.

         Divided by `slow`, because under reduced motion the whole world is
         in slow motion and a sound that takes 0.61 s to arrive in that
         world takes 1.02 s of wall clock to arrive in this one. Leaving it
         out was the first version and it put every report a third of the
         way through its own burst, which is precisely the fault the
         reduced-motion mode exists to avoid making worse.
         ================================================================ */
      function metresAway(x, y) {
        var dx = (x - W / 2) * M_PER_PX;
        var dy = (GROUND_Y - y) * M_PER_PX;
        return Math.sqrt(dx * dx + dy * dy + STANDOFF_M * STANDOFF_M);
      }

      function sendShot(payload) {
        payload.seq = shotSeq++;
        sky.set('shot', payload);
      }

      /* ================================================================
         Sparks. A free list, for fountain.js's reason: a finale creates
         and abandons a couple of thousand small objects a second, and on a
         phone that is a collection pause landing in the middle of a break.
         ================================================================ */
      var spare = [];

      function spark(x, y, vx, vy, k, span, size, tint, glit) {
        if (stars.length >= budget) return null;
        var p = spare.length ? spare.pop() : {};
        p.x = x; p.y = y; p.vx = vx; p.vy = vy;
        p.k = k; p.life = 0; p.span = span; p.size = size;
        p.tints = tint; p.glit = glit || 0;
        stars.push(p);
        return p;
      }

      function killStar(i) {
        spare.push(stars[i]);
        stars[i] = stars[stars.length - 1];
        stars.pop();
      }

      function addPuff(x, y, r, span, alpha) {
        if (puffs.length > 90) return;
        puffs.push({
          x: x, y: y, r: r, grow: 9 + Math.random() * 14,
          life: 0, span: span, a: alpha,
          /* Smoke rises for a moment and then stops, because it has cooled
             to the air's temperature by the time you notice it. A puff
             that keeps climbing walks out of the top of the frame and
             takes the lingering with it. */
          vy: -10 - Math.random() * 8, vx: (Math.random() - 0.5) * 6
        });
      }

      /* ================================================================
         Breaking a shell.
         ================================================================ */
      function pickType() {
        if (wantType !== 'random' && SHELLS[wantType]) return wantType;
        /* In a finale the mix leans on the shells that fill sky — a wall
           of peonies is what a finale actually is, and crossettes and
           multi-breaks in that density become mush. */
        if (clock < finaleUntil && Math.random() < 0.55) {
          return Math.random() < 0.5 ? 'peony' : 'chrysanthemum';
        }
        return TYPE_KEYS[(Math.random() * TYPE_KEYS.length) | 0];
      }

      /* A unit vector on the sphere, and one on a circle in a plane tilted
         at random. The z component is spent on size and brightness rather
         than on a perspective divide: a 60 m break seen from 200 m subtends
         about seventeen degrees, so the difference in apparent speed
         between the near face and the far one is a couple of per cent —
         invisible — while the difference in brightness is most of what
         tells you it is a ball. */
      function sphereDir(out) {
        var z = 1 - 2 * Math.random();
        var r = Math.sqrt(1 - z * z);
        var th = Math.random() * TAU;
        out[0] = r * Math.cos(th);
        out[1] = r * Math.sin(th);
        out[2] = z;
      }

      function tintsFor(depth, ci) {
        var t = tints[palName()];
        return (depth > 0 ? t.near : t.far)[ci % t.near.length];
      }

      /* One break. `k` is the shell definition, `scale` shrinks a
         sub-shell against its parent, and `ci` is the palette index so
         every star from one shell is the same colour — which is what a
         shell is: one chemistry, packed in a ball. */
      function burst(x, y, def, scale, ci, deep) {
        var i, dir = [0, 0, 0], sp, dep, tint, n;
        var v = def.v * scale * (0.85 + sizeK * 0.3);
        var span = def.span * (0.8 + scale * 0.3);
        var count = Math.round(def.n * scale * (0.55 + sizeK * 0.6));

        if (def === SHELLS.ring) {
          /* Two orthonormal vectors spanning a random plane, then stars
             every few degrees around it. The tilt is what stops every ring
             in the display being the same ring. */
          var au = Math.random() * TAU, av = Math.acos(1 - 2 * Math.random());
          var ux = Math.cos(au) * Math.cos(av), uy = Math.sin(av), uz = Math.sin(au) * Math.cos(av);
          var wx = -Math.sin(au), wy = 0, wz = Math.cos(au);
          for (i = 0; i < count; i++) {
            var th = (i / count) * TAU;
            var c = Math.cos(th), s = Math.sin(th);
            /* A few per cent of scatter on the speed, or the ring draws as
               a mathematically exact line and stops reading as fire. */
            sp = v * (0.94 + Math.random() * 0.12);
            dir[0] = ux * c + wx * s;
            dir[1] = uy * c + wy * s;
            dir[2] = uz * c + wz * s;
            dep = dir[2];
            tint = tintsFor(dep, ci);
            spark(x, y, dir[0] * sp, dir[1] * sp, def.k, span * (0.9 + Math.random() * 0.2),
              def.size * (0.8 + (dep + 1) * 0.25), tint, def.glitter);
          }
        } else if (def === SHELLS.crossette || def === SHELLS.multi) {
          /* Comets, not stars: these carry a fuse and a second act. */
          n = Math.max(3, Math.round(def.n * (def === SHELLS.multi ? 1 : scale)));
          for (i = 0; i < n; i++) {
            sphereDir(dir);
            sp = v * (0.9 + Math.random() * 0.2);
            comets.push({
              x: x, y: y, vx: dir[0] * sp, vy: dir[1] * sp, k: def.k,
              fuse: def.span * (0.8 + Math.random() * 0.45),
              cross: def === SHELLS.crossette,
              ci: ci, scale: scale, dep: dir[2], trail: 0
            });
          }
        } else {
          for (i = 0; i < count; i++) {
            sphereDir(dir);
            /* Speed scatter, and it is not decoration. A real break throws
               its stars at slightly different speeds because they leave
               different parts of the burst charge, and that spread is why
               the edge of a peony is soft rather than a drawn circle. */
            sp = v * (0.82 + Math.random() * 0.36);
            dep = dir[2];
            tint = tintsFor(dep, ci);
            spark(x, y, dir[0] * sp, dir[1] * sp, def.k,
              span * (0.85 + Math.random() * 0.3),
              def.size * (0.75 + (dep + 1) * 0.3), tint, def.glitter);
          }
        }

        /* The smoke the break leaves. It is the reason a finale goes murky
           — every shell adds to it and the breeze takes a good ten seconds
           to clear it, which is a real property of a display and not a
           cost to be optimised away. */
        var puffN = deep ? 1 : 2 + (Math.random() * 2 | 0);
        for (i = 0; i < puffN; i++) {
          addPuff(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 22,
            16 + Math.random() * 18, 7 + Math.random() * 5, 0.30 * scale);
        }

        /* The report, booked at its own arrival time. This is the whole
           file in four lines. */
        var dist = metresAway(x, y);
        var at = dist / C_AIR / slow;
        sendShot({
          kind: 'boom', at: at, dist: dist, size: scale * sizeK,
          /* Thinned, because a finale can break six shells a second and
             six overlapping crackles is a hiss rather than six shells.
             g.gate measures against the wall clock, which is the clock the
             ear is on. */
          crackle: def.glitter > 0 && g.gate('crackle', 0.26),
          hiss: def === SHELLS.willow,
          echo: g.gate('echo', 0.4)
        });

        if (!deep) {
          lastDelayMs = Math.round(dist / C_AIR * 1000);
          g.stat('delay', lastDelayMs + ' ms');
        }

        /* The flash, which happens NOW because light is free. Rate-capped
           and refused outright under reduced motion — see the header. */
        if (!reduced && g.gate('flash', 1 / FLASH_HZ)) {
          var c2 = PALETTES[palName()][ci % PALETTES[palName()].length];
          flashCol = c2;
          var f = FLASH_MAX * scale * (0.6 + sizeK * 0.5);
          if (f > FLASH_MAX) f = FLASH_MAX;
          if (f > flash) flash = f;
        }
      }

      /* ================================================================
         Launching.
         ================================================================ */
      function launch(tx, ty, typeName) {
        var def = SHELLS[typeName] || SHELLS.peony;
        var rise = GROUND_Y - ty;
        if (rise < MIN_RISE) rise = MIN_RISE;
        if (rise > MAX_RISE) rise = MAX_RISE;

        var tube = nearestTube(tx);
        var v0 = liftFor(rise);
        var ta = apexTime(v0);

        /* The horizontal component that would put the apex over tx, given
           that drag flattens the drift: x(t) = vx (1 - e^-kt) / k. Then
           leaned no further than a mortar can be leaned. */
        var vx = (tx - tube.x) * K_SHELL / (1 - Math.exp(-K_SHELL * ta));
        var lean = v0 * LEAN_MAX;
        if (vx > lean) vx = lean; else if (vx < -lean) vx = -lean;

        shells.push({
          x: tube.x, y: GROUND_Y - 6,
          vx: vx, vy: -v0,
          type: typeName,
          ci: (Math.random() * PALETTES[palName()].length) | 0,
          /* A time fuse is cut for the apex and is not perfect. A few
             px/s either side of zero vertical speed is a fuse a tenth of a
             second out, which is what the good ones manage — and the
             occasional low break is the display looking alive rather than
             printed. */
          fireAt: -6 + Math.random() * 14,
          trail: 0
        });
        launched++;
        g.stat('shells', launched);

        tube.flash = 1;
        addPuff(tube.x, GROUND_Y - 10, 10, 4.5, 0.26);

        /* The lift thump, delayed exactly like everything else. A mortar at
           the edge of the rack is a few metres further away than one in the
           middle and therefore a few milliseconds later, which nobody will
           ever hear — and that is the point: there is no threshold in this
           file below which the physics is skipped. */
        var dist = metresAway(tube.x, GROUND_Y);
        sendShot({
          kind: 'lift', at: dist / C_AIR / slow,
          level: 0.075 * (STANDOFF_M / dist) * (0.7 + sizeK * 0.4)
        });
      }

      function launchRandom() {
        launch(90 + Math.random() * (W - 180),
          GROUND_Y - (MIN_RISE + Math.random() * (MAX_RISE - MIN_RISE)) * (0.72 + sizeK * 0.3),
          pickType());
      }

      /* ================================================================
         Controls.
         ================================================================ */
      function readRate() {
        var v = rateIn ? Number(rateIn.value) : 45;
        if (isNaN(v)) v = 45;
        /* 0.15 to 2.1 shells a second. The floor is one shell every seven
           seconds, which is a village display; the ceiling is where the
           sky stops emptying between breaks and you may as well be in the
           finale. */
        rate = 0.15 + (v / 100) * 1.95;
      }

      function readSize() {
        var v = sizeIn ? Number(sizeIn.value) : 100;
        if (isNaN(v)) v = 100;
        sizeK = v / 100;
        if (sizeK < 0.6) sizeK = 0.6;
        if (sizeK > 1.4) sizeK = 1.4;
      }

      function syncFinale() {
        if (!finaleBtn) return;
        var on = clock < finaleUntil;
        finaleBtn.setAttribute('aria-pressed', String(on));
        finaleBtn.title = on
          ? 'Finale running — everything at once for a few more seconds'
          : 'Finale: empty the rack';
      }

      function startFinale() {
        if (clock < finaleUntil) return;
        finaleUntil = clock + FINALE_SECS;
        syncFinale();
        g.announce('Finale. Every mortar at once for about ' + FINALE_SECS + ' seconds.');
      }

      if (typeSel) {
        typeSel.addEventListener('change', function () {
          wantType = SHELLS[typeSel.value] ? typeSel.value : 'random';
        });
      }
      if (rateIn) rateIn.addEventListener('input', readRate);
      if (sizeIn) sizeIn.addEventListener('input', readSize);
      if (finaleBtn) finaleBtn.addEventListener('click', startFinale);

      /* F, bound here rather than through the key hook, because the shell's
         KEYMAP knows four arrows, Space, Enter and Escape and nothing else
         — hooks.key() is never called for a letter, so a page listing
         "F — finale" would be promising a control that does not exist.

         Scoped the way disco.js scopes its S: only while a run is live, and
         only when focus is inside this game or nowhere in particular, so
         typing an f into the site search cannot empty the rack behind the
         dialog. */
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'f' && event.key !== 'F') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (g.state !== 'playing') return;
        var focused = document.activeElement;
        if (focused && focused !== document.body && !g.el.contains(focused)) return;
        event.preventDefault();
        startFinale();
      });

      if (g.canvas) {
        /* Aim by pointer. pointerdown rather than click so it fires the
           moment the finger lands — a firework you have to wait for the
           mouse-up on feels broken — with a small rate limit so dragging
           across the sky paints a line of shells rather than a hundred.
           0.12 s is under the launch rate the finale reaches, so a
           deliberate drag is still a salvo. */
        var lastAim = 0;
        g.canvas.addEventListener('pointerdown', function (event) {
          var now = perfNow();
          if (now - lastAim < 120) return;
          lastAim = now;
          var p = g.pointAt(event);
          launch(p.x, p.y, pickType());
        });
      }

      /* ================================================================
         Update.
         ================================================================ */
      function stepShells(dt) {
        var i, s, sp, def;
        var flying = 0, fastest = 0;

        for (i = shells.length - 1; i >= 0; i--) {
          s = shells[i];
          s.vy += G * dt - s.vy * K_SHELL * dt;
          s.vx -= s.vx * K_SHELL * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          flying++;
          sp = -s.vy;
          if (sp > fastest) fastest = sp;

          /* The trail: a rope of sparks out of the lift charge, thickest
             at the start where the shell is fastest and thinning as it
             slows. Rate follows speed rather than being constant, which is
             the difference between a comet and a dotted line. */
          s.trail += dt * (6 + Math.abs(s.vy) * 0.16);
          while (s.trail >= 1) {
            s.trail -= 1;
            spark(s.x + (Math.random() - 0.5) * 3, s.y + 2,
              (Math.random() - 0.5) * 16 - s.vx * 0.1,
              (Math.random() - 0.5) * 16 - s.vy * 0.06,
              2.6, 0.32 + Math.random() * 0.4, 1.5,
              tints.gold ? tints.gold.near[1] : tintsFor(1, 0), 0);
          }

          if (s.vy >= s.fireAt) {
            def = SHELLS[s.type] || SHELLS.peony;
            burst(s.x, s.y, def, 1, s.ci, false);
            shells[i] = shells[shells.length - 1];
            shells.pop();
            continue;
          }
          if (s.y < -40 || s.x < -60 || s.x > W + 60) {
            shells[i] = shells[shells.length - 1];
            shells.pop();
          }
        }

        /* Steering the held layer, five times a second rather than 120.
           Every set() ends in a cancelScheduledValues and a ramp on an
           AudioParam, and scheduling those at step rate costs more than the
           whole simulation that feeds them while sounding identical. */
        sndAcc += dt;
        if (sndAcc >= 0.2) {
          sky.set('rise', { n: flying, v: fastest });
          sky.set('wind', breeze);
          g.stat('sparks', stars.length);
          sndAcc = 0;
        }
      }

      function stepComets(dt) {
        var i, c, j, def, sp, dir = [0, 0, 0], dist;
        for (i = comets.length - 1; i >= 0; i--) {
          c = comets[i];
          c.vy += G * dt - c.vy * c.k * dt;
          c.vx += (breeze - c.vx) * c.k * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.fuse -= dt;

          c.trail += dt * 34;
          while (c.trail >= 1) {
            c.trail -= 1;
            spark(c.x, c.y, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22,
              2.2, 0.4 + Math.random() * 0.35, 1.5, tintsFor(c.dep, c.ci), 0);
          }

          if (c.fuse > 0 && c.y < H + 40) continue;

          if (c.cross) {
            /* The split. Four stars at right angles IN THE PLANE OF
               TRAVEL, which is what makes a crossette read as a cross
               rather than as a small peony: the four pieces are related to
               each other and to the direction the comet was already
               going. */
            var ang = Math.atan2(c.vy, c.vx);
            for (j = 0; j < 4; j++) {
              var a2 = ang + j * (TAU / 4) + 0.2;
              sp = 52 * (0.85 + Math.random() * 0.3);
              spark(c.x, c.y, Math.cos(a2) * sp, Math.sin(a2) * sp, 0.9,
                0.85 + Math.random() * 0.3, 2.0, tintsFor(c.dep, c.ci), 18);
            }
            addPuff(c.x, c.y, 8, 4, 0.14);
            /* Its own little report, from its own position. Four of these
               land in a ragged handful a moment after the parent's, and
               the raggedness is not random — it is four different
               distances. */
            dist = metresAway(c.x, c.y);
            sendShot({
              kind: 'boom', at: dist / C_AIR / slow, dist: dist,
              size: 0.22 * sizeK, crackle: false, echo: false, hiss: false
            });
          } else {
            def = Math.random() < 0.5 ? SHELLS.peony : SHELLS.chrysanthemum;
            burst(c.x, c.y, def, 0.52 * c.scale, c.ci, true);
          }
          comets[i] = comets[comets.length - 1];
          comets.pop();
        }
      }

      function stepStars(dt) {
        var i, p, glitChance;
        for (i = stars.length - 1; i >= 0; i--) {
          p = stars[i];
          p.life += dt;
          if (p.life >= p.span) { killStar(i); continue; }

          /* Drag on the relative velocity, so the breeze carries the light
             embers and barely touches a fresh star. One law, and the fact
             that a willow's fronds lean downwind while a peony's edge does
             not falls straight out of the two drag figures. */
          p.vx += (breeze - p.vx) * p.k * dt;
          p.vy += G * dt - p.vy * p.k * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;

          if (p.glit) {
            glitChance = p.glit * dt;
            if (Math.random() < glitChance) {
              /* A shed spark, not a smaller copy of the star: almost no
                 speed of its own, high drag, and gone in a third of a
                 second. That is what a chrysanthemum's trail is — burning
                 material falling off, hanging still while the star that
                 dropped it keeps going. */
              spark(p.x, p.y, p.vx * 0.18 + (Math.random() - 0.5) * 10,
                p.vy * 0.18 + (Math.random() - 0.5) * 10,
                3.4, 0.28 + Math.random() * 0.32, 1.3, p.tints, 0);
            }
          }

          if (p.y > GROUND_Y + 10 || p.x < -50 || p.x > W + 50) killStar(i);
        }
      }

      function stepSmoke(dt) {
        for (var i = puffs.length - 1; i >= 0; i--) {
          var q = puffs[i];
          q.life += dt;
          if (q.life >= q.span) { puffs.splice(i, 1); continue; }
          /* The rise dies away; the drift does not. Smoke reaches air
             temperature in a second or two and after that it only goes
             where the air goes. */
          q.vy += (0 - q.vy) * 1.1 * dt;
          q.vx += (breeze * 0.85 - q.vx) * 0.7 * dt;
          q.x += q.vx * dt;
          q.y += q.vy * dt;
          q.r += q.grow * dt;
        }
      }

      /* Two numbers, for the reason in the note beside `budget` above.
         What gives is the spark count, never the step rate: the shell runs
         a fixed 1/120 s update either way, so a weak machine gets a
         thinner display at the same speed rather than the same display in
         slow motion — which would be the one change that breaks the report
         delay, since the delay is in real seconds and the picture would no
         longer be. */
      function adapt(work, gap) {
        if (gap > 0 && gap < 100) gapMs += (gap - gapMs) * 0.1;
        workMs += (work - workMs) * 0.1;
        frames++;
        if (frames < 30) return;
        frames = 0;
        if (gapMs > 20) budget = Math.max(MIN_SPARKS, Math.floor(budget * 0.86));
        else if (workMs < 4.5) budget = Math.min(MAX_SPARKS, budget + 90);
      }

      /* ================================================================
         Drawing.
         ================================================================ */
      function buildSmokeSprite() {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var s = c.getContext('2d');
        if (!s) return null;
        var gr = s.createRadialGradient(32, 32, 0, 32, 32, 32);
        /* Grey, and only grey. A pass tinted with the burst colour was
           tried and every puff turned into a nebula: real firework smoke is
           lit for about a tenth of a second and is a grey rag for the
           other nine seconds you can see it. */
        gr.addColorStop(0, 'rgba(206,215,232,0.60)');
        gr.addColorStop(0.45, 'rgba(184,196,216,0.26)');
        gr.addColorStop(1, 'rgba(166,180,204,0)');
        s.fillStyle = gr;
        s.fillRect(0, 0, 64, 64);
        return c;
      }

      function drawSky(ctx) {
        if (!skyGrad) {
          skyGrad = ctx.createLinearGradient(0, 0, 0, H);
          skyGrad.addColorStop(0, '#02030c');
          skyGrad.addColorStop(0.6, '#050a1a');
          skyGrad.addColorStop(1, '#0b1226');
        }
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);

        for (var i = 0; i < skyStars.length; i++) {
          var s = skyStars[i];
          ctx.fillStyle = 'rgba(226,232,240,' + s.a.toFixed(2) + ')';
          ctx.fillRect(s.x, s.y, s.r, s.r);
        }
      }

      function drawTown(ctx) {
        var i, j, b;
        ctx.fillStyle = '#070a14';
        for (i = 0; i < buildings.length; i++) {
          b = buildings[i];
          ctx.fillRect(b.x, b.y, b.w, b.h);
        }
        ctx.fillStyle = 'rgba(255,214,140,0.5)';
        for (i = 0; i < buildings.length; i++) {
          b = buildings[i];
          for (j = 0; j < b.lit.length; j++) {
            ctx.fillRect(b.lit[j].x, b.lit[j].y, 2, 3);
          }
        }
      }

      function drawSmoke(ctx) {
        if (!smokeSprite) smokeSprite = buildSmokeSprite();
        if (!smokeSprite) return;
        for (var i = 0; i < puffs.length; i++) {
          var q = puffs[i];
          var t = q.life / q.span;
          /* Fades in over the first fifth and out over the rest. A puff
             that appears at full opacity is a stamp, not a cloud. */
          var al = q.a * (t < 0.2 ? t / 0.2 : (1 - (t - 0.2) / 0.8));
          if (al <= 0.004) continue;
          ctx.globalAlpha = al;
          ctx.drawImage(smokeSprite, q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
        }
        ctx.globalAlpha = 1;
      }

      function drawSparks(ctx) {
        var i, p, band, sp, len;
        ctx.globalCompositeOperation = 'lighter';

        for (i = 0; i < stars.length; i++) {
          p = stars[i];
          band = (p.life / p.span * BANDS) | 0;
          if (band > BANDS - 1) band = BANDS - 1;
          ctx.fillStyle = p.tints[band];
          /* A streak as long as the distance the star covers in a frame,
             centred on the position rather than trailing it, because half
             of that distance is behind it whichever way it is going. Fast
             stars are lines to the eye and to a camera, and this does more
             for a break than any amount of colour work. */
          sp = Math.abs(p.vx) + Math.abs(p.vy);
          if (sp > 70) {
            len = Math.min(9, sp * 0.035);
            var ux = p.vx / sp, uy = p.vy / sp;
            ctx.fillRect(p.x - ux * len * 0.5, p.y - uy * len * 0.5,
              Math.max(1, Math.abs(ux) * len + p.size * 0.6),
              Math.max(1, Math.abs(uy) * len + p.size * 0.6));
          } else {
            ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
          }
        }

        /* The shells and the comets themselves, brighter than anything
           they are shedding. */
        for (i = 0; i < shells.length; i++) {
          ctx.fillStyle = 'rgba(255,238,200,0.9)';
          ctx.fillRect(shells[i].x - 1.4, shells[i].y - 1.4, 2.8, 2.8);
        }
        for (i = 0; i < comets.length; i++) {
          ctx.fillStyle = 'rgba(255,246,224,0.92)';
          ctx.fillRect(comets[i].x - 1.6, comets[i].y - 1.6, 3.2, 3.2);
        }

        ctx.globalCompositeOperation = 'source-over';
      }

      function drawGround(ctx) {
        ctx.fillStyle = '#05070f';
        ctx.fillRect(0, GROUND_Y - 4, W, H - GROUND_Y + 4);
        ctx.fillStyle = 'rgba(148,163,184,0.10)';
        ctx.fillRect(0, GROUND_Y - 4, W, 1);

        for (var i = 0; i < tubes.length; i++) {
          var t = tubes[i];
          ctx.fillStyle = '#141a28';
          ctx.fillRect(t.x - 3, GROUND_Y - 12, 6, 12);
          if (t.flash > 0.01) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255,210,140,' + (t.flash * 0.7).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(t.x, GROUND_Y - 12, 5 + t.flash * 14, 0, TAU);
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }

      /* Built once, not per run. The tables are pure functions of the
         palettes and the skyline is scenery — regenerating it on every
         restart would give the same town a different silhouette each time,
         which reads as a rendering fault rather than as a new night. */
      buildTints();
      buildScene();

      return {
        reset: function () {
          shells.length = 0;
          comets.length = 0;
          stars.length = 0;
          spare.length = 0;
          puffs.length = 0;
          clock = 0;
          launchAcc = 0;
          launched = 0;
          flash = 0;
          breeze = 0;
          finaleUntil = -1;
          lastDelayMs = 0;
          sndAcc = 0;

          if (typeSel) wantType = SHELLS[typeSel.value] ? typeSel.value : 'random';
          readRate();
          readSize();
          syncFinale();

          g.stat('shells', 0);
          g.stat('sparks', 0);
          /* A dash rather than 0 ms: nothing has broken yet, and "0 ms"
             would be a claim about a report that never arrived. */
          g.stat('delay', '—');

          sky.set('rise', { n: 0, v: 0 });
          sky.set('wind', 0);
        },

        key: function (name) {
          /* Space puts one up somewhere sensible. The aimed version is on
             the canvas, where the thing you are aiming at actually is. */
          if (name === 'action') launchRandom();
        },

        update: function (raw) {
          /* The one place reduced motion is applied. Everything downstream
             — the physics, the launch rate, the fuses, the smoke — is in
             display seconds, and the only other place that has to know is
             the propagation delay, which divides by the same number. */
          var dt = raw * slow;
          clock += dt;

          /* The breeze wanders rather than sitting still. Two slow sines
             at unrelated periods, so it never repeats inside a session and
             never blows hard enough to make the smoke look like a wind
             tunnel. */
          breeze = Math.sin(clock * 0.06) * 9 + Math.sin(clock * 0.017 + 1.3) * 6;

          var live = clock < finaleUntil;
          if (finaleBtn && (finaleBtn.getAttribute('aria-pressed') === 'true') !== live) {
            syncFinale();
          }

          /* The launcher. An accumulator rather than a countdown, so a
             change of rate takes effect on the next shell instead of on
             the next whole interval, and so a slow frame launches the
             shells it owes rather than losing them. */
          /* A FINALE IS AN ABSOLUTE RATE, NOT A MULTIPLE OF THE SLIDER.
             Multiplying was the first version and it compounded: at the
             top of the rate slider the finale asked for thirteen shells a
             second, which is past what the spark budget can dress and past
             what a finale is — the sky never clears, every break is
             starved of stars, and the reports run together into one noise.
             Taking the slider's rate as a FLOOR and scaling that keeps the
             whole range between about four and six and a half a second,
             which is what emptying a rack actually sounds like. */
          var shellsPerSec = live ? Math.max(rate, 1.3) * 2.4 : rate;
          launchAcc += dt * shellsPerSec;
          var guard = 0;
          while (launchAcc >= 1 && guard < 6) {
            launchAcc -= 1;
            guard++;
            launchRandom();
            /* A finale is not a faster metronome, it is salvos. Every so
               often a second goes up in the same instant from another part
               of the rack, so the reports arrive in ragged handfuls rather
               than in a queue — which is the difference between a finale
               and a fast display. */
            if (live && Math.random() < 0.3) launchRandom();
          }
          /* Anything still owed past the guard is dropped rather than
             carried: a machine that stalled for a second should not answer
             by firing twelve shells into one frame. */
          if (launchAcc > 1) launchAcc = 1;

          stepShells(dt);
          stepComets(dt);
          stepStars(dt);
          stepSmoke(dt);

          /* Both of these approach zero at a rate rather than by a fixed
             subtraction, so a slow machine sees the same decay shape as a
             fast one instead of a slower one. */
          flash += (0 - flash) * Math.min(1, 9 * dt);
          for (var i = 0; i < tubes.length; i++) {
            tubes[i].flash += (0 - tubes[i].flash) * Math.min(1, 7 * dt);
          }
        },

        draw: function (ctx) {
          var t0 = perfNow();

          drawSky(ctx);
          drawTown(ctx);
          /* Smoke in front of the skyline and behind the fire: it hangs
             between the town and the break, which is where it actually is,
             and it is the thing later shells are seen through. */
          drawSmoke(ctx);
          drawSparks(ctx);
          /* The ground last, opaque, so a falling ember disappears behind
             the rack rather than sliding over it. */
          drawGround(ctx);

          if (flash > 0.002) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(' + flashCol[0] + ',' + flashCol[1] + ',' +
              flashCol[2] + ',' + flash.toFixed(3) + ')';
            ctx.fillRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'source-over';
          }

          if (clock < finaleUntil) {
            ctx.fillStyle = 'rgba(253,224,71,0.85)';
            ctx.font = 'bold 13px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('FINALE', W / 2, 24);
            ctx.textAlign = 'left';
          }

          if (lastDelayMs > 0) {
            /* The number the whole file is about, printed where it can be
               read against the thing it describes. It is the last break's
               figure and it changes with every shell, which is the point:
               a low one is a third of a second and a high one is two
               thirds, and nothing else on the page says so. */
            ctx.fillStyle = 'rgba(148,163,184,0.45)';
            ctx.font = '11px "Segoe UI", sans-serif';
            ctx.fillText('report +' + lastDelayMs + ' ms', 10, H - 10);
          }

          adapt(perfNow() - t0, lastFrame ? t0 - lastFrame : 0);
          lastFrame = t0;
        }
      };
    }
  });
})();

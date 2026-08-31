/* ==========================================================================
   aquarium.js — a reef tank: schooling fish, moving light, and water.
   --------------------------------------------------------------------------
   boids.js is the ancestor and this file is a deliberate argument with it, in
   four places. Reynolds's three rules are still here and still doing the
   work; what changes is what a neighbour is, where a fish is allowed to be,
   and what time of day it is.

   1. A FISH SCHOOLS WITH ITS OWN SPECIES AND NOBODY ELSE. In boids every
      bird takes alignment and cohesion from every other bird, because they
      are all the same bird. Drop five species into one tank on that rule and
      you do not get a reef, you get one enormous flock wearing five colours,
      which is the one thing a reef never looks like. So alignment and
      cohesion are read only from a neighbour of the same species; a
      neighbour of a different species contributes SEPARATION and nothing
      else, scaled by how big it is. That single test is what makes a shoal
      of tetras part around an angelfish instead of recruiting it.

      Two fish ignore the rule entirely. The angel and the wrasse have
      school: 0, so they take no alignment and no cohesion from anything —
      they wander, they hold a depth, and everything else gets out of their
      way. A tank where every fish shoals reads as an aquarium screensaver;
      the loners are what make it read as a tank somebody keeps.

   2. THE TANK HAS EDGES AND A DEPTH. boids wraps, because the sky has no
      walls and a bounded box makes a flock pile into the corners. An
      aquarium is nothing BUT walls, so the boundary is a steering force
      rather than a teleport — fish turn away from glass, from the surface
      and from the sand, and they turn earlier the faster they are going.

      There is also a z: 0 at the front glass, 1 at the back, flocking in
      three dimensions with the depth scaled by TANKD so a z difference and
      an x difference are the same kind of number. Everything downstream
      falls out of it — a fish is smaller and hazier further back, the sand
      is lower at the front than at the horizon, and a school has a shape
      going away from you rather than being a pattern painted on glass.

   3. SPECIES HOLD DIFFERENT DEPTHS. Anthias hang high, tangs cruise
      mid-water, gobies sit on the sand. One weak spring per fish toward its
      species' band is all it takes, and it is the difference between a tank
      and a snow globe.

   4. THERE IS A TIME OF DAY, AND IT CHANGES THE FISH. At night the light
      goes out, the caustics go with it, the fish slow to about four tenths
      of their cruise, the schools loosen, and every band sinks toward the
      sand. That is roughly what a reef does at dusk, and it means the toy is
      a different toy if you leave it running.

   ---- THE LIGHT ---------------------------------------------------------
   The caustic net is the one part of the drawing that is not paths. Ridges
   are computed into a small offscreen buffer — 80 x 26 by default — and
   drawImage'd up to the sand, where the browser's own smoothing does the
   blurring for free. Drawing it as paths at full resolution was the first
   attempt and cost more than everything else in the frame put together.

   The field is three sine terms summed, with the bright filaments taken
   where the sum crosses zero. Evaluated naively that is three sines per
   pixel, about six thousand a frame, which is most of a millisecond. It is
   evaluated instead through the angle-addition identity, so sin(u + v)
   comes out of per-column and per-row tables built once a frame: four sines
   per column and four per row, roughly four hundred in total, and the pixel
   loop is multiply-add only.

   ---- THE SOUND ---------------------------------------------------------
   rain.js settled this argument and the reasoning transfers whole. A tank
   is a CONDITION, not a sequence of events: the pump does not happen, it
   continues. So the pump, the flow off the return and the hiss of two air
   stones are one held bed of filtered noise, steered by the current slider
   and by how many bubbles are actually in the water.

   Bubbles reaching the surface ARE events, and they are rare enough to be
   heard as themselves — a few a second rather than rain's forty — so they
   get a struck voice, gated the way rain gates its drops. The pitch comes
   from Minnaert's formula: a bubble rings at about 3.26/R hertz-metres, so
   a big one is low and a small one is high, and the little upward chirp on
   the way out is what stops it reading as a woodblock.

   ES5 throughout, like everything else under assets/js.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 440;
  var TAU = Math.PI * 2;

  /* The tank. FRAME is the trim the glass sits in, SURF is the waterline,
     and the sand runs from SAND_FAR — where it meets the back glass — down
     to FLOOR at the front glass. The gap between those two IS the
     perspective: everything that needs to know where the floor is asks
     sandY(z) rather than using a constant. */
  var FRAME = 9;
  var SURF = 34;
  var SAND_FAR = 330;
  var FLOOR = H - FRAME - 3;

  /* How deep the tank is, in the same units as x and y. Depth is stored as
     z in 0..1, and this is the number that turns a difference in z into a
     distance the flocking can compare against a distance in x. Set it much
     smaller and every school flattens onto the glass; much larger and fish
     a hand's width apart on screen stop being able to see each other. */
  var TANKD = 150;

  /* The spatial hash. THE CELL SIZE IS THE MAXIMUM VIEW RADIUS ANY SPECIES
     MAY HAVE, not a number picked for the grid: a fish only looks at its own
     cell and the eight around it, so a fish sitting on a cell boundary sees
     exactly CELL units in the worst direction. Every `view` in the species
     table below is checked against this. */
  var CELL = 60;
  var CELLW = Math.ceil(W / CELL);
  var CELLH = Math.ceil(H / CELL);
  var CELLS = CELLW * CELLH;

  /* Seconds in a full day and night on the Auto setting. Long enough that
     the light is never seen to move — three and a half minutes across a
     change this large is under half a per cent of brightness a second, so
     nothing here can read as a flicker or a flash — and short enough that a
     visitor who stays for one song sees both ends of it. */
  var CYCLE = 210;

  /* The two palettes everything is interpolated between. Kept as raw triples
     rather than as strings for the same reason disco.js keeps its gel
     colours that way: a colour that has to be crossfaded sixty times a
     second should be three numbers, not a string to be reparsed. */
  var DAY = {
    top: [26, 108, 124],
    deep: [8, 46, 66],
    haze: [38, 118, 130],
    back: [12, 56, 72],
    sand: [208, 188, 146],
    plant: [48, 134, 86],
    caustic: [186, 244, 255],
    causticK: 1
  };
  var NIGHT = {
    top: [11, 27, 56],
    deep: [3, 9, 24],
    haze: [17, 36, 68],
    back: [6, 16, 36],
    sand: [56, 62, 90],
    plant: [20, 54, 60],
    caustic: [148, 176, 255],
    /* Moonlight through a metre of moving water still makes a net on the
       sand; it is simply too faint to see unless you are looking for it.
       Zero here would be easier and would be wrong. */
    causticK: 0.16
  };

  /* ------------------------------------------------------------------
     The stock list.

     `school` is the multiplier on alignment and cohesion, and it is the
     field that decides what a species looks like from across the room: a
     chromis at 0.92 is a ball you could throw, a goby at 0.35 is a loose
     scatter that happens to be near other gobies. `band` is where in the
     water column the species hangs, 0 at the surface and 1 on the sand,
     with `spread` how loosely it holds to it.

     `view` may never exceed CELL — see the note on the hash above.

     Sizes are body lengths in logical units at depth zero, so a tetra is
     about a tenth the width of the tank at the front glass and a good deal
     less at the back. They are in the right proportion to each other, which
     is the only thing the eye actually checks.
     ------------------------------------------------------------------ */
  var SCHOOLERS = [
    { name: 'tetra', len: 10, cruise: 58, sep: 12, view: 44, school: 1.00,
      band: 0.46, spread: 0.16, share: 3.0, stripe: 1,
      col: [92, 202, 236], fin: [244, 112, 122] },
    { name: 'tang', len: 21, cruise: 46, sep: 22, view: 56, school: 0.60,
      band: 0.38, spread: 0.22, share: 1.0, stripe: 0,
      col: [62, 118, 232], fin: [250, 206, 70] },
    { name: 'anthias', len: 14, cruise: 52, sep: 16, view: 50, school: 0.85,
      band: 0.28, spread: 0.20, share: 1.6, stripe: 0,
      col: [248, 130, 152], fin: [255, 198, 122] },
    { name: 'chromis', len: 12, cruise: 50, sep: 14, view: 48, school: 0.92,
      band: 0.54, spread: 0.18, share: 2.0, stripe: 0,
      col: [124, 214, 198], fin: [200, 246, 234] },
    { name: 'goby', len: 11, cruise: 38, sep: 15, view: 38, school: 0.35,
      band: 0.88, spread: 0.09, share: 0.9, stripe: 2,
      col: [236, 196, 112], fin: [255, 238, 184] }
  ];

  /* The two that ignore everyone. school: 0 removes them from alignment and
     cohesion in both directions — they take none, and because the same test
     is applied by whoever is looking at them, they give none either. */
  var LONERS = [
    { name: 'angel', len: 34, cruise: 34, sep: 40, view: 58, school: 0,
      band: 0.46, spread: 0.30, share: 0, stripe: 3,
      col: [250, 222, 122], fin: [72, 98, 182] },
    { name: 'wrasse', len: 26, cruise: 44, sep: 34, view: 58, school: 0,
      band: 0.64, spread: 0.28, share: 0, stripe: 4,
      col: [144, 118, 232], fin: [112, 238, 190] }
  ];

  var MIXES = {
    shoal: [0],
    mixed: [0, 1, 3],
    reef: [0, 1, 2, 3, 4]
  };

  /* Where the two air stones sit, and how deep in the tank they are. Both
     are behind the rockwork rather than out in the open, which is where
     anybody actually hides one. */
  var STONES = [
    { x: 112, z: 0.74, rate: 9 },
    { x: 532, z: 0.58, rate: 7 }
  ];

  var MAX_BUBBLES = 170;
  var MAX_PELLETS = 44;

  /* Colours that are constant in the tank and only ever fogged. Module-level
     because fogged() reads them once per rock, per plant and per pellet, and
     three array literals inside a draw loop is a few hundred short-lived
     objects a second for a value that never changes. */
  var ROCK = [26, 30, 38];
  var ROCK_RIM = [150, 200, 190];
  var FLAKE = [214, 176, 116];

  function perfNow() {
    return (window.performance && window.performance.now)
      ? window.performance.now() : +new Date();
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixCol(a, b, t, out) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }

  function solid(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }

  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  /* Hermite, the same curve every shader calls smoothstep. Used for dawn and
     dusk: a linear fade between day and night has two visible corners in it,
     one at each end, and a sunrise with a corner in it is a light switch. */
  function smooth(x, a, b) {
    var t = (x - a) / (b - a);
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  GameShell.define({
    id: 'game-aquarium',
    slug: 'aquarium',
    title: 'Aquarium',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: true,

    setup: function (g) {
      /* Asked once, for the reason disco.js gives: this is a statement about
         the visitor, not about the page, and re-reading it per frame would
         only let it change under a toy that is already running.

         Here it is a REDUCTION rather than a refusal. Nothing in this tank
         flashes, nothing scrolls the whole field, and there is no full-frame
         luminance change anywhere in the draw — so the honest answer to
         "less motion please" is a calmer tank, not an empty one. Every rate
         downstream of `tt` is halved: the sway, the caustics, the surface,
         the wobble on the far glass, and the day. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var fish = [];
      var bubbles = [];
      var pellets = [];
      var pops = [];
      var plants = [];
      var rocks = [];

      var wantFish = 90;
      var mixName = 'mixed';
      var mix = MIXES.mixed;
      var current = 0.6;          // 0..1.5 from the slider
      var lightMode = 'auto';
      var bubblesOn = true;

      var tt = 0;                 // the animation clock, in seconds
      var dayT = CYCLE * 0.18;    // start mid-morning rather than at dawn
      var sun = 1;                // the light actually in force, 0..1
      var sunVel = 0;
      var lightWord = '';
      var sndAcc = 0;             // seconds since the bed was last steered
      var currentLean = 0;        // how far the flow is bending the planting

      /* Allocation-free spatial hash. boids rebuilds an array of arrays every
         step, which at 120 steps a second is a few hundred short-lived
         arrays a second for the collector to deal with. This is the same
         grid written as two flat integer lists — `heads[cell]` is the first
         fish in that cell and `next[i]` is the one after fish i — so the
         whole rebuild is two loops over numbers and allocates nothing at
         all after the first step. */
      var heads = [];
      var next = [];

      /* Stamped rather than cleared. Marking a fish with the pellet it has
         been offered means writing to every fish that is near food; the
         alternative is clearing a flag on every fish in the tank every step
         whether it is near anything or not. The stamp makes a stale mark
         self-evidently stale. */
      var stamp = 0;

      /* Frame measurement. Two numbers, because a frame INTERVAL cannot see
         headroom — requestAnimationFrame fires on vsync, so a 60 Hz display
         reports 16.7 ms whether the frame took two milliseconds or fifteen.
         Overload is read from the interval, where a dropped frame shows up
         honestly as a 33 ms gap; spare capacity is read from the time the
         drawing itself takes. Both are exponential means over about ten
         frames, because one garbage collection is enough to halve a quality
         steered on a single sample. Same instrument as fountain.js. */
      var quality = 0.8;
      var gapMs = 16;
      var workMs = 4;
      var frames = 0;
      var lastFrame = 0;

      var fishSel = document.getElementById('game-fish');
      var mixSel = document.getElementById('game-species');
      var currentIn = document.getElementById('game-current');
      var lightSel = document.getElementById('game-light');
      var bubbleBtn = document.getElementById('game-bubbles');

      /* Scratch colours. Every one of these is overwritten before it is read
         and none of them outlives the expression it is built for; they exist
         so that drawing a hundred and sixty fish does not allocate three
         hundred and twenty short-lived arrays a frame. */
      var cTop = [0, 0, 0], cDeep = [0, 0, 0], cHaze = [0, 0, 0];
      var cBack = [0, 0, 0], cSand = [0, 0, 0], cPlant = [0, 0, 0];
      var cCaus = [0, 0, 0], cBody = [0, 0, 0], cFin = [0, 0, 0];
      var cTint = [0, 0, 0], cDark = [0, 0, 0];
      var causK = 1;

      /* The two edges of one plant, held rather than rebuilt. Seven points a
         side and twenty-six plants is a hundred and four arrays a frame if
         they are declared inside the loop, which is the kind of garbage that
         does not show up as a slow frame but does show up as a collection
         pause every few seconds. */
      var pLX = [], pLY = [], pRX = [], pRY = [];

      /* ---------------------------------------------------------------
         The water, held.

         Three layers of filtered noise and they are not decoration of each
         other: PUMP is the motor, FLOW is the return pouring back into the
         tank, FIZZ is the two air stones. Ship the pump alone and it is a
         fridge; ship the flow alone and it is a tap; ship the fizz alone
         and it is a fizzy drink. A tank is all three at once, which is why
         it is one bed and not three sounds.

         The pump is A RESONANT LOWPASS ON WHITE NOISE, not an oscillator.
         A biquad with a Q of eight rings at its cutoff, so noise through it
         comes out as a hum that is never quite the same hum twice — which
         is what a motor bolted to a glass box actually sounds like, and
         what a pure sine at 118 Hz has to fake with an LFO.
         --------------------------------------------------------------- */
      var tank = g.bed(function (a) {
        var ctx = a.ctx;

        function layer(type, freq, q, level) {
          var src = ctx.createBufferSource();
          src.buffer = a.noise();
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

        /* 118 Hz because that is roughly where a small submersible pump
           sits: a two-pole motor on 50 Hz mains vibrates at twice the line
           frequency, and the cheap ones sing about it. */
        var pump = layer('lowpass', 118, 8, 0.030);
        var flow = layer('bandpass', 760, 0.7, 0.018);
        var fizz = layer('highpass', 3100, 0.6, 0.0);

        /* The impeller is not perfectly balanced and never was. A slow
           wobble on the pump's cutoff — one cycle every nine seconds — is
           the whole difference between a tank and a test tone; rain.js
           breathes every sixteen because weather is slower than machinery. */
        var lfo = ctx.createOscillator();
        var depth = ctx.createGain();
        lfo.frequency.value = 0.11;
        depth.gain.value = 14;
        lfo.connect(depth);
        depth.connect(pump.filt.frequency);
        lfo.start();

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.5 : secs));
        }

        /* A struck bubble. Sine, because a bubble is very nearly one: the
           gas sphere rings at a single mode and everything else about the
           sound is the envelope.

           THE PITCH RISES ON THE WAY OUT and that is the whole character.
           Minnaert's 1933 result puts the resonance at about 3.26/R with R
           in metres, so the radius arriving here is mapped straight onto a
           frequency — a three-millimetre bubble near 1 kHz, a one-millimetre
           one near 3. Hold that pitch flat for the fifty milliseconds it
           sounds for and it is a woodblock; let it climb a musical fourth
           and it is unmistakably water. */
        function plink(r, when) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          /* r arrives as the drawn radius in logical units, 1.1..3.4. The
             big end is the bottom of the range because bigger is lower. */
          var k = (r - 1.1) / 2.3;
          if (k < 0) k = 0; else if (k > 1) k = 1;
          var f0 = 2400 - k * 1500;
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f0, when);
          osc.frequency.exponentialRampToValueAtTime(f0 * 1.32, when + 0.045);
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(0.030 - k * 0.008, when + 0.004);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
          osc.connect(gain);
          gain.connect(a.out);
          osc.start(when);
          osc.stop(when + 0.08);
        }

        /* THE FIRST PLINK MAY BE A GHOST. A bed remembers the last value
           set on each key and replays it when its nodes are finally built,
           so unmuting halfway through a session fires whichever bubble
           happened to pop last — a plink with no bubble under it, every
           time anyone touches the sound button. disco.js hit the same wall
           with its sequencer and solved it the same way: the payload
           carries a sequence number, a bed built at the start of the run
           has genuinely never seen one, and a bed built mid-run gets a
           replay carrying a number in the hundreds. One test. */
        var warm = false;

        return {
          set: function (key, value) {
            if (key === 'pop') {
              /* A suspended context has a frozen clock and booking against
                 it stacks every event into one window — see the same guard
                 in disco.js, where it is the difference between silence and
                 a crack on unmute. */
              if (ctx.state !== 'running') return;
              if (!warm) { warm = true; if (value.seq > 0) return; }
              plink(value.r, ctx.currentTime);
              return;
            }
            if (key === 'flow') {
              /* The current slider is a water control that belongs on the
                 sound as much as on the plants. More flow is louder and
                 brighter, and the pump works marginally harder for it. */
              var k = value > 1 ? 1 : (value < 0 ? 0 : value);
              ramp(flow.gain.gain, 0.008 + k * 0.030);
              ramp(flow.filt.frequency, 600 + k * 520);
              ramp(pump.gain.gain, 0.024 + k * 0.014);
              return;
            }
            if (key === 'fizz') {
              /* Follows the bubbles actually in the water rather than the
                 button, so switching the stones off fades over a couple of
                 seconds as the last of them reach the surface instead of
                 stopping dead while they are still visibly rising. */
              var f = value > 1 ? 1 : (value < 0 ? 0 : value);
              ramp(fizz.gain.gain, f * 0.020, 1.2);
              ramp(fizz.filt.frequency, 3400 - f * 700, 1.2);
            }
          }
        };
      });

      /* A pinch of food hitting the water. One dry rustle rather than a
         sound per pellet: eight pellets land inside a tenth of a second and
         eight separate ticks is a rattle, not a feed. */
      function feedSound() {
        g.noise(0.16, { type: 'highpass', freq: 2200, to: 900, q: 0.8, level: 0.030 });
      }

      /* A fish taking a pellet. Very short, very quiet, and gated hard,
         because a hundred and sixty fish falling on the same handful of food
         satisfy this condition dozens of times inside a second and the ear
         hears that as one tearing noise rather than as many small ones. */
      function nip() {
        if (!g.gate('nip', 0.09)) return;
        g.noise(0.035, { type: 'bandpass', freq: 1800, to: 700, q: 2.4, level: 0.022 });
      }

      /* ---------------------------------------------------------------
         Geometry.
         --------------------------------------------------------------- */

      /* Where the sand is at this depth. The whole of the tank's perspective
         is this one line: at the back glass the floor is at SAND_FAR, at the
         front it is most of a hundred units lower, and a fish at z = 0.3 is
         allowed down to somewhere between. */
      function sandY(z) {
        return SAND_FAR + (FLOOR - SAND_FAR) * (1 - z);
      }

      /* How big something at this depth is drawn. Not a true 1/distance
         projection — that would need a focal length and would make the front
         fish grotesque against a tank only a hundred and fifty units deep.
         This is the same monotone squash with the far end held where a fish
         is still recognisably a fish. */
      function scaleAt(z) {
        return 1.14 - 0.58 * z;
      }

      /* Refraction on the far glass. Everything at the back of the tank is
         seen through most of a tank's worth of moving water, so its outline
         bends; everything at the front is seen through almost none, so it
         does not. That is why the amplitude is multiplied by depth at every
         call site rather than being a constant — a wobble applied evenly to
         near and far objects alike reads as the whole picture being underwater,
         which is the one thing a viewer standing in the room is not.

         Two frequencies rather than one. A single sine is a corrugated sheet;
         the second, slower and running the other way, is what makes the
         surface of the distortion look like water rather than like a spring. */
      function wob(y, amp) {
        return (Math.sin(y * 0.055 + tt * 1.35) +
                Math.sin(y * 0.021 - tt * 0.85) * 0.62) * amp;
      }

      /* ---------------------------------------------------------------
         Stocking the tank.
         --------------------------------------------------------------- */
      function addFish(sp, spi) {
        var band = sp.band + (Math.random() - 0.5) * sp.spread;
        var z = 0.08 + Math.random() * 0.86;
        var ang = Math.random() * TAU;
        fish.push({
          sp: sp,
          spi: spi,
          x: FRAME + 20 + Math.random() * (W - FRAME * 2 - 40),
          y: SURF + 16 + band * (sandY(z) - SURF - 30),
          z: z,
          vx: Math.cos(ang) * sp.cruise,
          vy: Math.sin(ang) * sp.cruise * 0.3,
          vz: (Math.random() - 0.5) * 0.06,
          /* Every fish is a little faster or slower than the species. A
             shoal where every member cruises at exactly 58 units a second
             holds its shape forever and reads as a rigid body. */
          rate: 0.86 + Math.random() * 0.28,
          band: band,
          phase: Math.random() * TAU,
          wander: ang,
          foodStamp: -1,
          fx: 0,
          fy: 0
        });
      }

      /* Adopting a stocking list is one act, not two — the tank takes the
         new fish and the HUD states what is in it. boids.js learned this the
         hard way: a dropdown handler that only reseeded left the HUD
         claiming a flock size that was plainly not on the screen. Both the
         dropdowns and reset() come through here, so there is nowhere left to
         change the stock that does not also report it. */
      function stock() {
        fish = [];

        var i, k;
        var total = wantFish - LONERS.length;
        if (total < 4) total = 4;

        var weight = 0;
        for (i = 0; i < mix.length; i++) weight += SCHOOLERS[mix[i]].share;

        var made = 0;
        for (i = 0; i < mix.length; i++) {
          var sp = SCHOOLERS[mix[i]];
          /* The last species takes the remainder rather than its own share,
             so rounding can never leave the tank one fish short of the
             number the HUD has just published. */
          var n = (i === mix.length - 1)
            ? total - made
            : Math.round(total * sp.share / weight);
          for (k = 0; k < n; k++) addFish(sp, mix[i]);
          made += n;
        }
        for (i = 0; i < LONERS.length; i++) addFish(LONERS[i], -1 - i);

        next.length = fish.length;

        g.stat('fish', fish.length);
        g.stat('species', mix.length + ' schooling + ' + LONERS.length + ' loners');
      }

      /* Plants and rockwork are laid out once and then left alone. Their
         positions are random, but they are random ONCE — a tank that
         rearranged its own scenery on every restart would be a different
         tank each time, and the whole appeal of an aquarium is that it is
         the same tank doing something different. */
      function scape() {
        plants = [];
        rocks = [];

        var i;
        for (i = 0; i < 26; i++) {
          var z = 0.05 + Math.random() * 0.9;
          plants.push({
            x: FRAME + 8 + Math.random() * (W - FRAME * 2 - 16),
            z: z,
            /* Tall thin blades at the back, shorter bushier ones at the
               front, because that is how anybody plants a tank: nothing
               that blocks the view of the thing you paid for. */
            h: (46 + Math.random() * 96) * (0.55 + 0.65 * z),
            w: 2.0 + Math.random() * 3.0,
            lean: (Math.random() - 0.5) * 0.5,
            phase: Math.random() * TAU,
            rate: 0.5 + Math.random() * 0.45,
            tint: Math.random()
          });
        }

        /* Rocks are silhouettes: a base line on the sand and three or four
           peaks above it. Drawn as a path so the far ones can have the
           refraction wobble applied to every vertex. */
        for (i = 0; i < 5; i++) {
          var rz = i < 3 ? 0.62 + Math.random() * 0.34 : 0.10 + Math.random() * 0.22;
          var cx = 60 + Math.random() * (W - 120);
          var rw = 54 + Math.random() * 90;
          var rh = 26 + Math.random() * 54;
          var pts = [];
          var steps = 7;
          for (var j = 0; j <= steps; j++) {
            var t = j / steps;
            /* A dome with noise on it. A pure arc reads as a bowl; the
               per-vertex jitter is the entire difference between a rock and
               a paperweight. */
            var lift = Math.sin(t * Math.PI) * rh * (0.7 + Math.random() * 0.5);
            pts.push({ dx: (t - 0.5) * rw, dy: -lift });
          }
          rocks.push({ x: cx, z: rz, pts: pts });
        }
        rocks.sort(function (a, b) { return b.z - a.z; });
      }

      /* ---------------------------------------------------------------
         The caustic buffer. See the header for why this is pixels and not
         paths, and why the field is evaluated through angle addition rather
         than with three sines per pixel.
         --------------------------------------------------------------- */
      var causCv = null;
      var causCtx = null;
      var causImg = null;
      var causW = 0;
      var causH = 0;
      var colA = [], colCs = [], colCc = [];

      function ensureCaustic(cols, rows) {
        if (causW === cols && causH === rows && causImg) return true;
        if (!causCv) {
          causCv = document.createElement('canvas');
          causCtx = causCv.getContext ? causCv.getContext('2d') : null;
        }
        if (!causCtx) return false;
        causCv.width = cols;
        causCv.height = rows;
        causImg = causCtx.createImageData(cols, rows);
        causW = cols;
        causH = rows;
        colA.length = cols;
        colCs.length = cols;
        colCc.length = cols;
        return true;
      }

      function fillCaustic(strength) {
        var cols = Math.round(48 + 48 * quality);
        var rows = Math.round(16 + 14 * quality);
        if (!ensureCaustic(cols, rows)) return false;

        var data = causImg.data;
        var t = tt;
        var i, j;

        /* Per-column tables. The field is
              sin(u*6.1 + 0.9t) + sin(v*4.4 - 0.7t) + sin(u*4.1 + v*3.3 + 1.35t)
           and the third term is the expensive one, because it depends on
           both axes. Split it with sin(A+B) = sinA cosB + cosA sinB and the
           halves separate: A is per column, B is per row. Four sines a
           column and four a row instead of three per pixel — about four
           hundred a frame against six thousand. */
        for (i = 0; i < cols; i++) {
          var u = i / (cols - 1);
          colA[i] = Math.sin(u * 6.1 + t * 0.9);
          var ph = u * 4.1 + t * 1.35;
          colCs[i] = Math.sin(ph);
          colCc[i] = Math.cos(ph);
        }

        var p = 0;
        var cr = cCaus[0], cg = cCaus[1], cb = cCaus[2];
        for (j = 0; j < rows; j++) {
          /* PERSPECTIVE, BAKED INTO THE SAMPLING. The sand is a plane seen
             at a glancing angle, so a row of pixels near the horizon covers
             several times as much world as a row near the front glass. The
             row's world coordinate therefore runs as 1/(a + b*s) rather
             than linearly, which squeezes the net tighter toward the back —
             which is what the eye reads as distance.

             The horizontal squeeze a full perspective would also apply is
             deliberately left out. Applying it would make u depend on the
             row, which would put the per-column table back inside the row
             loop and cost the entire saving above; the vertical compression
             is the one the eye actually checks. */
          var s = j / (rows - 1);
          var v = 3.6 / (0.30 + 0.70 * s);

          var rb = Math.sin(v * 4.4 - t * 0.7);
          var rs = Math.sin(v * 3.3);
          var rc = Math.cos(v * 3.3);

          for (i = 0; i < cols; i++) {
            var raw = colA[i] + rb + (colCs[i] * rc + colCc[i] * rs);
            /* The bright filaments live where the three waves cancel, which
               is the physical thing as well as the cheap thing: a caustic
               IS the fold in a wavefront. Cubing the ridge turns a soft band
               into the thin bright web a real one draws, and everything
               below the fold goes to nothing rather than to a dim grey. */
            var b = 1 - Math.abs(raw) * 0.5;
            if (b <= 0) {
              data[p] = 0; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 255;
              p += 4;
              continue;
            }
            b = b * b * b * strength;
            if (b > 1) b = 1;
            data[p] = cr * b;
            data[p + 1] = cg * b;
            data[p + 2] = cb * b;
            /* Opaque, always. The buffer is composited with 'lighter', so
               what is added is the RGB; leaving alpha to carry the
               brightness instead would make the browser's own smoothing
               interpolate transparency between cells and put a grid of soft
               squares over the sand. */
            data[p + 3] = 255;
            p += 4;
          }
        }
        causCtx.putImageData(causImg, 0, 0);
        return true;
      }

      /* ---------------------------------------------------------------
         Controls.
         --------------------------------------------------------------- */
      function syncBubbleBtn() {
        if (!bubbleBtn) return;
        bubbleBtn.setAttribute('aria-pressed', String(bubblesOn));
        bubbleBtn.title = bubblesOn
          ? 'Air stones are running — click to switch them off'
          : 'Air stones are off — click to switch them on';
      }

      function clampCurrent(v) {
        if (!(v >= 0)) return 0;        // catches NaN as well as negatives
        return v > 1.5 ? 1.5 : v;
      }

      if (fishSel) fishSel.addEventListener('change', function () {
        wantFish = Number(fishSel.value) || 90;
        stock();
      });

      if (mixSel) mixSel.addEventListener('change', function () {
        mixName = MIXES[mixSel.value] ? mixSel.value : 'mixed';
        mix = MIXES[mixName];
        stock();
      });

      if (currentIn) currentIn.addEventListener('input', function () {
        current = clampCurrent(Number(currentIn.value) / 100);
        tank.set('flow', current / 1.5);
      });

      if (lightSel) lightSel.addEventListener('change', function () {
        lightMode = lightSel.value === 'day' || lightSel.value === 'night'
          ? lightSel.value : 'auto';
      });

      if (bubbleBtn) bubbleBtn.addEventListener('click', function () {
        bubblesOn = !bubblesOn;
        syncBubbleBtn();
      });

      /* ---------------------------------------------------------------
         Feeding — the one thing in the tank that happens because somebody
         did something. Everything else here continues whether anyone is
         watching or not, which is the point of an aquarium; a pinch of food
         is the one gesture that makes a tank look back at you.
         --------------------------------------------------------------- */
      function feed(event) {
        var x = W * 0.5;
        var y = SURF + 10;
        /* Space arrives as a keyboard event and has no coordinates; a tap or
           a click arrives from the shell's stage handler with clientX on it.
           Both are real ways to ask for food and neither should be refused,
           so the keyboard drops the pinch in the middle where a hand would
           reach and the pointer drops it exactly where it was pointing. */
        if (event && typeof event.clientX === 'number' && g.canvas) {
          var p = g.pointAt(event);
          x = p.x;
        }
        /* Always dropped just under the surface whatever was tapped. Food
           does not appear in mid-water, and a pinch that materialised beside
           the fish would take the sink out of it — the sink is most of what
           makes a feed worth watching. */
        y = SURF + 10;
        if (x < FRAME + 12) x = FRAME + 12;
        if (x > W - FRAME - 12) x = W - FRAME - 12;

        var n = 8;
        for (var i = 0; i < n && pellets.length < MAX_PELLETS; i++) {
          pellets.push({
            x: x + (Math.random() - 0.5) * 26,
            y: y + Math.random() * 8,
            z: 0.15 + Math.random() * 0.7,
            vx: (Math.random() - 0.5) * 12,
            vy: 4 + Math.random() * 8,
            r: 1.1 + Math.random() * 0.8,
            life: 0
          });
        }
        feedSound();
        /* Said sparingly. The live region is the only report a screen reader
           gets from a toy with no score in it, and a sentence per tap would
           be a page that talks over itself. */
        if (g.gate('feedsay', 4)) g.announce('A pinch of food. The fish are coming up for it.');
      }

      /* ---------------------------------------------------------------
         Bubbles.
         --------------------------------------------------------------- */
      var bubAcc = [0, 0];

      function emit(dt) {
        if (!bubblesOn) return;
        for (var s = 0; s < STONES.length; s++) {
          var st = STONES[s];
          bubAcc[s] += st.rate * dt * (0.6 + current * 0.5);
          while (bubAcc[s] >= 1) {
            bubAcc[s] -= 1;
            if (bubbles.length >= Math.round(MAX_BUBBLES * (0.4 + 0.6 * quality))) break;
            var r = 1.1 + Math.random() * 2.3;
            bubbles.push({
              x: st.x + (Math.random() - 0.5) * 9,
              y: sandY(st.z) - 4,
              z: st.z + (Math.random() - 0.5) * 0.08,
              r: r,
              /* Bigger bubbles rise faster, which is not a stylistic choice
                 — buoyancy grows with the cube of the radius and drag with
                 the square, so it is the one part of this that is simply
                 true. Get it backwards and a column of bubbles looks wrong
                 in a way nobody can name. */
              rise: 42 + r * 15,
              phase: Math.random() * TAU,
              wob: 0.7 + Math.random() * 1.4
            });
          }
        }
      }

      var popSeq = 0;

      function popBubble(b) {
        if (pops.length < 30) {
          pops.push({ x: b.x, z: b.z, r: b.r, life: 0 });
        }
        /* Gated at a fifth of a second. Sixteen bubbles a second reach the
           surface at full flow and a plink for each is a rattle; rain.js
           makes the same trade from the other end, widening its gap as the
           storm thickens until a downpour is a wall with two or three drops
           coming through it. Here the rate is low enough that a fixed gate
           does the job, and the ones it drops were never separable. */
        if (!g.gate('pop', 0.2)) return;
        popSeq++;
        tank.set('pop', { seq: popSeq, r: b.r });
      }

      /* ---------------------------------------------------------------
         One simulation step.
         --------------------------------------------------------------- */
      function hash() {
        var i;
        for (i = 0; i < CELLS; i++) heads[i] = -1;
        for (i = 0; i < fish.length; i++) {
          var f = fish[i];
          var cx = Math.floor(f.x / CELL);
          var cy = Math.floor(f.y / CELL);
          if (cx < 0) cx = 0; else if (cx >= CELLW) cx = CELLW - 1;
          if (cy < 0) cy = 0; else if (cy >= CELLH) cy = CELLH - 1;
          var c = cy * CELLW + cx;
          next[i] = heads[c];
          heads[c] = i;
        }
      }

      /* Food, offered to whoever is near it. Walked from the PELLETS rather
         than from the fish, and that way round matters: there are at most
         forty pellets and up to a hundred and sixty fish, so scanning every
         fish against every pellet is six thousand tests a step and scanning
         nine cells per pellet is a few hundred. The eating is settled here
         too, since the distance has already been paid for. */
      function offerFood(sun) {
        if (!pellets.length) return;
        stamp++;
        var appetite = 0.35 + 0.65 * sun;

        for (var pi = pellets.length - 1; pi >= 0; pi--) {
          var p = pellets[pi];
          var gx = Math.floor(p.x / CELL);
          var gy = Math.floor(p.y / CELL);
          var eaten = false;

          for (var oy = -1; oy <= 1 && !eaten; oy++) {
            for (var ox = -1; ox <= 1 && !eaten; ox++) {
              var nx = gx + ox, ny = gy + oy;
              if (nx < 0 || nx >= CELLW || ny < 0 || ny >= CELLH) continue;
              var idx = heads[ny * CELLW + nx];
              while (idx >= 0) {
                var f = fish[idx];
                idx = next[idx];
                /* Appetite is a coin flip per fish per step rather than a
                   weaker steering force, and that is the honest shape of it:
                   a fish either notices the flake or it does not. At a
                   hundred and twenty steps a second even the night figure
                   still gets a hungry fish onto the food inside a frame or
                   two, while the dozy ones visibly miss it. */
                if (Math.random() > appetite) continue;
                var dx = p.x - f.x, dy = p.y - f.y;
                var dz = (p.z - f.z) * TANKD;
                var d2 = dx * dx + dy * dy + dz * dz;
                var reach = 4 + f.sp.len * 0.3;
                if (d2 < reach * reach) {
                  eaten = true;
                  nip();
                  break;
                }
                if (d2 > 115 * 115) continue;
                /* Only the nearest pellet is worth chasing, and a fish that
                   already has a closer one this step keeps it. Without the
                   comparison a fish between two pellets is handed whichever
                   was checked last and swims at it regardless of distance,
                   which reads as indecision rather than as hunger. */
                if (f.foodStamp === stamp) {
                  var ex = f.fx - f.x, ey = f.fy - f.y;
                  if (ex * ex + ey * ey <= d2) continue;
                }
                f.foodStamp = stamp;
                f.fx = p.x;
                f.fy = p.y;
              }
            }
          }

          if (eaten) pellets.splice(pi, 1);
        }
      }

      function step(dt, sun) {
        var i;

        /* What the light does to the fish. Slower, looser, and lower: a reef
           at night is not a reef with the lamp off, it is a different set of
           behaviours. The three multipliers are the whole of it. */
        var speedK = 0.42 + 0.58 * sun;
        var schoolK = 0.30 + 0.70 * sun;
        var sinkK = (1 - sun) * 0.16;

        /* The flow, AND IT REVERSES. The first version surged between six
           and forty-six units a second and never once changed sign, which
           is what a single powerhead pointed at one end of the tank does —
           and over four minutes it did exactly what that does in a real
           tank, which is pile every fish, every flake and every plant
           against the far glass. A reef tank is run as a gyre for the same
           reason: the flow turns over, so nothing accumulates and the
           corals are not all bent one way. Twenty-eight seconds a turn is
           slow enough to watch happen. */
        var flowX = current * 34 * Math.sin(tt * 0.11);
        var flowY = current * 5 * Math.sin(tt * 0.17 + 1.1);
        /* The plants lean on the same number the fish are swimming in, so
           the tank has one current in it rather than two that agree by
           coincidence. */
        currentLean = flowX / 90;

        hash();
        offerFood(sun);

        for (i = 0; i < fish.length; i++) {
          var f = fish[i];
          var sp = f.sp;
          var sx = 0, sy = 0, sz = 0;
          var ax = 0, ay = 0, az = 0;
          var cx = 0, cy = 0, cz = 0;
          var n = 0;

          var gx = Math.floor(f.x / CELL);
          var gy = Math.floor(f.y / CELL);

          for (var oy = -1; oy <= 1; oy++) {
            for (var ox = -1; ox <= 1; ox++) {
              var nx = gx + ox, ny = gy + oy;
              if (nx < 0 || nx >= CELLW || ny < 0 || ny >= CELLH) continue;
              var idx = heads[ny * CELLW + nx];
              while (idx >= 0) {
                var o = fish[idx];
                idx = next[idx];
                if (o === f) continue;

                var dx = o.x - f.x, dy = o.y - f.y;
                var dz = (o.z - f.z) * TANKD;
                var d2 = dx * dx + dy * dy + dz * dz;

                /* THE TEST THAT MAKES THIS A REEF AND NOT A FLOCK. Same
                   species: a full neighbour, contributing alignment,
                   cohesion and separation. Different species: separation
                   only, and the personal space is this fish's own plus a
                   share of the other one's length, so a tetra gives an
                   angelfish three times the room it gives another tetra. */
                var same = o.spi === f.spi && sp.school > 0;
                if (same && d2 < sp.view * sp.view) {
                  n++;
                  ax += o.vx; ay += o.vy; az += o.vz;
                  cx += o.x; cy += o.y; cz += o.z;
                }

                var room = sp.sep + o.sp.len * 0.35;
                if (d2 < room * room && d2 > 0.01) {
                  var d = Math.sqrt(d2);
                  var push = (1 - d / room) / d;
                  sx -= dx * push;
                  sy -= dy * push;
                  sz -= (o.z - f.z) * push * 12;
                }
              }
            }
          }

          if (n) {
            ax = ax / n - f.vx; ay = ay / n - f.vy; az = az / n - f.vz;
            cx = cx / n - f.x;  cy = cy / n - f.y;  cz = cz / n - f.z;
          }

          var sw = sp.school * schoolK;
          f.vx += (sx * 34 + ax * 1.5 * sw + cx * 0.85 * sw) * dt;
          f.vy += (sy * 34 + ay * 1.5 * sw + cy * 0.85 * sw) * dt;
          f.vz += (sz * 0.9 + az * 1.4 * sw + cz * 0.9 * sw) * dt;

          /* The depth band. One weak spring, and it is what stratifies the
             tank: without it every species mixes into one cloud and the
             stock list stops being visible at all. The target sinks toward
             the sand as the light goes, which is what the fish themselves
             do. */
          var top = SURF + 14;
          var bottom = sandY(f.z) - 8;
          var want = top + Math.min(0.97, f.band + sinkK) * (bottom - top);
          f.vy += (want - f.y) * 0.55 * dt;

          /* Rheotaxis: a fish in a current turns to face it and holds
             station. Two separate things happen here and the first version
             confused them, which is what put fish through the glass.

             The WATER carries the fish, and that is applied to position
             rather than to velocity, because being carried does not change
             how hard a fish is swimming. A strong swimmer is carried less.

             The FISH answers by aiming upstream, and that has to be a
             velocity it RELAXES TOWARD rather than an acceleration applied
             every step. As an acceleration it never saturates: at full
             current it is sixty-odd units a second of thrust with nothing
             to balance it, so fish accumulated a ground speed the wall
             spring could not spend and left the tank at both ends. Written
             as an approach to a target it cannot exceed what a fish can
             actually swim, which is the physical claim being made. */
          var hold = 0.35 + sp.cruise / 90;
          f.vx += (-flowX * hold * 0.9 - f.vx) * 0.9 * dt;
          f.x += flowX * dt * (1 - hold * 0.55);
          f.y += flowY * dt;

          /* Loners have no school to give them a direction, so they get one
             of their own: a heading that turns by a slow random walk. It is
             the cheapest wander there is and it looks like a fish thinking,
             which is more than a straight line ever does. */
          if (sp.school === 0) {
            f.wander += (Math.random() - 0.5) * 1.6 * dt;
            f.vx += Math.cos(f.wander) * 26 * dt;
            f.vy += Math.sin(f.wander) * 9 * dt;
          }

          if (f.foodStamp === stamp) {
            var fdx = f.fx - f.x, fdy = f.fy - f.y;
            var fd = Math.sqrt(fdx * fdx + fdy * fdy);
            if (fd > 0.01) {
              /* Hard enough to override the band spring and most of the
                 cohesion, because a fish that has seen food stops caring
                 where it is meant to be sitting. */
              f.vx += (fdx / fd) * 150 * dt;
              f.vy += (fdy / fd) * 150 * dt;
            }
          }

          /* Glass. A steering force and not a bounce: fish do not ricochet,
             they turn, and they start turning further out the faster they
             are moving. The margin is scaled by the fish's own length, so an
             angelfish turns earlier than a tetra rather than putting its
             nose through the front pane. */
          var m = 26 + sp.len;
          if (f.x < FRAME + m) f.vx += (FRAME + m - f.x) * 8 * dt;
          else if (f.x > W - FRAME - m) f.vx -= (f.x - (W - FRAME - m)) * 8 * dt;
          if (f.y < top) f.vy += (top - f.y) * 9 * dt;
          else if (f.y > bottom) f.vy -= (f.y - bottom) * 9 * dt;
          if (f.z < 0.06) f.vz += (0.06 - f.z) * 2.4 * dt;
          else if (f.z > 0.96) f.vz -= (f.z - 0.96) * 2.4 * dt;

          /* Speed. A floor as well as a ceiling, for the same reason boids
             has one: a fish that stops is not resting, it is a bug, and
             nothing in the steering above can guarantee it never happens. */
          var cruise = sp.cruise * f.rate * speedK;
          var spd = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
          var hi = cruise * 1.9;
          var lo = cruise * 0.35;
          if (spd > hi) { f.vx = f.vx / spd * hi; f.vy = f.vy / spd * hi; spd = hi; }
          else if (spd < lo && spd > 0.01) { f.vx = f.vx / spd * lo; f.vy = f.vy / spd * lo; spd = lo; }
          else if (spd <= 0.01) { f.vx = lo; f.vy = 0; spd = lo; }

          if (f.vz > 0.22) f.vz = 0.22; else if (f.vz < -0.22) f.vz = -0.22;

          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.z += f.vz * dt;

          /* THE GLASS ITSELF, and this is a different claim from the
             steering above. A steering force is a preference, and a
             preference can be overwhelmed — by a current at the top of the
             slider, by a hundred and sixty fish separating out of one
             corner, by a pinch of food dropped against the pane. A headless
             run of four simulated minutes found fish twenty units past the
             frame at both ends, which on screen is a fish swimming out from
             under the trim. So the turn is what you watch and this is what
             is guaranteed: a hard stop at the pane with most of the speed
             taken out of it, which reads as a fish that has bumped the glass
             because that is exactly what has happened. */
          var wall = FRAME + 4 + sp.len * 0.3;
          if (f.x < wall) { f.x = wall; if (f.vx < 0) f.vx *= -0.3; }
          else if (f.x > W - wall) { f.x = W - wall; if (f.vx > 0) f.vx *= -0.3; }
          var lid = SURF + 5;
          var bed = sandY(f.z) - 2;
          if (f.y < lid) { f.y = lid; if (f.vy < 0) f.vy *= -0.3; }
          else if (f.y > bed) { f.y = bed; if (f.vy > 0) f.vy *= -0.3; }

          if (f.z < 0.02) { f.z = 0.02; f.vz = -f.vz * 0.4; }
          else if (f.z > 0.99) { f.z = 0.99; f.vz = -f.vz * 0.4; }

          /* The tail beats at the rate the fish is actually swimming, in
             body lengths a second rather than in units — which is why a
             tetra's tail blurs and an angelfish's barely moves while both
             are crossing the tank at a similar pace. */
          f.phase += (spd / sp.len) * 2.6 * dt;
        }

        /* ---- bubbles ---- */
        emit(dt);
        for (i = bubbles.length - 1; i >= 0; i--) {
          var b = bubbles[i];
          b.phase += b.wob * dt * 3;
          b.y -= b.rise * dt;
          b.x += Math.sin(b.phase) * 9 * dt + flowX * 0.55 * dt;
          if (b.y <= SURF + 2) {
            popBubble(b);
            bubbles.splice(i, 1);
          } else if (b.x < FRAME || b.x > W - FRAME) {
            bubbles.splice(i, 1);
          }
        }

        for (i = pops.length - 1; i >= 0; i--) {
          pops[i].life += dt;
          if (pops[i].life > 0.55) pops.splice(i, 1);
        }

        /* ---- food ---- */
        for (i = pellets.length - 1; i >= 0; i--) {
          var pl = pellets[i];
          pl.life += dt;
          /* Terminal velocity, reached almost at once: a flake is light and
             the water is thick, so it does not accelerate the way a stone
             would. Modelling the drag properly would be one more line and
             would look identical. */
          pl.vy += (16 - pl.vy) * 2.2 * dt;
          pl.vx += (flowX * 0.8 - pl.vx) * 1.5 * dt;
          pl.x += pl.vx * dt;
          pl.y += pl.vy * dt;
          /* Flakes have no opinion about the glass, so theirs is a plain
             stop rather than the bump a fish gets. */
          if (pl.x < FRAME + 3) { pl.x = FRAME + 3; pl.vx = 0; }
          else if (pl.x > W - FRAME - 3) { pl.x = W - FRAME - 3; pl.vx = 0; }
          var floorY = sandY(pl.z) - 2;
          if (pl.y > floorY) { pl.y = floorY; pl.vy = 0; }
          /* Food that reaches the sand dissolves rather than sitting there
             forever. Twelve seconds is long enough for a slow fish to find
             it and short enough that a tank nobody is watching does not
             silently fill up with flakes. */
          if (pl.life > 12) pellets.splice(i, 1);
        }
      }

      /* ---------------------------------------------------------------
         Drawing.
         --------------------------------------------------------------- */

      /* A fish's colour at its depth. Two things at once, and they are
         different things: `lit` is the lamp going out, which takes every
         colour in the tank down together, and the mix toward the haze is
         distance, which desaturates a far fish toward the colour of the
         water in front of it. Do only the second and the tank stays bright
         at midnight; do only the first and it has no depth. */
      function fogged(src, z, lit, out) {
        var t = 0.16 + 0.62 * z;
        out[0] = lerp(src[0] * lit, cHaze[0], t);
        out[1] = lerp(src[1] * lit, cHaze[1], t);
        out[2] = lerp(src[2] * lit, cHaze[2], t);
        return out;
      }

      function byDepth(a, b) { return b.z - a.z; }

      function drawFish(ctx, f, lit, detail) {
        var sp = f.sp;
        var s = scaleAt(f.z);
        var L = sp.len * s;
        var ang = Math.atan2(f.vy, f.vx);

        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(ang);
        /* Rotating a fish through a heading that points left leaves it
           swimming upside down, which is a fish in trouble and not a fish
           going the other way. Flipping the local y axis instead keeps the
           belly down at every heading and costs one comparison. */
        if (f.vx < 0) ctx.scale(1, -1);

        fogged(sp.col, f.z, lit, cBody);
        fogged(sp.fin, f.z, lit, cFin);

        /* The tail, drawn before the body so the body's edge covers the
           joint. It pivots rather than being redrawn: one rotation is
           cheaper than recomputing three points, and a fish's tail really
           does hinge at the wrist. */
        var beat = Math.sin(f.phase);
        ctx.save();
        ctx.translate(-L * 0.44, 0);
        ctx.rotate(beat * 0.5);
        ctx.fillStyle = rgba(cFin, 0.85);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-L * 0.38, -L * 0.26);
        ctx.lineTo(-L * 0.30, 0);
        ctx.lineTo(-L * 0.38, L * 0.26);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (detail) {
          /* The dorsal, leaning back a little with the beat. Off on a slow
             machine: it is four pixels on a tetra and the first thing that
             should go. */
          ctx.fillStyle = rgba(cFin, 0.6);
          ctx.beginPath();
          ctx.moveTo(L * 0.10, -L * 0.16);
          ctx.lineTo(-L * 0.06 - beat * L * 0.05, -L * 0.42);
          ctx.lineTo(-L * 0.22, -L * 0.14);
          ctx.closePath();
          ctx.fill();
        }

        /* The body: two quadratics meeting at nose and tail. A pair of arcs
           would need a save, a scale and a restore per fish; two curves in
           one path is the same silhouette for a third of the calls. */
        ctx.fillStyle = solid(cBody);
        ctx.beginPath();
        ctx.moveTo(-L * 0.46, 0);
        ctx.quadraticCurveTo(0, -L * 0.32, L * 0.52, 0);
        ctx.quadraticCurveTo(0, L * 0.32, -L * 0.46, 0);
        ctx.fill();

        if (detail && sp.stripe) {
          ctx.fillStyle = rgba(cFin, 0.75);
          if (sp.stripe === 1) {
            /* The lateral line a tetra is famous for, and the reason it is
               drawn as a lens rather than as a rectangle: it has to follow
               the body or it hangs off the nose. */
            ctx.beginPath();
            ctx.moveTo(-L * 0.34, 0);
            ctx.quadraticCurveTo(0, -L * 0.13, L * 0.40, -L * 0.02);
            ctx.quadraticCurveTo(0, -L * 0.02, -L * 0.34, 0);
            ctx.fill();
          } else {
            var bars = sp.stripe === 3 ? 3 : 2;
            for (var i = 0; i < bars; i++) {
              var bx = (-0.18 + i * 0.26) * L;
              ctx.fillRect(bx, -L * 0.24, L * 0.07, L * 0.48);
            }
          }
        }

        if (detail && L > 7) {
          ctx.fillStyle = 'rgba(8,14,22,0.8)';
          ctx.beginPath();
          ctx.arc(L * 0.32, -L * 0.05, L * 0.055 + 0.5, 0, TAU);
          ctx.fill();
        }

        ctx.restore();
      }

      function drawPlant(ctx, p, lit) {
        var s = scaleAt(p.z);
        var base = sandY(p.z);
        var segs = quality > 0.55 ? 6 : 4;
        var h = p.h * s / segs;
        /* Sway is amplitude at the tip and nothing at the root, because that
           is where the plant is held. Multiplying by the segment index is
           the cheapest way to say so, and it is why a plant bends rather
           than waving like a flag on a pole. */
        var amp = (0.10 + current * 0.34) * (reduced ? 0.55 : 1);

        var x = p.x;
        var y = base;
        var i, a;

        for (i = 0; i <= segs; i++) {
          var k = i / segs;
          a = p.lean + currentLean + Math.sin(tt * p.rate + p.phase + i * 0.5) * amp * k;
          var w = p.w * s * (1 - k * 0.8);
          pLX[i] = x - Math.cos(a) * w;
          pLY[i] = y - Math.sin(a) * w;
          pRX[i] = x + Math.cos(a) * w;
          pRY[i] = y + Math.sin(a) * w;
          x += Math.sin(a) * h;
          y -= Math.cos(a) * h;
        }

        /* Each plant is its own shade of green. One colour for all of them
           reads as a printed backdrop; the variation is what makes a bank of
           them look planted rather than wallpapered. */
        cTint[0] = cPlant[0] * (0.72 + p.tint * 0.50);
        cTint[1] = cPlant[1] * (0.80 + p.tint * 0.40);
        cTint[2] = cPlant[2] * (0.72 + p.tint * 0.55);
        fogged(cTint, p.z, lit, cBody);

        ctx.fillStyle = solid(cBody);
        ctx.beginPath();
        ctx.moveTo(pLX[0], pLY[0]);
        for (i = 1; i <= segs; i++) ctx.lineTo(pLX[i], pLY[i]);
        for (i = segs; i >= 0; i--) ctx.lineTo(pRX[i], pRY[i]);
        ctx.closePath();
        ctx.fill();
      }

      function drawRock(ctx, r, lit) {
        var base = sandY(r.z);
        var amp = r.z * r.z * 2.4 * (0.35 + current * 0.65) * (reduced ? 0.5 : 1);
        var i;

        fogged(ROCK, r.z, lit, cDark);
        ctx.fillStyle = solid(cDark);
        ctx.beginPath();
        ctx.moveTo(r.x + r.pts[0].dx + wob(base, amp), base + 4);
        for (i = 0; i < r.pts.length; i++) {
          var py = base + r.pts[i].dy;
          ctx.lineTo(r.x + r.pts[i].dx + wob(py, amp), py);
        }
        ctx.lineTo(r.x + r.pts[r.pts.length - 1].dx + wob(base, amp), base + 4);
        ctx.closePath();
        ctx.fill();

        /* A rim of light on the top edge, from the lamp above. It is the
           only thing that stops a rock being a hole cut in the water. */
        fogged(ROCK_RIM, r.z, lit, cTint);
        ctx.strokeStyle = rgba(cTint, (0.32 * (0.25 + 0.75 * sun)).toFixed(3));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (i = 0; i < r.pts.length; i++) {
          var qy = base + r.pts[i].dy;
          var qx = r.x + r.pts[i].dx + wob(qy, amp);
          if (i === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
        }
        ctx.stroke();
      }

      function drawBubbles(ctx, front) {
        for (var i = 0; i < bubbles.length; i++) {
          var b = bubbles[i];
          if ((b.z < 0.45) !== front) continue;
          var s = scaleAt(b.z);
          var r = b.r * s;
          var a = 0.30 + 0.34 * (1 - b.z);
          ctx.strokeStyle = 'rgba(226,244,255,' + (a * (0.3 + 0.7 * sun)).toFixed(3) + ')';
          ctx.lineWidth = Math.max(0.6, r * 0.36);
          ctx.beginPath();
          ctx.arc(b.x, b.y, r, 0, TAU);
          ctx.stroke();
          if (r > 1.6) {
            /* The glint. A bubble is a lens and the light is above it, so
               the highlight is always up and slightly to the same side.
               Without it a bubble is an O. */
            ctx.fillStyle = 'rgba(255,255,255,' + (a * 0.9).toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(b.x - r * 0.3, b.y - r * 0.35, r * 0.24, 0, TAU);
            ctx.fill();
          }
        }
      }

      /* ---------------------------------------------------------------
         The adaptive quality. What gives is the DETAIL, never the fish:
         the stock list is a number the visitor chose and the HUD publishes,
         so quietly thinning it would make the page lie. What goes instead
         is the caustic resolution, the dorsal fins, the stripes, the eyes,
         two segments off every plant, and the bubble ceiling — none of
         which anybody can count.
         --------------------------------------------------------------- */
      function adapt(work, gap) {
        if (gap > 0 && gap < 100) gapMs += (gap - gapMs) * 0.1;
        workMs += (work - workMs) * 0.1;
        frames++;
        if (frames < 30) return;      // decide twice a second, not sixty times
        frames = 0;
        if (gapMs > 20) quality = Math.max(0.2, quality - 0.09);
        else if (workMs < 4.5) quality = Math.min(1, quality + 0.05);
      }

      return {
        reset: function () {
          if (fishSel) wantFish = Number(fishSel.value) || 90;
          if (mixSel && MIXES[mixSel.value]) mixName = mixSel.value;
          mix = MIXES[mixName];
          /* Through the same clamp the slider's own handler uses. An empty
             or non-numeric range value gives NaN, and a NaN current poisons
             every position it touches inside two frames — a tank of fish at
             coordinate NaN draws nothing at all, from one unguarded read. */
          if (currentIn) current = clampCurrent(Number(currentIn.value) / 100);
          if (lightSel) {
            lightMode = lightSel.value === 'day' || lightSel.value === 'night'
              ? lightSel.value : 'auto';
          }
          if (bubbleBtn) bubblesOn = bubbleBtn.getAttribute('aria-pressed') !== 'false';
          syncBubbleBtn();

          bubbles = [];
          pellets = [];
          pops = [];
          bubAcc[0] = 0;
          bubAcc[1] = 0;
          tt = 0;
          dayT = CYCLE * 0.18;
          sun = lightMode === 'night' ? 0 : 1;
          lightWord = '';

          if (!plants.length) scape();
          stock();
          tank.set('flow', current / 1.5);
          tank.set('fizz', 0);
        },

        key: function (name, event) {
          if (name === 'action') feed(event);
        },

        update: function (dt) {
          var k = reduced ? 0.5 : 1;
          tt += dt * k;

          /* The light. Auto runs the trapezoid below; Day and Night are
             targets the light EASES toward rather than jumps to, because a
             tank whose lamp cuts on a dropdown change is a tank with a
             switch in it, and the point of the whole cycle is that the
             change is something you notice having happened rather than
             something you see happen. */
          var want;
          if (lightMode === 'day') want = 1;
          else if (lightMode === 'night') want = 0;
          else {
            dayT += dt * k;
            var p = (dayT % CYCLE) / CYCLE;
            /* Dawn over an eighth of the cycle, dusk over the same, and
               more day than night — which is both what a lit tank gets and
               what a visitor came to look at. */
            want = smooth(p, 0.02, 0.16) * (1 - smooth(p, 0.50, 0.64));
          }
          var before = sun;
          sun += (want - sun) * Math.min(1, 0.55 * dt);
          sunVel = sun - before;

          step(dt, sun);

          /* The bed follows the water rather than the button — see the
             'fizz' handler. Recomputed four times a second because every
             set() below ends in a ramp on an AudioParam, and scheduling
             those at the step rate costs more than the simulation that
             feeds them while sounding identical. */
          sndAcc += dt;
          if (sndAcc >= 0.25) {
            sndAcc = 0;
            tank.set('fizz', bubbles.length / 90);
          }

          /* The HUD, written only when the word changes. The alternative is
             a DOM write a hundred and twenty times a second for a string
             that changes four times in three and a half minutes. */
          var word;
          if (sun > 0.88) word = 'Daylight';
          else if (sun < 0.08) word = 'Night';
          else word = sunVel >= 0 ? 'Dawn' : 'Dusk';
          if (word !== lightWord) {
            lightWord = word;
            g.stat('light', word);
          }
        },

        draw: function (ctx) {
          var t0 = perfNow();
          var i;

          /* Every colour in the frame comes off the same crossfade, so
             there is exactly one place the time of day is decided and
             nothing in the picture can disagree with anything else. */
          mixCol(NIGHT.top, DAY.top, sun, cTop);
          mixCol(NIGHT.deep, DAY.deep, sun, cDeep);
          mixCol(NIGHT.haze, DAY.haze, sun, cHaze);
          mixCol(NIGHT.back, DAY.back, sun, cBack);
          mixCol(NIGHT.sand, DAY.sand, sun, cSand);
          mixCol(NIGHT.plant, DAY.plant, sun, cPlant);
          mixCol(NIGHT.caustic, DAY.caustic, sun, cCaus);
          causK = lerp(NIGHT.causticK, DAY.causticK, sun);
          var lit = 0.26 + 0.74 * sun;
          var detail = quality > 0.5;

          /* ---- the water ---- */
          var water = ctx.createLinearGradient(0, SURF, 0, H);
          water.addColorStop(0, solid(cTop));
          water.addColorStop(1, solid(cDeep));
          ctx.fillStyle = water;
          ctx.fillRect(0, 0, W, H);

          /* ---- the back glass ---- */
          ctx.fillStyle = solid(cBack);
          ctx.fillRect(0, SURF, W, SAND_FAR - SURF + 6);

          for (i = 0; i < rocks.length; i++) {
            if (rocks[i].z < 0.5) continue;
            drawRock(ctx, rocks[i], lit);
          }

          /* ---- the sand ---- */
          var sandGrad = ctx.createLinearGradient(0, SAND_FAR, 0, H);
          sandGrad.addColorStop(0, rgba(cSand, 0.55));
          sandGrad.addColorStop(0.35, solid(cSand));
          sandGrad.addColorStop(1, rgba([cSand[0] * 0.72, cSand[1] * 0.72, cSand[2] * 0.78], 1));
          ctx.fillStyle = sandGrad;
          ctx.beginPath();
          /* The far edge of the sand ripples, because it is the furthest
             thing in the tank and therefore the most refracted. The near
             edge does not, because there is no water between it and you. */
          ctx.moveTo(0, SAND_FAR + wob(SAND_FAR, 2.6 * (0.4 + current * 0.6)));
          for (var sxp = 40; sxp <= W; sxp += 40) {
            ctx.lineTo(sxp, SAND_FAR + wob(SAND_FAR + sxp * 0.35, 2.6 * (0.4 + current * 0.6)));
          }
          ctx.lineTo(W, H);
          ctx.lineTo(0, H);
          ctx.closePath();
          ctx.fill();

          /* ---- caustics ---- */
          if (causK > 0.02 && fillCaustic(causK * (0.55 + current * 0.25))) {
            ctx.globalCompositeOperation = 'lighter';
            /* Stretched from a buffer a twentieth of the size, and the
               browser's own bilinear smoothing does the blurring for
               nothing. A caustic net drawn at full resolution would be
               sharp, which is the one thing light through moving water
               never is. */
            ctx.drawImage(causCv, 0, SAND_FAR - 10, W, H - SAND_FAR + 10);
            /* The same field on the back wall, dimmer and taller: the light
               that reaches the sand also lands on the glass behind it, and
               a tank where only the floor is lit looks like a stage. */
            ctx.globalAlpha = 0.4;
            ctx.drawImage(causCv, 0, SURF + 30, W, SAND_FAR - SURF - 20);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
          }

          for (i = 0; i < rocks.length; i++) {
            if (rocks[i].z >= 0.5) continue;
            drawRock(ctx, rocks[i], lit);
          }

          /* ---- planting, fish, planting again ---- */
          for (i = 0; i < plants.length; i++) {
            if (plants[i].z < 0.45) continue;
            drawPlant(ctx, plants[i], lit);
          }

          drawBubbles(ctx, false);

          for (i = 0; i < pellets.length; i++) {
            var pl = pellets[i];
            var ps = scaleAt(pl.z);
            fogged(FLAKE, pl.z, lit, cBody);
            ctx.fillStyle = solid(cBody);
            ctx.beginPath();
            ctx.arc(pl.x, pl.y, pl.r * ps, 0, TAU);
            ctx.fill();
          }

          /* Painter's algorithm, and the array itself is what gets sorted.
             Sorting an array of indices instead would allocate one every
             frame for no gain: nothing outside this function holds a fish
             by its position, because the spatial hash is rebuilt from
             scratch on every step. */
          fish.sort(byDepth);
          for (i = 0; i < fish.length; i++) drawFish(ctx, fish[i], lit, detail);

          for (i = 0; i < plants.length; i++) {
            if (plants[i].z >= 0.45) continue;
            drawPlant(ctx, plants[i], lit);
          }

          drawBubbles(ctx, true);

          /* ---- the surface ---- */
          for (i = 0; i < pops.length; i++) {
            var po = pops[i];
            var pk = po.life / 0.55;
            var pr = (2 + po.r * 5 * pk) * scaleAt(po.z);
            ctx.strokeStyle = 'rgba(214,240,255,' + ((1 - pk) * 0.5).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.save();
            ctx.translate(po.x, SURF + 3);
            /* Squashed hard, because the surface is seen almost edge on: a
               ring spreading on it is a very flat ellipse, not a circle. */
            ctx.scale(1, 0.22);
            ctx.beginPath();
            ctx.arc(0, 0, pr, 0, TAU);
            ctx.stroke();
            ctx.restore();
          }

          var swell = 2.2 + current * 2.4 + bubbles.length * 0.006;
          if (reduced) swell *= 0.55;
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(' +
            Math.round(120 + 90 * sun) + ',' +
            Math.round(180 + 60 * sun) + ',' +
            Math.round(200 + 45 * sun) + ',' + (0.05 + 0.09 * sun).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(0, SURF + 16);
          for (var wx = 0; wx <= W; wx += 16) {
            ctx.lineTo(wx, SURF + Math.sin(wx * 0.035 + tt * 1.7) * swell +
              Math.sin(wx * 0.011 - tt * 1.1) * swell * 0.7);
          }
          ctx.lineTo(W, SURF + 16);
          ctx.closePath();
          ctx.fill();
          ctx.globalCompositeOperation = 'source-over';

          /* Above the waterline is air, not water, so it is painted over
             rather than tinted. It is also where the lamp is. */
          var air = ctx.createLinearGradient(0, 0, 0, SURF + 4);
          air.addColorStop(0, 'rgb(' +
            Math.round(10 + 26 * sun) + ',' +
            Math.round(12 + 30 * sun) + ',' +
            Math.round(18 + 32 * sun) + ')');
          air.addColorStop(1, rgba(cTop, 0.9));
          ctx.fillStyle = air;
          ctx.fillRect(0, 0, W, SURF + 2);

          /* ---- the front glass ---- */
          /* A sheen down one pane and a vignette in the corners. Both are
             very faint on purpose: the job of the front glass is to be
             noticed once and then forgotten, and anything stronger reads as
             a filter over the picture rather than as something the picture
             is behind. */
          var sheen = ctx.createLinearGradient(90, SURF, 260, H);
          sheen.addColorStop(0, 'rgba(255,255,255,0)');
          sheen.addColorStop(0.5, 'rgba(255,255,255,' + (0.020 + 0.018 * sun).toFixed(3) + ')');
          sheen.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = sheen;
          ctx.fillRect(0, SURF, W, H - SURF);

          var vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
          vig.addColorStop(0, 'rgba(0,0,0,0)');
          vig.addColorStop(1, 'rgba(0,0,0,0.36)');
          ctx.fillStyle = vig;
          ctx.fillRect(0, 0, W, H);

          ctx.strokeStyle = 'rgba(120,140,160,0.30)';
          ctx.lineWidth = FRAME;
          ctx.strokeRect(FRAME / 2, FRAME / 2, W - FRAME, H - FRAME);
          ctx.strokeStyle = 'rgba(8,12,18,0.85)';
          ctx.lineWidth = 2;
          ctx.strokeRect(FRAME + 1, FRAME + 1, W - FRAME * 2 - 2, H - FRAME * 2 - 2);

          var now = perfNow();
          adapt(now - t0, lastFrame ? t0 - lastFrame : 0);
          lastFrame = t0;
        }
      };
    }
  });
})();

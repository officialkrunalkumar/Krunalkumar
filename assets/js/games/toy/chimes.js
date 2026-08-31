/* ==========================================================================
   chimes.js — a wind chime, simulated rather than sampled.
   --------------------------------------------------------------------------
   Every other toy in this section is something to look at. This one is
   something to listen to, and the picture is there to explain the sound.
   The whole file turns on one relationship: a chime tube's pitch comes out
   of its LENGTH, and nothing else here is allowed to decide it.

   For the fundamental bending mode of a thin free-free tube,

       f1  =  (pi / 8) * m1^2 * (K / L^2) * sqrt(E / rho)

   with m1 = 3.0112, K the radius of gyration of the wall and sqrt(E/rho)
   the bar speed of the metal. Two things fall out of that and both are
   audible here. Pitch goes as one over length SQUARED, so halving a tube
   raises it two octaves rather than one — which is why the size slider
   moves the whole chime so violently. And the pitch depends on the
   material only through sqrt(E/rho), so a brass tube tuned to the same
   note as an aluminium one comes out visibly shorter.

   It is the IDEAL thin-tube approximation, and it is worth saying plainly
   that real chimes are not tuned with it. A real tube has a wall thick
   enough to matter, a suspension hole through it and often a cap on the
   end, so the formula lands a few per cent out; a maker cuts long and then
   trims by ear against a tuner. What the formula is honest about is the
   SHAPE of the relationship, which is the part a visitor can hear.

   The physics that decides WHEN a tube sounds is separate and just as
   real. Each tube, the clapper and the wind sail are spherical pendulums
   in the horizontal plane, integrated at the shell's fixed 1/120 s, with
   quadratic drag against a wind that gusts. Contact between the clapper
   disc and a tube is a circle-circle test, resolved as an impulse; the
   normal component of the closing speed is what sets how hard the note is
   struck. Nothing schedules a note. The weather does.

   Three simplifications I would rather name than hide. A real chime is one
   string running through the clapper with the sail below it, which is a
   double pendulum and therefore chaotic in a way that would be a different
   toy; here the clapper and the sail hang separately from the same point
   and are tied together by a stiff spring, which keeps the thing that
   matters — the sail catches the wind and drags the clapper into the
   tubes. The wind's HEADING is bent toward the plane of the screen, though
   never its speed, because a chime blown directly away from the viewer is
   a chime you cannot see moving. And that heading veers round the compass
   in a couple of minutes rather than over an afternoon, because a wind
   that keeps one bearing plays two notes of a six-note chime and leaves
   the rest alone. The first is a modelling shortcut; the other two are
   the toy beating the meteorology, and they are marked as such where they
   happen.

   SOUND IS THE POINT OF THIS ONE, and it is in two halves, which is
   exactly the split the shell header describes. Wind is a CONDITION: it
   does not happen, it continues, so it is a bed whose band and gain follow
   the instantaneous wind speed and swell with every gust. A strike is an
   EVENT: four inharmonic partials at 1 : 2.76 : 5.40 : 8.93 with their own
   decay times, the high ones dying first, plus a few milliseconds of
   filtered noise for the wood hitting the metal.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  var W = 640;
  var H = 480;

  /* ------------------------------------------------------------------
     Units. One logical unit is 2 mm, which makes the frame 1.28 m wide
     and puts a 60 cm tube at 300 units — a real chime at a sensible size
     on the canvas. Everything below is in logical units and seconds, and
     the two conversions live here so no other line has to think about it.
     ------------------------------------------------------------------ */
  var MM = 2;                        // millimetres per logical unit
  var G = 9810 / MM;                 // gravity, 4905 units/s^2

  /* Radius of gyration of the tube wall, in METRES, for the 25.4 mm tube
     with a 1.6 mm wall that most chime sets are cut from:
     K = sqrt(a^2 + b^2) / 2 over the outer and inner radii. Every tube in
     a set shares one diameter and differs only in length, which is what
     makes f proportional to 1/L^2 exactly rather than approximately. */
  var KGYR = 0.008434;

  /* (pi / 8) * m1^2 with m1 = 3.0112, the first free-free bending mode. */
  var BAR = (Math.PI / 8) * 3.0112 * 3.0112;

  /* Mode numbers for the first four free-free bending modes. The ratios
     between them are GEOMETRY, not material: 5^2/3.0112^2 = 2.756, and so
     on. A chime does not sound like a flute because those are nowhere near
     2, 3, 4. */
  var MODES = [3.0112, 5, 7, 9];

  /* ------------------------------------------------------------------
     Materials.

     What a material honestly changes is smaller than a dropdown suggests,
     and worth being straight about. It changes sqrt(E/rho), which sets the
     length needed for a given note. It changes the damping, which sets how
     long the note rings. It does NOT change the ratios between the
     partials, because those come from the shape of the bar. The stretch
     value below is a small upward drift on the high partials, standing in
     for the ways a real thick-walled tube departs from the ideal thin
     bar — a real effect, and one that shows in the upper modes first.

     The three speeds that are nearly equal are not a mistake. Aluminium,
     glass and bamboo have very different stiffness and very different
     density, and the ratio of the two comes out within a few per cent of
     5000 m/s for all three. Brass is the odd one, and it is the only
     material here whose tubes are a visibly different length.
     ------------------------------------------------------------------ */
  /* The dens field is kilograms per metre of tube at this diameter and
     wall: the wall cross-section, 1.196e-4 square metres, times the
     density — 2700 for aluminium, 8500 for brass, 2500 for glass and
     about 750 for bamboo. It is the only place a density appears, and
     both the mass and the drag are taken from it. */
  var MATERIALS = [
    { id: 'aluminium', name: 'Aluminium', c: 5055, dens: 0.323, decay: 5.4,
      stretch: 0.006, bright: 1.00, knock: 0.020, chiff: 2600,
      tint: '#b9c6d6', edge: '#f1f5f9' },
    { id: 'brass', name: 'Brass', c: 3430, dens: 1.017, decay: 3.4,
      stretch: 0.011, bright: 0.80, knock: 0.024, chiff: 1900,
      tint: '#c2a04c', edge: '#f5e0a3' },
    { id: 'glass', name: 'Glass', c: 5292, dens: 0.299, decay: 2.0,
      stretch: 0.017, bright: 1.18, knock: 0.018, chiff: 3800,
      tint: '#7fc9e8', edge: '#e0f6ff' },
    { id: 'bamboo', name: 'Bamboo', c: 4899, dens: 0.090, decay: 0.42,
      stretch: 0.030, bright: 0.40, knock: 0.055, chiff: 1150,
      tint: '#a4874f', edge: '#dcc48d' }
  ];

  /* Partial ratios and per-partial peak gains, worked out once per
     material rather than per strike. The gain curve falls away steeply
     because a struck tube puts most of its energy in the fundamental, and
     the brightness factor tilts the whole series, which is most of what
     tells brass from glass by ear. */
  var i, j;
  for (i = 0; i < MATERIALS.length; i++) {
    var m = MATERIALS[i];
    m.ratios = [];
    m.gains = [];
    for (j = 0; j < MODES.length; j++) {
      var r = (MODES[j] * MODES[j]) / (MODES[0] * MODES[0]);
      m.ratios.push(r * (1 + m.stretch * j));
      m.gains.push([1, 0.55, 0.30, 0.14][j] * Math.pow(m.bright, j));
    }
  }

  /* ------------------------------------------------------------------
     Tunings.

     A pentatonic scale contains no semitone and no tritone, so ANY two of
     its notes sounded together are at worst a whole tone apart and none of
     them beat against each other — which is the whole argument for it on
     an instrument whose playing order is decided by the weather rather
     than by a person. Major has a semitone in it (the fourth against the
     third, the seventh against the octave) and you can hear the pair
     collide when a gust takes both. Bhairav is included precisely because
     it is the awkward case: two semitones and two augmented seconds, a
     scale built for a melodic line with a direction, being struck here at
     random.
     ------------------------------------------------------------------ */
  var TUNINGS = [
    { id: 'pentatonic', name: 'Pentatonic', steps: [0, 2, 4, 7, 9, 12, 14, 16] },
    { id: 'major', name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11, 12] },
    { id: 'raga', name: 'Raga Bhairav', steps: [0, 1, 4, 5, 7, 8, 11, 12] }
  ];

  var ROOT = 392.0;                  // G4, the longest tube at size 100

  var NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯',
               'G', 'G♯', 'A', 'A♯', 'B'];

  /* The nearest equal-tempered name for a frequency. Nearest, and said to
     be nearest: move the size slider and the chime is no longer at concert
     pitch, which is exactly what a tube cut a little long does. */
  function noteName(f) {
    var n = Math.round(12 * Math.log(f / 440) / Math.LN2);
    var idx = ((n + 9) % 12 + 12) % 12;
    var oct = 4 + Math.floor((n + 9) / 12);
    return NOTES[idx] + oct;
  }

  /* Beaufort, because it already exists and already has the words. The
     wind readout is text for the same reason the tubes carry labels: a
     shade of grey on a moving line is not a fact anybody can read. */
  function beaufort(ms) {
    if (ms < 0.3) return 'Calm';
    if (ms < 1.6) return 'Light air';
    if (ms < 3.4) return 'Light breeze';
    if (ms < 5.5) return 'Gentle breeze';
    if (ms < 8.0) return 'Moderate';
    if (ms < 10.8) return 'Fresh';
    return 'Strong';
  }

  /* Geometry of the frame. TOPY is the underside of the beam, SLEN the
     string from the beam to the suspension hole.

     THE HOLE IS AT 0.224 OF THE LENGTH FROM THE TOP, and that number is
     not decoration. It is where the fundamental bending mode has a node,
     so a string through it holds the tube up without damping the one mode
     the tube exists to produce. Drill in the middle instead and the note
     dies in your hand. It is drawn where it is calculated. */
  var TOPY = 54;
  var SLEN = 82;
  var NODE = 0.2242;
  var RT = 6.35;                     // tube outer radius, 12.7 mm

  /* The clapper is a SMALL disc with room to swing, not a plate that fills
     the ring, and getting that wrong was the most expensive mistake in
     this file. A disc sized to nearly touch the tubes can only ever creep
     the last few millimetres into one, so every contact came out as a
     press rather than a strike and the whole thing ground quietly along in
     a wind that should have been deafening. A real clapper is about half
     the ring radius across and has three or four centimetres of free air
     to cross first, and the speed it picks up crossing that gap IS the
     loudness of the note. */
  var CLAP = 0.55;                   // clapper radius as a fraction of the ring

  GameShell.define({
    id: 'game-chimes',
    slug: 'chimes',
    title: 'Wind chimes',
    width: W,
    height: H,
    bestKey: null,
    bestOrder: 'high',
    tapKey: 'action',
    autoStart: true,
    pauseOnBlur: false,
    /* The canvas is the wind: a drag on it blows on the tubes, and a tap
       is a puff at that spot. Both are handled here, so the shell's own
       tap-to-act would only fire a second, duller version of the same
       gesture. */
    tapAction: false,

    setup: function (g) {
      var CX = W / 2;

      var tubes = [];
      var clapper = null;
      var sail = null;

      var nTubes = 6;
      var tuning = TUNINGS[0];
      var mat = MATERIALS[0];
      var sizePct = 100;

      var windSet = 35;              // the slider, 0..100
      var gustSet = 45;              // the slider, 0..100
      var strikes = 0;
      var seq = 0;
      var lastBand = '';
      var booted = false;

      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      /* Wind state. gp1 to gp4 are the phases of four sines running from
         one cycle in five seconds to three a second, and walk is a
         mean-reverting random walk on top of them. Real gust spectra are
         roughly 1/f across this band; four incommensurate sines plus a
         walk is a cheap stand-in for that and is not claimed to be more.
         What it gets right is the shape a chime responds to: long lulls,
         and gusts that arrive rather than fade in. */
      var gp1 = Math.random() * 6.283;
      var gp2 = Math.random() * 6.283;
      var gp3 = Math.random() * 6.283;
      var gp4 = Math.random() * 6.283;
      var walk = 0;
      var wa = Math.random() * 6.283;             // which way it is blowing
      var windX = 0, windZ = 0, windSpeed = 0;
      var gustT = 0, gustX = 0, gustZ = 0;

      /* The pointer, as a local wind. */
      var breath = { x: 0, y: 0, vx: 0, vz: 0, t: 0 };
      var lastPt = null;
      var lastT = 0;
      var dragging = false;

      var sndAcc = 0;
      var sentWind = -1;

      var windIn = document.getElementById('game-wind');
      var gustIn = document.getElementById('game-gust');
      var tubeSel = document.getElementById('game-tubes');
      var tuneSel = document.getElementById('game-tuning');
      var matSel = document.getElementById('game-material');
      var sizeIn = document.getElementById('game-size');

      /* ---------------------------------------------------------------
         The sound.

         One bed holds BOTH halves, and that is deliberate rather than
         lazy. The wind layer has to be held, so it has to be a bed. The
         strikes are one-shots and could have gone through g.pluck, but
         they are built here instead for two reasons. A struck tube is four
         partials that must live and die together, and booking four
         separate slots against the shell's voice ceiling would strip
         partials off a single strike and turn one chime into a
         different instrument. And a sound built inside the bed hangs off
         the bed bus, which the shell already fades to nothing when the
         game is muted, paused, or in a tab nobody is looking at — a chime
         still ringing out of a background tab is precisely the thing that
         gets a page closed.
         --------------------------------------------------------------- */
      var air = g.bed(function (a) {
        var ac = a.ctx;
        var noise = a.noise();

        /* WIND. Bandpassed noise, broad rather than resonant: push the Q
           much past 1 and moving air becomes a whistle, which is a gale
           through a gap rather than a gale. Both the centre and the gain
           follow the instantaneous speed, so a gust is heard as brightening
           as well as swelling — a wind that only gets louder reads as
           someone turning a knob. */
        var src = ac.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        var band = ac.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 460;
        band.Q.value = 0.75;
        var wg = ac.createGain();
        wg.gain.value = 0;
        src.connect(band);
        band.connect(wg);
        wg.connect(a.out);
        src.start();

        /* A breath across the band centre, one cycle every fourteen
           seconds. The simulation's own gusts are the big movement; this is
           underneath them, and it exists because a held noise band with
           nothing moving in it stops being heard at all within about ten
           seconds however loud it is. */
        var lfo = ac.createOscillator();
        var lfoDepth = ac.createGain();
        lfo.frequency.value = 0.07;
        lfoDepth.gain.value = 70;
        lfo.connect(lfoDepth);
        lfoDepth.connect(band.frequency);
        lfo.start();

        /* Strikes go through their own gain so the whole set can sit under
           the wind without touching either half separately. */
        var hits = ac.createGain();
        hits.gain.value = 0.8;
        hits.connect(a.out);

        /* My own voice count rather than the shell's. See the note above:
           a strike is one event made of five nodes, and it has to be
           accepted or refused as one. Sixteen ringing tubes is already more
           than a real chime can have going at once. */
        var voices = 0;
        var MAXV = 16;

        /* A bed remembers the LAST value set for each key and replays it
           the moment its nodes are built, which is the first time the
           visitor unmutes. For the wind that is exactly right. For a strike
           it would fire a note that happened minutes ago, so the first
           replayed strike after the nodes appear is dropped. Same guard the
           fireworks bed carries, for the same reason. */
        var warm = false;

        function ramp(param, value, secs) {
          var now = ac.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.3 : secs));
        }

        function strike(v) {
          if (voices >= MAXV) return;
          var mt = MATERIALS[v.m];
          var now = ac.currentTime;

          /* How long the nodes are kept, not how fast the tube damps. The
             decay CONSTANT is the material's and does not change; a softer
             strike simply starts lower and reaches the noise floor sooner,
             so there is nothing left to keep alive. */
          var life = mt.decay * (0.45 + 0.55 * v.amp);
          voices++;
          setTimeout(function () { voices--; }, (life + 0.25) * 1000);

          var out = ac.createGain();
          out.gain.value = 1;
          out.connect(hits);

          for (var k = 0; k < mt.ratios.length; k++) {
            var f = v.f * mt.ratios[k];
            if (f > 15000) continue;          // above the speaker and the ear
            var osc = ac.createOscillator();
            osc.type = 'sine';
            /* A tenth of a per cent of detune per strike. A tube struck
               twice in the same place really does not repeat exactly, and
               without this the second hit reads as the first one being
               replayed from a buffer. */
            osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.002);
            var gn = ac.createGain();
            var peak = v.amp * mt.gains[k] * 0.045;
            if (peak < 0.00012) continue;
            /* THE HIGH PARTIALS DIE FIRST, and that is the single detail
               that separates a chime from an organ chord. Damping in a
               metal bar rises with frequency, so the ninth-mode partial at
               nearly nine times the fundamental is gone in a fraction of
               the time. The exponent is fitted by ear rather than measured,
               which is the honest description of it. */
            var dcy = life / Math.pow(mt.ratios[k], 0.82);
            if (dcy < 0.05) dcy = 0.05;
            gn.gain.setValueAtTime(0.0001, now);
            gn.gain.exponentialRampToValueAtTime(peak, now + 0.003);
            gn.gain.exponentialRampToValueAtTime(0.0001, now + dcy);
            osc.connect(gn);
            gn.connect(out);
            osc.start(now);
            osc.stop(now + dcy + 0.03);
          }

          /* The clapper arriving. Thirty milliseconds of bandpassed noise,
             which is wood hitting metal before the metal has decided what
             note it is. Bamboo gets most of its character from this rather
             than from the partials, which is what a bamboo chime actually
             sounds like. */
          var ns = ac.createBufferSource();
          ns.buffer = noise;
          var nf = ac.createBiquadFilter();
          nf.type = 'bandpass';
          nf.frequency.value = mt.chiff * (0.9 + Math.random() * 0.2);
          nf.Q.value = 1.1;
          var ng = ac.createGain();
          ng.gain.setValueAtTime(0.0001, now);
          ng.gain.exponentialRampToValueAtTime(v.amp * mt.knock + 0.0002, now + 0.002);
          ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
          ns.connect(nf);
          nf.connect(ng);
          ng.connect(out);
          var span = noise.duration - 0.1;
          ns.start(now, span > 0 ? Math.random() * span : 0, 0.06);
          ns.stop(now + 0.07);
        }

        return {
          set: function (key, value) {
            if (key === 'strike') {
              /* A suspended context has a stopped clock and everything
                 booked against it piles up at one instant. Nothing is
                 scheduled ahead here, but a muted page has no reason to
                 build nodes at all. */
              if (ac.state !== 'running') return;
              if (!warm) { warm = true; if (value.seq > 0) return; }
              strike(value);
              return;
            }
            if (key === 'wind') {
              /* value is 0..1, the instantaneous speed against the top of
                 the slider's range rather than against the slider itself —
                 so a gust in a light breeze is audibly a gust. */
              ramp(wg.gain, value <= 0.002 ? 0 : 0.004 + value * 0.055, 0.25);
              ramp(band.frequency, 380 + value * 1450, 0.4);
            }
          }
        };
      });

      /* ---------------------------------------------------------------
         Building the chime.

         The order here is the whole argument of the toy: a note is chosen,
         a LENGTH is worked out from it, and from then on the length is the
         only thing consulted. The frequency that eventually sounds is
         computed back out of the length, so moving the size slider or
         changing the material cannot leave the drawing and the sound
         disagreeing — there is only one number and it is on screen.
         --------------------------------------------------------------- */
      function lengthFor(f, c) {
        /* metres, from f = BAR * K * c / L^2 */
        return Math.sqrt(BAR * KGYR * c / f);
      }

      function freqOf(units, c) {
        var Lm = units * MM / 1000;
        return BAR * KGYR * c / (Lm * Lm);
      }

      /* A 22 cm ring for six tubes, a little wider for eight. Real chimes
         sit around this; the frame looks empty either side of it because a
         wind chime really is far taller than it is wide. */
      function ringRadius(n) {
        return 40 + n * 2.5;
      }

      function build() {
        /* Carry the swing across a rebuild. The size slider rebuilds every
           tube on every pixel of the drag, and starting each new set from
           dead rest made the whole chime snap to a standstill while you
           were dragging — a control that appears to break the thing it is
           adjusting. Where an index still exists, its motion moves over. */
        var was = tubes;
        tubes = [];
        var R = ringRadius(nTubes);
        var scale = sizePct / 100;
        for (var k = 0; k < nTubes; k++) {
          var semis = tuning.steps[k];
          /* Ask for more tubes than a scale has degrees and it carries on
             into the next octave rather than handing NaN to a square root
             and drawing a tube of no length at all. Nothing in the toolbar
             can reach that today; it is one line against a scale being
             shortened later by somebody who has no reason to look here. */
          if (semis == null) {
            semis = tuning.steps[k % tuning.steps.length] +
                    12 * Math.floor(k / tuning.steps.length);
          }
          var want = ROOT * Math.pow(2, semis / 12);
          /* Metres to units, then scaled by the size slider. The slider
             stretches the tube; the pitch below is then whatever that
             length gives, which is a quarter of the note for a doubled
             length rather than half of it. */
          var len = (lengthFor(want, mat.c) * 1000 / MM) * scale;
          var phi = (k / nTubes) * Math.PI * 2 - Math.PI / 2;
          var f = freqOf(len, mat.c);
          /* The pendulum runs from the beam to the centre of mass, which
             sits (0.5 - 0.2242) of the length below the suspension hole.
             A longer tube therefore swings SLOWER as well as sounding
             lower, and that is why a chime does not clatter in step. */
          tubes.push({
            phi: phi,
            hx: R * Math.cos(phi),
            hz: R * Math.sin(phi),
            L: len,
            f: f,
            name: noteName(f),
            lp: SLEN + (0.5 - NODE) * len,
            x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 0, e: 0, ea: 0,
            /* Kilograms: the material's mass per metre of tube times the
               length. A 60 cm aluminium tube of this diameter and wall
               comes out at 190 grams, which is what one weighs. It matters
               because the collision is resolved by inverse mass, so the
               short top note is knocked further by the same hit than the
               long bottom one — which is also true of the real thing. */
            m: mat.dens * (len * MM / 1000),
            /* Drag per unit of relative speed squared, which is
               0.5 * rho * Cd * A over the mass in these units. Area and
               mass are both proportional to length, so it cancels: every
               tube in a set leans by the same amount in the same wind.
               What does NOT cancel is density, and that is worth watching
               for — a brass tube feels a third of the push an aluminium
               one does, so a brass chime is genuinely lazier in light air,
               and bamboo is off at the first breath. */
            drag: 3.353e-5 / mat.dens,
            ring: 0,                 // visual only, decays after a strike
            touching: false
          });
          if (was[k]) {
            var w = was[k];
            tubes[k].x = w.x; tubes[k].z = w.z;
            tubes[k].vx = w.vx; tubes[k].vz = w.vz;
            tubes[k].e = w.e; tubes[k].ea = w.ea;
            tubes[k].ring = w.ring;
          }
        }

        /* The clapper: a small wooden disc hanging in the middle of the
           ring with room to swing. Its own drag is nearly nothing, because
           the wind meets its edge — the sail below is what actually gets
           pushed, and that is why a chime without a sail is silent. */
        var oldClap = clapper;
        var oldSail = sail;
        var rc = R * CLAP;
        var rcm = rc * MM / 1000;
        clapper = {
          r: rc, lp: SLEN + 138,
          x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 0, e: 0, ea: 0,
          /* A 10 mm hardwood disc at 600 kg per cubic metre, worked out
             from the radius the ring actually gives it rather than typed
             in here — change the tube count and the disc that follows is
             the one that would have to be cut. It comes out around 70
             grams, which is a THIRD of the tube it has to move, and that
             ratio is why a struck tube swings away and the clapper bounces
             off it rather than the other way about. */
          m: Math.PI * rcm * rcm * 0.010 * 600,
          /* Almost nothing: the wind meets the disc edge on. This is the
             whole reason a chime needs a sail. */
          drag: 2.5e-5
        };

        /* The sail: a 13 cm plate of 3 mm ply, forty grams, hung below
           everything else. Broad and light is the entire design — its drag
           over its mass is twenty-five times the clapper's, and that ratio
           is what turns moving air into a note. */
        sail = {
          lp: SLEN + 232,
          x: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 0, e: 0, ea: 0,
          m: 0.04, drag: 6.48e-4
        };
        if (oldClap) {
          clapper.x = oldClap.x; clapper.z = oldClap.z;
          clapper.vx = oldClap.vx; clapper.vz = oldClap.vz;
          sail.x = oldSail.x; sail.z = oldSail.z;
          sail.vx = oldSail.vx; sail.vz = oldSail.vz;
        }
      }

      /* ---------------------------------------------------------------
         One body, one step. Semi-implicit Euler at the shell's fixed
         1/120 s, which is far more than this needs — the fastest thing in
         here swings at about one hertz — but the collision wants the
         resolution and it is already being handed it.
         --------------------------------------------------------------- */
      /* Linear damping on top of the quadratic drag: the friction in the
         string and at the hole, and everything else the drag term does not
         reach. Low, because a chime that has been struck goes on swinging
         for a good while, and the drag against still air is already doing
         most of the work of stopping it. */
      var DAMP = 0.12;

      /* ---------------------------------------------------------------
         EACH BODY GETS ITS OWN EDDY, and leaving that out was the second
         thing that made this toy quiet in a gale.

         A single wind vector applied to everything means the tubes, the
         clapper and the sail all lean the same way at the same instant and
         hold there, and a chime that leans is a chime that grinds rather
         than one that rings. Real air does not work like that at this
         scale: the eddies that matter to something 20 cm across are 20 cm
         across, so the sail and the far tube are simply not in the same
         parcel of air at the same moment.

         So every body carries a small fast mean-reverting noise of its own
         and sees the global wind multiplied by it. It costs two lines and
         a field, and it is the difference between a gale that clatters and
         a gale that leans on the tubes in silence. Its size grows with the
         gustiness setting, because that is what gustiness means.
         --------------------------------------------------------------- */
      function eddy(b, dt) {
        b.e += (Math.random() * 2 - 1) * dt * 11;
        b.e -= b.e * dt * 3.4;
        if (b.e > 1.4) b.e = 1.4;
        if (b.e < -1.4) b.e = -1.4;
        /* The second one turns the gust rather than resizing it. A real
           eddy arrives off a slightly different bearing as well as at a
           different speed, and without this the clapper is only ever
           pushed along one line and sits against the same two tubes. */
        b.ea += (Math.random() * 2 - 1) * dt * 11;
        b.ea -= b.ea * dt * 3.4;
        if (b.ea > 1.4) b.ea = 1.4;
        if (b.ea < -1.4) b.ea = -1.4;
      }

      function step(b, wx, wz, dt) {
        eddy(b, dt);
        var gs = 0.35 + (gustSet / 100) * 0.85;
        var eg = 1 + b.e * gs;
        var ang = b.ea * gs * 0.55;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var wx2 = (wx * ca - wz * sa) * eg;
        wz = (wx * sa + wz * ca) * eg;
        wx = wx2;
        var rx = wx - b.vx;
        var rz = wz - b.vz;
        var rs = Math.sqrt(rx * rx + rz * rz);
        /* Quadratic drag on the RELATIVE velocity, which is what makes a
           gust a shove rather than a lift: at twice the speed the force is
           four times, and a tube already moving with the air feels less of
           it than one standing still. */
        var ax = b.drag * rs * rx + b.fx;
        var az = b.drag * rs * rz + b.fz;

        var d = Math.sqrt(b.x * b.x + b.z * b.z);
        var s = d / b.lp;
        if (s > 0.985) s = 0.985;
        var cth = Math.sqrt(1 - s * s);

        /* BOTH SIDES GET PROJECTED, and the first version only projected
           one of them. This works in the horizontal shadow of the pendulum,
           so the restoring term is the tangential g*sin(theta) seen from
           above, which is g*sin(theta)*cos(theta) — but then the applied
           force has to be projected the same way, and it is a force along
           the tangent as well, so it arrives multiplied by cos(theta)
           twice: once to take its tangential part and once to look at that
           part from above.

           Leave the force unprojected and the balance comes out at
           F/m = g*sin*cos when it should be F/m = g*tan, so the model
           under-restores by cos-squared and there is no equilibrium at all
           past about thirty degrees. Everything then pinned against the
           string limit and stayed there: in a fresh breeze the whole chime
           leaned over, held still, and went SILENT, which is the exact
           opposite of the thing being simulated. With the projection in
           place a tube in an 11 m/s wind sits at about 33 degrees, which is
           what tan(theta) = F/mg gives on paper. */
        var proj = cth * cth;
        ax *= proj;
        az *= proj;

        if (d > 1e-6) {
          var f = G * s * cth;
          ax -= f * (b.x / d);
          az -= f * (b.z / d);
        }
        ax -= DAMP * b.vx;
        az -= DAMP * b.vz;

        b.vx += ax * dt;
        b.vz += az * dt;
        b.x += b.vx * dt;
        b.z += b.vz * dt;

        /* A string cannot stretch. Past the limit the position is pulled
           back and the outward part of the velocity is dropped, which is
           what the string does to it. */
        var d2 = Math.sqrt(b.x * b.x + b.z * b.z);
        var lim = b.lp * 0.94;
        if (d2 > lim) {
          var k = lim / d2;
          b.x *= k; b.z *= k;
          var nx = b.x / lim, nz = b.z / lim;
          var vn = b.vx * nx + b.vz * nz;
          if (vn > 0) { b.vx -= vn * nx; b.vz -= vn * nz; }
        }
        b.fx = 0; b.fz = 0;
      }

      /* ---------------------------------------------------------------
         Striking a tube.

         The gates below thin the SOUND and nothing else. Every collision
         is still resolved, every impulse still lands, and the tube still
         swings away from the hit — it is only the ear that is spared. This
         is the honest-event-rate against bearable-sound-rate problem the
         shell header sets out: in a gale the clapper meets a tube dozens
         of times a second, and a note for each is not a chime, it is a
         machine gun. A tube already ringing is gated harder than the set
         as a whole, because striking the same tube twice inside a tenth of
         a second puts a second attack on top of the first and reads as a
         buzz rather than as two notes.
         --------------------------------------------------------------- */
      var VREF = 140;                // closing speed, units/s, that reads as loud

      function sound(t, idx, speed) {
        var amp = speed / VREF;
        if (amp > 1) amp = 1;

        /* Below this the clapper leaned on the tube rather than hitting
           it, and a lean is not a strike: it makes no note, it lights no
           label, and it is not counted. The counter and the readout sit
           HERE rather than under the two gates below, because a tube that
           was struck was struck — the gates only decide how much of that
           reaches the speaker, and a HUD that agreed with the speaker
           would be quietly under-reporting the simulation. */
        if (amp < 0.06) return;
        t.ring = t.ring > amp ? t.ring : amp;
        strikes++;
        if (g.gate('hud', 0.12)) {
          g.stat('note', t.name + ' · ' + Math.round(t.f) + ' Hz');
          g.stat('strikes', strikes);
        }

        if (!g.gate('tube' + idx, 0.11)) return;
        if (!g.gate('strike', 0.045)) return;

        air.set('strike', {
          seq: seq++,
          m: MATERIALS.indexOf(mat),
          f: t.f,
          amp: amp
        });
      }

      function collide() {
        var e = 0.34;                                  // wood on metal
        for (var k = 0; k < tubes.length; k++) {
          var t = tubes[k];
          var dx = (t.hx + t.x) - clapper.x;
          var dz = (t.hz + t.z) - clapper.z;
          var d = Math.sqrt(dx * dx + dz * dz);
          var rr = RT + clapper.r;
          if (d >= rr || d < 1e-6) { t.touching = false; continue; }

          var nx = dx / d, nz = dz / d;
          var vn = (t.vx - clapper.vx) * nx + (t.vz - clapper.vz) * nz;

          /* Push them apart first, split by inverse mass, or a clapper
             resting against a tube in a steady wind grinds through it and
             fires a strike every step. */
          var pen = rr - d;
          var wt = (1 / t.m) / (1 / t.m + 1 / clapper.m);
          t.x += nx * pen * wt;
          t.z += nz * pen * wt;
          clapper.x -= nx * pen * (1 - wt);
          clapper.z -= nz * pen * (1 - wt);

          if (vn < 0) {
            var jimp = -(1 + e) * vn / (1 / t.m + 1 / clapper.m);
            t.vx += (jimp / t.m) * nx;
            t.vz += (jimp / t.m) * nz;
            clapper.vx -= (jimp / clapper.m) * nx;
            clapper.vz -= (jimp / clapper.m) * nz;
            /* A tube already in contact is being leaned on, not struck. */
            if (!t.touching) sound(t, k, -vn);
          }
          t.touching = true;
        }
      }

      /* ---------------------------------------------------------------
         Controls.
         --------------------------------------------------------------- */
      function windMs() {
        /* The slider's top is 11 m/s, a fresh breeze on the Beaufort
           scale, which is about as much as a chime can take before it is
           simply thrashing. */
        return (windSet / 100) * 11;
      }

      function say() {
        g.announce(mat.name + ', ' + nTubes + ' tubes, ' + tuning.name +
          ', lowest note ' + tubes[0].name + ' at ' +
          Math.round(tubes[0].L * MM / 10) + ' centimetres. Wind ' +
          beaufort(windMs()) + '.');
      }

      function rebuild() {
        build();
        say();
      }

      if (windIn) {
        windSet = Number(windIn.value) || 0;
        windIn.addEventListener('input', function () {
          windSet = Number(windIn.value) || 0;
        });
      }
      if (gustIn) {
        gustSet = Number(gustIn.value) || 0;
        gustIn.addEventListener('input', function () {
          gustSet = Number(gustIn.value) || 0;
        });
      }
      if (tubeSel) {
        nTubes = Number(tubeSel.value) || 6;
        tubeSel.addEventListener('change', function () {
          nTubes = Number(tubeSel.value) || 6;
          rebuild();
        });
      }
      /* READ THE DROPDOWN, do not assume the first entry. A select restored
         by the browser on a reload, or one whose markup marks a different
         option as selected, would otherwise be showing one thing while the
         chime was built as another — the toolbar saying Brass over eight
         aluminium tubes, with nothing on the page to explain it. */
      function pick(list, value, fallback) {
        for (var k = 0; k < list.length; k++) {
          if (list[k].id === value) return list[k];
        }
        return fallback;
      }

      if (tuneSel) {
        tuning = pick(TUNINGS, tuneSel.value, tuning);
        tuneSel.addEventListener('change', function () {
          tuning = pick(TUNINGS, tuneSel.value, tuning);
          g.stat('tuning', tuning.name);
          rebuild();
        });
      }
      if (matSel) {
        mat = pick(MATERIALS, matSel.value, mat);
        matSel.addEventListener('change', function () {
          mat = pick(MATERIALS, matSel.value, mat);
          rebuild();
        });
      }
      if (sizeIn) {
        sizePct = Number(sizeIn.value) || 100;
        sizeIn.addEventListener('input', function () {
          sizePct = Number(sizeIn.value) || 100;
          build();
        });
        sizeIn.addEventListener('change', function () { say(); });
      }

      /* A gust the visitor asked for. dirx of 0 means "whatever the wind
         is already doing", which is what Space should mean. */
      function gust(dirx, strength) {
        var v = (windMs() * 500) * strength + 900 * strength;
        if (dirx === 0) {
          var d = Math.sqrt(windX * windX + windZ * windZ);
          if (d > 1) { gustX = (windX / d) * v; gustZ = (windZ / d) * v; }
          else { gustX = v; gustZ = 0; }
        } else {
          gustX = v * dirx;
          gustZ = 0;
          /* An arrow key does not only gust, it turns the weather round:
             ask for wind from the left and the wind is now from the left,
             rather than one shove followed by whatever it was doing. */
          wa = dirx > 0 ? 0 : Math.PI;
        }
        gustT = 0.7;
        /* Said as the visitor sees it rather than as a forecast would put
           it. Press the left arrow and the chime is pushed left, which a
           meteorologist would call a wind from the east and nobody looking
           at the screen would. */
        g.announce(dirx === 0 ? 'Gust' :
          (dirx > 0 ? 'Gust to the right' : 'Gust to the left'));
      }

      /* ---------------------------------------------------------------
         Blowing on them by hand.

         A drag across the canvas is a local wind. Horizontal movement maps
         to the world's x axis and vertical movement to its z, which is the
         axis running into the frame — a made-up mapping for a gesture that
         has no third dimension to give, and the alternative was ignoring
         half of every drag.
         --------------------------------------------------------------- */
      var BREATH_R = 170;

      function pointerVel(p, now) {
        if (!lastPt || now <= lastT) return { x: 0, z: 0 };
        var dt = (now - lastT) / 1000;
        if (dt < 0.001) dt = 0.001;
        if (dt > 0.1) dt = 0.1;
        return { x: (p.x - lastPt.x) / dt, z: (p.y - lastPt.y) / dt };
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          dragging = true;
          var p = g.pointAt(event);
          lastPt = p;
          lastT = event.timeStamp || Date.now();
          /* A tap with no drag in it is still a gesture, so it is a puff
             at that spot rather than nothing at all. */
          breath.x = p.x; breath.y = p.y;
          breath.vx = (p.x - CX) > 0 ? 1400 : -1400;
          breath.vz = 0;
          breath.t = 0.2;
        });
        g.canvas.addEventListener('pointermove', function (event) {
          if (!dragging) return;
          var p = g.pointAt(event);
          var now = event.timeStamp || Date.now();
          var v = pointerVel(p, now);
          breath.x = p.x; breath.y = p.y;
          /* Two and a half times the drag speed. A finger crossing the
             canvas in half a second is about 1300 units a second, which as
             a wind is 2.6 m/s — a real breeze but a disappointing one for
             something you did on purpose. */
          breath.vx = v.x * 2.5;
          breath.vz = v.z * 2.5;
          breath.t = 0.14;
          lastPt = p;
          lastT = now;
        });
        var stop = function () { dragging = false; lastPt = null; };
        g.canvas.addEventListener('pointerup', stop);
        g.canvas.addEventListener('pointercancel', stop);
        g.canvas.addEventListener('pointerleave', stop);
      }

      /* Where a body sits on screen, which the breath needs so that
         blowing at the top of the frame does not move the sail at the
         bottom of it. */
      function screenOf(b, hx, hz) {
        var d = Math.sqrt(b.x * b.x + b.z * b.z);
        var s = d / b.lp;
        if (s > 0.985) s = 0.985;
        var cth = Math.sqrt(1 - s * s);
        var wz = (hz || 0) + b.z;
        return { x: CX + (hx || 0) + b.x, y: TOPY + b.lp * cth + wz * 0.30 };
      }

      function breathAt(b, hx, hz) {
        if (breath.t <= 0) return null;
        var p = screenOf(b, hx, hz);
        var dx = p.x - breath.x, dy = p.y - breath.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > BREATH_R) return null;
        var k = 1 - d / BREATH_R;
        return { x: breath.vx * k, z: breath.vz * k };
      }

      /* ---------------------------------------------------------------
         The wind itself.
         --------------------------------------------------------------- */
      function stepWind(dt) {
        gp1 += dt * 0.19;
        gp2 += dt * 0.53;
        gp3 += dt * 1.27;
        gp4 += dt * 3.10;
        /* Four rates rather than one, and the fast one earns its place.
           A chime swings at about a hertz, so the eddies it responds to are
           the small quick ones — a wind that only breathes over ten seconds
           leans the whole thing over and holds it there, which is silent.
           That was the first version, and it was silent. */
        var n = 0.45 * Math.sin(gp1) + 0.26 * Math.sin(gp2 + 1.3) +
                0.18 * Math.sin(gp3 + 2.1) + 0.11 * Math.sin(gp4 + 0.7);

        /* Mean-reverting, so it wanders without ever leaving. The pull-back
           term is what stops a plain random walk from drifting off and
           never coming home, which is the usual way this goes wrong. */
        walk += (Math.random() * 2 - 1) * dt * 7.0;
        walk -= walk * dt * 2.2;
        if (walk > 1.7) walk = 1.7;
        if (walk < -1.7) walk = -1.7;

        var turb = 0.62 * n + 0.38 * (walk / 1.7);
        var base = windMs() * 500;                  // m/s to units/s

        /* Multiplied rather than added, and floored at zero. That is what
           gives a gusty wind its real shape: lulls that fall to almost
           nothing and gusts that overshoot the mean, rather than a steady
           breeze with a wobble on it. */
        windSpeed = base * (1 + (gustSet / 100) * 1.35 * turb);
        if (windSpeed < 0) windSpeed = 0;

        /* A steady backing plus a wander. THE STEADY PART IS FASTER THAN
           THE WEATHER: a full turn of the compass in about two minutes,
           where real wind takes an afternoon. It is here because a chime
           whose wind keeps one bearing plays two of its six notes and
           leaves the other four hanging there, which is not what a chime
           does and not what anybody came to listen to. It is the one place
           in this model where the toy beats the meteorology, and it seemed
           better to say so than to pretend the random walk was covering
           the circle on its own — it was not. */
        wa += dt * 0.055 + (Math.random() * 2 - 1) * dt * 0.7;
        /* Bend the DIRECTION toward the screen plane, do not shrink the
           wind. Squashing the z component outright was the obvious version
           and it was wrong in a way that took a while to see: it made the
           wind speed depend on which way it happened to be pointing, so a
           run that opened with the breeze blowing into the frame was
           running at half the speed the slider claimed and the chime sat
           there in silence for a minute. Normalising afterwards keeps the
           speed exactly what it says and bends only the heading, which is
           the drawing decision the header owns up to and nothing more. */
        var bx = Math.cos(wa);
        var bz = Math.sin(wa) * 0.5;
        var bn = Math.sqrt(bx * bx + bz * bz) || 1;
        windX = (bx / bn) * windSpeed;
        windZ = (bz / bn) * windSpeed;

        if (gustT > 0) {
          var k = gustT / 0.7;
          windX += gustX * k;
          windZ += gustZ * k;
          gustT -= dt;
        }
      }

      return {
        reset: function () {
          build();
          /* Not on the first pass. reset() runs from the parser on a toy
             that autoStarts, and an announcement at that moment talks over
             the page title being read out — the same reason the shell
             declines to announce its own opening overlay. Every later
             reset is somebody pressing Restart, and that is worth saying. */
          if (booted) say();
          booted = true;
          strikes = 0;
          g.stat('strikes', 0);
          g.stat('tuning', tuning.name);
          g.stat('wind', beaufort(windMs()));
          lastBand = beaufort(windMs());
          /* A restart must not inherit the last run's gale. */
          windSpeed = 0;
          sentWind = 0;
          air.set('wind', 0);
        },

        key: function (name) {
          if (name === 'action') { gust(0, 1.1); return; }
          if (name === 'left') { gust(-1, 0.9); return; }
          if (name === 'right') { gust(1, 0.9); return; }
          if (name === 'up' || name === 'down') {
            windSet += (name === 'up' ? 10 : -10);
            if (windSet > 100) windSet = 100;
            if (windSet < 0) windSet = 0;
            /* The slider is the visible statement of this number, so it
               moves too. A control that silently disagrees with the thing
               it controls is worse than no control. */
            if (windIn) windIn.value = String(windSet);
            g.stat('wind', beaufort(windMs()));
            lastBand = beaufort(windMs());
            g.announce('Wind ' + beaufort(windMs()) + ', ' +
              windMs().toFixed(1) + ' metres a second');
          }
        },

        update: function (dt) {
          stepWind(dt);
          if (breath.t > 0) breath.t -= dt;

          var k, t, bw;

          for (k = 0; k < tubes.length; k++) {
            t = tubes[k];
            bw = breathAt(t, t.hx, t.hz);
            step(t, windX + (bw ? bw.x : 0), windZ + (bw ? bw.z : 0), dt);
            if (t.ring > 0) {
              t.ring -= dt * 1.6;
              if (t.ring < 0) t.ring = 0;
            }
          }

          /* The string between the clapper and the sail, as a spring. The
             clapper is pulled toward the sail and the sail feels the same
             force back, scaled by the mass ratio — which is Newton's third
             law and also the only reason a forty gram plate can drag a
             seventy gram disc into a tube. */
          /* Stiff, because a string is not slack. The two hang from the
             same point here rather than one from the other, so the spring
             is standing in for a taut length of cord and has to be stiff
             enough that they move very nearly together — soft, and the
             sail flies out on its own while the clapper stays home, which
             is a thing no chime does. */
          var LINK = 60;
          var dx = sail.x - clapper.x;
          var dz = sail.z - clapper.z;
          clapper.fx += LINK * dx;
          clapper.fz += LINK * dz;
          sail.fx -= LINK * dx * (clapper.m / sail.m);
          sail.fz -= LINK * dz * (clapper.m / sail.m);

          bw = breathAt(clapper, 0, 0);
          step(clapper, windX + (bw ? bw.x : 0), windZ + (bw ? bw.z : 0), dt);
          bw = breathAt(sail, 0, 0);
          step(sail, windX + (bw ? bw.x : 0), windZ + (bw ? bw.z : 0), dt);

          collide();

          /* Five times a second, not sixty. Every wind update below ends in
             a cancel and two ramps on AudioParams, which costs more than
             the physics that feeds it and sounds identical, because nothing
             in a wind bed moves fast enough to tell the difference. */
          sndAcc += dt;
          if (sndAcc >= 0.2) {
            sndAcc = 0;
            var lvl = windSpeed / 5500;
            if (lvl > 1) lvl = 1;
            if (Math.abs(lvl - sentWind) > 0.01) {
              sentWind = lvl;
              air.set('wind', lvl);
            }
            var band = beaufort(windMs());
            if (band !== lastBand) {
              lastBand = band;
              g.stat('wind', band);
              g.announce('Wind ' + band);
            }
          }
        },

        draw: function (ctx) {
          var k, t;

          /* Dusk, because that is when anybody is listening to one of
             these. Two stops and no texture; the frame is busy enough. */
          var sky = ctx.createLinearGradient(0, 0, 0, H);
          sky.addColorStop(0, '#0a1120');
          sky.addColorStop(0.62, '#101a2c');
          sky.addColorStop(1, '#0b1220');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, W, H);

          /* Streaks of moving air. Positions are derived from the wind
             phase rather than stored, so there is no particle system here
             to keep alive and nothing to reseed when the wind turns.
             Dropped entirely under prefers-reduced-motion: it is the one
             thing on the canvas that moves for decoration rather than
             because it is being simulated. */
          if (!reduced && windSpeed > 60) {
            var vis = windSpeed / 5500;
            if (vis > 1) vis = 1;
            ctx.strokeStyle = 'rgba(148, 163, 184, ' + (0.05 + vis * 0.13).toFixed(3) + ')';
            ctx.lineWidth = 1;
            for (k = 0; k < 26; k++) {
              var sy = ((k * 97) % 460) + 8;
              var drift = (gp1 * 190 + k * 53) * (windX >= 0 ? 1 : -1);
              var sx = (((drift % (W + 240)) + W + 240) % (W + 240)) - 120;
              var len = 26 + vis * 90 + (k % 5) * 7;
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(sx + (windX >= 0 ? len : -len), sy + windZ * 0.004);
              ctx.stroke();
            }
          }

          /* The beam it hangs from. */
          ctx.fillStyle = '#1b2536';
          ctx.fillRect(0, TOPY - 22, W, 22);
          ctx.fillStyle = 'rgba(226, 232, 240, 0.10)';
          ctx.fillRect(0, TOPY - 22, W, 2);
          ctx.fillStyle = '#0d1422';
          ctx.fillRect(0, TOPY, W, 3);

          /* The suspension ring. */
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(CX, TOPY + 7, 6, 0, Math.PI * 2);
          ctx.stroke();

          /* Back to front. A ring of tubes seen from the side is half in
             front of the clapper and half behind it, and drawing them in
             array order puts the far ones over the near ones about as
             often as not. */
          var order = [];
          for (k = 0; k < tubes.length; k++) order.push(k);
          order.sort(function (a, b) {
            return (tubes[a].hz + tubes[a].z) - (tubes[b].hz + tubes[b].z);
          });

          var R = ringRadius(nTubes);

          function tubePoint(tt, q) {
            var d = Math.sqrt(tt.x * tt.x + tt.z * tt.z);
            var s = d / tt.lp;
            if (s > 0.985) s = 0.985;
            var cth = Math.sqrt(1 - s * s);
            var ux = tt.x / tt.lp, uz = tt.z / tt.lp;
            var wx = tt.hx + q * ux;
            var wy = TOPY + q * cth;
            var wz = tt.hz + q * uz;
            return { x: CX + wx, y: wy + wz * 0.30, s: 1 + wz * 0.0016, z: wz };
          }

          function drawTube(tt) {
            var pivot = { x: CX + tt.hx, y: TOPY + tt.hz * 0.30 };
            var hang = tubePoint(tt, SLEN);
            var top = tubePoint(tt, SLEN - NODE * tt.L);
            var bot = tubePoint(tt, SLEN + (1 - NODE) * tt.L);

            ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pivot.x, pivot.y);
            ctx.lineTo(hang.x, hang.y);
            ctx.stroke();

            ctx.lineCap = 'round';
            if (tt.ring > 0.02 && !reduced) {
              ctx.strokeStyle = 'rgba(248, 250, 252, ' + (tt.ring * 0.20).toFixed(3) + ')';
              ctx.lineWidth = 2 * RT * bot.s + 10 * tt.ring;
              ctx.beginPath();
              ctx.moveTo(top.x, top.y);
              ctx.lineTo(bot.x, bot.y);
              ctx.stroke();
            }

            ctx.strokeStyle = mat.tint;
            ctx.lineWidth = 2 * RT * bot.s;
            ctx.beginPath();
            ctx.moveTo(top.x, top.y);
            ctx.lineTo(bot.x, bot.y);
            ctx.stroke();

            /* One offset highlight, which is the whole difference between a
               cylinder and a grey line. */
            ctx.strokeStyle = mat.edge;
            ctx.lineWidth = 2 * RT * bot.s * 0.30;
            ctx.beginPath();
            ctx.moveTo(top.x - RT * 0.45, top.y + 3);
            ctx.lineTo(bot.x - RT * 0.45, bot.y - 3);
            ctx.stroke();

            /* Depth, as a wash of the background colour over anything at
               the back. Cheaper than a second palette and it keeps the
               material's own colour recognisable at both ends. */
            var shade = 0.34 * (1 - (bot.z + R) / (2 * R));
            if (shade > 0.01) {
              ctx.strokeStyle = 'rgba(10, 17, 32, ' + shade.toFixed(3) + ')';
              ctx.lineWidth = 2 * RT * bot.s + 1;
              ctx.beginPath();
              ctx.moveTo(top.x, top.y);
              ctx.lineTo(bot.x, bot.y);
              ctx.stroke();
            }

            /* The suspension hole, drawn where it is calculated: at 0.224
               of the length from the top, on the node of the fundamental. */
            ctx.fillStyle = 'rgba(8, 13, 24, 0.85)';
            ctx.beginPath();
            ctx.arc(hang.x, hang.y, 1.7 * bot.s, 0, Math.PI * 2);
            ctx.fill();
          }

          function bodyPoint(b) {
            var d = Math.sqrt(b.x * b.x + b.z * b.z);
            var s = d / b.lp;
            if (s > 0.985) s = 0.985;
            var cth = Math.sqrt(1 - s * s);
            return {
              x: CX + b.x,
              y: TOPY + b.lp * cth + b.z * 0.30,
              s: 1 + b.z * 0.0016
            };
          }

          function disc(cx, cy, rx, ry, fill) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, ry / rx);
            ctx.beginPath();
            ctx.arc(0, 0, rx, 0, Math.PI * 2);
            ctx.restore();
            ctx.fillStyle = fill;
            ctx.fill();
          }

          for (k = 0; k < order.length; k++) {
            if ((tubes[order[k]].hz + tubes[order[k]].z) >= 0) break;
            drawTube(tubes[order[k]]);
          }
          var frontFrom = k;

          /* The clapper: a disc seen almost edge on, with a slab of
             thickness under it so it reads as wood rather than as a hoop. */
          var cp = bodyPoint(clapper);
          var crx = clapper.r * cp.s;
          var cry = crx * 0.26;
          ctx.fillStyle = '#6b431f';
          ctx.fillRect(cp.x - crx, cp.y, crx * 2, 7);
          disc(cp.x, cp.y + 7, crx, cry, '#6b431f');
          disc(cp.x, cp.y, crx, cry, '#9a6634');
          ctx.strokeStyle = 'rgba(248, 226, 190, 0.30)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cp.x - crx * 0.75, cp.y - cry * 0.35);
          ctx.lineTo(cp.x + crx * 0.35, cp.y - cry * 0.55);
          ctx.stroke();

          for (k = frontFrom; k < order.length; k++) drawTube(tubes[order[k]]);

          /* The sail, and the string from the clapper down to it. */
          var sp = bodyPoint(sail);
          ctx.strokeStyle = 'rgba(203, 213, 225, 0.40)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cp.x, cp.y + 4);
          ctx.lineTo(sp.x, sp.y - 26);
          ctx.stroke();

          var tilt = Math.atan2(sail.vx, 260);
          ctx.save();
          ctx.translate(sp.x, sp.y);
          ctx.rotate(tilt);
          ctx.fillStyle = '#8a5a2b';
          ctx.fillRect(-22, -26, 44, 56);
          ctx.fillStyle = 'rgba(248, 226, 190, 0.18)';
          ctx.fillRect(-22, -26, 44, 4);
          ctx.strokeStyle = 'rgba(10, 17, 32, 0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(-22, -26, 44, 56);
          ctx.restore();

          /* ---- the legend, which is the point of the picture ----
             Every tube gets its note, its length in centimetres, and a bar
             whose height IS that length. Read left to right the bars fall
             away and the notes climb, which is the 1/L^2 relationship in
             the one form nobody needs a formula for. It flashes when its
             tube is struck, so a visitor who cannot hear the difference
             between two notes can still see which one just sounded. */
          var cellW = W / tubes.length;
          var baseY = H - 12;
          ctx.textAlign = 'center';
          for (k = 0; k < tubes.length; k++) {
            t = tubes[k];
            var lx = cellW * (k + 0.5);
            var bh = 10 + (t.L / 340) * 30;
            ctx.fillStyle = t.ring > 0.02
              ? 'rgba(248, 250, 252, ' + (0.35 + t.ring * 0.6).toFixed(3) + ')'
              : 'rgba(148, 163, 184, 0.35)';
            ctx.fillRect(lx - 3, baseY - 14 - bh, 6, bh);
            ctx.fillStyle = t.ring > 0.02 ? '#f8fafc' : '#94a3b8';
            ctx.font = '600 12px system-ui, sans-serif';
            ctx.fillText(t.name, lx, baseY - 2);
            ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillText(Math.round(t.L * MM / 10) + ' cm', lx, baseY + 9);
          }

          /* A vane, because the streaks say direction and speed in a way
             that is easy to miss and impossible to read when the wind has
             dropped. The word beside it is the same one in the HUD. */
          var vx = W - 78, vy = 30;
          var vs = windSpeed / 5500;
          if (vs > 1) vs = 1;
          var vlen = 12 + vs * 34;
          var vdir = windX >= 0 ? 1 : -1;
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.65)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(vx - vlen * 0.5 * vdir, vy);
          ctx.lineTo(vx + vlen * 0.5 * vdir, vy);
          ctx.moveTo(vx + vlen * 0.5 * vdir, vy);
          ctx.lineTo(vx + vlen * 0.5 * vdir - 7 * vdir, vy - 5);
          ctx.moveTo(vx + vlen * 0.5 * vdir, vy);
          ctx.lineTo(vx + vlen * 0.5 * vdir - 7 * vdir, vy + 5);
          ctx.stroke();
          ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(beaufort(windMs()), vx, vy + 20);
          ctx.textAlign = 'left';
        }
      };
    }
  });
})();

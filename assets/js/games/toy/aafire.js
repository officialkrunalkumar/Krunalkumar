/* ==========================================================================
   aafire.js — the aalib fire demo, as characters.
   --------------------------------------------------------------------------
   There is no fire here. There is a grid of numbers, and one pass per frame
   in which each cell becomes the average of the cells below it minus a small
   random decay. Run that upward from a hot bottom edge and heat climbs a row
   per pass, spreading sideways as it goes and running out before the top.
   Everything that looks like flame is that one line of arithmetic.

   Three decisions worth writing down:

   1. WIND IS A WEIGHT, NOT A SHIFT. The obvious way to lean the flame is to
      sample from an offset column, which quantises to whole cells and makes
      the fire jump between three fixed slants. Instead the three samples from
      the row below carry weights 1+w, 1 and 1-w. They still sum to four, so
      it remains a true average — no energy is invented or lost by the wind,
      only moved — and w is continuous, so a half-strength breeze is really
      half a breeze.

   2. THE BED IS NOT RE-ROLLED EVERY FRAME. Two rows sit below the visible
      screen holding the source heat, and only about a quarter of their cells
      are given a new value each pass. Re-rolling all of them turns the base
      into uniform noise, the averaging smooths that into a flat orange band,
      and the fire loses its separate tongues. Persistence is what gives it
      hot cores that survive long enough to climb.

   3. THE SOUND READS THE SETTING, NOT THE GRID. A fire is a roar with
      cracks on top and it needs both, so the body of it is a bed rather
      than a stream of events: a lowpassed rumble with a very slow
      oscillator on its cutoff, so the fire surges and settles instead of
      sitting at one level, and a wide bandpassed hiss over the top of it.
      Both are scaled by the intensity setting and leaned by the wind one,
      which is why Embers is a warm simmer somewhere to the left and
      Inferno is a real roar. The cracks are gated one-shots, and the gap
      between them NARROWS as the fire grows — the opposite of the rain
      toy, where the plinks thin out as the storm thickens, because a
      bigger fire genuinely does pop more often. What none of it does is
      sound a cell: a couple of thousand of them cross into visible every
      second here, and a pop for each is not a fire, it is a Geiger
      counter.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 78;
  var ROWS = 26;
  var HROWS = ROWS + 2;       // two extra rows, below the screen, are the fire bed

  /* The ramp does as much work as the physics. Ten steps from a full stop to
     a dollar sign, chosen for ink coverage rather than for looking like
     anything: '.' is a speck, '$' is nearly a solid cell, and the eye reads
     the gradient between them as heat. Swap in a ramp that is not ordered by
     density and the same buffer stops looking like fire immediately. */
  var RAMP = ' .:^*xsS#$';

  /* Blackbody, in the palette the terminal has: smoky gold at the tips, then
     red, orange, yellow, white at the bed. Index matches RAMP. */
  var TINT = [null, 'brown', 'brown', 'red', 'red', 'orange', 'orange', 'yellow', 'yellow', 'white'];

  /* decay is how much heat a cell loses climbing one row, so it sets the
     height; churn and hot set how fierce the bed is. */
  var LEVELS = {
    low: { decay: 0.062, churn: 0.20, hot: 0.62 },
    normal: { decay: 0.036, churn: 0.28, hot: 0.85 },
    high: { decay: 0.027, churn: 0.42, hot: 1.00 }
  };

  /* How much fire the sound hears at each setting, 0..1, keyed the same as
     LEVELS but deliberately kept out of it. Reusing level.hot would have
     saved a table and been wrong twice over: it is a physics number that
     gets retuned when the ramp looks off, and it says Embers is a fire at
     sixty-two per cent when Embers is meant to be a different sound
     entirely rather than a quieter one. */
  var FUEL = { low: 0, normal: 0.55, high: 1 };

  /* The flame rises exactly one row per pass, so this is the speed of the
     fire and not a frame rate. Above about forty it stops reading as flame
     and starts reading as static. */
  var FIRE_HZ = 32;

  TermShell.define({
    id: 'game-aafire',
    slug: 'aafire',
    title: 'aafire',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var heat = [];            // COLS * HROWS, values 0..1
      var bed = [];             // the persistent source row, COLS wide
      var acc = 0;
      var wind = 0;
      var level = LEVELS.normal;
      var lastFlame = -1;
      var lastAlight = -1;
      var power = FUEL.normal;    // what the sound makes of level; see FUEL

      var windSel = document.getElementById('game-wind');
      var powerSel = document.getElementById('game-intensity');

      function readWind() {
        if (!windSel) return 0;
        /* parseFloat rather than Number(...) || 0, because the still setting
           is '0' and would be thrown away by the truthiness test. */
        var v = parseFloat(windSel.value);
        if (isNaN(v)) return 0;
        return Math.max(-1, Math.min(1, v));
      }

      function readLevel() {
        if (!powerSel) return LEVELS.normal;
        return LEVELS[powerSel.value] || LEVELS.normal;
      }

      /* Deliberately not derived from readLevel(), for the reason FUEL is a
         separate table. */
      function readPower() {
        if (!powerSel) return FUEL.normal;
        var v = FUEL[powerSel.value];
        return v == null ? FUEL.normal : v;
      }

      /* ---------------------------------------------------------------
         The fire. See decision 3 in the header.

         Two noise layers, because a fire is two sounds and neither is the
         fire on its own. The ROAR is the low body, which is really the
         sound of air being pulled into the base, and it is what makes an
         Inferno feel large rather than merely bright. The HISS is the mid
         band above it, the fuel itself going, and it is the layer that says
         something is burning rather than that a fan is running. Ship the
         roar alone and it is a motorway two streets away; ship the hiss
         alone and it is a tap left running.
         --------------------------------------------------------------- */
      var fire = g.bed(function (a) {
        var ctx = a.ctx;

        function layer(type, freq, q, gain) {
          var src = ctx.createBufferSource();
          src.buffer = a.noise();
          src.loop = true;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.value = freq;
          filt.Q.value = q;
          var amp = ctx.createGain();
          amp.gain.value = gain;
          src.connect(filt);
          filt.connect(amp);
          src.start();
          return { filt: filt, amp: amp };
        }

        var roar = layer('lowpass', 240, 0.8, 0.055);
        var hiss = layer('bandpass', 1150, 0.7, 0.007);

        /* The wind setting leans the fire across the stereo field. A panner
           is the one node in this graph that is not everywhere Web Audio
           is — Safari was late to createStereoPanner and some embedded
           WebViews still lack it — so it is asked for rather than
           assumed, and both layers connect to whatever came back. Losing
           the lean costs the stereo image and nothing else. Constructing it
           blind would cost the whole bed: the shell catches a throw out of
           build() and carries on in silence, so the failure would be a toy
           that is simply mute for no visible reason.

           Both layers pan together on purpose. Splitting them — roar centre,
           hiss leaning — sounds like two separate fires rather than one
           being blown sideways. */
        var panner = null;
        if (ctx.createStereoPanner) {
          try { panner = ctx.createStereoPanner(); } catch (err) { panner = null; }
        }
        if (panner) panner.connect(a.out);
        var tail = panner || a.out;
        roar.amp.connect(tail);
        hiss.amp.connect(tail);

        /* Surges. A fire held at one cutoff is a rumble, and the ear files a
           rumble under machinery inside a few seconds. One very slow
           oscillator on the roar's cutoff — a swell every eight seconds or
           so, about the rate at which a real fire finds fresh air — is the
           whole difference between a fire and an extractor fan. Its depth
           rides the intensity too, because embers do not surge. */
        var lfo = ctx.createOscillator();
        var depth = ctx.createGain();
        lfo.frequency.value = 0.13;
        depth.gain.value = 45;
        lfo.connect(depth);
        depth.connect(roar.filt.frequency);
        lfo.start();

        function ramp(param, value) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Three quarters of a second, a little longer than the rain toy
             uses. Rain changing density is weather arriving and can be
             quick about it; a fire changing size is fuel catching, and it
             should be heard taking hold. */
          param.linearRampToValueAtTime(value, now + 0.75);
        }

        /* Named apart from the outer `heat` grid on purpose: that is a
           couple of thousand cell temperatures, this is one number saying
           how big the fire is meant to sound. */
        var fuel = FUEL.normal;
        var lean = 0;

        function apply() {
          var w = Math.abs(lean);
          /* The roar carries most of the level because almost all of it
             sits below 300 Hz, where the ear wants considerably more
             amplitude for the same loudness. These are mix numbers, not
             meter readings: the two layers together land around rms 0.004
             at Embers and 0.018 at Inferno. */
          ramp(roar.amp.gain, 0.055 + fuel * 0.100);
          ramp(hiss.amp.gain, 0.007 + fuel * 0.026);
          /* A bigger fire is not only louder, it is wider, so the roar's
             lowpass opens upward and the hiss climbs with it. Wind adds a
             little top to the hiss on its own account, which is what being
             fanned does to a flame — hotter, thinner, brighter — and it is
             what keeps the wind setting audible even on a mono device that
             never got a panner. */
          ramp(roar.filt.frequency, 240 + fuel * 320);
          ramp(hiss.filt.frequency, 1150 + fuel * 700 + w * 450);
          ramp(depth.gain, 45 + fuel * 115);
          /* Just over half the available width. Panned hard, the fire stops
             being in the room and starts being in one ear. */
          if (panner) ramp(panner.pan, lean * 0.55);
        }

        return {
          set: function (key, value) {
            if (key === 'heat') fuel = Math.max(0, Math.min(1, value));
            else if (key === 'wind') lean = Math.max(-1, Math.min(1, value));
            else return;
            apply();
          }
        };
      });

      /* One crack. Very short and very tight, at a centre frequency rolled
         per pop, because that is a pocket of sap or water letting go rather
         than anything tonal — hold the centre still and a run of them reads
         as a click track rather than as burning wood.

         The GAP NARROWS AS THE FIRE GROWS, which is the exact reverse of the
         rain toy and correct in both places: a downpour stops you picking
         out one drop from the next, while a bigger fire really does pop more
         often. Roughly one crack every third of a second at Embers, one
         every ninth at Inferno.

         The rate comes from the setting rather than from the grid, for the
         reason in decision 3 — there is no shortage of hot cells to hang a
         pop on, which is precisely the problem. */
      function crackle() {
        if (!g.gate('crack', 0.35 - power * 0.26)) return;
        g.noise(0.02 + Math.random() * 0.04, {
          type: 'bandpass',
          freq: 1500 + Math.random() * 3500,
          q: 9,
          /* Quiet, and only a little louder at Inferno. Up there these fire
             nearly four times as often, and a rate that climbs alongside a
             level that also climbs stops sounding like a fire and starts
             sounding like applause. */
          level: 0.026 + power * 0.014
        });
      }

      if (windSel) {
        wind = readWind();
        windSel.addEventListener('change', function () {
          wind = readWind();
          fire.set('wind', wind);
        });
      }
      if (powerSel) {
        level = readLevel();
        power = readPower();
        powerSel.addEventListener('change', function () {
          level = readLevel();
          power = readPower();
          fire.set('heat', power);
        });
      }

      /* Once, here, rather than inside the two blocks above: a page that
         somehow rendered without the selects still gets a fire at the
         default setting rather than a bed sitting at whatever its own
         initial values happened to be. Setting a bed before anyone has
         unmuted is safe — the value is held and applied when the nodes are
         built. */
      fire.set('wind', wind);
      fire.set('heat', power);

      /* Outside the grid is cold rather than mirrored, which is why the fire
         tapers at the left and right edges instead of sticking to them. */
      function at(x, y) {
        if (x < 0 || x >= COLS) return 0;
        return heat[y * COLS + x];
      }

      /* The ramp is spanned against the bed temperature rather than against
         1.0, so the hottest cells reach '$' on every setting. Fixing the top
         of the ramp at 1.0 instead meant the low setting never got past the
         middle of it and burned a dull, evenly grey fire. */
      function ink(v) {
        var n = Math.floor((v / level.hot) * RAMP.length);
        if (n < 1) return 0;
        return n > RAMP.length - 1 ? RAMP.length - 1 : n;
      }

      function cold() {
        var i;
        heat = [];
        for (i = 0; i < COLS * HROWS; i++) heat.push(0);
        bed = [];
        for (i = 0; i < COLS; i++) bed.push(0);
      }

      function stoke() {
        for (var x = 0; x < COLS; x++) {
          if (Math.random() >= level.churn) continue;
          /* Two thirds of the re-rolls are hot and one third is nearly cold,
             so the bed keeps gaps in it. A bed with no gaps burns as a wall. */
          bed[x] = Math.random() < 0.66
            ? level.hot * (0.72 + Math.random() * 0.28)
            : level.hot * Math.random() * 0.3;
        }
        for (var i = 0; i < COLS; i++) {
          heat[ROWS * COLS + i] = bed[i];
          heat[(ROWS + 1) * COLS + i] = bed[i];
        }
      }

      /* One pass, and it must run top row first. Start at the bottom instead
         and every row reads a row below that this same pass has already
         updated, so heat propagates the full height of the screen in one go
         and the fire stops moving — it becomes a static gradient. Going down
         the screen means each row reads the previous frame's value beneath
         it, which is what limits the climb to one row per pass. */
      function pass() {
        var wl = 1 + wind;
        var wr = 1 - wind;
        var top = ROWS;
        var lit = 0;
        var visible = level.hot * 0.1;      // the heat at which a cell first prints something

        for (var y = 0; y < ROWS; y++) {
          var b = y + 1;
          var b2 = y + 2;
          for (var x = 0; x < COLS; x++) {
            var v = (wl * at(x - 1, b) + at(x, b) + wr * at(x + 1, b) + at(x, b2)) / 4;
            /* The decay is randomised around its nominal value. A constant
               decay gives a flame with a smooth, obviously computed outline;
               the jitter is the whole of the flicker. */
            v -= level.decay * (0.35 + Math.random() * 1.3);
            if (v < 0) v = 0;
            heat[y * COLS + x] = v;
            if (v >= visible) {
              lit++;
              if (y < top) top = y;
            }
          }
        }

        var flame = ROWS - top;
        if (flame !== lastFlame) {
          lastFlame = flame;
          g.stat('flame', flame + (flame === 1 ? ' row' : ' rows'));
        }
        var pct = Math.round((lit / (COLS * ROWS)) * 100);
        if (pct !== lastAlight) {
          lastAlight = pct;
          g.stat('alight', pct + '%');
        }
      }

      return {
        reset: function () {
          cold();
          acc = 0;
          lastFlame = -1;
          lastAlight = -1;
          /* Burn in off-screen so the toy opens on a fire rather than on an
             empty grid that fills over the first second. */
          for (var i = 0; i < ROWS + 8; i++) { stoke(); pass(); }
        },

        update: function (dt) {
          acc += dt;
          var interval = 1 / FIRE_HZ;
          /* A while rather than an if, for the same reason every other game
             here uses one: a long frame must not leave the fire owing passes
             it never runs. */
          var guard = 0;
          while (acc >= interval && guard < 4) {
            acc -= interval;
            guard++;
            stoke();
            pass();
          }
          if (acc > interval) acc = interval;
          /* Once a frame rather than once a pass. A long frame that owed
             the fire four passes should not crack four times over. */
          crackle();
        },

        draw: function (term) {
          term.clear();
          for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
              var n = ink(heat[y * COLS + x]);
              if (!n) continue;
              term.put(x, y, RAMP.charAt(n), TINT[n]);
            }
          }
        }
      };
    }
  });
})();

/* ==========================================================================
   cmatrix.js — the falling glyph rain.
   --------------------------------------------------------------------------
   One column, one raindrop: a head position, a speed, and a trail length.
   The trail is drawn by walking back up from the head and fading, which is
   why it costs nothing — there is no history buffer, only arithmetic.

   The characters do not fall. Each cell holds a glyph that only changes
   occasionally; what moves is the bright head, and the illusion of falling
   text comes from the trail sweeping over cells whose contents were already
   there. That is how the original does it, and it is the difference between
   a screensaver and a scrolling buffer.

   The sound follows the same split. A hum is a CONDITION — the machine is
   running whether or not a column happens to restart this frame — so it is
   a bed: two detuned sawtooths an octave apart behind a lowpass that
   breathes on a very slow LFO, with a whisper of highpassed noise over it
   so the result reads as a carrier rather than as an organ note. A column
   beginning its fall is an EVENT and gets a soft tick. The gap between
   ticks WIDENS as the speed setting rises, because Fast restarts something
   like twenty columns a second and a tick for each is a machine gun; what
   gets dropped is not missed, because by then the columns are no longer
   separable and the hum they amount to is already playing underneath. The
   tick pitches come from one pentatonic scale, so the few that do land
   together are a fourth or a fifth apart rather than a semitone.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 80;
  var ROWS = 26;
  var GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>¦｜';

  /* Two octaves of a minor pentatonic. Every pair of these is a consonant
     interval, which is what makes it safe to strike them at unpredictable
     moments — there is no wrong note left to land on. A chromatic table
     over the same range would throw a semitone clash several times a
     minute, and a clash that arrives at random reads as a fault rather
     than as a machine. */
  var TICKS = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];

  TermShell.define({
    id: 'game-cmatrix',
    slug: 'cmatrix',
    title: 'cmatrix',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g, t) {
      var drops = [];
      var cells = [];           // the glyph sitting in each cell
      var speedMul = 1;

      var speedSel = document.getElementById('game-speed');

      /* ---------------------------------------------------------------
         The machine underneath. See the header.

         Three layers, because what is being imitated is a room with
         something running in it rather than a note. The BODY is a sawtooth
         an octave below the HUM, and both are sawtooths rather than
         triangles on purpose: at 55 Hz a triangle behind a 400 Hz lowpass
         is a sine in all but name, and no laptop speaker reproduces a 55 Hz
         sine at all, so what actually reaches the ear is the harmonic stack
         — the wave has to have one to give. The CARRIER over the top is a
         breath of highpassed noise, mixed far below the level at which it
         reads as hiss, and it is the whole difference between a tone and a
         signal.
         --------------------------------------------------------------- */
      var hum = g.bed(function (a) {
        var ctx = a.ctx;

        /* One lowpass shared by both oscillators rather than one each. They
           are an octave apart and have to move together; give them separate
           filters and the octave opens and closes as the cutoff sweeps,
           which the ear hears as the pitch changing when only the
           brightness should. */
        var filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 340;
        filt.Q.value = 0.7;
        filt.connect(a.out);

        function saw(freq, cents, level) {
          var osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;
          /* Detuned, and never by zero. Tuned to an exact octave the two
             lock into a single static timbre; nine cents apart the upper
             beats against the lower's second harmonic about twice every
             three seconds, and that slow swell is the whole reason this
             sounds like equipment rather than a held synthesiser key. */
          osc.detune.value = cents;
          var gain = ctx.createGain();
          gain.gain.value = level;
          osc.connect(gain);
          gain.connect(filt);
          osc.start();
          return gain;
        }

        var body = saw(55, 0, 0.022);
        var upper = saw(110, 9, 0.013);

        /* The carrier, and it deliberately bypasses the lowpass — pushed
           this far up it carries no pitch at all, so it adds air without
           adding a second note to argue with the two below it. */
        var src = ctx.createBufferSource();
        src.buffer = a.noise();
        src.loop = true;
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 5200;
        var hiss = ctx.createGain();
        hiss.gain.value = 0.0035;
        src.connect(hp);
        hp.connect(hiss);
        hiss.connect(a.out);
        src.start();

        /* The breath. Held at one cutoff the hum is a fan, and the ear
           writes a fan off inside about ten seconds. One very slow
           oscillator on the cutoff — a rise and fall every twenty seconds —
           is the difference between something that is running and something
           that is merely on. It rides on top of whatever the speed setting
           has ramped the cutoff to, because an AudioParam sums its
           connected input with its own scheduled value instead of being
           overwritten by it. */
        var lfo = ctx.createOscillator();
        var depth = ctx.createGain();
        lfo.frequency.value = 0.051;
        depth.gain.value = 130;
        lfo.connect(depth);
        depth.connect(filt.frequency);
        lfo.start();

        function ramp(param, value) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Six tenths of a second. Changing the speed is a deliberate act,
             so the hum should be heard following it rather than turn out to
             have already changed. */
          param.linearRampToValueAtTime(value, now + 0.6);
        }

        return {
          set: function (key, value) {
            if (key !== 'speed') return;
            /* 0.5..2.2 onto 0..1 on a log curve. The three settings are a
               ratio apart rather than a distance apart: map them linearly
               and Slow and Normal land almost on top of each other while
               Fast sits out on its own. */
            var span = Math.log(2.2 / 0.5);
            var k = Math.max(0, Math.min(1, Math.log(value / 0.5) / span));
            /* Faster is brighter and louder, but only slightly. This hum is
               the floor the whole toy stands on, and a floor that jumps
               when a select changes stops being a floor. */
            ramp(filt.frequency, 300 + k * 180);
            ramp(body.gain, 0.022 + k * 0.010);
            ramp(upper.gain, 0.013 + k * 0.007);
            ramp(hiss.gain, 0.0035 + k * 0.0035);
          }
        };
      });

      if (speedSel) {
        speedMul = Number(speedSel.value) || 1;
        speedSel.addEventListener('change', function () {
          speedMul = Number(speedSel.value) || 1;
          hum.set('speed', speedMul);
        });
      }
      hum.set('speed', speedMul);

      /* One column starting its fall, heard.

         The note is picked by COLUMN rather than at random, and that is
         worth the arithmetic: the pitch then carries the only spatial
         information this toy has — low on the left, high on the right — so
         a run of ticks reads as the field being scanned across. Random
         pitches out of the same table sound like a malfunction.

         The gate is the load-bearing part. Left ungated this fires once per
         column restart, which measures out at about ten a second at Normal
         and better than twenty at Fast — a machine gun, not a screensaver.
         Widening the gap with the speed setting lands all three settings on
         three or four ticks a second, and that flatness is the point: speed
         changes how fast the glyphs fall, and the ticks are there to
         punctuate that, not to measure it. The narrowest gap the formula
         can produce is 0.13 s, so even a clump of restarts arriving in one
         frame cannot get past about eight ticks a second. The tail shortens
         with speed for the same reason the gap widens — ticks landing
         closer together have to stop sounding sooner, or they smear into a
         second and much worse hum. */
      function tick(col) {
        if (!g.gate('column', 0.10 + speedMul * 0.06)) return;
        var note = TICKS[Math.floor(col / COLS * TICKS.length) % TICKS.length];
        g.pluck(note, 0.16 - speedMul * 0.03, 0.026, 'triangle');
      }

      function glyph() { return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)); }

      function seedDrop(col, above) {
        return {
          col: col,
          y: above ? -Math.random() * ROWS * 1.6 : Math.random() * -ROWS,
          v: 6 + Math.random() * 16,
          len: 6 + Math.floor(Math.random() * 16)
        };
      }

      return {
        reset: function () {
          cells = [];
          for (var i = 0; i < COLS * ROWS; i++) cells.push(glyph());
          drops = [];
          for (var c = 0; c < COLS; c++) {
            /* Not every column has a drop at once — a solid wall of rain
               reads as static rather than as weather. */
            if (Math.random() < 0.62) drops.push(seedDrop(c, false));
          }
        },

        update: function (dt) {
          g.stat('drops', drops.length);
          for (var i = 0; i < drops.length; i++) {
            var d = drops[i];
            d.y += d.v * speedMul * dt;
            if (d.y - d.len > ROWS) {
              drops[i] = seedDrop(d.col, true);
              tick(d.col);
            }
          }
          /* A few cells mutate every frame, so the field shimmers without
             the whole screen churning. */
          var churn = Math.ceil(COLS * ROWS * 0.012);
          for (var k = 0; k < churn; k++) {
            cells[Math.floor(Math.random() * cells.length)] = glyph();
          }
        },

        draw: function (term) {
          term.clear();
          for (var i = 0; i < drops.length; i++) {
            var d = drops[i];
            var head = Math.floor(d.y);
            for (var n = 0; n < d.len; n++) {
              var y = head - n;
              if (y < 0 || y >= ROWS) continue;
              var ch = cells[y * COLS + d.col];
              /* The head is white, the first few behind it bright, the tail
                 dim. Three bands is enough — a smooth gradient in a
                 sixteen-colour terminal was never the look. */
              var tint = n === 0 ? 'white' : n < d.len * 0.35 ? 'green' : 'dim';
              term.put(d.col, y, ch, tint);
            }
          }
        }
      };
    }
  });
})();

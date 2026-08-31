/* ==========================================================================
   disco.js — a light rig and the record it is running to.
   --------------------------------------------------------------------------
   ONE CLOCK. That is the whole architecture, and everything else in this
   file is downstream of it.

   A first attempt ran the music off a setInterval and the lights off the
   frame loop, which is the obvious thing to do and is wrong within about
   forty seconds: two timers that both mean "eight beats a second" disagree
   by a few milliseconds a minute, and a light rig that lands a quarter of a
   beat off the kick does not read as slightly late, it reads as broken.
   Nothing about a disco survives that.

   So there is one transport, `stepPos`, a fractional index into sixteenth
   notes, advanced by dt inside update(). Two readers take from it and
   NEITHER of them keeps a clock of its own:

     - the SEQUENCER runs ahead. WebAudio wants events booked against
       ctx.currentTime before they are due, so each sixteenth is handed to
       the bed about a seventh of a second early, carrying `at` — how many
       seconds after THIS FRAME the hit belongs. Because that offset is
       recomputed against the live frame every time, a late frame shortens
       the offset and the note still lands where it should. No drift can
       accumulate, because nothing is ever added to a running total.

     - the LIGHTS run on time. They fire the step the moment stepPos
       crosses it, out of the same pattern arrays the sequencer just read.
       Same clock, same tables, one source for both.

   Sweeps are functions of stepPos rather than of seconds, which is why
   changing the tempo speeds the rig up as well as the record, and why a
   sweep set to three bars stays three bars at any BPM.

   BEAMS ARE CONES, NOT CIRCLES. A spot in a hazy room is a visible shaft
   with a bright core, a soft penumbra, and a pool where it lands. Each one
   is three nested triangles — widest and dimmest first, narrowest and
   brightest last — under a gradient that fades along the axis, which is
   what haze extinction actually looks like. All of it is drawn with
   globalCompositeOperation 'lighter', so two beams crossing add rather than
   paint over each other: red across cyan gives white in the overlap, the
   same way it does in a real room, and no blend mode had to be invented for
   it. Twelve movers at three layers is thirty-six gradient fills a frame
   before the pools, the lenses, the two pin spots and the four washes are
   counted, which is the reason the fixture count tops out at twelve.

   ---- PHOTOSENSITIVITY ---------------------------------------------------
   This is the one part of the file that is not a taste decision.

   Fast flashing light can trigger seizures in people with photosensitive
   epilepsy. WCAG 2.3.1 sets the general threshold at three flashes in any
   one second; the guidance is to stay under it with room to spare rather
   than to sit on it. A disco toy that ignores this is not edgy, it is a
   page that can put somebody in hospital.

   Five rules, all of them enforced below rather than described in the copy:

     1. WITH STROBE OFF THERE IS NO FULL-FIELD FLASH AT ALL. The only
        rhythmic luminance change is the pump on the beams — a smooth
        envelope on coloured light over part of the frame, not a white
        frame — and it is capped at two per second by PUMP_MAX_HZ. Above
        120 BPM the pump halves to every other beat rather than tracking
        the kick, so the fastest it can ever run is 1.17 Hz at the top
        tempo. That is a third of the threshold.

     2. STROBE STARTS OFF, ALWAYS, and it starts off again on every
        restart. A control that can hurt somebody does not get to be
        sticky.

     3. THE FIRST PRESS OF THE STROBE BUTTON DOES NOT STROBE. It shows the
        warning and arms; the second press within the window turns it on.
        The requirement is that a warning is visible BEFORE any flashing
        can begin, and the only way to guarantee that is to make the
        warning the first thing the button does.

     4. THE STROBE IS RATE-CAPPED TOO, and this rule was missing from the
        first version of the file. Opting in did not raise the ceiling: the
        burst used to fire one flash a sixteenth, 8.3 a second at 124 BPM,
        which is nearly three times the threshold. Consent is the wrong
        instrument here — nobody can consent on behalf of their own nervous
        system — so the burst is now a fixed COUNT of flashes at a capped
        RATE. flashStride() divides the sixteenth rate by PUMP_MAX_HZ and
        rounds up, which puts every tempo between 1.6 and 1.9 flashes a
        second, and STROBE_FLASHES holds a fill to three of them.

     5. prefers-reduced-motion HALVES EVERY SWEEP, pumps at half depth, and
        REFUSES THE STROBE OUTRIGHT — the button is disabled and pressStrobe
        returns before it can arm. Not a reduction, a refusal: a visitor who
        has told their operating system they do not want movement has
        already answered the only question the strobe asks, and the page
        copy on /games/disco promises exactly this in as many words. It is a
        request about motion, and this toy is nothing but motion.

   Blackout kills the light AND disarms the strobe, so coming out of a
   panic press can never resume a flash. It leaves the music alone: a
   lighting desk's DBO is a light control, and a safety button that quietly
   does two things is a safety button nobody can predict.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 440;
  var TAU = Math.PI * 2;

  /* Where the back wall meets the floor. Everything above is wall, so a
     beam that lands above this line is a wash and one that lands below it
     is a pool on the deck. */
  var FLOOR_Y = 316;

  var TRUSS_Y = 26;
  var TRUSS_X0 = 52;
  var TRUSS_X1 = 588;

  var BALL_X = 320;
  var BALL_Y = 104;
  var BALL_R = 17;

  /* Seconds of audio booked ahead of the current frame. Long enough that a
     dropped frame cannot make a sixteenth late — at 60 Hz two consecutive
     bad frames still fit inside it — and short enough that a tempo change
     is heard within a beat rather than a bar. */
  var LOOK = 0.14;

  /* The ceiling on how often the beams may pump, in hertz. See rule 1 in
     the header: three flashes a second is the threshold, and this sits at
     two thirds of it before the halving above 120 BPM is applied. */
  var PUMP_MAX_HZ = 2;

  /* Flashes in one strobe fill. The burst is counted rather than timed,
     because the gap between flashes is set by the rate cap in
     flashStride() and therefore changes with the tempo — fixing the LENGTH
     instead would quietly change how many flashes a visitor gets when they
     move the tempo selector, which is the wrong thing to leave loose.
     Three is a fill; at the capped rate it runs for about a second and a
     half, once every four bars. */
  var STROBE_FLASHES = 3;

  /* Sixteen steps to the bar. All six tables are read twice — once by the
     sequencer a seventh of a second early, once by the lights on the beat —
     and that is the entire reason they are module-level constants rather
     than something either half builds for itself. */
  var KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  var CLAP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
  var HAT = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  var GHOST = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
  var OPEN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
  /* Semitones above the bar's root, or -1 for a rest. House bass sits on
     the offbeat eighth so it interlocks with the kick instead of fighting
     it; the octave on the last sixteenth is the push into the next bar. */
  var BASS = [-1, -1, 0, -1, -1, -1, 0, -1, -1, -1, 0, -1, -1, -1, 0, 12];
  var STAB = [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0];

  /* Four bars of A minor: i - VI - III - VII. The bass takes the root, the
     pad takes the triad. Written as frequencies rather than as note names
     because nothing here needs to name a note, and a table of numbers
     cannot disagree with itself about what A is. */
  var ROOTS = [55.00, 43.65, 65.41, 49.00];
  var CHORDS = [
    [220.00, 261.63, 329.63],
    [174.61, 220.00, 261.63],
    [261.63, 329.63, 392.00],
    [196.00, 246.94, 293.66]
  ];

  /* Palettes as raw triples, so a colour can be faded to another one by
     interpolating three numbers instead of by parsing a string every
     frame. 'White' is here as the option that is closest to a plain
     tungsten rig, for a visitor who wants the movement without the colour. */
  var PALETTES = {
    club: [[255, 42, 138], [36, 214, 255], [255, 176, 32], [124, 252, 130], [168, 85, 247]],
    warm: [[255, 86, 40], [255, 168, 48], [255, 52, 96], [255, 214, 120], [222, 66, 26]],
    cool: [[40, 150, 255], [36, 232, 220], [130, 90, 255], [90, 200, 255], [60, 255, 190]],
    white: [[255, 236, 205], [255, 248, 236], [236, 240, 255], [255, 226, 180], [255, 244, 220]]
  };

  /* How many bars one pan sweep takes. Deliberately not all divisors of
     four: a rig where every sweep divides the phrase repeats itself every
     bar and stops being worth watching inside a minute. Three against a
     four-bar loop means the whole rig only comes back into phase every
     twelve bars. */
  var SWEEP_BARS = [2, 3, 4, 3];

  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }

  GameShell.define({
    id: 'game-disco',
    slug: 'disco',
    title: 'Disco',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      /* Asked once. A visitor who has told their operating system they do
         not want movement has told every page on it, and re-reading the
         query per frame would only let it change under a toy that is
         already running. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var bpm = 124;
      var moverCount = 8;
      var palName = 'club';
      var pal = PALETTES[palName];
      var haze = 0.55;
      var blackout = false;

      /* Strobe has three states and they are not the same thing: `strobeOn`
         is what the visitor asked for, `warnAt` is the transport position
         the warning went up at, and the button only ever moves from off to
         on through the warning. See rule 3. */
      var strobeOn = false;
      var warnAt = -1;

      /* The transport. Fractional sixteenths since the run began; the only
         time value in this file that anything is derived from. */
      var stepPos = 0;
      var schedStep = 0;      // next sixteenth handed to the sequencer
      var litStep = -1;       // last sixteenth the lights have fired

      var pump = 0;           // beam bloom on the kick, decays on its own
      /* A strobe burst is three numbers, not one, and it has to be, because
         the rate is capped rather than fixed: `strobeFrom` is the step the
         burst began on, `strobeStep` is how many sixteenths apart its
         flashes are at the tempo it was armed at, and `strobeUntil` is
         where it ends. Reading the stride back off the live BPM instead
         would let a tempo change mid-burst move a flash that has already
         been counted, which is the one thing a rate cap cannot allow. */
      var strobeFrom = -1;
      var strobeStep = 4;
      var strobeUntil = -1;   // stepPos the current strobe burst ends at
      var movers = [];
      var spot = null;        // the follow spot, while a pointer is over the room

      var tempoSel = document.getElementById('game-tempo');
      var fixSel = document.getElementById('game-fixtures');
      var palSel = document.getElementById('game-palette');
      var hazeIn = document.getElementById('game-haze');
      var strobeBtn = document.getElementById('game-strobe');
      var blackBtn = document.getElementById('game-blackout');

      /* ---------------------------------------------------------------
         The record.

         Five voices and a pad, all struck from one entry point, because
         the sequencer upstairs hands down a whole sixteenth at a time and
         a per-voice API would mean five calls where one will do.

         Every voice takes `when` in context time, which is the frame's
         clock plus the offset the step carried. That is the join between
         the two halves of this file: the lights read the step at t, the
         audio was told about it at t minus a seventh of a second and told
         to wait. Neither one is following the other.

         Levels. The shell's one-shots peak around 0.06 and its beds run an
         order of magnitude below that, and both figures are the wrong
         reference here — a kick drum is short, low, and the thing the rest
         of the mix is built around. So the kick gets 0.13 and everything
         else is set by ear against it, with the worst-case simultaneous
         sum kept under a quarter of full scale so nothing can clip on the
         downbeat where four of them land together.
         --------------------------------------------------------------- */
      var music = g.bed(function (a) {
        var ctx = a.ctx;
        var noise = a.noise();

        /* The pad. Three sawtooths through one lowpass, retuned on the bar
           rather than restruck: a chord that is always sounding is what
           stops the gaps between drum hits being holes, and restriking it
           would put a sixth event on a downbeat that already has four. */
        var padFilt = ctx.createBiquadFilter();
        padFilt.type = 'lowpass';
        padFilt.frequency.value = 680;
        padFilt.Q.value = 0.8;
        var padGain = ctx.createGain();
        padGain.gain.value = 0.010;
        padFilt.connect(padGain);
        padGain.connect(a.out);

        var pad = [];
        var i;
        for (i = 0; i < 3; i++) {
          var po = ctx.createOscillator();
          po.type = 'sawtooth';
          po.frequency.value = CHORDS[0][i];
          /* A few cents apart. Three saws at exactly the same pitch are one
             saw with more gain; the detune is the entire difference between
             a chord and a buzz. */
          po.detune.value = (i - 1) * 7;
          po.connect(padFilt);
          po.start();
          pad.push(po);
        }

        /* A slow breath on the cutoff. Without it the pad is a held drone
           and the ear writes it off inside ten seconds, which is the same
           failure a static wind layer has. */
        var padLfo = ctx.createOscillator();
        var padDepth = ctx.createGain();
        padLfo.frequency.value = 0.07;
        padDepth.gain.value = 140;
        padLfo.connect(padDepth);
        padDepth.connect(padFilt.frequency);
        padLfo.start();

        function burst(when, dur, type, f0, f1, q, level) {
          var src = ctx.createBufferSource();
          src.buffer = noise;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.setValueAtTime(f0, when);
          if (f1) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), when + dur);
          filt.Q.value = q;
          var gain = ctx.createGain();
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(level, when + 0.004);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
          src.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          /* A random read position in the shared buffer. Hats fire eight
             times a bar, and the same thirty milliseconds of noise eight
             times a bar is heard as a sample, not as a cymbal. */
          var span = noise.duration - dur - 0.05;
          src.start(when, span > 0 ? Math.random() * span : 0, dur + 0.05);
          src.stop(when + dur + 0.06);
        }

        function kick(when, level) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          /* The pitch envelope is the kick. Hold it at 48 Hz and you have a
             thud that a laptop speaker cannot reproduce at all; sweeping it
             down from 150 puts the attack in the range a small speaker can
             actually move air at, and the ear reconstructs the rest. */
          osc.frequency.setValueAtTime(150, when);
          osc.frequency.exponentialRampToValueAtTime(48, when + 0.08);
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(level, when + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.30);
          osc.connect(gain);
          gain.connect(a.out);
          osc.start(when);
          osc.stop(when + 0.34);
          /* Twelve milliseconds of highpassed noise on top. On a phone
             speaker the sine is most of the way to inaudible and this click
             is the entire kick; on anything with a woofer it is a detail
             nobody notices. It has to be there for the first case. */
          burst(when, 0.012, 'highpass', 2400, 0, 0.7, 0.018);
        }

        function clap(when) {
          /* Three retriggers twelve milliseconds apart, then a tail. One
             burst of noise is a snare; a hand clap is several hands not
             quite agreeing, and that spread is the whole character. */
          burst(when, 0.020, 'bandpass', 1500, 1200, 1.4, 0.024);
          burst(when + 0.012, 0.020, 'bandpass', 1600, 1200, 1.4, 0.022);
          burst(when + 0.024, 0.150, 'bandpass', 1350, 900, 1.1, 0.030);
        }

        function bass(when, freq, dur) {
          var osc = ctx.createOscillator();
          var filt = ctx.createBiquadFilter();
          var gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, when);
          filt.type = 'lowpass';
          /* A filter envelope, not just a gain envelope. A lowpass that
             closes from 900 to 260 over the note is what makes a sawtooth
             read as a plucked bass rather than as a buzzer held down. */
          filt.frequency.setValueAtTime(900, when);
          filt.frequency.exponentialRampToValueAtTime(260, when + dur);
          filt.Q.value = 4;
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(0.050, when + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
          osc.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          osc.start(when);
          osc.stop(when + dur + 0.03);
        }

        function stab(when, chord) {
          var filt = ctx.createBiquadFilter();
          var gain = ctx.createGain();
          filt.type = 'lowpass';
          filt.frequency.setValueAtTime(2600, when);
          filt.frequency.exponentialRampToValueAtTime(700, when + 0.20);
          filt.Q.value = 2;
          gain.gain.setValueAtTime(0.0001, when);
          gain.gain.exponentialRampToValueAtTime(0.022, when + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
          filt.connect(gain);
          gain.connect(a.out);
          for (var k = 0; k < chord.length; k++) {
            var o = ctx.createOscillator();
            o.type = 'sawtooth';
            /* An octave above the pad's voicing. Down at the pad's own
               register the stab disappears into it and the offbeat, which
               is the only reason the stab exists, stops being heard. */
            o.frequency.setValueAtTime(chord[k] * 2, when);
            o.detune.value = (k - 1) * 6;
            o.connect(filt);
            o.start(when);
            o.stop(when + 0.26);
          }
        }

        /* THE FIRST STEP MAY BE A GHOST, and dropping it when it is one is
           not defensive coding — it is a known consequence of how the shell
           works. A bed remembers the last value set on each key and replays
           it when the nodes are finally built. If a visitor unmutes in the
           middle of a run, the remembered step is replayed carrying an
           offset that was measured against a frame long gone, so it fires a
           hit a few milliseconds off the grid: a flam against the next real
           one, every single time anyone turns the sound on.

           `seq` is what tells a ghost from an honest downbeat. A bed built
           at the start of the run has never been handed a step, so the
           first one it sees is genuinely step zero and must play. A bed
           built mid-run gets the replay first, and that one arrives with a
           sequence number in the hundreds. One test, and neither case
           loses a note it should have had. */
        var warm = false;

        return {
          set: function (key, value) {
            if (key === 'step') {
              /* A SUSPENDED CONTEXT HAS A FROZEN CLOCK, and booking notes
                 against a clock that is not moving is how a sequencer
                 explodes. Mute the toy and the shell fades the bus, then
                 suspends the context about three quarters of a second
                 later — but update() carries on, because a toy with
                 pauseOnBlur false is still running. Every step after that
                 would be scheduled at the same frozen currentTime plus at
                 most a seventh of a second, so ten seconds of silence
                 stacks eighty sixteenths into one window and unmuting
                 fires the lot as a single crack.

                 The lights do not care and must not stop: the rig keeps
                 running whether anyone can hear it or not. Only the notes
                 are dropped, and they were inaudible anyway. */
              if (ctx.state !== 'running') return;
              if (!warm) { warm = true; if (value.seq > 0) return; }
              var when = ctx.currentTime + (value.at > 0 ? value.at : 0);
              if (value.chord) {
                for (var c = 0; c < 3; c++) pad[c].frequency.setValueAtTime(value.chord[c], when);
              }
              if (value.kick) kick(when, 0.13);
              if (value.clap) clap(when);
              if (value.open) burst(when, 0.20, 'highpass', 7000, 0, 0.7, 0.020);
              else if (value.hat) burst(when, 0.032, 'highpass', 7600, 0, 0.7, 0.017);
              else if (value.ghost) burst(when, 0.022, 'highpass', 8200, 0, 0.7, 0.006);
              if (value.bass) bass(when, value.bass, value.bassDur);
              if (value.stab) stab(when, value.stabChord);
              return;
            }
            if (key === 'air') {
              /* The haze slider is a lighting control that also belongs on
                 the sound: a room full of smoke is a room where the top end
                 has somewhere to go. It opens the pad rather than changing
                 its level, so the mix does not move when the picture does. */
              var now = ctx.currentTime;
              padFilt.frequency.cancelScheduledValues(now);
              padFilt.frequency.setValueAtTime(padFilt.frequency.value, now);
              padFilt.frequency.linearRampToValueAtTime(480 + value * 520, now + 0.4);
            }
          }
        };
      });

      /* ---------------------------------------------------------------
         The rig.
         --------------------------------------------------------------- */
      function buildRig() {
        movers = [];
        for (var i = 0; i < moverCount; i++) {
          var t = moverCount === 1 ? 0.5 : i / (moverCount - 1);
          var c = pal[i % pal.length];
          movers.push({
            x: TRUSS_X0 + (TRUSS_X1 - TRUSS_X0) * t,
            y: TRUSS_Y + 12,
            /* Every third fixture steps and holds instead of sweeping. A
               rig where everything sweeps together is a windscreen wiper;
               the mix of continuous movement and hard cues on the beat is
               what makes it read as a rig rather than as one oscillator
               driving eight things. */
            hold: (i % 3) === 2,
            phase: t * TAU,
            bars: SWEEP_BARS[i % SWEEP_BARS.length],
            swing: 0.55 + ((i % 2) ? 0.35 : 0),
            pan: 0,
            panTo: 0,
            ci: i % pal.length,
            col: [c[0], c[1], c[2]],
            colTo: [c[0], c[1], c[2]]
          });
        }
        g.stat('lights', moverCount);
      }

      /* Mirror-ball facets, laid out once with the golden-angle spiral so
         they are evenly spread over the sphere rather than bunched at the
         poles the way a naive lat/long loop leaves them. Only the direction
         is stored; where a dot lands is recomputed every frame from the
         rotation, which is one sine and one cosine per dot. */
      var DOTS = 120;
      var facets = [];
      (function () {
        var golden = Math.PI * (1 + Math.sqrt(5));
        for (var i = 0; i < DOTS; i++) {
          facets.push({
            u: golden * i,
            v: Math.acos(1 - 2 * (i + 0.5) / DOTS)
          });
        }
      })();

      function syncStrobeBtn() {
        if (!strobeBtn) return;
        /* Under reduced motion the control is not merely inert, it is
           visibly out of service. An enabled button that silently refuses
           is worse than a disabled one: the visitor presses it twice,
           nothing flashes, and the only conclusion available to them is
           that the page is broken. disabled says which of the two it is,
           and the title says why. */
        if (reduced) {
          strobeBtn.disabled = true;
          strobeBtn.setAttribute('aria-pressed', 'false');
          strobeBtn.title = 'Strobe is off: your system asks for reduced motion';
          return;
        }
        strobeBtn.setAttribute('aria-pressed', String(strobeOn));
        strobeBtn.title = strobeOn
          ? 'Strobe is on — click to stop the flashing'
          : 'Strobe: fast flashing light, off by default';
      }

      function syncBlackBtn() {
        if (!blackBtn) return;
        blackBtn.setAttribute('aria-pressed', String(blackout));
        blackBtn.title = blackout ? 'Lights are out — click to bring them back' : 'Blackout: kill every light at once';
      }

      /* How many sixteenths apart two strobe flashes are, and this is the
         one number in the file nobody gets to tune by eye.

         The first version flashed once a sixteenth, which is 8.3 a second
         at 124 BPM — nearly three times the WCAG 2.3.1 general threshold of
         three flashes in any one second, on a full-field white lift. That
         the visitor had opted in twice does not help: the whole reason the
         threshold is written as a rate rather than as a consent question is
         that a seizure is not something anyone can consent to on behalf of
         their own nervous system. So the burst is a fixed COUNT of flashes
         at a capped RATE, rather than a fixed length at the tempo's rate.

         The ceiling is PUMP_MAX_HZ, the same two per second the pump is
         held to, which is two thirds of the threshold. Ceiling division
         gives four sixteenths at the slowest tempo and five at the fastest
         — 1.6 to 1.9 flashes a second, whatever the record is doing.

         Under reduced motion this is never reached at all, because the
         strobe is refused outright there — see pressStrobe(). */
      function flashStride() {
        var sixteenthHz = (bpm / 60) * 4;
        var n = Math.ceil(sixteenthHz / PUMP_MAX_HZ);
        return n < 1 ? 1 : n;
      }

      /* The panic control, reachable from the button, from the pad and from
         Space. It disarms the strobe on the way down and does not re-arm it
         on the way up: somebody who hits this because the flashing was too
         much must not have it come back when they let go. */
      function setBlackout(on) {
        blackout = on;
        if (on) {
          strobeOn = false;
          warnAt = -1;
          strobeFrom = -1;
          strobeUntil = -1;
          syncStrobeBtn();
        }
        syncBlackBtn();
        g.announce(on ? 'Blackout. All lights out, strobe disarmed.' : 'Lights back on.');
      }

      /* Two presses, and the first one is the warning. See rule 3 in the
         header — the point is that no visitor can reach a flash without a
         warning having been on the screen first, and the only version of
         that which cannot be got around is one where the warning IS the
         first press. */
      function pressStrobe() {
        /* Rule 5, and it is a refusal rather than a reduction. A visitor
           who has told their operating system they do not want movement has
           already answered the only question the strobe asks, and the page
           copy on /games/disco says in as many words that the strobe stays
           off entirely when the browser reports prefers-reduced-motion.
           Honouring that setting halfway would leave the page making a
           promise about a seizure risk that the code did not keep. */
        if (reduced) {
          g.announce('Strobe is off because your system asks for reduced motion. ' +
            'The rest of the rig does not flash.');
          return;
        }
        if (strobeOn) {
          strobeOn = false;
          strobeFrom = -1;
          strobeUntil = -1;
          warnAt = -1;
          syncStrobeBtn();
          g.announce('Strobe off.');
          return;
        }
        /* Sixteen sixteenths of grace, which is one bar — long enough to
           read the panel at any tempo the toy offers, short enough that a
           press left armed all session cannot turn into a flash somebody
           has forgotten about. */
        if (warnAt >= 0 && stepPos - warnAt < 16) {
          warnAt = -1;
          strobeOn = true;
          if (blackout) setBlackout(false);
          syncStrobeBtn();
          g.announce('Strobe on. Fast flashing light.');
          return;
        }
        warnAt = stepPos;
        g.announce('Warning: strobe uses fast flashing light, which can trigger seizures in people with ' +
          'photosensitive epilepsy. Press strobe again to turn it on.');
      }

      if (tempoSel) tempoSel.addEventListener('change', function () {
        bpm = Number(tempoSel.value) || 124;
        g.stat('bpm', bpm);
      });
      if (fixSel) fixSel.addEventListener('change', function () {
        moverCount = Number(fixSel.value) || 8;
        buildRig();
      });
      if (palSel) palSel.addEventListener('change', function () {
        palName = PALETTES[palSel.value] ? palSel.value : 'club';
        pal = PALETTES[palName];
        for (var i = 0; i < movers.length; i++) {
          var c = pal[movers[i].ci % pal.length];
          movers[i].colTo = [c[0], c[1], c[2]];
        }
      });
      function clampHaze(v) {
        if (!(v >= 0)) return 0;          // catches NaN as well as negatives
        return v > 1 ? 1 : v;
      }

      if (hazeIn) hazeIn.addEventListener('input', function () {
        haze = clampHaze(Number(hazeIn.value) / 100);
        music.set('air', haze);
      });
      if (strobeBtn) strobeBtn.addEventListener('click', pressStrobe);
      if (blackBtn) blackBtn.addEventListener('click', function () { setBlackout(!blackout); });

      /* S, bound here rather than through the key hook, because the shell's
         KEYMAP knows four arrows, Space, Enter and Escape and nothing else —
         so hooks.key() is never called for a letter and the page's own
         "S — strobe on or off" would have been a key list promising a
         control that does not exist.

         Scoped the way the shell scopes its own keyboard: only while a run
         is live, and only when focus is inside this game or nowhere in
         particular. Without the second half, pressing S while typing in the
         site search would arm a strobe behind the dialog. The site's own
         single-letter shortcuts are not a conflict — particle-bg.js reads
         data-state off the shell root and stands down while a run is
         playing, which is the whole reason the shell mirrors it there. */
      document.addEventListener('keydown', function (event) {
        if (event.key !== 's' && event.key !== 'S') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (g.state !== 'playing') return;
        var focused = document.activeElement;
        if (focused && focused !== document.body && !g.el.contains(focused)) return;
        event.preventDefault();
        pressStrobe();
      });

      if (g.canvas) {
        /* The pointer is a follow spot: one extra fixture on the truss
           centre that points wherever you do. It is the only light in the
           room a visitor can aim, and it is white on every palette so it
           reads as a spot rather than as a thirteenth mover. */
        g.canvas.addEventListener('pointermove', function (event) {
          spot = g.pointAt(event);
        });
        g.canvas.addEventListener('pointerleave', function () { spot = null; });
      }

      /* Which sixteenth this is, and what the bar under it is doing. Both
         readers call this with the same index and get the same answer,
         which is the point. */
      function stepData(index) {
        var i = ((index % 16) + 16) % 16;
        var bar = Math.floor(index / 16);
        var chordIx = ((bar % 4) + 4) % 4;
        return { i: i, bar: bar, chord: chordIx };
      }

      /* ---------------------------------------------------------------
         Update: advance the transport, book the audio ahead of it, fire
         the lights on it.
         --------------------------------------------------------------- */
      function schedule(sixteenth) {
        var ahead = LOOK / sixteenth;
        var guard = 0;
        while (schedStep < stepPos + ahead && guard < 64) {
          guard++;
          var d = stepData(schedStep);
          var payload = {
            seq: schedStep,
            at: (schedStep - stepPos) * sixteenth,
            kick: KICK[d.i],
            clap: CLAP[d.i],
            hat: HAT[d.i],
            ghost: GHOST[d.i],
            open: OPEN[d.i],
            bass: 0,
            bassDur: sixteenth * 1.6,
            stab: STAB[d.i],
            stabChord: CHORDS[d.chord],
            chord: d.i === 0 ? CHORDS[d.chord] : null
          };
          if (BASS[d.i] >= 0) {
            payload.bass = ROOTS[d.chord] * Math.pow(2, BASS[d.i] / 12);
          }
          music.set('step', payload);
          schedStep++;
        }
      }

      function fireLights(index, sixteenth) {
        var d = stepData(index);

        /* WHICH BAR OF THE FOUR, not how many bars have gone by. The
           generated page labels this cell "Bar", and a counter that only
           ever goes up would be a stopwatch wearing a musician's word. The
           number a lighting operator is actually holding is the position
           in the phrase — the movers recolour on it, the washes cross-fade
           on it, and the strobe fill lands on the fourth — so that is what
           the cell says. Written from the transport rather than from a
           frame, so the HUD and the rig cannot disagree. */
        if (d.i === 0) g.stat('bar', (d.bar % 4) + 1);

        /* The pump. Not every kick — see rule 1. Above 120 BPM the beat is
           faster than PUMP_MAX_HZ allows, so the rig pumps in half time,
           which at 140 BPM is 1.17 flashes a second against a threshold of
           three. It is also, as it happens, what a real operator does with
           a fast record. */
        if (KICK[d.i]) {
          var beatHz = bpm / 60;
          var everyN = beatHz > PUMP_MAX_HZ ? 2 : 1;
          var beatIx = Math.floor(index / 4);
          if ((beatIx % everyN) === 0) pump = reduced ? 0.5 : 1;
        }

        /* Movers take a cue on the beat and change colour on the bar. Only
           half of them change on any given bar — a rig that recolours
           everything at once is a lamp, not a rig. */
        var m, c;
        if ((d.i % 4) === 0) {
          for (var k = 0; k < movers.length; k++) {
            m = movers[k];
            if (!m.hold) continue;
            /* Five holds spread across the pan range, picked at random but
               never the one it is already sitting on, so a cue is always
               visible as a move. */
            var slot = Math.floor(Math.random() * 5);
            var target = (slot / 2 - 1) * m.swing * 1.15;
            if (Math.abs(target - m.panTo) < 0.05) target = -target;
            m.panTo = target;
          }
        }
        if (d.i === 0) {
          for (var j = 0; j < movers.length; j++) {
            if (((d.bar + j) % 2) !== 0) continue;
            m = movers[j];
            m.ci = (m.ci + 1) % pal.length;
            c = pal[m.ci];
            m.colTo = [c[0], c[1], c[2]];
          }
        }

        /* The strobe fill: the last beat of every fourth bar, and nowhere
           else. Once every four bars is roughly once every eight seconds at
           these tempos, which is a fill rather than a room that never stops
           flashing — and it means the hazard is bounded in time as well as
           in rate even after somebody has explicitly asked for it. */
        if (strobeOn && !blackout && (d.bar % 4) === 3 && d.i === 12) {
          strobeFrom = index;
          strobeStep = flashStride();
          strobeUntil = index + strobeStep * STROBE_FLASHES;
        }
      }

      /* ---------------------------------------------------------------
         Drawing helpers. All of these assume 'lighter' is already set.
         --------------------------------------------------------------- */

      /* How far a ray from (ax, ay) travels before it leaves the room. The
         beam is cut there rather than at a fixed length, so a fixture
         pointing at the side wall gets a short shaft and a pool on the
         wall, and one pointing at the deck gets a long one. */
      function castLen(ax, ay, dx, dy) {
        var best = 1400;
        var t;
        if (dy > 0.0001) { t = (H - ay) / dy; if (t < best) best = t; }
        if (dx > 0.0001) { t = (W - ax) / dx; if (t < best) best = t; }
        else if (dx < -0.0001) { t = (0 - ax) / dx; if (t < best) best = t; }
        return best;
      }

      /* A cone with a core. Three nested triangles: the widest at the
         lowest alpha is the penumbra you see in the haze, the narrowest at
         the highest alpha is the beam itself. Drawing one triangle with a
         flat fill gives a paper cut-out; drawing forty gives a smooth cone
         and eats the frame. Three is where it stops looking like a shape
         and starts looking like light. */
      var LAYERS = [
        { spread: 1.00, alpha: 0.085 },
        { spread: 0.58, alpha: 0.130 },
        { spread: 0.26, alpha: 0.230 }
      ];

      function beam(ctx, ax, ay, pan, half, col, power, hazeK, inPlane, cap) {
        if (power <= 0.01) return;
        var dx = Math.sin(pan);
        var dy = Math.cos(pan);
        var len = castLen(ax, ay, dx, dy) * inPlane;
        /* `cap` is for a beam that stops at something rather than at a wall
           — the two pin spots end on the mirror ball. Without it they ran
           on to the far wall and read as two more movers, which is the
           opposite of what a pin spot is for. */
        if (cap && len > cap) len = cap;
        if (len < 12) return;

        var ex = ax + dx * len;
        var ey = ay + dy * len;
        var px = -dy;
        var py = dx;
        var k, L, wid, grd;

        for (k = 0; k < LAYERS.length; k++) {
          L = LAYERS[k];
          wid = Math.tan(half * L.spread) * len;
          grd = ctx.createLinearGradient(ax, ay, ex, ey);
          var a0 = L.alpha * power * (k === 2 ? 1 : hazeK);
          if (a0 > 0.85) a0 = 0.85;
          grd.addColorStop(0, rgba(col, a0));
          /* Where the shaft has faded to nothing. More haze in the air
             means more of it is lit, so the mid stop moves down the beam
             with the slider rather than the alpha simply going up — a
             brighter uniform shaft is a laser, not smoke. */
          grd.addColorStop(0.35 + 0.4 * hazeK, rgba(col, a0 * 0.30));
          grd.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ex + px * wid, ey + py * wid);
          ctx.lineTo(ex - px * wid, ey - py * wid);
          ctx.closePath();
          ctx.fill();
        }

        /* The pool where it lands. Squashed hard on the deck because that
           is a circle seen at a glancing angle, and left round on the wall
           because that one is seen face on. */
        var onFloor = ey > FLOOR_Y - 2;
        var pr = Math.tan(half) * len * 1.9 + 10;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.scale(1, onFloor ? 0.30 : 0.85);
        var pg = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
        var pa = 0.34 * power;
        if (pa > 0.8) pa = 0.8;
        pg.addColorStop(0, rgba(col, pa));
        pg.addColorStop(0.4, rgba(col, pa * 0.35));
        pg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(0, 0, pr, 0, TAU);
        ctx.fill();
        ctx.restore();

        /* The lens itself, and a bloom around it that grows with the haze.
           Without this the beams begin in mid-air a few pixels below the
           fixture, which is the one thing that gives the whole trick away. */
        var lg = ctx.createRadialGradient(ax, ay, 0, ax, ay, 16 + 16 * hazeK);
        lg.addColorStop(0, rgba(col, Math.min(0.9, 0.55 * power)));
        lg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(ax, ay, 16 + 16 * hazeK, 0, TAU);
        ctx.fill();
      }

      function drawBall(ctx, bars, bloom, hazeK) {
        /* One turn every four bars, so the field of dots comes back round
           with the chord progression. Under reduced motion it takes eight,
           which is slow enough that the dots read as drifting rather than
           as travelling. */
        var rot = TAU * bars / (reduced ? 8 : 4);
        var tint = pal[Math.floor(bars) % pal.length];
        var i, f;

        /* The pin. Two of them, from either side, because a single pinspot
           lights half a ball and the dead half is very obvious. Both stop
           at the ball's surface rather than at a wall. */
        var pinDy = BALL_Y - TRUSS_Y - 12;
        var pinAng = Math.atan2(150, pinDy);
        var pinLen = Math.sqrt(150 * 150 + pinDy * pinDy) - BALL_R * 0.5;
        beam(ctx, BALL_X - 150, TRUSS_Y + 12, pinAng, 0.035,
          [255, 250, 235], bloom * 0.8, hazeK * 0.7, 1, pinLen);
        beam(ctx, BALL_X + 150, TRUSS_Y + 12, -pinAng, 0.035,
          [255, 250, 235], bloom * 0.8, hazeK * 0.7, 1, pinLen);

        /* The dots. Each facet's normal is taken as the direction its
           reflection goes, which is the cheap approximation everybody uses
           and is wrong by exactly the angle of incidence — the field it
           produces is the right shape and the right density, and nothing
           about a mirror ball at this size survives being more correct.

           Only facets pointing away from the viewer land on the back wall;
           the rest would be behind the camera, and skipping them is why the
           field is dense in the middle and thins toward the edges, which is
           what a real one does. */
        for (i = 0; i < facets.length; i++) {
          f = facets[i];
          var a = f.u + rot;
          var sv = Math.sin(f.v);
          var dx = sv * Math.cos(a);
          var dy = Math.cos(f.v);
          var dz = sv * Math.sin(a);
          if (dz < 0.10) continue;

          var t = 130 / dz;
          var x = BALL_X + dx * t;
          var y = BALL_Y + dy * t;
          if (x < -30 || x > W + 30 || y < -30) continue;

          /* Dots that would land past the horizon are squashed into the
             deck by a constant rather than by a second ray cast against a
             floor plane. Perspective would compress them in exactly this
             direction, so the cheat is invisible and costs one multiply. */
          if (y > FLOOR_Y) y = FLOOR_Y + (y - FLOOR_Y) * 0.45;
          if (y > H + 20) continue;

          /* Brightest around 45 degrees off the viewing axis, which is
             where a facet actually throws light at the wall rather than
             straight back at the room. */
          var b = 1 - Math.abs(dz - 0.45) * 1.7;
          if (b <= 0) continue;
          b *= bloom * (0.55 + 0.45 * hazeK);

          var r = 1.2 + t * 0.006;
          ctx.fillStyle = 'rgba(' +
            Math.round(210 + tint[0] * 0.18) + ',' +
            Math.round(215 + tint[1] * 0.15) + ',' +
            Math.round(225 + tint[2] * 0.12) + ',' + (b * 0.55).toFixed(3) + ')';
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }

        /* The ball. A sphere gradient, then a ring of specular facets that
           turn with the dot field so the thing throwing them is visibly
           the thing turning. */
        var bg = ctx.createRadialGradient(BALL_X - 6, BALL_Y - 7, 1, BALL_X, BALL_Y, BALL_R * 1.6);
        bg.addColorStop(0, 'rgba(226,232,240,0.55)');
        bg.addColorStop(0.5, 'rgba(148,163,184,0.16)');
        bg.addColorStop(1, 'rgba(148,163,184,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(BALL_X, BALL_Y, BALL_R * 1.6, 0, TAU);
        ctx.fill();

        for (i = 0; i < 26; i++) {
          var fa = (i / 26) * TAU + rot;
          var rr = BALL_R * (0.35 + 0.6 * ((i % 5) / 5));
          var fx = BALL_X + Math.cos(fa) * rr;
          var fy = BALL_Y + Math.sin(fa * 0.7) * rr * 0.8;
          ctx.fillStyle = 'rgba(241,245,249,' + (0.10 + 0.35 * Math.max(0, Math.cos(fa))).toFixed(3) + ')';
          ctx.fillRect(fx - 1.4, fy - 1.4, 2.8, 2.8);
        }
      }

      /* The warning. Deliberately plain: a dark panel, a rule, and the two
         sentences that matter, in the middle of the frame where it cannot
         be missed. It says what the risk is and what pressing again will
         do, because a warning that only says "are you sure" tells a visitor
         nothing they can decide with. */
      function drawWarning(ctx) {
        var bw = 460;
        var bh = 132;
        var bx = (W - bw) / 2;
        var by = (H - bh) / 2;

        ctx.fillStyle = 'rgba(2,6,23,0.94)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = 'rgba(251,191,36,0.85)';
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 15px "Segoe UI", sans-serif';
        ctx.fillText('Strobe warning', W / 2, by + 30);

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.fillText('The strobe uses fast flashing light. It can trigger seizures', W / 2, by + 58);
        ctx.fillText('in people with photosensitive epilepsy.', W / 2, by + 78);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.fillText('Press Strobe again to turn it on. Space blacks the rig out at any time.', W / 2, by + 106);
        ctx.textAlign = 'left';
      }

      return {
        reset: function () {
          stepPos = 0;
          schedStep = 0;
          litStep = -1;
          pump = 0;
          strobeFrom = -1;
          strobeUntil = -1;
          spot = null;

          /* Rule 2: a restart puts the strobe back to off and throws away
             any armed warning. The alternative is a control that can hurt
             somebody quietly surviving a restart, which is exactly the
             kind of state that should not persist. */
          strobeOn = false;
          warnAt = -1;
          blackout = false;
          syncStrobeBtn();
          syncBlackBtn();

          if (tempoSel) bpm = Number(tempoSel.value) || 124;
          if (fixSel) moverCount = Number(fixSel.value) || 8;
          if (palSel && PALETTES[palSel.value]) palName = palSel.value;
          /* Through the same clamp the slider's own handler uses. An empty
             or non-numeric range value gives NaN, and a NaN haze poisons
             every alpha in the draw — a room with no light in it at all,
             from one unguarded read. */
          if (hazeIn) haze = clampHaze(Number(hazeIn.value) / 100);
          pal = PALETTES[palName];

          g.stat('bpm', bpm);
          g.stat('bar', 1);
          buildRig();
          music.set('air', haze);
        },

        key: function (name) {
          /* Space is the panic key. It is the one gesture worth binding
             here, and binding it to anything else would waste the only key
             a visitor is likely to reach for when they want the lights to
             stop. */
          if (name === 'action') setBlackout(!blackout);
        },

        update: function (dt) {
          var sixteenth = (60 / bpm) / 4;
          stepPos += dt / sixteenth;

          schedule(sixteenth);

          /* Catch-up guard. Nothing in the shell can hand this loop more
             than a quarter second at a time, so the lights should never be
             more than a couple of steps behind — but a machine that stalls
             hard would otherwise fire every missed cue in one frame, which
             is a burst of colour changes rather than the beats they were.
             Past eight steps the cues are stale, so they are dropped. */
          if (stepPos - litStep > 8) litStep = Math.floor(stepPos) - 1;
          while (litStep < Math.floor(stepPos)) {
            litStep++;
            fireLights(litStep, sixteenth);
          }

          /* Both of these are frame-rate independent approaches rather than
             fixed subtractions, so a slow machine sees the same decay
             shape as a fast one instead of a faster one. */
          pump += (0 - pump) * Math.min(1, 7 * dt);

          for (var i = 0; i < movers.length; i++) {
            var m = movers[i];
            if (m.hold) {
              m.pan += (m.panTo - m.pan) * Math.min(1, (reduced ? 5 : 11) * dt);
            }
            for (var c = 0; c < 3; c++) {
              m.col[c] += (m.colTo[c] - m.col[c]) * Math.min(1, 6 * dt);
            }
          }
        },

        draw: function (ctx) {
          var bars = stepPos / 16;
          var i, m;

          /* ---- the room, painted normally ---- */
          var wall = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
          wall.addColorStop(0, '#04050b');
          wall.addColorStop(1, '#090c16');
          ctx.fillStyle = wall;
          ctx.fillRect(0, 0, W, FLOOR_Y);

          var deck = ctx.createLinearGradient(0, FLOOR_Y, 0, H);
          deck.addColorStop(0, '#0b0e1a');
          deck.addColorStop(1, '#03040a');
          ctx.fillStyle = deck;
          ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

          ctx.strokeStyle = 'rgba(148,163,184,0.10)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, FLOOR_Y + 0.5);
          ctx.lineTo(W, FLOOR_Y + 0.5);
          ctx.stroke();

          /* Two stacks and a truss. Scenery, and also scale: without
             something man-sized in the frame the beams have no length. */
          ctx.fillStyle = '#0d111b';
          ctx.fillRect(14, FLOOR_Y - 96, 46, 96);
          ctx.fillRect(W - 60, FLOOR_Y - 96, 46, 96);
          ctx.fillStyle = '#151b27';
          for (i = 0; i < 3; i++) {
            ctx.fillRect(20, FLOOR_Y - 90 + i * 30, 34, 22);
            ctx.fillRect(W - 54, FLOOR_Y - 90 + i * 30, 34, 22);
          }

          ctx.strokeStyle = '#1c2433';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(TRUSS_X0 - 40, TRUSS_Y - 8);
          ctx.lineTo(TRUSS_X1 + 40, TRUSS_Y - 8);
          ctx.moveTo(TRUSS_X0 - 40, TRUSS_Y + 8);
          ctx.lineTo(TRUSS_X1 + 40, TRUSS_Y + 8);
          ctx.stroke();
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (i = 0; i < 22; i++) {
            var tx = TRUSS_X0 - 40 + i * ((TRUSS_X1 - TRUSS_X0 + 80) / 21);
            ctx.moveTo(tx, TRUSS_Y - 8);
            ctx.lineTo(tx + 14, TRUSS_Y + 8);
          }
          ctx.stroke();

          /* Fixture bodies, before the light so the light comes out of
             them rather than floating in front. */
          for (i = 0; i < movers.length; i++) {
            m = movers[i];
            ctx.fillStyle = '#131926';
            ctx.fillRect(m.x - 7, TRUSS_Y + 6, 14, 13);
          }

          if (blackout) {
            /* Nothing else is drawn. A blackout that still leaks a wash is
               not a blackout, and the point of the control is that its
               effect is not open to interpretation. */
            ctx.fillStyle = 'rgba(148,163,184,0.55)';
            ctx.font = '12px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Blackout — press Space or the button to bring the lights back', W / 2, H - 22);
            ctx.textAlign = 'left';
            return;
          }

          /* ---- everything from here is light, and light adds ---- */
          ctx.globalCompositeOperation = 'lighter';

          var bloom = 0.62 + 0.38 * pump;
          var hazeK = 0.35 + 0.9 * haze;

          /* Washes on the back wall, four uplighters cycling a bar apart,
             with their reflection in the deck under them. The reflection is
             the same ellipse squashed and dimmed rather than a second light
             source, which is what a polished floor gives you anyway. */
          var barIx = Math.floor(bars);
          /* How far into the bar the wash cross-fade has got. The washes
             cover most of the back wall, and the palette entries are not
             all the same luminance — cyan is about half as bright again as
             magenta — so cutting all four at once on the bar line is a
             large-area brightness step twice a second. It is well inside
             the flash rules either way, but a fade over the first sixth of
             a bar costs one interpolation and removes the question. */
          var fade = (bars - barIx) / 0.16;
          if (fade > 1) fade = 1;

          for (i = 0; i < 4; i++) {
            var wx = 90 + i * 155;
            var wPrev = pal[((barIx - 1 + i) % pal.length + pal.length) % pal.length];
            var wNext = pal[(barIx + i) % pal.length];
            var wc = [
              wPrev[0] + (wNext[0] - wPrev[0]) * fade,
              wPrev[1] + (wNext[1] - wPrev[1]) * fade,
              wPrev[2] + (wNext[2] - wPrev[2]) * fade
            ];
            var wl = (0.16 + 0.10 * pump) * (0.5 + 0.5 * hazeK);
            ctx.save();
            ctx.translate(wx, FLOOR_Y - 8);
            ctx.scale(1, 0.9);
            var wg = ctx.createRadialGradient(0, 0, 0, 0, 0, 175);
            wg.addColorStop(0, rgba(wc, wl));
            wg.addColorStop(0.45, rgba(wc, wl * 0.42));
            wg.addColorStop(1, rgba(wc, 0));
            ctx.fillStyle = wg;
            ctx.beginPath();
            ctx.arc(0, 0, 175, 0, TAU);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.translate(wx, FLOOR_Y + 26);
            ctx.scale(1, 0.42);
            var rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 150);
            rg.addColorStop(0, rgba(wc, wl * 0.5));
            rg.addColorStop(1, rgba(wc, 0));
            ctx.fillStyle = rg;
            ctx.beginPath();
            ctx.arc(0, 0, 150, 0, TAU);
            ctx.fill();
            ctx.restore();
          }

          /* Movers. Pan is a function of the transport for the sweeping
             ones and an eased approach to a cue for the holding ones; the
             depth angle is always a sweep, because a fixture that never
             turns toward the room is a fixture you only ever see from the
             side. */
          for (i = 0; i < movers.length; i++) {
            m = movers[i];
            var sweepBars = m.bars * (reduced ? 2 : 1);
            if (!m.hold) {
              m.pan = m.swing * Math.sin(TAU * bars / sweepBars + m.phase);
            }

            /* Out of the picture plane. |depth| near one is a fixture
               pointing at the viewer: the shaft projects short, and it is
               brighter because you are looking down the length of it. */
            var depth = 0.78 * Math.sin(TAU * bars / (sweepBars + 1) + m.phase * 1.7);
            var inPlane = Math.sqrt(1 - depth * depth);
            if (inPlane < 0.26) inPlane = 0.26;

            /* Zoom, four bars a cycle. In a front elevation the second axis
               of a moving head has nowhere to go, so tilt is drawn as the
               beam getting shorter and wider instead of as a second angle.
               That is an honest limit of the view, not of the fixture. */
            var half = 0.045 + 0.085 * (0.5 + 0.5 * Math.sin(TAU * bars / 4 + m.phase * 0.7));

            /* One bar dark in four, staggered, so the rig breathes. */
            var live = ((Math.floor(bars) + i) % 4) !== 3 ? 1 : 0.12;
            var power = bloom * live * (1 + 0.6 * Math.abs(depth));

            beam(ctx, m.x, m.y, m.pan, half, m.col, power, hazeK, inPlane);
          }

          if (spot) {
            /* Aimed rather than choreographed, and clamped so it cannot be
               pointed back up into the truss it hangs from. */
            var sy = spot.y < TRUSS_Y + 70 ? TRUSS_Y + 70 : spot.y;
            var ang = Math.atan2(spot.x - W / 2, sy - (TRUSS_Y + 12));
            beam(ctx, W / 2, TRUSS_Y + 12, ang, 0.05, [255, 246, 226], bloom * 1.1, hazeK, 1);
          }

          drawBall(ctx, bars, bloom, hazeK);

          /* The strobe, last, over everything. Locked to the transport like
             every other cue, but one flash every `strobeStep` sixteenths
             rather than one a sixteenth — see flashStride() for why that
             number is not free.

             The DECAY stays measured in sixteenths, not in strobe periods.
             Spreading the ramp over the whole gap would turn each flash
             into a slow swell, which is a lamp being turned up and down; a
             strobe is a hard edge followed by nothing, and widening the gap
             has to lengthen the nothing rather than the edge. */
          if (strobeOn && strobeFrom >= 0 && stepPos < strobeUntil) {
            var since = (stepPos - strobeFrom) % strobeStep;
            var lvl = since < 0.42 ? (1 - since / 0.42) : 0;
            if (lvl > 0) {
              /* Two units on the truss ends throw the actual flash; the
                 full-field lift behind them is kept low deliberately, so
                 most of the flashed area is beam rather than white screen. */
              beam(ctx, TRUSS_X0 - 16, TRUSS_Y + 12, 0.55, 0.30, [255, 255, 255], lvl * 1.4, hazeK, 1);
              beam(ctx, TRUSS_X1 + 16, TRUSS_Y + 12, -0.55, 0.30, [255, 255, 255], lvl * 1.4, hazeK, 1);
              ctx.fillStyle = 'rgba(255,255,255,' + (lvl * 0.20).toFixed(3) + ')';
              ctx.fillRect(0, 0, W, H);
            }
          }

          ctx.globalCompositeOperation = 'source-over';

          /* The warning panel, painted opaque and on top of everything,
             because a warning drawn additively over a light show is a
             warning nobody can read. */
          if (warnAt >= 0 && stepPos - warnAt < 16) drawWarning(ctx);
        }
      };

    }
  });
})();

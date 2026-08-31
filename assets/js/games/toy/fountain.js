/* ==========================================================================
   fountain.js — a dancing fountain, the kind that runs in a city plaza.
   --------------------------------------------------------------------------
   A ring of nozzles round a basin, one tall jet in the middle, coloured
   lights under the water, and a piece of music the whole thing is
   choreographed to. Nothing here is a sprite or a canned animation: the
   water is particles under gravity and drag, and the show is a programme of
   valve commands read off the same clock that plays the notes.

   THE ONE THING THIS FILE IS ABOUT: WATER TAKES TIME TO GET THERE.

   A jet reaches the top of its arc the best part of a second after the valve
   opens — about 0.16 s for a ring nozzle barely cracked and 0.86 s for the
   centre column at full pressure, which at 100 bpm is close to a beat and a
   half. So a fountain whose valves open ON the beat is a fountain that is
   visibly late every time, and worst on the jets that matter most, because
   the tall ones lag furthest behind. Every real plaza show solves this the
   same way and so does this file: the programme is planned ahead of the
   clock, and
   every channel's valve commands are shifted by

       time to the top of that channel's tallest arc  +  valve opening time

   so the top of the plume arrives on the beat rather than the bottom of it.
   Turn the pressure up and the jets fire EARLIER, not later, which is the
   part that reads as wrong until you have thought about it once.

   All three pieces of that are worth more than the obvious answer:

     - Time to the apex is NOT v0/G. That is the vacuum answer, and with
       the drag these droplets carry it is eighteen per cent long at the
       centre jet's speed — a fifth of a beat, which is plainly visible.
       The real figure is ln(1 + k*v0/G)/k, and apexTime() computes it.

     - The valve term is the FULL opening time, not half of it. The top of
       a plume is made by the fastest water in it, and the fastest water is
       what leaves after the valve is open; the slow dribble at the front of
       the pulse peaks lower and earlier and is never the top of the jet.
       Leading by half the valve time put every figure an eighth note late,
       which reads as sloppy rather than as wrong.

     - The offset belongs to the CHANNEL and is the same for every command
       on it. Leading each command by its own flight time is the version
       that seems obviously better and quietly destroys the show — see
       cue(), which is where the reasoning is, because that is where anyone
       would go to "fix" it.

   The falling half is deliberately left alone. Water that peaked on the
   beat lands another v0/G later, so the splash is an echo one to two beats
   behind the music. That is not a bug being tolerated, it is what standing
   next to one of these actually sounds like, and faking it away would cost
   the toy its only genuinely watery sound.

   ONE CLOCK. `clock` is show-seconds. The programme step times, the note
   strikes and the valve leads are all derived from it and nothing else —
   there is no second timer for the music, so the two cannot drift apart,
   and a tempo change moves both because there is only one thing to move.
   The audio is struck from the simulation step rather than scheduled on the
   AudioContext's own clock, which costs up to one 1/120 s step of jitter:
   inaudible, and worth it for the guarantee that a note and the jet it
   belongs to were decided by the same line of code.

   THE PARTICLE BUDGET IS MEASURED, NOT GUESSED. See adapt(); the short
   version is that a frame interval cannot detect spare capacity, only
   overload, so two numbers are kept.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 420;

  /* The basin, drawn as an ellipse because it is a circle seen from
     standing height. Everything that needs to know where the water surface
     is asks these four numbers. */
  var BCX = 320, BCY = 336, BRX = 268, BRY = 56;

  /* The nozzle ring, inside the basin and on the same perspective. RRY is
     a fifth of RRX for the same reason BRY is a fifth of BRX: one viewing
     angle for the whole scene, or the ring floats out of its own pool. */
  var RRX = 200, RRY = 40;

  /* Gravity, px/s^2. The first number to change and the last one to change
     lightly — the arc heights, the flight times and therefore every lead in
     the choreography are computed from it. */
  var G = 620;

  /* Exit speeds at nominal pressure, and the ceilings the pressure slider
     is clamped to. The ceilings are framing decisions rather than plumbing:
     680 px/s puts the top of the centre column at about y = 12 with the
     slider at its maximum, which is as tall as this canvas can show, and a
     jet that leaves the frame is a jet you cannot see the best part of.

     Worked against the DRAG-corrected height, not v0*v0/(2G): at 680 px/s
     the vacuum formula promises 373 px and the water reaches 269. The 12
     then allows for the emission jitter on top of that — the fastest tenth
     of the droplets leave 10% quick and go about 50 px higher than the
     commanded speed says they should, and they are the visible tip. */
  var RING_V0 = 400, RING_MAX = 560;
  var CORE_V0 = 560, CORE_MAX = 680;

  /* The valve is a first-order lag: flow moves toward the commanded value
     at VALVE_K per second. A solenoid on a fountain nozzle opens in about a
     tenth of a second and the crispness matters — a slow valve turns every
     figure into a swell, and a dancing fountain is supposed to snap.
     VALVE_OPEN is three time constants, which is 95% of commanded flow, and
     it is the term every lead in the choreography adds. */
  var VALVE_K = 26;
  var VALVE_OPEN = 3 / VALVE_K;
  var SWIVEL_K = 6;      // the head is a motor, and turns slower than the valve opens

  /* Drag, per second, and this single pair of numbers is why the toy looks
     like water. Terminal velocity goes with the square root of droplet
     diameter, so a 3 mm slug in the core of a jet is barely touched by air
     while the mist it breaks into is stopped by it almost at once. Wind
     enters through the SAME coefficient — the drag force is on the relative
     velocity, so a strong crosswind carries the spray away and leaves the
     jet cores standing. There is no separate wind factor anywhere in this
     file, and there should not be one. */
  var DRAG_JET = 0.55;
  var DRAG_SPRAY = 3.2;

  /* Below this downward speed, water hitting the basin is a splash falling
     back rather than an arc arriving. See where impacts are counted. */
  var ARRIVAL_V = 170;

  /* The two ends of the adaptive budget. The ceiling is where a full show
     stops looking better: past about 1800 droplets the plumes are already
     solid and the extra water is drawn inside water. The floor is where the
     jets stop being streams and become dotted lines, which is worse than a
     dropped frame, so a machine that cannot manage 220 is allowed to
     struggle rather than be given something that no longer reads as water. */
  var MAX_DROPS = 1800;
  var MIN_DROPS = 220;

  /* How far the show is planned ahead of the clock. Has to exceed the
     largest possible lead — the centre jet at CORE_MAX, which is 0.86 s of
     flight plus 0.12 s of valve — or that cue would be computed after the
     moment it needed to fire. 1.4 s covers it with room to spare. */
  var LOOKAHEAD = 1.4;

  /* Time from the valve opening to the top of the arc, with drag.

     Going up, dv/dt = -(G + k*v), which integrates to v(t) = (v0 + G/k)
     e^(-kt) - G/k, and that is zero at ln(1 + k*v0/G)/k. The vacuum answer
     v0/G is what this was first written as and it is 18% long at the centre
     jet's speed, because drag and gravity both fight the climb on the way
     up and drag is not small at 700 px/s. A fifth of a beat of error puts
     every big hit visibly behind its own music.

     One approximation is left in on purpose. Droplets leave within about a
     tenth of the commanded speed either way, and the fastest of them peak
     some 60 ms after this figure — so the very tip of the plume is a little
     late even when the plume is exactly on time. The lead is aimed at the
     commanded speed, which is where the mass of the water is and therefore
     where the eye reads the top of the jet as being. Aiming at the tip
     instead would put the bright body of every plume 60 ms early to flatter
     a few dozen droplets nobody is looking at. */
  function apexTime(v0) {
    return Math.log(1 + DRAG_JET * v0 / G) / DRAG_JET;
  }

  /* ------------------------------------------------------------------
     The piece. Eight steps to the bar, a step is an eighth note.

     A minor pentatonic over A minor. Pentatonic for the same reason the
     bonsai uses one: the choreography can land three notes inside a step
     when a figure changes, and any handful of these is a chord. A
     chromatic set would eventually stack a semitone and the show would
     sound like a mistake rather than like a fountain.
     ------------------------------------------------------------------ */
  var SCALE = [
    220.00, 261.63, 293.66, 329.63, 392.00,
    440.00, 523.25, 587.33, 659.25, 783.99
  ];

  /* One bass note per bar: A2 F2 C3 G2 — i, VI, III, VII in A minor. Four
     bars, and the bar is also what picks the chord, so the harmony and the
     four-bar shape of the choreography cannot come apart. */
  var BASS = [110.00, 87.31, 130.81, 98.00];

  /* Thirty-two eighths of melody, indices into SCALE, -1 is a rest. Written
     out rather than generated: a random walk over a pentatonic is pleasant
     and says nothing, and the point of a choreographed show is that the
     water is doing something the music also does. The rests matter as much
     as the notes — every gap here is a bar where the eye gets the water to
     itself. */
  var MELODY = [
    5, -1, 8, -1, 7, 5, -1, 3,
    6, -1, 5, -1, 3, -1, 5, -1,
    4, 6, -1, 8, -1, 7, 6, -1,
    5, -1, 4, 2, -1, 3, -1, -1
  ];

  /* Four figures, one per four-bar section, in the order a real show runs
     them: establish, open, complicate, hit. The names are also the HUD. */
  var FIGURES = ['Travelling wave', 'Opening flower', 'Crossed lattice', 'Centre hammer'];

  /* Underwater lighting. Hue per nozzle plus a saturation; a null hue list
     means spread the whole circle round the ring, which is the only palette
     where two neighbouring nozzles are never the same colour. */
  var PALETTES = {
    ice: { sat: 78, hues: [188, 200, 212, 196] },
    sunset: { sat: 82, hues: [352, 18, 36, 8] },
    spectrum: { sat: 84, hues: null },
    moon: { sat: 22, hues: [210, 205, 214, 208] }
  };

  function perfNow() {
    return (window.performance && window.performance.now)
      ? window.performance.now() : +new Date();
  }

  GameShell.define({
    id: 'game-fountain',
    slug: 'fountain',
    title: 'Fountain',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    /* Taps are ON, because the page copy promises that tapping the water
       fires the centre jet and the key hook below already answers 'action'.
       The shell's tap detector rejects swipes and long presses, so scrolling
       past the fountain on a phone cannot set it off by accident, and the
       worst a stray tap can do is fire one jet a beat out of time — which is
       the thing this toy most wants you to notice anyway. */
    tapAction: true,

    setup: function (g) {
      /* --------------------------------------------------------------
         Transport. clock is show-seconds and is the only clock there is.
         stepTime is the clock reading the next unplanned step lands on;
         it is carried forward rather than recomputed as index * length,
         so changing the tempo bends the future without moving any step
         already planned. A tempo change is therefore heard about a
         second late, which is correct: the water for those beats is
         already in the air and cannot be recalled.
         -------------------------------------------------------------- */
      var clock = -LOOKAHEAD;   // the pumps start before the music; see below
      var stepIndex = 0;
      var stepTime = 0;
      var events = [];          // { t, kind, ... }, drained in update()

      var bpm = 100;
      var pressure = 1;
      var wind = 0;             // px/s of air movement, signed
      var nozzleCount = 10;
      var palette = PALETTES.ice;
      var frozen = false;

      var ring = [];
      var core = null;
      var all = [];

      var drops = [];           // live droplets
      var spare = [];           // dead ones, kept for reuse — see spawn()
      var ripples = [];

      var shownFigure = '';
      var impacts = 0;          // splashes since the bed was last told
      var sndAcc = 0;
      var emitPhase = 0;        // which nozzle emits first; see update()

      /* Frame measurement. See adapt(); the budget starts in the middle
         and walks to wherever this machine can hold sixty frames, which
         takes a couple of seconds either way. */
      var budget = 900;
      var workMs = 4;
      var gapMs = 16.7;
      var lastFrame = 0;
      var frames = 0;

      var skyGrad = null;
      var poolGrad = null;

      var tempoSel = document.getElementById('game-tempo');
      var pressIn = document.getElementById('game-pressure');
      var nozzleSel = document.getElementById('game-nozzles');
      var paletteSel = document.getElementById('game-palette');
      var windIn = document.getElementById('game-wind');
      var freezeBtn = document.getElementById('game-freeze');

      /* --------------------------------------------------------------
         The bed: the fountain itself, which never stops and therefore
         cannot be a one-shot. Two layers, and the split is the same one
         falling sand makes for the same reason — they are different
         sounds and folding them together throws away the moment the toy
         is for.

         RUSH is the water in the air: bandpassed noise up where a
         breaking jet lives, driven by how many droplets are actually
         airborne. It swells while the plumes climb and thins while they
         fall, out of the simulation rather than out of an LFO.

         WASH is the basin: lowpassed, resonant, with a slow wobble on
         the cutoff. Its level comes from the impact rate, so it fills in
         a beat or two BEHIND the rush — which is not a delay line, it is
         the flight time falling out of the physics and arriving in the
         mix for free.

         Neither layer is louder than it looks. The music has to sit on
         top of this, and a bed that competes with the tune it exists to
         accompany is a bed nobody will leave switched on.
         -------------------------------------------------------------- */
      var fountain = g.bed(function (a) {
        var ctx = a.ctx;

        function layer(type, freq, q) {
          var src = ctx.createBufferSource();
          src.buffer = a.noise();
          src.loop = true;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.value = freq;
          filt.Q.value = q;
          var gain = ctx.createGain();
          /* Built silent, because the visitor may well unmute in the
             middle of a figure and the layer has to fade up out of
             nothing rather than punch in at whatever the water is doing
             at that instant. */
          gain.gain.value = 0;
          src.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          src.start();
          return { filt: filt, gain: gain };
        }

        var rush = layer('bandpass', 2200, 0.9);
        var wash = layer('lowpass', 300, 2.4);

        /* The basin is never still, so its cutoff is not either. About
           one cycle a second and a half: fast enough to read as water
           moving, slow enough not to become a tremolo. Rain's storm
           breathes once every sixteen seconds because weather is slow;
           a basin two metres away is not. */
        var wob = ctx.createOscillator();
        var depth = ctx.createGain();
        wob.frequency.value = 0.7;
        depth.gain.value = 90;
        wob.connect(depth);
        depth.connect(wash.filt.frequency);
        wob.start();

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.25 : secs));
        }

        return {
          set: function (key, value) {
            if (key === 'rush') {
              ramp(rush.gain.gain, value * 0.030, 0.18);
              /* More water in the air is brighter as well as louder: a
                 thin jet is a hiss and a full show is a roar with a hiss
                 on top. Moving the gain alone gives one plume that keeps
                 walking closer to the microphone. */
              ramp(rush.filt.frequency, 1900 + value * 1100, 0.3);
              ramp(rush.filt.Q, 1.3 - value * 0.6, 0.3);
              return;
            }
            if (key === 'wash') {
              ramp(wash.gain.gain, value * 0.042, 0.2);
              ramp(wash.filt.frequency, 280 + value * 240, 0.3);
            }
          }
        };
      });

      /* --------------------------------------------------------------
         Colour. A tint table per nozzle: eight strings covering the
         climb from the light to the top of the arc.

         Two reasons it is a table and not a computed colour. The obvious
         one is cost — fourteen hundred droplets a frame is fourteen
         hundred string builds and fourteen hundred CSS colour parses,
         against fourteen hundred assignments of a string that already
         exists and thirty-odd parses for the whole run.

         The other is that a DROPLET HOLDS THE TABLE, not the nozzle. The
         lights are under the water, so they can only light water that is
         still in the nozzle: change the palette mid-show and everything
         already in the air keeps the colour it left with while the new
         one climbs the jets over the next second. That is what happens to
         a real fountain when the lighting desk changes state, and here it
         costs one property on the droplet.
         -------------------------------------------------------------- */
      function tintTable(hue, sat) {
        var out = [];
        for (var b = 0; b < 8; b++) {
          out.push('hsla(' + hue + ',' + sat + '%,' +
            (90 - b * 6) + '%,' + (0.5 - b * 0.045).toFixed(3) + ')');
        }
        return out;
      }

      function hueFor(k, n) {
        if (!palette.hues) return Math.round((k / n) * 360);
        return palette.hues[k % palette.hues.length];
      }

      /* One nozzle. `out` is the horizontal component of "away from the
         centre" for this position on the ring, and it is a cosine because
         the ring is a circle in perspective: a nozzle at the front or the
         back leans toward or away from the camera, which a flat canvas
         cannot show and should not pretend to. Using cos(a) is exactly the
         projection of that lean, and it is why the flower opens widest at
         the sides of the ring and barely at all at the front. */
      function makeNozzle(k, n, ang) {
        var nz = {
          a: ang,
          x: BCX + Math.cos(ang) * RRX,
          ground: BCY + Math.sin(ang) * RRY,
          out: Math.cos(ang),
          power: 0, target: 0,
          tilt: 0, tiltTarget: 0,
          acc: 0,
          hold: 0,
          lastCue: -99,
          vmax: RING_MAX,
          bore: 3.2,
          tints: tintTable(hueFor(k, n), palette.sat)
        };
        nz.y = nz.ground - 5;
        /* The height the lamp lighting this jet sits at. Droplets copy it
           rather than reading it back off the nozzle, so a droplet thrown
           off another droplet — spray breaking, water splashing — is still
           shaded against the lamp it actually came from. */
        nz.base = nz.y;
        /* Perspective on droplet size, and on how many of them: the far
           side of a four-metre ring is genuinely further away. */
        nz.scale = 0.86 + ((Math.sin(ang) + 1) / 2) * 0.3;
        /* Half the basin's width at this nozzle's depth, so a droplet can
           tell whether it came down in the water or on the paving without
           solving the ellipse again. Constant per nozzle because nothing in
           this simulation moves in depth — wind only pushes in x. */
        nz.rim = BRX * Math.sqrt(Math.max(0, 1 - Math.pow((nz.ground - BCY) / BRY, 2)));
        return nz;
      }

      function buildRing() {
        var old = ring;
        ring = [];
        var n = nozzleCount;
        var k;
        for (k = 0; k < n; k++) {
          /* Nozzle 0 is the FAR one and the ring runs clockwise from
             there, so a travelling wave crosses the back, comes down the
             right, passes in front and goes back up the left — the
             direction a standing viewer reads as "round". */
          ring.push(makeNozzle(k, n, -Math.PI / 2 + (k / n) * Math.PI * 2));
        }

        /* A ring swapped mid-show inherits the old one's valve positions,
           matched by angle rather than by index so six nozzles becoming
           sixteen keeps the shape of the figure instead of rotating it.

           Without this the new ring is DEAD for the better part of a
           second. The planner is already a lookahead ahead, so every
           command in the queue names a nozzle that no longer exists, and
           the first cue aimed at the new ring is the next step to be
           planned — which fires about 0.7 s from now. Rewinding the
           transport instead would fix the water by replaying a second of
           music over itself, which is a worse trade in every direction. */
        if (old.length) {
          for (k = 0; k < n; k++) {
            var src = old[Math.round(k * old.length / n) % old.length];
            ring[k].power = src.power;
            ring[k].target = src.target;
            ring[k].tilt = src.tilt;
            ring[k].tiltTarget = src.tiltTarget;
          }
          /* And the orphaned commands go, or they spend the next second
             setting targets on nozzles nothing draws. */
          var keep = 0;
          for (k = 0; k < events.length; k++) {
            if (events[k].kind === 'jet' && events[k].nz !== core &&
                ring.indexOf(events[k].nz) < 0) continue;
            events[keep++] = events[k];
          }
          events.length = keep;
        }
        if (!core) {
          core = {
            a: 0, x: BCX, ground: BCY, out: 0,
            power: 0, target: 0, tilt: 0, tiltTarget: 0, acc: 0, hold: 0, lastCue: -99,
            vmax: CORE_MAX, bore: 5, scale: 1.05, rim: BRX
          };
          core.y = BCY - 7;
          core.base = core.y;
        }
        /* The centre lamp is fixed rather than spread, because on the
           spectrum palette the ring already runs the whole circle and a
           centre jet joining in has no colour left to be. */
        core.tints = tintTable(palette.hues ? palette.hues[0] : 200, palette.sat);
        all = [core].concat(ring);
      }

      function repaintLights() {
        var n = ring.length;
        for (var k = 0; k < n; k++) ring[k].tints = tintTable(hueFor(k, n), palette.sat);
        core.tints = tintTable(palette.hues ? palette.hues[0] : 200, palette.sat);
      }

      /* --------------------------------------------------------------
         Controls.
         -------------------------------------------------------------- */
      if (tempoSel) {
        bpm = Number(tempoSel.value) || 100;
        tempoSel.addEventListener('change', function () {
          bpm = Number(tempoSel.value) || 100;
          /* The selector reads Slow / Steady / Brisk; the HUD reads the
             number behind those words. Worth showing, because the tempo is
             what every valve lead in the show is computed against — change
             it and the jets fire earlier or later, not just faster. */
          g.stat('bpm', bpm);
        });
      }
      if (pressIn) {
        pressure = (Number(pressIn.value) || 100) / 100;
        pressIn.addEventListener('input', function () {
          pressure = (Number(pressIn.value) || 100) / 100;
        });
      }
      if (windIn) {
        /* parseFloat rather than Number(...) || 0: the still setting is
           '0' and the truthiness test would throw it away. */
        wind = (parseFloat(windIn.value) || 0) * 1.6;
        windIn.addEventListener('input', function () {
          var v = parseFloat(windIn.value);
          wind = (isNaN(v) ? 0 : v) * 1.6;
        });
      }
      if (nozzleSel) {
        nozzleCount = Number(nozzleSel.value) || 10;
        nozzleSel.addEventListener('change', function () {
          nozzleCount = Number(nozzleSel.value) || 10;
          buildRing();
          g.stat('nozzles', nozzleCount + ' + core');
          /* Droplets already in the air are untouched. They hold a tint
             table and a ground line, never the nozzle they came from, so
             rebuilding the ring underneath them leaves nothing dangling
             and the water from the old arrangement falls out honestly. */
        });
      }
      if (paletteSel) {
        palette = PALETTES[paletteSel.value] || PALETTES.ice;
        paletteSel.addEventListener('change', function () {
          palette = PALETTES[paletteSel.value] || PALETTES.ice;
          repaintLights();
        });
      }
      if (freezeBtn) {
        freezeBtn.addEventListener('click', function () {
          frozen = !frozen;
          freezeBtn.setAttribute('aria-pressed', String(frozen));
          /* The bed is held down by hand rather than left to the level
             it happened to be on, because a frozen fountain that is
             still roaring is a paused video with the audio still
             running. The one-shots stop by themselves: they are struck
             off the clock, and the clock is not moving. */
          fountain.gain(frozen ? 0 : 1, 0.25);
          g.stat('figure', frozen ? 'Held' : shownFigure);
        });
      }

      /* --------------------------------------------------------------
         The programme.

         plan() is called once per step, up to LOOKAHEAD ahead of the
         clock, and it is the ONLY place a note or a valve command is
         created. It writes every channel on every cue — including the
         nozzles whose target has not changed — because that is what a
         show controller does and because the alternative is a diff that
         has to be right about state it cannot see.
         -------------------------------------------------------------- */
      function stepSeconds() { return 30 / bpm; }   // an eighth note

      /* THE LEAD BELONGS TO THE CHANNEL, NOT TO THE CUE, and this is the
         one place the obvious implementation is not merely imprecise but
         broken. Computing a lead from each command's own speed looks more
         accurate: a small jet has a short flight, so lead it less. What
         actually happens is that the commands on a channel come out in the
         wrong order. A full-height hit on the centre column is scheduled
         0.85 s early; the quiet cue on the eighth note BEFORE it is
         scheduled only 0.27 s early, so it lands about 0.28 s AFTER the big
         one and shuts the valve again. The column starts falling before the
         beat it was aimed at, never reaches full height, and every hammer
         in the show reads as a shrug.

         A show desk offsets each channel by one number for the whole
         programme — the flight time of that channel's tallest jet — and a
         constant offset cannot reorder anything. So does this: the ring
         gets one lead, the centre column gets its own longer one, and a
         quiet cue simply fires early, which costs nothing because the
         moment a valve CLOSES is not a moment anybody is watching for. */
      function cue(t, v0, nz, tilt, lead) {
        var at = t - lead;
        /* Belt and braces for the one case a constant offset does not
           cover: the pressure slider changes the lead mid-show, and a lead
           that has just got shorter could still put a new command before
           an old one. Never let a channel go backwards. */
        if (at <= nz.lastCue) at = nz.lastCue + 0.001;
        nz.lastCue = at;
        events.push({ t: at, kind: 'jet', nz: nz, v0: v0, tilt: tilt });
      }

      function plan(i, t) {
        var n = ring.length;
        if (!n) return;
        var bar = Math.floor(i / 8) % 4;
        var beatOfBar = i % 8;
        var section = Math.floor(i / 32) % 4;
        var k, frac, s, d;

        /* One offset per channel for the whole cue, computed from the
           tallest jet that channel can be asked for at this pressure. See
           cue() for why it is not per command. */
        var ringLead = apexTime(Math.min(RING_MAX, RING_V0 * pressure)) + VALVE_OPEN;
        var coreLead = apexTime(Math.min(CORE_MAX, CORE_V0 * pressure)) + VALVE_OPEN;

        /* ---- the water ---- */
        if (section === 0) {
          /* A crest one nozzle wide, moving one nozzle per eighth. The
             neighbours are held part-open so the wave has a shoulder
             rather than a single spike walking round an empty ring. */
          var crest = i % n;
          for (k = 0; k < n; k++) {
            d = Math.abs(k - crest);
            if (d > n / 2) d = n - d;
            frac = d === 0 ? 1 : (d === 1 ? 0.6 : 0.26);
            cue(t, RING_V0 * frac * pressure, ring[k], d === 0 ? 0.1 : 0, ringLead);
          }
        } else if (section === 1) {
          /* Open and close over two bars. The per-nozzle offset makes it
             a spiral rather than an iris — sixteen jets moving in exact
             lockstep look mechanical, and a fountain is not a machine
             even though it is one. */
          for (k = 0; k < n; k++) {
            s = (1 - Math.cos(Math.PI * 2 * (((i + k * 0.35) % 16) / 16))) / 2;
            cue(t, RING_V0 * (0.45 + s * 0.5) * pressure, ring[k], s * 0.55, ringLead);
          }
        } else if (section === 2) {
          /* Alternate nozzles lean inward hard enough to cross the ring.
             At 0.6 rad and nominal pressure a jet travels about 190 px
             inward before it lands, and the ring is 200 px in radius, so
             every one of them comes down near the middle — they cross
             above the centre rather than merely leaning at it. Which half
             is tall flips every two steps, so the lattice weaves instead
             of standing still and becoming wallpaper. */
          for (k = 0; k < n; k++) {
            var lit = (k % 2) === ((i >> 1) % 2);
            cue(t, RING_V0 * (lit ? 0.95 : 0.4) * pressure, ring[k],
              (k % 2) ? -0.6 : -0.34, ringLead);
          }
        } else {
          /* The ring gets out of the way and breathes on the bar line;
             the centre column is the figure. */
          frac = beatOfBar === 0 ? 0.55 : 0.3;
          for (k = 0; k < n; k++) cue(t, RING_V0 * frac * pressure, ring[k], 0, ringLead);
        }

        /* The centre jet: on the bar line in every section, and in the
           hammer on the seventh eighth as well, which is the pickup into
           the next bar rather than a beat of this one. Clamped rather than
           scaled, so the pressure slider cannot push it out of the frame. */
        var coreFrac = 0;
        if (section === 3) coreFrac = (beatOfBar === 0 || beatOfBar === 6) ? 1 : 0.18;
        else coreFrac = beatOfBar === 0 ? 0.55 : 0.18;
        cue(t, Math.min(CORE_MAX, CORE_V0 * coreFrac * pressure), core, 0, coreLead);

        /* ---- the music, on the beat the water was aimed at ---- */
        if (beatOfBar === 0) {
          /* The HUD is an event like everything else, and it has to be:
             the planner runs a second and a half ahead of the clock, so a
             figure name taken from stepIndex would rename the show while
             the previous one was still in the air. */
          events.push({ t: t, kind: 'mark', figure: FIGURES[section] });
          events.push({ t: t, kind: 'bass', freq: BASS[bar] });
          events.push({ t: t, kind: 'hit', level: 0.030 });
        } else if (beatOfBar === 4) {
          events.push({ t: t, kind: 'bass', freq: BASS[bar] * 1.5 });
          events.push({ t: t, kind: 'hit', level: 0.018 });
        }

        var m = MELODY[i % MELODY.length];
        if (m >= 0) {
          /* The second half of the show lifts the line two degrees of the
             pentatonic. Two degrees rather than an octave: an octave jump
             is a different tune, two degrees is the same tune with the
             lights up, which is what a section change is for. */
          if (section >= 2) m = Math.min(SCALE.length - 1, m + 2);
          events.push({ t: t, kind: 'note', freq: SCALE[m] });
        }
      }

      function fire(e) {
        if (e.kind === 'jet') {
          /* A nozzle taken by hand keeps it for a moment. The programme
             writes every channel on every cue, so without this the manual
             punch below would be overwritten by the next eighth note —
             about a third of a second later, which is before the water it
             opened has even reached the top. */
          if (e.nz.hold > 0) return;
          e.nz.target = Math.min(e.nz.vmax, e.v0);
          e.nz.tiltTarget = e.tilt;
          return;
        }
        if (e.kind === 'mark') {
          shownFigure = e.figure;
          if (!frozen) g.stat('figure', e.figure);
          return;
        }
        if (e.kind === 'bass') {
          /* Triangle, not sine. At 87 Hz a pure sine is most of the way
             to inaudible on a laptop speaker, and the bass is the thing
             the centre jet is punching with. */
          g.pluck(e.freq, 0.85, 0.045, 'triangle');
          return;
        }
        if (e.kind === 'note') {
          g.pluck(e.freq, 0.5, 0.030, 'triangle');
          return;
        }
        if (e.kind === 'hit') {
          /* A bright noise burst falling to a mid thump — a cymbal that
             is also, deliberately, the shape of a splash, so the
             percussion and the water are made of the same material. */
          g.noise(0.2, { type: 'bandpass', freq: 3200, to: 900, q: 0.8, level: e.level });
        }
      }

      /* --------------------------------------------------------------
         Droplets.

         A free list rather than fresh objects. At full budget this
         creates and abandons something like eight hundred small objects
         a second, and on a phone that is a garbage collection pause every
         few seconds landing in the middle of a bar. Recycling keeps the
         allocation count near zero once the show has warmed up.
         -------------------------------------------------------------- */
      /* `src` is whatever the water came from — a nozzle, or an older
         droplet that broke up or splashed. Both carry the same five
         fields, which is why a droplet is allowed to be a source: the
         spray thrown off the top of an arc belongs to the same lamp, the
         same water line and the same depth as the jet it came out of, and
         copying them is how it stays that way without a back-reference to
         a nozzle that may not exist any more. */
      function spawn(src, x, y, vx, vy, spray) {
        if (drops.length >= budget) return null;
        var p = spare.length ? spare.pop() : {};
        p.x = x; p.y = y;
        p.vx = vx; p.vy = vy;
        p.ground = src.ground;
        p.rim = src.rim;
        p.base = src.base;
        p.tints = src.tints;
        p.scale = src.scale;
        p.spray = spray;
        p.life = 0;
        drops.push(p);
        return p;
      }

      function kill(i) {
        spare.push(drops[i]);
        drops[i] = drops[drops.length - 1];
        drops.pop();
      }

      function addRipple(x, y) {
        if (ripples.length > 40) return;
        ripples.push({ x: x, y: y, r: 2, max: 16 + Math.random() * 22, life: 0 });
      }

      /* One nozzle's emission for one step. The rate follows the power,
         so a valve opening is a plume thickening rather than a plume
         appearing, and it follows the budget as well — see adapt(). */
      function emit(nz, dt) {
        if (nz.power < 45) { nz.acc = 0; return; }
        var share = budget / MAX_DROPS;
        var rate = 150 * (nz.power / nz.vmax) * share * nz.scale;
        nz.acc += rate * dt;
        var count = Math.floor(nz.acc);
        nz.acc -= count;
        for (var i = 0; i < count; i++) {
          /* The nozzle is not perfect and neither is the water: a few per
             cent of scatter on both speed and angle. Emit a mathematically
             exact jet and it draws as a line, not a stream. */
          var sp = nz.power * (0.9 + Math.random() * 0.2);
          var th = nz.tilt + (Math.random() - 0.5) * 0.06;
          spawn(nz,
            nz.x + (Math.random() - 0.5) * nz.bore,
            nz.y,
            Math.sin(th) * sp * nz.out,
            -Math.cos(th) * sp,
            0);
        }
      }

      function stepWater(dt) {
        var i, p, k;
        for (i = drops.length - 1; i >= 0; i--) {
          p = drops[i];
          k = p.spray ? DRAG_SPRAY : DRAG_JET;

          /* Drag on the relative velocity. Horizontally the air is
             moving at `wind`, vertically it is still. One law, and the
             fact that spray blows sideways while jet cores stand up
             falls straight out of the two coefficients. */
          p.vx += (wind - p.vx) * k * dt;
          p.vy += G * dt - p.vy * k * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life += dt;

          /* Break-off at the top of the arc. A jet leaves the nozzle as a
             rope and comes apart later: the ripples that tear it into
             droplets take time to grow, and by the top of the arc they have
             had it. That is why a plume is a hard bright line on the way up
             and a soft cloud on the way down, and it is the single detail
             that stops this looking like confetti fired out of a tube. */
          if (!p.spray && p.vy > -70 && Math.random() < 0.03) {
            p.spray = 1;
            p.vx += (Math.random() - 0.5) * 30;
            p.vy += (Math.random() - 0.5) * 20;
            /* Atomising makes more droplets, not the same ones smaller,
               so one extra comes off — budget permitting. */
            spawn(p, p.x, p.y,
              p.vx + (Math.random() - 0.5) * 44,
              p.vy - Math.random() * 24, 1);
          }

          if (p.vy > 0 && p.y >= p.ground) {
            var inWater = Math.abs(p.x - BCX) <= p.rim;
            if (inWater) {
              /* Only water that actually fell from somewhere counts as an
                 arrival. A splash throws droplets a few pixels up and they
                 come back down at a fraction of the speed a real arc
                 arrives at; counting those meant the basin heard every
                 droplet three or four times over, and the wash layer sat
                 pinned at its ceiling for the whole show with no dynamics
                 in it at all. The shortest genuine ring arc comes down at
                 well over 300 px/s and a re-landing splash at under 130,
                 so the threshold is not close to anything. */
              if (p.vy > ARRIVAL_V) impacts++;
              /* A ripple per splash would be several hundred rings a
                 second, which is a white disc. One in eight reads as the
                 same surface for a fraction of the drawing. */
              if (Math.random() < 0.12) addRipple(p.x, p.ground);
              if (Math.random() < 0.5) {
                spawn(p, p.x, p.ground,
                  (Math.random() - 0.5) * 90 + p.vx * 0.15,
                  -40 - Math.random() * 90, 1);
              }
            } else if (Math.random() < 0.25) {
              /* Out on the paving. Only the wind puts water here, and a
                 windy day soaking the plaza is a real property of these
                 things rather than an error to be clamped away. */
              spawn(p, p.x, p.ground,
                (Math.random() - 0.5) * 40, -20 - Math.random() * 40, 1);
            }
            kill(i);
            continue;
          }

          if (p.life > 6 || p.x < -40 || p.x > W + 40 || p.y > H + 20) kill(i);
        }
      }

      /* --------------------------------------------------------------
         The adaptive budget.

         TWO NUMBERS, AND THE REASON IS THAT A FRAME INTERVAL CANNOT
         MEASURE HEADROOM. requestAnimationFrame fires on the display's
         vsync, so on a 60 Hz screen the gap between frames reads 16.7 ms
         whether the frame took two milliseconds of work or fifteen. The
         obvious rule — grow while the interval is under 14 ms — therefore
         never grows on the commonest display there is, and every machine
         runs the floor.

         So overload is detected from the INTERVAL, where a dropped frame
         shows up honestly as a 33 ms gap, and spare capacity from the
         time drawing itself takes, measured around draw()'s own body.
         Update is roughly proportional to the same droplet count, so the
         4 ms growth threshold leaves room for it and for the browser's
         own compositing on top.

         Both are exponential means over about ten frames. A single frame
         is far too noisy to steer on: one garbage collection or one
         extension waking up would otherwise halve the budget.

         What gives is the droplet count, never the step rate. The shell
         runs a fixed 1/120 s update either way, so a weak machine gets a
         thinner fountain playing the same show at the same tempo, rather
         than the same fountain in slow motion.
         -------------------------------------------------------------- */
      function adapt(work, gap) {
        if (gap > 0 && gap < 100) gapMs += (gap - gapMs) * 0.1;
        workMs += (work - workMs) * 0.1;
        frames++;
        if (frames < 30) return;      // decide twice a second, not sixty times
        frames = 0;
        if (gapMs > 20) budget = Math.max(MIN_DROPS, Math.floor(budget * 0.88));
        else if (workMs < 4) budget = Math.min(MAX_DROPS, budget + 60);
      }

      /* --------------------------------------------------------------
         Drawing.
         -------------------------------------------------------------- */
      function drawPool(ctx) {
        if (!poolGrad) {
          /* Built once. The coordinates of a gradient are resolved
             against the transform in force when it is PAINTED, not when
             it is created, so caching one survives the shell resizing the
             canvas under it. */
          poolGrad = ctx.createLinearGradient(0, BCY - BRY, 0, BCY + BRY);
          poolGrad.addColorStop(0, '#06202f');
          poolGrad.addColorStop(0.55, '#0a2f43');
          poolGrad.addColorStop(1, '#04151e');
        }
        ctx.beginPath();
        ctx.ellipse(BCX, BCY, BRX, BRY, 0, 0, Math.PI * 2);
        ctx.fillStyle = poolGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,0.32)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.save();
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';

        /* Moving highlights: five rings crawling outward from the middle,
           which is where the disturbance comes from. Concentric rather
           than parallel bands because the basin's own waves are made by
           the jets, and the jets are in the centre. */
        var i, ph, rr;
        for (i = 0; i < 5; i++) {
          ph = (clock * 0.22 + i / 5) % 1;
          if (ph < 0) ph += 1;
          rr = 0.25 + ph * 0.85;
          ctx.strokeStyle = 'rgba(125,211,252,' + (0.1 * (1 - ph)).toFixed(3) + ')';
          ctx.lineWidth = 2 + ph * 3;
          ctx.beginPath();
          ctx.ellipse(BCX, BCY, BRX * rr, BRY * rr, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        /* Reflections. The lights are under the water and the jets are lit
           from below, so what the surface carries toward the viewer is a
           smear of the nozzle's own colour, brightest at the nozzle and
           breaking up as it comes forward. Its length follows the power,
           which means the reflections dance the same figure the water
           does without being told about the figure at all. */
        var n, nz, b, yy, lit, wobx;
        for (n = 0; n < all.length; n++) {
          nz = all[n];
          lit = nz.power / nz.vmax;
          if (lit < 0.06) continue;
          wobx = Math.sin(clock * 2.3 + nz.a * 2) * 3;
          ctx.globalAlpha = Math.min(1, lit) * 0.55;
          for (b = 0; b < 5; b++) {
            yy = nz.ground + 5 + b * 9;
            if (yy > BCY + BRY) break;
            ctx.fillStyle = nz.tints[b + 2];
            ctx.beginPath();
            ctx.ellipse(nz.x + wobx * (b / 2), yy, 7 + b * 2.6, 3 + b, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;

        /* The lamps themselves, under the water at each nozzle. Drawn as
           three stacked ellipses rather than a radial gradient because a
           gradient object per lamp per frame is an allocation for a shape
           three fills already describe well enough at this size. */
        for (n = 0; n < all.length; n++) {
          nz = all[n];
          ctx.globalAlpha = 0.4 + Math.min(1, nz.power / nz.vmax) * 0.6;
          for (b = 0; b < 3; b++) {
            ctx.fillStyle = nz.tints[b * 2];
            ctx.beginPath();
            ctx.ellipse(nz.x, nz.ground, 16 - b * 5, 6 - b * 1.6, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;

        for (i = 0; i < ripples.length; i++) {
          var rp = ripples[i];
          var fade = 1 - rp.r / rp.max;
          ctx.strokeStyle = 'rgba(186,230,253,' + (0.32 * fade).toFixed(3) + ')';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.22, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      function drawHardware(ctx) {
        var i, nz;
        ctx.fillStyle = '#1e293b';
        for (i = 0; i < ring.length; i++) {
          nz = ring[i];
          ctx.fillRect(nz.x - 3, nz.ground - 6, 6, 7);
        }
        /* The centre stands on a plinth, which is also what stops the tall
           column looking like it is coming out of nowhere. */
        ctx.beginPath();
        ctx.ellipse(BCX, BCY, 22, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(BCX - 5, BCY - 10, 10, 10);
      }

      function drawWater(ctx) {
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < drops.length; i++) {
          var p = drops[i];
          /* Brightness by height above the nozzle that lit it. The lamp
             is under the water, so a droplet just off the bore is nearly
             white and one at the top of a tall arc is barely lit at all —
             which is both true and the reason the colour reads as being
             carried up the jet rather than painted on it. */
          var b = (p.base - p.y) * 0.0217;      // 1/46 px per band
          b = b < 0 ? 0 : (b > 7 ? 7 : b | 0);
          ctx.fillStyle = p.tints[b];
          if (p.spray) {
            var s = 1.3 * p.scale;
            ctx.fillRect(p.x, p.y, s, s);
          } else {
            /* A streak rather than a dot, as long as the droplet's own
               speed. Fast water is a line to the eye and to a camera, and
               six extra pixels of height do more for this than any amount
               of colour work would. Centred on the position rather than
               hanging below it, because the streak is the distance covered
               during one frame and half of that is behind the droplet
               whichever way it happens to be going. */
            var hgt = 2 + Math.min(6, Math.abs(p.vy) * 0.012);
            ctx.fillRect(p.x, p.y - hgt * 0.5 * p.scale, 1.6 * p.scale, hgt * p.scale);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      /* --------------------------------------------------------------
         The hooks.
         -------------------------------------------------------------- */
      return {
        reset: function () {
          buildRing();
          /* Every channel back to shut. lastCue especially: the clock is
             about to jump backwards to -LOOKAHEAD, and a channel still
             holding the last cue time of the previous run would push every
             command of the new one after it — the ring would open once and
             then never take another order for as long as the page was up. */
          for (var i = 0; i < all.length; i++) {
            all[i].power = 0; all[i].target = 0;
            all[i].tilt = 0; all[i].tiltTarget = 0;
            all[i].acc = 0; all[i].hold = 0;
            all[i].lastCue = -99;
          }
          drops.length = 0;
          spare.length = 0;
          ripples.length = 0;
          events.length = 0;
          /* Negative, so the first cue can still be led properly: at
             clock zero the show would have to fire the opening centre
             jet a second ago. Starting the transport a lookahead early
             means the pumps run before the music does, which is also the
             order the real ones start in. */
          clock = -LOOKAHEAD;
          stepIndex = 0;
          stepTime = 0;
          impacts = 0;
          sndAcc = 0;
          shownFigure = FIGURES[0];
          g.stat('bpm', bpm);
          g.stat('figure', frozen ? 'Held' : shownFigure);
          g.stat('nozzles', nozzleCount + ' + core');
          /* Both names for the same count. The generated page calls the
             cell "drops"; this file has called the things it simulates
             droplets since the header, and renaming them to match one HUD
             cell would leave the file arguing with itself. stat() is a
             lookup that no-ops on a missing cell, so writing both costs a
             failed hash lookup five times a second and means neither name
             can go stale on the other. */
          g.stat('droplets', '0');
          g.stat('drops', '0');
          /* A restart must not inherit the roar of the run before it. */
          fountain.set('rush', 0);
          fountain.set('wash', 0);
        },

        key: function (name) {
          if (name !== 'action' || frozen) return;
          /* A hit by hand, fired NOW rather than a lead ahead of a beat.
             It is the demonstration the rest of the file is an argument
             for: the same jet, on the same pressure, arriving visibly
             late — because nothing fired it early. */
          core.target = Math.min(CORE_MAX, CORE_V0 * pressure);
          core.tiltTarget = 0;
          core.hold = 0.9;
          g.noise(0.22, { type: 'bandpass', freq: 2600, to: 700, q: 0.9, level: 0.03 });
        },

        update: function (dt) {
          if (frozen) return;
          clock += dt;

          /* Plan forward. Everything inside LOOKAHEAD of now is turned
             into events; the valve commands sit at their own lead times,
             which is why this loop has to run ahead of the clock at all. */
          var guard = 0;
          while (stepTime <= clock + LOOKAHEAD && guard < 64) {
            plan(stepIndex, stepTime);
            stepIndex++;
            stepTime += stepSeconds();
            guard++;
          }

          /* Drain. Compacted in place rather than spliced: an event fires
             once and the array is short, and splice inside a loop over
             the same array is the classic way to skip every second one. */
          var keep = 0, i;
          for (i = 0; i < events.length; i++) {
            if (events[i].t <= clock) fire(events[i]);
            else events[keep++] = events[i];
          }
          events.length = keep;

          /* Valves and heads, both first-order lags. The valve constant
             is the one the leads above are computed from, so changing
             VALVE_K without changing cue() would quietly put the whole
             show behind the beat again.

             The emission order rotates by one nozzle a step. It matters
             because spawn() refuses once the budget is full, and a fixed
             order would always starve whoever is last in the array — on a
             weak machine one side of the ring would visibly run thinner
             than the other for no reason a visitor could ever guess. */
          var n, nz;
          emitPhase = (emitPhase + 1) % all.length;
          for (n = 0; n < all.length; n++) {
            nz = all[(n + emitPhase) % all.length];
            if (nz.hold > 0) nz.hold -= dt;
            nz.power += (nz.target - nz.power) * Math.min(1, VALVE_K * dt);
            nz.tilt += (nz.tiltTarget - nz.tilt) * Math.min(1, SWIVEL_K * dt);
            emit(nz, dt);
          }

          stepWater(dt);

          for (i = ripples.length - 1; i >= 0; i--) {
            var rp = ripples[i];
            rp.r += 26 * dt;
            if (rp.r >= rp.max) ripples.splice(i, 1);
          }

          /* Steering the bed, five times a second rather than 120. Every
             set() ends in a cancelScheduledValues and a ramp, and
             scheduling those at step rate costs more than the water
             simulation that feeds them while sounding identical — nothing
             in this bed moves fast enough for the difference to be heard.

             Both levels take a square root, because droplets are
             independent noise sources and add as power rather than as
             pressure: four times the water is twice the sound.

             BOTH ARE MEASURED AGAINST THE BUDGET, not against a fixed
             count, and that is not a shortcut. The budget is a decision
             about what this machine can paint; it is not a claim about how
             much water the fountain is moving. Divide by a constant instead
             and a phone that has thinned itself to four hundred droplets
             plays the whole show at half volume, which would make the sound
             a readout of the graphics card. The 0.2 is the fraction of the
             airborne droplets that ARRIVE inside any fifth of a second —
             about a fifth of them, the mean flight time being close to a
             second — so a busy show reaches most of the way up both layers
             however many droplets that took.

             The two do not move together despite sharing a divisor, and
             that is the whole point: rush counts what is in the air now,
             wash counts what is landing now, and what is landing now was
             launched a beat or two ago. The basin lagging behind the jets
             is the flight time arriving in the mix for free. */
          sndAcc += dt;
          if (sndAcc >= 0.2) {
            var rush = drops.length / budget;
            var washN = impacts / (budget * 0.2);
            fountain.set('rush', Math.sqrt(rush > 1 ? 1 : rush));
            fountain.set('wash', Math.sqrt(washN > 1 ? 1 : washN));
            g.stat('droplets', drops.length);
            g.stat('drops', drops.length);
            impacts = 0;
            sndAcc = 0;
          }
        },

        draw: function (ctx) {
          var t0 = perfNow();

          if (!skyGrad) {
            skyGrad = ctx.createLinearGradient(0, 0, 0, H);
            skyGrad.addColorStop(0, '#020617');
            skyGrad.addColorStop(0.62, '#050b1c');
            skyGrad.addColorStop(1, '#0a1424');
          }
          ctx.fillStyle = skyGrad;
          ctx.fillRect(0, 0, W, H);

          /* The plaza: one band of paving behind the basin and one in
             front of it, so the pool sits in something rather than
             floating on the night. */
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, BCY - BRY - 26, W, H - (BCY - BRY - 26));
          ctx.fillStyle = 'rgba(148,163,184,0.06)';
          ctx.fillRect(0, BCY - BRY - 26, W, 2);

          drawPool(ctx);
          drawHardware(ctx);
          drawWater(ctx);

          adapt(perfNow() - t0, lastFrame ? t0 - lastFrame : 0);
          lastFrame = t0;
        }
      };
    }
  });
})();

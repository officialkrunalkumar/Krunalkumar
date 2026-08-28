/* ==========================================================================
   buddha-sound.js — the calm on /buddha, generated rather than downloaded.
   --------------------------------------------------------------------------
   There is no audio file behind this. Every sound is synthesised with the Web
   Audio API: a tanpura cycling Pa-Sa-Sa-Sa under a generated hall reverb, a
   sustained sub beneath it, a singing bowl, and a bansuri-like flute phrase
   wandering through a Bhairavi scale. That choice is not cleverness for its
   own sake — it settles three problems at once.

   Licensing. The obvious thing to reach for is a track you like, but recorded
   music is copyrighted twice over (the composition and the recording), and
   this site sells services, so an unlicensed track is a real liability. A
   waveform computed in the browser belongs to nobody.

   Weight. The nearest royalty-free ambient loop worth having runs to several
   megabytes. This file is a few kilobytes and never repeats, because the bowl
   strikes are scheduled with jitter rather than looped.

   Policy. Browsers refuse to start audio without a user gesture, and they are
   right to. Nothing here makes a sound until the speaker button is pressed,
   and the choice is remembered.

   A real bowl does not ring in harmonics — its partials sit at roughly 1,
   2.7, 5.4 and 8.9 times the fundamental, each decaying at its own rate. That
   inharmonicity is the whole character of the sound; even spacing gives you a
   church bell, and whole-number spacing gives you an organ.

   If you ever license a piece of music and want it instead, drop the file in
   and call useFile('/assets/audio/whatever.mp3') — the controls do not care
   where the sound comes from.
   ========================================================================== */

(function () {
  'use strict';

  var STORE_ON = 'lab.buddha.sound';
  var STORE_VOL = 'lab.buddha.vol';

  var toggle = document.querySelector('.b-audio-toggle');
  var slider = document.querySelector('.b-audio-vol');
  if (!toggle || !slider) return;

  var ctx = null;
  var master = null;      // everything passes through this; the slider moves it
  var warm = null;        // the shared low-pass every voice is mixed into
  var send = null;        // reverb send, tapped off warm
  var drone = [];
  var droneTones = [];
  var bowlTimer = null;
  var suspendTimer = null;
  var playing = false;

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function recall(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }

  var volume = Math.min(100, Math.max(0, parseInt(recall(STORE_VOL, '65'), 10) || 65));
  slider.value = volume;

  /* A linear slider feels wrong because loudness is not linear, but the first
     version over-corrected: cubed, with a ceiling of 0.34, meant full volume
     was about -22 dB and inaudible over any room noise. An exponent near 1.8
     keeps the quiet end gentle while letting the top actually reach full
     scale; the limiter below catches whatever that costs in headroom. */
  function gainFor(pct) {
    var x = pct / 100;
    if (x <= 0) return 0;
    return 0.95 * Math.pow(x, 1.8) + 0.03;
  }

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    /* Drone, flute and bowl can all land at once. Rather than mixing each one
       timidly enough that the sum is always safe — which is what made this
       inaudible in the first place — they are mixed properly and a limiter
       catches the peaks. */
    /* A safety net, not a compressor. At -6/8:1 it was riding the gain on
       every pluck, and steady gain-riding on a sustained drone is audible as
       pumping — the exact opposite of what this page is for. At -3/6:1 with
       the levels below, nothing touches it at the default volume and it only
       catches the peaks at full. */
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;

    /* A true ceiling behind the limiter. The limiter is deliberately gentle,
       and its 5ms attack lets the front of a transient through — a bowl
       landing on top of the tanpura at full volume measured 1.03, which the
       sound card would square off into an audible click.

       This curve is exactly linear below 0.7, so nothing at ordinary listening
       levels is coloured at all, and rounds off above it to a hard ceiling of
       0.93. It is the difference between a peak being shaped and a peak being
       clipped. */
    var ceiling = ctx.createWaveShaper();
    ceiling.curve = softClipCurve();
    ceiling.oversample = '2x';

    master.connect(limiter);
    limiter.connect(ceiling);
    ceiling.connect(ctx.destination);

    // Warmth, and nothing sharp: everything sits under a gentle low-pass.
    // 2600 rather than the old 1600 — the tanpura's whole character lives in
    // its upper partials, and at 1600 the buzz that makes it a tanpura instead
    // of an organ was being filtered off.
    warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 2600;
    warm.Q.value = 0.4;
    warm.connect(master);

    /* Reverb, and it is the single thing this most needed. Everything before
       was bone dry, which is why it read as oscillators in a box rather than
       as a sound happening somewhere. Devotional music is inseparable from the
       room it is played in — the stone hall IS part of the instrument.

       The impulse response is generated, not downloaded: noise decaying
       exponentially, run through a one-pole low-pass so the tail darkens as it
       fades the way a real room does (high frequencies are absorbed first).
       Left and right get independently generated noise, which is what makes it
       open out into stereo instead of sitting in the middle of your head. */
    var verb = ctx.createConvolver();
    verb.buffer = makeIR(4.6, 2.4, 0.22);

    var wet = ctx.createGain();
    wet.gain.value = 0.45;
    verb.connect(wet);
    wet.connect(master);

    // Pre-delay: a few milliseconds before the room answers. Without it the
    // reverb smears the attack and every pluck loses its edge.
    var pre = ctx.createDelay(0.5);
    pre.delayTime.value = 0.035;
    pre.connect(verb);

    send = ctx.createGain();
    send.gain.value = 0.75;
    send.connect(pre);

    // Everything dry also goes to the room.
    warm.connect(send);

    /* Under the tanpura, a sustained sub. Not a voice in its own right — at
       55 Hz it is felt more than heard — but it gives the plucks a floor to
       stand on, and its absence was a large part of why this sounded thin.

       The two near-55Hz oscillators are 0.13 Hz apart, which beats once every
       7.7 seconds. That slow swell is deliberate: it keeps the floor moving
       without anything audibly modulating. */
    /* Kept in droneTones as well as drone so a track change can retune them.
       They are started once and never replaced: sliding the tonic under a
       listener is the calm way to change key, and stopping and restarting the
       bed would put a hole in the sound exactly where the change happens. */
    droneTones = [];
    track.drone.forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      var g = ctx.createGain();
      g.gain.value = i === 2 ? 0.08 : 0.14;
      o.connect(g); g.connect(warm);
      o.start();
      drone.push(o);
      droneTones.push(o);
    });

    // A very slow swell across the whole bed, on the page's own breathing
    // period, so the sound rises and falls with the halo above it.
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 10;          // 10s, the same as the halo
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 420;
    lfo.connect(lfoGain); lfoGain.connect(warm.frequency);
    lfo.start();
    drone.push(lfo);

    return true;
  }

  /* Linear to KNEE, then a tanh shoulder up to a fixed ceiling. Anything the
     page plays at a sensible volume passes through untouched; only the peaks
     that would have clipped are bent. */
  function softClipCurve() {
    var KNEE = 0.7;
    var CEIL = 0.93;
    var n = 4096;
    var c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      var a = Math.abs(x);
      var y = a <= KNEE
        ? a
        : KNEE + (CEIL - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }

  /* An impulse response, computed rather than fetched. seconds sets the tail,
     decay how fast it falls away, damp how quickly the room eats the top end
     (higher = darker, more stone and cloth, less glass). */
  function makeIR(seconds, decay, damp) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * seconds));
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        last += damp * (n - last);      // one-pole low-pass on the tail
        d[i] = last;
      }
    }
    return buf;
  }

  /* One struck bowl. Partials are inharmonic and each fades at its own rate,
     with the high ones dying first, which is what makes it read as metal
     rather than as a synthesiser. */
  /* ---------------------------------------------------------------------
     The tanpura
     ---------------------------------------------------------------------
     This replaced three oscillators held at constant pitch, which is an
     organ, not a drone. A tanpura is four plucked strings cycling endlessly,
     and two things about it matter far more than the notes.

     The first is jivari. The strings pass over a curved bridge with a thread
     under them, so the string re-contacts the bridge as it vibrates and the
     upper partials do not decay from the moment of the pluck — they SWELL,
     peaking well after the attack, then fade. That late bloom is the shimmer
     people recognise as a tanpura, and it is why each partial below gets its
     own peak time rather than a shared envelope.

     The second is overlap. The plucks come closer together than any one note
     takes to die, so four strings become one continuous cloud that never
     quite repeats. Nothing here loops; the cycle is rescheduled each time
     with a little drift, so two minutes in it is still not a pattern.
     ------------------------------------------------------------------ */

  /* ---------------------------------------------------------------------
     Four settings, cycled with T
     ---------------------------------------------------------------------
     Every one of these is a real raga with a time of day attached to it, which
     is not decoration: in Hindustani practice a raga belongs to an hour, and
     the reason they sound the way they do is that they were shaped to suit it.
     Bhairavi is a dawn raga, Yaman and Bhupali are evening ragas, and the last
     setting is not a raga at all but a sustained Om over a lower tonic.

     Pa Sa Sa Sa is the standard tanpura tuning. The low Sa last is what gives
     the cycle its rocking, settling feel rather than a flat pulse, so every
     setting keeps that shape and only moves the pitches.

     What changes per track: the drone tuning, the tanpura, the scale the flute
     draws from, the bowl set, and — the part that matters most for calm — the
     pacing. A faster raga is not a louder one here; it is one where the
     silences are shorter. --------------------------------------------- */
  var TRACKS = [
    {
      name: 'Bhairavi at dawn',
      drone: [55, 55.13, 110],
      tanpura: [164.81, 220.0, 220.0, 110.0],
      // S r g P d — the flat second is the whole character of the raga
      raga: [220.0, 233.08, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0],
      bowls: [196.0, 220.0, 261.63, 293.66, 329.63],
      flute: { wait: [7000, 11000], notes: [2, 3], dur: [1.6, 1.9] },
      bowl: [26000, 34000]
    },
    {
      name: 'Yaman at dusk',
      drone: [55, 55.13, 110],
      tanpura: [164.81, 220.0, 220.0, 110.0],
      // S R G M# P D N — everything natural but the sharpened fourth, which is
      // the note that makes Yaman sound like the light going
      raga: [220.0, 246.94, 277.18, 311.13, 329.63, 369.99, 415.30, 440.0],
      bowls: [220.0, 246.94, 277.18, 329.63, 369.99],
      flute: { wait: [9000, 14000], notes: [2, 4], dur: [2.1, 2.2] },
      bowl: [30000, 38000]
    },
    {
      name: 'Bhupali, evening',
      drone: [55, 55.13, 110],
      tanpura: [164.81, 220.0, 220.0, 110.0],
      // Five notes only, S R G P D. Nothing in a pentatonic can clash with
      // anything else in it, which is why this is the most restful of the four.
      raga: [220.0, 246.94, 277.18, 329.63, 369.99, 440.0, 493.88],
      bowls: [220.0, 246.94, 277.18, 329.63, 369.99],
      flute: { wait: [11000, 16000], notes: [2, 3], dur: [2.4, 2.4] },
      bowl: [20000, 26000]
    },
    {
      /* No flute at all. A melody, however sparse, is something to follow, and
         this setting is for not following anything: a lower tonic, a voice on
         the drone, and bowls closer together. */
      name: 'Om, sustained',
      drone: [49, 49.13, 98],
      tanpura: [146.83, 196.0, 196.0, 98.0],
      raga: null,
      bowls: [196.0, 220.0, 246.94, 293.66, 329.63],
      flute: null,
      bowl: [14000, 19000],
      chant: { wait: [15000, 21000], freq: 98.0, dur: [6.5, 3.5] }
    }
  ];

  var trackIndex = 0;
  var track = TRACKS[0];
  var tanpuraStep = 0;
  var tanpuraTimer = null;

  function pluck(freq, when, level) {
    var PARTIALS = 14;
    for (var n = 1; n <= PARTIALS; n++) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * n;
      // Real strings are never exactly harmonic, and exact ratios sound dead.
      o.detune.value = (Math.random() - 0.5) * 7 + (n > 6 ? n * 0.6 : 0);

      // The jivari bloom: the higher the partial, the later it peaks and the
      // faster it then goes. The fundamental is the only one that speaks at
      // the moment of the pluck.
      var peak = when + (n === 1 ? 0.012 : 0.05 + n * 0.028);
      var amp = level * Math.pow(n, -1.18) * (n === 1 ? 1 : 1.35);
      var decay = 5.2 / Math.pow(n, 0.42);

      var g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(amp, peak);
      g.gain.exponentialRampToValueAtTime(0.0001, peak + decay);

      o.connect(g); g.connect(warm);
      o.start(when);
      o.stop(peak + decay + 0.1);
    }
  }

  function scheduleTanpura() {
    // 1.5s between plucks against a 5s decay, so four strings overlap into one
    // continuous wash. The drift stops the cycle ever becoming a loop.
    var wait = 1500 + Math.random() * 260;
    tanpuraTimer = window.setTimeout(function () {
      if (playing && ctx && ctx.state === 'running') {
        var seq = track.tanpura;
        var f = seq[tanpuraStep % seq.length];
        // The low Sa is plucked a little harder, as a player would.
        var level = (tanpuraStep % seq.length === 3) ? 0.16 : 0.12;
        pluck(f, ctx.currentTime + 0.02, level * (0.9 + Math.random() * 0.2));
        tanpuraStep++;
      }
      scheduleTanpura();
    }, wait);
  }

  function strike(freq, when, level) {
    var partials = [
      { mult: 1,    gain: 1.0,  decay: 9 },
      { mult: 2.71, gain: 0.42, decay: 6 },
      { mult: 5.43, gain: 0.18, decay: 3.6 },
      { mult: 8.91, gain: 0.08, decay: 2.2 }
    ];
    partials.forEach(function (p) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * p.mult;
      // a hair of drift, so no two strikes are identical
      o.detune.value = (Math.random() - 0.5) * 8;

      var g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(level * p.gain, when + 0.012);   // the tap
      g.gain.exponentialRampToValueAtTime(0.0001, when + p.decay);    // the ring

      // Into warm rather than master: the bowl was the one voice mixed dry
      // and past the filter, so it sat in front of everything else instead of
      // in the same room as it.
      o.connect(g); g.connect(warm);
      o.start(when);
      o.stop(when + p.decay + 0.2);
    });
  }

  // Bowl sets live on the tracks above; each is a pentatonic subset of its own
  // raga, so any two strikes that overlap still agree.

  /* ---------------------------------------------------------------------
     The flute
     ---------------------------------------------------------------------
     A bansuri is mostly a sine with a little odd-harmonic colour, and the
     part that actually sells it is the breath: a band of noise under the
     tone, loudest at the start of a note. Without that it is just an organ.

     Two more things do the heavy lifting. Vibrato that arrives late — a real
     player steadies a note first and opens the vibrato as it sustains — and
     meend, the slide between notes, which is the single most characteristic
     gesture in Indian flute playing. A note that simply appears at its pitch
     sounds typed; a note slid into sounds played.
     ------------------------------------------------------------------ */

  var lastNote = null;
  var noiseBuf = null;

  function breathBuffer() {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function flute(freq, when, dur, slideFrom) {
    var out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);

    // body: a sine with a quiet octave and twelfth above it
    [[1, 1.0], [2, 0.12], [3, 0.05]].forEach(function (h) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      var g = ctx.createGain();
      g.gain.value = h[1];
      if (slideFrom && h[0] === 1) {
        // meend: arrive at the note rather than starting on it
        o.frequency.setValueAtTime(slideFrom, when);
        o.frequency.exponentialRampToValueAtTime(freq, when + 0.28);
      } else {
        o.frequency.setValueAtTime(freq * h[0], when);
      }
      if (h[0] > 1) o.frequency.setValueAtTime(freq * h[0], when);
      o.connect(g); g.connect(out);
      o.start(when); o.stop(when + dur + 0.4);

      // vibrato, opening only once the note has settled
      if (h[0] === 1) {
        var vib = ctx.createOscillator();
        vib.frequency.value = 4.6;
        var vibDepth = ctx.createGain();
        vibDepth.gain.setValueAtTime(0, when);
        vibDepth.gain.linearRampToValueAtTime(0, when + dur * 0.35);
        vibDepth.gain.linearRampToValueAtTime(freq * 0.011, when + dur * 0.7);
        vib.connect(vibDepth); vibDepth.connect(o.frequency);
        vib.start(when); vib.stop(when + dur + 0.4);
      }
    });

    // breath: noise through a band-pass around the note, loudest at the attack
    var n = ctx.createBufferSource();
    n.buffer = breathBuffer();
    n.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2.1;
    bp.Q.value = 1.1;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0, when);
    ng.gain.linearRampToValueAtTime(0.11, when + 0.09);
    ng.gain.exponentialRampToValueAtTime(0.006, when + Math.min(1.2, dur));
    n.connect(bp); bp.connect(ng); ng.connect(out);
    n.start(when); n.stop(when + dur + 0.3);

    // the note itself: slow in, long out, the way a breath actually behaves
    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(0.34, when + 0.34);
    out.gain.setValueAtTime(0.34, when + dur * 0.62);
    out.gain.exponentialRampToValueAtTime(0.0008, when + dur);
  }

  var fluteTimer = null;

  function schedulePhrase() {
    // long silences on purpose: this sits under a page for reading, not a
    // performance, and a flute that never stops becomes wallpaper
    var f = track.flute;
    var wait = f ? f.wait[0] + Math.random() * f.wait[1] : 8000;
    fluteTimer = window.setTimeout(function () {
      // A track with no scale has no flute. The timer keeps turning over so
      // that switching back to one that does needs no restarting.
      var cfg = track.flute, scale = track.raga;
      if (cfg && scale && playing && ctx && ctx.state === 'running') {
        var t = ctx.currentTime + 0.1;
        var notes = cfg.notes[0] + Math.floor(Math.random() * cfg.notes[1]);
        for (var i = 0; i < notes; i++) {
          // step mostly by neighbours, so the line wanders rather than leaps
          var idx = lastNote === null
            ? 2 + Math.floor(Math.random() * 3)
            : Math.max(0, Math.min(scale.length - 1,
                lastNote + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.75 ? 1 : 2)));
          idx = Math.min(idx, scale.length - 1);
          var dur = cfg.dur[0] + Math.random() * cfg.dur[1];
          var slide = (lastNote !== null && scale[lastNote] !== undefined && Math.random() < 0.55)
            ? scale[lastNote] : null;
          flute(scale[idx], t, dur, slide);
          lastNote = idx;
          t += dur * (0.72 + Math.random() * 0.4);
        }
      }
      schedulePhrase();
    }, wait);
  }

  /* The voice on the Om setting. A sawtooth is a buzz; three bandpass filters
     at the formants of an "O" are what make the ear hear a throat instead of
     an oscillator. Slow in, held, slow out — the shape of a sung breath. */
  function chant(freq, when, dur) {
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;

    var mix = ctx.createGain();
    [[430, 1.0, 7], [820, 0.5, 9], [2600, 0.12, 13]].forEach(function (fm) {
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = fm[0];
      bp.Q.value = fm[2];
      var g = ctx.createGain();
      g.gain.value = fm[1];
      o.connect(bp); bp.connect(g); g.connect(mix);
    });

    // A little movement, or it sits dead still and sounds synthetic.
    var vib = ctx.createOscillator();
    var vibDepth = ctx.createGain();
    vib.frequency.value = 3.4;
    vibDepth.gain.value = freq * 0.006;
    vib.connect(vibDepth); vibDepth.connect(o.frequency);

    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(0.15, when + dur * 0.38);
    env.gain.setValueAtTime(0.15, when + dur * 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    mix.connect(env); env.connect(warm); env.connect(send);
    o.start(when); o.stop(when + dur + 0.1);
    vib.start(when); vib.stop(when + dur + 0.1);
  }

  var chantTimer = null;

  function scheduleChant() {
    var c = track.chant;
    var wait = c ? c.wait[0] + Math.random() * c.wait[1] : 12000;
    chantTimer = window.setTimeout(function () {
      var cfg = track.chant;
      if (cfg && playing && ctx && ctx.state === 'running') {
        chant(cfg.freq, ctx.currentTime + 0.05, cfg.dur[0] + Math.random() * cfg.dur[1]);
      }
      scheduleChant();
    }, wait);
  }


  function scheduleBowl() {
    // punctuation, not the tune — the spacing comes from the track
    var wait = track.bowl[0] + Math.random() * track.bowl[1];
    bowlTimer = window.setTimeout(function () {
      if (playing && ctx && ctx.state === 'running') {
        var set = track.bowls;
        strike(set[Math.floor(Math.random() * set.length)], ctx.currentTime + 0.05, 0.5);
      }
      scheduleBowl();
    }, wait);
  }

  function fadeTo(value, seconds) {
    if (!master) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  function start() {
    if (!ctx && !build()) return;
    window.clearTimeout(suspendTimer);
    if (ctx.state === 'suspended') ctx.resume();
    playing = true;
    fadeTo(gainFor(volume), 3);            // in slowly; nobody wants a jolt
    if (!bowlTimer) scheduleBowl();
    if (!fluteTimer) schedulePhrase();
    if (!tanpuraTimer) scheduleTanpura();
    if (!chantTimer) scheduleChant();
    // First pluck immediately, so the drone is present from the first second
    // rather than arriving a beat and a half after the button.
    pluck(track.tanpura[3], ctx.currentTime + 0.03, 0.16);
    tanpuraStep = 1;
    // one bowl now, so pressing the button clearly does something
    strike(track.bowls[2], ctx.currentTime + 0.15, 0.45);
    sync();
  }

  function stop() {
    playing = false;
    fadeTo(0, 1.6);
    // Fading only turns it down. Suspend once the fade has landed so the audio
    // thread genuinely stops rather than idling at zero volume.
    window.clearTimeout(suspendTimer);
    suspendTimer = window.setTimeout(function () {
      if (!playing && ctx && ctx.state === 'running') ctx.suspend();
    }, 1800);
    sync();
  }


  /* ---------------------------------------------------------------------
     Changing the setting
     ------------------------------------------------------------------ */

  function announceTrack(quiet) {
    document.dispatchEvent(new CustomEvent('buddha:track', {
      detail: { name: track.name, index: trackIndex, total: TRACKS.length, quiet: !!quiet }
    }));
  }

  function setTrack(i) {
    trackIndex = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    track = TRACKS[trackIndex];
    lastNote = null;
    tanpuraStep = 0;

    /* Slide the tonic rather than jumping it. Two seconds is long enough that
       the ear follows the drone down instead of noticing a cut, which is the
       whole point of changing anything on this page gently. */
    if (ctx && droneTones.length === track.drone.length) {
      droneTones.forEach(function (o, n) {
        o.frequency.setTargetAtTime(track.drone[n], ctx.currentTime, 0.8);
      });
    }
    /* One bowl from the new set, so the change is audible immediately even in
       the long gap before the next phrase. */
    if (playing && ctx && ctx.state === 'running') {
      strike(track.bowls[Math.floor(Math.random() * track.bowls.length)], ctx.currentTime + 0.05, 0.4);
    }
    announceTrack();
  }

  /* T, the same key as the loud page, so the two scenes are learned once. Not
     m — buddha.js already binds that to the breath words. WCAG 2.1.4 is why
     this is guarded rather than a bare keydown: a single-character shortcut
     must never fire while somebody is typing. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 't' && e.key !== 'T') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    e.preventDefault();
    setTrack(trackIndex + 1);
  });

  /* The same thing, for a phone — see the note in party-sound.js. */
  if (window.TapCycle) {
    window.TapCycle.on(function () { setTrack(trackIndex + 1); },
      { key: 'buddha', hint: 'Double-tap anywhere for another setting' });
  }

  /* The toast and the live region. Kept here rather than in buddha.js because
     the setting is this file's business, and because the page's existing
     .b-announce belongs to the verses — writing tracks into it would interrupt
     somebody mid-verse. */
  var trackToast = document.querySelector('.b-toast');
  var trackSay = document.querySelector('.b-track-announce');
  var toastTimer = null;

  document.addEventListener('buddha:track', function (ev) {
    var d = ev.detail || {};
    if (d.quiet) return;
    if (trackToast) {
      trackToast.textContent = d.name;
      trackToast.classList.add('is-shown');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        trackToast.classList.remove('is-shown');
      }, 2800);
    }
    if (trackSay) trackSay.textContent = 'Setting ' + (d.index + 1) + ' of ' + d.total + ': ' + d.name;
  });

  /* Nothing should outlive the page. pagehide covers closing the tab,
     navigating away, and being put into the back/forward cache — where a
     merely-muted context would still be sitting there, ready to be heard
     again when the page is restored. */
  function teardown() {
    var wasPlaying = playing;
    playing = false;
    window.clearTimeout(bowlTimer); bowlTimer = null;
    window.clearTimeout(fluteTimer); fluteTimer = null;
    window.clearTimeout(tanpuraTimer); tanpuraTimer = null;
    window.clearTimeout(chantTimer); chantTimer = null;
    window.clearTimeout(suspendTimer);
    if (ctx) {
      try { ctx.close(); } catch (e) {}
      ctx = null; master = null; warm = null; send = null; drone = []; droneTones = [];
    }
    /* The controls have to be told, or a page restored from the bfcache comes
       back with a lit speaker and aria-pressed="true" over a context that was
       closed on the way out — the button claiming a sound nobody can hear.
       paint(), not sync(): STORE_ON must keep the visitor's preference. */
    paint();
    if (wasPlaying) {
      // They did leave it on. Pre-light it exactly as a remembered preference
      // does, so one press picks up where they left off.
      toggle.classList.add('is-remembered');
      toggle.setAttribute('title', 'Sound off — press to resume');
    }
  }

  window.addEventListener('pagehide', teardown);
  window.addEventListener('beforeunload', teardown);

  /* The visible half of sync(), split out because teardown() needs it without
     the storage write: a page going into the bfcache with the sound on must
     still remember that preference for the next visit. */
  function paint() {
    toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
    toggle.setAttribute('aria-label', playing ? 'Turn the sound off' : 'Turn the sound on');
    toggle.setAttribute('title', playing ? 'Sound on' : 'Sound off');
    toggle.classList.toggle('is-on', playing);
    slider.disabled = !playing;
  }

  function sync() {
    paint();
    store(STORE_ON, playing ? '1' : '0');
  }

  /* The volume slider hides itself the way a video player's does. CSS handles
     hover and keyboard focus on its own; this covers what CSS cannot see — a
     touch tap leaves no hover state behind, and switching the sound on should
     show the slider before it folds away again.

     Every call restarts the clock, so dragging the slider (which fires input
     continuously) holds it open, and it only closes once you have finished. */
  var REVEAL_MS = 2600;
  var revealTimer = 0;
  var audioWrap = document.querySelector('.b-audio');

  function reveal() {
    if (!audioWrap) return;
    audioWrap.classList.add('is-reveal');
    window.clearTimeout(revealTimer);
    revealTimer = window.setTimeout(function () {
      audioWrap.classList.remove('is-reveal');
    }, REVEAL_MS);
  }

  /* pointerdown rather than click: it fires for touch, pen and mouse alike, and
     it fires on the way down so the slider is already open by the time a finger
     lands on it. */
  if (audioWrap) audioWrap.addEventListener('pointerdown', reveal);

  toggle.addEventListener('click', function (e) {
    if (playing) stop(); else start();
    reveal();
    /* Same reason as the fullscreen button: a clicked control keeps focus, and
       the idle rules never hide a focused control, so the speaker would stay
       lit over a scene it was supposed to leave alone. detail > 0 is a real
       pointer press; keyboard activation reports 0 and keeps its focus. */
    if (e.detail > 0) toggle.blur();
  });

  slider.addEventListener('input', function () {
    volume = parseInt(slider.value, 10) || 0;
    store(STORE_VOL, String(volume));
    if (playing) fadeTo(gainFor(volume), 0.25);
    reveal();
  });

  /* Hidden tab: fade out, then suspend the context so it is not merely quiet
     but actually stopped. Coming back resumes it and fades in again. */
  document.addEventListener('visibilitychange', function () {
    if (!playing || !ctx) return;
    window.clearTimeout(suspendTimer);
    if (document.hidden) {
      fadeTo(0, 0.6);
      suspendTimer = window.setTimeout(function () {
        if (playing && document.hidden && ctx && ctx.state === 'running') ctx.suspend();
      }, 800);
    } else {
      if (ctx.state === 'suspended') ctx.resume();
      fadeTo(gainFor(volume), 1.2);
    }
  });

  /* ---------------------------------------------------------------------
     If you license a track
     ---------------------------------------------------------------------
     Put the file in /assets/audio/ and set TRACK below to its path. The
     controls, the fade, the volume curve and the tab-hidden behaviour all
     carry over unchanged; the synthesised bowls simply never get built.

     It must be a file you hold a licence for. Crediting the artist is not a
     licence — attribution and permission are different things, and a note in
     the Terms page does not change that. Sync licences for Indian film music
     come from the label (T-Series, Saregama) or a clearing service.

     The CSP is default-src 'self' with no media-src, so the file has to be
     served from this domain. A hotlink to someone else's server is blocked by
     the browser before copyright even becomes the problem.
     ------------------------------------------------------------------ */

  var TRACK = null;   // e.g. '/assets/audio/ambience.mp3'

  if (TRACK) {
    var el = new Audio(TRACK);
    el.loop = true;
    el.preload = 'none';
    start = function () {
      playing = true;
      el.volume = gainFor(volume) * 2.6;
      el.play().catch(function () { playing = false; sync(); });
      sync();
    };
    stop = function () { playing = false; el.pause(); sync(); };
    slider.addEventListener('input', function () { el.volume = gainFor(volume) * 2.6; });
    document.addEventListener('visibilitychange', function () {
      if (playing) { if (document.hidden) el.pause(); else el.play().catch(function () {}); }
    });
  }

  /* Read BEFORE sync(), never after. sync() writes STORE_ON on every call, so
     once it has run the stored flag is always '0' — playing is false at this
     point — and the test below could never be true. The remembered state and
     the .is-remembered rule in buddha.css were unreachable because of it. */
  var remembered = recall(STORE_ON, '0') === '1';

  sync();

  /* Deliberately NOT auto-started, even when the last visit left it on:
     browsers block it without a gesture, and a page that makes noise on load
     is a page people close. The remembered preference only pre-lights the
     button so one press picks up where they left off. */
  if (remembered) {
    toggle.classList.add('is-remembered');
    toggle.setAttribute('title', 'Sound off — press to resume');
  }
}());

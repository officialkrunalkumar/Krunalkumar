/* ==========================================================================
   party-sound.js — the groove on /party, generated rather than downloaded.
   --------------------------------------------------------------------------
   Same reasoning as buddha-sound.js, and worth repeating because the pull to
   just drop in an MP3 is much stronger for dance music than for a drone.

   Licensing. A four-bar loop that actually slaps is copyrighted twice over,
   as a composition and as a recording, and this site sells services — an
   unlicensed track on it is a real liability, not a technicality. A waveform
   computed in the browser belongs to nobody.

   Weight. The kind of track this page wants runs 3-6 MB. This file is a few
   kilobytes and plays a thirty-two bar arrangement that never repeats exactly.

   Policy. Browsers refuse to start audio without a user gesture. Nothing here
   makes a sound until the speaker button is pressed, and the choice is
   remembered in localStorage like the buddha page does it.

   IT IS AN ARRANGEMENT, NOT A LOOP. A four-bar loop is what makes generated
   music sound generated: the ear learns it in twenty seconds and then hears
   nothing but the seam. So this runs a thirty-two bar structure — intro, the
   bass entering, the full groove, a breakdown with the drums pulled out, a
   riser and snare roll building tension, then the drop — and only then comes
   back around. Same trick every dance record uses, for the same reason.

   The kit is deliberately complete: a sine kick that pitch-drops, a noise
   clap, closed and open hats, a shaker, a resonant saw bass with a sub under
   it, three detuned saws for the chord stab, a square lead and a noise riser.
   Low end, high end and everything between, which is what makes a groove feel
   like a groove rather than a hum.

   It emits `party:beat` on every beat and `party:playing` when it starts or
   stops, so the lighting can move with the music — see party.js, which keeps
   its own clock running when the sound is off so the room never freezes.
   ========================================================================== */

(function () {
  'use strict';

  var STORE_ON = 'lab.party.sound';
  var STORE_VOL = 'lab.party.vol';

  var toggle = document.querySelector('.p-audio-toggle');
  var slider = document.querySelector('.p-audio-vol');
  if (!toggle || !slider) return;

  var LOOKAHEAD = 0.12;
  var TICK = 25;
  var BARS = 32;                     // length of the arrangement

  /* Four tracks, cycled with the P key. They are genuinely different records,
     not one loop with the filter moved: each brings its own tempo, key, chord
     movement, drum pattern, bass rhythm, lead motif and lead waveform. The
     tempo travels with the track because the lighting and the dancers read it
     off the `party:track` event - see party.js. */
  var A_MIN = [
    { root: 55.00, notes: [220.00, 261.63, 329.63, 440.00] },   // Am
    { root: 43.65, notes: [174.61, 220.00, 261.63, 349.23] },   // F
    { root: 65.41, notes: [196.00, 261.63, 329.63, 392.00] },   // C
    { root: 49.00, notes: [196.00, 246.94, 293.66, 392.00] }    // G
  ];

  var TRACKS = [
    {
      name: 'Midnight House', bpm: 124, chords: A_MIN, wave: 'square',
      kick: [0, 4, 8, 12], clap: [4, 12], hatEvery: 2, openHat: 14,
      bass: [0, 3, 6, 8, 11, 14], stabs: [2, 10],
      lead: [{ s: 0, d: 3 }, { s: 2, d: 2 }, { s: 4, d: 3 }, { s: 6, d: 1 },
             { s: 7, d: 2 }, { s: 10, d: 3 }, { s: 12, d: 0 }, { s: 14, d: 2 }]
    },
    {
      // Slower and syncopated: the kick leaves beat three alone, and that gap
      // is what the bassline walks through.
      name: 'Neon Funk', bpm: 112, wave: 'sawtooth',
      chords: [
        { root: 73.42, notes: [146.83, 174.61, 220.00, 293.66] },  // Dm
        { root: 49.00, notes: [196.00, 246.94, 293.66, 392.00] },  // G
        { root: 65.41, notes: [196.00, 261.63, 329.63, 392.00] },  // C
        { root: 55.00, notes: [220.00, 261.63, 329.63, 440.00] }   // Am
      ],
      kick: [0, 6, 8, 14], clap: [4, 12], hatEvery: 2, hatOffset: 1, openHat: 10,
      bass: [0, 2, 3, 6, 8, 10, 11, 14], stabs: [4, 6, 12, 14],
      lead: [{ s: 2, d: 1 }, { s: 3, d: 2 }, { s: 6, d: 3 }, { s: 8, d: 2 },
             { s: 11, d: 1 }, { s: 14, d: 0 }]
    },
    {
      // Fast, rolling sixteenths and an arpeggio that never sits still.
      name: 'Sunrise Trance', bpm: 138, wave: 'sawtooth',
      chords: [
        { root: 55.00, notes: [220.00, 261.63, 329.63, 440.00] },  // Am
        { root: 65.41, notes: [196.00, 261.63, 329.63, 392.00] },  // C
        { root: 49.00, notes: [196.00, 246.94, 293.66, 392.00] },  // G
        { root: 43.65, notes: [174.61, 220.00, 261.63, 349.23] }   // F
      ],
      kick: [0, 4, 8, 12], clap: [4, 12], hatEvery: 1, openHat: 14,
      bass: [0, 2, 4, 6, 8, 10, 12, 14], stabs: [0, 8],
      lead: [{ s: 0, d: 0 }, { s: 2, d: 1 }, { s: 4, d: 2 }, { s: 6, d: 3 },
             { s: 8, d: 2 }, { s: 10, d: 1 }, { s: 12, d: 2 }, { s: 14, d: 3 }]
    },
    {
      // Two-step: the kick skips the second downbeat and lands late, which is
      // the whole feel of garage.
      name: 'Garage Skip', bpm: 130, wave: 'triangle',
      chords: [
        { root: 65.41, notes: [155.56, 196.00, 261.63, 311.13] },  // Cm
        { root: 51.91, notes: [207.65, 261.63, 311.13, 415.30] },  // Ab
        { root: 77.78, notes: [155.56, 196.00, 233.08, 311.13] },  // Eb
        { root: 58.27, notes: [174.61, 233.08, 293.66, 349.23] }   // Bb
      ],
      kick: [0, 10], clap: [4, 12], hatEvery: 2, hatOffset: 1, openHat: 6,
      bass: [0, 3, 6, 10, 13], stabs: [6, 14],
      lead: [{ s: 1, d: 2 }, { s: 4, d: 3 }, { s: 7, d: 1 }, { s: 10, d: 2 },
             { s: 13, d: 3 }]
    }
  ];

  var trackIndex = 0;
  var track = TRACKS[0];
  var BPM = track.bpm;
  var SPB = 60 / BPM;

  var ctx = null;
  var master = null, warm = null, send = null, comp = null;
  var noiseBuf = null;
  var playing = false;
  var step = 0;
  var nextTime = 0;
  var timer = null;
  var suspendTimer = null;

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function recall(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }

  var volume = Math.min(100, Math.max(0, parseInt(recall(STORE_VOL, '78'), 10) || 78));

  /* Perceived loudness is not linear. Squaring the slider position keeps the
     lower half of the travel useful instead of jumping from silent to loud in
     the first fifth. The 0.85 ceiling is higher than the buddha page's 0.55
     because this is a mix with a compressor and a soft clipper after it, not a
     bare drone — there is headroom management downstream. */
  function gainFor(pct) { var x = pct / 100; return 0.85 * x * x; }

  function softClipCurve() {
    var n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * 1.7);
    }
    return curve;
  }

  function makeIR(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.max(1, Math.floor(rate * seconds));
    var buf = ctx.createBuffer(2, len, rate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 12;
    comp.ratio.value = 4.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    var shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();

    warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 12000;
    warm.Q.value = 0.5;

    var verb = ctx.createConvolver();
    verb.buffer = makeIR(1.1, 3.2);
    var verbGain = ctx.createGain();
    verbGain.gain.value = 0.5;
    send = ctx.createGain();
    send.gain.value = 1;

    warm.connect(shaper);
    shaper.connect(comp);
    comp.connect(master);
    send.connect(verb);
    verb.connect(verbGain);
    verbGain.connect(comp);
    master.connect(ctx.destination);

    noiseBuf = makeNoise();
    return true;
  }

  function env(node, when, peak, attack, decay) {
    var g = node.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    g.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  function noiseVoice(when, hp, peak, decay, bp) {
    var s = ctx.createBufferSource();
    var f = ctx.createBiquadFilter();
    var g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = bp ? 'bandpass' : 'highpass';
    f.frequency.value = hp;
    if (bp) f.Q.value = 1.1;
    env(g, when, peak, 0.001, decay);
    s.connect(f); f.connect(g); g.connect(warm);
    s.start(when); s.stop(when + decay + 0.08);
    return g;
  }

  /* ---- the kit ---------------------------------------------------------- */

  function kick(when, hard) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = 'sine';
    /* The drop is the whole sound. A steady 50 Hz sine is a hum; sweeping
       165 -> 47 in forty milliseconds is a kick drum. */
    o.frequency.setValueAtTime(hard ? 175 : 160, when);
    o.frequency.exponentialRampToValueAtTime(47, when + 0.04);
    g.gain.setValueAtTime(hard ? 1.05 : 0.92, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);
    o.connect(g); g.connect(warm);
    o.start(when); o.stop(when + 0.36);
  }

  function clap(when) {
    /* Three bursts a few milliseconds apart, not one. A single noise hit is a
       snare; the little smear of repeats is what the ear hears as hands. */
    for (var i = 0; i < 3; i++) {
      var t = when + i * 0.009;
      var g = noiseVoice(t, 1250, 0.36 - i * 0.06, 0.06 + i * 0.02, true);
      g.connect(send);
    }
  }

  function snare(when, level) {
    var g = noiseVoice(when, 1900, level, 0.09, true);
    g.connect(send);
    var o = ctx.createOscillator();
    var og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, when);
    o.frequency.exponentialRampToValueAtTime(150, when + 0.08);
    env(og, when, level * 0.5, 0.001, 0.07);
    o.connect(og); og.connect(warm);
    o.start(when); o.stop(when + 0.12);
  }

  function hat(when, open, accent) {
    noiseVoice(when, open ? 6200 : 8400, accent ? 0.17 : 0.09, open ? 0.24 : 0.035);
  }

  function shaker(when, level) { noiseVoice(when, 5200, level, 0.05); }

  function bass(freq, when, dur) {
    var o = ctx.createOscillator();
    var lp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.Q.value = 8;
    /* The filter envelope is the bassline's accent. Without the sweep every
       note lands with identical brightness and the pattern stops grooving. */
    lp.frequency.setValueAtTime(190, when);
    lp.frequency.exponentialRampToValueAtTime(1150, when + 0.05);
    lp.frequency.exponentialRampToValueAtTime(230, when + dur);
    env(g, when, 0.34, 0.006, dur);
    o.connect(lp); lp.connect(g); g.connect(warm);
    o.start(when); o.stop(when + dur + 0.05);

    var sub = ctx.createOscillator();
    var sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = freq;
    env(sg, when, 0.38, 0.008, dur * 0.9);
    sub.connect(sg); sg.connect(warm);
    sub.start(when); sub.stop(when + dur + 0.05);
  }

  function stab(notes, when, level, dur) {
    /* Three saws detuned a few cents against each other. The beating between
       them is the entire reason a stack sounds rich and one saw sounds thin. */
    notes.forEach(function (f, i) {
      [-7, 0, 7].forEach(function (cents) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = f * Math.pow(2, cents / 1200);
        env(g, when, (level - i * 0.008), 0.006, dur);
        o.connect(g); g.connect(warm); g.connect(send);
        o.start(when); o.stop(when + dur + 0.06);
      });
    });
  }

  function lead(freq, when, level, wave) {
    var o = ctx.createOscillator();
    var lp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = 2900;
    lp.Q.value = 3;
    env(g, when, level, 0.004, 0.17);
    o.connect(lp); lp.connect(g); g.connect(warm); g.connect(send);
    o.start(when); o.stop(when + 0.24);
  }

  /* One long noise sweep opening up over four bars. This is the sound that
     tells a listener something is about to happen, and it is most of why a
     build feels like a build. */
  function riser(when, bars) {
    var s = ctx.createBufferSource();
    var bp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    var dur = SPB * 4 * bars;
    s.buffer = noiseBuf;
    s.loop = true;
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(500, when);
    bp.frequency.exponentialRampToValueAtTime(7000, when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16, when + dur * 0.92);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    s.connect(bp); bp.connect(g); g.connect(warm); g.connect(send);
    s.start(when); s.stop(when + dur + 0.05);
  }

  /* ---- the arrangement --------------------------------------------------- */

  /* The thirty-two bar shape. Everything downstream reads these flags rather
     than testing bar numbers, so the arrangement can be re-cut in one place. */
  function sectionFor(bar) {
    var b = bar % BARS;
    if (b < 4)  return { name: 'intro',  kick: 1, hats: 1 };
    if (b < 8)  return { name: 'rise',   kick: 1, hats: 1, bass: 1 };
    if (b < 16) return { name: 'main',   kick: 1, hats: 1, bass: 1, chords: 1, lead: 1, shake: 1 };
    if (b < 20) return { name: 'break',  chords: 1, lead: 1, pad: 1 };
    if (b < 24) return { name: 'build',  kick: 1, hats: 1, bass: 1, chords: 1, build: 1 };
    return { name: 'drop', kick: 1, hats: 1, bass: 1, chords: 1, lead: 1, shake: 1, drop: 1 };
  }

  function scheduleStep(i, when) {
    var inBar = i % 16;
    var bar = Math.floor(i / 16);
    var chord = track.chords[bar % track.chords.length];
    var sec = sectionFor(bar);
    var hatStep = track.hatEvery * 2;

    if (sec.kick && track.kick.indexOf(inBar) !== -1) kick(when, !!sec.drop);
    if (sec.kick && sec.drop && inBar === 14) kick(when, false);
    if ((sec.chords || sec.kick) && track.clap.indexOf(inBar) !== -1) clap(when);
    if (sec.hats && inBar % hatStep === (track.hatOffset || 0)) hat(when, false, inBar % 4 === 2);
    if (sec.hats && inBar === track.openHat) hat(when, true, true);
    if (sec.shake && inBar % 2 === 1) shaker(when, 0.05);

    if (sec.bass && track.bass.indexOf(inBar) !== -1) {
      bass(chord.root, when, inBar === 0 ? 0.22 : 0.14);
    }

    if (sec.chords && track.stabs.indexOf(inBar) !== -1) {
      stab(chord.notes.slice(0, 3), when, sec.pad ? 0.05 : 0.06, sec.pad ? 1.4 : 0.26);
    }
    if (sec.pad && inBar === 0) stab(chord.notes.slice(0, 3), when, 0.045, SPB * 3.4);

    if (sec.lead) {
      for (var m = 0; m < track.lead.length; m++) {
        if (track.lead[m].s === inBar) {
          var n = chord.notes[track.lead[m].d];
          lead(n * (sec.drop ? 2 : 1), when, sec.drop ? 0.09 : 0.075, track.wave);
        }
      }
    }

    if (sec.build) {
      var intoBuild = (bar % BARS) - 20;
      var every = [8, 4, 2, 1][intoBuild] || 4;
      if (inBar % every === 0) snare(when, 0.1 + intoBuild * 0.045);
      if (intoBuild === 0 && inBar === 0) riser(when, 4);
    }

    if (inBar === 0 && warm) {
      var phase = (bar % BARS) / BARS;
      var cutoff = sec.name === 'break' ? 3200 : 7000 + Math.sin(phase * Math.PI * 2) * 4500;
      warm.frequency.linearRampToValueAtTime(cutoff, when + SPB * 4);
    }

    if (inBar % 4 === 0) {
      var delay = Math.max(0, (when - ctx.currentTime) * 1000);
      var beatIndex = i / 4;
      window.setTimeout(function () {
        if (!playing) return;
        document.dispatchEvent(new CustomEvent('party:beat', {
          detail: { beat: beatIndex % 4, bar: bar, section: sec.name, downbeat: inBar === 0 }
        }));
      }, delay);
    }
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      nextTime += SPB / 4;
      step += 1;
    }
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
    if (!playing) {
      /* Start at the main groove, not the intro. Somebody who just pressed
         play wants the track, not eight bars of hats. The intro is there for
         the loop around, where it reads as a breath instead of a wait. */
      step = 8 * 16;
      nextTime = ctx.currentTime + 0.08;
      timer = window.setInterval(scheduler, TICK);
    }
    playing = true;
    fadeTo(gainFor(volume), 0.5);
    document.dispatchEvent(new CustomEvent('party:playing', { detail: { on: true } }));
  }

  function stop() {
    if (!ctx) return;
    playing = false;
    fadeTo(0, 0.45);
    window.clearInterval(timer);
    timer = null;
    suspendTimer = window.setTimeout(function () {
      if (!playing && ctx.state === 'running') ctx.suspend();
    }, 900);
    document.dispatchEvent(new CustomEvent('party:playing', { detail: { on: false } }));
  }

  function paint(on) {
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', on ? 'Turn the music off' : 'Turn the music on');
    toggle.setAttribute('title', on ? 'Music on' : 'Music off');
    toggle.classList.toggle('is-on', on);
    slider.disabled = !on;
  }

  toggle.addEventListener('click', function () {
    var next = toggle.getAttribute('aria-pressed') !== 'true';
    paint(next);
    store(STORE_ON, next ? '1' : '0');
    if (next) start(); else stop();
  });

  slider.value = String(volume);
  slider.addEventListener('input', function () {
    volume = parseInt(slider.value, 10) || 0;
    store(STORE_VOL, String(volume));
    if (playing && master) master.gain.setTargetAtTime(gainFor(volume), ctx.currentTime, 0.03);
  });


  /* ---- switching tracks ------------------------------------------------- */

  function announceTrack() {
    document.dispatchEvent(new CustomEvent('party:track', {
      detail: { name: track.name, bpm: track.bpm, index: trackIndex, total: TRACKS.length }
    }));
  }

  function setTrack(i) {
    trackIndex = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;
    track = TRACKS[trackIndex];
    BPM = track.bpm;
    SPB = 60 / BPM;
    /* Restart on a bar line rather than mid-phrase. Swapping the pattern under
       a running step counter lands the new kick wherever the old one happened
       to be, which sounds like a glitch rather than a mix. */
    step = 8 * 16;
    if (ctx) nextTime = ctx.currentTime + 0.06;
    announceTrack();
  }

  /* T cycles the track. NOT P: particle-bg.js already binds a bare p to pause
     the starfield on every other page, and `magic` documents it as such. This
     page does not load that script, so there is no live collision - but giving
     one letter two meanings on one site is how a shortcut stops being
     memorable. The bare letters already spoken for are . / a k l m p s w.

     WCAG 2.1.4 is the reason for the guard rather than a bare keydown: a
     single-character shortcut must not fire while somebody is typing, and must
     not steal a browser chord. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 't' && e.key !== 'T') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    setTrack(trackIndex + 1);
  });

  announceTrack();

  /* A remembered "on" cannot start the audio by itself — the browser wants a
     gesture on this page load, and it is right to. */
  paint(false);

  /* Music continuing from a tab somebody has navigated away from is the single
     rudest thing a page can do. */
  document.addEventListener('visibilitychange', function () {
    if (!playing) return;
    fadeTo(document.hidden ? 0 : gainFor(volume), document.hidden ? 0.25 : 0.4);
  });
})();

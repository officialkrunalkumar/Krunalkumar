/* ==========================================================================
   synth.js — the DJ desk on /labs/synth.
   --------------------------------------------------------------------------
   Three instruments sharing one output: a deck that plays a file from your own
   machine, a sixteen-step drum sequencer, and a playable synth. Everything is
   mixed in the Web Audio API and drawn on one oscilloscope, so a pattern you
   build and a keyboard part you play land on top of a track you loaded.

   YOUR FILE NEVER LEAVES THE BROWSER. It is read with an object URL, decoded
   by the audio element and routed through a MediaElementSource — no upload, no
   fetch, no server. That is not a privacy flourish; it is the only way this
   could work at all on a static site with nowhere to upload to.

   The drums are synthesised rather than sampled for the same reason the two
   scene pages are: a drum kit worth having is licensed twice over, and a
   waveform computed here belongs to nobody.

   One thing worth knowing about createMediaElementSource: once an <audio>
   element is routed into Web Audio it stops going to the speakers directly and
   only comes out through the graph. It also cannot be called twice on the same
   element. So the element is created once and reused for every file, and the
   context has to be running before anything is audible.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.getElementById('synth');
  if (!root) return;

  var $ = function (sel) { return root.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  /* ---- audio graph, built once on the first gesture ---------------------- */

  var ctx = null, master = null, analyser = null, deckGain = null, synthGain = null;
  var noiseBuf = null, mediaSrc = null;

  var audioEl = new Audio();
  audioEl.preload = 'metadata';
  audioEl.crossOrigin = 'anonymous';

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ensureAudio() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.9;

    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;

    deckGain = ctx.createGain();
    deckGain.gain.value = 0.8;
    synthGain = ctx.createGain();
    synthGain.gain.value = 0.9;

    deckGain.connect(comp);
    synthGain.connect(comp);
    comp.connect(master);
    master.connect(analyser);
    analyser.connect(ctx.destination);

    noiseBuf = makeNoise();
    return true;
  }

  /* ---- voices ------------------------------------------------------------ */

  function env(g, when, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  function noiseVoice(when, freq, peak, decay, band) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = band ? 'bandpass' : 'highpass';
    f.frequency.value = freq;
    if (band) f.Q.value = 1.2;
    env(g, when, peak, 0.001, decay);
    s.connect(f); f.connect(g); g.connect(synthGain);
    s.start(when); s.stop(when + decay + 0.1);
  }

  var DRUMS = {
    /* The pitch drop is the kick. A steady low sine is a hum; 165 Hz falling to
       47 in forty milliseconds is a drum. */
    kick: function (t) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(165, t);
      o.frequency.exponentialRampToValueAtTime(47, t + 0.04);
      g.gain.setValueAtTime(1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g); g.connect(synthGain);
      o.start(t); o.stop(t + 0.36);
    },
    snare: function (t) {
      noiseVoice(t, 1800, 0.36, 0.11, true);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(210, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      env(g, t, 0.22, 0.001, 0.08);
      o.connect(g); g.connect(synthGain);
      o.start(t); o.stop(t + 0.14);
    },
    /* Three bursts a few milliseconds apart. One noise hit is a snare; the
       smear of repeats is what the ear hears as hands. */
    clap: function (t) {
      for (var i = 0; i < 3; i++) noiseVoice(t + i * 0.009, 1250, 0.3 - i * 0.05, 0.06 + i * 0.02, true);
    },
    hat: function (t) { noiseVoice(t, 8400, 0.13, 0.035); },
    open: function (t) { noiseVoice(t, 6200, 0.14, 0.26); }
  };

  var ROWS = [
    { id: 'kick', label: 'Kick' },
    { id: 'snare', label: 'Snare' },
    { id: 'clap', label: 'Clap' },
    { id: 'hat', label: 'Hat' },
    { id: 'open', label: 'Open hat' }
  ];

  /* ---- the playable synth ------------------------------------------------ */

  var live = {};                       // note name -> nodes, so a held key rings once

  function noteOn(name, freq) {
    if (!ensureAudio() || live[name]) return;
    var o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = $('#syn-wave').value;
    o.frequency.value = freq;
    lp.type = 'lowpass';
    lp.frequency.value = parseFloat($('#syn-cutoff').value);
    lp.Q.value = 6;
    var now = ctx.currentTime;
    var atk = parseFloat($('#syn-attack').value);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.22, now + Math.max(0.005, atk));
    o.connect(lp); lp.connect(g); g.connect(synthGain);
    o.start(now);
    live[name] = { o: o, g: g };
    var key = $('.syn-key[data-note="' + name + '"]');
    if (key) key.classList.add('is-down');
  }

  function noteOff(name) {
    var v = live[name];
    if (!v) return;
    delete live[name];
    var now = ctx.currentTime;
    var rel = Math.max(0.03, parseFloat($('#syn-release').value));
    v.g.gain.cancelScheduledValues(now);
    v.g.gain.setValueAtTime(Math.max(0.0002, v.g.gain.value), now);
    v.g.gain.exponentialRampToValueAtTime(0.0001, now + rel);
    v.o.stop(now + rel + 0.03);
    var key = $('.syn-key[data-note="' + name + '"]');
    if (key) key.classList.remove('is-down');
  }

  /* ---- the sequencer ----------------------------------------------------- */

  var pattern = {};
  ROWS.forEach(function (r) { pattern[r.id] = new Array(16).fill(false); });
  pattern.kick[0] = pattern.kick[4] = pattern.kick[8] = pattern.kick[12] = true;
  pattern.clap[4] = pattern.clap[12] = true;
  pattern.hat[2] = pattern.hat[6] = pattern.hat[10] = pattern.hat[14] = true;

  var seqOn = false, step = 0, nextTime = 0, timer = null;
  var LOOKAHEAD = 0.1, TICK = 25;

  function bpm() { return parseInt($('#syn-bpm').value, 10) || 120; }
  function stepDur() { return (60 / bpm()) / 4; }

  function schedule() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      var s = step % 16, when = nextTime;
      ROWS.forEach(function (r) { if (pattern[r.id][s]) DRUMS[r.id](when); });
      /* The playhead is painted on a timer aligned to the audio clock rather
         than inside the scheduler, or the light would run ahead of the sound
         by the whole lookahead window. */
      (function (idx, at) {
        window.setTimeout(function () {
          if (!seqOn) return;
          $$('.syn-cell').forEach(function (c) {
            c.classList.toggle('is-playing', +c.dataset.step === idx);
          });
        }, Math.max(0, (at - ctx.currentTime) * 1000));
      })(s, when);
      nextTime += stepDur();
      step += 1;
    }
  }

  function seqStart() {
    if (!ensureAudio() || seqOn) return;
    seqOn = true;
    step = 0;
    nextTime = ctx.currentTime + 0.06;
    timer = window.setInterval(schedule, TICK);
    $('#syn-seq-play').setAttribute('aria-pressed', 'true');
    $('#syn-seq-play').textContent = '■ Stop';
    paintPlayAll();
  }

  function seqStop() {
    seqOn = false;
    window.clearInterval(timer);
    timer = null;
    $$('.syn-cell').forEach(function (c) { c.classList.remove('is-playing'); });
    $('#syn-seq-play').setAttribute('aria-pressed', 'false');
    $('#syn-seq-play').textContent = '▶ Play';
    paintPlayAll();
  }

  /* ---- building the UI --------------------------------------------------- */

  var grid = $('#syn-grid');
  ROWS.forEach(function (r) {
    var label = document.createElement('div');
    label.className = 'syn-rowname';
    label.textContent = r.label;
    grid.appendChild(label);
    for (var i = 0; i < 16; i++) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'syn-cell' + (i % 4 === 0 ? ' is-beat' : '');
      b.dataset.row = r.id;
      b.dataset.step = i;
      b.setAttribute('aria-pressed', String(pattern[r.id][i]));
      b.setAttribute('aria-label', r.label + ' step ' + (i + 1));
      if (pattern[r.id][i]) b.classList.add('is-on');
      grid.appendChild(b);
    }
  });

  grid.addEventListener('click', function (e) {
    var cell = e.target.closest('.syn-cell');
    if (!cell) return;
    var row = cell.dataset.row, i = +cell.dataset.step;
    pattern[row][i] = !pattern[row][i];
    cell.classList.toggle('is-on', pattern[row][i]);
    cell.setAttribute('aria-pressed', String(pattern[row][i]));
    if (pattern[row][i] && ensureAudio()) DRUMS[row](ctx.currentTime + 0.01);
  });

  $('#syn-seq-play').addEventListener('click', function () { seqOn ? seqStop() : seqStart(); });
  $('#syn-clear').addEventListener('click', function () {
    ROWS.forEach(function (r) { pattern[r.id].fill(false); });
    $$('.syn-cell').forEach(function (c) { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
  });
  $('#syn-bpm').addEventListener('input', function () { $('#syn-bpm-out').textContent = bpm() + ' BPM'; });

  /* pads: one-shot drums, for playing over a track rather than programming */
  $$('.syn-pad').forEach(function (pad) {
    pad.addEventListener('click', function () {
      if (!ensureAudio()) return;
      DRUMS[pad.dataset.drum](ctx.currentTime + 0.01);
      pad.classList.add('is-hit');
      window.setTimeout(function () { pad.classList.remove('is-hit'); }, 120);
    });
  });

  /* ---- keyboard ---------------------------------------------------------- */

  /* Two rows of the QWERTY layout laid out like a piano: the home row is the
     white keys and the row above holds the sharps, sitting between them the way
     they do on an instrument. */
  var KEYMAP = {
    a: 'C4', w: 'C#4', s: 'D4', e: 'D#4', d: 'E4', f: 'F4', t: 'F#4',
    g: 'G4', y: 'G#4', h: 'A4', u: 'A#4', j: 'B4', k: 'C5', o: 'C#5', l: 'D5'
  };
  var SEMITONE = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };

  function freqOf(note) {
    var m = /^([A-G]#?)(\d)$/.exec(note);
    if (!m) return 440;
    return 440 * Math.pow(2, (SEMITONE[m[1]] + (+m[2] - 4) * 12) / 12);
  }

  /* Give focus back to the document once a waveform is chosen. The guard above
     is correct to block a focused select, so the fix is to not leave it
     focused: nobody picks a waveform in order to keep typing into it. */
  $('#syn-wave').addEventListener('change', function () { this.blur(); });

  $$('.syn-key').forEach(function (key) {
    var note = key.dataset.note;
    var down = function (e) { e.preventDefault(); noteOn(note, freqOf(note)); };
    var up = function () { noteOff(note); };
    key.addEventListener('pointerdown', down);
    key.addEventListener('pointerup', up);
    key.addEventListener('pointerleave', up);
    key.addEventListener('pointercancel', up);
  });

  /* Letters must never fire notes while somebody is filling in a field — but
     "a field" has to mean somewhere a letter actually does something, not any
     form control at all.

     The first version excluded every INPUT and SELECT, which broke the
     instrument in a way that looked like a synth bug: change the waveform and
     focus stays on the <select>, so from then on every keypress was swallowed
     and the keyboard went dead. Dragging a slider did the same, because a
     range is an INPUT. Sawtooth is the default, so it only appeared once you
     touched the dropdown.

     A range, a file picker or a checkbox does nothing with a letter, so the
     keyboard stays live over them. A text field, a textarea and a select all
     do — a select uses letters for type-ahead — so those still block. */
  var TYPELESS_INPUTS = /^(range|file|checkbox|radio|button|submit|reset|color)$/;

  function typingInAField(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    var tag = (t.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !TYPELESS_INPUTS.test((t.type || 'text').toLowerCase());
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (typingInAField(e.target)) return;
    var k = e.key.toLowerCase();
    if (KEYMAP[k]) { e.preventDefault(); noteOn(KEYMAP[k], freqOf(KEYMAP[k])); return; }
    if (/^[1-5]$/.test(k) && ensureAudio()) {
      var pad = $$('.syn-pad')[+k - 1];
      if (pad) { e.preventDefault(); pad.click(); }
    }
    if (k === ' ') { e.preventDefault(); seqOn ? seqStop() : seqStart(); }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (KEYMAP[k]) noteOff(KEYMAP[k]);
  });

  /* ---- the deck ---------------------------------------------------------- */

  var objectUrl = null;

  function loadFile(file) {
    if (!file) return;
    if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)) {
      $('#syn-deck-name').textContent = 'That is not an audio file';
      return;
    }
    if (!ensureAudio()) return;
    /* Revoke the previous URL or every file loaded this session stays in
       memory until the tab closes. */
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    audioEl.src = objectUrl;
    audioEl.loop = $('#syn-loop').getAttribute('aria-pressed') === 'true';

    /* Once, and only once: a second call on the same element throws, and the
       element would stop producing sound entirely. */
    if (!mediaSrc) {
      mediaSrc = ctx.createMediaElementSource(audioEl);
      mediaSrc.connect(deckGain);
    }
    $('#syn-deck-name').textContent = file.name;
    $('#syn-deck-play').disabled = false;
    $('#syn-seek').disabled = false;
    root.classList.add('has-track');
  }

  $('#syn-file').addEventListener('change', function (e) { loadFile(e.target.files[0]); });

  var drop = $('#syn-drop');
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) loadFile(e.dataTransfer.files[0]);
  });

  $('#syn-deck-play').addEventListener('click', function () {
    if (!ensureAudio()) return;
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  });

  function fmt(t) {
    if (!isFinite(t)) return '0:00';
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  audioEl.addEventListener('play', function () { $('#syn-deck-play').textContent = '⏸ Pause'; });
  audioEl.addEventListener('pause', function () { $('#syn-deck-play').textContent = '▶ Play'; });
  audioEl.addEventListener('timeupdate', function () {
    if (audioEl.duration) {
      $('#syn-seek').value = String((audioEl.currentTime / audioEl.duration) * 100);
      $('#syn-time').textContent = fmt(audioEl.currentTime) + ' / ' + fmt(audioEl.duration);
    }
  });
  $('#syn-seek').addEventListener('input', function () {
    if (audioEl.duration) audioEl.currentTime = (parseFloat($('#syn-seek').value) / 100) * audioEl.duration;
  });
  $('#syn-loop').addEventListener('click', function () {
    var on = this.getAttribute('aria-pressed') !== 'true';
    this.setAttribute('aria-pressed', String(on));
    audioEl.loop = on;
  });

  /* ---- mixer ------------------------------------------------------------- */

  $('#syn-deck-vol').addEventListener('input', function () {
    if (deckGain) deckGain.gain.value = parseFloat(this.value);
  });
  $('#syn-synth-vol').addEventListener('input', function () {
    if (synthGain) synthGain.gain.value = parseFloat(this.value);
  });
  $('#syn-master-vol').addEventListener('input', function () {
    if (master) master.gain.value = parseFloat(this.value);
  });

  /* ---- master transport -------------------------------------------------- */

  /* One button that runs the whole desk. The mix panel had a trace and nothing
     to start, which reads as a broken readout rather than an idle one — and
     starting a track and a pattern together is the thing this page is for. */
  /* Coerced to a real boolean. Without the !!, an idle deck returns audioEl.src
     — the empty string — and aria-pressed is then set to "" rather than
     "false", which is not a valid value for the attribute and leaves assistive
     tech with no state to read. */
  function anythingPlaying() { return !!(seqOn || (audioEl.src && !audioEl.paused)); }

  function paintPlayAll() {
    var on = anythingPlaying();
    var btn = $('#syn-play-all');
    btn.textContent = on ? '\u25a0 Stop everything' : '\u25b6 Play everything';
    btn.setAttribute('aria-pressed', String(on));
  }

  $('#syn-play-all').addEventListener('click', function () {
    if (!ensureAudio()) return;
    if (anythingPlaying()) {
      seqStop();
      if (!audioEl.paused) audioEl.pause();
    } else {
      seqStart();
      if (audioEl.src) audioEl.play();
    }
    paintPlayAll();
  });

  audioEl.addEventListener('play', paintPlayAll);
  audioEl.addEventListener('pause', paintPlayAll);

  /* ---- oscilloscope ------------------------------------------------------ */

  var canvas = $('#syn-scope');
  var c2d = canvas.getContext('2d');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The loop starts on page load rather than with the audio, and draws a flat
     centre line until there is something to show. A blank canvas looks broken;
     a flat trace looks like silence, which is what it is. */
  function drawScope() {
    var buf = null;
    (function frame() {
      if (!reduced) window.requestAnimationFrame(frame);
      var w = canvas.width = canvas.clientWidth;
      var h = canvas.height = canvas.clientHeight;
      if (!w || !h) return;
      c2d.clearRect(0, 0, w, h);
      c2d.lineWidth = 2;
      c2d.strokeStyle = (getComputedStyle(canvas).getPropertyValue('--scope') || '#7dd3fc').trim();
      c2d.beginPath();
      if (analyser) {
        if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        for (var i = 0; i < buf.length; i++) {
          var x = (i / buf.length) * w;
          var y = ((buf[i] - 128) / 128) * (h / 2) + h / 2;
          i ? c2d.lineTo(x, y) : c2d.moveTo(x, y);
        }
      } else {
        c2d.moveTo(0, h / 2);
        c2d.lineTo(w, h / 2);
      }
      c2d.stroke();
    })();
  }

  drawScope();

  /* Nothing keeps making noise in a tab nobody is looking at. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (seqOn) seqStop();
      if (!audioEl.paused) audioEl.pause();
    }
  });

  window.addEventListener('pagehide', function () {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (ctx) { try { ctx.close(); } catch (e) {} }
  });
})();

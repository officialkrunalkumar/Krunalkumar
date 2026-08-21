/* ==========================================================================
   party.js — the room on /party: light dots, confetti, the beat, fullscreen.
   --------------------------------------------------------------------------
   Everything that moves in time lives here; everything that makes a sound
   lives in party-sound.js. The two talk through two DOM events, `party:beat`
   and `party:playing`, so either can be worked on without opening the other.

   The important behaviour is that the room never freezes. The sound cannot
   start without a user gesture, and most visitors will never press the button,
   so a page whose lighting only moved on `party:beat` would be a still image
   for almost everybody. Instead this file runs its own clock at the same
   tempo, and stands down the moment the real beats arrive.
   ========================================================================== */

(function () {
  'use strict';

  var scene = document.querySelector('.p-scene');
  if (!scene) return;

  /* The tempo is not a constant any more: party-sound.js carries four tracks
     at four different tempos and announces the current one with `party:track`.
     Everything timed in this file, and every dance animation in the CSS, is
     derived from this single value so the room can never drift from the
     record it is dancing to. */
  var BEAT_MS = 60000 / 124;
  var FLASH_MS = 110;

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- scenery ---------------------------------------------------------- */

  /* The dots a mirror ball throws. Built here rather than written into the
     markup because they are decoration with no meaning — twenty-two identical
     empty divs in the HTML would be twenty-two things for a crawler and a
     screen reader to wade through for no gain. The container is aria-hidden. */
  /* The dots are tinted, not white. Every one of them is a lamp reflected off
     a mirror tile, so they carry the colour of the lamp that made them — a
     field of white dots under five coloured beams looked like dust. */
  var GLINT = [
    'rgba(255, 61, 154, 0.75)', 'rgba(34, 211, 238, 0.75)', 'rgba(251, 191, 36, 0.7)',
    'rgba(168, 85, 247, 0.75)', 'rgba(74, 222, 128, 0.65)', 'rgba(255, 255, 255, 0.6)'
  ];

  function buildGlints() {
    var wrap = document.querySelector('.p-glints');
    if (!wrap || reduced) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 26; i++) {
      var d = document.createElement('span');
      var c = GLINT[i % GLINT.length];
      d.className = 'p-glint';
      d.style.top = (8 + Math.random() * 62) + '%';
      d.style.left = (Math.random() * 100) + '%';
      d.style.background = c;
      d.style.boxShadow = '0 0 8px ' + c;
      d.style.animationDuration = (9 + Math.random() * 9).toFixed(2) + 's';
      d.style.animationDelay = (-Math.random() * 14).toFixed(2) + 's';
      frag.appendChild(d);
    }
    wrap.appendChild(frag);
  }

  var CONFETTI = ['#ff3d9a', '#22d3ee', '#fbbf24', '#a855f7', '#4ade80'];

  function buildConfetti() {
    var wrap = document.querySelector('.p-confetti');
    if (!wrap || reduced) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 26; i++) {
      var b = document.createElement('span');
      b.className = 'p-bit';
      b.style.left = (Math.random() * 100) + '%';
      b.style.background = CONFETTI[i % CONFETTI.length];
      b.style.animationDuration = (5.5 + Math.random() * 6).toFixed(2) + 's';
      b.style.animationDelay = (-Math.random() * 11).toFixed(2) + 's';
      b.style.opacity = (0.55 + Math.random() * 0.4).toFixed(2);
      frag.appendChild(b);
    }
    wrap.appendChild(frag);
  }

  buildGlints();
  buildConfetti();

  /* ---- the beat --------------------------------------------------------- */

  var flashTimer = null;

  function pulse() {
    scene.classList.add('is-beat');
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(function () {
      scene.classList.remove('is-beat');
    }, FLASH_MS);
  }

  /* The fallback clock. setInterval drifts, which does not matter at all while
     it is the only clock in the room — nothing is listening for phase. The
     moment real beats arrive it is switched off, so the drift never gets the
     chance to fight the audio. */
  var fallback = null;

  function startFallback() {
    if (fallback || reduced) return;
    fallback = window.setInterval(pulse, BEAT_MS);
  }

  function stopFallback() {
    window.clearInterval(fallback);
    fallback = null;
  }

  document.addEventListener('party:beat', function () {
    stopFallback();
    pulse();
  });

  /* A new track means a new tempo. The CSS reads --beat for every dance
     duration, so setting it here re-times the whole crowd in one assignment. */
  var toast = document.querySelector('.p-toast');
  var announce = document.querySelector('.p-announce');
  var toastTimer = null;
  var firstTrack = true;

  document.addEventListener('party:track', function (ev) {
    var d = ev.detail || {};
    if (d.bpm) {
      BEAT_MS = 60000 / d.bpm;
      scene.style.setProperty('--beat', BEAT_MS.toFixed(2) + 'ms');
      if (fallback) { stopFallback(); startFallback(); }
    }
    /* Say nothing on page load — the first announcement would read out a
       track nobody has chosen yet, and a toast on arrival is just noise. */
    if (firstTrack) { firstTrack = false; return; }

    if (toast) {
      toast.textContent = d.name + ' \u00b7 ' + d.bpm + ' BPM';
      toast.classList.add('is-shown');
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () { toast.classList.remove('is-shown'); }, 2400);
    }
    /* The toast is aria-hidden decoration; this is the accessible half. A
       keyboard user pressing P has to be told what happened. */
    if (announce) announce.textContent = 'Track ' + (d.index + 1) + ' of ' + d.total + ': ' + d.name + ', ' + d.bpm + ' BPM';
  });

  document.addEventListener('party:playing', function (ev) {
    var on = ev.detail && ev.detail.on;
    scene.classList.toggle('is-playing', !!on);

    if (on) {
      /* Restart every figure's animation so the crowd lands on the same phase
         the music just started on. Without this the dancers keep whatever
         phase they drifted into while the page sat idle, and a room full of
         people bouncing slightly off the kick looks worse than one not
         bouncing at all. Reading offsetWidth is the reflow that makes the
         restart take effect. */
      var dancers = scene.querySelectorAll('.p-dancer');
      Array.prototype.forEach.call(dancers, function (d) {
        d.style.animation = 'none';
        void d.offsetWidth;
        d.style.animation = '';
      });
    } else {
      startFallback();
    }
  });

  /* Nothing is pulsing in a tab nobody is looking at. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopFallback();
    else if (!scene.classList.contains('is-playing')) startFallback();
  });

  startFallback();

  /* ---- idle controls ---------------------------------------------------- */

  /* The buddha page fades its controls out when nothing has happened; this is
     the same behaviour so the pair match. Kept in JS rather than done with
     :hover because a touch screen has no hover — a CSS-only version would
     leave the controls permanently visible on a phone, which is exactly where
     an unobstructed view matters most.

     The listeners are passive: none of them call preventDefault, and marking
     them so tells the browser it never has to wait on this handler before
     scrolling. */
  var IDLE_MS = 2800;
  var idleTimer = null;

  function wake() {
    scene.classList.remove('is-idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(function () {
      /* Never hide a control that currently has focus — the user is on it. */
      if (scene.contains(document.activeElement) &&
          document.activeElement !== document.body) return;
      scene.classList.add('is-idle');
    }, IDLE_MS);
  }

  ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'wheel'].forEach(function (evt) {
    document.addEventListener(evt, wake, { passive: true });
  });
  scene.addEventListener('focusin', wake);
  wake();

  /* ---- fullscreen ------------------------------------------------------- */

  /* Only the stage goes fullscreen, so the header and the copy underneath are
     left behind rather than stretched. The button reflects the real state via
     fullscreenchange, because Escape and the browser's own control can end it
     without ever touching this button. */
  var fsBtn = document.querySelector('.p-fs');

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  if (fsBtn) {
    var request = scene.requestFullscreen || scene.webkitRequestFullscreen;
    if (!request) {
      fsBtn.hidden = true;            // iPhone Safari has no element fullscreen
    } else {
      fsBtn.addEventListener('click', function () {
        if (fsElement()) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          var p = request.call(scene);
          if (p && p.catch) p.catch(function () { /* denied; leave the button as it was */ });
        }
      });

      document.addEventListener('fullscreenchange', paintFs);
      document.addEventListener('webkitfullscreenchange', paintFs);
    }
  }

  function paintFs() {
    var on = !!fsElement();
    if (!fsBtn) return;
    fsBtn.setAttribute('aria-label', on ? 'Leave fullscreen' : 'Fill the screen');
    fsBtn.setAttribute('title', on ? 'Leave fullscreen' : 'Fill the screen');
  }
})();

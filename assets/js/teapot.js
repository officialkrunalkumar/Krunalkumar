// Teapot page logic: report the discovery, and run the tap-to-pour show.
// External file rather than an inline block so the page stays CSP-clean like
// the rest of the site (script-src 'self' — no inline scripts anywhere).
(function () {
  if (typeof window.gtag === 'function') window.gtag('event', 'easter_egg_teapot');

  var scene = document.getElementById('scene');
  var teapot = document.getElementById('teapot');
  var hint = document.getElementById('pour-hint');
  if (!scene || !teapot) return;

  // The static markup ships the teapot as a plain picture; only here, where
  // the handlers exist, does it become a button (no-JS visitors must never
  // meet a focusable control that does nothing).
  teapot.setAttribute('role', 'button');
  teapot.setAttribute('tabindex', '0');
  teapot.setAttribute('aria-label', 'Tap the teapot to pour tea');

  var pouring = false;
  var everPoured = false;

  function pour() {
    // One show at a time — a tap mid-pour would restart the CSS animations
    // with a visible jump.
    if (pouring) return;
    pouring = true;
    if (!everPoured) {
      everPoured = true;
      if (hint) hint.classList.add('gone');
      if (typeof window.gtag === 'function') window.gtag('event', 'easter_egg_teapot_pour');
    }
    scene.classList.add('pouring');
    setTimeout(function () {
      scene.classList.remove('pouring');
      pouring = false;
    }, 1950);
  }

  teapot.addEventListener('click', pour);
  teapot.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pour();
    }
  });
})();

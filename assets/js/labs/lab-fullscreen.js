/* ==========================================================================
   lab-fullscreen.js — one fullscreen button that works on every lab.
   --------------------------------------------------------------------------
   The fullscreen control is rendered on 34 pages but was, for a long time,
   only wired up on four of them (the language playgrounds and the three OS
   terminals, each of which had its own copy of this logic). On the twenty
   security, network and forensics tools the button did nothing — it was there,
   it looked clickable, and pressing it was silence. This is that logic, once,
   for everyone.

   It uses the real Fullscreen API rather than a CSS fake, so the browser
   handles Esc itself and nothing here can trap a visitor in fullscreen. It
   finds its own target — the nearest enclosing .lab — so a page only has to
   include this script and render a #lab-fullscreen button; no per-page wiring.

   The language and terminal apps keep their own copies, because those need to
   re-focus the editor or re-measure the emulator after the resize. This file
   deliberately does nothing if one of those has already claimed the button.
   ========================================================================== */

(function () {
  'use strict';

  var btn = document.getElementById('lab-fullscreen');
  if (!btn || btn.getAttribute('data-fs-wired') === '1') return;

  // The element we make fullscreen is the lab container the button sits in.
  var target = btn.closest ? btn.closest('.lab') : null;
  if (!target) {
    // Fallback for very old engines without Element.closest: walk up manually.
    var n = btn.parentNode;
    while (n && n.nodeType === 1) {
      if (n.className && (' ' + n.className + ' ').indexOf(' lab ') !== -1) { target = n; break; }
      n = n.parentNode;
    }
  }
  if (!target) return;

  var request = target.requestFullscreen || target.webkitRequestFullscreen ||
                target.msRequestFullscreen;
  var exit = document.exitFullscreen || document.webkitExitFullscreen ||
             document.msExitFullscreen;
  if (!request) { btn.hidden = true; return; }

  btn.setAttribute('data-fs-wired', '1');

  function current() {
    return document.fullscreenElement || document.webkitFullscreenElement ||
           document.msFullscreenElement || null;
  }

  btn.addEventListener('click', function () {
    if (current()) {
      exit && exit.call(document);
    } else {
      // Some engines return a promise that rejects if the gesture is stale;
      // swallow it so a denied request does not surface as an error.
      var p = request.call(target);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  });

  function sync() {
    var on = current() === target;
    target.classList.toggle('is-fullscreen', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen (Esc to exit)';

    /* Entering fullscreen changes the CSS size of any canvas inside, but a
       canvas does not re-render itself: its backing buffer keeps the old
       pixel dimensions and the browser simply stretches it, which looks soft
       and wrong. The modules already refit on resize, so telling them the
       layout changed is enough. Deferred by a frame because the class has
       only just been applied and the new geometry is not final until the
       browser has laid it out. */
    setTimeout(function () {
      try { window.dispatchEvent(new Event('resize')); }
      catch (e) {
        // Older engines need the legacy construction path.
        var ev = document.createEvent('Event');
        ev.initEvent('resize', true, false);
        window.dispatchEvent(ev);
      }
    }, 60);
  }
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  document.addEventListener('MSFullscreenChange', sync);
})();

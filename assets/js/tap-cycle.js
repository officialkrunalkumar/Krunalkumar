/* ==========================================================================
   tap-cycle.js — double-tap anywhere, on a touchscreen, to advance.
   --------------------------------------------------------------------------
   /party and /buddha cycle their music with the T key. /einstein pulls up
   another quote the same way its button does. On a phone none of that is
   reachable: there is no keyboard, and the controls on those pages withdraw
   when the scene is idle — which is the whole point of the scenes, and also
   why a phone visitor could end up with no way to change anything at all.

   So on a coarse pointer, a double tap on the background does what T does.

   FOUR RULES, EACH FIXING SOMETHING THAT WOULD OTHERWISE GO WRONG:

   1. COARSE POINTERS ONLY. A mouse already has the keyboard and the visible
      controls, and double-clicking a page to make it change is surprising
      when nothing invited it.

   2. NEVER ON A REAL CONTROL. A tap that lands on a button, a link, a slider
      or a text field belongs to that control. Double-tapping the volume
      slider must adjust volume twice, not change the track.

   3. THE TWO TAPS MUST BE IN ROUGHLY THE SAME PLACE. Without a distance
      check, two unrelated taps at opposite corners inside the window count
      as a double tap, and the track changes while somebody is doing
      something else entirely.

   4. IT MUST NOT FIGHT DOUBLE-TAP-TO-ZOOM. These pages already set
      touch-action on their scene, so the browser is not waiting on a
      zoom gesture — but the handler is on pointerup rather than dblclick
      because dblclick on mobile Safari arrives late, after a 300 ms delay
      that makes the whole thing feel broken.

   A one-off toast the first time tells the visitor the gesture exists, since
   an invisible gesture is not a feature.
   ========================================================================== */

(function (root) {
  'use strict';

  var WINDOW_MS = 380;      // two taps must land within this
  var SLOP_PX = 44;         // and within this distance of each other

  function isInteractive(node) {
    while (node && node.nodeType === 1) {
      var tag = node.tagName;
      if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(tag)) return true;
      if (node.getAttribute && node.getAttribute('role') === 'button') return true;
      if (node.isContentEditable) return true;
      node = node.parentNode;
    }
    return false;
  }

  var TapCycle = {
    /* fn is called on a double tap. opts.hint is a one-line message shown
       once, the first time the page is opened on a touchscreen. */
    on: function (fn, opts) {
      opts = opts || {};

      /* Nothing is bound at all on a device with a real pointer, so a mouse
         user cannot trip this by double-clicking the background. */
      if (!root.matchMedia || !root.matchMedia('(pointer: coarse)').matches) return;

      var lastT = 0;
      var lastX = 0;
      var lastY = 0;

      document.addEventListener('pointerup', function (e) {
        if (e.pointerType === 'mouse') return;
        if (isInteractive(e.target)) { lastT = 0; return; }

        var now = Date.now();
        var dx = e.clientX - lastX;
        var dy = e.clientY - lastY;
        var near = (dx * dx + dy * dy) < (SLOP_PX * SLOP_PX);

        if (now - lastT < WINDOW_MS && near) {
          lastT = 0;                       // consume, so a triple tap is not two
          try { fn(); } catch (err) {}
          return;
        }
        lastT = now;
        lastX = e.clientX;
        lastY = e.clientY;
      }, { passive: true });

      /* Tell them once. Stored per page key, so learning it on /party does
         not silently hide it on /buddha. */
      if (opts.hint && opts.key) {
        var seen;
        try { seen = localStorage.getItem('taphint.' + opts.key); } catch (err) { seen = '1'; }
        if (!seen) {
          var note = document.createElement('p');
          note.className = 'tap-hint';
          note.setAttribute('role', 'status');
          note.textContent = opts.hint;
          document.body.appendChild(note);
          root.setTimeout(function () { note.classList.add('is-shown'); }, 900);
          root.setTimeout(function () {
            note.classList.remove('is-shown');
            root.setTimeout(function () { if (note.parentNode) note.parentNode.removeChild(note); }, 700);
          }, 6500);
          try { localStorage.setItem('taphint.' + opts.key, '1'); } catch (err) {}
        }
      }
    }
  };

  root.TapCycle = TapCycle;
})(typeof self !== 'undefined' ? self : this);

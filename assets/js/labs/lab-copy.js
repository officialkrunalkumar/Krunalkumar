/* ==========================================================================
   lab-copy.js — adds a Copy button to every example block on the Labs pages.
   --------------------------------------------------------------------------
   The examples exist to be used: pasted into the playground above, into the
   Linux terminal, or into a real editor on the reader's own machine. Asking
   them to select a multi-line snippet by hand on a phone is the fastest way
   to make sure nobody bothers.

   Progressive enhancement — the button is created here rather than sitting in
   the HTML, so a reader without JavaScript sees a clean code block instead of
   a button that does nothing. Clipboard writes need a user gesture, which a
   click is, and fall back to the old execCommand path on older Safari.
   ========================================================================== */

(function () {
  'use strict';

  var blocks = document.querySelectorAll('pre.lab-example');
  if (!blocks.length || !document.body) return;

  function legacyCopy(text) {
    // execCommand('copy') needs a real, selectable node in the document.
    var scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.top = '-1000px';
    document.body.appendChild(scratch);
    scratch.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    document.body.removeChild(scratch);
    return ok;
  }

  function flash(btn, text, cls) {
    btn.textContent = text;
    btn.className = 'lab-copy' + (cls ? ' ' + cls : '');
    setTimeout(function () {
      btn.textContent = 'Copy';
      btn.className = 'lab-copy';
    }, 1600);
  }

  Array.prototype.forEach.call(blocks, function (pre) {
    var code = pre.querySelector('code') || pre;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lab-copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy this example to the clipboard');

    function fallback(text) {
      var ok = legacyCopy(text);   // called exactly once — it mutates the DOM
      flash(btn, ok ? 'Copied' : 'Press Ctrl+C', ok ? 'is-ok' : 'is-err');
    }

    btn.addEventListener('click', function () {
      var text = code.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () { flash(btn, 'Copied', 'is-ok'); })
          .catch(function () { fallback(text); });
      } else {
        fallback(text);
      }
    });

    // The button is absolutely positioned against the <pre>, which needs a
    // positioning context it does not have by default.
    pre.classList.add('has-copy');
    pre.appendChild(btn);
  });
})();

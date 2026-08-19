/* ==========================================================================
   theme.js — the light/dark toggle.
   --------------------------------------------------------------------------
   Light is opt-in, deliberately. An earlier version followed the operating
   system, which meant anyone with a light desktop got a light site without
   asking — and since the site was built dark and its light palette is younger,
   that was a worse experience than either theme on its own. Nobody sees light
   here unless they press the button.

   boot.js reads the stored choice and writes the attribute to <html> before
   first paint, so a returning visitor never sees a flash of the other theme.
   This file only handles the press and keeps the label in step. The two live
   in different files on purpose: restoring has to be synchronous and early,
   and this script is deferred.

   The header is replaced at runtime by include-partials.js, which destroys
   whatever was in it at parse time — so the listener is delegated from
   document rather than bound to the button.
   ========================================================================== */

(function () {
  'use strict';

  // Deliberately NOT under the 'lab.' prefix. The labs namespace their own
  // storage that way, and lab-app.js's "clear saved code and settings" button
  // sweeps every lab.* key — which would have taken the theme with it.
  var KEY = 'site.theme';

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function apply(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);

    // Only a real press writes to storage. The two calls at the bottom of this
    // file re-run apply() on load to sync the address-bar colour and the
    // button's label — if those persisted too, every page load would write back
    // whatever the page happened to start as. Combined with nothing ever
    // reading the key, that is how a choice of light survived exactly until the
    // next click on a link.
    if (persist) {
      // Both, on purpose. localStorage carries the choice to future visits;
      // sessionStorage keeps this tab's choice working even where localStorage
      // is blocked or gets cleared, so the theme cannot silently reset
      // mid-session.
      try { localStorage.setItem(KEY, theme); } catch (e) {}
      try { sessionStorage.setItem(KEY, theme); } catch (e) {}
    }

    // The address-bar colour on mobile should follow the page, or the two
    // disagree and it looks like a rendering bug.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f5f8fc' : '#121b2c');

    var btn = document.getElementById('theme-toggle');
    if (btn) {
      var next = theme === 'light' ? 'dark' : 'light';
      btn.setAttribute('aria-label', 'Switch to ' + next + ' theme');
      btn.setAttribute('title', 'Switch to ' + next + ' theme');
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('#theme-toggle');
    if (!btn) return;
    var next = current() === 'light' ? 'dark' : 'light';
    apply(next, true);
    // Only the press is reported, never the theme a page happens to load in —
    // otherwise every page view of a light-theme visitor would count as a
    // change and the numbers would say nothing.
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'theme_change', { theme: next });
    }
  });

  // Reassert once the shared header has landed, so the label is right. Neither
  // of these is a choice, so neither persists.
  window.setTimeout(function () { apply(current(), false); }, 400);
  apply(current(), false);
}());

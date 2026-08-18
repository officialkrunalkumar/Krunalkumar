/* ==========================================================================
   lab-feedback.js — personalises the single Labs feedback form.
   --------------------------------------------------------------------------
   The form lives in exactly one place (the Labs hub). Every other lab page
   links to it with ?from=<slug>, so a report still says which playground it
   came from without nine near-identical copies of the same form diluting the
   unique content on each page.

   All this does is rewrite the WhatsApp message template with the originating
   lab before wa-form.js reads it, and scroll the form into view when someone
   arrives via the link. wa-form.js does the rest.
   ========================================================================== */

(function () {
  'use strict';

  var LABS = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    c: 'C',
    cpp: 'C++',
    sql: 'SQL',
    lua: 'Lua',
    linux: 'Linux terminal',
    dos: 'DOS prompt',
    hub: 'Labs hub'
  };

  var form = document.getElementById('lab-feedback-form');
  if (!form) return;

  var from = '';
  try {
    from = new URLSearchParams(window.location.search).get('from') || '';
  } catch (err) { from = ''; }

  var name = Object.prototype.hasOwnProperty.call(LABS, from) ? LABS[from] : '';

  if (name) {
    // Must happen before wa-form.js auto-initialises, which it does on
    // DOMContentLoaded — this file is loaded first for that reason.
    var template = form.getAttribute('data-wa-message-template') || '';
    form.setAttribute('data-wa-message-template',
      template.replace('Lab: Labs hub', 'Lab: ' + name));

    var note = document.getElementById('lab-feedback-context');
    if (note) {
      note.textContent = 'Reporting from the ' + name + ' playground.';
      note.hidden = false;
    }
  }

  // Arriving from another lab page means the visitor came here to report
  // something; put them at the form rather than the top of the hub.
  if (from && window.location.hash === '#lab-feedback') {
    var jump = function () {
      var target = document.getElementById('lab-feedback');
      if (!target) return;
      // The header and footer are injected by include-partials.js after this
      // runs, which shifts everything below them — so re-apply once that has
      // landed, exactly as include-partials does for its own deep links.
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      var first = form.querySelector('input, textarea');
      if (first) first.focus({ preventScroll: true });
    };

    // This script is deferred, so `load` may already have fired by the time it
    // runs; waiting for an event that has passed would silently do nothing.
    if (document.readyState === 'complete') jump();
    else window.addEventListener('load', jump, { once: true });
    document.addEventListener('partials:loaded', jump, { once: true });
  }
})();

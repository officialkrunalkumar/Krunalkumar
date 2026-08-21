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

/* global LAB_RUNTIMES */
(function () {
  'use strict';

  /* 56 lab pages link here with ?from=<slug>. A hand-written lookup listed
     nine of them, so every report from php, ruby, perl, postgres and all
     seventeen security tools arrived labelled "Lab: Labs hub" — the one field
     that says which page broke, wrong on 47 pages out of 56.

     So: the registry names the language playgrounds, a short table names the
     ones no slug can spell, and everything else is derived from the slug. */

  var LABS = {};

  // The eleven language playgrounds are LAB_RUNTIMES' business, not this
  // file's. Only some lab pages load the registry, hence the typeof guard.
  if (typeof LAB_RUNTIMES === 'object' && LAB_RUNTIMES) {
    for (var id in LAB_RUNTIMES) {
      if (!Object.prototype.hasOwnProperty.call(LAB_RUNTIMES, id)) continue;
      var meta = LAB_RUNTIMES[id];
      if (meta && meta.name) LABS[meta.slug || id] = meta.name;
    }
  }

  /* Names the slug cannot produce on its own. The language entries repeat the
     registry deliberately: the hub does not load lab-runtimes.js, so without
     them "cpp" would render as "Cpp" on the page where this actually runs. */
  var FIXED = {
    hub: 'Labs hub',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    c: 'C',
    cpp: 'C++',
    sql: 'SQL',
    lua: 'Lua',
    php: 'PHP',
    ruby: 'Ruby',
    perl: 'Perl',
    postgres: 'PostgreSQL',
    linux: 'Linux terminal',
    dos: 'DOS prompt',
    bsd: 'BSD shell',
    hacklab: 'HackLab',
    'sqlite-browser': 'SQLite browser'
  };
  for (var key in FIXED) {
    if (Object.prototype.hasOwnProperty.call(FIXED, key) && !LABS[key]) {
      LABS[key] = FIXED[key];
    }
  }

  /* Slug words that are acronyms. Without this the tools read "Ct log",
     "Cvss" and "Url inspector", which looks like a typo rather than a name.

     A padded string rather than an object, because an object is looked up
     through Object.prototype: ?from=constructor found a truthy value there
     and came out as "CONSTRUCTOR". */
  var ACRONYMS = ' api cpu ct cvss dns exif har http ip jwt os pcap qr rdap' +
                 ' sql tcp tls url ';

  /* The whitelist is the security control here, not a tidiness check. This
     name is pasted into the visitor's WhatsApp draft, so an unguarded
     fallback would let ?from=<anything> write arbitrary attacker-chosen text
     into a message the visitor is about to send under their own name.
     [a-z0-9-] with a 32-char cap admits every real slug and nothing else. */
  var SLUG_RE = /^[a-z0-9-]{1,32}$/;

  function displayName(slug) {
    if (Object.prototype.hasOwnProperty.call(LABS, slug)) return LABS[slug];
    if (!SLUG_RE.test(slug)) return '';
    return slug.split('-').map(function (word, i) {
      if (word && ACRONYMS.indexOf(' ' + word + ' ') !== -1) return word.toUpperCase();
      // Sentence case, not title case: "Email headers", not "Email Headers".
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    }).join(' ');
  }

  var form = document.getElementById('lab-feedback-form');
  if (!form) return;

  var from = '';
  try {
    from = new URLSearchParams(window.location.search).get('from') || '';
  } catch (err) { from = ''; }

  var name = displayName(from);

  if (name) {
    // Must happen before wa-form.js auto-initialises, which it does on
    // DOMContentLoaded — this file is loaded first for that reason.
    var template = form.getAttribute('data-wa-message-template') || '';

    /* Take the origin from the line already in the form rather than repeating
       it here, so the two cannot drift apart if the domain ever changes. */
    var found = /^Lab: .*\((https?:\/\/[^)\/]+)\/labs\)\s*$/m.exec(template);
    var origin = found ? found[1] : 'https://krunalkumar.dpdns.org';
    var url = from === 'hub' ? origin + '/labs' : origin + '/labs/' + from;

    /* Replace the whole line, not just the name. Patching "Labs hub" alone
       left the hub's URL in place, so a report about /labs/ct-log still
       pointed the reader at /labs — the wrong page, stated confidently. */
    var line = 'Lab: ' + name + ' (' + url + ')';
    form.setAttribute('data-wa-message-template',
      template.replace(/^Lab: .*$/m, function () { return line; }));

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

// Glossary controls: category chips, a live text filter, and the A–Z bar that
// dims letters holding nothing. All three share one visibility pass, so they
// can never disagree about what is on screen.
//
// Every term is in the static markup. Without JS the controls never appear and
// the full A–Z list is simply there — which is also what a crawler sees.
(function () {
  var root = document.querySelector('.glossary-body');
  if (!root) return;

  var items = Array.prototype.slice.call(root.querySelectorAll('.glossary-item'));
  var groups = Array.prototype.slice.call(root.querySelectorAll('.glossary-group'));
  var azLinks = Array.prototype.slice.call(document.querySelectorAll('.glossary-az-link'));
  var controls = document.querySelector('.glossary-controls');
  var search = document.getElementById('glossary-search');
  var counter = document.querySelector('.glossary-count');
  var empty = document.querySelector('.glossary-empty');
  if (!controls) return;

  var chips = Array.prototype.slice.call(controls.querySelectorAll('.glossary-filter'));
  var activeCat = 'all';

  // Cache each term's searchable text once. Reading textContent inside the
  // keystroke handler re-walked 144 subtrees per character typed.
  var haystack = items.map(function (el) {
    var term = el.querySelector('.glossary-term');
    var def = el.querySelector('.glossary-def p');
    return ((term ? term.textContent : '') + ' ' + (def ? def.textContent : '')).toLowerCase();
  });

  // Filtering is display-based and therefore silent to screen readers; this
  // polite region says how many terms survived. Same approach as blog-index.js.
  var announcer = document.createElement('p');
  announcer.className = 'sr-only';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  controls.appendChild(announcer);

  function apply() {
    var q = search ? search.value.trim().toLowerCase() : '';
    var shown = 0;

    items.forEach(function (el, i) {
      var okCat = activeCat === 'all' || el.getAttribute('data-cat') === activeCat;
      var okText = !q || haystack[i].indexOf(q) !== -1;
      var visible = okCat && okText;
      el.classList.toggle('is-hidden', !visible);
      if (visible) shown++;
    });

    // A letter heading with nothing under it is noise, and so is a jump link
    // that scrolls to an empty band.
    var live = {};
    groups.forEach(function (g) {
      var any = g.querySelector('.glossary-item:not(.is-hidden)') !== null;
      g.classList.toggle('is-hidden', !any);
      live[g.id] = any;
    });
    azLinks.forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href) return; // the permanently empty letters stay as they are
      a.classList.toggle('is-empty', live[href.slice(1)] !== true);
    });

    if (empty) empty.hidden = shown !== 0;
    if (counter) {
      counter.textContent =
        shown === items.length
          ? items.length + ' terms'
          : shown + ' of ' + items.length + ' terms';
    }
    announcer.textContent = shown === 0 ? 'No terms match' : shown + ' terms shown';
    return shown;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      activeCat = chip.getAttribute('data-filter') || 'all';
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      // Deep-linkable like the blog's chips: /glossary#security. Replace rather
      // than push so the back button leaves the page instead of walking back
      // through every chip the reader tried.
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', activeCat === 'all' ? location.pathname : '#' + activeCat);
      }
      apply();
    });
  });

  if (search) {
    var timer = null;
    search.addEventListener('input', function () {
      var shown = apply();
      // Mirrors site-search.js exactly: debounced, and it reports the result
      // COUNT only. The query itself is never sent anywhere, which is what
      // llms-full.txt promises about search on this site.
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        if (search.value.trim() && typeof window.gtag === 'function') {
          window.gtag('event', 'glossary_search', { results: shown });
        }
      }, 900);
    });
  }

  // A category in the hash preselects its chip. Anything else — #term-xyz from
  // a cross-reference, #letter-d from the A–Z bar — is left for the browser to
  // scroll to, so those must not be mistaken for a filter.
  var hash = (location.hash || '').slice(1);
  if (hash && hash.indexOf('term-') !== 0 && hash.indexOf('letter-') !== 0) {
    var match = chips.filter(function (c) { return c.getAttribute('data-filter') === hash; })[0];
    if (match) match.click();
  }

  controls.removeAttribute('style');
  apply();
})();

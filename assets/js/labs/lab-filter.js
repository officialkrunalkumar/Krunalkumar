/* ==========================================================================
   lab-filter.js — type-to-filter for the Labs hub.
   --------------------------------------------------------------------------
   The hub grew past sixty cards, which is the point where scrolling stops
   being browsing and becomes searching — badly, by eye. This filters the
   cards live as you type: a card stays if its visible text contains what
   you typed, a section folds away when none of its cards survive, and the
   in-between prose (HackLab feature aside — see below) gets out of the way
   until the filter is cleared.

   Deliberate limits, so nobody mistakes this for more than it is:
     - It matches each card's textContent and nothing else. No fuzziness,
       no synonyms, no ranking. "pyton" finds nothing, and the empty state
       says so honestly and points at the real site search instead.
     - It filters THIS page only. The site-wide search stays on "/", and the
       two must not fight: site-search.js already ignores "/" pressed while
       an INPUT has focus, so typing a slash in this box just types a slash.
     - No state in the URL. A filter is a moment, not a place to link to.
   ========================================================================== */

(function () {
  'use strict';

  var input = document.getElementById('lab-filter-input');
  if (!input) return; // any page that is not the hub

  var clearBtn = document.getElementById('lab-filter-clear');
  var countEl = document.getElementById('lab-filter-count');
  var emptyEl = document.getElementById('lab-filter-empty');
  var emptyClear = document.getElementById('lab-filter-empty-clear');

  // display:none lives in labs.css; the hidden attribute loses to any
  // display value an existing rule sets (.lab-card is display:flex).
  var HIDE = 'lab-filter-hide';

  /* ------------------------------------------------------------------------
     Index the page once. The text of every card is read a single time at
     startup and lowercased with its whitespace collapsed, so each keystroke
     is sixty indexOf calls over short strings rather than sixty DOM reads.
     ------------------------------------------------------------------------ */

  function textOf(el) {
    return (el.textContent || '').toLowerCase().replace(/\s+/g, ' ');
  }

  var cards = [];
  var cardNodes = document.querySelectorAll('main .lab-card');
  for (var i = 0; i < cardNodes.length; i++) {
    cards.push({ el: cardNodes[i], text: textOf(cardNodes[i]) });
  }

  /* Sections come in three kinds, and each is treated differently:

       grid     — has a .lab-grid of cards. Hidden when the filter leaves
                  none of its cards standing, because a heading with an
                  empty grid under it reads like a bug.
       feature  — a card-less lab presented as prose (HackLab). It IS a lab,
                  so it participates in matching like a card would; without
                  this, typing "hacklab" on the hub would claim the hub has
                  no HackLab, which is the kind of lie that costs trust.
       plain    — FAQ, feedback form, how-it-works. Never lab content, so
                  they simply step aside while a filter is active and come
                  back when it is cleared. */
  var gridSections = [];
  var features = [];
  var plainSections = [];
  var sectionNodes = document.querySelectorAll('main .section-card');
  for (var j = 0; j < sectionNodes.length; j++) {
    var s = sectionNodes[j];
    if (s.querySelector('.lab-grid')) gridSections.push(s);
    else if (s.classList.contains('lab-feature')) features.push({ el: s, text: textOf(s) });
    else plainSections.push(s);
  }

  var total = cards.length + features.length;

  /* ------------------------------------------------------------------------
     Applying a filter. One pass over the index, one class toggle per node —
     the browser batches the style flush, so this stays instant at this size.
     ------------------------------------------------------------------------ */

  function apply(raw) {
    var q = raw.trim().toLowerCase().replace(/\s+/g, ' ');

    if (!q) { restore(); return; }

    var shown = 0;
    var k;

    for (k = 0; k < cards.length; k++) {
      var hit = cards[k].text.indexOf(q) !== -1;
      cards[k].el.classList.toggle(HIDE, !hit);
      if (hit) shown++;
    }
    for (k = 0; k < features.length; k++) {
      var fHit = features[k].text.indexOf(q) !== -1;
      features[k].el.classList.toggle(HIDE, !fHit);
      if (fHit) shown++;
    }

    // A section folds when the filter emptied it. Queried live rather than
    // counted per-section above so this cannot drift from what is actually
    // on screen.
    for (k = 0; k < gridSections.length; k++) {
      var alive = gridSections[k].querySelector('.lab-card:not(.' + HIDE + ')');
      gridSections[k].classList.toggle(HIDE, !alive);
    }
    for (k = 0; k < plainSections.length; k++) {
      plainSections[k].classList.add(HIDE);
    }

    countEl.textContent = shown + ' of ' + total + ' labs';
    emptyEl.hidden = shown !== 0;
    clearBtn.hidden = false;
  }

  function restore() {
    var k;
    for (k = 0; k < cards.length; k++) cards[k].el.classList.remove(HIDE);
    for (k = 0; k < features.length; k++) features[k].el.classList.remove(HIDE);
    for (k = 0; k < gridSections.length; k++) gridSections[k].classList.remove(HIDE);
    for (k = 0; k < plainSections.length; k++) plainSections[k].classList.remove(HIDE);
    countEl.textContent = '';
    emptyEl.hidden = true;
    clearBtn.hidden = true;
  }

  function clear() {
    input.value = '';
    if (timer) { clearTimeout(timer); timer = 0; }
    restore();
    input.focus();
  }

  /* ------------------------------------------------------------------------
     Wiring. Debounced ~120ms — fast enough to feel live, slow enough that a
     burst of typing costs one pass instead of one per keystroke. The input
     event also fires for the native clear "x" of type=search, so that path
     needs no extra handling.
     ------------------------------------------------------------------------ */

  var timer = 0;
  input.addEventListener('input', function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = 0;
      apply(input.value);
    }, 120);
  });

  // Escape empties the box when it has something in it. When it is already
  // empty the key is left alone for whoever is listening above (nothing on
  // this page today, but that is not this file's business to assume).
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); return; } // nothing to submit
    if (e.key !== 'Escape' || !input.value) return;
    e.preventDefault();
    clear();
  });

  clearBtn.addEventListener('click', clear);
  if (emptyClear) emptyClear.addEventListener('click', clear);

  // Browsers restore form values on back/forward navigation, so the box can
  // arrive non-empty while the grid arrives unfiltered. Reconcile on load
  // and again on pageshow, which is what fires on a bfcache restore.
  apply(input.value);
  window.addEventListener('pageshow', function () { apply(input.value); });
})();

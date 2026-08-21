// Blog index controls: category filter chips + the progressive "show more"
// reveal, sharing one visibility pass so they can never fight each other.
// Without JS neither control appears and every card is simply visible.
(function () {
  var VISIBLE = 6;
  var grid = document.querySelector('.blog-grid');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.post-card'));
  var featuredCard = document.querySelector('.featured-post');
  var featuredSection = featuredCard ? featuredCard.closest('.section-card') : null;
  var wrap = document.querySelector('.blog-show-more');
  var button = document.getElementById('show-more-posts');
  var filterBar = document.querySelector('.blog-filters');

  // Small sets never need the cap; the button also stays hidden for them.
  var expanded = cards.length <= VISIBLE;
  var activeFilter = 'all';

  // Filtering shows/hides cards purely via style.display, which is silent to
  // screen readers. This polite live region announces the resulting count so
  // AT users know the chip did something. Created once, reused per filter.
  var announcer = document.createElement('p');
  announcer.className = 'sr-only';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  if (filterBar) filterBar.appendChild(announcer);

  function apply() {
    var matches = 0;
    var shown = 0;
    cards.forEach(function (card) {
      var match = activeFilter === 'all' || card.getAttribute('data-category') === activeFilter;
      var visible = match;
      // The six-card cap only applies to the unexpanded "All" view. A category
      // view always shows every match — filtering and then having to click
      // "show more" to see the rest would read as missing posts.
      if (match && activeFilter === 'all' && !expanded) {
        visible = matches < VISIBLE;
      }
      if (match) matches += 1;
      if (visible) shown += 1;
      card.style.display = visible ? '' : 'none';
    });

    if (wrap) {
      wrap.style.display = activeFilter === 'all' && !expanded && cards.length > VISIBLE ? '' : 'none';
    }

    // The featured card follows the filter too — pinning an off-topic post
    // above a filtered list would contradict the filter.
    if (featuredSection && featuredCard) {
      var featuredMatch = activeFilter === 'all' ||
        featuredCard.getAttribute('data-category') === activeFilter;
      featuredSection.style.display = featuredMatch ? '' : 'none';
      // The featured post is never capped, so it is both a match and shown.
      if (featuredMatch) { matches += 1; shown += 1; }
    }
    return { shown: shown, total: matches };
  }

  // The announcement used to read the whole catalogue ("15 articles") while the
  // grid was showing six cards plus the featured one — so a screen-reader user
  // was told about nine posts that are not on the page. Say what is actually
  // rendered whenever the cap is hiding something.
  var activeLabel = 'all';
  function announce(counts) {
    var noun = counts.total === 1 ? ' article' : ' articles';
    announcer.textContent =
      (counts.shown < counts.total
        ? 'Showing ' + counts.shown + ' of ' + counts.total + noun
        : counts.total + noun) +
      (activeFilter === 'all' ? '' : ' in ' + activeLabel);
  }

  function setFilter(next, updateHash, shouldAnnounce) {
    var previous = activeFilter;
    activeFilter = next;
    var label = 'all';
    if (filterBar) {
      Array.prototype.forEach.call(filterBar.querySelectorAll('.blog-filter'), function (chip) {
        var on = chip.getAttribute('data-filter') === next;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-pressed', String(on));
        if (on) label = chip.textContent.trim();
      });
    }
    activeLabel = label;
    // Never assign location.hash: that scrolls the page to the chip bar.
    //
    // This used replaceState to avoid history spam from browsing between
    // categories, but the cost was worse than the spam: after filtering to
    // "Security", Back left the blog entirely instead of undoing the filter,
    // which is the one thing a filtered list makes people expect. pushState
    // costs one entry per *change* of category — clicking the chip that is
    // already active adds nothing — and popstate below restores the view.
    if (updateHash && history.pushState && previous !== next) {
      history.pushState({ blogFilter: next }, '',
        next === 'all' ? location.pathname + location.search : '#' + next);
    }
    var counts = apply();
    // Only announce on an actual user click, not the initial/deep-link setup.
    if (shouldAnnounce) announce(counts);
  }

  if (button && wrap) {
    button.addEventListener('click', function () {
      expanded = true;
      // Revealing eight more cards was completely silent before this: the
      // wrapper vanished and nothing said why the page got longer.
      announce(apply());
      // Hiding the wrapper while its button is focused would drop keyboard
      // focus to <body>, so hand focus to the first newly revealed card.
      var target = cards[VISIBLE];
      if (target) {
        if (!target.hasAttribute('href') && !target.hasAttribute('tabindex')) {
          target.setAttribute('tabindex', '-1');
        }
        target.focus();
      }
    });
  }

  if (filterBar) {
    filterBar.style.display = '';
    filterBar.addEventListener('click', function (event) {
      var chip = event.target.closest ? event.target.closest('.blog-filter') : null;
      if (!chip) return;
      setFilter(chip.getAttribute('data-filter'), true, true);
    });
  }

  // Deep links like /blog#security select the matching chip. The character
  // check both validates the slug and keeps arbitrary hash input out of the
  // selector below. Also re-run on hashchange: a link to a filtered view from
  // elsewhere on the page (or back/forward) is a same-document navigation
  // that never re-executes this script.
  function applyHash() {
    var slug = (window.location.hash || '').slice(1);
    var isValid = /^[a-z-]+$/.test(slug) && filterBar &&
      filterBar.querySelector('.blog-filter[data-filter="' + slug + '"]');
    setFilter(isValid ? slug : 'all', false);
  }

  window.addEventListener('hashchange', applyHash);
  // Back/forward across the entries pushState created. popstate and hashchange
  // can both fire for one press, which is fine: applyHash reads the URL and is
  // idempotent, and it passes updateHash=false so it can never push back.
  window.addEventListener('popstate', applyHash);
  applyHash();
})();

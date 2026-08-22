// Recommendations page: rotating featured card and the recommendation pager.
// Externalized from the old inline script on client-reviews.html so the page
// ships zero executable inline scripts (CSP-friendly).
(function () {
  const cards = Array.from(document.querySelectorAll('.recommendation-carousel .recommendation-card'));

  // Rotate the featured card through all recommendations on every visit.
  // The pick is derived from the clock rather than Math.random() because
  // the site stores nothing in the browser — a time-based index still
  // guarantees two reloads more than a second apart show different cards.
  const featured = document.querySelector('#featured-recommendation-shell .featured-recommendation-card');
  if (featured && cards.length) {
    const pick = cards[Math.floor(Date.now() / 1000) % cards.length];
    const text = (selector) => {
      const el = pick.querySelector(selector);
      return el ? el.textContent : '';
    };
    const set = (selector, value) => {
      const el = featured.querySelector(selector);
      if (el && value) el.textContent = value;
    };
    set('.featured-recommendation-quote', '“' + text('.recommendation-quote') + '”');
    set('.featured-recommendation-author', text('.recommendation-author'));
    set('.featured-recommendation-meta', text('.recommendation-role'));
    set('.recommendation-date', text('.recommendation-date'));
  }

  const label = document.getElementById('recommendation-label');
  const prevBtn = document.getElementById('prev-recommendation');
  const nextBtn = document.getElementById('next-recommendation');
  const controls = document.querySelector('.recommendation-controls');
  if (!cards.length || !label || !prevBtn || !nextBtn || !controls) return;

  // Controls are hidden until JS runs, so no-JS visitors see every recommendation.
  controls.style.display = '';

  /* An escape hatch out of the carousel.

     Every card ships in the HTML; the pager then hides all but the current one.
     That makes the page strictly worse with JavaScript than without it: Ctrl+F
     finds no name but the visible one, and the rest are gone from the
     accessibility tree — on the page the homepage links to with "Read all
     recommendations".

     The carousel itself is fine and stays; it just needs a way out. The button
     is built here rather than in the markup because a no-JS visitor is already
     seeing every card and would only be confused by a control that does nothing.

     No count in the label, here or on the projects pager: a hardcoded total goes
     stale silently the moment a card is added, which is exactly what happened to
     the CSS that called this the "Show all 30" toggle. "Recommendation N of M"
     below still counts, because it reads M off cards.length at render time. */
  const showAllBtn = document.createElement('button');
  showAllBtn.type = 'button';
  showAllBtn.className = 'carousel-btn carousel-btn-wide';
  showAllBtn.id = 'show-all-recommendations';
  showAllBtn.setAttribute('aria-pressed', 'false');
  showAllBtn.textContent = 'Show all';
  // Before the trailing arrow, not after it, so the row reads
  // [prev] [label] [show all] [next] and .recommendation-controls' auto margins
  // can pin an arrow to each end. Matches how projects.js places its toggle.
  controls.insertBefore(showAllBtn, controls.lastElementChild);

  let current = 0;
  let showAll = false;

  function render() {
    cards.forEach((card, index) => {
      card.style.display = (showAll || index === current) ? '' : 'none';
    });
    // With every card on screen there is nothing to page to, so the arrows
    // leave rather than sit there greyed out. Move focus off one first: a
    // display:none element cannot hold focus, and losing it would drop a
    // keyboard user back to the top of the page.
    if (showAll && (document.activeElement === prevBtn || document.activeElement === nextBtn)) {
      showAllBtn.focus();
    }
    prevBtn.hidden = showAll;
    nextBtn.hidden = showAll;
    // Left disabled as well as hidden: if a stylesheet ever defeats [hidden],
    // this degrades to greyed-out arrows rather than live ones that would page
    // a list already showing everything.
    prevBtn.disabled = showAll;
    nextBtn.disabled = showAll;
    showAllBtn.setAttribute('aria-pressed', showAll ? 'true' : 'false');
    showAllBtn.textContent = showAll ? 'Show one at a time' : 'Show all';
    label.textContent = showAll
      ? 'Showing all recommendations'
      : 'Recommendation ' + (current + 1) + ' of ' + cards.length;
  }

  prevBtn.addEventListener('click', () => {
    current = (current - 1 + cards.length) % cards.length;
    render();
  });

  nextBtn.addEventListener('click', () => {
    current = (current + 1) % cards.length;
    render();
  });

  showAllBtn.addEventListener('click', () => {
    showAll = !showAll;
    render();
  });

  render();
})();

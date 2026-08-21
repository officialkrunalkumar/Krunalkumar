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

     All 30 cards ship in the HTML; the pager then hides 29 of them. That makes
     the page strictly worse with JavaScript than without it: Ctrl+F finds no
     name but the visible one, and the other 29 are gone from the accessibility
     tree — on the page the homepage links to with "Read all 30 recommendations".

     The carousel itself is fine and stays; it just needs a way out. The button
     is built here rather than in the markup because a no-JS visitor is already
     seeing all 30 and would only be confused by a control that does nothing. */
  const showAllBtn = document.createElement('button');
  showAllBtn.type = 'button';
  showAllBtn.className = 'carousel-btn carousel-btn-wide';
  showAllBtn.id = 'show-all-recommendations';
  showAllBtn.setAttribute('aria-pressed', 'false');
  showAllBtn.textContent = 'Show all ' + cards.length;
  controls.appendChild(showAllBtn);

  let current = 0;
  let showAll = false;

  function render() {
    cards.forEach((card, index) => {
      card.style.display = (showAll || index === current) ? '' : 'none';
    });
    prevBtn.disabled = showAll;
    nextBtn.disabled = showAll;
    showAllBtn.setAttribute('aria-pressed', showAll ? 'true' : 'false');
    showAllBtn.textContent = showAll ? 'Show one at a time' : 'Show all ' + cards.length;
    label.textContent = showAll
      ? 'Showing all ' + cards.length + ' recommendations'
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

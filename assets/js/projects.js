// Projects page: repository-gallery pager and the rotating featured card.
// Externalized from the old inline script on projects.html so the page ships
// zero executable inline scripts (CSP-friendly).
(function () {
  const projectList = document.getElementById('project-list');
  const projectItems = projectList ? Array.from(projectList.querySelectorAll('.project-item')) : [];
  const itemsPerPage = 4;
  const totalPages = Math.ceil(projectItems.length / itemsPerPage);
  let currentPage = 0;

  // The pager is hidden until JS runs, so no-JS visitors simply see every project.
  document.querySelectorAll('.project-carousel .carousel-controls').forEach((controls) => {
    controls.style.display = '';
  });

  const pageLabel = document.getElementById('project-page-label');
  const pageLabelBottom = document.getElementById('project-page-label-bottom');
  const prevButton = document.getElementById('prev-projects');
  const nextButton = document.getElementById('next-projects');
  const prevButtonBottom = document.getElementById('prev-projects-bottom');
  const nextButtonBottom = document.getElementById('next-projects-bottom');
  const pagerReady = projectItems.length && pageLabel && pageLabelBottom &&
    prevButton && nextButton && prevButtonBottom && nextButtonBottom;

  /* Same escape hatch as the recommendations pager: every project ships in the
     HTML and the pager then hides all but the current page, so Ctrl+F finds only
     those and the rest leave the accessibility tree. The pager stays — it just
     stops being the only option.

     Counts are deliberately absent from this comment and from the toggle label:
     the CSS calling it the "Show all 30" toggle sat there wrong for 21 projects,
     which is what a hardcoded total does. The label reads "Show all" and the
     page count comes from projectItems.length at runtime, so adding a project to
     the HTML is the only edit adding a project needs. */
  let showAll = false;

  function renderPage() {
    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    projectItems.forEach((item, index) => {
      item.style.display = (showAll || (index >= start && index < end)) ? '' : 'none';
    });
    const label = showAll
      ? 'Showing all projects'
      : 'Page ' + (currentPage + 1) + ' of ' + totalPages;
    pageLabel.textContent = label;
    pageLabelBottom.textContent = label;
    const atStart = currentPage === 0;
    const atEnd = currentPage === totalPages - 1;
    const arrows = [prevButton, nextButton, prevButtonBottom, nextButtonBottom];
    // With every project on screen there is nothing left to page to, so the
    // arrows leave rather than sit there greyed out. Same keyboard hazard as
    // disabling the focused one, only sharper — a display:none element cannot
    // hold focus at all — so hand focus to the toggle in the same cluster
    // before they go. In practice the toggle is already what the visitor just
    // clicked; this covers the case where it was driven some other way.
    if (showAll && arrows.indexOf(document.activeElement) !== -1) {
      const cluster = document.activeElement.closest('.carousel-controls');
      const toggle = cluster && cluster.querySelector('.carousel-btn-wide');
      if (toggle) toggle.focus();
    }
    arrows.forEach((b) => { b.hidden = showAll; });
    // Disabling the button that currently holds focus would dump
    // keyboard users back to the top of the page — hand focus to its
    // counterpart first. Skipped while showAll is on: every arrow is hidden,
    // so focusing one would be handing focus to something with no box.
    if (!showAll) {
      if (atStart && document.activeElement === prevButton) nextButton.focus();
      if (atEnd && document.activeElement === nextButton) prevButton.focus();
      if (atStart && document.activeElement === prevButtonBottom) nextButtonBottom.focus();
      if (atEnd && document.activeElement === nextButtonBottom) prevButtonBottom.focus();
    }
    // `|| showAll` is redundant with hidden and kept deliberately: it means a
    // stylesheet that ever defeats [hidden] degrades to greyed-out arrows
    // rather than live ones that would page a list already showing everything.
    prevButton.disabled = atStart || showAll;
    nextButton.disabled = atEnd || showAll;
    prevButtonBottom.disabled = atStart || showAll;
    nextButtonBottom.disabled = atEnd || showAll;
    showAllButtons.forEach((b) => {
      b.setAttribute('aria-pressed', showAll ? 'true' : 'false');
      b.textContent = showAll ? 'Show a page at a time' : 'Show all';
    });
  }

  function changePage(delta) {
    const next = currentPage + delta;
    if (next < 0 || next > totalPages - 1) return;
    currentPage = next;
    renderPage();
  }

  // One toggle per control cluster (the page has a top and a bottom pager), so
  // whichever one the visitor reaches first can do the job.
  const showAllButtons = [];
  if (pagerReady) {
    document.querySelectorAll('.project-carousel .carousel-controls').forEach((controls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'carousel-btn carousel-btn-wide';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = 'Show all';
      b.addEventListener('click', () => { showAll = !showAll; renderPage(); });
      // Insert before the next arrow, not append after it: the row reads
      // [prev] [page label] [show all] [next], which keeps the two arrows on
      // the outside edges where .carousel-controls' auto margins pin them.
      // lastElementChild is that next arrow -- the comment node in the bottom
      // cluster is not an element, so it cannot be picked up by mistake.
      controls.insertBefore(b, controls.lastElementChild);
      showAllButtons.push(b);
    });
  }

  if (pagerReady) {
    prevButton.addEventListener('click', () => changePage(-1));
    nextButton.addEventListener('click', () => changePage(1));
    prevButtonBottom.addEventListener('click', () => changePage(-1));
    nextButtonBottom.addEventListener('click', () => changePage(1));
    renderPage();
  }

  // Rotate the featured card through the spotlight projects on every
  // visit. Clock-derived rather than Math.random(): with 7 spotlight
  // items a random pick repeats back-to-back 1 reload in 7, which reads
  // as "not rotating" — the time index guarantees consecutive reloads
  // differ, and the site's no-browser-storage rule rules out remembering
  // the last pick.
  const featuredLink = document.querySelector('#featured-project-card .featured-project-card');
  const spotlightItems = projectItems.filter((item) => item.hasAttribute('data-spotlight'));
  if (featuredLink && spotlightItems.length) {
    const pick = spotlightItems[Math.floor(Date.now() / 1000) % spotlightItems.length];
    featuredLink.href = pick.href;
    featuredLink.querySelector('.project-name').textContent = pick.querySelector('.project-name').textContent;
    featuredLink.querySelector('.project-description').textContent = pick.querySelector('.project-description').textContent;
  }
})();

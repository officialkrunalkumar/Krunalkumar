// Builds the "In this article" jump-box on blog posts from the h2 headings
// inside .post-body. Posts now ship a static TOC in the markup, so this
// script is a fallback for future posts without one — it bails out when a
// .post-toc already exists. New posts still get a TOC automatically as long
// as they include this script and use h2 section headings.
(function () {
  if (document.querySelector('.post-toc')) return; // static TOC already in the markup

  var body = document.querySelector('.post-body');
  if (!body) return;

  var headings = Array.prototype.slice.call(body.querySelectorAll('h2'));
  if (headings.length < 3) return; // a TOC for two sections is noise

  var toc = document.createElement('nav');
  toc.className = 'post-toc';
  toc.setAttribute('aria-label', 'In this article');

  var title = document.createElement('p');
  title.className = 'eyebrow';
  title.textContent = 'In this article';
  toc.appendChild(title);

  var list = document.createElement('ol');
  headings.forEach(function (h2, i) {
    if (!h2.id) {
      var slug = h2.textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section-' + (i + 1);
      // Repeated heading text must not produce a duplicate id — every TOC
      // link would jump to the first occurrence.
      var unique = slug, n = 2;
      while (document.getElementById(unique)) unique = slug + '-' + n++;
      h2.id = unique;
    }
    var item = document.createElement('li');
    var link = document.createElement('a');
    link.href = '#' + h2.id;
    link.textContent = h2.textContent;
    item.appendChild(link);
    list.appendChild(item);
  });
  toc.appendChild(list);

  // The rail layout wants the nav as a sibling that precedes .post-body inside
  // .post-layout, not as a child of the article (see "Article + contents rail"
  // in blog.css). Fall back to the old in-body position if a post ships
  // without the wrapper, so a missing wrapper costs the nav its column rather
  // than its existence.
  var layout = body.parentNode;
  if (layout && layout.classList && layout.classList.contains('post-layout')) {
    layout.insertBefore(toc, body);
  } else {
    body.insertBefore(toc, body.firstChild);
  }
})();

// Marks the section you are currently reading in the contents rail. A sticky
// list of eight links that never says which one you are on is a table of
// contents, not a position indicator — the highlight is what makes the rail
// worth pinning. Runs after the block above, so it picks up a built TOC as
// readily as a static one.
(function () {
  var toc = document.querySelector('.post-toc');
  if (!toc) return;

  // Only links that actually resolve to a heading on this page. A TOC entry
  // pointing at a removed section must not be selectable.
  var entries = [];
  Array.prototype.forEach.call(toc.querySelectorAll('a[href^="#"]'), function (link) {
    var heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (heading) entries.push({ link: link, heading: heading });
  });
  if (entries.length < 2) return;

  var current = null;

  // Matches html { scroll-padding-top: 6rem } plus a little, so the section
  // highlighted is the one whose heading has passed under the sticky header —
  // which is the one whose text is actually on screen.
  var LINE = 140;

  function update() {
    // Viewport-relative, deliberately. offsetTop is measured from the nearest
    // positioned ancestor, and main carries position: relative, so comparing it
    // against window.scrollY was out by the height of everything above main and
    // the highlight never left the first entry.
    var active = entries[0];
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].heading.getBoundingClientRect().top <= LINE) active = entries[i];
    }
    // Past the last heading the reader is in the closing section, which the
    // loop above already settles on; nothing extra to do.
    if (active === current) return;
    if (current) {
      current.link.classList.remove('is-current');
      current.link.removeAttribute('aria-current');
    }
    active.link.classList.add('is-current');
    // "true" rather than "location": this marks a position within the page,
    // not the page itself — the nav link in the site header owns that.
    active.link.setAttribute('aria-current', 'true');
    current = active;
  }

  // Scroll fires far more often than the highlight can meaningfully change, so
  // collapse a burst of events into one read per frame and never lay out twice.
  var queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      update();
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();

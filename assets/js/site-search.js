/* ==========================================================================
   site-search.js — search across the whole site, with no server.
   --------------------------------------------------------------------------
   59 labs is well past the point where browsing finds anything. The index
   lives at /assets/data/search-index.json, generated from the pages
   themselves, and is fetched once on first use — not on page load, because
   most visits never search and 40 KB gzipped is not worth spending on them.

   Scoring, in descending weight: a hit in the title beats a hit in the
   description, which beats a hit in the body. Every word of the query has to
   appear somewhere or the page is dropped, so "webrtc chat" does not return
   every page mentioning chat. Titles starting with the query rank highest,
   which is what makes typing "bud" find the Buddha page immediately.

   IMPORTANT: the index is a committed file, not something generated at
   runtime. Adding a page or changing a title means regenerating it —
   see README under "Site search".
   ========================================================================== */

(function () {
  'use strict';

  /* The shared header is swapped in by include-partials.js after this script
     runs, which destroys whatever elements were here at parse time. So nothing
     is captured up front: the elements are looked up when they are needed, and
     every listener is delegated from document. */
  /* The overlay is built here rather than written into 90 pages: the nav only
     carries an icon, so the bar stays the width it always was. */
  var overlay = null;

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'site-search-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="site-search-box" role="dialog" aria-modal="true" aria-label="Search the site">' +
        '<div class="site-search-field">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
          '</svg>' +
          '<label class="sr-only" for="site-search-input">Search the site</label>' +
          '<input class="site-search-input" id="site-search-input" type="search" ' +
                 'placeholder="Search labs, posts and pages…" autocomplete="off" spellcheck="false" />' +
          '<button class="site-search-close" type="button" aria-label="Close search">Esc</button>' +
        '</div>' +
        '<div class="site-search-panel" id="site-search-panel"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || (e.target.closest && e.target.closest('.site-search-close'))) close();
    });
    return overlay;
  }

  function open() {
    build();
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    load();
    var i = $in();
    if (i) { i.value = ''; i.focus(); }
    var p = $panel();
    if (p) p.innerHTML = '';
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    document.documentElement.style.overflow = '';
  }

  function $in() { return document.getElementById('site-search-input'); }
  function $panel() { return document.getElementById('site-search-panel'); }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('#search-open')) { e.preventDefault(); open(); }
  });

  var index = null;
  var loading = null;
  var lastQuery = '';
  var active = -1;

  function load() {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    loading = fetch('/assets/data/search-index.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) { index = d.pages || []; return index; })
      .catch(function () {
        index = [];
        return index;
      });
    return loading;
  }

  function score(page, words) {
    var t = page.t.toLowerCase();
    var h = (page.h || '').toLowerCase();
    var d = (page.d || '').toLowerCase();
    var b = (page.b || '').toLowerCase();
    var total = 0;

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var s = 0;
      if (t.indexOf(w) === 0) s += 120;          // title starts with it
      else if (t.indexOf(w) >= 0) s += 60;
      if (h.indexOf(w) >= 0) s += 25;
      if (d.indexOf(w) >= 0) s += 18;
      if (b.indexOf(w) >= 0) s += 6;
      if (page.u.indexOf(w) >= 0) s += 30;
      if (!s) return 0;                          // every word must appear
      total += s;
    }
    // A whole-phrase hit in the title is what someone almost always means.
    if (words.length > 1 && t.indexOf(words.join(' ')) >= 0) total += 90;
    return total;
  }

  function snippet(page, words) {
    var b = page.b || page.d || '';
    var low = b.toLowerCase();
    var at = -1;
    for (var i = 0; i < words.length && at < 0; i++) at = low.indexOf(words[i]);
    if (at < 0) return page.d || '';
    var from = Math.max(0, at - 60);
    var text = b.slice(from, from + 190);
    return (from > 0 ? '…' : '') + text + (from + 190 < b.length ? '…' : '');
  }

  function render(results, words) {
    var panel = $panel();
    if (!panel) return;
    panel.innerHTML = '';
    if (!results.length) {
      var none = document.createElement('p');
      none.className = 'site-search-none';
      none.textContent = index && index.length
        ? 'Nothing matched.'
        : 'Search index unavailable.';
      panel.appendChild(none);
      return;
    }
    var list = document.createElement('ul');
    list.className = 'site-search-list';
    list.setAttribute('role', 'listbox');

    results.forEach(function (r, i) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = r.page.u;
      a.className = 'site-search-hit';
      a.setAttribute('role', 'option');
      a.setAttribute('aria-selected', i === active ? 'true' : 'false');
      if (i === active) a.classList.add('is-active');

      var top = document.createElement('span');
      top.className = 'site-search-hit-top';
      var title = document.createElement('span');
      title.className = 'site-search-hit-title';
      title.textContent = r.page.t;
      var tag = document.createElement('span');
      tag.className = 'site-search-hit-tag';
      tag.textContent = r.page.s;
      top.appendChild(title);
      top.appendChild(tag);

      var sn = document.createElement('span');
      sn.className = 'site-search-hit-snip';
      sn.textContent = snippet(r.page, words);

      a.appendChild(top);
      a.appendChild(sn);
      li.appendChild(a);
      list.appendChild(li);
    });

    panel.appendChild(list);
  }

  function run() {
    var input = $in(), panel = $panel();
    if (!input || !panel) return;
    var q = input.value.trim().toLowerCase();
    lastQuery = q;
    if (q.length < 2) { panel.innerHTML = ''; return; }

    load().then(function (pages) {
      if (lastQuery !== q) return;               // a newer keystroke won
      var words = q.split(/\s+/).filter(Boolean);
      var out = [];
      for (var i = 0; i < pages.length; i++) {
        var s = score(pages[i], words);
        if (s > 0) out.push({ page: pages[i], s: s });
      }
      out.sort(function (a, b) { return b.s - a.s || a.page.t.localeCompare(b.page.t); });
      active = -1;
      render(out.slice(0, 8), words);
    });
  }

  var timer = null;
  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== 'site-search-input') return;
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 90);
  });

  // Warm the index on focus so the first keystroke feels instant.
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'site-search-input') load();
  });

  document.addEventListener('keydown', function (e) {
    if (!e.target || e.target.id !== 'site-search-input') return;
    var panel = $panel(), input = $in();
    if (!panel || !input) return;
    var hits = panel.querySelectorAll('.site-search-hit');
    if (e.key === 'Escape') { close(); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active += (e.key === 'ArrowDown' ? 1 : -1);
      if (active < 0) active = hits.length - 1;
      if (active >= hits.length) active = 0;
      Array.prototype.forEach.call(hits, function (a, i) {
        a.classList.toggle('is-active', i === active);
        a.setAttribute('aria-selected', i === active ? 'true' : 'false');
      });
      hits[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      window.location.href = hits[active].getAttribute('href');
    }
  });



  // "/" focuses search, the way most documentation sites behave.
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    e.preventDefault();
    open();
  });
}());

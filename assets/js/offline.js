/* ==========================================================================
   offline.js — makes /offline list what is ACTUALLY in the cache.
   --------------------------------------------------------------------------
   This page used to make two kinds of claim. A hand-written "Games you have
   played" list was the first casualty: fixed at build time, it named games
   the visitor had never opened, and every one of those links led to the
   browser's own "site cannot be reached" error — from a page whose entire
   purpose is to be the thing that still works when nothing else does. Then
   the same disease took the "Always available" list: it leaned on sw.js's
   install-time precache lists (DOC_URLS, BLOG_URLS), and hand-kept lists
   drift — 49 blog images went missing from them exactly that way. The owner
   has abolished install-time precache lists entirely: sw.js now downloads
   only this page's own shell (tens of KB, down from ~4.5MB), and every
   other page is cached when a visitor opens it.

   So there is nothing left on this page to audit and nothing left to prune.
   A page that promises offline access has exactly one honest way to build
   its list: ask the cache. Every entry rendered below is rendered BECAUSE a
   matching response was found in Cache Storage, which makes "everything
   here works without a connection" true by construction rather than true by
   somebody remembering to update a list — and, unlike the old precache
   lists, true-by-construction cannot drift.

   Loaded rather than inlined because the CSP forbids inline scripts, and
   precached alongside /offline as part of sw.js's offline shell so it is
   present in exactly the situation it exists for.

   ES5 house rules. No promises beyond what Cache Storage already requires.
   ========================================================================== */

(function (root) {
  'use strict';

  var doc = root.document;

  function el(id) { return doc.getElementById(id); }

  /* A handful of first-class pages keep their hand-written names and the
     one-line notes the rest of the site introduces them with (the wish and
     festival lines especially — that copy was tuned on the pages themselves
     and should read the same here). This is a NOTES table, not a link list:
     nothing in it is ever shown unless the cache actually holds the page,
     so it can go stale without ever going wrong — a missing entry just
     falls back to the derived name below. Kept to a few entries because
     this file is precached on every visitor's first load; its weight is
     paid by people who may never see it. */
  var KNOWN = {
    '/':                    { name: 'Home',           note: 'the front door' },
    '/blog':                { name: 'The blog',       note: 'index of the posts' },
    '/labs':                { name: 'The labs',       note: 'index of the tools' },
    '/games':               { name: 'The arcade',     note: 'index of the games' },
    '/labs/resume-maker':   { name: 'Resume maker',   note: 'five templates, printing is the download' },
    '/labs/biodata-maker':  { name: 'Biodata maker',  note: 'the document you should never upload' },
    '/labs/wish-generator': { name: 'Wish generator', note: '92 festivals, builds a link from a name' },
    '/birthday':            { name: 'Birthday card',  note: 'what the generator builds' },
    '/festival':            { name: 'Festival card',  note: 'the same, for the other 92' }
  };

  /* Hubs and the maker/card pages sort ahead of everything else: they are
     the places a stranded visitor can DO something, where a blog post is a
     read. Everything not named here follows alphabetically. */
  var KNOWN_ORDER = ['/', '/labs', '/games', '/blog', '/labs/resume-maker',
    '/labs/biodata-maker', '/labs/wish-generator', '/birthday', '/festival'];

  /* Enough to be useful, few enough that the list stays a list. A visitor
     with a year of reading cached could hold a hundred pages; past this
     many, the tail collapses into one honest "+N more" line rather than a
     scroll of entries — every one of those pages still opens by its own
     address, the list just stops enumerating. */
  var MAX_LISTED = 12;

  /* "how-sim-swap-works" -> "How sim swap works". Sentence case, matching
     how the hubs write them. Derived from the slug rather than shipped as a
     site-wide name table: a derived name is occasionally less pretty and
     never wrong, and a full table would be most of the file (see KNOWN for
     why weight matters here). */
  function titleFrom(path) {
    var known = KNOWN[path];
    if (known) return known.name;
    var slug = path.replace(/^.*\//, '').replace(/-/g, ' ');
    if (!slug) return path;
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  /* The word after the name: what KIND of thing this is. The section of the
     URL already says, so no table is needed beyond KNOWN's hand-tuned few. */
  function noteFrom(path) {
    var known = KNOWN[path];
    if (known) return known.note;
    if (path.indexOf('/blog/') === 0) return 'blog post';
    if (path.indexOf('/games/') === 0) return 'game';
    if (path.indexOf('/labs/') === 0) return 'lab';
    return null;
  }

  /* PAGES only. The caches also hold scripts, stylesheets and images, and
     listing /assets/js/games/arcade/snake.js as somewhere you can go would
     be nonsense. After normalisation (below) every page path is clean and
     extensionless, so "last segment contains a dot" cleanly means "a file".
     /offline itself is excluded — linking the page you are on to itself
     helps nobody — and so is the 404 page, which nobody chose to visit. */
  function isPage(path) {
    if (path.indexOf('/assets/') === 0) return false;
    /* Partials are HTML, extensionless, and land in the page cache because
       include-partials.js fetches them on every page — but they are fragments
       of chrome, not destinations. Without this line the saved list offered
       "partials/footer" as somewhere to go. */
    if (path.indexOf('/partials/') === 0) return false;
    if (path === '/offline' || path === '/404') return false;
    if (path.replace(/^.*\//, '').indexOf('.') !== -1) return false;
    return true;
  }

  /* '/blog/' -> '/blog', '/blog/index.html' -> '/blog', '/x.html' -> '/x'.
     On-use caching stores whatever URL was actually navigated, and the same
     page can be reached under any of these spellings; without folding them
     the list could show one page twice under two addresses. */
  function normalize(path) {
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    if (/\/index\.html$/.test(path)) path = path.slice(0, -11) || '/';
    else if (/\.html$/.test(path)) path = path.slice(0, -5);
    return path;
  }

  function li(href, name, note) {
    var item = doc.createElement('li');
    var a = doc.createElement('a');
    a.href = href;
    a.appendChild(doc.createTextNode(name + ' '));
    if (note) {
      var s = doc.createElement('span');
      s.textContent = note;
      a.appendChild(s);
    }
    item.appendChild(a);
    return item;
  }

  /* Every same-origin pathname held in any cache, as a lookup object.
     All caches are read, not just one: the point is to describe the
     device's actual state, and which bucket a response landed in (the
     on-use page caches, the fingerprinted lab-runtimes cache, the shell)
     is sw.js's business rather than the visitor's. */
  function cachedPaths() {
    if (!root.caches || !root.caches.keys) return null;
    return root.caches.keys().then(function (names) {
      var jobs = [];
      for (var i = 0; i < names.length; i++) {
        jobs.push(root.caches.open(names[i]).then(function (cache) {
          return cache.keys();
        }));
      }
      return Promise.all(jobs).then(function (lists) {
        var seen = {};
        for (var a = 0; a < lists.length; a++) {
          for (var b = 0; b < lists[a].length; b++) {
            var u;
            try { u = new URL(lists[a][b].url); } catch (err) { continue; }
            if (u.origin !== root.location.origin) continue;
            seen[normalize(u.pathname)] = true;
          }
        }
        return seen;
      });
    });
  }

  /* Wait for an ACTIVE service worker before believing the cache is empty.

     sw.js precaches its shell inside install's event.waitUntil(), so a
     worker does not reach "activated" until those fetches have settled —
     and on a first visit the on-use caches are legitimately still filling
     as the visitor's first page lands. The shell is tiny now, so this wait
     is usually over before the page finishes painting, but reading Cache
     Storage mid-install still sees half a state and there is no reason to.

     navigator.serviceWorker.ready resolves only for an active worker, which
     is exactly the signal needed. If there is no worker at all (an
     unsupported browser, or a first paint before registration) the wait is
     skipped. A worker that never activates would leave this pending
     forever, so the wait is capped and the page simply proceeds. */
  function whenWorkerReady() {
    if (!root.navigator || !navigator.serviceWorker) return Promise.resolve();
    if (navigator.serviceWorker.controller) return Promise.resolve();
    return new Promise(function (resolve) {
      var settled = false;
      function done() { if (!settled) { settled = true; resolve(); } }
      root.setTimeout(done, 4000);
      navigator.serviceWorker.ready.then(done)['catch'](done);
    });
  }

  /* The Home button ships hidden (see the markup comment on it): under
     on-use caching / is only saved if it has been visited, so the link is
     only shown when it can be honoured. Two ways it can be:

       - / is actually in the cache (paths['/']), or
       - the browser is not offline at all — navigator.onLine is famously
         weak evidence of a WORKING connection, but a browser reporting
         false is genuinely disconnected, so "not false" is the only safe
         direction to lean on, and someone reading /offline while online
         can follow the link whether it is cached or not.

     paths may be null when Cache Storage could not be read at all; then
     only the online case can reveal it. */
  function revealHome(paths) {
    var home = el('home-link');
    if (!home) return;
    var offline = root.navigator && navigator.onLine === false;
    if (!offline || (paths && paths['/'])) home.hidden = false;
  }

  function render(paths) {
    revealHome(paths);

    var list = el('saved-list');
    var note = el('saved-note');
    if (!list) return;

    var found = [];
    for (var p in paths) {
      if (!Object.prototype.hasOwnProperty.call(paths, p)) continue;
      if (isPage(p)) found.push(p);
    }

    /* Hand-ordered pages first, everything else alphabetically after. */
    function rank(path) {
      for (var i = 0; i < KNOWN_ORDER.length; i++) {
        if (KNOWN_ORDER[i] === path) return i;
      }
      return KNOWN_ORDER.length;
    }
    found.sort(function (x, y) {
      var d = rank(x) - rank(y);
      if (d) return d;
      return x < y ? -1 : x > y ? 1 : 0;
    });

    var shown = found.length > MAX_LISTED ? found.slice(0, MAX_LISTED) : found;
    for (var g = 0; g < shown.length; g++) {
      list.appendChild(li(shown[g], titleFrom(shown[g]), noteFrom(shown[g])));
    }

    if (found.length > shown.length) {
      /* A plain line, NOT a link: it stands in for many pages, so there is
         no one place for it to go. Styled inline to match .small because
         this stylesheet-free page keeps its classes in the markup. */
      var more = doc.createElement('li');
      more.style.padding = '0.55rem 0.2rem';
      more.style.fontSize = '0.85rem';
      more.style.color = '#7b8aa6';
      more.textContent = '+ ' + (found.length - shown.length) +
        ' more saved pages — everything you opened is kept, the list just stops here.';
      list.appendChild(more);
    }

    if (note) {
      if (!found.length) {
        note.textContent = 'Nothing saved yet — pages you visit while online become available here. ' +
          'Nothing is ever downloaded uninvited.';
      } else {
        note.textContent = 'Saved because you opened them. Anything not listed has not been visited from ' +
          'this browser, and will wait for the network.';
      }
    }

    /* Mayuri's panel names what is genuinely available, and her number is
       read from the same cache as the list — asserted by nobody. Left
       hidden at zero: "that is 0 pages" would be her rubbing it in. */
    var count = el('mayuri-count');
    if (count && found.length) {
      count.textContent = 'Right now that is ' + found.length +
        (found.length === 1 ? ' saved page.' : ' saved pages.');
      count.hidden = false;
    }
  }

  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    /* No Cache Storage at all (an old browser, or a context where it is
       blocked). Nothing is claimed — the empty list stays empty and the
       note says plainly that the page cannot check, rather than inventing
       an answer. Checked BEFORE the wait, because there is nothing to wait
       for if the API is not there at all. */
    if (!root.caches || !root.caches.keys) {
      revealHome(null);
      var note = el('saved-note');
      if (note) {
        note.textContent = 'This browser will not let the page read its own cache, so the saved pages ' +
          'cannot be listed here. Anything you opened before may still work at its own address.';
      }
      return;
    }

    whenWorkerReady()
      .then(cachedPaths)
      .then(render)['catch'](function () {
        revealHome(null);
        var n = el('saved-note');
        if (n) n.textContent = 'The saved pages could not be read from the cache.';
      });
  });
})(typeof self !== 'undefined' ? self : this);


/* ==========================================================================
   Mayuri, on this page only.
   --------------------------------------------------------------------------
   The rest of the site builds her in particle-bg.js, which /offline does not
   load — it loads nothing but this file, on purpose. So the markup is inline
   in the page and the only thing needed here is the toggle.

   Written defensively: if any of the three nodes is missing this does nothing
   at all rather than throwing, because an exception here would take the cache
   listing above it down with it, and that listing is the reason the page
   exists.
   ========================================================================== */
(function () {
  var button = document.getElementById('mayuri-button');
  var panel = document.getElementById('mayuri-panel');
  var greet = document.getElementById('mayuri-greet');

  /* Same idle glance as the main site. Kept here rather than shared, because
     this page loads no stylesheet and no partials on purpose — it has to work
     from cache alone. */
  var wrap = document.querySelector('.mayuri-wrap');
  if (wrap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var glance = function () {
      if (!document.hidden) {
        var r = function (n) { return (Math.random() * n * 2 - n).toFixed(2); };
        wrap.style.setProperty('--look-x', r(1.7) + 'px');
        wrap.style.setProperty('--look-y', r(1.2) + 'px');
        wrap.style.setProperty('--look-r', r(4.5) + 'deg');
      }
      setTimeout(glance, 1500 + Math.random() * 2800);
    };
    setTimeout(glance, 1100);
  }
  if (!button || !panel) return;

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setOpen(next) {
    panel.hidden = !next;
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next && greet) greet.hidden = true;
  }

  button.addEventListener('click', function () {
    if (!reduced) {
      button.classList.remove('is-cheering');
      void button.offsetWidth;
      button.classList.add('is-cheering');
    }
    setOpen(panel.hidden);
  });
  button.addEventListener('animationend', function () {
    button.classList.remove('is-cheering');
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  // Five seconds, then she stops saying hello. Same as the rest of the site.
  if (greet) window.setTimeout(function () { greet.hidden = true; }, 5000);
})();

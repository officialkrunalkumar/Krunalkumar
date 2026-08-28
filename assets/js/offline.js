/* ==========================================================================
   offline.js — makes /offline list what is ACTUALLY in the cache.
   --------------------------------------------------------------------------
   The page used to carry a hand-written list of games under the heading
   "Games you have played". It was a lie in the most annoying possible way:
   the list was fixed at build time, so it named games the visitor had never
   opened, and every one of those links led to the browser's own "site cannot
   be reached" error — from a page whose entire purpose is to be the thing
   that still works when nothing else does.

   A page that promises offline access has exactly one honest way to build
   its list: ask the cache. So that is what this does. Every entry below is
   rendered BECAUSE a matching response was found in Cache Storage, which
   makes "everything here works without a connection" true by construction
   rather than true by somebody remembering to update a list.

   It also audits the static list above it. Those five pages are precached by
   sw.js on install so they should always be present — but "should" is doing
   real work in that sentence (a partial install, an evicted cache, a browser
   reclaiming space under pressure), and if one is genuinely missing then
   showing it is the same broken promise in a smaller font. Anything that
   cannot be found gets removed from the list.

   Loaded rather than inlined because the CSP forbids inline scripts, and
   precached alongside /offline in sw.js DOC_URLS so it is present in exactly
   the situation it exists for. scripts/build.js enforces both halves of that:
   every asset this page references must be precached, and every internal link
   it ships statically must be precached too.

   ES5 house rules. No promises beyond what Cache Storage already requires.
   ========================================================================== */

(function (root) {
  'use strict';

  var doc = root.document;

  function el(id) { return doc.getElementById(id); }

  /* "moon-buggy" -> "Moon buggy". Sentence case, matching how the hub writes
     them. Derived from the slug rather than shipped as a 66-entry name table:
     this page is precached on every visitor's first load, so its weight is
     paid by people who may never see it, and a lookup table would be most of
     the file. A derived name is occasionally less pretty and never wrong. */
  function titleFrom(path) {
    var slug = path.replace(/^\/games\/?/, '');
    if (!slug) return 'The arcade';
    slug = slug.replace(/-/g, ' ');
    return slug.charAt(0).toUpperCase() + slug.slice(1);
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
     All caches are read, not just the game one: the point is to describe the
     device's actual state, and which bucket a response landed in is sw.js's
     business rather than the visitor's. */
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
            seen[u.pathname] = true;
          }
        }
        return seen;
      });
    });
  }

  /* Wait for an ACTIVE service worker before believing the cache is empty.

     sw.js precaches inside install's event.waitUntil(), so a worker does not
     reach "activated" until every precache fetch has settled. Reading Cache
     Storage before that point sees a half-filled cache — and this page then
     deleted the whole "Always available" list and announced that nothing was
     saved, on a first visit where the files were arriving as it spoke.

     navigator.serviceWorker.ready resolves only for an active worker, which
     is exactly the signal needed. If there is no worker at all (an unsupported
     browser, or a first paint before registration) the wait is skipped and the
     static list stays as served, which is the safe direction: those five are
     precached by design, so showing them is right until something proves
     otherwise. Never the reverse.

     A worker that never activates would leave this pending forever, so the
     wait is capped and the page simply proceeds on the timeout. */
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

  function render(paths) {
    var games = el('game-list');
    var gamesNote = el('games-note');
    var toolList = el('tool-list');

    /* Audit the precached list. A link that cannot be backed up is removed
       rather than greyed out — a disabled-looking entry still reads as a
       promise, and the reader has no way to tell the difference between "not
       saved" and "saved but broken". */
    /* Prune ONLY when actually offline.

       The audit below removes any link the cache cannot back. That is right
       when the network is gone, which is when this page normally appears —
       and wrong the rest of the time, because a visitor who reaches /offline
       while online can follow every one of these links successfully whether
       they are cached or not.

       Getting this backwards produced a genuinely alarming screen: open the
       page during the first install, while the precache is still in flight,
       and the whole "Always available" list deleted itself and announced that
       nothing was saved — on a device that was online and where the files
       were arriving as it spoke.

       navigator.onLine is famously weak evidence that you have a working
       connection, but it is strong evidence of the opposite: a browser
       reporting false is genuinely disconnected. That is the only direction
       relied on here. */
    var offline = root.navigator && navigator.onLine === false;

    if (toolList && offline) {
      var items = toolList.getElementsByTagName('li');
      for (var i = items.length - 1; i >= 0; i--) {
        var link = items[i].getElementsByTagName('a')[0];
        if (link && !paths[new URL(link.href).pathname]) {
          items[i].parentNode.removeChild(items[i]);
        }
      }
      if (!toolList.getElementsByTagName('li').length) {
        var gone = doc.createElement('p');
        gone.className = 'small';
        gone.style.marginTop = '0';
        gone.textContent = 'Nothing is saved on this device yet. These tools are stored on your first visit ' +
          'to any page here, so this should fill in once you have been online once.';
        toolList.parentNode.replaceChild(gone, toolList);
      }
    }

    /* The blog line carries a count, and the count comes from the cache for
       the same reason the game list does: sw.js precaches the posts, so the
       number is knowable exactly, and a hardcoded one would quietly rot the
       next time a post is written. */
    var blogCount = el('blog-count');
    if (blogCount) {
      var posts = 0;
      for (var q in paths) {
        if (!Object.prototype.hasOwnProperty.call(paths, q)) continue;
        if (q.indexOf('/blog/') === 0 && q.indexOf('/assets/') !== 0) posts++;
      }
      if (posts) {
        blogCount.textContent = posts + (posts === 1 ? ' post' : ' posts') + ', saved for reading offline';
      }
    }

    if (!games) return;

    /* Game PAGES only. The cache also holds each game's script and the shared
       stylesheet, and listing /assets/js/games/arcade/snake.js as somewhere
       you can go would be nonsense. */
    var found = [];
    var hub = false;
    for (var p in paths) {
      if (!Object.prototype.hasOwnProperty.call(paths, p)) continue;
      if (p === '/games') { hub = true; continue; }
      if (p.indexOf('/games/') !== 0) continue;
      if (p.indexOf('/assets/') === 0) continue;
      found.push(p);
    }
    found.sort();

    if (hub) {
      games.appendChild(li('/games', 'The arcade',
        found.length ? 'the hub, and the ' + found.length + ' below' : 'the hub'));
    }
    for (var g = 0; g < found.length; g++) {
      games.appendChild(li(found[g], titleFrom(found[g]), null));
    }

    if (gamesNote) {
      if (!found.length && !hub) {
        gamesNote.textContent = 'You have not opened any games yet, so none are saved. Games are kept only ' +
          'once played — there are too many to put on every visitor’s phone uninvited. Open one while ' +
          'you are online and it will be here next time.';
      } else {
        gamesNote.textContent = 'Kept because you opened them. Anything not listed here has not been saved, ' +
          'and will wait for the network.';
      }
    }
  }

  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    /* No Cache Storage at all (an old browser, or a context where it is
       blocked). The static list stays exactly as served — those five are
       precached by design, so leaving them shown is the correct fallback —
       and the games section says plainly that it cannot check rather than
       inventing an answer. Checked BEFORE the wait, because there is nothing
       to wait for if the API is not there at all. */
    if (!root.caches || !root.caches.keys) {
      var note = el('games-note');
      if (note) {
        note.textContent = 'This browser will not let the page read its own cache, so the saved games ' +
          'cannot be listed here. The arcade itself will still work if you have opened it before.';
      }
      return;
    }

    whenWorkerReady()
      .then(cachedPaths)
      .then(render)['catch'](function () {
        var n = el('games-note');
        if (n) n.textContent = 'The saved games could not be read from the cache.';
      });
  });
})(typeof self !== 'undefined' ? self : this);

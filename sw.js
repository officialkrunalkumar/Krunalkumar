/* ==========================================================================
   sw.js — a deliberately small service worker: Labs runtimes, plus offline
   copies of the two document makers and the blog. Nothing else.
   --------------------------------------------------------------------------
   Why this exists at all: without it, the ~90 MB of WebAssembly under
   /assets/vendor/ lands in the browser's HTTP cache, and the HTTP cache is
   invisible and untouchable from JavaScript. That produced two bad outcomes
   on the Labs pages:

     - navigator.storage.estimate() reported 0 B no matter how much had been
       downloaded, because it does not measure the HTTP cache.
     - There was no way to offer a "remove the downloaded runtimes" button,
       because no page is allowed to evict its own HTTP cache entries.

   Routing those requests through the Cache API instead fixes both. Cache
   Storage IS counted by storage.estimate(), and caches.delete() removes
   exactly this cache and nothing else — the browser's origin model means it
   cannot reach another site's data even in principle.

   SCOPE IS STILL THE WHOLE POINT. The fetch handler touches exactly four
   kinds of request — the vendor runtimes, the doc makers, navigations, and
   the blog — and returns early for everything else, so the rest of the
   site — every page, its CSS, its JS, analytics — behaves exactly as if no
   worker existed. A service worker that quietly caches a whole site's HTML
   is a support nightmare (the "why does the old page keep coming back" kind),
   and this one still refuses to be that.

   The third kind: navigations, added when the site became installable. They
   are NETWORK-ONLY — never cached, never served stale — but when the fetch
   itself fails (the installed app opened in airplane mode), a small precached
   /offline page answers instead of the browser's raw error inside a
   chromeless standalone window. Someone who could reach the network can never
   see it, so the no-stale-pages rule above still holds in full.

   The one carve-out I have allowed since: the resume maker and the marriage
   biodata maker. Those two pages promise, in print, that they work offline —
   their entire pitch is that no server is needed, and people build real
   documents in them that they expect to reopen on a train. So their exact
   files (enumerated below, nothing wildcarded) are precached and served
   NETWORK-FIRST: while you are online you always get the live copy straight
   from the network, and the cache is silently refreshed behind it; only when
   the network actually fails does the last good copy step in. Network-first
   is what keeps this compatible with the paragraph above — a stale page can
   never be shown to a visitor who could have fetched a fresh one. Cache-first
   HTML is the support nightmare; a cache that is only ever a fallback is not.

   The second carve-out, on the same terms: the blog. Twenty-five articles,
   their art, and the blog stylesheet and scripts — about 1.2 MB precached on install,
   served network-first exactly like the doc makers. The size question was
   asked and measured rather than assumed: the whole archive is 1.7% of what
   one visit to /labs/c downloads for its clang toolchain, so the metering a
   cache-on-read scheme would need costs more complexity than the bytes are
   worth. What it buys is the reason to install the app at all — an archive
   that stays readable on a plane. Still enumerated, still never wildcarded:
   a new post must join BLOG_URLS or it simply is not there offline.

   It also has to be a service worker rather than a fetch wrapper, because the
   requests needing interception are not ours to wrap: Pyodide fetches its own
   .wasm and stdlib internally, and importScripts() bypasses any shim. Only a
   service worker sees those.
   ========================================================================== */

'use strict';

// A content hash of every file under /assets/vendor/, rewritten in place by
// scripts/build.js on each deploy. This is the single source of truth for
// runtime cache invalidation: CACHE below is derived from it, so there is
// nothing to bump by hand and no way to forget. The value committed here is
// the last deploy's, so the repo copy still reads as a real hash rather than
// a placeholder.
var VENDOR_FINGERPRINT = '62cee07e74bdd978';

// The runtime cache, named after the bytes it holds. A vendor change yields a
// new name and returning visitors are refilled; an unchanged tree yields the
// same name, so an ordinary deploy costs nobody a re-download. Old
// lab-runtimes-* caches are deleted on activate.
//
// The miss path below fetches with {cache: 'reload'} so a new name genuinely
// reaches the server: the vendor URLs carry no version in their path and are
// served with a one-year immutable Cache-Control, so a plain fetch would be
// answered by the browser's HTTP cache and quietly re-cache the OLD bytes
// under the new name.
var CACHE = 'lab-runtimes-' + VENDOR_FINGERPRINT;
var PREFIX = '/assets/vendor/';

// Bump this one when the doc-maker file list changes, or to force every
// visitor onto fresh copies after a layout rework. Old versions are deleted
// on activate, same as the runtimes cache.
// v2: /offline joined the list when the site became installable.
var DOC_CACHE = 'doc-makers-v2';

// The complete, hand-enumerated set of files the two document makers need to
// render and function with no network at all. Read straight off the two page
// sources — if a page grows a new stylesheet or script, it must be added here
// or offline quietly breaks. Clean URLs (no .html) because that is what the
// browser actually requests on this host, and what include-partials.js fetches.
var DOC_URLS = [
  // The pages themselves.
  '/labs/resume-maker',
  '/labs/biodata-maker',
  // The wish generator and the two cards it builds. The generator is pure
  // string building, so it genuinely works with no network — and precaching
  // the two cards as well means its live preview keeps working offline too,
  // rather than showing an empty frame.
  '/labs/wish-generator',
  '/birthday',
  '/festival',
  // Their stylesheets: sitewide, labs-shared, and one per tool.
  '/assets/css/main.css',
  '/assets/css/labs.css',
  '/assets/css/resume-maker.css',
  '/assets/css/biodata-maker.css',
  '/assets/css/wish-generator.css',
  // The cards load ONLY this one — no main.css, no labs.css. They are
  // chromeless by design, which is also what makes them cheap to precache.
  '/assets/css/celebrate.css',
  // Sitewide scripts both pages load in <head>/<body>.
  '/assets/js/boot.js',
  '/assets/js/theme.js',
  '/assets/js/include-partials.js',
  '/assets/js/site-search.js',
  '/assets/js/particle-bg.js',
  // The tools themselves.
  '/assets/js/labs/tools/resume-maker.js',
  '/assets/js/labs/tools/biodata-maker.js',
  '/assets/js/labs/tools/wish-generator.js',
  // The wish machinery. festival-data.js is shared by the generator and the
  // festival card, which is exactly why it is one file rather than two.
  '/assets/js/festival-data.js',
  '/assets/js/celebrate-guard.js',
  '/assets/js/celebrate.js',
  '/assets/js/birthday.js',
  '/assets/js/festival.js',
  // include-partials.js swaps the static chrome for these at runtime.
  '/partials/header',
  '/partials/footer',
  // Icons, manifest, and the two images the pages actually paint (the footer
  // logo arrives via the footer partial).
  '/favicon.ico',
  '/favicon.svg',
  '/site.webmanifest',
  '/assets/images/apple-touch-icon.png',
  '/assets/images/logo-64.jpg',
  // The navigation fallback for the installed app. Self-contained by design —
  // precaching this one document is enough to keep an offline launch branded
  // instead of showing the browser's network-error page.
  // The offline page's own script. It builds that page's lists from what is
  // really in these caches, so it has to be here or the page can only fall
  // back to claiming nothing.
  '/assets/js/offline.js',
  '/offline'
];

// O(1) membership test for the fetch handler; the array above is for install.
var DOC_SET = {};
DOC_URLS.forEach(function (u) { DOC_SET[u] = true; });

// Bump this when the article list or the blog assets change; old versions are
// deleted on activate, same as the two caches above.
var BLOG_CACHE = 'blog-offline-v1';

// The blog, precached whole and served NETWORK-FIRST — the same contract the
// doc makers get, for the same reason: while you are online this is identical
// to having no worker, and the copy below only ever answers a fetch that
// actually failed. So the no-stale-pages rule at the top still holds.
//
// Precached on install rather than on read. The whole archive is about 1 MB —
// 784 KB of HTML, 142 KB of art, ~52 KB of CSS and JS — against the 58 MB a
// single visit to /labs/c already downloads, so metering it per article would
// have cost more in machinery than it could ever save in bytes. Enumerated,
// never wildcarded, exactly like DOC_URLS: a new post has to be added here or
// it simply is not available offline, which is the failure everyone prefers.
var BLOG_URLS = [
  // The index and every article.
  '/blog',
  '/blog/ai-driven-human-assisted',
  '/blog/automating-email-replies-with-n8n',
  '/blog/character-over-career-the-choices-i-live-by',
  '/blog/how-cybercrime-cases-are-solved',
  '/blog/how-i-vibe-coded-my-website',
  '/blog/how-to-stand-out-in-an-internship-interview',
  '/blog/how-to-succeed-in-software-development',
  '/blog/i-open-sourced-my-ai-sdr',
  '/blog/india-it-act-explained',
  '/blog/my-career-story-from-classroom-to-research-and-ai',
  '/blog/security-compliance-explained',
  '/blog/smart-feedback-how-to-give-and-receive-it',
  '/blog/the-four-ms-every-business-needs',
  '/blog/the-resume-builder-paywall-trick',
  '/blog/types-of-cyberattacks',
  '/blog/what-a-marriage-biodata-leaks',
  '/blog/what-is-a-fork-bomb',
  '/blog/what-running-internship-cohorts-taught-me-about-mentorship',
  '/blog/which-ai-tool-for-which-job',
  '/blog/scoping-work-before-you-quote-it',
  '/blog/passwords-passkeys-and-what-actually-protects-you',
  '/blog/finding-the-right-career',
  '/blog/the-life-of-the-buddha',
  '/blog/types-of-love-and-choosing-a-life-partner',
  '/blog/what-happens-after-we-die',
  // Blog-only stylesheet and scripts. main.css, labs.css, boot.js, theme.js,
  // include-partials.js, site-search.js, particle-bg.js, the partials and the
  // icons are already on DOC_URLS above, so they are deliberately not repeated
  // here — the fetch handler routes each path to whichever cache holds it.
  '/assets/css/blog.css',
  '/assets/js/blog-index.js',
  '/assets/js/blog-toc.js',
  '/assets/js/blog-share.js',
  // Cover art and in-article diagrams, read straight off the post sources.
  '/assets/images/blog/scoping-work-cover.svg',
  '/assets/images/blog/passkeys-cover.svg',
  '/assets/images/blog/finding-career-cover.svg',
  '/assets/images/blog/buddha-life-cover.svg',
  '/assets/images/blog/love-partner-cover.svg',
  '/assets/images/blog/after-death-cover.svg',
  '/assets/images/blog/ai-driven-cover.svg',
  '/assets/images/blog/ai-driven-matrix.svg',
  '/assets/images/blog/ai-sdr-cover.svg',
  '/assets/images/blog/ai-tools-cover.svg',
  '/assets/images/blog/attack-types-cover.svg',
  '/assets/images/blog/automating-email-replies-with-n8n-diagram1.svg',
  '/assets/images/blog/biodata-leaks-cover.svg',
  '/assets/images/blog/career-story-cover.svg',
  '/assets/images/blog/character-over-career-the-choices-i-live-by-diagram1.svg',
  '/assets/images/blog/compliance-cover.svg',
  '/assets/images/blog/cybercrime-case-cover.svg',
  '/assets/images/blog/fork-bomb-cover.svg',
  '/assets/images/blog/four-ms-cover.svg',
  '/assets/images/blog/four-steps-cover.svg',
  '/assets/images/blog/how-cybercrime-cases-are-solved-diagram1.svg',
  '/assets/images/blog/how-to-stand-out-in-an-internship-interview-diagram1.svg',
  '/assets/images/blog/how-to-succeed-in-software-development-diagram1.svg',
  '/assets/images/blog/india-it-act-explained-diagram1.svg',
  '/assets/images/blog/india-it-cover.svg',
  '/assets/images/blog/instantly-workflow.svg',
  '/assets/images/blog/interview-cover.svg',
  '/assets/images/blog/left-side-cover.svg',
  '/assets/images/blog/mentorship-cover.svg',
  '/assets/images/blog/my-career-story-from-classroom-to-research-and-ai-diagram1.svg',
  '/assets/images/blog/n8n-automation-cover.svg',
  '/assets/images/blog/resume-paywall-cover.svg',
  '/assets/images/blog/security-compliance-explained-diagram1.svg',
  '/assets/images/blog/smart-feedback-cover.svg',
  '/assets/images/blog/smart-feedback-how-to-give-and-receive-it-diagram1.svg',
  '/assets/images/blog/smartlead-workflow.svg',
  '/assets/images/blog/the-four-ms-every-business-needs-diagram1.svg',
  '/assets/images/blog/the-resume-builder-paywall-trick-diagram1.svg',
  '/assets/images/blog/types-of-cyberattacks-diagram1.svg',
  '/assets/images/blog/vibe-coded-cover.svg',
  '/assets/images/blog/vibe-coded-loop.svg',
  '/assets/images/blog/what-is-a-fork-bomb-diagram1.svg',
  '/assets/images/blog/what-running-internship-cohorts-taught-me-about-mentorship-diagram1.svg',
  '/assets/images/blog/which-ai-tool-for-which-job-diagram1.svg',
  '/assets/images/blog/which-ai-tool-for-which-job-diagram2.svg',
  '/assets/images/blog/which-ai-tool-for-which-job-diagram3.svg',
  '/assets/images/blog/which-ai-tool-for-which-job-diagram4.svg'
];

var BLOG_SET = {};
BLOG_URLS.forEach(function (u) { BLOG_SET[u] = true; });

// The arcade. Unlike the two lists above this is matched by PREFIX, and the
// difference is deliberate.
//
// DOC_URLS and BLOG_URLS are enumerated because both are precached on
// install: the promise there is "it works even if you have never opened it",
// and a promise like that has to name what it covers. /games cannot make that
// promise honestly. There are dozens of game pages and the number only grows,
// so precaching them would mean every visitor to any page on this site paying
// a multi-megabyte download for an arcade they may never open — on mobile
// data, uninvited. That is exactly the behaviour the labs section refuses to
// have, and it would be worse here because a game is not why most people came.
//
// So games are cached on USE instead. Open one and it stays: the page, the
// shared stylesheet, the shell and that game's own module all match the rules
// below, so they are kept the moment they are first fetched, and the game
// works with no network from then on. Nothing is downloaded for a game
// nobody has played. /offline says exactly this rather than implying more.
var GAME_CACHE = 'games-v1';

function isGamePath(pathname) {
  if (pathname === '/games' || pathname.indexOf('/games/') === 0) return true;
  if (pathname.indexOf('/assets/js/games/') === 0) return true;
  if (pathname === '/assets/css/games.css') return true;
  return false;
}

// Which network-first cache owns a path, or null if the fetch handler should
// leave the request alone. One lookup keeps the lists from growing separate
// copies of the same fetch logic.
function netFirstCacheFor(pathname) {
  if (DOC_SET[pathname]) return DOC_CACHE;
  if (BLOG_SET[pathname]) return BLOG_CACHE;
  if (isGamePath(pathname)) return GAME_CACHE;
  return null;
}

// A Response that arrived via a redirect cannot legally answer a navigation
// request later (the browser throws), so rebuild it as a plain 200 before it
// goes into the cache. Non-redirected responses pass through untouched.
function stripRedirect(response) {
  if (!response.redirected) return Promise.resolve(response);
  return response.blob().then(function (body) {
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: response.headers
    });
  });
}

self.addEventListener('install', function (event) {
  // The runtimes are still NOT precached: they are fetched on demand, and
  // precaching 90 MB on first page view is exactly what the lazy loading is
  // designed to avoid. Only the two enumerated lists go in now — the doc-maker
  // files, a few hundred KB, and the blog at about 1 MB. Both are the price of
  // a "works offline" promise those pages make in print.
  event.waitUntil(
    Promise.all([
      precache(DOC_CACHE, DOC_URLS),
      precache(BLOG_CACHE, BLOG_URLS)
    ])
  );
  self.skipWaiting();
});

// Shared by both precached sets. Deliberately not cache.addAll(): addAll is
// all-or-nothing, so one 404 (say, an icon missing on a local preview) would
// fail the entire install and take the vendor caching down with it. Each file
// is fetched on its own and a miss is simply skipped — that URL falls back to
// plain network behaviour until a later install catches it.
function precache(name, urls) {
  return caches.open(name).then(function (cache) {
    return Promise.all(urls.map(function (u) {
      // {cache: 'no-cache'} forces a conditional request to the server.
      // Without it, /assets/(js|css) and /partials/ answers could come
      // silently from the browser's HTTP cache — fresh for an hour, usable
      // for a day under stale-while-revalidate — and an install landing
      // right after a deploy would freeze new HTML beside a stale tool
      // script as the offline pair. Roughly 85 conditional GETs across both
      // lists, once per install.
      return fetch(u, { cache: 'no-cache' }).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          return stripRedirect(response).then(function (clean) {
            return cache.put(u, clean);
          });
        }
        return null;
      }).catch(function () { return null; });
    }));
  });
}

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          // Only ever touch caches this worker owns: the two prefixes below
          // and nothing else, so any future cache another feature creates
          // survives this cleanup untouched.
          if (name.indexOf('lab-runtimes-') === 0 && name !== CACHE) {
            return caches.delete(name);
          }
          if (name.indexOf('doc-makers-') === 0 && name !== DOC_CACHE) {
            return caches.delete(name);
          }
          if (name.indexOf('blog-offline-') === 0 && name !== BLOG_CACHE) {
            return caches.delete(name);
          }
          if (name.indexOf('games-') === 0 && name !== GAME_CACHE) {
            return caches.delete(name);
          }
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf(PREFIX) === 0) {
    // Cache-first: a hit is always the fastest answer, and this cache is the
    // authoritative copy — which is exactly why the miss path fetches with
    // {cache: 'reload'}. The vendor paths carry no version and are served
    // with a one-year immutable Cache-Control, so a plain fetch after a CACHE
    // bump would be answered by the browser's HTTP cache and re-freeze the
    // old runtime bytes; 'reload' goes to the server every time this cache
    // needs filling. First-ever downloads hit the network either way, so the
    // only extra cost lands on a refill after a bump or a user purge — both
    // moments where fresh bytes are the point.
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit;
          // request.url rather than the Request object: rebuilding a Request
          // with an init dict is rejected for some request modes, and a fresh
          // same-origin GET is all a static file needs.
          return fetch(request.url, { cache: 'reload' }).then(function (response) {
            // Only store complete, successful responses. A 206 or an opaque
            // response would poison the cache with something unusable.
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(request, response.clone());
            }
            return response;
          });
        });
      })
    );
    return;
  }

  var netFirst = netFirstCacheFor(url.pathname);
  if (netFirst) {
    // NETWORK-FIRST, and only for the exact URLs on the doc-maker list.
    // The order matters: try the network, and on success refresh the cached
    // copy and hand the live response to the page — so while online this
    // path is byte-identical to having no worker at all, never stale. Only
    // when fetch itself rejects (offline, DNS gone, server unreachable) does
    // the last good copy answer instead. Keyed by pathname, not the full
    // request, so a ?utm= visit still finds the precached entry.
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          // Refresh in the background; a cache write failure must never
          // break the page, so it is swallowed.
          event.waitUntil(
            caches.open(netFirst).then(function (cache) {
              return stripRedirect(copy).then(function (clean) {
                return cache.put(url.pathname, clean);
              });
            }).catch(function () {})
          );
        }
        return response;
      }).catch(function () {
        return caches.open(netFirst).then(function (cache) {
          return cache.match(url.pathname);
        }).then(function (hit) {
          if (hit) return hit;
          // A miss here means offline for a page this device never stored —
          // a game nobody opened, a post written since the last visit. That
          // request is handled up here rather than by the navigate branch
          // below, because these paths match a net-first list first, so
          // without this line they produced the browser's own "site cannot be
          // reached" screen while /offline sat precached and unused two
          // branches away. Only navigations get the document: an uncached
          // SCRIPT must still fail as a script, since answering it with HTML
          // would turn a missing file into a syntax error.
          if (request.mode === 'navigate') {
            return caches.open(DOC_CACHE).then(function (docs) {
              return docs.match('/offline');
            }).then(function (page) {
              return page || Response.error();
            });
          }
          return Response.error();
        });
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    // NETWORK-ONLY with a fallback, never a cache. While the network works
    // this is byte-identical to having no worker: the live response, straight
    // through, nothing stored. Only when fetch itself rejects — the installed
    // app opened in airplane mode, DNS gone — does the precached /offline
    // document answer, so a standalone window shows a branded page with a
    // way back instead of the browser's error screen. A cache miss here
    // (offline before the first install finished) falls through to
    // Response.error(), which reproduces the plain failure the page would
    // have seen anyway. No init dict on this fetch: reconstructing a
    // navigation-mode Request with one throws.
    event.respondWith(
      fetch(request).catch(function () {
        return caches.open(DOC_CACHE).then(function (cache) {
          return cache.match('/offline');
        }).then(function (hit) {
          return hit || Response.error();
        });
      })
    );
    return;
  }

  // Everything else: untouched, exactly as before.
});

/* The page asks for a size report or a purge through postMessage, because it
   cannot enumerate this cache itself as cheaply. */
self.addEventListener('message', function (event) {
  var data = event.data || {};
  var reply = function (payload) {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
  };

  if (data.type === 'lab-cache-stats') {
    caches.open(CACHE).then(function (cache) {
      return cache.keys().then(function (keys) {
        return Promise.all(keys.map(function (req) {
          return cache.match(req).then(function (res) {
            if (!res) return 0;
            // content-length is the WIRE size. When the response arrived
            // compressed, the cache stores — and storage.estimate() counts —
            // the decompressed body, which can be twice the header's figure
            // for the .js and .json payloads. So the header is only trusted
            // for identity-encoded responses; compressed ones are measured
            // for real. blob() does not double the memory cost: the body is
            // already in cache storage and Blobs can stay disk-backed.
            var enc = (res.headers.get('content-encoding') || '').toLowerCase();
            var len = res.headers.get('content-length');
            if (len && (enc === '' || enc === 'identity')) return parseInt(len, 10) || 0;
            return res.clone().blob().then(function (b) { return b.size; });
          });
        })).then(function (sizes) {
          reply({
            files: keys.length,
            bytes: sizes.reduce(function (a, b) { return a + b; }, 0)
          });
        });
      });
    }).catch(function () { reply({ files: 0, bytes: 0 }); });
    return;
  }

  /* Is ONE runtime already on this machine? The panel used to tell every
     visitor a language was "N MB to download on the first run" whether or not
     it had been downloaded months ago — the cache was doing its job and the
     page denied it. lab-cache-stats cannot answer this: it totals the whole
     cache, so it says yes for Python when only Ruby was ever fetched.
     Matching on the directory prefix rather than a named file means a runtime
     whose file list changes upstream still reports correctly. */
  if (data.type === 'lab-cache-has') {
    var dir = String(data.dir || '');
    if (!dir) { reply({ cached: false }); return; }
    caches.open(CACHE).then(function (cache) {
      return cache.keys();
    }).then(function (keys) {
      var want = PREFIX + dir + '/';
      var hit = keys.some(function (req) {
        // Compare pathnames, not whole URLs: the cache holds absolute URLs and
        // the origin differs between the deployed site and a local preview.
        try { return new URL(req.url).pathname.indexOf(want) === 0; }
        catch (e) { return false; }
      });
      reply({ cached: hit });
    }).catch(function () { reply({ cached: false }); });
    return;
  }

  if (data.type === 'lab-cache-clear') {
    caches.delete(CACHE)
      .then(function (ok) { reply({ cleared: !!ok }); })
      .catch(function () { reply({ cleared: false }); });
  }
});

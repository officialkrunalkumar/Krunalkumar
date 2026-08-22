/* ==========================================================================
   sw.js — a deliberately tiny service worker: Labs runtimes, plus an offline
   copy of the two document makers. Nothing else.
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

   SCOPE IS STILL THE WHOLE POINT. The fetch handler touches exactly two
   kinds of request and returns early for everything else, so the rest of the
   site — every page, its CSS, its JS, analytics — behaves exactly as if no
   worker existed. A service worker that quietly caches a whole site's HTML
   is a support nightmare (the "why does the old page keep coming back" kind),
   and this one still refuses to be that.

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

   It also has to be a service worker rather than a fetch wrapper, because the
   requests needing interception are not ours to wrap: Pyodide fetches its own
   .wasm and stdlib internally, and importScripts() bypasses any shim. Only a
   service worker sees those.
   ========================================================================== */

'use strict';

// Bump the suffix to invalidate every cached runtime at once — e.g. after
// upgrading Pyodide. Old caches are deleted on activate.
var CACHE = 'lab-runtimes-v1';
var PREFIX = '/assets/vendor/';

// Bump this one when the doc-maker file list changes, or to force every
// visitor onto fresh copies after a layout rework. Old versions are deleted
// on activate, same as the runtimes cache.
var DOC_CACHE = 'doc-makers-v1';

// The complete, hand-enumerated set of files the two document makers need to
// render and function with no network at all. Read straight off the two page
// sources — if a page grows a new stylesheet or script, it must be added here
// or offline quietly breaks. Clean URLs (no .html) because that is what the
// browser actually requests on this host, and what include-partials.js fetches.
var DOC_URLS = [
  // The two pages themselves.
  '/labs/resume-maker',
  '/labs/biodata-maker',
  // Their stylesheets: sitewide, labs-shared, and one per tool.
  '/assets/css/main.css',
  '/assets/css/labs.css',
  '/assets/css/resume-maker.css',
  '/assets/css/biodata-maker.css',
  // Sitewide scripts both pages load in <head>/<body>.
  '/assets/js/boot.js',
  '/assets/js/theme.js',
  '/assets/js/include-partials.js',
  '/assets/js/site-search.js',
  '/assets/js/particle-bg.js',
  // The tools themselves.
  '/assets/js/labs/tools/resume-maker.js',
  '/assets/js/labs/tools/biodata-maker.js',
  // include-partials.js swaps the static chrome for these at runtime.
  '/partials/header',
  '/partials/footer',
  // Icons, manifest, and the two images the pages actually paint (the footer
  // logo arrives via the footer partial).
  '/favicon.ico',
  '/favicon.svg',
  '/site.webmanifest',
  '/assets/images/apple-touch-icon.png',
  '/assets/images/logo-64.jpg'
];

// O(1) membership test for the fetch handler; the array above is for install.
var DOC_SET = {};
DOC_URLS.forEach(function (u) { DOC_SET[u] = true; });

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
  // designed to avoid. Only the doc-maker files above go in now — a few
  // hundred KB, the price of the "works offline" promise those pages make.
  //
  // Deliberately not cache.addAll(): addAll is all-or-nothing, so one 404
  // (say, an icon missing on a local preview) would fail the entire install
  // and take the vendor caching down with it. Each file is fetched on its
  // own and a miss is simply skipped — that URL falls back to plain network
  // behaviour until a later install catches it.
  event.waitUntil(
    caches.open(DOC_CACHE).then(function (cache) {
      return Promise.all(DOC_URLS.map(function (u) {
        return fetch(u).then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            return stripRedirect(response).then(function (clean) {
              return cache.put(u, clean);
            });
          }
          return null;
        }).catch(function () { return null; });
      }));
    })
  );
  self.skipWaiting();
});

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
    // Cache-first: these files are version-pinned and never change in place,
    // so a hit is always correct and always the fastest answer.
    event.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit;
          return fetch(request).then(function (response) {
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

  if (DOC_SET[url.pathname]) {
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
            caches.open(DOC_CACHE).then(function (cache) {
              return stripRedirect(copy).then(function (clean) {
                return cache.put(url.pathname, clean);
              });
            }).catch(function () {})
          );
        }
        return response;
      }).catch(function () {
        return caches.open(DOC_CACHE).then(function (cache) {
          return cache.match(url.pathname);
        }).then(function (hit) {
          // A miss here means offline before the first successful install —
          // Response.error() reproduces the plain network failure the page
          // would have seen anyway.
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
            // content-length avoids buffering 31 MB just to measure it;
            // fall back to reading the body only when the header is absent.
            var len = res.headers.get('content-length');
            if (len) return parseInt(len, 10) || 0;
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

  if (data.type === 'lab-cache-clear') {
    caches.delete(CACHE)
      .then(function (ok) { reply({ cleared: !!ok }); })
      .catch(function () { reply({ cleared: false }); });
  }
});

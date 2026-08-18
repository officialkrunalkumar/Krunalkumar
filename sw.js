/* ==========================================================================
   sw.js — a deliberately tiny service worker, for the Labs runtimes only.
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

   SCOPE IS THE WHOLE POINT. The fetch handler returns early for anything that
   is not a same-origin /assets/vendor/ request, so pages, CSS, the site's own
   JS and analytics all behave exactly as they did before — no offline-first
   behaviour, no stale HTML, nothing else intercepted. A service worker that
   quietly caches a site's HTML is a support nightmare; this one refuses to.

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

self.addEventListener('install', function (event) {
  // Nothing is precached: runtimes are fetched on demand, and precaching 90 MB
  // on first page view is exactly what the lazy loading is designed to avoid.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          // Only ever touch caches this worker owns.
          if (name.indexOf('lab-runtimes-') === 0 && name !== CACHE) {
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
  if (url.pathname.indexOf(PREFIX) !== 0) return;

  // Cache-first: these files are version-pinned and never change in place, so
  // a hit is always correct and always the fastest answer.
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

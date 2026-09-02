/* ==========================================================================
   sw.js — a deliberately small service worker: Labs runtimes, a tiny offline
   shell, and a cache of whatever this visitor has actually opened.
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

   THE CACHING POLICY, decided by the site owner (2026-09). Three branches,
   and every request falls into exactly one:

   1. INSTALL PRECACHES THE OFFLINE SHELL ONLY: /offline, the script that
      builds its lists, and the icon it links — a few tens of KB, enumerated
      in SHELL_URLS below. This worker used to precache far more: two
      hand-kept lists (DOC_URLS and BLOG_URLS) naming the two document
      makers, the entire blog and all of its art — about 4.5 MB raw dropped
      on every first-time visitor in the background, invited or not. Both
      lists are gone, deliberately, because hand-kept precache lists drift:
      the blog list quietly fell 49 images behind the posts it promised, and
      fixing that took a build gate, a generator, and a growing per-install
      download that only ever got bigger with each post. A cache that holds
      only what was actually fetched cannot drift by construction, and the
      first-visit background download drops from ~4.5 MB to those tens of KB.

   2. EVERYTHING ELSE SAME-ORIGIN IS CACHED ON USE, network-first. A page you
      open, the stylesheets and scripts and images it pulls in — each is kept
      the moment it is successfully fetched, so what a visitor has opened
      works offline and what they never opened does not. Network-first is
      what keeps this honest: while you are online every response comes live
      from the network, byte-identical to having no worker at all, and the
      cached copy is silently refreshed behind it; only when the fetch itself
      fails does the last good copy answer. A stale page can never be shown
      to a visitor who could have fetched a fresh one — cache-first HTML is
      the "why does the old page keep coming back" support nightmare, and a
      cache that is only ever a fallback is not. The games section already
      worked exactly this way; this branch is that pattern applied to the
      whole site instead of a third hand-kept list saying which paths deserve
      it.

      A CANCELLED PROMISE, stated so nobody restores it by accident: the
      resume maker and the marriage biodata maker used to be precached so
      they worked offline whether or not you had ever opened them, because
      their pages said so in print. The owner cancelled that promise when the
      precache lists went. They now work offline exactly like every other
      page — after one live visit — and any copy still claiming more is prose
      to fix, not a list to reintroduce here. This was a decision, not an
      oversight.

   3. LAB RUNTIMES (/assets/vendor/) ARE UNTOUCHED BY ALL OF THE ABOVE:
      cache-first in a fingerprint-versioned cache, fetched on demand, never
      precached. The rationale lives on the constants below.

   Navigations that miss both the network and the cache — a page this device
   never opened, requested in airplane mode — get the precached /offline
   document instead of the browser's raw error inside a chromeless standalone
   window. That page reads Cache Storage and lists what genuinely works, so
   the offline experience describes itself instead of promising.

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

// Set once the first vendor cache.put() rejects — in practice that means the
// browser refused the write, and for files this size the refusal is almost
// always storage quota. One console.warn per worker lifetime is the whole
// point of the flag: enough to make the failure findable in devtools, without
// repeating it for every one of the dozens of files a runtime pulls in.
var vendorPutWarned = false;

// The offline shell. Bump the version when SHELL_URLS changes or /offline is
// reworked; old versions are deleted on activate, same as the runtimes cache.
var SHELL_CACHE = 'offline-shell-v1';

// The COMPLETE install-time precache: the /offline document and exactly the
// static assets it references, nothing more. This is the one enumerated list
// this worker still carries, and it stays this short on purpose — three
// files a build gate (scripts/build.js, "sw precache gate") holds to two
// invariants: every entry here resolves to a real file, and every asset
// /offline references appears here. A list of three that a machine checks is
// the opposite of the 200-entry lists this file used to hold, which no
// machine could keep honest without generating them.
var SHELL_URLS = [
  // The navigation fallback itself. Self-contained by design — inline CSS,
  // inline SVG — so precaching it plus the two files below is enough to keep
  // an offline launch branded instead of showing the browser's error page.
  '/offline',
  // The offline page's own script. It builds that page's lists from what is
  // really in these caches, so it has to be here or the page can only fall
  // back to claiming nothing.
  '/assets/js/offline.js',
  // The one asset /offline links from its markup: its icon.
  '/favicon.svg'
];

// Everything cached on use lands here: pages, stylesheets, scripts, images —
// whatever a visit actually fetched. Bump the version to force every visitor
// onto a cold cache after a rework; it refills as they browse, which is the
// whole point of on-use caching — losing this cache costs nobody anything
// they cannot get back by doing what filled it the first time.
var PAGE_CACHE = 'pages-v1';

// The one page the on-use cache must NEVER store. The hack-lab guestbook is
// a deliberately-vulnerable sandbox document, and vercel.json serves it with
// Cache-Control: no-store precisely so no copy of it outlives the exercise.
// A PAGE_CACHE entry would quietly undo that header: the vulnerable document
// would keep answering from this cache after the server copy was patched or
// taken down, turning a scoped sandbox into a persistent one. Every write
// into PAGE_CACHE checks this predicate so the exclusion cannot be forgotten
// on one branch.
function isGuestbook(pathname) {
  return pathname === '/labs/hacklab-guestbook' ||
    pathname.indexOf('/labs/hacklab-guestbook/') === 0;
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
  // designed to avoid. Only the offline shell goes in — three files, a few
  // tens of KB, the smallest set that keeps an airplane-mode launch of the
  // installed app on a branded page instead of a browser error.
  event.waitUntil(precache(SHELL_CACHE, SHELL_URLS));
  self.skipWaiting();
});

// Deliberately not cache.addAll(), but STRICT all the same: each file is
// fetched on its own (addAll gives no way to say WHICH url failed), and any
// failure — a rejected fetch or a non-200 — rejects the whole install. That
// strictness matters because install runs exactly once per worker version: a
// worker that activated with a partial shell would keep that hole until the
// next deploy, silently breaking the offline fallback. A failed install, by
// contrast, is retried by the browser on a later navigation or update check,
// so a transient network blip costs a retry instead of the shell. Three tiny
// files make the all-or-nothing bet cheap; a 404 here (say, an icon missing
// on a local preview) is a real bug the build gate should have caught, and
// failing loudly is the correct answer to it.
function precache(name, urls) {
  return caches.open(name).then(function (cache) {
    return Promise.all(urls.map(function (u) {
      // {cache: 'no-cache'} forces a conditional request to the server.
      // Without it, the answers could come silently from the browser's HTTP
      // cache — fresh for an hour, usable for a day under
      // stale-while-revalidate — and an install landing right after a deploy
      // would freeze a stale copy as the offline shell. Three conditional
      // GETs, once per install; the old lists made this ~210.
      return fetch(u, { cache: 'no-cache' }).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          return stripRedirect(response).then(function (clean) {
            return cache.put(u, clean);
          });
        }
        // Reject rather than skip: see the strictness rationale above.
        throw new Error('sw.js: shell precache got ' +
          (response ? response.status + '/' + response.type : 'no response') +
          ' for ' + u);
      });
    }));
  });
}

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          // Only ever touch caches this worker owns: the prefixes below and
          // nothing else, so any future cache another feature creates
          // survives this cleanup untouched.
          //
          // Known trade-off, accepted: deleting the old runtimes cache the
          // moment the new worker activates means a page from the PREVIOUS
          // deploy that is still open can see its runtime swap mid-session —
          // its next vendor fetch misses and refills under the new
          // fingerprint. Documented rather than fixed, because the fix is
          // keeping two full multi-hundred-MB runtime caches alive side by
          // side, and that costs every device real disk for a mixed session
          // that is rare and ends at the next reload anyway.
          if (name.indexOf('lab-runtimes-') === 0 && name !== CACHE) {
            return caches.delete(name);
          }
          if (name.indexOf('offline-shell-') === 0 && name !== SHELL_CACHE) {
            return caches.delete(name);
          }
          if (name.indexOf('pages-') === 0 && name !== PAGE_CACHE) {
            return caches.delete(name);
          }
          // The three caches the PREVIOUS policy kept: the precached doc
          // makers, the precached blog, and the on-use games cache. All three
          // are retired — the first two because their install-time lists were
          // abolished (see the header), the games cache because its on-use
          // pattern became the sitewide PAGE_CACHE above. Dropping them costs
          // a returning visitor their old offline copies once; everything
          // they actually open refills PAGE_CACHE on use, which is the deal
          // the new policy makes everywhere.
          if (name.indexOf('doc-makers-') === 0) return caches.delete(name);
          if (name.indexOf('blog-offline-') === 0) return caches.delete(name);
          if (name.indexOf('games-') === 0) return caches.delete(name);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
      // Backfill the on-use cache with the pages that are ALREADY open. The
      // very first page of a first-ever visit is fetched before any worker
      // exists to see it, so on-use caching alone never stores it — the one
      // page the visitor has provably opened would be the one page that does
      // not work offline. Re-fetching each claimed window's current URL here
      // closes that "works offline after the first visit" gap for the
      // landing page itself. Same success checks as the on-use branch (200 +
      // 'basic', redirects flattened, guestbook excluded, keyed by
      // pathname); failures are simply ignored, because this is best-effort
      // backfill of pages the visitor can refill by reloading.
      .then(function () {
        return self.clients.matchAll({ type: 'window' }).then(function (wins) {
          return caches.open(PAGE_CACHE).then(function (cache) {
            return Promise.all(wins.map(function (win) {
              var url;
              try { url = new URL(win.url); } catch (err) { return null; }
              if (url.origin !== self.location.origin) return null;
              if (isGuestbook(url.pathname)) return null;
              return fetch(url.pathname).then(function (response) {
                if (response && response.status === 200 && response.type === 'basic') {
                  return stripRedirect(response).then(function (clean) {
                    return cache.put(url.pathname, clean);
                  });
                }
                return null;
              }).catch(function () { return null; });
            }));
          });
        }).catch(function () {});
      })
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
              // put() rejects when Cache Storage will not take the bytes —
              // quota, usually, and these are the largest files on the site.
              // Left unhandled, that rejection is both invisible and
              // expensive: the cache never fills, so every visit re-downloads
              // the runtime in full, and the {cache:'reload'} above means not
              // even the HTTP cache softens it. The page already has its
              // response either way, so degrade quietly — but warn once (see
              // vendorPutWarned) so "why does Python download every time" is
              // answerable from the console instead of being a mystery.
              cache.put(request, response.clone()).catch(function (err) {
                if (!vendorPutWarned) {
                  vendorPutWarned = true;
                  console.warn('sw.js: vendor cache write failed (storage quota?); runtimes will be re-fetched from the network on each visit.', err);
                }
              });
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // Every other same-origin GET: NETWORK-FIRST, CACHED ON USE. This is the
  // whole of policy point 2 in the header. The order matters: try the
  // network, and on success refresh the cached copy and hand the live
  // response to the page — so while online this path is byte-identical to
  // having no worker at all, never stale. Only when fetch itself rejects
  // (offline, DNS gone, server unreachable) does the last good copy answer.
  // Keyed by pathname, not the full request, so a ?utm= visit refreshes and
  // finds the same entry a plain one does.
  //
  // Only complete first-party successes are stored — the same 200 + 'basic'
  // guard the vendor branch uses — so a 404, a 206 range slice or an opaque
  // response can never become this device's permanent copy of a page.
  event.respondWith(
    fetch(request).then(function (response) {
      // isGuestbook: the sandbox page is served no-store and must not gain a
      // service-worker copy either — see the predicate's comment.
      if (response && response.status === 200 && response.type === 'basic' &&
          !isGuestbook(url.pathname)) {
        var copy = response.clone();
        // Refresh in the background; a cache write failure must never
        // break the page, so it is swallowed.
        event.waitUntil(
          caches.open(PAGE_CACHE).then(function (cache) {
            return stripRedirect(copy).then(function (clean) {
              return cache.put(url.pathname, clean);
            });
          }).catch(function () {})
        );
      }
      return response;
    }).catch(function () {
      return caches.open(PAGE_CACHE).then(function (cache) {
        return cache.match(url.pathname);
      }).then(function (hit) {
        if (hit) return hit;
        // Not in the on-use cache — but the offline shell's own three files
        // live in SHELL_CACHE, and /offline must be reachable by typing its
        // URL even on a device that has never visited it while online.
        return caches.open(SHELL_CACHE).then(function (shell) {
          return shell.match(url.pathname);
        }).then(function (shellHit) {
          if (shellHit) return shellHit;
          // Offline, and this device never stored the file — a page nobody
          // opened, a post written since the last visit. Only navigations
          // get the /offline document: an uncached SCRIPT must still fail
          // as a script, since answering it with HTML would turn a missing
          // file into a syntax error.
          if (request.mode === 'navigate') {
            return caches.open(SHELL_CACHE).then(function (docs) {
              return docs.match('/offline');
            }).then(function (page) {
              return page || Response.error();
            });
          }
          return Response.error();
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

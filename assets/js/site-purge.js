/* ==========================================================================
   site-purge.js — removes everything this origin has stored on the device.
   Loaded only by /privacy, where the control lives.
   --------------------------------------------------------------------------
   WHAT IT CAN AND CANNOT REACH. Only this origin. A page has no way to read
   or delete another site's storage, so "delete site data" here means
   krunalkumar.dpdns.org and nothing else — not the browser, not other tabs,
   not anything you have stored anywhere else. That is a guarantee of the
   same-origin policy rather than a promise of this file, which is the
   stronger kind.

   WHY IT EXISTS. This site is a progressive web app: a service worker
   installs on the first visit and caches pages on use, which is what makes
   the labs work in airplane mode. It also means someone who opened the site
   once has a worker and a cache they did not explicitly ask for. Offering
   the undo, on the page that documents the storage, is the honest end of
   that bargain.

   THE ONE KEY THAT SURVIVES. game.storage is the opt-out flag: its presence
   is how a visitor says "do not keep scores on this device". Clearing it
   along with everything else would silently turn storage back ON for exactly
   the person who had turned it off — a purge that quietly reverses a privacy
   choice is worse than no purge. It is read before the wipe and written back
   after, and it is the only exception.

   FOUR STORES, NOT ONE. localStorage is the obvious one and the least of it.
   The service worker registration, the Cache Storage entries it filled, and
   any IndexedDB databases all outlive a localStorage.clear() and all of them
   are why a stale page can keep being served after you thought you were rid
   of it. Each step is guarded on its own: a browser that refuses one (private
   mode, an old engine, a blocked API) must still complete the others rather
   than throwing halfway and leaving the device half-cleared.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

(function () {
  'use strict';

  var btn = document.getElementById('purge-run');
  var out = document.getElementById('purge-out');
  if (!btn || !out) return;

  var OPT_OUT = 'game.storage';
  var armed = false;
  var IDLE = 'Delete this site’s data';
  var ARMED = 'Tap again to confirm';

  function say(text) { out.textContent = text; }

  /* Every step resolves rather than rejects. One unavailable API must not
     stop the rest, and the report at the end should say what actually
     happened rather than what was attempted. */

  function wipeLocal() {
    var kept = null;
    var n = 0;
    try {
      kept = localStorage.getItem(OPT_OUT);
      n = localStorage.length;
      localStorage.clear();
      if (kept !== null) localStorage.setItem(OPT_OUT, kept);
    } catch (e) { return 0; }
    try { sessionStorage.clear(); } catch (e) { /* blocked independently */ }
    return kept !== null ? Math.max(0, n - 1) : n;
  }

  function wipeCaches() {
    if (!window.caches || !caches.keys) return Promise.resolve(0);
    return caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return caches.delete(k)['catch'](function () { return false; });
      })).then(function (results) {
        var n = 0;
        for (var i = 0; i < results.length; i++) if (results[i]) n++;
        return n;
      });
    })['catch'](function () { return 0; });
  }

  function wipeWorkers() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) {
      return Promise.resolve(0);
    }
    return navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all(regs.map(function (r) {
        return r.unregister()['catch'](function () { return false; });
      })).then(function (results) {
        var n = 0;
        for (var i = 0; i < results.length; i++) if (results[i]) n++;
        return n;
      });
    })['catch'](function () { return 0; });
  }

  /* indexedDB.databases() is not in Firefox, so an empty answer here means
     "could not enumerate", not "there were none". Nothing on this site
     writes IndexedDB today; the step is here so that the day something does,
     this control does not quietly stop being complete. */
  function wipeDatabases() {
    if (!window.indexedDB || !indexedDB.databases) return Promise.resolve(0);
    return indexedDB.databases().then(function (dbs) {
      return Promise.all((dbs || []).map(function (db) {
        if (!db || !db.name) return Promise.resolve(false);
        return new Promise(function (resolve) {
          var req = indexedDB.deleteDatabase(db.name);
          req.onsuccess = function () { resolve(true); };
          req.onerror = function () { resolve(false); };
          req.onblocked = function () { resolve(false); };
        });
      })).then(function (results) {
        var n = 0;
        for (var i = 0; i < results.length; i++) if (results[i]) n++;
        return n;
      });
    })['catch'](function () { return 0; });
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  btn.addEventListener('click', function () {
    if (!armed) {
      armed = true;
      btn.textContent = ARMED;
      btn.setAttribute('aria-live', 'polite');
      say('This removes every key, cache and worker this site has put on this device, including your theme and any lab or game progress. It cannot be undone, and it affects this site only.');
      /* Disarm on its own. A destructive button left cocked is one somebody
         presses later without remembering what it was for. */
      window.setTimeout(function () {
        if (!armed) return;
        armed = false;
        btn.textContent = IDLE;
        say('');
      }, 8000);
      return;
    }

    armed = false;
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    say('Working…');

    var keys = wipeLocal();

    Promise.all([wipeCaches(), wipeWorkers(), wipeDatabases()]).then(function (r) {
      say('Removed ' + plural(keys, 'stored key', 'stored keys')
        + ', ' + plural(r[0], 'cache', 'caches')
        + ' and ' + plural(r[1], 'service worker', 'service workers')
        + (r[2] ? ', ' + plural(r[2], 'database', 'databases') : '')
        + '. Reloading as a first-time visitor…');

      /* A hard reload, and only after the wipe has resolved. Reload too
         early and the worker that is mid-unregister can still answer the
         navigation from the cache being deleted, which looks exactly like
         the button having done nothing. */
      window.setTimeout(function () { location.reload(); }, 1200);
    });
  });
})();

/* ==========================================================================
   lab-cache.js — registers the runtime service worker and exposes the two
   things the storage panel needs: how much is cached, and a way to remove it.
   --------------------------------------------------------------------------
   Shared by lab-app.js and linux-app.js. Everything degrades quietly: if
   service workers are unavailable (private windows in some browsers, older
   Safari, an insecure origin), the labs still work — the runtimes simply fall
   back to the ordinary HTTP cache, and the panel says the figure cannot be
   measured rather than inventing one.
   ========================================================================== */

(function (root) {
  'use strict';

  var SW_URL = '/sw.js';
  var supported = ('serviceWorker' in navigator) &&
                  (location.protocol === 'https:' || location.hostname === 'localhost');

  var readyPromise = null;

  function register() {
    if (!supported) return Promise.resolve(null);
    if (readyPromise) return readyPromise;
    readyPromise = navigator.serviceWorker.register(SW_URL, { scope: '/' })
      .then(function () { return navigator.serviceWorker.ready; })
      .catch(function () { return null; });
    return readyPromise;
  }

  /* postMessage with a MessageChannel, so the answer comes back to this call
     rather than to a global listener that would have to correlate replies. */
  function ask(message, fallback) {
    return register().then(function (reg) {
      var target = (reg && reg.active) || navigator.serviceWorker.controller;
      if (!target) return fallback;
      return new Promise(function (resolve) {
        var channel = new MessageChannel();
        var settled = false;
        var done = function (value) {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        channel.port1.onmessage = function (event) { done(event.data); };
        // A worker that is installing but not yet listening must not hang the
        // panel open with a spinner forever.
        setTimeout(function () { done(fallback); }, 3000);
        try {
          target.postMessage(message, [channel.port2]);
        } catch (err) {
          done(fallback);
        }
      });
    }).catch(function () { return fallback; });
  }

  root.LabCache = {
    supported: supported,
    register: register,

    /* -> { files, bytes } for the runtimes this site has cached. */
    stats: function () {
      return ask({ type: 'lab-cache-stats' }, { files: 0, bytes: 0, unavailable: true });
    },

    /* -> { cached } for ONE runtime, named by its directory under
       /assets/vendor/ (e.g. 'pyodide'). stats() cannot answer this — it totals
       the cache, so it reports a hit for every language once any one of them
       has been fetched. The fallback is `false` on purpose: with no service
       worker there is no runtime cache either, so "not cached" is the truth,
       and a panel that promises an instant start it cannot deliver is worse
       than one that over-warns about a download. */
    has: function (dir) {
      return ask({ type: 'lab-cache-has', dir: dir }, { cached: false, unavailable: true });
    },

    /* Removes exactly this site's runtime cache. The browser's origin model
       means it cannot reach any other site's storage, and the service worker
       only ever deletes caches whose name it owns. */
    clear: function () {
      return ask({ type: 'lab-cache-clear' }, { cleared: false });
    }
  };
})(typeof self !== 'undefined' ? self : this);

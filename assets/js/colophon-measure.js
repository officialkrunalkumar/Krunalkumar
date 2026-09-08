/* ==========================================================================
   colophon-measure.js — the four figures on /colophon the site does not
   publish, because the visitor's own browser measures them instead.
   --------------------------------------------------------------------------
   Every other number on that page is something this repository asserts about
   itself: a page count, a stripped-comment percentage, a dependency count of
   zero. They are all true and all unfalsifiable from the outside, which is
   the weakness of publishing your own figures. These four are taken from the
   Performance API on the page you are looking at, so they are the one part of
   the colophon that cannot be wrong in the site's favour.

   NOTHING IS SENT ANYWHERE. There is no beacon here and no endpoint. The
   numbers are read, formatted into four spans, and forgotten when the tab
   closes. That is also why this is not a substitute for Speed Insights and is
   not trying to be: field data needs collection, and collection is exactly
   what this page is demonstrating the absence of.

   CACHE HITS ARE INFERRED, NOT REPORTED. There is no "did this come from the
   service worker" flag in a PerformanceResourceTiming. The signal is
   transferSize === 0 with a non-zero decodedBodySize: something arrived, and
   none of it crossed the network. That is also true of a memory-cache hit, so
   the figure is honestly "not fetched" rather than "served by the worker" —
   which is the number a visitor actually cares about either way.

   EVERY READ IS GUARDED. Safari shipped parts of this API late, Firefox has
   never shipped LCP, and transferSize is zero on cross-origin responses
   without Timing-Allow-Origin — so a missing value has to render as a dash
   rather than as NaN or as a confident zero. A performance page that lies
   about performance would be a poor advertisement.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

(function () {
  'use strict';

  var wrap = document.getElementById('measure-stats');
  if (!wrap || !window.performance) return;

  function set(name, text) {
    var node = wrap.querySelector('[data-measure="' + name + '"]');
    if (node) node.textContent = text;
  }

  function ms(v) {
    if (!isFinite(v) || v <= 0) return '—';
    return v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(1) + ' s';
  }

  function kb(bytes) {
    if (!isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ---- Time to first byte -------------------------------------------
     From the navigation entry, which is the modern replacement for the
     old timing object and the only one that exists in a document opened
     from the service worker with no network involved at all. */
  function ttfb() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.responseStart > 0) return set('ttfb', ms(nav.responseStart));
    } catch (e) { /* fall through */ }
    set('ttfb', '—');
  }

  /* ---- Resources: what was fetched, and what was not -----------------
     Run late rather than at DOMContentLoaded: images and deferred scripts
     are still arriving, and a count taken early reports a cache hit rate
     for a third of the page. */
  function resources() {
    var list;
    try { list = performance.getEntriesByType('resource'); } catch (e) { return; }
    if (!list || !list.length) return;

    var total = 0, cached = 0, bytes = 0, measurable = 0;

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      total++;
      /* A cross-origin response with no Timing-Allow-Origin reports every
         size as 0, which is indistinguishable from a cache hit. Only count
         entries where the body size is known. */
      var known = r.decodedBodySize > 0;
      if (known) {
        measurable++;
        if (r.transferSize === 0) cached++;
        else bytes += r.transferSize;
      }
    }

    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.transferSize > 0) bytes += nav.transferSize;
    } catch (e) { /* the document itself is a bonus, not a requirement */ }

    set('cached', measurable ? cached + ' / ' + measurable : '—');
    set('wire', measurable ? kb(bytes) : '—');
  }

  /* ---- Largest contentful paint --------------------------------------
     Buffered, so an observer registered after the paint still receives it.
     LCP can be superseded as bigger elements land, so every entry
     overwrites the last — the final one before interaction is the real
     figure, which is why this is not disconnected early. */
  function lcp() {
    if (!window.PerformanceObserver) return set('lcp', '—');
    try {
      var obs = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        if (!entries.length) return;
        var last = entries[entries.length - 1];
        set('lcp', ms(last.renderTime || last.loadTime || last.startTime));
      });
      obs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) {
      /* Firefox, and anything else without the entry type. */
      set('lcp', '—');
    }
  }

  function run() {
    ttfb();
    lcp();
    /* One idle callback after load, so late images are counted. The timeout
       matters: a tab that never goes idle would otherwise never report. */
    if (window.requestIdleCallback) requestIdleCallback(resources, { timeout: 1500 });
    else window.setTimeout(resources, 900);
  }

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();

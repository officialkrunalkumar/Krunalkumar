// Shared head bootstrap, loaded synchronously (no defer) so the `js` class
// lands before first paint — the CSS that hides the static mobile nav keys
// off it. Consolidates what every page used to carry as inline blocks:
// JS detection, the partials-failure fallback timer, the GA4 loader, and the
// Vercel Speed Insights beacon.
// One file, one edit point, and no inline scripts, so the CSP can drop
// 'unsafe-inline'. (A GTM container used to load here too; it was published
// empty — zero tags — so it cost ~314KB per page view for nothing and was
// removed. If GTM is ever wanted again, publish the container's tags first.)
(function () {
  // The visitor's theme, restored before anything paints. This has to live
  // here rather than in theme.js: theme.js is deferred, so by the time it runs
  // the page has already painted in the default dark, and a returning
  // light-theme visitor would see the wrong theme flash first. This file is
  // synchronous and sits above the stylesheet link, so the attribute is on
  // <html> before the CSS is even fetched.
  //
  // Light stays opt-in. No stored value means dark, and prefers-color-scheme
  // is deliberately not consulted — following the OS handed a light site to
  // people who never asked for one.
  // Each read is guarded on its own: if sessionStorage throws (blocked in some
  // privacy modes) a single try around all three would skip the localStorage
  // reads too, and the choice would look lost.
  function readTheme(area, key) {
    try {
      var s = window[area];
      return s ? s.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  var savedTheme =
    readTheme('sessionStorage', 'site.theme') ||   // this tab, even if localStorage is unavailable
    readTheme('localStorage', 'site.theme') ||     // every future visit
    readTheme('localStorage', 'lab.theme');        // the key this used to use

  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Bring the address-bar colour along with it. theme.js does this too, but
    // it is deferred: until it runs, a returning light-theme visitor sees a
    // dark browser chrome sitting above an already-light page. The meta tag is
    // emitted above this script in every page's head, so it is parsed and
    // queryable by the time we get here.
    //
    // Only the two site colours are overwritten, deliberately. /terminal ships
    // a #020617 that matches its own darker background and it loads this file;
    // replacing whatever we happen to find would quietly break that page.
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      var current = (themeMeta.getAttribute('content') || '').toLowerCase();
      if (current === '#121b2c' || current === '#f5f8fc') {
        themeMeta.setAttribute('content', savedTheme === 'light' ? '#f5f8fc' : '#121b2c');
      }
    }
  }

  document.documentElement.classList.add('js');
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (document.querySelector('.noscript-header')) {
        document.documentElement.classList.add('partials-failed');
      }
    }, 3000);
  });

  // Google tag (gtag.js). The stub and queued commands stay immediate so
  // every gtag() call on the page lands in the dataLayer, but the ~170KB
  // script itself waits for first interaction / idle-after-load — during
  // page load it was the single largest main-thread cost on phones
  // (Lighthouse TBT). gtag.js flushes the queue when it arrives, so the
  // pageview and any early events are still recorded.
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-2SYTX4B5TW');
  var gaLoaded = false;
  function loadAnalytics() {
    if (gaLoaded) return;
    gaLoaded = true;
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=G-2SYTX4B5TW';
    document.head.appendChild(g);
  }
  var firstTouch = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
  function onFirstInteraction() {
    firstTouch.forEach(function (name) {
      window.removeEventListener(name, onFirstInteraction, true);
    });
    loadAnalytics();
  }
  firstTouch.forEach(function (name) {
    window.addEventListener(name, onFirstInteraction, { capture: true, passive: true, once: true });
  });
  window.addEventListener('load', function () {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(loadAnalytics, { timeout: 2000 });
    } else {
      setTimeout(loadAnalytics, 250);
    }
  });
  // Failsafe: a visitor who neither interacts nor finishes loading within
  // 3.5s must still produce a pageview.
  setTimeout(loadAnalytics, 3500);

  // Vercel Speed Insights — real-user web vitals from actual visitors' devices,
  // which no lab run can substitute for. Deliberately NOT the npm package: this
  // site has zero dependencies and is keeping it that way, and Vercel serves
  // the same collector from our own origin at /_vercel/speed-insights/script.js
  // once the feature is enabled in the dashboard. Same-origin means the strict
  // CSP needs no new entries — script-src 'self' covers the file and
  // connect-src 'self' covers the beacon it posts to /_vercel/.../vitals.
  //
  // Loaded immediately rather than on-interaction like gtag above: it is a few
  // KB, and the vitals it reads (LCP, CLS, INP) come from buffered
  // PerformanceObserver entries, but the earlier it attaches the less it can
  // miss. Skipped off-Vercel — on localhost the path would just 404 into the
  // console every page view.
  var host = location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host.indexOf('.local') === -1) {
    var si = document.createElement('script');
    si.defer = true;
    si.src = '/_vercel/speed-insights/script.js';
    document.head.appendChild(si);
  }

  // Register the service worker on EVERY page, not only the lab pages that
  // load lab-cache.js. Before this, the site was only installable as a PWA
  // after a visit had passed through a lab page (Chrome wants a registered
  // worker before it offers "Install app"), so the install prompt appeared
  // and disappeared depending on browsing history — which reads as a bug to
  // anyone on a phone. Registering the same URL and scope twice is a no-op,
  // so the per-page registrations elsewhere stay harmless. After load, so it
  // never competes with the critical path.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(function () { /* private mode or unsupported: the site works identically */ });
    });
  }
})();

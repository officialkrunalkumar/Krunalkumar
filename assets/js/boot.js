// Shared head bootstrap, loaded synchronously (no defer) so the `js` class
// lands before first paint — the CSS that hides the static mobile nav keys
// off it. Consolidates what every page used to carry as inline blocks:
// JS detection, the partials-failure fallback timer, and the GA4 loader.
// One file, one edit point, and no inline scripts, so the CSP can drop
// 'unsafe-inline'. (A GTM container used to load here too; it was published
// empty — zero tags — so it cost ~314KB per page view for nothing and was
// removed. If GTM is ever wanted again, publish the container's tags first.)
(function () {
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
})();

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

  // Google tag (gtag.js)
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-2SYTX4B5TW');
  var g = document.createElement('script');
  g.async = true;
  g.src = 'https://www.googletagmanager.com/gtag/js?id=G-2SYTX4B5TW';
  document.head.appendChild(g);
})();

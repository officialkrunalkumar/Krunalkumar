// Shared head bootstrap, loaded synchronously (no defer) so the `js` class
// lands before first paint — the CSS that hides the static mobile nav keys
// off it. Consolidates what every page used to carry as three inline blocks:
// JS detection, the partials-failure fallback timer, and both analytics
// loaders (GA4 gtag + GTM — Google is configured to deduplicate). One file,
// one edit point, and no inline scripts, so the CSP can drop 'unsafe-inline'.
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

  // Google Tag Manager
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  var t = document.createElement('script');
  t.async = true;
  t.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-NTRG9KDJ';
  document.head.appendChild(t);
})();

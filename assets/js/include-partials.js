// Upgrades the static header and footer with the shared partials at runtime.
// Every page ships a complete static copy (visible from the first paint — no
// flash), which this script swaps for the canonical version in partials/,
// adding the JS-only extras (hamburger, More dropdown). The current page's
// nav link automatically receives class="active" and aria-current="page".
//
// Edit partials/header.html or partials/footer.html for the canonical markup,
// and keep the static copies in each page in sync (see README).
//
// Note: pages must be served over http(s) — fetch() does not work from file://
// URLs. Use a clean-URL-aware server (npx serve .) when previewing locally.
(function () {
  function inject(name) {
    var mount = document.getElementById(name + '-placeholder') ||
      document.querySelector(name === 'header' ? 'header.site-header' : 'footer#contact');
    if (!mount) {
      return Promise.resolve();
    }
    // Extensionless on purpose: with Vercel's cleanUrls the ".html" form costs
    // a 308 redirect round-trip on every page view.
    return fetch('/partials/' + name)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.text();
      })
      .then(function (html) {
        var template = document.createElement('template');
        template.innerHTML = html.trim();
        var element = template.content.querySelector(name);
        if (element) {
          mount.replaceWith(element);
        } else {
          // A 200 response with no matching element (captive portal, rewriting
          // proxy) is a failure too — restore the static mobile nav.
          document.documentElement.classList.add('partials-failed');
        }
      })
      .catch(function (error) {
        console.error('Could not load partial "' + name + '":', error);
        // The swap never happened, so the static chrome must stay fully
        // usable — on mobile the CSS hides the static nav list in
        // anticipation of the hamburger version, and this class re-shows it.
        document.documentElement.classList.add('partials-failed');
      });
  }

  function markActiveLink() {
    var path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '');
    if (path === '' || path === '/index') path = '/';
    var link = document.querySelector('.nav-list .nav-link[href="' + path + '"]');
    if (link) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  }

  Promise.all([inject('header'), inject('footer')]).then(function () {
    markActiveLink();
    document.dispatchEvent(new CustomEvent('partials:loaded'));
  });
})();

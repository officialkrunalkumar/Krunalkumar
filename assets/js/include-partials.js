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
// URLs. Use the dev server (python .claude/dev-server.py) when previewing.
(function () {
  function inject(name) {
    var mount = document.getElementById(name + '-placeholder') ||
      document.querySelector(name === 'header' ? 'header.site-header' : 'footer#contact');
    if (!mount) {
      return Promise.resolve();
    }
    return fetch('/partials/' + name + '.html')
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
        }
      })
      .catch(function (error) {
        console.error('Could not load partial "' + name + '":', error);
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

// Loads the shared header and footer from partials/ into every page at runtime.
// Edit partials/header.html or partials/footer.html and simply refresh — no
// build step needed. The current page's nav link automatically receives
// class="active" and aria-current="page".
//
// Note: pages must be served over http(s) — fetch() does not work from file://
// URLs. Use any local server (e.g. VS Code Live Server) when previewing.
(function () {
  function inject(name) {
    var mount = document.getElementById(name + '-placeholder');
    if (!mount) {
      return Promise.resolve();
    }
    return fetch('partials/' + name + '.html')
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
    var file = window.location.pathname.split('/').pop() || 'index.html';
    var link = document.querySelector('.nav-list .nav-link[href="' + file + '"]');
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

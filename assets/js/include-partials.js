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
  // replaceWith() detaches the static chrome outright. If a keyboard user had
  // already tabbed into it — the skip link and the nav links are the first
  // stops on every page, and the partials are still in flight for the first
  // few hundred ms — the browser drops focus to <body> and Tab restarts from
  // the top of the document with nothing said about why.
  //
  // Returns null when focus was elsewhere (the common case, so the swap is
  // untouched), a selector to re-find the focused element in the canonical
  // markup, or '' for "was inside, but nothing to match on".
  function focusSelector(mount) {
    var el = document.activeElement;
    if (!el || el === document.body || !mount.contains(el)) {
      return null;
    }
    if (el.id) {
      return '#' + el.id;
    }
    var href = el.getAttribute && el.getAttribute('href');
    // Same reasoning as markActiveLink(): the value goes straight into a
    // selector, so anything but a plain path is not worth matching on.
    if (href && /^[A-Za-z0-9/._#?=&-]+$/.test(href)) {
      return el.tagName.toLowerCase() + '[href="' + href + '"]';
    }
    // The hamburger carries neither an id nor an href, and on mobile it is the
    // one control most likely to be focused when the swap lands — its label is
    // the only thing that identifies it in the canonical markup. Same
    // no-quotes guard as above.
    var label = el.getAttribute && el.getAttribute('aria-label');
    if (label && /^[A-Za-z0-9 ._-]+$/.test(label)) {
      return el.tagName.toLowerCase() + '[aria-label="' + label + '"]';
    }
    return '';
  }

  function restoreFocus(element, selector) {
    var target = null;
    try {
      target = selector ? element.querySelector(selector) : null;
    } catch (error) {
      // An id that is not a valid CSS identifier (leading digit, a stray ".")
      // throws rather than returning null. Falling through is the right
      // answer — never let focus rescue break the swap that just succeeded.
      target = null;
    }
    if (target && target.focus) {
      // preventScroll because this is restoring a focus the user already had,
      // not a navigation — and applyHashTarget() has a deep-link scroll to
      // re-apply right after. Ignored by browsers that lack it, harmlessly.
      target.focus({ preventScroll: true });
    }
    // Finding the element is not the same as focusing it — focus() is a silent
    // no-op on anything that is not focusable at that instant. Measured at
    // 390px: the canonical header keeps #nav-menu at display:none until the
    // hamburger is opened, while the static nav-list it replaces is a visible
    // scroller, so the nav link matched above cannot take focus and it drops
    // to <body> — precisely the mobile case this rescue exists for. A found
    // target is not a focused one; activeElement is the only honest test.
    if (target && document.activeElement === target) {
      return;
    }
    // No usable equivalent in the new tree: land on the container itself so
    // the next Tab continues from the chrome rather than from <body>.
    element.setAttribute('tabindex', '-1');
    if (element.focus) {
      element.focus({ preventScroll: true });
    }
  }

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
          var selector = focusSelector(mount);
          mount.replaceWith(element);
          if (selector !== null) {
            restoreFocus(element, selector);
          }
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
    // Blog posts live under /blog/<slug> and there is no nav link for the post
    // itself — highlight the section's link instead. This used to be a hardcoded
    // '/blog/' prefix test, which left all 58 pages under /labs/<slug> with no
    // current-page indication and no aria-current at all. Deriving the section
    // from the first path segment covers both, and anything added later.
    if (!link) {
      var segment = path.split('/')[1] || '';
      // The segment goes straight into a selector, so keep it to slug
      // characters — a stray quote in the URL would throw here.
      if (/^[A-Za-z0-9._-]+$/.test(segment) && '/' + segment !== path) {
        link = document.querySelector('.nav-list .nav-link[href="/' + segment + '"]');
      }
    }
    if (link) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  }

  // The browser scrolls to a #fragment while these partials are still in
  // flight, so swapping the header and footer moves the target out from under
  // the position it just scrolled to — deep links land at the top of the page.
  // Re-apply the scroll once the real chrome is in place.
  function applyHashTarget() {
    if (!window.location.hash) {
      return;
    }
    var target;
    try {
      target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    } catch (error) {
      return; // Malformed percent-encoding in the hash.
    }
    if (!target) {
      return;
    }
    // 'instant' overrides the smooth scroll-behavior set in CSS: this is a
    // correction to a scroll that already happened, not a new navigation, so
    // it should not visibly travel down the page. scroll-margin-top on
    // main [id] keeps the target clear of the sticky header.
    target.scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  Promise.all([inject('header'), inject('footer')]).then(function () {
    markActiveLink();
    // Called directly rather than inside requestAnimationFrame: rAF callbacks
    // do not fire in a background tab, which is exactly when a deep link is
    // most likely to be opened. scrollIntoView flushes layout itself, so the
    // freshly injected header and footer are already measured.
    applyHashTarget();
    document.dispatchEvent(new CustomEvent('partials:loaded'));
  });
})();

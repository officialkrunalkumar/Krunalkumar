// Copy-link button for the blog share row. The three network links next to it
// are plain <a href> targets that need no JavaScript at all — only this button
// does, so it ships with the `hidden` attribute in the markup and is unhidden
// here. A visitor without JS sees three working share links and no dead button.
//
// The canonical URL is read from <link rel="canonical"> rather than
// location.href, so a link shared from /blog/slug?utm_source=… still copies the
// clean address.
(function () {
  var button = document.querySelector('[data-share="copy"]');
  if (!button) return;

  var canonical = document.querySelector('link[rel="canonical"]');
  var url = canonical ? canonical.href : window.location.href;

  var status = document.getElementById('share-status');
  var label = button.querySelector('.post-share-label');
  var originalLabel = label ? label.textContent : '';
  var revertTimer = null;

  // navigator.clipboard needs a secure context. The textarea fallback keeps the
  // button working on plain http (local previews) and in older browsers.
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var field = document.createElement('textarea');
      field.value = text;
      // Off-screen rather than display:none — a hidden textarea cannot be
      // selected, and position:fixed avoids scrolling the page on focus.
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.top = '-1000px';
      document.body.appendChild(field);
      field.select();
      try {
        if (document.execCommand('copy')) resolve();
        else reject(new Error('execCommand returned false'));
      } catch (error) {
        reject(error);
      } finally {
        field.remove();
      }
    });
  }

  function announce(message) {
    if (status) status.textContent = message;
  }

  function showResult(message, copied) {
    clearTimeout(revertTimer);
    if (label) label.textContent = message;
    button.classList.toggle('is-copied', copied);
    // The label change is silent to screen readers inside a button that
    // already has an accessible name, so mirror it into the live region.
    announce(copied ? 'Link copied to clipboard' : message);
    revertTimer = setTimeout(function () {
      if (label) label.textContent = originalLabel;
      button.classList.remove('is-copied');
      announce('');
    }, 2000);
  }

  button.hidden = false;
  button.addEventListener('click', function () {
    copy(url)
      .then(function () {
        showResult('Copied', true);
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'article_share', { method: 'copy' });
        }
      })
      .catch(function () {
        // Clipboard access can be denied by permission policy. Say so rather
        // than failing silently — the address bar still has the URL.
        showResult('Press Ctrl+C', false);
      });
  });
})();

/* ==========================================================================
   lab-paths.js — progress ticks for the five routes on /labs.
   --------------------------------------------------------------------------
   The labs are alphabetical, which is the right order for a reference and the
   wrong one for learning: nothing tells a newcomer that url-inspector should
   come before csp-playground. The paths in the markup fix the ordering. This
   file is the only part that needs to remember anything.

   IT MARKS A STEP WHEN YOU OPEN IT, AND NOTHING ELSE. There is no tracking on
   the lab pages themselves, and deliberately so: instrumenting all 113 of
   them to record a visit would mean every visitor who never touches a path
   still writes a key on every lab they read. Instead the click is caught here
   — you opened this lab FROM a path, so the path may remember it. Someone who
   never expands a path never stores a byte.

   WHICH ALSO MEANS IT UNDERCOUNTS, ON PURPOSE. Open a lab from the grid below
   rather than from the path and it does not tick. That is the honest trade
   for not following people around the site, and the tick is a bookmark for
   your own benefit rather than a score anyone is keeping.

   STORED UNDER lab.path.<name>, one key per path, as a comma-joined list of
   slugs. Not JSON: the values are short slugs with no commas in them, the
   list is read far more often than it is written, and a corrupt JSON parse
   would lose a whole path where a stray comma loses nothing.

   Namespaced lab.* rather than game.*, because game-storage.js owns that
   prefix and its opt-out flag governs scores. This is neither.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

(function () {
  'use strict';

  var paths = document.querySelectorAll('.lab-path');
  if (!paths.length) return;

  var PREFIX = 'lab.path.';

  function read(name) {
    try {
      var raw = localStorage.getItem(PREFIX + name);
      if (!raw) return [];
      return raw.split(',');
    } catch (e) {
      /* Private mode, or storage refused. Everything below still works,
         it just forgets between loads — which is better than a page that
         throws on a browser that declined to store anything. */
      return [];
    }
  }

  function write(name, list) {
    try { localStorage.setItem(PREFIX + name, list.join(',')); } catch (e) { /* ignore */ }
  }

  function slugOf(a) {
    var href = a.getAttribute('href') || '';
    return href.replace(/^\/labs\//, '').replace(/[#?].*$/, '');
  }

  function paint(box) {
    var name = box.getAttribute('data-path');
    var done = read(name);
    var links = box.querySelectorAll('.lab-steps a[data-step]');
    var hit = 0;
    var i;

    for (i = 0; i < links.length; i++) {
      var li = links[i].parentNode;
      var isDone = done.indexOf(slugOf(links[i])) !== -1;
      if (isDone) hit++;
      li.className = isDone ? 'is-done' : '';
    }

    var count = box.querySelector('[data-count]');
    if (count) {
      count.textContent = hit
        ? hit + ' of ' + links.length + ' done'
        : links.length + ' steps';
    }

    var fill = box.querySelector('[data-fill]');
    if (fill) fill.style.width = Math.round((hit / links.length) * 100) + '%';

    /* The reset is pointless on an untouched path and its presence invites
       the question of what there is to reset. */
    var reset = box.querySelector('[data-reset]');
    if (reset) reset.hidden = hit === 0;

    var cert = box.querySelector('[data-cert]');
    if (cert) cert.hidden = hit < links.length;
  }

  /* --------------------------------------------------------------------
     The certificate.

     Printed, not downloaded. A canvas rendered to a PNG would need a
     download attribute, and the honest artefact for something you finished
     is a sheet of paper rather than a file in a downloads folder — which is
     the same conclusion labs/typing-certificate reached.

     AND IT SAYS ON ITS FACE THAT IT PROVES NOTHING. Nobody invigilated this.
     The ticks come from clicking links on a page that trusts you, on a site
     with no accounts. A certificate that implied otherwise would be the one
     dishonest thing on the site, and the typing certificate already set the
     precedent for saying so in the printed copy rather than in a footnote
     somebody can crop off.
     -------------------------------------------------------------------- */

  function certificate(box) {
    var name = box.querySelector('.lab-path-name');
    var links = box.querySelectorAll('.lab-steps a[data-step]');
    var sheet = document.createElement('div');
    sheet.className = 'pathcert';

    var h = document.createElement('p');
    h.className = 'pathcert-kicker';
    h.textContent = 'krunalkumar.dpdns.org / labs';
    sheet.appendChild(h);

    var t = document.createElement('h2');
    t.className = 'pathcert-title';
    t.textContent = name ? name.textContent : 'Lab path';
    sheet.appendChild(t);

    var sub = document.createElement('p');
    sub.className = 'pathcert-sub';
    sub.textContent = 'All ' + links.length + ' labs opened and worked through';
    sheet.appendChild(sub);

    var ul = document.createElement('ol');
    ul.className = 'pathcert-list';
    for (var i = 0; i < links.length; i++) {
      var li = document.createElement('li');
      li.textContent = links[i].textContent;
      ul.appendChild(li);
    }
    sheet.appendChild(ul);

    var when = document.createElement('p');
    when.className = 'pathcert-date';
    /* Locale-formatted rather than ISO: this is the one string on the site a
       person prints and puts on a desk. */
    when.textContent = new Date().toLocaleDateString(undefined,
      { year: 'numeric', month: 'long', day: 'numeric' });
    sheet.appendChild(when);

    var honest = document.createElement('p');
    honest.className = 'pathcert-honest';
    honest.textContent = 'This is a record of self-directed practice, not an issued credential. ' +
      'Nobody invigilated it and no account was checked — the ticks were kept by the browser this ' +
      'was printed from. It says what you read, which is worth something, and nothing more.';
    sheet.appendChild(honest);

    document.body.appendChild(sheet);
    document.body.classList.add('is-printing-cert');

    function done() {
      document.body.classList.remove('is-printing-cert');
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      window.removeEventListener('afterprint', done);
    }
    window.addEventListener('afterprint', done);
    /* Safari has historically not fired afterprint. The timeout is the
       backstop so the page is never left with a stray sheet in the DOM. */
    window.setTimeout(done, 20000);

    window.print();
  }

  function mark(box, slug) {
    var name = box.getAttribute('data-path');
    var done = read(name);
    if (done.indexOf(slug) !== -1) return;
    done.push(slug);
    write(name, done);
    paint(box);
  }

  for (var p = 0; p < paths.length; p++) {
    (function (box) {
      paint(box);

      box.addEventListener('click', function (e) {
        var t = e.target;

        if (t && t.hasAttribute && t.hasAttribute('data-cert')) {
          certificate(box);
          return;
        }

        if (t && t.hasAttribute && t.hasAttribute('data-reset')) {
          try { localStorage.removeItem(PREFIX + box.getAttribute('data-path')); } catch (err) { /* ignore */ }
          paint(box);
          return;
        }

        /* The click may land on the link or on something inside it, so walk
           up to the anchor rather than assuming the target is one. */
        var a = t && t.closest ? t.closest('.lab-steps a[data-step]') : null;
        if (!a) return;
        /* Marked before navigation rather than after. The page is about to
           unload, so there is no "after" to run in — and a write to
           localStorage is synchronous, so it lands. */
        mark(box, slugOf(a));
      });
    })(paths[p]);
  }
})();

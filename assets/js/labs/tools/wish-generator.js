/* ==========================================================================
   wish-generator.js — /labs/wish-generator
   --------------------------------------------------------------------------
   Type a name, pick a look, get a link. The link opens /birthday or /festival
   with the values in the query string; those pages read them, render, and wipe
   the query string off the address bar.

   THE PREVIEW IS THE REAL PAGE IN AN IFRAME. That is the one decision worth
   defending here, because reimplementing the scene in miniature would have
   been less code. It would also have been a lie: the moment somebody changed
   a palette in celebrate.css or a greeting in festival-data.js, the preview
   would show something the recipient never gets, and nobody would notice
   until it had been sent. An iframe pointed at the actual URL cannot drift,
   and it doubles as a live test that the URL works — if the preview renders,
   the link renders.

   It costs a page load per change, which is why applyPreview is debounced and
   why the iframe is only pointed somewhere once there is a name to show.

   THAT IFRAME NEEDS A HEADER EXCEPTION AND HAS ONE. vercel.json sends
   X-Frame-Options: DENY and frame-ancestors 'none' to every page on the site,
   which is right everywhere except here — with them, this panel is a browser
   "refused to connect" box and nothing in this file can fix it. There is a
   /(birthday|festival) rule below the global one that re-sends SAMEORIGIN and
   frame-ancestors 'self' for exactly those two paths. If the preview ever goes
   blank in production while working locally, that rule is the first thing to
   check; the dev server does not apply vercel.json headers, so this failure
   only ever shows up deployed.

   NO NETWORK. Nothing typed here leaves the browser: the whole tool is string
   building, and the only "request" is the same-origin iframe loading a page
   from this site. That matters because the Labs hub promises exactly this of
   every tool on it, and a tool that quietly broke the promise would make the
   claim false everywhere.

   SANITISATION IS DELIBERATELY DUPLICATED. This file trims and caps what goes
   into the link, and celebrate-guard.js sanitises again on the way out. That
   is not redundancy to remove: the generator is a convenience, not a gate —
   anyone can type a URL by hand — so the guard has to assume it was never
   run. The rule is that the receiving page defends itself.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.querySelector('[data-wish-tool]');
  if (!root) return;

  var $ = function (sel) { return root.querySelector(sel); };

  var elMode = root.querySelectorAll('[name="wish-mode"]');
  var elName = $('[data-wish-name]');
  var elFrom = $('[data-wish-from]');
  var elNameLabel = $('[data-wish-name-label]');
  var elNameHint = $('[data-wish-name-hint]');
  var elThemeRow = $('[data-wish-themes]');
  var elFestivalRow = $('[data-wish-festivals]');
  var elFestivalSelect = $('[data-wish-festival-select]');
  var elFestivalWrap = $('[data-wish-festival-wrap]');
  var elThemeWrap = $('[data-wish-theme-wrap]');
  var elUrl = $('[data-wish-url]');
  var elCopy = $('[data-wish-copy]');
  var elOpen = $('[data-wish-open]');
  var elWhatsapp = $('[data-wish-whatsapp]');
  var elFrame = $('[data-wish-frame]');
  var elEmpty = $('[data-wish-empty]');
  var elResolved = $('[data-wish-resolved]');

  var BIRTHDAY_THEMES = [
    { k: 'candlelight', n: 'Candlelight', d: 'Warm amber on a deep plum night. The safe choice for almost anyone.' },
    { k: 'confetti', n: 'Confetti', d: 'Loud, bright and young. Made for a child’s birthday.' },
    { k: 'balloons', n: 'Balloons', d: 'Pastel balloons drifting up through a dusk sky.' },
    { k: 'starlit', n: 'Starlit', d: 'Gold on midnight. Send this one to a parent or a boss.' },
    { k: 'blossom', n: 'Blossom', d: 'Petals falling. Affectionate rather than celebratory.' },
    { k: 'neon', n: 'Neon', d: 'Electric cyan and magenta, for people who’d find a cake embarrassing.' }
  ];

  var state = {
    mode: 'birthday',
    name: '',
    from: '',
    theme: 'candlelight',
    festival: ''
  };

  /* ---------------------------------------------------------------------- */

  function trim(v, max) {
    v = String(v || '').replace(/\s+/g, ' ').trim();
    var cp = Array.from ? Array.from(v) : v.split('');
    return cp.length > max ? cp.slice(0, max).join('').trim() : v;
  }

  function buildUrl(absolute) {
    var name = state.mode === 'birthday' ? state.name : state.festival;
    if (!name) return '';

    var p = new URLSearchParams();
    p.set('name', name);
    if (state.mode === 'birthday' && state.theme && state.theme !== 'candlelight') {
      p.set('theme', state.theme);
    }
    if (state.from) p.set('from', state.from);

    var path = '/' + state.mode + '?' + p.toString();
    return absolute ? window.location.origin + path : path;
  }

  /* ---------------------------------------------------------------------- */

  /* An <a> has no disabled attribute, so a disabled one has to be assembled out
     of three separate things or it is only half disabled. Greying it out with
     pointer-events stops the mouse and nothing else: the link stays focusable,
     stays announced as a link, and Enter on it still opens a blank tab. So the
     href goes to "#", aria-disabled says so out loud, tabindex="-1" takes it
     out of the tab order, and the click guard below catches the Enter that a
     browser turns into a click on an anchor somebody focused another way. */
  function setLinkReady(a, ready, href) {
    if (!a) return;
    a.href = ready ? href : '#';
    a.setAttribute('aria-disabled', ready ? 'false' : 'true');
    if (ready) a.removeAttribute('tabindex'); else a.setAttribute('tabindex', '-1');
  }

  function guardDisabled(a) {
    if (!a) return;
    a.addEventListener('click', function (ev) {
      if (a.getAttribute('aria-disabled') === 'true') ev.preventDefault();
    });
  }

  guardDisabled(elOpen);
  guardDisabled(elWhatsapp);

  var frameTimer = null;
  function applyPreview() {
    var rel = buildUrl(false);
    var abs = buildUrl(true);

    if (elUrl) elUrl.value = abs;

    var ready = !!rel;
    if (elCopy) elCopy.disabled = !ready;
    setLinkReady(elOpen, ready, rel);
    if (elWhatsapp) {
      /* wa.me takes the whole message as one encoded blob. Built here rather
         than in the markup because the URL changes on every keystroke. */
      var msg = (state.mode === 'birthday'
        ? 'Happy Birthday! ' : 'Wishing you a very happy ') + abs;
      setLinkReady(elWhatsapp, ready, 'https://wa.me/?text=' + encodeURIComponent(msg));
    }

    if (elEmpty) elEmpty.hidden = ready;
    if (elFrame) elFrame.hidden = !ready;

    /* Festival name resolution, shown live. This is the reassurance that makes
       the fuzzy matching trustworthy: type "bestu varsh" and the tool says out
       loud that it resolved to Bestu Varas and will greet with Saal Mubarak,
       rather than leaving you to discover it after you have sent the link. */
    if (elResolved) {
      if (state.mode === 'festival' && state.festival && window.KSFestivals) {
        var sc = window.KSFestivals.scene(state.festival);
        elResolved.hidden = false;
        elResolved.textContent = sc.known
          ? sc.glyph + '  ' + sc.name + ' — the card will say “' + sc.greeting + '”'
          : '✨  Not one I know, so the card will say “' + sc.greeting + '” with a general festive look.';
        elResolved.classList.toggle('is-generic', !sc.known);
      } else {
        elResolved.hidden = true;
      }
    }

    if (!ready) {
      if (elFrame) elFrame.removeAttribute('src');
      return;
    }

    /* Debounced: the iframe loads a real page, and reloading it on every
       keystroke would be both slow and visually frantic. */
    window.clearTimeout(frameTimer);
    frameTimer = window.setTimeout(function () {
      if (elFrame) elFrame.src = rel;
    }, 420);
  }

  /* The card is not drawn by this file — it is drawn by the real /birthday or
     /festival page in the iframe, so the only honest moment to count is that
     page reporting it finished loading. Which is also the strongest signal
     available: a load here means a URL was built from a name that was actually
     typed or picked, and that the page behind it rendered rather than being
     refused by the frame-ancestors rule described at the top of this file.

     The src guard is what keeps the empty state out of it. The iframe ships
     with no src at all and applyPreview() removes the attribute again whenever
     there is nothing to show, so the about:blank load that follows carries no
     card and is ignored. */
  if (elFrame) {
    elFrame.addEventListener('load', function () {
      if (!elFrame.getAttribute('src')) return;
      if (window.KSLab) window.KSLab.used('generate');
    });
  }

  /* ---------------------------------------------------------------------- */

  function renderThemes() {
    if (!elThemeRow) return;
    elThemeRow.textContent = '';

    BIRTHDAY_THEMES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wish-chip';
      b.setAttribute('data-theme', t.k);
      b.setAttribute('aria-pressed', String(t.k === state.theme));
      b.title = t.d;

      var sw = document.createElement('span');
      sw.className = 'wish-chip-swatch';
      sw.setAttribute('data-swatch', t.k);
      sw.setAttribute('aria-hidden', 'true');

      var label = document.createElement('span');
      label.textContent = t.n;

      b.appendChild(sw);
      b.appendChild(label);

      b.addEventListener('click', function () {
        state.theme = t.k;
        var all = elThemeRow.querySelectorAll('.wish-chip');
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-pressed', String(all[i].getAttribute('data-theme') === t.k));
        }
        applyPreview();
      });

      elThemeRow.appendChild(b);
    });
  }

  /* A short list of the festivals people actually reach for, as one-tap chips.
     The full ninety are reachable by typing — a ninety-chip wall would be a
     worse interface than a text field, and the fuzzy matcher makes typing the
     faster path anyway. */
  var QUICK = ['diwali', 'holi', 'christmas', 'new-year', 'eid-al-fitr', 'navratri',
               'raksha-bandhan', 'ganesh-chaturthi', 'makar-sankranti', 'uttarayan',
               'pongal', 'onam', 'durga-puja', 'lunar-new-year', 'vaisakhi', 'wedding'];

  function renderFestivals() {
    if (!elFestivalRow || !window.KSFestivals) return;
    elFestivalRow.textContent = '';

    QUICK.forEach(function (key) {
      var f = null;
      var all = window.KSFestivals.all;
      for (var i = 0; i < all.length; i++) { if (all[i].k === key) { f = all[i]; break; } }
      if (!f) return;

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wish-chip';
      b.title = f.b;
      /* The name lives on the element, not in its text, for the same reason the
         theme chips carry data-theme: the chip renders as a glyph span plus a
         label span, so reading it back out of textContent gets "🪔Diwali" and
         never matches. Storing the value means changing how a chip looks can
         never break which one shows as picked. */
      b.setAttribute('data-festival', f.n);
      b.setAttribute('aria-pressed', String(f.n === state.festival));

      var g = document.createElement('span');
      g.className = 'wish-chip-glyph';
      g.setAttribute('aria-hidden', 'true');
      g.textContent = f.e;

      var label = document.createElement('span');
      label.textContent = f.n;

      b.appendChild(g);
      b.appendChild(label);

      b.addEventListener('click', function () {
        state.festival = f.n;
        if (elName) elName.value = f.n;
        applyPreview();
        syncChips();
      });

      elFestivalRow.appendChild(b);
    });
  }

  /* The full list, grouped by region into <optgroup>s. A native <select> on
     purpose rather than a custom combobox: on a phone it opens the OS picker,
     which is scrollable, searchable by first letter and already familiar —
     and no hand-rolled listbox gets keyboard and screen-reader behaviour as
     right as the built-in does.

     It writes into the same text field the chips do, and that field stays
     editable. Picking is a shortcut, never a constraint: the dropdown holds
     92 festivals and the world has thousands, so typing has to remain the
     way out of the list. */
  function renderFestivalSelect() {
    if (!elFestivalSelect || !window.KSFestivals || !window.KSFestivals.grouped) return;

    var groups = window.KSFestivals.grouped();
    groups.forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g.region;
      g.items.forEach(function (f) {
        var opt = document.createElement('option');
        opt.value = f.n;
        /* The glyph in the label makes a 92-row list scannable — the eye finds
           🪔 far faster than it reads "Diwali" in a column of names. */
        opt.textContent = f.e + '  ' + f.n;
        og.appendChild(opt);
      });
      elFestivalSelect.appendChild(og);
    });

    elFestivalSelect.addEventListener('change', function () {
      var v = elFestivalSelect.value;
      if (!v) return;
      state.festival = v;
      if (elName) elName.value = v;
      applyPreview();
      syncChips();
    });
  }

  function syncChips() {
    if (!elFestivalRow) return;
    var chips = elFestivalRow.querySelectorAll('.wish-chip');
    var current = (state.festival || '').toLowerCase();
    for (var i = 0; i < chips.length; i++) {
      var val = (chips[i].getAttribute('data-festival') || '').toLowerCase();
      chips[i].setAttribute('aria-pressed', String(!!current && val === current));
    }
  }

  /* ---------------------------------------------------------------------- */

  function setMode(mode) {
    state.mode = mode;

    if (elNameLabel) {
      elNameLabel.textContent = mode === 'birthday' ? 'Whose birthday is it?' : 'Which festival?';
    }
    if (elNameHint) {
      elNameHint.textContent = mode === 'birthday'
        ? 'Their name, as you’d say it out loud.'
        : 'Type any festival — spelling doesn’t have to be exact.';
    }
    if (elName) {
      elName.placeholder = mode === 'birthday' ? 'Riya' : 'Diwali';
      elName.value = mode === 'birthday' ? state.name : state.festival;
    }

    if (elThemeWrap) elThemeWrap.hidden = mode !== 'birthday';
    if (elFestivalWrap) elFestivalWrap.hidden = mode !== 'festival';

    applyPreview();
  }

  for (var i = 0; i < elMode.length; i++) {
    elMode[i].addEventListener('change', function (ev) {
      if (ev.target.checked) setMode(ev.target.value);
    });
  }

  if (elName) {
    elName.addEventListener('input', function () {
      var v = trim(elName.value, 32);
      if (state.mode === 'birthday') state.name = v; else state.festival = v;
      /* Typing overrides the dropdown. Without this the select keeps showing
         "Diwali" after somebody has typed something else over it, which is a
         quietly confusing state to leave a form in. */
      if (elFestivalSelect && elFestivalSelect.value !== v) elFestivalSelect.value = '';
      applyPreview();
      syncChips();
    });
  }

  if (elFrom) {
    elFrom.addEventListener('input', function () {
      state.from = trim(elFrom.value, 24);
      applyPreview();
    });
  }

  if (elCopy) {
    elCopy.addEventListener('click', function () {
      var url = buildUrl(true);
      if (!url) return;
      var label = elCopy.querySelector('[data-wish-copy-label]');

      function done(ok) {
        if (!label) return;
        label.textContent = ok ? 'Copied' : 'Press Ctrl+C';
        elCopy.classList.toggle('is-done', ok);
        window.setTimeout(function () {
          label.textContent = 'Copy link';
          elCopy.classList.remove('is-done');
        }, 2200);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { done(true); }, function () { selectFallback(done); });
      } else {
        selectFallback(done);
      }
    });
  }

  /* When the clipboard API is unavailable the next best thing is to select the
     text so Ctrl+C works — better than a silent failure. */
  function selectFallback(done) {
    try {
      if (elUrl) { elUrl.focus(); elUrl.select(); }
      done(document.execCommand ? document.execCommand('copy') : false);
    } catch (e) {
      done(false);
    }
  }

  renderThemes();
  renderFestivals();
  renderFestivalSelect();
  setMode('birthday');
})();

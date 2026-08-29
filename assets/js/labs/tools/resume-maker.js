/* ==========================================================================
   resume-maker.js — the resume maker on /labs/resume-maker.
   --------------------------------------------------------------------------
   One state object, five template builders, zero network requests. The form
   writes into the state, the state is rendered into a paper-sized sheet —
   A4 (794px, 210mm at 96dpi) or US Letter (816px, 8.5in) — and the
   browser's print dialog is the export button. The state also round-trips
   through a plain .json file (Download data / Load data): a resume should
   be a file you own, not a row in somebody's database.

   The privacy claim is the whole product. A resume is name + phone + email +
   photo + complete work history — exactly the bundle people hand to a random
   resume site without thinking, and exactly what those sites monetise. There
   is no fetch(), no XHR, no beacon anywhere in this file: the only read is a
   FileReader over a photo the visitor chose, and nothing is stored anywhere
   at all — see the note above purgeLegacyDraft() before adding an autosave.

   Rendering rule: user text goes through document.createElement and
   textContent ONLY. Nothing a visitor types is ever concatenated into
   markup — someone WILL paste angle brackets into a job description, and
   the correct result is that they appear on the resume.
   ========================================================================== */

(function () {
  'use strict';

  /* The key an older build of this tool autosaved the draft under. Nothing
     writes it any more — it survives only so purgeLegacyDraft() can delete
     what those builds left on people's machines. */
  var LEGACY_KEY = 'lab.resume-maker.v1';

  /* The two paper sizes the world actually hires on. w/h are the CSS-px
     equivalents at 96dpi (A4 is 210x297mm, Letter is 8.5x11in); printMin is
     a hair under the true page height, because exactly-full content plus
     browser rounding would spill a blank second page. */
  var PAPERS = {
    a4: { w: 794, h: 1123, page: 'A4', printMin: '296mm', label: 'A4' },
    letter: { w: 816, h: 1056, page: 'letter', printMin: '278mm', label: 'US Letter' }
  };
  var TEMPLATES = ['classic', 'sidebar', 'banner', 'elegant', 'compact'];
  var ACCENTS = ['#2563eb', '#0d9488', '#9f1239', '#15803d', '#334155', '#7c3aed'];

  var app = document.getElementById('rm-app');
  if (!app) return;

  var form = document.getElementById('rm-form');
  var sheet = document.getElementById('rm-sheet');
  var wrap = document.getElementById('rm-sheet-wrap');
  var saveStatus = document.getElementById('rm-save-status');

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  function blankExp() { return { title: '', company: '', location: '', start: '', end: '', desc: '' }; }
  function blankEdu() { return { degree: '', institution: '', year: '', note: '' }; }
  function blankCert() { return { name: '', issuer: '', year: '' }; }

  function blankState() {
    return {
      template: 'classic',
      accent: ACCENTS[0],
      paper: 'a4',
      photo: '',
      name: '', headline: '', email: '', phone: '', location: '',
      website: '', linkedin: '',
      summary: '', skills: '', languages: '', interests: '',
      /* One empty row each so the form does not open with three bare
         "+ Add" buttons and no visible fields. */
      experience: [blankExp()],
      education: [blankEdu()],
      certifications: []
    };
  }

  var state = blankState();

  /* Merge an imported object onto a fresh blank so a file written by an older
     version of this tool never leaves a field undefined — files from before
     the paper toggle existed simply get 'a4'. Every .json import comes through
     here, so a file someone edited by hand cannot smuggle in an unknown
     template or a list of non-objects. */
  function normalizeState(saved) {
    var base = blankState();
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (saved[k] !== undefined) base[k] = saved[k];
    });
    if (TEMPLATES.indexOf(base.template) < 0) base.template = 'classic';
    if (!PAPERS[base.paper]) base.paper = 'a4';
    if (!Array.isArray(base.experience)) base.experience = [blankExp()];
    if (!Array.isArray(base.education)) base.education = [blankEdu()];
    if (!Array.isArray(base.certifications)) base.certifications = [];
    ['experience', 'education', 'certifications'].forEach(function (k) {
      base[k] = base[k].filter(function (item) {
        return item && typeof item === 'object';
      });
    });
    return base;
  }

  /* There is deliberately NO autosave and no restore here, and please do not
     helpfully add one back. A resume is a full identity file — name, phone,
     email, photo, every employer — and this page gets opened on the library
     PC, the cyber-café machine and the friend's laptop far more often than
     on a private one. A convenient draft left behind in localStorage is a
     stranger's next visit reading somebody's phone number. The state lives
     in memory for the length of the session; "Download data" is how a draft
     survives, because that is a choice the visitor makes on purpose.

     Older builds did autosave, so this runs once at boot to delete what they
     left behind: a visitor who used the tool last year should not still be
     carrying their work history around. Wrapped because merely touching
     localStorage throws outright in some privacy modes. */
  function purgeLegacyDraft() {
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* nothing to clean up, then */ }
  }

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') n.textContent = text;
    return n;
  }

  function clean(v) { return String(v == null ? '' : v).trim(); }

  /* "https://linkedin.com/in/aarav/" prints as "linkedin.com/in/aarav" —
     the protocol and trailing slash are URL plumbing, not display text. */
  function shortUrl(u) {
    return clean(u).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  }

  function splitSkills(s) {
    return clean(s).split(/[\n,]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function descBullets(s) {
    return clean(s).split(/\n/).map(function (t) {
      /* Tolerate people who type their own bullet markers. */
      return t.replace(/^[-*•]\s*/, '').trim();
    }).filter(Boolean);
  }

  function hasAny(obj, keys) {
    return keys.some(function (k) { return clean(obj[k]) !== ''; });
  }

  function dateRange(a, b) {
    a = clean(a); b = clean(b);
    if (a && b) return a + ' – ' + b;
    return a || b;
  }

  /* ------------------------------------------------------------------
     Sheet building blocks — all createElement/textContent, no markup
     ------------------------------------------------------------------ */

  function section(parent, title) {
    var s = el('div', 'rm-s-section');
    s.appendChild(el('div', 'rm-s-h', title));
    parent.appendChild(s);
    return s;
  }

  function contactItems() {
    return [
      clean(state.email), clean(state.phone), clean(state.location),
      shortUrl(state.website), shortUrl(state.linkedin)
    ].filter(Boolean);
  }

  function contactBlock(stacked) {
    var items = contactItems();
    if (!items.length) return null;
    var c = el('div', 'rm-s-contact' + (stacked ? ' rm-s-contact--stack' : ''));
    items.forEach(function (t) { c.appendChild(el('span', '', t)); });
    return c;
  }

  function photoBlock() {
    if (!state.photo) return null;
    var p = el('div', 'rm-s-photo');
    var img = document.createElement('img');
    img.src = state.photo;
    img.alt = '';
    p.appendChild(img);
    return p;
  }

  function addSummary(parent, title) {
    var text = clean(state.summary);
    if (!text) return;
    section(parent, title || 'Summary').appendChild(el('p', 'rm-s-p', text));
  }

  function addSkills(parent, mode) {
    var skills = splitSkills(state.skills);
    if (!skills.length) return;
    var s = section(parent, 'Skills');
    if (mode === 'chips') {
      var box = el('div', 'rm-s-chips');
      skills.forEach(function (t) { box.appendChild(el('span', 'rm-s-chip', t)); });
      s.appendChild(box);
    } else {
      s.appendChild(el('p', 'rm-s-p', skills.join(', ')));
    }
  }

  function addExperience(parent) {
    var items = state.experience.filter(function (x) {
      return hasAny(x, ['title', 'company', 'location', 'start', 'end', 'desc']);
    });
    if (!items.length) return;
    var s = section(parent, 'Experience');
    items.forEach(function (x) {
      var item = el('div', 'rm-s-item');
      var top = el('div', 'rm-s-itemtop');
      var title = clean(x.title);
      if (title) top.appendChild(el('span', 'rm-s-title', title));
      var dates = dateRange(x.start, x.end);
      if (dates) top.appendChild(el('span', 'rm-s-dates', dates));
      if (top.childNodes.length) item.appendChild(top);
      var sub = [clean(x.company), clean(x.location)].filter(Boolean).join(' · ');
      if (sub) item.appendChild(el('div', 'rm-s-sub', sub));
      var lines = descBullets(x.desc);
      if (lines.length) {
        var ul = el('ul', 'rm-s-bullets');
        lines.forEach(function (t) { ul.appendChild(el('li', '', t)); });
        item.appendChild(ul);
      }
      s.appendChild(item);
    });
  }

  function addEducation(parent) {
    var items = state.education.filter(function (x) {
      return hasAny(x, ['degree', 'institution', 'year', 'note']);
    });
    if (!items.length) return;
    var s = section(parent, 'Education');
    items.forEach(function (x) {
      var item = el('div', 'rm-s-item');
      var top = el('div', 'rm-s-itemtop');
      var degree = clean(x.degree);
      if (degree) top.appendChild(el('span', 'rm-s-title', degree));
      var year = clean(x.year);
      if (year) top.appendChild(el('span', 'rm-s-dates', year));
      if (top.childNodes.length) item.appendChild(top);
      var inst = clean(x.institution);
      if (inst) item.appendChild(el('div', 'rm-s-sub', inst));
      var note = clean(x.note);
      if (note) item.appendChild(el('div', 'rm-s-note', note));
      s.appendChild(item);
    });
  }

  function addCerts(parent) {
    var items = state.certifications.filter(function (x) {
      return hasAny(x, ['name', 'issuer', 'year']);
    });
    if (!items.length) return;
    var s = section(parent, 'Certifications');
    items.forEach(function (x) {
      var item = el('div', 'rm-s-item');
      var top = el('div', 'rm-s-itemtop');
      var name = clean(x.name);
      if (name) top.appendChild(el('span', 'rm-s-title', name));
      var year = clean(x.year);
      if (year) top.appendChild(el('span', 'rm-s-dates', year));
      if (top.childNodes.length) item.appendChild(top);
      var issuer = clean(x.issuer);
      if (issuer) item.appendChild(el('div', 'rm-s-sub', issuer));
      s.appendChild(item);
    });
  }

  function addLine(parent, title, value) {
    var text = clean(value);
    if (!text) return;
    section(parent, title).appendChild(el('p', 'rm-s-p', text));
  }

  function nameBlock(parent) {
    var name = clean(state.name);
    var headline = clean(state.headline);
    if (name) parent.appendChild(el('div', 'rm-s-name', name));
    if (headline) parent.appendChild(el('div', 'rm-s-headline', headline));
  }

  /* ------------------------------------------------------------------
     The five templates. Same data, five arrangements.
     ------------------------------------------------------------------ */

  function tplClassic() {
    var head = el('div', 'rm-c-head');
    var text = el('div', 'rm-c-head-text');
    nameBlock(text);
    var contact = contactBlock(false);
    if (contact) text.appendChild(contact);
    head.appendChild(text);
    var photo = photoBlock();
    if (photo) head.appendChild(photo);
    sheet.appendChild(head);
    addSummary(sheet);
    addSkills(sheet, 'inline');
    addExperience(sheet);
    addEducation(sheet);
    addCerts(sheet);
    addLine(sheet, 'Languages', state.languages);
    addLine(sheet, 'Interests', state.interests);
  }

  function tplSidebar() {
    var side = el('div', 'rm-side');
    var main = el('div', 'rm-main');
    var photo = photoBlock();
    if (photo) side.appendChild(photo);
    var items = contactItems();
    if (items.length) {
      var s = section(side, 'Contact');
      s.appendChild(contactBlock(true));
    }
    addSkills(side, 'chips');
    addLine(side, 'Languages', state.languages);
    addLine(side, 'Interests', state.interests);
    nameBlock(main);
    addSummary(main);
    addExperience(main);
    addEducation(main);
    addCerts(main);
    sheet.appendChild(side);
    sheet.appendChild(main);
  }

  function tplBanner() {
    var band = el('div', 'rm-band');
    var text = el('div', 'rm-band-text');
    nameBlock(text);
    band.appendChild(text);
    var photo = photoBlock();
    if (photo) band.appendChild(photo);
    sheet.appendChild(band);
    var cols = el('div', 'rm-cols');
    var main = el('div', 'rm-maincol');
    var meta = el('div', 'rm-metacol');
    addSummary(main, 'Profile');
    addExperience(main);
    addEducation(main);
    var items = contactItems();
    if (items.length) {
      var s = section(meta, 'Contact');
      s.appendChild(contactBlock(true));
    }
    addSkills(meta, 'chips');
    addCerts(meta);
    addLine(meta, 'Languages', state.languages);
    addLine(meta, 'Interests', state.interests);
    cols.appendChild(main);
    cols.appendChild(meta);
    sheet.appendChild(cols);
  }

  function tplElegant() {
    var head = el('div', 'rm-e-head');
    var photo = photoBlock();
    if (photo) head.appendChild(photo);
    nameBlock(head);
    var contact = contactBlock(false);
    if (contact) head.appendChild(contact);
    sheet.appendChild(head);
    addSummary(sheet);
    addExperience(sheet);
    addEducation(sheet);
    addCerts(sheet);
    addSkills(sheet, 'inline');
    addLine(sheet, 'Languages', state.languages);
    addLine(sheet, 'Interests', state.interests);
  }

  function tplCompact() {
    var head = el('div', 'rm-c2-head');
    var text = el('div', 'rm-c2-head-text');
    nameBlock(text);
    var contact = contactBlock(false);
    if (contact) text.appendChild(contact);
    head.appendChild(text);
    var photo = photoBlock();
    if (photo) head.appendChild(photo);
    sheet.appendChild(head);
    var cols = el('div', 'rm-c2-cols');
    var main = el('div', 'rm-c2-main');
    var side = el('div', 'rm-c2-side');
    addSummary(main);
    addExperience(main);
    addSkills(side, 'inline');
    addEducation(side);
    addCerts(side);
    addLine(side, 'Languages', state.languages);
    addLine(side, 'Interests', state.interests);
    cols.appendChild(main);
    cols.appendChild(side);
    sheet.appendChild(cols);
  }

  var BUILDERS = {
    classic: tplClassic,
    sidebar: tplSidebar,
    banner: tplBanner,
    elegant: tplElegant,
    compact: tplCompact
  };

  function stateIsEmpty() {
    var simple = ['photo', 'name', 'headline', 'email', 'phone', 'location',
      'website', 'linkedin', 'summary', 'skills', 'languages', 'interests'];
    if (simple.some(function (k) { return clean(state[k]) !== ''; })) return false;
    var lists = [
      [state.experience, ['title', 'company', 'location', 'start', 'end', 'desc']],
      [state.education, ['degree', 'institution', 'year', 'note']],
      [state.certifications, ['name', 'issuer', 'year']]
    ];
    return !lists.some(function (pair) {
      return pair[0].some(function (item) { return hasAny(item, pair[1]); });
    });
  }

  function renderSheet() {
    sheet.className = 'rm-sheet rm-t-' + state.template;
    sheet.style.setProperty('--rm-accent', state.accent);
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);
    if (stateIsEmpty()) {
      /* No "on the left": below 1080px the panes stack and the form is
         above, not beside. */
      sheet.appendChild(el('div', 'rm-empty-hint',
        'Start filling the form — your resume appears here as you go.'));
    } else {
      BUILDERS[state.template]();
    }
    fitPreview();
  }

  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderSheet();
    }, 150);
  }

  /* ------------------------------------------------------------------
     Paper size. One JS-managed <style> element carries everything that
     depends on the chosen paper: the sheet's layout width and height on
     screen, and the @page size plus print min-height for the print
     dialog. It is appended to <head> after the stylesheets, so its
     equal-specificity rules win on source order — no inline styles on
     the sheet, which matters because the print block in the CSS must
     still be able to override with !important.
     ------------------------------------------------------------------ */

  var paperStyle = document.createElement('style');
  document.head.appendChild(paperStyle);
  var previewTitle = document.getElementById('rm-preview-title');

  function currentPaper() {
    return PAPERS[state.paper] || PAPERS.a4;
  }

  function syncPaper() {
    var p = currentPaper();
    paperStyle.textContent =
      '.rm-sheet{width:' + p.w + 'px;min-height:' + p.h + 'px}' +
      '@media print{@page{size:' + p.page + ';margin:0}' +
      '.rm-sheet{min-height:' + p.printMin + '}}';
    if (previewTitle) previewTitle.textContent = 'Live preview — ' + p.label;
  }

  /* ------------------------------------------------------------------
     Preview scaling. The sheet is laid out at its paper width (794px A4,
     816px Letter) and scaled to the pane; the wrapper is given the
     scaled height explicitly so the page does not reserve the full
     unscaled height below it.
     ------------------------------------------------------------------ */

  function fitPreview() {
    var w = wrap.clientWidth;
    if (!w) return;
    var scale = Math.min(1, w / currentPaper().w);
    sheet.style.transform = 'scale(' + scale + ')';
    wrap.style.height = Math.ceil(sheet.offsetHeight * scale) + 'px';
  }

  var fitQueued = false;
  window.addEventListener('resize', function () {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(function () { fitQueued = false; fitPreview(); });
  });

  /* ------------------------------------------------------------------
     Form: fixed fields
     ------------------------------------------------------------------ */

  function fieldInputs() {
    return form.querySelectorAll('[data-key]');
  }

  function syncFixedFields() {
    fieldInputs().forEach(function (input) {
      input.value = state[input.dataset.key] || '';
    });
  }

  form.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.key) {
      state[t.dataset.key] = t.value;
    } else if (t.dataset && t.dataset.list) {
      var card = t.closest('.rm-item');
      if (!card) return;
      var list = state[t.dataset.list];
      var idx = parseInt(card.dataset.index, 10);
      if (list && list[idx]) list[idx][t.dataset.field] = t.value;
    } else {
      return;
    }
    scheduleRender();
  });

  /* ------------------------------------------------------------------
     Form: repeatable lists (experience, education, certifications)
     ------------------------------------------------------------------ */

  var LISTS = {
    experience: {
      mount: 'rm-exp-list', add: 'rm-exp-add', label: 'Role', blank: blankExp,
      fields: [
        { f: 'title', label: 'Job title', ph: 'Backend Engineer' },
        { f: 'company', label: 'Company', ph: '' },
        { f: 'location', label: 'Location', ph: '' },
        { f: 'start', label: 'Start', ph: 'Jan 2022' },
        { f: 'end', label: 'End', ph: 'Present' },
        { f: 'desc', label: 'What you did', ph: 'One line per bullet point', type: 'textarea', full: true }
      ]
    },
    education: {
      mount: 'rm-edu-list', add: 'rm-edu-add', label: 'Education', blank: blankEdu,
      fields: [
        { f: 'degree', label: 'Degree', ph: 'B.Tech, Computer Engineering' },
        { f: 'institution', label: 'Institution', ph: '' },
        { f: 'year', label: 'Year', ph: '2019' },
        { f: 'note', label: 'Note', ph: 'e.g. GPA 8.6/10' }
      ]
    },
    certifications: {
      mount: 'rm-cert-list', add: 'rm-cert-add', label: 'Certification', blank: blankCert,
      fields: [
        { f: 'name', label: 'Name', ph: 'AWS Solutions Architect' },
        { f: 'issuer', label: 'Issuer', ph: '' },
        { f: 'year', label: 'Year', ph: '' }
      ]
    }
  };

  function renderList(listName) {
    var cfg = LISTS[listName];
    var mount = document.getElementById(cfg.mount);
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    state[listName].forEach(function (item, idx) {
      var card = el('div', 'rm-item');
      card.dataset.index = String(idx);

      var head = el('div', 'rm-item-head');
      head.appendChild(el('span', 'rm-item-title', cfg.label + ' ' + (idx + 1)));

      /* Up/down rather than drag: two obvious buttons that work with a
         keyboard and a screen reader, on cards that are mostly form fields
         anyway. Ends are disabled instead of hidden so the little cluster
         never changes shape. */
      var actions = el('div', 'rm-item-actions');
      var lower = cfg.label.toLowerCase();
      var up = el('button', 'lab-btn rm-move', '↑');
      up.type = 'button';
      up.dataset.moveIn = listName;
      up.dataset.dir = 'up';
      up.setAttribute('aria-label', 'Move ' + lower + ' ' + (idx + 1) + ' up');
      up.disabled = idx === 0;
      actions.appendChild(up);
      var down = el('button', 'lab-btn rm-move', '↓');
      down.type = 'button';
      down.dataset.moveIn = listName;
      down.dataset.dir = 'down';
      down.setAttribute('aria-label', 'Move ' + lower + ' ' + (idx + 1) + ' down');
      down.disabled = idx === state[listName].length - 1;
      actions.appendChild(down);
      var rm = el('button', 'lab-btn rm-remove', 'Remove');
      rm.type = 'button';
      rm.dataset.removeFrom = listName;
      rm.setAttribute('aria-label', 'Remove ' + lower + ' ' + (idx + 1));
      actions.appendChild(rm);
      head.appendChild(actions);
      card.appendChild(head);

      var grid = el('div', 'form-grid rm-grid');
      cfg.fields.forEach(function (fd) {
        var label = el('label', 'field' + (fd.full ? ' full' : ''));
        label.appendChild(el('span', '', fd.label));
        var input;
        if (fd.type === 'textarea') {
          input = document.createElement('textarea');
          input.rows = 4;
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.autocomplete = 'off';
        }
        if (fd.ph) input.placeholder = fd.ph;
        input.value = item[fd.f] || '';
        input.dataset.list = listName;
        input.dataset.field = fd.f;
        label.appendChild(input);
        grid.appendChild(label);
      });
      card.appendChild(grid);
      mount.appendChild(card);
    });
  }

  function renderAllLists() {
    Object.keys(LISTS).forEach(renderList);
  }

  Object.keys(LISTS).forEach(function (listName) {
    document.getElementById(LISTS[listName].add).addEventListener('click', function () {
      state[listName].push(LISTS[listName].blank());
      renderList(listName);
      /* Put the cursor where the typing goes next. */
      var mount = document.getElementById(LISTS[listName].mount);
      var last = mount.lastChild && mount.lastChild.querySelector('input, textarea');
      if (last) last.focus();
    });
  });

  form.addEventListener('click', function (ev) {
    var mv = ev.target.closest('[data-move-in]');
    if (mv && !mv.disabled) {
      var mvList = mv.dataset.moveIn;
      var mvCard = mv.closest('.rm-item');
      var from = parseInt(mvCard.dataset.index, 10);
      var to = from + (mv.dataset.dir === 'up' ? -1 : 1);
      var arr = state[mvList];
      if (to < 0 || to >= arr.length) return;   // belt: disabled should catch this
      var moved = arr.splice(from, 1)[0];
      arr.splice(to, 0, moved);
      renderList(mvList);
      /* The click destroyed the button under the pointer; put focus on the
         same-direction button of the card in its new slot so a keyboard
         user can keep tapping Enter to walk an entry up or down the list.
         At the end of the list that button is disabled — fall back to its
         opposite so focus never silently drops to <body>. */
      var mount = document.getElementById(LISTS[mvList].mount);
      var landed = mount.children[to];
      if (landed) {
        var next = landed.querySelector('[data-dir="' + mv.dataset.dir + '"]');
        if (next && next.disabled) {
          next = landed.querySelector('[data-dir="' + (mv.dataset.dir === 'up' ? 'down' : 'up') + '"]');
        }
        if (next && !next.disabled) next.focus();
      }
      scheduleRender();
      return;
    }
    var btn = ev.target.closest('[data-remove-from]');
    if (!btn) return;
    var listName = btn.dataset.removeFrom;
    var card = btn.closest('.rm-item');
    var idx = parseInt(card.dataset.index, 10);
    state[listName].splice(idx, 1);
    renderList(listName);
    scheduleRender();
  });

  /* ------------------------------------------------------------------
     Photo: FileReader, downscale on a canvas, keep as a JPEG data URL.
     512px on the long side is generous for the largest render (a 128px
     circle) and keeps the data URL small enough to travel comfortably
     inside a downloaded resume-data.json.
     ------------------------------------------------------------------ */

  var photoInput = document.getElementById('rm-f-photo');
  var photoBox = document.getElementById('rm-photo-box');
  var photoThumb = document.getElementById('rm-photo-thumb');
  var photoRemove = document.getElementById('rm-photo-remove');

  function syncPhotoUI() {
    if (state.photo) {
      photoThumb.src = state.photo;
      photoBox.hidden = false;
    } else {
      photoThumb.removeAttribute('src');
      photoBox.hidden = true;
    }
  }

  photoInput.addEventListener('change', function () {
    var file = photoInput.files && photoInput.files[0];
    if (!file) return;
    var reader = new FileReader();

    /* A file the browser cannot decode fails silently by default: the <img>
       fires error, nothing is listening, and the visitor is left staring at
       a preview that never changed. HEIC gets named because it is nearly
       always the reason — an iPhone shoots HEIC out of the box and no
       desktop browser will open one. The input is reset so the same file
       can be re-picked once they have converted it. Same wording as the
       biodata maker's, which hits the identical wall. */
    function photoFailed() {
      photoInput.value = '';
      saveStatus.textContent = 'That file could not be read as an image. Photos from an iPhone are often HEIC, which no browser can open — re-save it as JPEG or PNG and try again.';
    }

    reader.onerror = photoFailed;
    reader.onload = function () {
      var img = new Image();
      img.onerror = photoFailed;
      img.onload = function () {
        var max = 512;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        var ctx = canvas.getContext('2d');
        /* JPEG has no alpha; a transparent PNG would otherwise composite
           onto black and print as a dark square. */
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        state.photo = canvas.toDataURL('image/jpeg', 0.85);
        syncPhotoUI();
        renderSheet();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  photoRemove.addEventListener('click', function () {
    state.photo = '';
    photoInput.value = '';
    syncPhotoUI();
    renderSheet();
  });

  /* ------------------------------------------------------------------
     Toolbar: templates, accents, sample, clear, print
     ------------------------------------------------------------------ */

  var tplButtons = app.querySelectorAll('.rm-tpl');
  var swatches = app.querySelectorAll('.rm-swatch');
  var paperButtons = app.querySelectorAll('.rm-paper');

  function syncToolbar() {
    tplButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.template === state.template));
    });
    swatches.forEach(function (b) {
      b.setAttribute('aria-pressed',
        String(b.dataset.accent.toLowerCase() === String(state.accent).toLowerCase()));
    });
    paperButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.paper === state.paper));
    });
  }

  tplButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      state.template = b.dataset.template;
      syncToolbar();
      renderSheet();
    });
  });

  swatches.forEach(function (b) {
    b.addEventListener('click', function () {
      state.accent = b.dataset.accent;
      syncToolbar();
      renderSheet();
    });
  });

  paperButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      state.paper = b.dataset.paper;
      syncToolbar();
      syncPaper();
      renderSheet();
    });
  });

  /* A believable, entirely fictional profile — never the site owner's own
     details. The photo is drawn locally: an initials disc, so "with photo"
     layouts can be judged without shipping anyone's face. */
  function samplePhoto(accent) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#e8edf3';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(128, 128, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 84px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AM', 128, 134);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function sampleState() {
    var s = blankState();
    s.template = state.template;   // keep whatever the visitor was looking at
    s.accent = state.accent;
    s.paper = state.paper;
    s.photo = samplePhoto(s.accent);
    s.name = 'Aarav Mehta';
    s.headline = 'Backend Engineer';
    s.email = 'aarav.mehta@example.com';
    s.phone = '+91 98765 43210';
    s.location = 'Ahmedabad, India';
    s.website = 'https://aaravmehta.dev/';
    s.linkedin = 'https://linkedin.com/in/aaravmehta';
    s.summary = 'Backend engineer with 5 years building payment and logistics APIs for Indian startups. I care about boring reliability: idempotent endpoints, honest monitoring, and postmortems that name the real cause. Comfortable owning a service from schema design to the 2 a.m. page.';
    s.skills = 'Python, Django, PostgreSQL, Redis, Docker, AWS';
    s.experience = [
      {
        title: 'Senior Backend Engineer', company: 'Finlok Technologies',
        location: 'Ahmedabad', start: 'Jan 2023', end: 'Present',
        desc: 'Own the UPI settlement service handling 1.2M transactions a day on Django and PostgreSQL\nCut p95 latency of the payout API from 900ms to 210ms by fixing N+1 queries and adding Redis caching\nLed the migration from EC2 to ECS, reducing deploy time from 40 minutes to 6'
      },
      {
        title: 'Backend Engineer', company: 'Shipkaro',
        location: 'Pune', start: 'Jun 2020', end: 'Dec 2022',
        desc: 'Built courier-allocation engine matching 40K daily shipments across 8 partner APIs\nDesigned webhook retry pipeline that took delivery-status accuracy from 92% to 99.7%\nWrote the internal Django style guide and reviewed roughly 300 pull requests a year'
      }
    ];
    s.education = [
      {
        degree: 'B.Tech, Computer Engineering', institution: 'Nirma University, Ahmedabad',
        year: '2020', note: 'CGPA 8.4/10'
      }
    ];
    s.certifications = [
      { name: 'AWS Certified Solutions Architect – Associate', issuer: 'Amazon Web Services', year: '2023' }
    ];
    s.languages = 'English (fluent), Hindi (native), Gujarati (native)';
    s.interests = 'Long-distance cycling, chess, home lab tinkering';
    return s;
  }

  function syncEverything() {
    syncFixedFields();
    renderAllLists();
    syncPhotoUI();
    syncToolbar();
    syncPaper();
    renderSheet();
  }

  document.getElementById('rm-load-sample').addEventListener('click', function () {
    /* Loading the example replaces every field, which makes it exactly as
       destructive as Clear whenever the form already holds real typing — so
       it earns the same confirm. A blank form has nothing to lose and loads
       straight away. */
    if (!stateIsEmpty() &&
        !confirm('Replace everything in the form with the example? This cannot be undone.')) return;
    state = sampleState();
    syncEverything();
  });

  document.getElementById('rm-clear').addEventListener('click', function () {
    /* Nothing is stored, so there is nothing to delete — but this is still
       the one irreversible button on the page, and what it clears can be
       twenty minutes of typing. */
    if (!confirm('Clear the whole form and start again? This cannot be undone.')) return;
    state = blankState();
    photoInput.value = '';
    syncEverything();
    saveStatus.textContent = 'Cleared';
  });

  document.getElementById('rm-print').addEventListener('click', function () {
    window.print();
    /* This is the export. There is no PDF library here — the browser's print
       dialog is the only way a resume leaves this page, so handing the sheet
       to it is the moment the tool did its job. Nothing later is knowable: a
       page is never told whether the dialog ended in a PDF, in paper or in
       Cancel. Typing into the form reaches none of this, and neither does
       "Download data", which saves the JSON draft rather than the document.

       Gated on a name because the sheet opens blank and nothing is restored
       from a previous visit: pressing Print to see what the button does would
       otherwise count as an export, and lab_used is compared across labs, so
       one tool inflated by curiosity clicks distorts the whole table. */
    if (window.KSLab && (state.name || '').trim()) window.KSLab.used('export');
  });

  /* ------------------------------------------------------------------
     Download data / Load data — the state as a file you own.
     The export is the live state wrapped in an envelope naming the tool
     and a format version, so the import can politely refuse anything
     that is not one of its own files instead of half-loading it. The
     photo travels too: it is already a data URL inside the state.
     ------------------------------------------------------------------ */

  function exportJson() {
    return JSON.stringify({ tool: 'resume-maker', version: 1, data: state }, null, 2);
  }

  document.getElementById('rm-export').addEventListener('click', function () {
    var blob = new Blob([exportJson()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'resume-data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* Immediate revoke can race the download in some browsers; a second
       later the click has long been consumed. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    saveStatus.textContent = 'Downloaded resume-data.json';
  });

  var importBtn = document.getElementById('rm-import');
  var importInput = document.getElementById('rm-import-file');

  importBtn.addEventListener('click', function () {
    importInput.click();
  });

  importInput.addEventListener('change', function () {
    var file = importInput.files && importInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      importInput.value = '';   // same file twice in a row still fires change
      var parsed = null;
      try { parsed = JSON.parse(String(reader.result)); } catch (e) {
        saveStatus.textContent = 'That file is not valid JSON — expected a resume-data.json downloaded from this page.';
        return;
      }
      if (!parsed || typeof parsed !== 'object' ||
          parsed.tool !== 'resume-maker' || parsed.version !== 1 ||
          !parsed.data || typeof parsed.data !== 'object') {
        saveStatus.textContent = 'That does not look like a resume-maker data file — nothing was changed.';
        return;
      }
      /* The same guard as Clear and Load example — asked only now, after the
         file has parsed and passed the checks above, so a broken file still
         just reports its error without nagging about an overwrite that was
         never going to happen. */
      if (!stateIsEmpty() &&
          !confirm('Load this file and replace everything in the form? This cannot be undone.')) {
        saveStatus.textContent = 'Load cancelled — nothing was changed.';
        return;
      }
      /* Merged onto a blank so missing fields default instead of lingering
         from the old state. */
      state = normalizeState(parsed.data);
      photoInput.value = '';
      syncEverything();
      saveStatus.textContent = 'Loaded from your file';
    };
    reader.onerror = function () {
      importInput.value = '';
      saveStatus.textContent = 'Could not read that file.';
    };
    reader.readAsText(file);
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  purgeLegacyDraft();
  syncEverything();

  /* Fonts finishing after first paint change the sheet height slightly;
     refit once everything has settled. */
  window.addEventListener('load', fitPreview);

  /* Offline: the site ships a service worker that keeps a copy of this page
     and its files, so the tool loads and prints with no connection — which
     is only honest, given that nothing here needed a connection anyway.
     Feature-detected, and a failed registration is silently ignored: the
     tool must not care whether the offline copy exists. */
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* fine */ });
    } catch (e) { /* ancient browser mid-detection: also fine */ }
  }
})();

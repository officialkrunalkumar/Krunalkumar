/* ==========================================================================
   multi-shell.js — the shared chassis for the multi-family visualiser labs.
   --------------------------------------------------------------------------
   os-algorithms was the first lab built as "five simulations, one set of
   controls". Cryptography, the regex engine and the others are the same shape:
   a row of family tabs, a panel of inputs, a stage, an explanation line, a
   transport (reset / back / play / step / end / speed / scrub) and a table
   comparing every algorithm in the family on the visitor's own input.

   That chassis was written once inside os-algo.js and then wanted four more
   times. Copying it would have meant five drifting copies of the same play
   loop and the same 120 CSS rules, and any bug fixed five times — so it lives
   here instead, and each lab supplies only the parts that are actually about
   its subject.

   A family is a plain object with seven methods:

     algoOptions()            -> [{key, label}] for the algorithm picker
     buildPanel(host, onChange)  build the inputs; call onChange() on edit
     buildStage(host)            build the output surface
     compute()               -> number of frames; may set this.error
     render(frameIndex)         draw that frame
     note(frameIndex)        -> one sentence explaining what just happened
     compare()               -> {head, rows, best, lower} or null

   plus `key`, `label` and `algoKey`. Everything else is handled here.

   Two decisions carried over from the original, because they were right:
   frames are computed up front so stepping backwards is free, and the play
   loop is a self-scheduling setTimeout rather than setInterval so the speed
   slider takes effect on the very next step instead of after a stale tick.
   ========================================================================== */

(function (root) {
  'use strict';

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";
  var PALETTE = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa',
                 '#fb923c', '#22d3ee', '#facc15'];
  var SPEEDS = [900, 640, 460, 330, 240, 170, 120, 85, 60, 40];

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function pct(v) { return Math.round(v * 1000) / 10 + '%'; }
  function colour(i) { return PALETTE[i % PALETTE.length]; }

  /* A number box that stays usable while it is being typed into: the model is
     updated leniently on every keystroke, but the field itself is only
     rewritten on blur, so a half-typed "1" of "15" is never snapped to the
     minimum under the visitor's fingers. */
  function numBox(value, min, max, onChange, cls) {
    var el = E('input', 'oa-num' + (cls ? ' ' + cls : ''));
    el.type = 'number';
    el.min = String(min);
    el.max = String(max);
    el.value = String(value);
    el.setAttribute('inputmode', 'numeric');
    function read() {
      var v = parseInt(el.value, 10);
      if (isNaN(v)) return null;
      return Math.max(min, Math.min(max, v));
    }
    el.addEventListener('input', function () {
      var v = read();
      if (v !== null) onChange(v);
    });
    el.addEventListener('blur', function () {
      var v = read();
      if (v === null) v = min;
      el.value = String(v);
      onChange(v);
    });
    return el;
  }

  function textBox(value, onChange, placeholder) {
    var el = E('input', 'oa-text');
    el.type = 'text';
    el.value = value;
    el.spellcheck = false;
    el.autocomplete = 'off';
    if (placeholder) el.placeholder = placeholder;
    el.addEventListener('input', function () { onChange(el.value); });
    return el;
  }

  function selectBox(options, value, onChange) {
    var el = E('select', 'oa-select');
    options.forEach(function (o) {
      var op = E('option', null, o.label);
      op.value = o.key;
      if (o.key === value) op.selected = true;
      el.appendChild(op);
    });
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }

  function button(text, onClick, cls) {
    var el = E('button', 'oa-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }

  function field(labelText, control) {
    var wrap = E('label', 'oa-field');
    wrap.appendChild(E('span', 'oa-field-label', labelText));
    wrap.appendChild(control);
    return wrap;
  }

  function group(title) {
    var box = E('div', 'oa-group');
    if (title) box.appendChild(E('p', 'oa-group-title', title));
    return box;
  }

  /* Build a table from a header list and an array of row arrays. Cells may be
     strings or ready-made nodes, and a row may carry a class via row.cls. */
  function table(head, rows, cls) {
    var t = E('table', 'oa-table' + (cls ? ' ' + cls : ''));
    if (head && head.length) {
      var thead = E('thead'), tr = E('tr');
      head.forEach(function (h) {
        var th = E('th');
        if (h && h.nodeType) th.appendChild(h); else th.textContent = h == null ? '' : String(h);
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      t.appendChild(thead);
    }
    var tbody = E('tbody');
    (rows || []).forEach(function (r) {
      var row = E('tr');
      if (r.cls) row.className = r.cls;
      (r.cells || r).forEach(function (cell) {
        var td = E('td', 'oa-td');
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return t;
  }

  /* Parse a free-typed list of numbers. Commas, spaces and stray separators
     all work, because a visitor pasting a reference string out of a textbook
     should not have to think about the delimiter. */
  function parseList(text, min, max, limit) {
    var out = [];
    var parts = String(text).split(/[^0-9-]+/);
    for (var i = 0; i < parts.length && out.length < limit; i++) {
      if (parts[i] === '' || parts[i] === '-') continue;
      var v = parseInt(parts[i], 10);
      if (isNaN(v)) continue;
      out.push(Math.max(min, Math.min(max, v)));
    }
    return out;
  }

  /* ======================================================================== */
  /*  SHARED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Scoped on .oa-wrap rather than a root id, so one stylesheet serves every */
  /*  lab built on this shell. Injected once per page. style-src permits       */
  /*  'unsafe-inline' for stylesheets; script is 'self' only, which is why     */
  /*  nothing anywhere in these labs is eval'd.                                */
  /* ======================================================================== */

  var CSS = [
    '.oa-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    '.oa-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,0.6);}',
    '.oa-tab{font:inherit;font-size:12px;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '.oa-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '.oa-tab.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '.oa-body{display:grid;grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start;}',
    '.oa-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,0.6);min-width:0;}',
    '.oa-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '@media (max-width:900px){.oa-body{grid-template-columns:minmax(0,1fr);}' +
      '.oa-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',

    '.oa-group{margin:0 0 14px;}',
    '.oa-group-title{margin:0 0 7px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '.oa-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 7px;}',
    '.oa-field-label{color:' + C.dim + ';font-size:12px;}',
    '.oa-num{width:3.9rem;font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:4px 6px;text-align:right;}',
    '.oa-num-tiny{width:3.1rem;}',
    '.oa-text{width:100%;font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:6px 8px;}',
    '.oa-text-tiny{width:4.2rem;padding:3px 5px;}',
    '.oa-text-mono{letter-spacing:.04em;}',
    '.oa-select{font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:100%;}',
    '.oa-num:focus,.oa-text:focus,.oa-select:focus{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '.oa-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;}',
    '.oa-btn:hover{background:#213152;border-color:#40608f;}',
    '.oa-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';}',
    '.oa-btn[disabled]{opacity:.4;cursor:default;}',
    '.oa-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '.oa-hint{margin:6px 0 0;font-size:11px;line-height:1.55;color:' + C.faint + ';}',

    '.oa-table{width:100%;border-collapse:collapse;font-size:12px;}',
    '.oa-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '.oa-td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,0.6);color:' + C.ink + ';white-space:nowrap;}',
    '.oa-table-input .oa-td{padding:3px 4px;}',
    /* The control column is narrow and the input tables are wider than it on a
       phone and even on a laptop. They scroll inside themselves rather than
       pushing the whole lab sideways. */
    '.oa-proc-table,.oa-matrix,.oa-reqbox,.oa-tableout,.oa-scroll{overflow-x:auto;}',
    '.oa-row-avg .oa-td{color:' + C.cyan + ';font-weight:700;border-top:1px solid ' + C.line + ';}',
    '.oa-row-done .oa-td:first-child{opacity:.75;}',
    '.oa-namecell{display:inline-flex;align-items:center;gap:6px;}',
    '.oa-swatch{width:10px;height:10px;border-radius:3px;flex:0 0 auto;}',

    '.oa-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#1b2942;border:1px solid transparent;}',
    '.oa-chip-ghost{background:transparent;border-style:solid;border-width:1px;font-weight:400;}',
    '.oa-chip-idle{color:' + C.faint + ';font-weight:400;}',
    '.oa-chip-ok{color:' + C.green + ';border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.09);font-weight:400;}',
    '.oa-chip-no{color:' + C.red + ';border-color:rgba(252,165,165,.4);background:rgba(252,165,165,.07);font-weight:400;}',

    '.oa-canvas{display:block;width:100%;height:340px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';}',
    '@media (max-width:640px){.oa-canvas{height:280px;}}',

    '.oa-note{min-height:2.6rem;padding:8px 11px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.65;color:#cbd5e1;}',
    '.oa-error{padding:8px 11px;border-left:3px solid ' + C.red + ';background:rgba(252,165,165,.07);border-radius:0 8px 8px 0;font-size:12px;line-height:1.6;color:' + C.red + ';}',
    '.oa-warn{padding:8px 11px;border-left:3px solid ' + C.amber + ';background:rgba(251,191,36,.06);border-radius:0 8px 8px 0;font-size:11px;line-height:1.6;color:#e8d5a8;}',
    '.oa-transport{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid ' + C.line + ';border-radius:9px;background:rgba(15,23,42,.55);}',
    '.oa-scrub{flex:1 1 9rem;min-width:7rem;accent-color:' + C.blue + ';}',
    '.oa-count{font-size:11px;color:' + C.dim + ';white-space:nowrap;}',
    '.oa-speed{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:' + C.faint + ';}',
    '.oa-speed input{width:6rem;accent-color:' + C.blue + ';}',
    '.oa-compare-title{margin:0 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '.oa-row-cur .oa-td{background:rgba(125,211,252,.09);color:' + C.ink + ';}',
    '.oa-cell-best{color:' + C.green + ';font-weight:700;}',
    /* The stage is a real tab stop — build() gives it tabIndex 0 so Space can
       toggle playback while it is focused — and a tab stop that shows nothing
       when it lands is exactly the dead-end a keyboard visitor cannot navigate
       out of confidently. :focus-visible rather than :focus so clicking the
       stage does not paint a ring nobody asked for. */
    '.oa-stage:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:10px;}',
    '.oa-hidden{display:none;}'
  ].join('');

  var cssInjected = false;
  function injectCss(host, extra) {
    if (!cssInjected) {
      var base = document.createElement('style');
      base.textContent = CSS;
      base.setAttribute('data-oa-shell', '1');
      host.appendChild(base);
      cssInjected = true;
    }
    if (extra) {
      var own = document.createElement('style');
      own.textContent = extra;
      host.appendChild(own);
    }
  }

  /* ======================================================================== */
  /*  THE SHELL                                                               */
  /* ======================================================================== */

  function Shell(mount, families, extraCss) {
    this.mount = mount;
    this.families = families;
    this.active = 0;
    this.frame = 0;
    this.total = 1;
    this.playing = false;
    this.timer = null;
    this.speed = 5;
    injectCss(mount, extraCss);
    this.build();
    this.select(0);
  }

  Shell.prototype.build = function () {
    var self = this;
    var wrap = E('div', 'oa-wrap');

    var tabs = E('div', 'oa-tabs');
    this.tabs = this.families.map(function (fam, i) {
      var b = button(fam.label, function () { self.select(i); });
      b.className = 'oa-tab';
      tabs.appendChild(b);
      return b;
    });
    // A single-family lab does not need a tab bar taking up a row.
    if (this.families.length > 1) wrap.appendChild(tabs);

    var body = E('div', 'oa-body');
    var side = E('div', 'oa-side');
    var main = E('div', 'oa-main');

    // The algorithm picker is the one control every family shares, and the one
    // a visitor changes most, so it sits at the top of the panel.
    var gAlgo = group('Algorithm');
    this.algoHost = E('div');
    gAlgo.appendChild(this.algoHost);
    side.appendChild(gAlgo);
    this.algoGroup = gAlgo;

    this.panels = this.families.map(function (fam) {
      var host = E('div', 'oa-panel oa-hidden');
      fam.buildPanel(host, function () { self.recompute(true); });
      side.appendChild(host);
      return host;
    });

    this.stages = this.families.map(function (fam) {
      var host = E('div', 'oa-stage oa-hidden');
      // The stage is this widget's keyboard surface: Space toggles playback
      // while it holds focus (see the keydown listener at the end of build()),
      // so it has to be reachable by Tab and has to name itself when it gets
      // there — a bare focusable <div> announces nothing at all. Only the
      // visible stage is ever a tab stop: every other one carries .oa-hidden,
      // which is display:none, and a display:none element cannot be focused.
      host.tabIndex = 0;
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label',
        fam.label + ' stage — press Space to play and pause, arrow keys to step');
      fam.buildStage(host);
      main.appendChild(host);
      return host;
    });

    this.errorBox = E('div', 'oa-error oa-hidden');
    main.appendChild(this.errorBox);
    this.noteBox = E('div', 'oa-note');
    main.appendChild(this.noteBox);

    var tr = E('div', 'oa-transport');
    this.btnReset = button('⏮', function () { self.pause(); self.goto(0); });
    this.btnReset.title = 'Back to the start';
    this.btnReset.setAttribute('aria-label', 'Back to the start');
    this.btnBack = button('◀', function () { self.pause(); self.goto(self.frame - 1); });
    this.btnBack.title = 'One step back';
    this.btnBack.setAttribute('aria-label', 'One step back');
    this.btnPlay = button('▶ Play', function () { self.togglePlay(); });
    this.btnNext = button('▶|', function () { self.pause(); self.goto(self.frame + 1); });
    this.btnNext.title = 'One step forward';
    this.btnNext.setAttribute('aria-label', 'One step forward');
    this.btnEnd = button('⏭', function () { self.pause(); self.goto(self.total - 1); });
    this.btnEnd.title = 'Jump to the end';
    this.btnEnd.setAttribute('aria-label', 'Jump to the end');
    [this.btnReset, this.btnBack, this.btnPlay, this.btnNext, this.btnEnd].forEach(function (b) {
      tr.appendChild(b);
    });

    this.scrub = E('input', 'oa-scrub');
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.value = '0';
    this.scrub.setAttribute('aria-label', 'Step through the simulation');
    this.scrub.addEventListener('input', function () {
      self.pause();
      self.goto(parseInt(self.scrub.value, 10) || 0);
    });
    tr.appendChild(this.scrub);

    this.countBox = E('span', 'oa-count', '');
    tr.appendChild(this.countBox);

    var speedWrap = E('label', 'oa-speed');
    speedWrap.appendChild(E('span', null, 'speed'));
    var speedInput = E('input');
    speedInput.type = 'range';
    speedInput.min = '1';
    speedInput.max = '10';
    speedInput.value = String(this.speed);
    speedInput.setAttribute('aria-label', 'Playback speed');
    speedInput.addEventListener('input', function () {
      self.speed = parseInt(speedInput.value, 10) || 5;
      if (self.playing) { self.pause(); self.play(); }
    });
    speedWrap.appendChild(speedInput);
    tr.appendChild(speedWrap);
    main.appendChild(tr);

    var cmp = E('div', 'oa-comparewrap');
    // Most families compare algorithms; some compare something else entirely
    // (how fast a bit avalanches, how key size scales), so the heading is the
    // family's to name.
    this.compareTitle = E('p', 'oa-compare-title', 'Every algorithm on this same input');
    cmp.appendChild(this.compareTitle);
    this.compareHost = E('div', 'oa-tableout');
    cmp.appendChild(this.compareHost);
    main.appendChild(cmp);
    this.compareWrap = cmp;

    body.appendChild(side);
    body.appendChild(main);
    wrap.appendChild(body);
    this.mount.appendChild(wrap);
    this.wrap = wrap;

    // Arrow keys step, space plays — but never while a control has focus, or
    // typing a value would scrub the timeline out from under you.
    //
    // Space is not this shell's to take on sight. The browser has already given
    // it two jobs — scroll the page when nothing focusable owns it, and press
    // the focused button — so tabbing to ⏭ and pressing Space used to start
    // playback instead of jumping to the end.
    //
    // Scoping it by exclusion — "anywhere in .oa-wrap that is not a button, a
    // link or a field" — looked right and was empty. Everything focusable
    // inside this widget is a <button> (the family tabs and the five transport
    // controls), an <input> (the scrub, the speed slider and every panel field)
    // or a <select> (the algorithm picker, and whatever pickers a family puts
    // in its own panel), so the guard below and that button/link exclusion
    // covered the whole widget between them and togglePlay() could never be
    // reached.
    // The shortcut was not scoped, it was dead — and three of the roles the
    // exclusion listed ([role=checkbox], [role=switch], [role=radio]) match
    // nothing anywhere on this site in the first place.
    //
    // Ownership is stated positively instead, the way sortviz.js and synth.js
    // do it: the visible family stage is this widget's picture, it is given
    // tabIndex 0 where it is built above so a keyboard visitor can Tab to it,
    // and Space toggles playback only while that stage itself holds focus.
    // Everywhere else Space keeps both of its native jobs — including on the
    // ▶ Play button, which stays the other way to start and stop a run.
    //
    // The arrows keep the wider reach they always had: they have no native job
    // on a button, so stepping from wherever focus sits costs nothing.
    wrap.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); self.pause(); self.goto(self.frame + 1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); self.pause(); self.goto(self.frame - 1); }
      else if (ev.key === ' ') {
        if (ev.target !== self.stages[self.active]) return;
        ev.preventDefault();
        self.togglePlay();
      }
    });
  };

  Shell.prototype.select = function (i) {
    var self = this;
    this.pause();
    this.active = i;
    this.tabs.forEach(function (b, n) { b.className = 'oa-tab' + (n === i ? ' on' : ''); });
    this.panels.forEach(function (p, n) { p.className = 'oa-panel' + (n === i ? '' : ' oa-hidden'); });
    this.stages.forEach(function (p, n) { p.className = 'oa-stage' + (n === i ? '' : ' oa-hidden'); });

    var fam = this.families[i];
    clear(this.algoHost);
    var opts = fam.algoOptions();
    // A family with only one mode does not need a picker with one entry in it.
    this.algoGroup.className = opts.length > 1 ? 'oa-group' : 'oa-group oa-hidden';
    if (opts.length > 1) {
      this.algoHost.appendChild(selectBox(opts, fam.algoKey, function (v) {
        fam.algoKey = v;
        self.recompute(false);
      }));
    }
    this.recompute(false);
  };

  /* Recompute everything and, when asked, hold the current step so that
     nudging an input does not throw the visitor back to the first frame. */
  Shell.prototype.recompute = function (keepPosition) {
    var fam = this.families[this.active];
    var was = this.frame;
    var count;
    try {
      count = fam.compute();
    } catch (err) {
      this.showError('That input could not be simulated: ' + err.message);
      return;
    }
    this.total = Math.max(1, count || 1);
    this.frame = keepPosition ? Math.min(was, this.total - 1) : 0;
    this.scrub.max = String(this.total - 1);
    this.showError(fam.error);
    this.draw();
    this.renderCompare();
  };

  Shell.prototype.showError = function (msg) {
    if (msg) {
      this.errorBox.textContent = msg;
      this.errorBox.className = 'oa-error';
    } else {
      this.errorBox.textContent = '';
      this.errorBox.className = 'oa-error oa-hidden';
    }
  };

  Shell.prototype.draw = function () {
    var fam = this.families[this.active];
    fam.render(this.frame);
    this.noteBox.textContent = fam.note(this.frame) || '';
    this.scrub.value = String(this.frame);
    this.countBox.textContent = 'step ' + (this.frame + 1) + ' of ' + this.total;
    this.btnBack.disabled = this.frame <= 0;
    this.btnReset.disabled = this.frame <= 0;
    this.btnNext.disabled = this.frame >= this.total - 1;
    this.btnEnd.disabled = this.frame >= this.total - 1;
  };

  Shell.prototype.goto = function (i) {
    var was = this.frame;
    this.frame = Math.max(0, Math.min(this.total - 1, i));
    // Every caller of goto() is a deliberate transport gesture — a step button,
    // the scrub, an arrow key — so a frame that actually moved is the visitor
    // driving the simulation rather than looking at the still first frame the
    // page paints for everyone. The clamp above is why this is a comparison and
    // not an unconditional call: stepping past either end, or resetting while
    // already at the start, leaves the frame where it was and shows nothing new.
    if (this.frame !== was && window.KSLab) window.KSLab.used('run');
    this.draw();
  };

  Shell.prototype.play = function () {
    var self = this;
    if (this.frame >= this.total - 1) this.frame = 0;
    this.playing = true;
    this.btnPlay.textContent = '❚❚ Pause';
    this.btnPlay.className = 'oa-btn on';
    // A self-scheduling timeout rather than setInterval: the speed slider then
    // changes the gap before the next step, with no stale interval firing late.
    (function tick() {
      self.timer = setTimeout(function () {
        if (!self.playing) return;
        if (self.frame >= self.total - 1) { self.pause(); return; }
        self.frame++;
        self.draw();
        // Playback counts only from the first frame it genuinely advances, not
        // from the press of ▶: a family whose compute() produced a single frame
        // — an input it could not simulate, say — flips playing to true and then
        // pauses on the check above without ever reaching this line.
        if (window.KSLab) window.KSLab.used('run');
        tick();
      }, SPEEDS[Math.max(0, Math.min(9, self.speed - 1))]);
    })();
  };

  Shell.prototype.pause = function () {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.btnPlay) {
      this.btnPlay.textContent = '▶ Play';
      this.btnPlay.className = 'oa-btn';
    }
  };

  Shell.prototype.togglePlay = function () {
    if (this.playing) this.pause(); else this.play();
  };

  Shell.prototype.renderCompare = function () {
    var fam = this.families[this.active];
    clear(this.compareHost);
    var data;
    try {
      data = fam.compare();
    } catch (err) {
      data = null;
    }
    if (!data || !data.rows || !data.rows.length) {
      this.compareWrap.className = 'oa-comparewrap oa-hidden';
      return;
    }
    this.compareWrap.className = 'oa-comparewrap';
    this.compareTitle.textContent = data.title || 'Every algorithm on this same input';

    // Mark the winning value in the headline column: the comparison is the
    // point, so it should not need reading twice to see who won.
    var bestVal = null;
    if (typeof data.best === 'number') {
      data.rows.forEach(function (r) {
        var v = parseFloat(String(r.cells[data.best]));
        if (isNaN(v)) return;
        if (bestVal === null || (data.lower ? v < bestVal : v > bestVal)) bestVal = v;
      });
    }

    var rows = data.rows.map(function (r) {
      var cells = r.cells.map(function (c, i) {
        if (i === data.best && bestVal !== null && parseFloat(String(c)) === bestVal) {
          return E('span', 'oa-cell-best', String(c));
        }
        return c;
      });
      return { cls: r.key === fam.algoKey ? 'oa-row-cur' : '', cells: cells };
    });
    this.compareHost.appendChild(table(data.head, rows));
  };

  /* Boot helper: wait for the Labs consent gate, then build the shell into the
     named mount. Every lab on this chassis boots identically, and a module
     that throws while building says so on the page instead of leaving a blank
     rectangle and a console message nobody will read. */
  function boot(opts) {
    var built = false;
    function start() {
      if (built) return;
      var rootEl = document.getElementById(opts.rootId);
      if (!rootEl) return;
      built = true;
      var mount = document.getElementById(opts.mountId) || rootEl;
      clear(mount);
      try {
        return new Shell(mount, opts.families(), opts.css);
      } catch (err) {
        var msg = E('p', 'lab-proc-fallback',
          (opts.name || 'This visualiser') + ' could not start in this browser (' +
          err.message + '). Please tell me, and mention which browser you are using.');
        mount.appendChild(msg);
      }
    }
    if (typeof root.LabViz !== 'undefined' && root.LabViz.define) {
      root.LabViz.define({ id: opts.rootId, onReady: start });
    } else if (document.readyState !== 'loading') {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start);
    }
  }

  root.LabVizMulti = {
    C: C, FONT: FONT, PALETTE: PALETTE,
    el: E, clear: clear, table: table, button: button, field: field, group: group,
    numBox: numBox, textBox: textBox, selectBox: selectBox,
    parseList: parseList, round2: round2, pct: pct, colour: colour,
    Shell: Shell, boot: boot
  };
})(typeof self !== 'undefined' ? self : this);

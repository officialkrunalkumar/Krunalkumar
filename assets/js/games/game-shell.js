/* ==========================================================================
   game-shell.js — the one shell every game in /games runs inside.
   --------------------------------------------------------------------------
   labs/ has two shells already: tool-shell.js for the request/response
   forensics tools, and viz-shell.js for the live canvas toys. A game is
   closer to the second, but not close enough to share it, and the gap is
   worth writing down because it is the whole justification for a third file.

   A visualiser runs forever and cannot be lost. A game has runs: it starts,
   it can be paused, it ends, and the number it ends on is worth keeping.
   That single difference drags in a state machine, an overlay, a score, a
   personal best, a restart, and — because half this site's visitors are on a
   phone — a thumb-sized control pad. None of that belongs in viz-shell,
   which would have to grow it for nothing.

   Six decisions that shape everything below:

   1. NO CONSENT GATE. Every lab opens behind one, because a lab either
      executes code you wrote or reads a file you dropped, and saying so
      before it happens is the point of the section. A game does neither. It
      reads nothing, uploads nothing and runs nothing of yours, so a gate
      here would be a modal with no claim behind it — friction pretending to
      be integrity. The promise still gets made, in the page copy, where a
      visitor can read it without having to dismiss it first.

   2. FIXED TIMESTEP, not per-frame movement. `update(dt)` is called on a
      fixed 1/120 s accumulator and `draw()` once per frame. Tie a game to
      requestAnimationFrame's cadence instead and Snake runs at 2.4x on a
      144 Hz laptop and half speed on a throttled tab — the same code, a
      different game, decided by hardware nobody chose.

   3. THE ACCUMULATOR IS CLAMPED, and the loop auto-pauses when the tab
      hides or the window blurs. Without the clamp, coming back to a
      backgrounded tab hands the loop 40 seconds of owed time, it simulates
      all of it before the next paint, and the visitor watches themselves
      die during a frame they never saw. MAX_CATCHUP is the cap; anything
      beyond it is dropped, which is the honest choice — time the game did
      not get to render is time it should not get to simulate.

   4. GAMES DRAW IN LOGICAL UNITS. Each game declares a width and height
      (Snake: 320x320) and always draws in that coordinate space. The shell
      owns the rest: it sizes the backing store to the CSS box times
      devicePixelRatio, then sets a transform so 0..320 maps onto it. A game
      never sees a device pixel, never reads devicePixelRatio, and stays
      crisp on a phone and a 5K display without knowing either exists.

   5. SOUND IS SYNTHESISED, NEVER A FILE. Same rule party-sound.js and
      buddha-sound.js already follow. A WebAudio oscillator costs nothing to
      ship, cannot be blocked as a third-party asset, and means /games adds
      zero media bytes to the repository. The context is created on the first
      real gesture, because browsers refuse one created before that, and the
      toggle defaults to OFF — a page that makes noise unasked is a page
      people close.

   6. BESTS ARE LOCAL AND SAID TO BE LOCAL. `localStorage`, namespaced
      `game.<slug>.best`. There is no server, so there is no leaderboard, so
      nothing here is ever labelled one — the pages say "your best on this
      device", which is exactly what it is. Clearing site data clears it, and
      that is a feature.

   Written to the same ES5 house rules as the rest of assets/js: no const or
   let, no arrow functions, no generators. The CSP is script-src 'self' with
   no unsafe-eval, so nothing here builds code from a string.
   ========================================================================== */

(function (root) {
  'use strict';

  var PREFIX = 'game.';

  /* One fixed step is 1/120 s. Chosen rather than 1/60 because several games
     want sub-frame precision on collisions (Breakout's ball against a corner
     brick) and 120 Hz costs nothing on a machine that can already paint. */
  var STEP = 1 / 120;

  /* Never simulate more than a quarter second of owed time in one frame.
     See decision 3 in the header. */
  var MAX_CATCHUP = 0.25;

  /* Backing-store cap. A 4K display with dpr 2 would otherwise ask for an
     8000px-wide canvas for a game that draws 320 units of content, which is
     megabytes of texture for no visible gain. */
  var MAX_DPR = 2;

  /* ==================================================================
     Storage
     ==================================================================
     Lives in game-storage.js, which every game page loads immediately
     before this file, because the hub at /games needs the same code
     without needing the engine. See that file for why localStorage is
     the most private option that actually survives a reload, and for
     why the opt-out flag is itself the one key that must remain.

     Held in a local so the rest of this file reads unchanged, and so a
     missing script tag fails loudly here rather than as a confusing
     undefined ten functions later. */
  var Storage = root.GameStorage;
  if (!Storage) {
    throw new Error('game-shell.js: game-storage.js must be loaded first');
  }
  var read = Storage.read;
  var write = Storage.write;

  /* ------------------------------------------------------------------
     Key naming. The game asks for 'up', not for 'ArrowUp'.

     ARROWS ONLY — NO LETTER IS EVER BOUND. This started as the usual
     arcade map (WASD to move, P to pause, R to restart, C to hold) and
     every one of those letters had to come out, for three reasons that
     each independently settle it:

       - The typing trainer is a game on this same shell, and a shell
         that eats R and P can never host one. "Practise your typing,
         except the letters we took" is not a feature you can ship.

       - Single letters are the site's own shortcut vocabulary: "/"
         opens the search overlay from anywhere. Games quietly claiming
         a dozen more makes the page's behaviour depend on which
         element happens to hold focus, which is exactly the kind of
         thing nobody can debug from a bug report.

       - A visitor typing in ANY field inside a game page — a name in
         the love calculator, a guess in a word game — would otherwise
         be firing game commands with every keystroke.

     So: the four arrows, Space and Enter for the one action, and
     Escape to pause. Nothing that is a letter, and nothing a browser
     or an assistive tool wants for itself. Everything a letter used to
     do has a real button in the toolbar, which is where a discoverable
     control belongs anyway.
     ------------------------------------------------------------------ */
  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    ' ': 'action', Spacebar: 'action', Enter: 'action',
    Escape: 'pause'
  };

  /* The keys the shell swallows so the page does not scroll underneath a
     running game. Everything else is left alone — a visitor must always be
     able to Tab out, and Ctrl/Cmd combinations must reach the browser. */
  var SWALLOW = { up: 1, down: 1, left: 1, right: 1, action: 1 };

  function named(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    return KEYMAP[event.key] || null;
  }

  /* ------------------------------------------------------------------
     Audio. One shared context per page, built lazily on the first gesture.
     ------------------------------------------------------------------ */
  function Audio() {
    this.ctx = null;
    this.on = read('sound', 'off') === 'on';
  }

  Audio.prototype.ensure = function () {
    if (this.ctx) return this.ctx;
    var Ctor = root.AudioContext || root.webkitAudioContext;
    if (!Ctor) return null;
    try { this.ctx = new Ctor(); } catch (err) { this.ctx = null; }
    return this.ctx;
  };

  /* A short shaped tone. The envelope matters more than the waveform: a bare
     gain switch clicks audibly at both ends, so both edges are ramped. */
  Audio.prototype.beep = function (freq, dur, type, level) {
    if (!this.on) return;
    var ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, now);
    var peak = level == null ? 0.06 : level;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.09));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (dur || 0.09) + 0.02);
  };

  /* A downward sweep for a lost run, an upward one for a won level. Both are
     the same three lines; only the direction differs. */
  Audio.prototype.sweep = function (from, to, dur) {
    if (!this.on) return;
    var ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + dur);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  };

  /* ------------------------------------------------------------------
     A small seeded PRNG (mulberry32). Needed by the daily puzzles, where
     everyone must get the same board from the same date, and by anything
     that wants a reproducible run. Math.random cannot be seeded.
     ------------------------------------------------------------------ */
  function seeded(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var x = t;
      x = Math.imul(x ^ (x >>> 15), 1 | x);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Days since the epoch, in the visitor's own timezone. The daily games key
     off this so "today's puzzle" changes at the visitor's midnight rather
     than at UTC's — a player in India should not get tomorrow's board at
     5:30 in the morning. */
  function dayNumber() {
    var now = new Date();
    return Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000) +
           now.getFullYear() * 1000;
  }

  /* ==================================================================
     The Game instance.
     ================================================================== */
  function Game(spec) {
    this.spec = spec;
    this.el = document.getElementById(spec.id);
    if (!this.el) return;

    this.slug = spec.slug || spec.id.replace(/^game-/, '');
    this.W = spec.width || 320;
    this.H = spec.height || 320;
    this.state = 'idle';        // idle | playing | paused | over
    this.score = 0;
    this.audio = new Audio();
    this.rng = Math.random;
    this.held = {};
    this.dir = { x: 0, y: 0 };
    this._raf = null;
    this._acc = 0;
    this._last = 0;
    this._stats = {};
    this._hooks = {};

    this.canvas = this.el.querySelector('.game-canvas');
    this.board = this.el.querySelector('.game-board');
    this.stage = this.el.querySelector('.game-stage');
    this.overlay = this.el.querySelector('.game-overlay');

    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.canvas.setAttribute('role', 'img');
      if (!this.canvas.getAttribute('aria-label')) {
        this.canvas.setAttribute('aria-label', (spec.title || this.slug) + ' playfield');
      }
    }

    /* WHERE THE KEYBOARD LANDS. Key handling is bound to the shell element,
       so a keystroke only reaches the game if focus is somewhere inside it
       — that is what stops a game eating the arrow keys of someone reading
       the article below it. Which means the playfield has to be focusable
       and has to actually take focus when a run starts, or the game is
       unplayable by keyboard on its own page.

       Neither a <canvas> nor a <div> is focusable by default, so whichever
       one this game uses gets tabindex here. Doing it in script rather than
       in the generated markup is deliberate: without JavaScript there is no
       game, and a tab stop on a dead canvas is a trap. */
    this.focusTarget = this.canvas || this.board;
    if (this.focusTarget && !this.focusTarget.hasAttribute('tabindex')) {
      this.focusTarget.setAttribute('tabindex', '0');
    }

    /* HUD cells are markup, not JS-built: they must be correct at first
       paint and must not reflow when the script arrives. */
    var cells = this.el.querySelectorAll('[data-stat]');
    for (var i = 0; i < cells.length; i++) {
      this._stats[cells[i].getAttribute('data-stat')] = cells[i];
    }

    this.bestKey = spec.bestKey === null ? null : (spec.bestKey || this.slug);
    this.bestOrder = spec.bestOrder || 'high';
    this.best = this.bestKey ? Number(read(this.bestKey + '.best', 0)) || 0 : 0;
    if (this.bestKey) this.stat('best', this.formatBest(this.best));

    this.bindControls();
    this.bindLifecycle();

    /* setup() returns the game's own hooks. Called last, so everything it
       might touch on `this` already exists. */
    this.hooks = (spec.setup && spec.setup(this)) || {};

    /* reset() BEFORE fit(), and this order is load-bearing. fit() ends by
       painting a frame so the playfield is never blank behind the Play
       overlay — but a game's draw() reads the state reset() builds. With
       fit() first, Tetris drew a 20-row grid that did not exist yet and
       threw on the first row. Build the state, then measure, then paint. */
    if (this.hooks.reset) this.hooks.reset();
    this.fit();
    this.render();

    /* Most games open behind a Play screen, which is right when there is a
       run to begin and a set of controls to mention. It is wrong for the
       ones that are really a form — the love calculator, the quizzes —
       where "Ready? / Play" is a door in front of a door. Those set
       autoStart and go straight to the thing. */
    if (this.spec.autoStart) this.start();
    else this.showOverlay('start');

    if (this.hooks.ready) this.hooks.ready();
  }

  /* ------------------------------------------------------------------
     Sizing.
     ------------------------------------------------------------------
     THE CANVAS'S CSS SIZE IS SET HERE, IN PIXELS, AND NOT BY CSS.

     That is not a preference, it is the fix for a circular dependency the
     first version of this file walked straight into. The stylesheet had
     the canvas at `width: auto; height: auto; aspect-ratio: W/H`, and this
     function measured the canvas and set its backing store from that
     measurement. But `width: auto` on a replaced element means "use your
     intrinsic size", and a canvas's intrinsic size IS its backing store.
     So the box sized the buffer, and the buffer sized the box: on a
     display with devicePixelRatio 1.25 the canvas grew 25% on every fit,
     starting from the 300x150 default and never once consulting the space
     it was actually in. Entering fullscreen changed nothing, because
     nothing in that loop ever read the container. That is the whole reason
     it was off the bottom of the screen.

     So: measure the STAGE (a plain block whose height CSS owns and which
     therefore has an opinion of its own), fit the largest W:H box inside
     it, and write that size onto the canvas explicitly. One direction, no
     loop, identical arithmetic in fullscreen and out — fullscreen is then
     just a stage that happens to be the size of the screen.

     The ResizeObserver watches the stage for the same reason. Observing
     the canvas would fire on the size this function had just written,
     which is the loop again wearing a different hat.
     ------------------------------------------------------------------ */
  Game.prototype.fit = function () {
    if (!this.canvas || !this.stage) return;

    /* Content box of the stage: clientWidth/Height include padding, so the
       padding comes back off. Border and scrollbars are already excluded. */
    var cs = root.getComputedStyle(this.stage);
    var padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var availW = this.stage.clientWidth - padX;
    var availH = this.stage.clientHeight - padY;
    if (availW <= 0 || availH <= 0) return;

    /* The largest W:H box that fits. Whichever axis binds first decides,
       which is what makes a tall game (Tetris, 200x400) and a wide one
       (Breakout, 400x300) both correct on the same screen. */
    var fit = Math.min(availW / this.W, availH / this.H);
    var cssW = Math.max(1, Math.floor(this.W * fit));
    var cssH = Math.max(1, Math.floor(this.H * fit));

    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    var dpr = Math.min(root.devicePixelRatio || 1, MAX_DPR);
    var bw = Math.round(cssW * dpr);
    var bh = Math.round(cssH * dpr);
    /* Assigning width/height clears the canvas and resets its state, so it
       is done only when the value actually changed — otherwise every
       resize event would blank a running game for a frame. */
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }

    /* Logical units to device pixels. No letterbox offset is needed: the
       canvas box is now exactly W:H, so the drawing fills it exactly. */
    this.scale = bw / this.W;
    this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.ctx.imageSmoothingEnabled = !this.spec.pixel;
    this.render();
  };

  /* Turn a pointer/mouse event into logical game coordinates. Every game
     that accepts clicks on the canvas goes through this rather than doing
     its own arithmetic against a stale bounding box. Reads the live rect
     rather than the cached scale, so it stays correct mid-resize. */
  Game.prototype.pointAt = function (event) {
    var rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) * (this.W / rect.width),
      y: (event.clientY - rect.top) * (this.H / rect.height)
    };
  };

  /* ------------------------------------------------------------------
     Controls: keyboard on the shell element, the on-screen pad, and the
     three chrome buttons.
     ------------------------------------------------------------------ */
  /* A keystroke aimed at a text field, a select or a button is that
     control's business, not the game's. Without this the love calculator
     could not accept a space in a name and Enter inside any input would
     restart the run underneath it. */
  function fromFormField(event) {
    var t = event.target;
    if (!t || t === document) return false;
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return true;
    return !!t.isContentEditable;
  }

  /* Whether the shell should ignore a key because of where it came from.

     fromFormField() answers "is this a control?" and that is the right
     question for Space and Enter, which ACTIVATE a focused button and must
     not also be read as a game command. It is the wrong question for the
     arrow keys.

     Clicking any control leaves focus on it — that is what browsers do — so
     after pressing Hold in Tetris, Roll in Ludo, "Shoot an arrow" in Wumpus
     or "Back to orders" in Trek, the arrows were being dropped and the game
     stopped responding until the player thought to click the playfield. Half
     a dozen games looked broken for the same reason, and the reason was one
     line treating a button like a text box.

     So arrows pass through from BUTTONS, which have no use for them, and are
     still withheld from anything that types or that uses arrows itself: a
     text field, a textarea, a <select> (where arrows change the value), and
     contenteditable. */
  /* The commands a focused BUTTON is allowed to pass through to the game.
     Escape earns its place beside the arrows: the pause overlay prints
     "Press Escape to carry on" and then puts the keyboard on its own Resume
     button, so the very next Escape came from a button and was dropped — the
     overlay was giving an instruction that the shell then refused to obey.
     Space and Enter stay out, and that asymmetry is the whole point: those
     two ACTIVATE the focused button, so passing them on as well would fire
     the button and the game command from one press. Escape activates
     nothing, so there is nothing to collide with. */
  var PASS_FROM_BUTTON = { up: 1, down: 1, left: 1, right: 1, pause: 1 };

  function shellShouldIgnore(event, name) {
    var t = event.target;
    if (!t || t === document) return false;
    var tag = (t.tagName || '').toLowerCase();
    if (t.isContentEditable) return true;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (tag === 'button') return !PASS_FROM_BUTTON[name];
    return false;
  }

  Game.prototype.bindControls = function () {
    var self = this;

    /* Bound to the shell, not to window. Keys reach a game only when the
       game has focus, so arrow keys still scroll the article below it and
       a visitor can always Tab away from a running game.

       `rawInput` opts a game out completely: the typing trainer needs every
       keystroke, including the arrows and Escape, and a shell reading over
       its shoulder would be a bug in both directions. */
    if (!this.spec.rawInput) {
      this.el.addEventListener('keydown', function (event) {
        var name = named(event);
        if (!name) return;
        if (shellShouldIgnore(event, name)) return;
        if (SWALLOW[name]) event.preventDefault();
        if (event.repeat && name !== 'left' && name !== 'right' && name !== 'up' && name !== 'down') return;
        self.press(name, event);
      });

      this.el.addEventListener('keyup', function (event) {
        var name = named(event);
        if (!name) return;
        if (shellShouldIgnore(event, name)) return;
        self.held[name] = false;
        if (self.hooks.release) self.hooks.release(name);
      });

    /* ----------------------------------------------------------------
       The last resort: keys that arrive with focus on <body>.

       Several games move focus onto a control and then take that control
       away — Ludo disables the Roll button the moment the turn passes,
       guess-the-algorithm hides "Next round" when the next round starts,
       Memory disables a card when its pair is matched. When the browser
       loses the element holding focus it drops focus to <body>, which is
       OUTSIDE this.el, so the listener above never fires again and the
       game stops responding until the player thinks to click it.

       Fixing each site individually is whack-a-mole; the shell can simply
       answer keys that fall through. Three conditions keep this narrow:

         - only while a run is actually in progress,
         - only when focus is on <body>, so it can never take a key from
           the site search, another control, or a paused game, and
         - only when the playfield is actually on screen, so a visitor who
           has scrolled down to read the page below can still use the
           arrow keys to scroll, which is the one thing that would make
           this a worse bug than the one it fixes.
       ---------------------------------------------------------------- */
    var self2 = this;
    document.addEventListener('keydown', function (event) {
      if (self2.state !== 'playing') return;
      if (document.activeElement !== document.body) return;
      var name = named(event);
      if (!name) return;
      /* The STAGE, not this.el. The game root wraps the whole article --
         the facts list, the FAQ, everything below the board -- so measuring
         it reported "on screen" almost anywhere on the page and the guard
         never actually guarded. The playfield is the thing whose visibility
         means the player is looking at the game. */
      var stage = self2.stage || self2.canvas || self2.board || self2.el;
      var box = stage.getBoundingClientRect();
      var onScreen = box.bottom > 0 && box.top < (window.innerHeight || 0);
      if (!onScreen) return;
      if (SWALLOW[name]) event.preventDefault();
      self2.press(name, event);
    });

    }

    /* The pad. pointerdown/up rather than click so holding a direction
       works, and pointercancel so a finger dragged off the button does not
       leave it stuck down — the commonest way a touch D-pad goes wrong. */
    var pads = this.el.querySelectorAll('[data-key]');
    for (var i = 0; i < pads.length; i++) {
      (function (btn) {
        var key = btn.getAttribute('data-key');
        var down = function (event) {
          event.preventDefault();
          self.press(key, event);
        };
        var up = function () {
          self.held[key] = false;
          if (self.hooks.release) self.hooks.release(key);
        };
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('pointerleave', up);
        /* Belt and braces on engines that fire touch but not pointer. */
        btn.addEventListener('touchstart', down, { passive: false });
        btn.addEventListener('touchend', up);
      })(pads[i]);
    }

    var byId = function (id) { return self.el.querySelector('#' + id); };

    this.startBtn = byId('game-start');
    this.pauseBtn = byId('game-pause');
    this.restartBtn = byId('game-restart');
    this.soundBtn = byId('game-sound');
    this.fsBtn = byId('game-fullscreen');
    this.againBtn = byId('game-again');
    this.resumeBtn = byId('game-resume');

    if (this.startBtn) this.startBtn.addEventListener('click', function () { self.start(); });
    if (this.againBtn) this.againBtn.addEventListener('click', function () { self.start(); });
    if (this.restartBtn) this.restartBtn.addEventListener('click', function () { self.start(); });
    if (this.pauseBtn) this.pauseBtn.addEventListener('click', function () { self.togglePause(); });
    /* ----------------------------------------------------------------
       Hand the keyboard back after a dropdown is used with the mouse.

       A focused <select> owns the arrow keys — that is correct, it is how
       you change the value without opening it. The problem is what happens
       after: pick a new ghost speed in Pac-Man, or new traffic in ATC, and
       focus stays on the dropdown, so the arrows keep retuning the setting
       and the game cannot be steered any more. Nothing tells the player
       why, and clicking the playfield is not an obvious cure for "my arrow
       keys stopped working".

       Only POINTER-driven changes hand focus back. A keyboard user moving
       through the options fires 'change' on every arrow press in some
       browsers, and yanking focus away mid-choice would be a far worse bug
       than the one being fixed — they would be unable to reach the option
       they wanted. The pointerdown flag is what tells the two apart, and
       blur clears it so a click that opens the list but changes nothing
       cannot leave it armed.
       ---------------------------------------------------------------- */
    var selects = this.el.querySelectorAll('.game-toolbar select');
    for (var si = 0; si < selects.length; si++) {
      (function (sel) {
        var byPointer = false;
        sel.addEventListener('pointerdown', function () { byPointer = true; });
        sel.addEventListener('blur', function () { byPointer = false; });
        sel.addEventListener('change', function () {
          if (!byPointer) return;
          byPointer = false;
          if (self.state === 'playing') self.takeFocus();
        });
      })(selects[si]);
    }

    /* Resume, not restart. The distinction is the whole reason this button
       exists separately from 'Play again'. */
    if (this.resumeBtn) this.resumeBtn.addEventListener('click', function () { self.resume(); });

    if (this.soundBtn) {
      /* aria-pressed drives both the assistive-tech state and which of the
         button's two icons games.css shows, so setting it is the whole
         update — there is no icon swapping to do here. */
      var syncSound = function () {
        self.soundBtn.setAttribute('aria-pressed', String(self.audio.on));
        self.soundBtn.title = self.audio.on
          ? 'Sound is on — click to mute'
          : 'Sound is off — click to turn it on';
      };
      syncSound();
      this.soundBtn.addEventListener('click', function () {
        self.audio.on = !self.audio.on;
        write('sound', self.audio.on ? 'on' : 'off');
        syncSound();
        /* Turning it on plays one note, so the button proves itself
           immediately instead of promising sound you have to earn. */
        if (self.audio.on) self.audio.beep(660, 0.07, 'sine');
      });
    }

    this.bindFullscreen();
    this.bindStageTap();
    this.bindDataStrip();
  };

  /* THE RESET STRIP under each game. A best score that cannot be cleared
     is a small thing the visitor has no control over, and "clear your
     whole browser's site data" is not a control, it is a threat. This is
     one button that removes exactly what this one game kept — its best,
     and any difficulty or saved board it also holds.

     It also states the count, so the reset is verifiable rather than a
     button you press hopefully. */
  Game.prototype.bindDataStrip = function () {
    var self = this;
    var strip = this.el.querySelector('.game-data');
    if (!strip) return;

    var readout = strip.querySelector('[data-best-readout]');
    var btn = strip.querySelector('#game-reset-best');
    var note = strip.querySelector('[data-reset-note]');

    var refresh = function () {
      if (!Storage.enabled()) {
        if (readout) readout.textContent = 'nothing is being stored';
        if (btn) btn.disabled = true;
        return;
      }
      var stored = Storage.list().filter(function (r) { return r.slug === self.slug; });
      if (readout) {
        readout.textContent = self.bestKey && self.best
          ? String(self.formatBest(self.best))
          : (stored.length ? 'settings only' : 'nothing yet');
      }
      if (btn) btn.disabled = stored.length === 0;
    };

    if (btn) {
      btn.addEventListener('click', function () {
        var n = Storage.clearGame(self.slug);
        self.best = 0;
        if (self.bestKey) self.stat('best', self.formatBest(0));
        if (note) {
          note.textContent = n
            ? 'Cleared ' + n + ' ' + (n === 1 ? 'entry' : 'entries') + ' for this game.'
            : 'There was nothing stored for this game.';
        }
        refresh();
      });
    }

    this._refreshDataStrip = refresh;
    refresh();
  };

  /* TAP THE PLAYFIELD TO ACT.
     The pad gives a phone player directions and one Action button, but a
     thumb-sized button in the corner is the wrong target for the games whose
     entire input is "now" — jumping a crater, launching a ball, flapping.
     On those, the natural gesture is to tap the thing you are looking at.

     So a tap anywhere on the stage fires 'action'. It is a TAP and not a
     press: anything that moves more than a few pixels or lasts longer than a
     moment is somebody swiping (Snake, 2048) or dragging (Breakout's bat),
     and must not also fire. Games that would be harmed by it set
     tapAction: false.

     Bound on the stage rather than the canvas so the whole letterboxed area
     works — on a phone the canvas can be a good deal narrower than the black
     around it, and missing the game by ten pixels should not mean missing
     the jump. */
  Game.prototype.bindStageTap = function () {
    if (this.spec.tapAction === false || !this.stage || this.board) return;
    var self = this;
    var start = null;

    this.stage.addEventListener('pointerdown', function (event) {
      /* Never steal a press aimed at the overlay's own buttons. */
      if (event.target.closest && event.target.closest('button, a, input, select')) { start = null; return; }
      start = { x: event.clientX, y: event.clientY, t: Date.now() };
    });

    this.stage.addEventListener('pointerup', function (event) {
      if (!start) return;
      var moved = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
      var held = Date.now() - start.t;
      start = null;
      if (moved > 14 || held > 400) return;      // a swipe or a drag, not a tap
      /* Which command a tap sends is per game, because "the obvious thing to
         do right now" is not always the Action button. In moon-buggy Action
         is the laser and the obvious thing is to JUMP, so it sets
         tapKey: 'up'. Defaulting to 'action' without this made the tap fire
         a laser while the on-screen hint promised a jump. */
      self.press(self.spec.tapKey || 'action', event);
    });

    this.stage.addEventListener('pointercancel', function () { start = null; });
  };

  /* Fullscreen is owned here rather than by lab-fullscreen.js, which looks
     for a .lab ancestor by design. Doing it in the shell also means the
     refit below happens in the one place that knows how to refit. */
  Game.prototype.bindFullscreen = function () {
    var self = this;
    var btn = this.fsBtn;
    if (!btn) return;
    var target = this.el;
    var request = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
    if (!request) { btn.hidden = true; return; }

    function current() {
      return document.fullscreenElement || document.webkitFullscreenElement ||
             document.msFullscreenElement || null;
    }

    btn.addEventListener('click', function () {
      if (current()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exit) exit.call(document);
      } else {
        var p = request.call(target);
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    });

    function sync() {
      var on = current() === target;
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen (Esc to exit)';
      /* The CSS box has changed but the backing store has not; deferred a
         frame because the new geometry is not final until layout runs. */
      setTimeout(function () { self.fit(); }, 60);
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    document.addEventListener('MSFullscreenChange', sync);
  };

  /* ------------------------------------------------------------------
     Lifecycle: resize, tab visibility, window blur.
     ------------------------------------------------------------------ */
  Game.prototype.bindLifecycle = function () {
    var self = this;

    /* Observe the STAGE, never the canvas — see the long note on fit().
       A ResizeObserver on the canvas fires on the size fit() just wrote,
       which is the circular dependency again. The stage's size is decided
       by CSS and by the viewport, so it is the honest input.

       ResizeObserver is used where it exists because the stage can change
       size with no window event at all: entering fullscreen, the mobile
       address bar collapsing, or the sound button wrapping the HUD onto a
       second line. The window listener stays as the fallback. */
    if (root.ResizeObserver && this.stage) {
      var ro = new ResizeObserver(function () { self.fit(); });
      ro.observe(this.stage);
    }
    root.addEventListener('resize', function () { self.fit(); });

    /* Auto-pause. A backgrounded tab gets no frames, so without this the
       accumulator is handed every second the visitor was away. */
    /* Both handlers must ask the same question.

       This one used to check only document.hidden, while the blur handler
       below checked spec.pauseOnBlur — so the flag worked when you clicked
       another window and did nothing when you switched tab, which is the more
       common way to leave a page. THIRTY-THREE games set pauseOnBlur: false
       and every one of them was paused on a tab switch regardless: the
       quizzes and the board games covered a half-answered question with a
       Paused panel, and the toys stopped the thing you left running to look
       at.

       Worse than the panel is what showOverlay() does after it, which is to
       move the keyboard onto the Resume button — so the love calculator took
       the caret out of a half-typed name. Coming back to your own sentence
       abandoned mid-word is a bigger interruption than the pause was there to
       prevent.

       Auto-pause earns its place on a game with a clock: a backgrounded tab
       stops firing animation frames, and the fixed-timestep loop would
       otherwise be handed a minute of owed simulation to catch up on at once.
       That is why it stays the default and why only games that opt out are
       exempted here. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && self.state === 'playing' && self.spec.pauseOnBlur !== false) self.pause(true);
    });
    root.addEventListener('blur', function () {
      if (self.state === 'playing' && self.spec.pauseOnBlur !== false) self.pause(true);
    });
  };

  /* ------------------------------------------------------------------
     Input dispatch.
     ------------------------------------------------------------------ */
  Game.prototype.press = function (name, event) {
    /* Pause and restart work from any state, including the game-over
       screen, so a visitor never has to reach for the mouse to try again. */
    if (name === 'pause') { this.togglePause(); return; }
    if (name === 'restart') { this.start(); return; }

    /* Action on an overlay means "get on with it" — start, or start again.
       This is why Space and Enter both map to 'action'. */
    if (this.state !== 'playing') {
      if (name === 'action') { this.start(); }
      return;
    }

    this.held[name] = true;
    if (name === 'up') { this.dir.x = 0; this.dir.y = -1; }
    else if (name === 'down') { this.dir.x = 0; this.dir.y = 1; }
    else if (name === 'left') { this.dir.x = -1; this.dir.y = 0; }
    else if (name === 'right') { this.dir.x = 1; this.dir.y = 0; }

    if (this.hooks.key) this.hooks.key(name, event);
  };

  /* ------------------------------------------------------------------
     State machine.
     ------------------------------------------------------------------ */
  Game.prototype.start = function () {
    this.hideOverlay();
    this.score = 0;
    this.stat('score', 0);
    this.held = {};
    this.dir = { x: 0, y: 0 };
    this.state = 'playing';
    this._acc = 0;
    this._last = 0;
    if (this.hooks.reset) this.hooks.reset();
    if (this.pauseBtn) { this.pauseBtn.disabled = false; this.pauseBtn.textContent = 'Pause'; }
    this.takeFocus();
    this.run();
  };

  /* ------------------------------------------------------------------
     Taking focus at the start of a run.

     The playfield is focused so the first keystroke lands on the game
     rather than on the Start button that has just vanished underneath
     the pointer.

     UNLESS THE GAME HAS ALREADY PUT FOCUS IN A FIELD OF ITS OWN. The
     typed games — typing trainer, typespeed, shell quest, arithmetic,
     subnet sprint, ctf arcade, memory span, name in binary — all create
     a real <input> and focus it from reset(), which runs immediately
     before this. Focusing the board here took it straight back, so the
     first thing the player typed went nowhere.

     The symptom was a game displaying "click here and start typing"
     that then ignored everything typed at it until the board was
     actually clicked, which is a bad enough bug on its own and a
     genuinely infuriating one on a game whose entire subject is typing.

     Only a TYPED field counts. A focused <button> must not suppress
     this: the overlay's Play button is inside this.el and holds focus
     at the exact moment start() runs, and treating that as "the game
     wants focus here" would leave every game in the section focused on
     a button that is about to be hidden.
     ------------------------------------------------------------------ */
  function isTypedField(node) {
    if (!node) return false;
    var tag = (node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return true;
    return !!node.isContentEditable;
  }

  Game.prototype.takeFocus = function () {
    var active = document.activeElement;
    if (active && isTypedField(active) && this.el && this.el.contains(active)) return;

    /* A game that plays through a text field gets that field back, not the
       playfield behind it.

       Skipping only when the field ALREADY has focus was not enough. Pausing
       moves focus to the overlay's Resume button, so by the time resume()
       runs the field has lost it and this focused the board instead — and
       every typed game died on its first pause. Typing trainer and subnet
       sprint kept counting down against a player whose keystrokes were going
       nowhere; shell quest's terminal simply stopped answering.

       Found by QUERY rather than by remembering the last focused element.
       The obvious version of this listened for focusin and cached whatever
       had focus, which is wrong in a way worth recording: focus events do not
       fire while the document itself is unfocused (a background tab, a window
       that has lost OS focus), so the cache was empty exactly when a player
       tabbed away mid-run and came back — the case that matters most. A query
       has no such state to be missing.

       '.typing-catch' is the shared class the seven typed games already give
       their hidden input, so nothing needs a per-game hook. It is deliberately
       matched on the game root and not on the stage: the terminal games append
       theirs to g.el, beside the stage rather than inside it. */
    var typed = this.el ? this.el.querySelector('input.typing-catch') : null;
    if (typed && !typed.disabled && typed.offsetParent !== null) {
      try { typed.focus({ preventScroll: true }); } catch (err) { typed.focus(); }
      return;
    }


    /* A quiz plays through its radiogroup, so that is where the keyboard
       belongs. quiz-kit already focuses the first option as it renders each
       question; focusing the board here took it straight back, and the five
       quiz games all shipped telling the player to use the up and down arrows
       on a control that did not have focus. They did nothing until the player
       thought to press Tab, which the page never mentions.

       The selected option wins over the first one, so returning to a question
       lands on the answer already given rather than resetting to the top. */
    var group = this.el ? this.el.querySelector('[role="radiogroup"]') : null;
    if (group) {
      var opt = group.querySelector('[role="radio"][aria-checked="true"]') ||
                group.querySelector('[role="radio"]');
      if (opt && !opt.disabled) {
        try { opt.focus({ preventScroll: true }); } catch (err) { opt.focus(); }
        return;
      }
    }

    if (!this.focusTarget) return;
    try { this.focusTarget.focus({ preventScroll: true }); }
    catch (err) { this.focusTarget.focus(); }
  };


  Game.prototype.pause = function (silent) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.stop();
    if (this.pauseBtn) this.pauseBtn.textContent = 'Resume';
    this.showOverlay('paused');
    if (!silent) this.audio.beep(330, 0.06, 'sine');
  };

  Game.prototype.resume = function () {
    if (this.state !== 'paused') return;
    this.hideOverlay();
    this.state = 'playing';
    this._last = 0;
    this._acc = 0;
    if (this.pauseBtn) this.pauseBtn.textContent = 'Pause';
    this.takeFocus();
    this.run();
  };

  Game.prototype.togglePause = function () {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
    else this.start();
  };

  /* End a run. `opts.won` picks the wording and the sound; `opts.score`
     overrides the running score for games that compute a final figure
     (a time, an accuracy) rather than accumulating one. */
  Game.prototype.over = function (opts) {
    if (this.state === 'over') return;
    opts = opts || {};
    this.state = 'over';
    this.stop();
    if (this.pauseBtn) { this.pauseBtn.disabled = true; this.pauseBtn.textContent = 'Pause'; }

    var final = opts.score == null ? this.score : opts.score;
    var isBest = false;
    if (this.bestKey && final > 0) {
      if (this.bestOrder === 'low') isBest = !this.best || final < this.best;
      else isBest = final > this.best;
      if (isBest) {
        this.best = final;
        write(this.bestKey + '.best', final);
        this.stat('best', this.formatBest(final));
        /* The strip under the game shows the same number, so it has to
           move at the same moment the HUD cell does. */
        if (this._refreshDataStrip) this._refreshDataStrip();
      }
    }

    if (opts.won) this.audio.sweep(440, 880, 0.35);
    else this.audio.sweep(320, 90, 0.5);

    this.showOverlay(opts.won ? 'won' : 'over', {
      score: final,
      best: isBest,
      title: opts.title,
      message: opts.message
    });
    if (this.hooks.ended) this.hooks.ended(final, isBest);
  };

  Game.prototype.formatBest = function (n) {
    return this.spec.formatBest ? this.spec.formatBest(n) : n;
  };

  /* ------------------------------------------------------------------
     The loop.
     ------------------------------------------------------------------ */
  Game.prototype.run = function () {
    var self = this;
    if (this._raf) return;
    var tick = function (now) {
      self._raf = root.requestAnimationFrame(tick);
      if (!self._last) { self._last = now; return; }
      var dt = (now - self._last) / 1000;
      self._last = now;
      if (dt > MAX_CATCHUP) dt = MAX_CATCHUP;
      self._acc += dt;
      var guard = 0;
      while (self._acc >= STEP && guard < 600) {
        if (self.hooks.update) self.hooks.update(STEP);
        self._acc -= STEP;
        guard++;
        /* update() may have ended the run. Stop stepping a dead game. */
        if (self.state !== 'playing') break;
      }
      self.render();
    };
    this._raf = root.requestAnimationFrame(tick);
  };

  Game.prototype.stop = function () {
    if (this._raf) { root.cancelAnimationFrame(this._raf); this._raf = null; }
  };

  /* draw() is separate from update() so a paused or finished game still
     paints — the overlay is translucent and the last frame shows through. */
  Game.prototype.render = function () {
    if (!this.ctx || !this.hooks || !this.hooks.draw) return;
    this.ctx.save();
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.hooks.draw(this.ctx, this.W, this.H);
    this.ctx.restore();
  };

  /* ------------------------------------------------------------------
     HUD and overlay.
     ------------------------------------------------------------------ */
  Game.prototype.stat = function (key, value) {
    var cell = this._stats[key];
    if (cell) cell.textContent = String(value);
  };

  Game.prototype.setScore = function (n) {
    this.score = n;
    this.stat('score', n);
  };

  Game.prototype.addScore = function (n) {
    this.setScore(this.score + n);
  };

  Game.prototype.showOverlay = function (kind, data) {
    if (!this.overlay) return;
    data = data || {};
    var titleEl = this.overlay.querySelector('[data-overlay="title"]');
    var textEl = this.overlay.querySelector('[data-overlay="text"]');
    var scoreEl = this.overlay.querySelector('[data-overlay="score"]');
    var bestEl = this.overlay.querySelector('[data-overlay="best"]');
    var startEl = this.overlay.querySelector('#game-start');
    var againEl = this.overlay.querySelector('#game-again');
    var resumeEl = this.overlay.querySelector('#game-resume');

    var titles = {
      start: this.spec.startTitle || 'Ready?',
      paused: 'Paused',
      over: data.title || 'Game over',
      won: data.title || 'You win'
    };
    var texts = {
      start: this.spec.startText || 'Nothing is uploaded and nothing is stored but your own best score, on this device.',
      paused: 'Press Escape to carry on, or use the button.',
      over: data.message || '',
      won: data.message || ''
    };

    if (titleEl) titleEl.textContent = titles[kind] || '';
    if (textEl) {
      textEl.textContent = texts[kind] || '';
      textEl.hidden = !texts[kind];
    }
    if (scoreEl) {
      var show = (kind === 'over' || kind === 'won') && data.score != null;
      scoreEl.hidden = !show;
      if (show) scoreEl.textContent = this.formatBest(data.score);
    }
    if (bestEl) bestEl.hidden = !data.best;
    if (startEl) startEl.hidden = kind !== 'start';
    /* "Play again" is for a run that has ENDED. Showing it on the pause
       overlay offered a restart as the obvious next action in the middle of
       a run somebody was still playing — and the focus line below then put
       the keyboard on it, so Escape-to-pause followed by Space or Enter
       silently threw the game away. That is the worst possible outcome for
       the two keys most likely to be pressed next. Pausing is resumed from
       the toolbar button or the same key that paused it, both of which the
       overlay text names. */
    if (againEl) againEl.hidden = kind === 'start' || kind === 'paused';
    if (resumeEl) resumeEl.hidden = kind !== 'paused';

    this.overlay.hidden = false;
    /* Move focus to whichever button is now the obvious next action, so a
       keyboard visitor is not left focused on a canvas that ignores them.
       While paused that is the toolbar's Resume button — the overlay itself
       deliberately offers nothing to press. */
    var focusTarget = kind === 'start' ? startEl : (kind === 'paused' ? resumeEl : againEl);
    if (focusTarget && !focusTarget.hidden) {
      try { focusTarget.focus({ preventScroll: true }); } catch (err) { focusTarget.focus(); }
    }
  };

  Game.prototype.hideOverlay = function () {
    if (this.overlay) this.overlay.hidden = true;
  };

  /* ------------------------------------------------------------------
     Helpers games reach for constantly.
     ------------------------------------------------------------------ */
  Game.prototype.beep = function (freq, dur, type, level) {
    this.audio.beep(freq, dur, type, level);
  };

  Game.prototype.sweep = function (from, to, dur) {
    this.audio.sweep(from, to, dur);
  };

  /* Namespaced per-game persistence for anything that is not the best
     score — a saved board, a streak, a difficulty preference. */
  Game.prototype.save = function (key, value) { return write(this.slug + '.' + key, value); };
  Game.prototype.load = function (key, fallback) { return read(this.slug + '.' + key, fallback); };

  Game.prototype.seed = function (n) { this.rng = seeded(n); return this.rng; };
  Game.prototype.rnd = function (n) { return Math.floor(this.rng() * n); };
  Game.prototype.pick = function (arr) { return arr[this.rnd(arr.length)]; };

  Game.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = this.rnd(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  /* ==================================================================
     Public entry point.
     ================================================================== */
  var GameShell = {
    define: function (spec) {
      var boot = function () { new Game(spec); };
      /* Scripts are deferred, so DOMContentLoaded has usually not fired
         yet for the last one in the document. Check rather than assume. */
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
      } else {
        boot();
      }
    },
    seeded: seeded,
    dayNumber: dayNumber,
    /* The data controls, used by the per-game reset strip below and by
       the panel on /games. Exposed rather than hidden because the point
       of them is that a visitor can check the claim for themselves. */
    storage: Storage,
    read: read,
    write: write
  };

  root.GameShell = GameShell;
})(typeof self !== 'undefined' ? self : this);

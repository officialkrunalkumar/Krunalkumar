/* ==========================================================================
   dos-app.js — boots FreeDOS in the browser with v86.
   --------------------------------------------------------------------------
   The honest answer to "can we have Windows cmd?": no, and not for a reason
   we could engineer around. Windows cannot be redistributed and is gigabytes;
   ReactOS boots under this emulator but is 500 MB+ and lands in a desktop.
   FreeDOS is a real, freely licensed operating system giving a genuine DOS
   prompt in 720 KB — the command language cmd.exe descends from. The page
   says DOS, not Windows, because that is what it is.

   WHY THIS RENDERS DIFFERENTLY FROM /labs/linux
   ---------------------------------------------
   The Linux image boots with console=ttyS0 and talks over the emulated serial
   port, so that page reads a byte stream and paints its own terminal.

   DOS does not. It writes straight to VGA memory, and — crucially — the disk
   also carries graphical programs: VIM, and the INVADERS / SNAKE / TETRIS
   games the boot banner advertises. Those switch the adapter into a graphics
   mode that has no text buffer at all. An earlier version of this file read
   v86's text rows and repainted them into a styled <div>; it looked right at
   the prompt and then showed nothing whatsoever when someone typed SNAKE, and
   it could not draw the hardware cursor either.

   So the pane does both: text mode is painted from get_text_row() into a
   styled <pre>, and graphics mode swaps in v86's own canvas, which it draws
   into directly. The switch is driven by 'screen-set-size' — this build emits
   only that and 'screen-put-char', so the 'screen-set-mode' event you would
   expect does not exist, and its third payload element (bit depth, 0 for text)
   is the actual mode flag.

   Keyboard: v86's adapter binds at the document, so it is toggled with
   keyboard_set_enabled() and only switched on while this lab holds focus —
   otherwise typing anywhere on the page would be swallowed by the machine.
   Paste still needs the offscreen textarea, because a paste event is never
   delivered to a non-editable element.
   ========================================================================== */

/* global V86, V86Starter, LabCache */
(function () {
  'use strict';

  var root = document.getElementById('dos');
  if (!root) return;

  var PREFIX = 'lab.';
  var MEMORY_MB = 32;          // more than a 1995 machine had; DOS cannot use much anyway

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    agree: $('lab-agree'), leave: $('lab-leave'),
    start: $('dos-start'), stop: $('dos-stop'), reset: $('dos-reset'),
    status: $('dos-status'), screen: $('dos-screen'), text: $('dos-text'),
    shadow: $('dos-shadow'), hint: $('dos-hint'),
    input: $('dos-input'),
    storeBtn: $('lab-storage-btn'), storePanel: $('lab-storage-panel'),
    storeRing: $('lab-meter-value'), storeSite: $('lab-store-site'),
    storeQuota: $('lab-store-quota'), storeBar: $('lab-store-bar'),
    storeClear: $('lab-store-clear')
  };

  var emulator = null;
  var booting = false;    // Boot pressed, emulator still on its way down
  var hasFocus = false;
  var graphical = false;
  var repaintTimer = null;
  var repaintQueued = false;

  var ROWS = 25;

  /* Read v86's text buffer and paint it ourselves, so the pane matches the
     rest of the site. get_text_row() is the reliable path: v86's own text
     <div> renders every cell black-on-black in this configuration. */
  function repaint() {
    repaintQueued = false;
    if (!emulator || graphical || !emulator.screen_adapter) return;

    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.screen.contains(sel.anchorNode)) {
      repaintQueued = true;
      setTimeout(repaint, 400);
      return;
    }

    var out = [];
    for (var row = 0; row < ROWS; row++) {
      var text = '';
      try { text = emulator.screen_adapter.get_text_row(row); } catch (err) { text = ''; }
      out.push(String(text == null ? '' : text).replace(/\s+$/, ''));
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    var pane = el.text;
    if (!pane) return;

    // A blinking block after the last line. get_text_row() carries no cursor
    // position and DOS parks its cursor after the prompt, so that is where
    // this goes — enough to show the machine is alive and waiting for input.
    // It only appears while the terminal holds the keyboard, which doubles as
    // the signal that typing will reach the machine rather than the page.
    var last = out.length ? out[out.length - 1] : '';
    var head = out.slice(0, -1).join('\n');
    pane.textContent = '';
    pane.appendChild(document.createTextNode(head + (out.length > 1 ? '\n' : '') + last));
    if (hasFocus) {
      var cursor = document.createElement('span');
      cursor.className = 'lab-cursor';
      cursor.textContent = ' ';
      pane.appendChild(cursor);
    }
    pane.scrollTop = pane.scrollHeight;
  }

  function queueRepaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    // setTimeout, not rAF: rAF is paused in a hidden tab.
    setTimeout(repaint, 40);
  }

  function setStatus(text, cls) {
    el.status.textContent = text;
    el.status.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  function humanBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  /* ======================================================================
     Consent gate — shares the Labs-wide flag
     ====================================================================== */
  /* The gate only paints over the lab: .lab-gate is position:absolute with an
     opaque background, so without this every control beneath it stays in the
     tab order and in the accessibility tree while the visitor is still being
     asked to agree. `inert` removes a subtree from focus, hit-testing and
     assistive tech in one property. Browsers without support ignore it, so
     this cannot regress anything. */
  function setGateInert(on) {
    var g = document.getElementById('lab-gate');
    if (!g || !root) return;
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== g) kids[i].inert = on;
    }
  }

  function initGate() {
    var agreed;
    try { agreed = localStorage.getItem(PREFIX + 'consent'); } catch (err) { agreed = null; }
    if (agreed === 'yes') { root.setAttribute('data-consent', 'granted'); return; }
    setGateInert(true);
    el.agree.addEventListener('click', function () {
      try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (err) {}
      root.setAttribute('data-consent', 'granted');
      setGateInert(false);
    });
    el.leave.addEventListener('click', function () { window.location.href = '/'; });
  }

  /* ======================================================================
     Storage meter
     ====================================================================== */
  function ownKeys() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) keys.push(k);
      }
    } catch (err) {}
    return keys;
  }

  var ALL_RUNTIME_BYTES = 150 * 1024 * 1024;

  function refreshMeter() {
    var bytes = ownKeys().reduce(function (total, k) {
      var v = '';
      try { v = localStorage.getItem(k) || ''; } catch (err) {}
      return total + (k.length + v.length) * 2;
    }, 0);
    el.storeSite.textContent = humanBytes(bytes);

    LabCache.stats().then(function (stats) {
      if (stats.unavailable) {
        el.storeQuota.textContent = 'not measurable in this browser';
      } else if (!stats.files) {
        el.storeQuota.textContent = 'none downloaded yet';
      } else {
        el.storeQuota.textContent = humanBytes(stats.bytes) + ' · ' + stats.files +
          (stats.files === 1 ? ' file' : ' files');
      }
      var pct = Math.min(100, ((stats.bytes || 0) / ALL_RUNTIME_BYTES) * 100);
      el.storeBar.style.width = pct.toFixed(1) + '%';
      el.storeRing.setAttribute('stroke-dasharray', (pct * 0.5027).toFixed(2) + ' 50.27');
    });
  }

  function initStorage() {
    el.storeBtn.addEventListener('click', function () {
      var open = el.storePanel.hidden;
      el.storePanel.hidden = !open;
      el.storeBtn.setAttribute('aria-expanded', String(open));
      if (open) refreshMeter();
    });
    document.addEventListener('click', function (event) {
      if (!el.storePanel.hidden && !el.storePanel.contains(event.target) &&
          !el.storeBtn.contains(event.target)) {
        el.storePanel.hidden = true;
        el.storeBtn.setAttribute('aria-expanded', 'false');
      }
    });

    var clearRuntimes = $('lab-store-clear-rt');
    if (clearRuntimes) {
      clearRuntimes.addEventListener('click', function () {
        clearRuntimes.disabled = true;
        clearRuntimes.textContent = 'Removing…';
        LabCache.clear().then(function () {
          clearRuntimes.disabled = false;
          clearRuntimes.textContent = 'Remove downloaded runtimes';
          refreshMeter();
        });
      });
    }

    el.storeClear.addEventListener('click', function () {
      ownKeys().forEach(function (k) { try { localStorage.removeItem(k); } catch (err) {} });
      root.setAttribute('data-consent', 'granted');
      setGateInert(false);
      refreshMeter();
    });
    refreshMeter();
  }

  /* ======================================================================
     The machine
     ====================================================================== */
  function Machine() {
    return (typeof V86 !== 'undefined') ? V86
         : (typeof V86Starter !== 'undefined') ? V86Starter : null;
  }

  /* libv86.js is not loaded with the page. It is 356 KB of parsed JavaScript,
     98 KB of it over the wire, and nothing here can reach it until Boot is
     pressed — so it is fetched at that moment instead of by a <script> tag in
     the markup. Most visitors read the page and never start a machine, and
     they should not pay for the emulator on the way past.

     An ordinary same-origin <script>, which is all script-src 'self' permits:
     no eval, no new Function. The promise is kept so a second Boot, or a
     Reboot, reuses the one element rather than injecting another, and a
     rejection drops it so the retry gets a fresh attempt instead of the same
     stale failure — the shape getSql() in hacklab.js already uses for sql.js. */
  var V86_SRC = '/assets/vendor/v86/libv86.js';
  var v86Ready = null;

  function loadV86() {
    if (!v86Ready) {
      v86Ready = new Promise(function (resolve, reject) {
        var already = Machine();
        if (already) { resolve(already); return; }
        var tag = document.createElement('script');
        tag.src = V86_SRC;
        tag.onload = function () {
          // Arrived but exported nothing. To the visitor that is the same
          // outcome as a download that never finished, so it takes the same
          // path rather than throwing out of `new Ctor` a moment later.
          var Ctor = Machine();
          if (Ctor) resolve(Ctor);
          else reject(new Error('libv86.js loaded without a V86 constructor'));
        };
        tag.onerror = function () {
          tag.remove();               // a dead tag; the retry appends its own
          reject(new Error('libv86.js failed to load'));
        };
        document.head.appendChild(tag);
      }).catch(function (err) {
        v86Ready = null;              // clear it so a retry gets a fresh attempt
        throw err;
      });
    }
    return v86Ready;
  }

  function setKeyboard(on) {
    hasFocus = on;
    root.classList.toggle('is-capturing', on);
    queueRepaint();   // the cursor appears/disappears with focus
    // v86's own adapter stays disabled: we send scancodes ourselves, and
    // leaving both active would double every keystroke.
    if (emulator && typeof emulator.keyboard_set_enabled === 'function') {
      try { emulator.keyboard_set_enabled(false); } catch (err) { /* pre-boot */ }
    }
  }

  function boot() {
    if (emulator || booting) return;
    booting = true;

    // Boot goes inert before the emulator has even arrived, so the download
    // window cannot be clicked into a second machine. Power off and Reboot are
    // already disabled and stay that way until there is something to act on.
    el.start.disabled = true;

    // Only narrate the emulator download when there is one to narrate: after
    // the first boot of the visit the file is here and this resolves at once.
    if (!Machine()) {
      setStatus('Downloading the emulator (~100 KB, cached after this)…', 'is-busy');
    }

    loadV86().then(startMachine, function (err) {
      booting = false;
      // No machine was built, so there is nothing for destroy() to tear down —
      // but Boot was switched off above and has to come back, or a failed
      // download leaves a dead button and no way forward.
      el.start.disabled = false;
      setStatus('Emulator failed to load', 'is-err');
      if (window.LabFail) {
        window.LabFail.show({
          anchor: el.screen, what: 'FreeDOS emulator',
          kind: window.LabFail.classify(err),
          retry: function () { boot(); }
        });
      }
    });
  }

  function startMachine(Ctor) {
    booting = false;
    el.stop.disabled = false;
    el.reset.disabled = false;
    if (el.hint) el.hint.hidden = true;
    setStatus('Loading the FreeDOS disk (~720 KB, cached after this)…', 'is-busy');

    emulator = new Ctor({
      wasm_path: '/assets/vendor/v86/v86.wasm',
      memory_size: MEMORY_MB * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      // v86 only builds its text-mode adapter — and get_text_row() with it —
      // when handed a screen container. Its own text <div> paints every cell
      // black-on-black here, so the container stays offscreen and we read the
      // buffer instead. Its <canvas> IS used, for graphics mode.
      screen_container: el.shadow,
      bios: { url: '/assets/vendor/v86/bios/seabios.bin' },
      vga_bios: { url: '/assets/vendor/v86/bios/vgabios.bin' },
      fda: { url: '/assets/vendor/v86/images/freedos722.img' },
      autostart: true
    });

    /* A disk image that never arrives used to leave the busy spinner and
       "Loading..." up forever: the only listeners registered were for a machine
       that had already started, so there was no path at all for a fetch that
       failed. v86 reports it, so say so and offer the retry.

       download-error carries { file_index, file_count, file_name, request }. */
    /* A stall watchdog, because download-error is not enough on its own.

       v86 emits download-error only from its XHR *progress* callback, and only
       when the response status is not 200 — so it catches a 404 or a 5xx. A
       genuine network failure takes a different path: xhr.onerror, which v86
       answers by retrying on a [1,1,2,3,5,8,13,21]s backoff, silently, forever.
       Nothing is emitted and the status line sits on "Loading…" indefinitely.

       So the only reliable signal is absence of forward motion. Any progress
       event, any serial byte and the started event all count as motion and push
       the deadline out; 90s with none of them means it is not coming. */
    var STALL_MS = 90000;
    var stallTimer = null;
    function motion() {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(function () {
        stallTimer = null;
        bootFailed('FreeDOS emulator stopped responding while loading');
      }, STALL_MS);
    }
    function clearStall() {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    }
    function bootFailed(message) {
      clearStall();
      destroy();
      setStatus(message, 'is-err');
      if (window.LabFail) {
        window.LabFail.show({
          anchor: el.screen, what: 'FreeDOS emulator', kind: 'network',
          retry: function () { boot(); }
        });
      }
    }

    // Arm it now. If the very first request dies on xhr.onerror there is
    // never a progress event, so waiting for one to start the clock would
    // leave exactly the failure this guards against unguarded.
    motion();

    emulator.add_listener('download-progress', function (info) {
      motion();
      if (info && info.lengthComputable && info.total) {
        var pct = Math.min(100, Math.round((info.loaded / info.total) * 100));
        setStatus('Downloading the FreeDOS disk — ' + pct + '%', 'is-busy');
      }
    });

    emulator.add_listener('download-error', function (info) {
      var name = (info && info.file_name) ? String(info.file_name).split('/').pop() : 'a machine file';
      // destroy(), not hand-toggled buttons. boot() opens with `if (emulator)
      // return;` and only destroy() sets emulator back to null, so re-enabling
      // Start on its own produces a button that does nothing. Worse, disabling
      // Stop by hand removes the Power-off recovery that DID work here before
      // this listener existed. destroy() tears down the half-loaded machine and
      // resets all three buttons to the state boot() expects.
      bootFailed('Could not download ' + name);
    });

    emulator.add_listener('emulator-started', function () {
      clearStall();
      setStatus('Booting FreeDOS…', 'is-busy');
      // Do not let the machine eat keystrokes before the visitor asks it to.
      setKeyboard(false);
    });

    var announced = false;
    emulator.add_listener('screen-put-char', function () {
      queueRepaint();
      if (announced) return;
      announced = true;
      // The emulated machine is writing to its own screen, which can only
      // happen once every image arrived and the CPU started running. The two
      // ways this lab fails — the emulator script never loading, and
      // bootFailed() from a dead download or the stall watchdog — both end
      // before a single character is ever put, so neither reaches this line.
      if (window.KSLab) window.KSLab.used('boot');
      setStatus('Ready — click the screen, then type', 'is-ok');
    });

    // Graphics mode — the games on this disk, and VIM — has no text buffer at
    // all, so the text pane is swapped for v86's canvas, which it draws into
    // directly.
    //
    // The signal is 'screen-set-size', NOT 'screen-set-mode': this build of
    // v86 emits only 'screen-put-char' and 'screen-set-size', so a
    // screen-set-mode listener is simply never called. The payload is
    // [width, height, bpp], and a bpp of 0 means text mode — that third
    // element is the whole mode flag.
    emulator.add_listener('screen-set-size', function (dims) {
      var isGraphical = !!(dims && dims.length > 2 && dims[2] !== 0);
      if (isGraphical === graphical) return;
      graphical = isGraphical;
      root.classList.toggle('is-graphical', graphical);

      var canvas = el.shadow ? el.shadow.querySelector('canvas') : null;
      if (!canvas) return;
      if (graphical) {
        canvas.style.display = 'block';
        el.screen.appendChild(canvas);        // move it into view
        setStatus('Graphics mode — click the screen, then use the keyboard', 'is-ok');
      } else {
        el.shadow.appendChild(canvas);        // park it again
        setStatus('Ready — click the screen, then type', 'is-ok');
        queueRepaint();
      }
    });

    if (repaintTimer) clearInterval(repaintTimer);
    repaintTimer = setInterval(function () { if (!graphical) queueRepaint(); }, 400);
  }

  function destroy() {
    if (repaintTimer) { clearInterval(repaintTimer); repaintTimer = null; }
    if (!emulator) return;
    try {
      emulator.stop();
      if (typeof emulator.destroy === 'function') emulator.destroy();
    } catch (err) { /* already gone */ }
    emulator = null;
    setKeyboard(false);
    graphical = false;
    root.classList.remove('is-graphical');
    if (el.text) el.text.textContent = '';
    // v86 leaves its last frame behind; reset the shadow to the structure it
    // expects so a reboot starts clean.
    if (el.shadow) {
      el.shadow.innerHTML =
        '<div style="white-space: pre; font: 14px monospace; line-height: 14px"></div>' +
        '<canvas style="display: none"></canvas>';
    }
    el.start.disabled = false;
    el.stop.disabled = true;
    el.reset.disabled = true;
  }

  /* Keyboard -> scancodes.
     -----------------------------------------------------------------------
     v86 ships a keyboard adapter that binds at the document, but it only
     accepts trusted browser events, which makes it impossible to drive or
     verify explicitly. It is also all-or-nothing: enabled, it eats every
     keystroke on the page.

     Sending scancodes ourselves fixes both — and fixes games. keyboard_send_text
     delivers a keypress with no key-up, so a program polling "is the arrow key
     still held" never sees anything, which is exactly why SNAKE looked dead.
     Emitting make codes on keydown and break codes on keyup gives DOS the same
     signal real hardware would.

     Set 1 scancodes; the 0xE0-prefixed ones are the extended block. */
  var SCAN = {
    Escape: 0x01, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05,
    Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a,
    Digit0: 0x0b, Minus: 0x0c, Equal: 0x0d, Backspace: 0x0e, Tab: 0x0f,
    KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15,
    KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19, BracketLeft: 0x1a,
    BracketRight: 0x1b, Enter: 0x1c, ControlLeft: 0x1d, KeyA: 0x1e, KeyS: 0x1f,
    KeyD: 0x20, KeyF: 0x21, KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25,
    KeyL: 0x26, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29, ShiftLeft: 0x2a,
    Backslash: 0x2b, KeyZ: 0x2c, KeyX: 0x2d, KeyC: 0x2e, KeyV: 0x2f, KeyB: 0x30,
    KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35,
    ShiftRight: 0x36, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3a,
    F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41,
    F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58
  };
  var SCAN_EXT = {
    ArrowUp: 0x48, ArrowDown: 0x50, ArrowLeft: 0x4b, ArrowRight: 0x4d,
    Home: 0x47, End: 0x4f, PageUp: 0x49, PageDown: 0x51,
    Insert: 0x52, Delete: 0x53, ControlRight: 0x1d, AltRight: 0x38
  };

  function codeFor(event) {
    if (event.code && Object.prototype.hasOwnProperty.call(SCAN, event.code)) {
      return { code: SCAN[event.code], ext: false };
    }
    if (event.code && Object.prototype.hasOwnProperty.call(SCAN_EXT, event.code)) {
      return { code: SCAN_EXT[event.code], ext: true };
    }
    // Fall back to the printable character, for layouts where `code` is not
    // one of the US names above.
    if (event.key && event.key.length === 1) {
      if (event.key === ' ') return { code: SCAN.Space, ext: false };
      var guess = 'Key' + event.key.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(SCAN, guess)) {
        return { code: SCAN[guess], ext: false };
      }
    }
    return null;
  }

  function sendKey(event, isDown) {
    if (!emulator) return false;
    var hit = codeFor(event);
    if (!hit) return false;
    var codes = [];
    if (hit.ext) codes.push(0xe0);
    codes.push(isDown ? hit.code : (hit.code | 0x80));
    try { emulator.keyboard_send_scancodes(codes); } catch (err) { return false; }
    return true;
  }

  function initFocus() {
    el.screen.setAttribute('tabindex', '0');

    function focusInput() {
      setKeyboard(true);
      if (el.input) el.input.focus({ preventScroll: true });
    }
    el.screen.addEventListener('mousedown', function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) focusInput();
    });
    el.screen.addEventListener('focus', focusInput);

    if (!el.input) return;
    el.input.addEventListener('blur', function () { setKeyboard(false); });

    el.input.addEventListener('keydown', function (event) {
      if (!emulator) return;

      // Copy and paste win over the machine.
      var sel = window.getSelection();
      var hasSelection = !!sel && !sel.isCollapsed &&
                         !!sel.anchorNode && el.screen.contains(sel.anchorNode);
      if ((event.ctrlKey || event.metaKey) && /^v$/i.test(event.key)) return;
      if ((event.ctrlKey || event.metaKey) && /^c$/i.test(event.key) && hasSelection) {
        var text = window.getSelection().toString();
        if (text) {
          event.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
          }
          return;
        }
      }

      if (sendKey(event, true)) {
        event.preventDefault();
        queueRepaint();
      }
    });

    el.input.addEventListener('keyup', function (event) {
      if (!emulator) return;
      if (sendKey(event, false)) event.preventDefault();
    });

    // Paste: only an editable element ever receives the event. DOS wants CR.
    el.input.addEventListener('paste', function (event) {
      if (!emulator) return;
      event.preventDefault();
      var cb = event.clipboardData || window.clipboardData;
      var text = cb ? cb.getData('text') : '';
      if (text) emulator.keyboard_send_text(text.replace(/\r?\n/g, '\r'));
      el.input.value = '';
      queueRepaint();
    });

    el.input.addEventListener('input', function () { el.input.value = ''; });
  }

  function initFullscreen() {
    var btn = $('lab-fullscreen');
    if (!btn) return;
    if (!(root.requestFullscreen || root.webkitRequestFullscreen)) { btn.hidden = true; return; }
    btn.addEventListener('click', function () {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      }
    });
    function sync() {
      var on = (document.fullscreenElement || document.webkitFullscreenElement) === root;
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Exit fullscreen (Esc)' : 'Fullscreen (Esc to exit)';
      if (on) {
        setKeyboard(true);
        if (el.input) setTimeout(function () { el.input.focus({ preventScroll: true }); }, 60);
      }
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  function initControls() {
    el.start.addEventListener('click', boot);
    el.stop.addEventListener('click', function () {
      destroy();
      setStatus('Machine powered off');
      if (el.hint) el.hint.hidden = false;
    });
    el.reset.addEventListener('click', function () { destroy(); boot(); });
    window.addEventListener('beforeunload', function () {
      if (emulator) { try { emulator.stop(); } catch (err) {} }
    });
  }

  LabCache.register();
  initGate();
  initStorage();
  initFocus();
  initControls();
  initFullscreen();
  setStatus('Ready — press Boot');
})();

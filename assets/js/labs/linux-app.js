/* ==========================================================================
   linux-app.js — boots a real Linux kernel in the browser with v86.
   --------------------------------------------------------------------------
   v86 emulates a 32-bit x86 machine in WebAssembly. What runs inside it is a
   genuine Linux kernel and a genuine BusyBox userland (227 applets) reading a
   real, if emulated, disk. Nothing is simulated at the shell level: pipes,
   redirection, signals, /proc and the process table are the kernel's own
   implementations.

   Two things worth understanding, both of which the page states plainly:

     - The machine is sealed off from the rest of the site. It cannot see the
       Pyodide or SQLite runtimes used by the language playgrounds, because
       those are JavaScript objects and this is a separate CPU with its own
       address space. `python` in here will always be "not found".

     - memory_size is a ceiling the emulator enforces, not a request. A fork
       bomb exhausts *its* RAM and the emulated kernel responds as a real one
       would. The host browser is never at risk, which is what makes it safe
       to demonstrate.

   This image boots with console=ttyS0, so the kernel talks over the emulated
   serial port rather than the VGA text console. We therefore render the
   terminal ourselves from serial0-output-byte, which is the better outcome
   anyway: the pane matches the site instead of being v86's own inline-styled
   screen, and keyboard handling stays explicit.
   ========================================================================== */

/* global V86, V86Starter, LabCache */
(function () {
  'use strict';

  var root = document.getElementById('linux');
  if (!root) return;

  var PREFIX = 'lab.';
  var MEMORY_MB = 64;
  var MAX_LINES = 3000;   // scrollback cap; a runaway printer must not eat the DOM

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    gate: $('lab-gate'), agree: $('lab-agree'), leave: $('lab-leave'),
    start: $('linux-start'), stop: $('linux-stop'), reset: $('linux-reset'),
    status: $('linux-status'), term: $('linux-terminal'), hint: $('linux-hint'),
    storeBtn: $('lab-storage-btn'), storePanel: $('lab-storage-panel'),
    storeRing: $('lab-meter-value'), storeSite: $('lab-store-site'),
    storeQuota: $('lab-store-quota'), storeBar: $('lab-store-bar'),
    storeClear: $('lab-store-clear')
  };

  var emulator = null;
  var booting = false;    // Boot pressed, emulator still on its way down
  var autoLoginDone = false;

  function setStatus(text, cls) {
    // #linux-status is a live region (see initStatusLive). Rewriting it with
    // the text it already holds is still a mutation, and a screen reader would
    // read the same sentence a second time — so only touch it when it moved.
    if (el.status.textContent !== text) el.status.textContent = text;
    el.status.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  /* The status line carries the only running commentary this lab has —
     "Booting the kernel…", "Logged in as root", "Machine powered off" — and
     none of it reached anyone using a screen reader: a plain <span> that
     JavaScript rewrites is silent by definition. role="status" is the right
     role (a passive, advisory region), and the explicit aria-live spells out
     the same thing for the combinations that honour the attribute but not the
     implicit value. Polite, never assertive: none of this is urgent. setStatus
     above ignores a write that does not change the text, so a repeated state
     cannot announce twice. Called after the first setStatus has already
     painted "Ready", so that initial text is not announced as though something
     had just happened — the same shape as initStatusLive in lab-app.js. */
  function initStatusLive() {
    if (!el.status) return;
    el.status.setAttribute('role', 'status');
    el.status.setAttribute('aria-live', 'polite');
  }

  function humanBytes(n) {
    if (!n) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  /* ======================================================================
     A small VT-ish screen
     ----------------------------------------------------------------------
     Enough of a terminal for a shell: a line buffer with a cursor column,
     honouring \r, \b and the handful of ANSI sequences BusyBox actually
     emits. Anything else is stripped rather than rendered as mojibake.
     ====================================================================== */

  var lines = [''];
  var col = 0;
  var dirty = false;

  function put(ch) {
    var last = lines.length - 1;
    var line = lines[last];
    if (col < line.length) {
      lines[last] = line.slice(0, col) + ch + line.slice(col + 1);
    } else {
      lines[last] = line + new Array(col - line.length + 1).join(' ') + ch;
    }
    col++;
  }

  function newline() {
    lines.push('');
    col = 0;
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  }

  // Escape sequences arrive one byte at a time, so they have to be assembled
  // across calls rather than matched with a regex over the whole stream.
  var escBuf = null;
  // `clear` is ESC[H (cursor home) followed by ESC[J (erase to end of screen),
  // as two separate sequences. This buffer has no row addressing — it only
  // ever appends — so ESC[H alone means nothing and ESC[J alone would erase
  // from the last line, i.e. nothing. Remembering that the cursor was just
  // homed is what lets the pair be recognised as "clear the screen".
  var homed = false;

  function endEscape(seq) {
    if (seq === '[H' || seq === '[;H' || seq === '[1;1H') {
      homed = true;
      return;
    }

    // ESC[2J and ESC[3J erase the whole display outright.
    if (seq === '[2J' || seq === '[3J') {
      lines = ['']; col = 0; homed = false;
      return;
    }

    // ESC[J / ESC[0J erases from the cursor to the end of the display. This is
    // how the shell rubs out a character: it sends \b then ESC[J, so getting
    // this wrong is exactly why Backspace used to leave debris on the line.
    // After a cursor-home it means "clear the screen", which is how `clear`
    // works — but on its own it must still truncate here and drop what follows.
    if (seq === '[J' || seq === '[0J') {
      if (homed) {
        lines = ['']; col = 0;
      } else {
        lines[lines.length - 1] = lines[lines.length - 1].slice(0, col);
      }
      homed = false;
      return;
    }

    // ESC[K / ESC[0K erases to the end of the current line only.
    if (seq === '[K' || seq === '[0K') {
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, col);
      homed = false;
      return;
    }

    homed = false;   // colour changes and the rest: ignored, but they break the pair
  }

  function feed(ch) {
    if (escBuf !== null) {
      escBuf += ch;
      // A CSI sequence ends at the first byte in @..~; two-character escapes
      // (ESC c, ESC 7 …) end immediately.
      if (escBuf.length === 1 && ch !== '[' && ch !== ']') { escBuf = null; return; }
      if (/[@-~]/.test(ch) && escBuf.length > 1) {
        endEscape(escBuf);
        escBuf = null;
      }
      if (escBuf !== null && escBuf.length > 24) escBuf = null; // never stall
      return;
    }

    switch (ch) {
      case '\x1b': escBuf = ''; return;
      case '\n':   homed = false; newline(); return;
      case '\r':   col = 0; return;
      case '\b':   if (col > 0) col--; return;
      case '\x07': return;                       // bell
      case '\t':   homed = false; do { put(' '); } while (col % 8); return;
      default:
        if (ch >= ' ' || ch === '') { homed = false; put(ch); }
        return;
    }
  }

  function render() {
    dirty = false;
    // Re-rendering wipes any selection the user was in the middle of making,
    // so leave the DOM alone while text is selected inside the terminal.
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.term.contains(sel.anchorNode)) {
      dirty = true;
      setTimeout(render, 400);
      return;
    }

    var atBottom = el.term.scrollHeight - el.term.scrollTop - el.term.clientHeight < 40;

    // Split at the cursor so a blinking block can sit in the gap. The shell
    // parks its cursor at the end of the last line, which is where this lands
    // for everything except a mid-line edit with the arrow keys.
    var lastLine = lines[lines.length - 1];
    var head = lines.slice(0, -1).join('\n');
    if (lines.length > 1) head += '\n';

    el.term.textContent = '';
    el.term.appendChild(document.createTextNode(head + lastLine.slice(0, col)));

    var cursor = document.createElement('span');
    cursor.className = 'lab-cursor';
    cursor.textContent = lastLine.charAt(col) || ' ';
    el.term.appendChild(cursor);

    if (col < lastLine.length) {
      el.term.appendChild(document.createTextNode(lastLine.slice(col + 1)));
    }

    if (atBottom) el.term.scrollTop = el.term.scrollHeight;
  }

  function clearScreen() {
    lines = ['']; col = 0;
    el.term.textContent = '';
  }

  /* Our own commentary, fed through the same buffer as the machine's output so
     it scrolls and wraps identically. Prefixed [ v86 ] so it is never mistaken
     for something the kernel said. */
  function sysline(text) {
    for (var i = 0; i < text.length; i++) feed(text.charAt(i));
    feed('\n');
    if (!dirty) { dirty = true; setTimeout(render, 16); }
  }

  /* ======================================================================
     Consent gate — same stored flag as the language playgrounds, so
     agreeing once covers the whole Labs section.
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

    // Measured from the service worker's cache rather than guessed. See
    // lab-cache.js for why storage.estimate() alone could not report this.
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
    // v86 renamed the export from V86Starter to V86; accept either so a
    // future vendor refresh cannot silently break the page.
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
          anchor: el.term, what: 'Linux emulator',
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
    clearScreen();
    autoLoginDone = false;
    setStatus('Downloading the machine image (~8 MB, cached after this)…', 'is-busy');

    // The kernel is silent on the serial port until getty starts, which is
    // several seconds of a blank pane on a cold load. Narrate our own side of
    // the boot so the machine never looks dead while it is working.
    sysline('[ v86 ] fetching 8 MB disk image (cached after the first boot)');
    sysline('[ v86 ] 64 MB RAM, no network device attached');

    emulator = new Ctor({
      wasm_path: '/assets/vendor/v86/v86.wasm',
      // A ceiling the emulator enforces. Nothing inside can allocate past it.
      memory_size: MEMORY_MB * 1024 * 1024,
      vga_memory_size: 2 * 1024 * 1024,
      bios: { url: '/assets/vendor/v86/bios/seabios.bin' },
      vga_bios: { url: '/assets/vendor/v86/bios/vgabios.bin' },
      cdrom: { url: '/assets/vendor/v86/images/linux.iso' },
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
        bootFailed('Linux emulator stopped responding while loading');
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
          anchor: el.term, what: 'Linux emulator', kind: 'network',
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
        setStatus('Downloading the machine image — ' + pct + '%', 'is-busy');
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
      setStatus('Booting the kernel…', 'is-busy');
    });

    var seen = '';
    emulator.add_listener('serial0-output-byte', function (byte) {
      var ch = String.fromCharCode(byte);
      feed(ch);
      // setTimeout, not requestAnimationFrame: rAF callbacks do not run while
      // the tab is hidden, so a machine booting in a background tab would
      // produce no visible output at all until the tab was focused again.
      if (!dirty) { dirty = true; setTimeout(render, 16); }

      // Buildroot drops to a login prompt with no password on root. Making
      // people guess that is pointless friction, so it is typed for them —
      // and the page says so rather than pretending it never happened.
      if (autoLoginDone) return;
      seen = (seen + ch).slice(-40);
      if (seen.indexOf('login:') !== -1) {
        autoLoginDone = true;
        // A login prompt on the serial port is the one thing on this page that
        // separates a machine that ran from one that merely downloaded: the
        // kernel came up and getty is asking for a user. Every failure path
        // above ends in bootFailed() and never reaches a serial byte at all.
        if (window.KSLab) window.KSLab.used('boot');
        setTimeout(function () {
          if (!emulator) return;
          emulator.serial0_send('root\n');
          // This image boots with the kernel log going to the VGA console
          // while getty runs on the serial port, so the boot messages never
          // reach us live — we only ever see the login prompt. dmesg replays
          // the kernel's own ring buffer, which is the same output, and it
          // makes the machine feel like the real thing it is.
          setTimeout(function () {
            if (emulator) emulator.serial0_send('dmesg | tail -25\n');
          }, 500);
          setStatus('Logged in as root — click the terminal and type', 'is-ok');
        }, 400);
      }
    });

    var input = $('linux-input');
    if (input) input.focus({ preventScroll: true });
  }

  function destroy() {
    if (!emulator) return;
    try {
      emulator.stop();
      if (typeof emulator.destroy === 'function') emulator.destroy();
    } catch (err) { /* already gone */ }
    emulator = null;
    el.start.disabled = false;
    el.stop.disabled = true;
    el.reset.disabled = true;
  }

  /* Keyboard and clipboard -> serial.
     -----------------------------------------------------------------------
     Everything is bound to an offscreen <textarea>, not to the terminal div.
     A div is not editable, and browsers do not deliver `paste` events to
     non-editable elements at all — which is why Ctrl+V and right-click paste
     both silently did nothing when the div held focus. Routing input through
     a real textarea is what every browser terminal does, and it makes paste,
     IME input and mobile keyboards work for free.

     Copy still comes from the terminal div: the textarea is pointer-events:
     none, so a mouse drag selects the visible output, and Ctrl+C is
     intercepted below to copy that selection rather than the empty textarea. */
  function initKeyboard() {
    var input = $('linux-input');
    if (!input) return;

    el.term.setAttribute('tabindex', '0');
    function focusInput() { input.focus({ preventScroll: true }); }
    el.term.addEventListener('mouseup', function () {
      // Do not steal focus mid-selection, or the highlight disappears.
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) focusInput();
    });
    el.term.addEventListener('focus', focusInput);

    // Real paste, from Ctrl+V and from the right-click menu alike.
    input.addEventListener('paste', function (event) {
      if (!emulator) return;
      event.preventDefault();
      var cb = event.clipboardData || window.clipboardData;
      var text = cb ? cb.getData('text') : '';
      if (text) emulator.serial0_send(text.replace(/\r\n/g, '\n'));
      input.value = '';
    });

    // Anything the textarea somehow accumulates (mobile autocorrect, IME
    // commits) is forwarded and cleared, so it never drifts out of sync.
    input.addEventListener('input', function () {
      if (emulator && input.value) emulator.serial0_send(input.value);
      input.value = '';
    });

    input.addEventListener('keydown', function (event) {
      if (!emulator) return;
      var send = null;
      var k = event.key;

      // Copy and paste have to win over the shell's control characters,
      // otherwise Ctrl+C is swallowed as SIGINT and the browser never gets
      // the chance to copy. The rule below is what terminal emulators settled
      // on: Ctrl+C copies when there is a selection and interrupts when there
      // is not, and Ctrl+Shift+C / Ctrl+Shift+V are always copy and paste.
      var sel = window.getSelection();
      var hasSelection = !!sel && !sel.isCollapsed &&
                         !!sel.anchorNode && el.term.contains(sel.anchorNode);

      if ((event.ctrlKey || event.metaKey) && /^v$/i.test(k)) {
        return;                       // the paste listener handles it
      }
      // Copy: the selection lives in the terminal div, but focus is in this
      // textarea, so the browser's own copy would yield an empty string.
      // Write the selection out explicitly instead.
      if ((event.ctrlKey || event.metaKey) && /^c$/i.test(k) &&
          (hasSelection || event.shiftKey)) {
        var text = window.getSelection().toString();
        if (text) {
          event.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
          }
          return;
        }
      }

      if (event.ctrlKey && k.length === 1 && /[a-z]/i.test(k)) {
        // Ctrl+D, Ctrl+Z, Ctrl+L … as the control characters the shell expects.
        send = String.fromCharCode(k.toUpperCase().charCodeAt(0) - 64);
      // '\n', not '\r'. The tty on this image does not map CR to NL, so a bare
      // CR never completes a line for anything reading stdin: `cat >> file`
      // swallowed every line into one, and the echo came back as a lone CR
      // which simply overwrote the same row on screen.
      } else if (k === 'Enter')      { send = '\n'; }
      else if (k === 'Backspace')    { send = '\x7f'; }
      else if (k === 'Tab')          { send = '\t'; }
      else if (k === 'Escape')       { send = '\x1b'; }
      else if (k === 'ArrowUp')      { send = '\x1b[A'; }
      else if (k === 'ArrowDown')    { send = '\x1b[B'; }
      else if (k === 'ArrowRight')   { send = '\x1b[C'; }
      else if (k === 'ArrowLeft')    { send = '\x1b[D'; }
      else if (k.length === 1)       { send = k; }

      if (send !== null) {
        event.preventDefault();
        emulator.serial0_send(send);
      }
    });

  }

  function initControls() {
    el.start.addEventListener('click', boot);

    el.stop.addEventListener('click', function () {
      destroy();
      setStatus('Machine powered off');
      if (el.hint) el.hint.hidden = false;
    });

    el.reset.addEventListener('click', function () {
      destroy();
      boot();
    });

    window.addEventListener('beforeunload', function () {
      if (emulator) { try { emulator.stop(); } catch (err) {} }
    });
  }

  /* Fullscreen. The browser's own API, so Esc leaves it without any key
     handling of ours — which matters more here than in the language labs,
     because every other keystroke on this page is being sent to the machine. */
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
      // Keystrokes only reach the machine while the terminal has focus, and
      // the fullscreen transition drops it.
      if (on) setTimeout(function () {
        var i = $('linux-input');
        if (i) i.focus({ preventScroll: true });
      }, 60);
    }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  }

  LabCache.register();
  initGate();
  initStorage();
  initKeyboard();
  initControls();
  initFullscreen();
  setStatus('Ready — press Boot');
  // Last, so the opening "Ready — …" is painted before the element becomes a
  // live region and is therefore not announced on arrival.
  initStatusLive();
})();

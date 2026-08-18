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
  var autoLoginDone = false;

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
  function initGate() {
    var agreed;
    try { agreed = localStorage.getItem(PREFIX + 'consent'); } catch (err) { agreed = null; }
    if (agreed === 'yes') { root.setAttribute('data-consent', 'granted'); return; }
    el.agree.addEventListener('click', function () {
      try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (err) {}
      root.setAttribute('data-consent', 'granted');
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

  function boot() {
    if (emulator) return;
    var Ctor = Machine();
    if (!Ctor) { setStatus('Emulator failed to load', 'is-err'); return; }

    el.start.disabled = true;
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

    emulator.add_listener('emulator-started', function () {
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
})();

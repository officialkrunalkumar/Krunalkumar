/* ==========================================================================
   crack.js — a live password hash cracker you can watch run.
   --------------------------------------------------------------------------
   "Your password can be cracked in seconds" is abstract until you see the
   guesses/second counter spinning and a common word fall out of a hashed
   digest in front of you. That is the whole point of this toy: take a target
   password, hash it with a fast hash, and then actually crack it — a common-
   password list first, then brute force over a growing keyspace — showing the
   current guess, the count, the rate, and a big "CRACKED in X" the instant it
   matches.

   The honest half matters as much as the scary half. When a weak password
   falls, the readout also projects how long a genuinely random password of the
   *same length* would take at the exact rate we just measured. The lesson is
   not "everything falls" — it is "weak ones fall instantly, strong ones never
   do", and the projection is the proof.

   Non-obvious decisions, because they are easy to get wrong:

   1. The cracking loop runs in a Web Worker, built from a Blob URL via
      LabViz.worker. A million-guess loop on the main thread would freeze the
      tab, and a frozen tab has a dead Stop button — exactly when you most want
      to stop it. Off-thread, the page and the Stop button stay live.

   2. Inside the worker the hashes are our OWN synchronous MD5 / SHA-1 /
      SHA-256, not crypto.subtle, even though SubtleCrypto exists in workers.
      SubtleCrypto is async: every digest is a Promise. You cannot await a
      Promise per guess and still hash tens of thousands per batch — the
      microtask overhead alone would cap the rate at a crawl and drown the
      thread in pending jobs. A synchronous digest lets the worker rip through a
      whole 50k batch in one tight loop. We DO still call SubtleCrypto once, on
      the single target digest, to independently verify our SHA implementation
      agrees with the browser's audited one (MD5 is not in SubtleCrypto, so it
      is verified only by the wordlist round-trip).

   3. Progress is posted once per ~50k-guess batch, never per guess. A
      postMessage per guess would flood the main thread's event loop and freeze
      the very UI the worker exists to keep responsive. Between batches the
      worker yields with setTimeout(0) so it breathes; Stop is a hard
      worker.terminate() on the main side, which kills the loop mid-batch no
      matter what it is doing.

   4. Nothing here touches the network. No fetch, no XHR, no worker that loads a
      URL — the worker is a Blob of inline source, the wordlist is inline, every
      hash is computed locally. A password tool that phones home is a password
      collection service with a countdown animation.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ---- character sets for the brute-force phase ------------------------- */
  var LOWER = 'abcdefghijklmnopqrstuvwxyz';
  var UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var DIGITS = '0123456789';
  var SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/|~';
  var FULL = LOWER + UPPER + DIGITS + SYMBOLS;   // what a "strong" password draws from

  /* ---- the built-in common-password list -------------------------------- *
     A few hundred of the passwords that top every real breach corpus. The
     worker expands each of these with the mangling rules attackers actually
     use (capitalisation, trailing digits and years, leetspeak, a symbol on the
     end), so the effective list the cracker runs is tens of thousands of
     entries — which is why "Summer2021!" and "P@ssw0rd" fall in the wordlist
     phase, not the brute one. */
  var COMMON = [
    'password','123456','123456789','12345678','12345','1234567','1234567890',
    'qwerty','abc123','111111','123123','000000','iloveyou','1234','1q2w3e4r',
    'qwertyuiop','123','monkey','dragon','1qaz2wsx','123321','654321','666666',
    'password1','1q2w3e','qwerty123','superman','asdfghjkl','football','baseball',
    'welcome','letmein','admin','login','princess','solo','abc','flower','hottie',
    'loveme','zaq1zaq1','hello','freedom','whatever','qazwsx','trustno1','jordan',
    'harley','robert','matthew','daniel','andrew','joshua','michael','michelle',
    'jennifer','thomas','hunter','ranger','buster','soccer','hockey','killer',
    'george','sexy','andrea','charlie','samantha','ashley','bailey','passw0rd',
    'shadow','master','666999','696969','batman','trustme','access','mustang',
    'shadow1','maggie','biteme','ginger','hammer','summer','winter','spring',
    'autumn','corvette','tigger','cookie','snoopy','samsung','startrek','banana',
    'cheese','computer','amanda','nicole','chelsea','matrix','falcon','cowboy',
    'silver','richard','orange','merlin','michelle1','fuckyou','fuckme','2000',
    'test','testing','test123','guest','oracle','changeme','secret','root','toor',
    'admin123','administrator','pass','pass123','p@ssword','p@ssw0rd','welcome1',
    'welcome123','password123','passw0rd1','abcdef','abcdefg','abcd1234','a1b2c3',
    'qwe123','qweasd','asdf','asdfgh','zxcvbn','zxcvbnm','1qazxsw2','poiuyt',
    'lkjhgf','mnbvcx','121212','131313','142536','159357','7777777','88888888',
    'love','lovely','loveyou','forever','angel','angels','babygirl','sweety',
    'sunshine','superstar','iloveyou1','iloveu','football1','baseball1','soccer1',
    'basketball','liverpool','arsenal','chelsea','barcelona','realmadrid','united',
    'rangers','celtic','cricket','india','india123','krunal','krishna','ganesh',
    'shivaji','bharat','mumbai','delhi','ramram','omshanti','radha','krishna1',
    'jayshreeram','allah','jesus','christ','heaven','church','freedom1','justice',
    'liberty','america','american','patriot','eagle','marines','soldier','ranger1',
    'apple','google','yahoo','hotmail','gmail','facebook','twitter','internet',
    'microsoft','windows','linux','ubuntu','redhat','centos','android','iphone',
    'samsung1','nokia','motorola','startrek1','starwars','pokemon','naruto','goku',
    'zelda','minecraft','fortnite','fortnite1','xbox','playstation','nintendo',
    'gamer','gaming','warcraft','diablo','fifa','madden','call','duty','halo3',
    'money','moneyman','richguy','dollar','million','bank','banking','account',
    'business','company','office','manager','director','boss','employee','worker',
    'monday','friday','weekend','holiday','vacation','birthday','anniversary',
    'january','february','summer2020','summer2021','winter2020','spring2021',
    'chocolate','vanilla','strawberry','coffee','whiskey','vodka','beer','wine',
    'party','music','guitar','piano','drums','singer','dancer','artist','painter',
    'doctor','nurse','lawyer','teacher','student','school','college','university',
    'science','biology','chemistry','physics','history','geography','english',
    'purple','yellow','orange1','green','blue','black','white','pink','rainbow',
    'tiger','lion','panther','wolf','eagle1','shark','dolphin','dragon1','phoenix',
    'ninja','samurai','warrior','wizard','knight','king','queen','prince','princess1'
  ];

  var PRESETS = ['password', '123456', 'qwerty', 'letmein', 'hunter2', 'iloveyou',
    'admin', 'Summer2021!', 'P@ssw0rd', 'trustno1', 'dragon', 'monkey'];

  /* ---- module state ----------------------------------------------------- */
  var outEl, targetEl, hashSel, modeSel, charsetSel, startBtn, stopBtn;
  var worker = null;
  var rafHandle = null;
  var state = null;
  var curTarget = '', curHashName = 'MD5', curMode = 'both';
  var curModeLabel = '', curCharset = LOWER, curCharsetLabel = '';

  var RULE = new Array(61).join('─');   // horizontal rule

  function freshState() {
    return {
      running: false, cracked: false, exhausted: false, stopped: false, error: '',
      phase: '', guess: '', tried: 0, rate: 0, elapsed: 0, bruteLen: 0,
      targetDigest: '', verified: '',
      crackedPassword: '', crackedTried: 0, crackedElapsed: 0, crackedPhase: ''
    };
  }

  /* ---- number / time formatting ----------------------------------------- */
  function grouped(n) { return LabViz.humanNumber(n); }

  function fmtElapsed(ms) {
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + ' min ' + s + ' s';
  }

  /* Human-readable duration for the projection — has to keep meaning all the
     way from seconds to numbers with no physical referent, so past a billion
     years it names the scale rather than pretending precision. */
  function humanDuration(s) {
    if (s < 1) return 'under a second';
    if (s < 60) return Math.round(s) + ' seconds';
    var m = s / 60; if (m < 60) return Math.round(m) + ' minutes';
    var h = m / 60; if (h < 24) return Math.round(h) + ' hours';
    var d = h / 24; if (d < 365) return Math.round(d) + ' days';
    var y = d / 365.25;
    if (y < 1000) return Math.round(y) + ' years';
    if (y < 1e6) return grouped(Math.round(y)) + ' years';
    if (y < 1e9) return (y / 1e6).toFixed(1) + ' million years';
    if (y < 1e12) return (y / 1e9).toFixed(1) + ' billion years';
    if (y < 1e15) return (y / 1e12).toFixed(1) + ' trillion years';
    return y.toExponential(1) + ' years';
  }

  function sci(n) {
    if (n < 1e6) return grouped(Math.round(n));
    return n.toExponential(1);
  }

  /* ---- charset resolution ----------------------------------------------- *
     The select's option values live in HTML this module does not own, so it
     cannot assume the exact strings. It honours an explicit data-charset
     attribute first (the clean contract), then a broad keyword map, then treats
     the raw value as a literal charset, and finally falls back to a-z. */
  function resolveCharset() {
    if (!charsetSel) return LOWER;
    var raw = charsetSel.value || '';
    var val = raw.toLowerCase();
    var opt = (charsetSel.options && charsetSel.selectedIndex >= 0)
      ? charsetSel.options[charsetSel.selectedIndex] : null;
    if (opt) {
      var dc = opt.getAttribute('data-charset');
      if (dc) return dc;
    }
    var map = {
      'digits': DIGITS, 'digit': DIGITS, 'numeric': DIGITS, 'numbers': DIGITS,
      'number': DIGITS, 'pin': DIGITS, '0-9': DIGITS,
      'lower': LOWER, 'lowercase': LOWER, 'alpha': LOWER, 'letters': LOWER,
      'a-z': LOWER, 'az': LOWER,
      'upper': UPPER, 'uppercase': UPPER,
      'loweralnum': LOWER + DIGITS, 'lower+digits': LOWER + DIGITS,
      'lower-digits': LOWER + DIGITS, 'lalnum': LOWER + DIGITS, 'lowernum': LOWER + DIGITS,
      'alnum': LOWER + UPPER + DIGITS, 'alphanumeric': LOWER + UPPER + DIGITS,
      'mixed': LOWER + UPPER + DIGITS, 'mixedalnum': LOWER + UPPER + DIGITS,
      'full': FULL, 'all': FULL, 'ascii': FULL, 'printable': FULL,
      'symbols': FULL, 'everything': FULL, 'complex': FULL
    };
    if (map[val]) return map[val];
    if (raw.length >= 2 && raw.indexOf(' ') === -1 && /[a-z0-9]/i.test(raw)) return raw;
    return LOWER;
  }

  function describeCharset(cs) {
    var parts = [];
    if (/[a-z]/.test(cs)) parts.push('a-z');
    if (/[A-Z]/.test(cs)) parts.push('A-Z');
    if (/[0-9]/.test(cs)) parts.push('0-9');
    if (/[^A-Za-z0-9]/.test(cs)) parts.push('symbols');
    return (parts.join(' ') || 'custom') + '  (' + cs.length + ' symbols)';
  }

  function normalizeHash(v) {
    var s = String(v || '').toUpperCase();
    if (s.indexOf('256') !== -1) return 'SHA-256';
    if (s.indexOf('MD5') !== -1) return 'MD5';
    if (s.indexOf('SHA') !== -1 || s.indexOf('1') !== -1) return 'SHA-1';
    return 'MD5';
  }

  function normalizeMode(v) {
    var s = String(v || '').toLowerCase();
    var hasWord = s.indexOf('word') !== -1 || s.indexOf('list') !== -1 || s.indexOf('dict') !== -1;
    var hasBrute = s.indexOf('brute') !== -1 || s.indexOf('force') !== -1;
    if (s.indexOf('both') !== -1 || (hasWord && hasBrute)) return 'both';
    if (hasWord) return 'wordlist';
    if (hasBrute) return 'brute';
    return 'both';
  }

  function modeLabel(mode) {
    if (mode === 'wordlist') return 'common-password list';
    if (mode === 'brute') return 'brute force';
    return 'common list, then brute force';
  }

  /* ---- padding helpers for the aligned readout -------------------------- */
  function padRight(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function kv(label, value) { return ' ' + padRight(label, 10) + ' ' + value; }

  /* ---- the strong-password projection ----------------------------------- */
  function projectionLines(len, rate) {
    var lines = [];
    lines.push(RULE);
    lines.push(' THE LESSON');
    if (!rate || rate <= 0 || !len) {
      lines.push(' (measuring the rate…)');
      return lines;
    }
    var setSize = FULL.length;
    var combos = Math.pow(setSize, len);
    var seconds = (combos / 2) / rate;
    lines.push(' A genuinely random ' + len + '-character password drawn from all');
    lines.push(' ' + setSize + ' printable symbols is ' + sci(combos) + ' combinations.');
    lines.push(' At the rate measured above, cracking it averages:');
    lines.push('');
    lines.push('     ' + humanDuration(seconds));
    if (seconds > 4.35e17) {
      lines.push('     — longer than the universe has existed (13.8 bn years).');
    }
    lines.push('');
    lines.push(' Same length as the target. The weak one fell in front of you;');
    lines.push(' the strong one, at this very speed, never would.');
    return lines;
  }

  /* ---- render the live readout into the <pre> --------------------------- */
  function render() {
    if (!outEl) return;
    var L = [];
    L.push(' TARGET     ' + (curTarget || '—'));

    var hashLine = ' HASH       ' + curHashName;
    if (state.targetDigest) hashLine += '  →  ' + state.targetDigest;
    if (state.verified === 'verified') hashLine += '   [verified vs SubtleCrypto]';
    else if (state.verified === 'mismatch') hashLine += '   [!! self-test mismatch]';
    L.push(hashLine);

    var attack = ' ATTACK     ' + curModeLabel;
    if (curMode !== 'wordlist') attack += '        SET ' + curCharsetLabel;
    L.push(attack);
    L.push(RULE);

    if (state.error) {
      L.push(' worker error: ' + state.error);
      outEl.textContent = L.join('\n');
      return;
    }

    if (state.cracked) {
      L.push('');
      L.push('   ★★  CRACKED in ' + fmtElapsed(state.crackedElapsed) + '  ★★');
      L.push('');
      L.push(kv('password', state.crackedPassword));
      L.push(kv('found at', grouped(state.crackedTried) + ' guesses'));
      L.push(kv('by', state.crackedPhase === 'wordlist'
        ? 'the common-password list' : 'brute force'));
      L.push(kv('rate', grouped(state.rate) + ' guesses / sec'));
      var pc = projectionLines(curTarget.length, state.rate);
      for (var i = 0; i < pc.length; i++) L.push(pc[i]);
      outEl.textContent = L.join('\n');
      return;
    }

    var phaseText;
    if (state.phase === 'wordlist') phaseText = 'common-password list + rules';
    else if (state.phase === 'brute') phaseText = 'brute force · length ' + state.bruteLen;
    else phaseText = '—';

    var caret = (state.running && Math.floor(Date.now() / 400) % 2) ? '█' : ' ';

    L.push(kv('phase', phaseText));
    L.push(kv('guessing', (state.guess || '') + caret));
    L.push(kv('tried', grouped(state.tried) + ' guesses'));
    L.push(kv('rate', grouped(state.rate) + ' guesses / sec'));
    L.push(kv('elapsed', fmtElapsed(state.elapsed)));

    if (state.stopped) {
      L.push('');
      L.push(' ■ stopped by you at ' + grouped(state.tried) + ' guesses.');
    } else if (state.exhausted) {
      L.push('');
      if (curMode === 'wordlist') {
        L.push(' Not in the common-password list. That is a decent sign — but');
        L.push(' switch the attack to "both" to see brute force take over.');
      } else {
        L.push(' Exhausted the search space up to the length cap without a');
        L.push(' match. The target is stronger than this attack reaches.');
      }
    }

    var pl = projectionLines(curTarget.length, state.rate);
    for (var j = 0; j < pl.length; j++) L.push(pl[j]);

    outEl.textContent = L.join('\n');
  }

  /* ---- worker plumbing -------------------------------------------------- */
  function onWorkerMsg(e) {
    var d = e.data || {};
    if (d.ev === 'target') {
      state.targetDigest = d.digest;
    } else if (d.ev === 'verify') {
      state.verified = d.ok ? 'verified' : 'mismatch';
    } else if (d.ev === 'progress') {
      applyProgress(d);
    } else if (d.ev === 'cracked') {
      applyProgress(d);
      state.running = false; state.cracked = true;
      state.crackedPassword = d.password;
      state.crackedTried = d.tried;
      state.crackedElapsed = d.elapsed;
      state.crackedPhase = d.phase;
      finish();
    } else if (d.ev === 'exhausted') {
      applyProgress(d);
      state.running = false; state.exhausted = true;
      finish();
    }
  }

  function applyProgress(d) {
    if (d.phase != null) state.phase = d.phase;
    if (d.guess != null) state.guess = d.guess;
    if (d.tried != null) state.tried = d.tried;
    if (d.rate != null) state.rate = d.rate;
    if (d.elapsed != null) state.elapsed = d.elapsed;
    if (d.bruteLen != null) state.bruteLen = d.bruteLen;
  }

  function finish() {
    if (worker) { worker.terminate(); worker = null; }
    stopRaf();
    render();
    toggleButtons(false);
  }

  function startRaf() {
    stopRaf();
    function tick() {
      if (!state || !state.running) return;
      render();
      rafHandle = LabViz.raf(tick);
    }
    rafHandle = LabViz.raf(tick);
  }

  function stopRaf() {
    if (rafHandle != null) { LabViz.cancelRaf(rafHandle); rafHandle = null; }
  }

  function toggleButtons(running) {
    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
  }

  /* ---- controls --------------------------------------------------------- */
  function startCrack() {
    if (!targetEl) return;
    var target = targetEl.value || '';
    if (!target) {   // empty input: pick a weak preset so Start always does something
      target = PRESETS[Math.floor(Math.random() * PRESETS.length)];
      targetEl.value = target;
    }
    if (worker) { worker.terminate(); worker = null; }

    state = freshState();
    curTarget = target;
    curHashName = normalizeHash(hashSel ? hashSel.value : 'MD5');
    curMode = normalizeMode(modeSel ? modeSel.value : 'both');
    curModeLabel = modeLabel(curMode);
    curCharset = resolveCharset();
    curCharsetLabel = describeCharset(curCharset);
    state.running = true;
    toggleButtons(true);
    render();

    worker = LabViz.worker(workerSource());
    worker.onmessage = onWorkerMsg;
    worker.onerror = function (err) {
      state.running = false;
      state.error = (err && err.message) ? err.message : 'worker failed';
      finish();
    };
    worker.postMessage({
      cmd: 'start', target: target, hash: curHashName, mode: curMode,
      charset: curCharset, wordlist: COMMON, maxLen: 16
    });
    startRaf();
  }

  function stopCrack() {
    if (worker) { worker.terminate(); worker = null; }
    if (state && state.running) { state.running = false; state.stopped = true; }
    stopRaf();
    render();
    toggleButtons(false);
  }

  /* ---- weak-password preset chips --------------------------------------- *
     The consuming HTML lists no preset control, so the toy builds its own row
     of clickable weak examples right after the target input. Styling is set
     through the CSSOM (element.style), which CSP does not restrict, so the
     chips are presentable even with no matching page CSS. */
  function buildPresets() {
    if (!targetEl || !targetEl.parentNode) return;
    var row = LabViz.el('div', 'crackviz-presets');
    row.style.display = 'flex';
    row.style.flexWrap = 'wrap';
    row.style.gap = '6px';
    row.style.margin = '8px 0';
    var lbl = LabViz.el('span', 'crackviz-presets-label', 'try a weak one:');
    lbl.style.opacity = '0.7';
    lbl.style.fontSize = '0.85em';
    lbl.style.alignSelf = 'center';
    row.appendChild(lbl);
    for (var i = 0; i < PRESETS.length; i++) {
      (function (pw) {
        var b = LabViz.el('button', 'crackviz-preset', pw);
        b.type = 'button';
        b.style.cursor = 'pointer';
        b.style.font = 'inherit';
        b.style.fontSize = '0.85em';
        b.style.padding = '2px 8px';
        b.style.borderRadius = '4px';
        b.style.border = '1px solid currentColor';
        b.style.background = 'transparent';
        b.style.color = 'inherit';
        b.style.opacity = '0.85';
        b.addEventListener('click', function () {
          targetEl.value = pw;
          targetEl.focus();
        });
        row.appendChild(b);
      })(PRESETS[i]);
    }
    targetEl.parentNode.insertBefore(row, targetEl.nextSibling);
  }

  /* ======================================================================= *
     The worker body. This function is never called on the main thread — it is
     serialised with toString() and run inside a Blob-URL Worker (no eval, no
     network). It carries its own synchronous MD5 / SHA-1 / SHA-256, an
     odometer brute-forcer, and a wordlist rule-expander, and reports back on
     batch boundaries only.
     ======================================================================= */
  function workerBody() {
    'use strict';

    var BATCH = 50000;

    /* ---- byte helpers ---- */
    var enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
    function utf8(str) {
      if (enc) return enc.encode(str);
      var arr = [];
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 128) arr.push(c);
        else if (c < 2048) { arr.push(192 | (c >> 6), 128 | (c & 63)); }
        else { arr.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
      }
      return new Uint8Array(arr);
    }
    function bytesToStr(u8) {
      var s = '';
      for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return s;
    }

    var HEXB = [];
    (function () {
      var h = '0123456789abcdef';
      for (var i = 0; i < 256; i++) HEXB[i] = h.charAt((i >> 4) & 15) + h.charAt(i & 15);
    })();
    function toHexBytes(u8) {
      var s = '';
      for (var i = 0; i < u8.length; i++) s += HEXB[u8[i]];
      return s;
    }
    function toHexWords(w) {
      var s = '';
      for (var i = 0; i < w.length; i++) {
        var x = w[i] >>> 0;
        s += HEXB[(x >>> 24) & 255] + HEXB[(x >>> 16) & 255] + HEXB[(x >>> 8) & 255] + HEXB[x & 255];
      }
      return s;
    }

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
    function add32(a, b) { return (a + b) & 0xffffffff; }

    /* ---- MD5 (hoisted constants so nothing recomputes per hash) ---- */
    var MD5_S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
                 5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
                 4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
                 6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    var MD5_K = [];
    (function () { for (var i = 0; i < 64; i++) MD5_K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0; })();

    function md5(bytes) {
      var len = bytes.length;
      var withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
      withPad.set(bytes);
      withPad[len] = 0x80;
      var bitLen = len * 8;
      var dv = new DataView(withPad.buffer);
      dv.setUint32(withPad.length - 8, bitLen & 0xffffffff, true);
      dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

      var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
      var M = new Uint32Array(16);
      for (var chunk = 0; chunk < withPad.length; chunk += 64) {
        for (var j = 0; j < 16; j++) M[j] = dv.getUint32(chunk + j * 4, true);
        var A = a0, B = b0, C = c0, D = d0;
        for (var k = 0; k < 64; k++) {
          var F, g;
          if (k < 16) { F = (B & C) | (~B & D); g = k; }
          else if (k < 32) { F = (D & B) | (~D & C); g = (5 * k + 1) % 16; }
          else if (k < 48) { F = B ^ C ^ D; g = (3 * k + 5) % 16; }
          else { F = C ^ (B | ~D); g = (7 * k) % 16; }
          F = add32(add32(add32(F, A), MD5_K[k]), M[g]);
          A = D; D = C; C = B;
          B = add32(B, rotl(F, MD5_S[k]));
        }
        a0 = add32(a0, A); b0 = add32(b0, B); c0 = add32(c0, C); d0 = add32(d0, D);
      }
      var outB = new Uint8Array(16);
      var odv = new DataView(outB.buffer);
      odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
      odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
      return toHexBytes(outB);
    }

    /* ---- SHA-1 ---- */
    function sha1(bytes) {
      var len = bytes.length;
      var total = (((len + 8) >> 6) + 1) << 6;
      var msg = new Uint8Array(total);
      msg.set(bytes);
      msg[len] = 0x80;
      var dv = new DataView(msg.buffer);
      var ml = len * 8;
      dv.setUint32(total - 4, ml >>> 0, false);
      dv.setUint32(total - 8, Math.floor(ml / 4294967296), false);

      var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
      var w = new Uint32Array(80);
      for (var i = 0; i < total; i += 64) {
        for (var t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
        for (t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        var a = h0, b = h1, c = h2, d = h3, e = h4;
        for (t = 0; t < 80; t++) {
          var f, k;
          if (t < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
          else if (t < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
          else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
          else { f = b ^ c ^ d; k = 0xCA62C1D6; }
          var tmp = add32(add32(add32(add32(rotl(a, 5), f), e), k), w[t]);
          e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
        }
        h0 = add32(h0, a); h1 = add32(h1, b); h2 = add32(h2, c);
        h3 = add32(h3, d); h4 = add32(h4, e);
      }
      return toHexWords([h0, h1, h2, h3, h4]);
    }

    /* ---- SHA-256 ---- */
    var SHA256_K = [
      0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

    function sha256(bytes) {
      var len = bytes.length;
      var total = (((len + 8) >> 6) + 1) << 6;
      var msg = new Uint8Array(total);
      msg.set(bytes);
      msg[len] = 0x80;
      var dv = new DataView(msg.buffer);
      var ml = len * 8;
      dv.setUint32(total - 4, ml >>> 0, false);
      dv.setUint32(total - 8, Math.floor(ml / 4294967296), false);

      var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
      var w = new Uint32Array(64);
      for (var i = 0; i < total; i += 64) {
        for (var t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
        for (t = 16; t < 64; t++) {
          var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
          var s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
          w[t] = add32(add32(add32(w[t - 16], s0), w[t - 7]), s1);
        }
        var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (t = 0; t < 64; t++) {
          var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          var ch = (e & f) ^ (~e & g);
          var t1 = add32(add32(add32(add32(hh, S1), ch), SHA256_K[t]), w[t]);
          var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          var maj = (a & b) ^ (a & c) ^ (b & c);
          var t2 = add32(S0, maj);
          hh = g; g = f; f = e; e = add32(d, t1); d = c; c = b; b = a; a = add32(t1, t2);
        }
        h[0] = add32(h[0], a); h[1] = add32(h[1], b); h[2] = add32(h[2], c); h[3] = add32(h[3], d);
        h[4] = add32(h[4], e); h[5] = add32(h[5], f); h[6] = add32(h[6], g); h[7] = add32(h[7], hh);
      }
      return toHexWords(h);
    }

    function hashOf(name, bytes) {
      if (name === 'MD5') return md5(bytes);
      if (name === 'SHA-1') return sha1(bytes);
      return sha256(bytes);
    }

    /* ---- cracking state ---- */
    var stopped = false;
    var hashName = 'MD5', target = '', targetDigest = '', mode = 'both';
    var maxLen = 16, pendingCharset = 'abcdefghijklmnopqrstuvwxyz';
    var expanded = null, wIndex = 0, curStr = '';
    var charsetBytes = null, charsetLen = 0, bruteLen = 0, odo = null, candBytes = null;
    var phase = '';
    var tried = 0, startTime = 0;

    self.onmessage = function (e) {
      var d = e.data || {};
      if (d.cmd === 'stop') { stopped = true; return; }
      if (d.cmd === 'start') start(d);
    };

    /* Expand the raw common-password list with the mangling rules real crackers
       run, so the effective dictionary is tens of thousands of forms. */
    function buildExpanded(list) {
      var out = [], seen = {};
      function add(s) { if (s && seen[s] !== 1) { seen[s] = 1; out.push(s); } }
      var digits = ['0','1','2','3','7','12','123','1234','12345','123456','007','69','420','111','000','321','99','88','01'];
      var syms = ['!','@','#','$','.','_','!!','123!','1!','@123'];
      var years = [];
      for (var y = 1990; y <= 2025; y++) years.push(String(y));
      for (var i = 0; i < list.length; i++) {
        var w = list[i];
        if (!w) continue;
        var cap = w.charAt(0).toUpperCase() + w.slice(1);
        var up = w.toUpperCase();
        var leet = w.replace(/a/g, '@').replace(/o/g, '0').replace(/i/g, '1').replace(/e/g, '3').replace(/s/g, '$');
        add(w); add(cap); add(up); add(leet);
        var bases = [w, cap];
        for (var bi = 0; bi < bases.length; bi++) {
          var base = bases[bi];
          for (var di = 0; di < digits.length; di++) add(base + digits[di]);
          for (var si = 0; si < syms.length; si++) add(base + syms[si]);
          for (var yi = 0; yi < years.length; yi++) add(base + years[yi]);
        }
        add(leet + '1'); add(leet + '!'); add(leet + '123');
      }
      return out;
    }

    function setupBrute(csStr) {
      charsetBytes = utf8(csStr && csStr.length ? csStr : 'abcdefghijklmnopqrstuvwxyz');
      charsetLen = charsetBytes.length;
      odo = null; candBytes = null; bruteLen = 0;
    }

    function nextBrute() {
      if (charsetLen === 0) return null;
      if (odo === null) {
        bruteLen = 1;
        odo = [0];
        candBytes = new Uint8Array(1);
        candBytes[0] = charsetBytes[0];
        return candBytes;
      }
      var p = bruteLen - 1;
      while (p >= 0) {
        odo[p]++;
        if (odo[p] < charsetLen) { candBytes[p] = charsetBytes[odo[p]]; break; }
        odo[p] = 0; candBytes[p] = charsetBytes[0];
        p--;
      }
      if (p < 0) {
        bruteLen++;
        if (bruteLen > maxLen) return null;
        odo = new Array(bruteLen);
        candBytes = new Uint8Array(bruteLen);
        for (var i = 0; i < bruteLen; i++) { odo[i] = 0; candBytes[i] = charsetBytes[0]; }
      }
      return candBytes;
    }

    function nextCandidate() {
      if (phase === 'wordlist') {
        if (!expanded || wIndex >= expanded.length) return null;
        curStr = expanded[wIndex++];
        return utf8(curStr);
      }
      return nextBrute();
    }

    function currentGuess() {
      if (phase === 'wordlist') return curStr || '';
      return candBytes ? bytesToStr(candBytes) : '';
    }

    function postProgress() {
      var elapsed = Date.now() - startTime;
      var secs = elapsed > 0 ? elapsed / 1000 : 0.001;
      self.postMessage({
        ev: 'progress', phase: phase, guess: currentGuess(), tried: tried,
        rate: Math.round(tried / secs), elapsed: elapsed, bruteLen: bruteLen
      });
    }

    function verifyTarget(tbytes) {
      if (hashName === 'MD5') return;              // MD5 is not in SubtleCrypto
      if (typeof self.crypto === 'undefined' || !self.crypto.subtle) return;
      try {
        self.crypto.subtle.digest(hashName, tbytes).then(function (buf) {
          var hex = toHexBytes(new Uint8Array(buf));
          self.postMessage({ ev: 'verify', ok: (hex === targetDigest) });
        })['catch'](function () {});
      } catch (err) {}
    }

    function start(d) {
      stopped = false; tried = 0;
      target = String(d.target || '');
      hashName = d.hash || 'MD5';
      mode = d.mode || 'both';
      maxLen = d.maxLen || 16;
      pendingCharset = d.charset || 'abcdefghijklmnopqrstuvwxyz';

      var tbytes = utf8(target);
      targetDigest = hashOf(hashName, tbytes);
      self.postMessage({ ev: 'target', digest: targetDigest, hashName: hashName });
      verifyTarget(tbytes);

      expanded = null; wIndex = 0; curStr = '';
      odo = null; candBytes = null; bruteLen = 0; charsetBytes = null; charsetLen = 0;

      if (mode === 'wordlist' || mode === 'both') {
        expanded = buildExpanded(d.wordlist || []);
        phase = 'wordlist';
      } else {
        phase = 'brute';
        setupBrute(pendingCharset);
      }
      startTime = Date.now();
      self.setTimeout(runBatch, 0);
    }

    function runBatch() {
      if (stopped) { postProgress(); self.postMessage({ ev: 'stopped', tried: tried }); return; }

      var count = 0, found = null;
      while (count < BATCH) {
        var cand = nextCandidate();
        if (cand === null) {
          if (phase === 'wordlist' && mode === 'both') {
            phase = 'brute';
            setupBrute(pendingCharset);
            continue;
          }
          postProgress();
          self.postMessage({ ev: 'exhausted', tried: tried, elapsed: Date.now() - startTime, mode: mode });
          return;
        }
        tried++; count++;
        if (hashOf(hashName, cand) === targetDigest) { found = currentGuess(); break; }
      }

      if (found !== null) {
        self.postMessage({
          ev: 'cracked', password: found, tried: tried,
          elapsed: Date.now() - startTime, phase: phase,
          rate: Math.round(tried / (Math.max(1, Date.now() - startTime) / 1000)),
          guess: found, bruteLen: bruteLen
        });
        return;
      }
      postProgress();
      self.setTimeout(runBatch, 0);
    }
  }

  /* Serialise the worker body into an IIFE string for the Blob-URL worker. */
  function workerSource() { return '(' + workerBody.toString() + ')();'; }

  /* ---- registration ----------------------------------------------------- */
  LabViz.define({
    id: 'crackviz',
    run: startCrack,   // Ctrl/Cmd+Enter restarts the crack
    onReady: function () {
      outEl = document.getElementById('viz-out');
      targetEl = document.getElementById('viz-target');
      hashSel = document.getElementById('viz-hash');
      modeSel = document.getElementById('viz-mode');
      charsetSel = document.getElementById('viz-charset');
      startBtn = document.getElementById('viz-start');
      stopBtn = document.getElementById('viz-stop');

      state = freshState();

      if (startBtn) startBtn.addEventListener('click', startCrack);
      if (stopBtn) stopBtn.addEventListener('click', stopCrack);
      buildPresets();
      toggleButtons(false);

      if (outEl) {
        outEl.textContent = [
          ' LIVE PASSWORD HASH CRACKER — nothing leaves this tab.',
          '',
          ' Type a password (or click a weak preset above), choose a hash and an',
          ' attack, then press Start. The cracking runs in a Web Worker, so this',
          ' page and the Stop button stay responsive while it grinds.',
          '',
          ' The common-password list falls first, then brute force takes over.',
          ' When something cracks, the readout projects how long a truly random',
          ' password of the SAME length would take at the exact rate measured —',
          ' which is the whole point: weak passwords fall instantly, strong ones',
          ' never do.'
        ].join('\n');
      }
    }
  });
})();

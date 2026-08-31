/* ==========================================================================
   rainbow-tables.js — build a precomputed table, break unsalted hashes with
   it, watch a salt make it worthless, then measure fast against slow hashing.
   --------------------------------------------------------------------------
   Almost every explanation of salting I have read gets the lesson subtly
   wrong, so this tool tries to show the mechanics rather than assert them. It
   does five things, in order, and every number it prints is computed here in
   the tab from real hashes — nothing is narrated.

   1. It hashes a built-in wordlist and keeps a hash -> password map. That IS a
      lookup table, and it is the thing most people mean when they say "rainbow
      table". They are not the same — a real rainbow table is chains of
      endpoints (step 4) — so the two are kept firmly apart here.

   2. It cracks pasted (or generated) unsalted hashes against that map, and
      reports hits, misses and the time taken.

   3. It salts. A per-entry random salt re-hashes every password, and the SAME
      lookup table then scores zero. The screen shows WHY: one password hashes
      to a different digest under each salt. Then the part that matters — a
      per-user salt does NOT stop someone cracking one chosen user (their salt
      is stored in the clear right next to the hash, so a dictionary run against
      that one user still works). What it stops is AMORTISING: one table can no
      longer crack everybody at once, because each user needs the work redone
      with their own salt. That distinction is the whole point of salting.

   4. It builds a genuine, toy-sized rainbow table — a few hundred chains of
      alternating MD5 and reduction functions over a 4-character keyspace,
      storing only the start and end of each chain. You can watch a chain walk
      recover a plaintext, watch chains merge, and watch a false alarm (an
      endpoint matches but the plaintext is not actually in that chain). MD5 is
      used here on purpose: it is the fast, unsalted, legacy hash that rainbow
      tables were ever any good against. Modern GPU brute force has made them
      largely a museum piece for everything else.

   5. It measures fast against slow hashing on THIS machine: N iterations of
      SHA-256 versus N of PBKDF2-HMAC-SHA256 at a stated iteration count, and
      reports a rate for each. This is one browser, one machine, one day; JIT
      warm-up and thermal throttling both move it, and a GPU is orders of
      magnitude faster than anything measured here — so the honest use of the
      number is the RATIO between the two, never the absolute rate. bcrypt,
      scrypt and Argon2 add memory-hardness that PBKDF2 lacks and that this
      page cannot demonstrate fairly, so it says so instead of pretending.

   SHA-1 and SHA-256 come from crypto.subtle (async, so the code is written in
   plain-promise style). MD5 is implemented below in ES5 because subtle does
   not offer it — and MD5 is exactly the hash this topic is about.

   On responsiveness, honestly: the two table builds (steps 1 and 3) and the
   chain build (step 4) are chunked with setTimeout, so they yield and the
   progress in the status line actually paints. The step 4 chain WALKS are
   synchronous — a few tens of milliseconds each — and everything that repeats
   a walk is explicitly bounded, because the first version of the false-alarm
   hunt was not, and could sit on the main thread for twenty minutes. Step 2
   caps how many pasted digests it will process for the same reason, and says
   so on screen when the cap bites.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');
  var statusEl = null;

  /* --- MD5, in ES5, verified against the published vectors ---------------
     crypto.subtle has SHA-1 and SHA-256 but not MD5, and MD5 is the legacy
     hash this whole topic is about, so it is implemented here. Checked against
     the empty string (d41d8cd98f00b204e9800998ecf8427e), "abc"
     (900150983cd24fb0d6963f7d28e17f72) and "password"
     (5f4dcc3b5aa765d61d8327deb882cf99) before shipping. If you touch it,
     re-check it: a wrong digest is worse than none on a page about hashing. */
  var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
               5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
               4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
               6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var MD5_K = [];
  (function () {
    var i;
    for (i = 0; i < 64; i++) {
      MD5_K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
    }
  })();

  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }

  function md5bytes(bytes) {
    var origLen = bytes.length;
    var bitLen = origLen * 8;
    var padded = origLen + 1;
    while (padded % 64 !== 56) padded++;
    padded += 8;
    var msg = new Uint8Array(padded);
    msg.set(bytes);
    msg[origLen] = 0x80;
    // 64-bit little-endian bit length. Passwords here are tiny, but the high
    // word is written properly anyway so the function is correct in general.
    var lo = bitLen >>> 0;
    var hi = Math.floor(bitLen / 4294967296) >>> 0;
    msg[padded - 8] = lo & 0xff;
    msg[padded - 7] = (lo >>> 8) & 0xff;
    msg[padded - 6] = (lo >>> 16) & 0xff;
    msg[padded - 5] = (lo >>> 24) & 0xff;
    msg[padded - 4] = hi & 0xff;
    msg[padded - 3] = (hi >>> 8) & 0xff;
    msg[padded - 2] = (hi >>> 16) & 0xff;
    msg[padded - 1] = (hi >>> 24) & 0xff;

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var M = new Int32Array(16);
    var off, i, f, g, tmp, A, B, C, D, sum;
    for (off = 0; off < padded; off += 64) {
      for (i = 0; i < 16; i++) {
        M[i] = (msg[off + i * 4]) | (msg[off + i * 4 + 1] << 8) |
               (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24);
      }
      A = a0; B = b0; C = c0; D = d0;
      for (i = 0; i < 64; i++) {
        if (i < 16) { f = (B & C) | (~B & D); g = i; }
        else if (i < 32) { f = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
        else if (i < 48) { f = B ^ C ^ D; g = (3 * i + 5) & 15; }
        else { f = C ^ (B | ~D); g = (7 * i) & 15; }
        tmp = D; D = C; C = B;
        sum = (A + f) | 0;
        sum = (sum + MD5_K[i]) | 0;
        sum = (sum + M[g]) | 0;
        B = (B + rotl(sum, MD5_S[i])) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
  }

  function hexLE(x) {
    var s = '', j, byte;
    for (j = 0; j < 4; j++) {
      byte = (x >>> (j * 8)) & 0xff;
      s += (byte < 16 ? '0' : '') + byte.toString(16);
    }
    return s;
  }

  /* --- bytes, text, and a single async hash front door -------------------- */
  var encoder = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;

  function toBytes(str) {
    if (encoder) return encoder.encode(str);
    // Manual UTF-8, for the rare browser without TextEncoder.
    var utf = unescape(encodeURIComponent(str));
    var arr = new Uint8Array(utf.length), i;
    for (i = 0; i < utf.length; i++) arr[i] = utf.charCodeAt(i) & 0xff;
    return arr;
  }

  function concatBytes(a, b) {
    var out2 = new Uint8Array(a.length + b.length);
    out2.set(a, 0);
    out2.set(b, a.length);
    return out2;
  }

  var SUBTLE = (typeof window !== 'undefined' && window.crypto && window.crypto.subtle)
    ? window.crypto.subtle : null;
  var SUBTLE_NAME = { sha1: 'SHA-1', sha256: 'SHA-256' };

  /* Always returns a promise, whether the algorithm is sync (MD5) or async
     (subtle). Callers never have to care which. */
  function hashHex(algo, bytes) {
    if (algo === 'md5') return Promise.resolve(md5bytes(bytes));
    if (!SUBTLE) {
      return Promise.reject(new Error('SHA needs a secure context (https). Try MD5, or reload over https.'));
    }
    return SUBTLE.digest(SUBTLE_NAME[algo], bytes).then(function (buf) {
      return LabTool.toHex(new Uint8Array(buf));
    });
  }

  function digestBytesFor(algo) {
    return algo === 'md5' ? 16 : (algo === 'sha1' ? 20 : 32);
  }
  function algoLabel(algo) {
    return algo === 'md5' ? 'MD5' : (algo === 'sha1' ? 'SHA-1' : 'SHA-256');
  }

  /* Bytes formatter that keeps going past GB — the "full lookup table" figure
     below runs to terabytes, and LabTool.humanBytes stops at GB. */
  function bigBytes(n) {
    var units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
  }

  function nf(n) {
    // thousands separators, ES5. The guard is not decoration: a timing that
    // rounds to 0 ms would make a rate Infinity, and String(Infinity) came
    // back through this loop as "Inf,ini,ty".
    if (typeof n === 'number' && !isFinite(n)) return '—';
    var s = String(n), out2 = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out2 = s.charAt(i) + out2;
      if (++c % 3 === 0 && i > 0) out2 = ',' + out2;
    }
    return out2;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  /* --- the built-in wordlist ---------------------------------------------
     A few hundred of the passwords that actually top every leak list, then
     expanded with the digit and year suffixes people genuinely append. That
     expansion is honest: "password1", "sunshine2024" and "dragon!" are exactly
     the kind of entry a real cracking dictionary carries. It is built once,
     the first time it is needed, and the true count is reported on screen —
     never a round number I made up. */
  var BASE_WORDS = ('password 123456 123456789 12345678 12345 1234567 1234567890 qwerty ' +
    'abc123 password1 111111 123123 admin letmein welcome monkey login princess ' +
    'qwertyuiop solo passw0rd starwars whatever dragon sunshine iloveyou trustno1 ' +
    'master hello freedom football baseball superman batman michael shadow ashley ' +
    'jennifer jordan hunter michelle charlie andrew matthew abcdef abcabc access ' +
    'flower hottie loveme zaq1zaq1 password123 000000 654321 666666 121212 ' +
    'qazwsx mustang harley ranger jordan23 buster soccer hockey killer george ' +
    'sexy andrea joshua pepper thomas jessica pepper1 ginger nicole daniel ' +
    'babygirl lovely jesus naruto tigger purple angel1 chocolate computer ' +
    'michelle1 maggie summer taylor bailey donald qwerty123 letmein1 samsung ' +
    'liverpool arsenal chelsea barcelona google internet service canada test ' +
    'guest info admin123 root toor changeme secret cookie orange banana apple ' +
    'cheese pumpkin nintendo playstation xbox minecraft fortnite pokemon zelda ' +
    'ninja spider snoopy tinkerbell diamond crystal amanda melissa rachel ' +
    'hannah abigail madison brandon justin tyler austin dakota cody logan ' +
    'ryan jacob nathan kevin brian jason david robert richard william ' +
    'joseph thomas12 charles christopher money1 iloveu forever loveyou 7777777 ' +
    'gateway raiders yankees cowboys eagles steelers packers rangers giants ' +
    'lakers celtics maverick phoenix winter spring autumn august october ' +
    'welcome1 welcome123 admin1 test123 pass123 hello123 love123 mypass ' +
    'letmein123 qwe123 asdf asdfgh asdfghjkl zxcvbn zxcvbnm 1q2w3e 1q2w3e4r ' +
    'q1w2e3r4 password12 987654321 iloveyou1 sunshine1 princess1 michael1 ' +
    'jordan1 harley1 ranger1 buster1 soccer1 hockey1 baseball1 football1 ' +
    'superman1 batman1 shadow1 master1 dragon1 monkey1 freedom1 whatever1 ' +
    'starwars1 nintendo1 pokemon1 minecraft1 fortnite1 liverpool1 arsenal1 ' +
    'chelsea1 barcelona1 chocolate1 computer1 internet1 diamond1 crystal1 ' +
    'flower1 orange1 banana1 apple1 cookie1 secret1 pepper1a purple1 ' +
    'summer1 winter1 spring1 phoenix1 maverick1 gateway1 raiders1 yankees1').split(/\s+/);

  var SUFFIXES = ['', '1', '12', '123', '1234', '!', '2', '01', '2023', '2024', '2025', '69', '007'];

  var WORDLIST = null;
  function buildWordlist() {
    if (WORDLIST) return WORDLIST;
    // hasOwnProperty rather than a bare truthiness test: a plain object
    // inherits toString, constructor and friends, so a wordlist entry that
    // happened to be named one of those would be silently dropped as a
    // duplicate. None are today. That is luck, not design.
    var seen = {}, list = [], i, j, base, cap, cand;
    function take(w) {
      if (seen.hasOwnProperty(w)) return;
      seen[w] = 1;
      list.push(w);
    }
    for (i = 0; i < BASE_WORDS.length; i++) {
      base = BASE_WORDS[i];
      if (!base) continue;
      cap = base.charAt(0).toUpperCase() + base.slice(1);
      for (j = 0; j < SUFFIXES.length; j++) {
        cand = base + SUFFIXES[j];
        take(cand);
        // capitalised variant only for the plain and "1" suffixes — enough to
        // look real without quadrupling the list.
        if (SUFFIXES[j] === '' || SUFFIXES[j] === '1') take(cap + SUFFIXES[j]);
      }
    }
    WORDLIST = list;
    return list;
  }

  /* ======================================================================
     STATE
     ====================================================================== */
  var table = null;        // hash(hex) -> password, for the current algo
  var tableAlgo = null;
  var busy = false;
  var activeStep = 1;
  var rainbow = null;      // built rainbow table (always MD5)

  function guardBusy() {
    if (busy) {
      setStatus('Still working — wait for this one to finish.');
      return true;
    }
    return false;
  }

  function setBusy(on) {
    busy = on;
    var ids = ['rt-step1', 'rt-step2', 'rt-step3', 'rt-step4', 'rt-step5', 'tool-run', 'rt-algo'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = on;
    });
  }

  /* ======================================================================
     STEP 1 — build the lookup table, chunked so the page keeps breathing.
     ====================================================================== */
  function buildTable(algo, onDone) {
    var words = buildWordlist();
    table = {};
    tableAlgo = algo;
    var digestBytes = digestBytesFor(algo);
    var n = words.length;
    var i = 0;
    var CHUNK = (algo === 'md5') ? 600 : 200;
    // Two floors, not estimates: what the entries weigh as the hex text this
    // page actually holds, and what the same entries would weigh with the
    // digests kept as raw bytes. Neither counts JS string overhead — the
    // "rough memory" row below does that, badly, and says so.
    var contentBytes = 0;
    var binaryBytes = 0;
    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    out.clear();
    out.heading('Building a lookup table');
    out.dim('Hashing every entry in the built-in wordlist with ' + algoLabel(algo) + ',');
    out.dim('and keeping a map from digest back to password. This is what most');
    out.dim('people picture when they say "rainbow table" — it is really just a');
    out.dim('lookup table. The real thing is step 4, and it is quite different.');
    out.line('');

    function chunk() {
      var end = Math.min(i + CHUNK, n);
      var slice = [], k;
      for (k = i; k < end; k++) slice.push(words[k]);
      var promises = slice.map(function (pw) {
        return hashHex(algo, toBytes(pw)).then(function (hx) {
          if (table[hx] === undefined) {
            table[hx] = pw;
            contentBytes += hx.length + pw.length;
            binaryBytes += (hx.length / 2) + pw.length;
          }
        });
      });
      Promise.all(promises).then(function () {
        i = end;
        var pct = Math.round(i / n * 100);
        setStatus('Building table… ' + pct + '%  (' + nf(i) + ' / ' + nf(n) + ')');
        if (i < n) {
          // yield to the browser so the progress actually paints.
          setTimeout(chunk, 0);
        } else {
          finish();
        }
      })['catch'](function (err) {
        setBusy(false);
        out.err('Could not build the table: ' + ((err && err.message) || String(err)));
        setStatus('Build failed.');
      });
    }

    function finish() {
      var entries = 0, key;
      for (key in table) { if (table.hasOwnProperty(key)) entries++; }
      var collisions = n - entries;   // duplicate digests, almost always dupe words
      var t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      // A rough in-memory estimate: two JS strings per entry (~2 bytes/char
      // plus per-string overhead) and a map slot. Engine-dependent, so it is
      // labelled a rough figure, not a measurement.
      var roughMem = 0, key2;
      for (key2 in table) {
        if (!table.hasOwnProperty(key2)) continue;
        roughMem += (key2.length * 2 + 24) + (table[key2].length * 2 + 24) + 32;
      }

      out.ok('Table built.');
      out.row('algorithm', algoLabel(algo));
      out.row('wordlist entries', nf(n));
      out.row('unique digests', nf(entries));
      // The wordlist is deduplicated before anything is hashed, so this row
      // can only ever mean a genuine digest collision — not two copies of the
      // same password. It has never once fired. It is printed rather than
      // assumed so the "unique digests" figure above is checked, not asserted.
      if (collisions > 0) {
        out.row('digest collisions', nf(collisions) + ' (two different passwords, one digest)');
      }
      out.row('digest size', digestBytes + ' bytes each (' + (digestBytes * 2) + ' hex chars)');
      out.row('stored content', bigBytes(contentBytes) + ' as hex text');
      out.row('same, digests as bytes', bigBytes(binaryBytes) + ' (hex doubles every digest)');
      out.row('rough memory here', '~' + bigBytes(roughMem) + ' (engine-dependent)');
      out.row('build time', (t1 - t0).toFixed(0) + ' ms on this machine');
      out.rule();

      // The scale argument for why full lookup tables are infeasible, computed.
      var fullEntries = Math.pow(26, 8);            // every 8-char lowercase word
      var perEntry = digestBytes + 8;               // digest + ~8 bytes plaintext
      var fullBytes = fullEntries * perEntry;
      out.dim('A lookup table is pure precomputation: fast to search, but you pay');
      out.dim('for it in space. Storing one for every 8-character lowercase');
      out.dim('password (' + nf(fullEntries) + ' of them) at ' + perEntry + ' bytes each would need');
      out.dim('about ' + bigBytes(fullBytes) + '. That space cost is the reason real rainbow');
      out.dim('tables (step 4) trade time for space instead — and the reason a');
      out.dim('salt, which multiplies that cost per user, is so effective.');
      out.line('');
      out.dim('Now try step 2 to crack some hashes with this table.');
      setStatus('Table ready: ' + nf(entries) + ' unique digests.');
      setBusy(false);
      if (onDone) onDone();
    }

    setBusy(true);
    chunk();
  }

  function ensureTable(algo, onReady) {
    if (table && tableAlgo === algo) { onReady(); return; }
    buildTable(algo, onReady);
  }

  /* ======================================================================
     STEP 2 — crack unsalted hashes against the table.
     ====================================================================== */
  /* A hard cap on how many pasted digests are processed. Not a guess: a
     200,000-line paste parses in about a quarter of a second and then asks
     the output pane for 200,000 lines, which is what actually kills the tab.
     The cap is stated on screen whenever it bites. */
  var MAX_HASHES = 500;

  /* Digest lengths in hex characters, for the three algorithms this page can
     produce. Anything else is not a digest it could ever match. */
  function lengthName(len) {
    if (len === 32) return 'MD5';
    if (len === 40) return 'SHA-1';
    if (len === 64) return 'SHA-256';
    return '';
  }

  /* Pulls digests out of pasted text. It tolerates the shapes people actually
     paste — "user:hash", "hash:salt", "hash password" — by taking the token
     on each line that looks like a digest.

     The first version accepted any 16-to-128 hex run and took the first one
     on the line, which meant "deadbeefdeadbeef:5f4dcc3b…" cracked the
     username instead of the hash. So: only the three real digest lengths are
     accepted, and when a line offers more than one, the token matching the
     selected algorithm's length wins.

     Returns counts as well as hashes, because a line that yields nothing has
     to be reported rather than quietly dropped. */
  function parseHashes(text, wantLen) {
    var lines = String(text).split(/[\r\n]+/);
    var hashes = [], skipped = 0, truncated = false;
    var i, ln, parts, p, tok, best, fallback;
    for (i = 0; i < lines.length; i++) {
      ln = lines[i].replace(/^\s+|\s+$/g, '');
      if (!ln) continue;
      parts = ln.split(/[:\s]+/);
      best = ''; fallback = '';
      for (p = 0; p < parts.length; p++) {
        tok = parts[p];
        if (!/^[0-9a-fA-F]+$/.test(tok)) continue;
        if (!lengthName(tok.length)) continue;
        if (wantLen && tok.length === wantLen) { best = tok; break; }
        if (!fallback) fallback = tok;
      }
      tok = best || fallback;
      if (!tok) { skipped++; continue; }
      if (hashes.length >= MAX_HASHES) { truncated = true; break; }
      hashes.push(tok.toLowerCase());
    }
    return { hashes: hashes, skipped: skipped, truncated: truncated };
  }

  function crackStep() {
    if (guardBusy()) return;
    var algo = currentAlgo();
    var inEl = document.getElementById('tool-in');
    var pasted = inEl ? inEl.value : '';
    var wantLen = digestBytesFor(algo) * 2;
    var parsed = parseHashes(pasted, wantLen);
    var hashes = parsed.hashes;
    var hadText = /\S/.test(String(pasted));
    var usingDemo = false;

    function run() {
      out.clear();
      out.heading('Cracking against the lookup table');
      out.dim('Every hash below is looked up in the ' + algoLabel(algo) + ' table. A hit means');
      out.dim('the plaintext was in the wordlist; a miss means it was not.');
      out.line('');

      // Say what happened to the input before showing results. Silently
      // swapping in the demo set because a paste did not parse is the kind of
      // thing that makes a tool feel broken and look fine.
      if (hadText && !hashes.length) {
        out.warn('Nothing in the input box looked like a digest, so none of it could');
        out.warn('be used. A digest here is a run of 32, 40 or 64 hex characters');
        out.warn('(MD5, SHA-1, SHA-256). Running the generated demo set instead.');
        out.line('');
      } else if (parsed.skipped > 0) {
        out.warn(nf(parsed.skipped) + ' line' + (parsed.skipped === 1 ? '' : 's') +
                 ' held no 32, 40 or 64 character hex digest and ' +
                 (parsed.skipped === 1 ? 'was' : 'were') + ' skipped.');
        out.line('');
      }
      if (parsed.truncated) {
        out.warn('More than ' + nf(MAX_HASHES) + ' digests were pasted. Only the first ' + nf(MAX_HASHES) + ' are');
        out.warn('used — past that the output pane, not the lookup, is the bottleneck.');
        out.line('');
      }

      function now() {
        return (typeof performance !== 'undefined') ? performance.now() : Date.now();
      }

      function report(targets) {
        // The commonest way to get a screen full of misses is to paste MD5
        // while the selector still says SHA-256. The tool can see that from
        // the digest length, so it says so rather than letting the visitor
        // conclude their password is strong.
        var mismatch = 0, saw = {}, names = [], m;
        for (m = 0; m < targets.length; m++) {
          if (targets[m].hash.length !== wantLen) {
            mismatch++;
            saw[targets[m].hash.length] = 1;
          }
        }
        for (m in saw) {
          if (saw.hasOwnProperty(m) && lengthName(Number(m))) names.push(lengthName(Number(m)));
        }
        if (mismatch > 0) {
          out.warn('Length mismatch: ' + nf(mismatch) + ' of ' + nf(targets.length) + ' digests are not ' + wantLen + ' hex');
          out.warn('characters, so they cannot be ' + algoLabel(algo) + ' and will all miss.');
          if (names.length) out.warn('They look like ' + names.join(' or ') + '.');
          out.warn('Change the algorithm at the top of the tool and run step 2 again.');
          out.line('');
        }
        reportRows(targets);
      }

      function reportRows(targets) {
        // The lookups are timed on their own. The first version wrapped the
        // printing in the same measurement, which made "lookup time" mostly a
        // measurement of building DOM nodes.
        var found = [], i;
        var t0 = now();
        for (i = 0; i < targets.length; i++) found.push(table[targets[i].hash]);
        var t1 = now();

        var hits = 0, misses = 0;
        for (i = 0; i < targets.length; i++) {
          if (found[i] !== undefined) {
            hits++;
            out.ok('HIT   ' + shortHash(targets[i].hash) + '  ->  ' + found[i]);
          } else {
            misses++;
            out.warn('miss  ' + shortHash(targets[i].hash) + (targets[i].label ? '  (' + targets[i].label + ')' : ''));
          }
        }
        out.rule();
        out.row('checked', nf(targets.length));
        out.row('cracked', nf(hits));
        out.row('not in wordlist', nf(misses));
        out.row('lookup time', (t1 - t0).toFixed(2) + ' ms for all ' + nf(targets.length) + ' (lookups only)');
        out.line('');
        out.dim('A lookup is O(1): the digest is the key. That is what makes an');
        out.dim('unsalted hash of a common password effectively free to reverse —');
        out.dim('the expensive part (hashing the wordlist) was done once, in step 1.');
        if (usingDemo) {
          out.line('');
          out.dim('That was a generated demo set. Paste your own unsalted ' + algoLabel(algo));
          out.dim('hashes into the box on the left to crack those instead.');
        }
        out.line('');
        out.dim('Step 3 adds a salt and runs the exact same table again.');
        setStatus('Cracked ' + nf(hits) + ' of ' + nf(targets.length) + '.');
        setBusy(false);
      }

      if (hashes.length) {
        var targets = hashes.map(function (h) { return { hash: h, label: '' }; });
        report(targets);
      } else {
        // Generated demo: five wordlist members plus one strong non-member.
        usingDemo = true;
        var demoWords = ['password', 'sunshine', 'iloveyou', 'football', 'superman'];
        var strong = 'Tr0ub4dour&3-Zx!92qL';
        var all = demoWords.concat([strong]);
        var built = [];
        var chain = Promise.resolve();
        all.forEach(function (w) {
          chain = chain.then(function () {
            return hashHex(algo, toBytes(w)).then(function (hx) {
              built.push({ hash: hx, label: (w === strong ? 'a long random passphrase' : '') });
            });
          });
        });
        chain.then(function () { report(built); })['catch'](function (err) {
          setBusy(false);
          out.err('Could not hash the demo set: ' + ((err && err.message) || String(err)));
        });
      }
    }

    setBusy(true);
    setStatus('Cracking…');
    ensureTable(algo, run);
  }

  function shortHash(hx) {
    return hx.length > 20 ? (hx.slice(0, 12) + '…' + hx.slice(-6)) : hx;
  }

  /* ======================================================================
     STEP 3 — salt, and show precisely what it does and does not buy you.
     ====================================================================== */
  function randSalt(nBytes) {
    var s = new Uint8Array(nBytes);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(s);
    else { var i; for (i = 0; i < nBytes; i++) s[i] = Math.floor(Math.random() * 256); }
    return s;
  }

  function saltStep() {
    if (guardBusy()) return;
    var algo = currentAlgo();

    function run() {
      out.clear();
      out.heading('Adding a salt');
      out.dim('A salt is random bytes mixed into the password before hashing, and');
      out.dim('stored in the clear next to the digest. Watch what it does to the');
      out.dim('table you just built.');
      out.line('');

      // Part A: the same password, two salts, two digests.
      var pw = 'sunshine';
      var saltA = randSalt(8);
      var saltB = randSalt(8);
      var hxUnsalted, hxA, hxB;

      hashHex(algo, toBytes(pw)).then(function (u) {
        hxUnsalted = u;
        return hashHex(algo, concatBytes(saltA, toBytes(pw)));
      }).then(function (a) {
        hxA = a;
        return hashHex(algo, concatBytes(saltB, toBytes(pw)));
      }).then(function (b) {
        hxB = b;

        out.line('Why the table stops working', 't-info');
        out.row('password', pw);
        out.row('unsalted ' + algoLabel(algo), shortHash(hxUnsalted));
        out.row('salt A = ' + LabTool.toHex(saltA), 'hash(saltA+pw) = ' + shortHash(hxA));
        out.row('salt B = ' + LabTool.toHex(saltB), 'hash(saltB+pw) = ' + shortHash(hxB));
        out.line('');
        out.dim('Same password, three different digests. The wordlist was hashed');
        out.dim('WITHOUT any salt, so none of these salted digests are keys in it.');
        out.line('');

        // Part B: run the whole table against a batch of salted digests -> zero.
        var demoWords = ['password', 'sunshine', 'iloveyou', 'football', 'superman', 'letmein', 'dragon', 'monkey'];
        var saltedTargets = [];
        var chain = Promise.resolve();
        demoWords.forEach(function (w) {
          chain = chain.then(function () {
            var st = randSalt(8);
            return hashHex(algo, concatBytes(st, toBytes(w))).then(function (hx) {
              saltedTargets.push({ pw: w, salt: st, hash: hx });
            });
          });
        });

        chain.then(function () {
          var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          var hits = 0, i;
          for (i = 0; i < saltedTargets.length; i++) {
            if (table[saltedTargets[i].hash] !== undefined) hits++;
          }
          var t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

          out.line('The same table, run against 8 salted digests', 't-info');
          out.row('passwords', 'all 8 ARE in the wordlist');
          out.row('salted hits', nf(hits) + ' of 8');
          out.row('lookup time', (t1 - t0).toFixed(2) + ' ms');
          if (hits === 0) out.ok('Zero. A random per-entry salt made the whole table worthless.');
          else out.warn('Unexpected hit — salts collided, which is astronomically unlikely.');
          out.line('');

          // Part C: the real lesson — per-user salt vs amortisation.
          out.line('What a salt actually stops', 't-info');
          out.dim('A common myth: "a salt makes the password uncrackable." It does');
          out.dim('not. The salt is stored right next to the hash, so an attacker');
          out.dim('targeting ONE user simply hashes the wordlist again with THAT');
          out.dim('user\'s salt. Watch it still work:');
          out.line('');

          var target = 'iloveyou';        // in the wordlist
          var userSalt = randSalt(8);
          var userDigest, otherSalt, otherDigest;

          hashHex(algo, concatBytes(userSalt, toBytes(target))).then(function (d) {
            userDigest = d;
            // Build a per-user table: wordlist hashed WITH this user's salt.
            var words = buildWordlist();
            var perUser = {};
            var t2 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            var CH = (algo === 'md5') ? 600 : 200;
            var idx = 0;
            function fillChunk() {
              var end = Math.min(idx + CH, words.length), k;
              var ps = [];
              for (k = idx; k < end; k++) {
                (function (w) {
                  ps.push(hashHex(algo, concatBytes(userSalt, toBytes(w))).then(function (hx) {
                    if (perUser[hx] === undefined) perUser[hx] = w;
                  }));
                })(words[k]);
              }
              return Promise.all(ps).then(function () {
                idx = end;
                if (idx < words.length) {
                  return new Promise(function (res) { setTimeout(res, 0); }).then(fillChunk);
                }
              });
            }
            return fillChunk().then(function () {
              var t3 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
              var found = perUser[userDigest];
              out.row('target user salt', LabTool.toHex(userSalt));
              out.row('rebuild with that salt', (t3 - t2).toFixed(0) + ' ms (the work redone for ONE user)');
              if (found !== undefined) out.ok('Cracked that one user: ' + found + '  (salt did not save them)');
              else out.warn('Not found — unexpected for a wordlist member.');
              out.line('');

              // Now show that per-user table fails for a DIFFERENT user's salt.
              otherSalt = randSalt(8);
              return hashHex(algo, concatBytes(otherSalt, toBytes(target))).then(function (od) {
                otherDigest = od;
                var stillThere = perUser[otherDigest] !== undefined;
                out.row('second user, same pw', target);
                out.row('second user salt', LabTool.toHex(otherSalt));
                out.row('found in per-user table', stillThere ? 'yes' : 'no');
                if (!stillThere) {
                  out.ok('The per-user table does not transfer. To crack user two you');
                  out.ok('must redo the entire build with THEIR salt.');
                }
                out.line('');
                out.dim('That is the real point of salting. It does not protect a single');
                out.dim('targeted password — a dictionary run with the known salt still');
                out.dim('cracks it. What it destroys is AMORTISATION: one precomputed');
                out.dim('table can no longer crack a million users at once. The attacker');
                out.dim('pays the full cost again for every single user. A slow hash');
                out.dim('(step 5) then makes each of those per-user runs expensive too.');
                setStatus('Salt demo done: table scored ' + nf(hits) + ' of 8.');
                setBusy(false);
              });
            });
          })['catch'](fail);
        })['catch'](fail);
      })['catch'](fail);
    }

    function fail(err) {
      setBusy(false);
      out.err('Salt demo failed: ' + ((err && err.message) || String(err)));
      setStatus('Salt demo failed.');
    }

    setBusy(true);
    setStatus('Salting…');
    ensureTable(algo, run);
  }

  /* ======================================================================
     STEP 4 — a genuine, toy-sized rainbow table.
     --------------------------------------------------------------------
     Not a lookup table. Each chain alternates hashing and a reduction
     function that maps a digest back to a plaintext, for a fixed number of
     links; only the first and last plaintext of each chain are stored. To
     crack a hash you walk it forward through the reductions looking for a
     stored endpoint, then regenerate that chain from its start to find the
     plaintext — which sometimes is not there (a false alarm), because two
     chains can merge onto the same endpoint. MD5 over a 4-character keyspace,
     because the whole point is to run tens of thousands of real hashes fast
     and actually watch this happen.
     ====================================================================== */
  var RT_ALPH = 'abcdefghijklmnopqrstuvwxyz0123456789';
  var RT_PLEN = 4;
  var RT_KEYSPACE = Math.pow(RT_ALPH.length, RT_PLEN);   // 1,679,616
  var RT_CHAINS = 600;
  var RT_CHAINLEN = 120;

  function idxToPlain(idx) {
    var s = '', n = idx, i;
    for (i = 0; i < RT_PLEN; i++) {
      s = RT_ALPH.charAt(n % RT_ALPH.length) + s;
      n = Math.floor(n / RT_ALPH.length);
    }
    return s;
  }

  // Reduction depends on the column, so that a collision in one column does not
  // line two chains up for the rest of their length. Standard construction.
  function reduce(hex, col) {
    var u = parseInt(hex.slice(0, 8), 16);          // first 32 bits of the digest
    return idxToPlain((u + col) % RT_KEYSPACE);
  }

  /* xorshift32. Deterministic, so a rebuild gives the same table and the
     numbers on screen are stable between runs.

     It started life as the textbook LCG, rng = (rng * 1103515245 + 12345) &
     0x7fffffff, and that is a real bug in JavaScript: the product reaches
     about 2.4e18, well past the 2^53 a double holds exactly, so the low bits
     are rounded away before the mask ever runs. Ten of the first twelve draws
     came out with a zero low byte, the start points clustered, and the loop
     below needed 615 draws to find 600 distinct ones. xorshift is pure
     bitwise, so every operation stays exact in 32 bits. */
  function xorshift32(seed) {
    var s = seed | 0;
    return function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return s >>> 0;
    };
  }

  function buildRainbow(onDone) {
    out.heading('Building a real rainbow table (toy size)');
    out.dim('MD5 over a 4-char keyspace of ' + nf(RT_KEYSPACE) + ' (a-z 0-9). ' + RT_CHAINS + ' chains,');
    out.dim('each ' + RT_CHAINLEN + ' links long, but only the two ENDS of each chain are');
    out.dim('stored. That is the space-time trade: at most ' + nf(RT_CHAINS * RT_CHAINLEN) + ' plaintexts');
    out.dim('are covered — fewer in practice, because chains cross and repeat —');
    out.dim('yet only ' + nf(RT_CHAINS) + ' rows are kept. The measured coverage is below.');
    out.line('');

    var endpoints = {};       // endPlain -> startIdx
    var coverage = {};        // every plaintext the chains pass through
    var starts = [];
    var seenStart = {};
    var nextRand = xorshift32(2246789);
    var i, si, guard;
    for (i = 0; i < RT_CHAINS; i++) {
      // Bounded. A duplicate start would only merge two chains, which the
      // endpoint map already tolerates, so this must never be able to spin.
      guard = 0;
      do { si = nextRand() % RT_KEYSPACE; guard++; } while (seenStart[si] && guard < 200);
      seenStart[si] = 1;
      starts.push(si);
    }

    var built = 0;
    var CH = 40;
    var t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    function chunk() {
      var end = Math.min(built + CH, RT_CHAINS), c, col, p, h;
      for (c = built; c < end; c++) {
        p = idxToPlain(starts[c]);
        for (col = 0; col < RT_CHAINLEN; col++) {
          coverage[p] = 1;
          h = md5bytes(toBytes(p));
          p = reduce(h, col);
        }
        if (endpoints[p] === undefined) endpoints[p] = starts[c];
      }
      built = end;
      setStatus('Building chains… ' + Math.round(built / RT_CHAINS * 100) + '%');
      if (built < RT_CHAINS) { setTimeout(chunk, 0); return; }

      var distinctEnds = 0, key;
      for (key in endpoints) { if (endpoints.hasOwnProperty(key)) distinctEnds++; }
      var merged = RT_CHAINS - distinctEnds;
      var covered = 0, key2;
      for (key2 in coverage) { if (coverage.hasOwnProperty(key2)) covered++; }
      var t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

      rainbow = {
        endpoints: endpoints, starts: starts, coverage: coverage,
        distinctEnds: distinctEnds, merged: merged, covered: covered
      };

      out.ok('Rainbow table built.');
      out.row('chains', nf(RT_CHAINS));
      out.row('chain length', nf(RT_CHAINLEN));
      out.row('stored rows', nf(RT_CHAINS) + ' (start + end only)');
      out.row('distinct endpoints', nf(distinctEnds));
      out.row('merged chains', nf(merged) + (merged ? '  <- two chains collided onto one endpoint' : ''));
      out.row('plaintexts covered', nf(covered) + ' of ' + nf(RT_KEYSPACE));
      out.row('coverage', (covered / RT_KEYSPACE * 100).toFixed(3) + '%  (toy size — a real one aims near 99.9%)');
      out.row('build time', (t1 - t0).toFixed(0) + ' ms on this machine');
      out.rule();
      if (onDone) onDone();
    }
    setTimeout(chunk, 0);
  }

  /* Walk a target hash and try to recover its plaintext. Returns the outcome,
     the false alarms encountered so the caller can show one, and a count of
     every MD5 actually computed.

     That count used to cover only the walk, which left the chain
     regenerations — a whole chain per false alarm, and one more for the
     success — out of a number the screen labels as work done. It counts them
     all now. The regeneration loop also hashed q twice per link, once to
     compare and once to reduce; it hashes once and reuses the digest. */
  function rainbowCrack(targetHex) {
    var falseAlarms = 0, hashes = 0, firstAlarm = null;
    var col, p, j, h, q, k, hq;
    for (col = RT_CHAINLEN - 1; col >= 0; col--) {
      // assume the target sits at this column, then walk on to the endpoint.
      p = reduce(targetHex, col);
      for (j = col + 1; j < RT_CHAINLEN; j++) {
        h = md5bytes(toBytes(p));
        hashes++;
        p = reduce(h, j);
      }
      if (rainbow.endpoints[p] !== undefined) {
        // candidate chain — regenerate it from the start and look for the hash.
        q = idxToPlain(rainbow.endpoints[p]);
        for (k = 0; k < RT_CHAINLEN; k++) {
          hq = md5bytes(toBytes(q));
          hashes++;
          if (hq === targetHex) {
            return { found: q, falseAlarms: falseAlarms, hashes: hashes, firstAlarm: firstAlarm };
          }
          q = reduce(hq, k);
        }
        // endpoint matched but the plaintext was not in the chain -> false alarm
        falseAlarms++;
        if (!firstAlarm) firstAlarm = { col: col, endpoint: p, chainStart: idxToPlain(rainbow.endpoints[p]) };
      }
    }
    return { found: null, falseAlarms: falseAlarms, hashes: hashes, firstAlarm: firstAlarm };
  }

  function rainbowStep() {
    if (guardBusy()) return;
    var algoSel = currentAlgo();

    function run() {
      // Pick a covered plaintext so the walk succeeds and can be watched.
      var covKeys = [];
      var key;
      for (key in rainbow.coverage) { if (rainbow.coverage.hasOwnProperty(key)) covKeys.push(key); }
      var target = covKeys[Math.floor(covKeys.length / 2)];
      var th = md5bytes(toBytes(target));

      out.line('Cracking a hash that IS covered', 't-info');
      out.row('target plaintext', target + '  (chosen so it is in the table)');
      out.row('target MD5', th);
      var r = rainbowCrack(th);
      out.row('MD5 hashes computed', nf(r.hashes) + ' (walk plus chain regenerations)');
      out.row('false alarms hit', nf(r.falseAlarms));
      if (r.found === target) out.ok('Recovered: ' + r.found + '  — from ' + nf(RT_CHAINS) + ' stored rows, not a full table.');
      else out.warn('Walk did not recover it (a merge swallowed the chain).');
      out.line('');

      // Find and display a genuine false alarm so it is actually observed.
      out.line('A false alarm, caught in the act', 't-info');
      var alarm = r.firstAlarm;
      if (!alarm) {
        // Bounded, and the bound is the whole point. This started as a scan
        // over every covered plaintext, which is around 70,000 of them at
        // roughly 15 ms per walk — twenty minutes of frozen tab in the worst
        // case, on the one path where the first walk happened to be clean.
        // About half of covered targets throw an alarm, so two dozen tries
        // finds one in all but a rounding error of cases, and the else branch
        // below already says what to make of it when none turns up.
        var t, rr, i, tries = Math.min(24, covKeys.length);
        for (i = 0; i < tries; i++) {
          t = covKeys[Math.floor(covKeys.length * (i + 0.5) / tries)];
          rr = rainbowCrack(md5bytes(toBytes(t)));
          if (rr.firstAlarm) { alarm = rr.firstAlarm; break; }
        }
      }
      if (alarm) {
        var chainPw = alarm.chainStart;
        out.dim('While walking, an endpoint matched a stored chain — so the walk');
        out.dim('regenerated that chain from its start looking for the target. It');
        out.dim('was not there. The endpoint collided by chance:');
        out.row('matched endpoint', alarm.endpoint);
        out.row('chain regenerated from', chainPw);
        out.row('cost of the false alarm', 'one full chain (' + nf(RT_CHAINLEN) + ' hashes) wasted');
        out.ok('That is a false alarm — the tax you pay for storing only endpoints.');
      } else {
        out.dim('No false alarm surfaced on this particular set of walks, which can');
        out.dim('happen with a small table. They are inherent to the design — an');
        out.dim('endpoint match only suggests the plaintext might be in the chain.');
      }
      out.line('');

      // A hash that is NOT covered -> honest miss.
      out.line('A hash that is NOT covered', 't-info');
      var nr = xorshift32(918273);
      var missPlain, guard = 0;
      do { missPlain = idxToPlain(nr() % RT_KEYSPACE); guard++; }
      while (rainbow.coverage[missPlain] && guard < 50);
      var mh = md5bytes(toBytes(missPlain));
      var mr = rainbowCrack(mh);
      out.row('target plaintext', missPlain + (rainbow.coverage[missPlain] ? '  (happened to be covered)' : '  (outside the covered set)'));
      out.row('MD5 hashes computed', nf(mr.hashes));
      if (mr.found) {
        out.ok('Recovered: ' + mr.found);
      } else {
        out.warn('Not recovered. A rainbow table only covers part of the keyspace,');
        out.warn('and at toy size that part is small. Coverage is never guaranteed.');
      }
      out.rule();
      out.dim('Honest scope: this is a demonstration, not a weapon. A real rainbow');
      out.dim('table would be gigabytes and aim to cover almost the whole keyspace.');
      out.dim('It only ever worked on fast, unsalted hashes — the moment there is a');
      out.dim('salt, every user needs their own table, and it collapses (step 3).');
      out.dim('Modern GPUs brute-force these small keyspaces outright, which is why');
      out.dim('rainbow tables are largely obsolete outside unsalted legacy dumps.');
      setStatus('Rainbow demo done.');
      setBusy(false);
    }

    // Clearing here rather than inside buildRainbow: the second run of this
    // step reuses the cached table, skips buildRainbow entirely, and used to
    // append itself under whatever step 3 had left on screen.
    setBusy(true);
    setStatus('Rainbow demo…');
    out.clear();
    if (algoSel !== 'md5') {
      out.dim('(The algorithm selector says ' + algoLabel(algoSel) + ', but this rainbow demo');
      out.dim(' always uses MD5 — see the note at the end. Everything here is MD5.)');
      out.line('');
    }
    // The walks are synchronous and take a moment. Yielding first lets the
    // status line above actually paint before the main thread goes away.
    if (rainbow) setTimeout(run, 0);
    else buildRainbow(run);
  }

  /* ======================================================================
     STEP 5 — fast vs slow, measured here.
     ====================================================================== */
  function benchStep() {
    if (guardBusy()) return;
    if (!SUBTLE) {
      out.clear();
      out.err('This benchmark needs crypto.subtle, which the browser only exposes in');
      out.err('a secure context (https or localhost). Reload over https and retry.');
      setStatus('Benchmark unavailable here.');
      return;
    }

    var SHA_WARM = 300, SHA_N = 4000;
    var PBKDF2_ITERS = 100000, PB_WARM = 2, PB_M = 12;
    var pw = toBytes('correct horse battery staple');
    var salt = randSalt(16);

    out.clear();
    out.heading('Fast vs slow hashing, measured on this machine');
    out.dim('Timing ' + nf(SHA_N) + ' SHA-256 digests against ' + nf(PB_M) + ' PBKDF2-HMAC-SHA256');
    out.dim('derivations at ' + nf(PBKDF2_ITERS) + ' iterations. A short warm-up runs first so');
    out.dim('the JIT is hot. This blocks nothing — subtle is async.');
    out.line('');
    setStatus('Benchmarking…');
    setBusy(true);

    function timeSha(count) {
      var i = 0;
      var t0 = performance.now();
      function step() {
        if (i >= count) return Promise.resolve(performance.now() - t0);
        i++;
        return SUBTLE.digest('SHA-256', pw).then(step);
      }
      return step();
    }

    function timePbkdf2(count, key) {
      var i = 0;
      var t0 = performance.now();
      function step() {
        if (i >= count) return Promise.resolve(performance.now() - t0);
        i++;
        return SUBTLE.deriveBits(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
          key, 256).then(step);
      }
      return step();
    }

    // Warm up SHA, measure SHA, import the PBKDF2 key, warm up, measure.
    timeSha(SHA_WARM).then(function () {
      return timeSha(SHA_N);
    }).then(function (tsha) {
      var shaRate = SHA_N / (tsha / 1000);
      out.line('SHA-256 (a deliberately FAST hash)', 't-info');
      out.row('digests', nf(SHA_N));
      out.row('elapsed', tsha.toFixed(0) + ' ms');
      out.row('rate here', nf(Math.round(shaRate)) + ' hashes/sec');
      out.line('');

      return SUBTLE.importKey('raw', pw, { name: 'PBKDF2' }, false, ['deriveBits'])
        .then(function (key) {
          return timePbkdf2(PB_WARM, key).then(function () {
            return timePbkdf2(PB_M, key).then(function (tp) {
              var pbRate = PB_M / (tp / 1000);
              out.line('PBKDF2-HMAC-SHA256 (a deliberately SLOW hash)', 't-info');
              out.row('iterations each', nf(PBKDF2_ITERS));
              out.row('derivations', nf(PB_M));
              out.row('elapsed', tp.toFixed(0) + ' ms');
              out.row('rate here', pbRate.toFixed(1) + ' derivations/sec');
              out.rule();

              var ratio = shaRate / pbRate;
              out.ok('One PBKDF2 guess costs about ' + nf(Math.round(ratio)) + ' SHA-256 guesses here.');
              out.dim('That ratio is the point. A defender who switches from raw SHA-256');
              out.dim('to PBKDF2 at ' + nf(PBKDF2_ITERS) + ' iterations makes every single guess in an');
              out.dim('offline attack roughly ' + nf(Math.round(ratio)) + ' times more expensive.');
              out.line('');
              out.warn('Read this number honestly:');
              out.dim('- It is one browser, on one machine, on one day. Reload and it moves.');
              out.dim('- The SHA-256 rate above is throttled by per-call overhead in JS;');
              out.dim('  native code and especially a GPU are orders of magnitude faster.');
              out.dim('- So trust the RATIO between the two, not either absolute rate.');
              out.dim('- PBKDF2 is only compute-hard. bcrypt, scrypt and Argon2 are also');
              out.dim('  MEMORY-hard, which is what actually blunts GPU and ASIC attacks —');
              out.dim('  and this page cannot measure that fairly, so it does not try.');
              setStatus('Benchmark done: ~' + nf(Math.round(ratio)) + 'x.');
              setBusy(false);
            });
          });
        });
    })['catch'](function (err) {
      setBusy(false);
      out.err('Benchmark failed: ' + ((err && err.message) || String(err)));
      setStatus('Benchmark failed.');
    });
  }

  /* ======================================================================
     Wiring
     ====================================================================== */
  function currentAlgo() {
    var sel = document.getElementById('rt-algo');
    return sel ? sel.value : 'sha256';
  }

  var STEP_LABELS = {
    1: 'Hashes to crack — not used by this step',
    2: 'Hashes to crack (one per line) — optional, blank uses a demo set',
    3: 'Hashes to crack — not used by this step',
    4: 'Hashes to crack — not used by this step',
    5: 'Hashes to crack — not used by this step'
  };

  function setActiveStep(n) {
    activeStep = n;
    var i;
    for (i = 1; i <= 5; i++) {
      var b = document.getElementById('rt-step' + i);
      if (b) b.setAttribute('aria-pressed', i === n ? 'true' : 'false');
    }
    var lbl = document.getElementById('rt-inlabel');
    if (lbl) lbl.textContent = STEP_LABELS[n];
  }

  function runStep(n) {
    if (n === 1) buildTable(currentAlgo(), null);
    else if (n === 2) crackStep();
    else if (n === 3) saltStep();
    else if (n === 4) rainbowStep();
    else if (n === 5) benchStep();
  }

  function chooseAndRun(n) {
    if (guardBusy()) return;
    setActiveStep(n);
    runStep(n);
  }

  LabTool.define({
    id: 'rainbowtables',
    run: function () { chooseAndRun(activeStep); },
    onReady: function () {
      statusEl = document.getElementById('rt-status');
      var i;
      for (i = 1; i <= 5; i++) {
        (function (n) {
          var b = document.getElementById('rt-step' + n);
          if (b) b.addEventListener('click', function () { chooseAndRun(n); });
        })(i);
      }
      var algo = document.getElementById('rt-algo');
      if (algo) algo.addEventListener('change', function () {
        // The built table belongs to one algorithm; drop it when that changes.
        table = null; tableAlgo = null;
        setStatus('Algorithm changed — the table will rebuild on the next step.');
      });
      setActiveStep(1);

      out.dim('Five steps, left to right. Start with 1 to build a lookup table,');
      out.dim('then 2 to crack with it, 3 to watch a salt break it, 4 for a real');
      out.dim('rainbow table, and 5 to measure fast vs slow hashing here.');
      out.line('');
      out.dim('Everything runs in this tab. The SHA algorithms use the browser\'s');
      out.dim('crypto.subtle; MD5 is implemented in the page. Nothing is uploaded.');
      out.dim('Every count and timing below is computed from real hashes, not fixed.');
      setStatus('Ready. Pick a step above.');
    }
  });
})();

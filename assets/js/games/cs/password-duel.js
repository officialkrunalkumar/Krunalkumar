/* ==========================================================================
   password-duel.js — type a password, watch it fall.
   --------------------------------------------------------------------------
   The cracking runs in a Web Worker built from a Blob URL, which is the only
   way to spin up off-thread code under this site's CSP (script-src 'self',
   no unsafe-eval, worker-src blob:). Keeping it off the main thread is not
   an optimisation: at a few hundred thousand guesses a second the page would
   otherwise stop repainting, and the whole point is watching the counter.

   IT IS A REAL SEARCH, deliberately slowed. The worker walks a wordlist,
   then leetspeak substitutions, then brute force over the character set your
   password actually uses. Your password never leaves the tab &mdash; it is
   hashed in the worker and the worker only reports guesses-per-second and
   whether it has landed.

   THE HONEST PART: the estimate afterwards is scaled to what real cracking
   hardware does, not to what a browser does. A browser manages perhaps a
   hundred thousand guesses a second; a rented eight-GPU box does tens of
   billions against a fast hash. Quoting the browser's number would make
   every password look safe, which would be a lie told with a straight face.
   ========================================================================== */

(function () {
  'use strict';

  /* A rented multi-GPU machine against an unsalted fast hash. The figure is
     conservative for MD5/SHA-1 and generous for bcrypt, and the page says
     which it is assuming. */
  var REAL_HASHES_PER_SEC = 5e10;

  var COMMON = [
    'password', '123456', '123456789', 'qwerty', 'abc123', 'letmein', 'monkey',
    'dragon', 'iloveyou', 'admin', 'welcome', 'login', 'princess', 'football',
    'sunshine', 'master', 'shadow', 'passw0rd', 'trustno1', 'baseball', 'india',
    'krishna', 'ganesh', 'cricket', 'mumbai', 'delhi', 'omsairam', 'bismillah'
  ];

  GameShell.define({
    id: 'game-password-duel',
    slug: 'password-duel',
    title: 'Password duel',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var worker = null;
      var running = false;
      var guesses = 0;
      var rate = 0;
      var startedAt = 0;
      var elapsed = 0;
      var result = null;
      /* The phase the worker last reported, so the per-frame repaint in
         update() can tell the truth between worker ticks. */
      var livePhase = 'wordlist';

      function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      /* Character-set size, which is what decides brute-force time. */
      function poolFor(pw) {
        var pool = 0;
        if (/[a-z]/.test(pw)) pool += 26;
        if (/[A-Z]/.test(pw)) pool += 26;
        if (/[0-9]/.test(pw)) pool += 10;
        if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
        return pool || 1;
      }

      function humanTime(seconds) {
        if (seconds < 1) return 'instantly';
        if (seconds < 60) return Math.round(seconds) + ' seconds';
        if (seconds < 3600) return Math.round(seconds / 60) + ' minutes';
        if (seconds < 86400) return Math.round(seconds / 3600) + ' hours';
        if (seconds < 2592000) return Math.round(seconds / 86400) + ' days';
        if (seconds < 31536000) return Math.round(seconds / 2592000) + ' months';
        var years = seconds / 31536000;
        if (years < 1000) return Math.round(years) + ' years';
        if (years < 1e6) return Math.round(years / 1000) + ' thousand years';
        if (years < 1e9) return Math.round(years / 1e6) + ' million years';
        if (years < 1e12) return Math.round(years / 1e9) + ' billion years';
        return 'longer than the universe has existed';
      }

      var WORKER_SRC = [
        'var COMMON = null;',
        'function fnv(s){var h=0x811c9dc5;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}',
        'self.onmessage = function (e) {',
        '  var d = e.data;',
        '  if (d.type !== "crack") return;',
        '  COMMON = d.common;',
        '  var targetHash = fnv(d.password);',
        '  var target = d.password;',
        '  var n = 0, found = null, phase = "wordlist";',
        '  var t0 = Date.now(), last = t0;',
        /* Phase 1: the wordlist itself. */
        '  for (var i = 0; i < COMMON.length && !found; i++) {',
        '    n++; if (fnv(COMMON[i]) === targetHash && COMMON[i] === target) found = COMMON[i];',
        '  }',
        /* Phase 2: wordlist with common mangling, which is what real
           crackers do and what defeats "password" -> "P@ssw0rd1". */
        '  if (!found) {',
        '    phase = "rules";',
        '    var subs = [["a","@"],["a","4"],["e","3"],["i","1"],["o","0"],["s","$"],["s","5"]];',
        '    var suffix = ["","1","12","123","!","1!","2024","2025","01","007"];',
        '    for (var w = 0; w < COMMON.length && !found; w++) {',
        '      var base = COMMON[w];',
        '      var variants = [base, base.charAt(0).toUpperCase() + base.slice(1), base.toUpperCase()];',
        '      for (var s = 0; s < subs.length; s++) {',
        '        variants.push(base.split(subs[s][0]).join(subs[s][1]));',
        '        variants.push((base.charAt(0).toUpperCase()+base.slice(1)).split(subs[s][0]).join(subs[s][1]));',
        '      }',
        '      for (var v = 0; v < variants.length && !found; v++) {',
        '        for (var x = 0; x < suffix.length; x++) {',
        '          var cand = variants[v] + suffix[x];',
        '          n++;',
        '          if (cand === target) { found = cand; break; }',
        '        }',
        '      }',
        '    }',
        '  }',
        /* Phase 3: brute force over the observed character set. Capped, and
           the cap is reported honestly rather than pretended past. */
        '  if (!found) {',
        '    phase = "brute";',
        '    var set = d.charset.split("");',
        '    var maxLen = Math.min(target.length, 6);',
        '    var stop = false;',
        '    for (var len = 1; len <= maxLen && !found && !stop; len++) {',
        '      var idx = []; for (var q = 0; q < len; q++) idx.push(0);',
        '      while (!found) {',
        '        var cand2 = ""; for (var c = 0; c < len; c++) cand2 += set[idx[c]];',
        '        n++;',
        '        if (cand2 === target) { found = cand2; break; }',
        '        if (Date.now() - t0 > 9000) { stop = true; break; }',
        '        if (Date.now() - last > 120) { last = Date.now(); self.postMessage({type:"tick", n:n, phase:phase}); }',
        '        var k = len - 1;',
        '        while (k >= 0) { idx[k]++; if (idx[k] < set.length) break; idx[k] = 0; k--; }',
        '        if (k < 0) break;',
        '      }',
        '    }',
        '  }',
        '  self.postMessage({ type: "done", n: n, found: found, phase: phase, ms: Date.now() - t0 });',
        '};'
      ].join('\n');

      function build() {
        host.className = 'game-board board-duel';
        host.innerHTML =
          '<form class="duel-form" novalidate>' +
          '  <label class="duel-label" for="duel-pw">Type a password &mdash; it never leaves this tab</label>' +
          '  <input type="text" id="duel-pw" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="try one you have actually used" />' +
          '  <button class="btn btn-primary" type="submit" id="duel-go">Attack it</button>' +
          '</form>' +
          '<div class="duel-live" id="duel-live" hidden>' +
          '  <p class="duel-phase" id="duel-phase">starting…</p>' +
          '  <p class="duel-count" id="duel-count">0</p>' +
          '  <p class="duel-rate" id="duel-rate">guesses</p>' +
          '</div>' +
          '<div class="duel-out" id="duel-out" hidden></div>';

        var form = host.querySelector('.duel-form');
        form.addEventListener('submit', function (e) { e.preventDefault(); attack(); });
      }

      function attack() {
        if (running) return;
        var pw = host.querySelector('#duel-pw').value;
        if (!pw) return;

        running = true;
        guesses = 0;
        elapsed = 0;
        livePhase = 'wordlist';
        result = null;
        host.querySelector('#duel-live').hidden = false;
        host.querySelector('#duel-out').hidden = true;
        g.stat('state', 'attacking');

        var charset = '';
        if (/[a-z]/.test(pw)) charset += 'abcdefghijklmnopqrstuvwxyz';
        if (/[A-Z]/.test(pw)) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (/[0-9]/.test(pw)) charset += '0123456789';
        if (/[^A-Za-z0-9]/.test(pw)) charset += '!@#$%^&*()-_=+[]{};:,.<>?/';

        try {
          var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
          worker = new Worker(url);
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        } catch (err) {
          finish(pw, null, 0, 'unavailable');
          return;
        }

        worker.onmessage = function (e) {
          var d = e.data;
          if (d.type === 'tick') {
            guesses = d.n;
            livePhase = d.phase;
            paintLive(d.phase);
          } else if (d.type === 'done') {
            guesses = d.n;
            finish(pw, d.found, d.n, d.phase, d.ms);
          }
        };
        worker.postMessage({ type: 'crack', password: pw, common: COMMON, charset: charset });
        startedAt = 0;
      }

      function paintLive(phase) {
        var names = { wordlist: 'trying the top passwords', rules: 'trying them mangled — P@ssw0rd1 and friends', brute: 'brute forcing every combination' };
        var p = host.querySelector('#duel-phase');
        var c = host.querySelector('#duel-count');
        var r = host.querySelector('#duel-rate');
        if (p) p.textContent = names[phase] || phase;
        if (c) c.textContent = guesses.toLocaleString('en-US');
        if (r) r.textContent = elapsed > 0.2 ? Math.round(guesses / elapsed).toLocaleString('en-US') + ' guesses a second, in your browser' : 'guesses';
      }

      function finish(pw, found, n, phase, ms) {
        running = false;
        if (worker) { worker.terminate(); worker = null; }
        host.querySelector('#duel-live').hidden = true;
        g.stat('state', found ? 'cracked' : 'held');

        var pool = poolFor(pw);
        var combos = Math.pow(pool, pw.length);
        var realSeconds = combos / 2 / REAL_HASHES_PER_SEC;

        var out = host.querySelector('#duel-out');
        out.hidden = false;
        out.className = 'duel-out ' + (found ? 'is-cracked' : 'is-held');

        var head = found
          ? '<p class="duel-verdict">Cracked in ' + n.toLocaleString('en-US') + ' guesses' +
            (ms != null ? ', in ' + (ms / 1000).toFixed(1) + ' seconds' : '') + '.</p>' +
            '<p class="duel-note">Found by ' + (phase === 'wordlist' ? 'a list of the most common passwords'
              : phase === 'rules' ? 'that same list with obvious substitutions applied — capitals, @ for a, 0 for o, a number on the end'
              : 'plain brute force') + '.</p>'
          : '<p class="duel-verdict">Not cracked here.</p>' +
            '<p class="duel-note">The browser gave up after ' + n.toLocaleString('en-US') +
            ' guesses. That is not the same as safe &mdash; see below.</p>';

        var maths =
          '<div class="duel-maths">' +
          '<p><strong>What it would really take.</strong> Your password uses a character set of ' + pool +
          ' and is ' + pw.length + ' characters long, so there are about ' +
          (combos > 1e21 ? combos.toExponential(2) : Math.round(combos).toLocaleString('en-US')) +
          ' possibilities. Against a rented multi-GPU machine doing fifty billion guesses a second at an ' +
          'unsalted fast hash, the average search takes <strong>' + humanTime(realSeconds) + '</strong>.</p>' +
          '<p class="duel-caveat">That figure assumes the attacker has to guess blind. If your password is on a ' +
          'wordlist, or is a word with predictable substitutions, none of the arithmetic applies &mdash; it falls ' +
          'in the first few million guesses regardless of how long it is. Length beats cleverness: four ordinary ' +
          'words beat <code>P@ssw0rd!</code> by a margin no substitution can close.</p>' +
          '</div>';

        out.innerHTML = head + maths +
          '<p class="duel-privacy">Nothing you typed was sent anywhere. The cracking ran in a worker inside this ' +
          'tab, and the page kept no copy.</p>';
      }

      build();

      return {
        reset: function () {
          if (worker) { worker.terminate(); worker = null; }
          running = false;
          g.stat('state', 'waiting');
          var out = host.querySelector('#duel-out');
          if (out) out.hidden = true;
          var live = host.querySelector('#duel-live');
          if (live) live.hidden = true;
        },

        update: function (dt) {
          if (!running) return;
          elapsed += dt;
          /* The worker reports its real phase every ~120ms; this repaint
             runs every frame and used to hard-code 'brute', so the label
             read "brute forcing every combination" from the first guess —
             through the whole wordlist and rules phases. Repaint with the
             last phase the worker actually reported. */
          paintLive(livePhase);
        }
      };
    }
  });
})();

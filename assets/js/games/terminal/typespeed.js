/* ==========================================================================
   typespeed.js — words fly across the screen; type them before they land.
   --------------------------------------------------------------------------
   Jani Rönkkönen's typespeed (1999). The other typing game on this site, and
   deliberately the opposite of /games/typing-trainer: the trainer is a long
   passage you copy, this is a panic. One measures your endurance, the other
   your recognition speed, and they are genuinely different skills.

   rawInput, because a typing game cannot let the shell eat any key. Words
   are matched by PREFIX as you type: the moment what you have typed uniquely
   identifies one word on screen, that word is the one you are killing, which
   is how the original resolves the ambiguity of two words starting the same.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 76;
  var ROWS = 24;
  var LANES = 16;
  var LANE_TOP = 3;
  var GOAL = COLS - 12;     // the wall words must not reach

  /* A vocabulary that is worth practising rather than a dictionary dump:
     shell commands, security words, and the short common words that carry
     most of English. Sorted into length bands so difficulty can ramp. */
  var WORDS = {
    easy: ['ls', 'cd', 'rm', 'ps', 'top', 'cat', 'awk', 'sed', 'ssh', 'git', 'tar', 'dig', 'set', 'run',
      'the', 'and', 'for', 'you', 'not', 'but', 'all', 'can', 'has', 'one', 'out', 'use', 'new', 'now'],
    medium: ['grep', 'chmod', 'chown', 'mount', 'kill', 'sudo', 'bash', 'curl', 'wget', 'nmap', 'hash',
      'salt', 'port', 'token', 'nonce', 'proxy', 'cache', 'queue', 'array', 'stack', 'yield', 'async',
      'about', 'other', 'which', 'their', 'would', 'there', 'could', 'first', 'after'],
    hard: ['iptables', 'firewall', 'checksum', 'entropy', 'payload', 'sandbox', 'kernel', 'syscall',
      'buffer', 'overflow', 'injection', 'traversal', 'privilege', 'signature', 'certificate',
      'handshake', 'encryption', 'algorithm', 'recursion', 'immutable', 'idempotent', 'concurrency']
  };

  TermShell.define({
    id: 'game-typespeed',
    slug: 'typespeed',
    title: 'Typespeed',
    cols: COLS,
    rows: ROWS,
    rawInput: true,
    startTitle: 'Typespeed',
    startText: 'Words fly in from the left. Type one and press nothing — it dies as soon as it is complete.',

    setup: function (g, t) {
      var flying = [];        // { word, x, lane, speed }
      var buffer = '';
      var lives = 5;
      var killed = 0;
      var chars = 0;
      var elapsed = 0;
      var spawnAcc = 0;
      var input = null;

      /* rawInput means the shell binds nothing, so this needs its own way
         to receive keys — and on a phone, its own way to raise a keyboard.
         An off-screen <input> does both; a document keydown listener does
         neither. */
      function attachInput() {
        if (input || !g.el) return;
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Type the words shown on screen');
        g.el.appendChild(input);

        input.addEventListener('keydown', function (event) {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === 'Escape') { event.preventDefault(); finish(); return; }
          if (g.state !== 'playing') {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); g.start(); }
            return;
          }
          if (event.key === 'Backspace') { event.preventDefault(); buffer = buffer.slice(0, -1); return; }
          if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); buffer = ''; return; }
          if (event.key.length !== 1) return;
          event.preventDefault();
          type(event.key);
        });
        input.addEventListener('input', function () {
          var v = input.value; input.value = '';
          for (var i = 0; i < v.length; i++) type(v.charAt(i));
        });

        /* Tapping the playfield focuses the catcher, which is also what
           opens the keyboard on a touchscreen. */
        var stage = g.el.querySelector('.game-stage');
        if (stage) stage.addEventListener('pointerdown', function () { input.focus(); });
      }

      function focusInput() {
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      }

      function pickWord() {
        var band = elapsed < 25 ? 'easy' : elapsed < 60 ? 'medium' : 'hard';
        /* Mix the bands so it never becomes uniformly long — the original
           keeps short words in the stream for rhythm. */
        if (Math.random() < 0.3) band = 'easy';
        else if (Math.random() < 0.5 && band === 'hard') band = 'medium';
        var list = WORDS[band];
        return list[Math.floor(Math.random() * list.length)];
      }

      function spawn() {
        /* Never two words on the same lane close together, or they overlap
           into an unreadable smear. */
        var free = [];
        for (var l = 0; l < LANES; l++) {
          var busy = false;
          for (var i = 0; i < flying.length; i++) {
            if (flying[i].lane === l && flying[i].x < 14) { busy = true; break; }
          }
          if (!busy) free.push(l);
        }
        if (!free.length) return;
        var word = pickWord();
        flying.push({
          word: word,
          x: -word.length,
          lane: free[Math.floor(Math.random() * free.length)],
          speed: 2.6 + elapsed / 45 + Math.random() * 1.2
        });
      }

      /* Prefix matching. The buffer is compared against every word on
         screen; an exact match kills the closest one. */
      function type(ch) {
        if (g.state !== 'playing') return;
        buffer += ch;
        chars++;

        var hitIndex = -1;
        var bestX = -Infinity;
        var anyPrefix = false;
        for (var i = 0; i < flying.length; i++) {
          var w = flying[i].word;
          if (w === buffer && flying[i].x > bestX) { hitIndex = i; bestX = flying[i].x; }
          if (w.indexOf(buffer) === 0) anyPrefix = true;
        }

        if (hitIndex >= 0) {
          var dead = flying[hitIndex];
          flying.splice(hitIndex, 1);
          killed++;
          g.addScore(dead.word.length * 10);
          g.stat('words', killed);
          buffer = '';
          g.beep(700, 0.04, 'square', 0.04);
          return;
        }

        /* Nothing on screen starts with what has been typed, so it is a
           dead buffer. Clearing it immediately is kinder than making the
           player press space to recover. */
        if (!anyPrefix) {
          buffer = '';
          g.beep(160, 0.04, 'square', 0.02);
        }
      }

      function finish() {
        var mins = Math.max(elapsed, 1) / 60;
        var wpm = Math.round((chars / 5) / mins);
        g.over({
          score: g.score,
          title: killed + ' words',
          message: wpm + ' wpm across ' + Math.round(elapsed) + ' seconds, ' + killed + ' words caught.'
        });
      }

      attachInput();

      return {
        reset: function () {
          flying = [];
          buffer = '';
          lives = 5;
          killed = 0;
          chars = 0;
          elapsed = 0;
          spawnAcc = 0;
          g.stat('words', 0);
          g.stat('lives', lives);
          focusInput();
        },

        update: function (dt) {
          elapsed += dt;
          spawnAcc += dt;
          var every = Math.max(0.55, 1.9 - elapsed / 40);
          while (spawnAcc >= every) { spawnAcc -= every; spawn(); }

          for (var i = flying.length - 1; i >= 0; i--) {
            flying[i].x += flying[i].speed * dt;
            if (flying[i].x + flying[i].word.length >= GOAL) {
              flying.splice(i, 1);
              lives--;
              g.stat('lives', Math.max(0, lives));
              g.sweep(300, 120, 0.25);
              if (lives <= 0) { finish(); return; }
            }
          }
        },

        draw: function (term) {
          term.clear();
          term.text(1, 0, 'TYPESPEED', 'green');
          term.text(13, 0, 'words ' + killed + '   score ' + g.score + '   lives ' + Math.max(0, lives), 'dim');

          // The wall
          for (var y = LANE_TOP; y < LANE_TOP + LANES; y++) term.put(GOAL, y, '│', 'red');

          for (var i = 0; i < flying.length; i++) {
            var f = flying[i];
            var x = Math.round(f.x);
            var y2 = LANE_TOP + f.lane;
            var matched = f.word.indexOf(buffer) === 0 && buffer.length > 0;
            for (var c = 0; c < f.word.length; c++) {
              var near = (x + f.word.length) > GOAL - 8;
              var colour = matched && c < buffer.length ? 'yellow' : near ? 'orange' : 'green';
              term.put(x + c, y2, f.word.charAt(c), colour);
            }
          }

          term.text(1, ROWS - 2, '> ' + buffer + '_', 'white');
          term.text(1, ROWS - 1, 'type a word to destroy it · backspace clears · esc ends the run', 'dim');
        }
      };
    }
  });
})();

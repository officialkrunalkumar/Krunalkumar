/* ==========================================================================
   typing-trainer.js — a typing trainer on real paragraphs.
   --------------------------------------------------------------------------
   The lab at /labs/typing is a benchmark: one short passage, a number at the
   end. This is the practice tool. Longer texts, three durations, and the
   thing neither of them usually gives you — a breakdown of WHICH characters
   you actually miss, which is the only part that tells you what to drill.

   rawInput: true in the manifest, so game-shell.js binds no keyboard at all.
   It could not: a shell that swallows the arrow keys, Space and Escape has
   taken four keys out of a typing test. Everything here is read from a
   hidden <input> instead, which is also what raises the keyboard on a phone
   — a contenteditable div or a bare keydown listener does not.

   MEASUREMENT
     A "word" is five characters. That is what words per minute has meant
     since the typewriter, and counting real words instead would reward
     typing "a a a a a" and punish anyone writing about infrastructure.
     Gross WPM is (correct + incorrect) / 5 per minute; NET is correct / 5,
     which is the headline because it folds accuracy and speed into the one
     number worth quoting.

     Every keystroke is judged against the target at the instant it is
     typed. Backspacing a mistake removes it from the net score but it stays
     in the per-key tally, because it is still a key you struggled with.

   SOUND
     Three registers, and nothing held. A typing test is minutes of
     sustained attention at speed, so anything continuous underneath it is
     an obstruction rather than atmosphere: there is no bed here at all.
     What there is — a click on a correct key, a low buzz on a wrong one, a
     soft note when eight words have gone by clean, and a three-note summary
     at the end.

     The click and the buzz are deliberately not two pitches of the same
     instrument. At 100 wpm a keystroke lasts about a tenth of a second,
     which is nowhere near long enough to compare two tones but is ample to
     tell an unpitched click from a pitched one, so the two events that can
     land back to back are separated by KIND and not by interval. The click
     is gated, because eight of them a second is a rattle rather than a
     typewriter, and it is the quietest thing in the file, because it is the
     only one that happens constantly.
   ========================================================================== */

(function () {
  'use strict';

  /* Real paragraphs, not three-word snippets. A passage short enough to
     memorise stops measuring anything after the third attempt. */
  var CORPUS = {
    prose: [
      'The quality of a decision is not the quality of its outcome. Good decisions sometimes end badly and careless ones sometimes end well, which is why judging yourself by results alone teaches you almost nothing. What you can examine is the process: what you knew at the time, what you chose to find out, and whether you were honest with yourself about the parts you could not know. People who improve are usually the ones who separate those two questions rather than the ones who worry hardest about the answer.',
      'There is a particular kind of patience that comes from having done something badly once. You stop looking for the shortcut, not because you have grown virtuous, but because you have already paid for it and remember the price. Craft is largely this: a long collection of small refusals, each one learned the expensive way, until the shape of the work is decided as much by what you will not do as by what you will.',
      'Most advice is autobiography in disguise. Somebody solved a problem under conditions they have half forgotten, and what survives is the conclusion with the circumstances stripped off. This is why the same guidance can be genuinely useful and completely wrong within the same week. The useful move is not to reject it but to ask what the world looked like when it worked, and whether anything about your own situation resembles that at all.',
      'Attention is the only currency that cannot be borrowed. You can borrow money, and you can sometimes borrow expertise, but nobody can pay attention on your behalf. What makes this uncomfortable is that attention is also the thing most easily taken without being noticed, a minute here and a glance there, until the day has been spent by other people on their priorities and you cannot point to the transaction.'
    ],
    tech: [
      'A system is only as reliable as its least understood component, and the least understood component is rarely the newest one. It is usually the piece that has worked for years without complaint, whose behaviour nobody has needed to examine, and whose original author has moved on. When it finally fails it does so in a way that surprises everyone, not because the failure is exotic, but because no one currently employed knows what it was supposed to do.',
      'Caching is easy to add and difficult to reason about. The moment a value exists in two places, you have taken on the obligation to decide what happens when they disagree, and that decision is almost never written down. Invalidation is hard not because the code is hard but because the question is genuinely ambiguous: how stale is acceptable, to whom, and what does the user see in the window between the change and the refresh?',
      'Backups that have never been restored are not backups. They are a belief about backups. The restore path involves permissions, formats, versions, and free disk space, and every one of those can rot silently while the backup job keeps reporting success. The only honest test is the one that produces a working system from the archive, performed recently enough that nothing important has changed since.',
      'Logging everything is the same mistake as logging nothing, arrived at from the opposite direction. A log that records every event is a log nobody reads, and an unread log provides exactly as much operational insight as an empty one while costing considerably more to store. What you want is the small set of lines that would let a tired person at three in the morning tell the difference between the failure modes.'
    ],
    code: [
      'function debounce(fn, wait) {\n  let timer = null;\n  return function (...args) {\n    if (timer) clearTimeout(timer);\n    timer = setTimeout(() => fn.apply(this, args), wait);\n  };\n}',
      'const groupBy = (items, key) =>\n  items.reduce((acc, item) => {\n    const k = item[key];\n    (acc[k] ||= []).push(item);\n    return acc;\n  }, {});',
      'SELECT u.id, u.email, COUNT(o.id) AS orders\nFROM users AS u\nLEFT JOIN orders AS o ON o.user_id = u.id\nWHERE u.created_at >= NOW() - INTERVAL \'30 days\'\nGROUP BY u.id, u.email\nHAVING COUNT(o.id) > 2\nORDER BY orders DESC\nLIMIT 25;',
      'def binary_search(items, target):\n    lo, hi = 0, len(items) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if items[mid] == target:\n            return mid\n        if items[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1',
      'type Result<T, E = Error> =\n  | { ok: true; value: T }\n  | { ok: false; error: E };\n\nexport function unwrap<T>(r: Result<T>): T {\n  if (!r.ok) throw r.error;\n  return r.value;\n}'
    ],
    punct: [
      'He said, "It is not that simple" — and then, after a pause, added: "though it never is." The report (dated 14/03, revised twice) listed three findings; two were trivial, one was not. "Who signed off on this?" she asked. Nobody answered. The file was named final_v3_ACTUAL.docx, which told her everything she needed to know about the process that produced it.',
      'Consider: if x != y, and y >= z, then what? The answer — assuming a, b, and c are non-null — is "it depends". Don\'t guess; test it. The config (see §4.2) allows `strict: true`, `strict: false`, or nothing at all, and the third case behaves like neither of the first two. Isn\'t that delightful? No. It isn\'t.',
      'Dear Sir/Madam, Further to your email of 3rd June — reference #A-4471/22 — please find attached the revised schedule. Items 1), 2) and 4) are unchanged; item 3) has moved to Q4. Should you require clarification, don\'t hesitate to write. Yours sincerely, K. Shah (Consultant; MSME-registered).'
    ],
    numbers: [
      'The subnet 192.168.1.0/24 holds 254 usable addresses, from 192.168.1.1 to 192.168.1.254, with 192.168.1.255 reserved for broadcast. A /16 gives 65,534 hosts; a /30 gives 2. Port 443 carries HTTPS, 22 carries SSH, 3306 is MySQL and 5432 is PostgreSQL. Hash lengths: MD5 is 128 bits (32 hex chars), SHA-1 is 160, SHA-256 is 256 and SHA-512 is 512.',
      'Invoice #2024-0871: 3 units @ ₹12,499.00 = ₹37,497.00, less 7.5% discount (₹2,812.28), plus 18% GST (₹6,243.25), total ₹40,927.97. Paid 04/09/2024 via UPI ref 447281930022. Balance carried: ₹0.00. Next review 15/12/2024 at 09:30 IST (UTC+05:30).',
      'const MAX = 2 ** 53 - 1; // 9007199254740991\nconst bytes = [0x1f, 0x8b, 0x08, 0x00];\nconst ratio = (1920 / 1080).toFixed(4); // 1.7778\nconst mask = 0b1010_1100 & 0xF0; // 160'
    ]
  };

  GameShell.define({
    id: 'game-typing-trainer',
    slug: 'typing-trainer',
    title: 'Typing trainer',
    rawInput: true,
    bestKey: 'typing-trainer',
    startTitle: 'Typing trainer',
    startText: 'Pick a length and a text, then just start typing — the clock starts on your first keystroke.',

    setup: function (g) {
      var boardEl = g.board;
      var duration = 60;
      var mode = 'prose';

      var target = '';        // the characters to type
      var typed = [];         // per-index: 1 correct, 2 wrong, 0 untyped
      var pos = 0;
      var started = false;
      var elapsed = 0;
      var correct = 0, wrong = 0, keystrokes = 0;
      var missed = {};        // char -> times mistyped
      var cleanWords = 0;     // word-ends since the last mistyped character
      var spans = [];
      var input = null;

      var durSel = document.getElementById('game-duration');
      var textSel = document.getElementById('game-text');
      if (durSel) {
        duration = Number(g.load('duration', '60')) || 60;
        durSel.value = String(duration);
        durSel.addEventListener('change', function () {
          duration = Number(durSel.value) || 60;
          g.save('duration', duration);
          g.start();
        });
      }
      if (textSel) {
        mode = g.load('mode', 'prose');
        if (!CORPUS[mode]) mode = 'prose';
        textSel.value = mode;
        textSel.addEventListener('change', function () {
          mode = textSel.value;
          g.save('mode', mode);
          g.start();
        });
      }

      /* Enough passages joined together that the clock always runs out
         before the text does — at 150 wpm, five minutes is ~3750 chars. */
      function buildText() {
        var pool = CORPUS[mode] || CORPUS.prose;
        var order = pool.slice();
        for (var i = order.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = order[i]; order[i] = order[j]; order[j] = t;
        }
        var out = '';
        var need = Math.ceil(duration * 3.2) + 400;
        var k = 0;
        while (out.length < need) {
          out += (out ? '\n\n' : '') + order[k % order.length];
          k++;
          if (k > 40) break;
        }
        return out;
      }

      function build() {
        if (!boardEl) return;
        boardEl.innerHTML = '';
        boardEl.className = 'game-board board-typing';

        /* A real input, visually hidden but focusable. This is what opens
           the on-screen keyboard on a phone; a keydown listener on the
           document does not, and a contenteditable brings its own problems
           with autocorrect and paste. */
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Type the passage shown');
        boardEl.appendChild(input);

        var text = document.createElement('div');
        text.className = 'typing-text';
        text.id = 'typing-text';
        boardEl.appendChild(text);

        /* Deliberately EMPTY until the run starts. The overlay above the
           board is only 82% opaque, so this line was legible through it
           before Play had been pressed — an instruction to start typing,
           sitting on top of a game that was not listening yet. People read
           it, typed, and concluded the game was broken. It was a fair
           conclusion. The overlay owns the pre-start message; this line only
           speaks once there is a run to speak about. */
        var hint = document.createElement('p');
        hint.className = 'typing-hint';
        hint.textContent = '';
        boardEl.appendChild(hint);

        var results = document.createElement('div');
        results.className = 'typing-results';
        results.hidden = true;
        boardEl.appendChild(results);

        boardEl.addEventListener('pointerdown', function () {
          if (input) input.focus();
        });

        input.addEventListener('keydown', onKey);
        /* ----------------------------------------------------------------
           The safety net: typing works even when the input is not focused.

           Everything above depends on a hidden <input> holding focus, and
           focus is the least reliable thing on a web page. The shell used to
           take it back on start; an overlay button holds it after a click; a
           stray tap on the page body drops it; a browser extension can move
           it. Every one of those turns this game into a page that displays
           your own words back at you and ignores them, which is the single
           worst failure available to a typing trainer and the one it
           actually shipped with.

           So the game also listens on the document. If a run is in progress
           and a printable character arrives from anywhere that is not a form
           field, it counts — and the input is quietly refocused so the
           normal path handles whatever comes next.

           Guarded so it cannot eat anyone else's keystrokes: it does nothing
           unless a run is actually in progress, ignores modifier chords, and
           steps aside for any input, textarea, select or contenteditable on
           the page (the site search box being the one that matters).
           ---------------------------------------------------------------- */
        document.addEventListener('keydown', function (event) {
          if (g.state !== 'playing') return;
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          var t = event.target;
          if (t === input) return;
          var tag = (t && t.tagName ? t.tagName : '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (t && t.isContentEditable) return;

          if (event.key === 'Backspace' || (event.key && event.key.length === 1)) {
            if (input) {
              try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
            }
            onKey(event);
          }
        });

        /* Some Android keyboards deliver composed text rather than
           keydown, so the input event is a second path in. */
        input.addEventListener('input', function () {
          var v = input.value;
          input.value = '';
          for (var i = 0; i < v.length; i++) handleChar(v.charAt(i));
        });
      }

      function renderText() {
        var host = boardEl.querySelector('.typing-text');
        if (!host) return;
        host.innerHTML = '';
        spans = [];
        /* Only a window of the text is in the DOM. Rendering 4000 spans and
           restyling them every keystroke is what makes browser typing tests
           stutter; 320 characters around the cursor is plenty to read
           ahead by and costs nothing to repaint. */
        var from = Math.max(0, pos - 60);
        var to = Math.min(target.length, from + 320);
        for (var i = from; i < to; i++) {
          var s = document.createElement('span');
          var ch = target.charAt(i);
          s.textContent = ch === '\n' ? '↵\n' : ch;
          s.className = 'ch' + (typed[i] === 1 ? ' is-ok' : typed[i] === 2 ? ' is-bad' : '') +
                        (i === pos ? ' is-at' : '');
          host.appendChild(s);
          spans[i] = s;
        }
      }

      /* ----------------------------------------------------------------
         The sound. See the SOUND note in the header for why the palette is
         split the way it is; what follows is why each piece is the size it
         is.
         ---------------------------------------------------------------- */

      /* A figure needs its later notes offset from its first, and every
         one-shot the shell offers fires the instant it is called, so the
         offset has to live here. This is that offset and nothing else: no
         state the game reads is touched from inside the callback, so a note
         still in flight when the run ends or the passage is rebuilt can
         only ever make a sound. */
      function after(ms, fn) { setTimeout(fn, ms); }

      /* One correct character. A fourteen-millisecond band of noise sliding
         downward — a key bottoming out, not a note. Nothing about it is
         pitched, which is the whole point: it has to be separable from the
         error buzz by an ear that is reading ahead and not listening.

         The 0.16 s gate is not a guess. Five characters is a word, so a
         sixteenth of a second is exactly one character at 75 wpm: below
         that the tick follows every keystroke, and above it the gate starts
         dropping every other one, so a 120 wpm burst arrives as a soft
         pulse instead of a rattle. Ungated it was eight clicks a second,
         which is not a typewriter, it is a Geiger counter.

         It is also the quietest sound in the file. It fires on nearly every
         key while the mistake fires on few, and the rare event is the one
         that has to be able to interrupt. */
      function tick() {
        if (!g.gate('key', 0.16)) return;
        g.noise(0.014, { type: 'bandpass', freq: 1500, to: 800, q: 1, level: 0.01 });
      }

      /* A clean stretch, marked.

         There is no line here to count — the passage is one wrapped block,
         and the prose and punctuation drills contain no newline at all — so
         the unit has to be the word. But finishing A word is not worth
         hearing about: at 90 wpm that is a note twice a second under the
         ticks, and practice turns into a tune. Finishing EIGHT in a row
         without a mistake is worth hearing about, because it is about five
         seconds of everything going right, and it is the only thing this
         trainer is really asking for.

         The note steps up each time the streak survives another eight words
         and drops back to the bottom on the next mistake, so a good run
         audibly climbs and a scrappy one sits on one pitch. It stops at
         four steps: past that it is no longer a marker, it is a melody, and
         a melody is something the typist starts listening to instead of the
         text. */
      var CLEAN = [587.33, 659.25, 783.99, 880];

      function wordNote() {
        cleanWords++;
        if (cleanWords % 8) return;
        var step = Math.min(3, cleanWords / 8 - 1);
        g.pluck(CLEAN[step], 0.2, 0.016, 'sine');
      }

      /* The summary, played OVER the shell's end sweep rather than instead
         of it: the sweep says the run is finished, this says how it went.
         Three notes, and the third one is the whole message — it lands
         above the second on a clean run, level with it on a middling one,
         and below it when accuracy fell apart. The results panel says the
         same thing far more precisely, but it says it to someone who is
         already looking at the screen, and at the end of a five-minute run
         most people are looking at their hands.

         Held back 180 ms so it starts as the sweep is thinning out. Struck
         together the two simply blur, and the accuracy note is the half
         worth hearing. */
      function finishFigure(acc) {
        var top = acc >= 97 ? 987.77 : acc >= 92 ? 783.99 : 587.33;
        after(180, function () { g.pluck(587.33, 0.22, 0.03, 'triangle'); });
        after(320, function () { g.pluck(783.99, 0.22, 0.03, 'triangle'); });
        after(460, function () { g.pluck(top, 0.5, 0.034, 'triangle'); });
      }

      function handleChar(ch) {
        if (g.state !== 'playing') return;
        if (!started) { started = true; setHint(''); }
        if (pos >= target.length) return;

        keystrokes++;
        var want = target.charAt(pos);
        if (ch === want) {
          typed[pos] = 1; correct++;
          tick();
          /* A space or a newline behind you is a word behind you. The test
             is on the TARGET character, not on what was pressed: a space
             typed where a letter belonged is a mistake and cannot also be
             the end of a word. */
          if (want === ' ' || want === '\n') wordNote();
        }
        else {
          typed[pos] = 2; wrong++;
          missed[want] = (missed[want] || 0) + 1;
          cleanWords = 0;
          /* The mistake, and the one sound here that has to arrive on its
             own terms: low, pitched and buzzy, where the tick is none of
             those. It carries three times the tick's gain, which is more
             headroom than the numbers look like they need — the ear is
             roughly a dozen decibels less sensitive at 180 Hz than up at
             the tick's 1.5 kHz, so matching the two on amplitude would have
             left the sound that fires constantly louder than the one that
             fires rarely, which is backwards. */
          g.beep(180, 0.03, 'square', 0.03);
        }
        pos++;
        renderText();
        updateStats();
        if (pos >= target.length) finish();
      }

      function onKey(event) {
        if (g.state !== 'playing') {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); g.start(); }
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        if (event.key === 'Escape') { event.preventDefault(); finish(); return; }

        if (event.key === 'Backspace') {
          event.preventDefault();
          if (pos > 0) {
            pos--;
            if (typed[pos] === 1) correct--;
            else if (typed[pos] === 2) wrong--;
            typed[pos] = 0;
            renderText();
            updateStats();
          }
          return;
        }

        if (event.key === 'Tab') {
          /* Skip to the start of the next paragraph rather than tabbing
             out — the passage is long and a stuck line should not end the
             run. Shift+Tab still leaves, so this is not a focus trap. */
          if (event.shiftKey) return;
          event.preventDefault();
          var next = target.indexOf('\n\n', pos);
          if (next !== -1) {
            for (var i = pos; i < next + 2; i++) typed[i] = 0;
            pos = next + 2;
            renderText();
          }
          return;
        }

        if (event.key === 'Enter') { event.preventDefault(); handleChar('\n'); return; }
        if (event.key.length !== 1) return;      // shift, arrows, F-keys
        event.preventDefault();
        handleChar(event.key);
      }

      function setHint(text) {
        var hint = boardEl.querySelector('.typing-hint');
        if (hint) hint.textContent = text;
      }

      function grossNet() {
        /* The floor is ONE SECOND, not one millisecond. It used to be 0.001,
           which divides by a sixty-thousandth of a minute — so the very first
           keystroke of a run displayed a speed like 132000 wpm, and the
           number only became sane after a second had passed. It was on screen
           for exactly the moment a new player looks at it to see whether the
           thing works.

           Flooring at a second understates the first second slightly and is
           correct from then on. A words-per-minute figure measured over less
           than a second is not a slightly-wrong measurement, it is noise, and
           showing noise as a number is worse than showing a modest one. */
        var mins = Math.max(elapsed, 1) / 60;
        return {
          gross: Math.round(((correct + wrong) / 5) / mins),
          net: Math.round((correct / 5) / mins),
          acc: keystrokes ? Math.round((correct / keystrokes) * 100) : 100
        };
      }

      function updateStats() {
        var s = grossNet();
        g.stat('wpm', started ? Math.max(0, s.net) : 0);
        g.stat('acc', s.acc + '%');
      }

      function fmtTime(sec) {
        var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
      }

      function finish() {
        if (g.state !== 'playing') return;
        var s = grossNet();
        var net = Math.max(0, s.net);
        showResults(s);
        saveHistory(net, s.acc);
        g.over({
          won: true,
          score: net,
          title: net + ' wpm',
          message: s.acc + '% accuracy · ' + correct + ' correct, ' + wrong + ' wrong · gross ' + s.gross + ' wpm.'
        });
        finishFigure(s.acc);
      }

      /* The per-key breakdown: the part that actually tells you what to
         practise. Sorted by count, top eight, with the invisible
         characters named rather than rendered as a blank box. */
      function showResults(s) {
        var host = boardEl.querySelector('.typing-results');
        if (!host) return;
        var keys = [];
        for (var k in missed) if (Object.prototype.hasOwnProperty.call(missed, k)) keys.push(k);
        keys.sort(function (a, b) { return missed[b] - missed[a]; });
        keys = keys.slice(0, 8);

        var label = function (ch) {
          if (ch === ' ') return 'space';
          if (ch === '\n') return 'enter';
          if (ch === '\t') return 'tab';
          return ch;
        };

        var html = '<h3>Where the time went</h3>';
        html += '<p class="typing-summary">' + Math.max(0, s.net) + ' wpm net · ' + s.gross +
                ' gross · ' + s.acc + '% accurate · ' + correct + ' of ' + keystrokes + ' keys right.</p>';
        if (keys.length) {
          html += '<ul class="typing-keys">';
          for (var i = 0; i < keys.length; i++) {
            html += '<li><kbd>' + label(keys[i]).replace(/&/g, '&amp;').replace(/</g, '&lt;') +
                    '</kbd><span>' + missed[keys[i]] + '</span></li>';
          }
          html += '</ul>';
          html += '<p class="typing-note">These are the characters you mistyped most. It is almost never the letters.</p>';
        } else {
          html += '<p class="typing-note">Not a single mistyped character. Try a longer run or the punctuation drill.</p>';
        }

        var hist = history();
        if (hist.length > 1) {
          var best = 0, sum = 0;
          for (var h = 0; h < hist.length; h++) { best = Math.max(best, hist[h].w); sum += hist[h].w; }
          html += '<p class="typing-note">Last ' + hist.length + ' runs on this device: best ' + best +
                  ' wpm, average ' + Math.round(sum / hist.length) + ' wpm.</p>';
        }

        host.innerHTML = html;
        host.hidden = false;
      }

      function history() {
        try {
          var raw = g.load('history', '[]');
          var arr = JSON.parse(raw);
          return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
        } catch (err) { return []; }
      }

      function saveHistory(wpm, acc) {
        var arr = history();
        arr.push({ w: wpm, a: acc });
        /* Twenty runs is enough for a trend and small enough that the
           stored string stays tiny. */
        while (arr.length > 20) arr.shift();
        g.save('history', JSON.stringify(arr));
      }

      build();

      return {
        reset: function () {
          target = buildText();
          typed = [];
          for (var i = 0; i < target.length; i++) typed.push(0);
          pos = 0;
          started = false;
          elapsed = 0;
          correct = 0; wrong = 0; keystrokes = 0;
          missed = {};
          cleanWords = 0;
          var host = boardEl.querySelector('.typing-results');
          if (host) { host.hidden = true; host.innerHTML = ''; }
          g.stat('wpm', 0);
          g.stat('acc', '100%');
          g.stat('time', fmtTime(duration));
          /* Not 'click here' any more. The document-level listener above
             means a keystroke counts wherever focus happens to be, so telling
             the player to click first would be instructing them to fix a
             problem they no longer have. */
          setHint('Just start typing.');
          renderText();
          if (input) { input.value = ''; try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
        },

        update: function (dt) {
          if (!started) return;
          elapsed += dt;
          var left = Math.max(0, duration - elapsed);
          g.stat('time', fmtTime(left));
          updateStats();
          if (left <= 0) finish();
        }
      };
    }
  });
})();

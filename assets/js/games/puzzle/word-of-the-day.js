/* ==========================================================================
   word-of-the-day.js — five letters, six guesses, a developer's dictionary.
   --------------------------------------------------------------------------
   Two decisions here are not obvious from the code.

   1. THE DAY INDEX IS BUILT FROM LOCAL CALENDAR FIELDS, THROUGH Date.UTC.
      The obvious version, Math.floor(Date.now() / 86400000), rolls over at
      UTC midnight, which is half past five in the morning in India and the
      previous afternoon in California — so "today's word" would arrive at a
      time that has nothing to do with anybody's day. The other obvious
      version, dividing a local timestamp by 86400000, drifts, because a
      local day is 23 or 25 hours twice a year wherever the clocks change.
      So the year, month and date are read in local time and handed to
      Date.UTC purely as arithmetic on three integers. The result changes at
      the player's own midnight, in their own timezone, and DST cannot move
      it. Two people in different timezones therefore get the same word on
      the same calendar date rather than at the same instant, which is what
      "word of the day" actually means to a person.

      That index then walks the list with a stride of 73. 73 is prime and
      does not divide the list length, so every word is used once before any
      word repeats, rather than a hash handing out the same word twice in a
      fortnight.

   2. THERE IS NO OFF-SCREEN INPUT, WHICH IS DELIBERATE. The other typing
      games on this site park a hidden <input> off-screen and focus it,
      because that is the only way to read keystrokes on a phone. Here the
      on-screen keyboard IS the phone path, and focusing a hidden input
      would raise the operating system's keyboard on top of the one the game
      just drew. The shell already gives the board tabindex and focuses it
      when a run starts, so a physical keyboard is read with one keydown
      listener on the board and a phone never sees a text field at all.

   Guesses are written to localStorage after every submission. Not for
   convenience: the shell pauses on a hidden tab and the only way out of its
   pause overlay is a restart, so without persistence, changing tab halfway
   through the daily would quietly destroy it.
   ========================================================================== */

(function () {
  'use strict';

  var ROWS = 6;
  var LEN = 5;

  /* Five-letter words a developer or a security person meets in a normal
     week. The same list is both the answer pool and the accepted-guess list,
     so anything you are allowed to guess is a word that could turn up. */
  var WORDS = [
    'ABORT', 'ADMIN', 'AGENT', 'ALERT', 'ALIAS', 'ARRAY', 'ASYNC', 'AUDIT', 'AWAIT', 'BATCH',
    'BLOCK', 'BOOTS', 'BRACE', 'BREAK', 'BUILD', 'BYTES', 'CACHE', 'CARET', 'CHAIN', 'CHARS',
    'CHECK', 'CLAIM', 'CLASS', 'CLEAN', 'CLEAR', 'CLICK', 'CLOCK', 'CLONE', 'CLOUD', 'CODEC',
    'COLON', 'COMMA', 'COUNT', 'CRASH', 'CRAWL', 'CRYPT', 'CYCLE', 'DEBUG', 'DEFER', 'DELAY',
    'DELTA', 'DEPTH', 'DIGIT', 'DIRTY', 'DISKS', 'DRAFT', 'DRIVE', 'EDGES', 'EMAIL', 'EMPTY',
    'ENTRY', 'EPOCH', 'EQUAL', 'ERROR', 'EVENT', 'FALSE', 'FATAL', 'FENCE', 'FETCH', 'FIELD',
    'FILES', 'FIXES', 'FLAGS', 'FLASH', 'FLOAT', 'FLOOD', 'FLUSH', 'FOCUS', 'FORGE', 'FORKS',
    'FRAME', 'FUZZY', 'GATES', 'GRAPH', 'GROUP', 'GUARD', 'GUEST', 'HEAPS', 'HOOKS', 'HOSTS',
    'HTTPS', 'ICONS', 'IMAGE', 'INDEX', 'INPUT', 'ISSUE', 'JOINS', 'LABEL', 'LATCH', 'LAYER',
    'LEAKS', 'LEASE', 'LEVEL', 'LIMIT', 'LINES', 'LINKS', 'LOCAL', 'LOCKS', 'LOGIC', 'LOGIN',
    'LOOPS', 'MACRO', 'MAGIC', 'MAJOR', 'MERGE', 'MICRO', 'MINOR', 'MIXIN', 'MODAL', 'MODEL',
    'MODEM', 'MOUNT', 'MUTEX', 'NAMES', 'NGINX', 'NODES', 'NOISE', 'NONCE', 'NOTES', 'OAUTH',
    'OCTAL', 'ONION', 'ORDER', 'OWNER', 'PAGES', 'PANIC', 'PARSE', 'PASTE', 'PATCH', 'PATHS',
    'PAUSE', 'PEERS', 'PHASE', 'PHISH', 'PIVOT', 'PIXEL', 'PLAIN', 'POINT', 'POOLS', 'PORTS',
    'POWER', 'PRIME', 'PRINT', 'PROBE', 'PROXY', 'PURGE', 'QUERY', 'QUEUE', 'QUOTA', 'QUOTE',
    'RADIX', 'RAISE', 'RANGE', 'RATIO', 'REACT', 'READS', 'REALM', 'REGEX', 'RELAY', 'RESET',
    'RETRY', 'ROBOT', 'ROLES', 'ROOTS', 'ROUND', 'ROUTE', 'RULES', 'SALTS', 'SCALE', 'SCANS',
    'SCOPE', 'SCORE', 'SCRUB', 'SEEDS', 'SERVE', 'SETUP', 'SHARD', 'SHELL', 'SHIFT', 'SIGNS',
    'SIZES', 'SLASH', 'SLEEP', 'SLICE', 'SNIFF', 'SOCKS', 'SOLID', 'SPAWN', 'SPEED', 'SPIKE',
    'SPLIT', 'SPOOF', 'STACK', 'STAGE', 'STALE', 'START', 'STATE', 'STDIN', 'STEAL', 'STORE',
    'SWARM', 'TABLE', 'TASKS', 'THEFT', 'THROW', 'TIMER', 'TOKEN', 'TRACE', 'TRACK', 'TRAIT',
    'TRAPS', 'TRUNK', 'TRUST', 'TUPLE', 'TWEAK', 'TYPES', 'UNITS', 'UNZIP', 'UPPER', 'USERS',
    'UTILS', 'VALID', 'VALUE', 'VAULT', 'VIRUS', 'WHILE', 'WIDTH', 'WORMS', 'WRITE', 'YIELD',
    'ZEROS', 'ZONES'
  ];

  /* A lookup rather than indexOf: every submitted guess and every restored
     row is checked against it, and Array.prototype.indexOf on 232 strings is
     work with nothing to show for it. */
  var IN_LIST = {};
  (function () {
    for (var i = 0; i < WORDS.length; i++) IN_LIST[WORDS[i]] = true;
  })();

  var KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

  /* Ranked so a letter can only ever improve: absent < present < correct.
     Without the ranking, guessing STACK then SHELL would downgrade the S
     from green to yellow and mislead you into the wrong deduction. */
  var RANK = { absent: 1, present: 2, correct: 3 };
  var SAY = { absent: 'not in the word', present: 'wrong place', correct: 'correct' };

  function localDay() {
    var now = new Date();
    return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  }

  function dailyWord(day) {
    var i = ((day * 73) % WORDS.length + WORDS.length) % WORDS.length;
    return WORDS[i];
  }

  /* Two passes, and the second one is the whole difficulty. A repeated
     letter may only be marked yellow as many times as it is still unclaimed
     in the answer, so guessing ERROR against ROUTE gives one yellow R and
     two grey ones rather than three yellows. */
  function judge(guess, answer) {
    var out = [];
    var spare = {};
    var i, ch;
    for (i = 0; i < LEN; i++) {
      if (guess.charAt(i) === answer.charAt(i)) {
        out.push('correct');
      } else {
        out.push('absent');
        ch = answer.charAt(i);
        spare[ch] = (spare[ch] || 0) + 1;
      }
    }
    for (i = 0; i < LEN; i++) {
      if (out[i] === 'correct') continue;
      ch = guess.charAt(i);
      if (spare[ch] > 0) { out[i] = 'present'; spare[ch] -= 1; }
    }
    return out;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  GameShell.define({
    id: 'game-word-of-the-day',
    slug: 'word-of-the-day',
    title: 'Word of the day',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,
    tapAction: false,

    setup: function (g) {
      var host = g.board;
      var mode = 'daily';
      var answer = '';
      var guesses = [];
      var typed = '';
      var over = false;
      var keyState = {};
      var day = localDay();
      var gridEl = null;
      var msgEl = null;
      var keysEl = null;
      var panelEl = null;
      var tiles = [];
      var keyBtns = {};
      var allKeys = [];
      var msgTimer = null;

      /* ---------------- persistence ---------------- */

      function liveStreak() {
        /* A streak is only alive if the last solved daily was today or
           yesterday. Anything older is a broken chain, whatever the stored
           number says, so the display and the increment agree. */
        var last = Number(g.load('last', 0)) || 0;
        var s = Number(g.load('streak', 0)) || 0;
        if (last === day || last === day - 1) return s;
        return 0;
      }

      function saveProgress() {
        if (mode !== 'daily') return;
        g.save('day', day);
        g.save('rows', guesses.join(','));
      }

      function loadProgress() {
        if (Number(g.load('day', 0)) !== day) return [];
        var raw = String(g.load('rows', ''));
        if (!raw) return [];
        var parts = raw.split(',');
        var ok = [];
        for (var i = 0; i < parts.length && ok.length < ROWS; i++) {
          if (IN_LIST[parts[i]] === true) ok.push(parts[i]);
        }
        return ok;
      }

      function recordDaily(won) {
        if (mode !== 'daily') return;
        /* One result per day, counted once. reset() replays a finished
           daily on every reload, so without this guard a refresh would
           inflate the streak. */
        if (Number(g.load('scored', 0)) === day) return;
        var next = won ? liveStreak() + 1 : 0;
        g.save('streak', next);
        g.save('last', won ? day : 0);
        g.save('scored', day);
      }

      /* ---------------- markup ---------------- */

      function build() {
        host.className = 'game-board board-wotd';
        host.innerHTML = '';

        gridEl = el('div', 'wotd-grid');
        for (var r = 0; r < ROWS; r++) {
          var row = el('div', 'wotd-row');
          row.setAttribute('role', 'group');
          row.setAttribute('aria-label', 'Guess ' + (r + 1));
          tiles[r] = [];
          for (var c = 0; c < LEN; c++) {
            var tile = el('span', 'wotd-tile');
            row.appendChild(tile);
            tiles[r][c] = tile;
          }
          gridEl.appendChild(row);
        }
        host.appendChild(gridEl);

        msgEl = el('p', 'wotd-msg');
        msgEl.setAttribute('role', 'status');
        msgEl.setAttribute('aria-live', 'polite');
        host.appendChild(msgEl);

        panelEl = el('div', 'wotd-panel');
        panelEl.hidden = true;
        host.appendChild(panelEl);

        keysEl = el('div', 'wotd-keys');
        keysEl.setAttribute('aria-label', 'On-screen keyboard');
        for (var k = 0; k < KEY_ROWS.length; k++) {
          var krow = el('div', 'wotd-keyrow');
          if (k === 2) krow.appendChild(wideKey('Enter', 'enter'));
          for (var n = 0; n < KEY_ROWS[k].length; n++) {
            krow.appendChild(letterKey(KEY_ROWS[k].charAt(n)));
          }
          if (k === 2) krow.appendChild(wideKey('Delete', 'back'));
          keysEl.appendChild(krow);
        }
        host.appendChild(keysEl);

        host.addEventListener('keydown', onKey);

        /* ----------------------------------------------------------------
           The safety net. The board reads a physical keyboard only while it
           has focus, and it loses that to a click on Today's word, Sound,
           Fullscreen or anywhere in the article — after which every letter
           typed was dropped until the grid was clicked again. It also had
           nothing on load: autoStart runs without a gesture and the shell
           rightly refuses to take focus on page load, so the first thing a
           desktop player typed went nowhere.

           The typed games carry this same net; this one differs in two ways.
           There is no hidden field (the header says why), so it is the board
           that is refocused. And because there is no field, the net has to
           be sure the visitor is looking at the game and not scrolling the
           article beneath it, so it also requires the board to be on screen
           — the guard game-shell.js puts on its own fall-through.
           ---------------------------------------------------------------- */
        document.addEventListener('keydown', function (event) {
          if (g.state !== 'playing') return;
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          var t = event.target;
          if (t && host.contains(t)) return;           // the board's own listener has it
          var tag = (t && t.tagName ? t.tagName : '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (t && t.isContentEditable) return;
          if ((tag === 'button' || tag === 'summary') && (event.key === ' ' || event.key === 'Enter')) return;
          if (tag === 'a' && event.key === 'Enter') return;
          var k = event.key;
          if (k !== 'Backspace' && k !== 'Enter' &&
              (!k || k.length !== 1 || !/[a-z]/i.test(k))) return;
          var box = host.getBoundingClientRect();
          if (!(box.bottom > 0 && box.top < (window.innerHeight || 0))) return;
          try { host.focus({ preventScroll: true }); } catch (err) { host.focus(); }
          onKey(event);
        });

        /* Clicking the grid hands focus back to the board so a physical
           keyboard keeps working after somebody has used the mouse. */
        host.addEventListener('pointerdown', function (event) {
          if (event.target.closest && event.target.closest('button')) return;
          try { host.focus({ preventScroll: true }); } catch (err) { host.focus(); }
        });
      }

      function letterKey(ch) {
        var b = el('button', 'wotd-key', ch);
        b.type = 'button';
        b.setAttribute('data-letter', ch);
        b.addEventListener('click', function () { addLetter(ch); });
        keyBtns[ch] = b;
        allKeys.push(b);
        return b;
      }

      function wideKey(label, kind) {
        var b = el('button', 'wotd-key wotd-key-wide', label);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (kind === 'enter') submit();
          else backspace();
        });
        allKeys.push(b);
        return b;
      }

      /* ---------------- painting ---------------- */

      function paint() {
        var marks;
        for (var r = 0; r < ROWS; r++) {
          var word = null;
          marks = null;
          if (r < guesses.length) {
            word = guesses[r];
            marks = judge(word, answer);
          } else if (r === guesses.length && !over) {
            word = typed;
          }
          for (var c = 0; c < LEN; c++) {
            var tile = tiles[r][c];
            var ch = word ? word.charAt(c) : '';
            tile.textContent = ch;
            var cls = 'wotd-tile';
            if (marks) cls += ' is-' + marks[c];
            else if (ch) cls += ' is-filled';
            tile.className = cls;
            if (marks) tile.setAttribute('aria-label', ch + ', ' + SAY[marks[c]]);
            else if (ch) tile.setAttribute('aria-label', ch);
            else tile.setAttribute('aria-label', 'empty');
          }
        }

        for (var letter in keyBtns) {
          if (!Object.prototype.hasOwnProperty.call(keyBtns, letter)) continue;
          var state = keyState[letter];
          keyBtns[letter].className = 'wotd-key' + (state ? ' is-' + state : '');
          keyBtns[letter].setAttribute('aria-label', state ? letter + ', ' + SAY[state] : letter);
        }
        /* Once the puzzle is settled the keyboard is dead. Disabling it says
           so, rather than leaving keys that look live and do nothing. */
        for (var b = 0; b < allKeys.length; b++) allKeys[b].disabled = over;

        g.stat('mode', mode === 'daily' ? 'Daily' : 'Practice');
        g.stat('guess', over ? guesses.length + '/' + ROWS
                             : Math.min(guesses.length + 1, ROWS) + '/' + ROWS);
        g.stat('streak', liveStreak());
      }

      function say(text, sticky) {
        if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
        msgEl.textContent = text;
        if (!sticky && text) {
          msgTimer = setTimeout(function () { msgEl.textContent = ''; msgTimer = null; }, 2200);
        }
      }

      function shake() {
        gridEl.classList.remove('is-wrong');
        /* Reading offsetWidth forces the removal to take effect before the
           name is added again; without it the shake only ever plays once. */
        var reflow = gridEl.offsetWidth;
        if (reflow >= 0) gridEl.classList.add('is-wrong');
      }

      /* ---------------- play ---------------- */

      function addLetter(ch) {
        if (over || typed.length >= LEN) return;
        typed += ch;
        g.beep(420, 0.03, 'sine', 0.03);
        paint();
      }

      function backspace() {
        if (over || !typed) return;
        typed = typed.slice(0, -1);
        paint();
      }

      function submit() {
        if (over) return;
        if (typed.length < LEN) { say('Five letters needed'); shake(); return; }
        if (IN_LIST[typed] !== true) {
          say(typed + ' is not on the word list');
          shake();
          g.beep(180, 0.08, 'square');
          return;
        }

        var marks = judge(typed, answer);
        for (var i = 0; i < LEN; i++) {
          var ch = typed.charAt(i);
          if (!keyState[ch] || RANK[marks[i]] > RANK[keyState[ch]]) keyState[ch] = marks[i];
        }
        guesses.push(typed);
        var won = typed === answer;
        typed = '';
        saveProgress();

        if (won) {
          g.beep(880, 0.12, 'sine');
          finish(true);
        } else if (guesses.length >= ROWS) {
          g.beep(200, 0.14, 'square');
          finish(false);
        } else {
          g.beep(560, 0.04, 'sine');
          say(hint(marks), false);
          paint();
        }
      }

      function hint(marks) {
        var right = 0, near = 0;
        for (var i = 0; i < LEN; i++) {
          if (marks[i] === 'correct') right++;
          else if (marks[i] === 'present') near++;
        }
        return right + ' in place, ' + near + ' in the word';
      }

      function finish(won) {
        over = true;
        recordDaily(won);
        say('', true);
        paint();
        renderPanel(won);
      }

      function renderPanel(won) {
        panelEl.innerHTML = '';
        panelEl.hidden = false;
        panelEl.className = 'wotd-panel ' + (won ? 'is-won' : 'is-lost');

        panelEl.appendChild(el('p', 'wotd-panel-title',
          won ? 'Got it in ' + guesses.length + (guesses.length === 1 ? ' guess' : ' guesses')
              : 'Out of guesses'));

        var line = el('p', 'wotd-panel-word');
        line.appendChild(document.createTextNode('The word was '));
        line.appendChild(el('strong', null, answer));
        line.appendChild(document.createTextNode('.'));
        panelEl.appendChild(line);

        if (mode === 'daily') {
          var s = liveStreak();
          panelEl.appendChild(el('p', 'wotd-panel-note',
            (won ? 'Streak: ' + s + (s === 1 ? ' day' : ' days') + '. ' : 'Streak reset to zero. ') +
            'The next word arrives at midnight where you are, not at midnight in London.'));
        } else {
          panelEl.appendChild(el('p', 'wotd-panel-note',
            'Practice words do not touch the streak, and you can have as many as you like.'));
        }

        var again = el('button', 'btn btn-primary',
          mode === 'daily' ? 'Try a practice word' : 'Another practice word');
        again.type = 'button';
        again.addEventListener('click', function () { newPractice(); });
        panelEl.appendChild(again);

        try { again.focus({ preventScroll: true }); } catch (err) {}
      }

      function onKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        var target = event.target;
        var onButton = target && target.tagName && target.tagName.toLowerCase() === 'button';
        /* Enter and Space on a focused button are that button's own
           activation. Handling them here as well would fire twice. */
        if (onButton && (event.key === 'Enter' || event.key === ' ')) return;

        if (event.key === 'Enter') { event.preventDefault(); submit(); return; }
        if (event.key === 'Backspace') { event.preventDefault(); backspace(); return; }
        if (event.key.length !== 1) return;
        var ch = event.key.toUpperCase();
        if (ch < 'A' || ch > 'Z') return;
        event.preventDefault();
        addLetter(ch);
      }

      /* ---------------- modes ---------------- */

      function clearBoard() {
        typed = '';
        over = false;
        keyState = {};
        guesses = [];
        panelEl.hidden = true;
        panelEl.innerHTML = '';
        say('', true);
      }

      function replay() {
        /* Rebuild the key colours from the restored guesses so a reloaded
           daily looks exactly as it did before. */
        for (var r = 0; r < guesses.length; r++) {
          var marks = judge(guesses[r], answer);
          for (var i = 0; i < LEN; i++) {
            var ch = guesses[r].charAt(i);
            if (!keyState[ch] || RANK[marks[i]] > RANK[keyState[ch]]) keyState[ch] = marks[i];
          }
        }
        if (guesses.length && guesses[guesses.length - 1] === answer) { over = true; renderPanel(true); }
        else if (guesses.length >= ROWS) { over = true; renderPanel(false); }
      }

      function startDaily() {
        mode = 'daily';
        day = localDay();
        answer = dailyWord(day);
        clearBoard();
        guesses = loadProgress();
        replay();
        paint();
      }

      function newPractice() {
        mode = 'practice';
        answer = g.pick(WORDS);
        clearBoard();
        paint();
        try { host.focus({ preventScroll: true }); } catch (err) {}
      }

      build();

      var dailyBtn = document.getElementById('game-daily');
      var practiceBtn = document.getElementById('game-practice');
      if (dailyBtn) dailyBtn.addEventListener('click', function () { startDaily(); });
      if (practiceBtn) practiceBtn.addEventListener('click', function () { newPractice(); });

      return {
        reset: function () {
          /* A restart must not hand out a new daily word: the daily is the
             daily. Practice restarts do draw a fresh one. */
          if (mode === 'practice') newPractice();
          else startDaily();
        }
      };
    }
  });
})();

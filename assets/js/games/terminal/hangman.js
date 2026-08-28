/* ==========================================================================
   hangman.js — hangman, with a vocabulary worth learning.
   --------------------------------------------------------------------------
   TWO WAYS IN, ONE FUNCTION. The shell binds the four arrows, Space and
   Escape, and deliberately binds no letter at all — that decision is written
   up at length in game-shell.js, and it is what lets the typing games exist.
   A guessing game obviously wants A to mean A, so this file does both: an
   A-Z grid drawn into the character buffer and driven by the arrows, and its
   own keydown listener on the shell element for anyone with a keyboard.
   Both paths call guess() and nothing else, so there is exactly one place
   where a letter is scored and no chance of the two drifting apart. The grid
   is not a phone fallback bolted on afterwards — it is the only input a
   touchscreen has, so it gets the readable half of the screen.

   MISSES RESET WITH EACH WORD, THE RUN DOES NOT. Six wrong guesses is the
   classic rule and it is per word, so the gallows always means the same
   thing. What carries across words is the score and the streak, and losing a
   single word ends the run. Pooling six misses over a whole run instead would
   make the drawing meaningless after the first word.

   Words come off a shuffled deck rather than a random pick, because a random
   pick hands you the same word twice in five minutes often enough to be
   noticed, and being asked to guess 'nonce' again immediately is the fastest
   way to make a word game feel broken.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 64;
  var ROWS = 24;
  var MAX_WRONG = 6;

  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var PER_ROW = 13;           // 26 letters as two rows of thirteen
  var CELL = 4;               // '[A] ' — brackets need the room whether shown or not
  var GRID_X = 6;             // (64 - 13 * 4) / 2, rounded down
  var GRID_Y = 20;

  var GX = 5;                 // the gallows post
  var GY = 2;                 // the top beam
  var BX = GX + 9;            // the column the rope, and therefore the body, hangs in

  /* One entry per wrong guess, in the order a person draws them. Offsets are
     from (BX, GY) so the whole gallows moves by editing two constants. */
  var PARTS = [
    [[0, 2, 'O']],
    [[0, 3, '│'], [0, 4, '│']],
    [[-1, 3, '/']],
    [[1, 3, '\\']],
    [[-1, 5, '/']],
    [[1, 5, '\\']]
  ];

  /* Sixty words from security and computing, each with a one-line definition
     that is shown when the word is solved. The definitions are the reason the
     word list is hand-written rather than pulled from a dictionary: a word you
     had to work out and then read the meaning of is a word you keep. */
  var WORDS = [
    { w: 'cipher', d: 'An algorithm for turning readable text into unreadable text.' },
    { w: 'entropy', d: 'A measure of how unpredictable a key or a password really is.' },
    { w: 'firewall', d: 'A filter that decides which network traffic is allowed through.' },
    { w: 'payload', d: 'The part of an exploit that actually does the attacker\'s work.' },
    { w: 'sandbox', d: 'A restricted environment where untrusted code can run safely.' },
    { w: 'kernel', d: 'The core of an operating system, with direct control of the hardware.' },
    { w: 'checksum', d: 'A short value used to spot accidental corruption in data.' },
    { w: 'handshake', d: 'The opening exchange in which two parties agree how to talk.' },
    { w: 'certificate', d: 'A signed statement binding a public key to a name.' },
    { w: 'nonce', d: 'A number used once, so that a captured message cannot be replayed.' },
    { w: 'salt', d: 'Random data added to a password before it is hashed.' },
    { w: 'hashing', d: 'One-way conversion of data into a fixed-length fingerprint.' },
    { w: 'phishing', d: 'A message impersonating someone you trust, to steal credentials.' },
    { w: 'ransomware', d: 'Malware that encrypts your files and then demands payment.' },
    { w: 'rootkit', d: 'Malware that hides by tampering with the system reporting on it.' },
    { w: 'botnet', d: 'A network of compromised machines under one controller.' },
    { w: 'exploit', d: 'Code that turns a vulnerability into an actual compromise.' },
    { w: 'patch', d: 'A change that closes a known flaw in software.' },
    { w: 'malware', d: 'Any software written to harm or subvert a system.' },
    { w: 'keylogger', d: 'Software that quietly records every key you press.' },
    { w: 'spyware', d: 'Software that watches what you do and reports it elsewhere.' },
    { w: 'worm', d: 'Malware that spreads by itself, with no help from a user.' },
    { w: 'trojan', d: 'A program hiding hostile behaviour inside something you wanted.' },
    { w: 'backdoor', d: 'A hidden way in that bypasses the normal authentication.' },
    { w: 'privilege', d: 'The level of access an account or a process has been granted.' },
    { w: 'injection', d: 'Smuggling data into a place that then treats it as code.' },
    { w: 'traversal', d: 'Escaping a directory to read files you were never meant to see.' },
    { w: 'overflow', d: 'Writing past the end of a buffer, into the memory beyond it.' },
    { w: 'protocol', d: 'An agreed set of rules for exchanging messages.' },
    { w: 'packet', d: 'One small unit of data as it travels across a network.' },
    { w: 'router', d: 'A device that forwards packets between different networks.' },
    { w: 'subnet', d: 'A slice of an address range treated as one local network.' },
    { w: 'gateway', d: 'The router a host sends traffic to when the target is elsewhere.' },
    { w: 'proxy', d: 'A middleman that makes requests on your behalf.' },
    { w: 'socket', d: 'One endpoint of a connection: an address and a port.' },
    { w: 'latency', d: 'The delay between sending something and it arriving.' },
    { w: 'bandwidth', d: 'How much data a link can carry in a given time.' },
    { w: 'compiler', d: 'A program that turns source code into machine code.' },
    { w: 'debugger', d: 'A tool for stopping a running program to look inside it.' },
    { w: 'recursion', d: 'A function defined in terms of calls to itself.' },
    { w: 'pointer', d: 'A value holding the address of something else in memory.' },
    { w: 'register', d: 'A tiny, very fast storage slot inside the processor.' },
    { w: 'cache', d: 'A small fast store of the things you are likely to want again.' },
    { w: 'thread', d: 'One sequence of execution inside a process.' },
    { w: 'deadlock', d: 'Two tasks each waiting for something the other is holding.' },
    { w: 'mutex', d: 'A lock that lets only one thread into a section at a time.' },
    { w: 'syscall', d: 'A request from a program for the kernel to do something.' },
    { w: 'daemon', d: 'A background process with no terminal attached to it.' },
    { w: 'shell', d: 'The program that reads your commands and runs them.' },
    { w: 'bytecode', d: 'A compact instruction set run by a virtual machine.' },
    { w: 'immutable', d: 'A value that cannot be changed after it has been created.' },
    { w: 'idempotent', d: 'An operation with the same effect done twice as done once.' },
    { w: 'concurrency', d: 'Several tasks in progress over overlapping periods.' },
    { w: 'algorithm', d: 'A finite set of steps that solves a stated problem.' },
    { w: 'heuristic', d: 'A rule of thumb that is usually right and never guaranteed.' },
    { w: 'keypair', d: 'A private key and the public key that matches it.' },
    { w: 'signature', d: 'Proof that a message came from the holder of a private key.' },
    { w: 'quarantine', d: 'Isolation of a suspect file so that it cannot run.' },
    { w: 'honeypot', d: 'A decoy system set up to be attacked, and watched.' },
    { w: 'spoofing', d: 'Forging an identifier so traffic looks like someone else\'s.' }
  ];

  /* Greedy wrap. Definitions are one short sentence, so two lines of 58 is
     always enough and there is no need for a general layout engine. */
  function wrap(str, width) {
    var words = String(str).split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + ' ' + words[i] : words[i];
      if (next.length > width && line) { lines.push(line); line = words[i]; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  TermShell.define({
    id: 'game-hangman',
    slug: 'hangman',
    /* Declared here and not only in the manifest, because the manifest is
       build-time data: the generator never hands it to the runtime, so a
       tapAction set only there is a comment. The page copy for this game
       promises a tap does nothing; without this line it did something. */
    tapAction: false,
    title: 'Hangman',
    cols: COLS,
    rows: ROWS,
    bestKey: 'hangman',
    startTitle: 'Hangman',
    startText: 'Sixty security and computing words. Type a letter, or drive the A-Z grid with the arrows.',

    setup: function (g, t) {
      var entry = null;         // the word being guessed, with its definition
      var word = '';
      var found = {};           // letter -> true, for letters in the word
      var used = {};            // letter -> true, for every letter tried
      var wrong = 0;
      var solved = 0;
      var cursor = 0;           // index into ALPHABET
      var phase = 'guess';      // guess | solved | lost
      var note = '';
      var deck = [];

      function stats() {
        g.stat('misses', wrong + '/' + MAX_WRONG);
        g.stat('solved', solved);
      }

      function nextWord() {
        if (!deck.length) {
          deck = [];
          for (var i = 0; i < WORDS.length; i++) deck.push(i);
          g.shuffle(deck);
        }
        entry = WORDS[deck.pop()];
        word = entry.w;
        found = {};
        used = {};
        wrong = 0;
        phase = 'guess';
        note = 'Guess a letter.';
        cursor = 0;
        stats();
      }

      function complete() {
        for (var i = 0; i < word.length; i++) {
          if (!found[word.charAt(i)]) return false;
        }
        return true;
      }

      /* After a guess the cursor sits on a letter that can never be used
         again, so it steps to the next live one. Without this every guess on
         a touchscreen starts with a press that does nothing. */
      function advance() {
        for (var n = 1; n <= 26; n++) {
          var i = (cursor + n) % 26;
          if (!used[ALPHABET.charAt(i).toLowerCase()]) { cursor = i; return; }
        }
      }

      function guess(ch) {
        if (g.state !== 'playing' || phase !== 'guess') return;
        ch = String(ch).toLowerCase();
        if (ch < 'a' || ch > 'z' || ch.length !== 1) return;
        if (used[ch]) { g.beep(160, 0.05, 'square', 0.03); return; }

        used[ch] = true;

        if (word.indexOf(ch) >= 0) {
          found[ch] = true;
          g.beep(660, 0.05, 'sine', 0.05);
          if (complete()) {
            solved++;
            /* Longer words are worth more, and so is a clean sheet. Both
               matter, so both are in the sum rather than one flat figure. */
            g.addScore(word.length * 5 + 10 * (MAX_WRONG - wrong));
            phase = 'solved';
            note = 'Solved. Press Space for the next word.';
            g.sweep(440, 880, 0.25);
            stats();
            return;
          }
          note = '‘' + ch.toUpperCase() + '’ is in it.';
        } else {
          wrong++;
          g.beep(220 - wrong * 20, 0.09, 'square', 0.05);
          note = '‘' + ch.toUpperCase() + '’ is not.';
          if (wrong >= MAX_WRONG) {
            phase = 'lost';
            note = 'Out of guesses.';
            stats();
            g.over({
              score: g.score,
              title: 'Hanged',
              message: 'The word was ' + word + ' — ' + entry.d
            });
            /* over() cancels the frame loop, so without this the last thing
               painted is the board as it stood BEFORE the fatal guess: five
               body parts and the word still hidden. The overlay is
               translucent and the reveal shows through it, so the final
               frame has to be the finished one. */
            g.render();
            return;
          }
        }

        advance();
        stats();
      }

      /* The keyboard half of the input. Bound on the shell element, the same
         place the shell binds the arrows, so a letter only counts when the
         game has focus — an arrow key is still the page's when it is not.
         Ctrl and Cmd combinations are left alone so the browser keeps its
         own shortcuts. */
      if (g.el) {
        g.el.addEventListener('keydown', function (event) {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          var tag = event.target && event.target.tagName
            ? event.target.tagName.toLowerCase() : '';
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          var k = event.key;
          if (!k || k.length !== 1 || !/[a-z]/i.test(k)) return;
          event.preventDefault();
          /* Typing a letter on the game-over screen should not silently do
             nothing; the shell's own handler only reacts to Space and Enter. */
          if (g.state !== 'playing') { g.start(); return; }
          if (phase === 'solved') { nextWord(); return; }
          guess(k);
        });
      }

      function drawGallows(term) {
        var frame = phase === 'lost' ? 'red' : 'dim';
        var flesh = phase === 'lost' ? 'red' : 'orange';
        var i;

        term.put(GX, GY, '┌', frame);
        for (i = 1; i < 9; i++) term.put(GX + i, GY, '─', frame);
        term.put(GX + 9, GY, '┐', frame);
        term.put(BX, GY + 1, '│', frame);                 // the rope
        for (i = 1; i <= 8; i++) term.put(GX, GY + i, '│', frame);
        for (i = -3; i <= 13; i++) term.put(GX + i, GY + 9, '─', frame);
        term.put(GX, GY + 9, '┴', frame);

        for (i = 0; i < wrong && i < PARTS.length; i++) {
          var part = PARTS[i];
          for (var j = 0; j < part.length; j++) {
            term.put(BX + part[j][0], GY + part[j][1], part[j][2], flesh);
          }
        }
      }

      function drawWord(term) {
        var out = '';
        var colour = phase === 'lost' ? 'red' : 'white';
        for (var i = 0; i < word.length; i++) {
          var ch = word.charAt(i);
          var shown = found[ch] || phase !== 'guess';
          out += (shown ? ch.toUpperCase() : '_') + (i === word.length - 1 ? '' : ' ');
        }
        term.centre(13, out, colour);
      }

      function drawGrid(term) {
        for (var i = 0; i < 26; i++) {
          var letter = ALPHABET.charAt(i);
          var low = letter.toLowerCase();
          var x = GRID_X + (i % PER_ROW) * CELL;
          var y = GRID_Y + Math.floor(i / PER_ROW);
          var colour = 'green';
          if (used[low]) colour = found[low] ? 'cyan' : 'red';
          if (i === cursor && phase === 'guess') {
            term.put(x, y, '[', 'yellow');
            term.put(x + 2, y, ']', 'yellow');
            if (!used[low]) colour = 'white';
          }
          term.put(x + 1, y, used[low] ? letter.toLowerCase() : letter, colour);
        }
      }

      return {
        reset: function () {
          solved = 0;
          deck = [];
          nextWord();
        },

        key: function (name) {
          if (g.state !== 'playing') return;

          if (phase === 'solved') {
            /* Any direction is a fair way to say "next" on a touchscreen,
               where the Action button is a long reach from the pad. */
            nextWord();
            return;
          }
          if (phase !== 'guess') return;

          if (name === 'left') cursor = (cursor + 25) % 26;
          else if (name === 'right') cursor = (cursor + 1) % 26;
          else if (name === 'up' || name === 'down') cursor = (cursor + 13) % 26;
          else if (name === 'action') guess(ALPHABET.charAt(cursor));
        },

        draw: function (term) {
          term.clear();

          term.text(2, 0, 'HANGMAN', 'green');
          term.text(12, 0, 'six wrong guesses and the run is over', 'dim');
          for (var i = 0; i < COLS; i++) term.put(i, 1, '─', 'dark');

          drawGallows(term);

          /* The right-hand column: everything you would otherwise have to
             count off the grid yourself. */
          term.text(24, 3, 'MISSED', 'dim');
          var missed = '';
          for (var a = 0; a < 26; a++) {
            var low = ALPHABET.charAt(a).toLowerCase();
            if (used[low] && !found[low]) missed += low + ' ';
          }
          term.text(24, 4, missed || '—', 'red');
          term.text(24, 6, 'LETTERS  ' + word.length, 'dim');
          term.text(24, 7, 'SOLVED   ' + solved, 'dim');
          term.text(24, 8, 'SCORE    ' + g.score, 'dim');

          drawWord(term);
          term.centre(15, note, phase === 'solved' ? 'cyan' : 'grey');

          if (phase !== 'guess' && entry) {
            var lines = wrap(entry.d, 58);
            for (var L = 0; L < lines.length && L < 2; L++) {
              term.centre(16 + L, lines[L], 'dim');
            }
          }

          for (var s = 0; s < COLS; s++) term.put(s, 19, '─', 'dark');
          drawGrid(term);

          term.centre(23, 'Arrows move  ·  Space guesses  ·  or type a letter', 'dim');
        }
      };
    }
  });
})();

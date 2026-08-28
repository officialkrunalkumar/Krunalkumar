/* ==========================================================================
   arithmetic.js — the BSD games drill, with ninety seconds on it.
   --------------------------------------------------------------------------
   Two decisions here are not the obvious ones.

   THE NUMBERS THAT BEAT YOU COME BACK. The original's adaptation is not a
   difficulty slider: every operand you answer wrongly is pushed back into
   the bag the next question is drawn from, so a person who cannot do seven
   times eight is handed sevens and eights until they can. That is kept
   faithfully, because it is the only part of the game that is actually
   teaching anything. The level ramp on top of it is mine, and it moves on
   speed as well as correctness — three right in a row, each under eight
   seconds, or the ceiling stays where it is.

   DIVISION IS GENERATED BACKWARDS. Pick the divisor and the answer, then
   multiply to get the dividend. Drawing two random numbers and asking for
   a ÷ b instead gives sums with no whole answer, which either forces a
   rounding rule nobody agrees on or quietly discards most of what it
   generates. Every division asked here divides exactly.

   rawInput, because the shell binds no letter or digit keys at all. Input
   arrives through an off-screen <input> rather than a document listener:
   it is also what raises the keyboard on a phone, and inputmode numeric
   makes that keyboard a keypad.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 60;
  var ROWS = 24;
  var DURATION = 90;
  var HISTORY = 8;

  /* Operand ceilings per level. Multiplication and division get much lower
     ceilings than addition, because 47 x 63 is a paper sum, not a mental
     one, and a drill that asks it is just wasting the clock. */
  var LEVELS = [
    { add: 10, mul: 5, div: 5 },
    { add: 20, mul: 7, div: 7 },
    { add: 40, mul: 9, div: 9 },
    { add: 75, mul: 12, div: 10 },
    { add: 120, mul: 15, div: 12 },
    { add: 200, mul: 20, div: 15 }
  ];

  var GLYPH = { '+': '+', '-': '-', '*': '×', '/': '÷' };

  /* What a correct answer is worth, before the level is added. Division is
     four times the work of addition and is scored like it. */
  var WEIGHT = { '+': 1, '-': 2, '*': 3, '/': 4 };

  TermShell.define({
    id: 'game-arithmetic',
    slug: 'arithmetic',
    title: 'Arithmetic',
    cols: COLS,
    rows: ROWS,
    rawInput: true,
    bestKey: 'arithmetic',
    startTitle: 'Arithmetic',
    startText: 'Ninety seconds of mental sums. Type the answer and press Enter.',

    setup: function (g, t) {
      var current = null;
      var typed = '';
      var elapsed = 0;
      var left = DURATION;
      var askedAt = 0;
      var right = 0;
      var wrong = 0;
      var answered = 0;
      var timeSum = 0;
      var level = 0;
      var upStreak = 0;
      var downStreak = 0;
      var pool = [];            // operands answered wrongly — see the header
      var history = [];
      var feedback = '';
      var feedbackOk = false;
      var feedbackT = 0;
      var input = null;

      /* ----------------------------------------------------------------
         The operator set, read live from the toolbar so changing it takes
         effect on the next question rather than the next run.
         ---------------------------------------------------------------- */
      var opsValue = '+-*/';
      var opsSel = document.getElementById('game-ops');
      if (opsSel) {
        opsValue = opsSel.value || opsValue;
        opsSel.addEventListener('change', function () {
          opsValue = opsSel.value || '+';
        });
      }

      function activeOps() {
        var list = [];
        for (var i = 0; i < opsValue.length; i++) list.push(opsValue.charAt(i));
        return list.length ? list : ['+'];
      }

      /* ----------------------------------------------------------------
         Question generation.
         ---------------------------------------------------------------- */
      function drawOperand(max) {
        if (pool.length && Math.random() < 0.4) {
          var v = pool[Math.floor(Math.random() * pool.length)];
          /* A number banked at level five must not reappear once the level
             has dropped — it would be harder than anything else on offer. */
          if (v <= max) return v;
        }
        return Math.floor(Math.random() * (max + 1));
      }

      function make() {
        var ops = activeOps();
        var op = ops[Math.floor(Math.random() * ops.length)];
        var lv = LEVELS[level];
        var a, b, ans, swap;

        if (op === '*') {
          a = drawOperand(lv.mul);
          b = drawOperand(lv.mul);
          ans = a * b;
        } else if (op === '/') {
          b = 1 + drawOperand(lv.div - 1);       // never a zero divisor
          ans = drawOperand(lv.div);
          a = b * ans;
        } else {
          a = drawOperand(lv.add);
          b = drawOperand(lv.add);
          if (op === '-' && b > a) { swap = a; a = b; b = swap; }
          ans = op === '-' ? a - b : a + b;
        }

        return { a: a, b: b, op: op, ans: ans, worth: level + 1 + WEIGHT[op] };
      }

      function ask() {
        current = make();
        askedAt = elapsed;
        typed = '';
      }

      /* ----------------------------------------------------------------
         Answering.
         ---------------------------------------------------------------- */
      function avgText() {
        if (!answered) return '—';
        return (timeSum / answered).toFixed(1) + 's';
      }

      function remember(line, ok) {
        history.push({ line: line, ok: ok });
        if (history.length > HISTORY) history.shift();
      }

      function bank(n) {
        pool.push(n);
        if (pool.length > 24) pool.shift();
      }

      function submit() {
        if (g.state !== 'playing' || !current) return;
        if (typed === '') { g.beep(150, 0.05, 'square', 0.03); return; }

        var took = elapsed - askedAt;
        var sum = current.a + ' ' + GLYPH[current.op] + ' ' + current.b + ' = ';
        var ok = Number(typed) === current.ans;

        answered++;
        timeSum += took;

        if (ok) {
          right++;
          g.addScore(current.worth);
          feedback = 'Right, in ' + took.toFixed(1) + 's';
          feedbackOk = true;
          remember(sum + typed + '   ' + took.toFixed(1) + 's', true);
          g.beep(720 + level * 40, 0.05, 'sine');
          downStreak = 0;
          /* Slow but correct holds the level rather than raising it. */
          upStreak = took < 8 ? upStreak + 1 : 0;
          if (upStreak >= 3 && level < LEVELS.length - 1) { level++; upStreak = 0; }
        } else {
          wrong++;
          feedback = 'No — ' + current.ans;
          feedbackOk = false;
          remember(sum + typed + '   was ' + current.ans, false);
          g.beep(180, 0.08, 'square');
          bank(current.a);
          bank(current.b);
          upStreak = 0;
          downStreak++;
          if (downStreak >= 2 && level > 0) { level--; downStreak = 0; }
        }

        feedbackT = 1.6;
        g.stat('right', right);
        g.stat('wrong', wrong);
        g.stat('avg', avgText());
        ask();
      }

      function finish() {
        if (g.state !== 'playing') return;
        var total = right + wrong;
        g.over({
          won: true,
          score: g.score,
          title: right + ' right, ' + wrong + ' wrong',
          message: total
            ? Math.round((right / total) * 100) + '% right, ' + avgText() +
              ' a sum, finishing at level ' + (level + 1) + ' of ' + LEVELS.length + '.'
            : 'No sums answered.'
        });
      }

      /* ----------------------------------------------------------------
         Input. The same off-screen catcher the other typed games use.
         ---------------------------------------------------------------- */
      function attachInput() {
        if (input || !g.el) return;
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('inputmode', 'numeric');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Type the answer to the sum');
        g.el.appendChild(input);

        input.addEventListener('keydown', function (event) {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === 'Escape') { event.preventDefault(); finish(); return; }
          if (g.state !== 'playing') {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); g.start(); }
            return;
          }
          if (event.key === 'Enter') { event.preventDefault(); submit(); return; }
          if (event.key === 'Backspace') { event.preventDefault(); typed = typed.slice(0, -1); return; }
          if (event.key.length !== 1) return;
          event.preventDefault();
          handle(event.key);
        });

        /* Android soft keyboards routinely fire input without a usable
           keydown, so the value is drained here as well and the field is
           emptied again immediately. */
        input.addEventListener('input', function () {
          var v = input.value;
          input.value = '';
          for (var i = 0; i < v.length; i++) handle(v.charAt(i));
        });

        var stage = g.el.querySelector('.game-stage');
        if (stage) stage.addEventListener('pointerdown', focusInput);
      }

      function handle(ch) {
        if (g.state !== 'playing') return;
        if (ch < '0' || ch > '9') return;
        if (typed.length >= 6) return;       // no answer here is that long
        typed += ch;
      }

      function focusInput() {
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
      }

      attachInput();

      /* ----------------------------------------------------------------
         Drawing.
         ---------------------------------------------------------------- */
      function drawBar(term) {
        var barW = 50;
        var frac = Math.max(0, Math.min(1, left / DURATION));
        var fill = Math.round(barW * frac);
        var colour = left <= 10 ? 'red' : left <= 30 ? 'orange' : 'green';
        for (var i = 0; i < barW; i++) {
          term.put(1 + i, 1, i < fill ? '=' : '·', i < fill ? colour : 'dark');
        }
        var clock = Math.ceil(Math.max(0, left)) + 's';
        term.text(COLS - 1 - clock.length, 1, clock, colour);
      }

      return {
        reset: function () {
          elapsed = 0;
          left = DURATION;
          right = 0;
          wrong = 0;
          answered = 0;
          timeSum = 0;
          level = 0;
          upStreak = 0;
          downStreak = 0;
          pool = [];
          history = [];
          feedback = '';
          feedbackT = 0;
          g.stat('right', 0);
          g.stat('wrong', 0);
          g.stat('avg', '—');
          ask();
          focusInput();
        },

        update: function (dt) {
          elapsed += dt;
          left = DURATION - elapsed;
          if (feedbackT > 0) feedbackT -= dt;
          if (left <= 0) { left = 0; finish(); }
        },

        draw: function (term) {
          term.clear();

          term.text(1, 0, 'ARITHMETIC', 'green');
          var head = 'level ' + (level + 1) + '  right ' + right +
                     '  wrong ' + wrong + '  avg ' + avgText();
          term.text(COLS - 1 - head.length, 0, head, 'dim');

          drawBar(term);

          term.box(5, 3, COLS - 10, 7, 'dim');

          if (current) {
            var stem = current.a + ' ' + GLYPH[current.op] + ' ' + current.b + ' = ';
            var full = stem + typed + '_';
            var x = Math.floor((COLS - full.length) / 2);
            term.text(x, 6, stem, 'white');
            term.text(x + stem.length, 6, typed, 'yellow');
            /* A blinking caret, because a static underscore next to a
               typed digit reads as part of the answer. */
            term.put(x + stem.length + typed.length, 6,
              Math.floor(elapsed * 2) % 2 === 0 ? '_' : ' ', 'yellow');
            term.centre(8, 'worth ' + current.worth + ' points', 'dim');
          }

          if (feedbackT > 0) term.centre(10, feedback, feedbackOk ? 'green' : 'red');

          term.text(5, 12, 'last answers', 'dim');
          for (var i = 0; i < history.length; i++) {
            var row = history[history.length - 1 - i];
            term.text(5, 13 + i, row.line, row.ok ? 'green' : 'red');
          }

          term.text(1, ROWS - 1,
            'digits · enter submits · backspace fixes · esc ends', 'dim');
        }
      };
    }
  });
})();

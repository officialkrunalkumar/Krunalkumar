/* ==========================================================================
   typing-app.js — a typing speed test, in the same terminal as the labs.
   --------------------------------------------------------------------------
   The reason this belongs in Labs rather than being a generic typing test:
   the code passages are real snippets in the languages the playgrounds run,
   punctuation and all. Typing prose quickly is a different skill from typing
   `=>`, `::`, `{}` and `$_` quickly, and it is the second one that slows
   people down when they are actually programming.

   Measurement follows the usual convention so the numbers mean the same thing
   they do everywhere else:
     - one "word" is five characters, including spaces
     - WPM is gross: total characters typed / 5, over elapsed minutes
     - accuracy is correct characters / total keystrokes, so a fixed mistake
       still costs you, exactly as a real typo does

   Everything is local. Best scores live in localStorage under the same lab.
   prefix as the playgrounds, so the Labs storage panel counts and clears them
   along with everything else.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.getElementById('typing');
  if (!root) return;

  var PREFIX = 'lab.';
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    gate: $('lab-gate'), agree: $('lab-agree'), leave: $('lab-leave'),
    passage: $('typing-passage'), input: $('typing-input'),
    wpm: $('typing-wpm'), acc: $('typing-acc'), time: $('typing-time'),
    best: $('typing-best'), mode: $('typing-mode'), restart: $('typing-restart'),
    status: $('typing-status'), result: $('typing-result'), resultText: $('typing-result-text')
  };

  /* ======================================================================
     Passages
     ----------------------------------------------------------------------
     Code passages are deliberately short and self-contained: a test is about
     typing accuracy, not reading comprehension, so nothing here needs working
     out before you can type it.
     ====================================================================== */
  var PASSAGES = {
    prose: [
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.',
      'Programs must be written for people to read, and only incidentally for machines to execute.',
      'Simplicity is prerequisite for reliability. A complex system that works is invariably found to have evolved from a simple system that worked.',
      'Premature optimisation is the root of all evil, but that does not mean you should write slow code on purpose.',
      'Any fool can write code that a computer can understand. Good programmers write code that humans can understand.'
    ],
    python: [
      'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
      'counts = {}\nfor word in text.split():\n    counts[word] = counts.get(word, 0) + 1',
      'with open(path) as handle:\n    rows = [line.strip().split(",") for line in handle]'
    ],
    javascript: [
      'const total = items.reduce((sum, item) => sum + item.price, 0);',
      'async function load(url) {\n  const res = await fetch(url);\n  return res.json();\n}',
      'const byId = Object.fromEntries(users.map((u) => [u.id, u]));'
    ],
    c: [
      'int main(void) {\n    printf("%d\\n", 42);\n    return 0;\n}',
      'for (int i = 0; i < n; i++) {\n    total += values[i];\n}',
      'struct Node { int value; struct Node *next; };'
    ],
    sql: [
      'SELECT dept, COUNT(*) FROM employee GROUP BY dept ORDER BY 2 DESC;',
      'UPDATE orders SET status = \'shipped\' WHERE id = 42 AND status = \'pending\';',
      'SELECT a.name, b.city FROM emp a JOIN dept b ON b.name = a.dept;'
    ]
  };

  var passage = '';
  var typed = '';
  var started = 0;
  var keystrokes = 0;
  var correctStrokes = 0;
  var ticker = null;
  var finished = false;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(PREFIX + key);
      localStorage.setItem(PREFIX + key, value);
    } catch (err) { return null; }
  }

  function pick() {
    var mode = el.mode.value;
    var list = PASSAGES[mode] || PASSAGES.prose;
    // Never serve the same passage twice running — repeating one turns the
    // test into a memory exercise.
    var choice = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && choice === passage) {
      choice = list[(list.indexOf(choice) + 1) % list.length];
    }
    return choice;
  }

  function render() {
    el.passage.textContent = '';
    for (var i = 0; i < passage.length; i++) {
      var span = document.createElement('span');
      var ch = passage.charAt(i);
      // A newline needs something visible, or the line just ends and the
      // reader cannot tell whether Enter is expected.
      span.textContent = ch === '\n' ? '↵\n' : ch;

      if (i < typed.length) {
        span.className = typed.charAt(i) === ch ? 'ty-ok' : 'ty-bad';
      } else if (i === typed.length) {
        span.className = 'ty-at';
      } else {
        span.className = 'ty-todo';
      }
      el.passage.appendChild(span);
    }
  }

  function elapsedSeconds() {
    return started ? (Date.now() - started) / 1000 : 0;
  }

  function stats() {
    var secs = elapsedSeconds();
    var minutes = secs / 60;
    // Five characters to a word is the standard convention, so these numbers
    // are comparable with every other typing test.
    var wpm = minutes > 0 ? Math.round((typed.length / 5) / minutes) : 0;
    var accuracy = keystrokes > 0 ? Math.round((correctStrokes / keystrokes) * 100) : 100;
    return { wpm: wpm, accuracy: accuracy, seconds: secs };
  }

  function paintStats() {
    var s = stats();
    el.wpm.textContent = s.wpm;
    el.acc.textContent = s.accuracy + '%';
    el.time.textContent = s.seconds.toFixed(1) + 's';
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (ticker) { clearInterval(ticker); ticker = null; }
    var s = stats();
    paintStats();

    var key = 'typing.best.' + el.mode.value;
    var previous = parseInt(store(key) || '0', 10);
    var isBest = s.wpm > previous;
    if (isBest) store(key, String(s.wpm));
    showBest();

    el.resultText.textContent = isBest
      ? 'New best for this mode: ' + s.wpm + ' WPM at ' + s.accuracy + '% accuracy.'
      : s.wpm + ' WPM at ' + s.accuracy + '% accuracy. Your best here is ' +
        Math.max(previous, s.wpm) + ' WPM.';
    el.result.hidden = false;
    el.status.textContent = 'Finished — press Restart for a new passage';
    el.status.className = 'lab-status is-ok';
    el.input.blur();
  }

  function showBest() {
    var best = store('typing.best.' + el.mode.value);
    el.best.textContent = best ? best + ' WPM' : '—';
  }

  function reset() {
    passage = pick();
    typed = '';
    started = 0;
    keystrokes = 0;
    correctStrokes = 0;
    finished = false;
    if (ticker) { clearInterval(ticker); ticker = null; }
    el.input.value = '';
    el.result.hidden = true;
    el.wpm.textContent = '0';
    el.acc.textContent = '100%';
    el.time.textContent = '0.0s';
    el.status.textContent = 'Click the passage and start typing';
    el.status.className = 'lab-status';
    showBest();
    render();
  }

  function onInput() {
    if (finished) return;
    var value = el.input.value;

    if (!started && value.length) {
      started = Date.now();
      el.status.textContent = 'Typing…';
      el.status.className = 'lab-status is-busy';
      ticker = setInterval(paintStats, 100);
    }

    // Count a keystroke only when the text grew: backspacing is a correction,
    // and charging for it twice would punish fixing a mistake harder than
    // leaving it.
    if (value.length > typed.length) {
      for (var i = typed.length; i < value.length; i++) {
        keystrokes++;
        if (value.charAt(i) === passage.charAt(i)) correctStrokes++;
      }
    }

    typed = value;
    render();
    paintStats();

    if (typed.length >= passage.length) finish();
  }

  function initGate() {
    var agreed;
    try { agreed = localStorage.getItem(PREFIX + 'consent'); } catch (err) { agreed = null; }
    if (agreed === 'yes') { root.setAttribute('data-consent', 'granted'); return; }
    el.agree.addEventListener('click', function () {
      try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (err) {}
      root.setAttribute('data-consent', 'granted');
      el.input.focus();
    });
    el.leave.addEventListener('click', function () { window.location.href = '/'; });
  }

  el.passage.addEventListener('click', function () { el.input.focus(); });
  el.input.addEventListener('input', onInput);

  // Tab would leave the field, and in a code passage it is a character the
  // user genuinely needs.
  el.input.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab' || finished) return;
    event.preventDefault();
    var start = el.input.selectionStart;
    el.input.value = el.input.value.slice(0, start) + '    ' + el.input.value.slice(el.input.selectionEnd);
    el.input.selectionStart = el.input.selectionEnd = start + 4;
    onInput();
  });

  el.mode.addEventListener('change', reset);
  el.restart.addEventListener('click', function () { reset(); el.input.focus(); });

  initGate();
  reset();
})();

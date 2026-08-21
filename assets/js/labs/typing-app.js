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
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs, and quiz the waxy sphinx of black quartz while you are at it.',
      'Programs must be written for people to read, and only incidentally for machines to execute. That single sentence has done more for the readability of software than any style guide ever written.',
      'Simplicity is prerequisite for reliability. A complex system that works is invariably found to have evolved from a simple system that worked, and a complex system designed from scratch never works.',
      'Premature optimisation is the root of all evil, but that does not mean you should write slow code on purpose. Measure first, then decide whether the slow part is the part anybody notices.',
      'Any fool can write code that a computer can understand. Good programmers write code that humans can understand, because the computer will forgive you and the next reader will not.',
      'There are only two hard things in computer science: cache invalidation, naming things, and off-by-one errors. The joke works precisely because everyone who has shipped software has been bitten by all three.',
      'The best error message is the one that never shows up, and the second best is the one that tells you exactly which file, which line, and what you should have written instead.',
      'Debugging is twice as hard as writing the code in the first place. Therefore, if you write the code as cleverly as possible, you are by definition not smart enough to debug it.',
      'Walking on water and developing software from a specification are easy, so long as both are frozen. Requirements move, and the craft is in building something that can move with them.',
      'A good API is easy to use and hard to misuse. If the only way to call your function correctly requires reading the source, the signature is the thing that needs changing.',
      'Weeks of coding can save you hours of planning. The line is funny because it is backwards, and it is quoted because everybody has lived through the version that was not.',
      'It is not enough for code to work. It has to be written in a way that the person who reads it in two years, who may well be you, can change it without fear.',
      'Deleted code is debugged code. Every line you do not write is a line that cannot break, cannot be misunderstood, and does not need a test, a comment, or a migration.',
      'The strength of the internet is that it has no centre, no owner and no permission step. Anyone can add a machine to it and, from that moment, speak to every other machine on it.',
      'Security is not a product but a process. A system is only as trustworthy as the weakest assumption anybody made while building it, and assumptions are rarely written down.'
    ],
    python: [
      'def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
      'counts = {}\nfor word in text.split():\n    counts[word] = counts.get(word, 0) + 1',
      'with open(path) as handle:\n    rows = [line.strip().split(",") for line in handle]',
      'def flatten(items):\n    for item in items:\n        if isinstance(item, list):\n            yield from flatten(item)\n        else:\n            yield item',
      'class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\n\n    def __repr__(self):\n        return f"Point({self.x}, {self.y})"',
      'try:\n    value = int(raw)\nexcept ValueError:\n    logger.warning("could not parse %r", raw)\n    value = 0',
      'squares = {n: n ** 2 for n in range(1, 11) if n % 2}\nprint(sorted(squares.items(), key=lambda kv: -kv[1]))',
      'async def fetch_all(urls):\n    async with aiohttp.ClientSession() as session:\n        return await asyncio.gather(*(fetch(session, u) for u in urls))',
      '@functools.lru_cache(maxsize=None)\ndef collatz(n):\n    if n == 1:\n        return 0\n    return 1 + collatz(n // 2 if n % 2 == 0 else 3 * n + 1)',
      'with sqlite3.connect(":memory:") as db:\n    db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")\n    db.executemany("INSERT INTO t (name) VALUES (?)", [(n,) for n in names])'
    ],
    javascript: [
      'const total = items.reduce((sum, item) => sum + item.price, 0);',
      'async function load(url) {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(`HTTP ${res.status}`);\n  return res.json();\n}',
      'const byId = Object.fromEntries(users.map((u) => [u.id, u]));',
      'const debounce = (fn, ms) => {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n};',
      'document.querySelectorAll(\'[data-copy]\').forEach((btn) => {\n  btn.addEventListener(\'click\', () => navigator.clipboard.writeText(btn.dataset.copy));\n});',
      'const groups = items.reduce((acc, item) => {\n  (acc[item.type] ||= []).push(item);\n  return acc;\n}, {});',
      'export function* chunks(array, size) {\n  for (let i = 0; i < array.length; i += size) {\n    yield array.slice(i, i + size);\n  }\n}',
      'const observer = new IntersectionObserver((entries) => {\n  entries.forEach((e) => e.target.classList.toggle(\'seen\', e.isIntersecting));\n}, { threshold: 0.25 });',
      'class Queue {\n  #items = [];\n  push(x) { this.#items.push(x); return this; }\n  pop() { return this.#items.shift(); }\n  get size() { return this.#items.length; }\n}',
      'const sorted = [...rows].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.age - b.age);'
    ],
    c: [
      'int main(void) {\n    printf("%d\\n", 42);\n    return 0;\n}',
      'for (int i = 0; i < n; i++) {\n    total += values[i];\n}',
      'struct Node { int value; struct Node *next; };',
      'void swap(int *a, int *b) {\n    int tmp = *a;\n    *a = *b;\n    *b = tmp;\n}',
      'char *dup(const char *src) {\n    size_t n = strlen(src) + 1;\n    char *out = malloc(n);\n    if (!out) return NULL;\n    memcpy(out, src, n);\n    return out;\n}',
      'int binary_search(const int *a, int n, int key) {\n    int lo = 0, hi = n - 1;\n    while (lo <= hi) {\n        int mid = lo + (hi - lo) / 2;\n        if (a[mid] == key) return mid;\n        if (a[mid] < key) lo = mid + 1; else hi = mid - 1;\n    }\n    return -1;\n}',
      'FILE *fp = fopen(path, "rb");\nif (!fp) { perror(path); return 1; }\nwhile ((n = fread(buf, 1, sizeof buf, fp)) > 0) {\n    process(buf, n);\n}\nfclose(fp);',
      'static unsigned long hash(const char *s) {\n    unsigned long h = 5381;\n    int c;\n    while ((c = *s++)) h = ((h << 5) + h) + c;\n    return h;\n}',
      'if (fork() == 0) {\n    execlp("ls", "ls", "-la", NULL);\n    _exit(127);\n}\nwait(&status);',
      '#define ARRAY_LEN(a) (sizeof(a) / sizeof((a)[0]))\n\nqsort(values, ARRAY_LEN(values), sizeof values[0], cmp_int);'
    ],
    sql: [
      'SELECT dept, COUNT(*) FROM employee GROUP BY dept ORDER BY 2 DESC;',
      'UPDATE orders SET status = \'shipped\' WHERE id = 42 AND status = \'pending\';',
      'SELECT a.name, b.city FROM emp a JOIN dept b ON b.name = a.dept;',
      'INSERT INTO audit (actor, action, at)\nVALUES (\'krunal\', \'deploy\', CURRENT_TIMESTAMP);',
      'SELECT customer_id, SUM(total) AS lifetime\nFROM orders\nWHERE placed_at >= DATE \'2026-01-01\'\nGROUP BY customer_id\nHAVING SUM(total) > 10000\nORDER BY lifetime DESC;',
      'CREATE INDEX idx_orders_customer_placed ON orders (customer_id, placed_at DESC);',
      'WITH ranked AS (\n  SELECT *, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) AS rn\n  FROM employee\n)\nSELECT name, dept, salary FROM ranked WHERE rn <= 3;',
      'DELETE FROM sessions WHERE last_seen < NOW() - INTERVAL \'30 days\';',
      'SELECT p.title, COUNT(c.id) AS comments\nFROM post p\nLEFT JOIN comment c ON c.post_id = p.id\nGROUP BY p.title\nORDER BY comments DESC, p.title;',
      'BEGIN;\nUPDATE account SET balance = balance - 500 WHERE id = 1;\nUPDATE account SET balance = balance + 500 WHERE id = 2;\nCOMMIT;'
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

  /* The gate only paints over the lab: .lab-gate is position:absolute with an
     opaque background, so without this every control beneath it stays in the
     tab order and in the accessibility tree while the visitor is still being
     asked to agree. `inert` removes a subtree from focus, hit-testing and
     assistive tech in one property. Browsers without support ignore it, so
     this cannot regress anything. */
  function setGateInert(on) {
    var g = document.getElementById('lab-gate');
    if (!g || !root) return;
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== g) kids[i].inert = on;
    }
  }

  function initGate() {
    var agreed;
    try { agreed = localStorage.getItem(PREFIX + 'consent'); } catch (err) { agreed = null; }
    if (agreed === 'yes') { root.setAttribute('data-consent', 'granted'); return; }
    setGateInert(true);
    el.agree.addEventListener('click', function () {
      try { localStorage.setItem(PREFIX + 'consent', 'yes'); } catch (err) {}
      root.setAttribute('data-consent', 'granted');
      setGateInert(false);
      el.input.focus();
    });
    el.leave.addEventListener('click', function () { window.location.href = '/'; });
  }

  el.passage.addEventListener('click', function () { el.input.focus(); });
  el.input.addEventListener('input', onInput);

  // Tab would leave the field, and in a code passage it is a character the
  // user genuinely needs.
  //
  // Holding it until the passage is finished still leaves a keyboard user
  // stuck mid-run with no way out but the mouse, so Escape arms one
  // pass-through and the next Tab moves focus normally (WCAG 2.1.2). Any other
  // key disarms it, so typing a passage full of tabs is unaffected.
  var tabWillEscape = false;
  el.input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { tabWillEscape = true; return; }
    if (event.key !== 'Tab') {
      // Same reason as cpu.js: a bare Shift keydown precedes Shift+Tab, so
      // disarming on it would break the backward escape.
      if (event.key !== 'Shift' && event.key !== 'Control' &&
          event.key !== 'Alt' && event.key !== 'Meta') {
        tabWillEscape = false;
      }
      return;
    }
    if (finished) return;
    if (tabWillEscape) { tabWillEscape = false; return; }
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

/* ==========================================================================
   typing-certificate.js — a timed typing test that ends in a printable sheet.
   --------------------------------------------------------------------------
   Two things this site already had and had never joined up: the typing test at
   /labs/typing, and the printable-document pattern the resume, biodata and
   invoice makers share. This is the join.

   The measurement follows /labs/typing exactly, so a score here means the same
   thing it means there:
     - one "word" is five characters, including spaces
     - gross WPM is total characters typed / 5, over elapsed minutes
     - accuracy is correct keystrokes / total keystrokes, so a typo you went
       back and fixed still costs you, exactly as a real typo does
   Net WPM is the one addition, and it is the standard one: gross minus one
   whole word for every character still wrong when the clock stopped.

   THE DESIGN PROBLEM, and the reason most of the care below is where it is:
   this certificate is self-generated and proves nothing. Nobody watched the
   test, nothing checked who was typing, and the numbers came out of the
   visitor's own browser. A document shaped like a credential that is not one
   is a small forgery kit, so three things hold the line:

     1. The printed sheet carries the disclaimer on its face, in the body of
        the document, not as a footnote under the fold.
     2. The reference it mints begins PRACTICE- and is deliberately nothing
        like the KS-INT-/KS-MEN- IDs that /verify answers for. Those are real
        records the site owner issues; typing a PRACTICE- id into /verify will
        correctly find nothing, and the sheet says so.
     3. Pasting is blocked, and a run that arrives in large blocks anyway is
        marked and refused a certificate. A number that was not typed must not
        end up printed on something that looks official.

   The sheet is deliberately plain — no seal, no ribbon, no gold rule. Dressing
   up a document that certifies nothing is the dishonest part.

   Everything is local. There is no fetch here and no server behind the page:
   the passage, the keystrokes, the name and the history never leave the tab.
   History lives in localStorage under the same lab. prefix the playgrounds
   use, so the Labs storage panel counts and clears it with everything else.
   ========================================================================== */

(function () {
  'use strict';

  var root = document.getElementById('typingcert');
  if (!root) return;

  var PREFIX = 'lab.';
  var HISTORY_KEY = 'typing-certificate.history';
  /* One number, not a cap and a separate row limit: the chart and the table
     have to show the same attempts or the chart's text alternative ("the same
     figures are in the table above") is a lie to the one reader who cannot
     see it. Twenty-five is a few months of occasional practice — enough for a
     progress line to have a shape, short of being a diary of someone's
     keyboard use sitting in their browser. */
  var HISTORY_MAX = 25;
  var PASTE_CHUNK = 4;       // chars arriving at once that no human typed
  var PAUSE_CAP = 2000;      // ms; see the per-key timing note below

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    gate: $('lab-gate'), agree: $('lab-agree'), leave: $('lab-leave'),
    duration: $('tc-duration'), material: $('tc-material'),
    restart: $('tc-restart'), status: $('tc-status'),
    passage: $('tc-passage'), input: $('tc-input'),
    wpm: $('tc-wpm'), acc: $('tc-acc'), left: $('tc-left'), best: $('tc-best'),
    resultEmpty: $('tc-result-empty'), scoreGrid: $('tc-scoregrid'),
    keysWrap: $('tc-keys'), keysBody: $('tc-keys-body'), keysNote: $('tc-keys-note'),
    name: $('tc-name'), print: $('tc-print'), idLine: $('tc-idline'),
    sheet: $('tc-sheet'), sheetWrap: $('tc-sheet-wrap'),
    chart: $('tc-chart'), histBody: $('tc-hist-body'),
    histEmpty: $('tc-hist-empty'), histWrap: $('tc-hist-wrap'),
    clear: $('tc-clear'), announce: $('tc-announce')
  };

  /* ======================================================================
     Passage material
     ----------------------------------------------------------------------
     A timed test needs more text than a fixed passage does — five minutes at
     an unlikely 180 WPM is 4,500 characters — so paragraphs are shuffled and
     joined until the stream is comfortably longer than anyone can reach. If
     somebody does exhaust the pool the shuffle runs again and appends, which
     is better than the test ending early and reporting a minute that was not
     typed.

     The prose is about typing on purpose: reading it is not wasted time, and
     nothing in it needs working out before it can be typed. A test is about
     the fingers, not about comprehension.
     ====================================================================== */
  var PROSE = [
    'A typing test measures one narrow thing well: how quickly your fingers can turn a sentence you are reading into the same sentence on a screen. It says nothing at all about whether the sentence was worth writing.',
    'Speed comes from rhythm rather than from effort. People who type quickly are not moving their hands faster than everyone else; they are pausing less, hesitating less, and looking down at the keyboard almost never.',
    'Accuracy is worth more than raw speed, and the arithmetic proves it. A mistake costs the keystroke that made it, the keystroke that deletes it, and the second you spent noticing. Slowing a little to halve your errors is usually a gain.',
    'The home row is a starting position, not a destination. Your fingers should leave it constantly and come back without being told, the way a driver returns to a lane rather than steering along a painted line.',
    'Look at the screen, not at your hands. This one change separates people who type at forty words a minute from people who type at eighty, and it is uncomfortable for about a week before it stops being uncomfortable at all.',
    'Practising the keys you are already good at feels wonderful and teaches nothing. The gain is in the letters your ring and little fingers own, in the number row, and in the punctuation you reach for once a paragraph and fumble every time.',
    'You do not need to type quickly in order to write well. Most writing time goes on deciding what to say, and a fast typist with nothing to say produces the wrong words sooner. Speed matters when you already know the sentence.',
    'Timed tests reward a particular kind of composure. The clock is visible, the passage is unfamiliar, and every mistake sits on the screen in red. Keeping an even pace under that is a small, real skill, and it transfers.',
    'A keyboard you like is worth more than any drill. Key travel, spacing and the noise a key makes all change how confidently you press it, and confidence is most of what speed is made of. Try somebody else s before you buy your own.',
    'Warm up before you measure anything. The first thirty seconds of a session are the slowest and the least accurate, so a test taken cold measures how cold you were rather than how quickly you type.',
    'Numbers from different tests are only loosely comparable. Some count a word as five characters, some count real words, some ignore mistakes and some subtract them twice. Compare a score with your own earlier scores first.',
    'Posture does more work than any exercise. Feet on the floor, wrists off the desk, elbows at roughly a right angle, screen at eye level. None of it feels like practice, and all of it shows up after an hour rather than after five minutes.',
    'Watch where you pause rather than where you are wrong. A pause is the sound of a finger deciding, and the keys you decide about are the ones worth drilling. Errors are loud and obvious; hesitation is quiet and costs more.',
    'Copy typing and composing are different jobs. This is copy typing, which is why the number it gives you is higher than the rate at which you actually produce work. Nobody writes an email at their test speed.',
    'Improvement is slow and then sudden. Weeks of practice appear to do nothing, and then one session the punctuation stops being an event and the number jumps by ten. That plateau is the ordinary shape of learning a motor skill.',
    'Stop when your hands ache. Typing injuries build quietly over years and are far easier to avoid than to recover from. No test result is worth a tendon, and anyone who has spent a month unable to type will say the same thing at length.'
  ];

  /* Short, self-contained and in the languages the playgrounds run, so the
     symbols you practise here are the ones you type next door. Line breaks
     are part of the material: in code they are keystrokes too. */
  var CODE = [
    'def median(values):\n    ordered = sorted(values)\n    mid = len(ordered) // 2\n    if len(ordered) % 2:\n        return ordered[mid]\n    return (ordered[mid - 1] + ordered[mid]) / 2',
    'const byYear = {};\nfor (const row of rows) {\n  (byYear[row.year] ||= []).push(row.title);\n}',
    'SELECT dept, ROUND(AVG(salary), 2) AS avg_pay\nFROM employee\nWHERE joined_at >= DATE \'2024-01-01\'\nGROUP BY dept\nHAVING COUNT(*) > 4\nORDER BY avg_pay DESC;',
    'int main(void) {\n    char buf[256];\n    while (fgets(buf, sizeof buf, stdin)) {\n        buf[strcspn(buf, "\\n")] = \'\\0\';\n        printf("[%s]\\n", buf);\n    }\n    return 0;\n}',
    'try:\n    payload = json.loads(raw)\nexcept json.JSONDecodeError as err:\n    logger.warning("bad payload at %d: %s", err.pos, err.msg)\n    payload = {}',
    'export function chunk(items, size) {\n  const out = [];\n  for (let i = 0; i < items.length; i += size) {\n    out.push(items.slice(i, i + size));\n  }\n  return out;\n}',
    'struct Node {\n    int key;\n    struct Node *left, *right;\n};\n\nstatic int height(const struct Node *n) {\n    return n ? 1 + MAX(height(n->left), height(n->right)) : 0;\n}',
    'counts = collections.Counter(w.lower() for w in re.findall(r"[a-z\']+", text, re.I))\nfor word, n in counts.most_common(10):\n    print(f"{n:>5}  {word}")',
    'CREATE UNIQUE INDEX idx_session_token ON session (token);\nDELETE FROM session WHERE last_seen < NOW() - INTERVAL \'30 days\';',
    'const observer = new ResizeObserver((entries) => {\n  entries.forEach((e) => draw(e.contentRect.width, e.contentRect.height));\n});\nobserver.observe(canvas);',
    'if (fork() == 0) {\n    execlp("grep", "grep", "-rn", pattern, ".", NULL);\n    _exit(127);\n}\nwaitpid(child, &status, 0);',
    'class Stack:\n    def __init__(self):\n        self._items = []\n\n    def push(self, item):\n        self._items.append(item)\n        return self\n\n    def pop(self):\n        return self._items.pop()',
    'window.addEventListener(\'keydown\', (ev) => {\n  if (ev.key === \'/\' && !ev.metaKey) {\n    ev.preventDefault();\n    search.focus();\n  }\n});',
    'WITH ranked AS (\n  SELECT *, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY score DESC) AS rn\n  FROM result\n)\nSELECT name, dept, score FROM ranked WHERE rn <= 3;'
  ];

  var MATERIAL_LABEL = { prose: 'English prose', code: 'code and symbols' };
  var DURATION_LABEL = { 60: 'one minute', 180: 'three minutes', 300: 'five minutes' };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];

  /* ======================================================================
     State
     ====================================================================== */
  var passage = '';
  var spans = [];
  var typed = '';
  var started = 0;
  var durationMs = 0;
  var keystrokes = 0;
  var correctStrokes = 0;
  var ticker = null;
  var finished = false;
  var suspect = false;        // input did not arrive one key at a time
  var lastKeyAt = 0;
  var keyStats = {};          // expected char -> { n, ms, errs }
  var samples = [];           // characters typed in each whole second
  var sampledChars = 0;
  var lastResult = null;      // the finished run the sheet is drawn from

  /* ======================================================================
     Storage — every read and write can throw (private mode, disabled
     storage, a full quota), and none of them is worth an exception.
     ====================================================================== */
  function readHistory() {
    var raw;
    try { raw = localStorage.getItem(PREFIX + HISTORY_KEY); } catch (err) { return []; }
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(raw); } catch (err) { return []; }
    if (!parsed || Object.prototype.toString.call(parsed) !== '[object Array]') return [];
    // Anything on disk is untrusted input: a hand-edited entry must not be
    // able to put text of its choosing into the table or the chart.
    var out = [];
    for (var i = 0; i < parsed.length; i++) {
      var e = parsed[i];
      if (!e || typeof e !== 'object') continue;
      out.push({
        at: typeof e.at === 'number' && isFinite(e.at) ? e.at : 0,
        secs: DURATION_LABEL[e.secs] ? e.secs : 0,
        material: MATERIAL_LABEL[e.material] ? e.material : 'prose',
        net: clampNumber(e.net), gross: clampNumber(e.gross),
        acc: clampNumber(e.acc), cons: clampNumber(e.cons)
      });
    }
    return out;
  }

  function clampNumber(n) {
    var v = typeof n === 'number' && isFinite(n) ? Math.round(n) : 0;
    if (v < 0) return 0;
    return v > 9999 ? 9999 : v;
  }

  function writeHistory(list) {
    try {
      localStorage.setItem(PREFIX + HISTORY_KEY, JSON.stringify(list));
    } catch (err) { /* nothing stored is a smaller failure than a thrown one */ }
  }

  /* ======================================================================
     Building the passage
     ====================================================================== */
  function shuffled(list) {
    var copy = list.slice();
    // Fisher-Yates. Math.random is right here: this picks reading material,
    // and nothing about the choice needs to be unpredictable to an attacker.
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  }

  function buildStream(secs, material) {
    var pool = material === 'code' ? CODE : PROSE;
    var join = material === 'code' ? '\n\n' : ' ';
    // 180 WPM is well past a strong typist and nowhere near reachable on code,
    // so a stream this long cannot run out inside the clock.
    var needed = Math.ceil((secs / 60) * 180 * 5);
    var text = '';
    var guard = 0;
    while (text.length < needed && guard < 40) {
      var order = shuffled(pool);
      for (var i = 0; i < order.length; i++) {
        text += (text ? join : '') + order[i];
      }
      guard++;
    }
    return text;
  }

  /* ======================================================================
     Rendering the passage
     ----------------------------------------------------------------------
     /labs/typing rebuilds every span on every keystroke, which is fine for a
     200-character passage and hopeless for a 4,500-character one — that is
     4,500 element creations per key. Here the spans are built once and only
     the two or three whose state actually changed are repainted.
     ====================================================================== */
  function buildSpans() {
    while (el.passage.firstChild) el.passage.removeChild(el.passage.firstChild);
    spans = [];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < passage.length; i++) {
      var ch = passage.charAt(i);
      var span = document.createElement('span');
      // A newline needs something visible or the line simply ends and the
      // reader cannot tell that Enter is expected.
      span.textContent = ch === '\n' ? '\u21b5\n' : ch;
      span.className = i === 0 ? 'ty-at' : 'ty-todo';
      frag.appendChild(span);
      spans.push(span);
    }
    el.passage.appendChild(frag);
    el.passage.scrollTop = 0;
  }

  function classFor(i) {
    if (i < typed.length) return typed.charAt(i) === passage.charAt(i) ? 'ty-ok' : 'ty-bad';
    if (i === typed.length) return 'ty-at';
    return 'ty-todo';
  }

  function repaint(from, to) {
    var lo = Math.max(0, from);
    var hi = Math.min(spans.length - 1, to);
    for (var i = lo; i <= hi; i++) {
      var cls = classFor(i);
      if (spans[i].className !== cls) spans[i].className = cls;
    }
  }

  /* Keep the caret in the middle third of the pane. Anchoring it to the top
     makes the passage jump on every wrapped line; anchoring it to the bottom
     leaves nothing to read ahead into, and reading ahead is how anyone types
     at speed. */
  function keepCaretVisible() {
    var i = Math.min(typed.length, spans.length - 1);
    var span = spans[i];
    if (!span) return;
    var top = span.offsetTop;
    var view = el.passage.clientHeight;
    var scroll = el.passage.scrollTop;
    if (top < scroll + view * 0.2 || top > scroll + view * 0.7) {
      el.passage.scrollTop = Math.max(0, Math.round(top - view * 0.4));
    }
  }

  /* ======================================================================
     Live numbers
     ====================================================================== */
  function elapsedMs() { return started ? Date.now() - started : 0; }

  function liveStats() {
    var minutes = elapsedMs() / 60000;
    var gross = minutes > 0 ? Math.round((typed.length / 5) / minutes) : 0;
    var acc = keystrokes > 0 ? Math.round((correctStrokes / keystrokes) * 100) : 100;
    return { gross: gross, acc: acc };
  }

  function mmss(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function paintLive() {
    var s = liveStats();
    el.wpm.textContent = s.gross;
    el.acc.textContent = s.acc + '%';
    el.left.textContent = mmss(durationMs - elapsedMs());
  }

  /* One interval drives both the clock and the per-second speed samples.
     100 ms so the countdown does not visibly stutter; the samples are taken
     on whole-second boundaries inside it, and a backgrounded tab that skips
     ticks has the gap filled with zeroes rather than silently shortening the
     run. */
  function tick() {
    var ms = elapsedMs();
    while (samples.length < Math.floor(ms / 1000)) {
      samples.push(typed.length - sampledChars);
      sampledChars = typed.length;
    }
    paintLive();
    if (ms >= durationMs) finish('time');
  }

  /* ======================================================================
     Finishing
     ====================================================================== */
  function stdev(list) {
    if (list.length < 2) return 0;
    var sum = 0, i;
    for (i = 0; i < list.length; i++) sum += list[i];
    var mean = sum / list.length;
    var acc = 0;
    for (i = 0; i < list.length; i++) acc += (list[i] - mean) * (list[i] - mean);
    return Math.sqrt(acc / list.length);
  }

  function mean(list) {
    if (!list.length) return 0;
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i];
    return sum / list.length;
  }

  function finish(reason) {
    if (finished) return;
    finished = true;
    if (ticker) { clearInterval(ticker); ticker = null; }

    var ms = Math.min(elapsedMs(), durationMs);
    if (ms < 1000) ms = 1000;                 // never divide a minute by nothing
    var minutes = ms / 60000;

    var correctFinal = 0;
    for (var i = 0; i < typed.length; i++) {
      if (typed.charAt(i) === passage.charAt(i)) correctFinal++;
    }
    var uncorrected = typed.length - correctFinal;

    var gross = (typed.length / 5) / minutes;
    // The standard net formula: one whole word off for every character still
    // wrong at the end. Floored at zero, because "minus four words a minute"
    // is arithmetic rather than information.
    var net = Math.max(0, gross - (uncorrected / minutes));
    var acc = keystrokes > 0 ? (correctStrokes / keystrokes) * 100 : 100;

    // Consistency: how little the one-second speed samples varied. 100% would
    // be a metronome, which nobody is. The first sample is dropped — it always
    // contains the fraction of a second before the first keystroke landed.
    var body = samples.slice(1);
    var m = mean(body);
    var cons = m > 0 ? Math.max(0, Math.min(100, 100 - (stdev(body) / m) * 100)) : 0;

    lastResult = {
      at: Date.now(),
      secs: parseInt(el.duration.value, 10),
      material: el.material.value,
      gross: Math.round(gross),
      net: Math.round(net),
      acc: Math.round(acc),
      cons: Math.round(cons),
      chars: typed.length,
      uncorrected: uncorrected,
      keystrokes: keystrokes,
      suspect: suspect,
      id: suspect ? '' : makeReference(new Date())
    };

    paintLive();
    el.wpm.textContent = lastResult.gross;

    // Only a run that was actually typed counts as the tool having worked.
    if (!suspect && window.KSLab) window.KSLab.used('run');

    if (!suspect) {
      var history = readHistory();
      history.push({
        at: lastResult.at, secs: lastResult.secs, material: lastResult.material,
        net: lastResult.net, gross: lastResult.gross,
        acc: lastResult.acc, cons: lastResult.cons
      });
      if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
      writeHistory(history);
    }

    renderResult();
    updateIdLine();
    renderSheet();
    renderHistory();
    showBest();

    el.status.textContent = reason === 'time'
      ? 'Time. Your result is below.'
      : 'Finished. Your result is below.';
    el.status.className = 'lab-status is-ok';
    el.input.readOnly = true;

    // The announcement carries the number itself; the live region has been in
    // the accessibility tree since first paint, so writing into it is a change
    // a screen reader will speak. Without this the whole result is silent.
    el.announce.textContent = suspect
      ? 'Run finished but was not typed key by key, so no certificate was generated.'
      : lastResult.net + ' net words per minute at ' + lastResult.acc +
        ' per cent accuracy. The result and the certificate are below.';

    // Focus goes to the restart button rather than nowhere: blurring would
    // drop it to <body> and the next Tab would restart at the top of the page.
    el.restart.focus();
  }

  /* The reference printed on the sheet.

     Deliberately unlike the KS-INT-####-###### and KS-MEN-####-###### ids
     /verify answers for. Those name records the site owner issued and keeps;
     this names nothing at all. Minting something that looked like one of them
     would be the single most dishonest thing this page could do, so the word
     PRACTICE leads and the shape differs.

     Ambiguous glyphs are out of the alphabet because this gets read off paper
     and typed back in. The modulo bias is real and irrelevant: this is a label
     for telling two of your own printouts apart, not a secret. */
  function makeReference(date) {
    var alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var raw = new Array(6);
    var i;
    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint8Array(6);
      window.crypto.getRandomValues(bytes);
      for (i = 0; i < 6; i++) raw[i] = bytes[i];
    } else {
      for (i = 0; i < 6; i++) raw[i] = Math.floor(Math.random() * 256);
    }
    var tail = '';
    for (i = 0; i < 6; i++) tail += alphabet.charAt(raw[i] % alphabet.length);
    return 'PRACTICE-' + isoDay(date) + '-' + tail;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function isoDay(d) {
    return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  function longDate(d) {
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function shortDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ======================================================================
     DOM helpers — everything user-supplied goes in as textContent, never as
     markup. The name field is the only free text on the page and it is
     printed on a document; there is no version of this where it becomes HTML.
     ====================================================================== */
  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function keyLabel(ch) {
    if (ch === ' ') return 'space';
    if (ch === '\n') return 'enter';
    if (ch === '\t') return 'tab';
    return ch;
  }

  /* ======================================================================
     The result breakdown
     ====================================================================== */
  function tile(value, label, note) {
    var box = make('div', 'tc-tile');
    box.appendChild(make('span', 'tc-tile-v', value));
    box.appendChild(make('span', 'tc-tile-l', label));
    if (note) box.appendChild(make('span', 'tc-tile-n', note));
    return box;
  }

  function renderResult() {
    var r = lastResult;
    if (!r) return;
    el.resultEmpty.hidden = true;
    el.scoreGrid.hidden = false;
    clear(el.scoreGrid);

    el.scoreGrid.appendChild(tile(String(r.net), 'net WPM', 'speed minus your mistakes'));
    el.scoreGrid.appendChild(tile(String(r.gross), 'gross WPM', 'everything you typed'));
    el.scoreGrid.appendChild(tile(r.acc + '%', 'accuracy', r.keystrokes + ' keystrokes'));
    el.scoreGrid.appendChild(tile(r.cons + '%', 'consistency', 'evenness, second by second'));
    el.scoreGrid.appendChild(tile(String(r.chars), 'characters', 'in ' + DURATION_LABEL[r.secs]));
    el.scoreGrid.appendChild(tile(String(r.uncorrected), 'left wrong', 'errors still there at the end'));

    renderKeys();
  }

  /* The keys that cost the most time.

     For every keystroke after the first, the gap since the previous one is
     filed under the character that was DUE — not the one that arrived — so a
     key you hesitate over and then get wrong still shows up as expensive.
     Anything over two seconds is capped: one interruption should not be able
     to crown a random comma the slowest key on the board, and a table that
     could be rewritten by a phone call is not measuring typing. */
  function renderKeys() {
    var rows = [];
    var ch;
    for (ch in keyStats) {
      if (!Object.prototype.hasOwnProperty.call(keyStats, ch)) continue;
      var s = keyStats[ch];
      if (s.n < 3) continue;   // two samples is an anecdote
      rows.push({ ch: ch, avg: s.ms / s.n, n: s.n, errs: s.errs });
    }
    rows.sort(function (a, b) { return b.avg - a.avg; });
    rows = rows.slice(0, 8);

    clear(el.keysBody);
    if (!rows.length) {
      el.keysWrap.hidden = true;
      return;
    }
    el.keysWrap.hidden = false;
    for (var i = 0; i < rows.length; i++) {
      var tr = document.createElement('tr');
      var key = make('td', 'tc-keycell');
      key.appendChild(make('code', null, keyLabel(rows[i].ch)));
      tr.appendChild(key);
      tr.appendChild(make('td', null, Math.round(rows[i].avg) + ' ms'));
      tr.appendChild(make('td', null, String(rows[i].n)));
      tr.appendChild(make('td', null, rows[i].errs ? String(rows[i].errs) : '—'));
      el.keysBody.appendChild(tr);
    }
    el.keysNote.textContent = 'Average gap before each key, over ' +
      rows.length + ' of the keys you pressed at least three times. Pauses ' +
      'longer than two seconds are capped, so one interruption cannot decide the table.';
  }

  /* ======================================================================
     The certificate sheet
     ====================================================================== */
  /* Each figure is a <div> wrapping its own dt and dd — valid inside a <dl>
     since HTML5, and the reason is layout: bare dt and dd are separate grid
     items, so the pairing would be implied by position alone and one wrapped
     label would shunt every value after it into the wrong cell. */
  function figure(dl, label, value) {
    var box = make('div', 'tc-s-fig');
    box.appendChild(make('dt', null, label));
    box.appendChild(make('dd', null, value));
    dl.appendChild(box);
  }

  /* The disclaimer block. It is built by the same function in every state of
     the page — including before any test has been taken — because it is the
     part of the document that must never be missing, and a code path that
     draws the sheet without it should not exist. */
  function honestyBlock() {
    var box = make('div', 'tc-s-honest');
    box.appendChild(make('p', 'tc-s-honest-h',
      'Self-administered practice result. This is not an issued credential.'));
    box.appendChild(make('p', null,
      'This test was taken unsupervised, in the holder\u2019s own web browser, at ' +
      'krunalkumar.dpdns.org/labs/typing-certificate. Nobody invigilated it, no ' +
      'identity was checked, and the figures above were produced by that browser ' +
      'from that one attempt.'));
    box.appendChild(make('p', null,
      'No record of it exists anywhere. The reference on this sheet was generated ' +
      'on the holder\u2019s device, is registered with nobody, and cannot be verified ' +
      'by anyone.'));
    box.appendChild(make('p', null,
      'Certificates genuinely issued by Krunalkumar Shah carry an ID beginning ' +
      '\u201cKS-\u201d and can be checked at krunalkumar.dpdns.org/verify. This sheet ' +
      'is not one of them and should not be presented as one.'));
    return box;
  }

  function sheetFrame() {
    clear(el.sheet);
    var frame = make('div', 'tc-s-frame');
    el.sheet.appendChild(frame);
    frame.appendChild(make('p', 'tc-s-kicker', 'Practice record \u00b7 self-administered'));
    frame.appendChild(make('p', 'tc-s-title', 'Typing test result'));
    return frame;
  }

  function renderSheet() {
    var frame = sheetFrame();
    var r = lastResult;

    if (!r || r.suspect) {
      var empty = make('div', 'tc-s-empty');
      empty.appendChild(make('p', 'tc-s-empty-h',
        r ? 'No result to certify.' : 'Nothing to certify yet.'));
      empty.appendChild(make('p', null, r
        ? 'That run did not arrive one key at a time, so it was not measured as ' +
          'a typing test and nothing is printed here. Start a new test and type it.'
        : 'Finish a timed test above and this sheet fills in with the result. ' +
          'Until then it is deliberately blank rather than showing a specimen ' +
          'score, because a specimen score on something shaped like a ' +
          'certificate is exactly the thing this page is trying not to be.'));
      frame.appendChild(empty);
      frame.appendChild(honestyBlock());
      frame.appendChild(make('p', 'tc-s-foot',
        'krunalkumar.dpdns.org/labs/typing-certificate'));
      fitSheet();
      return;
    }

    var when = new Date(r.at);
    var name = (el.name.value || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');

    frame.appendChild(make('p', 'tc-s-lede', 'This sheet records a typing test taken by'));
    if (name) {
      frame.appendChild(make('p', 'tc-s-name', name));
    } else {
      // A ruled line rather than a placeholder: printed blank, it can be
      // filled in by hand, and it never prints somebody's guess at a name.
      var blank = make('p', 'tc-s-name tc-s-name-blank');
      blank.appendChild(make('span', 'sr-only', 'Name left blank'));
      blank.appendChild(make('span', 'tc-s-rule'));
      frame.appendChild(blank);
    }
    frame.appendChild(make('p', 'tc-s-lede', 'who typed'));
    frame.appendChild(make('p', 'tc-s-score', r.net + ' net words per minute'));
    frame.appendChild(make('p', 'tc-s-sub',
      'at ' + r.acc + '% accuracy, over a test of ' + DURATION_LABEL[r.secs] +
      ' on ' + MATERIAL_LABEL[r.material] + ', on ' + longDate(when) + '.'));

    var dl = make('dl', 'tc-s-figs');
    figure(dl, 'Net speed', r.net + ' WPM');
    figure(dl, 'Gross speed', r.gross + ' WPM');
    figure(dl, 'Accuracy', r.acc + '%');
    figure(dl, 'Consistency', r.cons + '%');
    figure(dl, 'Characters typed', String(r.chars));
    figure(dl, 'Errors left uncorrected', String(r.uncorrected));
    figure(dl, 'Test length', DURATION_LABEL[r.secs]);
    figure(dl, 'Material', MATERIAL_LABEL[r.material]);
    frame.appendChild(dl);

    var ref = make('p', 'tc-s-ref');
    ref.appendChild(make('span', 'tc-s-ref-k', 'Reference'));
    ref.appendChild(make('span', 'tc-s-ref-v', r.id));
    frame.appendChild(ref);

    frame.appendChild(honestyBlock());
    frame.appendChild(make('p', 'tc-s-foot',
      'Generated ' + longDate(when) + ' at krunalkumar.dpdns.org/labs/typing-certificate'));

    fitSheet();
  }

  /* The sheet is laid out at 794px — 210mm at CSS's 96dpi, the same
     pixels-per-millimetre the browser prints A4 at — and scaled down to fit
     its pane, so the preview is the print shrunk rather than a reflowed
     approximation of it. The wrapper is given the scaled height explicitly
     or the page reserves the full unscaled 1123px and leaves a dead gap. */
  function fitSheet() {
    var w = el.sheetWrap.clientWidth;
    if (!w) return;
    var scale = Math.min(1, w / 794);
    el.sheet.style.transform = 'scale(' + scale + ')';
    el.sheetWrap.style.height = Math.ceil(el.sheet.offsetHeight * scale) + 'px';
  }

  /* Debounced with a timer, NOT with requestAnimationFrame.

     The other document makers coalesce this resize into a rAF, and on this page
     that strands: a hidden tab does not run rAF callbacks at all, so the first
     resize in a background tab sets the "already queued" flag, the callback
     that would clear it never arrives, and every later resize returns early —
     the sheet is stuck at whatever scale it had for the life of the page. It is
     reachable by ordinary means: open the page in a second tab, resize the
     window, come back, and the certificate is 794px wide inside a 300px column
     with overflow:hidden clipping most of it.

     setTimeout is throttled in a background tab but it does fire, so the flag
     always clears. 120 ms is below the point where a drag feels laggy and well
     above the rate a resize fires at. */
  var fitPending = 0;
  window.addEventListener('resize', function () {
    if (fitPending) return;
    fitPending = window.setTimeout(function () { fitPending = 0; fitSheet(); }, 120);
  });

  /* ======================================================================
     History: the table, the chart and the personal best
     ====================================================================== */
  function bestFor(secs, material) {
    var list = readHistory();
    var best = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].secs === secs && list[i].material === material && list[i].net > best) {
        best = list[i].net;
      }
    }
    return best;
  }

  function showBest() {
    var best = bestFor(parseInt(el.duration.value, 10), el.material.value);
    el.best.textContent = best ? best + ' WPM' : '\u2014';
  }

  function renderHistory() {
    var list = readHistory();
    clear(el.histBody);

    if (!list.length) {
      el.histEmpty.hidden = false;
      el.histWrap.hidden = true;
      el.clear.disabled = true;
      clear(el.chart);
      el.chart.appendChild(make('p', 'tc-chart-note',
        'No attempts recorded on this device yet.'));
      return;
    }

    el.histEmpty.hidden = true;
    el.histWrap.hidden = false;
    el.clear.disabled = false;

    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      var tr = document.createElement('tr');
      var th = make('th', null, e.at ? shortDate(new Date(e.at)) : '\u2014');
      th.setAttribute('scope', 'row');
      tr.appendChild(th);
      tr.appendChild(make('td', null, DURATION_LABEL[e.secs] || '\u2014'));
      tr.appendChild(make('td', null, MATERIAL_LABEL[e.material] || '\u2014'));
      tr.appendChild(make('td', null, e.net + ' WPM'));
      tr.appendChild(make('td', null, e.gross + ' WPM'));
      tr.appendChild(make('td', null, e.acc + '%'));
      el.histBody.appendChild(tr);
    }

    renderChart(list);
  }

  /* An SVG line of net WPM per attempt. Inline SVG rather than a canvas: it
     scales to any width without redrawing, prints crisply, and can carry a
     text alternative. The table above is the real data — the chart only shows
     the shape — so it is one image with one label rather than dozens of
     unreadable nodes. */
  function renderChart(list) {
    clear(el.chart);
    if (list.length < 2) {
      el.chart.appendChild(make('p', 'tc-chart-note',
        'One attempt recorded. The progress line appears from the second.'));
      return;
    }

    var W = 640, H = 220, padL = 44, padR = 12, padT = 14, padB = 30;
    var top = 0, i;
    for (i = 0; i < list.length; i++) if (list[i].net > top) top = list[i].net;
    var ceiling = Math.max(20, Math.ceil((top + 5) / 10) * 10);

    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'tc-chart-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('preserveAspectRatio', 'none');
    var first = list[0].net, last = list[list.length - 1].net;
    svg.setAttribute('aria-label',
      'Net words per minute across ' + list.length + ' attempts, from ' + first +
      ' to ' + last + ', highest ' + top + '. The same figures are in the table above.');

    function x(idx) {
      return padL + (idx / (list.length - 1)) * (W - padL - padR);
    }
    function y(val) {
      return padT + (1 - val / ceiling) * (H - padT - padB);
    }

    function line(x1, y1, x2, y2, cls) {
      var n = document.createElementNS(ns, 'line');
      n.setAttribute('x1', x1); n.setAttribute('y1', y1);
      n.setAttribute('x2', x2); n.setAttribute('y2', y2);
      n.setAttribute('class', cls);
      return n;
    }
    function text(tx, ty, str, cls, anchor) {
      var n = document.createElementNS(ns, 'text');
      n.setAttribute('x', tx); n.setAttribute('y', ty);
      n.setAttribute('class', cls);
      if (anchor) n.setAttribute('text-anchor', anchor);
      n.textContent = str;
      return n;
    }

    for (i = 0; i <= 4; i++) {
      var v = Math.round((ceiling / 4) * i);
      var gy = y(v);
      svg.appendChild(line(padL, gy, W - padR, gy, 'tc-grid'));
      svg.appendChild(text(padL - 8, gy + 4, String(v), 'tc-axis', 'end'));
    }

    var d = '';
    for (i = 0; i < list.length; i++) {
      d += (i ? ' L' : 'M') + x(i).toFixed(1) + ' ' + y(list[i].net).toFixed(1);
    }
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'tc-line');
    svg.appendChild(path);

    for (i = 0; i < list.length; i++) {
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', x(i).toFixed(1));
      dot.setAttribute('cy', y(list[i].net).toFixed(1));
      dot.setAttribute('r', '3');
      dot.setAttribute('class', 'tc-dot');
      svg.appendChild(dot);
    }

    svg.appendChild(text(padL, H - 8, 'first attempt', 'tc-axis', 'start'));
    svg.appendChild(text(W - padR, H - 8, 'latest', 'tc-axis', 'end'));
    svg.appendChild(text(padL - 8, padT - 2, 'WPM', 'tc-axis', 'end'));

    el.chart.appendChild(svg);
  }

  /* ======================================================================
     Running a test
     ====================================================================== */
  function reset() {
    var secs = parseInt(el.duration.value, 10);
    durationMs = secs * 1000;
    passage = buildStream(secs, el.material.value);
    typed = '';
    started = 0;
    keystrokes = 0;
    correctStrokes = 0;
    finished = false;
    suspect = false;
    lastKeyAt = 0;
    keyStats = {};
    samples = [];
    sampledChars = 0;
    if (ticker) { clearInterval(ticker); ticker = null; }
    el.input.readOnly = false;
    el.input.value = '';
    el.wpm.textContent = '0';
    el.acc.textContent = '100%';
    el.left.textContent = mmss(durationMs);
    el.status.textContent = 'Click the passage and start typing';
    el.status.className = 'lab-status';
    buildSpans();
    showBest();
  }

  function onInput() {
    if (finished) return;
    var value = el.input.value;
    var previous = typed.length;

    if (!started && value.length) {
      started = Date.now();
      lastKeyAt = started;
      el.status.textContent = 'Typing\u2026';
      el.status.className = 'lab-status is-busy';
      ticker = setInterval(tick, 100);
    }

    if (value.length > previous) {
      var added = value.length - previous;
      // Nothing human puts five characters into a field in one event. The run
      // is not thrown away — the numbers still show — but it is barred from
      // the certificate and from the history, because printing a pasted score
      // on a document is the failure mode this whole page exists to avoid.
      if (added > PASTE_CHUNK) {
        suspect = true;
        el.status.textContent = 'That was not typed key by key \u2014 no certificate for this run';
        el.status.className = 'lab-status is-err';
      }
      var now = Date.now();
      for (var i = previous; i < value.length; i++) {
        var expected = passage.charAt(i);
        var got = value.charAt(i);
        keystrokes++;
        if (got === expected) correctStrokes++;
        // Timing is only meaningful for single keys arriving one at a time.
        if (added === 1 && lastKeyAt) {
          var gap = Math.min(now - lastKeyAt, PAUSE_CAP);
          var stat = keyStats[expected];
          if (!stat) { stat = { n: 0, ms: 0, errs: 0 }; keyStats[expected] = stat; }
          stat.n++;
          stat.ms += gap;
          if (got !== expected) stat.errs++;
        }
      }
      lastKeyAt = now;
    }

    typed = value;
    repaint(Math.min(previous, typed.length) - 1, Math.max(previous, typed.length) + 1);
    keepCaretVisible();
    paintLive();

    // The stream is built to outlast the clock, but if somebody does reach the
    // end of it the test is over rather than stuck.
    if (typed.length >= passage.length) finish('end');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  el.passage.addEventListener('click', function () {
    if (!finished) el.input.focus();
  });

  el.input.addEventListener('input', onInput);

  /* Pasting is blocked rather than merely detected. A pasted passage produces
     a number that means nothing, and this page then offers to print that
     number on something shaped like a certificate — so the easy version of
     cheating is closed rather than caught afterwards. The drop handler is the
     same hole by another route. */
  function refusePaste(event) {
    event.preventDefault();
    el.status.textContent = 'Pasting is off here \u2014 a pasted score would mean nothing';
    el.status.className = 'lab-status is-err';
    window.setTimeout(function () {
      if (finished) return;
      if (started) {
        el.status.textContent = 'Typing\u2026';
        el.status.className = 'lab-status is-busy';
      } else {
        el.status.textContent = 'Click the passage and start typing';
        el.status.className = 'lab-status';
      }
    }, 2200);
  }
  el.input.addEventListener('paste', refusePaste);
  el.input.addEventListener('drop', refusePaste);

  /* Tab is a character the code passages genuinely need, so it is captured —
     but holding it forever traps a keyboard user in the field with no way out
     but the mouse. Escape arms one pass-through and the next Tab moves focus
     normally (WCAG 2.1.2); any other key disarms it, so a passage full of
     tabs is unaffected. Same bargain as /labs/typing. */
  var tabWillEscape = false;
  el.input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { tabWillEscape = true; return; }
    if (event.key !== 'Tab') {
      // A bare Shift keydown precedes Shift+Tab, so disarming on modifiers
      // would break the backward escape.
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
    el.input.value = el.input.value.slice(0, start) + '    ' +
                     el.input.value.slice(el.input.selectionEnd);
    el.input.selectionStart = el.input.selectionEnd = start + 4;
    onInput();
  });

  /* The result panel and the certificate are deliberately left standing.
     Starting another run should not silently destroy the sheet you were about
     to print — the numbers on screen are still the last finished run's, and
     they are replaced only when a new run finishes. Changing the length or the
     material does clear them, because those numbers then describe a test that
     is no longer the one on screen. */
  function restart() {
    reset();
    renderSheet();
    el.input.focus();
  }

  el.restart.addEventListener('click', restart);

  /* Changing either setting mid-run would silently invalidate the numbers on
     screen, so both restart, and both ask first while a run is in progress.

     The last accepted values are remembered because a <select> has already
     changed by the time `change` fires: answering "cancel" has to put the
     control back, or the toolbar would claim five minutes of prose while the
     test on screen went on being one minute of code. */
  var committed = { secs: el.duration.value, material: el.material.value };

  function settingChanged() {
    if (started && !finished &&
        !window.confirm('Start a new test? The run in progress will be discarded.')) {
      el.duration.value = committed.secs;
      el.material.value = committed.material;
      return;
    }
    committed.secs = el.duration.value;
    committed.material = el.material.value;
    lastResult = null;
    el.resultEmpty.hidden = false;
    el.scoreGrid.hidden = true;
    el.keysWrap.hidden = true;
    updateIdLine();
    restart();
  }
  el.duration.addEventListener('change', settingChanged);
  el.material.addEventListener('change', settingChanged);

  el.name.addEventListener('input', function () {
    renderSheet();
  });

  function updateIdLine() {
    if (lastResult && lastResult.id) {
      el.idLine.textContent = 'Reference on this sheet: ' + lastResult.id;
    } else {
      el.idLine.textContent = 'No reference yet \u2014 finish a test and one is generated here.';
    }
  }

  el.print.addEventListener('click', function () {
    if (!lastResult || lastResult.suspect) {
      el.idLine.textContent = 'Nothing to print yet \u2014 finish a timed test first.';
      el.name.focus();
      return;
    }
    window.print();
    /* This is the export, and it is the last thing this page can know: a
       browser never tells a document whether the dialog ended in a PDF, in
       paper or in Cancel. Gated on a finished, genuinely typed run so that
       pressing the button to see what it does is not counted as one. */
    if (window.KSLab) window.KSLab.used('export');
  });

  el.clear.addEventListener('click', function () {
    if (!window.confirm('Delete every attempt stored in this browser? This cannot be undone.')) return;
    try { localStorage.removeItem(PREFIX + HISTORY_KEY); } catch (err) {}
    renderHistory();
    showBest();
    el.announce.textContent = 'History cleared. Nothing from this tool is stored on this device now.';
  });

  /* ------------------------------------------------------------------
     Print rules that cannot live in labs.css.

     labs.css is loaded by every lab page, so anything in it that is not
     scoped to this page changes how the other sixty print. Three rules
     genuinely cannot be scoped by a selector — @page, the root background,
     and main.css's body::before byline, which is right on an article and
     wrong on somebody's certificate — so they are injected here, on this
     page only, the same way the invoice and resume makers do it.
     ------------------------------------------------------------------ */
  var printStyle = document.createElement('style');
  printStyle.textContent =
    '@media print{' +
      '@page{size:A4;margin:0}' +
      'html{color-scheme:light !important}' +
      'html,body{background:#fff !important}' +
      'body::before{display:none !important;content:none !important}' +
    '}';
  document.head.appendChild(printStyle);

  /* The gate only paints over the lab: .lab-gate is position:absolute with an
     opaque background, so without this every control beneath it stays in the
     tab order and in the accessibility tree while the visitor is still being
     asked to agree. `inert` removes a subtree from focus, hit-testing and
     assistive tech in one property, and browsers without it simply ignore
     this, so nothing can regress. */
  function setGateInert(on) {
    if (!el.gate) return;
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== el.gate) kids[i].inert = on;
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

  initGate();
  reset();
  updateIdLine();
  renderSheet();
  renderHistory();
})();

/* ==========================================================================
   regex-golf.js — twelve pairs of word lists, shortest pattern wins.
   --------------------------------------------------------------------------
   Two decisions worth the words.

   1. THE PATTERN FIELD IS A REAL, VISIBLE <input>, not the off-screen catcher
      subnet-sprint and the typing trainer use. Those two only ever append a
      character or delete the last one, so painting the text themselves costs
      nothing. A regular expression is EDITED: you go back and put a backslash
      in front of a dot in the middle of something you typed a minute ago.
      Rebuilding a caret, a selection and the keyboard's own undo on top of a
      hidden field would be a worse version of what the browser already has,
      so the browser keeps it. rawInput stays true, because the shell must not
      be reading the arrow keys while somebody is moving that caret with them.

   2. A PATTERN THAT TAKES TOO LONG IS REFUSED, AND IT CAN ONLY BE REFUSED IN
      ARREARS. JavaScript cannot interrupt a regular expression once the
      engine is inside one — no timeout, no abort, and it runs on the same
      thread as the page. So the guard is two-sided: a cheap scan for the
      shape that causes the blow-up (an unbounded quantifier wrapped in
      another one, as in (a+)+ ), and a stopwatch around the tests that
      blacklists the pattern afterwards when it ran long. The second half is
      not a fix and is not presented as one — by the time it fires, the work
      has already happened. That is exactly the position a server is in
      during a ReDoS: the only choice left is whether to start it again.
   ========================================================================== */

(function () {
  'use strict';

  /* Every level is a pair of lists and the shortest pattern the author could
     find for them. "par" is a target, not a rule — several of these have
     answers that are much shorter than the technique the level is named
     after, which is the whole point of golf. */
  var LEVELS = [
    {
      name: 'Plain text',
      brief: 'A regular expression is a search. Anything that is not a special character simply means itself.',
      match: ['foo', 'food', 'football', 'tomfoolery'],
      reject: ['bar', 'barn', 'crowbar', 'foe'],
      par: 3,
      hint: 'No special characters are needed at all. Three letters they all share.'
    },
    {
      name: 'Any digit',
      brief: 'A backslash turns a letter into a class. <code>\\d</code> is any digit, <code>\\w</code> is a word character, <code>\\s</code> is whitespace.',
      match: ['r2d2', 'x86', '24seven', '3com'],
      reject: ['unix', 'hal', 'emacs', 'kernel'],
      par: 2,
      hint: '<code>[0-9]</code> works and costs five characters. There is a two-character way to say the same thing.'
    },
    {
      name: 'One of these',
      brief: 'Square brackets hold a list of characters, any one of which will do.',
      match: ['bat', 'bet', 'bit'],
      reject: ['bot', 'but', 'box', 'bun'],
      par: 5,
      hint: 'You do not have to describe the whole word. Only the letter in the middle differs.'
    },
    {
      name: 'The start of the line',
      brief: 'A caret anchors the pattern to the beginning of the string. Without it a match anywhere counts.',
      match: ['cat', 'catalogue', 'category', 'cattle'],
      reject: ['bobcat', 'concatenate', 'scatter', 'muscat'],
      par: 3,
      hint: '<code>^cat</code> solves it in four. You do not need the third letter.'
    },
    {
      name: 'The end of the line',
      brief: 'A dollar sign anchors to the end. These are filenames, and only some of them are Python.',
      match: ['main.py', 'setup.py', 'tests.py', '__init__.py'],
      reject: ['main.pyc', 'python', 'py.txt', 'salary'],
      par: 3,
      hint: 'Two literal characters and the anchor.'
    },
    {
      name: 'A dot is not a dot',
      brief: 'An unescaped <code>.</code> matches any character, which here would match all eight strings. Escape it to mean a full stop.',
      match: ['3.14', '1.5', '0.9', '10.0'],
      reject: ['314', '1x5', '0-9', '100'],
      par: 2,
      hint: 'A backslash and a dot. That is the entire answer.'
    },
    {
      name: 'Nothing but digits',
      brief: 'Anchor both ends and repeat. <code>+</code> is one or more, <code>*</code> is zero or more.',
      match: ['2048', '42', '7', '90210'],
      reject: ['3com', 'x86', '24seven', 'v2'],
      par: 5,
      hint: 'Both anchors, a digit class and a quantifier — in five characters.'
    },
    {
      name: 'An address, roughly',
      brief: 'Match the four that could be email addresses. This is the level that teaches you never to validate an address this way.',
      match: ['git@github.com', 'root@localhost', 'a@b.co', 'hi+there@mail.org'],
      reject: ['not-an-email', '@nope.com', 'user@', 'two@@at.com'],
      par: 5,
      hint: 'Something on each side of the at sign is enough to separate these eight. It would not be enough for real addresses.'
    },
    {
      name: 'Say that again',
      brief: 'A group in parentheses can be referred to later by number: <code>\\1</code> is whatever the first group captured.',
      match: ['coffee', 'bookkeeper', 'balloon', 'pizza'],
      reject: ['garden', 'bandit', 'flavour', 'planet'],
      par: 5,
      hint: 'Capture any character, then ask for it a second time.'
    },
    {
      name: 'No vowels',
      brief: 'Four words with no vowel in them. A caret inside square brackets negates the class.',
      match: ['gym', 'crypt', 'lynx', 'rhythm'],
      reject: ['yoga', 'cycle', 'house', 'bright'],
      par: 6,
      hint: 'The honest answer is <code>^[^aeiou]+$</code>, eleven characters. There is a six-character answer that only works because of which eight words these happen to be.'
    },
    {
      name: 'Private addresses',
      brief: 'Match the addresses from the private ranges. The near misses on the right are the interesting part.',
      match: ['10.0.0.1', '10.8.4.2', '192.168.0.1', '192.168.31.7'],
      reject: ['100.0.0.1', '9.9.9.9', '192.169.0.1', '172.16.0.1'],
      par: 8,
      hint: 'Two cases joined by a pipe. One of them needs an anchor and an escaped dot; the other needs almost nothing.'
    },
    {
      name: 'A date, checked a bit',
      brief: 'ISO dates with a month that exists. <code>{4}</code> repeats the thing before it exactly four times.',
      match: ['2024-01-31', '1999-12-01', '2026-08-28', '0001-11-09'],
      reject: ['2024-13-01', '24-01-31', '2024-1-31', '2024-00-09'],
      par: 16,
      hint: 'A proper month check is <code>(0[1-9]|1[0-2])</code>. You only have to separate these eight: the four real months here start with 0 or 1, and end with 1, 2 or 8.'
    }
  ];

  /* Long enough for any honest answer here and short enough that a pasted
     novel cannot become the thing the engine has to chew through. */
  var MAX_LEN = 120;

  /* Twelve short strings against a sane pattern take well under a
     millisecond, so anything past this is not slow — it is backtracking. */
  var BUDGET_MS = 40;

  /* Keystrokes come faster than this, and every one of them would otherwise
     start a fresh set of tests. The delay is short enough to read as live. */
  var SETTLE_MS = 90;

  function clock() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Does an unbounded quantifier start at index i? {2,} counts; {2,5}
     does not, because a bounded repeat cannot grow without limit. */
  function unboundedAt(src, i) {
    var ch = src.charAt(i);
    if (ch === '*' || ch === '+') return true;
    if (ch !== '{') return false;
    return /^\{\d*,\}/.test(src.slice(i));
  }

  /* The classic ReDoS shape: a group that repeats without limit, whose body
     also repeats without limit — (a+)+, (\d*)*, (\w+\s?)+ . Each character of
     input can then be assigned to the inner or the outer repeat, so the
     number of ways to fail grows as 2^n.

     Deliberately narrow. Overlapping alternations like (a|ab)* are just as
     dangerous and are NOT caught here, because widening the rule to cover
     them would also refuse (ab|cd)+, which is fine and which somebody will
     legitimately want to type. Those are left to the stopwatch. */
  function nestedQuantifier(src) {
    var stack = [];
    var inClass = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (ch === '\\') { i++; continue; }
      if (inClass) { if (ch === ']') inClass = false; continue; }
      if (ch === '[') { inClass = true; continue; }
      if (ch === '(') { stack.push(false); continue; }
      if (ch === ')') {
        var bodyRepeats = stack.length ? stack.pop() : false;
        var groupRepeats = unboundedAt(src, i + 1);
        if (bodyRepeats && groupRepeats) return true;
        /* A repeated group is itself a repeat inside whatever encloses it. */
        if (groupRepeats && stack.length) stack[stack.length - 1] = true;
        continue;
      }
      if (unboundedAt(src, i) && stack.length) stack[stack.length - 1] = true;
    }
    return false;
  }

  GameShell.define({
    id: 'game-regex-golf',
    slug: 'regex-golf',
    /* Declared here and not only in the manifest, because the manifest is
       build-time data: the generator never hands it to the runtime, so a
       tapAction set only there is a comment. The page copy for this game
       promises a tap does nothing; without this line it did something. */
    tapAction: false,
    title: 'Regex golf',
    bestKey: 'regex-golf',
    bestOrder: 'low',
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,
    formatBest: function (n) { return n + ' chars'; },

    setup: function (g) {
      var host = g.board;
      var at = 0;
      var used = 0;
      var solved = false;
      /* One note per level, however much the answer is fiddled with
         afterwards — a chime on every keystroke of a working pattern is
         noise, and people do keep editing after they have passed. */
      var chimed = false;
      var input = null;
      var nextBtn = null;
      var hintBtn = null;
      var timer = null;

      /* Patterns already found to be dangerous, so a second look at the same
         text costs nothing. Keyed by the pattern itself, which is why every
         read goes through hasOwnProperty — somebody will type "constructor"
         sooner or later and a bare lookup would find Object's. */
      var refused = {};

      function known(map, key) {
        return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
      }

      var parTotal = 0;
      for (var p = 0; p < LEVELS.length; p++) parTotal += LEVELS[p].par;

      function q(sel) { return host.querySelector(sel); }

      function build() {
        host.className = 'game-board board-golf';
        host.innerHTML =
          '<div class="rg-head">' +
          '<p class="rg-level" id="rg-level"></p>' +
          '<h3 class="rg-name" id="rg-name"></h3>' +
          '<p class="rg-brief" id="rg-brief"></p>' +
          '</div>' +
          '<div class="rg-lists">' +
          '<div class="rg-col"><h4 class="rg-col-head is-match">Must match</h4>' +
          '<ul class="rg-list" id="rg-match"></ul></div>' +
          '<div class="rg-col"><h4 class="rg-col-head is-reject">Must not match</h4>' +
          '<ul class="rg-list" id="rg-reject"></ul></div>' +
          '</div>' +
          '<div class="rg-field">' +
          '<label class="rg-sr" for="rg-input">Regular expression</label>' +
          '<span class="rg-slash" aria-hidden="true">/</span>' +
          '<input class="rg-input" id="rg-input" type="text" autocomplete="off" ' +
          'autocapitalize="off" autocorrect="off" spellcheck="false">' +
          '<span class="rg-slash" aria-hidden="true">/</span>' +
          '</div>' +
          '<p class="rg-status" id="rg-status" role="status" aria-live="polite"></p>' +
          '<div class="rg-warn" id="rg-warn" hidden></div>' +
          '<p class="rg-hint" id="rg-hint" hidden></p>' +
          '<div class="rg-foot">' +
          '<p class="rg-par" id="rg-par"></p>' +
          '<button class="btn btn-primary rg-next" type="button" id="rg-next" disabled>Next level</button>' +
          '</div>';

        input = q('#rg-input');
        nextBtn = q('#rg-next');

        input.addEventListener('input', function () {
          /* Withdraw the pass on the keystroke, not 90 ms later. Otherwise a
             character that breaks the answer leaves Enter and the Next button
             live for the length of the debounce. */
          solved = false;
          nextBtn.disabled = true;
          schedule();
        });
        input.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          /* Enter on an unsolved level would otherwise do nothing at all,
             so it re-tests immediately rather than waiting out the debounce. */
          if (solved) advance();
          else evaluate();
        });
        nextBtn.addEventListener('click', advance);

        hintBtn = g.el.querySelector('#game-hint');
        if (hintBtn) {
          hintBtn.addEventListener('click', function () {
            var el = q('#rg-hint');
            var show = el.hidden;
            el.hidden = !show;
            hintBtn.setAttribute('aria-pressed', String(show));
          });
        }
      }

      function fill(ul, words) {
        var html = '';
        for (var i = 0; i < words.length; i++) {
          html += '<li class="rg-item"><span class="rg-mark" aria-hidden="true">&middot;</span>' +
                  '<code>' + esc(words[i]) + '</code><span class="rg-sr"></span></li>';
        }
        ul.innerHTML = html;
      }

      /* "want" is what a correct pattern should do with this column. */
      function paint(ul, results, want) {
        var items = ul.querySelectorAll('.rg-item');
        for (var i = 0; i < items.length; i++) {
          var mark = items[i].querySelector('.rg-mark');
          var note = items[i].querySelector('.rg-sr');
          if (!results || results[i] == null) {
            items[i].className = 'rg-item';
            mark.textContent = '·';
            note.textContent = '';
            continue;
          }
          var ok = results[i] === want;
          items[i].className = 'rg-item ' + (ok ? 'is-ok' : 'is-bad');
          mark.textContent = ok ? '✓' : '✗';
          note.textContent = results[i] ? ' matches' : ' does not match';
        }
      }

      function clearMarks() {
        paint(q('#rg-match'), null, true);
        paint(q('#rg-reject'), null, false);
      }

      function warn(kind, ms) {
        var box = q('#rg-warn');
        if (!kind) { box.hidden = true; box.innerHTML = ''; return; }
        var lead;
        if (kind === 'long') {
          lead = 'Refused: longer than ' + MAX_LEN + ' characters. Nothing here needs that, ' +
                 'and the point of the game is the other direction.';
        } else if (kind === 'shape') {
          lead = 'Refused before it ran: one unbounded repeat inside another, as in ' +
                 '<code>(a+)+</code>. Every character of the input can be handed to either ' +
                 'repeat, so the number of ways to fail doubles with each one.';
        } else {
          lead = 'Refused after ' + ms + '&nbsp;ms. Eight strings this short should take a fraction ' +
                 'of a millisecond between them, so what happened instead was backtracking.';
        }
        box.innerHTML =
          '<p class="rg-warn-lead">' + lead + '</p>' +
          '<p class="rg-warn-body">This is a ReDoS — a regular expression denial of service. ' +
          'The denial is that JavaScript cannot cancel a running match: it holds the one thread, ' +
          'so the page stops repainting and a server stops answering. Refusing it afterwards, as ' +
          'happened here, does not undo the work. You can watch the backtracking itself in the ' +
          '<a href="/labs/regex-engine">regex engine lab</a>.</p>';
        box.hidden = false;
      }

      function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(evaluate, SETTLE_MS);
      }

      function status(text, cls) {
        var el = q('#rg-status');
        el.textContent = text;
        el.className = 'rg-status' + (cls ? ' ' + cls : '');
      }

      /* Runs the tests one string at a time so the deadline is checked
         between them. It cannot stop a single test that has gone away — see
         the header — but it does stop the remaining eleven. */
      function testAll(re, words, out, deadline) {
        for (var i = 0; i < words.length; i++) {
          if (clock() > deadline) return false;
          out.push(re.test(words[i]));
        }
        return true;
      }

      function evaluate() {
        if (timer) { clearTimeout(timer); timer = null; }
        var lvl = LEVELS[at];
        if (!lvl) return;
        var src = input.value;
        solved = false;
        nextBtn.disabled = true;
        warn(null);

        if (!src) {
          clearMarks();
          status('Type a pattern between the slashes.');
          return;
        }

        if (src.length > MAX_LEN) { clearMarks(); status('Too long.', 'is-bad'); warn('long'); return; }

        var seen = known(refused, src);
        if (seen) { clearMarks(); status('Refused — see the note below.', 'is-bad'); warn(seen.why, seen.ms); return; }

        if (nestedQuantifier(src)) {
          refused[src] = { why: 'shape', ms: 0 };
          clearMarks();
          status('Refused — see the note below.', 'is-bad');
          warn('shape', 0);
          return;
        }

        var re;
        try {
          re = new RegExp(src);
        } catch (err) {
          /* Half-typed patterns throw constantly — an open bracket, a lone
             backslash — so this is a neutral state, not a wrong answer. */
          clearMarks();
          status('Not a pattern yet: ' + String((err && err.message) || err), 'is-wait');
          return;
        }

        var t0 = clock();
        var deadline = t0 + BUDGET_MS;
        var hits = [];
        var misses = [];
        var finished = testAll(re, lvl.match, hits, deadline) &&
                       testAll(re, lvl.reject, misses, deadline);
        var spent = clock() - t0;

        if (!finished || spent > BUDGET_MS) {
          refused[src] = { why: 'slow', ms: Math.round(spent) };
          clearMarks();
          status('Refused — see the note below.', 'is-bad');
          warn('slow', Math.round(spent));
          return;
        }

        paint(q('#rg-match'), hits, true);
        paint(q('#rg-reject'), misses, false);

        var wrong = 0;
        var i;
        for (i = 0; i < hits.length; i++) if (hits[i] !== true) wrong++;
        for (i = 0; i < misses.length; i++) if (misses[i] !== false) wrong++;
        var total = lvl.match.length + lvl.reject.length;

        if (wrong) {
          status((total - wrong) + ' of ' + total + ' right, at ' + src.length + ' characters.');
          return;
        }

        solved = true;
        nextBtn.disabled = false;
        var delta = src.length - lvl.par;
        status(delta < 0
          ? 'Solved in ' + src.length + ', which beats par by ' + (-delta) + '.'
          : delta === 0
            ? 'Solved in ' + src.length + '. That is par.'
            : 'Solved in ' + src.length + '. Par is ' + lvl.par + ' — worth another look.',
          'is-good');
        if (!chimed) { chimed = true; g.beep(720, 0.05, 'sine'); }
      }

      function loadLevel() {
        var lvl = LEVELS[at];
        q('#rg-level').textContent = 'Level ' + (at + 1) + ' of ' + LEVELS.length;
        q('#rg-name').textContent = lvl.name;
        q('#rg-brief').innerHTML = lvl.brief;
        q('#rg-hint').innerHTML = lvl.hint;
        q('#rg-hint').hidden = true;
        if (hintBtn) hintBtn.setAttribute('aria-pressed', 'false');
        q('#rg-par').textContent = 'Par for this level is ' + lvl.par + ' characters. ' +
          used + ' spent over the levels behind you.';
        fill(q('#rg-match'), lvl.match);
        fill(q('#rg-reject'), lvl.reject);
        input.value = '';
        nextBtn.disabled = true;
        solved = false;
        chimed = false;
        g.stat('level', (at + 1) + '/' + LEVELS.length);
        evaluate();
        focusField();
      }

      /* Deferred by a tick on purpose: the shell focuses the playfield right
         after reset() returns, and here the field IS the playfield. Focusing
         inside reset() would just be overwritten a moment later. */
      function focusField() {
        setTimeout(function () {
          if (!input) return;
          try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
        }, 0);
      }

      function advance() {
        if (!solved) return;
        used += input.value.length;
        g.setScore(used);
        at++;
        if (at >= LEVELS.length) { finish(); return; }
        loadLevel();
      }

      function finish() {
        var over = used - parTotal;
        g.over({
          won: true,
          score: used,
          title: used + ' characters',
          message: over < 0
            ? 'Par for the twelve is ' + parTotal + ', so you are ' + (-over) + ' under it. At least one of ' +
              'your answers is shorter than the one this game was built around.'
            : over === 0
            ? 'Par for the twelve is ' + parTotal + ', which you have matched exactly.'
            : 'Par for the twelve is ' + parTotal + ', so there are ' + over + ' characters still on the table. ' +
              'The short answers are usually the ones that ignore what the level is called.'
        });
      }

      build();

      return {
        reset: function () {
          at = 0;
          used = 0;
          solved = false;
          refused = {};
          g.setScore(0);
          loadLevel();
        }
      };
    }
  });
})();

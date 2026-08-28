/* ==========================================================================
   guess-the-output.js — eighteen snippets that do not do what they read like.
   --------------------------------------------------------------------------
   Two decisions worth writing down.

   THE CORRECT ANSWER IS STORED AS TEXT, NOT AS AN INDEX. The four options are
   reshuffled on every question so a repeat run is not a memory test of button
   positions, and an index would then have to be tracked through the shuffle.
   One mismatch there marks a right answer wrong and the player has no way to
   tell it was the quiz that was broken. Matching on the answer string cannot
   drift out of step with the list it came from.

   WHERE THE OUTPUT IS NOT GUARANTEED, THE OPTION SAYS SO — and that option is
   the right one. Signed overflow in C is undefined behaviour, not a promise of
   wrap-around, and sizeof on a decayed array parameter is a pointer whose
   width the target chooses. Offering a bare "-2147483648" or "8" as the truth
   would teach something false in a quiz whose whole product is the reason.
   ========================================================================== */

(function () {
  'use strict';

  var ITEMS = [
    /* ---------------- JavaScript ---------------- */
    {
      lang: 'JavaScript',
      code: 'console.log(0.1 + 0.2);',
      opts: ['0.3', '0.30000000000000004', '0.30000000000000004440892098500626', 'NaN'],
      a: '0.30000000000000004',
      why: 'Neither 0.1 nor 0.2 can be written exactly in binary, so each is stored as the nearest ' +
        'double and their sum lands a little above three tenths. JavaScript prints the shortest decimal ' +
        'that reads back as that exact double, which is <code>0.30000000000000004</code>. Every language ' +
        'with IEEE-754 doubles computes the same number &mdash; they differ only in how many digits they show.'
    },
    {
      lang: 'JavaScript',
      code: 'console.log(typeof null);',
      opts: ['object', 'null', 'undefined', 'TypeError'],
      a: 'object',
      why: 'A bug from the first implementation, kept for compatibility. Values carried a type tag in ' +
        'their low bits, the tag for objects was <code>000</code>, and the null pointer was all zeros &mdash; ' +
        'so null read as an object. Test for it with <code>value === null</code>; <code>typeof</code> ' +
        'cannot tell you.'
    },
    {
      lang: 'JavaScript',
      code: ['var a = [10, 9, 1, 100];', 'console.log(a.sort().join(","));'].join('\n'),
      opts: ['1,9,10,100', '1,10,100,9', '10,9,1,100', '100,10,9,1'],
      a: '1,10,100,9',
      why: 'With no comparator, <code>sort</code> converts every element to a string and orders by UTF-16 ' +
        'code unit, so "10" comes before "9" for the same reason "ab" comes before "b". Pass a comparator ' +
        'whenever the array holds numbers: <code>a.sort(function (x, y) { return x - y; })</code>. It also ' +
        'sorts in place, so <code>a</code> itself is now in that order.'
    },
    {
      lang: 'JavaScript',
      code: 'console.log("" == 0, "0" == 0, "" == "0");',
      opts: ['true true true', 'true true false', 'false true false', 'true false false'],
      a: 'true true false',
      why: 'The loose operator converts before comparing. Against the number 0 both strings become numbers ' +
        '&mdash; empty string to 0 and "0" to 0 &mdash; so both are true. Compared with each other, both ' +
        'sides are already strings, no conversion happens, and "" is not "0". Equality that is not ' +
        'transitive is the whole argument for <code>===</code>.'
    },
    {
      lang: 'JavaScript',
      code: ['console.log(x);', 'var x = 5;'].join('\n'),
      opts: ['undefined', '5', 'ReferenceError', 'null'],
      a: 'undefined',
      why: 'A <code>var</code> declaration is hoisted to the top of its function but the assignment stays ' +
        'where you wrote it, so <code>x</code> exists and holds <code>undefined</code> when the log runs. ' +
        '<code>let</code> and <code>const</code> are hoisted too, but reading one before its declaration ' +
        'throws a ReferenceError instead &mdash; which is the more useful behaviour.'
    },
    {
      lang: 'JavaScript',
      code: ['for (var i = 0; i < 3; i++) {',
             '  setTimeout(function () { console.log(i); }, 0);',
             '}'].join('\n'),
      opts: ['0 1 2', '3 3 3', '2 2 2', '0 0 0'],
      a: '3 3 3',
      why: '<code>var</code> creates one binding for the whole function, and all three callbacks close ' +
        'over that same variable rather than over its value at the time. They run after the loop has ' +
        'finished, when <code>i</code> is the 3 that failed the test. Change it to <code>let i</code> and ' +
        'each iteration gets its own binding, printing 0 1 2.'
    },
    {
      lang: 'JavaScript',
      code: 'console.log([1, 2, 3].map(parseInt).join(","));',
      opts: ['1,2,3', '1,NaN,NaN', 'NaN,NaN,NaN', '1,2,NaN'],
      a: '1,NaN,NaN',
      why: '<code>map</code> passes three arguments &mdash; value, index, array &mdash; and ' +
        '<code>parseInt</code> takes a second one, the radix. So the calls are <code>parseInt("1", 0)</code>, ' +
        'where radix 0 means "work it out" and gives 1; <code>parseInt("2", 1)</code>, an invalid radix; and ' +
        '<code>parseInt("3", 2)</code>, where 3 is not a binary digit. Wrap the callback so it takes one ' +
        'argument.'
    },

    /* ---------------- Python ---------------- */
    {
      lang: 'Python',
      code: ['def add(item, bag=[]):',
             '    bag.append(item)',
             '    return len(bag)',
             '',
             'print(add(1), add(2))'].join('\n'),
      opts: ['1 1', '1 2', '2 2', 'TypeError'],
      a: '1 2',
      why: 'The default value is built once, when the <code>def</code> statement runs, not on each call. ' +
        'Every call that leaves <code>bag</code> out therefore shares that one list, and it keeps growing ' +
        'for the life of the process. The fix is <code>bag=None</code> with the real list created inside ' +
        'the function &mdash; mutable defaults are almost always a bug.'
    },
    {
      lang: 'Python',
      code: ["a = int('256')",
             "b = int('256')",
             "c = int('257')",
             "d = int('257')",
             'print(a is b, c is d)'].join('\n'),
      opts: ['True True', 'True False', 'False False', 'False True'],
      a: 'True False',
      why: 'CPython keeps one cached object for every small integer from -5 to 256, so two separate 256s ' +
        'really are the same object and <code>is</code> says so; 257 is built fresh each time. This is an ' +
        'implementation detail and no part of the language, which is why <code>is</code> belongs to ' +
        'identity checks like <code>x is None</code> and <code>==</code> to values. The strings are parsed ' +
        'at run time on purpose: written as plain literals, the compiler would share equal constants ' +
        'within one code object and even 257 would report True.'
    },
    {
      lang: 'Python',
      code: ['a = [1, 2, 3]', 'b = a', 'b.append(4)', 'print(a)'].join('\n'),
      opts: ['[1, 2, 3]', '[1, 2, 3, 4]', '[4, 1, 2, 3]', 'TypeError'],
      a: '[1, 2, 3, 4]',
      why: 'Assignment binds a second name to the same object; it does not copy anything. Both names refer ' +
        'to one list, so appending through either is visible through both. <code>b = a[:]</code> or ' +
        '<code>list(a)</code> makes a shallow copy, and <code>copy.deepcopy</code> is for when the elements ' +
        'are themselves containers.'
    },
    {
      lang: 'Python',
      code: ['grid = [[0] * 3] * 2', 'grid[0][0] = 1', 'print(grid)'].join('\n'),
      opts: ['[[1, 0, 0], [0, 0, 0]]', '[[1, 0, 0], [1, 0, 0]]', '[[1, 0, 0]]', 'IndexError'],
      a: '[[1, 0, 0], [1, 0, 0]]',
      why: 'Multiplying a list repeats references, not contents, so the outer list holds the same row ' +
        'object twice and writing through one row shows up in the other. The inner <code>[0] * 3</code> is ' +
        'harmless because integers are immutable and never written through. Build rows with a ' +
        'comprehension &mdash; <code>[[0] * 3 for _ in range(2)]</code> &mdash; and each one is distinct.'
    },
    {
      lang: 'Python',
      code: ['fs = [lambda: i for i in range(3)]', 'print([f() for f in fs])'].join('\n'),
      opts: ['[0, 1, 2]', '[2, 2, 2]', '[3, 3, 3]', '[0, 0, 0]'],
      a: '[2, 2, 2]',
      why: 'Each lambda looks <code>i</code> up when it is called, not when it is created, and by then the ' +
        'comprehension has finished with <code>i</code> at 2. It is the same late binding as the ' +
        'JavaScript <code>var</code> loop, ending one lower because <code>range(3)</code> stops at 2 rather ' +
        'than failing a test at 3. Capture the value at creation with a default argument: ' +
        '<code>lambda i=i: i</code>.'
    },
    {
      lang: 'Python',
      code: 'print(-7 // 2, -7 % 2)',
      opts: ['-3 -1', '-4 1', '-3 1', '-4 -1'],
      a: '-4 1',
      why: 'Python floors division towards negative infinity rather than truncating towards zero, so ' +
        '-7 // 2 is -4. The remainder then follows to keep the identity <code>a == (a // b) * b + a % b</code> ' +
        'true, giving 1, which takes the sign of the divisor. C and Java truncate instead and print -3 and ' +
        '-1 for the same expression &mdash; worth knowing before porting arithmetic between them.'
    },

    /* ---------------- C ---------------- */
    {
      lang: 'C',
      code: ['int x = 2147483647;', 'printf("%d\\n", x + 1);'].join('\n'),
      opts: ['-2147483648', '2147483648', '0',
             'Undefined behaviour: often -2147483648, but the compiler may assume it cannot happen'],
      a: 'Undefined behaviour: often -2147483648, but the compiler may assume it cannot happen',
      why: 'Signed overflow is undefined in C, not a guarantee of wrap-around. On a two\'s-complement ' +
        'target the addition usually does wrap and you see -2147483648, but the compiler is equally ' +
        'entitled to assume <code>x + 1 &gt; x</code> always holds &mdash; which is how overflow checks ' +
        'written that way get optimised away entirely. Do the check before the addition, or use unsigned ' +
        'types, which are defined to wrap.'
    },
    {
      lang: 'C',
      code: ['unsigned int u = 0;', 'u--;', 'printf("%u\\n", u);'].join('\n'),
      opts: ['4294967295', '-1', '0', 'Undefined behaviour'],
      a: '4294967295',
      why: 'Unsigned arithmetic is defined to wrap modulo 2 to the power of the width, so 0 - 1 is ' +
        '<code>UINT_MAX</code> &mdash; 4294967295 where <code>unsigned int</code> is 32 bits. That is the ' +
        'exact opposite of the signed case above, and it is why ' +
        '<code>for (unsigned i = n; i &gt;= 0; i--)</code> never terminates: the condition cannot be false.'
    },
    {
      lang: 'C',
      code: ['void show(int a[10]) {',
             '    printf("%zu\\n", sizeof a);',
             '}',
             '',
             'int arr[10];',
             'show(arr);'].join('\n'),
      opts: ['8 on a typical 64-bit build', '40', '10', '80'],
      a: '8 on a typical 64-bit build',
      why: 'A parameter written <code>int a[10]</code> is not an array at all: the compiler rewrites it as ' +
        '<code>int *a</code> and ignores the number in the brackets entirely. <code>sizeof</code> then ' +
        'reports the size of a pointer, eight bytes where pointers are 64 bits. The length has to travel ' +
        'as a separate parameter, because there is no way to recover it from the pointer.'
    },
    {
      lang: 'C',
      code: ['int i = -1;',
             'unsigned int u = 1;',
             'printf("%s\\n", i < u ? "less" : "not less");'].join('\n'),
      opts: ['less', 'not less', '0', 'Undefined behaviour'],
      a: 'not less',
      why: 'The usual arithmetic conversions promote the <code>int</code> to <code>unsigned int</code> ' +
        'before comparing, and -1 converts to 4294967295, which is not less than 1. This is the bug behind ' +
        'comparing a signed counter against something like <code>strlen()</code>, whose result is unsigned. ' +
        'Build with <code>-Wsign-compare</code> and correct the types rather than casting.'
    },
    {
      lang: 'C',
      code: ['char s[] = "hello";', 'printf("%zu\\n", sizeof s);'].join('\n'),
      opts: ['6', '5', '8', '1'],
      a: '6',
      why: 'A string literal carries a terminating NUL byte, and <code>char s[] = "hello"</code> sizes the ' +
        'array to hold it &mdash; six bytes. <code>strlen(s)</code> is 5, because it counts up to but not ' +
        'including the NUL. Confusing the two is the classic off-by-one that turns a buffer size into a ' +
        'buffer overrun.'
    }
  ];

  GameShell.define({
    id: 'game-guess-the-output',
    slug: 'guess-the-output',
    title: 'Guess the output',
    bestKey: 'guess-the-output',
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var deck = [];
      var at = 0;
      var right = 0;
      var missed = {};
      var answered = false;
      var shown = [];
      var langSel = g.el.querySelector('#game-lang');

      if (langSel) {
        /* Changing the filter changes how many questions there are, so it has
           to begin a fresh run rather than edit one in progress. */
        langSel.addEventListener('change', function () { g.start(); });
      }

      function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function build() {
        var want = langSel ? langSel.value : 'all';
        deck = [];
        for (var i = 0; i < ITEMS.length; i++) {
          if (want === 'all' || ITEMS[i].lang === want) deck.push(ITEMS[i]);
        }
        g.shuffle(deck);
      }

      function render() {
        if (at >= deck.length) { finish(); return; }
        var it = deck[at];
        answered = false;

        shown = g.shuffle(it.opts.slice());
        var buttons = '';
        for (var i = 0; i < shown.length; i++) {
          buttons += '<button class="game-btn gto-option" type="button" data-opt="' + i + '">' +
                     esc(shown[i]) + '</button>';
        }

        host.className = 'game-board board-guess';
        host.innerHTML =
          '<div class="gto-card">' +
          '  <div class="gto-head">' +
          '    <span class="gto-lang">' + esc(it.lang) + '</span>' +
          '    <span class="gto-ask">What does this print?</span>' +
          '  </div>' +
          '  <pre class="gto-code"><code>' + esc(it.code) + '</code></pre>' +
          '</div>' +
          '<div class="gto-options" role="group" aria-label="Possible output">' + buttons + '</div>' +
          '<div class="gto-verdict" id="gto-verdict" hidden></div>';

        var opts = host.querySelectorAll('.gto-option');
        for (var b = 0; b < opts.length; b++) {
          (function (btn, label) {
            btn.addEventListener('click', function () { answer(label, btn); });
          })(opts[b], shown[b]);
        }

        g.stat('seen', at + '/' + deck.length);
        g.stat('right', right);
      }

      function answer(label, btn) {
        if (answered) return;
        answered = true;
        var it = deck[at];
        var ok = label === it.a;

        if (ok) { right++; g.beep(760, 0.06, 'sine'); }
        else { missed[it.lang] = (missed[it.lang] || 0) + 1; g.beep(200, 0.09, 'square'); }
        g.stat('right', right);

        /* Mark the correct option as well as the chosen one, so a wrong answer
           still shows which line the explanation is about. */
        var opts = host.querySelectorAll('.gto-option');
        for (var i = 0; i < opts.length; i++) {
          opts[i].disabled = true;
          if (shown[i] === it.a) opts[i].classList.add('is-right');
        }
        if (!ok) btn.classList.add('is-wrong');

        var v = host.querySelector('#gto-verdict');
        v.hidden = false;
        v.className = 'gto-verdict ' + (ok ? 'is-right' : 'is-wrong');
        v.innerHTML =
          '<p class="gto-call">' + (ok ? 'Correct' : 'Not quite') + ' &mdash; it prints <code>' +
          esc(it.a) + '</code>.</p>' +
          '<p class="gto-why">' + it.why + '</p>' +
          '<button class="btn btn-primary" type="button" id="gto-next">' +
          (at + 1 >= deck.length ? 'See the score' : 'Next') + '</button>';
        var next = v.querySelector('#gto-next');
        next.addEventListener('click', function () { at++; render(); });
        try { next.focus({ preventScroll: true }); } catch (e) {}
      }

      function finish() {
        var total = deck.length;
        var pct = total ? Math.round((right / total) * 100) : 0;

        /* Naming the language that cost the most is more use than a grade,
           and it is only said when one clearly did. */
        var worst = null;
        for (var k in missed) {
          if (!Object.prototype.hasOwnProperty.call(missed, k)) continue;
          if (!worst || missed[k] > missed[worst]) worst = k;
        }
        var note = pct >= 90 ? 'You already knew where the bodies are buried.'
                 : pct >= 60 ? 'The ones people miss are rarely the language they write every day.'
                 : 'Worth another run — the order and the options both shuffle.';
        if (worst && missed[worst] > 1) {
          note += ' ' + missed[worst] + ' of the misses were ' + worst + '.';
        }

        g.over({
          won: pct >= 60,
          score: right,
          title: right + ' of ' + total,
          message: note
        });
      }

      return {
        reset: function () {
          build();
          at = 0;
          right = 0;
          missed = {};
          g.setScore(0);
          render();
        }
      };
    }
  });
})();

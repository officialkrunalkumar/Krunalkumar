/* ==========================================================================
   love-calculator.js — two names in, one number out, and the working shown.
   --------------------------------------------------------------------------
   This is a joke, and the page says so. What makes it worth building anyway
   is that it is an honest version of a dishonest genre: every love
   calculator on the web is doing roughly this, and none of them will tell
   you. So this one prints its own algorithm under the result, gives the same
   answer for the same names every time — because that is what a hash does —
   and links to the piece on the blog that has something real to say.

   FNV-1a, 32-bit, over the sorted lowercase names. Sorted because the order
   of two names is not information about anything, and an asymmetric result
   would be the one indefensible detail in an otherwise upfront joke.

   Nothing is stored and nothing is sent. There is no localStorage write in
   this file at all, deliberately: the one page on the site whose input is
   two people's names is the page that should keep the least.
   ========================================================================== */

(function () {
  'use strict';

  var BLOG = '/blog/types-of-love-and-choosing-a-life-partner';

  /* Bands, and what each one gets told. Written so that a low score is
     funny rather than unkind — the page has already said the number means
     nothing, so the copy can afford to enjoy itself. */
  var BANDS = [
    { at: 95, line: 'The hash function is unusually enthusiastic about you two.' },
    { at: 80, line: 'A strong showing, from an algorithm that has never met either of you.' },
    { at: 60, line: 'Respectable. Statistically indistinguishable from any other pair of names.' },
    { at: 40, line: 'Middling — which is exactly what you would expect from arithmetic.' },
    { at: 20, line: 'Low, and completely meaningless. Try swapping a nickname and watch it change.' },
    { at: 0,  line: 'The letters did not get on. The people are a separate question entirely.' }
  ];

  function fnv1a(str) {
    /* 32-bit FNV-1a. offset basis 2166136261, prime 16777619. Math.imul
       keeps the multiply in 32 bits — a plain * overflows into a double
       here and quietly gives a different hash. */
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function normalise(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  GameShell.define({
    id: 'game-love-calculator',
    slug: 'love-calculator',
    title: 'Love calculator',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,

    setup: function (g) {
      var boardEl = g.board;
      if (!boardEl) return {};

      /* This game is really a form, so it opts out of the automatic pause via
         pauseOnBlur above. That flag was once honoured by the shell's blur
         handler and ignored by its visibilitychange handler, which meant a tab
         switch dropped a Paused panel over a half-filled form and, because
         showOverlay() moves the keyboard onto Resume, lifted the caret out of
         the name being typed. The shell now asks the same question in both
         places, so nothing game-specific is needed here. */

      boardEl.className = 'game-board board-love';
      boardEl.innerHTML =
        '<form class="love-form" novalidate>' +
        '  <div class="love-fields">' +
        '    <label class="love-field">' +
        '      <span>First name</span>' +
        '      <input type="text" id="love-a" autocomplete="off" maxlength="40" placeholder="Asha" />' +
        '    </label>' +
        '    <span class="love-amp" aria-hidden="true">&hearts;</span>' +
        '    <label class="love-field">' +
        '      <span>Second name</span>' +
        '      <input type="text" id="love-b" autocomplete="off" maxlength="40" placeholder="Ravi" />' +
        '    </label>' +
        '  </div>' +
        '  <button class="btn btn-primary love-go" type="submit">Calculate</button>' +
        '</form>' +
        '<div class="love-out" id="love-out" hidden>' +
        '  <div class="love-score"><span id="love-pct">0</span><small>%</small></div>' +
        '  <p class="love-line" id="love-line"></p>' +
        '  <div class="love-working" id="love-working"></div>' +
        '  <p class="love-real">None of this is real. What actually predicts whether two people last is ' +
        '     values, timing, and how each of you behaves when it is hard &mdash; ' +
        '     <a href="' + BLOG + '">the long version is here &rarr;</a></p>' +
        '</div>';

      var form = boardEl.querySelector('.love-form');
      var inA = boardEl.querySelector('#love-a');
      var inB = boardEl.querySelector('#love-b');
      var out = boardEl.querySelector('#love-out');
      var pct = boardEl.querySelector('#love-pct');
      var line = boardEl.querySelector('#love-line');
      var working = boardEl.querySelector('#love-working');

      function calculate() {
        var a = normalise(inA.value);
        var b = normalise(inB.value);
        if (!a || !b) {
          line.textContent = 'Two names, please.';
          out.hidden = false;
          pct.textContent = '—';
          working.innerHTML = '';
          g.stat('result', '—');
          return;
        }

        /* Sorted, so "Asha and Ravi" equals "Ravi and Asha". */
        var pair = a < b ? a + b : b + a;
        var hash = fnv1a(pair);
        var score = hash % 101;

        pct.textContent = String(score);
        g.stat('result', score + '%');

        var band = BANDS[BANDS.length - 1];
        for (var i = 0; i < BANDS.length; i++) {
          if (score >= BANDS[i].at) { band = BANDS[i]; break; }
        }
        line.textContent = band.line;

        /* The working, printed. This is the entire point of the page. */
        working.innerHTML =
          '<p class="love-working-h">Here is exactly what just happened</p>' +
          '<ol class="love-steps">' +
          '<li>Both names lowercased and stripped to letters and digits.</li>' +
          '<li>Sorted and joined: <code>' + escapeHtml(pair) + '</code></li>' +
          '<li>FNV-1a 32-bit hash: <code>0x' + hash.toString(16).padStart(8, '0') + '</code></li>' +
          '<li>Modulo 101: <code>' + score + '</code></li>' +
          '</ol>' +
          '<p class="love-working-note">That is the whole algorithm. It has no information about either ' +
          'person, so it cannot be measuring anything about them. Put the same names in tomorrow and you ' +
          'will get ' + score + ' again, because a hash is a pure function of its input &mdash; which is ' +
          'also how you can tell that any site promising a &ldquo;fresh reading&rdquo; is using a random ' +
          'number and calling it insight.</p>';

        out.hidden = false;
        /* A small rising arpeggio, tuned to the score, because why not. */
        g.beep(330 + score * 3, 0.08, 'sine');
      }

      function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        calculate();
      });

      return {
        reset: function () {
          if (out) out.hidden = true;
          g.stat('result', '—');
        }
      };
    }
  });
})();

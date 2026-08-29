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

   The sound follows the copy's rule rather than the number's. The reveal
   is a rising major arpeggio, and the score moves exactly two things about
   it: the pitch it starts from and how many notes it climbs, so a 12 comes
   out low and short where a 97 comes out high and long. The SHAPE never
   changes. A minor figure, or a falling one, for a low score is the
   obvious idea and it is the wrong one — a page that has just finished
   explaining that the result is arithmetic cannot then make a noise that
   sounds like bad news about somebody's relationship.

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

  /* The reveal figure, in semitones above whatever root the score picks: a
     major triad, its octave, and the third above that. Every score plays a
     prefix of this one list. A pentatonic would be the safer table for a
     randomly chosen pitch, but nothing here is chosen randomly — the whole
     run is transposed as a block, so a plain triad cannot land on a sour
     interval, and it reads far more clearly as a chord being played than a
     scale run does. */
  var ARP = [0, 4, 7, 12, 16];

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
        reveal(score);
      }

      function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      /* ---------------------------------------------------------------
         Sound. Two things happen on this page, and both of them make one.
         --------------------------------------------------------------- */

      /* One note of the figure, struck now or shortly. The shell's
         one-shots all strike at ctx.currentTime — there is no
         scheduled-start argument, and reaching into the AudioContext to get
         one would be going around the API rather than using it — so the
         spacing comes off the page clock instead. Across five notes inside
         a third of a second, timer jitter is not audible as anything.

         Nothing needs cancelling on the way out. A note that lands after
         the visitor has hit mute finds g.pluck already checking that, and
         plays silence. */
      function note(delay, freq, dur, level) {
        if (delay <= 0) { g.pluck(freq, dur, level); return; }
        setTimeout(function () { g.pluck(freq, dur, level); }, delay * 1000);
      }

      /* The reveal. The number is the entire payload of the page, so the
         sound is asked to carry it: a 12 and a 97 have to be tellable apart
         with the screen off. The score sets the root pitch and the note
         count and nothing else — see the header for why the shape is held
         fixed no matter how the arithmetic lands.

         g.pluck rather than g.beep, because a struck note whose lowpass
         closes over its own tail reads as something played, and four square
         beeps in a row read as a microwave finishing. */
      function reveal(score) {
        /* Holding Enter in a text field re-submits as fast as the key
           repeats, which is a good deal faster than the figure lasts. The
           gate sits just past the span of one arpeggio's onsets, so two can
           never interleave into a chord; a deliberate second press, nowhere
           near that fast, still gets its own. */
        if (!g.gate('reveal', 0.4)) return;

        var k = score / 100;

        /* G3 at 0 climbing to F4 at 100. Ten semitones is wide enough to
           place a result by ear on the first hearing, and narrow enough
           that the bottom of the range still sounds warm rather than
           funereal — which is the whole point of the range. */
        var root = 196 * Math.pow(2, (k * 10) / 12);

        /* Three notes at the bottom, five at the top. The extra notes are
           what makes a high score feel like it went somewhere, and they are
           the length half of low-and-short against high-and-long. */
        var notes = 3 + Math.round(k * 2);

        for (var i = 0; i < notes; i++) {
          var last = i === notes - 1;
          /* Only the top note is allowed to ring on, and it rings longer
             the higher the score. The notes under it are still sounding
             while it does, which is what makes separate plucks arrive as
             one rolled chord instead of as a queue of blips. */
          var dur = last ? 0.5 + k * 0.35 : 0.34;
          var freq = root * Math.pow(2, ARP[i] / 12);
          /* Seventy-five milliseconds apart is a roll, not a tune. Space
             them any wider and this becomes a fanfare over a result the
             page has just finished calling meaningless. */
          note(i * 0.075, freq, dur, last ? 0.05 : 0.042);
        }
      }

      /* Typing. The quietest thing on the page by some distance, because it
         is also the most frequent: two hundredths of a second of bandpassed
         noise, at a third the level of one note of the reveal. Enough to
         feel the form answering, not enough that anyone reaches for the
         toggle while they are still filling it in.

         The centre frequency wanders a little per keystroke. Held dead
         still it stops being a keyboard within about ten characters and
         becomes a fault indicator, which is the same reason the rain toy
         randomises its plinks, and the fix costs one Math.random.

         The gate is not there to thin ordinary typing — even a fast typist
         sits well inside twenty characters a second, so every keystroke
         ticks. It is there for a HELD key, which auto-repeats at around
         thirty a second and would otherwise buzz. */
      function tick() {
        if (!g.gate('type', 0.05)) return;
        g.noise(0.02, {
          type: 'bandpass',
          freq: 1700 + Math.random() * 700,
          q: 1.6,
          level: 0.014
        });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        calculate();
      });

      inA.addEventListener('input', tick);
      inB.addEventListener('input', tick);

      return {
        reset: function () {
          if (out) out.hidden = true;
          g.stat('result', '—');
        }
      };
    }
  });
})();

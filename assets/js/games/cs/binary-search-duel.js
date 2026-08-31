/* ==========================================================================
   binary-search-duel.js — binary search played from both ends, plus the
   two bugs that make it worth a programmer's afternoon.
   --------------------------------------------------------------------------
   Everybody can already play "guess my number". What almost nobody does is
   keep score against the floor, and the floor is the only interesting part
   of binary search. So this file spends most of its length on bookkeeping
   the player cannot be bothered to do in their head: how many candidates a
   guess actually killed, how many the best available guess would have
   killed, and the difference between the two expressed in bits.

   FOUR DECISIONS.

   1. PAR IS ceil(log2(n+1)), NOT ceil(log2(n)), AND IT IS COMPUTED AND NOT
      DERIVED. The usual statement — "n candidates, one bit an answer, so
      log2(n) questions" — is a shade too generous, because a correct guess
      ENDS the round and therefore carries more than one bit. With k guesses
      you can separate at most 2^k - 1 values (guess the middle of the block
      you can handle with k-1, and each side is another such block), so the
      floor is the smallest k with 2^k - 1 >= n. For 64 that is 7 and not 6,
      which is exactly the kind of off-by-one this game is about, so it
      would have been embarrassing to get wrong in the scoring. It is worked
      out by doubling in parFor() rather than by calling Math.log, because
      floating point near a power of two is precisely where ceil() lies.

      The four ranges offered are 50, 100, 1000 and 10000. None is a power
      of two, so for every range here the two formulas happen to agree, and
      the page can print the familiar one without printing something false.

   2. A GUESS OUTSIDE THE LIVE INTERVAL IS REFUSED, NOT PUNISHED. The bar
      clamps a drag to the interval that is still alive, and a number typed
      outside it comes back with the earlier answer that ruled it out. That
      guess carries zero bits, so charging one for it would be teaching the
      wrong lesson through a mis-tap. What IS measured is the interesting
      waste: a guess inside the interval that does not split it evenly. Its
      cost is log2(worstLeft / bestWorstLeft), which is zero exactly at the
      midpoint and never negative, so being lucky cannot buy it back.

   3. THE CHEAT DETECTOR IS EXACT AND NAMES BOTH ENDS. In the answering
      half the file keeps lo and hi, and beside each of them the guess
      number and value that set it. When an answer would make lo exceed hi
      there is no "that looks wrong" — there are two specific answers, and
      the message quotes both of them and the empty range they leave. The
      softer case, where a player answers to keep the larger half every
      time and has probably not thought of a number at all, is NOT called
      cheating, because it is not: it is the adversary argument that proves
      the lower bound, and the game says so and then finishes in exactly
      par, which is the point of the argument.

   4. THE OVERFLOW HAS TO BE FORCED, AND THAT IS SAID OUT LOUD. JavaScript
      numbers are doubles, so (lo + hi) never wraps here the way it does in
      Java or C. The trap mode pushes the sum through a bitwise OR with
      zero, which is a 32-bit truncation, so the negative midpoint that
      broke java.util.Arrays.binarySearch for nine years appears on screen
      with its real arithmetic beside it. Simulated, and labelled as
      simulated, rather than quietly implied.

   Sound is one-shots only. There is no condition here to hold — no rain,
   no engine, nothing continuing — only turns, so a bed would be a layer
   with nothing to say. Pitch tracks position in the range, which means a
   converging search is audibly a converging search.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  var MONO = "'Cascadia Code', 'Fira Code', Consolas, Menlo, monospace";

  var INK = 'var(--ink)';
  var INK2 = 'var(--ink-2)';
  var INK3 = 'var(--ink-3)';
  var INK4 = 'var(--ink-4)';
  var LINE = 'rgb(var(--line-rgb) / 0.28)';
  var SHEET = 'rgb(var(--sheet-rgb) / 0.6)';
  var ACCENT = 'var(--accent)';
  var GOOD = '#4ade80';
  var BAD = '#f87171';
  var WARN = '#fbbf24';

  var RANGES = { '50': 50, '100': 100, '1000': 1000, '10000': 10000 };

  /* Search, answer, search, answer. Alternating rather than two blocks,
     because the reversal is the joke and it lands better twice. */
  var ROUNDS = ['search', 'answer', 'search', 'answer'];

  /* The trap's small array. Sixteen sorted values with gaps in them, so a
     target can be "in the array" without being its own index. */
  var SMALL = [];
  (function () {
    for (var i = 0; i < 16; i++) SMALL.push(i * 3 + 4);
  })();

  /* Two thousand one hundred million elements, described rather than
     allocated: a[i] = i, so a probe is arithmetic and the array never
     exists. Big enough that lo + hi leaves the signed 32-bit range while
     the search is still working near the top of it. */
  var HUGE_LEN = 2100000000;
  var HUGE_TARGETS = { start: 1000, middle: 1300000000, end: 2099999000 };

  /* ------------------------------------------------------------------
     Small helpers.
     ------------------------------------------------------------------ */
  function lg(x) { return Math.log(x) / Math.LN2; }

  /* The floor, by doubling. See decision 1: Math.ceil(Math.log(n)/Math.LN2)
     is wrong at every power of two and this is the one file that cannot
     afford that. */
  function parFor(n) {
    var k = 0, cap = 0;
    while (cap < n) { k++; cap = cap * 2 + 1; }
    return k;
  }

  function midOf(lo, hi) { return lo + Math.floor((hi - lo) / 2); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function trunc(x) { return x < 0 ? Math.ceil(x) : Math.floor(x); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Grouped digits. The trap prints numbers in the billions and an ungrouped
     2099999999 is unreadable at a glance, which matters when the whole point
     is noticing that one of them went negative. */
  function fmt(n) {
    var neg = n < 0;
    var s = String(neg ? -n : n);
    var out = '';
    var c = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return (neg ? '-' : '') + out;
  }

  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += ' ';
    return s;
  }

  function two(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  var S_EYE = 'margin:0 0 0.3rem;font-size:0.68rem;letter-spacing:0.08em;' +
    'text-transform:uppercase;color:' + INK4 + ';';
  var S_HEAD = 'margin:0 0 0.4rem;font-size:1.05rem;line-height:1.4;color:' + INK + ';';
  var S_BRIEF = 'margin:0 0 0.9rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';';
  var S_LIVE = 'margin:0.75rem 0 0.5rem;font-size:0.88rem;line-height:1.6;color:' + INK + ';';
  var S_HINT = 'margin:0.45rem 0 0;font-size:0.8rem;line-height:1.55;color:' + INK4 + ';';
  var S_LOG = 'margin:0.7rem 0 0;padding:0;list-style:none;max-height:11rem;overflow:auto;';
  /* white-space: pre, because every line in the log and the report is laid
     out in columns padded with real spaces, and HTML collapses those. The
     overflow is on the row rather than on the page: a long line scrolls
     inside itself instead of widening the whole board on a phone. */
  var S_LI = 'margin:0 0 0.35rem;font-size:0.76rem;line-height:1.5;color:' + INK3 +
    ';font-family:' + MONO + ';white-space:pre;overflow-x:auto;';
  var S_PANEL = 'margin:0.8rem 0 0;padding:0.75rem 0.85rem;border-radius:10px;background:' +
    SHEET + ';border:1px solid ' + LINE + ';';

  GameShell.define({
    id: 'game-binary-search-duel',
    slug: 'binary-search-duel',
    board: true,

    /* All four of these are repeated in the manifest, and the build's games
       manifest gate is right to insist: the manifest is build-time data that
       nothing hands to the runtime, so a bestOrder set only there would be a
       comment that reads like code. Fewer guesses is better, which is the
       whole reason bestOrder is here at all. */
    bestKey: 'binary-search-duel',
    bestOrder: 'low',
    tapAction: false,
    tapKey: 'action',

    /* Nothing is on a clock, so a tab switch has nothing to protect the
       player from — and the shell's pause overlay would cover a board the
       player was reading. */
    pauseOnBlur: false,

    title: 'Binary search duel',
    startTitle: 'Binary search duel',
    startText: 'Four rounds. In two of them I hide a number and you narrow it down; ' +
      'in the other two you hide one and I do the narrowing. Nothing is uploaded, and the ' +
      'only thing stored is your best score, in this browser.',

    /* The stored number is one plus your overspend against par, because the
       shell reads a final of zero as "no run happened" and a flawless duel
       is worth exactly zero over par. The offset never reaches the page. */
    formatBest: function (n) {
      if (!n) return '—';
      return n <= 1 ? 'par' : '+' + (n - 1);
    },

    setup: function (g) {
      /* The manifest says board: true, so the generated page hands the shell
         a .game-board and no canvas. Belt and braces if that ever changes:
         a canvas page for this game would render nothing whatsoever. */
      var host = g.board;
      if (!host) {
        host = document.createElement('div');
        host.className = 'game-board';
        if (g.canvas) g.canvas.hidden = true;
        (g.stage || g.el).appendChild(host);
        g.board = host;
        g.focusTarget = host;
        host.setAttribute('tabindex', '0');
      }
      host.style.display = 'block';
      host.style.width = '100%';
      host.style.maxWidth = '46rem';
      host.style.textAlign = 'left';
      host.setAttribute('aria-label',
        'Binary search duel board. Left and right move your guess by one, up and down ' +
        'move it in larger steps, Enter commits it. While answering, left means your ' +
        'number is lower, right means higher and Enter means the guess is correct.');

      var modeSel = document.getElementById('game-mode');
      var rangeSel = document.getElementById('game-range');
      var hintBtn = document.getElementById('game-hint');

      var showMid = true;

      /* The whole run. Rebuilt by begin(); never mutated from outside it. */
      var S = null;

      /* Cached nodes for the round currently on screen. Rebuilt when a round
         is built, so nothing here survives a round it does not belong to. */
      var D = {};

      function q(sel) { return host.querySelector(sel); }

      function say(msg) { g.announce(msg); }

      /* --------------------------------------------------------------
         Sound. Pitch follows position in the range, so the search is
         audibly converging: two guesses either side of the answer are
         two notes either side of a pitch.
         -------------------------------------------------------------- */
      function noteFor(v, n) {
        return 200 + (clamp(v, 1, n) / n) * 700;
      }

      function soundGuess(v, n) { g.pluck(noteFor(v, n), 0.22, 0.05); }

      function soundVerdict(up) {
        if (up) { g.beep(520, 0.06, 'sine', 0.04); g.beep(660, 0.06, 'sine', 0.03); }
        else { g.beep(440, 0.06, 'sine', 0.04); g.beep(330, 0.06, 'sine', 0.03); }
      }

      function soundHit() { g.sweep(520, 1040, 0.3); }

      function soundRefuse() { g.noise(0.09, { type: 'lowpass', freq: 700, level: 0.05 }); }

      function soundCheat() {
        g.noise(0.16, { type: 'bandpass', freq: 240, to: 110, q: 2, level: 0.09 });
        g.sweep(300, 80, 0.4);
      }

      /* --------------------------------------------------------------
         The bar. One track for the range, a filled block for the
         interval still alive, and a tick for the guess on the table.

         role="img" with a written label rather than a slider: it is a
         picture of an interval that the number field beside it already
         states in words, and a second focusable control claiming the
         arrow keys would fight the board for them.
         -------------------------------------------------------------- */
      function pct(v, n) {
        if (n <= 1) return 0;
        return ((v - 1) / (n - 1)) * 100;
      }

      function trackHtml() {
        return '<div data-track style="position:relative;height:28px;margin:0.2rem 0 0.35rem;' +
          'border-radius:7px;background:rgb(var(--line-rgb) / 0.16);border:1px solid ' + LINE +
          ';touch-action:none;cursor:pointer;" role="img" aria-label="The interval still alive">' +
          '<div data-alive style="position:absolute;top:2px;bottom:2px;left:0;width:100%;' +
          'border-radius:5px;background:rgb(var(--accent-rgb) / 0.32);"></div>' +
          '<div data-mark style="position:absolute;top:-3px;bottom:-3px;width:2px;left:0;' +
          'background:' + INK + ';"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;font-size:0.7rem;' +
          'font-family:' + MONO + ';color:' + INK4 + ';"><span>1</span>' +
          '<span data-ends></span></div>';
      }

      function paintTrack(lo, hi, marker, n) {
        if (!D.alive) return;
        var left = pct(lo, n);
        var right = pct(hi, n);
        D.alive.style.left = left + '%';
        D.alive.style.width = Math.max(0.6, right - left) + '%';
        if (D.mark) {
          D.mark.style.left = pct(marker, n) + '%';
          D.mark.hidden = marker == null;
        }
        if (D.track) {
          D.track.setAttribute('aria-label',
            'Still alive: ' + fmt(lo) + ' to ' + fmt(hi) + ' of 1 to ' + fmt(n) + '.');
        }
        if (D.ends) D.ends.textContent = fmt(n);
      }

      /* One thin bar per guess already made, showing the interval that was
         alive before it and where the guess fell. Hidden from assistive
         tech: the log underneath says the same thing in numbers, and a
         stack of unlabelled rectangles adds nothing to it. */
      function paintStack(history, n) {
        if (!D.stack) return;
        var html = '';
        for (var i = 0; i < history.length; i++) {
          var h = history[i];
          var l = pct(h.lo, n);
          var w = Math.max(0.5, pct(h.hi, n) - l);
          html += '<div style="position:relative;height:7px;margin-bottom:3px;border-radius:3px;' +
            'background:rgb(var(--line-rgb) / 0.14);">' +
            '<div style="position:absolute;top:0;bottom:0;left:' + l + '%;width:' + w + '%;' +
            'border-radius:3px;background:rgb(var(--accent-rgb) / 0.28);"></div>' +
            '<div style="position:absolute;top:-1px;bottom:-1px;width:2px;left:' +
            pct(h.guess, n) + '%;background:' + (h.centre ? GOOD : WARN) + ';"></div>' +
            '</div>';
        }
        D.stack.innerHTML = html;
      }

      function logLine(text, tone) {
        if (!D.log) return;
        var li = document.createElement('li');
        li.setAttribute('style', S_LI + (tone ? 'color:' + tone + ';' : ''));
        li.textContent = text;
        D.log.appendChild(li);
        D.log.scrollTop = D.log.scrollHeight;
      }

      function hud() {
        if (S.mode === 'trap') {
          g.stat('round', 'Trap');
          return;
        }
        var r = S.r;
        g.stat('round', (S.at + 1) + ' of ' + ROUNDS.length);
        g.stat('probes', r ? (r.used + ' of ' + S.par) : '0 of ' + S.par);
        g.stat('alive', r ? fmt(Math.max(0, r.hi - r.lo + 1)) : fmt(S.n));
        g.stat('over', S.over ? '+' + S.over : '0');
      }

      /* ==============================================================
         HALF ONE — the player searches.
         ============================================================== */
      function buildSearch() {
        var r = S.r;
        D = {};
        host.innerHTML =
          '<p style="' + S_EYE + '">Round ' + (S.at + 1) + ' of ' + ROUNDS.length +
          ' &middot; you search</p>' +
          '<h3 style="' + S_HEAD + '">I have written down a number between 1 and ' +
          fmt(S.n) + '.</h3>' +
          '<p style="' + S_BRIEF + '">It is fixed now and it does not move while you hunt for ' +
          'it. Every answer I give is one bit, so ' + S.par + ' guesses are always enough and ' +
          S.par + ' is the fewest that can be enough for ' + fmt(S.n) + ' candidates. Anything ' +
          'over that is information you threw away.</p>' +
          '<div data-stack aria-hidden="true" style="margin:0 0 0.4rem;"></div>' +
          trackHtml() +
          '<p data-live role="status" aria-live="polite" style="' + S_LIVE + '"></p>' +
          '<div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;">' +
          '<label for="bsd-guess" style="font-size:0.8rem;color:' + INK3 + ';">Your guess</label>' +
          '<input id="bsd-guess" type="number" inputmode="numeric" autocomplete="off" ' +
          'min="1" max="' + S.n + '" style="width:7.5rem;padding:0.45rem 0.6rem;border-radius:8px;' +
          'border:1px solid ' + LINE + ';background:' + SHEET + ';color:' + INK +
          ';font-family:' + MONO + ';font-size:0.95rem;">' +
          '<button class="btn btn-primary" type="button" data-go>Guess</button>' +
          '</div>' +
          '<p data-hint style="' + S_HINT + '"></p>' +
          '<ul data-log style="' + S_LOG + '"></ul>' +
          '<div data-after hidden style="' + S_PANEL + '"></div>';

        D.stack = q('[data-stack]');
        D.track = q('[data-track]');
        D.alive = q('[data-alive]');
        D.mark = q('[data-mark]');
        D.ends = q('[data-ends]');
        D.live = q('[data-live]');
        D.input = q('#bsd-guess');
        D.go = q('[data-go]');
        D.hint = q('[data-hint]');
        D.log = q('[data-log]');
        D.after = q('[data-after]');

        bindTrack(D.track);
        D.go.addEventListener('click', function () { commit(); });
        D.input.addEventListener('input', function () {
          var v = parseInt(D.input.value, 10);
          if (isFinite(v)) {
            r.marker = clamp(v, 1, S.n);
            paintTrack(r.lo, r.hi, r.marker, S.n);
            D.go.textContent = 'Guess ' + fmt(r.marker);
          }
        });
        D.input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit();
        });

        setMarker(midOf(r.lo, r.hi));
        showState('Guess anywhere inside the live interval. The bar shows what is left.');
        handBack();
      }

      /* Building a round replaces the whole board, and with it the button
         that was focused — the Next round button that got us here. The
         browser drops focus to <body> when that happens, which is outside
         the shell element, so the arrow keys stop reaching the game until
         somebody thinks to click the board. Put the keyboard back on the
         playfield, but never during the reset() the shell runs while it is
         still constructing: that one happens on page load, and stealing
         focus there takes it from wherever the visitor actually was. */
      function handBack() {
        if (g.state !== 'playing') return;
        g.takeFocus();
      }

      function setMarker(v) {
        var r = S.r;
        r.marker = clamp(Math.round(v), r.lo, r.hi);
        if (D.input) D.input.value = String(r.marker);
        if (D.go) D.go.textContent = 'Guess ' + fmt(r.marker);
        paintTrack(r.lo, r.hi, r.marker, S.n);
      }

      function showState(msg) {
        var r = S.r;
        if (D.live) D.live.textContent = msg;
        var alive = r.hi - r.lo + 1;
        var left = parFor(alive);
        var line = fmt(alive) + ' candidate' + (alive === 1 ? '' : 's') + ' still alive, ' +
          fmt(r.lo) + ' to ' + fmt(r.hi) + '. ' + left + ' more guess' +
          (left === 1 ? '' : 'es') + ' can always finish it.';
        if (showMid && alive > 1) line += ' The midpoint is ' + fmt(midOf(r.lo, r.hi)) + '.';
        if (D.hint) D.hint.textContent = line;
        hud();
      }

      function bindTrack(el) {
        if (!el) return;
        var dragging = false;
        var value = function (clientX) {
          var rect = el.getBoundingClientRect();
          if (!rect.width) return S.r.lo;
          var t = (clientX - rect.left) / rect.width;
          t = clamp(t, 0, 1);
          return clamp(Math.round(1 + t * (S.n - 1)), S.r.lo, S.r.hi);
        };
        el.addEventListener('pointerdown', function (e) {
          if (!S.r || S.r.kind !== 'search' || S.r.done) return;
          dragging = true;
          if (el.setPointerCapture) {
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* older engine */ }
          }
          setMarker(value(e.clientX));
          e.preventDefault();
        });
        el.addEventListener('pointermove', function (e) {
          if (!dragging) return;
          setMarker(value(e.clientX));
        });
        var stop = function () { dragging = false; };
        el.addEventListener('pointerup', stop);
        el.addEventListener('pointercancel', stop);
        el.addEventListener('pointerleave', stop);
      }

      /* Which earlier answer rules a value out. Kept so a refusal can quote
         the guess responsible rather than saying "no" and leaving the player
         to scroll back through the log for the reason. */
      function ruledOut(r, v) {
        if (v < r.lo) {
          return r.loSrc
            ? 'guess ' + r.loSrc.n + ' was ' + fmt(r.loSrc.g) + ' and I said higher'
            : 'the range starts at 1';
        }
        return r.hiSrc
          ? 'guess ' + r.hiSrc.n + ' was ' + fmt(r.hiSrc.g) + ' and I said lower'
          : 'the range stops at ' + fmt(S.n);
      }

      function commit() {
        var r = S.r;
        if (!r || r.kind !== 'search' || r.done) return;
        var raw = D.input ? D.input.value : '';
        var v = parseInt(raw, 10);
        if (!isFinite(v)) {
          soundRefuse();
          showState('That is not a number. Type one between 1 and ' + fmt(S.n) + '.');
          say('Not a number.');
          return;
        }
        if (v < 1 || v > S.n) {
          soundRefuse();
          showState(fmt(v) + ' is outside the range. It has to be between 1 and ' +
            fmt(S.n) + '. Nothing has been spent.');
          say(fmt(v) + ' is outside the range.');
          return;
        }
        if (v < r.lo || v > r.hi) {
          soundRefuse();
          showState(fmt(v) + ' is already ruled out — ' + ruledOut(r, v) +
            '. A guess outside the live interval cannot be right, so it carries no ' +
            'information and I am not charging you a guess for it.');
          say(fmt(v) + ' is already ruled out. Nothing spent.');
          return;
        }

        var m = r.hi - r.lo + 1;
        /* What this guess RISKS leaving, before the answer is known, against
           what the best available guess risks. The midpoint's worst case is
           ceil((m-1)/2) and nothing can do better; the gap between the two,
           in bits, is the honest cost of an off-centre guess and luck cannot
           reduce it. */
        var worst = Math.max(v - r.lo, r.hi - v);
        var bestWorst = Math.ceil((m - 1) / 2);
        var wasted = (worst > 0 && bestWorst > 0) ? lg(worst / bestWorst) : 0;
        var centre = worst === bestWorst;

        r.used++;
        S.used++;
        S.wasted += wasted;
        soundGuess(v, S.n);

        var before = { lo: r.lo, hi: r.hi, guess: v, centre: centre };
        r.history.push(before);

        if (v === S.secret) {
          r.done = true;
          paintStack(r.history, S.n);
          paintTrack(v, v, v, S.n);
          logLine('#' + r.used + '  ' + pad(fmt(v), 7) + ' correct');
          soundHit();
          finishSearch();
          return;
        }

        var up = v < S.secret;
        if (up) { r.lo = v + 1; r.loSrc = { n: r.used, g: v }; }
        else { r.hi = v - 1; r.hiSrc = { n: r.used, g: v }; }
        var after = r.hi - r.lo + 1;
        soundVerdict(up);

        paintStack(r.history, S.n);

        var msg = fmt(v) + ' — my number is ' + (up ? 'higher' : 'lower') + '. ' +
          fmt(after) + ' of ' + fmt(m) + ' candidates survive, so that answer was worth ' +
          two(lg(m / after)) + ' bits.';
        if (centre) {
          msg += ' That was the best split available: nothing could have guaranteed more.';
        } else {
          msg += ' It was off centre, though — it risked leaving ' + fmt(worst) +
            ' where the midpoint (' + fmt(midOf(before.lo, before.hi)) +
            ') risks at most ' + fmt(bestWorst) + ', so you gave away ' + two(wasted) +
            ' of a bit whatever the answer turned out to be.';
        }
        logLine('#' + r.used + '  ' + pad(fmt(v), 7) + (up ? 'higher' : 'lower ') +
          '   ' + pad(fmt(after) + ' left', 13) + (centre ? 'midpoint' : 'off centre'),
          centre ? '' : WARN);
        showState(msg);
        say(fmt(v) + ', ' + (up ? 'higher' : 'lower') + '. ' + fmt(after) + ' still alive.');

        if (r.used >= S.par + 6) {
          r.done = true;
          finishSearch(true);
        }
      }

      function finishSearch(exhausted) {
        var r = S.r;
        var over = Math.max(0, r.used - S.par);
        S.over += over;
        var head, body;
        if (exhausted) {
          head = 'Out of guesses.';
          body = 'The number was ' + fmt(S.secret) + '. You had ' + (S.par + 6) +
            ' guesses for a job that needs ' + S.par + '.';
        } else {
          head = 'Found it in ' + r.used + (r.used === 1 ? ' guess.' : ' guesses.');
          body = 'Par for ' + fmt(S.n) + ' candidates is ' + S.par + '. ' +
            (over > 0
              ? 'You spent ' + over + ' more than that.'
              : (r.used < S.par
                ? 'You beat par, which luck allows and skill cannot: par is the worst case, not the average.'
                : 'Exactly par.'));
        }
        S.rounds.push({
          kind: 'search', used: r.used, par: S.par, over: over,
          note: exhausted ? 'ran out of guesses' : (over ? over + ' over par' : 'at or under par')
        });
        if (D.after) {
          D.after.hidden = false;
          D.after.innerHTML =
            '<p style="margin:0 0 0.4rem;font-size:0.92rem;color:' + INK + ';">' + esc(head) +
            '</p><p style="margin:0 0 0.7rem;font-size:0.82rem;line-height:1.6;color:' + INK3 +
            ';">' + esc(body) + '</p>' +
            '<button class="btn btn-primary" type="button" data-next>Next round</button>';
          var btn = D.after.querySelector('[data-next]');
          btn.addEventListener('click', nextRound);
          try { btn.focus({ preventScroll: true }); } catch (err) { btn.focus(); }
        }
        if (D.go) D.go.disabled = true;
        if (D.input) D.input.disabled = true;
        say(head + ' ' + body);
        hud();
      }

      /* ==============================================================
         HALF TWO — the player answers, and is checked.
         ============================================================== */
      function buildAnswer() {
        var r = S.r;
        D = {};
        host.innerHTML =
          '<p style="' + S_EYE + '">Round ' + (S.at + 1) + ' of ' + ROUNDS.length +
          ' &middot; you answer</p>' +
          '<h3 style="' + S_HEAD + '">Think of a number between 1 and ' + fmt(S.n) +
          '. Keep it to yourself.</h3>' +
          '<p style="' + S_BRIEF + '">I will guess; you say whether yours is lower or higher. ' +
          'I am keeping the interval your answers imply, so if two of them cannot both be ' +
          'true I will say which two and what they left empty. Answering to make this take as ' +
          'long as possible is allowed, and is a different thing entirely — I will say so if ' +
          'you do it.</p>' +
          '<div data-stack aria-hidden="true" style="margin:0 0 0.4rem;"></div>' +
          trackHtml() +
          '<p data-q style="margin:0.6rem 0 0.6rem;font-size:1.1rem;color:' + INK + ';"></p>' +
          '<div role="group" aria-label="Your answer" data-answers ' +
          'style="display:flex;gap:0.5rem;flex-wrap:wrap;">' +
          '<button class="game-btn" type="button" data-ans="lower">&#9664; Mine is lower</button>' +
          '<button class="btn btn-primary" type="button" data-ans="correct">That is it</button>' +
          '<button class="game-btn" type="button" data-ans="higher">Mine is higher &#9654;</button>' +
          '</div>' +
          '<p data-live role="status" aria-live="polite" style="' + S_LIVE + '"></p>' +
          '<div data-alert hidden style="' + S_PANEL + '"></div>' +
          '<ul data-log style="' + S_LOG + '"></ul>' +
          '<div data-after hidden style="' + S_PANEL + '"></div>';

        D.stack = q('[data-stack]');
        D.track = q('[data-track]');
        D.alive = q('[data-alive]');
        D.mark = q('[data-mark]');
        D.ends = q('[data-ends]');
        D.qline = q('[data-q]');
        D.answers = q('[data-answers]');
        D.live = q('[data-live]');
        D.alert = q('[data-alert]');
        D.log = q('[data-log]');
        D.after = q('[data-after]');

        var btns = D.answers.querySelectorAll('[data-ans]');
        for (var i = 0; i < btns.length; i++) {
          (function (b) {
            b.addEventListener('click', function () { answer(b.getAttribute('data-ans')); });
          })(btns[i]);
        }

        askNext();
        handBack();
      }

      function askNext() {
        var r = S.r;
        r.guess = midOf(r.lo, r.hi);
        r.used++;
        paintTrack(r.lo, r.hi, r.guess, S.n);
        if (D.qline) {
          D.qline.textContent = 'Guess ' + r.used + ' — is it ' + fmt(r.guess) + '?';
        }
        if (D.live) {
          var alive = r.hi - r.lo + 1;
          D.live.textContent = 'Your answers so far leave ' + fmt(alive) + ' number' +
            (alive === 1 ? '' : 's') + ' possible: ' + fmt(r.lo) + ' to ' + fmt(r.hi) +
            '. I always ask about the middle of that, which is why ' + S.par +
            ' questions are always enough.';
        }
        say('Guess ' + r.used + '. Is it ' + fmt(r.guess) + '?');
        soundGuess(r.guess, S.n);
        hud();
      }

      /* The exact part. lo and hi carry the guess that set them, so a
         contradiction can be reported as two specific answers rather than as
         a suspicion. */
      function answer(kind) {
        var r = S.r;
        if (!r || r.kind !== 'answer' || r.done) return;
        var gv = r.guess;
        var below = gv - r.lo;      // candidates strictly below the guess
        var above = r.hi - gv;      // candidates strictly above it
        var maximal;

        if (kind === 'correct') {
          r.history.push({ lo: r.lo, hi: r.hi, guess: gv, centre: true });
          paintStack(r.history, S.n);
          logLine('#' + r.used + '  ' + pad(fmt(gv), 9) + 'correct');
          soundHit();
          r.done = true;
          finishAnswer(gv);
          return;
        }

        var goingUp = kind === 'higher';
        maximal = goingUp ? (above >= below) : (below >= above);

        /* The contradiction test, and it is a test and not a heuristic:
           accept the answer only if some number still satisfies every
           constraint already accepted. */
        if (goingUp && gv + 1 > r.hi) { caught(gv, true); return; }
        if (!goingUp && gv - 1 < r.lo) { caught(gv, false); return; }

        r.history.push({ lo: r.lo, hi: r.hi, guess: gv, centre: !maximal });
        if (goingUp) { r.lo = gv + 1; r.loSrc = { n: r.used, g: gv }; }
        else { r.hi = gv - 1; r.hiSrc = { n: r.used, g: gv }; }
        if (!maximal) r.allMaximal = false;
        r.answered++;
        paintStack(r.history, S.n);
        /* Amber only while EVERY answer so far has kept the larger half. An
           honest player lands on the larger side about half the time by
           chance, and tinting each of those made a normal round look like a
           string of warnings about nothing. */
        logLine('#' + r.used + '  ' + pad(fmt(gv), 9) + (goingUp ? 'higher' : 'lower ') +
          '   ' + pad(fmt(r.hi - r.lo + 1) + ' left', 13) + (maximal ? 'larger half' : 'smaller half'),
          (maximal && r.allMaximal) ? WARN : '');
        soundVerdict(goingUp);

        /* The soft case. Three answers in a row that each keep the larger
           side is not proof of anything — it is also what an honest player
           with an awkward number does — so it is reported as an observation
           and named for what it is, not accused. */
        if (r.allMaximal && r.answered >= 3 && !r.warned) {
          r.warned = true;
          adversaryNote();
        }
        askNext();
      }

      function caught(gv, goingUp) {
        var r = S.r;
        var need = goingUp ? gv + 1 : gv - 1;
        var src = goingUp ? r.hiSrc : r.loSrc;
        var other;
        if (src) {
          other = 'At guess ' + src.n + ' I asked about ' + fmt(src.g) + ' and you said ' +
            (goingUp ? 'lower, so it has to be at most ' + fmt(r.hi)
              : 'higher, so it has to be at least ' + fmt(r.lo)) + '.';
        } else {
          other = goingUp
            ? 'The range you chose stops at ' + fmt(S.n) + ', so it has to be at most ' +
              fmt(r.hi) + '.'
            : 'The range you chose starts at 1, so it has to be at least ' + fmt(r.lo) + '.';
        }
        var mine = 'You have just said ' + fmt(gv) + ' is too ' + (goingUp ? 'low' : 'high') +
          ', so your number has to be ' + (goingUp ? 'at least ' : 'at most ') + fmt(need) + '.';
        var empty = goingUp
          ? 'Between ' + fmt(need) + ' and ' + fmt(r.hi) + ' there is nothing at all.'
          : 'Between ' + fmt(r.lo) + ' and ' + fmt(need) + ' there is nothing at all.';

        S.cheats++;
        r.done = true;
        r.caught = true;
        soundCheat();

        if (D.alert) {
          D.alert.hidden = false;
          D.alert.setAttribute('style', S_PANEL + 'border-color:' + BAD + ';');
          D.alert.innerHTML =
            '<p style="margin:0 0 0.4rem;font-size:0.95rem;color:' + BAD +
            ';">Those two answers cannot both be true.</p>' +
            '<p style="margin:0 0 0.4rem;font-size:0.83rem;line-height:1.6;color:' + INK3 +
            ';">' + esc(mine) + ' ' + esc(other) + ' ' + esc(empty) + '</p>' +
            '<p style="margin:0;font-size:0.83rem;line-height:1.6;color:' + INK3 +
            ';">This is not a suspicion. The interval your answers imply is now empty, and an ' +
            'empty interval means there is no number at all &mdash; not a clever one, not an ' +
            'unlucky one &mdash; that would have produced this sequence of answers. It adds ' +
            'two to your score, and on this board a lower score is the better one.</p>';
        }
        logLine('#' + r.used + '  ' + pad(fmt(gv), 9) + 'contradiction', BAD);
        say('Contradiction. ' + mine + ' ' + other);
        S.rounds.push({
          kind: 'answer', used: r.used, par: S.par, over: 0,
          note: 'contradicted itself at guess ' + r.used
        });
        showNext('Caught.', mine + ' ' + other + ' ' + empty);
      }

      function adversaryNote() {
        if (!D.alert) return;
        D.alert.hidden = false;
        D.alert.setAttribute('style', S_PANEL + 'border-color:' + WARN + ';');
        D.alert.innerHTML =
          '<p style="margin:0 0 0.4rem;font-size:0.95rem;color:' + WARN +
          ';">Every answer so far has kept the larger half.</p>' +
          '<p style="margin:0 0 0.4rem;font-size:0.83rem;line-height:1.6;color:' + INK3 +
          ';">That is consistent with having a number, and it is also exactly what somebody ' +
          'with no number at all would do. I cannot tell the two apart and I am not going to ' +
          'pretend I can — nothing you have said is false yet.</p>' +
          '<p style="margin:0;font-size:0.83rem;line-height:1.6;color:' + INK3 +
          ';">It is worth doing on purpose, though. Answering to keep the interval as large as ' +
          'every answer allows is the adversary argument, and it is how the lower bound is ' +
          'proved: even against an opponent deciding as late as possible, ' + S.par +
          ' questions are enough, and against this strategy it takes every one of them. ' +
          'Play it out and watch the count land on ' + S.par + ' exactly.</p>';
        say('Every answer so far has kept the larger half. That is the adversary strategy.');
      }

      function finishAnswer(found) {
        var r = S.r;
        var head = 'Found in ' + r.used + (r.used === 1 ? ' guess.' : ' guesses.');
        var body;
        /* The adversary line has to check the COUNT as well as the answers.
           Two maximal answers followed by "that is it" is still every answer
           kept large, and it finished in three — saying it landed on par
           there would be a sentence contradicted by the number beside it. */
        if (r.allMaximal && r.answered >= 2 && r.used === S.par) {
          body = 'You kept the larger half every single time, so it took exactly par — ' +
            S.par + '. That is the adversary strategy and it is the proof that no search ' +
            'can promise better: whatever I had asked, an answer existed that left me ' +
            'this much work.';
        } else if (r.used < S.par) {
          body = 'Under par, because ' + fmt(found) + ' happened to sit where the search ' +
            'looks early. Par is the worst case, not the average.';
        } else {
          body = 'Par is ' + S.par + ' for ' + fmt(S.n) + ' candidates, and halving cannot ' +
            'be beaten in the worst case however the answers fall.';
        }
        S.rounds.push({
          kind: 'answer', used: r.used, par: S.par, over: 0,
          note: (r.allMaximal && r.answered >= 2 && r.used === S.par)
            ? 'played the adversary, landed on par'
            : 'answered consistently'
        });
        say(head + ' ' + body);
        showNext(head, body);
        hud();
      }

      function showNext(head, body) {
        if (D.answers) {
          var btns = D.answers.querySelectorAll('[data-ans]');
          for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
        }
        if (!D.after) return;
        D.after.hidden = false;
        D.after.innerHTML =
          '<p style="margin:0 0 0.4rem;font-size:0.92rem;color:' + INK + ';">' + esc(head) +
          '</p><p style="margin:0 0 0.7rem;font-size:0.82rem;line-height:1.6;color:' + INK3 +
          ';">' + esc(body) + '</p>' +
          '<button class="btn btn-primary" type="button" data-next>Next round</button>';
        var btn = D.after.querySelector('[data-next]');
        btn.addEventListener('click', nextRound);
        try { btn.focus({ preventScroll: true }); } catch (err) { btn.focus(); }
      }

      /* ==============================================================
         Rounds and the report.
         ============================================================== */
      function startRound() {
        var kind = ROUNDS[S.at];
        S.r = {
          kind: kind,
          lo: 1, hi: S.n,
          used: 0, answered: 0,
          marker: midOf(1, S.n),
          guess: 0,
          history: [],
          loSrc: null, hiSrc: null,
          allMaximal: true, warned: false,
          done: false, caught: false
        };
        if (kind === 'search') {
          S.secret = 1 + g.rnd(S.n);
          buildSearch();
        } else {
          buildAnswer();
        }
        hud();
      }

      function nextRound() {
        S.at++;
        if (S.at >= ROUNDS.length) {
          var score = 1 + S.over + 2 * S.cheats;
          g.over({
            won: S.cheats === 0,
            score: score,
            title: S.cheats ? 'Duel over, with a contradiction' : 'Duel over',
            message: S.used + ' guesses of your own against a par of ' + (S.par * 2) + '.'
          });
          return;
        }
        startRound();
      }

      function report(final, isBest) {
        var rows = '';
        for (var i = 0; i < S.rounds.length; i++) {
          var r = S.rounds[i];
          rows += '<li style="' + S_LI + '">' +
            pad('Round ' + (i + 1), 10) +
            pad(r.kind === 'search' ? 'you searched' : 'you answered', 15) +
            pad(r.used + ' of ' + r.par, 10) + esc(r.note) + '</li>';
        }
        host.innerHTML =
          '<p style="' + S_EYE + '">The duel &middot; ' + fmt(S.n) + ' candidates a round</p>' +
          '<h3 style="margin:0 0 0.15rem;font-size:1.35rem;color:' + INK + ';">' +
          (final <= 1 ? 'Par' : '+' + (final - 1) + ' over par') +
          (isBest ? ' <span style="font-size:0.72rem;color:' + GOOD +
            ';">&mdash; best on this device</span>' : '') + '</h3>' +
          '<p style="margin:0 0 0.9rem;font-size:0.84rem;line-height:1.6;color:' + INK3 + ';">' +
          'You spent ' + S.used + ' guesses on the two rounds you searched, where par is ' +
          (S.par * 2) + '. Across those guesses you threw away ' + two(S.wasted) +
          ' bits by guessing off centre, and I caught ' + S.cheats + ' contradiction' +
          (S.cheats === 1 ? '' : 's') + ' in the rounds you answered.</p>' +
          '<ul style="margin:0 0 0.9rem;padding:0;list-style:none;">' + rows + '</ul>' +
          '<div style="' + S_PANEL + 'margin-top:0;">' +
          '<p style="margin:0 0 0.5rem;font-size:0.83rem;line-height:1.6;color:' + INK3 + ';">' +
          'Par here is ' + S.par + ' because ' + S.par + ' yes-or-no answers can separate at ' +
          'most 2^' + S.par + ' &minus; 1 = ' + fmt(Math.pow(2, S.par) - 1) + ' values, and ' +
          fmt(S.n) + ' is more than 2^' + (S.par - 1) + ' &minus; 1 = ' +
          fmt(Math.pow(2, S.par - 1) - 1) + '. Every guess that is not the midpoint splits ' +
          'the survivors unevenly, so its worst case is bigger than it needed to be, and the ' +
          'shortfall is a fraction of a bit you cannot get back later.</p>' +
          '<p style="margin:0;font-size:0.83rem;line-height:1.6;color:' + INK3 + ';">' +
          'The same argument is what makes log n the floor for comparison search, and the ' +
          'same shape of counting makes n log n the floor for comparison sorting. There is ' +
          'more of it in <a href="/labs/big-o">the big-O playground</a>, and the searches ' +
          'and sorts themselves run step by step in the ' +
          '<a href="/labs/algorithm-visualizer">algorithm visualiser</a>.</p></div>' +
          '<div style="margin-top:1rem;display:flex;gap:0.6rem;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" type="button" data-again>Play again</button>' +
          '<button class="game-btn" type="button" data-trap>Show me the off-by-one trap</button>' +
          '</div>';
        var again = host.querySelector('[data-again]');
        again.addEventListener('click', function () { g.start(); });
        host.querySelector('[data-trap]').addEventListener('click', function () {
          if (modeSel) { modeSel.value = 'trap'; g.save('mode', 'trap'); }
          g.start();
        });
        try { again.focus({ preventScroll: true }); } catch (err) { again.focus(); }
      }

      /* ==============================================================
         THE OFF-BY-ONE TRAP.
         ============================================================== */
      var trap = { arr: 'small', mid: 'safe', loop: 'A', target: 15, huge: 'end', cursor: 15 };

      var LOOPS = {
        A: {
          label: 'while (lo &lt;= hi), hi = mid &minus; 1',
          note: 'The correct shape. The interval always shrinks, and the last surviving ' +
            'element is still tested because the condition allows lo to equal hi.'
        },
        B: {
          label: 'while (lo &lt; hi), hi = mid, lo = mid',
          note: 'Never terminates on some inputs. Once hi is lo + 1 the midpoint IS lo, so ' +
            'assigning lo = mid changes nothing and the next iteration is identical to this ' +
            'one. Nothing crashes and nothing is wrong on screen; the tab simply stops.'
        },
        C: {
          label: 'while (lo &lt; hi), hi = mid &minus; 1',
          note: 'Terminates, and misses. The loop stops the moment lo reaches hi, so the ' +
            'one element still alive is never compared. It answers "not found" for values ' +
            'that are sitting in the array.'
        }
      };

      function trapRun(useNaive, loopKind, small, targetIdx) {
        var len = small ? SMALL.length : HUGE_LEN;
        var target = small ? SMALL[targetIdx] : targetIdx;
        var lo = 0, hi = len - 1;
        var steps = [];
        var out = { steps: steps, outcome: 'exit', index: -1, lo: lo, hi: hi };
        var guard = 0;
        while (guard < 120) {
          guard++;
          var alive = loopKind === 'A' ? (lo <= hi) : (lo < hi);
          if (!alive) { out.outcome = 'exit'; break; }
          var sum = lo + hi;
          /* A bitwise OR with zero is a signed 32-bit truncation, which is
             what a Java or C int does to this addition on its own. See
             decision 4: JavaScript would not have overflowed here. */
          var wrapped = sum | 0;
          var m = useNaive ? trunc(wrapped / 2) : lo + Math.floor((hi - lo) / 2);
          var step = { i: steps.length + 1, lo: lo, hi: hi, sum: sum, wrapped: wrapped, mid: m };
          if (m < 0 || m >= len) {
            step.note = 'index out of range';
            steps.push(step);
            out.outcome = 'crash';
            break;
          }
          var v = small ? SMALL[m] : m;
          step.value = v;
          if (v === target) {
            step.note = 'hit';
            steps.push(step);
            out.outcome = 'found';
            out.index = m;
            break;
          }
          if (v < target) {
            step.note = 'too small, look right';
            lo = loopKind === 'B' ? m : m + 1;
          } else {
            step.note = 'too big, look left';
            hi = loopKind === 'B' ? m : m - 1;
          }
          steps.push(step);
          /* No bound moved, so the next iteration is this iteration. That is
             not "probably an infinite loop", it is one. */
          if (lo === step.lo && hi === step.hi) { out.outcome = 'stuck'; break; }
        }
        if (guard >= 120 && out.outcome === 'exit') out.outcome = 'stuck';
        out.lo = lo;
        out.hi = hi;
        return out;
      }

      function buildTrap() {
        D = {};
        host.innerHTML =
          '<p style="' + S_EYE + '">The off-by-one trap</p>' +
          '<h3 style="' + S_HEAD + '">The same search, and three ways to get it wrong.</h3>' +
          '<p style="' + S_BRIEF + '">Nothing is scored here. Change the midpoint, change the ' +
          'loop, change which value you are looking for, and the trace underneath is the run ' +
          'that configuration actually performs &mdash; one that overflows, one that never ' +
          'ends, and one that walks straight past the answer.</p>' +
          '<div data-groups></div>' +
          '<div data-cells style="margin:0.8rem 0 0.4rem;"></div>' +
          '<p data-verdict role="status" aria-live="polite" style="' + S_LIVE + '"></p>' +
          '<pre data-trace style="margin:0.4rem 0 0;padding:0.7rem 0.8rem;border-radius:10px;' +
          'background:' + SHEET + ';border:1px solid ' + LINE + ';overflow:auto;max-height:15rem;' +
          'font-family:' + MONO + ';font-size:0.72rem;line-height:1.55;color:' + INK3 +
          ';white-space:pre;"></pre>' +
          '<div data-note style="' + S_PANEL + '"></div>';

        D.groups = q('[data-groups]');
        D.cells = q('[data-cells]');
        D.verdict = q('[data-verdict]');
        D.trace = q('[data-trace]');
        D.note = q('[data-note]');

        renderTrapControls();
        runTrap();
        handBack();
      }

      function optionRow(label, name, opts) {
        var html = '<div style="margin:0 0 0.55rem;">' +
          '<p style="margin:0 0 0.28rem;font-size:0.7rem;letter-spacing:0.05em;' +
          'text-transform:uppercase;color:' + INK4 + ';" id="bsd-lab-' + name + '">' +
          label + '</p>' +
          '<div role="group" aria-labelledby="bsd-lab-' + name + '" ' +
          'style="display:flex;gap:0.4rem;flex-wrap:wrap;">';
        for (var i = 0; i < opts.length; i++) {
          var on = opts[i].on;
          html += '<button class="game-btn" type="button" data-opt="' + name + '" ' +
            'data-value="' + opts[i].value + '" aria-pressed="' + (on ? 'true' : 'false') + '" ' +
            'style="font-family:' + MONO + ';font-size:0.72rem;' +
            (on ? 'border-color:' + ACCENT + ';color:' + INK + ';' : '') + '">' +
            opts[i].label + '</button>';
        }
        return html + '</div></div>';
      }

      function renderTrapControls() {
        var html =
          optionRow('The array', 'arr', [
            { value: 'small', label: '16 elements', on: trap.arr === 'small' },
            { value: 'huge', label: '2,100,000,000 elements', on: trap.arr === 'huge' }
          ]) +
          optionRow('The midpoint', 'mid', [
            { value: 'safe', label: 'lo + (hi &minus; lo) / 2', on: trap.mid === 'safe' },
            { value: 'naive', label: '(lo + hi) / 2', on: trap.mid === 'naive' }
          ]) +
          optionRow('The loop', 'loop', [
            { value: 'A', label: LOOPS.A.label, on: trap.loop === 'A' },
            { value: 'B', label: LOOPS.B.label, on: trap.loop === 'B' },
            { value: 'C', label: LOOPS.C.label, on: trap.loop === 'C' }
          ]);
        if (trap.arr === 'huge') {
          html += optionRow('Looking for', 'huge', [
            { value: 'start', label: 'near the start', on: trap.huge === 'start' },
            { value: 'middle', label: 'in the middle', on: trap.huge === 'middle' },
            { value: 'end', label: 'near the end', on: trap.huge === 'end' }
          ]);
        }
        D.groups.innerHTML = html;
        var opts = D.groups.querySelectorAll('[data-opt]');
        for (var i = 0; i < opts.length; i++) {
          (function (b) {
            b.addEventListener('click', function () {
              var name = b.getAttribute('data-opt');
              var value = b.getAttribute('data-value');
              trap[name] = value;
              renderTrapControls();
              runTrap();
              /* Re-rendering has just removed the button that was clicked,
                 which drops focus to <body>. Put it back on the equivalent
                 button in the new markup, or a keyboard visitor is thrown to
                 the top of the tab order every time they change a setting. */
              var back = D.groups.querySelector('[data-opt="' + name +
                '"][data-value="' + value + '"]');
              if (!back) return;
              try { back.focus({ preventScroll: true }); } catch (err) { back.focus(); }
            });
          })(opts[i]);
        }
        renderCells();
      }

      /* The sixteen cells, each a real button and only one of them a tab
         stop — the same roving cursor Minesweeper uses, for the same reason:
         sixteen dead stops between the toolbar and the trace is sixteen too
         many. */
      function renderCells() {
        if (trap.arr !== 'small') {
          D.cells.innerHTML = '<p style="margin:0;font-size:0.78rem;line-height:1.6;color:' +
            INK4 + ';">The array is a[i] = i, two thousand one hundred million entries long. ' +
            'It is described rather than built: every probe is arithmetic, so nothing is ' +
            'allocated and nothing is slow.</p>';
          return;
        }
        var tally = { found: 0, stuck: 0, crash: 0, exit: 0 };
        var html = '<p style="margin:0 0 0.3rem;font-size:0.7rem;letter-spacing:0.05em;' +
          'text-transform:uppercase;color:' + INK4 + ';" id="bsd-lab-cells">' +
          'Looking for &mdash; pick a value</p>' +
          '<div role="group" aria-labelledby="bsd-lab-cells" data-cellrow ' +
          'style="display:flex;flex-wrap:wrap;gap:0.3rem;">';
        for (var i = 0; i < SMALL.length; i++) {
          var out = trapRun(trap.mid === 'naive', trap.loop, true, i);
          tally[out.outcome]++;
          var tone = out.outcome === 'found' ? GOOD
            : (out.outcome === 'stuck' ? BAD : (out.outcome === 'crash' ? BAD : WARN));
          var word = out.outcome === 'found' ? 'found'
            : (out.outcome === 'stuck' ? 'never finishes'
              : (out.outcome === 'crash' ? 'reads outside the array' : 'reported as missing'));
          html += '<button type="button" data-cell="' + i + '" ' +
            'tabindex="' + (i === trap.cursor ? '0' : '-1') + '" ' +
            'aria-pressed="' + (i === trap.target ? 'true' : 'false') + '" ' +
            'aria-label="' + SMALL[i] + ' at index ' + i + ', ' + word + '" ' +
            'style="min-width:2.9rem;padding:0.3rem 0.35rem;border-radius:7px;cursor:pointer;' +
            'font-family:' + MONO + ';font-size:0.72rem;line-height:1.2;color:' + tone + ';' +
            'background:' + (i === trap.target ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent') +
            ';border:1px solid ' + (i === trap.target ? ACCENT : LINE) + ';">' +
            SMALL[i] + '<br><span style="font-size:0.6rem;color:' + INK4 + ';">' + i + '</span>' +
            '</button>';
        }
        /* The tally is the whole argument for why these bugs ship. Loop B
           hangs on ONE of the sixteen; loop C misses eight. A test suite
           that happens to look for the value in the middle passes both. */
        var summary = 'Across all sixteen values, this configuration finds ' + tally.found +
          ', reports ' + tally.exit + ' as missing when they are there, reads outside the ' +
          'array on ' + tally.crash + ' and never finishes on ' + tally.stuck + '.';
        html += '</div><p style="margin:0.4rem 0 0;font-size:0.76rem;line-height:1.55;color:' +
          INK3 + ';">' + summary + '</p>' +
          '<p style="margin:0.25rem 0 0;font-size:0.72rem;line-height:1.5;color:' +
          INK4 + ';">Green means this configuration finds that value; amber means it reports ' +
          'it as missing although it is there; red means it crashes or never stops. The ' +
          'wording is on every cell as well, so the colour is never the only signal.</p>';
        D.cells.innerHTML = html;
        var cells = D.cells.querySelectorAll('[data-cell]');
        for (var c = 0; c < cells.length; c++) {
          (function (b) {
            b.addEventListener('click', function () {
              trap.target = Number(b.getAttribute('data-cell'));
              trap.cursor = trap.target;
              renderCells();
              runTrap();
              /* This handler has just replaced the button it is attached to,
                 so focus would otherwise fall to <body> and the next arrow
                 key would scroll the page instead of moving the cursor. */
              focusCell();
            });
          })(cells[c]);
        }
      }

      function focusCell() {
        if (!D.cells) return;
        var cell = D.cells.querySelector('[data-cell="' + trap.cursor + '"]');
        if (!cell) return;
        try { cell.focus({ preventScroll: true }); } catch (err) { cell.focus(); }
      }

      function traceText(out) {
        var lines = [];
        var i;
        for (i = 0; i < out.steps.length; i++) {
          var s = out.steps[i];
          var line = pad('#' + s.i, 5) + pad('lo=' + fmt(s.lo), 18) + pad('hi=' + fmt(s.hi), 18);
          if (trap.mid === 'naive') {
            /* The int32 column is emitted on every row, blank where the sum
               fitted. Printing it only on the row that wrapped shifted every
               column after it, and the one line the reader is meant to
               compare against the others was the line that did not line up. */
            line += pad('lo+hi=' + fmt(s.sum), 22) +
              pad(s.wrapped !== s.sum ? 'wraps to ' + fmt(s.wrapped) : '', 26);
          }
          line += pad('mid=' + fmt(s.mid), 18);
          if (s.value != null) line += pad('a[mid]=' + fmt(s.value), 20);
          line += s.note;
          lines.push(line);
        }
        if (!lines.length) lines.push('The loop condition was false before the first probe.');
        return lines.join('\n');
      }

      function runTrap() {
        var small = trap.arr === 'small';
        var idx = small ? trap.target : HUGE_TARGETS[trap.huge];
        var value = small ? SMALL[idx] : idx;
        var out = trapRun(trap.mid === 'naive', trap.loop, small, idx);
        D.trace.textContent = traceText(out);

        var verdict;
        if (out.outcome === 'found') {
          verdict = 'Found ' + fmt(value) + ' at index ' + fmt(out.index) + ' after ' +
            out.steps.length + ' probe' + (out.steps.length === 1 ? '' : 's') + '. Correct.';
        } else if (out.outcome === 'crash') {
          var last = out.steps[out.steps.length - 1];
          verdict = 'It computed a midpoint of ' + fmt(last.mid) + ', which is not an index ' +
            'into an array of ' + fmt(small ? SMALL.length : HUGE_LEN) + '. In Java that is an ' +
            'ArrayIndexOutOfBoundsException; in C it is a read of memory that is not yours ' +
            'and probably no error at all.';
        } else if (out.outcome === 'stuck') {
          verdict = 'It stopped making progress with lo = ' + fmt(out.lo) + ' and hi = ' +
            fmt(out.hi) + '. Neither bound moved, so the next iteration is identical to the ' +
            'last one: this loop never ends. Nothing throws and nothing prints — the tab hangs.';
        } else {
          verdict = 'It returned "not found" for ' + fmt(value) + ', which is at index ' +
            fmt(idx) + ' of the array. The loop stopped one element early and never compared ' +
            'the value that was still alive.';
        }
        D.verdict.textContent = verdict;
        say(verdict);

        var note = '<p style="margin:0 0 0.5rem;font-size:0.83rem;line-height:1.6;color:' +
          INK3 + ';"><strong style="color:' + INK + ';">The loop.</strong> ' +
          LOOPS[trap.loop].note + '</p>';
        if (trap.mid === 'naive') {
          note += '<p style="margin:0 0 0.5rem;font-size:0.83rem;line-height:1.6;color:' +
            INK3 + ';"><strong style="color:' + INK + ';">The midpoint.</strong> ' +
            '(lo + hi) / 2 overflows a signed 32-bit integer as soon as lo + hi passes ' +
            '2,147,483,647, and the sum then comes back negative. That is the bug Joshua ' +
            'Bloch wrote up in 2006 &mdash; it had been sitting in ' +
            'java.util.Arrays.binarySearch, and in most published binary searches, for ' +
            'about nine years. lo + (hi &minus; lo) / 2 computes the same midpoint from a ' +
            'difference that cannot overflow.</p>' +
            '<p style="margin:0 0 0.5rem;font-size:0.83rem;line-height:1.6;color:' + INK4 +
            ';">JavaScript numbers are doubles and would not have overflowed at all, so the ' +
            'sum above is pushed through a bitwise OR with zero, which truncates it to 32 ' +
            'signed bits exactly as a Java or C int does. The overflow here is simulated. ' +
            'The arithmetic is not.</p>';
        } else {
          note += '<p style="margin:0 0 0.5rem;font-size:0.83rem;line-height:1.6;color:' +
            INK3 + ';"><strong style="color:' + INK + ';">The midpoint.</strong> ' +
            'lo + (hi &minus; lo) / 2 never overflows, because hi &minus; lo is at most the ' +
            'length of the array. Switch to (lo + hi) / 2 and, on sixteen elements, ' +
            'absolutely nothing changes &mdash; which is precisely why the bug survived so ' +
            'long. Switch the array to two billion entries and look for something near the ' +
            'end, and it parts company on the second probe.</p>';
        }
        note += '<p style="margin:0;font-size:0.83rem;line-height:1.6;color:' + INK3 + ';">' +
          'The searches themselves, stepped through side by side, are in the ' +
          '<a href="/labs/algorithm-visualizer">algorithm visualiser</a>, and why log n is ' +
          'the floor rather than a convention is in <a href="/labs/big-o">the big-O ' +
          'playground</a>.</p>';
        D.note.innerHTML = note;

        g.stat('probes', String(out.steps.length));
        g.stat('alive', fmt(Math.max(0, out.hi - out.lo + 1)));
        g.stat('over', '—');
        g.stat('round', 'Trap');
      }

      /* ==============================================================
         Wiring.
         ============================================================== */
      if (modeSel) {
        modeSel.addEventListener('change', function () {
          g.save('mode', modeSel.value);
          g.start();
        });
      }
      if (rangeSel) {
        rangeSel.addEventListener('change', function () {
          g.save('range', rangeSel.value);
          g.announce('Range changed. Starting a new duel.');
          g.start();
        });
      }
      if (hintBtn) {
        hintBtn.addEventListener('click', function () {
          showMid = !showMid;
          hintBtn.setAttribute('aria-pressed', String(showMid));
          hintBtn.title = showMid
            ? 'The best next guess is shown under the bar'
            : 'The best next guess is hidden';
          g.save('mid', showMid ? 'on' : 'off');
          if (S && S.mode === 'duel' && S.r && S.r.kind === 'search' && !S.r.done) {
            showState(D.live ? D.live.textContent : '');
          }
        });
      }

      function begin() {
        var mode = modeSel ? modeSel.value : 'duel';
        var n = RANGES[rangeSel ? rangeSel.value : '100'] || 100;
        S = {
          mode: mode === 'trap' ? 'trap' : 'duel',
          n: n,
          par: parFor(n),
          at: 0,
          secret: 0,
          used: 0,
          over: 0,
          cheats: 0,
          wasted: 0,
          rounds: [],
          r: null
        };
        if (S.mode === 'trap') {
          buildTrap();
          return;
        }
        startRound();
      }

      return {
        ready: function () {
          /* The shell runs reset() while it is still building the instance
             and ready() afterwards, so a saved preference arrives one step
             too late: the board behind the Play screen has already been laid
             out from whatever the selects happened to default to. Restore,
             then lay it out again. */
          var moved = false;
          var m = g.load('mode', '');
          var rg = g.load('range', '');
          if (modeSel && (m === 'duel' || m === 'trap') && modeSel.value !== m) {
            modeSel.value = m;
            moved = true;
          }
          if (rangeSel && RANGES[rg] && rangeSel.value !== rg) {
            rangeSel.value = rg;
            moved = true;
          }
          if (hintBtn) {
            /* A restored preference has to count as a move too. Without this,
               somebody who had hidden the midpoint came back to a board that
               was already printing it, and the button beside it said off. */
            var wantMid = g.load('mid', 'on') !== 'off';
            if (wantMid !== showMid) { showMid = wantMid; moved = true; }
            hintBtn.setAttribute('aria-pressed', String(showMid));
            hintBtn.title = showMid
              ? 'The best next guess is shown under the bar'
              : 'The best next guess is hidden';
          }
          if (moved) begin();
        },

        reset: begin,

        key: function (name) {
          if (!S) return;

          if (S.mode === 'trap') {
            if (trap.arr !== 'small') return;
            if (name === 'left' || name === 'right') {
              trap.cursor = clamp(trap.cursor + (name === 'right' ? 1 : -1), 0, SMALL.length - 1);
              renderCells();
              focusCell();
              return;
            }
            if (name === 'action') {
              trap.target = trap.cursor;
              renderCells();
              runTrap();
              focusCell();
            }
            return;
          }

          var r = S.r;
          if (!r || r.done) return;

          if (r.kind === 'search') {
            var span = r.hi - r.lo + 1;
            var coarse = Math.max(1, Math.round(span / 10));
            if (name === 'left') setMarker(r.marker - 1);
            else if (name === 'right') setMarker(r.marker + 1);
            else if (name === 'down') setMarker(r.marker - coarse);
            else if (name === 'up') setMarker(r.marker + coarse);
            else if (name === 'action') commit();
            return;
          }

          /* Answering. The shell hands the arrows through from a focused
             button, so one path serves both the board and a thumb already
             resting on an answer. Space and Enter are NOT passed on from a
             button — they activate it — so 'action' here is only ever the
             board-focused case, and it means the guess was right. */
          if (name === 'left') answer('lower');
          else if (name === 'right') answer('higher');
          else if (name === 'action') answer('correct');
        },

        ended: function (final, isBest) {
          /* The shell has just put its game-over card over the board. The
             report is a table, three paragraphs and two links; it does not
             fit in a 26rem card and must not be hidden behind one. */
          g.hideOverlay();
          report(final, isBest);
        }
      };
    }
  });
})();

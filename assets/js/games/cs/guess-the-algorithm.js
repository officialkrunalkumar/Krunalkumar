/* ==========================================================================
   guess-the-algorithm.js — watch a sort run, name it before it finishes.
   --------------------------------------------------------------------------
   RECORD FIRST, REPLAY AFTER. The obvious way to animate a sort is to write
   it as a coroutine and yield a frame at every comparison. ES5 has no
   generators, and a recursive sort cannot be suspended halfway down its own
   call stack by any other means — you would have to rewrite merge sort and
   quicksort as explicit-stack machines, at which point they no longer look
   like the algorithms they are meant to teach. So each sort here runs to
   completion the moment a round starts, against a Rec object that logs every
   comparison, swap and write. The animation then replays that log against a
   fresh copy of the array. The sorts stay textbook; the player sees the same
   events, in order, at whatever rate the clock asks for.

   EVERY RUN LASTS THE SAME TWELVE SECONDS, whatever it costs. Bubble sort
   logs about four hundred operations on twenty-four bars and quicksort about
   a hundred and thirty, so replaying at a fixed operations-per-second would
   make the running time itself the answer — the quadratic sorts would grind
   for twelve seconds and the O(n log n) ones would be over in four. The log
   is stretched to fit a fixed duration instead, which also makes the score
   honest: points fall with the fraction of the run elapsed, and that
   fraction means the same thing for all six. The pace of change still
   differs, and that is left alone — it is real information about the cost,
   not an artefact of the presentation.

   For the same reason there are no pivot markers, no recursion bands and no
   green "this part is finished" shading. All six get exactly one visual
   vocabulary — bars, plus a highlight on whichever two the algorithm is
   touching — so the only thing left to recognise is the movement pattern,
   which is the thing worth recognising.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 400;
  var N = 24;          // bars; enough for the patterns to read, few enough to see
  var ROUNDS = 5;
  var RUN = 12;        // seconds of animation per round, identical for all six

  /* ------------------------------------------------------------------
     The recorder. `a` is a working copy the sort mutates as usual; `ops`
     is the log the animation replays.
     ------------------------------------------------------------------ */
  function Rec(values) {
    this.a = values.slice();
    this.ops = [];
  }

  Rec.prototype.cmp = function (i, j) {
    this.ops.push({ k: 'c', i: i, j: j });
  };

  Rec.prototype.swap = function (i, j) {
    var t = this.a[i]; this.a[i] = this.a[j]; this.a[j] = t;
    this.ops.push({ k: 's', i: i, j: j });
  };

  Rec.prototype.write = function (i, v) {
    this.a[i] = v;
    this.ops.push({ k: 'w', i: i, v: v });
  };

  /* Replay side: only swaps and writes change the array. A comparison is
     drawn and then forgotten. */
  function apply(arr, op) {
    if (op.k === 's') { var t = arr[op.i]; arr[op.i] = arr[op.j]; arr[op.j] = t; }
    else if (op.k === 'w') { arr[op.i] = op.v; }
  }

  /* ------------------------------------------------------------------
     The six sorts, written the way they are written in a textbook.
     ------------------------------------------------------------------ */
  function msort(r, lo, hi) {
    if (hi - lo < 2) return;
    var mid = (lo + hi) >> 1;
    msort(r, lo, mid);
    msort(r, mid, hi);
    /* Gathered into a buffer first, then written back. Reading and writing
       the same range in one pass would log writes that later reads depend
       on, and the replay would drift from the real sort. */
    var buf = [];
    var i = lo, j = mid, k;
    while (i < mid && j < hi) {
      r.cmp(i, j);
      if (r.a[i] <= r.a[j]) { buf.push(r.a[i]); i++; }
      else { buf.push(r.a[j]); j++; }
    }
    while (i < mid) { buf.push(r.a[i]); i++; }
    while (j < hi) { buf.push(r.a[j]); j++; }
    for (k = 0; k < buf.length; k++) r.write(lo + k, buf[k]);
  }

  function qsort(r, lo, hi) {
    if (lo >= hi) return;
    var pivot = r.a[hi];
    var store = lo;
    for (var j = lo; j < hi; j++) {
      r.cmp(j, hi);
      if (r.a[j] < pivot) {
        if (store !== j) r.swap(store, j);
        store++;
      }
    }
    if (store !== hi) r.swap(store, hi);
    qsort(r, lo, store - 1);
    qsort(r, store + 1, hi);
  }

  function sift(r, root, len) {
    while (true) {
      var big = root;
      var l = root * 2 + 1;
      var rt = root * 2 + 2;
      if (l < len) { r.cmp(l, big); if (r.a[l] > r.a[big]) big = l; }
      if (rt < len) { r.cmp(rt, big); if (r.a[rt] > r.a[big]) big = rt; }
      if (big === root) return;
      r.swap(root, big);
      root = big;
    }
  }

  var ALGOS = [
    {
      id: 'bubble',
      name: 'Bubble sort',
      run: function (r) {
        var n = r.a.length;
        for (var i = 0; i < n - 1; i++) {
          var moved = false;
          for (var j = 0; j < n - 1 - i; j++) {
            r.cmp(j, j + 1);
            if (r.a[j] > r.a[j + 1]) { r.swap(j, j + 1); moved = true; }
          }
          if (!moved) return;
        }
      },
      tell: 'Nothing ever moves more than one place at a time &mdash; every swap is between neighbours, so tall bars ' +
        'crawl rightwards a step per comparison instead of jumping. Each pass carries the largest remaining value all ' +
        'the way to the right-hand end and then restarts from the left, so the sorted region grows from the right and ' +
        'the scan gets visibly shorter each time round.'
    },
    {
      id: 'selection',
      name: 'Selection sort',
      run: function (r) {
        var n = r.a.length;
        for (var i = 0; i < n - 1; i++) {
          var m = i;
          for (var j = i + 1; j < n; j++) {
            r.cmp(m, j);
            if (r.a[j] < r.a[m]) m = j;
          }
          if (m !== i) r.swap(i, m);
        }
      },
      tell: 'The picture is almost still. A highlight sweeps the entire unsorted region looking for the smallest ' +
        'value, nothing moves while it does, and then exactly one long-distance swap plants that value at the left ' +
        'boundary. One swap per pass is the signature: no other sort here is that quiet between moves.'
    },
    {
      id: 'insertion',
      name: 'Insertion sort',
      run: function (r) {
        var n = r.a.length;
        for (var i = 1; i < n; i++) {
          var v = r.a[i];
          var j = i - 1;
          while (j >= 0) {
            r.cmp(j, j + 1);
            if (r.a[j] > v) { r.write(j + 1, r.a[j]); j--; }
            else break;
          }
          r.write(j + 1, v);
        }
      },
      tell: 'A sorted block grows from the left one bar at a time, and the right-hand side sits in its original ' +
        'order, completely untouched, until the boundary reaches it. Each new value ripples backwards through the ' +
        'sorted block in a run of adjacent shifts and stops the moment it fits. Bubble sort also moves things one ' +
        'place at a time, but it disturbs the whole array on every pass; this one only ever disturbs the left.'
    },
    {
      id: 'merge',
      name: 'Merge sort',
      run: function (r) { msort(r, 0, r.a.length); },
      tell: 'Values are overwritten rather than swapped, so bars change height in place instead of trading positions. ' +
        'Watch a stretch of the array get rewritten left to right as one clean ascending run, then a stretch twice as ' +
        'wide, then twice again. Nothing is in its final position until the last merge sweeps the whole array &mdash; ' +
        'right up to the end you are looking at two sorted halves and no sorted whole.'
    },
    {
      id: 'quick',
      name: 'Quicksort',
      run: function (r) { qsort(r, 0, r.a.length - 1); },
      tell: 'A scan runs left to right across one window, and every so often a bar makes a single long jump across ' +
        'it &mdash; that is a value being thrown to the correct side of the pivot. When the scan reaches the end, one ' +
        'bar lands in its final position for good and the window splits into two smaller windows that get worked ' +
        'separately. Activity that keeps narrowing and then leaps somewhere else entirely is the tell.'
    },
    {
      id: 'heap',
      name: 'Heapsort',
      run: function (r) {
        var n = r.a.length;
        for (var i = (n >> 1) - 1; i >= 0; i--) sift(r, i, n);
        for (var e = n - 1; e > 0; e--) {
          r.swap(0, e);
          sift(r, 0, e);
        }
      },
      tell: 'The first stretch looks like vandalism: a lot of swapping that leaves the array less ordered than it ' +
        'started, because it is building a heap, not sorting. After that the pattern is unmistakable &mdash; the ' +
        'leftmost bar swaps straight to the right-hand end, and a value tumbles down from position one in a chain of ' +
        'swaps at doubling distances. Sorted grows from the right as in bubble sort, but the left stays jumbled ' +
        'instead of getting gradually tidier.'
    }
  ];

  function byId(id) {
    for (var i = 0; i < ALGOS.length; i++) if (ALGOS[i].id === id) return ALGOS[i];
    return null;
  }

  GameShell.define({
    id: 'game-guess-the-algorithm',
    slug: 'guess-the-algorithm',
    title: 'Guess the algorithm',
    width: W,
    height: H,
    bestKey: 'guess-the-algorithm',
    formatBest: function (n) { return n + ' pts'; },
    tapAction: false,
    startTitle: 'Guess the algorithm',
    startText: 'A sort runs on twenty-four bars. Name it from the four buttons below before it finishes — the sooner you call it, the more it is worth.',

    setup: function (g) {
      var order = [];           // which algorithm each round uses
      var roundIdx = 0;
      var algo = ALGOS[0];
      var ops = [];
      var arr = [];
      var at = 0;               // ops applied so far
      var elapsed = 0;
      var progress = 0;
      var worth = 100;
      var phase = 'run';        // run | reveal
      var hot = null;           // the op being drawn
      var chosen = null;        // the id the player picked, null if they ran out of time
      var correct = false;
      var gained = 0;
      var tick = 0;             // rate limiter for the replay's clicking

      var optBtns = [];
      var optIds = [];
      var verdict = g.el ? g.el.querySelector('#algo-verdict') : null;
      var nextBtn = g.el ? g.el.querySelector('#algo-next') : null;

      for (var b = 0; b < 4; b++) {
        var btn = g.el ? g.el.querySelector('#algo-opt-' + b) : null;
        if (btn) optBtns.push(btn);
      }

      /* ---------------- round construction ---------------- */

      function fresh() {
        var v = [];
        for (var i = 1; i <= N; i++) v.push(i);
        g.shuffle(v);
        return v;
      }

      function pickOptions(answer) {
        var pool = [];
        for (var i = 0; i < ALGOS.length; i++) {
          if (ALGOS[i].id !== answer) pool.push(ALGOS[i].id);
        }
        g.shuffle(pool);
        var out = [answer, pool[0], pool[1], pool[2]];
        g.shuffle(out);
        return out;
      }

      function buildRound() {
        algo = ALGOS[order[roundIdx]];
        var values = fresh();
        var rec = new Rec(values);
        algo.run(rec);
        ops = rec.ops;
        arr = values.slice();
        at = 0;
        elapsed = 0;
        progress = 0;
        worth = 100;
        hot = null;
        chosen = null;
        correct = false;
        gained = 0;
        phase = 'run';
        optIds = pickOptions(algo.id);

        for (var i = 0; i < optBtns.length; i++) {
          optBtns[i].textContent = byId(optIds[i]).name;
          optBtns[i].className = 'game-btn algo-opt';
          /* Live only during a run: before the Play overlay is dismissed
             there is nothing to name yet, and after an answer the round is
             settled. A dead-looking button is better than one that ignores
             you. */
          optBtns[i].disabled = g.state !== 'playing';
        }
        if (verdict) {
          verdict.className = 'algo-verdict';
          verdict.innerHTML = g.state === 'playing'
            ? 'Watching&hellip; call it as soon as you recognise the pattern.'
            : 'Press Play, then name the sort before the bars finish.';
        }
        if (nextBtn) nextBtn.hidden = true;

        g.stat('round', (roundIdx + 1) + '/' + ROUNDS);
        g.stat('worth', g.state === 'playing' ? worth : '—');
      }

      /* ---------------- answering ---------------- */

      function settle() {
        phase = 'reveal';
        for (var i = 0; i < optBtns.length; i++) {
          optBtns[i].disabled = true;
          if (optIds[i] === algo.id) optBtns[i].className = 'game-btn algo-opt is-right';
          else if (optIds[i] === chosen) optBtns[i].className = 'game-btn algo-opt is-wrong';
        }
        g.stat('worth', '—');

        if (verdict) {
          var head = correct ? 'Correct &mdash; ' : (chosen ? 'Not quite &mdash; ' : 'Out of time &mdash; ');
          verdict.className = 'algo-verdict ' + (correct ? 'is-right' : 'is-wrong');
          verdict.innerHTML =
            '<span class="algo-call">' + head + 'that was <strong>' + algo.name + '</strong>' +
            (gained ? ', worth ' + gained + ' points at that moment.' : '.') + '</span>' +
            '<span class="algo-why">' + algo.tell + '</span>';
        }
        if (nextBtn) {
          nextBtn.hidden = false;
          nextBtn.textContent = roundIdx + 1 >= ROUNDS ? 'See your score' : 'Next round';
          try { nextBtn.focus({ preventScroll: true }); } catch (e) { nextBtn.focus(); }
        }
      }

      function answer(id) {
        if (g.state !== 'playing' || phase !== 'run') return;
        chosen = id;
        correct = id === algo.id;
        /* Points are the share of the run you did not need. Five is the
           floor, so calling it on the last frame still beats saying nothing
           — but only just. */
        gained = correct ? Math.max(5, Math.round(100 * (1 - progress))) : 0;
        if (gained) g.addScore(gained);
        if (correct) g.beep(720, 0.07, 'sine');
        else g.beep(190, 0.1, 'square');
        settle();
      }

      function timeUp() {
        chosen = null;
        correct = false;
        gained = 0;
        g.beep(160, 0.12, 'square');
        settle();
      }

      function advance() {
        if (roundIdx + 1 >= ROUNDS) {
          var pct = Math.round((g.score / (ROUNDS * 100)) * 100);
          g.over({
            won: g.score >= ROUNDS * 40,
            score: g.score,
            title: g.score + ' out of ' + (ROUNDS * 100),
            message: pct >= 75 ? 'You are reading the movement rather than waiting for the shape to settle, which is the whole skill.'
                   : pct >= 40 ? 'Sound. The points are in the first few seconds — the giveaways are all in how things move, not where they end up.'
                   : 'Worth another go. Start by asking one question: are values being swapped, or overwritten?'
          });
          return;
        }
        roundIdx++;
        buildRound();
      }

      /* ---------------- wiring ---------------- */

      function focusOption(delta) {
        if (!optBtns.length) return;
        var idx = -1;
        for (var i = 0; i < optBtns.length; i++) {
          if (optBtns[i] === document.activeElement) idx = i;
        }
        idx = idx < 0 ? 0 : (idx + delta + optBtns.length) % optBtns.length;
        try { optBtns[idx].focus({ preventScroll: true }); } catch (e) { optBtns[idx].focus(); }
      }

      for (var w = 0; w < optBtns.length; w++) {
        (function (node, pos) {
          node.addEventListener('click', function () { answer(optIds[pos]); });
          node.addEventListener('keydown', function (event) {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); focusOption(1); }
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); focusOption(-1); }
          });
        })(optBtns[w], w);
      }

      if (nextBtn) nextBtn.addEventListener('click', function () { advance(); });

      /* ---------------- drawing ---------------- */

      var TOP = 58;
      var BOTTOM = H - 24;
      var PADX = 18;

      function colourFor(i) {
        if (hot && (i === hot.i || i === hot.j)) return hot.k === 'c' ? '#fbbf24' : '#fb923c';
        return '#4f7099';
      }

      return {
        reset: function () {
          order = [];
          for (var i = 0; i < ALGOS.length; i++) order.push(i);
          g.shuffle(order);
          order = order.slice(0, ROUNDS);
          roundIdx = 0;
          tick = 0;
          g.setScore(0);
          buildRound();
        },

        key: function (name) {
          /* The shell focuses the canvas when a run starts, so the arrows
             are the bridge from the playfield to the four names. Once focus
             is on a button its own handler takes over. */
          if (name === 'left' || name === 'up') focusOption(-1);
          else if (name === 'right' || name === 'down') focusOption(1);
        },

        update: function (dt) {
          if (phase !== 'run') return;
          elapsed += dt;
          progress = elapsed / RUN;
          if (progress > 1) progress = 1;

          var target = Math.floor(progress * ops.length);
          if (tick > 0) tick -= dt;
          while (at < target) {
            var op = ops[at];
            apply(arr, op);
            hot = op;
            at++;
            if (op.k !== 'c' && tick <= 0) {
              /* Pitched to the value that moved, so the replay sounds like
                 the array rather than like a metronome. Rate limited: at
                 forty operations a second the raw stream is a buzz. */
              g.beep(180 + arr[op.i] * 22, 0.02, 'sine', 0.025);
              tick = 0.07;
            }
          }

          worth = Math.max(5, Math.round(100 * (1 - progress)));
          g.stat('worth', worth);

          if (progress >= 1 && at >= ops.length) timeUp();
        },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);

          var areaH = BOTTOM - TOP;
          var slot = (W - PADX * 2) / N;
          var bw = slot - 4;
          var i, h, x, y;

          for (i = 0; i < arr.length; i++) {
            h = Math.max(3, (arr[i] / N) * areaH);
            x = PADX + i * slot + 2;
            y = BOTTOM - h;
            ctx.fillStyle = colourFor(i);
            ctx.fillRect(x, y, bw, h);
            ctx.fillStyle = 'rgba(248,250,252,0.16)';
            ctx.fillRect(x, y, bw, 2);
          }

          ctx.fillStyle = 'rgba(148,163,184,0.28)';
          ctx.fillRect(PADX, BOTTOM, W - PADX * 2, 1);

          /* Header: which round, and what a correct call is worth right now. */
          ctx.textBaseline = 'middle';
          ctx.font = '13px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#94a3b8';
          ctx.fillText('Round ' + (roundIdx + 1) + ' of ' + ROUNDS, PADX, 20);
          ctx.textAlign = 'right';
          if (phase === 'run') {
            ctx.fillStyle = worth > 50 ? '#4ade80' : worth > 20 ? '#fbbf24' : '#f87171';
            ctx.fillText(worth + ' pts if you call it now', W - PADX, 20);
          } else {
            ctx.fillStyle = '#94a3b8';
            ctx.fillText('score ' + g.score, W - PADX, 20);
          }

          /* The time bar doubles as the score bar, because they are the
             same quantity from opposite ends. */
          ctx.fillStyle = 'rgba(148,163,184,0.16)';
          ctx.fillRect(PADX, 36, W - PADX * 2, 4);
          ctx.fillStyle = '#fb923c';
          ctx.fillRect(PADX, 36, (W - PADX * 2) * progress, 4);

          if (phase === 'reveal') {
            ctx.fillStyle = 'rgba(2,6,23,0.62)';
            ctx.fillRect(0, TOP - 10, W, BOTTOM - TOP + 22);
            ctx.textAlign = 'center';
            ctx.fillStyle = correct ? '#4ade80' : '#f87171';
            ctx.font = '14px "Cascadia Code", Consolas, monospace';
            ctx.fillText(correct ? 'Correct' : (chosen ? 'Not quite' : 'Out of time'), W / 2, TOP + 96);
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
            ctx.fillText(algo.name, W / 2, TOP + 134);
            ctx.fillStyle = '#94a3b8';
            ctx.font = '13px "Cascadia Code", Consolas, monospace';
            ctx.fillText(gained ? '+' + gained + ' points' : 'no points this round', W / 2, TOP + 168);
          }
        }
      };
    }
  });
})();

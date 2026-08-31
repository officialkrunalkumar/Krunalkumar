/* ==========================================================================
   big-o.js — measured complexity, not asserted complexity.
   --------------------------------------------------------------------------
   Every complexity table in every textbook is a claim. This lab checks the
   claim on the machine the visitor is holding: it runs each algorithm over a
   ladder of growing input sizes, times it with performance.now(), plots the
   measured points, fits candidate curves against them and says which class the
   data actually supports. Sometimes it disagrees with the table, and the
   disagreements are the most useful thing on the page.

   The insight the whole lab exists for is one line long: on log-log axes a
   power law n^p is a straight line whose SLOPE IS p. Linear is slope 1,
   quadratic is slope 2, and you can read the exponent off the picture with a
   ruler. An exponential is not straight there at all — it bends upward
   forever — but it is straight on log-time / linear-n axes, and its slope
   there is the growth base. Three axis modes, one lesson each.

   Measuring anything in a browser is a minefield, and pretending otherwise
   would make the numbers worse than useless. What this file does about it:

     1. JIT warm-up. The first few executions of a function run in the
        interpreter or a low tier; the optimiser only kicks in once it has seen
        the code run hot. So every cell runs WARMUP passes that are thrown
        away, and only then starts timing.

     2. Timer resolution. performance.now() is deliberately coarsened against
        timing side channels — 100 microseconds in some browsers, a full
        millisecond in others. Timing a 40-nanosecond array index against a
        100-microsecond clock measures the clock. So each cell first CALIBRATES
        an inner repeat count k such that the timed region lasts at least a
        couple of milliseconds, then divides by k. The measured resolution is
        printed on the page rather than assumed.

     3. GC pauses and a busy machine. A single sample can be three times the
        true cost because a collection landed inside it. Each cell is run
        several times and the MEDIAN is reported — not the mean, which one bad
        sample drags, and not the minimum, which quietly hides real allocation
        cost. The chart draws a whisker from the fastest to the slowest sample,
        so the noise is visible instead of averaged away.

     4. Dead code elimination. An optimiser that can prove a result is never
        used is entitled to delete the work. Every run returns a number, and
        every number is accumulated into a sink that is written into the DOM at
        the end. The accumulate happens inside the timed loop — it costs one
        addition per iteration, which is the price of measuring anything at all.

     5. Cache effects. Not a defect to be corrected: a genuinely O(1) array
        index gets slower as the array grows, because the probe stops fitting
        in L1 and then in L2. The lab shows that curve and names it, because
        "the memory hierarchy is a hidden log factor" is a real lesson that a
        complexity table cannot teach.

     6. Small n is dominated by constants. Fitting a curve through points where
        call overhead outweighs the work gives a confident wrong answer, so the
        fit drops the smallest sizes by default and the control that does it is
        on screen rather than buried here.

   Nothing blocks the page. The unit of work is ONE timed repetition, and every
   unit is scheduled as its own task, so between any two measurements the
   browser gets to paint, scroll and handle input. Runs pause when the tab goes
   into the background, because background tabs are throttled and a timing
   taken there is not comparable to one taken in the foreground.

   No network, no dependencies, no eval. Everything here is arithmetic, a
   canvas and some DOM.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ======================================================================== */
  /*  1. TIMING PRIMITIVES                                                    */
  /* ======================================================================== */

  var perf = (typeof performance !== 'undefined' && performance &&
              typeof performance.now === 'function') ? performance : null;

  /* Date.now has millisecond resolution at best, which makes the calibration
     below work much harder, but it keeps the lab honest on a browser without
     performance.now instead of silently reporting nonsense. */
  function now() { return perf ? perf.now() : Date.now(); }

  /* The smallest non-zero gap the clock will report, measured rather than
     assumed. Browsers clamp performance.now() against timing side channels and
     the clamp differs by browser, by version and by whether the page is
     cross-origin isolated, so there is no constant to hard-code here. */
  function timerResolution() {
    var best = Infinity, t0, t1, i, guard;
    for (i = 0; i < 12; i++) {
      t0 = now();
      guard = 0;
      do { t1 = now(); guard++; } while (t1 === t0 && guard < 400000);
      if (t1 > t0 && (t1 - t0) < best) best = t1 - t0;
    }
    return best === Infinity ? 1 : best;
  }

  /* The sink. Every algorithm returns a number and every number lands here, so
     no optimiser can prove the work is unobservable and delete it. It is read
     back out into a data attribute when a run finishes. */
  var sink = 0;

  /* ======================================================================== */
  /*  2. THE ALGORITHMS                                                       */
  /* ------------------------------------------------------------------------ */
  /*  Written the way a textbook writes them, not the way a library would.     */
  /*  A hand-rolled merge sort allocating two arrays per level is exactly what  */
  /*  is being measured — replacing it with something clever would measure the  */
  /*  cleverness instead of the class.                                         */
  /* ======================================================================== */

  /* xorshift32. A seeded generator, so the same size always gets the same data
     and two runs of the page are comparable with each other. */
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function randomArray(n, seed) {
    var rnd = makeRng(seed), a = new Array(n), i;
    for (i = 0; i < n; i++) a[i] = (rnd() * 1000000) | 0;
    return a;
  }

  function rampArray(n) {
    var a = new Array(n), i;
    for (i = 0; i < n; i++) a[i] = i * 2;
    return a;
  }

  function binarySearch(a, target) {
    var lo = 0, hi = a.length - 1, mid, v;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      v = a[mid];
      if (v === target) return mid;
      if (v < target) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  function linearScan(a) {
    var s = 0, m = -Infinity, i, n = a.length;
    for (i = 0; i < n; i++) { s += a[i]; if (a[i] > m) m = a[i]; }
    return s + m;
  }

  function mergeTwo(x, y) {
    var out = [], i = 0, j = 0, xn = x.length, yn = y.length;
    while (i < xn && j < yn) {
      if (x[i] <= y[j]) out.push(x[i++]); else out.push(y[j++]);
    }
    while (i < xn) out.push(x[i++]);
    while (j < yn) out.push(y[j++]);
    return out;
  }

  function mergeSort(a) {
    if (a.length < 2) return a;
    var mid = a.length >> 1;
    return mergeTwo(mergeSort(a.slice(0, mid)), mergeSort(a.slice(mid)));
  }

  function insertionSort(a) {
    var i, j, v, n = a.length;
    for (i = 1; i < n; i++) {
      v = a[i];
      j = i - 1;
      while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
      a[j + 1] = v;
    }
    return a;
  }

  function bubbleSort(a) {
    var n = a.length, i, j, t, swapped;
    for (i = 0; i < n - 1; i++) {
      swapped = false;
      for (j = 0; j < n - 1 - i; j++) {
        if (a[j] > a[j + 1]) { t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; swapped = true; }
      }
      if (!swapped) break;
    }
    return a;
  }

  function numericSort(a) { return a.sort(function (x, y) { return x - y; }); }

  function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

  /* Visit every subset of an n-element set once, doing a constant amount of
     work per subset. Reading all n members of each subset would be n*2^n, and
     the difference between those two matters, so this stays at the constant. */
  function subsetWalk(n) {
    var total = 1 << n, s = 0, m;
    for (m = 0; m < total; m++) s += (m & 1);
    return s;
  }

  function isSorted(a) {
    for (var i = 1; i < a.length; i++) if (a[i - 1] > a[i]) return false;
    return true;
  }

  var PROBES = 256;   // fixed operation count for the O(1) and O(log n) cells

  /* Each workload declares its own size ladder, because the sizes that make
     sense differ by six orders of magnitude between a linear scan and a naive
     Fibonacci. `mutates` decides whether the inner repeat count needs its own
     fresh copy per iteration; `race` marks the ones that take a plain array of
     n numbers and can therefore be run head to head on identical data. */
  var ALGOS = [
    {
      key: 'index', label: 'Array index', claim: 'O(1)', race: false, mutates: false,
      sizes: [1000, 4000, 16000, 64000, 256000, 1000000],
      xlabel: 'array length n',
      build: function (n) {
        var a = randomArray(n, 7), rnd = makeRng(n + 11), idx = new Array(PROBES), i;
        for (i = 0; i < PROBES; i++) idx[i] = (rnd() * n) | 0;
        return { a: a, idx: idx };
      },
      prep: function (fx) { return fx; },
      run: function (fx) {
        var a = fx.a, idx = fx.idx, s = 0, i;
        for (i = 0; i < PROBES; i++) s += a[idx[i]];
        return s;
      },
      note: 'Two hundred and fifty-six reads at random positions, whatever the array length. ' +
            'The operation count never changes, so a flat line is the right answer — and you ' +
            'will probably not get one. Past a few hundred thousand elements the probes stop ' +
            'fitting in cache and each one costs a trip to slower memory. That drift is not the ' +
            'algorithm; it is the memory hierarchy, and it is the reason O(1) does not mean fast.'
    },
    {
      key: 'binary', label: 'Binary search', claim: 'O(log n)', race: false, mutates: false,
      sizes: [1000, 4000, 16000, 64000, 256000, 1000000],
      xlabel: 'array length n',
      build: function (n) {
        var a = rampArray(n), rnd = makeRng(n + 29), t = new Array(PROBES), i;
        for (i = 0; i < PROBES; i++) t[i] = ((rnd() * n) | 0) * 2;
        return { a: a, t: t };
      },
      prep: function (fx) { return fx; },
      run: function (fx) {
        var a = fx.a, t = fx.t, s = 0, i;
        for (i = 0; i < PROBES; i++) s += binarySearch(a, t[i]);
        return s;
      },
      note: 'The same two hundred and fifty-six lookups, but each one halves the range it is ' +
            'searching. A thousand-fold increase in n adds about ten comparisons per lookup, ' +
            'which is why the curve is almost flat on linear axes and a gentle straight climb ' +
            'against log n. On log-log axes a logarithm is the one shape that is not a straight ' +
            'line but is very nearly one, which is a fair summary of how log n behaves in practice.'
    },
    {
      key: 'scan', label: 'Linear scan', claim: 'O(n)', race: true, mutates: false,
      sizes: [1000, 4000, 16000, 64000, 256000, 1000000],
      xlabel: 'array length n',
      build: function (n) { return randomArray(n, 13); },
      prep: function (fx) { return fx; },
      run: linearScan,
      note: 'One pass, summing and tracking the maximum. This is the cleanest slope-1 line on ' +
            'the page, and also the clearest demonstration of why the small sizes are dropped ' +
            'from the fit: at a thousand elements the whole array sits in L1 and the per-element ' +
            'cost is lower than it will ever be again, so the first points sit below the line and ' +
            'a fit that includes them reports something suspiciously sub-linear.'
    },
    {
      key: 'merge', label: 'Merge sort', claim: 'O(n log n)', race: true, mutates: false,
      sizes: [500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000],
      xlabel: 'array length n',
      build: function (n) { return randomArray(n, 101); },
      prep: function (fx) { return fx; },
      run: function (fx) { var out = mergeSort(fx); return out[0] + out[out.length - 1]; },
      note: 'Textbook top-down merge sort: split, sort both halves, merge. It allocates two new ' +
            'arrays at every level, which is a real cost and a real source of garbage — if you ' +
            'see one sample in a cell three times the others, you are probably looking at a ' +
            'collection. The median is what gets plotted, and the whisker shows you the outlier ' +
            'rather than hiding it.'
    },
    {
      key: 'native', label: 'Built-in sort', claim: 'O(n log n)', race: true, mutates: true,
      sizes: [500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000],
      xlabel: 'array length n',
      build: function (n) { return randomArray(n, 101); },
      prep: function (fx) { return fx.slice(); },
      run: function (a) { numericSort(a); return a[0] + a[a.length - 1]; },
      note: 'Array.prototype.sort with a numeric comparator — the engine’s own sort, written ' +
            'in C++ and tuned for years. That gap in absolute time is the constant factor, the ' +
            'thing big-O notation deliberately throws away, and the reason "same complexity" and ' +
            '"same speed" are different sentences. Expect the verdict to be equivocal here, and ' +
            'possibly to prefer O(n) outright: between five hundred and a hundred thousand ' +
            'elements the log factor only grows by about half, which is inside the noise of a ' +
            'sort this fast. That is a limit of what three decades of n can prove, not a defect ' +
            'in the sort.'
    },
    {
      key: 'insertion', label: 'Insertion sort', claim: 'O(n²)', race: true, mutates: true,
      sizes: [100, 200, 400, 800, 1600, 3200, 6400, 12800],
      xlabel: 'array length n',
      build: function (n) { return randomArray(n, 211); },
      prep: function (fx) { return fx.slice(); },
      run: function (a) { insertionSort(a); return a[0] + a[a.length - 1]; },
      note: 'Quadratic, and the fastest thing on this page for a small array. One tight loop, no ' +
            'allocation, no recursion, near-perfect locality. Race it against merge sort to see ' +
            'where that stops being true — the crossover is why real sort implementations switch ' +
            'to insertion sort below a threshold instead of recursing all the way down.'
    },
    {
      key: 'bubble', label: 'Bubble sort', claim: 'O(n²)', race: true, mutates: true,
      sizes: [100, 200, 400, 800, 1600, 3200, 6400],
      xlabel: 'array length n',
      build: function (n) { return randomArray(n, 211); },
      prep: function (fx) { return fx.slice(); },
      run: function (a) { bubbleSort(a); return a[0] + a[a.length - 1]; },
      note: 'The same quadratic class as insertion sort and reliably several times slower, ' +
            'because it moves an element one position per swap instead of shifting a run in ' +
            'place. Two algorithms can share a complexity class and still be worth choosing ' +
            'between; the log-log slopes will agree while the lines sit far apart.'
    },
    {
      key: 'fib', label: 'Naive recursive Fibonacci', claim: 'exponential', race: false, mutates: false,
      sizes: [14, 16, 18, 20, 22, 24, 26, 28, 30],
      xlabel: 'argument n',
      build: function (n) { return n; },
      prep: function (fx) { return fx; },
      run: fib,
      note: 'Usually written down as O(2ⁿ), and that is not quite right. The call tree makes ' +
            'about φⁿ calls, where φ is the golden ratio, 1.618. The exponential fit reports ' +
            'the base it measured rather than the base it expected, and it should land near 1.6 ' +
            'rather than 2. Note that n here is a number, not a collection size, so its ladder is ' +
            'small and additive where the others multiply.'
    },
    {
      key: 'subsets', label: 'Enumerate every subset', claim: 'O(2ⁿ)', race: false, mutates: false,
      sizes: [10, 12, 14, 16, 18, 20, 22],
      xlabel: 'set size n',
      build: function (n) { return n; },
      prep: function (fx) { return fx; },
      run: subsetWalk,
      note: 'A genuine 2ⁿ: one iteration per subset, constant work inside. Each step of two on ' +
            'the ladder should quadruple the time, and it does. This is the shape that makes ' +
            '"just throw more hardware at it" stop working — a machine a thousand times faster ' +
            'buys you ten more elements.'
    }
  ];

  function algoByKey(key) {
    for (var i = 0; i < ALGOS.length; i++) if (ALGOS[i].key === key) return ALGOS[i];
    return null;
  }

  /* Shared ladder for the head-to-head. It is dense through the region where
     the sorts trade places and stops well before bubble sort gets slow enough
     to be rude on a phone. */
  var RACE_SIZES = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128,
                    192, 256, 384, 512, 768, 1024, 1536, 2048];

  /* ======================================================================== */
  /*  3. CURVE FITTING                                                        */
  /* ------------------------------------------------------------------------ */
  /*  Fitting is done in LOG SPACE with a single scale parameter, never with    */
  /*  least squares on raw times. Two reasons, both load-bearing:               */
  /*                                                                           */
  /*    - raw least squares is dominated by the largest point. Over three       */
  /*      decades of time the biggest measurement is worth a million of the     */
  /*      smallest, so every model "fits" as long as it gets the last point     */
  /*      right, and the ranking becomes meaningless.                           */
  /*    - the question is about SHAPE, not units. In log space a candidate      */
  /*      curve fits when it is the right shape up to a constant factor, which  */
  /*      is exactly what a complexity class claims and all it claims.          */
  /*                                                                           */
  /*  The reported misfit is the RMS of the log residuals turned back into a    */
  /*  percentage: "typically within 4%" means the model tracks the measured     */
  /*  points to within about four percent across the whole fitted range.        */
  /* ======================================================================== */

  var MODELS = [
    { key: 'const', label: 'O(1)', f: function () { return 1; } },
    { key: 'log', label: 'O(log n)', f: function (n) { return Math.max(1e-9, Math.log(n)); } },
    { key: 'n', label: 'O(n)', f: function (n) { return n; } },
    { key: 'nlogn', label: 'O(n log n)', f: function (n) { return n * Math.max(1e-9, Math.log(n)); } },
    { key: 'n15', label: 'O(n^1.5)', f: function (n) { return Math.pow(n, 1.5); } },
    { key: 'n2', label: 'O(n²)', f: function (n) { return n * n; } },
    { key: 'n3', label: 'O(n³)', f: function (n) { return n * n * n; } }
  ];

  function mean(list) {
    var s = 0, i;
    for (i = 0; i < list.length; i++) s += list[i];
    return list.length ? s / list.length : 0;
  }

  function rmsAbout(list, centre) {
    var s = 0, i, d;
    for (i = 0; i < list.length; i++) { d = list[i] - centre; s += d * d; }
    return list.length ? Math.sqrt(s / list.length) : 0;
  }

  /* Ordinary least squares of y on x. Returns slope and intercept. */
  function ols(xs, ys) {
    var n = xs.length, mx = mean(xs), my = mean(ys), num = 0, den = 0, i, dx;
    for (i = 0; i < n; i++) {
      dx = xs[i] - mx;
      num += dx * (ys[i] - my);
      den += dx * dx;
    }
    var slope = den === 0 ? 0 : num / den;
    return { slope: slope, intercept: my - slope * mx };
  }

  /* Free power-law fit: t = a * n^p, fitted as ln t = ln a + p ln n. `p` is
     precisely the slope of the points on log-log axes, which is the number the
     whole page is built around. */
  function powerFit(points) {
    var xs = [], ys = [], i;
    for (i = 0; i < points.length; i++) {
      if (points[i].t > 0 && points[i].n > 0) {
        xs.push(Math.log(points[i].n));
        ys.push(Math.log(points[i].t));
      }
    }
    if (xs.length < 2) return null;
    var fitLine = ols(xs, ys), resid = [], k;
    for (k = 0; k < xs.length; k++) resid.push(ys[k] - (fitLine.intercept + fitLine.slope * xs[k]));
    return {
      p: fitLine.slope,
      a: Math.exp(fitLine.intercept),
      rms: rmsAbout(resid, 0)
    };
  }

  /* Exponential fit: t = a * b^n, fitted as ln t = ln a + n ln b. Straight on
     log-time / linear-n axes, which is the third axis mode. */
  function expFit(points) {
    var xs = [], ys = [], i;
    for (i = 0; i < points.length; i++) {
      if (points[i].t > 0) { xs.push(points[i].n); ys.push(Math.log(points[i].t)); }
    }
    if (xs.length < 2) return null;
    var fitLine = ols(xs, ys), resid = [], k;
    for (k = 0; k < xs.length; k++) resid.push(ys[k] - (fitLine.intercept + fitLine.slope * xs[k]));
    var base = Math.exp(fitLine.slope);
    return {
      key: 'exp',
      label: 'O(' + (isFinite(base) ? base.toFixed(2) : '?') + 'ⁿ)',
      base: base,
      a: Math.exp(fitLine.intercept),
      rms: rmsAbout(resid, 0)
    };
  }

  /* Rank every candidate class against the points. Scale-only log fit for the
     polynomial family; a two-parameter log fit for the exponential, because
     its base is unknown and has to be measured rather than assumed. */
  function fitAll(points) {
    var usable = [], i;
    for (i = 0; i < points.length; i++) {
      if (points[i].t > 0 && points[i].n > 0) usable.push(points[i]);
    }
    if (usable.length < 3) return null;

    var out = [], m, resid, c, k;
    for (i = 0; i < MODELS.length; i++) {
      m = MODELS[i];
      resid = [];
      for (k = 0; k < usable.length; k++) {
        resid.push(Math.log(usable[k].t) - Math.log(m.f(usable[k].n)));
      }
      c = mean(resid);
      out.push({ key: m.key, label: m.label, rms: rmsAbout(resid, c), coef: Math.exp(c) });
    }
    // The exponential candidate has TWO free parameters where every class
    // above has one, so it can always match a flat line at least as well as
    // O(1) can and will win the ranking on a constant-time workload by pure
    // overfitting. A fitted base indistinguishable from 1 is not a complexity
    // class, it is O(1) with extra steps, so it is dropped from the ranking
    // instead of being allowed to report "O(1.00 to the n)" as a verdict.
    var e = expFit(usable);
    if (e && (!isFinite(e.base) || e.base < 1.05)) e = null;
    if (e) out.push(e);

    out.sort(function (x, y) { return x.rms - y.rms; });
    return {
      ranked: out,
      power: powerFit(usable),
      exponential: e,
      used: usable
    };
  }

  /* Where two measured curves swap places, for real rather than for one noisy
     comparison.

     Reporting every sign change was wrong, and wrong in the direction that
     makes a tool untrustworthy: racing bubble sort against insertion sort —
     two curves in the same class, one of them slower everywhere that matters
     — produced a confident "they cross at n = 7" out of two flipped
     comparisons down where both algorithms take fifty nanoseconds and the
     clock is barely awake.

     So a crossover has to be a change in the SETTLED winner. The sign is taken
     at each end of the ladder from three comparisons rather than one, and if
     both ends agree there is no crossover to report however much the middle
     wobbles. When they disagree, the crossing is bracketed between the last
     size the first algorithm led at and the start of the run the second one
     never gives up. Adjacent brackets get a single interpolated n — in log n,
     which is the space these curves are nearly straight in. A wider bracket is
     reported as the region it is, because that is genuinely all the data says. */
  function crossover(a, b) {
    var n = Math.min(a.length, b.length), i, s = [];
    if (n < 4) return null;
    for (i = 0; i < n; i++) {
      s.push(a[i].t === b[i].t ? 0 : (a[i].t < b[i].t ? -1 : 1));  // -1: a is faster
    }
    function settled(from, to) {
      var sum = 0, k;
      for (k = from; k < to; k++) sum += s[k];
      return sum === 0 ? 0 : (sum < 0 ? -1 : 1);
    }
    var head = settled(0, 3), tail = settled(n - 3, n);
    if (!head || !tail || head === tail) return null;

    var first = n - 1;                       // start of the trailing, settled run
    for (i = n - 1; i >= 0; i--) { if (s[i] === tail) first = i; else break; }
    var last = -1;                           // last size the other one still led
    for (i = 0; i < first; i++) if (s[i] === head) last = i;
    if (last < 0) return null;

    var res = { lo: a[last].n, hi: a[first].n, aWasFaster: head === -1, n: null };
    if (first === last + 1) {
      var d0 = a[last].t - b[last].t, d1 = a[first].t - b[first].t;
      var x0 = Math.log(a[last].n), x1 = Math.log(a[first].n);
      var f = (d0 - d1) === 0 ? 0.5 : d0 / (d0 - d1);
      res.n = Math.exp(x0 + f * (x1 - x0));
    }
    return res;
  }

  var CORE = {
    algorithms: ALGOS, models: MODELS, raceSizes: RACE_SIZES,
    fitAll: fitAll, powerFit: powerFit, expFit: expFit, crossover: crossover,
    mergeSort: mergeSort, insertionSort: insertionSort, bubbleSort: bubbleSort,
    binarySearch: binarySearch, subsetWalk: subsetWalk, fib: fib,
    randomArray: randomArray, isSorted: isSorted
  };

  /* The maths above is pure, so it can be loaded and checked under Node without
     a DOM. In a browser `module` is undefined and this is a no-op. */
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  4. THE MEASUREMENT ENGINE                                              */
  /* ======================================================================== */

  var WARMUP = 3;            // discarded passes, to let the JIT tier up
  var CAL_TARGET_MS = 2;     // a timed region shorter than this is mostly clock
  var CAL_ROUNDS = 14;
  var CELL_BUDGET_MS = 140;  // one run past this and the ladder stops climbing
  var MAX_COPIES = 2000000;  // total elements held for a mutating inner repeat

  /* How many times a cell may run inside one timed region. A mutating
     algorithm needs a fresh array per iteration, so its ceiling is set by
     memory; a non-mutating one reuses a single fixture and can go much higher. */
  function maxRepeat(algo, n) {
    if (!algo.mutates) return 500000;
    return Math.max(1, Math.min(20000, Math.floor(MAX_COPIES / Math.max(1, n))));
  }

  function prepMany(algo, fx, k) {
    var arr = new Array(k), i;
    for (i = 0; i < k; i++) arr[i] = algo.prep(fx);
    return arr;
  }

  /* One timed region: k executions, clock read once at each end. The `sink +=`
     is deliberately inside the loop — see the header note on dead code. */
  function timeRegion(algo, inputs, k) {
    var t0 = now(), i;
    for (i = 0; i < k; i++) sink += algo.run(inputs[i]);
    return now() - t0;
  }

  /* Grow k until the timed region is comfortably longer than the clock can
     round away, or until memory or the per-run cost says stop. */
  function calibrate(algo, fx, n, target) {
    var cap = maxRepeat(algo, n), k = 1, round, inputs, elapsed, scale, next;
    for (round = 0; round < CAL_ROUNDS; round++) {
      inputs = prepMany(algo, fx, k);
      elapsed = timeRegion(algo, inputs, k);
      if (elapsed >= target || k >= cap) return { k: k, per: elapsed / k };
      scale = elapsed > 0 ? (target / elapsed) : 64;
      next = Math.ceil(k * Math.min(64, Math.max(2, scale)));
      k = Math.min(next, cap);
    }
    return { k: k, per: elapsed / k };
  }

  function median(list) {
    var s = list.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /* The runner. One tick does one indivisible piece of work — build a fixture,
     calibrate a cell, run one warm-up pass, or take one timed sample — and then
     returns so the browser can paint. Nothing here loops over the whole plan. */
  function Runner(jobs, reps, hooks) {
    this.jobs = jobs;
    this.reps = reps;
    this.hooks = hooks;
    this.jobIndex = 0;
    this.phase = 'build';
    this.i = 0;
    this.fx = null;
    this.cal = null;
    this.samples = null;
    this.stoppedKeys = {};   // last size measured before the budget was hit
    this.truncated = {};     // ...and only the ones that actually lost sizes
    this.done = 0;
    this.total = 0;
    for (var j = 0; j < jobs.length; j++) this.total += 1 + WARMUP + reps;
    this.stopped = false;
  }

  Runner.prototype.progress = function () {
    return this.total ? Math.min(1, this.done / this.total) : 1;
  };

  Runner.prototype.current = function () { return this.jobs[this.jobIndex] || null; };

  /* Returns true while there is more to do. Throws nothing: a workload that
     fails is reported through hooks.onError and the ladder for that algorithm
     is abandoned, because one broken cell should not lose the other eight
     algorithms' results. */
  Runner.prototype.tick = function () {
    if (this.stopped) return false;
    var job = this.jobs[this.jobIndex];
    if (!job) return false;

    // A ladder that hit the time budget skips the rest of its own sizes. The
    // note only belongs on screen if sizes were genuinely lost — the last rung
    // of a ladder routinely trips the budget having already been measured, and
    // reporting that as "stopped early" would be a lie about a complete run.
    if (this.stoppedKeys[job.algo.key] && this.phase === 'build') {
      this.truncated[job.algo.key] = this.stoppedKeys[job.algo.key];
      this.done += 1 + WARMUP + this.reps;
      this.advance();
      return this.jobIndex < this.jobs.length;
    }

    try {
      if (this.phase === 'build') {
        this.fx = job.algo.build(job.n);
        this.cal = calibrate(job.algo, this.fx, job.n, CAL_TARGET_MS);
        this.samples = [];
        this.done++;
        this.phase = 'warm';
        this.i = 0;
        // A single run already over budget: record it and climb no further.
        if (this.cal.per > CELL_BUDGET_MS) this.stoppedKeys[job.algo.key] = job.n;
        return true;
      }
      if (this.phase === 'warm') {
        timeRegion(job.algo, prepMany(job.algo, this.fx, this.cal.k), this.cal.k);
        this.done++;
        if (++this.i >= WARMUP) { this.phase = 'rep'; this.i = 0; }
        return true;
      }
      // phase === 'rep'
      var inputs = prepMany(job.algo, this.fx, this.cal.k);
      var elapsed = timeRegion(job.algo, inputs, this.cal.k);
      this.samples.push(elapsed / this.cal.k);
      this.done++;
      if (++this.i < this.reps) return true;

      var cell = {
        key: job.algo.key, n: job.n, k: this.cal.k, reps: this.reps,
        t: median(this.samples),
        min: Math.min.apply(null, this.samples),
        max: Math.max.apply(null, this.samples)
      };
      if (this.hooks.onCell) this.hooks.onCell(cell, job.algo);
      if (cell.t > CELL_BUDGET_MS) this.stoppedKeys[job.algo.key] = job.n;
      this.fx = null;
      this.advance();
      return this.jobIndex < this.jobs.length;
    } catch (err) {
      if (this.hooks.onError) {
        this.hooks.onError(job.algo, err && err.message ? err.message : String(err));
      }
      this.stoppedKeys[job.algo.key] = job.n;
      this.fx = null;
      this.advance();
      return this.jobIndex < this.jobs.length;
    }
  };

  Runner.prototype.advance = function () {
    this.jobIndex++;
    this.phase = 'build';
    this.i = 0;
  };

  Runner.prototype.truncatedAt = function (key) { return this.truncated[key] || 0; };

  /* ======================================================================== */
  /*  5. FORMATTING                                                          */
  /* ======================================================================== */

  function fmtTime(ms) {
    if (!isFinite(ms)) return '—';
    if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
    if (ms >= 1) return ms.toFixed(2) + ' ms';
    if (ms >= 0.001) return (ms * 1000).toFixed(2) + ' µs';
    return (ms * 1000000).toFixed(1) + ' ns';
  }

  function fmtN(n) {
    var parts = String(Math.round(n)).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  function fmtPct(rms) {
    var p = (Math.exp(rms) - 1) * 100;
    if (p < 1) return p.toFixed(2) + '%';
    if (p < 10) return p.toFixed(1) + '%';
    return Math.round(p) + '%';
  }

  /* ======================================================================== */
  /*  6. THE CHART                                                           */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";
  var SERIES_COLOURS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa',
                        '#fb923c', '#22d3ee', '#facc15', '#f87171'];

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function Chart(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.series = [];
    this.mode = 'loglog';
    this.empty = 'Nothing measured yet.';
  }

  Chart.prototype.setSeries = function (list) { this.series = list; };
  Chart.prototype.setMode = function (mode) { this.mode = mode; };

  Chart.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(240, this.canvas.clientWidth || 640);
    var h = Math.max(200, this.canvas.clientHeight || 360);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  };

  /* Nice round tick values for a linear axis. */
  function linearTicks(lo, hi) {
    if (!(hi > lo)) return [lo];
    var span = hi - lo;
    var step = Math.pow(10, Math.floor(Math.log(span / 5) / Math.LN10));
    var mult = span / 5 / step;
    if (mult > 5) step *= 10;
    else if (mult > 2) step *= 5;
    else if (mult > 1) step *= 2;
    var out = [], v = Math.ceil(lo / step) * step, guard = 0;
    while (v <= hi + step * 1e-6 && guard++ < 40) { out.push(v); v += step; }
    return out;
  }

  /* Decade ticks plus the 2 and 5 subdivisions, which is what makes a log axis
     readable rather than a row of unlabelled powers. */
  function logTicks(loLog, hiLog) {
    var out = [], d, m, v;
    for (d = Math.floor(loLog); d <= Math.ceil(hiLog); d++) {
      for (m = 0; m < 3; m++) {
        v = [1, 2, 5][m] * Math.pow(10, d);
        var lv = Math.log(v) / Math.LN10;
        if (lv >= loLog - 1e-9 && lv <= hiLog + 1e-9) out.push({ v: v, major: m === 0 });
      }
    }
    return out;
  }

  Chart.prototype.bounds = function () {
    var xs = [], ys = [], i, k, s, p;
    for (i = 0; i < this.series.length; i++) {
      s = this.series[i];
      for (k = 0; k < s.points.length; k++) {
        p = s.points[k];
        if (!(p.t > 0)) continue;
        xs.push(p.n);
        ys.push(p.min > 0 ? p.min : p.t);
        ys.push(p.max > 0 ? p.max : p.t);
      }
    }
    if (!xs.length) return null;
    return {
      xlo: Math.min.apply(null, xs), xhi: Math.max.apply(null, xs),
      ylo: Math.min.apply(null, ys), yhi: Math.max.apply(null, ys)
    };
  };

  Chart.prototype.draw = function () {
    this.resize();
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg0;
    ctx.fillRect(0, 0, w, h);

    var b = this.bounds();
    if (!b) {
      ctx.fillStyle = C.faint;
      ctx.font = '13px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.empty, w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    var padL = 62, padR = 14, padT = 14, padB = 40;
    var innerW = Math.max(10, w - padL - padR);
    var innerH = Math.max(10, h - padT - padB);
    var logX = this.mode === 'loglog';
    var logY = this.mode !== 'linear';

    var xlo, xhi, ylo, yhi;
    if (logX) {
      xlo = Math.log(b.xlo) / Math.LN10 - 0.05;
      xhi = Math.log(b.xhi) / Math.LN10 + 0.05;
    } else {
      xlo = 0;
      xhi = b.xhi * 1.04;
    }
    if (logY) {
      ylo = Math.log(b.ylo) / Math.LN10 - 0.12;
      yhi = Math.log(b.yhi) / Math.LN10 + 0.12;
    } else {
      ylo = 0;
      yhi = b.yhi * 1.08;
    }
    if (!(xhi > xlo)) xhi = xlo + 1;
    if (!(yhi > ylo)) yhi = ylo + 1;

    function px(n) {
      var v = logX ? Math.log(Math.max(1e-12, n)) / Math.LN10 : n;
      return padL + (v - xlo) / (xhi - xlo) * innerW;
    }
    function py(t) {
      var v = logY ? Math.log(Math.max(1e-12, t)) / Math.LN10 : t;
      return padT + innerH - (v - ylo) / (yhi - ylo) * innerH;
    }

    ctx.font = '10px ' + FONT;
    ctx.textBaseline = 'middle';

    // --- grid + axis labels ------------------------------------------------
    var i, k, x, y;
    if (logY) {
      var yt = logTicks(ylo, yhi);
      for (i = 0; i < yt.length; i++) {
        y = py(yt[i].v);
        ctx.strokeStyle = yt[i].major ? 'rgba(28,43,68,0.95)' : 'rgba(28,43,68,0.45)';
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + innerW, y);
        ctx.stroke();
        if (yt[i].major || yt.length < 8) {
          ctx.fillStyle = C.faint;
          ctx.textAlign = 'right';
          ctx.fillText(fmtTime(yt[i].v), padL - 6, y);
        }
      }
    } else {
      var ytl = linearTicks(ylo, yhi);
      for (i = 0; i < ytl.length; i++) {
        y = py(ytl[i]);
        ctx.strokeStyle = 'rgba(28,43,68,0.8)';
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + innerW, y);
        ctx.stroke();
        ctx.fillStyle = C.faint;
        ctx.textAlign = 'right';
        ctx.fillText(fmtTime(ytl[i]), padL - 6, y);
      }
    }

    ctx.textAlign = 'center';
    if (logX) {
      var xt = logTicks(xlo, xhi);
      for (i = 0; i < xt.length; i++) {
        x = px(xt[i].v);
        ctx.strokeStyle = xt[i].major ? 'rgba(28,43,68,0.95)' : 'rgba(28,43,68,0.45)';
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + innerH);
        ctx.stroke();
        if (xt[i].major) {
          ctx.fillStyle = C.faint;
          ctx.fillText(fmtN(xt[i].v), x, padT + innerH + 14);
        }
      }
    } else {
      var xtl = linearTicks(xlo, xhi);
      for (i = 0; i < xtl.length; i++) {
        x = px(xtl[i]);
        ctx.strokeStyle = 'rgba(28,43,68,0.8)';
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + innerH);
        ctx.stroke();
        ctx.fillStyle = C.faint;
        ctx.fillText(fmtN(xtl[i]), x, padT + innerH + 14);
      }
    }

    ctx.fillStyle = C.dim;
    ctx.fillText(this.xlabel || 'input size n', padL + innerW / 2, h - 8);

    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    // --- fitted overlay ----------------------------------------------------
    // Only drawn in the mode where the fit is a straight line, because a
    // straight fit line over curved data is the visual claim being made.
    for (i = 0; i < this.series.length; i++) {
      var s = this.series[i];
      var overlay = null;
      if (this.mode === 'loglog' && s.fit && s.fit.power) overlay = s.fit.power;
      if (this.mode === 'semilog' && s.fit && s.fit.exponential) overlay = s.fit.exponential;
      if (!overlay || !s.fitRange || s.fitRange.length < 2) continue;
      var n0 = s.fitRange[0].n, n1 = s.fitRange[s.fitRange.length - 1].n;
      var t0, t1;
      if (this.mode === 'loglog') {
        t0 = overlay.a * Math.pow(n0, overlay.p);
        t1 = overlay.a * Math.pow(n1, overlay.p);
      } else {
        t0 = overlay.a * Math.pow(overlay.base, n0);
        t1 = overlay.a * Math.pow(overlay.base, n1);
      }
      if (!(t0 > 0) || !(t1 > 0)) continue;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(n0), py(t0));
      ctx.lineTo(px(n1), py(t1));
      ctx.stroke();
      ctx.restore();
    }

    // --- series ------------------------------------------------------------
    for (i = 0; i < this.series.length; i++) {
      var ser = this.series[i];
      var pts = [];
      for (k = 0; k < ser.points.length; k++) if (ser.points[k].t > 0) pts.push(ser.points[k]);
      if (!pts.length) continue;

      // whiskers first, so the line and dots sit on top of them
      ctx.strokeStyle = ser.colour;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      for (k = 0; k < pts.length; k++) {
        if (!(pts[k].max > pts[k].min)) continue;
        x = px(pts[k].n);
        ctx.beginPath();
        ctx.moveTo(x, py(pts[k].min));
        ctx.lineTo(x, py(pts[k].max));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (k = 0; k < pts.length; k++) {
        x = px(pts[k].n);
        y = py(pts[k].t);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = ser.colour;
      for (k = 0; k < pts.length; k++) {
        ctx.beginPath();
        ctx.arc(px(pts[k].n), py(pts[k].t), 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // --- legend ------------------------------------------------------------
    ctx.textAlign = 'left';
    var ly = padT + 6;
    for (i = 0; i < this.series.length; i++) {
      if (!this.series[i].points.length) continue;
      ctx.fillStyle = this.series[i].colour;
      ctx.fillRect(padL + 10, ly - 4, 9, 9);
      ctx.fillStyle = C.dim;
      ctx.fillText(this.series[i].label, padL + 24, ly);
      ly += 14;
    }
  };

  /* ======================================================================== */
  /*  7. THE LAB                                                             */
  /* ======================================================================== */

  var AXIS_NOTES = {
    linear: 'Linear axes — the way a spreadsheet would draw it. One curve leaves the top of ' +
            'the frame and everything else is squashed onto the floor, which is exactly why ' +
            'nobody teaches complexity from a linear plot.',
    loglog: 'Log–log axes. This is the one that matters: a power law nᵖ is a STRAIGHT LINE here, ' +
            'and its slope is p. Slope 1 is linear, slope 2 is quadratic, slope 1.1 is n log n ' +
            'pretending to be linear. Read the exponent off the picture. An exponential is not ' +
            'straight here at all — it curves upward without ever settling.',
    semilog: 'Log time, linear n. Now the exponentials are the straight lines and their slope is ' +
             'the growth base, while every polynomial bends over and flattens. Switch between ' +
             'this and log–log to tell an exponential from a polynomial by shape alone.'
  };

  var FIT_RANGES = [
    { key: 'drop2', label: 'ignore the two smallest sizes', drop: 2 },
    { key: 'drop1', label: 'ignore the smallest size', drop: 1 },
    { key: 'all', label: 'use every size', drop: 0 },
    { key: 'half', label: 'use only the largest half', drop: -1 }
  ];

  /* Simplicity order, used only to break a tie. When two classes fit the
     measurements equally well, naming the more expensive one is a claim the
     data does not support — and the cheaper curve is the one that would have
     to be disproved by measuring further out. */
  var SIMPLICITY = {};
  (function () {
    for (var i = 0; i < MODELS.length; i++) SIMPLICITY[MODELS[i].key] = i;
    SIMPLICITY.exp = MODELS.length;
  })();

  /* Two candidates are separable when the worse one misses by more than about
     sixty per cent again. Below that they are the same curve as far as this
     measurement is concerned, and the verdict says so rather than picking a
     winner by the fourth decimal place of a residual. */
  function verdictOf(fit) {
    var best = fit.ranked[0], band = best.rms * 1.6 + 0.01;
    var tied = [], i;
    for (i = 0; i < fit.ranked.length; i++) {
      if (fit.ranked[i].rms <= band) tied.push(fit.ranked[i]);
    }
    var supported = tied[0];
    for (i = 1; i < tied.length; i++) {
      if (SIMPLICITY[tied[i].key] < SIMPLICITY[supported.key]) supported = tied[i];
    }
    return { best: best, second: fit.ranked[1] || null, tied: tied, supported: supported };
  }

  function selectedRange(points, key) {
    var spec = null, i;
    for (i = 0; i < FIT_RANGES.length; i++) if (FIT_RANGES[i].key === key) spec = FIT_RANGES[i];
    if (!spec) spec = FIT_RANGES[0];
    var out;
    if (spec.drop < 0) out = points.slice(Math.floor(points.length / 2));
    else out = points.slice(spec.drop);
    if (out.length < 3) out = points.slice(Math.max(0, points.length - 3));
    return out;
  }

  var CSS = [
    '#bigoviz .bo-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    '#bigoviz .bo-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,0.6);}',
    '#bigoviz .bo-tab{font:inherit;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#bigoviz .bo-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#bigoviz .bo-tab.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#bigoviz .bo-body{display:grid;grid-template-columns:minmax(0,19rem) minmax(0,1fr);align-items:start;}',
    '#bigoviz .bo-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,0.6);min-width:0;}',
    '#bigoviz .bo-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '@media (max-width:900px){#bigoviz .bo-body{grid-template-columns:minmax(0,1fr);}' +
      '#bigoviz .bo-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',

    '#bigoviz .bo-group{margin:0 0 14px;}',
    '#bigoviz .bo-group-title{margin:0 0 7px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#bigoviz .bo-pick{display:flex;align-items:flex-start;gap:8px;padding:5px 6px;border-radius:7px;cursor:pointer;}',
    '#bigoviz .bo-pick:hover{background:rgba(56,189,248,.07);}',
    '#bigoviz .bo-pick input{margin-top:2px;accent-color:' + C.blue + ';cursor:pointer;flex:0 0 auto;}',
    '#bigoviz .bo-pick-body{min-width:0;}',
    '#bigoviz .bo-pick-name{display:block;color:' + C.ink + ';}',
    '#bigoviz .bo-pick-claim{display:block;font-size:11px;color:' + C.faint + ';}',
    '#bigoviz .bo-swatch{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:5px;vertical-align:middle;}',
    '#bigoviz .bo-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;}',
    '#bigoviz .bo-field-label{color:' + C.dim + ';font-size:12px;}',
    '#bigoviz .bo-select{font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:100%;}',
    '#bigoviz .bo-select:focus{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#bigoviz .bo-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:7px 11px;cursor:pointer;}',
    '#bigoviz .bo-btn:hover:not([disabled]){background:#213152;border-color:#40608f;}',
    '#bigoviz .bo-btn.primary{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#bigoviz .bo-btn.primary:hover:not([disabled]){background:#a5e4ff;}',
    '#bigoviz .bo-btn[disabled]{opacity:.4;cursor:default;}',
    '#bigoviz .bo-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
    '#bigoviz .bo-hint{margin:6px 0 0;font-size:11px;line-height:1.55;color:' + C.faint + ';}',
    '#bigoviz .bo-env{margin:10px 0 0;font-size:11px;line-height:1.6;color:' + C.faint + ';border-top:1px solid ' + C.line + ';padding-top:9px;}',

    '#bigoviz .bo-axisrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}',
    '#bigoviz .bo-axisrow .bo-btn{font-size:11px;padding:5px 9px;}',
    '#bigoviz .bo-note{padding:9px 12px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.65;color:#cbd5e1;}',
    '#bigoviz .bo-error{padding:8px 11px;border-left:3px solid ' + C.red + ';background:rgba(252,165,165,.07);border-radius:0 8px 8px 0;font-size:12px;line-height:1.6;color:' + C.red + ';}',
    '#bigoviz .bo-limit{padding:8px 11px;border-left:3px solid ' + C.amber + ';background:rgba(251,191,36,.07);border-radius:0 8px 8px 0;font-size:12px;line-height:1.6;color:#fcd77a;}',
    '#bigoviz .bo-chartwrap{border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';padding:4px;}',
    '#bigoviz .bo-canvas{display:block;width:100%;height:360px;border-radius:7px;}',
    '#bigoviz .bo-canvas:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;}',
    '@media (max-width:640px){#bigoviz .bo-canvas{height:280px;}}',

    '#bigoviz .bo-progress{display:flex;align-items:center;gap:10px;}',
    '#bigoviz .bo-bar{flex:1 1 auto;height:8px;border-radius:999px;background:#131f36;border:1px solid #24344f;overflow:hidden;}',
    '#bigoviz .bo-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,' + C.blue + ',' + C.green + ');transition:width .18s linear;}',
    '#bigoviz .bo-progress-text{flex:0 0 auto;font-size:11px;color:' + C.dim + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%;}',

    '#bigoviz .bo-verdict{display:flex;flex-direction:column;gap:9px;}',
    '#bigoviz .bo-card{border:1px solid ' + C.line + ';border-radius:9px;background:rgba(15,23,42,.55);padding:10px 12px;}',
    '#bigoviz .bo-card-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;}',
    '#bigoviz .bo-card-name{font-weight:700;color:' + C.ink + ';}',
    '#bigoviz .bo-card-claim{font-size:11px;color:' + C.faint + ';}',
    '#bigoviz .bo-verdict-line{margin:6px 0 0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '#bigoviz .bo-slope{color:' + C.amber + ';font-weight:700;}',
    '#bigoviz .bo-win{color:' + C.green + ';font-weight:700;}',
    '#bigoviz .bo-miss{color:' + C.red + ';font-weight:700;}',
    '#bigoviz .bo-card-note{margin:7px 0 0;font-size:11.5px;line-height:1.65;color:' + C.faint + ';}',

    '#bigoviz .bo-tablewrap{overflow-x:auto;}',
    '#bigoviz .bo-table{width:100%;border-collapse:collapse;font-size:11.5px;}',
    '#bigoviz .bo-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#bigoviz .bo-table td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,.6);color:' + C.ink + ';white-space:nowrap;}',
    '#bigoviz .bo-details{border:1px solid ' + C.line + ';border-radius:9px;background:rgba(15,23,42,.4);padding:8px 12px;}',
    '#bigoviz .bo-details summary{cursor:pointer;font-size:12px;color:' + C.cyan + ';}',
    '#bigoviz .bo-details summary:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:4px;}',
    '#bigoviz .bo-details[open] summary{margin-bottom:8px;}',
    '#bigoviz .bo-hidden{display:none;}'
  ].join('');

  /* ------------------------------------------------------------------------ */

  function BigO(rootEl) {
    this.root = rootEl;
    this.mode = 'measure';          // 'measure' | 'race'
    this.axis = 'loglog';
    this.reps = 7;
    this.fitRange = 'drop2';
    this.results = {};              // key -> array of cells
    this.raceResults = {};
    this.raceA = 'insertion';
    this.raceB = 'merge';
    this.runner = null;
    this.timer = null;
    this.pausedHidden = false;
    this.resolution = timerResolution();
    this.selected = { scan: true, merge: true, insertion: true };
    this.build();
    this.render();
  }

  BigO.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'bo-wrap');

    // --- tabs --------------------------------------------------------------
    var tabs = E('div', 'bo-tabs');
    this.tabButtons = [];
    [['measure', 'Measure the curve'], ['race', 'Race two algorithms']].forEach(function (spec) {
      var b = E('button', 'bo-tab', spec[1]);
      b.type = 'button';
      b.addEventListener('click', function () { self.setMode(spec[0]); });
      tabs.appendChild(b);
      self.tabButtons.push({ key: spec[0], el: b });
    });
    wrap.appendChild(tabs);

    var body = E('div', 'bo-body');
    var side = E('div', 'bo-side');
    var main = E('div', 'bo-main');

    // --- side: algorithm picker -------------------------------------------
    this.pickGroup = E('div', 'bo-group');
    this.pickTitle = E('p', 'bo-group-title', 'Algorithms');
    this.pickGroup.appendChild(this.pickTitle);
    this.pickHost = E('div');
    this.pickGroup.appendChild(this.pickHost);
    side.appendChild(this.pickGroup);

    // --- side: race pickers ------------------------------------------------
    this.raceGroup = E('div', 'bo-group bo-hidden');
    this.raceGroup.appendChild(E('p', 'bo-group-title', 'Head to head'));
    this.raceSelA = this.raceSelect(function (v) { self.raceA = v; self.render(); });
    this.raceSelB = this.raceSelect(function (v) { self.raceB = v; self.render(); });
    this.raceGroup.appendChild(this.labelled('Algorithm A', this.raceSelA));
    this.raceGroup.appendChild(this.labelled('Algorithm B', this.raceSelB));
    this.raceGroup.appendChild(E('p', 'bo-hint',
      'Both are given byte-identical arrays at every size on one shared ladder, ' +
      'from four elements up to two thousand, so the only difference between the ' +
      'two curves is the algorithm.'));
    side.appendChild(this.raceGroup);

    // --- side: measurement settings ---------------------------------------
    var settings = E('div', 'bo-group');
    settings.appendChild(E('p', 'bo-group-title', 'How carefully'));

    var repSel = E('select', 'bo-select');
    [[3, '3 runs (quick)'], [7, '7 runs (default)'], [15, '15 runs (patient)']].forEach(function (o) {
      var op = E('option', null, o[1]);
      op.value = String(o[0]);
      if (o[0] === self.reps) op.selected = true;
      repSel.appendChild(op);
    });
    repSel.addEventListener('change', function () {
      self.reps = parseInt(repSel.value, 10) || 7;
    });
    settings.appendChild(this.labelled('Median of', repSel));

    var fitSel = E('select', 'bo-select');
    FIT_RANGES.forEach(function (o) {
      var op = E('option', null, o.label);
      op.value = o.key;
      if (o.key === self.fitRange) op.selected = true;
      fitSel.appendChild(op);
    });
    fitSel.addEventListener('change', function () {
      self.fitRange = fitSel.value;
      self.render();
    });
    settings.appendChild(this.labelled('Fit using', fitSel));
    settings.appendChild(E('p', 'bo-hint',
      'The smallest sizes are dropped by default. At a thousand elements the array ' +
      'fits in L1 cache and the loop is dominated by call overhead, so those points ' +
      'sit below the line and drag a fit towards a class that is too cheap. Put them ' +
      'back and watch the verdict change — that is worth doing once.'));

    var actions = E('div', 'bo-btnrow');
    this.btnRun = E('button', 'bo-btn primary', 'Measure');
    this.btnRun.type = 'button';
    this.btnRun.addEventListener('click', function () { self.start(); });
    this.btnStop = E('button', 'bo-btn', 'Stop');
    this.btnStop.type = 'button';
    this.btnStop.disabled = true;
    this.btnStop.addEventListener('click', function () { self.stop('Stopped.'); });
    this.btnClear = E('button', 'bo-btn', 'Clear');
    this.btnClear.type = 'button';
    this.btnClear.addEventListener('click', function () {
      self.stop('');
      self.results = {};
      self.raceResults = {};
      self.setStatus('Cleared.');
      self.render();
    });
    actions.appendChild(this.btnRun);
    actions.appendChild(this.btnStop);
    actions.appendChild(this.btnClear);
    settings.appendChild(actions);
    side.appendChild(settings);

    this.envBox = E('p', 'bo-env');
    side.appendChild(this.envBox);

    // --- main --------------------------------------------------------------
    var axisRow = E('div', 'bo-axisrow');
    this.axisButtons = [];
    [['linear', 'Linear axes'], ['loglog', 'Log–log'], ['semilog', 'Log time, linear n']]
      .forEach(function (spec) {
        var b = E('button', 'bo-btn', spec[1]);
        b.type = 'button';
        b.setAttribute('aria-pressed', spec[0] === self.axis ? 'true' : 'false');
        b.addEventListener('click', function () {
          self.axis = spec[0];
          self.render();
        });
        axisRow.appendChild(b);
        self.axisButtons.push({ key: spec[0], el: b });
      });
    main.appendChild(axisRow);

    this.noteBox = E('p', 'bo-note');
    main.appendChild(this.noteBox);

    var chartWrap = E('div', 'bo-chartwrap');
    this.canvas = E('canvas', 'bo-canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    chartWrap.appendChild(this.canvas);
    main.appendChild(chartWrap);
    this.chart = new Chart(this.canvas);

    var prog = E('div', 'bo-progress');
    this.barOuter = E('div', 'bo-bar');
    this.barOuter.setAttribute('role', 'progressbar');
    this.barOuter.setAttribute('aria-valuemin', '0');
    this.barOuter.setAttribute('aria-valuemax', '100');
    this.barOuter.setAttribute('aria-valuenow', '0');
    this.barOuter.setAttribute('aria-label', 'Measurement progress');
    this.barFill = E('i');
    this.barOuter.appendChild(this.barFill);
    this.progressText = E('span', 'bo-progress-text', 'Idle.');
    prog.appendChild(this.barOuter);
    prog.appendChild(this.progressText);
    main.appendChild(prog);

    // Announced only at the start, the end and on failure. Announcing every
    // repetition would read a hundred lines aloud during a single run.
    this.status = E('p', 'sr-only');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    main.appendChild(this.status);

    this.errorBox = E('p', 'bo-error bo-hidden');
    main.appendChild(this.errorBox);

    // A ladder cut short by the time budget is expected behaviour, not a
    // failure, so it gets its own amber line rather than the red one — the red
    // box has to keep meaning "something went wrong".
    this.limitBox = E('p', 'bo-limit bo-hidden');
    main.appendChild(this.limitBox);

    this.verdict = E('div', 'bo-verdict');
    main.appendChild(this.verdict);

    this.details = E('details', 'bo-details');
    this.detailsSummary = E('summary', null, 'Every measurement, as a table');
    this.details.appendChild(this.detailsSummary);
    this.detailsBody = E('div', 'bo-tablewrap');
    this.details.appendChild(this.detailsBody);
    var copyRow = E('div', 'bo-btnrow');
    this.btnCopy = E('button', 'bo-btn', 'Copy as CSV');
    this.btnCopy.type = 'button';
    this.btnCopy.addEventListener('click', function () { self.copyCsv(); });
    copyRow.appendChild(this.btnCopy);
    this.details.appendChild(copyRow);
    main.appendChild(this.details);

    body.appendChild(side);
    body.appendChild(main);
    wrap.appendChild(body);
    this.root.appendChild(wrap);

    this.buildPicker();
    this.fillRaceSelects();
    this.setMode('measure');

    // A background tab is throttled and its timings are not comparable with a
    // foreground one, so a run in progress pauses rather than quietly
    // collecting numbers that mean something else.
    document.addEventListener('visibilitychange', function () {
      if (!self.runner) return;
      if (document.hidden) {
        self.pausedHidden = true;
        if (self.timer) { clearTimeout(self.timer); self.timer = null; }
        self.progressText.textContent = 'Paused — this tab is in the background.';
      } else if (self.pausedHidden) {
        self.pausedHidden = false;
        self.setStatus('Resumed.');
        self.schedule();
      }
    });

    var redraw = function () { if (self.chart) self.chart.draw(); };
    window.addEventListener('resize', redraw);
    document.addEventListener('fullscreenchange', redraw);
  };

  BigO.prototype.labelled = function (text, control) {
    var wrap = E('label', 'bo-field');
    wrap.appendChild(E('span', 'bo-field-label', text));
    wrap.appendChild(control);
    return wrap;
  };

  BigO.prototype.raceSelect = function (onChange) {
    var el = E('select', 'bo-select');
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  };

  BigO.prototype.fillRaceSelects = function () {
    var self = this;
    [['raceSelA', 'raceA'], ['raceSelB', 'raceB']].forEach(function (pair) {
      var sel = self[pair[0]];
      clear(sel);
      ALGOS.forEach(function (a) {
        if (!a.race) return;
        var op = E('option', null, a.label + ' — ' + a.claim);
        op.value = a.key;
        if (a.key === self[pair[1]]) op.selected = true;
        sel.appendChild(op);
      });
    });
  };

  BigO.prototype.buildPicker = function () {
    var self = this;
    clear(this.pickHost);
    ALGOS.forEach(function (a, i) {
      var row = E('label', 'bo-pick');
      var box = E('input');
      box.type = 'checkbox';
      box.checked = !!self.selected[a.key];
      box.addEventListener('change', function () {
        self.selected[a.key] = box.checked;
        self.render();
      });
      var bodyEl = E('span', 'bo-pick-body');
      var name = E('span', 'bo-pick-name');
      var sw = E('span', 'bo-swatch');
      sw.style.background = SERIES_COLOURS[i % SERIES_COLOURS.length];
      name.appendChild(sw);
      name.appendChild(document.createTextNode(a.label));
      bodyEl.appendChild(name);
      bodyEl.appendChild(E('span', 'bo-pick-claim',
        'claimed ' + a.claim + ' · ' + a.sizes[0] + '–' + fmtN(a.sizes[a.sizes.length - 1])));
      row.appendChild(box);
      row.appendChild(bodyEl);
      self.pickHost.appendChild(row);
    });
  };

  BigO.prototype.setMode = function (mode) {
    this.stop('');
    this.mode = mode;
    for (var i = 0; i < this.tabButtons.length; i++) {
      var on = this.tabButtons[i].key === mode;
      this.tabButtons[i].el.className = 'bo-tab' + (on ? ' on' : '');
      // Which tab is showing is carried by a colour swap, which a screen
      // reader cannot see. aria-pressed says the same thing in words.
      this.tabButtons[i].el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    this.pickGroup.className = 'bo-group' + (mode === 'measure' ? '' : ' bo-hidden');
    this.raceGroup.className = 'bo-group' + (mode === 'race' ? '' : ' bo-hidden');
    this.render();
  };

  BigO.prototype.setStatus = function (text) {
    this.status.textContent = text;
  };

  BigO.prototype.showError = function (msg) {
    if (msg) {
      this.errorBox.textContent = msg;
      this.errorBox.className = 'bo-error';
    } else {
      this.errorBox.textContent = '';
      this.errorBox.className = 'bo-error bo-hidden';
    }
  };

  BigO.prototype.showLimit = function (msg) {
    if (msg) {
      this.limitBox.textContent = msg;
      this.limitBox.className = 'bo-limit';
    } else {
      this.limitBox.textContent = '';
      this.limitBox.className = 'bo-limit bo-hidden';
    }
  };

  /* --- running ----------------------------------------------------------- */

  BigO.prototype.plan = function () {
    var jobs = [], i, k;
    if (this.mode === 'race') {
      var a = algoByKey(this.raceA), b = algoByKey(this.raceB);
      if (!a || !b) return jobs;
      for (i = 0; i < RACE_SIZES.length; i++) {
        jobs.push({ algo: a, n: RACE_SIZES[i] });
        if (b !== a) jobs.push({ algo: b, n: RACE_SIZES[i] });
      }
      return jobs;
    }
    for (i = 0; i < ALGOS.length; i++) {
      if (!this.selected[ALGOS[i].key]) continue;
      for (k = 0; k < ALGOS[i].sizes.length; k++) {
        jobs.push({ algo: ALGOS[i], n: ALGOS[i].sizes[k] });
      }
    }
    return jobs;
  };

  BigO.prototype.start = function () {
    var self = this;
    this.stop('');
    this.showError('');
    this.showLimit('');
    var jobs = this.plan();
    if (!jobs.length) {
      this.showError(this.mode === 'race'
        ? 'Pick two algorithms to race.'
        : 'Tick at least one algorithm on the left, then press Measure.');
      this.setStatus('Nothing selected to measure.');
      return;
    }

    var store = this.mode === 'race' ? (this.raceResults = {}) : this.results;
    if (this.mode === 'measure') {
      // Only clear the series about to be re-measured, so a second run adding
      // one more algorithm does not throw away the first run's curves.
      for (var i = 0; i < ALGOS.length; i++) {
        if (this.selected[ALGOS[i].key]) store[ALGOS[i].key] = [];
      }
    }

    this.runner = new Runner(jobs, this.reps, {
      onCell: function (cell) {
        if (!store[cell.key]) store[cell.key] = [];
        store[cell.key].push(cell);
        self.render();
      },
      onError: function (algo, msg) {
        self.showError(algo.label + ' could not be measured: ' + msg +
          '. The other algorithms are unaffected.');
      }
    });
    this.btnRun.disabled = true;
    this.btnStop.disabled = false;
    this.setStatus('Measuring. ' + jobs.length + ' input sizes, median of ' + this.reps + ' runs each.');
    this.schedule();
  };

  /* setTimeout rather than requestIdleCallback. Idle callbacks are the right
     shape for this in principle, but a page that is busy — or a tab that is not
     visible — can starve them for seconds at a time, and a progress bar that
     stops moving for six seconds reads as a hang. A zero-delay timeout is
     clamped to a few milliseconds after a handful of nested calls, which is
     exactly the gap the browser needs to paint and to handle a click on Stop. */
  BigO.prototype.schedule = function () {
    var self = this;
    if (this.timer) clearTimeout(this.timer);

    /* A background tab has its timers clamped, so samples taken there are not
       comparable with the ones either side of them. The check belongs here
       rather than only in the visibilitychange handler: a run started while
       the tab was ALREADY hidden never fires that event, and used to crawl
       along at the throttled rate quietly poisoning the middle of every curve
       with numbers nothing on screen admitted were different. */
    if (document.hidden) {
      this.pausedHidden = true;
      this.progressText.textContent = 'Paused — this tab is in the background.';
      this.setStatus('Paused. Timings taken while a tab is in the background are ' +
        'throttled and not comparable, so the run waits until you come back.');
      return;
    }

    this.timer = setTimeout(function () {
      self.timer = null;
      if (!self.runner) return;
      var more;
      try {
        more = self.runner.tick();
      } catch (err) {
        self.showError('The measurement run stopped: ' +
          ((err && err.message) || String(err)));
        self.finish('Measurement failed.');
        return;
      }
      self.paint();
      if (more) self.schedule();
      else self.finish(null);
    }, 0);
  };

  BigO.prototype.paint = function () {
    if (!this.runner) return;
    var pct = Math.round(this.runner.progress() * 100);
    this.barFill.style.width = pct + '%';
    this.barOuter.setAttribute('aria-valuenow', String(pct));
    var job = this.runner.current();
    this.progressText.textContent = job
      ? (job.algo.label + ', n = ' + fmtN(job.n) + ' · ' + pct + '%')
      : (pct + '%');
  };

  BigO.prototype.finish = function (message) {
    var stoppedNote = '';
    if (this.runner) {
      for (var i = 0; i < ALGOS.length; i++) {
        var at = this.runner.truncatedAt(ALGOS[i].key);
        if (at) {
          stoppedNote += (stoppedNote ? ' ' : '') + ALGOS[i].label +
            ' stopped at n = ' + fmtN(at) + ': one run there passed the ' +
            CELL_BUDGET_MS + ' ms budget, and the larger sizes would have frozen ' +
            'the page for long enough to feel like a crash.';
        }
      }
    }
    this.runner = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.btnRun.disabled = false;
    this.btnStop.disabled = true;
    this.barFill.style.width = '100%';
    this.barOuter.setAttribute('aria-valuenow', '100');
    this.progressText.textContent = message || 'Done.';
    this.setStatus(message || 'Measurement finished. The verdict is below the chart.');
    this.showLimit(stoppedNote);
    // The sink exists so no optimiser can delete the work it accumulates. This
    // is where it becomes genuinely observable.
    this.root.setAttribute('data-sink', String(sink | 0));
    if (window.KSLab) window.KSLab.used('run');
    this.render();
  };

  BigO.prototype.stop = function (message) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.runner) {
      this.runner.stopped = true;
      this.runner = null;
      this.btnRun.disabled = false;
      this.btnStop.disabled = true;
      this.progressText.textContent = message || 'Idle.';
      if (message) this.setStatus(message);
    }
  };

  /* --- rendering --------------------------------------------------------- */

  BigO.prototype.seriesList = function () {
    var store = this.mode === 'race' ? this.raceResults : this.results;
    var out = [], i;
    if (this.mode === 'race') {
      var keys = this.raceA === this.raceB ? [this.raceA] : [this.raceA, this.raceB];
      for (i = 0; i < keys.length; i++) {
        var a = algoByKey(keys[i]);
        if (!a) continue;
        out.push(this.makeSeries(a, store[a.key] || [], i));
      }
      return out;
    }
    for (i = 0; i < ALGOS.length; i++) {
      if (!this.selected[ALGOS[i].key]) continue;
      out.push(this.makeSeries(ALGOS[i], store[ALGOS[i].key] || [], i));
    }
    return out;
  };

  BigO.prototype.makeSeries = function (algo, cells, index) {
    var points = cells.slice().sort(function (x, y) { return x.n - y.n; });
    var range = points.length >= 3 ? selectedRange(points, this.fitRange) : points;
    var fit = points.length >= 3 ? fitAll(range) : null;
    return {
      key: algo.key,
      algo: algo,
      label: algo.label + ' (' + algo.claim + ')',
      colour: SERIES_COLOURS[index % SERIES_COLOURS.length],
      points: points,
      fitRange: range,
      fit: fit
    };
  };

  BigO.prototype.render = function () {
    var series = this.seriesList();
    this.chart.setSeries(series);
    this.chart.setMode(this.axis);
    this.chart.xlabel = this.mode === 'race' ? 'array length n' :
      (series.length === 1 ? series[0].algo.xlabel : 'input size n');
    this.chart.empty = this.mode === 'race'
      ? 'Pick two algorithms and press Measure to race them.'
      : 'Nothing measured yet. Tick an algorithm and press Measure.';
    this.chart.draw();

    for (var i = 0; i < this.axisButtons.length; i++) {
      var on = this.axisButtons[i].key === this.axis;
      this.axisButtons[i].el.className = 'bo-btn' + (on ? ' primary' : '');
      this.axisButtons[i].el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    this.noteBox.textContent = AXIS_NOTES[this.axis];
    this.canvas.setAttribute('aria-label', this.describeChart(series));

    this.envBox.textContent =
      'Timer resolution measured here: ' + fmtTime(this.resolution) +
      '. Each cell repeats itself until the timed region lasts at least ' +
      CAL_TARGET_MS + ' ms, then divides. ' + WARMUP + ' warm-up passes are ' +
      'discarded before any sample is kept.';

    this.renderVerdict(series);
    this.renderTable(series);
  };

  BigO.prototype.describeChart = function (series) {
    var parts = [], i;
    for (i = 0; i < series.length; i++) {
      if (!series[i].points.length) continue;
      var last = series[i].points[series[i].points.length - 1];
      parts.push(series[i].label + ', ' + series[i].points.length + ' measured sizes, ' +
        fmtTime(last.t) + ' at n = ' + fmtN(last.n));
    }
    if (!parts.length) return 'An empty chart. Nothing has been measured yet.';
    return 'Measured running time against input size, ' +
      (this.axis === 'linear' ? 'linear axes' :
        this.axis === 'loglog' ? 'logarithmic on both axes' :
          'logarithmic time against linear n') + '. ' + parts.join('. ') +
      '. The same numbers are in the table below the chart.';
  };

  BigO.prototype.renderVerdict = function (series) {
    clear(this.verdict);
    var any = false, i;

    // In a race the crossover is the finding, so it leads. On the Measure tab
    // there is nothing to lead with but the fits themselves.
    if (this.mode === 'race') this.renderCrossover(series);

    for (i = 0; i < series.length; i++) {
      var s = series[i];
      if (!s.points.length) continue;
      any = true;
      var card = E('div', 'bo-card');
      var head = E('div', 'bo-card-head');
      var nameEl = E('span', 'bo-card-name');
      var sw = E('span', 'bo-swatch');
      sw.style.background = s.colour;
      nameEl.appendChild(sw);
      nameEl.appendChild(document.createTextNode(s.algo.label));
      head.appendChild(nameEl);
      head.appendChild(E('span', 'bo-card-claim', 'textbook class: ' + s.algo.claim));
      card.appendChild(head);
      card.appendChild(this.mode === 'race' ? this.raceLine(s) : this.verdictLine(s));
      card.appendChild(E('p', 'bo-card-note', s.algo.note));
      this.verdict.appendChild(card);
    }

    if (!any) {
      var empty = E('div', 'bo-card');
      empty.appendChild(E('p', 'bo-verdict-line',
        this.mode === 'race'
          ? 'No race has been run yet. Insertion sort against merge sort is the one to try first.'
          : 'No measurements yet. Ticking three or four algorithms and pressing Measure takes ' +
            'about ten seconds and gives you something to compare.'));
      this.verdict.appendChild(empty);
    }
  };

  /* No class is fitted on the race tab, deliberately. The shared ladder is
     dense down at four elements because that is where the crossover lives, and
     a range chosen to find a crossing is the wrong range to classify from —
     at n = 4 a sort is measuring call overhead. Fitting it anyway would print
     a confident 65% misfit next to a perfectly good crossover and undermine
     the one number on the tab that is worth reading. */
  BigO.prototype.raceLine = function (s) {
    var pts = s.points;
    var first = pts[0], last = pts[pts.length - 1];
    var grew = first.t > 0 ? Math.round(last.t / first.t) : 0;
    var wider = Math.round(last.n / first.n);
    var p = E('p', 'bo-verdict-line');
    p.textContent = 'Measured ' + fmtTime(first.t) + ' at n = ' + fmtN(first.n) +
      ' and ' + fmtTime(last.t) + ' at n = ' + fmtN(last.n) + ' — ' +
      fmtN(grew) + ' times the work for ' + fmtN(wider) + ' times the input. ' +
      'No complexity class is fitted on this tab: the shared ladder is dense at ' +
      'four elements because that is where the crossover is, and a range chosen ' +
      'to find a crossing is the wrong one to classify from. The fits are on the ' +
      'Measure tab.';
    return p;
  };

  BigO.prototype.verdictLine = function (s) {
    var p = E('p', 'bo-verdict-line');
    if (!s.fit || !s.fit.power) {
      p.textContent = 'Only ' + s.points.length + ' size' + (s.points.length === 1 ? '' : 's') +
        ' measured so far. Three are needed before a curve can be fitted to anything.';
      return p;
    }
    var v = verdictOf(s.fit);
    var lo = s.fitRange[0].n, hi = s.fitRange[s.fitRange.length - 1].n;

    if (v.best.key === 'exp' && s.fit.exponential) {
      // Quoting a log-log slope for an exponential would be false arithmetic:
      // there is no exponent to read, the number just grows with the range you
      // happened to measure. Saying that out loud is the lesson, so the
      // sentence is built round the base instead.
      p.appendChild(document.createTextNode(
        'This one never straightens out on log–log axes. The slope there reads '));
      p.appendChild(E('span', 'bo-slope', s.fit.power.p.toFixed(1)));
      p.appendChild(document.createTextNode(
        ' over n = ' + fmtN(lo) + ' to ' + fmtN(hi) + ', and it would read something ' +
        'larger again if the ladder went further, which is exactly what a power law ' +
        'never does. Switch to log time against linear n and it becomes a straight ' +
        'line. Measured growth base: '));
      p.appendChild(E('span', 'bo-win', s.fit.exponential.base.toFixed(3)));
      p.appendChild(document.createTextNode(', so ' + v.best.label +
        ', tracking the measurements to within ' + fmtPct(v.best.rms) + '.'));
    } else {
      p.appendChild(document.createTextNode('Measured log–log slope '));
      p.appendChild(E('span', 'bo-slope', s.fit.power.p.toFixed(2)));
      p.appendChild(document.createTextNode(
        ' over n = ' + fmtN(lo) + ' to ' + fmtN(hi) + ', so the timings grow like n^' +
        s.fit.power.p.toFixed(2) + '. Closest candidate: '));
      p.appendChild(E('span', 'bo-win', v.best.label));
      p.appendChild(document.createTextNode(', tracking the measurements to within ' +
        fmtPct(v.best.rms) + '.'));
    }

    if (v.tied.length > 1) {
      var others = [], i;
      for (i = 0; i < v.tied.length; i++) {
        if (v.tied[i] !== v.best) others.push(v.tied[i].label + ' at ' + fmtPct(v.tied[i].rms));
      }
      p.appendChild(document.createTextNode(' But '));
      p.appendChild(E('span', 'bo-miss', others.join(', ')));
      p.appendChild(document.createTextNode(
        (others.length > 1 ? ' sit' : ' sits') +
        ' inside the noise too, and this range cannot separate them. ' +
        'The simplest curve that still fits is ' + v.supported.label +
        ', and that is the honest verdict — "one of these", not a single winner.'));
    } else if (v.second) {
      p.appendChild(document.createTextNode(' The next candidate, ' + v.second.label +
        ', is off by ' + fmtPct(v.second.rms) + ', so the data separates the classes cleanly.'));
    }

    if (s.fit.exponential && v.best.key !== 'exp' &&
        s.fit.exponential.rms < v.best.rms * 1.6 + 0.01) {
      p.appendChild(document.createTextNode(' An exponential also fits this range, ' +
        'with a base of ' + s.fit.exponential.base.toFixed(3) +
        ' — over a short ladder those are hard to tell apart, so widen it before ' +
        'believing either.'));
    }
    return p;
  };

  BigO.prototype.renderCrossover = function (series) {
    if (series.length < 2) {
      var only = E('div', 'bo-card');
      only.appendChild(E('p', 'bo-verdict-line',
        'Both slots are set to the same algorithm, so there is nothing to cross. ' +
        'Pick two different ones — insertion sort against merge sort is the pair ' +
        'worth starting with.'));
      this.verdict.appendChild(only);
      return;
    }
    var a = series[0], b = series[1];
    var card = E('div', 'bo-card');
    var head = E('div', 'bo-card-head');
    head.appendChild(E('span', 'bo-card-name', 'Where they swap places'));
    card.appendChild(head);

    var line = E('p', 'bo-verdict-line');
    if (a.points.length < 3 || b.points.length < 3) {
      line.textContent = 'Run the race first — the crossover needs both curves.';
      card.appendChild(line);
      this.verdict.appendChild(card);
      return;
    }
    // Only sizes both curves actually reached can be compared. A ladder that
    // stopped early on one side would otherwise line up the wrong pairs and
    // invent a crossing that was never measured.
    var bmap = {}, i;
    for (i = 0; i < b.points.length; i++) bmap[b.points[i].n] = b.points[i];
    var av = [], bv = [];
    for (i = 0; i < a.points.length; i++) {
      if (bmap[a.points[i].n]) { av.push(a.points[i]); bv.push(bmap[a.points[i].n]); }
    }
    var found = crossover(av, bv);

    if (!found) {
      var faster = av.length && bv.length && av[av.length - 1].t < bv[bv.length - 1].t ? a : b;
      line.textContent = 'No crossover inside this range: ' + faster.algo.label +
        ' has the lead at both ends of the ladder, so whatever the middle does is ' +
        'noise rather than a change of winner. Widen the ladder, or race a pair whose ' +
        'classes actually differ — two algorithms in the same class run parallel ' +
        'lines and never meet.';
    } else {
      var before = found.aWasFaster ? a : b;
      var after = found.aWasFaster ? b : a;
      var where = found.n === null
        ? 'The lead changes hands somewhere between n = ' + fmtN(found.lo) + ' and n = ' +
          fmtN(found.hi) + ', and the measurements cannot pin it closer than that — near ' +
          'the crossing the two curves are within the noise of each other, which is what ' +
          'a crossover actually looks like when you measure one instead of solving for it. '
        : 'They cross at about n = ' + fmtN(found.n) + '. ';
      line.textContent = where + 'Below it, ' + before.algo.label + ' wins; above it, ' +
        after.algo.label + ' does. The asymptotically better algorithm is the slower ' +
        'one until the input is big enough to pay for its constant factor.';
    }
    card.appendChild(line);
    card.appendChild(E('p', 'bo-card-note',
      'This is not a curiosity. Production sort implementations do exactly this ' +
      'arithmetic at build time and hard-code the answer: V8’s TimSort sorts runs ' +
      'shorter than its minimum run length with binary insertion sort, and libstdc++’s ' +
      'introsort stops recursing at sixteen elements and finishes the whole array with ' +
      'one insertion-sort pass. The crossover you just measured is where that threshold ' +
      'comes from.'));
    this.verdict.appendChild(card);
  };

  BigO.prototype.rows = function (series) {
    var rows = [], i, k;
    for (i = 0; i < series.length; i++) {
      for (k = 0; k < series[i].points.length; k++) {
        var c = series[i].points[k];
        rows.push([series[i].algo.label, c.n, c.t, c.min, c.max, c.reps, c.k]);
      }
    }
    return rows;
  };

  BigO.prototype.renderTable = function (series) {
    clear(this.detailsBody);
    var rows = this.rows(series);
    if (!rows.length) {
      this.detailsBody.appendChild(E('p', 'bo-hint', 'No measurements yet.'));
      this.detailsSummary.textContent = 'Every measurement, as a table';
      return;
    }
    this.detailsSummary.textContent = 'Every measurement, as a table (' + rows.length + ' rows)';

    var t = E('table', 'bo-table');
    var thead = E('thead'), htr = E('tr');
    ['Algorithm', 'n', 'median', 'fastest', 'slowest', 'runs', 'inner repeat']
      .forEach(function (h) { htr.appendChild(E('th', null, h)); });
    thead.appendChild(htr);
    t.appendChild(thead);
    var tb = E('tbody');
    rows.forEach(function (r) {
      var tr = E('tr');
      tr.appendChild(E('td', null, r[0]));
      tr.appendChild(E('td', null, fmtN(r[1])));
      tr.appendChild(E('td', null, fmtTime(r[2])));
      tr.appendChild(E('td', null, fmtTime(r[3])));
      tr.appendChild(E('td', null, fmtTime(r[4])));
      tr.appendChild(E('td', null, String(r[5])));
      tr.appendChild(E('td', null, '×' + fmtN(r[6])));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    this.detailsBody.appendChild(t);
  };

  BigO.prototype.csv = function () {
    var rows = this.rows(this.seriesList());
    var lines = ['algorithm,n,median_ms,fastest_ms,slowest_ms,runs,inner_repeat'];
    rows.forEach(function (r) {
      lines.push('"' + r[0] + '",' + r[1] + ',' + r[2] + ',' + r[3] + ',' + r[4] +
                 ',' + r[5] + ',' + r[6]);
    });
    return lines.join('\n');
  };

  /* Clipboard with a selection fallback, because navigator.clipboard is absent
     on older browsers and refused outside a secure context. Neither path can
     be allowed to throw into the click handler. */
  BigO.prototype.copyCsv = function () {
    var self = this, text = this.csv();
    function ok() {
      self.btnCopy.textContent = 'Copied';
      setTimeout(function () { self.btnCopy.textContent = 'Copy as CSV'; }, 1600);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (err) { done = false; }
      document.body.removeChild(ta);
      if (done) ok(); else self.btnCopy.textContent = 'Copy failed';
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, fallback);
        return;
      }
    } catch (err) { /* fall through */ }
    fallback();
  };

  /* ======================================================================== */
  /*  8. SELF-CHECK                                                          */
  /* ------------------------------------------------------------------------ */
  /*  A fast wrong answer is not a result. Before the page trusts a sort's     */
  /*  timings it checks the sort actually sorts, and it checks the fitter on   */
  /*  synthetic data whose class is known exactly.                            */
  /* ======================================================================== */

  function selfTest() {
    var failures = [], input = randomArray(400, 99), i;

    var sorts = [
      ['merge sort', function (a) { return mergeSort(a); }],
      ['insertion sort', function (a) { return insertionSort(a); }],
      ['bubble sort', function (a) { return bubbleSort(a); }],
      ['built-in sort', function (a) { return numericSort(a); }]
    ];
    for (i = 0; i < sorts.length; i++) {
      var out = sorts[i][1](input.slice());
      if (!isSorted(out) || out.length !== input.length) failures.push(sorts[i][0]);
    }

    var sorted = rampArray(1000);
    for (i = 0; i < 1000; i += 97) {
      if (binarySearch(sorted, i * 2) !== i) failures.push('binary search at ' + i);
    }
    if (fib(20) !== 6765) failures.push('fibonacci');
    if (subsetWalk(10) !== 512) failures.push('subset walk');

    // Synthetic curves with no noise: the fitter must name the class it was
    // handed, and the free power fit must recover the exponent.
    var cases = [
      { f: function (n) { return 3e-6 * n; }, want: 'n', p: 1 },
      { f: function (n) { return 5e-9 * n * n; }, want: 'n2', p: 2 },
      { f: function (n) { return 2e-7 * n * Math.log(n); }, want: 'nlogn', p: null }
    ];
    for (i = 0; i < cases.length; i++) {
      var pts = [], n;
      for (n = 128; n <= 131072; n *= 2) pts.push({ n: n, t: cases[i].f(n) });
      var res = fitAll(pts);
      if (!res || res.ranked[0].key !== cases[i].want) {
        failures.push('fit expected ' + cases[i].want + ', got ' +
          (res ? res.ranked[0].key : 'nothing'));
      }
      if (cases[i].p !== null && Math.abs(res.power.p - cases[i].p) > 0.02) {
        failures.push('power fit expected ' + cases[i].p + ', got ' + res.power.p.toFixed(3));
      }
    }

    var expPts = [], m;
    for (m = 10; m <= 24; m += 2) expPts.push({ n: m, t: 1e-6 * Math.pow(2, m) });
    var expRes = expFit(expPts);
    if (!expRes || Math.abs(expRes.base - 2) > 0.01) {
      failures.push('exponential base expected 2, got ' + (expRes ? expRes.base : 'nothing'));
    }

    return { passed: failures.length === 0, failures: failures };
  }

  /* ======================================================================== */
  /*  9. BOOT                                                                */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('bigoviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-bigo-mount') || rootEl;
    clear(mount);
    try {
      var lab = new BigO(mount);
      window.BigOLab = {
        selfTest: selfTest,
        fitAll: fitAll,
        powerFit: powerFit,
        instance: lab
      };
    } catch (err) {
      var msg = E('p', 'lab-proc-fallback',
        'The complexity lab could not start in this browser (' + err.message +
        '). Please tell me, and mention which browser you are using.');
      mount.appendChild(msg);
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'bigoviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

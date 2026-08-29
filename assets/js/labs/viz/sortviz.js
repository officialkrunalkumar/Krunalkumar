/* ==========================================================================
   sortviz.js — an algorithm visualiser: sorting bars, array search, and grid
   pathfinding.
   --------------------------------------------------------------------------
   The point of this toy is a thing a Big-O table cannot show you: WHY O(n^2)
   and O(n log n) are different sizes of slow. Put bubble sort next to
   quicksort on the SAME data and the comparison counter does the arguing —
   one number crawls past ten thousand while the other is done in a few
   hundred. Same for search: Dijkstra floods the whole board like spilled
   water while A*, told roughly where the exit is, walks almost straight to
   it. You can read that in a textbook or you can watch it happen in a second.

   Non-obvious decisions, because they shape the whole file:

   0. COMPARE IS A CONTROL, NOT AN ALGORITHM. The side-by-side used to be two
      hardcoded entries in the algorithm dropdowns — "Compare: Bubble vs
      Quicksort" and "Compare: Dijkstra vs A*" — so two pairings existed out of
      the 209 the three modes can express (13*13 sorts, 2*2 searches, 6*6
      pathfinders), and the algorithm dropdown could not say which of its own
      entries a "Compare:" row was actually running. It is now a separate
      "Compare" select plus an A and a B picker, so every mode gets every
      pairing, including an algorithm against itself (two identical panels,
      which is the cheapest possible demonstration that a recorded run is
      deterministic). The engine never needed teaching: panelsFor() has always
      split the canvas at two items and advanceAll() has always stepped every
      item once per tick, so compare is a UI concern and a buildX() concern and
      nothing else.

   1. RECORD-AND-REPLAY, not resumable coroutines. House rules are ES5 — no
      generators — so a sort cannot be paused mid-recursion and resumed. So
      instead of animating the algorithm live, we run it once to completion on
      a scratch copy and record every comparison, swap and write as a tiny op
      [code, a, b]. Animation is then just replaying that op list at whatever
      rate the speed slider asks for. This buys three things for free: it is
      trivially steppable (advance the op index), pausable, and rewindable
      (rebuild state from op 0), and the live comparison/swap counters fall
      straight out of counting op codes as they replay. The cost is memory —
      bubble sort at 300 bars is ~90k ops — which is why the size cap is a few
      hundred, not a few thousand. That is plenty to see the shape.

   2. SPEED IS OPS-PER-FRAME, with a fractional accumulator. At the slow end
      it is well below one op per frame (true slow-motion, effectively
      single-step), at the fast end a few hundred ops per frame (the big
      arrays finish while you watch). One rAF loop drives everything; there is
      no per-op setTimeout, which would cap out around 250/sec and never keep
      up with the fast end.

   3. Dijkstra and BFS look almost identical here, and that is correct, not a
      bug: on an unweighted 4-connected grid the two explore in the same
      order. The honest, useful contrast is Dijkstra/BFS (uniform flood)
      versus A* (goal-directed) — which is exactly the side-by-side compare
      option. Weighted terrain would separate Dijkstra from BFS but would also
      complicate the wall-drawing UX for little teaching gain, so it is left
      out on purpose.

   Everything is arithmetic in this tab. No fetch, no XHR, no worker even —
   the recording pass is fast enough to stay on the main thread, and the rAF
   replay keeps the Stop button responsive. That is the whole Labs promise:
   nothing here opens a network connection.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ---- op codes for the recorded sort trace ---------------------------- */
  var CMP = 0;      // compared indices a and b
  var SWAP = 1;     // swapped indices a and b
  var SET = 2;      // wrote value b into index a (merge sort, shifts)
  var SORTED = 3;   // index a is now in its final place (green)

  /* ---- op codes for the recorded array-search trace -------------------- */
  // Continues the numbering above rather than starting a second scale: the two
  // traces never mix in one item, but a shared range means a stray op from the
  // wrong recorder shows up as an unhandled case instead of quietly meaning
  // something else.
  var PROBE = 4;    // examined index a — this is the comparison being counted
  var RANGE = 5;    // the live window narrowed to [a, b] (binary only)
  var FOUND = 6;    // target is at index a
  var MISS = 7;     // the strategy is exhausted and the target is not present

  /* ---- palette, lifted from labs.css so the canvas matches the chrome --- */
  var COL = {
    bg: '#020617',
    bar: '#5b7290',
    barSorted: '#4ade80',
    barCmp: '#fbbf24',
    barSwap: '#f87171',
    barSet: '#7dd3fc',
    text: '#e2e8f0',
    dim: '#7891ac',
    accent: '#7dd3fc',
    green: '#4ade80',
    amber: '#fbbf24',
    red: '#f87171',
    gEmpty: '#0b1220',
    gWall: '#33415a',
    gStart: '#4ade80',
    gEnd: '#fb7185',
    gPath: '#facc15',
    gFrontier: '#a5f3fc'
  };
  var VIS_DEEP = [21, 94, 117];   // #155e75, earliest visited
  var VIS_NEAR = [56, 189, 248];  // #38bdf8, most recently visited
  var LH = 40;                     // label strip height at the top of a panel
  var GUTTER = 16;                 // gap between two side-by-side panels
  var FONT = '"Cascadia Code", "Cascadia Mono", Consolas, monospace';

  var DISTS = ['random', 'nearly-sorted', 'reversed', 'few-unique'];
  var PATH_GENS = ['clear board', 'random walls', 'maze'];
  /* The three target placements "New data" cycles through in search mode. They
     are chosen so the two algorithms disagree in a different way each time:
     near-end is linear's worst case and costs binary its usual ~log2(n) probes;
     near-start is linear's best case and is the one shape where it can WIN;
     absent forces both to run their strategy to exhaustion, which is where the
     n versus log2(n) gap is widest and neither gets to stop early. */
  var TARGETS = ['near-end', 'near-start', 'absent'];

  var SORT_ALGOS = [
    ['bubble', 'Bubble sort'],
    ['insertion', 'Insertion sort'],
    ['selection', 'Selection sort'],
    ['shell', 'Shell sort'],
    ['comb', 'Comb sort'],
    ['cocktail', 'Cocktail shaker sort'],
    ['gnome', 'Gnome sort'],
    ['oddeven', 'Odd-even sort'],
    ['merge', 'Merge sort'],
    ['quick', 'Quicksort'],
    ['heap', 'Heap sort'],
    ['counting', 'Counting sort'],
    ['radix', 'Radix sort (LSD)']
  ];
  var SEARCH_ALGOS = [
    ['linear', 'Linear search'],
    ['binary', 'Binary search']
  ];
  var PATH_ALGOS = [
    ['bfs', 'BFS (breadth-first)'],
    ['dfs', 'DFS (depth-first)'],
    ['dijkstra', 'Dijkstra'],
    ['astar', 'A* (A-star)'],
    ['greedy', 'Greedy best-first'],
    ['bidirectional', 'Bidirectional BFS']
  ];
  var ALGO_LABEL = {
    bubble: 'Bubble sort', insertion: 'Insertion sort', selection: 'Selection sort',
    shell: 'Shell sort', comb: 'Comb sort', cocktail: 'Cocktail shaker sort',
    gnome: 'Gnome sort', oddeven: 'Odd-even sort',
    merge: 'Merge sort', quick: 'Quicksort', heap: 'Heap sort',
    counting: 'Counting sort', radix: 'Radix sort (LSD)',
    linear: 'Linear search', binary: 'Binary search',
    bfs: 'BFS', dfs: 'DFS', dijkstra: 'Dijkstra', astar: 'A*',
    greedy: 'Greedy best-first', bidirectional: 'Bidirectional BFS'
  };

  /* ---- module state ---------------------------------------------------- */
  var canvas, ctx, statsEl, algoEl, modeEl, sizeEl, speedEl, genBtn, runBtn, stopBtn;
  var compareEl, algoAEl, algoBEl, algoLab, algoALab, algoBLab;
  var W = 0, H = 0, dpr = 1;
  var mode = 'sort';           // sort | search | path
  var algo = 'bubble';
  var state = 'idle';          // idle | playing | paused | done
  var rafHandle = null;
  var acc = 0;                 // fractional op accumulator

  /* compare state. `algo` is the single-panel pick; cmpA/cmpB are the two
     side-by-side picks, kept PER MODE so a trip through Searching and back
     does not forget that you had bubble against quicksort set up. */
  var compare = 'none';        // none | two
  var cmpA = { sort: 'bubble', search: 'linear', path: 'dijkstra' };
  var cmpB = { sort: 'quick', search: 'binary', path: 'astar' };

  // sort state
  var sortN = 64;
  var maxVal = 64;
  var distIndex = 0;
  var initialArr = [];
  var runs = [];               // one or two run objects

  // array-search state
  var srchN = 64;
  var srchMax = 64;            // largest value in srchArr, for bar heights
  var targetIndex = 0;
  var srchArr = [];
  var srchTarget = 0;
  var scans = [];              // one or two scan objects

  // path state
  var gridCols = 30, gridRows = 16;
  var walls = null;            // Uint8Array
  var gridStart = 0, gridEnd = 0;
  var pathGenIndex = 0;
  var pathDirty = false;
  var searches = [];           // one or two search objects
  var drag = null;             // 'wall' | 'start' | 'end'
  var wallPaint = 1;

  function $(id) { return document.getElementById(id); }

  /* ---- small raf shims so the toy also works without viz-shell present -- */
  function raf(fn) {
    if (window.LabViz && LabViz.raf) return LabViz.raf(fn);
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return window.setTimeout(function () { fn(Date.now()); }, 16);
  }
  function cancelRaf(h) {
    if (h == null) return;
    if (window.LabViz && LabViz.cancelRaf) { LabViz.cancelRaf(h); return; }
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(h);
    else window.clearTimeout(h);
  }

  /* ---- slider reading. Ranges are defined in the HTML we do not own, so
     everything is normalised to 0..1 and mapped here. --------------------- */
  function norm(el, def) {
    if (!el) return def;
    var mn = parseFloat(el.min), mx = parseFloat(el.max), v = parseFloat(el.value);
    if (isNaN(mn)) mn = 0;
    if (isNaN(mx)) mx = 100;
    if (isNaN(v)) v = (mn + mx) / 2;
    if (mx <= mn) return 0.5;
    var t = (v - mn) / (mx - mn);
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }
  function opsPerFrame() { return 0.1 * Math.pow(4200, norm(speedEl, 0.5)); }
  function sizeToN() { return Math.round(8 + norm(sizeEl, 0.5) * (300 - 8)); }
  function sizeToCols() { return Math.round(12 + norm(sizeEl, 0.5) * (60 - 12)); }
  function speedPct() { return Math.round(norm(speedEl, 0.5) * 100) + '%'; }

  /* ====================================================================== */
  /*  SORTING — recorders. Each runs the real algorithm on a scratch copy   */
  /*  and pushes ops; nothing here draws.                                   */
  /* ====================================================================== */

  function recBubble(a, ops) {
    var n = a.length, i, j, swapped, k, t;
    for (i = 0; i < n - 1; i++) {
      swapped = false;
      for (j = 0; j < n - 1 - i; j++) {
        ops.push([CMP, j, j + 1]);
        if (a[j] > a[j + 1]) {
          ops.push([SWAP, j, j + 1]);
          t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;
          swapped = true;
        }
      }
      ops.push([SORTED, n - 1 - i]);
      if (!swapped) { for (k = 0; k < n - 1 - i; k++) ops.push([SORTED, k]); return; }
    }
    ops.push([SORTED, 0]);
  }

  /* Insertion as adjacent swaps: visually the key "sinks" left into place,
     and it breaks out of the inner loop early — which is exactly why a
     nearly-sorted array is cheap for it and murder for selection sort. */
  function recInsertion(a, ops) {
    var n = a.length, i, j, t;
    ops.push([SORTED, 0]);
    for (i = 1; i < n; i++) {
      j = i;
      while (j > 0) {
        ops.push([CMP, j - 1, j]);
        if (a[j - 1] > a[j]) {
          ops.push([SWAP, j - 1, j]);
          t = a[j - 1]; a[j - 1] = a[j]; a[j] = t;
          j--;
        } else break;
      }
    }
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  /* Selection: always ~n^2 comparisons but only n swaps. The counters make
     that split obvious next to bubble. */
  function recSelection(a, ops) {
    var n = a.length, i, j, m, t;
    for (i = 0; i < n - 1; i++) {
      m = i;
      for (j = i + 1; j < n; j++) {
        ops.push([CMP, m, j]);
        if (a[j] < a[m]) m = j;
      }
      if (m !== i) { ops.push([SWAP, i, m]); t = a[i]; a[i] = a[m]; a[m] = t; }
      ops.push([SORTED, i]);
    }
    ops.push([SORTED, n - 1]);
  }

  /* Top-down merge: no swaps at all, only writes (SET). Watching the writes
     counter climb while the swaps counter stays at zero is the tell. */
  function recMerge(a, ops) {
    var n = a.length, aux = a.slice(), i;
    function merge(lo, mid, hi) {
      var k;
      for (k = lo; k <= hi; k++) aux[k] = a[k];
      var x = lo, y = mid + 1;
      for (k = lo; k <= hi; k++) {
        if (x > mid) { ops.push([SET, k, aux[y]]); a[k] = aux[y]; y++; }
        else if (y > hi) { ops.push([SET, k, aux[x]]); a[k] = aux[x]; x++; }
        else {
          ops.push([CMP, x, y]);
          if (aux[y] < aux[x]) { ops.push([SET, k, aux[y]]); a[k] = aux[y]; y++; }
          else { ops.push([SET, k, aux[x]]); a[k] = aux[x]; x++; }
        }
      }
    }
    function sort(lo, hi) {
      if (lo >= hi) return;
      var mid = (lo + hi) >> 1;
      sort(lo, mid); sort(mid + 1, hi); merge(lo, mid, hi);
    }
    sort(0, n - 1);
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  /* Lomuto quicksort with a median-of-three pivot moved to the high end
     (highlighted every comparison). The median-of-three matters: a naive
     last-element pivot is O(n^2) on already-sorted or reversed input — a real
     worst case, but one that would wreck the "n log n" half of the side-by-
     side comparison. Sampling three keeps partitions balanced on the shapes
     this toy generates, which is what production quicksorts do. */
  function recQuick(a, ops) {
    function part(lo, hi) {
      var mid = (lo + hi) >> 1, t, medIdx, A, B, C;
      // median of a[lo], a[mid], a[hi] -> swap the median to a[hi]
      ops.push([CMP, lo, mid]); ops.push([CMP, mid, hi]); ops.push([CMP, lo, hi]);
      A = a[lo]; B = a[mid]; C = a[hi];
      if ((A <= B && B <= C) || (C <= B && B <= A)) medIdx = mid;
      else if ((B <= A && A <= C) || (C <= A && A <= B)) medIdx = lo;
      else medIdx = hi;
      if (medIdx !== hi) { ops.push([SWAP, medIdx, hi]); t = a[medIdx]; a[medIdx] = a[hi]; a[hi] = t; }
      var pivot = a[hi], i = lo, j;
      for (j = lo; j < hi; j++) {
        ops.push([CMP, j, hi]);
        if (a[j] < pivot) {
          if (i !== j) { ops.push([SWAP, i, j]); t = a[i]; a[i] = a[j]; a[j] = t; }
          i++;
        }
      }
      if (i !== hi) { ops.push([SWAP, i, hi]); t = a[i]; a[i] = a[hi]; a[hi] = t; }
      ops.push([SORTED, i]);
      return i;
    }
    function qs(lo, hi) {
      if (lo > hi) return;
      if (lo === hi) { ops.push([SORTED, lo]); return; }
      var p = part(lo, hi);
      qs(lo, p - 1); qs(p + 1, hi);
    }
    qs(0, a.length - 1);
  }

  function recHeap(a, ops) {
    var n = a.length, start, end, t;
    function siftDown(root, last) {
      var child, t2;
      while (true) {
        child = 2 * root + 1;
        if (child > last) break;
        if (child + 1 <= last) {
          ops.push([CMP, child, child + 1]);
          if (a[child + 1] > a[child]) child++;
        }
        ops.push([CMP, root, child]);
        if (a[root] < a[child]) {
          ops.push([SWAP, root, child]);
          t2 = a[root]; a[root] = a[child]; a[child] = t2;
          root = child;
        } else break;
      }
    }
    for (start = (n - 2) >> 1; start >= 0; start--) siftDown(start, n - 1);
    for (end = n - 1; end > 0; end--) {
      ops.push([SWAP, 0, end]); t = a[0]; a[0] = a[end]; a[end] = t;
      ops.push([SORTED, end]);
      siftDown(0, end - 1);
    }
    ops.push([SORTED, 0]);
  }

  /* Shell sort: gapped insertion, expressed as gapped adjacent swaps so it
     speaks the same CMP/SWAP vocabulary as bubble. The gap starts at n/2 and
     halves each pass; the last pass (gap 1) is a plain insertion sort over an
     array that is already almost ordered, which is the whole point — the big
     gaps move far-out-of-place values home cheaply first. */
  function recShell(a, ops) {
    var n = a.length, gap, i, j, t;
    for (gap = n >> 1; gap > 0; gap >>= 1) {
      for (i = gap; i < n; i++) {
        j = i;
        while (j >= gap) {
          ops.push([CMP, j - gap, j]);
          if (a[j - gap] > a[j]) {
            ops.push([SWAP, j - gap, j]);
            t = a[j - gap]; a[j - gap] = a[j]; a[j] = t;
            j -= gap;
          } else break;
        }
      }
    }
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  /* Comb sort: bubble's cure for "turtles" (small values stranded near the
     end). It compares elements a shrinking gap apart — gap /= 1.3 each pass —
     collapsing to gap 1, at which point it is bubble sort finishing a nearly
     ordered array. */
  function recComb(a, ops) {
    var n = a.length, gap = n, swapped = true, i, t;
    while (gap > 1 || swapped) {
      gap = Math.floor(gap / 1.3);
      if (gap < 1) gap = 1;
      swapped = false;
      for (i = 0; i + gap < n; i++) {
        ops.push([CMP, i, i + gap]);
        if (a[i] > a[i + gap]) {
          ops.push([SWAP, i, i + gap]);
          t = a[i]; a[i] = a[i + gap]; a[i + gap] = t;
          swapped = true;
        }
      }
    }
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  /* Cocktail shaker: bubble that reverses direction each pass, so light values
     rise on the forward sweep and heavy ones sink on the backward one. Both
     ends firm up, so a SORTED marker is emitted at each shrinking boundary. */
  function recCocktail(a, ops) {
    var n = a.length, lo = 0, hi = n - 1, swapped, i, t;
    if (n === 0) return;
    while (lo < hi) {
      swapped = false;
      for (i = lo; i < hi; i++) {
        ops.push([CMP, i, i + 1]);
        if (a[i] > a[i + 1]) {
          ops.push([SWAP, i, i + 1]);
          t = a[i]; a[i] = a[i + 1]; a[i + 1] = t;
          swapped = true;
        }
      }
      ops.push([SORTED, hi]); hi--;
      if (!swapped) break;
      swapped = false;
      for (i = hi; i > lo; i--) {
        ops.push([CMP, i - 1, i]);
        if (a[i - 1] > a[i]) {
          ops.push([SWAP, i - 1, i]);
          t = a[i - 1]; a[i - 1] = a[i]; a[i] = t;
          swapped = true;
        }
      }
      ops.push([SORTED, lo]); lo++;
      if (!swapped) break;
    }
    for (i = lo; i <= hi; i++) ops.push([SORTED, i]);
  }

  /* Gnome sort: the simplest correct sort there is — step right when the pair
     is in order, swap and step left when it is not. It is insertion sort with
     the bookkeeping thrown away. */
  function recGnome(a, ops) {
    var n = a.length, i = 1, t;
    while (i < n) {
      if (i === 0) { i++; continue; }
      ops.push([CMP, i - 1, i]);
      if (a[i - 1] > a[i]) {
        ops.push([SWAP, i - 1, i]);
        t = a[i - 1]; a[i - 1] = a[i]; a[i] = t;
        i--;
      } else i++;
    }
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  /* Odd-even (brick) sort: alternate passes compare-and-swap the (odd,even)
     then (even,odd) neighbour pairs until a full sweep makes no swap. The
     fixed pair pattern is what makes it a natural fit for parallel hardware;
     here it just looks like bubble in two interleaved colours. */
  function recOddEven(a, ops) {
    var n = a.length, sorted = false, i, t;
    while (!sorted) {
      sorted = true;
      for (i = 1; i + 1 < n; i += 2) {
        ops.push([CMP, i, i + 1]);
        if (a[i] > a[i + 1]) {
          ops.push([SWAP, i, i + 1]);
          t = a[i]; a[i] = a[i + 1]; a[i + 1] = t;
          sorted = false;
        }
      }
      for (i = 0; i + 1 < n; i += 2) {
        ops.push([CMP, i, i + 1]);
        if (a[i] > a[i + 1]) {
          ops.push([SWAP, i, i + 1]);
          t = a[i]; a[i] = a[i + 1]; a[i + 1] = t;
          sorted = false;
        }
      }
    }
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  /* Counting sort (stable). No comparisons and no swaps at all — it tallies
     how many of each value there are, turns that into positions, and WRITES
     each value straight to its final slot (recorded as SET). This only works
     because the bar VALUES here are small positive integers (1..maxVal); a
     general counting sort needs the key range to be small, and that is exactly
     the precondition this toy happens to satisfy. Stability comes from walking
     the input right-to-left while decrementing the running counts. */
  function recCounting(a, ops) {
    var n = a.length, i, v, mx = 0;
    if (n === 0) return;
    for (i = 0; i < n; i++) if (a[i] > mx) mx = a[i];
    var count = new Array(mx + 1);
    for (i = 0; i <= mx; i++) count[i] = 0;
    for (i = 0; i < n; i++) count[a[i]]++;
    for (i = 1; i <= mx; i++) count[i] += count[i - 1];   // prefix sums -> end positions
    var out = new Array(n);
    for (i = n - 1; i >= 0; i--) { v = a[i]; count[v]--; out[count[v]] = v; }
    // Replay the result as an in-order left-to-right fill; each slot is final
    // the moment it is written, so pair every SET with a SORTED marker.
    for (i = 0; i < n; i++) {
      ops.push([SET, i, out[i]]); a[i] = out[i];
      ops.push([SORTED, i]);
    }
  }

  /* Radix sort (LSD, base 10): a sequence of stable counting passes, one per
     decimal digit from least to most significant. Each pass rewrites the whole
     array (recorded as SET) into digit order; after the most significant digit
     the array is fully sorted. Like counting sort it leans on the values being
     small non-negative integers, which they are here. */
  function recRadix(a, ops) {
    var n = a.length, i, mx = 0, exp, digit, v;
    if (n === 0) return;
    for (i = 0; i < n; i++) if (a[i] > mx) mx = a[i];
    var count, out;
    for (exp = 1; Math.floor(mx / exp) > 0; exp *= 10) {
      count = new Array(10);
      for (i = 0; i < 10; i++) count[i] = 0;
      for (i = 0; i < n; i++) count[Math.floor(a[i] / exp) % 10]++;
      for (i = 1; i < 10; i++) count[i] += count[i - 1];
      out = new Array(n);
      for (i = n - 1; i >= 0; i--) {
        digit = Math.floor(a[i] / exp) % 10;
        count[digit]--;
        out[count[digit]] = a[i];
      }
      for (i = 0; i < n; i++) {
        if (a[i] !== out[i]) { ops.push([SET, i, out[i]]); a[i] = out[i]; }
      }
    }
    for (i = 0; i < n; i++) ops.push([SORTED, i]);
  }

  function recordSort(name, values) {
    var a = values.slice(), ops = [];
    if (name === 'bubble') recBubble(a, ops);
    else if (name === 'insertion') recInsertion(a, ops);
    else if (name === 'selection') recSelection(a, ops);
    else if (name === 'shell') recShell(a, ops);
    else if (name === 'comb') recComb(a, ops);
    else if (name === 'cocktail') recCocktail(a, ops);
    else if (name === 'gnome') recGnome(a, ops);
    else if (name === 'oddeven') recOddEven(a, ops);
    else if (name === 'merge') recMerge(a, ops);
    else if (name === 'quick') recQuick(a, ops);
    else if (name === 'heap') recHeap(a, ops);
    else if (name === 'counting') recCounting(a, ops);
    else if (name === 'radix') recRadix(a, ops);
    return ops;
  }

  function makeRun(name, values) {
    var n = values.length, sorted = new Array(n), i;
    for (i = 0; i < n; i++) sorted[i] = false;
    return {
      algo: name,
      arr: values.slice(),
      ops: recordSort(name, values),
      idx: 0,
      comparisons: 0, swaps: 0, writes: 0,
      sorted: sorted,
      active: null,
      done: false
    };
  }

  /* Apply the next op to a run, updating its display array and counters.
     Returns false when the run has no ops left. */
  function stepRun(run) {
    if (run.idx >= run.ops.length) { run.done = true; return false; }
    var op = run.ops[run.idx++], t;
    switch (op[0]) {
      case CMP: run.comparisons++; run.active = op; break;
      case SWAP:
        run.swaps++;
        t = run.arr[op[1]]; run.arr[op[1]] = run.arr[op[2]]; run.arr[op[2]] = t;
        run.active = op; break;
      case SET: run.writes++; run.arr[op[1]] = op[2]; run.active = op; break;
      case SORTED: run.sorted[op[1]] = true; break;
    }
    if (run.idx >= run.ops.length) run.done = true;
    return true;
  }

  function resetRunProgress(run) {
    run.idx = 0; run.comparisons = 0; run.swaps = 0; run.writes = 0;
    run.active = null; run.done = false;
    var i;
    for (i = 0; i < run.arr.length; i++) run.sorted[i] = false;
    // rebuild the display array from the ops is unnecessary; we kept initial
    // values inside ops indirectly, so restore from initialArr instead.
    for (i = 0; i < initialArr.length; i++) run.arr[i] = initialArr[i];
  }

  /* ---- array generation ------------------------------------------------ */
  function shuffle(a) {
    var i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function generateArray() {
    var n = sortN, a = [], i, dist = DISTS[distIndex];
    maxVal = n;
    if (dist === 'reversed') {
      for (i = 0; i < n; i++) a[i] = n - i;
    } else if (dist === 'nearly-sorted') {
      for (i = 0; i < n; i++) a[i] = i + 1;
      var swaps = Math.max(2, Math.round(n * 0.06)), k, off, t;
      for (k = 0; k < swaps; k++) {
        i = Math.floor(Math.random() * (n - 1));
        off = 1 + Math.floor(Math.random() * 2);
        var j = Math.min(n - 1, i + off);
        t = a[i]; a[i] = a[j]; a[j] = t;
      }
    } else if (dist === 'few-unique') {
      var levels = 5;
      for (i = 0; i < n; i++) {
        a[i] = Math.round((1 + Math.floor(Math.random() * levels)) / levels * n);
      }
    } else { // random
      for (i = 0; i < n; i++) a[i] = i + 1;
      shuffle(a);
    }
    initialArr = a;
  }

  /* ====================================================================== */
  /*  ARRAY SEARCH — linear vs binary, recorded the same way the sorts are. */
  /* ====================================================================== */

  /* Both recorders take the array and the target and push ops; like the sorts
     they run to completion up front so the replay is steppable in both
     directions. Neither writes to `a` — a search does not disturb its input —
     which is why the two scan objects can share one array reference and be
     provably fed identical data. */

  function recLinear(a, target, ops) {
    var n = a.length, i;
    for (i = 0; i < n; i++) {
      ops.push([PROBE, i]);
      if (a[i] === target) { ops.push([FOUND, i]); return; }
    }
    ops.push([MISS]);
  }

  /* Textbook half-open-free binary search on an ascending array. Two details
     that are bugs in most hand-written versions and are deliberate here:
     the midpoint is lo + ((hi - lo) >> 1) rather than (lo + hi) >> 1, which
     cannot overflow on a large lo+hi; and the loop condition is lo <= hi with
     hi moving to mid - 1, so a one-element window is still probed instead of
     being skipped. An empty array enters with hi = -1 and falls straight to
     MISS without touching a[]. */
  function recBinary(a, target, ops) {
    var lo = 0, hi = a.length - 1, mid;
    while (lo <= hi) {
      ops.push([RANGE, lo, hi]);
      mid = lo + ((hi - lo) >> 1);
      ops.push([PROBE, mid]);
      if (a[mid] === target) { ops.push([FOUND, mid]); return; }
      if (a[mid] < target) lo = mid + 1;
      else hi = mid - 1;
    }
    ops.push([MISS]);
  }

  function recordScan(name, values, target) {
    var ops = [];
    if (name === 'binary') recBinary(values, target, ops);
    else recLinear(values, target, ops);
    return ops;
  }

  function makeScan(name, values, target) {
    return {
      algo: name,
      arr: values,
      target: target,
      ops: recordScan(name, values, target),
      idx: 0,
      comparisons: 0,
      probe: -1,
      // The live window. Linear never emits RANGE, so its window stays the
      // whole array for the whole run — which is the honest picture, and the
      // reason the two panels look so different without any per-algorithm
      // branching in the drawing code.
      lo: 0, hi: values.length - 1,
      foundAt: -1, miss: false, done: false
    };
  }

  function stepScan(s) {
    if (s.idx >= s.ops.length) { s.done = true; return false; }
    var op = s.ops[s.idx++];
    switch (op[0]) {
      case RANGE: s.lo = op[1]; s.hi = op[2]; break;
      case PROBE: s.comparisons++; s.probe = op[1]; break;
      case FOUND: s.foundAt = op[1]; break;
      case MISS: s.miss = true; break;
    }
    if (s.idx >= s.ops.length) s.done = true;
    return true;
  }

  function resetScanProgress(s) {
    s.idx = 0; s.comparisons = 0; s.probe = -1;
    s.lo = 0; s.hi = s.arr.length - 1;
    s.foundAt = -1; s.miss = false; s.done = false;
  }

  /* Ascending values with a gap of 2 or 3 between neighbours. The jitter is
     not decoration: a run of consecutive integers has no absent value below
     the maximum, so the "absent" case would have to hunt above the top of the
     chart and the target guide line would fall off the panel. With every gap
     at least 2 wide, a[k] + 1 is guaranteed to be missing and still inside the
     drawn value range. */
  function generateSortedArray() {
    var n = srchN, a = [], i;
    for (i = 0; i < n; i++) a[i] = (i === 0 ? 0 : a[i - 1]) + randInt(2, 3);
    srchArr = a;
    srchMax = n > 0 ? a[n - 1] : 1;
    var tcase = TARGETS[targetIndex], span = Math.min(3, n);
    if (tcase === 'near-start') srchTarget = a[randInt(0, span - 1)];
    else if (tcase === 'absent') srchTarget = a[randInt(0, Math.max(0, n - 2))] + 1;
    else srchTarget = a[n - randInt(1, span)];   // near-end
  }

  /* ====================================================================== */
  /*  PATHFINDING — grid, min-heap, and the four searches.                  */
  /* ====================================================================== */

  var DR = [-1, 0, 1, 0], DC = [0, 1, 0, -1];

  function idxOf(r, c) { return r * gridCols + c; }
  function rowOf(i) { return Math.floor(i / gridCols); }
  function colOf(i) { return i % gridCols; }

  function heapNew() { return { p: [], v: [] }; }
  function heapSize(h) { return h.p.length; }
  function heapPush(h, prio, node) {
    var p = h.p, v = h.v, i = p.length, par, t;
    p.push(prio); v.push(node);
    while (i > 0) {
      par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      t = p[i]; p[i] = p[par]; p[par] = t;
      t = v[i]; v[i] = v[par]; v[par] = t;
      i = par;
    }
  }
  function heapPop(h) {
    var p = h.p, v = h.v, n = p.length;
    if (n === 0) return -1;
    var top = v[0], lp = p.pop(), lv = v.pop(), t;
    n--;
    if (n > 0) {
      p[0] = lp; v[0] = lv;
      var i = 0, l, r, m;
      while (true) {
        l = 2 * i + 1; r = 2 * i + 2; m = i;
        if (l < n && p[l] < p[m]) m = l;
        if (r < n && p[r] < p[m]) m = r;
        if (m === i) break;
        t = p[i]; p[i] = p[m]; p[m] = t;
        t = v[i]; v[i] = v[m]; v[m] = t;
        i = m;
      }
    }
    return top;
  }

  function newParent(n) {
    var p = new Int32Array(n), i;
    for (i = 0; i < n; i++) p[i] = -1;
    return p;
  }

  function reconstruct(parent, start, end) {
    var path = [], cur = end, guard = 0, cap = parent.length + 2;
    if (end !== start && parent[end] === -1) return path;
    while (cur !== -1 && guard++ < cap) {
      path.push(cur);
      if (cur === start) break;
      cur = parent[cur];
    }
    path.reverse();
    return (path.length && path[0] === start) ? path : [];
  }

  function manhattan(i, j) {
    return Math.abs(rowOf(i) - rowOf(j)) + Math.abs(colOf(i) - colOf(j));
  }

  /* Each search returns { order, path, found }. order is the sequence of
     nodes as they are expanded — replaying it is the expanding frontier. */
  function searchBFS() {
    var N = gridCols * gridRows, seen = new Uint8Array(N), parent = newParent(N);
    var order = [], q = [gridStart], head = 0, cur, d, nr, nc, nb;
    seen[gridStart] = 1;
    while (head < q.length) {
      cur = q[head++];
      order.push(cur);
      if (cur === gridEnd) break;
      for (d = 0; d < 4; d++) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (seen[nb] || walls[nb]) continue;
        seen[nb] = 1; parent[nb] = cur; q.push(nb);
      }
    }
    var path = reconstruct(parent, gridStart, gridEnd);
    return { order: order, path: path, found: path.length > 0 };
  }

  function searchDFS() {
    var N = gridCols * gridRows, seen = new Uint8Array(N), parent = newParent(N);
    var order = [], stack = [gridStart], cur, d, nr, nc, nb;
    while (stack.length) {
      cur = stack.pop();
      if (seen[cur]) continue;
      seen[cur] = 1;
      order.push(cur);
      if (cur === gridEnd) break;
      // push in reverse so the first neighbour is explored first
      for (d = 3; d >= 0; d--) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (seen[nb] || walls[nb]) continue;
        if (parent[nb] === -1 && nb !== gridStart) parent[nb] = cur;
        stack.push(nb);
      }
    }
    var path = reconstruct(parent, gridStart, gridEnd);
    return { order: order, path: path, found: path.length > 0 };
  }

  function searchDijkstra() {
    var N = gridCols * gridRows, dist = new Float64Array(N), settled = new Uint8Array(N);
    var parent = newParent(N), order = [], h = heapNew(), i, cur, d, nr, nc, nb, nd;
    for (i = 0; i < N; i++) dist[i] = Infinity;
    dist[gridStart] = 0; heapPush(h, 0, gridStart);
    while (heapSize(h)) {
      cur = heapPop(h);
      if (settled[cur]) continue;
      settled[cur] = 1;
      order.push(cur);
      if (cur === gridEnd) break;
      for (d = 0; d < 4; d++) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (walls[nb]) continue;
        nd = dist[cur] + 1;
        if (nd < dist[nb]) { dist[nb] = nd; parent[nb] = cur; heapPush(h, nd, nb); }
      }
    }
    var path = reconstruct(parent, gridStart, gridEnd);
    return { order: order, path: path, found: path.length > 0 };
  }

  function searchAStar() {
    var N = gridCols * gridRows, g = new Float64Array(N), settled = new Uint8Array(N);
    var parent = newParent(N), order = [], h = heapNew(), i, cur, d, nr, nc, nb, ng;
    for (i = 0; i < N; i++) g[i] = Infinity;
    g[gridStart] = 0; heapPush(h, manhattan(gridStart, gridEnd), gridStart);
    while (heapSize(h)) {
      cur = heapPop(h);
      if (settled[cur]) continue;
      settled[cur] = 1;
      order.push(cur);
      if (cur === gridEnd) break;
      for (d = 0; d < 4; d++) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (walls[nb]) continue;
        ng = g[cur] + 1;
        if (ng < g[nb]) {
          g[nb] = ng; parent[nb] = cur;
          heapPush(h, ng + manhattan(nb, gridEnd), nb);
        }
      }
    }
    var path = reconstruct(parent, gridStart, gridEnd);
    return { order: order, path: path, found: path.length > 0 };
  }

  /* Greedy best-first: A* with the cost-so-far term dropped, so the priority
     is the heuristic alone. It charges straight at the goal and is fast on an
     open board, but because it never accounts for distance travelled it can be
     lured down a dead end and return a path that is valid but not shortest —
     the instructive contrast with A*, which keeps both terms. */
  function searchGreedy() {
    var N = gridCols * gridRows, seen = new Uint8Array(N), parent = newParent(N);
    var order = [], h = heapNew(), cur, d, nr, nc, nb;
    seen[gridStart] = 1; heapPush(h, manhattan(gridStart, gridEnd), gridStart);
    while (heapSize(h)) {
      cur = heapPop(h);
      order.push(cur);
      if (cur === gridEnd) break;
      for (d = 0; d < 4; d++) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (seen[nb] || walls[nb]) continue;
        seen[nb] = 1; parent[nb] = cur;
        heapPush(h, manhattan(nb, gridEnd), nb);
      }
    }
    var path = reconstruct(parent, gridStart, gridEnd);
    return { order: order, path: path, found: path.length > 0 };
  }

  /* Bidirectional BFS: two breadth-first frontiers, one from the start and one
     from the goal, expanded a node at a time in alternation. The moment a node
     popped by one side has already been seen by the other, the frontiers have
     met and the path is stitched from the two parent trees — start->meet via
     the forward tree, meet->end via the backward tree. Two half-radius circles
     touch, which is far less area than one full-radius flood, so it visits
     noticeably fewer cells than plain BFS. The recorded op format is single
     source, but that is fine: the goal cell is kept out of the visit `order`
     (it is drawn specially anyway), so the replay ends its visit phase when the
     order runs out rather than on reaching the goal, and the path is prebuilt
     here rather than through reconstruct(). */
  function searchBidirectional() {
    var N = gridCols * gridRows;
    var seenA = new Uint8Array(N), seenB = new Uint8Array(N);
    var parentA = newParent(N), parentB = newParent(N);
    var qA = [gridStart], qB = [gridEnd], headA = 0, headB = 0;
    var order = [], meet = -1, cur, d, nr, nc, nb;
    seenA[gridStart] = 1; seenB[gridEnd] = 1;
    if (gridStart === gridEnd) meet = gridStart;
    while (meet === -1 && headA < qA.length && headB < qB.length) {
      // one expansion from the start side
      cur = qA[headA++];
      if (cur !== gridEnd) order.push(cur);
      if (seenB[cur]) { meet = cur; break; }
      for (d = 0; d < 4; d++) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (seenA[nb] || walls[nb]) continue;
        seenA[nb] = 1; parentA[nb] = cur; qA.push(nb);
      }
      // one expansion from the goal side
      cur = qB[headB++];
      if (cur !== gridEnd) order.push(cur);
      if (seenA[cur]) { meet = cur; break; }
      for (d = 0; d < 4; d++) {
        nr = rowOf(cur) + DR[d]; nc = colOf(cur) + DC[d];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        nb = idxOf(nr, nc);
        if (seenB[nb] || walls[nb]) continue;
        seenB[nb] = 1; parentB[nb] = cur; qB.push(nb);
      }
    }
    var path = [], guard, cap = N + 2;
    if (meet !== -1) {
      // start -> meet, walking the forward parent tree then reversing
      var left = [], c = meet;
      guard = 0;
      while (c !== -1 && guard++ < cap) { left.push(c); if (c === gridStart) break; c = parentA[c]; }
      left.reverse();
      // meet -> end, walking the backward parent tree forward from the meet
      var right = [];
      c = parentB[meet]; guard = 0;
      while (c !== -1 && guard++ < cap) { right.push(c); if (c === gridEnd) break; c = parentB[c]; }
      if (left.length && left[0] === gridStart) {
        path = left.concat(right);
        if (path[path.length - 1] !== gridEnd) path = [];
      }
    }
    return { order: order, path: path, found: path.length > 0 };
  }

  function runSearch(name) {
    if (name === 'bfs') return searchBFS();
    if (name === 'dfs') return searchDFS();
    if (name === 'dijkstra') return searchDijkstra();
    if (name === 'greedy') return searchGreedy();
    if (name === 'bidirectional') return searchBidirectional();
    return searchAStar();
  }

  function makeSearch(name) {
    var res = runSearch(name), N = gridCols * gridRows;
    var s = {
      algo: name,
      order: res.order, path: res.path, found: res.found,
      seen: new Uint8Array(N),
      pathSeen: new Uint8Array(N),
      reveal: new Int32Array(N),
      vidx: 0, pathIdx: 0, phase: 'visit',
      recent: -1, done: false
    };
    resetSearchProgress(s);
    return s;
  }

  function resetSearchProgress(s) {
    var i, n = s.seen.length;
    for (i = 0; i < n; i++) { s.seen[i] = 0; s.pathSeen[i] = 0; s.reveal[i] = -1; }
    s.vidx = 0; s.pathIdx = 0; s.phase = 'visit'; s.recent = -1; s.done = false;
  }

  /* One replay step for a search: reveal a visited node, or (once every
     visited node is shown) lay one more cell of the found path. */
  function stepSearch(s) {
    if (s.phase === 'visit') {
      if (s.vidx < s.order.length) {
        var node = s.order[s.vidx];
        s.seen[node] = 1; s.reveal[node] = s.vidx; s.recent = node; s.vidx++;
        if (node === gridEnd) { s.phase = 'path'; }
        else if (s.vidx >= s.order.length) { s.phase = 'path'; }
        return true;
      }
      s.phase = 'path';
    }
    if (s.phase === 'path') {
      if (!s.found) { s.done = true; return false; }
      if (s.pathIdx < s.path.length) { s.pathSeen[s.path[s.pathIdx]] = 1; s.pathIdx++; return true; }
      s.done = true; return false;
    }
    return false;
  }

  /* ---- grid generation ------------------------------------------------- */
  function computeRows(cols) {
    var refW = W || 800, refH = (H || 420) - LH;
    var rows = Math.round(cols * (refH / refW));
    if (rows < 6) rows = 6;
    if (rows > 90) rows = 90;
    return rows;
  }

  function defaultEndpoints() {
    gridStart = idxOf(Math.floor(gridRows / 2), 1);
    gridEnd = idxOf(Math.floor(gridRows / 2), gridCols - 2);
  }

  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  /* Recursive-backtracker (randomized DFS) maze. Rooms sit on even
     coordinates; carving steps two cells at a time and knocks out the wall
     cell in between. This is a *perfect* maze — exactly one route between any
     two rooms — which is the whole reason to use it over thick-wall recursive
     division: division on a cell grid can seal a region off and leave the end
     unreachable, and a maze the search can never solve is a useless demo. */
  function carveMaze() {
    var N = gridCols * gridRows, i;
    for (i = 0; i < N; i++) walls[i] = 1;
    var seen = new Uint8Array(N);
    var dirs = [[-2, 0], [2, 0], [0, -2], [0, 2]];
    function room(r, c) { walls[idxOf(r, c)] = 0; seen[idxOf(r, c)] = 1; }
    var sr = rowOf(gridStart) - (rowOf(gridStart) % 2);
    var sc = colOf(gridStart) - (colOf(gridStart) % 2);
    var stack = [[sr, sc]], top, r, c, order, k, j, t, d, dd, nr, nc, moved;
    room(sr, sc);
    while (stack.length) {
      top = stack[stack.length - 1]; r = top[0]; c = top[1];
      order = [0, 1, 2, 3];
      for (k = 3; k > 0; k--) { j = Math.floor(Math.random() * (k + 1)); t = order[k]; order[k] = order[j]; order[j] = t; }
      moved = false;
      for (d = 0; d < 4; d++) {
        dd = dirs[order[d]];
        nr = r + dd[0]; nc = c + dd[1];
        if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
        if (seen[idxOf(nr, nc)]) continue;
        walls[idxOf((r + nr) >> 1, (c + nc) >> 1)] = 0;  // knock the shared wall
        room(nr, nc);
        stack.push([nr, nc]);
        moved = true;
        break;
      }
      if (!moved) stack.pop();
    }
    // Splice the (possibly off-lattice) start and end into the connected maze
    // with an L-shaped corridor to their nearest even-even room.
    connectToLattice(gridStart);
    connectToLattice(gridEnd);
  }

  function connectToLattice(cell) {
    var r = rowOf(cell), c = colOf(cell);
    var tr = r - (r % 2), tc = c - (c % 2), i;
    for (i = Math.min(c, tc); i <= Math.max(c, tc); i++) walls[idxOf(r, i)] = 0;
    for (i = Math.min(r, tr); i <= Math.max(r, tr); i++) walls[idxOf(i, tc)] = 0;
  }

  function clearAround(cell) {
    var r = rowOf(cell), c = colOf(cell), d, nr, nc;
    walls[cell] = 0;
    for (d = 0; d < 4; d++) {
      nr = r + DR[d]; nc = c + DC[d];
      if (nr >= 0 && nc >= 0 && nr < gridRows && nc < gridCols) walls[idxOf(nr, nc)] = 0;
    }
  }

  function generateGrid() {
    var N = gridCols * gridRows, i, gen = PATH_GENS[pathGenIndex];
    walls = new Uint8Array(N);
    if (gen === 'random walls') {
      for (i = 0; i < N; i++) walls[i] = Math.random() < 0.28 ? 1 : 0;
      clearAround(gridStart); clearAround(gridEnd);
    } else if (gen === 'maze') {
      carveMaze();           // owns its own start/end wiring
    } // 'clear board' leaves all zero
    walls[gridStart] = 0; walls[gridEnd] = 0;
  }

  /* ====================================================================== */
  /*  RENDERING                                                             */
  /* ====================================================================== */

  function fit() {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(rect.width || canvas.clientWidth || 800));
    H = Math.round(rect.height || canvas.clientHeight || 0);
    if (H < 40) {                    // canvas has no CSS height — give it one
      H = Math.round(W * 0.52);
      canvas.style.height = H + 'px';
    }
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function panelsFor(count) {
    if (count >= 2) {
      var pw = (W - GUTTER) / 2;
      return [{ x: 0, y: 0, w: pw, h: H }, { x: pw + GUTTER, y: 0, w: pw, h: H }];
    }
    return [{ x: 0, y: 0, w: W, h: H }];
  }

  function label(p, title, line2, badge, badgeColor) {
    ctx.textBaseline = 'top';
    ctx.font = '600 13px ' + FONT;
    ctx.fillStyle = COL.accent;
    ctx.fillText(title, p.x + 6, p.y + 4);
    ctx.font = '11px ' + FONT;
    ctx.fillStyle = COL.dim;
    ctx.fillText(line2, p.x + 6, p.y + 22);
    if (badge) {
      ctx.font = '600 11px ' + FONT;
      ctx.fillStyle = badgeColor || COL.green;
      var bw = ctx.measureText(badge).width;
      ctx.fillText(badge, p.x + p.w - bw - 6, p.y + 6);
    }
  }

  function drawRun(run, p) {
    var line2 = 'cmp ' + run.comparisons + '   swap ' + run.swaps;
    if (run.writes) line2 += '   wr ' + run.writes;
    var badge = run.done ? 'DONE' : (state === 'playing' ? '' : 'ready');
    label(p, ALGO_LABEL[run.algo] || run.algo, line2, badge, run.done ? COL.green : COL.dim);

    var n = run.arr.length;
    var areaX = p.x, areaTop = p.y + LH, areaW = p.w, areaH = p.h - LH - 4;
    var bw = areaW / n, i, v, bh, x, y, a = run.active, col;
    for (i = 0; i < n; i++) {
      v = run.arr[i];
      bh = (v / maxVal) * areaH;
      col = run.sorted[i] ? COL.barSorted : COL.bar;
      if (a) {
        if (a[0] === CMP && (i === a[1] || i === a[2])) col = COL.barCmp;
        else if (a[0] === SWAP && (i === a[1] || i === a[2])) col = COL.barSwap;
        else if (a[0] === SET && i === a[1]) col = COL.barSet;
      }
      ctx.fillStyle = col;
      x = areaX + i * bw;
      y = areaTop + areaH - bh;
      ctx.fillRect(x, y, Math.max(1, bw - (bw > 4 ? 1 : 0.3)), bh);
    }
  }

  /* Search mode's panel. Deliberately the same picture as a sort panel — index
     across, value as height — because the whole payoff depends on the two
     panels being read as one comparison rather than two diagrams.

     What separates them is the shading. Every bar outside the live [lo, hi]
     window is drawn in the wall colour, so binary blacks out half of what is
     left on every probe while linear's window never moves an inch. The rail
     under the bars restates that same window as one solid stroke, which is
     what carries the meaning at 300 values where a bar is one pixel wide.

     Every colour here is already in COL: eliminated reuses the wall grey,
     the probe reuses the compare amber, a hit reuses the sorted green and an
     exhausted search reuses the red. Nothing new to check against the ground. */
  function drawArraySearch(s, p) {
    var line2 = 'cmp ' + s.comparisons + '   target ' + s.target;
    if (s.foundAt >= 0) line2 += '   at ' + s.foundAt;
    else if (s.miss) line2 += '   absent';
    var badge = s.done ? (s.foundAt >= 0 ? 'DONE' : 'NOT FOUND')
                       : (state === 'playing' ? '' : 'ready');
    label(p, ALGO_LABEL[s.algo] || s.algo, line2, badge,
      s.done ? (s.foundAt >= 0 ? COL.green : COL.red) : COL.dim);

    var a = s.arr, n = a.length;
    if (!n) return;
    var railH = 4, railGap = 3;
    var areaX = p.x, areaTop = p.y + LH, areaW = p.w;
    var areaH = p.h - LH - 4 - railH - railGap;
    if (areaH < 1) areaH = 1;
    var bw = areaW / n, i, bh, col;

    for (i = 0; i < n; i++) {
      bh = (a[i] / srchMax) * areaH;
      col = (i < s.lo || i > s.hi) ? COL.gWall : COL.bar;
      if (i === s.foundAt) col = COL.barSorted;
      else if (i === s.probe) col = s.miss ? COL.barSwap : COL.barCmp;
      ctx.fillStyle = col;
      ctx.fillRect(areaX + i * bw, areaTop + areaH - bh,
        Math.max(1, bw - (bw > 4 ? 1 : 0.3)), bh);
    }

    // The target as a height, drawn over the bars: where this line crosses the
    // staircase is the bar being hunted, without having to read the numbers.
    var tt = s.target / srchMax;
    if (tt > 1) tt = 1;
    ctx.fillStyle = COL.dim;
    ctx.fillRect(areaX, areaTop + areaH - tt * areaH, areaW, 1);

    var ry = areaTop + areaH + railGap;
    if (s.foundAt >= 0) {
      ctx.fillStyle = COL.green;
      ctx.fillRect(areaX + s.foundAt * bw, ry, Math.max(2, bw), railH);
    } else if (s.miss) {
      ctx.fillStyle = COL.red;
      ctx.fillRect(areaX, ry, areaW, railH);
    } else if (s.hi >= s.lo) {
      ctx.fillStyle = COL.accent;
      ctx.fillRect(areaX + s.lo * bw, ry, Math.max(2, (s.hi - s.lo + 1) * bw), railH);
    }
  }

  function visitColor(reveal, total) {
    var t = total > 0 ? reveal / total : 0;
    if (t < 0) t = 0; if (t > 1) t = 1;
    var r = Math.round(VIS_DEEP[0] + (VIS_NEAR[0] - VIS_DEEP[0]) * t);
    var g = Math.round(VIS_DEEP[1] + (VIS_NEAR[1] - VIS_DEEP[1]) * t);
    var b = Math.round(VIS_DEEP[2] + (VIS_NEAR[2] - VIS_DEEP[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function drawSearch(s, p) {
    var line2 = 'visited ' + s.vidx;
    if (s.done && s.found) line2 += '   path ' + (s.path.length - 1) + ' steps';
    else if (s.done && !s.found) line2 += '   no path';
    var badge = s.done ? (s.found ? 'DONE' : 'BLOCKED') : (state === 'playing' ? '' : 'ready');
    label(p, ALGO_LABEL[s.algo] || s.algo, line2, badge,
      s.done ? (s.found ? COL.green : COL.red) : COL.dim);

    var contentW = p.w, contentH = p.h - LH;
    var cell = Math.min(contentW / gridCols, contentH / gridRows);
    if (cell < 1) cell = 1;
    var offX = p.x + (contentW - cell * gridCols) / 2;
    var offY = p.y + LH + (contentH - cell * gridRows) / 2;
    var gap = cell > 6 ? 1 : 0, sz = Math.max(1, cell - gap);
    var r, c, i, col;
    for (r = 0; r < gridRows; r++) {
      for (c = 0; c < gridCols; c++) {
        i = idxOf(r, c);
        if (i === gridStart) col = COL.gStart;
        else if (i === gridEnd) col = COL.gEnd;
        else if (walls[i]) col = COL.gWall;
        else if (s.pathSeen[i]) col = COL.gPath;
        else if (i === s.recent && s.phase === 'visit') col = COL.gFrontier;
        else if (s.seen[i]) col = visitColor(s.reveal[i], s.vidx);
        else col = COL.gEmpty;
        ctx.fillStyle = col;
        ctx.fillRect(offX + c * cell, offY + r * cell, sz, sz);
      }
    }
  }

  function render() {
    if (!ctx) return;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    var i, ps;
    if (mode === 'sort') {
      ps = panelsFor(runs.length);
      for (i = 0; i < runs.length && i < ps.length; i++) drawRun(runs[i], ps[i]);
    } else if (mode === 'search') {
      ps = panelsFor(scans.length);
      for (i = 0; i < scans.length && i < ps.length; i++) drawArraySearch(scans[i], ps[i]);
    } else {
      ps = panelsFor(searches.length);
      for (i = 0; i < searches.length && i < ps.length; i++) drawSearch(searches[i], ps[i]);
    }
  }

  /* ====================================================================== */
  /*  ANIMATION LOOP                                                        */
  /* ====================================================================== */

  function activeList() { return mode === 'sort' ? runs : (mode === 'search' ? scans : searches); }
  function stepOne(item) {
    if (mode === 'sort') return stepRun(item);
    if (mode === 'search') return stepScan(item);
    return stepSearch(item);
  }

  function everythingDone() {
    var list = activeList(), i;
    for (i = 0; i < list.length; i++) if (!list[i].done) return false;
    return true;
  }

  // advance every run/search by one op; returns true if all are done
  function advanceAll() {
    var list = activeList(), i, allDone = true;
    for (i = 0; i < list.length; i++) {
      if (!list[i].done) { stepOne(list[i]); if (!list[i].done) allDone = false; }
    }
    return allDone;
  }

  function tick() {
    if (state !== 'playing') return;
    acc += opsPerFrame();
    var steps = Math.floor(acc);
    acc -= steps;
    if (steps > 4000) steps = 4000;       // cap frame budget so a frame stays short
    var i;
    for (i = 0; i < steps; i++) { if (advanceAll()) break; }
    render();
    updateStats();
    if (everythingDone()) { finish(); return; }
    rafHandle = raf(tick);
  }

  function finish() {
    state = 'done';
    setRunLabel('Replay');
    render();
    updateStats();
  }

  /* ====================================================================== */
  /*  CONTROL                                                               */
  /* ====================================================================== */

  function setRunLabel(txt) { if (runBtn) runBtn.textContent = txt; }

  /* Every builder feeds the SAME source to both panels — one initialArr, one
     srchArr/srchTarget, one walls/gridStart/gridEnd — so a side-by-side is
     always a fair fight. makeRun() takes its own copy of the array because a
     sort mutates; makeScan() and makeSearch() do not need one because neither
     an array search nor a grid search writes to its input. */
  function buildRuns() {
    runs = (compare === 'two')
      ? [makeRun(cmpA.sort, initialArr), makeRun(cmpB.sort, initialArr)]
      : [makeRun(algo, initialArr)];
  }

  function buildScans() {
    scans = (compare === 'two')
      ? [makeScan(cmpA.search, srchArr, srchTarget), makeScan(cmpB.search, srchArr, srchTarget)]
      : [makeScan(algo, srchArr, srchTarget)];
  }

  function buildSearches() {
    searches = (compare === 'two')
      ? [makeSearch(cmpA.path), makeSearch(cmpB.path)]
      : [makeSearch(algo)];
    pathDirty = false;
  }

  function buildForMode() {
    if (mode === 'sort') buildRuns();
    else if (mode === 'search') buildScans();
    else buildSearches();
  }

  function resetProgress() {
    var i;
    if (mode === 'sort') for (i = 0; i < runs.length; i++) resetRunProgress(runs[i]);
    else if (mode === 'search') for (i = 0; i < scans.length; i++) resetScanProgress(scans[i]);
    else for (i = 0; i < searches.length; i++) resetSearchProgress(searches[i]);
    acc = 0;
  }

  function play() {
    if (state === 'playing') return;
    if (mode === 'path' && pathDirty) buildSearches();
    if (state === 'done' || state === 'idle') resetProgress();
    state = 'playing';
    // Nothing autoplays: every path into play() is the Run button, the space
    // bar or the Ctrl+Enter restart, so reaching this line is the visitor
    // setting the animation going themselves. The already-playing return above
    // keeps a held space bar from counting as more than the gesture it is.
    if (window.KSLab) window.KSLab.used('run');
    setRunLabel('Pause');
    cancelRaf(rafHandle);
    rafHandle = raf(tick);
  }

  function pause() {
    if (state !== 'playing') return;
    cancelRaf(rafHandle); rafHandle = null;
    state = 'paused';
    setRunLabel('Resume');
    updateStats();
  }

  function toggleRun() {
    if (state === 'playing') pause();
    else play();
  }

  // Stop / Reset: cancel the animation and return to the start of the SAME
  // data — walls, array and endpoints are kept, only progress is wiped.
  function stopReset() {
    cancelRaf(rafHandle); rafHandle = null;
    if (mode === 'path' && pathDirty) buildSearches();
    resetProgress();
    state = 'idle';
    setRunLabel('Play');
    render();
    updateStats();
  }

  function restart() { stopReset(); play(); }

  // single-step, for the "steppable" requirement, without extra buttons
  function stepManual(dir) {
    if (state === 'playing') pause();
    if (mode === 'path' && pathDirty) buildSearches();
    if (state === 'done' && dir > 0) return;
    if (dir < 0) {
      // rebuild from the start up to one op earlier per active item
      var targets = [], list = activeList(), i;
      for (i = 0; i < list.length; i++) {
        // sort and search runs both count progress as a plain op index; a grid
        // search counts it as visits plus, once the flood is over, path cells.
        targets.push(mode === 'path'
          ? Math.max(0, list[i].vidx + (list[i].phase === 'path' ? list[i].pathIdx : 0) - 1)
          : Math.max(0, list[i].idx - 1));
      }
      resetProgress();
      for (i = 0; i < list.length; i++) {
        var t = targets[i], k = 0;
        while (k < t && !list[i].done) { stepOne(list[i]); k++; }
      }
    } else {
      advanceAll();
    }
    // Single-stepping is as deliberate a way of driving the visualisation as
    // pressing Play, and only the arrow keys reach here; the done-and-forward
    // return above has already dropped the presses that could show nothing.
    if (window.KSLab) window.KSLab.used('run');
    state = everythingDone() ? 'done' : 'paused';
    setRunLabel(state === 'done' ? 'Replay' : 'Resume');
    render();
    updateStats();
  }

  function newData() {
    cancelRaf(rafHandle); rafHandle = null;
    if (mode === 'sort') {
      distIndex = (distIndex + 1) % DISTS.length;
      sortN = sizeToN();
      generateArray();
      buildRuns();
    } else if (mode === 'search') {
      targetIndex = (targetIndex + 1) % TARGETS.length;
      srchN = sizeToN();
      generateSortedArray();
      buildScans();
    } else {
      pathGenIndex = (pathGenIndex + 1) % PATH_GENS.length;
      gridCols = sizeToCols();
      gridRows = computeRows(gridCols);
      defaultEndpoints();
      generateGrid();
      buildSearches();
    }
    state = 'idle';
    setRunLabel('Play');
    render();
    updateStats();
  }

  function resizeData() {
    cancelRaf(rafHandle); rafHandle = null;
    if (mode === 'sort') {
      sortN = sizeToN();
      generateArray();
      buildRuns();
    } else if (mode === 'search') {
      srchN = sizeToN();
      generateSortedArray();
      buildScans();
    } else {
      gridCols = sizeToCols();
      gridRows = computeRows(gridCols);
      defaultEndpoints();
      generateGrid();
      buildSearches();
    }
    state = 'idle';
    setRunLabel('Play');
    render();
    updateStats();
  }

  function algoTable() {
    if (mode === 'sort') return SORT_ALGOS;
    if (mode === 'search') return SEARCH_ALGOS;
    return PATH_ALGOS;
  }

  /* Refill one select from the per-mode table, keeping `want` selected if that
     mode still offers it and falling back to the head of the list if not.
     Returns whatever ended up selected, which is what the caller stores. */
  function fillSelect(el, list, want) {
    var i, opt, found = false;
    if (!el) return want;
    while (el.firstChild) el.removeChild(el.firstChild);
    for (i = 0; i < list.length; i++) {
      opt = document.createElement('option');
      opt.value = list[i][0];
      opt.textContent = list[i][1];
      el.appendChild(opt);
      if (list[i][0] === want) found = true;
    }
    el.value = found ? want : list[0][0];
    return el.value;
  }

  function populateAlgo() {
    var list = algoTable();
    if (algoEl) algo = fillSelect(algoEl, list, algo);
    cmpA[mode] = fillSelect(algoAEl, list, cmpA[mode]);
    cmpB[mode] = fillSelect(algoBEl, list, cmpB[mode]);
  }

  /* Which pickers are live. The single picker and the A/B pair are mutually
     exclusive, and hiding uses the `hidden` ATTRIBUTE rather than CSS on
     purpose: a select that is only visually gone is still in the tab order and
     still announced, so a keyboard or screen-reader user would land on a
     control that changes nothing. The sr-only labels go with them, since a
     label pointing at a hidden control is just noise in the a11y tree.

     Focus is moved off first. In practice the change event that gets us here
     came FROM the compare select so focus is already safe, but hiding the
     element that holds focus drops it on <body> and strands the tab order back
     at the top of the document, and that is cheap to rule out. */
  function syncCompareUI() {
    var two = compare === 'two', ae = document.activeElement;
    if (compareEl && ((two && ae === algoEl) || (!two && (ae === algoAEl || ae === algoBEl)))) {
      compareEl.focus();
    }
    if (algoEl) algoEl.hidden = two;
    if (algoLab) algoLab.hidden = two;
    if (algoAEl) algoAEl.hidden = !two;
    if (algoALab) algoALab.hidden = !two;
    if (algoBEl) algoBEl.hidden = !two;
    if (algoBLab) algoBLab.hidden = !two;
  }

  /* Any picker change invalidates the recorded traces, so all three land here:
     rebuild for the current mode and go back to op 0 on the new choice. */
  function repick() {
    cancelRaf(rafHandle); rafHandle = null;
    buildForMode();
    state = 'idle';
    setRunLabel('Play');
    render();
    updateStats();
  }

  function syncMode() {
    cancelRaf(rafHandle); rafHandle = null;
    var want = modeEl ? modeEl.value : 'sort';
    mode = (want === 'path' || want === 'search') ? want : 'sort';
    // Only path mode swallows touch gestures. .lab-canvas is shared with the
    // other labs, so this lives on the element and flips back to '' in sort
    // and search modes — where the canvas is inert and the page must still
    // scroll under a finger that happens to land on it.
    if (canvas) canvas.style.touchAction = (mode === 'path') ? 'none' : '';
    populateAlgo();
    if (mode === 'sort') {
      sortN = sizeToN();
      generateArray();
      buildRuns();
    } else if (mode === 'search') {
      srchN = sizeToN();
      generateSortedArray();
      buildScans();
    } else {
      gridCols = sizeToCols();
      gridRows = computeRows(gridCols);
      defaultEndpoints();
      generateGrid();
      buildSearches();
    }
    state = 'idle';
    setRunLabel('Play');
    render();
    updateStats();
  }

  function changeAlgo() {
    algo = algoEl ? algoEl.value : algo;
    repick();
  }

  function changeCompare() {
    compare = (compareEl && compareEl.value === 'two') ? 'two' : 'none';
    syncCompareUI();
    repick();
  }

  /* A and B are allowed to be the same algorithm on purpose — two identical
     panels finishing in lockstep is the shortest proof that these runs are
     deterministic, so nothing here "helpfully" pushes the other select away. */
  function changePair() {
    if (algoAEl) cmpA[mode] = algoAEl.value;
    if (algoBEl) cmpB[mode] = algoBEl.value;
    repick();
  }

  /* ---- stats panel ----------------------------------------------------- */
  // tick() calls updateStats() on every animation frame, but the only things
  // that actually change 60x a second are the numbers inside the chips. The
  // panel used to be re-serialised whole — ~2KB of inline-styled markup, almost
  // all of it constant — which measured 0.8ms a frame against 0.2ms for writing
  // textContent into cached <b> nodes. So the chrome is built once per SHAPE
  // (mode plus the set of algorithms on screen) and only the values move after
  // that. Chips that come and go (writes, sorted, path) are always built and
  // toggled with display, so their arrival is not a shape change either.
  var statsShape = null;   // signature of the chrome currently in the DOM
  var statsVal = {};       // key -> the <b> holding that chip's value
  var statsChip = {};      // key -> the chip's outer <span>, for show/hide

  function chip(key, name, value, color) {
    return '<span data-k="' + key + '" style="display:inline-block;margin:0 10px 6px 0;padding:2px 8px;' +
      'border:1px solid rgba(125,211,252,0.18);border-radius:6px;background:#0b1220;' +
      'font:12px ' + FONT + ';color:#94a3b8">' + name +
      ' <b style="color:' + (color || COL.text) + '">' + value + '</b></span>';
  }

  function statsShapeOf(list) {
    var sig = mode + '|' + list.length, i;
    for (i = 0; i < list.length; i++) sig += '|' + list[i].algo;
    return sig;
  }

  function buildStats(list, sig) {
    var html = '', i, it;
    html += chip('mode', 'mode', mode, COL.accent);
    if (mode === 'sort') {
      html += chip('dist', 'data', DISTS[distIndex], COL.amber);
      html += chip('size', 'size', sortN + ' bars');
    } else if (mode === 'search') {
      html += chip('case', 'target', TARGETS[targetIndex], COL.amber);
      html += chip('tval', 'value', srchTarget, COL.accent);
      html += chip('size', 'size', srchN + ' sorted values');
    } else {
      html += chip('board', 'board', PATH_GENS[pathGenIndex], COL.amber);
      html += chip('grid', 'grid', gridCols + '×' + gridRows);
    }
    html += chip('speed', 'speed', speedPct());
    html += chip('state', 'state', state, state === 'playing' ? COL.green : COL.dim);
    html += '<div style="height:8px"></div>';

    for (i = 0; i < list.length; i++) {
      it = list[i];
      html += '<div style="margin:2px 0">';
      html += '<b style="color:' + COL.accent + ';font:600 12px ' + FONT + '">' +
        (ALGO_LABEL[it.algo] || it.algo) + '</b>  ';
      if (mode === 'sort') {
        html += chip('cmp' + i, 'comparisons', '0', COL.amber);
        html += chip('swp' + i, 'swaps', '0', COL.red);
        html += chip('wr' + i, 'writes', '0', COL.barSet);
        html += chip('st' + i, 'status', 'sorted', COL.green);
      } else if (mode === 'search') {
        html += chip('cmp' + i, 'comparisons', '0', COL.amber);
        html += chip('res' + i, 'result', 'found', COL.green);
      } else {
        html += chip('vis' + i, 'visited', '0', COL.barSet);
        html += chip('pt' + i, 'path', '0 steps', COL.gPath);
      }
      html += '</div>';
    }

    html += '<div style="margin-top:8px;font:11px ' + FONT + ';color:#5d7086;line-height:1.6">';
    html += 'Play / Pause, Reset, New data.  Space = play/pause, ' +
      '→ / ← = step one op.';
    html += '<br>Compare: two runs both pickers on the same input, side by side.';
    if (mode === 'path') {
      html += '<br>Draw walls by dragging on the grid; drag the green start or ' +
        'pink end cell to move it.';
    } else if (mode === 'search') {
      html += '<br>The array is sorted, which is what binary search needs. ' +
        'New data cycles the target through: near-end → near-start → absent.' +
        '<br>Dim bars are the ones the algorithm has ruled out; the bar under ' +
        'them is its live window.';
    } else {
      html += '<br>New data cycles through: random → nearly-sorted → ' +
        'reversed → few-unique.';
    }
    html += '</div>';
    statsEl.innerHTML = html;

    var nodes = statsEl.querySelectorAll('[data-k]'), k, el;
    statsVal = {}; statsChip = {};
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      k = el.getAttribute('data-k');
      statsChip[k] = el;
      statsVal[k] = el.getElementsByTagName('b')[0];
    }
    statsShape = sig;
  }

  function setStat(key, value, color) {
    var b = statsVal[key];
    if (!b) return;
    value = String(value);
    if (b.textContent !== value) b.textContent = value;
    if (color) b.style.color = color;
  }

  function showStat(key, on) {
    var el = statsChip[key], d = on ? 'inline-block' : 'none';
    if (el && el.style.display !== d) el.style.display = d;
  }

  function updateStats() {
    if (!statsEl) return;
    var list = activeList(), sig = statsShapeOf(list), i, it;
    if (sig !== statsShape) buildStats(list, sig);

    setStat('mode', mode);
    if (mode === 'sort') {
      setStat('dist', DISTS[distIndex]);
      setStat('size', sortN + ' bars');
    } else if (mode === 'search') {
      setStat('case', TARGETS[targetIndex]);
      setStat('tval', srchTarget);
      setStat('size', srchN + ' sorted values');
    } else {
      setStat('board', PATH_GENS[pathGenIndex]);
      setStat('grid', gridCols + '×' + gridRows);
    }
    setStat('speed', speedPct());
    setStat('state', state, state === 'playing' ? COL.green : COL.dim);

    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (mode === 'sort') {
        setStat('cmp' + i, window.LabViz && LabViz.humanNumber ? LabViz.humanNumber(it.comparisons) : it.comparisons);
        setStat('swp' + i, it.swaps);
        showStat('wr' + i, !!it.writes);
        if (it.writes) setStat('wr' + i, it.writes);
        showStat('st' + i, !!it.done);
      } else if (mode === 'search') {
        setStat('cmp' + i, it.comparisons);
        showStat('res' + i, !!it.done);
        if (it.done) {
          setStat('res' + i, it.foundAt >= 0 ? 'index ' + it.foundAt : 'not found',
            it.foundAt >= 0 ? COL.green : COL.red);
        }
      } else {
        setStat('vis' + i, it.vidx);
        showStat('pt' + i, !!it.done);
        if (it.done) {
          setStat('pt' + i, it.found ? (it.path.length - 1) + ' steps' : 'unreachable',
            it.found ? COL.gPath : COL.red);
        }
      }
    }
  }

  /* ---- mouse: draw walls / drag endpoints (path mode only) ------------- */
  function cellFromEvent(e) {
    if (mode !== 'path') return -1;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var ps = panelsFor(searches.length), i, p, contentW, contentH, cell, offX, offY, c, r;
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      contentW = p.w; contentH = p.h - LH;
      cell = Math.min(contentW / gridCols, contentH / gridRows);
      offX = p.x + (contentW - cell * gridCols) / 2;
      offY = p.y + LH + (contentH - cell * gridRows) / 2;
      if (x < offX || y < offY) continue;
      c = Math.floor((x - offX) / cell);
      r = Math.floor((y - offY) / cell);
      if (c < 0 || r < 0 || c >= gridCols || r >= gridRows) continue;
      return idxOf(r, c);
    }
    return -1;
  }

  function markPathEdited() {
    // any grid edit invalidates the recorded searches and clears the overlay
    var i;
    for (i = 0; i < searches.length; i++) resetSearchProgress(searches[i]);
    pathDirty = true;
    if (state !== 'playing') { state = 'idle'; setRunLabel('Play'); }
  }

  function onDown(e) {
    if (mode !== 'path') return;
    var cell = cellFromEvent(e);
    if (cell < 0) return;
    if (state === 'playing') pause();
    if (cell === gridStart) drag = 'start';
    else if (cell === gridEnd) drag = 'end';
    else {
      drag = 'wall';
      wallPaint = walls[cell] ? 0 : 1;
      walls[cell] = wallPaint;
      markPathEdited();
    }
    render();
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag || mode !== 'path') return;
    var cell = cellFromEvent(e);
    if (cell < 0) return;
    if (drag === 'wall') {
      if (cell !== gridStart && cell !== gridEnd && walls[cell] !== wallPaint) {
        walls[cell] = wallPaint;
        markPathEdited();
      }
    } else if (drag === 'start') {
      if (cell !== gridEnd && !walls[cell] && cell !== gridStart) { gridStart = cell; markPathEdited(); }
    } else if (drag === 'end') {
      if (cell !== gridStart && !walls[cell] && cell !== gridEnd) { gridEnd = cell; markPathEdited(); }
    }
    render();
  }

  function onUp() { drag = null; }

  /* ---- touch: the same two handlers, fed a one-finger stub -------------- */
  // The panel text and the FAQ both promise "draw walls by dragging", so the
  // grid has to work under a finger too. onDown/onMove only ever read
  // clientX/clientY and call preventDefault, so a three-property stub is
  // enough — no second copy of the hit-testing.
  //
  // These bind on the canvas, not on window like their mouse twins, for two
  // reasons: touch events stay retargeted to the element the gesture started
  // on, so a canvas listener still sees moves that wander off it; and
  // touchstart/touchmove are passive BY DEFAULT on window/document but not on
  // an ordinary element, so binding here is what lets preventDefault actually
  // land. It has to land: without it the browser follows up with a synthesised
  // mousedown, onDown runs a second time on the same cell, and the wall you
  // just painted is toggled straight back off.
  function touchStub(t, e) {
    return {
      clientX: t.clientX,
      clientY: t.clientY,
      preventDefault: function () { if (e.cancelable) e.preventDefault(); }
    };
  }

  function onTouchStart(e) {
    if (mode !== 'path' || !e.touches || e.touches.length !== 1) return;
    onDown(touchStub(e.touches[0], e));
  }

  function onTouchMove(e) {
    if (!drag || mode !== 'path' || !e.touches || e.touches.length !== 1) return;
    onMove(touchStub(e.touches[0], e));
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!e.touches || e.touches.length === 0) onUp();
  }

  /* ---- keyboard: play/pause and single-step ---------------------------- */
  function onKey(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleRun(); }
    else if (e.key === 'ArrowRight' || e.key === '.') { e.preventDefault(); stepManual(1); }
    else if (e.key === 'ArrowLeft' || e.key === ',') { e.preventDefault(); stepManual(-1); }
  }

  /* ====================================================================== */
  /*  BOOT                                                                  */
  /* ====================================================================== */
  function onReady() {
    canvas = $('viz-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    statsEl = $('viz-stats');
    algoEl = $('viz-algo');
    compareEl = $('viz-compare');
    algoAEl = $('viz-algo-a');
    algoBEl = $('viz-algo-b');
    algoLab = $('viz-algo-label');
    algoALab = $('viz-algo-a-label');
    algoBLab = $('viz-algo-b-label');
    modeEl = $('viz-mode');
    sizeEl = $('viz-size');
    speedEl = $('viz-speed');
    genBtn = $('viz-gen');
    runBtn = $('viz-run');
    stopBtn = $('viz-stop');

    fit();
    // Read the compare select before the first syncMode(), so a browser that
    // restored "Compare: two" across a reload builds two panels immediately
    // rather than one that jumps to two on the first unrelated interaction.
    compare = (compareEl && compareEl.value === 'two') ? 'two' : 'none';
    syncCompareUI();
    syncMode();

    if (modeEl) modeEl.addEventListener('change', syncMode);
    if (algoEl) algoEl.addEventListener('change', changeAlgo);
    if (compareEl) compareEl.addEventListener('change', changeCompare);
    if (algoAEl) algoAEl.addEventListener('change', changePair);
    if (algoBEl) algoBEl.addEventListener('change', changePair);
    if (sizeEl) sizeEl.addEventListener('input', resizeData);
    if (speedEl) speedEl.addEventListener('input', updateStats);
    if (genBtn) genBtn.addEventListener('click', newData);
    if (runBtn) runBtn.addEventListener('click', toggleRun);
    if (stopBtn) stopBtn.addEventListener('click', stopReset);

    canvas.tabIndex = 0;
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', function () { /* keep drag; window mouseup ends it */ });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);

    // One keydown listener, on the root only. The canvas is focusable
    // (tabIndex 0) so a keypress while it is focused bubbles up to here —
    // binding on both the canvas and the root would fire onKey twice and
    // step two ops per press.
    var root = $('sortviz');
    if (root) {
      if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
      root.addEventListener('keydown', onKey);
    } else {
      canvas.addEventListener('keydown', onKey);
    }

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { fit(); });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', fit);
    }
  }

  if (window.LabViz && LabViz.define) {
    LabViz.define({ id: 'sortviz', run: restart, onReady: onReady });
  } else if (document.readyState !== 'loading') {
    onReady();
  } else {
    document.addEventListener('DOMContentLoaded', onReady);
  }
})();

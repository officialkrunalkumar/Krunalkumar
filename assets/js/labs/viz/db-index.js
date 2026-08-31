/* ==========================================================================
   db-index.js — why an index makes a query fast, counted rather than asserted.
   --------------------------------------------------------------------------
   Every database course says "an index makes lookups fast" and then draws a
   tree. Almost nobody comes away able to answer the question that actually
   matters at work: how many pages did that query read, and would the planner
   have used the index at all? So this lab counts.

   There is a real table in memory — 100,000 rows in three typed arrays — laid
   out into 8 KB heap pages, and there are real indexes over it, built by a
   counting sort and packed into leaves at a stated fill factor. Every page
   number on screen comes from walking those structures, not from a formula
   printed next to a picture. When the range panel says the index read 462
   pages and the scan read 2,500, both numbers were produced by iterating over
   the matching rows and asking which page each one lives on.

   Five things it sets out to show:

     1. A B+tree that really splits and really merges, with the fan-out
        adjustable, so the reason a production index is three levels deep and
        not thirty stops being a claim.
     2. The page counts for a lookup, a range scan and a sort, with and
        without the index. This is the payload; everything else supports it.
     3. Composite indexes and the leftmost-prefix rule, drawn as the sorted
        strip of index entries, because the rule is obvious once you can see
        that (a, b) puts every row for one `a` next to each other and scatters
        every row for one `b`.
     4. Covering indexes and the index-only scan, and exactly how SELECT *
        defeats one.
     5. Where the planner switches back to a sequential scan, plotted, with
        random_page_cost as a slider — because that switch is not a bug and
        the crossover moves when the hardware does.

   Where the model is simplified, it is simplified out loud:

     - The cost formulas are a cut-down version of PostgreSQL's. Real
       costsize.c has more terms, better statistics and a correlation estimate;
       this has seq_page_cost, random_page_cost, cpu_tuple_cost and the
       Mackert-Lohman-ish interpolation the bitmap heap scan uses. Plans are
       ranked by that model, so the choice shown is "what this model prefers",
       not "what your database will do".
     - Correlation is not estimated, it is measured: the heap page of every
       matching row is looked up and the reads are counted, which is strictly
       more honest than a coefficient.
     - Indexes are modelled as freshly built and evenly packed. A real index
       that has been churned for a year has looser pages and is taller.
     - There are no visibility maps, no page cache, no prefetch, no
       concurrency. Every count here is cold-cache page reads.

   No network, no eval, no dependencies. Arithmetic, DOM and one canvas.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  SMALL HELPERS                                                           */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";
  var SVGNS = 'http://www.w3.org/2000/svg';

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function S(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function num(n) {
    if (typeof LabViz !== 'undefined' && LabViz.humanNumber) return LabViz.humanNumber(n);
    return String(n);
  }
  /* String.prototype.repeat and padStart are ES6; this file is ES5. */
  function rep(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }
  function padRight(text, width) {
    var s = String(text);
    return s.length >= width ? s : s + rep(' ', width - s.length);
  }
  function money(v) {
    // Planner costs are conventionally printed to two decimals.
    return (Math.round(v * 100) / 100).toFixed(2);
  }
  function pct(v) {
    if (v >= 0.1) return (Math.round(v * 1000) / 10) + '%';
    if (v >= 0.001) return (Math.round(v * 100000) / 1000) + '%';
    return (Math.round(v * 10000000) / 100000) + '%';
  }
  function times(a, b) {
    if (!b) return '';
    var r = a / b;
    if (r >= 10) return Math.round(r) + '×';
    // One decimal below ten, always: a bare "1×" for a ratio of 0.99 reads as
    // a claimed win when it is a tie.
    return r.toFixed(1) + '×';
  }

  function button(text, onClick, cls) {
    var el = E('button', 'db-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }
  function group(title) {
    var box = E('div', 'db-group');
    box.appendChild(E('p', 'db-group-title', title));
    return box;
  }
  function field(labelText, control) {
    var wrap = E('label', 'db-field');
    wrap.appendChild(E('span', 'db-field-label', labelText));
    wrap.appendChild(control);
    return wrap;
  }
  function selectBox(options, value, onChange) {
    var el = E('select', 'db-select');
    options.forEach(function (o) {
      var op = E('option', null, o.label);
      op.value = o.key;
      if (o.key === value) op.selected = true;
      el.appendChild(op);
    });
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }
  function checkBox(labelText, checked, onChange) {
    var wrap = E('label', 'db-check');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    wrap.appendChild(input);
    wrap.appendChild(E('span', null, labelText));
    wrap.control = input;
    return wrap;
  }
  /* A labelled range slider that reports its value as it moves. */
  function slider(labelText, min, max, step, value, format, onChange) {
    var wrap = E('div', 'db-slider');
    var head = E('div', 'db-slider-head');
    var lab = E('label', 'db-field-label', labelText);
    var out = E('span', 'db-slider-value', format(value));
    head.appendChild(lab);
    head.appendChild(out);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'db-range';
    var id = 'db-sl-' + Math.random().toString(36).slice(2, 9);
    input.id = id;
    lab.setAttribute('for', id);
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      out.textContent = format(v);
      onChange(v);
    });
    wrap.appendChild(head);
    wrap.appendChild(input);
    wrap.control = input;
    return wrap;
  }

  function table(head, rows, cls) {
    var t = E('table', 'db-table' + (cls ? ' ' + cls : ''));
    var thead = E('thead'), tr = E('tr');
    head.forEach(function (h) { tr.appendChild(E('th', null, h)); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = E('tbody');
    rows.forEach(function (r) {
      var row = E('tr');
      if (r.cls) row.className = r.cls;
      (r.cells || r).forEach(function (cell) {
        var td = E('td', 'db-td');
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    var scroll = E('div', 'db-scroll');
    scroll.appendChild(t);
    return scroll;
  }

  /* ======================================================================== */
  /*  THE STORAGE MODEL                                                       */
  /* ------------------------------------------------------------------------ */
  /*  Everything downstream is counted against these numbers, so they are all  */
  /*  in one place and all quoted on the page.                                 */
  /* ======================================================================== */

  var PAGE_BYTES = 8192;
  var PAGE_HEADER = 64;      // per-page bookkeeping a real page also carries
  var FILL = 0.7;            // typical steady-state fill of a B+tree page
  var ROW_BYTES = 200;
  var ROWS_PER_PAGE = Math.floor(PAGE_BYTES / ROW_BYTES);   // 40
  var N_ROWS = 100000;
  var HEAP_PAGES = Math.ceil(N_ROWS / ROWS_PER_PAGE);       // 2500

  var CITIES = ['Ahmedabad', 'Bengaluru', 'Chennai', 'Delhi', 'Hyderabad',
                'Indore', 'Jaipur', 'Kolkata', 'Lucknow', 'Mumbai',
                'Pune', 'Surat'];
  var AGE_MIN = 18, AGE_SPAN = 60;      // 18..77
  var SIGNUP_DAYS = 2000;               // day 0..1999

  var WORK_MEM_BYTES = 4 * 1024 * 1024; // PostgreSQL's default work_mem

  /* Planner constants. random_page_cost is the one the visitor moves, because
     it is the one that actually changed when the industry moved off spinning
     disks — 4.0 is the historical default and 1.1 is what people set on SSDs. */
  var COST = {
    seqPage: 1.0,
    randPage: 4.0,
    cpuTuple: 0.01,
    cpuIndexTuple: 0.005,
    cpuOperator: 0.0025
  };

  /* How many index entries fit on one page, at the stated fill factor. The
     +6 is the heap pointer every entry carries alongside its key. */
  function entriesPerPage(keyBytes) {
    return Math.floor((PAGE_BYTES - PAGE_HEADER) * FILL / (keyBytes + 6));
  }
  /* Levels in a B+tree holding nRows entries: leaves first, then keep folding
     upwards until one node is left. Counted, not logged, so the ceilings land
     where a real build would put them. */
  function treeHeight(nRows, perLeaf, fanout) {
    var nodes = Math.max(1, Math.ceil(nRows / perLeaf));
    var h = 1;
    while (nodes > 1 && h < 64) { nodes = Math.ceil(nodes / fanout); h++; }
    return h;
  }

  /* Deterministic generator, so every visitor sees the same table and can
     repeat any number on this page. A linear congruential generator is not a
     good source of randomness and is a perfectly good source of a fixed,
     reproducible shuffle, which is all that is wanted here. */
  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      // Kept in floating point on purpose: 4294967295 * 1664525 is about
      // 7.1e15, comfortably inside the 9.0e15 that a double represents
      // exactly, so this is the same sequence everywhere without Math.imul
      // (which is ES6, and this file is ES5).
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  function buildTable() {
    var rnd = lcg(20260831);
    var city = new Uint8Array(N_ROWS);
    var age = new Uint8Array(N_ROWS);
    var signup = new Int32Array(N_ROWS);
    for (var i = 0; i < N_ROWS; i++) {
      city[i] = Math.floor(rnd() * CITIES.length);
      age[i] = AGE_MIN + Math.floor(rnd() * AGE_SPAN);
      signup[i] = Math.floor(rnd() * SIGNUP_DAYS);
    }
    return { city: city, age: age, signup: signup };
  }

  /* Build an index over an integer key column.

     A counting sort rather than a comparison sort: every key here is a small
     integer, so this is exact, stable and linear, and stability means ties come
     out in physical row order — which is what a real index build does when it
     sorts (key, ctid) pairs.

     `starts[k]` ends up holding the number of entries with a key strictly less
     than k, which makes "the rank range for keys in [a, b]" a pair of array
     reads rather than a search. */
  function buildIndex(spec) {
    var keys = spec.keys, keyMax = spec.keyMax;
    var i;
    var starts = new Int32Array(keyMax + 2);
    for (i = 0; i < N_ROWS; i++) starts[keys[i] + 1]++;
    for (i = 1; i <= keyMax + 1; i++) starts[i] += starts[i - 1];

    var cursor = new Int32Array(keyMax + 1);
    for (i = 0; i <= keyMax; i++) cursor[i] = starts[i];
    var order = new Int32Array(N_ROWS);
    for (i = 0; i < N_ROWS; i++) order[cursor[keys[i]]++] = i;

    var rank = new Int32Array(N_ROWS);
    for (i = 0; i < N_ROWS; i++) rank[order[i]] = i;

    var perLeaf = entriesPerPage(spec.keyBytes + (spec.includeBytes || 0));
    var fanout = entriesPerPage(spec.keyBytes);
    var leaves = Math.ceil(N_ROWS / perLeaf);

    return {
      name: spec.name,
      cols: spec.cols,
      include: spec.include || null,
      keys: keys,
      keyMax: keyMax,
      keyBytes: spec.keyBytes,
      starts: starts,
      order: order,
      rank: rank,
      perLeaf: perLeaf,
      fanout: fanout,
      leaves: leaves,
      pages: leaves + Math.max(0, treeHeight(N_ROWS, perLeaf, fanout) - 1),
      height: treeHeight(N_ROWS, perLeaf, fanout)
    };
  }

  /* Rank range for keys in [lo, hi] inclusive. */
  function rankRange(idx, lo, hi) {
    if (hi < lo) return { lo: 0, hi: 0 };
    var a = Math.max(0, Math.min(idx.keyMax + 1, lo));
    var b = Math.max(0, Math.min(idx.keyMax + 1, hi + 1));
    return { lo: idx.starts[a], hi: idx.starts[b] };
  }

  /* How many index pages a scan of rank range [lo, hi) touches: the descent
     (every level above the leaves) plus every leaf the range lands in. */
  function indexPagesFor(idx, lo, hi) {
    var descent = Math.max(0, idx.height - 1);
    if (hi <= lo) return descent + 1;
    var first = Math.floor(lo / idx.perLeaf);
    var last = Math.floor((hi - 1) / idx.perLeaf);
    return descent + (last - first + 1);
  }

  /* ------------------------------------------------------------------------
     Heap page accounting. This is the part that has to be counted rather than
     estimated, because it is where correlation lives: the same 500 rows cost
     500 page reads when they are scattered and 13 when they are not.
     ------------------------------------------------------------------------ */

  // Reused across calls with a generation stamp, so a full-table query does not
  // allocate a 2,500-entry array every time a slider moves.
  var seenPage = new Int32Array(HEAP_PAGES);
  var seenGen = 0;

  function makePageOf(state, idx) {
    if (state.physical === 'clustered' && idx) {
      var rank = idx.rank;
      return function (rowid) { return Math.floor(rank[rowid] / ROWS_PER_PAGE); };
    }
    return function (rowid) { return Math.floor(rowid / ROWS_PER_PAGE); };
  }

  /* Three numbers, because the plans read the heap differently and the gaps
     between them are the whole reason bitmap heap scans and CLUSTER exist.

       reads    — pages an ordinary index scan reads, following the index in
                  key order and remembering only the page it is standing on.
       forward  — how many of those reads landed on the page immediately after
                  the last one. Those are sequential reads and cost
                  seq_page_cost; the rest are seeks and cost random_page_cost.
                  On a table clustered by this key almost every read is one of
                  these, which is the entire point of clustering — and it is
                  measured here rather than estimated from a correlation
                  coefficient, which is the one place this model is better than
                  the formula it imitates.
       distinct — pages a bitmap heap scan reads, having collected every match
                  first and sorted them into physical order.

     For a clustered table `reads` and `distinct` are equal, because reading in
     key order and reading in page order are the same thing. */
  function heapCost(order, lo, hi, pageOf) {
    var reads = 0, distinct = 0, forward = 0, last = -1;
    seenGen++;
    for (var r = lo; r < hi; r++) {
      var p = pageOf(order[r]);
      if (p !== last) {
        reads++;
        if (p === last + 1) forward++;
        last = p;
      }
      if (seenPage[p] !== seenGen) { seenPage[p] = seenGen; distinct++; }
    }
    return { reads: reads, distinct: distinct, forward: forward };
  }

  /* ======================================================================== */
  /*  PLANS AND COSTS                                                         */
  /* ------------------------------------------------------------------------ */
  /*  A cut-down costsize.c. Every plan reports the pages it reads and the     */
  /*  cost the model puts on them; the planner is `min`.                       */
  /* ======================================================================== */

  function seqScanPlan(matched) {
    return {
      kind: 'seq',
      label: 'Seq Scan on users',
      indexPages: 0,
      heapPages: HEAP_PAGES,
      pages: HEAP_PAGES,
      rows: matched,
      cost: COST.seqPage * HEAP_PAGES +
            COST.cpuTuple * N_ROWS +
            COST.cpuOperator * N_ROWS
    };
  }

  function indexScanPlan(idx, lo, hi, heap, indexOnly) {
    var matched = hi - lo;
    var indexPages = indexPagesFor(idx, lo, hi);
    var heapPages = indexOnly ? 0 : heap.reads;
    /* The index pages themselves are always seeks. The heap pages are split by
       what was actually measured: a read that landed on the next page along is
       a sequential read and is priced as one. PostgreSQL reaches the same place
       by interpolating on a correlation statistic; counting the forward steps
       is the same idea with the guesswork taken out. */
    var forward = indexOnly ? 0 : heap.forward;
    var seeks = heapPages - forward;
    return {
      kind: indexOnly ? 'indexonly' : 'index',
      label: (indexOnly ? 'Index Only Scan using ' : 'Index Scan using ') + idx.name + ' on users',
      indexPages: indexPages,
      heapPages: heapPages,
      forward: forward,
      pages: indexPages + heapPages,
      rows: matched,
      cost: COST.randPage * (indexPages + seeks) +
            COST.seqPage * forward +
            COST.cpuIndexTuple * matched +
            COST.cpuTuple * matched
    };
  }

  function bitmapScanPlan(idx, lo, hi, heap) {
    var matched = hi - lo;
    var indexPages = indexPagesFor(idx, lo, hi);
    var fetched = heap.distinct;
    /* PostgreSQL's own interpolation: a bitmap heap scan visits pages in
       physical order, so the more of the table it touches the closer each page
       costs to a sequential read. sqrt of the fraction is the curve it uses. */
    var frac = HEAP_PAGES ? Math.min(1, fetched / HEAP_PAGES) : 0;
    var perPage = COST.randPage - (COST.randPage - COST.seqPage) * Math.sqrt(frac);
    return {
      kind: 'bitmap',
      label: 'Bitmap Heap Scan on users',
      indexPages: indexPages,
      heapPages: fetched,
      pages: indexPages + fetched,
      rows: matched,
      cost: COST.randPage * indexPages +
            perPage * fetched +
            COST.cpuTuple * matched +
            COST.cpuIndexTuple * matched +
            0.1 * indexPages          // building the bitmap is not free
    };
  }

  function cheapest(plans) {
    var best = null;
    for (var i = 0; i < plans.length; i++) {
      if (!plans[i]) continue;
      if (!best || plans[i].cost < best.cost) best = plans[i];
    }
    return best;
  }

  /* ------------------------------------------------------------------------
     Sorting without an index: PostgreSQL's two shapes.
     ------------------------------------------------------------------------ */
  function sortCost(rows, limit) {
    var bytes = rows * ROW_BYTES;
    if (limit && limit * ROW_BYTES <= WORK_MEM_BYTES) {
      // Top-N heapsort: only the running best `limit` rows are held, so nothing
      // spills and the comparison count is n log(limit).
      return {
        method: 'top-N heapsort',
        extraPages: 0,
        cpu: COST.cpuOperator * rows * Math.max(1, Math.log(Math.max(2, limit)) / Math.LN2)
      };
    }
    if (bytes <= WORK_MEM_BYTES) {
      return {
        method: 'quicksort in memory',
        extraPages: 0,
        cpu: COST.cpuOperator * rows * (Math.log(Math.max(2, rows)) / Math.LN2)
      };
    }
    // External merge: write the runs out, read them back once. One merge pass
    // is enough at this size, and the page count says so rather than assuming.
    var sortPages = Math.ceil(bytes / PAGE_BYTES);
    return {
      method: 'external merge sort',
      extraPages: sortPages * 2,
      cpu: COST.cpuOperator * rows * (Math.log(Math.max(2, rows)) / Math.LN2),
      sortPages: sortPages
    };
  }

  /* ======================================================================== */
  /*  A REAL B+TREE                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Small, live, and honest: it splits on overflow and borrows or merges on  */
  /*  underflow, and it counts the nodes each operation had to write, because  */
  /*  that count is the cost of the index nobody quotes.                       */
  /* ======================================================================== */

  function BTree(order) {
    this.setOrder(order);
    this.reset();
  }

  BTree.prototype.setOrder = function (order) {
    this.order = order;                       // maximum children per node
    this.maxKeys = order - 1;
    // Leaves hold at least ceil(maxKeys/2) keys; internal nodes at least
    // ceil(order/2)-1 keys, which is the same as ceil(order/2) children.
    this.minLeafKeys = Math.ceil(this.maxKeys / 2);
    this.minInternalKeys = Math.ceil(order / 2) - 1;
  };

  BTree.prototype.reset = function () {
    this.root = { leaf: true, keys: [], next: null };
    this.inserts = 0;
    this.totalWrites = 0;
    this.lastWrites = 0;
    this.touched = [];
    this.trace = [];
  };

  BTree.prototype.touch = function (node) {
    if (this.touched.indexOf(node) < 0) this.touched.push(node);
  };
  BTree.prototype.say = function (text) { this.trace.push(text); };

  BTree.prototype.height = function () {
    var h = 1, n = this.root;
    while (!n.leaf) { n = n.children[0]; h++; }
    return h;
  };

  BTree.prototype.walk = function (fn) {
    var level = [this.root], depth = 0;
    while (level.length) {
      var next = [];
      for (var i = 0; i < level.length; i++) {
        fn(level[i], depth, i);
        if (!level[i].leaf) {
          for (var j = 0; j < level[i].children.length; j++) next.push(level[i].children[j]);
        }
      }
      level = next;
      depth++;
    }
  };

  BTree.prototype.count = function () {
    var nodes = 0, leaves = 0, keys = 0;
    this.walk(function (n) {
      nodes++;
      if (n.leaf) { leaves++; keys += n.keys.length; }
    });
    return { nodes: nodes, leaves: leaves, keys: keys };
  };

  function lowerBound(keys, key) {
    var lo = 0, hi = keys.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid] < key) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  // Child to follow for `key`: separator keys[i] means "children[i+1] holds
  // keys >= keys[i]", so the first separator strictly greater than key wins.
  function childIndex(node, key) {
    var i = 0;
    while (i < node.keys.length && key >= node.keys[i]) i++;
    return i;
  }

  /* The path from the root to the leaf that would hold `key`. This is what a
     lookup reads, one page per level, and it is what the tree drawing
     highlights so the reader can count the reads themselves. */
  BTree.prototype.path = function (key) {
    var out = [], n = this.root;
    for (;;) {
      out.push(n);
      if (n.leaf) return out;
      n = n.children[childIndex(n, key)];
    }
  };

  BTree.prototype.insert = function (key) {
    this.touched = [];
    this.trace = [];
    var split = this.insertInto(this.root, key);
    if (split === 'duplicate') {
      this.say('Key ' + key + ' is already in the tree; a unique index would reject the row here.');
      this.lastWrites = 0;
      return false;
    }
    if (split) {
      var newRoot = { leaf: false, keys: [split.key], children: [this.root, split.node] };
      this.root = newRoot;
      this.touch(newRoot);
      this.say('The root split, so the tree grew a level. It is now ' + this.height() +
               ' levels deep — this is the only way a B+tree ever gets taller, ' +
               'which is why every leaf stays the same distance from the root.');
    }
    this.inserts++;
    this.lastWrites = this.touched.length;
    this.totalWrites += this.lastWrites;
    return true;
  };

  BTree.prototype.insertInto = function (node, key) {
    var i;
    if (node.leaf) {
      i = lowerBound(node.keys, key);
      if (node.keys[i] === key) return 'duplicate';
      node.keys.splice(i, 0, key);
      this.touch(node);
      if (node.keys.length <= this.maxKeys) {
        this.say('Key ' + key + ' fitted in an existing leaf. One node written.');
        return null;
      }
      var mid = Math.ceil(node.keys.length / 2);
      var right = { leaf: true, keys: node.keys.slice(mid), next: node.next };
      node.keys = node.keys.slice(0, mid);
      node.next = right;
      this.touch(right);
      this.say('The leaf overflowed at ' + (this.maxKeys + 1) + ' keys, so it split: ' +
               '[' + node.keys.join(' ') + '] and [' + right.keys.join(' ') + ']. ' +
               'In a B+tree the first key of the new leaf is COPIED upwards — the ' +
               'leaves still hold every key.');
      return { key: right.keys[0], node: right };
    }

    i = childIndex(node, key);
    var res = this.insertInto(node.children[i], key);
    if (!res || res === 'duplicate') return res;

    node.keys.splice(i, 0, res.key);
    node.children.splice(i + 1, 0, res.node);
    this.touch(node);
    if (node.keys.length <= this.maxKeys) return null;

    var m = Math.floor(node.keys.length / 2);
    var upKey = node.keys[m];
    var rightNode = {
      leaf: false,
      keys: node.keys.slice(m + 1),
      children: node.children.slice(m + 1)
    };
    node.keys = node.keys.slice(0, m);
    node.children = node.children.slice(0, m + 1);
    this.touch(rightNode);
    this.say('That pushed a key into the parent, which overflowed too, so it split ' +
             'and sent ' + upKey + ' further up. Above the leaves the separator MOVES ' +
             'up rather than being copied — internal nodes only route.');
    return { key: upKey, node: rightNode };
  };

  BTree.prototype.remove = function (key) {
    this.touched = [];
    this.trace = [];
    var found = this.removeFrom(this.root, key);
    if (!found) {
      this.say('Key ' + key + ' is not in the tree, so nothing was written.');
      this.lastWrites = 0;
      return false;
    }
    if (!this.root.leaf && this.root.keys.length === 0) {
      this.root = this.root.children[0];
      this.say('The root was left with no keys, so it was dropped and the tree lost ' +
               'a level. It is now ' + this.height() + ' levels deep.');
    }
    this.refresh(this.root);
    this.lastWrites = this.touched.length;
    return true;
  };

  BTree.prototype.removeFrom = function (node, key) {
    if (node.leaf) {
      var i = node.keys.indexOf(key);
      if (i < 0) return false;
      node.keys.splice(i, 1);
      this.touch(node);
      this.say('Key ' + key + ' was removed from its leaf.');
      return true;
    }
    var ci = childIndex(node, key);
    if (!this.removeFrom(node.children[ci], key)) return false;
    var child = node.children[ci];
    var min = child.leaf ? this.minLeafKeys : this.minInternalKeys;
    if (child.keys.length >= min || (node === this.root && node.children.length <= 1)) {
      return true;
    }
    this.rebalance(node, ci);
    return true;
  };

  BTree.prototype.rebalance = function (parent, ci) {
    var child = parent.children[ci];
    var left = ci > 0 ? parent.children[ci - 1] : null;
    var right = ci < parent.children.length - 1 ? parent.children[ci + 1] : null;
    var min = child.leaf ? this.minLeafKeys : this.minInternalKeys;

    if (left && left.keys.length > min) {
      if (child.leaf) {
        child.keys.unshift(left.keys.pop());
        parent.keys[ci - 1] = child.keys[0];
      } else {
        child.keys.unshift(parent.keys[ci - 1]);
        child.children.unshift(left.children.pop());
        parent.keys[ci - 1] = left.keys.pop();
      }
      this.touch(child); this.touch(left); this.touch(parent);
      this.say('The node dropped below its minimum, so it BORROWED a key from its ' +
               'left sibling. Three nodes written and the shape is unchanged.');
      return;
    }
    if (right && right.keys.length > min) {
      if (child.leaf) {
        child.keys.push(right.keys.shift());
        parent.keys[ci] = right.keys[0];
      } else {
        child.keys.push(parent.keys[ci]);
        child.children.push(right.children.shift());
        parent.keys[ci] = right.keys.shift();
      }
      this.touch(child); this.touch(right); this.touch(parent);
      this.say('The node dropped below its minimum, so it BORROWED a key from its ' +
               'right sibling. Three nodes written and the shape is unchanged.');
      return;
    }

    // No sibling can spare a key, so two nodes become one.
    var target, source, sepIndex;
    if (left) { target = left; source = child; sepIndex = ci - 1; }
    else { target = child; source = right; sepIndex = ci; }
    if (!source) return;

    if (target.leaf) {
      target.keys = target.keys.concat(source.keys);
      target.next = source.next;
    } else {
      target.keys = target.keys.concat([parent.keys[sepIndex]], source.keys);
      target.children = target.children.concat(source.children);
    }
    parent.keys.splice(sepIndex, 1);
    parent.children.splice(sepIndex + 1, 1);
    this.touch(target); this.touch(parent);
    this.say('Neither sibling had a key to spare, so the two nodes MERGED into one ' +
             'and the separator came down out of the parent. A merge is how a ' +
             'B+tree shrinks, and it is why heavy deleting can leave an index ' +
             'half-empty rather than smaller.');
  };

  /* Separator keys are only routing values, and a real B+tree happily leaves a
     stale one in place after a delete because it still routes correctly. That
     is invisible on disk and confusing on screen — a reader sees a key in an
     internal node that is nowhere in the leaves and reasonably concludes the
     drawing is wrong. So the picture is refreshed to the smallest key of the
     right subtree, which is always a valid separator. It is a drawing decision,
     not an extra write: nothing here is added to the node-write count. */
  BTree.prototype.refresh = function (node) {
    if (node.leaf) return node.keys.length ? node.keys[0] : null;
    var mins = [];
    for (var i = 0; i < node.children.length; i++) mins.push(this.refresh(node.children[i]));
    for (var j = 0; j < node.keys.length; j++) {
      if (mins[j + 1] != null) node.keys[j] = mins[j + 1];
    }
    return mins[0];
  };

  /* ======================================================================== */
  /*  SCOPED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Injected rather than added to labs.css: every selector below is          */
  /*  meaningless outside this lab, and keeping them beside the code that      */
  /*  generates the markup is the only way they stay in step. The CSP allows   */
  /*  'unsafe-inline' for style and forbids it for script, which is why this   */
  /*  is a <style> node and nothing here is eval'd. Every rule is id-scoped so  */
  /*  the site stylesheet and the light theme leave the instrument alone.      */
  /* ======================================================================== */

  var CSS = [
    '#dbindexviz .db-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    '#dbindexviz .db-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,0.6);}',
    '#dbindexviz .db-tab{font:inherit;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#dbindexviz .db-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#dbindexviz .db-tab[aria-selected="true"]{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#dbindexviz .db-tab:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#dbindexviz .db-body{display:grid;grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start;}',
    '#dbindexviz .db-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,0.6);min-width:0;}',
    '#dbindexviz .db-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '@media (max-width:900px){#dbindexviz .db-body{grid-template-columns:minmax(0,1fr);}' +
      '#dbindexviz .db-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',
    '#dbindexviz .db-panel:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:10px;}',

    '#dbindexviz .db-group{margin:0 0 14px;}',
    '#dbindexviz .db-group-title{margin:0 0 7px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#dbindexviz .db-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 7px;}',
    '#dbindexviz .db-field-label{color:' + C.dim + ';font-size:12px;}',
    '#dbindexviz .db-num{width:5.2rem;font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:4px 6px;text-align:right;}',
    '#dbindexviz .db-select{font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:100%;}',
    '#dbindexviz .db-num:focus-visible,#dbindexviz .db-select:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#dbindexviz .db-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;}',
    '#dbindexviz .db-btn:hover{background:#213152;border-color:#40608f;}',
    '#dbindexviz .db-btn:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#dbindexviz .db-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#dbindexviz .db-btn[disabled]{opacity:.4;cursor:default;}',
    '#dbindexviz .db-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '#dbindexviz .db-hint{margin:6px 0 0;font-size:11px;line-height:1.6;color:' + C.faint + ';}',
    '#dbindexviz .db-check{display:flex;align-items:center;gap:7px;margin:0 0 6px;font-size:12px;color:' + C.dim + ';cursor:pointer;}',
    '#dbindexviz .db-check input{accent-color:' + C.blue + ';cursor:pointer;}',
    '#dbindexviz .db-check input:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#dbindexviz .db-slider{margin:0 0 10px;}',
    '#dbindexviz .db-slider-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px;}',
    '#dbindexviz .db-slider-value{font-size:12px;font-weight:700;color:' + C.cyan + ';}',
    '#dbindexviz .db-range{width:100%;accent-color:' + C.blue + ';cursor:pointer;}',
    '#dbindexviz .db-range:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;}',

    '#dbindexviz .db-table{width:100%;border-collapse:collapse;font-size:12px;}',
    '#dbindexviz .db-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#dbindexviz .db-td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,0.6);color:' + C.ink + ';white-space:nowrap;}',
    '#dbindexviz .db-scroll{overflow-x:auto;}',
    '#dbindexviz .db-row-best .db-td{color:' + C.green + ';font-weight:700;}',
    '#dbindexviz .db-row-bad .db-td{color:' + C.red + ';}',

    '#dbindexviz .db-note{padding:9px 12px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '#dbindexviz .db-note b{color:' + C.ink + ';}',
    '#dbindexviz .db-warnnote{border-left-color:' + C.amber + ';background:rgba(251,191,36,.07);}',
    '#dbindexviz .db-sql{margin:0;padding:9px 12px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg0 + ';font:inherit;font-size:12px;line-height:1.65;color:' + C.cyan + ';white-space:pre-wrap;overflow-x:auto;}',
    '#dbindexviz .db-explain{margin:0;padding:9px 12px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg0 + ';font:inherit;font-size:11.5px;line-height:1.6;color:' + C.dim + ';white-space:pre;overflow-x:auto;}',
    '#dbindexviz .db-explain b{color:' + C.ink + ';font-weight:700;}',
    '#dbindexviz .db-sub{margin:0;font-size:11px;line-height:1.6;color:' + C.faint + ';}',
    '#dbindexviz .db-h{margin:4px 0 0;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',

    '#dbindexviz .db-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:10px;}',
    '#dbindexviz .db-card{padding:11px 12px;border:1px solid ' + C.line + ';border-radius:10px;background:rgba(15,23,42,.55);min-width:0;}',
    '#dbindexviz .db-card-win{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.06);}',
    '#dbindexviz .db-card-h{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';}',
    '#dbindexviz .db-big{margin:0;font-size:22px;font-weight:700;line-height:1.2;color:' + C.cyan + ';}',
    '#dbindexviz .db-card-win .db-big{color:' + C.green + ';}',
    '#dbindexviz .db-card-note{margin:5px 0 0;font-size:11px;line-height:1.6;color:' + C.dim + ';}',
    '#dbindexviz .db-plan{margin:6px 0 0;font-size:11.5px;color:' + C.ink + ';white-space:normal;overflow-wrap:anywhere;}',

    '#dbindexviz .db-bars{display:flex;flex-direction:column;gap:7px;}',
    '#dbindexviz .db-bar-row{display:flex;align-items:center;gap:9px;}',
    '#dbindexviz .db-bar-name{flex:0 0 9.5rem;font-size:11px;color:' + C.dim + ';}',
    '#dbindexviz .db-bar-track{flex:1 1 auto;height:20px;border-radius:5px;background:#111c2f;border:1px solid #24344f;overflow:hidden;min-width:2rem;}',
    '#dbindexviz .db-bar-fill{height:100%;background:' + C.blue + ';}',
    '#dbindexviz .db-bar-fill.win{background:' + C.green + ';}',
    '#dbindexviz .db-bar-fill.lose{background:' + C.red + ';}',
    '#dbindexviz .db-bar-num{flex:0 0 6.5rem;font-size:11px;text-align:right;color:' + C.ink + ';}',

    '#dbindexviz .db-treewrap{overflow-x:auto;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';padding:10px;}',
    '#dbindexviz .db-tree{display:block;}',
    '#dbindexviz .db-outline{margin:0;padding:9px 12px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg0 + ';font:inherit;font-size:11.5px;line-height:1.65;color:' + C.dim + ';white-space:pre;overflow-x:auto;max-height:14rem;overflow-y:auto;}',

    /* height:auto with a fixed viewBox, so the strip scales uniformly and the
       city labels on it are never stretched sideways on a narrow screen. */
    '#dbindexviz .db-strip{display:block;width:100%;height:auto;}',
    '#dbindexviz .db-stripwrap{border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';padding:10px;}',
    '#dbindexviz .db-canvas{display:block;width:100%;height:320px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';}',
    '@media (max-width:640px){#dbindexviz .db-canvas{height:250px;}}',

    '#dbindexviz .db-tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;}',
    '#dbindexviz .db-tag-ok{background:rgba(52,211,153,.16);color:' + C.green + ';}',
    '#dbindexviz .db-tag-no{background:rgba(252,165,165,.14);color:' + C.red + ';}',
    '#dbindexviz .db-tag-warn{background:rgba(251,191,36,.14);color:' + C.amber + ';}',
    '#dbindexviz .db-hidden{display:none;}'
  ].join('');

  /* ======================================================================== */
  /*  EXPLAIN RENDERING                                                       */
  /* ------------------------------------------------------------------------ */
  /*  Deliberately shaped like real EXPLAIN (ANALYZE, BUFFERS) output, because  */
  /*  the vocabulary is most of the benefit. The cost range is startup..total,  */
  /*  the way PostgreSQL prints it.                                            */
  /* ======================================================================== */

  /* Numbers inside this block are deliberately NOT grouped with thousands
     separators, unlike every other number on the page: real EXPLAIN output has
     none, and the point of the block is that the shape is familiar when you
     next meet it in a terminal. */
  function explainLines(plan, opts) {
    var startup = plan.kind === 'seq' ? 0 : 0.29;
    var lines = [];
    lines.push(plan.label + '  (cost=' + money(startup) + '..' + money(plan.cost) +
               ' rows=' + plan.rows + ' width=' + (opts.width || ROW_BYTES) + ')');
    if (plan.kind === 'seq' && opts.filter) {
      lines.push('  Filter: ' + opts.filter);
      lines.push('  Rows Removed by Filter: ' + (N_ROWS - plan.rows));
    }
    if (plan.kind === 'bitmap') {
      lines.push('  Recheck Cond: ' + (opts.cond || ''));
      lines.push('  Heap Blocks: exact=' + plan.heapPages);
      lines.push('  ->  Bitmap Index Scan on ' + opts.indexName +
                 '  (cost=0.00..' + money(COST.randPage * plan.indexPages) +
                 ' rows=' + plan.rows + ' width=0)');
      lines.push('        Index Cond: ' + (opts.cond || ''));
    }
    if (plan.kind === 'index' || plan.kind === 'indexonly') {
      if (opts.cond) lines.push('  Index Cond: ' + opts.cond);
      if (opts.indexFilter) lines.push('  Filter: ' + opts.indexFilter);
      if (plan.kind === 'indexonly') lines.push('  Heap Fetches: 0');
    }
    if (opts.sort) lines.push('  Sort Method: ' + opts.sort);
    lines.push('  Buffers: ' + plan.pages + ' page reads' +
               (plan.indexPages ? '  (' + plan.indexPages + ' index + ' +
                plan.heapPages + ' heap)' : ''));
    return lines;
  }

  function explainBlock(title, plan, opts) {
    var pre = E('pre', 'db-explain');
    var head = E('b', null, title + '\n');
    pre.appendChild(head);
    pre.appendChild(document.createTextNode(explainLines(plan, opts || {}).join('\n')));
    return pre;
  }

  function barRow(name, value, max, cls) {
    var row = E('div', 'db-bar-row');
    row.appendChild(E('span', 'db-bar-name', name));
    var track = E('div', 'db-bar-track');
    var fill = E('div', 'db-bar-fill' + (cls ? ' ' + cls : ''));
    fill.style.width = Math.max(1, Math.round(100 * value / Math.max(1, max))) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(E('span', 'db-bar-num', num(value) + ' pages'));
    return row;
  }

  /* ======================================================================== */
  /*  PANEL 1 — THE LIVE B+TREE                                               */
  /* ======================================================================== */

  function TreePanel(app) {
    this.app = app;
    this.label = 'B+tree';
    this.order = 4;
    this.tree = new BTree(this.order);
    this.highlight = null;      // key whose descent path is drawn lit
    this.nextKey = 10;
    this.seed();
  }

  TreePanel.prototype.seed = function () {
    this.tree.setOrder(this.order);
    this.tree.reset();
    var start = [50, 20, 80, 10, 30, 60, 90, 40, 70, 100, 25, 55];
    for (var i = 0; i < start.length; i++) this.tree.insert(start[i]);
    this.tree.trace = [];
    this.tree.inserts = 0;
    this.tree.totalWrites = 0;
    this.tree.lastWrites = 0;
    this.tree.touched = [];
    this.message = 'Twelve keys inserted to give you something to break. Insert, ' +
                   'delete, or drag the fan-out and watch the shape change.';
  };

  TreePanel.prototype.buildControls = function (side, redraw) {
    var self = this;

    var gOrder = group('Node order (fan-out)');
    gOrder.appendChild(slider('Children per node', 3, 8, 1, this.order,
      function (v) { return String(v); },
      function (v) {
        self.order = v;
        self.seed();
        self.message = 'Rebuilt at order ' + v + '. Each node now holds at most ' +
          (v - 1) + ' keys, so it splits on the ' + v + 'th.';
        redraw();
      }));
    gOrder.appendChild(E('p', 'db-hint',
      'Three to eight, so splits are visible. A real index uses hundreds — the ' +
      'table under the tree shows what that does to the height.'));
    side.appendChild(gOrder);

    var gKey = group('Insert and delete');
    var input = E('input', 'db-num');
    input.type = 'number';
    input.min = '1';
    input.max = '999';
    input.value = '35';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('aria-label', 'Key to insert or delete');
    gKey.appendChild(field('Key', input));

    function readKey() {
      var v = parseInt(input.value, 10);
      if (isNaN(v)) return null;
      return Math.max(1, Math.min(999, v));
    }
    var row = E('div', 'db-btnrow');
    row.appendChild(button('Insert', function () {
      var k = readKey();
      if (k === null) { self.message = 'Type a whole number between 1 and 999 first.'; redraw(); return; }
      self.tree.insert(k);
      self.highlight = k;
      self.message = null;
      redraw();
    }));
    row.appendChild(button('Delete', function () {
      var k = readKey();
      if (k === null) { self.message = 'Type a whole number between 1 and 999 first.'; redraw(); return; }
      self.tree.remove(k);
      self.highlight = k;
      self.message = null;
      redraw();
    }));
    row.appendChild(button('Look up', function () {
      var k = readKey();
      if (k === null) { self.message = 'Type a whole number between 1 and 999 first.'; redraw(); return; }
      self.highlight = k;
      // A lookup writes nothing, so the amber "these nodes were written" marks
      // from the previous insert or delete must not linger over it.
      self.tree.touched = [];
      var path = self.tree.path(k);
      var leaf = path[path.length - 1];
      self.tree.trace = [
        'Looking up ' + k + ' read ' + path.length + ' page' + (path.length === 1 ? '' : 's') +
        ': one per level, ending at the leaf holding [' + leaf.keys.join(' ') + ']. ' +
        (leaf.keys.indexOf(k) >= 0 ? 'The key is there.'
                                   : 'The key is not there — and the tree still had to read every ' +
                                     'one of those pages to prove it.')
      ];
      self.message = null;
      redraw();
    }));
    gKey.appendChild(row);

    var row2 = E('div', 'db-btnrow');
    row2.appendChild(button('Insert a random key', function () {
      var k;
      var guard = 0;
      do { k = 1 + Math.floor(Math.random() * 999); guard++; } while (!self.tree.insert(k) && guard < 40);
      input.value = String(k);
      self.highlight = k;
      self.message = null;
      redraw();
    }));
    row2.appendChild(button('Add ten', function () {
      var added = [];
      for (var i = 0; i < 10; i++) {
        var k = 1 + Math.floor(Math.random() * 999);
        if (self.tree.insert(k)) added.push(k);
      }
      self.highlight = null;
      self.tree.touched = [];
      self.tree.trace = ['Inserted ' + added.length + ' keys: ' + added.join(', ') +
                        '. Average nodes written per insert since the last reset is in ' +
                        'the cards below.'];
      self.message = null;
      redraw();
    }));
    row2.appendChild(button('Reset', function () {
      self.seed();
      self.highlight = null;
      redraw();
    }));
    gKey.appendChild(row2);
    gKey.appendChild(E('p', 'db-hint',
      'Delete keys from one leaf until it drops below half full and watch it ' +
      'borrow from a sibling, then merge when there is nothing left to borrow.'));
    side.appendChild(gKey);
  };

  /* Lay the tree out: leaves left to right at their natural width, every
     internal node centred over the children it points at. Done as a plain
     bottom-up pass rather than a general graph layout, which is all a tree
     needs and keeps the drawing predictable. */
  TreePanel.prototype.layout = function () {
    var CELL = 26, PADX = 8, GAP = 18, ROWH = 84, TOP = 14;
    var levels = [];
    this.tree.walk(function (node, depth) {
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(node);
    });

    var boxes = [];
    var byNode = [];
    function widthOf(node) { return Math.max(1, node.keys.length) * CELL + PADX * 2; }

    var x = 0;
    var deepest = levels.length - 1;
    for (var i = 0; i < levels[deepest].length; i++) {
      var leaf = levels[deepest][i];
      var w = widthOf(leaf);
      byNode.push({ node: leaf, x: x, y: TOP + deepest * ROWH, w: w, depth: deepest });
      x += w + GAP;
    }
    var totalW = Math.max(1, x - GAP);

    for (var d = deepest - 1; d >= 0; d--) {
      for (var j = 0; j < levels[d].length; j++) {
        var node = levels[d][j];
        var first = null, last = null;
        for (var c = 0; c < node.children.length; c++) {
          var box = find(node.children[c]);
          if (box) { if (!first) first = box; last = box; }
        }
        var centre = first && last
          ? ((first.x + first.w / 2) + (last.x + last.w / 2)) / 2
          : totalW / 2;
        var wd = widthOf(node);
        byNode.push({ node: node, x: centre - wd / 2, y: TOP + d * ROWH, w: wd, depth: d });
      }
    }

    function find(n) {
      for (var k = 0; k < byNode.length; k++) if (byNode[k].node === n) return byNode[k];
      return null;
    }

    // Nothing may start left of zero once internal nodes have been centred.
    var minX = 0;
    for (var m = 0; m < byNode.length; m++) minX = Math.min(minX, byNode[m].x);
    if (minX < 0) {
      for (var n2 = 0; n2 < byNode.length; n2++) byNode[n2].x -= minX;
      totalW -= minX;
    }
    var maxX = 0;
    for (var p = 0; p < byNode.length; p++) maxX = Math.max(maxX, byNode[p].x + byNode[p].w);

    boxes = byNode;
    return {
      boxes: boxes, find: find, cell: CELL, padx: PADX,
      width: Math.max(maxX, totalW) + 4,
      height: TOP + (deepest + 1) * ROWH
    };
  };

  TreePanel.prototype.drawTree = function () {
    var self = this;
    var L = this.layout();
    var pathNodes = this.highlight != null ? this.tree.path(this.highlight) : [];
    var touched = this.tree.touched || [];

    var svg = S('svg', {
      'class': 'db-tree',
      width: Math.round(L.width),
      height: Math.round(L.height),
      viewBox: '0 0 ' + Math.round(L.width) + ' ' + Math.round(L.height),
      role: 'img'
    });
    var stats = this.tree.count();
    svg.setAttribute('aria-label',
      'B+tree of order ' + this.order + ': ' + this.tree.height() + ' levels, ' +
      stats.nodes + ' nodes, ' + stats.leaves + ' leaves, ' + stats.keys +
      ' keys. The same tree is written out as text below the picture.');

    // Edges first, so the boxes sit on top of them.
    L.boxes.forEach(function (box) {
      if (box.node.leaf) return;
      for (var c = 0; c < box.node.children.length; c++) {
        var kid = L.find(box.node.children[c]);
        if (!kid) continue;
        var lit = pathNodes.indexOf(box.node) >= 0 && pathNodes.indexOf(kid) >= 0;
        svg.appendChild(S('line', {
          x1: box.x + box.w / 2, y1: box.y + 34,
          x2: kid.x + kid.w / 2, y2: kid.y,
          stroke: lit ? C.amber : '#2c4160',
          'stroke-width': lit ? 2 : 1
        }));
      }
    });

    // Leaf sibling chain: the thing that makes a range scan cheap.
    L.boxes.forEach(function (box) {
      if (!box.node.leaf || !box.node.next) return;
      var nxt = L.find(box.node.next);
      if (!nxt) return;
      svg.appendChild(S('line', {
        x1: box.x + box.w, y1: box.y + 17,
        x2: nxt.x, y2: nxt.y + 17,
        stroke: 'rgba(52,211,153,.5)', 'stroke-width': 1,
        'stroke-dasharray': '3 3'
      }));
    });

    L.boxes.forEach(function (box) {
      var node = box.node;
      var onPath = pathNodes.indexOf(node) >= 0;
      var wasTouched = touched.indexOf(node) >= 0;
      var stroke = wasTouched ? C.amber : (onPath ? C.blue : '#2c4160');
      svg.appendChild(S('rect', {
        x: box.x, y: box.y, width: box.w, height: 34, rx: 7,
        fill: node.leaf ? 'rgba(52,211,153,.08)' : 'rgba(56,189,248,.08)',
        stroke: stroke, 'stroke-width': wasTouched || onPath ? 2 : 1
      }));
      for (var k = 0; k < node.keys.length; k++) {
        var cx = box.x + L.padx + k * L.cell + L.cell / 2;
        var isKey = self.highlight != null && node.keys[k] === self.highlight;
        var t = S('text', {
          x: cx, y: box.y + 22, 'text-anchor': 'middle',
          'font-family': FONT, 'font-size': 12,
          fill: isKey ? C.amber : (node.leaf ? C.ink : C.cyan)
        });
        t.textContent = String(node.keys[k]);
        svg.appendChild(t);
        if (k > 0) {
          svg.appendChild(S('line', {
            x1: box.x + L.padx + k * L.cell, y1: box.y + 6,
            x2: box.x + L.padx + k * L.cell, y2: box.y + 28,
            stroke: 'rgba(148,163,184,.22)', 'stroke-width': 1
          }));
        }
      }
      if (node.keys.length === 0) {
        var empty = S('text', {
          x: box.x + box.w / 2, y: box.y + 22, 'text-anchor': 'middle',
          'font-family': FONT, 'font-size': 11, fill: C.faint
        });
        empty.textContent = 'empty';
        svg.appendChild(empty);
      }
    });

    var wrap = E('div', 'db-treewrap');
    wrap.appendChild(svg);
    return wrap;
  };

  TreePanel.prototype.outline = function () {
    var lines = [];
    this.tree.walk(function (node, depth) {
      lines.push(rep('  ', depth) +
        (node.leaf ? 'leaf  ' : 'node  ') +
        '[' + node.keys.join(' ') + ']' +
        (node.leaf && node.next ? '  → next leaf' : ''));
    });
    var pre = E('pre', 'db-outline');
    pre.textContent = 'The same tree as text, top level first:\n\n' + lines.join('\n');
    return pre;
  };

  TreePanel.prototype.render = function (main) {
    var stats = this.tree.count();
    var h = this.tree.height();

    main.appendChild(this.drawTree());

    var legend = E('p', 'db-sub',
      'Blue boxes are internal nodes and only route; green boxes are leaves and ' +
      'hold every key. The dashed green line is the leaf chain — that is what a ' +
      'range scan walks once it has found where to start. Amber marks the nodes ' +
      'the last operation had to write.');
    main.appendChild(legend);

    var note = E('div', 'db-note');
    if (this.message) {
      note.textContent = this.message;
    } else if (this.tree.trace.length) {
      this.tree.trace.forEach(function (t, i) {
        if (i) note.appendChild(document.createElement('br'));
        note.appendChild(document.createTextNode(t));
      });
    } else {
      note.textContent = 'Insert a key, delete one, or look one up.';
    }
    main.appendChild(note);

    var cards = E('div', 'db-cards');
    cards.appendChild(statCard('Levels', String(h),
      'A lookup reads one page per level. That is the whole speed argument.'));
    cards.appendChild(statCard('Nodes / leaves', stats.nodes + ' / ' + stats.leaves,
      stats.keys + ' keys stored, all of them in the leaves.'));
    cards.appendChild(statCard('Nodes written, last op', String(this.tree.lastWrites),
      this.tree.lastWrites > 1 ? 'A split or a merge is why this is not 1.'
        : this.tree.lastWrites === 1 ? 'A plain insert or delete touches one node.'
        : 'Nothing written yet. A lookup reads and writes nothing.'));
    cards.appendChild(statCard('Average per insert',
      this.tree.inserts ? (Math.round(this.tree.totalWrites / this.tree.inserts * 100) / 100).toFixed(2) : '—',
      this.tree.inserts ? 'Over ' + this.tree.inserts + ' inserts since the last reset.'
                        : 'Insert a few keys to see it.'));
    main.appendChild(cards);

    main.appendChild(this.outline());

    /* The fan-out lesson: the same arithmetic at toy scale and at production
       scale, side by side. */
    main.appendChild(E('p', 'db-h', 'Why a real index is short and fat'));
    var rows = [];
    var fanouts = [this.order, 16, 64, 256, entriesPerPage(4)];
    var seen = {};
    fanouts.forEach(function (f) {
      if (seen[f]) return;
      seen[f] = true;
      rows.push([
        String(f),
        String(treeHeight(100000, f, f)),
        String(treeHeight(1000000, f, f)),
        String(treeHeight(1000000000, f, f))
      ]);
    });
    main.appendChild(table(
      ['Children per node', '100 thousand rows', '1 million rows', '1 billion rows'],
      rows));
    main.appendChild(E('p', 'db-sub',
      'Levels, which is page reads per lookup. An 8 KB page holds ' +
      num(entriesPerPage(4)) + ' entries for a 4-byte key at a ' +
      Math.round(FILL * 100) + '% fill factor, which is why a billion-row index ' +
      'is four levels deep and not thirty. The tree above uses a fan-out of ' +
      this.order + ' only so that a split fits on your screen.'));

    /* Write amplification — the cost of an index that nobody puts in the
       tutorial. Computed from the real index shapes, not asserted. */
    main.appendChild(E('p', 'db-h', 'What each index costs you on the way in'));
    var idxHeight = treeHeight(N_ROWS, entriesPerPage(4), entriesPerPage(4));
    var wrows = [];
    for (var k = 0; k <= 4; k++) {
      wrows.push({
        cells: [
          k === 0 ? 'no index' : k + (k === 1 ? ' index' : ' indexes'),
          '1',
          String(k * idxHeight),
          String(1 + k),
          k === 0 ? 'baseline' : times(1 + k, 1) + ' the pages written'
        ],
        cls: k === 0 ? 'db-row-best' : (k >= 3 ? 'db-row-bad' : '')
      });
    }
    main.appendChild(table(
      ['Table', 'Heap pages written', 'Index pages read', 'Pages written', 'Versus none'],
      wrows));
    main.appendChild(E('p', 'db-sub',
      'One INSERT into the ' + num(N_ROWS) + '-row table on the other tabs. Each index ' +
      'has to be descended (' + idxHeight + ' page reads at this size) and then its ' +
      'leaf written, and roughly one insert in ' + entriesPerPage(4) +
      ' also splits that leaf and writes two more. This is the real trade: every ' +
      'index you add to make a read fast makes every write slower, forever. ' +
      'An index nothing queries is pure cost.'));
  };

  function statCard(title, big, note, win) {
    var card = E('div', 'db-card' + (win ? ' db-card-win' : ''));
    card.appendChild(E('p', 'db-card-h', title));
    card.appendChild(E('p', 'db-big', big));
    if (note) card.appendChild(E('p', 'db-card-note', note));
    return card;
  }

  /* ======================================================================== */
  /*  PANEL 2 — QUERY COST, WITH AND WITHOUT THE INDEX                        */
  /* ======================================================================== */

  function QueryPanel(app) {
    this.app = app;
    this.label = 'Query cost';
    this.query = 'lookup';
    this.day = 900;
    this.width = 10;
    this.limit = 100;
  }

  QueryPanel.prototype.buildControls = function (side, redraw) {
    var self = this;
    var app = this.app;

    var g = group('Query');
    g.appendChild(field('Shape', selectBox([
      { key: 'lookup', label: 'Point lookup (signup = ?)' },
      { key: 'range', label: 'Range scan (signup BETWEEN ?)' },
      { key: 'sort', label: 'Sort (ORDER BY signup)' }
    ], this.query, function (v) { self.query = v; redraw(); })));
    side.appendChild(g);

    var gp = group('Parameters');
    var dayInput = E('input', 'db-num');
    dayInput.type = 'number';
    dayInput.min = '0';
    dayInput.max = String(SIGNUP_DAYS - 1);
    dayInput.value = String(this.day);
    dayInput.setAttribute('inputmode', 'numeric');
    dayInput.setAttribute('aria-label', 'Signup day');
    dayInput.addEventListener('change', function () {
      var v = parseInt(dayInput.value, 10);
      if (isNaN(v)) v = 0;
      self.day = Math.max(0, Math.min(SIGNUP_DAYS - 1, v));
      dayInput.value = String(self.day);
      redraw();
    });
    gp.appendChild(field('Signup day', dayInput));
    gp.appendChild(slider('Range width, in days', 1, 400, 1, this.width,
      function (v) { return v + (v === 1 ? ' day' : ' days'); },
      function (v) { self.width = v; redraw(); }));
    gp.appendChild(field('LIMIT', selectBox([
      { key: '100', label: '100 rows' },
      { key: '1000', label: '1,000 rows' },
      { key: '0', label: 'no limit' }
    ], String(this.limit), function (v) { self.limit = parseInt(v, 10); redraw(); })));
    side.appendChild(gp);

    var gt = group('The table');
    gt.appendChild(field('Physical order', selectBox([
      { key: 'insert', label: 'Insertion order (uncorrelated)' },
      { key: 'clustered', label: 'Clustered by signup' }
    ], app.physical, function (v) { app.setPhysical(v); redraw(); })));
    gt.appendChild(E('p', 'db-hint',
      'Clustered means the rows are physically stored in signup order, the way ' +
      'CLUSTER or a clustered primary key leaves them. Nothing about the index ' +
      'changes; only where the matching rows live.'));
    side.appendChild(gt);

    var gc = group('Planner');
    gc.appendChild(slider('random_page_cost', 1, 6, 0.1, COST.randPage,
      function (v) { return v.toFixed(1); },
      function (v) { COST.randPage = v; redraw(); }));
    gc.appendChild(E('p', 'db-hint',
      'How much dearer a scattered page read is than a sequential one. 4.0 is ' +
      'the historical default, written for spinning disks; 1.1 is what people ' +
      'set on SSDs.'));
    side.appendChild(gc);
  };

  QueryPanel.prototype.render = function (main) {
    var app = this.app;
    var idx = app.idxSignup;
    var pageOf = makePageOf(app, idx);

    var lo, hi, sql, cond, filter, sortMethod = null, noIndexPlan, withIndexPlan, alt = null;
    var noIndexExtra = 0;

    if (this.query === 'lookup') {
      var r = rankRange(idx, this.day, this.day);
      lo = r.lo; hi = r.hi;
      sql = 'SELECT * FROM users\n WHERE signup_day = ' + this.day + ';';
      cond = '(signup_day = ' + this.day + ')';
      filter = cond;
    } else if (this.query === 'range') {
      var hiDay = Math.min(SIGNUP_DAYS - 1, this.day + this.width - 1);
      var r2 = rankRange(idx, this.day, hiDay);
      lo = r2.lo; hi = r2.hi;
      sql = 'SELECT * FROM users\n WHERE signup_day BETWEEN ' + this.day + ' AND ' + hiDay + ';';
      cond = '(signup_day >= ' + this.day + ' AND signup_day <= ' + hiDay + ')';
      filter = cond;
    } else {
      lo = 0;
      hi = this.limit ? Math.min(N_ROWS, this.limit) : N_ROWS;
      sql = 'SELECT * FROM users\n ORDER BY signup_day' + (this.limit ? '\n LIMIT ' + this.limit : '') + ';';
      cond = null;
      filter = null;
    }

    var heap = heapCost(idx.order, lo, hi, pageOf);
    var matched = hi - lo;

    if (this.query === 'sort') {
      // Without the index the whole table has to be read and then sorted.
      var sc = sortCost(N_ROWS, this.limit);
      sortMethod = sc.method;
      noIndexExtra = sc.extraPages;
      noIndexPlan = {
        kind: 'seq',
        label: 'Sort  ->  Seq Scan on users',
        indexPages: 0,
        heapPages: HEAP_PAGES + sc.extraPages,
        pages: HEAP_PAGES + sc.extraPages,
        rows: matched,
        cost: COST.seqPage * (HEAP_PAGES + sc.extraPages) + COST.cpuTuple * N_ROWS + sc.cpu
      };
      withIndexPlan = indexScanPlan(idx, lo, hi, heap, false);
    } else {
      noIndexPlan = seqScanPlan(matched);
      var ix = indexScanPlan(idx, lo, hi, heap, false);
      var bm = bitmapScanPlan(idx, lo, hi, heap);
      withIndexPlan = ix.cost <= bm.cost ? ix : bm;
      alt = ix.cost <= bm.cost ? bm : ix;
    }

    var chosen = withIndexPlan.cost < noIndexPlan.cost ? withIndexPlan : noIndexPlan;

    var pre = E('pre', 'db-sql');
    pre.textContent = sql;
    main.appendChild(pre);

    var cards = E('div', 'db-cards');
    cards.appendChild(statCard('Without the index', num(noIndexPlan.pages) + ' pages',
      noIndexPlan.label + '. Every one of the ' + num(HEAP_PAGES) +
      ' heap pages is read whatever the WHERE clause says' +
      (noIndexExtra ? ', then ' + num(noIndexExtra) + ' more written and read back to sort.' : '.'),
      chosen === noIndexPlan));
    cards.appendChild(statCard('With idx_signup', num(withIndexPlan.pages) + ' pages',
      num(withIndexPlan.indexPages) + ' index page' + (withIndexPlan.indexPages === 1 ? '' : 's') +
      ' to find the ' + num(matched) + ' matching row' + (matched === 1 ? '' : 's') + ', then ' +
      num(withIndexPlan.heapPages) + ' heap page' + (withIndexPlan.heapPages === 1 ? '' : 's') +
      ' to fetch them.',
      chosen === withIndexPlan));
    cards.appendChild(statCard('Rows matched', num(matched),
      pct(matched / N_ROWS) + ' of the table. This number is what decides everything ' +
      'else on this page.'));
    main.appendChild(cards);

    var bars = E('div', 'db-bars');
    var max = Math.max(noIndexPlan.pages, withIndexPlan.pages);
    bars.appendChild(barRow('No index', noIndexPlan.pages, max,
      chosen === noIndexPlan ? 'win' : 'lose'));
    bars.appendChild(barRow('With the index', withIndexPlan.pages, max,
      chosen === withIndexPlan ? 'win' : 'lose'));
    main.appendChild(bars);

    var note = E('div', 'db-note' + (chosen === noIndexPlan ? ' db-warnnote' : ''));
    note.textContent = this.verdict(noIndexPlan, withIndexPlan, chosen, matched, heap, sortMethod);
    main.appendChild(note);

    main.appendChild(E('p', 'db-h', 'What the planner would print'));
    main.appendChild(explainBlock('-- with the index dropped', noIndexPlan, {
      filter: filter, sort: this.query === 'sort' ? sortMethod : null
    }));
    main.appendChild(explainBlock('-- with idx_signup in place', withIndexPlan, {
      cond: cond, indexName: idx.name,
      sort: this.query === 'sort' ? 'none needed, the index is already in order' : null
    }));
    if (alt) {
      main.appendChild(explainBlock('-- the plan it rejected', alt, {
        cond: cond, indexName: idx.name
      }));
    }

    main.appendChild(E('p', 'db-sub',
      'Costs use seq_page_cost ' + COST.seqPage.toFixed(1) + ', random_page_cost ' +
      COST.randPage.toFixed(1) + ', cpu_tuple_cost ' + COST.cpuTuple +
      '. Page counts are not estimates: the heap page of every matching row was ' +
      'looked up and the reads counted, which is why changing the physical order ' +
      'changes the number. Two plans can read the same number of pages and still ' +
      'cost differently — a bitmap heap scan visits them in physical order, so most ' +
      'of them are priced as sequential reads rather than seeks.'));
  };

  QueryPanel.prototype.verdict = function (noIdx, withIdx, chosen, matched, heap, sortMethod) {
    var app = this.app;
    var clustered = app.physical === 'clustered';
    if (this.query === 'sort') {
      if (chosen === withIdx) {
        return 'The index is already in signup order, so the rows come out sorted and no ' +
          'sort step happens at all. Without it the whole table is read and then sorted ' +
          '(' + sortMethod + '), which is ' + num(noIdx.pages) + ' pages against ' +
          num(withIdx.pages) + '. This is the single best reason to index a column you ' +
          'only ever ORDER BY.';
      }
      return 'Here the index loses, and it is worth understanding why. Reading all ' +
        num(matched) + ' rows in index order means jumping around the heap: ' +
        num(withIdx.heapPages) + ' page reads, because consecutive keys live on ' +
        'unrelated pages. Reading the table straight through and sorting it costs ' +
        num(noIdx.pages) + '. Take the LIMIT off an ORDER BY and the index usually stops ' +
        'being worth it — unless the table is clustered on that column, which you can ' +
        'try in the controls.';
    }
    if (chosen === noIdx) {
      return 'The scan wins. ' + num(matched) + ' rows is ' + pct(matched / N_ROWS) +
        ' of the table, and they are spread across ' + num(heap.distinct) + ' of the ' +
        num(HEAP_PAGES) + ' heap pages — so using the index would mean reading almost the ' +
        'whole table anyway, one scattered page at a time, plus the index on top. ' +
        'A planner that refuses your index here is not broken; it is right.';
    }
    /* The interesting middle. Around the crossover the index plan can cost
       marginally less while reading MORE pages than the scan does, because it
       only has to look at the rows the index pointed at. Saying "the index wins
       by 1.0×" there would be an overclaim dressed up as a measurement, so this
       branch says what is actually true: the two are a tie, and a tie inside a
       simplified cost model is not a result. */
    if (noIdx.pages < withIdx.pages * 1.3) {
      return 'This is the flat part of the curve, and it is worth sitting with. ' +
        num(matched) + ' rows is ' + pct(matched / N_ROWS) + ' of the table, scattered over ' +
        num(heap.distinct) + ' of the ' + num(HEAP_PAGES) + ' heap pages, so the index plan ' +
        'reads ' + num(withIdx.pages) + ' pages against the scan’s ' + num(noIdx.pages) +
        ' — no real saving at all. The model puts them at ' + money(withIdx.cost) + ' and ' +
        money(noIdx.cost) + ', which is close enough that the winner here should be read as ' +
        '"about the same", not as a result. Widen the range further and the scan takes it ' +
        'outright; narrow it and the index pulls away.';
    }
    var ratio = times(noIdx.pages, withIdx.pages);
    var extra = clustered
      ? ' The table is clustered on signup, so the matching rows sit next to each ' +
        'other and the heap side collapses to ' + num(withIdx.heapPages) + ' page' +
        (withIdx.heapPages === 1 ? '' : 's') + '. Physical order is doing as much work ' +
        'here as the index is.'
      : ' The rows are scattered across ' + num(heap.distinct) + ' pages, because the ' +
        'table is in insertion order and signup has nothing to do with it. Cluster the ' +
        'table on signup in the controls and watch the heap side collapse.';
    return 'The index wins by ' + ratio + ' on pages read. ' +
      num(withIdx.indexPages) + ' index page' + (withIdx.indexPages === 1 ? '' : 's') +
      ' narrowed ' + num(N_ROWS) + ' rows down to ' + num(matched) + ' before the table ' +
      'was touched at all.' + extra;
  };

  /* ======================================================================== */
  /*  PANEL 3 — COMPOSITE INDEXES AND THE LEFTMOST PREFIX                     */
  /* ======================================================================== */

  function CompositePanel(app) {
    this.app = app;
    this.label = 'Composite (a, b)';
    this.mode = 'both';
    this.city = 3;
    this.age = 40;
  }

  CompositePanel.prototype.buildControls = function (side, redraw) {
    var self = this;
    var g = group('Which columns the query names');
    g.appendChild(field('Predicate', selectBox([
      { key: 'both', label: 'city = ? AND age = ?' },
      { key: 'left', label: 'city = ?   (prefix only)' },
      { key: 'right', label: 'age = ?    (no prefix)' }
    ], this.mode, function (v) { self.mode = v; redraw(); })));
    side.appendChild(g);

    var gp = group('Values');
    var cityOpts = CITIES.map(function (name, i) {
      return { key: String(i), label: name };
    });
    gp.appendChild(field('city', selectBox(cityOpts, String(this.city),
      function (v) { self.city = parseInt(v, 10); redraw(); })));
    var ageInput = E('input', 'db-num');
    ageInput.type = 'number';
    ageInput.min = String(AGE_MIN);
    ageInput.max = String(AGE_MIN + AGE_SPAN - 1);
    ageInput.value = String(this.age);
    ageInput.setAttribute('inputmode', 'numeric');
    ageInput.setAttribute('aria-label', 'Age');
    ageInput.addEventListener('change', function () {
      var v = parseInt(ageInput.value, 10);
      if (isNaN(v)) v = AGE_MIN;
      self.age = Math.max(AGE_MIN, Math.min(AGE_MIN + AGE_SPAN - 1, v));
      ageInput.value = String(self.age);
      redraw();
    });
    gp.appendChild(field('age', ageInput));
    side.appendChild(gp);

    var gi = group('The index');
    gi.appendChild(E('p', 'db-hint',
      'CREATE INDEX idx_city_age ON users (city, age); one index, in that order. ' +
      'The strip on the right is its leaf entries laid out left to right in the ' +
      'order they are actually stored.'));
    side.appendChild(gi);

    var gt = group('The table');
    gt.appendChild(field('Physical order', selectBox([
      { key: 'insert', label: 'Insertion order (uncorrelated)' },
      { key: 'clustered', label: 'Clustered by (city, age)' }
    ], this.app.physical, function (v) { self.app.setPhysical(v); redraw(); })));
    side.appendChild(gt);
  };

  /* The strip: every index entry, in stored order, as one horizontal bar with
     the twelve city bands marked, and the matching entries painted on top.

     This is the whole argument for the leftmost-prefix rule in one picture. A
     predicate on `city` is one contiguous block, so the tree can descend to it.
     A predicate on `age` alone is twelve thin stripes with the rest of the
     index in between, so there is nowhere to descend to — the entries are
     there, but not gathered. */
  CompositePanel.prototype.drawStrip = function (ranges) {
    var idx = this.app.idxCityAge;
    var W = 900, H = 96, TOP = 18, BAR = 44;
    var svg = S('svg', {
      'class': 'db-strip', viewBox: '0 0 ' + W + ' ' + H, role: 'img'
    });
    svg.setAttribute('aria-label',
      'The index entries in stored order. ' +
      (ranges.length === 1
        ? 'The matching rows form one contiguous block, so the tree can descend straight to it.'
        : 'The matching rows form ' + ranges.length + ' separate stripes with unrelated ' +
          'entries between them, so there is no single place for the tree to descend to.'));

    svg.appendChild(S('rect', {
      x: 0, y: TOP, width: W, height: BAR, fill: '#111c2f',
      stroke: '#24344f', 'stroke-width': 1
    }));

    // City bands.
    for (var c = 0; c < CITIES.length; c++) {
      var s = idx.starts[c * 100] / N_ROWS * W;
      var e = idx.starts[(c + 1) * 100] / N_ROWS * W;
      if (c % 2 === 1) {
        svg.appendChild(S('rect', {
          x: s, y: TOP, width: Math.max(0, e - s), height: BAR,
          fill: 'rgba(148,163,184,.06)'
        }));
      }
      if (c > 0) {
        svg.appendChild(S('line', {
          x1: s, y1: TOP, x2: s, y2: TOP + BAR,
          stroke: 'rgba(148,163,184,.28)', 'stroke-width': 1
        }));
      }
      var t = S('text', {
        x: (s + e) / 2, y: TOP - 6, 'text-anchor': 'middle',
        'font-family': FONT, 'font-size': 9, fill: C.faint
      });
      t.textContent = CITIES[c].slice(0, 3);
      svg.appendChild(t);
    }

    ranges.forEach(function (r) {
      var x = r.lo / N_ROWS * W;
      var w = Math.max(0.9, (r.hi - r.lo) / N_ROWS * W);
      svg.appendChild(S('rect', {
        x: x, y: TOP, width: w, height: BAR, fill: C.amber, opacity: 0.9
      }));
    });

    var cap = S('text', {
      x: 4, y: H - 4, 'font-family': FONT, 'font-size': 9, fill: C.faint
    });
    cap.textContent = 'first entry';
    svg.appendChild(cap);
    var cap2 = S('text', {
      x: W - 4, y: H - 4, 'text-anchor': 'end',
      'font-family': FONT, 'font-size': 9, fill: C.faint
    });
    cap2.textContent = num(N_ROWS) + 'th entry';
    svg.appendChild(cap2);

    var wrap = E('div', 'db-stripwrap');
    wrap.appendChild(svg);
    return wrap;
  };

  CompositePanel.prototype.render = function (main) {
    var app = this.app;
    var idx = app.idxCityAge;
    var pageOf = makePageOf(app, idx);
    var i;

    var ranges = [], sql, cond, indexFilter = null, canDescend = true;
    if (this.mode === 'both') {
      var k = this.city * 100 + this.age;
      var r = rankRange(idx, k, k);
      ranges = [{ lo: r.lo, hi: r.hi }];
      sql = 'SELECT * FROM users\n WHERE city = ' + this.city +
            '   -- ' + CITIES[this.city] + '\n   AND age  = ' + this.age + ';';
      cond = '(city = ' + this.city + ' AND age = ' + this.age + ')';
    } else if (this.mode === 'left') {
      var r2 = rankRange(idx, this.city * 100, this.city * 100 + 99);
      ranges = [{ lo: r2.lo, hi: r2.hi }];
      sql = 'SELECT * FROM users\n WHERE city = ' + this.city + ';   -- ' + CITIES[this.city];
      cond = '(city = ' + this.city + ')';
    } else {
      for (i = 0; i < CITIES.length; i++) {
        var rr = rankRange(idx, i * 100 + this.age, i * 100 + this.age);
        if (rr.hi > rr.lo) ranges.push({ lo: rr.lo, hi: rr.hi });
      }
      sql = 'SELECT * FROM users\n WHERE age = ' + this.age + ';';
      cond = null;
      indexFilter = '(age = ' + this.age + ')';
      canDescend = false;
    }

    var matched = 0;
    for (i = 0; i < ranges.length; i++) matched += ranges[i].hi - ranges[i].lo;

    var pre = E('pre', 'db-sql');
    pre.textContent = 'CREATE INDEX idx_city_age ON users (city, age);\n\n' + sql;
    main.appendChild(pre);

    main.appendChild(this.drawStrip(ranges));
    main.appendChild(E('p', 'db-sub',
      'Every entry in idx_city_age, in the order it is stored: sorted by city ' +
      'first, then by age inside each city. Amber is what this query needs.'));

    // Cost the plans.
    var seqPlan = seqScanPlan(matched);
    var idxPlan, note, tag;

    if (canDescend) {
      var lo = ranges[0].lo, hi = ranges[0].hi;
      var heap = heapCost(idx.order, lo, hi, pageOf);
      var ixs = indexScanPlan(idx, lo, hi, heap, false);
      var bms = bitmapScanPlan(idx, lo, hi, heap);
      idxPlan = ixs.cost <= bms.cost ? ixs : bms;
      tag = 'ok';
      note = this.mode === 'both'
        ? 'Both columns are named, in the index’s own order, so the descent goes ' +
          'straight to the ' + num(matched) + ' entries that match and reads nothing ' +
          'else. This is the case the index was created for.'
        : 'Only the first column is named, and that is enough. Everything for ' +
          CITIES[this.city] + ' sits in one block because city is the first key, so ' +
          'the tree descends to the start of the block and walks it. The index is ' +
          'still doing its job on a query that never mentions age.';
    } else {
      /* Nothing to descend to. Two survivable plans: read the table, or read
         the whole index and filter it. PostgreSQL will genuinely consider the
         second when the index is much narrower than the table. */
      seenGen++;
      var reads = 0, last = -1;
      for (i = 0; i < ranges.length; i++) {
        for (var rk = ranges[i].lo; rk < ranges[i].hi; rk++) {
          var p = pageOf(idx.order[rk]);
          if (p !== last) { reads++; last = p; }
          if (seenPage[p] !== seenGen) seenPage[p] = seenGen;
        }
      }
      var fullIndexPages = idx.leaves + Math.max(0, idx.height - 1);
      idxPlan = {
        kind: 'index',
        label: 'Index Scan using idx_city_age on users',
        indexPages: fullIndexPages,
        heapPages: reads,
        pages: fullIndexPages + reads,
        rows: matched,
        cost: COST.randPage * (fullIndexPages + reads) +
              COST.cpuIndexTuple * N_ROWS + COST.cpuTuple * matched
      };
      tag = 'no';
      note = 'The index cannot be descended for this query. Age is the second key, so ' +
        'the rows with age = ' + this.age + ' are scattered into ' + ranges.length +
        ' separate stripes with everything else in between — there is no single place ' +
        'to jump to. That is the leftmost-prefix rule, and it is not a limitation ' +
        'somebody chose: the entries are sorted by city first, so age simply is not ' +
        'in order across the index. The database can still read every one of the ' +
        num(idx.leaves) + ' leaf pages and filter them, which it will do when the ' +
        'index is much narrower than the table, but that is a full scan of the index, ' +
        'not a lookup.';
    }

    var chosen = idxPlan.cost < seqPlan.cost ? idxPlan : seqPlan;

    var cards = E('div', 'db-cards');
    cards.appendChild(statCard('Rows matched', num(matched),
      pct(matched / N_ROWS) + ' of the table, in ' + ranges.length +
      (ranges.length === 1 ? ' contiguous block of the index.' : ' separate stripes of the index.')));
    cards.appendChild(statCard('Index pages read', num(idxPlan.indexPages),
      canDescend ? 'The descent plus the leaves the block lands in.'
                 : 'Every leaf in the index, because there is nowhere to descend to.'));
    cards.appendChild(statCard('Total pages, index plan', num(idxPlan.pages),
      'Against ' + num(seqPlan.pages) + ' for reading the table straight through.',
      chosen === idxPlan));
    main.appendChild(cards);

    /* Always say which plan the model actually picks, and by how much. Without
       this the panel could show an index plan reading fewer pages than the
       table while the planner still refuses it — which is exactly what happens
       on the age-only query — and leave the reader to guess why. */
    var margin = chosen === idxPlan
      ? 'Costed out, the index plan comes to ' + money(idxPlan.cost) + ' against ' +
        money(seqPlan.cost) + ' for reading the table straight through, so the model ' +
        'picks the index' +
        (seqPlan.cost < idxPlan.cost * 1.3
          ? ' — but only just, and a margin that thin is not a result.'
          : '.')
      : 'Costed out, the index plan comes to ' + money(idxPlan.cost) + ' against ' +
        money(seqPlan.cost) + ' for reading the table straight through, so the model ' +
        'refuses the index here. Page count is not the whole story: an index plan pays ' +
        'random_page_cost for pages it seeks to, and a sequential scan pays ' +
        'seq_page_cost for pages it walks past.';

    var verdict = E('div', 'db-note' + (canDescend ? '' : ' db-warnnote'));
    verdict.appendChild(document.createTextNode(note + ' ' + margin));
    main.appendChild(verdict);

    main.appendChild(E('p', 'db-h', 'What the planner would print'));
    main.appendChild(explainBlock('-- using idx_city_age', idxPlan, {
      cond: cond, indexFilter: indexFilter, indexName: idx.name
    }));
    main.appendChild(explainBlock('-- reading the table instead', seqPlan, {
      filter: cond || indexFilter
    }));

    main.appendChild(E('p', 'db-h', 'The rule, stated once'));
    main.appendChild(table(
      ['Query names', 'Can descend?', 'What happens'],
      [
        { cells: ['city, age', 'yes', 'Both keys narrow the descent. Best case.'], cls: 'db-row-best' },
        { cells: ['city only', 'yes', 'The first key alone still gives one contiguous block.'], cls: 'db-row-best' },
        { cells: ['city, and a range on age', 'yes', 'Equality on the prefix, then a range inside it.'], cls: 'db-row-best' },
        { cells: ['a range on city, then age', 'partly', 'Only city narrows the descent; age becomes a filter.'] },
        { cells: ['age only', 'no', 'No prefix. Scan the table, or scan the whole index.'], cls: 'db-row-bad' }
      ]));
    main.appendChild(E('p', 'db-sub',
      'This is why (city, age) and (age, city) are different indexes and why column ' +
      'order in a composite index is a real decision. If you query both columns and ' +
      'also query one of them alone, put that one first — then one index serves both.'));
  };

  /* ======================================================================== */
  /*  PANEL 4 — COVERING INDEXES AND THE INDEX-ONLY SCAN                      */
  /* ======================================================================== */

  function CoveringPanel(app) {
    this.app = app;
    this.label = 'Covering index';
    this.cols = { id: false, city: true, age: true, signup: false };
    this.include = false;
    this.city = 3;
    this.ageLo = 30;
    this.ageHi = 40;
  }

  CoveringPanel.prototype.buildControls = function (side, redraw) {
    var self = this;

    var g = group('SELECT list');
    ['city', 'age', 'signup', 'id'].forEach(function (col) {
      g.appendChild(checkBox(col, self.cols[col], function (on) {
        self.cols[col] = on;
        redraw();
      }));
    });
    var row = E('div', 'db-btnrow');
    row.appendChild(button('SELECT *', function () {
      self.cols = { id: true, city: true, age: true, signup: true };
      redraw();
    }));
    row.appendChild(button('Just the indexed columns', function () {
      self.cols = { id: false, city: true, age: true, signup: false };
      redraw();
    }));
    row.appendChild(button('COUNT(*)', function () {
      self.cols = { id: false, city: false, age: false, signup: false };
      redraw();
    }));
    g.appendChild(row);
    side.appendChild(g);

    var gi = group('The index');
    gi.appendChild(checkBox('add INCLUDE (signup_day)', this.include, function (on) {
      self.include = on;
      redraw();
    }));
    gi.appendChild(E('p', 'db-hint',
      'INCLUDE stores a column in the leaves without making it part of the key. ' +
      'It cannot be searched on, but it can be returned — which is the whole point.'));
    side.appendChild(gi);

    var gp = group('Predicate');
    gp.appendChild(field('city', selectBox(CITIES.map(function (n, i) {
      return { key: String(i), label: n };
    }), String(this.city), function (v) { self.city = parseInt(v, 10); redraw(); })));
    gp.appendChild(slider('age from', AGE_MIN, AGE_MIN + AGE_SPAN - 1, 1, this.ageLo,
      function (v) { return String(v); },
      function (v) { self.ageLo = v; if (self.ageHi < v) self.ageHi = v; redraw(); }));
    gp.appendChild(slider('age to', AGE_MIN, AGE_MIN + AGE_SPAN - 1, 1, this.ageHi,
      function (v) { return String(v); },
      function (v) { self.ageHi = v; if (self.ageLo > v) self.ageLo = v; redraw(); }));
    side.appendChild(gp);
  };

  CoveringPanel.prototype.render = function (main) {
    var app = this.app;
    var idx = this.include ? app.idxCityAgeInc : app.idxCityAge;
    var pageOf = makePageOf(app, idx);

    var r = rankRange(idx, this.city * 100 + this.ageLo, this.city * 100 + this.ageHi);
    var lo = r.lo, hi = r.hi, matched = hi - lo;
    var heap = heapCost(idx.order, lo, hi, pageOf);

    var wanted = [];
    if (this.cols.id) wanted.push('id');
    if (this.cols.city) wanted.push('city');
    if (this.cols.age) wanted.push('age');
    if (this.cols.signup) wanted.push('signup_day');

    var available = { city: true, age: true };
    if (this.include) available.signup_day = true;
    var missing = [];
    for (var i = 0; i < wanted.length; i++) {
      if (!available[wanted[i]]) missing.push(wanted[i]);
    }
    var covered = missing.length === 0;

    var selectList = wanted.length ? wanted.join(', ') : 'count(*)';
    var isStar = this.cols.id && this.cols.city && this.cols.age && this.cols.signup;
    var sql = 'CREATE INDEX idx_city_age ON users (city, age)' +
      (this.include ? '\n  INCLUDE (signup_day)' : '') + ';\n\n' +
      'SELECT ' + (isStar ? '*' : selectList) + '\n  FROM users\n WHERE city = ' + this.city +
      '   -- ' + CITIES[this.city] + '\n   AND age BETWEEN ' + this.ageLo + ' AND ' + this.ageHi + ';';

    var pre = E('pre', 'db-sql');
    pre.textContent = sql;
    main.appendChild(pre);

    var onlyPlan = indexScanPlan(idx, lo, hi, heap, true);
    var fetchPlan = indexScanPlan(idx, lo, hi, heap, false);
    var plan = covered ? onlyPlan : fetchPlan;
    var width = covered ? Math.max(4, wanted.length * 4) : ROW_BYTES;

    var cards = E('div', 'db-cards');
    cards.appendChild(statCard(covered ? 'Index Only Scan' : 'Index Scan',
      num(plan.pages) + ' pages',
      covered
        ? 'The index leaves held every column asked for, so the table was never opened.'
        : 'The index found the rows; the table still had to be opened to get ' +
          missing.join(' and ') + '.',
      covered));
    cards.appendChild(statCard('Heap fetches', num(plan.heapPages),
      covered ? 'None. That is what "covering" means.'
              : num(matched) + ' rows, landing on ' + num(heap.distinct) + ' distinct pages.'));
    cards.appendChild(statCard('Cost of not covering',
      covered ? '—' : times(fetchPlan.pages, onlyPlan.pages),
      covered
        ? 'Uncheck a column the index does not hold to see it.'
        : 'The same query would read ' + num(onlyPlan.pages) + ' pages if the index ' +
          'covered it, instead of ' + num(fetchPlan.pages) + '.'));
    main.appendChild(cards);

    var bars = E('div', 'db-bars');
    var maxp = Math.max(fetchPlan.pages, onlyPlan.pages, 1);
    bars.appendChild(barRow('Index only', onlyPlan.pages, maxp, 'win'));
    bars.appendChild(barRow('Index + heap', fetchPlan.pages, maxp, covered ? '' : 'lose'));
    main.appendChild(bars);

    var note = E('div', 'db-note' + (covered ? '' : ' db-warnnote'));
    if (covered && !wanted.length) {
      note.textContent = 'COUNT(*) over an indexed predicate needs no column values at all, ' +
        'so the index alone answers it. This is the cheapest shape there is, and it is ' +
        'why a count filtered on an indexed column is fast while an unfiltered count on a ' +
        'big table is not.';
    } else if (covered) {
      note.textContent = 'Every column in the SELECT list is in the index, so the leaves ' +
        'answer the query on their own and the table is never opened. ' + num(plan.pages) +
        ' pages instead of ' + num(fetchPlan.pages) + '. Notice that nothing about the ' +
        'WHERE clause changed — covering is about what you ask for, not what you filter on.';
    } else if (isStar) {
      note.textContent = 'This is how SELECT * defeats a covering index. The WHERE clause is ' +
        'identical, the index is identical, and the plan is worse by ' +
        times(fetchPlan.pages, onlyPlan.pages) + ' — because id and signup_day are not in ' +
        'the index, so every one of the ' + num(matched) + ' matching rows has to be fetched ' +
        'from the heap. Naming the columns you actually need is not a style preference here; ' +
        'it is the difference between reading ' + num(onlyPlan.pages) + ' pages and ' +
        num(fetchPlan.pages) + '.';
    } else {
      note.textContent = missing.join(' and ') + (missing.length === 1 ? ' is' : ' are') +
        ' not in the index, so the index-only scan is off and every matching row gets ' +
        'fetched from the table: ' + num(fetchPlan.pages) + ' pages instead of ' +
        num(onlyPlan.pages) + '. Adding INCLUDE (signup_day) fixes exactly one of these ' +
        'cases; id can only be fixed by putting it in the index too.';
    }
    main.appendChild(note);

    main.appendChild(E('p', 'db-h', 'What the planner would print'));
    main.appendChild(explainBlock('-- as written', plan, {
      cond: '(city = ' + this.city + ' AND age >= ' + this.ageLo + ' AND age <= ' + this.ageHi + ')',
      indexName: idx.name,
      width: width
    }));

    main.appendChild(E('p', 'db-h', 'What it costs to make an index cover more'));
    var rows = [];
    [
      { label: '(city, age)', bytes: 4, inc: 0 },
      { label: '(city, age) INCLUDE (signup_day)', bytes: 4, inc: 4 },
      { label: '(city, age, signup_day)', bytes: 8, inc: 0 },
      { label: '(city, age) INCLUDE (signup_day, id)', bytes: 4, inc: 8 }
    ].forEach(function (shape) {
      var per = entriesPerPage(shape.bytes + shape.inc);
      var leaves = Math.ceil(N_ROWS / per);
      rows.push([
        shape.label,
        num(per),
        num(leaves),
        (Math.round(leaves * PAGE_BYTES / 1024 / 102.4) / 10) + ' MB'
      ]);
    });
    main.appendChild(table(
      ['Index', 'Entries per leaf page', 'Leaf pages', 'Leaf size'], rows));
    main.appendChild(E('p', 'db-sub',
      'A covering index is a copy of the columns it covers. Every column you add ' +
      'makes the entries larger, so fewer fit on a page, so the index is bigger, so ' +
      'more of it has to be read and every write has more to update. Covering is a ' +
      'trade, not a free win. The two middle rows are the same size on purpose: ' +
      'INCLUDE and a third key column cost the same bytes, and differ in what you ' +
      'can then search and sort on. A key column can be descended into; an INCLUDE ' +
      'column can only be handed back.'));

    var caveat = E('div', 'db-note db-warnnote');
    caveat.textContent = 'One thing this model leaves out, because it matters in ' +
      'production: PostgreSQL cannot trust an index entry on its own — it has to know ' +
      'the row is visible to your transaction. It checks the visibility map, and where ' +
      'that says a page is not all-visible it fetches the heap row anyway. So a table ' +
      'that has just been written to heavily will show heap fetches on a query that ' +
      'EXPLAIN calls an Index Only Scan, until autovacuum catches up. The plan name is ' +
      'not a promise.';
    main.appendChild(caveat);
  };

  /* ======================================================================== */
  /*  PANEL 5 — SELECTIVITY, AND WHERE THE PLANNER SWITCHES BACK              */
  /* ======================================================================== */

  function SelectivityPanel(app) {
    this.app = app;
    this.label = 'When a scan wins';
    this.marker = 500;      // rows matched at the marker
  }

  SelectivityPanel.prototype.buildControls = function (side, redraw) {
    var self = this;
    var app = this.app;

    var g = group('Where you are on the curve');
    g.appendChild(slider('Rows matched', 0, 100, 1, this.markerPos(),
      function (v) { return num(self.rowsAt(v)); },
      function (v) { self.marker = self.rowsAt(v); redraw(); }));
    g.appendChild(E('p', 'db-hint',
      'Logarithmic, from one row to the whole table, because the interesting ' +
      'part is all below one percent.'));
    side.appendChild(g);

    var gp = group('Planner');
    /* Capped at 6.0 on purpose. PostgreSQL's bitmap page-cost curve,
       p × (random − (random − seq) × √(p/T)), turns downwards once p/T passes
       (random / 1.5(random − seq))², so above about 7 the bitmap plan gets
       CHEAPER as it reads more of the table and the chart starts flip-flopping.
       That is a genuine quirk of the real formula and not one this page is
       here to teach, so the slider stops short of it. */
    gp.appendChild(slider('random_page_cost', 1, 6, 0.1, COST.randPage,
      function (v) { return v.toFixed(1); },
      function (v) { COST.randPage = v; redraw(); }));
    gp.appendChild(E('p', 'db-hint',
      'Drop it towards 1.0 — an SSD, or a table already in cache — and the ' +
      'crossover moves right: the index stays worth using for a larger slice ' +
      'of the table.'));
    side.appendChild(gp);

    var gt = group('The table');
    gt.appendChild(field('Physical order', selectBox([
      { key: 'insert', label: 'Insertion order (uncorrelated)' },
      { key: 'clustered', label: 'Clustered by signup' }
    ], app.physical, function (v) { app.setPhysical(v); redraw(); })));
    gt.appendChild(E('p', 'db-hint',
      'Clustering is the single biggest lever on this chart. It does not make the ' +
      'index better; it makes the rows the index points at sit together.'));
    side.appendChild(gt);
  };

  SelectivityPanel.prototype.markerPos = function () {
    var t = Math.log(Math.max(1, this.marker)) / Math.log(N_ROWS);
    return Math.round(t * 100);
  };
  SelectivityPanel.prototype.rowsAt = function (pos) {
    var t = Math.max(0, Math.min(100, pos)) / 100;
    return Math.max(1, Math.round(Math.pow(N_ROWS, t)));
  };

  SelectivityPanel.prototype.render = function (main) {
    var app = this.app;
    var curve = app.curve();     // [{rows, indexPages, heapReads, distinct}]
    var i;

    /* Costed through the same three functions the other panels use, rather than
       through a copy of the formulas here. The expensive half — the measured
       page counts — is what the cache holds; the arithmetic is redone every
       time a slider moves, which is what makes the chart respond to
       random_page_cost without re-walking 100,000 rows. */
    var idx = app.idxSignup;
    var points = [];
    for (i = 0; i < curve.length; i++) {
      var c = curve[i];
      points.push({
        rows: c.rows,
        seq: seqScanPlan(c.rows).cost,
        index: indexScanPlan(idx, 0, c.rows, c.heap, false).cost,
        bitmap: bitmapScanPlan(idx, 0, c.rows, c.heap).cost
      });
    }

    var cvs = E('canvas', 'db-canvas');
    cvs.setAttribute('role', 'img');
    main.appendChild(cvs);

    /* The two switch points, found by walking the measured curve rather than
       solving for them. `switchRows` is the start of the final run where the
       sequential scan is cheapest; `indexGivesUp` is the first sample where a
       plain index scan stops being the cheapest plan and never recovers. */
    var switchRows = null, indexGivesUp = null;
    for (i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.seq <= Math.min(p.index, p.bitmap)) {
        if (switchRows === null) switchRows = p.rows;
      } else {
        switchRows = null;
      }
      if (p.index <= Math.min(p.seq, p.bitmap)) indexGivesUp = null;
      else if (indexGivesUp === null) indexGivesUp = p.rows;
    }
    // On a clustered table the index scan holds the lead right up to the point
    // where the sequential scan takes everything. Reporting the same figure in
    // two cards as if they were two findings is just noise.
    if (indexGivesUp !== null && indexGivesUp === switchRows) indexGivesUp = null;

    this.paint(cvs, points, switchRows);

    var at = this.nearest(points, this.marker);
    var chosenName = at.seq <= Math.min(at.index, at.bitmap) ? 'Seq Scan'
                   : (at.index <= at.bitmap ? 'Index Scan' : 'Bitmap Heap Scan');
    cvs.setAttribute('aria-label',
      'Planner cost against the number of rows matched, on log axes. At ' +
      num(at.rows) + ' rows the sequential scan costs ' + money(at.seq) +
      ', the index scan ' + money(at.index) + ' and the bitmap heap scan ' +
      money(at.bitmap) + ', so the plan chosen is ' + chosenName + '. ' +
      (switchRows !== null
        ? 'The sequential scan takes over at about ' + num(switchRows) + ' rows, ' +
          pct(switchRows / N_ROWS) + ' of the table.'
        : 'The sequential scan never wins on this configuration.'));

    var clustered = app.physical === 'clustered';
    var cards = E('div', 'db-cards');
    cards.appendChild(statCard('At ' + num(at.rows) + ' rows', chosenName,
      pct(at.rows / N_ROWS) + ' of the table matched.', true));
    cards.appendChild(statCard('Plain index scan gives up at',
      indexGivesUp !== null ? pct(indexGivesUp / N_ROWS) : 'it does not',
      indexGivesUp !== null
        ? 'About ' + num(indexGivesUp) + ' rows. The index is not abandoned there — ' +
          'the bitmap plan below still uses it. Only the way the heap is read changes.'
        : 'On a table clustered by this key, walking the index in order is also ' +
          'walking the table in order, so nothing beats it.'));
    cards.appendChild(statCard('Sequential scan takes over at',
      switchRows !== null ? pct(switchRows / N_ROWS) : 'never',
      switchRows !== null
        ? 'About ' + num(switchRows) + ' rows. Above that, reading all ' +
          num(HEAP_PAGES) + ' pages straight through wins outright.'
        : 'With these settings the index is worth using all the way to the whole table.'));
    main.appendChild(cards);

    var note = E('div', 'db-note');
    note.textContent = clustered
      ? 'Clustered on signup, and the shape of the argument changes completely. Walking ' +
        'the index in key order is now walking the table in page order, so the heap ' +
        'reads are sequential and the plain index scan stays cheapest almost all the way ' +
        'to the whole table. Nothing about the index changed. Only where the rows live ' +
        'changed. This is why CLUSTER exists, and also why it is a one-off: new rows go ' +
        'wherever there is space, so the correlation decays and the chart drifts back ' +
        'towards the uncorrelated shape.'
      : 'Three plans, one query shape, and the only thing changing is how many rows come ' +
        'back. The plain index scan dies early — at ' +
        (indexGivesUp !== null ? pct(indexGivesUp / N_ROWS) + ' of the table' : 'a few hundred rows') +
        ' — because consecutive keys live on unrelated pages, so it re-reads the same ' +
        'heap pages over and over. The bitmap heap scan survives much longer: it collects ' +
        'every row pointer first, sorts them into page order, and reads each page once. ' +
        'Only past ' + (switchRows !== null ? pct(switchRows / N_ROWS) : 'that') +
        ' does reading everything straight through win outright. The folklore that ' +
        '"an index stops being used above five percent" is really about the first of ' +
        'those three plans, not the second — and the usual reason a planner gets this ' +
        'wrong in production is a stale estimate of how many rows the predicate matches, ' +
        'not the cost model.';
    main.appendChild(note);

    main.appendChild(E('p', 'db-h', 'The same thing as numbers'));
    var rows = [];
    var picks = [1, 10, 100, 1000, 5000, 20000, 50000, 100000];
    picks.forEach(function (n) {
      var p = nearestOf(points, n);
      var best = p.seq <= Math.min(p.index, p.bitmap) ? 'Seq Scan'
               : (p.index <= p.bitmap ? 'Index Scan' : 'Bitmap Heap Scan');
      rows.push({
        cells: [num(p.rows), pct(p.rows / N_ROWS), money(p.seq), money(p.index),
                money(p.bitmap), best],
        cls: best === 'Seq Scan' ? 'db-row-bad' : 'db-row-best'
      });
    });
    main.appendChild(table(
      ['Rows matched', 'Of the table', 'Seq Scan', 'Index Scan', 'Bitmap', 'Chosen'],
      rows));
    main.appendChild(E('p', 'db-sub',
      'random_page_cost ' + COST.randPage.toFixed(1) + ', table ' +
      (app.physical === 'clustered' ? 'clustered on signup' : 'in insertion order') +
      '. The heap page counts behind these costs were measured on the real rows, ' +
      'not modelled from a correlation figure.'));
  };

  function nearestOf(points, n) {
    var best = points[0];
    for (var i = 0; i < points.length; i++) {
      if (Math.abs(points[i].rows - n) < Math.abs(best.rows - n)) best = points[i];
    }
    return best;
  }
  SelectivityPanel.prototype.nearest = function (points, n) { return nearestOf(points, n); };

  SelectivityPanel.prototype.paint = function (cvs, points, switchRows) {
    var dpr = window.devicePixelRatio || 1;
    var w = cvs.clientWidth || 640;
    var h = cvs.clientHeight || 320;
    cvs.width = Math.max(1, Math.round(w * dpr));
    cvs.height = Math.max(1, Math.round(h * dpr));
    var g = cvs.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var L = 56, R = 12, T = 14, B = 30;
    var pw = Math.max(10, w - L - R), ph = Math.max(10, h - T - B);

    var maxCost = 1, minCost = Infinity, i;
    for (i = 0; i < points.length; i++) {
      maxCost = Math.max(maxCost, points[i].seq, points[i].index, points[i].bitmap);
      minCost = Math.min(minCost, points[i].index, points[i].bitmap);
    }
    minCost = Math.max(0.5, minCost);

    function X(rows) {
      var t = Math.log(Math.max(1, rows)) / Math.log(N_ROWS);
      return L + t * pw;
    }
    function Y(cost) {
      var t = (Math.log(Math.max(minCost, cost)) - Math.log(minCost)) /
              (Math.log(maxCost) - Math.log(minCost));
      return T + ph - t * ph;
    }

    // Grid and axis labels.
    g.strokeStyle = 'rgba(148,163,184,.14)';
    g.fillStyle = C.faint;
    g.font = '10px ' + FONT;
    g.lineWidth = 1;
    var decades = [1, 10, 100, 1000, 10000, 100000];
    for (i = 0; i < decades.length; i++) {
      var x = X(decades[i]);
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
      g.textAlign = 'center';
      g.fillText(num(decades[i]), Math.min(w - 20, Math.max(20, x)), T + ph + 14);
    }
    var costDecade = 1;
    g.textAlign = 'right';
    while (costDecade <= maxCost) {
      if (costDecade >= minCost) {
        var y = Y(costDecade);
        g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke();
        g.fillText(num(costDecade), L - 6, y + 3);
      }
      costDecade *= 10;
    }
    g.textAlign = 'center';
    g.fillText('rows matched', L + pw / 2, T + ph + 26);
    g.save();
    g.translate(12, T + ph / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('planner cost', 0, 0);
    g.restore();

    function line(key, colour, dash) {
      g.strokeStyle = colour;
      g.lineWidth = 2;
      g.setLineDash(dash || []);
      g.beginPath();
      for (var k = 0; k < points.length; k++) {
        var px = X(points[k].rows), py = Y(points[k][key]);
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      g.setLineDash([]);
    }
    line('seq', C.red);
    line('bitmap', C.violet, [5, 4]);
    line('index', C.green);

    // The crossover, marked where it actually happens.
    if (switchRows !== null) {
      var sx = X(switchRows);
      g.strokeStyle = C.amber;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(sx, T); g.lineTo(sx, T + ph); g.stroke();
      g.setLineDash([]);
      g.fillStyle = C.amber;
      g.textAlign = sx > L + pw * 0.7 ? 'right' : 'left';
      g.fillText('scan wins from here', sx + (sx > L + pw * 0.7 ? -6 : 6), T + 12);
    }

    // Marker for wherever the slider is.
    var at = nearestOf(points, this.marker);
    var mx = X(at.rows);
    g.strokeStyle = C.cyan;
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(mx, T); g.lineTo(mx, T + ph); g.stroke();
    [['seq', C.red], ['bitmap', C.violet], ['index', C.green]].forEach(function (pair) {
      g.fillStyle = pair[1];
      g.beginPath();
      g.arc(mx, Y(at[pair[0]]), 3.5, 0, Math.PI * 2);
      g.fill();
    });

    // Legend, bottom right of the plot area.
    var legend = [['Seq Scan', C.red], ['Bitmap Heap Scan', C.violet], ['Index Scan', C.green]];
    g.textAlign = 'left';
    g.font = '10px ' + FONT;
    for (i = 0; i < legend.length; i++) {
      var ly = T + 12 + i * 14;
      g.fillStyle = legend[i][1];
      g.fillRect(L + 10, ly - 6, 10, 3);
      g.fillStyle = C.dim;
      g.fillText(legend[i][0], L + 26, ly);
    }
  };

  /* ======================================================================== */
  /*  THE SHELL                                                               */
  /* ======================================================================== */

  function App(rootEl) {
    this.root = rootEl;
    this.physical = 'insert';
    this._curve = null;

    var t = buildTable();
    this.table = t;

    // signup_day: 2,000 distinct values, a 4-byte integer key.
    this.idxSignup = buildIndex({
      name: 'idx_signup', cols: ['signup_day'], keys: t.signup,
      keyMax: SIGNUP_DAYS - 1, keyBytes: 4
    });

    // (city, age) packed into one integer so the counting sort sees the
    // composite key exactly as the index stores it: city first, age second.
    var comp = new Int32Array(N_ROWS);
    for (var i = 0; i < N_ROWS; i++) comp[i] = t.city[i] * 100 + t.age[i];
    this.idxCityAge = buildIndex({
      name: 'idx_city_age', cols: ['city', 'age'], keys: comp,
      keyMax: CITIES.length * 100, keyBytes: 4
    });
    this.idxCityAgeInc = buildIndex({
      name: 'idx_city_age', cols: ['city', 'age'], include: ['signup_day'],
      keys: comp, keyMax: CITIES.length * 100, keyBytes: 4, includeBytes: 4
    });

    this.panels = [
      new TreePanel(this),
      new QueryPanel(this),
      new CompositePanel(this),
      new CoveringPanel(this),
      new SelectivityPanel(this)
    ];
    this.active = 0;
    this.build();
    this.select(0);
  }

  /* Physical order is the one setting shared by four of the five panels, and
     it is also the only one that changes the measured page counts, so the
     cached cost curve has to go with it. Routed through here rather than
     assigned in each panel, because the version that assigned it directly left
     the selectivity chart drawing yesterday's numbers. */
  App.prototype.setPhysical = function (mode) {
    this.physical = mode;
    this._curve = null;
  };

  /* The cost curve for the selectivity plot. Sixty log-spaced sample sizes,
     each one measured against the real index and the real heap layout rather
     than modelled — the page counts are the expensive part, so they are cached
     and only the cheap cost arithmetic is redone when a slider moves. */
  App.prototype.curve = function () {
    if (this._curve) return this._curve;
    var idx = this.idxSignup;
    var pageOf = makePageOf(this, idx);
    var out = [];
    var samples = 60;
    for (var s = 0; s <= samples; s++) {
      var rows = Math.max(1, Math.round(Math.pow(N_ROWS, s / samples)));
      out.push({ rows: rows, heap: heapCost(idx.order, 0, rows, pageOf) });
    }
    this._curve = out;
    return out;
  };

  App.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'db-wrap');

    var tabs = E('div', 'db-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Index topics');
    this.tabs = this.panels.map(function (panel, i) {
      var b = E('button', 'db-tab', panel.label);
      b.type = 'button';
      b.id = 'db-tab-' + i;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-controls', 'db-panel-' + i);
      b.tabIndex = -1;
      b.addEventListener('click', function () { self.select(i); });
      /* Arrow keys move between tabs, which is what a tablist is supposed to
         do and what a screen-reader user will try. Only the selected tab is a
         tab stop, so Tab moves past the whole strip in one press rather than
         five. */
      b.addEventListener('keydown', function (e) {
        var d = 0;
        if (e.key === 'ArrowRight') d = 1;
        else if (e.key === 'ArrowLeft') d = -1;
        else if (e.key === 'Home') { e.preventDefault(); self.select(0); self.tabs[0].focus(); return; }
        else if (e.key === 'End') {
          e.preventDefault();
          var last = self.tabs.length - 1;
          self.select(last); self.tabs[last].focus(); return;
        }
        if (!d) return;
        e.preventDefault();
        var next = (i + d + self.tabs.length) % self.tabs.length;
        self.select(next);
        self.tabs[next].focus();
      });
      tabs.appendChild(b);
      return b;
    });
    wrap.appendChild(tabs);

    var body = E('div', 'db-body');
    this.side = E('div', 'db-side');
    this.main = E('div', 'db-main');
    this.main.id = 'db-panel-0';
    this.main.setAttribute('role', 'tabpanel');
    this.main.className = 'db-main db-panel';
    this.main.tabIndex = 0;
    body.appendChild(this.side);
    body.appendChild(this.main);
    wrap.appendChild(body);

    this.root.appendChild(wrap);

    /* The plot has to be repainted when the box it lives in changes size,
       and a canvas does not do that for itself. Debounced, because a drag on
       a window edge fires this continuously. */
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (self.panels[self.active] instanceof SelectivityPanel) self.redraw();
      }, 180);
    });
  };

  App.prototype.select = function (i) {
    this.active = i;
    for (var k = 0; k < this.tabs.length; k++) {
      var on = k === i;
      this.tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
      this.tabs[k].tabIndex = on ? 0 : -1;
    }
    this.main.id = 'db-panel-' + i;
    this.main.setAttribute('aria-labelledby', 'db-tab-' + i);
    this.rebuildControls();
    this.redraw();
  };

  App.prototype.rebuildControls = function () {
    var self = this;
    clear(this.side);
    var panel = this.panels[this.active];
    panel.buildControls(this.side, function () { self.redraw(); });
  };

  App.prototype.redraw = function () {
    var panel = this.panels[this.active];
    clear(this.main);
    panel.render(this.main);
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('dbindexviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-dbindex-mount') || rootEl;
    clear(mount);
    try {
      var app = new App(mount);
      if (app && window.KSLab && window.KSLab.used) window.KSLab.used('run');
    } catch (err) {
      clear(mount);
      var msg = E('p', 'lab-viz-error',
        'This lab could not start in your browser: ' + ((err && err.message) || String(err)) +
        ' — the write-up below still explains what it would have shown. ' +
        'Please tell me, and mention which browser you are using.');
      mount.appendChild(msg);
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'dbindexviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

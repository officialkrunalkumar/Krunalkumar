/* ==========================================================================
   cache-game.js — a set-associative cache you operate, then argue with.
   --------------------------------------------------------------------------
   Everyone meets caches as three numbers on a spec sheet and a vague sense
   that locality is good. The part that never lands is that a cache is an
   arithmetic decision made on the address itself: the low bits pick a byte
   inside a block, the middle bits pick which set the block is allowed to
   live in, and the rest is a tag stored beside the data so the line can say
   which block it is holding. Nothing about that is a heuristic. It is a
   wiring diagram, and once you have watched the same 16-bit address get cut
   into three pieces forty times in a row it stops being abstract. So the
   split is drawn for every single access, in binary, with each field named
   in words underneath rather than only coloured.

   THE SIMULATOR IS REAL. Cache size, block size and associativity are
   parameters; the number of sets, the index width and the tag width fall
   out of them. There is one code path, Sim below, and every number on the
   screen comes out of it — the level you are playing, the reference policy
   you are being measured against, the Belady bound, and the shadow cache
   that classifies the misses. Nothing is a lookup table of pre-computed
   answers, which matters because on the pattern levels you change the
   cache and the access order and the counts have to still be right.

   TWO PHASES, AND THEY ARE THE TWO HALVES OF THE SUBJECT.

     PHASE ONE — you are the cache. An access stream is issued one at a
     time. Where a set is full you pick the line to evict, and at the end
     your miss count is set beside the same stream run under LRU, FIFO, MRU
     or random, and beside BELADY OPTIMAL. Belady is computed properly:
     the whole stream is known here, so on every eviction each resident
     line's next use is looked up and the furthest one goes. It is not
     implementable in hardware and never will be, because it reads the
     future. It is in this game for exactly one reason: it is the floor, so
     "LRU took 15" means something once you also know the floor was 7.

     PHASE TWO — you write the access pattern. The cache is fixed and the
     loop is yours: row-major or column-major, padded or not, tiled or not.
     Same arithmetic, same result, wildly different miss counts.

   THE THREE Cs ARE COUNTED SEPARATELY, and the classification is the
   textbook one rather than a guess. A miss on a block address never seen
   before in this run is COMPULSORY. Otherwise a fully-associative LRU cache
   of the same capacity is run alongside on the same stream: if it would
   have missed too, the working set is simply too big and the miss is
   CAPACITY; if it would have hit, the block was thrown out only because of
   where the index bits sent it, and the miss is CONFLICT. That shadow has
   to be stepped on every access, hit or miss, or its own LRU order goes
   wrong and the split silently drifts. Worth saying out loud: the split
   depends on the reference model, and LRU is the conventional choice for
   it — swap the shadow's policy and some misses change category.

   WRITES. A store marks the line dirty under write-back and the memory
   write is deferred until that line is evicted; under write-through every
   store goes straight out. The toggle changes the memory-write counter and
   nothing else — hits and misses are identical either way, which is the
   honest result and the reason the counter is shown separately.

   WHAT THIS CANNOT DO, stated here and on the page rather than left to be
   discovered. There is ONE CORE, so false sharing — two cores writing
   different bytes of the same line and bouncing it between their caches on
   a coherence protocol — cannot be demonstrated here at all. It is
   explained in the page copy and explicitly not simulated. There is also no
   prefetcher, no second or third level, no TLB and no store buffer, and
   real hardware has every one of them. A machine that behaves like this
   simulator would be a machine from about 1990.

   ES5, no dependencies, no network, nothing stored but the best total. The
   board is DOM rather than canvas for the reason games.css already gives:
   this is text — binary fields, hex tags, counters — and canvas would cost
   selectable text, real focus rings and legibility at any zoom for nothing.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  /* Sixteen bits of address space. Not because any machine has that, but
     because a 32-bit address printed in binary is 32 characters wide and
     wraps on a phone, and the whole point of printing it is that the three
     fields can be seen at once. Every level's addresses fit inside it. */
  var ADDR_BITS = 16;

  var INK = 'var(--ink)';
  var INK3 = 'var(--ink-3)';
  var INK4 = 'var(--ink-4)';
  var MONO = "'Cascadia Code', Consolas, monospace";

  /* Field colours. Every one of them is restated in words directly beneath
     the field, because a reader who cannot separate violet from cyan still
     has to be able to tell the tag from the index. */
  var TAGC = '#c084fc';
  var IDXC = '#22d3ee';
  var OFFC = '#94a3b8';

  var COMPC = '#60a5fa';
  var CAPC = '#fbbf24';
  var CONFC = '#f87171';
  var OKC = '#4ade80';

  function log2(n) {
    var k = 0;
    while (n > 1) { n = n >> 1; k++; }
    return k;
  }

  function hex(v, digits) {
    var s = v.toString(16).toUpperCase();
    while (s.length < (digits || 1)) s = '0' + s;
    return '0x' + s;
  }

  function bin(v, bits) {
    var s = '';
    for (var i = bits - 1; i >= 0; i--) s += ((v >> i) & 1);
    return s;
  }

  function hexDigits(bits) {
    return Math.max(1, Math.ceil(bits / 4));
  }

  function pct(a, b) {
    if (!b) return '—';
    return Math.round((a / b) * 100) + '%';
  }

  /* ==================================================================
     The simulator.
     ==================================================================
     One object per run of one stream. It is stepped rather than run to
     completion so the same code can drive the interactive levels, where a
     human picks the victim, and the offline comparisons, where a policy or
     the Belady chooser does. Anything else and the number you are measured
     against would come from a different implementation than the one you
     played, which is the classic way a scoreboard ends up lying.
     ================================================================== */
  function Sim(cfg, stream, opts) {
    opts = opts || {};
    this.size = cfg.size;
    this.block = cfg.block;
    this.assoc = cfg.assoc;
    this.blocks = cfg.size / cfg.block;
    this.sets = this.blocks / cfg.assoc;
    this.offBits = log2(cfg.block);
    this.idxBits = log2(this.sets);
    this.tagBits = ADDR_BITS - this.offBits - this.idxBits;
    this.stream = stream;
    this.policy = opts.policy || 'lru';
    this.writeBack = opts.writeBack !== false;
    this.rng = opts.rng || Math.random;

    this.pos = 0;
    this.tick = 0;
    this.hits = 0;
    this.misses = 0;
    this.comp = 0;
    this.cap = 0;
    this.conf = 0;
    this.memWrites = 0;
    this.writebacks = 0;

    this.lines = [];
    for (var s = 0; s < this.sets; s++) {
      var row = [];
      for (var w = 0; w < this.assoc; w++) {
        row.push({ valid: false, tag: 0, dirty: false, used: 0, born: 0 });
      }
      this.lines.push(row);
    }

    /* Every block address ever referenced in this run. A miss on something
       not in here is compulsory and can never be anything else. */
    this.seen = {};
    /* The fully-associative LRU shadow that separates capacity from
       conflict. Same number of blocks, no index at all. */
    this.fa = [];
  }

  /* Divide is used rather than a shift because block sizes here are always
     powers of two but the arithmetic reads as the definition this way, and
     nothing in these streams is anywhere near the 32-bit boundary where the
     two would differ. */
  Sim.prototype.split = function (addr) {
    var blockAddr = Math.floor(addr / this.block);
    return {
      addr: addr,
      blockAddr: blockAddr,
      offset: addr - blockAddr * this.block,
      set: this.sets > 1 ? (blockAddr % this.sets) : 0,
      tag: Math.floor(blockAddr / this.sets)
    };
  };

  /* What the next access is and what the cache would do about it, WITHOUT
     changing anything. The interactive levels need to show the split and
     the candidate lines before the player has decided. */
  Sim.prototype.peek = function () {
    if (this.pos >= this.stream.length) return null;
    var acc = this.stream[this.pos];
    var p = this.split(acc.a);
    p.write = !!acc.w;
    p.index = this.pos;
    p.hitWay = -1;
    p.free = -1;
    var row = this.lines[p.set];
    for (var w = 0; w < row.length; w++) {
      if (row[w].valid && row[w].tag === p.tag) { p.hitWay = w; break; }
      if (!row[w].valid && p.free < 0) p.free = w;
    }
    p.needsChoice = p.hitWay < 0 && p.free < 0;
    return p;
  };

  /* The shadow, stepped for EVERY access. Stepping it only on misses was
     the first version and it was wrong in a way that produced plausible
     numbers: its LRU order then reflected misses only, so blocks kept alive
     by hits looked stale to it and conflict misses were being reported as
     capacity misses on exactly the levels built to show conflicts. */
  Sim.prototype.faStep = function (blockAddr) {
    var i;
    for (i = 0; i < this.fa.length; i++) {
      if (this.fa[i].b === blockAddr) { this.fa[i].used = this.tick; return true; }
    }
    if (this.fa.length < this.blocks) {
      this.fa.push({ b: blockAddr, used: this.tick });
      return false;
    }
    var worst = 0;
    for (i = 1; i < this.fa.length; i++) {
      if (this.fa[i].used < this.fa[worst].used) worst = i;
    }
    this.fa[worst] = { b: blockAddr, used: this.tick };
    return false;
  };

  /* Perform the access at the cursor. The victim argument names the way to
     throw out, and is ignored unless the set is genuinely full. Returns what happened, in
     enough detail for the board to draw it and for announce() to say it. */
  Sim.prototype.commit = function (victim) {
    var p = this.peek();
    if (!p) return null;
    this.tick++;
    var row = this.lines[p.set];
    var faHit = this.faStep(p.blockAddr);
    var res = { p: p, hit: false, kind: '', evicted: null, wroteBack: false, way: 0 };

    if (p.hitWay >= 0) {
      this.hits++;
      var line = row[p.hitWay];
      line.used = this.tick;
      if (p.write) {
        if (this.writeBack) line.dirty = true;
        else this.memWrites++;
      }
      res.hit = true;
      res.way = p.hitWay;
      this.seen[p.blockAddr] = 1;
      this.pos++;
      return res;
    }

    this.misses++;
    if (!this.seen[p.blockAddr]) { this.comp++; res.kind = 'compulsory'; }
    else if (!faHit) { this.cap++; res.kind = 'capacity'; }
    else { this.conf++; res.kind = 'conflict'; }
    this.seen[p.blockAddr] = 1;

    var way = p.free >= 0 ? p.free : victim;
    if (way == null || way < 0 || way >= row.length) way = 0;
    var old = row[way];
    if (old.valid) {
      res.evicted = { tag: old.tag, dirty: old.dirty };
      if (old.dirty) { this.writebacks++; this.memWrites++; res.wroteBack = true; }
    }
    row[way] = {
      valid: true,
      tag: p.tag,
      dirty: this.writeBack && p.write,
      used: this.tick,
      born: this.tick
    };
    if (p.write && !this.writeBack) this.memWrites++;
    res.way = way;
    this.pos++;
    return res;
  };

  /* ------------------------------------------------------------------
     Victim choosers.
     ------------------------------------------------------------------ */
  function policyVictim(sim, p, policy) {
    var row = sim.lines[p.set];
    var pick = 0;
    var i;
    if (policy === 'fifo') {
      for (i = 1; i < row.length; i++) if (row[i].born < row[pick].born) pick = i;
    } else if (policy === 'mru') {
      for (i = 1; i < row.length; i++) if (row[i].used > row[pick].used) pick = i;
    } else if (policy === 'random') {
      pick = Math.floor(sim.rng() * row.length) % row.length;
    } else {
      for (i = 1; i < row.length; i++) if (row[i].used < row[pick].used) pick = i;
    }
    return pick;
  }

  /* How far away the next use of a block is, from a given point in the
     stream. Linear, and deliberately so: the interactive streams are under
     thirty accesses, this is called a handful of times per eviction, and a
     clever index would be more code than the thing it replaces. */
  function nextUse(stream, from, blockAddr, block) {
    for (var i = from; i < stream.length; i++) {
      if (Math.floor(stream[i].a / block) === blockAddr) return i;
    }
    return Infinity;
  }

  /* BELADY. Evict the resident line whose next use is furthest away, which
     requires the entire future of the stream and is therefore not something
     any real cache can do. Ties — normally two lines that are never used
     again — are broken towards the CLEAN line, because a dirty one costs a
     memory write on the way out and there is no reason to pay it. That
     tie-break is a choice this file makes rather than part of Belady's
     result, and it is why level three's bound has fewer write-backs than
     LRU's. */
  function beladyVictim(sim, p) {
    var row = sim.lines[p.set];
    var best = 0;
    var bestN = -1;
    var bestClean = false;
    for (var w = 0; w < row.length; w++) {
      var b = row[w].tag * sim.sets + p.set;
      var n = nextUse(sim.stream, sim.pos + 1, b, sim.block);
      var clean = !row[w].dirty;
      if (n > bestN || (n === bestN && clean && !bestClean)) {
        best = w; bestN = n; bestClean = clean;
      }
    }
    return best;
  }

  /* Run a whole stream with an automatic chooser. Used for the reference
     policy, for Belady, and for every pattern level. */
  function runAuto(cfg, stream, opts, chooser) {
    var sim = new Sim(cfg, stream, opts);
    while (sim.pos < stream.length) {
      var p = sim.peek();
      sim.commit(p.needsChoice ? chooser(sim, p) : -1);
    }
    return sim;
  }

  /* ==================================================================
     Access streams.
     ==================================================================
     Written as generators rather than as literal lists wherever the point
     of the level is the loop that produced them — a hand-typed list of a
     thousand addresses is unreadable and, worse, unfixable.
     ================================================================== */

  /* A straight walk over a run of consecutive blocks, some number of times.
     Pass two onwards can be stores, which is what a[i] += 1 actually
     issues: a read of the block and then a write to it. */
  function walk(base, blocks, block, passes, writeFrom) {
    var out = [];
    for (var pass = 0; pass < passes; pass++) {
      for (var b = 0; b < blocks; b++) {
        var acc = { a: base + b * block };
        if (writeFrom != null && pass >= writeFrom) acc.w = 1;
        out.push(acc);
      }
    }
    return out;
  }

  /* A 2D array traversal. rowBytes is the distance from one row to the
     next and is NOT necessarily cols * elem — that gap is the padding trick
     level six turns on. */
  function grid(base, rows, cols, elem, rowBytes, order) {
    var out = [];
    var i, j;
    if (order === 'row') {
      for (i = 0; i < rows; i++) {
        for (j = 0; j < cols; j++) out.push({ a: base + i * rowBytes + j * elem });
      }
    } else {
      for (j = 0; j < cols; j++) {
        for (i = 0; i < rows; i++) out.push({ a: base + i * rowBytes + j * elem });
      }
    }
    return out;
  }

  /* C = A x B for square n. Only the LOADS of A and B are issued: the
     running sum for one element of C is assumed to sit in a register, which
     is what any compiler does with the inner loop and what keeps this
     stream about the two matrices being read rather than about a third one
     being written. A tile of 1 or less is the untiled nest. */
  function matmul(n, elem, tile, order) {
    var A = 0x4000;
    var B = A + n * n * elem;
    var rowBytes = n * elem;
    var out = [];
    var ii, jj, kk, i, j, k;

    function push(i2, j2, k2) {
      out.push({ a: A + i2 * rowBytes + k2 * elem });
      out.push({ a: B + k2 * rowBytes + j2 * elem });
    }

    if (tile <= 1) {
      if (order === 'ikj') {
        for (i = 0; i < n; i++) {
          for (k = 0; k < n; k++) {
            for (j = 0; j < n; j++) push(i, j, k);
          }
        }
      } else {
        for (i = 0; i < n; i++) {
          for (j = 0; j < n; j++) {
            for (k = 0; k < n; k++) push(i, j, k);
          }
        }
      }
      return out;
    }

    for (ii = 0; ii < n; ii += tile) {
      for (jj = 0; jj < n; jj += tile) {
        for (kk = 0; kk < n; kk += tile) {
          for (i = ii; i < ii + tile; i++) {
            for (j = jj; j < jj + tile; j++) {
              for (k = kk; k < kk + tile; k++) push(i, j, k);
            }
          }
        }
      }
    }
    return out;
  }

  /* ==================================================================
     The seven levels.
     ==================================================================
     Every miss count quoted in the prose below was produced by running
     these exact definitions through the simulator above, not estimated.
     ================================================================== */
  var LEVELS = [
    {
      slug: 'two-ways',
      name: 'Two ways, one choice',
      mode: 'evict',
      cfg: { size: 128, block: 16, assoc: 2 },
      brief: 'One hundred and twenty-eight bytes, sixteen-byte blocks, two ways. That is eight lines ' +
        'in four sets, so two index bits, four offset bits and ten bits of tag. The index decides ' +
        'which set an address is allowed to live in and nothing can override it: when a set is full, ' +
        'the only candidates are the two lines in that set.',
      stream: [
        { a: 0x1000 }, { a: 0x1024 }, { a: 0x1064 }, { a: 0x1028 },
        { a: 0x10A0 }, { a: 0x102C }, { a: 0x10A8 }, { a: 0x1044 },
        { a: 0x1060 }, { a: 0x10AC }, { a: 0x1068 }, { a: 0x1004 },
        { a: 0x1020 }, { a: 0x10A4 }, { a: 0x1068 }
      ],
      lesson: 'LRU takes nine misses here and the optimum is eight, so there is exactly one place ' +
        'where "least recently used" is the wrong answer. That gap is the whole reason Belady is ' +
        'printed beside your score: without a floor, nine misses is a number with nothing to mean.'
    },
    {
      slug: 'lru-worst',
      name: 'Where LRU has nothing left',
      mode: 'evict',
      cfg: { size: 64, block: 16, assoc: 4 },
      /* Five blocks through four lines, three times round. The classic
         construction: whatever LRU discards is the block wanted next. */
      stream: walk(0x2000, 5, 16, 3),
      brief: 'Sixty-four bytes, four ways, and therefore ONE set: fully associative. There are no ' +
        'index bits at all and the tag is the whole block address, which is why a fully associative ' +
        'cache needs a comparator per line. Five blocks are read round and round through four lines.',
      lesson: 'LRU misses on all fifteen accesses. Five blocks cycling through four lines is its ' +
        'worst case by construction: the block it discards is always the one wanted next. MRU &mdash; ' +
        'evict the MOST recently used &mdash; gets seven on this stream, which is the optimum. That is ' +
        'not a general result about MRU. It is what happens when the pattern is a cycle, and it is ' +
        'why real caches ship a policy that is hard to embarrass rather than one that wins here.'
    },
    {
      slug: 'dirty',
      name: 'Dirty lines cost more',
      mode: 'evict',
      cfg: { size: 128, block: 32, assoc: 2 },
      brief: 'W marks a store. Under write-back a written line is flagged dirty and the memory write ' +
        'is put off until that line is evicted; under write-through every store goes out immediately. ' +
        'Neither changes a single hit or miss. Watch the memory-write counter while you choose, and ' +
        'when two lines are equally useless, drop the clean one.',
      stream: [
        { a: 0x3000 }, { a: 0x3040, w: 1 }, { a: 0x3080 }, { a: 0x3004 },
        { a: 0x3044, w: 1 }, { a: 0x30C0 }, { a: 0x3084 }, { a: 0x3020 },
        { a: 0x3100, w: 1 }, { a: 0x3088 }, { a: 0x30C4 }, { a: 0x3104 },
        { a: 0x3048 }, { a: 0x3024 }
      ],
      lesson: 'Same hits, same misses, different memory traffic. Write-back turns a burst of stores ' +
        'to one line into a single write when the line finally leaves; write-through sends one per ' +
        'store and needs no dirty bit at all. The dirty bit is the entire cost of the cheaper option, ' +
        'and it is one bit per line.'
    },
    {
      slug: 'loop',
      name: 'Ten blocks, eight lines',
      mode: 'evict',
      cfg: { size: 256, block: 32, assoc: 2 },
      stream: walk(0x3000, 10, 32, 2, 1),
      brief: 'Two passes over an array of ten consecutive blocks in a cache that holds eight. The ' +
        'second pass is a read-modify-write, so every access in it is a store as well. Nothing here ' +
        'conflicts: the blocks are contiguous, so they spread evenly over the four sets. It simply ' +
        'does not fit.',
      lesson: 'Sixteen misses under LRU, twelve at the optimum, and every avoidable one is counted ' +
        'as CAPACITY rather than conflict, because a fully associative cache of the same size would ' +
        'have missed as well. Take two blocks off this array and the loop has no misses at all after ' +
        'the first pass. That cliff is why tuning for cache size is a real thing people do.'
    },
    {
      slug: 'traversal',
      name: 'Row-major or column-major',
      mode: 'pattern',
      cfg: { size: 256, block: 32, assoc: 2 },
      target: 40,
      brief: 'A sixteen by sixteen array of four-byte elements, read once, every element exactly ' +
        'once. Eight elements share a thirty-two byte block. The arithmetic is identical whichever ' +
        'way you go round; the cache is not.',
      options: [
        {
          id: 'row', label: 'Row-major: for i, for j, A[i][j]',
          note: 'along each row in turn',
          build: function () { return grid(0x1000, 16, 16, 4, 64, 'row'); }
        },
        {
          id: 'col', label: 'Column-major: for j, for i, A[i][j]',
          note: 'down each column in turn',
          build: function () { return grid(0x1000, 16, 16, 4, 64, 'col'); }
        }
      ],
      lesson: 'Thirty-two misses against two hundred and fifty-six under LRU &mdash; a miss on every ' +
        'single one of the two hundred and fifty-six reads, for exactly the same work. Other ' +
        'policies shave a few off the column-major figure and none of them come close to fixing it. ' +
        'Row-major walks along inside a block and gets eight uses out of every one ' +
        'it fetches; column-major steps sixty-four bytes at a time, touches a different block every ' +
        'access, and by the time it comes back for the second element of a block that block is long ' +
        'gone. This is the single most expensive one-line mistake in numerical code.'
    },
    {
      slug: 'stride',
      name: 'One stride, one set',
      mode: 'pattern',
      cfg: { size: 256, block: 32, assoc: 1 },
      target: 8,
      brief: 'A direct-mapped cache &mdash; one way, eight sets &mdash; and an array of eight rows, each row ' +
        'sixty-four four-byte elements, so two hundred and fifty-six bytes from one row to the next. ' +
        'That row stride is exactly the size of the cache. The loop walks down the first eight ' +
        'columns. This is a real bug that real code ships.',
      options: [
        {
          id: 'plain', label: 'Leave it: 256-byte rows, direct-mapped',
          note: 'the bug as written',
          build: function () { return grid(0x8000, 8, 8, 4, 256, 'col'); }
        },
        {
          id: 'pad', label: 'Pad each row by one block, to 288 bytes',
          note: 'same loop, wider rows',
          build: function () { return grid(0x8000, 8, 8, 4, 288, 'col'); }
        },
        {
          id: 'assoc', label: 'Leave the array, make the cache 8-way',
          note: 'same 256 bytes of cache, one set',
          assoc: 8,
          build: function () { return grid(0x8000, 8, 8, 4, 256, 'col'); }
        },
        {
          id: 'both', label: 'Pad the rows AND go 8-way',
          note: 'both fixes at once',
          assoc: 8,
          build: function () { return grid(0x8000, 8, 8, 4, 288, 'col'); }
        }
      ],
      lesson: 'Sixty-four misses out of sixty-four accesses, and fifty-six of them CONFLICT misses: ' +
        'the working set is eight blocks and the cache holds eight blocks, so nothing was ever too ' +
        'big. Every row started at a multiple of the cache size, so every row landed in set zero, ' +
        'and a direct-mapped set has one line. Thirty-two bytes of padding per row moves each row on ' +
        'by one set and the misses fall to eight. Eight-way associativity fixes it a completely ' +
        'different way &mdash; the eight blocks now share one set that has eight lines &mdash; and lands on ' +
        'exactly the same eight. Both fixes at once is no better than either, which is worth ' +
        'noticing before you pay for associativity you do not need.'
    },
    {
      slug: 'blocking',
      name: 'Block the multiply',
      mode: 'pattern',
      cfg: { size: 512, block: 32, assoc: 2 },
      /* Ninety rather than the eighty a run under LRU would suggest. The
         replacement policy is a control on this page, and under MRU the
         tiled version is WORSE than the plain interchange — MRU throws out
         the block just loaded, which is exactly the block a tile is about to
         reuse. At eighty this level was unwinnable with MRU selected, which
         is a far worse fault than a target being slightly generous. */
      target: 90,
      brief: 'An eight by eight matrix multiply in eight-byte doubles, sixteen lines of cache, and ' +
        'only the loads of A and B counted &mdash; the running sum for one element of C lives in a ' +
        'register. A and B together are thirty-two blocks and the cache holds sixteen, so the order ' +
        'you touch them in decides everything.',
      options: [
        {
          id: 'ijk', label: 'i, j, k: the textbook nest',
          note: 'B walked down a column',
          build: function () { return matmul(8, 8, 1, 'ijk'); }
        },
        {
          id: 'ikj', label: 'i, k, j: interchange the two inner loops',
          note: 'B walked along a row',
          build: function () { return matmul(8, 8, 1, 'ikj'); }
        },
        {
          id: 't4', label: 'Tile it: 4 by 4 blocks',
          note: 'a corner of each matrix at a time',
          build: function () { return matmul(8, 8, 4, 'ijk'); }
        },
        {
          id: 't2', label: 'Tile it: 2 by 2 blocks',
          note: 'smaller tiles, more passes',
          build: function () { return matmul(8, 8, 2, 'ijk'); }
        }
      ],
      lesson: 'With LRU selected: one hundred and ninety-seven misses for the textbook nest, and one ' +
        'hundred and ten of them are conflicts. Interchanging the inner two loops so B is read along ' +
        'a row rather than down a column takes it to seventy-three. Tiling into four by four blocks ' +
        '&mdash; doing a corner of the answer at a time, so the piece of each matrix you need stays ' +
        'resident while you need it &mdash; takes it to sixty-two. Two by two tiles are WORSE than no ' +
        'tiling done well, at a hundred and twenty-seven, because the tile is smaller than a block ' +
        'and the passes multiply. Same arithmetic, same answer, a third of the memory traffic. Switch ' +
        'the policy to MRU and the tiling collapses to a hundred and twenty-four while the plain ' +
        'interchange holds at eighty-four, because MRU discards the block just loaded and that is ' +
        'precisely the block a tile is about to read again.'
    }
  ];

  var POLICY_NAME = { lru: 'LRU', fifo: 'FIFO', mru: 'MRU', random: 'Random' };

  GameShell.define({
    id: 'game-cache-game',
    slug: 'cache-game',
    /* Named rather than left to default, so this file and the manifest can
       be read against each other without holding the shell's defaults in
       your head. bestOrder is 'high' because the score is points earned
       across the seven levels, not a miss count. */
    bestKey: 'cache-game',
    bestOrder: 'high',
    /* A DOM board, so the shell's tap-the-stage handler never binds at all.
       Set false anyway: the manifest says a tap on the board does nothing
       except on the buttons, and a claim on the page should be true in the
       code rather than true by accident. */
    tapAction: false,
    tapKey: 'action',
    /* No clock anywhere in this game. Pausing it because a tab lost focus
       would cover a half-read explanation with a Paused panel and move the
       keyboard onto a Resume button, for no benefit at all. */
    pauseOnBlur: false,
    title: 'Cache game',
    startTitle: 'Cache game',
    startText: 'Seven levels. On the first four you are the cache and choose what to evict; on the ' +
      'last three the cache is fixed and the access pattern is yours. Step with Space, move between ' +
      'the lines with the arrows, and nothing is uploaded or stored but your best total.',

    setup: function (g) {
      var host = g.board;
      /* The manifest declares board: true, so the generated page hands the
         shell a .game-board and no canvas. Building one here if it is
         missing is belt and braces against a page regenerated as a canvas
         game by mistake, which would otherwise render precisely nothing. */
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
      host.style.maxWidth = '48rem';
      host.style.textAlign = 'left';
      /* .game-board turns selection off, which is right for a board you
         drag across and wrong for a board made of hex addresses somebody
         might want to copy into a calculator. Same opt-in .nib-out uses. */
      host.style.webkitUserSelect = 'text';
      host.style.userSelect = 'text';

      var levelSel = document.getElementById('game-level');
      var policySel = document.getElementById('game-policy');
      var writeBtn = document.getElementById('game-write');
      var stepBtn = document.getElementById('game-step');
      var bitsBtn = document.getElementById('game-bits');

      var startLevel = 0;
      var policy = 'lru';
      var writeBack = true;
      var showBits = true;

      /* Per-run state, all of it rebuilt by reset(). */
      var at = 0;              // index into LEVELS
      var total = 0;           // points banked so far this run
      var sim = null;          // the player's own simulation of this level
      var refs = null;         // { policy: Sim, belady: Sim } for this level
      var last = null;         // the result of the most recent access
      var pending = null;      // the access waiting on an eviction choice
      var cursor = 0;          // which candidate line, or which option
      var phase = 'play';      // play | choose | done | finished
      var tries = 0;           // attempts on a pattern level
      var lastRun = null;      // the Sim from the last pattern attempt
      var lastOpt = -1;
      var earned = 0;
      var cells = [];          // the focusable buttons currently on the board
      /* Raised for the ONE render that follows a phase becoming interactive,
         so the keyboard lands on the first thing there is to press. Not on
         every render: rewriting the board after each access already drops
         focus to <body>, where the shell's own fallback picks the keys up,
         and pulling it back onto a button every time would fight a player
         who had deliberately tabbed somewhere else. */
      var wantFocus = false;

      /* -------------------------------------------------------------
         Preferences. Read once here rather than per render: a setting
         that could change under a level in progress would make the
         reference numbers disagree with the run they are measuring.
         ------------------------------------------------------------- */
      startLevel = Number(g.load('level', 0)) || 0;
      if (startLevel < 0 || startLevel >= LEVELS.length) startLevel = 0;
      policy = String(g.load('policy', 'lru'));
      if (!POLICY_NAME[policy]) policy = 'lru';
      writeBack = g.load('wb', '1') !== '0';
      showBits = g.load('bits', '1') !== '0';

      if (levelSel) {
        levelSel.value = String(startLevel);
        levelSel.addEventListener('change', function () {
          startLevel = Number(levelSel.value) || 0;
          g.save('level', startLevel);
          /* Jumping restarts the run at that level. There is no exploit in
             it: starting at level six can earn at most two hundred points
             and starting at level one can earn seven hundred, so the only
             thing a jump buys is practice. */
          g.start();
        });
      }

      if (policySel) {
        policySel.value = policy;
        policySel.addEventListener('change', function () {
          policy = policySel.value;
          if (!POLICY_NAME[policy]) policy = 'lru';
          g.save('policy', policy);
          /* Only the current level restarts. Changing the policy mid-level
             would leave your misses being compared against a reference run
             that never happened; changing it mid-RUN is fine, because every
             level is scored against its own reference. */
          if (g.state === 'playing') beginLevel(at);
        });
      }

      function syncWrite() {
        if (!writeBtn) return;
        writeBtn.textContent = writeBack ? 'Write-back' : 'Write-through';
        writeBtn.setAttribute('aria-pressed', String(writeBack));
        writeBtn.title = writeBack
          ? 'Write-back: a store marks the line dirty and memory is written when the line is evicted'
          : 'Write-through: every store goes to memory immediately and no line is ever dirty';
      }

      if (writeBtn) {
        syncWrite();
        writeBtn.addEventListener('click', function () {
          writeBack = !writeBack;
          g.save('wb', writeBack ? '1' : '0');
          syncWrite();
          if (g.state === 'playing') beginLevel(at);
          g.announce(writeBack ? 'Write-back' : 'Write-through');
        });
      }

      function syncBits() {
        if (!bitsBtn) return;
        bitsBtn.setAttribute('aria-pressed', String(showBits));
        bitsBtn.title = showBits
          ? 'The address is shown split into binary fields — click to show hex only'
          : 'Only hex is shown — click to see the address split into binary fields';
      }

      if (bitsBtn) {
        syncBits();
        bitsBtn.addEventListener('click', function () {
          showBits = !showBits;
          g.save('bits', showBits ? '1' : '0');
          syncBits();
          render();
        });
      }

      if (stepBtn) {
        stepBtn.addEventListener('click', function () { advance(); });
      }

      /* =============================================================
         Level setup
         ============================================================= */
      function levelCfg(L, opt) {
        return {
          size: L.cfg.size,
          block: L.cfg.block,
          assoc: (opt && opt.assoc) || L.cfg.assoc
        };
      }

      function beginLevel(i) {
        at = i;
        var L = LEVELS[at];
        last = null;
        pending = null;
        cursor = 0;
        tries = 0;
        lastRun = null;
        lastOpt = -1;
        earned = 0;

        if (L.mode === 'evict') {
          phase = 'play';
          sim = new Sim(L.cfg, L.stream, { policy: policy, writeBack: writeBack, rng: g.rng });
          refs = {
            policy: runAuto(L.cfg, L.stream, { policy: policy, writeBack: writeBack, rng: g.seed(97) },
              function (s, p) { return policyVictim(s, p, policy); }),
            belady: runAuto(L.cfg, L.stream, { policy: 'lru', writeBack: writeBack },
              beladyVictim)
          };
          /* g.seed above replaced the run's RNG with a seeded one so that
             the Random policy comparison is reproducible. Put the ordinary
             source back for anything else that wants it. */
          g.rng = Math.random;
        } else {
          phase = 'pick';
          sim = null;
          refs = null;
          wantFocus = true;
        }
        g.stat('level', (at + 1) + '/' + LEVELS.length);
        /* Before the render, not after: without it the hit rate and miss
           count from the level just finished sat in the HUD next to a fresh
           empty cache, which reads as a claim about the level you are
           looking at rather than the one you left. */
        updateHud();
        render();
        g.announce('Level ' + (at + 1) + ' of ' + LEVELS.length + '. ' + L.name + '.');
      }

      /* =============================================================
         Stepping an evict level
         ============================================================= */
      function stepOnce() {
        var p = sim.peek();
        if (!p) { finishEvict(); return; }
        if (p.needsChoice) {
          pending = p;
          phase = 'choose';
          cursor = 0;
          wantFocus = true;
          render();
          g.beep(300, 0.05, 'square', 0.04);
          g.announce('Miss. Set ' + p.set + ' is full. Choose one of ' + sim.assoc +
            ' lines to evict.');
          return;
        }
        last = sim.commit(-1);
        sound(last);
        sayResult(last);
        if (sim.pos >= sim.stream.length) { finishEvict(); return; }
        render();
      }

      function evictAt(way) {
        if (phase !== 'choose' || !pending) return;
        last = sim.commit(way);
        pending = null;
        phase = 'play';
        sound(last);
        sayResult(last);
        if (sim.pos >= sim.stream.length) { finishEvict(); return; }
        render();
      }

      function sound(res) {
        if (!res) return;
        if (res.hit) { g.pluck(880, 0.11, 0.045, 'triangle'); return; }
        g.beep(res.kind === 'compulsory' ? 300 : 220, 0.08, 'square', 0.045);
        if (res.wroteBack) g.noise(0.12, { type: 'bandpass', freq: 500, to: 220, q: 1.2, level: 0.05 });
      }

      function sayResult(res) {
        if (!res) return;
        var p = res.p;
        var txt = 'Access ' + (p.index + 1) + ', ' + hex(p.addr, 4) + (p.write ? ', store' : ', load') +
          '. Tag ' + hex(p.tag, hexDigits(sim.tagBits)) +
          (sim.sets > 1 ? ', set ' + p.set : ', no index') + ', offset ' + p.offset + '. ';
        if (res.hit) txt += 'Hit in way ' + res.way + '.';
        else {
          txt += 'Miss, ' + res.kind + '. Filled way ' + res.way;
          if (res.evicted) {
            txt += ', evicting tag ' + hex(res.evicted.tag, hexDigits(sim.tagBits));
            txt += res.wroteBack ? ', written back because it was dirty.' : ', clean.';
          } else txt += '.';
        }
        g.announce(txt);
        updateHud();
      }

      function updateHud() {
        var s = sim || lastRun;
        if (!s) { g.stat('rate', '—'); g.stat('misses', '0'); return; }
        var done = s.hits + s.misses;
        g.stat('rate', done ? pct(s.hits, done) : '—');
        g.stat('misses', String(s.misses));
      }

      /* Points for an evict level. The optimum is the floor, so the only
         question is how far above it you finished. Twenty is the floor on
         the score for the same reason the overlay never prints a best of
         zero: a level you played through badly is still a level you
         played. */
      function evictScore(mine, best) {
        var over = Math.max(0, mine - best);
        return Math.max(20, 100 - 15 * over);
      }

      function finishEvict() {
        phase = 'done';
        earned = evictScore(sim.misses, refs.belady.misses);
        total += earned;
        g.setScore(total);
        updateHud();
        render();
        g.pluck(660, 0.2, 0.05, 'triangle');
        g.announce('Level ' + (at + 1) + ' complete. ' + sim.misses + ' misses against ' +
          POLICY_NAME[policy] + "'s " + refs.policy.misses + ' and the optimum of ' +
          refs.belady.misses + '. ' + earned + ' points.');
      }

      /* =============================================================
         Running a pattern level
         ============================================================= */
      function runOption(idx) {
        var L = LEVELS[at];
        var opt = L.options[idx];
        if (!opt) return;
        var cfg = levelCfg(L, opt);
        var stream = opt.build();
        tries++;
        lastOpt = idx;
        lastRun = runAuto(cfg, stream, { policy: policy, writeBack: writeBack, rng: g.seed(97) },
          function (s, p) { return policyVictim(s, p, policy); });
        g.rng = Math.random;
        lastRun.cfgUsed = cfg;
        updateHud();

        var passed = lastRun.misses <= L.target;
        if (passed) {
          phase = 'done';
          earned = Math.max(30, 100 - 20 * (tries - 1));
          total += earned;
          g.setScore(total);
          g.pluck(660, 0.2, 0.05, 'triangle');
        } else {
          g.beep(200, 0.12, 'square', 0.05);
        }
        render();
        g.announce(opt.label + '. ' + lastRun.misses + ' misses out of ' + stream.length +
          ' accesses. ' + (passed
            ? 'Under the target of ' + L.target + '. ' + earned + ' points.'
            : 'The target is ' + L.target + ' or fewer. Try another.'));
      }

      /* =============================================================
         Moving on
         ============================================================= */
      function nextLevel() {
        if (at + 1 >= LEVELS.length) { finishRun(); return; }
        beginLevel(at + 1);
      }

      function finishRun() {
        phase = 'finished';
        render();
        g.over({
          won: true,
          score: total,
          title: 'Every level cleared',
          message: total + ' points out of a possible ' + (LEVELS.length * 100) +
            '. The optimum was computed for each level by reading the whole stream, ' +
            'which is the one thing no cache can do.'
        });
      }

      function advance() {
        if (g.state !== 'playing') return;
        if (phase === 'done') { nextLevel(); return; }
        if (phase === 'choose') { evictAt(cursor); return; }
        if (phase === 'pick') { runOption(cursor); return; }
        if (phase === 'play') { stepOnce(); return; }
      }

      /* =============================================================
         Rendering
         =============================================================
         The whole board is rewritten on every change. It is a few hundred
         bytes of markup and at most a couple of dozen nodes, this is not a
         per-frame path, and the alternative — diffing cache lines by hand —
         is where a display quietly stops matching the model it is drawing.
         ============================================================= */
      function seg(label, bits, value, colour, note) {
        if (bits <= 0) {
          return '<div style="text-align:center;min-width:4rem;">' +
            '<div style="font-family:' + MONO + ';font-size:0.95rem;color:' + INK4 + ';' +
            'border-bottom:2px dashed ' + INK4 + ';padding-bottom:0.15rem;">none</div>' +
            '<div style="font-size:0.66rem;letter-spacing:0.06em;text-transform:uppercase;' +
            'color:' + INK4 + ';margin-top:0.3rem;">' + label + ', 0 bits</div>' +
            '<div style="font-size:0.74rem;color:' + INK3 + ';">' + (note || '&mdash;') + '</div></div>';
        }
        var body = showBits ? bin(value, bits) : hex(value, hexDigits(bits));
        var read = note || hex(value, hexDigits(bits));
        return '<div style="text-align:center;">' +
          '<div style="font-family:' + MONO + ';font-size:0.95rem;letter-spacing:0.1em;' +
          'color:' + colour + ';border-bottom:2px solid ' + colour + ';padding-bottom:0.15rem;' +
          'overflow-wrap:anywhere;">' + body + '</div>' +
          '<div style="font-size:0.66rem;letter-spacing:0.06em;text-transform:uppercase;' +
          'color:' + INK4 + ';margin-top:0.3rem;">' + label + ', ' + bits +
          (bits === 1 ? ' bit' : ' bits') + '</div>' +
          /* In hex-only mode the field itself is already the hex, so the
             reading underneath would print the same string twice. */
          (read === body ? '' : '<div style="font-size:0.74rem;color:' + INK3 + ';">' +
            read + '</div>') +
          '</div>';
      }

      /* The address split, for one access. This is the reason the game
         exists, so it sits above everything else on the board and is drawn
         for every access rather than on demand. */
      function breakdownHtml(s, p) {
        var out = '<div style="margin:0 0 0.9rem;padding:0.7rem 0.8rem;' +
          'background:rgb(var(--well-rgb) / 0.6);border-radius:10px;">' +
          '<p style="margin:0 0 0.55rem;font-size:0.78rem;color:' + INK3 + ';">' +
          'Access ' + (p.index + 1) + ' of ' + s.stream.length + ' &middot; ' +
          '<span style="font-family:' + MONO + ';color:' + INK + ';">' + hex(p.addr, 4) + '</span>' +
          ' &middot; ' + (p.write ? 'store' : 'load') + '</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:0.8rem;align-items:flex-end;">' +
          seg('tag', s.tagBits, p.tag, TAGC, hex(p.tag, hexDigits(s.tagBits))) +
          seg('index', s.idxBits, p.set, IDXC,
            s.idxBits ? 'set ' + p.set : 'fully associative') +
          seg('offset', s.offBits, p.offset, OFFC, 'byte ' + p.offset) +
          '</div>' +
          '<p style="margin:0.6rem 0 0;font-size:0.78rem;line-height:1.6;color:' + INK3 + ';">' +
          'Block ' + hex(p.blockAddr, 3) + ' may only live in ' +
          (s.idxBits ? 'set ' + p.set + ', and only the ' + s.assoc +
            (s.assoc === 1 ? ' line' : ' lines') + ' there are candidates'
            : 'the single set, so every line is a candidate') +
          '. A line matches only if its stored tag is ' + hex(p.tag, hexDigits(s.tagBits)) + '.</p>' +
          '</div>';
        return out;
      }

      function cfgStrip(s, label) {
        return '<p style="margin:0 0 0.8rem;font-size:0.76rem;line-height:1.7;color:' + INK4 + ';">' +
          '<span style="color:' + INK3 + ';">' + s.size + ' B cache</span> &middot; ' +
          s.block + ' B blocks &middot; ' +
          (s.assoc === 1 ? 'direct-mapped'
            : (s.sets === 1 ? 'fully associative' : s.assoc + '-way')) +
          ' &middot; ' + s.blocks + ' lines in ' + s.sets +
          (s.sets === 1 ? ' set' : ' sets') + ' &middot; ' +
          s.tagBits + '/' + s.idxBits + '/' + s.offBits + ' tag/index/offset bits &middot; ' +
          (label || POLICY_NAME[policy]) + ' &middot; ' +
          (writeBack ? 'write-back' : 'write-through') + '</p>';
      }

      function lineCell(s, set, way, interactive, isCursor, justUsed) {
        var line = s.lines[set][way];
        var body;
        var label;
        if (!line.valid) {
          body = '<span style="color:' + INK4 + ';">empty</span>' +
            '<span style="display:block;font-size:0.64rem;color:' + INK4 + ';">invalid</span>';
          label = 'Set ' + set + ', way ' + way + ', empty';
        } else {
          var age = s.tick - line.used;
          body = '<span style="color:' + INK + ';">tag ' + hex(line.tag, hexDigits(s.tagBits)) + '</span>' +
            (line.dirty ? ' <span style="color:' + CAPC + ';">dirty</span>' : '') +
            '<span style="display:block;font-size:0.64rem;color:' + INK4 + ';">' +
            'used ' + age + ' ago &middot; in at ' + line.born + '</span>';
          label = 'Set ' + set + ', way ' + way + ', tag ' +
            hex(line.tag, hexDigits(s.tagBits)) + (line.dirty ? ', dirty' : ', clean') +
            ', last used ' + age + (age === 1 ? ' access ago' : ' accesses ago') +
            ', filled at access ' + line.born;
        }
        var base = 'display:block;width:100%;text-align:left;padding:0.4rem 0.5rem;' +
          'font-family:' + MONO + ';font-size:0.76rem;line-height:1.45;height:auto;' +
          'white-space:normal;border-radius:8px;';
        if (interactive) {
          return '<button class="game-btn" type="button" data-cg-way="' + way + '" ' +
            'tabindex="' + (isCursor ? '0' : '-1') + '" ' +
            'aria-label="Evict ' + label + '" ' +
            'style="' + base + 'border:1px solid ' + (isCursor ? CONFC : 'rgb(var(--accent-rgb) / 0.35)') +
            ';">' + body + '</button>';
        }
        return '<div style="' + base + 'border:1px solid ' +
          (justUsed ? OKC : 'rgb(var(--accent-rgb) / 0.18)') + ';' +
          'background:rgb(var(--well-rgb) / 0.5);">' + body +
          (justUsed ? '<span style="display:block;font-size:0.64rem;color:' + OKC +
            ';">just touched</span>' : '') + '</div>';
      }

      function linesHtml(s, choiceSet) {
        var html = '<div role="group" aria-label="Cache lines" style="margin:0 0 0.9rem;">';
        var cols = 'auto repeat(' + s.assoc + ', minmax(0, 1fr))';
        html += '<div style="display:grid;grid-template-columns:' + cols + ';gap:0.35rem;">';
        html += '<div></div>';
        for (var w = 0; w < s.assoc; w++) {
          html += '<div style="font-size:0.66rem;letter-spacing:0.06em;text-transform:uppercase;' +
            'color:' + INK4 + ';padding-bottom:0.1rem;">way ' + w + '</div>';
        }
        for (var st = 0; st < s.sets; st++) {
          var hot = choiceSet === st;
          html += '<div style="align-self:center;font-family:' + MONO + ';font-size:0.72rem;' +
            'padding-right:0.4rem;color:' + (hot ? IDXC : INK4) + ';">set ' + st +
            (hot ? '<span style="display:block;font-size:0.6rem;">full</span>' : '') + '</div>';
          for (var w2 = 0; w2 < s.assoc; w2++) {
            /* "just touched" is a marker on the line the previous access
               landed on, and it must be off while a choice is open: the
               previous access is over, and marking a line green in the same
               frame that asks you to throw one away is a suggestion nobody
               meant to make. */
            var justUsed = choiceSet == null && !!last && last.p.set === st && last.way === w2;
            html += lineCell(s, st, w2, hot, hot && cursor === w2, justUsed);
          }
        }
        html += '</div></div>';
        return html;
      }

      function figure(label, value, colour) {
        return '<div style="min-width:5.5rem;">' +
          '<div style="font-size:0.64rem;letter-spacing:0.06em;text-transform:uppercase;color:' +
          INK4 + ';">' + label + '</div>' +
          '<div style="font-family:' + MONO + ';font-size:0.95rem;color:' +
          (colour || INK) + ';">' + value + '</div></div>';
      }

      function countersHtml(s) {
        var done = s.hits + s.misses;
        return '<div style="display:flex;flex-wrap:wrap;gap:0.7rem 1.1rem;margin:0 0 0.9rem;' +
          'padding:0.6rem 0.7rem;background:rgb(var(--well-rgb) / 0.55);border-radius:10px;">' +
          figure('hits', s.hits, OKC) +
          figure('misses', s.misses, INK) +
          figure('hit rate', done ? pct(s.hits, done) : '—', INK3) +
          figure('compulsory', s.comp, COMPC) +
          figure('capacity', s.cap, CAPC) +
          figure('conflict', s.conf, CONFC) +
          figure('memory writes', s.memWrites, INK3) +
          figure('write-backs', s.writebacks, INK3) +
          '</div>' +
          '<p style="margin:-0.4rem 0 0.9rem;font-size:0.72rem;line-height:1.6;color:' + INK4 + ';">' +
          'Compulsory: never referenced before. Capacity: a fully associative cache of this size ' +
          'would have missed too. Conflict: it would have hit, and the index bits are the only ' +
          'reason it did not.</p>';
      }

      function streamHtml(s) {
        var html = '<div style="margin:0 0 0.9rem;">' +
          '<p style="margin:0 0 0.35rem;font-size:0.66rem;letter-spacing:0.06em;' +
          'text-transform:uppercase;color:' + INK4 + ';">The access stream</p>' +
          '<div aria-hidden="true" style="display:flex;flex-wrap:wrap;gap:0.25rem;">';
        for (var i = 0; i < s.stream.length; i++) {
          var acc = s.stream[i];
          var past = i < s.pos;
          var now = i === s.pos;
          html += '<span style="font-family:' + MONO + ';font-size:0.68rem;padding:0.15rem 0.35rem;' +
            'border-radius:5px;white-space:nowrap;' +
            'border:1px solid ' + (now ? 'var(--accent-1)' : 'rgb(var(--accent-rgb) / 0.2)') + ';' +
            'color:' + (now ? 'var(--accent-1)' : (past ? INK4 : INK3)) + ';' +
            (past ? 'opacity:0.55;' : '') + '">' +
            hex(acc.a, 4) + (acc.w ? '<span style="color:' + CAPC + ';"> W</span>' : '') +
            '</span>';
        }
        html += '</div>';
        /* The strip is a picture. A screen reader gets the same planning
           information as a sentence, because knowing what is coming is the
           entire skill on these levels and a decorative row of chips would
           withhold it. */
        var ahead = [];
        for (var j = s.pos; j < Math.min(s.stream.length, s.pos + 5); j++) {
          ahead.push(hex(s.stream[j].a, 4) + (s.stream[j].w ? ' store' : ''));
        }
        html += '<p class="sr-only">Access ' + Math.min(s.pos + 1, s.stream.length) + ' of ' +
          s.stream.length + '. Coming up: ' + (ahead.length ? ahead.join(', ') : 'nothing, the stream is finished') +
          '.</p></div>';
        return html;
      }

      /* How many DISTINCT blocks each set has to hold over the whole
         stream. On the stride level this one row is the entire diagnosis:
         one set asked to hold eight blocks and seven sets asked to hold
         none. */
      function setMapHtml(cfg, stream) {
        var probe = new Sim(cfg, stream, {});
        var seenPer = [];
        var counts = [];
        var i;
        for (i = 0; i < probe.sets; i++) { seenPer.push({}); counts.push(0); }
        for (i = 0; i < stream.length; i++) {
          var p = probe.split(stream[i].a);
          if (!seenPer[p.set][p.blockAddr]) {
            seenPer[p.set][p.blockAddr] = 1;
            counts[p.set]++;
          }
        }
        var max = 1;
        for (i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
        var html = '<div style="margin:0 0 0.9rem;">' +
          '<p style="margin:0 0 0.4rem;font-size:0.66rem;letter-spacing:0.06em;' +
          'text-transform:uppercase;color:' + INK4 + ';">Distinct blocks landing in each set &middot; ' +
          probe.assoc + (probe.assoc === 1 ? ' line' : ' lines') + ' available per set</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">';
        for (i = 0; i < counts.length; i++) {
          var over = counts[i] > probe.assoc;
          html += '<div style="min-width:3.4rem;">' +
            '<div style="height:' + Math.max(3, Math.round(38 * counts[i] / max)) + 'px;' +
            'background:' + (over ? CONFC : OKC) + ';border-radius:3px;"></div>' +
            '<div style="font-family:' + MONO + ';font-size:0.66rem;color:' +
            (over ? CONFC : INK3) + ';">set ' + i + ': ' + counts[i] + '</div></div>';
        }
        html += '</div><p style="margin:0.4rem 0 0;font-size:0.72rem;color:' + INK4 + ';">' +
          'A set asked to hold more distinct blocks than it has lines will thrash, and every ' +
          'miss it produces beyond the first is a conflict miss.</p></div>';
        return html;
      }

      function optionsHtml(L) {
        var html = '<div role="group" aria-label="Access patterns" ' +
          'style="display:grid;gap:0.5rem;margin:0 0 0.9rem;">';
        for (var i = 0; i < L.options.length; i++) {
          var o = L.options[i];
          var used = lastOpt === i;
          html += '<button class="game-btn" type="button" data-cg-opt="' + i + '" ' +
            'tabindex="' + (cursor === i ? '0' : '-1') + '" ' +
            'style="display:block;width:100%;text-align:left;padding:0.6rem 0.75rem;' +
            'font-size:0.86rem;line-height:1.5;white-space:normal;height:auto;' +
            'border:1px solid ' + (cursor === i ? 'var(--accent-1)' : 'rgb(var(--accent-rgb) / 0.3)') +
            ';">' + o.label +
            '<span style="display:block;margin-top:0.2rem;font-size:0.7rem;color:' + INK4 + ';">' +
            o.note + (o.assoc ? ' &middot; associativity raised to ' + o.assoc + '-way' : '') +
            (used && lastRun ? ' &middot; last run: ' + lastRun.misses + ' misses' : '') +
            '</span></button>';
        }
        html += '</div>';
        return html;
      }

      function comparisonHtml(L) {
        var mine = sim.misses;
        var pol = refs.policy.misses;
        var bel = refs.belady.misses;
        var rows = [
          { k: 'You', v: mine, c: mine <= bel ? OKC : INK },
          { k: POLICY_NAME[policy], v: pol, c: INK3 },
          { k: 'Belady optimal', v: bel, c: 'var(--accent-1)' }
        ];
        var html = '<div style="display:flex;flex-wrap:wrap;gap:0.7rem 1.4rem;margin:0 0 0.8rem;">';
        for (var i = 0; i < rows.length; i++) {
          html += figure(rows[i].k + ' misses', rows[i].v, rows[i].c);
        }
        html += figure('write-backs', sim.writebacks, INK3);
        html += '</div>' +
          '<p style="margin:0 0 0.8rem;font-size:0.8rem;line-height:1.65;color:' + INK3 + ';">' +
          'Belady optimal evicts the line whose next use is furthest away. It is computed here by ' +
          'reading the rest of the stream, which is exactly why no cache can implement it: it needs ' +
          'the future. It is on the board as a floor, so a policy&rsquo;s miss count has something ' +
          'to be measured against.</p>' +
          '<p style="margin:0 0 0.9rem;font-size:0.85rem;line-height:1.7;color:' + INK3 + ';">' +
          L.lesson + '</p>';
        return html;
      }

      function banner(text, colour) {
        return '<p style="margin:0 0 0.9rem;padding:0.55rem 0.7rem;font-size:0.85rem;' +
          'line-height:1.6;color:' + INK + ';background:rgb(var(--well-rgb) / 0.8);' +
          'border-left:3px solid ' + colour + ';border-radius:8px;">' + text + '</p>';
      }

      function header(L) {
        return '<p style="margin:0 0 0.3rem;font-size:0.68rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">Level ' + (at + 1) + ' of ' +
          LEVELS.length + ' &middot; ' + (L.mode === 'evict' ? 'you are the cache' : 'you write the pattern') +
          '</p>' +
          '<h3 style="margin:0 0 0.4rem;font-size:1.05rem;color:' + INK + ';">' + L.name + '</h3>' +
          '<p style="margin:0 0 0.8rem;font-size:0.85rem;line-height:1.65;color:' + INK3 + ';">' +
          L.brief + '</p>';
      }

      function setStepLabel() {
        if (!stepBtn) return;
        var label = 'Step';
        if (phase === 'choose') label = 'Evict selected';
        else if (phase === 'done') label = at + 1 >= LEVELS.length ? 'Finish' : 'Next level';
        else if (phase === 'pick') label = 'Run this pattern';
        else if (phase === 'finished') label = 'Finished';
        stepBtn.textContent = label;
        stepBtn.disabled = phase === 'finished';
        stepBtn.title = phase === 'choose'
          ? 'Evict the highlighted line and complete the access'
          : (phase === 'pick' ? 'Simulate the selected access pattern against this cache'
            : 'Issue the next access');
      }

      function render() {
        var L = LEVELS[at];
        var html = header(L);

        if (L.mode === 'evict') {
          html += cfgStrip(sim);
          var p = pending || sim.peek();
          if (p) html += breakdownHtml(sim, p);
          else if (last) html += breakdownHtml(sim, last.p);

          if (phase === 'choose') {
            html += banner('Set ' + pending.set + ' is full and this block has to go somewhere. ' +
              'Pick the line to throw out &mdash; the stream below is the future, and you are ' +
              'allowed to read it. A real cache is not.', CONFC);
          } else if (last) {
            html += banner(last.hit
              ? 'Hit in way ' + last.way + '.'
              : 'Miss &mdash; ' + last.kind + '. Way ' + last.way + ' now holds tag ' +
                hex(last.p.tag, hexDigits(sim.tagBits)) +
                (last.evicted
                  ? ', replacing tag ' + hex(last.evicted.tag, hexDigits(sim.tagBits)) +
                    (last.wroteBack ? ', which was dirty and had to be written back to memory.'
                      : ', which was clean, so nothing was written to memory.')
                  : '. The set had a free line, so nothing was evicted.'),
              last.hit ? OKC : (last.kind === 'compulsory' ? COMPC
                : (last.kind === 'capacity' ? CAPC : CONFC)));
          }

          html += linesHtml(sim, phase === 'choose' ? pending.set : null);
          html += countersHtml(sim);
          html += streamHtml(sim);

          if (phase === 'done') html += comparisonHtml(L);
        } else {
          var shownCfg = lastRun ? lastRun : new Sim(levelCfg(L, null), [], {});
          html += cfgStrip(shownCfg);
          html += optionsHtml(L);
          if (lastRun) {
            var opt = L.options[lastOpt];
            var stream = opt.build();
            html += banner(opt.label + ': <strong>' + lastRun.misses + ' misses</strong> out of ' +
              stream.length + ' accesses, hit rate ' + pct(lastRun.hits, stream.length) +
              '. The target is ' + L.target + ' or fewer' +
              (lastRun.misses <= L.target ? ' &mdash; cleared.' : '.'),
              lastRun.misses <= L.target ? OKC : CONFC);
            html += countersHtml(lastRun);
            html += setMapHtml(lastRun.cfgUsed, stream);
            var first = lastRun.split(stream[0].a);
            first.index = 0;
            first.write = !!stream[0].w;
            var second = lastRun.split(stream[1].a);
            second.index = 1;
            second.write = !!stream[1].w;
            html += '<p style="margin:0 0 0.4rem;font-size:0.66rem;letter-spacing:0.06em;' +
              'text-transform:uppercase;color:' + INK4 + ';">The first two accesses, split</p>';
            html += breakdownHtml(lastRun, first);
            html += breakdownHtml(lastRun, second);
          } else {
            html += '<p style="margin:0 0 0.9rem;font-size:0.8rem;line-height:1.65;color:' +
              INK4 + ';">Pick a pattern and run it. Nothing is scored until one of them comes in ' +
              'at or under the target, and every attempt after the first costs twenty points.</p>';
          }
          if (phase === 'done') {
            html += '<p style="margin:0 0 0.9rem;font-size:0.85rem;line-height:1.7;color:' +
              INK3 + ';">' + L.lesson + '</p>';
          }
        }

        if (phase === 'done') {
          html += '<p style="margin:0 0 0.5rem;font-size:0.9rem;color:' + INK + ';">' +
            earned + ' points for this level. Running total ' + total + '.</p>';
        }
        if (phase === 'finished') {
          html += banner('Run complete: ' + total + ' points out of ' + (LEVELS.length * 100) +
            '. Nothing here had a prefetcher, a second level of cache, a TLB or a second core, ' +
            'and real hardware has all four.', 'var(--accent-1)');
        }

        host.innerHTML = html;
        wire();
        setStepLabel();

        /* Never while the game is idle. reset() runs from the shell's
           constructor, long before anybody has pressed Play, and taking the
           keyboard there would pull it off whatever the visitor was actually
           reading on a page that has only just loaded. */
        if (wantFocus && g.state === 'playing' && cells.length) {
          wantFocus = false;
          var node = cells[Math.min(cursor, cells.length - 1)];
          try { node.focus({ preventScroll: true }); } catch (err) { node.focus(); }
        }
        wantFocus = false;
      }

      /* Attach handlers to whatever the render just produced, and keep a
         list of the focusable ones so the arrows have something to walk.
         Exactly one of them is a tab stop, the same roving-tabindex rule
         minesweeper.js settled on: a board of twenty dead tab stops between
         the toolbar and the article below it helps nobody. */
      function wire() {
        cells = [];
        var i;
        var ways = host.querySelectorAll('[data-cg-way]');
        for (i = 0; i < ways.length; i++) {
          (function (node) {
            cells.push(node);
            node.addEventListener('click', function () {
              evictAt(Number(node.getAttribute('data-cg-way')));
            });
            node.addEventListener('focus', function () {
              cursor = Number(node.getAttribute('data-cg-way'));
            });
          })(ways[i]);
        }
        var opts = host.querySelectorAll('[data-cg-opt]');
        for (i = 0; i < opts.length; i++) {
          (function (node) {
            cells.push(node);
            node.addEventListener('click', function () {
              runOption(Number(node.getAttribute('data-cg-opt')));
            });
            node.addEventListener('focus', function () {
              cursor = Number(node.getAttribute('data-cg-opt'));
            });
          })(opts[i]);
        }
      }

      function moveCursor(delta) {
        if (!cells.length) return;
        var n = cells.length;
        cursor = ((cursor + delta) % n + n) % n;
        for (var i = 0; i < cells.length; i++) {
          cells[i].setAttribute('tabindex', i === cursor ? '0' : '-1');
        }
        var node = cells[cursor];
        try { node.focus({ preventScroll: true }); } catch (err) { node.focus(); }
        g.beep(520, 0.03, 'sine', 0.03);
      }

      /* =============================================================
         Shell hooks
         ============================================================= */
      function reset() {
        total = 0;
        g.setScore(0);
        beginLevel(startLevel);
      }

      function onKey(name) {
        if (name === 'action') { advance(); return; }
        if (phase !== 'choose' && phase !== 'pick') return;
        if (name === 'left' || name === 'up') moveCursor(-1);
        else if (name === 'right' || name === 'down') moveCursor(1);
      }

      return {
        reset: reset,
        key: onKey,
        ended: function () {
          phase = 'finished';
          render();
        }
      };
    }
  });
}());

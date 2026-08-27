/* ==========================================================================
   os-algo.js — the algorithms an operating system runs, made watchable.
   --------------------------------------------------------------------------
   Every OS course covers the same five families: which process gets the CPU,
   which page gets evicted, what order the disk head serves requests in, where
   a process fits in memory, and whether granting a resource request leaves the
   system in a safe state. They are all taught as tables of numbers on a
   whiteboard, and almost nobody comes away with a picture. This lab runs each
   of them for real and lets you step through time one unit at a time, watching
   the ready queue drain, the frames fill, the head sweep, the blocks fill up.

   Design decisions worth spelling out:

   1. One shell, five simulations. Each family exposes the same tiny contract —
      read its inputs, compute frames, draw frame i — so the transport controls
      (reset / back / play / step / end), the speed slider and the compare
      table are written once. The alternative, five bespoke toys, would have
      been five times the surface area for the same lesson.

   2. Frames are computed up front, never incrementally. Every simulation runs
      to completion the moment an input changes and stores a snapshot per step;
      the transport just indexes into that array. This is what makes stepping
      BACKWARDS free, which matters more than it sounds — you cannot study a
      preemption you only get to see once. It also means the metrics shown are
      the finished numbers, not a partial sum that looks wrong mid-run.

   3. Unit-time simulation for scheduling, not event jumping. A scheduler can
      be simulated by hopping from event to event, which is faster and much
      harder to watch. Ticking one time unit at a time costs nothing at these
      sizes and gives every tick a frame, so the Gantt chart fills in at the
      rate a human reads it.

   4. Textbook conventions are chosen explicitly and stated on the page, never
      left implicit. Round robin puts a newly arrived process ahead of the one
      whose quantum just expired; SCAN runs to the end of the disk while LOOK
      turns at the last request; a lower priority number means higher priority.
      Books differ, and a visualiser that hides its convention teaches the
      wrong lesson the moment the numbers disagree with someone's homework.

   5. No eval, no network, no dependencies. The whole thing is arithmetic and
      DOM, plus one canvas for the disk head plot. Nothing here opens a
      connection.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  var TICK_GUARD = 4000;   // a scheduling run that never converges stops itself
  var MAX_FRAMES = 4000;

  /* ======================================================================== */
  /*  CORE 1 — CPU SCHEDULING                                                 */
  /* ------------------------------------------------------------------------ */
  /*  Simulated one time unit at a time. Every algorithm shares the loop; they */
  /*  differ only in pick() and in whether the choice may change mid-burst.    */
  /* ======================================================================== */

  var SCHED_ALGOS = {
    fcfs:   { label: 'First come, first served (FCFS)', pre: false },
    sjf:    { label: 'Shortest job first (SJF)', pre: false },
    srtf:   { label: 'Shortest remaining time (SRTF)', pre: true },
    rr:     { label: 'Round robin (RR)', pre: false, rr: true },
    prio:   { label: 'Priority, non-preemptive', pre: false },
    prio_p: { label: 'Priority, preemptive', pre: true }
  };
  var SCHED_ORDER = ['fcfs', 'sjf', 'srtf', 'rr', 'prio', 'prio_p'];

  /* Ordering key for a candidate process. Smaller wins. */
  function schedKey(algo, p) {
    if (algo === 'sjf') return p.burst;
    if (algo === 'srtf') return p.remaining;
    if (algo === 'prio' || algo === 'prio_p') return p.priority;
    return p.arrival;            // fcfs
  }

  function schedule(input, algo) {
    var spec = SCHED_ALGOS[algo];
    if (!spec) throw new Error('unknown scheduling algorithm: ' + algo);
    var quantum = Math.max(1, input.quantum | 0);

    var p = input.procs.map(function (src, i) {
      return {
        i: i, name: src.name, arrival: src.arrival, burst: src.burst,
        priority: src.priority, remaining: src.burst,
        start: -1, completion: -1, admitted: false
      };
    });
    var n = p.length;

    var timeline = [];     // one entry per time unit: process index, or -1 idle
    var frames = [];       // one snapshot per time unit
    var ready = [];        // RR keeps a real FIFO queue; the rest scan the table
    var t = 0, done = 0, cur = -1, slice = 0, switches = 0;

    /* Admit every process that has arrived by `now`, in arrival order and then
       table order, so the queue matches what a reader builds by hand. */
    function admit(now) {
      for (;;) {
        var best = -1;
        for (var j = 0; j < n; j++) {
          if (p[j].admitted || p[j].arrival > now) continue;
          if (best < 0 || p[j].arrival < p[best].arrival) best = j;
        }
        if (best < 0) return;
        p[best].admitted = true;
        if (spec.rr) ready.push(best);
      }
    }

    function pick(now, keep) {
      var best = -1, bestKey = 0;
      for (var i = 0; i < n; i++) {
        if (!p[i].admitted || p[i].remaining <= 0) continue;
        var k = schedKey(algo, p[i]);
        if (best < 0 || k < bestKey) { best = i; bestKey = k; }
      }
      // A preemptive scheduler that re-picks every tick must not swap between
      // two equally good processes: a needless context switch is not free on a
      // real machine, and it makes the Gantt chart lie about preemption.
      if (best >= 0 && keep >= 0 && p[keep].admitted && p[keep].remaining > 0 &&
          schedKey(algo, p[keep]) === bestKey) return keep;
      return best;
    }

    function readySnapshot(running) {
      var out = [], i;
      if (spec.rr) {
        for (i = 0; i < ready.length; i++) if (p[ready[i]].remaining > 0) out.push(ready[i]);
        return out;
      }
      for (i = 0; i < n; i++) {
        if (p[i].admitted && p[i].remaining > 0 && i !== running) out.push(i);
      }
      out.sort(function (a, b) {
        var d = schedKey(algo, p[a]) - schedKey(algo, p[b]);
        if (d) return d;
        d = p[a].arrival - p[b].arrival;
        return d || (a - b);
      });
      return out;
    }

    function snap(now, running) {
      return {
        t: now, running: running, ready: readySnapshot(running),
        quantumLeft: spec.rr ? slice : -1,
        remaining: p.map(function (x) { return x.remaining; })
      };
    }

    while (done < n && t < TICK_GUARD && frames.length < MAX_FRAMES) {
      admit(t);

      // A round-robin quantum that expired at the end of the previous tick goes
      // to the back of the queue AFTER this tick's arrivals are admitted — the
      // usual textbook convention, and the one that changes the answer most
      // often when a reader compares against their own working.
      if (spec.rr && cur >= 0 && slice === 0) { ready.push(cur); cur = -1; }

      var before = cur;
      if (spec.rr) {
        while (cur < 0 && ready.length) {
          var head = ready.shift();
          if (p[head].remaining > 0) { cur = head; slice = quantum; }
        }
      } else if (spec.pre) {
        cur = pick(t, cur);
      } else if (cur < 0) {
        cur = pick(t, -1);
      }
      if (cur >= 0 && cur !== before) switches++;

      if (cur < 0) {                       // nothing has arrived yet: idle tick
        timeline.push(-1);
        frames.push(snap(t, -1));
        t++;
        continue;
      }

      if (p[cur].start < 0) p[cur].start = t;
      p[cur].remaining--;
      timeline.push(cur);
      if (spec.rr) slice--;
      t++;
      frames.push(snap(t - 1, cur));

      if (p[cur].remaining === 0) {
        p[cur].completion = t;
        done++;
        cur = -1;
        slice = 0;
      }
    }

    // Merge equal neighbouring ticks into Gantt segments.
    var slots = [], k;
    for (k = 0; k < timeline.length; k++) {
      if (slots.length && slots[slots.length - 1].pid === timeline[k]) slots[slots.length - 1].end = k + 1;
      else slots.push({ pid: timeline[k], start: k, end: k + 1 });
    }

    var rows = p.map(function (x) {
      var tat = x.completion - x.arrival;
      return {
        name: x.name, arrival: x.arrival, burst: x.burst, priority: x.priority,
        start: x.start, completion: x.completion,
        turnaround: tat, waiting: tat - x.burst, response: x.start - x.arrival
      };
    });

    var busy = 0;
    for (k = 0; k < timeline.length; k++) if (timeline[k] >= 0) busy++;
    var total = timeline.length;
    function avg(field) {
      var s = 0;
      for (var i = 0; i < rows.length; i++) s += rows[i][field];
      return rows.length ? s / rows.length : 0;
    }

    return {
      timeline: timeline, slots: slots, frames: frames, rows: rows,
      complete: done === n,
      summary: {
        avgWaiting: avg('waiting'), avgTurnaround: avg('turnaround'),
        avgResponse: avg('response'), switches: switches,
        busy: busy, total: total, idle: total - busy,
        utilisation: total ? busy / total : 0,
        throughput: total ? n / total : 0
      }
    };
  }

  /* ======================================================================== */
  /*  CORE 2 — PAGE REPLACEMENT                                               */
  /* ------------------------------------------------------------------------ */
  /*  Every policy answers one question: with all frames full, which page      */
  /*  leaves? The victim rule is the only thing that differs, so the loop is   */
  /*  shared and each policy supplies victim() plus its own bookkeeping.       */
  /* ======================================================================== */

  var PAGE_ALGOS = {
    fifo:  { label: 'FIFO (first in, first out)' },
    lru:   { label: 'LRU (least recently used)' },
    opt:   { label: 'Optimal (OPT, Belady)' },
    clock: { label: 'Clock (second chance)' },
    lfu:   { label: 'LFU (least frequently used)' }
  };
  var PAGE_ORDER = ['fifo', 'lru', 'opt', 'clock', 'lfu'];

  function pageReplace(refs, frameCount, algo) {
    if (!PAGE_ALGOS[algo]) throw new Error('unknown page algorithm: ' + algo);
    var N = Math.max(1, frameCount | 0);
    var frames = new Array(N), i;
    for (i = 0; i < N; i++) frames[i] = null;

    var loadedAt = new Array(N);   // FIFO order, and the LFU tie-break
    var usedAt = new Array(N);     // LRU recency
    var refbit = new Array(N);     // Clock reference bit
    var count = new Array(N);      // LFU frequency
    for (i = 0; i < N; i++) { loadedAt[i] = -1; usedAt[i] = -1; refbit[i] = 0; count[i] = 0; }

    var hand = 0, clock = 0, faults = 0, hits = 0;
    var steps = [];

    function slotOf(page) {
      for (var s = 0; s < N; s++) if (frames[s] === page) return s;
      return -1;
    }
    function firstFree() {
      for (var s = 0; s < N; s++) if (frames[s] === null) return s;
      return -1;
    }

    /* Which frame loses its page. Only reached when every frame is occupied. */
    function victim(step) {
      var s, best = 0, k;
      if (algo === 'fifo') {
        for (s = 1; s < N; s++) if (loadedAt[s] < loadedAt[best]) best = s;
        return best;
      }
      if (algo === 'lru') {
        for (s = 1; s < N; s++) if (usedAt[s] < usedAt[best]) best = s;
        return best;
      }
      if (algo === 'lfu') {
        // Fewest uses wins; a tie goes to the older page, so the answer does
        // not depend on which frame happened to be filled first.
        for (s = 1; s < N; s++) {
          if (count[s] < count[best] ||
             (count[s] === count[best] && loadedAt[s] < loadedAt[best])) best = s;
        }
        return best;
      }
      if (algo === 'opt') {
        // Evict the page whose next use is furthest away. Never used again
        // counts as infinitely far, and the first such frame is taken.
        var bestDist = -1;
        for (s = 0; s < N; s++) {
          var dist = Infinity;
          for (k = step + 1; k < refs.length; k++) {
            if (refs[k] === frames[s]) { dist = k; break; }
          }
          if (dist === Infinity) return s;
          if (dist > bestDist) { bestDist = dist; best = s; }
        }
        return best;
      }
      // Clock: sweep the hand, giving each referenced page one second chance.
      var guard = 0;
      while (guard++ <= N * 2) {
        if (refbit[hand] === 0) { var v = hand; hand = (hand + 1) % N; return v; }
        refbit[hand] = 0;
        hand = (hand + 1) % N;
      }
      return hand;
    }

    for (var step = 0; step < refs.length; step++) {
      var page = refs[step];
      var slot = slotOf(page);
      var hit = slot >= 0;
      var evicted = null, target;

      clock++;
      if (hit) {
        hits++;
        target = slot;
        usedAt[slot] = clock;
        count[slot]++;
        if (algo === 'clock') refbit[slot] = 1;
      } else {
        faults++;
        var free = firstFree();
        if (free >= 0) {
          target = free;
        } else {
          target = victim(step);
          evicted = frames[target];
        }
        frames[target] = page;
        loadedAt[target] = clock;
        usedAt[target] = clock;
        count[target] = 1;
        if (algo === 'clock') refbit[target] = 1;
      }

      var meta = [];
      for (i = 0; i < N; i++) {
        if (frames[i] === null) meta.push('');
        else if (algo === 'clock') meta.push('r' + refbit[i]);
        else if (algo === 'lfu') meta.push('x' + count[i]);
        else if (algo === 'lru') meta.push('t' + usedAt[i]);
        else if (algo === 'fifo') meta.push('#' + loadedAt[i]);
        else meta.push('');
      }

      steps.push({
        step: step, page: page, hit: hit, slot: target, evicted: evicted,
        frames: frames.slice(), meta: meta,
        hand: algo === 'clock' ? hand : -1,
        faults: faults, hits: hits
      });
    }

    return {
      steps: steps, frameCount: N, refs: refs.slice(),
      summary: {
        faults: faults, hits: hits, total: refs.length,
        faultRate: refs.length ? faults / refs.length : 0,
        hitRate: refs.length ? hits / refs.length : 0
      }
    };
  }

  /* ======================================================================== */
  /*  CORE 3 — DISK SCHEDULING                                                */
  /* ------------------------------------------------------------------------ */
  /*  Each policy is only an order for the request list; head movement is then */
  /*  the sum of the gaps along that order. SCAN and C-SCAN run to the         */
  /*  physical end of the disk, LOOK and C-LOOK turn at the last request —     */
  /*  that difference is the whole point of the pair, so it is drawn plainly.  */
  /* ======================================================================== */

  var DISK_ALGOS = {
    fcfs:  { label: 'FCFS (queue order)' },
    sstf:  { label: 'SSTF (shortest seek first)' },
    scan:  { label: 'SCAN (elevator, to the end)' },
    cscan: { label: 'C-SCAN (circular SCAN)' },
    look:  { label: 'LOOK (turn at last request)' },
    clook: { label: 'C-LOOK (circular LOOK)' }
  };
  var DISK_ORDER = ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'];

  function diskSchedule(reqs, head, maxCyl, up, algo) {
    if (!DISK_ALGOS[algo]) throw new Error('unknown disk algorithm: ' + algo);
    var queue = reqs.slice();
    var path = [head], jumps = [], labels = [], i;

    function go(cyl, isJump, label) {
      path.push(cyl);
      jumps.push(!!isJump);
      labels.push(label === undefined ? String(cyl) : label);
    }

    if (algo === 'fcfs') {
      for (i = 0; i < queue.length; i++) go(queue[i], false);
    } else if (algo === 'sstf') {
      var pool = queue.slice(), at = head;
      while (pool.length) {
        var best = 0;
        for (i = 1; i < pool.length; i++) {
          var d = Math.abs(pool[i] - at) - Math.abs(pool[best] - at);
          // Equidistant requests: the lower cylinder wins, so a run is
          // deterministic instead of depending on queue order.
          if (d < 0 || (d === 0 && pool[i] < pool[best])) best = i;
        }
        at = pool[best];
        go(at, false);
        pool.splice(best, 1);
      }
    } else {
      var lower = [], upper = [];
      for (i = 0; i < queue.length; i++) {
        if (queue[i] < head) lower.push(queue[i]); else upper.push(queue[i]);
      }
      lower.sort(function (a, b) { return a - b; });
      upper.sort(function (a, b) { return a - b; });

      if (algo === 'scan' || algo === 'look') {
        var toEnd = algo === 'scan';
        if (up) {
          for (i = 0; i < upper.length; i++) go(upper[i], false);
          if (toEnd && path[path.length - 1] < maxCyl) go(maxCyl, false, 'end ' + maxCyl);
          for (i = lower.length - 1; i >= 0; i--) go(lower[i], false);
        } else {
          for (i = lower.length - 1; i >= 0; i--) go(lower[i], false);
          if (toEnd && path[path.length - 1] > 0) go(0, false, 'end 0');
          for (i = 0; i < upper.length; i++) go(upper[i], false);
        }
      } else {
        // C-SCAN / C-LOOK: service in one direction only, then take one long
        // jump back and start again. The jump is drawn dashed because nothing
        // is serviced along it — which is exactly why the policy trades total
        // distance for a fairer worst-case wait.
        var circ = algo === 'cscan';
        if (up) {
          for (i = 0; i < upper.length; i++) go(upper[i], false);
          if (lower.length) {
            if (circ) {
              if (path[path.length - 1] < maxCyl) go(maxCyl, false, 'end ' + maxCyl);
              go(0, true, 'wrap to 0');
              for (i = 0; i < lower.length; i++) go(lower[i], false);
            } else {
              go(lower[0], true);
              for (i = 1; i < lower.length; i++) go(lower[i], false);
            }
          } else if (circ && path[path.length - 1] < maxCyl) {
            go(maxCyl, false, 'end ' + maxCyl);
          }
        } else {
          for (i = lower.length - 1; i >= 0; i--) go(lower[i], false);
          if (upper.length) {
            if (circ) {
              if (path[path.length - 1] > 0) go(0, false, 'end 0');
              go(maxCyl, true, 'wrap to ' + maxCyl);
              for (i = upper.length - 1; i >= 0; i--) go(upper[i], false);
            } else {
              go(upper[upper.length - 1], true);
              for (i = upper.length - 2; i >= 0; i--) go(upper[i], false);
            }
          } else if (circ && path[path.length - 1] > 0) {
            go(0, false, 'end 0');
          }
        }
      }
    }

    var total = 0, segments = [];
    for (i = 1; i < path.length; i++) {
      var dist = Math.abs(path[i] - path[i - 1]);
      total += dist;
      segments.push({ from: path[i - 1], to: path[i], dist: dist,
                      jump: jumps[i - 1], label: labels[i - 1] });
    }

    return {
      path: path, segments: segments, head: head, maxCyl: maxCyl, up: up,
      summary: {
        total: total, seeks: segments.length,
        average: segments.length ? total / segments.length : 0
      }
    };
  }

  /* ======================================================================== */
  /*  CORE 4 — MEMORY ALLOCATION (fixed partitions)                           */
  /* ------------------------------------------------------------------------ */
  /*  Blocks are fixed partitions and each holds at most one process, which is */
  /*  the model the four classic fits are taught with. Anything a process does */
  /*  not use inside its block is internal fragmentation; whole blocks left    */
  /*  empty are external. Watching best fit leave a trail of unusable slivers  */
  /*  is the entire argument for why "best" is a bad name.                     */
  /* ======================================================================== */

  var MEM_ALGOS = {
    first: { label: 'First fit' },
    best:  { label: 'Best fit' },
    worst: { label: 'Worst fit' },
    next:  { label: 'Next fit' }
  };
  var MEM_ORDER = ['first', 'best', 'worst', 'next'];

  function memAllocate(blockSizes, procSizes, algo) {
    if (!MEM_ALGOS[algo]) throw new Error('unknown allocation algorithm: ' + algo);
    var blocks = blockSizes.map(function (size, i) {
      return { i: i, size: size, proc: -1, used: 0 };
    });
    var steps = [], ptr = 0;

    for (var k = 0; k < procSizes.length; k++) {
      var need = procSizes[k];
      var chosen = -1, considered = [], b, j;

      if (algo === 'first' || algo === 'next') {
        var startAt = algo === 'next' ? ptr : 0;
        for (j = 0; j < blocks.length; j++) {
          b = (startAt + j) % blocks.length;
          considered.push(b);
          if (blocks[b].proc < 0 && blocks[b].size >= need) { chosen = b; break; }
        }
      } else {
        for (b = 0; b < blocks.length; b++) {
          if (blocks[b].proc < 0 && blocks[b].size >= need) {
            considered.push(b);
            if (chosen < 0) chosen = b;
            else if (algo === 'best' && blocks[b].size < blocks[chosen].size) chosen = b;
            else if (algo === 'worst' && blocks[b].size > blocks[chosen].size) chosen = b;
          }
        }
      }

      if (chosen >= 0) {
        blocks[chosen].proc = k;
        blocks[chosen].used = need;
        // Next fit resumes from where the last search stopped. A block cannot
        // be reused here, so resuming at the block itself and at the block
        // after it give the same answer; the block itself is the usual form.
        ptr = chosen;
      }

      steps.push({
        step: k, proc: k, size: need, chosen: chosen, considered: considered,
        pointer: algo === 'next' ? ptr : -1,
        blocks: blocks.map(function (x) { return { size: x.size, proc: x.proc, used: x.used }; })
      });
    }

    var placed = 0, failed = [], internal = 0, freeBytes = 0, freeBlocks = 0;
    blocks.forEach(function (x) {
      if (x.proc >= 0) { placed++; internal += x.size - x.used; }
      else { freeBlocks++; freeBytes += x.size; }
    });
    for (var q = 0; q < procSizes.length; q++) {
      var found = false;
      for (var r = 0; r < blocks.length; r++) if (blocks[r].proc === q) found = true;
      if (!found) failed.push(q);
    }

    return {
      steps: steps, blocks: blocks, procs: procSizes.slice(),
      summary: {
        placed: placed, failed: failed.length, failedList: failed,
        internal: internal, freeBlocks: freeBlocks, freeBytes: freeBytes,
        totalMemory: blockSizes.reduce(function (a, b2) { return a + b2; }, 0)
      }
    };
  }

  /* ======================================================================== */
  /*  CORE 5 — BANKER'S ALGORITHM                                             */
  /* ------------------------------------------------------------------------ */
  /*  Deadlock avoidance: a state is safe if there exists an order in which    */
  /*  every process can finish. The safety check pretends to run each process  */
  /*  that can be satisfied from what is available, collects everything it     */
  /*  returns, and repeats. If it gets stuck with processes left, the state is */
  /*  unsafe — which is not the same as deadlocked, and the page says so.      */
  /* ======================================================================== */

  function subVec(a, b) { return a.map(function (v, i) { return v - b[i]; }); }
  function addVec(a, b) { return a.map(function (v, i) { return v + b[i]; }); }
  function lteVec(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] > b[i]) return false;
    return true;
  }

  function bankers(alloc, max, avail, names) {
    var n = alloc.length, m = avail.length, i;
    var need = [], bad = [];
    for (i = 0; i < n; i++) {
      need.push(subVec(max[i], alloc[i]));
      for (var j = 0; j < m; j++) if (need[i][j] < 0) bad.push(i);
    }
    if (bad.length) {
      return { need: need, error: 'Process ' + names[bad[0]] + ' holds more of a resource than its maximum claim, so Need would be negative. Fix the allocation or raise the maximum.' };
    }

    var work = avail.slice();
    var finish = [];
    for (i = 0; i < n; i++) finish.push(false);
    var sequence = [], steps = [], guard = 0;

    while (sequence.length < n && guard++ <= n + 1) {
      var checked = [], chosen = -1;
      for (i = 0; i < n; i++) {
        if (finish[i]) continue;
        var ok = lteVec(need[i], work);
        checked.push({ proc: i, ok: ok, need: need[i].slice() });
        if (ok && chosen < 0) chosen = i;
      }
      if (chosen < 0) {
        steps.push({ work: work.slice(), checked: checked, chosen: -1,
                     finish: finish.slice(), sequence: sequence.slice() });
        break;
      }
      var released = work.slice();
      work = addVec(work, alloc[chosen]);
      finish[chosen] = true;
      sequence.push(chosen);
      steps.push({ work: released, workAfter: work.slice(), checked: checked,
                   chosen: chosen, finish: finish.slice(), sequence: sequence.slice() });
    }

    return {
      need: need, safe: sequence.length === n, sequence: sequence, steps: steps,
      alloc: alloc, max: max, avail: avail, names: names
    };
  }

  /* Can this request be granted right now? Three tests, in the order the
     algorithm defines them, then a safety check on the pretend state. */
  function bankRequest(state, proc, request) {
    var need = state.need[proc];
    if (!lteVec(request, need)) {
      return { granted: false, reason: 'Request exceeds the declared maximum need for ' +
               state.names[proc] + '. That is an error, not a wait: the process broke its own claim.' };
    }
    if (!lteVec(request, state.avail)) {
      return { granted: false, reason: 'Not enough resources are available right now, so ' +
               state.names[proc] + ' waits. Nothing is unsafe — there simply is not enough free.' };
    }
    var alloc2 = state.alloc.map(function (row, i) {
      return i === proc ? addVec(row, request) : row.slice();
    });
    var avail2 = subVec(state.avail, request);
    var trial = bankers(alloc2, state.max, avail2, state.names);
    return {
      granted: trial.safe, trial: trial,
      reason: trial.safe
        ? 'Granting it leaves a safe state, so the request is granted immediately.'
        : 'Granting it would leave an unsafe state, so the request is refused and ' +
          state.names[proc] + ' waits — even though the resources are free.'
    };
  }

  var CORE = {
    schedule: schedule, pageReplace: pageReplace, diskSchedule: diskSchedule,
    memAllocate: memAllocate, bankers: bankers, bankRequest: bankRequest,
    SCHED_ALGOS: SCHED_ALGOS, PAGE_ALGOS: PAGE_ALGOS, DISK_ALGOS: DISK_ALGOS,
    MEM_ALGOS: MEM_ALGOS, SCHED_ORDER: SCHED_ORDER, PAGE_ORDER: PAGE_ORDER,
    DISK_ORDER: DISK_ORDER, MEM_ORDER: MEM_ORDER
  };

  /* The five cores above are pure functions of their inputs, so the build-time
     test harness loads this same file under Node and checks them against
     worked textbook examples. Testing a copy of the logic would prove nothing
     about the file the page actually ships. In a browser `module` is undefined
     and this is a no-op. */
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  SHELL — tabs, transport, and the small widgets every family reuses      */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";
  var PALETTE = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa',
                 '#fb923c', '#22d3ee', '#facc15'];

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function round2(v) { return Math.round(v * 100) / 100; }
  function pct(v) { return Math.round(v * 1000) / 10 + '%'; }
  function colour(i) { return PALETTE[i % PALETTE.length]; }

  /* A number box that stays usable while it is being typed into: the model is
     updated leniently on every keystroke, but the field itself is only
     rewritten on blur, so a half-typed "1" of "15" is never snapped to the
     minimum under the visitor's fingers. */
  function numBox(value, min, max, onChange, cls) {
    var el = E('input', 'oa-num' + (cls ? ' ' + cls : ''));
    el.type = 'number';
    el.min = String(min);
    el.max = String(max);
    el.value = String(value);
    el.setAttribute('inputmode', 'numeric');
    function read() {
      var v = parseInt(el.value, 10);
      if (isNaN(v)) return null;
      return Math.max(min, Math.min(max, v));
    }
    el.addEventListener('input', function () {
      var v = read();
      if (v !== null) onChange(v);
    });
    el.addEventListener('blur', function () {
      var v = read();
      if (v === null) v = min;
      el.value = String(v);
      onChange(v);
    });
    return el;
  }

  function textBox(value, onChange, placeholder) {
    var el = E('input', 'oa-text');
    el.type = 'text';
    el.value = value;
    el.spellcheck = false;
    el.autocomplete = 'off';
    if (placeholder) el.placeholder = placeholder;
    el.addEventListener('input', function () { onChange(el.value); });
    return el;
  }

  function selectBox(options, value, onChange) {
    var el = E('select', 'oa-select');
    options.forEach(function (o) {
      var op = E('option', null, o.label);
      op.value = o.key;
      if (o.key === value) op.selected = true;
      el.appendChild(op);
    });
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }

  function button(text, onClick, cls) {
    var el = E('button', 'oa-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }

  function field(labelText, control) {
    var wrap = E('label', 'oa-field');
    wrap.appendChild(E('span', 'oa-field-label', labelText));
    wrap.appendChild(control);
    return wrap;
  }

  function group(title) {
    var box = E('div', 'oa-group');
    box.appendChild(E('p', 'oa-group-title', title));
    return box;
  }

  /* Build a table from a header list and an array of row arrays. Cells may be
     strings or ready-made nodes, and a row may carry a class via row.cls. */
  function table(head, rows, cls) {
    var t = E('table', 'oa-table' + (cls ? ' ' + cls : ''));
    var thead = E('thead'), tr = E('tr');
    head.forEach(function (h) { tr.appendChild(E('th', null, h)); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = E('tbody');
    rows.forEach(function (r) {
      var row = E('tr');
      if (r.cls) row.className = r.cls;
      (r.cells || r).forEach(function (cell) {
        var td = E('td');
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        td.className = 'oa-td';
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return t;
  }

  /* Parse a free-typed list of numbers. Commas, spaces and stray separators
     all work, because a visitor pasting a reference string out of a textbook
     should not have to think about the delimiter. */
  function parseList(text, min, max, limit) {
    var out = [];
    var parts = String(text).split(/[^0-9-]+/);
    for (var i = 0; i < parts.length && out.length < limit; i++) {
      if (parts[i] === '' || parts[i] === '-') continue;
      var v = parseInt(parts[i], 10);
      if (isNaN(v)) continue;
      out.push(Math.max(min, Math.min(max, v)));
    }
    return out;
  }

  /* ======================================================================== */
  /*  FAMILY 1 — CPU SCHEDULING                                               */
  /* ======================================================================== */

  var SCHED_PRESETS = {
    convoy: {
      label: 'The convoy effect',
      quantum: 3,
      procs: [
        { name: 'P1', arrival: 0, burst: 20, priority: 2 },
        { name: 'P2', arrival: 1, burst: 3, priority: 1 },
        { name: 'P3', arrival: 2, burst: 3, priority: 3 },
        { name: 'P4', arrival: 3, burst: 2, priority: 1 }
      ]
    },
    mixed: {
      label: 'Mixed arrivals',
      quantum: 2,
      procs: [
        { name: 'P1', arrival: 0, burst: 5, priority: 3 },
        { name: 'P2', arrival: 1, burst: 3, priority: 1 },
        { name: 'P3', arrival: 2, burst: 8, priority: 4 },
        { name: 'P4', arrival: 3, burst: 6, priority: 2 }
      ]
    },
    starve: {
      label: 'Priority starvation',
      quantum: 2,
      procs: [
        { name: 'Batch', arrival: 0, burst: 9, priority: 9 },
        { name: 'UI-1', arrival: 1, burst: 3, priority: 1 },
        { name: 'UI-2', arrival: 3, burst: 3, priority: 1 },
        { name: 'UI-3', arrival: 6, burst: 3, priority: 1 },
        { name: 'UI-4', arrival: 9, burst: 3, priority: 1 }
      ]
    },
    tiny: {
      label: 'Four short jobs',
      quantum: 1,
      procs: [
        { name: 'A', arrival: 0, burst: 4, priority: 2 },
        { name: 'B', arrival: 0, burst: 2, priority: 1 },
        { name: 'C', arrival: 0, burst: 6, priority: 4 },
        { name: 'D', arrival: 0, burst: 3, priority: 3 }
      ]
    }
  };

  function SchedFamily() {
    this.key = 'sched';
    this.label = 'CPU scheduling';
    this.algoKey = 'srtf';
    this.quantum = 2;
    this.procs = SCHED_PRESETS.mixed.procs.map(function (p) {
      return { name: p.name, arrival: p.arrival, burst: p.burst, priority: p.priority };
    });
    this.result = null;
  }

  SchedFamily.prototype.algoOptions = function () {
    return SCHED_ORDER.map(function (k) { return { key: k, label: SCHED_ALGOS[k].label }; });
  };

  SchedFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.onChange = onChange;

    var g1 = group('Processes');
    this.tableHost = E('div', 'oa-proc-table');
    g1.appendChild(this.tableHost);

    var rowBtns = E('div', 'oa-btnrow');
    rowBtns.appendChild(button('+ Add process', function () {
      if (self.procs.length >= 8) return;
      var n = self.procs.length + 1;
      self.procs.push({ name: 'P' + n, arrival: 0, burst: 4, priority: 2 });
      self.renderProcTable();
      onChange();
    }));
    rowBtns.appendChild(button('− Remove last', function () {
      if (self.procs.length <= 1) return;
      self.procs.pop();
      self.renderProcTable();
      onChange();
    }));
    g1.appendChild(rowBtns);
    host.appendChild(g1);

    var g2 = group('Settings');
    this.quantumField = field('Round robin quantum', numBox(this.quantum, 1, 20, function (v) {
      self.quantum = v;
      onChange();
    }));
    g2.appendChild(this.quantumField);
    host.appendChild(g2);

    var g3 = group('Load an example');
    var presets = E('div', 'oa-btnrow');
    Object.keys(SCHED_PRESETS).forEach(function (k) {
      presets.appendChild(button(SCHED_PRESETS[k].label, function () {
        self.procs = SCHED_PRESETS[k].procs.map(function (p) {
          return { name: p.name, arrival: p.arrival, burst: p.burst, priority: p.priority };
        });
        self.quantum = SCHED_PRESETS[k].quantum;
        self.renderProcTable();
        if (self.quantumField) self.quantumField.querySelector('input').value = String(self.quantum);
        onChange();
      }));
    });
    g3.appendChild(presets);
    host.appendChild(g3);

    this.renderProcTable();
  };

  SchedFamily.prototype.renderProcTable = function () {
    var self = this;
    clear(this.tableHost);
    var rows = this.procs.map(function (p, i) {
      var swatch = E('span', 'oa-swatch');
      swatch.style.background = colour(i);
      var nameCell = E('span', 'oa-namecell');
      nameCell.appendChild(swatch);
      var nameInput = textBox(p.name, function (v) { p.name = v.slice(0, 8) || 'P' + (i + 1); self.onChange(); });
      nameInput.className = 'oa-text oa-text-tiny';
      nameCell.appendChild(nameInput);
      return [
        nameCell,
        numBox(p.arrival, 0, 60, function (v) { p.arrival = v; self.onChange(); }),
        numBox(p.burst, 1, 30, function (v) { p.burst = v; self.onChange(); }),
        numBox(p.priority, 1, 9, function (v) { p.priority = v; self.onChange(); })
      ];
    });
    this.tableHost.appendChild(table(['Process', 'Arrival', 'Burst', 'Prio'], rows, 'oa-table-input'));
  };

  SchedFamily.prototype.buildStage = function (host) {
    this.stage = host;
    this.ganttHost = E('div', 'oa-gantt-wrap');
    this.queueHost = E('div', 'oa-queue');
    this.tableOut = E('div', 'oa-tableout');
    host.appendChild(this.ganttHost);
    host.appendChild(this.queueHost);
    host.appendChild(this.tableOut);
  };

  SchedFamily.prototype.compute = function () {
    this.result = schedule({ procs: this.procs, quantum: this.quantum }, this.algoKey);
    this.error = this.result.complete ? null :
      'This run hit the step limit before every process finished — try smaller bursts.';
    return this.result.frames.length;
  };

  SchedFamily.prototype.render = function (idx) {
    var res = this.result, self = this;
    if (!res) return;
    var frame = res.frames[Math.min(idx, res.frames.length - 1)];
    var now = frame ? frame.t : 0;
    var end = res.timeline.length;

    /* ---- Gantt chart -------------------------------------------------- */
    clear(this.ganttHost);
    var bar = E('div', 'oa-gantt');
    res.slots.forEach(function (s) {
      var seg = E('div', 'oa-seg');
      seg.style.flexGrow = String(s.end - s.start);
      if (s.pid < 0) {
        seg.className = 'oa-seg oa-seg-idle';
        seg.textContent = 'idle';
      } else {
        seg.style.background = colour(s.pid);
        seg.textContent = res.rows[s.pid].name;
      }
      if (s.start > now) seg.classList.add('oa-seg-future');
      else if (s.start <= now && s.end > now) seg.classList.add('oa-seg-now');
      seg.title = (s.pid < 0 ? 'CPU idle' : res.rows[s.pid].name) + ': t=' + s.start + ' to t=' + s.end;
      bar.appendChild(seg);
    });
    this.ganttHost.appendChild(bar);

    var axis = E('div', 'oa-axis');
    res.slots.forEach(function (s) {
      var cell = E('div', 'oa-axis-cell', String(s.start));
      cell.style.flexGrow = String(s.end - s.start);
      axis.appendChild(cell);
    });
    axis.appendChild(E('div', 'oa-axis-end', String(end)));
    this.ganttHost.appendChild(axis);

    /* ---- the live ready queue at this instant -------------------------- */
    clear(this.queueHost);
    var line = E('div', 'oa-queue-line');
    line.appendChild(E('span', 'oa-queue-label', 't = ' + now));
    var runWrap = E('span', 'oa-queue-run');
    runWrap.appendChild(E('span', 'oa-queue-cap', 'on CPU'));
    if (frame && frame.running >= 0) {
      var chip = E('span', 'oa-chip', res.rows[frame.running].name);
      chip.style.background = colour(frame.running);
      chip.style.color = '#04121f';
      runWrap.appendChild(chip);
      if (frame.quantumLeft >= 0) {
        runWrap.appendChild(E('span', 'oa-queue-q', 'quantum left ' + frame.quantumLeft));
      }
    } else {
      runWrap.appendChild(E('span', 'oa-chip oa-chip-idle', 'idle'));
    }
    line.appendChild(runWrap);
    this.queueHost.appendChild(line);

    var qline = E('div', 'oa-queue-line');
    qline.appendChild(E('span', 'oa-queue-cap', this.algoKey === 'rr' ? 'ready queue (front first)' : 'ready, best first'));
    if (frame && frame.ready.length) {
      frame.ready.forEach(function (pid) {
        var c = E('span', 'oa-chip oa-chip-ghost', res.rows[pid].name + ' · ' + frame.remaining[pid] + ' left');
        c.style.borderColor = colour(pid);
        c.style.color = colour(pid);
        qline.appendChild(c);
      });
    } else {
      qline.appendChild(E('span', 'oa-queue-empty', 'empty'));
    }
    this.queueHost.appendChild(qline);

    /* ---- per-process results ------------------------------------------ */
    clear(this.tableOut);
    var rows = res.rows.map(function (r, i) {
      var name = E('span', 'oa-namecell');
      var sw = E('span', 'oa-swatch');
      sw.style.background = colour(i);
      name.appendChild(sw);
      name.appendChild(document.createTextNode(r.name));
      var doneNow = r.completion <= now + 1 && r.completion >= 0;
      return {
        cls: doneNow ? 'oa-row-done' : '',
        cells: [name, r.arrival, r.burst, r.priority, r.start, r.completion,
                r.turnaround, r.waiting, r.response]
      };
    });
    var s = res.summary;
    rows.push({
      cls: 'oa-row-avg',
      cells: ['Average', '', '', '', '', '', round2(s.avgTurnaround), round2(s.avgWaiting), round2(s.avgResponse)]
    });
    this.tableOut.appendChild(table(
      ['Process', 'Arrival', 'Burst', 'Prio', 'Start', 'Finish', 'Turnaround', 'Waiting', 'Response'],
      rows));
  };

  SchedFamily.prototype.note = function (idx) {
    var res = this.result;
    if (!res || !res.frames.length) return '';
    var frame = res.frames[Math.min(idx, res.frames.length - 1)];
    var t = frame.t;
    if (frame.running < 0) {
      return 't = ' + t + ': nothing has arrived yet, so the CPU sits idle. Idle time still counts against utilisation.';
    }
    var name = res.rows[frame.running].name;
    var prev = idx > 0 ? res.frames[idx - 1] : null;
    var startedNow = !prev || prev.running !== frame.running;
    var left = frame.remaining[frame.running];
    var txt = 't = ' + t + ' to ' + (t + 1) + ': ' + name + ' runs';
    if (startedNow && prev && prev.running >= 0 && prev.remaining[prev.running] > 0) {
      txt += ', taking the CPU from ' + res.rows[prev.running].name +
             (this.algoKey === 'rr' ? ' whose quantum expired' : ' — a preemption');
    } else if (startedNow) {
      txt += ' — it is chosen because ' + this.pickReason();
    }
    txt += '. ' + (left === 0 ? name + ' finishes here.' : left + ' unit' + (left === 1 ? '' : 's') + ' left.');
    if (frame.ready.length) txt += ' ' + frame.ready.length + ' process' + (frame.ready.length === 1 ? '' : 'es') + ' waiting.';
    return txt;
  };

  SchedFamily.prototype.pickReason = function () {
    switch (this.algoKey) {
      case 'fcfs': return 'it arrived first';
      case 'sjf': return 'it has the shortest total burst of everything that has arrived';
      case 'srtf': return 'it has the least remaining time of everything that has arrived';
      case 'rr': return 'it was at the front of the ready queue';
      case 'prio': return 'it has the best priority number of everything that has arrived';
      default: return 'it has the best priority number right now';
    }
  };

  SchedFamily.prototype.compare = function () {
    var self = this;
    return {
      head: ['Algorithm', 'Avg waiting', 'Avg turnaround', 'Avg response', 'Switches', 'CPU busy'],
      rows: SCHED_ORDER.map(function (k) {
        var r = schedule({ procs: self.procs, quantum: self.quantum }, k);
        return {
          key: k,
          cells: [SCHED_ALGOS[k].label, round2(r.summary.avgWaiting), round2(r.summary.avgTurnaround),
                  round2(r.summary.avgResponse), r.summary.switches, pct(r.summary.utilisation)]
        };
      }),
      best: 1, lower: true
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — PAGE REPLACEMENT                                             */
  /* ======================================================================== */

  var PAGE_PRESETS = {
    belady: { label: 'Belady anomaly', refs: '1 2 3 4 1 2 5 1 2 3 4 5', frames: 3 },
    classic: { label: 'Classic string', refs: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', frames: 3 },
    loop: { label: 'A loop too big to fit', refs: '1 2 3 4 5 1 2 3 4 5 1 2 3 4 5', frames: 4 },
    local: { label: 'Good locality', refs: '1 1 2 1 3 2 1 4 2 1 5 1 2 1', frames: 3 }
  };

  function PageFamily() {
    this.key = 'page';
    this.label = 'Page replacement';
    this.algoKey = 'lru';
    this.refText = PAGE_PRESETS.classic.refs;
    this.frameCount = 3;
  }

  PageFamily.prototype.algoOptions = function () {
    return PAGE_ORDER.map(function (k) { return { key: k, label: PAGE_ALGOS[k].label }; });
  };

  PageFamily.prototype.refs = function () { return parseList(this.refText, 0, 99, 40); };

  PageFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Reference string');
    this.refInput = textBox(this.refText, function (v) { self.refText = v; onChange(); },
                            'e.g. 7 0 1 2 0 3 0 4');
    this.refInput.className = 'oa-text oa-text-wide';
    g1.appendChild(this.refInput);
    g1.appendChild(E('p', 'oa-hint', 'Any separator works. Up to 40 references, pages 0-99.'));
    host.appendChild(g1);

    var g2 = group('Memory');
    this.framesField = field('Frames', numBox(this.frameCount, 1, 6, function (v) {
      self.frameCount = v;
      onChange();
    }));
    g2.appendChild(this.framesField);
    g2.appendChild(E('p', 'oa-hint', 'Add a frame and watch the fault count fall — except under FIFO, where it sometimes rises.'));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var presets = E('div', 'oa-btnrow');
    Object.keys(PAGE_PRESETS).forEach(function (k) {
      presets.appendChild(button(PAGE_PRESETS[k].label, function () {
        self.refText = PAGE_PRESETS[k].refs;
        self.frameCount = PAGE_PRESETS[k].frames;
        self.refInput.value = self.refText;
        self.framesField.querySelector('input').value = String(self.frameCount);
        onChange();
      }));
    });
    g3.appendChild(presets);
    host.appendChild(g3);
  };

  PageFamily.prototype.buildStage = function (host) {
    this.gridHost = E('div', 'oa-scroll');
    this.tableOut = E('div', 'oa-tableout');
    host.appendChild(this.gridHost);
    host.appendChild(this.tableOut);
  };

  PageFamily.prototype.compute = function () {
    var refs = this.refs();
    this.error = refs.length ? null : 'Type a reference string — a list of page numbers.';
    this.result = pageReplace(refs, this.frameCount, this.algoKey);
    return this.result.steps.length;
  };

  PageFamily.prototype.render = function (idx) {
    var res = this.result;
    clear(this.gridHost);
    clear(this.tableOut);
    if (!res || !res.steps.length) return;
    var cur = Math.min(idx, res.steps.length - 1);

    var grid = E('table', 'oa-table oa-pagegrid');
    var thead = E('thead'), hr = E('tr');
    hr.appendChild(E('th', 'oa-sticky', 'Reference'));
    res.steps.forEach(function (s, i) {
      var th = E('th', 'oa-pagecol' + (i === cur ? ' oa-col-now' : (i > cur ? ' oa-col-future' : '')), String(s.page));
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    grid.appendChild(thead);

    var tbody = E('tbody');
    for (var f = 0; f < res.frameCount; f++) {
      var tr = E('tr');
      tr.appendChild(E('th', 'oa-sticky', 'Frame ' + f));
      for (var i = 0; i < res.steps.length; i++) {
        var s = res.steps[i];
        var td = E('td', 'oa-pagecell');
        if (i > cur) {
          td.className += ' oa-col-future';
        } else if (s.frames[f] !== null) {
          td.textContent = String(s.frames[f]);
          if (s.slot === f) td.className += s.hit ? ' oa-cell-hit' : ' oa-cell-load';
          if (s.meta[f]) td.title = s.meta[f];
          if (s.hand === f && !s.hit) td.className += ' oa-cell-hand';
        }
        if (i === cur) td.className += ' oa-col-now';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    var fr = E('tr', 'oa-faultrow');
    fr.appendChild(E('th', 'oa-sticky', 'Fault?'));
    res.steps.forEach(function (s, i) {
      var td = E('td', 'oa-pagecell ' + (i > cur ? 'oa-col-future' : (s.hit ? 'oa-mark-hit' : 'oa-mark-fault')));
      td.textContent = i > cur ? '' : (s.hit ? '·' : 'F');
      if (i === cur) td.className += ' oa-col-now';
      fr.appendChild(td);
    });
    tbody.appendChild(fr);
    grid.appendChild(tbody);
    this.gridHost.appendChild(grid);

    var s2 = res.steps[cur];
    this.tableOut.appendChild(table(
      ['Faults so far', 'Hits so far', 'References so far', 'Fault rate so far'],
      [[s2.faults, s2.hits, cur + 1, pct(s2.faults / (cur + 1))]]));
  };

  PageFamily.prototype.note = function (idx) {
    var res = this.result;
    if (!res || !res.steps.length) return '';
    var s = res.steps[Math.min(idx, res.steps.length - 1)];
    if (s.hit) {
      return 'Reference ' + s.page + ' is already in frame ' + s.slot + ' — a hit, and no disk read.' +
             (this.algoKey === 'clock' ? ' Its reference bit is set back to 1, buying it a second chance.' : '');
    }
    if (s.evicted === null) {
      return 'Reference ' + s.page + ' is not resident and frame ' + s.slot +
             ' was still empty, so this is a compulsory fault — unavoidable on first touch.';
    }
    return 'Reference ' + s.page + ' faults. ' + this.victimReason(s) +
           ' Page ' + s.evicted + ' is evicted from frame ' + s.slot + ' and ' + s.page + ' takes its place.';
  };

  PageFamily.prototype.victimReason = function (s) {
    switch (this.algoKey) {
      case 'fifo': return 'FIFO evicts whichever page has been resident longest, regardless of use.';
      case 'lru': return 'LRU evicts the page that has gone unused the longest.';
      case 'opt': return 'OPT looks ahead and evicts the page whose next use is furthest away.';
      case 'clock': return 'The clock hand sweeps, clearing reference bits until it finds one already 0.';
      default: return 'LFU evicts the page referenced fewest times, oldest first on a tie.';
    }
  };

  PageFamily.prototype.compare = function () {
    var refs = this.refs(), self = this;
    return {
      head: ['Algorithm', 'Faults', 'Hits', 'Fault rate'],
      rows: PAGE_ORDER.map(function (k) {
        var r = pageReplace(refs, self.frameCount, k);
        return { key: k, cells: [PAGE_ALGOS[k].label, r.summary.faults, r.summary.hits, pct(r.summary.faultRate)] };
      }),
      best: 1, lower: true
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — DISK SCHEDULING                                              */
  /* ------------------------------------------------------------------------ */
  /*  The only family drawn on a canvas, because the thing worth seeing is a   */
  /*  shape: the sawtooth of FCFS against the single sweep of SCAN. A table of */
  /*  the same numbers hides exactly the property the policies are about.      */
  /* ======================================================================== */

  var DISK_PRESETS = {
    classic: { label: 'Classic queue', reqs: '98 183 37 122 14 124 65 67', head: 53, max: 199 },
    spread: { label: 'Wide spread', reqs: '176 79 34 60 92 11 41 114', head: 50, max: 199 },
    clustered: { label: 'Two clusters', reqs: '10 12 14 16 180 182 184 186', head: 100, max: 199 },
    starve: { label: 'Starving the edge', reqs: '95 100 105 98 102 5 195', head: 100, max: 199 }
  };

  function DiskFamily() {
    this.key = 'disk';
    this.label = 'Disk scheduling';
    this.algoKey = 'scan';
    this.reqText = DISK_PRESETS.classic.reqs;
    this.head = 53;
    this.maxCyl = 199;
    this.up = true;
    this.lastIdx = 0;
  }

  DiskFamily.prototype.algoOptions = function () {
    return DISK_ORDER.map(function (k) { return { key: k, label: DISK_ALGOS[k].label }; });
  };

  DiskFamily.prototype.reqs = function () {
    var self = this;
    return parseList(this.reqText, 0, this.maxCyl, 20).filter(function (v) { return v <= self.maxCyl; });
  };

  DiskFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Request queue');
    this.reqInput = textBox(this.reqText, function (v) { self.reqText = v; onChange(); },
                            'e.g. 98 183 37 122');
    this.reqInput.className = 'oa-text oa-text-wide';
    g1.appendChild(this.reqInput);
    g1.appendChild(E('p', 'oa-hint', 'Cylinder numbers, in the order they were requested. Up to 20.'));
    host.appendChild(g1);

    var g2 = group('The head');
    this.headField = field('Starts at cylinder', numBox(this.head, 0, 999, function (v) {
      self.head = Math.min(v, self.maxCyl);
      onChange();
    }));
    g2.appendChild(this.headField);
    this.maxField = field('Last cylinder', numBox(this.maxCyl, 9, 999, function (v) {
      self.maxCyl = v;
      if (self.head > v) self.head = v;
      onChange();
    }));
    g2.appendChild(this.maxField);
    this.dirField = field('Moving', selectBox(
      [{ key: 'up', label: 'Toward higher cylinders' }, { key: 'down', label: 'Toward lower cylinders' }],
      'up', function (v) { self.up = v === 'up'; onChange(); }));
    g2.appendChild(this.dirField);
    g2.appendChild(E('p', 'oa-hint', 'Direction only matters to SCAN, C-SCAN, LOOK and C-LOOK.'));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var presets = E('div', 'oa-btnrow');
    Object.keys(DISK_PRESETS).forEach(function (k) {
      presets.appendChild(button(DISK_PRESETS[k].label, function () {
        var p = DISK_PRESETS[k];
        self.reqText = p.reqs;
        self.head = p.head;
        self.maxCyl = p.max;
        self.reqInput.value = p.reqs;
        self.headField.querySelector('input').value = String(p.head);
        self.maxField.querySelector('input').value = String(p.max);
        onChange();
      }));
    });
    g3.appendChild(presets);
    host.appendChild(g3);
  };

  DiskFamily.prototype.buildStage = function (host) {
    var self = this;
    this.canvas = E('canvas', 'oa-canvas');
    this.canvas.id = 'viz-disk-canvas';
    host.appendChild(this.canvas);
    this.tableOut = E('div', 'oa-tableout');
    host.appendChild(this.tableOut);
    // Fullscreen dispatches a resize, and the canvas backing store has to be
    // rebuilt at the new size or the plot comes back blurry and clipped.
    window.addEventListener('resize', function () { self.draw(self.lastIdx); });
  };

  DiskFamily.prototype.compute = function () {
    var reqs = this.reqs();
    this.error = reqs.length ? null : 'Type a request queue — a list of cylinder numbers.';
    this.result = diskSchedule(reqs, this.head, this.maxCyl, this.up, this.algoKey);
    return Math.max(1, this.result.segments.length);
  };

  DiskFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    this.draw(idx);
    clear(this.tableOut);
    var res = this.result;
    if (!res) return;
    var cur = Math.min(idx, res.segments.length - 1);
    var soFar = 0;
    for (var i = 0; i <= cur && i < res.segments.length; i++) soFar += res.segments[i].dist;
    this.tableOut.appendChild(table(
      ['Seeks done', 'Movement so far', 'Total movement', 'Average seek'],
      [[(cur + 1) + ' of ' + res.segments.length, soFar + ' cyl', res.summary.total + ' cyl',
        round2(res.summary.average) + ' cyl']]));
  };

  DiskFamily.prototype.draw = function (idx) {
    var res = this.result, canvas = this.canvas;
    if (!canvas || !res) return;
    // A resize can fire while this family's tab is hidden, where the canvas
    // measures zero. Painting then would size the backing store from the
    // fallback and leave a stale image; the tab switch redraws anyway.
    if (!canvas.clientWidth) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight || 320;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = C.bg0;
    g.fillRect(0, 0, w, h);

    var padL = 44, padR = 22, padT = 30, padB = 26;
    var plotW = Math.max(40, w - padL - padR);
    var plotH = Math.max(40, h - padT - padB);
    var maxCyl = Math.max(1, res.maxCyl);
    var steps = res.path.length - 1;

    function X(cyl) { return padL + (cyl / maxCyl) * plotW; }
    function Y(step) { return padT + (steps <= 0 ? 0 : (step / steps) * plotH); }

    g.font = '11px ' + FONT;
    g.textBaseline = 'middle';

    // cylinder axis across the top
    g.strokeStyle = 'rgba(125,211,252,0.18)';
    g.fillStyle = C.faint;
    g.lineWidth = 1;
    var ticks = 5, i;
    for (i = 0; i <= ticks; i++) {
      var cyl = Math.round(maxCyl * i / ticks);
      var x = X(cyl);
      g.beginPath();
      g.moveTo(x, padT - 8);
      g.lineTo(x, h - padB + 4);
      g.stroke();
      g.textAlign = i === 0 ? 'left' : (i === ticks ? 'right' : 'center');
      g.fillText(String(cyl), x, padT - 16);
    }
    g.textAlign = 'left';
    g.fillStyle = C.dim;
    g.fillText('cylinder', padL, h - padB + 14);
    g.textAlign = 'right';
    g.fillText('time down the page', w - padR, h - padB + 14);

    var cur = Math.min(idx, steps - 1);
    // the path itself: solid where the head serviced requests, dashed on a
    // circular policy's jump back, dim where it has not travelled yet
    for (i = 0; i < steps; i++) {
      var seg = res.segments[i];
      var done = i <= cur;
      g.beginPath();
      g.setLineDash(seg.jump ? [5, 4] : []);
      g.strokeStyle = done ? (seg.jump ? C.amber : C.blue) : 'rgba(148,163,184,0.22)';
      g.lineWidth = done ? 2 : 1;
      g.moveTo(X(seg.from), Y(i));
      g.lineTo(X(seg.to), Y(i + 1));
      g.stroke();
    }
    g.setLineDash([]);

    // stops
    for (i = 0; i < res.path.length; i++) {
      var px = X(res.path[i]), py = Y(i);
      var active = i <= cur + 1;
      g.beginPath();
      g.arc(px, py, i === 0 ? 5 : 4, 0, Math.PI * 2);
      g.fillStyle = i === 0 ? C.green : (active ? C.cyan : 'rgba(148,163,184,0.3)');
      g.fill();
      if (i === cur + 1) {
        g.beginPath();
        g.arc(px, py, 8, 0, Math.PI * 2);
        g.strokeStyle = C.amber;
        g.lineWidth = 2;
        g.stroke();
      }
      if (active) {
        g.fillStyle = i === 0 ? C.green : C.ink;
        g.textAlign = px > padL + plotW * 0.82 ? 'right' : 'left';
        g.fillText(i === 0 ? 'head ' + res.path[i] : String(res.path[i]),
                   px + (px > padL + plotW * 0.82 ? -9 : 9), py);
      }
    }
  };

  DiskFamily.prototype.note = function (idx) {
    var res = this.result;
    if (!res || !res.segments.length) return '';
    var cur = Math.min(idx, res.segments.length - 1);
    var s = res.segments[cur];
    var txt = 'Seek ' + (cur + 1) + ': the head moves from ' + s.from + ' to ' + s.to +
              ' — ' + s.dist + ' cylinder' + (s.dist === 1 ? '' : 's') + '.';
    if (s.jump) txt += ' This is the return jump of a circular policy: nothing is serviced along it, which is the price of the fairer wait.';
    else if (/^end /.test(s.label)) txt += ' SCAN runs all the way to the end of the disk before turning, even with no request there — LOOK is the same policy without this wasted travel.';
    return txt;
  };

  DiskFamily.prototype.compare = function () {
    var reqs = this.reqs(), self = this;
    return {
      head: ['Algorithm', 'Total movement', 'Seeks', 'Average seek'],
      rows: DISK_ORDER.map(function (k) {
        var r = diskSchedule(reqs, self.head, self.maxCyl, self.up, k);
        return { key: k, cells: [DISK_ALGOS[k].label, r.summary.total + ' cyl', r.summary.seeks,
                                 round2(r.summary.average) + ' cyl'] };
      }),
      best: 1, lower: true
    };
  };

  /* ======================================================================== */
  /*  FAMILY 4 — MEMORY ALLOCATION                                            */
  /* ======================================================================== */

  var MEM_PRESETS = {
    classic: { label: 'Classic exercise', blocks: '100 500 200 300 600', procs: '212 417 112 426' },
    slivers: { label: 'Best fit leaves slivers', blocks: '110 120 130 140', procs: '100 105 115 135' },
    tight: { label: 'Not enough room', blocks: '50 200 70 115 15', procs: '175 90 205 60' },
    next: { label: 'Next fit walks on', blocks: '300 150 400 200 250', procs: '120 280 130 190' }
  };

  function MemFamily() {
    this.key = 'mem';
    this.label = 'Memory allocation';
    this.algoKey = 'first';
    this.blockText = MEM_PRESETS.classic.blocks;
    this.procText = MEM_PRESETS.classic.procs;
  }

  MemFamily.prototype.algoOptions = function () {
    return MEM_ORDER.map(function (k) { return { key: k, label: MEM_ALGOS[k].label }; });
  };

  MemFamily.prototype.blocks = function () { return parseList(this.blockText, 1, 9999, 10); };
  MemFamily.prototype.procs = function () { return parseList(this.procText, 1, 9999, 10); };

  MemFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g1 = group('Free blocks (KB)');
    this.blockInput = textBox(this.blockText, function (v) { self.blockText = v; onChange(); },
                              'e.g. 100 500 200 300 600');
    this.blockInput.className = 'oa-text oa-text-wide';
    g1.appendChild(this.blockInput);
    host.appendChild(g1);

    var g2 = group('Processes (KB, in order)');
    this.procInput = textBox(this.procText, function (v) { self.procText = v; onChange(); },
                             'e.g. 212 417 112 426');
    this.procInput.className = 'oa-text oa-text-wide';
    g2.appendChild(this.procInput);
    g2.appendChild(E('p', 'oa-hint', 'Fixed partitions: one process per block, and whatever it does not use inside that block is wasted.'));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var presets = E('div', 'oa-btnrow');
    Object.keys(MEM_PRESETS).forEach(function (k) {
      presets.appendChild(button(MEM_PRESETS[k].label, function () {
        self.blockText = MEM_PRESETS[k].blocks;
        self.procText = MEM_PRESETS[k].procs;
        self.blockInput.value = self.blockText;
        self.procInput.value = self.procText;
        onChange();
      }));
    });
    g3.appendChild(presets);
    host.appendChild(g3);
  };

  MemFamily.prototype.buildStage = function (host) {
    this.blockHost = E('div', 'oa-blocks');
    this.tableOut = E('div', 'oa-tableout');
    host.appendChild(this.blockHost);
    host.appendChild(this.tableOut);
  };

  MemFamily.prototype.compute = function () {
    var blocks = this.blocks(), procs = this.procs();
    this.error = (blocks.length && procs.length) ? null :
      'Give at least one free block and one process size.';
    this.result = memAllocate(blocks, procs, this.algoKey);
    return Math.max(1, this.result.steps.length);
  };

  MemFamily.prototype.render = function (idx) {
    var res = this.result;
    clear(this.blockHost);
    clear(this.tableOut);
    if (!res || !res.steps.length) return;
    var cur = Math.min(idx, res.steps.length - 1);
    var step = res.steps[cur];
    var widest = 1;
    step.blocks.forEach(function (b) { if (b.size > widest) widest = b.size; });

    step.blocks.forEach(function (b, i) {
      var row = E('div', 'oa-block-row');
      row.appendChild(E('span', 'oa-block-name', 'Block ' + i));
      var track = E('div', 'oa-block-track');
      track.style.width = Math.max(8, (b.size / widest) * 100) + '%';
      if (b.proc >= 0) {
        var fill = E('div', 'oa-block-fill');
        fill.style.width = Math.min(100, (b.used / b.size) * 100) + '%';
        fill.style.background = colour(b.proc);
        fill.textContent = 'P' + b.proc + ' · ' + b.used + 'K';
        track.appendChild(fill);
        if (b.size > b.used) {
          var waste = E('div', 'oa-block-waste', (b.size - b.used) + 'K wasted');
          track.appendChild(waste);
        }
      } else {
        track.appendChild(E('div', 'oa-block-free', b.size + 'K free'));
      }
      if (step.chosen === i) row.className += ' oa-block-chosen';
      else if (step.considered.indexOf(i) >= 0 && step.chosen !== i) row.className += ' oa-block-looked';
      row.appendChild(track);
      row.appendChild(E('span', 'oa-block-size', b.size + 'K'));
      this.blockHost.appendChild(row);
    }, this);

    var s = res.summary;
    this.tableOut.appendChild(table(
      ['Placed', 'Could not fit', 'Internal waste', 'Whole blocks left', 'Memory'],
      [[s.placed + ' of ' + res.procs.length, s.failed, s.internal + 'K',
        s.freeBlocks + ' (' + s.freeBytes + 'K)', s.totalMemory + 'K']]));
  };

  MemFamily.prototype.note = function (idx) {
    var res = this.result;
    if (!res || !res.steps.length) return '';
    var s = res.steps[Math.min(idx, res.steps.length - 1)];
    if (s.chosen < 0) {
      return 'P' + s.proc + ' needs ' + s.size + 'K and no free block is big enough, so it waits. ' +
             'There may be plenty of memory left — just not in one piece. That is external fragmentation.';
    }
    var b = s.blocks[s.chosen];
    var waste = b.size - b.used;
    var txt = 'P' + s.proc + ' (' + s.size + 'K) goes into block ' + s.chosen + ' of ' + b.size + 'K — ' + this.fitReason() + '.';
    if (waste > 0) txt += ' ' + waste + 'K inside that block is now unusable by anyone else: internal fragmentation.';
    else txt += ' It fits exactly, with nothing wasted.';
    return txt;
  };

  MemFamily.prototype.fitReason = function () {
    switch (this.algoKey) {
      case 'first': return 'first fit takes the first block from the top that is big enough';
      case 'best': return 'best fit takes the smallest block that is big enough';
      case 'worst': return 'worst fit takes the largest block, on the theory that the leftover is big enough to be useful';
      default: return 'next fit carries on from where the last search stopped instead of restarting at the top';
    }
  };

  MemFamily.prototype.compare = function () {
    var blocks = this.blocks(), procs = this.procs();
    return {
      head: ['Algorithm', 'Placed', 'Failed', 'Internal waste', 'Blocks left'],
      rows: MEM_ORDER.map(function (k) {
        var r = memAllocate(blocks, procs, k);
        return { key: k, cells: [MEM_ALGOS[k].label, r.summary.placed, r.summary.failed,
                                 r.summary.internal + 'K', r.summary.freeBlocks] };
      }),
      best: 3, lower: true
    };
  };

  /* ======================================================================== */
  /*  FAMILY 5 — BANKER'S ALGORITHM                                           */
  /* ======================================================================== */

  var BANK_DEFAULT = {
    names: ['P0', 'P1', 'P2', 'P3', 'P4'],
    res: ['A', 'B', 'C'],
    avail: [3, 3, 2],
    alloc: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
    max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]]
  };

  function BankFamily() {
    this.key = 'bank';
    this.label = 'Deadlock (Banker)';
    this.algoKey = 'safety';
    this.avail = BANK_DEFAULT.avail.slice();
    this.alloc = BANK_DEFAULT.alloc.map(function (r) { return r.slice(); });
    this.max = BANK_DEFAULT.max.map(function (r) { return r.slice(); });
    this.names = BANK_DEFAULT.names.slice();
    this.res = BANK_DEFAULT.res.slice();
    this.reqProc = 1;
    this.request = [1, 0, 2];
  }

  BankFamily.prototype.algoOptions = function () {
    return [{ key: 'safety', label: 'Safety check (is this state safe?)' }];
  };

  BankFamily.prototype.resize = function (n, m) {
    var i, j;
    this.names = [];
    for (i = 0; i < n; i++) this.names.push('P' + i);
    this.res = ['A', 'B', 'C', 'D'].slice(0, m);
    for (i = 0; i < n; i++) {
      if (!this.alloc[i]) this.alloc[i] = [];
      if (!this.max[i]) this.max[i] = [];
      for (j = 0; j < m; j++) {
        if (this.alloc[i][j] == null) this.alloc[i][j] = 0;
        if (this.max[i][j] == null) this.max[i][j] = this.alloc[i][j];
      }
      this.alloc[i].length = m;
      this.max[i].length = m;
    }
    this.alloc.length = n;
    this.max.length = n;
    for (j = 0; j < m; j++) if (this.avail[j] == null) this.avail[j] = 0;
    this.avail.length = m;
    for (j = 0; j < m; j++) if (this.request[j] == null) this.request[j] = 0;
    this.request.length = m;
    if (this.reqProc >= n) this.reqProc = 0;
  };

  BankFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.onChange = onChange;

    var g0 = group('Size');
    g0.appendChild(field('Processes', numBox(this.alloc.length, 2, 6, function (v) {
      self.resize(v, self.avail.length);
      self.renderMatrices();
      onChange();
    })));
    g0.appendChild(field('Resource types', numBox(this.avail.length, 2, 4, function (v) {
      self.resize(self.alloc.length, v);
      self.renderMatrices();
      onChange();
    })));
    host.appendChild(g0);

    var g1 = group('State');
    this.matrixHost = E('div', 'oa-matrices');
    g1.appendChild(this.matrixHost);
    host.appendChild(g1);

    var g2 = group('Test a request');
    this.reqHost = E('div', 'oa-reqbox');
    g2.appendChild(this.reqHost);
    g2.appendChild(E('p', 'oa-hint', 'Banker refuses a request that would leave an unsafe state, even when the resources are sitting free.'));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var presets = E('div', 'oa-btnrow');
    presets.appendChild(button('Textbook safe state', function () {
      self.avail = BANK_DEFAULT.avail.slice();
      self.alloc = BANK_DEFAULT.alloc.map(function (r) { return r.slice(); });
      self.max = BANK_DEFAULT.max.map(function (r) { return r.slice(); });
      self.resize(5, 3);
      self.reqProc = 1;
      self.request = [1, 0, 2];
      self.renderMatrices();
      onChange();
    }));
    presets.appendChild(button('An unsafe state', function () {
      self.avail = [1, 1, 0];
      self.alloc = [[0, 1, 0], [3, 0, 2], [3, 0, 2], [2, 1, 1], [0, 0, 2]];
      self.max = [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]];
      self.resize(5, 3);
      self.reqProc = 0;
      self.request = [0, 2, 0];
      self.renderMatrices();
      onChange();
    }));
    g3.appendChild(presets);
    host.appendChild(g3);

    this.renderMatrices();
  };

  BankFamily.prototype.renderMatrices = function () {
    var self = this, i;
    clear(this.matrixHost);

    function matrix(title, data) {
      var box = E('div', 'oa-matrix');
      box.appendChild(E('p', 'oa-matrix-title', title));
      var rows = data.map(function (row, r) {
        var cells = [self.names[r]];
        row.forEach(function (v, c) {
          cells.push(numBox(v, 0, 99, function (nv) { data[r][c] = nv; self.onChange(); }, 'oa-num-tiny'));
        });
        return cells;
      });
      box.appendChild(table([''].concat(self.res), rows, 'oa-table-input'));
      return box;
    }

    this.matrixHost.appendChild(matrix('Allocation — held now', this.alloc));
    this.matrixHost.appendChild(matrix('Maximum — could ever need', this.max));

    var availBox = E('div', 'oa-matrix');
    availBox.appendChild(E('p', 'oa-matrix-title', 'Available'));
    var availRow = [''];
    this.avail.forEach(function (v, c) {
      availRow.push(numBox(v, 0, 99, function (nv) { self.avail[c] = nv; self.onChange(); }, 'oa-num-tiny'));
    });
    availBox.appendChild(table([''].concat(this.res), [availRow], 'oa-table-input'));
    this.matrixHost.appendChild(availBox);

    clear(this.reqHost);
    var line = E('div', 'oa-reqline');
    line.appendChild(selectBox(this.names.map(function (n, i2) { return { key: String(i2), label: n }; }),
      String(this.reqProc), function (v) { self.reqProc = parseInt(v, 10); self.onChange(); }));
    line.appendChild(E('span', 'oa-req-word', 'requests'));
    this.request.forEach(function (v, c) {
      line.appendChild(numBox(v, 0, 99, function (nv) { self.request[c] = nv; self.onChange(); }, 'oa-num-tiny'));
    });
    this.reqHost.appendChild(line);
    this.reqVerdict = E('div', 'oa-verdict');
    this.reqHost.appendChild(this.reqVerdict);
  };

  BankFamily.prototype.buildStage = function (host) {
    this.needHost = E('div', 'oa-tableout');
    this.stepHost = E('div', 'oa-banksteps');
    this.tableOut = E('div', 'oa-tableout');
    host.appendChild(this.needHost);
    host.appendChild(this.stepHost);
    host.appendChild(this.tableOut);
  };

  BankFamily.prototype.compute = function () {
    this.result = bankers(this.alloc, this.max, this.avail, this.names);
    this.error = this.result.error || null;

    if (!this.result.error && this.reqVerdict) {
      var verdict = bankRequest(this.result, this.reqProc, this.request);
      clear(this.reqVerdict);
      var tag = E('span', 'oa-tag ' + (verdict.granted ? 'oa-tag-ok' : 'oa-tag-no'),
                  verdict.granted ? 'Granted' : 'Refused');
      this.reqVerdict.appendChild(tag);
      this.reqVerdict.appendChild(E('span', 'oa-verdict-text', verdict.reason));
    } else if (this.reqVerdict) {
      clear(this.reqVerdict);
    }

    return Math.max(1, (this.result.steps || []).length);
  };

  BankFamily.prototype.render = function (idx) {
    var res = this.result, self = this;
    clear(this.needHost);
    clear(this.stepHost);
    clear(this.tableOut);
    if (!res || res.error) return;

    var head = [''].concat(res.names ? this.res : this.res);
    var needRows = res.need.map(function (row, i) {
      return { cells: [self.names[i]].concat(row.map(String)) };
    });
    var needBox = E('div', 'oa-matrix');
    needBox.appendChild(E('p', 'oa-matrix-title', 'Need = Maximum − Allocation'));
    needBox.appendChild(table(head, needRows));
    this.needHost.appendChild(needBox);

    var cur = Math.min(idx, res.steps.length - 1);
    for (var i = 0; i <= cur; i++) {
      var s = res.steps[i];
      var card = E('div', 'oa-bankstep' + (i === cur ? ' oa-bankstep-now' : ''));
      card.appendChild(E('span', 'oa-bankstep-n', 'Round ' + (i + 1)));
      card.appendChild(E('span', 'oa-bankstep-work', 'Work = [' + s.work.join(' ') + ']'));
      var list = E('span', 'oa-bankstep-list');
      s.checked.forEach(function (c) {
        var chip = E('span', 'oa-chip ' + (c.ok ? 'oa-chip-ok' : 'oa-chip-no'),
                     self.names[c.proc] + ' need [' + c.need.join(' ') + ']' + (c.ok ? ' ✓' : ' ✗'));
        list.appendChild(chip);
      });
      card.appendChild(list);
      if (s.chosen >= 0) {
        card.appendChild(E('span', 'oa-bankstep-out',
          self.names[s.chosen] + ' can finish and returns [' + self.alloc[s.chosen].join(' ') +
          '] → Work = [' + s.workAfter.join(' ') + ']'));
      } else {
        card.appendChild(E('span', 'oa-bankstep-out oa-bankstep-bad',
          'Nothing left can be satisfied — the state is unsafe.'));
      }
      this.stepHost.appendChild(card);
    }

    var verdict = E('div', 'oa-tableout');
    verdict.appendChild(table(
      ['Verdict', 'Safe sequence'],
      [[res.safe ? 'SAFE' : 'UNSAFE',
        res.safe ? res.sequence.map(function (i2) { return self.names[i2]; }).join(' → ')
                 : 'none exists']]));
    this.tableOut.appendChild(verdict);
  };

  BankFamily.prototype.note = function (idx) {
    var res = this.result;
    if (!res) return '';
    if (res.error) return res.error;
    var cur = Math.min(idx, res.steps.length - 1);
    var s = res.steps[cur];
    if (s.chosen < 0) {
      return 'Round ' + (cur + 1) + ': every unfinished process needs more of something than Work holds, ' +
             'so the search is stuck. The state is unsafe — not deadlocked yet, but there is no order ' +
             'that guarantees everyone can finish.';
    }
    return 'Round ' + (cur + 1) + ': Work is [' + s.work.join(' ') + ']. ' + this.names[s.chosen] +
           ' is the first process whose Need fits inside it, so it is assumed to run, finish, and hand ' +
           'back everything it holds — Work becomes [' + s.workAfter.join(' ') + '].';
  };

  BankFamily.prototype.compare = function () { return null; };

  /* ======================================================================== */
  /*  SCOPED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Injected rather than added to labs.css because every selector here is    */
  /*  meaningless outside this one lab, and keeping them next to the markup    */
  /*  that generates them is the only way they stay in step. style-src allows  */
  /*  'unsafe-inline' for stylesheets, so a <style> node is permitted; script  */
  /*  is not, which is why nothing here is eval'd.                             */
  /* ======================================================================== */

  var CSS = [
    '#osalgoviz .oa-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    '#osalgoviz .oa-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,0.6);}',
    '#osalgoviz .oa-tab{font:inherit;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#osalgoviz .oa-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#osalgoviz .oa-tab.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#osalgoviz .oa-body{display:grid;grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start;}',
    '#osalgoviz .oa-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,0.6);min-width:0;}',
    '#osalgoviz .oa-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '@media (max-width:900px){#osalgoviz .oa-body{grid-template-columns:minmax(0,1fr);}' +
      '#osalgoviz .oa-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',

    '#osalgoviz .oa-group{margin:0 0 14px;}',
    '#osalgoviz .oa-group-title{margin:0 0 7px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#osalgoviz .oa-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 7px;}',
    '#osalgoviz .oa-field-label{color:' + C.dim + ';font-size:12px;}',
    '#osalgoviz .oa-num{width:3.9rem;font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:4px 6px;text-align:right;}',
    '#osalgoviz .oa-num-tiny{width:3.1rem;}',
    '#osalgoviz .oa-text{width:100%;font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:6px 8px;}',
    '#osalgoviz .oa-text-tiny{width:4.2rem;padding:3px 5px;}',
    '#osalgoviz .oa-select{font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:100%;}',
    '#osalgoviz .oa-num:focus,#osalgoviz .oa-text:focus,#osalgoviz .oa-select:focus{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#osalgoviz .oa-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;}',
    '#osalgoviz .oa-btn:hover{background:#213152;border-color:#40608f;}',
    '#osalgoviz .oa-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';}',
    '#osalgoviz .oa-btn[disabled]{opacity:.4;cursor:default;}',
    '#osalgoviz .oa-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '#osalgoviz .oa-hint{margin:6px 0 0;font-size:11px;line-height:1.55;color:' + C.faint + ';}',

    '#osalgoviz .oa-table{width:100%;border-collapse:collapse;font-size:12px;}',
    '#osalgoviz .oa-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#osalgoviz .oa-td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,0.6);color:' + C.ink + ';white-space:nowrap;}',
    '#osalgoviz .oa-table-input .oa-td{padding:3px 4px;}',
    /* The control column is narrow, and the input tables (four number boxes
       plus a name, or an n-by-m Banker matrix) are wider than it on a phone
       and even on a laptop. They scroll inside themselves rather than
       pushing the whole lab sideways. */
    '#osalgoviz .oa-proc-table,#osalgoviz .oa-matrix,#osalgoviz .oa-reqbox{overflow-x:auto;}',
    '#osalgoviz .oa-row-avg .oa-td{color:' + C.cyan + ';font-weight:700;border-top:1px solid ' + C.line + ';}',
    '#osalgoviz .oa-row-done .oa-td:first-child{opacity:.75;}',
    '#osalgoviz .oa-namecell{display:inline-flex;align-items:center;gap:6px;}',
    '#osalgoviz .oa-swatch{width:10px;height:10px;border-radius:3px;flex:0 0 auto;}',
    '#osalgoviz .oa-tableout{overflow-x:auto;}',
    '#osalgoviz .oa-scroll{overflow-x:auto;}',

    /* Gantt */
    '#osalgoviz .oa-gantt-wrap{border:1px solid ' + C.line + ';border-radius:10px;padding:10px;background:' + C.bg1 + ';}',
    '#osalgoviz .oa-gantt{display:flex;align-items:stretch;gap:2px;height:44px;}',
    '#osalgoviz .oa-seg{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;border-radius:5px;font-size:11px;font-weight:700;color:#04121f;overflow:hidden;transition:opacity .15s;}',
    '#osalgoviz .oa-seg-idle{background:repeating-linear-gradient(45deg,#16233a,#16233a 5px,#111c2f 5px,#111c2f 10px);color:' + C.faint + ';font-weight:400;}',
    '#osalgoviz .oa-seg-future{opacity:.22;}',
    '#osalgoviz .oa-seg-now{box-shadow:0 0 0 2px ' + C.amber + ' inset;}',
    '#osalgoviz .oa-axis{display:flex;gap:2px;margin-top:3px;}',
    '#osalgoviz .oa-axis-cell{flex:1 1 0;min-width:0;font-size:10px;color:' + C.faint + ';}',
    '#osalgoviz .oa-axis-end{font-size:10px;color:' + C.faint + ';}',

    /* ready queue strip */
    '#osalgoviz .oa-queue{display:flex;flex-direction:column;gap:6px;}',
    '#osalgoviz .oa-queue-line{display:flex;flex-wrap:wrap;align-items:center;gap:7px;}',
    '#osalgoviz .oa-queue-label{color:' + C.cyan + ';font-weight:700;}',
    '#osalgoviz .oa-queue-run{display:inline-flex;align-items:center;gap:7px;}',
    '#osalgoviz .oa-queue-cap{font-size:11px;color:' + C.faint + ';}',
    '#osalgoviz .oa-queue-q{font-size:11px;color:' + C.amber + ';}',
    '#osalgoviz .oa-queue-empty{font-size:11px;color:' + C.faint + ';font-style:italic;}',
    '#osalgoviz .oa-chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#1b2942;border:1px solid transparent;}',
    '#osalgoviz .oa-chip-ghost{background:transparent;border-style:solid;border-width:1px;font-weight:400;}',
    '#osalgoviz .oa-chip-idle{color:' + C.faint + ';font-weight:400;}',
    '#osalgoviz .oa-chip-ok{color:' + C.green + ';border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.09);font-weight:400;}',
    '#osalgoviz .oa-chip-no{color:' + C.red + ';border-color:rgba(252,165,165,.4);background:rgba(252,165,165,.07);font-weight:400;}',

    /* page replacement grid */
    '#osalgoviz .oa-pagegrid{width:auto;min-width:100%;}',
    '#osalgoviz .oa-pagegrid th.oa-sticky{position:sticky;left:0;background:' + C.bg1 + ';z-index:1;}',
    '#osalgoviz .oa-pagecol{text-align:center;color:' + C.cyan + ';padding:4px 0;min-width:26px;}',
    '#osalgoviz .oa-pagecell{text-align:center;padding:4px 0;min-width:26px;border:1px solid rgba(28,43,68,0.8);color:' + C.dim + ';}',
    '#osalgoviz .oa-cell-load{background:rgba(56,189,248,.22);color:#e6f6ff;font-weight:700;}',
    '#osalgoviz .oa-cell-hit{background:rgba(52,211,153,.2);color:#dcfff2;font-weight:700;}',
    '#osalgoviz .oa-cell-hand{box-shadow:0 0 0 2px ' + C.amber + ' inset;}',
    '#osalgoviz .oa-col-now{border-color:' + C.amber + ' !important;}',
    '#osalgoviz .oa-col-future{opacity:.22;}',
    '#osalgoviz .oa-mark-fault{color:' + C.red + ';font-weight:700;}',
    '#osalgoviz .oa-mark-hit{color:' + C.faint + ';}',
    '#osalgoviz .oa-faultrow th{color:' + C.faint + ';}',

    /* disk canvas */
    '#osalgoviz .oa-canvas{display:block;width:100%;height:340px;border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';}',
    '@media (max-width:640px){#osalgoviz .oa-canvas{height:280px;}}',

    /* memory blocks */
    '#osalgoviz .oa-blocks{display:flex;flex-direction:column;gap:6px;}',
    '#osalgoviz .oa-block-row{display:flex;align-items:center;gap:9px;padding:3px 5px;border-radius:7px;border:1px solid transparent;}',
    '#osalgoviz .oa-block-chosen{border-color:' + C.amber + ';background:rgba(251,191,36,.07);}',
    '#osalgoviz .oa-block-looked{border-color:rgba(148,163,184,.25);}',
    '#osalgoviz .oa-block-name{flex:0 0 4.6rem;font-size:11px;color:' + C.faint + ';}',
    '#osalgoviz .oa-block-track{display:flex;height:26px;border-radius:6px;overflow:hidden;background:#131f36;border:1px solid #24344f;min-width:3rem;}',
    '#osalgoviz .oa-block-fill{display:flex;align-items:center;padding:0 7px;font-size:11px;font-weight:700;color:#04121f;white-space:nowrap;overflow:hidden;}',
    '#osalgoviz .oa-block-waste{display:flex;align-items:center;padding:0 7px;font-size:10px;color:' + C.red + ';white-space:nowrap;overflow:hidden;background:repeating-linear-gradient(45deg,rgba(252,165,165,.13),rgba(252,165,165,.13) 4px,transparent 4px,transparent 8px);flex:1;}',
    '#osalgoviz .oa-block-free{display:flex;align-items:center;padding:0 7px;font-size:11px;color:' + C.faint + ';flex:1;}',
    '#osalgoviz .oa-block-size{flex:0 0 3.6rem;font-size:11px;color:' + C.dim + ';text-align:right;}',

    /* banker */
    '#osalgoviz .oa-matrices{display:flex;flex-direction:column;gap:10px;}',
    '#osalgoviz .oa-matrix-title{margin:0 0 4px;font-size:11px;color:' + C.faint + ';}',
    '#osalgoviz .oa-reqline{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}',
    '#osalgoviz .oa-req-word{font-size:12px;color:' + C.dim + ';}',
    '#osalgoviz .oa-verdict{margin-top:8px;display:flex;flex-wrap:wrap;gap:7px;align-items:flex-start;}',
    '#osalgoviz .oa-verdict-text{flex:1;min-width:12rem;font-size:11px;line-height:1.6;color:' + C.dim + ';}',
    '#osalgoviz .oa-tag{padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;}',
    '#osalgoviz .oa-tag-ok{background:rgba(52,211,153,.16);color:' + C.green + ';}',
    '#osalgoviz .oa-tag-no{background:rgba(252,165,165,.14);color:' + C.red + ';}',
    '#osalgoviz .oa-banksteps{display:flex;flex-direction:column;gap:6px;}',
    '#osalgoviz .oa-bankstep{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 9px;border:1px solid ' + C.line + ';border-radius:8px;background:rgba(15,23,42,.5);font-size:11px;opacity:.62;}',
    '#osalgoviz .oa-bankstep-now{opacity:1;border-color:' + C.amber + ';}',
    '#osalgoviz .oa-bankstep-n{color:' + C.faint + ';}',
    '#osalgoviz .oa-bankstep-work{color:' + C.cyan + ';font-weight:700;}',
    '#osalgoviz .oa-bankstep-list{display:flex;flex-wrap:wrap;gap:5px;}',
    '#osalgoviz .oa-bankstep-out{flex:1 1 100%;color:' + C.dim + ';}',
    '#osalgoviz .oa-bankstep-bad{color:' + C.red + ';}',

    /* note, transport, compare */
    '#osalgoviz .oa-note{min-height:2.6rem;padding:8px 11px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.65;color:#cbd5e1;}',
    '#osalgoviz .oa-error{padding:8px 11px;border-left:3px solid ' + C.red + ';background:rgba(252,165,165,.07);border-radius:0 8px 8px 0;font-size:12px;color:' + C.red + ';}',
    '#osalgoviz .oa-transport{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid ' + C.line + ';border-radius:9px;background:rgba(15,23,42,.55);}',
    '#osalgoviz .oa-scrub{flex:1 1 9rem;min-width:7rem;accent-color:' + C.blue + ';}',
    '#osalgoviz .oa-count{font-size:11px;color:' + C.dim + ';white-space:nowrap;}',
    '#osalgoviz .oa-speed{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:' + C.faint + ';}',
    '#osalgoviz .oa-speed input{width:6rem;accent-color:' + C.blue + ';}',
    '#osalgoviz .oa-compare-title{margin:0 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#osalgoviz .oa-row-cur .oa-td{background:rgba(125,211,252,.09);color:' + C.ink + ';}',
    '#osalgoviz .oa-cell-best{color:' + C.green + ';font-weight:700;}',
    /* The stage is a real tab stop — build() gives it tabIndex 0 so Space can
       toggle playback while it is focused — and a tab stop that shows nothing
       when it lands is exactly the dead-end a keyboard visitor cannot navigate
       out of confidently. :focus-visible rather than :focus so clicking the
       stage does not paint a ring nobody asked for. Every rule in this array
       is id-scoped because the mount shares a page with the site stylesheet;
       this one follows the same convention. */
    '#osalgoviz .oa-stage:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;border-radius:10px;}',
    '#osalgoviz .oa-hidden{display:none;}'
  ].join('');

  /* ======================================================================== */
  /*  THE SHELL                                                               */
  /* ======================================================================== */

  var SPEEDS = [900, 640, 460, 330, 240, 170, 120, 85, 60, 40];

  function OsAlgo(rootEl) {
    this.root = rootEl;
    this.families = [new SchedFamily(), new PageFamily(), new DiskFamily(),
                     new MemFamily(), new BankFamily()];
    this.active = 0;
    this.frame = 0;
    this.total = 1;
    this.playing = false;
    this.timer = null;
    this.speed = 5;
    this.build();
    this.select(0);
  }

  OsAlgo.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'oa-wrap');

    var tabs = E('div', 'oa-tabs');
    this.tabs = this.families.map(function (fam, i) {
      var b = button(fam.label, function () { self.select(i); }, 'oa-tab');
      b.className = 'oa-tab';
      tabs.appendChild(b);
      return b;
    });
    wrap.appendChild(tabs);

    var body = E('div', 'oa-body');
    var side = E('div', 'oa-side');
    var main = E('div', 'oa-main');

    // algorithm picker lives at the top of the controls: it is the one choice
    // every family shares and the one a visitor changes most
    var gAlgo = group('Algorithm');
    this.algoHost = E('div');
    gAlgo.appendChild(this.algoHost);
    side.appendChild(gAlgo);

    this.panels = this.families.map(function (fam) {
      var host = E('div', 'oa-panel oa-hidden');
      fam.buildPanel(host, function () { self.recompute(true); });
      side.appendChild(host);
      return host;
    });

    this.stages = this.families.map(function (fam) {
      var host = E('div', 'oa-stage oa-hidden');
      // The stage is this widget's keyboard surface: Space toggles playback
      // while it holds focus (see the keydown listener at the end of build()),
      // so it has to be reachable by Tab and has to name itself when it gets
      // there — a bare focusable <div> announces nothing at all. Only the
      // visible stage is ever a tab stop: every other one carries .oa-hidden,
      // which is display:none, and a display:none element cannot be focused.
      // select() rewrites className only, so these three stay put across tabs.
      host.tabIndex = 0;
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label',
        fam.label + ' stage — press Space to play and pause, arrow keys to step');
      fam.buildStage(host);
      main.appendChild(host);
      return host;
    });

    this.errorBox = E('div', 'oa-error oa-hidden');
    main.appendChild(this.errorBox);
    this.noteBox = E('div', 'oa-note');
    main.appendChild(this.noteBox);

    var tr = E('div', 'oa-transport');
    this.btnReset = button('⏮', function () { self.pause(); self.goto(0); }, '');
    this.btnReset.title = 'Back to the start';
    this.btnBack = button('◀', function () { self.pause(); self.goto(self.frame - 1); }, '');
    this.btnBack.title = 'One step back';
    this.btnPlay = button('▶ Play', function () { self.togglePlay(); }, '');
    this.btnNext = button('▶|', function () { self.pause(); self.goto(self.frame + 1); }, '');
    this.btnNext.title = 'One step forward';
    this.btnEnd = button('⏭', function () { self.pause(); self.goto(self.total - 1); }, '');
    this.btnEnd.title = 'Jump to the end';
    [this.btnReset, this.btnBack, this.btnPlay, this.btnNext, this.btnEnd].forEach(function (b) {
      tr.appendChild(b);
    });

    this.scrub = E('input', 'oa-scrub');
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.value = '0';
    this.scrub.setAttribute('aria-label', 'Step through the simulation');
    this.scrub.addEventListener('input', function () {
      self.pause();
      self.goto(parseInt(self.scrub.value, 10) || 0);
    });
    tr.appendChild(this.scrub);

    this.countBox = E('span', 'oa-count', '');
    tr.appendChild(this.countBox);

    var speedWrap = E('label', 'oa-speed');
    speedWrap.appendChild(E('span', null, 'speed'));
    var speedInput = E('input');
    speedInput.type = 'range';
    speedInput.min = '1';
    speedInput.max = '10';
    speedInput.value = String(this.speed);
    speedInput.addEventListener('input', function () {
      self.speed = parseInt(speedInput.value, 10) || 5;
      if (self.playing) { self.pause(); self.play(); }
    });
    speedWrap.appendChild(speedInput);
    tr.appendChild(speedWrap);
    main.appendChild(tr);

    var cmp = E('div', 'oa-comparewrap');
    cmp.appendChild(E('p', 'oa-compare-title', 'Every algorithm on this same input'));
    this.compareHost = E('div', 'oa-tableout');
    cmp.appendChild(this.compareHost);
    main.appendChild(cmp);
    this.compareWrap = cmp;

    body.appendChild(side);
    body.appendChild(main);
    wrap.appendChild(body);
    this.root.appendChild(wrap);

    // Arrow keys step, space plays — but never while a control has focus, or
    // typing a burst time would scrub the timeline out from under you.
    //
    // Space is not this widget's to take on sight. The browser has already
    // given it two jobs — scroll the page when nothing focusable owns it, and
    // press the focused button — and this listener used to take it from every
    // button in the widget: the five family tabs, '+ Add process', '− Remove
    // last', all eighteen preset buttons and all five transport buttons — ⏮
    // and ◀ too, from the moment a step enables them.
    // Tabbing to ⏭ and pressing Space started playback instead of jumping
    // to the end, and the guard above did not catch it because a <button> is
    // none of input/select/textarea.
    //
    // Ownership is stated positively instead, the way sortviz.js and
    // multi-shell.js do it: the visible family stage is this widget's picture,
    // it is given tabIndex 0 where it is built above so a keyboard visitor can
    // Tab to it, and Space toggles playback only while that stage itself holds
    // focus. Everywhere else Space keeps both of its native jobs — including on
    // the ▶ Play button, which stays the other way to start and stop a run.
    //
    // The arrows keep the wider reach they always had: they have no native job
    // on a button, so stepping from wherever focus sits costs nothing.
    wrap.addEventListener('keydown', function (ev) {
      var tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); self.pause(); self.goto(self.frame + 1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); self.pause(); self.goto(self.frame - 1); }
      else if (ev.key === ' ') {
        if (ev.target !== self.stages[self.active]) return;
        ev.preventDefault();
        self.togglePlay();
      }
    });
  };

  OsAlgo.prototype.select = function (i) {
    var self = this;
    this.pause();
    this.active = i;
    this.tabs.forEach(function (b, n) { b.className = 'oa-tab' + (n === i ? ' on' : ''); });
    this.panels.forEach(function (p, n) { p.className = 'oa-panel' + (n === i ? '' : ' oa-hidden'); });
    this.stages.forEach(function (p, n) { p.className = 'oa-stage' + (n === i ? '' : ' oa-hidden'); });

    var fam = this.families[i];
    clear(this.algoHost);
    this.algoHost.appendChild(selectBox(fam.algoOptions(), fam.algoKey, function (v) {
      fam.algoKey = v;
      self.recompute(true);
    }));
    this.recompute(true);
  };

  /* Recompute everything and, unless told otherwise, hold the current step so
     that nudging a burst time does not throw the visitor back to t = 0. */
  OsAlgo.prototype.recompute = function (keepPosition) {
    var fam = this.families[this.active];
    var was = this.frame;
    var count;
    try {
      count = fam.compute();
    } catch (err) {
      this.showError('Something in that input could not be simulated: ' + err.message);
      return;
    }
    this.total = Math.max(1, count || 1);
    this.frame = keepPosition ? Math.min(was, this.total - 1) : 0;
    this.scrub.max = String(this.total - 1);
    this.showError(fam.error);
    this.draw();
    this.renderCompare();
  };

  OsAlgo.prototype.showError = function (msg) {
    if (msg) {
      this.errorBox.textContent = msg;
      this.errorBox.className = 'oa-error';
    } else {
      this.errorBox.textContent = '';
      this.errorBox.className = 'oa-error oa-hidden';
    }
  };

  OsAlgo.prototype.draw = function () {
    var fam = this.families[this.active];
    fam.render(this.frame);
    this.noteBox.textContent = fam.note(this.frame) || '';
    this.scrub.value = String(this.frame);
    this.countBox.textContent = 'step ' + (this.frame + 1) + ' of ' + this.total;
    this.btnBack.disabled = this.frame <= 0;
    this.btnReset.disabled = this.frame <= 0;
    this.btnNext.disabled = this.frame >= this.total - 1;
    this.btnEnd.disabled = this.frame >= this.total - 1;
  };

  OsAlgo.prototype.goto = function (i) {
    var next = Math.max(0, Math.min(this.total - 1, i));
    if (next === this.frame) { this.draw(); return; }
    this.frame = next;
    this.draw();
  };

  OsAlgo.prototype.play = function () {
    var self = this;
    if (this.frame >= this.total - 1) this.frame = 0;
    this.playing = true;
    this.btnPlay.textContent = '❚❚ Pause';
    this.btnPlay.className = 'oa-btn on';
    // A self-scheduling timeout rather than setInterval: the speed slider can
    // change the gap between two steps without a stale interval firing late.
    (function tick() {
      self.timer = setTimeout(function () {
        if (!self.playing) return;
        if (self.frame >= self.total - 1) { self.pause(); return; }
        self.frame++;
        self.draw();
        tick();
      }, SPEEDS[Math.max(0, Math.min(9, self.speed - 1))]);
    })();
  };

  OsAlgo.prototype.pause = function () {
    this.playing = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.btnPlay) {
      this.btnPlay.textContent = '▶ Play';
      this.btnPlay.className = 'oa-btn';
    }
  };

  OsAlgo.prototype.togglePlay = function () {
    if (this.playing) this.pause(); else this.play();
  };

  OsAlgo.prototype.renderCompare = function () {
    var fam = this.families[this.active];
    clear(this.compareHost);
    var data;
    try {
      data = fam.compare();
    } catch (err) {
      data = null;
    }
    if (!data) { this.compareWrap.className = 'oa-comparewrap oa-hidden'; return; }
    this.compareWrap.className = 'oa-comparewrap';

    // Find the winning value in the headline column so the best row is not
    // just listed but visibly marked — the comparison is the point.
    var bestVal = null;
    data.rows.forEach(function (r) {
      var v = parseFloat(String(r.cells[data.best]));
      if (isNaN(v)) return;
      if (bestVal === null || (data.lower ? v < bestVal : v > bestVal)) bestVal = v;
    });

    var rows = data.rows.map(function (r) {
      var cells = r.cells.map(function (c, i) {
        if (i === data.best && bestVal !== null && parseFloat(String(c)) === bestVal) {
          return E('span', 'oa-cell-best', String(c));
        }
        return c;
      });
      return { cls: r.key === fam.algoKey ? 'oa-row-cur' : '', cells: cells };
    });
    this.compareHost.appendChild(table(data.head, rows));
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('osalgoviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-osalgo-mount') || rootEl;
    clear(mount);
    try {
      // eslint-disable-next-line no-new
      new OsAlgo(mount);
    } catch (err) {
      var msg = E('p', 'lab-proc-fallback',
        'The OS algorithm visualiser could not start in this browser (' + err.message +
        '). Please tell me, and mention which browser you are using.');
      mount.appendChild(msg);
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'osalgoviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

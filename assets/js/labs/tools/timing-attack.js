/* ==========================================================================
   timing-attack.js — recover a secret from measured timing, and be honest
   about the clock that is doing the measuring.
   --------------------------------------------------------------------------
   Two string comparisons over the same secret. The naive one returns on the
   first mismatched character, so how long it takes depends on how much of the
   guess was right. The constant-time one folds every character into an
   accumulator and always walks the whole length, so it does not. The attack
   works left to right: at each position it times every candidate character
   many times over and keeps the slowest one.

   The median, never the mean. These measurements run on a general-purpose
   machine that is also running a compositor, a garbage collector and whatever
   else the visitor has open, and any one of those interruptions is worth more
   milliseconds than the entire signal. A single bad batch drags a mean past
   every other candidate and hands you the wrong character with confidence.
   The median does not notice it.

   The honest problem is the clock. performance.now() is deliberately coarsened
   in ordinary pages as a Spectre mitigation, and the difference this attack is
   trying to see is one loop iteration — nanoseconds. That is why every sample
   runs the comparison thousands of times before reading the clock at all, and
   it is why the attack can still come out as noise on a fast machine with a
   coarse timer. So the tool measures the resolution it actually got and prints
   it: a failure here is a statement about the browser's clock, not about the
   vulnerability. A real attacker repeats far more, measures over a network, or
   sits on the same host with a cycle counter.

   Two things are deliberately missing. The length-recovery step: the attack is
   handed the secret's length, even though the naive comparison leaks that too
   by returning before it compares anything. And any claim that the
   constant-time function here is genuinely constant-time — it is constant-time
   in its loop structure, which is all a JIT over a string representation
   neither of us controls will allow. In production the comparison worth
   trusting is one written where that promise can actually be kept.

   The final character is a special case and the code says so out loud. With
   the length fixed, a wrong last character and the right one both compare
   every position, so there is nothing left to time. That one is confirmed by
   asking the comparison, which is what an attacker does anyway once every
   other character is known.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var ALPHABETS = {
    hex: '0123456789abcdef',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    lowerdigit: 'abcdefghijklmnopqrstuvwxyz0123456789'
  };

  /* U+0000 is the padding character in every guess, chosen because it is in
     none of the alphabets above. That matters more than it looks: if the
     padding could accidentally equal the next real character of the secret,
     a wrong candidate would occasionally run one comparison further and look
     as slow as the right one. With this filler a wrong candidate always stops
     exactly one character earlier than the right one, and the whole signal is
     that single loop iteration. */
  var FILLER = '\u0000';

  var MIN_SECRET = 2;
  var MAX_SECRET = 12;
  var RUN_BUDGET_MS = 25000;   /* what we aim a run at */
  var RUN_REFUSE_MS = 90000;   /* past this the tool refuses rather than hangs */
  var MIN_REPS = 500;
  var MAX_REPS = 4000000;

  var out = LabTool.out('tool-out');
  var clockInfo = null;
  var job = null;
  var running = false;
  var timer = null;
  var lastPlot = null;
  var resizeTimer = null;

  /* Every comparison result is folded into this counter, and the counter is
     printed at the end of a run. Without a consumer, an engine is entitled to
     notice that the return value of the comparison is never used and delete
     the loop that produced it — at which point the tool would be timing an
     empty for-loop and reporting the result as a side channel.

     It adds 2 for true and 1 for false rather than 1 and 0, because the first
     version only ever counted successful comparisons and an attack that
     succeeds twice printed "results counter 0" at the end — a number that
     proves nothing to a reader who is being asked to believe the loop ran.
     Masked rather than truncated with |0 so a long run cannot wrap negative. */
  var sink = 0;

  function el(id) { return document.getElementById(id); }
  function rep(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }

  var now = (window.performance && window.performance.now)
    ? function () { return window.performance.now(); }
    : function () { return Date.now(); };
  var usingPerformanceNow = !!(window.performance && window.performance.now);

  /* ------------------------------------------------------------------------
     The two comparisons. Both are real; neither is a stand-in.
     ------------------------------------------------------------------------ */

  /* The bug, written out. It returns the moment two characters disagree, so
     the number of loop iterations it runs is exactly the length of the shared
     prefix plus one. The length check in front leaks the length the same way.
     This is the shape of a hand-written token or HMAC comparison. */
  function naiveEqual(secret, guess) {
    if (secret.length !== guess.length) return false;
    for (var i = 0; i < secret.length; i++) {
      if (secret.charCodeAt(i) !== guess.charCodeAt(i)) return false;
    }
    return true;
  }

  function codeAt(s, i) { return i < s.length ? s.charCodeAt(i) : 0; }

  /* The fix, in its loop structure. Every character is XOR-ed into an
     accumulator and nothing branches on the result, so the work done does not
     depend on where the first difference is. The lengths are folded in too,
     but the loop still runs max(len) times, so length is not fully hidden —
     which is exactly why the real advice is to compare HMACs of both values
     instead, so both inputs are the same fixed size whatever went in. */
  function constantTimeEqual(secret, guess) {
    var n = secret.length > guess.length ? secret.length : guess.length;
    var diff = secret.length ^ guess.length;
    for (var i = 0; i < n; i++) {
      diff |= codeAt(secret, i) ^ codeAt(guess, i);
    }
    return diff === 0;
  }

  /* ------------------------------------------------------------------------
     Measuring
     ------------------------------------------------------------------------ */

  /* One sample: run the comparison reps times, read the clock once at each
     end. The comparison is reached through a variable rather than by name, so
     both comparisons pay the same non-inlinable call overhead and the contest
     between them stays fair. That overhead is also part of why reps has to
     be so large: it is added to every call and the signal is not. */
  function timeBatch(cmp, secret, guess, reps) {
    var t0 = now();
    for (var r = 0; r < reps; r++) {
      sink = (sink + (cmp(secret, guess) ? 2 : 1)) & 0x3fffffff;
    }
    return now() - t0;
  }

  /* Observed clock resolution: read the clock in a tight loop and keep the
     gaps. The smallest non-zero gap is the finest thing this browser will
     admit to. The proportion of reads that returned a value identical to the
     one before says how coarse that is relative to the machine — 99% identical
     means the clock ticks far slower than the loop runs. */
  function measureClock() {
    var deltas = [];
    var reads = 0, zeros = 0;
    var prev = now();
    var guard = prev;
    while (deltas.length < 600 && reads < 400000) {
      var t = now();
      reads++;
      var d = t - prev;
      if (d > 0) { deltas.push(d); prev = t; } else { zeros++; }
      if ((reads & 4095) === 0 && now() - guard > 2000) break;
    }
    deltas.sort(function (a, b) { return a - b; });
    var distinct = 0, i;
    for (i = 0; i < deltas.length; i++) {
      if (i === 0 || deltas[i] !== deltas[i - 1]) distinct++;
    }
    var med = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
    return {
      min: deltas.length ? deltas[0] : 0,
      median: med || (deltas.length ? deltas[0] : 1),
      gaps: deltas.length,
      reads: reads,
      zeros: zeros,
      distinct: distinct,
      isolated: (typeof window.crossOriginIsolated === 'boolean')
        ? window.crossOriginIsolated : null
    };
  }

  /* ------------------------------------------------------------------------
     Statistics, all robust rather than clever
     ------------------------------------------------------------------------ */

  function sortedCopy(values) {
    return values.slice().sort(function (a, b) { return a - b; });
  }

  function median(values) {
    if (!values.length) return 0;
    var s = sortedCopy(values);
    var mid = Math.floor(s.length / 2);
    return (s.length % 2) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /* Median absolute deviation: the median of the distances from the median.
     A standard deviation would be inflated by the same single scheduler
     interruption that the median was chosen to ignore, which would make the
     spread look enormous and every result look like noise. */
  function mad(values) {
    var m = median(values);
    var dev = [], i;
    for (i = 0; i < values.length; i++) dev.push(Math.abs(values[i] - m));
    return median(dev);
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
  }

  /* The fraction of all pairings in which a sample from the pick came out slower
     than a sample from the runner-up, ties counted as half. It is a rank statistic, so
     it does not care about the size of an outlier, only its order — which is
     the same reason the median is used above. 0.5 means the two candidates are
     indistinguishable; 1.0 means every single sample of the pick was slower than
     every single sample of the runner-up. */
  function pSlower(a, b) {
    var wins = 0, i, j;
    for (i = 0; i < a.length; i++) {
      for (j = 0; j < b.length; j++) {
        if (a[i] > b[j]) wins += 1;
        else if (a[i] === b[j]) wins += 0.5;
      }
    }
    return wins / (a.length * b.length);
  }

  function verdict(p, gap, floorMs) {
    if (!(gap > 0)) return { label: 'no separation', cls: 't-err', ok: false };
    if (p >= 0.80 && gap >= floorMs) return { label: 'clear', cls: 't-ok', ok: true };
    if (p >= 0.65) return { label: 'weak', cls: 't-warn', ok: false };
    return { label: 'within noise', cls: 't-err', ok: false };
  }

  /* ------------------------------------------------------------------------
     Formatting
     ------------------------------------------------------------------------ */

  function dur(v) {
    if (!isFinite(v)) return 'n/a';
    if (Math.abs(v) < 0.001) return (v * 1e6).toFixed(1) + ' ns';
    if (Math.abs(v) < 1) return (v * 1000).toFixed(2) + ' µs';
    return v.toFixed(3) + ' ms';
  }

  function pad(text, n) {
    text = String(text);
    return text.length >= n ? text + ' ' : text + rep(' ', n - text.length);
  }

  function quoted(ch) {
    if (ch === FILLER) return 'NUL';
    return '"' + ch + '"';
  }

  function seconds(msValue) {
    if (msValue < 1000) return Math.round(msValue) + ' ms';
    return (msValue / 1000).toFixed(1) + ' s';
  }

  /* ------------------------------------------------------------------------
     Calibration — how long is one compared character worth on this machine
     ------------------------------------------------------------------------ */

  /* Time a guess that fails at the very first character against one that fails
     at the last, and the difference over the number of characters between them
     is the cost of comparing one character. Everything else — the call, the
     length check, the loop setup — cancels out of the subtraction. Three
     batches each and the median of the three, because one of them will be the
     batch that got interrupted. */
  function calibrate(cmp, secret, res) {
    var L = secret.length;
    var shallow = rep(FILLER, L);
    var deep = secret.slice(0, L - 1) + FILLER;
    var target = Math.max(2, res.median * 40);
    var reps = 256;
    var t = timeBatch(cmp, secret, deep, reps);
    while (t < target && reps < MAX_REPS) {
      reps = reps * 4;
      t = timeBatch(cmp, secret, deep, reps);
    }
    var deepRuns = [], shallowRuns = [], k;
    for (k = 0; k < 3; k++) {
      deepRuns.push(timeBatch(cmp, secret, deep, reps));
      shallowRuns.push(timeBatch(cmp, secret, shallow, reps));
    }
    var tDeep = median(deepRuns) / reps;
    var tShallow = median(shallowRuns) / reps;
    var perIter = (tDeep - tShallow) / (L - 1);
    var perCall = tShallow - perIter;
    var okay = perIter > 0 && isFinite(perIter);
    return {
      okay: okay,
      perIter: okay ? perIter : 0,
      perCall: okay ? Math.max(0, perCall) : Math.max(0, tShallow),
      probeReps: reps,
      batchMs: median(deepRuns)
    };
  }

  /* How many comparisons per sample. Two separate things have to be cleared,
     and sizing against only one of them was the first thing that went wrong
     here.

     The clock: what has to clear it is not the whole batch, it is the
     DIFFERENCE between a right candidate and a wrong one, which is one loop
     iteration per comparison. Thirty ticks of that gives the median something
     to stand on.

     The noise floor: a batch that finishes in a few microseconds is measuring
     whatever else the machine did during those microseconds far more than it
     is measuring the comparison. Sized against the clock alone, a browser with
     a fine timer picked a few thousand compares, every batch landed inside the
     scheduler's own jitter, and the run recovered three characters out of five
     with every position flagged as noise — correct answers the data did not
     support, which is the failure mode this tool exists to refuse. So the
     batch also has to last at least MIN_BATCH_MS.

     Whichever rule asks for more wins, and the output says which one it was. */
  var MIN_BATCH_MS = 1.5;

  function chooseReps(cal, res) {
    if (!cal.okay) {
      return { reps: Math.max(MIN_REPS, cal.probeReps * 8), wanted: 0, guessed: true, why: 'fallback' };
    }
    var forClock = Math.ceil((res.median * 30) / cal.perIter);
    var forNoise = Math.ceil(MIN_BATCH_MS / Math.max(1e-9, cal.perCall + cal.perIter));
    var wanted = Math.max(forClock, forNoise);
    var reps = Math.min(MAX_REPS, Math.max(MIN_REPS, wanted));
    return {
      reps: reps, wanted: wanted, guessed: false,
      forClock: forClock, forNoise: forNoise,
      why: forNoise > forClock ? 'noise' : 'clock'
    };
  }

  function estimateMs(j) {
    var total = 0, i;
    /* The last position is confirmed by asking the comparison, not by timing,
       so it costs one call per candidate and is not in this sum. */
    for (i = 0; i < j.secret.length - 1; i++) {
      total += j.rounds * j.cands.length * j.reps * (j.perCall + (i + 1) * j.perIter);
    }
    return total * j.modes.length;
  }

  /* ------------------------------------------------------------------------
     The plot
     ------------------------------------------------------------------------ */

  function fitCanvas(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 480;
    var h = cv.clientHeight || 320;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    var ctx = cv.getContext ? cv.getContext('2d') : null;
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  /* Deterministic jitter. Math.random would make every point hop to a new
     column position on each redraw, and a window resize would look like the
     data had changed. */
  function jitter(a, b) {
    var x = ((a + 1) * 73856093) ^ ((b + 1) * 19349663);
    x = (x ^ (x >>> 13)) >>> 0;
    return ((x % 1000) / 1000) - 0.5;
  }

  function draw(plot) {
    var cv = el('tool-canvas');
    if (!cv) return;
    lastPlot = plot;
    var fit = fitCanvas(cv);
    if (!fit) return;
    var ctx = fit.ctx, W = fit.w, H = fit.h;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '11px Consolas, Menlo, monospace';
    ctx.textBaseline = 'middle';

    if (!plot) {
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.fillText('Run the attack and the timing samples land here.', W / 2, H / 2);
      return;
    }

    var all = [], i, k;
    for (i = 0; i < plot.samples.length; i++) {
      for (k = 0; k < plot.samples[i].length; k++) all.push(plot.samples[i][k]);
    }
    var sorted = sortedCopy(all);
    var lo = percentile(sorted, 0.02);
    var hi = percentile(sorted, 0.98);
    if (!(hi > lo)) { var mid = lo || 1; lo = mid * 0.995; hi = mid * 1.005; }
    var clipped = 0;
    for (i = 0; i < all.length; i++) if (all[i] > hi || all[i] < lo) clipped++;
    /* Handed back on the plot object so the sentence under the canvas can
       repeat the axis range and the clipped count in words. Colour and pixel
       position are the only place those facts live otherwise. */
    plot.lo = lo; plot.hi = hi; plot.clipped = clipped; plot.total = all.length;

    var padL = 62, padR = 12, padT = 30, padB = 26;
    var plotW = Math.max(10, W - padL - padR);
    var plotH = Math.max(10, H - padT - padB);
    var colW = plotW / plot.samples.length;

    function y(v) {
      var f = (v - lo) / (hi - lo);
      if (f < 0) f = 0; if (f > 1) f = 1;
      return padT + plotH - f * plotH;
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(plot.title, padL, 12);

    /* The clipped-sample note shares the header line with the title, and at a
       narrow width the two used to overwrite each other into an unreadable
       smear. It is dropped from the canvas when it will not fit — the count is
       in the sentence under the plot either way, which is the version a screen
       reader gets and therefore the one that has to be complete. */
    var note = clipped ? clipped + ' of ' + all.length + ' samples outside the axis' : '';
    if (note && ctx.measureText(plot.title).width + ctx.measureText(note).width + 20 < plotW) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#64748b';
      ctx.fillText(note, W - padR, 12);
      ctx.textAlign = 'left';
    }

    /* Axis */
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    for (k = 0; k <= 4; k++) {
      var v = lo + (hi - lo) * (k / 4);
      var yy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = '#64748b';
      ctx.fillText(dur(v), padL - 6, y(v));
    }

    /* Winner column band, so the highlight is not carried by dot colour alone */
    if (plot.winner >= 0) {
      ctx.fillStyle = 'rgba(134,239,172,0.10)';
      ctx.fillRect(padL + plot.winner * colW, padT, colW, plotH);
    }

    for (i = 0; i < plot.samples.length; i++) {
      var cx = padL + (i + 0.5) * colW;
      var isWin = i === plot.winner;
      var isNext = i === plot.runner;
      ctx.fillStyle = isWin ? 'rgba(134,239,172,0.55)'
        : isNext ? 'rgba(251,191,36,0.55)'
          : 'rgba(56,189,248,0.30)';
      var spread = Math.min(colW * 0.72, 26);
      for (k = 0; k < plot.samples[i].length; k++) {
        var px = cx + jitter(i, k) * spread;
        var py = y(plot.samples[i][k]);
        ctx.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
      }
      /* Median bar */
      var my = Math.round(y(plot.medians[i])) + 0.5;
      ctx.strokeStyle = isWin ? '#86efac' : isNext ? '#fbbf24' : 'rgba(226,232,240,0.55)';
      ctx.lineWidth = isWin || isNext ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx - Math.min(colW * 0.42, 16), my);
      ctx.lineTo(cx + Math.min(colW * 0.42, 16), my);
      ctx.stroke();
    }

    /* Candidate labels, only when there is room for them to be readable */
    ctx.textAlign = 'center';
    if (colW >= 10) {
      for (i = 0; i < plot.cands.length; i++) {
        ctx.fillStyle = i === plot.winner ? '#86efac' : i === plot.runner ? '#fbbf24' : '#64748b';
        ctx.fillText(plot.cands.charAt(i), padL + (i + 0.5) * colW, H - padB / 2 - 2);
      }
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillText(plot.cands.length + ' candidates, too narrow to label here',
        padL + plotW / 2, H - padB / 2 - 2);
    }

  }

  function redraw() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { draw(lastPlot); }, 120);
  }

  function say(text) {
    var node = el('tool-stats');
    if (node) node.textContent = text;
    var cv = el('tool-canvas');
    if (cv) cv.setAttribute('aria-label', 'Timing distribution plot. ' + text);
  }

  function progress(text) {
    var node = el('tool-plotlabel');
    if (node) node.textContent = text;
  }

  /* ------------------------------------------------------------------------
     The attack
     ------------------------------------------------------------------------ */

  function setBusy(on) {
    running = on;
    var run = el('tool-run'), stop = el('tool-stop'), clock = el('tool-clock');
    if (run) run.disabled = on;
    if (clock) clock.disabled = on;
    if (stop) stop.disabled = !on;
  }

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (running) {
      out.rule();
      out.warn('Stopped. Everything printed above still stands; the positions');
      out.warn('below it were never measured.');
    }
    setBusy(false);
  }

  function shuffled(n) {
    var order = [], i, j, t;
    for (i = 0; i < n; i++) order.push(i);
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = order[i]; order[i] = order[j]; order[j] = t;
    }
    return order;
  }

  function freshSamples(n) {
    var s = [], i;
    for (i = 0; i < n; i++) s.push([]);
    return s;
  }

  function startMode(modeIndex) {
    var j = job;
    j.modeIndex = modeIndex;
    j.mode = j.modes[modeIndex];
    j.cmp = j.mode === 'naive' ? naiveEqual : constantTimeEqual;
    j.prefix = '';
    j.pos = 0;
    j.round = 0;
    j.samples = freshSamples(j.cands.length);
    j.rows = [];
    out.line('');
    out.rule();
    if (j.mode === 'naive') {
      out.heading('Naive comparison — returns on the first mismatch');
    } else {
      out.heading('Constant-time comparison — XOR over the full length');
    }
    out.dim('The "score" column compares the pick against the secret AFTER the');
    out.dim('pick is made. It is never fed back into the attack.');
    out.dim('Later positions are harder, and not because of the clock: at');
    out.dim('position 1 the right candidate does twice the work of a wrong one,');
    out.dim('at position 6 it does a seventh more. The absolute gap stays one');
    out.dim('loop iteration; everything it hides behind grows.');
    out.line('');
    step();
  }

  function step() {
    if (!running) return;
    var j = job;

    if (j.pos >= j.secret.length - 1) { finishLastPosition(); return; }

    /* One interleaved round: every candidate measured once, in a fresh random
       order. Measuring all of "a" and then all of "b" would hand any CPU
       frequency change or garbage collection that happened in between to
       whichever candidate was unlucky enough to be running at the time. */
    var order = shuffled(j.cands.length);
    var tail = rep(FILLER, j.secret.length - j.pos - 1);
    var i, c, guess;
    for (i = 0; i < order.length; i++) {
      c = order[i];
      guess = j.prefix + j.cands.charAt(c) + tail;
      j.samples[c].push(timeBatch(j.cmp, j.secret, guess, j.reps));
      j.batches++;
    }
    j.round++;
    progress('position ' + (j.pos + 1) + ' of ' + j.secret.length +
      ', round ' + j.round + ' of ' + j.rounds);

    if (j.round < j.rounds) { timer = setTimeout(step, 0); return; }
    finishPosition();
    if (!running) return;
    timer = setTimeout(step, 0);
  }

  function finishPosition() {
    var j = job;
    var medians = [], i;
    for (i = 0; i < j.samples.length; i++) medians.push(median(j.samples[i]));

    var order = [];
    for (i = 0; i < medians.length; i++) order.push(i);
    order.sort(function (a, b) { return medians[b] - medians[a]; });
    var win = order[0], next = order[1];

    var gap = medians[win] - medians[next];
    var p = pSlower(j.samples[win], j.samples[next]);
    var spread = (mad(j.samples[win]) + mad(j.samples[next])) / 2;
    var v = verdict(p, gap, j.clock.min);
    var ch = j.cands.charAt(win);
    var truth = j.secret.charAt(j.pos);
    var correct = ch === truth;

    /* How many distinct values the clock produced across every sample at this
       position. If it is one or two, the clock quantised everything into the
       same bucket and no amount of arithmetic afterwards means anything. */
    var seen = {}, distinct = 0, k;
    for (i = 0; i < j.samples.length; i++) {
      for (k = 0; k < j.samples[i].length; k++) {
        var key = String(j.samples[i][k]);
        if (!seen[key]) { seen[key] = 1; distinct++; }
      }
    }

    j.rows.push({ pos: j.pos, ch: ch, correct: correct, ok: v.ok, timed: true });

    out.line('  ' + pad('pos ' + (j.pos + 1), 8) + pad('picked ' + quoted(ch), 14) +
      pad('median ' + dur(medians[win]), 22) +
      (correct ? 'score: correct' : 'score: wrong (secret has ' + quoted(truth) + ')'),
      correct ? 't-ok' : 't-err');
    out.line('          runner-up ' + quoted(j.cands.charAt(next)) + ' at ' + dur(medians[next]) +
      ', gap ' + dur(gap) + ' = ' + (j.clock.min > 0 ? (gap / j.clock.min).toFixed(2) : '?') +
      ' clock ticks', 't-dim');
    out.line('          P(pick slower than runner-up) = ' + p.toFixed(3) +
      ', spread ' + dur(spread) + '  ->  ' + v.label, v.cls);
    if (distinct <= 2) {
      out.line('          the clock returned only ' + distinct +
        ' distinct value(s) across all ' + (j.samples.length * j.rounds) +
        ' samples here', 't-err');
    }
    if (!v.ok) {
      out.line('          not a supported recovery — the attack continues with it', 't-warn');
    }

    var plot = {
      cands: j.cands,
      samples: j.samples,
      medians: medians,
      winner: win,
      runner: next,
      title: (j.mode === 'naive' ? 'naive compare' : 'constant-time compare') +
        ' — position ' + (j.pos + 1) + ' of ' + j.secret.length +
        ' — ' + j.rounds + ' samples per candidate'
    };
    draw(plot);
    say('Position ' + (j.pos + 1) + ' of ' + j.secret.length + '. Slowest candidate ' +
      quoted(ch) + ' at a median of ' + dur(medians[win]) + '. Runner-up ' +
      quoted(j.cands.charAt(next)) + ' at ' + dur(medians[next]) + '. Gap ' + dur(gap) +
      '. Confidence: ' + v.label + '.' +
      (plot.total ? ' The plot runs from ' + dur(plot.lo) + ' to ' + dur(plot.hi) +
        ', with ' + plot.clipped + ' of ' + plot.total + ' samples outside it.' : ''));

    j.prefix += ch;
    j.pos++;
    j.round = 0;
    j.samples = freshSamples(j.cands.length);
  }

  /* The last character carries no timing signal at all, and pretending
     otherwise would be the dishonest bit. With the length fixed, a wrong last
     character fails at the final comparison and the right one succeeds at the
     final comparison: both walk every position. So it is settled by asking the
     comparison itself, which is what an attacker with the other characters
     does anyway — at most one alphabet's worth of tries. */
  function finishLastPosition() {
    var j = job;
    var found = -1, i;
    for (i = 0; i < j.cands.length; i++) {
      if (j.cmp(j.secret, j.prefix + j.cands.charAt(i))) { found = i; break; }
      j.oracleCalls++;
    }
    if (found >= 0) {
      j.prefix += j.cands.charAt(found);
      out.line('  ' + pad('pos ' + j.secret.length, 8) +
        pad('picked ' + quoted(j.cands.charAt(found)), 14) +
        'confirmed by the oracle, not by timing', 't-ok');
    } else {
      j.prefix += '?';
      out.line('  ' + pad('pos ' + j.secret.length, 8) + pad('picked "?"', 14) +
        'no candidate was accepted', 't-err');
      out.line('          which means one of the characters above is wrong —', 't-warn');
      out.line('          this is the honest failure signal, and it is free', 't-warn');
    }
    out.dim('          (with the length fixed, a wrong last character and the');
    out.dim('          right one both compare every position, so there is');
    out.dim('          nothing left to time)');
    finishMode();
  }

  function finishMode() {
    var j = job;
    var timedTotal = j.secret.length - 1;
    var timedRight = 0, supported = 0, i;
    for (i = 0; i < j.rows.length; i++) {
      if (j.rows[i].correct) timedRight++;
      if (j.rows[i].ok) supported++;
    }
    out.line('');
    out.row('  recovered', '"' + j.prefix + '"', j.prefix === j.secret ? 't-ok' : 't-err');
    out.row('  the secret was', '"' + j.secret + '"');
    out.row('  timed positions right', timedRight + ' of ' + timedTotal,
      timedRight === timedTotal ? 't-ok' : 't-err');
    out.row('  of those, supported', supported + ' of ' + timedTotal +
      ' cleared the noise threshold', supported === timedTotal ? 't-ok' : 't-warn');
    var chance = timedTotal / j.cands.length;
    out.row('  guessing alone gives', 'about ' + chance.toFixed(2) + ' of ' + timedTotal +
      ' (1 in ' + j.cands.length + ' per position)');
    if (timedRight <= Math.ceil(chance)) {
      out.line('  This run is indistinguishable from guessing.', 't-warn');
    }
    j.results.push({
      mode: j.mode, right: timedRight, total: timedTotal,
      supported: supported, recovered: j.prefix
    });

    if (j.modeIndex + 1 < j.modes.length) {
      timer = setTimeout(function () { startMode(j.modeIndex + 1); }, 0);
      return;
    }
    finishRun();
  }

  function finishRun() {
    var j = job;
    var i, r;
    out.line('');
    out.rule();
    out.heading('Summary');
    for (i = 0; i < j.results.length; i++) {
      r = j.results[i];
      out.row('  ' + (r.mode === 'naive' ? 'naive compare' : 'constant-time compare'),
        r.right + ' of ' + r.total + ' timed characters, ' + r.supported +
        ' supported by the data', r.mode === 'naive' ? 't-ok' : 't-info');
    }
    if (j.results.length === 2) {
      out.line('');
      if (j.results[0].right > j.results[1].right) {
        out.ok('  That difference is the whole point. The same attack, the same');
        out.ok('  machine, the same clock, the same number of samples — only the');
        out.ok('  comparison changed.');
      } else {
        out.warn('  The naive comparison did not come out ahead of the constant-time');
        out.warn('  one here. On this machine, with this clock, the side channel was');
        out.warn('  not measurable. That is a result about the timer, not a finding');
        out.warn('  that the naive comparison is safe.');
      }
    }

    out.line('');
    out.rule();
    out.heading('What this run can and cannot support');
    out.row('  clock resolution', dur(j.clock.min) + ' (smallest non-zero gap seen)');
    out.row('  samples per candidate', j.rounds + ', interleaved in rounds');
    out.row('  compares per sample', j.reps);
    out.row('  timed samples taken', j.batches);
    out.row('  comparisons executed', (j.batches * j.reps) + ' plus ' + j.oracleCalls + ' oracle calls');
    out.row('  results counter', sink + ' (every result folded in, so the loop ' +
      'cannot be optimised away; it wraps)');
    out.line('');
    out.dim('  Every pick above is a median. A mean would have been decided by');
    out.dim('  whichever candidate happened to be running when the garbage');
    out.dim('  collector woke up. Some real attacks go further and take a low');
    out.dim('  percentile, or the fastest sample, on the argument that noise on a');
    out.dim('  busy machine only ever makes a measurement slower and never faster.');
    out.dim('  The median is used here because it is the one that is hard to get');
    out.dim('  wrong, not because it is the strongest choice available.');
    out.line('');
    out.dim('  A failure above is a statement about this browser\'s clock, not');
    out.dim('  about the vulnerability. performance.now() is coarsened on purpose');
    out.dim('  in pages that are not cross-origin-isolated, and the difference');
    out.dim('  being hunted is one loop iteration. A real attacker repeats far');
    out.dim('  more than this, averages over a network, or measures on the same');
    out.dim('  host with a cycle counter that has none of these limits.');
    out.line('');
    out.dim('  Nothing was uploaded. The secret, the timings and the plot exist');
    out.dim('  only in this tab.');
    progress('done');
    setBusy(false);
  }

  /* ------------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------------ */

  function reportClock(res) {
    out.heading('Clock');
    out.row('  timer in use', usingPerformanceNow ? 'performance.now()' : 'Date.now() fallback');
    out.row('  measured resolution', dur(res.min));
    out.row('  median gap', dur(res.median));
    out.row('  distinct gap sizes', res.distinct + ' across ' + res.gaps + ' non-zero gaps');
    out.row('  identical reads', res.reads ? ((res.zeros / res.reads) * 100).toFixed(1) +
      '% of ' + res.reads + ' consecutive reads' : 'n/a');
    out.row('  crossOriginIsolated', res.isolated === null ? 'not reported by this browser'
      : String(res.isolated));
    out.line('');
    out.warn('  That number is the honest limit on everything below it.');
    out.dim('  Browsers clamp performance.now() as a Spectre mitigation, and the');
    out.dim('  clamp is only relaxed for pages served cross-origin-isolated with');
    out.dim('  COOP and COEP headers. This page is not, and is not trying to be.');
    out.dim('  Values around a tenth of a millisecond, or a whole millisecond,');
    out.dim('  are both ordinary. Some browsers also add randomised jitter, so');
    out.dim('  the smallest gap seen here can be finer than the real clamp.');
    out.dim('  Whatever it says, it is measured in this tab, on this machine,');
    out.dim('  right now — not read off a table.');
    var warn = el('tool-clockwarn');
    if (warn) {
      warn.textContent = 'Measured here, in this tab: performance.now() resolves to about ' +
        dur(res.min) + ', and ' + (res.reads ? ((res.zeros / res.reads) * 100).toFixed(1) : '?') +
        '% of consecutive reads returned an identical value. That coarseness is ' +
        'deliberate, and it is why every sample below compares thousands of times ' +
        'before the clock is read at all.';
    }
  }

  function measureAndReport() {
    out.clear();
    clockInfo = measureClock();
    reportClock(clockInfo);
    out.line('');
    out.dim('  Now press Run the attack.');
  }

  function alphabetFor(key) { return ALPHABETS[key] || ALPHABETS.hex; }

  function validate(secret, cands) {
    var i;
    if (!secret.length) return 'Type a secret for the attack to recover.';
    if (secret.length < MIN_SECRET) {
      return 'The secret needs at least ' + MIN_SECRET + ' characters. Calibration works ' +
        'by timing a guess that fails at the first character against one that fails at ' +
        'the last, and that needs two positions to subtract.';
    }
    if (secret.length > MAX_SECRET) {
      return 'Keep the secret to ' + MAX_SECRET + ' characters or fewer. Every extra ' +
        'character is another full sweep of the alphabet, and this all runs on your ' +
        'processor in this tab.';
    }
    for (i = 0; i < secret.length; i++) {
      if (cands.indexOf(secret.charAt(i)) < 0) {
        return 'Character ' + quoted(secret.charAt(i)) + ' at position ' + (i + 1) +
          ' is not in the chosen alphabet, so the attack could never try it. Widen the ' +
          'alphabet or change that character.';
      }
    }
    return null;
  }

  function run() {
    if (running) return;
    var typed = el('tool-secret').value || '';
    var secret = typed.toLowerCase();
    var cands = alphabetFor(el('tool-alpha').value);
    var modeSel = el('tool-mode').value;
    var rounds = parseInt(el('tool-samples').value, 10) || 21;
    var repsSel = el('tool-reps').value;

    out.clear();
    var bad = validate(secret, cands);
    if (bad) { out.err(bad); return; }
    /* Said rather than done silently: every alphabet here is lower case, so an
       upper-case secret would fail validation for a reason that looks like a
       bug rather than a choice. */
    if (typed !== secret) {
      out.warn('Every alphabet here is lower case, so the secret was folded down');
      out.warn('to "' + secret + '" before the attack was given it.');
      out.line('');
    }

    if (!clockInfo) clockInfo = measureClock();
    reportClock(clockInfo);
    out.line('');

    var modes = modeSel === 'both' ? ['naive', 'ct'] : [modeSel];

    /* Calibration always runs against the naive comparison, whichever mode is
       about to be attacked, so both modes get the same amplification and the
       comparison between them is a comparison of one thing. */
    var cal = calibrate(naiveEqual, secret, clockInfo);
    var fixed = Math.min(MAX_REPS, Math.max(MIN_REPS, parseInt(repsSel, 10) || MIN_REPS));
    var pick = repsSel === 'auto' ? chooseReps(cal, clockInfo)
      : { reps: fixed, wanted: fixed, guessed: false };

    job = {
      secret: secret, cands: cands, modes: modes, rounds: rounds,
      reps: pick.reps, perIter: cal.perIter, perCall: cal.perCall,
      clock: clockInfo, results: [], batches: 0, oracleCalls: 0,
      modeIndex: 0, pos: 0, round: 0, prefix: '', rows: [],
      samples: freshSamples(cands.length), mode: modes[0], cmp: naiveEqual
    };

    var est = estimateMs(job);
    if (est > RUN_BUDGET_MS) {
      var scaled = Math.max(MIN_REPS, Math.floor(job.reps * (RUN_BUDGET_MS / est)));
      job.reps = scaled;
      est = estimateMs(job);
    }

    out.heading('Calibration');
    if (cal.okay) {
      out.row('  cost of one compare', dur(cal.perCall) + ' of fixed overhead');
      out.row('  cost of one character', dur(cal.perIter) + ' inside the loop');
    } else {
      out.warn('  Could not separate the per-character cost from the noise on this');
      out.warn('  machine. Falling back to a fixed amplification, which may be far');
      out.warn('  too small or far too large.');
    }
    out.row('  amplification', job.reps + ' compares per sample' +
      (repsSel === 'auto' ? ' (auto)' : ' (fixed by you)'));
    if (repsSel === 'auto' && !pick.guessed) {
      out.row('  sized by', pick.why === 'noise'
        ? 'the noise floor: ' + pick.forNoise + ' compares to make one batch last ' +
          MIN_BATCH_MS + ' ms (the clock alone would have settled for ' + pick.forClock + ')'
        : 'the clock: ' + pick.forClock + ' compares to put the signal 30 ticks clear ' +
          '(the noise floor alone would have settled for ' + pick.forNoise + ')');
    }
    if (pick.wanted && pick.wanted !== job.reps) {
      out.line('  ' + (repsSel === 'auto'
        ? 'calibration asked for ' + pick.wanted +
          ', to put the signal 30 clock ticks clear;'
        : 'you asked for ' + pick.wanted + ';'), 't-warn');
      out.line('  clamped to ' + job.reps + ' to keep the run near ' +
        seconds(RUN_BUDGET_MS) + '. That costs resolution, and it is the', 't-warn');
      out.line('  most likely reason a position below comes out as noise.', 't-warn');
    }
    out.row('  samples per candidate', rounds + ' (odd, so the median is a real sample)');
    out.row('  candidates', cands.length + ': ' + cands);
    out.row('  secret length', secret.length + ' (assumed known)');
    out.row('  estimated run time', 'about ' + seconds(est));
    out.line('');
    out.dim('  The length is handed to the attack. The same comparison leaks it —');
    out.dim('  the length check returns before a single character is compared —');
    out.dim('  but recovering it is a separate step and is not implemented here.');

    if (est > RUN_REFUSE_MS) {
      out.line('');
      out.err('That would take roughly ' + seconds(est) + ' of solid computation in');
      out.err('this tab. Shorten the secret, pick a smaller alphabet, or drop the');
      out.err('sample count, and run it again.');
      return;
    }

    setBusy(true);
    say('Attack running.');
    startMode(0);
  }

  function randomSecret() {
    var cands = alphabetFor(el('tool-alpha').value);
    var n = 6, s = '', i;
    for (i = 0; i < n; i++) s += cands.charAt(Math.floor(Math.random() * cands.length));
    el('tool-secret').value = s;
    out.clear();
    out.dim('New secret set. Press Run the attack.');
  }

  LabTool.define({
    id: 'timingattack',
    run: run,
    onReady: function () {
      el('tool-stop').addEventListener('click', stop);
      el('tool-clock').addEventListener('click', measureAndReport);
      el('tool-rand').addEventListener('click', randomSecret);
      window.addEventListener('resize', redraw);
      setBusy(false);
      draw(null);
      out.dim('Two comparisons over the same secret. One returns on the first');
      out.dim('mismatched character; the other walks the whole length every time.');
      out.dim('The attack times every candidate character, takes the median of');
      out.dim('many samples, and keeps the slowest.');
      out.line('');
      out.dim('Press "Measure the clock" first if you want the honest limit');
      out.dim('before anything else. Run the attack does it for you either way.');
      out.line('');
      out.dim('Nothing here is uploaded. There is no server to upload to.');
    }
  });
})();

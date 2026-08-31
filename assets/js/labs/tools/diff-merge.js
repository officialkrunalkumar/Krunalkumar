/* ==========================================================================
   diff-merge.js — a real Myers diff and a real three-way merge, in the tab.
   --------------------------------------------------------------------------
   Two things drove this file. The first is that most people's working model of
   a diff is "the tool that tells me the whole file changed", and the reason is
   nearly always invisible: a line ending that flipped from LF to CRLF, an
   editor that trims trailing spaces on save, a final newline that went
   missing. So the line-ending and whitespace accounting is not a footnote
   here. It is printed on every run, in words, and when two inputs differ only
   in how their lines end the report says exactly that sentence and nothing
   more alarming.

   The second is that a three-way merge is easy to explain and almost never
   shown. With a base you can tell which side moved, so "this line was deleted
   on the left" stops being indistinguishable from "this line was added on the
   right". Every changed region here is classified against the base, and the
   ones that genuinely collide are handed back for hand resolution rather than
   guessed at.

   The diff is the greedy O(ND) algorithm from Myers' 1986 paper, with the
   common prefix and suffix trimmed off first and the whole V trace kept so the
   edit script can be walked back out of it. That trace is also what bounds the
   thing: D is capped at MAX_D below, and past the cap the differing middle is
   reported as one delete block plus one insert block, out loud, rather than
   quietly returning a wrong answer or freezing the tab. The linear-space
   refinement in the same paper would remove the cap; it is not here, and the
   output says which of the two you got.

   Deliberately missing: rename and copy detection, binary files, submodules,
   and any understanding of the syntax of what is being compared. It is
   line-oriented, so a reformat that rewraps every line reads as a rewrite in
   every whitespace mode, because at the level of whole lines that is what it
   is. The exported patch and the merge always respect whitespace even when the
   view is told to ignore it — a patch built from an ignore-whitespace diff
   copies the wrong side's indentation into its context lines and then fails to
   apply, which is worse than no patch at all.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  /* --- ceilings, all of them stated on the page and in the output -------- */
  var MAX_CHARS = 400000;   // per input box
  var MAX_LINES = 20000;    // per input box
  var MAX_D = 1200;         // Myers edit-distance ceiling, per comparison
  var MAX_ROWS = 4000;      // rendered rows, so the DOM cannot run away
  var MAX_INTRA = 1500;     // tokens per side for the inside-a-line diff
  var SIM_MIN = 0.34;       // below this, two paired lines are not "the same line"
  var PATCH_CONTEXT = 3;    // what diff, git and patch all default to
  var NO_NL = '\\ No newline at end of file';

  var EQ = 0, DEL = 1, INS = 2;

  var out = null;
  var el = {};
  var st = {
    mode: 'diff',
    base: null, mine: null, theirs: null,
    dispOps: null, dispCapped: false,
    aScan: null, bScan: null,
    patchRows: null, patch: null,
    regions: null, res: null,
    merged: null, mergedMarkers: 0,
    wsCounts: null,
    /* A <textarea> has no way to hold a carriage return. The HTML spec makes
       the element's API value normalise every CRLF and every bare CR to a
       single LF, so the moment a CRLF file is pasted into one of these boxes
       its line endings are gone — which would have made the headline feature
       of this tool a lie told through its own input control. Text loaded from
       a file, and the worked example that needs CRLF, therefore bypass the box
       entirely: the real characters are kept here and the box only shows a
       normalised copy for reading and editing. Typing in a box discards the
       override, because at that point what is in the box IS the text. */
    raw: { base: null, mine: null, theirs: null }
  };

  /* ======================================================================
     1. Reading text into lines, and counting everything invisible about it
     ====================================================================== */

  /* Lines come back WITHOUT their terminators, and the terminators come back
     in a parallel array. Every comparison in this file is on the terminator-
     free line, which is the same decision diff and git make — and it is the
     decision that makes "these two files differ only in their line endings"
     expressible at all, because it turns that case into "zero hunks, but the
     two texts are not byte-identical". */
  function scan(text) {
    var lines = [], ends = [];
    var i = 0, start = 0, n = text.length;
    var crlf = 0, lf = 0, cr = 0, c;
    while (i < n) {
      c = text.charCodeAt(i);
      if (c === 13) {
        lines.push(text.slice(start, i));
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
          ends.push('\r\n'); crlf++; i += 2;
        } else {
          ends.push('\r'); cr++; i += 1;
        }
        start = i;
      } else if (c === 10) {
        lines.push(text.slice(start, i));
        ends.push('\n'); lf++; i += 1; start = i;
      } else {
        i++;
      }
    }
    var finalNL = true;
    if (start < n) { lines.push(text.slice(start)); ends.push(''); finalNL = false; }

    var trail = 0, tabIndent = 0, spaceIndent = 0, k;
    for (k = 0; k < lines.length; k++) {
      if (/[ \t]$/.test(lines[k])) trail++;
      if (lines[k].charAt(0) === '\t') tabIndent++;
      else if (lines[k].charAt(0) === ' ') spaceIndent++;
    }
    return {
      text: text, lines: lines, ends: ends,
      crlf: crlf, lf: lf, cr: cr, finalNL: finalNL,
      bom: text.charCodeAt(0) === 0xfeff,
      trail: trail, tabIndent: tabIndent, spaceIndent: spaceIndent
    };
  }

  function dominantEnding(s) {
    if (s.crlf >= s.lf && s.crlf >= s.cr && s.crlf > 0) return '\r\n';
    if (s.cr > s.lf && s.cr > 0) return '\r';
    return '\n';
  }

  function keyLine(s, ws) {
    if (ws === 'trim') return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    if (ws === 'all') return s.replace(/[ \t]+/g, '');
    return s;
  }

  function keysOf(lines, ws) {
    if (ws === 'respect') return lines;
    var k = [], i;
    for (i = 0; i < lines.length; i++) k.push(keyLine(lines[i], ws));
    return k;
  }

  /* ======================================================================
     2. Myers, greedy, with the trace kept
     ====================================================================== */

  /* The V array holds, for each diagonal k, the furthest x reached with d
     edits. One snapshot per round is kept so walkBack can reconstruct the
     path; that is what makes this O(D^2) in memory rather than O(N+M), and
     it is the whole reason MAX_D exists. With the prefix and the suffix
     trimmed off first, D is the number of lines that actually differ, so the
     cap is generous for edits and tight for "two unrelated files", which is
     exactly the case where an unbounded run would sit there burning the tab. */
  function myers(a, b) {
    var n = a.length, m = b.length, i;
    var ops = [];
    if (n === 0) { for (i = 0; i < m; i++) ops.push(INS); return { ops: ops, d: m, capped: false }; }
    if (m === 0) { for (i = 0; i < n; i++) ops.push(DEL); return { ops: ops, d: n, capped: false }; }

    var max = Math.min(MAX_D, n + m);
    var off = max;
    var v = new Int32Array(2 * max + 1);
    var trace = [];
    var d, k, x, y, snap, kk;

    for (d = 0; d <= max; d++) {
      snap = new Int32Array(2 * d + 1);
      for (k = -d; k <= d; k += 2) {
        /* At k === d the k+1 slot belongs to a diagonal this round has never
           reached, and at k === -d the k-1 slot does. The guard reads left to
           right for a reason: the k !== d test has to short-circuit before the
           comparison, or the k === d === max case reads one past the end of
           the typed array and silently compares against undefined. */
        if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
        else x = v[off + k - 1] + 1;
        y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) {
          for (kk = -d; kk <= d; kk += 2) snap[kk + d] = v[off + kk];
          trace.push(snap);
          return { ops: walkBack(trace, d, n, m), d: d, capped: false };
        }
      }
      for (kk = -d; kk <= d; kk += 2) snap[kk + d] = v[off + kk];
      trace.push(snap);
    }
    return { ops: null, d: max, capped: true };
  }

  /* Walk the trace backwards from (n, m) to the origin. At round d the move
     into diagonal k came either from k+1 (an insertion) or from k-1 (a
     deletion); the snapshot of round d-1 says which, by the same rule the
     forward pass used. Everything between the arrival point and the previous
     endpoint is a snake, i.e. matched lines. */
  function walkBack(trace, dEnd, n, m) {
    var ops = [];
    var x = n, y = m, d, k, snapPrev, down, prevK, prevX, prevY;
    for (d = dEnd; d > 0; d--) {
      snapPrev = trace[d - 1];
      k = x - y;
      if (k === -d) down = true;
      else if (k === d) down = false;
      else down = snapPrev[k - 1 + (d - 1)] < snapPrev[k + 1 + (d - 1)];
      prevK = down ? k + 1 : k - 1;
      prevX = snapPrev[prevK + (d - 1)];
      prevY = prevX - prevK;
      while (x > prevX && y > prevY) { ops.push(EQ); x--; y--; }
      if (down) { ops.push(INS); y--; } else { ops.push(DEL); x--; }
      x = prevX; y = prevY;
    }
    while (x > 0 && y > 0) { ops.push(EQ); x--; y--; }
    ops.reverse();
    return ops;
  }

  /* Trimming the common prefix and suffix before calling myers() is not an
     optimisation detail, it is the difference between this being usable and
     not. Two 5000-line files with one changed line in the middle have D = 2
     after trimming and D = 2 before it as well — but two files with a change
     at the top and another at the bottom would otherwise carry the whole
     matched middle through the V array on every round. */
  function diffKeys(a, b) {
    var n = a.length, m = b.length, i;
    var pre = 0;
    while (pre < n && pre < m && a[pre] === b[pre]) pre++;
    var suf = 0;
    while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;

    var midA = a.slice(pre, n - suf);
    var midB = b.slice(pre, m - suf);
    var core = myers(midA, midB);

    var ops = [];
    for (i = 0; i < pre; i++) ops.push(EQ);
    if (core.capped) {
      for (i = 0; i < midA.length; i++) ops.push(DEL);
      for (i = 0; i < midB.length; i++) ops.push(INS);
    } else {
      for (i = 0; i < core.ops.length; i++) ops.push(core.ops[i]);
    }
    for (i = 0; i < suf; i++) ops.push(EQ);
    return { ops: ops, capped: core.capped, d: core.d };
  }

  /* Maximal runs of non-equal operations, in base coordinates and in side
     coordinates. This is the unit the three-way merge reasons about. */
  function hunksFromOps(ops) {
    var hs = [], i = 0, j = 0, k = 0, lo, sideLo;
    while (k < ops.length) {
      if (ops[k] === EQ) { i++; j++; k++; continue; }
      lo = i; sideLo = j;
      while (k < ops.length && ops[k] !== EQ) {
        if (ops[k] === DEL) i++; else j++;
        k++;
      }
      hs.push({ lo: lo, hi: i, sideLo: sideLo, sideHi: j });
    }
    return hs;
  }

  /* ======================================================================
     3. Inside a changed line
     ====================================================================== */

  function isWordCode(c) {
    return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) ||
           (c >= 97 && c <= 122) || c === 95 || c > 127;
  }

  function splitWords(s) {
    var toks = [], i = 0, n = s.length, j, c;
    while (i < n) {
      c = s.charCodeAt(i);
      if (isWordCode(c)) {
        j = i; while (j < n && isWordCode(s.charCodeAt(j))) j++;
        toks.push(s.slice(i, j)); i = j;
      } else if (c === 32 || c === 9) {
        j = i; while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
        toks.push(s.slice(i, j)); i = j;
      } else {
        toks.push(s.charAt(i)); i++;
      }
    }
    return toks;
  }

  /* charAt() splits a surrogate pair down the middle, so an emoji or any
     astral character came out of the character-level diff as two lone
     surrogates and rendered as a pair of replacement boxes on BOTH sides —
     making an unchanged emoji look like a change. Pairs are kept together. */
  function splitChars(s) {
    var t = [], i = 0, c;
    while (i < s.length) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { t.push(s.substr(i, 2)); i += 2; }
      else { t.push(s.charAt(i)); i++; }
    }
    return t;
  }

  function pushSeg(list, t, s) {
    if (list.length && list[list.length - 1].t === t) list[list.length - 1].s += s;
    else list.push({ t: t, s: s });
  }

  /* Two lines only get an inside-the-line diff if they are plausibly the same
     line edited. Below SIM_MIN shared characters the highlighting stops being
     a reading aid and starts being noise — it finds the three spaces and the
     semicolon that two unrelated lines happen to share and paints everything
     else, which reads as if the tool has no idea what changed. It does not, in
     that case, and says so by marking the whole line instead. */
  function intraPair(aLine, bLine, mode) {
    if (mode === 'off') return null;
    var at = mode === 'char' ? splitChars(aLine) : splitWords(aLine);
    var bt = mode === 'char' ? splitChars(bLine) : splitWords(bLine);
    if (at.length > MAX_INTRA || bt.length > MAX_INTRA) return null;
    var r = diffKeys(at, bt);
    if (r.capped) return null;

    var A = [], B = [], i = 0, j = 0, k, same = 0;
    for (k = 0; k < r.ops.length; k++) {
      if (r.ops[k] === EQ) {
        same += at[i].length;
        pushSeg(A, '=', at[i]); pushSeg(B, '=', bt[j]); i++; j++;
      } else if (r.ops[k] === DEL) {
        pushSeg(A, '-', at[i]); i++;
      } else {
        pushSeg(B, '+', bt[j]); j++;
      }
    }
    var total = aLine.length + bLine.length;
    var sim = total ? (2 * same) / total : 1;
    if (sim < SIM_MIN) return null;
    return { a: A, b: B, sim: sim };
  }

  /* ======================================================================
     4. Rows — one screen line, or one patch line, per entry
     ====================================================================== */

  /* Within a changed block the deletions are paired with the insertions by
     position: the first removed line against the first added line, and so on.
     Leftovers on either end are pure removals or pure additions. This is what
     makes a one-character edit read as a modification rather than as a
     delete-then-add of two unrelated lines. The ap and bp fields carry the cursor
     position for rows that exist on only one side, because the @@ header
     arithmetic needs a line number even for a hunk that adds and removes
     nothing on that side. */
  function buildRows(aLines, bLines, ops) {
    var rows = [], i = 0, j = 0, k = 0, dels, inss, p, pairs, i1, j1;
    while (k < ops.length) {
      if (ops[k] === EQ) {
        rows.push({
          t: aLines[i] === bLines[j] ? 'eq' : 'ws',
          a: i, b: j, ap: i, bp: j
        });
        i++; j++; k++;
        continue;
      }
      dels = []; inss = [];
      while (k < ops.length && ops[k] !== EQ) {
        if (ops[k] === DEL) { dels.push(i); i++; } else { inss.push(j); j++; }
        k++;
      }
      i1 = i; j1 = j;
      pairs = Math.min(dels.length, inss.length);
      for (p = 0; p < pairs; p++) {
        rows.push({ t: 'mod', a: dels[p], b: inss[p], ap: dels[p], bp: inss[p] });
      }
      for (p = pairs; p < dels.length; p++) {
        rows.push({ t: 'del', a: dels[p], b: -1, ap: dels[p], bp: j1 });
      }
      for (p = pairs; p < inss.length; p++) {
        rows.push({ t: 'ins', a: -1, b: inss[p], ap: i1, bp: inss[p] });
      }
    }
    return rows;
  }

  /* A context line has to mean "this line is identical on both sides", and a
     line's trailing newline is part of that. If one side's copy is the last
     line of a file with no final newline and the other side's is not, the two
     are not the same line, and emitting it as context produces a patch that
     claims a newline exists where it does not. git splits that line into a
     removal and an addition so the "\ No newline" marker can attach to the
     right side; so does this. Only the patch rows get this treatment — on
     screen the missing newline is shown as a mark and named in the report. */
  function fixNoNewline(rows, aScan, bScan) {
    var i, r, aHasNL, bHasNL;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (r.t !== 'eq' && r.t !== 'ws') continue;
      aHasNL = !(r.a === aScan.lines.length - 1 && !aScan.finalNL);
      bHasNL = !(r.b === bScan.lines.length - 1 && !bScan.finalNL);
      if (aHasNL !== bHasNL) r.t = 'mod';
    }
  }

  /* Runs of changed rows, each padded with the chosen number of unchanged rows, with
     neighbouring runs merged when their padding would touch. Same rule diff
     uses, which is why the hunks this produces line up with what git shows. */
  function groupRows(rows, context) {
    var changed = [], i, groups = [], gs, ge;
    for (i = 0; i < rows.length; i++) if (rows[i].t !== 'eq') changed.push(i);
    if (!changed.length) return [];
    gs = Math.max(0, changed[0] - context);
    ge = Math.min(rows.length - 1, changed[0] + context);
    for (i = 1; i < changed.length; i++) {
      if (changed[i] - context <= ge + 1) {
        ge = Math.min(rows.length - 1, changed[i] + context);
      } else {
        groups.push({ s: gs, e: ge });
        gs = Math.max(0, changed[i] - context);
        ge = Math.min(rows.length - 1, changed[i] + context);
      }
    }
    groups.push({ s: gs, e: ge });
    return groups;
  }

  /* @@ -start,count +start,count @@. Two rules that are easy to get wrong and
     make the patch unusable when you do: a count of 1 is written without the
     comma, the way diff and git write it, and a count of 0 takes the line
     number BEFORE the range rather than the first line of it, because there
     is no first line. An insertion at the top of a file is @@ -0,0 +1,3 @@. */
  function headerRange(start, count) {
    return count === 1 ? String(start) : (start + ',' + count);
  }

  function hunkHeader(rows, g) {
    var i, r, aCount = 0, bCount = 0, aFirst = -1, bFirst = -1;
    for (i = g.s; i <= g.e; i++) {
      r = rows[i];
      if (r.a >= 0) { aCount++; if (aFirst < 0) aFirst = r.a; }
      if (r.b >= 0) { bCount++; if (bFirst < 0) bFirst = r.b; }
    }
    return {
      aStart: aCount ? aFirst + 1 : rows[g.s].ap,
      aCount: aCount,
      bStart: bCount ? bFirst + 1 : rows[g.s].bp,
      bCount: bCount,
      text: '@@ -' + headerRange(aCount ? aFirst + 1 : rows[g.s].ap, aCount) +
            ' +' + headerRange(bCount ? bFirst + 1 : rows[g.s].bp, bCount) + ' @@'
    };
  }

  function emitPatch(aScan, bScan, rows, name, context) {
    var groups = groupRows(rows, context);
    var res = { text: '', hunks: 0, plus: 0, minus: 0 };
    if (!groups.length) return res;

    var lines = ['--- a/' + name, '+++ b/' + name];

    function pushA(prefix, idx) {
      lines.push(prefix + aScan.lines[idx]);
      if (!aScan.finalNL && idx === aScan.lines.length - 1) lines.push(NO_NL);
    }
    function pushB(prefix, idx) {
      lines.push(prefix + bScan.lines[idx]);
      if (!bScan.finalNL && idx === bScan.lines.length - 1) lines.push(NO_NL);
    }

    var gi, i, r, g;
    for (gi = 0; gi < groups.length; gi++) {
      g = groups[gi];
      lines.push(hunkHeader(rows, g).text);
      res.hunks++;
      for (i = g.s; i <= g.e; i++) {
        r = rows[i];
        if (r.t === 'eq') { pushA(' ', r.a); }
        else if (r.t === 'del') { pushA('-', r.a); res.minus++; }
        else if (r.t === 'ins') { pushB('+', r.b); res.plus++; }
        else { pushA('-', r.a); res.minus++; pushB('+', r.b); res.plus++; }
      }
    }
    res.text = lines.join('\n') + '\n';
    return res;
  }

  /* ======================================================================
     5. Three-way merge
     ====================================================================== */

  /* When do two edits collide? Overlapping base ranges, obviously. The awkward
     case is an insertion, which covers no base lines at all and so overlaps
     nothing under the ordinary interval test. The rule used here, stated on
     the page as well: an insertion collides with another edit only when it
     lands strictly inside that edit's range, or at exactly the same point as
     another insertion. So two people adding a line in the same gap is a
     conflict, and one person appending after the block another person
     rewrote is not. */
  function collide(h1, h2) {
    var p1 = h1.lo === h1.hi, p2 = h2.lo === h2.hi;
    if (p1 && p2) return h1.lo === h2.lo;
    if (p1) return h1.lo > h2.lo && h1.lo < h2.hi;
    if (p2) return h2.lo > h1.lo && h2.lo < h1.hi;
    return h1.lo < h2.hi && h2.lo < h1.hi;
  }

  /* Base position to side position, for a position no hunk of that side
     covers: everything before it has already shifted by the net size change
     of the hunks that end before it. */
  function stableSide(hunks, i) {
    var d = 0, k;
    for (k = 0; k < hunks.length; k++) {
      if (hunks[k].hi <= i) d += (hunks[k].sideHi - hunks[k].sideLo) - (hunks[k].hi - hunks[k].lo);
      else break;
    }
    return i + d;
  }

  function sideRange(mine, all, rs, re) {
    var lo, hi;
    if (mine.length) {
      lo = mine[0].sideLo - (mine[0].lo - rs);
      hi = mine[mine.length - 1].sideHi + (re - mine[mine.length - 1].hi);
    } else {
      lo = stableSide(all, rs);
      hi = lo + (re - rs);
    }
    return { lo: lo, hi: hi };
  }

  function sameLines(a, b) {
    if (a.length !== b.length) return false;
    var i;
    for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function threeWay(baseS, mineS, theirsS) {
    var dm = diffKeys(baseS.lines, mineS.lines);
    var dt = diffKeys(baseS.lines, theirsS.lines);
    var hm = hunksFromOps(dm.ops), ht = hunksFromOps(dt.ops);
    var all = [], i, j, h;

    for (i = 0; i < hm.length; i++) { hm[i].side = 'm'; all.push(hm[i]); }
    for (i = 0; i < ht.length; i++) { ht[i].side = 't'; all.push(ht[i]); }
    all.sort(function (p, q) { return p.lo - q.lo || p.hi - q.hi; });

    var groups = [], g = null, joins;
    for (i = 0; i < all.length; i++) {
      h = all[i];
      joins = false;
      if (g) {
        for (j = 0; j < g.length; j++) { if (collide(h, g[j])) { joins = true; break; } }
      }
      if (joins) g.push(h);
      else { if (g) groups.push(g); g = [h]; }
    }
    if (g) groups.push(g);

    var regions = [], cur = 0, conflicts = 0;
    for (i = 0; i < groups.length; i++) {
      var grp = groups[i];
      var rs = grp[0].lo, re = grp[0].hi, gm = [], gt = [], k;
      for (k = 0; k < grp.length; k++) {
        if (grp[k].lo < rs) rs = grp[k].lo;
        if (grp[k].hi > re) re = grp[k].hi;
        if (grp[k].side === 'm') gm.push(grp[k]); else gt.push(grp[k]);
      }
      if (rs > cur) regions.push({ kind: 'same', lines: baseS.lines.slice(cur, rs), lo: cur, hi: rs });

      var mr = sideRange(gm, hm, rs, re);
      var tr = sideRange(gt, ht, rs, re);
      var bText = baseS.lines.slice(rs, re);
      var mText = mineS.lines.slice(mr.lo, mr.hi);
      var tText = theirsS.lines.slice(tr.lo, tr.hi);

      if (!gm.length) {
        regions.push({ kind: 'theirs', lines: tText, base: bText, mine: mText, theirs: tText, lo: rs, hi: re });
      } else if (!gt.length) {
        regions.push({ kind: 'mine', lines: mText, base: bText, mine: mText, theirs: tText, lo: rs, hi: re });
      } else if (sameLines(mText, tText)) {
        regions.push({ kind: 'both', lines: mText, base: bText, mine: mText, theirs: tText, lo: rs, hi: re });
      } else {
        conflicts++;
        regions.push({ kind: 'conflict', lines: null, base: bText, mine: mText, theirs: tText, lo: rs, hi: re });
      }
      cur = re;
    }
    if (cur < baseS.lines.length) {
      regions.push({ kind: 'same', lines: baseS.lines.slice(cur), lo: cur, hi: baseS.lines.length });
    }
    return {
      regions: regions, conflicts: conflicts,
      capped: dm.capped || dt.capped,
      mineHunks: hm.length, theirHunks: ht.length
    };
  }

  /* The merged file. Unresolved conflicts keep the same markers git leaves,
     including the |||||||  base section, because that section is the whole
     argument for three-way in the first place. */
  function mergedLines() {
    var lines = [], markers = 0, i, k, r, chosen;
    for (i = 0; i < st.regions.length; i++) {
      r = st.regions[i];
      if (r.kind === 'conflict') {
        chosen = st.res[i];
        if (chosen) { for (k = 0; k < chosen.length; k++) lines.push(chosen[k]); continue; }
        markers++;
        lines.push('<<<<<<< mine');
        for (k = 0; k < r.mine.length; k++) lines.push(r.mine[k]);
        lines.push('||||||| base');
        for (k = 0; k < r.base.length; k++) lines.push(r.base[k]);
        lines.push('=======');
        for (k = 0; k < r.theirs.length; k++) lines.push(r.theirs[k]);
        lines.push('>>>>>>> theirs');
        continue;
      }
      for (k = 0; k < r.lines.length; k++) lines.push(r.lines[k]);
    }
    st.mergedMarkers = markers;
    return lines;
  }

  /* ======================================================================
     6. Drawing
     ====================================================================== */

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function markTrailing(segs) {
    if (!segs.length) return segs;
    var last = segs[segs.length - 1];
    var m = /[ \t]+$/.exec(last.s);
    if (!m) return segs;
    var keep = last.s.slice(0, last.s.length - m[0].length);
    var copy = segs.slice(0, segs.length - 1);
    if (keep) copy.push({ t: last.t, s: keep });
    copy.push({ t: 'w', s: m[0] });
    return copy;
  }

  function segClass(t) {
    if (t === '-') return 'dm-x';
    if (t === '+') return 'dm-y';
    return 'dm-s';
  }

  function paintSegs(cell, segs, marks) {
    var i, j, seg, cls, parts, ch;
    for (i = 0; i < segs.length; i++) {
      seg = segs[i];
      if (seg.t === 'w') {
        for (j = 0; j < seg.s.length; j++) {
          ch = seg.s.charAt(j) === '\t' ? '→' : '·';
          cell.appendChild(mk('span', 'dm-mark', ch));
        }
        continue;
      }
      cls = segClass(seg.t);
      if (!marks) { cell.appendChild(mk('span', cls, seg.s)); continue; }
      parts = seg.s.split('\t');
      for (j = 0; j < parts.length; j++) {
        if (j) cell.appendChild(mk('span', 'dm-mark', '→'));
        if (parts[j]) cell.appendChild(mk('span', cls, parts[j]));
      }
    }
  }

  function endingMark(ending) {
    if (ending === '\r\n') return '␍␊';
    if (ending === '\r') return '␍';
    if (ending === '\n') return '␊';
    return '';
  }

  function cellFor(segs, scanned, idx, marks) {
    var cell = mk('span', 'dm-text');
    if (idx < 0) { cell.className = 'dm-text dm-empty'; return cell; }
    paintSegs(cell, marks ? markTrailing(segs) : segs, marks);
    if (marks) {
      var e = endingMark(scanned.ends[idx]);
      if (e) cell.appendChild(mk('span', 'dm-mark', e));
      else cell.appendChild(mk('span', 'dm-mark', '[no newline]'));
    }
    return cell;
  }

  function segsFor(line) { return [{ t: '=', s: line }]; }

  var SIGN = { eq: ' ', ws: '≈', mod: '~', del: '-', ins: '+' };

  function rowSegments(row, aLines, bLines, intraMode) {
    var pair = null;
    if (row.t === 'mod' && row.a >= 0 && row.b >= 0) {
      pair = intraPair(aLines[row.a], bLines[row.b], intraMode);
    }
    if (pair) return { a: pair.a, b: pair.b, partial: true };
    if (row.t === 'mod') {
      return {
        a: [{ t: '-', s: aLines[row.a] }],
        b: [{ t: '+', s: bLines[row.b] }],
        partial: false
      };
    }
    if (row.t === 'del') return { a: [{ t: '-', s: aLines[row.a] }], b: [], partial: false };
    if (row.t === 'ins') return { a: [], b: [{ t: '+', s: bLines[row.b] }], partial: false };
    return { a: segsFor(aLines[row.a]), b: segsFor(bLines[row.b]), partial: false };
  }

  function skipRow(cols, n) {
    var r = mk('div', 'dm-row dm-skip');
    var cell = mk('span', 'dm-skiptext',
      n + (n === 1 ? ' unchanged line hidden' : ' unchanged lines hidden'));
    cell.style.gridColumn = '1 / -1';
    r.appendChild(cell);
    return r;
  }

  function renderView() {
    var host = el.view;
    host.textContent = '';
    if (!st.dispRows) return;

    var marks = el.marks.checked;
    var intraMode = el.intra.value;
    var unified = el.view2.value === 'unified';
    var ctxSel = el.context.value;
    var aLines = st.aScan.lines, bLines = st.bScan.lines;
    var rows = st.dispRows;

    if (!rows.length) {
      host.appendChild(mk('p', 'dm-none', 'Both sides are empty, so there is nothing to compare.'));
      return;
    }

    var groups;
    if (ctxSel === 'all') groups = [{ s: 0, e: rows.length - 1 }];
    else groups = groupRows(rows, parseInt(ctxSel, 10));

    /* Zero differing lines and two texts that are not the same bytes is the
       line-ending case, and printing "no differences" over it would be the
       single most useless answer this tool could give. Draw every line with
       the marks forced on instead, so the CR is on screen where the eye can
       find it, and say why the marks came on by themselves. */
    var forced = false;
    if (!groups.length && st.aScan.text !== st.bScan.text) {
      groups = [{ s: 0, e: rows.length - 1 }];
      marks = true;
      forced = true;
      host.appendChild(mk('p', 'dm-none',
        'Every line of text matches, so there is nothing to mark as changed — ' +
        'but the two are not the same bytes. Line-ending marks are switched on ' +
        'below so you can see where they differ: ␍ is a carriage return, ␊ a line feed.'));
    }
    if (!groups.length) {
      host.appendChild(mk('p', 'dm-none',
        'No differing lines. Anything the two texts do not share is reported below rather than drawn here.'));
      return;
    }
    if (forced) ctxSel = 'all';

    var frag = document.createDocumentFragment();
    var drawn = 0, gi, i, prevEnd = -1, g, row, segs, r, hdr;

    for (gi = 0; gi < groups.length && drawn < MAX_ROWS; gi++) {
      g = groups[gi];
      if (ctxSel !== 'all') {
        /* The skipped-lines note goes above the @@ header, not below it: it
           describes the gap that was just jumped over, and printing it under
           the header read as if the header's own hunk had been elided. */
        if (g.s > prevEnd + 1) frag.appendChild(skipRow(0, g.s - prevEnd - 1));
        hdr = hunkHeader(rows, g);
        r = mk('div', 'dm-row dm-hunk');
        var htext = mk('span', 'dm-hunktext', hdr.text);
        htext.style.gridColumn = '1 / -1';
        r.appendChild(htext);
        frag.appendChild(r);
      }
      for (i = g.s; i <= g.e && drawn < MAX_ROWS; i++) {
        row = rows[i];
        segs = rowSegments(row, aLines, bLines, intraMode);
        if (unified) {
          if (row.t === 'mod') {
            frag.appendChild(uniRow('-', 'dm-del', row.a, -1, segs.a, [], marks));
            frag.appendChild(uniRow('+', 'dm-ins', -1, row.b, [], segs.b, marks));
            drawn += 2;
          } else if (row.t === 'ws') {
            frag.appendChild(uniRow('≈', 'dm-ws', row.a, row.b, segs.a, [], marks));
            frag.appendChild(uniRow('≈', 'dm-ws', row.a, row.b, [], segs.b, marks));
            drawn += 2;
          } else if (row.t === 'del') {
            frag.appendChild(uniRow('-', 'dm-del', row.a, -1, segs.a, [], marks)); drawn++;
          } else if (row.t === 'ins') {
            frag.appendChild(uniRow('+', 'dm-ins', -1, row.b, [], segs.b, marks)); drawn++;
          } else if (marks && st.aScan.ends[row.a] !== st.bScan.ends[row.b]) {
            /* Unified normally prints one row for a line both sides share.
               With the marks on and the two terminators different, one row can
               only show one of them — which is the exact case the marks exist
               for. Both get a row. */
            frag.appendChild(uniRow(' ', 'dm-eq', row.a, -1, segs.a, [], marks));
            frag.appendChild(uniRow(' ', 'dm-eq', -1, row.b, [], segs.b, marks));
            drawn += 2;
          } else {
            frag.appendChild(uniRow(' ', 'dm-eq', row.a, row.b, segs.a, [], marks)); drawn++;
          }
        } else {
          frag.appendChild(sideRow(row, segs, marks));
          drawn++;
        }
      }
      prevEnd = g.e;
    }

    host.appendChild(frag);
    if (drawn >= MAX_ROWS) {
      host.appendChild(mk('p', 'dm-none',
        'Drawing stopped at ' + MAX_ROWS + ' rows so the page stays usable. ' +
        'The counts and the exported patch below still cover the whole input.'));
    }
  }

  function uniRow(sign, cls, aIdx, bIdx, aSegs, bSegs, marks) {
    var r = mk('div', 'dm-row dm-uni ' + cls);
    r.appendChild(mk('span', 'dm-num', aIdx >= 0 ? String(aIdx + 1) : ''));
    r.appendChild(mk('span', 'dm-num', bIdx >= 0 ? String(bIdx + 1) : ''));
    r.appendChild(mk('span', 'dm-sign', sign));
    if (aSegs.length || !bSegs.length) {
      r.appendChild(cellFor(aSegs, st.aScan, aIdx, marks));
    } else {
      r.appendChild(cellFor(bSegs, st.bScan, bIdx, marks));
    }
    return r;
  }

  function sideRow(row, segs, marks) {
    var cls = 'dm-row dm-side dm-' + row.t;
    var r = mk('div', cls);
    r.appendChild(mk('span', 'dm-num', row.a >= 0 ? String(row.a + 1) : ''));
    r.appendChild(mk('span', 'dm-sign',
      row.a < 0 ? '' : (row.t === 'eq' ? ' ' : (row.t === 'ws' ? '≈' : (row.t === 'ins' ? '' : '-')))));
    r.appendChild(cellFor(segs.a, st.aScan, row.a, marks));
    r.appendChild(mk('span', 'dm-num', row.b >= 0 ? String(row.b + 1) : ''));
    r.appendChild(mk('span', 'dm-sign',
      row.b < 0 ? '' : (row.t === 'eq' ? ' ' : (row.t === 'ws' ? '≈' : (row.t === 'del' ? '' : '+')))));
    r.appendChild(cellFor(segs.b, st.bScan, row.b, marks));
    return r;
  }

  /* ======================================================================
     7. Conflict cards
     ====================================================================== */

  function preOf(lines) {
    var p = mk('pre', 'dm-pre', lines.length ? lines.join('\n') : '(nothing — this side has no lines here)');
    return p;
  }

  function resolveWith(idx, lines, label) {
    return function () {
      st.res[idx] = lines.slice(0);
      var box = document.getElementById('dm-edit-' + idx);
      if (box) box.value = lines.join('\n');
      var tag = document.getElementById('dm-chosen-' + idx);
      if (tag) tag.textContent = 'Resolved: ' + label;
      afterResolution();
    };
  }

  function conflictCard(region, number, idx) {
    var card = mk('div', 'dm-conflict');
    card.appendChild(mk('p', 'dm-conflict-h',
      'Conflict ' + number + ' — base lines ' +
      (region.hi > region.lo ? (region.lo + 1) + ' to ' + region.hi
                             : 'inserted before line ' + (region.lo + 1))));

    var three = mk('div', 'dm-three');
    var cols = [['Base', region.base], ['Mine', region.mine], ['Theirs', region.theirs]];
    var c;
    for (c = 0; c < cols.length; c++) {
      var col = mk('div', 'dm-col');
      col.appendChild(mk('p', 'dm-col-h', cols[c][0]));
      col.appendChild(preOf(cols[c][1]));
      three.appendChild(col);
    }
    card.appendChild(three);

    var acts = mk('div', 'dm-acts');
    var both = region.mine.concat(region.theirs);
    var flip = region.theirs.concat(region.mine);
    var buttons = [
      ['Take mine', region.mine, 'mine'],
      ['Take theirs', region.theirs, 'theirs'],
      ['Mine, then theirs', both, 'mine then theirs'],
      ['Theirs, then mine', flip, 'theirs then mine'],
      ['Take base', region.base, 'base']
    ];
    var bi, btn;
    for (bi = 0; bi < buttons.length; bi++) {
      btn = mk('button', 'lab-btn', buttons[bi][0]);
      btn.type = 'button';
      btn.setAttribute('aria-label', buttons[bi][0] + ' for conflict ' + number);
      btn.addEventListener('click', resolveWith(idx, buttons[bi][1], buttons[bi][2]));
      acts.appendChild(btn);
    }

    var tag = mk('span', 'dm-chosen', 'Unresolved — the merged file keeps the markers');
    tag.id = 'dm-chosen-' + idx;
    acts.appendChild(tag);
    card.appendChild(acts);

    var lab = mk('label', 'dm-editlabel',
      'Or write the resolution to conflict ' + number + ' yourself');
    lab.setAttribute('for', 'dm-edit-' + idx);
    card.appendChild(lab);

    var box = mk('textarea', 'dm-edit');
    box.id = 'dm-edit-' + idx;
    box.spellcheck = false;
    box.value = region.mine.join('\n');
    box.addEventListener('input', editHandler(idx, number));
    card.appendChild(box);

    return card;
  }

  function editHandler(idx, number) {
    return function (ev) {
      var text = ev.target.value;
      /* An empty box means an empty resolution, not "unresolved" — deleting
         the whole region is a legitimate answer to a conflict, and treating it
         as "not yet decided" would put the markers back under the visitor. */
      st.res[idx] = text === '' ? [] : text.split('\n');
      var tag = document.getElementById('dm-chosen-' + idx);
      if (tag) tag.textContent = 'Resolved: your own text';
      afterResolution();
    };
  }

  function renderConflicts() {
    var host = el.conflicts;
    host.textContent = '';
    var n = 0, i;
    for (i = 0; i < st.regions.length; i++) {
      if (st.regions[i].kind !== 'conflict') continue;
      n++;
      host.appendChild(conflictCard(st.regions[i], n, i));
    }
    if (!n) {
      host.appendChild(mk('p', 'dm-none',
        'No conflicts. Every changed region was changed on one side only, or both sides made the identical change.'));
    }
  }

  /* ======================================================================
     8. Putting a run together
     ====================================================================== */

  function tooBig(name, s) {
    if (s.text.length > MAX_CHARS) {
      return name + ' is ' + s.text.length.toLocaleString() + ' characters. This stops at ' +
             MAX_CHARS.toLocaleString() + ', because the comparison runs on your processor in this tab.';
    }
    if (s.lines.length > MAX_LINES) {
      return name + ' is ' + s.lines.length.toLocaleString() + ' lines. This stops at ' +
             MAX_LINES.toLocaleString() + ', because the comparison runs on your ' +
             'processor in this tab.';
    }
    return null;
  }

  function exportEnding() {
    var v = el.eol.value;
    if (v === 'lf') return '\n';
    if (v === 'crlf') return '\r\n';
    return dominantEnding(st.mode === 'merge' ? st.base : st.mine);
  }

  function joinWith(lines, ending, finalNL) {
    if (!lines.length) return '';
    return lines.join(ending) + (finalNL ? ending : '');
  }

  function afterResolution() {
    var lines = mergedLines();
    var ending = '\n';
    var finalNL = st.base.finalNL || st.mine.finalNL || st.theirs.finalNL;
    st.merged = lines;
    st.bScan = scan(joinWith(lines, ending, finalNL));
    recomputeDisplay();
    renderMerged();
    renderView();
    writeReport();
    setStatus();
  }

  function renderMerged() {
    el.merged.textContent = st.merged.join('\n');
  }

  function recomputeDisplay() {
    var ws = el.ws.value;
    var aKeys = keysOf(st.aScan.lines, ws);
    var bKeys = keysOf(st.bScan.lines, ws);
    var d = diffKeys(aKeys, bKeys);
    st.dispOps = d.ops;
    st.dispCapped = d.capped;
    st.dispD = d.d;
    st.dispRows = buildRows(st.aScan.lines, st.bScan.lines, d.ops);

    var raw = ws === 'respect' ? d : diffKeys(st.aScan.lines, st.bScan.lines);
    st.rawCapped = raw.capped;
    st.patchRows = buildRows(st.aScan.lines, st.bScan.lines, raw.ops);
    fixNoNewline(st.patchRows, st.aScan, st.bScan);
    st.patch = emitPatch(st.aScan, st.bScan, st.patchRows,
                         (el.name.value || 'file.txt').replace(/[\\/]+/g, '_'),
                         PATCH_CONTEXT);

    st.wsCounts = whitespaceImpact();
  }

  /* The number people actually want when a diff is inexplicably enormous.

     buildRows marks a pair that matches only after normalising as 'ws' rather
     than 'eq', so the view can draw it with the ≈ sign instead of pretending
     the two lines are identical. That distinction has to be undone here: for
     the purpose of counting hunks in a mode that ignores whitespace, a line
     that matches under that mode is unchanged, and leaving it as 'ws' made
     every count come back the same as "respect" — which is precisely the
     comparison this block exists to make. */
  function countHunksIn(a, b, ws) {
    var d = diffKeys(keysOf(a, ws), keysOf(b, ws));
    if (d.capped) return -1;
    var rows = buildRows(a, b, d.ops), i;
    for (i = 0; i < rows.length; i++) if (rows[i].t === 'ws') rows[i].t = 'eq';
    return groupRows(rows, PATCH_CONTEXT).length;
  }

  function whitespaceImpact() {
    var a = st.aScan.lines, b = st.bScan.lines;
    if (a.length + b.length > 8000) return null;
    return {
      respect: countHunksIn(a, b, 'respect'),
      trim: countHunksIn(a, b, 'trim'),
      all: countHunksIn(a, b, 'all')
    };
  }

  function run() {
    if (!out) return;
    try {
      compute();
    } catch (err) {
      out.rule();
      out.err('Something in that comparison went wrong and it stopped early.');
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
      setStatusText('Stopped on an error', 'is-err');
    }
  }

  function sourceText(which) {
    return st.raw[which] === null ? el[which].value : st.raw[which];
  }

  function compute() {
    st.mode = el.mode.value;
    st.base = scan(sourceText('base'));
    st.mine = scan(sourceText('mine'));
    st.theirs = scan(sourceText('theirs'));

    var problems = [];
    var p;
    if (st.mode === 'merge') {
      p = tooBig('Base', st.base); if (p) problems.push(p);
    }
    p = tooBig(st.mode === 'merge' ? 'Mine' : 'The original', st.mine); if (p) problems.push(p);
    p = tooBig(st.mode === 'merge' ? 'Theirs' : 'The changed text', st.theirs); if (p) problems.push(p);
    if (problems.length) {
      out.clear();
      out.err('Too much text to compare here.');
      out.line('');
      for (p = 0; p < problems.length; p++) out.warn(problems[p]);
      out.line('');
      out.dim('Cut it down, or run git diff locally — that is the right tool for a whole repository.');
      el.view.textContent = '';
      setStatusText('Input above the ceiling', 'is-err');
      return;
    }

    st.res = {};

    if (st.mode === 'merge') {
      el.basewrap.hidden = false;
      el.mergePanel.hidden = false;
      el.mineLabel.textContent = 'Mine — your side of the merge';
      el.theirsLabel.textContent = 'Theirs — the other side';
      el.viewLabel.textContent =
        'Diff — the base against the merged result, redrawn as you resolve';
      el.download.disabled = false;
      var tw = threeWay(st.base, st.mine, st.theirs);
      st.regions = tw.regions;
      st.three = tw;
      st.aScan = st.base;
      renderConflicts();
      afterResolution();
      return;
    }

    el.basewrap.hidden = true;
    el.mergePanel.hidden = true;
    el.mineLabel.textContent = 'Original — the a side of the diff';
    el.theirsLabel.textContent = 'Changed — the b side of the diff';
    el.viewLabel.textContent = 'Diff — the original against the changed text';
    el.download.disabled = true;
    st.regions = null;
    st.three = null;
    st.merged = null;
    st.aScan = st.mine;
    st.bScan = st.theirs;
    recomputeDisplay();
    renderView();
    writeReport();
    setStatus();
  }

  function setStatusText(text, cls) {
    el.status.className = 'lab-status' + (cls ? ' ' + cls : '');
    el.status.textContent = text;
  }

  function setStatus() {
    var p = st.patch;
    var bits = p.hunks + (p.hunks === 1 ? ' hunk' : ' hunks') +
               ', +' + p.plus + ' −' + p.minus;
    if (st.mode === 'merge') {
      var unresolved = st.mergedMarkers;
      bits = st.three.conflicts + (st.three.conflicts === 1 ? ' conflict' : ' conflicts') +
             ', ' + (st.three.conflicts - unresolved) + ' resolved · ' + bits + ' against base';
      setStatusText(bits, unresolved ? 'is-busy' : 'is-ok');
      return;
    }
    if (!p.hunks) {
      if (st.aScan.text === st.bScan.text) setStatusText('Byte-for-byte identical', 'is-ok');
      else setStatusText('Every line matches — only the invisible characters differ', 'is-busy');
      return;
    }
    setStatusText(bits, '');
  }

  /* ======================================================================
     9. The report — the part that says what it could not tell you
     ====================================================================== */

  function endingText(s) {
    var bits = [];
    if (s.crlf) bits.push(s.crlf + ' CRLF');
    if (s.lf) bits.push(s.lf + ' LF');
    if (s.cr) bits.push(s.cr + ' bare CR');
    if (!bits.length) return 'none at all';
    return bits.join(', ') + (bits.length > 1 ? '   MIXED' : '');
  }

  function reportSide(label, s) {
    out.row(label + ' lines', s.lines.length);
    out.row(label + ' characters', s.text.length);
    out.row(label + ' line endings', endingText(s));
    out.row(label + ' final newline', s.finalNL ? 'yes' : 'no');
    out.row(label + ' trailing whitespace', s.trail + (s.trail === 1 ? ' line' : ' lines'));
    if (s.tabIndent && s.spaceIndent) {
      out.row(label + ' indentation', s.tabIndent + ' tab, ' + s.spaceIndent + ' space   MIXED');
    }
    if (s.bom) out.row(label + ' byte order mark', 'yes — U+FEFF before line 1');
  }

  /* The headline case. Two texts whose line arrays match exactly but whose
     bytes do not can only differ in line terminators, and that is the single
     most common reason a diff comes out enormous for no visible reason. It
     gets said in a full sentence, before anything else. */
  function endingVerdict(a, b, aName, bName) {
    if (a.text === b.text) {
      out.ok(aName + ' and ' + bName + ' are byte-for-byte identical.');
      return true;
    }
    if (!sameLines(a.lines, b.lines)) return false;

    var diffEnds = 0, i;
    for (i = 0; i < a.ends.length; i++) if (a.ends[i] !== b.ends[i]) diffEnds++;

    out.warn('These two differ ONLY in line endings and nothing else.');
    out.line('');
    out.dim('Every line of text is identical. What is different is invisible:');
    if (diffEnds) {
      out.row('lines ending differently', diffEnds + ' of ' + a.lines.length);
      out.row(aName, endingText(a));
      out.row(bName, endingText(b));
    }
    if (a.finalNL !== b.finalNL) {
      out.row('final newline', aName + ': ' + (a.finalNL ? 'yes' : 'no') +
                               '   ' + bName + ': ' + (b.finalNL ? 'yes' : 'no'));
    }
    out.line('');
    out.dim('This is what a diff that reports every line as changed usually is.');
    out.dim('git normalises it with core.autocrlf or a .gitattributes text rule;');
    out.dim('an editor normalises it by saving with the ending you want.');
    return true;
  }

  function writeReport() {
    out.clear();

    var aName = st.mode === 'merge' ? 'Base' : 'Original';
    var bName = st.mode === 'merge' ? 'Merged' : 'Changed';

    if (st.mode === 'merge') {
      out.heading('Three-way merge');
      out.dim('Base is the common ancestor. Mine and Theirs are the two edits.');
      out.rule();
      reportSide('Base', st.base);
      out.line('');
      reportSide('Mine', st.mine);
      out.line('');
      reportSide('Theirs', st.theirs);
      out.rule();

      out.heading('What the three-way pass found');
      out.row('regions changed by mine', st.three.mineHunks);
      out.row('regions changed by theirs', st.three.theirHunks);
      var clean = { mine: 0, theirs: 0, both: 0 }, i;
      for (i = 0; i < st.regions.length; i++) {
        if (clean[st.regions[i].kind] !== undefined) clean[st.regions[i].kind]++;
      }
      out.row('applied from mine alone', clean.mine);
      out.row('applied from theirs alone', clean.theirs);
      out.row('identical on both sides', clean.both);
      if (st.three.conflicts) {
        out.err('conflicts                 ' + st.three.conflicts);
        out.row('still unresolved', st.mergedMarkers);
      } else {
        out.ok('conflicts                 0');
      }
      out.line('');
      out.dim('A region changed on one side only applies cleanly, because the base');
      out.dim('says which side moved. A region changed on both sides to the same');
      out.dim('text applies cleanly too. Anything else is a conflict and is left');
      out.dim('for you above — nothing here guesses.');
      if (st.mergedMarkers) {
        out.line('');
        out.warn(st.mergedMarkers + ' conflict' + (st.mergedMarkers === 1 ? ' is' : 's are') +
                 ' still unresolved, so the merged file below contains');
        out.warn('conflict markers, exactly the way git would leave them.');
      }
      out.rule();
      out.heading('Base compared with the merged result');
    } else {
      out.heading('Two-way diff');
      out.rule();
      reportSide('Original', st.mine);
      out.line('');
      reportSide('Changed', st.theirs);
      out.rule();
    }

    var settled = endingVerdict(st.aScan, st.bScan, aName, bName);
    if (!settled) {
      var onlyTrail = trailingOnly(st.aScan, st.bScan);
      if (onlyTrail) {
        out.warn('These two differ only in trailing whitespace.');
        out.dim('Every line is the same once the spaces and tabs at the end of it');
        out.dim('are removed. That is usually an editor with trim-on-save, or the');
        out.dim('absence of one.');
        out.line('');
      }
      out.row('hunks', st.patch.hunks);
      out.row('lines added', st.patch.plus);
      out.row('lines removed', st.patch.minus);
      out.row('edit distance D', st.dispD + (st.dispCapped ? '  (hit the ceiling)' : ''));
      if (st.aScan.finalNL !== st.bScan.finalNL) {
        out.line('');
        out.warn('One side ends with a newline and the other does not.');
        out.dim('The exported patch carries the "\\ No newline at end of file"');
        out.dim('marker for whichever side is missing it, which is how the format');
        out.dim('records a difference you cannot see.');
      }
    }

    if (st.dispCapped || st.rawCapped) {
      out.line('');
      out.err('The edit distance ceiling of ' + MAX_D + ' was reached.');
      out.warn('Past that point the differing middle is reported as one block');
      out.warn('removed and one block added, which is correct but coarse. It is');
      out.warn('not a minimal edit script and the patch will be larger than it');
      out.warn('needs to be. Two files this unrelated are usually a replacement');
      out.warn('rather than an edit.');
    }

    if (st.wsCounts) {
      out.rule();
      out.heading('What whitespace is costing you');
      out.row('hunks, whitespace respected', fmtCount(st.wsCounts.respect));
      out.row('ignoring leading and trailing', fmtCount(st.wsCounts.trim));
      out.row('ignoring all whitespace', fmtCount(st.wsCounts.all));
      var gone = st.wsCounts.respect - st.wsCounts.trim;
      var goneAll = st.wsCounts.respect - st.wsCounts.all;
      if (st.wsCounts.respect === 0) {
        out.line('');
        out.ok('No hunks in any mode — there are no differing lines to lose.');
      } else if (st.wsCounts.respect >= 0 && st.wsCounts.trim >= 0) {
        out.line('');
        if (gone > 0) {
          out.warn(gone + ' of ' + st.wsCounts.respect + ' hunk' +
                   (st.wsCounts.respect === 1 ? '' : 's') +
                   (gone === 1 ? ' disappears' : ' disappear') +
                   ' when leading and trailing whitespace is ignored.');
        } else if (goneAll > 0) {
          out.warn(goneAll + ' of ' + st.wsCounts.respect + ' hunk' +
                   (st.wsCounts.respect === 1 ? '' : 's') +
                   (goneAll === 1 ? ' disappears' : ' disappear') + ' only when ALL');
          out.warn('whitespace is ignored — so the change is interior spacing.');
        } else {
          out.ok('No hunk disappears when whitespace is ignored. The differences');
          out.ok('here are real changes to the text.');
        }
      }
    } else {
      out.rule();
      out.dim('The whitespace comparison is skipped above 8,000 lines — it means');
      out.dim('running the diff three times, and that is not free in a tab.');
    }

    out.rule();
    out.heading('The patch');
    if (st.patch.hunks) {
      out.row('unified hunks', st.patch.hunks);
      out.row('context lines', PATCH_CONTEXT);
      out.row('headers', '--- a/' + el.name.value + '   +++ b/' + el.name.value);
      out.dim('Hunk headers count context lines as well as changed ones, and a');
      out.dim('zero-length side takes the line number before the range. It should');
      out.dim('apply with "git apply" or "patch -p1".');
    } else {
      out.dim('Nothing to export — there are no differing lines.');
    }
    if (el.ws.value !== 'respect') {
      out.line('');
      out.warn('The view is ignoring whitespace, but the patch above is not.');
      out.dim('A patch built from an ignore-whitespace diff writes the wrong');
      out.dim('side’s indentation into its context lines and then fails to');
      out.dim('apply. The whitespace toggle changes the view, never the export.');
    }

    out.rule();
    out.heading('What this does not do');
    out.dim('No rename or copy detection: a moved file reads as one whole file');
    out.dim('deleted and another added.');
    out.dim('No binary files, no images, no submodules, no git history — this');
    out.dim('compares two pieces of text you pasted, and nothing else.');
    out.dim('Line-oriented. A reformat that rewraps every line is a rewrite here');
    out.dim('no matter which whitespace mode you pick, because at the level of');
    out.dim('whole lines that is exactly what it is.');
    out.dim('The merge is textual. It has no idea whether the result compiles,');
    out.dim('and a clean merge is not a correct one.');
    out.dim('A text box cannot hold a carriage return — the browser turns every');
    out.dim('CRLF you paste into an LF. To compare real line endings, open the');
    out.dim('files with the buttons above the boxes, or drop them on a box.');
    if (st.base.bom || st.mine.bom || st.theirs.bom) {
      out.line('');
      out.warn('One of these starts with a UTF-8 byte order mark. It is a real');
      out.warn('character at the front of line 1, invisible in every editor, and');
      out.warn('it makes line 1 differ from a copy without one.');
    }
    out.line('');
    out.dim('Nothing was uploaded. Every number above was computed in this tab.');
  }

  function fmtCount(n) { return n < 0 ? 'ceiling reached' : String(n); }

  function trailingOnly(a, b) {
    if (a.lines.length !== b.lines.length) return false;
    var i, sawDiff = false, x, y;
    for (i = 0; i < a.lines.length; i++) {
      x = a.lines[i]; y = b.lines[i];
      if (x === y) continue;
      if (x.replace(/[ \t]+$/, '') !== y.replace(/[ \t]+$/, '')) return false;
      sawDiff = true;
    }
    return sawDiff;
  }

  /* ======================================================================
     10. Exports
     ====================================================================== */

  function encode(text) { return new TextEncoder().encode(text); }

  function downloadPatch() {
    if (!st.patch || !st.patch.text) {
      out.rule();
      out.warn('There is no patch to download — the two sides have no differing lines.');
      return;
    }
    var name = (el.name.value || 'file.txt').replace(/[\\/]+/g, '_');
    LabTool.download(encode(st.patch.text), name + '.patch', 'text/x-patch');
    out.rule();
    out.ok('Saved ' + name + '.patch  (' + st.patch.hunks + ' hunk' +
           (st.patch.hunks === 1 ? '' : 's') + ')');
    out.dim('Apply it from the directory holding the file with:');
    out.dim('  git apply ' + name + '.patch      or      patch -p1 < ' + name + '.patch');
  }

  function copyPatch() {
    if (!st.patch || !st.patch.text) {
      out.rule();
      out.warn('There is no patch to copy — the two sides have no differing lines.');
      return;
    }
    LabTool.copy(st.patch.text, el.copy);
  }

  function downloadMerged() {
    if (st.mode !== 'merge' || !st.merged) {
      out.rule();
      out.warn('Switch to three-way merge first — there is no merged file in diff mode.');
      return;
    }
    var ending = exportEnding();
    var finalNL = st.base.finalNL || st.mine.finalNL || st.theirs.finalNL;
    var name = (el.name.value || 'file.txt').replace(/[\\/]+/g, '_');
    LabTool.download(encode(joinWith(st.merged, ending, finalNL)), name, 'text/plain');
    out.rule();
    out.ok('Saved ' + name);
    out.row('line endings written', ending === '\r\n' ? 'CRLF' : (ending === '\r' ? 'CR' : 'LF'));
    out.row('final newline', finalNL ? 'yes' : 'no');
    if (st.mergedMarkers) {
      out.warn('It still contains ' + st.mergedMarkers + ' conflict marker block' +
               (st.mergedMarkers === 1 ? '' : 's') + '. That is deliberate — the');
      out.warn('same thing git leaves behind when it cannot decide for you.');
    }
    out.dim('A merged file has no single correct line ending when the two sides');
    out.dim('disagree, so the one above is the one you chose, not a guess.');
  }

  /* ======================================================================
     11. Worked examples
     ====================================================================== */

  var CFG = [
    'server:',
    '  host: 127.0.0.1',
    '  port: 8080',
    '  timeout: 30',
    'logging:',
    '  level: info',
    '  file: /var/log/app.log'
  ];

  var EXAMPLES = {
    endings: function () {
      return {
        mode: 'diff', base: '',
        mine: CFG.join('\n') + '\n',
        theirs: CFG.join('\r\n') + '\r\n',
        rawTheirs: true
      };
    },
    onechar: function () {
      var b = CFG.slice(0);
      b[2] = '  port: 8081';
      return { mode: 'diff', base: '', mine: CFG.join('\n') + '\n', theirs: b.join('\n') + '\n' };
    },
    indent: function () {
      var b = [], i;
      for (i = 0; i < CFG.length; i++) b.push(CFG[i].replace(/^  /, '\t'));
      b[3] = b[3] + '   ';
      return { mode: 'diff', base: '', mine: CFG.join('\n') + '\n', theirs: b.join('\n') + '\n' };
    },
    nonewline: function () {
      var b = CFG.slice(0);
      b.push('  rotate: daily');
      return { mode: 'diff', base: '', mine: CFG.join('\n'), theirs: b.join('\n') + '\n' };
    },
    clean: function () {
      var m = CFG.slice(0), t = CFG.slice(0);
      m[1] = '  host: 0.0.0.0';
      t[5] = '  level: debug';
      return { mode: 'merge', base: CFG.join('\n') + '\n', mine: m.join('\n') + '\n', theirs: t.join('\n') + '\n' };
    },
    conflict: function () {
      var m = CFG.slice(0), t = CFG.slice(0);
      m[2] = '  port: 8443';
      t[2] = '  port: 9000';
      return { mode: 'merge', base: CFG.join('\n') + '\n', mine: m.join('\n') + '\n', theirs: t.join('\n') + '\n' };
    },
    agree: function () {
      var m = CFG.slice(0), t = CFG.slice(0);
      m[3] = '  timeout: 60';
      t[3] = '  timeout: 60';
      t[5] = '  level: warn';
      return { mode: 'merge', base: CFG.join('\n') + '\n', mine: m.join('\n') + '\n', theirs: t.join('\n') + '\n' };
    },
    deladd: function () {
      var m = CFG.slice(0), t = CFG.slice(0);
      m.splice(3, 1);
      t.splice(6, 0, '  rotate: daily');
      return { mode: 'merge', base: CFG.join('\n') + '\n', mine: m.join('\n') + '\n', theirs: t.join('\n') + '\n' };
    }
  };

  function loadExample(key) {
    var make = EXAMPLES[key];
    if (!make) return;
    var ex = make();
    setSide('base', ex.base, ex.rawBase ? 'worked example' : null);
    setSide('mine', ex.mine, ex.rawMine ? 'worked example' : null);
    setSide('theirs', ex.theirs, ex.rawTheirs ? 'worked example' : null);
    el.mode.value = ex.mode;
    run();
  }

  /* One place that fills a box. The 'from' label is null for text the visitor
     owns, and a short name when the real characters are being held outside
     the box because the box would flatten them. */
  function setSide(which, text, from) {
    el[which].value = text;
    st.raw[which] = from ? text : null;
    var note = el['src' + which];
    if (!note) return;
    if (!from) {
      note.textContent = 'typed here — a text box cannot hold a CR';
      note.className = 'dm-src';
      return;
    }
    var s = scan(text);
    note.textContent = from + ' — real characters, ' +
      (s.crlf ? s.crlf + ' CRLF' : '') + (s.crlf && s.lf ? ' and ' : '') +
      (s.lf ? s.lf + ' LF' : '') + (!s.crlf && !s.lf ? 'no line breaks' : '') + ' preserved';
    note.className = 'dm-src is-raw';
  }

  /* ======================================================================
     11b. Loading a real file, because a text box cannot carry a CR
     ====================================================================== */

  var MAX_FILE = 4 * 1024 * 1024;

  function readInto(which, file) {
    if (!file) return;
    if (file.size > MAX_FILE) {
      out.clear();
      out.err('That file is ' + LabTool.humanBytes(file.size) + '. This stops at ' +
              LabTool.humanBytes(MAX_FILE) + ' — the comparison runs on your processor here.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      /* ignoreBOM keeps a leading U+FEFF in the string instead of silently
         eating it, so scan() can report a byte order mark on one side and not
         the other. That is another difference nobody can see in an editor. */
      var text;
      try {
        text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(reader.result));
      } catch (err) {
        out.clear();
        out.err('That file could not be decoded as UTF-8 text.');
        out.dim('This tool compares text. A binary file has no lines to compare.');
        return;
      }
      setSide(which, text, file.name);
      run();
    };
    reader.onerror = function () {
      out.clear();
      out.err('That file could not be read.');
    };
    reader.readAsArrayBuffer(file);
  }

  function wireFile(which, btn, input, zone) {
    if (!btn || !input) return;
    btn.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { readInto(which, input.files[0]); });
    if (!zone) return;
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      readInto(which, e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  /* ======================================================================
     12. Wiring
     ====================================================================== */

  function grab() {
    el.mode = document.getElementById('dm-mode');
    el.view2 = document.getElementById('dm-view-mode');
    el.ws = document.getElementById('dm-ws');
    el.intra = document.getElementById('dm-intra');
    el.context = document.getElementById('dm-context');
    el.marks = document.getElementById('dm-marks');
    el.name = document.getElementById('dm-name');
    el.eol = document.getElementById('dm-eol');
    el.example = document.getElementById('dm-example');
    el.copy = document.getElementById('dm-copy');
    el.patchBtn = document.getElementById('dm-patch');
    el.download = document.getElementById('dm-download');
    el.clear = document.getElementById('dm-clear');
    el.base = document.getElementById('dm-base');
    el.mine = document.getElementById('dm-mine');
    el.theirs = document.getElementById('dm-theirs');
    el.basewrap = document.getElementById('dm-basewrap');
    el.minewrap = document.getElementById('dm-minewrap');
    el.theirswrap = document.getElementById('dm-theirswrap');
    el.srcbase = document.getElementById('dm-srcbase');
    el.srcmine = document.getElementById('dm-srcmine');
    el.srctheirs = document.getElementById('dm-srctheirs');
    el.mineLabel = document.getElementById('dm-mine-label');
    el.theirsLabel = document.getElementById('dm-theirs-label');
    el.status = document.getElementById('dm-status');
    el.view = document.getElementById('dm-view');
    el.viewLabel = document.getElementById('dm-viewlabel');
    el.mergePanel = document.getElementById('dm-merge');
    el.conflicts = document.getElementById('dm-conflicts');
    el.merged = document.getElementById('dm-merged');
  }

  function onViewChange() {
    if (!st.dispRows) return;
    renderView();
  }

  function onWsChange() {
    if (!st.aScan) return;
    /* Only the display and the whitespace accounting move. The merge and the
       patch were computed with whitespace respected and stay that way, so any
       conflicts already resolved by hand survive a change of this control. */
    recomputeDisplay();
    renderView();
    writeReport();
    setStatus();
  }

  LabTool.define({
    id: 'diffmerge',
    run: run,
    onReady: function () {
      out = LabTool.out('tool-out');
      grab();
      if (!el.mine || !el.theirs) return;

      el.mode.addEventListener('change', run);
      el.ws.addEventListener('change', onWsChange);
      el.view2.addEventListener('change', onViewChange);
      el.intra.addEventListener('change', onViewChange);
      el.context.addEventListener('change', onViewChange);
      el.marks.addEventListener('change', onViewChange);
      el.name.addEventListener('input', function () {
        if (st.aScan) { recomputeDisplay(); }
      });
      el.eol.addEventListener('change', function () {});
      el.copy.addEventListener('click', copyPatch);
      el.patchBtn.addEventListener('click', downloadPatch);
      el.download.addEventListener('click', downloadMerged);
      wireFile('base', document.getElementById('dm-openbase'),
               document.getElementById('dm-filebase'), el.basewrap);
      wireFile('mine', document.getElementById('dm-openmine'),
               document.getElementById('dm-filemine'), el.minewrap);
      wireFile('theirs', document.getElementById('dm-opentheirs'),
               document.getElementById('dm-filetheirs'), el.theirswrap);

      /* Typing takes the box back. Whatever real characters were being held
         for that side are dropped, because from here on what is in the box is
         the text and pretending otherwise would compare something the visitor
         cannot see. */
      ['base', 'mine', 'theirs'].forEach(function (which) {
        el[which].addEventListener('input', function () {
          if (st.raw[which] === null) return;
          st.raw[which] = null;
          var note = el['src' + which];
          if (note) {
            note.textContent = 'typed here — a text box cannot hold a CR';
            note.className = 'dm-src';
          }
        });
      });

      el.clear.addEventListener('click', function () {
        setSide('base', '', null); setSide('mine', '', null); setSide('theirs', '', null);
        el.view.textContent = '';
        el.conflicts.textContent = '';
        el.merged.textContent = '';
        st.patch = null; st.dispRows = null; st.aScan = null;
        out.clear();
        out.dim('Cleared. Paste two versions and press Compare.');
        setStatusText('Cleared', '');
      });
      el.example.addEventListener('change', function () {
        var v = el.example.value;
        if (v) loadExample(v);
      });

      /* Opening on the line-endings example rather than an empty box, because
         that case is the one people arrive here for and the one they cannot
         see in their own editor. */
      loadExample('endings');
      el.example.value = 'endings';
    }
  });
})();

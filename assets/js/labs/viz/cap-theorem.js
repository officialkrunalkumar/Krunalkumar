/* ==========================================================================
   cap-theorem.js — a five-node cluster you can cut in half on purpose.
   --------------------------------------------------------------------------
   Almost every explanation of CAP is a Venn diagram with three circles and the
   words "pick two". That picture is wrong in a way that matters: you do not
   pick P. A network that never drops or delays a packet is not a thing you can
   buy, so partition tolerance is a fact about the world, not a column in a
   comparison table. The only choice the theorem describes is what a replica
   does in the seconds it cannot reach the others, and it says nothing at all
   about the rest of the time.

   So this is not a diagram. It is five replicas and ten links, and the links
   are yours to cut. Cutting them recomputes the connected components with a
   real traversal. Writing to a node in the minority side under CP is refused
   because the quorum arithmetic says so; writing to it under AP succeeds and
   the two sides genuinely diverge, each holding its own value and its own
   version vector. When you repair the links nothing merges until you run
   anti-entropy, because replicas do not know they disagree until they talk —
   and then the conflict is real, with two concurrent version vectors that no
   ordering can rank, and you get to choose whether to throw one away.

   Everything printed here is computed from that state. Component membership
   comes from a traversal. Quorum verdicts come from counting replicas.
   R + W > N is not asserted, it is checked by enumerating every read set and
   every write set of the current sizes and testing whether all of the pairs
   intersect. The count of read sets that would miss the newest write comes
   from enumerating the subsets and looking at who actually holds it. Latency
   is the W-th smallest round trip out of the coordinator, which is what
   waiting for the W-th acknowledgement means.

   Where the model is a simplification, and it is a big one:

     - A link here is up or cut. Real partitions are worse than that: they are
       asymmetric, intermittent, and often a slow link rather than a dead one,
       which is the case that breaks failure detectors. Nothing here is slow
       enough to be ambiguous.
     - There is no crash that is separate from a partition, no leader election,
       no log replication. "CP" in this sandbox is a quorum check, not Raft.
       A consensus protocol does considerably more than count reachable nodes.
     - The latency model is replica acknowledgement only: parallel dispatch,
       one round trip each, no queueing, no disk flush, no retries, no tail.
       A real p99 is dominated by things this does not have.
     - The sandbox knows the true order of every write because it is one tab
       with one counter. Real nodes do not have that. The clock-skew slider
       exists to show what happens when they guess with a wall clock instead.

   No network, no eval, no dependencies. Arithmetic, built DOM and one SVG.
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
  var COMP_COLOUR = [C.cyan, C.amber, C.violet, C.green, C.red];

  var idSeq = 0;
  function uid(prefix) { idSeq++; return prefix + idSeq; }

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

  function button(text, onClick, cls) {
    var el = E('button', 'cap-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return el;
  }
  function group(title) {
    var box = E('div', 'cap-group');
    box.appendChild(E('p', 'cap-group-title', title));
    return box;
  }
  /* A labelled range. setValue and setMax exist because one slider can move
     another — dropping N has to pull R and W down with it — and rebuilding the
     control panel to do that would tear the slider out from under the pointer
     halfway through the drag. So the panel is built once and the controls
     update each other in place. */
  function slider(labelText, min, max, step, value, format, onChange) {
    var wrap = E('div', 'cap-slider');
    var head = E('div', 'cap-slider-head');
    var lab = E('label', 'cap-field-label', labelText);
    var out = E('span', 'cap-slider-value', format(value));
    head.appendChild(lab);
    head.appendChild(out);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'cap-range';
    var id = uid('cap-sl-');
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
    wrap.setValue = function (v) {
      input.value = String(v);
      out.textContent = format(v);
    };
    wrap.setMax = function (m) { input.max = String(m); };
    return wrap;
  }
  function note(text, cls) {
    var p = E('p', 'cap-note' + (cls ? ' ' + cls : ''), text);
    return p;
  }
  function table(head, rows, cls) {
    var t = E('table', 'cap-table' + (cls ? ' ' + cls : ''));
    var thead = E('thead'), tr = E('tr');
    head.forEach(function (h) {
      var th = E('th', null, h);
      th.setAttribute('scope', 'col');
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = E('tbody');
    rows.forEach(function (r) {
      var row = E('tr');
      var cells = r.cells || r;
      if (r.cls) row.className = r.cls;
      cells.forEach(function (cell) {
        var td = E('td', 'cap-td');
        if (cell && cell.nodeType) td.appendChild(cell);
        else td.textContent = cell == null ? '' : String(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    var scroll = E('div', 'cap-scroll');
    scroll.appendChild(t);
    return scroll;
  }
  function card(heading, big, sub, cls) {
    var box = E('div', 'cap-card' + (cls ? ' ' + cls : ''));
    box.appendChild(E('p', 'cap-card-h', heading));
    box.appendChild(E('p', 'cap-big', big));
    if (sub) box.appendChild(E('p', 'cap-card-note', sub));
    return box;
  }
  function barRow(name, value, max, unit, cls) {
    var row = E('div', 'cap-bar-row');
    row.appendChild(E('span', 'cap-bar-name', name));
    var track = E('div', 'cap-bar-track');
    var fill = E('div', 'cap-bar-fill' + (cls ? ' ' + cls : ''));
    fill.style.width = Math.max(1, Math.round(100 * value / Math.max(1, max))) + '%';
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(E('span', 'cap-bar-num', value + ' ' + unit));
    return row;
  }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function ordinal(n) {
    var tens = n % 100;
    if (tens >= 11 && tens <= 13) return n + 'th';
    var last = n % 10;
    if (last === 1) return n + 'st';
    if (last === 2) return n + 'nd';
    if (last === 3) return n + 'rd';
    return n + 'th';
  }
  function ms(v) { return v + ' ms'; }
  function secs(v) {
    var s = v / 1000;
    return (Math.round(s * 10) / 10).toFixed(1) + ' s';
  }
  function bitCount(mask) {
    var n = 0;
    while (mask) { n += mask & 1; mask >>= 1; }
    return n;
  }
  /* Every subset of {0 .. size-1} with exactly k members, as bitmasks. Five
     nodes means at most 32 masks, so enumerating is cheaper than reasoning
     about a binomial coefficient and is impossible to get subtly wrong. */
  function subsets(size, k) {
    var out = [];
    for (var mask = 0; mask < (1 << size); mask++) {
      if (bitCount(mask) === k) out.push(mask);
    }
    return out;
  }
  function maskNames(mask, ids) {
    var out = [];
    for (var i = 0; i < ids.length; i++) if (mask & (1 << i)) out.push(ids[i]);
    return out.join(' ');
  }

  /* ======================================================================== */
  /*  THE CLUSTER                                                             */
  /* ------------------------------------------------------------------------ */
  /*  Five nodes, ten links, one key. Sites exist only to give the links two   */
  /*  different round-trip times, because the PACELC half of this lab needs a  */
  /*  latency that changes when you ask for more acknowledgements.             */
  /* ======================================================================== */

  var IDS = ['A', 'B', 'C', 'D', 'E'];
  var SITE = [0, 0, 1, 2, 2];
  var SITE_NAME = ['site 1', 'site 2', 'site 3'];
  var NCLUSTER = 5;
  var VALUES = ['mango', 'pear', 'plum', 'fig', 'lime', 'quince', 'apricot'];

  var LINKS = [];
  var LINK_AT = [];
  (function () {
    var i, j;
    for (i = 0; i < NCLUSTER; i++) LINK_AT.push([]);
    for (i = 0; i < NCLUSTER; i++) {
      for (j = i + 1; j < NCLUSTER; j++) {
        LINK_AT[i][j] = LINKS.length;
        LINK_AT[j][i] = LINKS.length;
        LINKS.push({ a: i, b: j });
      }
    }
  })();

  /* --- version vectors ---------------------------------------------------- */
  function vvZero() { return [0, 0, 0, 0, 0]; }
  function vvMergeInto(target, other) {
    for (var i = 0; i < target.length; i++) {
      if (other[i] > target[i]) target[i] = other[i];
    }
    return target;
  }
  function vvGE(a, b) {
    for (var i = 0; i < a.length; i++) if (a[i] < b[i]) return false;
    return true;
  }
  function vvText(v) {
    var parts = [];
    for (var i = 0; i < v.length; i++) if (v[i]) parts.push(IDS[i] + ':' + v[i]);
    return parts.length ? '{' + parts.join(' ') + '}' : '{}';
  }

  /* Fold one entry into a sibling list under the partial order of the version
     vectors. An entry that some sibling already dominates is redundant and is
     dropped; every sibling it dominates is dropped; anything neither dominates
     nor is dominated by stays, because that is precisely what "concurrent"
     means and there is no honest way to rank the two. */
  function addEntry(list, e) {
    var out = [], redundant = false, i;
    for (i = 0; i < list.length; i++) {
      var x = list[i];
      if (vvGE(x.vv, e.vv)) { redundant = true; out.push(x); }
      else if (vvGE(e.vv, x.vv)) { continue; }
      else out.push(x);
    }
    if (!redundant) out.push(e);
    out.sort(function (p, q) { return p.seq - q.seq; });
    return out;
  }
  function mergeLists(a, b) {
    var out = a.slice();
    for (var i = 0; i < b.length; i++) out = addEntry(out, b[i]);
    return out;
  }

  function Cluster() {
    this.n = 5;
    this.r = 2;
    this.w = 2;
    this.mode = 'cp';
    this.near = 1;
    this.far = 120;
    this.skewNode = 3;
    this.skew = [0, 0, 0, 0, 0];
    this.cut = [];
    for (var i = 0; i < LINKS.length; i++) this.cut.push(false);
    this.reset();
  }

  Cluster.prototype.reset = function () {
    this.clock = 0;
    this.seq = 1;
    this.valueIndex = 0;
    var first = { value: 'apple', vv: vvZero(), ts: 0, writer: 0, seq: 1 };
    first.vv[0] = 1;
    this.store = [];
    for (var i = 0; i < NCLUSTER; i++) this.store.push(i < this.n ? [first] : []);
    this.lastAck = first;
    this.log = [];
    this.status = 'Five replicas, every link up, every copy reading apple.';
  };

  Cluster.prototype.say = function (text, kind) {
    this.log.push({ text: text, kind: kind || 'info' });
    if (this.log.length > 60) this.log.shift();
    this.status = text;
  };

  Cluster.prototype.isReplica = function (i) { return i < this.n; };

  /* Connected components by traversal over the links that are still up. This
     is the one number everything else hangs off, so it is walked rather than
     tracked incrementally — a stale component map would quietly make every
     quorum verdict on the page wrong. */
  Cluster.prototype.components = function () {
    var of = [], groups = [], i;
    for (i = 0; i < NCLUSTER; i++) of.push(-1);
    for (i = 0; i < NCLUSTER; i++) {
      if (of[i] >= 0) continue;
      var id = groups.length;
      var stack = [i], members = [];
      of[i] = id;
      while (stack.length) {
        var x = stack.pop();
        members.push(x);
        for (var y = 0; y < NCLUSTER; y++) {
          if (y === x || of[y] >= 0) continue;
          if (this.cut[LINK_AT[x][y]]) continue;
          of[y] = id;
          stack.push(y);
        }
      }
      members.sort(function (p, q) { return p - q; });
      groups.push(members);
    }
    return { of: of, groups: groups };
  };

  Cluster.prototype.replicasIn = function (members) {
    var out = [];
    for (var i = 0; i < members.length; i++) {
      if (this.isReplica(members[i])) out.push(members[i]);
    }
    return out;
  };

  Cluster.prototype.rtt = function (a, b) {
    if (a === b) return 0;
    return SITE[a] === SITE[b] ? this.near : this.far;
  };

  /* Replicas the coordinator can still reach, nearest first. Nearest first is
     not decoration: the W-th entry of this list is the acknowledgement the
     write waits for, so the ordering is the latency model. */
  Cluster.prototype.reachable = function (from) {
    var self = this;
    var cs = this.components();
    var out = this.replicasIn(cs.groups[cs.of[from]]);
    out.sort(function (p, q) {
      var d = self.rtt(from, p) - self.rtt(from, q);
      return d !== 0 ? d : p - q;
    });
    return out;
  };

  Cluster.prototype.cutLink = function (index, cutIt) {
    this.cut[index] = !!cutIt;
  };
  Cluster.prototype.healAll = function () {
    for (var i = 0; i < this.cut.length; i++) this.cut[i] = false;
  };

  /* --- the operations ----------------------------------------------------- */

  Cluster.prototype.write = function (from, value) {
    var res = { op: 'write', from: from, value: value };
    if (!this.isReplica(from)) {
      res.ok = false;
      res.reason = 'Node ' + IDS[from] + ' holds no copy of this key at N = ' + this.n +
                   '. In a real ring the request would be forwarded to a replica; ' +
                   'here the button is simply refused so the preference list stays visible.';
      this.say(res.reason, 'warn');
      return res;
    }
    var reach = this.reachable(from);
    this.clock += 1000;

    if (this.mode === 'cp' && reach.length < this.w) {
      res.ok = false;
      res.reach = reach.length;
      res.reason = 'REFUSED at ' + IDS[from] + '. Its side of the partition can reach ' +
                   reach.length + ' of ' + this.n + ' replicas and W = ' + this.w +
                   ' are needed, so there is no quorum. The client gets an error, not a ' +
                   'stale answer. This is the A in CAP being given up, on purpose, ' +
                   'for as long as the partition lasts.';
      this.say(res.reason, 'err');
      return res;
    }

    var count = this.mode === 'cp' ? this.w : Math.min(this.w, reach.length);
    var targets = reach.slice(0, count);
    var base = vvZero();
    var mine = this.store[from];
    for (var i = 0; i < mine.length; i++) vvMergeInto(base, mine[i].vv);
    var hadSiblings = mine.length > 1;
    base[from] += 1;
    this.seq += 1;
    var entry = {
      value: value,
      vv: base,
      ts: this.clock + this.skew[from],
      writer: from,
      seq: this.seq
    };
    for (i = 0; i < targets.length; i++) {
      this.store[targets[i]] = addEntry(this.store[targets[i]], entry);
    }
    this.lastAck = entry;

    res.ok = true;
    res.entry = entry;
    res.targets = targets;
    res.latency = this.rtt(from, targets[targets.length - 1]);
    res.short = this.mode === 'ap' && targets.length < this.w;
    res.hadSiblings = hadSiblings;

    var msg = 'Wrote ' + value + ' at ' + IDS[from] + ', acknowledged after ' +
              targets.length + ' ' + plural(targets.length, 'copy', 'copies') +
              ' (' + targets.map(function (t) { return IDS[t]; }).join(' ') + ') in ' +
              res.latency + ' ms. Version vector ' + vvText(entry.vv) + '. ' +
              (this.n - targets.length) + ' ' +
              plural(this.n - targets.length, 'replica is', 'replicas are') +
              ' now stale.';
    if (res.short) {
      msg += ' Only ' + targets.length + ' of the ' + this.w + ' replicas W asks for were ' +
             'reachable, and AP acknowledged anyway. A real Dynamo-style store would use a ' +
             'sloppy quorum here and hand the write off to a node outside the preference ' +
             'list; this sandbox just writes to whoever it can reach and says so.';
    }
    if (hadSiblings) {
      msg += ' That node was holding siblings, and this write was made on top of both of ' +
             'them, so its vector dominates both and the conflict there is gone. That is ' +
             'how a client resolves siblings in Dynamo: read them, write back one value ' +
             'with a context covering all of them.';
    }
    this.say(msg, 'ok');
    return res;
  };

  Cluster.prototype.read = function (from) {
    var res = { op: 'read', from: from };
    if (!this.isReplica(from)) {
      res.ok = false;
      res.reason = 'Node ' + IDS[from] + ' holds no copy of this key at N = ' + this.n + '.';
      this.say(res.reason, 'warn');
      return res;
    }
    var reach = this.reachable(from);
    if (this.mode === 'cp' && reach.length < this.r) {
      res.ok = false;
      res.reason = 'REFUSED at ' + IDS[from] + '. It can reach ' + reach.length +
                   ' of ' + this.n + ' replicas and R = ' + this.r + ' are needed. ' +
                   'Under CP a read without a quorum is an error rather than a guess.';
      this.say(res.reason, 'err');
      return res;
    }
    var count = Math.min(this.r, reach.length);
    var set = reach.slice(0, count);
    var merged = [];
    for (var i = 0; i < set.length; i++) merged = mergeLists(merged, this.store[set[i]]);
    var latency = this.rtt(from, set[set.length - 1]);
    var fresh = false;
    for (i = 0; i < merged.length; i++) if (merged[i].seq === this.lastAck.seq) fresh = true;
    /* A replica agrees with the merge only if it is holding every entry in it.
       Comparing list lengths was not enough, and it hid the ordinary case: one
       fresh replica and one stale replica each hold exactly one entry, the merge
       drops the dominated one, and all three lengths are 1 — so a read across a
       current copy and a stale copy never reported that they disagreed, which is
       precisely the read that a real store would repair. */
    var disagreed = false;
    for (i = 0; i < set.length && !disagreed; i++) {
      var held = this.store[set[i]];
      for (var mi = 0; mi < merged.length; mi++) {
        var has = false;
        for (var hi = 0; hi < held.length; hi++) {
          if (held[hi].seq === merged[mi].seq) { has = true; break; }
        }
        if (!has) { disagreed = true; break; }
      }
    }

    res.ok = true;
    res.set = set;
    res.merged = merged;
    res.latency = latency;
    res.fresh = fresh;

    /* A read set can legitimately be empty of data: raise N and the replicas
       that just joined the preference list hold nothing until something is
       written to them. Returning nothing is the right answer there, and it used
       to be a TypeError on merged[0]. */
    var answer;
    if (!merged.length) {
      answer = 'nothing at all. Every replica in that set has joined the ' +
               'preference list since the last write and has never been written to. ' +
               'A real store would return not-found here, which is a perfectly ' +
               'ordinary way to lose a key by widening N without repairing.';
    } else if (merged.length > 1) {
      answer = merged.length + ' concurrent values: ' +
               merged.map(function (m) { return m.value; }).join(' and ') +
               '. Neither vector dominates, so the store cannot pick one and hands ' +
               'both to the application.';
    } else {
      answer = merged[0].value + ' ' + vvText(merged[0].vv) + '.';
    }
    var msg = 'Read at ' + IDS[from] + ' from ' + set.length + ' ' +
              plural(set.length, 'replica', 'replicas') + ' (' +
              set.map(function (t) { return IDS[t]; }).join(' ') + ') in ' + latency +
              ' ms, returning ' + answer;
    msg += fresh
      ? ' That read set included a replica holding the newest acknowledged write.'
      : ' That read set MISSED the newest acknowledged write (' + this.lastAck.value +
        ' at ' + IDS[this.lastAck.writer] + '). Every node it asked was stale.';
    if (disagreed) {
      msg += ' The replicas in the read set disagreed. A real Dynamo-style store would ' +
             'write the merge back to the stale ones now — read repair. This sandbox does ' +
             'not, so the divergence stays on screen for you to look at.';
    }
    this.say(msg, fresh ? 'ok' : 'warn');
    return res;
  };

  /* Anti-entropy is a separate button rather than something that happens when a
     link comes back, because the gap between the two is the lesson: replicas do
     not know they disagree until they exchange state. */
  Cluster.prototype.gossip = function () {
    var cs = this.components();
    var summary = [];
    for (var g = 0; g < cs.groups.length; g++) {
      var reps = this.replicasIn(cs.groups[g]);
      if (!reps.length) continue;
      var merged = [];
      for (var i = 0; i < reps.length; i++) merged = mergeLists(merged, this.store[reps[i]]);
      for (i = 0; i < reps.length; i++) this.store[reps[i]] = merged.slice();
      summary.push({ reps: reps, siblings: merged.length, merged: merged });
    }
    var conflicted = 0;
    for (var s = 0; s < summary.length; s++) if (summary[s].siblings > 1) conflicted++;
    var msg = 'Anti-entropy ran. ' + summary.length + ' ' +
              plural(summary.length, 'group', 'groups') + ' of replicas exchanged state. ';
    msg += conflicted
      ? conflicted + ' of them ended up holding more than one value, because the writes ' +
        'were concurrent and no version vector dominates the other. Nothing in the ' +
        'database can order them; the choice below is yours, and every option loses ' +
        'something.'
      : 'Everything converged to a single value; the vectors were ordered, so one write ' +
        'clearly happened after the other and the older copy was simply overwritten.';
    this.say(msg, conflicted ? 'warn' : 'ok');
    return summary;
  };

  /* The merged sibling set over every replica: what the cluster as a whole is
     holding, regardless of who has seen what. */
  Cluster.prototype.allSiblings = function () {
    var merged = [];
    for (var i = 0; i < this.n; i++) merged = mergeLists(merged, this.store[i]);
    return merged;
  };
  Cluster.prototype.conflicted = function () {
    for (var i = 0; i < this.n; i++) if (this.store[i].length > 1) return true;
    return false;
  };
  Cluster.prototype.split = function () {
    return this.components().groups.length > 1;
  };

  Cluster.prototype.resolve = function (how) {
    var merged = this.allSiblings();
    if (merged.length < 2) return null;
    var i, winner = merged[0], lost = [];
    var vv = vvZero();
    for (i = 0; i < merged.length; i++) vvMergeInto(vv, merged[i].vv);

    if (how === 'siblings') {
      return { how: how, kept: merged.slice() };
    }
    if (how === 'union') {
      var values = [];
      for (i = 0; i < merged.length; i++) {
        if (values.indexOf(merged[i].value) < 0) values.push(merged[i].value);
      }
      values.sort();
      winner = {
        value: values.join(' + '),
        vv: vv,
        ts: merged[merged.length - 1].ts,
        writer: merged[merged.length - 1].writer,
        seq: ++this.seq
      };
    } else {
      for (i = 1; i < merged.length; i++) {
        if (how === 'lww-clock') {
          if (merged[i].ts > winner.ts ||
              (merged[i].ts === winner.ts && merged[i].seq > winner.seq)) winner = merged[i];
        } else if (merged[i].seq > winner.seq) winner = merged[i];
      }
      for (i = 0; i < merged.length; i++) if (merged[i] !== winner) lost.push(merged[i]);
      winner = {
        value: winner.value, vv: vv, ts: winner.ts,
        writer: winner.writer, seq: ++this.seq
      };
    }

    for (i = 0; i < this.n; i++) this.store[i] = [winner];
    this.lastAck = winner;

    /* Both rules are computed so the two winners can be compared. When they
       differ, the wall-clock rule has just thrown away the write that really
       happened last, and no error was raised anywhere. */
    var byClock = merged[0], byTrue = merged[0];
    for (i = 1; i < merged.length; i++) {
      if (merged[i].ts > byClock.ts) byClock = merged[i];
      if (merged[i].seq > byTrue.seq) byTrue = merged[i];
    }

    /* disagree is the honest fact — the two rules rank these writes differently
       — and it is true whichever rule you pressed. Only lww-clock lets the skew
       decide, though, so the wording has to branch on how. An earlier version
       printed "the clock skew is quietly choosing the winner" after a true-order
       resolve, where the clocks chose nothing, and after a union, in the same
       breath as "nothing was discarded". */
    var out = {
      how: how, winner: winner, lost: lost, merged: merged,
      byClock: byClock, byTrue: byTrue, disagree: byClock !== byTrue,
      skewDecided: how === 'lww-clock' && byClock !== byTrue
    };
    var msg;
    if (how === 'union') {
      msg = 'Merged both values into ' + winner.value + '. That is only legal because ' +
            'a union is commutative, associative and idempotent — the definition of a ' +
            'grow-only set, and the reason a CRDT can merge without asking anyone. Turn ' +
            'the value into a bank balance and this option disappears.';
    } else {
      msg = 'Resolved to ' + winner.value + ' by ' +
            (how === 'lww-clock' ? 'last write wins on the node wall clocks'
                                 : 'last write wins on the true order') + '. ' +
            (lost.length ? 'Discarded: ' +
              lost.map(function (l) {
                return l.value + ' written at ' + IDS[l.writer];
              }).join(', ') +
              '. Those writes returned success to their clients. Nothing anywhere ' +
              'recorded that they were lost.' : '');
      if (out.disagree) {
        msg += ' The two rules disagree here: the wall clocks say ' + byClock.value +
               ' is newest, the true order says ' + byTrue.value + '. ' +
               (out.skewDecided
                 ? 'The clock skew you set is quietly choosing the winner, and no node ' +
                   'can detect that.'
                 : 'This rule used the true order, and the skew decided nothing — but no ' +
                   'real cluster has a true order to use. The sandbox only has one because ' +
                   'it is a single tab with a single counter. A store with nothing but the ' +
                   'wall clocks would have kept ' + byClock.value + ' instead.');
      }
    }
    this.say(msg, 'warn');
    return out;
  };

  /* --- quorum arithmetic, all of it counted -------------------------------- */

  /* R + W > N is the whole rule, and it is easy to state and easy to distrust.
     So rather than print the inequality, enumerate every read set of size R and
     every write set of size W and check that all the pairs share a node. The
     answer always agrees with the inequality, which is the point: you can see
     why it is true instead of being told that it is. */
  Cluster.prototype.overlapProof = function () {
    var reads = subsets(this.n, this.r);
    var writes = subsets(this.n, this.w);
    var pairs = 0, disjoint = 0, example = null;
    for (var i = 0; i < writes.length; i++) {
      for (var j = 0; j < reads.length; j++) {
        pairs++;
        if (!(writes[i] & reads[j])) {
          disjoint++;
          if (!example) example = { w: writes[i], r: reads[j] };
        }
      }
    }
    return {
      readSets: reads.length, writeSets: writes.length,
      pairs: pairs, disjoint: disjoint, example: example,
      guaranteed: disjoint === 0
    };
  };

  /* How many of the possible read sets would miss the newest acknowledged
     write, given who is actually holding it right now. This is the same idea
     applied to the real state rather than to the general case, and after a
     partition it is often worse than the general answer. */
  Cluster.prototype.stalenessCount = function () {
    var holders = 0, i, j;
    for (i = 0; i < this.n; i++) {
      var list = this.store[i];
      for (j = 0; j < list.length; j++) {
        if (list[j].seq === this.lastAck.seq) { holders |= (1 << i); break; }
      }
    }
    var sets = subsets(this.n, this.r);
    var hit = 0, missExample = null;
    for (i = 0; i < sets.length; i++) {
      if (sets[i] & holders) hit++;
      else if (!missExample) missExample = sets[i];
    }
    return {
      holders: holders, holderCount: bitCount(holders),
      total: sets.length, hit: hit, miss: sets.length - hit,
      missExample: missExample
    };
  };

  Cluster.prototype.orderStat = function (from, k) {
    var reach = this.reachable(from);
    if (reach.length < k) return null;
    return this.rtt(from, reach[k - 1]);
  };

  /* ======================================================================== */
  /*  SCOPED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Injected as a <style> node rather than added to the site stylesheet:     */
  /*  every selector below is meaningless outside this lab and only stays in   */
  /*  step with the markup if it lives beside the code that builds it. The     */
  /*  CSP permits inline style and forbids inline script, which is why this is */
  /*  a style element and nothing here is built from a string of code. Every   */
  /*  rule is scoped under #captheorem so the other lab pages are untouched.   */
  /* ======================================================================== */

  var CSS = [
    '#captheorem .cap-wrap{font:13px/1.6 ' + FONT + ';color:' + C.ink + ';}',
    '#captheorem .cap-top{padding:12px;border-bottom:1px solid ' + C.line + ';}',
    '#captheorem .cap-loud{margin:0 0 10px;padding:9px 12px;border-left:3px solid ' + C.amber + ';background:rgba(251,191,36,.08);border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#e8e2d2;}',
    '#captheorem .cap-loud b{color:' + C.amber + ';}',
    '#captheorem .cap-graphwrap{border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';padding:8px;}',
    '#captheorem .cap-svg{display:block;width:100%;height:auto;}',
    '#captheorem .cap-hit{cursor:pointer;}',
    '#captheorem .cap-legend{margin:8px 0 0;font-size:11px;line-height:1.7;color:' + C.faint + ';}',
    '#captheorem .cap-status{margin:8px 0 0;padding:8px 11px;border:1px solid ' + C.line + ';border-radius:8px;background:rgba(15,23,42,.6);font-size:12px;line-height:1.65;color:#cbd5e1;}',

    '#captheorem .cap-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,.6);}',
    '#captheorem .cap-tab{font:inherit;font-size:12px;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#captheorem .cap-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#captheorem .cap-tab[aria-selected="true"]{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#captheorem .cap-tab:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#captheorem .cap-body{display:grid;grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start;}',
    '#captheorem .cap-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,.6);min-width:0;}',
    '#captheorem .cap-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '#captheorem .cap-main:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:-2px;border-radius:10px;}',
    '@media (max-width:900px){#captheorem .cap-body{grid-template-columns:minmax(0,1fr);}' +
      '#captheorem .cap-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',

    '#captheorem .cap-group{margin:0 0 14px;}',
    '#captheorem .cap-group-title{margin:0 0 7px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#captheorem .cap-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 7px;}',
    '#captheorem .cap-field-label{color:' + C.dim + ';font-size:12px;}',
    '#captheorem .cap-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;}',
    '#captheorem .cap-btn:hover{background:#213152;border-color:#40608f;}',
    '#captheorem .cap-btn:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    '#captheorem .cap-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#captheorem .cap-btn.cut{color:#2a0b0b;background:' + C.red + ';border-color:' + C.red + ';font-weight:700;}',
    '#captheorem .cap-btn[disabled]{opacity:.4;cursor:default;}',
    '#captheorem .cap-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '#captheorem .cap-linkgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(6.2rem,1fr));gap:5px;margin-top:6px;}',
    '#captheorem .cap-linkgrid .cap-btn{padding:5px 6px;text-align:center;}',
    '#captheorem .cap-hint{margin:6px 0 0;font-size:11px;line-height:1.65;color:' + C.faint + ';}',
    '#captheorem .cap-text{width:100%;font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;}',
    '#captheorem .cap-select{font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:100%;}',
    '#captheorem .cap-text:focus-visible,#captheorem .cap-select:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#captheorem .cap-slider{margin:0 0 10px;}',
    '#captheorem .cap-slider-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:3px;}',
    '#captheorem .cap-slider-value{font-size:12px;font-weight:700;color:' + C.cyan + ';}',
    '#captheorem .cap-range{width:100%;accent-color:' + C.blue + ';cursor:pointer;}',
    '#captheorem .cap-range:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:3px;}',

    '#captheorem .cap-table{width:100%;border-collapse:collapse;font-size:12px;}',
    '#captheorem .cap-table th{padding:5px 7px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#captheorem .cap-td{padding:4px 7px;border-bottom:1px solid rgba(28,43,68,.6);color:' + C.ink + ';white-space:nowrap;}',
    '#captheorem .cap-scroll{overflow-x:auto;}',
    '#captheorem .cap-row-good .cap-td{color:' + C.green + ';}',
    '#captheorem .cap-row-bad .cap-td{color:' + C.red + ';}',
    '#captheorem .cap-row-now .cap-td{background:rgba(125,211,252,.08);font-weight:700;}',

    '#captheorem .cap-note{margin:0;padding:9px 12px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.75;color:#cbd5e1;}',
    '#captheorem .cap-note b{color:' + C.ink + ';}',
    '#captheorem .cap-warnnote{border-left-color:' + C.amber + ';background:rgba(251,191,36,.07);}',
    '#captheorem .cap-badnote{border-left-color:' + C.red + ';background:rgba(252,165,165,.07);}',
    '#captheorem .cap-goodnote{border-left-color:' + C.green + ';background:rgba(52,211,153,.07);}',
    '#captheorem .cap-h{margin:4px 0 0;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#captheorem .cap-sub{margin:0;font-size:11px;line-height:1.7;color:' + C.faint + ';}',
    '#captheorem .cap-prose{margin:0;font-size:12.5px;line-height:1.8;color:#cbd5e1;}',
    '#captheorem .cap-prose b{color:' + C.ink + ';}',

    '#captheorem .cap-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:10px;}',
    '#captheorem .cap-card{padding:11px 12px;border:1px solid ' + C.line + ';border-radius:10px;background:rgba(15,23,42,.55);min-width:0;}',
    '#captheorem .cap-card-good{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.06);}',
    '#captheorem .cap-card-bad{border-color:rgba(252,165,165,.45);background:rgba(252,165,165,.06);}',
    '#captheorem .cap-card-h{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';}',
    '#captheorem .cap-big{margin:0;font-size:20px;font-weight:700;line-height:1.25;color:' + C.cyan + ';overflow-wrap:anywhere;}',
    '#captheorem .cap-card-good .cap-big{color:' + C.green + ';}',
    '#captheorem .cap-card-bad .cap-big{color:' + C.red + ';}',
    '#captheorem .cap-card-note{margin:5px 0 0;font-size:11px;line-height:1.7;color:' + C.dim + ';white-space:normal;}',

    '#captheorem .cap-bars{display:flex;flex-direction:column;gap:6px;}',
    '#captheorem .cap-bar-row{display:flex;align-items:center;gap:9px;}',
    '#captheorem .cap-bar-name{flex:0 0 8.5rem;font-size:11px;color:' + C.dim + ';}',
    '#captheorem .cap-bar-track{flex:1 1 auto;height:18px;border-radius:5px;background:#111c2f;border:1px solid #24344f;overflow:hidden;min-width:2rem;}',
    '#captheorem .cap-bar-fill{height:100%;background:' + C.blue + ';}',
    '#captheorem .cap-bar-fill.slow{background:' + C.amber + ';}',
    '#captheorem .cap-bar-fill.fast{background:' + C.green + ';}',
    '#captheorem .cap-bar-num{flex:0 0 5rem;font-size:11px;text-align:right;color:' + C.ink + ';}',
    '#captheorem .cap-bar-dead{flex:1 1 auto;font-size:11px;color:' + C.red + ';}',

    '#captheorem .cap-log{margin:0;padding:9px 11px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg0 + ';font:inherit;font-size:11.5px;line-height:1.7;color:' + C.dim + ';max-height:13rem;overflow-y:auto;white-space:normal;}',
    '#captheorem .cap-log-line{margin:0 0 6px;overflow-wrap:anywhere;}',
    '#captheorem .cap-log-ok{color:#a7dcc4;}',
    '#captheorem .cap-log-warn{color:#e6cf9a;}',
    '#captheorem .cap-log-err{color:#f0b4b4;}',
    '#captheorem .cap-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:10px;}'
  ].join('');

  /* ======================================================================== */
  /*  THE GRAPH                                                               */
  /* ------------------------------------------------------------------------ */
  /*  SVG rather than canvas, for one reason: an edge you can click is an      */
  /*  element with its own hit area, and doing that on a canvas means writing  */
  /*  point-to-segment distance tests and getting them wrong on a resize. The  */
  /*  drawing is marked role="img" with a label that restates the whole state  */
  /*  in words, and every link also has a real button in the panel beside it,  */
  /*  so nothing here is reachable only with a mouse and no fact is carried    */
  /*  by colour alone.                                                        */
  /* ======================================================================== */

  var VIEW_W = 560, VIEW_H = 320;
  var NODE_R = 25;
  var POS = (function () {
    var out = [];
    for (var i = 0; i < NCLUSTER; i++) {
      var angle = -Math.PI / 2 + i * 2 * Math.PI / NCLUSTER;
      out.push({
        x: VIEW_W / 2 + Math.cos(angle) * 175,
        y: VIEW_H / 2 - 6 + Math.sin(angle) * 108
      });
    }
    return out;
  })();

  function Graph(app) {
    this.app = app;
    this.hover = -1;
    this.svg = S('svg', {
      viewBox: '0 0 ' + VIEW_W + ' ' + VIEW_H,
      'class': 'cap-svg', role: 'img'
    });
  }

  Graph.prototype.describe = function () {
    var cl = this.app.cluster;
    var cs = cl.components();
    var parts = [];
    for (var g = 0; g < cs.groups.length; g++) {
      parts.push('component ' + (g + 1) + ': ' +
        cs.groups[g].map(function (m) { return IDS[m]; }).join(' '));
    }
    var cutCount = 0;
    for (var i = 0; i < cl.cut.length; i++) if (cl.cut[i]) cutCount++;
    return 'Five nodes A to E and ten links. At N = ' + cl.n + ' the key lives on ' +
           IDS.slice(0, cl.n).join(' ') + '. ' + cutCount + ' ' +
           plural(cutCount, 'link is', 'links are') + ' cut. ' +
           parts.join('. ') + '. The same information is in the tables below.';
  };

  Graph.prototype.setCaption = function (index) {
    if (!this.cap) return;
    var cl = this.app.cluster;
    if (index < 0 || index >= LINKS.length) {
      this.cap.setAttribute('fill', C.faint);
      this.cap.textContent =
        'Click any link to cut it. Every link also has a button below.';
      return;
    }
    var link = LINKS[index];
    this.cap.setAttribute('fill', C.cyan);
    this.cap.textContent = IDS[link.a] + ' to ' + IDS[link.b] + ' — ' +
      (SITE[link.a] === SITE[link.b]
        ? 'same site, ' + cl.near + ' ms' : 'cross site, ' + cl.far + ' ms') + ' — ' +
      (cl.cut[index] ? 'cut, click to restore' : 'click to cut');
  };

  Graph.prototype.render = function () {
    var self = this;
    var cl = this.app.cluster;
    var cs = cl.components();
    var svg = this.svg;
    clear(svg);
    svg.setAttribute('aria-label', this.describe());

    var i;
    var liveLines = [];
    /* Edges first so the node discs paint over their ends. */
    for (i = 0; i < LINKS.length; i++) {
      var link = LINKS[i];
      var p = POS[link.a], q = POS[link.b];
      var isCut = cl.cut[i];
      var cross = SITE[link.a] !== SITE[link.b];
      var mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;

      if (isCut) {
        /* A cut link is drawn as two stubs with a gap, plus a cross in the
           gap. The gap is the point: a dashed line at a glance reads as
           "slow" rather than "gone". */
        var dx = q.x - p.x, dy = q.y - p.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / len, uy = dy / len;
        svg.appendChild(S('line', {
          x1: p.x, y1: p.y, x2: mx - ux * 13, y2: my - uy * 13,
          stroke: '#3c1f26', 'stroke-width': cross ? 1.4 : 3,
          'stroke-dasharray': '4 4'
        }));
        svg.appendChild(S('line', {
          x1: mx + ux * 13, y1: my + uy * 13, x2: q.x, y2: q.y,
          stroke: '#3c1f26', 'stroke-width': cross ? 1.4 : 3,
          'stroke-dasharray': '4 4'
        }));
        svg.appendChild(S('line', {
          x1: mx - 6, y1: my - 6, x2: mx + 6, y2: my + 6,
          stroke: C.red, 'stroke-width': 2.2, 'stroke-linecap': 'round'
        }));
        svg.appendChild(S('line', {
          x1: mx + 6, y1: my - 6, x2: mx - 6, y2: my + 6,
          stroke: C.red, 'stroke-width': 2.2, 'stroke-linecap': 'round'
        }));
      } else {
        var vis = S('line', {
          x1: p.x, y1: p.y, x2: q.x, y2: q.y,
          stroke: cross ? '#26466b' : '#3c6ea3',
          'stroke-width': cross ? 1.4 : 3.4
        });
        liveLines[i] = vis;
        svg.appendChild(vis);
      }

      /* A fat invisible line on top of each edge is the click target. */
      var hit = S('line', {
        x1: p.x, y1: p.y, x2: q.x, y2: q.y,
        stroke: 'transparent', 'stroke-width': 16, 'class': 'cap-hit'
      });
      /* Hover only touches the caption and one stroke. An earlier version
         re-rendered the whole graph on mouseenter, which replaced the element
         the pointer was sitting on — so mouseleave never fired for it and the
         caption stayed stuck on whichever link you had touched last. */
      (function (index, lineEl) {
        hit.addEventListener('click', function () { self.app.toggleLink(index); });
        hit.addEventListener('mouseenter', function () {
          self.hover = index;
          self.setCaption(index);
          if (lineEl) lineEl.setAttribute('stroke', C.cyan);
        });
        hit.addEventListener('mouseleave', function () {
          self.hover = -1;
          self.setCaption(-1);
          if (lineEl) {
            lineEl.setAttribute('stroke',
              SITE[LINKS[index].a] !== SITE[LINKS[index].b] ? '#26466b' : '#3c6ea3');
          }
        });
      })(i, liveLines[i]);
      svg.appendChild(hit);
    }

    /* The hover read-out: with ten chords crossing each other, saying which
       link is under the pointer is the difference between a usable picture and
       a lucky click. */
    this.cap = S('text', {
      x: VIEW_W / 2, y: 16, 'text-anchor': 'middle',
      fill: C.faint, 'font-size': 12, 'font-family': FONT
    });
    svg.appendChild(this.cap);
    this.setCaption(this.hover);

    for (i = 0; i < NCLUSTER; i++) {
      var pos = POS[i];
      var comp = cs.of[i];
      var colour = COMP_COLOUR[comp % COMP_COLOUR.length];
      var replica = cl.isReplica(i);
      var list = cl.store[i];
      var fresh = false;
      for (var k = 0; k < list.length; k++) {
        if (list[k].seq === cl.lastAck.seq) fresh = true;
      }

      svg.appendChild(S('circle', {
        cx: pos.x, cy: pos.y, r: NODE_R,
        fill: replica ? '#0e1b30' : '#0a1120',
        stroke: replica ? colour : '#334155',
        'stroke-width': replica ? 2.4 : 1.4,
        'stroke-dasharray': replica ? 'none' : '3 3'
      }));
      var letter = S('text', {
        x: pos.x, y: pos.y + 5, 'text-anchor': 'middle',
        fill: replica ? C.ink : C.faint, 'font-size': 17,
        'font-weight': 700, 'font-family': FONT
      });
      letter.textContent = IDS[i];
      svg.appendChild(letter);

      var badge = S('text', {
        x: pos.x, y: pos.y - NODE_R - 8, 'text-anchor': 'middle',
        fill: colour, 'font-size': 10.5, 'font-family': FONT
      });
      badge.textContent = 'part ' + (comp + 1) + ' · ' + SITE_NAME[SITE[i]];
      svg.appendChild(badge);

      var valueText;
      if (!replica) valueText = 'no copy';
      else if (!list.length) valueText = 'empty';
      else if (list.length > 1) {
        valueText = list.map(function (x) { return x.value; }).join(' | ');
      } else valueText = list[0].value;
      if (valueText.length > 20) valueText = valueText.slice(0, 19) + '…';

      var val = S('text', {
        x: pos.x, y: pos.y + NODE_R + 15, 'text-anchor': 'middle',
        fill: !replica ? C.faint : (list.length > 1 ? C.amber : (fresh ? C.green : C.dim)),
        'font-size': 11.5, 'font-family': FONT
      });
      val.textContent = valueText;
      svg.appendChild(val);

      if (replica) {
        var mark = S('text', {
          x: pos.x, y: pos.y + NODE_R + 28, 'text-anchor': 'middle',
          fill: C.faint, 'font-size': 10, 'font-family': FONT
        });
        mark.textContent = list.length > 1 ? 'siblings' : (fresh ? 'current' : 'stale');
        svg.appendChild(mark);
      }
    }
  };

  /* ======================================================================== */
  /*  PANEL 1 — PARTITION                                                     */
  /* ======================================================================== */

  function PartitionPanel(app) {
    this.app = app;
    this.label = 'Partition';
  }

  PartitionPanel.prototype.controls = function (side) {
    var cl = this.app.cluster, self = this;
    var redraw = function () { self.app.redraw(); };

    var g1 = group('Cut a link');
    var grid = E('div', 'cap-linkgrid');
    this.linkButtons = [];
    LINKS.forEach(function (link, index) {
      var b = E('button', 'cap-btn');
      b.type = 'button';
      b.addEventListener('click', function () { self.app.toggleLink(index); });
      grid.appendChild(b);
      self.linkButtons.push(b);
    });
    g1.appendChild(grid);
    g1.appendChild(E('p', 'cap-hint',
      'The word on each button says whether that link is up or cut; the colour ' +
      'only repeats it. Cutting a link never removes a node — the nodes are all ' +
      'still running, still holding data, still answering. That is exactly what ' +
      'makes a partition harder than a crash.'));
    side.appendChild(g1);

    var g2 = group('Ready-made partitions');
    var row = E('div', 'cap-btnrow');
    row.appendChild(button('Repair every link', function () {
      cl.healAll();
      cl.say('Every link is back up. Nothing has merged yet — replicas do not ' +
             'know they disagree until they exchange state. Run anti-entropy on ' +
             'the writes tab to find out what happened while they were apart.', 'info');
      redraw();
    }));
    /* These messages are derived rather than written out, because N is a slider.
       "A B C is the majority side: three of five replicas" was hardcoded, and at
       N = 3 or N = 4 it was simply false about the cluster on screen. */
    row.appendChild(button('Split 3 – 2', function () {
      cl.healAll();
      [0, 1, 2].forEach(function (a) {
        [3, 4].forEach(function (b) { cl.cut[LINK_AT[a][b]] = true; });
      });
      var left = cl.replicasIn([0, 1, 2]).length;
      var right = cl.replicasIn([3, 4]).length;
      cl.say('Cut into A B C and D E. At N = ' + cl.n + ' that is ' + left + ' of the ' +
             cl.n + ' replicas on one side and ' + right + ' on the other' +
             (left * 2 > cl.n
               ? ', so A B C is the majority side'
               : (right * 2 > cl.n
                   ? ', so D E is the majority side'
                   : ', and neither side holds a majority')) +
             '. Each side can talk to itself perfectly well and to nobody else.', 'info');
      redraw();
    }));
    row.appendChild(button('Isolate E', function () {
      cl.healAll();
      for (var b = 0; b < NCLUSTER; b++) if (b !== 4) cl.cut[LINK_AT[4][b]] = true;
      cl.say('E is alone. Note what has NOT happened: E has not crashed. It is up, ' +
             'it will answer, and it believes it is fine.', 'info');
      redraw();
    }));
    row.appendChild(button('Cut every cross-site link', function () {
      cl.healAll();
      LINKS.forEach(function (link, index) {
        if (SITE[link.a] !== SITE[link.b]) cl.cut[index] = true;
      });
      var cs2 = cl.components();
      var maj = null, writable = [];
      cs2.groups.forEach(function (g, gi) {
        var reps = cl.replicasIn(g).length;
        if (reps * 2 > cl.n) maj = gi;
        if (reps >= cl.w) writable.push('component ' + (gi + 1));
      });
      cl.say('Three components, one per site: A B, then C, then D E. ' +
             (maj === null
               ? 'No component holds a majority of the ' + cl.n + ' replicas. '
               : 'Component ' + (maj + 1) + ' still holds a majority of the ' + cl.n +
                 ' replicas. ') +
             (writable.length
               ? 'Under CP, W = ' + cl.w + ' is still met in ' + writable.join(' and ') +
                 ', so the key stays writable there and refused everywhere else.'
               : 'Under CP, W = ' + cl.w + ' is met nowhere, so the key is unwritable ' +
                 'everywhere at once.'), 'info');
      redraw();
    }));
    g2.appendChild(row);
    side.appendChild(g2);
    this.sync();
  };

  /* The link buttons are the only controls on this panel that carry state, and
     the state can change from the graph as well as from the button. Updating
     them in place rather than rebuilding the panel keeps the focused button
     focused, which matters when the graph is being driven from the keyboard. */
  PartitionPanel.prototype.sync = function () {
    var cl = this.app.cluster;
    if (!this.linkButtons) return;
    this.linkButtons.forEach(function (b, index) {
      var link = LINKS[index];
      var isCut = cl.cut[index];
      b.textContent = IDS[link.a] + '–' + IDS[link.b] + (isCut ? ' cut' : ' up');
      b.className = 'cap-btn' + (isCut ? ' cut' : '');
      b.setAttribute('aria-pressed', isCut ? 'true' : 'false');
      b.setAttribute('aria-label', (isCut ? 'Restore' : 'Cut') +
        ' the link between ' + IDS[link.a] + ' and ' + IDS[link.b]);
    });
  };

  PartitionPanel.prototype.render = function (main) {
    var cl = this.app.cluster;
    var cs = cl.components();

    var cutCount = 0;
    for (var i = 0; i < cl.cut.length; i++) if (cl.cut[i]) cutCount++;

    var cards = E('div', 'cap-cards');
    cards.appendChild(card('Links cut', cutCount + ' of ' + LINKS.length,
      'Counted from the link state, not from the preset you pressed.'));
    cards.appendChild(card('Components', String(cs.groups.length),
      'Found by walking the links that are still up.',
      cs.groups.length > 1 ? 'cap-card-bad' : 'cap-card-good'));
    var majority = null;
    for (i = 0; i < cs.groups.length; i++) {
      if (cl.replicasIn(cs.groups[i]).length * 2 > cl.n) majority = i;
    }
    cards.appendChild(card('Majority side',
      majority === null ? 'nobody' : 'component ' + (majority + 1),
      majority === null
        ? 'No group holds more than half of the ' + cl.n + ' replicas, so a ' +
          'majority-quorum system is down for writes everywhere at once.'
        : 'More than half of the ' + cl.n + ' replicas. A consensus system would ' +
          'keep serving here and refuse everywhere else.',
      majority === null ? 'cap-card-bad' : ''));
    main.appendChild(cards);

    var rows = cs.groups.map(function (members, index) {
      var reps = cl.replicasIn(members);
      var canWrite = reps.length >= cl.w;
      var canRead = reps.length >= cl.r;
      var isMaj = reps.length * 2 > cl.n;
      return {
        cls: canWrite && canRead ? 'cap-row-good' : 'cap-row-bad',
        cells: [
          'component ' + (index + 1),
          members.map(function (m) { return IDS[m]; }).join(' '),
          reps.length + ' of ' + cl.n,
          isMaj ? 'yes' : 'no',
          canWrite ? 'yes, W = ' + cl.w + ' is met' : 'no, needs ' + cl.w,
          canRead ? 'yes, R = ' + cl.r + ' is met' : 'no, needs ' + cl.r
        ]
      };
    });
    main.appendChild(E('p', 'cap-h', 'Components, and what each one may do'));
    main.appendChild(table(
      ['Component', 'Nodes', 'Replicas', 'Majority', 'Accepts writes under CP', 'Serves reads under CP'],
      rows));
    main.appendChild(E('p', 'cap-sub',
      'The last two columns are the CP answer, counted from the replicas in each ' +
      'component. Under AP both columns would read yes everywhere, and the price ' +
      'is on the writes tab. Under either letter the nodes are all still up: a ' +
      'partition is not an outage, which is why the failure detector cannot just ' +
      'wait for the dead node to come back.'));

    if (cs.groups.length > 1) {
      main.appendChild(note(
        'While this partition lasts, every node in every component still believes it ' +
        'is a healthy database. None of them can tell the difference between a peer ' +
        'that is gone, a peer that is slow, and a network that has dropped the reply. ' +
        'That indistinguishability is the entire proof: an asynchronous network gives ' +
        'a node no way to wait long enough to be sure. Nothing here is slow rather ' +
        'than cut, which makes this sandbox easier than reality, not harder.',
        'cap-warnnote'));
    } else {
      main.appendChild(note(
        'No partition. Everything below is now decided by things CAP does not talk ' +
        'about at all: how many replicas you wait for, and how far away they are. ' +
        'That is the else half of PACELC, and it is where a distributed database ' +
        'spends more or less all of its life.',
        'cap-goodnote'));
    }
  };

  /* ======================================================================== */
  /*  PANEL 2 — WRITES AND READS                                              */
  /* ======================================================================== */

  function WritePanel(app) {
    this.app = app;
    this.label = 'Writes and reads';
    this.last = null;
    this.resolution = null;
  }

  WritePanel.prototype.controls = function (side) {
    var cl = this.app.cluster, self = this;
    var redraw = function () { self.app.redraw(); };

    var g0 = group('Behaviour during a partition');
    var row0 = E('div', 'cap-btnrow');
    this.modeButtons = [];
    ['cp', 'ap'].forEach(function (mode) {
      var b = E('button', 'cap-btn',
                mode === 'cp' ? 'CP — refuse without a quorum'
                              : 'AP — accept and diverge');
      b.type = 'button';
      b.capMode = mode;
      self.modeButtons.push(b);
      b.addEventListener('click', function () {
        cl.mode = mode;
        cl.say(mode === 'cp'
          ? 'CP selected. A replica that cannot see W of its peers now returns an ' +
            'error rather than an answer. It stays up and healthy the whole time; it ' +
            'just refuses this key. CP does not mean the process is dead.'
          : 'AP selected. Every replica now answers from whatever it holds. It does ' +
            'not mean the data is wrong — with no partition and no concurrent write ' +
            'it is identical to CP. It means that when the sides do diverge, nothing ' +
            'stops them.', 'info');
        redraw();
      });
      row0.appendChild(b);
    });
    g0.appendChild(row0);
    g0.appendChild(E('p', 'cap-hint',
      'This choice only has an effect while a component is short of a quorum. With ' +
      'every link up, CP and AP behave identically here, which is the part the ' +
      'slogan hides.'));
    side.appendChild(g0);

    var g1 = group('Write');
    var label = E('label', 'cap-field-label', 'Value to write');
    var input = E('input', 'cap-text');
    input.type = 'text';
    input.value = VALUES[cl.valueIndex % VALUES.length];
    input.maxLength = 24;
    input.id = uid('cap-val-');
    label.setAttribute('for', input.id);
    g1.appendChild(label);
    g1.appendChild(input);

    function nextValue() {
      cl.valueIndex++;
      input.value = VALUES[cl.valueIndex % VALUES.length];
    }
    function currentValue() {
      var v = String(input.value || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (!v) return VALUES[cl.valueIndex % VALUES.length];
      return v.length > 24 ? v.slice(0, 24) : v;
    }

    var wrow = E('div', 'cap-btnrow');
    this.nodeButtons = [];
    IDS.forEach(function (id, index) {
      var b = button('Write at ' + id, function () {
        var v = currentValue();
        self.last = cl.write(index, v);
        if (self.last.ok) nextValue();
        redraw();
      });
      b.capNode = index;
      b.setAttribute('aria-label', 'Write the value at node ' + id);
      wrow.appendChild(b);
      self.nodeButtons.push(b);
    });
    g1.appendChild(wrow);
    side.appendChild(g1);

    var g2 = group('Read');
    var rrow = E('div', 'cap-btnrow');
    IDS.forEach(function (id, index) {
      var b = button('Read at ' + id, function () {
        self.last = cl.read(index);
        redraw();
      });
      b.capNode = index;
      b.setAttribute('aria-label', 'Read the value at node ' + id);
      rrow.appendChild(b);
      self.nodeButtons.push(b);
    });
    g2.appendChild(rrow);
    g2.appendChild(E('p', 'cap-hint',
      'A read contacts the R nearest replicas it can reach and merges what comes ' +
      'back. It does not repair anything, so divergence stays visible.'));
    side.appendChild(g2);

    var g3 = group('Reconciliation');
    var row3 = E('div', 'cap-btnrow');
    row3.appendChild(button('Run anti-entropy', function () {
      self.resolution = null;
      cl.gossip();
      redraw();
    }));
    row3.appendChild(button('Repair every link', function () {
      cl.healAll();
      cl.say('Every link is back. Still nothing has merged: repairing a network does ' +
             'not repair the data. Run anti-entropy.', 'info');
      redraw();
    }));
    row3.appendChild(button('Reset the key', function () {
      self.last = null;
      self.resolution = null;
      cl.reset();
      redraw();
    }));
    g3.appendChild(row3);
    side.appendChild(g3);

    var g4 = group('Clock skew, for last-write-wins');
    var sel = E('select', 'cap-select');
    sel.id = uid('cap-skew-');
    IDS.forEach(function (id, index) {
      var op = E('option', null, 'node ' + id);
      op.value = String(index);
      if (index === cl.skewNode) op.selected = true;
      sel.appendChild(op);
    });
    var skewSlider = slider('Its clock is off by', -3000, 3000, 100,
      cl.skew[cl.skewNode], function (v) { return v + ' ms'; },
      function (v) {
        cl.skew[cl.skewNode] = v;
        redraw();
      });
    sel.addEventListener('change', function () {
      cl.skewNode = parseInt(sel.value, 10);
      /* Moving the selector has to pull the slider onto the newly selected
         node's offset, in place. Rebuilding the panel here would work and would
         also throw focus off the select. */
      skewSlider.setValue(cl.skew[cl.skewNode]);
      redraw();
    });
    var selLabel = E('label', 'cap-field-label', 'Skewed node');
    selLabel.setAttribute('for', sel.id);
    var frow = E('div', 'cap-field');
    frow.appendChild(selLabel);
    frow.appendChild(sel);
    g4.appendChild(frow);
    g4.appendChild(skewSlider);
    g4.appendChild(E('p', 'cap-hint',
      'Every write is stamped with the clock of the node that took it, which here ' +
      'is the sandbox clock plus this offset. Set an offset, make two concurrent ' +
      'writes on either side of a partition, and watch last-write-wins hand the key ' +
      'to the older one. No error is raised anywhere when that happens.'));
    side.appendChild(g4);
    this.sync();
  };

  WritePanel.prototype.sync = function () {
    var cl = this.app.cluster;
    if (this.modeButtons) {
      this.modeButtons.forEach(function (b) {
        var on = cl.mode === b.capMode;
        b.className = 'cap-btn' + (on ? ' on' : '');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    if (this.nodeButtons) {
      this.nodeButtons.forEach(function (b) { b.disabled = !cl.isReplica(b.capNode); });
    }
  };

  WritePanel.prototype.render = function (main) {
    var cl = this.app.cluster, self = this;
    var cs = cl.components();

    /* The per-node table is the ground truth of the whole lab: what each
       replica is actually holding, with the vector that decides whether two of
       them can be ordered. */
    var rows = [];
    for (var i = 0; i < NCLUSTER; i++) {
      var list = cl.store[i];
      var fresh = false;
      for (var k = 0; k < list.length; k++) if (list[k].seq === cl.lastAck.seq) fresh = true;
      if (!cl.isReplica(i)) {
        rows.push({ cells: [IDS[i], SITE_NAME[SITE[i]], 'part ' + (cs.of[i] + 1),
                            'no copy of this key', '—', '—', '—'] });
        continue;
      }
      rows.push({
        cls: list.length > 1 ? 'cap-row-bad' : (fresh ? 'cap-row-good' : ''),
        cells: [
          IDS[i], SITE_NAME[SITE[i]], 'part ' + (cs.of[i] + 1),
          list.length ? list.map(function (x) { return x.value; }).join(' | ') : 'empty',
          list.length ? list.map(function (x) { return vvText(x.vv); }).join(' | ') : '{}',
          list.length ? list.map(function (x) { return IDS[x.writer]; }).join(' | ') : '—',
          list.length > 1 ? String(list.length) + ' concurrent values'
                          : (!list.length ? 'never written to'
                                          : (fresh ? 'current' : 'stale'))
        ]
      });
    }
    main.appendChild(E('p', 'cap-h', 'What each replica is holding right now'));
    main.appendChild(table(['Node', 'Site', 'Component', 'Value', 'Version vector',
                            'Written by', 'State'], rows));

    /* Divergence side by side, per component, while the partition is open. */
    if (cs.groups.length > 1) {
      var cols = E('div', 'cap-cols');
      cs.groups.forEach(function (members, index) {
        var reps = cl.replicasIn(members);
        var values = [], vectors = [];
        reps.forEach(function (m) {
          cl.store[m].forEach(function (x) {
            if (values.indexOf(x.value) < 0) {
              values.push(x.value);
              vectors.push(vvText(x.vv));
            }
          });
        });
        var box = E('div', 'cap-card');
        box.appendChild(E('p', 'cap-card-h', 'component ' + (index + 1) + ' · ' +
          members.map(function (m) { return IDS[m]; }).join(' ')));
        box.appendChild(E('p', 'cap-big', values.length ? values.join(' | ') : 'no replicas'));
        box.appendChild(E('p', 'cap-card-note',
          (vectors.length ? vectors.join(' and ') + '. ' : '') +
          reps.length + ' of ' + cl.n + ' replicas. ' +
          (reps.length >= cl.w ? 'Meets W = ' + cl.w + '.' : 'Short of W = ' + cl.w + '.')));
        cols.appendChild(box);
      });
      /* "The two sides" was wrong the moment a third component existed, which
         the cross-site preset produces on its own. */
      main.appendChild(E('p', 'cap-h', cs.groups.length === 2
        ? 'The two sides, side by side'
        : 'All ' + cs.groups.length + ' sides, side by side'));
      main.appendChild(cols);
      main.appendChild(E('p', 'cap-sub',
        'Each side is internally consistent and entirely convinced it is right. ' +
        'None of them is wrong yet; they are simply concurrent. The damage, if there ' +
        'is any, is done at the moment you make them agree.'));
    }

    /* The conflict card. */
    var siblings = cl.allSiblings();
    if (cl.conflicted() && siblings.length > 1) {
      main.appendChild(E('p', 'cap-h', 'Conflict'));
      main.appendChild(note(
        'A replica is holding ' + siblings.length + ' values at once. Their version ' +
        'vectors are ' +
        siblings.map(function (s) { return vvText(s.vv); }).join(' and ') +
        ', and neither is greater than or equal to the other in every position, so ' +
        'they are concurrent by definition. There is no ordering to discover here. ' +
        'A database that picks one is not resolving a conflict, it is choosing which ' +
        'acknowledged write to throw away.', 'cap-badnote'));

      var srows = siblings.map(function (s) {
        return [s.value, vvText(s.vv), IDS[s.writer], secs(s.ts),
                '#' + s.seq, cl.skew[s.writer] ? cl.skew[s.writer] + ' ms' : 'none'];
      });
      main.appendChild(table(['Value', 'Version vector', 'Written at',
                              'Its node clock said', 'True order', 'That node skew'], srows));

      var split = cl.split();
      var actions = E('div', 'cap-btnrow');
      var opts = [
        ['lww-clock', 'Last write wins (node clocks)'],
        ['lww-true', 'Last write wins (true order)'],
        ['union', 'Union them'],
        ['siblings', 'Keep both as siblings']
      ];
      opts.forEach(function (o) {
        var b = button(o[1], function () {
          self.resolution = cl.resolve(o[0]);
          self.app.redraw();
        });
        b.disabled = split;
        actions.appendChild(b);
      });
      main.appendChild(actions);
      if (split) {
        main.appendChild(E('p', 'cap-sub',
          'The resolution buttons are disabled because the cluster is still split. ' +
          'Nothing can be reconciled across a partition — that is what a partition is. ' +
          'Repair the links first.'));
      } else {
        main.appendChild(E('p', 'cap-sub',
          'Last write wins is what most stores do by default and it is the only ' +
          'option here that silently deletes data. Union is what a grow-only set ' +
          'does, and it is safe only because union is commutative, associative and ' +
          'idempotent; try it on a balance and it is nonsense. Keeping siblings is ' +
          'the Dynamo answer: it does not lose anything and it moves the whole ' +
          'problem into your application, where the shopping cart that keeps a ' +
          'deleted item lives.'));
      }
    }

    if (this.resolution) {
      var res = this.resolution;
      var box2;
      if (res.how === 'siblings') {
        box2 = note('Both values kept. Nothing was lost and nothing is decided. Your ' +
          'next read returns ' + res.kept.length + ' values and the application has to ' +
          'know what to do with them.', 'cap-warnnote');
      } else {
        /* The trailing sentence is about ranking, so it only belongs on a rule
           that had to rank. A union discards nothing, and saying "clock skew
           just picked the winner" underneath "nothing was discarded" was two
           contradictory sentences in one paragraph. */
        var tail = '';
        if (res.disagree && res.how !== 'union') {
          tail = ' The wall clocks and the true order disagree about which write was ' +
                 'last: the clocks say ' + res.byClock.value + ', the true order says ' +
                 res.byTrue.value + '. ' +
                 (res.skewDecided
                   ? 'Clock skew just picked the winner, and nothing in a real cluster ' +
                     'could have noticed.'
                   : 'You resolved on the true order, which the sandbox has and a real ' +
                     'cluster does not. On wall clocks alone this would have kept ' +
                     res.byClock.value + '.');
        }
        box2 = note('Now ' + res.winner.value + ' everywhere.' +
          (res.lost.length
            ? ' Lost: ' + res.lost.map(function (l) { return l.value; }).join(', ') +
              '. ' + plural(res.lost.length, 'That write', 'Those writes') +
              ' returned success to a client that has no way to find out.'
            : ' Nothing was discarded; the union kept every value.') + tail,
          res.skewDecided ? 'cap-badnote' : 'cap-warnnote');
      }
      main.appendChild(box2);
    }

    /* The transcript. Only the newest line is a live region; a whole scrolling
       dump read aloud on every click would be unusable. */
    main.appendChild(E('p', 'cap-h', 'Transcript'));
    var live = E('p', 'cap-status', cl.status);
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    main.appendChild(live);
    var log = E('div', 'cap-log');
    var lines = cl.log.slice(Math.max(0, cl.log.length - 12));
    for (var j = lines.length - 1; j >= 0; j--) {
      log.appendChild(E('p', 'cap-log-line cap-log-' + lines[j].kind, lines[j].text));
    }
    if (!lines.length) log.appendChild(E('p', 'cap-log-line', 'Nothing yet.'));
    main.appendChild(log);
  };

  /* ======================================================================== */
  /*  PANEL 3 — QUORUM ARITHMETIC                                             */
  /* ======================================================================== */

  function QuorumPanel(app) {
    this.app = app;
    this.label = 'Quorum';
  }

  QuorumPanel.prototype.controls = function (side) {
    var cl = this.app.cluster, self = this;
    var redraw = function () { self.app.redraw(); };
    var num = function (v) { return String(v); };

    var rSlider = slider('R — replicas a read waits for', 1, cl.n, 1, cl.r, num,
      function (v) { cl.r = v; redraw(); });
    var wSlider = slider('W — replicas a write waits for', 1, cl.n, 1, cl.w, num,
      function (v) { cl.w = v; redraw(); });

    var g = group('N, R and W');
    g.appendChild(slider('N — replicas holding the key', 3, 5, 1, cl.n, num,
      function (v) {
        cl.n = v;
        if (cl.r > v) { cl.r = v; rSlider.setValue(v); }
        if (cl.w > v) { cl.w = v; wSlider.setValue(v); }
        rSlider.setMax(v);
        wSlider.setMax(v);
        /* Nodes that fall outside the preference list stop holding the key, and
           ones that come back into it start empty rather than magically holding
           the current value — a replica that was never written to is stale, and
           pretending otherwise would fake the one number this panel is for. */
        for (var i = v; i < NCLUSTER; i++) cl.store[i] = [];
        cl.say('N = ' + v + '. The key now lives on ' +
               IDS.slice(0, v).join(' ') + '. Any node outside that list holds ' +
               'nothing and answers nothing. Widening N again does not hand the ' +
               'returning node a copy: it comes back empty, which is exactly what ' +
               'a freshly added replica is.', 'info');
        redraw();
      }));
    g.appendChild(rSlider);
    g.appendChild(wSlider);
    g.appendChild(E('p', 'cap-hint',
      'Sliding N drops the key from any node that falls out of the preference ' +
      'list, and does not invent a copy on any node that falls into it.'));
    side.appendChild(g);

    var g2 = group('Named configurations');
    var row = E('div', 'cap-btnrow');
    [['R = 1, W = N', 1, 0], ['R = N, W = 1', 0, 1], ['majority both', -1, -1],
     ['R = 1, W = 1', 1, 1]].forEach(function (p) {
      row.appendChild(button(p[0], function () {
        var maj = Math.floor(cl.n / 2) + 1;
        cl.r = p[1] === 0 ? cl.n : (p[1] < 0 ? maj : p[1]);
        cl.w = p[2] === 0 ? cl.n : (p[2] < 0 ? maj : p[2]);
        rSlider.setValue(cl.r);
        wSlider.setValue(cl.w);
        redraw();
      }));
    });
    g2.appendChild(row);
    side.appendChild(g2);
  };

  QuorumPanel.prototype.render = function (main) {
    var cl = this.app.cluster;
    var proof = cl.overlapProof();
    var stale = cl.stalenessCount();
    var sum = cl.r + cl.w;

    var cards = E('div', 'cap-cards');
    cards.appendChild(card('R + W vs N', cl.r + ' + ' + cl.w + ' = ' + sum +
      (sum > cl.n ? ' > ' : ' ≤ ') + cl.n,
      sum > cl.n
        ? 'Every read set overlaps every write set, so a read cannot miss a ' +
          'completed write.'
        : 'A read set and a write set can be disjoint, so a read can legally ' +
          'return a value older than a write that already returned success.',
      sum > cl.n ? 'cap-card-good' : 'cap-card-bad'));
    cards.appendChild(card('Write failures tolerated', String(cl.n - cl.w),
      'W = ' + cl.w + ' of ' + cl.n + ' must answer, so ' + (cl.n - cl.w) + ' ' +
      plural(cl.n - cl.w, 'replica', 'replicas') + ' may be unreachable before ' +
      'writes stop.', cl.n - cl.w === 0 ? 'cap-card-bad' : ''));
    cards.appendChild(card('Read failures tolerated', String(cl.n - cl.r),
      'R = ' + cl.r + ' of ' + cl.n + ' must answer, so ' + (cl.n - cl.r) + ' ' +
      plural(cl.n - cl.r, 'replica', 'replicas') + ' may be unreachable before ' +
      'reads stop.', cl.n - cl.r === 0 ? 'cap-card-bad' : ''));
    cards.appendChild(card('Both still working with',
      Math.min(cl.n - cl.r, cl.n - cl.w) + ' down',
      'The smaller of the two. This is the number that decides whether a routine ' +
      'node restart is an incident.'));
    main.appendChild(cards);

    main.appendChild(E('p', 'cap-h', 'The overlap, enumerated rather than asserted'));
    main.appendChild(note(
      'There are ' + proof.writeSets + ' ways to choose a write set of ' + cl.w +
      ' replicas out of ' + cl.n + ', and ' + proof.readSets + ' ways to choose a ' +
      'read set of ' + cl.r + '. That is ' + proof.pairs + ' pairs, and every one ' +
      'of them was checked just now. ' +
      (proof.guaranteed
        ? 'All ' + proof.pairs + ' pairs share at least one replica, so any read ' +
          'that completes must touch a replica that took part in the last write ' +
          'that completed. That is the whole content of R + W > N, and it is a ' +
          'statement about set intersection, not about time.'
        : proof.disjoint + ' of the ' + proof.pairs + ' pairs share nothing at all. ' +
          'One of them: the write goes to ' + maskNames(proof.example.w, IDS) +
          ' and the read asks ' + maskNames(proof.example.r, IDS) +
          ', which have no node in common, so that read returns an older value and ' +
          'nothing anywhere is broken. It is the configuration doing what it was ' +
          'told to do.'),
      proof.guaranteed ? 'cap-goodnote' : 'cap-badnote'));

    main.appendChild(E('p', 'cap-h', 'The same question against the state you have now'));
    main.appendChild(note(
      'The newest acknowledged write is ' + cl.lastAck.value + ' at ' +
      IDS[cl.lastAck.writer] + ' ' + vvText(cl.lastAck.vv) + '. ' +
      stale.holderCount + ' of the ' + cl.n + ' replicas hold it (' +
      (stale.holderCount ? maskNames(stale.holders, IDS) : 'none') + '). Of the ' +
      stale.total + ' possible read sets of ' + cl.r + ' ' +
      plural(cl.r, 'replica', 'replicas') + ', ' + stale.hit + ' would return it and ' +
      stale.miss + ' would not' +
      (stale.missExample
        ? ', for example a read that happened to ask ' +
          maskNames(stale.missExample, IDS) + '.'
        : '.') +
      ' Those numbers come from looking at who is actually holding the value, so ' +
      'after a partition they can be worse than the general answer above.',
      stale.miss ? 'cap-warnnote' : 'cap-goodnote'));

    /* The R by W grid. The fact is in the cell text; the colour repeats it. */
    var head = ['W \\ R'];
    for (var r = 1; r <= cl.n; r++) head.push('R = ' + r);
    var grid = [];
    for (var w = 1; w <= cl.n; w++) {
      var cells = ['W = ' + w];
      for (r = 1; r <= cl.n; r++) {
        cells.push((r + w > cl.n ? 'overlap' : 'gap') +
                   (r === cl.r && w === cl.w ? ' ◀ now' : ''));
      }
      grid.push({ cls: w === cl.w ? 'cap-row-now' : '', cells: cells });
    }
    main.appendChild(E('p', 'cap-h', 'Every setting of R and W at N = ' + cl.n));
    main.appendChild(table(head, grid));

    main.appendChild(E('p', 'cap-h', 'What the corners actually buy'));
    main.appendChild(table(
      ['Configuration', 'Overlap', 'Write waits for', 'Read waits for', 'Costs'],
      [
        ['R = 1, W = ' + cl.n, 'yes', 'every replica', 'the nearest one',
         'reads are as fast and as current as they get; one unreachable replica ' +
         'stops all writes'],
        ['R = ' + cl.n + ', W = 1', 'yes', 'the local copy only', 'every replica',
         'writes are instant; one unreachable replica stops all reads'],
        ['R = W = ' + (Math.floor(cl.n / 2) + 1), 'yes', 'a majority', 'a majority',
         'the usual default: both sides survive ' + (cl.n - Math.floor(cl.n / 2) - 1) +
         ' ' + plural(cl.n - Math.floor(cl.n / 2) - 1, 'failure', 'failures')],
        ['R = 1, W = 1', 'no', 'the local copy only', 'the nearest one',
         'the fastest thing available and the weakest: two clients can write ' +
         'different values to different replicas with no partition anywhere']
      ]));

    main.appendChild(note(
      'What R + W > N does NOT give you. It is an intersection argument about ' +
      'completed operations, and it is weaker than it looks. A write that fails ' +
      'halfway is not rolled back, so some replicas keep it and a later read may ' +
      'or may not see it. Two writes that overlap in time are concurrent, and ' +
      'intersection says nothing about which of them a read returns. A sloppy ' +
      'quorum counts acknowledgements from nodes outside the preference list, so ' +
      'the W that answered may not be W of the N you are reading from. And a read ' +
      'running at the same time as a write may see either value, on either side ' +
      'of the read. Quorums buy you staleness bounds, not linearizability.',
      'cap-warnnote'));
  };

  /* ======================================================================== */
  /*  PANEL 4 — PACELC                                                        */
  /* ======================================================================== */

  function PacelcPanel(app) {
    this.app = app;
    this.label = 'PACELC';
    this.coord = 0;
  }

  PacelcPanel.prototype.controls = function (side) {
    var cl = this.app.cluster, self = this;
    var redraw = function () { self.app.redraw(); };

    var g = group('The link latency model');
    g.appendChild(slider('Same-site round trip', 0, 20, 1, cl.near, ms,
      function (v) { cl.near = v; redraw(); }));
    g.appendChild(slider('Cross-site round trip', 10, 400, 5, cl.far, ms,
      function (v) { cl.far = v; redraw(); }));
    g.appendChild(E('p', 'cap-hint',
      'These are numbers you choose, not measurements of anything. A and B are on ' +
      'site 1, C is alone on site 2, D and E are on site 3. Every link between two ' +
      'sites costs the cross-site figure and every link inside one costs the ' +
      'same-site figure.'));
    side.appendChild(g);

    var g2 = group('Coordinator');
    var row = E('div', 'cap-btnrow');
    this.coordButtons = [];
    IDS.forEach(function (id, index) {
      var b = E('button', 'cap-btn', id);
      b.type = 'button';
      b.capNode = index;
      b.setAttribute('aria-label', 'Coordinate from node ' + id);
      b.addEventListener('click', function () { self.coord = index; redraw(); });
      row.appendChild(b);
      self.coordButtons.push(b);
    });
    g2.appendChild(row);
    g2.appendChild(E('p', 'cap-hint',
      'The coordinator writes its own copy at zero cost and sends to the others in ' +
      'parallel, so the wait is the W-th smallest round trip. No queueing, no disk ' +
      'flush, no retry, no tail. A real p99 is made of the things this leaves out.'));
    side.appendChild(g2);
    this.sync();
  };

  PacelcPanel.prototype.sync = function () {
    var cl = this.app.cluster, self = this;
    if (!this.coordButtons) return;
    this.coordButtons.forEach(function (b) {
      var on = self.coord === b.capNode;
      b.className = 'cap-btn' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = !cl.isReplica(b.capNode);
    });
  };

  PacelcPanel.prototype.render = function (main) {
    var cl = this.app.cluster;
    var coord = this.coord;
    if (!cl.isReplica(coord)) coord = 0;
    var sum = cl.r + cl.w;
    var ec = sum > cl.n;

    var wl = cl.orderStat(coord, cl.w);
    var rl = cl.orderStat(coord, cl.r);
    var w1 = cl.orderStat(coord, 1);
    var wAll = cl.orderStat(coord, cl.n);

    var cards = E('div', 'cap-cards');
    cards.appendChild(card('Write latency from ' + IDS[coord],
      wl === null ? 'unreachable' : ms(wl),
      wl === null
        ? 'Fewer than W = ' + cl.w + ' replicas are reachable from here, so the ' +
          'write has nothing to wait for.'
        : 'The ' + ordinal(cl.w) + ' acknowledgement to arrive, which is the ' +
          ordinal(cl.w) + ' smallest round trip out of ' + IDS[coord] + '.'));
    cards.appendChild(card('Read latency from ' + IDS[coord],
      rl === null ? 'unreachable' : ms(rl),
      rl === null ? 'Fewer than R = ' + cl.r + ' replicas are reachable from here.'
                  : 'The ' + ordinal(cl.r) + ' smallest round trip, same arithmetic.'));
    cards.appendChild(card('PACELC here',
      (cl.mode === 'cp' ? 'PC' : 'PA') + '/' + (ec ? 'EC' : 'EL'),
      'If Partitioned, ' + (cl.mode === 'cp'
        ? 'this configuration refuses rather than diverges'
        : 'this configuration answers rather than refuses') +
      '; Else it trades for ' + (ec
        ? 'Consistency, because R + W > N makes both sides wait for a quorum'
        : 'Latency, because R + W is not greater than N and neither side waits for one') + '.'));
    cards.appendChild(card('What consistency costs here',
      (wl === null || w1 === null) ? 'n/a' : ms(Math.max(0, wl - w1)),
      'The difference between this W and W = 1 on the same links, with no ' +
      'partition anywhere. That gap is the else half of PACELC, and it is paid on ' +
      'every single write, forever, not only during an incident.',
      (wl !== null && w1 !== null && wl - w1 > 0) ? 'cap-card-bad' : 'cap-card-good'));
    main.appendChild(cards);

    var maxL = Math.max(1, wAll === null ? cl.far : wAll);
    var wbars = E('div', 'cap-bars');
    for (var k = 1; k <= cl.n; k++) {
      var v = cl.orderStat(coord, k);
      /* The row name carries "the one you have set" in words. The amber fill
         used to be the only marker, and the caption underneath claimed the
         current bar was "the wider one" — which it is not: the width is the
         latency, so W = 3, 4 and 5 all draw at 100% here and the reader was
         being pointed at a difference that does not exist. */
      var name = 'W = ' + k + (k === cl.w ? ' — the one you have set' : '');
      if (v === null) {
        var dead = E('div', 'cap-bar-row');
        dead.appendChild(E('span', 'cap-bar-name', name));
        dead.appendChild(E('span', 'cap-bar-dead',
          'not reachable from ' + IDS[coord] + ' — the write would never complete'));
        wbars.appendChild(dead);
      } else {
        wbars.appendChild(barRow(name, v, maxL, 'ms', k === cl.w ? 'slow' : 'fast'));
      }
    }
    main.appendChild(E('p', 'cap-h', 'Write latency from ' + IDS[coord] + ' at every W'));
    main.appendChild(wbars);
    main.appendChild(E('p', 'cap-sub',
      'The row for W = ' + cl.w + ' is named as the one you have set, and drawn in ' +
      'amber; the widths are the latencies themselves, so two settings that cost the ' +
      'same are drawn the same. The first W that has to wait on a cross-site link is ' +
      'W = ' +
      (function () {
        var reach = cl.reachable(coord);
        for (var i = 0; i < reach.length; i++) {
          if (cl.rtt(coord, reach[i]) === cl.far) return i + 1;
        }
        return '(none, from here)';
      })() + ' at ' + IDS[coord] + '. Nothing about that is a partition — it is ' +
      'geography, and it is only a step upward for as long as you leave the ' +
      'cross-site figure above the same-site one.'));

    var rows = [];
    for (var i = 0; i < cl.n; i++) {
      var a = cl.orderStat(i, cl.w);
      var b = cl.orderStat(i, cl.r);
      rows.push({
        cls: i === coord ? 'cap-row-now' : '',
        cells: [IDS[i], SITE_NAME[SITE[i]],
                a === null ? 'no quorum' : ms(a),
                b === null ? 'no quorum' : ms(b),
                a === null || b === null ? '—' : ms(a + b)]
      });
    }
    main.appendChild(E('p', 'cap-h', 'Every coordinator, at the current R and W'));
    main.appendChild(table(['Coordinator', 'Site', 'Write wait', 'Read wait',
                            'Write then read'], rows));

    main.appendChild(note(
      'PACELC is the correction CAP needed. CAP describes a partition and stops ' +
      'there, which leaves the entire uneventful life of the system undescribed. ' +
      'PACELC adds the else: with no partition at all, a replicated store still has ' +
      'to choose between waiting for more replicas and replying sooner. That choice ' +
      'is made on every request. The partition case is made a few times a year.',
      'cap-goodnote'));

    main.appendChild(E('p', 'cap-h', 'Systems, by the classification the literature usually gives'));
    main.appendChild(table(['System', 'Usually classified', 'Why, and the hedge'], [
      ['etcd, ZooKeeper, Consul', 'PC/EC',
       'Majority-quorum consensus: the minority side of a partition refuses writes ' +
       'by construction, and a write waits for a majority even when nothing is wrong.'],
      ['Dynamo-style stores, Cassandra at its usual defaults', 'PA/EL',
       'Tuneable quorums with sloppy quorums and hinted handoff. Hedge it hard: R ' +
       'and W are per-request in Cassandra, so one query against a cluster can be ' +
       'PA/EL and the next can be PC/EC. The label describes a default.'],
      ['Spanner', 'PC/EC',
       'A CP system whose own authors argue its availability is high enough that ' +
       'users treat it as always up. Keep that in mind before reading CP as down.'],
      ['A single PostgreSQL server', 'not applicable',
       'One node cannot be partitioned from itself. It can only be down. CAP is ' +
       'about replicas disagreeing, and there are none.']
    ]));
    main.appendChild(E('p', 'cap-sub',
      'Nothing on this page measured any of those systems. Those are the ' +
      'classifications commonly given in the literature, they move between major ' +
      'versions, and several of them are configuration rather than architecture. ' +
      'Treat a PACELC label as a starting question, not an answer.'));
  };

  /* ======================================================================== */
  /*  PANEL 5 — THE FINE PRINT                                                */
  /* ======================================================================== */

  function FinePanel(app) {
    this.app = app;
    this.label = 'The fine print';
  }

  FinePanel.prototype.controls = function (side) {
    var g = group('Why this tab exists');
    g.appendChild(E('p', 'cap-hint',
      'Nearly everything people believe about CAP comes from the three-circle ' +
      'diagram rather than from the theorem. The diagram is not a simplification ' +
      'of the theorem; it says something the theorem does not say. This tab is the ' +
      'list of corrections, and it applies to the sandbox above as much as to any ' +
      'real database.'));
    side.appendChild(g);
  };

  FinePanel.prototype.render = function (main) {
    var cl = this.app.cluster;
    var items = [
      ['Pick two of three is a slogan, not the theorem',
       'You do not choose partition tolerance. A network that never loses or ' +
       'delays a message is not on sale. So P is not a column you can drop, and ' +
       'the real choice is between C and A, and only while a partition is actually ' +
       'happening. A CA distributed system is not a design, it is a system that ' +
       'has not decided what to do when the network breaks.'],
      ['It describes a partition and nothing else',
       'CAP is silent about the ordinary day. It says nothing about latency, ' +
       'throughput, durability, uptime or how the system behaves when the network ' +
       'is fine, which is nearly always. That silence is exactly the hole PACELC ' +
       'fills, and it is why the PACELC tab above matters more to most systems ' +
       'than this one does.'],
      ['CP does not mean unavailable',
       'A CP system refuses one operation, on one key, in one component, for the ' +
       'duration of one partition. It is up the entire time. Spanner is CP and its ' +
       'authors argue that in practice users treat it as always available, because ' +
       'the partitions that would stop it are rarer than the other things that stop ' +
       'everything else.'],
      ['AP does not mean inconsistent',
       'An AP system with no partition and no concurrent write returns exactly what ' +
       'a CP one does. AP is a statement about what happens when it cannot reach a ' +
       'quorum, not a promise that the data is wrong the rest of the time. Try it ' +
       'above: with every link up, the two modes are indistinguishable.'],
      ['The C is linearizability, not the C in ACID',
       'Gilbert and Lynch formalise C as atomic, or linearizable, consistency: ' +
       'there is a single total order of operations consistent with real time, and ' +
       'a read returns the value of the last write in that order. The C in ACID is ' +
       'about invariants inside a transaction and is a different word that happens ' +
       'to be spelled the same.'],
      ['The A is stronger than uptime',
       'Availability in the theorem means every request to every non-failing node ' +
       'terminates with a non-error response. That is a total requirement, not a ' +
       'percentage. Almost nothing in production is A in that sense, and "highly ' +
       'available" is a useful, weaker, entirely different claim.'],
      ['The conditions of the proof',
       'The 2002 result of Gilbert and Lynch, which formalised the conjecture ' +
       'Brewer put in a talk in 2000, assumes an asynchronous network model: no ' +
       'clocks, no bound on message delay, and no way for a node to tell a lost ' +
       'message from a slow one. That indistinguishability is the engine of the ' +
       'proof. The same paper treats the partially synchronous case separately, ' +
       'where nodes do have clocks, and the result there is weaker rather than ' +
       'absent.'],
      ['Eventual consistency is a spectrum, not a synonym for AP',
       'Between "the replicas agree eventually" and linearizable there is a ladder ' +
       'of real, nameable guarantees: read your writes, monotonic reads, monotonic ' +
       'writes, writes follow reads, causal consistency, bounded staleness. Plain ' +
       'eventual consistency promises only that the replicas converge if the writes ' +
       'stop, and puts no bound on when. Most systems described as eventually ' +
       'consistent offer more than that, and it is worth finding out exactly how ' +
       'much more before relying on it.']
    ];
    items.forEach(function (it) {
      var box = E('div', 'cap-card');
      box.appendChild(E('p', 'cap-card-h', it[0]));
      box.appendChild(E('p', 'cap-prose', it[1]));
      main.appendChild(box);
    });

    main.appendChild(E('p', 'cap-h', 'Where this sandbox is easier than the real thing'));
    main.appendChild(note(
      'A link here is up or cut. Real partitions are asymmetric, intermittent, and ' +
      'frequently a slow link rather than a dead one — which is the case that ' +
      'defeats a failure detector, because the timeout that is too short kills a ' +
      'healthy node and the timeout that is too long is an outage. Nothing here is ' +
      'ambiguous. There is also no node crash separate from a partition, no leader ' +
      'election, no log replication, no hinted handoff, no read repair, no client ' +
      'sessions and no clock uncertainty interval. CP in this sandbox is a count of ' +
      'reachable replicas, not a consensus protocol; Raft does considerably more ' +
      'than that, and the difference is most of the difficulty. Finally, the ' +
      'sandbox knows the true order of every write because it is one page with one ' +
      'counter. No real cluster has that oracle, which is the whole reason ' +
      'last-write-wins is a gamble.', 'cap-warnnote'));

    main.appendChild(note(
      'Right now: ' + cl.n + ' replicas, R = ' + cl.r + ', W = ' + cl.w + ', ' +
      (cl.r + cl.w > cl.n ? 'R + W > N so read and write sets must overlap'
                          : 'R + W is not greater than N so they need not overlap') +
      ', ' + (cl.mode === 'cp' ? 'CP' : 'AP') + ' during a partition, and the ' +
      'cluster is currently in ' + cl.components().groups.length + ' ' +
      plural(cl.components().groups.length, 'component', 'components') + '. ' +
      'Every one of those numbers came from the state above, and every claim on ' +
      'this tab is about the theorem rather than about this page.', 'cap-goodnote'));
  };

  /* ======================================================================== */
  /*  THE SHELL                                                               */
  /* ======================================================================== */

  function App(rootEl) {
    this.root = rootEl;
    this.cluster = new Cluster();
    this.graph = new Graph(this);
    this.panels = [
      new PartitionPanel(this),
      new WritePanel(this),
      new QuorumPanel(this),
      new PacelcPanel(this),
      new FinePanel(this)
    ];
    this.active = 0;
    this.build();
    this.select(0);
  }

  App.prototype.toggleLink = function (index) {
    var cl = this.cluster;
    cl.cut[index] = !cl.cut[index];
    var link = LINKS[index];
    var cs = cl.components();
    cl.say((cl.cut[index] ? 'Cut ' : 'Restored ') + IDS[link.a] + ' to ' + IDS[link.b] +
           '. The cluster is now in ' + cs.groups.length + ' ' +
           plural(cs.groups.length, 'component', 'components') + ': ' +
           cs.groups.map(function (g) {
             return g.map(function (m) { return IDS[m]; }).join(' ');
           }).join(' | ') + '.', 'info');
    this.redraw();
  };

  App.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'cap-wrap');

    var top = E('div', 'cap-top');
    var loud = E('p', 'cap-loud');
    loud.appendChild(E('b', null, 'Read this before you touch anything. '));
    loud.appendChild(document.createTextNode(
      'CAP describes what a replica does DURING a partition and says nothing about ' +
      'the rest of the time. CP does not mean unavailable and AP does not mean ' +
      'inconsistent. Pick two of three is a slogan: you do not choose partition ' +
      'tolerance on a real network, so the only choice is C or A, and only while ' +
      'the network is broken.'));
    top.appendChild(loud);

    var graphWrap = E('div', 'cap-graphwrap');
    graphWrap.appendChild(this.graph.svg);
    top.appendChild(graphWrap);
    top.appendChild(E('p', 'cap-legend',
      'Thick line: a link inside one site. Thin line: a link between sites, and a ' +
      'slower one. A cut link is drawn with a gap and a cross, and is also listed ' +
      'in words under the Partition tab. The label above each node names its ' +
      'component and its site; the text under it is the value that replica holds ' +
      'and whether that value is current, stale, or two concurrent siblings.'));
    this.statusEl = E('p', 'cap-status', this.cluster.status);
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    top.appendChild(this.statusEl);
    wrap.appendChild(top);

    var tabs = E('div', 'cap-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'CAP sandbox topics');
    this.tabs = this.panels.map(function (panel, i) {
      var b = E('button', 'cap-tab', panel.label);
      b.type = 'button';
      b.id = 'cap-tab-' + i;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-controls', 'cap-panel-' + i);
      b.tabIndex = -1;
      b.addEventListener('click', function () { self.select(i); });
      b.addEventListener('keydown', function (e) {
        var d = 0;
        if (e.key === 'ArrowRight') d = 1;
        else if (e.key === 'ArrowLeft') d = -1;
        else if (e.key === 'Home') { e.preventDefault(); self.select(0); self.tabs[0].focus(); return; }
        else if (e.key === 'End') {
          e.preventDefault();
          var last = self.tabs.length - 1;
          self.select(last);
          self.tabs[last].focus();
          return;
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

    var body = E('div', 'cap-body');
    this.side = E('div', 'cap-side');
    this.main = E('div', 'cap-main');
    this.main.setAttribute('role', 'tabpanel');
    this.main.tabIndex = 0;
    body.appendChild(this.side);
    body.appendChild(this.main);
    wrap.appendChild(body);

    this.root.appendChild(wrap);
  };

  App.prototype.select = function (i) {
    this.active = i;
    for (var k = 0; k < this.tabs.length; k++) {
      var on = k === i;
      this.tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
      this.tabs[k].tabIndex = on ? 0 : -1;
    }
    this.main.id = 'cap-panel-' + i;
    this.main.setAttribute('aria-labelledby', 'cap-tab-' + i);
    this.rebuild();
  };

  /* The control column is built once per tab; the readout is rebuilt on every
     change. Splitting the two is not tidiness — the first version rebuilt both,
     which tore the range input out of the DOM on the first input event of a
     drag, so every slider moved exactly one step per grab. Controls that carry
     state now update themselves through sync(). */
  App.prototype.rebuild = function () {
    var panel = this.panels[this.active];
    clear(this.side);
    panel.controls(this.side);
    this.redraw();
  };

  App.prototype.redraw = function () {
    var panel = this.panels[this.active];
    this.graph.render();
    this.statusEl.textContent = this.cluster.status;
    if (panel.sync) panel.sync();
    clear(this.main);
    panel.render(this.main);
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('captheorem');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-cap-mount') || rootEl;
    clear(mount);
    try {
      var app = new App(mount);
      if (app && window.KSLab && window.KSLab.used) window.KSLab.used('run');
    } catch (err) {
      clear(mount);
      mount.appendChild(E('p', 'lab-viz-error',
        'This lab could not start in your browser: ' + ((err && err.message) || String(err)) +
        ' — the write-up below still explains what it would have shown. ' +
        'Please tell me, and mention which browser you are using.'));
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'captheorem', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

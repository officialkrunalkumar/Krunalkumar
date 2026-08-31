/* ==========================================================================
   concurrency.js — one shared counter, solved four ways, with the visitor
   holding the scheduler.
   --------------------------------------------------------------------------
   Every explanation of a race condition I have read asks you to imagine an
   unlucky interleaving. Imagining it is exactly the part people cannot do,
   which is why the bug survives code review and then shows up once a fortnight
   in production. So here nothing is imagined: there is a tiny virtual machine,
   the threads are programs of single instructions, and the visitor decides
   which thread executes next. Clicking the wrong two buttons in the wrong order
   destroys an increment, and the transcript says which write ate which.

   The same three-instruction critical section is then run under a mutex, under
   a counting semaphore, and under a message queue with a single owner. The
   semaphore is in here for one reason: a semaphore with a count above one over
   a shared counter still loses updates, and calling it "a lock" is a mistake I
   have watched cost a week. The lock panel is here to make a subtler point —
   the lock does not stop the threads interleaving, it deletes the interleavings
   in which the interleaving matters, and the enumeration table puts a number on
   how many that is.

   Then two locks and two threads, taken in opposite orders, so the visitor can
   walk into a deadlock deliberately and watch the wait-for graph close its
   cycle. The cycle is found by a real depth-first search over the edges the
   machine is actually in, not drawn from a script, so if you free a lock the
   cycle disappears because it is genuinely gone.

   WHERE THIS MODEL IS SIMPLER THAN A COMPUTER, said out loud because the whole
   lab is worthless if you go away with the wrong mental picture:

     - JavaScript is single-threaded. There are no threads on this page. There
       is one array of program counters and a switch statement. Nothing here is
       concurrent; it is a model of concurrency that you drive by hand.
     - The model is sequentially consistent. Every step is atomic and every
       write is instantly visible to every thread. A real machine gives you
       neither: stores get reordered, a value can sit in a store buffer or a
       core's cache and stay invisible to another core for a while, and a
       compiler will happily hoist your load out of the loop. All of that makes
       real concurrency worse than this. The honest and more alarming point is
       that a sequentially consistent model — the friendliest memory model
       there is — already loses the update.
     - Locks here are FIFO-fair in the interactive panels: the thread at the
       head of the wait queue gets the lock. A real pthread mutex or Java
       monitor makes no such promise and permits barging, which can starve a
       waiter indefinitely. The enumerator drops the queue and lets any waiter
       take a free lock, which is the more permissive model and gives more
       schedules, not fewer.
     - The message queue is assumed to be an atomic channel. That assumption is
       the thing you are buying when you use a real one; inside, it is built out
       of the primitives in the other panels.
     - Steps have no duration. There is no preemption timer, no priority, no
       cache, no scheduler quantum. Every schedule the enumerator counts is
       legal, and the table says nothing about which are likely.

   No network, no eval, no dependencies. Arithmetic, DOM and one small SVG.
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
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa', pink: '#f0abfc'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";
  var SVGNS = 'http://www.w3.org/2000/svg';
  var THREAD_INK = [C.cyan, C.amber, C.violet, C.pink, C.green];

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
  /* String.prototype.repeat and padEnd are ES6-era; this file is ES5. */
  function rep(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }
  function padRight(text, width) {
    var s = String(text);
    return s.length >= width ? s : s + rep(' ', width - s.length);
  }
  /* Rounding must never turn "nearly all" into "all" or "a few" into "none".
     918 of 924 is 99.4%, but 369,576 of 369,600 rounds to 100% at one decimal
     place and reads as a claim that every schedule is wrong, which is false and
     is exactly the kind of overstatement this lab is arguing against. */
  function pctText(a, b) {
    if (!b) return '0%';
    if (a === 0) return '0%';
    if (a === b) return '100%';
    var v = 100 * a / b;
    if (v < 0.1) return 'under 0.1%';
    if (v > 99.9) return 'over 99.9%';
    return (Math.round(v * 10) / 10) + '%';
  }
  function plural(n, one, many) { return n === 1 ? one : many; }

  /* Every panel is rebuilt from scratch after each step, which throws away the
     focused element - so a keyboard visitor stepping T1 six times would land
     back at the top of the document six times. Controls carry a stable focus
     key and App.redraw puts focus back on the one that had it. */
  function fk(el, key) {
    if (key) el.setAttribute('data-fk', key);
    return el;
  }

  function button(text, onClick, cls, key) {
    var el = E('button', 'cx-btn' + (cls ? ' ' + cls : ''), text);
    el.type = 'button';
    el.addEventListener('click', onClick);
    return fk(el, key);
  }
  function selectBox(label, options, value, onChange, key) {
    var wrap = E('label', 'cx-field');
    wrap.appendChild(E('span', 'cx-field-label', label));
    var el = E('select', 'cx-select');
    options.forEach(function (o) {
      var op = E('option', null, o.label);
      op.value = String(o.key);
      if (String(o.key) === String(value)) op.selected = true;
      el.appendChild(op);
    });
    el.addEventListener('change', function () { onChange(el.value); });
    fk(el, key);
    wrap.appendChild(el);
    return wrap;
  }
  function statCard(head, value, note, cls) {
    var box = E('div', 'cx-stat' + (cls ? ' ' + cls : ''));
    box.appendChild(E('p', 'cx-stat-h', head));
    box.appendChild(E('p', 'cx-stat-v', value));
    if (note) box.appendChild(E('p', 'cx-stat-note', note));
    return box;
  }
  function table(head, rows) {
    var t = E('table', 'cx-table');
    var thead = E('thead'), tr = E('tr');
    head.forEach(function (h) { tr.appendChild(E('th', null, h)); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = E('tbody');
    rows.forEach(function (r) {
      var row = E('tr');
      if (r.cls) row.className = r.cls;
      (r.cells || r).forEach(function (cell) {
        var td = E('td', 'cx-td');
        td.textContent = cell == null ? '' : String(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    var scroll = E('div', 'cx-scroll');
    scroll.appendChild(t);
    return scroll;
  }
  function note(text, cls) {
    var p = E('p', 'cx-note' + (cls ? ' ' + cls : ''), text);
    return p;
  }

  /* ======================================================================== */
  /*  THE INSTRUCTION SET                                                     */
  /* ------------------------------------------------------------------------ */
  /*  Twelve opcodes, each one step. The split of the increment into READ,     */
  /*  ADD, WRITE is the entire lab: on a real machine counter++ is a load,   */
  /*  an add and a store, and every language that pretends otherwise is        */
  /*  hiding three instructions behind one plus sign.                          */
  /* ======================================================================== */

  var OP = {
    READ: 0, ADD: 1, WRITE: 2,
    LOCKA: 3, UNLOCKA: 4, LOCKB: 5, UNLOCKB: 6,
    ACQ: 7, REL: 8, SEND: 9, RECV: 10, APPLY: 11
  };
  var OP_TEXT = [
    'READ     r <- counter',
    'ADD      r <- r + 1',
    'WRITE    counter <- r',
    'LOCK     A',
    'UNLOCK   A',
    'LOCK     B',
    'UNLOCK   B',
    'ACQUIRE  a permit',
    'RELEASE  the permit',
    'SEND     +1 to the owner',
    'RECV     m <- next message',
    'APPLY    counter <- counter + m'
  ];
  var OP_SHORT = ['READ', 'ADD', 'WRITE', 'LOCK A', 'UNLOCK A', 'LOCK B',
                  'UNLOCK B', 'ACQUIRE', 'RELEASE', 'SEND', 'RECV', 'APPLY'];

  /* Which lock an opcode touches, or null. Keeps the lock handling in the
     machine and in the enumerator reading off the same table. */
  function lockKey(op) {
    if (op === OP.LOCKA || op === OP.UNLOCKA) return 'A';
    if (op === OP.LOCKB || op === OP.UNLOCKB) return 'B';
    return null;
  }

  /* Scheduling priority for the "worst interleaving" driver. Lower runs first,
     so every thread is pushed to READ before any thread is allowed to WRITE.
     That is a legal schedule and it is the one that destroys the most work. */
  var PRIORITY = [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  /* ------------------------------------------------------------------------ */
  /*  Programs. One source of truth, shared by the interactive machine and by  */
  /*  the enumerator, so the table below can never describe a different        */
  /*  program from the one on screen.                                          */
  /* ------------------------------------------------------------------------ */

  function repeatBody(body, times) {
    var out = [];
    for (var i = 0; i < times; i++) {
      for (var j = 0; j < body.length; j++) out.push(body[j]);
    }
    return out;
  }

  function programsFor(mode, threads, incs, permits) {
    var progs = [], names = [], i;
    var total = threads * incs;
    if (mode === 'msg') {
      for (i = 0; i < threads; i++) {
        progs.push(repeatBody([OP.SEND], incs));
        names.push('T' + (i + 1));
      }
      progs.push(repeatBody([OP.RECV, OP.APPLY], total));
      names.push('Owner');
      return { progs: progs, names: names, expected: total, permits: 0, mode: mode };
    }
    var body;
    if (mode === 'mutex') body = [OP.LOCKA, OP.READ, OP.ADD, OP.WRITE, OP.UNLOCKA];
    else if (mode === 'sem') body = [OP.ACQ, OP.READ, OP.ADD, OP.WRITE, OP.REL];
    else body = [OP.READ, OP.ADD, OP.WRITE];
    for (i = 0; i < threads; i++) {
      progs.push(repeatBody(body, incs));
      names.push('T' + (i + 1));
    }
    return {
      progs: progs, names: names, expected: total,
      permits: mode === 'sem' ? permits : 0, mode: mode
    };
  }

  /* The deadlock programs: same critical section, both locks held across it,
     taken in the order given. The ordered flag makes the second thread agree with the
     first, which is the whole fix. */
  function deadlockPrograms(ordered) {
    function body(first) {
      var second = first === 'A' ? 'B' : 'A';
      return [
        first === 'A' ? OP.LOCKA : OP.LOCKB,
        second === 'A' ? OP.LOCKA : OP.LOCKB,
        OP.READ, OP.ADD, OP.WRITE,
        second === 'A' ? OP.UNLOCKA : OP.UNLOCKB,
        first === 'A' ? OP.UNLOCKA : OP.UNLOCKB
      ];
    }
    return {
      progs: [body('A'), body(ordered ? 'A' : 'B')],
      names: ['T1', 'T2'],
      expected: 2, permits: 0, mode: 'deadlock'
    };
  }

  /* ======================================================================== */
  /*  THE INTERACTIVE MACHINE                                                 */
  /* ------------------------------------------------------------------------ */
  /*  Rich state: wait queues, a message queue, a transcript, and a running    */
  /*  count of destroyed increments. Slower than the enumerator and far more   */
  /*  legible, which is the right trade for something a person steps by hand.  */
  /* ======================================================================== */

  function Machine(spec) {
    this.spec = spec;
    this.reset();
  }

  Machine.prototype.reset = function () {
    var spec = this.spec, i;
    this.progs = spec.progs;
    this.names = spec.names;
    this.expected = spec.expected;
    this.mode = spec.mode;
    this.n = spec.progs.length;
    this.mem = 0;
    this.pc = [];
    this.reg = [];
    this.msg = [];
    for (i = 0; i < this.n; i++) { this.pc.push(0); this.reg.push(0); this.msg.push(0); }
    this.lockOwner = { A: null, B: null };
    this.lockWait = { A: [], B: [] };
    this.maxPermits = spec.permits || 0;
    this.permits = spec.permits || 0;
    this.holders = [];
    this.semWait = [];
    this.queue = [];
    this.log = [];
    this.applied = 0;       /* increments the program actually executed */
    this.discarded = 0;     /* gross: increments stale writes threw away */
    this.stale = 0;         /* how many writes were stale */
    this.steps = 0;
    this.switches = 0;
    this.lastT = -1;
    this.lastLoss = null;
    this.owner = this.mode === 'msg' ? this.n - 1 : -1;
  };

  /* null when the thread can run, otherwise why it cannot. Blocking is a
     property of the state, not of having tried: a thread whose next
     instruction is LOCK A while another holds A cannot make progress whether
     or not the visitor has clicked it yet. */
  Machine.prototype.blocked = function (t) {
    if (this.pc[t] >= this.progs[t].length) return 'finished';
    var op = this.progs[t][this.pc[t]];
    var key = lockKey(op);
    if (op === OP.LOCKA || op === OP.LOCKB) {
      var holder = this.lockOwner[key];
      if (holder != null && holder !== t) {
        return 'waiting for lock ' + key + ', held by ' + this.names[holder];
      }
      var q = this.lockWait[key];
      if (q.length && q[0] !== t) {
        return 'waiting for lock ' + key + ', behind ' + this.names[q[0]] + ' in the queue';
      }
      return null;
    }
    if (op === OP.ACQ) {
      /* "all 1 are taken" is what this said, and the permits selector labels 1
         as "this is a mutex", so it is the first thing anyone following the FAQ
         reads. A count needs a singular branch the moment the count can be one. */
      if (this.permits <= 0) {
        return this.maxPermits === 1
          ? 'waiting for the only permit, which is taken'
          : 'waiting for a permit, all ' + this.maxPermits + ' are taken';
      }
      if (this.semWait.length && this.semWait[0] !== t) {
        return 'waiting for a permit, behind ' + this.names[this.semWait[0]] + ' in the queue';
      }
      return null;
    }
    if (op === OP.RECV) {
      if (!this.queue.length) return 'waiting for a message, the queue is empty';
      return null;
    }
    return null;
  };

  Machine.prototype.runnable = function (t) {
    return this.blocked(t) === null;
  };

  Machine.prototype.anyRunnable = function () {
    for (var t = 0; t < this.n; t++) if (this.runnable(t)) return true;
    return false;
  };

  Machine.prototype.allDone = function () {
    for (var t = 0; t < this.n; t++) if (this.pc[t] < this.progs[t].length) return false;
    return true;
  };

  Machine.prototype.deadlocked = function () {
    return !this.anyRunnable() && !this.allDone();
  };

  Machine.prototype.say = function (t, text, cls) {
    this.log.push({ t: t, text: text, cls: cls || '' });
  };

  /* Execute one instruction of thread t. A click on a blocked thread is not
     ignored — it is recorded as an attempted acquire, which is what puts the
     thread in the wait queue and what a real blocking call does. */
  Machine.prototype.step = function (t) {
    var prog = this.progs[t];
    if (this.pc[t] >= prog.length) {
      this.say(t, this.names[t] + '  has already finished its program.', 'cx-l-dim');
      return false;
    }
    var op = prog[this.pc[t]];
    var name = this.names[t];
    var why = this.blocked(t);
    if (why) {
      var key = lockKey(op);
      if (key) {
        var q = this.lockWait[key];
        if (q.indexOf(t) < 0) {
          q.push(t);
          this.say(t, name + '  LOCK ' + key + '  blocked — ' + why +
            '. Joined the wait queue at position ' + q.length + '.', 'cx-l-warn');
        } else {
          this.say(t, name + '  LOCK ' + key + '  tried again, still blocked — ' +
            why + '.', 'cx-l-dim');
        }
      } else if (op === OP.ACQ) {
        if (this.semWait.indexOf(t) < 0) {
          this.semWait.push(t);
          this.say(t, name + '  ACQUIRE  blocked — ' + why +
            '. Joined the wait queue at position ' + this.semWait.length + '.', 'cx-l-warn');
        } else {
          this.say(t, name + '  ACQUIRE  tried again, still blocked.', 'cx-l-dim');
        }
      } else {
        this.say(t, name + '  ' + OP_SHORT[op] + '  blocked — ' + why + '.', 'cx-l-warn');
      }
      return false;
    }

    this.steps++;
    if (this.lastT !== -1 && this.lastT !== t) this.switches++;
    this.lastT = t;

    switch (op) {
      case OP.READ:
        this.reg[t] = this.mem;
        this.say(t, name + '  READ     r = ' + this.reg[t] + '  <- counter (' + this.mem + ')');
        break;
      case OP.ADD:
        this.reg[t] = this.reg[t] + 1;
        this.say(t, name + '  ADD      r = ' + this.reg[t] + '  (in a register, nobody else can see this)');
        break;
      case OP.WRITE:
        this.doWrite(t);
        break;
      case OP.LOCKA:
      case OP.LOCKB:
        this.doLock(t, lockKey(op));
        break;
      case OP.UNLOCKA:
      case OP.UNLOCKB:
        this.doUnlock(t, lockKey(op));
        break;
      case OP.ACQ:
        this.doAcquire(t);
        break;
      case OP.REL:
        this.doRelease(t);
        break;
      case OP.SEND:
        this.queue.push(1);
        this.say(t, name + '  SEND     +1 to the owner. Queue depth ' + this.queue.length +
          '. This thread never touches the counter.');
        break;
      case OP.RECV:
        this.msg[t] = this.queue.shift();
        this.say(t, name + '  RECV     m = +' + this.msg[t] + '. Queue depth ' + this.queue.length + '.');
        break;
      case OP.APPLY:
        this.mem = this.mem + this.msg[t];
        this.applied++;
        this.say(t, name + '  APPLY    counter = ' + this.mem +
          '. One writer, so there is nothing to interleave with.', 'cx-l-ok');
        this.msg[t] = 0;
        break;
      default:
        break;
    }
    this.pc[t]++;
    if (this.pc[t] >= prog.length) {
      this.say(t, name + '  finished.', 'cx-l-dim');
    }
    return true;
  };

  /* The whole lab lives in these ten lines. The thread read a value, added one
     to it in a register nobody else can see, and is now storing the result. If
     the counter has moved since the read, that movement is being thrown away,
     and the number of increments discarded is exactly the distance it moved. */
  Machine.prototype.doWrite = function (t) {
    var before = this.mem;
    var readValue = this.reg[t] - 1;
    var discarded = before - readValue;
    this.mem = this.reg[t];
    this.applied++;
    if (discarded > 0) {
      this.discarded += discarded;
      this.stale++;
      this.lastLoss = {
        t: t, read: readValue, before: before, wrote: this.reg[t], discarded: discarded
      };
      this.say(t, this.names[t] + '  WRITE    counter = ' + this.mem + '  (it was ' + before +
        ')  LOST UPDATE: this thread read ' + readValue + ' a while ago, so storing ' +
        this.reg[t] + ' throws away ' + discarded + ' ' +
        plural(discarded, 'increment', 'increments') + '.', 'cx-l-bad');
    } else {
      this.say(t, this.names[t] + '  WRITE    counter = ' + this.mem + '  (it was ' + before + ')');
    }
  };

  /* How many increments are missing from the counter right now.
     This started life as a running total: every stale write added the number
     of increments it had just overwritten. That total was wrong, and a random
     three-increment run found it. A write stores read + 1, and if the counter
     has since gone BACKWARDS (a stale write knocked it down), then a
     thread holding a higher stale read pushes it back UP by more than one, and
     some of the increments the running total had already written off reappear.
     applied minus mem is the whole truth and cannot drift: mem can never
     exceed the number of increments executed, so this is never negative.
     The gross figure is kept separately, because "four writes overwrote newer
     values but the counter is only two short" is itself worth seeing. */
  Machine.prototype.lostCount = function () {
    return this.applied - this.mem;
  };

  Machine.prototype.doLock = function (t, key) {
    var q = this.lockWait[key];
    if (q.length && q[0] === t) q.shift();
    this.lockOwner[key] = t;
    this.say(t, this.names[t] + '  LOCK ' + key + '   acquired. Nobody else can enter the ' +
      'critical section now.', 'cx-l-ok');
  };

  Machine.prototype.doUnlock = function (t, key) {
    this.lockOwner[key] = null;
    var q = this.lockWait[key];
    var tail = q.length ? ' Next in the queue: ' + this.names[q[0]] + '.' : ' The queue is empty.';
    this.say(t, this.names[t] + '  UNLOCK ' + key + ' released.' + tail, 'cx-l-ok');
  };

  Machine.prototype.doAcquire = function (t) {
    if (this.semWait.length && this.semWait[0] === t) this.semWait.shift();
    this.permits--;
    this.holders.push(t);
    this.say(t, this.names[t] + '  ACQUIRE  permit taken. ' + this.permits + ' of ' +
      this.maxPermits + ' left, ' + this.holders.length + ' ' +
      plural(this.holders.length, 'thread is', 'threads are') + ' inside.',
      this.holders.length > 1 ? 'cx-l-warn' : 'cx-l-ok');
  };

  Machine.prototype.doRelease = function (t) {
    var at = this.holders.indexOf(t);
    if (at >= 0) this.holders.splice(at, 1);
    this.permits++;
    this.say(t, this.names[t] + '  RELEASE  permit returned. ' + this.permits + ' of ' +
      this.maxPermits + ' free.', 'cx-l-ok');
  };

  /* Pick the next thread. 'random' is uniform over the runnable set; 'worst'
     sorts by the priority table, which drives every thread to READ before any
     thread is allowed to WRITE. Both return -1 when nothing can run. */
  Machine.prototype.pick = function (policy) {
    var candidates = [], t;
    for (t = 0; t < this.n; t++) if (this.runnable(t)) candidates.push(t);
    if (!candidates.length) return -1;
    if (policy === 'random') {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    var best = candidates[0];
    var bestP = PRIORITY[this.progs[best][this.pc[best]]];
    for (var i = 1; i < candidates.length; i++) {
      var c = candidates[i];
      var p = PRIORITY[this.progs[c][this.pc[c]]];
      if (p < bestP) { best = c; bestP = p; }
    }
    return best;
  };

  Machine.prototype.runToEnd = function (policy, cap) {
    var guard = cap || 4000;
    while (guard-- > 0) {
      var t = this.pick(policy);
      if (t < 0) break;
      this.step(t);
    }
  };

  /* Wait-for edges: thread -> the thread holding the lock it needs next. */
  Machine.prototype.waitForEdges = function () {
    var edges = [];
    for (var t = 0; t < this.n; t++) {
      if (this.pc[t] >= this.progs[t].length) continue;
      var op = this.progs[t][this.pc[t]];
      var key = lockKey(op);
      if (!key || (op !== OP.LOCKA && op !== OP.LOCKB)) continue;
      var holder = this.lockOwner[key];
      if (holder != null && holder !== t) edges.push({ from: t, to: holder, lock: key });
    }
    return edges;
  };

  /* A plain depth-first cycle search over those edges. Grey means "on the
     current path", so meeting a grey node closes a cycle and the slice of the
     path from that node is the cycle itself. */
  function findCycle(n, edges) {
    var adj = [], colour = [], i;
    for (i = 0; i < n; i++) { adj.push([]); colour.push(0); }
    edges.forEach(function (e) { adj[e.from].push(e.to); });
    var stack = [], found = null;

    function visit(u) {
      if (found) return;
      colour[u] = 1;
      stack.push(u);
      for (var k = 0; k < adj[u].length; k++) {
        var v = adj[u][k];
        if (found) return;
        if (colour[v] === 1) {
          var at = stack.indexOf(v);
          found = stack.slice(at);
          found.push(v);
          return;
        }
        if (colour[v] === 0) visit(v);
      }
      stack.pop();
      colour[u] = 2;
    }
    for (i = 0; i < n && !found; i++) if (colour[i] === 0) visit(i);
    return found;
  }

  /* ======================================================================== */
  /*  THE ENUMERATOR                                                          */
  /* ------------------------------------------------------------------------ */
  /*  Same instruction semantics, no transcript, no queues of waiters, no      */
  /*  allocation inside the search. Six scalars and two small arrays are the   */
  /*  entire state, and each step saves the scalars it is about to touch so    */
  /*  the walk back up the tree is an assignment rather than a clone. That is  */
  /*  what makes several hundred thousand leaves finish inside a click.        */
  /*                                                                          */
  /*  The cap exists because the schedule space is factorial. When it trips    */
  /*  the row says so rather than quietly reporting a smaller number, and the  */
  /*  multinomial upper bound is printed instead — an unenumerable number of   */
  /*  interleavings is itself the lesson.                                      */
  /* ======================================================================== */

  var LEAF_CAP = 600000;
  var NODE_CAP = 3000000;

  function enumerate(spec) {
    var progs = spec.progs;
    var n = progs.length;
    var expected = spec.expected;
    var startPermits = spec.permits || 0;

    var pc = [], reg = [], i;
    for (i = 0; i < n; i++) { pc.push(0); reg.push(0); }
    var mem = 0, ownerA = -1, ownerB = -1, permits = startPermits, qlen = 0;

    var totalSteps = 0;
    for (i = 0; i < n; i++) totalSteps += progs[i].length;
    var saves = [];
    for (i = 0; i <= totalSteps; i++) {
      saves.push({ mem: 0, reg: 0, a: -1, b: -1, p: 0, q: 0 });
    }

    var leaves = 0, nodes = 0, wrong = 0, deadlocks = 0, capped = false;
    var byValue = {};
    var began = Date.now();

    function runnable(t) {
      var p = progs[t];
      if (pc[t] >= p.length) return false;
      var op = p[pc[t]];
      if (op === OP.LOCKA) return ownerA < 0;
      if (op === OP.LOCKB) return ownerB < 0;
      if (op === OP.ACQ) return permits > 0;
      if (op === OP.RECV) return qlen > 0;
      return true;
    }

    function apply(t, depth) {
      var s = saves[depth];
      s.mem = mem; s.reg = reg[t]; s.a = ownerA; s.b = ownerB; s.p = permits; s.q = qlen;
      var op = progs[t][pc[t]];
      if (op === OP.READ) reg[t] = mem;
      else if (op === OP.ADD) reg[t] = reg[t] + 1;
      else if (op === OP.WRITE) mem = reg[t];
      else if (op === OP.LOCKA) ownerA = t;
      else if (op === OP.UNLOCKA) ownerA = -1;
      else if (op === OP.LOCKB) ownerB = t;
      else if (op === OP.UNLOCKB) ownerB = -1;
      else if (op === OP.ACQ) permits--;
      else if (op === OP.REL) permits++;
      else if (op === OP.SEND) qlen++;
      else if (op === OP.RECV) { qlen--; reg[t] = 1; }
      else if (op === OP.APPLY) mem = mem + reg[t];
      pc[t]++;
    }

    function undo(t, depth) {
      var s = saves[depth];
      pc[t]--;
      mem = s.mem; reg[t] = s.reg; ownerA = s.a; ownerB = s.b; permits = s.p; qlen = s.q;
    }

    function dfs(depth) {
      nodes++;
      if (nodes > NODE_CAP) { capped = true; return; }
      var any = false;
      for (var t = 0; t < n; t++) {
        if (!runnable(t)) continue;
        any = true;
        apply(t, depth);
        dfs(depth + 1);
        undo(t, depth);
        if (capped) return;
      }
      if (any) return;
      leaves++;
      if (leaves > LEAF_CAP) { capped = true; return; }
      var done = true;
      for (var j = 0; j < n; j++) {
        if (pc[j] < progs[j].length) { done = false; break; }
      }
      if (!done) { deadlocks++; return; }
      byValue[mem] = (byValue[mem] || 0) + 1;
      if (mem !== expected) wrong++;
    }

    dfs(0);

    return {
      schedules: leaves, wrong: wrong, deadlocks: deadlocks,
      byValue: byValue, capped: capped, ms: Date.now() - began,
      bound: multinomial(progs), expected: expected
    };
  }

  /* Upper bound on the number of schedules: the number of ways to interleave
     the per-thread instruction sequences if nothing ever blocked. Exact for
     the unsynchronised case and for a semaphore with as many permits as
     threads; a strict over-count everywhere else. Computed in floating point
     and reported as an approximation once it stops being exact. */
  function multinomial(progs) {
    var total = 0, i;
    for (i = 0; i < progs.length; i++) total += progs[i].length;
    var v = 1, placed = 0;
    for (i = 0; i < progs.length; i++) {
      var k = progs[i].length;
      /* C(total - placed, k), multiplied one factor at a time so the running
         value stays as small as it can. */
      var avail = total - placed;
      for (var j = 1; j <= k; j++) v = v * (avail - k + j) / j;
      placed += k;
      if (!isFinite(v)) return Infinity;
    }
    return v;
  }

  function boundText(v) {
    if (!isFinite(v)) return 'more than 10^308';
    if (v < 1e15) return num(Math.round(v));
    return 'about ' + v.toExponential(2).replace('e+', ' x 10^');
  }

  /* ======================================================================== */
  /*  SCOPED STYLES                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Injected rather than added to labs.css. Every selector here is           */
  /*  meaningless outside this lab, and keeping them next to the code that     */
  /*  builds the markup is the only way the two stay in step. The CSP allows   */
  /*  inline style and forbids inline script, which is why this is a <style>   */
  /*  node and nothing on this page is built from a string and executed.       */
  /*  Every rule is scoped under #concurrencyviz so the site stylesheet, the   */
  /*  light theme and sixty other lab pages are left alone.                    */
  /* ======================================================================== */

  var ROOT = '#concurrencyviz ';
  var CSS = [
    ROOT + '.cx-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    ROOT + '.cx-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,0.6);}',
    ROOT + '.cx-tab{font:inherit;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    ROOT + '.cx-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    ROOT + '.cx-tab[aria-selected="true"]{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    ROOT + '.cx-tab:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    ROOT + '.cx-panel{padding:12px;display:flex;flex-direction:column;gap:11px;min-width:0;}',
    ROOT + '.cx-panel:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:-2px;border-radius:8px;}',

    ROOT + '.cx-lede{margin:0;font-size:12.5px;line-height:1.75;color:#cbd5e1;}',
    ROOT + '.cx-lede b{color:' + C.ink + ';}',
    ROOT + '.cx-h{margin:2px 0 0;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',

    ROOT + '.cx-fieldrow{display:flex;flex-wrap:wrap;gap:12px;align-items:center;}',
    ROOT + '.cx-field{display:flex;align-items:center;gap:7px;}',
    ROOT + '.cx-field-label{color:' + C.dim + ';font-size:12px;}',
    ROOT + '.cx-select{font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:4px 7px;}',
    ROOT + '.cx-select:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:1px;}',

    ROOT + '.cx-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:6px 10px;cursor:pointer;}',
    ROOT + '.cx-btn:hover{background:#213152;border-color:#40608f;}',
    ROOT + '.cx-btn:focus-visible{outline:2px solid ' + C.blue + ';outline-offset:2px;}',
    ROOT + '.cx-btn[disabled]{opacity:.4;cursor:default;}',
    ROOT + '.cx-btn[disabled]:hover{background:#182339;border-color:#2c3d59;}',
    ROOT + '.cx-btn.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    ROOT + '.cx-btn.cx-danger{border-color:rgba(252,165,165,.55);color:#ffd9d9;}',
    ROOT + '.cx-btn.cx-danger:hover{background:rgba(252,165,165,.14);}',
    ROOT + '.cx-btnrow{display:flex;flex-wrap:wrap;gap:6px;}',

    ROOT + '.cx-state{display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));gap:9px;}',
    ROOT + '.cx-stat{padding:9px 11px;border:1px solid ' + C.line + ';border-radius:10px;background:rgba(15,23,42,.55);min-width:0;}',
    ROOT + '.cx-stat-h{margin:0 0 4px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:' + C.faint + ';}',
    ROOT + '.cx-stat-v{margin:0;font-size:20px;font-weight:700;line-height:1.2;color:' + C.cyan + ';overflow-wrap:anywhere;}',
    ROOT + '.cx-stat-note{margin:4px 0 0;font-size:11px;line-height:1.55;color:' + C.dim + ';}',
    ROOT + '.cx-stat.cx-bad{border-color:rgba(252,165,165,.55);background:rgba(252,165,165,.08);}',
    ROOT + '.cx-stat.cx-bad .cx-stat-v{color:' + C.red + ';}',
    ROOT + '.cx-stat.cx-good{border-color:rgba(52,211,153,.45);background:rgba(52,211,153,.06);}',
    ROOT + '.cx-stat.cx-good .cx-stat-v{color:' + C.green + ';}',
    ROOT + '.cx-stat.cx-warn .cx-stat-v{color:' + C.amber + ';}',

    ROOT + '.cx-banner{margin:0;padding:10px 12px;border-left:3px solid ' + C.red + ';background:rgba(252,165,165,.09);border-radius:0 9px 9px 0;font-size:12.5px;line-height:1.7;color:#ffe3e3;}',
    ROOT + '.cx-banner b{color:#fff;}',
    ROOT + '.cx-banner.cx-ok{border-left-color:' + C.green + ';background:rgba(52,211,153,.08);color:#d6f7ea;}',
    ROOT + '.cx-banner.cx-amber{border-left-color:' + C.amber + ';background:rgba(251,191,36,.09);color:#fdf0d0;}',

    ROOT + '.cx-threads{display:grid;grid-template-columns:repeat(auto-fit,minmax(13.5rem,1fr));gap:9px;align-items:start;}',
    ROOT + '.cx-thread{border:1px solid ' + C.line + ';border-top-width:3px;border-radius:10px;background:' + C.bg0 + ';padding:9px 10px;min-width:0;display:flex;flex-direction:column;gap:7px;}',
    ROOT + '.cx-thread-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}',
    ROOT + '.cx-thread-name{font-weight:700;font-size:13px;}',
    ROOT + '.cx-thread-status{font-size:11px;color:' + C.dim + ';text-align:right;}',
    ROOT + '.cx-thread-status.cx-s-blocked{color:' + C.amber + ';}',
    ROOT + '.cx-thread-status.cx-s-done{color:' + C.faint + ';}',
    ROOT + '.cx-thread-status.cx-s-ready{color:' + C.green + ';}',
    ROOT + '.cx-reg{font-size:11.5px;color:' + C.dim + ';}',
    ROOT + '.cx-reg b{color:' + C.ink + ';}',
    ROOT + '.cx-prog{margin:0;border:1px solid #16243c;border-radius:7px;background:#050c18;padding:5px 0;max-height:13rem;overflow:auto;}',
    ROOT + '.cx-ins{padding:1px 8px;font-size:11.5px;white-space:pre;color:' + C.faint + ';}',
    ROOT + '.cx-ins-past{color:#41536e;text-decoration:line-through;}',
    ROOT + '.cx-ins-now{color:#04121f;font-weight:700;}',
    ROOT + '.cx-step{width:100%;text-align:left;}',

    ROOT + '.cx-log{border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg0 + ';padding:8px 10px;max-height:16rem;overflow:auto;}',
    ROOT + '.cx-log-line{font-size:11.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;color:' + C.ink + ';}',
    ROOT + '.cx-log-line.cx-l-bad{color:' + C.red + ';font-weight:700;}',
    ROOT + '.cx-log-line.cx-l-warn{color:' + C.amber + ';}',
    ROOT + '.cx-log-line.cx-l-ok{color:' + C.green + ';}',
    ROOT + '.cx-log-line.cx-l-dim{color:' + C.faint + ';}',
    ROOT + '.cx-log-empty{font-size:11.5px;color:' + C.faint + ';}',

    ROOT + '.cx-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;}',
    ROOT + '.cx-chip{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:rgba(125,211,252,.15);color:' + C.cyan + ';}',
    ROOT + '.cx-chip-none{background:rgba(100,116,139,.16);color:' + C.faint + ';font-weight:400;}',

    ROOT + '.cx-table{width:100%;border-collapse:collapse;font-size:12px;}',
    ROOT + '.cx-table th{padding:5px 8px;text-align:left;font-weight:600;color:' + C.faint + ';border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    ROOT + '.cx-td{padding:4px 8px;border-bottom:1px solid rgba(28,43,68,.6);color:' + C.ink + ';white-space:nowrap;}',
    ROOT + '.cx-scroll{overflow-x:auto;border:1px solid ' + C.line + ';border-radius:9px;padding:2px 4px;background:rgba(15,23,42,.4);}',
    ROOT + '.cx-row-bad .cx-td{color:' + C.red + ';}',
    ROOT + '.cx-row-good .cx-td{color:' + C.green + ';}',

    ROOT + '.cx-note{margin:0;padding:9px 12px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    ROOT + '.cx-note b{color:' + C.ink + ';}',
    ROOT + '.cx-warnnote{border-left-color:' + C.amber + ';background:rgba(251,191,36,.07);}',
    ROOT + '.cx-dimnote{border-left-color:' + C.faint + ';background:rgba(100,116,139,.07);color:' + C.dim + ';}',

    ROOT + '.cx-graphwrap{border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg0 + ';padding:8px;}',
    ROOT + '.cx-graph{display:block;width:100%;height:auto;max-width:26rem;margin:0 auto;}',
    ROOT + '.cx-status{margin:0;font-size:11.5px;line-height:1.6;color:' + C.dim + ';min-height:1.2em;}',
    ROOT + '.cx-live{padding:8px 12px;border-top:1px solid ' + C.line + ';background:rgba(15,23,42,.5);}'
  ].join('');

  /* Thread inks are generated so the number of colours always matches the
     number of thread columns; the status word next to the name repeats every
     fact the colour carries, because colour on its own is not information. */
  function threadCss() {
    var out = '';
    for (var i = 0; i < THREAD_INK.length; i++) {
      out += ROOT + '.cx-c' + i + '{border-top-color:' + THREAD_INK[i] + ';}';
      out += ROOT + '.cx-name-' + i + '{color:' + THREAD_INK[i] + ';}';
      out += ROOT + '.cx-ins-now.cx-now-' + i + '{background:' + THREAD_INK[i] + ';}';
    }
    return out;
  }

  /* ======================================================================== */
  /*  SHARED RENDERING PIECES                                                 */
  /* ======================================================================== */

  function programList(machine, t) {
    var box = E('div', 'cx-prog');
    var prog = machine.progs[t];
    for (var i = 0; i < prog.length; i++) {
      var cls = 'cx-ins';
      if (i < machine.pc[t]) cls += ' cx-ins-past';
      else if (i === machine.pc[t]) cls += ' cx-ins-now cx-now-' + (t % THREAD_INK.length);
      var marker = i === machine.pc[t] ? ' > ' : '   ';
      box.appendChild(E('div', cls, marker + padRight(String(i), 2) + '  ' + OP_TEXT[prog[i]]));
    }
    return box;
  }

  function threadColumn(machine, t, onStep) {
    var ink = t % THREAD_INK.length;
    var col = E('div', 'cx-thread cx-c' + ink);
    var head = E('div', 'cx-thread-h');
    head.appendChild(E('span', 'cx-thread-name cx-name-' + ink, machine.names[t]));

    var why = machine.blocked(t);
    var done = machine.pc[t] >= machine.progs[t].length;
    var statusText, statusCls;
    if (done) { statusText = 'finished'; statusCls = 'cx-s-done'; }
    else if (why) { statusText = 'blocked: ' + why; statusCls = 'cx-s-blocked'; }
    else { statusText = 'ready to run'; statusCls = 'cx-s-ready'; }
    head.appendChild(E('span', 'cx-thread-status ' + statusCls, statusText));
    col.appendChild(head);

    var regLine = E('div', 'cx-reg');
    regLine.appendChild(document.createTextNode('private register r = '));
    regLine.appendChild(E('b', null, String(machine.reg[t])));
    col.appendChild(regLine);

    col.appendChild(programList(machine, t));

    var next = done ? null : machine.progs[t][machine.pc[t]];
    var label = done
      ? machine.names[t] + ' has finished'
      : 'Step ' + machine.names[t] + ': ' + OP_SHORT[next];
    var btn = button(label, function () { onStep(t); }, 'cx-step', 'step-' + t);
    btn.disabled = done;
    btn.setAttribute('aria-label', done
      ? machine.names[t] + ' has finished its program'
      : 'Step ' + machine.names[t] + ', whose next instruction is ' + OP_SHORT[next] +
        (why ? '. It is currently blocked: ' + why : ''));
    col.appendChild(btn);
    return col;
  }

  function transcript(machine) {
    var box = E('div', 'cx-log');
    box.setAttribute('tabindex', '0');
    box.setAttribute('aria-label', 'Execution transcript');
    if (!machine.log.length) {
      box.appendChild(E('p', 'cx-log-empty',
        'Nothing has run yet. Press the step button on a thread to execute one instruction.'));
      return box;
    }
    var from = Math.max(0, machine.log.length - 300);
    if (from > 0) {
      box.appendChild(E('div', 'cx-log-line cx-l-dim',
        '(' + num(from) + ' earlier lines hidden)'));
    }
    for (var i = from; i < machine.log.length; i++) {
      var entry = machine.log[i];
      var line = E('div', 'cx-log-line ' + entry.cls, entry.text);
      box.appendChild(line);
    }
    return box;
  }

  function scrollLogToEnd(box) {
    if (box) box.scrollTop = box.scrollHeight;
  }

  /* ======================================================================== */
  /*  PANEL 1-4: ONE COUNTER, FOUR DISCIPLINES                                */
  /* ======================================================================== */

  var MODE_INFO = {
    race: {
      label: 'No synchronisation',
      lede: 'Two or more threads run counter = counter + 1, which is three instructions: ' +
        'READ, ADD, WRITE. You choose which thread executes next. Step one thread to READ, ' +
        'step another thread to READ before the first one WRITEs, and the second write ' +
        'lands on a value that is already stale. That is a lost update, and it is the ' +
        'single most common concurrency bug there is.',
      worst: 'Lose an update on purpose'
    },
    mutex: {
      label: 'Mutex',
      lede: 'Same threads, same three instructions, with a lock around them. A thread whose ' +
        'next instruction is LOCK while another holds the lock is blocked — press its ' +
        'step button anyway and it joins the wait queue. Interleave as viciously as you ' +
        'like: the counter is always right, because the only orders left are the ones ' +
        'where whole critical sections follow one another.',
      worst: 'Try the same lossy schedule'
    },
    sem: {
      label: 'Semaphore',
      lede: 'A counting semaphore permits N holders at once, which is what it is for — ' +
        'a pool of connections, a rate limit, a bounded buffer. Set the permits to 2 and ' +
        'two threads are inside the critical section together, so the same lost update ' +
        'comes straight back. Set it to 1 and it becomes a mutex. A semaphore is not a ' +
        'lock; a semaphore of one is.',
      worst: 'Lose an update on purpose'
    },
    msg: {
      label: 'Message passing',
      lede: 'No shared state at all. The workers never touch the counter; they SEND +1 to a ' +
        'queue. One owner thread RECVs and APPLYs, and it is the only thread that can ' +
        'write. Interleave the sends however you like: with a single writer there is ' +
        'nothing for an interleaving to corrupt. The cost is the queue itself, and ' +
        'latency, and having to think about what happens when it fills up.',
      worst: 'Try the same lossy schedule'
    }
  };

  function SchedulerPanel(mode) {
    this.mode = mode;
    this.label = MODE_INFO[mode].label;
    this.threads = 2;
    this.incs = 2;
    this.permits = 2;
    this.build();
  }

  SchedulerPanel.prototype.build = function () {
    this.machine = new Machine(
      programsFor(this.mode, this.threads, this.incs, this.permits));
  };

  SchedulerPanel.prototype.reset = function () { this.build(); };

  /* The red button promises a lost update, and in the semaphore tab it was
     promising one at every permit count. With one permit the semaphore IS a
     mutex: the enumerator finds 0 losing schedules out of every schedule at
     every preset, so the button cannot deliver, and the permits selector
     labels 1 as "this is a mutex" — it invites you straight into the case
     where the label lies. The mutex and message-passing tabs already carry the
     honest wording for a button that cannot lose anything; a semaphore of one
     borrows it. */
  SchedulerPanel.prototype.worstLabel = function () {
    if (this.mode === 'sem' && this.permits <= 1) return MODE_INFO.mutex.worst;
    return MODE_INFO[this.mode].worst;
  };

  SchedulerPanel.prototype.render = function (host, redraw, live) {
    var self = this;
    var m = this.machine;
    var info = MODE_INFO[this.mode];

    host.appendChild(E('p', 'cx-lede', info.lede));

    /* --- configuration ------------------------------------------------- */
    var row = E('div', 'cx-fieldrow');
    row.appendChild(selectBox('Threads', [
      { key: 2, label: '2' }, { key: 3, label: '3' }, { key: 4, label: '4' }
    ], this.threads, function (v) {
      self.threads = parseInt(v, 10);
      self.build(); redraw();
    }, 'threads'));
    row.appendChild(selectBox('Increments each', [
      { key: 1, label: '1' }, { key: 2, label: '2' }, { key: 3, label: '3' }
    ], this.incs, function (v) {
      self.incs = parseInt(v, 10);
      self.build(); redraw();
    }, 'incs'));
    if (this.mode === 'sem') {
      row.appendChild(selectBox('Permits', [
        { key: 1, label: '1 (this is a mutex)' }, { key: 2, label: '2' },
        { key: 3, label: '3' }, { key: 4, label: '4' }
      ], this.permits, function (v) {
        self.permits = parseInt(v, 10);
        self.build(); redraw();
      }, 'permits'));
    }
    host.appendChild(row);

    /* --- shared state --------------------------------------------------- */
    var state = E('div', 'cx-state');
    var finished = m.allDone();
    var correct = m.mem === m.expected;
    state.appendChild(statCard('Shared counter', String(m.mem),
      finished
        ? (correct ? 'Finished, and it is correct.' : 'Finished, and it is wrong.')
        : 'Still running.',
      finished ? (correct ? 'cx-good' : 'cx-bad') : ''));
    state.appendChild(statCard('Should be', String(m.expected),
      this.threads + ' ' + plural(this.threads, 'thread', 'threads') +
      (this.mode === 'msg' ? ' plus an owner' : '') + ', ' + this.incs + ' ' +
      plural(this.incs, 'increment', 'increments') + ' each.'));
    state.appendChild(statCard('Increments executed', String(m.applied),
      this.mode === 'msg' ? 'APPLY steps the owner has performed.'
                          : 'Writes the program has actually performed.'));
    var missing = m.lostCount();
    var lostNote;
    if (!m.stale) lostNote = 'No write has overwritten a newer value yet.';
    else if (m.discarded > missing) {
      lostNote = m.stale + ' stale ' + plural(m.stale, 'write', 'writes') + ' threw away ' +
        m.discarded + ' in total, but a later write holding an older read pushed the ' +
        'counter back up again, so only ' + missing + ' ' + plural(missing, 'is', 'are') +
        ' missing now.';
    } else {
      lostNote = m.stale + ' stale ' + plural(m.stale, 'write', 'writes') +
        ' overwrote newer values.';
    }
    state.appendChild(statCard('Updates lost', String(missing), lostNote,
      missing ? 'cx-bad' : ''));

    if (this.mode === 'mutex') {
      var holder = m.lockOwner.A;
      state.appendChild(statCard('Lock A',
        holder == null ? 'free' : 'held by ' + m.names[holder],
        m.lockWait.A.length
          ? 'Wait queue: ' + m.lockWait.A.map(function (i) { return m.names[i]; }).join(', ')
          : 'Nobody is queued for it.',
        holder == null ? '' : 'cx-warn'));
    }
    if (this.mode === 'sem') {
      state.appendChild(statCard('Permits',
        m.permits + ' of ' + m.maxPermits + ' free',
        m.holders.length
          ? 'Inside now: ' + m.holders.map(function (i) { return m.names[i]; }).join(', ')
          : 'Nobody is inside the critical section.',
        m.holders.length > 1 ? 'cx-bad' : ''));
    }
    if (this.mode === 'msg') {
      state.appendChild(statCard('Queue depth', String(m.queue.length),
        'Owner: ' + m.names[m.owner] + ', the only thread that writes the counter.'));
    }
    host.appendChild(state);

    /* --- the loud part -------------------------------------------------- */
    var banner = this.banner();
    if (banner) host.appendChild(banner);

    /* --- threads --------------------------------------------------------- */
    var cols = E('div', 'cx-threads');
    for (var t = 0; t < m.n; t++) {
      cols.appendChild(threadColumn(m, t, function (i) {
        m.step(i);
        redraw();
      }));
    }
    host.appendChild(cols);

    /* --- transport -------------------------------------------------------- */
    var bar = E('div', 'cx-btnrow');
    bar.appendChild(button('Step one ready thread at random', function () {
      var t = m.pick('random');
      if (t < 0) m.say(-1, 'Nothing can run: every thread is finished or blocked.', 'cx-l-warn');
      else m.step(t);
      redraw();
    }, '', 'rand'));
    bar.appendChild(button('Run to the end, randomly', function () {
      m.runToEnd('random');
      redraw();
    }, '', 'runrand'));
    bar.appendChild(button(this.worstLabel(), function () {
      m.runToEnd('worst');
      redraw();
    }, 'cx-danger', 'worst'));
    bar.appendChild(button('Reset', function () { self.reset(); redraw(); }, '', 'reset'));
    host.appendChild(bar);

    live(this.statusLine());

    host.appendChild(E('p', 'cx-h', 'Transcript'));
    var log = transcript(m);
    host.appendChild(log);
    scrollLogToEnd(log);

    host.appendChild(note(this.limitText()));
  };

  SchedulerPanel.prototype.statusLine = function () {
    var m = this.machine;
    var bits = [num(m.steps) + ' ' + plural(m.steps, 'instruction', 'instructions') + ' executed',
      num(m.switches) + ' ' + plural(m.switches, 'context switch', 'context switches'),
      'counter ' + m.mem + ' of ' + m.expected];
    if (m.deadlocked()) bits.push('nothing can run: this is a deadlock');
    return bits.join(', ') + '.';
  };

  SchedulerPanel.prototype.banner = function () {
    var m = this.machine;
    if (m.lastLoss) {
      var L = m.lastLoss;
      var text = 'Lost update. ' + m.names[L.t] + ' read ' + L.read +
        ', and by the time it wrote ' + L.wrote + ' the counter had already moved to ' +
        L.before + '. ' + L.discarded + ' ' +
        plural(L.discarded, 'increment was', 'increments were') +
        ' thrown away by a single store. So far this run has executed ' + m.applied +
        ' ' + plural(m.applied, 'increment', 'increments') + ' and the counter says ' +
        m.mem + '. Nothing crashed, no error was raised, and no test would fail unless ' +
        'it happened to run this exact schedule.';
      return E('p', 'cx-banner', text);
    }
    if (m.deadlocked()) {
      return E('p', 'cx-banner',
        'Nothing can run. Every thread is either finished or waiting for something no ' +
        'running thread will release. That is a deadlock — the deadlock tab takes ' +
        'this apart properly.');
    }
    if (m.allDone()) {
      if (m.mem !== m.expected) {
        return E('p', 'cx-banner',
          'Finished at ' + m.mem + ' instead of ' + m.expected + '. ' + m.lostCount() +
          ' ' + plural(m.lostCount(), 'increment', 'increments') + ' vanished across ' +
          m.stale + ' stale ' + plural(m.stale, 'write', 'writes') + '.');
      }
      /* The obvious sentence here is "the threads still interleaved", and for a
         while that is what it said unconditionally — including after a run in
         which one thread had gone from start to finish without yielding once.
         The claim has to come from the switch count, not from the topic. */
      var head = 'Finished at ' + m.mem + ', which is correct, after ' + num(m.steps) +
        ' instructions and ' + num(m.switches) + ' ' +
        plural(m.switches, 'context switch', 'context switches') + '. ';
      var tail;
      if (this.mode === 'msg') {
        tail = 'The sends interleaved freely. With one owner holding the counter there ' +
          'is nothing for an interleaving to corrupt.';
      } else if (m.switches >= 2) {
        tail = 'The threads did still interleave — the transcript shows it — they ' +
          'just never interleaved inside the critical section.';
      } else {
        tail = 'This particular run barely interleaved at all. Press Run to the end, ' +
          'randomly for a messier order, or step the threads by hand: it comes out ' +
          'at ' + m.expected + ' every time.';
      }
      return E('p', 'cx-banner cx-ok', head + tail);
    }
    if (this.mode === 'sem' && m.holders.length > 1) {
      return E('p', 'cx-banner cx-amber',
        m.holders.length + ' threads are inside the critical section at the same time, ' +
        'which is exactly what a counting semaphore is supposed to allow. It is also ' +
        'exactly why this one cannot protect a shared counter.');
    }
    return null;
  };

  SchedulerPanel.prototype.limitText = function () {
    var common = 'This is a model, not a thread. JavaScript is single-threaded and nothing ' +
      'on this page runs concurrently — there is one array of program counters and a ' +
      'switch statement, and you are the scheduler. The model is also sequentially ' +
      'consistent: every step is atomic and every write is visible instantly. A real ' +
      'machine reorders stores and lets a value sit invisible in a store buffer, which ' +
      'makes it worse than this, never better.';
    if (this.mode === 'mutex') {
      return common + ' This lock is FIFO-fair, so the thread at the head of the queue ' +
        'gets it. A real pthread mutex promises no such thing and permits barging.';
    }
    if (this.mode === 'sem') {
      return common + ' Permits are handed out in queue order here. Real semaphores differ ' +
        'on that, and POSIX does not promise it outside the realtime scheduling policies.';
    }
    if (this.mode === 'msg') {
      return common + ' The queue here is assumed to be an atomic channel. That assumption ' +
        'is the thing you are buying from a real one; inside, it is built out of the ' +
        'primitives in the other tabs. It is also unbounded, which no real queue is: a ' +
        'full one either blocks the sender or drops the message, and somebody has to ' +
        'decide which.';
    }
    return common;
  };

  /* ======================================================================== */
  /*  PANEL 5: DEADLOCK BY LOCK ORDERING                                      */
  /* ======================================================================== */

  function DeadlockPanel() {
    this.label = 'Deadlock';
    this.ordered = false;
    this.build();
  }

  DeadlockPanel.prototype.build = function () {
    this.machine = new Machine(deadlockPrograms(this.ordered));
  };
  DeadlockPanel.prototype.reset = function () { this.build(); };

  DeadlockPanel.prototype.render = function (host, redraw, live) {
    var self = this;
    var m = this.machine;

    host.appendChild(E('p', 'cx-lede',
      'Two threads, two locks, one shared counter. T1 takes A then B. T2 takes ' +
      (this.ordered ? 'A then B as well — the same order.' : 'B then A — the ' +
      'opposite order.') + ' Step T1 once, step T2 once, then step them both again, and ' +
      'each is holding the lock the other needs next. Neither will ever release, because ' +
      'releasing is on the far side of an instruction that cannot execute. No error is ' +
      'raised. The process simply stops.'));

    var row = E('div', 'cx-btnrow');
    var b1 = button('T2 takes B then A (opposite order)', function () {
      self.ordered = false; self.build(); redraw();
    }, this.ordered ? '' : 'on', 'order-bad');
    var b2 = button('T2 takes A then B (same order)', function () {
      self.ordered = true; self.build(); redraw();
    }, this.ordered ? 'on' : '', 'order-good');
    b1.setAttribute('aria-pressed', this.ordered ? 'false' : 'true');
    b2.setAttribute('aria-pressed', this.ordered ? 'true' : 'false');
    row.appendChild(b1);
    row.appendChild(b2);
    host.appendChild(row);

    var state = E('div', 'cx-state');
    ['A', 'B'].forEach(function (key) {
      var holder = m.lockOwner[key];
      state.appendChild(statCard('Lock ' + key,
        holder == null ? 'free' : 'held by ' + m.names[holder],
        m.lockWait[key].length
          ? 'Waiting: ' + m.lockWait[key].map(function (i) { return m.names[i]; }).join(', ')
          : 'Nobody is queued.',
        holder == null ? '' : 'cx-warn'));
    });
    state.appendChild(statCard('Shared counter', String(m.mem),
      'Protected by both locks, so it is never wrong here. Deadlock is a liveness ' +
      'failure, not a correctness one.'));
    host.appendChild(state);

    var stuck = m.deadlocked();
    var edges = m.waitForEdges();
    var cycle = findCycle(m.n, edges);

    if (stuck || cycle) {
      var names = (cycle || []).map(function (i) { return m.names[i]; }).join(' waits for ');
      host.appendChild(E('p', 'cx-banner',
        (stuck ? 'Deadlocked. ' : 'A cycle has formed in the wait-for graph. ') +
        (cycle ? names + '. ' : '') +
        'Four conditions had to hold at once and all four do: the locks are held ' +
        'exclusively, each thread holds one while waiting for another, neither can be ' +
        'taken away, and the waiting is circular. Break any one of them and this cannot ' +
        'happen; the cheapest to break is the circular wait, by agreeing an order.'));
    }

    var cols = E('div', 'cx-threads');
    for (var t = 0; t < m.n; t++) {
      cols.appendChild(threadColumn(m, t, function (i) { m.step(i); redraw(); }));
    }
    host.appendChild(cols);

    var bar = E('div', 'cx-btnrow');
    bar.appendChild(button('Step into the deadlock', function () {
      /* T1 takes its first lock, T2 takes its first lock, then each tries for
         the second. With opposite orders that is the cycle; with the same
         order T2 simply blocks at the first lock and T1 finishes. */
      m.step(0); m.step(1); m.step(0); m.step(1);
      redraw();
    }, 'cx-danger', 'deadlock-it'));
    bar.appendChild(button('Run to the end, randomly', function () {
      m.runToEnd('random');
      redraw();
    }, '', 'runrand'));
    bar.appendChild(button('Reset', function () { self.reset(); redraw(); }, '', 'reset'));
    host.appendChild(bar);

    live(stuck
      ? 'Deadlocked after ' + num(m.steps) + ' instructions. Nothing can run.'
      : num(m.steps) + ' instructions executed. ' +
        (m.allDone() ? 'Both threads finished; the counter is ' + m.mem + '.'
                     : 'Both threads can still make progress.'));

    host.appendChild(E('p', 'cx-h', 'Wait-for graph'));
    host.appendChild(this.graph(m, edges, cycle));

    host.appendChild(E('p', 'cx-h', 'Transcript'));
    var log = transcript(m);
    host.appendChild(log);
    scrollLogToEnd(log);

    host.appendChild(E('p', 'cx-h', 'Every interleaving of these two threads'));
    host.appendChild(this.enumTable());

    host.appendChild(note(
      'A timeout is not a fix. Giving up on a lock after 200 ms converts a hang into a ' +
      'retry, and if both threads retry they can collide again, and again, in step: that ' +
      'is livelock, where everything is busy and nothing progresses. It also converts a ' +
      'deterministic failure you can reproduce into an intermittent one you cannot. ' +
      'Ordering the locks removes the cycle instead of surviving it, costs nothing at ' +
      'runtime, and is checkable by reading the code.', 'cx-warnnote'));

    host.appendChild(note(
      'Same caveat as everywhere else here: these are not threads, and this deadlock is a ' +
      'state in a model you are stepping by hand. What the model does capture honestly is ' +
      'the shape — the hold-and-wait, the cycle, and the fact that no exception is ' +
      'thrown when it happens.', 'cx-dimnote'));
  };

  /* Two nodes, arcs between them, arrowheads drawn as polygons rather than
     markers so there is no id to collide with anything else on the page. */
  DeadlockPanel.prototype.graph = function (m, edges, cycle) {
    var wrap = E('div', 'cx-graphwrap');
    var svg = S('svg', {
      viewBox: '0 0 340 160', 'class': 'cx-graph', role: 'img',
      'aria-label': 'Wait-for graph, described in the text below'
    });
    var inCycle = !!cycle;
    var pos = [{ x: 82, y: 78 }, { x: 258, y: 78 }];

    edges.forEach(function (e) {
      var up = e.from === 0;
      var path = up
        ? 'M 106 60 Q 170 18 234 60'
        : 'M 234 96 Q 170 138 106 96';
      var stroke = inCycle ? C.red : C.amber;
      svg.appendChild(S('path', {
        d: path, fill: 'none', stroke: stroke, 'stroke-width': 2.4
      }));
      var head = up
        ? '234,60 224,52 226,64'
        : '106,96 116,92 114,104';
      svg.appendChild(S('polygon', { points: head, fill: stroke }));
      var label = S('text', {
        x: 170, y: up ? 14 : 152, fill: stroke, 'font-size': 11,
        'font-family': FONT, 'text-anchor': 'middle'
      });
      label.textContent = m.names[e.from] + ' waits for lock ' + e.lock;
      svg.appendChild(label);
    });

    for (var t = 0; t < m.n && t < 2; t++) {
      var ink = THREAD_INK[t % THREAD_INK.length];
      svg.appendChild(S('circle', {
        cx: pos[t].x, cy: pos[t].y, r: 26, fill: '#0d1729', stroke: ink, 'stroke-width': 2
      }));
      var label2 = S('text', {
        x: pos[t].x, y: pos[t].y + 4, fill: ink, 'font-size': 13, 'font-weight': 'bold',
        'font-family': FONT, 'text-anchor': 'middle'
      });
      label2.textContent = m.names[t];
      svg.appendChild(label2);
      var holds = [];
      if (m.lockOwner.A === t) holds.push('A');
      if (m.lockOwner.B === t) holds.push('B');
      var label3 = S('text', {
        x: pos[t].x, y: pos[t].y + 44, fill: C.dim, 'font-size': 10,
        'font-family': FONT, 'text-anchor': 'middle'
      });
      label3.textContent = holds.length ? 'holds ' + holds.join(' and ') : 'holds nothing';
      svg.appendChild(label3);
    }
    wrap.appendChild(svg);

    var described;
    if (!edges.length) described = 'No thread is waiting for a lock held by another thread. There are no edges, so there is no cycle.';
    else {
      described = edges.map(function (e) {
        return m.names[e.from] + ' is waiting for lock ' + e.lock + ', held by ' + m.names[e.to];
      }).join('. ') + '.';
      described += cycle
        ? ' Those edges form a cycle, found by a depth-first search over the graph: ' +
          cycle.map(function (i) { return m.names[i]; }).join(' -> ') + '.'
        : ' There is no cycle among them, so this is a wait, not a deadlock.';
    }
    wrap.appendChild(E('p', 'cx-stat-note', described));
    return wrap;
  };

  DeadlockPanel.prototype.enumTable = function () {
    var bad = enumerate(deadlockPrograms(false));
    var good = enumerate(deadlockPrograms(true));
    var rows = [
      { cells: ['A then B / B then A (opposite)', num(bad.schedules),
        num(bad.deadlocks), pctText(bad.deadlocks, bad.schedules),
        num(bad.wrong)], cls: bad.deadlocks ? 'cx-row-bad' : '' },
      { cells: ['A then B / A then B (agreed)', num(good.schedules),
        num(good.deadlocks), pctText(good.deadlocks, good.schedules),
        num(good.wrong)], cls: good.deadlocks ? '' : 'cx-row-good' }
    ];
    var box = E('div');
    box.appendChild(table(
      ['Lock order', 'Legal schedules', 'Deadlocked', 'Share', 'Wrong counter'], rows));
    box.appendChild(E('p', 'cx-stat-note',
      'Both rows enumerated here, in this tab, every time this panel draws. With the ' +
      'orders disagreeing, ' + num(bad.deadlocks) + ' of ' + num(bad.schedules) +
      ' schedules end with both threads stuck — ' +
      pctText(bad.deadlocks, bad.schedules) + ' of them. With the orders agreed there ' +
      'are ' + num(good.schedules) + ' schedules and ' + num(good.deadlocks) +
      ' deadlock. The counts are small because a blocked thread cannot be chosen: ' +
      'once one thread is inside, the other has nowhere to go until it comes out, so ' +
      'most of the 3,432 ways of shuffling fourteen instructions are not legal runs at ' +
      'all. Neither version ever gets the counter wrong — holding both locks is ' +
      'still mutual exclusion, and a deadlock is a liveness failure, not a ' +
      'correctness one.'));
    return box;
  };

  /* ======================================================================== */
  /*  PANEL 6: ENUMERATION                                                    */
  /* ======================================================================== */

  var PRESETS = [
    { key: '2x1', threads: 2, incs: 1, label: '2 threads, 1 increment each' },
    { key: '2x2', threads: 2, incs: 2, label: '2 threads, 2 increments each' },
    { key: '3x1', threads: 3, incs: 1, label: '3 threads, 1 increment each' },
    { key: '2x3', threads: 2, incs: 3, label: '2 threads, 3 increments each' },
    { key: '4x1', threads: 4, incs: 1, label: '4 threads, 1 increment each' }
  ];

  function EnumPanel() {
    this.label = 'Count them';
    this.preset = '2x2';
    this.permits = 2;
    this.results = null;
  }

  EnumPanel.prototype.reset = function () { this.results = null; };

  EnumPanel.prototype.current = function () {
    for (var i = 0; i < PRESETS.length; i++) {
      if (PRESETS[i].key === this.preset) return PRESETS[i];
    }
    return PRESETS[1];
  };

  EnumPanel.prototype.compute = function () {
    var p = this.current();
    var self = this;
    var began = Date.now();
    var rows = ['race', 'mutex', 'sem', 'msg'].map(function (mode) {
      var spec = programsFor(mode, p.threads, p.incs, self.permits);
      var r = enumerate(spec);
      r.mode = mode;
      return r;
    });
    this.results = { preset: p, rows: rows, ms: Date.now() - began, permits: this.permits };
  };

  EnumPanel.prototype.render = function (host, redraw, live) {
    var self = this;

    host.appendChild(E('p', 'cx-lede',
      '“It works on my machine” is a statement about one schedule out of many. ' +
      'This walks ' +
      'the whole tree: at every point it tries every thread that could run, and counts ' +
      'where each complete run ends up. Nothing is sampled and nothing is estimated — ' +
      'these are exhaustive counts of a small program, computed in this tab when you press ' +
      'the button.'));

    var row = E('div', 'cx-fieldrow');
    row.appendChild(selectBox('Program', PRESETS.map(function (p) {
      return { key: p.key, label: p.label };
    }), this.preset, function (v) {
      self.preset = v; self.results = null; redraw();
    }, 'preset'));
    row.appendChild(selectBox('Semaphore permits', [
      { key: 1, label: '1' }, { key: 2, label: '2' }, { key: 3, label: '3' }
    ], this.permits, function (v) {
      self.permits = parseInt(v, 10); self.results = null; redraw();
    }, 'enum-permits'));
    host.appendChild(row);

    var bar = E('div', 'cx-btnrow');
    bar.appendChild(button(this.results ? 'Count them again' : 'Enumerate every interleaving',
      function () { self.compute(); redraw(); }, 'on', 'count'));
    if (this.results) {
      bar.appendChild(button('Clear', function () {
        self.results = null; redraw();
      }, '', 'clear'));
    }
    host.appendChild(bar);

    host.appendChild(note(
      'The search runs on the main thread and the tab will stop responding for as long as ' +
      'it takes. A blocked thread is modelled as one that cannot be chosen, so what is ' +
      'counted is distinct orders of progress rather than wall-clock schedules, and the ' +
      'locks here allow barging — any waiter may take a free lock — which gives ' +
      'more schedules than the FIFO queue in the other tabs, not fewer. The search stops ' +
      'at ' + num(LEAF_CAP) + ' schedules; when it does, the row says so and prints the ' +
      'multinomial upper bound instead of a smaller number that would be a lie.',
      'cx-dimnote'));

    if (!this.results) {
      live('Nothing counted yet. Choose a program and press Enumerate every interleaving.');
      return;
    }

    var R = this.results;
    var rows = R.rows.map(function (r) {
      var name = MODE_INFO[r.mode].label +
        (r.mode === 'sem' ? ' (' + R.permits + ' ' + plural(R.permits, 'permit', 'permits') + ')' : '');
      if (r.capped) {
        return {
          cells: [name,
            'more than ' + num(LEAF_CAP) + ' (upper bound ' + boundText(r.bound) + ')',
            'not counted', 'not counted', 'not counted'],
          cls: ''
        };
      }
      var values = Object.keys(r.byValue).sort(function (a, b) { return a - b; });
      return {
        cells: [name, num(r.schedules),
          values.length === 1 ? String(values[0]) : (values[0] + ' to ' + values[values.length - 1]),
          num(r.wrong), pctText(r.wrong, r.schedules)],
        cls: r.wrong ? 'cx-row-bad' : 'cx-row-good'
      };
    });
    host.appendChild(E('p', 'cx-h', R.preset.label + ', counter should end at ' +
      (R.preset.threads * R.preset.incs)));
    host.appendChild(table(
      ['Discipline', 'Legal schedules', 'Final counter', 'Schedules that end wrong', 'Share'],
      rows));

    var race = R.rows[0], mutex = R.rows[1];
    var lines = [];
    lines.push('Counted here, in this tab, in about ' + num(R.ms) + ' ms.');
    if (!race.capped) {
      lines.push('Unsynchronised, ' + num(race.wrong) + ' of ' + num(race.schedules) +
        ' schedules end with the wrong number — ' + pctText(race.wrong, race.schedules) +
        ' of them. A test that runs the program once runs one of these.');
    }
    if (!mutex.capped && !race.capped) {
      lines.push('The mutex leaves ' + num(mutex.schedules) + ' legal ' +
        plural(mutex.schedules, 'schedule', 'schedules') + ' where the ' +
        'unsynchronised version had ' + num(race.schedules) + '. The threads still ' +
        'take turns, but every one of the orders that survive ends at ' +
        (R.preset.threads * R.preset.incs) + '. That is what a lock buys: not the ' +
        'absence of interleaving, the absence of the interleavings that matter.');
    }
    host.appendChild(E('p', 'cx-stat-note', lines.join(' ')));
    live(race.capped
      ? 'Counted in about ' + num(R.ms) + ' milliseconds. The unsynchronised row hit the ' +
        num(LEAF_CAP) + ' schedule cap.'
      : 'Counted in about ' + num(R.ms) + ' milliseconds. Unsynchronised: ' +
        num(race.wrong) + ' of ' + num(race.schedules) + ' schedules end wrong.');

    if (!race.capped) {
      var values = Object.keys(race.byValue).sort(function (a, b) { return a - b; });
      var dist = values.map(function (v) {
        var count = race.byValue[v];
        return {
          cells: [v, num(count), pctText(count, race.schedules),
            Number(v) === race.expected ? 'correct' : 'lost ' + (race.expected - Number(v)) +
              ' ' + plural(race.expected - Number(v), 'increment', 'increments')],
          cls: Number(v) === race.expected ? 'cx-row-good' : 'cx-row-bad'
        };
      });
      host.appendChild(E('p', 'cx-h', 'Where the unsynchronised version lands'));
      host.appendChild(table(['Final counter', 'Schedules', 'Share', 'Verdict'], dist));
    }

    host.appendChild(note(
      'What this number is not: a probability. Every schedule counted here is legal, and ' +
      'the table says nothing at all about which ones your machine is likely to produce. ' +
      'Real hardware favours long uninterrupted runs, which is precisely why the losing ' +
      'schedules are rare enough to reach production and common enough to hurt once they ' +
      'are there. The count is an upper bound on your luck, not an estimate of it.',
      'cx-warnnote'));
  };

  /* ======================================================================== */
  /*  THE APP                                                                 */
  /* ======================================================================== */

  function App(mount) {
    this.root = mount;
    this.panels = [
      new SchedulerPanel('race'),
      new SchedulerPanel('mutex'),
      new SchedulerPanel('sem'),
      new SchedulerPanel('msg'),
      new DeadlockPanel(),
      new EnumPanel()
    ];
    this.active = 0;
    this.build();
    this.select(0);
  }

  App.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS + threadCss();
    this.root.appendChild(style);

    var wrap = E('div', 'cx-wrap');
    var tabs = E('div', 'cx-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Concurrency topics');
    this.tabs = this.panels.map(function (panel, i) {
      var b = E('button', 'cx-tab', panel.label);
      b.type = 'button';
      b.id = 'cx-tab-' + i;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-controls', 'cx-panel-' + i);
      b.tabIndex = -1;
      b.addEventListener('click', function () { self.select(i); });
      /* Arrow keys move between tabs, which is what a tablist is for and what a
         screen-reader user will try. Only the selected tab is a tab stop, so
         Tab leaves the strip in one press rather than six. */
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

    this.main = E('div', 'cx-panel');
    this.main.setAttribute('role', 'tabpanel');
    this.main.tabIndex = 0;
    wrap.appendChild(this.main);

    /* One live region for the whole widget, created once and never replaced.
       A role="status" node that is destroyed and rebuilt on every redraw is
       announced unreliably or not at all, which is the failure mode I hit
       first: the panel rebuild threw the region away before a screen reader
       had looked at it. The panels write text into this one instead. Only the
       one-line readout is live; the transcript deliberately is not, because a
       run to completion would otherwise read out sixty lines. */
    this.liveEl = E('p', 'cx-status cx-live');
    this.liveEl.setAttribute('role', 'status');
    this.liveEl.setAttribute('aria-live', 'polite');
    wrap.appendChild(this.liveEl);

    this.root.appendChild(wrap);
  };

  App.prototype.select = function (i) {
    this.active = i;
    for (var k = 0; k < this.tabs.length; k++) {
      var on = k === i;
      this.tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
      this.tabs[k].tabIndex = on ? 0 : -1;
    }
    this.main.id = 'cx-panel-' + i;
    this.main.setAttribute('aria-labelledby', 'cx-tab-' + i);
    this.redraw();
  };

  App.prototype.live = function (text) {
    if (this.liveEl) this.liveEl.textContent = text;
  };

  App.prototype.redraw = function () {
    var self = this;
    var panel = this.panels[this.active];
    /* Remember which control had focus so the rebuild below can hand it back;
       see the note on fk(). */
    var was = document.activeElement;
    var key = was && was.getAttribute ? was.getAttribute('data-fk') : null;
    clear(this.main);
    try {
      panel.render(this.main, function () { self.redraw(); },
        function (text) { self.live(text); });
      if (key) {
        var again = this.main.querySelector('[data-fk="' + key + '"]');
        if (again && again.focus && !again.disabled) again.focus();
      }
    } catch (err) {
      clear(this.main);
      this.main.appendChild(E('p', 'cx-banner',
        'This panel hit an error and stopped: ' + ((err && err.message) || String(err)) +
        '. Please tell me, and mention which browser you are using.'));
    }
  };

  App.prototype.restart = function () {
    var panel = this.panels[this.active];
    if (panel.reset) panel.reset();
    this.redraw();
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var built = false;
  var app = null;

  function boot() {
    if (built) return;
    var rootEl = document.getElementById('concurrencyviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('conc-mount') || rootEl;
    clear(mount);
    try {
      app = new App(mount);
      if (window.KSLab && window.KSLab.used) window.KSLab.used('run');
    } catch (err) {
      clear(mount);
      mount.appendChild(E('p', 'lab-viz-error',
        'This lab could not start in your browser: ' + ((err && err.message) || String(err)) +
        ' — the write-up below still explains what it would have shown. ' +
        'Please tell me, and mention which browser you are using.'));
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({
      id: 'concurrencyviz',
      onReady: boot,
      run: function () { if (app) app.restart(); }
    });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

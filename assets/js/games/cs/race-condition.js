/* ==========================================================================
   race-condition.js — ten concurrent programs, and you are the scheduler.
   --------------------------------------------------------------------------
   EVERY LEVEL ASKS FOR A WRONG ANSWER. Make the counter read 1 after two
   increments. Take 150 out of an account holding 100. Charge one card three
   times for one order. Build a singleton twice. That inversion is the whole
   design: a demo that shows you a race condition teaches you what one looks
   like, and a puzzle that makes you FIND the interleaving teaches you the
   thing that is actually worth having, which is the habit of asking "what
   happens if the other thread runs here" at every line of a read-modify-write.

   The player clicks a thread column and that thread executes exactly one
   step. Nothing runs on a timer, nothing is random, and there is no hidden
   scheduler making the decision — because a race condition is not caused by
   speed, it is caused by an ordering being LEGAL. Speed only decides how
   often you meet it. Removing the clock entirely is the clearest way to say
   that out loud.

   ---- WHY THE ORDERINGS ARE COUNTED FOR REAL ------------------------------
   After a level is solved the game prints how many of the program's legal
   orderings produce the bug: 18 of 20 on the counter, 2 of 44 on the
   double-checked lock, 0 of 2 on the one that cannot be broken. Those
   numbers are not written down anywhere. They come from an exhaustive
   depth-first walk of the state space with a memo on the state key, run in
   the browser at the moment the level is solved — the same walk that powers
   the Hint button, which can therefore say "the bug is still reachable from
   here" or "this run is already lost" without ever guessing.

   AND THE FIGURE IS NOT A FAILURE RATE, which is the sentence that has to go
   next to it every single time. Eighteen of twenty orderings losing an
   increment does not mean the counter is wrong ninety per cent of the time;
   it means that if the scheduler were free to switch at any step, almost
   nothing would work. Real schedulers hardly ever preempt inside a five-line
   function, so the two clean orderings are the ones a test suite keeps
   drawing, ten thousand times, green every time. The bug is not improbable.
   It is unfairly sampled, and the sampling changes the day the machine gets
   busy. Printing the percentage without that paragraph would teach the
   opposite of the truth.

   ---- THE LOCK LEVELS ARE NOT A VICTORY LAP -------------------------------
   Levels 6 to 9 hand you a mutex and challenge you to break it anyway, and
   each one is a mistake with a name that has been made in shipped code:

     6  the critical section does not cover the read, so the check is outside
     7  two locks taken in opposite orders — the goal here is a DEADLOCK
     8  the unlock moved above the write when somebody "shortened" it
     9  double-checked locking with the publish reordered above the init,
        which is the Java idiom that was broken for everyone until JSR-133,
        and is still broken in C++ without an atomic

   Level 10 is the same counter as level 1 with the lock used correctly, and
   it CANNOT be broken. It has exactly two legal orderings and both leave the
   counter at 2, so a player can exhaust the entire state space by hand in
   ten clicks and then be told, in as many words, that there is nothing left
   to try. A level whose answer is "you cannot, and here is the proof" is a
   legitimate level; without it the game teaches that all locks are theatre.

   ---- WHAT THE MODEL LEAVES OUT -------------------------------------------
   Said plainly, because a teaching model that pretends to be a machine is
   worse than one that admits its edges:

     - A step here is atomic. On a real CPU an increment is several
       instructions and a store can be torn; treating one source line as
       indivisible makes the puzzle finite and still shows the bug.
     - Memory reordering is not simulated. It appears exactly once, in level
       9, drawn openly as the order the compiler emitted — because inventing
       a plausible-looking memory model would be making something up.
     - Threads never fail, time out, or get preempted mid-step, and there is
       no cache, no scheduler quantum and no priority.

   ES5 throughout, no dependencies, nothing leaves the tab. The level table
   and the machine underneath it are kept free of the DOM (see PURE CORE
   below) so they can be lifted out whole and run under node, which is how
   the ordering counts were checked rather than asserted.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  /* ==================================================================
     PURE CORE — the level table and the little machine that runs it.

     Everything between the two markers touches no DOM, no shell and no
     browser global. That is deliberate: it can be sliced out of this file
     verbatim and required under node, which is how the interleaving counts
     printed after each level were verified.
     ================================================================== */
  /* == PURE CORE BEGIN == */

  function copy(obj) {
    var out = {}, k;
    for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    return out;
  }

  function names(obj) {
    var out = [], k;
    for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
    out.sort();
    return out;
  }

  /* The three steps of a read-modify-write, built for a named register so
     the two threads in a level read as two threads rather than as one
     program printed twice. Levels 1 and 10 are the same three steps; the
     only difference between them is the pair of lock calls around them, and
     that is the entire point of the last level. */
  function increment(reg) {
    return [
      { code: reg + ' = counter', kind: 'load',
        run: function (v, r) { r[reg] = v.counter; } },
      { code: reg + ' = ' + reg + ' + 1', kind: 'add',
        run: function (v, r) { r[reg] = r[reg] + 1; } },
      { code: 'counter = ' + reg, kind: 'store',
        run: function (v, r) { v.counter = r[reg]; } }
    ];
  }

  /* One withdrawal from a shared balance, check-then-act, taken through a
     register exactly as the compiled code would. Writing balance = a - 75
     rather than balance = balance - 75 is not a simplification: the read
     happened, and writing back a value derived from a stale read is the
     shape of the whole family of bugs. */
  function withdraw(reg, amount) {
    return [
      { code: reg + ' = balance', kind: 'load',
        run: function (v, r) { r[reg] = v.balance; } },
      { code: 'if (' + reg + ' < ' + amount + ') return', kind: 'check',
        run: function (v, r) { if (r[reg] < amount) return 'end'; } },
      { code: 'balance = ' + reg + ' - ' + amount, kind: 'store',
        run: function (v, r) { v.balance = r[reg] - amount; } },
      { code: 'dispense(' + amount + ')', kind: 'call',
        run: function (v) { v.dispensed = v.dispensed + amount; } }
    ];
  }

  function handler(reg) {
    return [
      { code: reg + ' = order.status', kind: 'load',
        run: function (v, r) { r[reg] = v.status; } },
      { code: 'if (' + reg + ' != "new") return', kind: 'check',
        run: function (v, r) { if (r[reg] !== 'new') return 'end'; } },
      { code: 'charge_card(2499)', kind: 'call',
        run: function (v) { v.charges = v.charges + 1; } },
      { code: 'order.status = "paid"', kind: 'store',
        run: function (v) { v.status = 'paid'; } }
    ];
  }

  function lazyInit(reg) {
    return [
      { code: reg + ' = config', kind: 'load',
        run: function (v, r) { r[reg] = v.config; } },
      { code: 'if (' + reg + ' == null) ' + reg + ' = new Config()', kind: 'call',
        run: function (v, r) { if (r[reg] === 0) { v.built = v.built + 1; r[reg] = v.built; } } },
      { code: 'config = ' + reg, kind: 'store',
        run: function (v, r) { v.config = r[reg]; } },
      { code: 'used = config', kind: 'call',
        run: function (v, r) { r.used = v.config; } }
    ];
  }

  function booking(reg) {
    return [
      { code: reg + ' = seats_left', kind: 'load',
        run: function (v, r) { r[reg] = v.seats; } },
      { code: 'if (' + reg + ' < 1) return', kind: 'check',
        run: function (v, r) { if (r[reg] < 1) return 'end'; } },
      { code: 'lock(seats)', kind: 'lock', lock: 'seats' },
      { code: 'seats_left = ' + reg + ' - 1; booked++', kind: 'store',
        run: function (v, r) { v.seats = r[reg] - 1; v.booked = v.booked + 1; } },
      { code: 'unlock(seats)', kind: 'unlock', lock: 'seats' }
    ];
  }

  function transfer(first, second, from, to) {
    return [
      { code: 'lock(' + first + ')', kind: 'lock', lock: first },
      { code: 'lock(' + second + ')', kind: 'lock', lock: second },
      { code: from + ' -= 50; ' + to + ' += 50', kind: 'store',
        run: function (v) { v[from] = v[from] - 50; v[to] = v[to] + 50; } },
      { code: 'unlock(' + second + ')', kind: 'unlock', lock: second },
      { code: 'unlock(' + first + ')', kind: 'unlock', lock: first }
    ];
  }

  function earlyUnlock(reg) {
    return [
      { code: 'lock(ledger)', kind: 'lock', lock: 'ledger' },
      { code: reg + ' = balance', kind: 'load',
        run: function (v, r) { r[reg] = v.balance; } },
      { code: 'unlock(ledger)', kind: 'unlock', lock: 'ledger' },
      { code: reg + ' = ' + reg + ' - 50', kind: 'add',
        run: function (v, r) { r[reg] = r[reg] - 50; } },
      { code: 'balance = ' + reg, kind: 'store',
        run: function (v, r) { v.balance = r[reg]; } }
    ];
  }

  /* Double-checked locking, printed in the order the code actually runs in
     rather than the order it was written in. Step 3 publishes the reference
     and step 4 writes the field, because that is the reordering the whole
     bug is made of — a compiler is entitled to sink the field write below
     the publish, and for years every JVM did. Step 1 is the unlocked fast
     path, and it is the only door into the half-built object. */
  function doubleChecked(reg) {
    return [
      { code: 'if (inst != null) { use(inst); return }', kind: 'check',
        run: function (v) {
          if (v.inst !== 0) { if (!v.ready) v.halfUsed = 1; return 'end'; }
        } },
      { code: 'lock(init)', kind: 'lock', lock: 'init' },
      { code: 'if (inst == null) { ' + reg + ' = alloc(); inst = ' + reg + ' }', kind: 'store',
        run: function (v, r) {
          if (v.inst === 0) { v.built = v.built + 1; r[reg] = v.built; v.inst = r[reg]; }
        } },
      { code: 'inst.ready = true', kind: 'store',
        run: function (v, r) { if (r[reg] !== 0) v.ready = 1; } },
      { code: 'unlock(init)', kind: 'unlock', lock: 'init' },
      { code: 'use(inst)', kind: 'call',
        run: function (v) { if (!v.ready) v.halfUsed = 1; } }
    ];
  }

  function guarded(reg) {
    return [{ code: 'lock(m)', kind: 'lock', lock: 'm' }]
      .concat(increment(reg))
      .concat([{ code: 'unlock(m)', kind: 'unlock', lock: 'm' }]);
  }

  /* What the name "report.txt" resolves to right now. Three values only:
     the file you own, nothing at all while it is unlinked, and the symlink
     the attacker put in its place. */
  function ownerOf(path) {
    if (path === 'report.txt') return 'you';
    if (path === '/etc/shadow') return 'root';
    return 'nobody';
  }

  var LEVELS = [
    {
      id: 'lost-update',
      tag: 'Lost update',
      goal: 'Make the counter read 1 after two increments.',
      brief: 'Two threads each add one to the same counter. Both are correct on their own. ' +
        'Run them one step at a time and leave the counter at 1.',
      vars: function () { return { counter: 0 }; },
      shown: [{ key: 'counter', label: 'counter' }],
      threads: [
        { name: 'Thread A', regs: { a: 0 }, steps: increment('a'),
          regText: function (r) { return 'a = ' + r.a; } },
        { name: 'Thread B', regs: { b: 0 }, steps: increment('b'),
          regText: function (r) { return 'b = ' + r.b; } }
      ],
      win: function (v) { return v.counter === 1; },
      miss: function (v) {
        return 'Both increments landed and the counter reads ' + v.counter +
          ', which is what the program is supposed to do. Most orderings do that. ' +
          'Get both loads in before either store.';
      },
      lesson: 'counter = counter + 1 is three machine operations wearing one line of source: ' +
        'load, add, store. Nothing stops the other thread reading the same value you did, ' +
        'and then one of the two increments is simply gone. It is not lost slowly or ' +
        'occasionally corrupted — it never happened.'
    },

    {
      id: 'check-then-act',
      tag: 'Check then act',
      goal: 'Take 150 out of an account holding 100.',
      brief: 'Two cash machines, one account, 75 requested at each. Both check the balance ' +
        'before they touch it, and the check is honest. Get 150 out of the door.',
      vars: function () { return { balance: 100, dispensed: 0 }; },
      shown: [{ key: 'balance', label: 'balance' }, { key: 'dispensed', label: 'cash out' }],
      threads: [
        { name: 'Cash machine 1', regs: { a: 0 }, steps: withdraw('a', 75),
          regText: function (r) { return 'a = ' + r.a; } },
        { name: 'Cash machine 2', regs: { b: 0 }, steps: withdraw('b', 75),
          regText: function (r) { return 'b = ' + r.b; } }
      ],
      win: function (v) { return v.dispensed === 150; },
      miss: function (v) {
        return v.dispensed + ' left the machines and the balance reads ' + v.balance +
          '. The second check did its job. Make both checks read the balance before ' +
          'either withdrawal writes it back.';
      },
      lesson: 'The gap between the check and the act is where the money goes. Both machines ' +
        'read 100, both agreed 75 was affordable, and both were right at the moment they ' +
        'looked. The balance ends at 25 rather than at -50, because each wrote back a figure ' +
        'derived from its own stale read — so the account is not even wrong in a way the ' +
        'ledger can see. This is the shape of most inventory oversell bugs.'
    },

    {
      id: 'toctou',
      tag: 'Time of check to time of use',
      goal: 'Make the helper write into /etc/shadow.',
      brief: 'A privileged helper checks that you own report.txt and then writes to it. ' +
        'The check is correct. Slide the attacker in between the check and the open.',
      vars: function () { return { path: 'report.txt', wrote: 'nothing' }; },
      shown: [
        { key: 'path', label: 'report.txt resolves to' },
        { key: 'wrote', label: 'written to' }
      ],
      threads: [
        {
          name: 'Helper (root)', regs: { h: '?', f: '?' },
          regText: function (r) { return 'owner = ' + r.h + ', fd = ' + r.f; },
          steps: [
            { code: 'h = stat("report.txt").owner', kind: 'load',
              run: function (v, r) { r.h = ownerOf(v.path); } },
            { code: 'if (h != "you") return', kind: 'check',
              run: function (v, r) { if (r.h !== 'you') return 'end'; } },
            { code: 'fd = open("report.txt")', kind: 'call',
              run: function (v, r) { if (v.path === 'missing') return 'end'; r.f = v.path; } },
            { code: 'write(fd, log)', kind: 'store',
              run: function (v, r) { v.wrote = r.f; } }
          ]
        },
        {
          name: 'Attacker (you)', regs: {},
          steps: [
            { code: 'unlink("report.txt")', kind: 'call',
              run: function (v) { v.path = 'missing'; } },
            { code: 'symlink("/etc/shadow", "report.txt")', kind: 'call',
              run: function (v) { v.path = '/etc/shadow'; } }
          ]
        }
      ],
      win: function (v) { return v.wrote === '/etc/shadow'; },
      miss: function (v) {
        if (v.wrote === 'report.txt') {
          return 'The helper checked the file it then opened, so it wrote where it meant to. ' +
            'Both swaps have to land after the check and before the open.';
        }
        return 'The helper found the name pointing at something it did not own, or at nothing, ' +
          'and refused. Nothing was written. Let the check see your own file first.';
      },
      lesson: 'The helper never made a wrong decision. It asked the kernel who owned the name, ' +
        'got a true answer, and then asked the kernel for the name a second time — and a name ' +
        'is not a thing. Between the two questions the answer changed. The fix is not a better ' +
        'check; it is to check the object rather than the name: open once and fstat the ' +
        'descriptor you are holding, or use openat with O_NOFOLLOW.'
    },

    {
      id: 'double-submit',
      tag: 'Double spend',
      goal: 'Charge one card three times for one order.',
      brief: 'An impatient customer double-clicked Pay and the mobile app retried. Three ' +
        'request handlers are now running the same order. Charge all three.',
      vars: function () { return { status: 'new', charges: 0 }; },
      shown: [{ key: 'status', label: 'order.status' }, { key: 'charges', label: 'card charged' }],
      threads: [
        { name: 'Request 1', regs: { s: '?' }, steps: handler('s'),
          regText: function (r) { return 's = ' + r.s; } },
        { name: 'Request 2', regs: { s: '?' }, steps: handler('s'),
          regText: function (r) { return 's = ' + r.s; } },
        { name: 'Request 3', regs: { s: '?' }, steps: handler('s'),
          regText: function (r) { return 's = ' + r.s; } }
      ],
      win: function (v) { return v.charges === 3; },
      miss: function (v) {
        return 'The card was charged ' + v.charges + (v.charges === 1 ? ' time' : ' times') +
          '. A handler that reads the status after somebody else has written "paid" stops, ' +
          'as it should. All three have to read it while it still says "new".';
      },
      lesson: 'Three processes, possibly on three machines, so there is no lock in the ' +
        'language that helps. The guard has to live where the data does: a unique constraint ' +
        'on an idempotency key, or an UPDATE orders SET status = \'paid\' WHERE id = ? AND ' +
        'status = \'new\' whose affected-row count you actually read. One row updated means ' +
        'you won the race; zero means somebody else did, and you must not charge.'
    },

    {
      id: 'singleton',
      tag: 'Lazy singleton',
      goal: 'Construct the one and only Config twice.',
      brief: 'A lazily created singleton with no lock at all. Build it twice, and give the ' +
        'two threads different objects to hold.',
      vars: function () { return { config: 0, built: 0 }; },
      shown: [
        { key: 'config', label: 'config', fmt: function (n) { return n ? '#' + n : 'null'; } },
        { key: 'built', label: 'constructors run' }
      ],
      threads: [
        { name: 'Thread A', regs: { a: 0, used: 0 }, steps: lazyInit('a'),
          regText: function (r) {
            return 'a = ' + (r.a ? '#' + r.a : 'null') + ', used = ' + (r.used ? '#' + r.used : '—');
          } },
        { name: 'Thread B', regs: { b: 0, used: 0 }, steps: lazyInit('b'),
          regText: function (r) {
            return 'b = ' + (r.b ? '#' + r.b : 'null') + ', used = ' + (r.used ? '#' + r.used : '—');
          } }
      ],
      win: function (v) { return v.built === 2; },
      miss: function (v) {
        return 'The constructor ran ' + v.built + ' time' + (v.built === 1 ? '' : 's') +
          '. The second thread found config already set and reused it, which is the ' +
          'behaviour you wanted. Both threads have to read config while it is still null.';
      },
      lesson: 'Two objects, and whichever store lands second wins the field — so the thread ' +
        'that built #1 is now holding an object nobody else can see. If Config opened a ' +
        'connection pool you have two pools; if it registered a metrics collector you are ' +
        'double counting; if it holds a cache, half your reads miss forever. The damage is ' +
        'rarely the second constructor. It is that "the" singleton stopped being one.'
    },

    {
      id: 'short-section',
      tag: 'The critical section is too small',
      mistake: 'The lock covers the write. It does not cover the read, and the check sits ' +
        'outside it too.',
      goal: 'Sell the last seat twice.',
      brief: 'One seat left, two bookings, and a real mutex — but the seat count is read and ' +
        'checked before the lock is taken. The lock will work perfectly. Break it anyway.',
      locks: ['seats'],
      vars: function () { return { seats: 1, booked: 0 }; },
      shown: [{ key: 'seats', label: 'seats_left' }, { key: 'booked', label: 'booked' }],
      threads: [
        { name: 'Booking 1', regs: { a: 0 }, steps: booking('a'),
          regText: function (r) { return 'a = ' + r.a; } },
        { name: 'Booking 2', regs: { b: 0 }, steps: booking('b'),
          regText: function (r) { return 'b = ' + r.b; } }
      ],
      win: function (v) { return v.booked === 2; },
      miss: function (v) {
        return v.booked + ' seat' + (v.booked === 1 ? '' : 's') + ' booked, ' + v.seats +
          ' left. One booking read the count after the other had written it back. ' +
          'Both reads have to happen before either lock is taken.';
      },
      lesson: 'The mutex did its job: the two writes never overlapped, not once, in any ' +
        'ordering. It made no difference, because the decision was already taken outside it. ' +
        'A lock protects the lines it wraps and nothing else, so the critical section has to ' +
        'start at the READ that the write depends on. "Lock the smallest thing possible" is ' +
        'good advice that has shipped this bug a thousand times.'
    },

    {
      id: 'deadlock',
      tag: 'Lock ordering',
      mistake: 'Two locks, taken in opposite orders by two threads.',
      goal: 'Deadlock the pair. Nobody finishes.',
      brief: 'Two transfers between the same two accounts, each locking the account it takes ' +
        'from first. There is no lost update here to hunt for. Wedge them so that neither ' +
        'thread can ever move again.',
      locks: ['alice', 'bob'],
      vars: function () { return { alice: 100, bob: 100 }; },
      shown: [{ key: 'alice', label: 'alice' }, { key: 'bob', label: 'bob' }],
      threads: [
        { name: 'Transfer alice to bob', regs: {}, steps: transfer('alice', 'bob', 'alice', 'bob') },
        { name: 'Transfer bob to alice', regs: {}, steps: transfer('bob', 'alice', 'bob', 'alice') }
      ],
      win: function (v, done) { return !done; },
      miss: function () {
        return 'Both transfers completed and the money is right. That is what happens when ' +
          'one thread gets all the way through before the other starts. Take one lock with ' +
          'each thread, then ask each of them for the other one.';
      },
      lesson: 'Four conditions have to hold at once for this, and they all do: the locks are ' +
        'exclusive, each thread holds one while waiting for another, neither can be forced ' +
        'to release what it holds, and the waiting forms a cycle. Deny any single one and the deadlock becomes ' +
        'impossible. The cheap denial is the last: give every lock a global order — by ' +
        'account id, say — and take them in that order always, so a cycle cannot be drawn. ' +
        'The junction in <a href="/games/traffic">Traffic</a> is the same cycle in tarmac.'
    },

    {
      id: 'early-unlock',
      tag: 'Released too early',
      mistake: 'Somebody shortened the critical section and left the write outside it.',
      goal: 'Leave 50 in an account after two withdrawals of 50 from 100.',
      brief: 'Two tellers, one balance, a mutex held across the read and released before the ' +
        'write. The comment on the commit said "hold the lock for less time".',
      locks: ['ledger'],
      vars: function () { return { balance: 100 }; },
      shown: [{ key: 'balance', label: 'balance' }],
      threads: [
        { name: 'Teller 1', regs: { a: 0 }, steps: earlyUnlock('a'),
          regText: function (r) { return 'a = ' + r.a; } },
        { name: 'Teller 2', regs: { b: 0 }, steps: earlyUnlock('b'),
          regText: function (r) { return 'b = ' + r.b; } }
      ],
      win: function (v) { return v.balance === 50; },
      miss: function (v) {
        return 'The balance reads ' + v.balance + ', which is correct for two withdrawals of ' +
          '50. Both reads have to happen before either write, and the lock is no longer ' +
          'holding while the writes go in.';
      },
      lesson: 'A lock is not a spell cast over a variable, it is a period of time. Release it ' +
        'before the value you read has been written back and you have protected the read from ' +
        'nothing at all. The same failure arrives dressed differently as an early return: a ' +
        'branch that leaves the function between the lock and the unlock either wedges every ' +
        'later caller forever, or, with a scope guard that releases on the way out, ends the ' +
        'critical section exactly here.'
    },

    {
      id: 'double-checked',
      tag: 'Double-checked locking',
      mistake: 'The publish and the field write were reordered, and the fast path reads ' +
        'without the lock.',
      goal: 'Make a thread use the object before it is built.',
      brief: 'The famous one. A lock guards construction, and a fast path outside the lock ' +
        'skips it once the instance exists. The compiler has hoisted the store to inst above ' +
        'the field write, which it is entitled to do. Hand a half-built object to a thread.',
      locks: ['init'],
      vars: function () { return { inst: 0, ready: 0, built: 0, halfUsed: 0 }; },
      shown: [
        { key: 'inst', label: 'inst', fmt: function (n) { return n ? '#' + n : 'null'; } },
        { key: 'ready', label: 'inst.ready', fmt: function (n) { return n ? 'true' : 'false'; } }
      ],
      threads: [
        { name: 'Thread A', regs: { a: 0 }, steps: doubleChecked('a'),
          regText: function (r) { return 'a = ' + (r.a ? '#' + r.a : 'null'); } },
        { name: 'Thread B', regs: { b: 0 }, steps: doubleChecked('b'),
          regText: function (r) { return 'b = ' + (r.b ? '#' + r.b : 'null'); } }
      ],
      win: function (v) { return v.halfUsed === 1; },
      miss: function (v) {
        if (v.built === 0) return 'Nothing was built yet. One thread has to get inside the lock.';
        return 'Every use saw a finished object. The half-built one is only visible through ' +
          'the unlocked fast path at step 1, while the other thread is still inside the lock ' +
          'between the publish and the field write.';
      },
      lesson: 'This was the standard Java singleton idiom, published in books, and it was ' +
        'broken on every JVM until the memory model was rewritten for Java 5. Nothing in the ' +
        'source is out of order; the machine is allowed to make the reference visible before ' +
        'the fields it points at, and a reader outside the lock has no barrier that would ' +
        'stop it seeing the pair in that order. Declaring the field volatile fixes it under ' +
        'Java 5 and later; in C++ it needs an atomic with the right ordering, or you use a ' +
        'function-local static and get the guarantee from the language.'
    },

    {
      id: 'correct-lock',
      tag: 'The lock used correctly',
      mistake: 'None. This one is right.',
      goal: 'Make the counter read 1 after two increments — if you can.',
      brief: 'Level one again, with a mutex held across all three steps of the read-modify-' +
        'write. Try to break it. Run both of the orderings this program has and the game ' +
        'will offer you the claim that it cannot be done.',
      locks: ['m'],
      impossible: true,
      vars: function () { return { counter: 0 }; },
      shown: [{ key: 'counter', label: 'counter' }],
      threads: [
        { name: 'Thread A', regs: { a: 0 }, steps: guarded('a'),
          regText: function (r) { return 'a = ' + r.a; } },
        { name: 'Thread B', regs: { b: 0 }, steps: guarded('b'),
          regText: function (r) { return 'b = ' + r.b; } }
      ],
      win: function (v) { return v.counter === 1; },
      miss: function (v) {
        return 'The counter reads ' + v.counter + '. Once a thread holds the lock the other ' +
          'one cannot be chosen at all, so there is nothing to interleave.';
      },
      lesson: 'The lock turns ten steps into two indivisible blocks of five, so the state ' +
        'space collapses from two hundred and fifty-two orderings to two, and both of them ' +
        'are correct. That is what mutual exclusion buys: not a smaller chance of the bug, ' +
        'but an ordering that cannot be expressed. Every level before this one was a lock ' +
        'that was missing, too small, released too soon, taken in the wrong order, or read ' +
        'around &mdash; never a lock that failed. <a href="/labs/concurrency">The ' +
        'concurrency lab</a> next door is the same machinery with the puzzle taken off: ' +
        'step a shared counter yourself, then put a mutex, a semaphore or a message queue ' +
        'behind it and watch the outcome change. The <a href="/labs/os-algorithms">OS ' +
        'algorithm visualiser</a> is the scheduler you have been playing, running forwards ' +
        'on a real policy with the waiting measured.'
    }
  ];

  /* ------------------------------------------------------------------
     The machine. A state is the program counters, the shared variables,
     the per-thread registers and who holds each lock. Nothing else exists,
     which is what makes the state space finite and the walk below exact.
     ------------------------------------------------------------------ */

  function newState(level) {
    var st = { v: level.vars(), r: [], pc: [], locks: {} };
    var i;
    for (i = 0; i < level.threads.length; i++) {
      st.pc.push(0);
      st.r.push(copy(level.threads[i].regs || {}));
    }
    var lk = level.locks || [];
    for (i = 0; i < lk.length; i++) st.locks[lk[i]] = null;
    return st;
  }

  function cloneState(st) {
    var out = { v: copy(st.v), r: [], pc: st.pc.slice(), locks: copy(st.locks) };
    for (var i = 0; i < st.r.length; i++) out.r.push(copy(st.r[i]));
    return out;
  }

  /* Sorted name lists, worked out once per level and cached on it. The state
     key is a string, so the order of the keys in it has to be stable — an
     object's enumeration order is not something to bet an exhaustive search
     on, and a key that varies would silently split one state into several
     and inflate every count printed by this file. */
  function prepare(level) {
    if (level._ready) return level;
    level._vnames = names(level.vars());
    level._lnames = (level.locks || []).slice().sort();
    level._rnames = [];
    for (var i = 0; i < level.threads.length; i++) {
      level._rnames.push(names(level.threads[i].regs || {}));
    }
    level._ready = true;
    return level;
  }

  function keyOf(level, st) {
    var out = st.pc.join(',') + '|';
    var i, j;
    for (i = 0; i < level._vnames.length; i++) out += st.v[level._vnames[i]] + ',';
    out += '|';
    for (i = 0; i < level._lnames.length; i++) {
      var who = st.locks[level._lnames[i]];
      out += (who == null ? '-' : who) + ',';
    }
    out += '|';
    for (i = 0; i < st.r.length; i++) {
      for (j = 0; j < level._rnames[i].length; j++) out += st.r[i][level._rnames[i][j]] + ',';
      out += ';';
    }
    return out;
  }

  /* A thread can be stepped unless it has finished or is sitting on a lock
     somebody else holds. Nothing else blocks: there is no yield, no sleep
     and no preemption in this model. */
  function runnable(level, st, t) {
    var steps = level.threads[t].steps;
    if (st.pc[t] >= steps.length) return false;
    var s = steps[st.pc[t]];
    if (s.kind === 'lock' && st.locks[s.lock] != null && st.locks[s.lock] !== t) return false;
    return true;
  }

  function applyStep(level, st, t) {
    var steps = level.threads[t].steps;
    var s = steps[st.pc[t]];
    var out = s.run ? s.run(st.v, st.r[t], st, t) : null;
    if (s.kind === 'lock') st.locks[s.lock] = t;
    if (s.kind === 'unlock') st.locks[s.lock] = null;
    st.pc[t] = (out === 'end') ? steps.length : st.pc[t] + 1;
    return s;
  }

  function allDone(level, st) {
    for (var t = 0; t < level.threads.length; t++) {
      if (st.pc[t] < level.threads[t].steps.length) return false;
    }
    return true;
  }

  function stuck(level, st) {
    for (var t = 0; t < level.threads.length; t++) if (runnable(level, st, t)) return false;
    return true;
  }

  function isWin(level, st) {
    return !!level.win(st.v, allDone(level, st), st);
  }

  /* ------------------------------------------------------------------
     The exhaustive walk.

     Counts every terminal path from a state and how many of them satisfy
     the level's goal, memoised on the state key. Memoising on the STATE
     rather than on the path is what makes this cheap: the future depends
     on nothing but the state, so two paths that arrive at the same place
     share every ordering that follows.

     A terminal state is one where no thread can be stepped — either all of
     them finished, or the survivors are wedged on locks, which is exactly
     the deadlock level's goal and why it has to be a terminal state rather
     than an error.

     BUDGET is a ceiling, not an expectation. The largest level here settles
     in a few thousand states; the cap exists so that a level added later
     with one thread too many degrades into "more orderings than this page
     will count" instead of hanging the tab.
     ------------------------------------------------------------------ */
  var BUDGET = 400000;

  function analyse(level, from) {
    prepare(level);
    var memo = {};
    var visits = 0;
    var capped = false;

    function walk(st) {
      var key = keyOf(level, st);
      if (memo[key]) return memo[key];
      if (visits++ > BUDGET) { capped = true; return { total: 1, bug: 0 }; }
      var any = false, total = 0, bug = 0;
      for (var t = 0; t < level.threads.length; t++) {
        if (!runnable(level, st, t)) continue;
        any = true;
        var next = cloneState(st);
        applyStep(level, next, t);
        var r = walk(next);
        total += r.total;
        bug += r.bug;
      }
      var out = any ? { total: total, bug: bug }
                    : { total: 1, bug: isWin(level, st) ? 1 : 0 };
      memo[key] = out;
      return out;
    }

    var res = walk(from || newState(level));
    return { total: res.total, bug: res.bug, capped: capped };
  }

  /* Which thread to run next if you still want the bug. Returns -1 when
     every remaining ordering is correct — which is a genuinely useful thing
     for the game to be able to say, because "this run is already lost" is
     the answer a player who has just clicked twice in a row needs. */
  function hintFor(level, st) {
    prepare(level);
    if (stuck(level, st)) return -1;
    for (var t = 0; t < level.threads.length; t++) {
      if (!runnable(level, st, t)) continue;
      var next = cloneState(st);
      applyStep(level, next, t);
      var r = analyse(level, next);
      if (r.bug > 0) return t;
    }
    return -1;
  }

  /* == PURE CORE END == */

  /* ------------------------------------------------------------------
     Display. Everything below here is inline-styled, for the reason
     incident-response.js gives: one game does not get to add rules to a
     stylesheet that fifty other pages load.
     ------------------------------------------------------------------ */
  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  GameShell.define({
    id: 'game-race-condition',
    slug: 'race-condition',
    /* Written here as well as in the manifest, because the manifest is
       build-time data that nothing hands to the runtime — the gate in
       build.js exists for exactly this pair of fields. bestKey matches the
       slug, which is what the shell would do anyway; tapAction is off
       because every target on this board is a real button and a stray tap
       on the space between two columns must not run a step the player did
       not choose. */
    bestKey: 'race-condition',
    tapAction: false,
    title: 'Race condition',
    startTitle: 'You are the scheduler',
    startText: 'Ten small programs, and each level asks you to produce a specific wrong ' +
      'answer. Click a thread to run one step of it. Nothing is timed and nothing is random.',

    setup: function (g) {
      /* Belt and braces: the manifest declares board: true, so the generated
         page hands the shell a .game-board. A page that somehow shipped as a
         canvas would render nothing at all, which is a worse failure than
         four lines of defence. */
      var host = g.board;
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
      host.style.maxWidth = '52rem';
      host.style.textAlign = 'left';

      var INK = 'var(--ink)';
      var INK3 = 'var(--ink-3)';
      var INK4 = 'var(--ink-4)';
      var LINE = 'rgb(var(--line-rgb) / 0.28)';
      var SHEET = 'rgb(var(--sheet-rgb) / 0.6)';
      var WELL = 'rgb(var(--well-rgb) / 0.7)';
      var GOOD = '#4ade80';
      var WARN = '#fbbf24';
      var MONO = "'Cascadia Code',Consolas,'SFMono-Regular',monospace";

      var undoBtn = document.getElementById('game-undo');
      var rerunBtn = document.getElementById('game-rerun');
      var hintBtn = document.getElementById('game-hint');

      var S = null;      // the whole run, rebuilt by reset()
      var colBtns = [];
      var colIdx = 0;

      function level() { return LEVELS[S.at]; }

      /* --------------------------------------------------------------
         Sentences. Written once here so the visible status line and the
         screen-reader announcement can never drift apart — they are the
         same string, printed twice.
         -------------------------------------------------------------- */
      function stateSentence() {
        var lv = level();
        var out = [];
        for (var i = 0; i < lv.shown.length; i++) {
          var s = lv.shown[i];
          var raw = S.st.v[s.key];
          out.push(s.label + ' is ' + (s.fmt ? s.fmt(raw) : raw));
        }
        var lk = lv.locks || [];
        for (var j = 0; j < lk.length; j++) {
          var who = S.st.locks[lk[j]];
          out.push('lock ' + lk[j] + ' is ' + (who == null ? 'free' : 'held by ' +
            lv.threads[who].name));
        }
        return out.join(', ') + '.';
      }

      function holderOf(t) {
        var lv = level();
        var s = lv.threads[t].steps[S.st.pc[t]];
        if (!s || s.kind !== 'lock') return null;
        var who = S.st.locks[s.lock];
        return who == null ? null : { lock: s.lock, name: lv.threads[who].name };
      }

      function statusOf(t) {
        var lv = level();
        if (S.st.pc[t] >= lv.threads[t].steps.length) return 'finished';
        return runnable(lv, S.st, t) ? 'ready' : 'blocked';
      }

      function labelFor(t) {
        var lv = level();
        var th = lv.threads[t];
        var pc = S.st.pc[t];
        var kind = statusOf(t);
        if (kind === 'finished') {
          return th.name + ', finished. All ' + th.steps.length + ' steps have run.';
        }
        var next = 'Next step ' + (pc + 1) + ' of ' + th.steps.length + ': ' + th.steps[pc].code +
          ', a ' + th.steps[pc].kind + '.';
        if (kind === 'blocked') {
          var h = holderOf(t);
          return th.name + ', blocked waiting for lock ' + (h ? h.lock : '') +
            (h ? ', held by ' + h.name : '') + '. ' + next;
        }
        return th.name + ', ready. ' + next + ' Activate to run it.';
      }

      /* --------------------------------------------------------------
         Rendering. The whole board is rebuilt after every step, which is
         one innerHTML write per click on a page that has nothing else to
         do between clicks. Focus is put back afterwards by index, because
         a keyboard player standing on Thread B must still be standing on
         Thread B after pressing it.
         -------------------------------------------------------------- */
      function chip(label, value, accent) {
        return '<span style="display:inline-flex;align-items:baseline;gap:0.4rem;' +
          'padding:0.3rem 0.55rem;border-radius:8px;background:' + WELL + ';border:1px solid ' +
          LINE + ';margin:0 0.4rem 0.4rem 0;">' +
          '<span style="font-size:0.68rem;letter-spacing:0.05em;text-transform:uppercase;color:' +
          INK4 + ';">' + esc(label) + '</span>' +
          '<span style="font-family:' + MONO + ';font-size:0.82rem;color:' +
          (accent || INK) + ';">' + esc(value) + '</span></span>';
      }

      function sharedHtml() {
        var lv = level();
        var html = '<div style="margin:0 0 0.8rem;">';
        var i;
        for (i = 0; i < lv.shown.length; i++) {
          var s = lv.shown[i];
          var raw = S.st.v[s.key];
          html += chip(s.label, s.fmt ? s.fmt(raw) : raw, INK);
        }
        var lk = lv.locks || [];
        for (i = 0; i < lk.length; i++) {
          var who = S.st.locks[lk[i]];
          html += chip('lock ' + lk[i], who == null ? 'free' : 'held by ' + lv.threads[who].name,
            who == null ? INK : WARN);
        }
        return html + '</div>';
      }

      function columnHtml(t) {
        var lv = level();
        var th = lv.threads[t];
        var pc = S.st.pc[t];
        var kind = statusOf(t);
        var edge = kind === 'blocked' ? WARN : (kind === 'finished' ? LINE : 'var(--accent-1)');
        var html = '<button class="game-btn" type="button" data-th="' + t + '" ' +
          'aria-label="' + esc(labelFor(t)) + '" ' +
          'style="display:block;width:100%;height:auto;text-align:left;white-space:normal;' +
          'padding:0.6rem 0.7rem;line-height:1.4;border-color:' + edge + ';">';

        html += '<span style="display:block;font-size:0.82rem;color:' + INK + ';">' +
          esc(th.name) + '</span>';
        html += '<span style="display:block;font-size:0.66rem;letter-spacing:0.06em;' +
          'text-transform:uppercase;margin:0.1rem 0 0.5rem;color:' +
          (kind === 'blocked' ? WARN : INK4) + ';">' + kind +
          (kind === 'blocked' && holderOf(t) ? ' on ' + esc(holderOf(t).lock) : '') + '</span>';

        for (var i = 0; i < th.steps.length; i++) {
          var mark = i < pc ? '✓' : (i === pc ? '▶' : '·');
          var col = i < pc ? INK4 : (i === pc ? INK : INK3);
          html += '<span style="display:block;font-family:' + MONO + ';font-size:0.71rem;' +
            'color:' + col + ';margin-bottom:0.2rem;">' + mark + ' ' + (i + 1) + '. ' +
            esc(th.steps[i].code) +
            '<span style="color:' + INK4 + ';font-size:0.63rem;"> [' + th.steps[i].kind +
            ']</span></span>';
        }

        if (th.regText) {
          html += '<span style="display:block;margin-top:0.45rem;padding-top:0.4rem;' +
            'border-top:1px solid ' + LINE + ';font-family:' + MONO + ';font-size:0.7rem;' +
            'color:' + INK3 + ';">' + esc(th.regText(S.st.r[t])) + '</span>';
        }
        if (S.hint === t) {
          html += '<span style="display:block;margin-top:0.4rem;font-size:0.68rem;color:' +
            GOOD + ';">Hint: run this one next</span>';
        }
        return html + '</button>';
      }

      function verdictHtml() {
        if (!S.verdict) return '';
        var v = S.verdict;
        var html = '<div style="margin-top:1rem;padding:0.85rem 0.95rem;border-radius:10px;' +
          'background:' + SHEET + ';border:1px solid ' + (v.won ? GOOD : LINE) + ';">' +
          '<p style="margin:0 0 0.45rem;font-size:0.72rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + (v.won ? GOOD : INK4) + ';">' + esc(v.head) +
          '</p>' +
          '<p style="margin:0 0 0.7rem;font-size:0.88rem;line-height:1.65;color:' + INK3 + ';">' +
          v.body + '</p>';
        if (v.counted) {
          html += '<p style="margin:0 0 0.7rem;padding:0.55rem 0.7rem;border-radius:8px;' +
            'background:' + WELL + ';font-size:0.85rem;line-height:1.6;color:' + INK + ';">' +
            v.counted + '</p>';
        }
        if (v.lesson) {
          html += '<p style="margin:0 0 0.9rem;font-size:0.85rem;line-height:1.65;color:' +
            INK3 + ';">' + v.lesson + '</p>';
        }
        html += '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" type="button" data-go>' + esc(v.action) + '</button>';
        if (v.claim) {
          html += '<button class="game-btn" type="button" data-claim>It cannot be done</button>';
        }
        return html + '</div></div>';
      }

      function render() {
        var lv = level();
        var html =
          '<p style="margin:0 0 0.35rem;font-size:0.72rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">Level ' + (S.at + 1) + ' of ' +
          LEVELS.length + ' &middot; ' + esc(lv.tag) + '</p>' +
          '<h3 style="margin:0 0 0.4rem;font-size:1.05rem;color:' + INK + ';">' +
          esc(lv.goal) + '</h3>' +
          '<p style="margin:0 0 0.7rem;font-size:0.88rem;line-height:1.65;color:' + INK3 + ';">' +
          esc(lv.brief) + '</p>';

        if (lv.mistake) {
          html += '<p style="margin:0 0 0.8rem;padding:0.5rem 0.7rem;border-radius:8px;' +
            'background:' + WELL + ';border-left:3px solid ' + WARN + ';font-size:0.82rem;' +
            'line-height:1.6;color:' + INK3 + ';"><strong style="color:' + INK +
            ';">The mistake:</strong> ' + esc(lv.mistake) + '</p>';
        }

        html += sharedHtml();
        html += '<div role="group" aria-label="Threads. Activate one to run its next step." ' +
          'style="display:grid;gap:0.6rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));">';
        for (var i = 0; i < lv.threads.length; i++) html += columnHtml(i);
        html += '</div>';

        html += '<p style="margin:0.7rem 0 0;font-size:0.8rem;line-height:1.6;color:' +
          INK4 + ';">' + esc(S.line) + '</p>';
        html += verdictHtml();

        host.innerHTML = html;
        wire();
      }

      function wire() {
        colBtns = [];
        var nodes = host.querySelectorAll('[data-th]');
        var i;
        for (i = 0; i < nodes.length; i++) {
          (function (node, t) {
            colBtns.push(node);
            node.addEventListener('click', function () { advance(t); });
            node.addEventListener('focus', function () { colIdx = t; });
          })(nodes[i], i);
        }
        if (colIdx >= colBtns.length) colIdx = 0;

        var go = host.querySelector('[data-go]');
        if (go) {
          go.addEventListener('click', function () {
            if (S.verdict && S.verdict.won) nextLevel();
            else { S.solved = false; rerun(); }
          });
          try { go.focus({ preventScroll: true }); } catch (err) { go.focus(); }
        }
        var claim = host.querySelector('[data-claim]');
        if (claim) claim.addEventListener('click', function () { solve(true); });

        /* PUT THE KEYBOARD BACK ON THE COLUMN IT WAS ON. Every step rebuilds
           the board, which destroys the button that was focused — and focus
           then falls to <body>, outside the shell's element, where only its
           last-resort document listener catches anything. A keyboard player
           who had walked to Thread B would find themselves back on Thread A
           after every single press. Only when a step actually happened, and
           only during a run, so the boot-time render cannot steal focus from
           a page the visitor has just opened. */
        if (S.keepFocus && !S.verdict && g.state === 'playing' && colBtns.length) {
          S.keepFocus = false;
          try { colBtns[colIdx].focus({ preventScroll: true }); }
          catch (err2) { colBtns[colIdx].focus(); }
        }
      }

      /* --------------------------------------------------------------
         Playing.
         -------------------------------------------------------------- */
      var TONE = {
        load: 392, add: 440, store: 494, check: 523, call: 587, lock: 311, unlock: 349
      };

      function advance(t) {
        if (g.state !== 'playing' || !S || S.verdict) return;
        var lv = level();
        if (S.st.pc[t] >= lv.threads[t].steps.length) {
          S.line = lv.threads[t].name + ' has finished. Nothing left to run there.';
          g.announce(S.line);
          render();
          return;
        }
        if (!runnable(lv, S.st, t)) {
          var h = holderOf(t);
          S.line = lv.threads[t].name + ' is blocked on lock ' + (h ? h.lock : '') +
            (h ? ', which ' + h.name + ' is holding.' : '.');
          g.noise(0.1, { type: 'lowpass', freq: 220, level: 0.05 });
          g.announce(S.line);
          render();
          return;
        }

        S.history.push(cloneState(S.st));
        S.order.push(t);
        var step = applyStep(lv, S.st, t);
        S.hint = -1;
        S.keepFocus = true;
        g.pluck(TONE[step.kind] || 440, 0.16, 0.045);
        S.line = lv.threads[t].name + ' ran ' + step.code + '. ' + stateSentence();
        g.announce(S.line);

        if (stuck(lv, S.st)) finish();
        else render();
      }

      /* The three toolbar buttons all refuse to act on a level that has
         already been scored. Without this, stepping back out of a solved
         run and reaching the goal a second time would pay for it twice —
         and, worse, would quietly suggest that the score is the point. */
      function locked() {
        if (!S || !S.solved) return false;
        g.announce('This level is already solved. Press Next level to carry on.');
        return true;
      }

      function undo() {
        if (!S || locked()) return;
        if (!S.history.length) {
          g.announce('Nothing to step back to. This run is at its first step.');
          return;
        }
        S.st = S.history.pop();
        S.order.pop();
        S.verdict = null;
        S.hint = -1;
        S.keepFocus = true;
        S.line = 'Stepped back. ' + stateSentence();
        g.announce(S.line);
        render();
      }

      function rerun() {
        if (!S || locked()) return;
        var lv = level();
        S.st = newState(lv);
        S.history = [];
        S.order = [];
        S.verdict = null;
        S.hint = -1;
        S.keepFocus = true;
        S.line = 'Level reset. ' + stateSentence();
        g.announce('Level reset. ' + lv.goal);
        render();
      }

      function hint() {
        if (!S || S.verdict || locked()) return;
        var lv = level();
        S.usedHint = true;
        var t = hintFor(lv, S.st);
        if (t < 0) {
          S.hint = -1;
          S.line = 'From here every remaining ordering gives the right answer. Step back, or ' +
            'run the level again.';
        } else {
          S.hint = t;
          S.line = 'Run ' + lv.threads[t].name + ' next. The bug is still reachable from here.';
        }
        S.keepFocus = true;
        g.announce(S.line);
        render();
      }

      function ordinalCount(n) {
        return (n <= WORDS.length ? WORDS[n - 1] : String(n));
      }

      /* The run has reached a state where nothing can move. Either every
         thread finished, or the survivors are wedged — and the second case
         is the deadlock level's goal rather than an error, which is why it
         is judged here rather than guarded against. */
      function finish() {
        var lv = level();
        var done = allDone(lv, S.st);
        /* The whole ordering, not just the outcome. On the last level the
           two runs a player can make end in the same state and differ only
           in who went first, so a signature taken from the final state
           alone would count both of them as one. */
        S.signatures[S.order.join('/')] = true;
        if (isWin(lv, S.st)) { solve(false); return; }

        S.runs++;
        g.stat('runs', S.runs);
        g.beep(200, 0.12, 'sine', 0.05);

        var body = esc(lv.miss(S.st.v, done));
        var seen = countSignatures();
        if (lv.impossible) {
          body += ' You have now run ' + ordinalCount(seen) + ' of the two orderings this ' +
            'program has.' + (seen >= 2
              ? ' That is all of them. If you think it cannot be done, say so.'
              : ' Run the other one.');
        }
        S.verdict = {
          won: false,
          head: done ? 'A legal ordering, and a correct result' : 'Everything stopped',
          body: body,
          action: 'Run it again',
          claim: !!(lv.impossible && seen >= 2)
        };
        g.announce(S.verdict.head + '. ' + lv.miss(S.st.v, done));
        render();
      }

      function countSignatures() {
        var n = 0, k;
        for (k in S.signatures) {
          if (Object.prototype.hasOwnProperty.call(S.signatures, k)) n++;
        }
        return n;
      }

      /* Solving a level, whether by producing the bug or — on the last one —
         by correctly claiming there is no bug to produce. The ordering count
         is worked out here rather than up front, because it is the payoff
         line and there is no reason to spend the walk on a level nobody has
         reached yet. */
      function solve(byClaim) {
        var lv = level();
        var counts = analyse(lv, null);
        var gain = 100;
        if (byClaim) gain = 150;
        else if (S.runs === 0 && !S.usedHint) gain += 50;
        S.total += gain;
        g.setScore(S.total);
        g.sweep(440, 880, 0.32);

        var pct = counts.total ? Math.round((counts.bug / counts.total) * 1000) / 10 : 0;
        var counted;
        if (counts.capped) {
          counted = 'This program has more orderings than the page will count exhaustively, ' +
            'so no percentage is claimed for it.';
        } else if (counts.bug === 0) {
          counted = 'There are ' + counts.total + ' legal orderings of these steps and ' +
            '<strong>none of them</strong> produce the bug. That is not a small window. ' +
            'There is no window.';
        } else {
          /* The honest reading of this figure, which is not the obvious one.
             A uniform count over interleavings is NOT a failure rate: a real
             scheduler hardly ever preempts inside a short function, so the
             handful of correct orderings are precisely the ones testing keeps
             drawing. Printing "90 per cent" without that sentence would leave
             every player wondering why they had never seen the bug. */
          counted = '<strong>' + counts.bug + ' of the ' + counts.total + '</strong> legal ' +
            'orderings of these steps produce this bug &mdash; ' + pct + ' per cent of them. ' +
            'That is not a failure rate. A real scheduler nearly always runs a short function ' +
            'straight through, so the ' + (counts.total - counts.bug) + ' clean orderings are ' +
            'the ones your tests keep drawing. The bug is not improbable. It is unfairly ' +
            'sampled &mdash; until the machine gets busy.';
        }

        S.verdict = {
          won: true,
          head: byClaim ? 'Correct. It cannot be done.' : 'You produced it',
          body: byClaim
            ? 'There is no interleaving of these two threads that leaves the counter at 1, ' +
              'and you were right to say so.'
            : esc(lv.goal) + ' Done, in ' + S.history.length + ' steps.',
          counted: counted,
          lesson: lv.lesson,
          action: S.at + 1 < LEVELS.length ? 'Next level' : 'Finish',
          claim: false
        };
        S.solved = true;
        g.announce(S.verdict.head + ' ' + (counts.capped ? '' : counts.bug + ' of ' +
          counts.total + ' orderings produce it.') + ' Scored ' + gain + '.');
        render();
      }

      function nextLevel() {
        if (S.at + 1 >= LEVELS.length) {
          g.over({
            won: true,
            score: S.total,
            title: 'All ten',
            message: 'Nine bugs caused on purpose, and one lock you could not break.'
          });
          return;
        }
        S.at++;
        startLevel();
      }

      function startLevel() {
        var lv = prepare(LEVELS[S.at]);
        S.st = newState(lv);
        S.history = [];
        S.order = [];
        S.verdict = null;
        S.solved = false;
        S.usedHint = false;
        S.runs = 0;
        S.signatures = {};
        S.hint = -1;
        S.keepFocus = false;
        colIdx = 0;
        S.line = stateSentence();
        g.stat('level', (S.at + 1) + '/' + LEVELS.length);
        g.stat('runs', 0);
        g.announce('Level ' + (S.at + 1) + ' of ' + LEVELS.length + '. ' + lv.tag + '. ' + lv.goal);
        render();
      }

      if (undoBtn) undoBtn.addEventListener('click', function () { undo(); });
      if (rerunBtn) rerunBtn.addEventListener('click', function () { rerun(); });
      if (hintBtn) hintBtn.addEventListener('click', function () { hint(); });

      /* Move the keyboard between the columns. The shell forwards arrow keys
         from a focused <button> precisely so a grid of buttons can be walked,
         so one handler covers both the case where focus is on the board and
         the case where it is already on a column. Wrapping is right here:
         there are two or three columns, so the far end is never far. */
      function moveFocus(delta) {
        if (!colBtns.length) return;
        var active = document.activeElement;
        var on = -1, i;
        for (i = 0; i < colBtns.length; i++) if (colBtns[i] === active) { on = i; break; }
        colIdx = on < 0 ? (delta > 0 ? 0 : colBtns.length - 1)
                        : (on + delta + colBtns.length) % colBtns.length;
        try { colBtns[colIdx].focus({ preventScroll: true }); }
        catch (err) { colBtns[colIdx].focus(); }
      }

      return {
        reset: function () {
          S = { at: 0, total: 0, st: null, history: [], order: [], verdict: null,
                solved: false, usedHint: false, runs: 0, signatures: {}, hint: -1,
                keepFocus: false, line: '' };
          g.setScore(0);
          startLevel();
        },

        key: function (name) {
          if (!S) return;
          /* While a verdict is up the columns are still on screen but no
             longer do anything, and there is exactly one sensible action.
             Arrows moving focus onto a dead column would be worse than
             nothing. */
          if (S.verdict) {
            if (name !== 'action') return;
            var go = host.querySelector('[data-go]');
            if (go) go.click();
            return;
          }
          if (name === 'left' || name === 'up') { moveFocus(-1); return; }
          if (name === 'right' || name === 'down') { moveFocus(1); return; }
          if (name === 'action' && colBtns.length) advance(colIdx);
        }
      };
    }
  });
})();

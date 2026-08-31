/* ==========================================================================
   overflow-puzzle.js — craft the input, take the return address, four levels.
   --------------------------------------------------------------------------
   /labs/buffer-overflow already exists and it is a sandbox: sliders, a live
   stack, and a copy you can watch spill. This is the other half of the same
   subject — a thing you have to solve. Four small programs on one invented
   machine, each with exactly one mitigation more than the last, and each
   level exists to answer the question "why was this mitigation invented".

   THE MACHINE IS MADE UP AND IS NOT A GENERAL INTERPRETER. There is no x86
   here, no ARM, no real calling convention, and deliberately no payload you
   could ever assemble. What is actually simulated is the part the lesson
   lives in: the frame read_note builds, the copy loop that has no idea how
   big the destination is, the canary check in the epilogue, and the return
   dispatch that reads two cells of memory and jumps wherever they point.
   The listing beside the stack is the source of the routine being simulated;
   the rest of the program is scenery, and it is scenery on purpose. A game
   that taught you a working technique would be a worse game and a worse
   thing to publish.

   RECORDED, THEN REPLAYED, for the same reason guess-the-algorithm does it:
   the whole run is computed the moment you press Send, as a list of events,
   and update() plays that list back one event per tick. It means the copy
   can be watched byte by byte without the simulation being written as a
   state machine, it means the outcome is decided before the animation
   starts so nothing can end differently to what was computed, and it means
   the core is a pure function of (level, process, bytes) that can be
   reasoned about on its own.

   VALUES YOU HAVE NO WAY TO KNOW ARE DRAWN AS "??". The canary is hidden
   until you leak it, and on the ASLR level the two return cells are hidden
   until you write them. Showing them would make the panel a debugger
   attached to a process you own, which is a completely different exercise
   to the one here — the whole of level 2 and level 4 is the gap between
   what is in memory and what you can find out about it.

   THE STYLES ARE INJECTED. Every selector below is meaningless outside this
   one game, and this ships as a module plus a manifest entry with no
   stylesheet edit in between. The CSP allows 'unsafe-inline' for style and
   forbids it for script, which is why this is a <style> node and nothing
   here is built from a string and run. Every rule is scoped under the game
   root id so the rest of /games is left alone.

   ES5 throughout, no network, no storage beyond the shell's own best score.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     Geometry. One flat memory of 32 cells, each holding 0..255. The stack
     grows down, so the frame sits at the top of it and the copy climbs.
     ------------------------------------------------------------------ */
  var MEMSIZE = 32;
  /* THE STACK HAS A PAGE OF ITS OWN, and that is not decoration.
     The first draft put the 32 cells at 0x0000, which made every stack
     address one whose high half is 0x00 — and the copy stops dead at a zero
     byte, so a return address pointing into the buffer could not be written
     at all. Level 3 asks you to try exactly that and watch the no-execute
     fault, so the level was unplayable. Giving the stack its own page fixes
     it and is the more honest picture anyway: everything in a real address
     space is on a page somewhere. The constraint that bit me is real, mind —
     a stack address with a zero byte in it is a genuine obstacle for a string
     copy, and the level 3 note says so. */
  var STACK = 0x0100;      // the page the 32 cells live on
  var CODE = 0x0200;       // where the program is loaded when nothing randomises it
  var BUF = 0x0C;          // buf[0]
  var BUFLEN = 8;          // and the copy has no idea about this number
  var CANARY = 0x14;       // padding on level 1, the canary from level 2 on
  var FPCELL = 0x15;       // saved frame pointer
  var RETLO = 0x16;        // return address, low half
  var RETHI = 0x17;        // return address, high half
  var CHAINLO = 0x18;      // the caller's frame — and level 3's second slot
  var CHAINHI = 0x19;
  var VIEW_FROM = 0x0A;
  var VIEW_TO = 0x1B;
  var LEAK_MAX = 12;       // show_note gives up after this many cells
  var STEP_EVERY = 0.075;  // seconds per replayed event
  var MAXLOG = 240;
  var KEYVAL = 0x2A;       // what open_door wants in r1
  var RET_INTO_MAIN = 0x08; // low half of the address CALL read_note pushed

  function hx(n, width) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < width) s = '0' + s;
    return s;
  }
  function addr8(n) { return '0x' + hx(n, 2); }
  /* Cell index to the address the machine would call it. Everything the
     player reads is the second one; everything the arrays are indexed by is
     the first, and mixing them up is how the first draft got level 3 wrong. */
  function memAt(cell) { return '0x' + hx(STACK + cell, 4); }
  function addr16(n) { return '0x' + hx(n, 4); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /* Printable ASCII only. A control byte drawn as a glyph would be a lie
     about what the cell holds, and a lie in the one column a player uses to
     check their own arithmetic. */
  function chrOf(v) {
    return (v >= 0x20 && v <= 0x7E) ? String.fromCharCode(v) : '.';
  }

  /* ==================================================================
     The four programs.
     ------------------------------------------------------------------
     The "code" field is the listing, as rows of [offset|null, label|null, text,
     comment|null]. A row with a label becomes a button that appends that
     address to the payload, because typing 0x34 0x02 on a phone is not the
     part of this anybody needs to practise.

     "entries" maps a code offset to what happens if the machine is made to
     start there. Anything not in it is not an entry point and faults, which
     is the honest answer for a machine that only ever begins a routine at
     its first instruction.
     ================================================================== */

  var COMMON_HEAD = [
    [null, null, '; a note server. it loops, so you get more than one go at it.', null],
    [0x00, 'main', 'SAY   "ready"', null],
    [0x02, 'again', 'TAKE  cmd', null],
    [0x03, null, 'SAME  cmd, 1', null],
    [0x04, null, 'JNE   showit', null],
    [0x06, null, 'CALL  read_note', 'pushes the address of the next line'],
    [0x08, null, 'SAY   "note saved"', null],
    [0x09, null, 'JMP   again', null],
    [0x0B, 'showit', 'CALL  show_note', null],
    [0x0D, null, 'JMP   again', null],
    [null, null, '', null]
  ];

  var COPY_PLAIN = [
    [0x10, 'read_note', 'SET   p, 0x010C', 'p = &buf, and buf is 8 cells'],
    [0x12, 'copy', 'TAKE  c', 'the next byte of your message'],
    [0x13, null, 'JZ    c, done', 'a zero byte ends the message'],
    [0x15, null, 'PUT   [p], c', 'nothing on this line looks at p'],
    [0x16, null, 'ADD   p, 1', null],
    [0x17, null, 'JMP   copy', null],
    [0x19, 'done', 'RET', 'reads 0x0116 and 0x0117, jumps there'],
    [null, null, '', null]
  ];

  var COPY_CANARY = [
    [0x10, 'read_note', 'PUT   [0x0114], k', 'k is this process’s canary'],
    [0x12, null, 'SET   p, 0x010C', 'p = &buf, and buf is still 8 cells'],
    [0x14, 'copy', 'TAKE  c', null],
    [0x15, null, 'JZ    c, done', null],
    [0x17, null, 'PUT   [p], c', 'and still nothing looks at p'],
    [0x18, null, 'ADD   p, 1', null],
    [0x19, null, 'JMP   copy', null],
    [0x1B, 'done', 'GET   c, [0x0114]', 'the canary, as it stands now'],
    [0x1D, null, 'SAME  c, k', null],
    [0x1E, null, 'JNE   abort', null],
    [0x20, null, 'RET', 'reads 0x0116 and 0x0117, jumps there'],
    [0x21, 'abort', 'SAY   "*** stack smashing detected ***"', null],
    [0x23, null, 'HALT', null],
    [null, null, '', null]
  ];

  function showNote(base) {
    return [
      [base, 'show_note', 'SET   p, 0x010C', null],
      [base + 2, 'more', 'GET   c, [p]', null],
      [base + 3, null, 'JZ    c, out', 'stops at a zero, not at the end of buf'],
      [base + 5, null, 'SAY   c', null],
      [base + 6, null, 'ADD   p, 1', null],
      [base + 7, null, 'JMP   more', null],
      [base + 9, 'out', 'RET', null],
      [null, null, '', null]
    ];
  }

  var WIN_FN = [
    [0x34, 'win', 'SAY   "the door is open"', null],
    [0x36, null, 'HALT', null]
  ];

  var GADGETS = [
    [0x40, 'set_key', 'SET   r1, 0x2A', null],
    [0x42, null, 'RET', 'pops the NEXT two cells and jumps there'],
    [null, null, '', null],
    [0x50, 'open_door', 'SAME  r1, 0x2A', null],
    [0x52, null, 'JNE   deny', null],
    [0x54, null, 'SAY   "the door is open"', null],
    [0x56, null, 'HALT', null],
    [0x57, 'deny', 'SAY   "wrong key in r1. denied."', null],
    [0x59, null, 'HALT', null]
  ];

  function join(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      for (var j = 0; j < parts[i].length; j++) out.push(parts[i][j]);
    }
    return out;
  }

  var CLOSER = 'None of that is the defence. The defence is a copy that knows how big the ' +
    'destination is and honours it, or a language where the length travels with the array and the ' +
    'copy cannot run off the end at all. Everything on this page is a mitigation: it raises the ' +
    'price of turning the bug into control of the machine, and it removes no bugs. The ' +
    'out-of-bounds write is still sitting in all four of these programs, exactly where it was.';

  var LEVELS = [
    {
      name: 'Take the wheel',
      mit: 'none',
      canary: false, nx: false, aslr: false,
      fp: 0x18,
      goal: 'win',
      points: 200,
      code: join([COMMON_HEAD, COPY_PLAIN, showNote(0x20), WIN_FN]),
      entries: { 0x08: 'main', 0x34: 'win' },
      spans: [[0x00, 0x0E, 'main'], [0x10, 0x1A, 'read_note'], [0x20, 0x2A, 'show_note'], [0x34, 0x37, 'win']],
      brief: 'The buffer is eight cells at 0x010C and the copy loop has nothing in it that knows that. ' +
        'Walk your message off the end of it, over the padding byte and the saved frame pointer, and ' +
        'put the address of <code>win</code> into the two cells that <code>RET</code> reads. The low ' +
        'half goes in first, because the low half lives at the lower address and the copy is climbing.',
      hints: [
        'buf starts at 0x010C and holds eight cells. RET reads 0x0116 and then 0x0117. Count the distance from one to the other.',
        'Ten bytes of anything at all get you from 0x010C to the end of 0x0115. The eleventh and twelfth bytes are the address.',
        'win sits at 0x0234. Low half first, so 0x34 then 0x02. The whole payload is: A*10 0x34 0x02'
      ],
      debrief: 'That is the entire bug, and it has been the same bug since the 1980s. The return ' +
        'address is not special to the machine: it is two cells of ordinary writable memory that ' +
        'happen to sit a fixed distance above an array, and the instruction that reads them cannot ' +
        'tell the difference between the address the CALL pushed and the address you typed. ' + CLOSER
    },
    {
      name: 'The canary',
      mit: 'canary',
      canary: true, nx: false, aslr: false,
      fp: 0x18,
      goal: 'win',
      points: 200,
      code: join([COMMON_HEAD, COPY_CANARY, showNote(0x28), WIN_FN]),
      entries: { 0x08: 'main', 0x34: 'win' },
      spans: [[0x00, 0x0E, 'main'], [0x10, 0x24, 'read_note'], [0x28, 0x32, 'show_note'], [0x34, 0x37, 'win']],
      brief: 'The compiler now plants a random value at 0x0114 on the way in and checks it on the way ' +
        'out, so last level’s payload aborts before it can return. The canary is chosen once per ' +
        'process, not once per call, which is the whole opening: <code>show_note</code> prints from ' +
        'buf until it meets a zero byte, and it has no idea where buf ends either. Fill the buffer ' +
        'with a send, read the canary out with a show, then write it back where it belongs.',
      hints: [
        'The canary is only unknown until something prints it. show_note walks up from 0x010C and stops at the first zero — so a buffer with no zero in it does not stop it at 0x0113.',
        'Send A*8 first. That fills buf without touching the canary, so nothing aborts. Then press Show the note and read the ninth byte it prints.',
        'With the canary in hand: A*8 0x<canary> A 0x34 0x02 — eight of filler, the canary put back exactly, one byte over the saved frame pointer, then the address.'
      ],
      debrief: 'A canary is a tripwire, not a wall. It did not stop the write and it never could: by ' +
        'the time the check runs, the return address has already been overwritten. What it stops is ' +
        'the <em>return</em>, and only when the overflow is contiguous and the value is unknown. Take ' +
        'either of those away — an over-read that prints it, a write that skips over it, a fork ' +
        'server that keeps the same value across a thousand crashes — and the tripwire is a formality. ' +
        'Real canaries usually carry a zero byte on purpose, precisely so that a string copy cannot ' +
        'write one back and a string print cannot read one out; this one does not, which is what ' +
        'made the level solvable. ' + CLOSER
    },
    {
      name: 'No-execute',
      mit: 'canary + NX',
      canary: true, nx: true, aslr: false,
      fp: 0x18,
      goal: 'door',
      points: 200,
      code: join([COMMON_HEAD, COPY_CANARY, showNote(0x28), GADGETS]),
      entries: { 0x08: 'main', 0x40: 'set_key', 0x50: 'open_door' },
      spans: [[0x00, 0x0E, 'main'], [0x10, 0x24, 'read_note'], [0x28, 0x32, 'show_note'],
        [0x40, 0x43, 'set_key'], [0x50, 0x5A, 'open_door']],
      brief: 'The stack is now marked no-execute, so the old move — put your own instructions in the ' +
        'buffer and return into it — faults before a single one of them runs. Point the return ' +
        'address at 0x010C and watch it happen; it is worth seeing once. Then use code that is ' +
        'already here. <code>open_door</code> wants 0x2A in r1 and there is nothing in this program ' +
        'that calls it, but <code>set_key</code> ends in a RET, and a RET takes its address off the ' +
        'stack — the stack you are writing.',
      hints: [
        'Try returning into the buffer first, at 0x010C. Read what the fault says, then come back. Returning straight to open_door is the next thing to try, and it will tell you what is missing.',
        'set_key at 0x0240 puts 0x2A into r1 and then returns. Returning is not going back anywhere in particular — it is reading two cells off the top of the stack and jumping there. After read_note returns, the top of the stack is 0x0118.',
        'Two addresses, one after the other, is a chain: A*8 0x<canary> A 0x40 0x02 0x50 0x02 — the first pair sends you to set_key, and set_key’s own RET picks up the second pair.'
      ],
      debrief: 'That is return-oriented programming in miniature, and the miniature is not a ' +
        'caricature. A real chain is the same idea with more links: short runs of existing ' +
        'instructions that each end in a return, threaded together by a list of addresses written ' +
        'into the stack, so that nothing anywhere executes a byte the attacker supplied. NX made ' +
        'injected code useless and it did not make exploitation impossible; it changed what an ' +
        'exploit is made of. Control-flow integrity and shadow stacks are the answer aimed at this ' +
        'specific move, and they are answers with their own bypasses. One thing this level makes ' +
        'easier than life: the stack page here is 0x0100, so the address of the buffer has no zero ' +
        'byte in it. Plenty of real stack addresses do, and a copy that stops at a zero cannot carry ' +
        'one — which has decided more than one exploit on its own. ' + CLOSER
    },
    {
      name: 'Randomised addresses',
      mit: 'canary + NX + ASLR',
      canary: true, nx: true, aslr: true,
      fp: 0x00,
      goal: 'win',
      points: 400,
      code: join([COMMON_HEAD, COPY_CANARY, showNote(0x28), WIN_FN]),
      entries: { 0x08: 'main', 0x34: 'win' },
      spans: [[0x00, 0x0E, 'main'], [0x10, 0x24, 'read_note'], [0x28, 0x32, 'show_note'], [0x34, 0x37, 'win']],
      brief: 'The code is loaded at a fresh base every time the process starts, so every address you ' +
        'have typed so far is now a guess with one chance in twelve. The listing shows offsets from ' +
        'a base you are not told, and the two return cells are drawn as ?? until you write them, ' +
        'because you genuinely have no way to read them: <code>main</code> is the outermost frame in ' +
        'this build, its saved frame pointer is zero, and show_note stops dead at a zero byte. So the ' +
        'leak hands you the canary and nothing above it. The base is a whole multiple of 0x100, and the ' +
        'stack has not moved — a real randomisation moves the stack, the heap and every library as ' +
        'well, and only the code is randomised here so that one idea is being tested at a time.',
      hints: [
        'You still need the canary, and the leak still gives it to you. What the leak will not give you is anything above 0x0115, because 0x0115 holds a zero and show_note stops there.',
        'The base is a multiple of 0x100, so every routine in this program shares the same high half — including the return address main pushed, which is still sitting in 0x0117 where you have not touched it.',
        'Write the low half and stop: A*8 0x<canary> A 0x34 — eleven bytes. 0x0117 keeps the high half it already had, and that half is correct by definition. You never learn the base and you never need to.'
      ],
      debrief: 'A partial overwrite is a real technique and this is really how it works: randomise ' +
        'the base in units of a page and the bytes below that unit are not random at all, so the ' +
        'half of the pointer you leave alone stays true. The other route in the field is an ' +
        'information leak that spills any code pointer at all, from which the base is one subtraction ' +
        'away — this program has one leak and a zero byte in the way of it, which is why the short ' +
        'payload is the only way in. And the reason brute force is not a third route: this process ' +
        're-randomises when it restarts. Services that fork without re-randomising have been guessed ' +
        'a byte at a time, which is a fact about the service and not about ASLR. ' + CLOSER
    }
  ];

  /* ==================================================================
     The pure core: parse a payload, and run one request against a
     process. No DOM in any of it, so the outcome of a level is a fact
     about arithmetic rather than about what the panel happens to draw.
     ================================================================== */

  /* Returns the bytes a token stands for, or a complaint about it. Anything
     that is not a number and not quoted is literal text, one byte per
     character — which is what a player typing AAAAAAAA means and expects.
     The two special cases exist because the fallback is otherwise too
     forgiving to be honest: 0xZZ and 1000 both LOOK like numbers, and
     silently turning them into four bytes of text is a trap rather than a
     convenience. */
  function unitOf(t) {
    var m;
    if (/^0[xX]/.test(t)) {
      m = /^0[xX]([0-9a-fA-F]{1,2})$/.exec(t);
      return m ? [parseInt(m[1], 16)] : { bad: '"' + t + '" is not a hex byte. A hex byte is 0x00 through 0xFF.' };
    }
    if (/^\d+$/.test(t)) {
      var n = Number(t);
      return n <= 255 ? [n] : { bad: t + ' does not fit in a byte. A cell here holds 0 to 255.' };
    }
    var quoted = /^"([\s\S]*)"$/.exec(t) || /^'([\s\S]*)'$/.exec(t);
    var body = quoted ? quoted[1] : t;
    var bytes = [];
    for (var i = 0; i < body.length; i++) {
      var c = body.charCodeAt(i);
      if (c > 255) {
        return { bad: '"' + body.charAt(i) + '" is not a byte. This machine holds 0 to 255 in a cell, ' +
          'so only plain Latin-1 characters go in one.' };
      }
      bytes.push(c);
    }
    if (!bytes.length && !quoted) return null;
    return bytes;
  }

  function parsePayload(text) {
    var toks = String(text == null ? '' : text).replace(/,/g, ' ').split(/\s+/);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (!t) continue;
      var times = 1;
      var rep = /^([\s\S]+)\*(\d+)$/.exec(t);
      if (rep) { t = rep[1]; times = Number(rep[2]); }
      if (times > 48) {
        return { ok: false, error: 'A repeat count of ' + times + ' is more than this machine has room for.' };
      }
      var unit = unitOf(t);
      if (unit && unit.bad) return { ok: false, error: unit.bad };
      if (!unit) {
        return {
          ok: false,
          error: 'I cannot read "' + t + '". A token is a hex byte like 0x41, a number from 0 to 255, ' +
            'some plain text, or text in quotes — and any of those with *n after it to repeat.'
        };
      }
      for (var r = 0; r < times; r++) {
        for (var q = 0; q < unit.length; q++) out.push(unit[q]);
      }
      if (out.length > 48) {
        return { ok: false, error: 'More than 48 bytes. This machine has 32 cells in total, so that is not going anywhere useful.' };
      }
    }
    return { ok: true, bytes: out };
  }

  /* Where does the last byte of this payload land, and does the copy even
     get there? Drawn under the field as you type, because a player counting
     cells by eye is doing arithmetic the machine is better at, and the
     interesting part of this game is not the arithmetic. */
  function landing(level, bytes) {
    var n = bytes.length;
    var stoppedAt = -1;
    for (var i = 0; i < n; i++) {
      if (bytes[i] === 0) { stoppedAt = i; n = i; break; }
    }
    return { n: n, last: n ? BUF + n - 1 : -1, stoppedAt: stoppedAt };
  }

  function tagOf(level, a) {
    if (a >= BUF && a < BUF + BUFLEN) return 'buf[' + (a - BUF) + ']';
    if (a === CANARY) return level.canary ? 'canary' : 'padding';
    if (a === FPCELL) return 'saved fp';
    if (a === RETLO) return 'ret lo';
    if (a === RETHI) return 'ret hi';
    if (a > RETHI) return 'caller’s frame';
    return 'stack, below buf';
  }

  function kindOf(a) {
    if (a >= BUF && a < BUF + BUFLEN) return 'buf';
    if (a === CANARY) return 'canary';
    if (a === FPCELL) return 'fp';
    if (a === RETLO || a === RETHI) return 'ret';
    if (a > RETHI) return 'caller';
    return 'below';
  }

  function spanAt(level, off) {
    for (var i = 0; i < level.spans.length; i++) {
      if (off >= level.spans[i][0] && off <= level.spans[i][1]) return level.spans[i][2];
    }
    return null;
  }

  function newProcess(level, rnd) {
    var mem = [];
    var known = [];
    for (var i = 0; i < MEMSIZE; i++) { mem.push(0); known.push(true); }
    var base = level.aslr ? ((3 + rnd(12)) << 8) : CODE;
    var proc = {
      base: base,
      canary: 1 + rnd(255),      // never zero here, and the debrief says why that matters
      mem: mem,
      known: known,
      dead: false,
      leaked: false
    };
    applyFrame(level, proc);
    return proc;
  }

  /* The prologue, as it stands the instant read_note is entered. Run on
     every request, because a call rebuilds its own frame — which is exactly
     why the canary is re-planted each time and the buffer is not cleared. */
  function applyFrame(level, proc) {
    if (level.canary) { proc.mem[CANARY] = proc.canary; proc.known[CANARY] = false; }
    proc.mem[FPCELL] = level.fp;
    proc.known[FPCELL] = true;
    proc.mem[RETLO] = RET_INTO_MAIN;
    proc.mem[RETHI] = proc.base >> 8;
    proc.known[RETLO] = !level.aslr;
    proc.known[RETHI] = !level.aslr;
  }

  /* ------------------------------------------------------------------
     One request, computed end to end as a list of events. Every event
     either mutates memory, writes a console line, or both; nothing else
     in this file changes the machine's state.
     ------------------------------------------------------------------ */
  function dispatch(level, proc, mem, target, sp, regs, ev, depth) {
    if (depth > 4) {
      ev.push({ t: 'note', text: 'The chain is longer than this machine will follow. Stopping here.', cls: 'bad' });
      ev.push({ t: 'end', outcome: 'fault' });
      return;
    }

    if ((target & 0xFF00) === STACK) {
      if (level.nx) {
        ev.push({
          t: 'nx', addr: target,
          text: 'no-execute fault at ' + addr16(target) + '. That address is on the stack page, the stack ' +
            'is marked rw- on this level, and the machine never even looked at what is there.'
        });
        ev.push({ t: 'end', outcome: 'fault' });
        return;
      }
      var cell = target - STACK;
      if (cell >= MEMSIZE) {
        ev.push({
          t: 'unmapped', addr: target,
          text: 'the stack page holds ' + MEMSIZE + ' cells and ' + addr16(target) + ' is past the end of them.'
        });
        ev.push({ t: 'end', outcome: 'fault' });
        return;
      }
      var op = mem[cell];
      ev.push({
        t: 'opcode', addr: target,
        text: 'entered the stack at ' + addr16(target) + '. The stack is executable on this level, so the ' +
          'machine started decoding your bytes as instructions — and there is no opcode ' + addr8(op) +
          ' on this machine, so it faults here. In 1996 that byte would have been the start of a program.'
      });
      ev.push({ t: 'end', outcome: 'fault' });
      return;
    }

    if ((target & 0xFF00) !== proc.base) {
      ev.push({
        t: 'unmapped', addr: target,
        text: 'nothing is mapped at ' + addr16(target) + '. The code is not where you thought it was.'
      });
      ev.push({ t: 'end', outcome: 'fault' });
      return;
    }

    var off = target & 0xFF;
    var entry = Object.prototype.hasOwnProperty.call(level.entries, off) ? level.entries[off] : null;
    if (!entry) {
      var inside = spanAt(level, off);
      ev.push({
        t: 'unmapped', addr: target,
        text: inside
          ? addr16(target) + ' is in the middle of ' + inside + '. This machine only starts a routine at its first instruction.'
          : 'nothing is mapped at ' + addr16(target) + '.'
      });
      ev.push({ t: 'end', outcome: 'fault' });
      return;
    }

    if (entry === 'main') {
      ev.push({ t: 'say', text: 'note saved' });
      ev.push({ t: 'note', text: 'read_note returned where it was supposed to. The server is still running.', cls: 'dim' });
      ev.push({ t: 'end', outcome: 'return' });
      return;
    }

    if (entry === 'win') {
      ev.push({ t: 'say', text: 'the door is open' });
      ev.push({ t: 'end', outcome: 'win' });
      return;
    }

    if (entry === 'set_key') {
      regs.r1 = KEYVAL;
      ev.push({ t: 'note', text: 'set_key: r1 = ' + addr8(KEYVAL) + ', then RET.', cls: 'ok' });
      if (sp + 1 >= MEMSIZE) {
        ev.push({ t: 'note', text: 'RET went looking above the top of memory. Nothing there.', cls: 'bad' });
        ev.push({ t: 'end', outcome: 'fault' });
        return;
      }
      ev.push({ t: 'read', addr: sp, val: mem[sp], hold: 2 });
      ev.push({ t: 'read', addr: sp + 1, val: mem[sp + 1], hold: 2 });
      var next = mem[sp] | (mem[sp + 1] << 8);
      ev.push({ t: 'jump', addr: next, from: 'set_key' });
      dispatch(level, proc, mem, next, sp + 2, regs, ev, depth + 1);
      return;
    }

    if (entry === 'open_door') {
      if (regs.r1 === KEYVAL) {
        ev.push({ t: 'say', text: 'the door is open' });
        ev.push({ t: 'end', outcome: 'win' });
      } else {
        ev.push({
          t: 'note',
          text: 'open_door: r1 holds ' + addr8(regs.r1) + ' and it wants ' + addr8(KEYVAL) + '. Denied, and the process halts.',
          cls: 'bad'
        });
        ev.push({ t: 'end', outcome: 'fault' });
      }
      return;
    }

    ev.push({ t: 'unmapped', addr: target, text: 'nothing is mapped at ' + addr16(target) + '.' });
    ev.push({ t: 'end', outcome: 'fault' });
  }

  function runNote(level, proc, bytes) {
    var ev = [];
    var mem = proc.mem.slice();
    var i;

    ev.push({ t: 'call', text: 'main: CALL read_note' });
    if (level.canary) {
      mem[CANARY] = proc.canary;
      ev.push({ t: 'plant', addr: CANARY, val: proc.canary });
    }
    mem[FPCELL] = level.fp;
    mem[RETLO] = RET_INTO_MAIN;
    mem[RETHI] = proc.base >> 8;
    ev.push({ t: 'frame' });

    var addr = BUF;
    var wrote = 0;
    for (i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) {
        ev.push({ t: 'note', text: 'byte ' + (i + 1) + ' of the message is zero, so the copy stops. It does not write it.', cls: 'dim' });
        break;
      }
      if (addr >= MEMSIZE) {
        ev.push({
          t: 'oom', addr: addr,
          text: 'the copy walked past ' + memAt(MEMSIZE - 1) + ', the last cell this machine has. On a real ' +
            'one that is an unmapped page and a segmentation fault, which is how the overwhelming majority ' +
            'of these bugs end: a crash, not a takeover.'
        });
        ev.push({ t: 'end', outcome: 'fault' });
        return ev;
      }
      mem[addr] = bytes[i];
      ev.push({ t: 'write', addr: addr, val: bytes[i] });
      addr++;
      wrote++;
    }
    ev.push({ t: 'copied', n: wrote, last: wrote ? BUF + wrote - 1 : -1 });

    if (level.canary) {
      ev.push({ t: 'check', got: mem[CANARY], want: proc.canary, hold: 2 });
      if (mem[CANARY] !== proc.canary) {
        ev.push({
          t: 'abort',
          text: '*** stack smashing detected *** — ' + memAt(CANARY) + ' holds ' + addr8(mem[CANARY]) + ' and the process ' +
            'planted ' + addr8(proc.canary) + '. Aborting before the return.'
        });
        ev.push({ t: 'end', outcome: 'abort' });
        return ev;
      }
    }

    ev.push({ t: 'read', addr: RETLO, val: mem[RETLO], hold: 3 });
    ev.push({ t: 'read', addr: RETHI, val: mem[RETHI], hold: 3, unknown: !proc.known[RETHI] });
    var target = mem[RETLO] | (mem[RETHI] << 8);
    ev.push({ t: 'jump', addr: target, from: 'read_note', unknown: !proc.known[RETHI] });
    dispatch(level, proc, mem, target, CHAINLO, { r1: 0 }, ev, 0);
    return ev;
  }

  function runShow(level, proc) {
    var ev = [{ t: 'call', text: 'main: CALL show_note' }];
    var cells = [];
    var stop = -1;
    for (var i = 0; i < LEAK_MAX; i++) {
      var a = BUF + i;
      if (a >= MEMSIZE) break;
      if (proc.mem[a] === 0) { stop = a; break; }
      cells.push({ addr: a, val: proc.mem[a] });
    }
    ev.push({ t: 'leak', cells: cells, stop: stop });
    ev.push({ t: 'end', outcome: 'return' });
    return ev;
  }

  /* ==================================================================
     Styles. Scoped under the game root, tokens borrowed from the site so
     the panel follows the theme rather than fighting it.
     ================================================================== */
  var ROOT = '#game-overflow-puzzle ';
  var MONO = '\'Cascadia Code\', Consolas, monospace';
  var CSS = [
    ROOT + '.board-ovf{display:block;width:100%;max-width:66rem;text-align:left;}',
    ROOT + '.ovf-head{margin-bottom:0.9rem;}',
    ROOT + '.ovf-title{margin:0 0 0.4rem;font-size:1.05rem;color:var(--ink);}',
    ROOT + '.ovf-brief{margin:0 0 0.5rem;font-size:0.88rem;line-height:1.65;color:var(--ink-3);}',
    ROOT + '.ovf-brief code{font-family:' + MONO + ';font-size:0.84rem;color:var(--accent-1);}',
    ROOT + '.ovf-chips{display:flex;flex-wrap:wrap;gap:0.35rem;margin:0;padding:0;list-style:none;}',
    ROOT + '.ovf-chip{font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;padding:0.2rem 0.5rem;' +
      'border-radius:999px;border:1px solid rgb(var(--line-rgb) / 0.4);color:var(--ink-4);}',
    ROOT + '.ovf-chip.is-on{color:var(--ink);border-color:var(--accent-2);background:rgb(var(--accent-rgb) / 0.16);}',

    ROOT + '.ovf-main{display:grid;grid-template-columns:minmax(0,17rem) minmax(0,1fr);gap:1rem;align-items:start;}',
    ROOT + '.ovf-pane{min-width:0;padding:0.7rem 0.75rem;background:rgb(var(--well-rgb) / 0.55);' +
      'border:1px solid rgb(var(--line-rgb) / 0.24);border-radius:10px;}',
    ROOT + '.ovf-pane-h{margin:0 0 0.5rem;font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-4);}',
    ROOT + '.ovf-pane-h span{text-transform:none;letter-spacing:0;color:var(--ink-4);}',

    ROOT + '.ovf-stack{display:flex;flex-direction:column;gap:2px;}',
    ROOT + '.ovf-row{display:grid;grid-template-columns:3.7rem 2.1rem 1.1rem minmax(0,1fr);align-items:center;gap:0.35rem;' +
      'padding:0.16rem 0.3rem;border-radius:5px;border:1px solid transparent;background:rgb(var(--sheet-rgb) / 0.4);}',
    ROOT + '.ovf-row span{font-family:' + MONO + ';font-size:0.72rem;line-height:1.5;}',
    ROOT + '.ovf-addr{color:var(--ink-4);}',
    ROOT + '.ovf-val{color:var(--ink-2);font-variant-numeric:tabular-nums;}',
    ROOT + '.ovf-chr{color:var(--ink-4);}',
    ROOT + '.ovf-tag{color:var(--ink-4);font-family:inherit !important;font-size:0.7rem !important;}',
    ROOT + '.ovf-row.k-buf .ovf-tag{color:var(--ink-3);}',
    ROOT + '.ovf-row.k-buf{border-left:3px solid rgb(var(--accent-rgb) / 0.55);}',
    ROOT + '.ovf-row.k-canary{border-left:3px solid #fbbf24;}',
    ROOT + '.ovf-row.k-fp{border-left:3px solid rgb(var(--line-rgb) / 0.8);}',
    ROOT + '.ovf-row.k-ret{border-left:3px solid #f87171;}',
    ROOT + '.ovf-row.k-caller{border-left:3px solid rgb(var(--line-rgb) / 0.5);}',
    ROOT + '.ovf-row.k-below{opacity:0.55;}',
    ROOT + '.ovf-row.is-hit{border-color:var(--accent-2);background:rgb(var(--accent-rgb) / 0.24);}',
    ROOT + '.ovf-row.is-hit .ovf-val{color:var(--ink);font-weight:700;}',
    ROOT + '.ovf-row.is-read{border-color:#f87171;background:rgba(248,113,113,0.18);}',
    ROOT + '.ovf-row.is-read .ovf-val{color:#fca5a5;font-weight:700;}',
    ROOT + '.ovf-row.is-bad{border-color:#f87171;background:rgba(248,113,113,0.12);}',
    ROOT + '.ovf-row.is-hidden .ovf-val{color:var(--ink-4);}',
    ROOT + '.ovf-legend{margin:0.6rem 0 0;font-size:0.72rem;line-height:1.6;color:var(--ink-4);}',

    ROOT + '.ovf-code{max-height:26rem;overflow:auto;margin:0;display:flex;flex-direction:column;gap:1px;}',
    ROOT + '.ovf-line{display:grid;grid-template-columns:5.4rem 6.2rem minmax(0,1fr);gap:0.4rem;align-items:baseline;' +
      'width:100%;text-align:left;padding:0.12rem 0.3rem;border-radius:5px;border:1px solid transparent;' +
      'background:none;font-family:' + MONO + ';font-size:0.74rem;line-height:1.6;color:var(--ink-2);}',
    ROOT + 'button.ovf-line{cursor:pointer;}',
    ROOT + 'button.ovf-line:hover{background:rgb(var(--accent-rgb) / 0.14);border-color:rgb(var(--accent-rgb) / 0.5);}',
    ROOT + 'button.ovf-line:focus-visible{outline:2px solid var(--accent-2);outline-offset:1px;}',
    ROOT + '.ovf-off{color:var(--ink-4);white-space:nowrap;}',
    ROOT + '.ovf-lbl{color:var(--accent-1);white-space:nowrap;}',
    ROOT + '.ovf-ins{color:var(--ink-2);white-space:pre-wrap;overflow-wrap:anywhere;}',
    ROOT + '.ovf-line.is-comment .ovf-ins{color:var(--ink-4);}',
    ROOT + '.ovf-cmt{color:var(--ink-4);}',

    ROOT + '.ovf-form{margin-top:1rem;padding:0.75rem 0.8rem;background:rgb(var(--well-rgb) / 0.55);' +
      'border:1px solid rgb(var(--line-rgb) / 0.24);border-radius:10px;}',
    ROOT + '.ovf-label{display:block;margin-bottom:0.35rem;font-size:0.68rem;letter-spacing:0.08em;' +
      'text-transform:uppercase;color:var(--ink-4);}',
    ROOT + '.ovf-input{display:block;width:100%;font-family:' + MONO + ';font-size:0.9rem;padding:0.55rem 0.7rem;' +
      'color:var(--ink);background:rgb(var(--sheet-rgb) / 0.85);border:1px solid rgb(var(--line-rgb) / 0.4);border-radius:8px;}',
    ROOT + '.ovf-input:focus-visible{outline:2px solid var(--accent-2);outline-offset:1px;}',
    ROOT + '.ovf-preview{margin:0.45rem 0 0.6rem;min-height:2.4em;font-size:0.8rem;line-height:1.5;color:var(--ink-3);}',
    ROOT + '.ovf-preview.is-bad{color:#fca5a5;}',
    ROOT + '.ovf-btns{display:flex;flex-wrap:wrap;gap:0.4rem;}',

    ROOT + '.ovf-log{margin-top:1rem;max-height:15rem;overflow:auto;padding:0.6rem 0.7rem;' +
      'background:rgb(var(--well-rgb) / 0.8);border:1px solid rgb(var(--line-rgb) / 0.24);border-radius:10px;' +
      'font-family:' + MONO + ';font-size:0.76rem;line-height:1.65;}',
    ROOT + '.ovf-l{margin:0;color:var(--ink-2);white-space:pre-wrap;overflow-wrap:anywhere;}',
    ROOT + '.ovf-l.dim{color:var(--ink-4);}',
    ROOT + '.ovf-l.ok{color:#86efac;}',
    ROOT + '.ovf-l.bad{color:#fca5a5;}',
    ROOT + '.ovf-l.hit{color:var(--accent-1);}',
    ROOT + '.ovf-l.you{color:var(--ink-3);}',

    ROOT + '.ovf-status{margin:0.6rem 0 0;font-size:0.86rem;line-height:1.6;color:var(--ink-3);min-height:1.6em;}',
    ROOT + '.ovf-status.is-good{color:#86efac;}',
    ROOT + '.ovf-status.is-bad{color:#fca5a5;}',
    ROOT + '.ovf-hints{margin:0.7rem 0 0;padding:0;list-style:none;display:grid;gap:0.35rem;}',
    ROOT + '.ovf-hint{padding:0.45rem 0.6rem;border-radius:7px;border-left:3px solid #fbbf24;' +
      'background:rgba(251,191,36,0.09);font-size:0.83rem;line-height:1.6;color:var(--ink-3);}',
    ROOT + '.ovf-done{margin-top:0.9rem;padding:0.8rem 0.9rem;border-radius:9px;border-left:3px solid #4ade80;' +
      'background:rgba(74,222,128,0.1);}',
    ROOT + '.ovf-done h4{margin:0 0 0.4rem;font-size:0.9rem;color:var(--ink);}',
    ROOT + '.ovf-done p{margin:0 0 0.6rem;font-size:0.85rem;line-height:1.7;color:var(--ink-3);}',
    ROOT + '.ovf-done p:last-child{margin-bottom:0;}',
    ROOT + '.ovf-note{margin:0.9rem 0 0;font-size:0.8rem;line-height:1.7;color:var(--ink-4);}',
    ROOT + '.ovf-note a{color:var(--accent-1);}',
    ROOT + '.ovf-note code{font-family:' + MONO + ';font-size:0.76rem;}',

    '@media (max-width:52rem){' + ROOT + '.ovf-main{grid-template-columns:minmax(0,1fr);}}',
    '@media (max-width:30rem){' + ROOT + '.ovf-line{grid-template-columns:4.6rem 5.4rem minmax(0,1fr);font-size:0.68rem;}' +
      ROOT + '.ovf-row{grid-template-columns:3.4rem 1.9rem 1rem minmax(0,1fr);}}'
  ].join('\n');

  /* ================================================================== */

  GameShell.define({
    id: 'game-overflow-puzzle',
    slug: 'overflow-puzzle',
    title: 'Overflow puzzle',
    bestKey: 'overflow-puzzle',
    board: true,
    autoStart: true,
    pauseOnBlur: false,
    /* The payload field and the listing buttons are the whole input
       surface. There is no arrow key here to read and nothing that needs
       to happen on a keystroke the field has not seen, so the shell's
       keyboard layer buys nothing and would only take Escape and Enter
       away from the field. Same call assembly-puzzles makes next door. */
    rawInput: true,
    formatBest: function (n) { return n ? String(n) : '—'; },

    setup: function (g) {
      var host = g.board;
      var at = 0;                 // which level is open
      var proc = null;            // the running process, or null
      var solved = [];            // { points, how } per level, once done
      var shownAt = [];           // levels whose answer has been read out
      var hintsUsed = [];
      var queue = [];             // recorded events waiting to be replayed
      var qi = 0;
      var wait = 0;
      var accum = 0;
      var lastHit = -1;
      var reading = {};
      var el = {};
      var i;

      for (i = 0; i < LEVELS.length; i++) { solved.push(null); shownAt.push(false); hintsUsed.push(0); }

      /* --------------------------------------------------------------
         Build the board once. Everything after this writes text into it.
         -------------------------------------------------------------- */
      function style() {
        if (g.el.querySelector('style[data-ovf]')) return;
        var node = document.createElement('style');
        node.setAttribute('data-ovf', '1');
        node.textContent = CSS;
        g.el.appendChild(node);
      }

      function build() {
        host.className = 'game-board board-ovf';
        host.innerHTML =
          '<div class="ovf-head">' +
          '  <h3 class="ovf-title" id="ovf-title"></h3>' +
          '  <p class="ovf-brief" id="ovf-brief"></p>' +
          '  <ul class="ovf-chips" id="ovf-chips"></ul>' +
          '</div>' +
          '<div class="ovf-main">' +
          '  <div class="ovf-pane">' +
          '    <p class="ovf-pane-h">The stack <span id="ovf-grow">— high addresses at the top</span></p>' +
          '    <div class="ovf-stack" id="ovf-stack"></div>' +
          '    <p class="ovf-legend" id="ovf-legend"></p>' +
          '  </div>' +
          '  <div class="ovf-pane">' +
          '    <p class="ovf-pane-h">The program <span>— tap a labelled line to append its address</span></p>' +
          '    <div class="ovf-code" id="ovf-code"></div>' +
          '  </div>' +
          '</div>' +
          '<div class="ovf-form">' +
          '  <label class="ovf-label" for="ovf-payload">Your message, as bytes</label>' +
          '  <input class="ovf-input" id="ovf-payload" type="text" spellcheck="false" autocomplete="off" ' +
          '    autocapitalize="off" autocorrect="off" placeholder="A*10 0x34 0x02" />' +
          '  <p class="ovf-preview" id="ovf-preview"></p>' +
          '  <div class="ovf-btns">' +
          '    <button class="game-btn" type="button" id="ovf-send">Send the note</button>' +
          '    <button class="game-btn" type="button" id="ovf-show">Show the note</button>' +
          '    <button class="game-btn" type="button" id="ovf-fresh">New process</button>' +
          '  </div>' +
          '  <p class="ovf-status" id="ovf-status" role="status" aria-live="polite"></p>' +
          '  <ul class="ovf-hints" id="ovf-hints"></ul>' +
          '</div>' +
          '<div class="ovf-log" id="ovf-log" tabindex="0" role="log" aria-live="off" ' +
          'aria-label="Machine output"></div>' +
          '<div class="ovf-done" id="ovf-done" hidden></div>' +
          '<p class="ovf-note">This machine is invented. The instruction names, the addresses, the ' +
          'calling convention and the sizes are all made up, none of it is x86 or ARM, and nothing ' +
          'here is a working technique or can be turned into one. What transfers is the picture: a ' +
          'fixed buffer, the saved return address a few cells above it, and a copy that has no idea ' +
          'where the end is. The <a href="/labs/buffer-overflow">buffer overflow lab</a> next door is ' +
          'the same subject as a sandbox you can push around; this is the same subject as four ' +
          'problems that have answers.</p>';

        el.title = host.querySelector('#ovf-title');
        el.brief = host.querySelector('#ovf-brief');
        el.chips = host.querySelector('#ovf-chips');
        el.stack = host.querySelector('#ovf-stack');
        el.legend = host.querySelector('#ovf-legend');
        el.code = host.querySelector('#ovf-code');
        el.payload = host.querySelector('#ovf-payload');
        el.preview = host.querySelector('#ovf-preview');
        el.status = host.querySelector('#ovf-status');
        el.hints = host.querySelector('#ovf-hints');
        el.log = host.querySelector('#ovf-log');
        el.done = host.querySelector('#ovf-done');

        var rows = '';
        for (var a = VIEW_TO; a >= VIEW_FROM; a--) {
          rows += '<div class="ovf-row" data-addr="' + a + '">' +
            '<span class="ovf-addr">' + memAt(a) + '</span>' +
            '<span class="ovf-val">00</span>' +
            '<span class="ovf-chr">.</span>' +
            '<span class="ovf-tag"></span>' +
            '</div>';
        }
        el.stack.innerHTML = rows;
        el.rows = {};
        var found = el.stack.querySelectorAll('.ovf-row');
        for (var r = 0; r < found.length; r++) {
          el.rows[Number(found[r].getAttribute('data-addr'))] = {
            row: found[r],
            val: found[r].querySelector('.ovf-val'),
            chr: found[r].querySelector('.ovf-chr'),
            tag: found[r].querySelector('.ovf-tag')
          };
        }

        el.payload.addEventListener('input', preview);
        el.payload.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); doSend(); }
        });

        host.querySelector('#ovf-send').addEventListener('click', doSend);
        host.querySelector('#ovf-show').addEventListener('click', doShow);
        host.querySelector('#ovf-fresh').addEventListener('click', function () {
          fresh(true);
        });
      }

      /* --------------------------------------------------------------
         Painting.
         -------------------------------------------------------------- */
      function say(text, cls) {
        var p = document.createElement('p');
        p.className = 'ovf-l' + (cls ? ' ' + cls : '');
        p.textContent = text;
        el.log.appendChild(p);
        while (el.log.childNodes.length > MAXLOG) el.log.removeChild(el.log.firstChild);
        el.log.scrollTop = el.log.scrollHeight;
      }

      function status(text, kind) {
        el.status.textContent = text || '';
        el.status.className = 'ovf-status' + (kind ? ' is-' + kind : '');
      }

      function paintStack() {
        var lv = LEVELS[at];
        for (var a = VIEW_FROM; a <= VIEW_TO; a++) {
          var cell = el.rows[a];
          if (!cell) continue;
          var v = proc ? proc.mem[a] : 0;
          var hidden = proc ? !proc.known[a] : false;
          cell.val.textContent = hidden ? '??' : hx(v, 2);
          cell.chr.textContent = hidden ? '—' : chrOf(v);
          cell.tag.textContent = tagOf(lv, a);
          cell.row.className = 'ovf-row k-' + kindOf(a) +
            (hidden ? ' is-hidden' : '') +
            (a === lastHit ? ' is-hit' : '') +
            (reading[a] ? ' is-read' : '');
        }
        el.legend.textContent = 'The copy starts at ' + memAt(BUF) + ' and climbs. ' +
          '?? is a value your exploit has no way of knowing yet, so this panel is not showing it either.';
      }

      function paintCode() {
        var lv = LEVELS[at];
        var out = '';
        for (var i2 = 0; i2 < lv.code.length; i2++) {
          var row = lv.code[i2];
          var off = row[0];
          var label = row[1];
          var text = row[2];
          var cmt = row[3];
          var shown = off == null ? '' : (lv.aslr ? 'base+' + addr8(off) : addr16(CODE + off));
          var body = esc(text) + (cmt ? '   <span class="ovf-cmt">; ' + esc(cmt) + '</span>' : '');
          var comment = text.charAt(0) === ';';
          if (label) {
            var human = lv.aslr
              ? 'Append the low half of the address of ' + label + ', ' + addr8(off) + ', to the message'
              : 'Append the address of ' + label + ', ' + addr16(CODE + off) + ', to the message';
            out += '<button type="button" class="ovf-line" data-off="' + off + '" aria-label="' + esc(human) + '">' +
              '<span class="ovf-off">' + shown + '</span>' +
              '<span class="ovf-lbl">' + esc(label) + ':</span>' +
              '<span class="ovf-ins">' + body + '</span></button>';
          } else {
            out += '<div class="ovf-line' + (comment ? ' is-comment' : '') + '">' +
              '<span class="ovf-off">' + shown + '</span><span class="ovf-lbl"></span>' +
              '<span class="ovf-ins">' + body + '</span></div>';
          }
        }
        el.code.innerHTML = out;

        var btns = el.code.querySelectorAll('button.ovf-line');
        for (var b = 0; b < btns.length; b++) {
          (function (btn) {
            btn.addEventListener('click', function () {
              var off = Number(btn.getAttribute('data-off'));
              var add = LEVELS[at].aslr
                ? '0x' + hx(off, 2)
                : '0x' + hx(off, 2) + ' 0x' + hx(CODE >> 8, 2);
              var cur = el.payload.value.replace(/\s+$/, '');
              el.payload.value = (cur ? cur + ' ' : '') + add;
              preview();
              el.payload.focus();
            });
          })(btns[b]);
        }
      }

      function paintChips() {
        var lv = LEVELS[at];
        var list = [
          { k: 'stack canary', on: lv.canary },
          { k: 'no-execute stack', on: lv.nx },
          { k: 'randomised base', on: lv.aslr }
        ];
        var out = '';
        for (var c = 0; c < list.length; c++) {
          out += '<li class="ovf-chip' + (list[c].on ? ' is-on' : '') + '">' +
            esc(list[c].k) + ': ' + (list[c].on ? 'on' : 'off') + '</li>';
        }
        el.chips.innerHTML = out;
      }

      function paintHints() {
        var lv = LEVELS[at];
        var n = hintsUsed[at];
        var out = '';
        for (var h = 0; h < n && h < lv.hints.length; h++) {
          out += '<li class="ovf-hint">' + esc(lv.hints[h]) + '</li>';
        }
        el.hints.innerHTML = out;
      }

      function paintDone() {
        var s = solved[at];
        if (!s) { el.done.hidden = true; el.done.innerHTML = ''; return; }
        var lv = LEVELS[at];
        el.done.hidden = false;
        el.done.innerHTML =
          '<h4>Level ' + (at + 1) + ' — ' + esc(lv.name) + ', ' + s.points + ' points</h4>' +
          '<p>' + lv.debrief + '</p>' +
          (at + 1 < LEVELS.length
            ? '<p>Level ' + (at + 2) + ' is in the dropdown above the board.</p>'
            : '<p>That is all four.</p>');
      }

      function preview() {
        var lv = LEVELS[at];
        var res = parsePayload(el.payload.value);
        if (!res.ok) {
          el.preview.textContent = res.error;
          el.preview.className = 'ovf-preview is-bad';
          return;
        }
        if (!res.bytes.length) {
          el.preview.textContent = 'Nothing yet. Try some text, or a hex byte like 0x41, or A*10 to repeat one.';
          el.preview.className = 'ovf-preview';
          return;
        }
        var land = landing(lv, res.bytes);
        var text;
        if (land.n === 0) {
          text = 'The first byte is a zero, so the copy stops before writing anything.';
        } else {
          text = res.bytes.length + ' byte' + (res.bytes.length === 1 ? '' : 's') + '. ' +
            (land.stoppedAt >= 0
              ? 'A zero byte at position ' + (land.stoppedAt + 1) + ' ends the copy, so only ' + land.n + ' land. '
              : '') +
            'The last one to land goes in ' + memAt(land.last) +
            (land.last < MEMSIZE
              ? ', which is ' + tagOf(lv, land.last) + (land.last > VIEW_TO ? ', off the top of the panel.' : '.')
              : ', which is past the end of memory, so the copy faults on the way.');
        }
        el.preview.textContent = text;
        el.preview.className = 'ovf-preview';
      }

      /* --------------------------------------------------------------
         The process.
         -------------------------------------------------------------- */
      function fresh(loud) {
        proc = newProcess(LEVELS[at], function (n) { return g.rnd(n); });
        queue = [];
        qi = 0;
        wait = 0;
        lastHit = -1;
        reading = {};
        paintStack();
        if (loud) {
          say('--- new process ---', 'dim');
          say(LEVELS[at].aslr
            ? 'loaded at a base you are not being told. read_note’s frame is drawn as it stands on entry.'
            : 'loaded at base ' + addr16(CODE) + '. read_note’s frame is drawn as it stands on entry.', 'dim');
          if (LEVELS[at].canary) say('a fresh canary has been chosen for this process.', 'dim');
          status('Fresh process. Anything you leaked from the last one is stale now.', null);
          g.announce('New process started');
        }
      }

      function busy() { return qi < queue.length; }

      function guard() {
        if (busy()) { status('Still running. Give it a moment.', null); return false; }
        if (!proc) { fresh(false); }
        if (proc.dead) {
          status('This process has stopped. Press New process to start another one.', 'bad');
          g.beep(200, 0.08, 'square');
          return false;
        }
        return true;
      }

      function doSend() {
        if (!guard()) return;
        var res = parsePayload(el.payload.value);
        if (!res.ok) { status(res.error, 'bad'); g.beep(200, 0.08, 'square'); return; }
        if (!res.bytes.length) { status('There is nothing in the message to send.', 'bad'); return; }
        say('you: send ' + res.bytes.length + ' byte' + (res.bytes.length === 1 ? '' : 's'), 'you');
        queue = runNote(LEVELS[at], proc, res.bytes);
        qi = 0; wait = 0; accum = 0;
        status('Running.', null);
      }

      function doShow() {
        if (!guard()) return;
        say('you: show', 'you');
        queue = runShow(LEVELS[at], proc);
        qi = 0; wait = 0; accum = 0;
      }

      /* --------------------------------------------------------------
         Replay. One event per tick, so the copy is watched rather than
         reported. Everything below only applies an event that was already
         decided by runNote or runShow.
         -------------------------------------------------------------- */
      function applyEvent(ev) {
        var lv = LEVELS[at];
        var a;

        if (ev.t === 'call') { lastHit = -1; reading = {}; say(ev.text, 'dim'); return 1; }

        if (ev.t === 'plant') {
          proc.mem[ev.addr] = ev.val;
          proc.known[ev.addr] = false;
          lastHit = ev.addr;
          say('read_note: plants the canary in ' + memAt(ev.addr) + '. You are not shown it.', 'dim');
          return 1;
        }

        if (ev.t === 'frame') {
          proc.mem[FPCELL] = lv.fp;
          proc.mem[RETLO] = RET_INTO_MAIN;
          proc.mem[RETHI] = proc.base >> 8;
          proc.known[RETLO] = !lv.aslr;
          proc.known[RETHI] = !lv.aslr;
          lastHit = -1;
          say('read_note: frame is up. saved fp in ' + memAt(FPCELL) + ', return address in ' +
            memAt(RETLO) + ' and ' + memAt(RETHI) + '.', 'dim');
          return 1;
        }

        if (ev.t === 'write') {
          proc.mem[ev.addr] = ev.val;
          proc.known[ev.addr] = true;
          lastHit = ev.addr;
          var where = tagOf(lv, ev.addr);
          var over = ev.addr >= BUF + BUFLEN;
          say(memAt(ev.addr) + ' <- ' + hx(ev.val, 2) + '  \'' + chrOf(ev.val) + '\'   ' + where +
            (over ? '   <- past the end of buf' : ''), over ? 'hit' : null);
          if (g.gate('tick', 0.05)) g.beep(over ? 520 : 320, 0.03, 'square', 0.04);
          return 1;
        }

        if (ev.t === 'note') { say(ev.text, ev.cls || null); return 1; }

        if (ev.t === 'copied') {
          lastHit = -1;
          say('read_note: ' + ev.n + ' byte' + (ev.n === 1 ? '' : 's') + ' copied' +
            (ev.last >= 0 ? ', last one into ' + memAt(ev.last) : '') + '. No bound was checked, because there is none.', 'dim');
          return 1;
        }

        if (ev.t === 'oom') { say(ev.text, 'bad'); g.beep(160, 0.2, 'square'); g.announce('The copy ran off the end of memory'); return 1; }

        if (ev.t === 'check') {
          proc.known[CANARY] = true;
          reading = {}; reading[CANARY] = 1;
          say('epilogue: reads ' + memAt(CANARY) + ' = ' + hx(ev.got, 2) + ', wants ' + hx(ev.want, 2) + '.',
            ev.got === ev.want ? 'ok' : 'bad');
          return 1;
        }

        if (ev.t === 'abort') {
          reading = {};
          say(ev.text, 'bad');
          say('note that the return address in ' + memAt(RETLO) + ' and ' + memAt(RETHI) +
            ' was already overwritten. The canary did not stop the write. It stopped the return.', 'dim');
          g.beep(180, 0.25, 'square');
          g.announce('Stack smashing detected. The process aborted.');
          status('The canary caught it. The write still happened — look at the two return cells.', 'bad');
          return 1;
        }

        if (ev.t === 'read') {
          reading[ev.addr] = 1;
          proc.known[ev.addr] = true;
          say('RET: reads ' + memAt(ev.addr) + ' = ' + hx(ev.val, 2) +
            (ev.unknown ? '   (you never wrote this one, and never learned it)' : ''), 'hit');
          g.beep(660, 0.05, 'sine');
          return 1;
        }

        if (ev.t === 'jump') {
          reading = {};
          var shownAddr = ev.unknown ? '??' + hx(ev.addr & 0xFF, 2) : addr16(ev.addr);
          var name = (ev.addr & 0xFF00) === proc.base ? spanAt(lv, ev.addr & 0xFF) : null;
          say(ev.from + ': jump ' + shownAddr + (name ? '   -> ' + name : ''), 'hit');
          return 2;
        }

        if (ev.t === 'nx' || ev.t === 'opcode' || ev.t === 'unmapped') {
          say(ev.text, 'bad');
          g.beep(180, 0.2, 'square');
          g.announce(ev.t === 'nx' ? 'No-execute fault' : 'The machine faulted');
          status(ev.t === 'nx'
            ? 'A no-execute fault. Data pages do not run, whatever you put in them.'
            : 'The machine faulted and the process is gone.', 'bad');
          return 1;
        }

        if (ev.t === 'say') { say('out: ' + ev.text, 'ok'); return 1; }

        if (ev.t === 'leak') {
          var line = '';
          var ascii = '';
          for (a = 0; a < ev.cells.length; a++) {
            proc.known[ev.cells[a].addr] = true;
            line += (a ? ' ' : '') + hx(ev.cells[a].val, 2);
            ascii += chrOf(ev.cells[a].val);
          }
          if (!ev.cells.length) {
            say('show_note: the first cell is zero, so it prints nothing. Send something first.', 'dim');
            status('Nothing to print yet. The buffer has a zero in it, and show_note stops at a zero.', null);
          } else {
            proc.leaked = true;
            say('show_note prints ' + ev.cells.length + ': ' + line + '   "' + ascii + '"', 'ok');
            if (ev.stop >= 0) {
              say('show_note stopped at ' + memAt(ev.stop) + ', which holds a zero.', 'dim');
            } else {
              say('show_note gave up after ' + LEAK_MAX + ' cells.', 'dim');
            }
            var pastBuf = ev.cells.length - BUFLEN;
            if (pastBuf > 0) {
              say(pastBuf + ' of those ' + (pastBuf === 1 ? 'was' : 'were') +
                ' past the end of buf. The one from ' + memAt(CANARY) + ' is the canary.', 'hit');
              status('You have the canary: ' + addr8(proc.mem[CANARY]) + '. It holds for this process only.', 'good');
              g.announce('Leaked ' + ev.cells.length + ' bytes. The canary is ' + addr8(proc.mem[CANARY]));
            } else {
              status('That printed the buffer and stopped. Fill all eight cells with non-zero bytes to make it run on.', null);
            }
          }
          g.beep(560, 0.06, 'sine');
          return 1;
        }

        if (ev.t === 'end') {
          finish(ev.outcome);
          return 1;
        }
        return 1;
      }

      function finish(outcome) {
        reading = {};
        lastHit = -1;
        if (outcome === 'win') {
          if (!proc.dead) proc.dead = true;
          award('solved');
        } else if (outcome === 'return') {
          /* main carries on. That is the whole point of a server loop: a
             failed attempt costs you nothing but the attempt. */
          status('read_note returned where it should have. The server is still up, so try again.', null);
        } else {
          proc.dead = true;
          if (outcome === 'abort' && !el.status.textContent) {
            status('The process aborted.', 'bad');
          }
        }
      }

      /* A level whose answer has been read out can never pay, and that has to
         be checked HERE rather than in doAnswer. The first version only zeroed
         the score at the moment the answer was shown, so pressing Send with the
         answer still in the box came back through this function and awarded the
         full amount — read the answer, send the answer, collect the points. */
      function award(how) {
        var lv = LEVELS[at];
        var pts = (how === 'shown' || shownAt[at]) ? 0 : Math.max(0, lv.points - 50 * hintsUsed[at]);
        if (!solved[at] || pts > solved[at].points) solved[at] = { points: pts, how: how };
        if (how !== 'shown') {
          say('*** level ' + (at + 1) + ' solved. ' + pts + ' points. ***', 'ok');
          status(shownAt[at]
            ? 'Solved, and worth nothing, because the answer was on screen. Read the note under the board and carry on.'
            : 'Solved. ' + pts + ' points. Read the note under the board, then take the next level from the dropdown.', 'good');
          g.announce('Level ' + (at + 1) + ' solved, ' + pts + ' points');
          g.beep(880, 0.09, 'sine');
        }
        total();
        paintDone();
        if (allDone()) {
          var sum = total();
          g.over({
            won: true,
            score: sum,
            title: 'All four',
            message: 'You walked a return address past a canary, past a no-execute stack and past a ' +
              'randomised base. Every one of those raised the price and none of them fixed the copy.'
          });
        }
      }

      function allDone() {
        for (var s = 0; s < solved.length; s++) if (!solved[s]) return false;
        return true;
      }

      function total() {
        var sum = 0;
        for (var s = 0; s < solved.length; s++) if (solved[s]) sum += solved[s].points;
        g.setScore(sum);
        return sum;
      }

      /* --------------------------------------------------------------
         Levels and the toolbar.
         -------------------------------------------------------------- */
      function openLevel(n) {
        at = n;
        if (at < 0 || at >= LEVELS.length) at = 0;
        var lv = LEVELS[at];
        el.title.textContent = 'Level ' + (at + 1) + ' — ' + lv.name;
        el.brief.innerHTML = lv.brief;
        paintChips();
        paintCode();
        paintHints();
        paintDone();
        el.payload.value = '';
        preview();
        el.log.innerHTML = '';
        g.stat('level', (at + 1) + '/' + LEVELS.length);
        g.stat('mit', lv.mit);
        status('', null);
        fresh(true);
        if (el.levelSel) el.levelSel.value = String(at);
      }

      function doHint() {
        var lv = LEVELS[at];
        if (hintsUsed[at] >= lv.hints.length) {
          status('That is all the hints there are. "Show the answer" is the other button.', null);
          return;
        }
        hintsUsed[at]++;
        paintHints();
        var left = Math.max(0, lv.points - 50 * hintsUsed[at]);
        status('Hint ' + hintsUsed[at] + ' of ' + lv.hints.length + '. This level is now worth ' + left + '.', null);
        g.announce('Hint ' + hintsUsed[at]);
      }

      function answerFor() {
        var lv = LEVELS[at];
        var can = proc && lv.canary ? '0x' + hx(proc.mem[CANARY], 2) : null;
        if (at === 0) return 'A*10 0x34 0x02';
        if (at === 1) return 'A*8 ' + (can || '0x??') + ' A 0x34 0x02';
        if (at === 2) return 'A*8 ' + (can || '0x??') + ' A 0x40 0x02 0x50 0x02';
        return 'A*8 ' + (can || '0x??') + ' A 0x34';
      }

      function doAnswer() {
        var lv = LEVELS[at];
        var text = answerFor();
        el.payload.value = text;
        preview();
        say('the answer for this level: ' + text, 'dim');
        if (lv.canary) {
          say('the canary in it is the one this process happens to be using. A new process needs a new leak.', 'dim');
        }
        shownAt[at] = true;
        if (!solved[at]) award('shown');
        status('Shown, so this level scores nothing however it is solved. Press Send the note and watch it land.', null);
        paintDone();
        g.announce('The answer has been filled in');
      }

      function wire() {
        var sel = g.el.querySelector('#game-level');
        if (sel) {
          el.levelSel = sel;
          sel.addEventListener('change', function () {
            openLevel(Number(sel.value) || 0);
          });
        }
        var hint = g.el.querySelector('#game-hint');
        if (hint) hint.addEventListener('click', doHint);
        var ans = g.el.querySelector('#game-answer');
        if (ans) ans.addEventListener('click', doAnswer);
      }

      style();
      build();
      wire();

      return {
        reset: function () {
          at = 0;
          queue = []; qi = 0; wait = 0;
          for (var s = 0; s < LEVELS.length; s++) { solved[s] = null; shownAt[s] = false; hintsUsed[s] = 0; }
          g.setScore(0);
          openLevel(0);
        },

        update: function (dt) {
          if (qi >= queue.length) return;
          accum += dt;
          while (accum >= STEP_EVERY && qi < queue.length) {
            accum -= STEP_EVERY;
            if (wait > 0) { wait--; paintStack(); continue; }
            var ev = queue[qi++];
            var hold = applyEvent(ev);
            wait = (ev.hold || hold || 1) - 1;
            paintStack();
          }
          if (qi >= queue.length) { lastHit = -1; reading = {}; paintStack(); }
        }
      };
    }
  });
})();

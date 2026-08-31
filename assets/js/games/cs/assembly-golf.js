/* ==========================================================================
   assembly-golf.js — the shortest program that passes, on a machine that
   charges different prices for different instructions.
   --------------------------------------------------------------------------
   There is already an assembly game in this section, so the first thing to
   answer is why there are two. assembly-puzzles teaches what the instructions
   DO: it hands you a tape of input, asks for a tape of output, and scores you
   on instructions plus cycles added together, so a working program is most of
   the win. This is golf. The program has to be right AND short, the score is
   the length and nothing else, and the machine underneath is a different
   machine — a load/store design with a stack, a calling convention instead of
   an input tape, and a price list where MOD costs six times what ADD costs.

   THE SECOND NUMBER IS THE POINT. Instructions written is the score; cycles
   spent is printed beside it and never folded into it. The two pull in
   opposite directions, and level seven exists to prove it: the ten
   instruction primality test divides all the way up to n, the twelve
   instruction one stops at the square root. Measured here on load, that is
   14554 cycles against 860 — the longer program does about a seventeenth of
   the work. A single combined figure would hide the only trade here worth
   teaching, and the number itself is never written down, because the two
   programs are run when the page opens and the level prints what they cost.

   TESTS ARE HIDDEN, AND TWO OF THEM ARE NOT. Golf against a printed list of
   cases is golf against the list — the shortest program that passes eight
   visible examples is a table of eight answers. So the battery is hidden, two
   examples are shown so the signature is never ambiguous, and the case that
   catches you is revealed the moment it does, with what it wanted and what it
   got. "Wrong" on its own is not a bug report.

   PAR IS MEASURED, NOT TYPED. This is the one idea taken wholesale from
   assembly-puzzles next door, because it was right there. Every level ships
   the shortest program I found as source text, and its par is produced by
   assembling and running that text in this same machine when the page loads.
   A par written into a table is wrong the day the price of MUL changes and
   nobody notices for a year. It also means every reference program is
   executed on every visit, so a broken one shows up at once rather than
   sitting in a file being believed.

   AND PAR IS THE SHORTEST I FOUND, NOT THE SHORTEST THERE IS — the same
   claim regex-golf makes next door, and it is a claim about my afternoon
   rather than about the machine. Beating it is the interesting part.

   The runaway guard is a cap, and it is described as one. A program is
   stopped after 40000 cycles with "did not terminate within 40000 cycles",
   never with "loops forever", because deciding the second in general is the
   halting problem. No amount of reading your program before running it would
   change that, so nothing here pretends to.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  var MEM_SIZE = 24;           // cells, and the stack lives at the top of them
  var MAX_CYCLES = 40000;      // the runaway cap — see the header
  var LIMIT = 2147483647;      // past this is a mistake, not a wrap
  var WATCHABLE = 300;         // longer than this and watching is just waiting
  var STEP_EVERY = 0.06;       // seconds per instruction while animating

  /* THE PRICE LIST. Invented numbers, but proportioned after real hardware:
     a register move is the cheap thing, touching memory costs more than not
     touching it, multiply costs a few, and divide costs a lot. Every real
     divider is the slowest arithmetic unit on the chip, which is why
     compilers turn a division by a constant into a multiply and a shift.

     A taken branch is charged the same as a skipped one, which is the biggest
     lie in the table: real pipelines pay for a mispredicted jump. Modelling
     that would make unrolling pay and would need a branch predictor to be
     honest about, and neither belongs in a game this size. */
  var COST = {
    MOV: 1, ADD: 1, SUB: 1, CMP: 1,
    JMP: 1, JZ: 1, JNZ: 1, JG: 1, JL: 1, DJNZ: 1, HLT: 1,
    MUL: 3, DIV: 6, MOD: 6,
    LD: 2, ST: 2, PUSH: 2, POP: 2, CALL: 2, RET: 2
  };

  /* Operand kinds: reg is R0 to R3 only, val is a register or a number, mem
     is [4] or [R1], lbl is a label name.

     MOV CANNOT TOUCH MEMORY, and that is the deliberate difference from the
     machine next door. This is a load/store design: arithmetic happens
     between registers, and memory is reached only through LD and ST. Every
     RISC works this way, and it is the reason a line of C turns into three
     instructions rather than one. */
  var MNEM = {
    MOV: { n: 2, k: ['reg', 'val'] },
    ADD: { n: 2, k: ['reg', 'val'] },
    SUB: { n: 2, k: ['reg', 'val'] },
    MUL: { n: 2, k: ['reg', 'val'] },
    DIV: { n: 2, k: ['reg', 'val'] },
    MOD: { n: 2, k: ['reg', 'val'] },
    CMP: { n: 2, k: ['val', 'val'] },
    JMP: { n: 1, k: ['lbl'] },
    JZ: { n: 1, k: ['lbl'] },
    JNZ: { n: 1, k: ['lbl'] },
    JG: { n: 1, k: ['lbl'] },
    JL: { n: 1, k: ['lbl'] },
    DJNZ: { n: 2, k: ['reg', 'lbl'] },
    LD: { n: 2, k: ['reg', 'mem'] },
    ST: { n: 2, k: ['mem', 'val'] },
    PUSH: { n: 1, k: ['val'] },
    POP: { n: 1, k: ['reg'] },
    CALL: { n: 1, k: ['lbl'] },
    RET: { n: 0, k: [] },
    HLT: { n: 0, k: [] }
  };

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function sigOf(name) {
    return has(MNEM, name) ? MNEM[name] : null;
  }

  function trim(s) {
    return String(s).replace(/^\s+/, '').replace(/\s+$/, '');
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ------------------------------------------------------------------
     The assembler.
     ------------------------------------------------------------------ */
  function operand(s) {
    var m = /^[Rr]([0-3])$/.exec(s);
    if (m) return { t: 'reg', v: Number(m[1]), raw: s };

    m = /^\[\s*(.+?)\s*\]$/.exec(s);
    if (m) {
      var r = /^[Rr]([0-3])$/.exec(m[1]);
      if (r) return { t: 'mem', reg: Number(r[1]), raw: s };
      if (/^\d+$/.test(m[1])) return { t: 'mem', addr: Number(m[1]), raw: s };
      return null;
    }

    if (/^-?\d+$/.test(s)) return { t: 'imm', v: Number(s), raw: s };
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return { t: 'label', v: s.toUpperCase(), raw: s };
    return null;
  }

  /* Only ever reached once operand() has already refused the text, so it can
     assume something is wrong and go looking for what. R9 parses perfectly
     well as a label name, so without this the complaint would be about
     labels and would send you hunting in the wrong place. */
  function operandFault(s) {
    var inner = /^\[\s*(.+?)\s*\]$/.exec(s);
    var bare = inner ? inner[1] : s;
    if (/^[Rr]\d+$/.test(bare)) {
      return 'this machine has R0, R1, R2 and R3, so "' + bare + '" is not a register it owns.';
    }
    if (inner) {
      return 'a memory operand is a fixed cell such as [6] or a register holding an address such as [R1]. ' +
        '"' + s + '" is neither.';
    }
    return 'cannot read the operand "' + s + '".';
  }

  function assemble(src) {
    var lines = String(src == null ? '' : src).split('\n');
    var code = [];
    var labels = {};
    var i, line, m, p;

    function fail(lineIndex, msg) {
      return { ok: false, error: 'Line ' + (lineIndex + 1) + ': ' + msg };
    }

    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      var semi = line.indexOf(';');
      if (semi >= 0) line = line.slice(0, semi);
      line = trim(line);

      /* A label may stand alone on its line or sit in front of an
         instruction, and several may stack up in front of the same one. */
      while (line) {
        m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
        if (!m) break;
        var name = m[1].toUpperCase();
        if (sigOf(name)) return fail(i, '"' + m[1] + '" is an instruction name, so it cannot also be a label.');
        if (has(labels, name)) return fail(i, 'there is already a label called "' + m[1] + '".');
        labels[name] = code.length;
        line = trim(line.slice(m[0].length));
      }
      if (!line) continue;

      m = /^([A-Za-z]+)(\s+([\s\S]*))?$/.exec(line);
      if (!m) return fail(i, 'cannot make sense of "' + line + '".');
      var mnem = m[1].toUpperCase();
      var sig = sigOf(mnem);
      if (!sig) return fail(i, '"' + m[1] + '" is not an instruction on this machine.');

      var rest = trim(m[3] || '');
      var ops = [];
      if (rest) {
        var parts = rest.split(',');
        for (p = 0; p < parts.length; p++) {
          var text = trim(parts[p]);
          if (!text) return fail(i, 'there is an empty operand, which is usually a stray comma.');
          var op = operand(text);
          if (!op) return fail(i, operandFault(text));
          ops.push(op);
        }
      }

      if (ops.length !== sig.n) {
        return fail(i, mnem + ' takes ' + sig.n + ' operand' + (sig.n === 1 ? '' : 's') + ', not ' + ops.length + '.');
      }

      for (p = 0; p < ops.length; p++) {
        var kind = sig.k[p];
        var t = ops[p].t;
        /* R7 survives operand() as a label and only turns out to be wrong
           here, so say what is actually wrong with it. */
        if (t === 'label' && kind !== 'lbl' && /^[Rr]\d+$/.test(ops[p].raw)) {
          return fail(i, operandFault(ops[p].raw));
        }
        if (kind === 'reg' && t === 'mem') {
          return fail(i, mnem + ' works on registers only. Memory is reached with LD and ST on this machine, ' +
            'so load [' + (ops[p].reg == null ? ops[p].addr : 'R' + ops[p].reg) + '] into a register first.');
        }
        if (kind === 'reg' && t !== 'reg') {
          return fail(i, mnem + ' writes into its first operand, so that operand has to be a register, ' +
            'not "' + ops[p].raw + '".');
        }
        if (kind === 'val' && t === 'mem') {
          return fail(i, mnem + ' cannot read memory directly. LD it into a register first — that is what ' +
            'makes this a load/store machine.');
        }
        if (kind === 'val' && t === 'label') {
          return fail(i, '"' + ops[p].raw + '" is not a value. Use a register or a whole number.');
        }
        if (kind === 'mem' && t !== 'mem') {
          return fail(i, mnem + ' needs a memory cell such as [6] or [R1], and "' + ops[p].raw + '" is not one.');
        }
        if (kind === 'lbl' && t !== 'label') {
          return fail(i, mnem + ' jumps to a label, and "' + ops[p].raw + '" is not one.');
        }
      }

      code.push({ op: mnem, ops: ops, line: i + 1 });
    }

    if (!code.length) return { ok: false, error: 'There is nothing to run yet.' };

    for (i = 0; i < code.length; i++) {
      var sg = sigOf(code[i].op);
      var at = -1;
      for (p = 0; p < sg.k.length; p++) if (sg.k[p] === 'lbl') at = p;
      if (at < 0) continue;
      var target = code[i].ops[at].v;
      if (!has(labels, target)) {
        return { ok: false, error: 'Line ' + code[i].line + ': there is no label called "' + code[i].ops[at].raw + '".' };
      }
      code[i].target = labels[target];
    }

    return { ok: true, code: code, labels: labels };
  }

  function textOf(ins) {
    var out = ins.op;
    for (var i = 0; i < ins.ops.length; i++) {
      out += (i ? ', ' : ' ') + ins.ops[i].raw;
    }
    return out;
  }

  /* ------------------------------------------------------------------
     The machine.
     ------------------------------------------------------------------
     Arguments arrive in registers and, on the memory levels, in memory —
     there is no input tape and no OUT instruction. The answer is whatever is
     left in R0, or whatever is left in the cells, when the program stops. A
     program stops by running off its last instruction, by HLT, or by a RET
     with nothing on the stack, which is what returning to your caller looks
     like from in here.

     THE STACK IS MEMORY. SP starts one past the top cell and grows downwards,
     so PUSH writes into the same 24 cells your data is in. Nothing stops the
     two meeting in the middle. That is not an oversight — it is a stack
     overflow, it is what the phrase originally meant, and being able to watch
     it happen in a 24 cell machine is worth more than a guard rail. */
  function Machine(code, test) {
    var i;
    this.code = code;
    this.regs = [0, 0, 0, 0];
    this.mem = [];
    for (i = 0; i < MEM_SIZE; i++) this.mem.push(0);
    var r = test.r || [];
    for (i = 0; i < r.length && i < 4; i++) this.regs[i] = r[i];
    if (test.m) for (i = 0; i < test.m.length && i < MEM_SIZE; i++) this.mem[i] = test.m[i];
    this.sp = MEM_SIZE;
    this.pc = 0;
    this.flag = 0;
    this.cycles = 0;
    this.done = false;
    this.error = null;
    this.touched = -1;          // last cell written, for the display
  }

  Machine.prototype.fail = function (msg) {
    this.error = msg;
    this.done = true;
  };

  Machine.prototype.addrOf = function (o) {
    var a = o.reg == null ? o.addr : this.regs[o.reg];
    if (a < 0 || a >= MEM_SIZE) {
      this.fail('Address ' + a + ' is outside memory, which runs 0 to ' + (MEM_SIZE - 1) + '.');
      return -1;
    }
    return a;
  };

  Machine.prototype.read = function (o) {
    if (o.t === 'imm') return o.v;
    if (o.t === 'reg') return this.regs[o.v];
    var a = this.addrOf(o);
    return a < 0 ? 0 : this.mem[a];
  };

  Machine.prototype.put = function (o, v) {
    if (v > LIMIT || v < -LIMIT) {
      this.fail('The value ' + v + ' is larger than this machine can hold.');
      return;
    }
    if (o.t === 'reg') { this.regs[o.v] = v; return; }
    var a = this.addrOf(o);
    if (a >= 0) { this.mem[a] = v; this.touched = a; }
  };

  Machine.prototype.push = function (v) {
    if (this.sp <= 0) {
      this.fail('The stack has run down into cell 0 and there is nowhere left to push.');
      return;
    }
    this.sp--;
    this.mem[this.sp] = v;
    this.touched = this.sp;
  };

  Machine.prototype.pop = function () {
    if (this.sp >= MEM_SIZE) {
      this.fail('POP with nothing on the stack. Every POP needs a PUSH before it.');
      return 0;
    }
    var v = this.mem[this.sp];
    this.sp++;
    return v;
  };

  Machine.prototype.next = function () {
    if (this.done || this.pc < 0 || this.pc >= this.code.length) return null;
    return this.code[this.pc];
  };

  Machine.prototype.step = function () {
    if (this.done) return false;
    if (this.pc < 0 || this.pc >= this.code.length) { this.done = true; return false; }
    if (this.cycles >= MAX_CYCLES) {
      /* Deliberately not "your program loops forever" — see the header. */
      this.fail('Your program did not terminate within ' + MAX_CYCLES + ' cycles, so the machine stopped it.');
      return false;
    }

    var ins = this.code[this.pc];
    var a = ins.ops[0];
    var b = ins.ops[1];
    var op = ins.op;
    var v;

    this.pc++;
    this.cycles += COST[op];

    if (op === 'MOV') { this.put(a, this.read(b)); }
    else if (op === 'ADD') { v = this.read(a) + this.read(b); this.put(a, v); this.flag = v; }
    else if (op === 'SUB') { v = this.read(a) - this.read(b); this.put(a, v); this.flag = v; }
    else if (op === 'MUL') { v = this.read(a) * this.read(b); this.put(a, v); this.flag = v; }
    else if (op === 'DIV') {
      v = this.read(b);
      if (v === 0) { this.fail('Division by zero. The machine has no answer for that and neither has anything else.'); return false; }
      v = this.read(a) / v;
      /* Truncated towards zero, the way C and every processor since has done
         it. Math.floor would round -7/2 to -4, which is a different language
         and a different answer. */
      v = v < 0 ? Math.ceil(v) : Math.floor(v);
      this.put(a, v);
      this.flag = v;
    } else if (op === 'MOD') {
      v = this.read(b);
      if (v === 0) { this.fail('MOD by zero. There is no remainder to give you.'); return false; }
      v = this.read(a) % v;
      this.put(a, v);
      this.flag = v;
    } else if (op === 'CMP') { this.flag = this.read(a) - this.read(b); }
    else if (op === 'JMP') { this.pc = ins.target; }
    else if (op === 'JZ') { if (this.flag === 0) this.pc = ins.target; }
    else if (op === 'JNZ') { if (this.flag !== 0) this.pc = ins.target; }
    else if (op === 'JG') { if (this.flag > 0) this.pc = ins.target; }
    else if (op === 'JL') { if (this.flag < 0) this.pc = ins.target; }
    else if (op === 'DJNZ') {
      v = this.read(a) - 1;
      this.put(a, v);
      this.flag = v;
      if (v !== 0) this.pc = ins.target;
    } else if (op === 'LD') { this.put(a, this.read(b)); }
    else if (op === 'ST') { this.put(a, this.read(b)); }
    else if (op === 'PUSH') { this.push(this.read(a)); }
    else if (op === 'POP') { this.put(a, this.pop()); }
    else if (op === 'CALL') { this.push(this.pc); if (!this.done) this.pc = ins.target; }
    else if (op === 'RET') {
      /* A RET with an empty stack is a return to whoever called the whole
         program, and from in here that is the end of it. */
      if (this.sp >= MEM_SIZE) { this.done = true; return false; }
      this.pc = this.pop();
    } else if (op === 'HLT') { this.done = true; }

    return !this.done;
  };

  Machine.prototype.finish = function () {
    while (this.step()) { /* the guards inside step() stop this */ }
    return this;
  };

  /* Which conditional jumps would be taken right now. Printed beside the
     flag because "the flag is -3" and "JNZ and JL would jump" are the same
     fact, and only one of them is the one you are actually asking. */
  function jumpsNow(flag) {
    var out = [];
    if (flag === 0) out.push('JZ');
    if (flag !== 0) out.push('JNZ');
    if (flag > 0) out.push('JG');
    if (flag < 0) out.push('JL');
    return out.join(', ');
  }

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* What a finished machine actually produced, in the shape the level asked
     for: a number left in R0, or the first few memory cells. */
  function resultOf(m, level, test) {
    if (level.mode === 'mem') return m.mem.slice(0, test.wm.length);
    return m.regs[0];
  }

  function correct(m, level, test) {
    if (m.error) return false;
    if (level.mode === 'mem') return sameList(m.mem.slice(0, test.wm.length), test.wm);
    return m.regs[0] === test.w;
  }

  /* Run the whole hidden battery. Cycles are summed across every case, so a
     program that gets the small ones right and grinds on the big one cannot
     post a small cycle figure. */
  function runTests(code, level) {
    var results = [];
    var cycles = 0;
    var pass = true;
    var firstBad = -1;
    for (var i = 0; i < level.tests.length; i++) {
      var m = new Machine(code, level.tests[i]).finish();
      var ok = correct(m, level, level.tests[i]);
      cycles += m.cycles;
      if (!ok && firstBad < 0) firstBad = i;
      if (!ok) pass = false;
      results.push({ ok: ok, got: resultOf(m, level, level.tests[i]), error: m.error, cycles: m.cycles });
    }
    return { pass: pass, results: results, cycles: cycles, size: code.length, firstBad: firstBad };
  }

  /* ------------------------------------------------------------------
     The eight functions.
     ------------------------------------------------------------------
     Every reference program below is assembled and run at page load, which is
     where par comes from. If one of them is wrong, the level says its par is
     unknown rather than quietly printing a number nobody checked.
     ------------------------------------------------------------------ */
  var LEVELS = [
    {
      name: 'Absolute value',
      mode: 'reg',
      sig: 'R0 holds n, anywhere from -9999 to 9999. Leave the size of n in R0, with the sign thrown away.',
      brief: 'The whole set is here from the start, so the first two levels are about the shape of the thing ' +
        'rather than about cleverness. A conditional jump reads a flag somebody else set — usually CMP.',
      starter: '; CMP a, b sets the flag to a minus b.\n' +
        '; JG jumps when the flag came out positive.\n',
      show: [0, 2],
      tests: [
        { r: [-7], w: 7 },
        { r: [0], w: 0 },
        { r: [12], w: 12 },
        { r: [-9999], w: 9999 },
        { r: [1], w: 1 },
        { r: [-1], w: 1 }
      ],
      short: 'CMP R0, 0\nJG done\nMUL R0, -1\ndone:\n'
    },

    {
      name: 'The smaller of two',
      mode: 'reg',
      sig: 'R0 and R1 hold two numbers. Leave the smaller of them in R0. If they are equal, that value is the answer.',
      brief: 'Same shape as the first, pointing the other way. Watch which register you are comparing against ' +
        'which — CMP R0, R1 and CMP R1, R0 set opposite flags and read identically at a glance.',
      starter: '; JL jumps when the flag came out negative.\n',
      show: [0, 3],
      tests: [
        { r: [3, 9], w: 3 },
        { r: [9, 3], w: 3 },
        { r: [4, 4], w: 4 },
        { r: [-7, -2], w: -7 },
        { r: [0, -5], w: -5 },
        { r: [-5, 0], w: -5 }
      ],
      short: 'CMP R0, R1\nJL done\nMOV R0, R1\ndone:\n'
    },

    {
      name: 'Sum 1 to n',
      mode: 'reg',
      sig: 'R0 holds n, from 0 to 1000. Leave 1 + 2 + up to n in R0. n of zero means an answer of zero.',
      brief: 'The obvious answer is a loop, and a loop is not the shortest answer here. Gauss got this one as a ' +
        'schoolboy and the machine agrees with him: there is a four instruction answer with no jump in it at all. ' +
        'Note also that a loop written with DJNZ and no guard runs forever on n of zero, which is exactly the ' +
        'case the cap is there to catch.',
      starter: '; A loop works, and something shorter also works.\n' +
        '; Remember DIV truncates, and that n times n plus one is always even.\n',
      show: [0, 4],
      tests: [
        { r: [0], w: 0 },
        { r: [1], w: 1 },
        { r: [2], w: 3 },
        { r: [5], w: 15 },
        { r: [10], w: 55 },
        { r: [100], w: 5050 },
        { r: [1000], w: 500500 }
      ],
      short: 'MOV R1, R0\nADD R1, 1\nMUL R0, R1\nDIV R0, 2\n'
    },

    {
      name: 'Count the set bits',
      mode: 'reg',
      sig: 'R0 holds n, from 0 to 65535. Leave the number of 1 bits in its binary form in R0.',
      brief: 'There is no AND and no shift on this machine, so the bits have to be got at with MOD 2 and DIV 2 — ' +
        'which is what a shift is, at six times the price. That price is the lesson: this is why every bit ' +
        'twiddling trick in the book exists.',
      starter: '; MOD 2 gives you the bottom bit. DIV 2 throws it away.\n' +
        '; DIV leaves its result in the flag, so JNZ can end the loop for free.\n',
      show: [2, 4],
      tests: [
        { r: [0], w: 0 },
        { r: [1], w: 1 },
        { r: [7], w: 3 },
        { r: [8], w: 1 },
        { r: [255], w: 8 },
        { r: [1024], w: 1 },
        { r: [12345], w: 6 },
        { r: [65535], w: 16 }
      ],
      short: 'MOV R1, 0\nloop:\nMOV R2, R0\nMOD R2, 2\nADD R1, R2\nDIV R0, 2\nJNZ loop\nMOV R0, R1\n'
    },

    {
      name: 'Reverse a string in memory',
      mode: 'mem',
      sig: 'R0 holds n, from 1 to 12. Cells 0 to n-1 hold n character codes. Turn them round in place. ' +
        'R0 itself does not matter at the end.',
      brief: 'The first level where the answer lives in memory rather than in a register, and the first where ' +
        'LD and ST earn their keep. Two indices walking towards each other is the whole algorithm; the fiddly ' +
        'part is stopping at the right moment when n is odd, and when n is 1.',
      starter: '; LD R2, [R1] loads. ST [R1], R2 stores.\n' +
        '; Walk one index up and one down, and stop when they meet.\n',
      show: [1, 2],
      tests: [
        { r: [1], m: [97], wm: [97] },
        { r: [2], m: [104, 105], wm: [105, 104] },
        { r: [4], m: [103, 111, 108, 102], wm: [102, 108, 111, 103] },
        { r: [5], m: [115, 116, 97, 99, 107], wm: [107, 99, 97, 116, 115] },
        { r: [8], m: [97, 115, 115, 101, 109, 98, 108, 121], wm: [121, 108, 98, 109, 101, 115, 115, 97] },
        { r: [12], m: [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98],
          wm: [98, 97, 57, 56, 55, 54, 53, 52, 51, 50, 49, 48] }
      ],
      short: 'SUB R0, 1\nJZ done\nMOV R1, 0\nloop:\nLD R2, [R1]\nLD R3, [R0]\nST [R1], R3\nST [R0], R2\n' +
        'ADD R1, 1\nSUB R0, 1\nCMP R1, R0\nJL loop\ndone:\n'
    },

    {
      name: 'Greatest common divisor',
      mode: 'reg',
      sig: 'R0 and R1 hold two numbers, each from 1 to 10000. Leave their greatest common divisor in R0.',
      brief: 'Euclid, and it is still the answer two and a half thousand years later. Replace the pair with the ' +
        'smaller number and the remainder, over and over, until the remainder is nothing. Five instructions, ' +
        'and four of them are moves.',
      starter: '; MOD leaves the remainder in the flag as well as in the register.\n' +
        '; Nothing needs comparing. Nothing needs a counter.\n',
      show: [0, 4],
      tests: [
        { r: [12, 18], w: 6 },
        { r: [18, 12], w: 6 },
        { r: [17, 5], w: 1 },
        { r: [1, 1], w: 1 },
        { r: [100, 75], w: 25 },
        { r: [270, 192], w: 6 },
        { r: [270, 270], w: 270 },
        { r: [9999, 3333], w: 3333 }
      ],
      short: 'loop:\nMOV R2, R0\nMOD R2, R1\nMOV R0, R1\nMOV R1, R2\nJNZ loop\n'
    },

    {
      name: 'Is it prime',
      mode: 'reg',
      sig: 'R0 holds n, from 2 to 1500. Leave 1 in R0 if n is prime and 0 if it is not.',
      brief: 'THIS IS THE LEVEL WHERE THE TWO NUMBERS DISAGREE. Trial division by everything below n is the ' +
        'shortest program there is. Stopping once the divisor squared has passed n costs two more instructions ' +
        'and does a small fraction of the work — both figures are measured below rather than claimed here, so ' +
        'the size of the gap is the machine\'s answer and not mine. Par is the short one, because length is the ' +
        'score, but the cycle figure beside it is what a real processor would actually be paying.',
      starter: '; Try every divisor from 2 upwards.\n' +
        '; If you reach n itself without a clean division, it is prime.\n',
      show: [0, 3],
      tests: [
        { r: [2], w: 1 },
        { r: [3], w: 1 },
        { r: [4], w: 0 },
        { r: [9], w: 0 },
        { r: [17], w: 1 },
        { r: [25], w: 0 },
        { r: [97], w: 1 },
        { r: [100], w: 0 },
        { r: [1000], w: 0 },
        { r: [1201], w: 1 }
      ],
      short: 'MOV R1, 1\nloop:\nADD R1, 1\nCMP R1, R0\nJZ yes\nMOV R2, R0\nMOD R2, R1\nJNZ loop\n' +
        'MOV R0, 0\nRET\nyes:\nMOV R0, 1\n',
      fast: 'MOV R1, 1\nloop:\nADD R1, 1\nMOV R3, R1\nMUL R3, R1\nCMP R3, R0\nJG yes\nMOV R2, R0\n' +
        'MOD R2, R1\nJNZ loop\nMOV R0, 0\nRET\nyes:\nMOV R0, 1\n',
      fastNote: 'The second program stops as soon as the divisor squared passes n, which is the whole of the ' +
        'difference. Two instructions dearer, and it does a fraction of the work.'
    },

    {
      name: 'Fizzbuzz codes',
      mode: 'mem',
      sig: 'R0 holds n, from 0 to 15. For each i from 1 to n, write a code into cell i-1: 0 when i divides by ' +
        '15, 1 when it divides by 3, 2 when it divides by 5, and 3 otherwise.',
      brief: 'Fizzbuzz with the words taken out, because this machine has no strings — and what is left is the ' +
        'part of fizzbuzz that was ever interesting, which is the order the tests go in. Check 15 first or the ' +
        'threes will swallow it. This is also the level where PUSH and POP pay: four registers is one short of ' +
        'what the obvious version wants.',
      starter: '; Four registers: n, the index, the value being tested, the code.\n' +
        '; That is one too few, and the stack is where the spare one goes.\n',
      show: [2, 4],
      tests: [
        { r: [0], m: [], wm: [] },
        { r: [1], m: [], wm: [3] },
        { r: [3], m: [], wm: [3, 3, 1] },
        { r: [5], m: [], wm: [3, 3, 1, 3, 2] },
        { r: [7], m: [], wm: [3, 3, 1, 3, 2, 1, 3] },
        { r: [10], m: [], wm: [3, 3, 1, 3, 2, 1, 3, 3, 1, 2] },
        { r: [15], m: [], wm: [3, 3, 1, 3, 2, 1, 3, 3, 1, 2, 3, 1, 3, 3, 0] }
      ],
      short: 'MOV R1, 0\nloop:\nCMP R1, R0\nJZ done\nMOV R2, R1\nADD R2, 1\nPUSH R2\nMOV R3, 3\nMOD R2, 3\n' +
        'JNZ five\nSUB R3, 2\nfive:\nPOP R2\nMOD R2, 5\nJNZ store\nSUB R3, 1\nstore:\nST [R1], R3\n' +
        'ADD R1, 1\nJMP loop\ndone:\n'
    }
  ];

  var REFERENCE =
    '<dl class="asm-ref-list">' +
    '<dt>MOV r, v</dt><dd>Copy a register or a number into a register.</dd>' +
    '<dt>ADD / SUB r, v</dt><dd>r = r op v. One cycle each.</dd>' +
    '<dt>MUL r, v</dt><dd>Three cycles.</dd>' +
    '<dt>DIV / MOD r, v</dt><dd>Six cycles. DIV truncates towards zero; MOD takes the sign of the left side. ' +
    'A divisor of zero stops the program.</dd>' +
    '<dt>CMP a, b</dt><dd>Sets the flag to a minus b and changes nothing else.</dd>' +
    '<dt>JMP label</dt><dd>Go there.</dd>' +
    '<dt>JZ / JNZ / JG / JL label</dt><dd>Go there when the flag is zero, not zero, positive or negative.</dd>' +
    '<dt>DJNZ r, label</dt><dd>Subtract one from r, then jump when the result is not zero. One instruction ' +
    'instead of two, and the commonest way to write a loop that never ends: start it at zero and it counts ' +
    'downwards for a very long time.</dd>' +
    '<dt>LD r, [a]</dt><dd>Load from memory. Two cycles.</dd>' +
    '<dt>ST [a], v</dt><dd>Store to memory. Two cycles.</dd>' +
    '<dt>PUSH v / POP r</dt><dd>Two cycles. The stack is the top of the same memory, growing down from ' +
    'cell ' + (MEM_SIZE - 1) + '.</dd>' +
    '<dt>CALL label / RET</dt><dd>CALL pushes the address of the next instruction; RET pops one and goes ' +
    'there. RET with an empty stack ends the program.</dd>' +
    '<dt>HLT</dt><dd>Stop. Running off the last instruction stops too.</dd>' +
    '</dl>' +
    '<p class="asm-ref-note"><strong>Operands.</strong> <code>R0</code> to <code>R3</code>, a whole number such ' +
    'as <code>-3</code>, or a memory cell written <code>[6]</code> or <code>[R1]</code>. Only LD and ST take a ' +
    'memory operand: this is a load/store machine, so <code>ADD R0, [4]</code> is refused on purpose. Memory is ' +
    MEM_SIZE + ' cells and starts at zero. A label is a name with a colon after it, and everything after a ' +
    '<code>;</code> is a comment. Labels and comments are free — only instructions are counted.</p>' +
    '<p class="asm-ref-note"><strong>The flag.</strong> One signed number, standing in for the zero and sign ' +
    'flags a real machine keeps apart. ADD, SUB, MUL, DIV, MOD, DJNZ and CMP all leave their result in it. ' +
    'MOV, LD, ST, PUSH and POP do not touch it.</p>' +
    '<p class="asm-ref-note"><strong>Why CALL is here and never used.</strong> None of the eight par programs ' +
    'calls a subroutine, because on programs this short the call and the return cost more than repeating the ' +
    'body. That is not a flaw in the instruction — it is the same arithmetic that makes a compiler inline a ' +
    'small function, and it is easier to believe once you have tried to golf with it.</p>';

  /* Measure a reference program: its length and what it costs on the hidden
     battery. Returns null when the program does not survive its own tests,
     which is the point of doing this at load rather than trusting a table. */
  function measure(src, level) {
    if (!src) return null;
    var built = assemble(src);
    if (!built.ok) return null;
    var report = runTests(built.code, level);
    if (!report.pass) return null;
    return { size: report.size, cycles: report.cycles };
  }

  /* ================================================================== */

  GameShell.define({
    id: 'game-assembly-golf',
    slug: 'assembly-golf',
    title: 'Assembly golf',
    /* Declared here as well as in the manifest, because the manifest is
       build-time data that the runtime never sees. A bestOrder set only there
       would be a comment, and the shell would keep the LONGEST program as the
       record. */
    bestKey: 'assembly-golf',
    bestOrder: 'low',
    tapAction: false,
    formatBest: function (n) { return n ? String(n) : '—'; },
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var at = 0;               // which level is open
      var sources = [];         // what has been typed, per level
      var scores = [];          // the best submission per level, once it passes
      var pars = [];            // measured from the reference programs
      var fasts = [];           // measured from the quicker programs, where one exists
      var seen = [];            // which test indices are visible, per level
      var machine = null;       // the animated run, when there is one
      var accum = 0;
      var pick = 0;             // which visible case the machine panel runs
      var el = {};

      for (var i = 0; i < LEVELS.length; i++) {
        sources.push(LEVELS[i].starter);
        scores.push(null);
        seen.push(LEVELS[i].show.slice());
        pars.push(measure(LEVELS[i].short, LEVELS[i]));
        fasts.push(measure(LEVELS[i].fast, LEVELS[i]));
      }

      function list(arr) {
        return arr.length ? arr.join(' ') : 'nothing';
      }

      /* Character codes read as a word where they can. The reverse level is
         about a string, and eight numbers do not look like one. */
      function asText(codes) {
        var out = '';
        for (var i = 0; i < codes.length; i++) {
          var c = codes[i];
          if (c < 32 || c > 126) return '';
          out += String.fromCharCode(c);
        }
        return out ? ' "' + out + '"' : '';
      }

      function givenOf(test) {
        var lv = LEVELS[at];
        var txt = 'R0 = ' + test.r[0];
        if (test.r.length > 1) txt += ', R1 = ' + test.r[1];
        if (lv.mode === 'mem' && test.m && test.m.length) {
          txt += ', cells ' + list(test.m) + asText(test.m);
        }
        return txt;
      }

      function wantOf(test) {
        var lv = LEVELS[at];
        if (lv.mode === 'mem') return 'cells ' + list(test.wm) + asText(test.wm);
        return 'R0 = ' + test.w;
      }

      function gotOf(got) {
        var lv = LEVELS[at];
        if (lv.mode === 'mem') return 'cells ' + list(got) + asText(got);
        return 'R0 = ' + got;
      }

      /* --------------------------------------------------------------
         The board is built once and only ever has its text rewritten.
         -------------------------------------------------------------- */
      function build() {
        var cells = '';
        for (var c = 0; c < MEM_SIZE; c++) {
          cells += '<span class="asm-cell" data-cell="' + c + '"><b>' + c + '</b><i>0</i></span>';
        }

        host.className = 'game-board board-asm';
        host.innerHTML =
          '<div class="asm-head">' +
          '  <h3 class="asm-title" id="ag-title"></h3>' +
          '  <p class="asm-brief" id="ag-brief"></p>' +
          '  <p class="asm-io" id="ag-sig"></p>' +
          '  <p class="asm-io" id="ag-par"></p>' +
          '</div>' +
          '<div class="asm-main">' +
          '  <div class="asm-pane">' +
          '    <label class="asm-label" for="ag-src">Your program</label>' +
          '    <textarea id="ag-src" class="asm-src" rows="16" spellcheck="false" autocomplete="off" ' +
          '      autocapitalize="off" autocorrect="off" wrap="off"></textarea>' +
          '    <p class="asm-msg" id="ag-msg"></p>' +
          '  </div>' +
          '  <div class="asm-pane asm-machine">' +
          '    <div class="asm-row">' +
          '      <label class="asm-label" for="ag-pick">Machine, running</label>' +
          '      <select class="game-select asm-pick" id="ag-pick"></select>' +
          '    </div>' +
          '    <div class="asm-regs" id="ag-regs"></div>' +
          '    <p class="asm-next" id="ag-next"></p>' +
          '    <p class="asm-queue"><b>Jumps taken</b> <span id="ag-jumps">JZ</span></p>' +
          '    <p class="asm-queue"><b>Stack</b> <span id="ag-stack">empty</span></p>' +
          '    <p class="asm-queue"><b>Memory</b> <span id="ag-memnote">the cell just written is marked *, ' +
          'and a cell the stack is using is marked S</span></p>' +
          '    <div class="asm-mem" id="ag-mem">' + cells + '</div>' +
          '  </div>' +
          '</div>' +
          '<div class="asm-tests" id="ag-tests"></div>' +
          '<div class="asm-solved" id="ag-solved" hidden></div>' +
          '<details class="asm-ref"><summary>Instruction set and what each one costs</summary>' +
          REFERENCE + '</details>';

        el.title = host.querySelector('#ag-title');
        el.brief = host.querySelector('#ag-brief');
        el.sig = host.querySelector('#ag-sig');
        el.par = host.querySelector('#ag-par');
        el.src = host.querySelector('#ag-src');
        el.msg = host.querySelector('#ag-msg');
        el.pick = host.querySelector('#ag-pick');
        el.regs = host.querySelector('#ag-regs');
        el.next = host.querySelector('#ag-next');
        el.jumps = host.querySelector('#ag-jumps');
        el.stack = host.querySelector('#ag-stack');
        el.mem = host.querySelector('#ag-mem');
        el.tests = host.querySelector('#ag-tests');
        el.solved = host.querySelector('#ag-solved');
        el.cells = el.mem.querySelectorAll('.asm-cell');
        /* Cached because paintMachine runs sixteen times a second during an
           animated run, and a fresh lookup per cell per frame is several
           hundred queries a second for nothing. */
        el.cellv = [];
        el.celln = [];
        for (var q = 0; q < el.cells.length; q++) {
          el.cellv.push(el.cells[q].querySelector('i'));
          el.celln.push(el.cells[q].querySelector('b'));
        }

        el.regs.innerHTML =
          '<span class="asm-reg"><b>R0</b><i data-reg="0">0</i></span>' +
          '<span class="asm-reg"><b>R1</b><i data-reg="1">0</i></span>' +
          '<span class="asm-reg"><b>R2</b><i data-reg="2">0</i></span>' +
          '<span class="asm-reg"><b>R3</b><i data-reg="3">0</i></span>' +
          '<span class="asm-reg"><b>SP</b><i id="ag-sp">' + MEM_SIZE + '</i></span>' +
          '<span class="asm-reg asm-flag"><b>Flag</b><i id="ag-flag">0</i></span>' +
          '<span class="asm-reg"><b>Cycles</b><i id="ag-cyc">0</i></span>';
        el.regv = el.regs.querySelectorAll('[data-reg]');
        el.sp = el.regs.querySelector('#ag-sp');
        el.flag = el.regs.querySelector('#ag-flag');
        el.cyc = el.regs.querySelector('#ag-cyc');

        el.src.addEventListener('input', function () {
          sources[at] = el.src.value;
          /* An edit invalidates whatever the machine was halfway through. */
          if (machine) { machine = null; paintMachine(); }
          store();
        });

        el.pick.addEventListener('change', function () {
          /* Clamped rather than trusted. The value comes out of the DOM, and
             an index past the end of the visible list would have every
             painter reading properties off undefined. */
          var v = Number(el.pick.value);
          pick = (v >= 0 && v < visible().length) ? v : 0;
          machine = null;
          paintMachine();
        });
      }

      /* Programs are kept so that a reload does not throw the afternoon away.
         Whether a level is solved is not kept: submitting again costs nothing,
         and a stored pass would outlive the code that earned it. */
      function store() {
        try { g.save('src', JSON.stringify(sources)); } catch (e) { /* quota, private mode */ }
      }

      function restore() {
        var raw = g.load('src', '');
        if (!raw) return;
        try {
          var saved = JSON.parse(raw);
          if (Object.prototype.toString.call(saved) !== '[object Array]') return;
          for (var i = 0; i < LEVELS.length && i < saved.length; i++) {
            if (typeof saved[i] === 'string') sources[i] = saved[i];
          }
        } catch (e) { /* corrupt, ignore it */ }
      }

      /* --------------------------------------------------------------
         Painting.
         --------------------------------------------------------------
         The message line is a plain paragraph and NOT a live region, even
         though it is the thing that changes most. Everything worth hearing
         goes through g.announce() instead, so there is one live region on the
         page rather than two racing each other to read out different halves
         of the same event.
         -------------------------------------------------------------- */
      function message(text, kind, say) {
        el.msg.textContent = text || '';
        el.msg.className = 'asm-msg' + (kind ? ' is-' + kind : '');
        if (text && say !== false) g.announce(text);
      }

      function paintMachine() {
        var m = machine;
        var lv = LEVELS[at];
        var test = currentTest();
        var r;

        for (r = 0; r < 4; r++) {
          el.regv[r].textContent = m ? m.regs[r] : (test.r[r] == null ? 0 : test.r[r]);
        }
        el.sp.textContent = m ? m.sp : MEM_SIZE;
        var f = m ? m.flag : 0;
        el.flag.textContent = String(f);
        el.jumps.textContent = jumpsNow(f) + (f === 0 ? ' (the flag is zero)' : '');
        el.cyc.textContent = m ? m.cycles : 0;

        var nxt = m ? m.next() : null;
        el.next.textContent = m
          ? (m.error ? m.error : (nxt ? 'Next: ' + textOf(nxt) : 'Stopped.'))
          : 'Not running. Press Run to watch it, or Step to walk it.';
        el.next.className = 'asm-next' + (m && m.error ? ' is-bad' : '');

        var depth = m ? MEM_SIZE - m.sp : 0;
        if (!depth) {
          el.stack.textContent = 'empty';
        } else {
          var vals = [];
          for (r = m.sp; r < MEM_SIZE; r++) vals.push(m.mem[r]);
          el.stack.textContent = depth + ' deep, top first: ' + vals.join(' ');
        }

        for (r = 0; r < MEM_SIZE; r++) {
          var v = m ? m.mem[r] : (test.m && test.m[r] != null ? test.m[r] : 0);
          var onStack = !!m && r >= m.sp;
          var justWritten = !!m && m.touched === r;
          el.cellv[r].textContent = v;
          /* The asterisk and the S are not decoration. is-touched only tints
             the cell, and colour on its own is not allowed to carry a fact
             here — so the cell just written says so in a character, and so
             does a cell the stack has taken over. */
          el.celln[r].textContent = String(r) + (justWritten ? '*' : '') + (onStack ? 'S' : '');
          el.cells[r].className = 'asm-cell' +
            (v !== 0 || onStack ? ' is-set' : '') +
            (justWritten ? ' is-touched' : '');
        }
      }

      /* Which test indices the player can see. Starts as the two examples and
         grows by one every time a hidden case catches them out — a case that
         has already done its job is no longer worth hiding. */
      function visible() {
        return seen[at];
      }

      /* The case the machine panel is pointed at. Every reader goes through
         here so that a picker index which has fallen out of range — a level
         change, a restore, a value edited in the inspector — degrades to the
         first example rather than to an exception in the paint loop. */
      function currentTest() {
        var lv = LEVELS[at];
        var vis = visible();
        var idx = vis[pick];
        if (idx == null || !lv.tests[idx]) idx = vis[0];
        return lv.tests[idx];
      }

      function paintTests(failIdx, got, err) {
        var lv = LEVELS[at];
        var vis = visible();
        var out = '<h4 class="asm-tests-head">' + lv.tests.length + ' hidden test cases, ' +
          vis.length + ' of them shown</h4><ul class="asm-test-list">';
        for (var i = 0; i < vis.length; i++) {
          var idx = vis[i];
          var t = lv.tests[idx];
          var bad = idx === failIdx;
          out += '<li class="asm-test' + (bad ? ' is-fail' : '') + '">' +
            '<code>given ' + esc(givenOf(t)) + '</code>' +
            '<code>wants ' + esc(wantOf(t)) + '</code>';
          if (bad) {
            out += '<span class="asm-mark">fails: ' +
              esc(err ? err : 'your program left ' + gotOf(got)) + '</span>';
          }
          out += '</li>';
        }
        out += '</ul>';
        el.tests.innerHTML = out;
      }

      function parLine() {
        var p = pars[at];
        if (!p) return 'Par could not be measured on this level, which means the reference program is broken. ' +
          'Treat any number here with suspicion.';
        var txt = 'Par is ' + p.size + ' instruction' + (p.size === 1 ? '' : 's') + ', ' +
          p.cycles + ' cycles over the hidden cases. That is the shortest I found, not the shortest possible, ' +
          'and beating it is the interesting part.';
        var f = fasts[at];
        if (f && f.cycles < p.cycles) {
          txt += ' The quickest I found is ' + f.size + ' instructions and ' + f.cycles + ' cycles, so on this ' +
            'level the shortest program is not the fastest one and you cannot have both.';
        }
        return txt;
      }

      function paintLevel() {
        var lv = LEVELS[at];
        el.title.textContent = 'Level ' + (at + 1) + ' of ' + LEVELS.length + ' — ' + lv.name;
        el.brief.textContent = lv.brief;
        el.sig.textContent = lv.sig;
        el.par.textContent = parLine();
        el.src.value = sources[at];

        fillPicker();
        machine = null;
        paintMachine();
        paintTests(-1, null, null);
        paintSolved();
        message('', null);
        g.stat('level', (at + 1) + '/' + LEVELS.length);
        g.announce('Level ' + (at + 1) + ', ' + lv.name + '. ' + lv.sig + ' ' + parLine());
      }

      function fillPicker() {
        var lv = LEVELS[at];
        var vis = visible();
        var opts = '';
        for (var i = 0; i < vis.length; i++) {
          opts += '<option value="' + i + '">' + esc(givenOf(lv.tests[vis[i]])) + '</option>';
        }
        el.pick.innerHTML = opts;
        if (pick >= vis.length) pick = 0;
        el.pick.value = String(pick);
      }

      function paintSolved() {
        var s = scores[at];
        var p = pars[at];
        if (!s) { el.solved.hidden = true; el.solved.innerHTML = ''; return; }
        var line = 'Level ' + (at + 1) + ' passes all ' + LEVELS[at].tests.length + ' cases in ' +
          s.size + ' instruction' + (s.size === 1 ? '' : 's') + ', costing ' + s.cycles + ' cycles.';
        if (p) {
          if (s.size < p.size) line += ' That is under par, which means par was wrong and this is now the ' +
            'shortest known.';
          else if (s.size === p.size) line += ' That is level par.';
          else line += ' Par is ' + p.size + ', so there are ' + (s.size - p.size) + ' to come off.';
          if (s.cycles < p.cycles && s.size >= p.size) {
            line += ' It is also quicker than par, which is a different prize.';
          }
        }
        el.solved.hidden = false;
        el.solved.innerHTML =
          '<p class="asm-solved-line">' + esc(line) + '</p>' +
          '<button class="game-btn" type="button" id="ag-show" aria-pressed="false">Show the programs par was measured from</button>' +
          '<pre class="asm-worked" id="ag-worked" hidden></pre>';
        var btn = el.solved.querySelector('#ag-show');
        btn.addEventListener('click', function () {
          var pre = el.solved.querySelector('#ag-worked');
          var show = pre.hidden;
          pre.hidden = !show;
          btn.setAttribute('aria-pressed', String(show));
          btn.textContent = show ? 'Hide the reference programs' : 'Show the programs par was measured from';
          var lv = LEVELS[at];
          var body = '; the shortest I found\n' + lv.short;
          if (lv.fast) body += '\n; the quickest I found\n' + lv.fast + '\n; ' + lv.fastNote + '\n';
          pre.textContent = body;
        });
      }

      function total() {
        var sum = 0;
        var cyc = 0;
        var done = 0;
        for (var i = 0; i < scores.length; i++) {
          if (scores[i]) { sum += scores[i].size; cyc += scores[i].cycles; done++; }
        }
        g.setScore(sum);
        g.stat('cycles', cyc);
        return { sum: sum, cycles: cyc, done: done };
      }

      function parTotal() {
        var sum = 0;
        for (var i = 0; i < pars.length; i++) if (pars[i]) sum += pars[i].size;
        return sum;
      }

      /* --------------------------------------------------------------
         The three actions.
         -------------------------------------------------------------- */
      function built() {
        var res = assemble(sources[at]);
        if (!res.ok) { message(res.error, 'bad'); g.beep(190, 0.09, 'square'); return null; }
        return res.code;
      }

      function load() {
        var code = built();
        if (!code) return null;
        machine = new Machine(code, currentTest());
        return machine;
      }

      /* Said once, when a watched run stops, however it stopped. Watching a
         program end and being told nothing about what it left behind is the
         most annoying thing a machine simulator can do. */
      function reportRun(prefix) {
        if (!machine || !machine.done || machine.reported) return;
        machine.reported = true;
        if (machine.error) {
          message(machine.error, 'bad');
          g.beep(190, 0.09, 'square');
          return;
        }
        var lv = LEVELS[at];
        var test = currentTest();
        var ok = correct(machine, lv, test);
        message((prefix || '') + 'It stopped after ' + machine.cycles + ' cycles and left ' +
          gotOf(resultOf(machine, lv, test)) +
          (ok ? ', which is right for this case. Submit to try the hidden ones.'
              : ', and this case wants ' + wantOf(test) + '.'),
          ok ? 'good' : 'bad');
        g.beep(ok ? 690 : 220, 0.06, ok ? 'sine' : 'square');
      }

      function doStep() {
        if (!machine || machine.done) { if (!load()) return; }
        machine.step();
        paintMachine();
        reportRun();
      }

      function doRun() {
        if (!load()) return;
        var test = currentTest();
        /* Watching three hundred instructions go past is not watching, it is
           waiting. Anything longer runs in one go and is shown as an end
           state, which is what was wanted at that length anyway. */
        var dry = new Machine(machine.code, test).finish();
        if (dry.cycles > WATCHABLE) {
          machine = dry;
          paintMachine();
          reportRun(dry.cycles + ' cycles is more than is worth watching, so it ran in one go. ');
          return;
        }
        accum = 0;
        message('Running one case. Watch SP and the flag as much as the registers.', null, false);
      }

      function doSubmit() {
        var code = built();
        if (!code) return;
        machine = null;
        paintMachine();

        var lv = LEVELS[at];
        var report = runTests(code, lv);

        if (!report.pass) {
          var idx = report.firstBad;
          var res = report.results[idx];
          /* A hidden case that has caught somebody is no longer worth hiding.
             It goes on the visible list, the picker gains it, and the machine
             panel is pointed at it, because that is the case that now has to
             be stepped through. */
          var vis = visible();
          var found = -1;
          for (var i = 0; i < vis.length; i++) if (vis[i] === idx) found = i;
          if (found < 0) { vis.push(idx); found = vis.length - 1; }
          pick = found;
          fillPicker();
          paintTests(idx, res.got, res.error);
          paintMachine();
          message(res.error
            ? 'A hidden case broke it: ' + res.error + ' The case is now shown below and loaded into the machine.'
            : 'A hidden case fails. It wanted ' + wantOf(lv.tests[idx]) + ' and got ' + gotOf(res.got) +
              '. It is now shown below and loaded into the machine.', 'bad');
          g.beep(190, 0.09, 'square');
          return;
        }

        paintTests(-1, null, null);
        var better = !scores[at] || report.size < scores[at].size ||
          (report.size === scores[at].size && report.cycles < scores[at].cycles);
        if (better) scores[at] = { size: report.size, cycles: report.cycles };
        paintSolved();
        g.pluck(720, 0.4, 0.06);

        var tally = total();
        var p = pars[at];
        var note = 'All ' + lv.tests.length + ' cases pass: ' + report.size + ' instructions, ' +
          report.cycles + ' cycles.';
        if (p && report.size > p.size) note += ' Par is ' + p.size + '.';
        else if (p && report.size === p.size) note += ' That is par.';
        else if (p) note += ' That is under par.';
        if (!better) note += ' Your best on this level is still ' + scores[at].size + '.';
        message(note, 'good');

        if (tally.done === LEVELS.length) {
          g.over({
            won: true,
            score: tally.sum,
            title: 'All eight written',
            message: tally.sum + ' instructions in total against a par of ' + parTotal() + ', costing ' +
              tally.cycles + ' cycles. Length is the score here, so the lower number is the better one — ' +
              'and the cycle figure is the price you did not pay for it.'
          });
        }
      }

      /* --------------------------------------------------------------
         Toolbar wiring. The controls are in the page markup rather than
         built here, for the same reason the HUD is: a select that appears
         after hydration is a control that moves under the pointer.
         -------------------------------------------------------------- */
      function wire() {
        var sel = g.el.querySelector('#game-level');
        if (sel) {
          sel.addEventListener('change', function () {
            at = Number(sel.value) || 0;
            if (at < 0 || at >= LEVELS.length) at = 0;
            pick = 0;
            paintLevel();
          });
          el.levelSel = sel;
        }
        var runBtn = g.el.querySelector('#game-run');
        var stepBtn = g.el.querySelector('#game-step');
        var subBtn = g.el.querySelector('#game-submit');
        if (runBtn) runBtn.addEventListener('click', doRun);
        if (stepBtn) stepBtn.addEventListener('click', doStep);
        if (subBtn) subBtn.addEventListener('click', doSubmit);
      }

      build();
      restore();
      wire();

      return {
        reset: function () {
          /* Restart clears the scores and the machine but leaves the typed
             programs alone. The shell calls this at boot as well, and wiping
             the restored source there would make saving it pointless. */
          at = 0;
          pick = 0;
          machine = null;
          for (var i = 0; i < scores.length; i++) {
            scores[i] = null;
            seen[i] = LEVELS[i].show.slice();
          }
          if (el.levelSel) el.levelSel.value = '0';
          g.setScore(0);
          g.stat('cycles', 0);
          paintLevel();
        },

        update: function (dt) {
          if (!machine || machine.done) return;
          accum += dt;
          while (accum >= STEP_EVERY && machine && !machine.done) {
            accum -= STEP_EVERY;
            machine.step();
          }
          paintMachine();
          reportRun();
        }
      };
    }
  });
})();

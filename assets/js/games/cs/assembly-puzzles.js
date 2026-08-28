/* ==========================================================================
   assembly-puzzles.js — a fifteen-instruction machine and eight problems.
   --------------------------------------------------------------------------
   PAR IS MEASURED, NOT WRITTEN DOWN. Every level ships a reference solution
   as source text, and its par figure is produced by assembling and running
   that text in this same machine when the level opens. A par typed into a
   table is wrong the first time anybody changes what an instruction costs,
   and nobody notices for a year. It also means the eight reference programs
   are executed on every visit, so a broken one is visible immediately rather
   than sitting in a file being trusted.

   ARITHMETIC SETS THE FLAG, NOT ONLY CMP. ADD, SUB, MUL, INC and DEC all
   leave the flag holding their result, exactly as a real machine leaves ZF
   and SF set. Restricting flags to CMP would be simpler to explain and would
   make every countdown loop carry a redundant compare it does not need — and
   would then teach a habit that is wrong on the hardware this imitates.

   COST COUNTS CYCLES ACROSS EVERY TEST CASE, not the one you happen to be
   watching. A program that gets the first case right by accident and loops
   forever on the fourth should not be able to post a low number.
   ========================================================================== */

(function () {
  'use strict';

  var MEM_SIZE = 32;
  var MAX_CYCLES = 20000;      // a runaway loop has to end somewhere
  var MAX_OUTPUT = 64;
  var LIMIT = 2147483647;      // values outside this are a mistake, not a wrap
  var WATCHABLE = 400;         // longer than this and the animation is pointless
  var STEP_EVERY = 0.05;       // seconds per instruction while animating

  var MNEM = {
    MOV: { n: 2, k: ['dst', 'any'] },
    ADD: { n: 2, k: ['dst', 'any'] },
    SUB: { n: 2, k: ['dst', 'any'] },
    MUL: { n: 2, k: ['dst', 'any'] },
    CMP: { n: 2, k: ['any', 'any'] },
    INC: { n: 1, k: ['dst'] },
    DEC: { n: 1, k: ['dst'] },
    JMP: { n: 1, k: ['lbl'] },
    JE: { n: 1, k: ['lbl'] },
    JNE: { n: 1, k: ['lbl'] },
    JG: { n: 1, k: ['lbl'] },
    JL: { n: 1, k: ['lbl'] },
    IN: { n: 1, k: ['dst'] },
    OUT: { n: 1, k: ['any'] },
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

  /* ------------------------------------------------------------------
     Assembler.
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

  /* Only ever reached once operand() has already refused the text. R7 would
     otherwise parse as a perfectly good label name, so the complaint would be
     about labels and would send the player looking in the wrong place. */
  function operandFault(s) {
    var inner = /^\[\s*(.+?)\s*\]$/.exec(s);
    var bare = inner ? inner[1] : s;
    if (/^[Rr]\d+$/.test(bare)) {
      return 'this machine has R0, R1, R2 and R3 only, so "' + bare + '" does not exist.';
    }
    if (inner) {
      return 'a memory operand is a fixed cell like [6] or a register holding an address like [R1]. ' +
        '"' + s + '" is neither.';
    }
    return 'cannot read the operand "' + s + '".';
  }

  function assemble(src, banned) {
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

      /* A label may sit alone on its line or in front of an instruction, and
         several may stack up in front of the same one. */
      while (line) {
        m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
        if (!m) break;
        var name = m[1].toUpperCase();
        if (sigOf(name)) return fail(i, '"' + m[1] + '" is an instruction name, so it cannot be a label.');
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
      if (banned && banned.length) {
        for (p = 0; p < banned.length; p++) {
          if (banned[p] === mnem) return fail(i, mnem + ' is not allowed on this level — that is the whole puzzle.');
        }
      }

      var rest = trim(m[3] || '');
      var ops = [];
      if (rest) {
        var parts = rest.split(',');
        for (p = 0; p < parts.length; p++) {
          var text = trim(parts[p]);
          if (!text) return fail(i, 'there is an empty operand — probably a stray comma.');
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
        /* R5 is a valid label name, so it survives operand() and only turns
           out to be wrong here. Say what is actually wrong with it. */
        if (t === 'label' && kind !== 'lbl' && /^[Rr]\d+$/.test(ops[p].raw)) {
          return fail(i, operandFault(ops[p].raw));
        }
        if (kind === 'dst' && t !== 'reg' && t !== 'mem') {
          return fail(i, mnem + ' writes to its first operand, so it must be a register or a memory cell, not "' + ops[p].raw + '".');
        }
        if (kind === 'any' && t === 'label') {
          return fail(i, '"' + ops[p].raw + '" is not a value. Use a register, a number, or a memory cell.');
        }
        if (kind === 'lbl' && t !== 'label') {
          return fail(i, mnem + ' jumps to a label, and "' + ops[p].raw + '" is not one.');
        }
      }

      code.push({ op: mnem, ops: ops, line: i + 1 });
    }

    if (!code.length) return { ok: false, error: 'There is nothing to run yet.' };

    for (i = 0; i < code.length; i++) {
      if (sigOf(code[i].op).k[0] === 'lbl') {
        var target = code[i].ops[0].v;
        if (!has(labels, target)) {
          return { ok: false, error: 'Line ' + code[i].line + ': there is no label called "' + code[i].ops[0].raw + '".' };
        }
        code[i].target = labels[target];
      }
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
     ------------------------------------------------------------------ */
  function Machine(code, input) {
    this.code = code;
    this.regs = [0, 0, 0, 0];
    this.mem = [];
    for (var i = 0; i < MEM_SIZE; i++) this.mem.push(0);
    this.pc = 0;
    this.flag = 0;
    this.input = input.slice();
    this.inAt = 0;
    this.out = [];
    this.cycles = 0;
    this.done = false;
    this.error = null;
    this.touched = -1;          // last memory cell written, for the display
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

  Machine.prototype.write = function (o, v) {
    if (v > LIMIT || v < -LIMIT) {
      this.fail('The value ' + v + ' is bigger than this machine can hold.');
      return;
    }
    if (o.t === 'reg') { this.regs[o.v] = v; return; }
    var a = this.addrOf(o);
    if (a >= 0) { this.mem[a] = v; this.touched = a; }
  };

  Machine.prototype.next = function () {
    if (this.done || this.pc < 0 || this.pc >= this.code.length) return null;
    return this.code[this.pc];
  };

  Machine.prototype.step = function () {
    if (this.done) return false;
    if (this.pc < 0 || this.pc >= this.code.length) { this.done = true; return false; }
    if (this.cycles >= MAX_CYCLES) {
      this.fail('Still running after ' + MAX_CYCLES + ' instructions. Almost always a loop with no way out.');
      return false;
    }

    var ins = this.code[this.pc];
    var a = ins.ops[0];
    var b = ins.ops[1];
    var op = ins.op;
    var v;

    this.pc++;
    this.cycles++;

    if (op === 'MOV') { this.write(a, this.read(b)); }
    else if (op === 'ADD') { v = this.read(a) + this.read(b); this.write(a, v); this.flag = v; }
    else if (op === 'SUB') { v = this.read(a) - this.read(b); this.write(a, v); this.flag = v; }
    else if (op === 'MUL') { v = this.read(a) * this.read(b); this.write(a, v); this.flag = v; }
    else if (op === 'INC') { v = this.read(a) + 1; this.write(a, v); this.flag = v; }
    else if (op === 'DEC') { v = this.read(a) - 1; this.write(a, v); this.flag = v; }
    else if (op === 'CMP') { this.flag = this.read(a) - this.read(b); }
    else if (op === 'JMP') { this.pc = ins.target; }
    else if (op === 'JE') { if (this.flag === 0) this.pc = ins.target; }
    else if (op === 'JNE') { if (this.flag !== 0) this.pc = ins.target; }
    else if (op === 'JG') { if (this.flag > 0) this.pc = ins.target; }
    else if (op === 'JL') { if (this.flag < 0) this.pc = ins.target; }
    else if (op === 'IN') {
      if (this.inAt >= this.input.length) { this.fail('IN was reached with no input left to read.'); return false; }
      this.write(a, this.input[this.inAt++]);
    } else if (op === 'OUT') {
      this.out.push(this.read(a));
      if (this.out.length > MAX_OUTPUT) this.fail('More than ' + MAX_OUTPUT + ' values printed. Something is not stopping.');
    } else if (op === 'HLT') {
      this.done = true;
    }

    return !this.done;
  };

  Machine.prototype.finish = function () {
    while (this.step()) { /* the guards inside step() end this */ }
    return this;
  };

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* Run every test case for a level. Cost is instructions written plus every
     cycle spent across all of them. */
  function runTests(code, level) {
    var results = [];
    var cycles = 0;
    var pass = true;
    for (var i = 0; i < level.tests.length; i++) {
      var m = new Machine(code, level.tests[i].i).finish();
      var ok = !m.error && sameList(m.out, level.tests[i].o);
      cycles += m.cycles;
      if (!ok) pass = false;
      results.push({ ok: ok, got: m.out, error: m.error, cycles: m.cycles });
    }
    return { pass: pass, results: results, cycles: cycles, size: code.length, cost: code.length + cycles };
  }

  /* ------------------------------------------------------------------
     The eight problems.
     ------------------------------------------------------------------ */
  var LEVELS = [
    {
      name: 'Copy a value',
      brief: 'Read one number and print it back, unchanged. This one is done for you — read it, run it, ' +
        'and step through it once so you can see where the value goes.',
      io: 'In: one number. Out: the same number.',
      starter: '; IN takes the next input value and puts it somewhere.\n' +
        '; OUT prints whatever you give it.\n' +
        'IN R0\n' +
        'OUT R0\n',
      solution: 'IN R0\nOUT R0\n',
      tests: [
        { i: [7], o: [7] },
        { i: [0], o: [0] },
        { i: [-4], o: [-4] },
        { i: [255], o: [255] }
      ]
    },
    {
      name: 'Add two numbers',
      brief: 'Read two numbers and print their sum. Note that ADD writes into its first operand: ' +
        'ADD R0, R1 means R0 = R0 + R1. There is no three-operand form.',
      io: 'In: two numbers. Out: their sum.',
      starter: '; Two IN instructions, then ADD, then OUT.\n',
      solution: 'IN R0\nIN R1\nADD R0, R1\nOUT R0\n',
      tests: [
        { i: [3, 4], o: [7] },
        { i: [0, 0], o: [0] },
        { i: [-5, 12], o: [7] },
        { i: [100, 250], o: [350] }
      ]
    },
    {
      name: 'The larger of two',
      brief: 'Read two numbers and print the larger. If they are equal, print that value. ' +
        'CMP a, b sets the flag to a minus b, and JG jumps when the flag is positive.',
      io: 'In: two numbers. Out: the larger one.',
      starter: '; CMP sets the flag. JG jumps if it came out positive.\n' +
        '; Remember a label is a name with a colon on the end.\n',
      solution: 'IN R0\nIN R1\nCMP R0, R1\nJG keep\nMOV R0, R1\nkeep:\nOUT R0\n',
      tests: [
        { i: [3, 9], o: [9] },
        { i: [9, 3], o: [9] },
        { i: [4, 4], o: [4] },
        { i: [-7, -2], o: [-2] },
        { i: [-2, -7], o: [-2] }
      ]
    },
    {
      name: 'Sum a list',
      brief: 'The first input says how many numbers follow. Read them all and print the total. ' +
        'A count of zero means print zero, so test the counter before you read, not after.',
      io: 'In: a count n, then n numbers. Out: their sum.',
      starter: '; Keep the count in one register and the running total in another.\n' +
        '; Check the count at the TOP of the loop so n = 0 still works.\n',
      solution: 'IN R0\nMOV R1, 0\nloop:\nCMP R0, 0\nJE done\nIN R2\nADD R1, R2\nDEC R0\nJMP loop\ndone:\nOUT R1\nHLT\n',
      tests: [
        { i: [3, 1, 2, 3], o: [6] },
        { i: [1, 42], o: [42] },
        { i: [0], o: [0] },
        { i: [5, 2, 4, 6, 8, 10], o: [30] },
        { i: [4, -1, -2, 3, 0], o: [0] }
      ]
    },
    {
      name: 'Count down',
      brief: 'Read one number n and print n, then n minus one, and so on down to 1. ' +
        'If n is zero, print nothing at all.',
      io: 'In: one number n, zero or more. Out: n down to 1.',
      starter: '; DEC sets the flag from its result, so DEC then JNE is a whole loop.\n',
      solution: 'IN R0\nloop:\nCMP R0, 0\nJE done\nOUT R0\nDEC R0\nJMP loop\ndone:\nHLT\n',
      tests: [
        { i: [5], o: [5, 4, 3, 2, 1] },
        { i: [1], o: [1] },
        { i: [0], o: [] },
        { i: [3], o: [3, 2, 1] },
        { i: [9], o: [9, 8, 7, 6, 5, 4, 3, 2, 1] }
      ]
    },
    {
      name: 'Multiply without MUL',
      brief: 'Read two numbers, zero or positive, and print their product — but MUL is switched off on ' +
        'this level. Repeated addition is how a machine without a multiplier does it, and it is why ' +
        'multiplying used to be so much dearer than adding.',
      io: 'In: two numbers, each zero or more. Out: their product.',
      banned: ['MUL'],
      starter: '; Add one of them to a total, the other one\'s worth of times.\n' +
        '; Either input may be zero, so test before the first addition.\n',
      solution: 'IN R0\nIN R1\nMOV R2, 0\nloop:\nCMP R1, 0\nJE done\nADD R2, R0\nDEC R1\nJMP loop\ndone:\nOUT R2\nHLT\n',
      tests: [
        { i: [3, 4], o: [12] },
        { i: [0, 7], o: [0] },
        { i: [7, 0], o: [0] },
        { i: [1, 9], o: [9] },
        { i: [6, 6], o: [36] },
        { i: [12, 5], o: [60] }
      ]
    },
    {
      name: 'Largest in a list',
      brief: 'The first input is a count of at least one, then that many numbers. Print the largest. ' +
        'They can be negative, so starting your best-so-far at zero will get four of these six wrong.',
      io: 'In: a count n of 1 or more, then n numbers. Out: the largest.',
      starter: '; Take the first value as the best so far, then compare the rest against it.\n',
      solution: 'IN R0\nIN R1\nDEC R0\nloop:\nCMP R0, 0\nJE done\nIN R2\nCMP R2, R1\nJL skip\nMOV R1, R2\nskip:\nDEC R0\nJMP loop\ndone:\nOUT R1\nHLT\n',
      tests: [
        { i: [4, 3, 9, 2, 7], o: [9] },
        { i: [1, 5], o: [5] },
        { i: [3, -4, -9, -1], o: [-1] },
        { i: [5, 2, 2, 2, 2, 2], o: [2] },
        { i: [4, 1, 2, 3, 4], o: [4] },
        { i: [4, 9, 1, 2, 3], o: [9] }
      ]
    },
    {
      name: 'Reverse a list',
      brief: 'A count, then that many numbers. Print them back to front. There is nowhere to keep them ' +
        'but memory: [R1] means the cell whose address is in R1, which is the only way to walk an array ' +
        'on a machine with four registers.',
      io: 'In: a count n, then n numbers. Out: the same numbers, last first.',
      starter: '; Fill memory going up, then read it back going down.\n' +
        '; MOV [R1], R2 stores. MOV R2, [R1] loads.\n',
      solution: 'IN R0\nMOV R1, 0\nfill:\nCMP R0, 0\nJE back\nIN R2\nMOV [R1], R2\nINC R1\nDEC R0\nJMP fill\n' +
        'back:\nCMP R1, 0\nJE done\nDEC R1\nMOV R2, [R1]\nOUT R2\nJMP back\ndone:\nHLT\n',
      tests: [
        { i: [3, 1, 2, 3], o: [3, 2, 1] },
        { i: [1, 8], o: [8] },
        { i: [0], o: [] },
        { i: [5, 10, 20, 30, 40, 50], o: [50, 40, 30, 20, 10] },
        { i: [2, -1, 7], o: [7, -1] }
      ]
    }
  ];

  var REFERENCE =
    '<dl class="asm-ref-list">' +
    '<dt>MOV dst, src</dt><dd>Copy src into dst.</dd>' +
    '<dt>ADD / SUB / MUL dst, src</dt><dd>dst = dst op src. The result is left in dst.</dd>' +
    '<dt>INC r / DEC r</dt><dd>Add or subtract one.</dd>' +
    '<dt>CMP a, b</dt><dd>Sets the flag to a minus b. Nothing else changes.</dd>' +
    '<dt>JMP label</dt><dd>Go there.</dd>' +
    '<dt>JE / JNE / JG / JL label</dt><dd>Go there if the flag is zero, not zero, positive or negative.</dd>' +
    '<dt>IN dst</dt><dd>Take the next input value. Running out is an error.</dd>' +
    '<dt>OUT src</dt><dd>Print a value.</dd>' +
    '<dt>HLT</dt><dd>Stop. Running off the end of the program stops too.</dd>' +
    '</dl>' +
    '<p class="asm-ref-note">Operands are <code>R0</code> to <code>R3</code>, a whole number such as ' +
    '<code>-3</code>, a fixed cell such as <code>[6]</code>, or the cell a register points at, ' +
    '<code>[R1]</code>. Memory is ' + MEM_SIZE + ' cells and starts at zero. A label is a name with a ' +
    'colon after it. Everything after a <code>;</code> is a comment.</p>' +
    '<p class="asm-ref-note"><strong>The flag.</strong> ADD, SUB, MUL, INC, DEC and CMP all leave the flag ' +
    'holding their result, so <code>DEC R0</code> followed by <code>JNE loop</code> is a complete loop. ' +
    'MOV, IN and OUT do not touch it.</p>';

  /* ================================================================== */

  GameShell.define({
    id: 'game-assembly-puzzles',
    slug: 'assembly-puzzles',
    title: 'Assembly puzzles',
    bestKey: 'assembly-puzzles',
    bestOrder: 'low',
    formatBest: function (n) { return n ? String(n) : '—'; },
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,
    tapAction: false,

    setup: function (g) {
      var host = g.board;
      var at = 0;                 // which level is open
      var sources = [];           // what the player has typed, per level
      var scores = [];            // { size, cycles, cost } once a level passes
      var pars = [];              // measured from the reference solutions
      var machine = null;         // the animated run, when there is one
      var accum = 0;
      var pick = 0;               // which test case the machine panel runs
      var el = {};

      for (var i = 0; i < LEVELS.length; i++) {
        sources.push(LEVELS[i].starter);
        scores.push(null);
        /* See the header: par is whatever the reference solution actually
           costs today. The guard is only so a mistake in one of them cannot
           take the whole board down with it. */
        var ref = assemble(LEVELS[i].solution, LEVELS[i].banned);
        pars.push(ref.ok ? runTests(ref.code, LEVELS[i]).cost : 0);
      }

      function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function list(arr) {
        return arr.length ? arr.join(' ') : '—';
      }

      /* --------------------------------------------------------------
         Build the board once. Everything after this only writes text.
         -------------------------------------------------------------- */
      function build() {
        var cells = '';
        for (var c = 0; c < MEM_SIZE; c++) {
          cells += '<span class="asm-cell" data-cell="' + c + '"><b>' + c + '</b><i>0</i></span>';
        }

        host.className = 'game-board board-asm';
        host.innerHTML =
          '<div class="asm-head">' +
          '  <h3 class="asm-title" id="asm-title"></h3>' +
          '  <p class="asm-brief" id="asm-brief"></p>' +
          '  <p class="asm-io" id="asm-io"></p>' +
          '</div>' +
          '<div class="asm-main">' +
          '  <div class="asm-pane">' +
          '    <label class="asm-label" for="asm-src">Your program</label>' +
          '    <textarea id="asm-src" class="asm-src" rows="16" spellcheck="false" autocomplete="off" ' +
          '      autocapitalize="off" autocorrect="off" wrap="off"></textarea>' +
          '    <p class="asm-msg" id="asm-msg" role="status" aria-live="polite"></p>' +
          '  </div>' +
          '  <div class="asm-pane asm-machine">' +
          '    <div class="asm-row">' +
          '      <label class="asm-label" for="asm-pick">Machine, running test</label>' +
          '      <select class="game-select asm-pick" id="asm-pick"></select>' +
          '    </div>' +
          '    <div class="asm-regs" id="asm-regs"></div>' +
          '    <p class="asm-next" id="asm-next"></p>' +
          '    <p class="asm-queue"><b>Input left</b> <span id="asm-in">—</span></p>' +
          '    <p class="asm-queue"><b>Printed</b> <span id="asm-out">—</span></p>' +
          '    <div class="asm-mem" id="asm-mem">' + cells + '</div>' +
          '  </div>' +
          '</div>' +
          '<div class="asm-tests" id="asm-tests"></div>' +
          '<div class="asm-solved" id="asm-solved" hidden></div>' +
          '<details class="asm-ref"><summary>Instruction set</summary>' + REFERENCE + '</details>';

        el.title = host.querySelector('#asm-title');
        el.brief = host.querySelector('#asm-brief');
        el.io = host.querySelector('#asm-io');
        el.src = host.querySelector('#asm-src');
        el.msg = host.querySelector('#asm-msg');
        el.pick = host.querySelector('#asm-pick');
        el.regs = host.querySelector('#asm-regs');
        el.next = host.querySelector('#asm-next');
        el.inq = host.querySelector('#asm-in');
        el.outq = host.querySelector('#asm-out');
        el.mem = host.querySelector('#asm-mem');
        el.tests = host.querySelector('#asm-tests');
        el.solved = host.querySelector('#asm-solved');
        el.cells = el.mem.querySelectorAll('.asm-cell');
        /* The value nodes are cached because paintMachine runs twenty times
           a second during an animated run, and a fresh querySelector per
           cell per frame is a thousand lookups a second for nothing. */
        el.cellv = [];
        for (var q = 0; q < el.cells.length; q++) el.cellv.push(el.cells[q].querySelector('i'));

        el.regs.innerHTML =
          '<span class="asm-reg"><b>R0</b><i data-reg="0">0</i></span>' +
          '<span class="asm-reg"><b>R1</b><i data-reg="1">0</i></span>' +
          '<span class="asm-reg"><b>R2</b><i data-reg="2">0</i></span>' +
          '<span class="asm-reg"><b>R3</b><i data-reg="3">0</i></span>' +
          '<span class="asm-reg asm-flag"><b>Flag</b><i id="asm-flagv">= 0</i></span>' +
          '<span class="asm-reg"><b>Cycles</b><i id="asm-cyc">0</i></span>';
        el.regv = el.regs.querySelectorAll('[data-reg]');
        el.flag = el.regs.querySelector('#asm-flagv');
        el.cyc = el.regs.querySelector('#asm-cyc');

        el.src.addEventListener('input', function () {
          sources[at] = el.src.value;
          /* An edit invalidates whatever the machine is halfway through. */
          if (machine) { machine = null; paintMachine(); }
          store();
        });

        el.pick.addEventListener('change', function () {
          pick = Number(el.pick.value) || 0;
          machine = null;
          paintMachine();
        });
      }

      /* Programs are kept so a reload does not throw the afternoon away.
         Progress deliberately is not: Check takes no time, and a stored
         "solved" flag would let a passing score outlive the code that
         earned it. */
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
         -------------------------------------------------------------- */
      function message(text, kind) {
        el.msg.textContent = text || '';
        el.msg.className = 'asm-msg' + (kind ? ' is-' + kind : '');
      }

      function paintMachine() {
        var m = machine;
        var r;
        for (r = 0; r < 4; r++) el.regv[r].textContent = m ? m.regs[r] : 0;
        var f = m ? m.flag : 0;
        el.flag.textContent = f === 0 ? '= 0' : (f > 0 ? '> 0' : '< 0');
        el.cyc.textContent = m ? m.cycles : 0;

        var nxt = m ? m.next() : null;
        el.next.textContent = m
          ? (m.error ? m.error : (nxt ? 'Next: ' + textOf(nxt) : 'Halted.'))
          : 'Not running. Press Run or Step.';
        el.next.className = 'asm-next' + (m && m.error ? ' is-bad' : '');

        var left = [];
        if (m) { for (r = m.inAt; r < m.input.length; r++) left.push(m.input[r]); }
        else { left = LEVELS[at].tests[pick].i.slice(); }
        el.inq.textContent = list(left);
        el.outq.textContent = m ? list(m.out) : '—';

        for (r = 0; r < MEM_SIZE; r++) {
          var v = m ? m.mem[r] : 0;
          el.cellv[r].textContent = v;
          el.cells[r].className = 'asm-cell' +
            (v !== 0 ? ' is-set' : '') +
            (m && m.touched === r ? ' is-touched' : '');
        }
      }

      function paintTests(report) {
        var lv = LEVELS[at];
        var out = '<h4 class="asm-tests-head">Test cases</h4><ul class="asm-test-list">';
        for (var i = 0; i < lv.tests.length; i++) {
          var t = lv.tests[i];
          var mark = '';
          var cls = '';
          if (report) {
            var r = report.results[i];
            cls = r.ok ? ' is-pass' : ' is-fail';
            mark = r.ok ? '<span class="asm-mark">pass</span>'
                        : '<span class="asm-mark">' + esc(r.error ? r.error : 'got ' + list(r.got)) + '</span>';
          }
          out += '<li class="asm-test' + cls + '"><code>in ' + esc(list(t.i)) + '</code>' +
                 '<code>out ' + esc(list(t.o)) + '</code>' + mark + '</li>';
        }
        out += '</ul>';
        el.tests.innerHTML = out;
      }

      function paintLevel() {
        var lv = LEVELS[at];
        el.title.textContent = 'Level ' + (at + 1) + ' — ' + lv.name;
        el.brief.textContent = lv.brief;
        el.io.textContent = lv.io + ' Par is ' + pars[at] + '.';
        el.src.value = sources[at];

        var opts = '';
        for (var i = 0; i < lv.tests.length; i++) {
          opts += '<option value="' + i + '">' + (i + 1) + ' — in ' + esc(list(lv.tests[i].i)) + '</option>';
        }
        el.pick.innerHTML = opts;
        pick = 0;
        el.pick.value = '0';

        machine = null;
        paintMachine();
        paintTests(null);
        paintSolved();
        message('', null);
        g.stat('level', (at + 1) + '/' + LEVELS.length);
      }

      function paintSolved() {
        var s = scores[at];
        if (!s) { el.solved.hidden = true; el.solved.innerHTML = ''; return; }
        el.solved.hidden = false;
        el.solved.innerHTML =
          '<p class="asm-solved-line">Level ' + (at + 1) + ' passes every test. ' +
          s.size + ' instructions, ' + s.cycles + ' cycles, cost <strong>' + s.cost + '</strong> ' +
          '(par ' + pars[at] + ').</p>' +
          '<button class="game-btn" type="button" id="asm-show">Show a worked solution</button>' +
          '<pre class="asm-worked" id="asm-worked" hidden></pre>';
        var btn = el.solved.querySelector('#asm-show');
        btn.addEventListener('click', function () {
          var pre = el.solved.querySelector('#asm-worked');
          pre.hidden = !pre.hidden;
          pre.textContent = LEVELS[at].solution;
          btn.textContent = pre.hidden ? 'Show a worked solution' : 'Hide the worked solution';
        });
      }

      function total() {
        var sum = 0;
        var done = 0;
        for (var i = 0; i < scores.length; i++) {
          if (scores[i]) { sum += scores[i].cost; done++; }
        }
        g.stat('cost', sum);
        return { sum: sum, done: done };
      }

      /* --------------------------------------------------------------
         The three actions.
         -------------------------------------------------------------- */
      function built() {
        var res = assemble(sources[at], LEVELS[at].banned);
        if (!res.ok) { message(res.error, 'bad'); g.beep(200, 0.08, 'square'); return null; }
        return res.code;
      }

      function load() {
        var code = built();
        if (!code) return null;
        machine = new Machine(code, LEVELS[at].tests[pick].i);
        return machine;
      }

      /* Said once, when the run stops, whether it stopped by halting or by
         breaking. Watching a program end and being told nothing about what it
         printed is the single most annoying thing a machine simulator does. */
      function reportRun(prefix) {
        if (!machine || !machine.done || machine.reported) return;
        machine.reported = true;
        if (machine.error) {
          message(machine.error, 'bad');
          g.beep(200, 0.09, 'square');
          return;
        }
        var want = LEVELS[at].tests[pick].o;
        var ok = sameList(machine.out, want);
        message((prefix || '') + 'Test ' + (pick + 1) + ' printed ' + list(machine.out) +
          (ok ? ' — that is right.' : ', and should have printed ' + list(want) + '.'), ok ? 'good' : 'bad');
        g.beep(ok ? 700 : 240, 0.05, ok ? 'sine' : 'square');
      }

      function doStep() {
        if (!machine || machine.done) { if (!load()) return; }
        machine.step();
        paintMachine();
        reportRun();
      }

      function doRun() {
        if (!load()) return;
        /* Watching four hundred instructions go by is not watching, it is
           waiting. Anything longer is finished in one go and shown as an end
           state, which is what the player actually wanted at that length. */
        var dry = new Machine(machine.code, LEVELS[at].tests[pick].i).finish();
        if (dry.cycles > WATCHABLE) {
          machine = dry;
          paintMachine();
          reportRun(dry.cycles + ' instructions is too many to watch, so it ran in one go. ');
          return;
        }
        accum = 0;
        message('Running test ' + (pick + 1) + '.', null);
      }

      function doCheck() {
        var code = built();
        if (!code) return;
        machine = null;
        paintMachine();

        var report = runTests(code, LEVELS[at]);
        paintTests(report);

        if (!report.pass) {
          var first = 0;
          for (var i = 0; i < report.results.length; i++) {
            if (!report.results[i].ok) { first = i; break; }
          }
          /* Point the machine panel at the case that failed, because that is
             the one the player now needs to step through. */
          pick = first;
          el.pick.value = String(first);
          paintMachine();
          message('Test ' + (first + 1) + ' fails. The machine panel is now set to it.', 'bad');
          g.beep(200, 0.09, 'square');
          return;
        }

        var wasNew = !scores[at] || report.cost < scores[at].cost;
        if (wasNew) scores[at] = { size: report.size, cycles: report.cycles, cost: report.cost };
        paintSolved();
        g.beep(760, 0.07, 'sine');

        var tally = total();
        var note = report.cost <= pars[at]
          ? 'All ' + report.results.length + ' cases pass, at or under par.'
          : 'All ' + report.results.length + ' cases pass. Par is ' + pars[at] + ', so there is room to trim.';
        message(note, 'good');

        if (tally.done === LEVELS.length) {
          g.over({
            won: true,
            score: tally.sum,
            title: 'All eight solved',
            message: 'Total cost ' + tally.sum + ' against a par of ' + parTotal() +
              '. Lower is better, so shorter programs and tighter loops both count.'
          });
        }
      }

      function parTotal() {
        var sum = 0;
        for (var i = 0; i < pars.length; i++) sum += pars[i];
        return sum;
      }

      /* --------------------------------------------------------------
         Toolbar wiring.
         -------------------------------------------------------------- */
      function wire() {
        /* The level list is in the page markup rather than built here, for
           the same reason the HUD is: a select that fills in after hydration
           is a control that moves under the pointer. */
        var sel = g.el.querySelector('#game-level');
        if (sel) {
          sel.addEventListener('change', function () {
            at = Number(sel.value) || 0;
            if (at < 0 || at >= LEVELS.length) at = 0;
            paintLevel();
          });
          el.levelSel = sel;
        }
        var runBtn = g.el.querySelector('#game-run');
        var stepBtn = g.el.querySelector('#game-step');
        var checkBtn = g.el.querySelector('#game-check');
        if (runBtn) runBtn.addEventListener('click', doRun);
        if (stepBtn) stepBtn.addEventListener('click', doStep);
        if (checkBtn) checkBtn.addEventListener('click', doCheck);
      }

      build();
      restore();
      wire();

      return {
        reset: function () {
          /* Restart clears progress and the machine but leaves the typed
             programs alone — the shell calls this at boot as well, and
             wiping the restored source there would make the save pointless. */
          at = 0;
          machine = null;
          for (var i = 0; i < scores.length; i++) scores[i] = null;
          if (el.levelSel) el.levelSel.value = '0';
          g.stat('cost', 0);
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

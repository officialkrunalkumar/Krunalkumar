/* ==========================================================================
   cpu.js — a tiny CPU you can single-step, to see what "a program runs" means.
   --------------------------------------------------------------------------
   Everyone is told a CPU "executes instructions one at a time" and almost
   nobody has watched it happen. This is a made-up 16-bit machine — eight
   general registers, a program counter, a stack pointer, three flags — with a
   small, honest instruction set. You write assembly, press Assemble, then Step,
   and every register, flag, memory word and stack slot that changed lights up.
   That is the whole point: the abstraction "it just runs" gets replaced with a
   concrete sequence of tiny, boring, deterministic moves.

   Design decisions worth spelling out, because they are the interesting bit:

   1. Harvard split, not von Neumann. Instructions live in their own array and
      the program counter is an index into it; LOAD/STORE touch a separate
      256-word data memory. Real chips share one address space, but mixing code
      and data here would drag in self-modifying-code and instruction-decoding
      questions that bury the lesson. Keeping them apart means PC is just "which
      line are we on", which is exactly the mental model a beginner needs.

   2. 16-bit words, everything masked to 0xFFFF. Small enough that the hex on
      screen stays short and a human can track it, big enough that factorial and
      Fibonacci examples produce real numbers. Signed values are two's
      complement, so 0xFFFF is -1, and that is shown next to the hex so the
      Negative flag stops being mysterious.

   3. A real two-pass assembler, no eval, no new Function. Pass one assigns an
      address to every label (so you can jump forward to a label defined later);
      pass two resolves operands to numbers. The production CSP forbids
      unsafe-eval anyway, but the honest reason is that eval would teach nothing
      — the parser IS the lesson about how text becomes an instruction.

   4. Run is a self-scheduling setTimeout, not a while-loop. A while-loop over a
      program with a loop in it freezes the tab forever and the Stop button
      never gets a turn. Stepping on a timer keeps the UI alive, makes Stop
      instant, and lets the speed slider mean something. A hard step ceiling
      catches genuine infinite loops so a runaway program stops itself.

   Nothing here opens a network connection. The machine is entirely in this tab.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  var WORD = 0xFFFF;          // 16-bit words
  var MOD = 0x10000;
  var MEM_SIZE = 256;         // data memory words; stack grows down from here
  var STEP_LIMIT = 4000000;   // a running program that never halts stops itself

  /* ---- number / formatting helpers ------------------------------------- */
  function mask(v) { return ((v % MOD) + MOD) % MOD; }
  function signed(v) { v = mask(v); return v >= 0x8000 ? v - MOD : v; }
  function hex4(v) {
    var s = mask(v).toString(16).toUpperCase();
    while (s.length < 4) s = '0' + s;
    return s;
  }
  function hex2(v) {
    var s = (v & 0xFF).toString(16).toUpperCase();
    while (s.length < 2) s = '0' + s;
    return s;
  }
  function pad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  /* ---- the instruction set --------------------------------------------
     Each op declares the shape of its operands so the assembler can reject a
     malformed line with a real message instead of crashing at run time.
       rd   destination register (written)
       r    source register (read only)
       src  register OR immediate
       mem  memory reference in [ ] brackets
       lbl  a jump target: a label, or a raw instruction address
       -    no operand there
  --------------------------------------------------------------------------- */
  var OPS = {
    MOV:   ['rd', 'src'],
    ADD:   ['rd', 'src'],
    SUB:   ['rd', 'src'],
    MUL:   ['rd', 'src'],
    AND:   ['rd', 'src'],
    OR:    ['rd', 'src'],
    XOR:   ['rd', 'src'],
    NOT:   ['rd'],
    SHL:   ['rd', 'src'],
    SHR:   ['rd', 'src'],
    CMP:   ['r', 'src'],
    JMP:   ['lbl'],
    JZ:    ['lbl'],
    JNZ:   ['lbl'],
    JG:    ['lbl'],
    JL:    ['lbl'],
    LOAD:  ['rd', 'mem'],
    STORE: ['mem', 'r'],
    PUSH:  ['src'],
    POP:   ['rd'],
    CALL:  ['lbl'],
    RET:   [],
    HLT:   [],
    OUT:   ['src']
  };

  /* ====================================================================== */
  /*  ASSEMBLER                                                             */
  /* ====================================================================== */

  function parseNumber(tok) {
    tok = tok.trim();
    if (tok === '') return null;
    if (tok.charAt(0) === '#') tok = tok.slice(1).trim();
    // character literal 'A'
    if (tok.length === 3 && tok.charAt(0) === "'" && tok.charAt(2) === "'") {
      return { v: tok.charCodeAt(1) & WORD };
    }
    var neg = false, s = tok;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    else if (s.charAt(0) === '+') { s = s.slice(1); }
    var val;
    if (/^0x[0-9a-f]+$/i.test(s)) val = parseInt(s.slice(2), 16);
    else if (/^0b[01]+$/i.test(s)) val = parseInt(s.slice(2), 2);
    else if (/^[0-9]+$/.test(s)) val = parseInt(s, 10);
    else return null;
    if (isNaN(val)) return null;
    if (neg) val = -val;
    return { v: mask(val) };
  }

  function parseReg(tok) {
    var m = /^R([0-7])$/i.exec(tok.trim());
    return m ? +m[1] : -1;
  }

  // A memory reference: [ term (+ term)* ] where a term is a register, a
  // number, or a label. Terms are summed at run time to form the address.
  function parseMem(tok, symbols) {
    var inner = tok.slice(1, -1).trim();
    if (inner === '') return { error: 'empty [ ] address' };
    var raw = inner.split('+');
    var terms = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i].trim();
      if (p === '') return { error: 'stray + in address' };
      var reg = parseReg(p);
      if (reg >= 0) { terms.push({ reg: reg }); continue; }
      var num = parseNumber(p);
      if (num) { terms.push({ imm: num.v }); continue; }
      if (symbols && Object.prototype.hasOwnProperty.call(symbols, p)) {
        terms.push({ imm: symbols[p].addr }); continue;
      }
      return { error: 'unknown term "' + p + '" in address' };
    }
    return { terms: terms };
  }

  // Split a source line into top-level comma operands. Brackets never contain a
  // comma in this ISA, so a plain split is enough.
  function splitOperands(s) {
    s = s.trim();
    if (s === '') return [];
    var parts = s.split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t !== '') out.push(t);
    }
    return out;
  }

  function classifyOperand(tok, symbols) {
    tok = tok.trim();
    if (tok.charAt(0) === '[') {
      if (tok.charAt(tok.length - 1) !== ']') return { t: 'bad', why: 'missing ]' };
      var m = parseMem(tok, symbols);
      if (m.error) return { t: 'bad', why: m.error };
      return { t: 'mem', terms: m.terms };
    }
    var reg = parseReg(tok);
    if (reg >= 0) return { t: 'reg', n: reg };
    var num = parseNumber(tok);
    if (num) return { t: 'imm', v: num.v };
    if (symbols && Object.prototype.hasOwnProperty.call(symbols, tok)) {
      return { t: 'imm', v: symbols[tok].addr, label: tok };
    }
    if (/^R[0-9]+$/i.test(tok)) return { t: 'bad', why: 'register "' + tok + '" does not exist — this CPU has R0 through R7' };
    if (/^[A-Za-z_.][A-Za-z0-9_.]*$/.test(tok)) return { t: 'bad', why: 'unknown label "' + tok + '"' };
    return { t: 'bad', why: 'cannot parse "' + tok + '"' };
  }

  function operandMatches(kind, op) {
    switch (kind) {
      case 'rd':
      case 'r':   return op.t === 'reg';
      case 'src': return op.t === 'reg' || op.t === 'imm';
      case 'mem': return op.t === 'mem';
      case 'lbl': return op.t === 'imm';
      default:    return false;
    }
  }

  // Two-pass assembly. Returns { ok, program, dataInit, symbols, errors, lines }
  // where program[] is decoded instructions, dataInit[] is {addr,val} words to
  // preload into memory, and lines[] maps each instruction to its source text.
  function assemble(source) {
    var srcLines = source.split('\n');
    var errors = [];
    var symbols = {};        // name -> { addr, data:bool }
    var raw = [];            // pass-one instructions, operands still text
    var dataInit = [];       // { addr, val }
    var instrAddr = 0;
    var dataPtr = 0;

    function defineSymbol(name, addr, isData, lineNo) {
      if (Object.prototype.hasOwnProperty.call(symbols, name)) {
        errors.push({ line: lineNo, msg: 'duplicate label "' + name + '"' });
        return;
      }
      symbols[name] = { addr: addr, data: isData };
    }

    // ---- pass one: strip comments, collect labels, lay out code and data ----
    for (var i = 0; i < srcLines.length; i++) {
      var lineNo = i + 1;
      var line = srcLines[i];
      var semi = line.indexOf(';');
      if (semi >= 0) line = line.slice(0, semi);
      line = line.replace(/\s+$/, '');
      var trimmed = line.replace(/^\s+/, '');
      if (trimmed === '') continue;

      // leading label:  NAME:
      var lbl = /^([A-Za-z_.][A-Za-z0-9_.]*)\s*:\s*(.*)$/.exec(trimmed);
      var rest = trimmed;
      var pendingLabel = null;
      if (lbl) { pendingLabel = lbl[1]; rest = lbl[2]; }

      if (rest.trim() === '') {
        // label on its own line points at the next instruction
        if (pendingLabel) defineSymbol(pendingLabel, instrAddr, false, lineNo);
        continue;
      }

      // directive: DW value, value, ...  (define words in data memory)
      var head = rest.replace(/^\s+/, '');
      var mword = /^(DW|\.dw|\.word)\b\s*(.*)$/i.exec(head);
      if (mword) {
        if (pendingLabel) defineSymbol(pendingLabel, dataPtr, true, lineNo);
        var vals = splitOperands(mword[2]);
        if (vals.length === 0) errors.push({ line: lineNo, msg: 'DW needs at least one value' });
        for (var d = 0; d < vals.length; d++) {
          var num = parseNumber(vals[d]);
          if (!num) { errors.push({ line: lineNo, msg: 'DW: not a number "' + vals[d] + '"' }); continue; }
          if (dataPtr >= MEM_SIZE) { errors.push({ line: lineNo, msg: 'DW: out of data memory' }); break; }
          dataInit.push({ addr: dataPtr, val: num.v });
          dataPtr++;
        }
        continue;
      }

      // otherwise: an instruction
      if (pendingLabel) defineSymbol(pendingLabel, instrAddr, false, lineNo);
      var mm = /^([A-Za-z]+)\b\s*(.*)$/.exec(head);
      if (!mm) { errors.push({ line: lineNo, msg: 'cannot read instruction' }); continue; }
      var mnem = mm[1].toUpperCase();
      if (!Object.prototype.hasOwnProperty.call(OPS, mnem)) {
        errors.push({ line: lineNo, msg: 'unknown instruction "' + mm[1] + '"' });
        continue;
      }
      raw.push({
        mnem: mnem,
        opText: splitOperands(mm[2]),
        line: lineNo,
        src: trimmed,
        addr: instrAddr
      });
      instrAddr++;
    }

    // ---- pass two: resolve operands now that every label has an address ----
    var program = [];
    for (var k = 0; k < raw.length; k++) {
      var r = raw[k];
      var spec = OPS[r.mnem];
      var ops = [];
      var good = true;

      if (r.opText.length !== spec.length) {
        errors.push({
          line: r.line,
          msg: r.mnem + ' takes ' + spec.length + ' operand' + (spec.length === 1 ? '' : 's') +
               ', got ' + r.opText.length
        });
        good = false;
      }

      for (var o = 0; o < spec.length && o < r.opText.length; o++) {
        var op = classifyOperand(r.opText[o], symbols);
        if (op.t === 'bad') { errors.push({ line: r.line, msg: op.why }); good = false; continue; }
        if (!operandMatches(spec[o], op)) {
          errors.push({ line: r.line, msg: r.mnem + ' operand ' + (o + 1) + ': expected ' +
            describeKind(spec[o]) + ', got ' + describeOp(op) });
          good = false;
        }
        ops.push(op);
      }

      program.push({ mnem: r.mnem, ops: ops, line: r.line, src: r.src, addr: r.addr, ok: good });
    }

    if (program.length === 0 && errors.length === 0) {
      errors.push({ line: 0, msg: 'nothing to assemble — the program is empty' });
    }

    return {
      ok: errors.length === 0,
      program: program,
      dataInit: dataInit,
      symbols: symbols,
      errors: errors
    };
  }

  function describeKind(kind) {
    if (kind === 'rd' || kind === 'r') return 'a register';
    if (kind === 'src') return 'a register or number';
    if (kind === 'mem') return 'a [memory] address';
    if (kind === 'lbl') return 'a label';
    return kind;
  }
  function describeOp(op) {
    if (op.t === 'reg') return 'register';
    if (op.t === 'imm') return 'number';
    if (op.t === 'mem') return 'memory address';
    return op.t;
  }

  /* ====================================================================== */
  /*  THE MACHINE                                                           */
  /* ====================================================================== */

  function CPU() {
    this.program = [];
    this.dataInit = [];
    this.symbols = {};
    this.reset();
  }

  CPU.prototype.load = function (asm) {
    this.program = asm.program;
    this.dataInit = asm.dataInit;
    this.symbols = asm.symbols;
    this.reset();
  };

  CPU.prototype.reset = function () {
    this.regs = [0, 0, 0, 0, 0, 0, 0, 0];
    this.pc = 0;
    this.sp = MEM_SIZE;        // empty stack; first PUSH writes mem[MEM_SIZE-1]
    this.Z = 0; this.N = 0; this.C = 0;
    this.mem = [];
    for (var i = 0; i < MEM_SIZE; i++) this.mem[i] = 0;
    for (var d = 0; d < this.dataInit.length; d++) {
      this.mem[this.dataInit[d].addr] = this.dataInit[d].val;
    }
    this.output = [];
    this.halted = false;
    this.error = null;
    this.steps = 0;
    // what the last step touched, for the highlight
    this.touch = { regs: {}, mem: -1, flags: false, sp: false, out: false };
  };

  // resolve a reg|imm operand to a value
  CPU.prototype.val = function (op) {
    return op.t === 'reg' ? this.regs[op.n] : op.v;
  };

  // resolve a [mem] operand to an address, or throw a run-time error string
  CPU.prototype.addr = function (op) {
    var a = 0;
    for (var i = 0; i < op.terms.length; i++) {
      var t = op.terms[i];
      a += (t.reg != null) ? this.regs[t.reg] : t.imm;
    }
    a = a & 0xFFFF;
    if (a < 0 || a >= MEM_SIZE) throw 'memory address ' + a + ' is outside 0..' + (MEM_SIZE - 1);
    return a;
  };

  CPU.prototype.setZN = function (res) {
    res = mask(res);
    this.Z = res === 0 ? 1 : 0;
    this.N = (res & 0x8000) ? 1 : 0;
  };

  CPU.prototype.writeReg = function (n, v) {
    this.regs[n] = mask(v);
    this.touch.regs[n] = true;
  };

  // Execute exactly one instruction. Returns true if it did work, false if the
  // machine is already stopped. Sets this.error on a fault (and halts).
  CPU.prototype.step = function () {
    if (this.halted) return false;
    this.touch = { regs: {}, mem: -1, flags: false, sp: false, out: false };

    if (this.pc < 0 || this.pc >= this.program.length) {
      this.halted = true;
      return false;
    }
    var ins = this.program[this.pc];
    if (!ins.ok) {
      this.error = 'line ' + ins.line + ' did not assemble';
      this.halted = true;
      return false;
    }

    var prevFlags = '' + this.Z + this.N + this.C;
    var next = this.pc + 1;
    var m = ins.mnem;
    var o = ins.ops;
    var a, b, full, res, cnt;

    try {
      switch (m) {
        case 'MOV':
          this.writeReg(o[0].n, this.val(o[1]));
          break;

        case 'ADD':
          a = this.regs[o[0].n]; b = this.val(o[1]);
          full = a + b; res = mask(full);
          this.C = full > WORD ? 1 : 0;
          this.setZN(res); this.writeReg(o[0].n, res);
          break;

        case 'SUB':
          a = this.regs[o[0].n]; b = this.val(o[1]);
          full = a - b; res = mask(full);
          this.C = a < b ? 1 : 0;               // borrow
          this.setZN(res); this.writeReg(o[0].n, res);
          break;

        case 'MUL':
          a = this.regs[o[0].n]; b = this.val(o[1]);
          full = a * b; res = full % MOD;
          this.C = full > WORD ? 1 : 0;         // result did not fit in 16 bits
          this.setZN(res); this.writeReg(o[0].n, res);
          break;

        case 'AND':
          res = mask(this.regs[o[0].n] & this.val(o[1]));
          this.C = 0; this.setZN(res); this.writeReg(o[0].n, res);
          break;
        case 'OR':
          res = mask(this.regs[o[0].n] | this.val(o[1]));
          this.C = 0; this.setZN(res); this.writeReg(o[0].n, res);
          break;
        case 'XOR':
          res = mask(this.regs[o[0].n] ^ this.val(o[1]));
          this.C = 0; this.setZN(res); this.writeReg(o[0].n, res);
          break;
        case 'NOT':
          res = mask(~this.regs[o[0].n]);
          this.C = 0; this.setZN(res); this.writeReg(o[0].n, res);
          break;

        case 'SHL':
          a = this.regs[o[0].n]; cnt = this.val(o[1]) & 0x1F;
          this.C = (cnt >= 1 && cnt <= 16) ? ((a >> (16 - cnt)) & 1) : 0;
          res = mask(a << cnt);
          this.setZN(res); this.writeReg(o[0].n, res);
          break;
        case 'SHR':
          a = this.regs[o[0].n]; cnt = this.val(o[1]) & 0x1F;
          this.C = (cnt >= 1) ? ((a >> (cnt - 1)) & 1) : 0;
          res = mask(a >> cnt);
          this.setZN(res); this.writeReg(o[0].n, res);
          break;

        case 'CMP':
          a = this.regs[o[0].n]; b = this.val(o[1]);
          this.C = a < b ? 1 : 0;
          this.setZN(mask(a - b));
          break;

        case 'JMP': next = o[0].v; break;
        case 'JZ':  if (this.Z) next = o[0].v; break;
        case 'JNZ': if (!this.Z) next = o[0].v; break;
        // JG / JL are signed comparisons; valid when the compared values are
        // within 0..0x7FFF, which every shipped example respects.
        case 'JG':  if (!this.Z && !this.N) next = o[0].v; break;
        case 'JL':  if (this.N) next = o[0].v; break;

        case 'LOAD':
          a = this.addr(o[1]);
          this.writeReg(o[0].n, this.mem[a]);
          break;
        case 'STORE':
          a = this.addr(o[0]);
          this.mem[a] = mask(this.val(o[1]));
          this.touch.mem = a;
          break;

        case 'PUSH':
          if (this.sp - 1 < 0) throw 'stack overflow — no room to PUSH';
          this.sp = this.sp - 1;
          this.mem[this.sp] = mask(this.val(o[0]));
          this.touch.mem = this.sp; this.touch.sp = true;
          break;
        case 'POP':
          if (this.sp >= MEM_SIZE) throw 'stack underflow — POP on an empty stack';
          this.writeReg(o[0].n, this.mem[this.sp]);
          this.sp = this.sp + 1; this.touch.sp = true;
          break;

        case 'CALL':
          if (this.sp - 1 < 0) throw 'stack overflow — no room for the return address';
          this.sp = this.sp - 1;
          this.mem[this.sp] = this.pc + 1;     // return to the line after CALL
          this.touch.mem = this.sp; this.touch.sp = true;
          next = o[0].v;
          break;
        case 'RET':
          if (this.sp >= MEM_SIZE) throw 'RET with an empty stack — no return address';
          next = this.mem[this.sp];
          this.sp = this.sp + 1; this.touch.sp = true;
          break;

        case 'OUT':
          this.output.push(this.val(o[0]));
          this.touch.out = true;
          break;

        case 'HLT':
          this.halted = true;
          break;

        default:
          throw 'no handler for ' + m;
      }
    } catch (e) {
      this.error = 'line ' + ins.line + ': ' + (typeof e === 'string' ? e : (e && e.message) || e);
      this.halted = true;
      return false;
    }

    if (('' + this.Z + this.N + this.C) !== prevFlags) this.touch.flags = true;
    this.pc = next;
    this.steps++;
    if (this.steps >= STEP_LIMIT) {
      this.error = 'step limit (' + LabViz.humanNumber(STEP_LIMIT) + ') reached — the program never halted';
      this.halted = true;
    }
    return true;
  };

  /* ====================================================================== */
  /*  EXAMPLE PROGRAMS                                                       */
  /* ====================================================================== */

  var EXAMPLES = {
    fib:
      "; Fibonacci — print the first 10 Fibonacci numbers.\n" +
      "; R0 = current, R1 = next, R2 = counter.\n" +
      "      MOV  R0, #0\n" +
      "      MOV  R1, #1\n" +
      "      MOV  R2, #10        ; how many to print\n" +
      "loop: OUT  R0             ; emit the current number\n" +
      "      MOV  R3, R0         ; R3 = R0 + R1\n" +
      "      ADD  R3, R1\n" +
      "      MOV  R0, R1         ; slide the window forward\n" +
      "      MOV  R1, R3\n" +
      "      SUB  R2, #1         ; counter--  (sets the Zero flag at 0)\n" +
      "      JNZ  loop           ; keep going while counter != 0\n" +
      "      HLT\n",

    fact:
      "; Factorial — compute 6! and print it (720).\n" +
      "; R0 counts down from n, R1 accumulates the product.\n" +
      "      MOV  R0, #6         ; n\n" +
      "      MOV  R1, #1         ; result = 1\n" +
      "loop: MUL  R1, R0         ; result *= n\n" +
      "      SUB  R0, #1         ; n--\n" +
      "      CMP  R0, #1         ; compare n with 1\n" +
      "      JG   loop           ; while n > 1, multiply again\n" +
      "      OUT  R1             ; print 6! = 720\n" +
      "      HLT\n",

    sum:
      "; Sum an array — walk it with an index and add each element.\n" +
      "; The array and its length live in data memory (see DW at the end).\n" +
      "      MOV  R0, #0         ; sum = 0\n" +
      "      MOV  R1, #0         ; i = 0\n" +
      "      LOAD R2, [len]      ; R2 = number of elements\n" +
      "loop: CMP  R1, R2         ; i < len ?\n" +
      "      JL   body\n" +
      "      JMP  done           ; i reached len — finished\n" +
      "body: LOAD R3, [arr+R1]   ; R3 = arr[i]\n" +
      "      ADD  R0, R3         ; sum += arr[i]\n" +
      "      ADD  R1, #1         ; i++\n" +
      "      JMP  loop\n" +
      "done: OUT  R0             ; print the sum (35)\n" +
      "      HLT\n" +
      "\n" +
      "arr:  DW 5, 8, 2, 10, 3, 7\n" +
      "len:  DW 6\n",

    bubble:
      "; Bubble sort — sort the array ascending, then print it.\n" +
      "; Repeats passes until a whole pass makes no swap.\n" +
      "      LOAD R7, [len]      ; n\n" +
      "pass: MOV  R6, #0         ; swapped = 0\n" +
      "      MOV  R0, #0         ; j = 0\n" +
      "      MOV  R1, R7\n" +
      "      SUB  R1, #1         ; limit = n - 1\n" +
      "in:   CMP  R0, R1         ; j < limit ?\n" +
      "      JL   cmp2\n" +
      "      JMP  chk            ; end of this pass\n" +
      "cmp2: LOAD R2, [arr+R0]   ; a = arr[j]\n" +
      "      MOV  R3, R0\n" +
      "      ADD  R3, #1         ; j+1\n" +
      "      LOAD R4, [arr+R3]   ; b = arr[j+1]\n" +
      "      CMP  R2, R4         ; a > b ?\n" +
      "      JG   swap\n" +
      "      JMP  next\n" +
      "swap: STORE [arr+R0], R4  ; put them back the other way round\n" +
      "      STORE [arr+R3], R2\n" +
      "      MOV  R6, #1         ; swapped = 1\n" +
      "next: ADD  R0, #1         ; j++\n" +
      "      JMP  in\n" +
      "chk:  CMP  R6, #0         ; did this pass swap anything?\n" +
      "      JNZ  pass           ; yes — another pass\n" +
      "      MOV  R0, #0         ; print the sorted array\n" +
      "prn:  CMP  R0, R7\n" +
      "      JL   emit\n" +
      "      JMP  end\n" +
      "emit: LOAD R2, [arr+R0]\n" +
      "      OUT  R2\n" +
      "      ADD  R0, #1\n" +
      "      JMP  prn\n" +
      "end:  HLT\n" +
      "\n" +
      "arr:  DW 5, 1, 4, 2, 8, 3\n" +
      "len:  DW 6\n"
  };

  /* ====================================================================== */
  /*  UI                                                                    */
  /* ====================================================================== */

  var CSS =
    '#cpuviz .cpu-wrap{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c7d3e6;}' +
    '#cpuviz .cpu-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px;}' +
    '#cpuviz .cpu-bar select,#cpuviz .cpu-btn{font:inherit;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:7px 12px;cursor:pointer;}' +
    '#cpuviz .cpu-btn:hover:not(:disabled){background:#213152;border-color:#40608f;}' +
    '#cpuviz .cpu-btn:disabled{opacity:.4;cursor:not-allowed;}' +
    '#cpuviz .cpu-btn.primary{background:#1f6feb;border-color:#2f7ffb;color:#fff;}' +
    '#cpuviz .cpu-btn.primary:hover:not(:disabled){background:#2f7ffb;}' +
    '#cpuviz .cpu-btn.run{background:#15391f;border-color:#2b6b3d;color:#7ee89a;}' +
    '#cpuviz .cpu-btn.stop{background:#3a1720;border-color:#7a2c3c;color:#ff9db0;}' +
    '#cpuviz .cpu-speed{display:flex;align-items:center;gap:6px;margin-left:auto;color:#8ea0bd;}' +
    '#cpuviz .cpu-speed input{accent-color:#1f6feb;}' +
    '#cpuviz .cpu-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:start;}' +
    '@media (max-width:820px){#cpuviz .cpu-main{grid-template-columns:1fr;}}' +
    '#cpuviz .cpu-col{display:flex;flex-direction:column;gap:14px;min-width:0;}' +
    '#cpuviz .cpu-panel{background:#0e1626;border:1px solid #223148;border-radius:10px;overflow:hidden;}' +
    '#cpuviz .cpu-ph{padding:7px 11px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#7f93b3;background:#131f33;border-bottom:1px solid #223148;}' +
    '#cpuviz .cpu-code{width:100%;box-sizing:border-box;min-height:300px;resize:vertical;border:0;background:#0b1220;color:#d7e2f4;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;padding:11px 12px;tab-size:4;outline:none;}' +
    '#cpuviz .cpu-listing{max-height:230px;overflow:auto;font-size:12px;}' +
    '#cpuviz .cpu-lrow{display:flex;gap:10px;padding:2px 11px;white-space:pre;}' +
    '#cpuviz .cpu-lrow .a{color:#54688c;width:34px;text-align:right;flex:none;}' +
    '#cpuviz .cpu-lrow .s{color:#aeb9cd;}' +
    '#cpuviz .cpu-lrow.cur{background:#123a2a;}' +
    '#cpuviz .cpu-lrow.cur .s{color:#8affc0;}' +
    '#cpuviz .cpu-lrow.cur .a{color:#4ade80;}' +
    '#cpuviz .cpu-regs{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:11px;}' +
    '#cpuviz .cpu-reg{display:flex;justify-content:space-between;gap:8px;padding:5px 8px;background:#0b1526;border:1px solid #1e2c42;border-radius:6px;}' +
    '#cpuviz .cpu-reg .k{color:#7f93b3;}' +
    '#cpuviz .cpu-reg .v{color:#e6edf8;}' +
    '#cpuviz .cpu-reg .d{color:#5f76a0;font-size:11px;}' +
    '#cpuviz .cpu-reg.chg{background:#173a26;border-color:#2f7d4e;animation:cpuflash .5s ease;}' +
    '#cpuviz .cpu-reg.pcx{border-color:#2f5b9e;}' +
    '#cpuviz .cpu-flags{display:flex;gap:8px;padding:0 11px 11px;}' +
    '#cpuviz .cpu-flag{flex:1;text-align:center;padding:6px;border-radius:6px;background:#0b1526;border:1px solid #1e2c42;color:#54688c;}' +
    '#cpuviz .cpu-flag.on{background:#2a2410;border-color:#7a6320;color:#ffd558;}' +
    '#cpuviz .cpu-flag.chg{animation:cpuflash .5s ease;}' +
    '#cpuviz .cpu-flag b{display:block;font-size:16px;line-height:1.1;}' +
    '#cpuviz .cpu-flag span{font-size:10px;color:#6f82a2;}' +
    '#cpuviz .cpu-mem{padding:9px;overflow:auto;max-height:250px;}' +
    '#cpuviz .cpu-memrow{display:flex;gap:0;white-space:pre;font-size:11px;line-height:1.5;}' +
    '#cpuviz .cpu-memrow .ra{color:#4d6088;padding-right:8px;flex:none;}' +
    '#cpuviz .cpu-mc{padding:0 4px;color:#3f4b63;border-radius:3px;}' +
    '#cpuviz .cpu-mc.nz{color:#c7d3e6;}' +
    '#cpuviz .cpu-mc.stk{color:#c58bff;}' +
    '#cpuviz .cpu-mc.sp{outline:1px solid #7a5cff;color:#e2ccff;}' +
    '#cpuviz .cpu-mc.chg{background:#3a2d0e;color:#ffd558;animation:cpuflash .5s ease;}' +
    '#cpuviz .cpu-stack{padding:9px 11px;max-height:150px;overflow:auto;font-size:12px;}' +
    '#cpuviz .cpu-srow{display:flex;justify-content:space-between;padding:2px 6px;border-radius:4px;}' +
    '#cpuviz .cpu-srow .k{color:#6f82a2;}' +
    '#cpuviz .cpu-srow .v{color:#d7c4ff;}' +
    '#cpuviz .cpu-srow.top{background:#241a3a;}' +
    '#cpuviz .cpu-srow.top .k{color:#c58bff;}' +
    '#cpuviz .cpu-empty{color:#54688c;padding:2px 6px;}' +
    '#cpuviz .cpu-out{margin:0;padding:11px;min-height:70px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#9fe8b6;background:#0b1220;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;}' +
    '#cpuviz .cpu-out .sys{color:#7f93b3;}' +
    '#cpuviz .cpu-out .er{color:#ff9db0;}' +
    '#cpuviz .cpu-out .ok{color:#7ee89a;}' +
    '#cpuviz .cpu-help{margin-top:14px;background:#0e1626;border:1px solid #223148;border-radius:10px;padding:0 14px;}' +
    '#cpuviz .cpu-help summary{cursor:pointer;padding:11px 0;color:#aeb9cd;font-size:12px;}' +
    '#cpuviz .cpu-help table{border-collapse:collapse;width:100%;font-size:12px;margin:4px 0 12px;}' +
    '#cpuviz .cpu-help td,#cpuviz .cpu-help th{border:1px solid #223148;padding:4px 8px;text-align:left;vertical-align:top;}' +
    '#cpuviz .cpu-help th{color:#7f93b3;font-weight:600;background:#131f33;}' +
    '#cpuviz .cpu-help code{color:#8affc0;}' +
    '#cpuviz .cpu-help p{color:#9fb0cc;font-size:12px;line-height:1.6;}' +
    '#cpuviz .cpu-help h4{color:#c7d3e6;margin:14px 0 6px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;}' +
    '@keyframes cpuflash{from{background:#4a7a55;}to{}}';

  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function CpuUI(root) {
    this.root = root;
    this.cpu = new CPU();
    this.assembled = false;
    this.running = false;
    this.timer = null;
    this.memCells = [];
    this.regCells = {};
    this.build();
  }

  CpuUI.prototype.build = function () {
    var self = this;

    var style = document.createElement('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'cpu-wrap');

    /* ---- toolbar ---- */
    var bar = E('div', 'cpu-bar');

    var sel = document.createElement('select');
    sel.id = 'viz-example';
    var optHead = E('option', null, 'Load an example…');
    optHead.value = '';
    sel.appendChild(optHead);
    var names = [['fib', 'Fibonacci'], ['fact', 'Factorial'], ['sum', 'Sum an array'], ['bubble', 'Bubble sort']];
    for (var i = 0; i < names.length; i++) {
      var op = E('option', null, names[i][1]);
      op.value = names[i][0];
      sel.appendChild(op);
    }
    bar.appendChild(sel);

    var asmBtn = E('button', 'cpu-btn primary', 'Assemble'); asmBtn.id = 'viz-asm'; asmBtn.type = 'button';
    var stepBtn = E('button', 'cpu-btn', 'Step'); stepBtn.id = 'viz-step'; stepBtn.type = 'button';
    var runBtn = E('button', 'cpu-btn run', 'Run'); runBtn.id = 'viz-run'; runBtn.type = 'button';
    var stopBtn = E('button', 'cpu-btn stop', 'Stop'); stopBtn.id = 'viz-stop'; stopBtn.type = 'button';
    var resetBtn = E('button', 'cpu-btn', 'Reset'); resetBtn.id = 'viz-reset'; resetBtn.type = 'button';
    bar.appendChild(asmBtn); bar.appendChild(stepBtn); bar.appendChild(runBtn);
    bar.appendChild(stopBtn); bar.appendChild(resetBtn);

    var speedWrap = E('div', 'cpu-speed');
    speedWrap.appendChild(E('span', null, 'slow'));
    var speed = document.createElement('input');
    speed.type = 'range'; speed.id = 'viz-speed';
    speed.min = '1'; speed.max = '100'; speed.value = '55';
    speedWrap.appendChild(speed);
    speedWrap.appendChild(E('span', null, 'fast'));
    bar.appendChild(speedWrap);

    wrap.appendChild(bar);

    /* ---- main two-column grid ---- */
    var main = E('div', 'cpu-main');

    // left column: editor + listing
    var left = E('div', 'cpu-col');

    var codePanel = E('div', 'cpu-panel');
    codePanel.appendChild(E('div', 'cpu-ph', 'Source — assembly'));
    var code = document.createElement('textarea');
    code.id = 'viz-code'; code.className = 'cpu-code';
    code.spellcheck = false; code.setAttribute('autocapitalize', 'off');
    code.setAttribute('autocomplete', 'off'); code.setAttribute('wrap', 'off');
    code.value = EXAMPLES.fib;
    codePanel.appendChild(code);
    left.appendChild(codePanel);

    var listPanel = E('div', 'cpu-panel');
    listPanel.appendChild(E('div', 'cpu-ph', 'Program — the current instruction is highlighted'));
    var listing = E('div', 'cpu-listing'); listing.id = 'viz-listing';
    listPanel.appendChild(listing);
    left.appendChild(listPanel);

    main.appendChild(left);

    // right column: registers/flags, memory, stack, output
    var right = E('div', 'cpu-col');

    var regPanel = E('div', 'cpu-panel');
    regPanel.appendChild(E('div', 'cpu-ph', 'Registers & flags'));
    var regs = E('div', 'cpu-regs'); regs.id = 'viz-regs';
    regPanel.appendChild(regs);
    var flags = E('div', 'cpu-flags'); flags.id = 'viz-flags';
    regPanel.appendChild(flags);
    right.appendChild(regPanel);

    var memPanel = E('div', 'cpu-panel');
    memPanel.appendChild(E('div', 'cpu-ph', 'Data memory — 256 words (hex)'));
    var mem = E('div', 'cpu-mem'); mem.id = 'viz-mem';
    memPanel.appendChild(mem);
    right.appendChild(memPanel);

    var stackPanel = E('div', 'cpu-panel');
    stackPanel.appendChild(E('div', 'cpu-ph', 'Stack — top first'));
    var stack = E('div', 'cpu-stack'); stack.id = 'viz-stack';
    stackPanel.appendChild(stack);
    right.appendChild(stackPanel);

    var outPanel = E('div', 'cpu-panel');
    outPanel.appendChild(E('div', 'cpu-ph', 'Output console'));
    var out = document.createElement('pre');
    out.id = 'viz-out'; out.className = 'cpu-out';
    outPanel.appendChild(out);
    right.appendChild(outPanel);

    main.appendChild(right);
    wrap.appendChild(main);

    wrap.appendChild(this.buildHelp());

    this.root.appendChild(wrap);

    // stash refs
    this.elCode = code; this.elListing = listing;
    this.elRegs = regs; this.elFlags = flags; this.elMem = mem;
    this.elStack = stack; this.elOut = out; this.elSpeed = speed;
    this.btnStep = stepBtn; this.btnRun = runBtn; this.btnStop = stopBtn;

    this.buildMemGrid();
    this.buildRegCells();

    // wire events
    asmBtn.addEventListener('click', function () { self.doAssemble(true); });
    stepBtn.addEventListener('click', function () { self.doStep(); });
    runBtn.addEventListener('click', function () { self.startRun(); });
    stopBtn.addEventListener('click', function () { self.stopRun('Stopped.'); });
    resetBtn.addEventListener('click', function () { self.doReset(); });
    sel.addEventListener('change', function () {
      if (!sel.value) return;
      self.stopRun(null);
      self.elCode.value = EXAMPLES[sel.value];
      self.doAssemble(true);
      sel.selectedIndex = 0;
    });
    code.addEventListener('keydown', function (ev) {
      // tab inserts a tab instead of leaving the editor
      if (ev.key === 'Tab') {
        ev.preventDefault();
        var s = code.selectionStart, e = code.selectionEnd;
        code.value = code.value.slice(0, s) + '    ' + code.value.slice(e);
        code.selectionStart = code.selectionEnd = s + 4;
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        self.doAssemble(true);
      }
    });

    // assemble the initial example so the panels are populated on first paint
    this.doAssemble(true);
    this.updateButtons();
  };

  CpuUI.prototype.buildHelp = function () {
    var d = document.createElement('details'); d.className = 'cpu-help';
    var sum = document.createElement('summary');
    sum.textContent = 'Instruction set & how this machine works';
    d.appendChild(sum);

    var p1 = E('p', null,
      'Eight general registers R0–R7, a program counter PC (which instruction is next), ' +
      'a stack pointer SP, and three flags. Everything is a 16-bit word: values wrap at ' +
      '65536, and a value with bit 15 set reads as negative (two’s complement), which ' +
      'is what the N flag reports. Immediates are written #5, 0x1F, 0b1010, -3 or ‘A’. ' +
      'Registers and instruction names are case-insensitive; labels are not.');
    d.appendChild(p1);

    d.appendChild(mkH4('Flags'));
    d.appendChild(mkTable(
      ['Flag', 'Set when'],
      [
        ['Z (Zero)', 'the result of the last arithmetic/logic op (or CMP) was 0'],
        ['N (Negative)', 'bit 15 of that result was 1 — i.e. it reads as a negative number'],
        ['C (Carry)', 'ADD overflowed past 16 bits, SUB/CMP needed a borrow, or a shift pushed a 1 out']
      ]
    ));

    d.appendChild(mkH4('Instructions'));
    d.appendChild(mkTable(
      ['Instruction', 'Meaning'],
      [
        ['MOV Rd, src', 'Rd = src (register or number). Does not touch the flags.'],
        ['ADD / SUB / MUL Rd, src', 'arithmetic into Rd; sets Z, N, C'],
        ['AND / OR / XOR Rd, src', 'bitwise into Rd; sets Z, N and clears C'],
        ['NOT Rd', 'bitwise complement of Rd'],
        ['SHL / SHR Rd, count', 'shift Rd left/right; the last bit shifted out lands in C'],
        ['CMP a, src', 'compute a − src and set flags, but store nothing'],
        ['JMP label', 'unconditional jump'],
        ['JZ / JNZ label', 'jump if Z is set / clear'],
        ['JG / JL label', 'after CMP, jump if a &gt; src / a &lt; src (signed, values 0..32767)'],
        ['LOAD Rd, [addr]', 'read a word from data memory into Rd'],
        ['STORE [addr], Rs', 'write Rs into data memory'],
        ['PUSH src / POP Rd', 'push a value / pop into Rd (SP grows down from 256)'],
        ['CALL label / RET', 'call: push the return address and jump; RET pops it back'],
        ['OUT src', 'print a value to the output console'],
        ['HLT', 'stop the machine']
      ]
    ));

    d.appendChild(mkH4('Addresses & data'));
    var p2 = document.createElement('p');
    p2.innerHTML = 'A memory address is written in brackets and can add terms: ' +
      '<code>[42]</code>, <code>[R1]</code>, <code>[arr+R1]</code>. Declare data with ' +
      '<code>label: DW 5, 8, 2</code> — the label becomes the address of the first word. ' +
      'Instructions and data live in separate spaces, so PC is simply the line number and ' +
      'nothing you STORE can overwrite your code.';
    d.appendChild(p2);

    return d;
  };

  function mkH4(t) { return E('h4', null, t); }
  function mkTable(head, rows) {
    var t = document.createElement('table');
    var thead = document.createElement('tr');
    for (var i = 0; i < head.length; i++) {
      var th = document.createElement('th'); th.textContent = head[i]; thead.appendChild(th);
    }
    t.appendChild(thead);
    for (var r = 0; r < rows.length; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < rows[r].length; c++) {
        var td = document.createElement('td');
        // allow the small amount of markup used above (code/entities)
        td.innerHTML = rows[r][c];
        tr.appendChild(td);
      }
      t.appendChild(tr);
    }
    return t;
  }

  /* ---- memory grid, built once ---- */
  CpuUI.prototype.buildMemGrid = function () {
    this.elMem.textContent = '';
    this.memCells = [];
    var perRow = 16;
    for (var base = 0; base < MEM_SIZE; base += perRow) {
      var row = E('div', 'cpu-memrow');
      row.appendChild(E('span', 'ra', hex2(base)));
      for (var c = 0; c < perRow; c++) {
        var idx = base + c;
        var cell = E('span', 'cpu-mc', '0000');
        this.memCells[idx] = cell;
        row.appendChild(cell);
      }
      this.elMem.appendChild(row);
    }
  };

  /* ---- register cells, built once ---- */
  CpuUI.prototype.buildRegCells = function () {
    this.elRegs.textContent = '';
    this.regCells = {};
    var order = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'PC', 'SP'];
    for (var i = 0; i < order.length; i++) {
      var name = order[i];
      var cell = E('div', 'cpu-reg' + (name === 'PC' ? ' pcx' : ''));
      cell.appendChild(E('span', 'k', name));
      var vwrap = E('span', null);
      var v = E('span', 'v', '0x0000');
      var dd = E('span', 'd', '');
      vwrap.appendChild(v); vwrap.appendChild(document.createTextNode(' ')); vwrap.appendChild(dd);
      cell.appendChild(vwrap);
      this.elRegs.appendChild(cell);
      this.regCells[name] = { box: cell, v: v, d: dd };
    }

    this.elFlags.textContent = '';
    this.flagCells = {};
    var flags = [['Z', 'zero'], ['N', 'negative'], ['C', 'carry']];
    for (var f = 0; f < flags.length; f++) {
      var fc = E('div', 'cpu-flag');
      var b = E('b', null, '0');
      fc.appendChild(b);
      fc.appendChild(E('span', null, flags[f][1]));
      this.elFlags.appendChild(fc);
      this.flagCells[flags[f][0]] = { box: fc, b: b };
    }
  };

  /* ---- console helpers ---- */
  CpuUI.prototype.sys = function (text) {
    var s = E('span', 'sys', text + '\n'); this.elOut.appendChild(s); this.scrollOut();
  };
  CpuUI.prototype.emitErr = function (text) {
    var s = E('span', 'er', text + '\n'); this.elOut.appendChild(s); this.scrollOut();
  };
  CpuUI.prototype.emitOk = function (text) {
    var s = E('span', 'ok', text + '\n'); this.elOut.appendChild(s); this.scrollOut();
  };
  CpuUI.prototype.scrollOut = function () { this.elOut.scrollTop = this.elOut.scrollHeight; };

  /* ---- assemble ---- */
  CpuUI.prototype.doAssemble = function (announce) {
    this.stopRun(null);
    var asm = assemble(this.elCode.value);
    this.elOut.textContent = '';

    if (!asm.ok) {
      this.assembled = false;
      this.emitErr('Assembly failed — ' + asm.errors.length + ' error' + (asm.errors.length === 1 ? '' : 's') + ':');
      // sort by line
      asm.errors.sort(function (a, b) { return a.line - b.line; });
      for (var i = 0; i < asm.errors.length; i++) {
        var e = asm.errors[i];
        this.emitErr('  ' + (e.line ? 'line ' + e.line + ': ' : '') + e.msg);
      }
      this.cpu.program = [];
      this.renderListing();
      this.render();
      this.updateButtons();
      return;
    }

    this.cpu.load(asm);
    this.assembled = true;
    this.renderListing();
    this.render();
    if (announce) {
      var n = asm.program.length;
      var dn = asm.dataInit.length;
      this.emitOk('Assembled ' + n + ' instruction' + (n === 1 ? '' : 's') +
        (dn ? ' and ' + dn + ' data word' + (dn === 1 ? '' : 's') : '') + '.');
      this.sys('Ready. Press Step to run one instruction, or Run.');
    }
    this.updateButtons();
  };

  /* ---- listing ---- */
  CpuUI.prototype.renderListing = function () {
    this.elListing.textContent = '';
    this.listRows = [];
    var prog = this.cpu.program;
    if (!prog.length) {
      this.elListing.appendChild(E('div', 'cpu-empty', '(nothing assembled yet)'));
      return;
    }
    for (var i = 0; i < prog.length; i++) {
      var row = E('div', 'cpu-lrow');
      row.appendChild(E('span', 'a', pad(i, 2)));
      row.appendChild(E('span', 's', prog[i].src));
      this.elListing.appendChild(row);
      this.listRows[i] = row;
    }
  };

  CpuUI.prototype.highlightCurrent = function () {
    if (!this.listRows) return;
    for (var i = 0; i < this.listRows.length; i++) {
      var isCur = (!this.cpu.halted && i === this.cpu.pc);
      if (isCur) {
        if (this.listRows[i].className.indexOf('cur') < 0) this.listRows[i].className = 'cpu-lrow cur';
        this.scrollListIntoView(this.listRows[i]);
      } else {
        this.listRows[i].className = 'cpu-lrow';
      }
    }
  };

  CpuUI.prototype.scrollListIntoView = function (row) {
    var box = this.elListing;
    var top = row.offsetTop, h = row.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top - 4;
    else if (top + h > box.scrollTop + box.clientHeight) box.scrollTop = top + h - box.clientHeight + 4;
  };

  /* ---- render whole state ---- */
  CpuUI.prototype.render = function () {
    var cpu = this.cpu;
    var t = cpu.touch;

    // registers
    for (var i = 0; i < 8; i++) {
      var name = 'R' + i;
      var rc = this.regCells[name];
      rc.v.textContent = '0x' + hex4(cpu.regs[i]);
      rc.d.textContent = signed(cpu.regs[i]);
      rc.box.className = 'cpu-reg' + (t.regs[i] ? ' chg' : '');
    }
    var pc = this.regCells.PC;
    pc.v.textContent = pad(cpu.pc, 0);
    pc.d.textContent = cpu.halted ? 'halted' : (cpu.pc < cpu.program.length ? 'next' : 'end');
    pc.box.className = 'cpu-reg pcx';
    var sp = this.regCells.SP;
    sp.v.textContent = pad(cpu.sp, 0);
    sp.d.textContent = cpu.sp >= MEM_SIZE ? 'empty' : (MEM_SIZE - cpu.sp) + ' deep';
    sp.box.className = 'cpu-reg' + (t.sp ? ' chg' : '');

    // flags
    this.renderFlag('Z', cpu.Z, t.flags);
    this.renderFlag('N', cpu.N, t.flags);
    this.renderFlag('C', cpu.C, t.flags);

    // memory
    for (var m = 0; m < MEM_SIZE; m++) {
      var cell = this.memCells[m];
      cell.textContent = hex4(cpu.mem[m]);
      var cls = 'cpu-mc';
      if (cpu.mem[m] !== 0) cls += ' nz';
      if (m >= cpu.sp && cpu.sp < MEM_SIZE) cls += ' stk';
      if (m === cpu.sp && cpu.sp < MEM_SIZE) cls += ' sp';
      if (m === t.mem) cls += ' chg';
      cell.className = cls;
    }

    this.renderStack();
    this.renderOutput();
    this.highlightCurrent();
  };

  CpuUI.prototype.renderFlag = function (name, val, changed) {
    var fc = this.flagCells[name];
    fc.b.textContent = val ? '1' : '0';
    fc.box.className = 'cpu-flag' + (val ? ' on' : '') + (changed ? ' chg' : '');
  };

  CpuUI.prototype.renderStack = function () {
    this.elStack.textContent = '';
    var cpu = this.cpu;
    if (cpu.sp >= MEM_SIZE) {
      this.elStack.appendChild(E('div', 'cpu-empty', '(empty)'));
      return;
    }
    for (var a = cpu.sp; a < MEM_SIZE; a++) {
      var row = E('div', 'cpu-srow' + (a === cpu.sp ? ' top' : ''));
      row.appendChild(E('span', 'k', '[' + hex2(a) + ']' + (a === cpu.sp ? '  ← top' : '')));
      row.appendChild(E('span', 'v', '0x' + hex4(cpu.mem[a]) + '  (' + signed(cpu.mem[a]) + ')'));
      this.elStack.appendChild(row);
    }
  };

  // Only appends new output lines rather than rebuilding, so the console keeps
  // its scroll position while a program runs.
  CpuUI.prototype.renderOutput = function () {
    var cpu = this.cpu;
    var shown = this.shownOut || 0;
    for (var i = shown; i < cpu.output.length; i++) {
      var v = cpu.output[i];
      this.elOut.appendChild(E('span', 'ok', '→ ' + signed(v) + '\n'));
    }
    this.shownOut = cpu.output.length;
    this.scrollOut();
  };

  /* ---- controls ---- */
  CpuUI.prototype.doStep = function () {
    if (!this.assembled || !this.cpu.program.length) { this.sys('Assemble a program first.'); return; }
    if (this.cpu.halted) { this.sys('Halted. Press Reset to run it again.'); return; }
    this.cpu.step();
    this.render();
    this.afterStep();
  };

  CpuUI.prototype.afterStep = function () {
    if (this.cpu.error) { this.emitErr('Fault: ' + this.cpu.error); this.stopRun(null); this.updateButtons(); return; }
    if (this.cpu.halted) { this.emitOk('Program halted after ' + LabViz.humanNumber(this.cpu.steps) + ' instruction' + (this.cpu.steps === 1 ? '' : 's') + '.'); this.stopRun(null); this.updateButtons(); }
  };

  CpuUI.prototype.doReset = function () {
    this.stopRun(null);
    if (!this.cpu.program.length) { this.doAssemble(false); }
    this.cpu.reset();
    this.shownOut = 0;
    this.elOut.textContent = '';
    this.render();
    this.sys('Reset. PC back to 0, registers and memory cleared.');
    this.updateButtons();
  };

  CpuUI.prototype.speedDelay = function () {
    var s = +this.elSpeed.value;
    return Math.max(0, Math.round(300 * Math.pow(0.955, s)));
  };
  CpuUI.prototype.speedBatch = function (delay) {
    if (delay <= 6) return 60;
    if (delay < 25) return 8;
    return 1;
  };

  CpuUI.prototype.startRun = function () {
    if (!this.assembled || !this.cpu.program.length) { this.sys('Assemble a program first.'); return; }
    if (this.cpu.halted) { this.sys('Halted. Press Reset to run it again.'); return; }
    if (this.running) return;
    this.running = true;
    this.updateButtons();
    var self = this;
    var tick = function () {
      if (!self.running) return;
      var delay = self.speedDelay();
      var batch = self.speedBatch(delay);
      for (var i = 0; i < batch; i++) {
        if (self.cpu.halted) break;
        self.cpu.step();
        if (self.cpu.error || self.cpu.halted) break;
      }
      self.render();
      if (self.cpu.error || self.cpu.halted) { self.afterStep(); return; }
      self.timer = setTimeout(tick, delay);
    };
    this.timer = setTimeout(tick, this.speedDelay());
  };

  CpuUI.prototype.stopRun = function (note) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    var was = this.running;
    this.running = false;
    if (note && was) this.sys(note);
    this.updateButtons();
  };

  CpuUI.prototype.updateButtons = function () {
    var canStep = this.assembled && this.cpu.program.length && !this.cpu.halted && !this.running;
    this.btnStep.disabled = !canStep;
    this.btnRun.disabled = !canStep;
    this.btnStop.disabled = !this.running;
  };

  /* ====================================================================== */
  /*  BOOT                                                                  */
  /* ====================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var root = document.getElementById('cpuviz');
    if (!root) return;
    built = true;
    // eslint-disable-next-line no-new
    new CpuUI(root);
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    // proper path: build only once the Labs consent gate is satisfied
    LabViz.define({ id: 'cpuviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

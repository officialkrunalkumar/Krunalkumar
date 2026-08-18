/* ==========================================================================
   memory-safety.js — the stack, the overflow, and the mitigations, watchable.
   --------------------------------------------------------------------------
   The CPU simulator elsewhere in Labs shows registers changing. This lab shows
   the other half of "what a program is": the stack in memory, and what happens
   when a write runs off the end of a buffer into the saved return address that
   sits just above it. That single bug — copying attacker-controlled bytes into
   a fixed array without checking the length — is the oldest and still one of
   the most damaging classes of vulnerability there is, and it is almost never
   drawn. Here it is drawn, byte by byte.

   The lab is five families, all over one model of a downward-growing stack:

     1. Anatomy      — what a stack frame actually contains, and why the return
                       address is the interesting part.
     2. Overflow     — copy a string into an 8-byte buffer and watch it spill
                       upward over the saved frame pointer and return address.
     3. Hijack       — supply an overflow long enough to overwrite the return
                       address with the address of injected shellcode, and
                       watch RET jump to it.
     4. Canary       — turn on a stack canary and watch the same overflow get
                       caught at the epilogue instead of returning.
     5. Defences     — NX, ASLR and canaries together, and what each one does
                       and does not stop.

   Design decisions worth spelling out:

   1. A real but tiny memory model. The stack is an array of bytes at concrete
      (fake) addresses, growing DOWN from a high address the way x86 does. A
      buffer overflow is drawn as exactly what it is — a write to buffer[i] for
      i past the end — landing on bytes that belong to something else. Nothing
      is hand-waved; every byte shown has an address and an owner.

   2. Nothing actually executes. "Jump to shellcode" moves an instruction
      pointer to the address the return slot now holds and reports what is
      there. This is a diagram of control-flow hijack, not an exploit, and it
      could not be one — it is arithmetic over an array in a sandboxed tab.

   3. The mitigations are modelled honestly, including their limits. The canary
      catches a linear overflow but not an arbitrary write; NX stops shellcode
      on the stack but not return-oriented programming; ASLR raises the cost of
      guessing an address but a leak defeats it. A security lab that showed only
      the wins would be teaching false confidence.

   Nothing here opens a network connection.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* A byte in the model carries its address, its value and which region it
     belongs to, so the drawing code never has to guess and the overflow can
     be coloured by what it is destroying. */
  var REGION = {
    buffer: 'buffer', saved_fp: 'saved frame pointer', ret: 'return address',
    other_local: 'local variable', arg: 'argument', canary: 'stack canary',
    below: 'lower frame', free: 'unused'
  };

  /* Build a single stack frame as a byte array. The stack grows downward, so
     locals (the buffer) sit at LOWER addresses than the saved frame pointer
     and return address, and a forward write into the buffer climbs UP toward
     them — which is the whole geometry of the bug. */
  function buildFrame(opts) {
    opts = opts || {};
    var bufSize = opts.bufSize || 8;
    var withCanary = !!opts.canary;
    var base = 0x7ffe0000;      // a plausible-looking high stack address

    /* Layout from high address down to low:
         [ argument        ] 4 bytes
         [ return address  ] 4 bytes
         [ saved frame ptr ] 4 bytes
         [ canary          ] 4 bytes (only if enabled)
         [ buffer          ] bufSize bytes  <- lowest, where the copy starts
       The buffer is at the bottom, the return address near the top, and the
       copy walks upward from the buffer toward them. */
    var bytes = [];
    var addr = base;

    function region(name, size, values) {
      var cells = [];
      for (var i = 0; i < size; i++) {
        cells.push({ addr: addr, value: values ? values[i] : 0, region: name,
                     original: values ? values[i] : 0 });
        addr -= 1;
      }
      return cells;
    }

    // Values are given high-address-first because region() fills downward.
    // The return address is 0x00400540 in little-endian memory: the lowest of
    // its four bytes holds the least-significant 0x40. Stored high-to-low that
    // is [0x00, 0x40, 0x05, 0x40]. The canary is a StackGuard "terminator"
    // canary — it contains 0x00, so a string copy (which stops at the first
    // NUL) cannot reproduce it and step past.
    var argBytes = region(REGION.arg, 4, [0x00, 0x00, 0x00, 0x01]);
    var retBytes = region(REGION.ret, 4, [0x00, 0x40, 0x05, 0x40]);   // 0x00400540 little-endian
    var fpBytes = region(REGION.saved_fp, 4, [0x7f, 0xfe, 0xf0, 0xd0]);
    var canaryBytes = withCanary ? region(REGION.canary, 4, [0xff, 0x0d, 0x0a, 0x00]) : [];
    var bufBytes = region(REGION.buffer, bufSize, null);

    // stored high-to-low so index 0 is the top of the frame on screen
    bytes = argBytes.concat(retBytes, fpBytes, canaryBytes, bufBytes);

    return {
      bytes: bytes, base: base, bufSize: bufSize,
      bufStart: bufBytes.length ? bufBytes[bufBytes.length - 1].addr : base,
      canary: withCanary,
      // named landmarks, by address, for the drawing and the analysis
      retAddr: retBytes[retBytes.length - 1].addr,
      fpAddr: fpBytes[fpBytes.length - 1].addr,
      canaryAddr: withCanary ? canaryBytes[canaryBytes.length - 1].addr : -1,
      shellcodeAddr: bufBytes.length ? bufBytes[bufBytes.length - 1].addr : base
    };
  }

  function byteAt(frame, addr) {
    for (var i = 0; i < frame.bytes.length; i++) if (frame.bytes[i].addr === addr) return frame.bytes[i];
    return null;
  }

  /* ======================================================================== */
  /*  CORE — the copy that overflows                                          */
  /* ------------------------------------------------------------------------ */
  /*  Model strcpy: walk the input, writing one byte per step to buffer+i with */
  /*  NO bound check, exactly as the C standard library does. Record a frame   */
  /*  snapshot per byte so the write can be stepped and rewound. The return    */
  /*  is a list of steps; the last one carries the verdict.                    */
  /* ======================================================================== */

  function readWord(frame, addr) {
    // Little-endian 32-bit read: the lowest address holds the least
    // significant byte.
    return (byteAt(frame, addr).value |
            byteAt(frame, addr + 1).value << 8 |
            byteAt(frame, addr + 2).value << 16 |
            byteAt(frame, addr + 3).value << 24) >>> 0;
  }

  function overflowCopy(opts) {
    var frame = buildFrame(opts);
    var input = opts.input || [];
    var steps = [];
    var retOriginal = readWord(frame, frame.retAddr);
    var canaryOriginal = frame.canary ? readWord(frame, frame.canaryAddr) : null;

    // strcpy writes the bytes AND a terminating NUL. The write address starts
    // at the lowest buffer byte and climbs upward one address per character.
    var writeAddr = frame.bufStart;
    var wrote = [];
    var overwroteCanary = false, overwroteRet = false, overwroteFp = false;

    function snapshot(i, addr, val, note, done) {
      // deep-copy just the values, which is all the drawing needs
      var vals = frame.bytes.map(function (b) { return b.value; });
      steps.push({ index: i, writeAddr: addr, value: val, note: note,
                   values: vals, done: !!done,
                   overwroteCanary: overwroteCanary, overwroteRet: overwroteRet,
                   overwroteFp: overwroteFp });
    }

    snapshot(-1, frame.bufStart, null, 'Before the copy: the buffer is empty and the saved frame '
      + 'pointer and return address sit just above it, untouched.', false);

    var full = input.concat([0x00]);   // strcpy appends the NUL terminator
    for (var i = 0; i < full.length; i++) {
      var cell = byteAt(frame, writeAddr);
      var region = cell ? cell.region : REGION.free;
      if (cell) cell.value = full[i];
      if (region === REGION.canary) overwroteCanary = true;
      if (region === REGION.ret) overwroteRet = true;
      if (region === REGION.saved_fp) overwroteFp = true;

      var where = i < opts.bufSize ? 'inside the buffer (byte ' + i + ')'
                : 'PAST THE END, into the ' + region;
      snapshot(i, writeAddr, full[i],
        'Write ' + hex2(full[i]) + (i === input.length ? ' (the NUL terminator)' : '') +
        ' to ' + hexAddr(writeAddr) + ' — ' + where + '.',
        i === full.length - 1);
      wrote.push({ addr: writeAddr, value: full[i], region: region });
      // A C string is laid out low address to high, so buffer[0] is the lowest
      // byte and each successive character is written to the NEXT HIGHER
      // address. The write climbs upward, toward the saved frame pointer and
      // the return address sitting just above the buffer. That direction is the
      // entire bug: there is nothing between the end of the buffer and the
      // saved return address except an absence of a bounds check.
      writeAddr += 1;
    }

    // Verdict: what did the copy destroy, and what happens at RET?
    var canaryNow = frame.canary ? readWord(frame, frame.canaryAddr) : null;
    var canarySmashed = frame.canary && canaryNow !== canaryOriginal;
    var retValue = readWord(frame, frame.retAddr);

    return {
      frame: frame, steps: steps, input: input,
      overflowed: input.length >= opts.bufSize,
      overwroteRet: overwroteRet, overwroteFp: overwroteFp,
      canary: frame.canary, canarySmashed: canarySmashed,
      retValue: retValue, retOriginal: retOriginal,
      retChanged: retValue !== retOriginal,
      shellcodeAddr: frame.shellcodeAddr
    };
  }

  /* ======================================================================== */
  /*  helpers                                                                 */
  /* ======================================================================== */

  function hex2(v) { var s = (v & 0xFF).toString(16).toUpperCase(); return s.length < 2 ? '0' + s : s; }
  function hexAddr(v) {
    var s = (v >>> 0).toString(16).toUpperCase();
    while (s.length < 8) s = '0' + s;
    return '0x' + s;
  }
  function asciiOf(v) { return (v >= 0x20 && v < 0x7f) ? String.fromCharCode(v) : '·'; }
  function strToBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
    return out;
  }
  function repeatByte(v, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(v);
    return out;
  }

  var CORE = {
    buildFrame: buildFrame, overflowCopy: overflowCopy, byteAt: byteAt,
    REGION: REGION, hex2: hex2, hexAddr: hexAddr, asciiOf: asciiOf,
    strToBytes: strToBytes, repeatByte: repeatByte
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  var E = MV.el, clear = MV.clear, table = MV.table, button = MV.button;
  var group = MV.group, textBox = MV.textBox, numBox = MV.numBox, field = MV.field;
  var selectBox = MV.selectBox, CC = MV.C;

  var REGION_COLOUR = {};
  REGION_COLOUR[REGION.buffer] = '#1f6feb';
  REGION_COLOUR[REGION.saved_fp] = '#a78bfa';
  REGION_COLOUR[REGION.ret] = '#fb7185';
  REGION_COLOUR[REGION.canary] = '#fbbf24';
  REGION_COLOUR[REGION.arg] = '#34d399';
  REGION_COLOUR[REGION.other_local] = '#64748b';
  REGION_COLOUR[REGION.below] = '#334155';
  REGION_COLOUR[REGION.free] = '#1e293b';

  var EXTRA_CSS = [
    '.ms-stack{display:flex;flex-direction:column;gap:3px;font-size:12px;max-width:34rem;}',
    '.ms-row{display:grid;grid-template-columns:6.5rem 1fr;gap:8px;align-items:stretch;}',
    '.ms-addr{font-size:10px;color:' + CC.faint + ';padding-top:6px;text-align:right;}',
    '.ms-word{display:flex;gap:3px;padding:4px;border-radius:6px;border:1px solid #24344f;position:relative;}',
    '.ms-word-label{position:absolute;right:7px;top:50%;transform:translateY(-50%);font-size:10px;color:rgba(226,232,240,.8);pointer-events:none;}',
    '.ms-byte{width:2.1rem;height:2rem;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:4px;background:#0b1220;border:1px solid #24344f;}',
    '.ms-byte b{font-size:11px;font-weight:700;color:' + CC.ink + ';line-height:1.1;}',
    '.ms-byte i{font-size:9px;color:' + CC.faint + ';font-style:normal;line-height:1;}',
    '.ms-byte.written{border-color:' + CC.amber + ';}',
    '.ms-byte.now{box-shadow:0 0 0 2px ' + CC.amber + ';background:rgba(251,191,36,.16);}',
    '.ms-byte.smashed b{color:#04121f;}',
    '.ms-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:' + CC.dim + ';margin-top:4px;}',
    '.ms-legend span{display:inline-flex;align-items:center;gap:5px;}',
    '.ms-key{width:11px;height:11px;border-radius:3px;display:inline-block;}',
    '.ms-verdict{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
    '.ms-tag{padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;}',
    '.ms-tag-safe{background:rgba(52,211,153,.16);color:' + CC.green + ';}',
    '.ms-tag-bad{background:rgba(252,165,165,.16);color:' + CC.red + ';}',
    '.ms-tag-warn{background:rgba(251,191,36,.16);color:' + CC.amber + ';}',
    '.ms-ip{margin-top:6px;font-size:12px;color:' + CC.dim + ';word-break:break-all;}',
    '.ms-ip b{color:' + CC.ink + ';}',
    '.ms-def{display:flex;flex-direction:column;gap:8px;}',
    '.ms-defrow{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;padding:8px 10px;border:1px solid ' + CC.line + ';border-radius:8px;background:rgba(15,23,42,.5);}',
    '.ms-defrow h4{margin:0;font-size:12px;color:' + CC.ink + ';flex:0 0 8rem;}',
    '.ms-defrow .ms-on{color:' + CC.green + ';font-weight:700;}',
    '.ms-defrow .ms-off{color:' + CC.faint + ';}',
    '.ms-defrow p{margin:0;font-size:11px;line-height:1.6;color:' + CC.dim + ';flex:1;min-width:14rem;}',
    '.ms-toggle{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:' + CC.dim + ';cursor:pointer;}',
    '.ms-toggle input{accent-color:' + CC.blue + ';}'
  ].join('');

  /* Draw the stack as 4-byte words, high address at the top the way a debugger
     prints it, each byte showing hex and its ASCII. Regions are coloured, and
     the byte currently being written (or the ones an overflow destroyed) are
     highlighted. */
  function drawStack(host, frame, values, opts) {
    opts = opts || {};
    clear(host);
    var stack = E('div', 'ms-stack');

    // group bytes into words by address, high to low
    var i = 0;
    while (i < frame.bytes.length) {
      var row = E('div', 'ms-row');
      var top = frame.bytes[i];
      row.appendChild(E('div', 'ms-addr', hexAddr(top.addr - 3)));
      var word = E('div', 'ms-word');
      var region = top.region;
      word.style.background = 'rgba(255,255,255,0.02)';
      var labelShown = false;
      for (var k = 0; k < 4 && i < frame.bytes.length; k++, i++) {
        var cell = frame.bytes[i];
        var val = values ? values[i] : cell.value;
        var byte = E('div', 'ms-byte');
        byte.style.background = hexToRgba(REGION_COLOUR[cell.region] || '#1e293b',
          val !== cell.original ? 0.55 : 0.16);
        byte.style.borderColor = REGION_COLOUR[cell.region] || '#24344f';
        var b = E('b', null, hex2(val));
        var asc = E('i', null, asciiOf(val));
        byte.appendChild(b);
        byte.appendChild(asc);
        if (opts.writeAddr === cell.addr) byte.className = 'ms-byte now';
        else if (values && val !== cell.original) byte.className = 'ms-byte written';
        word.appendChild(byte);
      }
      var lab = E('span', 'ms-word-label', regionLabel(region));
      word.appendChild(lab);
      row.appendChild(word);
      stack.appendChild(row);
    }
    host.appendChild(stack);
  }

  function regionLabel(r) {
    if (r === REGION.ret) return '← return address';
    if (r === REGION.saved_fp) return '← saved frame ptr';
    if (r === REGION.canary) return '← stack canary';
    if (r === REGION.buffer) return '← char buf[]';
    if (r === REGION.arg) return '← argument';
    return '';
  }

  function hexToRgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function legend(host) {
    clear(host);
    var wrap = E('div', 'ms-legend');
    [[REGION.buffer, 'buffer'], [REGION.canary, 'canary'], [REGION.saved_fp, 'saved fp'],
     [REGION.ret, 'return address']].forEach(function (p) {
      var s = E('span');
      var k = E('i', 'ms-key');
      k.style.background = REGION_COLOUR[p[0]];
      s.appendChild(k);
      s.appendChild(document.createTextNode(p[1]));
      wrap.appendChild(s);
    });
    host.appendChild(wrap);
  }

  /* ======================================================================== */
  /*  Shared input model                                                      */
  /* ======================================================================== */

  var STATE = { bufSize: 8, canary: false };

  /* ======================================================================== */
  /*  FAMILY 1 — ANATOMY                                                      */
  /* ======================================================================== */

  function AnatomyFamily() {
    this.key = 'anatomy';
    this.label = 'Stack frame';
    this.algoKey = 'tour';
  }
  AnatomyFamily.prototype.algoOptions = function () { return [{ key: 'tour', label: 'Tour the frame' }]; };
  AnatomyFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The buffer');
    g.appendChild(field('Buffer size (bytes)', numBox(STATE.bufSize, 4, 16, function (v) {
      STATE.bufSize = v; onChange();
    })));
    g.appendChild(E('p', 'oa-hint',
      'A stack frame holds the function’s locals, the saved frame pointer of its caller, and the ' +
      'address to return to. They sit in memory in that order, and the return address is the prize.'));
    host.appendChild(g);
  };
  AnatomyFamily.prototype.buildStage = function (host) {
    this.stackHost = E('div');
    this.legendHost = E('div');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.stackHost);
    host.appendChild(this.legendHost);
    host.appendChild(this.tableHost);
  };
  AnatomyFamily.prototype.compute = function () {
    this.frame = buildFrame({ bufSize: STATE.bufSize, canary: false });
    this.error = null;
    // A frame has: buffer, saved fp, return address, argument — four landmarks.
    this.stops = [
      { region: REGION.buffer, title: 'the local buffer' },
      { region: REGION.saved_fp, title: 'the saved frame pointer' },
      { region: REGION.ret, title: 'the return address' },
      { region: REGION.arg, title: 'the caller’s argument' }
    ];
    return this.stops.length;
  };
  AnatomyFamily.prototype.render = function (idx) {
    var stop = this.stops[Math.min(idx, this.stops.length - 1)];
    var addr = stop.region === REGION.ret ? this.frame.retAddr
             : stop.region === REGION.saved_fp ? this.frame.fpAddr
             : stop.region === REGION.buffer ? this.frame.bufStart
             : this.frame.retAddr + 4;
    drawStack(this.stackHost, this.frame, null, { writeAddr: addr });
    legend(this.legendHost);
    clear(this.tableHost);
    var retTarget = (byteAt(this.frame, this.frame.retAddr).value |
                     byteAt(this.frame, this.frame.retAddr + 1).value << 8 |
                     byteAt(this.frame, this.frame.retAddr + 2).value << 16 |
                     byteAt(this.frame, this.frame.retAddr + 3).value << 24) >>> 0;
    this.tableHost.appendChild(table(
      ['Buffer at', 'Saved fp at', 'Return address at', 'Return points to'],
      [[hexAddr(this.frame.bufStart), hexAddr(this.frame.fpAddr),
        hexAddr(this.frame.retAddr), hexAddr(retTarget)]]));
  };
  AnatomyFamily.prototype.note = function (idx) {
    var stop = this.stops[Math.min(idx, this.stops.length - 1)];
    switch (stop.region) {
      case REGION.buffer: return 'The buffer sits at the LOWEST addresses of the frame. The stack ' +
        'grows downward, so a local array is at the bottom — and a string copied into it writes ' +
        'upward, toward everything important.';
      case REGION.saved_fp: return 'Just above the buffer is the saved frame pointer: the caller’s ' +
        'base pointer, restored when this function returns. It is the first casualty of an overflow.';
      case REGION.ret: return 'Above that is the return address — where the CPU jumps when this ' +
        'function finishes. Overwrite these four bytes and you choose where the program goes next. ' +
        'This is the target of the entire attack.';
      default: return 'At the top are the arguments the caller pushed. The whole frame is torn down ' +
        'on return, and the saved return address is what makes that orderly — until it is overwritten.';
    }
  };
  AnatomyFamily.prototype.compare = function () { return null; };

  /* ======================================================================== */
  /*  FAMILY 2 — OVERFLOW                                                     */
  /* ======================================================================== */

  var OVERFLOW_PRESETS = [
    { label: 'Fits (7 chars)', text: 'hello!!' },
    { label: 'One byte over', text: 'AAAAAAAAA' },
    { label: 'Into the saved fp', text: 'AAAAAAAAAAAA' },
    { label: 'Into the return address', text: 'AAAAAAAAAAAAAAAA' }
  ];

  function OverflowFamily() {
    this.key = 'overflow';
    this.label = 'Overflow';
    this.algoKey = 'copy';
    this.text = 'AAAAAAAAAAAA';
  }
  OverflowFamily.prototype.algoOptions = function () { return [{ key: 'copy', label: 'strcpy into the buffer' }]; };
  OverflowFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The input string');
    this.input = textBox(this.text, function (v) { self.text = v; onChange(); }, 'type a string to copy');
    this.input.className = 'oa-text oa-text-mono';
    g.appendChild(this.input);
    g.appendChild(E('p', 'oa-hint',
      'This is strcpy: it copies until a NUL and never checks the buffer size. Longer than the ' +
      'buffer, and it writes straight over the saved registers above it.'));
    host.appendChild(g);

    var g2 = group('Buffer');
    g2.appendChild(field('Size (bytes)', numBox(STATE.bufSize, 4, 16, function (v) {
      STATE.bufSize = v; onChange();
    })));
    host.appendChild(g2);

    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    OVERFLOW_PRESETS.forEach(function (p) {
      row.appendChild(button(p.label, function () { self.text = p.text; self.input.value = p.text; onChange(); }));
    });
    g3.appendChild(row);
    host.appendChild(g3);
  };
  OverflowFamily.prototype.buildStage = function (host) {
    this.topHost = E('div', 'ms-verdict');
    this.stackHost = E('div');
    this.legendHost = E('div');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.stackHost);
    host.appendChild(this.legendHost);
    host.appendChild(this.tableHost);
  };
  OverflowFamily.prototype.compute = function () {
    this.run = overflowCopy({ bufSize: STATE.bufSize, canary: false, input: strToBytes(this.text) });
    this.error = null;
    return this.run.steps.length;
  };
  OverflowFamily.prototype.render = function (idx) {
    var run = this.run;
    var step = run.steps[Math.min(idx, run.steps.length - 1)];
    clear(this.topHost);
    var isLast = idx >= run.steps.length - 1;
    if (isLast) {
      var tag = E('span', 'ms-tag ' + (run.retChanged ? 'ms-tag-bad' : (run.overwroteFp ? 'ms-tag-warn' : 'ms-tag-safe')));
      tag.textContent = run.retChanged ? 'RETURN ADDRESS OVERWRITTEN'
                      : run.overwroteFp ? 'saved frame pointer corrupted' : 'stayed in bounds';
      this.topHost.appendChild(tag);
      this.topHost.appendChild(E('span', 'ms-ip', 'return address now ' + hexAddr(run.retValue)));
    } else {
      this.topHost.appendChild(E('span', 'ms-tag ms-tag-warn', 'writing…'));
    }
    drawStack(this.stackHost, run.frame, step.values, { writeAddr: step.writeAddr });
    legend(this.legendHost);
    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Bytes written', 'Buffer size', 'Overwrote saved fp?', 'Overwrote return?', 'Return address'],
      [[Math.max(0, step.index + 1), STATE.bufSize, step.overwroteFp ? 'yes' : 'no',
        step.overwroteRet ? 'yes' : 'no', hexAddr(idx >= run.steps.length - 1 ? run.retValue : 0x00400540)]]));
  };
  OverflowFamily.prototype.note = function (idx) {
    return this.run.steps[Math.min(idx, this.run.steps.length - 1)].note;
  };
  OverflowFamily.prototype.compare = function () {
    var self = this;
    var sizes = [4, 8, 12, 16];
    return {
      title: 'How many bytes it takes to reach each target',
      head: ['Buffer size', 'Fills buffer at', 'Hits saved fp at', 'Hits return address at'],
      rows: sizes.map(function (s) {
        return { key: 's' + s, cls: s === STATE.bufSize ? 'oa-row-cur' : '',
                 cells: [s + ' bytes', s + ' chars', (s + 1) + ' chars', (s + 5) + ' chars'] };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — HIJACK                                                       */
  /* ======================================================================== */

  function HijackFamily() {
    this.key = 'hijack';
    this.label = 'Control-flow hijack';
    this.algoKey = 'exploit';
  }
  HijackFamily.prototype.algoOptions = function () { return [{ key: 'exploit', label: 'Overwrite the return address' }]; };
  HijackFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The exploit');
    g.appendChild(E('p', 'oa-hint',
      'The payload is a NOP sled and a jump target: fill the buffer and saved fp with filler, then ' +
      'set the return address to the start of the buffer, where injected code sits. On RET the CPU ' +
      'jumps into attacker data.'));
    host.appendChild(g);
    var g2 = group('Buffer');
    g2.appendChild(field('Size (bytes)', numBox(STATE.bufSize, 4, 16, function (v) {
      STATE.bufSize = v; onChange();
    })));
    host.appendChild(g2);
  };
  HijackFamily.prototype.buildStage = function (host) {
    this.topHost = E('div', 'ms-verdict');
    this.stackHost = E('div');
    this.ipHost = E('div', 'ms-ip');
    this.legendHost = E('div');
    host.appendChild(this.topHost);
    host.appendChild(this.stackHost);
    host.appendChild(this.ipHost);
    host.appendChild(this.legendHost);
  };
  HijackFamily.prototype.compute = function () {
    // NOP sled (0x90) filling buffer + saved fp, then the little-endian address
    // of the buffer as the new return address.
    var addr = 0;
    var probe = buildFrame({ bufSize: STATE.bufSize, canary: false });
    addr = probe.shellcodeAddr;
    var le = [addr & 0xFF, (addr >> 8) & 0xFF, (addr >> 16) & 0xFF, (addr >> 24) & 0xFF];
    var payload = repeatByte(0x90, STATE.bufSize + 4).concat(le);
    this.run = overflowCopy({ bufSize: STATE.bufSize, canary: false, input: payload });
    this.shellcodeAddr = addr;
    this.error = null;
    // steps of the copy, then one final "RET jumps" beat
    return this.run.steps.length + 1;
  };
  HijackFamily.prototype.render = function (idx) {
    var run = this.run;
    var jumped = idx >= run.steps.length;
    var step = run.steps[Math.min(idx, run.steps.length - 1)];
    clear(this.topHost);
    clear(this.ipHost);
    if (jumped) {
      this.topHost.appendChild(E('span', 'ms-tag ms-tag-bad', 'RET → attacker code'));
      this.ipHost.appendChild(E('b', null, 'instruction pointer = ' + hexAddr(run.retValue)));
      this.ipHost.appendChild(document.createTextNode(
        ' — which is inside the buffer. The CPU is now executing bytes the attacker supplied.'));
    } else {
      this.topHost.appendChild(E('span', 'ms-tag ms-tag-warn', 'building the payload…'));
    }
    drawStack(this.stackHost, run.frame, step.values, { writeAddr: jumped ? run.shellcodeAddr : step.writeAddr });
    legend(this.legendHost);
  };
  HijackFamily.prototype.note = function (idx) {
    var run = this.run;
    if (idx >= run.steps.length) {
      return 'The function returns. RET pops the saved return address — now ' + hexAddr(run.retValue) +
        ', the start of the buffer — into the instruction pointer, and the CPU begins executing the ' +
        'bytes that were copied in as “data”. Nothing here actually runs: this is a diagram of the ' +
        'hijack, drawn over an array in a sandboxed tab.';
    }
    return run.steps[Math.min(idx, run.steps.length - 1)].note;
  };
  HijackFamily.prototype.compare = function () { return null; };

  /* ======================================================================== */
  /*  FAMILY 4 — CANARY                                                       */
  /* ======================================================================== */

  function CanaryFamily() {
    this.key = 'canary';
    this.label = 'Stack canary';
    this.algoKey = 'guard';
    this.text = 'AAAAAAAAAAAAAAAAAA';
  }
  CanaryFamily.prototype.algoOptions = function () { return [{ key: 'guard', label: 'Overflow with a canary present' }]; };
  CanaryFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The input string');
    this.input = textBox(this.text, function (v) { self.text = v; onChange(); });
    this.input.className = 'oa-text oa-text-mono';
    g.appendChild(this.input);
    g.appendChild(E('p', 'oa-hint',
      'A stack canary is a known value placed between the buffer and the saved registers. The ' +
      'function checks it just before returning: if a linear overflow has changed it, the program ' +
      'aborts instead of returning into corrupted memory.'));
    host.appendChild(g);
    var g2 = group('Buffer');
    g2.appendChild(field('Size (bytes)', numBox(STATE.bufSize, 4, 16, function (v) {
      STATE.bufSize = v; onChange();
    })));
    host.appendChild(g2);
    var g3 = group('Load an example');
    var row = E('div', 'oa-btnrow');
    OVERFLOW_PRESETS.forEach(function (p) {
      row.appendChild(button(p.label, function () { self.text = p.text; self.input.value = p.text; onChange(); }));
    });
    g3.appendChild(row);
    host.appendChild(g3);
  };
  CanaryFamily.prototype.buildStage = function (host) {
    this.topHost = E('div', 'ms-verdict');
    this.stackHost = E('div');
    this.legendHost = E('div');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.topHost);
    host.appendChild(this.stackHost);
    host.appendChild(this.legendHost);
    host.appendChild(this.tableHost);
  };
  CanaryFamily.prototype.compute = function () {
    this.run = overflowCopy({ bufSize: STATE.bufSize, canary: true, input: strToBytes(this.text) });
    this.error = null;
    return this.run.steps.length + 1;   // +1 for the epilogue check
  };
  CanaryFamily.prototype.render = function (idx) {
    var run = this.run;
    var checked = idx >= run.steps.length;
    var step = run.steps[Math.min(idx, run.steps.length - 1)];
    clear(this.topHost);
    if (checked) {
      if (run.canarySmashed) {
        this.topHost.appendChild(E('span', 'ms-tag ms-tag-safe', 'CAUGHT — *** stack smashing detected ***'));
        this.topHost.appendChild(E('span', 'ms-ip', 'the program aborts instead of returning'));
      } else {
        var t = E('span', 'ms-tag ' + (run.overwroteRet ? 'ms-tag-bad' : 'ms-tag-safe'));
        t.textContent = run.overwroteRet ? 'canary intact but return already changed' : 'canary intact — safe return';
        this.topHost.appendChild(t);
      }
    } else {
      this.topHost.appendChild(E('span', 'ms-tag ms-tag-warn', 'writing…'));
    }
    drawStack(this.stackHost, run.frame, step.values, { writeAddr: checked ? run.frame.canaryAddr : step.writeAddr });
    legend(this.legendHost);
    clear(this.tableHost);
    this.tableHost.appendChild(table(
      ['Bytes written', 'Canary smashed?', 'Return overwritten?', 'Outcome at RET'],
      [[Math.max(0, step.index + 1), run.canarySmashed ? 'yes' : 'no',
        run.overwroteRet ? 'yes' : 'no',
        checked ? (run.canarySmashed ? 'ABORT' : 'return') : '—']]));
  };
  CanaryFamily.prototype.note = function (idx) {
    var run = this.run;
    if (idx >= run.steps.length) {
      if (run.canarySmashed) {
        return 'The epilogue compares the canary against its known value, finds it changed, and ' +
          'calls __stack_chk_fail — the program prints “stack smashing detected” and aborts. The ' +
          'overflow still happened, but control never reaches the corrupted return address.';
      }
      return 'The canary is unchanged, so the function returns normally. A canary only catches a ' +
        'CONTIGUOUS overflow that runs through it — an attacker who can write to an arbitrary ' +
        'address, skipping the canary, is not stopped by it.';
    }
    var s = run.steps[Math.min(idx, run.steps.length - 1)];
    if (s.overwroteCanary) return s.note + ' The canary has just been overwritten — this will be ' +
      'detected at the epilogue.';
    return s.note;
  };
  CanaryFamily.prototype.compare = function () {
    var self = this;
    return {
      title: 'The same overflow, with and without a canary',
      head: ['Protection', 'Overflow happens?', 'Return address reached?', 'Result'],
      rows: [
        { key: 'none', cls: 'oa-row-cur', cells: ['no canary', 'yes', 'yes', 'attacker controls execution'] },
        { key: 'canary', cells: ['stack canary', 'yes', 'no', 'program aborts safely'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 5 — DEFENCES                                                     */
  /* ======================================================================== */

  function DefenceFamily() {
    this.key = 'defences';
    this.label = 'Defences';
    this.algoKey = 'compare';
    this.nx = true; this.aslr = true; this.canary = true;
  }
  DefenceFamily.prototype.algoOptions = function () { return [{ key: 'compare', label: 'What each mitigation stops' }]; };
  DefenceFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('Mitigations enabled');
    [['canary', 'Stack canary'], ['nx', 'NX (non-executable stack)'], ['aslr', 'ASLR']].forEach(function (p) {
      var lab = E('label', 'ms-toggle');
      var box = E('input');
      box.type = 'checkbox';
      box.checked = self[p[0]];
      box.addEventListener('change', function () { self[p[0]] = box.checked; onChange(); });
      lab.appendChild(box);
      lab.appendChild(document.createTextNode(p[1]));
      g.appendChild(lab);
      g.appendChild(E('div', null, ''));
    });
    g.appendChild(E('p', 'oa-hint',
      'Modern binaries ship all three. None is sufficient alone, and each has a known bypass — ' +
      'which is why they are layered.'));
    host.appendChild(g);
  };
  DefenceFamily.prototype.buildStage = function (host) {
    this.defHost = E('div', 'ms-def');
    this.tableHost = E('div', 'oa-tableout');
    host.appendChild(this.defHost);
    host.appendChild(this.tableHost);
  };
  DefenceFamily.prototype.compute = function () {
    this.error = null;
    this.rows = [
      { key: 'canary', on: this.canary, name: 'Stack canary',
        stops: 'A linear buffer overflow that runs through the canary to the return address.',
        misses: 'An arbitrary write that skips the canary, or a leak that reveals its value.' },
      { key: 'nx', on: this.nx, name: 'NX / DEP',
        stops: 'Executing shellcode placed on the stack — the classic “jump into the buffer”.',
        misses: 'Return-oriented programming, which reuses existing executable code instead of injecting any.' },
      { key: 'aslr', on: this.aslr, name: 'ASLR',
        stops: 'Guessing the address of the buffer or a library, since they move every run.',
        misses: 'An information leak that discloses one real address, which unravels the rest.' }
    ];
    this.stages = this.rows.length + 1;
    return this.stages;
  };
  DefenceFamily.prototype.render = function (idx) {
    clear(this.defHost);
    clear(this.tableHost);
    var upto = Math.min(idx, this.rows.length - 1);
    this.rows.forEach(function (r, i) {
      if (i > upto && idx < this.rows.length) return;
      var row = E('div', 'ms-defrow');
      row.appendChild(E('h4', null, r.name));
      row.appendChild(E('span', r.on ? 'ms-on' : 'ms-off', r.on ? 'ON' : 'off'));
      var p = E('p');
      p.appendChild(document.createTextNode('Stops: ' + r.stops + ' '));
      var miss = E('span');
      miss.style.color = CC.amber;
      miss.textContent = 'Does not stop: ' + r.misses;
      p.appendChild(miss);
      row.appendChild(p);
      this.defHost.appendChild(row);
    }, this);

    var count = (this.canary ? 1 : 0) + (this.nx ? 1 : 0) + (this.aslr ? 1 : 0);
    var verdict = count === 3 ? 'All three layered: a real exploit now needs a memory leak AND a ROP chain — much harder, not impossible.'
      : count === 0 ? 'No mitigations: a textbook overflow works exactly as in the Hijack tab.'
      : count + ' of 3 enabled: the gaps above are the ones an attacker aims for.';
    this.tableHost.appendChild(table(['Mitigations on', 'Assessment'], [[count + ' of 3', verdict]]));
  };
  DefenceFamily.prototype.note = function (idx) {
    var upto = Math.min(idx, this.rows.length - 1);
    if (idx >= this.rows.length) {
      return 'Defence in depth: none of these stops an overflow from happening, and each has a ' +
        'documented bypass. Together they raise the cost enough that memory-safe languages — which ' +
        'prevent the write in the first place — are the real fix.';
    }
    var r = this.rows[upto];
    return r.name + (r.on ? ' is enabled. ' : ' is off. ') + 'It stops ' +
      r.stops.charAt(0).toLowerCase() + r.stops.slice(1) + ' It does NOT stop ' +
      r.misses.charAt(0).toLowerCase() + r.misses.slice(1);
  };
  DefenceFamily.prototype.compare = function () {
    return {
      title: 'Each mitigation, and its known bypass',
      head: ['Mitigation', 'Enabled', 'Stops', 'Bypassed by'],
      rows: this.rows.map(function (r) {
        return { key: r.key, cls: r.on ? 'oa-row-cur' : '',
                 cells: [r.name, r.on ? 'yes' : 'no',
                         r.stops.split('.')[0], r.misses.split(',')[0].split('.')[0]] };
      })
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'memsafetyviz',
    mountId: 'viz-memsafety-mount',
    name: 'The memory-safety visualiser',
    css: EXTRA_CSS,
    families: function () {
      return [new AnatomyFamily(), new OverflowFamily(), new HijackFamily(),
              new CanaryFamily(), new DefenceFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

/* ==========================================================================
   overflow.js — a stack you can smash, one byte at a time.
   --------------------------------------------------------------------------
   "The return address gets overwritten" is the sentence everyone repeats and
   almost nobody has watched. This lab lays out a real call frame — arguments,
   saved return address, saved frame pointer, the canary if it is enabled, then
   the local buffer — and copies an oversized string into that buffer one byte
   per step. You see the bytes march past the end of the buffer, through the
   canary, over the saved frame pointer, and into the return address. Then the
   function returns, and wherever those four bytes now point is where execution
   goes.

   Design decisions worth spelling out:

   1. A 32-bit layout, deliberately. Four-byte addresses fit on screen, and the
      classic literature every reader will meet next is written for it. The
      lesson transfers unchanged to 64-bit; only the column width changes.

   2. Deterministic "randomness". ASLR and the stack canary need unpredictable
      values, but a lab that produced different numbers on every render could
      not be stepped backwards and could not be tested. A small seeded PRNG
      gives both: unpredictable to the attacker in the story, reproducible for
      anyone checking the arithmetic.

   3. Mitigations are modelled where they actually act, not as a flag that
      prints "blocked". The canary is bytes in the frame that the epilogue
      compares; NX is a property of the stack pages checked at the moment of
      the jump; ASLR changes the buffer's address so a hardcoded one misses.
      Each one therefore fails at a different point in the same attack, which
      is the entire reason defence in depth is worth anything.

   4. Nothing is executed. There is no shellcode here, only a byte pattern
      labelled as such and a simulation that reports where control would have
      gone. This is a diagram that can be stepped, not an exploit.

   Nothing here opens a network connection.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  var WORD = 4;                       // 32-bit words, for a readable diagram
  var STACK_TOP = 0xBFFFF100;

  /* A tiny deterministic PRNG (mulberry32). Real ASLR and real canaries come
     from the kernel; here they come from a seed, so a run can be replayed. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hex8(v) {
    var s = (v >>> 0).toString(16).toUpperCase();
    while (s.length < 8) s = '0' + s;
    return '0x' + s;
  }
  function hex2(b) {
    var s = (b & 0xFF).toString(16).toUpperCase();
    return s.length < 2 ? '0' + s : s;
  }
  function printable(b) {
    return b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.';
  }

  /* ======================================================================== */
  /*  THE FRAME                                                               */
  /* ------------------------------------------------------------------------ */
  /*  Laid out the way the machine lays it out: the stack grows DOWN, so the   */
  /*  buffer sits at the lowest address and everything worth clobbering is     */
  /*  above it. That single fact is why a forward copy can reach the return    */
  /*  address at all.                                                          */
  /* ======================================================================== */

  function buildFrame(cfg) {
    var bufSize = Math.max(4, cfg.bufSize | 0);
    var rand = rng(cfg.seed || 1);

    // ASLR shifts the whole frame; without it the addresses are the same on
    // every run, which is exactly what makes a hardcoded return address work.
    var slide = cfg.aslr ? Math.floor(rand() * 0x1000) * 0x10 : 0;
    var top = (STACK_TOP - slide) >>> 0;

    var slots = [];
    var addr = top;

    function push(name, size, kind, bytes) {
      addr = (addr - size) >>> 0;
      slots.unshift({ name: name, addr: addr, size: size, kind: kind,
                      bytes: bytes || new Array(size).fill(0) });
      return addr;
    }

    // Highest address first, so pushes walk downward into the buffer.
    var argAddr = push('argument: char *src', WORD, 'arg', wordBytes(0x08049A20));
    var retAddr = push('saved return address', WORD, 'ret', wordBytes(cfg.returnTo || 0x080484D6));
    var ebpAddr = push('saved frame pointer', WORD, 'ebp', wordBytes(0xBFFFF0C8));
    var canaryValue = null, canaryAddr = null;
    if (cfg.canary) {
      // A terminator canary: the low byte is zero so that a string copy cannot
      // write past it without stopping. That detail is the actual design.
      canaryValue = ((Math.floor(rand() * 0xFFFFFF) << 8) >>> 0);
      canaryAddr = push('stack canary', WORD, 'canary', wordBytes(canaryValue));
    }
    var bufAddr = push('char buf[' + bufSize + ']', bufSize, 'buffer', new Array(bufSize).fill(0));

    return {
      slots: slots, bufAddr: bufAddr, bufSize: bufSize,
      retAddr: retAddr, ebpAddr: ebpAddr, canaryAddr: canaryAddr,
      canaryValue: canaryValue, argAddr: argAddr, base: bufAddr, top: top,
      cfg: cfg
    };
  }

  function wordBytes(v) {
    // Little-endian, because that is what the reader's machine does and the
    // byte order is visible in the diagram.
    return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  }
  function readWord(frame, addr) {
    var b = [];
    for (var i = 0; i < WORD; i++) b.push(byteAt(frame, addr + i));
    return ((b[3] << 24) | (b[2] << 16) | (b[1] << 8) | b[0]) >>> 0;
  }
  function byteAt(frame, addr) {
    for (var i = 0; i < frame.slots.length; i++) {
      var s = frame.slots[i];
      if (addr >= s.addr && addr < s.addr + s.size) return s.bytes[addr - s.addr];
    }
    return 0;
  }
  function writeByte(frame, addr, value) {
    for (var i = 0; i < frame.slots.length; i++) {
      var s = frame.slots[i];
      if (addr >= s.addr && addr < s.addr + s.size) {
        s.bytes[addr - s.addr] = value & 0xFF;
        return s;
      }
    }
    return null;
  }

  /* ======================================================================== */
  /*  THE PAYLOAD                                                             */
  /* ======================================================================== */

  var SHELLCODE = [0x31, 0xC0, 0x50, 0x68, 0x2F, 0x2F, 0x73, 0x68,
                   0x68, 0x2F, 0x62, 0x69, 0x6E, 0x89, 0xE3, 0x50,
                   0x53, 0x89, 0xE1, 0xB0, 0x0B, 0xCD, 0x80];

  /* Three shapes of input, because they fail in visibly different ways. */
  function buildPayload(kind, length, frame, guessAddr) {
    var out = [], i;
    if (kind === 'plain') {
      for (i = 0; i < length; i++) out.push(0x41);              // 'A'
      return { bytes: out, label: length + ' bytes of "A"' };
    }
    if (kind === 'pattern') {
      // A cyclic pattern: every four bytes are unique, so whichever four land
      // in the return address
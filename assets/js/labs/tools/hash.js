/* ==========================================================================
   hash.js — hashing, HMAC, verification and hash identification.
   --------------------------------------------------------------------------
   SHA-1/256/384/512 and HMAC come from WebCrypto, so they are the browser's
   own audited implementations rather than something reimplemented here.

   MD5 is not in WebCrypto — deliberately, because it is broken for anything
   security-critical — but forensics still runs into it constantly in old
   evidence manifests and malware feeds, so a compact implementation is
   included and clearly labelled as unsafe for integrity claims.

   Nothing is uploaded: the file is read with FileReader and hashed in this
   tab. That is the difference between this and every other online hash tool,
   and it is the entire reason it is safe to drop evidence into.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX = 256 * 1024 * 1024;   // beyond this the browser tab is the bottleneck

  /* ---- MD5, because forensics data still uses it ------------------------ */
  function md5(bytes) {
    function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
    function add(a, b) { return (a + b) & 0xffffffff; }
    var S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    var K = [];
    for (var i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;

    var len = bytes.length;
    var withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
    withPad.set(bytes);
    withPad[len] = 0x80;
    var bitLen = len * 8;
    var dv = new DataView(withPad.buffer);
    dv.setUint32(withPad.length - 8, bitLen & 0xffffffff, true);
    dv.setUint32(withPad.length - 4, Math.floor(bitLen / 4294967296), true);

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (var chunk = 0; chunk < withPad.length; chunk += 64) {
      var M = new Uint32Array(16);
      for (var j = 0; j < 16; j++) M[j] = dv.getUint32(chunk + j * 4, true);
      var A = a0, B = b0, C = c0, D = d0;
      for (var k = 0; k < 64; k++) {
        var F, g;
        if (k < 16)      { F = (B & C) | (~B & D);          g = k; }
        else if (k < 32) { F = (D & B) | (~D & C);          g = (5 * k + 1) % 16; }
        else if (k < 48) { F = B ^ C ^ D;                   g = (3 * k + 5) % 16; }
        else             { F = C ^ (B | ~D);                g = (7 * k) % 16; }
        F = add(add(add(F, A), K[k]), M[g]);
        A = D; D = C; C = B;
        B = add(B, rl(F, S[k]));
      }
      a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    var outBytes = new Uint8Array(16);
    var odv = new DataView(outBytes.buffer);
    odv.setUint32(0, a0, true); odv.setUint32(4, b0, true);
    odv.setUint32(8, c0, true); odv.setUint32(12, d0, true);
    return LabTool.toHex(outBytes);
  }

  async function webHash(name, bytes) {
    var digest = await crypto.subtle.digest(name, bytes);
    return LabTool.toHex(new Uint8Array(digest));
  }

  /* ---- hash identification --------------------------------------------- */
  var SHAPES = [
    { re: /^[a-f0-9]{32}$/i,  names: 'MD5, MD4, NTLM or LM — 128 bits' },
    { re: /^[a-f0-9]{40}$/i,  names: 'SHA-1 or RIPEMD-160 — 160 bits' },
    { re: /^[a-f0-9]{56}$/i,  names: 'SHA-224 or SHA3-224 — 224 bits' },
    { re: /^[a-f0-9]{64}$/i,  names: 'SHA-256, SHA3-256 or BLAKE2s — 256 bits' },
    { re: /^[a-f0-9]{96}$/i,  names: 'SHA-384 or SHA3-384 — 384 bits' },
    { re: /^[a-f0-9]{128}$/i, names: 'SHA-512, SHA3-512 or BLAKE2b — 512 bits' },
    { re: /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, names: 'bcrypt' },
    { re: /^\$argon2(id|i|d)\$/, names: 'Argon2' },
    { re: /^\$6\$/, names: 'SHA-512 crypt (Linux /etc/shadow)' },
    { re: /^\$5\$/, names: 'SHA-256 crypt (Linux /etc/shadow)' },
    { re: /^\$1\$/, names: 'MD5 crypt' },
    { re: /^\$y\$/, names: 'yescrypt (modern Linux /etc/shadow)' },
    { re: /^[A-Za-z0-9+/]{43}=$/, names: 'base64-encoded 256-bit digest' }
  ];

  function identify(text) {
    var value = String(text).trim();
    if (!value) return null;
    for (var i = 0; i < SHAPES.length; i++) {
      if (SHAPES[i].re.test(value)) return SHAPES[i].names;
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  var out = LabTool.out('tool-out');
  var lastBytes = null;
  var lastName = '';

  function encoder(text) { return new TextEncoder().encode(text); }

  async function hashAll(bytes, label) {
    out.clear();
    out.heading(label);
    out.row('size', LabTool.humanBytes(bytes.length) + '  (' + bytes.length + ' bytes)');
    out.rule();

    var md5hex = md5(bytes);
    out.row('MD5', md5hex, 't-warn');
    out.row('SHA-1', await webHash('SHA-1', bytes), 't-warn');
    out.row('SHA-256', await webHash('SHA-256', bytes), 't-ok');
    out.row('SHA-384', await webHash('SHA-384', bytes));
    out.row('SHA-512', await webHash('SHA-512', bytes));
    out.rule();
    out.dim('MD5 and SHA-1 are shown in amber: both have practical collision');
    out.dim('attacks and neither should back an integrity claim today. They');
    out.dim('remain here because old evidence manifests are full of them.');

    // Verification against a hash the visitor already holds.
    var expected = document.getElementById('tool-expect').value.trim().toLowerCase();
    if (!expected) return;
    out.rule();
    var digests = {
      md5: md5hex,
      sha1: await webHash('SHA-1', bytes),
      sha256: await webHash('SHA-256', bytes),
      sha384: await webHash('SHA-384', bytes),
      sha512: await webHash('SHA-512', bytes)
    };
    var matched = Object.keys(digests).filter(function (k) { return digests[k] === expected; });
    if (matched.length) {
      out.ok('MATCH — the ' + matched.join('/').toUpperCase() + ' digest is identical.');
    } else {
      out.err('NO MATCH — none of the digests above equal the expected value.');
      var guess = identify(expected);
      if (guess) out.dim('The value you pasted looks like: ' + guess);
    }
  }

  async function hmac(bytes, keyText, algo) {
    var key = await crypto.subtle.importKey(
      'raw', encoder(keyText), { name: 'HMAC', hash: algo }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', key, bytes);
    return LabTool.toHex(new Uint8Array(sig));
  }

  async function run() {
    var mode = document.getElementById('tool-mode').value;
    var text = document.getElementById('tool-text').value;

    try {
      if (mode === 'text') {
        if (!text) { out.clear().warn('Type or paste some text first.'); return; }
        await hashAll(encoder(text), 'Text — ' + text.length + ' characters');
      } else if (mode === 'file') {
        if (!lastBytes) { out.clear().warn('Choose or drop a file first.'); return; }
        await hashAll(lastBytes, lastName);
      } else if (mode === 'hmac') {
        var key = document.getElementById('tool-key').value;
        if (!key) { out.clear().warn('An HMAC needs a key.'); return; }
        var data = lastBytes || encoder(text);
        out.clear();
        out.heading('HMAC — ' + (lastBytes ? lastName : 'text input'));
        out.row('key length', key.length + ' characters');
        out.rule();
        out.row('HMAC-SHA-1', await hmac(data, key, 'SHA-1'), 't-warn');
        out.row('HMAC-SHA-256', await hmac(data, key, 'SHA-256'), 't-ok');
        out.row('HMAC-SHA-512', await hmac(data, key, 'SHA-512'));
        out.rule();
        out.dim('HMAC proves both integrity and that the sender held the key —');
        out.dim('a plain hash proves only integrity.');
      } else if (mode === 'identify') {
        var guess = identify(text);
        out.clear();
        out.heading('Hash identification');
        if (!text.trim()) { out.warn('Paste a hash to identify.'); return; }
        out.row('length', text.trim().length + ' characters');
        if (guess) {
          out.row('likely', guess, 't-ok');
          out.rule();
          out.dim('Length alone cannot separate algorithms that share a digest');
          out.dim('size — MD5 and NTLM are both 32 hex characters, and nothing');
          out.dim('in the value itself distinguishes them. Context does.');
        } else {
          out.err('No match. It may be truncated, salted, or an encoding rather');
          out.err('than a hash — try the encoding tool if it looks like base64.');
        }
      }
    } catch (err) {
      out.clear().err('Failed: ' + (err && err.message ? err.message : err));
    }
  }

  function syncMode() {
    var mode = document.getElementById('tool-mode').value;
    document.getElementById('pane-text').hidden = (mode === 'file');
    document.getElementById('pane-file').hidden = (mode !== 'file' && mode !== 'hmac');
    document.getElementById('pane-key').hidden = (mode !== 'hmac');
    document.getElementById('pane-expect').hidden = (mode !== 'file' && mode !== 'text');
  }

  LabTool.define({
    id: 'hashtool',
    run: run,
    onReady: function () {
      document.getElementById('tool-mode').addEventListener('change', syncMode);
      syncMode();
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX,
        onFile: function (bytes, file) {
          lastBytes = bytes;
          lastName = file.name + '  (' + LabTool.humanBytes(file.size) + ')';
          document.getElementById('tool-dropname').textContent = file.name;
          run();
        },
        onError: function (msg) { out.clear().err(msg); }
      });
      out.dim('Choose a mode, then Run — or press Ctrl + Enter.');
    }
  });
})();

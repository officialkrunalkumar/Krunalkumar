/* ==========================================================================
   ssh-keys.js — take an SSH public key apart and say whether it is any good.
   --------------------------------------------------------------------------
   cert-decoder reads X.509. jwt reads a token. Nothing here read the key
   format that actually guards production: the one line in authorized_keys
   that decides who gets a shell.

   IT PARSES THE WIRE FORMAT, IT DOES NOT TRUST THE LABEL. An SSH public key
   is "<type> <base64> <comment>", and the base64 blob repeats the type inside
   itself as its first length-prefixed field. Almost every tool prints the
   label from the front of the line. This decodes the blob and compares the
   two, because a line whose label and payload disagree is either corrupted in
   transit or edited by hand, and either way you want to know before it goes
   into authorized_keys.

   BOTH FINGERPRINTS, because OpenSSH changed format in 6.8 and the estate
   did not change with it. ssh-keygen -l prints SHA256:base64 today; a decade
   of runbooks, wikis and inventory spreadsheets record MD5 hex. Printing only
   the modern one means anyone comparing against an old record has to go and
   find another tool.

   IT REFUSES PRIVATE KEYS, LOUDLY. Pasting a private key into a web page is
   the single worst thing you can do with one, and it happens constantly
   because a private key and a public key sit next to each other in the same
   directory with names one character apart. Every other tool of this kind
   would cheerfully fail to parse it and say "invalid key". This one stops,
   names what it saw, and tells you to rotate it — because if it reached this
   page it may have reached a worse one.

   WHAT IT WILL NOT DO. It cannot tell you whether a key is authorised
   anywhere, whether the matching private key still exists, or who holds it.
   Those are facts about your fleet, not about the bytes, and no amount of
   parsing recovers them.

   Specifications: RFC 4253 §6.6 (key format), RFC 4716, RFC 8709 (Ed25519),
   RFC 5656 (ECDSA), and OpenSSH's sshd(8) AUTHORIZED_KEYS FILE FORMAT.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

/* global LabTool, HashEngines */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ------------------------------------------------------------------
     Output width, measured rather than assumed. Same reasoning as the
     OAuth lab: this tool writes prose, and a phone terminal is about
     thirty characters wide.
     ------------------------------------------------------------------ */

  var COLS = 72;

  function measureCols() {
    var pane = out.node;
    if (!pane) return 72;
    var cs = getComputedStyle(pane);
    var usable = pane.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    /* clientWidth excludes a scrollbar that is showing but not one that is
       about to: run() measures just after clear(), when the pane is empty. */
    if (/auto|scroll/.test(cs.overflowY) && pane.scrollHeight <= pane.clientHeight) usable -= 16;
    if (usable < 120) return 72;
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + cs.font;
    var sample = new Array(51).join('0');
    probe.textContent = sample;
    pane.appendChild(probe);
    var adv = probe.getBoundingClientRect().width / sample.length;
    probe.parentNode.removeChild(probe);
    if (!adv || !isFinite(adv)) return 72;
    return Math.max(26, Math.min(92, Math.floor(usable / adv) - 1));
  }

  function say(text, indent, cls) {
    indent = indent || '';
    var width = Math.max(12, COLS - indent.length);
    var words = String(text).split(/\s+/).filter(Boolean);
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (line && (line + ' ' + words[i]).length > width) {
        out.line(indent + line, cls); line = words[i];
      } else { line = line ? line + ' ' + words[i] : words[i]; }
    }
    if (line) out.line(indent + line, cls);
  }
  function p(t) { say(t, '  ', 't-dim'); }
  function pw(t) { say(t, '  ', 't-warn'); }
  function pe(t) { say(t, '  ', 't-err'); }
  function po(t) { say(t, '  ', 't-ok'); }
  function rule() { out.dim(new Array(COLS + 1).join('─')); }

  /* A fingerprint is 47-plus characters and must never be broken across
     lines — it is the thing the reader is going to compare character by
     character against a runbook. Narrow panes get it on its own line. */
  function kv(label, value, cls) {
    var v = String(value);
    /* 22 is the gutter out.row() pads to. Stack the pair whenever it will not
       fit on one line, rather than letting the value wrap mid-token: these are
       fingerprints, verifiers and challenges — the things a reader compares
       character by character against something else. A fingerprint broken
       across two lines is a fingerprint nobody can check. */
    if (COLS >= 58 && 22 + v.length <= COLS) { out.row(label, v, cls); return; }
    out.line(label, 't-dim');
    /* A value containing spaces is prose and should reflow to the pane. One
       without is a single token — a fingerprint, a challenge, a hash — and
       breaking it across lines produces something that does not work when
       copied, which is worse than a line that runs long. */
    if (/\s/.test(v) && v.length > COLS - 2) say(v, '  ', cls);
    else out.line('  ' + v, cls);
  }

  /* ------------------------------------------------------------------
     Bytes.
     ------------------------------------------------------------------ */

  function b64ToBytes(s) {
    var clean = String(s).replace(/\s+/g, '');
    var bin = atob(clean);                    // throws on malformed input
    var b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  function bytesToB64(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function hexToBytes(h) {
    var b = new Uint8Array(h.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return b;
  }

  function ascii(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  /* RFC 4251 §5: a string is a 32-bit big-endian length then that many bytes.
     Returns null rather than throwing on a truncated blob, so the caller can
     say WHERE the parse ran out instead of reporting "invalid key". */
  function readString(b, off) {
    if (off + 4 > b.length) return null;
    var len = ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
    if (len > 100000 || off + 4 + len > b.length) return null;
    return { bytes: b.subarray(off + 4, off + 4 + len), next: off + 4 + len };
  }

  /* An mpint is big-endian two's complement, so a value whose top bit is set
     carries a leading zero byte. Counting the byte length as the key size is
     the classic off-by-eight that reports a 2048-bit key as 2056. */
  function mpintBits(b) {
    var i = 0;
    while (i < b.length && b[i] === 0) i++;
    if (i === b.length) return 0;
    var bits = (b.length - i - 1) * 8;
    var v = b[i];
    while (v) { bits++; v >>= 1; }
    return bits;
  }

  function digest(name, bytes) {
    var h = HashEngines.create(name);
    h.update(bytes);
    return h.digest();                        // hex
  }

  function fpSha256(blob) {
    /* OpenSSH prints base64 with the padding stripped. */
    return 'SHA256:' + bytesToB64(hexToBytes(digest('sha256', blob))).replace(/=+$/, '');
  }

  function fpMd5(blob) {
    return 'MD5:' + (digest('md5', blob).match(/../g) || []).join(':');
  }

  /* ------------------------------------------------------------------
     What each key type is, and what to say about it.
     ------------------------------------------------------------------ */

  var CURVE_BITS = { 'nistp256': 256, 'nistp384': 384, 'nistp521': 521 };

  /* ------------------------------------------------------------------
     Line shapes: a bare key, an authorized_keys line with options in
     front, or a known_hosts line with a host pattern in front.
     ------------------------------------------------------------------ */

  var KEY_TYPE = /^(sk-)?(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp\d+|[a-z0-9-]+@openssh\.com)$/;

  function splitLine(line) {
    var parts = line.split(/\s+/).filter(Boolean);
    /* Find the first field that looks like a key type. Anything before it is
       either authorized_keys options or a known_hosts host pattern; both are
       worth reporting rather than silently dropping. */
    for (var i = 0; i < parts.length && i < 3; i++) {
      if (KEY_TYPE.test(parts[i]) && parts[i + 1]) {
        return {
          prefix: parts.slice(0, i).join(' '),
          type: parts[i],
          b64: parts[i + 1],
          comment: parts.slice(i + 2).join(' ')
        };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------
     The one refusal that matters.
     ------------------------------------------------------------------ */

  var PRIVATE = [
    ['-----BEGIN OPENSSH PRIVATE KEY-----', 'an OpenSSH private key'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'a PEM RSA private key'],
    ['-----BEGIN DSA PRIVATE KEY-----', 'a PEM DSA private key'],
    ['-----BEGIN EC PRIVATE KEY-----', 'a PEM EC private key'],
    ['-----BEGIN PRIVATE KEY-----', 'a PKCS#8 private key'],
    ['-----BEGIN ENCRYPTED PRIVATE KEY-----', 'an encrypted PKCS#8 private key'],
    ['PuTTY-User-Key-File', 'a PuTTY private key (.ppk)']
  ];

  function refusePrivate(text) {
    for (var i = 0; i < PRIVATE.length; i++) {
      if (text.indexOf(PRIVATE[i][0]) !== -1) {
        out.err('STOP. That is ' + PRIVATE[i][1] + ', not a public key.');
        out.line('');
        pe('Nothing has been parsed, nothing has been hashed, and nothing has ' +
           'left this tab — this page has no network code in it at all. But the ' +
           'bytes are in your clipboard and in this browser\'s memory, and I ' +
           'cannot tell you where else they have been pasted today.');
        out.line('');
        p('What to do:');
        p('· Clear your clipboard.');
        p('· If it went into any other website, treat the key as compromised: ' +
          'generate a new one, deploy it, then remove the old public key from ' +
          'every authorized_keys and every service that holds it.');
        out.line('');
        p('The public half is the file ending .pub next to it. That is the one ' +
          'this tool wants, and the one that is safe to paste anywhere:');
        out.line('    cat ~/.ssh/id_ed25519.pub', 't-ok');
        out.line('');
        p('A private key is never needed to compute a fingerprint. ' +
          'ssh-keygen -l -f reads the public half.');
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------
     Inspect one key line.
     ------------------------------------------------------------------ */

  function inspect(line, index, total) {
    if (total > 1) {
      out.line('');
      rule();
      say('Key ' + index + ' of ' + total, '', 't-info');
      rule();
    }

    var parts = splitLine(line);
    if (!parts) {
      out.err('Not an SSH public key line.');
      p('Expected "<type> <base64> [comment]", for example:');
      out.line('    ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@host', 't-dim');
      return;
    }

    var blob;
    try { blob = b64ToBytes(parts.b64); }
    catch (e) {
      out.err('The key body is not valid base64.');
      p('Most often a line break inserted by an editor or an email client. ' +
        'A public key is one line, however long it looks.');
      return;
    }

    /* --- the type inside the blob, which is the one that counts --- */
    var first = readString(blob, 0);
    if (!first) {
      out.err('The base64 decoded, but the result is not an SSH key blob.');
      p('It is ' + blob.length + ' bytes and does not begin with a ' +
        'length-prefixed type name. Something has re-encoded it.');
      return;
    }
    var inner = ascii(first.bytes);

    say('SSH public key', '', 't-info');
    rule();

    kv('declared type', parts.type);
    if (inner === parts.type) {
      kv('type inside blob', inner, 't-ok');
    } else {
      kv('type inside blob', inner, 't-err');
      out.line('');
      pe('MISMATCH. The label on the line and the type inside the encoded key ' +
         'disagree. This key has been edited by hand or damaged in transit. Do ' +
         'not install it — fetch a fresh copy from the person who owns it.');
      out.line('');
    }

    /* --- size and algorithm detail --- */
    var bits = null;
    var note = '';
    if (inner === 'ssh-rsa' || inner === 'ssh-rsa-cert-v01@openssh.com') {
      var e = readString(blob, first.next);
      var n = e && readString(blob, e.next);
      if (n) {
        bits = mpintBits(n.bytes);
        kv('modulus', bits + ' bits');
        kv('public exponent', mpintBits(e.bytes) === 0 ? '0' : String(bytesToInt(e.bytes)));
      }
    } else if (inner === 'ssh-ed25519') {
      var k = readString(blob, first.next);
      bits = 256;
      kv('key size', '256 bits (Curve25519)');
      if (k && k.bytes.length !== 32) {
        pw('The key field is ' + k.bytes.length + ' bytes; Ed25519 is always 32.');
      }
      note = 'edwards';
    } else if (/^ecdsa-sha2-/.test(inner)) {
      var curve = readString(blob, first.next);
      var cname = curve ? ascii(curve.bytes) : '?';
      bits = CURVE_BITS[cname] || null;
      kv('curve', cname + (bits ? '  (' + bits + " bits)" : ''));
      if (curve && inner.indexOf(cname) === -1) {
        pw('The curve named inside the blob does not match the type string.');
      }
    } else if (inner === 'ssh-dss') {
      var pp = readString(blob, first.next);
      bits = pp ? mpintBits(pp.bytes) : null;
      kv('key size', (bits || '?') + ' bits (DSA)');
    }

    /* --- fingerprints --- */
    out.line('');
    kv('SHA256', fpSha256(blob));
    kv('MD5', fpMd5(blob));
    p('ssh-keygen -l -f key.pub prints the first. Anything written down before ' +
      'OpenSSH 6.8 will be the second.');

    /* --- comment --- */
    out.line('');
    if (parts.comment) {
      kv('comment', parts.comment);
    } else {
      kv('comment', '(none)', 't-warn');
      p('Not a security problem, but the comment is the only thing that says ' +
        'whose key this is once it is one line among forty in authorized_keys.');
    }

    /* --- authorized_keys options / known_hosts prefix --- */
    if (parts.prefix) {
      out.line('');
      if (/^\|1\|/.test(parts.prefix)) {
        kv('known_hosts', 'hashed host entry');
        p('The host name is hashed (HashKnownHosts yes), so it cannot be read ' +
          'back from here. ssh-keygen -F <host> will tell you if a given host ' +
          'matches.');
      } else if (parts.prefix.indexOf('=') !== -1 || /no-|restrict|cert-authority/.test(parts.prefix)) {
        kv('options', parts.prefix);
        describeOptions(parts.prefix);
      } else {
        kv('host pattern', parts.prefix);
      }
    }

    /* --- the verdict --- */
    out.line('');
    rule();
    verdict(inner, bits, parts);
  }

  function bytesToInt(b) {
    var v = 0;
    for (var i = 0; i < b.length; i++) v = v * 256 + b[i];
    return v;
  }

  function describeOptions(opts) {
    if (/\brestrict\b/.test(opts)) {
      po('restrict — everything off by default, which is the right starting point.');
    }
    if (/command="/.test(opts)) {
      var m = opts.match(/command="([^"]*)"/);
      po('command= forces one command; the client cannot ask for a shell.');
      if (m) p('  ' + m[1]);
      if (!/no-pty|restrict/.test(opts)) {
        pw('command= without no-pty or restrict: a forced command with a terminal ' +
           'can often be escaped from. Add restrict.');
      }
    }
    if (/from="/.test(opts)) {
      po('from= limits which addresses may use this key.');
    }
    if (/\bno-pty\b/.test(opts)) po('no-pty — no terminal allocation.');
    if (/\bno-agent-forwarding\b/.test(opts)) po('no-agent-forwarding.');
    if (/\bno-port-forwarding\b/.test(opts)) po('no-port-forwarding.');
    if (/\bcert-authority\b/.test(opts)) {
      pw('cert-authority — this is not a user key, it is a CA. Every certificate ' +
         'it signs will be accepted. Treat it with far more care than a normal ' +
         'authorized_keys entry.');
    }
    if (/\bpermitopen=/.test(opts)) po('permitopen= restricts forwarding targets.');
  }

  function verdict(type, bits, parts) {
    var problems = 0;

    if (type === 'ssh-dss') {
      pe('DSA. OpenSSH disabled this by default in 7.0 and removed it entirely ' +
         'in 10.0. It is fixed at 1024 bits and depends on per-signature ' +
         'randomness that has failed in the field. Replace it.');
      problems++;
    } else if (type === 'ssh-rsa' && bits) {
      if (bits < 2048) {
        pe('RSA ' + bits + ' bits. Below the 2048-bit minimum OpenSSH enforces. ' +
           'Replace it now.');
        problems++;
      } else if (bits < 3072) {
        pw('RSA ' + bits + ' bits. Accepted everywhere, but 2048 is the floor ' +
           'rather than a recommendation — 3072 or an Ed25519 key is the ' +
           'current advice.');
        problems++;
      } else {
        po('RSA ' + bits + ' bits. Comfortably sized.');
      }
      out.line('');
      p('One thing the key itself cannot tell you: the ssh-rsa SIGNATURE ' +
        'algorithm uses SHA-1 and was disabled by default in OpenSSH 8.8. The ' +
        'same key works fine under rsa-sha2-256 and rsa-sha2-512. If this key ' +
        'stopped working after a server upgrade, that is why, and the fix is ' +
        'on the server rather than a new key.');
    } else if (type === 'ssh-ed25519') {
      po('Ed25519. The current default and the right choice: small, fast, and ' +
         'with no parameters to get wrong.');
    } else if (/^sk-/.test(type)) {
      po('A FIDO/U2F-backed key. The private half lives on a hardware token and ' +
         'cannot be copied off the machine — the strongest option here.');
    } else if (/^ecdsa-sha2-/.test(type)) {
      pw('ECDSA. Sound if the curve is one of the NIST three, but it needs good ' +
         'randomness for every signature and has produced real key-recovery ' +
         'incidents when that failed. Ed25519 avoids the whole class.');
      problems++;
    } else if (/-cert-v01@openssh\.com$/.test(type)) {
      p('This is an OpenSSH certificate rather than a bare key. Its validity ' +
        'window, principals and critical options are inside the blob and are ' +
        'not decoded here — ssh-keygen -L -f will print them.');
    }

    if (!problems) {
      out.line('');
      po('Nothing here needs replacing.');
    }
    out.line('');
    p('What this cannot tell you: whether the matching private key still ' +
      'exists, who holds it, whether it has a passphrase, or which machines ' +
      'trust it. Those are facts about your fleet, not about these bytes.');
  }

  /* ------------------------------------------------------------------
     Run.
     ------------------------------------------------------------------ */

  function run() {
    out.clear();
    COLS = measureCols();

    var raw = (document.getElementById('tool-text') || {}).value || '';
    var text = raw.trim();

    if (!text) {
      out.err('Nothing to read.');
      p('Paste a public key — the contents of a .pub file, a line out of ' +
        'authorized_keys, or a known_hosts entry.');
      return;
    }

    if (refusePrivate(text)) return;

    /* Comments and blank lines are allowed, so an entire authorized_keys file
       can be pasted in one go — which is how anybody actually audits one. */
    var lines = text.split('\n')
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l && l.charAt(0) !== '#'; });

    if (!lines.length) {
      out.err('Only comments and blank lines.');
      return;
    }

    if (lines.length > 50) {
      pw('That is ' + lines.length + ' lines; reading the first 50.');
      lines = lines.slice(0, 50);
    }

    try {
      for (var i = 0; i < lines.length; i++) {
        inspect(lines[i], i + 1, lines.length);
      }
      if (lines.length > 1) {
        out.line('');
        rule();
        kv('keys read', lines.length);
      }
    } catch (e) {
      out.err('Could not finish reading that: ' + e.message);
      p('If the key works with ssh, this is a bug in the tool rather than in ' +
        'your key — the report link below reaches me.');
    }
  }

  LabTool.define({
    id: 'sshkeystool',
    run: run,
    onReady: function () {
      COLS = measureCols();
      p('Paste an SSH public key and press Read.');
      out.line('');
      p('A .pub file, one line of authorized_keys with its options, a ' +
        'known_hosts entry, or a whole authorized_keys file at once.');
      out.line('');
      p('You get both fingerprints — SHA256 as ssh-keygen prints it today, and ' +
        'MD5 as every runbook written before OpenSSH 6.8 records it — plus the ' +
        'key size, and whether the type inside the blob matches the label on ' +
        'the line.');
      out.line('');
      p('Nothing is uploaded. If you paste a PRIVATE key by mistake this stops ' +
        'and tells you what to do about it.');
    }
  });
})();

/* ==========================================================================
   cert-decoder.js — read an X.509 certificate without openssl.
   --------------------------------------------------------------------------
   `openssl x509 -text -noout` is the right answer when you have openssl. The
   times you do not — a locked-down machine, a phone, someone else's laptop —
   are exactly when a certificate turns up in an email and needs reading, and
   the alternative is pasting it into a website.

   A public certificate is not secret, so this is less about privacy than the
   other tools here. But a CSR or a certificate from an internal PKI leaks your
   internal hostnames, and those show up in exactly the same paste box.

   This is a deliberately small DER parser: enough ASN.1 to walk the structure
   RFC 5280 defines, and no more.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ---- minimal DER reader ------------------------------------------------ */
  function parseDer(bytes, start, end) {
    var nodes = [], pos = start;
    while (pos < end) {
      var tag = bytes[pos++];
      if (pos >= end) break;
      var len = bytes[pos++];
      if (len & 0x80) {
        var count = len & 0x7f;
        if (count === 0 || count > 4) break;   // indefinite length is not DER
        // The length bytes themselves have to fit. Without this, bytes[pos++]
        // runs off the end and returns undefined, which poisons len to NaN.
        if (pos + count > end) break;
        len = 0;
        // Multiply rather than `len << 8`. The shift is a SIGNED 32-bit
        // operation, so a four-byte length with the top bit set — 84 FF FF FF FF
        // — comes out NEGATIVE. contentEnd then lands before pos, `pos =
        // contentEnd` rewinds the cursor, and the while loop never terminates:
        // six bytes of input freeze the tab. Multiplication keeps it unsigned,
        // and four bytes max out at 2^32-1, well inside a safe integer.
        for (var i = 0; i < count; i++) len = len * 256 + bytes[pos++];
      }
      var contentStart = pos;
      var contentEnd = contentStart + len;
      // Check BOTH ends. The upper bound alone let a malformed length move the
      // cursor backwards; the cursor must only ever advance.
      if (contentEnd > end || contentEnd < contentStart) break;
      var node = {
        tag: tag, cls: tag & 0xc0, constructed: !!(tag & 0x20), num: tag & 0x1f,
        start: contentStart, end: contentEnd, len: len,
        bytes: bytes.subarray(contentStart, contentEnd)
      };
      if (node.constructed) node.children = parseDer(bytes, contentStart, contentEnd);
      nodes.push(node);
      pos = contentEnd;
    }
    return nodes;
  }

  function oidToString(bytes) {
    if (!bytes.length) return '';
    var parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    var value = 0;
    for (var i = 1; i < bytes.length; i++) {
      value = (value * 128) + (bytes[i] & 0x7f);
      if (!(bytes[i] & 0x80)) { parts.push(value); value = 0; }
    }
    return parts.join('.');
  }

  var OID = {
    '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST',
    '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber',
    '1.2.840.113549.1.9.1': 'emailAddress', '2.5.4.4': 'SN', '2.5.4.42': 'GN',
    '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'EC',
    '1.3.101.112': 'Ed25519',
    '1.2.840.113549.1.1.5': 'SHA-1 with RSA',
    '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
    '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
    '1.2.840.113549.1.1.13': 'SHA-512 with RSA',
    '1.2.840.113549.1.1.10': 'RSASSA-PSS',
    '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
    '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
    '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
    '1.2.840.113549.1.1.4': 'MD5 with RSA',
    '1.2.840.10045.3.1.7': 'P-256 (prime256v1)',
    '1.3.132.0.34': 'P-384 (secp384r1)',
    '1.3.132.0.35': 'P-521 (secp521r1)',
    '2.5.29.17': 'Subject Alternative Name', '2.5.29.19': 'Basic Constraints',
    '2.5.29.15': 'Key Usage', '2.5.29.37': 'Extended Key Usage',
    '2.5.29.14': 'Subject Key Identifier', '2.5.29.35': 'Authority Key Identifier',
    '2.5.29.31': 'CRL Distribution Points', '2.5.29.32': 'Certificate Policies',
    '1.3.6.1.5.5.7.1.1': 'Authority Information Access',
    '1.3.6.1.4.1.11129.2.4.2': 'SCT list (Certificate Transparency)',
    '1.3.6.1.5.5.7.3.1': 'TLS server', '1.3.6.1.5.5.7.3.2': 'TLS client',
    '1.3.6.1.5.5.7.3.3': 'code signing', '1.3.6.1.5.5.7.3.4': 'email protection'
  };

  function text(node) {
    return new TextDecoder().decode(node.bytes).replace(/\0+$/, '');
  }

  function derTime(node) {
    var s = text(node);
    var m = s.match(/^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?$/);
    if (!m) return null;
    var year = m[1].length === 2 ? (Number(m[1]) < 50 ? 2000 + Number(m[1]) : 1900 + Number(m[1]))
                                 : Number(m[1]);
    return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]),
                             Number(m[4]), Number(m[5]), Number(m[6] || 0)));
  }

  function name(node) {
    // RDNSequence: SEQUENCE OF SET OF SEQUENCE { type OID, value ANY }
    var parts = [];
    (node.children || []).forEach(function (rdnSet) {
      (rdnSet.children || []).forEach(function (pair) {
        var kids = pair.children || [];
        if (kids.length < 2) return;
        var key = OID[oidToString(kids[0].bytes)] || oidToString(kids[0].bytes);
        parts.push(key + '=' + text(kids[1]));
      });
    });
    return parts;
  }

  function pemToDer(input) {
    var body = String(input).replace(/-----BEGIN [^-]+-----/g, '')
                            .replace(/-----END [^-]+-----/g, '')
                            .replace(/\s+/g, '');
    if (!body) return null;
    try {
      var bin = atob(body);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) { return null; }
  }

  function findExtensions(tbs) {
    // Extensions are [3] EXPLICIT in the TBSCertificate.
    var ext = (tbs.children || []).filter(function (c) {
      return c.cls === 0x80 && c.num === 3;
    })[0];
    if (!ext || !ext.children || !ext.children[0]) return [];
    return (ext.children[0].children || []).map(function (e) {
      var kids = e.children || [];
      var oid = oidToString(kids[0].bytes);
      var critical = kids.length > 2 || (kids[1] && kids[1].tag === 0x01);
      var valueNode = kids[kids.length - 1];
      return { oid: oid, name: OID[oid] || oid, critical: !!critical, node: valueNode };
    });
  }

  function sans(node) {
    var inner = parseDer(node.bytes, 0, node.bytes.length)[0];
    if (!inner || !inner.children) return [];
    return inner.children.map(function (c) {
      if (c.num === 2) return 'DNS:' + new TextDecoder().decode(c.bytes);
      if (c.num === 7) {
        return 'IP:' + (c.bytes.length === 4 ? Array.from(c.bytes).join('.')
                                             : LabTool.toHex(c.bytes));
      }
      if (c.num === 1) return 'email:' + new TextDecoder().decode(c.bytes);
      if (c.num === 6) return 'URI:' + new TextDecoder().decode(c.bytes);
      return 'other:' + new TextDecoder().decode(c.bytes);
    });
  }

  var KEY_USAGE = ['digitalSignature', 'nonRepudiation', 'keyEncipherment',
    'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign',
    'encipherOnly', 'decipherOnly'];

  /* Maximum TLS certificate lifetime, from the CA/Browser Forum Baseline
     Requirements. Ballot SC-081 replaced the flat 398 days with a schedule
     that steps down on fixed dates: 200 days from 2026-03-15, 100 from
     2027-03-15, 47 from 2029-03-15. A single 398 constant here would be
     wrong from 2026-03-15 onward, so the row is picked by the run date and
     the tool stays correct as each step lands with no edit needed.
     The limit binds at issuance, so an older certificate can legitimately be
     longer than today's row — hence the wording below says what a CA may
     issue today rather than calling the certificate invalid. */
  var LIFETIME_LIMITS = [
    ['2026-03-15T00:00:00Z', 398],
    ['2027-03-15T00:00:00Z', 200],
    ['2029-03-15T00:00:00Z', 100],
    [null, 47]
  ];

  function maxLifetimeDays(now) {
    for (var i = 0; i < LIFETIME_LIMITS.length; i++) {
      var until = LIFETIME_LIMITS[i][0];
      if (until === null || now < Date.parse(until)) return LIFETIME_LIMITS[i][1];
    }
    return LIFETIME_LIMITS[LIFETIME_LIMITS.length - 1][1];
  }

  /* The "you have pasted a private key" trigger.

     The old pattern was BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY — an enumeration
     of three prefixes, which quietly excluded the two headers most likely to be
     genuinely secret. ENCRYPTED PRIVATE KEY (PKCS#8 under a passphrase) reads as
     "already protected", so it is the one people feel safest pasting; it is not
     protected, because the passphrase is offline-crackable the moment the blob
     leaves the machine. PGP PRIVATE KEY BLOCK is somebody's identity key. Both
     used to sail straight past the warning and into the parser.

     So: match the whole family rather than a list of prefixes. Any run of
     uppercase words between BEGIN and PRIVATE KEY qualifies, which covers RSA,
     DSA, EC, OPENSSH, ENCRYPTED, SSH2 ENCRYPTED, PGP (… PRIVATE KEY BLOCK) and
     whatever else turns up next without another edit here. PuTTY's .ppk is not
     a PEM block at all, but it is a private key in a paste box, so its header
     line counts too.

     Nothing in a public certificate contains the words PRIVATE KEY, so this
     cannot fire on the input the tool is actually for. What the warning DOES is
     unchanged — only what reaches it. */
  var PRIVATE_KEY_INPUT = /BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY|PuTTY-User-Key-File-/;

  function run() {
    var input = document.getElementById('tool-text').value;
    out.clear();
    if (!input.trim()) {
      out.warn('Paste a PEM certificate — the block that starts');
      out.warn('-----BEGIN CERTIFICATE-----');
      return;
    }

    if (PRIVATE_KEY_INPUT.test(input)) {
      out.err('That is a PRIVATE KEY, not a certificate.');
      out.err('It has not been parsed and nothing has been sent anywhere — this');
      out.err('page has no network code at all — but treat it as compromised the');
      out.err('moment it is in a clipboard, and rotate it if it was ever pasted');
      out.err('into a site that does have a server.');
      return;
    }

    var der = pemToDer(input);
    if (!der) { out.err('Could not base64-decode that. Paste the whole PEM block.'); return; }

    var root = parseDer(der, 0, der.length)[0];
    if (!root || !root.children || root.children.length < 3) {
      out.err('That does not parse as an X.509 certificate.');
      return;
    }

    var tbs = root.children[0];
    var kids = tbs.children || [];
    var offset = (kids[0] && kids[0].cls === 0x80) ? 1 : 0;   // optional version

    out.heading('Certificate');
    if (offset) {
      var vNode = kids[0].children && kids[0].children[0];
      out.row('version', 'v' + ((vNode ? vNode.bytes[0] : 0) + 1));
    }
    var serial = kids[offset];
    if (serial) out.row('serial', LabTool.toHex(serial.bytes).replace(/^00/, ''));

    var sigAlgNode = kids[offset + 1];
    if (sigAlgNode && sigAlgNode.children && sigAlgNode.children[0]) {
      var sigOid = oidToString(sigAlgNode.children[0].bytes);
      var sigName = OID[sigOid] || sigOid;
      out.row('signature algorithm', sigName,
              /SHA-1|MD5/.test(sigName) ? 't-err' : 't-ok');
      if (/SHA-1|MD5/.test(sigName)) {
        out.line('    → both are broken for signatures and rejected by every', 't-err');
        out.line('      current browser', 't-err');
      }
    }

    out.rule();
    out.heading('Issuer');
    name(kids[offset + 2] || {}).forEach(function (p) { out.line('  ' + p); });

    out.rule();
    out.heading('Subject');
    var subjectParts = name(kids[offset + 4] || {});
    subjectParts.forEach(function (p) { out.line('  ' + p); });
    var issuerParts = name(kids[offset + 2] || {});
    if (issuerParts.join('|') === subjectParts.join('|')) {
      out.line('');
      out.warn('Issuer and subject are identical — this is self-signed. Fine for');
      out.warn('internal use if the CA is trusted deliberately; a browser will');
      out.warn('reject it on the public internet.');
    }

    out.rule();
    out.heading('Validity');
    var validity = kids[offset + 3];
    if (validity && validity.children && validity.children.length >= 2) {
      var from = derTime(validity.children[0]);
      var to = derTime(validity.children[1]);
      var now = Date.now();
      out.row('not before', from ? from.toISOString() : '?',
              from && from.getTime() > now ? 't-err' : null);
      out.row('not after', to ? to.toISOString() : '?',
              to && to.getTime() < now ? 't-err' : null);
      if (from && to) {
        var days = Math.round((to - from) / 86400000);
        var maxDays = maxLifetimeDays(now);
        out.row('lifetime', days + ' days', days > maxDays ? 't-warn' : null);
        if (days > maxDays) {
          out.line('    → longer than the ' + maxDays + ' days a public CA is allowed', 't-warn');
          out.line('      to issue today; browsers reject anything over the limit', 't-warn');
          out.line('      that was in force when it was issued', 't-warn');
        }
        if (to.getTime() < now) {
          out.line('');
          out.err('EXPIRED — ' + Math.round((now - to) / 86400000) + ' days ago.');
        } else if (from.getTime() > now) {
          out.line('');
          out.err('NOT YET VALID.');
        } else {
          var left = Math.round((to - now) / 86400000);
          out.line('');
          if (left < 30) out.warn('Expires in ' + left + ' days.');
          else out.ok('Valid — ' + left + ' days remaining.');
        }
      }
    }

    // ---- public key ----
    var spki = kids[offset + 5];
    if (spki && spki.children) {
      out.rule();
      out.heading('Public key');
      var algNode = spki.children[0];
      var algOid = algNode && algNode.children && algNode.children[0]
        ? oidToString(algNode.children[0].bytes) : '';
      out.row('algorithm', OID[algOid] || algOid || 'unknown');
      if (algNode && algNode.children && algNode.children[1]) {
        var curve = oidToString(algNode.children[1].bytes);
        if (OID[curve]) out.row('curve', OID[curve]);
      }
      var bitstring = spki.children[1];
      if (bitstring && OID[algOid] === 'RSA') {
        var inner = parseDer(bitstring.bytes, 1, bitstring.bytes.length)[0];
        if (inner && inner.children && inner.children[0]) {
          var modulus = inner.children[0].bytes;
          var bits = (modulus[0] === 0 ? modulus.length - 1 : modulus.length) * 8;
          out.row('key size', bits + ' bits', bits < 2048 ? 't-err' : 't-ok');
          if (bits < 2048) {
            out.line('    → below 2048 bits; considered inadequate since 2013', 't-err');
          }
        }
      }
    }

    // ---- extensions ----
    var exts = findExtensions(tbs);
    if (exts.length) {
      out.rule();
      out.heading('Extensions (' + exts.length + ')');
      exts.forEach(function (e) {
        out.row(e.name, e.critical ? 'critical' : '', e.critical ? 't-info' : 't-dim');
        if (e.oid === '2.5.29.17') {
          sans(e.node).forEach(function (s) { out.line('    ' + s); });
        }
        if (e.oid === '2.5.29.19') {
          var bc = parseDer(e.node.bytes, 0, e.node.bytes.length)[0];
          var isCa = bc && bc.children && bc.children[0] && bc.children[0].tag === 0x01
                     && bc.children[0].bytes[0] !== 0;
          out.line('    CA: ' + (isCa ? 'TRUE — this can sign other certificates' : 'FALSE'),
                   isCa ? 't-warn' : 't-dim');
        }
        if (e.oid === '2.5.29.15') {
          var ku = parseDer(e.node.bytes, 0, e.node.bytes.length)[0];
          if (ku && ku.bytes.length > 1) {
            var unused = ku.bytes[0];
            var used = [];
            for (var bit = 0; bit < (ku.bytes.length - 1) * 8 - unused; bit++) {
              var byte = ku.bytes[1 + (bit >> 3)];
              if (byte & (0x80 >> (bit % 8))) used.push(KEY_USAGE[bit] || ('bit' + bit));
            }
            out.line('    ' + used.join(', '));
          }
        }
        if (e.oid === '2.5.29.37') {
          var eku = parseDer(e.node.bytes, 0, e.node.bytes.length)[0];
          if (eku && eku.children) {
            out.line('    ' + eku.children.map(function (c) {
              var o = oidToString(c.bytes);
              return OID[o] || o;
            }).join(', '));
          }
        }
      });
    }

    out.rule();
    out.heading('Fingerprints');
    crypto.subtle.digest('SHA-256', der).then(function (h) {
      out.row('SHA-256', LabTool.toHex(new Uint8Array(h)).replace(/(..)(?=.)/g, '$1:'));
    });
    crypto.subtle.digest('SHA-1', der).then(function (h) {
      out.row('SHA-1', LabTool.toHex(new Uint8Array(h)).replace(/(..)(?=.)/g, '$1:'));
      out.line('');
      out.dim('Fingerprints identify this exact certificate. They are what you');
      out.dim('compare when pinning, or when checking that the certificate your');
      out.dim('browser was served is the one you expected.');
      out.line('');
      out.dim('Nothing here checked the chain or revocation — both need network');
      out.dim('lookups, which this page does not do. This reads what is inside');
      out.dim('the certificate, not whether anyone still trusts it.');
    });
  }

  LabTool.define({
    id: 'certdecodertool',
    run: run,
    onReady: function () {
      out.dim('Paste a PEM certificate — the -----BEGIN CERTIFICATE----- block.');
      out.dim('');
      out.dim('To get one from a live site:');
      out.dim('  openssl s_client -connect example.com:443 </dev/null \\');
      out.dim('    | openssl x509 -outform PEM');
      out.dim('or export it from the padlock icon in your browser.');
    }
  });
})();

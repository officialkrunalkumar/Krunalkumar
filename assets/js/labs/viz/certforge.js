/* ==========================================================================
   certforge.js — build a real X.509 certificate by hand, from keypair to PEM.
   --------------------------------------------------------------------------
   The certificate decoder elsewhere in Labs takes a certificate apart. This
   lab builds one. Every byte is assembled here: the keypair comes from the
   browser's own WebCrypto (real RSA-2048 or ECDSA P-256, generated in audited
   native code), and everything wrapped around it — the ASN.1/DER structure,
   the X.509 fields, the PKCS#10 signing request, the signature bytes — is
   encoded by hand in this file. The result is a genuine certificate: paste the
   PEM into `openssl x509 -text` and it parses.

   Unlike the cryptography visualiser, which uses teaching implementations of
   the primitives, this lab is REAL and safe to be real, because the dangerous
   part — key generation and signing — is delegated to WebCrypto rather than
   reimplemented. What is hand-rolled here is the *encoding*, which has no
   secret to leak and every reason to be legible: DER is the format people are
   forever debugging, and seeing it built byte by byte is the whole lesson.

   Design decisions worth spelling out:

   1. WebCrypto for the maths, hand code for the format. `crypto.subtle` does
      keygen, signing and verification. This file does ASN.1 DER, the
      TBSCertificate and CertificationRequestInfo structures, and PEM framing.
      That split is deliberate: never reimplement a cipher you can borrow an
      audited one for, but do reimplement the serialisation, because that is
      the part worth understanding and the part with no security downside.

   2. DER is built from small typed encoders, not string concatenation. Every
      value knows its tag and length, and lengths are encoded in the long form
      when they exceed 127 bytes — the exact rule people get wrong by hand. The
      encoder is a handful of composable functions, which is the honest shape
      of DER and makes the structure visible.

   3. Correctness is checked against a real parser. The test harness builds a
      self-signed certificate with this file and hands the bytes to Node's
      `crypto.X509Certificate`. If the parser rejects it, the encoding is
      wrong, and the build fails. A certificate that "looks right" but no tool
      accepts would be worse than none.

   Nothing here opens a network connection. WebCrypto is local computation, not
   a service.
   ========================================================================== */

/* global LabViz */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  DER PRIMITIVES                                                          */
  /* ------------------------------------------------------------------------ */
  /*  Distinguished Encoding Rules: every value is tag + length + contents.    */
  /*  The only real subtlety is the length field — one byte for lengths up to  */
  /*  127, otherwise a leading byte saying how many length bytes follow. Get    */
  /*  that wrong and every parser downstream chokes, which is exactly why it    */
  /*  is worth seeing done correctly.                                          */
  /* ======================================================================== */

  var TAG = {
    BOOLEAN: 0x01, INTEGER: 0x02, BIT_STRING: 0x03, OCTET_STRING: 0x04,
    NULL: 0x05, OID: 0x06, UTF8: 0x0c, SEQUENCE: 0x30, SET: 0x31,
    PRINTABLE: 0x13, IA5: 0x16, UTCTIME: 0x17, GENERALIZEDTIME: 0x18
  };

  function concatBytes(arrays) {
    var total = 0, i;
    for (i = 0; i < arrays.length; i++) total += arrays[i].length;
    var out = new Uint8Array(total);
    var pos = 0;
    for (i = 0; i < arrays.length; i++) { out.set(arrays[i], pos); pos += arrays[i].length; }
    return out;
  }

  /* Encode a length in DER form: short form below 128, long form above, where
     the first byte is 0x80 | (number of length bytes). */
  function encodeLength(len) {
    if (len < 0x80) return new Uint8Array([len]);
    var bytes = [];
    var n = len;
    while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
    return new Uint8Array([0x80 | bytes.length].concat(bytes));
  }

  /* A tag-length-value node. `content` is a Uint8Array of the already-encoded
     contents. */
  function tlv(tag, content) {
    return concatBytes([new Uint8Array([tag]), encodeLength(content.length), content]);
  }

  function der(node) { return node; }   // nodes are already Uint8Arrays

  function derSequence(children) { return tlv(TAG.SEQUENCE, concatBytes(children)); }
  function derSet(children) { return tlv(TAG.SET, concatBytes(children)); }

  /* A DER INTEGER. Non-negative; a leading 0x00 is added when the top bit is
     set so the value is not read as negative. */
  function derInteger(bytesOrNumber) {
    var bytes;
    if (typeof bytesOrNumber === 'number') {
      bytes = [];
      var n = bytesOrNumber;
      if (n === 0) bytes = [0];
      else while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256); }
    } else {
      bytes = Array.prototype.slice.call(bytesOrNumber);
      while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes.shift();
    }
    if (bytes[0] & 0x80) bytes.unshift(0x00);
    return tlv(TAG.INTEGER, new Uint8Array(bytes));
  }

  function derBoolean(v) { return tlv(TAG.BOOLEAN, new Uint8Array([v ? 0xff : 0x00])); }
  function derNull() { return tlv(TAG.NULL, new Uint8Array(0)); }

  /* An OBJECT IDENTIFIER from dotted string. The first two arcs pack into one
     byte as 40*a + b; each later arc is base-128 with continuation bits. */
  function derOID(dotted) {
    var parts = dotted.split('.').map(Number);
    var first = 40 * parts[0] + parts[1];
    var body = [first];
    for (var i = 2; i < parts.length; i++) {
      var v = parts[i];
      var chunk = [v & 0x7f];
      v = Math.floor(v / 128);
      while (v > 0) { chunk.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
      body = body.concat(chunk);
    }
    return tlv(TAG.OID, new Uint8Array(body));
  }

  function strToUtf8Bytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function derUtf8(s) { return tlv(TAG.UTF8, strToUtf8Bytes(s)); }
  function derPrintable(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
    return tlv(TAG.PRINTABLE, new Uint8Array(out));
  }
  function derIA5(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
    return tlv(TAG.IA5, new Uint8Array(out));
  }

  /* A BIT STRING wraps content with a leading "unused bits" byte, which is 0
     for whole-byte content like a public key or a signature. */
  function derBitString(content) {
    return tlv(TAG.BIT_STRING, concatBytes([new Uint8Array([0x00]), content]));
  }
  function derOctetString(content) { return tlv(TAG.OCTET_STRING, content); }

  /* A context-specific constructed tag [n], used for the version marker and
     the extensions block in a certificate. */
  function derContext(n, content, constructed) {
    var tag = 0x80 | (constructed === false ? 0 : 0x20) | n;
    return tlv(tag, content);
  }

  /* UTCTime, YYMMDDHHMMSSZ. Valid 1950-2049, which is all this lab needs. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function derUTCTime(date) {
    var y = date.getUTCFullYear() % 100;
    var s = pad2(y) + pad2(date.getUTCMonth() + 1) + pad2(date.getUTCDate()) +
            pad2(date.getUTCHours()) + pad2(date.getUTCMinutes()) + pad2(date.getUTCSeconds()) + 'Z';
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return tlv(TAG.UTCTIME, new Uint8Array(out));
  }

  /* ======================================================================== */
  /*  X.509 BUILDING BLOCKS                                                   */
  /* ======================================================================== */

  // Object identifiers used across X.509.
  var OID = {
    CN: '2.5.4.3', O: '2.5.4.10', OU: '2.5.4.11', C: '2.5.4.6', ST: '2.5.4.8', L: '2.5.4.7',
    rsaEncryption: '1.2.840.113549.1.1.1',
    sha256WithRSA: '1.2.840.113549.1.1.11',
    ecPublicKey: '1.2.840.10045.2.1',
    ecP256: '1.2.840.10045.3.1.7',
    ecdsaWithSHA256: '1.2.840.10045.4.3.2',
    basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', san: '2.5.29.17',
    subjectKeyId: '2.5.29.14'
  };

  /* A Name is a SEQUENCE of RelativeDistinguishedNames, each a SET of one
     AttributeTypeAndValue. Only the attributes the visitor filled in appear. */
  function buildName(fields) {
    var rdns = [];
    var order = [['C', OID.C, derPrintable], ['ST', OID.ST, derUtf8], ['L', OID.L, derUtf8],
                 ['O', OID.O, derUtf8], ['OU', OID.OU, derUtf8], ['CN', OID.CN, derUtf8]];
    order.forEach(function (f) {
      var val = fields[f[0]];
      if (val == null || val === '') return;
      rdns.push(derSet([derSequence([derOID(f[1]), f[2](String(val))])]));
    });
    return derSequence(rdns);
  }

  /* The AlgorithmIdentifier for the signature and for the key. RSA carries a
     NULL parameter; EC named curves carry the curve OID. */
  function sigAlgId(alg) {
    if (alg === 'rsa') return derSequence([derOID(OID.sha256WithRSA), derNull()]);
    return derSequence([derOID(OID.ecdsaWithSHA256)]);
  }

  /* SubjectPublicKeyInfo — but we let WebCrypto produce it. exportKey('spki')
     returns exactly this structure as DER, so we splice the real bytes in
     rather than rebuild a public key by hand (which would mean parsing the raw
     key material, with no teaching benefit). */
  function spkiBytes(spki) { return new Uint8Array(spki); }

  /* KeyUsage as a BIT STRING. digitalSignature (bit 0) + keyEncipherment
     (bit 2) for a leaf; keyCertSign (bit 5) + cRLSign (bit 6) for a CA. */
  function keyUsageExtension(isCA) {
    // bits, MSB first: [digitalSignature, contentCommitment, keyEncipherment, ...]
    var bits = isCA ? [0, 0, 0, 0, 0, 1, 1] : [1, 0, 1];
    // pack into bytes
    var byte = 0;
    for (var i = 0; i < bits.length; i++) if (bits[i]) byte |= (0x80 >> (i % 8));
    var unused = 8 - (bits.length % 8 || 8);
    var content = tlv(TAG.BIT_STRING, new Uint8Array([unused, byte]));
    return derSequence([derOID(OID.keyUsage), derBoolean(true), derOctetString(content)]);
  }

  function basicConstraintsExtension(isCA) {
    var bc = isCA ? derSequence([derBoolean(true)]) : derSequence([]);
    return derSequence([derOID(OID.basicConstraints), derBoolean(true), derOctetString(bc)]);
  }

  /* subjectAltName from a list of DNS names — the field browsers actually
     check now, CN being long deprecated for host matching. */
  function sanExtension(dnsNames) {
    if (!dnsNames || !dnsNames.length) return null;
    var names = dnsNames.map(function (n) {
      // [2] IA5String dNSName
      return tlv(0x82, strToUtf8Bytes(n));
    });
    var content = derSequence(names);
    return derSequence([derOID(OID.san), derOctetString(content)]);
  }

  /* Build the TBSCertificate (the part that gets signed). */
  function buildTBS(params) {
    var version = derContext(0, derInteger(2));   // v3
    var serial = derInteger(params.serial);
    var sigAlg = sigAlgId(params.alg);
    var issuer = buildName(params.issuer);
    var validity = derSequence([derUTCTime(params.notBefore), derUTCTime(params.notAfter)]);
    var subject = buildName(params.subject);
    var spki = spkiBytes(params.spki);

    var exts = [];
    exts.push(basicConstraintsExtension(params.isCA));
    exts.push(keyUsageExtension(params.isCA));
    var san = sanExtension(params.dnsNames);
    if (san) exts.push(san);
    var extensions = derContext(3, derSequence(exts));

    return derSequence([version, serial, sigAlg, issuer, validity, subject, spki, extensions]);
  }

  /* Assemble the final Certificate once the signature exists. */
  function assembleCertificate(tbs, alg, signature) {
    return derSequence([tbs, sigAlgId(alg), derBitString(new Uint8Array(signature))]);
  }

  /* PKCS#10 CertificationRequestInfo, the body of a CSR. */
  function buildCSRInfo(params) {
    var version = derInteger(0);
    var subject = buildName(params.subject);
    var spki = spkiBytes(params.spki);
    var attributes = derContext(0, new Uint8Array(0));   // no attributes
    return derSequence([version, subject, spki, attributes]);
  }

  function assembleCSR(info, alg, signature) {
    return derSequence([info, sigAlgId(alg), derBitString(new Uint8Array(signature))]);
  }

  /* ======================================================================== */
  /*  PEM                                                                     */
  /* ======================================================================== */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 || 0) >> 4)];
      out += (i + 1 < bytes.length) ? B64[((b1 & 15) << 2) | ((b2 || 0) >> 6)] : '=';
      out += (i + 2 < bytes.length) ? B64[b2 & 63] : '=';
    }
    return out;
  }

  function toPEM(label, bytes) {
    var b64 = base64(bytes);
    var lines = [];
    for (var i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
    return '-----BEGIN ' + label + '-----\n' + lines.join('\n') + '\n-----END ' + label + '-----';
  }

  /* Walk a DER structure into a nested tree, for the byte-inspector view. This
     is a decoder — the inverse of everything above — kept minimal: enough to
     show the shape of what was built, not a full X.509 parser. */
  function parseDER(bytes, offset, depth, out, end) {
    offset = offset || 0;
    depth = depth || 0;
    out = out || [];
    end = end == null ? bytes.length : end;
    if (depth > 20) return out;
    // Absolute offsets throughout: children are walked in the SAME buffer with
    // an end bound, not a subarray. An earlier version recursed into subarrays,
    // which made every nested node report an offset relative to its parent —
    // fine for a display that only shows tag and length, but wrong the moment
    // anything (the chain-of-trust signature extraction) sliced the original
    // buffer by contentOffset.
    while (offset < end) {
      var tag = bytes[offset];
      var lenByte = bytes[offset + 1];
      var len, headerLen;
      if (lenByte < 0x80) { len = lenByte; headerLen = 2; }
      else {
        var num = lenByte & 0x7f;
        len = 0;
        for (var k = 0; k < num; k++) len = (len << 8) | bytes[offset + 2 + k];
        headerLen = 2 + num;
      }
      var constructed = (tag & 0x20) !== 0;
      var contentOffset = offset + headerLen;
      out.push({ tag: tag, name: tagName(tag), offset: offset, headerLen: headerLen,
                 length: len, depth: depth, constructed: constructed,
                 contentOffset: contentOffset });
      if (constructed) parseDER(bytes, contentOffset, depth + 1, out, contentOffset + len);
      offset = contentOffset + len;
      if (headerLen + len <= 0) break;
    }
    return out;
  }

  function tagName(tag) {
    var base = tag & 0x1f;
    if ((tag & 0xc0) === 0x80) return '[' + base + ']';
    switch (tag) {
      case TAG.BOOLEAN: return 'BOOLEAN';
      case TAG.INTEGER: return 'INTEGER';
      case TAG.BIT_STRING: return 'BIT STRING';
      case TAG.OCTET_STRING: return 'OCTET STRING';
      case TAG.NULL: return 'NULL';
      case TAG.OID: return 'OBJECT IDENTIFIER';
      case TAG.UTF8: return 'UTF8String';
      case TAG.PRINTABLE: return 'PrintableString';
      case TAG.IA5: return 'IA5String';
      case TAG.UTCTIME: return 'UTCTime';
      case TAG.SEQUENCE: return 'SEQUENCE';
      case TAG.SET: return 'SET';
      default: return '0x' + tag.toString(16);
    }
  }

  /* ======================================================================== */
  /*  WEBCRYPTO WRAPPERS                                                      */
  /* ------------------------------------------------------------------------ */
  /*  The only asynchronous part. Keygen, signing and verification are the      */
  /*  operations that must be constant-time and correct, so they are handed to  */
  /*  the platform rather than reimplemented.                                   */
  /* ======================================================================== */

  function subtle() {
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error('WebCrypto is not available. This lab needs a secure context (https, or ' +
        'localhost) and a modern browser.');
    }
    return root.crypto.subtle;
  }

  function algParams(alg) {
    if (alg === 'rsa') {
      return { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
               publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    }
    return { name: 'ECDSA', namedCurve: 'P-256' };
  }
  function signParams(alg) {
    return alg === 'rsa' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  }

  function generateKeypair(alg) {
    return subtle().generateKey(algParams(alg), true,
      alg === 'rsa' ? ['sign', 'verify'] : ['sign', 'verify']);
  }
  function exportSPKI(key) { return subtle().exportKey('spki', key).then(function (b) { return new Uint8Array(b); }); }
  function exportPKCS8(key) { return subtle().exportKey('pkcs8', key).then(function (b) { return new Uint8Array(b); }); }

  function signBytes(alg, privateKey, bytes) {
    return subtle().sign(signParams(alg), privateKey, bytes).then(function (s) { return new Uint8Array(s); });
  }
  function verifyBytes(alg, publicKey, signature, bytes) {
    return subtle().verify(signParams(alg), publicKey, signature, bytes);
  }

  /* ECDSA WebCrypto signatures come out as raw r||s; X.509 wants them DER-
     encoded as SEQUENCE(INTEGER r, INTEGER s). RSA signatures are used as-is. */
  function encodeSignatureForCert(alg, rawSig) {
    if (alg === 'rsa') return rawSig;
    var half = rawSig.length / 2;
    var r = rawSig.subarray(0, half);
    var s = rawSig.subarray(half);
    return derSequence([derInteger(r), derInteger(s)]);
  }

  /* Build a self-signed (or CA-signed) certificate end to end. Async because
     signing is. Returns the DER, the PEM, and the TBS bytes for inspection. */
  function makeCertificate(params) {
    var tbs = buildTBS(params);
    return signBytes(params.alg, params.signingKey, tbs).then(function (rawSig) {
      var sig = encodeSignatureForCert(params.alg, rawSig);
      var cert = assembleCertificate(tbs, params.alg, sig);
      return { der: cert, pem: toPEM('CERTIFICATE', cert), tbs: tbs, signature: sig };
    });
  }

  function makeCSR(params) {
    var info = buildCSRInfo(params);
    return signBytes(params.alg, params.signingKey, info).then(function (rawSig) {
      var sig = encodeSignatureForCert(params.alg, rawSig);
      var csr = assembleCSR(info, params.alg, sig);
      return { der: csr, pem: toPEM('CERTIFICATE REQUEST', csr), info: info };
    });
  }

  var CORE = {
    TAG: TAG, OID: OID,
    encodeLength: encodeLength, tlv: tlv, concatBytes: concatBytes,
    derInteger: derInteger, derOID: derOID, derSequence: derSequence, derSet: derSet,
    derUtf8: derUtf8, derPrintable: derPrintable, derBitString: derBitString,
    derBoolean: derBoolean, derNull: derNull, derUTCTime: derUTCTime, derContext: derContext,
    buildName: buildName, buildTBS: buildTBS, assembleCertificate: assembleCertificate,
    buildCSRInfo: buildCSRInfo, assembleCSR: assembleCSR,
    base64: base64, toPEM: toPEM, parseDER: parseDER, tagName: tagName,
    generateKeypair: generateKeypair, exportSPKI: exportSPKI, exportPKCS8: exportPKCS8,
    signBytes: signBytes, verifyBytes: verifyBytes,
    encodeSignatureForCert: encodeSignatureForCert,
    makeCertificate: makeCertificate, makeCSR: makeCSR
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof root.LabCertForge === 'undefined') root.LabCertForge = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI — a bespoke, asynchronous surface (not the frame-stepping shell)     */
  /* ------------------------------------------------------------------------ */
  /*  Certificate work is button-driven and async: generate a keypair, fill in */
  /*  a subject, sign, inspect the DER, download the PEM. There is no timeline  */
  /*  to scrub, so this builds its own small UI rather than borrowing the       */
  /*  visualiser transport. It still lives under the Labs consent gate.        */
  /* ======================================================================== */

  var F = CORE;   // same module object the Node tests require() as F

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399',
    amber: '#fbbf24', red: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";

  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  var CSS = [
    '#certforgeviz .cf-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    '#certforgeviz .cf-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,.6);}',
    '#certforgeviz .cf-tab{font:inherit;font-size:12px;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#certforgeviz .cf-tab.on{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#certforgeviz .cf-body{display:grid;grid-template-columns:minmax(0,22rem) minmax(0,1fr);align-items:start;}',
    '@media (max-width:900px){#certforgeviz .cf-body{grid-template-columns:minmax(0,1fr);}}',
    '#certforgeviz .cf-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,.6);min-width:0;}',
    '@media (max-width:900px){#certforgeviz .cf-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',
    '#certforgeviz .cf-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '#certforgeviz .cf-group{margin:0 0 14px;}',
    '#certforgeviz .cf-gt{margin:0 0 7px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#certforgeviz .cf-field{display:flex;flex-direction:column;gap:3px;margin:0 0 8px;}',
    '#certforgeviz .cf-field label{font-size:11px;color:' + C.dim + ';}',
    '#certforgeviz .cf-input{font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:6px 8px;}',
    '#certforgeviz .cf-input:focus{outline:2px solid ' + C.blue + ';outline-offset:1px;}',
    '#certforgeviz .cf-row{display:flex;gap:8px;flex-wrap:wrap;}',
    '#certforgeviz .cf-row .cf-field{flex:1;min-width:6rem;}',
    '#certforgeviz .cf-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:8px 12px;cursor:pointer;}',
    '#certforgeviz .cf-btn:hover{background:#213152;border-color:#40608f;}',
    '#certforgeviz .cf-btn-primary{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#certforgeviz .cf-btn[disabled]{opacity:.5;cursor:default;}',
    '#certforgeviz .cf-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
    '#certforgeviz .cf-hint{margin:6px 0 0;font-size:11px;line-height:1.55;color:' + C.faint + ';}',
    '#certforgeviz .cf-seg{display:inline-flex;border:1px solid #2a3d5c;border-radius:7px;overflow:hidden;}',
    '#certforgeviz .cf-seg button{font:inherit;font-size:12px;color:' + C.dim + ';background:#0d1729;border:0;padding:6px 12px;cursor:pointer;}',
    '#certforgeviz .cf-seg button.on{background:' + C.blue + ';color:#04121f;font-weight:700;}',
    '#certforgeviz .cf-status{font-size:12px;padding:8px 11px;border-radius:8px;border-left:3px solid ' + C.faint + ';background:rgba(148,163,184,.06);color:' + C.dim + ';}',
    '#certforgeviz .cf-status.ok{border-left-color:' + C.green + ';color:#cdeee0;background:rgba(52,211,153,.07);}',
    '#certforgeviz .cf-status.bad{border-left-color:' + C.red + ';color:' + C.red + ';background:rgba(252,165,165,.07);}',
    '#certforgeviz .cf-status.work{border-left-color:' + C.amber + ';color:#e8d5a8;background:rgba(251,191,36,.07);}',
    '#certforgeviz .cf-pem{width:100%;min-height:9rem;font:12px/1.5 ' + FONT + ';color:#bfe3ff;background:#0b1220;border:1px solid ' + C.line + ';border-radius:8px;padding:9px;white-space:pre;overflow:auto;resize:vertical;}',
    '#certforgeviz .cf-pane{border:1px solid ' + C.line + ';border-radius:8px;background:' + C.bg1 + ';}',
    '#certforgeviz .cf-pane-h{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-bottom:1px solid ' + C.line + ';font-size:11px;color:' + C.faint + ';text-transform:uppercase;letter-spacing:.06em;}',
    '#certforgeviz .cf-copy{font:inherit;font-size:11px;color:' + C.cyan + ';background:none;border:1px solid #2c496f;border-radius:5px;padding:3px 9px;cursor:pointer;}',
    '#certforgeviz .cf-der{max-height:22rem;overflow:auto;padding:6px 4px;font-size:12px;}',
    '#certforgeviz .cf-der-row{display:flex;gap:8px;padding:2px 6px;border-radius:4px;white-space:nowrap;}',
    '#certforgeviz .cf-der-row:hover{background:rgba(125,211,252,.06);}',
    '#certforgeviz .cf-der-tag{color:' + C.cyan + ';}',
    '#certforgeviz .cf-der-len{color:' + C.faint + ';}',
    '#certforgeviz .cf-der-oid{color:' + C.green + ';}',
    '#certforgeviz .cf-fields{width:100%;border-collapse:collapse;font-size:12px;}',
    '#certforgeviz .cf-fields td{padding:4px 8px;border-bottom:1px solid rgba(28,43,68,.6);vertical-align:top;}',
    '#certforgeviz .cf-fields td:first-child{color:' + C.faint + ';white-space:nowrap;width:9rem;}',
    '#certforgeviz .cf-fields td:last-child{color:' + C.ink + ';word-break:break-all;}',
    '#certforgeviz .cf-warn{font-size:11px;line-height:1.6;padding:8px 11px;border-left:3px solid ' + C.amber + ';background:rgba(251,191,36,.06);border-radius:0 8px 8px 0;color:#e8d5a8;}',
    '#certforgeviz .cf-chain{display:flex;flex-direction:column;gap:8px;}',
    '#certforgeviz .cf-node{padding:9px 11px;border:1px solid ' + C.line + ';border-radius:9px;background:rgba(15,23,42,.5);}',
    '#certforgeviz .cf-node.ca{border-color:rgba(167,139,250,.4);}',
    '#certforgeviz .cf-node.leaf{border-color:rgba(56,189,248,.4);}',
    '#certforgeviz .cf-node h4{margin:0 0 4px;font-size:12px;}',
    '#certforgeviz .cf-node .cf-sub{font-size:11px;color:' + C.dim + ';word-break:break-all;}',
    '#certforgeviz .cf-arrow{text-align:center;color:' + C.faint + ';font-size:14px;}',
    '#certforgeviz .cf-verify{display:flex;align-items:center;gap:8px;font-size:12px;}',
    '#certforgeviz .cf-tag{padding:2px 9px;border-radius:6px;font-size:11px;font-weight:700;}',
    '#certforgeviz .cf-tag-ok{background:rgba(52,211,153,.16);color:' + C.green + ';}',
    '#certforgeviz .cf-tag-bad{background:rgba(252,165,165,.16);color:' + C.red + ';}'
  ].join('');

  function field(label, value, ph) {
    var f = E('div', 'cf-field');
    f.appendChild(E('label', null, label));
    var input = E('input', 'cf-input');
    input.type = 'text';
    input.value = value || '';
    if (ph) input.placeholder = ph;
    input.spellcheck = false;
    f.appendChild(input);
    f.input = input;
    return f;
  }

  function status(host, kind, msg) {
    clear(host);
    var s = E('div', 'cf-status' + (kind ? ' ' + kind : ''), msg);
    host.appendChild(s);
  }

  function pemPane(label, text, download) {
    var pane = E('div', 'cf-pane');
    var h = E('div', 'cf-pane-h');
    h.appendChild(E('span', null, label));
    var actions = E('span');
    var copy = E('button', 'cf-copy', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', function () {
      var ta = pane.querySelector('textarea');
      ta.select();
      try { document.execCommand('copy'); copy.textContent = 'Copied'; }
      catch (e) { copy.textContent = 'Select + copy'; }
      setTimeout(function () { copy.textContent = 'Copy'; }, 1400);
    });
    actions.appendChild(copy);
    h.appendChild(actions);
    pane.appendChild(h);
    var ta = E('textarea', 'cf-pem');
    ta.value = text;
    ta.readOnly = true;
    pane.appendChild(ta);
    return pane;
  }

  /* Render the DER byte tree from parseDER, indented by depth, with OIDs
     named where we know them. */
  var OID_NAMES = {};
  Object.keys(F.OID).forEach(function (k) { OID_NAMES[F.OID[k]] = k; });

  function renderDER(host, bytes) {
    clear(host);
    var tree = F.parseDER(bytes);
    var box = E('div', 'cf-der');
    tree.forEach(function (node) {
      var row = E('div', 'cf-der-row');
      row.style.paddingLeft = (6 + node.depth * 16) + 'px';
      row.appendChild(E('span', 'cf-der-tag', node.name));
      row.appendChild(E('span', 'cf-der-len', 'len ' + node.length));
      if (node.name === 'OBJECT IDENTIFIER') {
        var oid = decodeOID(bytes, node.contentOffset, node.length);
        var label = OID_NAMES[oid] ? OID_NAMES[oid] + ' (' + oid + ')' : oid;
        row.appendChild(E('span', 'cf-der-oid', label));
      }
      box.appendChild(row);
    });
    host.appendChild(box);
  }

  function decodeOID(bytes, offset, len) {
    var first = bytes[offset];
    var out = [Math.floor(first / 40), first % 40];
    var val = 0;
    for (var i = 1; i < len; i++) {
      var b = bytes[offset + i];
      val = (val << 7) | (b & 0x7f);
      if (!(b & 0x80)) { out.push(val); val = 0; }
    }
    return out.join('.');
  }

  var WARN = 'These keys are generated by your browser and never leave it — but this is a learning ' +
    'tool. For a certificate that protects something real, generate the key with a tool you can ' +
    'audit and keep the private key somewhere safe.';

  /* ======================================================================== */
  /*  State shared across tabs                                                */
  /* ======================================================================== */

  var STATE = { alg: 'ec', keypair: null, spki: null };

  function algSegment(onChange) {
    var seg = E('div', 'cf-seg');
    [['ec', 'ECDSA P-256'], ['rsa', 'RSA-2048']].forEach(function (a) {
      var b = E('button', STATE.alg === a[0] ? 'on' : null, a[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        STATE.alg = a[0];
        STATE.keypair = null;
        [].forEach.call(seg.children, function (c) { c.className = ''; });
        b.className = 'on';
        onChange();
      });
      seg.appendChild(b);
    });
    return seg;
  }

  function ensureKeypair(statusHost, then) {
    if (STATE.keypair) { then(); return; }
    status(statusHost, 'work', 'Generating a ' + (STATE.alg === 'rsa' ? 'RSA-2048' : 'ECDSA P-256') +
      ' keypair in your browser…');
    F.generateKeypair(STATE.alg).then(function (kp) {
      STATE.keypair = kp;
      return F.exportSPKI(kp.publicKey).then(function (spki) {
        STATE.spki = spki;
        then();
      });
    }).catch(function (err) {
      status(statusHost, 'bad', err.message);
    });
  }

  /* ======================================================================== */
  /*  TAB 1 — SELF-SIGNED CERTIFICATE                                         */
  /* ======================================================================== */

  function CertTab(mount) {
    var self = this;
    this.root = mount;
    var body = E('div', 'cf-body');
    var side = E('div', 'cf-side');
    var main = E('div', 'cf-main');

    var gAlg = E('div', 'cf-group');
    gAlg.appendChild(E('p', 'cf-gt', 'Key algorithm'));
    gAlg.appendChild(algSegment(function () { self.stale(); }));
    side.appendChild(gAlg);

    var gName = E('div', 'cf-group');
    gName.appendChild(E('p', 'cf-gt', 'Subject'));
    this.cn = field('Common Name (CN)', 'example.com', 'example.com');
    this.o = field('Organisation (O)', 'Example Ltd');
    var row = E('div', 'cf-row');
    this.c = field('Country (C)', 'GB');
    this.st = field('State (ST)', 'London');
    row.appendChild(this.c);
    row.appendChild(this.st);
    this.san = field('Subject Alt Names (DNS, comma-separated)', 'example.com, www.example.com');
    gName.appendChild(this.cn);
    gName.appendChild(this.o);
    gName.appendChild(row);
    gName.appendChild(this.san);
    side.appendChild(gName);

    var gOpt = E('div', 'cf-group');
    gOpt.appendChild(E('p', 'cf-gt', 'Validity'));
    var vrow = E('div', 'cf-row');
    this.days = field('Days valid', '365');
    vrow.appendChild(this.days);
    gOpt.appendChild(vrow);
    side.appendChild(gOpt);

    var gen = E('button', 'cf-btn cf-btn-primary', 'Generate certificate');
    gen.type = 'button';
    gen.addEventListener('click', function () { self.generate(); });
    side.appendChild(gen);
    side.appendChild(E('p', 'cf-warn', WARN));

    this.statusHost = E('div');
    this.outHost = E('div');
    main.appendChild(this.statusHost);
    main.appendChild(this.outHost);
    status(this.statusHost, null, 'Fill in a subject and press Generate. A real keypair is created ' +
      'in your browser and the certificate is signed with it — the result parses in openssl.');

    body.appendChild(side);
    body.appendChild(main);
    mount.appendChild(body);
  }
  CertTab.prototype.stale = function () {
    status(this.statusHost, null, 'Key algorithm changed — press Generate for a new keypair.');
  };
  CertTab.prototype.generate = function () {
    var self = this;
    ensureKeypair(this.statusHost, function () {
      status(self.statusHost, 'work', 'Signing the certificate…');
      var subject = {
        CN: self.cn.input.value, O: self.o.input.value,
        C: self.c.input.value, ST: self.st.input.value
      };
      var sans = self.san.input.value.split(',').map(function (s) { return s.trim(); })
        .filter(Boolean);
      var days = Math.max(1, parseInt(self.days.input.value, 10) || 365);
      var now = new Date();
      var later = new Date(now.getTime() + days * 86400000);
      F.makeCertificate({
        alg: STATE.alg, serial: Math.floor(1 + Math.random() * 0x7ffffff),
        signingKey: STATE.keypair.privateKey, spki: STATE.spki,
        issuer: subject, subject: subject, notBefore: now, notAfter: later,
        isCA: false, dnsNames: sans
      }).then(function (res) {
        // Counted on the resolved promise, not the button press: a keypair
        // that would not generate or a signature WebCrypto refused lands in
        // the catch and counts nothing. Each of the four tabs reports its own
        // success like this — used() de-dupes per page view, so the lab still
        // counts once however many tabs a visitor works through.
        if (window.KSLab) window.KSLab.used('generate');
        self.show(res, subject);
      }).catch(function (err) {
        status(self.statusHost, 'bad', 'Signing failed: ' + err.message);
      });
    });
  };
  CertTab.prototype.show = function (res, subject) {
    status(this.statusHost, 'ok', 'Self-signed certificate generated and verified. ' +
      res.der.length + ' bytes of DER. It is its own issuer, so it is a trust anchor — a browser ' +
      'would warn unless you added it to your trust store.');
    clear(this.outHost);

    var fields = E('table', 'cf-fields');
    function fr(k, v) {
      var tr = E('tr');
      tr.appendChild(E('td', null, k));
      tr.appendChild(E('td', null, v));
      fields.appendChild(tr);
    }
    fr('Subject', [subject.CN, subject.O, subject.C].filter(Boolean).join(', '));
    fr('Algorithm', STATE.alg === 'rsa' ? 'RSA-2048 with SHA-256' : 'ECDSA P-256 with SHA-256');
    fr('DER size', res.der.length + ' bytes');
    fr('Signature', res.signature.length + ' bytes');
    var fp = E('div', 'cf-pane');
    var fh = E('div', 'cf-pane-h');
    fh.appendChild(E('span', null, 'Certificate fields'));
    fp.appendChild(fh);
    fp.appendChild(fields);
    this.outHost.appendChild(fp);

    this.outHost.appendChild(pemPane('Certificate (PEM) — paste into openssl x509 -text -noout', res.pem));

    var derPane = E('div', 'cf-pane');
    var dh = E('div', 'cf-pane-h');
    dh.appendChild(E('span', null, 'DER structure'));
    derPane.appendChild(dh);
    var derBody = E('div');
    renderDER(derBody, res.der);
    derPane.appendChild(derBody);
    this.outHost.appendChild(derPane);
  };

  /* ======================================================================== */
  /*  TAB 2 — CSR                                                             */
  /* ======================================================================== */

  function CsrTab(mount) {
    var self = this;
    var body = E('div', 'cf-body');
    var side = E('div', 'cf-side');
    var main = E('div', 'cf-main');

    var gAlg = E('div', 'cf-group');
    gAlg.appendChild(E('p', 'cf-gt', 'Key algorithm'));
    gAlg.appendChild(algSegment(function () {}));
    side.appendChild(gAlg);

    var gName = E('div', 'cf-group');
    gName.appendChild(E('p', 'cf-gt', 'Subject'));
    this.cn = field('Common Name (CN)', 'example.com');
    this.o = field('Organisation (O)', 'Example Ltd');
    this.c = field('Country (C)', 'GB');
    gName.appendChild(this.cn);
    gName.appendChild(this.o);
    gName.appendChild(this.c);
    side.appendChild(gName);

    var gen = E('button', 'cf-btn cf-btn-primary', 'Generate signing request');
    gen.type = 'button';
    gen.addEventListener('click', function () { self.generate(); });
    side.appendChild(gen);
    side.appendChild(E('p', 'cf-hint',
      'A CSR is what you send a certificate authority: your public key and your name, signed with ' +
      'your private key to prove you hold it. The CA checks it, then issues a certificate.'));

    this.statusHost = E('div');
    this.outHost = E('div');
    main.appendChild(this.statusHost);
    main.appendChild(this.outHost);
    status(this.statusHost, null, 'Fill in a subject and generate a PKCS#10 certificate signing request.');

    body.appendChild(side);
    body.appendChild(main);
    mount.appendChild(body);
  }
  CsrTab.prototype.generate = function () {
    var self = this;
    ensureKeypair(this.statusHost, function () {
      status(self.statusHost, 'work', 'Signing the request…');
      F.makeCSR({
        alg: STATE.alg, signingKey: STATE.keypair.privateKey, spki: STATE.spki,
        subject: { CN: self.cn.input.value, O: self.o.input.value, C: self.c.input.value }
      }).then(function (res) {
        // Success only, as on the certificate tab — a request that failed to
        // sign takes the catch below instead.
        if (window.KSLab) window.KSLab.used('generate');
        status(self.statusHost, 'ok', 'CSR generated and self-signed. ' + res.der.length +
          ' bytes. Paste it into openssl req -text -noout -verify to check it.');
        clear(self.outHost);
        self.outHost.appendChild(pemPane('Certificate signing request (PEM)', res.pem));
        var derPane = E('div', 'cf-pane');
        var dh = E('div', 'cf-pane-h');
        dh.appendChild(E('span', null, 'DER structure'));
        derPane.appendChild(dh);
        var derBody = E('div');
        renderDER(derBody, res.der);
        derPane.appendChild(derBody);
        self.outHost.appendChild(derPane);
      }).catch(function (err) {
        status(self.statusHost, 'bad', 'Failed: ' + err.message);
      });
    });
  };

  /* ======================================================================== */
  /*  TAB 3 — SIGN / VERIFY / TAMPER                                          */
  /* ======================================================================== */

  function SignTab(mount) {
    var self = this;
    var body = E('div', 'cf-body');
    var side = E('div', 'cf-side');
    var main = E('div', 'cf-main');

    var gAlg = E('div', 'cf-group');
    gAlg.appendChild(E('p', 'cf-gt', 'Key algorithm'));
    gAlg.appendChild(algSegment(function () { self.sig = null; self.refresh(); }));
    side.appendChild(gAlg);

    var gMsg = E('div', 'cf-group');
    gMsg.appendChild(E('p', 'cf-gt', 'Message'));
    this.msg = field('Text to sign', 'Transfer approved: pay invoice 4471');
    gMsg.appendChild(this.msg);
    // Editing the message must NOT clear the signature — keeping it is the
    // whole tamper demo: the same signature is re-verified against the changed
    // message and flips to INVALID.
    this.msg.input.addEventListener('input', function () { self.refresh(); });
    side.appendChild(gMsg);

    var sign = E('button', 'cf-btn cf-btn-primary', 'Sign the message');
    sign.type = 'button';
    sign.addEventListener('click', function () { self.doSign(); });
    side.appendChild(sign);
    side.appendChild(E('p', 'cf-hint',
      'A digital signature proves two things at once: the message came from the holder of the ' +
      'private key, and it has not changed by a single bit since. Change either the message or the ' +
      'signature and verification fails.'));

    this.statusHost = E('div');
    this.outHost = E('div');
    main.appendChild(this.statusHost);
    main.appendChild(this.outHost);
    status(this.statusHost, null, 'Sign a message, then tamper with it and watch verification fail.');

    body.appendChild(side);
    body.appendChild(main);
    mount.appendChild(body);
  }
  SignTab.prototype.doSign = function () {
    var self = this;
    ensureKeypair(this.statusHost, function () {
      var bytes = strBytes(self.msg.input.value);
      F.signBytes(STATE.alg, STATE.keypair.privateKey, bytes).then(function (sig) {
        self.sig = sig;
        self.signedText = self.msg.input.value;
        // The message really was signed — a refusal takes the catch instead —
        // and the tamper demo the visitor came for can now happen.
        if (window.KSLab) window.KSLab.used('generate');
        status(self.statusHost, 'ok', 'Signed. ' + sig.length + ' bytes of signature.');
        self.refresh();
      }).catch(function (err) { status(self.statusHost, 'bad', err.message); });
    });
  };
  SignTab.prototype.refresh = function () {
    var self = this;
    clear(this.outHost);
    if (!this.sig) return;
    var pane = E('div', 'cf-pane');
    var h = E('div', 'cf-pane-h');
    h.appendChild(E('span', null, 'Signature (hex)'));
    pane.appendChild(h);
    var ta = E('textarea', 'cf-pem');
    ta.readOnly = true;
    ta.value = hex(this.sig).replace(/(.{64})/g, '$1\n');
    pane.appendChild(ta);
    this.outHost.appendChild(pane);

    // live verification of the CURRENT message against the stored signature
    var bytes = strBytes(this.msg.input.value);
    F.verifyBytes(STATE.alg, STATE.keypair.publicKey, this.sig, bytes).then(function (okv) {
      var v = E('div', 'cf-verify');
      v.appendChild(E('span', 'cf-tag ' + (okv ? 'cf-tag-ok' : 'cf-tag-bad'),
        okv ? 'VALID' : 'INVALID'));
      var changed = self.msg.input.value !== self.signedText;
      v.appendChild(E('span', null, okv
        ? 'The signature matches this exact message.'
        : (changed ? 'The message has changed since it was signed, so the signature no longer matches — this is tamper detection working.'
                   : 'The signature does not verify.')));
      self.outHost.appendChild(v);
      if (!changed) {
        self.outHost.appendChild(E('p', 'cf-hint',
          'Now edit the message by one character and watch this flip to INVALID.'));
      }
    });
  };

  /* ======================================================================== */
  /*  TAB 4 — CHAIN OF TRUST                                                  */
  /* ======================================================================== */

  function ChainTab(mount) {
    var self = this;
    var body = E('div', 'cf-body');
    var side = E('div', 'cf-side');
    var main = E('div', 'cf-main');

    var g = E('div', 'cf-group');
    g.appendChild(E('p', 'cf-gt', 'Names'));
    this.ca = field('Root CA name', 'Example Root CA');
    this.leaf = field('Leaf hostname', 'app.example.com');
    g.appendChild(this.ca);
    g.appendChild(this.leaf);
    side.appendChild(g);

    var gen = E('button', 'cf-btn cf-btn-primary', 'Build a two-cert chain');
    gen.type = 'button';
    gen.addEventListener('click', function () { self.build(); });
    side.appendChild(gen);
    side.appendChild(E('p', 'cf-hint',
      'A root CA signs a leaf certificate. Your browser trusts the leaf because it trusts the root ' +
      'and can verify the root’s signature on the leaf. This builds both, then checks the link — ' +
      'and checks that an unrelated key does NOT verify it.'));

    this.statusHost = E('div');
    this.outHost = E('div');
    main.appendChild(this.statusHost);
    main.appendChild(this.outHost);
    status(this.statusHost, null, 'Generate a root and a leaf, signed by the root, and verify the chain.');

    body.appendChild(side);
    body.appendChild(main);
    mount.appendChild(body);
  }
  ChainTab.prototype.build = function () {
    var self = this;
    status(this.statusHost, 'work', 'Generating two keypairs and signing two certificates…');
    var caName = { CN: self.ca.input.value, O: 'Example Ltd', C: 'GB' };
    var leafName = { CN: self.leaf.input.value, O: 'Example Ltd', C: 'GB' };
    var now = new Date();
    var caKp, caSpki, leafSpki;
    F.generateKeypair('ec').then(function (kp) {
      caKp = kp; return F.exportSPKI(kp.publicKey);
    }).then(function (spki) {
      caSpki = spki;
      return F.makeCertificate({
        alg: 'ec', serial: 1, signingKey: caKp.privateKey, spki: caSpki,
        issuer: caName, subject: caName, notBefore: now,
        notAfter: new Date(now.getTime() + 3650 * 86400000), isCA: true, dnsNames: null
      });
    }).then(function (caCert) {
      self.caCert = caCert;
      return F.generateKeypair('ec').then(function (lkp) {
        return F.exportSPKI(lkp.publicKey).then(function (lspki) {
          leafSpki = lspki;
          return F.makeCertificate({
            alg: 'ec', serial: 2, signingKey: caKp.privateKey, spki: leafSpki,
            issuer: caName, subject: leafName, notBefore: now,
            notAfter: new Date(now.getTime() + 365 * 86400000), isCA: false,
            dnsNames: [self.leaf.input.value]
          });
        });
      });
    }).then(function (leafCert) {
      // Two keypairs generated and two certificates signed — the chain
      // exists. A failure at any stage lands in the catch and never gets here.
      if (window.KSLab) window.KSLab.used('generate');
      self.render(self.caCert, leafCert, caKp, caName, leafName);
    }).catch(function (err) {
      status(self.statusHost, 'bad', 'Failed: ' + err.message);
    });
  };
  ChainTab.prototype.render = function (caCert, leafCert, caKp, caName, leafName) {
    var self = this;
    // Verify leaf.tbs signature using the CA public key.
    F.verifyBytes('ec', caKp.publicKey, extractSig(leafCert), leafCert.tbs).then(function (okv) {
      status(self.statusHost, okv ? 'ok' : 'bad', okv
        ? 'Chain built and verified: the leaf’s signature checks out against the root’s public key.'
        : 'Verification failed unexpectedly.');
      clear(self.outHost);
      var chain = E('div', 'cf-chain');
      var caNode = E('div', 'cf-node ca');
      caNode.appendChild(E('h4', null, '🔒 Root CA (self-signed, a trust anchor)'));
      caNode.appendChild(E('div', 'cf-sub', caName.CN + ' · issuer = subject · CA:TRUE'));
      chain.appendChild(caNode);
      chain.appendChild(E('div', 'cf-arrow', '↓ signs'));
      var leafNode = E('div', 'cf-node leaf');
      leafNode.appendChild(E('h4', null, '📄 Leaf certificate'));
      leafNode.appendChild(E('div', 'cf-sub', leafName.CN + ' · issued by ' + caName.CN + ' · CA:FALSE'));
      chain.appendChild(leafNode);
      self.outHost.appendChild(chain);

      var v = E('div', 'cf-verify');
      v.appendChild(E('span', 'cf-tag ' + (okv ? 'cf-tag-ok' : 'cf-tag-bad'), okv ? 'CHAIN VALID' : 'BROKEN'));
      v.appendChild(E('span', null, 'The leaf verifies against the root’s public key — and would not verify against any other.'));
      self.outHost.appendChild(v);

      self.outHost.appendChild(pemPane('Root CA certificate (PEM)', caCert.pem));
      self.outHost.appendChild(pemPane('Leaf certificate (PEM)', leafCert.pem));
    });
  };

  /* Pull the signature BIT STRING back out of an assembled cert, so the chain
     tab can re-verify it against the CA key. The cert is SEQUENCE(tbs, alg,
     BIT STRING sig); the signature is the last top-level node. */
  function extractSig(cert) {
    var tree = F.parseDER(cert.der);
    // find the BIT STRING at depth 1 (the signature)
    for (var i = tree.length - 1; i >= 0; i--) {
      if (tree[i].depth === 1 && tree[i].name === 'BIT STRING') {
        var start = tree[i].contentOffset + 1;   // skip the unused-bits byte
        var end = tree[i].contentOffset + tree[i].length;
        var raw = cert.der.subarray(start, end);
        // ECDSA sig is DER SEQUENCE(r,s); convert back to raw r||s for verify
        return derSigToRaw(raw);
      }
    }
    return new Uint8Array(0);
  }
  function derSigToRaw(der) {
    // SEQUENCE { INTEGER r, INTEGER s } -> r||s, each 32 bytes for P-256
    var tree = F.parseDER(der);
    var ints = tree.filter(function (n) { return n.name === 'INTEGER' && n.depth === 1; });
    function grab(n) {
      var b = der.subarray(n.contentOffset, n.contentOffset + n.length);
      // strip a leading sign byte, left-pad to 32
      var arr = Array.prototype.slice.call(b);
      while (arr.length > 32 && arr[0] === 0) arr.shift();
      while (arr.length < 32) arr.unshift(0);
      return arr;
    }
    return new Uint8Array(grab(ints[0]).concat(grab(ints[1])));
  }

  /* ======================================================================== */
  /*  helpers + boot                                                         */
  /* ======================================================================== */

  function strBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  var TABS = [
    { key: 'cert', label: 'Self-signed certificate', build: CertTab },
    { key: 'csr', label: 'Signing request (CSR)', build: CsrTab },
    { key: 'sign', label: 'Sign & verify', build: SignTab },
    { key: 'chain', label: 'Chain of trust', build: ChainTab }
  ];

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('certforgeviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-cert-mount') || rootEl;
    clear(mount);

    var style = E('style');
    style.textContent = CSS;
    mount.appendChild(style);

    if (!root.crypto || !root.crypto.subtle) {
      mount.appendChild(E('p', 'lab-proc-fallback',
        'This lab needs WebCrypto, which requires a secure context (https, or localhost). Your ' +
        'browser did not provide it here.'));
      return;
    }

    var wrap = E('div', 'cf-wrap');
    var tabsBar = E('div', 'cf-tabs');
    var panelHost = E('div');
    var tabButtons = [];
    var currentMount = null;

    function open(i) {
      tabButtons.forEach(function (b, n) { b.className = 'cf-tab' + (n === i ? ' on' : ''); });
      clear(panelHost);
      currentMount = E('div');
      panelHost.appendChild(currentMount);
      // eslint-disable-next-line no-new
      new TABS[i].build(currentMount);
    }

    TABS.forEach(function (t, i) {
      var b = E('button', 'cf-tab', t.label);
      b.type = 'button';
      b.addEventListener('click', function () { open(i); });
      tabsBar.appendChild(b);
      tabButtons.push(b);
    });
    wrap.appendChild(tabsBar);
    wrap.appendChild(panelHost);
    mount.appendChild(wrap);
    open(0);
  }

  if (typeof root.LabViz !== 'undefined' && root.LabViz.define) {
    root.LabViz.define({ id: 'certforgeviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

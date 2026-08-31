/* ==========================================================================
   passkeys.js — make a real passkey, then read every byte it produced.
   --------------------------------------------------------------------------
   Almost every explanation of passkeys is a diagram. This one is not: the
   browser here calls navigator.credentials.create() and .get() against this
   origin, with a real authenticator, and everything on screen is decoded out
   of what came back. The attestation object is CBOR and is decoded in this
   file; the authenticator data is picked apart field by field; the signature
   is verified with Web Crypto against the public key the authenticator
   returned. Nothing is simulated except the one thing that has to be — the
   lookalike origin, which the browser will not let a page produce for real,
   and which is the whole point of the exercise.

   Why the private key never appears anywhere below: it never leaves the
   authenticator. The only thing a site ever receives is a public key and
   signatures over challenges. That is not a policy this page enforces, it is
   what the API is; there is no call that returns the private half.

   There is no server. The challenge is generated here, the public key is kept
   in localStorage on this device, and the verification runs in this tab. A
   real relying party does all three on a server, and the page says so out loud
   in several places, because a passkey demo that quietly implied otherwise
   would be teaching the wrong lesson.

   No network request is made from this file, at any point, for any reason.
   ========================================================================== */

/* global LabTool */
(function (root) {
  'use strict';

  /* ======================================================================
     1. Bytes
     ====================================================================== */

  function randomBytes(n) {
    var out = new Uint8Array(n);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(out);
    return out;
  }

  function bytesOf(source) {
    // ArrayBuffer, TypedArray or DataView, all of which turn up in the
    // credential response depending on the property.
    if (!source) return new Uint8Array(0);
    if (source instanceof Uint8Array) return source;
    if (source.buffer) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return new Uint8Array(source);
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function b64urlEncode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return root.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(text) {
    var s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = root.atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function hex(bytes, from, to) {
    var out = [];
    var stop = to === undefined ? bytes.length : to;
    for (var i = from || 0; i < stop; i++) {
      out.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
    }
    return out.join(' ');
  }

  /* Hand-rolled UTF-8 rather than TextEncoder/TextDecoder, for the same reason
     the rest of the labs avoid them: this file has to keep working wherever
     the site does, and the account name the visitor types can be anything. */
  function utf8Encode(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63),
                    0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    var out = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 0x80) { out += String.fromCharCode(c); continue; }
      var extra = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : 1;
      var cp = c & (extra === 1 ? 0x1f : extra === 2 ? 0x0f : 0x07);
      for (var k = 0; k < extra && i < bytes.length; k++) cp = (cp << 6) | (bytes[i++] & 63);
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  function uuidOf(bytes) {
    var h = [];
    for (var i = 0; i < bytes.length; i++) h.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' +
           h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' +
           h.slice(10, 16).join('');
  }

  function allZero(bytes) {
    for (var i = 0; i < bytes.length; i++) if (bytes[i] !== 0) return false;
    return true;
  }

  /* ======================================================================
     2. A CBOR reader, only as much of it as WebAuthn actually uses.
     --------------------------------------------------------------------
     The attestation object and the COSE public key are both CBOR, so a
     passkey cannot be explained without decoding it. WebAuthn requires the
     canonical (CTAP2) encoding, which rules out indefinite lengths entirely;
     anything that turns up outside that is a malformed structure and is
     reported as one rather than guessed at.
     ====================================================================== */

  function cborByte(st) {
    if (st.p >= st.b.length) throw new Error('the CBOR ended in the middle of a value');
    return st.b[st.p++];
  }

  function cborUint(st, n) {
    var v = 0;
    for (var i = 0; i < n; i++) v = v * 256 + cborByte(st);
    return v;
  }

  function cborHead(st) {
    var ib = cborByte(st);
    var major = ib >> 5, info = ib & 31, value;
    if (info < 24) value = info;
    else if (info === 24) value = cborByte(st);
    else if (info === 25) value = cborUint(st, 2);
    else if (info === 26) value = cborUint(st, 4);
    else if (info === 27) value = cborUint(st, 8);
    else throw new Error('indefinite-length CBOR, which WebAuthn does not permit');
    return { major: major, info: info, value: value };
  }

  function cborRead(st) {
    var h = cborHead(st), i, len, out;
    if (h.major === 0) return h.value;
    if (h.major === 1) return -1 - h.value;
    if (h.major === 2 || h.major === 3) {
      len = h.value;
      if (st.p + len > st.b.length) throw new Error('a CBOR string runs past the end of the data');
      out = st.b.subarray(st.p, st.p + len);
      st.p += len;
      return h.major === 2 ? out : utf8Decode(out);
    }
    if (h.major === 4) {
      out = [];
      for (i = 0; i < h.value; i++) out.push(cborRead(st));
      return out;
    }
    if (h.major === 5) {
      out = { __keys: [] };
      for (i = 0; i < h.value; i++) {
        var key = String(cborRead(st));
        out.__keys.push(key);
        out[key] = cborRead(st);
      }
      return out;
    }
    if (h.major === 6) return cborRead(st);        // a tag; the content is what matters here
    if (h.info === 20) return false;
    if (h.info === 21) return true;
    if (h.info === 22) return null;
    throw new Error('a CBOR value of a type these structures do not use');
  }

  /* The top-level map is read by hand rather than through cborRead, because
     the byte range of each value is needed for the annotated dump. */
  function readTopMap(bytes) {
    var st = { b: bytes, p: 0 };
    var h = cborHead(st);
    if (h.major !== 5) throw new Error('the attestation object should be a CBOR map and is not');
    var map = { __keys: [] }, spans = {};
    for (var i = 0; i < h.value; i++) {
      var key = String(cborRead(st));
      var start = st.p;
      map.__keys.push(key);
      map[key] = cborRead(st);
      spans[key] = { from: start, to: st.p };
    }
    return { map: map, spans: spans, end: st.p };
  }

  function readCoseAt(bytes, offset) {
    var st = { b: bytes, p: offset };
    var value = cborRead(st);
    return { key: value, end: st.p };
  }

  /* ======================================================================
     3. Authenticator data
     --------------------------------------------------------------------
     37 fixed bytes, then an optional attested credential block, then
     optional extensions. Every field below is read at a fixed offset from
     the start; nothing here is heuristic.
     ====================================================================== */

  var FLAG_BITS = [
    [0x01, 'UP', 'User present',
     'Someone physically touched, tapped or looked at the authenticator. It says a human was there; it does not say which human.'],
    [0x02, 'RFU1', 'Reserved',
     'Not assigned. Should be zero.'],
    [0x04, 'UV', 'User verified',
     'The authenticator checked who it was: a PIN, a fingerprint, a face. This is the bit that turns one factor into two.'],
    [0x08, 'BE', 'Backup eligible',
     'This credential is of a kind that can be copied off the device — a synced passkey. The bit is fixed for the life of the credential.'],
    [0x10, 'BS', 'Backup state',
     'It actually is backed up right now. A relying party that reads BE=1 and BS=0 knows the key exists in exactly one place today.'],
    [0x20, 'RFU2', 'Reserved',
     'Not assigned. Should be zero.'],
    [0x40, 'AT', 'Attested credential data',
     'The block carrying the AAGUID, the credential ID and the public key is present. Set on registration, clear on every sign-in afterwards.'],
    [0x80, 'ED', 'Extension data',
     'CBOR extension output is appended after everything else.']
  ];

  function parseAuthData(bytes) {
    if (bytes.length < 37) {
      throw new Error('authenticator data is ' + bytes.length + ' bytes; the fixed part alone is 37');
    }
    var out = { bytes: bytes, segments: [] };
    out.rpIdHash = bytes.subarray(0, 32);
    out.flagsByte = bytes[32];
    out.flags = {
      up: !!(bytes[32] & 0x01), uv: !!(bytes[32] & 0x04),
      be: !!(bytes[32] & 0x08), bs: !!(bytes[32] & 0x10),
      at: !!(bytes[32] & 0x40), ed: !!(bytes[32] & 0x80)
    };
    out.signCount = ((bytes[33] << 24) | (bytes[34] << 16) | (bytes[35] << 8) | bytes[36]) >>> 0;
    out.segments.push({ from: 0, to: 32, tone: 1, label: 'rpIdHash',
      note: 'SHA-256 of the RP ID this credential belongs to' });
    out.segments.push({ from: 32, to: 33, tone: 2, label: 'flags',
      note: 'one byte, eight bits, listed below' });
    out.segments.push({ from: 33, to: 37, tone: 3, label: 'signCount',
      note: 'a 32-bit counter, big-endian' });

    var p = 37;
    if (out.flags.at) {
      if (p + 18 > bytes.length) throw new Error('the AT flag is set but the attested credential block is truncated');
      out.aaguid = bytes.subarray(p, p + 16);
      out.segments.push({ from: p, to: p + 16, tone: 4, label: 'AAGUID',
        note: 'which model of authenticator this is, or all zeroes for none of your business' });
      p += 16;
      var idLen = (bytes[p] << 8) | bytes[p + 1];
      out.segments.push({ from: p, to: p + 2, tone: 5, label: 'credentialIdLength',
        note: idLen + ' bytes follow' });
      p += 2;
      if (p + idLen > bytes.length) throw new Error('the credential ID length runs past the end of the data');
      out.credId = bytes.subarray(p, p + idLen);
      out.segments.push({ from: p, to: p + idLen, tone: 6, label: 'credentialId',
        note: 'the handle a site sends back to ask for this key' });
      p += idLen;
      var cose = readCoseAt(bytes, p);
      out.cose = cose.key;
      out.coseBytes = bytes.subarray(p, cose.end);
      // The decoded map and the bytes it came from travel together, so every
      // renderer that has one has the other without threading a second
      // argument through half the file.
      out.cose.__raw = out.coseBytes;
      out.segments.push({ from: p, to: cose.end, tone: 7, label: 'credentialPublicKey',
        note: 'the public half, as a COSE key in CBOR' });
      p = cose.end;
    }
    if (out.flags.ed) {
      var ext = readCoseAt(bytes, p);
      out.extensions = ext.key;
      out.segments.push({ from: p, to: ext.end, tone: 8, label: 'extensions',
        note: 'CBOR extension output' });
      p = ext.end;
    }
    if (p < bytes.length) {
      out.segments.push({ from: p, to: bytes.length, tone: 0, label: 'trailing bytes',
        note: 'nothing in the structure accounts for these' });
    }
    return out;
  }

  /* ======================================================================
     4. COSE keys, and verifying a signature with the one that came back.
     ====================================================================== */

  var COSE_ALG = {
    '-7':    { name: 'ES256', kind: 'ec',  curve: 'P-256', size: 32, hash: 'SHA-256' },
    '-35':   { name: 'ES384', kind: 'ec',  curve: 'P-384', size: 48, hash: 'SHA-384' },
    '-36':   { name: 'ES512', kind: 'ec',  curve: 'P-521', size: 66, hash: 'SHA-512' },
    '-8':    { name: 'EdDSA', kind: 'okp', curve: 'Ed25519', hash: null },
    '-257':  { name: 'RS256', kind: 'rsa', hash: 'SHA-256', pss: false },
    '-258':  { name: 'RS384', kind: 'rsa', hash: 'SHA-384', pss: false },
    '-259':  { name: 'RS512', kind: 'rsa', hash: 'SHA-512', pss: false },
    '-37':   { name: 'PS256', kind: 'rsa', hash: 'SHA-256', pss: true }
  };

  function algInfo(alg) {
    return COSE_ALG[String(alg)] || null;
  }

  function stripLeadingZeros(v) {
    var i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    return v.subarray(i);
  }

  function padTo(v, size) {
    var t = stripLeadingZeros(v);
    if (t.length > size) throw new Error('an integer in the signature is longer than the curve allows');
    var out = new Uint8Array(size);
    out.set(t, size - t.length);
    return out;
  }

  /* ECDSA signatures arrive from an authenticator as ASN.1 DER — SEQUENCE of
     two INTEGERs. Web Crypto wants the raw r||s pair at fixed width. The two
     encodings carry the same number; only the packaging differs, which is
     worth showing on the page rather than quietly converting. */
  function derToRs(der, size) {
    var p = 0;
    if (der[p++] !== 0x30) throw new Error('the signature does not start with a DER SEQUENCE');
    var len = der[p++];
    if (len & 0x80) p += (len & 0x7f);
    if (der[p++] !== 0x02) throw new Error('the signature is missing its first INTEGER');
    var rLen = der[p++];
    var r = der.subarray(p, p + rLen); p += rLen;
    if (der[p++] !== 0x02) throw new Error('the signature is missing its second INTEGER');
    var sLen = der[p++];
    var s = der.subarray(p, p + sLen); p += sLen;
    return { r: r, s: s, raw: concat(padTo(r, size), padTo(s, size)) };
  }

  function subtle() {
    return (root.crypto && root.crypto.subtle) || null;
  }

  function sha256(bytes) {
    return subtle().digest('SHA-256', bytes).then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function importCoseKey(cose) {
    var info = algInfo(cose['3']);
    if (!info) return Promise.reject(new Error('COSE algorithm ' + cose['3'] + ' is not one this page can verify'));
    if (info.kind === 'ec') {
      return subtle().importKey('jwk', {
        kty: 'EC', crv: info.curve, ext: true,
        x: b64urlEncode(padTo(bytesOf(cose['-2']), info.size)),
        y: b64urlEncode(padTo(bytesOf(cose['-3']), info.size))
      }, { name: 'ECDSA', namedCurve: info.curve }, false, ['verify']).then(function (key) {
        return { key: key, info: info, params: { name: 'ECDSA', hash: { name: info.hash } } };
      });
    }
    if (info.kind === 'rsa') {
      var algName = info.pss ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5';
      return subtle().importKey('jwk', {
        kty: 'RSA', ext: true,
        n: b64urlEncode(stripLeadingZeros(bytesOf(cose['-1']))),
        e: b64urlEncode(stripLeadingZeros(bytesOf(cose['-2'])))
      }, { name: algName, hash: { name: info.hash } }, false, ['verify']).then(function (key) {
        var params = info.pss ? { name: 'RSA-PSS', saltLength: 32 } : { name: algName };
        return { key: key, info: info, params: params };
      });
    }
    // Ed25519 is in Web Crypto in some engines and not in others, and there is
    // no useful feature test short of trying it.
    return subtle().importKey('raw', bytesOf(cose['-2']), { name: 'Ed25519' }, false, ['verify'])
      .then(function (key) {
        return { key: key, info: info, params: { name: 'Ed25519' } };
      });
  }

  function verifyAssertion(cose, authDataBytes, clientDataBytes, signature) {
    return importCoseKey(cose).then(function (imported) {
      return sha256(clientDataBytes).then(function (hash) {
        var signed = concat(authDataBytes, hash);
        var sig = signature;
        var rs = null;
        if (imported.info.kind === 'ec') {
          rs = derToRs(signature, imported.info.size);
          sig = rs.raw;
        }
        return subtle().verify(imported.params, imported.key, sig, signed).then(function (ok) {
          return { ok: ok, hash: hash, signed: signed, rs: rs, info: imported.info };
        });
      });
    });
  }

  /* ======================================================================
     5. Storage — the public key, on this device, and nowhere else.
     ====================================================================== */

  var STORE_KEY = 'lab.passkeys';

  function loadStore() {
    try {
      var raw = root.localStorage.getItem(STORE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
    } catch (err) {
      return [];
    }
  }

  function saveStore(list) {
    try {
      root.localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ======================================================================
     6. DOM helpers
     ====================================================================== */

  function el(id) { return document.getElementById(id); }

  function make(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function empty(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function section(host, title, sub) {
    var box = make('section', 'pk-sec');
    box.appendChild(make('h3', 'pk-sec-h', title));
    if (sub) box.appendChild(make('p', 'pk-sec-sub', sub));
    host.appendChild(box);
    return box;
  }

  function kv(box, key, value, cls) {
    var row = make('div', 'pk-kv');
    row.appendChild(make('span', 'pk-k', key));
    row.appendChild(make('span', 'pk-v' + (cls ? ' ' + cls : ''), value));
    box.appendChild(row);
    return row;
  }

  function para(box, text, cls) {
    box.appendChild(make('p', 'pk-note' + (cls ? ' ' + cls : ''), text));
  }

  function pre(box, text) {
    box.appendChild(make('pre', 'pk-pre', text));
  }

  /* An annotated hex dump.

     The dump itself is aria-hidden and the legend under it carries every field
     in words, with its byte range and its decoded value. That is deliberate:
     read aloud, two hundred hex pairs are noise, and a colour-coded block is
     no use to a screen reader anyway. The legend is the content; the dump is
     the picture of it. Colour is never the only channel — each field is named
     in the legend and each swatch carries the same index as the block. */
  function hexBlock(box, bytes, segments) {
    var wrap = make('div', 'pk-bytes');
    wrap.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var span = make('span', 'pk-b pk-tone-' + seg.tone);
      var length = seg.to - seg.from;
      if (length > 112) {
        span.textContent = hex(bytes, seg.from, seg.from + 96) +
          ' … ' + (length - 112) + ' bytes … ' + hex(bytes, seg.to - 16, seg.to);
      } else {
        span.textContent = hex(bytes, seg.from, seg.to);
      }
      wrap.appendChild(span);
      if (i < segments.length - 1) wrap.appendChild(document.createTextNode(' '));
    }
    box.appendChild(wrap);

    var list = make('ul', 'pk-legend');
    for (var j = 0; j < segments.length; j++) {
      var s = segments[j];
      var li = make('li', 'pk-legend-item');
      li.appendChild(make('span', 'pk-swatch pk-tone-' + s.tone, ''));
      li.appendChild(make('b', 'pk-legend-name', s.label));
      li.appendChild(make('span', 'pk-legend-range',
        'bytes ' + s.from + '–' + (s.to - 1) + ' (' + (s.to - s.from) + ')'));
      li.appendChild(make('span', 'pk-legend-note', s.note));
      list.appendChild(li);
    }
    box.appendChild(list);
  }

  function flagTable(box, flagsByte) {
    var table = make('table', 'pk-flags');
    var caption = make('caption', 'pk-flags-cap',
      'Flags byte 0x' + (flagsByte < 16 ? '0' : '') + flagsByte.toString(16) +
      ', binary ' + bits8(flagsByte));
    table.appendChild(caption);
    var head = make('tr');
    head.appendChild(make('th', null, 'Bit'));
    head.appendChild(make('th', null, 'Name'));
    head.appendChild(make('th', null, 'Set'));
    head.appendChild(make('th', null, 'What it means'));
    var thead = make('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = make('tbody');
    for (var i = FLAG_BITS.length - 1; i >= 0; i--) {
      var f = FLAG_BITS[i];
      var on = !!(flagsByte & f[0]);
      var tr = make('tr', on ? 'is-on' : 'is-off');
      tr.appendChild(make('td', 'pk-flag-bit', String(i)));
      tr.appendChild(make('td', 'pk-flag-name', f[1]));
      tr.appendChild(make('td', 'pk-flag-set', on ? 'yes' : 'no'));
      var meaning = make('td', 'pk-flag-why');
      meaning.appendChild(make('b', null, f[2]));
      meaning.appendChild(document.createTextNode(' — ' + f[3]));
      tr.appendChild(meaning);
      body.appendChild(tr);
    }
    table.appendChild(body);
    box.appendChild(table);
  }

  function bits8(value) {
    var s = '';
    for (var i = 7; i >= 0; i--) s += (value >> i) & 1;
    return s;
  }

  /* ======================================================================
     7. The page
     ====================================================================== */

  var reportHost = null;
  var announce = null;
  var support = { ok: false, reason: '' };
  var lastAssertion = null;      // what the origin demonstration works on

  function say(text) {
    if (announce) announce.textContent = text;
  }

  function status(text, cls) {
    var node = el('tool-status');
    if (!node) return;
    node.textContent = text;
    node.className = 'lab-status' + (cls ? ' ' + cls : '');
  }

  function resetReport(title, sub) {
    empty(reportHost);
    if (title) {
      var head = make('div', 'pk-report-head');
      head.appendChild(make('h2', 'pk-report-h', title));
      if (sub) head.appendChild(make('p', 'pk-report-sub', sub));
      reportHost.appendChild(head);
    }
  }

  function rpId() {
    return root.location.hostname;
  }

  function accountName() {
    var field = el('tool-user');
    var value = field && field.value ? field.value.replace(/^\s+|\s+$/g, '') : '';
    return value || 'demo@example.com';
  }

  /* Buffers are shown as base64url with their length, which is how every
     WebAuthn library on earth logs them, so the output here matches what a
     reader will see in their own server logs later. */
  function forDisplay(value) {
    if (value instanceof Uint8Array) {
      return b64urlEncode(value) + '   (' + value.length + ' bytes, base64url)';
    }
    if (Object.prototype.toString.call(value) === '[object Array]') {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(forDisplay(value[i]));
      return arr;
    }
    if (value && typeof value === 'object') {
      var obj = {}, keys = Object.keys(value);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] === '__keys') continue;
        obj[keys[k]] = forDisplay(value[keys[k]]);
      }
      return obj;
    }
    return value;
  }

  /* ---------------------------------------------------------------------
     Support report
     --------------------------------------------------------------------- */

  function checkSupport() {
    var host = el('pk-support');
    if (!host) return;
    empty(host);

    var reasons = [];
    if (!root.isSecureContext) reasons.push('this page is not in a secure context');
    if (!root.PublicKeyCredential) reasons.push('the browser has no PublicKeyCredential');
    if (!root.navigator.credentials || !root.navigator.credentials.create) {
      reasons.push('navigator.credentials.create is missing');
    }
    if (!root.Promise) reasons.push('the browser has no Promise');
    if (!subtle()) reasons.push('Web Crypto is unavailable, so signatures could not be checked here');
    support.ok = reasons.length === 0;
    support.reason = reasons.join('; ');

    kv(host, 'origin', root.location.origin, 'pk-mono');
    kv(host, 'RP ID this page uses', rpId(), 'pk-mono');
    kv(host, 'secure context', root.isSecureContext ? 'yes' : 'no',
       root.isSecureContext ? 'is-ok' : 'is-err');
    kv(host, 'WebAuthn API', root.PublicKeyCredential ? 'present' : 'missing',
       root.PublicKeyCredential ? 'is-ok' : 'is-err');
    kv(host, 'Web Crypto', subtle() ? 'present' : 'missing', subtle() ? 'is-ok' : 'is-err');

    var platformRow = kv(host, 'built-in authenticator', 'checking…', 'is-dim');
    var condRow = kv(host, 'conditional UI (autofill)', 'checking…', 'is-dim');

    function fill(row, text, cls) {
      var value = row.lastChild;
      value.textContent = text;
      value.className = 'pk-v' + (cls ? ' ' + cls : '');
    }

    if (root.PublicKeyCredential && root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(function (yes) {
        fill(platformRow, yes ? 'available — Face ID, Windows Hello, a fingerprint reader or similar'
                              : 'none found — a security key or a phone would be used instead',
             yes ? 'is-ok' : 'is-warn');
      }, function () { fill(platformRow, 'the browser would not say', 'is-warn'); });
    } else {
      fill(platformRow, 'the browser does not expose this check', 'is-warn');
    }

    if (root.PublicKeyCredential && root.PublicKeyCredential.isConditionalMediationAvailable) {
      root.PublicKeyCredential.isConditionalMediationAvailable().then(function (yes) {
        fill(condRow, yes ? 'supported — passkeys can appear in the username field'
                          : 'not supported here', yes ? 'is-ok' : 'is-warn');
      }, function () { fill(condRow, 'the browser would not say', 'is-warn'); });
    } else {
      fill(condRow, 'the browser does not expose this check', 'is-warn');
    }

    if (!support.ok) {
      var create = el('tool-create'), run = el('tool-run'), foreign = el('tool-foreign');
      if (create) create.disabled = true;
      if (run) run.disabled = true;
      if (foreign) foreign.disabled = true;
      status('WebAuthn unavailable', 'is-err');
      renderUnavailable();
    } else {
      status('ready', 'is-ok');
    }
  }

  /* When the API is not there, the page still has a job: say what would have
     happened, in the same order it would have happened in. A blank tool and a
     red banner teach nothing. */
  function renderUnavailable() {
    resetReport('WebAuthn is not available here',
      'So nothing below is live. This is what the two calls would have done.');
    var why = section(reportHost, 'Why');
    para(why, 'The page checked and found: ' + (support.reason || 'no working WebAuthn API') + '.');
    para(why, 'The usual causes are an insecure context — WebAuthn refuses to run over plain ' +
      'http or from a file:// URL, because origin binding is meaningless without TLS — an older ' +
      'browser, or a policy that has switched the API off. Nothing is broken on your machine.');

    var one = section(reportHost, 'What registration would have done');
    para(one, '1. The page generates a 32-byte random challenge and calls ' +
      'navigator.credentials.create() with it, an RP ID of ' + rpId() + ', a user handle, and a ' +
      'list of acceptable algorithms.');
    para(one, '2. The browser refuses to let the page name any RP ID other than its own domain, ' +
      'then shows a prompt the page cannot see, style or read.');
    para(one, '3. The authenticator generates a key pair, keeps the private half, and returns an ' +
      'attestation object: CBOR containing a format name, a statement, and the authenticator ' +
      'data — which holds SHA-256 of the RP ID, a flags byte, a counter, the AAGUID, the ' +
      'credential ID and the public key in COSE form.');
    para(one, '4. Alongside it comes clientDataJSON: the challenge echoed back, the type, and ' +
      'the origin the browser actually loaded — not the origin the page claims to be.');

    var two = section(reportHost, 'What signing in would have done');
    para(two, '1. A fresh challenge goes to navigator.credentials.get().');
    para(two, '2. The authenticator finds the credential by RP ID, verifies the user, and signs ' +
      'the authenticator data concatenated with SHA-256 of the clientDataJSON.');
    para(two, '3. The server checks the signature against the stored public key, checks the ' +
      'challenge is the one it issued, checks the origin string, and checks the RP ID hash.');
    para(two, 'The origin is inside the signed bytes. That is the entire anti-phishing mechanism: ' +
      'a signature made for one origin does not verify as a signature for another, and the ' +
      'authenticator would not have produced one for the lookalike in the first place.');
    say('WebAuthn is unavailable in this browser. An explanation is shown instead.');
  }

  /* ---------------------------------------------------------------------
     The stored list
     --------------------------------------------------------------------- */

  function renderStore() {
    var host = el('pk-store');
    if (!host) return;
    empty(host);
    var list = loadStore();
    if (!list.length) {
      var none = make('p', 'pk-empty',
        'No passkey stored yet. Press “Create a passkey” and your browser will ask for a ' +
        'fingerprint, a face or a PIN. Whatever it saves stays on your device.');
      host.appendChild(none);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      host.appendChild(storeCard(list[i], i));
    }
    var note = make('p', 'pk-empty',
      'These records hold a public key, an ID and a label — never a private key, which the ' +
      'authenticator does not hand out. Clearing this site’s storage deletes them; the passkey ' +
      'itself stays in your password manager or security key until you remove it there.');
    host.appendChild(note);
  }

  function storeCard(record, index) {
    var card = make('div', 'pk-cred');
    var head = make('div', 'pk-cred-head');
    head.appendChild(make('b', 'pk-cred-name', record.userName || 'unnamed'));
    var forget = make('button', 'pk-cred-forget', 'Forget');
    forget.type = 'button';
    forget.setAttribute('aria-label', 'Forget the stored record for ' + (record.userName || 'this passkey'));
    forget.addEventListener('click', function () {
      var list = loadStore();
      list.splice(index, 1);
      saveStore(list);
      renderStore();
      say('Stored record removed.');
    });
    head.appendChild(forget);
    card.appendChild(head);
    kv(card, 'credential ID', shorten(record.id), 'pk-mono');
    kv(card, 'algorithm', record.algName || String(record.alg), 'pk-mono');
    kv(card, 'AAGUID', record.aaguid || 'unknown', 'pk-mono');
    kv(card, 'discoverable', record.discoverable ? 'yes, it can be found without a hint'
                                                 : 'unknown — the browser did not say');
    kv(card, 'synced (BE/BS)', record.be ? (record.bs ? 'yes — backed up to an account'
                                                      : 'eligible, not backed up yet')
                                         : 'no — device-bound');
    kv(card, 'created', record.created || 'unknown');
    return card;
  }

  function shorten(text) {
    var s = String(text);
    return s.length > 40 ? s.slice(0, 20) + '…' + s.slice(s.length - 12) : s;
  }

  /* ---------------------------------------------------------------------
     Registration
     --------------------------------------------------------------------- */

  function buildCreateOptions() {
    var stored = loadStore();
    var exclude = [];
    for (var i = 0; i < stored.length; i++) {
      exclude.push({ type: 'public-key', id: b64urlDecode(stored[i].id) });
    }
    var selection = {
      residentKey: el('tool-rk').value,
      requireResidentKey: el('tool-rk').value === 'required',
      userVerification: el('tool-uv').value
    };
    var attach = el('tool-attach').value;
    if (attach) selection.authenticatorAttachment = attach;

    return {
      challenge: randomBytes(32),
      rp: { name: 'Krunalkumar Shah Labs', id: rpId() },
      user: {
        id: randomBytes(16),
        name: accountName(),
        displayName: accountName()
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      timeout: 60000,
      attestation: el('tool-attest').value,
      authenticatorSelection: selection,
      excludeCredentials: exclude
    };
  }

  function register() {
    if (!support.ok) { renderUnavailable(); return; }
    var options = buildCreateOptions();
    status('waiting for the authenticator…', 'is-busy');
    resetReport('Registration', 'Everything below is decoded from what your authenticator returned.');
    var sent = section(reportHost, 'What the page asked for',
      'PublicKeyCredentialCreationOptions, exactly as it was passed to navigator.credentials.create().');
    pre(sent, JSON.stringify(forDisplay(options), null, 2));
    para(sent, 'Note what is not in there: no password, no email verification, nothing secret. ' +
      'The challenge is 32 random bytes and its only job is to make this one ceremony unrepeatable.');
    para(sent, 'A real deployment generates that challenge on the server, remembers it, and ' +
      'refuses a response that echoes anything else. Here it is generated in this tab, which is ' +
      'fine for looking at the machinery and useless as a security control.');
    say('Waiting for the authenticator.');

    root.navigator.credentials.create({ publicKey: options }).then(function (credential) {
      onRegistered(credential, options);
    }, function (err) {
      onRefused(err, 'registration');
    });
  }

  function onRegistered(credential, options) {
    var response = credential.response;
    var clientDataBytes = bytesOf(response.clientDataJSON);
    var attBytes = bytesOf(response.attestationObject);
    var top, authData;

    try {
      top = readTopMap(attBytes);
      authData = parseAuthData(bytesOf(top.map.authData));
    } catch (err) {
      status('could not decode', 'is-err');
      var bad = section(reportHost, 'The response would not decode');
      para(bad, 'The authenticator returned something this reader could not follow: ' +
        ((err && err.message) || String(err)) + '.');
      para(bad, 'Nothing was uploaded and nothing else on the page is affected. If you can ' +
        'reproduce it I would like to hear which authenticator you used.');
      return;
    }

    renderClientData(clientDataBytes, 'webauthn.create');

    var att = section(reportHost, 'attestationObject',
      attBytes.length + ' bytes of CBOR. Three keys, in canonical order.');
    kv(att, 'fmt', String(top.map.fmt), 'pk-mono');
    para(att, formatNote(String(top.map.fmt)));
    kv(att, 'attStmt keys', (top.map.attStmt && top.map.attStmt.__keys &&
        top.map.attStmt.__keys.length) ? top.map.attStmt.__keys.join(', ') : '(empty)', 'pk-mono');
    kv(att, 'authData', bytesOf(top.map.authData).length + ' bytes', 'pk-mono');
    hexBlock(att, attBytes, topSegments(attBytes, top));

    renderAuthData(authData, 'Registration authenticator data');

    var keySec = section(reportHost, 'The credential public key',
      'A COSE_Key in CBOR. This is the only half of the pair that ever leaves the authenticator.');
    renderCose(keySec, authData.cose);
    para(keySec, 'The private key is not in this response, is not in any response, and has no ' +
      'API that returns it. That is the structural difference between a passkey and a password: ' +
      'there is nothing on the server worth stealing, so a database breach yields a list of ' +
      'public keys and no way to sign with any of them.');

    var idSec = section(reportHost, 'Credential ID and AAGUID');
    kv(idSec, 'credential ID', b64urlEncode(authData.credId), 'pk-mono');
    kv(idSec, 'length', authData.credId.length + ' bytes', 'pk-mono');
    kv(idSec, 'AAGUID', uuidOf(authData.aaguid), 'pk-mono');
    para(idSec, allZero(authData.aaguid)
      ? 'All zeroes. The authenticator declined to say what model it is, which is normal: it is ' +
        'what you get with attestation "none", and what most platform and synced passkey ' +
        'providers return regardless. Privacy by default — a per-model identifier on every ' +
        'registration is a tracking vector.'
      : 'A 128-bit identifier for the make and model of authenticator, the same for every unit ' +
        'of that model. Turning it into a product name means a lookup in the FIDO Metadata ' +
        'Service, which is a network request, so this page does not do one.');

    var transports = [];
    if (response.getTransports) {
      try { transports = response.getTransports() || []; } catch (err2) { transports = []; }
    }
    if (transports.length) {
      kv(idSec, 'transports', transports.join(', '), 'pk-mono');
      para(idSec, 'A hint for next time: how the browser reached this authenticator. Storing it ' +
        'and sending it back in allowCredentials is what stops a site prompting you to insert a ' +
        'security key when the passkey is on your phone.');
    }

    var record = {
      id: b64urlEncode(bytesOf(credential.rawId)),
      alg: authData.cose['3'],
      algName: algInfo(authData.cose['3']) ? algInfo(authData.cose['3']).name : 'alg ' + authData.cose['3'],
      publicKey: b64urlEncode(authData.coseBytes),
      aaguid: uuidOf(authData.aaguid),
      rpId: rpId(),
      userName: accountName(),
      userHandle: b64urlEncode(options.user.id),
      created: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      be: authData.flags.be,
      bs: authData.flags.bs,
      uv: authData.flags.uv,
      discoverable: readDiscoverable(credential),
      transports: transports,
      signCount: authData.signCount
    };
    var saved = saveStore(loadStore().concat([record]));
    renderStore();

    var kept = section(reportHost, 'What this page kept');
    para(kept, saved
      ? 'The record above is now in localStorage under the key "lab.passkeys", on this device ' +
        'only. It holds the credential ID, the COSE public key, the AAGUID and the label you ' +
        'typed. It does not and cannot hold a private key.'
      : 'Storage was refused — private browsing usually does this. The passkey itself was still ' +
        'created; this page simply has nowhere to remember it, so signing in will need the ' +
        'discoverable option rather than a named credential.');
    para(kept, 'A real relying party writes the same fields into a database row against your ' +
      'account, plus the sign counter, and treats the whole row as public information.');

    status('passkey created', 'is-ok');
    say('Passkey created. The decoded registration response is in the output panel.');
  }

  function readDiscoverable(credential) {
    try {
      var results = credential.getClientExtensionResults ? credential.getClientExtensionResults() : null;
      if (results && results.credProps && typeof results.credProps.rk === 'boolean') {
        return results.credProps.rk;
      }
    } catch (err) {}
    return null;
  }

  function formatNote(fmt) {
    if (fmt === 'none') {
      return 'Format "none" — the authenticator made no claim about itself, because the page ' +
        'asked for attestation "none" or the platform strips it. Almost every consumer ' +
        'deployment wants exactly this: attestation tells you the make and model of the ' +
        'authenticator, which matters to an enterprise enforcing a hardware policy and to ' +
        'nobody else, and carries a privacy cost either way.';
    }
    if (fmt === 'packed') {
      return 'Format "packed" — a signature over the authenticator data and the client data ' +
        'hash, made with an attestation key rather than the new credential key, usually with a ' +
        'certificate chain in x5c. It proves the model, not the person.';
    }
    if (fmt === 'apple' || fmt === 'android-key' || fmt === 'android-safetynet') {
      return 'A platform attestation format ("' + fmt + '"). It carries a chain that ties the ' +
        'key to the operating system vendor. Verifying it needs vendor root certificates, which ' +
        'would be a network fetch, so this page decodes the structure and stops there.';
    }
    return 'Attestation format "' + fmt + '". This page decodes the structure and does not ' +
      'attempt to validate the statement, which would need vendor roots fetched over the network.';
  }

  function topSegments(bytes, top) {
    var named = [];
    var keys = top.map.__keys;
    var tones = { fmt: 2, attStmt: 5, authData: 7 };
    for (var i = 0; i < keys.length; i++) {
      var span = top.spans[keys[i]];
      named.push({ from: span.from, to: span.to, tone: tones[keys[i]] || 0,
        label: keys[i], note: (span.to - span.from) + ' bytes of CBOR' });
    }
    named.sort(function (a, b) { return a.from - b.from; });
    var out = [], at = 0;
    for (var j = 0; j < named.length; j++) {
      if (named[j].from > at) {
        out.push({ from: at, to: named[j].from, tone: 0, label: 'CBOR framing',
          note: 'the map header and the key name' });
      }
      out.push(named[j]);
      at = named[j].to;
    }
    if (at < bytes.length) {
      out.push({ from: at, to: bytes.length, tone: 0, label: 'trailing', note: 'unaccounted bytes' });
    }
    return out;
  }

  /* ---------------------------------------------------------------------
     Shared renderers
     --------------------------------------------------------------------- */

  function renderClientData(bytes, expectedType) {
    var text = utf8Decode(bytes);
    var data;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    var box = section(reportHost, 'clientDataJSON',
      bytes.length + ' bytes of JSON, written by the browser and not by this page.');
    pre(box, text);
    if (!data) {
      para(box, 'That did not parse as JSON, which should not happen.');
      return null;
    }
    kv(box, 'type', String(data.type), data.type === expectedType ? 'pk-mono is-ok' : 'pk-mono is-warn');
    kv(box, 'challenge', String(data.challenge), 'pk-mono');
    kv(box, 'origin', String(data.origin), 'pk-mono pk-hot');
    kv(box, 'crossOrigin', String(!!data.crossOrigin), 'pk-mono');
    para(box, 'The origin line is the one that matters. The browser writes it from the address ' +
      'bar; the page cannot set it, cannot read it out of a different tab, and cannot forge it. ' +
      'Everything else here is a formality by comparison.');
    para(box, 'These exact bytes are hashed and the hash becomes part of what gets signed, so ' +
      'changing a single character of that origin invalidates the signature. That is ' +
      'demonstrated further down the page, on the real signature, not on a mock-up.');
    return data;
  }

  function renderAuthData(authData, title) {
    var box = section(reportHost, title,
      authData.bytes.length + ' bytes. Fixed offsets, no parsing ambiguity.');
    hexBlock(box, authData.bytes, authData.segments);
    kv(box, 'rpIdHash', hex(authData.rpIdHash, 0, 8) + ' …', 'pk-mono');
    kv(box, 'signCount', String(authData.signCount), 'pk-mono');
    para(box, authData.signCount === 0
      ? 'A sign count of zero means this authenticator does not keep one — normal for synced ' +
        'passkeys, because a counter cannot be kept consistent across copies. A server should ' +
        'treat zero as "no signal" rather than as a failure.'
      : 'The counter is meant to increase on every use. A server that sees it go backwards is ' +
        'looking at a cloned authenticator, which is the only thing this field is for.');
    flagTable(box, authData.flagsByte);
    para(box, backupNote(authData.flags));
    return box;
  }

  function backupNote(flags) {
    if (flags.be && flags.bs) {
      return 'BE and BS are both set: this is a synced passkey. It lives in an account — an ' +
        'Apple, Google, Microsoft or password-manager account — and it will appear on your next ' +
        'device when you sign in there. Losing the laptop does not lose the credential, and the ' +
        'security of the passkey is now the security of that account.';
    }
    if (flags.be && !flags.bs) {
      return 'BE is set and BS is not: this credential could be backed up and currently is not. ' +
        'It exists in one place. If that place is lost, so is it, and recovery is whatever the ' +
        'site offers instead — which is usually where the real weakness of an account lives.';
    }
    return 'BE is clear: this is device-bound. The private key cannot leave the authenticator, ' +
      'which is the stronger property and the worse recovery story. This is what a hardware ' +
      'security key gives you, and why anyone relying on one is told to enrol a second.';
  }

  function renderCose(box, cose) {
    var info = algInfo(cose['3']);
    kv(box, 'kty (1)', coseKty(cose['1']), 'pk-mono');
    kv(box, 'alg (3)', String(cose['3']) + (info ? '  — ' + info.name : ''), 'pk-mono');
    if (info && info.kind === 'ec') {
      kv(box, 'crv (-1)', String(cose['-1']) + '  — ' + info.curve, 'pk-mono');
      kv(box, 'x (-2)', hex(bytesOf(cose['-2']), 0, 8) + ' …  (' + bytesOf(cose['-2']).length + ' bytes)', 'pk-mono');
      kv(box, 'y (-3)', hex(bytesOf(cose['-3']), 0, 8) + ' …  (' + bytesOf(cose['-3']).length + ' bytes)', 'pk-mono');
      para(box, 'A point on ' + info.curve + '. x and y are the coordinates; together they are ' +
        'the public key, and the private key is the scalar that nobody outside the ' +
        'authenticator has ever seen.');
    } else if (info && info.kind === 'rsa') {
      var modulus = stripLeadingZeros(bytesOf(cose['-1']));
      var exponent = stripLeadingZeros(bytesOf(cose['-2']));
      var e = 0;
      for (var i = 0; i < exponent.length; i++) e = e * 256 + exponent[i];
      kv(box, 'n (-1)', modulus.length * 8 + '-bit modulus', 'pk-mono');
      kv(box, 'e (-2)', String(e), 'pk-mono');
      para(box, 'An RSA key. Security keys that predate the elliptic-curve default still produce ' +
        'these, and they verify the same way. The exponent is almost always 65537.');
    } else {
      kv(box, 'raw fields', (cose.__keys || []).join(', '), 'pk-mono');
    }
    pre(box, 'COSE bytes, base64url:\n' + b64urlEncode(cose.__raw || new Uint8Array(0)));
  }

  function coseKty(value) {
    var names = { '1': 'OKP (Edwards curve)', '2': 'EC2 (elliptic curve)', '3': 'RSA' };
    return String(value) + (names[String(value)] ? '  — ' + names[String(value)] : '');
  }

  /* ---------------------------------------------------------------------
     Assertion
     --------------------------------------------------------------------- */

  function buildGetOptions() {
    var options = {
      challenge: randomBytes(32),
      timeout: 60000,
      rpId: rpId(),
      userVerification: el('tool-uv').value
    };
    if (el('tool-allow').value === 'named') {
      var stored = loadStore(), allow = [];
      for (var i = 0; i < stored.length; i++) {
        var entry = { type: 'public-key', id: b64urlDecode(stored[i].id) };
        if (stored[i].transports && stored[i].transports.length) entry.transports = stored[i].transports;
        allow.push(entry);
      }
      options.allowCredentials = allow;
    }
    return options;
  }

  function signIn() {
    if (!support.ok) { renderUnavailable(); return; }
    var options = buildGetOptions();
    if (options.allowCredentials && !options.allowCredentials.length) {
      resetReport('Nothing to sign in with',
        'This page has no stored credential ID to name.');
      var box = section(reportHost, 'Two ways forward');
      para(box, 'Create a passkey first, and this page will remember its ID and put it in ' +
        'allowCredentials — the non-discoverable flow, where the site has to know who you are ' +
        'before it can ask.');
      para(box, 'Or switch the sign-in mode to “discoverable” and try anyway. If you already ' +
        'have a passkey for this site in a password manager, the authenticator can find it with ' +
        'no hint at all, which is what makes username-less sign-in possible.');
      status('no stored credential', 'is-warn');
      say('No stored credential to sign in with.');
      return;
    }

    status('waiting for the authenticator…', 'is-busy');
    resetReport('Sign-in', 'A fresh challenge, a real signature, and a real verification.');
    var sent = section(reportHost, 'What the page asked for',
      'PublicKeyCredentialRequestOptions, as passed to navigator.credentials.get().');
    pre(sent, JSON.stringify(forDisplay(options), null, 2));
    para(sent, options.allowCredentials
      ? 'allowCredentials names the credential, so the authenticator is being asked for one ' +
        'specific key. This is the non-discoverable flow: the site already knows which account ' +
        'you claim to be.'
      : 'No allowCredentials at all. The authenticator has to find a credential for this RP ID ' +
        'on its own, which only works if the credential is discoverable — stored with its own ' +
        'user handle rather than wrapped inside its ID. This is the flow behind a sign-in button ' +
        'with no username field.');
    say('Waiting for the authenticator.');

    root.navigator.credentials.get({ publicKey: options }).then(function (credential) {
      onAsserted(credential, options);
    }, function (err) {
      onRefused(err, 'sign-in');
    });
  }

  function onAsserted(credential, options) {
    var response = credential.response;
    var clientDataBytes = bytesOf(response.clientDataJSON);
    var authBytes = bytesOf(response.authenticatorData);
    var signature = bytesOf(response.signature);
    var id = b64urlEncode(bytesOf(credential.rawId));

    var clientData = renderClientData(clientDataBytes, 'webauthn.get');

    var authData;
    try {
      authData = parseAuthData(authBytes);
    } catch (err) {
      status('could not decode', 'is-err');
      para(section(reportHost, 'The authenticator data would not decode'),
        (err && err.message) || String(err));
      return;
    }
    var adBox = renderAuthData(authData, 'Sign-in authenticator data');
    para(adBox, 'The AT flag is clear this time. There is no public key in a sign-in response — ' +
      'the site already has it, and sending it again would prove nothing.');

    var sigSec = section(reportHost, 'The signature',
      signature.length + ' bytes, over authenticatorData ‖ SHA-256(clientDataJSON).');
    pre(sigSec, hex(signature, 0, Math.min(signature.length, 96)) +
      (signature.length > 96 ? '\n… ' + (signature.length - 96) + ' more bytes' : ''));

    var stored = findStored(id);
    if (!stored) {
      kv(sigSec, 'verification', 'no stored public key for this credential', 'is-warn');
      para(sigSec, 'The authenticator returned a credential this page has no record of — most ' +
        'likely one created before you last cleared storage, or in the discoverable flow with a ' +
        'passkey from another session. The signature is real; there is simply nothing here to ' +
        'check it against. Create a fresh passkey and sign in with that to see the verification ' +
        'run.');
      status('signed, not verified', 'is-warn');
      say('Sign-in complete, but there is no stored key to verify it against.');
      renderPhishPanel(null);
      return;
    }

    var cose;
    try {
      var coseBytes = b64urlDecode(stored.publicKey);
      cose = readCoseAt(coseBytes, 0).key;
      cose.__raw = coseBytes;
    } catch (err2) {
      kv(sigSec, 'verification', 'the stored public key would not decode', 'is-err');
      status('stored key unreadable', 'is-err');
      return;
    }

    var pending = kv(sigSec, 'verification', 'checking…', 'is-dim');
    verifyAssertion(cose, authBytes, clientDataBytes, signature).then(function (result) {
      pending.lastChild.textContent = result.ok
        ? 'valid — this signature was made by the private key that matches the stored public key'
        : 'INVALID — the signature does not match the stored public key';
      pending.lastChild.className = 'pk-v ' + (result.ok ? 'is-ok' : 'is-err');
      kv(sigSec, 'clientDataHash', hex(result.hash, 0, 16) + ' …', 'pk-mono');
      kv(sigSec, 'signed bytes', result.signed.length + ' bytes', 'pk-mono');
      if (result.rs) {
        kv(sigSec, 'r', hex(result.rs.r, 0, 8) + ' …', 'pk-mono');
        kv(sigSec, 's', hex(result.rs.s, 0, 8) + ' …', 'pk-mono');
        para(sigSec, 'An ECDSA signature is two integers. The authenticator hands them over ' +
          'ASN.1-encoded; Web Crypto wants them as a flat pair, so the page converts. It is the ' +
          'same number in two wrappers, and it is the step most people get wrong the first time ' +
          'they verify a WebAuthn assertion by hand.');
      }
      para(sigSec, 'That verification ran here, in this tab, with the public key out of ' +
        'localStorage. On a real site the same arithmetic happens on a server against a key in a ' +
        'database — plus four checks this page is not in a position to make: that the challenge ' +
        'is the one it just issued and has not been used, that the origin string is exactly its ' +
        'own, that the RP ID hash matches, and that the sign counter has not gone backwards.');

      lastAssertion = {
        clientDataText: utf8Decode(clientDataBytes),
        clientDataBytes: clientDataBytes,
        origin: clientData ? String(clientData.origin) : root.location.origin,
        authBytes: authBytes,
        signature: signature,
        cose: cose,
        ok: result.ok
      };
      renderPhishPanel(lastAssertion);
      status(result.ok ? 'signature verified' : 'signature failed', result.ok ? 'is-ok' : 'is-err');
      say(result.ok ? 'Sign-in complete and the signature verified.'
                    : 'Sign-in complete but the signature did not verify.');
    }, function (err) {
      pending.lastChild.textContent = 'could not be checked: ' + ((err && err.message) || String(err));
      pending.lastChild.className = 'pk-v is-warn';
      para(sigSec, 'The signature is real; this browser would not lend the page the algorithm to ' +
        'check it. Ed25519 keys hit this most often, because Web Crypto support for them is ' +
        'still uneven.');
      status('signed, not verified', 'is-warn');
    });
  }

  function findStored(id) {
    var list = loadStore();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------------------------------------------------------------------
     Refusals — including the interesting one
     --------------------------------------------------------------------- */

  function onRefused(err, phase) {
    var name = (err && err.name) || 'Error';
    var box = section(reportHost, 'The ceremony did not complete', 'The browser reported ' + name + '.');
    if (name === 'NotAllowedError') {
      para(box, 'That covers cancelling the prompt, letting it time out, and several policy ' +
        'refusals, all reported identically on purpose: if the browser distinguished them, a ' +
        'page could probe which passkeys you have by watching which error came back. The ' +
        'ambiguity is the feature.');
      para(box, 'Nothing was created and nothing was sent. Press the button again whenever you ' +
        'like, or read the walkthrough below instead.');
    } else if (name === 'InvalidStateError') {
      para(box, 'This authenticator already holds a passkey for this site, and excludeCredentials ' +
        'told it to refuse a second one. That list is how a site stops you enrolling the same ' +
        'security key twice under two accounts. Sign in with the one you have, or forget the ' +
        'stored record and delete the passkey in your password manager first.');
    } else if (name === 'SecurityError') {
      para(box, 'The browser rejected the RP ID. A page may only claim its own domain or a ' +
        'registrable parent of it — nothing else, ever. This is the first of the two walls that ' +
        'make passkeys unphishable, and it is enforced before any authenticator is contacted.');
    } else if (name === 'NotSupportedError') {
      para(box, 'None of the algorithms offered could be produced by an available authenticator. ' +
        'This page asks for ES256 and RS256, which between them cover essentially everything, so ' +
        'this usually means the attachment filter ruled out the only authenticator present.');
    } else if (name === 'AbortError') {
      para(box, 'The request was aborted, usually because another one started.');
    } else {
      para(box, 'Message: ' + ((err && err.message) || String(err)));
    }
    para(box, 'Nothing left your browser during the attempt — there is no server here to send ' +
      'anything to.');
    status(phase + ' cancelled', 'is-warn');
    say('The ' + phase + ' did not complete: ' + name + '.');
  }

  /* A live demonstration that a page cannot claim someone else's RP ID. The
     call is expected to fail; the failure is the output. */
  function tryForeignRpId() {
    if (!support.ok) { renderUnavailable(); return; }
    var foreign = 'example.com';
    var options = buildCreateOptions();
    options.rp = { name: 'Somebody else entirely', id: foreign };
    resetReport('Claiming an RP ID that is not ours',
      'This call is supposed to fail. Watching it fail is the point.');
    var box = section(reportHost, 'The request');
    para(box, 'Everything is as before except one field: rp.id is “' + foreign + '” while this ' +
      'page is served from “' + rpId() + '”. A phishing site has exactly this problem — it wants ' +
      'a signature scoped to your bank, and it is not your bank.');
    pre(box, JSON.stringify(forDisplay({ rp: options.rp, origin: root.location.origin }), null, 2));
    status('trying a foreign RP ID…', 'is-busy');

    root.navigator.credentials.create({ publicKey: options }).then(function () {
      var wrong = section(reportHost, 'It succeeded, which it should not have');
      para(wrong, 'The browser allowed a page on ' + rpId() + ' to register a credential for ' +
        foreign + '. That would be a serious browser bug, and I would like to hear about it.');
      status('unexpected success', 'is-err');
    }, function (err) {
      var result = section(reportHost, 'Refused, before any authenticator was asked',
        'The browser reported ' + ((err && err.name) || 'an error') + '.');
      para(result, 'Message: ' + ((err && err.message) || String(err)));
      para(result, 'No prompt appeared. No fingerprint was requested. The browser compared the ' +
        'requested RP ID against the origin in the address bar and stopped there, which means a ' +
        'phishing page never even reaches the part where a user could be fooled into approving ' +
        'something.');
      para(result, 'This is why a passkey cannot be handed over by a careless human the way a ' +
        'password or a six-digit code can. The check is not asking you to be careful; it is ' +
        'happening whether you are or not.');
      status('refused, as it must be', 'is-ok');
      say('The browser refused the foreign RP ID.');
    });
  }

  /* ---------------------------------------------------------------------
     The origin-binding demonstration
     --------------------------------------------------------------------- */

  function lookalikes() {
    var host = root.location.hostname;
    var out = [];
    if (host.indexOf('l') >= 0) out.push('https://' + host.replace('l', 'i'));
    if (host.indexOf('m') >= 0) out.push('https://' + host.replace('m', 'rn'));
    out.push('https://' + host + '.secure-login.example');
    out.push('https://' + host.replace(/\./, '-') + '.example');
    out.push('http://' + host);
    out.push('https://' + host + ':8443');
    return out;
  }

  function fillOriginChoices() {
    var select = el('pk-origin');
    if (!select) return;
    var list = lookalikes();
    for (var i = 0; i < list.length; i++) {
      var option = document.createElement('option');
      option.value = list[i];
      option.textContent = list[i];
      select.appendChild(option);
    }
  }

  function renderPhishPanel(assertion) {
    var host = el('pk-phish-out');
    if (!host) return;
    empty(host);
    if (!assertion) {
      host.appendChild(make('p', 'pk-empty',
        'Sign in above first. This panel takes the signature your authenticator actually made ' +
        'and re-checks it against a lookalike origin, so it needs a real signature to work with.'));
      return;
    }
    host.appendChild(make('p', 'pk-empty',
      'Ready. Pick a lookalike origin and press the button — the signature above will be ' +
      'verified a second time, with one field of the client data changed.'));
  }

  function runPhishDemo() {
    var host = el('pk-phish-out');
    if (!host) return;
    if (!lastAssertion) { renderPhishPanel(null); return; }
    var fake = el('pk-origin').value;
    var real = lastAssertion.origin;
    var text = lastAssertion.clientDataText;
    var needle = '"origin":"' + real + '"';
    var at = text.indexOf(needle);
    var faked;
    if (at >= 0) {
      faked = text.slice(0, at) + '"origin":"' + fake + '"' + text.slice(at + needle.length);
    } else {
      // Some browsers space their JSON differently. Fall back to a re-serialise
      // and say so, because "only the origin changed" stops being literally
      // true the moment the whole document is rebuilt.
      var parsed = JSON.parse(text);
      parsed.origin = fake;
      faked = JSON.stringify(parsed);
    }
    var fakedBytes = utf8Encode(faked);

    empty(host);
    var box = make('div', 'pk-phish-result');
    host.appendChild(box);

    var compare = make('div', 'pk-diff');
    var realCol = make('div', 'pk-diff-col');
    realCol.appendChild(make('p', 'pk-diff-h', 'What the browser wrote'));
    realCol.appendChild(make('pre', 'pk-pre', text));
    var fakeCol = make('div', 'pk-diff-col');
    fakeCol.appendChild(make('p', 'pk-diff-h', 'What a lookalike site would need'));
    fakeCol.appendChild(make('pre', 'pk-pre pk-pre-bad', faked));
    compare.appendChild(realCol);
    compare.appendChild(fakeCol);
    box.appendChild(compare);
    if (at < 0) {
      box.appendChild(make('p', 'pk-note',
        'The origin string could not be swapped in place, so the JSON was rebuilt. More than the ' +
        'origin differs on the right, which weakens the demonstration slightly and is worth ' +
        'saying rather than hiding.'));
    }

    var rows = make('div', 'pk-phish-rows');
    box.appendChild(rows);
    var realRow = kv(rows, 'verify against the real client data', 'checking…', 'is-dim');
    var fakeRow = kv(rows, 'verify against the lookalike', 'checking…', 'is-dim');
    var hashRow = kv(rows, 'SHA-256 of each', 'computing…', 'is-dim');

    function set(row, text2, cls) {
      row.lastChild.textContent = text2;
      row.lastChild.className = 'pk-v ' + cls;
    }

    verifyAssertion(lastAssertion.cose, lastAssertion.authBytes,
                    lastAssertion.clientDataBytes, lastAssertion.signature)
      .then(function (good) {
        set(realRow, good.ok ? 'valid' : 'invalid', good.ok ? 'is-ok' : 'is-err');
        return verifyAssertion(lastAssertion.cose, lastAssertion.authBytes,
                               fakedBytes, lastAssertion.signature).then(function (bad) {
          set(fakeRow, bad.ok ? 'valid — which would be a catastrophe' : 'INVALID',
              bad.ok ? 'is-err' : 'is-ok');
          set(hashRow, hex(good.hash, 0, 8) + ' …   vs   ' + hex(bad.hash, 0, 8) + ' …', 'pk-mono');
          explainPhish(box, bad.ok);
          say(bad.ok
            ? 'The lookalike origin verified, which should be impossible.'
            : 'The signature verifies for ' + real + ' and fails for ' + fake +
              '. The comparison is in the panel below the tool.');
        });
      }, function (err) {
        set(realRow, 'could not run: ' + ((err && err.message) || String(err)), 'is-warn');
      });

    var fakeHost = fake.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
    if (fakeHost === rpId()) {
      /* The scheme-downgrade and wrong-port entries keep the hostname, so the
         two RP ID hashes would come out identical — and a panel claiming they
         differ would be lying about the one thing this page is for. The honest
         version is the more interesting one: RP ID is only the host, so this is
         precisely the case the separate origin check exists to catch. */
      box.appendChild(make('p', 'pk-note',
        'This one keeps the hostname, so the rpIdHash inside the authenticator data is ' +
        'unchanged — an RP ID is a host and nothing else, with no scheme and no port. That is ' +
        'exactly why a relying party has to check the origin string as well as the hash: over ' +
        'plain http, or on a different port, the RP ID still matches and only the origin gives ' +
        'it away. The signature above already refused, because the origin is inside the bytes ' +
        'that were signed.'));
      return;
    }
    if (subtle()) {
      Promise.all([sha256(utf8Encode(rpId())), sha256(utf8Encode(fakeHost))]).then(function (both) {
        var wall = make('div', 'pk-phish-rows');
        kv(wall, 'SHA-256("' + rpId() + '")', hex(both[0], 0, 10) + ' …', 'pk-mono');
        kv(wall, 'SHA-256("' + fakeHost + '")', hex(both[1], 0, 10) + ' …', 'pk-mono');
        box.appendChild(wall);
        box.appendChild(make('p', 'pk-note',
          'The first of those is the rpIdHash the authenticator put in the signed authenticator ' +
          'data. The second is what a server on the lookalike domain would compute. They are not ' +
          'the same and cannot be made the same, so even a relying party that forgot to check the ' +
          'origin string still has this to fall over.'));
      });
    }
  }

  function explainPhish(box, badVerified) {
    if (badVerified) {
      box.appendChild(make('p', 'pk-note is-err',
        'The lookalike verification passed, which should be impossible. Something is wrong with ' +
        'this page rather than with passkeys; please tell me what browser you are using.'));
      return;
    }
    box.appendChild(make('p', 'pk-note',
      'One string changed and the signature stopped verifying. The origin is inside the bytes ' +
      'that were signed, so there is no way to reuse this assertion anywhere else — not on a ' +
      'lookalike domain, not on a subdomain the site did not authorise, not over plain http.'));
    box.appendChild(make('p', 'pk-note',
      'And this is the second wall, not the first. To get here I had to take a real assertion and ' +
      'edit it afterwards. A phishing site cannot do that, because it never gets an assertion: ' +
      'the browser scopes credentials by RP ID and will not even offer this passkey to a page on ' +
      'another domain. Press “Try a foreign RP ID” in the toolbar and watch it be refused before ' +
      'any prompt appears.'));
    box.appendChild(make('p', 'pk-note',
      'Compare that with a one-time code. A relay proxy asks you for the six digits, you read ' +
      'them out, and they work — because nothing in the code says which site asked. That is the ' +
      'whole difference, and it is structural rather than a matter of being careful.'));
  }

  /* ---------------------------------------------------------------------
     Wiring
     --------------------------------------------------------------------- */

  function forgetAll() {
    saveStore([]);
    renderStore();
    lastAssertion = null;
    renderPhishPanel(null);
    resetReport('Stored records cleared',
      'The passkeys themselves are untouched.');
    var box = section(reportHost, 'What was removed, and what was not');
    para(box, 'This page has forgotten the credential IDs and public keys it was keeping in ' +
      'localStorage. That is all it ever had.');
    para(box, 'The passkeys still exist wherever your browser or password manager put them, ' +
      'and they will still be offered to this site. Removing them for real means going into ' +
      'that manager — iCloud Keychain, Google Password Manager, 1Password, Windows Hello, or ' +
      'the security key itself — and deleting them there. A site can never delete a passkey; ' +
      'it can only forget the public key and stop accepting it.');
    status('cleared', 'is-ok');
    say('Stored records cleared.');
  }

  function ready() {
    reportHost = el('pk-report');
    announce = el('pk-announce');
    fillOriginChoices();
    renderStore();
    renderPhishPanel(null);
    checkSupport();

    var create = el('tool-create');
    if (create) create.addEventListener('click', register);
    var forget = el('tool-forget');
    if (forget) forget.addEventListener('click', forgetAll);
    var foreign = el('tool-foreign');
    if (foreign) foreign.addEventListener('click', tryForeignRpId);
    var phish = el('pk-phish-run');
    if (phish) phish.addEventListener('click', runPhishDemo);

    if (support.ok) {
      resetReport('Nothing has happened yet',
        'Press “Create a passkey” and this panel fills with the decoded response.');
      var box = section(reportHost, 'What you are about to see');
      para(box, 'Your browser will show a prompt this page cannot see, style or read. If you ' +
        'approve it, an authenticator generates a key pair, keeps the private half somewhere ' +
        'this page has no access to, and returns the public half wrapped in an attestation ' +
        'object.');
      para(box, 'Everything that comes back is decoded here byte by byte: the CBOR, the flags, ' +
        'the AAGUID, the COSE key. Then you sign in with it and the signature is verified in ' +
        'this tab against that key.');
      para(box, 'There is no server. The challenge is generated in this page, the public key is ' +
        'kept in this browser’s localStorage, and nothing is transmitted at any point. That ' +
        'makes this a good place to learn the mechanism and a terrible model for a real login, ' +
        'which the page keeps saying because it keeps being true.');
    }
  }

  LabTool.define({
    id: 'passkeystool',
    run: signIn,
    onReady: ready
  });

  /* Exposed for the console, the same way the other labs do it, so anything on
     screen can be re-derived by hand. */
  root.PasskeyLab = {
    cborRead: cborRead,
    parseAuthData: parseAuthData,
    b64urlEncode: b64urlEncode,
    b64urlDecode: b64urlDecode,
    verifyAssertion: verifyAssertion,
    derToRs: derToRs
  };
})(typeof self !== 'undefined' ? self : this);

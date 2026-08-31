/* ==========================================================================
   tls-handshake.js — a TLS handshake, message by message, with the TLS 1.2
   version running alongside so the difference is visible rather than asserted.
   --------------------------------------------------------------------------
   The site already has /labs/cert-decoder (what is inside the certificate) and
   /labs/ct-log (how the certificate got published). Nothing showed the
   conversation that carries them. This is that.

   Four families over one small model:

     1. The handshake   — every message in order, who sends it, what is in it,
                          and which key it is encrypted under. TLS 1.3 and TLS
                          1.2 as two modes of the same walk. Break it on
                          purpose and read the exact alert that comes back.
     2. ClientHello     — the first message taken apart field by field. Click
                          any extension for its real bytes and what it is for.
     3. Key schedule    — HKDF-Expand-Label, actually computed, over sample
                          inputs you can edit. Not a picture of a ladder.
     4. Round trips     — where the time goes, including 0-RTT and the replay
                          problem it buys the time with.

   Decisions worth spelling out:

   1. THE KEY SCHEDULE IS REAL ARITHMETIC. Every secret in family 3 is
      computed here with HMAC-SHA-256 over the exact bytes shown, following
      RFC 8446 section 7.1. The transcript hashes are genuine SHA-256 digests
      of the handshake messages built in this file. What is NOT real is the
      input: the ECDHE shared secret is a sample value you can edit, the
      certificate body is a short stand-in blob rather than a real DER
      certificate, and the randoms are fixed so the page is reproducible. So
      the ladder is correct and the numbers on it will not match any capture
      you own. Both halves of that matter.

      The server and client Finished messages are the exception worth naming:
      their verify_data really is HMAC(finished_key, transcript hash) over the
      bytes above them, so the one value in the walk that is supposed to prove
      the transcript actually does.

   2. ENCRYPTION STATE IS THE POINT, AND MOST DIAGRAMS GET IT WRONG. The
      common picture shows a lock appearing after "Finished". In TLS 1.3
      everything from EncryptedExtensions onward — the certificate very much
      included — is already encrypted under handshake traffic keys derived
      immediately after ServerHello. Each row carries its own key state, taken
      from the model rather than drawn on, so the two modes cannot disagree
      with themselves.

   3. THE FAILURES SEND REAL ALERT CODES, AND I SAY WHERE THAT IS FUZZY.
      certificate_expired(45) and handshake_failure(40) are unambiguous. The
      alert for a hostname mismatch is not standardised at all — different
      stacks send different codes for it — so the tool says so instead of
      inventing a rule.

   4. SHA-256 comes from HashEngines (assets/js/labs/tools/hash-engines.js),
      the same verified implementation /labs/hash uses. Writing a second one
      here would mean two copies to keep right. If it is missing the key
      schedule says so on the page rather than showing wrong hex.

   Nothing here opens a network connection. There is no TLS client in this
   file — it is a model of the protocol, not an implementation of it, and it
   cannot tell you anything about a real server.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  BYTES                                                                   */
  /* ------------------------------------------------------------------------ */
  /*  Wire structures are built as plain arrays of numbers and only converted  */
  /*  to a Uint8Array at the hashing boundary. Arrays concatenate readably,    */
  /*  and nothing here is big enough for the copying to matter.                */
  /* ======================================================================== */

  function b1(v) { return [v & 255]; }
  function b2(v) { return [(v >>> 8) & 255, v & 255]; }
  function b3(v) { return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }

  function ascii(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
    return out;
  }

  function join(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var part = list[i];
      for (var j = 0; j < part.length; j++) out.push(part[j]);
    }
    return out;
  }

  function zeros(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(0);
    return out;
  }

  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      s += (bytes[i] < 16 ? '0' : '') + (bytes[i] & 255).toString(16);
    }
    return s;
  }

  function hexSpaced(bytes) {
    var out = [];
    for (var i = 0; i < bytes.length; i++) {
      out.push((bytes[i] < 16 ? '0' : '') + (bytes[i] & 255).toString(16));
    }
    return out.join(' ');
  }

  function hexToBytes(text) {
    var clean = String(text || '').replace(/[^0-9a-fA-F]/g, '');
    if (clean.length % 2) clean = clean.slice(0, clean.length - 1);
    var out = [];
    for (var i = 0; i < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
    return out;
  }

  function toU8(a) {
    if (a instanceof Uint8Array) return a;
    var out = new Uint8Array(a.length);
    for (var i = 0; i < a.length; i++) out[i] = a[i] & 255;
    return out;
  }

  /* A field of a wire structure: its name, its bytes, and why it is there.
     Every message below is a list of these and its hex dump is simply their
     concatenation, so the dump can never drift from the breakdown beside it. */
  function F(label, bytes, meaning) {
    return { label: label, bytes: bytes, meaning: meaning };
  }

  function partsBytes(parts) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var b = parts[i].bytes;
      for (var j = 0; j < b.length; j++) out.push(b[j]);
    }
    return out;
  }

  /* ======================================================================== */
  /*  SHA-256, HMAC AND THE TLS 1.3 KEY SCHEDULE                              */
  /* ------------------------------------------------------------------------ */
  /*  HashEngines is the verified SHA-256 that /labs/hash runs on. HMAC and    */
  /*  HKDF are built on top here because they are twelve lines each and        */
  /*  WebCrypto's are async, which would turn every frame of a stepped         */
  /*  visualiser into a promise chain for no gain.                             */
  /* ======================================================================== */

  /* In a browser `root` is window and HashEngines is right there. Under Node —
     where this file is required to cross-check the key schedule against the
     platform's own HMAC — `root` is module.exports, so the global object has to
     be consulted as well. Without this second lookup the schedule is only ever
     testable by hand in a browser console, which is how a hash bug survives. */
  function hashEngines() {
    if (root.HashEngines && root.HashEngines.create) return root.HashEngines;
    if (typeof globalThis !== 'undefined' && globalThis.HashEngines &&
        globalThis.HashEngines.create) return globalThis.HashEngines;
    return null;
  }

  function sha256(bytes) {
    var engines = hashEngines();
    if (!engines) throw new Error('the SHA-256 engine (hash-engines.js) did not load');
    var h = engines.create('sha256');
    h.update(toU8(bytes));
    return hexToBytes(h.digest());
  }

  var HMAC_BLOCK = 64;

  function hmacSha256(key, data) {
    var k = key.length > HMAC_BLOCK ? sha256(key) : key.slice(0);
    while (k.length < HMAC_BLOCK) k.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < HMAC_BLOCK; i++) {
      ipad.push(k[i] ^ 0x36);
      opad.push(k[i] ^ 0x5c);
    }
    return sha256(join([opad, sha256(join([ipad, data]))]));
  }

  function hkdfExtract(salt, ikm) { return hmacSha256(salt, ikm); }

  /* HKDF-Expand for one block only. Every output in the TLS 1.3 schedule is at
     most 32 bytes with SHA-256, so the counter never reaches 2 and pretending
     otherwise would be untested code on a page about being exact. */
  function hkdfExpandOne(prk, info, length) {
    if (length > 32) throw new Error('this lab only expands one HMAC block');
    return hmacSha256(prk, join([info, [1]])).slice(0, length);
  }

  /* HKDF-Expand-Label, RFC 8446 section 7.1:
       struct { uint16 length; opaque label<7..255>; opaque context<0..255>; }
     with every label prefixed "tls13 ". The prefix is domain separation — it
     is what stops a value derived for TLS being usable as one derived for
     QUIC or DTLS from the same secret. */
  function expandLabel(secret, label, context, length) {
    var full = 'tls13 ' + label;
    var info = join([b2(length), b1(full.length), ascii(full),
                     b1(context.length), context]);
    return { info: info, out: hkdfExpandOne(secret, info, length), label: full };
  }

  function deriveSecret(secret, label, transcriptHash) {
    return expandLabel(secret, label, transcriptHash, 32);
  }

  /* ======================================================================== */
  /*  CLIENTHELLO, FIELD BY FIELD                                             */
  /* ------------------------------------------------------------------------ */
  /*  Built rather than hard-coded, so the SNI the visitor types really does   */
  /*  change the bytes and the lengths around it. Everything else is a fixed   */
  /*  sample: the randoms and public keys are constants so the page is         */
  /*  reproducible, and they are labelled as samples wherever they appear.     */
  /* ======================================================================== */

  var SAMPLE_CLIENT_RANDOM = hexToBytes(
    'e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff');
  var SAMPLE_SESSION_ID = hexToBytes(
    '2f2e2d2c2b2a292827262524232221201f1e1d1c1b1a19181716151413121110');
  var SAMPLE_CLIENT_KEY = hexToBytes(
    '358072d6365880d1aeea329adf9121383851ed21a28e3b75e965d0d2cd166254');
  var SAMPLE_SERVER_RANDOM = hexToBytes(
    'a6af06a4121860dc5e6e60249cd34c95930c8ac5cb1434dac155772ed3e2692c');
  var SAMPLE_SERVER_KEY = hexToBytes(
    '9fd7ad6dcff4298dd3f96d5b1b2af910a0535b1488d7f8fabb349a982880b615');

  var SUITES_13 = [
    [0x1301, 'TLS_AES_128_GCM_SHA256'],
    [0x1302, 'TLS_AES_256_GCM_SHA384'],
    [0x1303, 'TLS_CHACHA20_POLY1305_SHA256']
  ];
  var SUITES_12 = [
    [0xc02b, 'ECDHE_ECDSA_WITH_AES_128_GCM_SHA256'],
    [0xc02f, 'ECDHE_RSA_WITH_AES_128_GCM_SHA256'],
    [0xc030, 'ECDHE_RSA_WITH_AES_256_GCM_SHA384']
  ];

  function suiteBytes(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out = out.concat(b2(list[i][0]));
    return out;
  }

  function suiteNames(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i][1]);
    return out.join(', ');
  }

  function ext(code, name, bodyParts, info) {
    var body = partsBytes(bodyParts);
    var parts = [
      F('extension_type', b2(code), name + ' (' + code + ')'),
      F('extension_data length', b2(body.length), body.length + ' bytes of body follow')
    ].concat(bodyParts);
    return {
      key: 'ext' + code,
      kind: 'extension',
      code: code,
      name: name,
      parts: parts,
      bytes: partsBytes(parts),
      summary: info.summary,
      purpose: info.purpose,
      privacy: info.privacy || null
    };
  }

  function extServerName(host) {
    var h = ascii(host);
    return ext(0, 'server_name', [
      F('server_name_list length', b2(h.length + 3), 'one entry'),
      F('name_type', [0], 'host_name(0) — the only type ever defined'),
      F('host_name length', b2(h.length), h.length + ' bytes'),
      F('host_name', h, host)
    ], {
      summary: 'Which site you are asking for — in the clear',
      purpose: 'One IP address serves thousands of sites, so the server has to be told which ' +
        'certificate to present before it can present one. That is the whole job of SNI, and it ' +
        'is a genuine chicken-and-egg problem: the name has to travel before there is any key to ' +
        'protect it with.',
      privacy: 'This is the single most consequential field on the page. It is plaintext in every ' +
        'ordinary TLS handshake, 1.3 included, so your ISP, your employer’s proxy, a hotel ' +
        'network and a national filter all read the name of every site you visit even though they ' +
        'cannot read a byte of the traffic. Domain-level blocking is built on exactly this field. ' +
        'Encrypted Client Hello is the fix: the real ClientHello, SNI and all, is encrypted to a ' +
        'public key published in DNS and carried inside an outer ClientHello that names a shared ' +
        'front-end instead. It needs the server, the DNS record and the browser all to support it, ' +
        'which is why it is still not the default.'
    });
  }

  function extSupportedVersions() {
    return ext(43, 'supported_versions', [
      F('versions length', [4], 'two versions'),
      F('TLS 1.3', b2(0x0304), 'the one this client actually wants'),
      F('TLS 1.2', b2(0x0303), 'kept so a 1.2-only server still works')
    ], {
      summary: 'The real version negotiation in TLS 1.3',
      purpose: 'legacy_version at the top of the message is frozen at 0x0303 forever. Middleboxes ' +
        'in the field dropped handshakes whose version number they did not recognise, so TLS 1.3 ' +
        'moved the actual negotiation into this extension and left the old field lying. The version ' +
        'a modern connection runs at is decided here and nowhere else.'
    });
  }

  function extKeyShare() {
    return ext(51, 'key_share', [
      F('client_shares length', b2(36), 'one entry: group, length, key'),
      F('group', b2(0x001d), 'x25519 (0x001d)'),
      F('key_exchange length', b2(32), '32 bytes'),
      F('key_exchange', SAMPLE_CLIENT_KEY, 'a fresh X25519 public key — sample value')
    ], {
      summary: 'A public key sent before the server has said anything',
      purpose: 'This is the extension that removes a round trip. The client guesses which group the ' +
        'server will choose and sends a public key for it in the very first message, so the server ' +
        'can reply with its own share and both sides have a shared secret after one flight each. ' +
        'The private half never leaves the machine, and a new pair is generated per connection, ' +
        'which is what forward secrecy actually means here: recovering the server’s long-term ' +
        'key later does not decrypt this session, because that key only signed, it never encrypted.',
      privacy: 'If the guess is wrong the server answers HelloRetryRequest naming a group it does ' +
        'support, the client sends a second ClientHello, and the handshake costs two round trips ' +
        'after all — TLS 1.2 speed, from a 1.3 connection.'
    });
  }

  function extSupportedGroups() {
    return ext(10, 'supported_groups', [
      F('groups length', b2(8), 'four groups'),
      F('x25519', b2(0x001d), 'the usual first choice'),
      F('secp256r1', b2(0x0017), 'NIST P-256'),
      F('secp384r1', b2(0x0018), 'NIST P-384'),
      F('x448', b2(0x001e), 'a larger curve, rarely selected')
    ], {
      summary: 'Every curve the client would accept, not just the one it guessed',
      purpose: 'key_share carries a guess; this carries the full list. The server picks from here ' +
        'when the guess was wrong, which is what lets HelloRetryRequest name a group the client can ' +
        'actually use rather than failing outright.'
    });
  }

  function extSignatureAlgorithms() {
    return ext(13, 'signature_algorithms', [
      F('list length', b2(12), 'six entries'),
      F('ecdsa_secp256r1_sha256', b2(0x0403), 'ECDSA on P-256'),
      F('ecdsa_secp384r1_sha384', b2(0x0503), 'ECDSA on P-384'),
      F('rsa_pss_rsae_sha256', b2(0x0804), 'RSA-PSS, the required scheme in 1.3'),
      F('rsa_pss_rsae_sha384', b2(0x0805), 'RSA-PSS, larger digest'),
      F('rsa_pss_rsae_sha512', b2(0x0806), 'RSA-PSS, larger digest'),
      F('rsa_pkcs1_sha256', b2(0x0401), 'legacy PKCS#1 v1.5 — certificates only in 1.3')
    ], {
      summary: 'Which signatures the client can verify',
      purpose: 'The server needs this before it chooses a certificate, because a certificate signed ' +
        'with something the client cannot verify is worse than no certificate. In TLS 1.3 it also ' +
        'constrains CertificateVerify. RSA PKCS#1 v1.5 is permitted for signatures inside ' +
        'certificates and forbidden for the handshake signature itself, which is a small detail with ' +
        'a long history behind it.'
    });
  }

  function extAlpn() {
    return ext(16, 'application_layer_protocol_negotiation', [
      F('protocol list length', b2(12), 'two protocols'),
      F('length', [2], '2 bytes'),
      F('h2', ascii('h2'), 'HTTP/2'),
      F('length', [8], '8 bytes'),
      F('http/1.1', ascii('http/1.1'), 'HTTP/1.1')
    ], {
      summary: 'Which protocol will run inside the tunnel',
      purpose: 'Without ALPN the client would have to open the connection, guess, and retry. It is ' +
        'also how HTTP/2 gets negotiated without an upgrade dance.',
      privacy: 'The offer is plaintext; the answer is not. In TLS 1.3 the server’s selection ' +
        'comes back inside EncryptedExtensions, so an observer sees what you were willing to speak ' +
        'and not what you settled on.'
    });
  }

  function extSct() {
    return ext(18, 'signed_certificate_timestamp', [], {
      summary: 'Empty — it is a request, not a value',
      purpose: 'An empty extension asking the server to include Certificate Transparency proofs. ' +
        'The server answers with SCTs either stapled here, embedded in the certificate itself, or ' +
        'delivered in the OCSP response. Chrome refuses a public certificate that arrives with ' +
        'none. The /labs/ct-log tool is the other half of this story.'
    });
  }

  function extPskModes() {
    return ext(45, 'psk_key_exchange_modes', [
      F('modes length', [1], 'one mode'),
      F('psk_dhe_ke', [1], 'resume, but still do a fresh key exchange')
    ], {
      summary: 'Resumption with fresh key material, or without it',
      purpose: 'psk_ke resumes from the ticket alone and gives up forward secrecy for the session. ' +
        'psk_dhe_ke resumes and does an ECDHE exchange anyway, so a compromised ticket does not ' +
        'retrospectively open the traffic. Everything sensible offers only the second, which is why ' +
        'this list usually has exactly one entry.'
    });
  }

  function extEarlyData() {
    return ext(42, 'early_data', [], {
      summary: 'Empty — present only when the client is sending 0-RTT data',
      purpose: 'Its presence is the whole message: this ClientHello is followed immediately by ' +
        'application data encrypted under a key derived from the resumption secret, before the ' +
        'server has said a word.',
      privacy: 'Early data has no forward secrecy — it is protected by the ticket’s secret, not ' +
        'by a fresh exchange — and it is replayable. See the round-trips tab for what that costs.'
    });
  }

  function extPreSharedKey() {
    return ext(41, 'pre_shared_key', [
      F('identities length', b2(14), 'one identity'),
      F('identity length', b2(8), '8 bytes'),
      F('identity', hexToBytes('c0ffee0102030405'), 'the ticket the server issued last time — sample'),
      F('obfuscated_ticket_age', hexToBytes('0000ea60'), 'age in ms plus the ticket’s own offset'),
      F('binders length', b2(33), 'one binder'),
      F('binder length', [32], '32 bytes'),
      F('binder', hexToBytes('112233445566778899aabbccddeeff00' +
        '112233445566778899aabbccddeeff00'),
        'HMAC over this ClientHello up to here — sample')
    ], {
      summary: 'The resumption ticket, and proof the client holds its secret',
      purpose: 'This extension must be the last one in the message, and the reason is structural: ' +
        'the binder is an HMAC over the whole ClientHello up to the point where the binder itself ' +
        'begins. Anything after it could not be covered. Without the binder a ticket would be a ' +
        'bearer token that anyone who saw it could replay.'
    });
  }

  function extEch() {
    /* Truncated on purpose: a real ECH payload is the whole inner ClientHello,
       encrypted and padded to a fixed size, and pasting a kilobyte of sample
       ciphertext into the dump would teach nothing. The length field is
       computed from what is actually here so the structure still adds up. */
    var payload = hexToBytes('6f70617175652d696e6e65722d68656c6c6f');
    return ext(0xfe0d, 'encrypted_client_hello', [
      F('type', [0], 'outer(0) — this is the wrapper, not the real hello'),
      F('kdf_id', b2(0x0001), 'HKDF-SHA256'),
      F('aead_id', b2(0x0001), 'AES-128-GCM'),
      F('config_id', [0x2a], 'which published key this was sealed to'),
      F('enc length', b2(32), '32 bytes'),
      F('enc', SAMPLE_CLIENT_KEY, 'the HPKE encapsulated key — sample'),
      F('payload length', b2(payload.length), 'truncated here — a real one is padded to a fixed size'),
      F('payload', payload, 'the real ClientHello, encrypted — sample stand-in')
    ], {
      summary: 'The fix for SNI, when everything on the path supports it',
      purpose: 'Encrypted Client Hello seals the entire real ClientHello — SNI, ALPN offer and all ' +
        '— to a public key the server publishes in DNS as an HTTPS resource record, and carries it ' +
        'inside an outer ClientHello that names a shared front-end name instead. An observer learns ' +
        'that you contacted the front-end and nothing about which site behind it you wanted.',
      privacy: 'It is not magic and it is not universal. It needs the server, the browser and a DNS ' +
        'lookup that itself does not leak the name — so it is usually paired with DNS over HTTPS. ' +
        'The real payload is padded to a fixed size, because a length is a fingerprint. This lab ' +
        'shows it as an extension you can switch on; the bytes are illustrative and the payload is ' +
        'truncated so the dump stays readable.'
    });
  }

  function extEms() {
    return ext(23, 'extended_master_secret', [], {
      summary: 'Empty — a patch for a TLS 1.2 flaw',
      purpose: 'Without it, TLS 1.2 derives the master secret from the two randoms alone, which let ' +
        'the triple-handshake attack splice two connections together. This extension binds the ' +
        'master secret to the full handshake transcript instead. TLS 1.3 does that unconditionally, ' +
        'so the extension does not exist there.'
    });
  }

  function extSessionTicket() {
    return ext(35, 'session_ticket', [], {
      summary: 'Empty — the TLS 1.2 way to resume',
      purpose: 'RFC 5077 tickets. TLS 1.3 replaced this entirely with pre_shared_key and ' +
        'NewSessionTicket, which is why a 1.3 ClientHello does not carry it.'
    });
  }

  function extPointFormats() {
    return ext(11, 'ec_point_formats', [
      F('formats length', [1], 'one format'),
      F('uncompressed', [0], 'the only one anybody implements')
    ], {
      summary: 'A vestigial TLS 1.2 extension',
      purpose: 'Point compression was never widely deployed and TLS 1.3 dropped the extension ' +
        'outright. It is here because a 1.2 ClientHello in the wild still carries it, and knowing ' +
        'which fields are archaeology is part of reading a capture.'
    });
  }

  function extRenegotiationInfo() {
    return ext(65281, 'renegotiation_info', [
      F('renegotiated_connection length', [0], 'empty — this is a new connection')
    ], {
      summary: 'A marker saying "I have been patched"',
      purpose: 'CVE-2009-3555 let an attacker prefix data to a renegotiated TLS 1.2 session. The ' +
        'fix binds a renegotiation to the connection it renegotiates, and this extension advertises ' +
        'that the client implements it. TLS 1.3 removed renegotiation from the protocol, which is ' +
        'the more thorough fix.'
    });
  }

  /* Build a full ClientHello and return it as a list of display blocks whose
     bytes, concatenated in order, are the message. Lengths are computed from
     the real content, so typing a longer server name really does move every
     length field above it. */
  function buildClientHello(opts) {
    var host = opts.host || 'example.com';
    var tls13 = opts.mode !== 'tls12';
    var exts = [];

    exts.push(extServerName(host));
    if (tls13 && opts.ech) exts.push(extEch());
    exts.push(extSupportedGroups());
    if (!tls13) exts.push(extPointFormats());
    exts.push(extSignatureAlgorithms());
    exts.push(extAlpn());
    exts.push(extSct());
    if (tls13) {
      exts.push(extSupportedVersions());
      exts.push(extPskModes());
      exts.push(extKeyShare());
      if (opts.earlyData) {
        exts.push(extEarlyData());
        exts.push(extPreSharedKey());
      }
    } else {
      exts.push(extEms());
      exts.push(extSessionTicket());
      exts.push(extRenegotiationInfo());
    }

    var extBytes = [];
    for (var i = 0; i < exts.length; i++) extBytes = extBytes.concat(exts[i].bytes);

    var suites = tls13 ? SUITES_13.concat(SUITES_12) : SUITES_12;
    var suiteBody = suiteBytes(suites);

    var bodyBlocks = [
      {
        key: 'legacy_version', kind: 'field', name: 'legacy_version',
        parts: [F('legacy_version', b2(0x0303), 'TLS 1.2 (0x0303)')],
        summary: 'Frozen at TLS 1.2, whatever version this really is',
        purpose: 'A 1.3 ClientHello says 1.2 here and always will. Bumping the number broke real ' +
          'middleboxes in the field, so the field was abandoned in place and the true version moved ' +
          'into the supported_versions extension. If you read one field of a capture and conclude ' +
          'the connection is TLS 1.2, this is the field that lied to you.'
      },
      {
        key: 'random', kind: 'field', name: 'random',
        parts: [F('random', SAMPLE_CLIENT_RANDOM, '32 bytes from the client — sample value')],
        summary: '32 fresh random bytes',
        purpose: 'Freshness. It goes into the transcript hash, so it makes every handshake — and ' +
          'therefore every derived key — unique even between two identical connections. In TLS 1.2 ' +
          'the first four bytes used to be a timestamp, which leaked clock skew and is now random ' +
          'like the rest.'
      },
      {
        key: 'session_id', kind: 'field', name: 'legacy_session_id',
        parts: [
          F('session_id length', [32], '32 bytes'),
          F('session_id', SAMPLE_SESSION_ID, 'a random value with no meaning in TLS 1.3')
        ],
        summary: 'Theatre, kept so middleboxes stay calm',
        purpose: 'TLS 1.3 has no session IDs. The client sends a random 32-byte value anyway and ' +
          'the server echoes it, purely so the exchange looks like a resumed TLS 1.2 session to ' +
          'equipment on the path that would otherwise interfere. It is called compatibility mode ' +
          'and it is the same reason a meaningless ChangeCipherSpec record still appears.'
      },
      {
        key: 'cipher_suites', kind: 'field', name: 'cipher_suites',
        parts: [F('cipher_suites length', b2(suiteBody.length), suites.length + ' suites')]
          .concat((function () {
            var out = [];
            for (var n = 0; n < suites.length; n++) {
              out.push(F(suites[n][1], b2(suites[n][0]),
                (suites[n][0] < 0x1400 ? 'TLS 1.3 suite' : 'TLS 1.2 suite')));
            }
            return out;
          })()),
        summary: 'What the client is willing to encrypt with, best first',
        purpose: 'A TLS 1.3 suite names only the AEAD and the hash — TLS_AES_128_GCM_SHA256 and ' +
          'nothing else — because key exchange and authentication moved into extensions. A TLS 1.2 ' +
          'suite names all four, which is why the old names are so long and why there were hundreds ' +
          'of them, including a great many nobody should ever have negotiated. The list is in ' +
          'preference order but the server chooses, and a sane server has its own order.'
      },
      {
        key: 'compression', kind: 'field', name: 'compression_methods',
        parts: [
          F('methods length', [1], 'one method'),
          F('null', [0], 'no compression (0)')
        ],
        summary: 'One option, and it is off',
        purpose: 'TLS compression is where CRIME came from: compressing attacker-influenced data ' +
          'together with a secret leaks the secret through the length. TLS 1.3 removed compression ' +
          'from the protocol and this field exists only so the structure still parses.'
      },
      {
        key: 'extensions_len', kind: 'field', name: 'extensions length',
        parts: [F('extensions length', b2(extBytes.length), extBytes.length + ' bytes of extensions')],
        summary: 'How much of this message is extensions',
        purpose: 'In a modern ClientHello nearly all of it. Everything that makes TLS 1.3 work — the ' +
          'version, the key share, the server name, the protocol — lives past this length field, in ' +
          'structures that did not exist when the message was designed.'
      }
    ];

    var bodyAfterHeader = [];
    for (var k = 0; k < bodyBlocks.length; k++) {
      bodyBlocks[k].bytes = partsBytes(bodyBlocks[k].parts);
      bodyAfterHeader = bodyAfterHeader.concat(bodyBlocks[k].bytes);
    }
    bodyAfterHeader = bodyAfterHeader.concat(extBytes);

    var handshakeHeader = {
      key: 'hs_header', kind: 'field', name: 'handshake header',
      parts: [
        F('msg_type', [1], 'client_hello(1)'),
        F('length', b3(bodyAfterHeader.length), bodyAfterHeader.length + ' bytes')
      ],
      summary: 'Four bytes that every handshake message starts with',
      purpose: 'One type byte and a 24-bit length. The transcript hash that the whole key schedule ' +
        'depends on is taken over these handshake messages — type byte, length and body — and not ' +
        'over the record headers around them, which is a distinction worth getting right before you ' +
        'try to reproduce a key schedule by hand.'
    };
    handshakeHeader.bytes = partsBytes(handshakeHeader.parts);

    var message = handshakeHeader.bytes.concat(bodyAfterHeader);

    var recordHeader = {
      key: 'record', kind: 'field', name: 'record header',
      parts: [
        F('content_type', [22], 'handshake(22)'),
        F('legacy_record_version', b2(0x0301), 'TLS 1.0 (0x0301) — another frozen field'),
        F('length', b2(message.length), message.length + ' bytes')
      ],
      summary: 'The five bytes underneath everything',
      purpose: 'Every TLS record has this header, and it is never encrypted — it cannot be, since ' +
        'the receiver needs the length to know where the record ends. That is why traffic analysis ' +
        'works on TLS at all: sizes and timings are visible even when content is not. The version ' +
        'here says TLS 1.0 for the same middlebox reasons as legacy_version.'
    };
    recordHeader.bytes = partsBytes(recordHeader.parts);

    return {
      blocks: [recordHeader, handshakeHeader].concat(bodyBlocks).concat(exts),
      message: message,
      record: recordHeader.bytes.concat(message),
      host: host,
      suites: suiteNames(suites)
    };
  }

  /* ======================================================================== */
  /*  SAMPLE HANDSHAKE MESSAGES FOR THE KEY SCHEDULE                          */
  /* ------------------------------------------------------------------------ */
  /*  Structurally shaped like the real thing, deliberately short, and clearly */
  /*  labelled as samples wherever they surface. The transcript hashes below   */
  /*  are genuine SHA-256 digests of exactly these bytes — so the schedule is  */
  /*  arithmetic you can reproduce, over inputs that are not from any real     */
  /*  connection.                                                              */
  /* ======================================================================== */

  function handshakeMsg(type, body) {
    return [type].concat(b3(body.length)).concat(body);
  }

  function sampleServerHello() {
    var exts = join([
      b2(43), b2(2), b2(0x0304),
      b2(51), b2(36), b2(0x001d), b2(32), SAMPLE_SERVER_KEY
    ]);
    return handshakeMsg(2, join([
      b2(0x0303), SAMPLE_SERVER_RANDOM,
      [32], SAMPLE_SESSION_ID,
      b2(0x1301), [0],
      b2(exts.length), exts
    ]));
  }

  function sampleEncryptedExtensions() {
    var alpn = join([b2(16), b2(5), b2(3), [2], ascii('h2')]);
    return handshakeMsg(8, join([b2(alpn.length), alpn]));
  }

  function sampleCertificate() {
    /* A stand-in, not a certificate. A real chain is one to three kilobytes of
       DER and would drown the hex dump without teaching anything the
       /labs/cert-decoder tool does not teach better. */
    var der = hexToBytes('308201' + '0a02820101' + 'aabbccddeeff00112233445566778899');
    var entry = join([b3(der.length), der, b2(0)]);
    return handshakeMsg(11, join([[0], b3(entry.length), entry]));
  }

  function sampleCertificateVerify() {
    var sig = hexToBytes('5c3f1b7d9a04e6820cf3d1a7b58e94620d3f7ac1b8e50294d6fa3b17c48e0d95');
    return handshakeMsg(15, join([b2(0x0804), b2(sig.length), sig]));
  }

  /* ======================================================================== */
  /*  THE KEY SCHEDULE                                                        */
  /* ------------------------------------------------------------------------ */
  /*  RFC 8446 section 7.1, computed rather than drawn. Every step records the */
  /*  formula, the inputs it consumed and the bytes it produced, so the panel  */
  /*  cannot describe one derivation and show another.                         */
  /* ======================================================================== */

  var AEADS = {
    aes128: { label: 'TLS_AES_128_GCM_SHA256', keyLen: 16, ivLen: 12,
      note: 'AES-128-GCM: a 16-byte key and a 12-byte IV per direction.' },
    chacha: { label: 'TLS_CHACHA20_POLY1305_SHA256', keyLen: 32, ivLen: 12,
      note: 'ChaCha20-Poly1305: a 32-byte key and a 12-byte IV per direction. Usually the faster ' +
        'choice on a phone, where AES has no hardware instruction.' }
  };

  function keySchedule(opts) {
    var aead = AEADS[opts.aead] || AEADS.aes128;
    var dhe = opts.shared && opts.shared.length ? opts.shared : zeros(32);
    var psk = opts.mode === 'psk' && opts.psk && opts.psk.length ? opts.psk : zeros(32);
    var resuming = opts.mode === 'psk';

    var ch = buildClientHello({ host: opts.host || 'example.com', mode: 'tls13' }).message;
    var sh = sampleServerHello();
    var ee = sampleEncryptedExtensions();
    var cert = sampleCertificate();
    var cv = sampleCertificateVerify();

    var emptyHash = sha256([]);
    var thCh = sha256(ch);
    var thChSh = sha256(join([ch, sh]));
    var thToCv = sha256(join([ch, sh, ee, cert, cv]));

    var steps = [];
    function step(spec) { steps.push(spec); return spec; }

    /* --- early secret --- */
    var early = hkdfExtract(zeros(32), psk);
    step({
      name: 'Early Secret',
      formula: 'HKDF-Extract(salt = 32 zero bytes, IKM = ' + (resuming ? 'the resumption PSK' : '32 zero bytes, since there is no PSK') + ')',
      inputs: [['salt', zeros(32)], ['IKM', psk]],
      out: early,
      why: 'Extract is HMAC with the salt as the key. It takes input that may not be uniformly ' +
        'random — a Diffie-Hellman output, a ticket secret — and concentrates whatever entropy it ' +
        'has into a fixed-width pseudorandom key. With no PSK the input is zeros, and the Early ' +
        'Secret is a fixed constant that carries no secrecy at all. That is fine: it exists to keep ' +
        'the ladder the same shape whether or not you are resuming.'
    });

    if (resuming) {
      var binderKey = deriveSecret(early, 'res binder', emptyHash);
      step({
        name: 'binder_key',
        formula: 'Derive-Secret(Early Secret, "res binder", "")',
        info: binderKey.info,
        inputs: [['secret', early], ['transcript hash of ""', emptyHash]],
        out: binderKey.out,
        why: 'The key the PSK binder in the ClientHello is HMAC’d with. It proves the client ' +
          'holds the ticket’s secret and binds the ticket to this specific ClientHello, so a ' +
          'captured ticket cannot simply be pasted into someone else’s handshake.'
      });
      var earlyTraffic = deriveSecret(early, 'c e traffic', thCh);
      step({
        name: 'client_early_traffic_secret',
        formula: 'Derive-Secret(Early Secret, "c e traffic", ClientHello)',
        info: earlyTraffic.info,
        inputs: [['secret', early], ['transcript hash', thCh]],
        out: earlyTraffic.out,
        why: 'This is the 0-RTT key, and its whole ancestry is the PSK. No fresh Diffie-Hellman has ' +
          'happened yet, so early data has no forward secrecy: an attacker who later obtains the ' +
          'resumption secret can decrypt it. Everything after the handshake completes is a ' +
          'different story.'
      });
      var earlyKey = expandLabel(earlyTraffic.out, 'key', [], aead.keyLen);
      step({
        name: 'early data write_key',
        formula: 'HKDF-Expand-Label(client_early_traffic_secret, "key", "", ' + aead.keyLen + ')',
        info: earlyKey.info,
        inputs: [['secret', earlyTraffic.out]],
        out: earlyKey.out,
        why: 'The actual AEAD key the 0-RTT records are encrypted with. ' + aead.note
      });
    }

    var derived1 = deriveSecret(early, 'derived', emptyHash);
    step({
      name: 'derived (for the handshake stage)',
      formula: 'Derive-Secret(Early Secret, "derived", "")',
      info: derived1.info,
      inputs: [['secret', early], ['transcript hash of ""', emptyHash]],
      out: derived1.out,
      why: 'A stage separator. Feeding the previous secret through Expand-Label before using it as ' +
        'the salt of the next Extract means each stage is cryptographically distinct even when the ' +
        'inputs repeat. The context is the hash of the empty string, which is why ' +
        'e3b0c442… shows up in every TLS 1.3 trace you will ever read.'
    });

    var handshake = hkdfExtract(derived1.out, dhe);
    step({
      name: 'Handshake Secret',
      formula: 'HKDF-Extract(salt = derived, IKM = the ECDHE shared secret)',
      inputs: [['salt', derived1.out], ['IKM (X25519 output)', dhe]],
      out: handshake,
      why: 'Here is where the fresh key exchange enters the ladder. The ECDHE shared secret is the ' +
        'output of X25519 over the two key_share values — the same 32 bytes on both sides, never ' +
        'transmitted, computed independently. It is a sample value on this page and you can edit it: ' +
        'change one nibble and every line below changes completely, which is the avalanche property ' +
        'the whole construction rests on.'
    });

    var cHs = deriveSecret(handshake, 'c hs traffic', thChSh);
    step({
      name: 'client_handshake_traffic_secret',
      formula: 'Derive-Secret(Handshake Secret, "c hs traffic", ClientHello..ServerHello)',
      info: cHs.info,
      inputs: [['secret', handshake], ['transcript hash', thChSh]],
      out: cHs.out,
      why: 'Note the transcript: everything up to and including ServerHello. Both sides can compute ' +
        'this the moment ServerHello lands, which is precisely why every handshake message after it ' +
        'is encrypted.'
    });

    var sHs = deriveSecret(handshake, 's hs traffic', thChSh);
    step({
      name: 'server_handshake_traffic_secret',
      formula: 'Derive-Secret(Handshake Secret, "s hs traffic", ClientHello..ServerHello)',
      info: sHs.info,
      inputs: [['secret', handshake], ['transcript hash', thChSh]],
      out: sHs.out,
      why: 'The mirror of the line above, with a different label so the two directions never share ' +
        'a key. Separate keys per direction means a reflected record cannot be replayed back at the ' +
        'sender and still authenticate.'
    });

    var sHsKey = expandLabel(sHs.out, 'key', [], aead.keyLen);
    step({
      name: 'server handshake write_key',
      formula: 'HKDF-Expand-Label(server_handshake_traffic_secret, "key", "", ' + aead.keyLen + ')',
      info: sHsKey.info,
      inputs: [['secret', sHs.out]],
      out: sHsKey.out,
      why: 'The key that encrypts EncryptedExtensions, Certificate, CertificateVerify and the ' +
        'server’s Finished. ' + aead.note
    });

    var sHsIv = expandLabel(sHs.out, 'iv', [], aead.ivLen);
    step({
      name: 'server handshake write_iv',
      formula: 'HKDF-Expand-Label(server_handshake_traffic_secret, "iv", "", ' + aead.ivLen + ')',
      info: sHsIv.info,
      inputs: [['secret', sHs.out]],
      out: sHsIv.out,
      why: 'The per-record nonce is this IV exclusive-ORed with the record sequence number, which is ' +
        'never transmitted — both sides just count. TLS 1.3 has no explicit nonce on the wire and no ' +
        'way to reuse one by accident, which was a real and exploited failure mode in earlier ' +
        'constructions.'
    });

    var finKey = expandLabel(sHs.out, 'finished', [], 32);
    var verifyData = hmacSha256(finKey.out, thToCv);
    step({
      name: 'server finished_key, and the Finished it produces',
      formula: 'HKDF-Expand-Label(server_handshake_traffic_secret, "finished", "", 32)\n' +
        'verify_data = HMAC(finished_key, Transcript-Hash(ClientHello..CertificateVerify))',
      info: finKey.info,
      inputs: [['finished_key', finKey.out], ['transcript hash', thToCv]],
      out: verifyData,
      why: 'This one is not a sample. The verify_data above is a genuine HMAC over the genuine ' +
        'SHA-256 of the sample handshake messages in this lab, so the value that is supposed to ' +
        'prove the transcript actually does. If anything earlier in the handshake had been altered ' +
        'in flight, this HMAC would not match and the connection would abort — that is the whole ' +
        'mechanism, and it is why a downgrade cannot be smuggled through unnoticed.'
    });

    var sf = handshakeMsg(20, verifyData);
    var thToSf = sha256(join([ch, sh, ee, cert, cv, sf]));

    var derived2 = deriveSecret(handshake, 'derived', emptyHash);
    step({
      name: 'derived (for the application stage)',
      formula: 'Derive-Secret(Handshake Secret, "derived", "")',
      info: derived2.info,
      inputs: [['secret', handshake], ['transcript hash of ""', emptyHash]],
      out: derived2.out,
      why: 'The same separator move again, one stage further along.'
    });

    var master = hkdfExtract(derived2.out, zeros(32));
    step({
      name: 'Master Secret',
      formula: 'HKDF-Extract(salt = derived, IKM = 32 zero bytes)',
      inputs: [['salt', derived2.out], ['IKM', zeros(32)]],
      out: master,
      why: 'No new key material goes in here — the zeros are a placeholder kept so the ladder has a ' +
        'uniform shape at every stage. All of this secret’s strength came from the ECDHE ' +
        'exchange two steps up.'
    });

    var cAp = deriveSecret(master, 'c ap traffic', thToSf);
    step({
      name: 'client_application_traffic_secret_0',
      formula: 'Derive-Secret(Master Secret, "c ap traffic", ClientHello..server Finished)',
      info: cAp.info,
      inputs: [['secret', master], ['transcript hash', thToSf]],
      out: cAp.out,
      why: 'The transcript now runs through the server’s Finished, so these keys exist only if ' +
        'the client accepted that Finished. The trailing _0 is real: the secret can be ratcheted ' +
        'forward with KeyUpdate, giving _1, _2 and so on, each derived from the last with the ' +
        '"traffic upd" label and the old one thrown away.'
    });

    var sAp = deriveSecret(master, 's ap traffic', thToSf);
    step({
      name: 'server_application_traffic_secret_0',
      formula: 'Derive-Secret(Master Secret, "s ap traffic", ClientHello..server Finished)',
      info: sAp.info,
      inputs: [['secret', master], ['transcript hash', thToSf]],
      out: sAp.out,
      why: 'The server’s side of the application keys, from the same transcript with a ' +
        'different label.'
    });

    var apKey = expandLabel(cAp.out, 'key', [], aead.keyLen);
    step({
      name: 'client application write_key',
      formula: 'HKDF-Expand-Label(client_application_traffic_secret_0, "key", "", ' + aead.keyLen + ')',
      info: apKey.info,
      inputs: [['secret', cAp.out]],
      out: apKey.out,
      why: 'Everything you actually came here to send is encrypted with this. ' + aead.note
    });

    var cFinKey = expandLabel(cHs.out, 'finished', [], 32);
    var cVerify = hmacSha256(cFinKey.out, thToSf);
    var cf = handshakeMsg(20, cVerify);
    var thToCf = sha256(join([ch, sh, ee, cert, cv, sf, cf]));

    var res = deriveSecret(master, 'res master', thToCf);
    step({
      name: 'resumption_master_secret',
      formula: 'Derive-Secret(Master Secret, "res master", ClientHello..client Finished)',
      info: res.info,
      inputs: [['secret', master], ['transcript hash', thToCf]],
      out: res.out,
      why: 'The seed for every ticket the server issues afterwards. A ticket’s PSK is ' +
        'HKDF-Expand-Label of this secret with the ticket nonce as context, so two tickets from one ' +
        'connection are independent. This is the value that makes the next handshake cheap — and, ' +
        'if you enable 0-RTT, the value that early data’s security rests on.'
    });

    return {
      steps: steps, aead: aead, resuming: resuming,
      transcripts: [
        ['Transcript-Hash("")', emptyHash],
        ['Transcript-Hash(ClientHello)', thCh],
        ['Transcript-Hash(ClientHello..ServerHello)', thChSh],
        ['Transcript-Hash(..CertificateVerify)', thToCv],
        ['Transcript-Hash(..server Finished)', thToSf],
        ['Transcript-Hash(..client Finished)', thToCf]
      ],
      sizes: { ch: ch.length, sh: sh.length, ee: ee.length, cert: cert.length,
               cv: cv.length, sf: sf.length, cf: cf.length }
    };
  }

  /* ======================================================================== */
  /*  THE HANDSHAKE ITSELF                                                    */
  /* ------------------------------------------------------------------------ */
  /*  Every step carries its own key state, so the "which of these is          */
  /*  encrypted" question is answered by the model rather than by a lock icon  */
  /*  somebody drew in the right-looking place.                                */
  /* ======================================================================== */

  var WIRE = {
    plain: { label: 'in the clear', tone: 'open',
      seen: 'Anyone on the path reads this in full.' },
    hsServer: { label: 'encrypted — server handshake key', tone: 'hs',
      seen: 'An observer sees an opaque record. In TLS 1.3 it is even labelled ' +
        'application_data(23) on the outside, so a middlebox cannot tell handshake from traffic.' },
    hsClient: { label: 'encrypted — client handshake key', tone: 'hs',
      seen: 'Opaque, and indistinguishable on the wire from ordinary traffic.' },
    appClient: { label: 'encrypted — client application key', tone: 'app',
      seen: 'Opaque. Only the size and the timing leak.' },
    appServer: { label: 'encrypted — server application key', tone: 'app',
      seen: 'Opaque. Only the size and the timing leak.' },
    appLegacy: { label: 'encrypted — TLS 1.2 session keys', tone: 'app',
      seen: 'Opaque, but the record still announces its content type in the clear.' },
    none: { label: 'nothing on the wire', tone: 'calc', seen: 'Nothing is transmitted.' }
  };

  var ALERTS = {
    handshake_failure: { code: 40, name: 'handshake_failure' },
    bad_certificate: { code: 42, name: 'bad_certificate' },
    certificate_expired: { code: 45, name: 'certificate_expired' },
    certificate_unknown: { code: 46, name: 'certificate_unknown' },
    illegal_parameter: { code: 47, name: 'illegal_parameter' },
    protocol_version: { code: 70, name: 'protocol_version' }
  };

  function alertRecord(code, encrypted) {
    if (encrypted) {
      /* TLS 1.3 inner plaintext is content || real content type, then the AEAD
         tag. The outer record lies about its type and says application_data. */
      return {
        wire: hexSpaced([0x17, 0x03, 0x03, 0x00, 0x13]) + '  … 19 opaque bytes …',
        inner: hexSpaced([2, code, 21]),
        note: 'The alert is itself encrypted, so an observer sees a 19-byte opaque record and cannot ' +
          'tell a failed certificate check from a successful one. The inner plaintext is level(2) ' +
          'fatal, the description byte, then 21 — the real content type, which in TLS 1.3 is ' +
          'appended inside rather than announced outside.'
      };
    }
    return {
      wire: hexSpaced([0x15, 0x03, 0x03, 0x00, 0x02, 2, code]),
      inner: hexSpaced([2, code]),
      note: 'No keys exist yet, so this alert travels in the clear: content type 21, two bytes of ' +
        'body, level 2 (fatal) and the description. Anyone watching learns exactly why the ' +
        'connection failed.'
    };
  }

  var FAILURES = {
    none: { label: 'nothing — a clean handshake' },
    nocipher: { label: 'the server supports none of the offered ciphers' },
    downgrade: { label: 'an attacker forces TLS 1.2' },
    expired: { label: 'the certificate expired last month' },
    namemismatch: { label: 'the certificate is for a different name' }
  };

  function flow13(opts) {
    var host = opts.host || 'example.com';
    var fail = opts.fail || 'none';
    var steps = [];

    steps.push({
      side: 'client', name: 'ClientHello', wire: 'plain', rt: 1, flight: 1,
      body: 'legacy_version 0x0303 · 32-byte random · cipher suites · ' +
        'supported_versions=[TLS 1.3] · key_share (X25519 public key) · ' +
        'server_name=' + host + ' · ALPN · signature_algorithms',
      detail: 'The client sends an X25519 public key before the server has said anything at all. ' +
        'That single guess is why TLS 1.3 needs one round trip where 1.2 needed two: there is no ' +
        '"tell me your parameters, then I will send my key" exchange, because the client has ' +
        'already sent its key on spec. The ClientHello tab takes this message apart field by field.',
      teaches: 'Everything in this message is readable by anyone on the path, the server name ' +
        'included. That is the privacy hole ECH exists to close.'
    });

    if (fail === 'nocipher') {
      steps.push({
        side: 'server', name: 'Alert: handshake_failure(40)', wire: 'plain', rt: 1, flight: 2,
        kind: 'alert', alert: ALERTS.handshake_failure, encrypted: false,
        body: 'fatal(2), handshake_failure(40)',
        detail: 'The server found no cipher suite, no group and no signature algorithm it shares ' +
          'with the client, so there is nothing to negotiate. handshake_failure is deliberately ' +
          'vague: it is the alert for "these parameters do not intersect", and a server should not ' +
          'be more specific because being specific about what it will not accept is a small oracle. ' +
          'insufficient_security(71) exists for the narrower case where the client’s offer was ' +
          'understood and judged too weak.',
        teaches: 'No key material exists yet, so this alert is plaintext and the failure is public.'
      });
      return { mode: 'tls13', steps: steps, aborted: true, rtts: 1 };
    }

    if (fail === 'downgrade') {
      steps.push({
        side: 'server', name: 'ServerHello — TLS 1.2, carrying the downgrade sentinel', wire: 'plain',
        rt: 1, flight: 2, kind: 'attack',
        body: 'no supported_versions extension · random ends 44 4f 57 4e 47 52 44 01',
        detail: 'The tampering happened one message earlier: something on the path stripped ' +
          'supported_versions out of the ClientHello, so the server never saw an offer of TLS 1.3 ' +
          'and answered honestly in 1.2. This is exactly the shape of the downgrade attacks that ' +
          'worked against earlier versions, and the client cannot see the edit — its own copy of ' +
          'the ClientHello still says 1.3. What catches it is a sentinel: a TLS 1.3-capable server ' +
          'that ends up negotiating 1.2 must set the last eight bytes of its random to the ASCII ' +
          'string DOWNGRD followed by 0x01, and 0x00 for 1.1 or below. The client offered 1.3, so ' +
          'seeing that marker means the offer was edited in flight. A genuinely 1.2-only server ' +
          'does not know to set it, which is why its absence proves nothing on its own.',
        teaches: 'The marker is inside the server random, and in TLS 1.2 the random is covered by ' +
          'the ServerKeyExchange signature. So the attacker cannot strip the sentinel back out ' +
          'either — removing it breaks the signature that follows.'
      });
      steps.push({
        side: 'client', name: 'Alert: illegal_parameter(47)', wire: 'plain', rt: 1, flight: 3,
        kind: 'alert', alert: ALERTS.illegal_parameter, encrypted: false,
        body: 'fatal(2), illegal_parameter(47)',
        detail: 'The client offered TLS 1.3, sees a ServerHello claiming 1.2, checks the sentinel ' +
          'and aborts. RFC 8446 section 4.1.3 requires exactly this. Some stacks send ' +
          'protocol_version(70) when the version itself is unacceptable rather than tampered with; ' +
          'illegal_parameter is the one specified for the downgrade sentinel.',
        teaches: 'Downgrade protection is not a warning, it is a hard abort. The connection ends ' +
          'rather than continuing on weaker terms.'
      });
      return { mode: 'tls13', steps: steps, aborted: true, rtts: 1 };
    }

    steps.push({
      side: 'server', name: 'ServerHello', wire: 'plain', rt: 1, flight: 2,
      body: 'chosen suite TLS_AES_128_GCM_SHA256 · 32-byte random · ' +
        'supported_versions=TLS 1.3 · key_share (its own X25519 public key)',
      detail: 'The last message on the wire that anybody can read. It carries the server’s ' +
        'half of the key exchange and the chosen cipher suite, and nothing else — every other ' +
        'server parameter was moved into EncryptedExtensions precisely so it would not be public.',
      teaches: 'After this message, plaintext stops. Not after Finished, which is where most ' +
        'diagrams put the lock.'
    });

    steps.push({
      side: 'both', name: 'Key agreement and the key schedule', wire: 'none', rt: 1, flight: 2,
      kind: 'compute',
      body: 'X25519(client private, server public) = X25519(server private, client public)',
      detail: 'Both sides now compute the same 32-byte shared secret from their own private key and ' +
        'the other side’s public key. It is never transmitted and cannot be derived from what ' +
        'was. That secret plus the transcript hash of ClientHello and ServerHello runs through ' +
        'HKDF to produce the handshake traffic secrets — one per direction. The key schedule ' +
        'tab computes this for real.',
      teaches: 'Nothing crosses the wire in this step. It is the moment the connection becomes ' +
        'private, and it is invisible.'
    });

    steps.push({
      side: 'server', name: 'ChangeCipherSpec (compatibility only)', wire: 'plain', rt: 1, flight: 2,
      kind: 'compat',
      body: 'one byte: 0x01',
      detail: 'This record means nothing in TLS 1.3. It is sent so that middleboxes which learned ' +
        'the TLS 1.2 shape by heart see something familiar and let the connection through. RFC 8446 ' +
        'calls it middlebox compatibility mode and requires the receiver to ignore it. It is one of ' +
        'the more honest admissions in a modern protocol specification.',
      teaches: 'A record can be entirely decorative. Reading a capture means knowing which ones are.'
    });

    steps.push({
      side: 'server', name: 'EncryptedExtensions', wire: 'hsServer', rt: 1, flight: 2,
      body: 'the selected ALPN protocol · SNI acknowledgement · anything not needed to ' +
        'establish keys',
      detail: 'The first encrypted message, and its existence is the point: in TLS 1.2 every server ' +
        'parameter was public, so an observer learned which protocol you settled on and much else ' +
        'besides. TLS 1.3 split the server’s answer in two — the minimum needed to derive ' +
        'keys goes in ServerHello, and everything else waits until there are keys to hide it under.',
      teaches: 'Encryption starts here, one message after ServerHello, and before the certificate.'
    });

    steps.push({
      side: 'server', name: 'Certificate', wire: 'hsServer', rt: 1, flight: 2,
      body: 'the leaf certificate for ' + host + ', its intermediates, and per-certificate ' +
        'extensions such as SCTs',
      detail: 'The certificate chain, encrypted. In TLS 1.2 this was plaintext, which meant a ' +
        'passive observer got the identity of every site you visited for free even when SNI was ' +
        'absent. Encrypting it is one of the largest practical privacy wins in TLS 1.3, and it is ' +
        'undone in practice by SNI still being in the clear — which is exactly why ECH matters. ' +
        'What is inside the certificate is /labs/cert-decoder; how it got logged is /labs/ct-log.',
      teaches: 'The certificate is encrypted in TLS 1.3 and was not in TLS 1.2. Switch modes and ' +
        'watch this row change colour.'
    });

    if (fail === 'expired' || fail === 'namemismatch') {
      var isExpired = fail === 'expired';
      steps.push({
        side: 'client', name: 'Certificate validation fails', wire: 'none', rt: 1, flight: 2,
        kind: 'compute',
        body: isExpired ? 'notAfter is in the past' : 'no subjectAltName matches ' + host,
        detail: isExpired
          ? 'The chain builds, the signatures verify, and the leaf expired last month. Validity ' +
            'dates are checked against the client’s own clock, which is why a device with a ' +
            'wrong date sees every certificate on the internet as broken — a genuinely common ' +
            'support call and not a security problem at all.'
          : 'The chain builds and the signatures verify, and the name does not match. Modern clients ' +
            'read subjectAltName only; the commonName field has been ignored for years, so a ' +
            'certificate that "looks right" in a viewer can still fail here. Wildcards match one ' +
            'label and not a dot, so *.example.com covers a.example.com and not a.b.example.com.',
        teaches: 'Certificate validation is the client’s job, not the protocol’s. TLS ' +
          'delivered the certificate correctly; the policy decision is entirely local.'
      });
      steps.push({
        side: 'client',
        name: isExpired ? 'Alert: certificate_expired(45)' : 'Alert: bad_certificate(42), probably',
        wire: 'hsClient', rt: 1, flight: 3, kind: 'alert',
        alert: isExpired ? ALERTS.certificate_expired : ALERTS.bad_certificate,
        encrypted: true,
        body: isExpired ? 'fatal(2), certificate_expired(45)'
                        : 'fatal(2), bad_certificate(42) — but stacks disagree',
        detail: isExpired
          ? 'certificate_expired means what it says and every stack sends it for this case. Because ' +
            'handshake keys already exist, the alert is encrypted — so unlike the TLS 1.2 ' +
            'version of this same failure, an observer cannot see why the connection died.'
          : 'There is no alert code that means "wrong hostname". OpenSSL maps the hostname ' +
            'verification failure to bad_certificate(42); other stacks send certificate_unknown(46), ' +
            'and browsers often just close the connection and show their own interstitial instead. ' +
            'Treat the code as a hint about which library you are talking to, not as a diagnosis.',
        teaches: 'In TLS 1.3 even the failure is private, because the alert is encrypted under the ' +
          'handshake key. Run the same failure in TLS 1.2 mode and it is plaintext.'
      });
      return { mode: 'tls13', steps: steps, aborted: true, rtts: 1 };
    }

    steps.push({
      side: 'server', name: 'CertificateVerify', wire: 'hsServer', rt: 1, flight: 2,
      body: 'a signature over the transcript hash, made with the certificate’s private key',
      detail: 'The certificate is a public document — anyone can copy one. This message is the ' +
        'proof of possession: a signature, with the private key, over a hash of every handshake ' +
        'byte so far. It is what makes the certificate mean anything, and it is why a stolen ' +
        'certificate file without its key is worthless. The signature also covers a fixed prefix of ' +
        '64 space characters and a context string, so a signature made for a server can never be ' +
        'replayed as one made for a client.',
      teaches: 'Presenting a certificate proves nothing. Signing the transcript with its key does.'
    });

    steps.push({
      side: 'server', name: 'Finished', wire: 'hsServer', rt: 1, flight: 2,
      body: 'HMAC(finished_key, transcript hash of everything above)',
      detail: 'One HMAC that covers the entire handshake. If a single byte of the ClientHello had ' +
        'been altered in flight — a cipher suite removed, an extension stripped — the two ' +
        'sides would have different transcripts and this value would not match. It is the reason a ' +
        'downgrade cannot simply be edited into the conversation. The key schedule tab computes ' +
        'this exact HMAC over real bytes.',
      teaches: 'The handshake authenticates itself retroactively. Tampering is detected at the end, ' +
        'not at the point it happened.'
    });

    steps.push({
      side: 'client', name: 'Verify everything', wire: 'none', rt: 1, flight: 3, kind: 'compute',
      body: 'chain → hostname → dates → CertificateVerify signature → Finished HMAC',
      detail: 'The client builds a path from the leaf to a root it already trusts, checks the ' +
        'hostname against subjectAltName, checks validity dates against its own clock, verifies the ' +
        'CertificateVerify signature, and only then checks the Finished HMAC. Revocation, if it ' +
        'happens at all, happens here too — usually from a locally cached list rather than a ' +
        'live OCSP query, because a live query is a privacy leak and a latency cost at once.',
      teaches: 'Trust comes from the root store on your machine. TLS does not supply it.'
    });

    steps.push({
      side: 'client', name: 'Finished', wire: 'hsClient', rt: 2, flight: 3,
      body: 'HMAC(client finished_key, transcript hash through the server’s Finished)',
      detail: 'The client’s matching HMAC, proving it saw the same handshake. It leaves in the ' +
        'same flight as the first application data, which is what makes this a one-round-trip ' +
        'handshake: the client does not wait for anything after this.',
      teaches: 'Handshake done. One round trip has elapsed since the ClientHello left.'
    });

    steps.push({
      side: 'client', name: 'Application data', wire: 'appClient', rt: 2, flight: 3,
      body: 'your first HTTP request, under the client application traffic key',
      detail: 'Derived from the master secret over the transcript through the server’s ' +
        'Finished, so these keys exist only for a handshake that actually completed. The record is ' +
        'content type 23 on the outside like everything else since ServerHello, so the wire cannot ' +
        'tell where the handshake ended and the traffic began.',
      teaches: 'Time to first byte: one TLS round trip, on top of one for TCP and whatever DNS cost.'
    });

    steps.push({
      side: 'server', name: 'NewSessionTicket', wire: 'appServer', rt: 2, flight: 4,
      body: 'a ticket, a nonce, a lifetime, and optionally max_early_data_size',
      detail: 'Sent after the handshake rather than during it, over application keys. Each ticket ' +
        'is bound to a PSK derived from the resumption master secret with the ticket nonce as ' +
        'context, so several tickets from one connection are independent of each other. If ' +
        'max_early_data_size is present, this ticket permits 0-RTT next time — which is where ' +
        'the replay problem comes from.',
      teaches: 'Resumption is set up after the connection is already working, not before.'
    });

    steps.push({
      side: 'server', name: 'Application data', wire: 'appServer', rt: 2, flight: 4,
      body: 'the response',
      detail: 'One round trip after the ClientHello left, the answer arrives.',
      teaches: 'This is the line the whole design is arguing about: how early can it appear.'
    });

    return { mode: 'tls13', steps: steps, aborted: false, rtts: 1 };
  }

  function flow12(opts) {
    var host = opts.host || 'example.com';
    var fail = opts.fail || 'none';
    var steps = [];

    steps.push({
      side: 'client', name: 'ClientHello', wire: 'plain', rt: 1, flight: 1,
      body: 'client_version 0x0303 · 32-byte random · cipher suites naming all four ' +
        'primitives · server_name=' + host + ' · supported_groups · ' +
        'extended_master_secret · renegotiation_info',
      detail: 'A TLS 1.2 suite name spells out key exchange, authentication, cipher and MAC all at ' +
        'once — ECDHE_RSA_WITH_AES_128_GCM_SHA256 — which is why there were hundreds of ' +
        'them and why so many were bad. There is no key_share here: the client has nothing to send ' +
        'yet, because it does not know which group the server will pick.',
      teaches: 'No key material in the first flight is precisely what costs the extra round trip.'
    });

    if (fail === 'nocipher') {
      steps.push({
        side: 'server', name: 'Alert: handshake_failure(40)', wire: 'plain', rt: 1, flight: 2,
        kind: 'alert', alert: ALERTS.handshake_failure, encrypted: false,
        body: 'fatal(2), handshake_failure(40)',
        detail: 'Same alert as TLS 1.3 and for the same reason — nothing in the offer ' +
          'intersects with what the server will accept.',
        teaches: 'Plaintext, as every TLS 1.2 alert before the ChangeCipherSpec is.'
      });
      return { mode: 'tls12', steps: steps, aborted: true, rtts: 1 };
    }

    if (fail === 'downgrade') {
      steps.push({
        side: 'server', name: 'ServerHello — attacker forces an older version', wire: 'plain',
        rt: 1, flight: 2, kind: 'attack',
        body: 'server_version rewritten downward by something on the path',
        detail: 'This is the attack TLS 1.2 was historically weak against. The version is a plain ' +
          'field in ServerHello and there is no sentinel in the random for a 1.2-only server to ' +
          'set. What does protect a 1.2 connection is that the ServerKeyExchange signature covers ' +
          'both randoms, and that the Finished messages cover the whole transcript — so ' +
          'tampering is caught, but only at the very end of the handshake rather than immediately.',
        teaches: 'TLS 1.3 detects this at ServerHello. TLS 1.2 detects it at Finished, several ' +
          'messages later.'
      });
      steps.push({
        side: 'client', name: 'Alert: handshake_failure(40) or protocol_version(70)', wire: 'plain',
        rt: 2, flight: 3, kind: 'alert', alert: ALERTS.protocol_version, encrypted: false,
        body: 'fatal(2), protocol_version(70)',
        detail: 'Which code comes back depends on where the mismatch is noticed: a version the ' +
          'client will not accept gives protocol_version(70), and a Finished that does not verify ' +
          'gives decrypt_error(51). TLS_FALLBACK_SCSV exists as a separate marker for clients that ' +
          'deliberately retry at a lower version, so a server can tell a real old client from a ' +
          'downgraded new one.',
        teaches: 'The abort is real either way. The difference from 1.3 is how late it comes.'
      });
      return { mode: 'tls12', steps: steps, aborted: true, rtts: 2 };
    }

    steps.push({
      side: 'server', name: 'ServerHello', wire: 'plain', rt: 1, flight: 2,
      body: 'server_version · 32-byte random · session_id · chosen cipher suite',
      detail: 'The chosen suite decides everything at once, since the suite name carries all four ' +
        'primitives.',
      teaches: 'Still plaintext, and so is everything else in this flight.'
    });

    steps.push({
      side: 'server', name: 'Certificate', wire: 'plain', rt: 1, flight: 2,
      body: 'the full chain for ' + host + ', in the clear',
      detail: 'This is the row that matters most when comparing the two versions. In TLS 1.2 the ' +
        'certificate is plaintext, so every passive observer — an ISP, a transparent proxy, ' +
        'anyone with a tap — learns which site you are talking to even if SNI were somehow ' +
        'absent. TLS 1.3 moved this behind the handshake keys.',
      teaches: 'Plaintext certificate. Compare this row against the same row in TLS 1.3 mode.'
    });

    steps.push({
      side: 'server', name: 'ServerKeyExchange', wire: 'plain', rt: 1, flight: 2,
      body: 'the ECDHE curve and public key, signed with the certificate’s private key',
      detail: 'The message TLS 1.3 deleted. Because the client could not know the curve in advance, ' +
        'the server had to name it here and sign it — the signature covers both randoms and ' +
        'the parameters, which is what stops an attacker substituting its own. Static RSA key ' +
        'exchange had no message like this at all, which is exactly why it had no forward secrecy ' +
        'and why TLS 1.3 removed it.',
      teaches: 'This message is the extra round trip, in one line.'
    });

    steps.push({
      side: 'server', name: 'ServerHelloDone', wire: 'plain', rt: 1, flight: 2,
      body: 'empty',
      detail: 'A zero-length message meaning "your turn". TLS 1.3 has no equivalent because flights ' +
        'are unambiguous there.',
      teaches: 'End of the server’s first flight. One round trip gone, and no keys yet.'
    });

    if (fail === 'expired' || fail === 'namemismatch') {
      var expired12 = fail === 'expired';
      steps.push({
        side: 'client', name: 'Certificate validation fails', wire: 'none', rt: 2, flight: 3,
        kind: 'compute',
        body: expired12 ? 'notAfter is in the past' : 'no subjectAltName matches ' + host,
        detail: 'The same local policy check as in TLS 1.3, at the same point in the client’s ' +
          'reasoning. What differs is what happens next.',
        teaches: 'Identical check, very different visibility for the failure.'
      });
      steps.push({
        side: 'client',
        name: expired12 ? 'Alert: certificate_expired(45)' : 'Alert: bad_certificate(42), probably',
        wire: 'plain', rt: 2, flight: 3, kind: 'alert',
        alert: expired12 ? ALERTS.certificate_expired : ALERTS.bad_certificate,
        encrypted: false,
        body: expired12 ? 'fatal(2), certificate_expired(45)' : 'fatal(2), bad_certificate(42)',
        detail: 'No ChangeCipherSpec has been sent, so no keys are in use and the alert goes out in ' +
          'the clear. Anyone watching sees both the certificate that failed and the precise reason ' +
          'it failed. In TLS 1.3 this same alert is encrypted.',
        teaches: 'The whole failure is public in TLS 1.2 and private in TLS 1.3.'
      });
      return { mode: 'tls12', steps: steps, aborted: true, rtts: 2 };
    }

    steps.push({
      side: 'client', name: 'ClientKeyExchange', wire: 'plain', rt: 2, flight: 3,
      body: 'the client’s ECDHE public key',
      detail: 'Only now, in the second round trip, does the client send its key. Both sides can ' +
        'finally compute the pre-master secret.',
      teaches: 'The second round trip starts here. This is the entire difference in cost.'
    });

    steps.push({
      side: 'client', name: 'ChangeCipherSpec', wire: 'plain', rt: 2, flight: 3, kind: 'compat',
      body: 'one byte: 0x01',
      detail: 'In TLS 1.2 this record genuinely means something: everything after it from this ' +
        'sender is encrypted. TLS 1.3 kept the bytes and threw away the meaning.',
      teaches: 'This is where encryption starts in TLS 1.2 — five messages later than in 1.3.'
    });

    steps.push({
      side: 'client', name: 'Finished', wire: 'appLegacy', rt: 2, flight: 3,
      body: 'PRF(master_secret, "client finished", hash of the handshake so far)',
      detail: 'The first encrypted message of a TLS 1.2 connection. Everything before it, including ' +
        'the certificate, was public.',
      teaches: 'First encrypted byte, in the second round trip.'
    });

    steps.push({
      side: 'server', name: 'ChangeCipherSpec', wire: 'plain', rt: 2, flight: 4, kind: 'compat',
      body: 'one byte: 0x01',
      detail: 'The server switching too.',
      teaches: 'Still round trip two.'
    });

    steps.push({
      side: 'server', name: 'Finished', wire: 'appLegacy', rt: 2, flight: 4,
      body: 'PRF(master_secret, "server finished", hash of the handshake so far)',
      detail: 'Both Finished messages together are what make TLS 1.2 downgrade-resistant at all: ' +
        'they cover the transcript, so an edited ClientHello produces a mismatch. The weakness was ' +
        'never that tampering went undetected — it was how much had already been sent in the ' +
        'clear by the time it was.',
      teaches: 'Handshake complete after two full round trips.'
    });

    steps.push({
      side: 'client', name: 'Application data', wire: 'appLegacy', rt: 3, flight: 5,
      body: 'your first HTTP request',
      detail: 'Two TLS round trips after the ClientHello, plus the TCP handshake before it. False ' +
        'Start let a client send this immediately after its own Finished without waiting for the ' +
        'server’s, recovering most of a round trip at the cost of sending data before the peer ' +
        'was fully authenticated. TLS 1.3 makes the trick unnecessary.',
      teaches: 'Two round trips of TLS, against one for TLS 1.3.'
    });

    return { mode: 'tls12', steps: steps, aborted: false, rtts: 2 };
  }

  function flow(opts) {
    return opts.version === 'tls12' ? flow12(opts) : flow13(opts);
  }

  /* ======================================================================== */
  /*  ROUND TRIPS                                                             */
  /* ======================================================================== */

  var TIMELINES = {
    tls13: {
      label: 'TLS 1.3, full handshake',
      rows: [
        ['DNS lookup', 1, 'Resolving the name, unless it is cached. Over DoH this is itself a TLS ' +
          'connection, which is a recursion worth noticing.'],
        ['TCP handshake', 1, 'SYN, SYN-ACK, ACK. The ACK carries no data, so the cost is one round ' +
          'trip before TLS starts at all.'],
        ['ClientHello → ServerHello … Finished', 1, 'One round trip. The client’s ' +
          'key_share guess is what compresses the old two-flight exchange into one.'],
        ['First request leaves', 0, 'Sent in the same flight as the client Finished, so it costs ' +
          'nothing extra.'],
        ['First response arrives', 1, 'Half a round trip of network plus whatever the server takes ' +
          'to think.']
      ],
      total: 'DNS + 1 RTT for TCP + 1 RTT for TLS before the request even leaves.'
    },
    tls13hrr: {
      label: 'TLS 1.3 with HelloRetryRequest',
      rows: [
        ['DNS lookup', 1, 'As before.'],
        ['TCP handshake', 1, 'As before.'],
        ['ClientHello with the wrong key_share', 1, 'The client guessed X25519; this server wants ' +
          'P-256, or a post-quantum hybrid it was not offered.'],
        ['HelloRetryRequest, then a second ClientHello', 1, 'A whole extra round trip, spent ' +
          'entirely on being told which group to use.'],
        ['First response arrives', 1, 'Two TLS round trips, which is TLS 1.2 speed from a TLS 1.3 ' +
          'connection.']
      ],
      total: 'The 1-RTT promise is conditional on the guess being right. When it is wrong you pay ' +
        'exactly what 1.2 cost.'
    },
    tls130rtt: {
      label: 'TLS 1.3 resumption with 0-RTT early data',
      rows: [
        ['DNS lookup', 0, 'Almost certainly cached by now, since you have been here before.'],
        ['TCP handshake', 1, 'Still one round trip, unless TCP Fast Open is in play. TLS cannot ' +
          'remove this one; QUIC can, by not using TCP.'],
        ['ClientHello + early data', 0, 'The request goes out in the same packet as the hello, ' +
          'encrypted under a key derived from the resumption secret.'],
        ['First response arrives', 1, 'Zero TLS round trips before the request left. This is as ' +
          'fast as TLS gets.'],
        ['The bill for that', 0, 'Replay. See below — it is not a footnote.']
      ],
      total: 'Zero TLS round trips, and two properties given up to get there.'
    },
    tls12: {
      label: 'TLS 1.2, full handshake',
      rows: [
        ['DNS lookup', 1, 'As before.'],
        ['TCP handshake', 1, 'As before.'],
        ['ClientHello → ServerHelloDone', 1, 'The server names its parameters. The client ' +
          'still has nothing keyed.'],
        ['ClientKeyExchange → server Finished', 1, 'The second round trip, spent on the key ' +
          'exchange that 1.3 folds into the first.'],
        ['First response arrives', 1, 'Two TLS round trips before the request leaves.']
      ],
      total: 'On a 100 ms link that is roughly 200 ms of TLS against 100 ms for 1.3 — before ' +
        'TCP, before DNS, and on every new connection.'
    }
  };

  var ZERO_RTT_RISK = [
    ['Early data is replayable', 'A 0-RTT request is not covered by anything fresh from the server, ' +
      'so an attacker who records the packet can send it again to the same server and it will be ' +
      'accepted. RFC 8446 section 8 offers defences — single-use tickets, recording ClientHello ' +
      'values, freshness windows — and states plainly that none of them is complete, ' +
      'particularly across a cluster of servers that do not share state.'],
    ['So only idempotent requests belong in it', 'A repeated GET is usually harmless. A repeated ' +
      'POST that moves money is not. This is why browsers restrict what they will send as early ' +
      'data and why a server can refuse early data on any request it chooses, falling back to the ' +
      'ordinary 1-RTT path.'],
    ['It has no forward secrecy', 'Early data is encrypted under a key derived from the resumption ' +
      'PSK alone, with no fresh Diffie-Hellman in its ancestry. Compromise the ticket secret later ' +
      'and the recorded early data opens. The rest of the connection is protected by the fresh ' +
      'exchange and stays shut.'],
    ['It is a real speed win, and it is a trade', 'Which is the honest summary. Zero round trips is ' +
      'a large difference on a slow link, and the cost is a replay window and a weaker secrecy ' +
      'property on the first request only. Decide per application, not per fashion.']
  ];

  var CORE = {
    buildClientHello: buildClientHello,
    keySchedule: keySchedule,
    expandLabel: expandLabel,
    deriveSecret: deriveSecret,
    hkdfExtract: hkdfExtract,
    hmacSha256: hmacSha256,
    sha256: sha256,
    flow: flow,
    hex: hex,
    hexToBytes: hexToBytes,
    TIMELINES: TIMELINES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  var E = MV.el, clear = MV.clear, group = MV.group, field = MV.field;
  var selectBox = MV.selectBox, textBox = MV.textBox, numBox = MV.numBox;
  var CC = MV.C;

  var EXTRA_CSS = [
    /* --- the ladder --- */
    '.tl-ladder{display:flex;flex-direction:column;gap:3px;margin-bottom:10px;}',
    '.tl-heads{display:flex;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:' + CC.faint + ';padding:0 2px 4px;}',
    '.tl-heads span{flex:1 1 0;}',
    '.tl-heads span:last-child{text-align:right;}',
    '.tl-rtmark{display:flex;align-items:center;gap:8px;margin:5px 0 2px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:' + CC.violet + ';}',
    '.tl-rtmark::after{content:"";flex:1 1 auto;height:1px;background:rgba(167,139,250,.35);}',
    '.tl-step{width:100%;text-align:left;font:inherit;cursor:pointer;padding:7px 10px;border-radius:9px;border:1px solid #24344f;background:#0d1729;color:' + CC.dim + ';display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;}',
    '.tl-step:hover{border-color:#3b5b80;color:' + CC.ink + ';}',
    '.tl-step.future{opacity:.26;}',
    '.tl-step.cur{border-color:' + CC.cyan + ';background:rgba(125,211,252,.08);color:' + CC.ink + ';}',
    '.tl-step:focus-visible{outline:2px solid ' + CC.blue + ';outline-offset:2px;}',
    '.tl-arrow{flex:0 0 auto;font-size:12px;color:' + CC.faint + ';}',
    '.tl-c2s{border-left:3px solid rgba(56,189,248,.75);}',
    '.tl-s2c{border-left:3px solid rgba(52,211,153,.75);}',
    '.tl-calc{border-left:3px solid rgba(148,163,184,.6);border-style:dashed;}',
    '.tl-abort{border-left:3px solid ' + CC.red + ';background:rgba(252,165,165,.07);}',
    '.tl-name{font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.tl-step.future .tl-name{color:' + CC.dim + ';}',
    '.tl-lock{margin-left:auto;font-size:10px;padding:1px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap;}',
    '.tl-lock-open{color:' + CC.amber + ';border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.08);}',
    '.tl-lock-hs{color:' + CC.cyan + ';border-color:rgba(125,211,252,.45);background:rgba(125,211,252,.08);}',
    '.tl-lock-app{color:' + CC.green + ';border-color:rgba(52,211,153,.45);background:rgba(52,211,153,.08);}',
    '.tl-lock-calc{color:' + CC.faint + ';border-color:#243450;}',

    /* --- detail panels shared by every family --- */
    '.tl-panel{padding:10px 12px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(15,23,42,.5);margin-bottom:10px;}',
    '.tl-panel h4{margin:0 0 6px;font-size:12px;color:' + CC.ink + ';}',
    '.tl-panel p{margin:0 0 7px;font-size:11.5px;line-height:1.7;color:' + CC.dim + ';}',
    '.tl-panel p:last-child{margin-bottom:0;}',
    '.tl-panel b{color:#cbd5e1;}',
    '.tl-tag{display:inline-block;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:' + CC.faint + ';margin:0 0 3px;}',
    '.tl-seen{border-left:3px solid ' + CC.amber + ';background:rgba(251,191,36,.06);border-radius:0 8px 8px 0;padding:7px 10px;font-size:11.5px;line-height:1.7;color:#e8d5a8;}',
    '.tl-alertbox{border-left:3px solid ' + CC.red + ';background:rgba(252,165,165,.07);border-radius:0 9px 9px 0;padding:9px 11px;margin-bottom:10px;}',
    '.tl-alertbox h4{margin:0 0 5px;font-size:12px;color:' + CC.red + ';}',
    '.tl-alertbox p{margin:0 0 6px;font-size:11.5px;line-height:1.7;color:#cbd5e1;}',

    /* --- hex --- */
    '.tl-hex{margin:0;padding:8px 10px;border:1px solid ' + CC.line + ';border-radius:8px;background:' + CC.bg0 + ';font-size:11px;line-height:1.7;color:' + CC.cyan + ';overflow-x:auto;white-space:pre;}',
    '.tl-mono{font-size:11px;line-height:1.7;color:' + CC.cyan + ';word-break:break-all;}',
    '.tl-fields{width:100%;border-collapse:collapse;font-size:11px;}',
    '.tl-fields th{text-align:left;padding:4px 6px;color:' + CC.faint + ';font-weight:600;border-bottom:1px solid ' + CC.line + ';}',
    '.tl-fields td{padding:4px 6px;border-bottom:1px solid rgba(28,43,68,.6);color:' + CC.dim + ';vertical-align:top;}',
    '.tl-fields td:first-child{color:' + CC.ink + ';white-space:nowrap;}',
    '.tl-fields td.tl-b{color:' + CC.cyan + ';word-break:break-all;font-variant-numeric:tabular-nums;}',
    '.tl-scrollx{overflow-x:auto;}',

    /* --- the field / extension picker --- */
    '.tl-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;}',
    '.tl-chip{font:inherit;font-size:11px;cursor:pointer;padding:4px 9px;border-radius:7px;border:1px solid #24344f;background:#0d1729;color:' + CC.dim + ';}',
    '.tl-chip:hover{border-color:#3b5b80;color:' + CC.ink + ';}',
    '.tl-chip.cur{border-color:' + CC.cyan + ';background:rgba(125,211,252,.1);color:' + CC.ink + ';font-weight:700;}',
    '.tl-chip.future{opacity:.35;}',
    '.tl-chip:focus-visible{outline:2px solid ' + CC.blue + ';outline-offset:2px;}',

    /* --- key schedule --- */
    '.tl-ladder-step{padding:9px 11px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(15,23,42,.5);margin-bottom:7px;}',
    '.tl-ladder-step.future{opacity:.24;}',
    '.tl-ladder-step.cur{border-color:' + CC.cyan + ';}',
    '.tl-ladder-name{margin:0 0 4px;font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.tl-formula{margin:0 0 6px;font-size:11px;line-height:1.7;color:' + CC.violet + ';white-space:pre-wrap;word-break:break-word;}',
    '.tl-out{font-size:11px;line-height:1.7;color:' + CC.green + ';word-break:break-all;}',

    /* --- timeline --- */
    '.tl-time{display:flex;flex-direction:column;gap:7px;margin-bottom:10px;}',
    '.tl-timerow{padding:8px 10px;border:1px solid ' + CC.line + ';border-radius:9px;background:rgba(15,23,42,.5);}',
    '.tl-timerow.future{opacity:.24;}',
    '.tl-timerow.cur{border-color:' + CC.cyan + ';}',
    '.tl-timehead{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:12px;}',
    '.tl-timename{font-weight:700;color:' + CC.ink + ';}',
    '.tl-timecost{color:' + CC.cyan + ';white-space:nowrap;font-size:11px;}',
    '.tl-track{position:relative;height:10px;margin-top:6px;border-radius:5px;background:#0d1729;border:1px solid #1e2d47;overflow:hidden;}',
    '.tl-span{position:absolute;top:0;bottom:0;border-radius:4px;background:rgba(56,189,248,.5);}',
    '.tl-span-free{background:rgba(52,211,153,.45);}',
    '.tl-timenote{margin:6px 0 0;font-size:11px;line-height:1.65;color:' + CC.dim + ';}',
    '.tl-risk dt{font-size:11.5px;font-weight:700;color:#e8d5a8;margin-top:8px;}',
    '.tl-risk dt:first-child{margin-top:0;}',
    '.tl-risk dd{margin:2px 0 0;font-size:11px;line-height:1.7;color:#cbd5e1;}',
    '.tl-links{margin:0;padding-left:16px;font-size:11.5px;line-height:1.8;color:' + CC.dim + ';}',
    '.tl-links a{color:' + CC.cyan + ';}'
  ].join('');

  function hexDump(bytes) {
    var lines = [];
    for (var off = 0; off < bytes.length; off += 16) {
      var row = bytes.slice(off, off + 16);
      var h = [], a = '';
      for (var i = 0; i < 16; i++) {
        if (i < row.length) {
          h.push((row[i] < 16 ? '0' : '') + row[i].toString(16));
          a += (row[i] >= 32 && row[i] < 127) ? String.fromCharCode(row[i]) : '.';
        } else {
          h.push('  ');
          a += ' ';
        }
        if (i === 7) h.push('');
      }
      var offHex = '0000' + off.toString(16);
      lines.push(offHex.slice(offHex.length - 4) + '  ' + h.join(' ') + ' |' + a + '|');
    }
    return lines.length ? lines.join('\n') : '(no bytes — this extension is empty, and that is the message)';
  }

  function fieldTable(parts) {
    var wrap = E('div', 'tl-scrollx');
    var t = E('table', 'tl-fields');
    var thead = E('thead'), htr = E('tr');
    ['Field', 'Bytes', 'What it says'].forEach(function (h) {
      htr.appendChild(E('th', null, h));
    });
    thead.appendChild(htr);
    t.appendChild(thead);
    var tb = E('tbody');
    parts.forEach(function (p) {
      var tr = E('tr');
      tr.appendChild(E('td', null, p.label));
      var td = E('td', 'tl-b', p.bytes.length ? hexSpaced(p.bytes) : '(empty)');
      tr.appendChild(td);
      tr.appendChild(E('td', null, p.meaning || ''));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  /* Three of the four families let you pin a row and read it while the
     timeline keeps playing. The pin has to win in TWO places — the detail
     panel and the note line under the stage — or the page ends up describing
     one message while showing another, which is worse than not having a pin.
     render() is the family's to draw; the note box belongs to the shell, so a
     pin click asks for a full redraw through the onChange the shell handed to
     buildPanel rather than reaching into the shell's DOM. */
  function focused(fam, idx, length) {
    var i = fam.pinned === null ? idx : fam.pinned;
    return Math.max(0, Math.min(length - 1, i));
  }

  function pinToggle(fam, i) {
    fam.pinned = (fam.pinned === i) ? null : i;
    if (fam.refresh) fam.refresh(); else fam.render(fam.lastIdx);
  }

  function panel(title, paras) {
    var box = E('div', 'tl-panel');
    if (title) box.appendChild(E('h4', null, title));
    paras.forEach(function (p) {
      if (p) box.appendChild(E('p', null, p));
    });
    return box;
  }

  /* ======================================================================== */
  /*  FAMILY 1 — THE HANDSHAKE                                                */
  /* ======================================================================== */

  function FlowFamily() {
    this.key = 'flow';
    this.label = 'The handshake';
    this.algoKey = 'tls13';
    this.host = 'example.com';
    this.fail = 'none';
    this.lastIdx = 0;
    this.pinned = null;
  }
  FlowFamily.prototype.algoOptions = function () {
    return [
      { key: 'tls13', label: 'TLS 1.3 — one round trip' },
      { key: 'tls12', label: 'TLS 1.2 — two round trips' }
    ];
  };
  FlowFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.refresh = onChange;
    var g = group('The connection');
    this.hostInput = textBox(this.host, function (v) {
      self.host = v.replace(/[^A-Za-z0-9.\-]/g, '') || 'example.com';
      onChange();
    }, 'example.com');
    g.appendChild(field('Server name', this.hostInput));
    host.appendChild(g);

    var g2 = group('Break it on purpose');
    var opts = [];
    for (var k in FAILURES) {
      if (Object.prototype.hasOwnProperty.call(FAILURES, k)) {
        opts.push({ key: k, label: FAILURES[k].label });
      }
    }
    g2.appendChild(selectBox(opts, this.fail, function (v) { self.fail = v; onChange(); }));
    g2.appendChild(E('p', 'oa-hint',
      'Each failure stops the handshake where a real client would stop it and shows the alert record ' +
      'byte for byte. Run the certificate failures in both versions: in TLS 1.2 the alert is ' +
      'plaintext and an observer learns exactly why you gave up, and in TLS 1.3 it is encrypted.'));
    host.appendChild(g2);

    var g3 = group('Reading the ladder');
    g3.appendChild(E('p', 'oa-hint',
      'Click any message to pin it. The badge on the right is the key that message is encrypted ' +
      'under, taken from the model rather than drawn on — which is the part most handshake ' +
      'diagrams get wrong. Dashed rows put nothing on the wire at all.'));
    host.appendChild(g3);
  };
  FlowFamily.prototype.buildStage = function (host) {
    this.ladderHost = E('div');
    this.detailHost = E('div');
    host.appendChild(this.ladderHost);
    host.appendChild(this.detailHost);
  };
  FlowFamily.prototype.compute = function () {
    this.error = null;
    this.model = flow({ version: this.algoKey, host: this.host, fail: this.fail });
    if (this.pinned !== null && this.pinned >= this.model.steps.length) this.pinned = null;
    return this.model.steps.length;
  };
  FlowFamily.prototype.render = function (idx) {
    var self = this;
    this.lastIdx = idx;
    var steps = this.model.steps;
    var cur = Math.min(idx, steps.length - 1);
    var focus = focused(this, cur, steps.length);

    clear(this.ladderHost);
    var heads = E('div', 'tl-heads');
    heads.appendChild(E('span', null, 'Client'));
    heads.appendChild(E('span', null, 'Server'));
    this.ladderHost.appendChild(heads);

    var ladder = E('div', 'tl-ladder');
    var lastRt = 0;
    steps.forEach(function (s, i) {
      if (s.rt !== lastRt) {
        lastRt = s.rt;
        ladder.appendChild(E('div', 'tl-rtmark', 'round trip ' + s.rt));
      }
      var dir = s.side === 'client' ? 'tl-c2s' : (s.side === 'server' ? 'tl-s2c' : 'tl-calc');
      var cls = 'tl-step ' + dir +
        (i > cur ? ' future' : '') +
        (i === focus ? ' cur' : '') +
        (s.kind === 'alert' ? ' tl-abort' : '');
      var b = E('button', cls);
      b.type = 'button';
      b.setAttribute('aria-pressed', i === focus ? 'true' : 'false');
      b.appendChild(E('span', 'tl-arrow', s.side === 'client' ? '→'
        : (s.side === 'server' ? '←' : '∙')));
      b.appendChild(E('span', 'tl-name', s.name));
      var w = WIRE[s.wire] || WIRE.plain;
      b.appendChild(E('span', 'tl-lock tl-lock-' + w.tone, w.label));
      b.addEventListener('click', function () {
        pinToggle(self, i);
      });
      ladder.appendChild(b);
    });
    this.ladderHost.appendChild(ladder);

    clear(this.detailHost);
    var s = steps[focus];
    var w = WIRE[s.wire] || WIRE.plain;
    var box = panel(s.name, [s.body]);
    box.appendChild(E('p', 'tl-tag', 'what it is for'));
    box.appendChild(E('p', null, s.detail));
    this.detailHost.appendChild(box);

    if (s.kind === 'alert' && s.alert) {
      var rec = alertRecord(s.alert.code, !!s.encrypted);
      var ab = E('div', 'tl-alertbox');
      ab.appendChild(E('h4', null, 'The alert on the wire'));
      ab.appendChild(E('p', 'tl-mono', rec.wire));
      ab.appendChild(E('p', null, s.encrypted
        ? 'Plaintext inside the AEAD: ' + rec.inner
        : 'Body: ' + rec.inner + ' — level 2 is fatal, ' + s.alert.code + ' is ' +
          s.alert.name + '.'));
      ab.appendChild(E('p', null, rec.note));
      this.detailHost.appendChild(ab);
    }

    var seen = E('div', 'tl-seen');
    seen.appendChild(E('p', 'tl-tag', 'what an observer on the path sees'));
    seen.appendChild(document.createTextNode(w.seen + ' ' + (s.teaches || '')));
    this.detailHost.appendChild(seen);
  };
  FlowFamily.prototype.note = function (idx) {
    var s = this.model.steps[focused(this, idx, this.model.steps.length)];
    var w = WIRE[s.wire] || WIRE.plain;
    var who = s.side === 'client' ? 'Client → server' :
      (s.side === 'server' ? 'Server → client' : 'Both sides, locally');
    return who + ': ' + s.name + ' — ' + w.label + '. ' + (s.teaches || '');
  };
  FlowFamily.prototype.compare = function () {
    return {
      title: 'TLS 1.2 and TLS 1.3 on the same connection',
      head: ['', 'TLS 1.2', 'TLS 1.3'],
      rows: [
        { key: 'rtt', cells: ['Round trips before data', '2', '1 — 0 when resuming with early data'] },
        { key: 'enc', cells: ['Encryption starts at', 'ChangeCipherSpec, in flight 3',
          'immediately after ServerHello'] },
        { key: 'cert', cells: ['Certificate on the wire', 'plaintext', 'encrypted'] },
        { key: 'sni', cells: ['Server name on the wire', 'plaintext', 'plaintext — ECH is the fix'] },
        { key: 'alert', cells: ['A failed certificate check', 'alert in the clear',
          'alert encrypted'] },
        { key: 'suite', cells: ['Cipher suite names', 'all four primitives, hundreds of suites',
          'AEAD and hash only, five suites'] },
        { key: 'fs', cells: ['Forward secrecy', 'optional — static RSA was still legal',
          'mandatory, no non-ephemeral exchange exists'] },
        { key: 'down', cells: ['Downgrade caught at', 'Finished, at the end',
          'ServerHello, via the DOWNGRD sentinel'] },
        { key: 'reneg', cells: ['Renegotiation', 'present, and historically dangerous',
          'removed; KeyUpdate replaces the useful part'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — THE CLIENTHELLO                                              */
  /* ======================================================================== */

  function HelloFamily() {
    this.key = 'hello';
    this.label = 'ClientHello';
    this.algoKey = 'tls13';
    this.host = 'example.com';
    this.ech = false;
    this.earlyData = false;
    this.lastIdx = 0;
    this.pinned = null;
  }
  HelloFamily.prototype.algoOptions = function () {
    return [
      { key: 'tls13', label: 'A modern TLS 1.3 ClientHello' },
      { key: 'tls12', label: 'A TLS 1.2-era ClientHello' }
    ];
  };
  HelloFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.refresh = onChange;
    var g = group('The message');
    this.hostInput = textBox(this.host, function (v) {
      self.host = v.replace(/[^A-Za-z0-9.\-]/g, '') || 'example.com';
      onChange();
    }, 'example.com');
    g.appendChild(field('server_name', this.hostInput));
    g.appendChild(E('p', 'oa-hint',
      'Type a longer name and watch the length fields above it move. The bytes are built from the ' +
      'structure rather than pasted in, so they cannot disagree with the breakdown beside them.'));
    host.appendChild(g);

    var g2 = group('Extensions to include');
    g2.appendChild(field('Encrypted Client Hello', selectBox(
      [{ key: 'no', label: 'not offered' }, { key: 'yes', label: 'offered' }],
      'no', function (v) { self.ech = (v === 'yes'); onChange(); })));
    g2.appendChild(field('0-RTT resumption', selectBox(
      [{ key: 'no', label: 'no' }, { key: 'yes', label: 'early_data + pre_shared_key' }],
      'no', function (v) { self.earlyData = (v === 'yes'); onChange(); })));
    g2.appendChild(E('p', 'oa-hint',
      'ECH and the 1.2-era options change which extensions appear. Everything else in the list is ' +
      'what an ordinary browser sends.'));
    host.appendChild(g2);

    var g3 = group('Reading it');
    g3.appendChild(E('p', 'oa-hint',
      'Step through the fields, or click any chip to pin one. The hex dump is exactly the bytes of ' +
      'the selected field — offsets are relative to that field, not to the whole message.'));
    host.appendChild(g3);
  };
  HelloFamily.prototype.buildStage = function (host) {
    this.chipHost = E('div');
    this.detailHost = E('div');
    host.appendChild(this.chipHost);
    host.appendChild(this.detailHost);
  };
  HelloFamily.prototype.compute = function () {
    this.error = null;
    this.hello = buildClientHello({
      host: this.host, mode: this.algoKey,
      ech: this.algoKey === 'tls13' && this.ech,
      earlyData: this.algoKey === 'tls13' && this.earlyData
    });
    if (this.pinned !== null && this.pinned >= this.hello.blocks.length) this.pinned = null;
    return this.hello.blocks.length;
  };
  HelloFamily.prototype.render = function (idx) {
    var self = this;
    this.lastIdx = idx;
    var blocks = this.hello.blocks;
    var cur = Math.min(idx, blocks.length - 1);
    var focus = focused(this, cur, blocks.length);

    clear(this.chipHost);
    var chips = E('div', 'tl-chips');
    blocks.forEach(function (blk, i) {
      var b = E('button', 'tl-chip' + (i === focus ? ' cur' : '') + (i > cur ? ' future' : ''),
        blk.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', i === focus ? 'true' : 'false');
      b.addEventListener('click', function () {
        pinToggle(self, i);
      });
      chips.appendChild(b);
    });
    this.chipHost.appendChild(chips);

    clear(this.detailHost);
    var blk = blocks[focus];
    var box = panel(blk.name + (blk.kind === 'extension' ? ' — extension ' + blk.code : ''),
      [blk.summary, blk.purpose]);
    this.detailHost.appendChild(box);

    var dump = E('div', 'tl-panel');
    dump.appendChild(E('p', 'tl-tag',
      blk.bytes.length + (blk.bytes.length === 1 ? ' byte' : ' bytes') + ' on the wire'));
    dump.appendChild(E('pre', 'tl-hex', hexDump(blk.bytes)));
    dump.appendChild(fieldTable(blk.parts));
    this.detailHost.appendChild(dump);

    if (blk.privacy) {
      var pv = E('div', 'tl-seen');
      pv.appendChild(E('p', 'tl-tag', 'what this costs you'));
      pv.appendChild(document.createTextNode(blk.privacy));
      this.detailHost.appendChild(pv);
    }

    var tot = E('div', 'tl-panel');
    tot.appendChild(E('p', 'tl-tag', 'the whole message'));
    tot.appendChild(E('p', null, 'This ClientHello is ' + this.hello.record.length +
      ' bytes as a record, ' + this.hello.message.length +
      ' as a handshake message. Only the handshake message goes into the transcript hash — the ' +
      'five-byte record header does not, which is the detail that defeats most attempts to ' +
      'reproduce a key schedule by hand.'));
    tot.appendChild(E('p', null, 'Offered suites: ' + this.hello.suites + '.'));
    this.detailHost.appendChild(tot);
  };
  HelloFamily.prototype.note = function (idx) {
    var blk = this.hello.blocks[focused(this, idx, this.hello.blocks.length)];
    return blk.name + ' — ' + blk.summary + ' (' + blk.bytes.length + ' bytes).';
  };
  HelloFamily.prototype.compare = function () {
    var blocks = this.hello.blocks;
    var rows = [];
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].kind !== 'extension') continue;
      rows.push({ key: blocks[i].key, cells: [
        blocks[i].name, String(blocks[i].code), blocks[i].bytes.length + ' B', blocks[i].summary
      ] });
    }
    return {
      title: 'Every extension in this ClientHello',
      head: ['Extension', 'Code', 'Size', 'Why it is there'],
      rows: rows
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — THE KEY SCHEDULE                                             */
  /* ======================================================================== */

  function ScheduleFamily() {
    this.key = 'schedule';
    this.label = 'Key schedule';
    this.algoKey = 'full';
    this.aead = 'aes128';
    this.sharedHex = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
    this.pskHex = '5f5e5d5c5b5a595857565554535251504f4e4d4c4b4a49484746454443424140';
    this.lastIdx = 0;
    this.pinned = null;
  }
  ScheduleFamily.prototype.algoOptions = function () {
    return [
      { key: 'full', label: 'Full handshake — no PSK' },
      { key: 'psk', label: 'Resumption — PSK and 0-RTT branch' }
    ];
  };
  ScheduleFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.refresh = onChange;
    var g = group('Inputs');
    g.appendChild(field('Cipher suite', selectBox(
      [{ key: 'aes128', label: 'AES-128-GCM' }, { key: 'chacha', label: 'ChaCha20-Poly1305' }],
      this.aead, function (v) { self.aead = v; onChange(); })));
    host.appendChild(g);

    var g2 = group('ECDHE shared secret (hex)');
    g2.appendChild(textBox(this.sharedHex, function (v) {
      self.sharedHex = v;
      onChange();
    }, '32 bytes of hex'));
    g2.appendChild(E('p', 'oa-hint',
      'The 32 bytes X25519 produces on both sides. Edit one nibble and every value below changes ' +
      'completely — that avalanche is what the construction is for. Fewer than 32 bytes is ' +
      'padded with zeros so the page keeps working while you type.'));
    host.appendChild(g2);

    var g3 = group('Resumption PSK (hex)');
    this.pskBox = textBox(this.pskHex, function (v) {
      self.pskHex = v;
      onChange();
    }, '32 bytes of hex');
    g3.appendChild(this.pskBox);
    g3.appendChild(E('p', 'oa-hint',
      'Used only in the resumption mode. In a full handshake the Early Secret is extracted from 32 ' +
      'zero bytes instead, which is why its value is a well-known constant.'));
    host.appendChild(g3);

    var g4 = group('What is real here');
    g4.appendChild(E('p', 'oa-hint',
      'The arithmetic. Every line is HMAC-SHA-256 computed in your browser exactly as RFC 8446 ' +
      'section 7.1 specifies, and the transcript hashes are genuine SHA-256 digests of the sample ' +
      'handshake messages this lab builds. What is not real is the inputs: sample randoms, a ' +
      'stand-in certificate body, an editable shared secret. So the ladder is right and the numbers ' +
      'will not match any capture you own.'));
    g4.appendChild(E('p', 'oa-hint',
      'Only the SHA-256 suites are computed. TLS_AES_256_GCM_SHA384 runs the identical ladder with ' +
      'SHA-384 and 48-byte secrets, and is not implemented here rather than being faked.'));
    host.appendChild(g4);
  };
  ScheduleFamily.prototype.buildStage = function (host) {
    this.stepsHost = E('div');
    this.detailHost = E('div');
    host.appendChild(this.stepsHost);
    host.appendChild(this.detailHost);
  };
  ScheduleFamily.prototype.compute = function () {
    this.error = null;
    var shared = hexToBytes(this.sharedHex);
    while (shared.length < 32) shared.push(0);
    var psk = hexToBytes(this.pskHex);
    while (psk.length < 32) psk.push(0);
    try {
      this.sched = keySchedule({
        mode: this.algoKey, aead: this.aead,
        shared: shared.slice(0, 32), psk: psk.slice(0, 32)
      });
    } catch (err) {
      this.sched = null;
      this.error = 'The key schedule could not be computed: ' + err.message +
        '. Nothing on this tab is trustworthy until that is fixed, so it is showing nothing ' +
        'rather than showing something wrong.';
      return 1;
    }
    if (this.pinned !== null && this.pinned >= this.sched.steps.length) this.pinned = null;
    return this.sched.steps.length;
  };
  ScheduleFamily.prototype.render = function (idx) {
    var self = this;
    this.lastIdx = idx;
    clear(this.stepsHost);
    clear(this.detailHost);
    if (!this.sched) return;

    var steps = this.sched.steps;
    var cur = Math.min(idx, steps.length - 1);
    var focus = focused(this, cur, steps.length);

    steps.forEach(function (s, i) {
      var box = E('div', 'tl-ladder-step' + (i > cur ? ' future' : '') + (i === focus ? ' cur' : ''));
      var b = E('button', 'tl-chip' + (i === focus ? ' cur' : ''), s.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', i === focus ? 'true' : 'false');
      b.addEventListener('click', function () {
        pinToggle(self, i);
      });
      box.appendChild(b);
      box.appendChild(E('p', 'tl-formula', s.formula));
      box.appendChild(E('p', 'tl-out', hex(s.out)));
      self.stepsHost.appendChild(box);
    });

    var f = steps[focus];
    var det = panel(f.name, [f.why]);
    this.detailHost.appendChild(det);

    var parts = [];
    for (var i = 0; i < f.inputs.length; i++) {
      parts.push(F(f.inputs[i][0], f.inputs[i][1], f.inputs[i][1].length + ' bytes'));
    }
    if (f.info) {
      parts.push(F('HkdfLabel struct', f.info,
        'length, then "tls13 " + label with a one-byte length, then the context with its own'));
    }
    parts.push(F('output', f.out, f.out.length + ' bytes'));

    var bytesBox = E('div', 'tl-panel');
    bytesBox.appendChild(E('p', 'tl-tag', 'the bytes this step consumed and produced'));
    bytesBox.appendChild(fieldTable(parts));
    this.detailHost.appendChild(bytesBox);

    var th = E('div', 'tl-panel');
    th.appendChild(E('p', 'tl-tag', 'transcript hashes used by this ladder'));
    th.appendChild(fieldTable(this.sched.transcripts.map(function (t) {
      return F(t[0], t[1], '');
    })));
    th.appendChild(E('p', null,
      'Each is SHA-256 over the concatenated handshake messages named, with no record headers. The ' +
      'empty-string hash e3b0c442… appears in every TLS 1.3 trace because "derived" and the ' +
      'binder labels use an empty context.'));
    this.detailHost.appendChild(th);
  };
  ScheduleFamily.prototype.note = function (idx) {
    if (!this.sched) return 'Nothing computed.';
    var s = this.sched.steps[focused(this, idx, this.sched.steps.length)];
    return s.name + ' = ' + s.formula.split('\n')[0];
  };
  ScheduleFamily.prototype.compare = function () {
    if (!this.sched) return null;
    return {
      title: 'Every secret in this schedule',
      head: ['Secret', 'Bytes', 'Value'],
      rows: this.sched.steps.map(function (s, i) {
        return { key: 'k' + i, cells: [s.name, String(s.out.length), hex(s.out)] };
      })
    };
  };

  /* ======================================================================== */
  /*  FAMILY 4 — ROUND TRIPS AND 0-RTT                                        */
  /* ======================================================================== */

  function TimeFamily() {
    this.key = 'time';
    this.label = 'Round trips & 0-RTT';
    this.algoKey = 'tls13';
    this.rtt = 60;
    this.lastIdx = 0;
  }
  TimeFamily.prototype.algoOptions = function () {
    var out = [];
    for (var k in TIMELINES) {
      if (Object.prototype.hasOwnProperty.call(TIMELINES, k)) {
        out.push({ key: k, label: TIMELINES[k].label });
      }
    }
    return out;
  };
  TimeFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    this.refresh = onChange;
    var g = group('The link');
    g.appendChild(field('Round trip time (ms)', numBox(this.rtt, 1, 800, function (v) {
      self.rtt = v;
      onChange();
    })));
    g.appendChild(E('p', 'oa-hint',
      'About 10 ms inside a data centre, 30 to 80 ms across a country, 150 ms or more on a mobile ' +
      'network or an intercontinental hop, and several hundred over satellite. The whole argument ' +
      'for 1-RTT and 0-RTT is a multiplication by this number, which is why it matters far more on ' +
      'a phone in a village than on a laptop next to the server.'));
    host.appendChild(g);

    var g2 = group('What is being counted');
    g2.appendChild(E('p', 'oa-hint',
      'Only network round trips. Server processing, packet loss and TCP slow start are all real and ' +
      'none of them is in these numbers — the point is the difference between the modes, not a ' +
      'prediction of your page load.'));
    host.appendChild(g2);
  };
  TimeFamily.prototype.buildStage = function (host) {
    this.rowsHost = E('div', 'tl-time');
    this.detailHost = E('div');
    host.appendChild(this.rowsHost);
    host.appendChild(this.detailHost);
  };
  TimeFamily.prototype.compute = function () {
    this.error = null;
    this.view = TIMELINES[this.algoKey] || TIMELINES.tls13;
    return this.view.rows.length;
  };
  TimeFamily.prototype.render = function (idx) {
    this.lastIdx = idx;
    var view = this.view;
    var cur = Math.min(idx, view.rows.length - 1);
    var rtt = this.rtt;

    var total = 0;
    var i;
    for (i = 0; i < view.rows.length; i++) total += view.rows[i][1];
    var totalMs = Math.max(1, total) * rtt;

    clear(this.rowsHost);
    var elapsed = 0;
    view.rows.forEach(function (r, n) {
      var cost = r[1] * rtt;
      var box = E('div', 'tl-timerow' + (n > cur ? ' future' : '') + (n === cur ? ' cur' : ''));
      var head = E('div', 'tl-timehead');
      head.appendChild(E('span', 'tl-timename', r[0]));
      head.appendChild(E('span', 'tl-timecost',
        r[1] === 0 ? 'free — rides an existing flight' : cost + ' ms'));
      box.appendChild(head);
      var track = E('div', 'tl-track');
      var span = E('div', 'tl-span' + (r[1] === 0 ? ' tl-span-free' : ''));
      span.style.left = (elapsed / totalMs * 100) + '%';
      span.style.width = Math.max(1.5, (cost / totalMs) * 100) + '%';
      track.appendChild(span);
      box.appendChild(track);
      box.appendChild(E('p', 'tl-timenote', r[2]));
      this.rowsHost.appendChild(box);
      elapsed += cost;
    }, this);

    clear(this.detailHost);
    this.detailHost.appendChild(panel('Where the time goes', [
      view.total,
      'At ' + rtt + ' ms per round trip that is ' + totalMs + ' ms before the response lands, on a ' +
      'connection with nothing else going wrong.'
    ]));

    if (this.algoKey === 'tls130rtt') {
      var risk = E('div', 'tl-seen');
      risk.appendChild(E('p', 'tl-tag', 'what 0-RTT costs, honestly'));
      var dl = E('dl', 'tl-risk');
      ZERO_RTT_RISK.forEach(function (r) {
        dl.appendChild(E('dt', null, r[0]));
        dl.appendChild(E('dd', null, r[1]));
      });
      risk.appendChild(dl);
      this.detailHost.appendChild(risk);
    }

    var links = E('div', 'tl-panel');
    links.appendChild(E('p', 'tl-tag', 'the round trips underneath this one'));
    var ul = E('ul', 'tl-links');
    [['/labs/dns', 'DNS lookup', 'the round trip before the round trips, and where an ECH key would be published'],
     ['/labs/tcp-congestion', 'TCP handshake and congestion control', 'the round trip TLS sits on top of, and why the first few kilobytes are slower than the rest'],
     ['/labs/cert-decoder', 'Certificate decoder', 'what is actually inside the Certificate message above'],
     ['/labs/ct-log', 'Certificate Transparency', 'where the SCTs in that certificate came from']
    ].forEach(function (l) {
      var li = E('li');
      var a = E('a', null, l[1]);
      a.href = l[0];
      li.appendChild(a);
      li.appendChild(document.createTextNode(' — ' + l[2]));
      ul.appendChild(li);
    });
    links.appendChild(ul);
    this.detailHost.appendChild(links);
  };
  TimeFamily.prototype.note = function (idx) {
    var r = this.view.rows[Math.min(idx, this.view.rows.length - 1)];
    return r[0] + ': ' + (r[1] === 0 ? 'no extra round trip' : r[1] * this.rtt + ' ms') +
      '. ' + r[2];
  };
  TimeFamily.prototype.compare = function () {
    var rtt = this.rtt;
    function ms(n) { return n * rtt + ' ms'; }
    return {
      title: 'Every mode at ' + rtt + ' ms round trip time',
      head: ['Mode', 'TLS round trips', 'TLS time', 'With TCP', 'The catch'],
      rows: [
        { key: 'tls13', cells: ['TLS 1.3 full', '1', ms(1), ms(2),
          'needs the key_share guess to be right'] },
        { key: 'tls13hrr', cells: ['TLS 1.3 + HelloRetryRequest', '2', ms(2), ms(3),
          'the guess was wrong'] },
        { key: 'tls130rtt', cells: ['TLS 1.3 0-RTT', '0', ms(0), ms(1),
          'replayable, and no forward secrecy on the early data'] },
        { key: 'tls12', cells: ['TLS 1.2 full', '2', ms(2), ms(3),
          'certificate and alerts in the clear as well'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'tlsviz',
    mountId: 'viz-tls-mount',
    name: 'The TLS handshake walkthrough',
    css: EXTRA_CSS,
    families: function () {
      return [new FlowFamily(), new HelloFamily(), new ScheduleFamily(), new TimeFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

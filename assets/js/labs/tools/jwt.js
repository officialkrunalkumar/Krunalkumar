/* ==========================================================================
   jwt.js — decode a JSON Web Token and, optionally, verify its signature.
   --------------------------------------------------------------------------
   This is the tool where "nothing leaves your browser" stops being a nice
   line and becomes the reason to use it at all. A JWT is a bearer credential:
   whoever holds it can act as the user until it expires. Pasting a production
   token into a website means handing that credential to whoever runs the site.
   People do it constantly, because the popular decoders are websites.

   This one has no server behind it. The token is split, base64url-decoded and
   verified with WebCrypto in this tab, and you can confirm that in the Network
   tab — there is no request carrying it, because there is nowhere to send it.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  function b64urlToBytes(part) {
    var s = String(part).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function b64urlToText(part) {
    return new TextDecoder().decode(b64urlToBytes(part));
  }

  /* Null prototype. The keys looked up in this map are JSON keys out of a
     token the tool was handed, i.e. entirely attacker-controlled, and a plain
     object literal would answer CLAIMS['constructor'] with a function that then
     gets printed as the claim's meaning. Same reasoning as the lookup maps in
     har.js and sqlite-browser.js. */
  var CLAIMS = (function () {
    var m = Object.create(null);
    m.iss = 'Issuer — who minted this token';
    m.sub = 'Subject — who it is about';
    m.aud = 'Audience — who is meant to accept it';
    m.exp = 'Expires at';
    m.nbf = 'Not valid before';
    m.iat = 'Issued at';
    m.jti = 'JWT ID — unique identifier';
    m.scope = 'Scope — granted permissions';
    m.azp = 'Authorised party';
    m.email = 'Email address';
    m.name = 'Display name';
    m.role = 'Role';
    m.roles = 'Roles';
    return m;
  })();

  // A header or payload that parsed cleanly can still be a number, a string,
  // an array or null — all of those are valid JSON. Only an object has claims
  // to enumerate, and JSON null in particular used to reach Object.keys() and
  // throw, taking the whole tool down on a well-formed token.
  function isObj(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
  }

  // Names what was actually decoded, so the error can say why it is wrong
  // rather than just that it is.
  function jsonType(x) {
    if (x === null) return 'JSON null';
    if (Array.isArray(x)) return 'an array';
    return 'a ' + typeof x;
  }

  /* A missing alg and an alg of "none" are different mistakes with the same
     consequence, and both have to reach the warning below. Defaulting a
     missing one to the string '(none)' meant it never did: '(none)' is not
     'none', so a header with no alg at all — the case a permissive library is
     most likely to treat as unsigned — sailed through the check the tool
     advertises. Any falsy alg ("" among them) had the same escape. A sentinel
     object cannot collide with a value a token is able to carry, so the two
     cases stay distinguishable while both reaching the warning. */
  var MISSING_ALG = {};

  function whenText(seconds) {
    var d = new Date(seconds * 1000);
    if (isNaN(d.getTime())) return String(seconds);
    var now = Date.now();
    var diff = d.getTime() - now;
    var mins = Math.round(Math.abs(diff) / 60000);
    var human;
    if (mins < 60) human = mins + ' minute' + (mins === 1 ? '' : 's');
    else if (mins < 1440) {
      var hrs = Math.round(mins / 60);
      human = hrs + ' hour' + (hrs === 1 ? '' : 's');
    } else {
      var dys = Math.round(mins / 1440);
      human = dys + ' day' + (dys === 1 ? '' : 's');
    }
    return d.toISOString() + '  (' + human + (diff < 0 ? ' ago' : ' from now') + ')';
  }

  /* Null prototype for the same reason as CLAIMS above: alg comes out of the
     token's own header, so {"alg":"constructor"} against an object literal
     would return a function, pass the truthiness check below and be handed to
     WebCrypto as a key spec. */
  var ALGO = (function () {
    var m = Object.create(null);
    m.HS256 = { name: 'HMAC', hash: 'SHA-256' };
    m.HS384 = { name: 'HMAC', hash: 'SHA-384' };
    m.HS512 = { name: 'HMAC', hash: 'SHA-512' };
    return m;
  })();

  function algoSpec(alg) {
    // Only a string can name an algorithm; anything else (a number, an object,
    // the missing-alg sentinel) is not verifiable here.
    return typeof alg === 'string' ? ALGO[alg] || null : null;
  }

  async function verifyHmac(token, secret, alg) {
    var parts = token.split('.');
    var spec = algoSpec(alg);
    if (!spec) return null;
    var key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: spec.hash }, false, ['verify']);
    return crypto.subtle.verify(
      'HMAC', key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + '.' + parts[1]));
  }

  async function run() {
    var token = document.getElementById('tool-text').value.trim().replace(/\s+/g, '');
    out.clear();
    if (!token) { out.warn('Paste a JWT above.'); return; }

    var parts = token.split('.');
    if (parts.length !== 3) {
      out.err('That is not a JWT. A JWT has exactly three parts separated by dots:');
      out.err('header.payload.signature — this has ' + parts.length + '.');
      out.line('');
      out.dim('A two-part value may be an unsecured JWT; a single blob is more');
      out.dim('likely base64 or an opaque session id.');
      return;
    }

    var header, payload;
    try { header = JSON.parse(b64urlToText(parts[0])); }
    catch (e) { out.err('The header is not valid base64url JSON.'); return; }
    try { payload = JSON.parse(b64urlToText(parts[1])); }
    catch (e) { out.err('The payload is not valid base64url JSON.'); return; }

    /* Valid JSON is not the same thing as a JWT header. null, 7, "abc" and []
       all parse, and everything below this point reads properties off these
       two values, so the shape is checked once here rather than defended
       against nine times further down. */
    if (!isObj(header)) {
      out.err('The header decoded to ' + jsonType(header) + ', not a JSON object.');
      out.err('A JOSE header must be an object. Nothing here can be read as a');
      out.err('token — whatever produced it is not producing JWTs.');
      return;
    }

    out.heading('Header');
    out.line(JSON.stringify(header, null, 2));

    var hasAlg = Object.prototype.hasOwnProperty.call(header, 'alg');
    var alg = hasAlg ? header.alg : MISSING_ALG;
    /* What to call the algorithm in prose, for the branches that mention it.
       Capped: alg is attacker-controlled text and a thousand-character one
       would otherwise run away with the pane. */
    var algLabel = !hasAlg ? 'a missing alg'
      : typeof alg !== 'string' ? JSON.stringify(alg)
      : alg.trim() === '' ? 'an empty alg'
      : alg.length > 40 ? alg.slice(0, 40) + '…'
      : alg;

    out.line('');
    if (!hasAlg) {
      out.err('The header names no alg at all. A JOSE header is required to name');
      out.err('one, and a library that reads a missing alg as "none" will accept');
      out.err('this token unsigned — the alg:none bug reached from the other side.');
      out.err('Nothing here can be verified. Treat it as forged.');
    } else if (typeof alg !== 'string') {
      out.warn('alg is ' + algLabel + ', which is not a string. The header is');
      out.warn('malformed; a conforming verifier will reject this token.');
    } else if (alg.trim() === '') {
      out.err('alg is empty. That names no algorithm, and a verifier that falls');
      out.err('back to "unsigned" when it cannot read one accepts this token.');
      out.err('Treat it exactly as you would alg:none.');
    } else if (alg.toLowerCase() === 'none') {
      out.err('alg is "none" — this token is unsigned. Any server that accepts');
      out.err('it is trivially forgeable. This is a real and recurring bug.');
    }

    out.rule();
    out.heading('Payload');
    out.line(JSON.stringify(payload, null, 2));

    if (!isObj(payload)) {
      out.line('');
      out.err('The payload decoded to ' + jsonType(payload) + ', not a JSON object.');
      out.err('That is well-formed base64url and well-formed JSON, so the token');
      out.err('gets this far, but a JWT claims set has to be an object — there');
      out.err('are no claims to read and no exp to check.');
      return;
    }

    out.rule();
    out.heading('Claims explained');
    Object.keys(payload).forEach(function (k) {
      var meaning = CLAIMS[k] || 'custom claim';
      var value = payload[k];
      if ((k === 'exp' || k === 'iat' || k === 'nbf') && typeof value === 'number') {
        out.row(k, whenText(value));
        out.dim('    ' + meaning);
      } else {
        out.row(k, typeof value === 'object' ? JSON.stringify(value) : String(value));
        out.dim('    ' + meaning);
      }
    });

    out.rule();
    if (typeof payload.exp === 'number') {
      var expired = payload.exp * 1000 < Date.now();
      if (expired) out.err('EXPIRED — exp is in the past.');
      else out.ok('Not expired.');
    } else {
      out.warn('No exp claim — this token never expires on its own.');
    }
    if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) {
      out.warn('NOT YET VALID — nbf is in the future.');
    }

    var secret = document.getElementById('tool-key').value;
    out.rule();
    if (!secret) {
      out.dim('Signature not checked. Decoding never validates anything: the');
      out.dim('payload above is readable by design, and only the signature says');
      out.dim('whether it was tampered with. Paste the HMAC secret to verify.');
      return;
    }
    if (!algoSpec(alg)) {
      out.warn('Cannot verify ' + algLabel + ' here. RS/ES/PS algorithms are signed with');
      out.warn('a private key and verified with a public one — paste an HMAC-signed');
      out.warn('token (HS256/384/512) to check a signature in this tool.');
      return;
    }
    try {
      var ok = await verifyHmac(token, secret, alg);
      if (ok) out.ok('SIGNATURE VALID — the token was signed with that secret and is unmodified.');
      else out.err('SIGNATURE INVALID — wrong secret, or the token has been altered.');
    } catch (err) {
      out.err('Verification failed: ' + (err && err.message ? err.message : err));
    }
  }

  LabTool.define({
    id: 'jwttool',
    run: run,
    onReady: function () {
      out.dim('Paste a token and press Run, or Ctrl + Enter.');
      out.dim('');
      out.dim('Everything happens in this tab. That matters more here than');
      out.dim('anywhere else in Labs: a JWT is a bearer credential, and the');
      out.dim('usual advice to never paste one into a website exists because');
      out.dim('the usual decoders are websites with servers behind them.');
    }
  });
})();

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

  var CLAIMS = {
    iss: 'Issuer — who minted this token',
    sub: 'Subject — who it is about',
    aud: 'Audience — who is meant to accept it',
    exp: 'Expires at',
    nbf: 'Not valid before',
    iat: 'Issued at',
    jti: 'JWT ID — unique identifier',
    scope: 'Scope — granted permissions',
    azp: 'Authorised party',
    email: 'Email address',
    name: 'Display name',
    role: 'Role',
    roles: 'Roles'
  };

  function whenText(seconds) {
    var d = new Date(seconds * 1000);
    if (isNaN(d.getTime())) return String(seconds);
    var now = Date.now();
    var diff = d.getTime() - now;
    var mins = Math.round(Math.abs(diff) / 60000);
    var human;
    if (mins < 60) human = mins + ' minute' + (mins === 1 ? '' : 's');
    else if (mins < 1440) human = Math.round(mins / 60) + ' hours';
    else human = Math.round(mins / 1440) + ' days';
    return d.toISOString() + '  (' + human + (diff < 0 ? ' ago' : ' from now') + ')';
  }

  var ALGO = {
    HS256: { name: 'HMAC', hash: 'SHA-256' },
    HS384: { name: 'HMAC', hash: 'SHA-384' },
    HS512: { name: 'HMAC', hash: 'SHA-512' }
  };

  async function verifyHmac(token, secret, alg) {
    var parts = token.split('.');
    var spec = ALGO[alg];
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

    out.heading('Header');
    out.line(JSON.stringify(header, null, 2));

    var alg = header.alg || '(none)';
    out.line('');
    if (String(alg).toLowerCase() === 'none') {
      out.err('alg is "none" — this token is unsigned. Any server that accepts');
      out.err('it is trivially forgeable. This is a real and recurring bug.');
    }

    out.rule();
    out.heading('Payload');
    out.line(JSON.stringify(payload, null, 2));

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
    if (!ALGO[alg]) {
      out.warn('Cannot verify ' + alg + ' here. RS/ES/PS algorithms are signed with');
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

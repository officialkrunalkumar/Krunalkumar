/* ==========================================================================
   oauth-flow.js — walk the OAuth 2.0 authorization code flow, then attack it.
   --------------------------------------------------------------------------
   The site already has jwt (read the token), passkeys (replace the password)
   and totp (the second factor). All three are about the CREDENTIAL. Nothing
   here was about the PROTOCOL that issues one, which is where the bugs are:
   a JWT with a bad signature is caught by a library, an authorization code
   sent to the wrong token endpoint is not caught by anything.

   TWO TOOLS IN ONE, and the second is the reason to build it.

   Walk mode prints the whole flow with real values — a real 32-byte verifier
   from crypto.getRandomValues, a real S256 challenge from crypto.subtle. You
   can copy the challenge out and check it yourself. Nothing here is a mock-up
   of arithmetic; the only invented values are the ones an authorization
   server would invent anyway (the code, the tokens), and those are labelled.

   Attack mode is the half that teaches. Every OAuth diagram on the web shows
   the happy path, which is exactly the path nobody gets wrong. Steal the
   authorization code with PKCE off and the attacker walks away with an access
   token; turn PKCE on, steal the same code, and watch the token endpoint
   compute SHA-256 over the attacker's guess and refuse. That comparison is
   the entire argument for PKCE and it takes two runs to see.

   Audit mode is what makes it useful on a Tuesday. Paste the authorize URL
   your own application actually builds and it grades that URL: implicit flow,
   missing PKCE, plain challenge method, absent state, cleartext redirect,
   a client secret pasted somewhere a browser can read it.

   NOTHING IS FETCHED AND NOTHING IS SENT. There is no authorization server
   here. Every request and response below is constructed in this tab from the
   specification, which is also the honest way to demonstrate an attack: a
   tool that really did steal a code would need somewhere to send it.

   WHAT IT IS NOT. This does not test YOUR authorization server. It reasons
   about a URL and about the specification, so it can tell you a request omits
   PKCE, and it cannot tell you the server would have rejected it anyway. That
   boundary is printed in the output rather than buried here.

   PROSE IS WRAPPED TO THE PANE, NOT TO A NUMBER I GUESSED.

   This tool writes far more explanation than the other labs, and the first
   version hand-wrapped it at the width that looked right on a desktop. On a
   375px phone the terminal is thirty-four characters wide, so 64% of the
   lines wrapped a second time at arbitrary points and every carefully aligned
   indent came apart. say() measures the pane's real character advance and
   wraps to that, so the same paragraph reads correctly at 34 columns and at
   90. Protocol data — URLs, header lines, form bodies — is deliberately NOT
   reflowed: those are single tokens a reader may want to copy, and breaking
   one across lines to make it fit would be a lie about what was sent.

   Specifications leaned on: RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 9207
   (issuer identification), and the OAuth 2.0 Security Best Current Practice.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ------------------------------------------------------------------
     Output width, measured rather than assumed.
     ------------------------------------------------------------------ */

  var COLS = 72;

  /* Measured once per run: the pane can change width between runs (rotation,
     the fullscreen button, a resized window) and a cached value from the
     wrong orientation is worse than no caching at all. */
  function measureCols() {
    var pane = out.node;
    if (!pane) return 72;

    var cs = getComputedStyle(pane);

    /* clientWidth INCLUDES padding, and this pane has 16px of it on each
       side. Measuring against it gave 68 columns where only 64 fit, so every
       paragraph was wrapped four characters too wide and the last word of
       most of them fell onto a line of its own — the exact ragged output this
       whole function exists to prevent, produced by the function itself. */
    var usable = pane.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);

    /* clientWidth already excludes a scrollbar that is SHOWING. The one that
       bites is the scrollbar that is not showing yet: run() measures straight
       after clear(), when the pane is empty, and every mode here then writes
       enough output to make one appear — taking about two columns with it, so
       the last word of the widest paragraphs wrapped anyway. Reserve the
       gutter when the pane can scroll but is not scrolling at this instant. */
    if (/auto|scroll/.test(cs.overflowY) && pane.scrollHeight <= pane.clientHeight) {
      usable -= 16;
    }

    /* Under 120px is not a narrow phone, it is a pane that has not been laid
       out — a hidden tab, display:none, or a run that fired before layout
       settled. Measuring it would clamp every paragraph to the 26-column
       floor and produce a column of single words. A sane default beats a real
       measurement of nothing; run() re-measures, so the first press after the
       pane is visible corrects it. */
    if (usable < 120) return 72;

    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + cs.font;
    var sample = new Array(51).join('0');            // exactly 50 characters
    probe.textContent = sample;
    pane.appendChild(probe);
    var adv = probe.getBoundingClientRect().width / sample.length;
    probe.parentNode.removeChild(probe);
    if (!adv || !isFinite(adv)) return 72;

    /* One column of slack, and a floor of 26 so a very narrow pane degrades
       to short lines rather than to one word per line. */
    return Math.max(26, Math.min(92, Math.floor(usable / adv) - 1));
  }

  /* Wrap prose to COLS at word boundaries. A single word longer than the
     available width is emitted on its own line rather than broken: it will be
     a token like a base64url challenge, and hyphenating one silently produces
     a value that does not work when pasted. */
  function say(text, indent, cls) {
    indent = indent || '';
    var width = Math.max(12, COLS - indent.length);
    var words = String(text).split(/\s+/).filter(Boolean);
    var line = '';
    var i;
    for (i = 0; i < words.length; i++) {
      if (line && (line + ' ' + words[i]).length > width) {
        out.line(indent + line, cls);
        line = words[i];
      } else {
        line = line ? line + ' ' + words[i] : words[i];
      }
    }
    if (line) out.line(indent + line, cls);
  }

  function p(text) { say(text, '  ', 't-dim'); }
  function pw(text) { say(text, '  ', 't-warn'); }
  function pe(text) { say(text, '  ', 't-err'); }
  function po(text) { say(text, '  ', 't-ok'); }

  function rule() { out.dim(new Array(COLS + 1).join('─')); }

  /* A label/value pair. Wide panes get the aligned two-column form the other
     labs use; narrow ones get the label on its own line, because padding a
     22-character gutter into a 34-column pane leaves twelve columns for a
     43-character verifier. */
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
     Real values, not placeholders.
     ------------------------------------------------------------------ */

  function randomBytes(n) {
    var b = new Uint8Array(n);
    (self.crypto || self.msCrypto).getRandomValues(b);
    return b;
  }

  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      .then(function (buf) { return new Uint8Array(buf); });
  }

  /* A code or token that LOOKS like the real thing without pretending to be
     one. Prefixed so nobody copies a line out of here into a bug report and
     spends an afternoon on it. */
  function opaque(prefix, n) {
    return prefix + '_' + b64url(randomBytes(n)).slice(0, n);
  }

  /* ------------------------------------------------------------------
     A flow's worth of state.
     ------------------------------------------------------------------ */

  var DEFAULTS = {
    issuer: 'https://id.example.com',
    client: 'app-7f3c1b',
    redirect: 'https://app.example.com/callback',
    scope: 'openid profile email'
  };

  /* Tolerate a pasted request line ("GET /authorize?... HTTP/1.1") and a bare
     path, because that is how these arrive from a log or a browser address bar
     rather than as a tidy absolute URL. */
  function cleanInput(raw) {
    return String(raw || '').trim()
      .replace(/^[A-Z]+\s+/, '').replace(/\s+HTTP\/[\d.]+$/, '').trim();
  }

  function parseUrl(raw) {
    var text = cleanInput(raw);
    if (!text) return null;
    try {
      return new URL(text, /^https?:/i.test(text) ? undefined : 'https://id.example.com');
    } catch (e) { return null; }
  }

  /* Seed from a pasted authorize URL where one is present, so walking the flow
     and auditing the same URL talk about the same application rather than
     about two different imaginary ones. */
  function seedFrom(raw) {
    var s = {
      issuer: DEFAULTS.issuer, client: DEFAULTS.client,
      redirect: DEFAULTS.redirect, scope: DEFAULTS.scope
    };
    var u = parseUrl(raw);
    if (!u) return s;
    if (/^https?:/i.test(cleanInput(raw))) s.issuer = u.origin;
    if (u.searchParams.get('client_id')) s.client = u.searchParams.get('client_id');
    if (u.searchParams.get('redirect_uri')) s.redirect = u.searchParams.get('redirect_uri');
    if (u.searchParams.get('scope')) s.scope = u.searchParams.get('scope');
    return s;
  }

  /* Build a session: PKCE pair, state, nonce. Resolves because S256 is a real
     digest and crypto.subtle is asynchronous. */
  function session(seed, pkce) {
    var s = {
      issuer: seed.issuer, client: seed.client,
      redirect: seed.redirect, scope: seed.scope,
      state: b64url(randomBytes(16)),
      nonce: b64url(randomBytes(16)),
      code: opaque('code', 32),
      verifier: null, challenge: null, method: null
    };
    if (pkce === 'none') return Promise.resolve(s);
    /* RFC 7636 §4.1: 43–128 characters from the unreserved set. 32 random
       bytes base64url is 43 characters, which is the minimum and is what every
       sane library emits. */
    s.verifier = b64url(randomBytes(32));
    if (pkce === 'plain') {
      s.challenge = s.verifier;
      s.method = 'plain';
      return Promise.resolve(s);
    }
    s.method = 'S256';
    return sha256(s.verifier).then(function (d) {
      s.challenge = b64url(d);
      return s;
    });
  }

  function authorizeUrl(s) {
    var q = [];
    q.push('response_type=code');
    q.push('client_id=' + encodeURIComponent(s.client));
    q.push('redirect_uri=' + encodeURIComponent(s.redirect));
    q.push('scope=' + encodeURIComponent(s.scope));
    q.push('state=' + s.state);
    if (/\bopenid\b/.test(s.scope)) q.push('nonce=' + s.nonce);
    if (s.challenge) {
      q.push('code_challenge=' + s.challenge);
      q.push('code_challenge_method=' + s.method);
    }
    return s.issuer + '/authorize?' + q.join('&');
  }

  /* One parameter per line. A 300-character URL on one line is a horizontal
     scrollbar on a phone and nobody reads it. The parameters themselves are
     never reflowed — a code_challenge broken across two lines is a value that
     does not work when copied. */
  function printUrl(url, cls) {
    var cut = url.indexOf('?');
    if (cut === -1) { out.line('  ' + url, cls); return; }
    out.line('  ' + url.slice(0, cut) + '?', cls);
    url.slice(cut + 1).split('&').forEach(function (pair, i, all) {
      out.line('    ' + pair + (i < all.length - 1 ? '&' : ''), cls);
    });
  }

  function step(n, title) {
    out.line('');
    say(n + '. ' + title, '', 't-info');
  }

  /* ------------------------------------------------------------------
     Walk: the flow as it is supposed to go.
     ------------------------------------------------------------------ */

  function walk(s) {
    say('Authorization code flow' +
      (s.challenge ? ' with PKCE (' + s.method + ')' : ', no PKCE'), '', 't-info');
    say('Every value below is generated in this tab. Nothing is fetched.', '', 't-dim');
    rule();

    step(1, 'The client builds an authorization request');
    if (s.verifier) {
      kv('code_verifier', s.verifier);
      p('43 characters, 32 random bytes base64url. Kept in the client. Never sent yet.');
      kv('code_challenge', s.challenge);
      if (s.method === 'S256') {
        p('base64url(SHA-256(verifier)). Safe to send: the digest cannot be reversed.');
      } else {
        pw('method=plain, so the challenge IS the verifier. Anyone who can read this ' +
           'request can complete the exchange. Use S256.');
      }
      out.line('');
    }
    kv('state', s.state);
    p('Bound to the user\'s session. Comes back on the redirect and must match.');
    out.line('');
    p('The browser is sent to:');
    printUrl(authorizeUrl(s), 't-ok');

    step(2, 'The user authenticates and consents');
    p('This happens entirely on ' + s.issuer + '. The client never sees the password, ' +
      'which is the whole point of doing it this way.');

    step(3, 'The authorization server redirects back with a code');
    out.line('  HTTP/1.1 302 Found', 't-ok');
    printUrl('Location: ' + s.redirect + '?code=' + s.code + '&state=' + s.state +
             '&iss=' + encodeURIComponent(s.issuer), 't-ok');
    out.line('');
    p('The code travels through the browser, so it is visible in history, in the ' +
      'Referer of anything the callback page loads, and in any proxy log along the ' +
      'way. It is deliberately short-lived and single-use for that reason — and on ' +
      'its own that is not enough, which is step 5.');
    out.line('');
    p('iss identifies which server answered (RFC 9207). A client that talks to more ' +
      'than one provider needs it — see the mix-up attack.');

    step(4, 'The client checks state before doing anything else');
    kv('state returned', s.state, 't-ok');
    kv('state expected', s.state, 't-ok');
    po('Match. This response belongs to the flow this browser started.');

    step(5, 'The client exchanges the code for tokens');
    out.line('  POST ' + s.issuer + '/token', 't-ok');
    out.line('  Content-Type: application/x-www-form-urlencoded', 't-ok');
    out.line('');
    out.line('    grant_type=authorization_code', 't-ok');
    out.line('    code=' + s.code, 't-ok');
    out.line('    redirect_uri=' + s.redirect, 't-ok');
    out.line('    client_id=' + s.client, 't-ok');
    if (s.verifier) out.line('    code_verifier=' + s.verifier, 't-ok');
    out.line('');
    if (s.verifier) {
      p('Back channel: this request comes from the client, not the browser. The ' +
        'verifier is seen here for the first time.');
      out.line('');
      if (s.method === 'S256') {
        p('The server recomputes the digest and compares base64url(SHA-256(code_verifier)) ' +
          'against the stored code_challenge:');
        out.line('    ' + s.challenge, 't-ok');
        out.line('    ' + s.challenge, 't-ok');
        po('Equal, so this is the client that started the flow.');
      } else {
        p('The server compares the verifier to the stored challenge as strings.');
      }
    } else {
      pw('No verifier, because no challenge was sent. Possession of the code is the ' +
         'only thing being proven here. Whoever holds it can do this.');
    }

    step(6, 'Tokens come back');
    out.line('  HTTP/1.1 200 OK', 't-ok');
    out.line('  Content-Type: application/json', 't-ok');
    out.line('  Cache-Control: no-store', 't-ok');
    out.line('');
    out.line('    {', 't-ok');
    out.line('      "access_token":  "' + opaque('at', 32) + '",', 't-ok');
    out.line('      "token_type":    "Bearer",', 't-ok');
    out.line('      "expires_in":    3600,', 't-ok');
    out.line('      "refresh_token": "' + opaque('rt', 32) + '",', 't-ok');
    if (/\bopenid\b/.test(s.scope)) {
      out.line('      "id_token":      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9…"', 't-ok');
    }
    out.line('    }', 't-ok');
    out.line('');
    p('The access token and refresh token are opaque here; a real server may issue a ' +
      'JWT instead. Paste one into the JWT decoder to take it apart.');
    if (/\bopenid\b/.test(s.scope)) {
      out.line('');
      pw('The id_token is for the CLIENT, proving who signed in. It is not an API ' +
         'credential. Sending it to your backend as one is the single most common ' +
         'OpenID Connect mistake — verify its signature, issuer, audience and the ' +
         'nonce you sent in step 1.');
    }

    out.line('');
    rule();
    if (s.method === 'S256') {
      po('This flow resists a stolen authorization code. Run the code-theft attack ' +
         'with PKCE on and then off to see exactly what that buys you.');
    } else {
      pw('This flow does NOT resist a stolen authorization code. Run the code-theft ' +
         'attack to see what an attacker does with one.');
    }
  }

  /* ------------------------------------------------------------------
     Attacks. Each prints what the attacker does and what stops them.
     ------------------------------------------------------------------ */

  function attackCodeTheft(s) {
    say('Attack: stolen authorization code', '', 't-info');
    say('PKCE: ' + (s.method ? s.method : 'not used'), '', 't-dim');
    rule();

    out.line('');
    p('How a code gets stolen, in order of how often it actually happens:');
    p('· a malicious app registers the same custom URI scheme on the device');
    p('· the callback page loads a third-party script and leaks the Referer');
    p('· an open redirect on the client bounces the query somewhere else');
    p('· a proxy, a crash reporter or an access log keeps the full URL');
    out.line('');
    pw('The attacker now holds the code. The attacker does NOT hold the client\'s ' +
       'code_verifier.');
    out.line('    code=' + s.code, 't-warn');

    step(1, 'The attacker calls the token endpoint');
    out.line('  POST ' + s.issuer + '/token', 't-err');
    out.line('    grant_type=authorization_code', 't-err');
    out.line('    code=' + s.code, 't-err');
    out.line('    redirect_uri=' + s.redirect, 't-err');
    out.line('    client_id=' + s.client, 't-err');
    if (s.method) {
      out.line('    code_verifier=' + b64url(randomBytes(32)), 't-err');
      p('…which is a guess. They have to send something.');
    }

    step(2, 'What the server does');
    if (!s.method) {
      out.line('  HTTP/1.1 200 OK', 't-err');
      out.line('    {', 't-err');
      out.line('      "access_token": "' + opaque('at', 32) + '",', 't-err');
      out.line('      …', 't-err');
      out.line('    }', 't-err');
      out.line('');
      pe('STOLEN. Nothing in this exchange proves the caller is the client that ' +
         'started the flow. The code was the only secret and it travelled through ' +
         'the browser.');
      out.line('');
      p('A client secret does not save you here either: public clients — every ' +
        'mobile app and every single-page app — cannot keep one. That is the gap ' +
        'PKCE was written to close.');
    } else if (s.method === 'plain') {
      out.line('  HTTP/1.1 400 Bad Request', 't-warn');
      out.line('    { "error": "invalid_grant" }', 't-warn');
      out.line('');
      pw('Blocked — but only because this attacker never saw the authorization ' +
         'request. With method=plain the challenge equals the verifier, so an ' +
         'attacker positioned to read the request in step 1 reads the verifier too ' +
         'and walks straight through. Use S256.');
    } else {
      out.line('  HTTP/1.1 400 Bad Request', 't-ok');
      out.line('    { "error": "invalid_grant" }', 't-ok');
      out.line('');
      p('The server recomputed the digest over the guess and compared it to the ' +
        'stored challenge:');
      out.line('    ' + b64url(randomBytes(32)), 't-err');
      out.line('    ' + s.challenge, 't-ok');
      po('No match. The code is refused and burned.');
      out.line('');
      po('BLOCKED. The code alone is worthless. Proving you started the flow needs ' +
         'the verifier, which never left the client.');
    }
  }

  function attackNoState(s) {
    say('Attack: login CSRF via a missing or unchecked state', '', 't-info');
    rule();
    out.line('');
    p('This one runs backwards from what people expect. The attacker is not stealing ' +
      'the victim\'s account — they are giving the victim THEIRS.');

    step(1, 'The attacker starts a normal flow as themselves');
    p('They log in at ' + s.issuer + ' with their own credentials and stop at the ' +
      'redirect, keeping the code instead of spending it.');
    out.line('    attacker code = ' + opaque('code', 32), 't-warn');

    step(2, 'They get the victim\'s browser to visit the callback');
    p('An image tag, a link, anything:');
    printUrl(s.redirect + '?code=' + opaque('code', 32), 't-err');

    step(3, 'What the client does');
    p('Without a state check:');
    pe('The client exchanges the code, gets the ATTACKER\'s tokens, and attaches the ' +
       'attacker\'s identity to the victim\'s session.');
    out.line('');
    p('The victim is now signed in as the attacker without noticing. Anything they ' +
      'save — a document, a payment method, a linked account — lands in the ' +
      'attacker\'s account, where the attacker can read it later.');
    out.line('');
    p('With a state check:');
    kv('state returned', '(absent, or the attacker\'s)', 't-err');
    kv('state expected', s.state, 't-ok');
    po('Mismatch. The response is dropped before the code is spent.');
    out.line('');
    p('state must be bound to the browser session — a cookie or session store — and ' +
      'compared server-side. A state the client merely echoes back to itself from ' +
      'the URL proves nothing.');
    out.line('');
    p('PKCE incidentally blocks this too, because the attacker\'s code was issued ' +
      'against the attacker\'s challenge. Send both anyway: they answer different ' +
      'questions, and OAuth 2.1 expects both.');
  }

  function attackRedirect(s) {
    say('Attack: a redirect_uri that was matched loosely', '', 't-info');
    rule();
    out.line('');
    p('The authorization server will send the code wherever redirect_uri says, so how ' +
      'that value is matched against the registered one is load-bearing.');

    step(1, 'What was registered');
    kv('registered', s.redirect);

    step(2, 'What the attacker asks for');
    var host = s.redirect.replace(/^https?:\/\//, '').split('/')[0];
    p('Prefix matching — a registered value treated as a starting string:');
    out.line('    ' + s.redirect + '.evil.example/steal', 't-err');
    p('Subdomain wildcards — one forgotten dangling DNS record is enough:');
    out.line('    https://abandoned.' + host.replace(/^[^.]+\./, '') + '/steal', 't-err');
    p('An unchecked query or fragment on an otherwise correct callback:');
    printUrl(s.redirect + '?next=https://evil.example', 't-err');
    p('A path traversal past a directory match:');
    /* printUrl rather than one line: with the traversal and the target this
       runs to eighty characters, past even a desktop pane. Splitting it at the
       query string is the shape every other URL here is printed in. */
    printUrl(s.redirect + '/../../open-redirect?to=https://evil.example', 't-err');

    step(3, 'What stops all four');
    po('Exact string comparison against the full registered URI. Not a prefix, not a ' +
       'regular expression, not a wildcard host, not "starts with".');
    out.line('');
    p('This is the one OAuth rule with no nuance to it, and it is the one most often ' +
      'relaxed during development and never tightened afterwards.');
    out.line('');
    p('PKCE does not save you here: the code is delivered to the attacker\'s page, ' +
      'which is running the client\'s own JavaScript in a single-page app and can ' +
      'often read the verifier out of storage as well.');
  }

  function attackReplay(s) {
    say('Attack: replaying an authorization code', '', 't-info');
    rule();

    step(1, 'The legitimate client spends the code');
    out.line('  POST /token   code=' + s.code, 't-ok');
    out.line('  HTTP/1.1 200 OK', 't-ok');
    out.line('    { "access_token": "…", "refresh_token": "…" }', 't-ok');

    step(2, 'Someone spends it again');
    out.line('  POST /token   code=' + s.code, 't-err');
    out.line('  HTTP/1.1 400 Bad Request', 't-ok');
    out.line('    { "error": "invalid_grant" }', 't-ok');
    out.line('');
    po('RFC 6749 §4.1.2: an authorization code MUST be single-use.');

    step(3, 'And the part people leave out');
    pw('On reuse the server SHOULD revoke every token already issued from that code.');
    out.line('');
    p('The reasoning: a second use means the code reached someone it should not have. ' +
      'The first exchange may well have been the attacker and the second the real ' +
      'client. Refusing only the second request leaves the attacker holding a working ' +
      'access token.');
    out.line('');
    p('The same argument applies to refresh tokens for public clients, which is why ' +
      'rotation with reuse detection is the current recommendation.');
  }

  function attackMixup(s) {
    say('Attack: mix-up between two identity providers', '', 't-info');
    rule();
    out.line('');
    p('Only applies to a client that offers a choice of provider — "sign in with A or ' +
      'B". That is most consumer applications.');

    step(1, 'The setup');
    kv('honest provider', s.issuer);
    kv('attacker provider', 'https://id.attacker.example');
    p('The attacker runs a real, working authorization server. Anyone can.');

    step(2, 'The victim picks the attacker\'s provider');
    pe('The attacker\'s /authorize does not authenticate anybody. It redirects the ' +
       'browser onward to the HONEST provider, carrying the client\'s own client_id ' +
       'and redirect_uri.');

    step(3, 'The victim authenticates at the honest provider');
    pw('A real login page, a real domain, a real padlock. Nothing looks wrong. The ' +
       'code comes back to the client\'s real callback.');

    step(4, 'The client sends the code to the wrong token endpoint');
    p('It still believes this flow belongs to the attacker\'s provider, so:');
    out.line('    POST https://id.attacker.example/token', 't-err');
    out.line('    code=' + s.code, 't-err');
    pe('The attacker now holds a code minted by the honest provider and exchanges it ' +
       'there for the victim\'s tokens.');

    step(5, 'What stops it');
    po('RFC 9207: the authorization response carries iss, and the client checks it ' +
       'against the provider it thinks it is talking to.');
    out.line('');
    out.line('    iss=' + encodeURIComponent(s.issuer), 't-ok');
    out.line('');
    p('Failing that, use a separate redirect_uri per provider — then the callback ' +
      'that fires tells you unambiguously which flow this is.');
    out.line('');
    p('PKCE does not stop this one either. The client is a willing participant and ' +
      'sends its own verifier to the attacker.');
  }

  /* ------------------------------------------------------------------
     Audit: grade a real authorization request URL.
     ------------------------------------------------------------------ */

  function audit(raw) {
    var u = parseUrl(raw);
    if (!u) {
      out.err('That does not parse as a URL.');
      out.line('');
      p('Paste the full authorize request your application builds, for example:');
      out.line('    https://id.example.com/authorize?response_type=code&client_id=…', 't-dim');
      out.line('');
      p('A pasted request line or a bare path with a query string is fine too.');
      return;
    }

    var q = u.searchParams;

    /* REFUSE A STRING THAT IS NOT A REQUEST.

       The relative fallback above is generous on purpose — a bare
       "/authorize?client_id=…" out of a log should audit. But generous means
       "not a url at all" also parses, as a path under an invented origin, and
       the audit then reported five confident problems about a sentence:
       response_type missing, no PKCE, no state. Every one of those is
       technically true of the string and none of them means anything.

       A request with no query parameters at all is the tell. There is no such
       thing as an authorization request without them, so this is the input
       being wrong rather than the request being bad. */
    if (Array.from(q.keys()).length === 0) {
      out.err('That has no query parameters, so it is not an authorization request.');
      out.line('');
      p('An authorize URL carries at least response_type and client_id:');
      out.line('    https://id.example.com/authorize?response_type=code&client_id=…', 't-dim');
      out.line('');
      p('Copy it from your browser\'s address bar the moment the provider\'s login ' +
        'page appears, from your client library\'s debug log, or from DevTools → ' +
        'Network → the /authorize request.');
      out.line('');
      p('Read as: ' + u.href);
      return;
    }

    var findings = [];
    function bad(what, why) { findings.push({ level: 'err', what: what, why: why }); }
    function warn(what, why) { findings.push({ level: 'warn', what: what, why: why }); }
    function good(what, why) { findings.push({ level: 'ok', what: what, why: why }); }

    /* Only print an endpoint that was really in the input. A relative paste
       gets its origin from the fallback above, and printing that invented host
       as "endpoint" reads as though the tool learned it from the URL. */
    var absolute = /^https?:/i.test(cleanInput(raw));
    say('Authorization request audit', '', 't-info');
    kv('endpoint', absolute ? u.origin + u.pathname : u.pathname + '  (host not in the paste)');
    kv('parameters', Array.from(q.keys()).length);
    rule();
    out.line('');

    /* --- the endpoint itself --- */
    if (absolute && u.protocol === 'http:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
      bad('the authorize endpoint is cleartext http',
        'Every parameter below travels unencrypted, and so does the user\'s session ' +
        'with the provider. RFC 6749 requires TLS on this endpoint.');
    }

    /* --- response_type: which flow is this even --- */
    var rt = (q.get('response_type') || '').trim();
    if (!rt) {
      bad('response_type missing', 'Required by RFC 6749. The server will reject this.');
    } else if (rt === 'code') {
      good('response_type=code', 'Authorization code flow, which is the right one.');
    } else if (/\btoken\b/.test(rt)) {
      bad('response_type=' + rt + ' — implicit flow',
        'Tokens are returned in the URL fragment: browser history, Referer and any ' +
        'script on the page can read them, and there is no client authentication at ' +
        'all. Removed in OAuth 2.1. Move to code + PKCE.');
    } else if (/id_token/.test(rt)) {
      warn('response_type=' + rt + ' — hybrid flow',
        'Valid, but it puts an id_token in the redirect. Only worth the extra care ' +
        'if you genuinely need the token before the code exchange.');
    } else {
      warn('response_type=' + rt, 'Not a value this tool recognises.');
    }

    /* --- PKCE --- */
    var chal = q.get('code_challenge');
    var meth = (q.get('code_challenge_method') || '').trim();
    if (!chal) {
      bad('no code_challenge — PKCE is not in use',
        'A stolen authorization code is enough to obtain tokens. Required for every ' +
        'client in OAuth 2.1, not only public ones.');
    } else if (meth === 'S256') {
      if (chal.length === 43 && /^[A-Za-z0-9_-]+$/.test(chal)) {
        good('PKCE S256', 'Challenge is 43 base64url characters, which is what a SHA-256 digest gives.');
      } else {
        warn('PKCE S256, but the challenge looks wrong',
          'Expected 43 base64url characters; this is ' + chal.length + '. Check for ' +
          'padding, or for a hex digest where base64url was meant.');
      }
    } else if (meth === 'plain' || !meth) {
      bad('PKCE method is ' + (meth ? 'plain' : 'unset, which defaults to plain'),
        'The challenge equals the verifier, so anyone who can read the authorization ' +
        'request can complete the exchange. Use S256.');
    } else {
      warn('code_challenge_method=' + meth, 'Only plain and S256 are defined.');
    }

    /* --- state --- */
    var state = q.get('state');
    if (!state) {
      if (chal) {
        warn('no state', 'PKCE covers most of what state covers, but OAuth 2.1 still ' +
          'expects it and it is what carries your own return-to-page context.');
      } else {
        bad('no state, and no PKCE either',
          'Nothing binds the callback to the browser that started the flow. Login CSRF ' +
          'is open.');
      }
    } else if (state.length < 8) {
      warn('state is only ' + state.length + ' characters', 'Make it unguessable — 16 random bytes.');
    } else {
      good('state present', state.length + ' characters. Confirm it is compared server-side, not just echoed.');
    }

    /* --- redirect_uri --- */
    var redir = q.get('redirect_uri');
    if (!redir) {
      warn('no redirect_uri', 'Allowed when exactly one is registered. Sending it explicitly is clearer.');
    } else {
      var r = null;
      try { r = new URL(redir); } catch (e) { r = null; }
      if (!r) {
        bad('redirect_uri does not parse', redir);
      } else if (r.protocol === 'http:' && r.hostname !== 'localhost' && r.hostname !== '127.0.0.1') {
        bad('redirect_uri is cleartext http', 'The authorization code is delivered over an unencrypted hop.');
      } else if (r.hostname === 'localhost' || r.hostname === '127.0.0.1') {
        good('redirect_uri is loopback', 'Fine for a native app or local development.');
      } else {
        good('redirect_uri is https', r.origin + r.pathname);
      }
      if (r && (r.search || r.hash)) {
        warn('redirect_uri carries a query or fragment',
          'Registration must then match it exactly, and any parameter the callback ' +
          'forwards is a candidate open redirect.');
      }
      if (/\*/.test(redir)) {
        bad('redirect_uri contains a wildcard', 'Redirect matching must be an exact string comparison.');
      }
    }

    /* --- secrets that should never be here --- */
    ['client_secret', 'password', 'access_token', 'refresh_token', 'id_token'].forEach(function (k) {
      if (q.get(k)) {
        bad(k + ' is in the authorization URL',
          'This travels through the browser: history, Referer, server logs, the ' +
          'address bar. Treat it as disclosed and rotate it.');
      }
    });

    /* --- scope --- */
    var scope = (q.get('scope') || '').trim();
    if (!scope) {
      warn('no scope', 'The server applies its default, which is rarely the least privilege you wanted.');
    } else {
      var parts = scope.split(/\s+/);
      good('scope', parts.length + ' requested: ' + parts.join(', '));
      if (/\b(admin|write|\*|full_access|offline_access)\b/i.test(scope)) {
        warn('scope includes a broad grant',
          'Ask for it at the moment it is needed rather than at first sign-in — the ' +
          'consent screen is the one place a user reads what you asked for.');
      }
      if (/\bopenid\b/.test(scope) && !q.get('nonce')) {
        warn('openid requested without nonce',
          'nonce binds the id_token to this request. Send it, and verify it comes ' +
          'back in the token.');
      }
    }

    /* --- report --- */
    var order = { err: 0, warn: 1, ok: 2 };
    findings.sort(function (a, b) { return order[a.level] - order[b.level]; });

    var counts = { err: 0, warn: 0, ok: 0 };
    findings.forEach(function (f) { counts[f.level]++; });

    findings.forEach(function (f) {
      var mark = f.level === 'err' ? '[!]' : (f.level === 'warn' ? '[~]' : '[+]');
      say(mark + ' ' + f.what, '', 't-' + (f.level === 'err' ? 'err' : (f.level === 'warn' ? 'warn' : 'ok')));
      say(f.why, '    ', 't-dim');
      out.line('');
    });

    rule();
    kv('problems', counts.err, counts.err ? 't-err' : 't-ok');
    kv('worth a look', counts.warn, counts.warn ? 't-warn' : 't-ok');
    kv('correct', counts.ok, 't-ok');
    out.line('');
    if (counts.err) {
      pe('Fix the problems above before this goes near production.');
    } else if (counts.warn) {
      pw('Nothing broken, but the items above are worth a decision.');
    } else {
      po('This request follows current guidance.');
    }
    out.line('');
    p('This reads the URL and nothing else. It cannot tell you whether the server ' +
      'enforces any of it, whether redirect_uri is registered exactly, or whether ' +
      'state is really compared. Those live in code this tool cannot see.');
  }

  /* ------------------------------------------------------------------
     Dispatch.
     ------------------------------------------------------------------ */

  var ATTACKS = {
    'attack-theft': attackCodeTheft,
    'attack-state': attackNoState,
    'attack-redirect': attackRedirect,
    'attack-replay': attackReplay,
    'attack-mixup': attackMixup
  };

  function modeEl() { return document.getElementById('tool-mode'); }
  function pkceEl() { return document.getElementById('tool-pkce'); }

  function run() {
    out.clear();
    COLS = measureCols();
    var mode = modeEl() ? modeEl().value : 'walk';
    var pkce = pkceEl() ? pkceEl().value : 'S256';
    var raw = (document.getElementById('tool-text') || {}).value || '';

    if (mode === 'audit') {
      try { audit(raw); }
      catch (e) { out.err('Could not audit that: ' + e.message); }
      return;
    }

    session(seedFrom(raw), pkce).then(function (s) {
      if (mode === 'walk') walk(s);
      else if (ATTACKS[mode]) ATTACKS[mode](s);
      else out.err('Unknown mode.');
    }).catch(function (e) {
      out.err('Could not build the flow: ' + e.message);
      p('This needs crypto.subtle, which browsers expose only on a secure origin.');
    });
  }

  /* PKCE is meaningless in audit mode — that reads whatever the pasted URL
     says — so the control is disabled rather than left there implying it
     changes something. */
  function syncControls() {
    var m = modeEl();
    var k = pkceEl();
    if (!m || !k) return;
    var off = m.value === 'audit';
    k.disabled = off;
    k.setAttribute('aria-disabled', off ? 'true' : 'false');
  }

  LabTool.define({
    id: 'oauthflowtool',
    run: run,
    onReady: function () {
      var m = modeEl();
      if (m) m.addEventListener('change', syncControls);
      syncControls();
      COLS = measureCols();
      p('Pick a mode and press Run.');
      out.line('');
      p('Walk the flow — every step with real PKCE values, generated here.');
      p('An attack — what the attacker sends, and what refuses it.');
      p('Audit a URL — paste your own authorize request and have it graded.');
      out.line('');
      p('There is no authorization server behind this page. Nothing is fetched and ' +
        'nothing you paste leaves the tab.');
    }
  });
})();

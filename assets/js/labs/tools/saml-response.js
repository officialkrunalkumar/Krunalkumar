/* ==========================================================================
   saml-response.js — take a SAML response apart and check the things that
   actually go wrong.
   --------------------------------------------------------------------------
   jwt reads the token a modern app gets. This reads the one enterprise SSO
   still runs on, and SAML fails differently: a JWT with a broken signature is
   rejected by a library in one line, while a SAML response can be perfectly
   well-formed, carry a perfectly valid signature, and still log the wrong
   person in.

   IT DOES NOT VERIFY THE SIGNATURE, AND SAYS SO EVERYWHERE. Verification
   needs the IdP's certificate and a correct XML canonicalisation, and neither
   is available in a browser tab you pasted into. What it does instead is the
   part tools skip: report WHAT is signed. Signing the Response but validating
   the Assertion — or the reverse — is the single most common SAML integration
   bug, and you can see it without a certificate.

   XML SIGNATURE WRAPPING gets a real check. The attack is to keep a genuinely
   signed assertion in the document and add a second, unsigned one that the
   application reads instead. Every part of that is visible in the structure:
   more assertions than signatures, a Reference URI pointing at an ID that no
   element carries, or a signed element that is not the one an implementation
   would naturally pick. None of it needs a key.

   THE COMMENT TRICK is checked too. Some XML libraries return only the text
   node before a comment, so <NameID>admin@corp.com<!---->.attacker.example
   </NameID> reads as one identity to the signature check and another to the
   application. It broke several major implementations in 2018 and it is two
   lines to test for.

   NOTHING IS UPLOADED. A SAML response contains a real person's identity,
   often their email, employee number and group memberships, and it is a live
   credential until it expires. Every online SAML decoder is a hosted service.
   This one is arithmetic in your tab.

   Specifications: SAML 2.0 Core, SAML 2.0 Bindings, the SAML 2.0 Security and
   Privacy Considerations, and XML Signature (RFC 3275).

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

  function measureCols() {
    var pane = out.node;
    if (!pane) return 72;
    var cs = getComputedStyle(pane);
    var usable = pane.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
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

  function kv(label, value, cls) {
    var v = String(value === null || value === undefined || value === '' ? '(absent)' : value);
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
     Getting from what people paste to XML.
     ------------------------------------------------------------------ */

  function b64ToBytes(s) {
    var bin = atob(String(s).replace(/\s+/g, ''));
    var b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  }

  /* HTTP-Redirect binding DEFLATEs the message before base64, with no zlib
     header — 'deflate-raw'. HTTP-POST does not. Rather than ask which binding
     produced the paste, try the plain decode and fall back to inflating,
     because nobody reading a bug report knows which one they copied. */
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no DecompressionStream'));
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Response(ds.readable).arrayBuffer().then(function (buf) {
      return new TextDecoder().decode(buf);
    }, function () {
      /* new Response(stream) is the shortest way to drain a stream, and when
         the stream errors its rejection reads "Failed to fetch". On a page
         whose entire claim is that nothing is fetched, surfacing that is not
         merely unhelpful — it is the tool contradicting itself in front of the
         one reader who is checking. Throw something true instead. */
      throw new Error('not deflate');
    });
  }

  function looksLikeXml(s) { return /^\s*<\s*[A-Za-z_?]/.test(s); }

  /* Accepts: raw XML, base64, URL-encoded base64, a whole
     "SAMLResponse=..." form field, and the deflated redirect-binding form. */
  function toXml(raw) {
    var text = String(raw).trim();
    if (!text) return Promise.reject(new Error('empty'));

    if (looksLikeXml(text)) return Promise.resolve(text);

    /* Pull the value out of a pasted form body or query string. */
    var m = text.match(/(?:SAMLResponse|SAMLRequest|SAMLart)=([^&\s]+)/i);
    if (m) text = m[1];
    if (/%[0-9A-Fa-f]{2}/.test(text)) {
      try { text = decodeURIComponent(text); } catch (e) { /* leave as-is */ }
    }
    text = text.replace(/\s+/g, '');

    var bytes;
    try { bytes = b64ToBytes(text); }
    catch (e) { return Promise.reject(new Error('not base64')); }

    var asText = new TextDecoder().decode(bytes);
    if (looksLikeXml(asText)) return Promise.resolve(asText);

    return inflateRaw(bytes).then(function (s) {
      if (looksLikeXml(s)) return s;
      throw new Error('decoded, but not XML');
    });
  }

  /* ------------------------------------------------------------------
     Namespace-agnostic DOM helpers. Every IdP prefixes differently
     (samlp:, saml2p:, ns0:, none at all), so match on localName.
     ------------------------------------------------------------------ */

  function all(root, name) {
    var list = root.getElementsByTagName('*');
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].localName === name) hits.push(list[i]);
    }
    return hits;
  }
  function one(root, name) { return all(root, name)[0] || null; }
  function text(el) { return el ? String(el.textContent).trim() : ''; }
  function attr(el, name) { return el ? (el.getAttribute(name) || '') : ''; }

  /* ------------------------------------------------------------------
     Time.
     ------------------------------------------------------------------ */

  function when(iso) {
    if (!iso) return null;
    var t = Date.parse(iso);
    return isNaN(t) ? null : t;
  }

  function ago(ms) {
    var s = Math.round(Math.abs(ms) / 1000);
    var unit = 'second';
    var n = s;
    if (s >= 3600) { n = Math.round(s / 360) / 10; unit = 'hour'; }
    else if (s >= 60) { n = Math.round(s / 6) / 10; unit = 'minute'; }
    return n + ' ' + unit + (n === 1 ? '' : 's') + (ms < 0 ? ' ago' : ' from now');
  }

  /* ------------------------------------------------------------------
     The report.
     ------------------------------------------------------------------ */

  function report(xml) {
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) {
      out.err('That decoded, but it is not well-formed XML.');
      p(String(err.textContent).replace(/\s+/g, ' ').slice(0, 240));
      return;
    }

    var root = doc.documentElement;
    var kind = root.localName;
    var findings = [];
    function bad(w, why) { findings.push({ lv: 'err', w: w, why: why }); }
    function warn(w, why) { findings.push({ lv: 'warn', w: w, why: why }); }
    function good(w, why) { findings.push({ lv: 'ok', w: w, why: why }); }

    say('SAML ' + kind, '', 't-info');
    rule();

    /* ---- the envelope ---- */
    kv('Issuer', text(one(root, 'Issuer')));
    kv('Destination', attr(root, 'Destination'));
    kv('IssueInstant', attr(root, 'IssueInstant'));
    var inResponseTo = attr(root, 'InResponseTo');
    kv('InResponseTo', inResponseTo);
    kv('ID', attr(root, 'ID'));

    var status = one(root, 'StatusCode');
    var statusCode = attr(status, 'Value').replace(/^.*:/, '');
    if (status) {
      kv('Status', statusCode, statusCode === 'Success' ? 't-ok' : 't-err');
      var msg = one(root, 'StatusMessage');
      if (msg) kv('StatusMessage', text(msg), 't-warn');
    }

    if (statusCode && statusCode !== 'Success') {
      out.line('');
      pw('This is a failure response, so there is no assertion to inspect. ' +
         'The status code above is what the IdP is objecting to.');
      out.line('');
    }

    if (!inResponseTo) {
      warn('no InResponseTo — this is an unsolicited response',
        'Valid for IdP-initiated SSO, and it means nothing ties this response to ' +
        'a request your service provider made. Anyone who obtains one can replay ' +
        'it until it expires. Prefer SP-initiated flows, and reject unsolicited ' +
        'responses outright where you can.');
    }

    /* ---- assertions ---- */
    var assertions = all(root, 'Assertion');
    var encrypted = all(root, 'EncryptedAssertion');

    out.line('');
    kv('Assertions', assertions.length + (encrypted.length ? ' (+' + encrypted.length + ' encrypted)' : ''));

    if (encrypted.length && !assertions.length) {
      out.line('');
      p('The assertion is encrypted, so its contents cannot be read without the ' +
        'service provider\'s private key. That is a good sign rather than a ' +
        'problem: everything below applies to the envelope only.');
    }

    /* ---- signatures: what is signed, not whether it verifies ---- */
    var sigs = all(root, 'Signature');
    var signedIds = [];
    for (var i = 0; i < sigs.length; i++) {
      var ref = one(sigs[i], 'Reference');
      var uri = attr(ref, 'URI').replace(/^#/, '');
      signedIds.push(uri);
    }

    out.line('');
    say('What is signed', '', 't-info');
    rule();

    if (!sigs.length) {
      kv('Signatures', '0', 't-err');
      bad('nothing is signed',
        'An unsigned SAML response is a text file anybody can write. If your ' +
        'service provider accepts this, authentication is decorative. Unless ' +
        'the assertion is encrypted AND you verify that, reject it.');
    } else {
      var responseSigned = signedIds.indexOf(attr(root, 'ID')) !== -1;
      var assertionIds = assertions.map(function (a) { return attr(a, 'ID'); });
      var assertionSigned = assertionIds.some(function (id) { return id && signedIds.indexOf(id) !== -1; });

      kv('Signatures', String(sigs.length));
      kv('Response signed', responseSigned ? 'yes' : 'no', responseSigned ? 't-ok' : 't-warn');
      kv('Assertion signed', assertionSigned ? 'yes' : 'no', assertionSigned ? 't-ok' : 't-warn');

      if (responseSigned && !assertionSigned) {
        warn('the Response is signed but the Assertion is not',
          'Legal, and a trap. If your service provider validates the signature on ' +
          'the Response and then reads the Assertion, an attacker who can get the ' +
          'Response re-signed — or who exploits any wrapping weakness — controls ' +
          'the part you actually read. Sign the Assertion.');
      } else if (assertionSigned && !responseSigned) {
        good('the Assertion is signed',
          'The right thing to sign: it is the part carrying the identity. Make sure ' +
          'your library validates the signature on the assertion it reads, not on ' +
          'whichever one it finds first.');
      } else if (responseSigned && assertionSigned) {
        good('both the Response and the Assertion are signed', 'Belt and braces.');
      }

      /* --- algorithms --- */
      var sm = attr(one(sigs[0], 'SignatureMethod'), 'Algorithm');
      var dm = attr(one(sigs[0], 'DigestMethod'), 'Algorithm');
      out.line('');
      kv('SignatureMethod', sm.replace(/^.*[#\/]/, '') || '(absent)');
      kv('DigestMethod', dm.replace(/^.*[#\/]/, '') || '(absent)');
      if (/sha1|md5/i.test(sm)) {
        bad('signature algorithm is ' + sm.replace(/^.*[#\/]/, ''),
          'SHA-1 is not collision resistant and MD5 is thoroughly broken. Move the ' +
          'IdP to rsa-sha256. Many products still default to rsa-sha1.');
      }
      if (/sha1|md5/i.test(dm)) {
        bad('digest algorithm is ' + dm.replace(/^.*[#\/]/, ''),
          'The digest is what the signature actually covers, so a weak one ' +
          'undermines a strong signature algorithm.');
      }

      /* --- XML signature wrapping --- */
      var dangling = signedIds.filter(function (id) {
        if (!id) return false;
        var hit = false;
        var els = doc.getElementsByTagName('*');
        for (var j = 0; j < els.length; j++) {
          if (els[j].getAttribute && (els[j].getAttribute('ID') === id || els[j].getAttribute('Id') === id)) { hit = true; break; }
        }
        return !hit;
      });
      if (dangling.length) {
        bad('a signature references an ID that no element carries: ' + dangling.join(', '),
          'This is the signature of XML signature wrapping. The signed element has ' +
          'been moved or removed and something unsigned put in its place. Do not ' +
          'trust this response.');
      }
      if (assertions.length > sigs.length && assertions.length > 1) {
        bad(assertions.length + ' assertions but only ' + sigs.length + ' signature(s)',
          'At least one assertion is unsigned. A wrapping attack keeps the real ' +
          'signed assertion in the document to satisfy the signature check and ' +
          'adds an unsigned one for the application to read.');
      } else if (assertions.length > 1) {
        warn(assertions.length + ' assertions in one response',
          'Legal but very unusual. Confirm your library reads the one it verified ' +
          'rather than the first it finds.');
      }
    }

    /* ---- subject and conditions ---- */
    if (assertions.length) {
      inspectAssertion(assertions[0], doc, bad, warn, good);
    }

    /* ---- findings ---- */
    out.line('');
    say('Findings', '', 't-info');
    rule();
    var order = { err: 0, warn: 1, ok: 2 };
    findings.sort(function (a, b) { return order[a.lv] - order[b.lv]; });
    var counts = { err: 0, warn: 0, ok: 0 };
    findings.forEach(function (f) { counts[f.lv]++; });
    if (!findings.length) {
      po('Nothing to report from the structure.');
    }
    findings.forEach(function (f) {
      var mark = f.lv === 'err' ? '[!]' : (f.lv === 'warn' ? '[~]' : '[+]');
      say(mark + ' ' + f.w, '', 't-' + f.lv);
      say(f.why, '    ', 't-dim');
      out.line('');
    });

    rule();
    kv('problems', counts.err, counts.err ? 't-err' : 't-ok');
    kv('worth a look', counts.warn, counts.warn ? 't-warn' : 't-ok');
    kv('correct', counts.ok, 't-ok');
    out.line('');
    pw('THE SIGNATURE IS NOT VERIFIED HERE. That needs the IdP certificate and a ' +
       'correct canonicalisation, neither of which exists in this tab. Everything ' +
       'above is about what the document says and how it is shaped. A response ' +
       'that looks perfect here can still carry an invalid signature.');
  }

  function inspectAssertion(a, doc, bad, warn, good) {
    out.line('');
    say('Subject', '', 't-info');
    rule();

    var nameId = one(a, 'NameID');
    kv('NameID', text(nameId));
    kv('Format', attr(nameId, 'Format').replace(/^.*:/, ''));

    /* The 2018 comment trick. Some XML libraries return only the first text
       node of an element, so a comment splits one identity into two readings:
       the signature covers "admin@corp.com.attacker.example" and the
       application sees "admin@corp.com". Two lines to check for. */
    if (nameId) {
      for (var i = 0; i < nameId.childNodes.length; i++) {
        if (nameId.childNodes[i].nodeType === 8) {
          bad('the NameID contains an XML comment',
            'This is the comment-truncation attack. A library that reads only the ' +
            'first text node sees a different identity from the one the signature ' +
            'covers. The full text is "' + text(nameId) + '"; a vulnerable parser ' +
            'would read "' + String(nameId.childNodes[0].nodeValue || '').trim() + '". ' +
            'Treat this response as hostile.');
          break;
        }
      }
    }

    var scd = one(a, 'SubjectConfirmationData');
    if (scd) {
      kv('Recipient', attr(scd, 'Recipient'));
      kv('SC NotOnOrAfter', attr(scd, 'NotOnOrAfter'));
      if (!attr(scd, 'Recipient')) {
        warn('SubjectConfirmationData has no Recipient',
          'Recipient is what stops this assertion being replayed at a different ' +
          'service provider. Your SP should require it and compare it to its own ' +
          'assertion consumer URL.');
      }
    }

    /* ---- conditions ---- */
    var cond = one(a, 'Conditions');
    out.line('');
    say('Validity', '', 't-info');
    rule();

    var now = Date.now();
    var nb = when(attr(cond, 'NotBefore'));
    var na = when(attr(cond, 'NotOnOrAfter'));
    kv('NotBefore', attr(cond, 'NotBefore') || '(absent)');
    kv('NotOnOrAfter', attr(cond, 'NotOnOrAfter') || '(absent)');

    if (na) {
      var expired = now >= na;
      kv('Expired', expired ? 'yes, ' + ago(na - now) : 'no, expires ' + ago(na - now),
         expired ? 't-err' : 't-ok');
      if (expired) {
        warn('the assertion window has closed',
          'Expected when you are reading a captured response later. If a live login ' +
          'is failing with an expired assertion, the clocks on your IdP and SP have ' +
          'drifted — that is the usual cause and NTP is the usual fix.');
      }
      if (nb && na - nb > 30 * 60 * 1000) {
        warn('the validity window is ' + Math.round((na - nb) / 60000) + ' minutes long',
          'An assertion is a bearer credential. Minutes, not hours: five is typical ' +
          'and the specification suggests keeping it short.');
      }
    } else {
      bad('no NotOnOrAfter — the assertion never expires',
        'A bearer credential with no expiry can be replayed forever by anyone who ' +
        'captures it from a log, a proxy or a browser history.');
    }

    var aud = all(a, 'Audience').map(function (x) { return text(x); });
    kv('Audience', aud.length ? aud.join(', ') : '(none)');
    if (!aud.length) {
      bad('no AudienceRestriction',
        'Nothing says this assertion was meant for your service provider. A ' +
        'malicious or compromised SP that receives an assertion from the same IdP ' +
        'can replay it at yours.');
    } else {
      good('AudienceRestriction present', 'Your SP must compare this to its own entity ID.');
    }

    /* ---- authn ---- */
    var authn = one(a, 'AuthnStatement');
    if (authn) {
      out.line('');
      say('Authentication', '', 't-info');
      rule();
      kv('AuthnInstant', attr(authn, 'AuthnInstant'));
      kv('SessionIndex', attr(authn, 'SessionIndex'));
      var ctx = text(one(a, 'AuthnContextClassRef'));
      kv('AuthnContext', ctx.replace(/^.*:/, '') || '(absent)');
      if (/unspecified/i.test(ctx)) {
        warn('AuthnContextClassRef is unspecified',
          'The IdP is declining to say how the user authenticated. If you need to ' +
          'know that multi-factor was used, this is where it would be said, and it ' +
          'is not being said.');
      }
      if (/Password$/i.test(ctx) || /PasswordProtectedTransport/i.test(ctx)) {
        p('  Password authentication, no second factor asserted.');
      }
    }

    /* ---- attributes ---- */
    var attrs = all(a, 'Attribute');
    if (attrs.length) {
      out.line('');
      say('Attributes (' + attrs.length + ')', '', 't-info');
      rule();
      attrs.forEach(function (at) {
        var n = attr(at, 'Name') || attr(at, 'FriendlyName');
        var vals = all(at, 'AttributeValue').map(function (v) { return text(v); });
        kv(n.replace(/^.*[\/:]/, '').slice(0, 20), vals.join(', ') || '(empty)');
      });
      out.line('');
      p('These are what your application will map to roles and permissions. ' +
        'Anything here is only as trustworthy as the signature over the assertion ' +
        'carrying it.');
    }
  }

  /* ------------------------------------------------------------------
     Run.
     ------------------------------------------------------------------ */

  function run() {
    out.clear();
    COLS = measureCols();
    var raw = (document.getElementById('tool-text') || {}).value || '';

    if (!raw.trim()) {
      out.err('Nothing to read.');
      p('Paste a SAMLResponse. Any of these work:');
      p('· the base64 value out of the form your browser POSTed');
      p('· the whole SAMLResponse=… field, URL-encoded or not');
      p('· a redirect-binding value, which is deflated as well as base64');
      p('· the decoded XML itself');
      out.line('');
      p('Capture one with your browser\'s network tab: find the POST to your ' +
        'assertion consumer URL and copy the SAMLResponse form field.');
      return;
    }

    toXml(raw).then(function (xml) {
      try { report(xml); }
      catch (e) {
        out.err('Could not finish reading that: ' + e.message);
        p('If it is a valid response, this is a bug in the tool rather than in ' +
          'your SSO — the report link below reaches me.');
      }
    }).catch(function (e) {
      if (e.message === 'not base64') {
        out.err('That is neither XML nor base64.');
        p('A SAMLResponse is a long base64 string. If you copied it out of a ' +
          'browser form field it may still be URL-encoded, which is fine — paste ' +
          'it as-is and this will decode it.');
      } else if (e.message === 'decoded, but not XML' || e.message === 'not deflate' ||
                 /DecompressionStream/.test(e.message)) {
        out.err('The base64 decoded, but the result is not XML.');
        p('Redirect-binding messages are DEFLATE-compressed before the base64, so ' +
          'this tried inflating as well. Neither gave XML, which means the value ' +
          'is truncated, is base64 of something else entirely, or lost characters ' +
          'on the way to your clipboard.');
        out.line('');
        p('A SAMLResponse always begins, once decoded, with a Response element:');
        out.line('    <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"', 't-dim');
      } else {
        out.err('Could not decode that: ' + e.message);
      }
    });
  }

  LabTool.define({
    id: 'samlresponsetool',
    run: run,
    onReady: function () {
      COLS = measureCols();
      p('Paste a SAMLResponse and press Read.');
      out.line('');
      p('Base64, URL-encoded base64, a whole SAMLResponse=… field, a deflated ' +
        'redirect-binding value, or the raw XML. It works out which.');
      out.line('');
      p('You get the envelope, the subject, the validity window, the attributes, ' +
        'and — the part other decoders skip — exactly WHAT is signed, plus checks ' +
        'for signature wrapping and the NameID comment trick.');
      out.line('');
      pw('The signature is NOT verified: that needs the IdP certificate, which is ' +
         'not in the response. Nothing is uploaded — a SAML response is a live ' +
         'credential carrying a real person\'s identity.');
    }
  });
})();

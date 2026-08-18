/* ==========================================================================
   email-security.js — audit a domain's SPF, DKIM, DMARC and MTA-STS posture.
   --------------------------------------------------------------------------
   Everything here comes out of DNS TXT records, which are public. There is no
   privileged data source and nothing is being probed on the target's servers:
   the same information is available to anyone who runs dig, and to every mail
   server that has ever received a message claiming to be from this domain.

   The one thing worth understanding before pressing the button is the shape of
   the traffic. A posture audit is five to twenty queries for the same domain,
   fired within a second of each other, in a distinctive order. The resolver
   sees that pattern and it is unmistakably an audit — not somebody browsing.
   So the DKIM selector sweep, which is the expensive half, is a separate,
   opt-in button that tells you the request count before it runs.

   DKIM deserves a specific caveat, made in the output rather than buried here:
   it CANNOT be enumerated. A DKIM key lives at {selector}._domainkey.{domain},
   and the selector is chosen freely by whoever set it up. Finding nothing
   proves only that none of the selectors we guessed exist.
   ========================================================================== */

/* global LabNet */
(function () {
  'use strict';

  var out = LabNet.out('tool-out');
  var RESOLVER = { name: 'Google Public DNS', url: 'https://dns.google/resolve' };

  function txt(name) {
    return LabNet.json({
      url: RESOLVER.url + '?name=' + encodeURIComponent(name) + '&type=TXT',
      out: out
    }).then(function (r) { return r.data || {}; });
  }

  function mx(name) {
    return LabNet.json({
      url: RESOLVER.url + '?name=' + encodeURIComponent(name) + '&type=MX',
      out: out
    }).then(function (r) { return r.data || {}; });
  }

  function unquote(data) {
    var chunks = String(data).match(/"(?:[^"\\]|\\.)*"/g);
    if (!chunks) return String(data);
    return chunks.map(function (c) { return c.slice(1, -1).replace(/\\"/g, '"'); }).join('');
  }

  function records(data) {
    return ((data && data.Answer) || [])
      .filter(function (a) { return a.type === 16; })
      .map(function (a) { return unquote(a.data); });
  }

  /* ---------------------------------------------------------------- SPF -- */
  /* Only these mechanisms cost a DNS lookup. The limit is 10, and exceeding it
     is a permerror — which means receivers stop evaluating SPF entirely, so an
     over-long record is worse than a short permissive one. */
  var LOOKUP_MECHANISMS = ['include', 'a', 'mx', 'ptr', 'exists', 'redirect'];

  var ALL_VERDICT = {
    '-': ['-all', 'hard fail — receivers should reject anything not listed', 't-ok', 3],
    '~': ['~all', 'soft fail — receivers should accept but mark it', 't-warn', 2],
    '?': ['?all', 'neutral — states a policy and then declines to enforce it', 't-err', 1],
    '+': ['+all', 'pass everything — any server on earth may send as this domain', 't-err', 0]
  };

  function auditSpf(recs) {
    out.heading('SPF — who may send as this domain');
    var spf = recs.filter(function (r) { return /^v=spf1(\s|$)/i.test(r); });

    if (!spf.length) {
      out.err('No SPF record.');
      out.dim('Any server anywhere can send mail claiming to be from this domain');
      out.dim('and nothing in DNS contradicts it.');
      return { score: 0, max: 3, has: false };
    }
    if (spf.length > 1) {
      out.err('MULTIPLE SPF records (' + spf.length + ').');
      out.dim('This is a permerror. Receivers are required to treat it as broken,');
      out.dim('so the effect is the same as having no SPF at all — arguably worse,');
      out.dim('because it looks configured.');
      spf.forEach(function (r) { out.line('  ' + r, 't-dim'); });
      return { score: 0, max: 3, has: true, broken: true };
    }

    var rec = spf[0];
    out.line(rec);
    out.line('');

    var terms = rec.split(/\s+/).slice(1);
    var lookups = 0;
    var allTerm = null;

    terms.forEach(function (term) {
      var qualifier = /^[-~?+]/.test(term) ? term[0] : '+';
      var body = term.replace(/^[-~?+]/, '');
      var mech = body.split(/[:=/]/)[0].toLowerCase();
      if (LOOKUP_MECHANISMS.indexOf(mech) !== -1) lookups++;
      if (mech === 'all') allTerm = qualifier;
      if (mech === 'ptr') {
        out.warn('  ptr is deprecated (RFC 7208 §5.5) — slow, unreliable, and');
        out.warn('  some receivers ignore it entirely.');
      }
    });

    /* This counts the lookup-costing mechanisms IN THIS RECORD ONLY. The RFC
       7208 limit of 10 is cumulative across everything an include: pulls in
       recursively, so the real figure is usually higher — sometimes much
       higher. github.com sits at exactly 10 once expanded while its own record
       shows only a handful. Printing the direct count under the label "of 10"
       would therefore be reassuring and wrong, in the dangerous direction. */
    var includes = terms.filter(function (t) { return /^[-~?+]?include[:=]/i.test(t); }).length;
    out.row('lookups in this record', String(lookups),
            lookups > 10 ? 't-err' : null);
    if (lookups > 10) {
      out.err('  Over the limit on its own. This is a permerror: receivers give');
      out.err('  up and SPF fails to evaluate at all. Flatten the includes.');
    } else if (includes) {
      out.dim('    The RFC 7208 limit is 10, counted cumulatively across every');
      out.dim('    include. This record has ' + includes + ' include' +
              (includes === 1 ? '' : 's') + ', and each pulls in its own');
      out.dim('    mechanisms, so the true total is higher than the number above —');
      out.dim('    working it out means recursively fetching each one.');
      out.dim('    Exceeding 10 breaks SPF entirely, with no warning anywhere.');
    }

    if (!allTerm) {
      out.warn('No "all" mechanism, so the record says nothing about senders it');
      out.warn('did not list. Receivers default to neutral.');
      return { score: 1, max: 3, has: true };
    }
    var v = ALL_VERDICT[allTerm];
    out.row('default policy', v[0] + ' — ' + v[1], v[2]);
    if (allTerm === '+') {
      out.err('  +all is worse than having no SPF record. It actively authorises');
      out.err('  every sender in the world.');
    }
    return { score: v[3], max: 3, has: true, all: allTerm };
  }

  /* -------------------------------------------------------------- DMARC -- */
  function auditDmarc(recs) {
    out.rule();
    out.heading('DMARC — what receivers should do about failures');
    var dm = recs.filter(function (r) { return /^v=DMARC1(\s*;|$)/i.test(r); });

    if (!dm.length) {
      out.err('No DMARC record at _dmarc.' + currentDomain + '.');
      out.dim('Without it, SPF and DKIM results are advisory. Receivers decide');
      out.dim('for themselves what to do, and mostly they deliver anyway.');
      return { score: 0, max: 3, has: false };
    }
    if (dm.length > 1) {
      out.err('Multiple DMARC records — receivers treat this as no policy.');
      return { score: 0, max: 3, has: true, broken: true };
    }

    var rec = dm[0];
    out.line(rec);
    out.line('');

    var tags = {};
    rec.split(';').forEach(function (pair) {
      var kv = pair.trim().split('=');
      if (kv.length === 2) tags[kv[0].trim().toLowerCase()] = kv[1].trim();
    });

    var p = (tags.p || 'none').toLowerCase();
    var POLICY = {
      reject:     ['reject', 'failing mail is rejected outright', 't-ok', 3],
      quarantine: ['quarantine', 'failing mail goes to spam', 't-warn', 2],
      none:       ['none', 'monitoring only — nothing is enforced', 't-err', 0]
    };
    var v = POLICY[p] || ['unknown (' + p + ')', 'not a valid policy value', 't-err', 0];
    out.row('policy (p)', v[0] + ' — ' + v[1], v[2]);
    if (p === 'none') {
      out.dim('    p=none is the right place to START, while you read reports and');
      out.dim('    fix legitimate senders. Left there permanently it provides no');
      out.dim('    protection at all — which is where most domains sit.');
    }

    if (tags.sp) out.row('subdomain policy (sp)', tags.sp);
    else out.dim('no sp tag — subdomains inherit the main policy');

    var pct = tags.pct ? Number(tags.pct) : 100;
    out.row('percentage (pct)', pct + '%', pct < 100 ? 't-warn' : null);
    if (pct < 100) {
      out.dim('    Only ' + pct + '% of failing mail gets the policy applied. The');
      out.dim('    rest is delivered, so an attacker simply retries.');
    }

    out.row('alignment', 'DKIM ' + (tags.adkim === 's' ? 'strict' : 'relaxed') +
                         ', SPF ' + (tags.aspf === 's' ? 'strict' : 'relaxed'));
    if (tags.rua) out.row('aggregate reports', tags.rua);
    else out.warn('No rua tag — nobody is receiving aggregate reports, so there is');
    if (!tags.rua) out.warn('no visibility into who is sending as this domain.');
    if (tags.ruf) out.row('forensic reports', tags.ruf);

    var score = v[3];
    if (pct < 100 && score > 0) score = Math.max(1, score - 1);
    return { score: score, max: 3, has: true, policy: p, pct: pct, hasRua: !!tags.rua };
  }

  /* --------------------------------------------------------------- MX ---- */
  function auditMx(data) {
    out.rule();
    out.heading('MX — where mail for this domain goes');
    var answers = ((data && data.Answer) || []).filter(function (a) { return a.type === 15; });
    if (!answers.length) {
      out.warn('No MX records. This domain does not receive mail.');
      out.dim('That is fine for a domain that only serves a website — but if it');
      out.dim('also never SENDS mail, it should still publish SPF -all and');
      out.dim('DMARC p=reject so nobody can spoof it.');
      return { count: 0 };
    }
    /* A "null MX" — a single record of priority 0 pointing at the root, i.e.
       "0 ." — is RFC 7505, and it means the domain explicitly declines mail.
       That is the correct configuration for a domain that only serves a
       website, and it is strictly better than having no MX at all, because
       senders fail immediately instead of retrying for days. Rendering it as
       an ordinary record with a blank hostname would be nonsense. */
    var isNullMx = answers.length === 1 && /^0\s+\.?$/.test(String(answers[0].data).trim());
    if (isNullMx) {
      out.row('null MX', '"0 ." — this domain explicitly accepts no mail', 't-ok');
      out.line('');
      out.ok('That is RFC 7505, and it is the right answer for a domain that');
      out.ok('never receives mail. Senders get an immediate permanent failure');
      out.ok('rather than retrying for days, and it closes the domain off as a');
      out.ok('backscatter target.');
      return { count: 0, nullMx: true };
    }

    var hosts = [];
    answers.sort(function (a, b) {
      return Number(String(a.data).split(' ')[0]) - Number(String(b.data).split(' ')[0]);
    }).forEach(function (a) {
      var m = String(a.data).match(/^(\d+)\s+(.+?)\.?$/);
      if (!m) return;
      var host = m[2].replace(/\.$/, '');
      if (!host) return;
      out.row('priority ' + m[1], host);
      hosts.push(host.toLowerCase());
    });

    var PROVIDERS = [
      [/google|googlemail|gmail/, 'Google Workspace'],
      [/outlook|microsoft|office365|protection\.outlook/, 'Microsoft 365'],
      [/zoho/, 'Zoho Mail'], [/protonmail|proton\.me/, 'Proton Mail'],
      [/mimecast/, 'Mimecast'], [/proofpoint|pphosted/, 'Proofpoint'],
      [/barracuda/, 'Barracuda'], [/amazonaws|amazonses/, 'Amazon SES'],
      [/messagingengine|fastmail/, 'Fastmail'], [/yandex/, 'Yandex'],
      [/qq\.com|tencent/, 'Tencent'], [/secureserver|godaddy/, 'GoDaddy'],
      [/zoho|improvmx|forwardemail/, 'a forwarding service']
    ];
    var joined = hosts.join(' ');
    var hit = PROVIDERS.filter(function (p) { return p[0].test(joined); });
    if (hit.length) {
      out.line('');
      out.dim('mail provider looks like: ' + hit[0][1]);
    }
    return { count: answers.length, hosts: hosts, provider: hit.length ? hit[0][1] : null };
  }

  /* ------------------------------------------------------- MTA-STS/BIMI -- */
  function auditExtras(mtaRecs, bimiRecs) {
    out.rule();
    out.heading('Transport and branding');
    var mta = mtaRecs.filter(function (r) { return /^v=STSv1/i.test(r); });
    if (mta.length) {
      out.row('MTA-STS', 'published', 't-ok');
      out.dim('    forces TLS for inbound mail, blocking downgrade attacks');
    } else {
      out.row('MTA-STS', 'not published', 't-dim');
      out.dim('    without it, an attacker who can intercept SMTP can strip TLS');
    }
    var bimi = bimiRecs.filter(function (r) { return /^v=BIMI1/i.test(r); });
    out.row('BIMI', bimi.length ? 'published' : 'not published',
            bimi.length ? 't-ok' : 't-dim');
    if (!bimi.length) out.dim('    optional; only works once DMARC is at quarantine or reject');
    return { mta: mta.length > 0, bimi: bimi.length > 0 };
  }

  /* ------------------------------------------------------------- grade --- */
  function grade(spf, dmarc, extras) {
    out.rule();
    var score = spf.score + dmarc.score;
    var max = spf.max + dmarc.max;
    if (extras.mta) score += 1;
    max += 1;

    var pct = Math.round(score / max * 100);
    var band = pct >= 85 ? ['STRONG', 't-ok']
             : pct >= 55 ? ['PARTIAL', 't-warn']
             : ['WEAK', 't-err'];

    out.heading('Overall posture');
    out.line('');
    var filled = Math.round(pct / 100 * 40);
    out.write('   ', 't-dim');
    out.write('█'.repeat(filled), band[1]);
    out.line('░'.repeat(40 - filled), 't-dim');
    out.line('   ' + score + ' of ' + max + '   ' + band[0], band[1]);
    out.line('');

    var advice = [];
    if (!spf.has) advice.push('Publish an SPF record. Start with the providers you actually use, and end it with ~all.');
    else if (spf.all === '+') advice.push('Change +all immediately — it authorises the entire internet.');
    else if (spf.all === '?') advice.push('?all enforces nothing. Move to ~all, then to -all once reports are clean.');
    else if (spf.all === '~') advice.push('Move SPF from ~all to -all once you are confident every legitimate sender is listed.');
    if (!dmarc.has) advice.push('Publish DMARC at _dmarc.' + currentDomain + ', starting at p=none with a rua address so you can see who is sending.');
    else if (dmarc.policy === 'none') advice.push('DMARC is at p=none, which enforces nothing. Once reports look clean, move to quarantine, then reject.');
    else if (dmarc.policy === 'quarantine') advice.push('Move DMARC from quarantine to reject to stop spoofed mail being delivered at all.');
    if (dmarc.has && !dmarc.hasRua) advice.push('Add a rua address to DMARC — without reports you are enforcing blind.');
    if (!extras.mta) advice.push('Consider MTA-STS to stop TLS downgrade on inbound mail.');

    if (advice.length) {
      out.heading('What would improve it, in order');
      advice.forEach(function (a, i) { out.line('  ' + (i + 1) + '. ' + a, 't-warn'); });
    } else {
      out.ok('Nothing obvious left to fix. SPF is strict, DMARC enforces, and');
      out.ok('transport security is published.');
    }
  }

  /* ------------------------------------------------------------- run ----- */
  var currentDomain = '';

  function cleanDomain(raw) {
    return String(raw).trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^[^@/]*@/, '')
      .replace(/[/?#].*$/, '')
      .replace(/\.$/, '')
      .toLowerCase();
  }

  function run() {
    var raw = document.getElementById('tool-text').value;
    out.clear();
    if (!raw.trim()) { out.warn('Enter a domain, then press Audit.'); return; }

    var domain = cleanDomain(raw);
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
      out.err('"' + raw.trim() + '" does not look like a domain name.');
      return;
    }
    currentDomain = domain;

    out.heading('Email security audit — ' + domain);
    out.dim('five DNS lookups, in sequence');
    out.line('');

    var spfRecs, dmarcRecs, mxData, mtaRecs, bimiRecs;

    txt(domain)
      .then(function (d) { spfRecs = records(d); return txt('_dmarc.' + domain); })
      .then(function (d) { dmarcRecs = records(d); return mx(domain); })
      .then(function (d) { mxData = d; return txt('_mta-sts.' + domain); })
      .then(function (d) { mtaRecs = records(d); return txt('default._bimi.' + domain); })
      .then(function (d) {
        bimiRecs = records(d);
        out.line('');
        var spf = auditSpf(spfRecs);
        var dmarc = auditDmarc(dmarcRecs);
        auditMx(mxData);
        var extras = auditExtras(mtaRecs, bimiRecs);
        grade(spf, dmarc, extras);
        out.rule();
        out.dim('Every record above is public DNS. Nothing was probed on their');
        out.dim('servers and no mail was sent — this is the same data any receiving');
        out.dim('mail server consults, and anyone can read it.');
        out.line('');
        out.dim('DKIM is not covered above, because it cannot be enumerated.');
        out.dim('Use the selector sweep below if you want to guess at it.');
      })
      .catch(function (err) { LabNet.explainFailure(out, err, RESOLVER.name); });
  }

  /* Read the RSA modulus length out of the base64 SubjectPublicKeyInfo.

     Estimating this from the base64 string length does not work: the encoded
     SPKI for a 2048-bit key is about 294 bytes and for 1024-bit about 162, and
     a threshold picked by eye reported Google's perfectly ordinary key as
     "512 bits, broken" — an alarming and completely wrong answer. So this
     walks the DER properly instead:

       SEQUENCE { SEQUENCE { OID, NULL }, BIT STRING { SEQUENCE { INTEGER n, INTEGER e } } }

     and measures n. Returns null rather than guessing if anything is off. */
  function modulusBits(b64) {
    var bin;
    try { bin = atob(String(b64).replace(/\s+/g, '')); }
    catch (e) { return null; }
    var b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);

    var pos = 0;
    function len() {
      var n = b[pos++];
      if (n & 0x80) {
        var count = n & 0x7f;
        if (count === 0 || count > 4) return -1;
        n = 0;
        for (var k = 0; k < count; k++) n = (n << 8) | b[pos++];
      }
      return n;
    }
    function expect(tag) {
      if (pos >= b.length || b[pos] !== tag) return -1;
      pos++;
      return len();
    }

    if (expect(0x30) < 0) return null;               // outer SEQUENCE
    var algLen = expect(0x30);                        // AlgorithmIdentifier
    if (algLen < 0) return null;
    pos += algLen;                                    // skip it
    if (expect(0x03) < 0) return null;                // BIT STRING
    pos++;                                            // unused-bits byte
    if (expect(0x30) < 0) return null;                // RSAPublicKey SEQUENCE
    var modLen = expect(0x02);                        // INTEGER modulus
    if (modLen <= 0) return null;
    // DER prefixes a 0x00 when the high bit would otherwise mean "negative".
    if (b[pos] === 0x00) modLen--;
    return modLen * 8;
  }

  /* --------------------------------------------------- DKIM selectors ---- */
  /* Opt-in, because this is the part with the distinctive traffic shape. */
  var SELECTORS = [
    ['google', 'Google Workspace'], ['selector1', 'Microsoft 365'],
    ['selector2', 'Microsoft 365'], ['k1', 'Mailchimp / Mandrill'],
    ['k2', 'Mailchimp'], ['s1', 'SendGrid / generic'], ['s2', 'SendGrid / generic'],
    ['zoho', 'Zoho Mail'], ['dkim', 'generic'], ['default', 'generic'],
    ['mail', 'generic'], ['pm', 'Postmark'], ['mte1', 'Mailtrap'],
    ['fm1', 'Fastmail'], ['protonmail', 'Proton Mail'], ['sig1', 'Sendinblue / Brevo']
  ];

  function sweepDkim() {
    var raw = document.getElementById('tool-text').value;
    if (!raw.trim()) { out.clear().warn('Enter a domain first.'); return; }
    var domain = cleanDomain(raw);
    currentDomain = domain;

    out.clear();
    out.heading('DKIM selector sweep — ' + domain);
    out.warn('This makes ' + (SELECTORS.length + 1) + ' DNS queries for the same');
    out.warn('domain — one per guessed selector, plus one for a made-up name to');
    out.warn('check for a wildcard. That is a very distinctive pattern.');
    out.line('');

    /* A DKIM record does NOT reliably carry v=DKIM1 — RFC 6376 marks the tag
       RECOMMENDED with a default, and Mailchimp, PayPal, SendGrid and Postmark
       all publish records starting straight at "k=rsa;". So the test has to
       accept a bare p= tag. That in turn creates a false-positive risk, because
       a DMARC record also contains "p=" (p=reject), and a wildcard TXT at
       *.domain makes EVERY probe return whatever the wildcard publishes —
       *.gov.uk serves both SPF and DMARC, so every selector would "match".
       Hence: accept p= or k=, but explicitly reject anything that identifies
       itself as SPF, DMARC, MTA-STS or BIMI. */
    function looksLikeDkim(rec) {
      if (/^v=(spf1|DMARC1|STSv1|BIMI1)/i.test(rec)) return false;
      if (/v=DKIM1/i.test(rec)) return true;
      return /(^|[;\s])[kp]=/i.test(rec) && /(^|[;\s])p=/i.test(rec);
    }

    var found = [], index = 0, wildcard = false;

    function probe(label, name, onResult) {
      txt(name).then(function (d) {
        onResult(records(d).filter(looksLikeDkim), d);
      }).catch(function (err) { LabNet.explainFailure(out, err, RESOLVER.name); });
    }

    /* Probe a name nobody would ever configure first. If it answers, the zone
       has a wildcard and every result after this is meaningless. */
    function detectWildcard(done) {
      var nonce = 'zz9-no-such-selector-' + Math.floor(Date.now() % 100000);
      /* Deliberately looks at ANY TXT record, not just DKIM-shaped ones. A
         wildcard commonly serves SPF or DMARC, which the DKIM filter correctly
         rejects — so filtering here first would hide the very thing this probe
         exists to find. */
      txt(nonce + '._domainkey.' + domain).then(function (d) {
        var any = records(d);
        if (any.length) {
          wildcard = !any.every(looksLikeDkim) ? 'benign' : 'dkim';
          out.warn('WILDCARD TXT DETECTED');
          out.warn('A selector nobody could have configured returned a record, so');
          out.warn('this zone answers every name under _domainkey:');
          any.slice(0, 2).forEach(function (r) { out.dim('    ' + r.slice(0, 90)); });
          out.line('');
          if (wildcard === 'dkim') {
            out.err('The wildcard record is DKIM-shaped, so every selector below');
            out.err('will appear to exist. These results are meaningless here.');
          } else {
            out.dim('That record is not DKIM-shaped, so it will not be mistaken for');
            out.dim('a key — but it does mean a negative result below proves even');
            out.dim('less than usual for this domain.');
          }
          out.line('');
        }
        done();
      }).catch(function (err) { LabNet.explainFailure(out, err, RESOLVER.name); });
    }

    function next() {
      if (index >= SELECTORS.length) { finish(); return; }
      var sel = SELECTORS[index++];
      probe(sel[0], sel[0] + '._domainkey.' + domain, function (recs, d) {
        if (recs.length) {
          found.push({ selector: sel[0], provider: sel[1], record: recs[0] });
          out.ok('  found: ' + sel[0] + '  (' + sel[1] + ')');
        } else if (d.Status === 3 && (d.Answer || []).some(function (a) { return a.type === 5; })) {
          /* NXDOMAIN with a CNAME in the answer: the selector is delegated to a
             target that does not exist. This is what a half-provisioned
             Microsoft 365 tenant looks like, and it is worth reporting. */
          out.warn('  ' + sel[0] + ': CNAME points at a target that does not exist');
          out.dim('    (' + sel[1] + ' — delegation set up, key never provisioned)');
        }
        next();
      });
    }

    function finish() {
      out.line('');
      out.rule();
      if (!found.length) {
        out.warn('No DKIM key found at any of the ' + SELECTORS.length + ' selectors tried.');
        out.line('');
        out.dim('This does NOT mean the domain has no DKIM. A selector is an');
        out.dim('arbitrary label chosen by whoever configured signing — it can be');
        out.dim('anything, including a random string. The only reliable way to');
        out.dim('learn a selector is to read the DKIM-Signature header of a real');
        out.dim('message from this domain; the s= tag names it.');
        out.line('');
        out.dim('Paste a message into the email header analyzer to find it:');
        out.dim('  /labs/email-headers');
        return;
      }
      if (wildcard === 'dkim') {
        out.err('These "results" are the wildcard answering, not real selectors.');
        out.line('');
      }
      out.heading(found.length + ' DKIM key' + (found.length === 1 ? '' : 's') + ' found');
      found.forEach(function (f) {
        out.line('');
        out.row('selector', f.selector + '  (' + f.provider + ')');
        var key = (f.record.match(/(?:^|[;\s])p=([A-Za-z0-9+/=]+)/) || [])[1];
        if (key) {
          var bits = modulusBits(key);
          if (bits) {
            out.row('key size', bits + ' bits',
                    bits < 1024 ? 't-err' : (bits < 2048 ? 't-warn' : 't-ok'));
            if (bits < 1024) out.err('    Below 1024 bits is considered broken.');
            else if (bits < 2048) out.warn('    1024-bit DKIM keys are being phased out; 2048 is the norm.');
          } else {
            out.row('key size', 'could not be read from the record', 't-dim');
          }
        } else if (/p=\s*(;|$)/.test(f.record)) {
          out.err('empty p= — this selector is REVOKED');
        }
      });
      out.line('');
      out.dim('Finding keys confirms DKIM is configured for those selectors. It');
      out.dim('does not prove messages are actually signed with them.');
    }
    detectWildcard(next);
  }

  LabNet.define({
    id: 'emailsecuritytool',
    run: run,
    onReady: function () {
      var btn = document.getElementById('tool-dkim');
      if (btn) btn.addEventListener('click', sweepDkim);
      out.dim('Enter a domain and press Audit. Nothing is sent until you do.');
      out.dim('');
      out.dim('The audit reads five public DNS records: SPF and DMARC, the MX');
      out.dim('servers, MTA-STS and BIMI. All of it is data any mail server on');
      out.dim('the internet already consults before accepting mail from them.');
      out.dim('');
      out.dim('Try:  google.com  ·  github.com  ·  paypal.com  ·  your own domain');
    }
  });
})();

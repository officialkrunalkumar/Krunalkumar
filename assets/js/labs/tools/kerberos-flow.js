/* ==========================================================================
   kerberos-flow.js — walk the Kerberos exchange, then run the attacks that
   define Active Directory security work.
   --------------------------------------------------------------------------
   The other identity labs here cover the protocols of the public internet:
   OAuth, SAML, JWT, passkeys. Kerberos is the one running inside the
   building, on the domain every one of those organisations still has, and it
   fails in ways none of the others do — because in Kerberos the credential is
   an encrypted blob you are ALLOWED to ask for, and the attack is to take it
   away and decrypt it at leisure.

   THAT IS THE INSIGHT WORTH BUILDING A TOOL AROUND. Kerberoasting is not an
   exploit. Nothing is bypassed, no bug is triggered, no alarm need sound: a
   domain user asks the KDC for a service ticket, which is exactly what the
   protocol is for, and the KDC hands over a blob encrypted with the service
   account's password hash. The attack happens afterwards, offline, on a
   machine you do not control. Watching that arrive as a normal request is
   more instructive than any diagram.

   ENCRYPTION TYPE IS A CONTROL, not a footnote, because it changes the
   arithmetic by orders of magnitude. Request a ticket as RC4-HMAC and the
   offline crack is a single MD4 and one RC4 per candidate. Force AES256 and
   every candidate costs 4096 iterations of PBKDF2. Same attack, same request,
   wildly different afternoon. Toggling it is the fastest way to understand
   why "disable RC4" is the advice it is.

   NOTHING IS FETCHED AND NO KDC IS CONTACTED. There is no domain here. Every
   message below is constructed in this tab from RFC 4120, which is also the
   honest way to demonstrate an attack: a tool that really did roast a service
   account would need a domain to roast.

   WHAT IT IS NOT. This does not test your domain, read your tickets, or tell
   you which of your accounts are roastable. That needs LDAP against your own
   directory, and it belongs on a machine that is joined to it.

   Specifications: RFC 4120 (Kerberos V5), RFC 3961/3962 (encryption types),
   RFC 4757 (RC4-HMAC), and Microsoft's [MS-PAC] and [MS-KILE].

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
    var v = String(value);
    if (COLS >= 58 && 22 + v.length <= COLS) { out.row(label, v, cls); return; }
    out.line(label, 't-dim');
    /* A value containing spaces is prose and should reflow to the pane. One
       without is a single token — a fingerprint, a challenge, a hash — and
       breaking it across lines produces something that does not work when
       copied, which is worse than a line that runs long. */
    if (/\s/.test(v) && v.length > COLS - 2) say(v, '  ', cls);
    else out.line('  ' + v, cls);
  }

  function step(n, title) { out.line(''); say(n + '. ' + title, '', 't-info'); }

  function blob(n) {
    var cs = 'ABCDEF0123456789';
    var s = '';
    var r = new Uint8Array(n);
    (self.crypto || self.msCrypto).getRandomValues(r);
    for (var i = 0; i < n; i++) s += cs.charAt(r[i] % 16);
    return s;
  }

  /* ------------------------------------------------------------------
     The realm.
     ------------------------------------------------------------------ */

  var R = {
    realm: 'CORP.EXAMPLE',
    user: 'alice',
    kdc: 'dc01.corp.example',
    spn: 'MSSQLSvc/sql01.corp.example:1433',
    svcAccount: 'svc_sql'
  };

  /* Encryption types, and the numbers that make the argument. The costs are
     the shape of the work per candidate password, not a benchmark: hardware
     moves, ratios do not. */
  var ETYPES = {
    rc4: {
      id: 23,
      name: 'rc4-hmac (RC4-HMAC-NT, etype 23)',
      key: 'the NT hash itself — MD4 of the UTF-16 password, no salt, no iteration',
      perGuess: 'one MD4, then one RC4 setup',
      rate: 'billions of candidates per second on one modern GPU',
      hashcat: '13100'
    },
    aes: {
      id: 18,
      name: 'aes256-cts-hmac-sha1-96 (etype 18)',
      key: 'PBKDF2-HMAC-SHA1 over the password with the realm and principal as salt, 4096 iterations',
      perGuess: '4096 iterations of PBKDF2-HMAC-SHA1, then AES',
      rate: 'a few hundred thousand candidates per second on the same GPU',
      hashcat: '19700'
    }
  };

  /* ------------------------------------------------------------------
     Walk: the exchange as designed.
     ------------------------------------------------------------------ */

  function walk(et, preauth) {
    say('Kerberos AS and TGS exchange', '', 't-info');
    say('Realm ' + R.realm + ' · encryption ' + ETYPES[et].name, '', 't-dim');
    rule();

    step(1, 'AS-REQ — the client asks for a ticket-granting ticket');
    out.line('  ' + R.user + '@' + R.realm + '  →  ' + R.kdc, 't-ok');
    out.line('    cname     ' + R.user, 't-ok');
    out.line('    sname     krbtgt/' + R.realm, 't-ok');
    out.line('    etype     ' + ETYPES[et].id + '  (' + et.toUpperCase() + ')', 't-ok');
    if (preauth) {
      out.line('    PA-ENC-TIMESTAMP', 't-ok');
      out.line('      encrypt(current time, key derived from alice\'s password)', 't-ok');
      out.line('');
      p('Pre-authentication is the client proving it knows the password BEFORE ' +
        'the KDC will issue anything. The proof is an encrypted timestamp: only ' +
        'someone with the key could have produced it, and the timestamp stops it ' +
        'being replayed later.');
    } else {
      out.line('    (no PA-ENC-TIMESTAMP)', 't-err');
      out.line('');
      pw('This account has "Do not require Kerberos preauthentication" set. The ' +
         'KDC will answer without any proof of identity at all. See the AS-REP ' +
         'roasting attack.');
    }

    step(2, 'AS-REP — the KDC answers with a TGT');
    out.line('  ' + R.kdc + '  →  ' + R.user, 't-ok');
    out.line('    ticket (the TGT)', 't-ok');
    out.line('      encrypted with the KRBTGT account key', 't-ok');
    out.line('      — opaque to the client', 't-ok');
    out.line('      ' + blob(48), 't-dim');
    out.line('    enc-part', 't-ok');
    out.line('      encrypted with ALICE\'s key: session key, expiry, flags', 't-ok');
    out.line('');
    p('Two encrypted parts with two different keys, and that split is the whole ' +
      'design. The client can read its half and cannot read the ticket; the ' +
      'service can read the ticket and never learns the password. Nothing in ' +
      'the middle needs to be trusted.');
    out.line('');
    p('The TGT carries a PAC — the user\'s SIDs and group memberships — signed ' +
      'by the KDC. That is what actually decides authorisation on a Windows ' +
      'domain, and it is why forging one is so powerful.');

    step(3, 'TGS-REQ — asking for a ticket to one service');
    out.line('  ' + R.user + '  →  ' + R.kdc, 't-ok');
    out.line('    sname     ' + R.spn, 't-ok');
    out.line('    ticket    the TGT from step 2', 't-ok');
    out.line('    authenticator  encrypted with the TGT session key', 't-ok');
    out.line('');
    p('Note what the KDC checks here: that the TGT decrypts and the ' +
      'authenticator is fresh. It does NOT check whether alice is allowed to ' +
      'use that service. Authorisation is the service\'s job, later. This is ' +
      'the single most consequential fact about Kerberos and the reason ' +
      'Kerberoasting works.');

    step(4, 'TGS-REP — a service ticket comes back');
    out.line('  ' + R.kdc + '  →  ' + R.user, 't-ok');
    out.line('    ticket for ' + R.spn, 't-ok');
    out.line('      encrypted with the key of ' + R.svcAccount, 't-ok');
    out.line('      ' + blob(48), 't-dim');
    out.line('    enc-part', 't-ok');
    out.line('      encrypted with the TGT session key: the service session key', 't-ok');

    step(5, 'AP-REQ — presenting the ticket to the service');
    out.line('  ' + R.user + '  →  sql01.corp.example', 't-ok');
    out.line('    ticket + authenticator', 't-ok');
    out.line('');
    p('The service decrypts the ticket with its own account key, reads the ' +
      'session key, and uses it to check the authenticator. It never talks to ' +
      'the KDC. That is what makes Kerberos scale, and what makes a forged ' +
      'ticket so hard to notice.');

    step(6, 'AP-REP — mutual authentication, if asked for');
    out.line('  sql01.corp.example  →  ' + R.user, 't-ok');
    out.line('    encrypted with the service session key', 't-ok');
    p('Optional, and it is what proves to the CLIENT that it is talking to the ' +
      'real service rather than something that merely accepted the ticket.');

    out.line('');
    rule();
    if (et === 'rc4') {
      pw('This exchange used RC4. Every ticket above is encrypted with an ' +
         'unsalted MD4 of a password, which is what makes the offline attacks ' +
         'in the other modes cheap. Run Kerberoasting with RC4 and then with ' +
         'AES256.');
    } else {
      po('This exchange used AES256. The offline attacks still work — they are ' +
         'not bugs — but each password guess costs about ten thousand times as ' +
         'much. Run Kerberoasting both ways to see it.');
    }
  }

  /* ------------------------------------------------------------------
     Attacks.
     ------------------------------------------------------------------ */

  function kerberoast(et) {
    var E = ETYPES[et];
    say('Attack: Kerberoasting', '', 't-info');
    say('Encryption ' + E.name, '', 't-dim');
    rule();
    out.line('');
    p('The thing to understand first: this is not an exploit. No bug is ' +
      'triggered and nothing is bypassed. Any authenticated domain user may ' +
      'ask the KDC for a ticket to any service, because deciding who may USE a ' +
      'service is the service\'s job and not the KDC\'s.');

    step(1, 'Find accounts with a service principal name');
    out.line('  LDAP, as any domain user:', 't-warn');
    out.line('    (&(objectClass=user)(servicePrincipalName=*))', 't-warn');
    out.line('');
    p('A user account with an SPN is the target. Machine accounts also have ' +
      'SPNs and are useless here: their passwords are 120 random characters, ' +
      'rotated automatically. It is the human-created service account with a ' +
      'password somebody chose in 2019 that matters.');

    step(2, 'Ask for a ticket. Normally.');
    out.line('  TGS-REQ   sname=' + R.spn + '   etype=' + E.id, 't-warn');
    out.line('  TGS-REP   ticket encrypted with the key of ' + R.svcAccount, 't-ok');
    out.line('    ' + blob(48), 't-dim');
    out.line('');
    p('Event 4769 is logged, as it is for every service ticket request on the ' +
      'domain, thousands of times a day. Requesting one ticket looks exactly ' +
      'like working. Requesting four hundred in a minute does not — which is ' +
      'the detection.');

    step(3, 'Leave. Crack it somewhere else.');
    p('Nothing further touches the domain. The blob is taken away and attacked ' +
      'offline, so there is no lockout, no failed logon, and no rate limit.');
    out.line('');
    kv('key derived by', E.key);
    kv('cost per guess', E.perGuess);
    kv('rough rate', E.rate);
    kv('hashcat mode', E.hashcat);
    out.line('');
    if (et === 'rc4') {
      pe('RC4 makes this cheap. The key IS the NT hash: one MD4 of the password, ' +
         'unsalted and uniterated. A service account password of eight or nine ' +
         'characters does not survive the afternoon.');
    } else {
      po('AES256 makes this expensive. 4096 PBKDF2 iterations per candidate is ' +
         'roughly ten thousand times the work of RC4 — the difference between an ' +
         'afternoon and a year for the same wordlist.');
      out.line('');
      pw('But note WHO chooses. The etype is requested by the CLIENT in the ' +
         'TGS-REQ. An attacker will ask for RC4, and unless the domain refuses ' +
         'it, the KDC will oblige. AES only helps once RC4 is actually disabled.');
    }

    out.line('');
    rule();
    say('What actually fixes it', '', 't-info');
    po('· Group Managed Service Accounts. 240-character passwords, rotated by ' +
       'the domain. This is the real answer: the crack never succeeds because ' +
       'there is no guessable password.');
    po('· Disable RC4 domain-wide, so the etype cannot be downgraded.');
    po('· For any service account you cannot convert, a 25-character random ' +
       'password gets you the same place by brute arithmetic.');
    po('· Alert on volume of 4769 per account, and on any 4769 requesting ' +
       'etype 23 once RC4 should be gone.');
    out.line('');
    p('Removing the SPN also works, and removes the service with it. Mentioned ' +
      'because it appears on checklists as though it were free.');
  }

  function asrepRoast(et) {
    var E = ETYPES[et];
    say('Attack: AS-REP roasting', '', 't-info');
    rule();
    out.line('');
    p('Kerberoasting needs a domain account to start from. This one needs ' +
      'nothing at all — only a username.');

    step(1, 'Find accounts that do not require pre-authentication');
    out.line('  userAccountControl & 0x400000', 't-warn');
    out.line('  (DONT_REQ_PREAUTH)', 't-warn');
    out.line('');
    p('The flag exists for old Unix Kerberos clients that could not do ' +
      'pre-authentication. It is usually set on one service account years ago ' +
      'by someone solving a real problem, and never unset.');

    step(2, 'Send an AS-REQ with no proof of anything');
    out.line('  AS-REQ    cname=' + R.svcAccount + '   (no PA-ENC-TIMESTAMP)', 't-err');
    out.line('  AS-REP    ' + blob(44), 't-err');
    out.line('');
    pe('The KDC answered. The enc-part of that reply is encrypted with the ' +
       'account\'s own key, so it is a crackable blob handed to an entirely ' +
       'unauthenticated stranger.');

    step(3, 'Crack offline');
    kv('cost per guess', E.perGuess);
    kv('hashcat mode', et === 'rc4' ? '18200' : '18200 (etype varies)');
    out.line('');
    p('Same offline arithmetic as Kerberoasting, and the same defence applies ' +
      'to the password. But the fix here is simpler and nearly always safe.');

    out.line('');
    rule();
    po('Clear DONT_REQ_PREAUTH. Audit for it regularly — it is a single flag, ' +
       'it is almost never needed on a modern network, and it converts "attacker ' +
       'needs a foothold" into "attacker needs a username".');
  }

  function golden() {
    say('Attack: Golden Ticket', '', 't-info');
    rule();
    out.line('');
    pe('Prerequisite: the KRBTGT account\'s key. Obtaining that means the domain ' +
       'is already fully compromised — this is not a way in, it is a way to ' +
       'stay in.');

    step(1, 'Why the KRBTGT key is everything');
    p('Every TGT on the domain is encrypted with it. A KDC does not keep a list ' +
      'of tickets it has issued; it decides a TGT is genuine because it ' +
      'decrypts correctly. Hold that key and you can write a TGT rather than ' +
      'ask for one.');

    step(2, 'Forge');
    out.line('  TGT  user=anything', 't-err');
    out.line('       groups=512 (Domain Admins), 519 (Enterprise Admins)', 't-err');
    out.line('       lifetime=10 years', 't-err');
    out.line('       encrypted with the KRBTGT key', 't-err');
    out.line('');
    pe('The user need not exist. The groups need not contain them. The PAC is ' +
       'signed with the same key, so the signature checks out.');

    step(3, 'Why it is so hard to see');
    p('There is no AS-REQ, because no ticket was requested — event 4768 never ' +
      'fires. The first thing the domain sees is a TGS-REQ arriving with a ' +
      'perfectly valid TGT it has no record of issuing.');
    out.line('');
    p('Detection is the mismatch: a 4769 with no preceding 4768 for that user, ' +
      'a ticket lifetime longer than the domain policy allows, or a username ' +
      'in a ticket that does not exist in the directory.');

    out.line('');
    rule();
    say('What actually fixes it', '', 't-info');
    po('· Reset the KRBTGT password TWICE, with a gap longer than the maximum ' +
       'ticket lifetime between them. Twice because the KDC keeps the previous ' +
       'key to avoid invalidating tickets in flight — one reset leaves every ' +
       'forged ticket working.');
    po('· The gap matters as much as the second reset. Doing both immediately ' +
       'breaks live sessions across the domain and still leaves a window.');
    po('· Then find out how the key was obtained, because a Golden Ticket is ' +
       'the symptom.');
  }

  function silver() {
    say('Attack: Silver Ticket', '', 't-info');
    rule();
    out.line('');
    p('The quieter sibling of the Golden Ticket. Instead of the KRBTGT key, it ' +
      'needs only the key of ONE service account — and it never touches the ' +
      'domain controller at all.');

    step(1, 'Forge a service ticket directly');
    out.line('  Service ticket for ' + R.spn, 't-err');
    out.line('    user=Administrator   groups=512', 't-err');
    out.line('    encrypted with the key of ' + R.svcAccount, 't-err');

    step(2, 'Present it');
    out.line('  AP-REQ  →  sql01.corp.example', 't-err');
    out.line('');
    pe('It works, because a service validates a ticket entirely by itself. The ' +
       'KDC is not consulted and has no idea this happened. There is no 4768 ' +
       'and no 4769 — nothing was requested.');
    out.line('');
    p('Scope is the trade: this grants that one service, not the domain. For an ' +
      'attacker sitting on a database or a file server, that is frequently ' +
      'enough, and the near-total absence of logging makes it the better choice.');

    out.line('');
    rule();
    say('What actually fixes it', '', 't-info');
    po('· Group Managed Service Accounts again — a key nobody can steal from a ' +
       'memory dump stays unforgeable.');
    po('· Enable PAC validation, so the service asks the KDC to confirm the PAC ' +
       'signature instead of trusting it.');
    po('· Rotate service account passwords. The forged ticket dies with the key ' +
       'it was signed with.');
    po('· Watch the service host itself: the KDC will never see this, so ' +
       'host-based logging is the only place it appears.');
  }

  function passTheTicket() {
    say('Attack: Pass-the-Ticket', '', 't-info');
    rule();
    out.line('');
    p('No cracking and no forging. Kerberos tickets are bearer credentials, and ' +
      'this is simply picking one up and using it.');

    step(1, 'Take a ticket out of memory');
    out.line('  LSASS on a machine the attacker already controls', 't-warn');
    out.line('    → TGT for a domain admin who logged in to fix something', 't-err');
    out.line('');
    pe('That last part is the whole attack. An administrator who logs in ' +
       'interactively to a compromised workstation leaves a usable TGT in its ' +
       'memory, and it stays there for the ticket lifetime.');

    step(2, 'Use it anywhere');
    out.line('  Inject into a session and request service tickets as that user', 't-err');
    out.line('');
    p('The ticket is not bound to a machine, a process or an address. Nothing ' +
      'in the protocol objects.');

    out.line('');
    rule();
    say('What actually fixes it', '', 't-info');
    po('· Tiering. Domain admin credentials never touch a workstation — this is ' +
       'the control that actually works, and it is organisational rather than ' +
       'technical.');
    po('· Protected Users group: no RC4, no delegation, and a 4-hour ticket ' +
       'lifetime.');
    po('· Credential Guard, which puts the tickets somewhere LSASS access ' +
       'cannot reach.');
    po('· Short ticket lifetimes, so a stolen ticket expires while it is still ' +
       'being carried.');
  }

  function delegation() {
    say('Attack: unconstrained delegation', '', 't-info');
    rule();
    out.line('');
    p('A feature, working as designed, with consequences most people who enable ' +
      'it have not thought through.');

    step(1, 'What the flag does');
    out.line('  TRUSTED_FOR_DELEGATION on a computer account', 't-warn');
    out.line('');
    p('When any user authenticates to that host, their entire TGT is placed in ' +
      'the ticket and cached in the host\'s memory — so the host can turn ' +
      'around and act as them anywhere on the domain. That is the point of the ' +
      'feature: a web server reaching a database as the real user.');

    step(2, 'What that means if the host is compromised');
    pe('Every TGT of every user who has touched that machine is sitting in its ' +
       'memory, waiting. Not a hash to crack. A working ticket.');

    step(3, 'And you can choose who touches it');
    out.line('  The printer bug (MS-RPRN) / coercion:', 't-err');
    out.line('    force DC01$ to authenticate to the compromised host', 't-err');
    out.line('');
    pe('Now the domain controller\'s own TGT is in your memory. From there the ' +
       'domain is over.');

    out.line('');
    rule();
    say('What actually fixes it', '', 't-info');
    po('· Audit for it: (userAccountControl:1.2.840.113556.1.4.803:=524288). ' +
       'Most domains have one or two hosts nobody remembers configuring.');
    po('· Replace it with constrained delegation, or resource-based constrained ' +
       'delegation, which limits what the host may impersonate to.');
    po('· Put privileged accounts in Protected Users and mark them "sensitive ' +
       'and cannot be delegated", so their tickets are never cached this way.');
    po('· Disable the Print Spooler where it is not needed, to remove the ' +
       'easiest coercion.');
  }

  /* ------------------------------------------------------------------
     Dispatch.
     ------------------------------------------------------------------ */

  var MODES = {
    'attack-kerberoast': kerberoast,
    'attack-asrep': asrepRoast,
    'attack-golden': golden,
    'attack-silver': silver,
    'attack-ptt': passTheTicket,
    'attack-delegation': delegation
  };

  function modeEl() { return document.getElementById('tool-mode'); }
  function etypeEl() { return document.getElementById('tool-etype'); }

  function run() {
    out.clear();
    COLS = measureCols();
    var mode = modeEl() ? modeEl().value : 'walk';
    var et = etypeEl() ? etypeEl().value : 'rc4';

    try {
      if (mode === 'walk') walk(et, true);
      else if (mode === 'walk-nopreauth') walk(et, false);
      else if (MODES[mode]) MODES[mode](et);
      else out.err('Unknown mode.');
    } catch (e) {
      out.err('Could not build that: ' + e.message);
    }
  }

  /* Encryption type only changes the arithmetic of the two offline-cracking
     attacks and the walk. For a forged or stolen ticket it changes nothing, so
     the control is disabled rather than left there implying otherwise. */
  function syncControls() {
    var m = modeEl();
    var e = etypeEl();
    if (!m || !e) return;
    var relevant = m.value === 'walk' || m.value === 'walk-nopreauth' ||
                   m.value === 'attack-kerberoast' || m.value === 'attack-asrep';
    e.disabled = !relevant;
    e.setAttribute('aria-disabled', relevant ? 'false' : 'true');
  }

  LabTool.define({
    id: 'kerberosflowtool',
    run: run,
    onReady: function () {
      var m = modeEl();
      if (m) m.addEventListener('change', syncControls);
      syncControls();
      COLS = measureCols();
      p('Pick a mode and press Run.');
      out.line('');
      p('Walk the exchange — AS-REQ through AP-REP, and what each half proves.');
      p('An attack — what the attacker sends, and what actually fixes it.');
      out.line('');
      p('Start with Kerberoasting. Run it as RC4, then as AES256, and read the ' +
        'cost-per-guess line both times: that one number is the entire argument ' +
        'for disabling RC4.');
      out.line('');
      p('No KDC is contacted and no domain is touched. Every message is built ' +
        'in this tab from RFC 4120.');
    }
  });
})();

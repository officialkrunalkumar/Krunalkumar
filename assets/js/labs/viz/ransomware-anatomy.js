/* ==========================================================================
   ransomware-anatomy.js — how a ransomware incident actually unfolds, for the
   people who have to fund the defence rather than for anyone who wants to
   build the attack.
   --------------------------------------------------------------------------
   Three families over one small model:

     1. The intrusion  — nine stages from the first door to the note, each one
                         steppable, with six defensive controls the visitor can
                         switch on and watch the chain halt at the stage that
                         control actually bites. That toggle is the whole point
                         of the page; everything else is context for it.
     2. Files and keys — a fake in-memory file tree enumerated and then
                         "encrypted", with the key hierarchy drawn honestly: a
                         fresh symmetric key per file, wrapped with the
                         operator’s public key. That structure is exactly why
                         paying is the only way back without a backup, and
                         exactly why an offline copy breaks the model.
     3. The bill       — days and money for three recovery postures, computed
                         from the visitor’s own numbers rather than from an
                         industry average I would have to invent.

   Things worth spelling out, because they constrain the code:

   1. Nothing here encrypts anything. There is no WebCrypto call, no key
      material, no cipher of any kind, and no file of the visitor’s is ever
      read. The "keys" on screen are labels produced by a seeded linear
      congruential generator so that scrubbing backwards shows the same string
      it showed on the way forward. They are decoration over a story.

   2. There is deliberately no operational detail. No tool names, no command
      lines, no CVE numbers, no evasion technique described in a way anyone
      could act on. Every stage is named at the level a board paper names it,
      because a board paper is what this page is trying to help someone write.

   3. The controls do not all halt the chain, and pretending they did would be
      the easiest lie on the page. MFA halts a stolen-password login and does
      nothing whatsoever about a malicious attachment. Segmentation caps the
      blast radius and stops nothing. Backups stop none of it and change the
      ending completely. Each effect is tagged halt, blunt or detect, and the
      text says which.

   4. The cost model takes the visitor’s inputs and does arithmetic on them.
      Published figures for downtime cost, ransom size and recovery time
      disagree with each other by an order of magnitude depending on who was
      surveyed, so quoting one would look authoritative and mean nothing. The
      defaults are labelled as illustrative and the panel says so.

   Nothing here opens a network connection.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* ======================================================================== */
  /*  CORE 1 — THE INTRUSION                                                  */
  /* ======================================================================== */

  var CONTROLS = [
    { key: 'mfa', label: 'Multi-factor authentication on every remote entry point', short: 'MFA' },
    { key: 'patch', label: 'Internet-facing kit patched on a clock', short: 'Patching' },
    { key: 'edr', label: 'EDR deployed and actually watched', short: 'EDR' },
    { key: 'least', label: 'Least privilege — no standing admin everywhere', short: 'Least privilege' },
    { key: 'segment', label: 'Network segmentation between zones', short: 'Segmentation' },
    { key: 'backup', label: 'Offline or immutable backups, restore-tested', short: 'Offline backups' }
  ];

  /* Three ways in. They are the three that turn up over and over in incident
     reports, and they are useful here precisely because the same control list
     produces three different answers against them — which is the argument for
     buying more than one thing. */
  var ROUTES = [
    {
      key: 'phish',
      label: 'A phishing email with an attachment',
      what: 'An invoice lands in the accounts inbox. It is a reply inside a thread that already ' +
        'existed, sent from a supplier’s real mailbox that was itself taken over a month ago, so ' +
        'the sender is somebody the reader has emailed before and the subject line is a job they ' +
        'are actually waiting on. The attachment gets opened.',
      seen: 'Nothing. One user opens one file. There is no alert, because at this point nothing ' +
        'unusual has happened on any system you own.',
      effects: [
        { c: 'mfa', kind: 'none',
          text: 'MFA is switched on and makes no difference at all here. Nobody is logging in as ' +
            'anybody. This is the case people forget when they treat MFA as the answer to phishing.' }
      ],
      hint: 'Nothing on the control list stops a person opening an attachment. Mail filtering and ' +
        'reporting culture reduce how often it happens, and neither is a switch, which is why ' +
        'neither is on the list.'
    },
    {
      key: 'rdp',
      label: 'A remote desktop server exposed to the internet',
      what: 'A jump box was published to the internet for a project in 2022 and never taken down. ' +
        'A password that appeared in an unrelated breach two years ago still works on it, because ' +
        'the person who chose it uses it in several places.',
      seen: 'A successful sign-in from an address in a country you do not operate in, at a time ' +
        'nobody works. It is in the logs. Somebody has to be reading the logs.',
      effects: [
        { c: 'mfa', kind: 'halt',
          text: 'The password is correct and it is not enough. The second factor is not something ' +
            'a credential dump contains, so the login fails and the operator moves on to somebody ' +
            'else’s network. This is the single highest-yield control on the list against this route.' },
        { c: 'segment', kind: 'blunt',
          text: 'A jump box that can only reach a management zone is a much smaller prize than one ' +
            'that can reach everything.' }
      ],
      hint: 'This route is a password problem wearing a networking costume. The exposure is what ' +
        'makes it reachable; the reused password is what makes it work.'
    },
    {
      key: 'edge',
      label: 'An unpatched internet-facing appliance',
      what: 'A VPN concentrator or firewall is running a build with a published flaw that needs no ' +
        'credentials to exploit. Scanning the whole internet for that build takes hours and is done ' +
        'by people who sell the access on rather than use it themselves.',
      seen: 'A device you think of as infrastructure rather than as a server quietly gains a new ' +
        'session. Most organisations have no detection on the appliance itself.',
      effects: [
        { c: 'patch', kind: 'halt',
          text: 'The build was updated inside the window between the fix being published and the ' +
            'exploit being commodity, so the scan finds nothing to hit and the operator goes ' +
            'looking for somebody who was slower. That window is measured in days now, not months.' },
        { c: 'mfa', kind: 'none',
          text: 'MFA is on and it changes nothing. A flaw that runs before authentication is not a ' +
            'login, so there is no prompt to answer. This is the route people are most surprised by.' }
      ],
      hint: 'The uncomfortable part of this route is that the appliance is often owned by whoever ' +
        'installed it and patched by nobody in particular.'
    }
  ];

  /* Stage 0 is supplied by the route. The other eight are the same shape
     whichever door was used, which is itself the finding: the entry varies and
     the middle of the chain barely does. */
  var STAGES = [
    { key: 'access', name: 'Initial access', dwell: 'minutes' },
    {
      key: 'exec', name: 'Execution and a foothold', dwell: 'minutes to hours',
      what: 'A small loader runs and calls out to infrastructure the operator controls. It is not ' +
        'the ransomware. Its whole job is to be a reliable way back in, and it is usually the only ' +
        'thing on the machine for days.',
      seen: 'A process doing something a process of that name has never done on that machine ' +
        'before, and a connection to a host nobody has ever spoken to. This is the loudest moment ' +
        'of the early chain and the one most often missed.',
      effects: [
        { c: 'edr', kind: 'halt',
          text: 'The loader is stopped on execution and an alert fires. Say the honest half out ' +
            'loud too: an alert at two in the morning on a Saturday is only a control if somebody ' +
            'is rostered to read it. EDR that nobody watches is a very expensive log file.' }
      ]
    },
    {
      key: 'escalate', name: 'Privilege escalation', dwell: 'minutes to days',
      what: 'The account they landed on is somebody in accounts, not an administrator. They need ' +
        'more, and there are many routes to it — a machine missing an update, a service running as ' +
        'something too powerful, a password sitting in a script somebody wrote in 2019.',
      seen: 'Credential access on an endpoint, or an account suddenly doing administrative things ' +
        'it has never done. Both are detectable and both are noisy.',
      effects: [
        { c: 'least', kind: 'blunt',
          text: 'The easy path is closed: the user is not a local administrator, so the obvious ' +
            'route needs replacing with a harder one. That costs the operator days. Days are the ' +
            'commodity you are buying — every one of them is a chance for something else to fire.' },
        { c: 'patch', kind: 'blunt',
          text: 'A patched endpoint removes a whole family of local escalation routes. It does not ' +
            'remove the ones that are misconfiguration rather than vulnerability.' },
        { c: 'edr', kind: 'detect',
          text: 'Credential access is one of the most reliably alerted behaviours there is.' }
      ]
    },
    {
      key: 'discover', name: 'Discovery', dwell: 'hours to days',
      what: 'They map you. Directory structure, who is an administrator, which servers matter, ' +
        'where the file shares are, what the hypervisors are called, and — first and with real ' +
        'attention — where the backups live and what account controls them.',
      seen: 'Enumeration at a volume no human generates. This stage is loud in every log you have. ' +
        'It is also the stage where organisations most often see something, log a ticket, and ' +
        'close it as noise.',
      effects: [
        { c: 'segment', kind: 'blunt',
          text: 'They can only map what their segment can reach, so the picture they build is ' +
            'smaller and wrong in ways that help you.' },
        { c: 'edr', kind: 'detect',
          text: 'Mass enumeration is close to unmissable if anything is looking. It is the cheapest ' +
            'detection opportunity in the whole chain.' }
      ]
    },
    {
      key: 'lateral', name: 'Lateral movement', dwell: 'days to weeks',
      what: 'They move from the machine they have to the machines they want, using the credentials ' +
        'they collected and the ordinary remote administration your own team uses. The target is ' +
        'the identity plane — domain controllers and the management tooling — because owning that ' +
        'means owning everything at once rather than one box at a time.',
      seen: 'An account signing in to machines it has no business touching, at hours nobody works. ' +
        'This is where dwell time is spent, and dwell time is where you get to intervene.',
      effects: [
        { c: 'least', kind: 'halt',
          text: 'The credential they hold is not a key to every machine on the network, which is ' +
            'the single assumption the entire lateral phase rests on. It does not make the ' +
            'intrusion disappear — they still hold the first machine — but the estate-wide ' +
            'encryption they came for needs estate-wide access, and they do not have it.' },
        { c: 'segment', kind: 'blunt',
          text: 'Segmentation does not stop them moving. It caps how far the movement gets, which ' +
            'turns a company-ending event into a bad week in one business unit.' },
        { c: 'edr', kind: 'detect',
          text: 'Remote execution between servers that never talk to each other is a strong signal ' +
            'if anyone is correlating.' }
      ]
    },
    {
      key: 'evade', name: 'Defence evasion, and the backups',
      dwell: 'hours',
      what: 'Protection gets switched off wherever their new privileges allow it, logs get cleared, ' +
        'and the local snapshots go. Then the part that decides the whole outcome: they go for the ' +
        'backup system itself. Deleting your recovery is not a side effect of the attack. It is a ' +
        'deliberate, targeted step, taken before anything is encrypted, precisely because they know ' +
        'a restore is the only thing that makes the ransom optional.',
      seen: 'Security tooling reporting itself as disabled, and a backup console showing a ' +
        'retention job nobody scheduled. If you get one alert out of this whole incident, this is ' +
        'the one you want.',
      effects: [
        { c: 'backup', kind: 'blunt',
          text: 'The online repository goes and the snapshots go with it. The immutable copy does ' +
            'not: the retention lock is enforced by the storage rather than by an account they can ' +
            'take over, so the delete is simply refused. The offline tape is not deleted for the ' +
            'obvious reason that it is not plugged into anything. They will not find out until you ' +
            'restore, and neither will you unless you have tested it.' },
        { c: 'edr', kind: 'detect',
          text: 'Tamper protection turning an attempted shutdown into an alert is exactly what it ' +
            'is for.' }
      ]
    },
    {
      key: 'exfil', name: 'Exfiltration, for the second lever',
      dwell: 'hours to days',
      what: 'Data is copied out before anything is locked — the finance folder, HR, contracts, ' +
        'whatever looks embarrassing or regulated. This is the double extortion model: encryption ' +
        'is the lever that stops you working, and the copy is the lever that keeps working after ' +
        'you have restored.',
      seen: 'A large, sustained outbound transfer to somewhere you have never sent data, usually ' +
        'to ordinary cloud storage because ordinary cloud storage is not blocked anywhere.',
      effects: [
        { c: 'segment', kind: 'blunt',
          text: 'Egress control and segmentation together reduce what can leave and from where. ' +
            'Reduce, not prevent — this is a bandwidth argument, not a wall.' },
        { c: 'edr', kind: 'detect',
          text: 'Volume anomalies are detectable. Whether anyone has a baseline to compare against ' +
            'is the real question.' }
      ]
    },
    {
      key: 'encrypt', name: 'Encryption',
      dwell: 'minutes to hours',
      what: 'The actual ransomware is pushed to everything at once, usually through the same ' +
        'management tooling your own team deploys software with, and usually at a weekend or a ' +
        'public holiday. It runs fast. The estate is unusable before most people know anything ' +
        'happened. Everything before this took weeks; this part is the short bit at the end.',
      seen: 'Files becoming unreadable across the estate simultaneously, and then the phones going.',
      effects: [
        { c: 'edr', kind: 'blunt',
          text: 'Some products stop mass file rewriting and roll part of it back. Treat that as a ' +
            'partial save on a bad day, not as a control you would plan around.' }
      ]
    },
    {
      key: 'note', name: 'The note, and the clock',
      dwell: 'immediate',
      what: 'A note on every machine, a payment address, a countdown, and a link to a page listing ' +
        'the data they took with a publication date on it. The demand is usually sized to what your ' +
        'accounts say you can afford, because they read those while they were mapping you.',
      seen: 'This is the moment almost every organisation discovers it has been breached — weeks ' +
        'after the first door opened and hours after the only thing that would have made the ' +
        'decision easy was deleted.',
      effects: [
        { c: 'backup', kind: 'decide',
          text: 'With a copy they could not reach, the encryption becomes an outage rather than an ' +
            'extinction event. You still have a serious incident, a rebuild and a stolen-data ' +
            'problem. You do not have a payment decision.' }
      ]
    }
  ];

  function controlOn(on, key) { return !!(on && on[key]); }

  /* Walk the chain with a given route and a given set of enabled controls.
     Returns every stage with its live effects attached, the index the chain
     halted at (or -1), and an outcome for the ending. */
  function runChain(routeKey, on) {
    var route = null, i, j;
    for (i = 0; i < ROUTES.length; i++) if (ROUTES[i].key === routeKey) route = ROUTES[i];
    if (!route) route = ROUTES[0];

    var out = [], halt = -1;
    for (i = 0; i < STAGES.length; i++) {
      var base = STAGES[i];
      var src = i === 0 ? route.effects : base.effects;
      var live = [];
      for (j = 0; src && j < src.length; j++) {
        if (controlOn(on, src[j].c)) live.push(src[j]);
      }
      out.push({
        key: base.key,
        name: base.name,
        dwell: base.dwell,
        what: i === 0 ? route.what : base.what,
        seen: i === 0 ? route.seen : base.seen,
        hint: i === 0 ? route.hint : '',
        effects: live,
        halted: false
      });
      for (j = 0; j < live.length; j++) {
        if (live[j].kind === 'halt') { halt = i; out[i].halted = true; break; }
      }
      if (halt >= 0) break;
    }

    return { route: route, stages: out, halt: halt, backup: controlOn(on, 'backup') };
  }

  function chainOutcome(res) {
    if (res.halt >= 0) {
      return {
        tone: 'good',
        head: 'The chain stops at ' + res.stages[res.halt].name.toLowerCase() + '.',
        body: 'One control ended this path before anything was encrypted and before anything was ' +
          'copied out. Read that carefully, though: it ended this path. The operator is not ' +
          'arrested, has not lost interest, and is running the same playbook against a list of ' +
          'targets that you are one line of. They come back through a different door, and the ' +
          'control that closes the next one is a different control. That is the entire argument ' +
          'for depth over a single purchase.'
      };
    }
    if (res.backup) {
      return {
        tone: 'mixed',
        head: 'Everything ran, and you can still restore.',
        body: 'Nothing stopped the intrusion, so they mapped you, took your data and locked your ' +
          'estate. But the copy they could not reach means the encryption is an outage with a ' +
          'known end date rather than a decision about whether to pay criminals. You have a long, ' +
          'expensive rebuild ahead and a stolen-data problem that no backup touches. You do not ' +
          'have a hostage negotiation. That is the difference one control makes at the very last ' +
          'stage, having prevented none of the ones before it.'
      };
    }
    return {
      tone: 'bad',
      head: 'Everything ran, and there is nothing to restore from.',
      body: 'The estate is encrypted, the recovery was deleted three stages before the note ' +
        'appeared, and a copy of your data is sitting on somebody else’s server with a publication ' +
        'date attached. This is the position where paying stops being a moral question and starts ' +
        'being an operational one — and it is worth being clear that paying buys a decryption tool ' +
        'from the people who did this, not a restore, and does nothing about the copy.'
    };
  }

  /* ======================================================================== */
  /*  CORE 2 — FILES AND KEYS                                                 */
  /* ------------------------------------------------------------------------ */
  /*  A fake tree in memory. Nothing here reads, writes or encrypts anything.  */
  /*  The key strings are produced by a seeded LCG so that stepping backwards  */
  /*  shows the same value it showed on the way forward — they are labels in   */
  /*  a story, not key material, and there is no cipher anywhere in this file. */
  /* ======================================================================== */

  var TREE = [
    { d: 0, name: '\\\\FILESERVER\\Finance', kind: 'dir' },
    { d: 1, name: '2026', kind: 'dir' },
    { d: 2, name: 'Q1-forecast.xlsx', kind: 'file', size: '412 KB' },
    { d: 2, name: 'payroll-march.xlsx', kind: 'file', size: '96 KB' },
    { d: 1, name: 'contracts', kind: 'dir' },
    { d: 2, name: 'acme-msa.pdf', kind: 'file', size: '1.8 MB' },
    { d: 2, name: 'renewal-notes.docx', kind: 'file', size: '54 KB' },
    { d: 0, name: '\\\\FILESERVER\\Engineering', kind: 'dir' },
    { d: 1, name: 'drawings', kind: 'dir' },
    { d: 2, name: 'line-3-layout.dwg', kind: 'file', size: '22 MB' },
    { d: 1, name: 'src', kind: 'dir' },
    { d: 2, name: 'deploy.ps1', kind: 'file', size: '7 KB' },
    { d: 0, name: 'D:\\Backups', kind: 'dir' },
    { d: 1, name: 'nightly-repo', kind: 'dir' },
    { d: 2, name: 'daily-2026-08-30.bkf', kind: 'backup', size: '840 GB' },
    { d: 1, name: 'offsite-vault (immutable)', kind: 'vault', size: '840 GB' },
    { d: 0, name: 'C:\\Windows\\System32', kind: 'dir' },
    { d: 1, name: 'ntoskrnl.exe', kind: 'skip', size: '11 MB' },
    { d: 1, name: 'winload.efi', kind: 'skip', size: '1.5 MB' }
  ];

  function fakeHex(seed, n) {
    var s = (seed * 2654435761) >>> 0, out = '', i;
    var hex = '0123456789abcdef';
    for (i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      out += hex.charAt((s >>> 17) & 15);
    }
    return out;
  }

  /* Build the frame list. One pass enumerating every node, then one pass over
     the nodes the encryptor would actually touch, then the note and the
     recovery reading. `immutable` decides whether the vault is in the tree at
     all, because that is the toggle the whole family exists to demonstrate. */
  function buildFileFrames(mode, immutable) {
    var nodes = [], i;
    for (i = 0; i < TREE.length; i++) {
      if (TREE[i].kind === 'vault' && !immutable) continue;
      nodes.push(TREE[i]);
    }

    var frames = [{ phase: 'intro', node: -1 }];
    for (i = 0; i < nodes.length; i++) frames.push({ phase: 'walk', node: i });
    for (i = 0; i < nodes.length; i++) {
      var k = nodes[i].kind;
      if (k === 'file' || k === 'backup' || k === 'vault') frames.push({ phase: 'lock', node: i });
    }
    frames.push({ phase: 'note', node: -1 });
    frames.push({ phase: 'after', node: -1 });
    return { nodes: nodes, frames: frames, mode: mode, immutable: immutable };
  }

  /* Which nodes are in which state at a given frame. Recomputed rather than
     mutated, so scrubbing backwards is exact. */
  function fileStateAt(model, idx) {
    var f = model.frames[Math.max(0, Math.min(model.frames.length - 1, idx))];
    var state = [], i;
    for (i = 0; i < model.nodes.length; i++) state.push('none');

    var seenTo = -1, lockedTo = -1;
    if (f.phase === 'walk') seenTo = f.node;
    else if (f.phase !== 'intro') seenTo = model.nodes.length - 1;
    if (f.phase === 'lock') lockedTo = f.node;
    else if (f.phase === 'note' || f.phase === 'after') lockedTo = model.nodes.length - 1;

    for (i = 0; i < model.nodes.length; i++) {
      if (i <= seenTo) state[i] = 'seen';
      var k = model.nodes[i].kind;
      if (i <= lockedTo && (k === 'file' || k === 'backup')) state[i] = 'locked';
      if (i <= lockedTo && k === 'vault') state[i] = 'refused';
      if (i <= seenTo && k === 'skip') state[i] = 'skipped';
    }
    return { frame: f, state: state };
  }

  var KEY_LEVELS = [
    {
      key: 'private', name: 'The operator’s private key', down: 'is one half of a pair with',
      where: 'On a machine you will never see, in a jurisdiction you will never reach.',
      note: 'This is the entire business model in one line. It never touches your network, so ' +
        'there is nothing to recover from your own estate, no matter how good your forensics are.'
    },
    {
      key: 'public', name: 'The operator’s public key', down: 'which wraps',
      where: 'Shipped inside the binary that ran on your servers.',
      note: 'You can extract it in an afternoon and it will not help you. A public key locks; it ' +
        'does not open. Finding it in the sample is the moment a responder confirms what they are ' +
        'dealing with and confirms they cannot fix it.'
    },
    {
      key: 'file', name: 'One symmetric key per file', down: 'producing',
      naiveName: 'One symmetric key, reused on every file',
      where: 'Generated in memory on your own server, used once, wrapped, then discarded.',
      note: 'Symmetric because public-key operations over terabytes would take a week and this ' +
        'part needs to be over before anyone wakes up. Every file gets its own, so recovering one ' +
        'key recovers exactly one file.'
    },
    {
      key: 'blob', name: 'The wrapped key, written next to your data',
      naiveName: 'Nothing wrapped, because there is nothing to wrap',
      where: 'Appended to the file, or into a header, right there on your disk.',
      note: 'The key you need is in the room with you and it is inside a lock only the private key ' +
        'opens. That is the part people find hardest to believe, and it is the honest answer to ' +
        '"can’t you just get it off the disk".'
    }
  ];

  /* ======================================================================== */
  /*  CORE 3 — THE BILL                                                       */
  /* ------------------------------------------------------------------------ */
  /*  Arithmetic over the visitor's own numbers. Published averages for        */
  /*  downtime cost, ransom size and recovery duration disagree by an order of */
  /*  magnitude depending on who was surveyed and who paid for the survey, so  */
  /*  a quoted figure here would be authoritative-looking noise. The defaults  */
  /*  are illustrative and the panel says so out loud.                         */
  /* ======================================================================== */

  var POSTURES = [
    { key: 'offline', label: 'Offline or immutable backups survived' },
    { key: 'online', label: 'Backups were on the network and were encrypted too' },
    { key: 'none', label: 'No usable backup at all' }
  ];

  function ceilDiv(a, b) { return Math.max(1, Math.ceil(a / Math.max(0.1, b))); }

  function buildLanes(inp, posture) {
    var lanes = [];
    var rate = Math.max(1, inp.rate);
    var fail = Math.max(0, Math.min(90, inp.fail)) / 100;

    if (posture === 'offline') {
      lanes.push({
        key: 'restore', label: 'Restore from the copy they could not reach', tone: 'good',
        ransom: 0,
        bands: [
          { label: 'Detect, disconnect, contain', days: 1,
            note: 'Everything comes off the network before anything else happens, which means you ' +
              'are down on purpose as well as by accident.' },
          { label: 'Forensics: find the door and shut it', days: 2,
            note: 'Restoring before you know how they got in is how organisations get encrypted ' +
              'twice in a fortnight. This step is not optional and it is not fast.' },
          { label: 'Rebuild the identity plane from clean media', days: 2,
            note: 'You cannot restore into a domain somebody else still holds. Domain controllers ' +
              'and the management tooling get rebuilt, not restored.' },
          { label: 'Restore servers', days: ceilDiv(inp.servers, rate),
            note: 'At ' + rate + ' server(s) a day for ' + inp.servers + '. This is the number ' +
              'most restore plans get wrong, because it was measured on one server and multiplied.' },
          { label: 'Verify, reconnect, watch closely', days: 2,
            note: 'Coming back online in stages, with monitoring turned up, because the assumption ' +
              'is that they are still watching.' },
          { label: 'The tail: notification, regulator, customers', days: 0,
            note: 'A backup restores your files. It does not un-copy the data they took, so this ' +
              'part runs for months and belongs on the same page as the recovery cost.' }
        ]
      });
    }

    lanes.push({
      key: 'pay', label: 'Pay, and run their decryption tool', tone: 'bad',
      ransom: inp.ransom,
      bands: [
        { label: 'Detect, disconnect, contain', days: 1,
          note: 'Identical to every other path. Nobody escapes this day.' },
        { label: 'Forensics: find the door and shut it', days: 2,
          note: 'Also identical. Paying does not skip this — a decrypted estate with the same open ' +
            'door is a re-encrypted estate.' },
        { label: 'Negotiate, verify a sample, arrange payment', days: 4,
          note: 'Days of back-and-forth, a test decryption of two files to prove they can, and a ' +
            'payment process that is its own legal and banking problem. Whether paying is even ' +
            'lawful depends on who is on the other end, and that is a question for a lawyer.' },
        { label: 'Rebuild the identity plane anyway', days: 2,
          note: 'A decryptor returns files. It does not return trust in an environment somebody ' +
            'else had domain admin in for three weeks.' },
        { label: 'Run the decryptor across the estate', days: ceilDiv(inp.servers, rate * 0.6),
          note: 'Slower than a restore, because it is a tool written by people optimising for ' +
            'their revenue rather than your recovery time, and it runs on machines that are ' +
            'already sick.' },
        { label: 'Rebuild what the decryptor did not return', days: ceilDiv(inp.servers * fail, rate),
          note: 'At the ' + inp.fail + '% failure rate set in the panel. Partial and corrupted ' +
            'returns are normal, not exceptional.' },
        { label: 'Verify, reconnect, watch closely', days: 2,
          note: 'Same as the restore path, with less confidence in what you are reconnecting.' },
        { label: 'The tail — and the copy is still theirs', days: 0,
          note: 'The payment sometimes buys a promise to delete the stolen data. It buys a promise.' }
      ]
    });

    if (posture !== 'offline') {
      lanes.push({
        key: 'rebuild', label: 'Rebuild from nothing', tone: 'worst',
        ransom: 0,
        bands: [
          { label: 'Detect, disconnect, contain', days: 1, note: 'The same first day.' },
          { label: 'Forensics: find the door and shut it', days: 2, note: 'The same second and third.' },
          { label: 'Rebuild the identity plane from clean media', days: 2,
            note: 'From installation media and documentation, if the documentation was not also on ' +
              'the file share.' },
          { label: 'Rebuild every server from scratch', days: ceilDiv(inp.servers, rate * 0.4),
            note: 'Not a restore. An install, a configure and a test, for each one, by people who ' +
              'have been awake for a fortnight.' },
          { label: 'Re-create what has no copy anywhere', days: 0,
            note: 'The part with no end date and no line in the budget: re-keying from paper, ' +
              'asking customers to resend, and accepting that some of it is simply gone.' },
          { label: 'Verify, reconnect, watch closely', days: 2, note: 'As above.' },
          { label: 'The tail: notification, regulator, customers', days: 0,
            note: 'Unchanged by any of it.' }
        ]
      });
    }

    return lanes;
  }

  function laneTotals(lane, inp) {
    var days = 0, i;
    for (i = 0; i < lane.bands.length; i++) days += lane.bands[i].days;
    return { days: days, downtime: days * inp.daily, ransom: lane.ransom, total: days * inp.daily + lane.ransom };
  }

  var CORE = {
    CONTROLS: CONTROLS, ROUTES: ROUTES, STAGES: STAGES, POSTURES: POSTURES,
    TREE: TREE, KEY_LEVELS: KEY_LEVELS,
    runChain: runChain, chainOutcome: chainOutcome,
    buildFileFrames: buildFileFrames, fileStateAt: fileStateAt,
    buildLanes: buildLanes, laneTotals: laneTotals, fakeHex: fakeHex
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var MV = root.LabVizMulti;
  var E = MV.el, clear = MV.clear, group = MV.group, field = MV.field;
  var selectBox = MV.selectBox, numBox = MV.numBox;
  var CC = MV.C;

  /* The shell's C.faint (#64748b) is a fine border and dot colour and is not
     quite a text colour on the grounds this lab paints. The lightest ground
     here is a bare .oa-main over .lab, which composites to about rgb(23,34,55)
     in dark theme; C.faint measured 3.85:1 to 4.12:1 against it on the dwell
     line, the lane totals, the tally labels and the file tags, all of which are
     ordinary reading rather than decoration. #7c8ba1 is the same grey two
     shades lighter and clears 4.5:1 on every ground in this lab (4.58:1 at
     worst, and higher inside the panels, whose translucent fills darken the
     ground further). labs.css already made exactly this fix for
     .typing-passage .ty-todo; this is that fix applied to this lab's palette.
     C.faint stays where it is genuinely decorative: the stepped dots and the
     "never reached" chip border. */
  var DIM = '#7c8ba1';

  /* multi-shell has number, text and select helpers but no checkbox, and this
     lab is mostly checkboxes. Built here rather than added to the shared shell
     because no other lab on the chassis needs one yet. */
  function checkBox(labelText, checked, onChange) {
    var wrap = E('label', 'rw-check');
    var box = E('input');
    box.type = 'checkbox';
    box.checked = !!checked;
    box.addEventListener('change', function () { onChange(box.checked); });
    wrap.appendChild(box);
    wrap.appendChild(E('span', null, labelText));
    return wrap;
  }

  var EXTRA_CSS = [
    /* The shell sets .oa-td{white-space:nowrap} because the labs it was written
       for compare numbers. Two of the three tables here compare sentences, and
       nowrap turned the control matrix into a two-metre-wide strip that had to
       be scrolled sideways a paragraph at a time on a phone. Scoped by id so it
       overrides the shell rule without changing it for any other lab. */
    '#ransomviz .oa-comparewrap .oa-td{white-space:normal;line-height:1.6;min-width:7rem;}',
    '#ransomviz .oa-comparewrap .oa-table th{white-space:normal;}',
    '@media (max-width:600px){#ransomviz .oa-comparewrap .oa-td{min-width:5.5rem;}}',
    /* Same reasoning as DIM above, applied to the four labels the shell paints
       in C.faint. On this page those carry real content — the "illustrative,
       not a benchmark" caveat under the cost inputs is an .oa-hint, and it is
       the sentence that stops somebody quoting my placeholder numbers at a
       board. Scoped by id so no other lab on the chassis is touched. */
    '#ransomviz .oa-group-title,#ransomviz .oa-hint,' +
      '#ransomviz .oa-compare-title,#ransomviz .oa-table th{color:' + DIM + ';}',

    /* --- shared --- */
    '.rw-check{display:flex;align-items:flex-start;gap:8px;margin:0 0 9px;font-size:12px;line-height:1.5;color:' + CC.dim + ';cursor:pointer;}',
    '.rw-check input{margin-top:2px;flex:0 0 auto;accent-color:' + CC.blue + ';cursor:pointer;}',
    '.rw-check:hover{color:' + CC.ink + ';}',
    '.rw-check input:focus-visible{outline:2px solid ' + CC.blue + ';outline-offset:2px;}',
    '.rw-sim{margin:0 0 10px;padding:7px 10px;border-left:3px solid ' + CC.violet + ';background:rgba(167,139,250,.07);border-radius:0 8px 8px 0;font-size:11px;line-height:1.6;color:#d6cff5;}',

    /* --- family 1: the chain --- */
    '.rw-stages{list-style:none;margin:0 0 10px;padding:0;}',
    '.rw-stage{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid rgba(28,43,68,.7);}',
    '.rw-stage:last-child{border-bottom:0;}',
    '.rw-stage.future{opacity:.3;}',
    '.rw-stage.cut{opacity:.22;}',
    '.rw-dot{flex:0 0 auto;width:10px;height:10px;border-radius:50%;margin-top:5px;background:#243450;}',
    '.rw-dot.done{background:' + CC.faint + ';}',
    '.rw-dot.cur{background:' + CC.amber + ';box-shadow:0 0 0 3px rgba(251,191,36,.18);}',
    '.rw-dot.halt{background:' + CC.green + ';box-shadow:0 0 0 3px rgba(52,211,153,.2);}',
    '.rw-stage-body{min-width:0;flex:1 1 auto;}',
    '.rw-stage-name{margin:0;font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.rw-stage-meta{margin:2px 0 0;font-size:11px;color:' + DIM + ';}',
    '.rw-stage-flag{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700;}',
    '.rw-flag-halt{background:rgba(52,211,153,.14);color:' + CC.green + ';border:1px solid rgba(52,211,153,.45);}',
    '.rw-flag-cut{background:transparent;color:' + DIM + ';border:1px solid #243450;font-weight:400;}',
    '.rw-detail{padding:10px 12px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(15,23,42,.5);margin-bottom:10px;}',
    '.rw-detail h4{margin:0 0 4px;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:' + DIM + ';}',
    '.rw-detail p{margin:0 0 10px;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '.rw-detail p:last-child{margin-bottom:0;}',
    '.rw-effects{display:flex;flex-direction:column;gap:7px;margin-bottom:10px;}',
    '.rw-effect{padding:8px 10px;border-radius:9px;border-left:3px solid ' + CC.faint + ';background:rgba(2,6,23,.5);}',
    '.rw-effect.halt{border-left-color:' + CC.green + ';background:rgba(52,211,153,.07);}',
    '.rw-effect.blunt{border-left-color:' + CC.amber + ';background:rgba(251,191,36,.06);}',
    '.rw-effect.detect{border-left-color:' + CC.blue + ';background:rgba(56,189,248,.06);}',
    '.rw-effect.decide{border-left-color:' + CC.violet + ';background:rgba(167,139,250,.07);}',
    '.rw-effect.none{border-left-color:' + CC.red + ';background:rgba(252,165,165,.05);}',
    '.rw-effect-head{margin:0 0 3px;font-size:11px;font-weight:700;color:' + CC.ink + ';}',
    '.rw-effect-kind{font-weight:400;color:' + DIM + ';text-transform:uppercase;letter-spacing:.06em;font-size:10px;margin-left:6px;}',
    '.rw-effect-body{margin:0;font-size:11.5px;line-height:1.7;color:' + CC.dim + ';}',
    '.rw-outcome{padding:11px 13px;border-radius:10px;border:1px solid ' + CC.line + ';}',
    '.rw-outcome.good{border-color:rgba(52,211,153,.5);background:rgba(52,211,153,.07);}',
    '.rw-outcome.mixed{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.06);}',
    '.rw-outcome.bad{border-color:rgba(252,165,165,.45);background:rgba(252,165,165,.06);}',
    '.rw-outcome h4{margin:0 0 6px;font-size:13px;color:' + CC.ink + ';}',
    '.rw-outcome p{margin:0;font-size:12px;line-height:1.75;color:#cbd5e1;}',

    /* --- family 2: files and keys --- */
    '.rw-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:11px;margin-bottom:10px;}',
    '@media (max-width:820px){.rw-cols{grid-template-columns:minmax(0,1fr);}}',
    '.rw-tree{margin:0;padding:9px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(2,6,23,.55);list-style:none;overflow-x:auto;}',
    /* The row wraps rather than truncating. A filename with an ellipsis through
       the middle of it is the one thing on this panel nobody can afford to
       misread, so on a narrow screen the tag drops to a second line and the
       path stays whole. */
    '.rw-node{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 7px;padding:2px 0;font-size:11.5px;color:' + DIM + ';}',
    '.rw-node.seen{color:#cbd5e1;}',
    '.rw-node.locked{color:' + CC.red + ';}',
    '.rw-node.skipped{color:' + DIM + ';}',
    '.rw-node.refused{color:' + CC.green + ';}',
    '.rw-node.cur{background:rgba(251,191,36,.12);border-radius:5px;}',
    '.rw-node-name{white-space:nowrap;}',
    '.rw-node-dir{color:' + CC.cyan + ';}',
    '.rw-node-tag{font-size:10px;color:' + DIM + ';}',
    '.rw-keys{display:flex;flex-direction:column;gap:6px;}',
    '.rw-key{padding:8px 10px;border:1px solid ' + CC.line + ';border-radius:9px;background:rgba(15,23,42,.5);}',
    '.rw-key.on{border-color:' + CC.amber + ';background:rgba(251,191,36,.06);}',
    '.rw-key-name{margin:0;font-size:11.5px;font-weight:700;color:' + CC.ink + ';}',
    '.rw-key-where{margin:2px 0 0;font-size:11px;color:' + CC.cyan + ';}',
    '.rw-key-note{margin:4px 0 0;font-size:11px;line-height:1.65;color:' + CC.dim + ';}',
    '.rw-key-val{display:block;margin-top:5px;font-size:10.5px;letter-spacing:.04em;color:' + CC.violet + ';word-break:break-all;white-space:normal;}',
    '.rw-arrow{text-align:center;font-size:11px;color:' + DIM + ';line-height:1;}',
    '.rw-ending{padding:10px 12px;border-radius:10px;border-left:3px solid ' + CC.cyan + ';background:rgba(125,211,252,.06);}',
    '.rw-ending h4{margin:0 0 5px;font-size:12px;color:' + CC.ink + ';}',
    '.rw-ending p{margin:0 0 8px;font-size:11.5px;line-height:1.7;color:#cbd5e1;}',
    '.rw-ending p:last-child{margin-bottom:0;}',

    /* --- family 3: the bill --- */
    '.rw-lanes{display:flex;flex-direction:column;gap:11px;margin-bottom:10px;}',
    '.rw-lane{padding:9px 11px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(15,23,42,.5);}',
    '.rw-lane-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline;margin-bottom:7px;}',
    '.rw-lane-name{font-size:12px;font-weight:700;color:' + CC.ink + ';}',
    '.rw-lane-tot{font-size:11px;color:' + DIM + ';white-space:nowrap;}',
    '.rw-track{display:flex;height:16px;border-radius:6px;overflow:hidden;background:#0d1729;border:1px solid #1e2d47;}',
    '.rw-seg{flex:0 0 auto;min-width:2px;border-right:1px solid rgba(2,6,23,.7);}',
    '.rw-seg.future{opacity:.2;}',
    '.rw-seg-good{background:rgba(52,211,153,.55);}',
    '.rw-seg-bad{background:rgba(251,191,36,.55);}',
    '.rw-seg-worst{background:rgba(252,165,165,.55);}',
    '.rw-band{margin:6px 0 0;font-size:11px;line-height:1.65;color:' + CC.dim + ';}',
    '.rw-band b{color:' + CC.ink + ';font-weight:700;}',
    '.rw-band.idle{color:' + DIM + ';}',
    '.rw-tally{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:9px;padding:10px;border:1px solid ' + CC.line + ';border-radius:10px;background:rgba(2,6,23,.5);margin-bottom:10px;}',
    '.rw-tally div{min-width:0;}',
    '.rw-tally dt{margin:0;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:' + DIM + ';}',
    '.rw-tally dd{margin:3px 0 0;font-size:15px;font-weight:700;color:' + CC.ink + ';word-break:break-all;}',
    '.rw-tally dd small{display:block;font-size:10.5px;font-weight:400;color:' + DIM + ';margin-top:2px;}'
  ].join('');

  /* ======================================================================== */
  /*  FAMILY 1 — THE INTRUSION                                                */
  /* ======================================================================== */

  var KIND_WORD = {
    halt: 'stops it here', blunt: 'blunts it', detect: 'should alert',
    decide: 'changes the ending', none: 'does nothing here'
  };

  function ChainFamily() {
    this.key = 'chain';
    this.label = '1 · The intrusion';
    this.algoKey = 'phish';
    this.on = {};
    this.error = '';
  }
  ChainFamily.prototype.algoOptions = function () {
    return ROUTES.map(function (r) { return { key: r.key, label: r.label }; });
  };
  ChainFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('Controls you have in place');
    CONTROLS.forEach(function (c) {
      g.appendChild(checkBox(c.label, self.on[c.key], function (v) {
        self.on[c.key] = v;
        onChange();
      }));
    });
    g.appendChild(E('p', 'oa-hint',
      'Switch one on and step the chain. It halts at the stage that control genuinely bites — ' +
      'and some of them do not halt anything, which is the part worth sitting with.'));
    host.appendChild(g);

    var g2 = group('About the entry route');
    this.routeHint = E('p', 'oa-hint', '');
    g2.appendChild(this.routeHint);
    host.appendChild(g2);

    var g3 = group('What this is');
    g3.appendChild(E('p', 'rw-sim',
      'A simulation with no code in it. There is no sample, no payload and no technique described ' +
      'in a way anybody could act on. Every stage is named at the level a board paper names it.'));
    host.appendChild(g3);
  };
  ChainFamily.prototype.buildStage = function (host) {
    this.listHost = E('ol', 'rw-stages');
    host.appendChild(this.listHost);
    this.detailHost = E('div');
    host.appendChild(this.detailHost);
  };
  ChainFamily.prototype.compute = function () {
    this.res = runChain(this.algoKey, this.on);
    this.outcome = chainOutcome(this.res);
    if (this.routeHint) this.routeHint.textContent = this.res.route.hint;
    return this.res.stages.length + 1;
  };
  ChainFamily.prototype.render = function (idx) {
    var res = this.res, reached = res.stages.length;
    var onOutcome = idx >= reached;
    var cur = onOutcome ? reached - 1 : idx;

    clear(this.listHost);
    var i;
    for (i = 0; i < STAGES.length; i++) {
      var live = i < reached ? res.stages[i] : null;
      var cls = 'rw-stage';
      if (!live) cls += ' cut';
      else if (i > cur) cls += ' future';
      var li = E('li', cls);

      var dotCls = 'rw-dot';
      if (live && live.halted) dotCls += ' halt';
      else if (live && i === cur && !onOutcome) dotCls += ' cur';
      else if (live && i <= cur) dotCls += ' done';
      li.appendChild(E('span', dotCls));

      var body = E('div', 'rw-stage-body');
      var name = E('p', 'rw-stage-name');
      name.appendChild(document.createTextNode(String(i + 1) + '. ' + STAGES[i].name));
      if (live && live.halted) {
        name.appendChild(E('span', 'rw-stage-flag rw-flag-halt', 'stopped here'));
      } else if (!live) {
        name.appendChild(E('span', 'rw-stage-flag rw-flag-cut', 'never reached'));
      }
      body.appendChild(name);
      body.appendChild(E('p', 'rw-stage-meta', 'typical dwell: ' + STAGES[i].dwell));
      li.appendChild(body);
      this.listHost.appendChild(li);
    }

    clear(this.detailHost);
    if (onOutcome) {
      var box = E('div', 'rw-outcome ' + this.outcome.tone);
      box.appendChild(E('h4', null, this.outcome.head));
      box.appendChild(E('p', null, this.outcome.body));
      this.detailHost.appendChild(box);
      return;
    }

    var stage = res.stages[cur];
    var d = E('div', 'rw-detail');
    d.appendChild(E('h4', null, 'What the operator does'));
    d.appendChild(E('p', null, stage.what));
    d.appendChild(E('h4', null, 'What it looks like from your side'));
    d.appendChild(E('p', null, stage.seen));
    this.detailHost.appendChild(d);

    if (stage.effects.length) {
      var fx = E('div', 'rw-effects');
      stage.effects.forEach(function (e) {
        var name = '';
        CONTROLS.forEach(function (c) { if (c.key === e.c) name = c.short; });
        var row = E('div', 'rw-effect ' + e.kind);
        var head = E('p', 'rw-effect-head');
        head.appendChild(document.createTextNode(name));
        head.appendChild(E('span', 'rw-effect-kind', KIND_WORD[e.kind] || e.kind));
        row.appendChild(head);
        row.appendChild(E('p', 'rw-effect-body', e.text));
        fx.appendChild(row);
      });
      this.detailHost.appendChild(fx);
    } else {
      var empty = E('div', 'rw-effect none');
      empty.appendChild(E('p', 'rw-effect-head', 'No control on the list touches this stage'));
      empty.appendChild(E('p', 'rw-effect-body',
        'Switch some on in the panel and step through again. If none of them bite here even when ' +
        'they are all on, that is a real gap and it is worth knowing which stages have one.'));
      this.detailHost.appendChild(empty);
    }
  };
  ChainFamily.prototype.note = function (idx) {
    var res = this.res;
    if (idx >= res.stages.length) return this.outcome.head + ' ' + this.outcome.body;
    var s = res.stages[idx];
    if (s.halted) {
      return 'Stage ' + (idx + 1) + ' is as far as it gets with these controls switched on. ' +
        'Everything below is greyed out because it never happened — not because it was survived.';
    }
    return 'Stage ' + (idx + 1) + ' of ' + STAGES.length + ': ' + s.name.toLowerCase() +
      ', typically ' + s.dwell + '. Nothing switched on in the panel ends the chain here.';
  };
  /* The shared shell owns the row class — it highlights the row whose key
     matches the family's algoKey, and this family's algoKey is the entry route
     rather than a control. So which controls are switched on is said in the
     cell itself instead of being painted on the row. */
  ChainFamily.prototype.compare = function () {
    var rows = [
      { key: 'mfa', cells: ['MFA', 'Initial access, on any login',
        'A stolen or reused password on a remote entry point — the single most common first door',
        'A malicious attachment, and any flaw that runs before authentication happens at all'] },
      { key: 'patch', cells: ['Patching', 'Initial access, and escalation',
        'Exploitation of internet-facing kit, and a family of local privilege escalation routes',
        'Anything that is a misconfiguration rather than a vulnerability'] },
      { key: 'edr', cells: ['EDR', 'Execution first, then four more stages',
        'The loader, on execution — and it gets a second and third chance at discovery, evasion ' +
        'and mass encryption',
        'Anything at all, if nobody is rostered to read what it says'] },
      { key: 'least', cells: ['Least privilege', 'Escalation and lateral movement',
        'The assumption the whole lateral phase rests on: that one stolen credential opens every ' +
        'machine',
        'The intrusion itself. They still hold the first machine'] },
      { key: 'segment', cells: ['Segmentation', 'Discovery, lateral movement, exfiltration',
        'The blast radius. It turns a company-ending event into a bad week in one business unit',
        'The attack. This one caps damage and halts nothing, and it is worth being clear about that'] },
      { key: 'backup', cells: ['Offline backups', 'Evasion, and then the ending',
        'The deletion of your recovery, and the payment decision itself',
        'The intrusion, the exfiltration, or a single hour of the rebuild'] }
    ];
    var self = this;
    rows.forEach(function (r) {
      r.cells[0] = r.cells[0] + (self.on[r.key] ? ' — on' : ' — off');
    });
    return {
      title: 'Every control on the list, and what it honestly does',
      head: ['Control', 'Where it bites', 'What it actually stops', 'What it does not'],
      rows: rows
    };
  };

  /* ======================================================================== */
  /*  FAMILY 2 — FILES AND KEYS                                               */
  /* ======================================================================== */

  var KIND_TAG = {
    dir: '', file: '', backup: 'backup repository', vault: 'immutable, off the network',
    skip: 'skipped so the machine still boots'
  };

  function FileFamily() {
    this.key = 'files';
    this.label = '2 · Files and keys';
    this.algoKey = 'hybrid';
    this.immutable = false;
    this.error = '';
  }
  FileFamily.prototype.algoOptions = function () {
    return [
      { key: 'hybrid', label: 'How it is actually done — a key per file, wrapped' },
      { key: 'naive', label: 'The naive way — one key for everything' }
    ];
  };
  FileFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('The estate');
    g.appendChild(checkBox('An immutable off-network copy exists', this.immutable, function (v) {
      self.immutable = v;
      onChange();
    }));
    g.appendChild(E('p', 'oa-hint',
      'Turn it on and watch what happens when the encryptor reaches it. This is the one line item ' +
      'on the whole page that changes the ending rather than the story.'));
    host.appendChild(g);

    var g2 = group('What this is not');
    g2.appendChild(E('p', 'rw-sim',
      'There is no encryption anywhere in this page. No file of yours is read, no cipher runs, and ' +
      'the key strings below are labels generated from a counter so that stepping backwards shows ' +
      'the same value it showed going forwards. The tree is invented and lives in this tab.'));
    host.appendChild(g2);
  };
  FileFamily.prototype.buildStage = function (host) {
    var cols = E('div', 'rw-cols');
    this.treeHost = E('ul', 'rw-tree');
    cols.appendChild(this.treeHost);
    this.keyHost = E('div', 'rw-keys');
    cols.appendChild(this.keyHost);
    host.appendChild(cols);
    this.endHost = E('div');
    host.appendChild(this.endHost);
  };
  FileFamily.prototype.compute = function () {
    this.model = buildFileFrames(this.algoKey, this.immutable);
    return this.model.frames.length;
  };
  FileFamily.prototype.render = function (idx) {
    var m = this.model, view = fileStateAt(m, idx), i;

    clear(this.treeHost);
    for (i = 0; i < m.nodes.length; i++) {
      var n = m.nodes[i];
      var cls = 'rw-node ' + view.state[i];
      if (view.frame.node === i) cls += ' cur';
      var li = E('li', cls);
      li.style.paddingLeft = (n.d * 14) + 'px';
      li.appendChild(E('span', 'rw-node-name' + (n.kind === 'dir' ? ' rw-node-dir' : ''), n.name));
      var tag = '';
      if (view.state[i] === 'locked') tag = 'locked · ' + (n.size || '');
      else if (view.state[i] === 'refused') tag = 'delete refused by the storage';
      else if (view.state[i] === 'skipped') tag = KIND_TAG.skip;
      else if (KIND_TAG[n.kind]) tag = KIND_TAG[n.kind];
      else if (n.size) tag = n.size;
      // A whitespace text node between two flex items is ignored by the layout
      // and is the only thing separating the two spans for a screen reader,
      // which otherwise reads "Q1-forecast.xlsxlocked" as one word.
      if (tag) {
        li.appendChild(document.createTextNode(' '));
        li.appendChild(E('span', 'rw-node-tag', tag));
      }
      this.treeHost.appendChild(li);
    }

    clear(this.keyHost);
    var lockIdx = view.frame.phase === 'lock' ? view.frame.node : -1;
    var perFile = m.mode === 'naive'
      ? fakeHex(7, 32)
      : fakeHex(lockIdx >= 0 ? lockIdx + 11 : 11, 32);
    var wrapped = m.mode === 'naive'
      ? 'not wrapped — the same key is inside the binary'
      : fakeHex(lockIdx >= 0 ? lockIdx + 101 : 101, 48);

    for (i = 0; i < KEY_LEVELS.length; i++) {
      var lvl = KEY_LEVELS[i];
      var on = lockIdx >= 0 && (lvl.key === 'file' || lvl.key === 'blob');
      var card = E('div', 'rw-key' + (on ? ' on' : ''));
      card.appendChild(E('p', 'rw-key-name',
        m.mode === 'naive' && lvl.naiveName ? lvl.naiveName : lvl.name));
      card.appendChild(E('p', 'rw-key-where', lvl.where));
      card.appendChild(E('p', 'rw-key-note', lvl.note));
      if (m.mode === 'naive' && (lvl.key === 'file' || lvl.key === 'blob')) {
        card.appendChild(E('p', 'rw-key-note',
          lvl.key === 'file'
            ? 'In this mode there is no per-file key. One key is compiled into the binary and used ' +
              'on every file, which is fast to write and is why several families got broken.'
            : 'And nothing is wrapped, so a researcher who pulls the key out of a sample publishes ' +
              'a free decryptor and the whole scheme is over. The operators who are still working ' +
              'do not do this.'));
      }
      if (lockIdx >= 0 && lvl.key === 'file') card.appendChild(E('code', 'rw-key-val', perFile));
      if (lockIdx >= 0 && lvl.key === 'blob') card.appendChild(E('code', 'rw-key-val', wrapped));
      this.keyHost.appendChild(card);
      if (lvl.down) this.keyHost.appendChild(E('div', 'rw-arrow', '↓ ' + lvl.down + ' ↓'));
    }

    clear(this.endHost);
    if (view.frame.phase === 'note' || view.frame.phase === 'after') {
      var box = E('div', 'rw-ending');
      box.appendChild(E('h4', null, m.immutable
        ? 'The note is on every screen, and it is an outage rather than a decision'
        : 'The note is on every screen, and there is nothing to restore from'));
      if (m.mode === 'naive') {
        box.appendChild(E('p', null,
          'With one key for everything, the recovery story is different and much better for you: ' +
          'somebody eventually extracts the key from a sample and publishes a decryptor for free. ' +
          'It is also why this is not how it is done any more, and why "surely someone can crack ' +
          'it" is a hope rather than a plan.'));
      } else {
        box.appendChild(E('p', null,
          'Every file on that tree holds its own key, and every one of those keys is inside a lock ' +
          'that only a private key on somebody else’s machine opens. The keys are right there on ' +
          'your disk. That is the honest answer to "can we not just get it off the disk" — you ' +
          'already have it, and it is useless.'));
      }
      box.appendChild(E('p', null, m.immutable
        ? 'The immutable copy refused the delete, so there is a version of these files that never ' +
          'saw any of this. That does not undo the intrusion and it does not un-copy what was ' +
          'taken. It removes the payment decision, which is the single most expensive decision on ' +
          'the table.'
        : 'The backup repository was on the network and went first, three stages before this note ' +
          'appeared. That is not bad luck. Deleting the recovery is a deliberate, targeted step, ' +
          'because a restore is the only thing that makes the ransom optional.'));
      this.endHost.appendChild(box);
    }
  };
  FileFamily.prototype.note = function (idx) {
    var m = this.model, f = m.frames[Math.min(idx, m.frames.length - 1)];
    if (f.phase === 'intro') {
      return 'A fake tree in this page’s memory. Nothing on your machine is read, nothing is ' +
        'written and nothing is encrypted — step forward to watch it get enumerated.';
    }
    var n = f.node >= 0 ? m.nodes[f.node] : null;
    if (f.phase === 'walk') {
      if (n.kind === 'backup') {
        return 'The backup repository is found. On a real intrusion this is located during ' +
          'discovery, long before anything is encrypted, and it is the first thing deleted.';
      }
      if (n.kind === 'vault') {
        return 'The immutable copy is visible but the storage will not accept a delete against it, ' +
          'whatever privileges the account holds.';
      }
      if (n.kind === 'skip') {
        return 'Operating system files are skipped deliberately. The machine has to boot, because ' +
          'a machine that will not start cannot show you the note.';
      }
      return 'Walking the tree: ' + n.name + '. Enumeration at this volume is one of the loudest ' +
        'things in the whole incident and one of the most commonly ignored.';
    }
    if (f.phase === 'lock') {
      if (n.kind === 'vault') return 'The delete is refused. This is the whole argument for immutability in one line.';
      if (n.kind === 'backup') return 'The backup repository goes first, by design.';
      if (m.mode === 'naive') {
        return n.name + ': the same embedded key on every file. Fast to build, and the reason a ' +
          'free decryptor eventually appears for schemes that do this.';
      }
      return n.name + ': a fresh symmetric key, used once, wrapped with the operator’s public key ' +
        'and written next to the file. The plaintext key is discarded from memory immediately.';
    }
    if (f.phase === 'note') return 'The note appears. Everything on the tree that mattered is unreadable.';
    return 'The reading afterwards: what you would need to get one file back, and who has it.';
  };
  FileFamily.prototype.compare = function () {
    return {
      title: 'What it would take to get one of those files back',
      head: ['What you would need', 'Where it is', 'Can you get it'],
      rows: [
        { key: 'a', cells: ['The per-file symmetric key', 'Generated in memory on your own server and discarded seconds later', 'No — it existed for milliseconds and was never written down in the clear'] },
        { key: 'b', cells: ['The wrapped copy of that key', 'On your disk, right next to the file', 'Yes, trivially, and it does not help — it is locked'] },
        { key: 'c', cells: ['The operator’s public key', 'Inside the binary that ran on your servers', 'Yes, and it locks rather than opens'] },
        { key: 'd', cells: ['The operator’s private key', 'On their machine, and it never came near your network', 'Only by them handing it over, which is what the ransom is'] },
        { key: 'e', cells: ['A copy of the file from before', 'Your backup — if it was somewhere they could not delete', 'This is the only row on the table you control'] }
      ]
    };
  };

  /* ======================================================================== */
  /*  FAMILY 3 — THE BILL                                                     */
  /* ======================================================================== */

  /* Grouped integers with no currency symbol anywhere. The visitor is asked to
     put their own numbers in whatever they budget in, so inventing a currency
     here would only make the output wrong for most of the people reading it. */
  function formatNumber(n) {
    var v = Math.round(n);
    var s = String(Math.abs(v));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + s;
  }

  function CostFamily() {
    this.key = 'cost';
    this.label = '3 · The bill';
    this.algoKey = 'offline';
    this.inp = { daily: 40000, ransom: 900000, servers: 60, rate: 6, fail: 12 };
    this.error = '';
  }
  CostFamily.prototype.algoOptions = function () {
    return POSTURES.map(function (p) { return { key: p.key, label: p.label }; });
  };
  CostFamily.prototype.buildPanel = function (host, onChange) {
    var self = this;
    var g = group('Your numbers');
    g.appendChild(field('Cost of a day down', numBox(this.inp.daily, 0, 100000000, function (v) {
      self.inp.daily = v; onChange();
    })));
    g.appendChild(field('Ransom demanded', numBox(this.inp.ransom, 0, 1000000000, function (v) {
      self.inp.ransom = v; onChange();
    })));
    g.appendChild(field('Servers to bring back', numBox(this.inp.servers, 1, 500, function (v) {
      self.inp.servers = v; onChange();
    })));
    g.appendChild(field('Servers restored per day', numBox(this.inp.rate, 1, 50, function (v) {
      self.inp.rate = v; onChange();
    })));
    g.appendChild(field('Decryptor failure, %', numBox(this.inp.fail, 0, 90, function (v) {
      self.inp.fail = v; onChange();
    })));
    g.appendChild(E('p', 'oa-hint',
      'Currency-free: put it in whatever you budget in. The defaults are illustrative and are not ' +
      'a benchmark — published figures for all five of these disagree with each other by an order ' +
      'of magnitude depending on who was surveyed. The arithmetic is the point, not my numbers.'));
    host.appendChild(g);

    var g2 = group('The thing no box holds');
    g2.appendChild(E('p', 'rw-sim',
      'None of this counts your people. The largest real cost in most incidents is several hundred ' +
      'person-weeks that were going to be spent on something else, and nobody budgets it.'));
    host.appendChild(g2);
  };
  CostFamily.prototype.buildStage = function (host) {
    this.tallyHost = E('dl', 'rw-tally');
    host.appendChild(this.tallyHost);
    this.laneHost = E('div', 'rw-lanes');
    host.appendChild(this.laneHost);
  };
  CostFamily.prototype.compute = function () {
    this.lanes = buildLanes(this.inp, this.algoKey);
    var max = 0, i;
    for (i = 0; i < this.lanes.length; i++) {
      max = Math.max(max, this.lanes[i].bands.length);
    }
    return max + 1;
  };
  CostFamily.prototype.render = function (idx) {
    var self = this, inp = this.inp;
    var last = idx >= this.compareLen();

    /* Every lane is drawn against the same day scale, or the comparison the
       whole panel exists for would be a lie: three bars of equal width whose
       labels happen to say different numbers. */
    var maxDays = 1;
    this.lanes.forEach(function (l) { maxDays = Math.max(maxDays, laneTotals(l, inp).days); });

    clear(this.laneHost);
    this.lanes.forEach(function (lane) {
      var tot = laneTotals(lane, inp);
      var box = E('div', 'rw-lane');
      var head = E('div', 'rw-lane-head');
      head.appendChild(E('span', 'rw-lane-name', lane.label));
      head.appendChild(E('span', 'rw-lane-tot',
        tot.days + ' days · ' + formatNumber(tot.total) + ' total'));
      box.appendChild(head);

      var track = E('div', 'rw-track');
      var i;
      for (i = 0; i < lane.bands.length; i++) {
        var b = lane.bands[i];
        if (!b.days) continue;
        var seg = E('span', 'rw-seg rw-seg-' + lane.tone + (i > idx ? ' future' : ''));
        seg.style.width = Math.max(1, (b.days / maxDays) * 100) + '%';
        seg.title = b.label + ' — ' + b.days + ' day(s)';
        track.appendChild(seg);
      }
      box.appendChild(track);

      var band = lane.bands[idx];
      if (band) {
        var p = E('p', 'rw-band');
        p.appendChild(E('b', null, band.label + (band.days ? ' · ' + band.days + ' day(s)' : ' · ongoing')));
        p.appendChild(document.createTextNode(' ' + band.note));
        box.appendChild(p);
      } else {
        box.appendChild(E('p', 'rw-band idle',
          last ? 'Finished. The total above is days multiplied by your daily cost, plus the ransom ' +
                 'where one was paid.'
               : 'This path is already finished while the others are still running. That gap is the ' +
                 'return on the backup line item.'));
      }
      self.laneHost.appendChild(box);
    });

    clear(this.tallyHost);
    var cheapest = null;
    this.lanes.forEach(function (l) {
      var t = laneTotals(l, inp);
      if (!cheapest || t.total < cheapest.total) cheapest = { lane: l, total: t.total, days: t.days };
    });
    var pair = function (k, v, sub) {
      var wrap = E('div');
      wrap.appendChild(E('dt', null, k));
      var dd = E('dd', null, v);
      if (sub) dd.appendChild(E('small', null, sub));
      wrap.appendChild(dd);
      self.tallyHost.appendChild(wrap);
    };
    pair('Step', String(Math.min(idx + 1, this.compareLen() + 1)),
      last ? 'the totals' : 'of the recovery');
    pair('Cheapest path here', cheapest ? cheapest.lane.label : '—',
      cheapest ? formatNumber(cheapest.total) + ' over ' + cheapest.days + ' days' : '');
    pair('A day down costs', formatNumber(inp.daily), 'your figure, from the panel');
    pair('Ransom on the table', formatNumber(inp.ransom), 'buys a tool, not a restore');
  };
  CostFamily.prototype.compareLen = function () {
    var max = 0, i;
    for (i = 0; i < this.lanes.length; i++) max = Math.max(max, this.lanes[i].bands.length);
    return max;
  };
  CostFamily.prototype.note = function (idx) {
    var lane = this.lanes[0];
    var band = lane.bands[idx];
    if (!band) {
      return 'Every path has finished. Compare the totals above, and note that the only line item ' +
        'separating them is one you have to buy long before any of this starts.';
    }
    return 'Step ' + (idx + 1) + ': ' + band.label.toLowerCase() +
      (band.days ? ', ' + band.days + ' day(s) on the top path' : ', ongoing') +
      '. The first two steps are identical whichever way you go, which is why the decision about ' +
      'paying gets made much later than people imagine.';
  };
  CostFamily.prototype.compare = function () {
    var inp = this.inp;
    var rows = this.lanes.map(function (l) {
      var t = laneTotals(l, inp);
      return {
        key: l.key,
        cells: [
          l.label,
          String(t.days) + ' days',
          formatNumber(t.downtime),
          l.ransom ? formatNumber(l.ransom) : '—',
          formatNumber(t.total)
        ]
      };
    });
    rows.push({
      key: 'gone',
      cells: ['What none of these paths return', '—', '—', '—',
        'The copy of your data they took before any of it started']
    });
    return {
      title: 'The same incident, three ways out',
      head: ['Path', 'Days', 'Downtime cost', 'Ransom', 'Total'],
      rows: rows
    };
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  MV.boot({
    rootId: 'ransomviz',
    mountId: 'viz-ransomware-mount',
    name: 'The ransomware anatomy explainer',
    css: EXTRA_CSS,
    families: function () {
      return [new ChainFamily(), new FileFamily(), new CostFamily()];
    }
  });
})(typeof self !== 'undefined' ? self : this);

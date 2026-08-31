/* ==========================================================================
   firewall-defence.js — tower defence where the towers are firewall rules
   and the creeps are packets.
   --------------------------------------------------------------------------
   The genre fits the subject almost exactly, which is why this exists. A
   packet enters on the left, walks past every rule you have placed, and the
   FIRST rule that matches it decides what happens — accept, drop or reject.
   That is a firewall chain. It is also a lane of towers. The only thing the
   genre normally gets wrong is that in tower defence everything walking down
   the lane deserves to die, and on a real network most of it is your own
   business trying to work.

   So the score is ATTACKS BLOCKED MINUS LEGITIMATE TRAFFIC DROPPED, and that
   single line is the whole design. Ten points for stopping something that
   was an attack, twelve off for stopping something that was a customer. Over
   the six waves there are sixty malicious packets and seventy-two legitimate
   ones, so a wall that stops everything finishes on roughly minus two
   hundred and sixty and a firewall that stops nothing is compromised before
   wave three. Neither of the two obvious policies works, and finding that
   out by playing it is worth more than being told.

   FIVE DECISIONS WORTH RECORDING.

   1. RULES ARE A LIST, NOT A GRID OF TOWER PLOTS. Position is the mechanic.
      A rule at slot 2 is consulted before the rule at slot 3, exactly as in
      iptables or a security group evaluated in order, so moving a rule left
      is a real move with a real consequence. Dragging a chip along the chain
      is therefore the primary gesture rather than a convenience.

   2. SHADOWING IS COMPUTED OVER THE HEADER SPACE, NOT OVER THE TRAFFIC. A
      rule is marked dead when every packet it could ever match is already
      matched by something above it. That is decided by enumerating the
      finite universe of headers this game can produce — three protocols,
      ten ports plus "no port", seven source addresses, two connection
      states, minus the impossible combinations — and asking whether any of
      them reach the rule. 294 combinations, recomputed on every edit, which
      is nothing. Deciding it from the traffic actually seen instead would
      have marked a perfectly good rule dead during a quiet wave and then
      un-marked it later, which is worse than not marking it at all.

   3. A PACKET NEVER SHOWS WHETHER IT IS HOSTILE. It shows its protocol, its
      source address, its destination port and whether it belongs to an
      established flow, and nothing else, because those four fields are all a
      packet filter gets. Which of them is an attack is in the wave briefing,
      the way it is in a ticket from whoever noticed. The reveal comes after
      the verdict: the chip fades green or red and the log names it. Colour
      is never the only signal — the fading chip carries the word BLOCKED,
      LOST, BREACH or OK, and the log line spells the whole thing out.

   4. THE WAVE DOES NOT START UNTIL YOU START IT. There is no planning
      countdown. A timer on the thinking would turn a game about reading a
      rule set into a game about clicking quickly, and everything this has to
      teach is in the reading. The wave itself has no pause in it, which is
      where the pressure belongs.

   5. SOUND IS ONE-SHOTS, NOT A BED. The shell offers both and the choice is
      not automatic: a bed is for a condition and a one-shot is for an event.
      Every single thing that happens here is an event — a rule fires, a
      packet dies, one gets through — so a held layer would have nothing to
      hold. All of them are gated, because a flood wave resolves ten packets
      in five seconds and ten separate clicks in five seconds is a rattle.

   WHERE THE MODEL IS SIMPLER THAN THE REAL THING, out loud: every rule here
   matches on ONE field. Real firewall rules match on a tuple — source, and
   destination, and port, and protocol, all at once — so a real chain says
   what this one needs two rules and an ordering to say. There is no NAT, no
   rate limiting, no connection tracking beyond a flag the packet arrives
   carrying, no logging target, no fragmentation and no IPv6. It is a chain
   of single-condition rules with a default policy at the end, which is the
   part people get wrong, and it is deliberately the only part modelled.

   Addresses are all from ranges reserved for documentation and testing —
   192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24 from RFC 5737, the
   benchmarking block 198.18.0.0/15, and RFC 1918 space for the office — so
   nothing here names a machine that belongs to anybody.

   ES5, as everything under assets/js is.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  var W = 720;
  var H = 480;

  /* Seven rule slots. Six is enough for a default-deny chain that survives
     every wave; seven leaves room for the default-accept route, which needs
     one more. More than that and the chain stops being readable at a glance,
     which is the thing the whole layout is for. */
  var SLOTS = 7;

  /* Gate centres along the wire, and the rule boxes sit under them at the
     same x so a chip and its gate are visibly one object. */
  var GATEX = [106, 194, 282, 370, 458, 546, 634];
  var POLICYX = 690;

  var LANE_TOP = 68;
  var LANE_BOT = 146;
  var ROWY = [91, 119];         // two rows, so a flood has somewhere to go
  var CHIP_W = 84;
  var CHIP_H = 26;

  var BOX_Y = 150;
  var BOX_H = 88;
  var BOX_W = 84;

  var SPEED = 120;              // logical units a second
  var SPAWN_X = -60;
  var DELIVER_X = 706;

  var START_INTEGRITY = 20;
  var BLOCK_POINTS = 10;
  var LOSS_POINTS = 12;

  var COL_BG = '#020617';
  var COL_LANE = '#0b1220';
  var COL_EDGE = '#1e293b';
  var COL_DIM = '#64748b';
  var COL_MID = '#94a3b8';
  var COL_TEXT = '#e2e8f0';
  var COL_OK = '#4ade80';
  var COL_BAD = '#f87171';
  var COL_WARN = '#fbbf24';
  var COL_SEL = '#38bdf8';

  var ACTION_COL = { ACCEPT: COL_OK, DROP: COL_BAD, REJECT: COL_WARN };
  var PROTO_COL = { TCP: '#38bdf8', UDP: '#a78bfa', ICMP: '#f472b6' };

  /* ------------------------------------------------------------------
     Addresses. Integer arithmetic rather than bitwise, because a /0 or a
     /1 mask built with a shift comes out negative in JavaScript and the
     comparison then quietly inverts. Subnet sprint hit that one first.
     ------------------------------------------------------------------ */
  function ipInt(ip) {
    var parts = String(ip).split('.');
    if (parts.length !== 4) return -1;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      var o = Number(parts[i]);
      if (!(o >= 0 && o <= 255)) return -1;
      n = (n * 256) + o;
    }
    return n;
  }

  var NET_CACHE = {};
  function netOf(cidr) {
    if (NET_CACHE[cidr]) return NET_CACHE[cidr];
    var bits = 0;
    var base = cidr;
    var slash = cidr.indexOf('/');
    if (slash >= 0) {
      base = cidr.slice(0, slash);
      bits = Number(cidr.slice(slash + 1));
    }
    if (!(bits >= 0 && bits <= 32)) bits = 32;
    var lo = ipInt(base);
    var span = Math.pow(2, 32 - bits);
    var net = { lo: lo, hi: lo < 0 ? -1 : lo + span - 1 };
    NET_CACHE[cidr] = net;
    return net;
  }

  function inNet(ip, cidr) {
    var net = netOf(cidr);
    if (net.lo < 0) return false;
    var a = ipInt(ip);
    if (a < 0) return false;
    return a >= net.lo && a <= net.hi;
  }

  /* ------------------------------------------------------------------
     What a rule can match on. One field each — see the note in the header
     about how much simpler that is than the real thing.
     ------------------------------------------------------------------ */
  var MATCHES = [
    {
      key: 'port', label: 'Destination port', shortLabel: 'dst port',
      values: [
        { v: '22', label: '22 (SSH)' },
        { v: '25', label: '25 (SMTP)' },
        { v: '53', label: '53 (DNS)' },
        { v: '80', label: '80 (HTTP)' },
        { v: '123', label: '123 (NTP)' },
        { v: '443', label: '443 (HTTPS)' },
        { v: '3306', label: '3306 (MySQL)' },
        { v: '3389', label: '3389 (RDP)' },
        { v: '8080', label: '8080 (alt HTTP)' },
        { v: 'high', label: '1024 and above' }
      ]
    },
    {
      key: 'src', label: 'Source network', shortLabel: 'source',
      values: [
        { v: '0.0.0.0/0', label: '0.0.0.0/0 (anywhere)' },
        { v: '10.20.30.0/24', label: '10.20.30.0/24 (the office)' },
        { v: '192.0.2.0/24', label: '192.0.2.0/24 (customers)' },
        { v: '198.51.100.0/24', label: '198.51.100.0/24 (partner)' },
        { v: '203.0.113.0/24', label: '203.0.113.0/24 (the scanner)' },
        { v: '198.18.7.0/24', label: '198.18.7.0/24 (one botnet /24)' },
        { v: '198.18.0.0/15', label: '198.18.0.0/15 (the whole range)' }
      ]
    },
    {
      key: 'proto', label: 'Protocol', shortLabel: 'protocol',
      values: [
        { v: 'TCP', label: 'TCP' },
        { v: 'UDP', label: 'UDP' },
        { v: 'ICMP', label: 'ICMP' }
      ]
    },
    {
      key: 'state', label: 'Connection state', shortLabel: 'state',
      values: [
        { v: 'NEW', label: 'NEW (an inbound connection)' },
        { v: 'EST', label: 'ESTABLISHED (a reply to us)' }
      ]
    }
  ];

  function matchDef(key) {
    for (var i = 0; i < MATCHES.length; i++) {
      if (MATCHES[i].key === key) return MATCHES[i];
    }
    return MATCHES[0];
  }

  function valueLabel(rule) {
    if (rule.m === 'port') return rule.v === 'high' ? '1024+' : rule.v;
    if (rule.m === 'state') return rule.v === 'EST' ? 'ESTABLISHED' : 'NEW';
    return rule.v;
  }

  function ruleWords(rule) {
    return matchDef(rule.m).shortLabel + ' ' + valueLabel(rule) + ', ' + rule.a;
  }

  /* Does this rule match a packet with these four fields? Port 0 means the
     packet has no port at all, which is what ICMP is, and a port rule must
     never match one — that detail is the reason an ICMP flood walks through
     a chain built entirely out of port rules. */
  function ruleHits(rule, proto, port, src, state) {
    if (rule.m === 'port') {
      if (!(port > 0)) return false;
      if (rule.v === 'high') return port >= 1024;
      return port === Number(rule.v);
    }
    if (rule.m === 'src') return inNet(src, rule.v);
    if (rule.m === 'proto') return rule.v === proto;
    if (rule.m === 'state') return rule.v === state;
    return false;
  }

  /* ------------------------------------------------------------------
     The header universe used for shadow detection. See decision 2.
     ------------------------------------------------------------------ */
  var U_PORT = [22, 25, 53, 80, 123, 443, 3306, 3389, 8080, 49700];
  var U_SRC = ['203.0.113.9', '198.51.100.9', '192.0.2.9', '10.20.30.9',
               '198.18.7.9', '198.19.200.9', '172.16.9.9'];
  var U_STATE = ['NEW', 'EST'];

  var COMBOS = (function () {
    var out = [];
    var protos = ['TCP', 'UDP', 'ICMP'];
    for (var p = 0; p < protos.length; p++) {
      /* ICMP carries no port and everything else always carries one, so the
         impossible pairs are left out rather than being fed in and quietly
         keeping a dead rule looking alive. */
      var ports = protos[p] === 'ICMP' ? [0] : U_PORT;
      for (var t = 0; t < ports.length; t++) {
        for (var s = 0; s < U_SRC.length; s++) {
          for (var c = 0; c < U_STATE.length; c++) {
            out.push({ proto: protos[p], port: ports[t], src: U_SRC[s], state: U_STATE[c] });
          }
        }
      }
    }
    return out;
  })();

  /* ------------------------------------------------------------------
     Traffic. Every block is reserved space — see the header.
     ------------------------------------------------------------------ */
  function host() { return 1 + Math.floor(Math.random() * 250); }

  function addrOf(block) {
    if (block === 'PART') return '198.51.100.' + host();
    if (block === 'SCAN') return '203.0.113.' + host();
    if (block === 'OFF') return '10.20.30.' + host();
    if (block === 'BOT') return '198.18.' + Math.floor(Math.random() * 8) + '.' + host();
    if (block === 'BOT2') return '198.19.' + Math.floor(Math.random() * 8) + '.' + host();
    return '192.0.2.' + host();
  }

  function portOf(spec) {
    if (spec === 'eph') return 49152 + Math.floor(Math.random() * 12000);
    return spec;
  }

  /* Six waves. Each one forces a different question, and every one is
     solvable inside seven slots — the info copy on the page walks through a
     chain that clears all six. */
  var WAVES = [
    {
      name: 'The sweep',
      brief: 'A scanner is walking SSH and RDP from 203.0.113.0/24. The shop itself only serves 80 and 443, ' +
        'and nothing outside needs to reach anything else.',
      gap: 0.9,
      mix: [
        { n: 6, evil: false, proto: 'TCP', port: 443, blk: 'PUB', st: 'NEW' },
        { n: 4, evil: false, proto: 'TCP', port: 80, blk: 'PUB', st: 'NEW' },
        { n: 4, evil: true, proto: 'TCP', port: 22, blk: 'SCAN', st: 'NEW' },
        { n: 4, evil: true, proto: 'TCP', port: 3389, blk: 'SCAN', st: 'NEW' }
      ],
      after: 'Two port rules, or one rule on the source, and the sweep is over. Both work here because the ' +
        'attack and the business are on different ports. That is the last wave where that is true.'
    },
    {
      name: 'The relay',
      brief: 'The payments partner on 198.51.100.0/24 sends mail to port 25 and it must arrive. Everyone else ' +
        'knocking on 25 is trying to relay spam through you.',
      gap: 0.85,
      mix: [
        { n: 4, evil: false, proto: 'TCP', port: 443, blk: 'PUB', st: 'NEW' },
        { n: 3, evil: false, proto: 'TCP', port: 80, blk: 'PUB', st: 'NEW' },
        { n: 3, evil: false, proto: 'TCP', port: 25, blk: 'PART', st: 'NEW' },
        { n: 5, evil: true, proto: 'TCP', port: 25, blk: 'BOT', st: 'NEW' },
        { n: 3, evil: true, proto: 'UDP', port: 53, blk: 'SCAN', st: 'NEW' }
      ],
      after: 'One port, two verdicts, and the only thing separating them is who sent it. Accept the partner ' +
        'above the drop and both are right; put the drop first and the mail dies with the spam.'
    },
    {
      name: 'Same port',
      brief: 'The flood is on 443 now, which is the port your customers use. A port rule cannot tell these ' +
        'apart. Look at where they come from instead.',
      gap: 0.7,
      mix: [
        { n: 8, evil: false, proto: 'TCP', port: 443, blk: 'PUB', st: 'NEW' },
        { n: 4, evil: false, proto: 'TCP', port: 80, blk: 'PUB', st: 'NEW' },
        { n: 10, evil: true, proto: 'TCP', port: 443, blk: 'SCAN', st: 'NEW' }
      ],
      after: 'A source rule works, and only if it sits above whatever accepts 443. A rule below the accept ' +
        'never sees the packet, because the first match already decided.'
    },
    {
      name: 'Coming back',
      brief: 'Replies to connections this server opened are arriving on high ports, and the attacker is ' +
        'knocking on high ports too. Only the connection state separates them.',
      gap: 0.7,
      mix: [
        { n: 3, evil: false, proto: 'TCP', port: 'eph', blk: 'PART', st: 'EST' },
        { n: 3, evil: false, proto: 'TCP', port: 'eph', blk: 'PUB', st: 'EST' },
        { n: 3, evil: false, proto: 'TCP', port: 443, blk: 'PUB', st: 'NEW' },
        { n: 3, evil: false, proto: 'UDP', port: 53, blk: 'PART', st: 'EST' },
        { n: 6, evil: true, proto: 'TCP', port: 'eph', blk: 'BOT', st: 'NEW' },
        { n: 4, evil: true, proto: 'TCP', port: 3306, blk: 'BOT', st: 'NEW' }
      ],
      after: 'Accept ESTABLISHED at the top, accept the ports you actually publish, and refuse everything ' +
        'else. That is the shape of nearly every real inbound chain, and it fits in four rules.'
    },
    {
      name: 'Everywhere at once',
      brief: 'The same flood, now spread across 198.18.0.0/15. One /24 out of that range is a two hundred ' +
        'and fifty-sixth of it. The office still needs SSH from 10.20.30.0/24.',
      gap: 0.55,
      mix: [
        { n: 5, evil: false, proto: 'TCP', port: 443, blk: 'PUB', st: 'NEW' },
        { n: 3, evil: false, proto: 'TCP', port: 80, blk: 'PUB', st: 'NEW' },
        { n: 2, evil: false, proto: 'TCP', port: 'eph', blk: 'PART', st: 'EST' },
        { n: 2, evil: false, proto: 'TCP', port: 22, blk: 'OFF', st: 'NEW' },
        { n: 7, evil: true, proto: 'TCP', port: 443, blk: 'BOT', st: 'NEW' },
        { n: 5, evil: true, proto: 'TCP', port: 443, blk: 'BOT2', st: 'NEW' }
      ],
      after: 'Blocking one /24 stops the eighth of the flood that happened to be in it. The prefix has to be ' +
        'short enough to cover the whole range, and short enough is a decision with a blast radius.'
    },
    {
      name: 'The sale',
      brief: 'Marketing sent the email, so the 443 burst is customers. The attack underneath it is an ICMP ' +
        'flood and NTP on 123, from the same addresses. Do not close the shop.',
      gap: 0.5,
      mix: [
        { n: 11, evil: false, proto: 'TCP', port: 443, blk: 'PUB', st: 'NEW' },
        { n: 3, evil: false, proto: 'TCP', port: 80, blk: 'PUB', st: 'NEW' },
        { n: 2, evil: false, proto: 'TCP', port: 'eph', blk: 'PART', st: 'EST' },
        { n: 6, evil: true, proto: 'ICMP', port: 0, blk: 'PUB', st: 'NEW' },
        { n: 6, evil: true, proto: 'UDP', port: 123, blk: 'PUB', st: 'NEW' }
      ],
      after: 'The attack and the customers share a source block, so the only thing left to match on is the ' +
        'protocol and the port. A chain that already refuses what it does not publish never noticed this wave.'
    }
  ];

  function fmt(n) {
    return (n > 0 ? '+' : '') + n;
  }

  GameShell.define({
    id: 'game-firewall-defence',
    slug: 'firewall-defence',
    title: 'Firewall defence',
    width: W,
    height: H,
    bestKey: 'firewall-defence',
    /* A tap on the playfield places and drags rules, so it must not also be
       read as the Action button — see bindStageTap in the shell. */
    tapAction: false,
    startTitle: 'Firewall defence',
    startText: 'Seven rule slots, six waves. The score is attacks blocked minus legitimate traffic dropped, ' +
      'so a wall that stops everything loses. Nothing is uploaded; your best stays on this device.',

    setup: function (g) {
      /* Asked once. Slowing the packets keeps every rule firing legible for
         anyone who has told their machine they do not want movement; it does
         not remove anything, because the packets walking the chain are the
         explanation. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var rules = [];
      var policy = 'ACCEPT';
      var sel = 0;

      var wave = 0;
      var phase = 'plan';           // plan | wave | done
      var queue = [];               // packets still to spawn this wave
      var spawnT = 0;
      var packets = [];

      var score = 0;
      var blocked = 0;
      var lost = 0;
      var delivered = 0;
      var breaches = 0;
      var integrity = START_INTEGRITY;
      var waveTotal = 0;
      var waveDone = 0;

      var log = [];
      var LOG_MAX = 12;
      var lastAfter = '';
      var spawned = 0;

      var dragIdx = -1;
      var dragX = 0;
      var dragMoved = 0;

      /* ---------------------------------------------------------------
         The toolbar.
         --------------------------------------------------------------- */
      var matchSel = document.getElementById('game-match');
      var valueSel = document.getElementById('game-value');
      var actionSel = document.getElementById('game-action');
      var policySel = document.getElementById('game-policy');
      var addBtn = document.getElementById('game-add');
      var delBtn = document.getElementById('game-del');
      var waveBtn = document.getElementById('game-wave');

      function syncValues() {
        if (!valueSel) return;
        var def = matchDef(matchSel ? matchSel.value : 'port');
        while (valueSel.firstChild) valueSel.removeChild(valueSel.firstChild);
        for (var i = 0; i < def.values.length; i++) {
          var opt = document.createElement('option');
          opt.value = def.values[i].v;
          opt.textContent = def.values[i].label;
          valueSel.appendChild(opt);
        }
        valueSel.selectedIndex = 0;
      }

      function builtRule() {
        var m = matchSel ? matchSel.value : 'port';
        var def = matchDef(m);
        var v = valueSel && valueSel.value ? valueSel.value : def.values[0].v;
        var a = actionSel ? actionSel.value : 'DROP';
        return { m: def.key, v: v, a: a, dead: false, why: '' };
      }

      function syncWaveBtn() {
        if (!waveBtn) return;
        waveBtn.disabled = phase !== 'plan';
        waveBtn.textContent = phase === 'plan'
          ? (wave === 0 ? 'Start wave 1' : 'Start wave ' + (wave + 1))
          : 'Wave running';
      }

      /* ---------------------------------------------------------------
         Shadow detection. See decision 2 in the header.
         --------------------------------------------------------------- */
      function recompute() {
        var i, j, k;
        for (i = 0; i < rules.length; i++) { rules[i].dead = false; rules[i].why = ''; }

        for (i = 1; i < rules.length; i++) {
          var reachable = false;
          var matched = false;
          var by = [];
          for (k = 0; k < COMBOS.length; k++) {
            var c = COMBOS[k];
            if (!ruleHits(rules[i], c.proto, c.port, c.src, c.state)) continue;
            matched = true;
            var found = -1;
            for (j = 0; j < i; j++) {
              if (ruleHits(rules[j], c.proto, c.port, c.src, c.state)) { found = j; break; }
            }
            if (found < 0) { reachable = true; break; }
            if (by.indexOf(found) < 0) by.push(found);
          }
          if (!matched || reachable) continue;

          by.sort(function (a, b) { return a - b; });
          var names = [];
          for (j = 0; j < by.length && j < 3; j++) names.push(String(by[j] + 1));
          var listed = names.join(' and ');
          if (by.length > 3) listed += ' and others';
          rules[i].dead = true;
          rules[i].why = 'Dead rule: everything it could match is already decided by rule ' + listed + '.';
        }
      }

      function deadCount() {
        var n = 0;
        for (var i = 0; i < rules.length; i++) if (rules[i].dead) n++;
        return n;
      }

      /* ---------------------------------------------------------------
         Editing the chain.
         --------------------------------------------------------------- */
      /* THE TOOLBAR EXISTS BEFORE THE RUN DOES. Every control here is real
         markup, present and clickable while the Play overlay is still up,
         and the shell calls reset() when Play is pressed — so a chain built
         before the run was silently thrown away by the act of starting it.
         Refusing the edit and saying why is the honest version. */
      function live() {
        if (g.state === 'playing') return true;
        g.announce('Press Play to begin the run, then build the chain.');
        return false;
      }

      function announceRule(prefix, i) {
        var r = rules[i];
        if (!r) return;
        var msg = prefix + ' Slot ' + (i + 1) + ': ' + ruleWords(r) + '.';
        if (r.dead) msg += ' ' + r.why;
        g.announce(msg);
      }

      function addRule() {
        if (rules.length >= SLOTS) {
          g.announce('The chain is full at ' + SLOTS + ' rules. Remove one before adding another.');
          g.beep(180, 0.08, 'square', 0.05);
          return;
        }
        rules.push(builtRule());
        sel = rules.length - 1;
        recompute();
        g.pluck(520, 0.22, 0.05);
        announceRule('Rule added.', sel);
      }

      function removeRule() {
        if (!rules.length) { g.announce('There is nothing in the chain to remove.'); return; }
        var gone = rules[sel];
        rules.splice(sel, 1);
        if (sel >= rules.length) sel = Math.max(0, rules.length - 1);
        recompute();
        g.beep(260, 0.07, 'sine', 0.05);
        g.announce('Removed ' + ruleWords(gone) + '. ' + rules.length + ' rules left in the chain.');
      }

      function moveRule(from, to) {
        if (from < 0 || from >= rules.length) return;
        if (to < 0 || to >= rules.length || to === from) return;
        var r = rules.splice(from, 1)[0];
        rules.splice(to, 0, r);
        sel = to;
        recompute();
        g.beep(440, 0.05, 'triangle', 0.04);
        announceRule('Moved.', to);
      }

      function setPolicy(value) {
        policy = value === 'DROP' ? 'DROP' : 'ACCEPT';
        if (policySel) policySel.value = policy;
        g.announce(policy === 'DROP'
          ? 'Default policy is now DROP. Anything no rule accepted dies at the end of the chain, ' +
            'including traffic you meant to keep.'
          : 'Default policy is now ACCEPT. Anything no rule matched reaches the server.');
      }

      if (matchSel) {
        matchSel.addEventListener('change', function () { syncValues(); });
      }
      if (addBtn) addBtn.addEventListener('click', function () { if (live()) addRule(); });
      if (delBtn) delBtn.addEventListener('click', function () { if (live()) removeRule(); });
      if (policySel) {
        policySel.addEventListener('change', function () {
          if (g.state !== 'playing') { policySel.value = policy; live(); return; }
          setPolicy(policySel.value);
        });
      }
      if (waveBtn) {
        waveBtn.addEventListener('click', function () { if (live()) startWave(); });
      }
      syncValues();

      /* ---------------------------------------------------------------
         Pointer: tap a slot to place, tap a rule to select, drag to move.
         --------------------------------------------------------------- */
      function slotAt(p) {
        if (p.y < BOX_Y || p.y > BOX_Y + BOX_H) return -1;
        for (var i = 0; i < SLOTS; i++) {
          if (p.x >= GATEX[i] - BOX_W / 2 && p.x <= GATEX[i] + BOX_W / 2) return i;
        }
        return -1;
      }

      function nearestSlot(x) {
        var best = 0;
        var dist = 1e9;
        for (var i = 0; i < SLOTS; i++) {
          var d = Math.abs(x - GATEX[i]);
          if (d < dist) { dist = d; best = i; }
        }
        return best;
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing') return;    // the overlay owns the board
          var p = g.pointAt(event);

          /* The policy badge is a control as much as the dropdown is, and it
             sits where the decision actually happens — at the end of the
             chain, in front of the server. */
          if (p.x > POLICYX - 18 && p.y >= LANE_TOP && p.y <= BOX_Y + BOX_H) {
            setPolicy(policy === 'DROP' ? 'ACCEPT' : 'DROP');
            return;
          }

          var i = slotAt(p);
          if (i < 0) return;
          if (i < rules.length) {
            sel = i;
            dragIdx = i;
            dragX = p.x;
            dragMoved = 0;
            announceRule('Selected.', i);
          } else {
            addRule();
          }
        });

        g.canvas.addEventListener('pointermove', function (event) {
          if (dragIdx < 0) return;
          var p = g.pointAt(event);
          dragMoved += Math.abs(p.x - dragX);
          dragX = p.x;
        });

        var endDrag = function (event) {
          if (dragIdx < 0) return;
          var from = dragIdx;
          dragIdx = -1;
          if (dragMoved < 10) return;                 // a tap, not a drag
          var p = g.pointAt(event);
          var to = Math.min(nearestSlot(p.x), rules.length - 1);
          moveRule(from, to);
        };
        g.canvas.addEventListener('pointerup', endDrag);
        g.canvas.addEventListener('pointercancel', function () { dragIdx = -1; });
        g.canvas.addEventListener('pointerleave', function () { dragIdx = -1; });
      }

      /* ---------------------------------------------------------------
         Waves.
         --------------------------------------------------------------- */
      function buildQueue(def) {
        var out = [];
        for (var i = 0; i < def.mix.length; i++) {
          var m = def.mix[i];
          for (var n = 0; n < m.n; n++) {
            out.push({
              proto: m.proto,
              port: portOf(m.port),
              src: addrOf(m.blk),
              state: m.st,
              evil: m.evil
            });
          }
        }
        g.shuffle(out);
        return out;
      }

      function startWave() {
        if (phase !== 'plan' || wave >= WAVES.length) return;
        var def = WAVES[wave];
        queue = buildQueue(def);
        waveTotal = queue.length;
        waveDone = 0;
        spawnT = 0;
        phase = 'wave';
        syncWaveBtn();
        g.sweep(300, 620, 0.3);
        g.announce('Wave ' + (wave + 1) + ' of ' + WAVES.length + ', ' + def.name + '. ' + def.brief +
          ' ' + waveTotal + ' packets. Your chain has ' + rules.length + ' rules and the default policy is ' +
          policy + '.');
        g.takeFocus();
      }

      function endWave() {
        var def = WAVES[wave];
        lastAfter = def.after;
        pushLog('WAVE ' + (wave + 1) + ' OVER',
          'blocked ' + blocked + ', lost ' + lost + ', score ' + score, 'note');
        wave++;
        if (wave >= WAVES.length) {
          phase = 'done';
          finish(true);
          return;
        }
        phase = 'plan';
        syncWaveBtn();
        g.stat('wave', (wave + 1) + '/' + WAVES.length);
        g.announce('Wave cleared. ' + def.after + ' Score ' + score + '. Edit the chain, then start wave ' +
          (wave + 1) + ' of ' + WAVES.length + '.');
      }

      function finish(won) {
        var uptime = (delivered + lost) > 0
          ? Math.round((delivered / (delivered + lost)) * 100) : 100;
        var msg;
        if (!won) {
          msg = 'The server took ' + breaches + ' hits and stopped answering. You blocked ' + blocked +
            ' attacks and dropped ' + lost + ' legitimate packets, and ' + uptime +
            ' per cent of the real traffic got through.';
        } else if (score <= 0) {
          msg = 'Every wave survived, and the score is ' + score + '. You blocked ' + blocked +
            ' attacks and threw away ' + lost + ' legitimate packets to do it. A wall that stops the ' +
            'business is an outage you caused yourself.';
        } else {
          msg = 'Blocked ' + blocked + ' attacks, dropped ' + lost + ' legitimate packets, ' + uptime +
            ' per cent of the real traffic delivered, ' + breaches + ' got past you.';
        }
        g.over({
          won: won && score > 0,
          score: score,
          title: won ? (score > 0 ? 'The chain held' : 'Nothing got in, nothing got out') : 'Server compromised',
          message: msg
        });
      }

      /* ---------------------------------------------------------------
         Verdicts and scoring.
         --------------------------------------------------------------- */
      function pushLog(left, right, kind) {
        log.push({ a: left, b: right, kind: kind });
        while (log.length > LOG_MAX) log.shift();
      }

      function packetWords(p) {
        return p.proto + ' ' + p.src + (p.port > 0 ? ' :' + p.port : ' no port') +
          ' ' + (p.state === 'EST' ? 'EST' : 'NEW');
      }

      function resolve(p, kind, shortWhere, longWhere) {
        p.verdict = kind;                 // 'blocked' | 'through'
        p.fade = kind === 'blocked' ? 0.9 : 1;
        longWhere = longWhere || shortWhere;
        waveDone++;

        if (kind === 'blocked') {
          if (p.evil) {
            blocked++;
            score += BLOCK_POINTS;
            p.tag = 'BLOCKED';
            p.good = true;
            if (g.gate('hit', 0.12)) g.pluck(660, 0.16, 0.05);
            pushLog(packetWords(p), shortWhere + ' — attack blocked ' + fmt(BLOCK_POINTS), 'good');
          } else {
            lost++;
            score -= LOSS_POINTS;
            p.tag = 'LOST';
            p.good = false;
            if (g.gate('miss', 0.2)) g.noise(0.13, { type: 'lowpass', freq: 420, to: 110, q: 1.1, level: 0.07 });
            pushLog(packetWords(p), shortWhere + ' — legitimate ' + fmt(-LOSS_POINTS), 'bad');
            if (g.gate('say-lost', 4)) {
              g.announce('Legitimate traffic dropped: ' + packetWords(p) + ', by ' + longWhere + '.');
            }
          }
        } else {
          if (p.evil) {
            breaches++;
            integrity--;
            p.tag = 'BREACH';
            p.good = false;
            g.noise(0.22, { type: 'lowpass', freq: 260, to: 70, q: 1.4, level: 0.08 });
            pushLog(packetWords(p), shortWhere + ' — ATTACK REACHED THE SERVER', 'bad');
            if (g.gate('say-breach', 3)) {
              g.announce('An attack reached the server through ' + longWhere + '. Integrity ' +
                Math.max(0, integrity) + ' of ' + START_INTEGRITY + '.');
            }
          } else {
            delivered++;
            p.tag = 'OK';
            p.good = true;
            if (g.gate('ok', 0.5)) g.beep(880, 0.03, 'triangle', 0.014);
            pushLog(packetWords(p), shortWhere + ' — legitimate, delivered', 'ok');
          }
        }

        g.setScore(score);
        g.stat('blocked', blocked);
        g.stat('lost', lost);

        if (integrity <= 0 && g.state === 'playing') {
          phase = 'done';
          finish(false);
        }
      }

      /* One packet, one step down the wire. The gate index it has already
         passed is carried on the packet rather than recomputed, because a
         rule inserted mid-flight must not send a packet back through a gate
         it is already past — a chain edit applies to what comes next, which
         is also what happens when you edit a live firewall. */
      function stepPacket(p, dt) {
        /* A rejected packet is sent back the way it came, because that is
           what REJECT is: an error returned to the sender rather than a
           silence. It costs the attacker nothing and tells them the host is
           alive, which is the whole argument between the two verdicts. */
        if (p.action === 'REJECT') {
          p.x -= SPEED * 1.4 * dt;
          p.fade -= dt * 0.5;
          return;
        }
        if (p.verdict === 'blocked') { p.fade -= dt * 1.6; return; }
        if (p.verdict === 'through') { p.x += SPEED * dt; p.fade -= dt * 1.3; return; }

        p.x += SPEED * dt;

        while (p.gate < SLOTS && p.x >= GATEX[p.gate]) {
          var idx = p.gate;
          p.gate++;
          var r = rules[idx];
          if (!r) continue;
          if (!ruleHits(r, p.proto, p.port, p.src, p.state)) continue;
          var brief = 'rule ' + (idx + 1) + ' ' + r.a.toLowerCase();
          var full = 'rule ' + (idx + 1) + ', ' + ruleWords(r);
          if (r.a === 'ACCEPT') {
            p.accepted = true;
            p.gate = SLOTS + 1;                 // first match wins: skip the rest
            p.pass = brief;
            p.passFull = full;
            return;
          }
          p.action = r.a;
          resolve(p, 'blocked', brief, full);
          return;
        }

        if (!p.accepted && p.x >= POLICYX) {
          if (policy === 'DROP') {
            p.action = 'DROP';
            resolve(p, 'blocked', 'default policy', 'the default policy, which is DROP');
            return;
          }
          p.accepted = true;
          p.pass = 'default policy';
          p.passFull = 'the default policy, which is ACCEPT';
        }

        if (p.x >= DELIVER_X) {
          resolve(p, 'through', p.pass || 'default policy', p.passFull || 'the default policy');
        }
      }

      /* ---------------------------------------------------------------
         Drawing.
         --------------------------------------------------------------- */
      function setFont(ctx, size, bold) {
        ctx.font = (bold ? '700 ' : '') + size + 'px "Segoe UI", system-ui, sans-serif';
      }

      function label(ctx, s, x, y, size, colour, align, bold) {
        setFont(ctx, size, bold);
        ctx.fillStyle = colour;
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(s, x, y);
      }

      function wrapText(ctx, s, x, y, maxw, lh, lines) {
        var words = s.split(' ');
        var line = '';
        var used = 0;
        for (var i = 0; i < words.length; i++) {
          var test = line ? line + ' ' + words[i] : words[i];
          if (ctx.measureText(test).width > maxw && line) {
            ctx.fillText(line, x, y + used * lh);
            used++;
            line = words[i];
            if (lines && used >= lines) { line = ''; break; }
          } else {
            line = test;
          }
        }
        if (line) { ctx.fillText(line, x, y + used * lh); used++; }
        return y + used * lh;
      }

      function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }

      function drawHeader(ctx) {
        var def = WAVES[Math.min(wave, WAVES.length - 1)];
        var head = 'WAVE ' + Math.min(wave + 1, WAVES.length) + ' OF ' + WAVES.length + '  ' +
          def.name.toUpperCase();
        label(ctx, head, 12, 19, 11, COL_TEXT, 'left', true);

        var right;
        if (phase === 'plan') right = 'Planning. Space, or the Start wave button, releases it.';
        else if (phase === 'wave') right = waveDone + ' of ' + waveTotal + ' resolved';
        else right = 'Run over';
        label(ctx, right, 708, 19, 10, phase === 'plan' ? COL_WARN : COL_MID, 'right');

        ctx.fillStyle = '#111c33';
        ctx.fillRect(12, 26, 696, 5);
        var frac = waveTotal ? waveDone / waveTotal : 0;
        ctx.fillStyle = COL_SEL;
        ctx.fillRect(12, 26, 696 * Math.max(0, Math.min(1, frac)), 5);

        setFont(ctx, 10, false);
        ctx.fillStyle = COL_MID;
        ctx.textAlign = 'left';
        wrapText(ctx, def.brief, 12, 45, 690, 12, 2);
      }

      function drawLane(ctx) {
        ctx.fillStyle = COL_LANE;
        ctx.fillRect(0, LANE_TOP + 6, W, LANE_BOT - LANE_TOP - 12);
        ctx.strokeStyle = COL_EDGE;
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, LANE_TOP + 6.5, W - 1, LANE_BOT - LANE_TOP - 13);

        /* The two ends, written along the edge so they cost no lane width. */
        ctx.save();
        ctx.translate(14, 107);
        ctx.rotate(-Math.PI / 2);
        label(ctx, 'INTERNET', 0, 0, 9, COL_DIM, 'center', true);
        ctx.restore();

        ctx.save();
        ctx.translate(714, 107);
        ctx.rotate(-Math.PI / 2);
        label(ctx, 'SERVER', 0, 0, 9, COL_OK, 'center', true);
        ctx.restore();

        for (var i = 0; i < SLOTS; i++) {
          var r = rules[i];
          ctx.fillStyle = r ? (r.dead ? '#334155' : ACTION_COL[r.a]) : '#1e293b';
          ctx.globalAlpha = r ? 0.85 : 0.45;
          ctx.fillRect(GATEX[i] - 1.5, LANE_TOP, 3, LANE_BOT - LANE_TOP);
          ctx.globalAlpha = 1;
        }

        /* The default policy is the last gate, and drawing it anywhere else
           would misplace the one thing this game is trying to teach. */
        ctx.fillStyle = policy === 'DROP' ? COL_BAD : COL_OK;
        ctx.fillRect(POLICYX - 2, LANE_TOP, 4, LANE_BOT - LANE_TOP);
        ctx.save();
        ctx.translate(POLICYX - 9, 107);
        ctx.rotate(-Math.PI / 2);
        label(ctx, 'POLICY ' + policy, 0, 0, 8, policy === 'DROP' ? COL_BAD : COL_OK, 'center', true);
        ctx.restore();
      }

      function drawPacket(ctx, p) {
        var x = p.x - CHIP_W / 2;
        var y = ROWY[p.row] - CHIP_H / 2;
        var a = p.fade == null ? 1 : Math.max(0, Math.min(1, p.fade));
        ctx.globalAlpha = a;

        var edge = PROTO_COL[p.proto] || COL_MID;
        var fill = '#111c33';
        if (p.verdict) fill = p.good ? '#0d2c1c' : '#3b1220';

        roundRect(ctx, x, y, CHIP_W, CHIP_H, 4);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = p.verdict ? (p.good ? COL_OK : COL_BAD) : edge;
        ctx.lineWidth = 1;
        ctx.stroke();

        /* An established flow gets a doubled left edge as well as the word,
           because a two-letter tag at this size is not something anybody
           should have to depend on. */
        if (p.state === 'EST') {
          ctx.fillStyle = COL_OK;
          ctx.fillRect(x + 2, y + 3, 2, CHIP_H - 6);
          ctx.fillRect(x + 5.5, y + 3, 1.5, CHIP_H - 6);
        }

        if (p.tag) {
          label(ctx, p.tag, x + CHIP_W / 2, y + 17, 10, p.good ? COL_OK : COL_BAD, 'center', true);
        } else {
          label(ctx, p.proto + (p.port > 0 ? ' :' + p.port : ' —'), x + 10, y + 11, 9, COL_TEXT, 'left', true);
          label(ctx, p.state === 'EST' ? 'EST' : 'NEW', x + CHIP_W - 5, y + 11, 8,
            p.state === 'EST' ? COL_OK : COL_WARN, 'right');
          label(ctx, p.src, x + 10, y + 21, 8, COL_MID, 'left');
        }
        ctx.globalAlpha = 1;
      }

      function drawSlot(ctx, i) {
        var x = GATEX[i] - BOX_W / 2;
        var r = rules[i];
        var selected = i === sel;

        roundRect(ctx, x, BOX_Y, BOX_W, BOX_H, 5);
        if (!r) {
          ctx.fillStyle = '#080f1f';
          ctx.fill();
          ctx.strokeStyle = selected ? COL_SEL : '#1a2540';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);
          label(ctx, 'empty', GATEX[i], BOX_Y + 40, 9, COL_DIM, 'center');
          label(ctx, 'slot ' + (i + 1), GATEX[i], BOX_Y + 54, 8, '#3f4a63', 'center');
          return;
        }

        ctx.fillStyle = r.dead ? '#161b28' : '#101b32';
        ctx.fill();
        ctx.strokeStyle = selected ? COL_SEL : (r.dead ? '#3f4a63' : COL_EDGE);
        ctx.lineWidth = selected ? 2 : 1;
        ctx.stroke();

        label(ctx, String(i + 1), x + 7, BOX_Y + 15, 10, selected ? COL_SEL : COL_DIM, 'left', true);

        var badge = ACTION_COL[r.a];
        roundRect(ctx, x + BOX_W - 50, BOX_Y + 5, 44, 14, 3);
        ctx.fillStyle = badge;
        ctx.globalAlpha = r.dead ? 0.35 : 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        label(ctx, r.a, x + BOX_W - 28, BOX_Y + 15, 8, '#04121f', 'center', true);

        label(ctx, matchDef(r.m).shortLabel, GATEX[i], BOX_Y + 36, 8, COL_DIM, 'center');

        setFont(ctx, 9, true);
        ctx.fillStyle = r.dead ? '#6b7280' : COL_TEXT;
        ctx.textAlign = 'center';
        wrapText(ctx, valueLabel(r), GATEX[i], BOX_Y + 50, BOX_W - 8, 11, 2);

        if (r.dead) {
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 6, BOX_Y + 44);
          ctx.lineTo(x + BOX_W - 6, BOX_Y + 44);
          ctx.stroke();
          label(ctx, 'SHADOWED', GATEX[i], BOX_Y + 80, 8, COL_WARN, 'center', true);
        }
      }

      function drawChain(ctx) {
        for (var i = 0; i < SLOTS; i++) drawSlot(ctx, i);

        var help = 'Read left to right. The first rule that matches decides, and the rest never see the packet. ' +
          'Drag a rule to move it.';
        label(ctx, help, 12, 254, 9, COL_DIM, 'left');

        var deads = deadCount();
        if (deads > 0) {
          label(ctx, deads + (deads === 1 ? ' rule is shadowed' : ' rules are shadowed') +
            ' — nothing reaches it', 708, 254, 9, COL_WARN, 'right');
        }
      }

      function drawLog(ctx) {
        label(ctx, 'TRAFFIC LOG', 12, 278, 9, COL_DIM, 'left', true);
        ctx.strokeStyle = COL_EDGE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(12, 284); ctx.lineTo(430, 284);
        ctx.stroke();

        for (var i = 0; i < log.length; i++) {
          var row = log[i];
          var y = 298 + i * 15;
          var colour = row.kind === 'good' ? COL_OK
            : row.kind === 'bad' ? COL_BAD
            : row.kind === 'note' ? COL_WARN : COL_MID;
          if (row.kind === 'note') {
            label(ctx, row.a, 12, y, 9, colour, 'left', true);
            label(ctx, row.b, 196, y, 9, COL_MID, 'left');
          } else {
            label(ctx, row.a, 12, y, 9, COL_MID, 'left');
            label(ctx, row.b, 196, y, 9, colour, 'left');
          }
        }

        if (!log.length) {
          label(ctx, 'Nothing has crossed the wire yet.', 12, 300, 9, COL_DIM, 'left');
        }
      }

      function drawPanel(ctx) {
        var x = 442;
        var wide = 266;

        ctx.strokeStyle = COL_EDGE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(436, 268); ctx.lineTo(436, 470);
        ctx.stroke();

        label(ctx, 'SCORE', x, 278, 9, COL_DIM, 'left', true);
        label(ctx, String(score), x + wide, 292, 24,
          score > 0 ? COL_OK : (score < 0 ? COL_BAD : COL_TEXT), 'right', true);
        label(ctx, 'attacks blocked minus legitimate dropped', x, 292, 9, COL_DIM, 'left');

        label(ctx, 'Attacks blocked', x, 320, 10, COL_MID, 'left');
        label(ctx, blocked + '  (' + fmt(blocked * BLOCK_POINTS) + ')', x + wide, 320, 11, COL_OK, 'right', true);

        label(ctx, 'Legitimate dropped', x, 340, 10, COL_MID, 'left');
        label(ctx, lost + '  (' + fmt(-lost * LOSS_POINTS) + ')', x + wide, 340, 11, COL_BAD, 'right', true);

        label(ctx, 'Legitimate delivered', x, 360, 10, COL_MID, 'left');
        label(ctx, String(delivered), x + wide, 360, 11, COL_TEXT, 'right', true);

        label(ctx, 'Attacks that got in', x, 380, 10, COL_MID, 'left');
        label(ctx, String(breaches), x + wide, 380, 11, breaches ? COL_BAD : COL_TEXT, 'right', true);

        label(ctx, 'Server integrity', x, 404, 10, COL_MID, 'left');
        label(ctx, Math.max(0, integrity) + ' of ' + START_INTEGRITY, x + wide, 404, 10, COL_MID, 'right');
        ctx.fillStyle = '#111c33';
        ctx.fillRect(x, 410, wide, 10);
        var frac = Math.max(0, integrity) / START_INTEGRITY;
        ctx.fillStyle = frac > 0.5 ? COL_OK : (frac > 0.25 ? COL_WARN : COL_BAD);
        ctx.fillRect(x, 410, wide * frac, 10);

        /* Between waves the debrief earns this space; during one, what the
           selected rule is matters more. Both are prose the log has no room
           for at nine pixels across four hundred units. */
        var note;
        var tint = COL_MID;
        if (phase === 'plan' && lastAfter) {
          note = lastAfter;
          tint = COL_WARN;
        } else if (rules.length === 0) {
          note = 'The chain is empty, so every packet is decided by the default policy alone.';
        } else if (rules[sel]) {
          note = 'Selected: rule ' + (sel + 1) + ', ' + ruleWords(rules[sel]) + '.' +
            (rules[sel].dead ? ' ' + rules[sel].why : '');
        } else {
          note = 'Pick a match and an action in the toolbar, then tap an empty slot.';
        }
        setFont(ctx, 9, false);
        ctx.fillStyle = tint;
        ctx.textAlign = 'left';
        wrapText(ctx, note, x, 436, wide, 11, 4);
      }

      /* ---------------------------------------------------------------
         Hooks.
         --------------------------------------------------------------- */
      function reset() {
        rules = [];
        sel = 0;
        policy = 'ACCEPT';
        if (policySel) policySel.value = 'ACCEPT';
        wave = 0;
        phase = 'plan';
        queue = [];
        packets = [];
        spawnT = 0;
        score = 0;
        blocked = 0;
        lost = 0;
        delivered = 0;
        breaches = 0;
        integrity = START_INTEGRITY;
        waveTotal = 0;
        waveDone = 0;
        log = [];
        lastAfter = '';
        spawned = 0;
        dragIdx = -1;
        recompute();
        syncWaveBtn();
        g.stat('wave', '1/' + WAVES.length);
        g.stat('blocked', 0);
        g.stat('lost', 0);
        g.setScore(0);
      }

      return {
        reset: reset,

        key: function (name) {
          if (name === 'action') {
            if (phase === 'plan') startWave();
            else addRule();
            return;
          }
          if (!rules.length) return;
          if (name === 'left') { sel = (sel + rules.length - 1) % rules.length; announceRule('Selected.', sel); }
          else if (name === 'right') { sel = (sel + 1) % rules.length; announceRule('Selected.', sel); }
          else if (name === 'up') moveRule(sel, sel - 1);
          else if (name === 'down') moveRule(sel, sel + 1);
        },

        update: function (dt) {
          var step = reduced ? dt * 0.65 : dt;

          if (phase === 'wave') {
            spawnT -= step;
            if (spawnT <= 0 && queue.length) {
              var spec = queue.shift();
              spec.x = SPAWN_X;
              /* Alternating rows off a spawn counter, not off packets.length
                 — that counts the ones still alive, so two consecutive
                 packets landed in the same row whenever one had just been
                 dropped, and a flood wave stacked chips on top of each
                 other. */
              spec.row = spawned % 2;
              spawned++;
              spec.gate = 0;
              spec.accepted = false;
              spec.verdict = null;
              spec.action = null;
              spec.tag = '';
              spec.good = false;
              spec.fade = 1;
              packets.push(spec);
              spawnT = WAVES[wave].gap;
            }
          }

          for (var i = packets.length - 1; i >= 0; i--) {
            var p = packets[i];
            stepPacket(p, step);
            if (g.state !== 'playing') return;
            if (p.fade <= 0 || p.x < SPAWN_X - 60 || p.x > W + 90) packets.splice(i, 1);
          }

          if (phase === 'wave' && !queue.length && !packets.length) endWave();
        },

        draw: function (ctx) {
          ctx.fillStyle = COL_BG;
          ctx.fillRect(0, 0, W, H);

          drawHeader(ctx);
          drawLane(ctx);

          ctx.save();
          ctx.beginPath();
          ctx.rect(0, LANE_TOP, W, LANE_BOT - LANE_TOP);
          ctx.clip();
          for (var i = 0; i < packets.length; i++) drawPacket(ctx, packets[i]);
          ctx.restore();

          drawChain(ctx);
          drawLog(ctx);
          drawPanel(ctx);
        }
      };
    }
  });
})();

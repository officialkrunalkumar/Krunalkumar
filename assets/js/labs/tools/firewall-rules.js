/* ==========================================================================
   firewall-rules.js — walk a packet through an iptables or nftables ruleset,
   rule by rule, and find the rules that can never fire.
   --------------------------------------------------------------------------
   Almost every firewall question is really an ordering question. The rules are
   individually obvious; what is not obvious is which one the packet reaches
   first, and which ones sit underneath a broader rule that already answered.
   So this walks a packet down the chain and prints every rule it was tested
   against, the reason each one did or did not match, and the point where the
   decision was actually made — including falling off the end and landing on
   the chain policy, which is where a surprising number of packets end up.

   The shadowing check is the part I care about most. It is subset containment
   over the dimensions the model supports — protocol, source and destination
   ranges, port ranges, interface, conntrack state — and not string comparison.
   That is what catches an ACCEPT for 10.10.0.0/16 sitting under a DROP for
   10.0.0.0/8, where nothing about the two lines looks alike. The comparison is
   deliberately conservative: a union of ranges is never merged before
   comparing, so the check can miss a real shadow and cannot invent one. A
   false alarm during a firewall review costs more than a miss does.

   Conntrack here is a dictionary, not a kernel subsystem. It keys a flow on
   protocol plus both address and port pairs, marks the entry once traffic has
   been seen in both directions, and creates the entry only when a packet is
   accepted — which is roughly what nf_conntrack_confirm does, and it is enough
   to show why a reply gets back in through a chain whose policy is DROP. There
   are no protocol helpers, no timeouts and no TCP state machine, so RELATED is
   a stand-in and INVALID is only ever something you pick by hand.

   What this is not: netfilter. No NAT table, no mangle, no raw, no rate
   limiting, no ipset, no reverse-path filtering, no packet marks, no IPv6.
   Every match it cannot model is named in the output instead of being skipped,
   and the rule carrying one is treated as not matching, because an unparsed
   rule is exactly the one that will surprise you later.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_INPUT = 128 * 1024;
  var MAX_RULES = 800;
  var MAX_HOPS = 6;
  var MAX_STEPS = 2000;
  var MAX_CT = 200;

  var out = LabTool.out('tool-out');
  var model = null;
  var track = {};
  var trackOrder = [];
  var ctSeq = 0;
  var lastPacket = null;

  /* ======================================================================
     Small text helpers.
     ====================================================================== */
  function trimText(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function stripQuotes(s) {
    var t = trimText(s);
    var q = t.charAt(0);
    if (t.length > 1 && (q === '"' || q === "'") && t.charAt(t.length - 1) === q) {
      return t.slice(1, t.length - 1);
    }
    return t;
  }

  /* A quoted comment is one token, not four. Everything else splits on
     whitespace the way a shell would. */
  function tokens(line) {
    var list = [];
    var re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    var m;
    while ((m = re.exec(line)) !== null) {
      if (m[1] !== undefined) list.push('"' + m[1] + '"');
      else if (m[2] !== undefined) list.push('"' + m[2] + '"');
      else list.push(m[3]);
    }
    return list;
  }

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = ' ' + s;
    return s;
  }

  function el(id) { return document.getElementById(id); }

  function setStatus(text, cls) {
    var node = el('fw-status');
    if (!node) return;
    node.className = 'lab-status' + (cls ? ' ' + cls : '');
    node.textContent = text;
  }

  /* ======================================================================
     IPv4 arithmetic. Addresses and ports both become closed integer ranges,
     which makes "does this rule cover that rule" one comparison instead of
     two different ones.

     Numbers rather than bit operations on purpose: JavaScript bitwise
     operators are signed 32-bit, so 10.0.0.0 >>> 0 arithmetic works but any
     slip produces a negative address, and the failure is silent.
     ====================================================================== */
  function ip2num(text) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimText(text));
    if (!m) return null;
    var n = 0, i, part;
    for (i = 1; i <= 4; i++) {
      part = parseInt(m[i], 10);
      if (part > 255) return null;
      n = n * 256 + part;
    }
    return n;
  }

  function num2ip(n) {
    return (Math.floor(n / 16777216) % 256) + '.' + (Math.floor(n / 65536) % 256) +
           '.' + (Math.floor(n / 256) % 256) + '.' + (n % 256);
  }

  /* A dotted mask is only a prefix length if its one bits are contiguous.
     255.0.255.0 is a legal thing to type and is not a CIDR block, so it is
     refused rather than rounded into one. */
  function maskToBits(n) {
    var bits = 0, seenZero = false, i, bit;
    for (i = 31; i >= 0; i--) {
      bit = Math.floor(n / Math.pow(2, i)) % 2;
      if (bit === 1) {
        if (seenZero) return null;
        bits++;
      } else {
        seenZero = true;
      }
    }
    return bits;
  }

  function parseCidr(text) {
    var raw = trimText(text);
    if (raw.indexOf(':') >= 0) return null;
    var slash = raw.indexOf('/');
    var addrText = slash < 0 ? raw : raw.slice(0, slash);
    var bits = 32;
    if (slash >= 0) {
      var maskText = raw.slice(slash + 1);
      if (/^\d+$/.test(maskText)) {
        bits = parseInt(maskText, 10);
        if (bits > 32) return null;
      } else {
        var mn = ip2num(maskText);
        if (mn === null) return null;
        bits = maskToBits(mn);
        if (bits === null) return null;
      }
    }
    var base = ip2num(addrText);
    if (base === null) return null;
    var size = Math.pow(2, 32 - bits);
    var lo = Math.floor(base / size) * size;
    return { lo: lo, hi: lo + size - 1, text: raw };
  }

  var SERVICES = {
    ssh: 22, http: 80, https: 443, domain: 53, smtp: 25, submission: 587,
    imaps: 993, pop3s: 995, ntp: 123, snmp: 161, ftp: 21, telnet: 23,
    mysql: 3306, postgresql: 5432, rdp: 3389
  };

  function parsePortItem(text) {
    var t = trimText(text);
    var m = /^(\d+)\s*[:\-]\s*(\d+)$/.exec(t);
    var a, b, p;
    if (m) {
      a = parseInt(m[1], 10);
      b = parseInt(m[2], 10);
      if (a > 65535 || b > 65535 || a > b) return null;
      return { lo: a, hi: b, text: t };
    }
    if (/^\d+$/.test(t)) {
      p = parseInt(t, 10);
      if (p > 65535) return null;
      return { lo: p, hi: p, text: t };
    }
    if (SERVICES[t.toLowerCase()] !== undefined) {
      p = SERVICES[t.toLowerCase()];
      return { lo: p, hi: p, text: t + ' (' + p + ')' };
    }
    return null;
  }

  /* ======================================================================
     Match dimensions.

     A rule is a conjunction over eight dimensions. A dimension is either
     null, meaning "this rule says nothing here, so anything matches", or an
     object holding a list of items and a negation flag. Every match test and
     the whole shadowing analysis run over this one shape.
     ====================================================================== */
  var DIMS = ['proto', 'src', 'dst', 'sport', 'dport', 'iif', 'oif', 'ctstate'];

  var DIM_LABEL = {
    proto: 'protocol', src: 'source address', dst: 'destination address',
    sport: 'source port', dport: 'destination port',
    iif: 'in-interface', oif: 'out-interface', ctstate: 'ct state'
  };

  function splitList(text) {
    var t = trimText(text);
    if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') t = t.slice(1, t.length - 1);
    return t.split(',').map(trimText).filter(function (x) { return x.length > 0; });
  }

  function dimRange(kindOfItem, text, neg) {
    var parts = splitList(text);
    var items = [], i, item;
    for (i = 0; i < parts.length; i++) {
      item = kindOfItem === 'addr' ? parseCidr(parts[i]) : parsePortItem(parts[i]);
      if (!item) return null;
      items.push(item);
    }
    if (!items.length) return null;
    return { kind: 'range', items: items, neg: !!neg, text: trimText(text) };
  }

  function dimNames(kind, text, neg, mapper) {
    var parts = splitList(text).map(function (p) {
      var v = stripQuotes(p);
      return mapper ? mapper(v) : v;
    });
    if (!parts.length) return null;
    return { kind: kind, items: parts, neg: !!neg, text: trimText(text) };
  }

  var PROTO_NUM = {
    '1': 'icmp', '6': 'tcp', '17': 'udp', '47': 'gre', '50': 'esp',
    '58': 'icmpv6', '132': 'sctp'
  };

  function normProto(v) {
    var t = String(v).toLowerCase();
    return PROTO_NUM[t] || t;
  }

  function protoDim(text, neg) {
    var t = trimText(text).toLowerCase();
    if (t === 'all' || t === 'any' || t === 'ip') return null;
    return dimNames('name', text, neg, normProto);
  }

  var CT_STATES = {
    NEW: 1, ESTABLISHED: 1, RELATED: 1, INVALID: 1, UNTRACKED: 1, SNAT: 1, DNAT: 1
  };

  function ctDim(text, neg, unknownSink) {
    var d = dimNames('name', text, neg, function (v) { return v.toUpperCase(); });
    if (!d) return null;
    d.items.forEach(function (s) {
      if (!CT_STATES[s] && unknownSink) unknownSink.push('ct state ' + s);
    });
    return d;
  }

  /* eth+ in iptables and eth* in nft both mean "any interface whose name starts
     with eth". Held as the literal pattern so the shadowing check can say that
     eth+ covers eth0 without expanding anything. */
  function ifaceCovers(pattern, name) {
    var last = pattern.charAt(pattern.length - 1);
    if (last === '+' || last === '*') {
      return String(name).indexOf(pattern.slice(0, pattern.length - 1)) === 0;
    }
    return pattern === name;
  }

  function hitItem(kind, item, value) {
    if (kind === 'range') return value >= item.lo && value <= item.hi;
    if (kind === 'iface') return ifaceCovers(item, value);
    return item === value;
  }

  function dimHit(dim, value) {
    var i;
    for (i = 0; i < dim.items.length; i++) {
      if (hitItem(dim.kind, dim.items[i], value)) return dim.items[i];
    }
    return null;
  }

  function itemCovers(kind, a, b) {
    if (kind === 'range') return b.lo >= a.lo && b.hi <= a.hi;
    if (kind === 'iface') return ifaceCovers(a, b);
    return a === b;
  }

  /* Does dimension a cover every value dimension b can take?

     Two deliberate refusals. A negated dimension on either side returns false:
     the complement of a union is not something this representation can compare
     honestly, and guessing would produce exactly the false positive the whole
     analysis is supposed to avoid. And a b-item is only covered if a SINGLE
     a-item contains it, so { 10.0.0.0/9, 10.128.0.0/9 } is not recognised as
     covering 10.0.0.0/8. Both make the check miss things. Neither makes it
     claim a rule is dead when it is not. */
  function dimCovers(a, b) {
    if (!a) return true;
    if (!b) return false;
    if (a.neg || b.neg) return false;
    var i, j, ok;
    for (i = 0; i < b.items.length; i++) {
      ok = false;
      for (j = 0; j < a.items.length; j++) {
        if (itemCovers(a.kind, a.items[j], b.items[i])) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  function describeDim(dim) {
    if (!dim) return 'any';
    return (dim.neg ? 'not ' : '') + dim.text;
  }

  /* ======================================================================
     The model.
     ====================================================================== */
  var HOOKS = {
    INPUT: 'input', OUTPUT: 'output', FORWARD: 'forward',
    PREROUTING: 'prerouting', POSTROUTING: 'postrouting'
  };

  function newModel(syntax) {
    return {
      syntax: syntax, chains: {}, order: [], unparsed: [], notes: [],
      ruleCount: 0, tables: {}
    };
  }

  function ensureChain(m, name) {
    if (!m.chains[name]) {
      var hook = HOOKS[String(name).toUpperCase()] || null;
      m.chains[name] = {
        name: name, policy: hook ? 'ACCEPT' : null, base: !!hook, hook: hook,
        rules: [], referenced: false, policyStated: false
      };
      m.order.push(name);
    }
    return m.chains[name];
  }

  function newRule(m, chainName, lineNo, text) {
    return {
      chain: chainName, line: lineNo, text: text, n: 0,
      proto: null, src: null, dst: null, sport: null, dport: null,
      iif: null, oif: null, ctstate: null,
      target: 'CONTINUE', jumpTo: null, rejectWith: null,
      unmodelled: [], note: null
    };
  }

  /* ======================================================================
     iptables-save parsing.
     ====================================================================== */
  var IPT_MODULES = {
    state: 1, conntrack: 1, tcp: 1, udp: 1, udplite: 1, icmp: 1,
    multiport: 1, comment: 1
  };

  var NOOP_TARGETS = { LOG: 1, NFLOG: 1, ULOG: 1, AUDIT: 1, TRACE: 1, COUNTER: 1 };
  var NAT_TARGETS = { SNAT: 1, DNAT: 1, MASQUERADE: 1, REDIRECT: 1, NETMAP: 1 };
  var MANGLE_TARGETS = { MARK: 1, CONNMARK: 1, TOS: 1, TTL: 1, TCPMSS: 1, SECMARK: 1 };

  function setTarget(rule, name, isGoto, m) {
    var t = String(name).toUpperCase();
    if (t === 'ACCEPT' || t === 'DROP' || t === 'REJECT' || t === 'RETURN') {
      rule.target = t;
      return;
    }
    if (NOOP_TARGETS[t]) {
      rule.target = 'CONTINUE';
      rule.note = t + ' decides nothing, so the packet carries on to the next rule.';
      return;
    }
    if (NAT_TARGETS[t]) {
      rule.target = 'CONTINUE';
      rule.unmodelled.push('-j ' + t + ' (address translation is not modelled)');
      return;
    }
    if (MANGLE_TARGETS[t]) {
      rule.target = 'CONTINUE';
      rule.unmodelled.push('-j ' + t + ' (packet and connection marks are not modelled)');
      return;
    }
    if (t === 'QUEUE' || t === 'NFQUEUE') {
      rule.target = 'CONTINUE';
      rule.unmodelled.push('-j ' + t + ' (the verdict comes from a userspace program)');
      return;
    }
    rule.target = isGoto ? 'GOTO' : 'JUMP';
    rule.jumpTo = name;
    ensureChain(m, name).referenced = true;
  }

  function mergeRangeDim(existing, kindOfItem, text, neg) {
    var made = dimRange(kindOfItem, text, neg);
    if (!made) return existing === undefined ? null : existing;
    if (!existing) return made;
    if (existing.neg !== made.neg) return made;
    return {
      kind: 'range', neg: made.neg,
      items: existing.items.concat(made.items),
      text: existing.text + ',' + made.text
    };
  }

  function parseIptOptions(opts, rule, m) {
    var i = 0, neg = false, t, val, chunk, mod;
    while (i < opts.length) {
      t = opts[i];
      if (t === '!') { neg = true; i++; continue; }
      /* --dport=22 is as legal as --dport 22 and turns up in shell scripts. */
      if (t.charAt(0) === '-' && t.indexOf('=') > 1) {
        var cut = t.indexOf('=');
        opts.splice(i, 1, t.slice(0, cut), t.slice(cut + 1));
        t = opts[i];
      }
      val = opts[i + 1];
      switch (t) {
        case '-p': case '--protocol':
          rule.proto = protoDim(val, neg); i += 2; break;
        case '-s': case '--source': case '--src':
          rule.src = dimRange('addr', val, neg);
          if (!rule.src) rule.unmodelled.push('-s ' + val);
          i += 2; break;
        case '-d': case '--destination': case '--dst':
          rule.dst = dimRange('addr', val, neg);
          if (!rule.dst) rule.unmodelled.push('-d ' + val);
          i += 2; break;
        case '-i': case '--in-interface':
          rule.iif = dimNames('iface', val, neg); i += 2; break;
        case '-o': case '--out-interface':
          rule.oif = dimNames('iface', val, neg); i += 2; break;
        case '--dport': case '--destination-port':
        case '--dports': case '--destination-ports':
          rule.dport = mergeRangeDim(rule.dport, 'port', val, neg);
          if (!rule.dport) rule.unmodelled.push(t + ' ' + val);
          i += 2; break;
        case '--sport': case '--source-port':
        case '--sports': case '--source-ports':
          rule.sport = mergeRangeDim(rule.sport, 'port', val, neg);
          if (!rule.sport) rule.unmodelled.push(t + ' ' + val);
          i += 2; break;
        case '--state': case '--ctstate':
          rule.ctstate = ctDim(val, neg, rule.unmodelled); i += 2; break;
        case '-m': case '--match':
          mod = String(val || '').toLowerCase();
          if (!IPT_MODULES[mod]) rule.unmodelled.push('-m ' + mod);
          i += 2; break;
        case '--comment':
          i += 2; break;
        case '-j': case '--jump':
          setTarget(rule, val, false, m); i += 2; break;
        case '-g': case '--goto':
          setTarget(rule, val, true, m); i += 2; break;
        case '--reject-with':
          rule.rejectWith = val; i += 2; break;
        default:
          if (t.charAt(0) === '-') {
            chunk = t;
            while (i + 1 < opts.length && opts[i + 1].charAt(0) !== '-' && opts[i + 1] !== '!') {
              i++;
              chunk += ' ' + opts[i];
            }
            rule.unmodelled.push((neg ? '! ' : '') + chunk);
            i++;
          } else {
            rule.unmodelled.push(t);
            i++;
          }
          break;
      }
      neg = false;
    }
  }

  function parseIptables(text) {
    var m = newModel('iptables-save');
    var lines = text.split(/\r?\n/);
    var table = 'filter';
    var i, lineNo, line, tok, idx, t, cmd, chainName, ruleTable, policyVal, opts, chain, rule, parts;

    for (i = 0; i < lines.length; i++) {
      lineNo = i + 1;
      line = trimText(lines[i]);
      if (!line || line.charAt(0) === '#') continue;

      if (line.charAt(0) === '*') {
        table = trimText(line.slice(1)).toLowerCase();
        m.tables[table] = true;
        continue;
      }
      if (/^COMMIT$/i.test(line)) continue;

      if (line.charAt(0) === ':') {
        parts = trimText(line.slice(1)).split(/\s+/);
        if (table !== 'filter') { noteTable(m, table, lineNo); continue; }
        chain = ensureChain(m, parts[0]);
        if (parts[1] === 'ACCEPT' || parts[1] === 'DROP') {
          chain.policy = parts[1];
          chain.base = true;
          chain.policyStated = true;
          if (!chain.hook) chain.hook = HOOKS[String(parts[0]).toUpperCase()] || null;
        } else {
          chain.base = false;
          chain.policy = null;
        }
        continue;
      }

      tok = tokens(line);
      while (tok.length && /^(sudo|\/?\S*\/)?(ip6?tables(-legacy|-nft|-save|-restore)?)$/.test(tok[0])) {
        if (/ip6tables/.test(tok[0])) {
          pushNote(m, 'An ip6tables command is present. This model is IPv4 only, so IPv6 addresses are not evaluated.');
        }
        tok.shift();
      }
      if (tok.length && tok[0] === 'sudo') tok.shift();

      cmd = null; chainName = null; ruleTable = table; policyVal = null;
      opts = []; idx = 0;
      while (idx < tok.length) {
        t = tok[idx];
        if (t === '-t' || t === '--table') { ruleTable = String(tok[idx + 1] || 'filter').toLowerCase(); idx += 2; continue; }
        if (t === '-A' || t === '--append') { cmd = 'A'; chainName = tok[idx + 1]; idx += 2; continue; }
        if (t === '-I' || t === '--insert') {
          cmd = 'I'; chainName = tok[idx + 1]; idx += 2;
          if (tok[idx] && /^\d+$/.test(tok[idx])) idx++;
          continue;
        }
        if (t === '-P' || t === '--policy') {
          cmd = 'P'; chainName = tok[idx + 1]; policyVal = tok[idx + 2]; idx += 3; continue;
        }
        if (t === '-N' || t === '--new-chain' || t === '--new') {
          cmd = 'N'; chainName = tok[idx + 1]; idx += 2; continue;
        }
        if (t === '-F' || t === '-X' || t === '-Z' || t === '--flush') { cmd = 'IGNORE'; idx = tok.length; continue; }
        opts.push(t);
        idx++;
      }

      if (cmd === 'IGNORE') continue;
      if (!cmd || !chainName) {
        m.unparsed.push({ line: lineNo, text: line, why: 'no -A, -I, -P or -N in this line' });
        continue;
      }
      if (ruleTable !== 'filter') { noteTable(m, ruleTable, lineNo); continue; }

      if (cmd === 'P') {
        chain = ensureChain(m, chainName);
        if (policyVal === 'ACCEPT' || policyVal === 'DROP') {
          chain.policy = policyVal;
          chain.base = true;
          chain.policyStated = true;
        } else {
          m.unparsed.push({ line: lineNo, text: line, why: 'a chain policy has to be ACCEPT or DROP' });
        }
        continue;
      }
      if (cmd === 'N') { ensureChain(m, chainName); continue; }

      if (m.ruleCount >= MAX_RULES) {
        pushNote(m, 'Stopped after ' + MAX_RULES + ' rules. Everything past line ' + lineNo + ' was not read.');
        break;
      }
      chain = ensureChain(m, chainName);
      rule = newRule(m, chainName, lineNo, line);
      parseIptOptions(opts, rule, m);
      if (cmd === 'I') chain.rules.unshift(rule);
      else chain.rules.push(rule);
      m.ruleCount++;
    }
    renumber(m);
    return m;
  }

  function noteTable(m, table, lineNo) {
    pushNote(m, 'Line ' + lineNo + ' belongs to the ' + table + ' table. Only the filter table is modelled here, so it was not loaded.');
  }

  function pushNote(m, text) {
    if (m.notes.indexOf(text) < 0) m.notes.push(text);
  }

  function renumber(m) {
    m.order.forEach(function (name) {
      m.chains[name].rules.forEach(function (r, i) { r.n = i + 1; });
    });
  }

  /* ======================================================================
     nftables parsing — a useful subset, not the whole language.

     nft expressions are a conjunction read left to right, exactly like
     iptables options, so once a line is tokenised the two parsers produce the
     same rule object and everything downstream is shared. Sets are collapsed
     to a single token first, so { 80, 443 } arrives as {80,443}.
     ====================================================================== */
  function nftValue(tok, i) {
    var neg = false;
    if (tok[i] === '!=') { neg = true; i++; }
    else if (tok[i] === '==') { i++; }
    return { neg: neg, value: tok[i], next: i + 1 };
  }

  var NFT_VERDICTS = { accept: 'ACCEPT', drop: 'DROP', reject: 'REJECT', 'return': 'RETURN', 'continue': 'CONTINUE' };

  /* nft puts no punctuation between one expression and the next, so a value is
     simply whatever token follows the keyword. When a rule uses something this
     parser does not know, that "value" can turn out to be the next keyword: an
     earlier version read "fib saddr . iif oif missing" as an interface match on
     an interface literally named oif, and then printed a confident reason about
     it. A value that is itself a keyword is not a value, so the expression goes
     to the unmodelled list instead and the rule stops pretending. */
  var NFT_KEYWORDS = {
    ip: 1, ip6: 1, tcp: 1, udp: 1, sctp: 1, icmp: 1, icmpv6: 1, icmpx: 1,
    meta: 1, ct: 1, iif: 1, oif: 1, iifname: 1, oifname: 1, saddr: 1, daddr: 1,
    dport: 1, sport: 1, state: 1, protocol: 1, l4proto: 1, nfproto: 1,
    counter: 1, log: 1, comment: 1, limit: 1, jump: 1, 'goto': 1, accept: 1,
    drop: 1, reject: 1, 'return': 1, 'continue': 1, queue: 1, fib: 1,
    missing: 1, with: 1, prefix: 1, rate: 1, burst: 1
  };

  function nftIface(rule, label, v) {
    var raw = stripQuotes(v.value || '');
    if (!raw || NFT_KEYWORDS[raw]) {
      rule.unmodelled.push(label + ' ' + (v.value || '(nothing)'));
      return null;
    }
    return dimNames('iface', v.value || '', v.neg);
  }

  function parseNftRule(line, rule, m) {
    var tok = tokens(line);
    var i = 0, t, v, key, sub;
    while (i < tok.length) {
      t = tok[i];
      switch (t) {
        case 'ip':
        case 'ip6':
          key = tok[i + 1];
          if (t === 'ip6') {
            v = nftValue(tok, i + 2);
            rule.unmodelled.push('ip6 ' + key + ' ' + (v.value || ''));
            i = v.next;
            break;
          }
          if (key === 'saddr' || key === 'daddr') {
            v = nftValue(tok, i + 2);
            sub = dimRange('addr', v.value || '', v.neg);
            if (!sub) rule.unmodelled.push('ip ' + key + ' ' + (v.value || ''));
            else if (key === 'saddr') rule.src = sub; else rule.dst = sub;
            i = v.next;
          } else if (key === 'protocol') {
            v = nftValue(tok, i + 2);
            rule.proto = protoDim(v.value || '', v.neg);
            i = v.next;
          } else {
            v = nftValue(tok, i + 2);
            rule.unmodelled.push('ip ' + key + ' ' + (v.value || ''));
            i = v.next;
          }
          break;
        case 'tcp':
        case 'udp':
        case 'sctp':
          if (!rule.proto) rule.proto = protoDim(t, false);
          key = tok[i + 1];
          if (key === 'dport' || key === 'sport') {
            v = nftValue(tok, i + 2);
            sub = dimRange('port', v.value || '', v.neg);
            if (!sub) rule.unmodelled.push(t + ' ' + key + ' ' + (v.value || ''));
            else if (key === 'dport') rule.dport = sub; else rule.sport = sub;
            i = v.next;
          } else {
            v = nftValue(tok, i + 2);
            rule.unmodelled.push(t + ' ' + key + ' ' + (v.value || ''));
            i = v.next;
          }
          break;
        case 'icmp':
        case 'icmpv6':
        case 'icmpx':
          if (!rule.proto) rule.proto = protoDim(t === 'icmp' ? 'icmp' : t, false);
          v = nftValue(tok, i + 2);
          rule.unmodelled.push(t + ' ' + tok[i + 1] + ' ' + (v.value || ''));
          i = v.next;
          break;
        case 'meta':
          key = tok[i + 1];
          v = nftValue(tok, i + 2);
          if (key === 'l4proto') rule.proto = protoDim(v.value || '', v.neg);
          else if (key === 'iifname') { sub = nftIface(rule, 'meta iifname', v); if (sub) rule.iif = sub; }
          else if (key === 'oifname') { sub = nftIface(rule, 'meta oifname', v); if (sub) rule.oif = sub; }
          else rule.unmodelled.push('meta ' + key + ' ' + (v.value || ''));
          i = v.next;
          break;
        case 'ct':
          key = tok[i + 1];
          v = nftValue(tok, i + 2);
          if (key === 'state') rule.ctstate = ctDim(v.value || '', v.neg, rule.unmodelled);
          else rule.unmodelled.push('ct ' + key + ' ' + (v.value || ''));
          i = v.next;
          break;
        case 'iif': case 'iifname':
          v = nftValue(tok, i + 1);
          sub = nftIface(rule, t, v);
          if (sub) rule.iif = sub;
          i = v.next;
          break;
        case 'oif': case 'oifname':
          v = nftValue(tok, i + 1);
          sub = nftIface(rule, t, v);
          if (sub) rule.oif = sub;
          i = v.next;
          break;
        case 'counter':
          i++;
          while (i < tok.length && /^(packets|bytes)$/.test(tok[i])) i += 2;
          break;
        case 'log':
          i++;
          while (i < tok.length && /^(prefix|level|flags|group|snaplen|queue-threshold)$/.test(tok[i])) i += 2;
          break;
        case 'comment':
          i += 2;
          break;
        case 'limit':
          rule.unmodelled.push('limit ' + (tok[i + 1] || '') + ' ' + (tok[i + 2] || ''));
          i += 3;
          while (i < tok.length && /^(burst)$/.test(tok[i])) i += 3;
          break;
        case 'jump':
        case 'goto':
          setTarget(rule, tok[i + 1], t === 'goto', m);
          i += 2;
          break;
        case 'reject':
          rule.target = 'REJECT';
          i++;
          if (tok[i] === 'with') {
            rule.rejectWith = '';
            i++;
            while (i < tok.length && !NFT_VERDICTS[tok[i]]) {
              rule.rejectWith += (rule.rejectWith ? ' ' : '') + tok[i];
              i++;
            }
          }
          break;
        default:
          if (NFT_VERDICTS[t]) { rule.target = NFT_VERDICTS[t]; i++; break; }
          rule.unmodelled.push(t);
          i++;
          break;
      }
    }
  }

  function parseNft(text) {
    var m = newModel('nftables');
    var lines = text.split(/\r?\n/);
    var chain = null, tableName = null;
    var i, lineNo, line, mm, rule;

    for (i = 0; i < lines.length; i++) {
      lineNo = i + 1;
      line = trimText(lines[i]);
      if (!line) continue;
      if (line.charAt(0) === '#') continue;
      line = line.replace(/\{([^{}]*)\}/g, function (whole, inner) {
        return '{' + inner.replace(/\s+/g, '') + '}';
      });

      if (line === '}') {
        if (chain) chain = null;
        else tableName = null;
        continue;
      }

      mm = /^table\s+(\S+)(?:\s+(\S+))?\s*\{$/.exec(line);
      if (mm) {
        if (mm[2]) { m.tables[mm[1]] = true; tableName = mm[2]; }
        else { m.tables['ip'] = true; tableName = mm[1]; }
        if (mm[2] === undefined) pushNote(m, 'No address family on the table line, so it was read as the ip family.');
        if (mm[1] === 'inet' || mm[1] === 'ip6') {
          pushNote(m, 'The table family is ' + mm[1] + ', which covers IPv6 too. This model only evaluates IPv4 packets.');
        }
        if (mm[1] === 'nat' || mm[2] === 'nat') {
          pushNote(m, 'A nat table is present. Address translation is not modelled here, so those chains decide nothing.');
        }
        continue;
      }

      mm = /^chain\s+(\S+)\s*\{$/.exec(line);
      if (mm) {
        chain = ensureChain(m, mm[1]);
        chain.base = false;
        chain.policy = null;
        continue;
      }

      mm = /^type\s+(\S+)\s+hook\s+(\S+)\s+(?:device\s+\S+\s+)?priority\s+([^;]+);(?:\s*policy\s+(\w+)\s*;?)?/.exec(line);
      if (mm) {
        if (!chain) {
          m.unparsed.push({ line: lineNo, text: line, why: 'a type/hook line outside any chain' });
          continue;
        }
        chain.base = true;
        chain.hook = mm[2];
        chain.policy = mm[4] ? mm[4].toUpperCase() : 'ACCEPT';
        chain.policyStated = !!mm[4];
        if (mm[1] !== 'filter') {
          pushNote(m, 'Chain ' + chain.name + ' has type ' + mm[1] + '. Only filter-type chains are modelled.');
        }
        continue;
      }

      mm = /^policy\s+(\w+)\s*;?$/.exec(line);
      if (mm && chain) {
        chain.policy = mm[1].toUpperCase();
        chain.base = true;
        chain.policyStated = true;
        continue;
      }

      if (!chain) {
        m.unparsed.push({ line: lineNo, text: line, why: 'a rule outside any chain block' });
        continue;
      }
      if (m.ruleCount >= MAX_RULES) {
        pushNote(m, 'Stopped after ' + MAX_RULES + ' rules. Everything past line ' + lineNo + ' was not read.');
        break;
      }
      rule = newRule(m, chain.name, lineNo, trimText(lines[i]));
      parseNftRule(line.replace(/;\s*$/, ''), rule, m);
      chain.rules.push(rule);
      m.ruleCount++;
    }
    renumber(m);
    return m;
  }

  function detectSyntax(text) {
    if (/^\s*table\s+\S+/m.test(text) || /^\s*chain\s+\S+\s*\{/m.test(text)) return 'nft';
    if (/^\s*[*:]/m.test(text) || /(^|\s)-A\s+\S+/.test(text) ||
        /(^|\s)-P\s+\S+/.test(text) || /(^|\s)-I\s+\S+/.test(text)) return 'ipt';
    return null;
  }

  /* ======================================================================
     Matching one rule against one packet.

     Every condition is reported, matched or not. A rule carrying a match this
     model does not implement is reported as NOT matching, and says so: the
     alternative is to silently ignore the restriction and claim a rule fires
     when the real kernel might skip it, which is the worst possible answer
     from a tool people use to check a firewall.
     ====================================================================== */
  function checkDim(dim, kind, value, valueText, label, conds) {
    if (!dim) return true;
    var hit = dimHit(dim, value);
    var ok = dim.neg ? !hit : !!hit;
    var text;
    if (dim.neg) {
      text = label + ' ' + valueText + (hit
        ? ' is inside ' + dim.text + ', which the negated match excludes'
        : ' is outside ' + dim.text + ', and the match is negated');
    } else {
      text = label + ' ' + valueText + (hit
        ? ' matches ' + (hit.text !== undefined ? hit.text : hit)
        : ' is not in ' + dim.text);
    }
    conds.push({ ok: ok, text: text });
    return ok;
  }

  function testRule(rule, pkt, hook) {
    var conds = [];
    var ok = true;

    if (!checkDim(rule.proto, 'name', pkt.proto, pkt.proto, 'protocol', conds)) ok = false;
    if (!checkDim(rule.src, 'range', pkt.saddrNum, pkt.saddr, 'source', conds)) ok = false;
    if (!checkDim(rule.dst, 'range', pkt.daddrNum, pkt.daddr, 'destination', conds)) ok = false;

    if (rule.sport || rule.dport) {
      if (pkt.proto !== 'tcp' && pkt.proto !== 'udp' && pkt.proto !== 'sctp') {
        conds.push({ ok: false, text: 'this rule matches on a port and the packet is ' + pkt.proto + ', which has none' });
        ok = false;
      } else {
        if (!checkDim(rule.sport, 'range', pkt.sport, String(pkt.sport), 'source port', conds)) ok = false;
        if (!checkDim(rule.dport, 'range', pkt.dport, String(pkt.dport), 'destination port', conds)) ok = false;
      }
    }

    /* netfilter refuses an -o match in INPUT and an -i match in OUTPUT at the
       moment you add the rule, because at those hooks the other interface does
       not exist yet or no longer does. Configs written by hand still carry
       them, so the rule is kept and reported rather than dropped. */
    if (rule.oif && hook === 'input') {
      conds.push({ ok: false, text: 'an out-interface match in an input hook can never match; netfilter refuses to add this rule at all' });
      ok = false;
    } else if (!checkDim(rule.oif, 'iface', pkt.oif, pkt.oif || 'none given', 'out-interface', conds)) {
      ok = false;
    }
    if (rule.iif && hook === 'output') {
      conds.push({ ok: false, text: 'an in-interface match in an output hook can never match; netfilter refuses to add this rule at all' });
      ok = false;
    } else if (!checkDim(rule.iif, 'iface', pkt.iif, pkt.iif || 'none given', 'in-interface', conds)) {
      ok = false;
    }

    if (!checkDim(rule.ctstate, 'name', pkt.ctstate, pkt.ctstate, 'ct state', conds)) ok = false;

    if (rule.unmodelled.length) {
      conds.push({
        ok: false,
        text: 'this rule also matches on ' + rule.unmodelled.join(', ') +
              ', which this model does not implement, so it is treated as not matching'
      });
      ok = false;
    }
    if (!conds.length) conds.push({ ok: true, text: 'no match conditions, so this rule matches every packet' });
    return { matched: ok, conds: conds };
  }

  /* ======================================================================
     The walk.

     An explicit frame stack rather than recursion, because jump and goto
     differ only in what they do to the stack: jump pushes the target on top of
     the current frame, so the packet comes back here afterwards; goto replaces
     the current frame, so when the target ends the packet returns to whoever
     called THIS chain and never comes back. That distinction is invisible in a
     recursive version and it is the whole difference between the two.
     ====================================================================== */
  function walk(startChain, pkt) {
    var steps = [];
    var stack = [{ chain: startChain, idx: 0 }];
    var entered = {};
    var tested = 0;
    var verdict = null;
    var fr, chain, rule, res, t;

    entered[startChain] = 1;

    while (stack.length) {
      fr = stack[stack.length - 1];
      chain = model.chains[fr.chain];
      if (!chain) {
        steps.push({ kind: 'error', text: 'chain ' + fr.chain + ' is jumped to but never defined' });
        break;
      }
      if (fr.idx >= chain.rules.length) {
        steps.push({ kind: 'end', chain: fr.chain });
        stack.pop();
        if (stack.length) steps.push({ kind: 'resume', chain: stack[stack.length - 1].chain });
        continue;
      }
      rule = chain.rules[fr.idx];
      fr.idx++;
      tested++;
      /* Two brakes, because they stop different things. The step counter bounds
         a ruleset that is simply enormous; the per-chain entry count catches a
         cycle, which no total ever will — A jumps to B, B jumps back to A, and
         the walk would print the same four lines until the tab gave up.
         netfilter refuses to load a loop, but a hand-written config pasted here
         has never been through that check. */
      if (tested > MAX_STEPS) {
        steps.push({ kind: 'error', text: 'stopped after testing ' + MAX_STEPS + ' rules; this ruleset is larger than the walk will print' });
        break;
      }
      res = testRule(rule, pkt, pkt.hook);
      steps.push({ kind: 'rule', chain: fr.chain, rule: rule, res: res });
      if (!res.matched) continue;

      t = rule.target;
      if (t === 'ACCEPT' || t === 'DROP' || t === 'REJECT') {
        verdict = { action: t, rule: rule, chain: fr.chain };
        break;
      }
      if (t === 'RETURN') {
        stack.pop();
        steps.push({ kind: 'return', chain: fr.chain });
        if (stack.length) steps.push({ kind: 'resume', chain: stack[stack.length - 1].chain });
        continue;
      }
      if (t === 'JUMP' || t === 'GOTO') {
        if (!model.chains[rule.jumpTo] || !model.chains[rule.jumpTo].rules) {
          steps.push({ kind: 'error', text: 'jump to ' + rule.jumpTo + ', which is not defined in this ruleset' });
          break;
        }
        entered[rule.jumpTo] = (entered[rule.jumpTo] || 0) + 1;
        if (entered[rule.jumpTo] > MAX_HOPS) {
          steps.push({
            kind: 'error',
            text: 'chain ' + rule.jumpTo + ' has been entered ' + MAX_HOPS +
                  ' times, so these chains loop. netfilter refuses to load a loop; ' +
                  'this one only exists because the text was pasted here rather than applied.'
          });
          break;
        }
        if (t === 'GOTO') stack.pop();
        stack.push({ chain: rule.jumpTo, idx: 0 });
        steps.push({ kind: 'jump', to: rule.jumpTo, how: t });
        continue;
      }
      steps.push({ kind: 'noop', text: rule.note || 'no verdict on this rule, so the packet carries on to the next one' });
    }

    if (!verdict) {
      var base = model.chains[startChain];
      verdict = {
        action: (base && base.policy) || 'ACCEPT',
        policy: true,
        chain: startChain,
        assumed: !(base && base.policy)
      };
    }
    return { steps: steps, verdict: verdict };
  }

  /* ======================================================================
     Conntrack — a dictionary with two tuples and one flag.
     ====================================================================== */
  function flowKey(proto, sa, sp, da, dp) {
    return proto + '|' + sa + ':' + sp + '>' + da + ':' + dp;
  }

  function origKey(p) { return flowKey(p.proto, p.saddr, p.sport, p.daddr, p.dport); }
  function backKey(p) { return flowKey(p.proto, p.daddr, p.dport, p.saddr, p.sport); }

  /* Derived, never guessed at.

     One detail that surprises people and is correct: a second packet in the
     ORIGINAL direction, before any reply has come back, is still NEW. netfilter
     only sets the seen-reply bit once traffic has travelled both ways, and
     ESTABLISHED means exactly that bit. */
  function deriveState(pkt) {
    var ok = origKey(pkt), bk = backKey(pkt), e;
    if (track[ok]) {
      e = track[ok];
      return { state: e.seenReply ? 'ESTABLISHED' : 'NEW', entry: e, dir: 'original' };
    }
    if (track[bk]) {
      return { state: 'ESTABLISHED', entry: track[bk], dir: 'reply' };
    }
    if (pkt.proto === 'icmp') {
      var found = null;
      trackOrder.forEach(function (k) {
        var t = track[k];
        if (!t) return;
        if ((t.saddr === pkt.daddr && t.daddr === pkt.saddr) ||
            (t.saddr === pkt.saddr && t.daddr === pkt.daddr)) found = t;
      });
      if (found) return { state: 'RELATED', entry: found, dir: 'related' };
    }
    return { state: 'NEW', entry: null, dir: 'original' };
  }

  /* The entry is created on ACCEPT and not before, which is close to what the
     kernel does: nf_conntrack_confirm runs at the end of the hook, so a packet
     that gets dropped never leaves a confirmed entry behind. It is the reason
     a rejected inbound SYN does not open a hole for anything after it. */
  function confirm(pkt, ctInfo) {
    if (ctInfo.dir === 'reply' && ctInfo.entry) {
      if (!ctInfo.entry.seenReply) {
        ctInfo.entry.seenReply = true;
        return { changed: 'reply', entry: ctInfo.entry };
      }
      return { changed: null, entry: ctInfo.entry };
    }
    if (ctInfo.dir === 'related') return { changed: null, entry: ctInfo.entry };
    var key = origKey(pkt);
    if (track[key]) return { changed: null, entry: track[key] };
    if (trackOrder.length >= MAX_CT) {
      var oldest = trackOrder.shift();
      delete track[oldest];
    }
    ctSeq++;
    track[key] = {
      key: key, proto: pkt.proto, saddr: pkt.saddr, sport: pkt.sport,
      daddr: pkt.daddr, dport: pkt.dport, seenReply: false, seq: ctSeq,
      chain: pkt.chain
    };
    trackOrder.push(key);
    return { changed: 'created', entry: track[key] };
  }

  function flowText(e) {
    var ports = (e.proto === 'tcp' || e.proto === 'udp' || e.proto === 'sctp');
    return e.proto + '  ' + e.saddr + (ports ? ':' + e.sport : '') + ' > ' +
           e.daddr + (ports ? ':' + e.dport : '');
  }

  /* ======================================================================
     Rendering.
     ====================================================================== */
  function ruleLine(rule) {
    return pad(rule.n, 3) + '  ' + rule.text;
  }

  function packetText(p) {
    var ports = (p.proto === 'tcp' || p.proto === 'udp' || p.proto === 'sctp');
    return p.proto + '  ' + p.saddr + (ports ? ':' + p.sport : '') + '  ->  ' +
           p.daddr + (ports ? ':' + p.dport : '');
  }

  function renderWalk(pkt) {
    var chain = model.chains[pkt.chain];
    if (!chain) { out.err('There is no chain named ' + pkt.chain + ' in this ruleset.'); return null; }

    out.heading('Packet');
    out.row('chain', pkt.chain + (chain.hook ? '  (hook ' + chain.hook + ')' : '  (user chain)'));
    out.row('flow', packetText(pkt));
    out.row('interfaces', 'in=' + (pkt.iif || 'none') + '  out=' + (pkt.oif || 'none'));
    out.row('ct state', pkt.ctstate + (pkt.ctForced ? '  (you chose this)' : '  (from the conntrack table below)'));
    out.rule();

    var result = walk(pkt.chain, pkt);
    var i, s, j;
    out.heading('Chain ' + pkt.chain + (chain.policy ? '  policy ' + chain.policy : ''));
    for (i = 0; i < result.steps.length; i++) {
      s = result.steps[i];
      if (s.kind === 'rule') {
        out.line(ruleLine(s.rule), s.res.matched ? 't-ok' : 't-dim');
        for (j = 0; j < s.res.conds.length; j++) {
          out.line('       ' + (s.res.conds[j].ok ? 'yes  ' : 'no   ') + s.res.conds[j].text,
                   s.res.conds[j].ok ? 't-dim' : 't-warn');
        }
        if (s.res.matched && s.rule.target !== 'CONTINUE') {
          out.line('       -> ' + verdictWord(s.rule), 't-ok');
        }
      } else if (s.kind === 'jump') {
        out.line('       entering chain ' + s.to + ' by ' + s.how.toLowerCase(), 't-info');
        var sub = model.chains[s.to];
        out.heading('Chain ' + s.to + (sub && sub.rules.length ? '' : '  (no rules)'));
      } else if (s.kind === 'return') {
        out.line('       return: leaving ' + s.chain + ' without a verdict', 't-info');
      } else if (s.kind === 'end') {
        out.line('       end of chain ' + s.chain, 't-info');
      } else if (s.kind === 'resume') {
        out.heading('Chain ' + s.chain + '  (carrying on where the jump left off)');
      } else if (s.kind === 'noop') {
        out.line('       ' + s.text, 't-dim');
      } else if (s.kind === 'error') {
        out.err('       ' + s.text);
      }
    }

    out.rule();
    var v = result.verdict;
    if (v.policy) {
      out.warn('No rule matched. The packet fell off the end of ' + v.chain + '.');
      if (chain.base) {
        out.line('Decision: ' + v.action + ' by the ' + v.chain + ' chain policy', v.action === 'ACCEPT' ? 't-ok' : 't-err');
        if (v.assumed) out.dim('The ruleset never states a policy for this chain, so ACCEPT was assumed.');
      } else {
        out.line('Decision: ' + v.action, 't-warn');
        out.dim(v.chain + ' is a user chain, so in a real ruleset the packet would');
        out.dim('return to whichever chain jumped into it. Starting the walk here');
        out.dim('means there is nothing to return to, so the walk stops.');
      }
    } else {
      out.line('Decision: ' + v.action + ' at rule ' + v.rule.n + ' of ' + v.chain,
               v.action === 'ACCEPT' ? 't-ok' : 't-err');
      out.dim('       ' + v.rule.text);
    }

    out.line('');
    renderConsequence(v, pkt);
    return { result: result, verdict: v };
  }

  function verdictWord(rule) {
    if (rule.target === 'JUMP') return 'jump to ' + rule.jumpTo;
    if (rule.target === 'GOTO') return 'goto ' + rule.jumpTo + ' (no return to this chain)';
    if (rule.target === 'REJECT') return 'REJECT' + (rule.rejectWith ? ' with ' + rule.rejectWith : '');
    if (rule.target === 'CONTINUE') return rule.note || 'no verdict; carry on';
    return rule.target;
  }

  /* DROP against REJECT is the single most consequential one-word choice in a
     ruleset, so it gets said in full every time rather than being left to the
     reader to remember. */
  function renderConsequence(v, pkt) {
    out.heading('What the other end sees');
    if (v.action === 'ACCEPT') {
      out.ok('The packet is delivered. For TCP the handshake continues normally.');
      return;
    }
    if (v.action === 'DROP') {
      out.err('Nothing. DROP is silence: no ICMP error, no TCP reset, no reply of');
      out.err('any kind. The client has to wait out its own timeout before it');
      out.err('gives up, which on a Linux client with default SYN retries is');
      out.err('roughly two minutes.');
      out.line('');
      out.dim('That silence is the argument for DROP: a port scanner has to wait');
      out.dim('for every closed port instead of being told instantly, so a sweep');
      out.dim('of your address costs it real time. It is also the argument');
      out.dim('against: when the thing hanging is your own deployment, silence');
      out.dim('gives you nothing to read, and a hung connection looks identical');
      out.dim('to a routing problem, a dead host and a wrong port.');
      return;
    }
    var stated = (v.rule && v.rule.rejectWith) || '';
    var how = String(stated).toLowerCase();
    var reset = how.indexOf('reset') >= 0 || how.indexOf('rst') >= 0;
    out.warn('An immediate refusal. ' + (reset
      ? 'A TCP RST goes back, so the client reports the connection as refused straight away.'
      : 'An ICMP destination-unreachable goes back, so the client reports the connection as refused straight away.'));
    out.line('');
    out.dim('REJECT is friendlier to everyone, including whoever is scanning you.');
    out.dim('The refusal is itself an answer: it confirms a host is there, that it');
    out.dim('is reachable, and that something is deciding. DROP leaves all three');
    out.dim('unanswered. The usual compromise is REJECT inside a network you');
    out.dim('operate, where fast failure is worth more than concealment, and DROP');
    out.dim('at the edge.');
    if (!stated) {
      out.line('');
      out.dim('This rule does not say what to reject with. iptables defaults to');
      out.dim('icmp-port-unreachable; the nft default depends on the family.');
    }
  }

  function renderConntrack() {
    out.heading('conntrack table');
    if (!trackOrder.length) {
      out.dim('Empty. Send a packet that gets accepted and an entry appears here.');
      return;
    }
    out.row('entries', trackOrder.length + ' of ' + MAX_CT);
    trackOrder.forEach(function (k) {
      var e = track[k];
      if (!e) return;
      out.line('  ' + flowText(e) + '   ' + (e.seenReply ? 'ESTABLISHED (reply seen)' : 'NEW (no reply yet)'),
               e.seenReply ? 't-ok' : 't-warn');
    });
    out.line('');
    out.dim('This is a dictionary, not a kernel subsystem. No timeouts, no TCP');
    out.dim('state machine, no protocol helpers, and entries live until you');
    out.dim('flush them or the tab is closed.');
  }

  /* ======================================================================
     Analysis: shadowing, redundancy and the traps.
     ====================================================================== */
  function terminalHere(rule) {
    var t = rule.target;
    return t === 'ACCEPT' || t === 'DROP' || t === 'REJECT' || t === 'RETURN' || t === 'GOTO';
  }

  function coversRule(a, b) {
    var i;
    for (i = 0; i < DIMS.length; i++) {
      if (!dimCovers(a[DIMS[i]], b[DIMS[i]])) return false;
    }
    return true;
  }

  function coveringDims(a, b) {
    var list = [];
    DIMS.forEach(function (d) {
      if (a[d] && b[d]) list.push(DIM_LABEL[d] + ' ' + describeDim(b[d]) + ' inside ' + describeDim(a[d]));
    });
    return list;
  }

  function renderAnalysis() {
    var m = model;
    var findings = 0;

    out.heading('Rules that can never fire');
    m.order.forEach(function (name) {
      var chain = m.chains[name];
      var rules = chain.rules;
      var i, j, a, b, same;
      for (j = 0; j < rules.length; j++) {
        b = rules[j];
        for (i = 0; i < j; i++) {
          a = rules[i];
          /* A rule carrying a match this model does not implement is narrower
             in reality than the space computed here, so it is never allowed to
             be the covering rule. It can still be the covered one: an extra
             match only ever narrows, so a rule already covered stays covered
             however many conditions are stacked on it. */
          if (a.unmodelled.length) continue;
          if (!terminalHere(a)) continue;
          if (!coversRule(a, b)) continue;
          findings++;
          same = a.target === b.target && a.jumpTo === b.jumpTo;
          out.line('');
          out.err(name + ' rule ' + b.n + ' can never match.');
          out.dim('   ' + ruleLine(b));
          out.dim('   covered by rule ' + a.n + ':');
          out.dim('   ' + ruleLine(a));
          var why = coveringDims(a, b);
          if (why.length) why.forEach(function (t) { out.dim('   - ' + t); });
          else out.dim('   - rule ' + a.n + ' has no match conditions at all, so it catches everything');
          if (same) {
            out.warn('   Same verdict, so nothing behaves differently. The rule is dead');
            out.warn('   weight that reads as though it does something.');
          } else if ((a.target === 'DROP' || a.target === 'REJECT') && b.target === 'ACCEPT') {
            out.err('   Rule ' + a.n + ' ' + a.target.toLowerCase() + 's this traffic first, so the ACCEPT below');
            out.err('   it never runs. Whatever rule ' + b.n + ' was meant to open is closed.');
            out.err('   Move it above rule ' + a.n + '.');
          } else if (a.target === 'RETURN' || a.target === 'GOTO') {
            out.warn('   Rule ' + a.n + ' leaves this chain first, so rule ' + b.n + ' is never reached');
            out.warn('   on this path.');
          } else {
            out.warn('   The verdicts differ, so the ruleset does not do what rule ' +
                     b.n + ' says.');
          }
          break;
        }
      }
    });
    if (!findings) out.ok('None found in the dimensions this tool compares.');
    out.line('');
    out.dim('Containment only, over protocol, addresses, ports, interfaces and ct');
    out.dim('state. Two ranges are never merged before comparing, so a rule');
    out.dim('covered by the union of two earlier rules is not reported. The check');
    out.dim('misses shadows; it does not invent them.');

    out.rule();
    out.heading('Other things worth knowing');
    var warned = 0;

    m.order.forEach(function (name) {
      var chain = m.chains[name];
      var i, r;
      for (i = 0; i < chain.rules.length; i++) {
        r = chain.rules[i];
        if (r.oif && chain.hook === 'input') {
          warned++;
          out.err(name + ' rule ' + r.n + ' matches an out-interface in an input hook.');
          out.dim('   ' + ruleLine(r));
          out.dim('   There is no outgoing interface at the input hook. netfilter');
          out.dim('   refuses this rule when you add it, so a config carrying it');
          out.dim('   never loaded cleanly in the first place.');
        }
        if (r.iif && chain.hook === 'output') {
          warned++;
          out.err(name + ' rule ' + r.n + ' matches an in-interface in an output hook.');
          out.dim('   ' + ruleLine(r));
          out.dim('   Same problem the other way round; netfilter refuses it.');
        }
        if ((r.target === 'JUMP' || r.target === 'GOTO') &&
            (!m.chains[r.jumpTo] || (!m.chains[r.jumpTo].rules.length && !m.chains[r.jumpTo].base))) {
          if (!m.chains[r.jumpTo]) {
            warned++;
            out.err(name + ' rule ' + r.n + ' jumps to ' + r.jumpTo + ', which is not defined here.');
          }
        }
        if (r.unmodelled.length) {
          warned++;
          out.warn(name + ' rule ' + r.n + ' uses ' + r.unmodelled.join(', ') + '.');
          out.dim('   ' + ruleLine(r));
          out.dim('   Not implemented by this model, so the walk treats the rule as');
          out.dim('   not matching, and the shadowing check refuses to treat it');
          out.dim('   as covering anything. On a real host it may well match.');
        }
      }
    });

    m.order.forEach(function (name) {
      var chain = m.chains[name];
      if (!chain.base) {
        if (!chain.referenced) {
          warned++;
          out.warn('Chain ' + name + ' is never jumped to, so none of its ' +
                   chain.rules.length + ' rules can run.');
        }
        return;
      }
      var hasEstablished = false, hasCatchAll = false, hasAccept = false, i, r;
      for (i = 0; i < chain.rules.length; i++) {
        r = chain.rules[i];
        if (r.target === 'ACCEPT') hasAccept = true;
        if (r.ctstate && !r.ctstate.neg && r.target === 'ACCEPT' &&
            r.ctstate.items.indexOf('ESTABLISHED') >= 0) hasEstablished = true;
        if (!r.proto && !r.src && !r.dst && !r.sport && !r.dport && !r.iif &&
            !r.oif && !r.ctstate && !r.unmodelled.length && terminalHere(r)) hasCatchAll = true;
      }
      /* Only worth saying about a chain that is trying to allow something. A
         FORWARD chain whose whole content is "-j DROP" is not missing a state
         rule; it is deliberately switched off, and warning about it would be
         the sort of noise that teaches people to skim the report. */
      if (chain.policy === 'DROP' && !hasEstablished && hasAccept) {
        warned++;
        out.warn('Chain ' + name + ' has policy DROP and no rule that accepts');
        out.dim('   ESTABLISHED traffic. Every reply to a connection this host');
        out.dim('   started will be dropped, so outbound connections will hang.');
      }
      if (chain.policy === 'ACCEPT' && !hasCatchAll) {
        warned++;
        out.warn('Chain ' + name + ' has policy ACCEPT and no catch-all rule at the');
        out.dim('   end, so anything none of its rules matched is allowed. That is');
        out.dim('   default-allow, whatever the rules above it say.');
      }
      if (!chain.policyStated) {
        out.dim('Chain ' + name + ' never states a policy; ' + (chain.policy || 'ACCEPT') + ' was assumed.');
      }
    });

    var drops = 0, rejects = 0;
    m.order.forEach(function (name) {
      m.chains[name].rules.forEach(function (r) {
        if (r.target === 'DROP') drops++;
        if (r.target === 'REJECT') rejects++;
      });
      if (m.chains[name].policy === 'DROP') drops++;
    });
    out.line('');
    out.row('DROP verdicts', drops);
    out.row('REJECT verdicts', rejects);
    out.dim('DROP is silence and the client waits out its timeout. REJECT sends an');
    out.dim('ICMP unreachable or a TCP reset and the client fails at once. DROP');
    out.dim('costs a scanner time and costs you the same time when you are the one');
    out.dim('debugging. A REJECT rule is itself an answer: it confirms the host is');
    out.dim('there and that something decided.');

    if (!warned) out.ok('Nothing else stood out.');

    if (m.notes.length) {
      out.rule();
      out.heading('Not modelled');
      m.notes.forEach(function (n) { out.warn(n); });
    }
  }

  function renderParse() {
    var m = model;
    out.heading('Ruleset');
    out.row('syntax', m.syntax);
    out.row('chains', m.order.length);
    out.row('rules loaded', m.ruleCount);
    out.row('lines not understood', m.unparsed.length);
    out.line('');
    m.order.forEach(function (name) {
      var c = m.chains[name];
      out.row('  ' + name, c.rules.length + ' rules   ' +
        (c.base ? 'base chain, hook ' + (c.hook || 'unknown') + ', policy ' + (c.policy || 'ACCEPT')
                : 'user chain' + (c.referenced ? '' : ', never jumped to')));
    });

    if (m.unparsed.length) {
      out.rule();
      out.heading('Lines this parser could not read');
      out.dim('Reported rather than skipped. An unparsed rule is the one that will');
      out.dim('surprise you, so none of these are in the walk or the analysis.');
      out.line('');
      m.unparsed.forEach(function (u) {
        out.err('  line ' + u.line + ': ' + u.text);
        out.dim('           ' + u.why);
      });
    }
  }

  /* ======================================================================
     Reading the form.
     ====================================================================== */
  function fieldValue(id) { var n = el(id); return n ? trimText(n.value) : ''; }

  function readPacket() {
    var proto = fieldValue('fw-proto') || 'tcp';
    var chain = fieldValue('fw-chain');
    var saddr = fieldValue('fw-saddr');
    var daddr = fieldValue('fw-daddr');
    var sport = fieldValue('fw-sport');
    var dport = fieldValue('fw-dport');
    var forced = fieldValue('fw-ctstate');

    if (!model) { out.err('Parse a ruleset first.'); return null; }
    if (!chain) { out.err('Pick a chain to send the packet into.'); return null; }
    var sn = ip2num(saddr), dn = ip2num(daddr);
    if (sn === null) { out.err('Source address "' + saddr + '" is not a dotted IPv4 address. This model is IPv4 only.'); return null; }
    if (dn === null) { out.err('Destination address "' + daddr + '" is not a dotted IPv4 address. This model is IPv4 only.'); return null; }

    var sp = parseInt(sport, 10);
    var dp = parseInt(dport, 10);
    var hasPorts = (proto === 'tcp' || proto === 'udp' || proto === 'sctp');
    if (hasPorts) {
      if (!(sp >= 0 && sp <= 65535)) { out.err('Source port "' + sport + '" is not a port number.'); return null; }
      if (!(dp >= 0 && dp <= 65535)) { out.err('Destination port "' + dport + '" is not a port number.'); return null; }
    } else {
      sp = 0; dp = 0;
    }

    var c = model.chains[chain];
    var pkt = {
      chain: chain, hook: c ? c.hook : null, proto: proto,
      saddr: saddr, saddrNum: sn, sport: sp,
      daddr: daddr, daddrNum: dn, dport: dp,
      iif: fieldValue('fw-iif'), oif: fieldValue('fw-oif'),
      ctstate: 'NEW', ctForced: false
    };
    var info = deriveState(pkt);
    if (forced && forced !== 'auto') {
      pkt.ctstate = forced;
      pkt.ctForced = true;
      pkt.ctInfo = info;
    } else {
      pkt.ctstate = info.state;
      pkt.ctInfo = info;
    }
    return pkt;
  }

  function writePacket(p) {
    var set = function (id, v) { var n = el(id); if (n) n.value = v; };
    set('fw-chain', p.chain);
    set('fw-proto', p.proto);
    set('fw-saddr', p.saddr);
    set('fw-sport', p.sport);
    set('fw-daddr', p.daddr);
    set('fw-dport', p.dport);
    set('fw-iif', p.iif);
    set('fw-oif', p.oif);
    set('fw-ctstate', 'auto');
  }

  function chainForHook(hook) {
    var found = null;
    model.order.forEach(function (name) {
      if (!found && model.chains[name].base && model.chains[name].hook === hook) found = name;
    });
    return found;
  }

  /* ======================================================================
     Actions.
     ====================================================================== */
  function parseNow(quiet) {
    var text = el('tool-in') ? el('tool-in').value : '';
    if (text.length > MAX_INPUT) {
      out.clear().err('That ruleset is ' + LabTool.humanBytes(text.length) + '. This tool stops at ' +
        LabTool.humanBytes(MAX_INPUT) + ' so the page stays responsive; the work happens in this tab.');
      setStatus('too large', 'is-err');
      return false;
    }
    if (!trimText(text)) {
      if (!quiet) out.clear().warn('Paste a ruleset, or load one of the examples.');
      setStatus('nothing to parse', 'is-err');
      return false;
    }
    var want = fieldValue('fw-syntax') || 'auto';
    var syntax = want === 'auto' ? detectSyntax(text) : want;
    if (!syntax) {
      if (!quiet) {
        out.clear().err('I cannot tell whether that is iptables or nftables.');
        out.dim('iptables-save output has *filter, :INPUT and -A lines. nftables');
        out.dim('output has table and chain blocks with braces. Pick one from the');
        out.dim('syntax menu to force it.');
      }
      setStatus('syntax not recognised', 'is-err');
      return false;
    }
    try {
      model = syntax === 'nft' ? parseNft(text) : parseIptables(text);
    } catch (err) {
      out.clear().err('That ruleset could not be parsed: ' + ((err && err.message) || String(err)));
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      setStatus('parse failed', 'is-err');
      model = null;
      return false;
    }
    fillChains();
    setStatus(model.ruleCount + ' rules, ' + model.order.length + ' chains' +
      (model.unparsed.length ? ', ' + model.unparsed.length + ' lines not read' : ''),
      model.unparsed.length ? 'is-busy' : 'is-ok');
    return true;
  }

  function fillChains() {
    var sel = el('fw-chain');
    if (!sel || !model) return;
    var previous = sel.value;
    sel.innerHTML = '';
    var add = function (name, label) {
      var o = document.createElement('option');
      o.value = name;
      o.textContent = label;
      sel.appendChild(o);
    };
    model.order.forEach(function (name) {
      var c = model.chains[name];
      if (c.base) add(name, name + ' (hook ' + (c.hook || '?') + ', policy ' + (c.policy || 'ACCEPT') + ')');
    });
    model.order.forEach(function (name) {
      var c = model.chains[name];
      if (!c.base) add(name, name + ' (user chain)');
    });
    if (!sel.options.length) add('', 'no chains found');
    var i;
    for (i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === previous) { sel.value = previous; return; }
    }
    var preferred = chainForHook('input');
    if (preferred) sel.value = preferred;
  }

  function runAnalyse() {
    out.clear();
    if (!parseNow(false)) return;
    renderParse();
    out.rule();
    renderAnalysis();
    out.rule();
    out.dim('This is a simulator over a model of netfilter, not netfilter. No NAT');
    out.dim('table, no mangle, no raw, no rate limiting, no ipset, no reverse-path');
    out.dim('filtering, no packet marks, no IPv6, and conntrack is a dictionary.');
  }

  function sendPacket() {
    out.clear();
    if (!model && !parseNow(false)) return;
    var pkt = readPacket();
    if (!pkt) return;
    var res = renderWalk(pkt);
    if (!res) return;
    lastPacket = pkt;
    if (res.verdict.action === 'ACCEPT' && !pkt.ctForced) {
      var change = confirm(pkt, pkt.ctInfo);
      out.line('');
      out.heading('conntrack');
      if (change.changed === 'created') {
        out.ok('New entry: ' + flowText(change.entry) + '   NEW (no reply yet)');
        out.dim('Created because the packet was accepted. A dropped packet leaves');
        out.dim('no confirmed entry behind, which is why a rejected inbound SYN');
        out.dim('does not open anything for what follows it.');
      } else if (change.changed === 'reply') {
        out.ok('Entry updated: ' + flowText(change.entry) + '   ESTABLISHED (reply seen)');
        out.dim('The flow has now been seen in both directions, so from here on');
        out.dim('both directions match ct state ESTABLISHED.');
      } else {
        out.dim('No change; this flow was already tracked.');
      }
    } else if (pkt.ctForced) {
      out.line('');
      out.dim('You set the ct state by hand, so the conntrack table was left alone.');
    }
    setStatus('decision: ' + res.verdict.action, res.verdict.action === 'ACCEPT' ? 'is-ok' : 'is-err');
  }

  function sendReply() {
    out.clear();
    if (!lastPacket) { out.warn('Send a packet first; the reply is built from it.'); return; }
    var p = lastPacket;
    var hook = p.hook === 'input' ? 'output' : (p.hook === 'output' ? 'input' : p.hook);
    var chain = hook === p.hook ? p.chain : (chainForHook(hook) || p.chain);
    var reply = {
      chain: chain, hook: model.chains[chain] ? model.chains[chain].hook : hook,
      proto: p.proto,
      saddr: p.daddr, saddrNum: p.daddrNum, sport: p.dport,
      daddr: p.saddr, daddrNum: p.saddrNum, dport: p.sport,
      iif: p.oif, oif: p.iif, ctstate: 'NEW', ctForced: false
    };
    var info = deriveState(reply);
    reply.ctstate = info.state;
    reply.ctInfo = info;
    writePacket(reply);
    out.heading('The reply to the packet you just sent');
    out.dim('Addresses and ports swapped, interfaces swapped, and the chain moved');
    out.dim('to the ' + (reply.hook || 'same') + ' hook.');
    out.line('');
    var res = renderWalk(reply);
    if (!res) return;
    lastPacket = reply;
    if (res.verdict.action === 'ACCEPT') {
      var change = confirm(reply, info);
      out.line('');
      out.heading('conntrack');
      if (change.changed === 'reply') {
        out.ok('Entry updated: ' + flowText(change.entry) + '   ESTABLISHED (reply seen)');
      } else if (change.changed === 'created') {
        out.ok('New entry: ' + flowText(change.entry) + '   NEW (no reply yet)');
      } else {
        out.dim('No change.');
      }
    }
    setStatus('reply decision: ' + res.verdict.action, res.verdict.action === 'ACCEPT' ? 'is-ok' : 'is-err');
  }

  /* The three-packet story. It is the thing people get wrong about firewalls,
     and reading about it is much less convincing than watching the same port
     accept a reply and refuse a fresh connection one line apart. */
  function runDemo() {
    out.clear();
    if (!model && !parseNow(false)) return;
    var outHook = chainForHook('output');
    var inHook = chainForHook('input');
    if (!outHook || !inHook) {
      out.err('This ruleset has no base chain on the ' + (outHook ? 'input' : 'output') + ' hook,');
      out.err('so the stateful walk-through has nowhere to run. Load one of the');
      out.err('examples to see it.');
      return;
    }
    track = {}; trackOrder = []; ctSeq = 0;

    var localIp = '10.0.0.5', remoteIp = '93.184.216.34';
    var localPort = 51000, remotePort = 443;

    out.heading('Stateful matching, in three packets');
    out.dim('The conntrack table was flushed first so this starts from nothing.');
    out.line('');

    var p1 = {
      chain: outHook, hook: 'output', proto: 'tcp',
      saddr: localIp, saddrNum: ip2num(localIp), sport: localPort,
      daddr: remoteIp, daddrNum: ip2num(remoteIp), dport: remotePort,
      iif: '', oif: 'eth0', ctstate: 'NEW', ctForced: false
    };
    p1.ctInfo = deriveState(p1);
    p1.ctstate = p1.ctInfo.state;
    out.heading('1. An outbound connection this host starts');
    var r1 = renderWalk(p1);
    if (r1 && r1.verdict.action === 'ACCEPT') {
      var c1 = confirm(p1, p1.ctInfo);
      out.line('');
      out.ok('conntrack entry created: ' + flowText(c1.entry) + '   NEW (no reply yet)');
    } else {
      out.line('');
      out.warn('This ruleset did not accept the outbound packet, so no entry exists');
      out.warn('and the rest of the walk-through will not show what it is meant to.');
    }

    out.rule();
    var p2 = {
      chain: inHook, hook: 'input', proto: 'tcp',
      saddr: remoteIp, saddrNum: ip2num(remoteIp), sport: remotePort,
      daddr: localIp, daddrNum: ip2num(localIp), dport: localPort,
      iif: 'eth0', oif: '', ctstate: 'NEW', ctForced: false
    };
    p2.ctInfo = deriveState(p2);
    p2.ctstate = p2.ctInfo.state;
    out.heading('2. The reply coming back to that same port');
    var r2 = renderWalk(p2);
    if (r2 && r2.verdict.action === 'ACCEPT') {
      var c2 = confirm(p2, p2.ctInfo);
      out.line('');
      out.ok('conntrack entry updated: ' + flowText(c2.entry) + '   ESTABLISHED (reply seen)');
    }

    out.rule();
    var p3 = {
      chain: inHook, hook: 'input', proto: 'tcp',
      saddr: '198.51.100.23', saddrNum: ip2num('198.51.100.23'), sport: 40000,
      daddr: localIp, daddrNum: ip2num(localIp), dport: localPort,
      iif: 'eth0', oif: '', ctstate: 'NEW', ctForced: false
    };
    p3.ctInfo = deriveState(p3);
    p3.ctstate = p3.ctInfo.state;
    out.heading('3. Somebody else opening a fresh connection to that same port');
    var r3 = renderWalk(p3);

    out.rule();
    out.heading('The point');
    out.dim('Packet 2 and packet 3 arrive at the identical local port, ' + localPort + ',');
    out.dim('on the identical interface. Nothing in the ruleset names that port.');
    out.dim('The only thing separating them is the conntrack table: packet 2');
    out.dim('belongs to a flow this host started, so it is ESTABLISHED and the');
    out.dim('established rule takes it. Packet 3 belongs to no flow, so it is NEW');
    out.dim('and falls through to whatever the chain does with strangers.');
    out.line('');
    out.dim('This is what "stateful" buys. Without it you would have to open every');
    out.dim('ephemeral port inbound to make outbound connections work at all,');
    out.dim('which is a firewall in name only.');
    out.line('');
    renderConntrack();
    lastPacket = p3;
    writePacket(p3);
    setStatus('walk-through finished', 'is-ok');
  }

  function flushCt() {
    track = {}; trackOrder = []; ctSeq = 0;
    out.clear();
    out.ok('conntrack table flushed.');
    out.dim('Every flow is forgotten, so the next packet in any direction is NEW.');
    setStatus('conntrack flushed', 'is-ok');
  }

  /* ======================================================================
     Examples. Both are written to contain real mistakes, because a ruleset
     with nothing wrong in it demonstrates nothing.
     ====================================================================== */
  var EX_IPT = [
    '# Example ruleset. It contains several mistakes on purpose.',
    '*filter',
    ':INPUT DROP [0:0]',
    ':FORWARD DROP [0:0]',
    ':OUTPUT ACCEPT [0:0]',
    ':SSHGUARD - [0:0]',
    '-A INPUT -i lo -j ACCEPT',
    '-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT',
    '-A INPUT -p tcp --dport 22 -j SSHGUARD',
    '-A INPUT -p tcp --dport 80 -j ACCEPT',
    '-A INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT',
    '-A INPUT -p tcp --dport 443 -j ACCEPT',
    '-A INPUT -s 10.0.0.0/8 -j DROP',
    '-A INPUT -s 10.10.0.0/16 -p tcp --dport 5432 -j ACCEPT',
    '-A INPUT -p tcp --dport 8080 -o eth0 -j ACCEPT',
    '-A INPUT -p tcp --tcp-flags SYN,RST SYN -j ACCEPT',
    '-A INPUT -p icmp --icmp-type echo-request -j ACCEPT',
    '-A INPUT -j REJECT --reject-with icmp-port-unreachable',
    '-A INPUT -p udp --dport 53 -j ACCEPT',
    '-A SSHGUARD -s 198.51.100.7 -j DROP',
    '-A SSHGUARD -s 203.0.113.0/24 -j RETURN',
    '-A SSHGUARD -j ACCEPT',
    '-A FORWARD -j DROP',
    '-A OUTPUT -j ACCEPT',
    'COMMIT',
    '# The nat table is a different thing entirely and is not modelled here.',
    '-t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080'
  ].join('\n');

  var EX_NFT = [
    '# Example ruleset. It contains several mistakes on purpose.',
    'table inet filter {',
    '  chain input {',
    '    type filter hook input priority 0; policy drop;',
    '    iif lo accept',
    '    ct state established,related accept',
    '    ct state invalid drop',
    '    ip saddr 192.0.2.0/24 tcp dport 22 accept',
    '    tcp dport { 80, 443 } accept',
    '    tcp dport 443 accept',
    '    ip protocol icmp accept',
    '    udp dport 1000-2000 accept',
    '    ip saddr != 10.0.0.0/8 tcp dport 3306 drop',
    '    iifname "eth0" tcp dport 25 limit rate 5/minute accept',
    '    meta nfproto ipv4 fib saddr . iif oif missing drop',
    '    counter',
    '    jump webguard',
    '    reject with icmp type port-unreachable',
    '  }',
    '',
    '  chain webguard {',
    '    ip saddr 198.51.100.0/24 drop',
    '    return',
    '  }',
    '',
    '  chain output {',
    '    type filter hook output priority 0; policy accept;',
    '  }',
    '}'
  ].join('\n');

  function loadExample(text) {
    var node = el('tool-in');
    if (!node) return;
    node.value = text;
    var sel = el('fw-syntax');
    if (sel) sel.value = 'auto';
    runAnalyse();
  }

  /* ======================================================================
     Wiring.
     ====================================================================== */
  function on(id, fn) {
    var node = el(id);
    if (node) node.addEventListener('click', fn);
  }

  function guard(fn) {
    return function () {
      try {
        fn();
      } catch (err) {
        out.rule();
        out.err('Something in that ruleset broke the simulator.');
        out.dim('Whatever printed above is how far it got. Nothing was uploaded and');
        out.dim('nothing else on the page is affected.');
        out.dim('Details: ' + ((err && err.message) || String(err)));
        setStatus('failed', 'is-err');
      }
    };
  }

  LabTool.define({
    id: 'firewallrules',
    run: guard(runAnalyse),
    onReady: function () {
      var input = el('tool-in');
      if (input && !trimText(input.value)) input.value = EX_IPT;
      parseNow(true);

      on('fw-send', guard(sendPacket));
      on('fw-reply', guard(sendReply));
      on('fw-demo', guard(runDemo));
      on('fw-ct', guard(function () { out.clear(); renderConntrack(); }));
      on('fw-flush', guard(flushCt));
      on('fw-ex-ipt', guard(function () { loadExample(EX_IPT); }));
      on('fw-ex-nft', guard(function () { loadExample(EX_NFT); }));

      var syntax = el('fw-syntax');
      if (syntax) syntax.addEventListener('change', guard(function () { parseNow(true); }));

      out.dim('An example iptables ruleset is loaded, with several deliberate');
      out.dim('mistakes in it. Press Analyse to read the parse and the shadowing');
      out.dim('report, or Send packet to walk one packet down the chain.');
      out.line('');
      out.dim('This is a simulator over a model of netfilter, not netfilter itself.');
      out.dim('No NAT, no mangle, no raw, no rate limiting, no ipset, no');
      out.dim('reverse-path filtering, no IPv6, and the conntrack table is a');
      out.dim('dictionary in this tab. Nothing is uploaded and no packet is sent.');
    }
  });
})();

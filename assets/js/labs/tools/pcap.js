/* ==========================================================================
   pcap.js — read a packet capture in this tab and show what it gave away.
   --------------------------------------------------------------------------
   Wireshark is the right tool for real analysis. This is for the ten minutes
   before that: someone hands you a .pcap, you are on a machine you do not
   control, and you need to know whether anything sensitive crossed that wire.
   Uploading a capture to an online analyser is the one move you must not make
   — a capture is other people's traffic, their sessions, their passwords — so
   this parses the file here. No fetch, no XHR, no beacon. Only the bytes the
   visitor dropped in.

   The headline is the cleartext credential scan. Telling somebody that FTP is
   insecure changes nothing; showing them their own password sitting in packet
   412 ends the argument.

   Both container formats are parsed by hand, and each has a trap:

   - Classic pcap stores its magic in the writer's native byte order, so the
     magic IS the endianness flag. Read the first four bytes big-endian:
     a1b2c3d4 means the rest of the file is big-endian, d4c3b2a1 means little.
     The nanosecond variants (a1b23c4d / 4d3cb2a1) differ only in the middle
     two bytes, and getting that wrong silently multiplies every timestamp
     fraction by 1000.
   - PCAPNG's Section Header Block type, 0x0a0d0d0a, is a byte-order
     palindrome — it reads identically from either end, deliberately, so it
     cannot tell you anything. The byte-order magic inside the block is what
     decides, and a single file may contain several sections that disagree.
   - PCAPNG timestamps are a raw 64-bit tick count. The divisor lives in an
     if_tsresol option on the *interface* block, not on the packet, and
     defaults to microseconds when absent. Miss it and every time is wrong by
     a factor of a thousand.
   - IPv4 total-length is frequently 0 in captures taken on the sending host,
     because segmentation offload means the NIC had not built the real packet
     yet. Trusting that field truncates the payload to nothing.

   Two judgement calls worth stating up front. TCP payload is appended per
   direction in capture order, with a sequence-number check that drops pure
   retransmissions and trims overlaps; that is not real reassembly (no
   out-of-order buffering, no reassembly across a missing segment) and the
   output says so when it sees a gap. And the credential scan is deliberately
   line-oriented and capped rather than exhaustive — it is a demonstration of
   what plaintext protocols leak, not an evidence-grade extraction.

   Everything is capped: 50,000 packets dissected, bounded per-flow buffers,
   bounded output. When a cap bites, the report says which one.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MAX_FILE     = 128 * 1024 * 1024;
  var MAX_DISSECT  = 50000;        // packets fully dissected
  var MAX_WALK     = 5000000;      // records walked for counting, hard stop
  var MAX_FLOWS    = 1200;         // TCP directions buffered for the cred scan
  var FLOW_CHARS   = 12288;        // per direction — a login happens early
  var FLOW_BUDGET  = 6 * 1024 * 1024;
  var MAX_CREDS    = 120;
  var MAX_HTTP     = 250;
  var MAX_DNS_KEYS = 400;
  var MAX_CONVS    = 6000;
  var MAX_PAIRS    = 20000;
  var MAX_PKT_LEN  = 4 * 1024 * 1024;   // no honest single packet is this big

  var out = LabTool.out('tool-out');
  var lastBytes = null, lastFile = null;

  /* ======================================================================
     Byte and text helpers
     ====================================================================== */

  /* Latin-1, chunked. String.fromCharCode.apply blows the argument stack
     somewhere around 100k arguments, and payloads are not text anyway — we
     want one JS char per byte so offsets stay honest. */
  function ascii(b, start, end) {
    var text = '', i = start;
    if (end > b.length) end = b.length;
    while (i < end) {
      var stop = Math.min(i + 4096, end);
      text += String.fromCharCode.apply(null, b.subarray(i, stop));
      i = stop;
    }
    return text;
  }

  /* The output pane writes with textContent, so nothing here can inject
     markup. Control characters still need flattening or a terminal escape in
     a captured payload could scramble the pane's layout. */
  function safeText(text, limit) {
    var s = String(text === undefined || text === null ? '' : text);
    if (limit && s.length > limit) s = s.slice(0, limit) + '…';
    return s.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, '.');
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  /* Hand-rolled rather than atob(), which throws on anything it dislikes and
     is fussy about padding. Captured base64 is often truncated by a snaplen,
     and a partial decode is still useful. */
  function b64decode(text) {
    var clean = String(text).replace(/[^A-Za-z0-9+/=]/g, '');
    if (clean.length < 4) return null;
    var res = '', buf = 0, bits = 0;
    for (var i = 0; i < clean.length; i++) {
      var c = clean.charAt(i);
      if (c === '=') break;
      var v = B64.indexOf(c);
      if (v < 0) return null;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; res += String.fromCharCode((buf >> bits) & 0xff); }
    }
    return res;
  }

  function urlDecode(text) {
    try {
      return decodeURIComponent(String(text).replace(/\+/g, ' '));
    } catch (err) {
      return String(text);            // stray % in a captured form body
    }
  }

  function num(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function plural(n, word) {
    return num(n) + ' ' + word + (n === 1 ? '' : 's');
  }

  function pct(part, total) {
    if (!total) return '0.0%';
    return ((part / total) * 100).toFixed(1) + '%';
  }

  function bar(fraction, width) {
    var filled = Math.round(fraction * width);
    if (fraction > 0 && filled === 0) filled = 1;
    if (filled > width) filled = width;
    return '█'.repeat(filled) + '·'.repeat(width - filled);
  }

  function pad(text, width) {
    var s = String(text);
    return s.length >= width ? s + ' ' : s.padEnd(width, ' ');
  }

  function ip4(b, off) {
    return b[off] + '.' + b[off + 1] + '.' + b[off + 2] + '.' + b[off + 3];
  }

  /* RFC 5952 form: lowercase hex, longest run of zero groups collapsed. */
  function ip6(b, off) {
    var parts = [], i;
    for (i = 0; i < 8; i++) {
      parts.push((((b[off + i * 2] << 8) | b[off + i * 2 + 1]) >>> 0).toString(16));
    }
    var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (i = 0; i < 8; i++) {
      if (parts[i] === '0') {
        if (curStart < 0) curStart = i;
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else { curStart = -1; curLen = 0; }
    }
    if (bestLen > 1) {
      return parts.slice(0, bestStart).join(':') + '::' + parts.slice(bestStart + bestLen).join(':');
    }
    return parts.join(':');
  }

  function mac(b, off) {
    var parts = [];
    for (var i = 0; i < 6; i++) {
      parts.push((b[off + i] < 16 ? '0' : '') + b[off + i].toString(16));
    }
    return parts.join(':');
  }

  /* An IPv6 literal contains colons, so a bare ip:port is ambiguous. */
  function ep(ip, port) {
    return (ip.indexOf(':') >= 0 ? '[' + ip + ']' : ip) + ':' + port;
  }

  function pad6(n) { return ('00000' + n).slice(-6); }

  function fmtTime(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return 'unknown';
    var whole = Math.floor(sec);
    var micro = Math.round((sec - whole) * 1e6);
    if (micro >= 1000000) { whole += 1; micro = 0; }
    if (whole < 0 || whole > 4102444800) {          // year 2100 — clearly wrong
      return sec.toFixed(6) + ' (epoch value outside a plausible range)';
    }
    var d = new Date(whole * 1000);
    return d.toISOString().slice(0, 19) + '.' + pad6(micro) + 'Z';
  }

  function duration(sec) {
    if (!isFinite(sec) || sec < 0) return 'unknown';
    if (sec < 1) return (sec * 1000).toFixed(3) + ' ms';
    if (sec < 90) return sec.toFixed(3) + ' s';
    var m = Math.floor(sec / 60), s = sec - m * 60;
    if (m < 60) return m + 'm ' + s.toFixed(1) + 's';
    var h = Math.floor(m / 60);
    return h + 'h ' + (m - h * 60) + 'm ' + Math.round(s) + 's';
  }

  function bump(map, key, by) {
    map[key] = (map[key] || 0) + (by === undefined ? 1 : by);
  }

  function topKeys(map, limit) {
    var keys = Object.keys(map);
    keys.sort(function (a, b) { return map[b] - map[a]; });
    return keys.slice(0, limit);
  }

  /* ======================================================================
     Reference tables
     ====================================================================== */

  var LINKTYPES = {
    0: 'NULL / BSD loopback', 1: 'Ethernet', 3: 'AX.25', 6: 'IEEE 802.5 Token Ring',
    7: 'ARCNET', 8: 'SLIP', 9: 'PPP', 10: 'FDDI', 12: 'RAW IP',
    50: 'PPP-HDLC', 51: 'PPPoE', 100: 'ATM RFC1483', 101: 'RAW IP',
    104: 'Cisco HDLC', 105: 'IEEE 802.11 wireless', 107: 'Frame Relay',
    108: 'OpenBSD loopback', 113: 'Linux cooked capture (SLL)',
    114: 'LocalTalk', 117: 'OpenBSD pflog', 119: 'Prism header + 802.11',
    127: 'Radiotap + 802.11', 143: 'DOCSIS', 147: 'private use',
    163: 'AVS + 802.11', 189: 'Linux USB', 192: 'PPI',
    195: 'IEEE 802.15.4', 201: 'Bluetooth HCI H4',
    228: 'RAW IPv4', 229: 'RAW IPv6', 239: 'NFLOG',
    247: 'InfiniBand', 249: 'USBPcap', 276: 'Linux cooked capture v2 (SLL2)'
  };

  var IP_PROTO = {
    1: 'ICMP', 2: 'IGMP', 4: 'IPv4-in-IPv4', 6: 'TCP', 8: 'EGP', 17: 'UDP',
    41: 'IPv6-in-IPv4', 46: 'RSVP', 47: 'GRE', 50: 'ESP', 51: 'AH',
    58: 'ICMPv6', 89: 'OSPF', 103: 'PIM', 112: 'VRRP', 132: 'SCTP',
    136: 'UDP-Lite'
  };

  var PORTS = {
    20: 'FTP-data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
    43: 'WHOIS', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 69: 'TFTP', 79: 'finger',
    80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 111: 'RPC', 119: 'NNTP',
    123: 'NTP', 135: 'MS-RPC', 137: 'NetBIOS-NS', 138: 'NetBIOS-DGM',
    139: 'NetBIOS-SSN', 143: 'IMAP', 161: 'SNMP', 162: 'SNMP-trap',
    179: 'BGP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS',
    500: 'IKE', 512: 'rexec', 513: 'rlogin', 514: 'syslog / rsh',
    515: 'LPD', 520: 'RIP', 548: 'AFP', 554: 'RTSP', 587: 'SMTP submission',
    623: 'IPMI', 631: 'IPP', 636: 'LDAPS', 873: 'rsync', 989: 'FTPS-data',
    990: 'FTPS', 992: 'Telnet over TLS', 993: 'IMAPS', 995: 'POP3S',
    1080: 'SOCKS', 1194: 'OpenVPN', 1433: 'MS SQL', 1434: 'MS SQL browser',
    1521: 'Oracle', 1701: 'L2TP', 1723: 'PPTP', 1812: 'RADIUS',
    1883: 'MQTT', 1900: 'SSDP', 2049: 'NFS', 2375: 'Docker API',
    3128: 'HTTP proxy', 3306: 'MySQL', 3389: 'RDP', 4500: 'IPsec NAT-T',
    5060: 'SIP', 5061: 'SIP over TLS', 5222: 'XMPP', 5353: 'mDNS',
    5432: 'PostgreSQL', 5555: 'ADB', 5672: 'AMQP', 5900: 'VNC',
    6379: 'Redis', 6667: 'IRC', 8000: 'HTTP-alt', 8008: 'HTTP-alt',
    8080: 'HTTP-alt', 8081: 'HTTP-alt', 8443: 'HTTPS-alt', 8888: 'HTTP-alt',
    9092: 'Kafka', 9200: 'Elasticsearch', 11211: 'memcached',
    27017: 'MongoDB', 51820: 'WireGuard'
  };

  /* Ports whose traffic is, by design, readable by anyone on the path.
     The note is what an analyst should actually say in the report. */
  var CLEARTEXT = {
    21:   ['FTP', 'commands, filenames and the password are plain ASCII — use SFTP or FTPS'],
    23:   ['Telnet', 'every keystroke including the password is in the clear — SSH replaced this in 1995'],
    25:   ['SMTP', 'mail bodies and AUTH credentials readable unless STARTTLS was negotiated'],
    69:   ['TFTP', 'no authentication at all, and the file contents are plain'],
    79:   ['finger', 'user enumeration, unauthenticated'],
    80:   ['HTTP', 'URLs, cookies, form posts and Basic auth are all readable'],
    110:  ['POP3', 'USER/PASS in the clear, then the whole mailbox'],
    119:  ['NNTP', 'plaintext AUTHINFO'],
    143:  ['IMAP', 'LOGIN command carries the password unless TLS was negotiated first'],
    161:  ['SNMP', 'v1/v2c community strings are effectively passwords, sent unencrypted'],
    389:  ['LDAP', 'simple bind sends the directory password in the clear'],
    512:  ['rexec', 'password on the wire, no encryption'],
    513:  ['rlogin', 'trusts the source address, sends everything plain'],
    514:  ['syslog / rsh', 'log contents readable; rsh authenticates on address alone'],
    1433: ['MS SQL', 'may be unencrypted depending on server configuration'],
    3306: ['MySQL', 'unencrypted unless TLS was explicitly required'],
    5432: ['PostgreSQL', 'unencrypted unless sslmode was set'],
    5900: ['VNC', 'the classic auth is a weak challenge-response and the screen is plain'],
    6379: ['Redis', 'no transport security; AUTH password is plain'],
    6667: ['IRC', 'messages and NickServ passwords readable'],
    8080: ['HTTP-alt', 'same exposure as HTTP on 80'],
    11211:['memcached', 'no authentication in the default configuration'],
    27017:['MongoDB', 'unencrypted unless TLS was configured']
  };

  var ENCRYPTED_PORTS = {
    22: 1, 443: 1, 465: 1, 563: 1, 636: 1, 989: 1, 990: 1, 992: 1, 993: 1,
    995: 1, 1194: 1, 4500: 1, 500: 1, 5061: 1, 8443: 1, 51820: 1
  };

  /* Flows worth buffering for the credential scan. Anything else is either
     encrypted or not line-oriented, and buffering it just burns memory. */
  var SCAN_PORTS = {
    21: 1, 23: 1, 25: 1, 80: 1, 110: 1, 119: 1, 143: 1, 389: 1, 512: 1,
    513: 1, 514: 1, 587: 1, 1080: 1, 3128: 1, 5060: 1, 6667: 1, 8000: 1,
    8008: 1, 8080: 1, 8081: 1, 8088: 1, 8888: 1, 9000: 1
  };

  var DNS_TYPES = {
    1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 13: 'HINFO', 15: 'MX',
    16: 'TXT', 17: 'RP', 24: 'SIG', 25: 'KEY', 28: 'AAAA', 29: 'LOC',
    33: 'SRV', 35: 'NAPTR', 39: 'DNAME', 41: 'OPT', 43: 'DS', 46: 'RRSIG',
    47: 'NSEC', 48: 'DNSKEY', 50: 'NSEC3', 52: 'TLSA', 64: 'SVCB',
    65: 'HTTPS', 99: 'SPF', 251: 'IXFR', 252: 'AXFR', 255: 'ANY', 257: 'CAA'
  };

  var ICMP_TYPES = {
    0: 'echo reply', 3: 'destination unreachable', 4: 'source quench',
    5: 'redirect', 8: 'echo request', 9: 'router advertisement',
    10: 'router solicitation', 11: 'time exceeded', 12: 'parameter problem',
    13: 'timestamp request', 14: 'timestamp reply'
  };

  var ICMP6_TYPES = {
    1: 'destination unreachable', 2: 'packet too big', 3: 'time exceeded',
    4: 'parameter problem', 128: 'echo request', 129: 'echo reply',
    133: 'router solicitation', 134: 'router advertisement',
    135: 'neighbour solicitation', 136: 'neighbour advertisement',
    143: 'multicast listener report'
  };

  /* ======================================================================
     Analysis context
     ====================================================================== */

  function newContext() {
    return {
      format: '', endian: '', versionText: '', snaplen: 0,
      linkTypes: {}, interfaces: [],
      packets: 0, dissected: 0, wireBytes: 0, capturedBytes: 0,
      truncatedPackets: 0,
      first: null, last: null,
      /* l4 is the breakdown that gets the bar graph, so every dissected
         packet must land in exactly one bucket — ICMP message types go in
         their own map rather than double-counting against 'ICMP'. */
      l3: {}, l4: {}, icmp: {},
      pairs: {}, pairCount: 0, pairsFull: false,
      ports: {},
      convs: {}, convCount: 0, convsFull: false,
      flows: {}, flowKeys: [], flowChars: 0, flowsFull: false,
      dns: {}, dnsKeys: [], dnsQueries: 0,
      http: [], httpTotal: 0,
      creds: [], credSeen: {}, credsFull: false,
      arp: {}, arpOps: {},
      vlans: {}, fragments: 0, malformed: 0, oddLengths: 0,
      notes: [], fatal: null, stoppedAt: 0
    };
  }

  /* ======================================================================
     Container 1 — classic pcap
     ====================================================================== */

  function parseClassic(b, dv, ctx, onPacket) {
    var magic = dv.getUint32(0, false);
    var little, nano = false, modified = false;

    /* The writer dumped its native representation of 0xa1b2c3d4, so reading
       the field big-endian and looking at what came out tells us which way
       round the rest of the file is. */
    if (magic === 0xa1b2c3d4)      { little = false; }
    else if (magic === 0xd4c3b2a1) { little = true; }
    else if (magic === 0xa1b23c4d) { little = false; nano = true; }
    else if (magic === 0x4d3cb2a1) { little = true;  nano = true; }
    else if (magic === 0xa1b2cd34) { little = false; modified = true; }
    else if (magic === 0x34cdb2a1) { little = true;  modified = true; }
    else return false;

    ctx.format = 'classic pcap' + (nano ? ' (nanosecond timestamps)' : '') +
                 (modified ? ' — Kuznetzov "modified" variant' : '');
    ctx.endian = little ? 'little-endian' : 'big-endian';
    ctx.versionText = dv.getUint16(4, little) + '.' + dv.getUint16(6, little);

    /* thiszone is a GMT correction that essentially every writer sets to 0
       and every reader ignores; libpcap itself never uses it. Noted, unused. */
    var thiszone = dv.getInt32(8, little);
    if (thiszone !== 0) ctx.notes.push('Global header declares a timezone offset of ' + thiszone + ' s; timestamps below are shown as raw UTC epoch, as libpcap does.');

    ctx.snaplen = dv.getUint32(16, little);
    var linkType = dv.getUint32(20, little);
    ctx.linkTypes[linkType] = 0;

    /* The "modified" pcap variant inserts ifindex/protocol/pkt_type/padding
       after the four standard fields, making the record header 24 bytes. */
    var hdrLen = modified ? 24 : 16;
    var pos = 24, walked = 0;

    while (pos + hdrLen <= b.length) {
      if (++walked > MAX_WALK) {
        ctx.notes.push('Stopped after ' + num(MAX_WALK) + ' packet records; the file continues past ' + LabTool.humanBytes(pos) + '.');
        break;
      }
      var tsSec  = dv.getUint32(pos, little);
      var tsFrac = dv.getUint32(pos + 4, little);
      var incl   = dv.getUint32(pos + 8, little);
      var orig   = dv.getUint32(pos + 12, little);

      /* incl_len is the only field that can desync the whole rest of the
         file, so it is the one worth sanity-checking. A wrong-but-plausible
         value is undetectable here; an absurd one is not. */
      if (incl > MAX_PKT_LEN) {
        ctx.notes.push('Record at offset ' + pos + ' claims a ' + num(incl) + '-byte packet. That is not a real capture length — the file is truncated, corrupt, or not what its header says. Stopped there.');
        ctx.stoppedAt = pos;
        break;
      }
      /* incl_len above orig_len is backwards by definition: you cannot
         capture more of a packet than existed. Counted, not fatal. */
      if (orig && incl > orig) ctx.oddLengths++;
      if (pos + hdrLen + incl > b.length) {
        ctx.notes.push('The file ends in the middle of a packet record (needed ' + num(incl) + ' bytes, ' + num(b.length - pos - hdrLen) + ' remain). Usually means the capture process was killed mid-write.');
        break;
      }

      var ts = tsSec + tsFrac / (nano ? 1e9 : 1e6);
      onPacket(pos + hdrLen, pos + hdrLen + incl, ts, orig || incl, linkType);
      pos += hdrLen + incl;
    }
    return true;
  }

  /* ======================================================================
     Container 2 — pcapng
     ====================================================================== */

  function readOptions(b, dv, start, end, little, handler) {
    var pos = start;
    while (pos + 4 <= end) {
      var code = dv.getUint16(pos, little);
      var len = dv.getUint16(pos + 2, little);
      if (code === 0) break;                    // opt_endofopt
      var valueEnd = pos + 4 + len;
      if (valueEnd > end) break;
      handler(code, pos + 4, valueEnd);
      pos = valueEnd + ((4 - (len % 4)) % 4);   // options are padded to 32 bits
    }
  }

  function parseNg(b, dv, ctx, onPacket) {
    var pos = 0, little = true, walked = 0, sections = 0;
    var ifaces = [];
    ctx.format = 'pcapng';

    while (pos + 12 <= b.length) {
      if (++walked > MAX_WALK) {
        ctx.notes.push('Stopped after ' + num(MAX_WALK) + ' blocks.');
        break;
      }
      var type = dv.getUint32(pos, little);

      if (type === 0x0a0d0d0a) {
        /* Section Header Block. Its type is a palindrome on purpose, so the
           byte-order magic at +8 is the only thing that settles endianness —
           and a concatenated file can flip it mid-stream, which is why this
           is re-read per section rather than once at the top. */
        if (pos + 16 > b.length) break;
        var bom = dv.getUint32(pos + 8, false);
        if (bom === 0x1a2b3c4d) little = false;
        else if (bom === 0x4d3c2b1a) little = true;
        else {
          ctx.notes.push('Section header at offset ' + pos + ' has byte-order magic 0x' + bom.toString(16) + ' instead of 0x1a2b3c4d. Stopped.');
          break;
        }
        sections++;
        if (sections === 1) {
          ctx.endian = little ? 'little-endian' : 'big-endian';
          ctx.versionText = dv.getUint16(pos + 12, little) + '.' + dv.getUint16(pos + 14, little);
        }
        /* Interface IDs are scoped to a section, so a new section resets the
           interface table. Missing this makes every timestamp in a merged
           capture use the first section's resolution. */
        if (sections > 1) ifaces = [];
      }

      var total = dv.getUint32(pos + 4, little);
      if (total < 12 || (total % 4) !== 0 || pos + total > b.length) {
        ctx.notes.push('Block at offset ' + pos + ' declares a length of ' + num(total) + ' bytes, which does not fit the file or is not 32-bit aligned. Stopped there.');
        ctx.stoppedAt = pos;
        break;
      }
      var trailer = dv.getUint32(pos + total - 4, little);
      if (trailer !== total) {
        /* pcapng repeats the length at the end precisely so a reader can
           detect desync. If the two disagree we are lost — carrying on would
           produce confident nonsense. */
        ctx.notes.push('Block at offset ' + pos + ' has mismatched leading/trailing lengths (' + num(total) + ' vs ' + num(trailer) + '). The file is corrupt from that point; stopped.');
        ctx.stoppedAt = pos;
        break;
      }
      var body = pos + 8, bodyEnd = pos + total - 4;

      if (type === 1) {                          // Interface Description Block
        if (body + 8 <= bodyEnd) {
          var iface = {
            linkType: dv.getUint16(body, little),
            snaplen: dv.getUint32(body + 4, little),
            divisor: 1e6,                        // if_tsresol default is 10^-6
            tsOffset: 0,
            name: ''
          };
          readOptions(b, dv, body + 8, bodyEnd, little, function (code, vStart, vEnd) {
            if (code === 2) iface.name = safeText(ascii(b, vStart, vEnd), 40);
            else if (code === 9 && vEnd > vStart) {
              var raw = b[vStart];
              /* High bit set means the value is a negative power of two,
                 clear means a negative power of ten. */
              iface.divisor = (raw & 0x80) ? Math.pow(2, raw & 0x7f) : Math.pow(10, raw & 0x7f);
              if (!isFinite(iface.divisor) || iface.divisor <= 0) iface.divisor = 1e6;
            } else if (code === 14 && vStart + 8 <= vEnd) {
              /* if_tsoffset is a SIGNED 64-bit integer, so the high word must
                 be read signed or a negative offset becomes ~1.8e19 and every
                 timestamp in the capture is destroyed. Low word stays unsigned. */
              iface.tsOffset = dv.getInt32(vStart + (little ? 4 : 0), little) * 4294967296 +
                               dv.getUint32(vStart + (little ? 0 : 4), little);
            }
          });
          ifaces.push(iface);
          ctx.snaplen = ctx.snaplen || iface.snaplen;
          if (ctx.linkTypes[iface.linkType] === undefined) ctx.linkTypes[iface.linkType] = 0;
          ctx.interfaces.push(iface);
        }
      } else if (type === 6) {                   // Enhanced Packet Block
        if (body + 20 <= bodyEnd) {
          var id = dv.getUint32(body, little);
          var hi = dv.getUint32(body + 4, little);
          var lo = dv.getUint32(body + 8, little);
          var cap = dv.getUint32(body + 12, little);
          var origLen = dv.getUint32(body + 16, little);
          var ifc = ifaces[id] || { linkType: 1, divisor: 1e6, tsOffset: 0 };
          /* 64-bit ticks in a double. At nanosecond resolution a modern epoch
             value exceeds 2^53, so the low ~0.2 microseconds are lost. That is
             invisible at the precision this report prints, but it is a real
             limit worth knowing about. */
          var ticks = hi * 4294967296 + lo;
          var ts = ticks / ifc.divisor + (ifc.tsOffset || 0);
          var dataEnd = Math.min(body + 20 + cap, bodyEnd);
          if (cap <= MAX_PKT_LEN) {
            onPacket(body + 20, dataEnd, ts, origLen || cap, ifc.linkType);
          }
        }
      } else if (type === 3) {                   // Simple Packet Block
        if (body + 4 <= bodyEnd) {
          var sOrig = dv.getUint32(body, little);
          var ifc0 = ifaces[0] || { linkType: 1 };
          /* An SPB carries no captured length of its own, and its data field is
             padded to a 32-bit boundary — so the block can hold up to 3 bytes
             past the real payload. The captured extent is min(orig_len, snaplen),
             not whatever fills the block; clamp it so padding is not fed to the
             dissector or appended to buffered flow text. */
          var sAvail = bodyEnd - (body + 4);
          var sCap = sOrig ? Math.min(sOrig, sAvail) : sAvail;
          if (ifc0.snaplen) sCap = Math.min(sCap, ifc0.snaplen);
          onPacket(body + 4, body + 4 + sCap, null, sOrig || sCap, ifc0.linkType);
        }
      } else if (type === 2) {                   // obsolete Packet Block
        if (body + 20 <= bodyEnd) {
          var pid = dv.getUint16(body, little);
          var phi = dv.getUint32(body + 4, little);
          var plo = dv.getUint32(body + 8, little);
          var pcap2 = dv.getUint32(body + 12, little);
          var porig = dv.getUint32(body + 16, little);
          var pif = ifaces[pid] || { linkType: 1, divisor: 1e6, tsOffset: 0 };
          onPacket(body + 20, Math.min(body + 20 + pcap2, bodyEnd),
                   (phi * 4294967296 + plo) / pif.divisor + (pif.tsOffset || 0),
                   porig || pcap2, pif.linkType);
        }
      }
      /* Types 4 (name resolution), 5 (interface statistics), 7 (IRIG),
         0x0bad (custom) and anything unknown are skipped by length, which is
         exactly what the format is designed to allow. */

      pos += total;
    }
    return sections > 0;
  }

  /* ======================================================================
     Link layer
     ====================================================================== */

  /* Returns the offset where the network-layer header starts and what it is,
     or null if this link type or frame is not something we decode. */
  function linkLayer(b, off, end, linkType, info) {
    var type, p, guard;

    if (linkType === 1) {                        // Ethernet II
      if (end - off < 14) return null;
      info.dstMac = mac(b, off);
      info.srcMac = mac(b, off + 6);
      type = (b[off + 12] << 8) | b[off + 13];
      p = off + 14;
      guard = 0;
      /* 802.1Q, 802.1ad (QinQ) and the old 0x9100 stack four bytes each in
         front of the real EtherType. Loop, do not special-case one tag. */
      while ((type === 0x8100 || type === 0x88a8 || type === 0x9100) && p + 4 <= end && guard < 3) {
        info.vlans.push((((b[p] << 8) | b[p + 1]) & 0x0fff));
        type = (b[p + 2] << 8) | b[p + 3];
        p += 4;
        guard++;
      }
      if (type <= 1500) {
        /* Values up to 1500 are an 802.3 length, not an EtherType. Only the
           SNAP encapsulation carries something we can follow. */
        if (p + 8 <= end && b[p] === 0xaa && b[p + 1] === 0xaa && b[p + 2] === 0x03) {
          type = (b[p + 6] << 8) | b[p + 7];
          p += 8;
        } else {
          info.note = '802.3 LLC';
          return null;
        }
      }
      return etherType(type, p);
    }

    if (linkType === 113) {                      // Linux cooked capture v1
      if (end - off < 16) return null;
      return etherType((b[off + 14] << 8) | b[off + 15], off + 16);
    }

    if (linkType === 276) {                      // Linux cooked capture v2
      if (end - off < 20) return null;
      return etherType((b[off] << 8) | b[off + 1], off + 20);
    }

    if (linkType === 0 || linkType === 108) {    // BSD loopback
      if (end - off < 4) return null;
      /* The address family is written in host byte order with no marker, so
         try it both ways and accept whichever gives a family we know. */
      var le = b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24);
      var be = (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
      var fam = (le === 2 || le === 24 || le === 28 || le === 30) ? le : be;
      if (fam === 2) return { proto: 'ipv4', off: off + 4 };
      if (fam === 24 || fam === 28 || fam === 30) return { proto: 'ipv6', off: off + 4 };
      return null;
    }

    if (linkType === 12 || linkType === 14 || linkType === 101 ||
        linkType === 228 || linkType === 229) {  // raw IP, no link header
      if (end - off < 1) return null;
      var version = b[off] >> 4;
      if (version === 4) return { proto: 'ipv4', off: off };
      if (version === 6) return { proto: 'ipv6', off: off };
      return null;
    }

    info.note = LINKTYPES[linkType] || ('link type ' + linkType);
    return null;
  }

  function etherType(type, off) {
    if (type === 0x0800) return { proto: 'ipv4', off: off };
    if (type === 0x86dd) return { proto: 'ipv6', off: off };
    if (type === 0x0806) return { proto: 'arp', off: off };
    if (type === 0x8035) return { proto: 'rarp', off: off };
    return { proto: 'ethertype 0x' + ('0000' + type.toString(16)).slice(-4), off: off };
  }

  /* ======================================================================
     Network and transport dissection
     ====================================================================== */

  /* Only the four flags that describe connection state are tracked; PSH and
     URG say nothing about whether a connection happened. */
  var FIN = 0x01, SYN = 0x02, RST = 0x04, ACK = 0x10;

  function dissect(b, dv, off, end, linkType, ts, wireLen, ctx) {
    var info = { vlans: [] };
    var net = linkLayer(b, off, end, linkType, info);
    var i;
    for (i = 0; i < info.vlans.length; i++) bump(ctx.vlans, info.vlans[i]);

    if (!net) {
      bump(ctx.l3, info.note || 'undecoded link layer');
      bump(ctx.l4, 'not decoded');
      return;
    }
    if (net.proto === 'arp' || net.proto === 'rarp') {
      dissectArp(b, net.off, end, ctx, net.proto);
      return;
    }
    if (net.proto !== 'ipv4' && net.proto !== 'ipv6') {
      bump(ctx.l3, net.proto);
      bump(ctx.l4, net.proto);
      return;
    }

    var src, dst, proto, l4Off, l4End, fragmented = false;

    if (net.proto === 'ipv4') {
      var o = net.off;
      if (end - o < 20) { ctx.malformed++; return; }
      var ihl = (b[o] & 0x0f) * 4;
      if (ihl < 20 || o + ihl > end) { ctx.malformed++; return; }
      var totalLen = (b[o + 2] << 8) | b[o + 3];
      var fragOff = ((((b[o + 6] & 0x1f) << 8) | b[o + 7]) >>> 0) * 8;
      var moreFrags = !!(b[o + 6] & 0x20);
      proto = b[o + 9];
      src = ip4(b, o + 12);
      dst = ip4(b, o + 16);
      bump(ctx.l3, 'IPv4');
      /* A total length of zero means TCP segmentation offload: the capture
         was taken above the NIC, before the real packet existed. Trusting it
         would drop the entire payload, so fall back to the captured extent. */
      l4Off = o + ihl;
      l4End = (totalLen >= ihl && o + totalLen <= end) ? o + totalLen : end;
      if (fragOff > 0 || moreFrags) {
        fragmented = true;
        ctx.fragments++;
        /* Only the first fragment has a transport header. Later fragments
           carry payload we cannot attribute without reassembly. */
        if (fragOff > 0) { bumpProto(ctx, proto); recordPair(ctx, src, dst, wireLen); return; }
      }
    } else {
      var o6 = net.off;
      if (end - o6 < 40) { ctx.malformed++; return; }
      var payLen = (b[o6 + 4] << 8) | b[o6 + 5];
      proto = b[o6 + 6];
      src = ip6(b, o6 + 8);
      dst = ip6(b, o6 + 24);
      bump(ctx.l3, 'IPv6');
      l4Off = o6 + 40;
      l4End = (payLen && o6 + 40 + payLen <= end) ? o6 + 40 + payLen : end;
      /* Walk the extension header chain. Each one starts with next-header and
         a length, but AH counts in 4-byte units and fragment headers are a
         fixed 8 bytes — get either wrong and the transport header vanishes. */
      var hops = 0;
      while (hops++ < 8 && l4Off + 2 <= l4End) {
        if (proto === 0 || proto === 43 || proto === 60 || proto === 135) {
          var extLen = (b[l4Off + 1] + 1) * 8;
          proto = b[l4Off];
          l4Off += extLen;
        } else if (proto === 44) {
          fragmented = true;
          ctx.fragments++;
          var fOff = ((b[l4Off + 2] << 8) | b[l4Off + 3]) & 0xfff8;
          proto = b[l4Off];
          l4Off += 8;
          if (fOff > 0) { bumpProto(ctx, proto); recordPair(ctx, src, dst, wireLen); return; }
        } else if (proto === 51) {
          var ahLen = (b[l4Off + 1] + 2) * 4;
          proto = b[l4Off];
          l4Off += ahLen;
        } else break;
      }
      if (l4Off > l4End) { ctx.malformed++; return; }
    }

    bumpProto(ctx, proto);
    recordPair(ctx, src, dst, wireLen);

    if (proto === 6) dissectTcp(b, dv, l4Off, l4End, src, dst, ts, wireLen, ctx);
    else if (proto === 17) dissectUdp(b, dv, l4Off, l4End, src, dst, ts, ctx);
    else if (proto === 1 && l4Off < l4End) bump(ctx.icmp, 'ICMP ' + (ICMP_TYPES[b[l4Off]] || ('type ' + b[l4Off])));
    else if (proto === 58 && l4Off < l4End) bump(ctx.icmp, 'ICMPv6 ' + (ICMP6_TYPES[b[l4Off]] || ('type ' + b[l4Off])));
  }

  function bumpProto(ctx, proto) {
    bump(ctx.l4, IP_PROTO[proto] || ('IP protocol ' + proto));
  }

  function recordPair(ctx, a, b, bytes) {
    var key = a < b ? (a + '\u0000' + b) : (b + '\u0000' + a);
    var rec = ctx.pairs[key];
    if (!rec) {
      if (ctx.pairCount >= MAX_PAIRS) { ctx.pairsFull = true; return; }
      rec = ctx.pairs[key] = { a: a < b ? a : b, b: a < b ? b : a, packets: 0, bytes: 0 };
      ctx.pairCount++;
    }
    rec.packets++;
    rec.bytes += bytes;
  }

  function dissectArp(b, off, end, ctx, kind) {
    bump(ctx.l3, kind === 'rarp' ? 'RARP' : 'ARP');
    bump(ctx.l4, kind === 'rarp' ? 'RARP' : 'ARP');
    if (end - off < 28) { ctx.malformed++; return; }
    var hlen = b[off + 4], plen = b[off + 5];
    var op = (b[off + 6] << 8) | b[off + 7];
    bump(ctx.arpOps, op === 1 ? 'request' : op === 2 ? 'reply' : ('opcode ' + op));
    if (hlen !== 6 || plen !== 4) return;         // only Ethernet/IPv4 is mapped here
    var senderMac = mac(b, off + 8);
    var senderIp = ip4(b, off + 14);
    if (senderIp === '0.0.0.0') return;           // ARP probe, no claim made
    var entry = ctx.arp[senderIp];
    if (!entry) entry = ctx.arp[senderIp] = {};
    bump(entry, senderMac);
  }

  function pickService(sport, dport) {
    /* Which of the two ports names the conversation. A known service wins;
       otherwise the lower number is the usual convention, because ephemeral
       client ports sit high. It is a heuristic and occasionally wrong. */
    if (PORTS[dport] && !PORTS[sport]) return dport;
    if (PORTS[sport] && !PORTS[dport]) return sport;
    if (PORTS[sport] && PORTS[dport]) return Math.min(sport, dport);
    return Math.min(sport, dport);
  }

  function dissectTcp(b, dv, off, end, src, dst, ts, wireLen, ctx) {
    if (end - off < 20) { ctx.malformed++; return; }
    var sport = (b[off] << 8) | b[off + 1];
    var dport = (b[off + 2] << 8) | b[off + 3];
    var seq = dv.getUint32(off + 4, false);
    var dataOff = (b[off + 12] >> 4) * 4;
    var flags = b[off + 13];
    if (dataOff < 20 || off + dataOff > end) { ctx.malformed++; return; }

    var service = pickService(sport, dport);
    bump(ctx.ports, 'TCP/' + service);

    recordConversation(ctx, src, sport, dst, dport, ts, wireLen, flags);

    var payOff = off + dataOff;
    if (payOff < end) bufferTcp(ctx, b, payOff, end, src, sport, dst, dport, seq, ts);
  }

  function recordConversation(ctx, src, sport, dst, dport, ts, wireLen, flags) {
    var forward = src < dst || (src === dst && sport <= dport);
    var key = forward ? (src + '|' + sport + '|' + dst + '|' + dport)
                      : (dst + '|' + dport + '|' + src + '|' + sport);
    var c = ctx.convs[key];
    if (!c) {
      if (ctx.convCount >= MAX_CONVS) { ctx.convsFull = true; return; }
      c = ctx.convs[key] = {
        aIp: forward ? src : dst, aPort: forward ? sport : dport,
        bIp: forward ? dst : src, bPort: forward ? dport : sport,
        packets: 0, bytes: 0, aBytes: 0, bBytes: 0,
        syn: 0, synack: 0, fin: 0, rst: 0,
        first: ts, last: ts, initiator: null
      };
      ctx.convCount++;
    }
    c.packets++;
    c.bytes += wireLen;
    if (forward) c.aBytes += wireLen; else c.bBytes += wireLen;
    if (ts !== null) {
      if (c.first === null || ts < c.first) c.first = ts;
      if (c.last === null || ts > c.last) c.last = ts;
    }
    if ((flags & SYN) && !(flags & ACK)) {
      c.syn++;
      if (!c.initiator) c.initiator = ep(src, sport);
    }
    if ((flags & SYN) && (flags & ACK)) c.synack++;
    if (flags & FIN) c.fin++;
    if (flags & RST) c.rst++;
  }

  function connectionState(c) {
    if (c.syn && c.synack && c.rst) return ['connected, then reset', 't-warn'];
    if (c.syn && c.synack && c.fin) return ['connected and closed cleanly', 't-ok'];
    if (c.syn && c.synack)          return ['connected, still open at end of capture', 't-ok'];
    if (c.syn && c.rst)             return ['refused (RST to the SYN)', 't-warn'];
    if (c.syn && !c.synack)         return ['no reply — dropped or filtered', 't-err'];
    if (c.rst)                      return ['reset', 't-warn'];
    if (c.fin)                      return ['closed (handshake not captured)', 't-dim'];
    return ['mid-stream — capture started after the handshake', 't-dim'];
  }

  /* ---- TCP payload buffering ------------------------------------------- */

  function shouldBuffer(b, off, end, sport, dport) {
    if (SCAN_PORTS[dport] || SCAN_PORTS[sport]) return true;
    /* An HTTP request on a port nobody expects is exactly the interesting
       case, so sniff the first bytes for a method token too. */
    if (end - off >= 8) {
      var head = ascii(b, off, off + 8);
      if (/^(GET |POST |PUT |HEAD |OPTIO|DELET|PATCH|CONNE|PROPF|HTTP\/)/.test(head)) return true;
    }
    return false;
  }

  function bufferTcp(ctx, b, off, end, src, sport, dst, dport, seq, ts) {
    var key = src + '|' + sport + '>' + dst + '|' + dport;
    var f = ctx.flows[key];
    if (!f) {
      if (ctx.flowsFull || ctx.flowKeys.length >= MAX_FLOWS) { ctx.flowsFull = true; return; }
      if (!shouldBuffer(b, off, end, sport, dport)) return;
      f = ctx.flows[key] = {
        srcIp: src, srcPort: sport, dstIp: dst, dstPort: dport,
        text: '', nextSeq: null, gaps: 0, full: false, first: ts
      };
      ctx.flowKeys.push(key);
    }
    if (f.full) return;

    var len = end - off;
    /* Sequence handling: drop what we already hold, trim overlaps, and count
       gaps. Real reassembly would buffer out-of-order segments and stitch
       them; this keeps one linear buffer, which is enough to read a login
       exchange and honest about when it is not. Differences are taken as
       signed 32-bit so sequence wraparound compares correctly. */
    if (f.nextSeq === null) {
      f.nextSeq = (seq + len) >>> 0;
    } else {
      var diff = (seq - f.nextSeq) | 0;
      if (diff < 0) {
        var skip = -diff;
        if (skip >= len) return;                 // pure retransmission
        off += skip;
      } else if (diff > 0) {
        f.gaps++;
      }
      f.nextSeq = (seq + len) >>> 0;
    }

    if (ctx.flowChars >= FLOW_BUDGET) { ctx.flowsFull = true; return; }
    var room = FLOW_CHARS - f.text.length;
    if (room <= 0) { f.full = true; return; }
    if (end - off > room) { end = off + room; f.full = true; }
    f.text += ascii(b, off, end);
    ctx.flowChars += (end - off);
  }

  /* ---- UDP -------------------------------------------------------------- */

  function dissectUdp(b, dv, off, end, src, dst, ts, ctx) {
    if (end - off < 8) { ctx.malformed++; return; }
    var sport = (b[off] << 8) | b[off + 1];
    var dport = (b[off + 2] << 8) | b[off + 3];
    var udpLen = (b[off + 4] << 8) | b[off + 5];
    var payOff = off + 8;
    var payEnd = (udpLen >= 8 && off + udpLen <= end) ? off + udpLen : end;

    bump(ctx.ports, 'UDP/' + pickService(sport, dport));

    if (sport === 53 || dport === 53 || sport === 5353 || dport === 5353 ||
        sport === 5355 || dport === 5355) {
      parseDns(b, payOff, payEnd, ctx);
    } else if (dport === 161 || dport === 162 || sport === 161) {
      scanSnmp(b, payOff, payEnd, ctx, src, dst, dport || sport);
    }
  }

  /* ---- DNS -------------------------------------------------------------- */

  /* Names are label-length prefixed and may jump backwards via a two-byte
     pointer with the top bits set. A malicious capture can point a name at
     itself, so jumps are counted and capped. */
  function readName(b, msgStart, msgEnd, pos) {
    var labels = [], jumps = 0, consumed = 0, jumped = false, cur = pos;
    while (cur < msgEnd) {
      var len = b[cur];
      if (len === 0) { cur++; if (!jumped) consumed = cur - pos; break; }
      if ((len & 0xc0) === 0xc0) {
        if (cur + 1 >= msgEnd) return null;
        var ptr = msgStart + ((((len & 0x3f) << 8) | b[cur + 1]) >>> 0);
        if (!jumped) { consumed = cur + 2 - pos; jumped = true; }
        if (++jumps > 16 || ptr >= msgEnd || ptr < msgStart) return null;
        cur = ptr;
        continue;
      }
      if (len & 0xc0) return null;                // reserved label type
      if (cur + 1 + len > msgEnd) return null;
      labels.push(ascii(b, cur + 1, cur + 1 + len));
      cur += 1 + len;
      if (labels.length > 63) return null;
    }
    if (!jumped && !consumed) consumed = cur - pos;
    return { name: labels.length ? labels.join('.') : '<root>', next: pos + consumed };
  }

  function parseDns(b, start, end, ctx) {
    if (end - start < 12) return;
    var flags = (b[start + 2] << 8) | b[start + 3];
    var isResponse = !!(flags & 0x8000);
    var rcode = flags & 0x0f;
    var qd = (b[start + 4] << 8) | b[start + 5];
    var an = (b[start + 6] << 8) | b[start + 7];
    /* Sanity gate: a real query has a handful of questions. Anything else on
       port 53 is a tunnel, a scan or not DNS at all. */
    if (qd === 0 || qd > 16 || an > 200) return;

    var pos = start + 12, i;
    var firstName = null, firstType = 0;
    for (i = 0; i < qd; i++) {
      var q = readName(b, start, end, pos);
      if (!q || q.next + 4 > end) return;
      var qtype = (b[q.next] << 8) | b[q.next + 1];
      pos = q.next + 4;
      if (i === 0) { firstName = q.name; firstType = qtype; }
      ctx.dnsQueries++;
      var key = (DNS_TYPES[qtype] || ('TYPE' + qtype)) + ' ' + q.name;
      var rec = ctx.dns[key];
      if (!rec) {
        if (ctx.dnsKeys.length >= MAX_DNS_KEYS) continue;
        rec = ctx.dns[key] = { count: 0, answers: [], nx: 0 };
        ctx.dnsKeys.push(key);
      }
      rec.count++;
      if (isResponse && rcode === 3) rec.nx++;
    }
    if (!isResponse || !an || firstName === null) return;

    /* Answers are a bonus: seeing what a name resolved to is usually the
       point of looking at DNS in a capture at all. Capped hard. */
    var record = ctx.dns[(DNS_TYPES[firstType] || ('TYPE' + firstType)) + ' ' + firstName];
    var limit = Math.min(an, 20);
    for (i = 0; i < limit; i++) {
      var nm = readName(b, start, end, pos);
      if (!nm || nm.next + 10 > end) return;
      var rtype = (b[nm.next] << 8) | b[nm.next + 1];
      var rdlen = (b[nm.next + 8] << 8) | b[nm.next + 9];
      var rdata = nm.next + 10;
      if (rdata + rdlen > end) return;
      var value = null;
      if (rtype === 1 && rdlen === 4) value = ip4(b, rdata);
      else if (rtype === 28 && rdlen === 16) value = ip6(b, rdata);
      else if (rtype === 5) {
        var cn = readName(b, start, end, rdata);
        if (cn) value = 'CNAME ' + cn.name;
      }
      if (value && record && record.answers.length < 6 && record.answers.indexOf(value) < 0) {
        record.answers.push(value);
      }
      pos = rdata + rdlen;
    }
  }

  /* ---- SNMP community strings ------------------------------------------ */

  /* Minimal BER walk: SEQUENCE { INTEGER version, OCTET STRING community }.
     The community string is a password in every meaningful sense and v1/v2c
     sends it unencrypted, so it belongs in the credential list. */
  function scanSnmp(b, off, end, ctx, src, dst, port) {
    if (end - off < 8 || b[off] !== 0x30) return;
    var p = off + 1;
    var len = b[p++];
    if (len & 0x80) p += (len & 0x7f);            // long-form length
    if (p + 2 > end || b[p] !== 0x02) return;     // version INTEGER
    var vlen = b[p + 1];
    if (vlen !== 1 || p + 3 > end) return;
    var version = b[p + 2];
    if (version > 1) return;                      // v3 has real security
    p += 3;
    if (p + 2 > end || b[p] !== 0x04) return;     // community OCTET STRING
    var clen = b[p + 1];
    if (clen & 0x80 || p + 2 + clen > end) return;
    var community = ascii(b, p + 2, p + 2 + clen);
    addCred(ctx, {
      proto: 'SNMP v' + (version + 1) + 'c',
      where: src + ' → ' + ep(dst, port),
      fields: [['community', community]],
      note: 'A v1/v2c community string is a shared password sent in the clear on every request.'
    });
  }

  /* ======================================================================
     Credential and application-layer scanning
     ====================================================================== */

  function addCred(ctx, rec) {
    if (ctx.creds.length >= MAX_CREDS) { ctx.credsFull = true; return; }
    var parts = [rec.proto, rec.where];
    for (var i = 0; i < rec.fields.length; i++) parts.push(rec.fields[i][1]);
    var key = parts.join('\u0000');
    if (ctx.credSeen[key]) return;                // the same login often repeats
    ctx.credSeen[key] = true;
    ctx.creds.push(rec);
  }

  function parseHeaders(block) {
    var lines = block.split(/\r?\n/), h = {};
    for (var i = 0; i < lines.length; i++) {
      var c = lines[i].indexOf(':');
      if (c < 1) continue;
      var name = lines[i].slice(0, c).toLowerCase();
      var value = lines[i].slice(c + 1).replace(/^\s+|\s+$/g, '');
      /* Cookie and Set-Cookie legitimately repeat; joining beats overwriting
         because the interesting one is rarely the last. */
      h[name] = (h[name] === undefined) ? value : (h[name] + '; ' + value);
    }
    return h;
  }

  var SECRET_NAME = /pass|pwd|passwd|secret|token|auth|apikey|api_key|otp|pin|credential|sessionid|jsessionid|phpsessid/i;
  var USER_NAME = /^(user|username|uname|login|logon|email|e-?mail|account|acct|userid|user_id|usr|id)$/i;

  /* Pull name=value pairs out of a query string or an urlencoded body and
     split them into "looks like a secret" and "looks like an identity". */
  function scanFields(text) {
    var found = { users: [], secrets: [] };
    if (!text) return found;
    var re = /([^=&?;\s]{1,80})=([^&;\r\n]{0,300})/g, m, seen = 0;
    while ((m = re.exec(text)) !== null && seen < 60) {
      seen++;
      var name = urlDecode(m[1]);
      var value = urlDecode(m[2]);
      if (!value) continue;
      if (SECRET_NAME.test(name)) found.secrets.push([name, value]);
      else if (USER_NAME.test(name)) found.users.push([name, value]);
    }
    /* JSON bodies are just as common as form posts on modern logins. */
    var jre = /"([^"\\]{1,60})"\s*:\s*"([^"\\]{0,300})"/g;
    while ((m = jre.exec(text)) !== null && seen < 120) {
      seen++;
      if (SECRET_NAME.test(m[1])) found.secrets.push([m[1], m[2]]);
      else if (USER_NAME.test(m[1])) found.users.push([m[1], m[2]]);
    }
    return found;
  }

  var REQ_RE = /(?:^|\r?\n)(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|TRACE|CONNECT|PROPFIND|MKCOL|REPORT) ([^ \r\n]{1,2000}) HTTP\/(\d\.\d)\r?\n/g;

  function scanHttp(f, ctx) {
    var text = f.text, m, seen = 0;
    var where = f.srcIp + ' → ' + ep(f.dstIp, f.dstPort);
    REQ_RE.lastIndex = 0;
    while ((m = REQ_RE.exec(text)) !== null && seen < 80) {
      seen++;
      var hdrStart = m.index + m[0].length;
      var crlf = text.indexOf('\r\n\r\n', hdrStart);
      var lflf = text.indexOf('\n\n', hdrStart);
      var hdrEnd, bodyStart;
      if (crlf >= 0 && (lflf < 0 || crlf <= lflf)) { hdrEnd = crlf; bodyStart = crlf + 4; }
      else if (lflf >= 0) { hdrEnd = lflf; bodyStart = lflf + 2; }
      else { hdrEnd = text.length; bodyStart = text.length; }

      var headers = parseHeaders(text.slice(hdrStart, hdrEnd));
      var method = m[1], path = m[2];
      var host = headers.host || f.dstIp;
      var body = '';
      if (bodyStart < text.length) {
        var clen = parseInt(headers['content-length'], 10);
        var stop = (clen > 0 && bodyStart + clen <= text.length)
                 ? bodyStart + clen : Math.min(text.length, bodyStart + 4096);
        body = text.slice(bodyStart, stop);
      }

      ctx.httpTotal++;
      if (ctx.http.length < MAX_HTTP) {
        ctx.http.push({
          method: method, host: host, path: path,
          ua: headers['user-agent'] || '', client: f.srcIp,
          referer: headers.referer || ''
        });
      }

      // --- HTTP Basic / Proxy-Basic ------------------------------------
      var authHeaders = ['authorization', 'proxy-authorization'];
      for (var a = 0; a < authHeaders.length; a++) {
        var auth = headers[authHeaders[a]];
        if (!auth) continue;
        var basic = /^\s*basic\s+([A-Za-z0-9+/=]+)/i.exec(auth);
        if (basic) {
          var decoded = b64decode(basic[1]);
          if (decoded !== null) {
            var colon = decoded.indexOf(':');
            addCred(ctx, {
              proto: 'HTTP Basic auth',
              where: where + '  ' + method + ' http://' + host + path.slice(0, 80),
              fields: [
                ['username', colon >= 0 ? decoded.slice(0, colon) : decoded],
                ['password', colon >= 0 ? decoded.slice(colon + 1) : '(no colon in the decoded value)'],
                ['header', 'Authorization: Basic ' + basic[1].slice(0, 40)]
              ],
              note: 'Basic auth is base64, not encryption. Anyone on the path reads it by decoding one field.'
            });
          }
          continue;
        }
        var bearer = /^\s*(bearer|digest|negotiate|ntlm)\s+(.+)$/i.exec(auth);
        if (bearer) {
          addCred(ctx, {
            proto: 'HTTP ' + bearer[1].toUpperCase() + ' credential',
            where: where + '  ' + method + ' ' + path.slice(0, 80),
            fields: [['value', bearer[2].slice(0, 120)]],
            note: bearer[1].toLowerCase() === 'bearer'
              ? 'A bearer token is a password substitute: whoever holds it is the user, until it expires.'
              : 'Not directly reversible, but it identifies the account and is replayable in some configurations.'
          });
        }
      }

      // --- Cookies -------------------------------------------------------
      if (headers.cookie) {
        addCred(ctx, {
          proto: 'HTTP Cookie',
          where: where + '  ' + host + path.slice(0, 60),
          fields: [['Cookie', headers.cookie]],
          note: 'Session cookies are bearer credentials. Captured over plain HTTP, this is enough to resume the session without the password.'
        });
      }

      // --- Credentials in the query string or the body -------------------
      var qmark = path.indexOf('?');
      var sources = [];
      if (qmark >= 0) sources.push(['query string', path.slice(qmark + 1)]);
      if (body) sources.push([method + ' body', body]);
      for (var s = 0; s < sources.length; s++) {
        var fields = scanFields(sources[s][1]);
        if (!fields.secrets.length) continue;
        var list = [];
        for (var u = 0; u < fields.users.length && u < 3; u++) {
          list.push([fields.users[u][0], fields.users[u][1]]);
        }
        for (var p = 0; p < fields.secrets.length && p < 4; p++) {
          list.push([fields.secrets[p][0], fields.secrets[p][1]]);
        }
        addCred(ctx, {
          proto: 'HTTP form post (' + sources[s][0] + ')',
          where: where + '  ' + method + ' http://' + host + path.split('?')[0].slice(0, 70),
          fields: list,
          note: sources[s][0] === 'query string'
            ? 'A password in the URL also lands in browser history, proxy logs and the Referer header of the next request.'
            : 'A login form over plain HTTP hands the password to every device between the browser and the server.'
        });
      }

      if (REQ_RE.lastIndex < hdrEnd) REQ_RE.lastIndex = hdrEnd;
    }
  }

  function scanFtpLike(f, ctx, label) {
    var text = f.text;
    var user = /^USER[ \t]+([^\r\n]{1,120})/im.exec(text);
    var pass = /^PASS[ \t]+([^\r\n]{1,120})/im.exec(text);
    var apop = /^APOP[ \t]+([^\r\n]{1,120})/im.exec(text);
    var where = f.srcIp + ' → ' + ep(f.dstIp, f.dstPort);
    if (user || pass) {
      addCred(ctx, {
        proto: label,
        where: where,
        fields: [
          ['username', user ? user[1] : '(not captured)'],
          ['password', pass ? pass[1] : '(not captured — the PASS line may be past the buffer or the snaplen)']
        ],
        note: label === 'FTP'
          ? 'FTP sends the login as two plain commands. So are the file names, and so is the data on the second connection.'
          : 'POP3 USER/PASS is plaintext. The whole mailbox that follows is too.'
      });
    }
    if (apop) {
      addCred(ctx, {
        proto: label + ' APOP',
        where: where,
        fields: [['APOP', apop[1]]],
        note: 'APOP hashes the password with a server challenge — not readable directly, but crackable offline from this capture.'
      });
    }
  }

  function scanImap(f, ctx) {
    var re = /^(\S{1,20})[ \t]+LOGIN[ \t]+"?([^"\s]{1,120})"?[ \t]+"?([^"\r\n]{1,120}?)"?[ \t]*\r?$/im;
    var m = re.exec(f.text);
    if (!m) return;
    addCred(ctx, {
      proto: 'IMAP LOGIN',
      where: f.srcIp + ' → ' + ep(f.dstIp, f.dstPort),
      fields: [['username', m[2]], ['password', m[3]]],
      note: 'The IMAP LOGIN command is plaintext. Only STARTTLS before it, or IMAPS on 993, protects it.'
    });
  }

  function scanSmtp(f, ctx) {
    var text = f.text;
    var where = f.srcIp + ' → ' + ep(f.dstIp, f.dstPort);

    /* AUTH LOGIN is a three-step dance: the client says AUTH LOGIN, the
       server base64-prompts, the client sends base64(user) then
       base64(pass). In a client-side buffer those land as two bare lines. */
    var login = /AUTH[ \t]+LOGIN[^\r\n]*\r?\n([A-Za-z0-9+/=]{4,})\r?\n(?:([A-Za-z0-9+/=]{4,})\r?\n)?/i.exec(text);
    if (login) {
      var user = b64decode(login[1]);
      var pass = login[2] ? b64decode(login[2]) : null;
      addCred(ctx, {
        proto: 'SMTP AUTH LOGIN',
        where: where,
        fields: [
          ['username', user === null ? login[1] + ' (not valid base64)' : user],
          ['password', pass === null ? '(second line not captured)' : pass]
        ],
        note: 'AUTH LOGIN base64-encodes the credentials for transport. That is an encoding, not a secret.'
      });
    }
    var plain = /AUTH[ \t]+PLAIN[ \t]+([A-Za-z0-9+/=]{4,})/i.exec(text);
    if (plain) {
      var raw = b64decode(plain[1]);
      if (raw !== null) {
        /* RFC 4616: authzid NUL authcid NUL password, all in one blob. */
        var parts = raw.split('\u0000');
        addCred(ctx, {
          proto: 'SMTP AUTH PLAIN',
          where: where,
          fields: [
            ['username', parts.length > 1 ? parts[1] : parts[0]],
            ['password', parts.length > 2 ? parts[2] : '(malformed SASL PLAIN blob)']
          ],
          note: 'SASL PLAIN is the username and password separated by NUL bytes and base64-wrapped. Trivially reversible.'
        });
      }
    }
    if (/AUTH[ \t]+CRAM-MD5/i.test(text)) {
      addCred(ctx, {
        proto: 'SMTP AUTH CRAM-MD5',
        where: where,
        fields: [['mechanism', 'CRAM-MD5 challenge-response observed']],
        note: 'Not directly readable, but the challenge and response are both in this capture and MD5 is cheap to attack offline.'
      });
    }
  }

  /* Telnet interleaves option negotiation with the data stream: 0xFF (IAC)
     introduces a two- or three-byte command, and 0xFF 0xFA starts a
     subnegotiation that runs to 0xFF 0xF0. Strip all of it or the "session"
     is unreadable binary noise. */
  function stripTelnet(text) {
    var res = '', i = 0;
    while (i < text.length) {
      var c = text.charCodeAt(i);
      if (c === 255) {
        var next = text.charCodeAt(i + 1);
        if (next === 255) { res += '\u00ff'; i += 2; continue; }   // escaped literal
        if (next === 250) {
          var endSb = text.indexOf('\u00ff\u00f0', i + 2);
          i = (endSb < 0) ? text.length : endSb + 2;
          continue;
        }
        if (next >= 251 && next <= 254) { i += 3; continue; }      // WILL/WONT/DO/DONT
        i += 2;
        continue;
      }
      res += text.charAt(i);
      i++;
    }
    return res;
  }

  function scanTelnet(f, ctx, ctxFlows) {
    var typed = stripTelnet(f.text)
      .replace(/\r\u0000/g, '\n')      // telnet sends CR NUL for a bare return
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u0008|\u007f/g, '');  // backspaces the user typed

    /* The server's echo is in the other direction; the client direction is
       the raw keystrokes, which is where the password lives — it is never
       echoed, so this is the only place it appears. */
    var reverse = ctxFlows[f.dstIp + '|' + f.dstPort + '>' + f.srcIp + '|' + f.srcPort];
    var prompt = reverse ? stripTelnet(reverse.text) : '';
    var sawPrompt = /login:|username:|password:/i.test(prompt);

    var lines = typed.split('\n');
    var useful = [];
    for (var i = 0; i < lines.length && useful.length < 8; i++) {
      var line = lines[i].replace(/[\u0000-\u001f]/g, '');
      if (line.length) useful.push(line);
    }
    if (!useful.length) return;

    var fields = [];
    if (sawPrompt && useful.length >= 2) {
      fields.push(['username (typed)', useful[0]]);
      fields.push(['password (typed)', useful[1]]);
      for (var j = 2; j < useful.length && j < 6; j++) fields.push(['then typed', useful[j]]);
    } else {
      for (var k = 0; k < useful.length && k < 6; k++) fields.push(['keystrokes', useful[k]]);
    }
    addCred(ctx, {
      proto: 'Telnet session' + (sawPrompt ? ' (login prompt seen)' : ''),
      where: f.srcIp + ' → ' + ep(f.dstIp, f.dstPort),
      fields: fields,
      note: 'Telnet transmits every keystroke unencrypted. The password is not echoed back, so it appears only in the client-to-server direction — which is this.'
    });
  }

  function scanFlows(ctx) {
    var gappy = 0;
    for (var i = 0; i < ctx.flowKeys.length; i++) {
      var f = ctx.flows[ctx.flowKeys[i]];
      if (!f || !f.text) continue;
      /* A sequence-number jump left a hole in this direction's buffer, so the
         text the credential scan runs over is missing a segment. Surface it —
         a scan across a gap is not a clean bill of health. */
      if (f.gaps) gappy++;
      var dp = f.dstPort;
      try {
        /* Credentials travel client → server, so only scan the direction
           whose destination is the service port. Scanning both would report
           the server's own banner text as a login. */
        if (dp === 21) scanFtpLike(f, ctx, 'FTP');
        if (dp === 110) scanFtpLike(f, ctx, 'POP3');
        if (dp === 143) scanImap(f, ctx);
        if (dp === 25 || dp === 587 || dp === 465) scanSmtp(f, ctx);
        if (dp === 23 || dp === 992) scanTelnet(f, ctx, ctx.flows);
        if (/HTTP\/\d\.\d/.test(f.text)) scanHttp(f, ctx);
      } catch (err) {
        ctx.notes.push('A flow scan failed (' + (err && err.message ? err.message : err) + ') and was skipped.');
      }
    }
    if (gappy) {
      ctx.notes.push(plural(gappy, 'buffered TCP direction') +
        ' had a sequence gap: a segment is missing from the capture, so the text ' +
        'scanned for credentials has a hole in it and something may have been missed.');
    }
  }

  /* ======================================================================
     Driver
     ====================================================================== */

  function analyse(bytes, file) {
    var ctx = newContext();
    ctx.fileName = file.name;
    ctx.fileSize = bytes.length;

    if (bytes.length < 24) {
      ctx.fatal = 'This file is ' + bytes.length + ' bytes. A pcap global header alone is 24.';
      render(ctx);
      return;
    }

    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var magic = dv.getUint32(0, false);

    function onPacket(off, end, ts, wireLen, linkType) {
      ctx.packets++;
      var capLen = end - off;
      ctx.capturedBytes += capLen;
      ctx.wireBytes += wireLen;
      if (wireLen > capLen) ctx.truncatedPackets++;
      if (ts !== null) {
        if (ctx.first === null || ts < ctx.first) ctx.first = ts;
        if (ctx.last === null || ts > ctx.last) ctx.last = ts;
      }
      if (ctx.linkTypes[linkType] === undefined) ctx.linkTypes[linkType] = 0;
      ctx.linkTypes[linkType]++;
      /* Past the cap we keep walking — counting packets and bytes is cheap
         and the summary should describe the whole file — but we stop
         dissecting, which is where all the cost is. */
      if (ctx.dissected >= MAX_DISSECT) return;
      ctx.dissected++;
      try {
        dissect(bytes, dv, off, end, linkType, ts, wireLen, ctx);
      } catch (err) {
        ctx.malformed++;
      }
    }

    var handled = false;
    if (magic === 0x0a0d0d0a) {
      handled = parseNg(bytes, dv, ctx, onPacket);
    } else {
      handled = parseClassic(bytes, dv, ctx, onPacket);
    }

    if (!handled) {
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        ctx.fatal = 'This is a gzip file (magic 1f 8b), almost certainly a .pcap.gz. Decompress it first — gunzip, 7-Zip, or Wireshark, which opens them directly.';
      } else if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) {
        ctx.fatal = 'This is a zstd-compressed file. Decompress it first.';
      } else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        ctx.fatal = 'This is a ZIP archive. Extract the capture from it first.';
      } else if (bytes[0] === 0x54 && bytes[1] === 0x5a && bytes[2] === 0x69 && bytes[3] === 0x66) {
        ctx.fatal = 'This looks like an EtherPeek/TZif file, not pcap.';
      } else if (magic === 0x0a0d0d0a) {
        /* The file DID start with the pcapng Section Header Block magic, but
           the section header itself could not be read — so do not claim the
           magic is absent. Surface the parser's actual diagnosis instead. */
        ctx.fatal = 'This file starts with the pcapng Section Header Block magic, but its ' +
                    'section header could not be read. ' +
                    (ctx.notes.length ? ctx.notes[ctx.notes.length - 1] : '');
      } else {
        ctx.fatal = 'No pcap or pcapng magic at the start of this file. The first eight bytes are ' +
                    LabTool.toHex(bytes.subarray(0, 8)) + '. Expected d4c3b2a1 / a1b2c3d4 (classic pcap, ' +
                    'either byte order), 4d3cb2a1 / a1b23c4d (nanosecond pcap) or 0a0d0d0a (pcapng).';
      }
      render(ctx);
      return;
    }

    scanFlows(ctx);
    render(ctx);
  }

  /* ======================================================================
     Report
     ====================================================================== */

  function render(ctx) {
    out.clear();
    out.heading(ctx.fileName + '  —  ' + LabTool.humanBytes(ctx.fileSize));

    if (ctx.fatal) {
      out.line('');
      out.err(ctx.fatal);
      out.line('');
      out.dim('Nothing was uploaded. The file was read into this tab and');
      out.dim('nothing else happened to it.');
      return;
    }

    // ---- summary -------------------------------------------------------
    out.rule();
    out.heading('Capture summary');
    out.row('format', ctx.format + (ctx.versionText ? '  v' + ctx.versionText : ''));
    out.row('byte order', ctx.endian);

    var ltKeys = Object.keys(ctx.linkTypes);
    for (var i = 0; i < ltKeys.length && i < 4; i++) {
      var lt = ltKeys[i];
      out.row(i === 0 ? 'link type' : '', lt + ' — ' + (LINKTYPES[lt] || 'unknown') +
              (ctx.linkTypes[lt] ? '  (' + plural(ctx.linkTypes[lt], 'packet') + ')' : ''));
    }
    if (ctx.snaplen) out.row('snapshot length', num(ctx.snaplen) + ' bytes');
    out.row('packets', num(ctx.packets));
    out.row('bytes on the wire', LabTool.humanBytes(ctx.wireBytes) + '  (' + num(ctx.wireBytes) + ')');
    out.row('bytes captured', LabTool.humanBytes(ctx.capturedBytes) + '  (' + num(ctx.capturedBytes) + ')');
    out.row('first packet', fmtTime(ctx.first));
    out.row('last packet', fmtTime(ctx.last));

    var span = (ctx.first !== null && ctx.last !== null) ? (ctx.last - ctx.first) : null;
    if (span !== null) {
      out.row('duration', duration(span));
      if (span > 0.001) {
        out.row('average rate', num(Math.round(ctx.packets / span)) + ' packets/s · ' +
                (ctx.wireBytes * 8 / span / 1e6).toFixed(2) + ' Mbit/s');
      }
    }
    if (ctx.interfaces.length > 1) out.row('interfaces', ctx.interfaces.length + ' described in the file');

    if (ctx.dissected < ctx.packets) {
      out.line('');
      out.warn('TRUNCATED — dissected the first ' + num(ctx.dissected) + ' of ' + num(ctx.packets) +
               ' packets. Everything below this line describes that subset;');
      out.warn('the counts and timestamps above cover the whole file.');
    }
    if (ctx.truncatedPackets) {
      out.line('');
      out.warn(plural(ctx.truncatedPackets, 'packet') +
        (ctx.truncatedPackets === 1 ? ' was' : ' were') + ' cut short by the capture snaplen. Payload');
      out.warn('analysis on those is incomplete by definition — a password past the');
      out.warn('cut is simply not in this file.');
    }
    if (ctx.malformed) out.dim(plural(ctx.malformed, 'packet') + ' could not be dissected (short, malformed, or an unhandled encapsulation).');
    if (ctx.oddLengths) out.warn(plural(ctx.oddLengths, 'record') + ' claim a captured length larger than the original length, which is impossible. Treat this file as untrustworthy.');

    // ---- headline: credentials -----------------------------------------
    if (ctx.creds.length) {
      out.line('');
      out.err('>> ' + ctx.creds.length + (ctx.credsFull ? '+' : '') +
              ' cleartext credential' + (ctx.creds.length === 1 ? '' : 's') +
              ' recovered. Full detail below.');
    }

    // ---- protocol breakdown --------------------------------------------
    var l4Keys = topKeys(ctx.l4, 14);
    if (l4Keys.length) {
      var total = 0, k;
      for (k in ctx.l4) if (Object.prototype.hasOwnProperty.call(ctx.l4, k)) total += ctx.l4[k];
      out.rule();
      out.heading('Protocol breakdown  (' + plural(total, 'packet') + ' dissected)');
      for (i = 0; i < l4Keys.length; i++) {
        var count = ctx.l4[l4Keys[i]];
        out.write(pad(l4Keys[i], 22), 't-dim');
        out.write(pad(num(count), 9));
        out.write(bar(count / total, 26), 't-ok');
        out.line('  ' + pct(count, total));
      }
      var icmpKeys = topKeys(ctx.icmp, 8);
      for (i = 0; i < icmpKeys.length; i++) {
        out.row('  ' + icmpKeys[i], num(ctx.icmp[icmpKeys[i]]));
      }
      var l3Keys = topKeys(ctx.l3, 6);
      if (l3Keys.length) {
        var l3Line = [];
        for (i = 0; i < l3Keys.length; i++) l3Line.push(l3Keys[i] + ' ' + num(ctx.l3[l3Keys[i]]));
        out.line('');
        out.row('network layer', l3Line.join('   '));
      }
      var vlanKeys = Object.keys(ctx.vlans);
      if (vlanKeys.length) {
        out.row('802.1Q VLANs', 'VLAN ' + vlanKeys.slice(0, 12).join(', ') +
                (vlanKeys.length > 12 ? ' … (' + vlanKeys.length + ' total)' : ''));
      }
      if (ctx.fragments) out.row('IP fragments', num(ctx.fragments) + ' — payload spanning fragments is not reassembled here');
    }

    // ---- talkers --------------------------------------------------------
    var pairKeys = Object.keys(ctx.pairs);
    if (pairKeys.length) {
      pairKeys.sort(function (a, b) { return ctx.pairs[b].bytes - ctx.pairs[a].bytes; });
      out.rule();
      out.heading('Top talkers by IP pair  (' + plural(pairKeys.length, 'pair') + ' seen)');
      for (i = 0; i < pairKeys.length && i < 15; i++) {
        var pr = ctx.pairs[pairKeys[i]];
        out.write(pad(pr.a + '  ⇄  ' + pr.b, 46));
        out.write(pad(plural(pr.packets, 'pkt'), 14), 't-dim');
        out.line(LabTool.humanBytes(pr.bytes), 't-dim');
      }
      if (ctx.pairsFull) out.dim('(address-pair table hit its ' + num(MAX_PAIRS) + '-entry cap; later pairs were not counted)');
    }

    // ---- ports ----------------------------------------------------------
    var portKeys = topKeys(ctx.ports, 15);
    if (portKeys.length) {
      out.rule();
      out.heading('Top ports');
      for (i = 0; i < portKeys.length; i++) {
        var portNum = parseInt(portKeys[i].split('/')[1], 10);
        var name = PORTS[portNum] || '';
        var cls = CLEARTEXT[portNum] ? 't-warn' : (ENCRYPTED_PORTS[portNum] ? 't-ok' : null);
        out.write(pad(portKeys[i], 14));
        out.write(pad(name, 20), cls);
        out.line(plural(ctx.ports[portKeys[i]], 'packet'), 't-dim');
      }
      out.dim('Port is attributed to whichever end looks like the service.');
    }

    // ---- TCP conversations ---------------------------------------------
    var convKeys = Object.keys(ctx.convs);
    if (convKeys.length) {
      convKeys.sort(function (a, b) { return ctx.convs[b].packets - ctx.convs[a].packets; });
      out.rule();
      out.heading('TCP conversations  (' + num(convKeys.length) + ' seen)');
      for (i = 0; i < convKeys.length && i < 25; i++) {
        var c = ctx.convs[convKeys[i]];
        var state = connectionState(c);
        var epA = ep(c.aIp, c.aPort), epB = ep(c.bIp, c.bPort);
        /* The stored key is sorted so both directions collapse into one row.
           For display, put whoever sent the SYN on the left — "who connected
           to whom" is the question an analyst is actually asking. */
        var left = (c.initiator === epB) ? (epB + ' → ' + epA) : (epA + ' → ' + epB);
        out.write(pad(left, 48));
        out.line(state[0], state[1]);
        var seen = [c.syn ? c.syn + '×SYN' : '', c.synack ? c.synack + '×SYN-ACK' : '',
                    c.fin ? c.fin + '×FIN' : '', c.rst ? c.rst + '×RST' : '']
          .filter(function (x) { return x; }).join(' ');
        out.write(pad('', 48), 't-dim');
        out.line(plural(c.packets, 'pkt') + ' · ' + LabTool.humanBytes(c.bytes) +
                 (seen ? ' · ' + seen : ' · no control flags seen') +
                 (c.first !== null && c.last !== null && c.last > c.first
                   ? ' · ' + duration(c.last - c.first) : ''),
                 't-dim');
      }
      if (convKeys.length > 25) out.dim('… ' + num(convKeys.length - 25) + ' more conversations not shown.');
      if (ctx.convsFull) out.dim('(conversation table hit its ' + num(MAX_CONVS) + '-entry cap)');

      // scan detection, computed from the conversation table
      var scanners = {};
      for (i = 0; i < convKeys.length; i++) {
        var sc = ctx.convs[convKeys[i]];
        if (sc.syn > 0 && sc.synack === 0 && sc.initiator) {
          var who = sc.initiator.split(']:').length > 1
            ? sc.initiator.slice(1, sc.initiator.lastIndexOf(']'))
            : sc.initiator.split(':')[0];
          if (!scanners[who]) scanners[who] = 0;
          scanners[who]++;
        }
      }
      var scanKeys = Object.keys(scanners).filter(function (s) { return scanners[s] >= 15; });
      if (scanKeys.length) {
        out.line('');
        for (i = 0; i < scanKeys.length && i < 5; i++) {
          out.warn(scanKeys[i] + ' opened ' + num(scanners[scanKeys[i]]) +
                   ' TCP connections that were never answered — that shape is a port scan.');
        }
      }
    }

    // ---- credentials, the headline -------------------------------------
    out.rule();
    out.heading('Cleartext credentials');
    if (!ctx.creds.length) {
      out.ok('None found.');
      out.dim('That is a real result, not an error — but read it narrowly. It means');
      out.dim('no credential appeared in the plaintext protocols this tool parses,');
      out.dim('within the first ' + num(MAX_DISSECT) + ' packets and the buffered part of each');
      out.dim('flow. Encrypted traffic is not decrypted here and never will be.');
    } else {
      out.err(ctx.creds.length + ' recovered, by reading the bytes. No cracking, no guessing.');
      out.line('');
      for (i = 0; i < ctx.creds.length; i++) {
        var cred = ctx.creds[i];
        out.line((i + 1) + '. ' + cred.proto, 't-err');
        out.row('   on', safeText(cred.where, 110));
        for (var fi = 0; fi < cred.fields.length; fi++) {
          out.row('   ' + cred.fields[fi][0], safeText(cred.fields[fi][1], 200), 't-warn');
        }
        if (cred.note) out.dim('   ' + cred.note);
        out.line('');
      }
      if (ctx.credsFull) out.warn('Stopped at ' + MAX_CREDS + ' credentials; there are more in this file.');
      out.dim('Every value above travelled in the clear. Any device on the path —');
      out.dim('a switch, a router, a hotel access point, anyone on the same wifi —');
      out.dim('could read it with no more effort than this took.');
    }
    if (ctx.flowsFull) {
      out.line('');
      out.dim('The credential scanner\'s flow buffers filled up, so later flows were');
      out.dim('not examined. The caps are ' + num(MAX_FLOWS) + ' directions and ' +
              LabTool.humanBytes(FLOW_CHARS) + ' each.');
    }

    // ---- DNS ------------------------------------------------------------
    if (ctx.dnsKeys.length) {
      out.rule();
      out.heading('DNS queries  (' + plural(ctx.dnsQueries, 'question') + ', ' + num(ctx.dnsKeys.length) + ' distinct)');
      var dnsSorted = ctx.dnsKeys.slice(0);
      dnsSorted.sort(function (a, b) { return ctx.dns[b].count - ctx.dns[a].count; });
      for (i = 0; i < dnsSorted.length && i < 40; i++) {
        var d = ctx.dns[dnsSorted[i]];
        var sp = dnsSorted[i].indexOf(' ');
        out.write(pad(dnsSorted[i].slice(0, sp), 8), 't-dim');
        out.write(pad(safeText(dnsSorted[i].slice(sp + 1), 60), 62));
        out.write(pad('×' + d.count, 6), 't-dim');
        out.line(d.answers.length ? '→ ' + d.answers.join(', ') : (d.nx ? '→ NXDOMAIN' : ''),
                 d.nx ? 't-warn' : 't-dim');
      }
      if (dnsSorted.length > 40) out.dim('… ' + num(dnsSorted.length - 40) + ' more names not shown.');
      if (ctx.dnsKeys.length >= MAX_DNS_KEYS) out.dim('(name table hit its ' + MAX_DNS_KEYS + '-entry cap)');
      out.dim('DNS is unencrypted unless it is DoH or DoT, so this list is visible');
      out.dim('to the network too — it is a record of what was visited.');
    }

    // ---- HTTP -----------------------------------------------------------
    if (ctx.http.length) {
      out.rule();
      out.heading('HTTP requests  (' + num(ctx.httpTotal) + ' seen)');
      for (i = 0; i < ctx.http.length && i < 40; i++) {
        var h = ctx.http[i];
        out.write(pad(h.method, 8), 't-info');
        out.line(safeText(h.host + h.path, 120));
        out.write(pad('', 8));
        out.line('from ' + h.client + (h.ua ? ' · ' + safeText(h.ua, 90) : ' · no User-Agent'), 't-dim');
        /* Referer leaks the page the user was on when they clicked, which is
           often more revealing than the request itself. */
        if (h.referer) {
          out.write(pad('', 8));
          out.line('referred by ' + safeText(h.referer, 100), 't-dim');
        }
      }
      if (ctx.http.length > 40) out.dim('… ' + num(ctx.http.length - 40) + ' more requests parsed but not shown.');
      if (ctx.httpTotal > MAX_HTTP) out.dim('(request list hit its ' + MAX_HTTP + '-entry cap)');
    }

    // ---- ARP ------------------------------------------------------------
    var arpIps = Object.keys(ctx.arp);
    if (arpIps.length) {
      var conflicts = [];
      for (i = 0; i < arpIps.length; i++) {
        if (Object.keys(ctx.arp[arpIps[i]]).length > 1) conflicts.push(arpIps[i]);
      }
      out.rule();
      out.heading('ARP');
      var opList = Object.keys(ctx.arpOps);
      for (i = 0; i < opList.length; i++) out.row(opList[i], num(ctx.arpOps[opList[i]]));
      out.row('addresses claimed', num(arpIps.length));
      if (conflicts.length) {
        out.line('');
        for (i = 0; i < conflicts.length && i < 8; i++) {
          out.err(conflicts[i] + ' was claimed by ' + Object.keys(ctx.arp[conflicts[i]]).join(' and '));
        }
        out.warn('One IP claimed by several MAC addresses is either a failover, a');
        out.warn('roaming client, or ARP spoofing — the capture cannot tell you');
        out.warn('which, but it is worth explaining before you move on.');
      }
    }

    // ---- unencrypted protocols -----------------------------------------
    out.rule();
    out.heading('Unencrypted protocols in use');
    var flagged = [], encryptedPkts = 0, cleartextPkts = 0;
    var allPorts = Object.keys(ctx.ports);
    for (i = 0; i < allPorts.length; i++) {
      var pk = allPorts[i];
      var pn = parseInt(pk.split('/')[1], 10);
      if (CLEARTEXT[pn]) { flagged.push([pk, pn, ctx.ports[pk]]); cleartextPkts += ctx.ports[pk]; }
      if (ENCRYPTED_PORTS[pn]) encryptedPkts += ctx.ports[pk];
    }
    if (!flagged.length) {
      out.ok('No traffic on the plaintext service ports this tool knows about.');
    } else {
      flagged.sort(function (a, b) { return b[2] - a[2]; });
      for (i = 0; i < flagged.length; i++) {
        out.write(pad(CLEARTEXT[flagged[i][1]][0] + ' (' + flagged[i][0] + ')', 26), 't-warn');
        out.line(plural(flagged[i][2], 'packet'));
        out.dim('   ' + CLEARTEXT[flagged[i][1]][1]);
      }
    }
    if (encryptedPkts || cleartextPkts) {
      out.line('');
      out.row('on encrypted ports', plural(encryptedPkts, 'packet'), 't-ok');
      out.row('on plaintext ports', plural(cleartextPkts, 'packet'), cleartextPkts ? 't-warn' : 't-ok');
      out.dim('Counted by port number, which is a guess about intent — traffic on');
      out.dim('443 is almost certainly TLS, but nothing here verifies that.');
    }

    // ---- notes ----------------------------------------------------------
    if (ctx.notes.length) {
      out.rule();
      out.heading('Parser notes');
      for (i = 0; i < ctx.notes.length && i < 12; i++) out.warn(ctx.notes[i]);
    }

    out.rule();
    out.dim('What this does not do: decrypt TLS, reassemble across missing TCP');
    out.dim('segments, follow tunnels (GRE, IPsec, VXLAN), or dissect 802.11.');
    out.dim('For any of that, open the file in Wireshark. Nothing was uploaded —');
    out.dim('every number above was computed from the bytes in this tab.');
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function handleFile(bytes, file) {
    lastBytes = bytes;
    lastFile = file;
    out.clear();
    out.heading(file.name);
    out.dim('Parsing ' + LabTool.humanBytes(bytes.length) + ' …');
    /* Yield once so the pane actually paints that line before a large file
       blocks the thread for a second or two. */
    setTimeout(function () {
      try {
        analyse(bytes, file);
      } catch (err) {
        out.line('');
        out.err('The parser stopped: ' + (err && err.message ? err.message : String(err)));
        out.dim('That is a bug or a file shaped in a way this tool did not expect.');
        out.dim('Nothing was uploaded, and nothing else on the page is affected.');
      }
    }, 16);
  }

  LabTool.define({
    id: 'pcapanalyzertool',
    run: function () {
      if (lastBytes && lastFile) handleFile(lastBytes, lastFile);
      else out.clear().warn('Choose or drop a .pcap or .pcapng file first.');
    },
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop',
        inputId: 'tool-file',
        maxBytes: MAX_FILE,
        onFile: function (bytes, file) {
          var label = document.getElementById('tool-dropname');
          if (label) label.textContent = file.name;
          handleFile(bytes, file);
        },
        onError: function (msg) { out.clear().err(msg); }
      });
      out.dim('Drop a .pcap or .pcapng capture above.');
      out.dim('');
      out.dim('It is parsed here — classic pcap in either byte order, the');
      out.dim('nanosecond variants, and pcapng blocks — then dissected down');
      out.dim('through Ethernet, VLAN, IPv4/IPv6, TCP, UDP, ICMP and ARP.');
      out.dim('The plaintext protocols get read: HTTP, FTP, Telnet, SMTP,');
      out.dim('POP3, IMAP, DNS and SNMP, including any credentials in them.');
      out.dim('');
      out.dim('A capture is other people\'s traffic. That is exactly why this');
      out.dim('one never leaves the tab — no upload, no request, no exception.');
    }
  });
})();

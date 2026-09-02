/* ==========================================================================
   subnet.js — CIDR maths, and what an address actually is.
   --------------------------------------------------------------------------
   Subnetting is arithmetic, so there is no excuse for a tool that does it on
   a server. Given a CIDR block this prints the network and broadcast address,
   the usable host range, the mask in every notation people use, and the
   binary — because the binary is the part that makes the /24 finally click.

   It also classifies the address: private, loopback, link-local, CGNAT,
   multicast, documentation. Knowing that 100.64.0.0/10 is carrier-grade NAT
   and not a public address saves a lot of confused firewall rules.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  var SPECIAL = [
    ['0.0.0.0/8',        'this network — a source-only address'],
    ['10.0.0.0/8',       'private (RFC 1918) — not routable on the internet'],
    ['100.64.0.0/10',    'carrier-grade NAT (RFC 6598) — your ISP’s, not yours'],
    ['127.0.0.0/8',      'loopback — never leaves the machine'],
    ['169.254.0.0/16',   'link-local (APIPA) — DHCP failed and it self-assigned'],
    ['172.16.0.0/12',    'private (RFC 1918) — not routable on the internet'],
    ['192.0.2.0/24',     'documentation (TEST-NET-1) — reserved for examples'],
    ['192.168.0.0/16',   'private (RFC 1918) — not routable on the internet'],
    ['198.18.0.0/15',    'benchmark testing (RFC 2544)'],
    ['198.51.100.0/24',  'documentation (TEST-NET-2) — reserved for examples'],
    ['203.0.113.0/24',   'documentation (TEST-NET-3) — reserved for examples'],
    ['224.0.0.0/4',      'multicast'],
    ['240.0.0.0/4',      'reserved for future use'],
    ['255.255.255.255/32', 'limited broadcast']
  ];

  function toInt(ip) {
    var parts = String(ip).trim().split('.');
    if (parts.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      var octet = Number(parts[i]);
      if (!/^\d+$/.test(parts[i]) || octet < 0 || octet > 255) return null;
      n = (n * 256) + octet;
    }
    return n;
  }

  function toIp(n) {
    n = n >>> 0;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }

  function toBinary(n) {
    n = n >>> 0;
    return [24, 16, 8, 0].map(function (s) {
      return ((n >>> s) & 255).toString(2).padStart(8, '0');
    }).join('.');
  }

  function inBlock(ipInt, cidr) {
    var parts = cidr.split('/');
    var base = toInt(parts[0]);
    var bits = Number(parts[1]);
    var mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) >>> 0 === (base & mask) >>> 0;
  }

  function run() {
    var input = document.getElementById('tool-text').value.trim();
    out.clear();
    if (!input) { out.warn('Enter an address like 192.168.1.10/24 or 10.0.0.0/8.'); return; }

    var bits, ipText;
    var slash = input.split('/');
    ipText = slash[0].trim();
    if (slash.length > 1) {
      // Accept both /24 and /255.255.255.0
      if (slash[1].indexOf('.') !== -1) {
        var maskText = slash[1].trim();
        var maskInt = toInt(maskText);
        if (maskInt === null) { out.err('That subnet mask is not valid.'); return; }
        bits = 0;
        var probe = maskInt >>> 0;
        while (probe & 0x80000000) { bits++; probe = (probe << 1) >>> 0; }

        /* Counting leading 1-bits is only a prefix length if the rest of the
           mask is zeroes. Without this check the count is silently believed:
           0.0.0.255 has no leading 1s, so it became /0 and the tool reported
           network 0.0.0.0/0 with 4,294,967,294 usable hosts — confidently, and
           with no error. 255.0.255.0 truncated to /8 the same way.

           0.0.0.255 is not a typo, either: it is a wildcard mask, which this
           page itself teaches further down, so it is exactly what someone will
           paste in. Naming it beats rejecting it. */
        var canon = bits === 0 ? 0 : ((0xffffffff << (32 - bits)) >>> 0);
        if (canon !== (maskInt >>> 0)) {
          var inverted = (~maskInt) >>> 0;
          var invBits = 0, invProbe = inverted;
          while (invProbe & 0x80000000) { invBits++; invProbe = (invProbe << 1) >>> 0; }
          var invCanon = invBits === 0 ? 0 : ((0xffffffff << (32 - invBits)) >>> 0);
          if (invCanon === inverted) {
            out.err('"' + maskText + '" is a wildcard mask, not a subnet mask.');
            out.dim('Wildcard masks are the bitwise inverse — Cisco ACLs use them.');
            out.dim('You probably meant /' + invBits + ' (' + toIp(invCanon) + ').');
          } else {
            out.err('"' + maskText + '" is not a contiguous subnet mask.');
            out.dim('A subnet mask has to be all 1s followed by all 0s, so the');
            out.dim('network part is a single unbroken run. 255.0.255.0 is not.');
          }
          return;
        }
      } else {
        /* Number() is the wrong parser to trust on its own here: Number('')
           is 0, so a trailing slash ("10.0.0.0/") silently produced a full /0
           sheet, and Number('2.5') is 2.5, which the 0–32 range check below
           happily accepts. A prefix length is a count of bits — a whole
           number, at most two digits. Anything else becomes NaN, which fails
           every comparison in the range check and lands on the same error
           message a /33 does. */
        var prefixText = slash[1].trim();
        bits = /^\d{1,2}$/.test(prefixText) ? Number(prefixText) : NaN;
      }
    } else {
      bits = 32;
      out.dim('No prefix given — treating it as a single host (/32).');
      out.line('');
    }

    var ipInt = toInt(ipText);
    if (ipInt === null) { out.err('"' + ipText + '" is not a valid IPv4 address.'); return; }
    if (!(bits >= 0 && bits <= 32)) { out.err('Prefix length must be a whole number between 0 and 32.'); return; }

    var mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    var wildcard = (~mask) >>> 0;
    var network = (ipInt & mask) >>> 0;
    var broadcast = (network | wildcard) >>> 0;
    var total = Math.pow(2, 32 - bits);
    var usable = bits >= 31 ? (bits === 32 ? 1 : 2) : total - 2;

    out.heading('Network');
    out.row('address given', toIp(ipInt));
    out.row('CIDR', toIp(network) + '/' + bits);
    out.row('network address', toIp(network));
    out.row('broadcast', bits >= 31 ? '(none at /' + bits + ')' : toIp(broadcast));
    if (bits <= 30) {
      out.row('usable hosts', toIp(network + 1) + ' – ' + toIp(broadcast - 1));
    }
    out.row('host count', usable.toLocaleString() + ' usable of ' + total.toLocaleString());
    if (bits === 31) {
      out.dim('    /31 is a point-to-point link (RFC 3021): two addresses, no');
      out.dim('    network or broadcast, both usable.');
    }

    out.rule();
    out.heading('Mask');
    out.row('prefix', '/' + bits);
    out.row('subnet mask', toIp(mask));
    out.row('wildcard mask', toIp(wildcard));
    out.dim('    wildcard is the inverted mask, used by Cisco ACLs');

    out.rule();
    out.heading('Binary');
    out.dim('the mask is just a run of ones — everything left of the boundary is');
    out.dim('the network, everything right of it is the host');
    out.line('');
    out.row('address', toBinary(ipInt));
    out.row('mask', toBinary(mask), 't-info');
    out.row('network', toBinary(network), 't-ok');
    out.line('');
    out.write('                      ', 't-dim');
    var pos = 0, marker = '';
    for (var i = 0; i < 32; i++) {
      marker += i < bits ? 'n' : 'h';
      if (i % 8 === 7 && i < 31) marker += '.';
    }
    out.line(marker, 't-dim');
    out.dim('n = network bits (' + bits + ')   h = host bits (' + (32 - bits) + ')');

    out.rule();
    out.heading('Classification');
    var matched = SPECIAL.filter(function (s) { return inBlock(ipInt, s[0]); });
    if (matched.length) {
      matched.forEach(function (s) {
        out.row(s[0], s[1], /private|loopback|link-local|CGNAT|carrier/.test(s[1]) ? 't-info' : 't-warn');
      });
    } else {
      out.ok('Public address — globally routable.');
      out.dim('Nothing here queries WHOIS, geolocation or any reputation service.');
      out.dim('Those all report what you are investigating to a third party.');
    }

    out.rule();
    out.heading('Splitting this block');
    out.dim('what you get if you subdivide /' + bits);
    for (var b = bits + 1; b <= Math.min(bits + 4, 32); b++) {
      var count = Math.pow(2, b - bits);
      var each = Math.pow(2, 32 - b);
      out.row('/' + b, count.toLocaleString() + ' subnets of ' +
              (b <= 30 ? (each - 2).toLocaleString() + ' usable hosts'
                       : each + ' addresses'));
    }

    out.rule();
    out.row('as integer', (network >>> 0).toLocaleString());
    out.row('as hex', '0x' + (network >>> 0).toString(16).padStart(8, '0'));
    out.row('reverse DNS', toIp(ipInt).split('.').reverse().join('.') + '.in-addr.arpa');
  }

  LabTool.define({
    id: 'subnettool',
    run: run,
    onReady: function () {
      document.getElementById('tool-text').addEventListener('input', function (e) {
        if (/\d\.\d/.test(e.target.value)) run();
      });
      out.dim('Enter a CIDR block — 192.168.1.10/24, 10.0.0.0/8, 172.16.5.4/255.255.0.0');
      out.dim('It updates as you type. Pure arithmetic, no lookups.');
    }
  });
})();

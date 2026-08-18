/* ==========================================================================
   email-headers.js — read the delivery path of a suspicious email.
   --------------------------------------------------------------------------
   The From: line is decoration. Anyone can write anything there. What actually
   records where a message came from is the Received: chain, plus the SPF, DKIM
   and DMARC results the receiving server stamped on it — and those are what
   this reads.

   Headers are among the most sensitive things a person can paste into a random
   website: they carry internal hostnames, IP addresses, recipient addresses and
   sometimes message content. Every popular header analyser is a web service.
   This one parses them in the tab, which is the only version of this tool that
   is safe to use on a real phishing report.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* Unfold RFC 5322 continuation lines, then split into name/value pairs.
     Order matters: Received headers are prepended, so the last one in the list
     is the first hop chronologically. */
  function parse(raw) {
    var text = String(raw).replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
    var headers = [];
    text.split('\n').forEach(function (line) {
      var m = line.match(/^([A-Za-z0-9-]+):\s*([\s\S]*)$/);
      if (m) headers.push({ name: m[1], value: m[2].trim() });
    });
    return headers;
  }

  function pick(headers, name) {
    var lower = name.toLowerCase();
    var hit = headers.filter(function (h) { return h.name.toLowerCase() === lower; });
    return hit.length ? hit[0].value : null;
  }
  function pickAll(headers, name) {
    var lower = name.toLowerCase();
    return headers.filter(function (h) { return h.name.toLowerCase() === lower; })
                  .map(function (h) { return h.value; });
  }

  function parseReceived(value) {
    var hop = { raw: value };
    var from = value.match(/from\s+([^\s;()]+)/i);
    var by = value.match(/\bby\s+([^\s;()]+)/i);
    var ip = value.match(/\[?((?:\d{1,3}\.){3}\d{1,3})\]?/);
    var ip6 = value.match(/\[?((?:[0-9a-f]{0,4}:){3,7}[0-9a-f]{0,4})\]?/i);
    var date = value.match(/;\s*(.+)$/);
    hop.from = from ? from[1] : null;
    hop.by = by ? by[1] : null;
    hop.ip = ip ? ip[1] : (ip6 ? ip6[1] : null);
    hop.tls = /\b(TLS|ESMTPS|version=TLS)/i.test(value);
    if (date) {
      var d = new Date(date[1].trim());
      hop.date = isNaN(d.getTime()) ? null : d;
    }
    return hop;
  }

  var PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

  function authResult(text, mech) {
    if (!text) return null;
    var m = new RegExp(mech + '=(\\w+)', 'i').exec(text);
    return m ? m[1].toLowerCase() : null;
  }

  function verdictClass(result) {
    if (result === 'pass') return 't-ok';
    if (result === 'fail' || result === 'softfail' || result === 'permerror') return 't-err';
    if (!result) return 't-dim';
    return 't-warn';
  }

  function run() {
    var raw = document.getElementById('tool-text').value;
    out.clear();
    if (!raw.trim()) {
      out.warn('Paste the full headers of an email.');
      out.dim('Gmail: open the message → ⋮ → Show original.');
      out.dim('Outlook: File → Properties → Internet headers.');
      return;
    }

    var headers = parse(raw);
    if (!headers.length) {
      out.err('No headers found. Paste the raw header block — the part with');
      out.err('lines like "Received:", "From:" and "Authentication-Results:".');
      return;
    }

    // ---- identity ----
    out.heading('Who it claims to be from');
    var from = pick(headers, 'From');
    var replyTo = pick(headers, 'Reply-To');
    var returnPath = pick(headers, 'Return-Path');
    var sender = pick(headers, 'Sender');
    out.row('From', from || '(missing)');
    if (replyTo) out.row('Reply-To', replyTo);
    if (returnPath) out.row('Return-Path', returnPath);
    if (sender) out.row('Sender', sender);
    out.row('Subject', pick(headers, 'Subject') || '(none)');
    out.row('Date', pick(headers, 'Date') || '(none)');

    function domainOf(addr) {
      var m = String(addr || '').match(/@([A-Za-z0-9.-]+)/);
      return m ? m[1].toLowerCase().replace(/[>\s]+$/, '') : null;
    }
    var fromDomain = domainOf(from);
    var replyDomain = domainOf(replyTo);
    var pathDomain = domainOf(returnPath);

    out.line('');
    if (replyDomain && fromDomain && replyDomain !== fromDomain) {
      out.err('Reply-To is a different domain from From.');
      out.err('  From:     ' + fromDomain);
      out.err('  Reply-To: ' + replyDomain);
      out.warn('Replies go to the second one. This is the standard setup for a');
      out.warn('business-email-compromise attempt: a familiar name in the From');
      out.warn('line, and an attacker-controlled address collecting the answers.');
    }
    if (pathDomain && fromDomain && pathDomain !== fromDomain) {
      out.warn('Return-Path domain (' + pathDomain + ') differs from From (' +
               fromDomain + '). Legitimate for mailing lists and bulk senders,');
      out.warn('and also exactly what a spoofed envelope looks like — check SPF.');
    }

    // ---- authentication ----
    out.rule();
    out.heading('Authentication');
    var auth = pickAll(headers, 'Authentication-Results').join(' ; ') +
               ' ' + pickAll(headers, 'ARC-Authentication-Results').join(' ; ');
    var spf = authResult(auth, 'spf') ||
              authResult(pick(headers, 'Received-SPF') || '', '^\\s*') ||
              (pick(headers, 'Received-SPF') || '').split(/\s+/)[0];
    var dkim = authResult(auth, 'dkim');
    var dmarc = authResult(auth, 'dmarc');
    if (spf) spf = String(spf).toLowerCase();

    out.row('SPF', spf || 'not stated', verdictClass(spf));
    out.dim('    did the sending server have permission to send for that domain');
    out.row('DKIM', dkim || 'not stated', verdictClass(dkim));
    out.dim('    is the message cryptographically signed and unmodified');
    out.row('DMARC', dmarc || 'not stated', verdictClass(dmarc));
    out.dim('    does the domain owner’s policy accept this combination');

    out.line('');
    if (spf === 'pass' && dkim === 'pass' && dmarc === 'pass') {
      out.ok('All three pass. The sending domain is genuine.');
      out.dim('Note what that does and does not mean: it proves the message came');
      out.dim('from that domain. It does not prove the message is honest. A');
      out.dim('lookalike domain registered yesterday passes all three too.');
    } else if (!spf && !dkim && !dmarc) {
      out.warn('No authentication results found. Either the receiving server does');
      out.warn('not stamp them, or you pasted a partial header block.');
    } else {
      out.err('Authentication is not clean. At least one check did not pass,');
      out.err('which for a message claiming to be from a real organisation is');
      out.err('a strong signal that it is not.');
    }

    if (pick(headers, 'DKIM-Signature')) {
      var sig = pick(headers, 'DKIM-Signature');
      var dm = sig.match(/[;\s]d=([^;\s]+)/);
      if (dm) out.row('DKIM signing domain', dm[1],
                      fromDomain && dm[1].indexOf(fromDomain) === -1 ? 't-warn' : 't-ok');
    }

    // ---- delivery path ----
    out.rule();
    var received = pickAll(headers, 'Received');
    out.heading('Delivery path — ' + received.length + ' hop(s)');
    out.dim('Read bottom to top: the last entry is where the message started.');
    out.line('');

    var hops = received.map(parseReceived).reverse();
    var previous = null;
    hops.forEach(function (hop, i) {
      var label = 'hop ' + (i + 1) + (i === 0 ? '  (origin)' : '');
      out.line(label, i === 0 ? 't-info' : 't-dim');
      if (hop.from) out.row('  from', hop.from);
      if (hop.by) out.row('  by', hop.by);
      if (hop.ip) {
        var isPrivate = PRIVATE.test(hop.ip);
        out.row('  IP', hop.ip + (isPrivate ? '  (private — internal relay)' : ''),
                isPrivate ? 't-dim' : null);
      }
      out.row('  TLS', hop.tls ? 'yes' : 'no', hop.tls ? 't-ok' : 't-warn');
      if (hop.date) {
        var delay = previous && previous.date
          ? Math.round((hop.date - previous.date) / 1000) : null;
        out.row('  time', hop.date.toISOString() +
                (delay !== null ? '   (+' + delay + 's)' : ''),
                delay !== null && Math.abs(delay) > 300 ? 't-warn' : null);
        if (delay !== null && delay < -60) {
          out.line('    → timestamp goes backwards; clocks disagree or the chain', 't-warn');
          out.line('      was forged', 't-warn');
        }
        if (delay !== null && delay > 3600) {
          out.line('    → over an hour sitting at this hop, often a queue or a', 't-warn');
          out.line('      filter holding the message', 't-warn');
        }
      }
      previous = hop;
      out.line('');
    });

    var origin = hops[0];
    if (origin && origin.ip && !PRIVATE.test(origin.ip)) {
      out.rule();
      out.heading('Originating IP');
      out.line(origin.ip, 't-info');
      out.dim('This is the address that actually handed the message to the first');
      out.dim('server that logged it — the closest thing to a real sender.');
      out.dim('Nothing here looks it up: no WHOIS, no geolocation, no reputation');
      out.dim('query, because any of those would tell a third party what you are');
      out.dim('investigating. Copy it into your own tooling if you need more.');
    }

    // ---- other signals ----
    out.rule();
    out.heading('Other signals');
    var xMailer = pick(headers, 'X-Mailer') || pick(headers, 'User-Agent');
    if (xMailer) out.row('X-Mailer', xMailer);
    var spam = pick(headers, 'X-Spam-Status') || pick(headers, 'X-Spam-Score') ||
               pick(headers, 'X-Microsoft-Antispam');
    if (spam) out.row('spam scoring', spam.slice(0, 120));
    var listUnsub = pick(headers, 'List-Unsubscribe');
    if (listUnsub) out.row('List-Unsubscribe', listUnsub.slice(0, 90));
    var messageId = pick(headers, 'Message-ID');
    if (messageId) {
      out.row('Message-ID', messageId);
      var midDomain = domainOf(messageId.replace(/[<>]/g, ''));
      if (midDomain && fromDomain && midDomain.indexOf(fromDomain.split('.').slice(-2).join('.')) === -1) {
        out.line('    → generated by a different domain than From', 't-warn');
      }
    }
    if (!messageId) out.warn('No Message-ID. Every normal mail server adds one.');

    out.rule();
    out.dim('Nothing above was sent anywhere. These headers contain internal');
    out.dim('hostnames and addresses, which is exactly why parsing them locally');
    out.dim('is the only sensible way to do it.');
  }

  LabTool.define({
    id: 'emailheaderstool',
    run: run,
    onReady: function () {
      out.dim('Paste raw email headers and press Run.');
      out.dim('');
      out.dim('Gmail:   open the message → ⋮ menu → "Show original"');
      out.dim('Outlook: File → Properties → "Internet headers"');
      out.dim('Apple Mail: View → Message → All Headers');
    }
  });
})();

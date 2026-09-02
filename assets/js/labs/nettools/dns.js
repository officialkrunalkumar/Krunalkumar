/* ==========================================================================
   dns.js — DNS lookups from the browser, over DNS-over-HTTPS.
   --------------------------------------------------------------------------
   A browser has no UDP socket, so it cannot speak DNS the ordinary way. What
   it can do is ask a resolver over HTTPS — RFC 8484, in the JSON flavour that
   Google and Cloudflare both serve. That is a genuine DNS lookup; it just
   travels over a different pipe.

   The consequence worth being straight about: the resolver you pick sees every
   name you look up, tied to your IP. That is true of your ISP's resolver too,
   but there you did not choose it and here you did — so this offers the choice
   explicitly rather than picking for you.

   Unlike everything else in Labs, this file makes network requests. It is
   built on net-tool-shell.js, never tool-shell.js, whose header promises the
   opposite about anything built on it.
   ========================================================================== */

/* global LabNet */
(function () {
  'use strict';

  var out = LabNet.out('tool-out');

  var RESOLVERS = {
    google: {
      name: 'Google Public DNS',
      url: 'https://dns.google/resolve',
      headers: {}
    },
    cloudflare: {
      name: 'Cloudflare 1.1.1.1',
      url: 'https://cloudflare-dns.com/dns-query',
      // Cloudflare only returns JSON if you ask for it by name.
      headers: { 'Accept': 'application/dns-json' }
    }
  };

  var TYPES = {
    A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16,
    AAAA: 28, SRV: 33, DS: 43, DNSKEY: 48, CAA: 257
  };
  var TYPE_NAMES = {};
  Object.keys(TYPES).forEach(function (k) { TYPE_NAMES[TYPES[k]] = k; });

  /* RCODEs worth naming. Anything else is printed as a number, because
     inventing a friendly label for a code I have not handled would be worse
     than showing the code. */
  var RCODE = {
    0: 'NOERROR — the query succeeded',
    1: 'FORMERR — the resolver could not parse the query',
    2: 'SERVFAIL — the resolver failed, often a broken DNSSEC chain',
    3: 'NXDOMAIN — the name does not exist',
    4: 'NOTIMP — the resolver does not implement this query',
    5: 'REFUSED — the resolver refused to answer'
  };

  var WHAT = {
    A: 'IPv4 address',
    AAAA: 'IPv6 address',
    CNAME: 'alias pointing at another name',
    MX: 'mail server, with a priority number (lower wins)',
    TXT: 'free-form text — where SPF, DMARC and domain verification live',
    NS: 'authoritative name server for the zone',
    SOA: 'start of authority: the zone’s primary server and timers',
    CAA: 'which certificate authorities may issue for this domain',
    SRV: 'service location: priority, weight, port, target',
    PTR: 'reverse lookup — an address back to a name',
    DS: 'delegation signer, part of the DNSSEC chain',
    DNSKEY: 'the zone’s DNSSEC public key'
  };

  function resolver() {
    var el = document.getElementById('tool-resolver');
    return RESOLVERS[el && el.value ? el.value : 'google'] || RESOLVERS.google;
  }

  /* Google returns TXT strings quoted, and splits anything over 255 bytes into
     several quoted chunks that must be concatenated with nothing between them —
     which is how a 2048-bit DKIM key arrives. */
  function unquoteTxt(data) {
    var chunks = String(data).match(/"(?:[^"\\]|\\.)*"/g);
    if (!chunks) return String(data);
    return chunks.map(function (c) {
      return c.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }).join('');
  }

  function humanTtl(seconds) {
    var n = Number(seconds);
    if (!isFinite(n)) return String(seconds);
    if (n < 60) return n + 's';
    if (n < 3600) return Math.round(n / 60) + 'm';
    if (n < 86400) return Math.round(n / 3600) + 'h';
    return Math.round(n / 86400) + 'd';
  }

  function query(name, type) {
    var r = resolver();
    var url = r.url + '?name=' + encodeURIComponent(name) +
              '&type=' + encodeURIComponent(type);
    return LabNet.json({ url: url, headers: r.headers, out: out })
      .then(function (result) {
        /* The status check must run before the JSON check: a 429 or a 5xx
           often arrives with an HTML or empty body, and letting "not JSON"
           win would discard the one hard fact we hold — the HTTP status —
           and send the failure to explainFailure, whose whole script is
           about failures the browser refuses to describe. This one it
           described just fine.

           Cloudflare answers HTTP 400 — with a JSON error body that carries
           no Status field — when a name slips past this file's loose regex
           but fails its stricter one; the Status-field check also catches a
           2xx missing the field, which the footer once interpolated as
           "RCODE undefined", reading like a DNS response that never
           happened. The error is flagged, and carries the status as a
           number, so reportFailure can tell rate-limiting and resolver
           trouble apart from a rejected name. */
        if (!result.res.ok ||
            !result.data || typeof result.data.Status !== 'number') {
          if (result.res.ok && !result.data) {
            throw new Error('The resolver returned something that is not JSON.');
          }
          var rejected = new Error('The resolver rejected the query (HTTP ' +
                                   result.res.status + ') instead of answering it.');
          rejected.resolverRejected = true;
          rejected.httpStatus = result.res.status;
          throw rejected;
        }
        return result.data;
      });
  }

  function renderAnswers(data, typeName) {
    var answers = data.Answer || [];
    if (!answers.length) {
      if (data.Status === 0) {
        out.warn('NODATA — the name exists, but has no ' + typeName + ' record.');
        out.dim('This is not the same as the domain not existing. Something else');
        out.dim('in the zone answered; there is simply nothing of this type.');
        if (data.Authority && data.Authority.length) {
          out.line('');
          out.dim('the zone’s SOA came back in the authority section:');
          data.Authority.forEach(function (a) { out.dim('  ' + a.data); });
        }
      }
      return 0;
    }

    out.heading(answers.length + ' ' + typeName + ' record' + (answers.length === 1 ? '' : 's'));
    if (WHAT[typeName]) out.dim(WHAT[typeName]);
    out.line('');

    answers.forEach(function (a) {
      var shown = TYPE_NAMES[a.type] || ('type ' + a.type);
      var value = (a.type === 16) ? unquoteTxt(a.data) : a.data;

      // A CNAME in the answer chain is worth calling out — it explains why the
      // name you asked about is not the name that answered.
      if (a.type === 5 && shown !== typeName) {
        out.row('CNAME  ' + humanTtl(a.TTL), value, 't-dim');
        return;
      }
      out.row(shown + '  ' + humanTtl(a.TTL), value);

      if (a.type === 15) {
        var mx = String(a.data).match(/^(\d+)\s+(.+)$/);
        if (mx) out.dim('    priority ' + mx[1] + ' → ' + mx[2].replace(/\.$/, ''));
      }
      if (a.type === 257) {
        var caa = String(a.data).match(/^(\d+)\s+(\w+)\s+"?([^"]*)"?/);
        if (caa) {
          out.dim('    ' + (caa[2] === 'issuewild' ? 'wildcard certs' : 'certs') +
                  ' may be issued by ' + caa[3] +
                  (caa[1] === '128' ? '  (critical flag set)' : ''));
        }
      }
      if (a.type === 6) {
        var p = String(a.data).split(/\s+/);
        if (p.length >= 7) {
          out.dim('    primary NS ' + p[0].replace(/\.$/, ''));
          out.dim('    contact    ' + p[1].replace(/\.$/, '').replace('.', '@'));
          out.dim('    serial ' + p[2] + '   refresh ' + humanTtl(p[3]) +
                  '   retry ' + humanTtl(p[4]) + '   expire ' + humanTtl(p[5]) +
                  '   min TTL ' + humanTtl(p[6]));
        }
      }
    });
    return answers.length;
  }

  /* Both the single lookup and the sweep end in the same catch, so the split
     between "the resolver told us no" and "the browser will not say" lives
     here once. A flagged rejection carries a real HTTP status and gets said
     plainly — and the status matters, because a 429, a 5xx and a 400 are
     three different stories: too many queries, the resolver's own trouble,
     and a name it would not accept. Everything else is the opaque
     cross-origin failure that explainFailure exists to be honest about. */
  function reportFailure(err) {
    if (err && err.resolverRejected) {
      out.line('');
      if (err.httpStatus === 429) {
        out.err('HTTP 429 — ' + resolver().name + ' is rate-limiting this address.');
        out.dim('Too many queries arrived too quickly and it is asking for a');
        out.dim('pause. Nothing is wrong with the name — wait a moment and try');
        out.dim('again.');
      } else if (err.httpStatus >= 500) {
        out.err('HTTP ' + err.httpStatus + ' — ' + resolver().name + ' is having trouble.');
        out.dim('That is a failure on the resolver’s side, not a problem with');
        out.dim('the name or with your connection. Try again shortly, or switch');
        out.dim('to the other resolver above.');
      } else {
        out.err(err.message);
        out.dim('The name looked plausible enough to send, but the resolver');
        out.dim('does not consider it a valid DNS name.');
      }
      return;
    }
    LabNet.explainFailure(out, err, resolver().name);
  }

  function footer(data) {
    out.rule();
    out.row('resolver', resolver().name);
    out.row('status', RCODE[data.Status] || ('RCODE ' + data.Status),
            data.Status === 0 ? 't-ok' : 't-warn');
    out.row('DNSSEC validated', data.AD ? 'yes (AD flag set)' : 'no',
            data.AD ? 't-ok' : null);
    if (!data.AD) {
      out.dim('    Most domains still are not signed, so "no" here is ordinary');
      out.dim('    and does not by itself indicate a problem.');
    }
    if (data.TC) out.warn('The response was truncated.');
    out.line('');
    out.dim(resolver().name + ' now knows that someone at your IP address looked');
    out.dim('up this name, just now. That is unavoidable for any DNS query — the');
    out.dim('only choice is who you tell.');
  }

  function run() {
    var raw = document.getElementById('tool-text').value.trim();
    var typeName = document.getElementById('tool-type').value;
    out.clear();

    if (!raw) {
      out.warn('Enter a domain name, then press Look up.');
      return;
    }

    // Accept a pasted URL or an email address and pull the host out of it,
    // because that is what people actually have to hand.
    var name = raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^[^@/]*@/, '')
      .replace(/[/?#].*$/, '')
      .replace(/\.$/, '');

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(name) &&
        !/^[a-z0-9_.-]+$/i.test(name)) {
      out.err('"' + raw + '" does not look like a domain name.');
      return;
    }
    if (name !== raw) {
      out.dim('looking up: ' + name);
      out.line('');
    }

    if (typeName === 'ALL') { runAll(name); return; }

    query(name, typeName).then(function (data) {
      out.line('');
      renderAnswers(data, typeName);
      footer(data);
    }).catch(reportFailure);
  }

  /* The common-records sweep. Sequential on purpose: six parallel requests
     would be faster, but they would also hand the resolver a burst that is
     unmistakably an automated audit of one domain. */
  var SWEEP = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CAA'];

  function runAll(name) {
    out.heading('Looking up ' + SWEEP.length + ' record types for ' + name);
    out.dim('one request each, in sequence');
    out.line('');

    var index = 0;
    // Count requests as they are actually issued, not as they were planned. An
    // NXDOMAIN early-exit (below) stops the sweep after a single query, so the
    // plan length would over-report — the resolver only ever saw what we sent.
    var requestsMade = 0;
    function next() {
      if (index >= SWEEP.length) {
        out.rule();
        out.row('resolver', resolver().name);
        out.row('requests made', requestsMade);
        out.line('');
        // The privacy point only lands when there really was a burst. After an
        // early exit there was just the one query, so say that instead of
        // claiming a pattern the resolver never saw.
        if (requestsMade > 1) {
          out.dim(resolver().name + ' saw all ' + requestsMade + ' of those queries for');
          out.dim('the same domain, moments apart. That pattern is recognisably an');
          out.dim('audit rather than ordinary browsing.');
        } else {
          out.dim(resolver().name + ' saw that single query. The sweep stopped early,');
          out.dim('so there was no burst to recognise this time.');
        }
        return;
      }
      var type = SWEEP[index++];
      requestsMade++;   // the request goes out on the next line — count it here
      query(name, type).then(function (data) {
        out.line('');
        if (data.Status === 3) {
          out.err('NXDOMAIN — ' + name + ' does not exist.');
          index = SWEEP.length;   // no point asking five more times
          return next();
        }
        renderAnswers(data, type);
        out.line('');
        next();
      }).catch(reportFailure);
    }
    next();
  }

  LabNet.define({
    id: 'dnstool',
    run: run,
    onReady: function () {
      out.dim('Enter a domain and press Look up. Nothing is sent until you do.');
      out.dim('');
      out.dim('The lookup goes to the resolver you pick above — Google or');
      out.dim('Cloudflare — over HTTPS. A browser cannot speak DNS directly,');
      out.dim('because it has no UDP socket; DNS-over-HTTPS is the way in.');
      out.dim('');
      out.dim('Try:  github.com  ·  google.com  ·  cloudflare.com');
    }
  });
})();

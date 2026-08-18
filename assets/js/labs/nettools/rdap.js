/* ==========================================================================
   rdap.js — domain registration data, the modern replacement for WHOIS.
   --------------------------------------------------------------------------
   Classic WHOIS cannot be done from a browser and never will be: it is a
   plaintext line protocol over raw TCP port 43, browsers have no raw sockets,
   and port 43 is on the Fetch specification's blocked-port list anyway. Every
   "WHOIS lookup" on the web is a server relaying the query for you.

   RDAP is the ICANN-mandated successor — same registry data, structured JSON,
   over HTTPS, with CORS. So this is the rare case where the browser-native
   version is not a workaround but the actually-correct protocol.

   Requests go through rdap.org, which redirects to whichever registry is
   authoritative for the TLD. That redirect was the thing most likely to break
   this — a CORS-enabled request that redirects to a host which omits CORS
   headers fails, and the browser will not say why — but it was verified to
   survive the hop before this was built.

   Expect gaps. Many ccTLDs have no RDAP service at all, and GDPR means most
   registrant contact details are redacted for anything in scope. Both are
   reported honestly rather than rendered as an empty field.
   ========================================================================== */

/* global LabNet */
(function () {
  'use strict';

  var out = LabNet.out('tool-out');
  var VENDOR = 'rdap.org and the authoritative registry';
  var ENDPOINT = 'https://rdap.org/domain/';

  var EVENT_LABELS = {
    registration: 'registered',
    reregistration: 're-registered',
    'last changed': 'last changed',
    expiration: 'expires',
    deletion: 'deleted',
    reinstantiation: 'reinstated',
    transfer: 'transferred',
    locked: 'locked',
    unlocked: 'unlocked',
    'last update of RDAP database': 'RDAP record refreshed'
  };

  /* EPP status codes. The security-relevant ones are the locks: a domain
     without them can be transferred or deleted by anyone who gets into the
     registrar account, which is how high-profile domain hijacks happen. */
  var STATUS_NOTES = {
    'client transfer prohibited': ['transfer lock set by the registrar', true],
    'client delete prohibited': ['delete lock set by the registrar', true],
    'client update prohibited': ['update lock set by the registrar', true],
    'client renew prohibited': ['renewal lock set by the registrar', false],
    'server transfer prohibited': ['transfer lock set by the registry — strongest', true],
    'server delete prohibited': ['delete lock set by the registry', true],
    'server update prohibited': ['update lock set by the registry', true],
    'pending transfer': ['a transfer is in progress right now', false],
    'pending delete': ['scheduled for deletion', false],
    'redemption period': ['expired and in the redemption grace period', false],
    'auto renew period': ['recently auto-renewed', false],
    'add period': ['registered within the last few days', false],
    'inactive': ['no nameservers — the domain does not resolve', false],
    'active': ['normal, no restrictions', false],
    'ok': ['normal, no restrictions', false]
  };

  function cleanDomain(raw) {
    return String(raw).trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^[^@/]*@/, '')
      .replace(/[/?#].*$/, '')
      .replace(/\.$/, '')
      .toLowerCase();
  }

  function fmtDate(iso) {
    if (!iso) return '?';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  }

  function ageText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var days = Math.round((Date.now() - d.getTime()) / 86400000);
    var abs = Math.abs(days);
    var text = abs > 730 ? (abs / 365.25).toFixed(1) + ' years'
             : abs > 60 ? Math.round(abs / 30.4) + ' months'
             : abs + ' days';
    return days >= 0 ? text + ' ago' : 'in ' + text;
  }

  /* jCard is an awkward format: ["vcard", [[name, params, type, value], ...]].
     Pull the fields worth showing and ignore the rest. */
  function fromVcard(entity) {
    var result = {};
    var arr = entity && entity.vcardArray;
    if (!Array.isArray(arr) || arr.length < 2 || !Array.isArray(arr[1])) return result;
    arr[1].forEach(function (field) {
      if (!Array.isArray(field) || field.length < 4) return;
      var key = String(field[0]).toLowerCase();
      var value = field[3];
      if (key === 'fn') result.name = value;
      if (key === 'org') result.org = Array.isArray(value) ? value.join(' ') : value;
      if (key === 'email') result.email = value;
      if (key === 'tel') result.tel = value;
      if (key === 'adr') {
        var parts = Array.isArray(value) ? value.filter(Boolean) : [value];
        if (parts.length) result.address = parts.join(', ');
      }
      if (key === 'kind') result.kind = value;
    });
    return result;
  }

  function run() {
    var raw = document.getElementById('tool-text').value;
    out.clear();
    if (!raw.trim()) { out.warn('Enter a domain, then press Look up.'); return; }

    var domain = cleanDomain(raw);
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
      out.err('"' + raw.trim() + '" does not look like a domain name.');
      return;
    }

    out.heading('RDAP lookup — ' + domain);
    out.dim('via rdap.org, which redirects to the authoritative registry');
    out.line('');

    LabNet.json({ url: ENDPOINT + encodeURIComponent(domain), out: out })
      .then(function (r) {
        if (r.res.status === 404) {
          out.line('');
          out.warn('Not found.');
          out.dim('Either the domain is unregistered, or this TLD has no RDAP');
          out.dim('service. Coverage is mandatory for gTLDs (.com, .org, .net and');
          out.dim('the rest) but optional for country-code TLDs, and many have not');
          out.dim('implemented it.');
          return;
        }
        if (r.res.status === 429) {
          out.line('');
          out.err('Rate-limited by the registry. Wait a little and retry.');
          return;
        }
        if (!r.data || typeof r.data !== 'object') {
          out.line('');
          out.err('The registry returned something that is not RDAP JSON.');
          out.dim(String(r.text || '').slice(0, 200));
          return;
        }
        if (r.res.redirected) {
          out.dim('redirected to: ' + r.res.url);
        }
        render(r.data, domain);
      })
      .catch(function (err) {
        LabNet.explainFailure(out, err, VENDOR);
        out.line('');
        out.dim('One cause specific to RDAP: rdap.org redirects to the registry,');
        out.dim('and if that registry omits CORS headers the redirected request');
        out.dim('fails even though the data exists. Several ccTLD registries do');
        out.dim('exactly that, so some domains simply cannot be looked up here.');
      });
  }

  function render(d, domain) {
    out.line('');
    out.heading('Domain');
    out.row('name', d.ldhName || domain);
    if (d.unicodeName && d.unicodeName !== d.ldhName) {
      out.row('unicode name', d.unicodeName, 't-warn');
      out.dim('    an internationalised domain — check it for lookalike characters');
      out.dim('    with the URL inspector at /labs/url-inspector');
    }
    if (d.handle) out.row('registry id', d.handle);

    // ---- dates ----
    var events = d.events || [];
    if (events.length) {
      out.rule();
      out.heading('Timeline');
      events.forEach(function (e) {
        var label = EVENT_LABELS[String(e.eventAction).toLowerCase()] || e.eventAction;
        out.row(label, fmtDate(e.eventDate) + '   (' + ageText(e.eventDate) + ')');
      });
      var reg = events.filter(function (e) { return /^registration$/i.test(e.eventAction); })[0];
      var exp = events.filter(function (e) { return /^expiration$/i.test(e.eventAction); })[0];
      if (reg) {
        var ageDays = Math.round((Date.now() - new Date(reg.eventDate)) / 86400000);
        out.line('');
        if (ageDays < 90) {
          out.err('This domain is only ' + ageDays + ' days old.');
          out.dim('Newly registered domains are heavily over-represented in');
          out.dim('phishing and fraud. It is not proof of anything, but combined');
          out.dim('with an unsolicited message it is a strong signal.');
        } else if (ageDays < 365) {
          out.warn('Registered less than a year ago (' + ageDays + ' days).');
        } else {
          out.ok('Registered ' + (ageDays / 365.25).toFixed(1) + ' years ago.');
        }
      }
      if (exp) {
        var left = Math.round((new Date(exp.eventDate) - Date.now()) / 86400000);
        if (left < 0) out.err('EXPIRED ' + Math.abs(left) + ' days ago.');
        else if (left < 30) out.warn('Expires in ' + left + ' days.');
      }
    }

    // ---- status / locks ----
    var statuses = d.status || [];
    out.rule();
    out.heading('Status');
    if (!statuses.length) {
      out.dim('none reported');
    } else {
      var locks = 0;
      statuses.forEach(function (s) {
        var key = String(s).toLowerCase();
        var note = STATUS_NOTES[key];
        if (note && note[1]) locks++;
        out.row(s, note ? note[0] : '', note ? null : 't-dim');
      });
      out.line('');
      if (locks === 0) {
        out.warn('No transfer or delete locks are set.');
        out.dim('Anyone who gains access to the registrar account could move or');
        out.dim('delete this domain without further obstacle. For a domain that');
        out.dim('matters, clientTransferProhibited is the minimum, and registry');
        out.dim('lock is better.');
      } else {
        out.ok(locks + ' protective lock' + (locks === 1 ? '' : 's') + ' set.');
      }
    }

    // ---- entities ----
    var entities = d.entities || [];
    if (entities.length) {
      out.rule();
      out.heading('Parties');
      var redacted = 0;
      entities.forEach(function (e) {
        var roles = (e.roles || []).join(', ') || 'unknown role';
        var card = fromVcard(e);
        var label = card.org || card.name || e.handle || '(not disclosed)';
        out.row(roles, label);
        if (card.email) out.row('  email', card.email);
        if (card.tel) out.row('  phone', card.tel);
        if (card.address) out.row('  address', card.address);
        if (!card.email && !card.name && !card.org) redacted++;
      });
      if (redacted) {
        out.line('');
        out.dim('Some contact details are redacted. Since GDPR, registries publish');
        out.dim('almost nothing about individual registrants — usually only the');
        out.dim('registrar. That is a privacy improvement, and it also removed a');
        out.dim('lot of what WHOIS used to be useful for in investigations.');
      }
    }

    // ---- nameservers ----
    var ns = d.nameservers || [];
    if (ns.length) {
      out.rule();
      out.heading('Nameservers');
      ns.forEach(function (n) { out.line('  ' + (n.ldhName || n.handle || '?').toLowerCase()); });
      var hosts = ns.map(function (n) { return String(n.ldhName || '').toLowerCase(); });
      var PROVIDERS = [
        [/cloudflare/, 'Cloudflare'], [/awsdns/, 'AWS Route 53'],
        [/azure-dns|msft/, 'Azure DNS'], [/googledomains|google/, 'Google'],
        [/nsone|ns1\./, 'NS1'], [/dnsimple/, 'DNSimple'], [/digitalocean/, 'DigitalOcean'],
        [/godaddy|domaincontrol/, 'GoDaddy'], [/namecheap|registrar-servers/, 'Namecheap'],
        [/akam|akamai/, 'Akamai'], [/vercel-dns/, 'Vercel'], [/netlify/, 'Netlify']
      ];
      var joined = hosts.join(' ');
      var hit = PROVIDERS.filter(function (p) { return p[0].test(joined); });
      if (hit.length) { out.line(''); out.dim('DNS hosted by: ' + hit[0][1]); }
    }

    // ---- DNSSEC ----
    out.rule();
    var signed = d.secureDNS && (d.secureDNS.delegationSigned === true ||
                                 (d.secureDNS.dsData && d.secureDNS.dsData.length));
    out.row('DNSSEC', signed ? 'signed' : 'not signed', signed ? 't-ok' : 't-dim');
    if (!signed) {
      out.dim('    Most domains are not signed. It matters most for domains whose');
      out.dim('    DNS answers are security-relevant, such as mail routing.');
    }

    out.rule();
    out.dim('This is registry data, published by the registry itself. Nothing was');
    out.dim('sent to ' + domain + ' and none of its servers were contacted.');
  }

  LabNet.define({
    id: 'rdaptool',
    run: run,
    onReady: function () {
      out.dim('Enter a domain and press Look up. Nothing is sent until you do.');
      out.dim('');
      out.dim('RDAP is the structured, HTTPS replacement for WHOIS. Classic WHOIS');
      out.dim('runs over raw TCP port 43, which a browser cannot open and which');
      out.dim('the Fetch spec blocks outright — so every other web WHOIS tool is');
      out.dim('a server doing it on your behalf. This one is not.');
      out.dim('');
      out.dim('Try:  github.com  ·  mozilla.org  ·  a domain from a suspicious email');
    }
  });
})();

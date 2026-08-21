/* ==========================================================================
   ct-log.js — every certificate ever issued for a domain, from the CT logs.
   --------------------------------------------------------------------------
   Certificate Transparency is append-only public record. Since 2018 browsers
   have refused certificates that were not logged, so every CA now publishes
   every certificate it issues — which means searching for a domain returns a
   near-complete history of its TLS certificates, including ones the owner may
   have forgotten.

   The security value is the subdomain list. Organisations put internal names
   on certificates constantly — staging.example.com, vpn.example.com,
   jenkins.example.com — without registering that this publishes the name to a
   permanent world-readable log. CT is the single most productive source for
   subdomain enumeration, and it involves no scanning: the target's servers are
   never touched, because the data is in the log, not on their machines.

   Uses SSLMate's Cert Spotter rather than crt.sh. crt.sh is the better-known
   service and it timed out on every attempt while this was being built, which
   is a poor foundation for a tool that is supposed to work.
   ========================================================================== */

/* global LabNet */
(function () {
  'use strict';

  var out = LabNet.out('tool-out');
  var VENDOR = 'SSLMate Cert Spotter';
  var ENDPOINT = 'https://api.certspotter.com/v1/issuances';
  var PAGE_LIMIT = 3;   // pages of results before we stop asking

  /* Cert Spotter's key-less tier is roughly 9 queries per hour per IP, and a
     busy domain spends up to PAGE_LIMIT of them in a single click — so three
     searches can take this page out of service for the rest of the hour. That
     is a budget the visitor is spending, so they get told the number before it
     goes rather than discovering it from a 429. */
  var HOURLY_BUDGET = 9;

  function cleanDomain(raw) {
    return String(raw).trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^[^@/]*@/, '')
      .replace(/[/?#].*$/, '')
      .replace(/^\*\./, '')
      .replace(/\.$/, '')
      .toLowerCase();
  }

  function fmtDate(iso) {
    if (!iso) return '?';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  function fetchPage(domain, includeSubs, after) {
    var url = ENDPOINT +
      '?domain=' + encodeURIComponent(domain) +
      '&include_subdomains=' + (includeSubs ? 'true' : 'false') +
      '&match_wildcards=true' +
      '&expand=dns_names&expand=issuer&expand=revocation';
    if (after) url += '&after=' + encodeURIComponent(after);
    return LabNet.json({ url: url, out: out }).then(function (r) {
      if (r.res.status === 429) {
        var e = new Error('rate-limited');
        e.rateLimited = true;
        throw e;
      }
      if (!Array.isArray(r.data)) {
        var e2 = new Error('unexpected response');
        e2.body = r.text;
        throw e2;
      }
      return r.data;
    });
  }

  function run() {
    var raw = document.getElementById('tool-text').value;
    var includeSubs = document.getElementById('tool-subs').checked;
    out.clear();

    if (!raw.trim()) { out.warn('Enter a domain, then press Search.'); return; }
    var domain = cleanDomain(raw);
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
      out.err('"' + raw.trim() + '" does not look like a domain name.');
      return;
    }

    out.heading('Certificate Transparency search — ' + domain);
    out.dim(includeSubs ? 'including subdomains' : 'exact domain only');
    out.dim('costs up to ' + PAGE_LIMIT + ' of the ~' + HOURLY_BUDGET +
            ' key-less queries ' + VENDOR + ' allows per hour');
    out.line('');

    var all = [];
    var pages = 0;

    function loadPage(after) {
      fetchPage(domain, includeSubs, after).then(function (batch) {
        pages++;
        all = all.concat(batch);
        // Cert Spotter pages on the last id seen; a short page means the end.
        if (batch.length >= 100 && pages < PAGE_LIMIT) {
          loadPage(batch[batch.length - 1].id);
        } else {
          if (batch.length >= 100 && pages >= PAGE_LIMIT) {
            out.line('');
            out.warn('Stopped after ' + pages + ' pages. There are more results —');
            out.warn('this cap exists so the tool does not hammer a free service.');
          }
          render(all, domain, includeSubs);
        }
      }).catch(function (err) {
        out.line('');
        if (err && err.rateLimited) {
          out.err('Rate-limited by ' + VENDOR + ' — the hourly budget is spent.');
          out.dim('The key-less endpoint allows roughly ' + HOURLY_BUDGET +
                  ' queries an hour from one IP');
          out.dim('address, and a search here can use ' + PAGE_LIMIT +
                  ' of them. Nothing is wrong with');
          out.dim('the domain you typed. The window is rolling, so a few minutes');
          out.dim('often restores it and an hour certainly will; an API key with');
          out.dim('your own tooling removes the limit entirely.');
          // The pages that DID come back were paid for out of the same budget.
          // Throwing them away meant the visitor spent requests and got an
          // error, when a partial answer was already in hand.
          if (all.length) {
            out.line('');
            out.warn('Showing the ' + all.length + ' certificate' +
                     (all.length === 1 ? '' : 's') +
                     ' that arrived before the limit — this list is incomplete.');
            render(all, domain, includeSubs);
          }
          return;
        }
        if (err && err.body !== undefined) {
          out.err('Unexpected response from ' + VENDOR + '.');
          out.dim(String(err.body).slice(0, 200));
          return;
        }
        LabNet.explainFailure(out, err, VENDOR);
      });
    }
    loadPage(null);
  }

  function render(certs, domain, includeSubs) {
    out.line('');
    if (!certs.length) {
      out.warn('No certificates found for ' + domain + '.');
      out.dim('Either none has ever been issued, or the domain is wrong. Note');
      out.dim('that CT only covers publicly-trusted CAs — a certificate from an');
      out.dim('internal corporate CA is never logged and will not appear here.');
      return;
    }

    var now = Date.now();
    var active = certs.filter(function (c) { return new Date(c.not_after) > now; });

    out.heading(certs.length + ' certificate' + (certs.length === 1 ? '' : 's') +
                ' logged   ·   ' + active.length + ' still valid');
    out.line('');

    // ---- the subdomain list, which is the actually useful part ----
    var names = {};
    certs.forEach(function (c) {
      (c.dns_names || []).forEach(function (n) { names[n.toLowerCase()] = true; });
    });
    var allNames = Object.keys(names).sort();

    out.heading('Names appearing on those certificates (' + allNames.length + ')');
    if (includeSubs) {
      out.dim('this is subdomain enumeration, and it touched none of their servers');
    }
    out.line('');

    var INTERESTING = /^(dev|staging|stage|test|uat|qa|beta|internal|intranet|admin|vpn|jenkins|gitlab|git|jira|confluence|grafana|kibana|prometheus|sonar|nexus|vault|consul|rancher|k8s|kube|db|database|mysql|postgres|redis|mail|smtp|imap|webmail|owa|remote|rdp|ssh|ftp|backup|old|legacy|deprecated|api-dev|sandbox)[.-]/i;

    var flagged = [];
    allNames.forEach(function (n) {
      var label = n.replace(/^\*\./, '*.');
      var short = n.replace(new RegExp('\\.' + domain.replace(/\./g, '\\.') + '$'), '');
      if (INTERESTING.test(short + '.') || INTERESTING.test(n)) {
        flagged.push(n);
        out.line('  ' + label, 't-warn');
      } else {
        out.line('  ' + label);
      }
    });

    if (flagged.length) {
      out.line('');
      out.warn(flagged.length + ' name' + (flagged.length === 1 ? '' : 's') +
               ' above look like non-production or internal infrastructure.');
      out.dim('Putting those on a public certificate publishes their existence');
      out.dim('permanently. The log is append-only — they cannot be withdrawn.');
      out.dim('That is not a vulnerability by itself, but it is reconnaissance');
      out.dim('an attacker gets for free, and it is usually unintentional.');
    }

    // ---- issuers ----
    out.rule();
    var issuers = {};
    certs.forEach(function (c) {
      var name = (c.issuer && c.issuer.name) || 'unknown';
      var m = name.match(/O=([^,]+)/);
      var key = m ? m[1].trim() : name;
      issuers[key] = (issuers[key] || 0) + 1;
    });
    out.heading('Issuing authorities');
    Object.keys(issuers).sort(function (a, b) { return issuers[b] - issuers[a]; })
      .forEach(function (k) { out.row(k, issuers[k] + ' certificate' + (issuers[k] === 1 ? '' : 's')); });
    if (Object.keys(issuers).length > 3) {
      out.line('');
      out.dim('Several different CAs. Usually that is just history — a migration,');
      out.dim('or different teams using different providers. Worth a glance');
      out.dim('anyway: an unexpected CA is what a mis-issuance looks like, and');
      out.dim('spotting exactly that is why CT exists.');
    }

    // ---- recent and expiring ----
    out.rule();
    out.heading('Most recent certificates');
    certs.slice().sort(function (a, b) {
      return new Date(b.not_before) - new Date(a.not_before);
    }).slice(0, 10).forEach(function (c) {
      var life = daysBetween(c.not_before, c.not_after);
      var expired = new Date(c.not_after) < now;
      var days = Math.round((new Date(c.not_after) - now) / 86400000);
      var status = expired ? 'expired' : (days < 30 ? days + 'd left' : 'valid');
      out.row(fmtDate(c.not_before) + ' → ' + fmtDate(c.not_after),
              (c.dns_names || []).slice(0, 2).join(', ') +
              ((c.dns_names || []).length > 2 ? ' +' + (c.dns_names.length - 2) : '') +
              '   [' + status + ', ' + life + 'd]',
              expired ? 't-dim' : (days < 30 ? 't-warn' : 't-ok'));
      if (c.revoked) out.line('    REVOKED', 't-err');
    });

    out.rule();
    out.dim('All of this came from a public, append-only log. Nothing was sent');
    out.dim('to ' + domain + ' and none of its servers were contacted — the data');
    out.dim('lives in the CT logs, not on their machines.');
    out.line('');
    out.dim(VENDOR + ' now knows someone at your IP searched for this domain.');
  }

  LabNet.define({
    id: 'ctlogtool',
    run: run,
    onReady: function () {
      out.dim('Enter a domain and press Search. Nothing is sent until you do.');
      out.dim('');
      out.dim('Search sparingly. ' + VENDOR + ' answers without an API key, but');
      out.dim('only about ' + HOURLY_BUDGET + ' times an hour per IP address, and one search');
      out.dim('fetches up to ' + PAGE_LIMIT + ' pages — each page is one of those. Three');
      out.dim('searches of a busy domain can use the whole hour\'s allowance.');
      out.dim('');
      out.dim('Certificate Transparency is a public, append-only record of every');
      out.dim('certificate issued by a publicly-trusted CA since 2018. Searching');
      out.dim('it reveals subdomains without touching the target at all.');
      out.dim('');
      out.dim('Turn on "include subdomains" and try:  github.com');
    }
  });
})();

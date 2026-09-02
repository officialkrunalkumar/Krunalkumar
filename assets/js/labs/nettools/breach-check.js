/* ==========================================================================
   breach-check.js — has this password appeared in a known breach?
   --------------------------------------------------------------------------
   This is the one tool in Labs where a network request is genuinely defensible
   despite the input being a password, and the reason is k-anonymity rather
   than trust.

   The protocol: hash the password with SHA-1, take the first FIVE hex
   characters, and send only those. The server replies with every breached hash
   that shares that prefix — around two thousand of them — and the comparison
   happens here, locally. The full hash never leaves, so the server cannot know
   which of those two thousand you were asking about, or whether you were
   asking about any of them at all. It learns "somebody at this IP has a
   password whose SHA-1 begins with these 20 bits", which is true of roughly
   one in a million passwords and identifies nothing.

   That is a real cryptographic property, not a promise to behave. It is also
   why this specific design is worth having when a "send us your password and
   we'll check" service would not be, however sincere.

   SHA-1 is used because that is the protocol HIBP defines. It is not being
   relied on for security here — it is an index into a public dataset.
   ========================================================================== */

/* global LabNet */
(function () {
  'use strict';

  var out = LabNet.out('tool-out');
  var VENDOR = 'Have I Been Pwned';
  var ENDPOINT = 'https://api.pwnedpasswords.com/range/';

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return hex.toUpperCase();
  }

  function sha1(text) {
    return crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)).then(toHex);
  }

  function run() {
    var password = document.getElementById('tool-text').value;
    out.clear();

    if (!password) {
      out.warn('Type a password, then press Check.');
      out.dim('Only the first five characters of its SHA-1 hash are ever sent.');
      return;
    }

    sha1(password).then(function (hash) {
      var prefix = hash.slice(0, 5);
      var suffix = hash.slice(5);

      out.heading('What is about to be sent');
      out.row('full SHA-1', hash, 't-dim');
      out.line('');
      out.write('                      ', 't-dim');
      out.write(prefix, 't-err');
      out.line(suffix, 't-dim');
      out.write('                      ', 't-dim');
      out.write('^^^^^', 't-err');
      out.line('  only this leaves your browser', 't-dim');
      out.line('');
      out.dim('The 35 characters in grey stay here. The server cannot reverse the');
      out.dim('five it receives, and about a million passwords share them.');
      out.line('');

      var padding = document.getElementById('tool-padding');
      var headers = {};
      if (padding && padding.checked) headers['Add-Padding'] = 'true';

      return LabNet.request({ url: ENDPOINT + prefix, headers: headers, out: out })
        .then(function (r) {
          /* The status check has to come before the body is parsed. report()
             counts "hash:count" lines and treats zero matches as the green
             NOT FOUND — so an HIBP error page, which contains no such lines,
             would parse as a clean corpus miss and print an authoritative
             all-clear for a password the check never actually ran against.
             For a safety tool that is the worst possible failure mode, so a
             non-2xx gets an error that says, unmistakably, that no check
             happened. */
          if (!r.res.ok) {
            out.line('');
            out.err('HTTP ' + r.res.status + ' — ' + VENDOR + ' did not answer the query.');
            out.err('The check could NOT be completed. This is not "not found":');
            out.err('the password was never compared against the breach corpus,');
            out.err('so nothing can be concluded either way. Try again shortly.');
            return;
          }
          return r.res.text().then(function (body) {
            report(body, suffix, password, !!(padding && padding.checked));
          });
        });
    }).catch(function (err) {
      LabNet.explainFailure(out, err, VENDOR);
    });
  }

  function report(body, suffix, password, padded) {
    var lines = String(body).split(/\r?\n/);
    var count = 0;
    var real = 0;

    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split(':');
      if (parts.length !== 2) continue;
      var n = parseInt(parts[1], 10);
      // Padding entries are returned with a count of 0 and are decoys.
      if (n > 0) real++;
      if (parts[0].trim().toUpperCase() === suffix) count = n;
    }

    out.line('');
    out.row('hashes returned', lines.length.toLocaleString() +
            (padded ? '  (' + real.toLocaleString() + ' real, rest are padding)' : ''));
    out.row('compared', 'locally, in this tab', 't-ok');
    out.rule();

    if (count > 0) {
      out.err('FOUND — this password appears in known breaches ' +
              count.toLocaleString() + ' time' + (count === 1 ? '' : 's').toString());
      out.line('');
      if (count > 100000) {
        out.err('That is an extremely common password. It is near the front of');
        out.err('every cracking wordlist, and an attacker will try it within the');
        out.err('first few seconds of any attempt.');
      } else if (count > 100) {
        out.warn('Common enough to be in standard wordlists. Treat it as public.');
      } else {
        out.warn('It appears rarely, but it appears. Once a password is in a');
        out.warn('published breach corpus it is in the wordlists forever.');
      }
      out.line('');
      out.dim('What this does and does not mean:');
      out.dim('  · it does NOT mean any account of yours was breached');
      out.dim('  · it DOES mean this exact string is in a public list attackers use');
      out.dim('  · a strong-looking password that appears here is still burned');
      out.line('');
      out.warn('Stop using it anywhere. If it is reused across sites, change it');
      out.warn('on all of them — credential stuffing is exactly this attack.');
    } else {
      out.ok('NOT FOUND — this password does not appear in the breach corpus.');
      out.line('');
      out.dim('Which is good, and narrower than it sounds. It means this string');
      out.dim('is not in the published breach data HIBP has collected. It does');
      out.dim('not mean the password is strong: a short, guessable password that');
      out.dim('nobody happens to have used is still short and guessable.');
      out.line('');
      out.dim('For whether it would survive an attack, use the offline strength');
      out.dim('checker — that one makes no network requests at all:');
      out.dim('  /labs/password');
    }

    out.rule();
    out.heading('What the server learned');
    out.dim('That a request came from your IP address for the prefix shown above.');
    out.dim('It does not know your password, which of the ' +
            lines.length.toLocaleString() + ' returned hashes you were');
    out.dim('interested in, or whether you matched any of them at all — because');
    out.dim('the comparison happened here, after the response arrived.');
    if (padded) {
      out.line('');
      out.dim('Padding was on, so the response size reveals nothing either. Without');
      out.dim('it, an observer watching your encrypted traffic could infer which');
      out.dim('prefix you asked for from the response length alone.');
    } else {
      out.line('');
      out.warn('Padding is off. The response length is distinctive, so a network');
      out.warn('observer could infer which prefix you requested even over HTTPS.');
      out.warn('Turn it on above if that matters to you.');
    }
  }

  LabNet.define({
    id: 'breachchecktool',
    run: run,
    onReady: function () {
      var reveal = document.getElementById('tool-reveal');
      var field = document.getElementById('tool-text');
      if (reveal && field) {
        reveal.addEventListener('click', function () {
          var showing = field.type === 'text';
          field.type = showing ? 'password' : 'text';
          reveal.textContent = showing ? 'Show' : 'Hide';
          reveal.setAttribute('aria-pressed', String(!showing));
        });
      }
      out.dim('Type a password and press Check.');
      out.dim('');
      out.dim('Only the first five characters of its SHA-1 hash are sent. The');
      out.dim('server returns every breached hash sharing that prefix — roughly');
      out.dim('two thousand — and the comparison happens here, in this tab.');
      out.dim('');
      out.dim('That is k-anonymity: a mathematical property, not a promise. The');
      out.dim('server cannot tell which of those two thousand you meant.');
    }
  });
})();

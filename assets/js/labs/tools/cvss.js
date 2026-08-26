/* ==========================================================================
   cvss.js — CVSS v3.1 base score, implemented from the specification.
   --------------------------------------------------------------------------
   The formula is published (FIRST, CVSS v3.1 specification, section 8) and it
   is entirely arithmetic, so a calculator for it has no business being a web
   service. What people usually want alongside the number is an explanation of
   why it came out that way, so each metric prints what it contributed.

   The score is deliberately shown next to the caveat that matters: CVSS
   measures a vulnerability in isolation. It knows nothing about whether the
   affected system is exposed, whether the data on it matters, or whether the
   flaw is being exploited today. A 9.8 on an internal box behind three
   firewalls can be less urgent than a 6.1 on a public login page.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  var W = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
    AC: { L: 0.77, H: 0.44 },
    PR: { N: 0.85, L: 0.62, H: 0.27 },          // unchanged scope
    PRc: { N: 0.85, L: 0.68, H: 0.5 },          // changed scope
    UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 }
  };

  var LABELS = {
    AV: { N: 'Network — reachable across the internet',
          A: 'Adjacent — same physical or logical network',
          L: 'Local — needs a shell or local access',
          P: 'Physical — needs to touch the device' },
    AC: { L: 'Low — works reliably, no special conditions',
          H: 'High — needs conditions outside the attacker’s control' },
    PR: { N: 'None — no account needed',
          L: 'Low — ordinary user account',
          H: 'High — administrative account' },
    UI: { N: 'None — no victim action needed',
          R: 'Required — a user must click or open something' },
    S:  { U: 'Unchanged — impact stays in the vulnerable component',
          C: 'Changed — impact reaches beyond it' },
    C:  { H: 'High — everything is readable', L: 'Low — some data leaks', N: 'None' },
    I:  { H: 'High — anything can be modified', L: 'Low — limited modification', N: 'None' },
    A:  { H: 'High — complete denial of service', L: 'Low — reduced performance', N: 'None' }
  };

  function roundUp(x) {
    // The spec's Roundup: smallest number to one decimal >= x, avoiding the
    // float error that a naive Math.ceil(x*10)/10 introduces.
    var i = Math.round(x * 100000);
    return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
  }

  function severity(score) {
    if (score === 0) return ['None', 't-dim'];
    if (score < 4) return ['Low', 't-ok'];
    if (score < 7) return ['Medium', 't-warn'];
    if (score < 9) return ['High', 't-err'];
    return ['Critical', 't-err'];
  }

  function read() {
    var v = {};
    ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'].forEach(function (m) {
      var el = document.getElementById('cvss-' + m);
      v[m] = el ? el.value : 'N';
    });
    return v;
  }

  function compute(v) {
    var changed = v.S === 'C';
    var iss = 1 - ((1 - W.CIA[v.C]) * (1 - W.CIA[v.I]) * (1 - W.CIA[v.A]));
    var impact = changed
      ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
      : 6.42 * iss;
    var exploitability = 8.22 * W.AV[v.AV] * W.AC[v.AC] *
      (changed ? W.PRc[v.PR] : W.PR[v.PR]) * W.UI[v.UI];
    var base = impact <= 0 ? 0
      : roundUp(Math.min(changed ? 1.08 * (impact + exploitability)
                                 : impact + exploitability, 10));
    return { base: base, impact: impact, exploitability: exploitability, iss: iss };
  }

  function vector(v) {
    return 'CVSS:3.1/AV:' + v.AV + '/AC:' + v.AC + '/PR:' + v.PR + '/UI:' + v.UI +
           '/S:' + v.S + '/C:' + v.C + '/I:' + v.I + '/A:' + v.A;
  }

  function render() {
    var v = read();
    var r = compute(v);
    var sev = severity(r.base);

    out.clear();
    out.heading('Base score');
    out.line('');
    out.line('   ' + r.base.toFixed(1) + '   ' + sev[0].toUpperCase(), sev[1]);
    out.line('');
    var filled = Math.round(r.base * 4);
    out.write('   ', 't-dim');
    out.write('█'.repeat(filled), sev[1]);
    out.line('░'.repeat(40 - filled), 't-dim');
    out.line('   0                    5                    10', 't-dim');

    out.rule();
    out.heading('Vector string');
    out.line(vector(v));
    var vecOut = document.getElementById('tool-result');
    if (vecOut) vecOut.value = vector(v);

    out.rule();
    out.heading('How each metric contributed');
    out.dim('exploitability — how hard is it to pull off');
    out.row('  attack vector', LABELS.AV[v.AV] + '  (' + W.AV[v.AV] + ')');
    out.row('  attack complexity', LABELS.AC[v.AC] + '  (' + W.AC[v.AC] + ')');
    out.row('  privileges required', LABELS.PR[v.PR] + '  (' +
            (v.S === 'C' ? W.PRc[v.PR] : W.PR[v.PR]) + ')');
    out.row('  user interaction', LABELS.UI[v.UI] + '  (' + W.UI[v.UI] + ')');
    out.row('  subtotal', r.exploitability.toFixed(2), 't-info');
    out.line('');
    out.dim('impact — how bad is it when it works');
    out.row('  scope', LABELS.S[v.S]);
    out.row('  confidentiality', LABELS.C[v.C] + '  (' + W.CIA[v.C] + ')');
    out.row('  integrity', LABELS.I[v.I] + '  (' + W.CIA[v.I] + ')');
    out.row('  availability', LABELS.A[v.A] + '  (' + W.CIA[v.A] + ')');
    out.row('  subtotal', r.impact.toFixed(2), 't-info');

    if (v.S === 'C') {
      out.line('');
      out.warn('Scope is Changed, which applies a 1.08 multiplier and raises the');
      out.warn('privileges-required weights. It is the single most score-inflating');
      out.warn('metric in CVSS and the most frequently set by mistake — it means');
      out.warn('the impact escapes into a component with a different authority,');
      out.warn('like a sandbox escape or a hypervisor break, not merely that');
      out.warn('something else is also affected.');
    }

    out.rule();
    out.heading('What this number is not');
    out.dim('CVSS scores a vulnerability in the abstract. It does not know');
    out.dim('whether the affected system is internet-facing, whether the data on');
    out.dim('it matters, whether a patch exists, or whether anyone is exploiting');
    out.dim('it right now. A 9.8 on an isolated internal host can be less urgent');
    out.dim('than a 6.1 on your public login page. Use it to compare severities,');
    out.dim('not to set your priorities on its own.');
  }

  /* --------------------------------------------------------------------------
     Loading a pasted vector.

     The rule here is that a vector is judged whole before a single dropdown
     moves. An earlier version of this parser applied metrics as it walked the
     string and ignored anything it did not recognise, which made it confidently
     wrong in exactly the case people most need it to be right: a CVSS:4.0
     string shares AV, AC, UI and PR with v3.1 but not S, C, I or A, so the four
     it matched were applied, the four it did not were left at whatever the page
     happened to be showing, and the tool printed a v3.1 number for a v4.0
     vector. A CVSS v2 string, which carries no CVSS: prefix at all, came out
     as 9.8 CRITICAL for the same reason. The FAQ on this page promises that a
     v4.0 string "will not score correctly" — that promise is only kept if the
     tool refuses the string instead of scoring it anyway.

     So: the prefix must name a version this calculator implements, every base
     metric must be present, and every value must be one this calculator knows.
     Anything else is refused with a message that says which part was wrong.
     -------------------------------------------------------------------------- */

  var BASE_ORDER = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];

  /* Null-prototype maps throughout this section: the keys are read straight out
     of pasted text, so a metric named 'constructor' or '__proto__' must miss
     rather than collide with an Object.prototype member and test as valid. */
  var BASE_VALUES = (function () {
    var m = Object.create(null);
    m.AV = 'NALP'; m.AC = 'LH'; m.PR = 'NLH'; m.UI = 'NR';
    m.S = 'UC'; m.C = 'HLN'; m.I = 'HLN'; m.A = 'HLN';
    return m;
  })();

  /* Temporal and environmental metrics are a legitimate part of a v3.1 vector,
     they just do not affect the base score this tool computes. They are noted
     and skipped rather than treated as an error — refusing a real advisory
     string because it carries E:F/RL:O would be its own kind of wrong. */
  var OPTIONAL_METRICS = (function () {
    var m = Object.create(null);
    ['E', 'RL', 'RC', 'CR', 'IR', 'AR',
     'MAV', 'MAC', 'MPR', 'MUI', 'MS', 'MC', 'MI', 'MA'].forEach(function (k) {
      m[k] = true;
    });
    return m;
  })();

  // Pasted text ends up in the error message, so it is trimmed to something
  // that cannot push the rest of the output off the pane.
  function snippet(s) {
    var t = String(s);
    return t.length > 24 ? t.slice(0, 24) + '…' : t;
  }

  /* Returns { ok: true, ignored: [...] } or { ok: false, err: [lines] }.
     Errors are an array because the interesting ones need a second line to say
     what to do instead, and out.err() prints a line at a time. */
  function parseVector(text) {
    var raw = String(text).trim();
    if (!raw) {
      return { ok: false, err: ['Paste a CVSS v3.1 vector string into the field first.'] };
    }

    var parts = raw.split('/');
    var head = parts[0].split(':');
    if (head.length !== 2 || head[0].toUpperCase() !== 'CVSS') {
      return { ok: false, err: [
        'That does not look like a CVSS v3.1 vector string.',
        'A v3.1 vector begins with the prefix CVSS:3.1/ — a string that starts',
        'straight in at AV: is CVSS v2, which uses different metrics and is not',
        'scored by this calculator.'
      ] };
    }

    var version = head[1];
    if (version !== '3.1' && version !== '3.0') {
      return { ok: false, err: [
        'That is a CVSS v' + snippet(version) + ' vector. This calculator scores v3.1.',
        'The versions are not interchangeable: v4.0 splits the impact metrics into',
        'vulnerable-system (VC/VI/VA) and subsequent-system (SC/SI/SA) sets and adds',
        'Attack Requirements, so a v4.0 string shares only some of its metric names',
        'with v3.1 and would score wrongly here. Paste a CVSS:3.1 vector instead.'
      ] };
    }

    // Collected first, applied only once the whole string has passed.
    var chosen = Object.create(null);
    var ignored = [];
    var i, kv, key, value, allowed;

    for (i = 1; i < parts.length; i++) {
      if (!parts[i]) continue;          // tolerate a trailing or doubled slash
      kv = parts[i].split(':');
      if (kv.length !== 2 || !kv[0] || !kv[1]) {
        return { ok: false, err: [
          '"' + snippet(parts[i]) + '" is not a metric. Each one is a name and a',
          'value joined by a colon, like AV:N, separated by slashes.'
        ] };
      }
      key = kv[0].toUpperCase();
      value = kv[1].toUpperCase();

      if (OPTIONAL_METRICS[key]) { ignored.push(key); continue; }

      allowed = BASE_VALUES[key];
      if (!allowed) {
        return { ok: false, err: [
          '"' + snippet(key) + '" is not a CVSS v3.1 metric.',
          'The base metrics are AV, AC, PR, UI, S, C, I and A. Au, for instance,',
          'is CVSS v2 — the v3 equivalent is PR.'
        ] };
      }
      if (chosen[key]) {
        return { ok: false, err: [
          key + ' appears more than once. A vector names each metric exactly once,',
          'so there is no way to tell which value was meant.'
        ] };
      }
      if (allowed.indexOf(value) === -1) {
        return { ok: false, err: [
          '"' + snippet(value) + '" is not a valid value for ' + key + '.',
          key + ' accepts ' + allowed.split('').join(', ') + '.'
        ] };
      }
      chosen[key] = value;
    }

    var missing = BASE_ORDER.filter(function (m) { return !chosen[m]; });
    if (missing.length) {
      return { ok: false, err: [
        'Incomplete vector — no value for ' + missing.join(', ') + '.',
        'All eight base metrics are required. Loading a partial string would',
        'silently score it against whatever the dropdowns already showed.'
      ] };
    }

    // Every check passed, so the page can be moved now.
    BASE_ORDER.forEach(function (m) {
      var el = document.getElementById('cvss-' + m);
      if (el) el.value = chosen[m];
    });
    return { ok: true, ignored: ignored };
  }

  LabTool.define({
    id: 'cvsstool',
    run: render,
    onReady: function () {
      ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'].forEach(function (m) {
        var el = document.getElementById('cvss-' + m);
        if (el) el.addEventListener('change', render);
      });
      var load = document.getElementById('tool-load');
      if (load) load.addEventListener('click', function () {
        var text = document.getElementById('tool-text').value;
        var res = parseVector(text);
        if (!res.ok) {
          out.clear();
          res.err.forEach(function (msg) { out.err(msg); });
          return;
        }
        render();
        if (res.ignored.length) {
          // Printed after render() because render() clears the pane first.
          out.line('');
          out.warn('Ignored ' + res.ignored.join(', ') + '. Those are temporal or');
          out.warn('environmental metrics; this calculator scores the base metrics');
          out.warn('only, so the number above is the base score of that vector.');
        }
      });
      render();
    }
  });
})();

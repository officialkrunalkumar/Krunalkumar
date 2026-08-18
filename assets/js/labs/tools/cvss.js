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

  function parseVector(text) {
    var parts = String(text).trim().split('/');
    var set = false;
    parts.forEach(function (p) {
      var kv = p.split(':');
      if (kv.length !== 2) return;
      var el = document.getElementById('cvss-' + kv[0]);
      if (el) {
        var match = Array.prototype.some.call(el.options, function (o) { return o.value === kv[1]; });
        if (match) { el.value = kv[1]; set = true; }
      }
    });
    return set;
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
        if (parseVector(text)) render();
        else { out.clear(); out.err('That does not look like a CVSS v3.1 vector string.'); }
      });
      render();
    }
  });
})();

/* ==========================================================================
   regex.js — test a pattern, and find out whether it can be used against you.
   --------------------------------------------------------------------------
   Ordinary regex testers show you matches. This one also runs a ReDoS check,
   because a regular expression is one of the few places where a piece of code
   that looks completely harmless can take a server down with a 40-character
   input. Nested quantifiers and overlapping alternations backtrack
   exponentially, and the usual way people discover this is in production.

   Everything — the matching as well as the probe — happens in a Worker.
   That is not tidiness, it is the only design that works. A vulnerable
   pattern does not return slowly; it does not return. Timing re.exec() on the
   main thread means measuring a call only after it finally finishes, and
   (a+)+$ against thirty characters explores billions of paths. Run on the
   main thread, the tool freezes the page it exists to warn about — and it
   freezes on the user's own test text, before the probe ever starts. A Worker
   can be terminated mid-execution, so a timeout becomes a finding instead of
   a hang.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  var LIBRARY = [
    ['Email (practical)',  "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"],
    ['IPv4 address',       "\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b"],
    ['URL',                "https?://[^\\s<>\"']+"],
    ['Credit card (PAN)',  "\\b(?:4\\d{12}(?:\\d{3})?|5[1-5]\\d{14}|3[47]\\d{13}|6(?:011|5\\d{2})\\d{12})\\b"],
    ['AWS access key ID',  "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b"],
    ['Private key header', "-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"],
    ['JWT',                "eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"],
    ['MD5 / SHA-1 / SHA-256', "\\b[a-fA-F0-9]{32}\\b|\\b[a-fA-F0-9]{40}\\b|\\b[a-fA-F0-9]{64}\\b"],
    ['Indian PAN',         "\\b[A-Z]{5}[0-9]{4}[A-Z]\\b"],
    ['Indian Aadhaar',     "\\b[2-9]{1}[0-9]{3}\\s?[0-9]{4}\\s?[0-9]{4}\\b"],
    ['UUID',               "\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b"],
    ['Base64 blob (32+)',  "\\b[A-Za-z0-9+/]{32,}={0,2}\\b"],
    ['Windows path',       "[A-Za-z]:\\\\(?:[^\\\\/:*?\"<>|\\r\\n]+\\\\)*[^\\\\/:*?\"<>|\\r\\n]*"],
    ['Log timestamp (ISO)', "\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}"]
  ];

  /* Structural warning signs. None of these prove a pattern is vulnerable —
     the timing test decides that — but they are where to look first. */
  var SMELLS = [
    [/\([^)]*[+*][^)]*\)[+*]/, 'nested quantifier — a repeat inside a repeat, e.g. (a+)+'],
    [/\([^)]*\|[^)]*\)[+*]/,   'repeated alternation — e.g. (a|a)* or (a|ab)+'],
    [/\[[^\]]*\][+*][^|]*\[[^\]]*\][+*]/, 'adjacent unbounded classes that can match the same characters'],
    [/\.\*\.\*/,               'two .* in sequence — every split point gets tried'],
    [/\\s\*\\s\*/,             'repeated whitespace matchers in sequence']
  ];

  var MATCH_LIMIT_MS = 2000;   // matching the user's own test text
  var PROBE_LIMIT_MS = 2500;   // the pathological-input sweep
  var MAX_MATCHES = 5000;
  var SHOWN_MATCHES = 60;

  /* ------------------------------------------------------------------
     Worker source. Two phases, each reported separately, so that a hang
     in the first can still be attributed correctly.
     ------------------------------------------------------------------ */
  var WORKER_SRC = [
    'self.onmessage = function (e) {',
    '  var d = e.data, re;',
    '  try { re = new RegExp(d.source, d.flags); }',
    '  catch (err) { self.postMessage({ phase: "invalid", message: String(err && err.message || err) }); return; }',
    '',
    '  /* Phase 1 — the visitor\'s own pattern against their own test text. */',
    '  var matches = [], truncated = false, replaced = null;',
    '  if (d.subject) {',
    '    if (d.flags.indexOf("g") !== -1) {',
    '      var m, guard = 0;',
    '      while ((m = re.exec(d.subject)) !== null) {',
    '        matches.push({ index: m.index, text: m[0],',
    '                       groups: Array.prototype.slice.call(m, 1),',
    '                       named: m.groups ? Object.assign({}, m.groups) : null });',
    '        if (m.index === re.lastIndex) re.lastIndex++;',
    '        if (++guard >= d.maxMatches) { truncated = true; break; }',
    '      }',
    '    } else {',
    '      var one = re.exec(d.subject);',
    '      if (one) matches.push({ index: one.index, text: one[0],',
    '                              groups: Array.prototype.slice.call(one, 1),',
    '                              named: one.groups ? Object.assign({}, one.groups) : null });',
    '    }',
    '    if (d.replace) {',
    '      try { replaced = d.subject.replace(new RegExp(d.source, d.flags), d.replace); }',
    '      catch (err) { replaced = null; }',
    '    }',
    '  }',
    '  self.postMessage({ phase: "match", matches: matches, truncated: truncated, replaced: replaced });',
    '',
    '  /* Phase 2 — pathological inputs, to force maximum backtracking: a long',
    '     run of one character, then something that cannot match, so the engine',
    '     must exhaust every partition before it can fail. */',
    '  var seeds = d.seeds, worst = 0, worstLen = 0;',
    '  for (var s = 0; s < seeds.length; s++) {',
    '    for (var n = 6; n <= 40; n++) {',
    '      var attack = seeds[s].repeat(n) + String.fromCharCode(0) + "!";',
    '      var probe = new RegExp(d.source, d.flags.replace("g", ""));',
    '      var t0 = Date.now();',
    '      try { probe.test(attack); } catch (err) {}',
    '      var dt = Date.now() - t0;',
    '      if (dt > worst) { worst = dt; worstLen = attack.length; }',
    '      self.postMessage({ phase: "tick", ms: dt, len: attack.length });',
    /* Exponential growth is unmistakable by 120 ms; continuing past it only
       risks a single step that takes minutes. */
    '      if (dt > 120) { self.postMessage({ phase: "probe", blew: true, ms: worst, len: worstLen }); return; }',
    '    }',
    '  }',
    '  self.postMessage({ phase: "probe", blew: false, ms: worst, len: worstLen });',
    '};'
  ].join('\n');

  var active = null;   // the in-flight run, so a second Run cancels the first

  function stopActive() {
    if (!active) return;
    clearTimeout(active.timer);
    try { active.worker.terminate(); } catch (e) { /* already gone */ }
    URL.revokeObjectURL(active.url);
    active = null;
  }

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */
  function renderMatches(data, subject) {
    out.heading(data.matches.length + (data.truncated ? '+' : '') +
                ' match' + (data.matches.length === 1 ? '' : 'es'));
    if (!data.matches.length) {
      out.dim('No matches in the test text.');
      return;
    }
    data.matches.slice(0, SHOWN_MATCHES).forEach(function (m, i) {
      out.row('#' + (i + 1) + ' at ' + m.index, JSON.stringify(m.text));
      m.groups.forEach(function (g, gi) {
        if (g !== undefined && g !== null) out.row('    group ' + (gi + 1), JSON.stringify(g));
      });
      if (m.named) {
        Object.keys(m.named).forEach(function (k) {
          out.row('    <' + k + '>', JSON.stringify(m.named[k]));
        });
      }
    });
    if (data.matches.length > SHOWN_MATCHES) {
      out.dim('… and ' + (data.matches.length - SHOWN_MATCHES) + ' more');
    }
    if (data.truncated) {
      out.warn('Stopped at ' + MAX_MATCHES + ' matches to keep the page responsive.');
    }

    out.line('');
    out.heading('Highlighted');
    var last = 0;
    data.matches.slice(0, SHOWN_MATCHES).forEach(function (m) {
      if (m.index < last) return;
      out.write(subject.slice(last, m.index));
      out.write(m.text, 't-ok');
      last = m.index + (m.text.length || 1);
    });
    out.line(subject.slice(last));

    if (data.replaced !== null) {
      out.rule();
      out.heading('After replacement');
      out.line(data.replaced);
    }
  }

  function renderProbe(r) {
    if (r.timedOut) {
      out.row('result', 'still running after ' + (PROBE_LIMIT_MS / 1000) + ' seconds', 't-err');
    } else {
      out.row('worst observed', r.ms + ' ms on a ' + r.len + '-character input',
              r.blew ? 't-err' : null);
    }

    if (r.blew) {
      out.line('');
      out.err('CATASTROPHIC BACKTRACKING');
      if (r.timedOut) {
        out.err('The probe had to be killed: on a few dozen characters this');
        out.err('pattern had not finished at all. That is the finding.');
      } else {
        out.err('A very short input already costs a measurable fraction of a');
        out.err('second, and the cost roughly doubles per added character.');
      }
      out.line('');
      out.warn('If this pattern ever runs on input a user controls, that user can');
      out.warn('stall the process at will. On a single-threaded runtime — Node, or');
      out.warn('any one worker — that is a denial of service from one request.');
      out.line('');
      out.dim('Fixes, roughly in order of preference:');
      out.dim('  · remove the nesting — (a+)+ almost always means (a+)');
      out.dim('  · make alternations mutually exclusive so there is nothing to');
      out.dim('    backtrack into');
      out.dim('  · bound the repetition: {1,64} instead of + or *');
      out.dim('  · anchor the pattern so failure is decided early');
      out.dim('  · for input you do not control, use a linear-time engine (RE2)');
    } else if (r.ms > 40) {
      out.line('');
      out.warn('Slower than it should be. Not catastrophic in this test, but the');
      out.warn('growth curve is worth checking against your real maximum input');
      out.warn('length before this goes anywhere near untrusted data.');
    } else {
      out.line('');
      out.ok('No exponential blow-up observed.');
      out.dim('Inputs up to 40 characters of the worst shapes stayed fast. This');
      out.dim('is an empirical test, not a proof — a pattern can still be slow on');
      out.dim('a shape the test did not try.');
    }
  }

  function renderSmells(source) {
    var smells = SMELLS.filter(function (s) { return s[0].test(source); });
    smells.forEach(function (s) { out.line('  · ' + s[1], 't-warn'); });
    if (smells.length) out.line('');
  }

  /* ------------------------------------------------------------------ */
  function run() {
    var source = document.getElementById('tool-text').value;
    var subject = document.getElementById('tool-subject').value;
    var replace = document.getElementById('tool-replace').value;
    var flags = buildFlags();

    stopActive();
    out.clear();
    if (!source) { out.warn('Enter a regular expression above.'); return; }

    // Validate here too, so an obviously broken pattern fails instantly.
    try { new RegExp(source, flags); }
    catch (err) { out.err('Invalid pattern: ' + err.message); return; }

    out.heading('Pattern');
    out.line('/' + source + '/' + flags);
    out.rule();
    if (!subject) out.dim('Add some test text below to see matches.');
    else out.dim('matching…');

    var url, worker;
    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (err) {
      out.err('Could not start the background worker, so this pattern was not');
      out.err('run. Matching on the page directly is not safe here: a pattern');
      out.err('with catastrophic backtracking would freeze the tab.');
      return;
    }

    var state = { worker: worker, url: url, phase: 'match', worst: { ms: 0, len: 0 } };
    active = state;

    function armTimer(ms, onExpire) {
      clearTimeout(state.timer);
      state.timer = setTimeout(function () {
        if (active !== state) return;
        onExpire();
        stopActive();
      }, ms);
    }

    armTimer(MATCH_LIMIT_MS, function () {
      out.clear();
      out.heading('Pattern');
      out.line('/' + source + '/' + flags);
      out.rule();
      out.err('THIS PATTERN DID NOT FINISH');
      out.err('It was still running against your own test text after ' +
              (MATCH_LIMIT_MS / 1000) + ' seconds,');
      out.err('so it was cancelled.');
      out.line('');
      renderSmells(source);
      out.warn('That is already the answer: this is catastrophic backtracking,');
      out.warn('found on ordinary input rather than a crafted one. Had this run');
      out.warn('on the page rather than in a worker, the tab would have frozen.');
      out.line('');
      out.dim('  · remove the nesting — (a+)+ almost always means (a+)');
      out.dim('  · bound the repetition: {1,64} instead of + or *');
      out.dim('  · anchor the pattern so failure is decided early');
      out.dim('  · for input you do not control, use a linear-time engine (RE2)');
    });

    worker.onmessage = function (event) {
      if (active !== state) return;
      var d = event.data;

      if (d.phase === 'invalid') {
        clearTimeout(state.timer);
        out.err('Invalid pattern: ' + d.message);
        stopActive();
        return;
      }

      if (d.phase === 'match') {
        out.clear();
        out.heading('Pattern');
        out.line('/' + source + '/' + flags);
        out.rule();
        if (subject) renderMatches(d, subject);
        else out.dim('Add some test text below to see matches.');
        out.rule();
        out.heading('ReDoS check');
        renderSmells(source);
        out.dim('probing with pathological inputs in a background worker…');
        state.phase = 'probe';
        armTimer(PROBE_LIMIT_MS, function () {
          renderProbe({ blew: true, timedOut: true,
                        ms: state.worst.ms, len: state.worst.len });
        });
        return;
      }

      if (d.phase === 'tick') {
        if (d.ms > state.worst.ms) { state.worst.ms = d.ms; state.worst.len = d.len; }
        return;
      }

      if (d.phase === 'probe') {
        clearTimeout(state.timer);
        renderProbe(d);
        stopActive();
      }
    };

    worker.onerror = function () {
      if (active !== state) return;
      out.err('The background worker failed, so this pattern was not run.');
      stopActive();
    };

    worker.postMessage({
      source: source, flags: flags, subject: subject, replace: replace,
      maxMatches: MAX_MATCHES, seeds: ['a', 'ab', '0', ' ', 'x', 'a1']
    });
  }

  function buildFlags() {
    var flags = '';
    ['g', 'i', 'm', 's', 'u'].forEach(function (f) {
      var el = document.getElementById('re-' + f);
      if (el && el.checked) flags += f;
    });
    return flags;
  }

  LabTool.define({
    id: 'regextool',
    run: run,
    onReady: function () {
      var select = document.getElementById('tool-library');
      if (select) {
        LIBRARY.forEach(function (entry, i) {
          var opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = entry[0];
          select.appendChild(opt);
        });
        select.addEventListener('change', function () {
          if (select.value === '') return;
          document.getElementById('tool-text').value = LIBRARY[Number(select.value)][1];
          run();
        });
      }
      /* Debounced: re-running on every keystroke would spawn a worker per
         character, and a half-typed pattern is often the pathological one. */
      var pending;
      ['tool-text', 'tool-subject', 'tool-replace'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function () {
          clearTimeout(pending);
          pending = setTimeout(function () {
            if (document.getElementById('tool-text').value) run();
          }, 400);
        });
      });
      ['g', 'i', 'm', 's', 'u'].forEach(function (f) {
        var el = document.getElementById('re-' + f);
        if (el) el.addEventListener('change', function () {
          if (document.getElementById('tool-text').value) run();
        });
      });
      out.dim('Enter a pattern and some test text. Every run also checks the');
      out.dim('pattern for catastrophic backtracking.');
      out.dim('');
      out.dim('To see one fail, try   (a+)+$   against a line of a’s.');
      out.dim('');
      out.dim('Both the matching and the check run in a background worker, so');
      out.dim('a pattern that never finishes gets cancelled instead of freezing');
      out.dim('this page.');
    }
  });
})();

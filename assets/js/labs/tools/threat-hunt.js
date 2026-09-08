/* ==========================================================================
   threat-hunt.js — sixty authentication events, one compromised account.
   Find it, and account for every query you spent.
   --------------------------------------------------------------------------
   WHY THIS AND NOT ANOTHER TABLETOP. The games catalogue already has
   incident-response, which is a breach tabletop with a clock, competing
   meters and attacker events landing while you read. Building a second one
   would have split the subject across two weaker pages. This is the other
   half of the job and the site had nothing for it: not "what do you DO",
   but "what do you SEE" — deduction over a log, which is what threat hunting
   actually is between incidents.

   THE LOG IS GENERATED, NOT WRITTEN. A hand-written log is a puzzle with one
   solution its author already knows, and it teaches you that author's tell
   rather than the general shape. Every run builds a fresh domain: accounts
   with their own home hosts and working hours, ordinary traffic drawn from
   those, and one compromise threaded through it. The answer is different
   every time and the reasoning is the same.

   QUERIES ARE THE CURRENCY, and the reason is the same as the clock in the
   tabletop game. With unlimited reveals everybody wins by showing everything,
   and the skill — knowing which question to ask first — disappears. Counting
   queries makes "show me every logon outside working hours" and "show me
   account by account" different decisions, which is the whole exercise.

   THE KERBEROS QUERY IS THE POINT OF THE OTHER LAB. One of the five
   questions finds service tickets issued with no preceding ticket-granting
   request. On a real domain that is the trace a forged TGT leaves — the KDC
   never issued the TGT, so there is no 4768 to pair with the 4769. If you
   have read /labs/kerberos-flow you already know to ask it, and it will
   frequently end the hunt in one move.

   NO SCORE. The debrief says how many queries you spent and what the
   shortest honest path was, because "four" only means something next to
   "one, and here is which one".

   NOTHING IS UPLOADED. There is no real log here and no server to send one
   to. Every event is generated in this tab.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* ------------------------------------------------------------------
     Output width, measured rather than assumed.
     ------------------------------------------------------------------ */

  var COLS = 72;

  function measureCols() {
    var pane = out.node;
    if (!pane) return 72;
    var cs = getComputedStyle(pane);
    var usable = pane.clientWidth -
      (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if (/auto|scroll/.test(cs.overflowY) && pane.scrollHeight <= pane.clientHeight) usable -= 16;
    if (usable < 120) return 72;
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + cs.font;
    var sample = new Array(51).join('0');
    probe.textContent = sample;
    pane.appendChild(probe);
    var adv = probe.getBoundingClientRect().width / sample.length;
    probe.parentNode.removeChild(probe);
    if (!adv || !isFinite(adv)) return 72;
    return Math.max(26, Math.min(92, Math.floor(usable / adv) - 1));
  }

  function say(text, indent, cls) {
    indent = indent || '';
    var width = Math.max(12, COLS - indent.length);
    var words = String(text).split(/\s+/).filter(Boolean);
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (line && (line + ' ' + words[i]).length > width) {
        out.line(indent + line, cls); line = words[i];
      } else { line = line ? line + ' ' + words[i] : words[i]; }
    }
    if (line) out.line(indent + line, cls);
  }
  function p(t) { say(t, '  ', 't-dim'); }
  function pw(t) { say(t, '  ', 't-warn'); }
  function pe(t) { say(t, '  ', 't-err'); }
  function po(t) { say(t, '  ', 't-ok'); }
  function rule() { out.dim(new Array(COLS + 1).join('─')); }

  /* ------------------------------------------------------------------
     Randomness with a visible seed, so a run can be described to
     somebody else and reproduced exactly.
     ------------------------------------------------------------------ */

  var seed = 1;
  function srand(s) { seed = s >>> 0 || 1; }
  /* xorshift32: four operations, no library, and identical in every browser —
     Math.random cannot be seeded, so a shareable run needs its own generator. */
  function rnd() {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;  seed >>>= 0;
    return seed / 4294967296;
  }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function pickN(a, n) {
    var copy = a.slice();
    var hits = [];
    while (hits.length < n && copy.length) hits.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
    return hits;
  }

  /* ------------------------------------------------------------------
     The domain.
     ------------------------------------------------------------------ */

  var NAMES = ['a.sharma', 'r.patel', 'm.iyer', 'j.dsouza', 'k.nair', 's.gupta',
               'v.reddy', 'p.bose', 'svc_backup', 'svc_sql'];
  var HOSTS = ['WKS-014', 'WKS-021', 'WKS-033', 'FS-01', 'APP-02', 'DC-01', 'SQL-01'];

  var EV = {
    4624: 'logon',
    4625: 'logon failed',
    4768: 'TGT requested',
    4769: 'service ticket',
    4776: 'NTLM auth'
  };

  var state = null;

  function hhmm(m) {
    var h = Math.floor(m / 60) % 24;
    var mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function build(s) {
    srand(s);
    var accounts = NAMES.slice();
    var events = [];

    /* Every account gets a home host or two and a working pattern. Service
       accounts work at night on purpose — without them the "outside working
       hours" query would find the attacker on its own every time, which is
       neither realistic nor a puzzle. */
    var profile = {};
    accounts.forEach(function (a) {
      var svc = a.indexOf('svc_') === 0;
      profile[a] = {
        homes: svc ? pickN(['FS-01', 'APP-02', 'SQL-01'], 2) : pickN(['WKS-014', 'WKS-021', 'WKS-033', 'FS-01', 'APP-02'], 2),
        night: svc,
        svc: svc
      };
    });

    function add(t, acct, host, code) {
      events.push({ t: t, a: acct, h: host, c: code });
    }

    /* --- ordinary traffic ---

       A legitimate 4769 is ALWAYS preceded by a 4768 for the same account,
       because that is how the protocol works: you cannot ask for a service
       ticket without first holding a ticket-granting ticket. The first
       version of this generator emitted the two independently, which filled
       the log with ordinary accounts holding service tickets the KDC never
       issued a TGT for — so the forged-ticket query returned mostly noise,
       and the debrief's claim that it is the sharpest signal in the log was
       simply false. Enforcing the real dependency here is what makes that
       query mean what the page says it means. */
    var hasTgt = {};
    accounts.forEach(function (a) {
      var pr = profile[a];
      var n = pr.svc ? 6 : 5;
      for (var i = 0; i < n; i++) {
        var t = pr.night
          ? Math.floor(rnd() * 24 * 60)
          : 9 * 60 + Math.floor(rnd() * 9 * 60);
        var host = pick(pr.homes);
        add(t, a, host, 4624);
        if (rnd() < 0.5) { add(t + 1, a, 'DC-01', 4768); hasTgt[a] = true; }
        if (rnd() < 0.35 && hasTgt[a]) add(t + 2, a, host, 4769);
        /* A few genuine failed logons, because a domain with none is a domain
           where "show me the failures" is a free win. */
        if (rnd() < 0.18) add(t - 3, a, host, 4625);
      }
    });

    /* --- the compromise --- */
    var human = accounts.filter(function (a) { return profile[a].svc === false; });
    var zero = pick(human);
    var t0 = 60 + Math.floor(rnd() * 200);            // 01:00–04:20
    var away = HOSTS.filter(function (h) { return profile[zero].homes.indexOf(h) === -1; });
    var beach = pickN(away, 3);

    /* First: the account appears somewhere it has never been, at an hour it
       has never worked. That pair is the tell. */
    add(t0, zero, beach[0], 4624);
    add(t0 + 1, zero, 'DC-01', 4768);
    add(t0 + 3, zero, beach[0], 4769);

    /* Then lateral movement, with a couple of failures on the way — an
       attacker guessing at what they can reach. */
    add(t0 + 14, zero, beach[1], 4625);
    add(t0 + 15, zero, beach[1], 4624);
    add(t0 + 22, zero, beach[2], 4625);
    add(t0 + 24, zero, beach[2], 4624);

    /* Then a second identity, used from the machine the first one reached.
       This is the one that looks most alarming and is NOT patient zero.

       It has to be an account with no 4768 of its own, or the forged-ticket
       query finds a TGT for it and quietly filters the forgery out — the
       signal the page promises would then be missing from the one log it is
       supposed to appear in. Prefer an account that never requested one; if
       every account did, strip that account's 4768 events, which is exactly
       what forging a TGT means anyway. */
    function hasTickets(a) {
      for (var i = 0; i < events.length; i++) {
        if (events[i].a === a && (events[i].c === 4768 || events[i].c === 4769)) return true;
      }
      return false;
    }
    var clean = accounts.filter(function (a) { return a !== zero && !hasTickets(a); });
    var second = clean.length
      ? pick(clean)
      : pick(accounts.filter(function (a) { return a !== zero; }));

    /* If every account happened to have ticket traffic, strip this one's —
       BOTH codes, not just the 4768. Removing only the ticket-granting
       requests orphaned the account's legitimate daytime service tickets as
       well, so the forged-ticket query came back with three rows where it
       should return one, and the page's claim that it is the sharpest signal
       in the log stopped being true again. */
    if (!clean.length) {
      events = events.filter(function (e) {
        return !(e.a === second && (e.c === 4768 || e.c === 4769));
      });
    }
    add(t0 + 40, second, beach[2], 4624);
    add(t0 + 44, second, 'DC-01', 4769);   // service ticket with no 4768 before it

    /* A little more ordinary night traffic after the fact, so the last event
       in the log is not automatically the interesting one. */
    accounts.filter(function (a) { return profile[a].svc; }).forEach(function (a) {
      add(t0 + 60 + Math.floor(rnd() * 120), a, pick(profile[a].homes), 4624);
    });

    events.sort(function (x, y) { return x.t - y.t; });

    return {
      seed: s, events: events, profile: profile, accounts: accounts,
      zero: zero, second: second, t0: t0, beach: beach,
      queries: 0, asked: {}, done: false
    };
  }

  /* ------------------------------------------------------------------
     Queries.
     ------------------------------------------------------------------ */

  function show(rows, title) {
    out.line('');
    rule();
    say(title + '  (' + rows.length + ' event' + (rows.length === 1 ? '' : 's') + ')', '', 't-info');
    rule();
    if (!rows.length) { p('Nothing matched.'); return; }
    rows.forEach(function (e) {
      /* Narrow panes drop the event name and keep the code: time, account and
         host are what the deduction runs on, and a wrapped table row is worse
         than a terse one. */
      var line = hhmm(e.t) + '  ' + pad(e.a, 11) + ' ' + pad(e.h, 7) + ' ' + e.c;
      if (COLS >= 56) line += '  ' + EV[e.c];
      out.line(line, e.c === 4625 ? 't-warn' : null);
    });
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + new Array(n - s.length + 1).join(' ');
  }

  var QUERIES = [
    {
      id: 'hours',
      label: 'Logons outside 09:00–18:00',
      run: function (st) {
        var rows = st.events.filter(function (e) { return e.t < 9 * 60 || e.t >= 18 * 60; });
        show(rows, 'Outside working hours');
        p('Service accounts run at night legitimately, so this is a starting ' +
          'point rather than an answer. The question it really asks is which ' +
          'HUMAN account is here.');
      }
    },
    {
      id: 'newhost',
      label: 'Accounts on a host they have never used before',
      run: function (st) {
        var seen = {};
        var rows = [];
        st.events.forEach(function (e) {
          var k = e.a + '|' + e.h;
          if (!seen[k]) { seen[k] = true; if (st.profile[e.a].homes.indexOf(e.h) === -1 && e.h !== 'DC-01') rows.push(e); }
        });
        show(rows, 'First-ever logon of an account to a host');
        p('The strongest single signal on a real domain, and the one most ' +
          'hunts start from. People are creatures of habit; intruders are ' +
          'exploring.');
      }
    },
    {
      id: 'failed',
      label: 'Failed logons',
      run: function (st) {
        show(st.events.filter(function (e) { return e.c === 4625; }), 'Failed logons (4625)');
        p('Failures are noisy — people mistype passwords all day. What matters ' +
          'is a failure immediately followed by a success on the same host by ' +
          'the same account: that is someone finding out what they can reach.');
      }
    },
    {
      id: 'ticket',
      label: 'Service tickets with no ticket-granting request before them',
      run: function (st) {
        var tgt = {};
        st.events.forEach(function (e) { if (e.c === 4768) tgt[e.a] = true; });
        var rows = st.events.filter(function (e) { return e.c === 4769 && !tgt[e.a]; });
        show(rows, '4769 with no preceding 4768');
        p('A service ticket the KDC issued against a ticket-granting ticket it ' +
          'has no record of issuing. On a real domain that is the trace a ' +
          'forged TGT leaves — see the Kerberos lab. It points at the account ' +
          'being IMPERSONATED, which is not necessarily where the intrusion ' +
          'started.');
      }
    },
    {
      id: 'account',
      label: 'Everything for one account…',
      needsAccount: true,
      run: function (st, acct) {
        var rows = st.events.filter(function (e) { return e.a === acct; });
        show(rows, 'All events for ' + acct);
        var pr = st.profile[acct];
        p('Normal hosts for this account: ' + pr.homes.join(', ') +
          (pr.svc ? '. It is a service account and runs at all hours.' : '. It is a human account.'));
      }
    }
  ];

  /* ------------------------------------------------------------------
     Stage.
     ------------------------------------------------------------------ */

  function stage() { return document.getElementById('tt-stage'); }

  function button(label, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-choice' + (cls ? ' ' + cls : '');
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', fn);
    return b;
  }

  function render() {
    var box = stage();
    if (!box) return;
    box.textContent = '';
    if (!state || state.done) return;

    var head = document.createElement('p');
    head.className = 'tt-clock';
    head.textContent = 'run #' + state.seed + '  ·  ' + state.queries +
      ' quer' + (state.queries === 1 ? 'y' : 'ies') + ' spent';
    box.appendChild(head);

    var sit = document.createElement('p');
    sit.className = 'tt-situation';
    sit.textContent = state.queries
      ? 'Ask another question, or name the compromised account.'
      : 'Sixty-odd authentication events over one night. One human account was compromised first. Ask a question.';
    box.appendChild(sit);

    var list = document.createElement('div');
    list.className = 'tt-choices';

    QUERIES.forEach(function (q) {
      if (q.needsAccount) return;
      var used = state.asked[q.id];
      var b = button(q.label, used ? 'tt-used' : '', function () {
        state.queries++; state.asked[q.id] = true;
        q.run(state);
        if (out.node) out.node.scrollTop = out.node.scrollHeight;
        render();
      });
      if (used) {
        var tag = document.createElement('span');
        tag.className = 'tt-cost';
        tag.textContent = 'asked';
        b.appendChild(tag);
      }
      list.appendChild(b);
    });

    /* Per-account query: a select rather than ten more buttons. */
    var wrap = document.createElement('div');
    wrap.className = 'tt-row';
    var lab = document.createElement('label');
    lab.className = 'sr-only';
    lab.setAttribute('for', 'hunt-acct');
    lab.textContent = 'Account to inspect';
    var sel = document.createElement('select');
    sel.className = 'lab-select';
    sel.id = 'hunt-acct';
    state.accounts.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a; o.textContent = a;
      sel.appendChild(o);
    });
    wrap.appendChild(lab);
    wrap.appendChild(sel);
    wrap.appendChild(button('Show this account', 'tt-inline', function () {
      state.queries++;
      QUERIES[4].run(state, sel.value);
      if (out.node) out.node.scrollTop = out.node.scrollHeight;
      render();
    }));
    list.appendChild(wrap);
    box.appendChild(list);

    /* The accusation. */
    var acc = document.createElement('div');
    acc.className = 'tt-row tt-accuse';
    var lab2 = document.createElement('label');
    lab2.className = 'sr-only';
    lab2.setAttribute('for', 'hunt-guess');
    lab2.textContent = 'The compromised account';
    var g = document.createElement('select');
    g.className = 'lab-select';
    g.id = 'hunt-guess';
    state.accounts.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a; o.textContent = a;
      g.appendChild(o);
    });
    acc.appendChild(lab2);
    acc.appendChild(g);
    acc.appendChild(button('Patient zero is…', 'tt-inline', function () { accuse(g.value); }));
    box.appendChild(acc);
  }

  /* ------------------------------------------------------------------
     Verdict.
     ------------------------------------------------------------------ */

  function accuse(guess) {
    var st = state;
    st.done = true;

    out.line('');
    rule();
    say('VERDICT', '', 't-info');
    rule();
    out.line('');

    if (guess === st.zero) {
      po('Correct. ' + st.zero + ' was patient zero, first seen on ' + st.beach[0] +
         ' at ' + hhmm(st.t0) + '.');
    } else if (guess === st.second) {
      pe('Not quite. ' + guess + ' IS compromised — but it appears at ' +
         hhmm(st.t0 + 40) + ', forty minutes after the intrusion started. It is ' +
         'the account the attacker moved TO.');
      out.line('');
      p('This is the most common wrong answer and it is wrong in an instructive ' +
        'way: the loudest account in a log is usually the second one. Sort by ' +
        'first anomalous event, not by how alarming the event looks.');
      out.line('');
      po('Patient zero was ' + st.zero + ', on ' + st.beach[0] + ' at ' + hhmm(st.t0) + '.');
    } else {
      pe('No. ' + guess + ' behaved normally throughout.');
      out.line('');
      po('Patient zero was ' + st.zero + ', first seen on ' + st.beach[0] +
         ' at ' + hhmm(st.t0) + ' — a host it had never used, at an hour it had ' +
         'never worked.');
    }

    out.line('');
    rule();
    say('The trail', '', 't-info');
    rule();
    out.line('');
    p(hhmm(st.t0) + '  ' + st.zero + ' logs on to ' + st.beach[0] +
      '. It has never used that host, and its normal hosts are ' +
      st.profile[st.zero].homes.join(' and ') + '.');
    out.line('');
    p(hhmm(st.t0 + 14) + '  a failed logon to ' + st.beach[1] + ', then a success ' +
      'a minute later. Someone finding out what they can reach.');
    out.line('');
    p(hhmm(st.t0 + 24) + '  ' + st.beach[2] + ' as well.');
    out.line('');
    p(hhmm(st.t0 + 40) + '  ' + st.second + ' appears on ' + st.beach[2] +
      ' — a second identity, used from a machine the first one had just reached.');
    out.line('');
    p(hhmm(st.t0 + 44) + '  a service ticket for ' + st.second +
      ' with no ticket-granting request behind it.');

    out.line('');
    rule();
    say('Queries spent: ' + st.queries, '', st.queries <= 2 ? 't-ok' : 't-warn');
    rule();
    out.line('');
    if (st.queries === 1) {
      po('One. That is the shortest honest path.');
    } else {
      p('The shortest honest path is one query: "accounts on a host they have ' +
        'never used before". It puts patient zero at the top because the list ' +
        'is in time order and the intrusion is the earliest first-ever logon in ' +
        'the night.');
    }
    out.line('');
    p('"Outside working hours" looks like the obvious opener and is weaker here, ' +
      'because service accounts run at night legitimately and fill it with noise. ' +
      'That is true of real domains too.');
    out.line('');
    p('The 4769-without-4768 query is the sharpest signal in the log and it ' +
      'points at ' + st.second + ' — the impersonated account, not the entry ' +
      'point. A strong signal that answers a different question is how hunts ' +
      'go wrong.');

    out.line('');
    rule();
    p('Every run builds a new domain. Press Deal again for another.');
    if (out.node) out.node.scrollTop = out.node.scrollHeight;

    var box = stage();
    if (box) {
      box.textContent = '';
      var done = document.createElement('p');
      done.className = 'tt-situation';
      done.textContent = 'Solved in ' + st.queries + ' quer' + (st.queries === 1 ? 'y' : 'ies') +
        '. The verdict is in the log.';
      box.appendChild(done);
      box.appendChild(button('Deal a new domain', '', start));
    }
  }

  /* ------------------------------------------------------------------
     Run.
     ------------------------------------------------------------------ */

  function start() {
    out.clear();
    COLS = measureCols();
    var s = Math.floor(Math.random() * 90000) + 1000;
    state = build(s);

    say('Threat hunt — run #' + s, '', 't-info');
    rule();
    say('One night of authentication events from a small domain: ' +
        state.accounts.length + ' accounts, ' + HOSTS.length + ' hosts, ' +
        state.events.length + ' events.', '', 't-dim');
    out.line('');
    say('Exactly one HUMAN account was compromised first. Everything else that ' +
        'looks wrong follows from it. Ask questions, then name it.', '', 't-dim');
    out.line('');
    say('The log is hidden until you query it, and every query is counted. ' +
        'That is the exercise: knowing which question to ask first.', '', 't-dim');
    rule();
    render();
  }

  LabTool.define({
    id: 'threathunttool',
    run: start,
    onReady: function () {
      COLS = measureCols();
      p('Press Deal.');
      out.line('');
      p('A small domain, one night of authentication events, and one human ' +
        'account that was compromised before any of the others.');
      out.line('');
      p('The log starts hidden. Five questions are available and each one is ' +
        'counted, because with unlimited reveals everybody wins by showing ' +
        'everything and the skill disappears.');
      out.line('');
      p('One of the five is the Kerberos tell: a service ticket with no ' +
        'ticket-granting request behind it. It is the sharpest signal in the ' +
        'log and it answers a different question than the one you were asked — ' +
        'which is worth finding out the hard way once.');
      var box = stage();
      if (box) {
        var hint = document.createElement('p');
        hint.className = 'tt-situation';
        hint.textContent = 'Press Deal to generate a domain.';
        box.appendChild(hint);
      }
    }
  });
})();

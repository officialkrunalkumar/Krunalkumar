/* ==========================================================================
   incident-timeline.js — merge logs from several machines into one UTC timeline.
   --------------------------------------------------------------------------
   The first hour of an incident is spent doing arithmetic. The load balancer
   writes Apache combined with a +0530 offset, the application writes JSON in
   UTC, the database writes RFC 3164 syslog with no year and no zone at all,
   and the firewall writes epoch seconds. Nobody can hold four clocks in their
   head, so the order of events gets decided by whoever sounds most confident.

   So this reads each source, normalises everything to UTC, and merges. The
   part that matters is what it refuses to do: an RFC 3164 line carries no
   zone, and there is nothing in the bytes that could tell you which one it
   was. Guessing would be worse than useless, because a wrong guess produces a
   timeline that is confidently, silently, uniformly wrong. The visitor picks
   the zone per source, and the page says out loud that getting it wrong
   ruins everything downstream.

   The clock check is the reason to build this rather than sort by hand. Two
   sources that describe the same event and disagree by 47 seconds have a
   genuine skew problem; two that disagree by exactly five hours and thirty
   minutes have a timezone problem, and the fix is completely different. That
   distinction is one subtraction and a modulo, and it saves hours.

   What it cannot do is say which clock is right. It can only say that two of
   them disagree, and by how much. Deciding which one to trust needs knowledge
   of the infrastructure that no amount of log text contains.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* Both caps are about keeping one tab responsive; the work happens on the
     visitor's processor and there is no server to hand it to. */
  var MAX_LINES = 20000;
  var MAX_SOURCES = 24;
  var MAX_PRINT = 400;

  /* Every map below is keyed on text that came out of the pasted log — source
     names, message signatures. A bare object literal treats the key
     "__proto__" as an assignment to its prototype rather than as data, so a
     log line can quietly reshape the map it is being counted in. Prefixing
     every key with '@' makes the whole key space ordinary properties. */
  var K = '@';

  var lastResult = null;
  var zoneChoice = {};
  var zoneNames = [];

  /* ------------------------------------------------------------------------
     Timezones
     ------------------------------------------------------------------------
     Two kinds are offered and they are not equivalent. A named IANA zone goes
     through Intl, so it knows that Europe/London was +01:00 in August and
     +00:00 in December. A fixed offset does not: it is the right choice when
     you know the appliance is nailed to one offset all year, and the wrong
     choice for anything that observes daylight saving.
     ------------------------------------------------------------------------ */
  var NAMED_ZONES = [
    'Africa/Johannesburg', 'America/Chicago', 'America/Denver',
    'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Singapore',
    'Asia/Tokyo', 'Australia/Sydney', 'Europe/Berlin', 'Europe/London',
    'Europe/Moscow', 'Pacific/Auckland'
  ];
  var FIXED_ZONES = [
    '-10:00', '-08:00', '-07:00', '-06:00', '-05:00', '-04:00', '-03:00',
    '+01:00', '+02:00', '+03:00', '+03:30', '+04:00', '+04:30', '+05:00',
    '+05:30', '+05:45', '+06:00', '+06:30', '+07:00', '+08:00', '+09:00',
    '+09:30', '+10:00', '+11:00', '+12:00', '+13:00'
  ];

  var fmtCache = {};
  var intlWorks = true;

  function zoneFormatter(zone) {
    var hit = fmtCache[K + zone];
    if (hit !== undefined) return hit;
    var f = null;
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      f.formatToParts(new Date());
    } catch (err) {
      f = null;
      intlWorks = false;
    }
    fmtCache[K + zone] = f;
    return f;
  }

  /* The offset a zone was running at one particular instant, in milliseconds.
     There is no API that returns this directly, so the instant is formatted
     into the zone's own wall clock and the difference is taken. */
  function namedOffset(zone, utcMs) {
    var f = zoneFormatter(zone);
    if (!f) return null;
    var parts;
    try { parts = f.formatToParts(new Date(utcMs)); } catch (err) { return null; }
    var v = {};
    for (var i = 0; i < parts.length; i++) v[K + parts[i].type] = parts[i].value;
    var hour = parseInt(v[K + 'hour'], 10);
    // hour12:false renders midnight as 24 on some engines, which is a real
    // difference of one day if it is passed through unchanged.
    if (hour === 24) hour = 0;
    var asUtc = Date.UTC(
      parseInt(v[K + 'year'], 10), parseInt(v[K + 'month'], 10) - 1,
      parseInt(v[K + 'day'], 10), hour,
      parseInt(v[K + 'minute'], 10), parseInt(v[K + 'second'], 10));
    if (!isFinite(asUtc)) return null;
    return asUtc - utcMs;
  }

  function offsetAt(zone, utcMs) {
    if (!zone || zone === 'UTC') return 0;
    var m = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
    if (m) {
      var s = parseInt(m[2], 10) * 3600000 + parseInt(m[3], 10) * 60000;
      return m[1] === '-' ? -s : s;
    }
    var o = namedOffset(zone, utcMs);
    return o === null ? 0 : o;
  }

  /* A wall-clock reading with no zone is not one instant, it is a question.
     Most of the year it has exactly one answer. On the two days a zone shifts
     it has either two answers (the hour that runs twice in autumn) or none at
     all (the hour that never happens in spring), and both cases are reported
     rather than resolved silently — an incident that happened during a DST
     transition is precisely the one where an hour matters. */
  var DAY_MS = 24 * 60 * 60 * 1000;

  function wallToUtc(wallMs, zone) {
    if (!zone || zone === 'UTC') return { utc: wallMs, note: null };
    /* The two candidate offsets are taken a day either side of the reading,
       not at the reading itself. Taking them at the reading found only one of
       them on the autumn fall-back: 01:30 on the day America/New_York goes
       back happens twice, and both the first guess and the refinement landed
       on the -04:00 instant, so the second one was never noticed and the hour
       that matters most in the year was reported as unambiguous. A day either
       side brackets any transition, because no zone shifts by more than a
       couple of hours and none shifts twice in two days. */
    var o1 = offsetAt(zone, wallMs - DAY_MS);
    var o2 = offsetAt(zone, wallMs + DAY_MS);
    var cands = [];
    var tries = o1 === o2 ? [o1] : [o1, o2];
    for (var i = 0; i < tries.length; i++) {
      var t = wallMs - tries[i];
      if (t + offsetAt(zone, t) === wallMs && cands.indexOf(t) < 0) cands.push(t);
    }
    if (!cands.length) return { utc: wallMs - o1, note: 'gap' };
    if (cands.length > 1) return { utc: Math.min(cands[0], cands[1]), note: 'ambiguous' };
    return { utc: cands[0], note: null };
  }

  /* ------------------------------------------------------------------------
     Formatting helpers
     ------------------------------------------------------------------------ */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function padTo(s, n) {
    s = String(s);
    return s.length >= n ? s + ' ' : s.padEnd(n, ' ');
  }

  function iso(ms) {
    try { return new Date(ms).toISOString(); } catch (err) { return 'unrepresentable'; }
  }

  /* Days appear above 48 hours only. Below that "36h 10m" is the more useful
     reading of a gap in an incident, and above it an hour count runs to six
     digits and stops meaning anything. */
  function durText(ms) {
    var neg = ms < 0;
    var v = Math.abs(ms);
    var rest = v % 1000;
    var s = Math.floor(v / 1000);
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    var body;
    if (h >= 48) body = Math.floor(h / 24) + 'd ' + (h % 24) + 'h ' + pad2(m) + 'm';
    else if (h) body = h + 'h ' + pad2(m) + 'm ' + pad2(s) + 's';
    else if (m) body = m + 'm ' + pad2(s) + 's';
    else body = s + '.' + String(1000 + rest).slice(1) + 's';
    return (neg ? '-' : '') + body;
  }

  function clip(text, n) {
    var s = String(text).replace(/[\t\r\n]+/g, ' ');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function pct(a, b) { return b ? Math.round((a / b) * 100) + '%' : '0%'; }

  /* ------------------------------------------------------------------------
     Per-line format detection
     ------------------------------------------------------------------------
     Order matters. JSON is tried first because a JSON line also contains an
     ISO timestamp and would otherwise be read as one, losing the message
     field. Apache comes next because its timestamp sits inside brackets and
     cannot be confused with anything else. The looser patterns are last.
     ------------------------------------------------------------------------ */
  var MONTHS = {
    '@jan': 0, '@feb': 1, '@mar': 2, '@apr': 3, '@may': 4, '@jun': 5,
    '@jul': 6, '@aug': 7, '@sep': 8, '@oct': 9, '@nov': 10, '@dec': 11
  };
  var MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var FORMAT_NAMES = {
    '@apache': 'Apache/nginx combined',
    '@rfc5424': 'syslog RFC 5424',
    '@iso-offset': 'ISO 8601 with an offset',
    '@iso-naive': 'ISO 8601, no offset',
    '@rfc3164': 'syslog RFC 3164, no year, no zone',
    '@windows': 'Windows Event Log style',
    '@epoch-s': 'epoch seconds',
    '@epoch-ms': 'epoch milliseconds',
    '@json': 'JSON lines'
  };

  var RE_APACHE = /\[(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{1,2}):(\d{2}):(\d{2})(\.\d{1,6})?\s*([+-]\d{4})\]/;
  var RE_5424 = /^\s*<(\d{1,3})>(\d)\s+(\S+)(\s|$)/;
  var RE_ISO_OFF = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d{1,9})?[ ]?(Z|z|[+-]\d{2}:?\d{2})/;
  var RE_ISO_NAIVE = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d{1,9})?/;
  var RE_3164 = /^\s*(?:<\d{1,3}>)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})(\.\d{1,6})?(?=\s|$)/;
  var RE_WIN = /(\d{1,2})\/(\d{1,2})\/(\d{4})[\s,]+(\d{1,2}):(\d{2}):(\d{2})(\.\d{1,7})?\s*(AM|PM|am|pm)?/;
  var RE_EPOCH = /^\s*(\d{9,13})(\.\d{1,6})?(?![\d.])/;

  var TS_KEYS = ['timestamp', '@timestamp', 'ts', 'time', 'eventtime', 'event_time',
                 'datetime', 'date', '_time', 'occurred_at', 'createdat', 'created_at',
                 'asctime'];
  var MSG_KEYS = ['message', 'msg', 'event', 'log', 'text', 'description',
                  'short_message', 'event_message', 'line'];

  function fracMs(str) {
    if (!str) return 0;
    var d = (str.charAt(0) === '.' ? str.slice(1) : str) + '000';
    return parseInt(d.slice(0, 3), 10) || 0;
  }

  function offsetFromToken(tok) {
    if (tok === 'Z' || tok === 'z') return 0;
    var m = /^([+-])(\d{2}):?(\d{2})$/.exec(tok);
    if (!m) return null;
    var v = parseInt(m[2], 10) * 3600000 + parseInt(m[3], 10) * 60000;
    return m[1] === '-' ? -v : v;
  }

  /* Everything must land inside a window a person could plausibly be
     investigating. It is the cheapest guard there is against a detector that
     fired on the wrong number: a "timestamp" in the year 55000 is a parse
     bug, not evidence. */
  function sane(ms) {
    return isFinite(ms) && ms > Date.UTC(1990, 0, 1) && ms < Date.UTC(2100, 0, 1);
  }

  /* Date.UTC does not reject an out-of-range component, it rolls it over.
     Month 13 becomes January of the next year and day 45 becomes the middle of
     the month after that, so the line

         2026-13-45T99:99:99Z something broke

     came back as a calm, confident 2027-02-18T04:40:39Z and sat in the middle
     of the timeline looking exactly like evidence. Nothing in the output said
     it had been invented. So every assembled date is read back out, and any
     component that moved means the line is refused instead.

     Second 60 is the one legal exception: ISO 8601 and RFC 5424 both allow a
     leap second, and no browser clock has ever recorded one, so it is folded
     onto :59 rather than thrown away. */
  function mkUtc(y, mo, d, h, mi, s, ms) {
    if (s === 60) s = 59;
    if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    var t = Date.UTC(y, mo, d, h, mi, s, ms || 0);
    if (!isFinite(t)) return null;
    var back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo ||
        back.getUTCDate() !== d || back.getUTCHours() !== h ||
        back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return null;
    return t;
  }

  var OUT_OF_RANGE = 'the date and time parts are out of range, so this is not a real instant';

  function epochFromNumber(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    var abs = Math.abs(n);
    // 1e11 splits the two units cleanly for anything in this century: as
    // seconds it is the year 5138, as milliseconds it is 1973.
    if (abs >= 1e11) return { utc: n, fmt: 'epoch-ms' };
    if (abs >= 1e8) return { utc: n * 1000, fmt: 'epoch-s' };
    return null;
  }

  /* Used for a bare line and, unchanged, for the string sitting in a JSON
     timestamp field. */
  function stampFromString(text) {
    var m = RE_ISO_OFF.exec(text);
    if (m) {
      var off = offsetFromToken(m[8]);
      if (off !== null) {
        var t = mkUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, fracMs(m[7]));
        if (t === null) return { bad: OUT_OF_RANGE };
        return { fmt: 'iso-offset', stamp: m[0], utc: t - off };
      }
    }
    m = RE_ISO_NAIVE.exec(text);
    if (m) {
      var w = mkUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, fracMs(m[7]));
      if (w === null) return { bad: OUT_OF_RANGE };
      return { fmt: 'iso-naive', stamp: m[0], wall: w };
    }
    m = RE_EPOCH.exec(text);
    if (m) {
      var digits = m[1];
      var base = epochFromNumber(parseInt(digits, 10));
      if (base) {
        if (base.fmt === 'epoch-s' && m[2]) base.utc += fracMs(m[2]);
        base.stamp = m[0].replace(/^\s+/, '');
        return base;
      }
      return { bad: 'a ' + digits.length + '-digit number is neither epoch seconds nor epoch milliseconds in any plausible range' };
    }
    return null;
  }

  function shortJson(obj, skipKey) {
    var copy = {}, keys = Object.keys(obj), i;
    for (i = 0; i < keys.length; i++) {
      if (keys[i] !== skipKey) copy[keys[i]] = obj[keys[i]];
    }
    var text;
    try { text = JSON.stringify(copy); } catch (err) { text = '[unserialisable object]'; }
    return clip(text, 300);
  }

  function pickKey(obj, wanted) {
    var keys = Object.keys(obj), i, j;
    for (i = 0; i < wanted.length; i++) {
      for (j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === wanted[i]) return keys[j];
      }
    }
    return null;
  }

  function fromJson(line) {
    var obj;
    try { obj = JSON.parse(line); } catch (err) { return null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    var tsKey = pickKey(obj, TS_KEYS);
    if (!tsKey) {
      return { bad: 'this line is valid JSON, but none of the fields I look for held a time' };
    }
    var v = obj[tsKey];
    var got = null;
    if (typeof v === 'number') got = epochFromNumber(v);
    else if (typeof v === 'string') got = stampFromString(v);
    if (!got || got.bad) {
      return { bad: 'JSON field "' + clip(tsKey, 40) + '" did not hold a time I could read' };
    }
    var msgKey = pickKey(obj, MSG_KEYS);
    return {
      fmt: 'json', inner: got.fmt, stamp: String(v),
      utc: got.utc, wall: got.wall,
      msg: msgKey ? clip(String(obj[msgKey]), 400) : shortJson(obj, tsKey)
    };
  }

  /* The message is the line with its timestamp cut out rather than the tail
     after it. Apache puts the client address before the bracket and syslog
     puts the host after it; keeping both halves keeps the host name, which is
     usually the second thing you want to know. */
  function withoutStamp(line, stamp) {
    var i = stamp ? line.indexOf(stamp) : -1;
    if (i < 0) return line.replace(/\s+/g, ' ').replace(/^\s+/, '');
    var a = i, b = i + stamp.length;
    // Event Viewer's CSV export quotes the timestamp field. Cutting the value
    // out and leaving the quotes and the comma behind put a stray  "" ,  in
    // the middle of every message from that source, and it followed the
    // message all the way into the exported report.
    if (line.charAt(a - 1) === '"' && line.charAt(b) === '"') { a--; b++; }
    var left = line.slice(0, a);
    var right = line.slice(b);
    if (/,\s*$/.test(left) && /^\s*,/.test(right)) right = right.replace(/^\s*,/, '');
    var rest = (left + ' ' + right)
      .replace(/\s+/g, ' ').replace(/^[\s\-:|]+/, '').replace(/\s+$/, '');
    return rest || line.replace(/\s+/g, ' ').replace(/^\s+/, '');
  }

  function detect(line) {
    var m, r;

    if (/^\s*\{/.test(line)) {
      r = fromJson(line);
      if (r) return r;
    }

    m = RE_APACHE.exec(line);
    if (m) {
      var mon = MONTHS[K + m[2].toLowerCase()];
      var off = offsetFromToken(m[8]);
      if (mon !== undefined && off !== null) {
        var at = mkUtc(+m[3], mon, +m[1], +m[4], +m[5], +m[6], fracMs(m[7]));
        if (at === null) return { bad: OUT_OF_RANGE };
        return { fmt: 'apache', stamp: m[0], utc: at - off, msg: withoutStamp(line, m[0]) };
      }
    }

    m = RE_5424.exec(line);
    if (m) {
      if (m[3] === '-') {
        return { bad: 'RFC 5424 line whose timestamp field is the NILVALUE "-", so it carries no time at all' };
      }
      r = stampFromString(m[3]);
      if (r && !r.bad && (r.fmt === 'iso-offset' || r.fmt === 'iso-naive')) {
        return {
          fmt: 'rfc5424', inner: r.fmt, stamp: r.stamp,
          utc: r.utc, wall: r.wall, msg: withoutStamp(line, r.stamp)
        };
      }
    }

    m = RE_ISO_OFF.exec(line);
    if (m) {
      r = stampFromString(m[0]);
      if (r) {
        if (r.bad) return r;
        r.msg = withoutStamp(line, r.stamp);
        return r;
      }
    }

    m = RE_ISO_NAIVE.exec(line);
    if (m) {
      r = stampFromString(m[0]);
      if (r) {
        if (r.bad) return r;
        r.msg = withoutStamp(line, r.stamp);
        return r;
      }
    }

    m = RE_3164.exec(line);
    if (m) {
      var mon3 = MONTHS[K + m[1].toLowerCase()];
      if (mon3 !== undefined) {
        return {
          fmt: 'rfc3164', noYear: true, stamp: m[0].replace(/^\s+/, '').replace(/^<\d{1,3}>/, ''),
          mon: mon3, day: +m[2], h: +m[3], mi: +m[4], s: +m[5], ms: fracMs(m[6]),
          msg: withoutStamp(line, m[0].replace(/^\s+/, ''))
        };
      }
    }

    m = RE_EPOCH.exec(line);
    if (m) {
      r = stampFromString(line);
      if (r) {
        if (r.bad) return r;
        r.msg = withoutStamp(line, r.stamp);
        return r;
      }
    }

    /* Last, because it is the only pattern here that is genuinely ambiguous.
       Event Viewer's CSV export writes the machine's short date format, which
       on an en-US machine is month first and in most of the rest of the world
       is day first, and the bytes do not say which. A first number above 12
       settles it; below 13 it does not, and the line is flagged. */
    m = RE_WIN.exec(line);
    if (m) {
      var a = +m[1], b = +m[2];
      var dayFirst = a > 12;
      var mo = dayFirst ? b - 1 : a - 1;
      var dy = dayFirst ? a : b;
      var hh = +m[4];
      var ap = m[8] ? m[8].toUpperCase() : '';
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      var ww = mkUtc(+m[3], mo, dy, hh, +m[5], +m[6], fracMs(m[7]));
      if (ww !== null) {
        return {
          fmt: 'windows', stamp: m[0], wall: ww,
          ambiguousDate: !dayFirst && b <= 12 && a !== b,
          msg: withoutStamp(line, m[0])
        };
      }
    }

    return null;
  }

  /* ------------------------------------------------------------------------
     Event signatures, for the automatic "these two are the same event" check
     ------------------------------------------------------------------------
     Numbers and long hex runs are masked, then the last six words are used as
     the key. The tail rather than the whole line, because the same event
     shipped to two collectors usually differs at the front — one has a
     facility and a host, the other has a severity and a service — and agrees
     from the message text onward.

     It is a heuristic and it is stated as one on the page. The length and word
     filters below throw away keys like "# # # of # in" that would otherwise
     match half a log against the other half.
     ------------------------------------------------------------------------ */
  var SIG_TOKENS = 6;

  function sigKey(msg) {
    var s = String(msg).toLowerCase();
    s = s.replace(/[0-9a-f]{8,}/g, '#');
    s = s.replace(/\d+/g, '#');
    s = s.replace(/[^a-z#]+/g, ' ');
    var all = s.split(' ');
    var toks = [];
    for (var i = 0; i < all.length; i++) if (all[i]) toks.push(all[i]);
    if (!toks.length) return null;
    var tail = toks.slice(Math.max(0, toks.length - SIG_TOKENS));
    var key = tail.join(' ');
    if (key.length < 20) return null;
    var words = 0;
    for (var j = 0; j < tail.length; j++) if (/^[a-z]{3,}$/.test(tail[j])) words++;
    if (words < 3) return null;
    return key;
  }

  function median(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var n = a.length;
    if (!n) return 0;
    return n % 2 ? a[(n - 1) / 2] : Math.round((a[n / 2 - 1] + a[n / 2]) / 2);
  }

  /* The whole point of the tool, in eight lines.

     A quarter of an hour is the granularity every real timezone offset lands
     on, from +05:45 in Kathmandu to -09:30 in the Marquesas. A clock that has
     drifted lands there only by coincidence: NTP failure produces seconds and
     minutes, a dead RTC produces something wild, and neither produces exactly
     five hours and thirty minutes. So an offset within three seconds of a
     quarter-hour boundary, and at least a quarter of an hour wide, is a
     timezone that was set wrong somewhere — and the fix is a dropdown, not an
     NTP investigation. */
  var QUARTER = 15 * 60 * 1000;

  function classifyOffset(deltaMs) {
    var abs = Math.abs(deltaMs);
    if (abs < 2000) return 'agree';
    var rem = abs % QUARTER;
    if (abs >= QUARTER && (rem <= 3000 || rem >= QUARTER - 3000)) return 'zone';
    return 'skew';
  }

  /* ------------------------------------------------------------------------
     Input splitting
     ------------------------------------------------------------------------ */
  var RE_HEADER = /^[ \t]*(===+|---+)[ \t]*(.{1,60}?)[ \t]*\1[ \t]*$/;

  function uniqueName(taken, name) {
    var base = name.replace(/\s+/g, ' ') || 'source';
    var candidate = base, n = 2;
    while (taken[K + candidate]) { candidate = base + ' (' + n + ')'; n++; }
    taken[K + candidate] = true;
    return candidate;
  }

  function splitSources(text) {
    var lines = text.split(/\r?\n/);
    var sources = [], taken = {}, current = null;
    var truncated = false, dropped = 0;
    for (var i = 0; i < lines.length; i++) {
      if (i >= MAX_LINES) { truncated = true; break; }
      var line = lines[i].replace(/\s+$/, '');
      var m = RE_HEADER.exec(line);
      if (m) {
        if (sources.length >= MAX_SOURCES) { current = null; dropped++; continue; }
        current = { name: uniqueName(taken, m[2]), rows: [], events: [], counts: {}, order: sources.length };
        sources.push(current);
        continue;
      }
      if (!line.replace(/\s/g, '')) continue;
      if (!current) {
        if (sources.length >= MAX_SOURCES) continue;
        current = { name: uniqueName(taken, 'log'), rows: [], events: [], counts: {}, order: sources.length };
        sources.push(current);
      }
      current.rows.push({ no: i + 1, raw: line });
    }
    return { sources: sources, truncated: truncated, droppedSources: dropped, seen: lines.length };
  }

  /* ------------------------------------------------------------------------
     The zone controls, one per source, rebuilt whenever the source names change
     ------------------------------------------------------------------------ */
  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function zoneOptionsInto(sel) {
    sel.appendChild(option('UTC', 'UTC (or the log is already UTC)'));
    var local = null;
    try { local = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (err) { local = null; }
    if (local && NAMED_ZONES.indexOf(local) < 0) {
      sel.appendChild(option(local, 'This browser: ' + local));
    }
    var g1 = document.createElement('optgroup');
    g1.label = 'Named zone (daylight saving handled)';
    NAMED_ZONES.forEach(function (z) {
      g1.appendChild(option(z, z + (z === local ? ' (this browser)' : '')));
    });
    sel.appendChild(g1);
    var g2 = document.createElement('optgroup');
    g2.label = 'Fixed offset (no daylight saving)';
    FIXED_ZONES.forEach(function (z) { g2.appendChild(option(z, 'Fixed ' + z)); });
    sel.appendChild(g2);
  }

  function zoneFor(name) {
    var v = zoneChoice[K + name];
    return v || 'UTC';
  }

  function sameNames(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function buildZoneRow(names) {
    var host = document.getElementById('tool-zones');
    if (!host) return;
    if (sameNames(names, zoneNames)) return;
    zoneNames = names.slice();
    host.textContent = '';

    if (!names.length) {
      var empty = document.createElement('p');
      empty.className = 'tl-note';
      empty.textContent = 'A timezone control appears here for each source once you merge.';
      host.appendChild(empty);
      return;
    }

    var note = document.createElement('p');
    note.className = 'tl-note';
    note.textContent = 'Timezone per source. This is applied only to lines that carry no zone of their own. ' +
      'Nothing can work it out for you, and a wrong choice moves every line in that source by a whole offset.';
    host.appendChild(note);

    names.forEach(function (name) {
      var wrap = document.createElement('label');
      wrap.className = 'tl-zone';
      var span = document.createElement('span');
      span.textContent = 'Timezone for ' + name;
      var sel = document.createElement('select');
      sel.className = 'lab-select';
      zoneOptionsInto(sel);
      sel.value = zoneFor(name);
      sel.addEventListener('change', function () {
        zoneChoice[K + name] = sel.value;
        run();
      });
      wrap.appendChild(span);
      wrap.appendChild(sel);
      host.appendChild(wrap);
    });
  }

  /* ------------------------------------------------------------------------
     Pair rules typed by the visitor
     ------------------------------------------------------------------------ */
  function parsePairs(text) {
    var rules = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;
      var m = /^(.+?)\s*(==|>>|->)\s*(.+)$/.exec(line);
      if (!m) { rules.push({ bad: line }); return; }
      rules.push({ left: m[1], op: m[2] === '==' ? '==' : '>>', right: m[3], text: line });
    });
    return rules;
  }

  function findEvents(events, needle) {
    var n = String(needle).toLowerCase();
    var first = null, count = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].msg.toLowerCase().indexOf(n) >= 0) {
        count++;
        if (!first) first = events[i];
      }
    }
    return { ev: first, count: count };
  }

  /* ------------------------------------------------------------------------
     The merge
     ------------------------------------------------------------------------ */
  function merge() {
    out.clear();

    var text = document.getElementById('tool-in').value;
    if (!text || !text.replace(/\s/g, '')) {
      out.warn('Nothing to merge yet.');
      out.line('');
      out.dim('Paste logs into the left pane, or pick a worked example from the');
      out.dim('toolbar. Separate each source with a line like');
      out.dim('  === web-01 ===');
      out.dim('and everything under it is treated as one source with one clock.');
      lastResult = null;
      return;
    }

    var split = splitSources(text);
    var sources = split.sources;
    buildZoneRow(sources.map(function (s) { return s.name; }));

    var yearField = document.getElementById('tool-year');
    var baseYear = parseInt(yearField && yearField.value, 10);
    if (!isFinite(baseYear) || baseYear < 1990 || baseYear > 2099) {
      baseYear = new Date().getUTCFullYear();
    }

    var events = [], unparsed = [];
    var now = Date.now();

    sources.forEach(function (src) {
      var zone = zoneFor(src.name);
      src.zone = zone;
      src.carried = 0;
      src.rollovers = 0;
      src.ambiguousDates = 0;
      src.dstGap = 0;
      src.dstAmbiguous = 0;

      var year = baseYear, prevMon = -1;

      src.rows.forEach(function (row) {
        var d;
        try { d = detect(row.raw); } catch (err) { d = { bad: 'the parser threw on this line: ' + ((err && err.message) || String(err)) }; }
        if (!d) {
          unparsed.push({ src: src.name, no: row.no, raw: row.raw, why: 'no timestamp pattern matched' });
          return;
        }
        if (d.bad) {
          unparsed.push({ src: src.name, no: row.no, raw: row.raw, why: d.bad });
          return;
        }

        var wall = d.wall;
        if (d.noYear) {
          // File order is the only evidence there is for a year-less log
          // crossing New Year. If the source is not in file order this is
          // wrong, which is why the count is reported rather than hidden.
          if (prevMon === 11 && d.mon === 0) { year++; src.rollovers++; }
          prevMon = d.mon;
          wall = mkUtc(year, d.mon, d.day, d.h, d.mi, d.s, d.ms);
          if (wall === null) {
            unparsed.push({
              src: src.name, no: row.no, raw: row.raw,
              why: d.day + ' ' + MONTH_ABBR[d.mon] + ' ' + pad2(d.h) + ':' + pad2(d.mi) + ':' + pad2(d.s) +
                   ' is not a real instant in ' + year +
                   ' — either the assumed year is wrong for this line, or the time is out of range'
            });
            return;
          }
        }

        var utc = d.utc, zoneNote = null, applied = 'carried in the line';
        if (utc === undefined || utc === null) {
          var conv = wallToUtc(wall, zone);
          utc = conv.utc;
          zoneNote = conv.note;
          applied = zone;
          if (zoneNote === 'gap') src.dstGap++;
          if (zoneNote === 'ambiguous') src.dstAmbiguous++;
        } else {
          src.carried++;
        }

        if (!sane(utc)) {
          unparsed.push({
            src: src.name, no: row.no, raw: row.raw,
            why: 'the timestamp read as ' + iso(utc) + ', which is outside 1990-2100 and so is almost certainly a misread'
          });
          return;
        }

        var fmtKey = d.fmt;
        src.counts[K + fmtKey] = (src.counts[K + fmtKey] || 0) + 1;
        if (d.ambiguousDate) src.ambiguousDates++;

        var ev = {
          src: src.name, srcOrder: src.order, no: row.no, raw: row.raw,
          fmt: fmtKey, inner: d.inner || null, stamp: d.stamp || '',
          msg: d.msg || row.raw, utc: utc, applied: applied, zoneNote: zoneNote,
          seq: events.length
        };
        ev.sig = sigKey(ev.msg);
        events.push(ev);
        src.events.push(ev);
      });

      // Detected format and confidence. Confidence here means one thing only:
      // the share of this source's readable lines that matched the winning
      // pattern. It is not a probability that the format is right.
      var best = null, bestN = 0, total = 0, kinds = 0;
      Object.keys(src.counts).forEach(function (k) {
        total += src.counts[k];
        kinds++;
        if (src.counts[k] > bestN) { bestN = src.counts[k]; best = k.slice(1); }
      });
      src.format = best;
      src.formatCount = bestN;
      src.parsed = total;
      src.kinds = kinds;
      src.confidence = pct(bestN, src.rows.length);
    });

    events.sort(function (a, b) {
      if (a.utc !== b.utc) return a.utc - b.utc;
      if (a.srcOrder !== b.srcOrder) return a.srcOrder - b.srcOrder;
      return a.seq - b.seq;
    });

    var findings = clockCheck(events, sources);

    lastResult = {
      events: events, sources: sources, unparsed: unparsed,
      findings: findings, baseYear: baseYear, split: split, now: now
    };

    render(lastResult);
  }

  /* ------------------------------------------------------------------------
     Clock check
     ------------------------------------------------------------------------ */
  function clockCheck(events, sources) {
    var f = { auto: [], pairs: [], drift: [], outliers: [], badRules: [] };

    /* Automatic same-event matching. */
    var index = {}, keys = [];
    events.forEach(function (ev) {
      if (!ev.sig) return;
      var slot = index[K + ev.sig];
      if (!slot) { slot = index[K + ev.sig] = { srcs: {}, names: [] }; keys.push(ev.sig); }
      if (!slot.srcs[K + ev.src]) { slot.srcs[K + ev.src] = ev; slot.names.push(ev.src); }
    });

    var pairAgg = {}, pairKeys = [];
    keys.forEach(function (key) {
      var slot = index[K + key];
      if (slot.names.length < 2) return;
      for (var i = 0; i < slot.names.length; i++) {
        for (var j = i + 1; j < slot.names.length; j++) {
          var na = slot.names[i], nb = slot.names[j];
          var ea = slot.srcs[K + na], eb = slot.srcs[K + nb];
          if (nb < na) { var tn = na; na = nb; nb = tn; var te = ea; ea = eb; eb = te; }
          // Length-prefixed rather than joined with a separator: a source name
          // is whatever the visitor typed between the === markers, so any
          // separator character could appear inside one and merge two
          // different pairs into one bucket. The length says where to split.
          var pk = na.length + '|' + na + nb;
          var agg = pairAgg[K + pk];
          if (!agg) { agg = pairAgg[K + pk] = { a: na, b: nb, deltas: [], samples: [] }; pairKeys.push(pk); }
          agg.deltas.push(eb.utc - ea.utc);
          if (agg.samples.length < 3) agg.samples.push({ key: key, ea: ea, eb: eb });
        }
      }
    });

    /* Source names were sorted alphabetically above so that a pair is
       aggregated under one key however the two sources happen to appear. That
       is right for the arithmetic and wrong for the sentence: it produced
       "gw-01 reads -5h 30m after app-11", which a tired person at three in the
       morning will read as the opposite of what it says. Whichever source is
       actually behind is named first when the finding is built. */
    pairKeys.forEach(function (pk) {
      var agg = pairAgg[K + pk];
      var med = median(agg.deltas);
      var lo = Math.min.apply(null, agg.deltas);
      var hi = Math.max.apply(null, agg.deltas);
      var behind = agg.a, ahead = agg.b;
      if (med < 0) { behind = agg.b; ahead = agg.a; med = -med; }
      f.auto.push({
        a: behind, b: ahead, matches: agg.deltas.length, median: med,
        spread: hi - lo, kind: classifyOffset(med), samples: agg.samples
      });
    });

    /* Visitor-declared pairs. */
    var rules = parsePairs(document.getElementById('tool-pairs').value);
    rules.forEach(function (rule) {
      if (rule.bad) { f.badRules.push(rule.bad); return; }
      var L = findEvents(events, rule.left);
      var R = findEvents(events, rule.right);
      if (!L.ev || !R.ev) {
        f.pairs.push({ rule: rule, missing: true, leftCount: L.count, rightCount: R.count });
        return;
      }
      var delta = R.ev.utc - L.ev.utc;
      f.pairs.push({
        rule: rule, left: L.ev, right: R.ev,
        leftCount: L.count, rightCount: R.count,
        delta: delta,
        kind: rule.op === '==' ? classifyOffset(delta) : (delta < 0 ? 'impossible' : 'ordered')
      });
    });

    /* A source whose own timestamps go backwards. Two concatenated files or a
       rotated log will do this legitimately, so it is reported as a question. */
    sources.forEach(function (src) {
      var back = 0, worst = 0, firstAt = null;
      for (var i = 1; i < src.events.length; i++) {
        var d = src.events[i - 1].utc - src.events[i].utc;
        if (d > 1000) {
          back++;
          if (d > worst) worst = d;
          if (firstAt === null) firstAt = src.events[i].no;
        }
      }
      if (back) f.drift.push({ src: src.name, count: back, worst: worst, line: firstAt });
    });

    /* A source sitting a whole timezone away from every other source, with no
       matched event needed. This is what a wrong dropdown looks like from the
       outside, and it is the most common single mistake this tool exists to
       catch.

       This one compares the MIDDLE of two different sets of events, so its
       answer is never exact and classifyOffset's three-second window is the
       wrong test for it. The threshold is instead the plain observation that
       machines do not drift by quarter-hours: a quarter of an hour or more of
       separation is a zone, and the nearest round offset is reported so the
       visitor can see how close it lands. */
    if (sources.length > 1) {
      // A source that already has a matched-event comparison does not need
      // this one. Comparing two events known to be the same event is strictly
      // better evidence than comparing the middles of two piles of unrelated
      // events, and printing both said the same thing twice in different
      // numbers, which reads like two separate problems.
      var covered = {};
      f.auto.forEach(function (m) { covered[K + m.a] = true; covered[K + m.b] = true; });
      var withEvents = sources.filter(function (s) { return s.events.length > 0; });
      if (withEvents.length > 1) {
        withEvents.forEach(function (src) {
          if (covered[K + src.name]) return;
          var mine = src.events.map(function (e) { return e.utc; });
          var others = [];
          events.forEach(function (e) { if (e.src !== src.name) others.push(e.utc); });
          if (!others.length) return;
          var delta = median(mine) - median(others);
          if (Math.abs(delta) >= QUARTER) {
            var round = Math.round(delta / QUARTER) * QUARTER;
            f.outliers.push({
              src: src.name, delta: delta, zone: src.zone,
              round: round, off: Math.abs(delta - round),
              // Nothing on Earth is more than 26 hours from anything else:
              // +14:00 in Kiritimati to -12:00 at the date line is the whole
              // range. A larger gap is not a timezone, and calling it one
              // sends the visitor to change a dropdown that was never the
              // problem — it is a wrong year, or two unrelated logs.
              beyondZone: Math.abs(delta) > 26 * 60 * 60 * 1000,
              pairOnly: withEvents.length === 2
            });
          }
        });
      }
    }

    return f;
  }

  /* ------------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------------ */
  function fmtName(key) { return FORMAT_NAMES[K + key] || key || 'unknown'; }

  function render(r) {
    var events = r.events, sources = r.sources;

    out.heading('MERGED TIMELINE, NORMALISED TO UTC');
    out.row('sources', sources.length);
    out.row('events placed', events.length);
    out.row('lines not parsed', r.unparsed.length);
    if (events.length) {
      out.row('span', iso(events[0].utc) + '  to  ' + iso(events[events.length - 1].utc));
      out.row('elapsed', durText(events[events.length - 1].utc - events[0].utc));
    }
    if (r.split.truncated) {
      out.warn('Input stopped at ' + MAX_LINES + ' lines; the rest was not read.');
    }
    if (r.split.droppedSources) {
      out.warn(r.split.droppedSources + ' source header(s) past the limit of ' + MAX_SOURCES + ' were ignored.');
    }
    if (!intlWorks) {
      out.warn('This browser refused a named timezone, so only fixed offsets are reliable here.');
    }

    /* --- sources --- */
    out.rule();
    out.heading('SOURCES');
    var width = 10;
    sources.forEach(function (s) { if (s.name.length + 2 > width) width = Math.min(28, s.name.length + 2); });
    sources.forEach(function (s) {
      out.write(padTo(s.name, width), 't-info');
      out.write(padTo(s.events.length + '/' + s.rows.length, 10), 't-dim');
      out.write(padTo(fmtName(s.format), 36), 't-dim');
      out.line('confidence ' + s.confidence + (s.kinds > 1 ? ', ' + s.kinds + ' formats mixed' : ''));
      out.write(padTo('', width), 't-dim');
      out.line('zone applied: ' + (s.carried === s.events.length && s.events.length
        ? 'none needed, every line carried its own offset'
        : s.zone + (s.carried ? ' (to ' + (s.events.length - s.carried) + ' of ' + s.events.length + ' lines; the rest carried an offset)' : '')), 't-dim');
    });
    out.line('');
    out.dim('Confidence is the share of this source’s lines that matched the winning');
    out.dim('pattern, and nothing more. It is not a probability that the format is right.');

    /* --- assumptions --- */
    var assumptions = [];
    var noZone = sources.filter(function (s) { return s.events.length > s.carried; });
    if (noZone.length) {
      assumptions.push(noZone.length + ' source(s) carry no zone in the line, so the dropdown above decided their UTC time. Wrong dropdown, wrong timeline.');
    }
    var yearless = sources.filter(function (s) { return s.format === 'rfc3164'; });
    if (yearless.length) {
      assumptions.push('Year-less syslog lines were dated ' + r.baseYear + ' because that is what the Year field says. RFC 3164 has no year field at all.');
    }
    sources.forEach(function (s) {
      if (s.rollovers) {
        assumptions.push(s.name + ': a December-to-January rollover was detected in file order, so the year was advanced ' + s.rollovers + ' time(s). If this source is not in file order, that is wrong.');
      }
      if (s.ambiguousDates) {
        assumptions.push(s.name + ': ' + s.ambiguousDates + ' Windows-style date(s) had both numbers below 13, so month-first was assumed. A day-first machine wrote a different day.');
      }
      if (s.dstGap) {
        assumptions.push(s.name + ': ' + s.dstGap + ' line(s) name a local time that does not exist in ' + s.zone + ' (the hour skipped by a spring-forward). They were placed as if the earlier offset applied.');
      }
      if (s.dstAmbiguous) {
        assumptions.push(s.name + ': ' + s.dstAmbiguous + ' line(s) name a local time that happens twice in ' + s.zone + ' (an autumn fall-back). The earlier of the two instants was used.');
      }
    });
    if (events.length) {
      var future = events[events.length - 1].utc - r.now;
      if (future > 86400000) {
        assumptions.push('The last event is ' + durText(future) + ' in the future compared with this machine’s clock. Usually that means the assumed year or a zone is wrong.');
      }
    }
    if (assumptions.length) {
      out.rule();
      out.heading('ASSUMPTIONS THAT COULD BE WRONG');
      assumptions.forEach(function (a) { out.warn('- ' + a); });
    }

    /* --- clock check --- */
    out.rule();
    out.heading('CLOCK CHECK');
    var f = r.findings;
    var said = 0;

    f.outliers.forEach(function (o) {
      said++;
      if (o.beyondZone) {
        out.err('NOT THE SAME WINDOW: ' + o.src + ' sits ' + durText(o.delta) + ' from the');
        out.err('middle of every other source. No timezone on Earth is more than 26h');
        out.err('wide, so a dropdown cannot be the explanation.');
        out.dim('  Check the assumed year, check whether a line was misread, and check');
        out.dim('  that these logs really do cover the same incident.');
        return;
      }
      out.err('TIMEZONE, probably: ' + o.src + ' sits ' + durText(o.delta) + ' from the middle');
      out.err('of every other source. Machines do not drift by hours; that is the size');
      out.err('and the shape of a timezone.');
      out.dim('  nearest round offset: ' + durText(o.round) + ', which it is within ' + durText(o.off) + ' of.');
      out.dim('  It is currently set to ' + o.zone + '. Try the zone its host actually runs in.');
      if (o.pairOnly) {
        out.dim('  With only two sources both are listed, because nothing here can say');
        out.dim('  which of the two is the one that is wrong.');
      }
      out.dim('  A source that genuinely only logged at a different time of day looks');
      out.dim('  identical from here. This is a hint, not a verdict.');
    });

    f.auto.forEach(function (m) {
      if (m.kind === 'agree') {
        said++;
        out.ok(m.a + ' and ' + m.b + ' agree within ' + durText(m.median) + ' across ' + m.matches + ' matched event(s).');
        return;
      }
      said++;
      if (m.kind === 'zone') {
        out.err('TIMEZONE, probably: ' + m.b + ' reads ' + durText(m.median) + ' after ' + m.a);
        out.err('on ' + m.matches + ' event(s) they both logged. That is a round offset, so it is');
        out.err('far more likely to be a zone set wrong than a clock that has drifted.');
      } else {
        out.warn('CLOCK SKEW: ' + m.b + ' reads ' + durText(m.median) + ' after ' + m.a);
        out.warn('on ' + m.matches + ' event(s) they both logged. Not a round offset, so this');
        out.warn('looks like a genuine clock difference rather than a zone mistake.');
      }
      out.dim('  spread across matches: ' + durText(m.spread) +
              (m.spread > 5000 ? '  (inconsistent, so treat the figure loosely)' : '  (consistent)'));
      m.samples.forEach(function (s) {
        out.dim('  matched: ' + clip(s.ea.msg, 62));
        out.dim('    ' + s.ea.src + ' ' + iso(s.ea.utc) + '   ' + s.eb.src + ' ' + iso(s.eb.utc));
      });
      out.dim('  Which of the two is right is not something this can know.');
    });

    f.pairs.forEach(function (p) {
      said++;
      if (p.missing) {
        out.warn('Pair rule found nothing: ' + clip(p.rule.text, 70));
        out.dim('  left matched ' + p.leftCount + ' line(s), right matched ' + p.rightCount + '.');
        return;
      }
      var head = clip(p.rule.left, 34) + '  ' + p.rule.op + '  ' + clip(p.rule.right, 34);
      if (p.rule.op === '>>') {
        if (p.kind === 'impossible') {
          out.err('IMPOSSIBLE ORDER: ' + head);
          out.err('  the second event is ' + durText(-p.delta) + ' BEFORE the first.');
          out.dim('  ' + p.left.src + ' ' + iso(p.left.utc) + '  ' + clip(p.left.msg, 52));
          out.dim('  ' + p.right.src + ' ' + iso(p.right.utc) + '  ' + clip(p.right.msg, 52));
          out.dim('  Either a clock is wrong, a zone is wrong, or these are not the');
          out.dim('  two events you meant. All three happen.');
        } else {
          out.ok('Order holds: ' + head + '  (+' + durText(p.delta) + ')');
        }
      } else {
        if (p.kind === 'agree') {
          out.ok('Same event, clocks agree: ' + head + '  (' + durText(p.delta) + ')');
        } else if (p.kind === 'zone') {
          out.err('TIMEZONE, probably: ' + head);
          out.err('  ' + p.right.src + ' reads ' + durText(p.delta) + ' after ' + p.left.src + ' for one event.');
        } else {
          out.warn('CLOCK SKEW: ' + head);
          out.warn('  ' + p.right.src + ' reads ' + durText(p.delta) + ' after ' + p.left.src + ' for one event.');
        }
      }
      if (p.leftCount > 1 || p.rightCount > 1) {
        out.dim('  ' + p.leftCount + ' line(s) matched the left text and ' + p.rightCount +
                ' the right; the earliest of each was used.');
      }
    });

    f.drift.forEach(function (d) {
      said++;
      out.warn(d.src + ': its own timestamps go backwards ' + d.count + ' time(s), the worst by ' +
               durText(d.worst) + ' (first at input line ' + d.line + ').');
      out.dim('  Two files concatenated, or a rotated log, does this legitimately.');
    });

    f.badRules.forEach(function (b) {
      out.warn('Pair rule ignored, no == or >> in it: ' + clip(b, 60));
    });

    if (!said) {
      out.ok('No disagreement found.');
      out.dim('That is not a clean bill of health. Nothing here matched two sources to');
      out.dim('the same event, so there was nothing to compare. Pair events yourself in');
      out.dim('the box below the toolbar to get a real answer.');
    }

    /* --- timeline --- */
    out.rule();
    out.heading('TIMELINE');
    if (!events.length) {
      out.warn('No line in that input produced a timestamp.');
    } else {
      out.write(padTo('#', 6), 't-dim');
      out.write(padTo('UTC', 26), 't-dim');
      out.write(padTo('gap', 14), 't-dim');
      out.write(padTo('source', width), 't-dim');
      out.line('event', 't-dim');
      var shown = Math.min(events.length, MAX_PRINT);
      for (var i = 0; i < shown; i++) {
        var ev = events[i];
        out.write(padTo(i + 1, 6), 't-dim');
        out.write(padTo(iso(ev.utc), 26), 't-info');
        out.write(padTo(i === 0 ? '' : '+' + durText(ev.utc - events[i - 1].utc), 14), 't-dim');
        out.write(padTo(ev.src, width), 't-dim');
        out.line(clip(ev.msg, 150));
      }
      if (events.length > shown) {
        out.line('');
        out.dim('Showing the first ' + shown + ' of ' + events.length + ' events so the pane stays');
        out.dim('usable. The Markdown and CSV exports contain all of them.');
      }
    }

    /* --- unparsed --- */
    out.rule();
    out.heading('LINES THAT WOULD NOT PARSE');
    if (!r.unparsed.length) {
      out.ok('None. Every non-blank line produced a timestamp.');
    } else {
      out.warn(r.unparsed.length + ' line(s). They are listed rather than dropped, because a');
      out.warn('line this could not read is exactly where an incident tends to hide.');
      var cap = Math.min(r.unparsed.length, 60);
      for (var u = 0; u < cap; u++) {
        var bad = r.unparsed[u];
        out.line('  line ' + bad.no + ' [' + bad.src + ']  ' + clip(bad.raw, 96));
        out.dim('    ' + bad.why);
      }
      if (r.unparsed.length > cap) out.dim('  and ' + (r.unparsed.length - cap) + ' more, all present in the exports.');
    }

    /* --- limits --- */
    out.rule();
    out.heading('WHAT THIS DOES NOT TELL YOU');
    out.dim('- It cannot say which clock is right, only that two of them disagree.');
    out.dim('- It does not know your infrastructure. Every zone here came from the');
    out.dim('  dropdowns, and a wrong one produces a timeline that is confidently wrong.');
    out.dim('- It fetches nothing. No NTP check, no reverse DNS, no threat feed, no');
    out.dim('  clock oracle of any kind. There is no server behind this page.');
    out.dim('- The automatic same-event match compares the last ' + SIG_TOKENS + ' words of each');
    out.dim('  message with numbers masked. It misses events worded differently, and');
    out.dim('  it can pair two that only look alike. Pair them yourself when it matters.');
    out.dim('- Ordering within the same second is input order, not evidence.');
  }

  /* ------------------------------------------------------------------------
     Exports
     ------------------------------------------------------------------------ */

  /* The house ES5 rule bans template literals, and the check that enforces it
     greps the source for the backtick character itself, so the one character
     this file genuinely needs to emit is built from its code point. */
  var TICK = String.fromCharCode(96);

  function mdCell(s) {
    return String(s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  }

  var RE_TICK = new RegExp(TICK, 'g');

  function code(s) { return TICK + mdCell(s).replace(RE_TICK, 'ˋ') + TICK; }

  function bytesOf(text) {
    try { return new TextEncoder().encode(text); } catch (err) { return text; }
  }

  function buildMarkdown(r) {
    var L = [];
    var events = r.events;
    L.push('# Incident timeline');
    L.push('');
    L.push('Merged from ' + r.sources.length + ' source(s), ' + events.length +
           ' event(s), all times normalised to UTC.');
    if (events.length) {
      L.push('Span: ' + iso(events[0].utc) + ' to ' + iso(events[events.length - 1].utc) +
             ' (' + durText(events[events.length - 1].utc - events[0].utc) + ').');
    }
    L.push('');
    L.push('Built in a browser tab. Nothing was uploaded to produce it.');
    L.push('');

    L.push('## Sources');
    L.push('');
    L.push('| Source | Events | Lines in | Detected format | Confidence | Zone applied |');
    L.push('| --- | ---: | ---: | --- | ---: | --- |');
    r.sources.forEach(function (s) {
      var applied = (s.carried === s.events.length && s.events.length)
        ? 'none needed, offsets in the lines' : s.zone;
      L.push('| ' + mdCell(s.name) + ' | ' + s.events.length + ' | ' + s.rows.length + ' | ' +
             mdCell(fmtName(s.format)) + ' | ' + s.confidence + ' | ' + mdCell(applied) + ' |');
    });
    L.push('');
    L.push('Confidence is the share of that source’s lines matching the winning pattern. It is not a probability that the format is right.');
    L.push('');

    L.push('## Assumptions that could be wrong');
    L.push('');
    L.push('- Year used for year-less syslog lines: ' + r.baseYear + '.');
    r.sources.forEach(function (s) {
      if (s.events.length > s.carried) {
        L.push('- ' + mdCell(s.name) + ' carries no zone of its own; ' + mdCell(s.zone) +
               ' was chosen by hand. If that is wrong, every one of its ' +
               (s.events.length - s.carried) + ' line(s) is in the wrong place.');
      }
      if (s.rollovers) L.push('- ' + mdCell(s.name) + ': the year was advanced ' + s.rollovers + ' time(s) at a December-to-January rollover, inferred from file order.');
      if (s.ambiguousDates) L.push('- ' + mdCell(s.name) + ': ' + s.ambiguousDates + ' Windows-style date(s) were read month-first because both numbers were below 13.');
      if (s.dstGap) L.push('- ' + mdCell(s.name) + ': ' + s.dstGap + ' line(s) name a local time that does not exist in that zone.');
      if (s.dstAmbiguous) L.push('- ' + mdCell(s.name) + ': ' + s.dstAmbiguous + ' line(s) name a local time that occurs twice; the earlier instant was used.');
    });
    L.push('');

    L.push('## Clock check');
    L.push('');
    var f = r.findings, wrote = 0;
    f.outliers.forEach(function (o) {
      wrote++;
      if (o.beyondZone) {
        L.push('- **Not the same window.** ' + mdCell(o.src) + ' sits ' + durText(o.delta) +
               ' from the middle of every other source, which is wider than any timezone on Earth. Check the assumed year and whether these logs cover the same incident.');
        return;
      }
      L.push('- **Probable timezone mistake.** ' + mdCell(o.src) + ' sits ' + durText(o.delta) +
             ' from the middle of every other source, within ' + durText(o.off) + ' of a round ' +
             durText(o.round) + ' offset. It is set to ' + mdCell(o.zone) +
             '. Machines do not drift by hours.');
    });
    f.auto.forEach(function (m) {
      wrote++;
      if (m.kind === 'agree') {
        L.push('- ' + mdCell(m.a) + ' and ' + mdCell(m.b) + ' agree within ' + durText(m.median) +
               ' across ' + m.matches + ' matched event(s).');
      } else if (m.kind === 'zone') {
        L.push('- **Probable timezone mistake.** ' + mdCell(m.b) + ' reads ' + durText(m.median) + ' after ' +
               mdCell(m.a) + ' on ' + m.matches + ' shared event(s); spread ' + durText(m.spread) +
               '. A round offset points at a zone, not at drift.');
      } else {
        L.push('- **Clock skew.** ' + mdCell(m.b) + ' reads ' + durText(m.median) + ' after ' +
               mdCell(m.a) + ' on ' + m.matches + ' shared event(s); spread ' + durText(m.spread) +
               '. Which clock is right is not determined here.');
      }
    });
    f.pairs.forEach(function (p) {
      wrote++;
      if (p.missing) {
        L.push('- Pair rule matched nothing: ' + code(p.rule.text) + '.');
      } else if (p.rule.op === '>>' && p.kind === 'impossible') {
        L.push('- **Impossible order.** ' + code(p.rule.right) + ' happens ' + durText(-p.delta) +
               ' before ' + code(p.rule.left) + ' (' + mdCell(p.right.src) + ' at ' + iso(p.right.utc) +
               ', ' + mdCell(p.left.src) + ' at ' + iso(p.left.utc) + ').');
      } else if (p.rule.op === '>>') {
        L.push('- Order holds: ' + code(p.rule.left) + ' then ' + code(p.rule.right) + ', ' + durText(p.delta) + ' apart.');
      } else {
        L.push('- Paired as one event: ' + code(p.rule.left) + ' and ' + code(p.rule.right) +
               ' differ by ' + durText(p.delta) + ' (' + p.kind + ').');
      }
    });
    f.drift.forEach(function (d) {
      wrote++;
      L.push('- ' + mdCell(d.src) + ' has timestamps that go backwards ' + d.count +
             ' time(s), the worst by ' + durText(d.worst) + '. Concatenated or rotated files do this legitimately.');
    });
    if (!wrote) L.push('- Nothing matched two sources to one event, so no clock comparison was possible.');
    L.push('');

    L.push('## Timeline');
    L.push('');
    L.push('| # | UTC | Gap | Source | Event |');
    L.push('| ---: | --- | ---: | --- | --- |');
    events.forEach(function (ev, i) {
      L.push('| ' + (i + 1) + ' | ' + iso(ev.utc) + ' | ' +
             (i === 0 ? '' : durText(ev.utc - events[i - 1].utc)) + ' | ' +
             mdCell(ev.src) + ' | ' + mdCell(ev.msg) + ' |');
    });
    L.push('');

    L.push('## What happened');
    L.push('');
    events.forEach(function (ev, i) {
      L.push((i + 1) + '. **' + iso(ev.utc) + '** — ' + mdCell(ev.src) + ' — ' + mdCell(ev.msg));
    });
    L.push('');

    L.push('## Lines that would not parse');
    L.push('');
    if (!r.unparsed.length) {
      L.push('None.');
    } else {
      r.unparsed.forEach(function (b) {
        L.push('- Input line ' + b.no + ', ' + mdCell(b.src) + ': ' + code(clip(b.raw, 200)) + ' — ' + mdCell(b.why));
      });
    }
    L.push('');

    L.push('## What this does not tell you');
    L.push('');
    L.push('- It cannot say which clock is right, only that two of them disagree.');
    L.push('- Every timezone above was chosen by a person. A wrong choice moves a whole source.');
    L.push('- No network request of any kind was made: no NTP check, no DNS, no threat feed.');
    L.push('- Automatic same-event matching compares the last ' + SIG_TOKENS +
           ' words of each message with numbers masked. It misses rewordings and can pair lookalikes.');
    L.push('- Ordering inside the same second is input order, not evidence.');
    L.push('');
    return L.join('\n');
  }

  /* RFC 4180, and the two clauses people skip. A field is quoted when it holds
     a comma, a double quote, CR or LF; inside a quoted field every double
     quote is doubled. Leading and trailing spaces are quoted too, because a
     reader is allowed to strip them otherwise and log messages are full of
     alignment padding that would then be lost. */
  function csvField(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/[",\r\n]/.test(s) || /^\s/.test(s) || /\s$/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function csvRow(cells) {
    return cells.map(csvField).join(',') + '\r\n';
  }

  function buildCsv(r) {
    // The BOM is not RFC 4180 and it is not pretty. Without it Excel reads a
    // UTF-8 CSV as the machine's legacy codepage, and every non-ASCII byte in
    // a log message turns to mojibake in the incident report. Written from its
    // code point because a zero-width character typed into source is a
    // character nobody reviewing this file can see.
    var text = String.fromCharCode(0xFEFF);
    text += csvRow(['n', 'utc_iso', 'epoch_ms', 'source', 'detected_format',
                    'zone_applied', 'original_timestamp', 'message', 'input_line']);
    r.events.forEach(function (ev, i) {
      text += csvRow([i + 1, iso(ev.utc), ev.utc, ev.src, fmtName(ev.fmt),
                      ev.applied, ev.stamp, ev.msg, ev.no]);
    });
    r.unparsed.forEach(function (b) {
      text += csvRow(['', '', '', b.src, 'unparsed', '', '', b.raw, b.no]);
    });
    return text;
  }

  function formulaRisk(r) {
    var n = 0;
    r.events.forEach(function (ev) {
      if (/^[=+\-@]/.test(ev.msg)) n++;
    });
    return n;
  }

  function exportMd() {
    if (!lastResult || !lastResult.events.length) { needMerge(); return; }
    LabTool.download(bytesOf(buildMarkdown(lastResult)), 'incident-timeline.md', 'text/markdown');
    out.rule();
    out.ok('Markdown saved as incident-timeline.md');
    out.dim('A source table, the assumptions, the clock check, a timeline table and');
    out.dim('a numbered narrative. Built here in the tab, not fetched.');
  }

  function exportCsv() {
    if (!lastResult || !lastResult.events.length) { needMerge(); return; }
    LabTool.download(bytesOf(buildCsv(lastResult)), 'incident-timeline.csv', 'text/csv');
    out.rule();
    out.ok('CSV saved as incident-timeline.csv');
    out.dim('RFC 4180 quoting, CRLF line endings, and a UTF-8 byte order mark so');
    out.dim('Excel does not mangle non-ASCII log text.');
    var risk = formulaRisk(lastResult);
    if (risk) {
      out.warn(risk + ' message(s) begin with = + - or @, which Excel will treat as a');
      out.warn('formula. The CSV is not altered to prevent that: editing evidence to');
      out.warn('please a spreadsheet is the wrong trade. Import it with every column');
      out.warn('set to Text instead.');
    }
  }

  function needMerge() {
    out.rule();
    out.warn('Nothing to export yet. Press Merge first.');
  }

  /* ------------------------------------------------------------------------
     Worked examples
     ------------------------------------------------------------------------
     Both are written by hand so the arithmetic in them is checkable. The
     first is four real formats around one 502; the second exists only to show
     the difference between a clock that has drifted and a zone that was set
     wrong.
     ------------------------------------------------------------------------ */
  var SAMPLES = {
    '@checkout': {
      year: 2026,
      pairs: 'upstream database call started >> upstream timeout after 540ms\n' +
             'connection pool exhausted >> connection pool recovered\n' +
             'POST /api/checkout HTTP/1.1" 502 == upstream timeout after 540ms',
      text: [
        '=== web-01 ===',
        '203.0.113.44 - - [31/Aug/2026:21:34:12 +0530] "POST /api/checkout HTTP/1.1" 502 166 "-" "curl/8.6.0"',
        '203.0.113.44 - - [31/Aug/2026:21:34:20 +0530] "POST /api/checkout HTTP/1.1" 200 812 "-" "curl/8.6.0"',
        '',
        '=== app-02 ===',
        '{"ts":"2026-08-31T16:04:11.480Z","level":"warn","service":"checkout","msg":"upstream database call started for order 88213"}',
        '{"ts":"2026-08-31T16:04:12.020Z","level":"error","service":"checkout","msg":"upstream timeout after 540ms for order 88213"}',
        '{"ts":"2026-08-31T16:04:19.900Z","level":"info","service":"checkout","msg":"retry succeeded for order 88213 after 7900ms"}',
        '',
        '=== db-03 ===',
        'Aug 31 21:34:09 db-03 postgres[2211]: LOG: connection pool exhausted, 200 of 200 connections in use',
        'Aug 31 21:34:18 db-03 postgres[2211]: LOG: connection pool recovered, 12 connections free',
        '',
        '=== fw-04 ===',
        '1788192248 fw-04 deny tcp 203.0.113.44:51322 -> 10.0.2.11:5432 policy=default-deny',
        '1788192259 fw-04 allow tcp 203.0.113.44:51340 -> 10.0.2.11:5432 policy=app-tier',
        '',
        '=== siem-09 ===',
        '"Error","8/31/2026 4:04:59 PM","checkout-shipper","upstream timeout after 540ms for order 88213"',
        '"Information","8/31/2026 4:05:07 PM","checkout-shipper","retry succeeded for order 88213 after 7900ms"',
        '',
        '=== gw-05 ===',
        '<134>1 2026-08-31T16:04:10.900Z gw-05 edge - - - accepted connection from 203.0.113.44',
        '<134>1 2026-08-31T16:04:21.100Z gw-05 edge - - - closed connection from 203.0.113.44',
        'this line has no timestamp in it at all and is listed rather than dropped'
      ].join('\n')
    },
    '@zone': {
      year: 2026,
      pairs: 'gw-01 forwarded request 4f2a == app-11 forwarded request 4f2a',
      text: [
        '=== gw-01 ===',
        '2026-08-31 16:04:12 gw-01 forwarded request 4f2a for tenant acme to app-11',
        '2026-08-31 16:04:13 gw-01 received 200 from app-11 for request 4f2a',
        '2026-08-31 16:09:41 gw-01 forwarded request 51bd for tenant acme to app-11',
        '',
        '=== app-11 ===',
        '2026-08-31 21:34:12 app-11 forwarded request 4f2a for tenant acme to app-11',
        '2026-08-31 21:34:13 app-11 handled request 4f2a in 880ms',
        '2026-08-31 21:39:41 app-11 forwarded request 51bd for tenant acme to app-11'
      ].join('\n')
    }
  };

  function loadSample(key) {
    var s = SAMPLES[K + key];
    if (!s) return;
    document.getElementById('tool-in').value = s.text;
    document.getElementById('tool-pairs').value = s.pairs;
    document.getElementById('tool-year').value = s.year;
    // A previous example may have left zone choices behind under names this
    // one also uses, which would silently pre-fix the very mistake the
    // example is meant to demonstrate.
    zoneChoice = {};
    zoneNames = [];
    run();
  }

  /* ------------------------------------------------------------------------ */
  function run() {
    try {
      merge();
    } catch (err) {
      out.rule();
      out.err('Something in that input stopped the merge part-way.');
      out.err('Whatever printed above is real; everything after it is missing.');
      out.line('');
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
      out.dim('Details: ' + ((err && err.message) || String(err)));
    }
  }

  LabTool.define({
    id: 'incidenttimeline',
    run: run,
    onReady: function () {
      var yearField = document.getElementById('tool-year');
      if (yearField && !yearField.value) yearField.value = new Date().getUTCFullYear();

      document.getElementById('tool-md').addEventListener('click', exportMd);
      document.getElementById('tool-csv').addEventListener('click', exportCsv);
      document.getElementById('tool-copy').addEventListener('click', function () {
        LabTool.copy(out.node.textContent, this);
      });
      document.getElementById('tool-clear').addEventListener('click', function () {
        document.getElementById('tool-in').value = '';
        document.getElementById('tool-pairs').value = '';
        zoneChoice = {};
        zoneNames = [];
        buildZoneRow([]);
        lastResult = null;
        out.clear();
        out.dim('Cleared. Nothing was stored anywhere.');
      });
      var sample = document.getElementById('tool-sample');
      sample.addEventListener('change', function () {
        if (sample.value) loadSample(sample.value);
      });

      buildZoneRow([]);

      out.dim('Paste logs from as many machines as you have, separating each source');
      out.dim('with a line like  === web-01 ===  , then press Merge.');
      out.dim('');
      out.dim('Formats read per line: Apache/nginx combined, syslog RFC 3164 and');
      out.dim('RFC 5424, ISO 8601 with and without an offset, Windows Event Log');
      out.dim('style, JSON lines with a timestamp field, epoch seconds and epoch');
      out.dim('milliseconds. Lines that match none of those are listed, not dropped.');
      out.dim('');
      out.warn('Sources whose lines carry no zone are placed using the dropdowns above.');
      out.warn('Nothing can work that out from the bytes. Get one wrong and the whole');
      out.warn('timeline is wrong, quietly and consistently.');
    }
  });
})();

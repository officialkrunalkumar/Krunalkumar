/* ==========================================================================
   timezones.js — a meeting planner that draws the day in several zones at once.
   --------------------------------------------------------------------------
   Every part of this is arithmetic on one number: the offset, in minutes,
   between a zone and UTC at a particular instant. There is no timezone
   database in this file and no lookup over the network. Intl.DateTimeFormat
   is asked to render a known instant in a named zone, the rendered wall clock
   is read back with formatToParts, and the difference between that and the
   instant is the offset. The browser already ships the IANA rules to drive
   Intl, so this borrows them rather than shipping a stale copy.

   That single trick is what gets daylight saving right. Ask for the offset at
   09:00 UTC and again at 10:00 UTC on a transition date and the two answers
   differ; a binary search between them finds the exact second the clocks
   moved. The same reading, taken twice on either side of that second, gives
   the skipped hour and the repeated hour directly, because both are just the
   gap between the two wall-clock readings of one instant.

   Nothing here is laid out per hour cell. Every band, tick and bar is placed
   as a percentage of the window, because India is +05:30, Nepal +05:45 and
   the Chatham Islands +12:45, and a grid of equal cells would have to round
   them to the nearest hour. That rounding is the exact mistake this page is
   about, so the drawing refuses to make it: a half-hour zone's ticks land on
   the half, visibly out of step with its neighbours.

   What it deliberately is not: it is not a calendar. It cannot see anyone's
   free/busy, it does not know your colleagues, it sends nothing and books
   nothing. It does not know public holidays, Friday half-days, Ramadan hours
   or the fact that nobody in your Madrid office answers anything at 14:00.
   Working hours are whatever you type into the two pickers on each row, which
   is a guess, not a fact. And every rule it draws comes from the IANA
   database inside your browser: a device with stale system data will draw a
   stale transition, and governments change these rules with weeks of notice.
   The page says all of that out loud rather than hiding it in a footnote.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
  var MAX_ZONES = 8;
  var out = LabTool.out('tool-out');

  var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
             'August', 'September', 'October', 'November', 'December'];
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Night is drawn as 22:00 to 06:00 local. It is an editorial choice, not a
     fact about anybody, and it is only ever used to pick the words "the
     middle of the night" for a slot that lands there. It never changes a
     number. */
  var NIGHT_FROM = 22 * 60, NIGHT_TO = 6 * 60;

  /* --- the built-in zone list -------------------------------------------
     Two jobs. It is the curated picker, where a country name is more use
     than an IANA path, and it is the fallback for the type-ahead list on a
     browser without Intl.supportedValuesOf. The half-hour and quarter-hour
     zones are in here on purpose: they are the ones this tool exists to draw
     honestly. */
  var PICKS = [
    ['South Asia', [
      ['India', 'Asia/Kolkata'], ['Nepal', 'Asia/Kathmandu'],
      ['Pakistan', 'Asia/Karachi'], ['Bangladesh', 'Asia/Dhaka'],
      ['Sri Lanka', 'Asia/Colombo'], ['Myanmar', 'Asia/Yangon']]],
    ['Asia and the Gulf', [
      ['United Arab Emirates', 'Asia/Dubai'], ['Saudi Arabia', 'Asia/Riyadh'],
      ['Iran', 'Asia/Tehran'], ['Israel', 'Asia/Jerusalem'],
      ['Singapore', 'Asia/Singapore'], ['Malaysia', 'Asia/Kuala_Lumpur'],
      ['Indonesia (Jakarta)', 'Asia/Jakarta'], ['Philippines', 'Asia/Manila'],
      ['Hong Kong', 'Asia/Hong_Kong'], ['China (Shanghai)', 'Asia/Shanghai'],
      ['South Korea', 'Asia/Seoul'], ['Japan', 'Asia/Tokyo']]],
    ['Europe', [
      ['United Kingdom', 'Europe/London'], ['Ireland', 'Europe/Dublin'],
      ['Portugal', 'Europe/Lisbon'], ['Spain', 'Europe/Madrid'],
      ['France', 'Europe/Paris'], ['Netherlands', 'Europe/Amsterdam'],
      ['Germany', 'Europe/Berlin'], ['Poland', 'Europe/Warsaw'],
      ['Greece', 'Europe/Athens'], ['Ukraine', 'Europe/Kyiv'],
      ['Turkey', 'Europe/Istanbul'], ['Russia (Moscow)', 'Europe/Moscow']]],
    ['Africa', [
      ['Morocco', 'Africa/Casablanca'], ['Nigeria', 'Africa/Lagos'],
      ['Egypt', 'Africa/Cairo'], ['Kenya', 'Africa/Nairobi'],
      ['South Africa', 'Africa/Johannesburg']]],
    ['The Americas', [
      ['US Eastern', 'America/New_York'], ['US Central', 'America/Chicago'],
      ['US Mountain', 'America/Denver'], ['US Arizona', 'America/Phoenix'],
      ['US Pacific', 'America/Los_Angeles'], ['Canada (Toronto)', 'America/Toronto'],
      ['Canada (Vancouver)', 'America/Vancouver'], ['Newfoundland', 'America/St_Johns'],
      ['Mexico City', 'America/Mexico_City'], ['Colombia', 'America/Bogota'],
      ['Peru', 'America/Lima'], ['Brazil (Sao Paulo)', 'America/Sao_Paulo'],
      ['Argentina', 'America/Argentina/Buenos_Aires'], ['Chile', 'America/Santiago']]],
    ['Australia and the Pacific', [
      ['Australia (Perth)', 'Australia/Perth'], ['Australia (Brisbane)', 'Australia/Brisbane'],
      ['Australia (Adelaide)', 'Australia/Adelaide'], ['Australia (Sydney)', 'Australia/Sydney'],
      ['Lord Howe Island', 'Australia/Lord_Howe'], ['New Zealand', 'Pacific/Auckland'],
      ['Chatham Islands', 'Pacific/Chatham'], ['Fiji', 'Pacific/Fiji'],
      ['Hawaii', 'Pacific/Honolulu']]],
    ['No offset', [['UTC', 'UTC']]]
  ];

  /* --- state ------------------------------------------------------------- */
  var zones = [];            // [{ id, name, workFrom, workTo }]
  var anchorId = '';
  var year = 0, month = 0, dayOfMonth = 0;
  var durationMin = 60;
  var slotStart = 0;         // a real UTC instant, in milliseconds
  var use24 = true, showNow = true;
  var win = null;            // { start, end, span, hours }
  var models = {};           // zone id -> { segs, transitions }
  var overlap = [];          // merged intervals where every zone is working
  var zoneCount = 0;         // how many names this browser's database knows
  var zoneSource = '';
  var dragging = false, grabOffset = 0, movedWhileDown = false;

  var el = {};

  /* ======================================================================
     The offset, and everything derived from it
     ====================================================================== */

  var fmtCache = {};
  function fmt(tz) {
    if (!fmtCache[tz]) {
      fmtCache[tz] = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return fmtCache[tz];
  }

  /* The FORMATTER is cached, never the name it produces.

     Caching the name per zone per day looked like an obvious saving and was
     wrong on precisely the dates this tool is about: Europe/London is
     "British Summer Time" at 00:30 on 25 October and "Greenwich Mean Time" at
     02:30 the same morning, and a day-keyed cache would have pinned whichever
     one the first lookup happened to see. Building the formatter is the
     expensive part; asking an existing one about a different instant is not. */
  var nameFmt = {};
  function longName(tz, t) {
    try {
      if (!nameFmt[tz]) {
        nameFmt[tz] = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, timeZoneName: 'long', hour: 'numeric'
        });
      }
      var parts = nameFmt[tz].formatToParts(new Date(t));
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName') return parts[i].value;
      }
    } catch (err) { return ''; }
    return '';
  }

  /* Render a known instant in the zone, read the wall clock back, and take
     the difference. Date.UTC treats the rendered fields as if they were UTC,
     so (rendered - instant) is exactly the offset. hourCycle h23 is asked for
     because some engines render midnight as 24 in h24, which would push the
     answer a day out; the modulo is a second belt on that. */
  var offCache = {};
  function offsetAt(tz, t) {
    var key = tz + '|' + t;
    if (offCache[key] !== undefined) return offCache[key];
    var parts = fmt(tz).formatToParts(new Date(t));
    var f = {};
    for (var i = 0; i < parts.length; i++) f[parts[i].type] = parts[i].value;
    var asIfUtc = Date.UTC(
      parseInt(f.year, 10), parseInt(f.month, 10) - 1, parseInt(f.day, 10),
      parseInt(f.hour, 10) % 24, parseInt(f.minute, 10), parseInt(f.second, 10));
    var mins = Math.round((asIfUtc - t) / MINUTE);
    offCache[key] = mins;
    return mins;
  }

  /* Walk the range an hour at a time; where the offset changes between two
     samples, bisect down to the second. An hourly stride is safe because no
     zone has ever moved its clocks twice within an hour, and bisecting costs
     about twenty-two extra readings for a range of one day. */
  function findTransitions(tz, from, to) {
    var list = [], prevT = from, prevOff = offsetAt(tz, from), t = from;
    while (t < to) {
      t += HOUR;
      if (t > to) t = to;
      var off = offsetAt(tz, t);
      if (off !== prevOff) {
        var lo = prevT, hi = t;
        while (hi - lo > 1000) {
          var mid = lo + Math.floor((hi - lo) / 2);
          if (offsetAt(tz, mid) === prevOff) lo = mid; else hi = mid;
        }
        list.push({ at: hi, before: prevOff, after: offsetAt(tz, hi) });
        prevOff = off;
      }
      prevT = t;
    }
    return list;
  }

  /* Turn a wall-clock reading in a zone back into a UTC instant.

     Two passes, because the offset needed to do the conversion is itself a
     function of the instant being solved for. Guess with the offset at the
     naive instant, correct with the offset at the guessed one, and if the two
     disagree the requested wall time is inside a daylight-saving gap or fold.
     Both are answered with the instant that exists: a gap returns the moment
     the clocks jumped, which is the first instant of the requested day. */
  function wallToUtc(tz, y, mo, d, h, mi) {
    var naive = Date.UTC(y, mo, d, h, mi, 0);
    var first = offsetAt(tz, naive - offsetAt(tz, naive) * MINUTE);
    var t = naive - first * MINUTE;
    var second = offsetAt(tz, t);
    if (second !== first) t = naive - second * MINUTE;
    return t;
  }

  /* Local fields of an instant, given an offset. Reading UTC getters on a
     shifted Date is the whole conversion — no second Intl call needed, which
     is what makes dragging the slot cheap. */
  function wall(t, off) {
    var d = new Date(t + off * MINUTE);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(),
      dow: d.getUTCDay(), dayNo: Math.floor((t + off * MINUTE) / DAY)
    };
  }

  function offsetOf(model, t) {
    var s = model.segs;
    for (var i = 0; i < s.length; i++) {
      if (t >= s[i].from && t < s[i].to) return s[i].off;
    }
    return t < s[0].from ? s[0].off : s[s.length - 1].off;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function offsetLabel(mins) {
    var sign = mins < 0 ? '-' : '+', a = Math.abs(mins);
    return 'UTC' + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
  }

  function clock(w) {
    if (use24) return pad2(w.h) + ':' + pad2(w.mi);
    var h = w.h % 12; if (!h) h = 12;
    return h + ':' + pad2(w.mi) + (w.h < 12 ? ' am' : ' pm');
  }

  // Seconds matter in exactly one place: showing that a local clock jumps
  // from 00:59:59 to 02:00:00 rather than merely "skipping an hour".
  function hms(w) { return pad2(w.h) + ':' + pad2(w.mi) + ':' + pad2(w.s); }

  /* The closing edge of a band is a different problem from its opening one.
     A whole day printed its end as "00:00", so "00:00 to 00:00" was shown for
     a window the same paragraph called 24 hours long, and a night shift ended
     at "06:00" with no hint it was the following morning. The end of a range
     is written as 24:00 when it lands exactly on midnight, and carries the
     day it belongs to whenever that is not the day the range started. */
  function endClock(w, startW) {
    if (w.h === 0 && w.mi === 0) return use24 ? '24:00' : 'midnight';
    return clock(w) + (w.dayNo > startW.dayNo ? ' the next day' : '');
  }

  function minutesLabel(m) {
    var h = Math.floor(m / 60), mi = m % 60;
    if (!h) return mi + ' minutes';
    var s = h + (h === 1 ? ' hour' : ' hours');
    return mi ? s + ' ' + mi + ' minutes' : s;
  }

  function longDate(w) { return DOW[w.dow] + ' ' + w.d + ' ' + MON[w.mo] + ' ' + w.y; }
  function shortDate(w) { return DOW3[w.dow] + ' ' + w.d + ' ' + MON3[w.mo]; }

  function cityOf(id) {
    var bits = id.split('/');
    return bits[bits.length - 1].replace(/_/g, ' ');
  }

  /* ======================================================================
     Bands: the stretches of a window that satisfy a local-time rule
     ====================================================================== */

  function merge(list) {
    if (!list.length) return [];
    list.sort(function (a, b) { return a.from - b.from; });
    var res = [list[0]];
    for (var i = 1; i < list.length; i++) {
      var last = res[res.length - 1];
      if (list[i].from <= last.to) { if (list[i].to > last.to) last.to = list[i].to; }
      else res.push(list[i]);
    }
    return res;
  }

  function intersect(a, b) {
    var res = [], i = 0, j = 0;
    while (i < a.length && j < b.length) {
      var from = Math.max(a[i].from, b[j].from);
      var to = Math.min(a[i].to, b[j].to);
      if (to > from) res.push({ from: from, to: to });
      if (a[i].to < b[j].to) i++; else j++;
    }
    return res;
  }

  /* Local-time windows converted back to instants, one constant-offset
     segment at a time. Working inside a segment is what keeps this exact
     across a transition: within a segment the map from wall time to instant
     is a plain subtraction, and the segment boundaries are the transitions
     themselves. fromMin >= toMin means the window wraps midnight, which a
     night shift genuinely does. */
  function bandsFor(model, fromMin, toMin) {
    if (fromMin === toMin) return [];
    var res = [];
    for (var s = 0; s < model.segs.length; s++) {
      var seg = model.segs[s], offMs = seg.off * MINUTE;
      var localFrom = seg.from + offMs, localTo = seg.to + offMs;
      var d0 = Math.floor(localFrom / DAY) - 1, d1 = Math.floor(localTo / DAY) + 1;
      for (var d = d0; d <= d1; d++) {
        var ws = d * DAY + fromMin * MINUTE;
        var we = d * DAY + toMin * MINUTE;
        if (toMin < fromMin) we += DAY;
        var a = Math.max(ws, localFrom), b = Math.min(we, localTo);
        if (b > a) res.push({ from: a - offMs, to: b - offMs });
      }
    }
    return merge(res);
  }

  function inBands(bands, from, to) {
    // 'all' means the whole range sits inside one band; 'some' means it clips.
    var covered = 0;
    for (var i = 0; i < bands.length; i++) {
      var a = Math.max(bands[i].from, from), b = Math.min(bands[i].to, to);
      if (b > a) covered += b - a;
    }
    if (covered <= 0) return 'none';
    return covered >= (to - from) - 1 ? 'all' : 'some';
  }

  /* ======================================================================
     Building the window and the per-zone models
     ====================================================================== */

  function buildWindow() {
    var start = wallToUtc(anchorId, year, month, dayOfMonth, 0, 0);
    var end = wallToUtc(anchorId, year, month, dayOfMonth + 1, 0, 0);
    return { start: start, end: end, span: end - start, hours: (end - start) / HOUR };
  }

  /* A zone's model over one window: the constant-offset segments, and the
     transitions that separate them.

     The search is widened by ninety minutes at each end and the results are
     tagged with where they fell. That margin is not decoration. Chile moves
     its clocks at local midnight, so on a transition date the jump happens
     exactly at the window's own first instant, and a search that started
     there would measure the offset after the jump and report no change at all
     on a day that is provably twenty-three hours long. Ninety minutes is wide
     enough to catch a boundary transition and far too narrow to pick up an
     unrelated one from another day. */
  function buildModel(id, w) {
    var margin = 90 * MINUTE;
    var found = findTransitions(id, w.start - margin, w.end + margin);
    var inside = [], edge = [];
    for (var i = 0; i < found.length; i++) {
      if (found[i].at > w.start && found[i].at < w.end) inside.push(found[i]);
      else edge.push(found[i]);
    }
    var segs = [], cur = w.start, off = offsetAt(id, w.start);
    for (var j = 0; j < inside.length; j++) {
      segs.push({ from: cur, to: inside[j].at, off: inside[j].before });
      cur = inside[j].at;
      off = inside[j].after;
    }
    segs.push({ from: cur, to: w.end, off: off });
    return { id: id, segs: segs, inside: inside, edge: edge };
  }

  function zoneById(id) {
    for (var i = 0; i < zones.length; i++) if (zones[i].id === id) return zones[i];
    return null;
  }

  /* Everything the grid and the readout need, for one calendar date. Split
     out so the notes can build the same thing for the day before and the day
     after and compare, which is how the page can say whether the shared
     window MOVES on the transition date rather than just asserting that it
     might. */
  function computeDay(y, mo, d) {
    var w = {
      start: wallToUtc(anchorId, y, mo, d, 0, 0),
      end: wallToUtc(anchorId, y, mo, d + 1, 0, 0)
    };
    w.span = w.end - w.start;
    w.hours = w.span / HOUR;
    var m = {}, over = null;
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      m[z.id] = buildModel(z.id, w);
      m[z.id].work = bandsFor(m[z.id], z.workFrom, z.workTo);
      m[z.id].night = bandsFor(m[z.id], NIGHT_FROM, NIGHT_TO);
      over = over === null ? m[z.id].work.slice() : intersect(over, m[z.id].work);
    }
    return { win: w, models: m, overlap: over || [] };
  }

  /* ======================================================================
     Drawing
     ====================================================================== */

  function pct(t) { return ((t - win.start) / win.span) * 100; }

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function band(cls, from, to) {
    var n = mk('div', cls);
    var a = Math.max(from, win.start), b = Math.min(to, win.end);
    n.style.left = pct(a).toFixed(4) + '%';
    n.style.width = ((b - a) / win.span * 100).toFixed(4) + '%';
    return n;
  }

  function workSelect(z, which) {
    var sel = mk('select', 'lab-select tz-workpick');
    sel.setAttribute('aria-label',
      (which === 'from' ? 'Working hours start in ' : 'Working hours end in ') + z.id);
    var lo = which === 'from' ? 0 : 30;
    var hi = which === 'from' ? 23 * 60 + 30 : 24 * 60;
    for (var m = lo; m <= hi; m += 30) {
      var o = mk('option', '', pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60) +
        (m === 1440 ? ' (midnight)' : ''));
      o.value = String(m);
      sel.appendChild(o);
    }
    sel.value = String(which === 'from' ? z.workFrom : z.workTo);
    sel.addEventListener('change', function () {
      var v = parseInt(sel.value, 10);
      if (which === 'from') z.workFrom = v; else z.workTo = v;
      render();
    });
    return sel;
  }

  function miniButton(text, label, onClick) {
    var b = mk('button', 'tz-mini', text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function drawRows() {
    var host = el.rows;
    host.textContent = '';
    if (!zones.length) {
      host.appendChild(mk('p', 'tz-empty',
        'No zones on the grid yet. Add one above and the day will be drawn.'));
      return;
    }

    zones.forEach(function (z, index) {
      var model = models[z.id];
      var row = mk('div', 'tz-row' + (z.id === anchorId ? ' is-anchor' : ''));
      var head = mk('div', 'tz-rowhead');

      var top = mk('div', 'tz-rowtop');
      top.appendChild(mk('p', 'tz-zname', z.name));
      var offNow = offsetOf(model, win.start);
      var offEnd = offsetOf(model, win.end - 1);
      var metaText = offsetLabel(offNow);
      if (offEnd !== offNow) metaText += ' then ' + offsetLabel(offEnd);
      if (z.id === anchorId) metaText += ' · anchor';
      top.appendChild(mk('p', 'tz-zmeta', metaText));
      head.appendChild(top);
      head.appendChild(mk('p', 'tz-zid', z.id));

      var work = mk('div', 'tz-work');
      var l1 = mk('label', 'tz-worklbl'); l1.appendChild(document.createTextNode('works'));
      l1.appendChild(workSelect(z, 'from')); work.appendChild(l1);
      var l2 = mk('label', 'tz-worklbl'); l2.appendChild(document.createTextNode('to'));
      l2.appendChild(workSelect(z, 'to')); work.appendChild(l2);
      head.appendChild(work);

      var acts = mk('div', 'tz-rowacts');
      var anchorBtn = miniButton('anchor', 'Use ' + z.id + ' as the anchor zone', function () {
        anchorId = z.id; syncAnchorSelect(); render();
      });
      anchorBtn.setAttribute('aria-pressed', z.id === anchorId ? 'true' : 'false');
      anchorBtn.disabled = z.id === anchorId;
      acts.appendChild(anchorBtn);
      var up = miniButton('↑', 'Move ' + z.id + ' up', function () {
        var t = zones[index - 1]; zones[index - 1] = zones[index]; zones[index] = t; render();
      });
      up.disabled = index === 0;
      acts.appendChild(up);
      var del = miniButton('remove', 'Remove ' + z.id + ' from the grid', function () {
        removeZone(z.id);
      });
      del.className = 'tz-mini tz-mini-del';   // the stylesheet's red hover keys off this
      acts.appendChild(del);
      head.appendChild(acts);

      row.appendChild(head);

      var track = mk('div', 'tz-track');
      model.night.forEach(function (b) { track.appendChild(band('tz-band tz-band-night', b.from, b.to)); });
      model.work.forEach(function (b) { track.appendChild(band('tz-band tz-band-work', b.from, b.to)); });

      /* Ticks are hour boundaries in THIS zone's local time, found inside each
         constant-offset segment. That is why a +05:30 row's marks sit half an
         hour off its neighbours' rather than being snapped into line. */
      model.segs.forEach(function (seg) {
        var offMs = seg.off * MINUTE;
        var firstLocal = Math.ceil((seg.from + offMs) / HOUR) * HOUR;
        for (var lt = firstLocal; lt - offMs < seg.to; lt += HOUR) {
          var t = lt - offMs;
          if (t < win.start || t >= win.end) continue;
          var w = wall(t, seg.off);
          var midnight = w.h === 0 && w.mi === 0;
          var tick = mk('div', 'tz-tick' + (midnight ? ' tz-tick-mid' : ''));
          tick.style.left = pct(t).toFixed(4) + '%';
          tick.appendChild(mk('span', 'tz-ticklbl' + (midnight ? ' tz-ticklbl-mid' : ''),
            midnight ? '00 ' + DOW3[w.dow] : pad2(w.h)));
          track.appendChild(tick);
        }
      });

      row.appendChild(track);
      host.appendChild(row);
    });
  }

  function drawOverlay() {
    var host = el.bands;
    host.textContent = '';
    if (!zones.length) { el.slot.hidden = true; return; }
    el.slot.hidden = false;

    overlap.forEach(function (b) {
      host.appendChild(band('tz-overlapband', b.from, b.to));
    });

    if (showNow) {
      var now = Date.now();
      if (now >= win.start && now < win.end) {
        var line = mk('div', 'tz-nowline');
        line.style.left = pct(now).toFixed(4) + '%';
        host.appendChild(line);
      }
    }
  }

  /* ======================================================================
     The slot
     ====================================================================== */

  function clampSlot() {
    var latest = win.end - durationMin * MINUTE;
    if (latest < win.start) latest = win.start;
    if (slotStart < win.start) slotStart = win.start;
    if (slotStart > latest) slotStart = latest;
  }

  function snap(t) {
    // Fifteen minutes, because that is the finest offset any zone uses. A
    // coarser snap would make the +05:45 and +12:45 rows unhittable, which
    // would quietly undo the point of drawing them to scale.
    return win.start + Math.round((t - win.start) / (15 * MINUTE)) * 15 * MINUTE;
  }

  function slotVerdict(model, from, to) {
    var work = inBands(model.work, from, to);
    if (work === 'all') return { cls: 'tz-chip-ok', text: 'Inside working hours' };
    if (work === 'some') return { cls: 'tz-chip-warn', text: 'Only partly inside working hours' };
    if (inBands(model.night, from, to) !== 'none') {
      return { cls: 'tz-chip-bad', text: 'The middle of the night here' };
    }
    return { cls: 'tz-chip-warn', text: 'Awake, but outside the working hours set here' };
  }

  function slotFacts() {
    var from = slotStart, to = slotStart + durationMin * MINUTE;
    var anchorModel = models[anchorId];
    var anchorDay = anchorModel ? wall(from, offsetOf(anchorModel, from)).dayNo : 0;
    return zones.map(function (z) {
      var model = models[z.id];
      var offA = offsetOf(model, from), offB = offsetOf(model, Math.max(from, to - 1));
      var a = wall(from, offA), b = wall(to, offB);
      return {
        zone: z, model: model, from: from, to: to,
        offFrom: offA, offTo: offB, a: a, b: b,
        dayDelta: a.dayNo - anchorDay,
        verdict: slotVerdict(model, from, to),
        changes: model.inside.filter(function (tr) { return tr.at > from && tr.at < to; })
      };
    });
  }

  /* "3pm Tuesday for you is 5:30am Wednesday for them" is the single most
     common scheduling mistake, so the day offset is never left implicit in a
     date the reader has to compare for themselves. It gets a chip of its own,
     next to the time, and a sentence underneath. */
  function dayChip(n) {
    return (n > 0 ? '+' : '−') + Math.abs(n) + (Math.abs(n) === 1 ? ' day' : ' days');
  }

  function dayPhrase(n) {
    var d = Math.abs(n);
    return d + (d === 1 ? ' calendar day ' : ' calendar days ') +
      (n > 0 ? 'ahead of ' : 'behind ');
  }

  function updateSlot() {
    if (!zones.length || !win) return;
    clampSlot();
    var from = slotStart, to = slotStart + durationMin * MINUTE;
    el.slot.style.left = pct(from).toFixed(4) + '%';
    el.slot.style.width = (durationMin * MINUTE / win.span * 100).toFixed(4) + '%';

    var facts = slotFacts();
    var spoken = facts.map(function (f) {
      var s = clock(f.a) + ' ' + shortDate(f.a) + ' in ' + f.zone.name;
      if (f.dayDelta) s += ', ' + dayPhrase(f.dayDelta) + cityOf(anchorId);
      return s;
    }).join('. ');

    el.slot.setAttribute('aria-valuemin', '0');
    el.slot.setAttribute('aria-valuemax', String(Math.round((win.span - durationMin * MINUTE) / MINUTE)));
    el.slot.setAttribute('aria-valuenow', String(Math.round((from - win.start) / MINUTE)));
    el.slot.setAttribute('aria-valuetext',
      minutesLabel(durationMin) + ' starting ' + spoken + '.');

    drawReadout(facts);
    drawSummary(facts);
  }

  function drawReadout(facts) {
    var head = el.readhead;
    head.textContent = '';
    var anchorModel = models[anchorId];
    var aw = wall(slotStart, offsetOf(anchorModel, slotStart));
    head.appendChild(document.createTextNode(
      'Proposed: ' + minutesLabel(durationMin) + ' from ' + clock(aw) + ' on ' +
      longDate(aw) + ' in ' + cityOf(anchorId) + '. Drag the amber bar, or focus it ' +
      'and use the arrow keys.'));

    var bad = 0, partial = 0;
    facts.forEach(function (f) {
      if (f.verdict.cls === 'tz-chip-bad') bad++;
      else if (f.verdict.cls === 'tz-chip-warn') partial++;
    });
    var verdictLine = mk('span', 'tz-read-warn');
    if (!overlap.length) {
      verdictLine.textContent = ' There is no hour on this date that is inside working ' +
        'hours in all ' + zones.length + ' zones, so no shared window is drawn.';
      head.appendChild(verdictLine);
    } else if (bad || partial) {
      verdictLine.textContent = ' This slot is outside somebody’s working hours. The ' +
        'green column is where every zone on the grid is working.';
      head.appendChild(verdictLine);
    }

    var list = el.readlist;
    list.textContent = '';
    facts.forEach(function (f) {
      var li = mk('li', 'tz-read');
      li.appendChild(mk('p', 'tz-read-name', f.zone.name));

      var timeLine = mk('p', 'tz-read-time', clock(f.a) + ' – ' + endClock(f.b, f.a) + ' ');
      if (f.dayDelta) timeLine.appendChild(mk('span', 'tz-chip tz-chip-day', dayChip(f.dayDelta)));
      li.appendChild(timeLine);

      li.appendChild(mk('p', 'tz-read-date', longDate(f.a) +
        (f.dayDelta ? ' — ' + dayPhrase(f.dayDelta) + cityOf(anchorId) : '')));

      var zoneName = longName(f.zone.id, f.from);
      li.appendChild(mk('p', 'tz-read-zone',
        (zoneName ? zoneName + ' · ' : '') + offsetLabel(f.offFrom) + ' · ' + f.zone.id));

      var chipLine = mk('p', '');
      chipLine.appendChild(mk('span', 'tz-chip ' + f.verdict.cls, f.verdict.text));
      li.appendChild(chipLine);

      if (f.changes.length) {
        li.appendChild(mk('p', 'tz-read-warn',
          'The clocks change during this slot here — ' +
          offsetLabel(f.changes[0].before) + ' becomes ' + offsetLabel(f.changes[0].after) +
          '. The meeting is still ' + minutesLabel(durationMin) + ' long in real time, but ' +
          'the local clock will not agree.'));
      } else if (f.model.inside.length) {
        li.appendChild(mk('p', 'tz-read-warn',
          'The clocks change here on this date, though not during this slot. The ' +
          'skipped or repeated hour is spelled out in the notes.'));
      }
      list.appendChild(li);
    });
  }

  function drawSummary(facts) {
    var anchorModel = models[anchorId];
    var aw = wall(slotStart, offsetOf(anchorModel, slotStart));
    var line1 = 'Proposed: ' + longDate(aw) + ', ' + minutesLabel(durationMin) + '.';
    var line2 = facts.map(function (f) {
      var s = cityOf(f.zone.id) + ' ' + clock(f.a) + '–' + endClock(f.b, f.a) +
        ' (' + offsetLabel(f.offFrom) + ')';
      if (f.dayDelta) s += ' ' + dayChip(f.dayDelta);
      return s;
    }).join(' · ');
    el.summary.value = line1 + '\n' + line2;
  }

  /* ======================================================================
     The notes pane
     ====================================================================== */

  function firstOverlapLabel(day) {
    if (!day.overlap.length) return null;
    var m = day.models[anchorId];
    var w = wall(day.overlap[0].from, offsetOf(m, day.overlap[0].from));
    return clock(w);
  }

  function renderNotes() {
    out.clear();

    if (!zones.length) {
      out.warn('No zones on the grid.');
      out.dim('Add one from the picker above, or type an IANA name such as');
      out.dim('Asia/Kolkata. Nothing is looked up; the names come from the');
      out.dim('database already inside your browser.');
      return;
    }

    var anchorWall = wall(win.start, offsetOf(models[anchorId], win.start));
    out.heading('The window');
    out.row('date', longDate(anchorWall));
    out.row('anchor zone', anchorId + '  (' + (longName(anchorId, win.start) || 'no name given') + ')');
    out.row('zones drawn', String(zones.length));
    out.row('zone names known', zoneCount ? zoneCount + '  (' + zoneSource + ')' : 'unknown');
    if (Math.abs(win.hours - 24) < 0.001) {
      out.row('length of this day', '24 hours');
    } else {
      out.row('length of this day', win.hours + ' hours');
      out.warn('This day is not 24 hours long in ' + anchorId + '. The grid is drawn');
      out.warn('to the real length, so the bars are not the width they would be');
      out.warn('on an ordinary day.');
    }

    out.rule();
    out.heading('Clock changes');
    var any = false;
    zones.forEach(function (z) {
      var m = models[z.id];
      var all = m.inside.concat(m.edge);
      if (!all.length) return;
      any = true;
      all.forEach(function (tr) {
        var before = wall(tr.at, tr.before), after = wall(tr.at, tr.after);
        var where = (tr.at > win.start && tr.at < win.end)
          ? 'inside this window' : 'at the very edge of this window';
        out.line('');
        out.warn(z.id + ' — clocks change ' + where);
        // Labelled "offset" and not "at": the row carries the two offsets, and
        // "at UTC+00:00 becomes UTC+01:00" reads as though the first one were
        // the time the change happened. The times are the two rows below.
        out.row('  offset', offsetLabel(tr.before) + ' becomes ' + offsetLabel(tr.after));
        /* Both answers fall straight out of reading the same instant with the
           two offsets. Forward, the gap between the readings is the stretch of
           local time that never happens; backward, it is the stretch that
           happens twice. No table of rules is consulted for either. */
        var edge = wall(tr.at - 1000, tr.before);
        if (tr.after > tr.before) {
          out.row('  skipped locally', clock(before) + ' to ' + clock(after) + ' on ' +
            shortDate(before) + '  (' + minutesLabel(tr.after - tr.before) + ')');
          out.err('  ' + clock(before) + ' does not exist on this date in ' + z.id + '.');
          out.err('  The local clock goes from ' + hms(edge) + ' straight to ' +
            hms(after) + '.');
        } else {
          out.row('  repeated locally', clock(after) + ' to ' + clock(before) + ' on ' +
            shortDate(after) + '  (' + minutesLabel(tr.before - tr.after) + ')');
          out.err('  ' + clock(after) + ' happens twice on this date in ' + z.id + '.');
          out.err('  The local clock goes from ' + hms(edge) + ' back to ' + hms(after) + '.');
          out.err('  A time named by local clock alone is ambiguous for that stretch.');
        }
      });
    });
    if (!any) {
      out.ok('No zone on this grid changes its clocks on this date.');
      out.dim('That is a fact about this date only. Pick a date in late March or');
      out.dim('late October and most northern-hemisphere zones will move.');
    }

    out.rule();
    out.heading('The shared window');
    if (!overlap.length) {
      out.err('There is no time on this date when every zone on the grid is');
      out.err('inside the working hours set for it.');
      out.line('');
      out.dim('That is a real answer, not a rendering failure. Widen somebody’s');
      out.dim('hours, drop a zone, or accept that one person takes the call');
      out.dim('outside their day.');
      var worst = hardestPair();
      if (worst) {
        out.line('');
        out.row('no overlap between', worst.a + ' and ' + worst.b);
      }
      var empty = zones.filter(function (z) { return z.workFrom === z.workTo; });
      if (empty.length) {
        out.line('');
        empty.forEach(function (z) {
          out.warn(z.id + ' has its start and end set to the same time, so it has');
          out.warn('no working hours at all and nothing can overlap with it.');
        });
      }
      var best = bestPartial();
      if (best) {
        var bm = models[anchorId];
        var bs = wall(best.from, offsetOf(bm, best.from));
        out.line('');
        out.row('closest it gets', clock(bs) + ' to ' +
          endClock(wall(best.to, offsetOf(bm, Math.max(best.from, best.to - 1))), bs) +
          '  in ' + cityOf(anchorId));
        out.row('working then', best.count + ' of ' + zones.length + ' — ' + best.inside.join(', '));
        out.row('outside their hours', best.outside.join(', '));
        out.dim('That is the least bad stretch on this grid, not a recommendation.');
        out.dim('Somebody named on that last line is being asked to work outside');
        out.dim('the hours you set for them. Ask them, do not assume.');
      }
    } else {
      var m = models[anchorId];
      var total = 0;
      overlap.forEach(function (b) {
        var from = wall(b.from, offsetOf(m, b.from));
        var to = wall(b.to, offsetOf(m, Math.max(b.from, b.to - 1)));
        total += b.to - b.from;
        out.row('shared', clock(from) + ' to ' + endClock(to, from) + '  in ' + cityOf(anchorId));
      });
      out.row('total', minutesLabel(Math.round(total / MINUTE)));
    }

    /* Whether the shared window MOVES is checked by computing it, not by
       asserting that it might. The day before and the day after are built the
       same way and the opening time is compared in the anchor's local clock.
       On a transition date the two disagree, which is the single thing most
       likely to make a recurring call land an hour wrong. */
    var before = computeDay(year, month, dayOfMonth - 1);
    var after = computeDay(year, month, dayOfMonth + 1);
    var lToday = firstOverlapLabel({ models: models, overlap: overlap });
    var lBefore = firstOverlapLabel(before), lAfter = firstOverlapLabel(after);
    out.line('');
    if (!lToday && !lBefore && !lAfter) {
      out.dim('There is no shared window on the day before or the day after either,');
      out.dim('so this is not a one-day accident of the calendar.');
    } else if (!lToday) {
      out.warn('There is a shared window on ' + (lBefore ? 'the day before' : 'the day after') +
        ' but not on this date.');
    } else {
      var moved = false;
      if (lBefore && lBefore !== lToday) {
        moved = true;
        out.warn('The shared window opened at ' + lBefore + ' the day before, and opens');
        out.warn('at ' + lToday + ' on this date. It moved.');
      }
      if (lAfter && lAfter !== lToday) {
        moved = true;
        out.warn('It opens at ' + lAfter + ' the day after. A weekly call pinned to a');
        out.warn('local clock will be wrong for somebody once that happens.');
      }
      if (!moved) {
        out.dim('The shared window opens at the same local time the day before and');
        out.dim('the day after, so nothing shifts around this date.');
      }
    }

    out.rule();
    out.heading('What this does not do');
    out.dim('No calendar integration. It does not read or write any calendar.');
    out.dim('No free/busy. It has no idea whether anyone is actually available.');
    out.dim('No attendee lookup. It does not know who works where.');
    out.dim('No holidays, no Friday half-days, no lunch, no school run.');
    out.dim('Working hours are what you typed, which is a guess about people.');
    out.dim('Zone rules come from the IANA database inside this browser. A device');
    out.dim('with stale system data draws stale transitions, and governments');
    out.dim('change these rules with weeks of notice. Check anything that matters');
    out.dim('against the other person before you send the invite.');
    out.dim('Nothing here is advice, and nothing here is sent anywhere.');
  }

  /* Which two zones actually cannot meet. Reported only when the full
     intersection is empty, because "no overlap" without a culprit is the
     least useful true sentence a scheduler can say. */
  function hardestPair() {
    for (var i = 0; i < zones.length; i++) {
      for (var j = i + 1; j < zones.length; j++) {
        var a = models[zones[i].id].work, b = models[zones[j].id].work;
        if (!intersect(a, b).length) return { a: zones[i].id, b: zones[j].id };
      }
    }
    return null;
  }

  /* When nothing works for everybody, the next honest question is how close
     the day gets. A sweep over every working-hours edge counts how many zones
     are inside their own hours at each moment; the widest stretch with the
     highest count is the least bad time on the grid. It is still not a
     recommendation — somebody named here is being asked to work outside the
     hours they were given. */
  function bestPartial() {
    var events = [];
    for (var i = 0; i < zones.length; i++) {
      var bands = models[zones[i].id].work;
      for (var j = 0; j < bands.length; j++) {
        events.push({ t: bands[j].from, d: 1 });
        events.push({ t: bands[j].to, d: -1 });
      }
    }
    if (!events.length) return null;
    events.sort(function (a, b) { return a.t - b.t; });
    var count = 0, prev = events[0].t, best = null;
    for (var k = 0; k < events.length; k++) {
      var t = events[k].t;
      if (t > prev && count > 0) {
        var span = t - prev;
        if (!best || count > best.count ||
            (count === best.count && span > best.to - best.from)) {
          best = { from: prev, to: t, count: count };
        }
      }
      count += events[k].d;
      prev = t;
    }
    if (!best) return null;
    var mid = best.from + (best.to - best.from) / 2;
    best.inside = []; best.outside = [];
    zones.forEach(function (z) {
      var where = inBands(models[z.id].work, mid, mid + 1) === 'none' ? 'outside' : 'inside';
      best[where].push(cityOf(z.id));
    });
    return best;
  }

  /* ======================================================================
     The .ics file
     ====================================================================== */

  /* Newlines are kept here even though they are not printable ASCII. The
     first version of this stripped them, and because icsEsc calls ascii()
     before turning newlines into the literal backslash-n that ICS wants, the
     line breaks between the per-zone times in DESCRIPTION were deleted
     rather than escaped: the .ics opened with every zone run into the one
     before it. */
  function ascii(s) {
    return String(s)
      .replace(/[‒-―−]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/·/g, ';')
      .replace(/[^\x20-\x7e\n]/g, '');
  }

  function icsEsc(s) {
    return ascii(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  /* RFC 5545 folds at 75 octets. Everything written into this file has been
     through ascii() first, so one character is one octet and folding by
     character length is exact rather than approximately right. */
  function fold(line) {
    if (line.length <= 74) return line;
    var head = line.slice(0, 74), rest = line.slice(74), res = head;
    while (rest.length > 73) { res += '\r\n ' + rest.slice(0, 73); rest = rest.slice(73); }
    return res + '\r\n ' + rest;
  }

  function icsStamp(t) {
    var d = new Date(t);
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  /* Two hex digits per byte, and deliberately NOT through pad2().

     It went through pad2 first, and pad2 takes a number while toString(16)
     returns a string: 'a' < 10 compares against NaN, which is false, so every
     byte from 0x0a to 0x0f came out one digit short. A real file written by
     the button carried UID:9e97c1e0312847d — fifteen hex digits, not sixteen.
     Nothing broke, because a short UID is still a valid UID and no calendar
     ever complained, which is exactly why it survived to be found by reading
     the output rather than by anything failing. */
  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16); }

  function uid() {
    var n = '';
    try {
      var buf = new Uint8Array(8);
      window.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length; i++) n += hex2(buf[i]);
    } catch (err) {
      n = String(Date.now()) + '-' + String(Math.floor(Math.random() * 1e9));
    }
    return n + '@krunalkumar.dpdns.org';
  }

  function toBytes(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    var arr = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) arr[i] = text.charCodeAt(i) & 0x7f;
    return arr;
  }

  function exportIcs() {
    if (!zones.length) { out.clear().warn('Add at least one zone first.'); return; }
    var facts = slotFacts();
    var desc = facts.map(function (f) {
      var s = f.zone.id + ': ' + clock(f.a) + '-' + clock(f.b) + ' ' + offsetLabel(f.offFrom);
      if (f.dayDelta) s += ' (' + dayPhrase(f.dayDelta) + cityOf(anchorId) + ')';
      return s;
    }).join('\n');

    /* DTSTART carries a Z, so the event is pinned to a UTC instant and every
       calendar that reads it renders the attendee's own correct local time.
       Writing a floating local time here instead is the classic way an invite
       arrives an hour out. */
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//krunalkumar.dpdns.org//Timezone meeting planner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + uid(),
      'DTSTAMP:' + icsStamp(Date.now()),
      'DTSTART:' + icsStamp(slotStart),
      'DTEND:' + icsStamp(slotStart + durationMin * MINUTE),
      'SUMMARY:' + icsEsc('Proposed meeting (' + zones.length + ' time zones)'),
      'DESCRIPTION:' + icsEsc(desc + '\n\nDrafted with the timezone meeting planner at ' +
        'krunalkumar.dpdns.org/labs/timezones. No invitations were sent and no ' +
        'availability was checked.'),
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    var text = lines.map(fold).join('\r\n') + '\r\n';
    LabTool.download(toBytes(text), 'proposed-meeting.ics', 'text/calendar');
    out.rule();
    out.ok('Saved proposed-meeting.ics with DTSTART ' + icsStamp(slotStart) + '.');
    out.dim('That is a UTC instant, so any calendar will render it in the correct');
    out.dim('local time for whoever opens it. Nothing was sent and no attendee');
    out.dim('was added — the file is a draft on your machine.');
  }

  /* ======================================================================
     Zone management
     ====================================================================== */

  function canonical(name) {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: name })
        .resolvedOptions().timeZone;
    } catch (err) { return null; }
  }

  function addZone(raw, quiet) {
    var name = String(raw || '').trim();
    if (!name) { addError('Type or pick a zone name first.'); return false; }
    if (zones.length >= MAX_ZONES) {
      addError('The grid stops at ' + MAX_ZONES + ' zones so the rows stay readable. ' +
        'Remove one first.');
      return false;
    }
    /* Intl collapses the two spellings of a linked zone to one identifier as
       it resolves, and that resolved form is what gets stored — otherwise the
       same city could sit on the grid twice under two names and the shared
       window would be computed against itself.

       WHICH spelling survives is the browser's business and not this file's,
       and it is not the one you would guess. Chrome 148 resolves both
       Asia/Kolkata and Asia/Calcutta to Asia/Calcutta, so on an Indian
       machine the row is labelled with the old name the picker never offers.
       That looks like a bug and is not: it is the browser's own database
       answering, which is the whole arrangement here. Do not "fix" it by
       hard-coding a preferred spelling — that is the stale copy this file
       exists to avoid. */
    var id = canonical(name);
    if (!id) {
      addError('"' + name + '" is not a zone name this browser knows. IANA names ' +
        'look like Asia/Kolkata or America/New_York.');
      return false;
    }
    if (zoneById(id)) {
      addError(id + ' is already on the grid.');
      return false;
    }
    zones.push({ id: id, name: cityOf(id), workFrom: 9 * 60, workTo: 17 * 60 });
    if (!anchorId) anchorId = id;
    if (!quiet) addError('');
    return true;
  }

  function removeZone(id) {
    zones = zones.filter(function (z) { return z.id !== id; });
    if (anchorId === id) anchorId = zones.length ? zones[0].id : '';
    syncAnchorSelect();
    render();
  }

  function addError(msg) { el.adderr.textContent = msg || ''; }

  function syncAnchorSelect() {
    var sel = el.anchor;
    sel.textContent = '';
    zones.forEach(function (z) {
      var o = mk('option', '', z.id);
      o.value = z.id;
      sel.appendChild(o);
    });
    if (anchorId) sel.value = anchorId;
    sel.disabled = zones.length < 2;
  }

  /* ======================================================================
     Render
     ====================================================================== */

  function render() {
    // The offset cache is keyed by zone and instant, and a new render asks
    // about a different set of instants, so it is emptied rather than left to
    // grow for the life of the tab.
    offCache = {};
    if (!zones.length) {
      win = null;
      el.rows.textContent = '';
      el.rows.appendChild(mk('p', 'tz-empty',
        'No zones on the grid yet. Add one above and the day will be drawn.'));
      el.bands.textContent = '';
      el.slot.hidden = true;
      el.readhead.textContent = 'Add a zone to see a proposed time.';
      el.readlist.textContent = '';
      el.summary.value = '';
      renderNotes();
      return;
    }
    if (!anchorId || !zoneById(anchorId)) anchorId = zones[0].id;

    var day = computeDay(year, month, dayOfMonth);
    win = day.win; models = day.models; overlap = day.overlap;

    // A first slot is placed at the start of the shared window if there is
    // one, and at 10:00 in the anchor zone if there is not.
    if (!slotStart || slotStart < win.start || slotStart >= win.end) {
      slotStart = overlap.length ? overlap[0].from : win.start + 10 * HOUR;
    }
    clampSlot();

    drawRows();
    drawOverlay();
    updateSlot();
    renderNotes();
  }

  /* ======================================================================
     Wiring
     ====================================================================== */

  function todayIn(tz) {
    var parts = fmt(tz).formatToParts(new Date());
    var f = {};
    for (var i = 0; i < parts.length; i++) f[parts[i].type] = parts[i].value;
    return { y: parseInt(f.year, 10), mo: parseInt(f.month, 10) - 1, d: parseInt(f.day, 10) };
  }

  function readDate() {
    var v = el.date.value;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (!m) return false;
    year = parseInt(m[1], 10); month = parseInt(m[2], 10) - 1; dayOfMonth = parseInt(m[3], 10);
    return true;
  }

  function writeDate() {
    el.date.value = year + '-' + pad2(month + 1) + '-' + pad2(dayOfMonth);
  }

  function buildPicker() {
    var sel = el.pick;
    PICKS.forEach(function (group) {
      var g = document.createElement('optgroup');
      g.label = group[0];
      group[1].forEach(function (item) {
        var o = mk('option', '', item[0] + ' — ' + item[1]);
        o.value = item[1];
        g.appendChild(o);
      });
      sel.appendChild(g);
    });
  }

  /* Every zone name the browser is willing to format, fed into the type-ahead
     list. Intl.supportedValuesOf is the honest source: it is the browser's own
     database talking, not a copy of it baked in here that would go stale.
     Where it is missing, the curated list above is the fallback and the notes
     pane says which one is in use. */
  function buildDatalist() {
    var list = null;
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      try { list = Intl.supportedValuesOf('timeZone'); } catch (err) { list = null; }
    }
    if (list && list.length) {
      zoneSource = 'from Intl.supportedValuesOf';
    } else {
      list = [];
      PICKS.forEach(function (g) {
        g[1].forEach(function (item) { list.push(item[1]); });
      });
      zoneSource = 'built-in fallback list, this browser has no supportedValuesOf';
    }
    zoneCount = list.length;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < list.length; i++) {
      var o = document.createElement('option');
      o.value = list[i];
      frag.appendChild(o);
    }
    el.datalist.appendChild(frag);
  }

  function fractionAt(clientX) {
    var r = el.overlay.getBoundingClientRect();
    if (!r.width) return 0;
    var f = (clientX - r.left) / r.width;
    return f < 0 ? 0 : (f > 1 ? 1 : f);
  }

  function moveSlotTo(t) {
    slotStart = snap(t);
    clampSlot();
    updateSlot();
  }

  function wireDrag() {
    /* Only the amber bar takes a drag on touch. The CSS puts touch-action:
       none on the bar alone and deliberately leaves it off the overlay,
       because the grid is wider than a phone and has to stay horizontally
       scrollable with a finger. A tap on the overlay still repositions the
       slot, through the click handler below, so touch loses nothing. */
    el.slot.addEventListener('pointerdown', function (ev) {
      if (!win) return;
      dragging = true; movedWhileDown = false;
      grabOffset = fractionAt(ev.clientX) * win.span - (slotStart - win.start);
      try { el.slot.setPointerCapture(ev.pointerId); } catch (err) {}
      ev.preventDefault();
    });
    el.slot.addEventListener('pointermove', function (ev) {
      if (!dragging || !win) return;
      movedWhileDown = true;
      moveSlotTo(win.start + fractionAt(ev.clientX) * win.span - grabOffset);
      ev.preventDefault();
    });
    var end = function () {
      if (!dragging) return;
      dragging = false;
      if (movedWhileDown) renderNotes();
    };
    el.slot.addEventListener('pointerup', end);
    el.slot.addEventListener('pointercancel', end);

    el.overlay.addEventListener('click', function (ev) {
      if (!win || ev.target === el.slot) return;
      moveSlotTo(win.start + fractionAt(ev.clientX) * win.span - durationMin * MINUTE / 2);
      renderNotes();
      el.slot.focus();
    });

    el.slot.addEventListener('keydown', function (ev) {
      if (!win) return;
      var step = 0;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') step = -15;
      else if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') step = 15;
      else if (ev.key === 'PageDown') step = -60;
      else if (ev.key === 'PageUp') step = 60;
      else if (ev.key === 'Home') { moveSlotTo(win.start); renderNotes(); ev.preventDefault(); return; }
      else if (ev.key === 'End') { moveSlotTo(win.end); renderNotes(); ev.preventDefault(); return; }
      if (!step) return;
      moveSlotTo(slotStart + step * MINUTE);
      renderNotes();
      ev.preventDefault();
    });
  }

  LabTool.define({
    id: 'tzplanner',
    run: function () { render(); },
    onReady: function () {
      ['pick', 'type', 'add', 'mine', 'adderr', 'date', 'anchor', 'dur',
       'summary', 'ics', 'overlay', 'bands', 'slot', 'rows', 'readhead',
       'readlist', 'datalist'].forEach(function (k) {
        el[k] = document.getElementById('tz-' + k);
      });
      el.use24 = document.getElementById('tz-24');
      el.shownow = document.getElementById('tz-shownow');

      buildPicker();
      buildDatalist();
      wireDrag();

      /* The visitor's own zone goes on the grid first and becomes the anchor,
         because "what time is it for me" is the question underneath every
         other question this page answers. */
      var mine = 'UTC';
      try { mine = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
      catch (err) { mine = 'UTC'; }
      addZone(mine, true);
      ['Asia/Kolkata', 'Europe/London'].forEach(function (z) { addZone(z, true); });
      addError('');
      anchorId = zones.length ? zones[0].id : '';
      syncAnchorSelect();

      var t = todayIn(anchorId || 'UTC');
      year = t.y; month = t.mo; dayOfMonth = t.d;
      writeDate();

      el.add.addEventListener('click', function () {
        var typed = el.type.value.trim();
        if (addZone(typed || el.pick.value)) {
          el.type.value = '';
          syncAnchorSelect();
          render();
        }
      });
      el.type.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); el.add.click(); }
      });
      el.mine.addEventListener('click', function () {
        var own = 'UTC';
        try { own = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
        catch (err) { own = 'UTC'; }
        if (addZone(own)) { syncAnchorSelect(); render(); }
      });
      el.date.addEventListener('change', function () {
        if (readDate()) { slotStart = 0; render(); }
        else addError('That date could not be read. Use the picker.');
      });
      el.anchor.addEventListener('change', function () {
        anchorId = el.anchor.value; slotStart = 0; render();
      });
      el.dur.addEventListener('change', function () {
        durationMin = parseInt(el.dur.value, 10) || 60;
        render();
      });
      el.use24.addEventListener('change', function () {
        use24 = el.use24.checked; render();
      });
      el.shownow.addEventListener('change', function () {
        showNow = el.shownow.checked; render();
      });
      el.ics.addEventListener('click', exportIcs);

      render();
    }
  });
})();

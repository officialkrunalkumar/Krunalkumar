/* ==========================================================================
   timestamp.js — every epoch a forensic artefact might use.
   --------------------------------------------------------------------------
   Timeline work stalls on this constantly. A registry key gives you a Windows
   FILETIME, a browser history database gives you WebKit microseconds, a macOS
   plist gives you seconds since 2001, and a Unix log gives you seconds since
   1970. They are all "a number", and reading one with the wrong epoch puts an
   event in 1601 or 2185.

   So this takes a number and shows what it would be under every epoch at once,
   and flags which reading is plausible. That is almost always enough to tell
   you which system wrote it.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* Each epoch: offset from the Unix epoch in milliseconds, and the unit
     expressed as an exact fraction of a millisecond (mul / div).

     The fraction matters. A Windows FILETIME is around 1.3e17, which is well
     past Number.MAX_SAFE_INTEGER — 133447296000000000 cannot be represented
     exactly as a double, and neither can the value you would get back when
     converting a date into one. Doing the arithmetic in BigInt keeps every
     digit, which is the whole point in a tool whose output gets pasted into
     a timeline. Only the final millisecond figure, which is small, becomes a
     Number for Date to consume. */
  var EPOCHS = [
    { name: 'Unix seconds',      base: 0,              mul: 1000, div: 1,
      note: 'Linux, most APIs, JWT exp/iat' },
    { name: 'Unix milliseconds', base: 0,              mul: 1, div: 1,
      note: 'JavaScript Date.now(), Java' },
    { name: 'Unix microseconds', base: 0,              mul: 1, div: 1000,
      note: 'some databases and packet captures' },
    { name: 'Windows FILETIME',  base: -11644473600000, mul: 1, div: 10000,
      note: '100-nanosecond ticks since 1601 — NTFS, registry, event logs' },
    { name: 'WebKit / Chrome',   base: -11644473600000, mul: 1, div: 1000,
      note: 'microseconds since 1601 — Chrome History, Cookies, Login Data' },
    { name: 'Apple / Cocoa',     base: 978307200000,    mul: 1000, div: 1,
      note: 'seconds since 2001 — macOS and iOS plists, Safari' },
    { name: 'Apple Cocoa (ms)',  base: 978307200000,    mul: 1, div: 1,
      note: 'milliseconds since 2001' },
    { name: 'Mac HFS+',          base: -2082844800000,  mul: 1000, div: 1,
      note: 'seconds since 1904 — HFS+ volumes' },
    { name: 'Symbian / UUID v1', base: -12219292800000, mul: 1, div: 10000,
      note: '100-nanosecond ticks since 1582 — UUID timestamps' }
  ];

  var canBig = typeof BigInt === 'function';

  /* value may be a BigInt (exact, from an integer input) or a Number. */
  function convert(value, epoch) {
    if (canBig && typeof value === 'bigint') {
      var ms = BigInt(epoch.base) + (value * BigInt(epoch.mul)) / BigInt(epoch.div);
      // Outside this range Date is invalid anyway, and Number() would be lossy.
      if (ms > 8640000000000000n || ms < -8640000000000000n) return new Date(NaN);
      return new Date(Number(ms));
    }
    return new Date(epoch.base + Number(value) * epoch.mul / epoch.div);
  }

  /* The reverse direction: a date, expressed in one epoch's own units. */
  function toEpochUnits(date, epoch) {
    if (canBig) {
      var ms = BigInt(date.getTime()) - BigInt(epoch.base);
      return (ms * BigInt(epoch.div)) / BigInt(epoch.mul);
    }
    return Math.round((date.getTime() - epoch.base) * epoch.div / epoch.mul);
  }

  function groupDigits(n) {
    var s = String(n);
    var neg = s[0] === '-';
    if (neg) s = s.slice(1);
    return (neg ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* Anything between 1990 and 20 years out is worth taking seriously; the rest
     is almost certainly the wrong epoch. */
  var LOW = Date.UTC(1990, 0, 1);
  var HIGH = Date.UTC(2045, 0, 1);

  function fmt(d) {
    if (isNaN(d.getTime())) return 'out of range';
    try { return d.toISOString().replace('T', ' ').replace('.000Z', 'Z'); }
    catch (e) { return 'out of range'; }
  }

  function relative(d) {
    var diff = d.getTime() - Date.now();
    var abs = Math.abs(diff);
    var units = [[31557600000, 'year'], [2629800000, 'month'], [86400000, 'day'],
                 [3600000, 'hour'], [60000, 'minute'], [1000, 'second']];
    for (var i = 0; i < units.length; i++) {
      if (abs >= units[i][0]) {
        var n = Math.round(abs / units[i][0]);
        return n + ' ' + units[i][1] + (n === 1 ? '' : 's') + (diff < 0 ? ' ago' : ' from now');
      }
    }
    return 'just now';
  }

  function dosDate(value) {
    /* MS-DOS date/time, still used inside ZIP archives. Packed into 32 bits:
       date in the high half, time in the low half, two-second resolution. */
    var date = (value >>> 16) & 0xffff;
    var time = value & 0xffff;
    var year = ((date >> 9) & 0x7f) + 1980;
    var month = (date >> 5) & 0x0f;
    var day = date & 0x1f;
    var hour = (time >> 11) & 0x1f;
    var min = (time >> 5) & 0x3f;
    var sec = (time & 0x1f) * 2;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return null;
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') +
           ' ' + String(hour).padStart(2, '0') + ':' + String(min).padStart(2, '0') +
           ':' + String(sec).padStart(2, '0');
  }

  function fromNumber(value) {
    out.heading('Reading ' + groupDigits(value) + ' under every epoch');
    out.dim('the plausible ones are highlighted — that is usually enough to');
    out.dim('identify which system wrote the value');
    out.line('');

    var plausible = [];
    EPOCHS.forEach(function (epoch) {
      var d = convert(value, epoch);
      var t = d.getTime();
      var ok = !isNaN(t) && t > LOW && t < HIGH;
      if (ok) plausible.push({ epoch: epoch, date: d });
      out.write(epoch.name.padEnd(22, ' '), ok ? 't-ok' : 't-dim');
      out.line(fmt(d), ok ? 't-ok' : 't-dim');
      out.line('                      ' + epoch.note, 't-dim');
    });

    /* MS-DOS date/time is packed into exactly 32 bits, so a wider value cannot
       be one. The guard has to live here rather than inside dosDate, because
       `value >>> 16` is where the damage happens: ToUint32 wraps anything above
       2^32 and the wrapped bits are perfectly capable of passing dosDate's own
       month/day/hour sanity check. The tool's own worked example — the FILETIME
       133447296000000000 offered on this page — printed a confident
       "2085-02-17 00:00:00" that way. Dropping the row is the honest outcome,
       and it is what already happens for a 32-bit value whose fields are out of
       range. */
    var dosCandidate = (typeof value === 'bigint')
      ? (value >= BigInt(0) && value <= BigInt(0xffffffff))
      : (isFinite(value) && Math.floor(value) === value && value >= 0 && value <= 0xffffffff);
    var dos = dosCandidate ? dosDate(Number(value)) : null;
    if (dos) {
      out.write('MS-DOS (ZIP)'.padEnd(22, ' '), 't-dim');
      out.line(dos, 't-dim');
      out.line('                      packed date+time inside ZIP archives', 't-dim');
    }

    out.rule();
    if (plausible.length === 1) {
      var p = plausible[0];
      out.heading('Most likely: ' + p.epoch.name);
      out.row('UTC', fmt(p.date));
      out.row('local', p.date.toString());
      out.row('relative', relative(p.date));
      out.line('');
      out.ok('Only one epoch puts this in a believable range, so that is almost');
      out.ok('certainly the right reading.');
    } else if (plausible.length > 1) {
      out.heading('Several readings are plausible');
      plausible.forEach(function (p) {
        out.row(p.epoch.name, fmt(p.date) + '   (' + relative(p.date) + ')');
      });
      out.line('');
      out.dim('Pick by source: a value out of the Windows registry or an NTFS');
      out.dim('MFT record is FILETIME; one out of Chrome’s History database is');
      out.dim('WebKit; one out of a macOS plist is Cocoa.');
    } else {
      out.warn('No epoch puts this value in a believable date range.');
      out.dim('It may not be a timestamp at all — or it may be a counter, an');
      out.dim('offset, or a value that needs a different unit.');
    }
  }

  function fromText(text) {
    var d = new Date(text);
    if (isNaN(d.getTime())) {
      out.err('That is not a number and does not parse as a date.');
      out.dim('Try a Unix timestamp (1700000000), a FILETIME');
      out.dim('(133447296000000000), or an ISO date (2024-11-14T22:13:20Z).');
      return;
    }
    out.heading('Parsed: ' + fmt(d));
    out.row('relative', relative(d));
    out.row('local time', d.toString());
    out.rule();
    out.heading('The same instant in every epoch');
    out.dim('what you would store, or expect to find, in each system');
    out.line('');
    EPOCHS.forEach(function (epoch) {
      out.row(epoch.name, groupDigits(toEpochUnits(d, epoch)));
    });
    out.rule();
    out.row('ISO 8601', d.toISOString());
    out.row('RFC 2822', d.toUTCString());
    out.row('day of week', ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()]);
    var start = Date.UTC(d.getUTCFullYear(), 0, 0);
    out.row('day of year', Math.floor((d.getTime() - start) / 86400000));
  }

  function run() {
    var text = document.getElementById('tool-text').value.trim();
    out.clear();
    if (!text) { out.warn('Enter a timestamp — a number, or a date in any usual format.'); return; }

    // A bare integer (or hex) is ambiguous and gets the full epoch sweep.
    var hex = /^0x[0-9a-f]+$/i.test(text);
    var digits = text.replace(/[,_\s]/g, '');

    if (hex) {
      var big = canBig ? BigInt(text) : parseInt(text, 16);
      out.dim('hex ' + text + ' = ' + groupDigits(big) + ' decimal');
      out.line('');
      fromNumber(big);
      return;
    }
    if (/^[-+]?\d+$/.test(digits)) {
      // Integers stay exact: a FILETIME is far past Number.MAX_SAFE_INTEGER.
      fromNumber(canBig ? BigInt(digits) : Number(digits));
      return;
    }
    if (/^[-+]?\d*\.\d+$/.test(digits)) {
      var num = Number(digits);
      if (!isFinite(num)) { out.err('That number could not be read.'); return; }
      fromNumber(num);
      return;
    }
    fromText(text);
  }

  LabTool.define({
    id: 'timestamptool',
    run: run,
    onReady: function () {
      document.getElementById('tool-text').addEventListener('input', function (e) {
        if (e.target.value.trim().length > 3) run();
      });
      var now = document.getElementById('tool-now');
      if (now) now.addEventListener('click', function () {
        document.getElementById('tool-text').value = Math.floor(Date.now() / 1000);
        run();
      });
      out.dim('Paste a number and it is read under every epoch at once, so you');
      out.dim('do not have to know which one produced it.');
      out.dim('');
      out.dim('Try:  1700000000            (Unix seconds)');
      out.dim('      133447296000000000    (Windows FILETIME)');
      out.dim('      13350470400000000     (Chrome / WebKit)');
    }
  });
})();

/* ==========================================================================
   birthday-facts.js — a date of birth in, arithmetic out, working shown.
   --------------------------------------------------------------------------
   Two decisions here are not obvious and both change the answers.

   1. NO Date OBJECT DOES THE COUNTING. Every figure is computed from
      (year, month, day) triples converted to a UTC midnight day number.
      Build a local Date instead and a clock change in the middle of a
      lifetime moves a day boundary by an hour, which is enough to make a
      day count off by one for anybody born near midnight in a country that
      observes daylight saving. UTC midnights are all exactly 86400 seconds
      apart, so the subtraction is safe. The weekday comes from Zeller's
      congruence rather than getDay(), for the same reason and because the
      arithmetic is worth showing on a page whose whole claim is that it
      shows its arithmetic.

   2. "YEARS, MONTHS AND DAYS" IS AMBIGUOUS AND HAS TO PICK A SIDE. Whole
      months are counted first and the leftover days measured from there,
      with the month step CLAMPED to the end of a short month: one month
      after 31 January is 28 February (29 in a leap year), not 3 March. So
      somebody born on the 31st is one month old on the 28th in February and
      the day count restarts there. Every convention has an edge like this;
      this is the one banks and registrars use, and the page says which.

   Nothing is uploaded, and nothing is written to storage either — not even
   the date. Reload and the field is empty again.
   ========================================================================== */

(function () {
  'use strict';

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

  /* Sidereal orbital periods in Earth days, from the NASA planetary fact
     sheets. Sidereal rather than tropical because "one orbit" is the thing
     being counted; the two differ by a few days at Uranus and Neptune. */
  var PLANETS = [
    { name: 'Mercury', days: 87.969 },
    { name: 'Venus', days: 224.701 },
    { name: 'Mars', days: 686.980 },
    { name: 'Jupiter', days: 4332.589 },
    { name: 'Saturn', days: 10759.22 },
    { name: 'Uranus', days: 30685.4 },
    { name: 'Neptune', days: 60189.0 }
  ];

  /* A round working number for the heartbeat sum. Adults at rest sit
     between 60 and 100, so this is the middle of that and no more. */
  var BPM = 70;

  /* The Gregorian calendar starts in October 1582 and was adopted country by
     country over the next 340 years. Before 1583 a "day of the week" needs a
     country attached to it, so the form refuses those dates rather than
     printing a proleptic answer as though it were a fact. */
  var MIN_YEAR = 1583;

  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    if (m === 2) return isLeap(y) ? 29 : 28;
    if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
    return 31;
  }

  /* Zeller's congruence, Gregorian form. January and February are treated as
     months 13 and 14 of the preceding year, which is what removes the leap
     day from the middle of the formula and puts it at the end. */
  function weekday(y, m, d) {
    var yy = y;
    var mm = m;
    if (mm < 3) { mm += 12; yy -= 1; }
    var k = yy % 100;
    var j = Math.floor(yy / 100);
    var h = (d + Math.floor((13 * (mm + 1)) / 5) + k + Math.floor(k / 4) +
             Math.floor(j / 4) + 5 * j) % 7;
    /* Zeller counts Saturday as 0; DAY_NAMES starts at Sunday. */
    return (h + 6) % 7;
  }

  /* Days since 1970-01-01, counted at UTC midnight. See decision 1. */
  function dayNumber(p) {
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }

  function fromDayNumber(n) {
    var dt = new Date(n * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  /* Add whole months, clamping the day of the month. See decision 2. */
  function addMonths(p, n) {
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = total - y * 12 + 1;
    return { y: y, m: m, d: Math.min(p.d, daysInMonth(y, m)) };
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /* Thousands separators without toLocaleString, whose grouping depends on
     the visitor's locale and would disagree with the rest of the page. */
  function group(n) {
    var s = String(Math.abs(Math.round(n)));
    var out = '';
    var seen = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      seen++;
      if (seen % 3 === 0 && i > 0) out = ',' + out;
    }
    return (n < 0 ? '-' : '') + out;
  }

  function twoPlaces(n) {
    var whole = Math.floor(n);
    var frac = Math.round((n - whole) * 100);
    if (frac === 100) { whole += 1; frac = 0; }
    return group(whole) + '.' + pad2(frac);
  }

  function ordinal(n) {
    var rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return n + 'th';
    var rem10 = n % 10;
    if (rem10 === 1) return n + 'st';
    if (rem10 === 2) return n + 'nd';
    if (rem10 === 3) return n + 'rd';
    return n + 'th';
  }

  function longDate(p) {
    return DAY_NAMES[weekday(p.y, p.m, p.d)] + ' ' + p.d + ' ' +
           MONTH_NAMES[p.m - 1] + ' ' + p.y;
  }

  function plural(n, word) {
    return group(n) + ' ' + word + (n === 1 ? '' : 's');
  }

  /* Accepts what the native date picker produces (yyyy-mm-dd) and, for the
     browsers that fall back to a plain text box, day-first d/m/yyyy — which
     is the order the rest of this site writes dates in. */
  function parseDate(value) {
    var s = String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    if (!s) return null;
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
    var dmy = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
    if (dmy) return { y: Number(dmy[3]), m: Number(dmy[2]), d: Number(dmy[1]) };
    return null;
  }

  function realDate(p) {
    if (p.m < 1 || p.m > 12) return false;
    if (p.d < 1) return false;
    return p.d <= daysInMonth(p.y, p.m);
  }

  GameShell.define({
    id: 'game-birthday-facts',
    slug: 'birthday-facts',
    title: 'Birthday facts',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      if (!host) return {};

      var now = new Date();
      var today = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
      var todayIso = today.y + '-' + pad2(today.m) + '-' + pad2(today.d);

      host.className = 'game-board board-birthday';
      host.innerHTML =
        '<form class="bf-form" novalidate>' +
        '  <label class="bf-field" for="bf-date">' +
        '    <span>Date of birth</span>' +
        '    <input type="date" id="bf-date" min="' + MIN_YEAR + '-01-01" max="' + todayIso + '" ' +
        '           autocomplete="off" placeholder="yyyy-mm-dd" />' +
        '  </label>' +
        '  <button class="btn btn-primary bf-go" type="submit">Work it out</button>' +
        '</form>' +
        '<p class="bf-error" id="bf-error" role="status" aria-live="polite"></p>' +
        '<div class="bf-out" id="bf-out" hidden></div>';

      var form = host.querySelector('.bf-form');
      var field = host.querySelector('#bf-date');
      var errorEl = host.querySelector('#bf-error');
      var out = host.querySelector('#bf-out');

      function fail(message) {
        errorEl.textContent = message;
        out.hidden = true;
        out.innerHTML = '';
        g.stat('weekday', '—');
        g.stat('days', '—');
        g.beep(180, 0.08, 'square');
      }

      function cards(list) {
        var html = '<div class="bf-grid">';
        for (var i = 0; i < list.length; i++) {
          html += '<div class="bf-card">' +
                  '<span class="bf-card-label">' + list[i].label + '</span>' +
                  '<p class="bf-card-value">' + list[i].value + '</p>' +
                  '<p class="bf-card-note">' + list[i].note + '</p>' +
                  '</div>';
        }
        return html + '</div>';
      }

      function planetTable(totalDays) {
        var html = '<table class="bf-planets">' +
          '<caption>One year is one orbit. Divide the days you have been alive by the ' +
          'length of each planet\'s orbit and you get an age in that planet\'s years.</caption>' +
          '<thead><tr><th scope="col">Planet</th><th scope="col">Orbit in Earth days</th>' +
          '<th scope="col">Your age there</th></tr></thead><tbody>';
        for (var i = 0; i < PLANETS.length; i++) {
          var p = PLANETS[i];
          html += '<tr><th scope="row">' + p.name + '</th>' +
                  '<td>' + twoPlaces(p.days) + '</td>' +
                  '<td class="bf-planet-age">' + twoPlaces(totalDays / p.days) + '</td></tr>';
        }
        return html + '</tbody></table>';
      }

      function report(dob) {
        var bornDay = dayNumber(dob);
        var todayDay = dayNumber(today);
        var totalDays = todayDay - bornDay;

        /* Whole months first, then the remainder in days. The candidate is
           stepped back one month when it overshoots, which is the only case
           the clamp can produce. */
        var months = (today.y - dob.y) * 12 + (today.m - dob.m);
        if (dayNumber(addMonths(dob, months)) > todayDay) months -= 1;
        var anchor = addMonths(dob, months);
        var restDays = todayDay - dayNumber(anchor);
        var years = Math.floor(months / 12);
        var restMonths = months - years * 12;

        /* Next birthday. A 29 February birth date has no anniversary in three
           years out of four, so it is marked on 1 March — one of the two
           conventions in use, and the one the note below names. */
        var bd = { y: today.y, m: dob.m, d: dob.d };
        if (dob.m === 2 && dob.d === 29 && !isLeap(bd.y)) { bd.m = 3; bd.d = 1; }
        var isToday = dayNumber(bd) === todayDay;
        if (dayNumber(bd) < todayDay) {
          bd = { y: today.y + 1, m: dob.m, d: dob.d };
          if (dob.m === 2 && dob.d === 29 && !isLeap(bd.y)) { bd.m = 3; bd.d = 1; }
        }
        var untilBirthday = dayNumber(bd) - todayDay;
        var turning = bd.y - dob.y;

        /* Milestones are stated as "days old" rather than as an ordinal day,
           because the 1,000th day and 1,000 days old are a day apart and
           people mean the second one. */
        var nextMilestone = (Math.floor(totalDays / 1000) + 1) * 1000;
        var milestoneDate = fromDayNumber(bornDay + nextMilestone);
        var untilMilestone = nextMilestone - totalDays;

        var beats = totalDays * 24 * 60 * BPM;
        var weeks = Math.floor(totalDays / 7);
        var oddDays = totalDays - weeks * 7;

        /* Built by cases rather than by concatenating optional fragments,
           because every fragment that can be absent is a sentence that can
           come out reading "0 months and 1 days". */
        var ageLine;
        if (!years && !restMonths) ageLine = totalDays === 0 ? 'Born today' : plural(restDays, 'day');
        else if (!years) ageLine = plural(restMonths, 'month') + ' and ' + plural(restDays, 'day');
        else if (!restMonths && !restDays) ageLine = plural(years, 'year') + ' exactly';
        else ageLine = plural(years, 'year') + ', ' + plural(restMonths, 'month') +
                       ' and ' + plural(restDays, 'day');

        var birthdayNote;
        if (isToday) birthdayNote = turning === 0 ? 'That is today. Welcome.'
                                                 : 'That is today — you are ' + turning + '.';
        else birthdayNote = plural(untilBirthday, 'day') + ' away — your ' + ordinal(turning) + '.';
        if (dob.m === 2 && dob.d === 29) {
          birthdayNote += ' Born on 29 February, so in ordinary years this page marks it on 1 March.';
        }

        var list = [
          {
            label: 'The day itself',
            value: longDate(dob),
            note: 'Worked out with Zeller\'s congruence, not looked up.'
          },
          {
            label: 'Exact age',
            value: ageLine,
            note: 'Whole months counted first, then the days left over.'
          },
          {
            label: 'Days alive',
            value: plural(totalDays, 'day'),
            note: plural(weeks, 'week') + ' and ' + plural(oddDays, 'day') + ', or ' +
                  plural(totalDays * 24, 'hour') +
                  '. Complete days only — a date of birth carries no clock time.'
          },
          {
            label: 'Next birthday',
            value: longDate(bd),
            note: birthdayNote
          },
          {
            label: 'Next 1,000-day mark',
            value: group(nextMilestone) + ' days old',
            note: (totalDays > 0 && totalDays % 1000 === 0
              ? 'Today is exactly ' + group(totalDays) + ' days, so the next one falls on '
              : 'Falls on ') +
              longDate(milestoneDate) + ', ' + plural(untilMilestone, 'day') + ' from now.'
          },
          {
            label: 'Heartbeats, roughly',
            value: '≈ ' + group(beats),
            note: 'Days × 24 × 60 × ' + BPM + '. The multiplication is exact; the ' + BPM +
                  ' is not — a newborn runs near 120 and an adult at rest sits between 60 and 100.'
          }
        ];

        var html =
          '<p class="bf-lede">You were born on a <strong>' + DAY_NAMES[weekday(dob.y, dob.m, dob.d)] +
          '</strong>.</p>' +
          cards(list) +
          planetTable(totalDays) +
          '<div class="bf-method">' +
          '<p class="bf-method-h">How these were worked out</p>' +
          '<ul class="bf-method-list">' +
          '<li>The weekday comes from Zeller\'s congruence for the Gregorian calendar, which treats ' +
          'January and February as months 13 and 14 of the previous year so that the leap day falls ' +
          'at the end of the sum instead of the middle of it.</li>' +
          '<li>Day counts are differences between UTC midnights, so no clock change anywhere in a ' +
          'lifetime can shift one by a day.</li>' +
          '<li>Leap years follow the real rule: every fourth year, except centuries, except every ' +
          'fourth century. 1900 was not a leap year and 2000 was.</li>' +
          '<li>Planet ages are your days alive divided by that planet\'s sidereal orbital period in ' +
          'Earth days, taken from the NASA fact sheets.</li>' +
          '</ul>' +
          '<p class="bf-privacy">The date stayed in this tab. It was not sent anywhere and it was not ' +
          'saved, not even in your browser — reload the page and the field is empty.</p>' +
          '</div>';

        out.innerHTML = html;
        out.hidden = false;
        errorEl.textContent = '';

        g.stat('weekday', DAY_NAMES[weekday(dob.y, dob.m, dob.d)]);
        g.stat('days', group(totalDays));
        g.beep(560, 0.07, 'sine');
      }

      function calculate() {
        /* Re-read the clock on every submission. A page left open overnight
           would otherwise still be counting to yesterday. */
        var stamp = new Date();
        today = { y: stamp.getFullYear(), m: stamp.getMonth() + 1, d: stamp.getDate() };

        var dob = parseDate(field.value);
        if (!dob) {
          fail('Enter a date of birth — the picker, or type it as yyyy-mm-dd.');
          return;
        }
        if (!realDate(dob)) {
          fail('There is no such date. ' + (dob.m === 2 && dob.d === 29
            ? dob.y + ' was not a leap year.'
            : 'Check the day and the month.'));
          return;
        }
        if (dob.y < MIN_YEAR) {
          fail('Dates before ' + MIN_YEAR + ' are not calculated here — the Gregorian calendar was ' +
               'adopted at different times in different countries, so the weekday would depend on where.');
          return;
        }
        if (dayNumber(dob) > dayNumber(today)) {
          fail('That date has not happened yet.');
          return;
        }
        report(dob);
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        calculate();
      });

      return {
        reset: function () {
          out.hidden = true;
          out.innerHTML = '';
          errorEl.textContent = '';
          field.value = '';
          g.stat('weekday', '—');
          g.stat('days', '—');
        }
      };
    }
  });
})();

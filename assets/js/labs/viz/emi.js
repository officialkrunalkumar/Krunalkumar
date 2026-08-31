/* ==========================================================================
   emi.js — a loan calculator that shows the parts a lender leaves off the
   brochure.
   --------------------------------------------------------------------------
   Every bank site has an EMI calculator. All of them stop at the same place:
   one number, per month, and a pie chart. The four things that actually decide
   what a loan costs are never on that page, so they are the four things this
   lab is built around.

     1. WHERE THE EARLY MONEY GOES. Interest is charged on the outstanding
        balance, and at the start the balance is the whole loan, so the first
        instalment is mostly interest. On a twenty-year home loan at a normal
        rate that is roughly 85 percent of the payment. The chart draws the
        split for every instalment, so the shape is visible rather than
        described.

     2. PREPAYMENT, AND THE CHOICE NOBODY EXPLAINS. Pay a lump sum and the
        lender asks whether you want a lower EMI or a shorter tenure. Those are
        not close: cutting the tenure keeps the payment high and kills interest
        that would have accrued for years, and it usually saves several times
        what cutting the EMI saves. Both are computed here, side by side, on
        the same money.

     3. WHAT A FLOATING RATE ACTUALLY DOES. When the rate rises the lender's
        default is to keep the EMI and extend the tenure. That needs no
        signature, arrives as a line in a statement, and can add years. The
        alternative — raise the EMI, keep the end date — costs more per month
        and far less overall. Both are computed, including the case where the
        EMI stops covering the interest at all.

     4. THE FEE. A headline rate is not a price. A quarter point off the rate
        can be undone by a processing fee, and the only way to see it is to
        price the whole cashflow: what actually reached your account against
        what actually leaves it. That is an internal rate of return, solved
        here by bisection over the real schedule.

   Everything is arithmetic in this tab. There is no network call anywhere in
   this file — no fetch, no XHR, no image, no font, no analytics ping. The CSV
   export is built as a string and handed over through a blob URL, which never
   leaves the browser. A loan amount and a salary are exactly the kind of thing
   people paste into a random site without thinking, and this one has nowhere
   to send them even if it wanted to.

   Rounding is done the way a lender does it: the EMI is rounded to the rupee,
   interest is charged on the balance each month and rounded to the paise, and
   the final instalment absorbs whatever is left. That is why a schedule here
   ends on a slightly different last payment rather than a suspiciously round
   one.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* A brake, not a product limit. A floating-rate scenario where the EMI no
     longer covers the interest never terminates on its own, and the loop has
     to stop somewhere before it stops the tab. 1200 months is a hundred
     years — past that the answer is not "a longer loan", it is "this does not
     amortise", and the UI says so. */
  var MAX_MONTHS = 1200;
  var RUPEE = '₹';

  /* Statutory ceilings used by the optional tax panel. They are constants in
     the code and variables in real life — see the honesty block on the page. */
  var CAP_24B = 200000;
  var CAP_80C = 150000;
  var CESS = 0.04;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug',
                      'Sep', 'Oct', 'Nov', 'Dec'];

  /* ======================================================================== */
  /*  1. MONEY                                                                */
  /* ======================================================================== */

  function r2(x) { return Math.round(x * 100) / 100; }

  /* Indian digit grouping: the last three digits, then pairs. 3000000 reads as
     30,00,000 and not 3,000,000, because this lab is priced in rupees and a
     figure grouped the other way is read wrong by the people it is for. */
  function groupIndian(digits) {
    if (digits.length <= 3) return digits;
    var last3 = digits.substring(digits.length - 3);
    var rest = digits.substring(0, digits.length - 3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }

  function money(x) {
    if (x == null || isNaN(x)) return '—';
    var neg = x < 0;
    var s = groupIndian(String(Math.round(Math.abs(x))));
    return (neg ? '-' : '') + RUPEE + s;
  }

  /* Paise shown only where they are the point — the formula walk-through and
     the first-instalment split, where hiding them would make the arithmetic
     look as if it did not add up. */
  function money2(x) {
    if (x == null || isNaN(x)) return '—';
    var neg = x < 0;
    var v = Math.abs(r2(x));
    var whole = Math.floor(v);
    var paise = Math.round((v - whole) * 100);
    if (paise === 100) { whole += 1; paise = 0; }
    return (neg ? '-' : '') + RUPEE + groupIndian(String(whole)) + '.' +
           (paise < 10 ? '0' : '') + paise;
  }

  /* Axis labels and chart legends only. Lakh and crore, because that is how
     the amounts on this page are said out loud. */
  function shortMoney(x) {
    var a = Math.abs(x);
    if (a >= 10000000) return RUPEE + (x / 10000000).toFixed(a >= 100000000 ? 1 : 2) + ' Cr';
    if (a >= 100000) return RUPEE + (x / 100000).toFixed(a >= 1000000 ? 1 : 2) + ' L';
    if (a >= 1000) return RUPEE + Math.round(x / 1000) + 'k';
    return RUPEE + Math.round(x);
  }

  function pct(x, dp) {
    if (x == null || isNaN(x)) return '—';
    return x.toFixed(dp == null ? 1 : dp) + '%';
  }

  /* "3 years 4 months", because 40 months means nothing to anybody. */
  function tenureWords(months) {
    if (months == null || isNaN(months)) return '—';
    months = Math.round(months);
    var y = Math.floor(months / 12), m = months % 12;
    var parts = [];
    if (y) parts.push(y + (y === 1 ? ' year' : ' years'));
    if (m) parts.push(m + (m === 1 ? ' month' : ' months'));
    if (!parts.length) return '0 months';
    return parts.join(' ');
  }

  function monthLabel(startMonth, startYear, index) {
    var abs = startYear * 12 + startMonth + (index - 1);
    return MONTHS_SHORT[((abs % 12) + 12) % 12] + ' ' + Math.floor(abs / 12);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ======================================================================== */
  /*  2. THE FORMULA, AND THE SCHEDULE IT IMPLIES                             */
  /* ======================================================================== */

  /* The standard annuity payment. Every lender uses this and none of them show
     it, which is a shame, because it is the whole product in one line.

     The zero-rate branch is not a curiosity: an interest-free instalment plan
     is a real thing, and the general form divides by zero there. */
  function emiFor(principal, monthlyRate, months) {
    if (!(months > 0) || !(principal > 0)) return 0;
    if (!(monthlyRate > 0)) return principal / months;
    var f = Math.pow(1 + monthlyRate, months);
    return principal * monthlyRate * f / (f - 1);
  }

  /* Present value of a level annuity. Used to sanity-check the solver, not in
     the schedule itself — the schedule is walked month by month because that
     is the only way rounding, prepayments and a mid-loan rate change can all
     be modelled honestly. */
  function pvAnnuity(payment, monthlyRate, months) {
    if (!(months > 0)) return 0;
    if (!(monthlyRate > 0)) return payment * months;
    return payment * (1 - Math.pow(1 + monthlyRate, -months)) / monthlyRate;
  }

  /* One engine, every scenario.

     Callers supply the rate for a given month, an optional extra payment, and
     an optional hook that runs at the end of each month and may return a new
     EMI. That hook is what "recast the loan" means in practice: after a
     prepayment, or after a rate change, the lender recomputes the instalment
     over whatever term is left. Everything else on this page is a different
     set of three small functions handed to this one loop. */
  function amortise(spec) {
    var balance = spec.principal;
    var emi = spec.emi;
    var cap = spec.maxMonths || MAX_MONTHS;
    var rows = [];
    var totalInterest = 0, totalExtra = 0, totalPaid = 0;
    var m = 0, negative = false;

    while (balance > 0.005 && m < cap) {
      m++;
      var rate = spec.rateAt(m);
      var opening = balance;
      var interest = r2(balance * rate);
      var due = emi;
      /* The last instalment is whatever clears the loan, not the EMI. Lenders
         do this too; it is why a closure statement never matches the number in
         the sanction letter. */
      if (due >= balance + interest - 0.005) due = r2(balance + interest);
      var principalPart = r2(due - interest);
      /* Negative amortisation: the payment no longer covers the month's
         interest, so the balance grows. Reachable in the rate-change tab and
         nowhere else, and it is the single most important thing that tab can
         tell somebody, so it stops here and is reported rather than looping to
         the cap and pretending. */
      if (principalPart <= 0) { negative = true; break; }
      balance = r2(balance - principalPart);

      var extra = 0;
      if (spec.extraAt) {
        extra = spec.extraAt(m);
        if (!(extra > 0)) extra = 0;
        if (extra > balance) extra = balance;
        if (extra > 0) balance = r2(balance - extra);
      }

      totalInterest = r2(totalInterest + interest);
      totalExtra = r2(totalExtra + extra);
      totalPaid = r2(totalPaid + due + extra);

      var row = {
        m: m, opening: opening, emi: due, interest: interest,
        principal: principalPart, extra: extra, closing: balance
      };
      rows.push(row);

      if (spec.after) {
        var next = spec.after(row);
        if (typeof next === 'number' && next > 0) emi = next;
      }
    }

    return {
      rows: rows,
      months: rows.length,
      startEmi: spec.emi,
      lastEmi: rows.length ? rows[rows.length - 1].emi : 0,
      totalInterest: totalInterest,
      totalExtra: totalExtra,
      totalPaid: totalPaid,
      negative: negative,
      capped: !negative && balance > 0.005,
      endBalance: balance
    };
  }

  function flatRate(r) { return function () { return r; }; }

  /* Ceil, for the reason spelled out above the two recasts below, which this
     line originally did not share. Math.round sends the instalment DOWN
     whenever the exact EMI has a fractional part under half a rupee — which is
     half of all loans — and a few paise short every month leaves a residue on
     the final due date. The schedule then runs one extra month to collect a
     stub of a hundred rupees, and a twenty-year loan is reported back to the
     person who asked for twenty years as "20 years 1 month". Every number
     downstream inherits it: the instalment count, the crossover percentage,
     and the prepayment cards, where "cut the EMI" holds the ORIGINAL end date
     and so appeared to shorten a loan it is defined not to shorten.

     Rounding up costs under a rupee a month and lands the loan exactly where
     it was always going to land. */
  function baseline(loan) {
    var emi = Math.ceil(emiFor(loan.principal, loan.monthly, loan.months));
    return amortise({
      principal: loan.principal,
      emi: emi,
      rateAt: flatRate(loan.monthly),
      maxMonths: loan.months + 6
    });
  }

  /* mode: 'tenure' keeps the EMI and lets the loan finish early.
     mode: 'emi'    keeps the original end date and recomputes the instalment
                    every time extra money lands. */
  function prepayScenario(loan, startEmi, plan, mode) {
    var rate = loan.monthly;
    var endMonth = loan.months;
    return amortise({
      principal: loan.principal,
      emi: startEmi,
      rateAt: flatRate(rate),
      extraAt: function (m) {
        var x = 0;
        if (plan.lumpAmount > 0 && m === plan.lumpMonth) x += plan.lumpAmount;
        if (plan.stepAmount > 0 && m >= plan.stepMonth) x += plan.stepAmount;
        return x;
      },
      /* Ceil, not round, on every recast. Rounding the new instalment DOWN
         leaves a few hundred rupees outstanding on the original end date, and
         the schedule then runs one extra month — which is a nonsense answer
         for the option whose entire selling point is that the end date does
         not move. Rounding up costs under a rupee a month and lands the loan
         exactly where it was always going to land. */
      after: mode === 'emi' ? function (row) {
        if (!(row.extra > 0) || !(row.closing > 0)) return;
        var left = endMonth - row.m;
        if (left < 1) return;
        return Math.ceil(emiFor(row.closing, rate, left));
      } : null,
      maxMonths: loan.months + 6
    });
  }

  /* mode: 'tenure' is what the lender does by default — the EMI is untouched
                    and the term floats.
     mode: 'emi'    keeps the original end date and raises the instalment. */
  function rateScenario(loan, startEmi, change, mode) {
    var r0 = loan.monthly;
    var r1 = change.annual / 1200;
    var cm = change.month;
    var endMonth = loan.months;
    var opening = startEmi;
    if (mode === 'emi' && cm <= 1) {
      opening = Math.ceil(emiFor(loan.principal, r1, endMonth));
    }
    return amortise({
      principal: loan.principal,
      emi: opening,
      rateAt: function (m) { return m >= cm ? r1 : r0; },
      /* Ceil for the same reason as the prepayment recast: this option exists
         to hold the end date, so it must not slip a month to rounding. */
      after: mode === 'emi' ? function (row) {
        if (row.m !== cm - 1) return;
        var left = endMonth - row.m;
        if (left < 1 || !(row.closing > 0)) return;
        return Math.ceil(emiFor(row.closing, r1, left));
      } : null,
      /* The tenure-extension case is the one that can run away, so it gets the
         full brake rather than the tidy months+6 the others use. */
      maxMonths: mode === 'tenure' ? MAX_MONTHS : endMonth + 6
    });
  }

  /* The internal rate of return of the real cashflow: what reached the
     borrower's account on day zero against what leaves it every month
     afterwards. This is the number a headline rate hides, because a fee is
     money you borrowed and never received.

     Bisection rather than Newton. NPV is monotonically decreasing in the rate
     over the range that matters, the bracket is known (nobody's effective
     monthly rate exceeds 100 percent), and eighty halvings put the answer well
     past the precision anyone should quote. Newton would be faster and would
     also need a derivative and a divergence guard for a problem that takes
     under a millisecond either way. */
  function npv(rate, net, rows) {
    var v = -net;
    for (var i = 0; i < rows.length; i++) {
      v += (rows[i].emi + rows[i].extra) / Math.pow(1 + rate, i + 1);
    }
    return v;
  }

  function irrMonthly(net, rows) {
    if (!(net > 0) || !rows.length) return null;
    if (npv(0, net, rows) <= 0) return null;   // never repaid more than received
    var lo = 0, hi = 1, mid, i;
    if (npv(hi, net, rows) > 0) return null;   // outside the bracket; refuse to guess
    for (i = 0; i < 80; i++) {
      mid = (lo + hi) / 2;
      if (npv(mid, net, rows) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function annualise(monthly) {
    if (monthly == null) return null;
    return (Math.pow(1 + monthly, 12) - 1) * 100;
  }

  /* ======================================================================== */
  /*  3. DERIVED FACTS                                                        */
  /* ======================================================================== */

  /* The month the instalment stops being mostly rent on the money. On a long
     loan this lands past the halfway mark, which is the single most surprising
     number on the page for most people. */
  function crossoverMonth(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].principal > rows[i].interest) return rows[i].m;
    }
    return null;
  }

  function interestInFirst(rows, n) {
    var sum = 0;
    for (var i = 0; i < rows.length && i < n; i++) sum += rows[i].interest;
    return r2(sum);
  }

  function paidByMonth(rows, n) {
    var interest = 0, principal = 0;
    for (var i = 0; i < rows.length && i < n; i++) {
      interest += rows[i].interest;
      principal += rows[i].principal + rows[i].extra;
    }
    return { interest: r2(interest), principal: r2(principal) };
  }

  /* Financial year in the Indian sense: April to March. Returned as the
     starting calendar year, so 2026 means FY 2026-27. */
  function fyStartYear(startMonth, startYear, index) {
    var abs = startYear * 12 + startMonth + (index - 1);
    var y = Math.floor(abs / 12);
    var mo = ((abs % 12) + 12) % 12;
    return mo >= 3 ? y : y - 1;
  }

  function fyLabel(y) {
    return 'FY ' + y + '–' + pad2((y + 1) % 100);
  }

  function groupByFy(rows, startMonth, startYear) {
    var out = [], index = {}, i, key, bucket;
    for (i = 0; i < rows.length; i++) {
      key = fyStartYear(startMonth, startYear, rows[i].m);
      bucket = index[key];
      if (!bucket) {
        bucket = { fy: key, interest: 0, principal: 0, extra: 0, months: 0 };
        index[key] = bucket;
        out.push(bucket);
      }
      bucket.interest = r2(bucket.interest + rows[i].interest);
      bucket.principal = r2(bucket.principal + rows[i].principal);
      bucket.extra = r2(bucket.extra + rows[i].extra);
      bucket.months++;
    }
    return out;
  }

  /* ======================================================================== */
  /*  4. CSV                                                                  */
  /* ======================================================================== */

  function csvCell(value) {
    var s = String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* Plain numbers, no rupee sign and no thousands separators, because the
     point of a CSV is that a spreadsheet reads the column as a number rather
     than as text it has to be argued with. */
  function scheduleCsv(res, loan) {
    var lines = ['Instalment,Month,Opening balance,Instalment paid,Interest,Principal,Extra payment,Closing balance'];
    for (var i = 0; i < res.rows.length; i++) {
      var row = res.rows[i];
      lines.push([
        row.m,
        csvCell(monthLabel(loan.startMonth, loan.startYear, row.m)),
        r2(row.opening).toFixed(2),
        r2(row.emi).toFixed(2),
        r2(row.interest).toFixed(2),
        r2(row.principal).toFixed(2),
        r2(row.extra).toFixed(2),
        r2(row.closing).toFixed(2)
      ].join(','));
    }
    lines.push(['Total', '', '', r2(res.totalPaid).toFixed(2),
                r2(res.totalInterest).toFixed(2),
                r2(res.totalPaid - res.totalInterest - res.totalExtra).toFixed(2),
                r2(res.totalExtra).toFixed(2), '0.00'].join(','));
    return lines.join('\r\n') + '\r\n';
  }

  /* A blob URL, built and revoked in this tab. There is no upload step and no
     server on the other end of this. */
  function saveText(text, filename) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ======================================================================== */
  /*  5. DOM AND CHART HELPERS                                                */
  /* ======================================================================== */

  var C = {
    bg: '#020617', panel: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    interest: '#fbbf24', principal: '#38bdf8', fee: '#f472b6',
    good: '#34d399', bad: '#fca5a5', violet: '#a78bfa'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";

  function E(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function niceTicks(lo, hi, want) {
    if (!(hi > lo)) return [lo];
    var span = hi - lo;
    var step = Math.pow(10, Math.floor(Math.log(span / want) / Math.LN10));
    var mult = span / want / step;
    if (mult > 5) step *= 10;
    else if (mult > 2) step *= 5;
    else if (mult > 1) step *= 2;
    var out = [], v = Math.ceil(lo / step) * step, guard = 0;
    while (v <= hi + step * 1e-6 && guard++ < 60) { out.push(v); v += step; }
    return out;
  }

  function Chart(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  Chart.prototype.frame = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(260, this.canvas.clientWidth || 640);
    var h = Math.max(180, this.canvas.clientHeight || 300);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    var ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px ' + FONT;
    ctx.textBaseline = 'middle';
  };

  Chart.prototype.empty = function (message) {
    this.frame();
    var ctx = this.ctx;
    ctx.fillStyle = C.faint;
    ctx.textAlign = 'center';
    ctx.fillText(message, this.w / 2, this.h / 2);
  };

  /* Axes shared by the two time-series charts. Returns the projection
     functions so the callers stay short. */
  Chart.prototype.axes = function (maxMonth, maxY, yLabel) {
    var ctx = this.ctx;
    var padL = 62, padR = 14, padT = 12, padB = 30;
    var innerW = Math.max(10, this.w - padL - padR);
    var innerH = Math.max(10, this.h - padT - padB);
    var px = function (m) { return padL + (m / maxMonth) * innerW; };
    var py = function (v) { return padT + innerH - (v / maxY) * innerH; };

    var yt = niceTicks(0, maxY, 5), i, y;
    ctx.textAlign = 'right';
    for (i = 0; i < yt.length; i++) {
      y = py(yt[i]);
      ctx.strokeStyle = 'rgba(28,43,68,0.85)';
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + innerW, y);
      ctx.stroke();
      ctx.fillStyle = C.faint;
      ctx.fillText(shortMoney(yt[i]), padL - 7, y);
    }

    /* The x axis counts years, not months. A tick every 60 instalments is a
       row of numbers nobody reads; "yr 5" is the unit people think in. */
    var years = Math.max(1, Math.ceil(maxMonth / 12));
    var stepY = years <= 6 ? 1 : (years <= 13 ? 2 : (years <= 26 ? 5 : 10));
    ctx.textAlign = 'center';
    for (i = 0; i <= years; i += stepY) {
      var x = px(i * 12);
      if (x > padL + innerW + 1) break;
      ctx.strokeStyle = 'rgba(28,43,68,0.55)';
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + innerH);
      ctx.stroke();
      ctx.fillStyle = C.faint;
      ctx.fillText(i === 0 ? 'start' : 'yr ' + i, x, padT + innerH + 13);
    }

    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    if (yLabel) {
      ctx.save();
      ctx.translate(11, padT + innerH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = C.dim;
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }

    return { px: px, py: py, padL: padL, padT: padT, innerW: innerW, innerH: innerH };
  };

  /* The chart the whole lab is named for: what each instalment is made of.
     Interest sits on the floor so the wedge that shrinks is the one at the
     bottom of the picture, which is where the eye goes first. */
  Chart.prototype.split = function (rows, marker) {
    if (!rows.length) { this.empty('Enter a loan to draw the split.'); return; }
    this.frame();
    var ctx = this.ctx;
    var maxY = 0, i;
    for (i = 0; i < rows.length; i++) if (rows[i].emi > maxY) maxY = rows[i].emi;
    maxY = maxY * 1.08;
    var a = this.axes(rows.length, maxY, 'per instalment');

    ctx.beginPath();
    ctx.moveTo(a.px(0), a.py(0));
    for (i = 0; i < rows.length; i++) ctx.lineTo(a.px(rows[i].m), a.py(rows[i].interest));
    ctx.lineTo(a.px(rows.length), a.py(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(251,191,36,0.55)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(a.px(0), a.py(rows[0].emi));
    for (i = 0; i < rows.length; i++) ctx.lineTo(a.px(rows[i].m), a.py(rows[i].emi));
    for (i = rows.length - 1; i >= 0; i--) ctx.lineTo(a.px(rows[i].m), a.py(rows[i].interest));
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.45)';
    ctx.fill();

    ctx.strokeStyle = C.interest;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (i = 0; i < rows.length; i++) {
      var x = a.px(rows[i].m), y = a.py(rows[i].interest);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (marker && marker > 0 && marker <= rows.length) {
      var mx = a.px(marker);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.good;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, a.padT);
      ctx.lineTo(mx, a.padT + a.innerH);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = C.good;
      ctx.textAlign = mx > this.w * 0.6 ? 'right' : 'left';
      ctx.fillText(' principal overtakes interest ', mx, a.padT + 8);
    }
  };

  /* Outstanding balance, one line per scenario. This is the picture that makes
     a prepayment or a rate change legible: the same debt, three different
     routes to zero. */
  Chart.prototype.balances = function (series) {
    var maxMonth = 0, maxY = 0, i, k, s;
    for (i = 0; i < series.length; i++) {
      s = series[i];
      if (s.rows.length > maxMonth) maxMonth = s.rows.length;
      for (k = 0; k < s.rows.length; k++) {
        if (s.rows[k].opening > maxY) maxY = s.rows[k].opening;
      }
    }
    if (!maxMonth) { this.empty('Nothing to draw yet.'); return; }
    this.frame();
    var ctx = this.ctx;
    var a = this.axes(maxMonth, maxY * 1.06, 'outstanding');

    for (i = 0; i < series.length; i++) {
      s = series[i];
      if (!s.rows.length) continue;
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = s.width || 1.8;
      ctx.setLineDash(s.dash || []);
      ctx.beginPath();
      ctx.moveTo(a.px(0), a.py(s.rows[0].opening));
      for (k = 0; k < s.rows.length; k++) ctx.lineTo(a.px(s.rows[k].m), a.py(s.rows[k].closing));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  /* Two loans as stacked cost bars. The bar is the total that leaves your
     account, split into the money you borrowed, the interest, and the fee —
     and the fee segment is usually the one people have never seen drawn. */
  Chart.prototype.costBars = function (items) {
    if (!items.length) { this.empty('Fill both loans in.'); return; }
    this.frame();
    var ctx = this.ctx;
    var maxV = 0, i, k;
    for (i = 0; i < items.length; i++) {
      var t = 0;
      for (k = 0; k < items[i].parts.length; k++) t += items[i].parts[k].value;
      if (t > maxV) maxV = t;
    }
    if (!(maxV > 0)) { this.empty('Fill both loans in.'); return; }

    var padL = 84, padR = 16, padT = 18, padB = 26;
    var innerW = Math.max(10, this.w - padL - padR);
    var slot = (this.h - padT - padB) / items.length;
    var barH = Math.min(38, slot * 0.5);

    for (i = 0; i < items.length; i++) {
      var y = padT + slot * i + slot / 2;
      ctx.fillStyle = C.dim;
      ctx.textAlign = 'right';
      ctx.fillText(items[i].label, padL - 9, y);
      var x = padL;
      for (k = 0; k < items[i].parts.length; k++) {
        var part = items[i].parts[k];
        var w = (part.value / maxV) * innerW;
        ctx.fillStyle = part.colour;
        ctx.fillRect(x, y - barH / 2, Math.max(0, w), barH);
        x += w;
      }
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'left';
      ctx.fillText(' ' + shortMoney(items[i].total), x + 4, y);
    }
  };

  /* ======================================================================== */
  /*  6. THE INTERFACE                                                        */
  /* ======================================================================== */

  var CSS = [
    '#emiviz .em-wrap{font:13px/1.6 ' + FONT + ';color:' + C.ink + ';}',
    '#emiviz .em-loanbar{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:flex-end;padding:12px 14px;border-bottom:1px solid ' + C.line + ';background:rgba(11,18,32,0.65);}',
    '#emiviz .em-field{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 8.5rem;}',
    '#emiviz .em-field-label{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:' + C.faint + ';}',
    '#emiviz .em-input,#emiviz .em-select{font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:7px;padding:7px 9px;width:100%;min-width:0;}',
    '#emiviz .em-input:focus-visible,#emiviz .em-select:focus-visible,#emiviz .em-btn:focus-visible,#emiviz .em-tab:focus-visible,#emiviz .em-canvas:focus-visible,#emiviz summary:focus-visible{outline:2px solid ' + C.principal + ';outline-offset:2px;}',
    '#emiviz .em-input.is-bad{border-color:' + C.bad + ';}',
    '#emiviz .em-field-hint{font-size:11px;color:' + C.faint + ';}',
    '#emiviz .em-headline{flex:1 1 12rem;padding:8px 12px;border:1px solid rgba(56,189,248,.35);border-radius:9px;background:rgba(56,189,248,.07);}',
    '#emiviz .em-headline-k{display:block;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:' + C.faint + ';}',
    '#emiviz .em-headline-v{display:block;font-size:22px;font-weight:700;color:' + C.principal + ';line-height:1.25;}',
    '#emiviz .em-headline-n{display:block;font-size:11px;color:' + C.dim + ';}',

    '#emiviz .em-tabs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;border-bottom:1px solid ' + C.line + ';background:rgba(15,23,42,.6);}',
    '#emiviz .em-tab{font:inherit;font-size:12px;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:8px;padding:7px 12px;cursor:pointer;}',
    '#emiviz .em-tab:hover{color:' + C.ink + ';border-color:#3b5b80;}',
    '#emiviz .em-tab[aria-selected="true"]{color:#04121f;background:' + C.principal + ';border-color:' + C.principal + ';font-weight:700;}',
    '#emiviz .em-panel{padding:14px;min-width:0;}',
    '#emiviz .em-panel[hidden]{display:none;}',

    '#emiviz .em-lede{margin:0 0 12px;max-width:46rem;font-size:12.5px;line-height:1.75;color:#cbd5e1;}',
    '#emiviz .em-h{margin:16px 0 8px;font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#emiviz .em-h:first-child{margin-top:0;}',
    '#emiviz .em-controls{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:flex-end;margin:0 0 12px;}',
    '#emiviz .em-btnrow{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;}',
    '#emiviz .em-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:8px 12px;cursor:pointer;}',
    '#emiviz .em-btn:hover:not([disabled]){background:#213152;border-color:#40608f;}',
    '#emiviz .em-btn[disabled]{opacity:.4;cursor:default;}',

    '#emiviz .em-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:10px;}',
    '#emiviz .em-card{border:1px solid ' + C.line + ';border-radius:10px;background:rgba(15,23,42,.55);padding:11px 13px;min-width:0;}',
    '#emiviz .em-card.is-best{border-color:rgba(52,211,153,.55);background:rgba(52,211,153,.07);}',
    '#emiviz .em-card-h{margin:0 0 4px;font-size:13px;font-weight:700;color:' + C.ink + ';}',
    '#emiviz .em-card-sub{margin:0 0 8px;font-size:11px;line-height:1.6;color:' + C.faint + ';}',
    '#emiviz .em-card-big{display:block;font-size:19px;font-weight:700;color:' + C.good + ';line-height:1.3;}',
    '#emiviz .em-card-big.is-cost{color:' + C.interest + ';}',

    '#emiviz .em-rows{margin:0;}',
    '#emiviz .em-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px solid rgba(28,43,68,.6);font-size:12px;}',
    '#emiviz .em-row:last-child{border-bottom:0;}',
    '#emiviz .em-row-k{color:' + C.dim + ';min-width:0;}',
    '#emiviz .em-row-v{color:' + C.ink + ';font-weight:600;white-space:nowrap;}',
    '#emiviz .em-row-v.is-warn{color:' + C.interest + ';}',
    '#emiviz .em-row-v.is-good{color:' + C.good + ';}',

    '#emiviz .em-note{margin:12px 0 0;padding:9px 12px;border-left:3px solid ' + C.principal + ';background:rgba(56,189,248,.06);border-radius:0 8px 8px 0;font-size:12px;line-height:1.7;color:#cbd5e1;}',
    '#emiviz .em-note.is-warn{border-left-color:' + C.interest + ';background:rgba(251,191,36,.07);color:#fcd77a;}',
    '#emiviz .em-note.is-bad{border-left-color:' + C.bad + ';background:rgba(252,165,165,.07);color:' + C.bad + ';}',
    '#emiviz .em-note.is-good{border-left-color:' + C.good + ';background:rgba(52,211,153,.07);color:#a7f3d0;}',
    '#emiviz .em-note p{margin:0 0 7px;}',
    '#emiviz .em-note p:last-child{margin-bottom:0;}',

    '#emiviz .em-formula{margin:0;padding:11px 13px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.bg + ';font:12px/1.85 ' + FONT + ';color:#cbd5e1;overflow-x:auto;white-space:pre;}',
    '#emiviz .em-formula b{color:' + C.principal + ';font-weight:700;}',

    '#emiviz .em-chartwrap{border:1px solid ' + C.line + ';border-radius:10px;background:' + C.bg + ';padding:4px;margin:10px 0 0;}',
    '#emiviz .em-canvas{display:block;width:100%;height:300px;border-radius:7px;}',
    '@media (max-width:640px){#emiviz .em-canvas{height:230px;}}',
    '#emiviz .em-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 2px 0;font-size:11.5px;color:' + C.dim + ';}',
    '#emiviz .em-legend span{display:inline-flex;align-items:center;gap:6px;}',
    '#emiviz .em-swatch{width:11px;height:11px;border-radius:3px;flex:0 0 auto;}',

    '#emiviz .em-details{margin:14px 0 0;border:1px solid ' + C.line + ';border-radius:9px;background:rgba(15,23,42,.4);padding:9px 12px;}',
    '#emiviz .em-details summary{cursor:pointer;font-size:12px;color:' + C.principal + ';}',
    '#emiviz .em-details[open] summary{margin-bottom:9px;}',
    '#emiviz .em-tablewrap{overflow:auto;max-height:26rem;border:1px solid ' + C.line + ';border-radius:8px;}',
    '#emiviz .em-table{width:100%;border-collapse:collapse;font-size:11.5px;}',
    '#emiviz .em-table th{position:sticky;top:0;z-index:1;padding:6px 8px;text-align:right;font-weight:600;color:' + C.faint + ';background:#0d1729;border-bottom:1px solid ' + C.line + ';white-space:nowrap;}',
    '#emiviz .em-table th:first-child,#emiviz .em-table td:first-child{text-align:left;}',
    '#emiviz .em-table td{padding:4px 8px;text-align:right;border-bottom:1px solid rgba(28,43,68,.55);color:' + C.ink + ';white-space:nowrap;}',
    '#emiviz .em-table tbody tr:hover td{background:rgba(56,189,248,.06);}',
    '#emiviz .em-table .em-td-int{color:' + C.interest + ';}',
    '#emiviz .em-table .em-td-pri{color:' + C.principal + ';}',

    '#emiviz .em-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:14px;}',
    '#emiviz .em-toggle{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:#cbd5e1;cursor:pointer;}',
    '#emiviz .em-toggle input{accent-color:' + C.principal + ';cursor:pointer;}',
    '#emiviz .em-off{opacity:.45;pointer-events:none;}'
  ].join('');

  function EmiLab(root) {
    this.root = root;
    this.tab = 'loan';
    this.timer = null;
    this.model = null;
    this.charts = {};
    this.build();
    this.schedule();
  }

  /* ---- small builders --------------------------------------------------- */

  EmiLab.prototype.num = function (id, label, value, opts) {
    opts = opts || {};
    var wrap = E('div', 'em-field');
    var lab = E('label', 'em-field-label', label);
    lab.htmlFor = id;
    var input = E('input');
    input.type = 'number';
    input.id = id;
    input.className = 'em-input';
    input.value = String(value);
    input.setAttribute('inputmode', opts.decimal ? 'decimal' : 'numeric');
    input.setAttribute('autocomplete', 'off');
    if (opts.min != null) input.min = String(opts.min);
    if (opts.max != null) input.max = String(opts.max);
    input.step = opts.step != null ? String(opts.step) : '1';
    /* The comparison tab has two identical sets of fields sitting side by side.
       Visually the "Loan A" and "Loan B" headings separate them; to a screen
       reader they were four pairs of controls all called "Amount". The aria
       name carries the loan letter and still contains the visible label word,
       so voice control ("click amount") keeps working. */
    if (opts.aria) input.setAttribute('aria-label', opts.aria);
    wrap.appendChild(lab);
    wrap.appendChild(input);
    if (opts.hint) {
      var hint = E('span', 'em-field-hint', opts.hint);
      hint.id = id + '-hint';
      input.setAttribute('aria-describedby', hint.id);
      wrap.appendChild(hint);
    }
    if (opts.wide) wrap.style.flexBasis = '12rem';
    this.watch(input);
    this[opts.key] = input;
    return wrap;
  };

  EmiLab.prototype.sel = function (id, label, options, value, key) {
    var wrap = E('div', 'em-field');
    var lab = E('label', 'em-field-label', label);
    lab.htmlFor = id;
    var select = E('select', 'em-select');
    select.id = id;
    for (var i = 0; i < options.length; i++) {
      var o = E('option', null, options[i][1]);
      o.value = options[i][0];
      if (options[i][0] === value) o.selected = true;
      select.appendChild(o);
    }
    wrap.appendChild(lab);
    wrap.appendChild(select);
    this.watch(select);
    this[key] = select;
    return wrap;
  };

  EmiLab.prototype.watch = function (el) {
    var self = this;
    el.addEventListener('input', function () { self.schedule(); });
    el.addEventListener('change', function () { self.schedule(); });
  };

  EmiLab.prototype.button = function (label, fn) {
    var b = E('button', 'em-btn', label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  function rowLine(key, value, cls) {
    var row = E('div', 'em-row');
    row.appendChild(E('span', 'em-row-k', key));
    row.appendChild(E('span', 'em-row-v' + (cls ? ' ' + cls : ''), value));
    return row;
  }

  function legend(pairs) {
    var wrap = E('div', 'em-legend');
    for (var i = 0; i < pairs.length; i++) {
      var item = E('span');
      var sw = E('span', 'em-swatch');
      sw.style.background = pairs[i][0];
      item.appendChild(sw);
      item.appendChild(document.createTextNode(pairs[i][1]));
      wrap.appendChild(item);
    }
    return wrap;
  }

  /* A canvas is a picture with no text in it, so every one here gets a real
     accessible name that is rewritten with the numbers whenever it is redrawn,
     and every one of them has a table or a set of rows saying the same thing
     in words nearby. */
  EmiLab.prototype.chart = function (key, height) {
    var wrap = E('div', 'em-chartwrap');
    var canvas = E('canvas', 'em-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Chart, not yet drawn.');
    if (height) canvas.style.height = height;
    wrap.appendChild(canvas);
    this.charts[key] = new Chart(canvas);
    this.charts[key].node = canvas;
    return wrap;
  };

  EmiLab.prototype.describe = function (key, text) {
    var c = this.charts[key];
    if (c && c.node) c.node.setAttribute('aria-label', text);
  };

  /* ---- construction ------------------------------------------------------ */

  EmiLab.prototype.build = function () {
    var self = this;
    var style = E('style');
    style.textContent = CSS;
    this.root.appendChild(style);

    var wrap = E('div', 'em-wrap');

    /* The loan itself sits above the tabs rather than inside one, because
       every tab is a different question about the same loan and repeating
       these four fields five times would invite five different answers. */
    var bar = E('div', 'em-loanbar');
    bar.appendChild(this.num('em-principal', 'Loan amount ' + RUPEE, 3000000,
      { min: 1000, step: 10000, key: 'fPrincipal', wide: true }));
    bar.appendChild(this.num('em-rate', 'Rate % a year', 8.6,
      { min: 0, max: 60, step: 0.05, decimal: true, key: 'fRate' }));
    bar.appendChild(this.num('em-years', 'Tenure in years', 20,
      { min: 1, max: 40, step: 1, key: 'fYears', hint: 'whole years' }));
    bar.appendChild(this.num('em-extramonths', 'Plus months', 0,
      { min: 0, max: 11, step: 1, key: 'fExtraMonths', hint: '0 to 11' }));

    var monthOpts = [];
    for (var i = 0; i < 12; i++) monthOpts.push([String(i), MONTHS[i]]);
    var today = new Date();
    bar.appendChild(this.sel('em-startmonth', 'First EMI', monthOpts,
      String(today.getMonth()), 'fStartMonth'));
    bar.appendChild(this.num('em-startyear', 'Year', today.getFullYear(),
      { min: 1970, max: 2199, step: 1, key: 'fStartYear' }));

    var head = E('div', 'em-headline');
    head.appendChild(E('span', 'em-headline-k', 'Monthly instalment'));
    this.emiValue = E('strong', 'em-headline-v', '—');
    head.appendChild(this.emiValue);
    this.emiNote = E('span', 'em-headline-n', '');
    head.appendChild(this.emiNote);
    bar.appendChild(head);
    wrap.appendChild(bar);

    /* One live region for the whole lab. The headline changes on every
       keystroke, and a screen reader that announced each panel separately
       would talk over itself; this says the one sentence that matters once the
       typing has settled. */
    this.live = E('p');
    this.live.className = 'sr-only';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    wrap.appendChild(this.live);

    this.errorBox = E('div', 'em-note is-bad');
    this.errorBox.hidden = true;
    wrap.appendChild(this.errorBox);

    var tabs = E('div', 'em-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Loan views');
    this.tabButtons = [];
    var specs = [
      ['loan', 'The instalment'],
      ['prepay', 'Prepayment'],
      ['rate', 'Rate change'],
      ['compare', 'Compare two loans'],
      ['tax', 'Tax, old regime']
    ];
    specs.forEach(function (spec) {
      var b = E('button', 'em-tab', spec[1]);
      b.type = 'button';
      b.id = 'em-tab-' + spec[0];
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'em-panel-' + spec[0]);
      b.addEventListener('click', function () { self.setTab(spec[0]); });
      b.addEventListener('keydown', function (event) { self.tabKey(event, spec[0]); });
      tabs.appendChild(b);
      self.tabButtons.push({ key: spec[0], el: b });
    });
    wrap.appendChild(tabs);

    this.panels = {};
    this.panels.loan = this.buildLoanPanel();
    this.panels.prepay = this.buildPrepayPanel();
    this.panels.rate = this.buildRatePanel();
    this.panels.compare = this.buildComparePanel();
    this.panels.tax = this.buildTaxPanel();
    specs.forEach(function (spec) {
      var panel = self.panels[spec[0]];
      panel.id = 'em-panel-' + spec[0];
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'em-tab-' + spec[0]);
      panel.tabIndex = 0;
      wrap.appendChild(panel);
    });

    this.root.appendChild(wrap);
    this.setTab('loan');

    /* A canvas backing store is set in device pixels from the element's CSS
       width, so it goes stale the moment that width changes and nothing tells
       the canvas. A window resize is only one of the ways that happens: going
       fullscreen, the loan bar wrapping onto another line as a number gets
       longer, or the browser pane itself being dragged wider all move the box
       without necessarily reaching this listener. ResizeObserver watches the
       box rather than the window, which is the thing that actually matters.

       No feedback loop: the canvas is sized in CSS (width 100%, fixed height),
       so writing canvas.width changes the bitmap and not the layout, and the
       observer has nothing new to report. The timeout only coalesces a drag
       into one redraw per frame's worth of events. The window listener stays
       as the fallback for browsers without the observer. */
    var redrawTimer = null;
    function redraw() {
      if (redrawTimer) clearTimeout(redrawTimer);
      redrawTimer = setTimeout(function () { if (self.model) self.draw(); }, 60);
    }
    window.addEventListener('resize', redraw);
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(redraw).observe(this.root); } catch (err) { /* fallback covers it */ }
    }
  };

  EmiLab.prototype.tabKey = function (event, key) {
    var order = ['loan', 'prepay', 'rate', 'compare', 'tax'];
    var at = order.indexOf(key), next = -1;
    if (event.key === 'ArrowRight') next = (at + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    if (next < 0) return;
    event.preventDefault();
    this.setTab(order[next]);
    for (var i = 0; i < this.tabButtons.length; i++) {
      if (this.tabButtons[i].key === order[next]) this.tabButtons[i].el.focus();
    }
  };

  EmiLab.prototype.setTab = function (key) {
    this.tab = key;
    for (var i = 0; i < this.tabButtons.length; i++) {
      var t = this.tabButtons[i];
      var on = t.key === key;
      t.el.setAttribute('aria-selected', on ? 'true' : 'false');
      t.el.tabIndex = on ? 0 : -1;
      this.panels[t.key].hidden = !on;
    }
    if (this.model) this.draw();
  };

  /* ---- panel: the instalment -------------------------------------------- */

  EmiLab.prototype.buildLoanPanel = function () {
    var self = this;
    var p = E('div', 'em-panel');
    p.appendChild(E('p', 'em-lede',
      'Interest is charged every month on whatever is still owed. At the start ' +
      'that is the entire loan, so the first instalment is almost all interest ' +
      'and barely touches the debt. The chart is that fact drawn for every ' +
      'month of the loan.'));

    p.appendChild(E('h3', 'em-h', 'The formula, with your numbers in it'));
    this.formula = E('pre', 'em-formula');
    this.formula.tabIndex = 0;
    p.appendChild(this.formula);

    p.appendChild(E('h3', 'em-h', 'What the loan costs'));
    this.loanRows = E('div', 'em-rows');
    p.appendChild(this.loanRows);

    p.appendChild(E('h3', 'em-h', 'Every instalment, split'));
    p.appendChild(this.chart('split'));
    p.appendChild(legend([
      [C.interest, 'Interest — the lender keeps this'],
      [C.principal, 'Principal — this is the only part that reduces the debt'],
      [C.good, 'The month principal finally overtakes interest']
    ]));
    this.loanNote = E('div', 'em-note');
    p.appendChild(this.loanNote);

    var details = E('details', 'em-details');
    var summary = E('summary', null, 'The full amortisation schedule');
    details.appendChild(summary);
    var controls = E('div', 'em-controls');
    controls.appendChild(this.sel('em-grain', 'Show', [
      ['year', 'One row per year'],
      ['month', 'Every instalment']
    ], 'year', 'fGrain'));
    details.appendChild(controls);
    this.scheduleWrap = E('div', 'em-tablewrap');
    this.scheduleWrap.tabIndex = 0;
    details.appendChild(this.scheduleWrap);
    details.appendChild(E('p', 'em-field-hint',
      'The table follows the control above. The CSV always contains every ' +
      'instalment, as plain numbers with no rupee signs, so a spreadsheet reads ' +
      'the columns as numbers.'));
    var row = E('div', 'em-btnrow');
    row.appendChild(this.button('Download the schedule as CSV', function () {
      self.exportCsv('base', 'emi-schedule.csv');
    }));
    details.appendChild(row);
    /* Closed by default: 240 rows opening under the chart on first paint would
       bury everything the page is trying to say. */
    p.appendChild(details);
    return p;
  };

  /* ---- panel: prepayment ------------------------------------------------- */

  EmiLab.prototype.buildPrepayPanel = function () {
    var self = this;
    var p = E('div', 'em-panel');
    p.appendChild(E('p', 'em-lede',
      'Put extra money against the loan and the lender will ask which you want: ' +
      'a smaller instalment, or an earlier finish. Almost everybody says smaller ' +
      'instalment, because it is the one you can feel. It is usually the one that ' +
      'saves less, and often by a lot. Here are both, on the same money.'));

    var controls = E('div', 'em-controls');
    controls.appendChild(this.num('em-lump', 'One-off amount ' + RUPEE, 200000,
      { min: 0, step: 10000, key: 'fLump', wide: true }));
    controls.appendChild(this.num('em-lumpmonth', 'One-off paid at instalment', 13,
      { min: 1, step: 1, key: 'fLumpMonth', hint: 'instalment number' }));
    controls.appendChild(this.num('em-step', 'Extra every month ' + RUPEE, 0,
      { min: 0, step: 1000, key: 'fStep', wide: true }));
    controls.appendChild(this.num('em-stepmonth', 'Recurring from instalment', 13,
      { min: 1, step: 1, key: 'fStepMonth', hint: 'instalment number' }));
    p.appendChild(controls);

    this.prepayCards = E('div', 'em-cards');
    p.appendChild(this.prepayCards);
    this.prepayNote = E('div', 'em-note');
    p.appendChild(this.prepayNote);

    p.appendChild(E('h3', 'em-h', 'What is still owed, month by month'));
    p.appendChild(this.chart('prepay'));
    p.appendChild(legend([
      [C.faint, 'No prepayment'],
      [C.good, 'Cut the tenure'],
      [C.violet, 'Cut the EMI']
    ]));

    var row = E('div', 'em-btnrow');
    row.appendChild(this.button('CSV — cut the tenure', function () {
      self.exportCsv('prepayTenure', 'emi-schedule-cut-tenure.csv');
    }));
    row.appendChild(this.button('CSV — cut the EMI', function () {
      self.exportCsv('prepayEmi', 'emi-schedule-cut-emi.csv');
    }));
    p.appendChild(row);
    return p;
  };

  /* ---- panel: rate change ------------------------------------------------ */

  EmiLab.prototype.buildRatePanel = function () {
    var self = this;
    var p = E('div', 'em-panel');
    p.appendChild(E('p', 'em-lede',
      'A floating-rate loan is repriced whenever the benchmark moves. When the ' +
      'rate goes up the lender has two ways to absorb it, and the one it picks ' +
      'without asking is to keep your instalment exactly where it is and quietly ' +
      'add months to the end. Nothing about your monthly payment changes, so ' +
      'most people never notice.'));

    var controls = E('div', 'em-controls');
    controls.appendChild(this.num('em-newrate', 'New rate % a year', 9.6,
      { min: 0, max: 60, step: 0.05, decimal: true, key: 'fNewRate' }));
    controls.appendChild(this.num('em-ratemonth', 'Repriced at instalment', 25,
      { min: 1, step: 1, key: 'fRateMonth', hint: 'instalment number' }));
    p.appendChild(controls);

    this.rateCards = E('div', 'em-cards');
    p.appendChild(this.rateCards);
    this.rateNote = E('div', 'em-note');
    p.appendChild(this.rateNote);

    p.appendChild(E('h3', 'em-h', 'What is still owed, month by month'));
    p.appendChild(this.chart('rate'));
    p.appendChild(legend([
      [C.faint, 'Rate never changed'],
      [C.interest, 'Same EMI, longer tenure'],
      [C.good, 'Higher EMI, same end date']
    ]));

    var row = E('div', 'em-btnrow');
    row.appendChild(this.button('CSV — longer tenure', function () {
      self.exportCsv('rateTenure', 'emi-schedule-longer-tenure.csv');
    }));
    row.appendChild(this.button('CSV — higher EMI', function () {
      self.exportCsv('rateEmi', 'emi-schedule-higher-emi.csv');
    }));
    p.appendChild(row);
    return p;
  };

  /* ---- panel: compare ---------------------------------------------------- */

  EmiLab.prototype.buildComparePanel = function () {
    var p = E('div', 'em-panel');
    p.appendChild(E('p', 'em-lede',
      'A rate is not a price. The fee is money you borrowed and never received, ' +
      'so it makes the loan more expensive than its headline rate says. The last ' +
      'row prices the whole cashflow instead: what actually reached your account ' +
      'against what actually leaves it, every month, until the loan closes.'));

    var two = E('div', 'em-two');

    var a = E('div');
    a.appendChild(E('h3', 'em-h', 'Loan A'));
    var ca = E('div', 'em-controls');
    ca.appendChild(this.num('em-a-principal', 'Amount ' + RUPEE, 3000000,
      { min: 1000, step: 10000, key: 'fAP', wide: true, aria: 'Loan A amount ' + RUPEE }));
    ca.appendChild(this.num('em-a-rate', 'Rate %', 8.6,
      { min: 0, max: 60, step: 0.05, decimal: true, key: 'fAR', aria: 'Loan A rate %' }));
    ca.appendChild(this.num('em-a-years', 'Years', 20,
      { min: 1, max: 40, step: 1, key: 'fAY', aria: 'Loan A years' }));
    ca.appendChild(this.num('em-a-fee', 'Fees ' + RUPEE, 10000,
      { min: 0, step: 1000, key: 'fAF', aria: 'Loan A fees ' + RUPEE,
        hint: 'processing, legal, valuation, with GST' }));
    a.appendChild(ca);
    a.appendChild(this.compareRowsA = E('div', 'em-rows'));
    two.appendChild(a);

    var b = E('div');
    b.appendChild(E('h3', 'em-h', 'Loan B'));
    var cb = E('div', 'em-controls');
    cb.appendChild(this.num('em-b-principal', 'Amount ' + RUPEE, 3000000,
      { min: 1000, step: 10000, key: 'fBP', wide: true, aria: 'Loan B amount ' + RUPEE }));
    cb.appendChild(this.num('em-b-rate', 'Rate %', 8.35,
      { min: 0, max: 60, step: 0.05, decimal: true, key: 'fBR', aria: 'Loan B rate %' }));
    cb.appendChild(this.num('em-b-years', 'Years', 20,
      { min: 1, max: 40, step: 1, key: 'fBY', aria: 'Loan B years' }));
    cb.appendChild(this.num('em-b-fee', 'Fees ' + RUPEE, 75000,
      { min: 0, step: 1000, key: 'fBF', aria: 'Loan B fees ' + RUPEE,
        hint: 'processing, legal, valuation, with GST' }));
    b.appendChild(cb);
    b.appendChild(this.compareRowsB = E('div', 'em-rows'));
    two.appendChild(b);
    p.appendChild(two);

    this.compareNote = E('div', 'em-note');
    p.appendChild(this.compareNote);

    p.appendChild(E('h3', 'em-h', 'Everything that leaves your account'));
    p.appendChild(this.chart('compare', '180px'));
    p.appendChild(legend([
      [C.principal, 'The money you borrowed'],
      [C.interest, 'Interest'],
      [C.fee, 'Fees']
    ]));
    return p;
  };

  /* ---- panel: tax -------------------------------------------------------- */

  EmiLab.prototype.buildTaxPanel = function () {
    var self = this;
    var p = E('div', 'em-panel');
    p.appendChild(E('p', 'em-lede',
      'This panel is off unless you turn it on, because it only applies to a ' +
      'home loan, only under the old tax regime, and only if the numbers below ' +
      'match your actual return. It splits the schedule into financial years and ' +
      'applies two sections: 24(b) on the interest, and 80C on the principal.'));

    var toggle = E('label', 'em-toggle');
    var cb = E('input');
    cb.type = 'checkbox';
    cb.id = 'em-tax-on';
    this.fTaxOn = cb;
    this.watch(cb);
    toggle.appendChild(cb);
    toggle.appendChild(document.createTextNode('This is a home loan and I file under the old regime'));
    p.appendChild(toggle);

    this.taxBody = E('div');
    this.taxBody.className = 'em-off';
    var controls = E('div', 'em-controls');
    controls.style.marginTop = '12px';
    controls.appendChild(this.sel('em-taxuse', 'The property is', [
      ['self', 'Self-occupied'],
      ['let', 'Let out']
    ], 'self', 'fTaxUse'));
    controls.appendChild(this.sel('em-taxslab', 'Marginal slab', [
      ['5', '5%'], ['10', '10%'], ['15', '15%'], ['20', '20%'],
      ['25', '25%'], ['30', '30%']
    ], '30', 'fTaxSlab'));
    controls.appendChild(this.num('em-tax80c', '80C already used ' + RUPEE, 50000,
      { min: 0, max: CAP_80C, step: 5000, key: 'fTax80c', wide: true,
        hint: 'EPF, PPF, insurance, ELSS, tuition fees' }));
    this.taxBody.appendChild(controls);

    this.taxRows = E('div', 'em-rows');
    this.taxBody.appendChild(this.taxRows);
    this.taxTableWrap = E('div', 'em-tablewrap');
    this.taxTableWrap.tabIndex = 0;
    this.taxTableWrap.style.marginTop = '12px';
    this.taxBody.appendChild(this.taxTableWrap);
    p.appendChild(this.taxBody);

    var honest = E('div', 'em-note is-warn');
    honest.appendChild(E('p', null,
      'Confirm every one of these against the current year before you rely on ' +
      'it. This is arithmetic, not advice, and I am not a tax professional.'));
    honest.appendChild(E('p', null,
      'The ceilings are hard-coded: ' + money(CAP_24B) + ' under 24(b) for a ' +
      'self-occupied house, ' + money(CAP_80C) + ' under 80C for everything in ' +
      'that basket together, and four per cent cess on the tax saved. Budgets ' +
      'move those numbers. The new regime, which has been the default since ' +
      'FY 2023-24, gives you neither of them on a self-occupied house.'));
    honest.appendChild(E('p', null,
      'What is not modelled: pre-construction interest, which is claimed in five ' +
      'equal instalments after possession; the 80EE and 80EEA additional ' +
      'deductions; joint ownership, where each co-borrower claims separately; ' +
      'surcharge; and the five-year lock on 80C principal, which is reversed if ' +
      'you sell before it. Prepayments are excluded from the 80C column here, ' +
      'and the schedule used is the plain one with no prepayment in it.'));
    p.appendChild(honest);

    /* Dimming a panel without disabling what is inside it is a trap: the
       controls stay in the tab order, so a keyboard visitor lands in a set of
       fields the page has just said do not apply. The class is the visual
       half; `disabled` is the half that matters. */
    this.taxFields = [this.fTaxUse, this.fTaxSlab, this.fTax80c];
    cb.addEventListener('change', function () { self.setTaxEnabled(cb.checked); });
    this.setTaxEnabled(false);
    return p;
  };

  EmiLab.prototype.setTaxEnabled = function (on) {
    this.taxBody.className = on ? '' : 'em-off';
    for (var i = 0; i < this.taxFields.length; i++) this.taxFields[i].disabled = !on;
  };

  /* ======================================================================== */
  /*  7. READ, COMPUTE, RENDER                                                */
  /* ======================================================================== */

  function readNum(input, fallback) {
    var v = parseFloat(input.value);
    return isFinite(v) ? v : fallback;
  }

  EmiLab.prototype.readLoan = function () {
    var principal = readNum(this.fPrincipal, NaN);
    var annual = readNum(this.fRate, NaN);
    var years = readNum(this.fYears, NaN);
    var extra = readNum(this.fExtraMonths, 0);
    var months = Math.round(years * 12 + extra);
    var errors = [];
    if (!(principal > 0)) errors.push('The loan amount has to be a positive number.');
    if (!(annual >= 0)) errors.push('The interest rate cannot be negative.');
    if (annual > 60) errors.push('A rate above 60% a year is almost certainly a typing slip.');
    if (!(months > 0)) errors.push('The tenure has to be at least one month.');
    if (months > 600) errors.push('A tenure beyond fifty years is past anything a lender writes.');
    return {
      principal: principal,
      annual: annual,
      monthly: annual / 1200,
      months: months,
      startMonth: Math.min(11, Math.max(0, Math.round(readNum(this.fStartMonth, 0)))),
      startYear: Math.round(readNum(this.fStartYear, new Date().getFullYear())),
      errors: errors
    };
  };

  /* Typing "3000000" produces seven intermediate loans, six of which nobody
     wants rendered. The wait is short enough to feel immediate and long enough
     that a 240-row table is only built once. */
  EmiLab.prototype.schedule = function () {
    var self = this;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.compute(); }, 140);
  };

  EmiLab.prototype.compute = function () {
    var loan = this.readLoan();
    if (loan.errors.length) {
      this.model = null;
      this.errorBox.hidden = false;
      clear(this.errorBox);
      for (var i = 0; i < loan.errors.length; i++) {
        this.errorBox.appendChild(E('p', null, loan.errors[i]));
      }
      this.emiValue.textContent = '—';
      this.emiNote.textContent = 'Fix the loan above and the numbers come back.';
      this.live.textContent = loan.errors[0];
      return;
    }
    this.errorBox.hidden = true;

    var base = baseline(loan);
    var model = { loan: loan, base: base };

    var plan = {
      lumpAmount: Math.max(0, readNum(this.fLump, 0)),
      lumpMonth: Math.max(1, Math.round(readNum(this.fLumpMonth, 1))),
      stepAmount: Math.max(0, readNum(this.fStep, 0)),
      stepMonth: Math.max(1, Math.round(readNum(this.fStepMonth, 1)))
    };
    model.plan = plan;
    model.prepayTenure = prepayScenario(loan, base.startEmi, plan, 'tenure');
    model.prepayEmi = prepayScenario(loan, base.startEmi, plan, 'emi');

    var change = {
      annual: Math.max(0, readNum(this.fNewRate, loan.annual)),
      month: Math.max(1, Math.round(readNum(this.fRateMonth, 1)))
    };
    model.change = change;
    model.rateTenure = rateScenario(loan, base.startEmi, change, 'tenure');
    model.rateEmi = rateScenario(loan, base.startEmi, change, 'emi');

    model.compare = {
      a: this.priceLoan(this.fAP, this.fAR, this.fAY, this.fAF),
      b: this.priceLoan(this.fBP, this.fBR, this.fBY, this.fBF)
    };

    this.model = model;
    this.render();
  };

  EmiLab.prototype.priceLoan = function (fp, fr, fy, ff) {
    var principal = readNum(fp, NaN);
    var annual = readNum(fr, NaN);
    var months = Math.round(readNum(fy, NaN) * 12);
    var fee = Math.max(0, readNum(ff, 0));
    if (!(principal > 0) || !(annual >= 0) || !(months > 0) || annual > 60 || months > 600) {
      return null;
    }
    var rate = annual / 1200;
    var emi = Math.round(emiFor(principal, rate, months));
    var res = amortise({
      principal: principal, emi: emi, rateAt: flatRate(rate), maxMonths: months + 6
    });
    var net = principal - fee;
    var irr = irrMonthly(net, res.rows);
    return {
      principal: principal, annual: annual, months: res.months, fee: fee,
      emi: emi, res: res,
      totalInterest: res.totalInterest,
      totalOut: r2(res.totalPaid + fee),
      cost: r2(res.totalInterest + fee),
      effective: annualise(irr)
    };
  };

  EmiLab.prototype.render = function () {
    var m = this.model;
    if (!m) return;
    var base = m.base;

    this.emiValue.textContent = money(base.startEmi);
    this.emiNote.textContent = 'for ' + tenureWords(base.months) + ' · ' +
      money(base.totalInterest) + ' of interest in total';
    this.live.textContent = 'Instalment ' + money(base.startEmi) + ' a month for ' +
      tenureWords(base.months) + '. Total interest ' + money(base.totalInterest) +
      ', which is ' + pct(base.totalInterest / m.loan.principal * 100) +
      ' of the amount borrowed.';

    this.renderLoan();
    this.renderPrepay();
    this.renderRate();
    this.renderCompare();
    this.renderTax();
    this.draw();
  };

  EmiLab.prototype.draw = function () {
    var m = this.model;
    if (!m) return;
    /* A hidden canvas has a clientWidth of zero, so drawing into one produces
       a 260-pixel stub that stays wrong when the tab is shown. Only the
       visible tab is drawn, and setTab redraws on the way in. */
    if (this.tab === 'loan') {
      this.charts.split.split(m.base.rows, crossoverMonth(m.base.rows));
    } else if (this.tab === 'prepay') {
      this.charts.prepay.balances([
        { rows: m.base.rows, colour: C.faint, width: 1.4, dash: [5, 4] },
        { rows: m.prepayTenure.rows, colour: C.good },
        { rows: m.prepayEmi.rows, colour: C.violet }
      ]);
    } else if (this.tab === 'rate') {
      this.charts.rate.balances([
        { rows: m.base.rows, colour: C.faint, width: 1.4, dash: [5, 4] },
        { rows: m.rateTenure.rows, colour: C.interest },
        { rows: m.rateEmi.rows, colour: C.good }
      ]);
    } else if (this.tab === 'compare') {
      var items = [];
      if (m.compare.a) items.push(costItem('Loan A', m.compare.a));
      if (m.compare.b) items.push(costItem('Loan B', m.compare.b));
      this.charts.compare.costBars(items);
    }
  };

  function costItem(label, priced) {
    return {
      label: label,
      total: priced.totalOut,
      parts: [
        { value: priced.principal, colour: C.principal },
        { value: priced.totalInterest, colour: C.interest },
        { value: priced.fee, colour: C.fee }
      ]
    };
  }

  /* ---- render: the instalment -------------------------------------------- */

  EmiLab.prototype.renderLoan = function () {
    var m = this.model, loan = m.loan, base = m.base;
    var f = Math.pow(1 + loan.monthly, loan.months);
    var exact = emiFor(loan.principal, loan.monthly, loan.months);

    var lines;
    if (loan.monthly > 0) {
      lines = [
        'EMI  =  P × r × (1 + r)ⁿ  ÷  ((1 + r)ⁿ − 1)',
        '',
        'P         = ' + money(loan.principal) + '   the amount actually borrowed',
        'r         = ' + loan.monthly.toFixed(7) + '   ' + pct(loan.annual, 2) +
          ' a year ÷ 12, as a decimal',
        'n         = ' + loan.months + '   months (' + tenureWords(loan.months) + ')',
        '(1 + r)ⁿ = ' + f.toFixed(6),
        '',
        'EMI       = ' + money2(exact) + ' → rounded to ' + money(base.startEmi),
        '',
        'The last instalment is ' + money2(base.lastEmi) + ', not the EMI:',
        'it is whatever clears the balance after the rounding above.'
      ];
    } else {
      lines = [
        'At zero interest the formula collapses to a division:',
        '',
        'EMI  =  P ÷ n  =  ' + money(loan.principal) + ' ÷ ' + loan.months +
          '  =  ' + money(base.startEmi),
        '',
        'Worth seeing once, because it is the only case where the amount you',
        'repay does not depend on how long you take.'
      ];
    }
    this.formula.textContent = lines.join('\n');

    var rows = base.rows;
    var first = rows[0];
    var cross = crossoverMonth(rows);
    var half = paidByMonth(rows, Math.ceil(loan.months / 2));

    clear(this.loanRows);
    this.loanRows.appendChild(rowLine('Monthly instalment', money(base.startEmi)));
    this.loanRows.appendChild(rowLine('Number of instalments', base.months + ' · ' +
      tenureWords(base.months)));
    this.loanRows.appendChild(rowLine('Total interest', money(base.totalInterest), 'is-warn'));
    this.loanRows.appendChild(rowLine('Total you repay', money(base.totalPaid)));
    this.loanRows.appendChild(rowLine('Interest as a share of the amount borrowed',
      pct(base.totalInterest / loan.principal * 100), 'is-warn'));
    this.loanRows.appendChild(rowLine('Interest inside the first instalment',
      money2(first.interest) + ' of ' + money(first.emi) + '  (' +
      pct(first.interest / first.emi * 100) + ')', 'is-warn'));
    this.loanRows.appendChild(rowLine('Principal inside the first instalment',
      money2(first.principal) + '  (' + pct(first.principal / first.emi * 100) + ')'));
    this.loanRows.appendChild(rowLine('Interest paid in the first year',
      money(interestInFirst(rows, 12))));
    this.loanRows.appendChild(rowLine('Debt cleared by the halfway point',
      money(half.principal) + ' of ' + money(loan.principal) + '  (' +
      pct(half.principal / loan.principal * 100) + ')'));

    clear(this.loanNote);
    /* cross === 1 takes the second branch deliberately. "Principal overtakes
       interest at instalment 1" is true and useless, and the sentence that
       follows it — about everything to the left of the line — describes an
       empty region. A short or cheap loan has no crossover story to tell. */
    if (cross > 1) {
      this.loanNote.appendChild(E('p', null,
        'Principal only overtakes interest at instalment ' + cross + ', which is ' +
        tenureWords(cross) + ' in — ' +
        pct(cross / base.months * 100, 0) + ' of the way through the loan. ' +
        'Everything to the left of that dashed line is a payment that was mostly rent on the money.'));
    } else {
      this.loanNote.appendChild(E('p', null,
        'Principal is the larger half of every instalment from the very first ' +
        'month, which is what a short or low-rate loan looks like.'));
    }
    this.loanNote.appendChild(E('p', null,
      'By the halfway point of the tenure you have handed over ' +
      money(half.interest) + ' in interest and cleared ' +
      pct(half.principal / loan.principal * 100, 0) + ' of the debt. That gap is ' +
      'the reason a prepayment made early is worth several times the same money ' +
      'paid late.'));

    this.describe('split', 'Stacked area chart of every instalment. Interest starts at ' +
      money(first.interest) + ' of the ' + money(first.emi) + ' instalment and falls to ' +
      'nearly nothing by month ' + base.months + '; principal rises to fill the rest. ' +
      (cross ? 'The two cross at instalment ' + cross + '.' : ''));

    this.renderSchedule();
  };

  EmiLab.prototype.renderSchedule = function () {
    var m = this.model;
    var grain = this.fGrain.value;
    var rows = m.base.rows;
    var loan = m.loan;
    clear(this.scheduleWrap);

    var table = E('table', 'em-table');
    var thead = E('thead');
    var htr = E('tr');
    var heads = grain === 'year'
      ? ['Year', 'Instalments', 'Interest', 'Principal', 'Balance at the end']
      : ['#', 'Month', 'Instalment', 'Interest', 'Principal', 'Balance'];
    heads.forEach(function (h) { htr.appendChild(E('th', null, h)); });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = E('tbody');
    var i, tr;
    if (grain === 'year') {
      var y = 0;
      while (y * 12 < rows.length) {
        var interest = 0, principal = 0, count = 0, last = null;
        for (i = y * 12; i < Math.min(rows.length, y * 12 + 12); i++) {
          interest += rows[i].interest;
          principal += rows[i].principal + rows[i].extra;
          last = rows[i];
          count++;
        }
        tr = E('tr');
        tr.appendChild(E('td', null, 'Year ' + (y + 1)));
        tr.appendChild(E('td', null, String(count)));
        tr.appendChild(E('td', 'em-td-int', money(interest)));
        tr.appendChild(E('td', 'em-td-pri', money(principal)));
        tr.appendChild(E('td', null, money(last.closing)));
        tbody.appendChild(tr);
        y++;
      }
    } else {
      for (i = 0; i < rows.length; i++) {
        tr = E('tr');
        tr.appendChild(E('td', null, String(rows[i].m)));
        tr.appendChild(E('td', null, monthLabel(loan.startMonth, loan.startYear, rows[i].m)));
        tr.appendChild(E('td', null, money(rows[i].emi)));
        tr.appendChild(E('td', 'em-td-int', money(rows[i].interest)));
        tr.appendChild(E('td', 'em-td-pri', money(rows[i].principal)));
        tr.appendChild(E('td', null, money(rows[i].closing)));
        tbody.appendChild(tr);
      }
    }
    table.appendChild(tbody);
    this.scheduleWrap.appendChild(table);
    this.scheduleWrap.setAttribute('aria-label',
      'Amortisation schedule, ' + (grain === 'year' ? 'one row per year' : 'one row per instalment'));
  };

  /* ---- render: prepayment ------------------------------------------------ */

  EmiLab.prototype.renderPrepay = function () {
    var m = this.model, base = m.base, plan = m.plan;
    var tenure = m.prepayTenure, emiMode = m.prepayEmi;
    var savedTenure = r2(base.totalInterest - tenure.totalInterest);
    var savedEmi = r2(base.totalInterest - emiMode.totalInterest);
    var monthsSaved = base.months - tenure.months;
    /* The instalment the month AFTER the last recast — the number that lands
       on the statement. Deliberately not the final row, which is the clearing
       payment and is a different figure entirely; showing that one as "your
       new EMI" would read as a bug. */
    var i, settled = base.startEmi;
    for (i = 0; i + 2 < emiMode.rows.length; i++) {
      if (emiMode.rows[i].extra > 0) settled = emiMode.rows[i + 1].emi;
    }

    clear(this.prepayCards);
    var nothing = !(plan.lumpAmount > 0) && !(plan.stepAmount > 0);

    var cardA = E('div', 'em-card' + (!nothing && savedTenure >= savedEmi ? ' is-best' : ''));
    cardA.appendChild(E('h4', 'em-card-h', 'Cut the tenure'));
    cardA.appendChild(E('p', 'em-card-sub',
      'The instalment stays at ' + money(base.startEmi) + '. The loan simply ends sooner.'));
    cardA.appendChild(E('strong', 'em-card-big', money(savedTenure) + ' of interest saved'));
    var rowsA = E('div', 'em-rows');
    rowsA.appendChild(rowLine('Loan closes after', tenureWords(tenure.months)));
    rowsA.appendChild(rowLine('Months removed', monthsSaved > 0 ? String(monthsSaved) + ' (' +
      tenureWords(monthsSaved) + ')' : 'none', monthsSaved > 0 ? 'is-good' : ''));
    rowsA.appendChild(rowLine('Total interest', money(tenure.totalInterest)));
    cardA.appendChild(rowsA);
    this.prepayCards.appendChild(cardA);

    var cardB = E('div', 'em-card' + (!nothing && savedEmi > savedTenure ? ' is-best' : ''));
    cardB.appendChild(E('h4', 'em-card-h', 'Cut the EMI'));
    cardB.appendChild(E('p', 'em-card-sub',
      'The end date stays where it was. The instalment is recomputed over whatever term is left.'));
    cardB.appendChild(E('strong', 'em-card-big', money(savedEmi) + ' of interest saved'));
    var rowsB = E('div', 'em-rows');
    rowsB.appendChild(rowLine('Loan closes after', tenureWords(emiMode.months)));
    rowsB.appendChild(rowLine('Instalment after the recast', money(settled)));
    rowsB.appendChild(rowLine('Total interest', money(emiMode.totalInterest)));
    cardB.appendChild(rowsB);
    this.prepayCards.appendChild(cardB);

    clear(this.prepayNote);
    if (nothing) {
      this.prepayNote.className = 'em-note';
      this.prepayNote.appendChild(E('p', null,
        'Put an amount in one of the two fields above. A one-off is a bonus or a ' +
        'maturing deposit; the recurring one is a raise you decide not to spend.'));
    } else {
      var gap = r2(savedTenure - savedEmi);
      this.prepayNote.className = 'em-note ' + (gap > 0 ? 'is-good' : 'is-warn');
      var extraPaid = tenure.totalExtra;
      this.prepayNote.appendChild(E('p', null,
        'The same ' + money(extraPaid) + ' of extra money, two different answers. ' +
        (gap > 0
          ? 'Cutting the tenure saves ' + money(gap) + ' more than cutting the EMI — ' +
            (savedEmi > 0 ? (savedTenure / savedEmi).toFixed(1) + ' times as much.' :
             'the EMI route saves almost nothing here.')
          : 'On this loan the two are within ' + money(Math.abs(gap)) +
            ' of each other, which happens when the prepayment lands close to the end.')));
      this.prepayNote.appendChild(E('p', null,
        'The mechanism is not complicated: interest is charged on the balance, so a ' +
        'rupee taken off the balance early stops accruing interest for every month ' +
        'that was left. Cutting the EMI hands part of that saving straight back by ' +
        'keeping the debt alive for the full original term.'));
      this.prepayNote.appendChild(E('p', null,
        'Two things this does not know about your loan: whether there is a ' +
        'prepayment charge (on a floating-rate loan to an individual there ' +
        'generally is not, on a fixed-rate one there generally is), and whether ' +
        'the money would earn more somewhere else. Beating a home loan rate after ' +
        'tax is possible; beating a personal loan rate is not.'));
    }

    this.describe('prepay', 'Outstanding balance over time. Without prepayment the balance ' +
      'reaches zero after ' + tenureWords(base.months) + '. Cutting the tenure reaches zero after ' +
      tenureWords(tenure.months) + '. Cutting the EMI reaches zero after ' +
      tenureWords(emiMode.months) + '.');
  };

  /* ---- render: rate change ----------------------------------------------- */

  EmiLab.prototype.renderRate = function () {
    var m = this.model, base = m.base, change = m.change;
    var ext = m.rateTenure, up = m.rateEmi;
    var rising = change.annual > m.loan.annual;

    clear(this.rateCards);

    var cardA = E('div', 'em-card');
    cardA.appendChild(E('h4', 'em-card-h', 'What the lender does by default'));
    cardA.appendChild(E('p', 'em-card-sub',
      'Instalment untouched at ' + money(base.startEmi) + '. The tenure absorbs the change.'));
    var rowsA = E('div', 'em-rows');
    if (ext.negative) {
      cardA.appendChild(E('strong', 'em-card-big is-cost', 'This loan no longer amortises'));
      rowsA.appendChild(rowLine('Interest each month', 'more than the instalment', 'is-warn'));
      rowsA.appendChild(rowLine('Balance', 'grows instead of falling', 'is-warn'));
    } else if (ext.capped) {
      cardA.appendChild(E('strong', 'em-card-big is-cost', 'Longer than a hundred years'));
      rowsA.appendChild(rowLine('Tenure', 'past the ' + MAX_MONTHS + '-month limit'));
    } else {
      var added = ext.months - base.months;
      cardA.appendChild(E('strong', 'em-card-big is-cost',
        (added >= 0 ? '+' : '') + tenureWords(Math.abs(added)) +
        (added >= 0 ? ' added' : ' removed')));
      rowsA.appendChild(rowLine('Loan now runs for', tenureWords(ext.months)));
      rowsA.appendChild(rowLine('Total interest', money(ext.totalInterest), 'is-warn'));
      rowsA.appendChild(rowLine('Extra interest against no change',
        money(r2(ext.totalInterest - base.totalInterest)), 'is-warn'));
    }
    cardA.appendChild(rowsA);
    this.rateCards.appendChild(cardA);

    var cardB = E('div', 'em-card' + (!ext.negative && !ext.capped &&
      up.totalInterest < ext.totalInterest ? ' is-best' : ''));
    cardB.appendChild(E('h4', 'em-card-h', 'Keep the end date, raise the EMI'));
    cardB.appendChild(E('p', 'em-card-sub',
      'You have to ask for this. The loan finishes on the day it always would have.'));
    var newEmi = 0, k;
    for (k = 0; k < up.rows.length; k++) {
      if (up.rows[k].m >= change.month) { newEmi = up.rows[k].emi; break; }
    }
    if (!newEmi && up.rows.length) newEmi = up.rows[up.rows.length - 1].emi;
    var delta = r2(newEmi - base.startEmi);
    cardB.appendChild(E('strong', 'em-card-big',
      (delta >= 0 ? '+' : '−') + money(Math.abs(delta)) + ' a month'));
    var rowsB = E('div', 'em-rows');
    rowsB.appendChild(rowLine('New instalment', money(newEmi)));
    rowsB.appendChild(rowLine('Loan still runs for', tenureWords(up.months)));
    rowsB.appendChild(rowLine('Total interest', money(up.totalInterest)));
    rowsB.appendChild(rowLine('Extra interest against no change',
      money(r2(up.totalInterest - base.totalInterest))));
    cardB.appendChild(rowsB);
    this.rateCards.appendChild(cardB);

    clear(this.rateNote);
    if (change.month > base.months) {
      this.rateNote.className = 'em-note is-warn';
      this.rateNote.appendChild(E('p', null,
        'Month ' + change.month + ' is after this loan has already closed, so ' +
        'nothing changes. Pick a month between 1 and ' + base.months + '.'));
    } else if (ext.negative) {
      this.rateNote.className = 'em-note is-bad';
      this.rateNote.appendChild(E('p', null,
        'At ' + pct(change.annual, 2) + ' the interest charged each month is larger ' +
        'than the instalment, so extending the tenure cannot work at any length: ' +
        'the balance grows every month instead of shrinking. A lender in this ' +
        'position has no choice but to raise the EMI or ask for a lump sum, and it ' +
        'is the point at which the silent option runs out.'));
    } else if (rising) {
      var addedM = ext.months - base.months;
      this.rateNote.className = 'em-note is-warn';
      this.rateNote.appendChild(E('p', null,
        'The rate moving from ' + pct(m.loan.annual, 2) + ' to ' + pct(change.annual, 2) +
        ' at instalment ' + change.month + ' adds ' + tenureWords(addedM) +
        ' to the loan if the instalment is left alone, and ' +
        money(r2(ext.totalInterest - base.totalInterest)) + ' of interest with it. ' +
        'Nothing about the payment you make changes, which is exactly why this is ' +
        'the option that gets applied without a conversation.'));
      this.rateNote.appendChild(E('p', null,
        'Paying ' + money(Math.abs(delta)) + ' more a month instead costs ' +
        money(r2(ext.totalInterest - up.totalInterest)) + ' less over the life of ' +
        'the loan. Check your statement after any rate change: the tenure is the ' +
        'field that moved.'));
    } else {
      this.rateNote.className = 'em-note is-good';
      this.rateNote.appendChild(E('p', null,
        'The rate falls here, and the lender’s default works the same way in ' +
        'reverse — the instalment is left alone and the tenure shortens, which ' +
        'is good for you and equally unannounced. The second card is what happens ' +
        'if you ask for the cut to come off the monthly payment instead: less relief ' +
        'overall, more cash in hand now.'));
    }

    this.describe('rate', 'Outstanding balance over time. Without the rate change the ' +
      'balance reaches zero after ' + tenureWords(base.months) + '. With the same instalment ' +
      'and a longer tenure it reaches zero after ' +
      (ext.negative ? 'never, because the balance grows' : tenureWords(ext.months)) +
      '. With a higher instalment it reaches zero after ' + tenureWords(up.months) + '.');
  };

  /* ---- render: compare --------------------------------------------------- */

  EmiLab.prototype.renderCompare = function () {
    var m = this.model;
    this.fillCompare(this.compareRowsA, m.compare.a);
    this.fillCompare(this.compareRowsB, m.compare.b);

    var a = m.compare.a, b = m.compare.b;
    clear(this.compareNote);
    if (!a || !b) {
      this.compareNote.className = 'em-note is-warn';
      this.compareNote.appendChild(E('p', null,
        'Both loans need a positive amount, a rate under 60 per cent and a tenure ' +
        'between one and fifty years before they can be compared.'));
      this.describe('compare', 'Cost comparison, not yet drawn.');
      return;
    }
    var lowerRate = a.annual <= b.annual ? 'A' : 'B';
    var cheapRupees = a.cost <= b.cost ? 'A' : 'B';
    var gapRupees = Math.abs(r2(a.cost - b.cost));
    var solved = a.effective != null && b.effective != null;
    var cheapReal = solved ? (a.effective <= b.effective ? 'A' : 'B') : cheapRupees;

    this.compareNote.className = 'em-note ' + (cheapReal === lowerRate ? 'is-good' : 'is-warn');
    if (solved) {
      this.compareNote.appendChild(E('p', null,
        'Loan ' + cheapReal + ' is the cheaper money: ' +
        pct(Math.min(a.effective, b.effective), 2) + ' against ' +
        pct(Math.max(a.effective, b.effective), 2) + ' once the fee is priced as ' +
        'what it is — an amount you borrowed and never received.'));
    }
    if (cheapReal !== lowerRate) {
      this.compareNote.appendChild(E('p', null,
        'Note which one that is. Loan ' + lowerRate + ' has the lower headline rate ' +
        'and is still the dearer loan, because the fee comes out of the money you ' +
        'are borrowing, on day one, at full value. A rate you can advertise and a ' +
        'price you actually pay are not the same object.'));
    }
    this.compareNote.appendChild(E('p', null,
      'Added up as plain rupees instead, loan ' + cheapRupees + ' is ' +
      money(gapRupees) + ' cheaper.' +
      (solved && cheapRupees !== cheapReal
        ? ' The two answers disagree, and the disagreement is the interesting part: ' +
          'loan ' + cheapRupees + ' moves ' + money(Math.abs(r2(a.fee - b.fee))) +
          ' more onto day one in exchange for interest saved slowly over the next ' +
          tenureWords(Math.max(a.months, b.months)) + '. Summing those as if they ' +
          'were the same money says one thing; discounting them, which is what the ' +
          'effective rate does, says the other. The second is the arithmetic your ' +
          'lender uses on its own side of the deal.'
        : ' Both measures agree here, which is the comfortable case and not the ' +
          'common one once the fees differ much.')));
    this.compareNote.appendChild(E('p', null,
      'The effective rate is the internal rate of return of the real cashflow: for ' +
      'loan A, ' + money(r2(a.principal - a.fee)) + ' reaching your account against ' +
      'every instalment leaving it, solved for the rate that balances the two. What ' +
      'it cannot see: anything paid outside the loan, such as insurance sold ' +
      'alongside it, and any charge that only shows up later, such as a prepayment ' +
      'penalty. Ask for both in writing before you sign either.'));

    this.describe('compare', 'Two stacked bars of total outgoings. Loan A: ' +
      money(a.totalOut) + ' in total, of which ' + money(a.totalInterest) +
      ' is interest and ' + money(a.fee) + ' is fees. Loan B: ' + money(b.totalOut) +
      ' in total, of which ' + money(b.totalInterest) + ' is interest and ' +
      money(b.fee) + ' is fees.');
  };

  EmiLab.prototype.fillCompare = function (node, priced) {
    clear(node);
    if (!priced) {
      node.appendChild(rowLine('Status', 'check the fields above', 'is-warn'));
      return;
    }
    node.appendChild(rowLine('Monthly instalment', money(priced.emi)));
    node.appendChild(rowLine('Instalments', String(priced.months)));
    node.appendChild(rowLine('Money that reached your account',
      money(r2(priced.principal - priced.fee))));
    node.appendChild(rowLine('Total interest', money(priced.totalInterest), 'is-warn'));
    node.appendChild(rowLine('Fees', money(priced.fee), 'is-warn'));
    node.appendChild(rowLine('Total cost of borrowing', money(priced.cost), 'is-warn'));
    node.appendChild(rowLine('Everything that leaves your account', money(priced.totalOut)));
    node.appendChild(rowLine('Headline rate', pct(priced.annual, 2)));
    node.appendChild(rowLine('Effective rate, fees included',
      priced.effective == null ? 'not solvable' : pct(priced.effective, 2),
      'is-warn'));
  };

  /* ---- render: tax ------------------------------------------------------- */

  EmiLab.prototype.renderTax = function () {
    var m = this.model;
    clear(this.taxRows);
    clear(this.taxTableWrap);
    if (!this.fTaxOn.checked) {
      this.taxRows.appendChild(rowLine('Panel', 'switched off'));
      return;
    }

    var use = this.fTaxUse.value;
    var slab = parseFloat(this.fTaxSlab.value) / 100;
    var used80c = Math.max(0, Math.min(CAP_80C, readNum(this.fTax80c, 0)));
    var room80c = CAP_80C - used80c;
    var years = groupByFy(m.base.rows, m.loan.startMonth, m.loan.startYear);

    var table = E('table', 'em-table');
    var thead = E('thead');
    var htr = E('tr');
    ['Financial year', 'Interest paid', 'Principal repaid', '24(b) claimed',
     '80C claimed', 'Tax saved'].forEach(function (h) {
      htr.appendChild(E('th', null, h));
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = E('tbody');
    var totalSaved = 0, totalCarried = 0, i;
    for (i = 0; i < years.length; i++) {
      var y = years[i];
      /* The same ceiling reaches both cases by two different routes, which is
         why the arithmetic is identical and the wording is not. Self-occupied:
         24(b) itself caps the interest deduction at two lakh. Let out: the
         whole interest is deductible against rental income, but the resulting
         loss under house property can only be set off against other heads up
         to two lakh in a year — the rest is carried forward for eight years,
         which is the `carried` column below and is a deferral, not a loss. */
      var claim24 = Math.min(y.interest, CAP_24B);
      var carried = use === 'let' ? Math.max(0, r2(y.interest - CAP_24B)) : 0;
      var claim80 = Math.min(y.principal, room80c);
      var saved = r2((claim24 + claim80) * slab * (1 + CESS));
      totalSaved = r2(totalSaved + saved);
      totalCarried = r2(totalCarried + carried);
      var tr = E('tr');
      tr.appendChild(E('td', null, fyLabel(y.fy) + (y.months < 12 ? ' (' + y.months + ' mo)' : '')));
      tr.appendChild(E('td', 'em-td-int', money(y.interest)));
      tr.appendChild(E('td', 'em-td-pri', money(y.principal)));
      tr.appendChild(E('td', null, money(claim24)));
      tr.appendChild(E('td', null, money(claim80)));
      tr.appendChild(E('td', null, money(saved)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.taxTableWrap.appendChild(table);
    this.taxTableWrap.setAttribute('aria-label',
      'Deductions by financial year under the old regime');

    this.taxRows.appendChild(rowLine('Financial years covered', String(years.length)));
    this.taxRows.appendChild(rowLine('80C headroom left for the loan',
      money(room80c) + ' a year'));
    this.taxRows.appendChild(rowLine('Tax saved across the whole loan',
      money(totalSaved), 'is-good'));
    this.taxRows.appendChild(rowLine('Interest paid across the whole loan',
      money(m.base.totalInterest), 'is-warn'));
    this.taxRows.appendChild(rowLine('Interest still yours to pay after the saving',
      money(r2(m.base.totalInterest - totalSaved)), 'is-warn'));
    if (use === 'let') {
      this.taxRows.appendChild(rowLine('Loss above the set-off cap, carried forward',
        money(totalCarried)));
    }
    var effective = m.base.totalInterest > 0
      ? (1 - totalSaved / m.base.totalInterest) * m.loan.annual : 0;
    this.taxRows.appendChild(rowLine('Rate after the deduction, very roughly',
      pct(effective, 2)));
  };

  /* ---- CSV --------------------------------------------------------------- */

  EmiLab.prototype.exportCsv = function (which, filename) {
    var m = this.model;
    if (!m) return;
    var res = m[which] || m.base;
    saveText(scheduleCsv(res, m.loan), filename);
  };

  /* ======================================================================== */
  /*  8. SELF-TEST                                                            */
  /* ------------------------------------------------------------------------ */
  /*  Financial arithmetic is exactly the kind that looks right and is not, so  */
  /*  the values below are checked against figures computed independently.     */
  /*  Exposed on window.EMILab so a browser console can run it.                */
  /* ======================================================================== */

  function selfTest() {
    var fails = [];

    /* Textbook annuity: 10 lakh, 10% a year, 12 months. */
    var e = emiFor(1000000, 0.10 / 12, 12);
    if (Math.abs(e - 87915.89) > 0.5) fails.push('12-month EMI expected 87915.89, got ' + e.toFixed(2));

    /* Zero rate is a division and nothing else. */
    if (Math.abs(emiFor(120000, 0, 12) - 10000) > 1e-9) fails.push('zero-rate EMI wrong');

    /* The engine must close the loan in exactly the stated number of months. */
    var loan = { principal: 3000000, annual: 8.6, monthly: 8.6 / 1200, months: 240 };
    var base = baseline(loan);
    if (base.months !== 240) fails.push('baseline closed in ' + base.months + ' months, expected 240');
    if (base.endBalance > 0.005) fails.push('baseline left a balance of ' + base.endBalance);

    /* Total paid must equal principal plus interest, to the paise. */
    var diff = Math.abs(base.totalPaid - (loan.principal + base.totalInterest));
    if (diff > 1) fails.push('paid/interest identity off by ' + diff.toFixed(2));

    /* The annuity present value must reproduce the principal. */
    var pv = pvAnnuity(emiFor(loan.principal, loan.monthly, loan.months), loan.monthly, loan.months);
    if (Math.abs(pv - loan.principal) > 1) fails.push('present value off by ' + (pv - loan.principal).toFixed(2));

    /* Cutting the tenure must never save less than cutting the EMI on the same
       money. This is the claim the whole prepayment tab makes. */
    var plan = { lumpAmount: 200000, lumpMonth: 13, stepAmount: 0, stepMonth: 1 };
    var t = prepayScenario(loan, base.startEmi, plan, 'tenure');
    var q = prepayScenario(loan, base.startEmi, plan, 'emi');
    if (t.totalInterest > q.totalInterest + 1) {
      fails.push('cutting tenure saved less than cutting EMI, which cannot be right');
    }
    if (t.months >= base.months) fails.push('prepayment did not shorten the loan');

    /* With no fee the effective rate must come back as the nominal rate,
       annualised. That is the control on the IRR solver. */
    var irr = irrMonthly(loan.principal, base.rows);
    var eff = annualise(irr);
    var nominal = annualise(loan.monthly);
    if (Math.abs(eff - nominal) > 0.02) {
      fails.push('zero-fee effective rate ' + eff.toFixed(4) + ' should match ' + nominal.toFixed(4));
    }

    /* A fee must push the effective rate above the nominal one. */
    var withFee = annualise(irrMonthly(loan.principal - 50000, base.rows));
    if (!(withFee > eff)) fails.push('a fee did not raise the effective rate');

    /* Indian grouping, which is easy to get subtly wrong. */
    if (groupIndian('3000000') !== '30,00,000') fails.push('grouping: ' + groupIndian('3000000'));
    if (groupIndian('1234') !== '1,234') fails.push('grouping: ' + groupIndian('1234'));
    if (groupIndian('100') !== '100') fails.push('grouping: ' + groupIndian('100'));

    /* Financial years run April to March. */
    if (fyStartYear(3, 2026, 1) !== 2026) fails.push('April 2026 should be FY 2026-27');
    if (fyStartYear(0, 2026, 1) !== 2025) fails.push('January 2026 should be FY 2025-26');

    return { passed: fails.length === 0, failures: fails };
  }

  /* ======================================================================== */
  /*  9. BOOT                                                                 */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('emiviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-emi-mount') || rootEl;
    clear(mount);
    try {
      var lab = new EmiLab(mount);
      window.EMILab = {
        selfTest: selfTest,
        emiFor: emiFor,
        amortise: amortise,
        instance: lab
      };
    } catch (err) {
      var msg = E('p', 'lab-proc-fallback',
        'The loan lab could not start in this browser (' + err.message +
        '). Please tell me, and mention which browser you are using.');
      mount.appendChild(msg);
    }
  }

  if (typeof LabViz !== 'undefined' && LabViz.define) {
    LabViz.define({ id: 'emiviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();

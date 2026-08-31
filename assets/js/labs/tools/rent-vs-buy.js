/* ==========================================================================
   rent-vs-buy.js — two paths through the same years, priced against each other.
   --------------------------------------------------------------------------
   Every rent-versus-buy calculator I have seen puts an EMI next to a rent and
   declares a winner. That comparison is wrong in a way that is not a rounding
   detail: part of the EMI is principal, which is savings, and the rent is not
   the renter's whole position either, because the down payment and the stamp
   duty did not vanish for them. The only comparison that means anything is NET
   WORTH at the end of a stated horizon, with both paths given the same money to
   start and the same money each month.

   So both sides are simulated month by month. The buyer gets a real
   amortisation schedule, maintenance, property tax, insurance, appreciation and
   — if they sell — brokerage and capital gains. The renter gets escalating rent,
   an idle deposit, and a portfolio holding the down payment, the stamp duty and
   whatever the monthly difference is. The investing is symmetric: in any month
   where owning costs less than renting, the BUYER invests the difference at the
   same return. Model it one way only and the answer is rigged before it starts.

   THE HONEST PART, and the reason the page says it twice. Two inputs decide the
   result and nobody knows either of them: property appreciation and investment
   return. Move each by two points and the crossover year moves by many years, or
   stops existing. That is what the sensitivity grid is for, and it is why this
   lab prints no verdict. It prints a number that is true of the assumptions you
   typed, and a grid showing how fast that number stops being true.

   Tax is optional and off by default, because it only applies under the OLD
   regime, the new regime is the default one, and every ceiling in it moves with
   the Finance Act. Nothing is hardcoded to a year: 24(b), the 80C ceiling, the
   80C already spent, the marginal rate and the capital gains rates are all
   fields. This is arithmetic you can check, not tax advice, and it is certainly
   not advice about whether to buy a house.

   Nothing is uploaded. A salary, a rent and a property price are about as
   personal as numbers get, which is why the whole model runs in this tab.
   ========================================================================== */

/* global LabTool */
(function (root) {
  'use strict';

  var out = LabTool.out('tool-out');

  /* Chart ink. Fixed rather than themed, the same decision the loan lab made:
     the drawing surface is its own dark instrument, and the stylesheet gives it
     an opaque dark ground so it does not composite onto a light page. */
  var C = {
    bg: '#020617', grid: 'rgba(28,43,68,0.85)', axis: '#1c2b44',
    faint: '#64748b', ink: '#e2e8f0',
    buy: '#38bdf8', rent: '#fbbf24', cross: '#34d399', zero: '#475569'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";

  /* ---------------------------------------------------------------- format */

  /* Indian digit grouping: last three, then pairs. Lifted from the salary lab
     so the two pages group a lakh the same way. */
  function inr(n) {
    if (!isFinite(n)) return '--';
    var neg = n < -0.5;
    var s = String(Math.round(Math.abs(n)));
    if (s.length > 3) {
      var last3 = s.substr(s.length - 3);
      var rest = s.substr(0, s.length - 3);
      s = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    }
    return (neg ? '-₹' : '₹') + s;
  }

  /* Axis and cell labels. Crores and lakhs, because an axis of eleven digits is
     unreadable and this page is about Indian money. */
  function shortMoney(n) {
    if (!isFinite(n)) return '--';
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    if (a >= 1e7) return sign + '₹' + (a / 1e7).toFixed(a >= 1e8 ? 0 : 2) + ' Cr';
    if (a >= 1e5) return sign + '₹' + (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + ' L';
    if (a >= 1e3) return sign + '₹' + Math.round(a / 1e3) + 'k';
    return sign + '₹' + Math.round(a);
  }

  function pct(x, places) {
    if (!isFinite(x)) return '--';
    return x.toFixed(places === undefined ? 1 : places) + '%';
  }

  /* The output pane is a <pre>, so a long sentence gives it a horizontal
     scrollbar instead of wrapping. Broken on spaces here at a width that fits
     the narrower of the two panes, rather than hoping CSS handles it. */
  function wrapText(text, width) {
    var words = String(text).split(/\s+/), lines = [], line = '', i;
    for (i = 0; i < words.length; i++) {
      if (line && (line + ' ' + words[i]).length > width) { lines.push(line); line = words[i]; }
      else line = line ? line + ' ' + words[i] : words[i];
    }
    if (line) lines.push(line);
    return lines;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function empty(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function field(id) { return document.getElementById(id); }

  function num(id) {
    var f = field(id);
    if (!f) return 0;
    var v = parseFloat(String(f.value).replace(/[,\s₹%]/g, ''));
    return isFinite(v) ? v : 0;
  }

  function checked(id) {
    var f = field(id);
    return !!(f && f.checked);
  }

  function value(id) {
    var f = field(id);
    return f ? f.value : '';
  }

  /* ------------------------------------------------------------ pure maths */

  /* The standard annuity payment, and the zero-rate case it collapses into.

     The isFinite guard is not decoration. Math.pow(1 + i, n) overflows to
     Infinity for a long enough tenure at a high enough rate, and Infinity /
     (Infinity - 1) is NaN, which would have propagated silently through the
     whole schedule and printed a page of "--". The inputs are clamped so this
     cannot be reached from the form, but the function is called from the
     sensitivity grid too, and a guard is cheaper than trusting that. */
  function emiFor(principal, monthlyRate, months) {
    if (principal <= 0 || months <= 0) return 0;
    if (monthlyRate <= 0) return principal / months;
    var g = Math.pow(1 + monthlyRate, months);
    if (!isFinite(g)) return principal * monthlyRate;
    return principal * monthlyRate * g / (g - 1);
  }

  /* Section 10(13A) with rule 2A. It is not a percentage of anything; it is
     three numbers and the smallest one wins. Returned whole so the page can
     show all three, because the interesting part is usually which one binds. */
  function hraTests(hraReceived, salary, rentPaidYear, metroPct) {
    var t1 = Math.max(0, hraReceived);
    var t2 = Math.max(0, rentPaidYear - 0.10 * Math.max(0, salary));
    var t3 = (metroPct / 100) * Math.max(0, salary);
    return {
      received: t1, rentOverTenPct: t2, shareOfSalary: t3,
      exempt: Math.min(t1, Math.min(t2, t3))
    };
  }

  /* The first year at which the buyer is no longer behind. Kept separate from
     the simulation so the self-test can drive it with a synthetic pair.

     `buyerNeverTrails` exists because the first version of this file did not
     have it and was wrong in a way I only found by sweeping the input space.
     I had been treating "buyer ahead at day one" as if it meant "there is no
     crossover to find", which is only true when the buyer then stays ahead.
     Set stamp duty, other one-off costs and the cost to sell all to zero and
     the two paths start dead level; the renter's portfolio then leads for
     thirteen years before the buyer takes it back. In that run the canvas drew
     the crossing at year 14 and the caption underneath it said there was no
     crossover — and the caption is the only version a screen reader gets.
     Ahead at the start, and never behind since, are two different facts, so
     they are two different fields now. */
  function findCrossover(rows) {
    var first = null, flips = 0, y;
    for (y = 1; y < rows.length; y++) {
      var was = rows[y - 1].buyerNet >= rows[y - 1].renterNet;
      var now = rows[y].buyerNet >= rows[y].renterNet;
      if (was !== now) {
        flips++;
        if (!was && now && first === null) first = rows[y].year;
      }
    }
    var startAhead = rows.length ? rows[0].buyerNet >= rows[0].renterNet : false;
    return {
      year: first,
      flips: flips,
      buyerAheadAtStart: startAhead,
      buyerNeverTrails: startAhead && flips === 0,
      buyerAheadAtEnd: rows.length ? rows[rows.length - 1].buyerNet >= rows[rows.length - 1].renterNet : false
    };
  }

  /* Axis ticks that land on round money rather than on 1/6th of the range. */
  function niceTicks(lo, hi, want) {
    if (!(hi > lo)) return [lo];
    var span = hi - lo;
    var step = Math.pow(10, Math.floor(Math.log(span / want) / Math.LN10));
    var mult = span / want / step;
    if (mult > 5) step *= 10;
    else if (mult > 2) step *= 5;
    else if (mult > 1) step *= 2;
    var ticks = [], v = Math.ceil(lo / step) * step, guard = 0;
    while (v <= hi + step * 1e-6 && guard++ < 80) { ticks.push(v); v += step; }
    return ticks;
  }

  /* ------------------------------------------------------------- the model */

  /* One simulation. Everything the page prints comes out of this function, and
     the sensitivity grid calls it twenty-five more times with two fields moved.

     Three passes rather than one, and the reason is the tax block. The 24(b)
     and 80C claims depend on the interest and principal paid across a whole
     financial year, so the year has to be finished before the credit can be
     known, and the credit changes the monthly cash flow, which decides who
     invests what. Amortise first, aggregate the year, then run the money. */
  function simulate(cfg) {
    var monthsTotal = Math.round(cfg.horizon * 12);
    var i = cfg.rate / 100 / 12;
    var n = Math.round(cfg.tenure * 12);
    var loan = Math.max(0, cfg.price * (1 - cfg.downPct / 100));
    var emi = emiFor(loan, i, n);

    var stampCost = cfg.price * cfg.stampPct / 100;
    var downPayment = cfg.price * cfg.downPct / 100;
    var upfrontBuy = downPayment + stampCost + cfg.otherUpfront;

    /* Monthly investment rate from the annual one by the twelfth root, not by
       dividing by twelve. A loan quotes a nominal rate and the lender really
       does charge rate/12 each month; a fund return of 10% a year means 10% a
       year compounded, and rate/12 would quietly hand the renter an extra half
       a per cent. The two conventions differ on purpose and the page says so. */
    var mRate = Math.pow(1 + cfg.invReturn / 100, 1 / 12) - 1;
    var yGrow = 1 + cfg.apprec / 100;
    var yCost = 1 + cfg.costInf / 100;
    var yRent = 1 + cfg.rentEsc / 100;
    var ySal = 1 + cfg.salGrow / 100;

    /* Pass 1 — the amortisation schedule, walked, not approximated. */
    var sched = [], bal = loan, notAmortising = false, m;
    for (m = 1; m <= monthsTotal; m++) {
      var interest = 0, principal = 0, pay = 0;
      if (bal > 0.005 && m <= n) {
        interest = bal * i;
        principal = emi - interest;
        if (principal < 0) { principal = 0; notAmortising = true; }
        if (principal > bal) principal = bal;
        pay = interest + principal;
        bal -= principal;
        if (bal < 0.005) bal = 0;
      }
      sched.push({ pay: pay, interest: interest, principal: principal, balance: bal });
    }

    /* Pass 2 — per-year aggregates and the optional old-regime credits. */
    var years = Math.ceil(monthsTotal / 12);
    var yearInfo = [], y;
    var headroom80c = Math.max(0, cfg.cap80c - cfg.used80c);
    for (y = 1; y <= years; y++) {
      var yInt = 0, yPrin = 0, k;
      for (k = (y - 1) * 12; k < y * 12 && k < sched.length; k++) {
        yInt += sched[k].interest;
        yPrin += sched[k].principal;
      }
      var rentMonth = cfg.rent * Math.pow(yRent, y - 1);
      var rentYear = rentMonth * 12;

      var claim24 = 0, claim80c = 0, eligible80c = 0, buyerSaved = 0;
      var hra = null, renterSaved = 0;
      if (cfg.taxOn) {
        claim24 = Math.min(yInt, cfg.cap24b);
        /* Stamp duty and registration are 80C-eligible in the year they are
           paid, and they compete with the principal for the same ceiling —
           which in year one they usually win outright, leaving the principal
           nothing. Left in because it is real, and because it is the single
           most common reason a first-year 80C claim is smaller than expected. */
        eligible80c = yPrin + (y === 1 ? stampCost : 0);
        claim80c = Math.min(eligible80c, headroom80c);
        buyerSaved = (claim24 + claim80c) * cfg.marginal / 100;

        hra = hraTests(cfg.hraReceived * Math.pow(ySal, y - 1),
                       cfg.salaryHra * Math.pow(ySal, y - 1),
                       rentYear, cfg.metroPct);
        renterSaved = hra.exempt * cfg.marginal / 100;
      }

      yearInfo.push({
        year: y, interest: yInt, principal: yPrin,
        rentMonth: rentMonth, rentYear: rentYear,
        claim24: claim24, claim80c: claim80c, eligible80c: eligible80c,
        buyerSaved: buyerSaved, hra: hra, renterSaved: renterSaved,
        maintMonth: cfg.maint * Math.pow(yCost, y - 1),
        propTaxYear: cfg.propTax * Math.pow(yCost, y - 1),
        insYear: cfg.insurance * Math.pow(yCost, y - 1)
      });
    }

    /* Pass 3 — the money. Two portfolios, because the investing has to be
       symmetric: whichever path costs less in a given month, that side puts the
       difference away at the same return. Basis is tracked alongside the value
       so a capital gains toggle has a gain to tax rather than a balance. */
    var renterPot = Math.max(0, upfrontBuy - cfg.deposit);
    var buyerPot = Math.max(0, cfg.deposit - upfrontBuy);
    var renterBasis = renterPot, buyerBasis = buyerPot;

    var totals = {
      buyerCash: upfrontBuy, renterCash: cfg.deposit,
      interest: 0, principalPaid: 0, emiPaid: 0,
      maint: 0, propTax: 0, insurance: 0,
      rent: 0, buyerTaxSaved: 0, renterTaxSaved: 0,
      renterInvested: renterPot, buyerInvested: buyerPot
    };

    var rows = [];
    rows.push(snapshot(0));

    for (m = 1; m <= monthsTotal; m++) {
      var yi = yearInfo[Math.floor((m - 1) / 12)];
      var s = sched[m - 1];

      var buyOut = s.pay + yi.maintMonth + yi.propTaxYear / 12 + yi.insYear / 12
                   - yi.buyerSaved / 12;
      var rentOut = yi.rentMonth - yi.renterSaved / 12;

      totals.interest += s.interest;
      totals.principalPaid += s.principal;
      totals.emiPaid += s.pay;
      totals.maint += yi.maintMonth;
      totals.propTax += yi.propTaxYear / 12;
      totals.insurance += yi.insYear / 12;
      totals.rent += yi.rentMonth;
      totals.buyerTaxSaved += yi.buyerSaved / 12;
      totals.renterTaxSaved += yi.renterSaved / 12;
      totals.buyerCash += buyOut;
      totals.renterCash += rentOut;

      renterPot *= (1 + mRate);
      buyerPot *= (1 + mRate);
      var diff = buyOut - rentOut;
      if (diff > 0) {
        renterPot += diff; renterBasis += diff; totals.renterInvested += diff;
      } else if (diff < 0) {
        buyerPot += -diff; buyerBasis += -diff; totals.buyerInvested += -diff;
      }

      if (m % 12 === 0) rows.push(snapshot(m / 12));
    }
    if (monthsTotal % 12 !== 0) rows.push(snapshot(monthsTotal / 12));

    /* End-of-year photograph of both positions. Declared after the loop that
       uses it on purpose — it closes over the running portfolio values, which
       is the only way to take the picture without recomputing the schedule. */
    function snapshot(yearAt) {
      var monthAt = Math.round(yearAt * 12);
      var outstanding = monthAt === 0 ? loan
        : (sched[monthAt - 1] ? sched[monthAt - 1].balance : 0);
      var propValue = cfg.price * Math.pow(yGrow, yearAt);

      var sellCost = 0, gain = 0, propTax2 = 0, indexedCost = 0;
      if (cfg.sellAtEnd) {
        sellCost = propValue * cfg.brokerPct / 100;
        indexedCost = (cfg.price + stampCost + cfg.otherUpfront) *
                      Math.pow(1 + cfg.indexPct / 100, yearAt);
        gain = Math.max(0, propValue - sellCost - indexedCost);
        if (cfg.cgtProp) propTax2 = gain * cfg.cgtPropRate / 100;
      }
      var netProperty = propValue - sellCost - outstanding - propTax2;

      var bGain = Math.max(0, buyerPot - buyerBasis);
      var rGain = Math.max(0, renterPot - renterBasis);
      var bTax = cfg.cgtEq ? bGain * cfg.cgtEqRate / 100 : 0;
      var rTax = cfg.cgtEq ? rGain * cfg.cgtEqRate / 100 : 0;

      return {
        year: yearAt,
        propValue: propValue, outstanding: outstanding,
        sellCost: sellCost, propGain: gain, propGainTax: propTax2,
        indexedCost: indexedCost,
        netProperty: netProperty,
        buyerPot: buyerPot, buyerPotNet: buyerPot - bTax, buyerPotTax: bTax,
        renterPot: renterPot, renterPotNet: renterPot - rTax, renterPotTax: rTax,
        buyerNet: netProperty + buyerPot - bTax,
        renterNet: renterPot - rTax + cfg.deposit
      };
    }

    var cross = findCrossover(rows);
    var last = rows[rows.length - 1];

    /* Two ratios that say whether the price and the rent you typed are even
       describing the same building. A yield of 8% or a price-to-rent of 6 is
       not a market, it is a typo, and the page would rather show you that than
       compute twenty years of arithmetic on top of it. */
    var annualRent = cfg.rent * 12;
    var yieldPct = cfg.price > 0 ? annualRent / cfg.price * 100 : 0;
    var priceToRent = annualRent > 0 ? cfg.price / annualRent : 0;

    var firstMonthOwn = sched.length
      ? sched[0].pay + yearInfo[0].maintMonth + yearInfo[0].propTaxYear / 12 +
        yearInfo[0].insYear / 12
      : 0;

    return {
      cfg: cfg, emi: emi, loan: loan, downPayment: downPayment,
      stampCost: stampCost, upfrontBuy: upfrontBuy,
      monthlyRate: i, investMonthlyRate: mRate,
      notAmortising: notAmortising,
      sched: sched, yearInfo: yearInfo, rows: rows,
      totals: totals, cross: cross, last: last,
      yieldPct: yieldPct, priceToRent: priceToRent, firstMonthOwn: firstMonthOwn,
      gap: last.buyerNet - last.renterNet
    };
  }

  /* --------------------------------------------------------------- reading */

  var LIMITS = {
    price: [0, 1e11], downPct: [0, 100], stampPct: [0, 30], rate: [0, 30],
    tenure: [0, 40], horizon: [1, 50], apprec: [-20, 30], costInf: [-20, 30],
    rentEsc: [-20, 30], invReturn: [-20, 40], brokerPct: [0, 20],
    cgtRate: [0, 50], indexPct: [0, 30], marginal: [0, 60], salGrow: [-20, 30]
  };

  function readInputs() {
    var notes = [];
    function bounded(id, key, label) {
      var v = num(id);
      var lo = LIMITS[key][0], hi = LIMITS[key][1];
      if (v < lo) { notes.push(label + ' was clamped up to ' + lo); v = lo; }
      if (v > hi) { notes.push(label + ' was clamped down to ' + hi); v = hi; }
      return v;
    }
    function positive(id) { var v = num(id); return v > 0 ? v : 0; }

    var cfg = {
      price: bounded('rv-price', 'price', 'Property price'),
      downPct: bounded('rv-down', 'downPct', 'Down payment'),
      rate: bounded('rv-rate', 'rate', 'Loan rate'),
      tenure: bounded('rv-tenure', 'tenure', 'Loan tenure'),
      apprec: bounded('rv-apprec', 'apprec', 'Property appreciation'),
      horizon: bounded('rv-horizon', 'horizon', 'Horizon'),

      stampPct: bounded('rv-stamp', 'stampPct', 'Stamp duty and registration'),
      otherUpfront: positive('rv-upfront'),
      maint: positive('rv-maint'),
      propTax: positive('rv-proptax'),
      insurance: positive('rv-ins'),
      costInf: bounded('rv-costinf', 'costInf', 'Running-cost inflation'),

      rent: positive('rv-rent'),
      rentEsc: bounded('rv-rentesc', 'rentEsc', 'Rent escalation'),
      deposit: positive('rv-deposit'),
      invReturn: bounded('rv-return', 'invReturn', 'Investment return'),

      sellAtEnd: checked('rv-sell'),
      brokerPct: bounded('rv-broker', 'brokerPct', 'Cost to sell'),
      cgtProp: checked('rv-cgtprop'),
      cgtPropRate: bounded('rv-cgtproprate', 'cgtRate', 'Property gains rate'),
      indexPct: bounded('rv-index', 'indexPct', 'Indexation'),
      cgtEq: checked('rv-cgteq'),
      cgtEqRate: bounded('rv-cgteqrate', 'cgtRate', 'Investment gains rate'),

      taxOn: checked('rv-tax'),
      marginal: bounded('rv-marginal', 'marginal', 'Marginal rate'),
      cap24b: positive('rv-cap24'),
      cap80c: positive('rv-cap80c'),
      used80c: positive('rv-used80c'),
      hraReceived: positive('rv-hra'),
      salaryHra: positive('rv-salhra'),
      metroPct: value('rv-metro') === 'non' ? 40 : 50,
      salGrow: bounded('rv-salgrow', 'salGrow', 'Salary growth')
    };
    cfg.horizon = Math.round(cfg.horizon);
    cfg.notes = notes;
    return cfg;
  }

  function problems(cfg) {
    if (cfg.price <= 0) {
      return 'Waiting on a property price. Every number below is computed from it.';
    }
    if (cfg.rent <= 0) {
      return 'Waiting on a rent. Without one there is no second path to compare, ' +
        'and a rent of zero is not a comparison, it is a different question.';
    }
    if (cfg.tenure <= 0 && cfg.downPct < 100) {
      return 'A loan of ' + inr(cfg.price * (1 - cfg.downPct / 100)) +
        ' with a tenure of zero years cannot be amortised. Either set a tenure, ' +
        'or set the down payment to 100% and buy it outright.';
    }
    return null;
  }

  /* -------------------------------------------------------------- the plot */

  function drawChart(sim) {
    var canvas = document.getElementById('rv-chart');
    if (!canvas || !canvas.getContext) return;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(280, canvas.clientWidth || 620);
    var h = Math.max(200, canvas.clientHeight || 320);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px ' + FONT;
    ctx.textBaseline = 'middle';

    if (!sim) {
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText('Fill the fields above and both curves appear here.', w / 2, h / 2);
      return;
    }

    var rows = sim.rows;
    var lo = 0, hi = 0, r;
    for (r = 0; r < rows.length; r++) {
      lo = Math.min(lo, rows[r].buyerNet, rows[r].renterNet);
      hi = Math.max(hi, rows[r].buyerNet, rows[r].renterNet);
    }
    if (hi === lo) hi = lo + 1;
    var padL = 66, padR = 14, padT = 16, padB = 30;
    var innerW = w - padL - padR, innerH = h - padT - padB;
    var maxYear = rows[rows.length - 1].year || 1;

    function px(year) { return padL + innerW * (year / maxYear); }
    function py(v) { return padT + innerH * (1 - (v - lo) / (hi - lo)); }

    var ticks = niceTicks(lo, hi, 5), t;
    ctx.textAlign = 'right';
    for (t = 0; t < ticks.length; t++) {
      var yy = py(ticks[t]);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(padL + innerW, yy);
      ctx.stroke();
      ctx.fillStyle = C.faint;
      ctx.fillText(shortMoney(ticks[t]), padL - 7, yy);
    }

    if (lo < 0 && hi > 0) {
      ctx.strokeStyle = C.zero;
      ctx.beginPath();
      ctx.moveTo(padL, py(0));
      ctx.lineTo(padL + innerW, py(0));
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    var step = maxYear <= 12 ? 1 : (maxYear <= 25 ? 5 : 10);
    for (var yr = 0; yr <= maxYear; yr += step) {
      ctx.fillStyle = C.faint;
      ctx.fillText(yr === 0 ? 'day 1' : 'yr ' + yr, px(yr), padT + innerH + 14);
    }

    function stroke(key, colour) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var q = 0; q < rows.length; q++) {
        var x = px(rows[q].year), y2 = py(rows[q][key]);
        if (q === 0) ctx.moveTo(x, y2); else ctx.lineTo(x, y2);
      }
      ctx.stroke();
    }
    stroke('renterNet', C.rent);
    stroke('buyerNet', C.buy);

    /* The crossover is marked with a line AND named in the caption under the
       canvas, in the table below it, and in the headline strip. A dot on a
       chart is not a fact a screen reader can reach. */
    if (sim.cross.year) {
      var cx = px(sim.cross.year);
      ctx.strokeStyle = C.cross;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, padT);
      ctx.lineTo(cx, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.cross;
      ctx.textAlign = cx > padL + innerW * 0.75 ? 'right' : 'left';
      ctx.fillText('crossover, year ' + sim.cross.year,
                   cx + (cx > padL + innerW * 0.75 ? -6 : 6), padT + 8);
    }

    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', chartSummary(sim));
  }

  function chartSummary(sim) {
    var last = sim.last;
    var who = sim.gap >= 0 ? 'Buying' : 'Renting';
    return 'Net worth of both paths over ' + sim.cfg.horizon + ' years. ' +
      'At the end, buying is worth ' + inr(last.buyerNet) + ' and renting ' +
      inr(last.renterNet) + '. ' + who + ' is ahead by ' + inr(Math.abs(sim.gap)) +
      '. ' + crossSentence(sim) +
      ' The same numbers are in the table below this chart.';
  }

  /* This sentence is the whole answer for anyone not looking at the canvas: it
     is the caption, the canvas aria-label and the live announcement. It has to
     describe the curves that were actually drawn, including the case where the
     buyer starts in front, loses that and wins it back. Four states, and the
     order they are tested in matters — see findCrossover. */
  function crossSentence(sim) {
    var c = sim.cross, h = sim.cfg.horizon;
    /* "level with or ahead of" rather than "ahead": with zero stamp duty, zero
       other costs and zero cost to sell the two paths start exactly equal, and
       the comparison that decides this is a >=. */
    if (c.buyerNeverTrails) {
      return 'There is no crossover to find: buying starts level with or ahead ' +
        'of renting and never trails, which happens when the transaction costs ' +
        'you entered are small.';
    }
    var churn = c.flips > 2
      ? ' The gap changes sign ' + c.flips + ' times in this run, so the lead is not a one-way door.'
      : '';
    if (c.buyerAheadAtStart) {
      if (c.year === null) {
        return 'Buying starts level with or ahead of renting, loses that ' +
          'position once the renter has the difference invested, and does not ' +
          'get it back inside ' + h + ' years.' + churn;
      }
      return 'Buying starts level with or ahead of renting, falls behind while ' +
        'the renter invests the difference, and takes the lead back during year ' +
        c.year + '.' + churn;
    }
    if (c.year === null) {
      return 'There is no crossover inside ' + h +
        ' years — renting stays ahead for the whole horizon on these numbers.';
    }
    var extra = c.flips > 1
      ? ' The gap changes sign ' + c.flips + ' times in this run, so the crossover is not a one-way door.'
      : '';
    return 'Buying overtakes renting during year ' + c.year + '.' + extra;
  }

  /* -------------------------------------------------------------- printing */

  function renderHeadline(sim) {
    var host = empty(document.getElementById('rv-headline'));
    function figure(label, val, note) {
      var box = el('div', 'rvb-figure');
      box.appendChild(el('span', 'rvb-figure-label', label));
      box.appendChild(el('span', 'rvb-figure-value', val));
      if (note) box.appendChild(el('span', 'rvb-figure-note', note));
      host.appendChild(box);
    }
    var last = sim.last;
    figure('Buying, net worth at year ' + sim.cfg.horizon, inr(last.buyerNet),
           sim.cfg.sellAtEnd ? 'after selling costs' : 'not sold, so no selling cost');
    figure('Renting, net worth at year ' + sim.cfg.horizon, inr(last.renterNet),
           'portfolio plus the deposit back');
    figure(sim.gap >= 0 ? 'Buying is ahead by' : 'Renting is ahead by',
           inr(Math.abs(sim.gap)),
           'on the numbers above, and only those');
    /* "From day one" only when the buyer never trails. The earlier version
       printed it whenever the buyer led at day one, which put the words "from
       day one" in this strip while the chart a few inches below was drawing a
       dashed line labelled "crossover, year 14". */
    var crossLabel, crossNote;
    if (sim.cross.buyerNeverTrails) {
      crossLabel = 'from day one';
      crossNote = 'buying never trails on these numbers';
    } else if (sim.cross.year !== null) {
      crossLabel = 'year ' + sim.cross.year;
      crossNote = sim.cross.buyerAheadAtStart
        ? 'buying led at day one, lost the lead, then took it back'
        : 'the year buying overtakes renting';
    } else {
      crossLabel = 'none in ' + sim.cfg.horizon + ' yrs';
      crossNote = 'renting is still ahead at year ' + sim.cfg.horizon;
    }
    figure('Crossover', crossLabel, crossNote);
  }

  function alertHeadline(text) {
    var host = empty(document.getElementById('rv-headline'));
    host.appendChild(el('p', 'rvb-alert', text));
  }

  function renderTerminal(sim) {
    var cfg = sim.cfg, last = sim.last, tot = sim.totals;
    out.clear();

    out.heading('What this run assumed');
    out.row('property price', inr(cfg.price));
    out.row('down payment', pct(cfg.downPct) + '  (' + inr(sim.downPayment) + ')');
    out.row('stamp duty + reg.', pct(cfg.stampPct) + '  (' + inr(sim.stampCost) + ')');
    out.dim('  stamp duty is a state levy. It is not one national number, and');
    out.dim('  the percentage above is yours, not mine. Check your own state.');
    out.row('loan', inr(sim.loan) + ' at ' + pct(cfg.rate, 2) + ' for ' + cfg.tenure + ' yr');
    out.row('appreciation', pct(cfg.apprec) + ' a year  (a guess)');
    out.row('investment return', pct(cfg.invReturn) + ' a year  (also a guess)');
    out.row('horizon', cfg.horizon + ' years');
    out.row('old-regime tax', cfg.taxOn ? 'ON, at ' + pct(cfg.marginal, 2) + ' marginal' : 'off');
    if (cfg.notes.length) {
      out.line('');
      for (var q = 0; q < cfg.notes.length; q++) out.warn('  ' + cfg.notes[q] + '.');
    }
    out.rule();

    out.heading('The buy path');
    if (sim.loan > 0) {
      out.row('EMI', inr(sim.emi));
      out.dim('  P x i x (1+i)^n / ((1+i)^n - 1), with i = ' +
              (sim.monthlyRate * 100).toFixed(4) + '% a month and n = ' +
              Math.round(cfg.tenure * 12) + ' months.');
      if (sim.notAmortising) {
        out.err('  At this rate the instalment does not cover the interest, so');
        out.err('  the balance never falls. Check the rate and the tenure.');
      }
    } else {
      out.row('EMI', 'none — bought outright');
    }
    out.row('cash up front', inr(sim.upfrontBuy));
    out.row('interest paid', inr(tot.interest));
    out.row('principal repaid', inr(tot.principalPaid));
    out.row('maintenance', inr(tot.maint));
    out.row('property tax', inr(tot.propTax));
    out.row('insurance', inr(tot.insurance));
    if (cfg.taxOn) out.row('tax saved, 24(b)+80C', inr(tot.buyerTaxSaved));
    out.row('total cash out', inr(tot.buyerCash));
    out.line('');
    out.row('property at year ' + cfg.horizon, inr(last.propValue));
    out.row('loan outstanding', inr(last.outstanding));
    if (cfg.sellAtEnd) {
      out.row('cost to sell', '-' + inr(last.sellCost) + '  (' + pct(cfg.brokerPct) + ')');
      if (cfg.cgtProp) {
        out.row('gain, as modelled', inr(last.propGain));
        out.row('tax on that gain', '-' + inr(last.propGainTax) +
                '  (' + pct(cfg.cgtPropRate, 2) + ')');
      } else {
        out.dim('  Capital gains tax on the sale is switched OFF. If you sell,');
        out.dim('  it is real, and leaving it off flatters the buyer.');
      }
    } else {
      out.warn('  Not sold at the horizon, so no brokerage and no capital gains');
      out.warn('  are charged. That flatters the buyer by roughly ' +
               inr(last.propValue * cfg.brokerPct / 100) + ' of selling cost alone.');
    }
    if (sim.last.buyerPot > 0.5) {
      out.row('buyer also invested', inr(last.buyerPotNet));
      out.dim('  Months where owning cost less than renting. The buyer invests');
      out.dim('  the difference too, or the comparison would be rigged.');
    }
    out.row('NET WORTH', inr(last.buyerNet));
    out.rule();

    out.heading('The rent path');
    out.row('rent, year 1', inr(sim.yearInfo[0].rentMonth) + ' a month');
    out.row('rent, year ' + cfg.horizon,
            inr(sim.yearInfo[sim.yearInfo.length - 1].rentMonth) + ' a month');
    out.row('total rent paid', inr(tot.rent));
    out.row('deposit', inr(cfg.deposit));
    out.dim('  Idle. It earns nothing, it is returned at face value, and');
    out.dim('  inflation over ' + cfg.horizon + ' years is a real cost this model does');
    out.dim('  not charge to it.');
    if (cfg.taxOn) out.row('tax saved, HRA', inr(tot.renterTaxSaved));
    out.row('total cash out', inr(tot.renterCash));
    out.line('');
    out.row('total invested', inr(tot.renterInvested));
    out.row('portfolio at year ' + cfg.horizon, inr(last.renterPot));
    if (cfg.cgtEq) {
      out.row('tax on the gain', '-' + inr(last.renterPotTax) +
              '  (' + pct(cfg.cgtEqRate, 2) + ')');
    } else {
      out.dim('  Tax on investment gains is switched OFF, which flatters the');
      out.dim('  renter in exactly the way the toggle above flatters the buyer.');
    }
    out.row('deposit returned', inr(cfg.deposit));
    out.row('NET WORTH', inr(last.renterNet));
    out.rule();

    out.heading('The comparison everyone makes, and why it is wrong');
    out.row('owning, month 1', inr(sim.firstMonthOwn) + ' a month');
    out.row('renting, month 1', inr(sim.yearInfo[0].rentMonth) + ' a month');
    out.dim('  Those two numbers are what every other calculator compares, and');
    out.dim('  the comparison is meaningless: part of that EMI is principal,');
    out.dim('  which is savings, and the renter is still holding ' +
            inr(sim.upfrontBuy) + ' of');
    out.dim('  capital that the buyer has already spent. Net worth below.');
    out.line('');
    out.row('gross rental yield', pct(sim.yieldPct, 2) + '  (annual rent / price)');
    out.row('price-to-rent', sim.priceToRent.toFixed(1) + ' years of rent at today’s rent');
    out.dim('  Computed from the two numbers you typed, as a consistency check.');
    out.dim('  If this yield is far from what you see quoted where you live,');
    out.dim('  one of the price and the rent is describing a different flat.');
    out.rule();

    out.heading('The comparison, at year ' + cfg.horizon);
    if (sim.gap >= 0) out.ok('  Buying ends ahead by ' + inr(sim.gap) + '.');
    else out.warn('  Renting ends ahead by ' + inr(-sim.gap) + '.');
    var cs = wrapText(crossSentence(sim), 62), w;
    for (w = 0; w < cs.length; w++) out.line('  ' + cs[w], 't-info');
    out.line('');
    out.row('imputed rent avoided', inr(tot.rent));
    out.dim('  The rent the buyer did not pay across the horizon. It is already');
    out.dim('  inside the comparison — it is the whole reason the renter has a');
    out.dim('  monthly surplus to invest in the early years.');
    out.line('');
    out.dim('  How the budget works here: each month both paths are given the');
    out.dim('  same money, equal to whichever path costs more, and the cheaper');
    out.dim('  side banks the difference. So a tax saving to the buyer shows up');
    out.dim('  as the renter having less to invest rather than as the buyer');
    out.dim('  getting richer. The gap between the two — which is the only');
    out.dim('  thing this page is measuring — moves the same either way.');
    out.rule();

    if (cfg.taxOn) {
      out.heading('Old-regime treatment, year 1');
      var y1 = sim.yearInfo[0];
      out.row('24(b) interest claim', inr(y1.claim24) + ' of ' + inr(y1.interest) +
              ' paid, capped at ' + inr(cfg.cap24b));
      out.row('80C eligible', inr(y1.eligible80c) + ' (principal + stamp duty)');
      out.row('80C actually claimed', inr(y1.claim80c) + ', headroom was ' +
              inr(Math.max(0, cfg.cap80c - cfg.used80c)));
      if (y1.hra) {
        out.line('');
        out.line('  HRA exemption, the least of three:', 't-info');
        out.row('  HRA received', inr(y1.hra.received));
        out.row('  rent - 10% of salary', inr(y1.hra.rentOverTenPct));
        out.row('  ' + cfg.metroPct + '% of salary', inr(y1.hra.shareOfSalary));
        out.row('  exempt', inr(y1.hra.exempt));
      }
      out.line('');
      out.warn('  This is the OLD regime only. The new regime — which is the');
      out.warn('  default one — has no 80C, no HRA exemption, and no 24(b)');
      out.warn('  deduction on a self-occupied property. If you are in the new');
      out.warn('  regime, switch this block off, because none of it applies.');
      out.warn('  Every ceiling above is a field you set. They move with the');
      out.warn('  Finance Act, and this page does not know which year you are in.');
      out.rule();
    }

    out.heading('What this does not do');
    out.dim('  It is arithmetic, not advice, and not tax advice either.');
    out.dim('  Appreciation and investment return are guesses. They dominate');
    out.dim('    the answer. The grid below shows how fast it flips.');
    out.dim('  No pre-payment, no rate reset, no top-up, no rent-free months.');
    out.dim('  No GST on under-construction property, no possession delay, no');
    out.dim('    parking or club charges, no one-time society corpus.');
    out.dim('  Section 54, 54F and 54EC rollovers are not modelled, and they');
    out.dim('    can reduce a property gain to nothing if you reinvest.');
    out.dim('  The annual exemption on equity gains is not applied, because it');
    out.dim('    depends on everything else you sold that year.');
    out.dim('  It assumes you invest the difference every month. Most people');
    out.dim('    do not, and a renter who spends it loses this comparison.');
    out.dim('  It ignores job mobility, family pressure, the quality of the');
    out.dim('    rentals actually available to you, landlord behaviour and');
    out.dim('    security of tenure. Those decide it for most people, and no');
    out.dim('    number on this page speaks to any of them.');
  }

  function renderTable(sim) {
    var host = empty(document.getElementById('rv-table'));
    var wrap = el('div', 'rvb-tablewrap');
    var table = el('table', 'rvb-table');
    table.appendChild(el('caption', null,
      'Both paths at the end of each year. This is the same data as the chart ' +
      'above, in full. The crossover row is named in its own row header.'));

    var heads = ['End of', 'Property', 'Loan left', 'Buying net worth',
                 'Renting net worth', 'Gap'];
    var thead = el('thead'), hrow = el('tr'), i;
    for (i = 0; i < heads.length; i++) {
      var th = el('th', null, heads[i]);
      th.setAttribute('scope', 'col');
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    for (i = 0; i < sim.rows.length; i++) {
      var r = sim.rows[i];
      var isCross = sim.cross.year !== null && r.year === sim.cross.year;
      var tr = el('tr', isCross ? 'is-cross' : null);
      var label = r.year === 0 ? 'day 1' : 'year ' + (Math.round(r.year * 10) / 10);
      var rh = el('th', null, label + (isCross ? ' · crossover' : ''));
      rh.setAttribute('scope', 'row');
      tr.appendChild(rh);
      tr.appendChild(el('td', null, shortMoney(r.propValue)));
      tr.appendChild(el('td', null, shortMoney(r.outstanding)));
      tr.appendChild(el('td', null, inr(r.buyerNet)));
      tr.appendChild(el('td', null, inr(r.renterNet)));
      var d = r.buyerNet - r.renterNet;
      tr.appendChild(el('td', 'rvb-gap', (d >= 0 ? 'buy +' : 'rent +') + inr(Math.abs(d))));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* The point of the whole page. Two guesses, moved two points at a time, and
     the crossover year recomputed from scratch in every cell. If the answer
     were robust the grid would be flat; it is not, and that is the finding. */
  var OFFSETS = [-4, -2, 0, 2, 4];

  function renderGrid(sim) {
    var host = empty(document.getElementById('rv-grid'));
    var base = sim.cfg;
    var wrap = el('div', 'rvb-tablewrap');
    var table = el('table', 'rvb-table rvb-gridtable');
    table.appendChild(el('caption', null,
      'Crossover year — the year buying overtakes renting — recomputed at each ' +
      'pair of guesses, with every other field held exactly as you set it. ' +
      '"day 1" means buying starts level or ahead and never trails; "none" ' +
      'means buying never gets in front inside the ' + base.horizon +
      '-year horizon. Rows are appreciation, columns are investment return.'));

    var thead = el('thead'), hrow = el('tr');
    var corner = el('th', null, 'Appreciation \\ return');
    corner.setAttribute('scope', 'col');
    hrow.appendChild(corner);
    var c, rIdx, cell;
    for (c = 0; c < OFFSETS.length; c++) {
      var rv = base.invReturn + OFFSETS[c];
      var chead = el('th', null, pct(rv, 0));
      chead.setAttribute('scope', 'col');
      hrow.appendChild(chead);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    var neverCount = 0, total = 0, gapLo = Infinity, gapHi = -Infinity;
    for (rIdx = 0; rIdx < OFFSETS.length; rIdx++) {
      var av = base.apprec + OFFSETS[rIdx];
      var tr = el('tr');
      var rh = el('th', null, pct(av, 0));
      rh.setAttribute('scope', 'row');
      tr.appendChild(rh);
      for (c = 0; c < OFFSETS.length; c++) {
        var alt = cloneCfg(base);
        alt.apprec = av;
        alt.invReturn = base.invReturn + OFFSETS[c];
        var run = simulate(alt);
        total++;
        gapLo = Math.min(gapLo, run.gap);
        gapHi = Math.max(gapHi, run.gap);
        /* Same precedence as the headline strip, and for the same reason: a
           cell that says "day 1" when the buyer actually spends thirteen years
           behind is a wrong answer printed twenty-five times over. */
        var text, cls;
        if (run.cross.buyerNeverTrails) { text = 'day 1'; cls = 'is-buy'; }
        else if (run.cross.year !== null) { text = 'yr ' + run.cross.year; cls = 'is-buy'; }
        else { text = 'none'; cls = 'is-rent'; neverCount++; }
        var isHere = OFFSETS[rIdx] === 0 && OFFSETS[c] === 0;
        cell = el('td', cls + (isHere ? ' is-here' : ''), text + (isHere ? ' · yours' : ''));
        tr.appendChild(cell);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);

    var note = el('p', 'rvb-note');
    note.textContent = 'Across these ' + total + ' runs, buying never gets in front ' +
      'inside the horizon in ' + neverCount + ' of them and does get in front in ' +
      (total - neverCount) + '. At year ' + base.horizon + ' the gap between the two ' +
      'paths ranges from ' + inr(gapLo) + ' to ' + inr(gapHi) +
      ' across the grid — a swing of ' + inr(gapHi - gapLo) +
      ' produced by moving two numbers that nobody can know in advance by four ' +
      'points. That swing is the honest output of this page. The single number ' +
      'in the middle is not.';
    host.appendChild(note);
  }

  function cloneCfg(cfg) {
    var copy = {}, k;
    for (k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) copy[k] = cfg[k]; }
    return copy;
  }

  function blockNotice(id, text) {
    var host = empty(document.getElementById(id));
    host.appendChild(el('p', 'rvb-note', text));
  }

  /* ------------------------------------------------------------- self-test */

  /* Every check computes both sides. Nothing here is a number I remembered:
     the EMI is checked by discounting its own payment stream back to the
     principal, the portfolio by the closed-form annuity, the schedule by
     whether it actually reaches zero. */
  function selfTest() {
    var checks = [];
    function assert(name, got, want, tol) {
      checks.push({ name: name, ok: Math.abs(got - want) <= (tol || 1), got: got, want: want });
    }

    var L = 5000000, i = 0.085 / 12, n = 240;
    var emi = emiFor(L, i, n);
    var pv = 0, k;
    for (k = 1; k <= n; k++) pv += emi / Math.pow(1 + i, k);
    assert('EMI stream discounts back to the principal', pv, L, 1);
    assert('zero-rate EMI is principal over months', emiFor(1200000, 0, 120), 10000, 0.01);

    var bal = L, paidInterest = 0, paidPrincipal = 0;
    for (k = 1; k <= n; k++) {
      var int1 = bal * i;
      var pr = Math.min(emi - int1, bal);
      bal -= pr; paidInterest += int1; paidPrincipal += pr;
    }
    assert('schedule amortises to zero', bal, 0, 1);
    assert('principal repaid equals the loan', paidPrincipal, L, 1);
    assert('payments equal interest plus principal', paidInterest + paidPrincipal,
           emi * n, 2);

    var mr = Math.pow(1.10, 1 / 12) - 1;
    assert('monthly rate compounds to the annual one', Math.pow(1 + mr, 12), 1.10, 1e-9);
    var pot = 0;
    for (k = 1; k <= 120; k++) { pot = pot * (1 + mr) + 1000; }
    assert('portfolio matches the annuity closed form', pot,
           1000 * (Math.pow(1 + mr, 120) - 1) / mr, 0.01);

    var h = hraTests(300000, 1000000, 240000, 50);
    assert('HRA exemption takes the least of three', h.exempt,
           Math.min(300000, 240000 - 100000, 500000), 0.01);
    checks.push({ name: 'HRA least-of picked the rent test',
                  ok: h.exempt === h.rentOverTenPct,
                  got: h.exempt, want: h.rentOverTenPct });

    var synth = [{ year: 0, buyerNet: -10, renterNet: 0 },
                 { year: 1, buyerNet: -5, renterNet: 0 },
                 { year: 2, buyerNet: 5, renterNet: 0 }];
    var cx = findCrossover(synth);
    checks.push({ name: 'crossover found in the right year', ok: cx.year === 2,
                  got: cx.year, want: 2 });
    var flat = [{ year: 0, buyerNet: 1, renterNet: 0 },
                { year: 1, buyerNet: 2, renterNet: 0 }];
    checks.push({ name: 'no crossover when the buyer never trailed',
                  ok: findCrossover(flat).year === null && findCrossover(flat).buyerNeverTrails,
                  got: findCrossover(flat).year, want: null });

    /* The bug this file actually shipped with once: level at day one, behind
       for years, then in front again. "Ahead at the start" must not be allowed
       to swallow the crossover that follows it. */
    var dip = findCrossover([{ year: 0, buyerNet: 0, renterNet: 0 },
                             { year: 1, buyerNet: -5, renterNet: 0 },
                             { year: 2, buyerNet: 20, renterNet: 0 }]);
    checks.push({ name: 'a day-one lead that is lost is not "never trails"',
                  ok: dip.buyerAheadAtStart && !dip.buyerNeverTrails && dip.year === 2,
                  got: 'neverTrails=' + dip.buyerNeverTrails + ' year=' + dip.year,
                  want: 'neverTrails=false year=2' });

    checks.push({ name: 'Indian digit grouping', ok: inr(12345678) === '₹1,23,45,678',
                  got: inr(12345678), want: '₹1,23,45,678' });

    var passed = 0, failed = 0;
    for (k = 0; k < checks.length; k++) { if (checks[k].ok) passed++; else failed++; }
    return { checks: checks, passed: passed, failed: failed };
  }

  /* --------------------------------------------------------------- wiring */

  var timer = null, lastSim = null;

  function recompute() {
    var cfg = readInputs();
    var stop = problems(cfg);
    if (stop) {
      lastSim = null;
      alertHeadline(stop);
      out.clear().warn(stop);
      blockNotice('rv-table', stop);
      blockNotice('rv-grid', stop);
      document.getElementById('rv-caption').textContent = stop;
      drawChart(null);
      announce(stop);
      return;
    }
    var sim = simulate(cfg);
    lastSim = sim;
    renderHeadline(sim);
    renderTerminal(sim);
    renderTable(sim);
    renderGrid(sim);
    drawChart(sim);
    document.getElementById('rv-caption').textContent = chartSummary(sim);
    announce((sim.gap >= 0 ? 'Buying' : 'Renting') + ' ends ahead by ' +
             inr(Math.abs(sim.gap)) + ' at year ' + cfg.horizon + '. ' +
             crossSentence(sim));
  }

  function announce(text) {
    var node = document.getElementById('rv-announce');
    if (node) node.textContent = text;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(recompute, 160);
  }

  var IDS = ['rv-price', 'rv-down', 'rv-rate', 'rv-tenure', 'rv-apprec', 'rv-horizon',
             'rv-stamp', 'rv-upfront', 'rv-maint', 'rv-proptax', 'rv-ins', 'rv-costinf',
             'rv-rent', 'rv-rentesc', 'rv-deposit', 'rv-return',
             'rv-sell', 'rv-broker', 'rv-cgtprop', 'rv-cgtproprate', 'rv-index',
             'rv-cgteq', 'rv-cgteqrate',
             'rv-tax', 'rv-marginal', 'rv-cap24', 'rv-cap80c', 'rv-used80c',
             'rv-hra', 'rv-salhra', 'rv-metro', 'rv-salgrow'];

  /* The old-regime fields are inert until the toggle is on, and disabled
     rather than hidden: a field that vanishes takes its label with it, and a
     visitor who had typed into it loses the value without being told. */
  function syncTaxFields() {
    var on = checked('rv-tax');
    var group = document.getElementById('rv-taxfields');
    if (!group) return;
    var inputs = group.querySelectorAll('input, select');
    for (var k = 0; k < inputs.length; k++) {
      /* The toggle itself lives inside the group it controls, because putting
         it anywhere else separates the switch from the thing it switches. It
         therefore has to be skipped here, or the first click would disable the
         control that produced it and there would be no way back. */
      if (inputs[k].id === 'rv-tax') continue;
      inputs[k].disabled = !on;
    }
    group.setAttribute('data-active', on ? 'yes' : 'no');
  }

  function syncGainFields() {
    var p = field('rv-cgtproprate'), x = field('rv-index'), e = field('rv-cgteqrate');
    if (p) p.disabled = !checked('rv-cgtprop');
    if (x) x.disabled = !checked('rv-cgtprop');
    if (e) e.disabled = !checked('rv-cgteq');
  }

  LabTool.define({
    id: 'rentvsbuy',
    run: recompute,
    onReady: function () {
      var k;
      for (k = 0; k < IDS.length; k++) {
        var node = document.getElementById(IDS[k]);
        if (!node) continue;
        node.addEventListener('input', function () { syncTaxFields(); syncGainFields(); schedule(); });
        node.addEventListener('change', function () { syncTaxFields(); syncGainFields(); schedule(); });
      }

      /* The chart is sized in CSS pixels off its own box, so a window resize
         changes the box without changing the bitmap and the curves end up
         stretched. Redrawn from the last simulation rather than recomputed —
         nothing about the numbers changed, only the canvas. */
      var rt = null;
      window.addEventListener('resize', function () {
        if (rt) clearTimeout(rt);
        rt = setTimeout(function () { drawChart(lastSim); }, 120);
      });

      var chip = document.getElementById('tool-selftest');
      if (chip) {
        var result = selfTest();
        chip.textContent = result.failed
          ? result.failed + ' of ' + result.checks.length + ' self-checks FAILED'
          : result.passed + ' self-checks pass';
        chip.className = 'lab-status ' + (result.failed ? 'is-err' : 'is-ok');
      }

      syncTaxFields();
      syncGainFields();
      recompute();
    }
  });

  root.RentVsBuyInternals = {
    emiFor: emiFor, hraTests: hraTests, findCrossover: findCrossover,
    simulate: simulate, selfTest: selfTest, inr: inr
  };
})(typeof self !== 'undefined' ? self : this);

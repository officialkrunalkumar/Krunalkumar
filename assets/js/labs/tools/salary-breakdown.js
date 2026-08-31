/* ==========================================================================
   salary-breakdown.js — an Indian CTC taken apart, one line at a time.
   --------------------------------------------------------------------------
   Every salary calculator on the internet takes a CTC and drops a single
   in-hand number on you. Nobody believes those numbers, and they are right not
   to: the answer depends on how the offer is split, whether the employer's PF
   contribution was counted inside the CTC, which state you sit in, what rent
   you pay, and which tax regime you end up under. A single number hides all of
   that, and hides the two or three places where the offer is actually
   negotiable.

   So this one prints the whole chain. Component split, PF on both sides,
   gratuity accrual, professional tax month by month, the HRA exemption as the
   minimum of its three tests, and then both tax regimes computed side by side
   with every slab shown, the 87A rebate, surcharge with its marginal relief,
   and cess. Then a month-by-month table, because the months genuinely differ,
   and a sensitivity pass over the basic percentage, because that is the single
   lever most people can move in a negotiation.

   THE HONEST PART. Indian tax rules change with every Budget, and the slabs
   below are for one financial year only. That year is declared once, in the FY
   object at the top of this file, and every number on the page — including the
   banner the visitor reads first — is rendered from it. Change FY and the page
   changes with it. This is not tax advice and it is not a payslip; it is
   arithmetic you can check.

   Nothing is uploaded. A salary is about as personal as a number gets, which
   is exactly why this runs on your machine and there is no server to send it
   to.
   ========================================================================== */

/* global LabTool */
(function (root) {
  'use strict';

  /* ======================================================================
     THE ONE PLACE THE FINANCIAL YEAR LIVES.

     To move this page to a new Budget, edit this object and nothing else.
     Every slab line, every rebate, the standard deductions, the surcharge
     bands and the label printed at the top of the tool all read from here.
     The `label` and `long` strings are written into the page at load, so the
     year the visitor sees can never drift away from the year the arithmetic
     used.
     ====================================================================== */
  var FY = {
    label: 'FY 2025-26',
    long: 'financial year 2025-26, which is assessment year 2026-27',
    source: 'Finance Act 2025',

    /* [upper limit of the band, rate applied inside it]. Infinity closes it. */
    oldSlabs: [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]],
    newSlabs: [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15],
               [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]],

    standardDeductionOld: 50000,
    standardDeductionNew: 75000,

    /* Section 87A. `marginal: true` is the new regime's marginal relief — just
       above the limit, the tax cannot exceed the amount by which income
       crossed it, so earning one rupee more never costs more than one rupee. */
    rebateOld: { limit: 500000, max: 12500, marginal: false },
    rebateNew: { limit: 1200000, max: 60000, marginal: true },

    /* [income above which the rate applies, rate]. The new regime is capped at
       25% — the 37% band was removed there. */
    surchargeOld: [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]],
    surchargeNew: [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25]],

    cess: 0.04,

    pfRate: 0.12,
    pfWageCeilingMonthly: 15000,
    epsRate: 0.0833,
    epsWageCeilingMonthly: 15000,

    /* 15 days' pay for each completed year, on a 26-day month: 15/26 of one
       month's basic per year, which is 4.81% of annual basic. */
    gratuityRate: 15 / 26 / 12,

    /* Article 276(2) of the Constitution caps professional tax at ₹2,500 a
       year, in every state, which is why no entry below can exceed it. */
    ptAnnualCap: 2500,

    /* Old-regime deduction ceilings, so the fields can say what they cap at. */
    cap80C: 150000,
    cap80D: 100000,
    cap80CCD1B: 50000,
    cap24B: 200000
  };

  var MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
                'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

  /* Professional tax, as twelve monthly amounts running April to March.

     Stored per month rather than as an annual figure on purpose: several
     states collect it unevenly — Maharashtra takes ₹300 in February, Tamil
     Nadu and Kerala take it in two half-yearly lumps — and that unevenness is
     one of the real reasons two months of the same salary pay differently.

     These are the TOP slab in each state, which is what applies to anyone whose
     salary is anywhere near the sort of CTC this page is for. Lower earners pay
     less or nothing, and the thresholds differ state by state. */
  var PT_STATES = [
    { id: 'none', name: 'No professional tax', months: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      note: 'Delhi, Haryana, Uttar Pradesh, Uttarakhand, Rajasthan, Himachal Pradesh, Goa and Chandigarh do not levy it.' },
    { id: 'mh', name: 'Maharashtra', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 300, 200],
      note: '₹200 a month, and ₹300 in February so the year lands exactly on the ₹2,500 cap.' },
    { id: 'ka', name: 'Karnataka', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
      note: '₹200 a month for salaries at or above ₹25,000.' },
    { id: 'gj', name: 'Gujarat', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
      note: '₹200 a month at the top slab.' },
    { id: 'wb', name: 'West Bengal', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
      note: '₹200 a month above ₹40,000 of monthly salary.' },
    { id: 'tn', name: 'Tamil Nadu', months: [0, 0, 0, 0, 0, 1250, 0, 0, 0, 0, 0, 1250],
      note: 'Collected half-yearly rather than monthly, which is why two months carry all of it.' },
    { id: 'kl', name: 'Kerala', months: [0, 0, 0, 0, 0, 1250, 0, 0, 0, 0, 0, 1250],
      note: 'Also half-yearly, levied by the local body rather than the state.' },
    { id: 'ts', name: 'Telangana', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
      note: '₹200 a month above ₹20,000 of monthly salary.' },
    { id: 'ap', name: 'Andhra Pradesh', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200],
      note: '₹200 a month at the top slab.' },
    { id: 'mp', name: 'Madhya Pradesh', months: [208, 208, 208, 208, 208, 208, 208, 208, 208, 208, 208, 212],
      note: '₹208 a month with ₹212 in the last one, again to land on ₹2,500.' },
    { id: 'or', name: 'Odisha', months: [200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 300],
      note: '₹200 a month with ₹300 in March.' },
    { id: 'as', name: 'Assam', months: [208, 208, 208, 208, 208, 208, 208, 208, 208, 208, 208, 208],
      note: '₹208 a month, which stops just short of the cap at ₹2,496.' },
    { id: 'br', name: 'Bihar', months: [0, 0, 625, 0, 0, 625, 0, 0, 625, 0, 0, 625],
      note: 'Collected quarterly at ₹625 a quarter.' }
  ];

  /* Preset structures. These are shapes I have actually seen on offer letters,
     not an official anything — a company can split a CTC however it likes, and
     the only way to know yours is to read your own annexure. */
  var PRESETS = {
    it: { basicPct: 40, hraPct: 50, employerPfInCtc: true, pfBase: 'full',
          gratuityInCtc: true,
          note: 'Basic at 40% of CTC, HRA at half of basic, employer PF and gratuity both counted inside the CTC. This is the most common Indian IT and services shape.' },
    ceiling: { basicPct: 50, hraPct: 50, employerPfInCtc: true, pfBase: 'ceiling',
               gratuityInCtc: true,
               note: 'A higher basic, but PF restricted to the ₹15,000 statutory wage ceiling — which raises take-home and lowers what goes into your EPF.' },
    startup: { basicPct: 50, hraPct: 0, employerPfInCtc: false, pfBase: 'full',
               gratuityInCtc: false,
               note: 'A flat structure with no HRA component and the employer PF sitting outside the CTC. Simple, and it costs you the HRA exemption entirely.' },
    lowbasic: { basicPct: 30, hraPct: 50, employerPfInCtc: true, pfBase: 'full',
                gratuityInCtc: true,
                note: 'Basic pushed down to 30%, which is how some employers inflate the headline CTC while shrinking PF, gratuity and the HRA exemption together.' }
  };

  /* ------------------------------------------------------------ formatting */

  function inr(n) {
    var neg = n < 0;
    var s = String(Math.round(Math.abs(n)));
    if (s.length > 3) {
      var last3 = s.substr(s.length - 3);
      var rest = s.substr(0, s.length - 3);
      s = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
    }
    return (neg ? '-₹' : '₹') + s;
  }

  function pct(x, places) {
    if (!isFinite(x)) return '--';
    return x.toFixed(places === undefined ? 1 : places) + '%';
  }

  function pad(text, width) {
    var s = String(text);
    while (s.length < width) s += ' ';
    return s;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function num(id) {
    var field = document.getElementById(id);
    if (!field) return 0;
    var v = parseFloat(String(field.value).replace(/[,\s₹]/g, ''));
    return isFinite(v) && v > 0 ? v : 0;
  }

  function checked(id) {
    var field = document.getElementById(id);
    return !!(field && field.checked);
  }

  function value(id) {
    var field = document.getElementById(id);
    return field ? field.value : '';
  }

  /* ------------------------------------------------------------------ tax */

  function slabTax(income, slabs) {
    var tax = 0, prev = 0, i;
    for (i = 0; i < slabs.length; i++) {
      var top = slabs[i][0];
      if (income > prev) tax += (Math.min(income, top) - prev) * slabs[i][1];
      prev = top;
      if (income <= top) break;
    }
    return tax;
  }

  /* Every band the income actually reached, with the arithmetic spelled out,
     because "your tax is ₹1,17,000" convinces nobody and this does. */
  function slabRows(income, slabs) {
    var rows = [], prev = 0, i;
    for (i = 0; i < slabs.length; i++) {
      var top = slabs[i][0];
      var rate = slabs[i][1];
      var slice = income > prev ? Math.min(income, top) - prev : 0;
      var label = top === Infinity
        ? 'above ' + inr(prev)
        : inr(prev === 0 ? 0 : prev + 1) + ' to ' + inr(top);
      rows.push({ label: label, rate: rate, slice: slice, tax: slice * rate });
      prev = top;
      if (income <= top) break;
    }
    return rows;
  }

  function surchargeBand(income, bands) {
    var found = { rate: 0, threshold: 0 };
    for (var i = 0; i < bands.length; i++) {
      if (income > bands[i][0]) found = { rate: bands[i][1], threshold: bands[i][0] };
      else break;
    }
    return found;
  }

  /* One taxable income in, one fully itemised tax out. Returns every
     intermediate so the report can print the working rather than the verdict. */
  function computeTax(taxable, regime) {
    var isNew = regime === 'new';
    var slabs = isNew ? FY.newSlabs : FY.oldSlabs;
    var reb = isNew ? FY.rebateNew : FY.rebateOld;
    var bands = isNew ? FY.surchargeNew : FY.surchargeOld;

    var rows = slabRows(taxable, slabs);
    var base = slabTax(taxable, slabs);

    var rebate = 0;
    if (taxable <= reb.limit) rebate = Math.min(base, reb.max);
    var afterRebate = base - rebate;

    /* Marginal relief on the rebate cliff. Without it, crossing ₹12,00,000 of
       taxable income by ₹100 in the new regime would cost about ₹62,000 in
       tax, which is the sort of thing that makes people disbelieve the whole
       calculation. The law caps the tax at the amount by which you crossed. */
    var rebateRelief = 0;
    if (reb.marginal && taxable > reb.limit) {
      var cliffCap = taxable - reb.limit;
      if (afterRebate > cliffCap) {
        rebateRelief = afterRebate - cliffCap;
        afterRebate = cliffCap;
      }
    }

    var band = surchargeBand(taxable, bands);
    var surcharge = afterRebate * band.rate;

    /* And the same idea on each surcharge threshold. At ₹50,00,001 the 10%
       surcharge would otherwise add over a lakh for one extra rupee of income,
       so the total is capped at what it would have been at ₹50,00,000 plus the
       excess. The comparison point carries the surcharge of the band BELOW,
       because income exactly at a threshold has not exceeded it. */
    var surchargeRelief = 0;
    if (band.rate > 0) {
      var atLimit = slabTax(band.threshold, slabs);
      var lower = surchargeBand(band.threshold, bands);
      var capped = atLimit * (1 + lower.rate) + (taxable - band.threshold);
      if (afterRebate + surcharge > capped) {
        surchargeRelief = afterRebate + surcharge - capped;
        surcharge = Math.max(0, capped - afterRebate);
      }
    }

    var cess = (afterRebate + surcharge) * FY.cess;
    return {
      taxable: taxable,
      rows: rows,
      base: base,
      rebate: rebate,
      rebateRelief: rebateRelief,
      afterRebate: afterRebate,
      surchargeRate: band.rate,
      surchargeThreshold: band.threshold,
      surcharge: surcharge,
      surchargeRelief: surchargeRelief,
      cess: cess,
      total: afterRebate + surcharge + cess
    };
  }

  /* --------------------------------------------------------------- reading */

  function ptState(id) {
    for (var i = 0; i < PT_STATES.length; i++) {
      if (PT_STATES[i].id === id) return PT_STATES[i];
    }
    return PT_STATES[0];
  }

  function ptAnnual(state) {
    var total = 0;
    for (var i = 0; i < 12; i++) total += state.months[i];
    return total;
  }

  /* Read the form, split the CTC, and compute both regimes. `basicOverride`
     lets the sensitivity pass re-run the whole thing at a different basic
     percentage without touching the form. */
  function model(basicOverride) {
    var m = {};
    m.ctc = num('sb-ctc');
    m.basicPct = basicOverride === undefined ? num('sb-basicpct') : basicOverride;
    m.hraPct = num('sb-hrapct');
    m.bonus = num('sb-bonus');
    m.bonusMonth = parseInt(value('sb-bonusmonth'), 10) || 0;
    m.reimb = num('sb-reimb');
    m.employerPfInCtc = checked('sb-epfinctc');
    m.pfBase = value('sb-pfbase');
    m.gratuityInCtc = checked('sb-gratuity');
    m.metro = checked('sb-metro');
    m.rentMonthly = num('sb-rent');
    m.state = ptState(value('sb-state'));
    m.d80c = num('sb-80c');
    m.d80d = num('sb-80d');
    m.dnps = num('sb-nps');
    m.d24b = num('sb-24b');

    m.basic = m.ctc * m.basicPct / 100;
    m.hra = m.basic * m.hraPct / 100;

    var ceiling = FY.pfWageCeilingMonthly * 12;
    m.pfWage = m.pfBase === 'ceiling' ? Math.min(m.basic, ceiling) : m.basic;
    m.employeePf = m.pfWage * FY.pfRate;
    m.employerPf = m.pfWage * FY.pfRate;
    m.eps = Math.min(m.pfWage, FY.epsWageCeilingMonthly * 12) * FY.epsRate;
    m.employerEpf = m.employerPf - m.eps;
    m.gratuity = m.gratuityInCtc ? m.basic * FY.gratuityRate : 0;

    m.employerPfInCtcAmount = m.employerPfInCtc ? m.employerPf : 0;
    m.special = m.ctc - m.basic - m.hra - m.bonus - m.reimb -
                m.employerPfInCtcAmount - m.gratuity;
    m.overCommitted = m.special < -0.5;
    if (m.overCommitted) m.special = 0;

    /* What the employer actually pays you as salary, before anything is taken
       out. Employer PF and gratuity accrual are not paid to you now, so they
       are not here; reimbursements are cash but assumed non-taxable. */
    m.grossSalary = m.basic + m.hra + m.special + m.bonus;
    m.cashAnnual = m.grossSalary + m.reimb;

    m.ptState = m.state;
    m.pt = ptAnnual(m.state);

    /* HRA exemption, section 10(13A) with rule 2A — the minimum of three
       tests, never a percentage of anything on its own. Old regime only. */
    m.rentAnnual = m.rentMonthly * 12;
    m.hraTests = [
      { name: 'HRA actually received', amount: m.hra },
      { name: 'Rent paid minus 10% of basic', amount: Math.max(0, m.rentAnnual - 0.10 * m.basic) },
      { name: (m.metro ? '50' : '40') + '% of basic (' + (m.metro ? 'metro' : 'non-metro') + ')',
        amount: m.basic * (m.metro ? 0.5 : 0.4) }
    ];
    m.hraExempt = Math.min(m.hraTests[0].amount, m.hraTests[1].amount, m.hraTests[2].amount);
    if (m.hra <= 0 || m.rentAnnual <= 0) m.hraExempt = 0;

    m.c80c = Math.min(FY.cap80C, m.employeePf + m.d80c);
    m.c80d = Math.min(FY.cap80D, m.d80d);
    m.c80ccd = Math.min(FY.cap80CCD1B, m.dnps);
    m.c24b = Math.min(FY.cap24B, m.d24b);

    m.oldTaxable = Math.max(0, m.grossSalary - FY.standardDeductionOld - m.hraExempt -
                            m.pt - m.c80c - m.c80d - m.c80ccd - m.c24b);
    m.newTaxable = Math.max(0, m.grossSalary - FY.standardDeductionNew);

    m.oldTax = computeTax(m.oldTaxable, 'old');
    m.newTax = computeTax(m.newTaxable, 'new');
    m.winner = m.newTax.total <= m.oldTax.total ? 'new' : 'old';
    m.saving = Math.abs(m.newTax.total - m.oldTax.total);
    m.tax = m.winner === 'new' ? m.newTax : m.oldTax;

    /* Professional tax is a deduction from pay under both regimes; it is only
       deductible from TAXABLE income under the old one, which is why it
       appears twice with different jobs. */
    m.inHandAnnual = m.cashAnnual - m.employeePf - m.pt - m.tax.total;
    m.inHandMonthly = m.inHandAnnual / 12;
    m.effectiveOnCtc = m.ctc > 0 ? m.tax.total / m.ctc * 100 : 0;

    m.months = monthTable(m);
    return m;
  }

  /* Twelve months, because the months are not identical and pretending they
     are is the main thing wrong with a single in-hand figure.

     The TDS model: an employer estimates the year's tax and spreads it evenly,
     then re-estimates when something changes. So the base tax is divided by
     twelve, and the extra tax the bonus causes is recovered across the months
     remaining after it is paid. Section 192 only requires the total to be
     right by March; how a given payroll gets there varies, and yours may
     smooth it differently. */
  function monthTable(m) {
    var withoutBonus = m.winner === 'new'
      ? computeTax(Math.max(0, m.newTaxable - m.bonus), 'new')
      : computeTax(Math.max(0, m.oldTaxable - m.bonus), 'old');
    var baseTax = Math.min(withoutBonus.total, m.tax.total);
    var bonusTax = Math.max(0, m.tax.total - baseTax);
    var spreadOver = 12 - m.bonusMonth;

    var monthlyCash = (m.basic + m.hra + m.special + m.reimb) / 12;
    var monthlyPf = m.employeePf / 12;

    var rows = [];
    var tdsSoFar = 0;
    for (var i = 0; i < 12; i++) {
      var gross = monthlyCash + (i === m.bonusMonth ? m.bonus : 0);
      var tds = baseTax / 12 + (i >= m.bonusMonth && spreadOver > 0 ? bonusTax / spreadOver : 0);
      tds = Math.round(tds);
      /* March absorbs the rounding, which is also what payroll does — the year
         has to add up to the assessed figure, not to twelve tidy numbers. */
      if (i === 11) tds = Math.round(m.tax.total) - tdsSoFar;
      if (tds < 0) tds = 0;
      tdsSoFar += tds;
      var pt = m.state.months[i];
      rows.push({
        month: MONTHS[i],
        gross: gross,
        pf: monthlyPf,
        pt: pt,
        tds: tds,
        net: gross - monthlyPf - pt - tds,
        isBonus: i === m.bonusMonth && m.bonus > 0
      });
    }
    return rows;
  }

  /* ------------------------------------------------------------- the report */

  var out = LabTool.out('tool-out');

  function reportSlabs(label, tax, taxable) {
    out.heading(label);
    out.row('taxable income', inr(taxable));
    for (var i = 0; i < tax.rows.length; i++) {
      var r = tax.rows[i];
      var rate = r.rate === 0 ? 'nil' : Math.round(r.rate * 100) + '% of ' + inr(r.slice);
      out.line('  ' + pad(r.label, 26) + pad(rate, 22) + inr(r.tax));
    }
    out.row('tax on slabs', inr(tax.base));
    if (tax.rebate > 0) out.row('less 87A rebate', '-' + inr(tax.rebate));
    if (tax.rebateRelief > 0) {
      out.row('less marginal relief', '-' + inr(tax.rebateRelief));
      out.dim('  (just over the rebate limit, so the tax is capped at the excess)');
    }
    if (tax.surchargeRate > 0) {
      out.row('surcharge ' + Math.round(tax.surchargeRate * 100) + '%', inr(tax.surcharge));
      if (tax.surchargeRelief > 0) {
        out.row('surcharge relief', '-' + inr(tax.surchargeRelief));
      }
    }
    out.row('health and edu cess 4%', inr(tax.cess));
    out.row('TOTAL TAX', inr(tax.total), 't-warn');
  }

  function render(m) {
    out.clear();
    out.heading('CTC broken down — slabs and rules for ' + FY.label);
    out.dim('Confirm these against the current Budget before you rely on them.');
    out.rule();

    if (m.ctc <= 0) {
      out.warn('Enter an annual CTC to start. Everything else has a default that');
      out.warn('you can adjust, and nothing you type leaves this page.');
      return;
    }
    if (m.overCommitted) {
      out.err('The components add up to more than the CTC.');
      out.err('Basic, HRA, bonus, reimbursements, employer PF and gratuity together');
      out.err('exceed ' + inr(m.ctc) + ', so there is no special allowance left to');
      out.err('balance the split. Lower the basic or HRA percentage, or raise the CTC.');
      out.line('');
    }

    out.heading('Component split');
    out.row('CTC (annual)', inr(m.ctc));
    out.row('basic', inr(m.basic) + '   ' + pct(m.basicPct) + ' of CTC');
    out.row('HRA', inr(m.hra) + '   ' + pct(m.hraPct) + ' of basic');
    out.row('special allowance', inr(m.special) + '   the balancing figure');
    if (m.bonus > 0) out.row('bonus', inr(m.bonus) + '   paid in ' + MONTHS[m.bonusMonth]);
    if (m.reimb > 0) out.row('reimbursements', inr(m.reimb) + '   assumed non-taxable');
    if (m.employerPfInCtcAmount > 0) {
      out.row('employer PF (in CTC)', inr(m.employerPfInCtcAmount));
    } else {
      out.row('employer PF', inr(m.employerPf) + '   OUTSIDE the CTC');
    }
    if (m.gratuity > 0) out.row('gratuity accrual', inr(m.gratuity) + '   4.81% of basic');
    out.rule();

    out.heading('Provident fund and gratuity');
    out.row('PF wage', inr(m.pfWage) + '   ' +
      (m.pfBase === 'ceiling' ? 'capped at the ₹15,000 monthly ceiling' : 'full basic'));
    out.row('employee PF 12%', inr(m.employeePf));
    out.dim('  Leaves your pay and lands in your EPF account. It is your money,');
    out.dim('  it is just not spendable this month.');
    out.row('employer PF 12%', inr(m.employerPf));
    out.row('  of which EPS', inr(m.eps) + '   pension, capped on ₹15,000 of wage');
    out.row('  of which EPF', inr(m.employerEpf));
    out.dim('  EPS is 8.33% of the capped wage; most payrolls post it as a flat');
    out.dim('  ₹1,250 a month, so expect a few rupees of difference against a');
    out.dim('  real payslip. EDLI and administration charges are extra and are');
    out.dim('  usually the employer’s, not yours — unless your annexure says so.');
    if (m.gratuity > 0) {
      out.row('gratuity accrued', inr(m.gratuity));
      out.dim('  Accrued, not earned: nothing is payable until five continuous');
      out.dim('  years are complete. Counting it inside a CTC is legal and common,');
      out.dim('  and it is the line most likely to be worth nothing to you.');
    }
    out.rule();

    out.heading('Professional tax — ' + m.state.name);
    out.row('annual', inr(m.pt));
    out.dim('  ' + m.state.note);
    if (m.pt > 0) {
      out.dim('  Deducted from pay under both regimes. Deductible from taxable');
      out.dim('  income only under the old one, via section 16(iii).');
    }
    out.rule();

    out.heading('HRA exemption — the minimum of three tests');
    if (m.hra <= 0) {
      out.dim('  No HRA component, so there is nothing to exempt.');
    } else if (m.rentAnnual <= 0) {
      out.dim('  No rent entered. The exemption needs rent actually paid; if you');
      out.dim('  do not pay rent the whole HRA is taxable.');
    } else {
      for (var t = 0; t < m.hraTests.length; t++) {
        var test = m.hraTests[t];
        var mark = Math.abs(test.amount - m.hraExempt) < 0.5 ? '  <-- lowest' : '';
        out.line('  ' + pad(test.name, 40) + pad(inr(test.amount), 14) + mark);
      }
      out.row('exempt', inr(m.hraExempt));
      out.row('taxable part of HRA', inr(m.hra - m.hraExempt));
    }
    out.dim('  Old regime only. The new regime has no HRA exemption at all.');
    out.rule();

    out.heading('Old regime');
    out.row('gross salary', inr(m.grossSalary));
    out.row('standard deduction', '-' + inr(FY.standardDeductionOld));
    if (m.hraExempt > 0) out.row('HRA exemption', '-' + inr(m.hraExempt));
    if (m.pt > 0) out.row('professional tax', '-' + inr(m.pt));
    out.row('80C (incl. employee PF)', '-' + inr(m.c80c));
    if (m.c80d > 0) out.row('80D health insurance', '-' + inr(m.c80d));
    if (m.c80ccd > 0) out.row('80CCD(1B) NPS', '-' + inr(m.c80ccd));
    if (m.c24b > 0) out.row('24(b) home loan interest', '-' + inr(m.c24b));
    reportSlabs('Old regime tax', m.oldTax, m.oldTaxable);
    out.rule();

    out.heading('New regime');
    out.row('gross salary', inr(m.grossSalary));
    out.row('standard deduction', '-' + inr(FY.standardDeductionNew));
    out.dim('  No HRA exemption, no 80C, no 80D, no 24(b) on a let-out-free home.');
    reportSlabs('New regime tax', m.newTax, m.newTaxable);
    out.rule();

    out.heading('Which one wins');
    out.row('old regime tax', inr(m.oldTax.total));
    out.row('new regime tax', inr(m.newTax.total));
    if (Math.round(m.saving) === 0) {
      out.ok('They come out the same to the rupee.');
    } else {
      out.ok('The ' + (m.winner === 'new' ? 'NEW' : 'OLD') + ' regime wins by ' +
             inr(m.saving) + ' a year (' + inr(m.saving / 12) + ' a month).');
    }
    out.rule();

    out.heading('In hand');
    out.row('cash salary', inr(m.cashAnnual));
    out.row('less employee PF', '-' + inr(m.employeePf));
    out.row('less professional tax', '-' + inr(m.pt));
    out.row('less income tax', '-' + inr(m.tax.total));
    out.row('ANNUAL IN HAND', inr(m.inHandAnnual), 't-ok');
    out.row('MONTHLY AVERAGE', inr(m.inHandMonthly), 't-ok');
    out.row('tax as % of CTC', pct(m.effectiveOnCtc, 2));
    out.line('');
    out.dim('The monthly figure is an average. The table below has the months.');
    out.line('');
    out.warn('These slabs are ' + FY.label + '. Tax rules change every Budget.');
    out.warn('Check them against the current year, and against your own payslip.');
    out.warn('This is arithmetic, not tax advice.');
  }

  /* ------------------------------------------------------- structured panes */

  /* The four figures people came for — or, when the inputs cannot produce an
     honest four, a plain sentence saying why instead.

     Showing them anyway was tempting and wrong. With no CTC every figure is
     zero, and with an over-committed split the special allowance is clamped at
     zero and the in-hand that comes out looks perfectly plausible. A wrong
     number in a large green typeface is worse than no number, because the
     terminal explanation beside it is the part a visitor skips. */
  function headlineNotice(host, text) {
    var notice = el('p', 'sb-alert', text);
    host.appendChild(notice);
    var announce = document.getElementById('sb-announce');
    if (announce) announce.textContent = text;
  }

  function headline(m) {
    var host = document.getElementById('sb-headline');
    host.textContent = '';
    if (m.ctc <= 0) {
      headlineNotice(host, 'Enter an annual CTC and the figures appear here. ' +
        'Nothing you type leaves this page.');
      return;
    }
    if (m.overCommitted) {
      headlineNotice(host, 'The components add up to more than the CTC, so there ' +
        'is no in-hand figure to show. Lower the basic or HRA percentage, cut the ' +
        'bonus, or raise the CTC — the output pane has the arithmetic.');
      return;
    }
    var items = [
      ['Monthly in hand, on average', inr(m.inHandMonthly)],
      ['Annual in hand', inr(m.inHandAnnual)],
      ['Income tax for the year', inr(m.tax.total)],
      ['Regime that wins', m.winner === 'new' ? 'New' : 'Old']
    ];
    for (var i = 0; i < items.length; i++) {
      var card = el('div', 'sb-figure');
      card.appendChild(el('span', 'sb-figure-label', items[i][0]));
      card.appendChild(el('strong', 'sb-figure-value', items[i][1]));
      host.appendChild(card);
    }
    var announce = document.getElementById('sb-announce');
    if (announce) {
      announce.textContent = 'About ' + inr(m.inHandMonthly) + ' a month in hand, ' +
        inr(m.inHandAnnual) + ' for the year, under the ' +
        (m.winner === 'new' ? 'new' : 'old') + ' regime.';
    }
  }

  function regimeCard(title, taxObj, isWinner) {
    var card = el('article', 'sb-card' + (isWinner ? ' is-win' : ''));
    var head = el('div', 'sb-card-head');
    head.appendChild(el('h3', 'sb-card-title', title));
    if (isWinner) head.appendChild(el('span', 'sb-card-badge', 'Lower tax'));
    card.appendChild(head);
    card.appendChild(el('p', 'sb-card-amount', inr(taxObj.total)));

    var rows = [
      ['Taxable income', inr(taxObj.taxable)],
      ['Tax on the slabs', inr(taxObj.base)]
    ];
    if (taxObj.rebate > 0) rows.push(['Section 87A rebate', '-' + inr(taxObj.rebate)]);
    if (taxObj.rebateRelief > 0) rows.push(['Marginal relief', '-' + inr(taxObj.rebateRelief)]);
    if (taxObj.surchargeRate > 0) {
      rows.push(['Surcharge at ' + Math.round(taxObj.surchargeRate * 100) + '%', inr(taxObj.surcharge)]);
      if (taxObj.surchargeRelief > 0) {
        rows.push(['Surcharge marginal relief', '-' + inr(taxObj.surchargeRelief)]);
      }
    }
    rows.push(['Health and education cess, 4%', inr(taxObj.cess)]);

    var list = el('dl', 'sb-card-rows');
    for (var i = 0; i < rows.length; i++) {
      list.appendChild(el('dt', null, rows[i][0]));
      list.appendChild(el('dd', null, rows[i][1]));
    }
    card.appendChild(list);
    return card;
  }

  function renderRegimes(m) {
    var host = document.getElementById('sb-regimes');
    host.textContent = '';
    host.appendChild(regimeCard('Old regime', m.oldTax, m.winner === 'old'));
    host.appendChild(regimeCard('New regime', m.newTax, m.winner === 'new'));

    var verdict = document.getElementById('sb-verdict');
    if (Math.round(m.saving) === 0) {
      verdict.textContent = 'The two regimes come out identical at this split, ' +
        'so the choice is about what you expect to change next year, not this one.';
    } else {
      verdict.textContent = 'The ' + (m.winner === 'new' ? 'new' : 'old') +
        ' regime is cheaper by ' + inr(m.saving) + ' for the year, which is ' +
        inr(m.saving / 12) + ' a month. The new regime is the default; ' +
        'choosing the old one is something you have to actively declare.';
    }
  }

  function renderHra(m) {
    var host = document.getElementById('sb-hra');
    host.textContent = '';
    if (m.hra <= 0) {
      host.appendChild(el('p', 'sb-note', 'This structure has no HRA component, ' +
        'so there is nothing to exempt. That is a real cost if you pay rent and ' +
        'would otherwise be under the old regime.'));
      return;
    }
    if (m.rentAnnual <= 0) {
      host.appendChild(el('p', 'sb-note', 'Enter your monthly rent above and the ' +
        'three tests appear here. With no rent paid, none of the HRA is exempt ' +
        'however large the component is.'));
      return;
    }
    var list = el('ol', 'sb-tests');
    for (var i = 0; i < m.hraTests.length; i++) {
      var test = m.hraTests[i];
      var isMin = Math.abs(test.amount - m.hraExempt) < 0.5;
      var item = el('li', 'sb-test' + (isMin ? ' is-min' : ''));
      item.appendChild(el('span', 'sb-test-name', test.name));
      item.appendChild(el('span', 'sb-test-amount', inr(test.amount)));
      item.appendChild(el('span', 'sb-test-tag', isMin ? 'lowest, so this is the exemption' : ''));
      list.appendChild(item);
    }
    host.appendChild(list);
    var summary = el('p', 'sb-note');
    summary.textContent = 'Exempt: ' + inr(m.hraExempt) + '. Taxable part of the HRA: ' +
      inr(m.hra - m.hraExempt) + '. Under the new regime the whole ' + inr(m.hra) +
      ' is taxable, because that regime has no HRA exemption.';
    host.appendChild(summary);
  }

  function renderMonths(m) {
    var host = document.getElementById('sb-months');
    host.textContent = '';
    var wrap = el('div', 'sb-tablewrap');
    var table = el('table', 'sb-table');
    var caption = el('caption', null,
      'Twelve months of pay under the ' + (m.winner === 'new' ? 'new' : 'old') +
      ' regime. Amounts are rounded to the rupee and March carries the remainder.');
    table.appendChild(caption);

    var thead = el('thead');
    var hrow = el('tr');
    var heads = ['Month', 'Gross pay', 'Employee PF', 'Prof. tax', 'TDS', 'In hand'];
    for (var h = 0; h < heads.length; h++) {
      var th = el('th', null, heads[h]);
      th.setAttribute('scope', 'col');
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    for (var i = 0; i < m.months.length; i++) {
      var r = m.months[i];
      var tr = el('tr', r.isBonus ? 'is-bonus' : null);
      var mh = el('th', null, r.month + (r.isBonus ? ' · bonus' : ''));
      mh.setAttribute('scope', 'row');
      tr.appendChild(mh);
      tr.appendChild(el('td', null, inr(r.gross)));
      tr.appendChild(el('td', null, inr(r.pf)));
      tr.appendChild(el('td', null, inr(r.pt)));
      tr.appendChild(el('td', null, inr(r.tds)));
      tr.appendChild(el('td', 'sb-net', inr(r.net)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);
  }

  /* The sensitivity pass. Basic percentage is re-run across its whole range
     with everything else held still, because that is the one number in an
     offer letter that a candidate can sometimes actually move. */
  function renderSensitivity(m) {
    var host = document.getElementById('sb-sensitivity');
    host.textContent = '';
    if (m.ctc <= 0) return;

    var points = [];
    var lo = Infinity, hi = -Infinity, i;
    for (i = 20; i <= 60; i += 5) {
      var run = model(i);
      if (run.overCommitted) continue;
      points.push({ basicPct: i, inHand: run.inHandAnnual, pf: run.employeePf + run.employerPf });
      if (run.inHandAnnual < lo) lo = run.inHandAnnual;
      if (run.inHandAnnual > hi) hi = run.inHandAnnual;
    }
    if (!points.length) {
      host.appendChild(el('p', 'sb-note', 'Every basic percentage in this range ' +
        'over-commits the CTC at the moment. Lower the HRA percentage or the ' +
        'bonus and the curve reappears.'));
      return;
    }

    var wrap = el('div', 'sb-tablewrap');
    var table = el('table', 'sb-table sb-sens');
    table.appendChild(el('caption', null,
      'Annual in-hand and total PF at each basic percentage, with everything ' +
      'else held exactly as it is above. The highlighted row is your current setting.'));
    var thead = el('thead');
    var hrow = el('tr');
    var heads = ['Basic', 'Annual in hand', 'Against current', 'Total PF for the year'];
    for (var h = 0; h < heads.length; h++) {
      var th = el('th', null, heads[h]);
      th.setAttribute('scope', 'col');
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    var span = hi - lo || 1;
    for (i = 0; i < points.length; i++) {
      var p = points[i];
      var current = Math.abs(p.basicPct - m.basicPct) < 2.5;
      var tr = el('tr', current ? 'is-current' : null);
      var th2 = el('th', null, p.basicPct + '%');
      th2.setAttribute('scope', 'row');
      tr.appendChild(th2);

      var cell = el('td');
      var bar = el('span', 'sb-bar');
      var fill = el('i');
      fill.style.width = (12 + 88 * (p.inHand - lo) / span).toFixed(1) + '%';
      bar.appendChild(fill);
      cell.appendChild(bar);
      cell.appendChild(el('span', 'sb-bar-value', inr(p.inHand)));
      tr.appendChild(cell);

      var delta = p.inHand - m.inHandAnnual;
      tr.appendChild(el('td', null, Math.abs(delta) < 1 ? '—'
        : (delta > 0 ? '+' : '') + inr(delta)));
      tr.appendChild(el('td', null, inr(p.pf)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    host.appendChild(wrap);

    var first = points[0], last = points[points.length - 1];
    var note = el('p', 'sb-note');
    note.textContent = 'Between ' + first.basicPct + '% and ' + last.basicPct +
      '% of basic, annual in-hand moves by ' + inr(Math.abs(last.inHand - first.inHand)) +
      ' and total PF by ' + inr(Math.abs(last.pf - first.pf)) +
      '. A lower basic pays more cash now and builds less retirement, a smaller ' +
      'gratuity and a smaller HRA exemption. Neither end is the right answer; ' +
      'the point is that the CTC did not change and your position did.';
    host.appendChild(note);
  }

  /* -------------------------------------------------------------- self-test */

  function selfTest() {
    var checks = [];
    function assert(name, got, want) {
      checks.push({ name: name, ok: Math.abs(got - want) < 1, got: got, want: want });
    }

    assert('new regime slab tax at 12,00,000', slabTax(1200000, FY.newSlabs), 60000);
    assert('new regime total at 12,00,000 after 87A', computeTax(1200000, 'new').total, 0);
    assert('new regime marginal relief at 12,10,000', computeTax(1210000, 'new').total, 10400);
    assert('old regime total at 5,00,000 after 87A', computeTax(500000, 'old').total, 0);
    assert('old regime total at 10,00,000', computeTax(1000000, 'old').total, 117000);
    assert('old regime surcharge relief at 50,10,000', computeTax(5010000, 'old').total, 1375400);
    assert('new regime surcharge caps at 25%',
           surchargeBand(60000000, FY.surchargeNew).rate, 0.25);
    assert('old regime surcharge reaches 37%',
           surchargeBand(60000000, FY.surchargeOld).rate, 0.37);

    var worst = 0;
    for (var i = 0; i < PT_STATES.length; i++) {
      worst = Math.max(worst, ptAnnual(PT_STATES[i]));
    }
    checks.push({ name: 'no state exceeds the constitutional PT cap',
                  ok: worst <= FY.ptAnnualCap, got: worst, want: FY.ptAnnualCap });
    checks.push({ name: 'Indian digit grouping', ok: inr(1234567) === '₹12,34,567',
                  got: inr(1234567), want: '₹12,34,567' });

    var passed = 0, failed = 0;
    for (var c = 0; c < checks.length; c++) {
      if (checks[c].ok) passed++; else failed++;
    }
    return { checks: checks, passed: passed, failed: failed };
  }

  /* ------------------------------------------------------------------ wiring */

  var timer = null;
  var syncing = false;

  /* One gate for the whole lower half. When the inputs cannot produce an
     honest answer, the four result blocks say so in a sentence rather than
     rendering a comparison, a twelve-month table and a sensitivity curve all
     built on a special allowance that had to be clamped to zero. */
  function blockNotice(id, text) {
    var host = document.getElementById(id);
    host.textContent = '';
    host.appendChild(el('p', 'sb-note', text));
  }

  function recompute() {
    var m = model();
    render(m);
    headline(m);
    if (m.ctc <= 0 || m.overCommitted) {
      var why = m.ctc <= 0
        ? 'Waiting on a CTC. Everything below is computed from it.'
        : 'The components exceed the CTC, so there is nothing honest to put here yet.';
      document.getElementById('sb-regimes').textContent = '';
      document.getElementById('sb-verdict').textContent = why;
      blockNotice('sb-hra', why);
      blockNotice('sb-months', why);
      blockNotice('sb-sensitivity', why);
      return;
    }
    renderRegimes(m);
    renderHra(m);
    renderMonths(m);
    renderSensitivity(m);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(recompute, 140);
  }

  /* The slider and the number field are two views of one value. `syncing`
     stops the programmatic write to one from firing the other's handler and
     bouncing the value back, which on a range input reads as a stuck thumb. */
  function linkBasic() {
    var range = document.getElementById('sb-basicrange');
    var field = document.getElementById('sb-basicpct');
    range.addEventListener('input', function () {
      if (syncing) return;
      syncing = true;
      field.value = range.value;
      syncing = false;
      markCustom();
      schedule();
    });
    field.addEventListener('input', function () {
      if (syncing) return;
      syncing = true;
      range.value = field.value;
      syncing = false;
      markCustom();
      schedule();
    });
  }

  function markCustom() {
    var sel = document.getElementById('sb-preset');
    if (sel && sel.value !== 'custom') sel.value = 'custom';
  }

  function applyPreset(id) {
    var p = PRESETS[id];
    if (!p) return;
    syncing = true;
    document.getElementById('sb-basicpct').value = p.basicPct;
    document.getElementById('sb-basicrange').value = p.basicPct;
    document.getElementById('sb-hrapct').value = p.hraPct;
    document.getElementById('sb-epfinctc').checked = p.employerPfInCtc;
    document.getElementById('sb-pfbase').value = p.pfBase;
    document.getElementById('sb-gratuity').checked = p.gratuityInCtc;
    syncing = false;
    document.getElementById('sb-presetnote').textContent = p.note;
    recompute();
  }

  LabTool.define({
    id: 'salarytool',
    run: recompute,
    onReady: function () {
      /* The financial year is written into the page from FY.label so the
         banner, the toolbar chip and the section headings can never disagree
         with the slabs actually used. The HTML carries the same string as
         static text so a no-JS reader still sees a year; this overwrites it. */
      var labels = document.querySelectorAll('[data-fy-label]');
      for (var i = 0; i < labels.length; i++) labels[i].textContent = FY.label;
      var longs = document.querySelectorAll('[data-fy-long]');
      for (var j = 0; j < longs.length; j++) longs[j].textContent = FY.long;

      var stateSel = document.getElementById('sb-state');
      for (var s = 0; s < PT_STATES.length; s++) {
        var opt = document.createElement('option');
        opt.value = PT_STATES[s].id;
        opt.textContent = PT_STATES[s].name;
        stateSel.appendChild(opt);
      }
      stateSel.value = 'mh';

      var bonusSel = document.getElementById('sb-bonusmonth');
      for (var b = 0; b < MONTHS.length; b++) {
        var mopt = document.createElement('option');
        mopt.value = String(b);
        mopt.textContent = MONTHS[b];
        bonusSel.appendChild(mopt);
      }
      bonusSel.value = '8';

      var ids = ['sb-ctc', 'sb-hrapct', 'sb-bonus', 'sb-bonusmonth', 'sb-reimb',
                 'sb-epfinctc', 'sb-pfbase', 'sb-gratuity', 'sb-metro', 'sb-rent',
                 'sb-state', 'sb-80c', 'sb-80d', 'sb-nps', 'sb-24b'];
      for (var k = 0; k < ids.length; k++) {
        var node = document.getElementById(ids[k]);
        if (!node) continue;
        node.addEventListener('input', function () { markCustom(); schedule(); });
        node.addEventListener('change', function () { markCustom(); schedule(); });
      }

      linkBasic();

      var preset = document.getElementById('sb-preset');
      preset.addEventListener('change', function () {
        if (preset.value !== 'custom') applyPreset(preset.value);
      });

      var chip = document.getElementById('tool-selftest');
      if (chip) {
        var result = selfTest();
        chip.textContent = result.failed
          ? result.failed + ' of ' + result.checks.length + ' self-checks FAILED'
          : result.passed + ' self-checks pass';
        chip.className = 'lab-status ' + (result.failed ? 'is-err' : 'is-ok');
      }

      applyPreset('it');
    }
  });
})(typeof self !== 'undefined' ? self : this);

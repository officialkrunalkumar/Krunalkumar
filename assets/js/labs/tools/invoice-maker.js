/* ==========================================================================
   invoice-maker.js — the GST invoice and quotation maker on
   /labs/invoice-maker.
   --------------------------------------------------------------------------
   Same shape as the resume and biodata makers: one state object, four print
   templates, and the browser's print dialog as the export button. Nothing is
   uploaded, because there is no server to upload to.

   What is different here is the arithmetic. Every free invoice generator I
   have used gets the same thing wrong: it prints CGST and SGST no matter who
   the buyer is. Under GST the split is decided by comparing the supplier's
   state with the PLACE OF SUPPLY — same state means CGST plus SGST, different
   states means IGST, and a union territory without a legislature takes UTGST
   in place of SGST. Getting that backwards is not cosmetic; it is a wrong
   return for both sides. So the split is computed from two state codes, the
   decision is shown on screen in words, and the tool refuses to guess when
   either state is missing rather than defaulting to something plausible.

   Money is held in PAISE as integers from the first multiplication to the
   last. 0.1 + 0.2 is a funny story in a blog post and a rejected invoice in
   an accounts department. Line amounts, the discount allocation and each tax
   half are rounded once, at defined points, and the invoice-level round-off
   to the nearest rupee is printed as its own line so the total can always be
   reconciled from the numbers above it.

   Rendering rule, inherited from the other two makers: user text goes through
   document.createElement and textContent ONLY. Nothing anyone types is ever
   concatenated into markup — a line item WILL one day contain an angle
   bracket, and the correct outcome is that it prints.

   Storage: a draft can be saved to localStorage, but only when the visitor
   presses Save, and it is never loaded automatically — see the comment above
   loadDraft() for why that matters on a shared machine. There is no URL
   encoding of the form anywhere in this file, deliberately: bank details are
   one of the fields, and a "share this invoice" link would put them in
   browser history, in server logs and in whatever chat app carried it.
   ========================================================================== */

(function () {
  'use strict';

  var app = document.getElementById('invoicemaker');
  if (!app) return;

  /* The draft lives under one key and is written only on an explicit Save.
     Versioned in the name so a future format change can ignore old drafts
     instead of half-reading them. */
  var DRAFT_KEY = 'lab.invoice-maker.draft.v1';

  /* A4 at CSS's 96dpi: 210mm x 297mm. The sheet is laid out at this size and
     scaled down on screen, so the preview is the print, shrunk — not a
     reflowed approximation of it. A4 only: an Indian GST invoice on US Letter
     is not a thing anyone has asked me for. */
  var SHEET_W = 794;
  var SHEET_H = 1123;

  /* GST state codes. Two deliberate absences: 25 (Daman and Diu) and 28 (the
     old undivided Andhra Pradesh) are dead codes — 25 was folded into 26 when
     the union territories merged, and 28 was split into 36 and 37. Offering a
     dead code would produce a GSTIN prefix that no longer validates anywhere.

     `ut: true` marks a union territory WITHOUT its own legislature, where the
     state half of an intra-state supply is UTGST rather than SGST. Delhi,
     Puducherry and Jammu and Kashmir have legislatures, so they take SGST and
     are correctly absent from that flag — this is the detail almost every
     free generator misses. */
  var STATES = [
    { code: '01', name: 'Jammu and Kashmir' },
    { code: '02', name: 'Himachal Pradesh' },
    { code: '03', name: 'Punjab' },
    { code: '04', name: 'Chandigarh', ut: true },
    { code: '05', name: 'Uttarakhand' },
    { code: '06', name: 'Haryana' },
    { code: '07', name: 'Delhi' },
    { code: '08', name: 'Rajasthan' },
    { code: '09', name: 'Uttar Pradesh' },
    { code: '10', name: 'Bihar' },
    { code: '11', name: 'Sikkim' },
    { code: '12', name: 'Arunachal Pradesh' },
    { code: '13', name: 'Nagaland' },
    { code: '14', name: 'Manipur' },
    { code: '15', name: 'Mizoram' },
    { code: '16', name: 'Tripura' },
    { code: '17', name: 'Meghalaya' },
    { code: '18', name: 'Assam' },
    { code: '19', name: 'West Bengal' },
    { code: '20', name: 'Jharkhand' },
    { code: '21', name: 'Odisha' },
    { code: '22', name: 'Chhattisgarh' },
    { code: '23', name: 'Madhya Pradesh' },
    { code: '24', name: 'Gujarat' },
    { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', ut: true },
    { code: '27', name: 'Maharashtra' },
    { code: '29', name: 'Karnataka' },
    { code: '30', name: 'Goa' },
    { code: '31', name: 'Lakshadweep', ut: true },
    { code: '32', name: 'Kerala' },
    { code: '33', name: 'Tamil Nadu' },
    { code: '34', name: 'Puducherry' },
    { code: '35', name: 'Andaman and Nicobar Islands', ut: true },
    { code: '36', name: 'Telangana' },
    { code: '37', name: 'Andhra Pradesh' },
    { code: '38', name: 'Ladakh', ut: true },
    { code: '97', name: 'Other Territory', ut: true }
  ];

  var STATE_BY_CODE = {};
  STATES.forEach(function (s) { STATE_BY_CODE[s.code] = s; });

  var TAX_RATES = [0, 5, 12, 18, 28];
  var TEMPLATES = ['plain', 'ledger', 'banded', 'compact'];
  var ACCENTS = ['#1d4ed8', '#0f766e', '#9f1239', '#166534', '#334155', '#b45309'];

  /* The four tax situations a small Indian supplier is actually in. Each one
     changes the document's own name, which is a legal distinction rather than
     a styling one: only a registered person issues a TAX INVOICE, and a
     composition dealer must issue a BILL OF SUPPLY and may not collect tax. */
  var TAX_MODES = {
    gst: {
      label: 'Registered — charge GST',
      title: 'TAX INVOICE',
      note: ''
    },
    export: {
      label: 'Export or SEZ under LUT — zero rated',
      title: 'TAX INVOICE',
      note: 'Supply meant for export / SEZ under Letter of Undertaking without payment of integrated tax. Zero rated.'
    },
    unregistered: {
      label: 'Not registered for GST — below the threshold',
      title: 'INVOICE',
      note: 'Not registered under GST. No tax has been charged on this document.'
    },
    composition: {
      label: 'Composition scheme — bill of supply',
      title: 'BILL OF SUPPLY',
      note: 'Composition taxable person, not eligible to collect tax on supplies.'
    }
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  function blankItem() {
    return { desc: '', hsn: '', qty: '1', unit: '', rate: '', taxRate: '18' };
  }

  function blankState() {
    return {
      docType: 'invoice',
      template: 'plain',
      accent: ACCENTS[0],
      taxMode: 'gst',
      revCharge: false,

      bizName: '', bizAddress: '', bizState: '', bizGstin: '', bizPan: '',
      bizUdyam: '', bizPhone: '', bizEmail: '', bizWeb: '', logo: '',

      clientName: '', clientAddress: '', clientState: '', clientGstin: '',
      clientPhone: '', clientEmail: '',
      /* Empty means "same as the buyer's state", which is the common case for
         goods. Services under section 12 of the IGST Act can land elsewhere,
         so it is a separate field rather than an assumption. */
      pos: '',

      docNumber: '', docDate: '', terms: '15', termsDays: '30',
      poRef: '', copyLabel: '',

      items: [blankItem()],

      discountType: 'amt', discountValue: '',
      notes: '', bank: '', termsText: '', signName: ''
    };
  }

  var state = blankState();

  /* Merge anything loaded — a draft or an imported .json — onto a fresh blank,
     so a file written by an older build never leaves a field undefined, and a
     file somebody edited by hand cannot smuggle in an unknown template or a
     list of non-objects. */
  function normalizeState(saved) {
    var base = blankState();
    if (!saved || typeof saved !== 'object') return base;
    Object.keys(base).forEach(function (k) {
      if (saved[k] !== undefined && saved[k] !== null) base[k] = saved[k];
    });
    if (TEMPLATES.indexOf(base.template) < 0) base.template = 'plain';
    if (!TAX_MODES[base.taxMode]) base.taxMode = 'gst';
    if (base.docType !== 'quotation') base.docType = 'invoice';
    base.revCharge = base.revCharge === true;
    if (!Array.isArray(base.items)) base.items = [blankItem()];
    base.items = base.items.filter(function (it) {
      return it && typeof it === 'object';
    });
    if (!base.items.length) base.items = [blankItem()];
    base.items = base.items.map(function (it) {
      var row = blankItem();
      Object.keys(row).forEach(function (k) {
        if (it[k] !== undefined && it[k] !== null) row[k] = String(it[k]);
      });
      if (TAX_RATES.indexOf(parseFloat(row.taxRate)) < 0) row.taxRate = '18';
      return row;
    });
    if (base.discountType !== 'pct') base.discountType = 'amt';
    if (!STATE_BY_CODE[base.bizState]) base.bizState = '';
    if (!STATE_BY_CODE[base.clientState]) base.clientState = '';
    if (!STATE_BY_CODE[base.pos]) base.pos = '';
    return base;
  }

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null && text !== '') n.textContent = text;
    return n;
  }

  function clean(v) { return String(v === undefined || v === null ? '' : v).trim(); }

  /* Anything unparseable is zero rather than NaN. A NaN loose in the totals
     turns the whole invoice into "NaN", which reads as a broken tool; a zero
     reads as an empty field, which is what it is. */
  function num(v) {
    var n = parseFloat(String(v).replace(/[, ]/g, ''));
    return isFinite(n) ? n : 0;
  }

  /* Indian digit grouping: last three, then twos. 1234567.89 -> 12,34,567.89 */
  function groupIndian(intStr) {
    if (intStr.length <= 3) return intStr;
    var last3 = intStr.slice(-3);
    var rest = intStr.slice(0, -3);
    return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }

  function money(paise) {
    var neg = paise < 0;
    var p = Math.abs(Math.round(paise));
    var frac = p % 100;
    return (neg ? '-' : '') + groupIndian(String(Math.floor(p / 100))) +
           '.' + (frac < 10 ? '0' + frac : String(frac));
  }

  function rupee(paise) { return '₹' + money(paise); }

  function fmtQty(q) {
    var s = (Math.round(q * 1000) / 1000).toFixed(3);
    return s.replace(/0+$/, '').replace(/\.$/, '');
  }

  /* Rate labels stay integers where they are integers: "18%" not "18.00%". */
  function fmtRate(r) {
    return (Math.round(r * 100) / 100) + '%';
  }

  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
    'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
    'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
    'Eighty', 'Ninety'];

  function twoWords(n) {
    if (n < 20) return ONES[n];
    var t = TENS[Math.floor(n / 10)];
    var o = ONES[n % 10];
    return o ? t + ' ' + o : t;
  }

  function threeWords(n) {
    var h = Math.floor(n / 100);
    var r = n % 100;
    var out = h ? ONES[h] + ' Hundred' : '';
    if (r) out += (out ? ' ' : '') + twoWords(r);
    return out;
  }

  /* Indian numbering, so thousand -> lakh -> crore, and crore recurses because
     a hundred-crore invoice still has to read correctly even though nobody is
     printing one from this page. */
  function indianWords(n) {
    if (n === 0) return 'Zero';
    if (n < 1000) return threeWords(n);
    if (n < 100000) {
      var t = Math.floor(n / 1000), rt = n % 1000;
      return threeWords(t) + ' Thousand' + (rt ? ' ' + threeWords(rt) : '');
    }
    if (n < 10000000) {
      var l = Math.floor(n / 100000), rl = n % 100000;
      return threeWords(l) + ' Lakh' + (rl ? ' ' + indianWords(rl) : '');
    }
    var c = Math.floor(n / 10000000), rc = n % 10000000;
    return indianWords(c) + ' Crore' + (rc ? ' ' + indianWords(rc) : '');
  }

  function amountInWords(rupees) {
    if (rupees < 0) return 'Minus ' + amountInWords(-rupees);
    return 'Rupees ' + indianWords(rupees) + ' Only';
  }

  function stateName(code) {
    var s = STATE_BY_CODE[code];
    return s ? s.name + ' (' + s.code + ')' : '';
  }

  /* ------------------------------------------------------------------
     GSTIN and PAN

     A GSTIN is 15 characters: two state-code digits, the ten-character PAN of
     the holder, an entity number, a fixed 'Z', and a check character. The
     check character is a base-36 Luhn-ish digit over the first fourteen, and
     checking it catches the ordinary typo that a length check does not — a
     transposed pair still has fifteen characters.

     Nothing here blocks anything. A wrong GSTIN is the visitor's to fix, and a
     tool that refused to print because it disagreed with a number would be
     worse than one that prints a warning next to it.
     ------------------------------------------------------------------ */

  var GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
  var PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

  function gstinCheckChar(first14) {
    var sum = 0;
    for (var i = 0; i < 14; i++) {
      var v = GST_CHARS.indexOf(first14.charAt(i));
      if (v < 0) return null;
      var p = v * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return GST_CHARS.charAt((36 - (sum % 36)) % 36);
  }

  /* Returns { level: 'ok' | 'warn' | 'err', text: '...' } or null when the
     field is empty — an empty GSTIN is a legitimate state (an unregistered
     buyer), not an error to nag about. */
  function checkGstin(raw, expectStateCode) {
    var g = clean(raw).toUpperCase();
    if (!g) return null;
    if (g.length !== 15) {
      return { level: 'err', text: 'A GSTIN is 15 characters; this one is ' + g.length + '.' };
    }
    if (!GSTIN_RE.test(g)) {
      return { level: 'err', text: 'Not the GSTIN pattern: 2 digits, then a PAN, then an entity digit, Z, and a check character.' };
    }
    if (!STATE_BY_CODE[g.slice(0, 2)]) {
      return { level: 'err', text: 'State code ' + g.slice(0, 2) + ' is not a GST state code.' };
    }
    var want = gstinCheckChar(g.slice(0, 14));
    if (want && want !== g.charAt(14)) {
      return { level: 'err', text: 'Check character should be ' + want + ', not ' + g.charAt(14) + ' — usually a typo.' };
    }
    if (expectStateCode && g.slice(0, 2) !== expectStateCode) {
      return {
        level: 'warn',
        text: 'This GSTIN begins ' + g.slice(0, 2) + ' (' +
              (STATE_BY_CODE[g.slice(0, 2)].name) + ') but the state chosen is ' +
              stateName(expectStateCode) + '.'
      };
    }
    return { level: 'ok', text: 'Format and check character are valid.' };
  }

  function checkPan(raw, gstin) {
    var p = clean(raw).toUpperCase();
    if (!p) return null;
    if (!PAN_RE.test(p)) {
      return { level: 'err', text: 'A PAN is five letters, four digits, one letter.' };
    }
    var g = clean(gstin).toUpperCase();
    if (g.length === 15 && g.slice(2, 12) !== p) {
      return { level: 'warn', text: 'Your GSTIN carries the PAN ' + g.slice(2, 12) + ', which is not this one.' };
    }
    return { level: 'ok', text: 'Valid PAN format.' };
  }

  /* ------------------------------------------------------------------
     Dates
     ------------------------------------------------------------------ */

  /* The date inputs hand back 'YYYY-MM-DD'. Parsed in UTC on purpose: new
     Date('2026-03-01') is UTC midnight, and printing it through local time in
     any negative offset silently shows 28 February. */
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(s));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isFinite(d.getTime()) ? d : null;
  }

  function fmtDate(d) {
    if (!d) return '';
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function addDays(d, n) {
    return new Date(d.getTime() + n * 86400000);
  }

  function termDays() {
    if (state.terms === 'receipt') return 0;
    if (state.terms === 'custom') return Math.max(0, Math.round(num(state.termsDays)));
    return Math.max(0, Math.round(num(state.terms)));
  }

  function dueDate() {
    var d = parseISO(state.docDate);
    if (!d) return null;
    if (state.terms === 'receipt') return d;
    return addDays(d, termDays());
  }

  function termsLabel() {
    if (state.terms === 'receipt') {
      return state.docType === 'quotation' ? 'Valid on the day of issue' : 'Due on receipt';
    }
    var n = termDays();
    return state.docType === 'quotation'
      ? 'Valid for ' + n + ' days'
      : 'Net ' + n + ' days';
  }

  /* ------------------------------------------------------------------
     The GST decision and the totals.

     Everything below works in paise integers. The only floating-point steps
     are the two multiplications that produce a line amount and a tax amount,
     and each is rounded to a whole paisa immediately.
     ------------------------------------------------------------------ */

  function placeOfSupply() {
    return state.pos || state.clientState || '';
  }

  /* 'intra' — one state, CGST + SGST (or UTGST)
     'inter' — two states, IGST
     'zero'  — export or SEZ under LUT: rates apply, tax is nil
     'none'  — unregistered or composition: no GST on the document at all
     'unknown' — a state is missing, and guessing is how the wrong tax gets
                 charged, so the tool says so instead. */
  function taxSplit() {
    if (state.taxMode === 'unregistered' || state.taxMode === 'composition') return 'none';
    if (state.taxMode === 'export') return 'zero';
    var supplier = state.bizState;
    var place = placeOfSupply();
    if (!supplier || !place) return 'unknown';
    return supplier === place ? 'intra' : 'inter';
  }

  /* SGST or UTGST for the state half. Decided by the SUPPLIER's state, since
     an intra-state supply has both parties in the same territory anyway. */
  function stateHalfName() {
    var s = STATE_BY_CODE[state.bizState];
    return s && s.ut ? 'UTGST' : 'SGST';
  }

  function computeDoc() {
    var split = taxSplit();
    var taxed = split === 'intra' || split === 'inter';
    var rows = [];
    var subtotal = 0;
    var i;

    for (i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      /* A row with a quantity but no description and no rate is the blank one
         the form opens with; printing it as a dash on the document would be
         the tool inventing a line item. */
      if (!clean(it.desc) && !num(it.rate)) continue;
      var qty = num(it.qty);
      var rate = num(it.rate);
      var amount = Math.round(qty * rate * 100);
      rows.push({
        desc: clean(it.desc),
        hsn: clean(it.hsn),
        unit: clean(it.unit),
        qty: qty,
        rate: rate,
        taxRate: taxed ? num(it.taxRate) : 0,
        shownRate: num(it.taxRate),
        amount: amount,
        discount: 0,
        taxable: amount,
        cgst: 0, sgst: 0, igst: 0, total: amount
      });
      subtotal += amount;
    }

    /* Invoice-level discount, allocated back across the lines in proportion to
       their value, because GST is charged on the discounted taxable value —
       not on the gross and then reduced. Largest-remainder allocation so the
       shares add up to the discount exactly rather than to a paisa either
       side of it. */
    var discount = 0;
    if (subtotal > 0) {
      discount = state.discountType === 'pct'
        ? Math.round(subtotal * num(state.discountValue) / 100)
        : Math.round(num(state.discountValue) * 100);
      if (discount < 0) discount = 0;
      if (discount > subtotal) discount = subtotal;
    }

    if (discount > 0) {
      var allocated = 0;
      var remainders = [];
      for (i = 0; i < rows.length; i++) {
        var exact = discount * rows[i].amount / subtotal;
        var floorShare = Math.floor(exact);
        rows[i].discount = floorShare;
        allocated += floorShare;
        remainders.push({ i: i, frac: exact - floorShare });
      }
      remainders.sort(function (a, b) { return b.frac - a.frac; });
      var leftover = discount - allocated;
      for (i = 0; i < leftover && i < remainders.length; i++) {
        rows[remainders[i].i].discount += 1;
      }
    }

    var taxableTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
    var byRate = {};
    var rateOrder = [];

    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      r.taxable = r.amount - r.discount;
      if (split === 'intra') {
        /* Each half is computed from the taxable value at half the rate,
           independently, which is how the portals do it. Summing the two is
           therefore the line's tax — never rate/2 of a pre-rounded total. */
        r.cgst = Math.round(r.taxable * (r.taxRate / 2) / 100);
        r.sgst = Math.round(r.taxable * (r.taxRate / 2) / 100);
      } else if (split === 'inter') {
        r.igst = Math.round(r.taxable * r.taxRate / 100);
      }
      r.total = r.taxable + r.cgst + r.sgst + r.igst;
      taxableTotal += r.taxable;
      cgstTotal += r.cgst;
      sgstTotal += r.sgst;
      igstTotal += r.igst;

      var key = String(r.shownRate);
      if (!byRate[key]) {
        byRate[key] = { rate: r.shownRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        rateOrder.push(key);
      }
      byRate[key].taxable += r.taxable;
      byRate[key].cgst += r.cgst;
      byRate[key].sgst += r.sgst;
      byRate[key].igst += r.igst;
    }

    rateOrder.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
    var summary = rateOrder.map(function (k) { return byRate[k]; });

    var taxTotal = cgstTotal + sgstTotal + igstTotal;
    var grandRaw = taxableTotal + taxTotal;
    /* Nearest rupee, and the difference is printed as its own line so anyone
       adding the column up by hand lands on the same number. */
    var grand = Math.round(grandRaw / 100) * 100;
    var roundOff = grand - grandRaw;

    return {
      split: split,
      rows: rows,
      summary: summary,
      subtotal: subtotal,
      discount: discount,
      taxableTotal: taxableTotal,
      cgst: cgstTotal, sgst: sgstTotal, igst: igstTotal,
      taxTotal: taxTotal,
      grandRaw: grandRaw,
      roundOff: roundOff,
      grand: grand
    };
  }

  /* ------------------------------------------------------------------
     Sheet building blocks — createElement and textContent throughout
     ------------------------------------------------------------------ */

  var sheet = document.getElementById('inv-sheet');
  var wrap = document.getElementById('inv-sheet-wrap');
  var status = document.getElementById('inv-status');
  var form = document.getElementById('inv-form');

  function docTitle() {
    if (state.docType === 'quotation') return 'QUOTATION';
    return TAX_MODES[state.taxMode].title;
  }

  function kv(parent, label, value) {
    var v = clean(value);
    if (!v) return;
    var row = el('div', 'inv-s-kv');
    row.appendChild(el('span', 'inv-s-kv-k', label));
    row.appendChild(el('span', 'inv-s-kv-v', v));
    parent.appendChild(row);
  }

  function partyBlock(title, lines) {
    var box = el('div', 'inv-s-party');
    box.appendChild(el('div', 'inv-s-party-h', title));
    lines.forEach(function (line) {
      if (!clean(line.value)) return;
      var p = el('div', line.strong ? 'inv-s-party-name' : 'inv-s-party-line');
      p.textContent = (line.label ? line.label + ' ' : '') + clean(line.value);
      box.appendChild(p);
    });
    return box;
  }

  function logoNode() {
    if (!state.logo) return null;
    var box = el('div', 'inv-s-logo');
    var img = document.createElement('img');
    img.src = state.logo;
    img.alt = '';
    box.appendChild(img);
    return box;
  }

  function supplierLines() {
    return [
      { value: state.bizName, strong: true },
      { value: state.bizAddress },
      { value: stateName(state.bizState), label: 'State:' },
      { value: clean(state.bizGstin).toUpperCase(), label: 'GSTIN:' },
      { value: clean(state.bizPan).toUpperCase(), label: 'PAN:' },
      { value: state.bizUdyam, label: 'Udyam:' },
      { value: state.bizPhone, label: 'Phone:' },
      { value: state.bizEmail, label: 'Email:' },
      { value: state.bizWeb }
    ];
  }

  function clientLines() {
    return [
      { value: state.clientName, strong: true },
      { value: state.clientAddress },
      { value: stateName(state.clientState), label: 'State:' },
      { value: clean(state.clientGstin).toUpperCase(), label: 'GSTIN:' },
      { value: state.clientPhone, label: 'Phone:' },
      { value: state.clientEmail, label: 'Email:' }
    ];
  }

  function metaBlock(doc) {
    var box = el('div', 'inv-s-meta');
    kv(box, state.docType === 'quotation' ? 'Quotation no.' : 'Invoice no.', state.docNumber);
    var d = parseISO(state.docDate);
    kv(box, 'Date', fmtDate(d));
    var due = dueDate();
    if (due) {
      kv(box, state.docType === 'quotation' ? 'Valid until' : 'Due date', fmtDate(due));
    }
    kv(box, 'Terms', termsLabel());
    kv(box, 'Reference', state.poRef);
    var pos = placeOfSupply();
    if (pos && state.taxMode === 'gst') kv(box, 'Place of supply', stateName(pos));
    if (state.taxMode === 'gst') {
      kv(box, 'Reverse charge', state.revCharge ? 'Yes' : 'No');
    }
    if (doc.split === 'unknown') {
      box.appendChild(el('div', 'inv-s-caution',
        'Set your state and the place of supply — the CGST/SGST or IGST split cannot be decided without both.'));
    }
    return box;
  }

  function itemsTable(doc) {
    var taxed = doc.split === 'intra' || doc.split === 'inter';
    var table = el('table', 'inv-s-tbl');
    var thead = el('thead');
    var hr = el('tr');
    var heads = [
      { t: '#', c: 'inv-c-num' },
      { t: 'Description', c: 'inv-c-desc' },
      { t: 'HSN/SAC', c: 'inv-c-hsn' },
      { t: 'Qty', c: 'inv-c-n' },
      { t: 'Rate', c: 'inv-c-n' },
      { t: 'Taxable', c: 'inv-c-n' }
    ];
    if (taxed) {
      heads.push({ t: doc.split === 'inter' ? 'IGST' : 'CGST', c: 'inv-c-n' });
      if (doc.split === 'intra') heads.push({ t: stateHalfName(), c: 'inv-c-n' });
    } else if (doc.split === 'zero') {
      /* Zero rated still carries a tax column: the amount is nil, and the rate
         beside it is the one that would have applied without the LUT. */
      heads.push({ t: 'IGST', c: 'inv-c-n' });
    }
    heads.push({ t: 'Amount', c: 'inv-c-n' });
    heads.forEach(function (h) {
      var th = el('th', h.c, h.t);
      th.scope = 'col';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    doc.rows.forEach(function (r, i) {
      var tr = el('tr');
      tr.appendChild(el('td', 'inv-c-num', String(i + 1)));
      var descCell = el('td', 'inv-c-desc');
      descCell.appendChild(el('div', 'inv-s-desc', r.desc || '—'));
      if (r.discount) {
        descCell.appendChild(el('div', 'inv-s-descsub',
          'less discount ' + rupee(r.discount)));
      }
      tr.appendChild(descCell);
      tr.appendChild(el('td', 'inv-c-hsn', r.hsn));
      tr.appendChild(el('td', 'inv-c-n',
        fmtQty(r.qty) + (r.unit ? ' ' + r.unit : '')));
      tr.appendChild(el('td', 'inv-c-n', money(Math.round(r.rate * 100))));
      tr.appendChild(el('td', 'inv-c-n', money(r.taxable)));
      if (taxed) {
        if (doc.split === 'inter') {
          tr.appendChild(el('td', 'inv-c-n', money(r.igst) + ' (' + fmtRate(r.taxRate) + ')'));
        } else {
          tr.appendChild(el('td', 'inv-c-n', money(r.cgst) + ' (' + fmtRate(r.taxRate / 2) + ')'));
          tr.appendChild(el('td', 'inv-c-n', money(r.sgst) + ' (' + fmtRate(r.taxRate / 2) + ')'));
        }
      } else if (doc.split === 'zero') {
        tr.appendChild(el('td', 'inv-c-n', money(0) + ' (' + fmtRate(r.shownRate) + ')'));
      }
      tr.appendChild(el('td', 'inv-c-n inv-s-strong', money(r.total)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function totalsBlock(doc) {
    var box = el('div', 'inv-s-totals');
    function line(label, value, cls) {
      var row = el('div', 'inv-s-total-row' + (cls ? ' ' + cls : ''));
      row.appendChild(el('span', '', label));
      row.appendChild(el('span', '', value));
      box.appendChild(row);
    }
    line('Subtotal', rupee(doc.subtotal));
    if (doc.discount) line('Discount', '- ' + rupee(doc.discount));
    line('Taxable value', rupee(doc.taxableTotal));
    if (doc.split === 'intra') {
      line('CGST', rupee(doc.cgst));
      line(stateHalfName(), rupee(doc.sgst));
    } else if (doc.split === 'inter') {
      line('IGST', rupee(doc.igst));
    } else if (doc.split === 'zero') {
      line('IGST (zero rated)', rupee(0));
    }
    if (doc.roundOff) line('Round off', (doc.roundOff > 0 ? '+ ' : '- ') + rupee(Math.abs(doc.roundOff)));
    line(state.docType === 'quotation' ? 'Estimated total' : 'Total payable',
      rupee(doc.grand), 'inv-s-total-grand');
    return box;
  }

  function summaryTable(doc) {
    if (doc.split !== 'intra' && doc.split !== 'inter') return null;
    if (!doc.summary.length) return null;
    var box = el('div', 'inv-s-section');
    box.appendChild(el('div', 'inv-s-h', 'Tax rate summary'));
    var table = el('table', 'inv-s-tbl inv-s-tbl-sum');
    var thead = el('thead');
    var hr = el('tr');
    var heads = ['Rate', 'Taxable value'];
    if (doc.split === 'intra') {
      heads.push('CGST');
      heads.push(stateHalfName());
    } else {
      heads.push('IGST');
    }
    heads.push('Total tax');
    heads.forEach(function (h, i) {
      var th = el('th', i === 0 ? '' : 'inv-c-n', h);
      th.scope = 'col';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    doc.summary.forEach(function (s) {
      var tr = el('tr');
      tr.appendChild(el('td', '', fmtRate(s.rate)));
      tr.appendChild(el('td', 'inv-c-n', money(s.taxable)));
      if (doc.split === 'intra') {
        tr.appendChild(el('td', 'inv-c-n', money(s.cgst)));
        tr.appendChild(el('td', 'inv-c-n', money(s.sgst)));
      } else {
        tr.appendChild(el('td', 'inv-c-n', money(s.igst)));
      }
      tr.appendChild(el('td', 'inv-c-n', money(s.cgst + s.sgst + s.igst)));
      tbody.appendChild(tr);
    });
    var foot = el('tr', 'inv-s-sumfoot');
    foot.appendChild(el('td', '', 'Total'));
    foot.appendChild(el('td', 'inv-c-n', money(doc.taxableTotal)));
    if (doc.split === 'intra') {
      foot.appendChild(el('td', 'inv-c-n', money(doc.cgst)));
      foot.appendChild(el('td', 'inv-c-n', money(doc.sgst)));
    } else {
      foot.appendChild(el('td', 'inv-c-n', money(doc.igst)));
    }
    foot.appendChild(el('td', 'inv-c-n', money(doc.taxTotal)));
    tbody.appendChild(foot);
    table.appendChild(tbody);
    box.appendChild(table);
    return box;
  }

  function notesBlock(doc) {
    var box = el('div', 'inv-s-foot');

    var words = el('div', 'inv-s-words');
    words.appendChild(el('span', 'inv-s-words-k', 'Amount in words'));
    words.appendChild(el('span', 'inv-s-words-v',
      amountInWords(Math.round(doc.grand / 100))));
    box.appendChild(words);

    var cols = el('div', 'inv-s-footcols');
    var left = el('div', 'inv-s-footleft');

    var modeNote = TAX_MODES[state.taxMode].note;
    if (modeNote) {
      left.appendChild(el('div', 'inv-s-declare', modeNote));
    }
    if (clean(state.notes)) {
      left.appendChild(el('div', 'inv-s-h', 'Notes'));
      left.appendChild(el('div', 'inv-s-para', clean(state.notes)));
    }
    if (clean(state.bank)) {
      left.appendChild(el('div', 'inv-s-h', 'Payment details'));
      left.appendChild(el('div', 'inv-s-para', clean(state.bank)));
    }
    if (clean(state.termsText)) {
      left.appendChild(el('div', 'inv-s-h', 'Terms'));
      left.appendChild(el('div', 'inv-s-para', clean(state.termsText)));
    }
    if (clean(state.bizUdyam)) {
      /* The MSME line is why a small supplier can chase a 45-day payment under
         the MSMED Act at all, and it only helps if the number is on the paper
         the buyer files. */
      left.appendChild(el('div', 'inv-s-msme',
        'MSME / Udyam registered — Udyam Reg. No. ' + clean(state.bizUdyam) +
        '. Payment is due within the agreed terms under the MSMED Act, 2006.'));
    }
    cols.appendChild(left);

    var right = el('div', 'inv-s-sign');
    right.appendChild(el('div', 'inv-s-signfor',
      'For ' + (clean(state.bizName) || ' ')));
    right.appendChild(el('div', 'inv-s-signline'));
    right.appendChild(el('div', 'inv-s-signname',
      clean(state.signName) || 'Authorised signatory'));
    cols.appendChild(right);

    box.appendChild(cols);
    return box;
  }

  /* ---- the four templates ------------------------------------------------
     They differ in the head and in how the parties sit; everything below the
     items table is shared, because a total is a total in every design. The
     rest of the difference is CSS on .inv-t-<name>.
     ---------------------------------------------------------------------- */

  function headPlain(doc) {
    var head = el('div', 'inv-s-head');
    var left = el('div', 'inv-s-headleft');
    var logo = logoNode();
    if (logo) left.appendChild(logo);
    var name = clean(state.bizName);
    if (name) left.appendChild(el('div', 'inv-s-bizname', name));
    if (clean(state.bizAddress)) left.appendChild(el('div', 'inv-s-bizaddr', clean(state.bizAddress)));
    var meta = el('div', 'inv-s-headright');
    meta.appendChild(el('div', 'inv-s-title', docTitle()));
    if (clean(state.copyLabel)) meta.appendChild(el('div', 'inv-s-copy', clean(state.copyLabel)));
    meta.appendChild(metaBlock(doc));
    head.appendChild(left);
    head.appendChild(meta);
    sheet.appendChild(head);

    var parties = el('div', 'inv-s-parties');
    parties.appendChild(partyBlock('Billed by', supplierLines()));
    parties.appendChild(partyBlock('Billed to', clientLines()));
    sheet.appendChild(parties);
  }

  function headLedger(doc) {
    var band = el('div', 'inv-s-ledgerhead');
    var t = el('div', 'inv-s-titlewrap');
    t.appendChild(el('div', 'inv-s-title', docTitle()));
    if (clean(state.copyLabel)) t.appendChild(el('div', 'inv-s-copy', clean(state.copyLabel)));
    band.appendChild(t);
    sheet.appendChild(band);

    var grid = el('div', 'inv-s-ledgergrid');
    var sup = el('div', 'inv-s-ledgercell');
    var logo = logoNode();
    if (logo) sup.appendChild(logo);
    sup.appendChild(partyBlock('Supplier', supplierLines()));
    var buyer = el('div', 'inv-s-ledgercell');
    buyer.appendChild(partyBlock('Buyer', clientLines()));
    var meta = el('div', 'inv-s-ledgercell');
    meta.appendChild(el('div', 'inv-s-party-h', 'Document'));
    meta.appendChild(metaBlock(doc));
    grid.appendChild(sup);
    grid.appendChild(buyer);
    grid.appendChild(meta);
    sheet.appendChild(grid);
  }

  function headBanded(doc) {
    var band = el('div', 'inv-s-band');
    var left = el('div', 'inv-s-bandleft');
    var logo = logoNode();
    if (logo) left.appendChild(logo);
    var txt = el('div');
    if (clean(state.bizName)) txt.appendChild(el('div', 'inv-s-bizname', clean(state.bizName)));
    if (clean(state.bizAddress)) txt.appendChild(el('div', 'inv-s-bizaddr', clean(state.bizAddress)));
    left.appendChild(txt);
    band.appendChild(left);
    var right = el('div', 'inv-s-bandright');
    right.appendChild(el('div', 'inv-s-title', docTitle()));
    if (clean(state.copyLabel)) right.appendChild(el('div', 'inv-s-copy', clean(state.copyLabel)));
    band.appendChild(right);
    sheet.appendChild(band);

    var body = el('div', 'inv-s-bandbody');
    var parties = el('div', 'inv-s-parties');
    parties.appendChild(partyBlock('Billed to', clientLines()));
    var metaWrap = el('div', 'inv-s-party');
    metaWrap.appendChild(el('div', 'inv-s-party-h', 'Document'));
    metaWrap.appendChild(metaBlock(doc));
    parties.appendChild(metaWrap);
    body.appendChild(parties);
    var supStrip = el('div', 'inv-s-supstrip');
    [stateName(state.bizState) ? 'State: ' + stateName(state.bizState) : '',
      clean(state.bizGstin) ? 'GSTIN: ' + clean(state.bizGstin).toUpperCase() : '',
      clean(state.bizPan) ? 'PAN: ' + clean(state.bizPan).toUpperCase() : '',
      clean(state.bizUdyam) ? 'Udyam: ' + clean(state.bizUdyam) : '',
      clean(state.bizPhone), clean(state.bizEmail), clean(state.bizWeb)]
      .filter(Boolean)
      .forEach(function (t2) { supStrip.appendChild(el('span', '', t2)); });
    if (supStrip.childNodes.length) body.appendChild(supStrip);
    sheet.appendChild(body);
  }

  var HEADS = {
    plain: headPlain,
    ledger: headLedger,
    banded: headBanded,
    compact: headPlain
  };

  function stateIsEmpty() {
    var simple = ['bizName', 'bizAddress', 'bizGstin', 'bizPan', 'bizUdyam',
      'bizPhone', 'bizEmail', 'bizWeb', 'logo', 'clientName', 'clientAddress',
      'clientGstin', 'docNumber', 'notes', 'bank', 'termsText', 'signName', 'poRef'];
    var filled = simple.some(function (k) { return clean(state[k]) !== ''; });
    if (filled) return false;
    return !state.items.some(function (it) {
      return clean(it.desc) !== '' || num(it.rate) !== 0;
    });
  }

  function renderSheet() {
    var doc = computeDoc();
    sheet.className = 'inv-sheet inv-t-' + state.template;
    sheet.style.setProperty('--inv-accent', state.accent);
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);

    if (stateIsEmpty()) {
      sheet.appendChild(el('div', 'inv-empty-hint',
        'Fill the form and the ' + (state.docType === 'quotation' ? 'quotation' : 'invoice') +
        ' appears here, exactly as it will print.'));
      fitPreview();
      renderChecks(doc);
      return;
    }

    HEADS[state.template](doc);

    var body = el('div', 'inv-s-body');
    body.appendChild(itemsTable(doc));
    body.appendChild(totalsBlock(doc));
    var sum = summaryTable(doc);
    if (sum) body.appendChild(sum);
    body.appendChild(notesBlock(doc));
    sheet.appendChild(body);

    fitPreview();
    renderChecks(doc);
  }

  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(function () {
      renderTimer = null;
      renderSheet();
    }, 150);
  }

  /* ------------------------------------------------------------------
     The checks panel — the GST decision in words, plus the GSTIN and PAN
     verdicts. On screen only; none of it prints, because it is advice about
     the document rather than part of it.
     ------------------------------------------------------------------ */

  var checksBox = document.getElementById('inv-checks');

  function checkLine(level, text) {
    var row = el('div', 'inv-check inv-check-' + level);
    row.appendChild(el('span', 'inv-check-dot', level === 'ok' ? '✓' :
      (level === 'err' ? '✗' : '!')));
    row.appendChild(el('span', 'inv-check-text', text));
    return row;
  }

  function renderChecks(doc) {
    while (checksBox.firstChild) checksBox.removeChild(checksBox.firstChild);

    if (doc.split === 'intra') {
      checksBox.appendChild(checkLine('ok',
        'Same state on both sides (' + stateName(state.bizState) + '), so this is an intra-state supply: CGST + ' +
        stateHalfName() + ', each at half the rate.'));
    } else if (doc.split === 'inter') {
      checksBox.appendChild(checkLine('ok',
        'Supplier in ' + stateName(state.bizState) + ', place of supply ' +
        stateName(placeOfSupply()) + ' — an inter-state supply, so IGST at the full rate.'));
    } else if (doc.split === 'zero') {
      checksBox.appendChild(checkLine('warn',
        'Export / SEZ under LUT: rates are shown but no tax is charged, and the zero-rated declaration prints on the document.'));
    } else if (doc.split === 'none') {
      checksBox.appendChild(checkLine('warn',
        state.taxMode === 'composition'
          ? 'Composition scheme: this prints as a Bill of Supply with no tax and the required declaration.'
          : 'Not registered: no GST is charged and the document prints as a plain invoice.'));
    } else {
      checksBox.appendChild(checkLine('err',
        'Choose your state and the place of supply. Until both are set the tool will not guess between CGST + SGST and IGST.'));
    }

    var biz = checkGstin(state.bizGstin, state.bizState);
    if (biz) checksBox.appendChild(checkLine(biz.level, 'Your GSTIN: ' + biz.text));
    else if (state.taxMode === 'gst') {
      checksBox.appendChild(checkLine('warn',
        'A tax invoice has to carry your GSTIN. Add it, or switch the tax treatment to "not registered".'));
    }

    var pan = checkPan(state.bizPan, state.bizGstin);
    if (pan) checksBox.appendChild(checkLine(pan.level, 'Your PAN: ' + pan.text));

    var cli = checkGstin(state.clientGstin, state.clientState);
    if (cli) checksBox.appendChild(checkLine(cli.level, 'Client GSTIN: ' + cli.text));

    if (state.docType === 'invoice' && !clean(state.docNumber)) {
      checksBox.appendChild(checkLine('warn',
        'An invoice needs a serial number, unique within the financial year.'));
    }
    if (!parseISO(state.docDate)) {
      checksBox.appendChild(checkLine('warn', 'No date set, so no due date can be worked out.'));
    }
    if (!doc.rows.length) {
      checksBox.appendChild(checkLine('warn', 'No line items yet.'));
    }
  }

  /* ------------------------------------------------------------------
     Preview scaling — the sheet is laid out at 794px and scaled to fit,
     with the wrapper given the scaled height so the page does not reserve
     the full unscaled 1123px underneath it.
     ------------------------------------------------------------------ */

  function fitPreview() {
    var w = wrap.clientWidth;
    if (!w) return;
    var scale = Math.min(1, w / SHEET_W);
    sheet.style.transform = 'scale(' + scale + ')';
    wrap.style.height = Math.ceil(sheet.offsetHeight * scale) + 'px';
  }

  var fitQueued = false;
  window.addEventListener('resize', function () {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(function () { fitQueued = false; fitPreview(); });
  });

  /* ------------------------------------------------------------------
     Print rules that cannot live in labs.css.

     labs.css is loaded by every lab page, so anything in it that is not
     scoped to this page would change how the other sixty print. Three rules
     genuinely cannot be scoped by a selector — @page, the root background,
     and main.css's body::before byline, which is right on an article and
     wrong on somebody's invoice — so they are injected here, on this page
     only, the same way the resume maker injects its paper size.
     ------------------------------------------------------------------ */

  var printStyle = document.createElement('style');
  printStyle.textContent =
    '@media print{' +
      '@page{size:A4;margin:0}' +
      'html{color-scheme:light !important}' +
      'html,body{background:#fff !important}' +
      'body::before{display:none !important;content:none !important}' +
    '}';
  document.head.appendChild(printStyle);

  /* ------------------------------------------------------------------
     Form: the fixed fields
     ------------------------------------------------------------------ */

  function fieldInputs() {
    return form.querySelectorAll('[data-key]');
  }

  /* The three state pickers are filled from one list rather than 111 hand-typed
     <option> elements. They must be populated before any value is written into
     them: assigning a value a <select> has no option for silently selects
     nothing, which would look like a draft that lost its state. */
  function populateStates() {
    var selects = [
      { id: 'inv-f-bizState', first: 'Select your state' },
      { id: 'inv-f-clientState', first: "Select the client's state" },
      { id: 'inv-f-pos', first: "Same as the client's state" }
    ];
    selects.forEach(function (spec) {
      var sel = document.getElementById(spec.id);
      if (!sel) return;
      var blank = document.createElement('option');
      blank.value = '';
      blank.textContent = spec.first;
      sel.appendChild(blank);
      STATES.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.code;
        opt.textContent = s.code + ' — ' + s.name + (s.ut ? ' (UT)' : '');
        sel.appendChild(opt);
      });
    });
  }

  function syncFixedFields() {
    var inputs = fieldInputs();
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var key = input.dataset.key;
      if (input.type === 'checkbox') input.checked = state[key] === true;
      else input.value = state[key] === undefined ? '' : state[key];
    }
    syncConditionalFields();
  }

  /* Two fields only make sense in one mode each. Hidden with the attribute so
     they leave the tab order rather than merely going invisible. */
  function syncConditionalFields() {
    var customDays = document.getElementById('inv-wrap-termsdays');
    customDays.hidden = state.terms !== 'custom';
    var gstRow = document.getElementById('inv-wrap-revcharge');
    gstRow.hidden = state.taxMode !== 'gst';
  }

  function onFieldChange(ev) {
    var t = ev.target;
    if (t.dataset && t.dataset.key) {
      state[t.dataset.key] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.dataset.key === 'terms' || t.dataset.key === 'taxMode') syncConditionalFields();
      /* The per-line GST rate is meaningless once the document carries no GST,
         so the whole column of selects leaves the form with the mode rather
         than sitting there inert. */
      if (t.dataset.key === 'taxMode') renderItems();
    } else if (t.dataset && t.dataset.field) {
      var card = t.closest('.inv-item');
      if (!card) return;
      var idx = parseInt(card.dataset.index, 10);
      if (state.items[idx]) state.items[idx][t.dataset.field] = t.value;
    } else {
      return;
    }
    scheduleRender();
  }

  /* Both events: `input` covers typing, `change` covers the selects and the
     date pickers on the browsers that only fire it there. Rendering is
     debounced anyway, so the double call costs nothing. */
  form.addEventListener('input', onFieldChange);
  form.addEventListener('change', onFieldChange);

  /* ------------------------------------------------------------------
     Form: the line items
     ------------------------------------------------------------------ */

  var itemsMount = document.getElementById('inv-items');

  var ITEM_FIELDS = [
    { f: 'desc', label: 'Description', ph: 'What you are billing for', full: true },
    { f: 'hsn', label: 'HSN / SAC', ph: '998314' },
    { f: 'qty', label: 'Qty', ph: '1', numeric: true },
    { f: 'unit', label: 'Unit', ph: 'hrs, nos, kg' },
    { f: 'rate', label: 'Rate (₹)', ph: '0.00', numeric: true },
    { f: 'taxRate', label: 'GST rate', select: true }
  ];

  function renderItems() {
    while (itemsMount.firstChild) itemsMount.removeChild(itemsMount.firstChild);
    /* Export under LUT keeps the rate picker even though the tax is nil: the
       document still states the rate that would otherwise have applied. */
    var showRate = state.taxMode === 'gst' || state.taxMode === 'export';
    state.items.forEach(function (item, idx) {
      var card = el('div', 'inv-item');
      card.dataset.index = String(idx);

      var head = el('div', 'inv-item-head');
      head.appendChild(el('span', 'inv-item-title', 'Item ' + (idx + 1)));
      var actions = el('div', 'inv-item-actions');

      var up = el('button', 'lab-btn inv-move', '↑');
      up.type = 'button';
      up.dataset.dir = 'up';
      up.setAttribute('aria-label', 'Move item ' + (idx + 1) + ' up');
      up.disabled = idx === 0;
      actions.appendChild(up);

      var down = el('button', 'lab-btn inv-move', '↓');
      down.type = 'button';
      down.dataset.dir = 'down';
      down.setAttribute('aria-label', 'Move item ' + (idx + 1) + ' down');
      down.disabled = idx === state.items.length - 1;
      actions.appendChild(down);

      var rm = el('button', 'lab-btn inv-remove', 'Remove');
      rm.type = 'button';
      rm.dataset.remove = '1';
      rm.setAttribute('aria-label', 'Remove item ' + (idx + 1));
      actions.appendChild(rm);

      head.appendChild(actions);
      card.appendChild(head);

      var grid = el('div', 'form-grid inv-grid');
      ITEM_FIELDS.forEach(function (fd) {
        if (fd.f === 'taxRate' && !showRate) return;
        var label = el('label', 'field' + (fd.full ? ' full' : ''));
        label.appendChild(el('span', '', fd.label));
        var input;
        if (fd.select) {
          input = document.createElement('select');
          TAX_RATES.forEach(function (r) {
            var opt = document.createElement('option');
            opt.value = String(r);
            opt.textContent = r + '%';
            input.appendChild(opt);
          });
          input.value = String(num(item.taxRate));
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.autocomplete = 'off';
          /* inputmode rather than type=number: a numeric keypad on a phone,
             without the scroll-wheel-changes-the-value trap or the browsers
             that silently blank a field they think is invalid. */
          if (fd.numeric) input.setAttribute('inputmode', 'decimal');
          if (fd.ph) input.placeholder = fd.ph;
          input.value = item[fd.f] || '';
        }
        input.dataset.field = fd.f;
        label.appendChild(input);
        grid.appendChild(label);
      });
      card.appendChild(grid);
      itemsMount.appendChild(card);
    });
  }

  document.getElementById('inv-item-add').addEventListener('click', function () {
    state.items.push(blankItem());
    renderItems();
    var last = itemsMount.lastChild && itemsMount.lastChild.querySelector('input');
    if (last) last.focus();
    scheduleRender();
  });

  itemsMount.addEventListener('click', function (ev) {
    var card = ev.target.closest('.inv-item');
    if (!card) return;
    var idx = parseInt(card.dataset.index, 10);

    var mv = ev.target.closest('[data-dir]');
    if (mv && !mv.disabled) {
      var to = idx + (mv.dataset.dir === 'up' ? -1 : 1);
      if (to < 0 || to >= state.items.length) return;
      var moved = state.items.splice(idx, 1)[0];
      state.items.splice(to, 0, moved);
      renderItems();
      /* The click destroyed the button under the pointer. Put focus on the
         same-direction button of the row in its new slot, so Enter can be
         tapped repeatedly to walk a line item up the list; at the end of the
         list that button is disabled, so fall back to its opposite rather
         than dropping focus to <body>. */
      var landed = itemsMount.children[to];
      if (landed) {
        var next = landed.querySelector('[data-dir="' + mv.dataset.dir + '"]');
        if (next && next.disabled) {
          next = landed.querySelector('[data-dir="' +
            (mv.dataset.dir === 'up' ? 'down' : 'up') + '"]');
        }
        if (next && !next.disabled) next.focus();
      }
      scheduleRender();
      return;
    }

    if (ev.target.closest('[data-remove]')) {
      state.items.splice(idx, 1);
      if (!state.items.length) state.items.push(blankItem());
      renderItems();
      scheduleRender();
    }
  });

  /* ------------------------------------------------------------------
     Logo: FileReader, downscaled on a canvas, kept as a data URL. 320px on
     the long side is more than the 130px it ever prints at, and small enough
     that the exported .json stays a file you can email yourself.
     ------------------------------------------------------------------ */

  var logoInput = document.getElementById('inv-f-logo');
  var logoBox = document.getElementById('inv-logo-box');
  var logoThumb = document.getElementById('inv-logo-thumb');
  var logoRemove = document.getElementById('inv-logo-remove');

  function syncLogoUI() {
    if (state.logo) {
      logoThumb.src = state.logo;
      logoBox.hidden = false;
    } else {
      logoThumb.removeAttribute('src');
      logoBox.hidden = true;
    }
  }

  logoInput.addEventListener('change', function () {
    var file = logoInput.files && logoInput.files[0];
    if (!file) return;
    var reader = new FileReader();

    function failed() {
      logoInput.value = '';
      say('That file could not be read as an image. Logos exported from some design tools are HEIC or SVG-in-a-zip; re-save it as PNG or JPEG.', 'err');
    }

    reader.onerror = failed;
    reader.onload = function () {
      var img = new Image();
      img.onerror = failed;
      img.onload = function () {
        var max = 320;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        /* PNG, not JPEG: a logo is usually a transparent mark on nothing, and
           a JPEG would composite it onto black and ring the edges with
           artefacts. Bigger file, correct logo. */
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        state.logo = canvas.toDataURL('image/png');
        syncLogoUI();
        renderSheet();
        say('Logo added — resized in your browser, never uploaded.', 'ok');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  logoRemove.addEventListener('click', function () {
    state.logo = '';
    logoInput.value = '';
    syncLogoUI();
    renderSheet();
  });

  /* ------------------------------------------------------------------
     Toolbar
     ------------------------------------------------------------------ */

  var modeButtons = app.querySelectorAll('.inv-mode');
  var tplButtons = app.querySelectorAll('.inv-tpl');
  var swatches = app.querySelectorAll('.inv-swatch');

  function say(text, level) {
    status.textContent = text || '';
    status.className = 'inv-status' + (level ? ' is-' + level : '');
  }

  function syncToolbar() {
    var i;
    for (i = 0; i < modeButtons.length; i++) {
      modeButtons[i].setAttribute('aria-pressed',
        String(modeButtons[i].dataset.doc === state.docType));
    }
    for (i = 0; i < tplButtons.length; i++) {
      tplButtons[i].setAttribute('aria-pressed',
        String(tplButtons[i].dataset.template === state.template));
    }
    for (i = 0; i < swatches.length; i++) {
      swatches[i].setAttribute('aria-pressed',
        String(swatches[i].dataset.accent.toLowerCase() ===
               String(state.accent).toLowerCase()));
    }
    var title = document.getElementById('inv-preview-title');
    if (title) {
      title.textContent = 'Live preview — A4, ' +
        (state.docType === 'quotation' ? 'quotation' : 'invoice');
    }
  }

  function bindAll(nodes, handler) {
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', handler);
    }
  }

  bindAll(modeButtons, function (ev) {
    state.docType = ev.currentTarget.dataset.doc;
    syncToolbar();
    renderSheet();
  });

  bindAll(tplButtons, function (ev) {
    state.template = ev.currentTarget.dataset.template;
    syncToolbar();
    renderSheet();
  });

  bindAll(swatches, function (ev) {
    state.accent = ev.currentTarget.dataset.accent;
    syncToolbar();
    renderSheet();
  });

  function syncEverything() {
    syncFixedFields();
    renderItems();
    syncLogoUI();
    syncToolbar();
    renderSheet();
  }

  /* ------------------------------------------------------------------
     Example data. Entirely fictional, and never my own details — the GSTINs
     below are shaped correctly and carry valid check characters so the
     validator has something real to chew on, but they belong to nobody.
     ------------------------------------------------------------------ */

  function sampleState() {
    var s = blankState();
    s.template = state.template;
    s.accent = state.accent;
    s.docType = state.docType;
    s.bizName = 'Nayan Studio';
    s.bizAddress = '204, Silver Arcade, CG Road\nAhmedabad 380009';
    s.bizState = '24';
    s.bizGstin = '24AAQCS1234H1ZE';
    s.bizPan = 'AAQCS1234H';
    s.bizUdyam = 'UDYAM-GJ-01-0001234';
    s.bizPhone = '+91 98250 00000';
    s.bizEmail = 'accounts@example.com';
    s.bizWeb = 'nayanstudio.example';
    s.clientName = 'Bluepeak Retail Private Limited';
    s.clientAddress = 'Unit 7, Andheri East\nMumbai 400069';
    s.clientState = '27';
    s.clientGstin = '27AABCB1429B1ZB';
    s.clientEmail = 'ap@example.com';
    s.docNumber = 'NS/2026-27/014';
    s.docDate = todayISO();
    s.terms = '15';
    s.poRef = 'PO-88213';
    s.copyLabel = 'Original for Recipient';
    s.items = [
      { desc: 'Brand identity design — logo, type scale and colour system', hsn: '998391', qty: '1', unit: 'job', rate: '85000', taxRate: '18' },
      { desc: 'Packaging artwork, six SKUs', hsn: '998391', qty: '6', unit: 'nos', rate: '7500', taxRate: '18' },
      { desc: 'Printed brand manual, spiral bound', hsn: '4911', qty: '4', unit: 'nos', rate: '1200', taxRate: '12' }
    ];
    s.discountType = 'pct';
    s.discountValue = '5';
    s.notes = 'Includes two rounds of revisions. Additional rounds are billed at the hourly rate agreed in the engagement note.';
    s.bank = 'Bank: Example Bank, CG Road branch\nAccount name: Nayan Studio\nUPI: nayanstudio@examplebank';
    s.termsText = 'Payment within 15 days of the invoice date. Interest at 1.5% per month on overdue amounts.';
    s.signName = 'Nayan Desai';
    return s;
  }

  function todayISO() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  document.getElementById('inv-load-sample').addEventListener('click', function () {
    if (!stateIsEmpty() &&
        !confirm('Replace everything in the form with the example? This cannot be undone.')) return;
    state = sampleState();
    logoInput.value = '';
    syncEverything();
    say('Example loaded. Change anything — it is only a starting point.', 'ok');
  });

  document.getElementById('inv-clear').addEventListener('click', function () {
    if (!confirm('Clear the whole form and start again? This cannot be undone.')) return;
    state = blankState();
    logoInput.value = '';
    syncEverything();
    say('Cleared. Any saved draft on this device is untouched — use "Delete saved draft" for that.', 'ok');
  });

  document.getElementById('inv-print').addEventListener('click', function () {
    window.print();
    /* This is the export: there is no PDF library here, so the print dialog is
       the only way a document leaves this page. Nothing after this moment is
       knowable — a page is never told whether the dialog ended in a PDF, in
       paper or in Cancel. Gated on the form having a business name so that
       pressing Print to see what the button does is not counted as a lab that
       worked; lab_used is compared across labs and curiosity clicks would
       distort the whole table. */
    if (window.KSLab && clean(state.bizName)) window.KSLab.used('export');
  });

  /* ------------------------------------------------------------------
     Draft in localStorage.

     Explicit both ways: nothing is written until Save is pressed, and nothing
     is read back until Load is pressed. Autosave-and-restore would be more
     convenient and is the wrong default here — this form holds a client list,
     an address and whatever payment details were typed into the bank field,
     and a freelancer is as likely to open it on a shared desk as on their own
     laptop. Announcing "a draft is on this device" and waiting is the honest
     middle: the convenience is available, and it is a decision rather than a
     surprise.

     Every localStorage call is wrapped, because in Safari's private mode and
     under some enterprise policies merely touching it throws.
     ------------------------------------------------------------------ */

  function draftMeta() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.tool !== 'invoice-maker') return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function saveDraft() {
    var payload = JSON.stringify({
      tool: 'invoice-maker', version: 1, saved: new Date().toISOString(), data: state
    });
    try {
      localStorage.setItem(DRAFT_KEY, payload);
    } catch (e) {
      /* Quota, or storage disabled outright. Either way the draft did not
         save, and saying so is the whole job — a silent failure here is a
         freelancer who thinks their invoice is safe and finds it gone. */
      say('Could not save: this browser is refusing local storage (private mode, or the quota is full). "Download data" still works.', 'err');
      return;
    }
    say('Draft saved in this browser, on this device only. Nothing was sent anywhere.', 'ok');
    syncDraftButtons();
  }

  function loadDraft() {
    var parsed = draftMeta();
    if (!parsed) { say('No saved draft found in this browser.', 'warn'); return; }
    if (!stateIsEmpty() &&
        !confirm('Load the saved draft and replace everything in the form? This cannot be undone.')) return;
    state = normalizeState(parsed.data);
    logoInput.value = '';
    syncEverything();
    say('Draft loaded from this device.', 'ok');
  }

  function deleteDraft() {
    if (!confirm('Delete the draft saved in this browser? The form on screen is not touched.')) return;
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) { /* nothing there to remove, then */ }
    say('Saved draft deleted from this device.', 'ok');
    syncDraftButtons();
  }

  var loadBtn = document.getElementById('inv-load-draft');
  var deleteBtn = document.getElementById('inv-delete-draft');

  function syncDraftButtons() {
    var meta = draftMeta();
    loadBtn.disabled = !meta;
    deleteBtn.disabled = !meta;
    return meta;
  }

  document.getElementById('inv-save-draft').addEventListener('click', saveDraft);
  loadBtn.addEventListener('click', loadDraft);
  deleteBtn.addEventListener('click', deleteDraft);

  /* ------------------------------------------------------------------
     Download data / Load data — the state as a file you own. The envelope
     names the tool and a format version so the import can politely refuse
     somebody else's JSON instead of half-loading it.
     ------------------------------------------------------------------ */

  document.getElementById('inv-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify({ tool: 'invoice-maker', version: 1, data: state }, null, 2)],
      { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'invoice-data.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /* An immediate revoke can race the download in some browsers; a second
       later the click has long been consumed. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    say('Downloaded invoice-data.json — it contains everything you typed, including the payment details field.', 'ok');
  });

  var importBtn = document.getElementById('inv-import');
  var importInput = document.getElementById('inv-import-file');

  importBtn.addEventListener('click', function () { importInput.click(); });

  importInput.addEventListener('change', function () {
    var file = importInput.files && importInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      importInput.value = '';   // the same file twice in a row still fires change
      var parsed = null;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        say('That file is not valid JSON — expected an invoice-data.json downloaded from this page.', 'err');
        return;
      }
      if (!parsed || typeof parsed !== 'object' || parsed.tool !== 'invoice-maker' ||
          parsed.version !== 1 || !parsed.data || typeof parsed.data !== 'object') {
        say('That does not look like an invoice-maker data file — nothing was changed.', 'err');
        return;
      }
      if (!stateIsEmpty() &&
          !confirm('Load this file and replace everything in the form? This cannot be undone.')) {
        say('Load cancelled — nothing was changed.', 'warn');
        return;
      }
      state = normalizeState(parsed.data);
      logoInput.value = '';
      syncEverything();
      say('Loaded from your file.', 'ok');
    };
    reader.onerror = function () {
      importInput.value = '';
      say('Could not read that file.', 'err');
    };
    reader.readAsText(file);
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */

  populateStates();

  /* Sensible defaults for a form somebody opens to bill something today. */
  state.docDate = todayISO();
  syncEverything();

  var existing = syncDraftButtons();
  if (existing) {
    var when = parseISO(String(existing.saved || '').slice(0, 10));
    say('A saved draft is on this device' + (when ? ', from ' + fmtDate(when) : '') +
        '. It is not loaded automatically — press "Load draft" if you want it.', 'warn');
  }

  /* Fonts settling after first paint change the sheet height slightly, so
     refit once everything has arrived. */
  window.addEventListener('load', fitPreview);
})();

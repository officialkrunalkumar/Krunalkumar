/* ==========================================================================
   gst-return.js — a working sheet for GSTR-1 and 3B, built out of invoices
   you already have.
   --------------------------------------------------------------------------
   This is not a return and it does not file anything. It is the arithmetic
   you would otherwise do in a spreadsheet at eleven at night on the tenth of
   the month: add the invoices up rate by rate, decide which ones are CGST
   plus SGST and which are IGST, separate B2B from B2C, keep the exports out
   of the domestic buckets, and then look for the two things a scrutiny notice
   asks about first — a hole in the invoice series and a number used twice.

   It reads the .json that /labs/invoice-maker downloads, because that file
   already carries the line items, the rates and both state codes, and there
   is no reason to retype them. It also reads a plain CSV, because most people
   keep invoices somewhere else entirely and the point of a working sheet is
   that it works on whatever you have.

   Three decisions shaped the code.

   Money is held in PAISE as integers from the first multiplication to the
   last, exactly as invoice-maker does, so that this page and the invoice it
   read agree to the paisa. Tax is computed per document line — each half of
   an intra-state supply independently at half the rate, never half of a
   pre-rounded total — because that is how the portal does it and a rupee of
   drift across two hundred invoices is a reconciliation nobody enjoys.

   The supplier's state is read from the first two digits of a GSTIN. Those
   two digits ARE the registration's state, so a second dropdown asking you to
   pick it again is one more thing to get wrong, and the split between
   CGST+SGST and IGST turns entirely on that one comparison. The GSTIN typed
   on the page wins; failing that, the one inside the files; and only if there
   is no GSTIN anywhere does it fall back to the state code the files carry.
   The sheet always prints which of the three it used.

   Where a rule has a number in it that Parliament can change — the B2C large
   threshold moved from 2.5 lakh to 1 lakh in November 2024 — the number is a
   field on the page rather than a constant in this file, and the sheet prints
   the value it used. Where the answer depends on something the visitor has
   not told me, the sheet says so instead of printing a confident figure.

   Deliberately absent, and said out loud on screen: no ITC, no reverse
   charge on inward supplies, no advances or their adjustment, no amendment
   tables, no nil-rated versus exempt versus non-GST distinction inside the
   zero-rate bucket, no interest or late fee, no e-invoice IRN checking and no
   contact of any kind with the GST portal. Every one of those needs data this
   page has never seen, and inventing it would be worse than omitting it.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  var MAX_FILE = 6 * 1024 * 1024;
  var MAX_FILES = 40;
  var MAX_CSV_ROWS = 20000;

  /* Tolerance for "the tax on this row does not equal rate x taxable value".
     One rupee, stated on screen. Anything tighter fires on ordinary rounding
     inside whatever software wrote the CSV; anything looser stops being a
     check. */
  var TAX_TOL = 100;

  var SHEET_W = 79;

  /* State codes. 25 and 28 are dead: 25 (Daman and Diu) was folded into 26
     when the union territories merged, and 28 (undivided Andhra Pradesh) was
     split into 36 and 37. They still appear on old GSTINs, so they are known
     here and flagged rather than rejected. 97 is Other Territory and 99 is
     the centre's own code, used on UINs rather than ordinary GSTINs. */
  var STATE_NAMES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
    '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
    '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
    '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
    '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
    '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka',
    '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
    '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
    '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
    '97': 'Other Territory', '99': 'Centre jurisdiction'
  };

  /* Union territories WITHOUT their own legislature: the state half of an
     intra-state supply there is UTGST, not SGST. Delhi, Puducherry and Jammu
     and Kashmir have legislatures, so they take SGST and are correctly
     absent. 25 is here as well as in RETIRED below: Daman and Diu had no
     legislature either, and a registration issued under 25 before the merger
     still names its state half UTGST. */
  var UT_NO_LEG = { '04': 1, '25': 1, '26': 1, '31': 1, '35': 1, '38': 1, '97': 1 };

  var RETIRED = {
    '25': 'merged into 26 when the union territories were reorganised',
    '28': 'split into 36 (Telangana) and 37 (Andhra Pradesh)'
  };

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* The rates a domestic supply normally carries. A rate outside this list is
     still bucketed and still added up — the list only decides whether the
     sheet says "unusual" next to it. Compensation cess is a separate levy
     with its own rates and is not modelled at all. */
  var KNOWN_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];

  var SUPPLY_LABELS = {
    domestic: 'Domestic supply',
    exp_wp: 'Exports with payment of IGST',
    exp_lut: 'Exports under LUT or bond',
    sez_wp: 'SEZ supply with payment of IGST',
    sez_lut: 'SEZ supply under LUT or bond'
  };

  /* ------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------ */

  /* Every lookup into a plain-object table goes through this.

     The tables below are keyed on text that came out of somebody's CSV, and
     COLUMN_ALIASES['constructor'] is not undefined — it is a function off
     Object.prototype. A column header of "constructor" or a supply type of
     "toString" would sail past a truthiness check and put a function where a
     string was expected. hasOwnProperty is the whole fix. */
  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function rep(ch, n) { return n > 0 ? new Array(n + 1).join(ch) : ''; }
  function padR(s, w) { s = String(s); return s.length >= w ? s : s + rep(' ', w - s.length); }
  function padL(s, w) { s = String(s); return s.length >= w ? s : rep(' ', w - s.length) + s; }
  function two(n) { return n < 10 ? '0' + n : String(n); }
  function clean(v) { return String(v === undefined || v === null ? '' : v).trim(); }

  function num(v) {
    var n = parseFloat(String(v).replace(/[,\s₹]/g, ''));
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

  function rateLabel(r) { return (Math.round(r * 100) / 100) + '%'; }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* Rupees as typed -> paise as an integer. Rejects rather than guesses, so a
     blank or a stray word in a money column becomes a reported problem
     instead of a silent zero in a total. */
  function paiseOf(text) {
    var t = clean(text).replace(/[,\s₹]/g, '');
    if (t === '') return null;
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (!/^[-+]?\d*(\.\d+)?$/.test(t) || !/\d/.test(t)) return null;
    var v = parseFloat(t);
    if (!isFinite(v)) return null;
    return Math.round(v * 100) * (neg ? -1 : 1);
  }

  function hr(ch) { out.dim(rep(ch || '-', SHEET_W)); }

  /* Free text — a check-digit explanation, a parser complaint, a reason a
     document was set aside — is as long as it needs to be, and the output pane
     is white-space:pre so it would scroll the whole sheet sideways for one
     sentence. This folds it at the sheet width instead. A single word longer
     than the line is left long rather than broken, because half a GSTIN on one
     line and half on the next is worse than a wide line. */
  function wrapOut(indent, text, cls) {
    var words = String(text).split(/\s+/);
    var line = '', i;
    for (i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      if (line && (indent + line + ' ' + words[i]).length > SHEET_W) {
        out.line(indent + line, cls);
        line = words[i];
      } else line = line ? line + ' ' + words[i] : words[i];
    }
    if (line) out.line(indent + line, cls);
  }

  /* ------------------------------------------------------------------
     GSTIN

     Fifteen characters: two state-code digits, the ten-character PAN of the
     holder, an entity code, a fixed Z, and a check character.

     The check character is a base-36 digit over the first fourteen. Walk the
     characters against the alphabet 0-9 then A-Z, multiply each code point by
     an alternating weight of 1 and 2 starting at 1, fold each product by
     adding its quotient and remainder on 36, and the check character is
     36 minus the running sum modulo 36. It catches the ordinary transposition
     that a length check cannot, because a swapped pair is still fifteen
     characters long.

     A passing checksum means the number is WELL-FORMED. It does not mean the
     registration exists, is active, or belongs to whoever gave it to you.
     Only the GST portal can answer that, and this page makes no network call
     of any kind.
     ------------------------------------------------------------------ */

  var G36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var GSTIN_SHAPE = /^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([0-9A-Z])([0-9A-Z])([0-9A-Z])$/;

  /* The fourth letter of a PAN is the holder's type. This is the common set;
     an unfamiliar letter is a note rather than a failure, because the list has
     been added to before. */
  var PAN_ENTITY = 'ABCFGHJLPTK';

  function gstinCheckChar(first14) {
    var sum = 0;
    for (var i = 0; i < 14; i++) {
      var v = G36.indexOf(first14.charAt(i));
      if (v < 0) return null;
      var p = v * (i % 2 === 0 ? 1 : 2);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return G36.charAt((36 - (sum % 36)) % 36);
  }

  /* Returns null for an empty field — an unregistered buyer has no GSTIN and
     that is a legitimate state of the world, not an error to nag about. */
  function checkGstin(raw) {
    var g = clean(raw).toUpperCase().replace(/[\s-]/g, '');
    if (!g) return null;
    var r = { raw: g, state: '', bad: [], notes: [], ok: false };

    if (g.length !== 15) {
      r.bad.push('is ' + g.length + ' characters; a GSTIN is 15');
      return r;
    }
    var m = GSTIN_SHAPE.exec(g);
    if (!m) {
      r.bad.push('does not match the shape: 2 digits, a 10-character PAN, ' +
                 'an entity code, Z, and a check character');
      return r;
    }
    r.state = m[1];
    if (!STATE_NAMES[m[1]]) {
      r.bad.push('starts with ' + m[1] + ', which is not a GST state code ' +
                 '(01 to 38, plus 97 and 99)');
    } else if (RETIRED[m[1]]) {
      r.notes.push('state code ' + m[1] + ' is retired — ' + RETIRED[m[1]]);
    }
    if (m[1] === '99') {
      r.notes.push('99 is the centre\'s code, used on a UIN rather than an ' +
                   'ordinary GSTIN');
    }
    if (PAN_ENTITY.indexOf(m[2].charAt(3)) < 0) {
      r.notes.push('the PAN inside it has "' + m[2].charAt(3) + '" as its ' +
                   'fourth letter, which is not one of the usual holder types');
    }
    if (m[3] === '0') {
      r.notes.push('entity code 0 is not issued; registrations are numbered ' +
                   'from 1');
    }
    if (m[4] !== 'Z') {
      r.notes.push('the fourteenth character is "' + m[4] + '" rather than Z ' +
                   '— TDS and TCS registrations do differ here, ordinary ones ' +
                   'do not');
    }
    var want = gstinCheckChar(g.slice(0, 14));
    if (want === null) {
      r.bad.push('contains a character outside 0-9 and A-Z');
    } else if (want !== m[5]) {
      r.bad.push('fails its check digit — it ends "' + m[5] + '" where the ' +
                 'first fourteen characters compute to "' + want + '"');
    }
    r.ok = r.bad.length === 0;
    return r;
  }

  function stateLabel(code) {
    if (!code) return '';
    return (STATE_NAMES[code] || 'unknown state') + ' (' + code + ')';
  }

  function stateHalfName(code) { return UT_NO_LEG[code] ? 'UTGST' : 'SGST'; }

  /* ------------------------------------------------------------------
     Dates

     Parsed and held in UTC on purpose. new Date('2026-04-01') is UTC
     midnight, and printing that through a negative local offset silently
     shows 31 March — which in this tool would move an invoice into the
     previous financial year.
     ------------------------------------------------------------------ */

  var MON3 = {};
  (function () {
    for (var i = 0; i < MONTHS.length; i++) MON3[MONTHS[i].toLowerCase()] = i;
  })();

  function mkDate(y, m, d) {
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, m, d));
    if (!isFinite(dt.getTime())) return null;
    // Round-trip so 31 February is rejected rather than rolled into March.
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m ||
        dt.getUTCDate() !== d) return null;
    return dt;
  }

  /* Returns { d: Date, ambiguous: bool, flipped: bool } or null.

     A slashed date is read DAY first, because that is how dates are written
     in India and this tool is about Indian invoices. When both halves are 12
     or less the reading is a genuine guess, so it is counted and the sheet
     says how many it guessed at. When the second half is over 12 the day-first
     reading is impossible, so it is read month-first and reported. */
  function parseDate(text) {
    var s = clean(text);
    if (!s) return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) {
      var d1 = mkDate(+m[1], +m[2] - 1, +m[3]);
      return d1 ? { d: d1, ambiguous: false, flipped: false } : null;
    }
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) {
      var d2 = mkDate(+m[1], +m[2] - 1, +m[3]);
      return d2 ? { d: d2, ambiguous: false, flipped: false } : null;
    }
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += y < 70 ? 2000 : 1900;
      if (b > 12 && a <= 12) {
        var dF = mkDate(y, a - 1, b);
        return dF ? { d: dF, ambiguous: false, flipped: true } : null;
      }
      var dD = mkDate(y, b - 1, a);
      return dD ? { d: dD, ambiguous: a <= 12 && b <= 12, flipped: false } : null;
    }
    m = /^(\d{1,2})[ \-]([A-Za-z]{3,})[ \-,]*(\d{2}|\d{4})$/.exec(s);
    if (m) {
      var mi = MON3[m[2].slice(0, 3).toLowerCase()];
      if (mi === undefined) return null;
      var yy = +m[3];
      if (yy < 100) yy += yy < 70 ? 2000 : 1900;
      var d3 = mkDate(yy, mi, +m[1]);
      return d3 ? { d: d3, ambiguous: false, flipped: false } : null;
    }
    return null;
  }

  function fmtDate(d) {
    if (!d) return '(no date)';
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function fyLabel(startYear) {
    return startYear + '-' + two((startYear + 1) % 100);
  }

  /* April is month index 3, so offset 0 is April of the start year and offset
     11 is March of the next one. */
  function fyMonth(startYear, offset, day) {
    var m = 3 + offset;
    return new Date(Date.UTC(startYear + Math.floor(m / 12), m % 12, day));
  }

  function periodRange(startYear, value) {
    var from, count, label;
    if (!/^(all|q[0-3]|m([0-9]|1[01]))$/.test(String(value))) value = 'all';
    if (value === 'all') { from = 0; count = 12; label = 'the whole year'; }
    else if (value.charAt(0) === 'q') {
      var q = parseInt(value.slice(1), 10);
      from = q * 3; count = 3;
      label = 'Q' + (q + 1);
    } else {
      from = parseInt(value.slice(1), 10); count = 1;
      label = '';
    }
    var start = fyMonth(startYear, from, 1);
    var endExcl = fyMonth(startYear, from + count, 1);
    var last = new Date(endExcl.getTime() - 86400000);
    if (!label) label = MONTHS[start.getUTCMonth()] + ' ' + start.getUTCFullYear();
    return {
      start: start, endExcl: endExcl, last: last, label: label,
      text: fmtDate(start) + ' to ' + fmtDate(last)
    };
  }

  function fyStartOf(d) {
    // Financial year runs 1 April to 31 March.
    return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  }

  /* ------------------------------------------------------------------
     Reading invoice-maker's .json

     The export is { tool: 'invoice-maker', version: 1, data: <state> }. The
     state carries bizGstin / bizState, clientGstin / clientState, pos,
     docNumber, docDate, taxMode, docType and an items array of
     { desc, hsn, qty, unit, rate, taxRate }. Everything below reads those
     names and no invented ones; anything missing is reported rather than
     defaulted.

     Line arithmetic mirrors invoice-maker exactly — amount is
     round(qty x rate x 100) paise, an invoice-level discount is allocated
     back across the lines by largest remainder, and tax is computed on the
     discounted value. If the two ever disagreed, the invoice you sent and the
     return you filed would disagree too.
     ------------------------------------------------------------------ */

  function readInvoiceState(st, source) {
    var doc = {
      source: source,
      number: clean(st.docNumber),
      dateRaw: clean(st.docDate),
      date: null, ambiguous: false, flipped: false,
      kind: 'invoice',
      customer: clean(st.clientName),
      gstin: clean(st.clientGstin).toUpperCase(),
      supplierGstin: clean(st.bizGstin).toUpperCase(),
      supplierState: clean(st.bizState),
      pos: clean(st.pos) || clean(st.clientState),
      supply: 'domestic',
      lines: [],
      taxGiven: null,
      notes: [],
      skip: ''
    };

    var parsed = parseDate(doc.dateRaw);
    if (parsed) {
      doc.date = parsed.d; doc.ambiguous = parsed.ambiguous; doc.flipped = parsed.flipped;
    }

    if (st.docType === 'quotation') {
      doc.skip = 'a quotation, not a supply — nothing to report';
      return doc;
    }
    if (st.taxMode === 'export') {
      /* The invoice maker offers one zero-rated mode, "Export or SEZ under
         LUT", so the file cannot say which of the two it was. Counting it as
         an export is the commoner case and is declared on screen; an SEZ
         supply has to be moved by hand, or routed through the CSV, which does
         have a supply_type column that separates them. */
      doc.supply = 'exp_lut';
      doc.notes.push('came in as the invoice maker\'s "export or SEZ under LUT" ' +
                     'mode, which cannot distinguish the two — counted as an export');
    }
    if (st.taxMode === 'unregistered') {
      doc.skip = 'marked "not registered for GST", so it carries no tax to report';
      return doc;
    }
    if (st.taxMode === 'composition') {
      doc.skip = 'a composition bill of supply — that goes in CMP-08 and GSTR-4, not here';
      return doc;
    }
    if (st.revCharge === true) {
      doc.notes.push('marked reverse charge; the tax is the recipient\'s to pay, ' +
                     'and this sheet still shows it in your rate buckets');
    }

    var items = Array.isArray(st.items) ? st.items : [];
    var amounts = [], rates = [], subtotal = 0, i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it !== 'object') continue;
      // The blank row the form opens with is not a line item.
      if (!clean(it.desc) && !num(it.rate)) continue;
      var amount = Math.round(num(it.qty) * num(it.rate) * 100);
      amounts.push(amount);
      rates.push(num(it.taxRate));
      subtotal += amount;
    }
    if (!amounts.length) {
      doc.skip = 'has no line items with a value';
      return doc;
    }

    var discount = 0;
    if (subtotal > 0) {
      discount = st.discountType === 'pct'
        ? Math.round(subtotal * num(st.discountValue) / 100)
        : Math.round(num(st.discountValue) * 100);
      if (discount < 0) discount = 0;
      if (discount > subtotal) discount = subtotal;
    }

    var shares = [];
    for (i = 0; i < amounts.length; i++) shares.push(0);
    if (discount > 0) {
      var allocated = 0, rems = [];
      for (i = 0; i < amounts.length; i++) {
        var exact = discount * amounts[i] / subtotal;
        shares[i] = Math.floor(exact);
        allocated += shares[i];
        rems.push({ i: i, frac: exact - shares[i] });
      }
      rems.sort(function (a, b) { return b.frac - a.frac; });
      var left = discount - allocated;
      for (i = 0; i < left && i < rems.length; i++) shares[rems[i].i] += 1;
    }

    for (i = 0; i < amounts.length; i++) {
      doc.lines.push({ rate: rates[i], taxable: amounts[i] - shares[i], taxGiven: null });
    }
    return doc;
  }

  /* Accepts the wrapper this repo writes, a bare state object, or an array of
     either — because somebody will concatenate a month of exports into one
     file, and refusing that would be pedantry. */
  function docsFromJson(text, name) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (err) { return { error: 'not valid JSON (' + ((err && err.message) || 'parse failed') + ')' }; }

    var queue = Array.isArray(parsed) ? parsed : [parsed];
    var docs = [], i;
    for (i = 0; i < queue.length; i++) {
      var node = queue[i];
      if (!node || typeof node !== 'object') continue;
      var st = node.data && typeof node.data === 'object' ? node.data : node;
      if (node.tool && node.tool !== 'invoice-maker') {
        return { error: 'was written by "' + clean(node.tool) + '", not the invoice maker' };
      }
      if (!st.items && !st.docNumber) continue;
      docs.push(readInvoiceState(st, name + (queue.length > 1 ? ' #' + (i + 1) : '')));
    }
    if (!docs.length) {
      return { error: 'has no invoices in it — expected the invoice-data.json that /labs/invoice-maker downloads' };
    }
    return { docs: docs };
  }

  /* ------------------------------------------------------------------
     Reading a CSV

     Header-driven and order-independent, because every accounting package
     exports the same columns in a different order. Several rows may share one
     invoice number: they are merged into a single document, so an invoice with
     a 12% line and an 18% line is one document with two rate lines, and the
     B2C large threshold is tested against the whole invoice.
     ------------------------------------------------------------------ */

  var COLUMN_ALIASES = {
    date: 'date', invoice_date: 'date', doc_date: 'date', bill_date: 'date',
    invoice_no: 'number', invoice_number: 'number', number: 'number',
    doc_no: 'number', document_no: 'number', bill_no: 'number', invoice: 'number',
    doc_type: 'kind', type: 'kind', document_type: 'kind',
    customer: 'customer', party: 'customer', recipient: 'customer',
    buyer: 'customer', name: 'customer', customer_name: 'customer',
    customer_gstin: 'gstin', gstin: 'gstin', recipient_gstin: 'gstin',
    party_gstin: 'gstin', buyer_gstin: 'gstin', gst_no: 'gstin',
    place_of_supply: 'pos', pos: 'pos', pos_state: 'pos', state: 'pos',
    state_code: 'pos',
    taxable_value: 'taxable', taxable: 'taxable', taxable_amount: 'taxable',
    value: 'taxable', amount: 'taxable', net_amount: 'taxable',
    rate: 'rate', gst_rate: 'rate', tax_rate: 'rate',
    tax: 'tax', tax_amount: 'tax', total_tax: 'tax', gst: 'tax',
    supply_type: 'supply', supply: 'supply', category: 'supply'
  };

  var KIND_ALIASES = {
    invoice: 'invoice', inv: 'invoice', tax_invoice: 'invoice', b2b: 'invoice',
    b2c: 'invoice', sale: 'invoice', supply: 'invoice',
    credit_note: 'credit', credit: 'credit', cn: 'credit', cr: 'credit',
    debit_note: 'debit', debit: 'debit', dn: 'debit', dr: 'debit'
  };

  var SUPPLY_ALIASES = {
    '': 'domestic', domestic: 'domestic', local: 'domestic', normal: 'domestic',
    regular: 'domestic', b2b: 'domestic', b2c: 'domestic',
    export_with_tax: 'exp_wp', exp_wp: 'exp_wp', export_wp: 'exp_wp',
    export_with_payment: 'exp_wp', expwp: 'exp_wp',
    export_lut: 'exp_lut', exp_lut: 'exp_lut', export_without_tax: 'exp_lut',
    export_wopay: 'exp_lut', export: 'exp_lut', expwop: 'exp_lut',
    sez_with_tax: 'sez_wp', sez_wp: 'sez_wp', sez_with_payment: 'sez_wp',
    sezwp: 'sez_wp',
    sez_lut: 'sez_lut', sez: 'sez_lut', sez_without_tax: 'sez_lut',
    sezwop: 'sez_lut'
  };

  function normKey(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /* A small quote-aware splitter. Doubled quotes inside a quoted field are one
     quote, which is the one rule spreadsheets actually agree on. */
  function splitCsvLine(line, sep) {
    var cells = [], cur = '', inQ = false, i;
    for (i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (inQ) {
        if (c === '"') {
          if (line.charAt(i + 1) === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === sep) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  }

  function docsFromCsv(text, source) {
    var raw = String(text).replace(/\r\n?/g, '\n').split('\n');
    var lines = [], lineNos = [], i;
    for (i = 0; i < raw.length; i++) {
      if (clean(raw[i]) !== '') { lines.push(raw[i]); lineNos.push(i + 1); }
    }
    if (!lines.length) return { error: 'is empty' };
    if (lines.length - 1 > MAX_CSV_ROWS) {
      return { error: 'has ' + (lines.length - 1) + ' rows; this page stops at ' +
                      MAX_CSV_ROWS + ' so the tab stays responsive' };
    }

    // Sniff the separator on the header line so a paste out of a spreadsheet,
    // which arrives tab-separated, is not read as one enormous column.
    var head = lines[0];
    var sep = ',';
    if (head.split('\t').length > head.split(',').length) sep = '\t';
    else if (head.split(';').length > head.split(',').length) sep = ';';

    var headCells = splitCsvLine(head, sep);
    var map = {}, unknown = [];
    for (i = 0; i < headCells.length; i++) {
      var key = normKey(headCells[i]);
      if (!key) continue;
      if (has(COLUMN_ALIASES, key)) map[COLUMN_ALIASES[key]] = i;
      else unknown.push(clean(headCells[i]));
    }
    var missing = [];
    ['date', 'number', 'taxable', 'rate'].forEach(function (need) {
      if (map[need] === undefined) missing.push(need);
    });
    if (missing.length) {
      return { error: 'has no ' + missing.join(', ') + ' column. The first row must ' +
                      'be a header; date, invoice_no, taxable_value and rate are required.' };
    }

    function cell(cells, key) {
      var idx = map[key];
      return idx === undefined ? '' : clean(cells[idx]);
    }

    var byKey = {}, order = [], problems = [], negCredits = 0;
    for (i = 1; i < lines.length; i++) {
      var cells = splitCsvLine(lines[i], sep);
      var where = source + ' line ' + lineNos[i];
      var number = cell(cells, 'number');
      var dateRaw = cell(cells, 'date');
      var taxable = paiseOf(cell(cells, 'taxable'));
      var rateTxt = clean(cell(cells, 'rate')).replace('%', '');
      var kindRaw = normKey(cell(cells, 'kind'));
      var supplyRaw = normKey(cell(cells, 'supply'));

      if (!number) { problems.push(where + ': no invoice number, row skipped'); continue; }
      if (taxable === null) {
        problems.push(where + ': taxable value "' + cell(cells, 'taxable') +
                      '" is not a number, row skipped');
        continue;
      }
      if (rateTxt === '' || !isFinite(parseFloat(rateTxt))) {
        problems.push(where + ': rate "' + cell(cells, 'rate') + '" is not a number, row skipped');
        continue;
      }

      var kind = 'invoice';
      if (kindRaw) {
        if (has(KIND_ALIASES, kindRaw)) kind = KIND_ALIASES[kindRaw];
        else problems.push(where + ': doc_type "' + cell(cells, 'kind') +
                           '" not recognised, read as an invoice');
      }
      var supply = 'domestic';
      if (has(SUPPLY_ALIASES, supplyRaw)) supply = SUPPLY_ALIASES[supplyRaw];
      else problems.push(where + ': supply_type "' + cell(cells, 'supply') +
                         '" not recognised, read as a domestic supply');

      // Prefixed so a document numbered "__proto__" lands in the map rather
      // than on the prototype, where the assignment would silently vanish.
      var gkey = '#' + kind + ' ' + number.toUpperCase();
      var doc = has(byKey, gkey) ? byKey[gkey] : null;
      if (!doc) {
        doc = {
          source: where, number: number, dateRaw: dateRaw, date: null,
          ambiguous: false, flipped: false, kind: kind,
          customer: cell(cells, 'customer'),
          gstin: cell(cells, 'gstin').toUpperCase(),
          supplierGstin: '', supplierState: '',
          pos: clean(cell(cells, 'pos')).toUpperCase(),
          supply: supply, lines: [], notes: [], skip: ''
        };
        var pd = parseDate(dateRaw);
        if (pd) { doc.date = pd.d; doc.ambiguous = pd.ambiguous; doc.flipped = pd.flipped; }
        byKey[gkey] = doc;
        order.push(doc);
      } else if (supply !== doc.supply) {
        doc.notes.push('rows for this number disagree about supply_type; the ' +
                       'first one read (' + SUPPLY_LABELS[doc.supply] + ') was used');
      }

      if (kind === 'credit' && taxable < 0) {
        /* The minus sign on a credit note comes from doc_type: the row is
           multiplied by -1 later. A row that ALSO writes the value negative
           therefore gets two minus signs, they cancel, and the note ADDS to
           the month instead of reducing it.

           Silently taking the absolute value would be the tool deciding which
           of two contradictory signals the visitor meant, on a figure that
           changes what gets filed. So the row is left exactly as written and
           the arithmetic consequence is spelled out instead — including the
           size of it, because "check your signs" is not actionable and
           "your taxable total is 20,000.00 too high" is. */
        negCredits++;
        problems.push(where + ': a credit note whose taxable value is itself ' +
                      'NEGATIVE. The minus already comes from doc_type, so the ' +
                      'two signs cancel and this row has been ADDED to the ' +
                      'period rather than subtracted from it — which leaves the ' +
                      'taxable total ' + money(Math.abs(taxable) * 2) + ' too ' +
                      'high, and its tax with it. Write the value positive and ' +
                      'build the sheet again.');
      }
      doc.lines.push({
        rate: parseFloat(rateTxt),
        taxable: taxable,
        taxGiven: map.tax === undefined ? null : paiseOf(cell(cells, 'tax'))
      });
    }

    if (!order.length) {
      return { error: 'has a header but no usable rows', problems: problems };
    }
    return { docs: order, problems: problems, unknown: unknown,
             negCredits: negCredits, rows: lines.length - 1 };
  }

  /* Place of supply written as a state code, a two-digit number, or left to be
     derived from the recipient's GSTIN. Anything else is reported. */
  function resolvePos(doc) {
    var p = clean(doc.pos);
    if (p) {
      var digits = p.replace(/[^0-9]/g, '');
      if (digits.length === 1) digits = '0' + digits;
      if (digits.length === 2 && STATE_NAMES[digits]) return digits;
      var wanted = p.toLowerCase();
      var found = '';
      Object.keys(STATE_NAMES).forEach(function (code) {
        if (STATE_NAMES[code].toLowerCase() === wanted) found = code;
      });
      if (found) return found;
      return '';
    }
    if (doc.gstin && doc.gstin.length >= 2 && STATE_NAMES[doc.gstin.slice(0, 2)]) {
      return doc.gstin.slice(0, 2);
    }
    return '';
  }

  /* ------------------------------------------------------------------
     Series analysis: gaps and duplicates
     ------------------------------------------------------------------ */

  /* The last run of digits in a number is its serial; everything before it is
     the prefix and everything after is the suffix. INV/2025-26/0007 splits as
     prefix "INV/2025-26/", serial 7, width 4 — which is what makes a run of
     invoices comparable at all. */
  function seriesOf(number) {
    var s = String(number).toUpperCase().replace(/\s+/g, '');
    var m = /^(.*?)(\d+)(\D*)$/.exec(s);
    if (!m) return null;
    if (m[2].length > 9) return null;
    return { prefix: m[1], suffix: m[3], width: m[2].length, n: parseInt(m[2], 10) };
  }

  /* A jump this large inside one prefix is almost always two different
     numbering schemes that happen to share it, not five thousand missing
     invoices. Listing them would bury the real finding. */
  var MAX_SERIES_SPAN = 5000;

  function analyseSeries(docs) {
    var groups = {}, order = [], noSerial = [], i;
    for (i = 0; i < docs.length; i++) {
      var doc = docs[i];
      var s = seriesOf(doc.number);
      if (!s) { noSerial.push(doc); continue; }
      var key = '#' + doc.kind + '|' + s.prefix + '|' + s.suffix;
      if (!has(groups, key)) {
        groups[key] = { kind: doc.kind, prefix: s.prefix, suffix: s.suffix,
                        nums: {}, widths: {}, min: s.n, max: s.n, count: 0 };
        order.push(key);
      }
      var g = groups[key];
      g.nums[s.n] = true;
      g.widths[s.width] = true;
      if (s.n < g.min) g.min = s.n;
      if (s.n > g.max) g.max = s.n;
      g.count++;
    }

    var results = [];
    for (i = 0; i < order.length; i++) {
      var gr = groups[order[i]];
      var label = (gr.prefix || '') + '<n>' + (gr.suffix || '');
      var span = gr.max - gr.min + 1;
      var res = {
        label: label, kind: gr.kind, count: gr.count,
        min: gr.min, max: gr.max, gaps: [], tooWide: false,
        mixedWidth: Object.keys(gr.widths).length > 1
      };
      if (span > MAX_SERIES_SPAN) res.tooWide = true;
      else {
        for (var n = gr.min; n <= gr.max; n++) if (!gr.nums[n]) res.gaps.push(n);
      }
      results.push(res);
    }
    return { series: results, noSerial: noSerial };
  }

  function findDuplicates(docs) {
    var seen = {}, order = [], i;
    for (i = 0; i < docs.length; i++) {
      var key = '#' + docs[i].kind + ' ' +
                String(docs[i].number).toUpperCase().replace(/\s+/g, '');
      if (!has(seen, key)) { seen[key] = []; order.push(key); }
      seen[key].push(docs[i]);
    }
    var dups = [];
    for (i = 0; i < order.length; i++) {
      if (seen[order[i]].length > 1) dups.push(seen[order[i]]);
    }
    return dups;
  }

  /* ------------------------------------------------------------------
     The page
     ------------------------------------------------------------------ */

  var files = [];        // { name, docs, error, problems }
  var lastCsvExport = null;

  function el(id) { return document.getElementById(id); }

  function renderFileList() {
    var box = el('gstr-list');
    if (!box) return;
    box.textContent = '';
    if (!files.length) {
      var p = document.createElement('p');
      p.className = 'gstr-file gstr-file-empty';
      p.textContent = 'No files loaded yet. The CSV box below works on its own.';
      box.appendChild(p);
      return;
    }
    files.forEach(function (f) {
      var row = document.createElement('p');
      row.className = 'gstr-file';
      row.textContent = f.error
        ? f.name + ' — could not be read: ' + f.error
        : f.name + ' — ' + plural(f.docs.length, 'document', 'documents');
      box.appendChild(row);
    });
  }

  function addFile(name, text) {
    var res = docsFromJson(text, name);
    var entry = { name: name, docs: res.docs || [], error: res.error || '' };
    // Same name dropped twice replaces rather than duplicates, otherwise every
    // second drop invents a page of duplicate invoice numbers that are not real.
    for (var i = 0; i < files.length; i++) {
      if (files[i].name === name) { files[i] = entry; renderFileList(); return; }
    }
    if (files.length >= MAX_FILES) {
      out.warn('Already holding ' + MAX_FILES + ' files; "' + name + '" was not added.');
      return;
    }
    files.push(entry);
    renderFileList();
  }

  function takeFiles(list) {
    if (!list || !list.length) return;
    var i, accepted = 0;
    for (i = 0; i < list.length; i++) {
      var file = list[i];
      if (file.size > MAX_FILE) {
        out.warn(file.name + ' is ' + LabTool.humanBytes(file.size) +
                 '; this page stops at ' + LabTool.humanBytes(MAX_FILE) + ' a file.');
        continue;
      }
      accepted++;
      /* Read one at a time through a closure over the name, because
         FileReader is asynchronous and the loop variable would otherwise have
         moved on by the time onload fired. */
      (function (f) {
        var reader = new FileReader();
        reader.onload = function () { addFile(f.name, String(reader.result)); };
        reader.onerror = function () {
          addFile(f.name, '');
          out.err(f.name + ' could not be read.');
        };
        reader.readAsText(f);
      })(file);
    }
    if (accepted) {
      var note = el('gstr-dropname');
      if (note) note.textContent = plural(accepted, 'file', 'files') + ' being read';
    }
  }

  function wireDrop() {
    var zone = el('gstr-drop');
    var input = el('gstr-file');
    if (!zone || !input) return;
    input.addEventListener('change', function () { takeFiles(input.files); input.value = ''; });
    zone.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (name) {
      zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      zone.addEventListener(name, function (e) { e.preventDefault(); zone.classList.remove('is-over'); });
    });
    zone.addEventListener('drop', function (e) {
      takeFiles(e.dataTransfer && e.dataTransfer.files);
    });
  }

  function fillPeriodSelects() {
    var fy = el('gstr-fy');
    var period = el('gstr-period');
    if (!fy || !period) return;
    var now = new Date();
    var thisFy = fyStartOf(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    var i, opt;
    for (i = thisFy; i >= thisFy - 6; i--) {
      opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'FY ' + fyLabel(i);
      fy.appendChild(opt);
    }
    var periods = [{ v: 'all', t: 'Whole financial year' },
                   { v: 'q0', t: 'Q1 — April to June' },
                   { v: 'q1', t: 'Q2 — July to September' },
                   { v: 'q2', t: 'Q3 — October to December' },
                   { v: 'q3', t: 'Q4 — January to March' }];
    for (i = 0; i < 12; i++) {
      periods.push({ v: 'm' + i, t: MONTHS[(3 + i) % 12] + (i >= 9 ? ' (next calendar year)' : '') });
    }
    for (i = 0; i < periods.length; i++) {
      opt = document.createElement('option');
      opt.value = periods[i].v;
      opt.textContent = periods[i].t;
      period.appendChild(opt);
    }
    // Default to the month just gone, which is the one people are filing for.
    var prev = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    if (fyStartOf(prev) === thisFy) {
      period.value = 'm' + ((prev.getUTCMonth() + 12 - 3) % 12);
    }
  }

  /* ------------------------------------------------------------------
     Building the sheet
     ------------------------------------------------------------------ */

  /* Widths chosen so every row is exactly 79 characters: 8+17+13+13+13+5 with
     a two-space gutter between each. The taxable column at 17 holds a figure
     up to 1,00,00,00,000.00. Past that pad() returns the number unchanged and
     the row runs wide, which is the right failure — the pane scrolls, and a
     truncated rupee figure would be a lie. */
  var RATE_COLS = [8, 17, 13, 13, 13, 5];
  var SPLIT_COLS = [15, 17, 13, 13, 13];
  var ZERO_COLS = [33, 18, 16, 6];

  function trow(cells, widths, leftFirst) {
    var parts = [], i;
    for (i = 0; i < cells.length; i++) {
      parts.push(i === 0 && leftFirst ? padR(cells[i], widths[i]) : padL(cells[i], widths[i]));
    }
    return parts.join('  ');
  }

  function blankBucket() {
    return { taxable: 0, cgst: 0, sgst: 0, igst: 0, docs: {}, count: 0 };
  }

  function addTo(bucket, doc, taxable, cgst, sgst, igst) {
    bucket.taxable += taxable;
    bucket.cgst += cgst;
    bucket.sgst += sgst;
    bucket.igst += igst;
    var dkey = '#' + doc.source + '|' + doc.number;
    if (!has(bucket.docs, dkey)) {
      bucket.docs[dkey] = true;
      bucket.count++;
    }
  }

  function collectDocs() {
    var docs = [], i, j;
    for (i = 0; i < files.length; i++) {
      for (j = 0; j < files[i].docs.length; j++) docs.push(files[i].docs[j]);
    }
    return docs;
  }

  function run() {
    try { build(); }
    catch (err) {
      hr();
      out.err('Could not finish the sheet — something in the input was shaped in');
      out.err('a way this page could not follow. Whatever printed above is still');
      out.err('valid; nothing below it was computed.');
      out.line('');
      out.dim('Details: ' + ((err && err.message) || String(err)));
      out.dim('Nothing was uploaded and nothing else on the page is affected.');
    }
  }

  function build() {
    out.clear();
    lastCsvExport = null;

    var fyStart = parseInt(el('gstr-fy').value, 10);
    if (!isFinite(fyStart)) {
      var today = new Date();
      fyStart = fyStartOf(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
    }
    var range = periodRange(fyStart, el('gstr-period').value);
    var myGstinRaw = clean(el('gstr-gstin').value);
    var thresholdPaise = paiseOf(el('gstr-b2cl').value);
    if (thresholdPaise === null || thresholdPaise < 0) thresholdPaise = 10000000;

    var docs = collectDocs();
    var csvText = clean(el('gstr-csv').value);
    var csvResult = null;
    if (csvText) {
      csvResult = docsFromCsv(csvText, 'CSV');
      if (csvResult.docs) docs = docs.concat(csvResult.docs);
    }

    /* --- header ------------------------------------------------------- */
    out.heading('GST WORKING SHEET');
    out.dim('A sheet to check your own numbers against before you file. It is not');
    out.dim('a return, it files nothing, it is not connected to the GST portal,');
    out.dim('and it is not a substitute for your accountant. Rules change with');
    out.dim('every finance act; the figures below are arithmetic on what you gave');
    out.dim('me, and nothing else.');
    hr('=');

    /* Supplier state comes from the GSTIN on this page. If the page field is
       empty, the invoice files may carry one of their own. */
    var myCheck = checkGstin(myGstinRaw);
    var myGstin = myCheck ? myCheck.raw : '';
    var myState = myCheck && myCheck.state ? myCheck.state : '';
    var stateFrom = myState ? 'the GSTIN typed on this page' : '';

    var fileGstins = {}, i;
    for (i = 0; i < docs.length; i++) {
      if (docs[i].supplierGstin) fileGstins[docs[i].supplierGstin] = true;
    }
    var fileGstinList = Object.keys(fileGstins);
    if (!myState && fileGstinList.length === 1) {
      var fc = checkGstin(fileGstinList[0]);
      if (fc && fc.state) {
        myGstin = fc.raw; myState = fc.state; myCheck = fc;
        stateFrom = 'the supplier GSTIN inside the files';
      }
    }
    /* Last resort: an invoice-maker file whose supplier GSTIN field was left
       blank still carries the state that was picked from the dropdown. It is
       weaker evidence than a GSTIN, so it is only reached when there is no
       GSTIN anywhere and every file agrees, and the sheet says which it used. */
    if (!myState) {
      var fileStates = {};
      for (i = 0; i < docs.length; i++) {
        if (docs[i].supplierState) fileStates[docs[i].supplierState] = true;
      }
      var stateList = Object.keys(fileStates);
      if (stateList.length === 1 && STATE_NAMES[stateList[0]]) {
        myState = stateList[0];
        stateFrom = 'the supplier state chosen inside the files, not a GSTIN';
      }
    }

    out.row('Period', range.text);
    out.row('', range.label + ', FY ' + fyLabel(fyStart));
    if (myGstin || myState) {
      out.row('Your GSTIN', myGstin || '(none given)');
      /* The provenance line matters: the state may have come off a GSTIN's
         first two digits, or, when there was no GSTIN anywhere, off the state
         a file recorded. Claiming the GSTIN in both cases would be a small lie
         about where a load-bearing number came from. */
      out.row('Your state', myState
        ? stateLabel(myState) + (myGstin ? ' — from digits 1-2 of the GSTIN' : '')
        : 'could not be read from the GSTIN');
      /* Guarded: a GSTIN typed too short, or with a state code outside the
         list, gives a raw string to print but no state, and there is then no
         provenance to report. The unguarded version printed a bare
         "read from " under it, which reads like a truncated sentence. */
      if (stateFrom) out.dim('  read from ' + stateFrom);
      else out.dim('  nothing below can be split into CGST and SGST without it');
    } else {
      out.warn('No supplier GSTIN given, and none found inside the files.');
      out.warn('Without it there is no state to compare a place of supply');
      out.warn('against, so every domestic line below is shown as UNDECIDED');
      out.warn('rather than guessed at.');
    }
    out.row('B2C large above', money(thresholdPaise) + ' invoice value, inter-state only');
    out.row('Amounts', 'Indian rupees, computed here in this tab');
    hr();

    /* --- what was read ------------------------------------------------ */
    out.heading('WHAT WAS READ');
    var badFiles = 0;
    for (i = 0; i < files.length; i++) {
      if (files[i].error) {
        // A JSON parse message comes from the engine and can be a whole
        // sentence with a position in it, so it folds rather than running off.
        wrapOut('  ', files[i].name + ' — ' + files[i].error, 't-err');
        badFiles++;
      } else {
        out.line('  ' + padR(files[i].name, 46) +
                 padL(plural(files[i].docs.length, 'document', 'documents'), 20));
      }
    }
    if (!files.length) out.dim('  no .json files loaded');
    if (badFiles) {
      out.warn('  ' + plural(badFiles, 'file', 'files') +
               ' could not be read and contributed nothing to the totals.');
    }
    if (csvResult) {
      if (csvResult.error) wrapOut('  ', 'CSV box — ' + csvResult.error, 't-err');
      else {
        out.line('  ' + padR('CSV box (' + csvResult.rows + ' rows)', 46) +
                 padL(plural(csvResult.docs.length, 'document', 'documents'), 20));
        if (csvResult.unknown && csvResult.unknown.length) {
          out.dim('  columns ignored: ' + csvResult.unknown.join(', '));
        }
      }
    } else out.dim('  CSV box empty');

    if (!docs.length) {
      hr();
      out.warn('Nothing to add up yet.');
      out.dim('Drop the invoice-data.json files that /labs/invoice-maker writes,');
      out.dim('or paste a CSV with a header row carrying at least date,');
      out.dim('invoice_no, taxable_value and rate. Press "Load an example" to see');
      out.dim('the shape of both.');
      return;
    }

    /* --- classify ------------------------------------------------------ */
    var inPeriod = [], inFy = [], outOfPeriod = [], outOfFy = [], noDate = [];
    var skipped = [], ambiguousDates = 0, flippedDates = 0;
    for (i = 0; i < docs.length; i++) {
      var d = docs[i];
      if (d.skip) { skipped.push(d); continue; }
      if (d.ambiguous) ambiguousDates++;
      if (d.flipped) flippedDates++;
      if (!d.date) { noDate.push(d); continue; }
      if (fyStartOf(d.date) === fyStart) {
        inFy.push(d);
        if (d.date.getTime() >= range.start.getTime() &&
            d.date.getTime() < range.endExcl.getTime()) inPeriod.push(d);
        else outOfPeriod.push(d);
      } else outOfFy.push(d);
    }

    out.line('');
    out.row('Documents seen', String(docs.length));
    out.row('In the period', String(inPeriod.length) + ' — these are the ones added up');
    out.row('In the FY, not period', String(outOfPeriod.length));
    out.row('Outside FY ' + fyLabel(fyStart), String(outOfFy.length));
    out.row('No usable date', String(noDate.length));
    out.row('Set aside', String(skipped.length) + ' (quotations, composition, unregistered)');
    hr();

    /* --- the arithmetic ------------------------------------------------ */
    var rateBuckets = {}, rateOrder = [];
    var splits = {
      b2b: blankBucket(), b2cl: blankBucket(), b2cs: blankBucket(),
      undecided: blankBucket()
    };
    var notes = { credit: blankBucket(), debit: blankBucket() };
    var zero = {
      exp_wp: { taxable: 0, igst: 0, count: 0 },
      exp_lut: { taxable: 0, igst: 0, count: 0 },
      sez_wp: { taxable: 0, igst: 0, count: 0 },
      sez_lut: { taxable: 0, igst: 0, count: 0 }
    };
    var unusualRates = {};
    /* An invoice with a 12% line and an 18% line appears in two rate rows,
       so the Docs column cannot be totalled down the page — the TOTAL row
       carries a count of DISTINCT documents instead. */
    var domSeen = {}, domCount = 0;
    var taxMismatches = [], missingPos = [], posMismatch = [], gstinProblems = [];
    var gstinSeen = {};
    var j;

    for (i = 0; i < inPeriod.length; i++) {
      var doc = inPeriod[i];
      var sign = doc.kind === 'credit' ? -1 : 1;
      var pos = resolvePos(doc);
      var isB2b = false;

      if (doc.gstin) {
        var gc = checkGstin(doc.gstin);
        if (gc) {
          isB2b = true;
          if (!has(gstinSeen, gc.raw)) {
            gstinSeen[gc.raw] = true;
            if (gc.bad.length || gc.notes.length) {
              gstinProblems.push({ doc: doc, check: gc });
            }
          }
          if (gc.ok && pos && gc.state && gc.state !== pos) {
            posMismatch.push({ doc: doc, gstinState: gc.state, pos: pos });
          }
        }
      }

      var isZero = doc.supply !== 'domestic';
      if (!isZero && !pos) missingPos.push(doc);

      var docTaxable = 0, docTax = 0;
      var perDoc = [];

      for (j = 0; j < doc.lines.length; j++) {
        var line = doc.lines[j];
        var taxable = sign * line.taxable;
        var rate = line.rate;
        var cgst = 0, sgst = 0, igst = 0, decided = true;

        if (isZero) {
          if (doc.supply === 'exp_wp' || doc.supply === 'sez_wp') {
            igst = Math.round(taxable * rate / 100);
          }
        } else if (!myState || !pos) {
          decided = false;
        } else if (myState === pos) {
          cgst = Math.round(taxable * (rate / 2) / 100);
          sgst = Math.round(taxable * (rate / 2) / 100);
        } else {
          igst = Math.round(taxable * rate / 100);
        }

        if (!isZero && KNOWN_RATES.indexOf(rate) < 0) unusualRates[String(rate)] = true;

        if (line.taxGiven !== null && line.taxGiven !== undefined) {
          /* Under a LUT or bond the correct tax IS nil, so the expectation
             is zero rather than rate times value — otherwise every honest
             export row would be reported as a mismatch. */
          var expected = (doc.supply === 'exp_lut' || doc.supply === 'sez_lut')
            ? 0 : Math.round(line.taxable * rate / 100);
          if (Math.abs(line.taxGiven - expected) > TAX_TOL) {
            taxMismatches.push({
              doc: doc, rate: rate, taxable: line.taxable,
              given: line.taxGiven, expected: expected
            });
          }
        }

        docTaxable += taxable;
        docTax += cgst + sgst + igst;
        perDoc.push({ rate: rate, taxable: taxable, cgst: cgst, sgst: sgst,
                      igst: igst, decided: decided, zero: isZero });
      }

      if (isZero) {
        var z = zero[doc.supply];
        z.taxable += docTaxable;
        z.igst += docTax;
        z.count++;
        continue;
      }

      var domKey = '#' + doc.source + '|' + doc.number;
      if (!has(domSeen, domKey)) { domSeen[domKey] = true; domCount++; }

      // Invoice value including tax, which is what the B2C large threshold is
      // tested against — not the taxable value.
      var docValue = docTaxable + docTax;
      var interState = myState && pos && myState !== pos;
      var target;
      if (!myState || !pos) target = splits.undecided;
      else if (isB2b) target = splits.b2b;
      else if (interState && Math.abs(docValue) > thresholdPaise) target = splits.b2cl;
      else target = splits.b2cs;

      for (j = 0; j < perDoc.length; j++) {
        var pd = perDoc[j];
        var key = String(pd.rate);
        if (!has(rateBuckets, key)) {
          rateBuckets[key] = blankBucket();
          rateBuckets[key].rate = pd.rate;
          rateOrder.push(key);
        }
        addTo(rateBuckets[key], doc, pd.taxable, pd.cgst, pd.sgst, pd.igst);
        addTo(target, doc, pd.taxable, pd.cgst, pd.sgst, pd.igst);
        if (doc.kind === 'credit') addTo(notes.credit, doc, pd.taxable, pd.cgst, pd.sgst, pd.igst);
        if (doc.kind === 'debit') addTo(notes.debit, doc, pd.taxable, pd.cgst, pd.sgst, pd.igst);
      }
    }

    rateOrder.sort(function (a, b) { return parseFloat(a) - parseFloat(b); });

    /* --- rate-wise table ---------------------------------------------- */
    var halfName = myState ? stateHalfName(myState) : 'SGST/UTGST';
    var exportRows = [];

    out.heading('RATE-WISE, DOMESTIC SUPPLIES — the shape GSTR-1 and 3B want');
    out.dim(trow(['Rate', 'Taxable value', 'CGST', halfName, 'IGST', 'Docs'],
                 RATE_COLS, true));
    hr();
    var tot = blankBucket();
    if (!rateOrder.length) out.dim('  nothing in the domestic buckets for this period');
    for (i = 0; i < rateOrder.length; i++) {
      var rb = rateBuckets[rateOrder[i]];
      out.line(trow([rateLabel(rb.rate), money(rb.taxable), money(rb.cgst),
                     money(rb.sgst), money(rb.igst), String(rb.count)],
                    RATE_COLS, true));
      exportRows.push(['rate', rateLabel(rb.rate), rb.taxable, rb.cgst, rb.sgst, rb.igst, rb.count]);
      tot.taxable += rb.taxable; tot.cgst += rb.cgst;
      tot.sgst += rb.sgst; tot.igst += rb.igst;
    }
    hr();
    out.line(trow(['TOTAL', money(tot.taxable), money(tot.cgst), money(tot.sgst),
                   money(tot.igst), String(domCount)], RATE_COLS, true), 't-info');
    exportRows.push(['rate', 'TOTAL', tot.taxable, tot.cgst, tot.sgst, tot.igst, domCount]);
    out.line('');
    if (myState) {
      out.dim('Intra-state means the place of supply equals ' + stateLabel(myState) +
              ', and splits');
      out.dim('into CGST and ' + halfName + ' at half the rate each, computed separately.');
      out.dim('Anything else is inter-state and takes IGST at the full rate.');
      if (UT_NO_LEG[myState]) {
        out.dim(stateLabel(myState) + ' is a union territory without a legislature,');
        out.dim('so the state half is UTGST rather than SGST.');
      }
    } else {
      out.warn('No supplier state, so no line above could be split. Type your');
      out.warn('GSTIN into the settings row and run it again.');
    }
    if (Object.keys(unusualRates).length) {
      out.line('');
      out.warn('Rates outside the usual set are present: ' +
               Object.keys(unusualRates).join(', ') + '. They are added up as');
      out.warn('given — check they are what you meant.');
    }
    hr('=');

    /* --- B2B / B2C ----------------------------------------------------- */
    out.heading('B2B, B2C LARGE AND B2C SMALL');
    out.dim(trow(['Bucket', 'Taxable value', 'CGST', halfName, 'IGST'], SPLIT_COLS, true));
    hr();
    var splitRows = [
      ['B2B registered', splits.b2b],
      ['B2C large', splits.b2cl],
      ['B2C small', splits.b2cs],
      ['Undecided', splits.undecided]
    ];
    for (i = 0; i < splitRows.length; i++) {
      var sb = splitRows[i][1];
      out.line(trow([splitRows[i][0], money(sb.taxable), money(sb.cgst),
                     money(sb.sgst), money(sb.igst)], SPLIT_COLS, true),
               splitRows[i][0] === 'Undecided' && sb.count ? 't-warn' : null);
      exportRows.push(['split', splitRows[i][0], sb.taxable, sb.cgst, sb.sgst, sb.igst, sb.count]);
    }
    out.line('');
    out.dim('B2B is every document where the recipient gave a GSTIN. B2C large is');
    out.dim('an INTER-state supply to someone unregistered whose invoice value,');
    out.dim('tax included, is above ' + money(thresholdPaise) + '. Intra-state B2C is small');
    out.dim('whatever its value. That threshold is a setting because it moved from');
    out.dim('2,50,000 to 1,00,000 in November 2024, and it can move again.');
    if (splits.undecided.count) {
      out.line('');
      out.warn(plural(splits.undecided.count, 'document', 'documents') +
               ' could not be placed: a state code is missing, so');
      out.warn('CGST/SGST versus IGST is undecidable. They are listed below rather');
      out.warn('than guessed at.');
    }
    hr('=');

    /* --- credit and debit notes ---------------------------------------- */
    out.heading('CREDIT AND DEBIT NOTES');
    out.dim('Already netted into the tables above — this is the same money shown');
    out.dim('separately so you can see how much of the movement it is.');
    out.line('');
    out.line(trow(['Credit notes', money(notes.credit.taxable), money(notes.credit.cgst),
                   money(notes.credit.sgst), money(notes.credit.igst)], SPLIT_COLS, true));
    out.line(trow(['Debit notes', money(notes.debit.taxable), money(notes.debit.cgst),
                   money(notes.debit.sgst), money(notes.debit.igst)], SPLIT_COLS, true));
    exportRows.push(['notes', 'Credit notes', notes.credit.taxable, notes.credit.cgst,
                     notes.credit.sgst, notes.credit.igst, notes.credit.count]);
    exportRows.push(['notes', 'Debit notes', notes.debit.taxable, notes.debit.cgst,
                     notes.debit.sgst, notes.debit.igst, notes.debit.count]);
    out.line('');
    out.dim('Credit and debit notes reach this page only through the CSV: the');
    out.dim('invoice maker has no credit-note document type, so its .json files');
    out.dim('never carry one.');
    out.dim('A credit note carries a minus sign here. Nothing on this page checks');
    out.dim('the time limit for reporting one, or whether the recipient reversed');
    out.dim('the credit — both need the other side\'s filings.');
    if (csvResult && csvResult.negCredits) {
      /* The line above is flatly untrue for these rows, and this is the table
         where the wrong figure is on screen, so the contradiction is answered
         here rather than only in the CHECKS list further down. */
      out.line('');
      out.err('Except for ' + plural(csvResult.negCredits, 'row', 'rows') +
              ': a credit-note row whose taxable value was ALSO');
      out.err('written negative has had the two minus signs cancel, so it added to');
      out.err('the figures above instead of reducing them. Those rows are listed');
      out.err('under CHECKS with the size of the error.');
    }
    hr('=');

    /* --- zero-rated ---------------------------------------------------- */
    out.heading('ZERO-RATED — kept out of the rate buckets above');
    out.dim(trow(['Supply', 'Taxable value', 'IGST', 'Docs'], ZERO_COLS, true));
    hr();
    var zeroKeys = ['exp_wp', 'exp_lut', 'sez_wp', 'sez_lut'];
    var zeroAny = false;
    for (i = 0; i < zeroKeys.length; i++) {
      var zk = zero[zeroKeys[i]];
      if (zk.count) zeroAny = true;
      out.line(trow([SUPPLY_LABELS[zeroKeys[i]], money(zk.taxable), money(zk.igst),
                     String(zk.count)], ZERO_COLS, true));
      exportRows.push(['zero', SUPPLY_LABELS[zeroKeys[i]], zk.taxable, 0, 0, zk.igst, zk.count]);
    }
    out.line('');
    if (!zeroAny) {
      out.dim('Nothing zero-rated in this period. Exports and SEZ supplies are');
      out.dim('recognised from taxMode "export" in an invoice-maker file, or from');
      out.dim('a supply_type column in the CSV.');
    }
    out.dim('Under a LUT or bond no tax is charged, so the IGST column is nil and');
    out.dim('the refund route is the unutilised input credit. With payment of tax');
    out.dim('the IGST is charged and claimed back. Which route you are on is a');
    out.dim('fact about your LUT, not something this page can work out.');
    out.dim('An invoice-maker .json cannot say whether a zero-rated supply was an');
    out.dim('export or an SEZ supply — it has one mode for both — so those land in');
    out.dim('the export row. The CSV supply_type column does separate them.');
    out.dim('Nil-rated, exempt and non-GST supplies are NOT separated here — they');
    out.dim('all land in the 0% row above, and GSTR-1 wants them apart.');
    hr('=');

    /* --- liability recap ----------------------------------------------- */
    out.heading('OUTPUT TAX IN THE PERIOD');
    var totalTax = tot.cgst + tot.sgst + tot.igst +
                   zero.exp_wp.igst + zero.sez_wp.igst;
    // padL rather than out.row, so the decimal points line up under each
    // other the way they do in every table above.
    out.line(padR('  CGST', 24) + padL(money(tot.cgst), 20));
    out.line(padR('  ' + halfName, 24) + padL(money(tot.sgst), 20));
    out.line(padR('  IGST', 24) +
             padL(money(tot.igst + zero.exp_wp.igst + zero.sez_wp.igst), 20));
    out.line(padR('  Total output tax', 24) + padL(money(totalTax), 20), 't-info');
    out.line('');
    out.warn('This is OUTPUT tax only. It is not what you pay.');
    out.dim('Not here, and each needs data this page has never seen: input tax');
    out.dim('credit, reverse charge on inward supplies, advances received and');
    out.dim('adjusted, amendments to earlier periods, TDS and TCS credits,');
    out.dim('compensation cess, interest and late fee. A 3B liability computed');
    out.dim('from output tax alone would be wrong in your favour, which is the');
    out.dim('expensive direction.');
    hr('=');

    /* --- checks --------------------------------------------------------- */
    out.heading('CHECKS');
    /* This counter decides the single line at the foot of the sheet, so it has
       to count everything that made the totals incomplete — not just the
       findings printed below it.

       A file that would not parse, and a CSV row that was skipped, are both
       reported up in WHAT WAS READ and never reach a check down here. They
       were not counted, and the sheet would then print "Nothing flagged" over
       a total that is missing rows. On a tax working sheet that is the worst
       sentence available, so they are seeded in. */
    var flagged = 0;
    if (badFiles) flagged++;
    if (csvResult && csvResult.problems && csvResult.problems.length) flagged++;

    // Supplier consistency.
    if (fileGstinList.length > 1) {
      flagged++;
      out.err('More than one supplier GSTIN across the files: ' + fileGstinList.join(', '));
      out.dim('  One return covers one registration. Split these before filing.');
      out.line('');
    }
    if (myCheck && (myCheck.bad.length || myCheck.notes.length)) {
      flagged++;
      out.warn('Your own GSTIN, ' + myCheck.raw + ':');
      for (i = 0; i < myCheck.bad.length; i++) wrapOut('  ', 'it ' + myCheck.bad[i], 't-err');
      for (i = 0; i < myCheck.notes.length; i++) wrapOut('  ', 'note: ' + myCheck.notes[i], 't-dim');
      out.line('');
    }

    // GSTIN checksum and structure.
    if (gstinProblems.length) {
      flagged++;
      out.warn(plural(gstinProblems.length, 'recipient GSTIN has', 'recipient GSTINs have') +
               ' something wrong with it:');
      for (i = 0; i < gstinProblems.length && i < 25; i++) {
        var gp = gstinProblems[i];
        wrapOut('  ', gp.check.raw + '  on ' + gp.doc.number +
                (gp.doc.customer ? '  (' + gp.doc.customer + ')' : ''),
                gp.check.bad.length ? 't-err' : 't-warn');
        for (j = 0; j < gp.check.bad.length; j++) wrapOut('      ', 'it ' + gp.check.bad[j], 't-err');
        for (j = 0; j < gp.check.notes.length; j++) wrapOut('      ', 'note: ' + gp.check.notes[j], 't-dim');
      }
      if (gstinProblems.length > 25) {
        out.dim('  ' + (gstinProblems.length - 25) + ' more not listed.');
      }
      out.line('');
    } else {
      out.ok('Every recipient GSTIN in the period is well-formed.');
    }
    out.dim('Well-formed means fifteen characters, a state code in 01-38, 97 or 99,');
    out.dim('a PAN-shaped middle, an entity code, the Z, and a check digit that');
    out.dim('matches. It does NOT mean the registration exists, is active, or');
    out.dim('belongs to the person who gave it to you. Only the GST portal can say');
    out.dim('that, and this page makes no network call of any kind.');
    out.line('');

    // Place of supply.
    if (missingPos.length) {
      flagged++;
      out.warn(plural(missingPos.length, 'document has', 'documents have') +
               ' no place of supply and no recipient GSTIN to');
      out.warn('take it from, so the CGST/SGST versus IGST split is undecided:');
      for (i = 0; i < missingPos.length && i < 15; i++) {
        out.line('  ' + missingPos[i].number + '  ' + fmtDate(missingPos[i].date) +
                 '  ' + missingPos[i].source);
      }
      if (missingPos.length > 15) out.dim('  ' + (missingPos.length - 15) + ' more not listed.');
      out.line('');
    }
    if (posMismatch.length) {
      /* Counted even though it is often legitimate. The alternative was a
         yellow block of findings followed immediately by "Nothing flagged",
         which is the sheet arguing with itself. */
      flagged++;
      out.warn(plural(posMismatch.length, 'document has', 'documents have') +
               ' a place of supply that differs from the');
      out.warn('recipient GSTIN\'s own state. That is legitimate — a supply can be');
      out.warn('made where the buyer is not registered — but it is worth a look:');
      for (i = 0; i < posMismatch.length && i < 15; i++) {
        var pm = posMismatch[i];
        out.line('  ' + pm.doc.number + '  GSTIN says ' + stateLabel(pm.gstinState) +
                 ', POS says ' + stateLabel(pm.pos));
      }
      if (posMismatch.length > 15) out.dim('  ' + (posMismatch.length - 15) + ' more not listed.');
      out.line('');
    }

    // Duplicates, over the whole financial year rather than the period, because
    // a series runs across the year and a duplicate hides across a month edge.
    var dups = findDuplicates(inFy);
    if (dups.length) {
      flagged++;
      out.err(plural(dups.length, 'invoice number is', 'invoice numbers are') +
              ' used more than once in FY ' + fyLabel(fyStart) + ':');
      for (i = 0; i < dups.length && i < 20; i++) {
        out.line('  ' + dups[i][0].number + '  used ' + dups[i].length + ' times:', 't-err');
        for (j = 0; j < dups[i].length && j < 6; j++) {
          out.dim('      ' + fmtDate(dups[i][j].date) + '  ' + dups[i][j].source);
        }
      }
      if (dups.length > 20) out.dim('  ' + (dups.length - 20) + ' more not listed.');
      out.dim('  A number reused inside one financial year is a real problem: the');
      out.dim('  document is not uniquely identifiable. It is also, often, the same');
      out.dim('  invoice loaded twice from two files.');
      out.line('');
    } else {
      out.ok('No repeated invoice numbers in FY ' + fyLabel(fyStart) + '.');
      out.line('');
    }

    // Gaps.
    var seriesInfo = analyseSeries(inFy);
    var gapTotal = 0;
    for (i = 0; i < seriesInfo.series.length; i++) gapTotal += seriesInfo.series[i].gaps.length;
    if (seriesInfo.series.length) {
      out.heading('  Invoice series in FY ' + fyLabel(fyStart));
      for (i = 0; i < seriesInfo.series.length; i++) {
        var sr = seriesInfo.series[i];
        out.line('  ' + padR(sr.label, 30) + padR(sr.kind, 9) +
                 padL(sr.min + ' to ' + sr.max, 18) + padL(sr.count + ' seen', 12));
        if (sr.tooWide) {
          out.dim('      spans ' + (sr.max - sr.min + 1) + ' numbers — too wide to be one');
          out.dim('      run, so gaps were not looked for in it');
        } else if (sr.gaps.length) {
          flagged++;
          var shown = sr.gaps.slice(0, 30).join(', ');
          wrapOut('      ', plural(sr.gaps.length, 'number missing', 'numbers missing') +
                  ': ' + shown +
                  (sr.gaps.length > 30 ? ' and ' + (sr.gaps.length - 30) + ' more' : ''),
                  't-warn');
        } else {
          out.ok('      unbroken from ' + sr.min + ' to ' + sr.max);
        }
        if (sr.mixedWidth) {
          out.dim('      zero-padding is inconsistent in this series (007 and 7 both');
          out.dim('      appear), which is untidy rather than wrong');
        }
      }
      out.line('');
    }
    if (seriesInfo.noSerial.length) {
      out.dim('  ' + plural(seriesInfo.noSerial.length, 'document', 'documents') +
              ' had no number in the number, so no series to check.');
      out.line('');
    }
    if (gapTotal) {
      out.warn('  A GAP IS NOT PROOF OF ANYTHING. Cancelled invoices leave gaps.');
      out.warn('  So do numbers reserved and never used, a second series kept in');
      out.warn('  another book, and documents you simply have not exported here.');
      out.dim('  It is worth knowing because it is the first thing a scrutiny');
      out.dim('  notice asks about, and the answer is much easier to give while');
      out.dim('  you still remember it.');
      out.line('');
    }

    // Tax that does not match rate x taxable.
    if (taxMismatches.length) {
      flagged++;
      out.err(plural(taxMismatches.length, 'row has', 'rows have') +
              ' tax that is not rate times taxable value:');
      for (i = 0; i < taxMismatches.length && i < 20; i++) {
        var tm = taxMismatches[i];
        out.line('  ' + padR(tm.doc.number, 20) + padL(rateLabel(tm.rate), 8) +
                 padL('on ' + money(tm.taxable), 20) +
                 padL('given ' + money(tm.given), 20));
        wrapOut('      ', 'computes to ' + money(tm.expected) + ', a difference of ' +
                money(tm.given - tm.expected), 't-dim');
      }
      if (taxMismatches.length > 20) out.dim('  ' + (taxMismatches.length - 20) + ' more not listed.');
      out.dim('  Tolerance is ' + money(TAX_TOL) + ' a row; anything inside that is');
      out.dim('  ordinary rounding and is not reported.');
      out.line('');
    } else {
      out.ok('No row disagrees with rate times taxable value by more than ' +
             money(TAX_TOL) + '.');
      out.dim('  This check needs a tax column. An invoice-maker .json carries');
      out.dim('  rates and line values but no tax amounts of its own, so for those');
      out.dim('  documents the tax is recomputed here and there is nothing to');
      out.dim('  disagree with.');
      out.line('');
    }

    // Dates.
    if (outOfPeriod.length) {
      flagged++;
      out.warn(plural(outOfPeriod.length, 'document is', 'documents are') +
               ' inside FY ' + fyLabel(fyStart) + ' but outside ' + range.label + ',');
      out.warn('so ' + (outOfPeriod.length === 1 ? 'it is' : 'they are') +
               ' NOT in the totals above:');
      for (i = 0; i < outOfPeriod.length && i < 20; i++) {
        out.line('  ' + padR(outOfPeriod[i].number, 24) +
                 padR(fmtDate(outOfPeriod[i].date), 16) + outOfPeriod[i].source);
      }
      if (outOfPeriod.length > 20) out.dim('  ' + (outOfPeriod.length - 20) + ' more not listed.');
      out.line('');
    }
    if (outOfFy.length) {
      flagged++;
      out.warn(plural(outOfFy.length, 'document falls', 'documents fall') +
               ' outside FY ' + fyLabel(fyStart) + ' entirely:');
      for (i = 0; i < outOfFy.length && i < 20; i++) {
        out.line('  ' + padR(outOfFy[i].number, 24) +
                 padR(fmtDate(outOfFy[i].date), 16) + outOfFy[i].source);
      }
      if (outOfFy.length > 20) out.dim('  ' + (outOfFy.length - 20) + ' more not listed.');
      out.line('');
    }
    if (noDate.length) {
      flagged++;
      out.err(plural(noDate.length, 'document has', 'documents have') +
              ' no date this page could read:');
      for (i = 0; i < noDate.length && i < 20; i++) {
        out.line('  ' + padR(noDate[i].number, 24) +
                 padR('"' + noDate[i].dateRaw + '"', 22) + noDate[i].source);
      }
      if (noDate.length > 20) out.dim('  ' + (noDate.length - 20) + ' more not listed.');
      out.dim('  Readable forms: 2026-03-31, 31/03/2026, 31-03-2026, 31 Mar 2026,');
      out.dim('  20260331. Undated documents are counted nowhere.');
      out.line('');
    }
    if (ambiguousDates) {
      out.dim('  ' + plural(ambiguousDates, 'date was', 'dates were') +
              ' written with both parts 12 or under, so day-first');
      out.dim('  and month-first both parse. They were read DAY first.');
    }
    if (flippedDates) {
      out.dim('  ' + plural(flippedDates, 'date could', 'dates could') +
              ' not be day-first (the second part was over 12),');
      out.dim('  so they were read month-first.');
    }
    if (csvResult && csvResult.problems && csvResult.problems.length) {
      out.line('');
      out.warn('CSV rows with a problem:');
      for (i = 0; i < csvResult.problems.length && i < 25; i++) {
        wrapOut('  ', csvResult.problems[i], 't-warn');
      }
      if (csvResult.problems.length > 25) {
        out.dim('  ' + (csvResult.problems.length - 25) + ' more not listed.');
      }
    }
    if (skipped.length) {
      out.line('');
      out.dim('Set aside, with the reason:');
      for (i = 0; i < skipped.length && i < 20; i++) {
        wrapOut('  ', (skipped[i].number || '(no number)') + ' — ' + skipped[i].skip, 't-dim');
      }
      if (skipped.length > 20) out.dim('  ' + (skipped.length - 20) + ' more not listed.');
    }
    var docNotes = [];
    for (i = 0; i < inPeriod.length; i++) {
      for (j = 0; j < inPeriod[i].notes.length; j++) {
        docNotes.push(inPeriod[i].number + ': ' + inPeriod[i].notes[j]);
      }
    }
    if (docNotes.length) {
      out.line('');
      out.dim('Notes on individual documents:');
      for (i = 0; i < docNotes.length && i < 20; i++) wrapOut('  ', docNotes[i], 't-dim');
      if (docNotes.length > 20) out.dim('  ' + (docNotes.length - 20) + ' more not listed.');
    }

    hr('=');
    if (!flagged) out.ok('Nothing flagged. That is not the same as correct.');
    out.dim('Read the sheet against your books before you file. This page has seen');
    out.dim('only what you gave it, it does not know your LUT status, your');
    out.dim('registration type, your advances or your credits, and it has never');
    out.dim('spoken to the GST portal. Nothing here is advice; if the money is');
    out.dim('material, put it in front of your accountant.');

    buildCsvExport(exportRows, range, fyStart, thresholdPaise, myGstin, myState,
                   inPeriod.length, dups, seriesInfo, taxMismatches,
                   outOfPeriod, outOfFy, noDate, gstinProblems);
  }

  /* ------------------------------------------------------------------
     CSV export of the sheet
     ------------------------------------------------------------------ */

  function csvCell(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvLine(cells) { return cells.map(csvCell).join(','); }

  function rupees(paise) { return (paise / 100).toFixed(2); }

  function buildCsvExport(rows, range, fyStart, threshold, myGstin, myState,
                          docCount, dups, seriesInfo, mismatches,
                          outOfPeriod, outOfFy, noDate, gstinProblems) {
    var lines = [];
    lines.push(csvLine(['section', 'label', 'taxable_value', 'cgst', 'sgst_utgst',
                        'igst', 'documents', 'note']));
    lines.push(csvLine(['meta', 'period', '', '', '', '', '', range.text]));
    lines.push(csvLine(['meta', 'financial_year', '', '', '', '', '', 'FY ' + fyLabel(fyStart)]));
    lines.push(csvLine(['meta', 'supplier_gstin', '', '', '', '', '', myGstin || '(none given)']));
    lines.push(csvLine(['meta', 'supplier_state', '', '', '', '', '',
                        myState ? stateLabel(myState) : '(undecided)']));
    lines.push(csvLine(['meta', 'b2cl_threshold', '', '', '', '', '', rupees(threshold)]));
    lines.push(csvLine(['meta', 'documents_in_period', '', '', '', '', docCount, '']));
    lines.push(csvLine(['meta', 'disclaimer', '', '', '', '', '',
                        'Working sheet only. Not a return, not filed, not connected ' +
                        'to the GST portal, not advice. Output tax only — no ITC, ' +
                        'no RCM, no advances, no amendments, no interest.']));

    rows.forEach(function (r) {
      lines.push(csvLine([r[0], r[1], rupees(r[2]), rupees(r[3]), rupees(r[4]),
                          rupees(r[5]), r[6], '']));
    });

    dups.forEach(function (group) {
      lines.push(csvLine(['check', 'duplicate_number', '', '', '', '', group.length,
                          group[0].number]));
    });
    seriesInfo.series.forEach(function (s) {
      if (s.tooWide) {
        lines.push(csvLine(['check', 'series_not_checked', '', '', '', '', s.count,
                            s.label + ' spans ' + (s.max - s.min + 1) + ' numbers']));
      } else if (s.gaps.length) {
        lines.push(csvLine(['check', 'series_gap', '', '', '', '', s.gaps.length,
                            s.label + ' missing ' + s.gaps.slice(0, 200).join(' ') +
                            ' — a gap is not proof of anything, cancelled invoices leave gaps']));
      }
    });
    mismatches.forEach(function (m) {
      lines.push(csvLine(['check', 'tax_mismatch', rupees(m.taxable), '', '', '', 1,
                          m.doc.number + ' at ' + rateLabel(m.rate) + ': given ' +
                          rupees(m.given) + ', computes to ' + rupees(m.expected)]));
    });
    gstinProblems.forEach(function (g) {
      lines.push(csvLine(['check', 'gstin', '', '', '', '', 1,
                          g.check.raw + ' on ' + g.doc.number + ' — ' +
                          (g.check.bad.concat(g.check.notes)).join('; ')]));
    });
    outOfPeriod.forEach(function (d) {
      lines.push(csvLine(['check', 'outside_period', '', '', '', '', 1,
                          d.number + ' dated ' + fmtDate(d.date)]));
    });
    outOfFy.forEach(function (d) {
      lines.push(csvLine(['check', 'outside_financial_year', '', '', '', '', 1,
                          d.number + ' dated ' + fmtDate(d.date)]));
    });
    noDate.forEach(function (d) {
      lines.push(csvLine(['check', 'unreadable_date', '', '', '', '', 1,
                          d.number + ' has "' + d.dateRaw + '"']));
    });

    lastCsvExport = lines.join('\r\n') + '\r\n';
  }

  /* The sheet carries whatever the visitor's customer names carry, which on an
     Indian invoice is routinely Devanagari or Gujarati, so the export is encoded
     properly rather than by masking each code unit to a byte. A leading BOM is
     included because Excel on Windows still reads a BOM-less UTF-8 CSV in the
     system codepage and turns every such name into mojibake. */
  function utf8Bytes(text) {
    var bytes = [], i, c, lo, cp;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xd800 || c > 0xdfff) {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      } else if (c <= 0xdbff && i + 1 < text.length &&
                 text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        lo = text.charCodeAt(i + 1);
        cp = 0x10000 + ((c - 0xd800) * 0x400) + (lo - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                   0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else {
        // A lone surrogate is not encodable; U+FFFD is the defined answer.
        bytes.push(0xef, 0xbf, 0xbd);
      }
    }
    return new Uint8Array(bytes);
  }

  function exportCsv() {
    if (!lastCsvExport) {
      out.warn('Build the sheet first — there is nothing to export yet.');
      return;
    }
    LabTool.download(utf8Bytes('\ufeff' + lastCsvExport),
                     'gst-working-sheet.csv', 'text/csv');
  }

  /* ------------------------------------------------------------------
     The example

     Made-up data, and said so on screen. The GSTINs are BUILT here rather
     than typed, by computing the check character over a stem — which means
     the example cannot drift out of validity, and one of them is then
     corrupted on purpose so the checksum finding has something to find.
     ------------------------------------------------------------------ */

  function makeGstin(stem14) {
    var c = gstinCheckChar(stem14);
    return c === null ? stem14 : stem14 + c;
  }

  function loadExample() {
    var fyStart = parseInt(el('gstr-fy').value, 10);
    var supplier = makeGstin('24AAACX1234K1Z');
    var buyerGj = makeGstin('24AAAFX5678L1Z');
    var buyerMh = makeGstin('27AAACX4321P1Z');
    // Deliberately broken: shift the check character on by one so the digit
    // fails while the shape still passes.
    var broken = buyerMh.slice(0, 14) +
                 G36.charAt((G36.indexOf(buyerMh.charAt(14)) + 1) % 36);

    var y = fyStart;
    function d(month, day) {
      var m = 3 + month;
      return (y + Math.floor(m / 12)) + '-' + two((m % 12) + 1) + '-' + two(day);
    }

    var ser = 'INV/' + fyLabel(fyStart) + '/';
    var cn = 'CN/' + fyLabel(fyStart) + '/';
    var rows = [
      ['date', 'invoice_no', 'doc_type', 'customer', 'customer_gstin',
       'place_of_supply', 'taxable_value', 'rate', 'tax', 'supply_type'],
      [d(0, 4), ser + '0001', 'invoice', 'Example Buyer One', buyerGj, '24', '50000', '18', '9000', 'domestic'],
      [d(0, 11), ser + '0002', 'invoice', 'Example Buyer Two', buyerMh, '27', '120000', '18', '21600', 'domestic'],
      [d(0, 11), ser + '0002', 'invoice', 'Example Buyer Two', buyerMh, '27', '8000', '12', '960', 'domestic'],
      [d(1, 2), ser + '0004', 'invoice', 'Walk-in, no GSTIN', '', '27', '140000', '18', '25200', 'domestic'],
      [d(1, 9), ser + '0005', 'invoice', 'Example Buyer Three', broken, '29', '30000', '5', '1500', 'domestic'],
      [d(1, 21), ser + '0006', 'invoice', 'Overseas Buyer', '', '', '250000', '18', '0', 'export_lut'],
      [d(2, 3), ser + '0007', 'invoice', 'Example Buyer One', buyerGj, '24', '18000', '0', '0', 'domestic'],
      [d(2, 3), ser + '0007', 'invoice', 'Example Buyer One', buyerGj, '24', '4000', '3', '150', 'domestic'],
      [d(2, 14), cn + '001', 'credit_note', 'Example Buyer Two', buyerMh, '27', '10000', '18', '1800', 'domestic'],
      [d(9, 6), ser + '0008', 'invoice', 'Example Buyer One', buyerGj, '24', '22000', '18', '3960', 'domestic']
    ];

    var text = rows.map(function (r) { return csvLine(r); }).join('\n');
    el('gstr-csv').value = text;
    if (!clean(el('gstr-gstin').value)) el('gstr-gstin').value = supplier;
    el('gstr-period').value = 'q0';

    out.clear();
    out.warn('Example data loaded. It is made up — the names are placeholders and');
    out.warn('the numbers are mine, not anyone\'s books.');
    out.line('');
    out.dim('The three GSTINs it uses — yours and two buyers\' — were built here by');
    out.dim('computing a real check character over the first fourteen positions, so');
    out.dim('all three are well-formed. A fourth is one of those with its check');
    out.dim('character shifted by one, on purpose, so the checksum finding has');
    out.dim('something to catch. Invoice 0003 is missing from the series, 0002 and');
    out.dim('0007 each span two rates, 0007 has a tax figure that does not match,');
    out.dim('there is one credit note and one export under LUT, and 0008 is dated');
    out.dim('in January so the out-of-period check fires against the Q1 period');
    out.dim('that has just been selected.');
    out.line('');
    out.dim('Press Run, or Ctrl+Enter, to build the sheet.');
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */

  LabTool.define({
    id: 'gstreturn',
    run: run,
    onReady: function () {
      fillPeriodSelects();
      wireDrop();
      renderFileList();

      var csvBtn = el('gstr-csvout');
      if (csvBtn) csvBtn.addEventListener('click', exportCsv);
      var exBtn = el('gstr-example');
      if (exBtn) exBtn.addEventListener('click', loadExample);
      var clearBtn = el('gstr-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          files = [];
          renderFileList();
          var note = el('gstr-dropname');
          if (note) note.textContent = '';
          out.clear().ok('Cleared. The CSV box was left alone.');
        });
      }

      out.dim('Drop the invoice-data.json files that /labs/invoice-maker writes, or');
      out.dim('paste a CSV, choose the period, and press Run.');
      out.line('');
      out.dim('CSV wants a header row; the column order does not matter.');
      out.dim('  required   date, invoice_no, taxable_value, rate');
      out.dim('  optional   doc_type, customer, customer_gstin, place_of_supply,');
      out.dim('             tax, supply_type');
      out.dim('  doc_type      invoice | credit_note | debit_note');
      out.dim('  supply_type   domestic | export_lut | export_with_tax |');
      out.dim('                sez_lut | sez_with_tax');
      out.line('');
      /* Said before the caps are hit rather than only when one is, because
         "it stopped at 40 files" is a much worse thing to discover after
         dropping the fifty-first. */
      out.dim('Caps, so the tab stays responsive: ' + LabTool.humanBytes(MAX_FILE) +
              ' a file, ' + MAX_FILES + ' files at');
      out.dim('once, ' + MAX_CSV_ROWS + ' rows in the CSV box. Each one says so if you reach it.');
      out.line('');
      out.dim('This is a working sheet to check your own numbers before you file.');
      out.dim('It does not file anything, it is not connected to the GST portal,');
      out.dim('and it is not a substitute for your accountant. Nothing you drop or');
      out.dim('paste here leaves this tab.');
    }
  });
})();

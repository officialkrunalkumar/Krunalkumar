/* ==========================================================================
   indian-ids.js — format and checksum checks for the Indian identifiers
   people paste into forms all day.
   --------------------------------------------------------------------------
   Every check in here is arithmetic over the characters you typed, and that
   is the whole scope. This page performs no lookup against UIDAI, the Income
   Tax department, the GST portal, RBI, NPCI or any state transport
   authority. It cannot, because nothing in this tab is permitted to make a
   network request. So it cannot tell you that an ID is real, that it belongs
   to the person who gave it to you, or that it has not been cancelled since
   it was issued. A number that passes every check on this page can be
   entirely fictional — a valid checksum only means the number was
   constructed the way a real one would be.

   That paragraph is the product, not a caveat attached to it. The reason
   this lab exists is that "the checksum is fine" gets reported to people as
   "verified", and the gap between those two sentences is where a lot of
   document fraud lives. So the disclaimer is printed at the top of every
   run, restated at the bottom, and carried as a column in the CSV export.

   What it genuinely computes: the Verhoeff checksum over a 12-digit Aadhaar,
   and the 36-alphabet check character over the first 14 characters of a
   GSTIN. Those two are real algorithms with real answers, and the derivation
   is printed so you can check my arithmetic. PAN's tenth character is
   described by the department as an alphabetic check digit but the algorithm
   has never been published, and IFSC has no check digit at all, so for those
   two "the structure is right" is the strongest sentence available and the
   output says exactly that rather than the word "valid".

   Three tables here were typed out offline and will go stale: the IFSC bank
   codes, the UPI handles and the vehicle state codes. Bank mergers retire
   IFSC prefixes, new payment apps get new handles, and states get renamed
   and split. A code missing from any of them is not evidence of anything,
   and the output says so at the point of use rather than in a footnote.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var out = LabTool.out('tool-out');

  /* Rows from the last run, kept only so the CSV button has something to
     write. Cleared on every run; never written to storage. */
  var lastRows = null;

  /* ======================================================================
     Verhoeff — the Aadhaar checksum
     ----------------------------------------------------------------------
     Verhoeff works over the dihedral group of order ten, which is what lets
     it catch every single-digit error and every transposition of adjacent
     digits — the two mistakes humans actually make when copying a number off
     a card. d is the group multiplication table, p is a permutation applied
     by position, and inv is the inverse table used when producing a check
     digit rather than testing one.
     ====================================================================== */

  var VD = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];

  var VP = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];

  var VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

  /* Walks the digits right to left, because the position index has to count
     from the check digit inwards. Returns the running value at each step so
     the tool can print the derivation instead of asserting an answer. */
  function verhoeffTrace(digits) {
    var c = 0;
    var trace = [0];
    for (var i = 0; i < digits.length; i++) {
      var n = digits.charCodeAt(digits.length - 1 - i) - 48;
      c = VD[c][VP[i % 8][n]];
      trace.push(c);
    }
    return { c: c, trace: trace };
  }

  function verhoeffValid(digits) {
    if (!/^[0-9]+$/.test(digits)) return false;
    return verhoeffTrace(digits).c === 0;
  }

  /* The check digit for eleven digits, found by trying all ten and keeping
     the one the validator accepts.

     The closed form — VINV over the eleven digits with the permutation index
     shifted by one — is shorter, and I got that shift wrong twice while
     writing this, producing test numbers that my own validator then rejected.
     Ten calls into the function that is already under test cannot disagree
     with it. VINV stays defined above because it is part of the algorithm as
     published and removing it would make the tables look wrong. */
  function verhoeffDigit(eleven) {
    for (var d = 0; d < 10; d++) {
      if (verhoeffValid(eleven + String(d))) return String(d);
    }
    return null;
  }

  /* ======================================================================
     GSTIN check character
     ----------------------------------------------------------------------
     Base 36 over 0-9 then A-Z. Weights alternate 1, 2 starting at 1 for the
     first character. Each product is folded by adding its quotient and
     remainder against 36 — the same trick the Luhn algorithm uses in base
     ten, and the reason a transposition changes the answer. The check
     character is 36 minus the total modulo 36, taken modulo 36 again so a
     total that lands on a multiple of 36 yields "0" rather than a 36 that
     has no character.
     ====================================================================== */

  var B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function gstinCheck(first14) {
    var sum = 0;
    var steps = [];
    for (var i = 0; i < first14.length; i++) {
      var ch = first14.charAt(i);
      var val = B36.indexOf(ch);
      if (val < 0) return null;
      var w = (i % 2 === 0) ? 1 : 2;
      var prod = val * w;
      var fold = Math.floor(prod / 36) + (prod % 36);
      sum += fold;
      steps.push({ pos: i + 1, ch: ch, val: val, w: w, prod: prod, fold: fold, sum: sum });
    }
    var rem = sum % 36;
    var idx = (36 - rem) % 36;
    return { sum: sum, rem: rem, index: idx, ch: B36.charAt(idx), steps: steps };
  }

  /* ======================================================================
     Offline reference tables. All three go stale. Say so at the point of use.
     ====================================================================== */

  /* GST state codes. 25 and 28 are kept because older registrations still
     carry them, not because they are current. */
  var GST_STATES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
    '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
    '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
    '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
    '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
    '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '25': 'Daman and Diu (legacy code, folded into 26)',
    '26': 'Dadra and Nagar Haveli and Daman and Diu',
    '27': 'Maharashtra',
    '28': 'Andhra Pradesh (pre-2014 code, largely retired)',
    '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
    '33': 'Tamil Nadu', '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
    '37': 'Andhra Pradesh', '38': 'Ladakh',
    '97': 'Other Territory',
    '99': 'Centre jurisdiction (UN bodies, embassies)'
  };

  /* PAN fourth-character holder codes. The department can add codes; a
     letter missing from here is reported as unknown, never as wrong. */
  var PAN_TYPE = {
    A: 'Association of Persons (AOP)',
    B: 'Body of Individuals (BOI)',
    C: 'Company',
    E: 'Limited Liability Partnership (appears in newer material)',
    F: 'Firm, including LLP on older allotments',
    G: 'Government agency',
    H: 'Hindu Undivided Family (HUF)',
    J: 'Artificial Juridical Person',
    L: 'Local Authority',
    P: 'Individual',
    T: 'Trust'
  };

  /* IFSC bank prefixes. A partial snapshot compiled offline. Amalgamations
     retire prefixes on a schedule set by RBI and the acquiring bank, and I
     have no way to notice from inside a browser tab when one of these stops
     being routable. The merged entries are kept because the codes are still
     printed on old cheque books. */
  var IFSC_BANKS = {
    SBIN: 'State Bank of India',
    HDFC: 'HDFC Bank',
    ICIC: 'ICICI Bank',
    UTIB: 'Axis Bank',
    KKBK: 'Kotak Mahindra Bank',
    PUNB: 'Punjab National Bank',
    BARB: 'Bank of Baroda',
    CNRB: 'Canara Bank',
    UBIN: 'Union Bank of India',
    IDIB: 'Indian Bank',
    IOBA: 'Indian Overseas Bank',
    CBIN: 'Central Bank of India',
    MAHB: 'Bank of Maharashtra',
    BKID: 'Bank of India',
    UCBA: 'UCO Bank',
    PSIB: 'Punjab and Sind Bank',
    YESB: 'Yes Bank',
    INDB: 'IndusInd Bank',
    IBKL: 'IDBI Bank',
    IDFB: 'IDFC First Bank',
    FDRL: 'Federal Bank',
    SIBL: 'South Indian Bank',
    KARB: 'Karnataka Bank',
    CIUB: 'City Union Bank',
    TMBL: 'Tamilnad Mercantile Bank',
    KVBL: 'Karur Vysya Bank',
    DCBL: 'DCB Bank',
    RATN: 'RBL Bank',
    BDBL: 'Bandhan Bank',
    CSBK: 'CSB Bank',
    JAKA: 'Jammu and Kashmir Bank',
    NKGS: 'NKGSB Co-operative Bank',
    AUBL: 'AU Small Finance Bank',
    ESFB: 'Equitas Small Finance Bank',
    UJVN: 'Ujjivan Small Finance Bank',
    JSFB: 'Jana Small Finance Bank',
    SURY: 'Suryoday Small Finance Bank',
    FINO: 'Fino Payments Bank',
    AIRP: 'Airtel Payments Bank',
    IPOS: 'India Post Payments Bank',
    HSBC: 'HSBC India',
    CITI: 'Citibank India',
    SCBL: 'Standard Chartered Bank India',
    DBSS: 'DBS Bank India',
    DEUT: 'Deutsche Bank India',
    BOFA: 'Bank of America India',
    CORP: 'Corporation Bank (merged into Union Bank of India, 2020)',
    ANDB: 'Andhra Bank (merged into Union Bank of India, 2020)',
    SYNB: 'Syndicate Bank (merged into Canara Bank, 2020)',
    ORBC: 'Oriental Bank of Commerce (merged into PNB, 2020)',
    UTBI: 'United Bank of India (merged into PNB, 2020)',
    ALLA: 'Allahabad Bank (merged into Indian Bank, 2020)',
    VIJB: 'Vijaya Bank (merged into Bank of Baroda, 2019)',
    BKDN: 'Dena Bank (merged into Bank of Baroda, 2019)',
    LAVB: 'Lakshmi Vilas Bank (merged into DBS Bank India, 2020)'
  };

  /* UPI PSP handles. This is the table most certain to be out of date: a new
     app ships a new handle whenever it signs a new sponsor bank, and nothing
     announces it to a static page. Absence here means nothing at all. */
  var UPI_HANDLES = {
    upi: 'BHIM / NPCI',
    ybl: 'PhonePe, on Yes Bank',
    ibl: 'PhonePe, on ICICI Bank',
    axl: 'PhonePe, on Axis Bank',
    okhdfcbank: 'Google Pay, on HDFC Bank',
    okicici: 'Google Pay, on ICICI Bank',
    okaxis: 'Google Pay, on Axis Bank',
    oksbi: 'Google Pay, on State Bank of India',
    paytm: 'Paytm',
    ptyes: 'Paytm, on Yes Bank',
    ptsbi: 'Paytm, on State Bank of India',
    ptaxis: 'Paytm, on Axis Bank',
    pthdfc: 'Paytm, on HDFC Bank',
    apl: 'Amazon Pay',
    yapl: 'Amazon Pay, on Yes Bank',
    rapl: 'Amazon Pay, on RBL Bank',
    aapl: 'Amazon Pay, on Axis Bank',
    waaxis: 'WhatsApp Pay, on Axis Bank',
    wahdfcbank: 'WhatsApp Pay, on HDFC Bank',
    wasbi: 'WhatsApp Pay, on State Bank of India',
    waicici: 'WhatsApp Pay, on ICICI Bank',
    sliceaxis: 'slice, on Axis Bank',
    jupiteraxis: 'Jupiter, on Axis Bank',
    naviaxis: 'Navi, on Axis Bank',
    ikwik: 'MobiKwik',
    freecharge: 'Freecharge',
    sbi: 'State Bank of India',
    hdfcbank: 'HDFC Bank',
    icici: 'ICICI Bank',
    pockets: 'ICICI Pockets',
    axisbank: 'Axis Bank',
    axisb: 'Axis Bank',
    kotak: 'Kotak Mahindra Bank',
    kmbl: 'Kotak Mahindra Bank',
    indus: 'IndusInd Bank',
    idfcbank: 'IDFC First Bank',
    idfcfirst: 'IDFC First Bank',
    indianbank: 'Indian Bank',
    barodampay: 'Bank of Baroda',
    pnb: 'Punjab National Bank',
    unionbank: 'Union Bank of India',
    uboi: 'Union Bank of India',
    cnrb: 'Canara Bank',
    cboi: 'Central Bank of India',
    fbl: 'Federal Bank',
    federal: 'Federal Bank',
    yesbank: 'Yes Bank',
    yesbankltd: 'Yes Bank',
    airtel: 'Airtel Payments Bank',
    abfspay: 'Aditya Birla Payments',
    postbank: 'India Post Payments Bank'
  };

  /* Vehicle registration state and UT codes. Renames and splits move these:
     Odisha went OR to OD, Uttarakhand went UA to UK, Telangana was carved
     out of Andhra Pradesh in 2014 and later began moving from TS to TG, and
     Ladakh became LA in 2019. Old codes stay on old plates for decades, so
     both forms are listed. */
  var VEH_STATES = {
    AN: 'Andaman and Nicobar Islands',
    AP: 'Andhra Pradesh',
    AR: 'Arunachal Pradesh',
    AS: 'Assam',
    BR: 'Bihar',
    CG: 'Chhattisgarh',
    CH: 'Chandigarh',
    DD: 'Daman and Diu (the UT merged with Dadra and Nagar Haveli in 2020)',
    DL: 'Delhi',
    DN: 'Dadra and Nagar Haveli (older code)',
    GA: 'Goa',
    GJ: 'Gujarat',
    HP: 'Himachal Pradesh',
    HR: 'Haryana',
    JH: 'Jharkhand',
    JK: 'Jammu and Kashmir',
    KA: 'Karnataka',
    KL: 'Kerala',
    LA: 'Ladakh',
    LD: 'Lakshadweep',
    MH: 'Maharashtra',
    ML: 'Meghalaya',
    MN: 'Manipur',
    MP: 'Madhya Pradesh',
    MZ: 'Mizoram',
    NL: 'Nagaland',
    OD: 'Odisha',
    OR: 'Odisha (older code, still on older plates)',
    PB: 'Punjab',
    PY: 'Puducherry',
    RJ: 'Rajasthan',
    SK: 'Sikkim',
    TN: 'Tamil Nadu',
    TR: 'Tripura',
    TS: 'Telangana',
    TG: 'Telangana (newer code)',
    UA: 'Uttarakhand (older code)',
    UK: 'Uttarakhand',
    UP: 'Uttar Pradesh',
    WB: 'West Bengal'
  };

  /* ======================================================================
     Small helpers
     ====================================================================== */

  /* Own-property lookup for every reference table above. Every one of them
     is keyed by text the visitor typed, and a plain table[key] walks the
     prototype chain.

     Found by pasting rubbish at it: the UPI address "someone@constructor"
     came back as "handle in list  yes  function Object() { [native code] }"
     and then printed the note saying the handle was in the offline snapshot.
     Both statements were false and one of them was a page telling somebody
     an address looked recognised. So no table on this page is read
     directly. */
  function lookup(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
  }

  function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s.padEnd(n, ' ');
  }

  function padLeft(s, n) {
    s = String(s);
    while (s.length < n) s = ' ' + s;
    return s;
  }

  /* Strips the separators people actually type — spaces and hyphens — and
     uppercases. Deliberately NOT applied to a UPI address, where a hyphen is
     a legal character in the local part and removing it would silently
     rewrite the thing being checked. */
  function compact(text) {
    return String(text).replace(/[\s\-‐-―]/g, '').toUpperCase();
  }

  /* Aadhaar is echoed masked, here and in the CSV, for the same reason banks
     print only the last four: the number has no business sitting in a
     screenshot or a downloaded file. Row numbers survive the export so a
     bulk run can still be lined up against the input you pasted. */
  function maskAadhaar(s) {
    if (!s) return '(empty)';
    if (s.length <= 4) return s.replace(/[^\s]/g, 'X');
    if (s.length === 12) return 'XXXX XXXX ' + s.slice(-4);
    return new Array(s.length - 3).join('X') + s.slice(-4);
  }

  /* Every other checker echoes what you typed, and the page promises — in
     the gate, in the banner and in the FAQ — that an Aadhaar is echoed
     masked. Those two facts collided: set the type picker to PAN and paste
     an Aadhaar, and the number came back in full in the "entered" row, in
     the bulk table and in the CSV, because nothing on the PAN path knows
     what an Aadhaar looks like. It failed the PAN check, of course, and then
     printed the twelve digits anyway.

     So the masking hangs off the shape of the string rather than off which
     checker happened to run. A bare twelve-digit number is echoed masked
     everywhere on this page. Nothing else can reach this: none of the other
     five formats is twelve bare digits. */
  function echoSafe(s) {
    return /^[0-9]{12}$/.test(s) ? maskAadhaar(s) : s;
  }

  function mkres(kind, label) {
    return {
      kind: kind, label: label, ok: false, reason: '',
      rows: [], notes: [], warns: [], derivation: null, display: null
    };
  }

  function row(r, a, b) { r.rows.push([a, String(b)]); return r; }
  function note(r, s) { r.notes.push(s); return r; }
  function warnr(r, s) { r.warns.push(s); return r; }
  function fail(r, why) { r.ok = false; r.reason = why; return r; }
  function pass(r, why) { r.ok = true; r.reason = why; return r; }

  /* ======================================================================
     1. Aadhaar
     ====================================================================== */

  /* First digit 0 and 1 are not issued. The usual explanation is that they
     are reserved so an Aadhaar number can never be confused with a shorter
     number that has been zero-padded; whatever the reason, UIDAI states the
     numbers begin at 2, so a leading 0 or 1 is a refusal here. */
  function checkAadhaar(rawIn) {
    var s = compact(rawIn);
    var r = mkres('aadhaar', 'Aadhaar');
    r.display = maskAadhaar(s);

    row(r, 'entered', r.display);
    row(r, 'length', s.length + ' characters, 12 required');

    warnr(r, 'Think before you paste a real Aadhaar number anywhere. This');
    warnr(r, 'page keeps nothing and makes no request of any kind, so the');
    warnr(r, 'number never leaves this tab — but that is a promise about');
    warnr(r, 'this page only, and every other box you type it into is a');
    warnr(r, 'separate decision. Masking to the last four digits is the');
    warnr(r, 'norm for a reason, and it is why the echo above is masked.');

    if (s.length !== 12) return fail(r, 'Not 12 digits: got ' + s.length + ' characters.');
    if (!/^[0-9]{12}$/.test(s)) return fail(r, 'Aadhaar is 12 digits, nothing else.');
    if (s.charAt(0) === '0' || s.charAt(0) === '1') {
      row(r, 'first digit', s.charAt(0));
      return fail(r, 'Numbers beginning 0 or 1 are not issued.');
    }

    var t = verhoeffTrace(s);
    r.derivation = { kind: 'verhoeff', trace: t.trace };
    row(r, 'first digit', s.charAt(0) + '  (2 to 9 is the issued range)');
    row(r, 'verhoeff residue', t.c + '  (must be 0)');

    note(r, 'Verhoeff catches every single wrong digit and every swap of two');
    note(r, 'adjacent digits, which is what miskeying a number off a card');
    note(r, 'actually looks like. It catches nothing about whether the');
    note(r, 'number was ever issued, to whom, or whether it is still active.');

    if (t.c !== 0) return fail(r, 'Verhoeff checksum failed: residue ' + t.c + ', expected 0.');
    return pass(r, 'Twelve digits, allowed leading digit, Verhoeff checksum passes.');
  }

  /* ======================================================================
     2. PAN
     ====================================================================== */

  function checkPan(rawIn) {
    var s = compact(rawIn);
    var r = mkres('pan', 'PAN');
    r.display = echoSafe(s);

    row(r, 'entered', r.display);
    row(r, 'length', s.length + ' characters, 10 required');

    if (s.length !== 10) return fail(r, 'Not 10 characters: got ' + s.length + '.');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s)) {
      row(r, 'expected shape', 'AAAAA9999A');
      return fail(r, 'Shape is not five letters, four digits, one letter.');
    }

    var type = s.charAt(3);
    var surname = s.charAt(4);
    var typeName = lookup(PAN_TYPE, type);

    row(r, 'characters 1 to 3', s.slice(0, 3) + '  (a running series, no meaning to read)');
    row(r, 'holder code (4th)', type + '  ' + (typeName || 'not in this page table'));
    row(r, 'name letter (5th)', surname);
    row(r, 'serial (6 to 9)', s.slice(5, 9));
    row(r, 'last character', s.charAt(9));

    if (type === 'P') {
      note(r, 'Holder code P means an individual, so the fifth character is');
      note(r, 'the first letter of the surname as it was written on the');
      note(r, 'application. For every other holder code it is the first');
      note(r, 'letter of the entity name.');
    } else if (typeName) {
      note(r, 'For a holder code other than P the fifth character is the');
      note(r, 'first letter of the entity name as recorded on the');
      note(r, 'application.');
    } else {
      note(r, 'That fourth character is not in this page list of holder');
      note(r, 'codes. The list was typed out offline and the department can');
      note(r, 'add codes, so an unknown letter is not by itself a failure.');
    }

    note(r, 'Matching the fifth character against a surname is a weak check');
    note(r, 'and a common source of false alarms: it follows how the name');
    note(r, 'was recorded at application time, not how the person writes it');
    note(r, 'now, and name order varies enormously across India.');

    warnr(r, 'PAN has no check digit you can run. The tenth character is');
    warnr(r, 'described as an alphabetic check digit, but the algorithm has');
    warnr(r, 'never been published, so nothing offline — this page included');
    warnr(r, '— can verify it. Structure is the whole of what is checkable');
    warnr(r, 'here, and structure is easy to fake on purpose.');

    return pass(r, 'Structure matches AAAAA9999A. No checksum exists to run.');
  }

  /* ======================================================================
     3. GSTIN
     ====================================================================== */

  /* The 13th character is [1-9A-Z] and not [0-9A-Z], because 0 is not an
     entity code — the count of registrations starts at 1.

     It was [0-9A-Z] here first, and that produced a contradiction I only
     found by pasting an entity code of 0 twice. With Z in the 14th slot the
     number matched GSTIN_MAIN, sailed past the entity check further down and
     was reported as a pass; with anything else in the 14th slot it fell
     through to that same check and was failed with "the 13th character
     should be 1 to 9 or A to Z, not 0" — while the note underneath said 0 is
     not used either way. One rule, two answers. Now the regex agrees with
     the check and with the note. */
  var GSTIN_MAIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  var GSTIN_TDS = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][CD][0-9A-Z]$/;
  var GSTIN_UIN = /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]N[0-9A-Z]$/;

  function checkGstin(rawIn) {
    var s = compact(rawIn);
    var r = mkres('gstin', 'GSTIN');
    r.display = echoSafe(s);

    row(r, 'entered', r.display);
    row(r, 'length', s.length + ' characters, 15 required');

    if (s.length !== 15) return fail(r, 'Not 15 characters: got ' + s.length + '.');
    if (!/^[0-9A-Z]{15}$/.test(s)) return fail(r, 'GSTIN uses digits and A to Z only.');

    var state = s.slice(0, 2);
    var pan = s.slice(2, 12);
    var entity = s.charAt(12);
    var slot14 = s.charAt(13);
    var given = s.charAt(14);

    var isMain = GSTIN_MAIN.test(s);
    var isTds = GSTIN_TDS.test(s);
    var isUin = GSTIN_UIN.test(s);

    /* A UIN and an ordinary GSTIN cannot both match: a GSTIN has letters at
       positions 3 and 4 (they are the start of the embedded PAN) and a UIN
       has digits there. So this is a clean branch, not a guess — and it has
       to come before the state and PAN rows, because slicing a UIN as though
       it were a GSTIN produces a nonsense state code and a nonsense PAN and
       prints both as if they meant something. */
    if (isUin && !isMain && !isTds) {
      row(r, 'layout', 'UIN, not an ordinary GSTIN');
      row(r, 'check character', given);
      note(r, 'This matches the separate layout used for a UIN — the number');
      note(r, 'given to UN bodies, embassies and similar — which is four');
      note(r, 'digits, three letters, five digits, then U or O, then N.');
      note(r, 'That is a different shape from an ordinary GSTIN, the ten');
      note(r, 'characters in the middle are not a PAN, and this page does');
      note(r, 'not claim to check a UIN properly.');
      var ucalc = gstinCheck(s.slice(0, 14));
      if (ucalc) {
        row(r, 'same rule would give', ucalc.ch + ', against ' + given + ' here');
        note(r, 'That last row applies the ordinary GSTIN check-character');
        note(r, 'rule to a UIN. Whether the department uses the same rule');
        note(r, 'for UIN is not something this page can confirm, so it is');
        note(r, 'reported and not judged.');
      }
      return pass(r, 'Recognised as the UIN layout. Shape only, nothing verified.');
    }

    var stateName = lookup(GST_STATES, state);
    row(r, 'state code', state + '  ' + (stateName || 'not in this page table'));
    row(r, 'embedded PAN', pan);
    row(r, 'entity number (13th)', entity);
    row(r, '14th character', slot14);
    row(r, 'check character', given);

    if (!stateName) {
      note(r, 'That state code is not in the table on this page, which holds');
      note(r, '01 to 38 plus 97 for Other Territory and 99 for the Centre');
      note(r, 'jurisdiction used by UN bodies and embassies. New codes get');
      note(r, 'added when territories change, so treat this as unknown');
      note(r, 'rather than wrong.');
    }

    if (!isMain && !isTds) {
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(s)) {
        return fail(r, 'Characters 1 to 12 are not two digits followed by a PAN.');
      }
      if (!/^[1-9A-Z]$/.test(entity)) {
        return fail(r, 'The 13th character should be 1 to 9 or A to Z, not ' + entity + '.');
      }
      return fail(r, 'The 14th character is ' + slot14 + '; an ordinary GSTIN carries Z there.');
    }

    if (isTds) {
      note(r, 'The 14th character is ' + slot14 + ' rather than Z, which is the');
      note(r, 'layout used for a TDS or TCS registration rather than an');
      note(r, 'ordinary one. The check character is computed the same way.');
    }

    var panRes = checkPan(pan);
    if (!panRes.ok) {
      note(r, 'The embedded PAN does not hold up structurally: ' + panRes.reason);
    } else {
      var t = pan.charAt(3);
      row(r, 'PAN holder code', t + '  ' + (lookup(PAN_TYPE, t) || 'not in this page table'));
    }

    note(r, 'The 13th character counts how many registrations this PAN');
    note(r, 'holds in this state: 1 for the first, then 2 to 9 and on into');
    note(r, 'A to Z. It is not a random character and 0 is not used.');

    var calc = gstinCheck(s.slice(0, 14));
    if (!calc) return fail(r, 'Could not compute the check character.');
    r.derivation = { kind: 'gstin', calc: calc, given: given };

    row(r, 'computed check', calc.ch + '  (from a running total of ' + calc.sum + ')');

    if (calc.ch !== given) {
      return fail(r, 'Check character is ' + given + '; the algorithm gives ' + calc.ch + '.');
    }
    return pass(r, 'Structure holds and the check character matches.');
  }

  /* ======================================================================
     4. IFSC
     ====================================================================== */

  function checkIfsc(rawIn) {
    var s = compact(rawIn);
    var r = mkres('ifsc', 'IFSC');
    r.display = echoSafe(s);

    row(r, 'entered', r.display);
    row(r, 'length', s.length + ' characters, 11 required');

    if (s.length !== 11) return fail(r, 'Not 11 characters: got ' + s.length + '.');
    if (!/^[A-Z]{4}/.test(s)) return fail(r, 'The first four characters must be letters.');
    if (s.charAt(4) !== '0') {
      row(r, 'fifth character', s.charAt(4));
      return fail(r, 'The fifth character must be 0; this one is ' + s.charAt(4) + '.');
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) {
      return fail(r, 'The last six characters must be letters or digits.');
    }

    var bank = s.slice(0, 4);
    var branch = s.slice(5);
    var name = lookup(IFSC_BANKS, bank);

    row(r, 'bank code', bank + '  ' + (name || 'not in this page table'));
    row(r, 'reserved (5th)', '0  (RBI holds this position at zero)');
    row(r, 'branch code', branch + (/^[0-9]{6}$/.test(branch) ? '  (all digits, the common case)' : '  (mixed letters and digits, which is allowed)'));

    if (name) {
      warnr(r, 'That bank name comes from a partial list I typed out offline.');
      warnr(r, 'It may be stale: amalgamations retire prefixes, and a page');
      warnr(r, 'with no network connection cannot notice. Treat it as a hint.');
    } else {
      note(r, 'That prefix is not in the partial, offline, possibly stale');
      note(r, 'list on this page. Hundreds of banks and co-operative banks');
      note(r, 'hold IFSC prefixes and most are not listed here, so this');
      note(r, 'says nothing about the code being wrong.');
    }

    warnr(r, 'IFSC has no check digit at all. Every one of the six branch');
    warnr(r, 'characters is free, so a made-up code of the right shape is');
    warnr(r, 'indistinguishable from a real one without asking RBI or the');
    warnr(r, 'bank. This page asks nobody.');

    return pass(r, 'Structure matches AAAA0BBBBBB. No checksum exists to run.');
  }

  /* ======================================================================
     5. UPI virtual payment address
     ====================================================================== */

  function checkVpa(rawIn) {
    var s = String(rawIn).replace(/\s+/g, '');
    var r = mkres('vpa', 'UPI address');
    r.display = echoSafe(s);

    row(r, 'entered', r.display);

    var at = s.indexOf('@');
    if (at < 0) return fail(r, 'A UPI address needs an @ separating the name from the handle.');
    if (s.indexOf('@', at + 1) >= 0) return fail(r, 'More than one @ in the address.');

    var local = s.slice(0, at);
    var handle = s.slice(at + 1);

    row(r, 'local part', local || '(empty)');
    row(r, 'handle', handle || '(empty)');

    if (!local) return fail(r, 'Nothing before the @.');
    if (!handle) return fail(r, 'Nothing after the @.');

    /* NPCI documents the address as alphanumeric with dot, hyphen and
       underscore permitted. Individual PSPs are stricter than that — several
       allow letters and digits only — so passing here means "NPCI would not
       reject the shape", not "your app will accept it". */
    if (!/^[A-Za-z0-9.\-_]+$/.test(local)) {
      return fail(r, 'The local part allows letters, digits, dot, hyphen and underscore only.');
    }
    if (/^[.\-_]/.test(local) || /[.\-_]$/.test(local)) {
      return fail(r, 'The local part should not begin or end with a dot, hyphen or underscore.');
    }
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(handle)) {
      return fail(r, 'A PSP handle is letters and digits, starting with a letter.');
    }

    var known = lookup(UPI_HANDLES, handle.toLowerCase());
    row(r, 'handle in list', known ? 'yes  ' + known : 'no');

    if (/^[0-9]{10}$/.test(local)) {
      note(r, 'The local part is ten digits, so this is probably a mobile');
      note(r, 'number address. That is normal and says nothing extra about');
      note(r, 'whether it resolves.');
    }

    if (!known) {
      note(r, 'That handle is not in the list on this page. The list is a');
      note(r, 'partial snapshot compiled offline and goes stale quickly:');
      note(r, 'new handles appear whenever an app signs a new sponsor bank,');
      note(r, 'so an unlisted handle is completely ordinary.');
    } else {
      note(r, 'The handle is in the offline snapshot on this page. That is a');
      note(r, 'shape hint only, and the snapshot may already be out of date.');
    }

    warnr(r, 'A UPI address cannot be verified without a network call. Only');
    warnr(r, 'the payment service provider knows whether an address resolves');
    warnr(r, 'and to whom, and finding out means asking it. This page never');
    warnr(r, 'does. A perfectly formed address belonging to nobody looks');
    warnr(r, 'exactly like one belonging to your landlord.');

    return pass(r, 'Shape is acceptable. Whether it resolves cannot be checked offline.');
  }

  /* ======================================================================
     6. Vehicle registration
     ====================================================================== */

  var VEH_CURRENT = /^([A-Z]{2})([0-9]{2})([A-Z]{1,3})([0-9]{4})$/;
  var VEH_BH = /^([0-9]{2})BH([0-9]{4})([A-Z]{1,2})$/;
  var VEH_DIPLO = /^([0-9]{1,3})(CD|CC|UN)([0-9]{1,4})$/;
  var VEH_NOSERIES = /^([A-Z]{2})([0-9]{2})([0-9]{4})$/;
  var VEH_PRE1989 = /^([A-Z]{3})([0-9]{1,4})$/;
  var VEH_LOOSE = /^([A-Z]{2})([0-9]{1,2})([A-Z]{0,3})([0-9]{1,4})$/;

  function vehicleShape(s) {
    return VEH_CURRENT.test(s) || VEH_BH.test(s) || VEH_DIPLO.test(s) ||
           VEH_NOSERIES.test(s) || VEH_PRE1989.test(s) || VEH_LOOSE.test(s);
  }

  function nameState(r, code) {
    var name = lookup(VEH_STATES, code);
    row(r, 'state code', code + '  ' + (name || 'not in this page table'));
    if (!name) {
      note(r, 'That two-letter code is not in the list on this page. States');
      note(r, 'get renamed, split and recoded, so an unknown code is not a');
      note(r, 'failure — it may simply be newer than this table.');
    }
    return name;
  }

  function rtoNote(r, num) {
    row(r, 'RTO code', num + '  (not checked against any list)');
    note(r, 'The RTO number is not checked. Those lists run to well over a');
    note(r, 'thousand offices across the country, they change as districts');
    note(r, 'are added and offices are split, and shipping a stale copy');
    note(r, 'would make this page call a real plate invalid. A code being');
    note(r, 'unknown here does not make the registration wrong.');
  }

  function checkVehicle(rawIn) {
    var s = compact(rawIn);
    var r = mkres('vehicle', 'Vehicle registration');
    r.display = echoSafe(s);

    row(r, 'entered', r.display);
    row(r, 'length', s.length + ' characters');

    var m = VEH_CURRENT.exec(s);
    if (m) {
      row(r, 'layout', 'current all-India series');
      nameState(r, m[1]);
      rtoNote(r, m[2]);
      row(r, 'series letters', m[3]);
      row(r, 'number', m[4]);
      note(r, 'The current layout is two letters for the state, two digits');
      note(r, 'for the registering office, one to three letters of series,');
      note(r, 'then four digits. When a series runs out the letters advance.');
      warnr(r, 'There is no checksum anywhere in a vehicle registration.');
      warnr(r, 'Nothing here can tell you the plate exists, what it is');
      warnr(r, 'fitted to, or whether it was ever issued.');
      return pass(r, 'Matches the current all-India layout.');
    }

    m = VEH_BH.exec(s);
    if (m) {
      row(r, 'layout', 'BH (Bharat) series');
      row(r, 'year of first reg.', m[1]);
      row(r, 'series', 'BH');
      row(r, 'number', m[2]);
      row(r, 'letters', m[3]);
      note(r, 'BH is the national series for vehicles that move between');
      note(r, 'states with their owner: two digits for the year of first');
      note(r, 'registration, then BH, four digits, then the letter series.');
      note(r, 'The published letter series runs AA to ZZ leaving out I and');
      note(r, 'O, so they are not mistaken for 1 and 0.');
      if (m[3].length === 2 && /[IO]/.test(m[3])) {
        note(r, 'These letters include I or O, which the published series');
        note(r, 'avoids. Flagged, not failed: I would rather be wrong about');
        note(r, 'a rule than call a real plate fake.');
      }
      if (m[3].length === 1) {
        note(r, 'The published format uses two letters here. One is accepted');
        note(r, 'so the tool does not reject something it has simply not');
        note(r, 'been told about.');
      }
      warnr(r, 'There is no checksum in a BH registration either.');
      return pass(r, 'Matches the BH series layout.');
    }

    m = VEH_DIPLO.exec(s);
    if (m) {
      row(r, 'layout', 'diplomatic or consular shape');
      row(r, 'country code', m[1] + '  (not checked)');
      row(r, 'series', m[2]);
      row(r, 'number', m[3]);
      note(r, 'CD, CC and UN plates carry a numeric country or mission code');
      note(r, 'that this page does not hold a list for. The shape is');
      note(r, 'recognised so it is not reported as unreadable; nothing');
      note(r, 'beyond the shape is checked.');
      return pass(r, 'Shape only: a diplomatic or consular layout, nothing verified.');
    }

    m = VEH_NOSERIES.exec(s);
    if (m) {
      row(r, 'layout', 'older layout with no series letters');
      nameState(r, m[1]);
      rtoNote(r, m[2]);
      row(r, 'number', m[3]);
      note(r, 'Registrations issued before a district needed series letters');
      note(r, 'have none. Plenty are still on the road, so this is a valid');
      note(r, 'shape rather than a malformed current one.');
      return pass(r, 'Matches an older layout with no series letters.');
    }

    m = VEH_PRE1989.exec(s);
    if (m) {
      row(r, 'layout', 'pre-1989 style, three letters and a number');
      row(r, 'letters', m[1]);
      row(r, 'number', m[2]);
      note(r, 'Before the current scheme, codes were shorter and assigned');
      note(r, 'differently, and the letters here do not map onto the modern');
      note(r, 'state list. Recognised as a shape only.');
      return pass(r, 'Shape only: an older layout that predates the current scheme.');
    }

    m = VEH_LOOSE.exec(s);
    if (m) {
      row(r, 'layout', 'loose match on an older layout');
      nameState(r, m[1]);
      row(r, 'RTO code', m[2] + '  (not checked)');
      row(r, 'series letters', m[3] || '(none)');
      row(r, 'number', m[4]);
      note(r, 'This matched only the loosest of the older patterns, which');
      note(r, 'allows one or two digits for the office and fewer than four');
      note(r, 'for the number. That pattern accepts a lot, so read this as');
      note(r, '"nothing obviously wrong" rather than as a pass.');
      return pass(r, 'Loose match on an older layout. A weak check by design.');
    }

    note(r, 'Military registrations are a different scheme again, with a');
    note(r, 'leading arrow, a year, a base number and a trailing check');
    note(r, 'letter. This page does not attempt them.');
    return fail(r, 'Does not match any vehicle layout this page knows.');
  }

  /* ======================================================================
     Detection
     ----------------------------------------------------------------------
     Six formats with six different lengths and six different letter and
     digit layouts collide far less often than you would expect, so this
     usually returns exactly one candidate. It still returns a list, and the
     caller still says "ambiguous" and checks every candidate rather than
     silently taking the first, because the moment I hardcode "there is only
     ever one" is the moment somebody pastes the one string that proves
     otherwise.
     ====================================================================== */

  var KINDS = [
    { id: 'aadhaar', label: 'Aadhaar' },
    { id: 'pan', label: 'PAN' },
    { id: 'gstin', label: 'GSTIN' },
    { id: 'ifsc', label: 'IFSC' },
    { id: 'vpa', label: 'UPI address' },
    { id: 'vehicle', label: 'Vehicle registration' }
  ];

  var CHECKERS = {
    aadhaar: checkAadhaar,
    pan: checkPan,
    gstin: checkGstin,
    ifsc: checkIfsc,
    vpa: checkVpa,
    vehicle: checkVehicle
  };

  function labelFor(id) {
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i].id === id) return KINDS[i].label;
    }
    return id;
  }

  function detect(rawIn) {
    var s = compact(rawIn);
    var hits = [];
    if (String(rawIn).indexOf('@') >= 0) hits.push('vpa');
    if (/^[0-9]{12}$/.test(s)) hits.push('aadhaar');
    if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s)) hits.push('pan');
    if (/^[0-9]{2}[A-Z0-9]{13}$/.test(s) || GSTIN_UIN.test(s)) hits.push('gstin');
    if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)) hits.push('ifsc');
    if (vehicleShape(s)) hits.push('vehicle');
    return hits;
  }

  /* When nothing matched, say what the string is rather than shrugging. The
     length and the composition are usually enough for someone to see that
     they pasted a column header or lost a character. */
  function describeUnknown(rawIn) {
    var s = compact(rawIn);
    var digits = (s.match(/[0-9]/g) || []).length;
    var letters = (s.match(/[A-Z]/g) || []).length;
    var other = s.length - digits - letters;
    return s.length + ' characters once spaces and hyphens are removed: ' +
           digits + ' digits, ' + letters + ' letters, ' + other + ' other';
  }

  /* ======================================================================
     Output
     ====================================================================== */

  function printDisclaimer() {
    out.err('FORMAT AND CHECKSUM ONLY. NO LOOKUP IS PERFORMED.');
    out.warn('No request is made to UIDAI, the Income Tax department, the GST');
    out.warn('portal, RBI, NPCI or any transport authority, here or anywhere');
    out.warn('else. This page cannot tell you that an ID is real, that it');
    out.warn('belongs to the person who gave it to you, or that it has not');
    out.warn('been cancelled. A number that passes every check here can be');
    out.warn('entirely fictional: a valid checksum only means the number was');
    out.warn('constructed the way a real one would be.');
    out.rule();
  }

  function printFooter() {
    out.rule();
    out.err('Reminder: format and checksum only. Nothing above was looked up');
    out.err('anywhere, and none of it is advice. Where a rule depends on');
    out.err('something you have not told me, or changes with a finance act,');
    out.err('or varies by state, the output says so instead of guessing.');
  }

  function printDerivation(d) {
    if (!d) return;
    if (d.kind === 'verhoeff') {
      out.line('');
      out.heading('Verhoeff, right to left');
      out.dim('running value after each digit, starting at 0:');
      out.line('  ' + d.trace.join(' '));
      out.dim('The last value must be 0 for the number to check out.');
      return;
    }
    if (d.kind === 'gstin') {
      out.line('');
      out.heading('Check character, character by character');
      out.dim('  ' + pad('pos', 5) + pad('ch', 4) + padLeft('val', 5) +
              padLeft('w', 3) + padLeft('prod', 6) + padLeft('fold', 6) +
              padLeft('total', 7));
      d.calc.steps.forEach(function (st) {
        out.line('  ' + pad(st.pos, 5) + pad(st.ch, 4) + padLeft(st.val, 5) +
                 padLeft(st.w, 3) + padLeft(st.prod, 6) + padLeft(st.fold, 6) +
                 padLeft(st.sum, 7));
      });
      out.dim('  fold = quotient by 36 plus remainder by 36');
      out.line('  total ' + d.calc.sum + ', remainder ' + d.calc.rem +
               ', 36 minus that is ' + d.calc.index + ', which is "' +
               d.calc.ch + '"');
      out.line('  given "' + d.given + '"', d.calc.ch === d.given ? 't-ok' : 't-err');
    }
  }

  function printResult(res) {
    out.heading(res.label);
    res.rows.forEach(function (pair) { out.row(pair[0], pair[1]); });
    printDerivation(res.derivation);
    out.line('');
    if (res.ok) out.ok('PASS  ' + res.reason);
    else out.err('FAIL  ' + res.reason);
    if (res.notes.length) {
      out.line('');
      res.notes.forEach(function (n) { out.dim(n); });
    }
    if (res.warns.length) {
      out.line('');
      res.warns.forEach(function (w) { out.warn(w); });
    }
  }

  /* ======================================================================
     Running
     ====================================================================== */

  /* Split on newlines and on the separators a pasted spreadsheet column
     brings with it. None of the six formats can contain a comma, a tab or a
     semicolon, so splitting on them cannot cut a valid identifier in half. */
  function splitInput(text) {
    var parts = String(text).split(/[\r\n,;\t|]+/);
    var kept = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/^\s+|\s+$/g, '');
      if (t) kept.push(t);
    }
    return kept;
  }

  /* One row of the answer, whatever the input turned out to be. Used by both
     renderers and by the CSV export, so the table, the detailed report and
     the file cannot disagree with each other. */
  function assess(raw, forced) {
    var rec = {
      n: 0, input: raw, kind: '', kindLabel: '', ambiguous: false,
      status: 'unknown', reason: '', res: null, alternatives: []
    };

    /* lookup(), not CHECKERS[forced]: the picker is the only thing that sets
       this, but it is a string off the DOM and CHECKERS is a plain object,
       so the same prototype-chain hole the UPI handles had is open here too.
       An unrecognised value falls through to detection rather than calling
       whatever Object.prototype happened to hand back. */
    var forcedFn = (forced && forced !== 'auto') ? lookup(CHECKERS, forced) : null;

    if (forcedFn) {
      rec.kind = forced;
      rec.kindLabel = labelFor(forced);
      rec.res = forcedFn(raw);
      rec.status = rec.res.ok ? 'pass' : 'fail';
      rec.reason = rec.res.reason;
      rec.input = rec.res.display || raw;
      return rec;
    }

    var hits = detect(raw);
    if (!hits.length) {
      rec.kindLabel = 'unrecognised';
      rec.status = 'unknown';
      rec.reason = 'No known format has this shape. ' + describeUnknown(raw);
      return rec;
    }

    if (hits.length > 1) {
      rec.ambiguous = true;
      var labels = [];
      for (var i = 0; i < hits.length; i++) {
        labels.push(labelFor(hits[i]));
        rec.alternatives.push(CHECKERS[hits[i]](raw));
      }
      rec.kind = hits[0];
      rec.kindLabel = labels.join(' or ');
      rec.res = rec.alternatives[0];
      rec.status = 'ambiguous';
      rec.reason = 'Shape matches more than one format: ' + labels.join(', ') +
                   '. Checked as each rather than guessing.';
      rec.input = rec.res.display || raw;
      return rec;
    }

    rec.kind = hits[0];
    rec.kindLabel = labelFor(hits[0]);
    rec.res = CHECKERS[hits[0]](raw);
    rec.status = rec.res.ok ? 'pass' : 'fail';
    rec.reason = rec.res.reason;
    rec.input = rec.res.display || raw;
    return rec;
  }

  function renderSingle(rec) {
    /* Only the detected kind goes here. Each checker prints its own
       "entered" row, and for Aadhaar that row is the masked one — echoing
       the raw string above it would undo the masking two lines later. */
    out.row('detected as', rec.kindLabel);

    if (rec.broke) {
      out.rule();
      out.row('input', rec.input);
      out.err(rec.reason);
      out.dim('That is a bug on my side, not something wrong with what you');
      out.dim('pasted. The other lines in a bulk run are unaffected, and the');
      out.dim('report link further down the page reaches me.');
      return;
    }

    if (rec.status === 'unknown') {
      out.rule();
      out.row('input', rec.input);
      out.warn('This does not match any format on this page.');
      out.dim(describeUnknown(rec.input));
      out.dim('For reference: Aadhaar is 12 digits, PAN is 10 characters,');
      out.dim('IFSC is 11, GSTIN is 15, a UPI address contains an @, and a');
      out.dim('vehicle number starts with two letters or, for BH, two digits.');
      return;
    }

    if (rec.ambiguous) {
      out.rule();
      out.warn('AMBIGUOUS. This string fits more than one format, so it is');
      out.warn('checked as each of them below rather than guessed at.');
      out.rule();
      rec.alternatives.forEach(function (res, i) {
        if (i) out.rule();
        printResult(res);
      });
      return;
    }

    if (rec.kind === 'aadhaar') {
      out.dim('A bare 12-digit number is also an account number, an order');
      out.dim('reference and a hundred other things. The shape is all this');
      out.dim('page has to go on.');
    }

    out.rule();
    printResult(rec.res);
  }

  function renderBulk(recs) {
    /* Both starting widths are floors for the header words, not arbitrary
       numbers: pad() only ever pads, so a column narrower than its own
       heading has no gap left to print.

       wKind was 4, and the effect showed up on the most ordinary input this
       tool has — one column of one kind. Paste nothing but PANs and every
       detected label is three characters, so the column came out six wide
       and the header read "detectedresult". "input" needs 5 and gets 6+2;
       "detected" needs 8, so the floor is 8; "result" has a fixed 10. */
    var wIn = 6, wKind = 8;
    recs.forEach(function (r) {
      if (String(r.input).length > wIn) wIn = String(r.input).length;
      if (String(r.kindLabel).length > wKind) wKind = String(r.kindLabel).length;
    });
    if (wIn > 34) wIn = 34;
    if (wKind > 24) wKind = 24;

    out.heading(recs.length + ' entries');
    out.dim(pad('#', 4) + pad('input', wIn + 2) + pad('detected', wKind + 2) +
            pad('result', 10) + 'reason');
    out.dim('─'.repeat(Math.min(100, 4 + wIn + 2 + wKind + 2 + 10 + 20)));

    recs.forEach(function (r) {
      var verdict = r.status === 'pass' ? 'PASS' :
                    r.status === 'fail' ? 'FAIL' :
                    r.status === 'ambiguous' ? 'AMBIG' : 'UNKNOWN';
      var cls = r.status === 'pass' ? 't-ok' :
                r.status === 'fail' ? 't-err' : 't-warn';
      var head = pad(r.n, 4) + pad(clip(r.input, wIn), wIn + 2) +
                 pad(clip(r.kindLabel, wKind), wKind + 2) + pad(verdict, 10);
      out.write(head, 't-dim');
      out.line(r.reason, cls);
    });

    out.line('');
    var counts = { pass: 0, fail: 0, ambiguous: 0, unknown: 0 };
    recs.forEach(function (r) { counts[r.status]++; });
    out.row('passed structure', counts.pass);
    out.row('failed', counts.fail);
    out.row('ambiguous', counts.ambiguous);
    out.row('unrecognised', counts.unknown);
    out.line('');
    out.warn('"PASS" here means the characters are arranged the way that');
    out.warn('format arranges them, and where a checksum exists it agrees.');
    out.warn('It does not mean the identifier exists. Use "Download CSV" for');
    out.warn('the same table as a file; every row carries that caveat as a');
    out.warn('column so it survives being pasted into a spreadsheet.');
    out.line('');
    out.dim('Aadhaar entries are shown and exported masked to the last four');
    out.dim('digits. Row numbers are preserved so you can line the export up');
    out.dim('against what you pasted.');
  }

  function clip(s, n) {
    s = String(s);
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
  }

  function run() {
    var input = document.getElementById('tool-in');
    var kindSel = document.getElementById('tool-kind');
    var forced = kindSel ? kindSel.value : 'auto';
    var fields = splitInput(input ? input.value : '');

    out.clear();
    printDisclaimer();

    if (!fields.length) {
      out.warn('Nothing to check. Paste one identifier, or a column of them.');
      lastRows = null;
      return;
    }

    if (fields.length > 2000) {
      out.warn('That is ' + fields.length + ' entries. Stopping at 2000 so the');
      out.warn('page stays responsive — all of this runs on your processor,');
      out.warn('in this tab.');
      fields = fields.slice(0, 2000);
      out.rule();
    }

    var recs = [];
    for (var i = 0; i < fields.length; i++) {
      var rec;
      try {
        rec = assess(fields[i], forced);
      } catch (err) {
        /* status stays 'unknown' so the tally at the bottom of a bulk run
           still adds up — it counts the four statuses and nothing else — but
           the broke flag marks it so a single-entry run reports the failure
           instead of the "no format has this shape" text, which would be a
           flat lie about what happened. echoSafe because the thing that
           broke the checker may well be a twelve-digit number. */
        rec = {
          n: 0, input: echoSafe(compact(fields[i])), kind: '', kindLabel: 'error',
          ambiguous: false, broke: true,
          status: 'unknown', res: null, alternatives: [],
          reason: 'This entry broke the checker: ' + ((err && err.message) || String(err))
        };
      }
      rec.n = i + 1;
      recs.push(rec);
    }

    lastRows = recs;

    if (recs.length === 1) renderSingle(recs[0]);
    else renderBulk(recs);

    printFooter();
  }

  /* ======================================================================
     CSV export
     ====================================================================== */

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var CAVEAT = 'format and checksum only; no lookup was performed; ' +
               'a pass does not mean the identifier exists';

  function saveCsv() {
    if (!lastRows || !lastRows.length) {
      out.line('');
      out.warn('Nothing to export yet. Run a check first.');
      return;
    }
    var lines = ['row,input,detected,result,reason,caveat'];
    lastRows.forEach(function (r) {
      lines.push([
        csvCell(r.n), csvCell(r.input), csvCell(r.kindLabel),
        csvCell(r.status), csvCell(r.reason), csvCell(CAVEAT)
      ].join(','));
    });
    LabTool.download(new TextEncoder().encode(lines.join('\r\n')),
                     'id-format-check.csv', 'text/csv');
    out.line('');
    out.ok('Saved id-format-check.csv (' + lastRows.length + ' rows).');
    out.dim('The file was built in this tab and handed straight to your');
    out.dim('browser. Every row carries the caveat column, because a bare');
    out.dim('"PASS" in a spreadsheet is exactly the thing that gets read as');
    out.dim('"verified" three meetings later.');
  }

  /* ======================================================================
     A format-valid Aadhaar for testing a validator
     ====================================================================== */

  /* Eleven random digits with a leading 2 to 9, then the real Verhoeff check
     digit. Math.random is fine here: this needs to be arbitrary, not
     unguessable. */
  var AADHAAR_SPACE = 8 * Math.pow(10, 10);
  var ISSUED_ROUGH = 1.4e9;

  function fakeAadhaar() {
    var s = String(2 + Math.floor(Math.random() * 8));
    for (var i = 0; i < 10; i++) s += String(Math.floor(Math.random() * 10));
    var d = verhoeffDigit(s);
    return d === null ? null : s + d;
  }

  function makeTest() {
    var n = fakeAadhaar();
    var input = document.getElementById('tool-in');
    out.clear();
    printDisclaimer();

    if (!n) {
      out.err('Could not build a test number, which should be impossible.');
      return;
    }
    if (input) input.value = n;

    out.heading('A FAKE test Aadhaar number');
    out.line(n);
    out.line('');
    out.warn('THIS IS NOT A REAL AADHAAR NUMBER. It is eleven random digits');
    out.warn('with a correct Verhoeff check digit computed on this page, so');
    out.warn('it will satisfy any validator that checks the format. It is');
    out.warn('for testing your own code and nothing else. Do not put it on a');
    out.warn('form. Do not give it to anybody.');
    out.line('');

    var pct = (ISSUED_ROUGH / AADHAAR_SPACE) * 100;
    var oneIn = Math.round(AADHAAR_SPACE / ISSUED_ROUGH);
    out.heading('Could it accidentally be somebody real?');
    out.row('format-valid space', '8 x 10^10 (leading digit 2 to 9, ten free)');
    out.row('rough issued count', '1.4 x 10^9');
    out.row('so, roughly', pct.toFixed(2) + '% — about 1 in ' + oneIn);
    out.line('');
    out.dim('Read that carefully. The 1.4 billion is a published round figure');
    out.dim('I typed into this file, not something the page can check, and');
    out.dim('the arithmetic assumes issued numbers are spread evenly across');
    out.dim('the space, which nobody has told me is true. So the honest');
    out.dim('statement is: a made-up number is very probably unissued, and');
    out.dim('this page has no way whatsoever to confirm that for the one');
    out.dim('above. Treat it as test data, never as evidence that a number');
    out.dim('is free.');
    out.line('');
    out.dim('It has been put in the input box. Press Check to run it.');

    lastRows = null;
  }

  /* ======================================================================
     A mixed example, built rather than typed
     ----------------------------------------------------------------------
     The GSTIN and Aadhaar examples have their check characters computed by
     the same functions the tool uses, so the sample column cannot drift out
     of agreement with the checker the way a hardcoded string would. One
     entry is deliberately broken so the failure path is on screen too.
     ====================================================================== */
  function loadExample() {
    var input = document.getElementById('tool-in');
    if (!input) return;

    var aad = fakeAadhaar() || '';
    var gst14 = '24AAAPA1234A1Z';
    var gcalc = gstinCheck(gst14);
    var gstin = gst14 + (gcalc ? gcalc.ch : '?');
    var broken = gst14 + (gcalc && gcalc.ch !== 'A' ? 'A' : 'B');

    input.value = [
      aad,
      'AAAPA1234A',
      gstin,
      broken,
      'SBIN0001234',
      'someone.name@okhdfcbank',
      'MH 12 AB 1234',
      '22 BH 1234 AA',
      'not an id at all'
    ].join('\n');

    out.clear();
    printDisclaimer();
    out.heading('Example column loaded');
    out.dim('Nine lines: a generated fake Aadhaar, a made-up PAN, a GSTIN');
    out.dim('whose check character was computed here, the same GSTIN with');
    out.dim('that character broken on purpose, an IFSC, a UPI address, two');
    out.dim('vehicle numbers and one line that is not an identifier.');
    out.line('');
    out.warn('Every one of these is invented. None of them was looked up,');
    out.warn('and any of them could coincide with a real identifier without');
    out.warn('this page ever knowing. Press Check to run the column.');
    lastRows = null;
  }

  /* ====================================================================== */

  LabTool.define({
    id: 'indianids',
    run: run,
    onReady: function () {
      /* .lab-terminal is white-space: pre-wrap, which is right for prose and
         wrong for a column-aligned table: a wrapped line drops half a row
         underneath itself and the columns stop lining up. The pane already
         scrolls, so this one pane switches to plain pre and wrapping
         becomes horizontal scrolling. Set inline because the stylesheet is
         shared with every other tool. Borrowed from the SQLite browser,
         which hit this first. */
      if (out.node) out.node.style.whiteSpace = 'pre';

      var csvBtn = document.getElementById('tool-csv');
      if (csvBtn) csvBtn.addEventListener('click', saveCsv);
      var testBtn = document.getElementById('tool-test');
      if (testBtn) testBtn.addEventListener('click', makeTest);
      var egBtn = document.getElementById('tool-example');
      if (egBtn) egBtn.addEventListener('click', loadExample);

      printDisclaimer();
      out.dim('Paste one identifier, or a whole column of them, and press');
      out.dim('Check. Aadhaar, PAN, GSTIN, IFSC, UPI address and vehicle');
      out.dim('registration are recognised by shape; the picker forces one');
      out.dim('kind if you would rather not rely on that.');
      out.line('');
      out.dim('Aadhaar is echoed masked to the last four digits, here and in');
      out.dim('the CSV. Nothing is stored, and no request is made.');
    }
  });
})();

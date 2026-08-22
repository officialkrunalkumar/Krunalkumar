/* ==========================================================================
   biodata-maker.js — the marriage biodata maker on /labs/biodata-maker.
   --------------------------------------------------------------------------
   A biodata is the most personal single page a family ever produces: date and
   time of birth, horoscope details, income, home address, a photograph. The
   "free biodata maker" sites collect exactly that, server-side, before they
   show a watermarked preview. This one does the whole job in the tab: the
   form is read locally, the sheet is plain DOM, the photo never leaves the
   FileReader, and the export is the browser's own print dialog. There is no
   fetch(), no XHR, no beacon anywhere in this file — nothing to leak to
   because nothing is connected to anything.

   Rendering rule: user text reaches the sheet through textContent ONLY.
   The only innerHTML in this file writes constant ornament SVG strings that
   no user input can touch.

   State lives in one object, mirrored to localStorage (debounced) under
   lab.biodata-maker.v1 so a half-finished draft survives a closed tab —
   in this browser, on this machine, and nowhere else. The same object can
   be downloaded as biodata-data.json and loaded back on another device;
   the import goes through the identical validation as the restore, so a
   hand-edited file gets no special trust.

   The labels printed on the sheet can switch between English, Hindi and
   Gujarati (see the SECTIONS table); the form itself stays English, and
   whatever the user types prints exactly as typed.
   ========================================================================== */

(function () {
  'use strict';

  var STORE_KEY = 'lab.biodata-maker.v1';
  var SHEET_W = 794; /* 210mm at 96dpi — must match the CSS width */

  /* ------------------------------------------------------------------
     Field registry. Every text-ish input in the form carries id
     "bm-f-<key>"; the render walks these same keys, so adding a field is
     one row here plus one <label> in the page.
     ------------------------------------------------------------------ */
  var KEYS = [
    'invocation', 'invocationCustom',
    'name', 'dob', 'tob', 'pob', 'rashi', 'nakshatra', 'manglik', 'height',
    'complexion', 'blood', 'religion', 'caste', 'subcaste', 'gotra', 'diet',
    'hobbies', 'languages',
    'education', 'occupation', 'organisation', 'income', 'workLocation',
    'fatherName', 'fatherOcc', 'motherName', 'motherOcc', 'brothers',
    'sisters', 'familyType', 'familyValues', 'nativePlace',
    'contactPerson', 'phone', 'email', 'address',
    'about', 'partner'
  ];

  /* ------------------------------------------------------------------
     Printed-label languages. The FORM stays English — it is the sheet
     that gets handed to grandparents and rishta aunties, so the labels
     printed ON it can switch to Hindi or Gujarati while the person
     filling it in keeps the interface they started with. Values print
     exactly as typed, in whatever script they were typed in; only these
     fixed labels are translated. Every entry is the wording an actual
     printed biodata in that language uses, not a dictionary lookup —
     e.g. "વાન" for complexion, "વતન" for native place.
     ------------------------------------------------------------------ */
  var LABEL_LANGS = ['en', 'hi', 'gu'];

  /* Sections on the sheet, in order. Label text is what actually prints, so
     it is written the way a biodata is actually worded — in all three
     languages. en/hi/gu per label; label() below picks the active one. */
  var SECTIONS = [
    { title: { en: 'Personal details', hi: 'व्यक्तिगत विवरण', gu: 'વ્યક્તિગત વિગતો' }, rows: [
      ['dob', { en: 'Date of birth', hi: 'जन्म तिथि', gu: 'જન્મ તારીખ' }],
      ['tob', { en: 'Time of birth', hi: 'जन्म समय', gu: 'જન્મ સમય' }],
      ['pob', { en: 'Place of birth', hi: 'जन्म स्थान', gu: 'જન્મ સ્થળ' }],
      ['rashi', { en: 'Rashi (moon sign)', hi: 'राशि', gu: 'રાશિ' }],
      ['nakshatra', { en: 'Nakshatra', hi: 'नक्षत्र', gu: 'નક્ષત્ર' }],
      ['manglik', { en: 'Manglik', hi: 'मांगलिक', gu: 'માંગલિક' }],
      ['height', { en: 'Height', hi: 'ऊँचाई', gu: 'ઊંચાઈ' }],
      ['complexion', { en: 'Complexion', hi: 'रंग', gu: 'વાન' }],
      ['blood', { en: 'Blood group', hi: 'रक्त समूह', gu: 'રક્ત જૂથ' }],
      ['religion', { en: 'Religion', hi: 'धर्म', gu: 'ધર્મ' }],
      ['caste', { en: 'Caste', hi: 'जाति', gu: 'જ્ઞાતિ' }],
      ['subcaste', { en: 'Sub-caste', hi: 'उपजाति', gu: 'પેટા જ્ઞાતિ' }],
      ['gotra', { en: 'Gotra', hi: 'गोत्र', gu: 'ગોત્ર' }],
      ['diet', { en: 'Diet', hi: 'आहार', gu: 'આહાર' }],
      ['hobbies', { en: 'Hobbies', hi: 'रुचियाँ', gu: 'શોખ' }],
      ['languages', { en: 'Languages known', hi: 'ज्ञात भाषाएँ', gu: 'આવડતી ભાષાઓ' }]
    ] },
    { title: { en: 'Education & career', hi: 'शिक्षा एवं व्यवसाय', gu: 'શિક્ષણ અને કારકિર્દી' }, rows: [
      ['education', { en: 'Highest education', hi: 'शैक्षणिक योग्यता', gu: 'શૈક્ષણિક લાયકાત' }],
      ['occupation', { en: 'Occupation', hi: 'व्यवसाय', gu: 'વ્યવસાય' }],
      ['organisation', { en: 'Organisation', hi: 'संस्था', gu: 'સંસ્થા' }],
      ['income', { en: 'Annual income', hi: 'वार्षिक आय', gu: 'વાર્ષિક આવક' }],
      ['workLocation', { en: 'Work location', hi: 'कार्यस्थल', gu: 'કાર્યસ્થળ' }]
    ] },
    { title: { en: 'Family', hi: 'परिवार', gu: 'પરિવાર' }, rows: [
      ['fatherName', { en: "Father's name", hi: 'पिता का नाम', gu: 'પિતાનું નામ' }],
      ['fatherOcc', { en: "Father's occupation", hi: 'पिता का व्यवसाय', gu: 'પિતાનો વ્યવસાય' }],
      ['motherName', { en: "Mother's name", hi: 'माता का नाम', gu: 'માતાનું નામ' }],
      ['motherOcc', { en: "Mother's occupation", hi: 'माता का व्यवसाय', gu: 'માતાનો વ્યવસાય' }],
      ['brothers', { en: 'Brothers', hi: 'भाई', gu: 'ભાઈ' }],
      ['sisters', { en: 'Sisters', hi: 'बहनें', gu: 'બહેનો' }],
      ['familyType', { en: 'Family type', hi: 'परिवार का प्रकार', gu: 'પરિવારનો પ્રકાર' }],
      ['familyValues', { en: 'Family values', hi: 'पारिवारिक मूल्य', gu: 'કૌટુંબિક મૂલ્યો' }],
      ['nativePlace', { en: 'Native place', hi: 'मूल निवास', gu: 'વતન' }]
    ] },
    { title: { en: 'Contact', hi: 'संपर्क', gu: 'સંપર્ક' }, rows: [
      ['contactPerson', { en: 'Contact person', hi: 'संपर्क व्यक्ति', gu: 'સંપર્ક વ્યક્તિ' }],
      ['phone', { en: 'Phone', hi: 'फ़ोन', gu: 'ફોન' }],
      ['email', { en: 'Email', hi: 'ईमेल', gu: 'ઈમેલ' }],
      ['address', { en: 'Address', hi: 'पता', gu: 'સરનામું' }]
    ] }
  ];

  /* The two free-text sections carry their headings the same way. */
  var ABOUT_TITLE = { en: 'About myself', hi: 'मेरे बारे में', gu: 'મારા વિશે' };
  var PARTNER_TITLE = {
    en: 'Partner preferences',
    hi: 'जीवनसाथी संबंधी अपेक्षाएँ',
    gu: 'જીવનસાથી અંગેની અપેક્ષાઓ'
  };

  var INVOCATIONS = {
    ganeshaya: '|| Shree Ganeshaya Namah ||',
    om: 'Om Shri Ganeshaya Namah',
    god: 'In the name of God, the Most Gracious',
    ikonkar: 'Ik Onkar'
  };

  var TEMPLATES = ['kumkum', 'ivory', 'lotus', 'royal', 'sada'];

  /* ------------------------------------------------------------------
     Ornament SVG — constant strings, injected per template. All drawn
     here so the page ships no image files and fetches nothing.
     ------------------------------------------------------------------ */

  /* Kumkum: a gold double corner bracket with a small paisley leaf; one
     drawing, rotated into all four corners. */
  var ORN_KUMKUM =
    '<svg viewBox="0 0 100 100" width="92" height="92" aria-hidden="true">' +
    '<g fill="none" stroke="#b9862e" stroke-width="2">' +
    '<path d="M10 92 V26 Q10 10 26 10 H92"/>' +
    '<path d="M19 92 V32 Q19 19 32 19 H92" opacity="0.5"/>' +
    '</g>' +
    '<path d="M32 32 q12 -10 22 0 q-10 12 -22 0 z" fill="#b9862e" opacity="0.45"/>' +
    '<circle cx="10" cy="10" r="3.6" fill="#8c2f1b"/>' +
    '</svg>';

  /* Lotus: a small five-petal bloom with a trailing stem curl, used in two
     corners only — the brief for this template is delicate, not busy. */
  var ORN_LOTUS =
    '<svg viewBox="0 0 140 140" width="132" height="132" aria-hidden="true">' +
    '<g fill="#eab6c5" opacity="0.75">' +
    '<path d="M34 34 Q40 12 46 34 Q40 44 34 34 z"/>' +
    '<path d="M34 34 Q14 26 32 18 Q42 24 34 34 z" transform="rotate(8 34 34)"/>' +
    '<path d="M34 34 Q54 26 36 18 Q26 24 34 34 z" transform="rotate(-8 40 30)"/>' +
    '<ellipse cx="40" cy="40" rx="9" ry="6" transform="rotate(40 40 40)"/>' +
    '<ellipse cx="28" cy="42" rx="9" ry="6" transform="rotate(-40 28 42)"/>' +
    '</g>' +
    '<circle cx="35" cy="33" r="4" fill="#c46e87" opacity="0.8"/>' +
    '<path d="M42 46 Q78 76 122 58" fill="none" stroke="#e5b8c4" stroke-width="2" opacity="0.8"/>' +
    '<path d="M56 58 q6 10 -4 14" fill="none" stroke="#e5b8c4" stroke-width="2" opacity="0.6"/>' +
    '<circle cx="122" cy="58" r="2.5" fill="#e5b8c4" opacity="0.8"/>' +
    '</svg>';

  /* ------------------------------------------------------------------
     Tiny DOM helpers
     ------------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text; /* never innerHTML for content */
    return node;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */
  var state = { tpl: 'kumkum', photo: null, labelLang: 'en' };

  /* Picks the active translation for one label object; English is the
     fallback so a half-formed state can never print an undefined. */
  function label(obj) {
    return obj[state.labelLang] || obj.en;
  }

  function readForm() {
    KEYS.forEach(function (key) {
      var input = $('bm-f-' + key);
      state[key] = input ? input.value : '';
    });
  }

  function writeForm() {
    KEYS.forEach(function (key) {
      var input = $('bm-f-' + key);
      if (input) input.value = state[key] || '';
    });
    syncCustomInvocation();
    syncPhotoUi();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      setStatus('Saved in your browser');
    } catch (err) {
      /* Quota or private mode — the tool still works, it just forgets. */
      setStatus('Could not save (storage is full or blocked)');
    }
  }

  /* Copies a saved object onto the current state, field by field, taking
     only what passes the same checks the localStorage restore has always
     applied. Shared by restore() and the JSON import, so a downloaded file
     gets exactly the scrutiny a stored draft does — no key smuggled into
     state, no non-image data URI smuggled into the photo slot. */
  function applySaved(saved) {
    KEYS.forEach(function (key) {
      if (typeof saved[key] === 'string') state[key] = saved[key];
    });
    if (typeof saved.photo === 'string' &&
        saved.photo.slice(0, 11) === 'data:image/') {
      state.photo = saved.photo;
    }
    if (TEMPLATES.indexOf(saved.tpl) !== -1) state.tpl = saved.tpl;
    /* Drafts saved before the label-language toggle existed have no
       labelLang; state's default 'en' already covers them. */
    if (LABEL_LANGS.indexOf(saved.labelLang) !== -1) state.labelLang = saved.labelLang;
  }

  function restore() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (err) { raw = null; }
    if (!raw) return false;
    try {
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return false;
      applySaved(saved);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* Resets every stateful thing to a blank slate; import builds on this so
     a file that lacks a field cannot leave a stale value behind. */
  function blankState() {
    KEYS.forEach(function (key) { state[key] = ''; });
    state.photo = null;
    state.tpl = 'kumkum';
    state.labelLang = 'en';
  }

  var statusEl = null;
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  /* ------------------------------------------------------------------
     Value formatting. The date/time inputs give ISO strings; a biodata
     says "14 November 1998", not "1998-11-14".
     ------------------------------------------------------------------ */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    return parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1];
  }

  function formatTime(hm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hm);
    if (!m) return hm;
    var h = parseInt(m[1], 10);
    var suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m[2] + ' ' + suffix;
  }

  function displayValue(key) {
    var v = (state[key] || '').trim();
    if (!v) return '';
    if (key === 'dob') return formatDate(v);
    if (key === 'tob') return formatTime(v);
    return v;
  }

  function invocationText() {
    var pick = state.invocation || '';
    if (pick === 'custom') return (state.invocationCustom || '').trim();
    return INVOCATIONS[pick] || '';
  }

  /* ------------------------------------------------------------------
     Sheet rendering — plain DOM, empty things simply do not exist.
     ------------------------------------------------------------------ */
  var sheet = null;

  /* Labels in Hindi or Gujarati get a lang attribute so screen readers pick
     the right voice and the CSS can swap in Indic-capable font fallbacks;
     English labels carry none and inherit the page's lang="en". */
  function labelEl(tag, cls, obj) {
    var node = el(tag, cls, label(obj));
    if (state.labelLang !== 'en') node.setAttribute('lang', state.labelLang);
    return node;
  }

  function render() {
    if (!sheet) return;
    sheet.setAttribute('data-tpl', state.tpl);
    sheet.setAttribute('data-lang', state.labelLang);
    sheet.textContent = '';

    /* Ornament layer first, so it paints under the content. Constant
       strings only — see the header comment. */
    var orn = el('div', 'bm-ornaments');
    orn.setAttribute('aria-hidden', 'true');
    if (state.tpl === 'kumkum') {
      orn.innerHTML =
        cornerSvg(ORN_KUMKUM, 'top:10px;left:10px;') +
        cornerSvg(ORN_KUMKUM, 'top:10px;right:10px;transform:scaleX(-1);') +
        cornerSvg(ORN_KUMKUM, 'bottom:10px;right:10px;transform:scale(-1,-1);') +
        cornerSvg(ORN_KUMKUM, 'bottom:10px;left:10px;transform:scaleY(-1);');
    } else if (state.tpl === 'lotus') {
      orn.innerHTML =
        cornerSvg(ORN_LOTUS, 'top:6px;left:6px;') +
        cornerSvg(ORN_LOTUS, 'bottom:6px;right:6px;transform:scale(-1,-1);');
    }
    sheet.appendChild(orn);

    var content = el('div', 'bm-content');
    var hasAnything = false;

    var inv = invocationText();
    if (inv) {
      hasAnything = true;
      content.appendChild(el('p', 'bm-invocation', inv));
    }

    var name = (state.name || '').trim();
    if (name || state.photo) {
      hasAnything = true;
      var head = el('div', 'bm-head');
      if (state.photo) {
        var img = document.createElement('img');
        img.className = 'bm-photo';
        img.alt = name ? 'Photo of ' + name : 'Photo';
        img.src = state.photo;
        head.appendChild(img);
      }
      if (name) head.appendChild(el('div', 'bm-name', name));
      content.appendChild(head);
    }

    SECTIONS.forEach(function (section) {
      var rows = section.rows
        .map(function (pair) { return [pair[1], displayValue(pair[0])]; })
        .filter(function (pair) { return pair[1] !== ''; });
      if (!rows.length) return;
      hasAnything = true;
      var block = el('section', 'bm-section');
      block.appendChild(labelEl('h3', 'bm-section-title', section.title));
      rows.forEach(function (pair) {
        var row = el('div', 'bm-row');
        row.appendChild(labelEl('div', 'bm-row-label', pair[0]));
        row.appendChild(el('div', 'bm-row-value', pair[1]));
        block.appendChild(row);
      });
      content.appendChild(block);
    });

    var about = (state.about || '').trim();
    if (about) {
      hasAnything = true;
      var aboutBlock = el('section', 'bm-section');
      aboutBlock.appendChild(labelEl('h3', 'bm-section-title', ABOUT_TITLE));
      aboutBlock.appendChild(el('p', 'bm-para', about));
      content.appendChild(aboutBlock);
    }

    var partner = (state.partner || '').trim();
    if (partner) {
      hasAnything = true;
      var partnerBlock = el('section', 'bm-section');
      partnerBlock.appendChild(labelEl('h3', 'bm-section-title', PARTNER_TITLE));
      partnerBlock.appendChild(el('p', 'bm-para', partner));
      content.appendChild(partnerBlock);
    }

    if (!hasAnything) {
      content.appendChild(el('p', 'bm-empty-hint',
        'Start filling the form — the sheet writes itself as you type.'));
    }

    sheet.appendChild(content);
    fitPreview();
  }

  function cornerSvg(svg, style) {
    /* The SVGs position themselves through an inline style on a wrapper so
       one drawing can serve every corner via flips. */
    return svg.replace('<svg ', '<svg style="' + style + '" ');
  }

  /* ------------------------------------------------------------------
     Preview scaling. transform: scale() shrinks pixels, not layout, so
     the wrapper is given the scaled height explicitly or the pane would
     reserve the full 1123px+ and show a huge dead gap.
     ------------------------------------------------------------------ */
  var scaleBox = null;

  function fitPreview() {
    if (!scaleBox || !sheet) return;
    var w = scaleBox.clientWidth;
    if (!w) return;
    var scale = Math.min(1, w / SHEET_W);
    sheet.style.transform = 'scale(' + scale + ')';
    scaleBox.style.height = Math.ceil(sheet.offsetHeight * scale) + 'px';
  }

  /* ------------------------------------------------------------------
     Photo — chosen locally, downscaled locally, stored locally.
     512px on the long side is plenty for a printed 35x42mm frame and
     keeps the localStorage copy small.
     ------------------------------------------------------------------ */
  function handlePhoto(file) {
    if (!file || file.type.indexOf('image/') !== 0) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var long = Math.max(img.width, img.height) || 1;
        var k = Math.min(1, 512 / long);
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        state.photo = canvas.toDataURL('image/jpeg', 0.85);
        syncPhotoUi();
        render();
        saveSoon();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function syncPhotoUi() {
    var thumb = $('bm-photo-thumb');
    var removeBtn = $('bm-photo-remove');
    if (!thumb || !removeBtn) return;
    if (state.photo) {
      thumb.src = state.photo;
      thumb.hidden = false;
      removeBtn.hidden = false;
    } else {
      thumb.removeAttribute('src');
      thumb.hidden = true;
      removeBtn.hidden = true;
    }
  }

  function syncCustomInvocation() {
    var select = $('bm-f-invocation');
    var wrap = $('bm-invocation-custom-wrap');
    if (select && wrap) wrap.hidden = select.value !== 'custom';
  }

  /* ------------------------------------------------------------------
     Sample data — entirely fictional. The placeholder portrait is drawn
     on a canvas right here, so even the example photo involves no file
     and no request.
     ------------------------------------------------------------------ */
  function samplePortrait() {
    var c = document.createElement('canvas');
    c.width = 400; c.height = 480;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 0, 480);
    g.addColorStop(0, '#f3d9c3');
    g.addColorStop(1, '#e0b48f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 480);
    /* A neutral bust silhouette, not a fake person. */
    ctx.fillStyle = 'rgba(122, 78, 60, 0.85)';
    ctx.beginPath();
    ctx.arc(200, 190, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(80, 480);
    ctx.quadraticCurveTo(200, 270, 320, 480);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 28px Georgia, serif';
    ctx.textAlign = 'center';
    /* y=428 keeps the caption inside the circle crop the Lotus and Royal
       templates apply (they show roughly y 40-440 of this canvas). */
    ctx.fillText('Sample photo', 200, 428);
    return c.toDataURL('image/jpeg', 0.85);
  }

  var SAMPLE = {
    invocation: 'ganeshaya',
    invocationCustom: '',
    name: 'Kavya Sharma',
    dob: '1998-11-14', tob: '07:25', pob: 'Jaipur, Rajasthan',
    rashi: 'Vrishabha (Taurus)', nakshatra: 'Rohini', manglik: 'No',
    height: "5' 4\" (162 cm)", complexion: 'Fair', blood: 'B+',
    religion: 'Hindu', caste: 'Brahmin', subcaste: 'Gaur',
    gotra: 'Bharadwaj', diet: 'Vegetarian',
    hobbies: 'Kathak, sketching, baking',
    languages: 'Hindi, English, Rajasthani',
    education: 'M.Sc. Computer Science, University of Rajasthan',
    occupation: 'Software engineer', organisation: 'An IT services firm, Jaipur',
    income: '₹12 LPA', workLocation: 'Jaipur',
    fatherName: 'Rajesh Sharma', fatherOcc: 'Retired bank manager',
    motherName: 'Sunita Sharma', motherOcc: 'Homemaker',
    brothers: '1, married', sisters: '1 younger, studying',
    familyType: 'Nuclear', familyValues: 'Moderate',
    nativePlace: 'Jaipur, Rajasthan',
    contactPerson: 'Father — Rajesh Sharma',
    phone: '+91 98xxx xxxxx', email: 'sharma.family@example.com',
    address: '12, Shanti Niketan Colony,\nCivil Lines, Jaipur — 302006',
    about: 'I am a software engineer who is happiest with a sketchbook on a Sunday morning. I value honesty, quiet humour and family time, and I am looking for a partner who wants an equal, easy-going home.',
    partner: 'A well-educated, kind-natured match aged 26–31, settled in India, vegetarian preferred. Someone who respects family and has interests of their own.'
  };

  function loadSample() {
    KEYS.forEach(function (key) { state[key] = SAMPLE[key] || ''; });
    state.photo = samplePortrait();
    writeForm();
    render();
    saveSoon();
    setStatus('Example loaded — every detail is fictional');
  }

  function clearAll() {
    if (!window.confirm('Clear every field and delete the copy saved in this browser?')) return;
    KEYS.forEach(function (key) { state[key] = ''; });
    state.photo = null;
    try { localStorage.removeItem(STORE_KEY); } catch (err) { /* nothing to do */ }
    writeForm();
    var fileInput = $('bm-f-photo');
    if (fileInput) fileInput.value = '';
    render();
    setStatus('Cleared — nothing is saved any more');
  }

  /* ------------------------------------------------------------------
     JSON export / import. The autosave already keeps a draft in this
     browser; the file pair moves it between browsers and devices — the
     way everything else here moves: as a file the user carries, not a
     record a server holds. Export is a Blob download of the whole state
     (photo included, it is just a data URI); import runs the file
     through applySaved, the same gate the localStorage restore uses.
     ------------------------------------------------------------------ */
  function exportJson() {
    readForm();
    var payload = { tool: 'biodata-maker', version: 1, data: state };
    var blob = new Blob([JSON.stringify(payload, null, 2)],
      { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'biodata-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* Deferred so the click has consumed the URL before it dies. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setStatus('Downloaded biodata-data.json — keep it as private as the sheet itself');
  }

  function importJson(file, onApplied) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () {
      setStatus('Could not read that file — nothing was changed');
    };
    reader.onload = function () {
      var parsed = null;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        setStatus('That is not a JSON file — nothing was changed');
        return;
      }
      if (!parsed || typeof parsed !== 'object' ||
          parsed.tool !== 'biodata-maker' || parsed.version !== 1 ||
          !parsed.data || typeof parsed.data !== 'object') {
        setStatus('That file is not a biodata-maker export — nothing was changed');
        return;
      }
      /* Blank first, then apply: a field absent from the file must come
         back empty, not keep whatever happened to be on screen. */
      blankState();
      applySaved(parsed.data);
      writeForm();
      render();
      save();
      if (onApplied) onApplied();
      setStatus('Loaded from your file — and saved in this browser');
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------
     Wiring
     ------------------------------------------------------------------ */
  var renderSoon = debounce(function () { readForm(); syncCustomInvocation(); render(); }, 150);
  var saveSoon = debounce(save, 400);

  function init() {
    sheet = $('bm-sheet');
    scaleBox = $('bm-scale-box');
    statusEl = $('bm-status');
    var form = $('bm-form');
    if (!sheet || !form) return;

    var restored = restore();
    writeForm();

    /* Template pills. The language pills share .bm-tpl for the look but
       carry data-lang instead of data-tpl — select on the attribute, not
       the class, or a click on "हिन्दी" would set state.tpl to null and
       silently strip every template style off the sheet. */
    var pills = Array.prototype.slice.call(document.querySelectorAll('.bm-tpl[data-tpl]'));
    function paintPills() {
      pills.forEach(function (pill) {
        pill.setAttribute('aria-pressed',
          pill.getAttribute('data-tpl') === state.tpl ? 'true' : 'false');
      });
    }
    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        state.tpl = pill.getAttribute('data-tpl');
        paintPills();
        render();
        saveSoon();
      });
    });
    paintPills();

    /* Printed-label language pills — same pattern as the template pills.
       Switching re-renders the sheet; the form stays English either way. */
    var langPills = Array.prototype.slice.call(document.querySelectorAll('.bm-lang'));
    function paintLangPills() {
      langPills.forEach(function (pill) {
        pill.setAttribute('aria-pressed',
          pill.getAttribute('data-lang') === state.labelLang ? 'true' : 'false');
      });
    }
    langPills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        state.labelLang = pill.getAttribute('data-lang');
        paintLangPills();
        render();
        saveSoon();
      });
    });
    paintLangPills();

    /* Live update + autosave on anything typed or picked. */
    form.addEventListener('input', function () { renderSoon(); saveSoon(); });
    form.addEventListener('change', function () { renderSoon(); saveSoon(); });

    var fileInput = $('bm-f-photo');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        handlePhoto(fileInput.files && fileInput.files[0]);
      });
    }
    var removeBtn = $('bm-photo-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', function () {
        state.photo = null;
        if (fileInput) fileInput.value = '';
        syncPhotoUi();
        render();
        saveSoon();
      });
    }

    var sampleBtn = $('bm-load-sample');
    if (sampleBtn) sampleBtn.addEventListener('click', loadSample);
    var clearBtn = $('bm-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    var printBtn = $('bm-print');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    /* Export / import — the file input is hidden; "Load data" clicks it. */
    var exportBtn = $('bm-export');
    if (exportBtn) exportBtn.addEventListener('click', exportJson);
    var importBtn = $('bm-import');
    var importInput = $('bm-import-file');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function () {
        importJson(importInput.files && importInput.files[0], function () {
          /* The import may have changed the template and label language;
             the toolbar pills must say so. */
          paintPills();
          paintLangPills();
        });
        /* Same file re-chosen must fire change again. */
        importInput.value = '';
      });
    }

    window.addEventListener('resize', debounce(fitPreview, 120));

    render();
    if (restored) setStatus('Restored your saved draft');

    /* Register the site service worker so the page and its assets can be
       served from the browser's cache on a later, offline visit. Guarded
       and fire-and-forget: if service workers are unavailable (private
       windows, older browsers, an insecure origin) the maker simply works
       online-only, exactly as before. */
    try {
      if ('serviceWorker' in navigator &&
          (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .catch(function () { /* offline support is a bonus, not a promise */ });
      }
    } catch (err) { /* same story */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

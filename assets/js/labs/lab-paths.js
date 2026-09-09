/* ==========================================================================
   lab-paths.js — progress ticks, the exam, and the certificate for the five
   routes on /labs.
   --------------------------------------------------------------------------
   The labs are alphabetical, which is the right order for a reference and the
   wrong one for learning: nothing tells a newcomer that url-inspector should
   come before csp-playground. The paths in the markup fix the ordering. This
   file is the only part that needs to remember anything.

   IT MARKS A STEP WHEN YOU OPEN IT, AND NOTHING ELSE. There is no tracking on
   the lab pages themselves, and deliberately so: instrumenting all 113 of
   them to record a visit would mean every visitor who never touches a path
   still writes a key on every lab they read. Instead the click is caught here
   — you opened this lab FROM a path, so the path may remember it. Someone who
   never expands a path never stores a byte.

   WHICH ALSO MEANS IT UNDERCOUNTS, ON PURPOSE. Open a lab from the grid below
   rather than from the path and it does not tick. That is the honest trade
   for not following people around the site, and the tick is a bookmark for
   your own benefit rather than a score anyone is keeping.

   STORED UNDER lab.path.<name>, one key per path, as a comma-joined list of
   slugs. Not JSON: the values are short slugs with no commas in them, the
   list is read far more often than it is written, and a corrupt JSON parse
   would lose a whole path where a stray comma loses nothing.

   Namespaced lab.* rather than game.*, because game-storage.js owns that
   prefix and its opt-out flag governs scores. This is neither.

   --------------------------------------------------------------------------
   THE THREE STATES OF A PATH, AND WHY THE TICKS ARE NOT THE GATE.

     1. In progress    the bar fills, "n of N done"
     2. All N opened   the exam unlocks
     3. Exam passed    the name is taken once, and the certificate prints

   Opening every lab used to be the whole test, and the certificate said "all
   N labs opened and worked through" on the strength of a click. Clicking a
   link is not reading a lab, so a sheet resting on it was claiming something
   it had not checked. The exam is the check: twelve questions per path drawn
   from the labs' own FAQ entries (see scripts/lab-exams.js), ten to pass.

   The ticks still gate the EXAM rather than the certificate — you cannot sit
   it until you have opened everything — so the bar keeps meaning what it
   meant, and the exam is the last step rather than a way round the labs.

   ONE NAME, ONCE, PER PATH. Passing asks for a name and stores it with the
   date and the score under lab.cert.<name>. After that there is no name field
   and no second exam: the button reprints the sheet that was issued, with the
   same name and the same date, so reloading and typing something else is not
   a thing the page offers. "Reset this path" deliberately does NOT delete
   that record — it clears the ticks, and if it cleared the certificate too it
   would be a two-click way to reissue under a new name.

   WHAT THIS CANNOT DO, stated here so nobody has to infer it. There is no
   backend and no accounts. The record lives in localStorage, so clearing site
   data or opening a private window starts over, and the question bank is a
   file the browser downloads, so the answers are readable by anyone who wants
   them. None of that is fixable client-side. The sheet therefore says on its
   face what it is — a record of self-directed practice — which is the same
   line labs/typing-certificate takes, and the reason the certificates issued
   by hand are the ones /verify can check.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

(function () {
  'use strict';

  var paths = document.querySelectorAll('.lab-path');
  if (!paths.length) return;

  var PREFIX = 'lab.path.';
  var CERT_PREFIX = 'lab.cert.';
  var BANK_URL = '/assets/data/lab-exams.json';

  function read(name) {
    try {
      var raw = localStorage.getItem(PREFIX + name);
      if (!raw) return [];
      return raw.split(',');
    } catch (e) {
      /* Private mode, or storage refused. Everything below still works,
         it just forgets between loads — which is better than a page that
         throws on a browser that declined to store anything. */
      return [];
    }
  }

  function write(name, list) {
    try { localStorage.setItem(PREFIX + name, list.join(',')); } catch (e) { /* ignore */ }
  }

  /* The issued certificate. JSON here, unlike the tick list: this record has
     four fields of mixed type and is written exactly once, so the reasons for
     keeping the other one as a joined string do not apply. A parse failure is
     treated as "not issued" rather than thrown — a corrupt record should cost
     someone a retake, not a page that will not paint. */
  function readCert(name) {
    try {
      var raw = localStorage.getItem(CERT_PREFIX + name);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || typeof rec.name !== 'string' || !rec.name) return null;
      return rec;
    } catch (e) {
      return null;
    }
  }

  function writeCert(name, rec) {
    try { localStorage.setItem(CERT_PREFIX + name, JSON.stringify(rec)); return true; } catch (e) { return false; }
  }

  function slugOf(a) {
    var href = a.getAttribute('href') || '';
    return href.replace(/^\/labs\//, '').replace(/[#?].*$/, '');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* --------------------------------------------------------------------
     The question bank.

     Fetched on the first "Take the exam" and not before: it is 74 KB, and a
     visitor reading the hub should not pay for an exam they are not sitting.
     The promise is cached rather than the parsed body, so two paths opened at
     once share one request instead of racing.
     -------------------------------------------------------------------- */
  var bankPromise = null;

  function loadBank() {
    if (!bankPromise) {
      bankPromise = fetch(BANK_URL, { credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })['catch'](function (err) {
        /* Cleared so a later attempt retries rather than replaying the
           failure for the rest of the visit. */
        bankPromise = null;
        throw err;
      });
    }
    return bankPromise;
  }

  /* Fisher–Yates. Math.random is right for this: the shuffle decides which
     twelve questions somebody sees, not anything anyone could gain from
     predicting, and the answers are in the downloaded file regardless. */
  function shuffle(list) {
    var i, j, t;
    for (i = list.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  /* One paper: `ask` questions, four options each, everything reshuffled.

     Distractors come from labs OTHER than the one the question came from —
     see the note in scripts/lab-exams.js for why that is the fair choice
     rather than the hardest one. Duplicate option TEXT is rejected as well as
     duplicate answers, because two answers can trim to the same 160
     characters and two identical options would make a question unanswerable. */
  function paper(pool, ask) {
    var picked = shuffle(pool.slice()).slice(0, ask);
    var out = [];
    var i;

    for (i = 0; i < picked.length; i++) {
      var q = picked[i];
      var seen = {};
      seen[q.a] = true;
      var options = [{ text: q.a, correct: true }];
      var candidates = shuffle(pool.filter(function (c) { return c.lab !== q.lab; }));
      var c;
      for (c = 0; c < candidates.length && options.length < 4; c++) {
        if (seen[candidates[c].a]) continue;
        seen[candidates[c].a] = true;
        options.push({ text: candidates[c].a, correct: false });
      }
      /* A pool too thin to yield three distinct distractors would otherwise
         ship a two-option question. Skip it instead — lab-exams.js reports
         thin pools at build time, so this is the belt to that braces. */
      if (options.length < 4) continue;
      out.push({ q: q.q, lab: q.lab, title: q.title, options: shuffle(options) });
    }
    return out;
  }

  /* --------------------------------------------------------------------
     The exam UI.

     Built here rather than in the markup because it is twelve questions of
     generated content and there are five paths. Radio groups in a fieldset
     per question, so a screen reader announces the question as the group's
     legend and arrow keys move within one question instead of across all of
     them.
     -------------------------------------------------------------------- */
  function renderExam(box, pathKey, bank) {
    var conf = bank.paths[pathKey];
    var panel = box.querySelector('[data-exam-panel]');
    var ask = bank.ask;
    var need = bank.pass;
    if (!conf || !panel) return;

    var questions = paper(conf.pool, ask);
    if (questions.length < need) {
      panel.textContent = '';
      panel.appendChild(el('p', 'lab-exam-note',
        'This exam is not available yet — the labs on this path do not have enough questions between them.'));
      panel.hidden = false;
      return;
    }

    panel.textContent = '';
    panel.hidden = false;

    var head = el('p', 'lab-exam-head',
      questions.length + ' questions, ' + need + ' to pass. Every attempt draws a different set.');
    panel.appendChild(head);

    var form = el('form', 'lab-exam-form');
    form.setAttribute('novalidate', 'novalidate');

    var i;
    for (i = 0; i < questions.length; i++) {
      var set = el('fieldset', 'lab-exam-q');
      var legend = el('legend', 'lab-exam-qtext', (i + 1) + '. ' + questions[i].q);
      set.appendChild(legend);

      var o;
      for (o = 0; o < questions[i].options.length; o++) {
        var id = 'exq-' + pathKey + '-' + i + '-' + o;
        var label = el('label', 'lab-exam-opt');
        var input = document.createElement('input');
        input.type = 'radio';
        input.name = 'exq-' + pathKey + '-' + i;
        input.id = id;
        input.value = String(o);
        /* The answer is not written into the DOM. Marking the right radio
           with data-correct would put the answer key one inspector click
           away on the page itself; the grader closes over `questions`
           instead. */
        label.appendChild(input);
        label.appendChild(el('span', 'lab-exam-opttext', questions[i].options[o].text));
        set.appendChild(label);
      }
      form.appendChild(set);
    }

    var submit = el('button', 'lab-btn lab-exam-submit', 'Check my answers');
    submit.type = 'submit';
    form.appendChild(submit);

    var result = el('p', 'lab-exam-result');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    form.appendChild(result);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      grade(box, pathKey, bank, questions, form, result);
    });

    panel.appendChild(form);
    /* Focus the first question rather than the top of the panel: the button
       that opened this is directly above, so the panel heading is already on
       screen, and a keyboard user wants to be in the paper. */
    var first = form.querySelector('input[type="radio"]');
    if (first) first.focus();
  }

  function grade(box, pathKey, bank, questions, form, result) {
    var score = 0;
    var missed = {};
    var unanswered = 0;
    var i;

    for (i = 0; i < questions.length; i++) {
      var chosen = form.querySelector('input[name="exq-' + pathKey + '-' + i + '"]:checked');
      if (!chosen) { unanswered++; missed[questions[i].title] = true; continue; }
      if (questions[i].options[Number(chosen.value)].correct) score++;
      else missed[questions[i].title] = true;
    }

    if (unanswered) {
      result.className = 'lab-exam-result is-warn';
      result.textContent = unanswered === 1
        ? 'One question is unanswered.'
        : unanswered + ' questions are unanswered.';
      return;
    }

    if (score >= bank.pass) {
      result.className = 'lab-exam-result is-pass';
      result.textContent = 'Passed — ' + score + ' of ' + questions.length + ' correct.';
      nameForm(box, pathKey, bank, score, questions.length, form);
      return;
    }

    /* WHICH LABS, NOT WHICH ANSWERS. Printing the correct answers would make
       the retry a copying exercise, and the point of a retry is to send you
       back to the lab. Named labs, because "you got 7" tells you nothing
       about where to go. */
    var names = Object.keys(missed).sort();
    result.className = 'lab-exam-result is-fail';
    result.textContent = score + ' of ' + questions.length + ' correct, and ' + bank.pass +
      ' are needed. Worth another look at: ' + names.join(', ') + '.';

    var again = el('button', 'lab-btn lab-exam-again', 'Try a different set');
    again.type = 'button';
    again.addEventListener('click', function () { renderExam(box, pathKey, bank); });
    /* Replaces the paper rather than appending under it, so a fresh attempt
       cannot be answered by scrolling up to the graded one. */
    if (form.parentNode) {
      form.parentNode.appendChild(again);
      var inputs = form.querySelectorAll('input');
      var k;
      for (k = 0; k < inputs.length; k++) inputs[k].disabled = true;
      var sub = form.querySelector('.lab-exam-submit');
      if (sub) sub.disabled = true;
    }
    again.focus();
  }

  /* --------------------------------------------------------------------
     The name, taken once.
     -------------------------------------------------------------------- */
  function nameForm(box, pathKey, bank, score, asked, examForm) {
    var panel = box.querySelector('[data-exam-panel]');
    if (!panel) return;

    var inputs = examForm.querySelectorAll('input');
    var k;
    for (k = 0; k < inputs.length; k++) inputs[k].disabled = true;
    var sub = examForm.querySelector('.lab-exam-submit');
    if (sub) sub.disabled = true;

    var wrap = el('form', 'lab-exam-name');
    wrap.appendChild(el('p', 'lab-exam-note',
      'The name goes on the certificate as typed, and cannot be changed afterwards — ' +
      'this path is issued once.'));

    var id = 'certname-' + pathKey;
    var label = el('label', 'lab-exam-namelabel', 'Name for the certificate');
    label.setAttribute('for', id);

    var input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'lab-exam-nameinput';
    input.setAttribute('autocomplete', 'name');
    input.setAttribute('maxlength', '70');
    input.setAttribute('required', 'required');

    var go = el('button', 'lab-btn lab-exam-issue', 'Issue and print');
    go.type = 'submit';

    var err = el('p', 'lab-exam-nameerr');
    err.setAttribute('role', 'status');
    err.setAttribute('aria-live', 'polite');

    wrap.appendChild(label);
    wrap.appendChild(input);
    wrap.appendChild(go);
    wrap.appendChild(err);

    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      var typed = (input.value || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (!typed) {
        err.textContent = 'A name is needed before the certificate can be issued.';
        input.focus();
        return;
      }
      var rec = {
        name: typed,
        at: new Date().toISOString(),
        score: score,
        asked: asked
      };
      if (!writeCert(pathKey, rec)) {
        /* Storage refused — private mode, most likely. The sheet still
           prints, it just cannot be the once-only record it claims to be, so
           say so rather than pretending it was filed. */
        err.textContent = 'This browser will not store the record, so the certificate cannot be ' +
          'issued once-only. It will still print.';
      }
      panel.hidden = true;
      panel.textContent = '';
      paint(box);
      certificate(box, rec);
    });

    panel.appendChild(wrap);
    input.focus();
  }

  /* --------------------------------------------------------------------
     The certificate.

     Printed, not downloaded. A canvas rendered to a PNG would need a
     download attribute, and the honest artefact for something you finished
     is a sheet of paper rather than a file in a downloads folder — which is
     the same conclusion labs/typing-certificate reached.

     AND IT SAYS ON ITS FACE WHAT IT IS. The exam is real, and it is also
     unproctored, taken in the visitor's own browser, against a question bank
     that browser downloaded. A sheet that implied otherwise would be the one
     dishonest thing on the site, and the typing certificate already set the
     precedent for saying so in the printed copy rather than in a footnote
     somebody can crop off.

     It renders from the stored record, never from the current date or a live
     form, which is what makes a reprint identical to the original.
     -------------------------------------------------------------------- */
  function certificate(box, rec) {
    var name = box.querySelector('.lab-path-name');
    var links = box.querySelectorAll('.lab-steps a[data-step]');
    var sheet = el('div', 'pathcert');

    sheet.appendChild(el('p', 'pathcert-kicker', 'krunalkumar.dpdns.org / labs'));
    sheet.appendChild(el('h2', 'pathcert-title', name ? name.textContent : 'Lab path'));

    sheet.appendChild(el('p', 'pathcert-lede', 'Awarded to'));
    sheet.appendChild(el('p', 'pathcert-name', rec.name));

    sheet.appendChild(el('p', 'pathcert-sub',
      'for opening all ' + links.length + ' labs on this path and answering ' +
      rec.score + ' of ' + rec.asked + ' exam questions correctly'));

    var ul = el('ol', 'pathcert-list');
    var i;
    for (i = 0; i < links.length; i++) ul.appendChild(el('li', null, links[i].textContent));
    sheet.appendChild(ul);

    /* Locale-formatted rather than ISO: this is the one string on the site a
       person prints and puts on a desk. Read from the record so a reprint
       carries the date it was issued, not the date it was reprinted. */
    var when = new Date(rec.at);
    sheet.appendChild(el('p', 'pathcert-date', when.toLocaleDateString(undefined,
      { year: 'numeric', month: 'long', day: 'numeric' })));

    sheet.appendChild(el('p', 'pathcert-honest',
      'This is a record of self-directed practice, not an issued credential. The exam was taken in ' +
      'this browser, unproctored, against a question bank the browser downloaded, and no account was ' +
      'checked. It says what you read and answered, which is worth something, and nothing more.'));

    document.body.appendChild(sheet);
    document.body.classList.add('is-printing-cert');

    function done() {
      document.body.classList.remove('is-printing-cert');
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      window.removeEventListener('afterprint', done);
    }
    window.addEventListener('afterprint', done);
    /* Safari has historically not fired afterprint. The timeout is the
       backstop so the page is never left with a stray sheet in the DOM. */
    window.setTimeout(done, 20000);

    window.print();
  }

  function paint(box) {
    var name = box.getAttribute('data-path');
    var done = read(name);
    var links = box.querySelectorAll('.lab-steps a[data-step]');
    var hit = 0;
    var i;

    for (i = 0; i < links.length; i++) {
      var li = links[i].parentNode;
      var isDone = done.indexOf(slugOf(links[i])) !== -1;
      if (isDone) hit++;
      li.className = isDone ? 'is-done' : '';
    }

    var count = box.querySelector('[data-count]');
    if (count) {
      count.textContent = hit
        ? hit + ' of ' + links.length + ' done'
        : links.length + ' steps';
    }

    var fill = box.querySelector('[data-fill]');
    if (fill) fill.style.width = Math.round((hit / links.length) * 100) + '%';

    /* The reset is pointless on an untouched path and its presence invites
       the question of what there is to reset. */
    var reset = box.querySelector('[data-reset]');
    if (reset) reset.hidden = hit === 0;

    var rec = readCert(name);
    var complete = hit === links.length;

    var issued = box.querySelector('[data-issued]');
    if (issued) {
      if (rec) {
        issued.textContent = 'Issued to ' + rec.name + ' on ' +
          new Date(rec.at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) +
          ' — ' + rec.score + ' of ' + rec.asked + ' correct.';
      }
      issued.hidden = !rec;
    }

    /* Three states, one place. The exam offer disappears the moment a
       certificate exists, which is what stops a second sitting under a
       different name. */
    var exam = box.querySelector('[data-exam]');
    if (exam) exam.hidden = !!rec || !complete;

    var cert = box.querySelector('[data-cert]');
    if (cert) cert.hidden = !rec;
  }

  function mark(box, slug) {
    var name = box.getAttribute('data-path');
    var done = read(name);
    if (done.indexOf(slug) !== -1) return;
    done.push(slug);
    write(name, done);
    paint(box);
  }

  for (var p = 0; p < paths.length; p++) {
    (function (box) {
      paint(box);

      box.addEventListener('click', function (e) {
        var t = e.target;
        var pathKey = box.getAttribute('data-path');

        if (t && t.hasAttribute && t.hasAttribute('data-exam')) {
          var rec = readCert(pathKey);
          /* Belt to paint()'s braces: the button is hidden once a
             certificate exists, but a hidden button is a UI fact and this is
             the rule. */
          if (rec) return;
          var panel = box.querySelector('[data-exam-panel]');
          if (panel) {
            panel.hidden = false;
            panel.textContent = '';
            panel.appendChild(el('p', 'lab-exam-note', 'Loading the questions…'));
          }
          loadBank().then(function (bank) {
            renderExam(box, pathKey, bank);
          })['catch'](function () {
            if (panel) {
              panel.textContent = '';
              panel.appendChild(el('p', 'lab-exam-note',
                'The questions could not be loaded. If you are offline, this needs a connection once.'));
            }
          });
          return;
        }

        if (t && t.hasAttribute && t.hasAttribute('data-cert')) {
          var issuedRec = readCert(pathKey);
          /* No record, no sheet. Before the exam existed this printed on the
             strength of the attribute alone, which is how a certificate for
             an untouched path became printable when a CSS `display` beat the
             hidden attribute. */
          if (!issuedRec) { paint(box); return; }
          certificate(box, issuedRec);
          return;
        }

        if (t && t.hasAttribute && t.hasAttribute('data-reset')) {
          /* Ticks only. The certificate record survives on purpose — see the
             header. */
          try { localStorage.removeItem(PREFIX + pathKey); } catch (err) { /* ignore */ }
          var open = box.querySelector('[data-exam-panel]');
          if (open) { open.hidden = true; open.textContent = ''; }
          paint(box);
          return;
        }

        /* The click may land on the link or on something inside it, so walk
           up to the anchor rather than assuming the target is one. */
        var a = t && t.closest ? t.closest('.lab-steps a[data-step]') : null;
        if (!a) return;
        /* Marked before navigation rather than after. The page is about to
           unload, so there is no "after" to run in — and a write to
           localStorage is synchronous, so it lands. */
        mark(box, slugOf(a));
      });
    })(paths[p]);
  }
})();

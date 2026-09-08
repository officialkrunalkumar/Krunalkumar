/* ==========================================================================
   recall.js — spaced repetition over the glossary and the FAQ answers.
   Registers with GameShell.define as the `recall` board game.
   --------------------------------------------------------------------------
   NO NEW CONTENT AND NO NEW DATA FILE. Every card below is something already
   written by hand somewhere on this site and already collected into
   assets/data/mayuri-index.json by scripts/mayuri-index.js for the corner
   chat. This page fetches that same file, from the same origin, which the
   service worker has very likely already cached because Mayuri asked for it
   first. One artefact, two features, no second build step to drift.

   WHY LEITNER AND NOT SM-2. SM-2 keeps an ease factor, an interval and a
   repetition count per card, tunes the ease by fractions on every answer, and
   is genuinely better for language pairs reviewed for years. This corpus is
   179 definitions and 1,271 answers on a consultancy's site; nobody is
   running a decade-long deck here. Leitner keeps one small integer per card,
   is explicable to a visitor in one sentence — "get it right and it comes
   back later, get it wrong and it comes back tomorrow" — and cannot drift
   into the pathological scheduling that a mistuned ease factor produces.

   THE CARD KEY IS A HASH OF THE TEXT, NOT ITS INDEX. This is the one thing in
   the file that would silently corrupt data if it were done the easy way.
   mayuri-index.json is regenerated on every build by walking pages in
   directory order, so a card's position in the array is not stable across
   builds: add one FAQ to one page and everything after it shifts. Schedule
   keyed on index would then quietly hand your progress on "What is a salt"
   to whatever question moved into slot 402. Hashing the prompt means a card
   keeps its schedule as long as its wording does, and an edited question
   correctly reads as a new card rather than as an old one you had learned.

   BOTH DECKS, BECAUSE THEY ARE DIFFERENT THINGS. The 179 glossary terms are
   the curated core: each carries a category, cross-references, and often the
   lab that demonstrates it, so the answer side can route somewhere. The 1,271
   FAQ pairs are the long tail, already in question form, and are the better
   test of whether you actually know the site. Neither is a subset of the
   other and mixing them into one deck made both worse.

   PROGRESS IS LOCAL AND SAID TO BE LOCAL. localStorage under game.recall.*,
   like every other best on this site. There is no server, so there is no
   sync, so nothing here is ever labelled one — and the shell's own data strip
   already lets a visitor read the keys back and clear them.

   ES5 house rules: no const, no let, no arrow functions. Nothing is built
   from a string; the CSP has no unsafe-eval.
   ========================================================================== */

(function () {
  'use strict';

  var INDEX_URL = '/assets/data/mayuri-index.json';

  /* Days until a card in each box comes back. Box 0 is "new, or just got
     wrong", and is due the moment you see it. The rest roughly triple,
     which is the classic Leitner shape and lands a card you keep getting
     right three weeks out after four correct answers. */
  var INTERVALS = [0, 1, 3, 7, 21];
  var TOP_BOX = INTERVALS.length - 1;

  /* How many cards one sitting offers before it says you are done. A review
     queue with no end is a queue nobody finishes; a session that ends is one
     people come back to. */
  var SESSION = 20;

  function dayNow() {
    return Math.floor(Date.now() / 86400000);
  }

  /* FNV-1a, 32-bit, rendered base 36. Short enough to keep the schedule
     object small, and collisions across 1,450 short strings are not a
     practical concern — the cost of one would be two cards sharing a
     due date, not data loss. */
  function keyOf(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  GameShell.define({
    id: 'game-recall',
    slug: 'recall',
    title: 'Recall',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,
    startTitle: 'Recall',
    startText: 'Definitions and answers from this site, scheduled so the ones you keep missing come back sooner. Everything you have learned stays in this browser.',

    setup: function (g) {

      var board = g.board;
      var cards = [];        /* the whole deck currently selected */
      var queue = [];        /* what this session will ask */
      var at = 0;
      var shown = false;     /* is the answer side visible */
      var done = 0;
      var loaded = false;

      /* key -> { b: box, d: day it next falls due }

         Serialised by hand because game-storage.js writes String(value) and
         reads the string back: it is built for a number or a flag, which is
         what a best score is, and handing it an object stores the literal
         "[object Object]". The parse is guarded because the value on disk is
         whatever was last written there, including by an older version of
         this file — a corrupt schedule should cost you your review history,
         not the page. */
      var sched = {};
      try {
        var stored = g.load('sched', '');
        if (stored) sched = JSON.parse(stored) || {};
      } catch (e) {
        sched = {};
      }

      function persist() {
        try { g.save('sched', JSON.stringify(sched)); } catch (e) { /* quota or private mode */ }
      }

      var deckSel = document.getElementById('game-deck');
      var catSel = document.getElementById('game-cat');
      var exportBtn = document.getElementById('game-export');

      var raw = { terms: [], faq: [] };

      /* --------------------------------------------------------------
         Building a deck
         -------------------------------------------------------------- */

      function termCard(t) {
        return {
          key: keyOf('t:' + t.t),
          prompt: t.t,
          answer: t.d,
          cat: t.c || '',
          see: t.see || [],
          lab: t.lab || '',
          post: t.post || '',
          url: ''
        };
      }

      function faqCard(f) {
        return {
          key: keyOf('f:' + f.q),
          prompt: f.q,
          answer: f.a,
          cat: '',
          see: [],
          lab: '',
          post: '',
          url: f.u || ''
        };
      }

      function build() {
        var which = deckSel ? deckSel.value : 'terms';
        var cat = catSel ? catSel.value : 'all';
        var out = [];
        var i;

        if (which === 'faq') {
          for (i = 0; i < raw.faq.length; i++) out.push(faqCard(raw.faq[i]));
        } else {
          for (i = 0; i < raw.terms.length; i++) {
            if (cat !== 'all' && raw.terms[i].c !== cat) continue;
            out.push(termCard(raw.terms[i]));
          }
        }
        cards = out;

        /* The category filter is meaningless on the FAQ deck, which carries
           no categories. Disabling it beats offering a control that
           silently does nothing. */
        if (catSel) catSel.disabled = (which === 'faq');
      }

      function due(card) {
        var s = sched[card.key];
        if (!s) return true;                 /* never seen is always due */
        return s.d <= dayNow();
      }

      /* The session queue: everything due, oldest-due first, then new cards,
         capped. Sorting by due date rather than shuffling means the card you
         have been failing for three days is the one you get, which is the
         entire point of the exercise. */
      function fill() {
        var pool = [];
        for (var i = 0; i < cards.length; i++) if (due(cards[i])) pool.push(cards[i]);
        pool.sort(function (a, b) {
          var sa = sched[a.key], sb = sched[b.key];
          var da = sa ? sa.d : -1e9;
          var db = sb ? sb.d : -1e9;
          return da - db;
        });
        queue = pool.slice(0, SESSION);
        at = 0;
        shown = false;
        done = 0;
      }

      function counts() {
        var boxes = [0, 0, 0, 0, 0];
        var dueNow = 0;
        for (var i = 0; i < cards.length; i++) {
          var s = sched[cards[i].key];
          boxes[s ? s.b : 0]++;
          if (due(cards[i])) dueNow++;
        }
        return { boxes: boxes, due: dueNow };
      }

      function stats() {
        var c = counts();
        g.stat('due', c.due);
        g.stat('deck', cards.length);
        /* "Learned" is everything past the first two boxes — a card you have
           got right at least twice and will not see again for a week. */
        g.stat('learned', c.boxes[3] + c.boxes[4]);
      }

      /* --------------------------------------------------------------
         Grading
         -------------------------------------------------------------- */

      function grade(step) {
        var card = queue[at];
        if (!card) return;
        var s = sched[card.key] || { b: 0, d: 0 };
        var box = s.b;

        if (step === 0) box = 0;                              /* again  */
        else if (step === 1) box = box > 0 ? box - 1 : 0;     /* hard   */
        else if (step === 2) box = box < TOP_BOX ? box + 1 : TOP_BOX;
        else box = Math.min(TOP_BOX, box + 2);                /* easy   */

        sched[card.key] = { b: box, d: dayNow() + INTERVALS[box] };
        persist();

        g.beep(step === 0 ? 240 : 520 + box * 60, 0.05);

        done++;
        at++;
        shown = false;
        stats();
        render();
      }

      /* --------------------------------------------------------------
         Rendering. The board is rebuilt rather than mutated: it is at most
         a dozen nodes, it happens on a keypress and not in a loop, and a
         rebuild cannot leave a stale button from the previous card wired
         to the previous card's handler.
         -------------------------------------------------------------- */

      function render() {
        board.className = 'game-board board-quiz';
        board.innerHTML = '';

        if (!loaded) {
          board.appendChild(el('p', 'quiz-question', 'Fetching the glossary…'));
          return;
        }

        if (mode === 'exam') { renderExam(board); return; }

        if (!queue.length) {
          var c = counts();
          var head = el('div', 'quiz-result');
          head.appendChild(el('div', 'quiz-result-title',
            c.due ? 'Session done' : 'Nothing due'));
          head.appendChild(el('p', 'quiz-result-body',
            c.due
              ? 'You reviewed ' + done + '. There are ' + c.due + ' still due — start another round when you want them.'
              : 'Every card in this deck is scheduled for a later day. Change deck above, or come back tomorrow.'));
          head.appendChild(boxBars(c.boxes));
          var again = el('button', 'game-btn', c.due ? 'Another round' : 'Review anyway');
          again.type = 'button';
          again.addEventListener('click', function () {
            if (!c.due) {
              /* "Review anyway" ignores the schedule without altering it —
                 looking at a card early should not push its next date out. */
              queue = cards.slice(0, SESSION);
              at = 0; done = 0; shown = false;
            } else {
              fill();
            }
            render();
          });
          var nav = el('div', 'quiz-nav');
          nav.appendChild(again);
          head.appendChild(nav);
          board.appendChild(head);
          return;
        }

        if (at >= queue.length) { fill(); render(); return; }

        var card = queue[at];
        var s = sched[card.key];

        var prog = el('div', 'quiz-progress');
        var bar = el('div', 'quiz-progress-bar');
        bar.style.width = Math.round((done / queue.length) * 100) + '%';
        prog.appendChild(bar);
        board.appendChild(prog);

        board.appendChild(el('p', 'quiz-count',
          'Card ' + (at + 1) + ' of ' + queue.length +
          ' · box ' + ((s ? s.b : 0) + 1) + ' of 5' +
          (card.cat ? ' · ' + card.cat : '')));

        board.appendChild(el('p', 'quiz-question', card.prompt));

        if (!shown) {
          var reveal = el('button', 'game-btn', 'Show answer');
          reveal.type = 'button';
          reveal.addEventListener('click', function () { shown = true; render(); });
          var nav1 = el('div', 'quiz-nav');
          nav1.appendChild(reveal);
          board.appendChild(nav1);
          reveal.focus();
          return;
        }

        board.appendChild(el('p', 'quiz-result-body', card.answer));

        var links = el('p', 'quiz-disclaimer');
        var any = false;
        if (card.lab) { links.appendChild(link('Try it: /labs/' + card.lab, '/labs/' + card.lab)); any = true; }
        if (card.post) { if (any) links.appendChild(document.createTextNode(' · ')); links.appendChild(link('Read: ' + card.post, '/blog/' + card.post)); any = true; }
        if (card.url) { links.appendChild(link('Source', card.url)); any = true; }
        if (card.see && card.see.length) {
          if (any) links.appendChild(document.createTextNode(' · '));
          links.appendChild(document.createTextNode('See also: ' + card.see.join(', ')));
          any = true;
        }
        if (any) board.appendChild(links);

        var opts = el('div', 'quiz-options');
        var labels = ['Again', 'Hard', 'Good', 'Easy'];
        for (var i = 0; i < labels.length; i++) {
          (function (n) {
            var b = el('button', 'quiz-option', labels[n]);
            b.type = 'button';
            b.addEventListener('click', function () { grade(n); });
            opts.appendChild(b);
          })(i);
        }
        board.appendChild(opts);
        opts.firstChild.focus();
      }

      function link(text, href) {
        var a = el('a', null, text);
        a.href = href;
        return a;
      }

      function boxBars(boxes) {
        var wrap = el('div', 'quiz-bars');
        var max = 1;
        for (var i = 0; i < boxes.length; i++) if (boxes[i] > max) max = boxes[i];
        for (i = 0; i < boxes.length; i++) {
          var row = el('div', 'quiz-bar-row');
          row.appendChild(el('span', 'quiz-bar-label', 'Box ' + (i + 1)));
          var track = el('div', 'quiz-bar-track');
          var fill2 = el('div', 'quiz-bar-fill');
          fill2.style.width = Math.round((boxes[i] / max) * 100) + '%';
          track.appendChild(fill2);
          row.appendChild(track);
          row.appendChild(el('span', 'quiz-bar-value', String(boxes[i])));
          wrap.appendChild(row);
        }
        return wrap;
      }

      /* --------------------------------------------------------------
         Controls and data
         -------------------------------------------------------------- */

      /* ==================================================================
         Exam mode

         WHY IT IS MULTIPLE CHOICE AND STUDY MODE IS NOT. Study mode asks you
         to grade yourself, which is right for revision — the honest answer
         to "did you know that" is one only you have — and useless as a test,
         because nobody screening a candidate wants a score the candidate
         chose. So an exam runs the other way round: it shows the definition
         and asks which term it defines, with three wrong answers drawn from
         the same category so they are plausible rather than absurd.

         TERMS ONLY. The FAQ deck's answers run to a paragraph, and four
         paragraphs as options is a reading test rather than a recall test.
         The control disables itself on that deck instead of degrading.

         AN EXAM DOES NOT TOUCH YOUR SCHEDULE. Getting one wrong under time
         pressure is not the same signal as failing it in revision, and
         letting the exam reshuffle the Leitner boxes would corrupt weeks of
         study with one bad five minutes.
         ================================================================== */

      var mode = 'study';
      var exam = null;

      function buildExam() {
        var pool = cards.slice();
        g.shuffle(pool);
        var picked = pool.slice(0, Math.min(SESSION, pool.length));
        var qs = [];

        for (var i = 0; i < picked.length; i++) {
          var card = picked[i];

          /* Distractors from the same category where there are enough of
             them, otherwise from the whole deck. A four-option question with
             two options repeated is worse than one with a distractor from
             another field. */
          var sameCat = [];
          for (var j = 0; j < cards.length; j++) {
            if (cards[j] !== card && cards[j].cat === card.cat) sameCat.push(cards[j]);
          }
          var from = sameCat.length >= 3 ? sameCat : cards;
          var bag = [];
          for (var k = 0; k < from.length; k++) if (from[k] !== card) bag.push(from[k]);
          g.shuffle(bag);

          var options = [card.prompt];
          for (var m = 0; m < bag.length && options.length < 4; m++) {
            if (options.indexOf(bag[m].prompt) === -1) options.push(bag[m].prompt);
          }
          g.shuffle(options);

          qs.push({ card: card, options: options, chosen: null });
        }

        exam = { qs: qs, at: 0, score: 0, started: Date.now(), ended: 0 };
      }

      function answerExam(pick) {
        var q = exam.qs[exam.at];
        if (!q || q.chosen !== null) return;
        q.chosen = pick;
        if (pick === q.card.prompt) { exam.score++; g.beep(660, 0.05); }
        else g.beep(200, 0.07);
        exam.at++;
        if (exam.at >= exam.qs.length) exam.ended = Date.now();
        render();
      }

      function renderExam(c) {
        if (!exam) buildExam();

        if (exam.ended) {
          var secs = Math.round((exam.ended - exam.started) / 1000);
          var pct = Math.round((exam.score / exam.qs.length) * 100);
          var res = el('div', 'quiz-result');
          res.appendChild(el('div', 'quiz-result-title',
            exam.score + ' of ' + exam.qs.length + ' — ' + pct + '%'));
          res.appendChild(el('p', 'quiz-result-body',
            'Finished in ' + (secs < 60 ? secs + ' seconds' : Math.floor(secs / 60) + 'm ' + (secs % 60) + 's') +
            '. Nothing about this was recorded and your revision schedule is untouched.'));

          var wrong = [];
          for (var i = 0; i < exam.qs.length; i++) {
            if (exam.qs[i].chosen !== exam.qs[i].card.prompt) wrong.push(exam.qs[i].card.prompt);
          }
          if (wrong.length) {
            res.appendChild(el('p', 'quiz-disclaimer', 'Missed: ' + wrong.join(', ')));
          }

          var again = el('button', 'game-btn', 'Sit another');
          again.type = 'button';
          again.addEventListener('click', function () { buildExam(); render(); });
          var nav = el('div', 'quiz-nav');
          nav.appendChild(again);
          res.appendChild(nav);
          board.appendChild(res);
          return;
        }

        var q = exam.qs[exam.at];
        var prog = el('div', 'quiz-progress');
        var bar = el('div', 'quiz-progress-bar');
        bar.style.width = Math.round((exam.at / exam.qs.length) * 100) + '%';
        prog.appendChild(bar);
        board.appendChild(prog);

        board.appendChild(el('p', 'quiz-count',
          'Question ' + (exam.at + 1) + ' of ' + exam.qs.length + ' · ' + exam.score + ' right so far'));
        board.appendChild(el('p', 'quiz-result-body', q.card.answer));
        board.appendChild(el('p', 'quiz-question', 'Which term is this?'));

        var opts = el('div', 'quiz-options');
        for (var o = 0; o < q.options.length; o++) {
          (function (label) {
            var b = el('button', 'quiz-option', label);
            b.type = 'button';
            b.addEventListener('click', function () { answerExam(label); });
            opts.appendChild(b);
          })(q.options[o]);
        }
        board.appendChild(opts);
        if (opts.firstChild) opts.firstChild.focus();
      }

      function reload() {
        build();
        if (mode === 'exam') buildExam(); else fill();
        stats();
        render();
      }

      /* deckSel is bound further down by syncMode, which decides whether the
         exam control is still valid before reloading. Binding reload here as
         well would run the whole rebuild twice on every deck change. */
      if (catSel) catSel.addEventListener('change', reload);

      /* ------------------------------------------------------------------
         Export to Anki.

         TAB-SEPARATED TEXT, NOT .apkg. An Anki package is a zip containing a
         SQLite database, and building one in the browser means shipping a
         zip writer and a SQLite writer to a site with no dependencies — for
         a format Anki's own importer does not require. It reads plain text
         with one field per tab natively, which is three lines of code here
         and one dialog there.

         Fields are scrubbed rather than escaped. A tab would start a third
         field and a newline would start a second card, so both become
         spaces; nothing else is touched, because the importer treats a
         field as HTML and these definitions contain none.

         It exports the deck currently on screen, filter included. Exporting
         all 1,450 regardless would ignore the two controls sitting directly
         above the button, which is the sort of thing that makes people
         check whether it worked.
         ------------------------------------------------------------------ */
      function scrub(s) {
        return String(s).replace(/[\t\r\n]+/g, ' ').trim();
      }

      function exportDeck() {
        if (!cards.length) return;
        var lines = [];
        for (var i = 0; i < cards.length; i++) {
          lines.push(scrub(cards[i].prompt) + '\t' + scrub(cards[i].answer));
        }

        var which = deckSel ? deckSel.value : 'terms';
        var cat = catSel && !catSel.disabled ? catSel.value : 'all';
        var name = 'recall-' + which + (cat !== 'all' ? '-' + cat : '') + '.txt';

        /* A BOM, because Anki on Windows still guesses the encoding of a
           text file without one and gets it wrong on the first accented
           character. */
        var blob = new Blob(['﻿' + lines.join('\n') + '\n'],
          { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        /* Revoked on a timer rather than immediately: Safari has cancelled
           the download of a URL revoked in the same tick. */
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);

        g.announce(lines.length + ' cards exported as ' + name);
        g.pluck(700, 0.14);
      }

      if (exportBtn) exportBtn.addEventListener('click', exportDeck);

      var modeSel = document.getElementById('game-mode');
      function syncMode() {
        var wantExam = modeSel && modeSel.value === 'exam';
        var faq = deckSel && deckSel.value === 'faq';
        mode = (wantExam && !faq) ? 'exam' : 'study';
        /* Said out loud rather than silently ignored: a control that reads
           "exam" while the page runs study mode is a bug the visitor has to
           discover. */
        if (modeSel) modeSel.disabled = faq;
        if (wantExam && faq) g.announce('Exam mode needs the glossary deck — the FAQ answers are too long to use as options.');
        reload();
      }
      if (modeSel) modeSel.addEventListener('change', syncMode);
      if (deckSel) deckSel.addEventListener('change', syncMode);

      fetch(INDEX_URL)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          raw.terms = data.terms || [];
          raw.faq = data.faq || [];
          loaded = true;
          reload();
        })
        .catch(function () {
          loaded = true;
          board.innerHTML = '';
          board.appendChild(el('p', 'quiz-question', 'The glossary could not be loaded.'));
          board.appendChild(el('p', 'quiz-result-body',
            'This page needs /assets/data/mayuri-index.json, which is the same file the corner assistant uses. If you are offline and have not opened the assistant on this device yet, it will not be cached.'));
        });

      return {
        reset: function () {
          if (loaded) { fill(); stats(); }
          render();
        },
        key: function (name) {
          if (name !== 'action') return;
          if (!shown && queue.length && at < queue.length) { shown = true; render(); }
        }
      };
    }
  });
})();

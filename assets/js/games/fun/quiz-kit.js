/* ==========================================================================
   quiz-kit.js — the shared machinery behind the multiple-choice games.
   --------------------------------------------------------------------------
   Five games on this site are the same object with different questions: ask
   a series of things, add up weighted answers, show a result with bars. The
   personality test, the career quiz, the developer quiz, the cyber-hygiene
   check and "which attack are you". Writing that five times would produce
   five subtly different keyboard behaviours and five different bugs.

   WHAT IT IS NOT: a scoring model. Each game supplies its own scale
   definitions and its own result text, because that is the part with any
   content in it. This file owns the questions, the progress, the keyboard,
   the back button and the bars.

   ACCESSIBILITY. Each question is a real radiogroup of real <button>s, one
   tab stop per option, arrow keys move between them, and the live region
   announces the question number. A quiz built from clickable <div>s is
   unusable with a screen reader and there is no reason to build one.
   ========================================================================== */

(function (root) {
  'use strict';

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* spec:
       questions: [{ q, options: [{ label, scores: { key: n } }] }]
       scales:    [{ key, name, low, high }]          for bar output
       result:    function(totals, answers) -> { title, body, bars? }
       intro:     optional string shown above the first question
       disclaimer optional string pinned under the result
  */
  function Quiz(g, host, spec) {
    this.g = g;
    this.host = host;
    this.spec = spec;
    this.index = 0;
    this.answers = [];
    /* A Quiz's first render is the page arriving, not the player doing
       anything — see the note where render() focuses an option. */
    this._firstRender = true;
    this.build();
  }

  Quiz.prototype.build = function () {
    this.host.innerHTML = '';
    this.host.className = 'game-board board-quiz';

    this.progress = el('div', 'quiz-progress');
    this.bar = el('span', 'quiz-progress-bar');
    this.progress.appendChild(this.bar);
    this.host.appendChild(this.progress);

    this.count = el('p', 'quiz-count');
    this.count.setAttribute('role', 'status');
    this.count.setAttribute('aria-live', 'polite');
    this.host.appendChild(this.count);

    this.question = el('h3', 'quiz-question');
    this.host.appendChild(this.question);

    this.options = el('div', 'quiz-options');
    this.options.setAttribute('role', 'radiogroup');
    this.host.appendChild(this.options);

    this.nav = el('div', 'quiz-nav');
    this.backBtn = el('button', 'game-btn', 'Back');
    this.backBtn.type = 'button';
    var self = this;
    this.backBtn.addEventListener('click', function () { self.back(); });
    this.nav.appendChild(this.backBtn);
    this.host.appendChild(this.nav);

    this.output = el('div', 'quiz-result');
    /* The result must be ANNOUNCED, not just shown: finish() hides the
       container holding the focused option, and without a live region the
       ending happens in silence for a screen reader. Declared here, while
       the node is still empty, because a live region only announces what
       CHANGES after it becomes one — made live at finish time, the result
       already inside it would say nothing. */
    this.output.setAttribute('role', 'status');
    this.output.setAttribute('aria-live', 'polite');
    this.output.hidden = true;
    this.host.appendChild(this.output);
  };

  Quiz.prototype.render = function () {
    var spec = this.spec;
    var total = spec.questions.length;

    if (this.index >= total) { this.finish(); return; }

    this.output.hidden = true;
    this.question.hidden = false;
    this.options.hidden = false;
    this.nav.hidden = false;
    this.progress.hidden = false;
    this.count.hidden = false;

    var q = spec.questions[this.index];
    this.bar.style.width = Math.round((this.index / total) * 100) + '%';
    this.count.textContent = 'Question ' + (this.index + 1) + ' of ' + total;
    this.question.textContent = q.q;
    this.backBtn.disabled = this.index === 0;

    this.options.innerHTML = '';
    var self = this;
    for (var i = 0; i < q.options.length; i++) {
      (function (opt, idx) {
        var b = el('button', 'quiz-option', opt.label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(self.answers[self.index] === idx));
        if (self.answers[self.index] === idx) b.classList.add('is-picked');
        b.addEventListener('click', function () { self.choose(idx); });
        b.addEventListener('keydown', function (event) {
          /* Arrows move within the group, which is what a radiogroup is
             supposed to do and what a list of buttons does not do for free. */
          var kids = self.options.querySelectorAll('.quiz-option');
          var pos = Array.prototype.indexOf.call(kids, b);
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            event.preventDefault();
            kids[(pos + 1) % kids.length].focus();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            event.preventDefault();
            kids[(pos - 1 + kids.length) % kids.length].focus();
          }
        });
        self.options.appendChild(b);
      })(q.options[i], i);
    }

    /* Focus follows the question — answering moves the keyboard onto the
       next question's options without a Tab in between. EXCEPT on the very
       first render, which is the page loading and nobody asking: the five
       autoStart quizzes were stealing focus from the address bar or the
       heading a screen reader had just started, the same load-time theft
       the shell's noFocus overlay refuses. Skipping only the first render
       loses nothing for a player-initiated restart, because the shell's
       takeFocus() lands on this radiogroup right after reset() rebuilds it. */
    var first = this.options.querySelector('.is-picked') || this.options.querySelector('.quiz-option');
    if (first && !this._firstRender) { try { first.focus({ preventScroll: true }); } catch (e) {} }
    this._firstRender = false;

    if (this.g) this.g.stat('question', (this.index + 1) + '/' + total);
  };

  Quiz.prototype.choose = function (idx) {
    this.answers[this.index] = idx;
    if (this.g) this.g.beep(520 + idx * 40, 0.04, 'sine', 0.04);
    this.index++;
    this.render();
  };

  Quiz.prototype.back = function () {
    if (this.index === 0) return;
    this.index--;
    this.render();
  };

  Quiz.prototype.totals = function () {
    var out = {};
    for (var i = 0; i < this.spec.questions.length; i++) {
      var pick = this.answers[i];
      if (pick == null) continue;
      var scores = this.spec.questions[i].options[pick].scores || {};
      for (var k in scores) {
        if (Object.prototype.hasOwnProperty.call(scores, k)) out[k] = (out[k] || 0) + scores[k];
      }
    }
    return out;
  };

  Quiz.prototype.finish = function () {
    var totals = this.totals();
    var res = this.spec.result(totals, this.answers);

    this.question.hidden = true;
    this.options.hidden = true;
    this.nav.hidden = true;
    this.progress.hidden = true;
    this.count.hidden = true;

    this.output.innerHTML = '';
    this.output.hidden = false;

    var h = el('h3', 'quiz-result-title', res.title);
    this.output.appendChild(h);

    if (res.body) {
      var p = el('p', 'quiz-result-body');
      p.innerHTML = res.body;
      this.output.appendChild(p);
    }

    if (res.bars && res.bars.length) {
      var wrap = el('div', 'quiz-bars');
      for (var i = 0; i < res.bars.length; i++) {
        var b = res.bars[i];
        var row = el('div', 'quiz-bar-row');
        var label = el('span', 'quiz-bar-label', b.name);
        var track = el('span', 'quiz-bar-track');
        var fill = el('span', 'quiz-bar-fill');
        fill.style.width = Math.max(2, Math.min(100, b.pct)) + '%';
        track.appendChild(fill);
        var val = el('span', 'quiz-bar-value', Math.round(b.pct) + '%');
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(val);
        if (b.note) {
          var note = el('span', 'quiz-bar-note', b.note);
          row.appendChild(note);
        }
        wrap.appendChild(row);
      }
      this.output.appendChild(wrap);
    }

    if (this.spec.disclaimer) {
      var d = el('p', 'quiz-disclaimer');
      d.innerHTML = this.spec.disclaimer;
      this.output.appendChild(d);
    }

    var again = el('button', 'btn btn-primary quiz-again', 'Start again');
    again.type = 'button';
    var self = this;
    again.addEventListener('click', function () { self.restart(); });
    this.output.appendChild(again);

    /* The option that held focus has just been hidden, which drops focus
       to <body>: the keyboard is nowhere and a screen reader says nothing
       about where it went. Land it on the result title instead. tabindex
       "-1" makes the heading focusable by script without adding a tab stop
       for anyone else, and preventScroll keeps the page where it is. */
    h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }

    if (this.g) {
      this.g.beep(880, 0.12, 'sine');
      this.g.stat('question', 'done');
    }
  };

  Quiz.prototype.restart = function () {
    this.index = 0;
    this.answers = [];
    this.render();
  };

  root.QuizKit = {
    /* Wires a quiz into a GameShell board and returns the shell hooks. */
    mount: function (g, spec) {
      var quiz = null;
      return {
        reset: function () {
          quiz = new Quiz(g, g.board, spec);
          quiz.render();
        }
      };
    },
    Quiz: Quiz
  };
})(typeof self !== 'undefined' ? self : this);

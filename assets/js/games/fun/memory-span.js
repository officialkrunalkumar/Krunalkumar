/* ==========================================================================
   memory-span.js — how long a sequence can you hold?
   --------------------------------------------------------------------------
   The digit-span task, which is a real component of real cognitive
   assessments and takes about ninety seconds. A sequence is shown one digit
   at a time; you type it back; it gets one longer each time you succeed.

   TWO ATTEMPTS PER LENGTH, which is how the actual instrument works. A
   single slip at length eight should not end a run that would otherwise
   have reached ten, because what is being measured is capacity, not luck.

   Digits are shown ONE AT A TIME rather than all at once, so the task is
   memory rather than reading speed. The interval is fixed at 900 ms for the
   same reason: a faster reader must not score higher.
   ========================================================================== */

(function () {
  'use strict';

  var W = 480;
  var H = 320;
  var SHOW_MS = 0.9;
  var BLANK_MS = 0.22;
  var GAP_MS = 0.22;
  var START_LEN = 3;

  var SHOWING = 0, RECALL = 1, FEEDBACK = 2;

  GameShell.define({
    id: 'game-memory-span',
    slug: 'memory-span',
    title: 'Memory span',
    width: W,
    height: H,
    bestKey: 'memory-span',
    rawInput: true,
    startTitle: 'Memory span',
    startText: 'Watch the digits, then type them back in order. It gets one longer each time you manage it.',

    setup: function (g) {
      var seq = [];
      var shownIndex = -1;
      var timer = 0;
      var phase = SHOWING;
      /* True while the gap BETWEEN two digits is on screen. Without a gap a
         sequence containing 7 7 showed a 7, then a 7, with no frame between
         them — indistinguishable from one 7 held twice as long, which makes
         a memory test unanswerable on exactly the sequences that are hardest
         to remember. */
      var blanking = false;
      var typed = '';
      var length = START_LEN;
      var attempts = 0;             // attempts used at this length
      var feedback = '';
      var input = null;

      function buildInput() {
        if (input || !g.el) return;
        input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('aria-label', 'Type the digits you saw');
        g.el.appendChild(input);
        input.addEventListener('keydown', onKey);
        input.addEventListener('input', function () {
          var v = input.value; input.value = '';
          for (var i = 0; i < v.length; i++) handle(v.charAt(i));
        });
        /* ----------------------------------------------------------------
           The safety net. Everything above rests on one hidden <input>
           keeping focus, and focus is the least reliable thing on a page —
           a click on the sound toggle, on the fullscreen button beside it,
           or anywhere in the article below the board takes it away. And
           rawInput switches OFF the shell's own fall-through listener, the
           thing that answers keys for every other game once focus has
           dropped to <body>, so after one stray click nothing here was
           listening at all. The run carried on regardless.

           The typing trainer has carried this net for a while and its
           comment says why: a game played by typing must not be one click
           away from ignoring what is typed at it.

           Narrow enough that it cannot take anyone else's keys: only during
           a run, never out of a form field or the site search, and Space and
           Enter are left to a focused button, so one press cannot both
           activate that button and land here as well.
           ---------------------------------------------------------------- */
        document.addEventListener('keydown', function (event) {
          if (g.state !== 'playing') return;
          if (event.target === input) return;
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          var t = event.target;
          var tag = (t && t.tagName ? t.tagName : '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (t && t.isContentEditable) return;
          if ((tag === 'button' || tag === 'summary') && (event.key === ' ' || event.key === 'Enter')) return;
          /* Enter on a focused link follows the link; that one is the link's. */
          if (tag === 'a' && event.key === 'Enter') return;
          /* Enter is taken from anywhere else, so an answer typed and then
             stranded by a stray click can still be submitted without first
             typing another character or clicking the board. */
          if (event.key !== 'Backspace' && event.key !== 'Enter' &&
              (!event.key || event.key.length !== 1)) return;
          /* Hand the field its focus back, so every key after this one
             takes the normal path and a phone keyboard already up stays up. */
          focus();
          onKey(event);
        });

        var stage = g.el.querySelector('.game-stage');
        if (stage) stage.addEventListener('pointerdown', function () { focus(); });
      }

      function focus() {
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      }

      function onKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (g.state !== 'playing') {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); g.start(); }
          return;
        }
        if (event.key === 'Backspace') { event.preventDefault(); typed = typed.slice(0, -1); return; }
        if (event.key.length !== 1) return;
        event.preventDefault();
        handle(event.key);
      }

      function handle(ch) {
        if (phase !== RECALL) return;
        if (ch < '0' || ch > '9') return;
        typed += ch;
        g.beep(420 + Number(ch) * 30, 0.03, 'sine', 0.03);
        if (typed.length >= seq.length) judge();
      }

      function newSequence() {
        seq = [];
        for (var i = 0; i < length; i++) seq.push(Math.floor(Math.random() * 10));
        typed = '';
        shownIndex = -1;
        timer = 0.45;
        phase = SHOWING;
        blanking = false;
        g.stat('length', length);
        g.stat('attempt', (attempts + 1) + '/2');
        focus();
      }

      function judge() {
        var ok = typed === seq.join('');
        phase = FEEDBACK;
        timer = ok ? 0.7 : 1.2;
        if (ok) {
          feedback = 'Correct';
          g.beep(820, 0.09, 'sine');
          g.setScore(length);
          length++;
          attempts = 0;
        } else {
          attempts++;
          feedback = 'Wrong — it was ' + seq.join('');
          g.sweep(320, 130, 0.3);
          if (attempts >= 2) {
            /* Two failures at the same length ends it: the span is the last
               length actually completed. */
            var span = length - 1;
            g.over({
              won: true,
              score: span,
              title: 'Span of ' + span,
              message: span >= 9 ? 'Well above the usual range — seven plus or minus two is the classic figure.'
                     : span >= 7 ? 'Right in the normal adult range.'
                     : span >= 5 ? 'A little under the usual range. Chunking helps: read them as pairs.'
                     : 'Try again somewhere quieter — this one is very sensitive to distraction.'
            });
            return;
          }
        }
      }

      buildInput();

      return {
        reset: function () {
          length = START_LEN;
          attempts = 0;
          feedback = '';
          g.setScore(0);
          newSequence();
        },

        update: function (dt) {
          timer -= dt;
          if (timer > 0) return;

          if (phase === SHOWING) {
            /* Alternate a digit and a blank, so two identical digits in a row
               are visibly two. The comment used to say this while the code
               went straight from one digit to the next. */
            if (!blanking) {
              blanking = true;
              timer = BLANK_MS;
              return;
            }
            blanking = false;
            shownIndex++;
            if (shownIndex >= seq.length) {
              phase = RECALL;
              timer = 999;
              focus();
              return;
            }
            timer = SHOW_MS;
            return;
          }

          if (phase === FEEDBACK) { newSequence(); }
        },

        draw: function (ctx) {
          ctx.fillStyle = '#0b1220';
          ctx.fillRect(0, 0, W, H);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          if (phase === SHOWING) {
            var d = seq[shownIndex];
            ctx.font = 'bold 110px "Cascadia Code", Consolas, monospace';
            ctx.fillStyle = '#7dd3fc';
            if (!blanking && shownIndex >= 0 && shownIndex < seq.length) {
              ctx.fillText(String(d), W / 2, H / 2);
            }
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText('watch', W / 2, H - 40);
          } else if (phase === RECALL) {
            ctx.font = '16px "Segoe UI", sans-serif';
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText('Type the ' + seq.length + ' digits', W / 2, 74);
            ctx.font = 'bold 46px "Cascadia Code", Consolas, monospace';
            ctx.fillStyle = '#f8fafc';
            var shown = typed;
            for (var i = typed.length; i < seq.length; i++) shown += '·';
            ctx.fillText(shown.split('').join(' '), W / 2, H / 2);
            ctx.font = '13px "Segoe UI", sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.fillText('tap here if the keyboard does not appear', W / 2, H - 34);
          } else {
            ctx.font = 'bold 26px "Segoe UI", sans-serif';
            ctx.fillStyle = feedback.indexOf('Correct') === 0 ? '#86efac' : '#f87171';
            ctx.fillText(feedback, W / 2, H / 2);
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(attempts === 1 ? 'One more try at this length' : '', W / 2, H / 2 + 36);
          }

          ctx.font = '13px "Cascadia Code", Consolas, monospace';
          ctx.fillStyle = '#64748b';
          ctx.textAlign = 'left';
          ctx.fillText('length ' + length + '   attempt ' + Math.min(attempts + 1, 2) + '/2', 14, 20);
        }
      };
    }
  });
})();

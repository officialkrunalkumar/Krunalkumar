/* ==========================================================================
   are-you-a-robot.js — a CAPTCHA that escalates until it admits the truth.
   --------------------------------------------------------------------------
   Two decisions worth writing down, because both look like shortcuts and
   neither is.

   THE PHOTOGRAPHS ARE WORDS IN BOXES. A real image challenge needs images,
   which means a network request, which nothing in /games is allowed to make.
   Rather than ship nine pictures to sell one joke, each tile is a labelled
   button. It costs the gag nothing — the humour is in the instruction, not
   the pixels — and it has an accidental virtue: a screen reader can read
   this challenge out loud, which is more than the thing it is parodying
   manages after twenty years of trying.

   NOTHING EVER FAILS. Verify always advances, whatever was clicked, and the
   wrong-answer line says so out loud. A fail state would teach the opposite
   of the point the last screen makes — the squares were never the test —
   and would also trap anyone who came for the explanation rather than the
   bit. The one number that IS counted is the pointer-move tally, because it
   is the only thing on the page resembling what a modern CAPTCHA actually
   reads. It lives in a variable, is shown once at the end, and dies with the
   tab.
   ========================================================================== */

(function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /* Every stage but the last is one screen with one Verify button. The
     'right' list is only ever used to write a wry line afterwards. It never
     gates anything. */
  var STAGES = [
    {
      kind: 'check',
      prompt: 'Confirm that you are a human being.',
      sub: 'A routine check. It will only take a moment.'
    },
    {
      kind: 'grid',
      prompt: 'Select all squares with traffic lights.',
      sub: 'Click Verify once there are none left.',
      tiles: ['Traffic light', 'Bus', 'Traffic light', 'Fire hydrant', 'Shopfront',
              'Traffic light', 'Zebra crossing', 'Bicycle', 'Post box'],
      right: [0, 2, 5]
    },
    {
      kind: 'grid',
      prompt: 'Select all squares with traffic lights.',
      sub: 'Images may take a moment to load.',
      dead: true,
      tiles: ['Image unavailable', 'Image unavailable', 'Image unavailable',
              'Image unavailable', 'Image unavailable', 'Image unavailable',
              'Image unavailable', 'Image unavailable', 'Image unavailable']
    },
    {
      kind: 'grid',
      prompt: 'Select all squares containing the concept of regret.',
      sub: 'Click Verify once there are none left.',
      tiles: ['A text sent at 2am', 'The second pint', 'A tattoo from 2011',
              'Reply all', 'The gym membership', 'A fringe',
              'The group chat you named', 'An unread email from 2019', 'None of the above']
    },
    {
      kind: 'text',
      prompt: 'Type the letters you feel.',
      sub: 'Case is not important. Neither is anything else.'
    },
    {
      kind: 'choice',
      prompt: 'Prove you have experienced disappointment.',
      sub: 'Choose your strongest evidence.',
      options: [
        'I have watched a progress bar go backwards',
        'I have waited for a bus that arrived full',
        'I have followed a team',
        'I have read a changelog that said only "bug fixes"',
        'I have been asked to prove I am human'
      ]
    },
    {
      kind: 'slider',
      prompt: 'Set the slider to how human you feel today.',
      sub: 'Far left is entirely mechanical. Far right is uncomfortably human.'
    },
    { kind: 'done' }
  ];

  var CHECKS = STAGES.length - 1;

  GameShell.define({
    id: 'game-are-you-a-robot',
    slug: 'are-you-a-robot',
    /* Declared here and not only in the manifest, because the manifest is
       build-time data: the generator never hands it to the runtime, so a
       tapAction set only there is a comment. The page copy for this game
       promises a tap does nothing; without this line it did something. */
    tapAction: false,
    title: 'Are you a robot?',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var host = g.board;
      var index = 0;
      var note = '';
      var picked = [];
      var busy = false;
      var timer = null;
      var moves = 0;
      var clicks = 0;
      var startedAt = Date.now();

      /* The only measurement here, and the whole punchline. Passive because
         it does nothing but add one to a number. */
      host.addEventListener('pointermove', function () { moves++; }, { passive: true });
      host.addEventListener('click', function () { clicks++; }, true);

      /* Focus lands on the CARD, not on the first tile. Each screen replaces
         the whole card, and the funny part is the line at the top of it —
         sending focus straight to a button would step over the prompt for
         anyone reading with a screen reader, which is exactly the group real
         CAPTCHAs already treat worst. */
      function focusCard() {
        var card = host.querySelector('.robot-card');
        if (!card) return;
        try { card.focus({ preventScroll: true }); } catch (err) { card.focus(); }
      }

      function gridHtml(st) {
        var out = '<div class="robot-grid" role="group" aria-label="' + esc(st.prompt) + '">';
        for (var i = 0; i < st.tiles.length; i++) {
          out += '<button class="robot-tile' + (st.dead ? ' is-dead' : '') +
                 '" type="button" aria-pressed="false" data-tile="' + i + '">' +
                 '<span class="robot-tile-label">' + esc(st.tiles[i]) + '</span></button>';
        }
        return out + '</div>';
      }

      function bodyHtml(st) {
        if (st.kind === 'check') {
          /* A real checkbox cannot be labelled by a <label> here, because the
             control is a button playing a checkbox — so the label is a span
             the button points at, and clicking it does the same thing. */
          return '<div class="robot-check">' +
                 '<button class="robot-box" type="button" role="checkbox" aria-checked="false" ' +
                 'id="robot-box" aria-labelledby="robot-box-label">' +
                 '<span class="robot-tick" aria-hidden="true">&#10003;</span></button>' +
                 '<span class="robot-box-label" id="robot-box-label">I&rsquo;m not a robot</span>' +
                 '</div>';
        }
        if (st.kind === 'grid') return gridHtml(st);
        if (st.kind === 'text') {
          return '<div class="robot-field">' +
                 '<label class="robot-field-label" for="robot-text">Your letters</label>' +
                 '<input class="robot-input" id="robot-text" type="text" autocomplete="off" ' +
                 'autocapitalize="off" spellcheck="false" maxlength="40"></div>';
        }
        if (st.kind === 'choice') {
          var out = '<div class="robot-choices" role="radiogroup" aria-label="' + esc(st.prompt) + '">';
          for (var i = 0; i < st.options.length; i++) {
            out += '<button class="robot-choice" type="button" role="radio" aria-checked="false" ' +
                   'data-choice="' + i + '">' + esc(st.options[i]) + '</button>';
          }
          return out + '</div>';
        }
        /* slider */
        return '<div class="robot-field">' +
               '<label class="robot-field-label" for="robot-range">How human, today</label>' +
               '<input class="robot-range" id="robot-range" type="range" min="0" max="100" value="50">' +
               '<p class="robot-range-read" id="robot-read">50 out of 100</p></div>';
      }

      function render() {
        var st = STAGES[index];
        g.stat('stage', (index + 1) + '/' + STAGES.length);
        if (st.kind === 'done') { renderDone(); return; }

        picked = [];
        host.className = 'game-board board-robot';
        host.innerHTML =
          '<div class="robot-card" tabindex="-1">' +
          '<div class="robot-head">' +
          '<span class="robot-brand">notARobot&trade;</span>' +
          '<span class="robot-step">Check ' + (index + 1) + ' of ' + CHECKS + '</span>' +
          '</div>' +
          (note ? '<p class="robot-note">' + note + '</p>' : '') +
          '<p class="robot-prompt">' + esc(st.prompt) + '</p>' +
          '<p class="robot-sub">' + esc(st.sub) + '</p>' +
          bodyHtml(st) +
          '<div class="robot-actions" id="robot-actions">' +
          (st.kind === 'check' ? '<p class="robot-wait-hint">Tick the box to carry on.</p>'
                               : '<button class="game-btn robot-verify" type="button" id="robot-verify">Verify</button>') +
          '</div></div>';

        wire(st);
        focusCard();
      }

      function wire(st) {
        var i;
        if (st.kind === 'check') {
          var box = host.querySelector('#robot-box');
          var tick = function () {
            if (busy) return;
            box.setAttribute('aria-checked', 'true');
            box.classList.add('is-on');
            g.beep(620, 0.05, 'sine', 0.05);
            advance('Checkbox accepted. Additional verification required.');
          };
          box.addEventListener('click', tick);
          host.querySelector('#robot-box-label').addEventListener('click', tick);
          return;
        }

        if (st.kind === 'grid') {
          var tiles = host.querySelectorAll('.robot-tile');
          for (i = 0; i < tiles.length; i++) {
            (function (btn, idx) {
              btn.addEventListener('click', function () {
                if (busy) return;
                picked[idx] = !picked[idx];
                btn.setAttribute('aria-pressed', String(!!picked[idx]));
                if (picked[idx]) btn.classList.add('is-picked');
                else btn.classList.remove('is-picked');
                g.beep(picked[idx] ? 720 : 420, 0.03, 'sine', 0.04);
              });
            })(tiles[i], i);
          }
        }

        if (st.kind === 'choice') {
          var opts = host.querySelectorAll('.robot-choice');
          for (i = 0; i < opts.length; i++) {
            (function (btn, idx) {
              btn.addEventListener('click', function () {
                if (busy) return;
                var all = host.querySelectorAll('.robot-choice');
                for (var k = 0; k < all.length; k++) {
                  all[k].setAttribute('aria-checked', 'false');
                  all[k].classList.remove('is-picked');
                }
                btn.setAttribute('aria-checked', 'true');
                btn.classList.add('is-picked');
                picked[0] = idx;
                g.beep(560 + idx * 30, 0.04, 'sine', 0.04);
              });
              /* A radiogroup is expected to move on the arrows, and a row of
                 buttons does not do that for free. Same behaviour QuizKit
                 gives its options, so the two quizzes feel like one site. */
              btn.addEventListener('keydown', function (event) {
                var kids = host.querySelectorAll('.robot-choice');
                var pos = Array.prototype.indexOf.call(kids, btn);
                if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  kids[(pos + 1) % kids.length].focus();
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  kids[(pos - 1 + kids.length) % kids.length].focus();
                }
              });
            })(opts[i], i);
          }
        }

        if (st.kind === 'slider') {
          var range = host.querySelector('#robot-range');
          var read = host.querySelector('#robot-read');
          range.addEventListener('input', function () {
            read.textContent = range.value + ' out of 100';
          });
        }

        if (st.kind === 'text') {
          var field = host.querySelector('#robot-text');
          field.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') { event.preventDefault(); submit(st); }
          });
        }

        var verify = host.querySelector('#robot-verify');
        if (verify) verify.addEventListener('click', function () { submit(st); });
      }

      /* Reads whatever the stage collected and turns it into the line that
         will sit at the top of the NEXT screen. Carrying the joke forward
         rather than pausing on it keeps the whole thing to one click a
         stage, which is the difference between short and tiresome. */
      function submit(st) {
        if (busy) return;
        var i;
        var count = 0;

        if (st.kind === 'grid') {
          for (i = 0; i < st.tiles.length; i++) if (picked[i]) count++;

          if (st.right) {
            var want = {};
            for (i = 0; i < st.right.length; i++) want[st.right[i]] = 1;
            var off = 0;
            for (i = 0; i < st.tiles.length; i++) {
              if (!!picked[i] !== !!want[i]) off++;
            }
            advance(off === 0
              ? 'All three, correctly. It changed nothing, but well done.'
              : plural(off, 'square', 'squares') + ' wrong. Accepted anyway &mdash; that is the part worth noticing.');
            return;
          }

          if (st.dead) {
            advance('Nothing loaded, so every answer was correct. Verification continues.');
            return;
          }

          advance(count === 0
            ? 'You selected nothing. Declining to answer is also an answer, and it took you a while.'
            : count === 9
              ? 'All nine. That is either honesty or a machine clicking everything, and nothing here can tell them apart.'
              : plural(count, 'square', 'squares') + ' selected. There was no answer key for that one.');
          return;
        }

        if (st.kind === 'text') {
          var typed = host.querySelector('#robot-text').value.replace(/\s+/g, ' ').trim();
          advance(!typed.length
            ? 'You typed nothing. Recorded as a feeling.'
            : typed.length > 24
              ? 'You typed ' + plural(typed.length, 'character', 'characters') + '. Nobody asked for that many, and yet.'
              : '&ldquo;' + esc(typed) + '&rdquo; has been added to your permanent record, which does not exist.');
          return;
        }

        if (st.kind === 'choice') {
          var pick = picked[0];
          advance(pick == null
            ? 'No evidence offered. Disappointing, which counts.'
            : pick === 4
              ? 'You cited this exact screen. Accepted, and awkward for everyone.'
              : 'Accepted. Verified human by defeat.');
          return;
        }

        if (st.kind === 'slider') {
          var v = Number(host.querySelector('#robot-range').value);
          advance(v <= 10
            ? 'You told a robot-detector you feel entirely mechanical and it waved you through.'
            : v >= 90
              ? 'Maximum humanity declared. Unverifiable, like all the rest of it.'
              : 'Noted. The number was never read &mdash; only the dragging.');
          return;
        }

        advance('');
      }

      /* The fake wait. It exists because a challenge that resolves instantly
         reads as a form, and the pause is where the parody lives. */
      function advance(nextNote) {
        busy = true;
        var actions = host.querySelector('#robot-actions');
        if (actions) {
          actions.innerHTML = '<span class="robot-spin" aria-hidden="true"></span>' +
                              '<span class="robot-waiting" role="status">Verifying&hellip;</span>';
        }
        g.beep(300, 0.05, 'sine', 0.04);
        timer = setTimeout(function () {
          busy = false;
          note = nextNote;
          index++;
          render();
        }, 620);
      }

      function renderDone() {
        var secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        var quiet = moves < 25;
        g.stat('verdict', 'Unproven');
        g.beep(880, 0.12, 'sine');

        host.className = 'game-board board-robot';
        host.innerHTML =
          '<div class="robot-card robot-final" tabindex="-1">' +
          '<div class="robot-head"><span class="robot-brand">notARobot&trade;</span>' +
          '<span class="robot-step robot-pass">Access granted</span></div>' +
          '<h3 class="robot-final-title">You are probably not a robot.</h3>' +
          '<p class="robot-final-lead">You were never going to fail. Every screen accepted every answer, ' +
          'including the empty ones, because none of them could tell the difference &mdash; and neither can ' +
          'the real ones any more.</p>' +
          '<ul class="robot-final-list">' +
          '<li><strong>The puzzles lost the arms race.</strong> Distorted text died when software got better ' +
          'at reading it than people were; Google said in 2014 that its own recogniser handled the hardest ' +
          'variants with better than 99% accuracy. Traffic lights and crossings are simply the next thing ' +
          'machines have now caught up with.</li>' +
          '<li><strong>Modern checks score behaviour, not answers.</strong> reCAPTCHA v3 returns a number ' +
          'between 0.0 and 1.0 and shows nothing at all; Cloudflare Turnstile mostly does the same. They ' +
          'weigh how the pointer moved, how the typing was timed, what the browser looks like, cookies you ' +
          'already had, and the reputation of your address.</li>' +
          '<li><strong>So the squares are mostly theatre.</strong> When one appears it usually means the ' +
          'score was borderline &mdash; or that somebody wanted you to see a security check happening. The ' +
          'tick box was never reading the tick.</li>' +
          '<li><strong>And it was free labour first.</strong> The original reCAPTCHA fed your answers into ' +
          'digitising scanned books and newspaper archives, then Street View house numbers, then image ' +
          'labelling. You were not only being tested. You were working.</li>' +
          '</ul>' +
          '<div class="robot-stats">' +
          '<div class="robot-statcell"><span class="robot-statnum">' + moves + '</span>' +
          '<span class="robot-statlab">pointer moves</span></div>' +
          '<div class="robot-statcell"><span class="robot-statnum">' + clicks + '</span>' +
          '<span class="robot-statlab">clicks and taps</span></div>' +
          '<div class="robot-statcell"><span class="robot-statnum">' + secs + '</span>' +
          '<span class="robot-statlab">seconds in here</span></div>' +
          '</div>' +
          '<p class="robot-final-note">' +
          (quiet
            ? 'Your pointer barely moved, which usually means a touch screen &mdash; in which case the signal ' +
              'a real check would want is the timing and the shape of your taps instead.'
            : 'That first number is the only thing on this page that resembles what a real check reads.') +
          ' It was counted in a variable in your tab, shown once, and goes away when you reload. Nothing was ' +
          'sent anywhere, because there is nowhere here to send it.</p>' +
          '<button class="btn btn-primary robot-again" type="button" id="robot-again">Do it all again</button>' +
          '</div>';

        host.querySelector('#robot-again').addEventListener('click', function () { begin(); });
        focusCard();
      }

      function begin() {
        if (timer) { clearTimeout(timer); timer = null; }
        busy = false;
        index = 0;
        note = '';
        picked = [];
        moves = 0;
        clicks = 0;
        startedAt = Date.now();
        g.stat('verdict', 'Pending');
        render();
      }

      /* Declared in the toolbar, so somebody who wants the explanation and
         not the bit can have it without clicking through seven screens. */
      var skip = g.el.querySelector('#robot-skip');
      if (skip) {
        skip.addEventListener('click', function () {
          if (timer) { clearTimeout(timer); timer = null; }
          busy = false;
          note = '';
          index = STAGES.length - 1;
          render();
        });
      }

      return { reset: begin };
    }
  });
})();

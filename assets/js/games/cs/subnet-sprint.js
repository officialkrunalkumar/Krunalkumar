/* ==========================================================================
   subnet-sprint.js — timed CIDR questions.
   --------------------------------------------------------------------------
   Six question types drawn at random: usable hosts, network address,
   broadcast, the mask in dotted form, whether two addresses share a subnet,
   and which prefix a required host count needs.

   THE ANSWERS ARE COMPUTED, NOT STORED. Every question is generated from a
   random address and prefix and solved with the same bitwise arithmetic a
   router uses, so the bank never runs out and never disagrees with itself.
   Storing a table of question-and-answer pairs is how these things end up
   with three wrong entries nobody notices for a year.

   All arithmetic goes through >>> 0. A 32-bit mask like 0xFFFFFF00 is a
   NEGATIVE number in JavaScript's signed bitwise ops, and the /0 and /1
   cases come out wrong without the unsigned shift.
   ========================================================================== */

(function () {
  'use strict';

  var DURATION = 120;

  function toDotted(n) {
    n = n >>> 0;
    return ((n >>> 24) & 255) + '.' + ((n >>> 16) & 255) + '.' + ((n >>> 8) & 255) + '.' + (n & 255);
  }

  function maskFor(prefix) {
    /* prefix 0 must give 0, and (0xFFFFFFFF << 32) is not 0 in JS — the
       shift count wraps. Special-cased rather than trusted. */
    if (prefix <= 0) return 0;
    return (0xFFFFFFFF << (32 - prefix)) >>> 0;
  }

  function randomIp() {
    return (((Math.floor(Math.random() * 223) + 1) << 24) |
            (Math.floor(Math.random() * 256) << 16) |
            (Math.floor(Math.random() * 256) << 8) |
            Math.floor(Math.random() * 256)) >>> 0;
  }

  GameShell.define({
    id: 'game-subnet-sprint',
    slug: 'subnet-sprint',
    title: 'Subnet sprint',
    bestKey: 'subnet-sprint',
    rawInput: true,
    startTitle: 'Subnet sprint',
    startText: 'Two minutes of CIDR questions. Type the answer and press Enter.',

    setup: function (g) {
      var host = g.board;
      var left = DURATION;
      var right = 0;
      var wrong = 0;
      var current = null;
      var typed = '';
      var input = null;
      var feedback = '';
      var feedbackT = 0;

      function make() {
        var prefix = 8 + Math.floor(Math.random() * 22);      // /8 .. /29
        var ip = randomIp();
        var mask = maskFor(prefix);
        var net = (ip & mask) >>> 0;
        var bcast = (net | (~mask >>> 0)) >>> 0;
        var hostBits = 32 - prefix;
        var usable = hostBits >= 2 ? Math.pow(2, hostBits) - 2 : (hostBits === 1 ? 2 : 1);

        var kinds = ['hosts', 'network', 'broadcast', 'mask', 'same', 'need'];
        var kind = kinds[Math.floor(Math.random() * kinds.length)];

        if (kind === 'hosts') {
          return { q: 'How many usable hosts in a /' + prefix + '?', a: String(usable), hint: '2^' + hostBits + ' minus 2' };
        }
        if (kind === 'network') {
          return { q: 'Network address of ' + toDotted(ip) + '/' + prefix + '?', a: toDotted(net), hint: 'AND the address with the mask' };
        }
        if (kind === 'broadcast') {
          return { q: 'Broadcast address of ' + toDotted(ip) + '/' + prefix + '?', a: toDotted(bcast), hint: 'network OR the inverted mask' };
        }
        if (kind === 'mask') {
          return { q: 'Subnet mask for /' + prefix + ' in dotted decimal?', a: toDotted(mask), hint: prefix + ' ones, then zeros' };
        }
        if (kind === 'same') {
          /* Half the time build a second address inside the same subnet, so
             the answer is not always no. */
          var other;
          if (Math.random() < 0.5) {
            other = (net + 1 + Math.floor(Math.random() * Math.max(1, usable))) >>> 0;
          } else {
            other = (ip ^ (1 << (31 - Math.floor(Math.random() * Math.max(1, prefix))))) >>> 0;
          }
          var same = ((other & mask) >>> 0) === net;
          return {
            q: 'Are ' + toDotted(ip) + ' and ' + toDotted(other) + ' in the same /' + prefix + '?',
            a: same ? 'yes' : 'no',
            hint: 'compare both after masking',
            accepts: same ? ['yes', 'y'] : ['no', 'n']
          };
        }
        var need = [2, 6, 14, 30, 62, 126, 254, 510, 1022][Math.floor(Math.random() * 9)];
        var bits = Math.ceil(Math.log(need + 2) / Math.log(2));
        return {
          q: 'Smallest prefix that fits ' + need + ' usable hosts?',
          a: '/' + (32 - bits),
          hint: 'need ' + bits + ' host bits',
          accepts: ['/' + (32 - bits), String(32 - bits)]
        };
      }

      function build() {
        host.className = 'game-board board-subnet';
        host.innerHTML =
          '<p class="subnet-timer" id="subnet-timer">2:00</p>' +
          '<p class="subnet-q" id="subnet-q">…</p>' +
          '<p class="subnet-answer" id="subnet-a">_</p>' +
          '<p class="subnet-feedback" id="subnet-f"></p>' +
          '<p class="subnet-hint" id="subnet-h"></p>';

        input = document.createElement('input');
        input.type = 'text';
        input.className = 'typing-catch';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-label', 'Type your answer');
        host.appendChild(input);
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
          if (tag === 'button' && (event.key === ' ' || event.key === 'Enter')) return;
          if (event.key !== 'Backspace' && (!event.key || event.key.length !== 1)) return;
          /* Hand the field its focus back, so every key after this one
             takes the normal path and a phone keyboard already up stays up. */
          focus();
          onKey(event);
        });

        host.addEventListener('pointerdown', focus);
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
        if (event.key === 'Enter') { event.preventDefault(); submit(); return; }
        if (event.key === 'Backspace') { event.preventDefault(); typed = typed.slice(0, -1); paint(); return; }
        if (event.key.length !== 1) return;
        event.preventDefault();
        handle(event.key);
      }

      function handle(ch) {
        if (g.state !== 'playing') return;
        typed += ch;
        paint();
      }

      function submit() {
        if (!current) return;
        var given = typed.trim().toLowerCase();
        var ok = given === current.a.toLowerCase();
        if (!ok && current.accepts) {
          for (var i = 0; i < current.accepts.length; i++) {
            if (given === current.accepts[i].toLowerCase()) { ok = true; break; }
          }
        }
        if (ok) {
          right++;
          g.addScore(10);
          feedback = 'Correct';
          g.beep(760, 0.05, 'sine');
        } else {
          wrong++;
          feedback = 'It was ' + current.a;
          g.beep(200, 0.07, 'square');
        }
        feedbackT = 1.4;
        g.stat('right', right);
        g.stat('wrong', wrong);
        typed = '';
        current = make();
        paint();
      }

      function paint() {
        if (!host) return;
        var q = host.querySelector('#subnet-q');
        var a = host.querySelector('#subnet-a');
        var f = host.querySelector('#subnet-f');
        var h = host.querySelector('#subnet-h');
        var tm = host.querySelector('#subnet-timer');
        if (q && current) q.textContent = current.q;
        if (a) a.textContent = typed || '_';
        if (f) { f.textContent = feedbackT > 0 ? feedback : ''; f.className = 'subnet-feedback ' + (feedback.indexOf('Correct') === 0 ? 'is-right' : 'is-wrong'); }
        if (h && current) h.textContent = current.hint;
        if (tm) {
          var m = Math.floor(Math.max(0, left) / 60), sec = Math.floor(Math.max(0, left) % 60);
          tm.textContent = m + ':' + (sec < 10 ? '0' : '') + sec;
        }
      }

      build();

      return {
        reset: function () {
          left = DURATION;
          right = 0; wrong = 0; typed = ''; feedback = ''; feedbackT = 0;
          current = make();
          g.setScore(0);
          g.stat('right', 0);
          g.stat('wrong', 0);
          paint();
          focus();
        },

        update: function (dt) {
          left -= dt;
          if (feedbackT > 0) feedbackT -= dt;
          paint();
          if (left <= 0) {
            var total = right + wrong;
            g.over({
              won: true,
              score: right,
              title: right + ' correct',
              message: total ? Math.round((right / total) * 100) + '% accurate over ' + total + ' questions in two minutes.'
                             : 'No answers submitted.'
            });
          }
        }
      };
    }
  });
})();

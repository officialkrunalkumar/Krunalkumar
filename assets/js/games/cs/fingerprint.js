/* ==========================================================================
   fingerprint.js — two SSH key fingerprints. Same, or different?
   --------------------------------------------------------------------------
   Registers with GameShell.define as the `fingerprint` board game.

   THE GAME IS A DEMONSTRATION AND THE DEMONSTRATION IS THAT YOU CANNOT DO
   THIS. Every SSH client asks you to compare a fingerprint the first time you
   connect somewhere, and essentially nobody does — they type yes. The usual
   explanation is laziness. It is not: comparing two 43-character base64
   strings by eye is a task humans are measurably bad at, and the point of
   playing is to find that out about yourself rather than be told it.

   SO THE DIFFICULTY RAMP IS THE ARGUMENT. Early pairs differ in six places
   and everybody gets those. By the time the score is past twenty the pairs
   differ in ONE character, and that character is drawn from a confusable set
   — I against l, 0 against O, 5 against S, u against v, - against _. Accuracy
   falls off a cliff somewhere in there, and where it falls is the finding.

   WHY IT IS NOT A MEMORY TEST. Both strings are on screen the whole time, so
   this measures comparison rather than recall — which is the real task. There
   is a clock instead, because unlimited time turns it into a character-by-
   character audit that anybody can pass and nobody performs in real life at
   03:00 when the deploy is blocked.

   A WRONG ANSWER COSTS THREE SECONDS and shows you where the difference was.
   Being told "wrong" teaches nothing; being shown the one character you
   missed, highlighted, is what makes the next pair feel different.

   THE FINGERPRINTS ARE FORMED LIKE REAL ONES — 43 characters of base64url,
   the length of a SHA-256 digest, prefixed SHA256: exactly as ssh-keygen
   prints it. They are random rather than derived from real keys, because a
   real key would imply a real host.

   Pairs with /labs/ssh-keys, which computes the genuine article.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

/* global GameShell */
(function () {
  'use strict';

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /* Characters people genuinely mix up in a monospace font. Each entry maps a
     character to the ones it is worth swapping it for at high difficulty. */
  var CONFUSABLE = {
    'I': 'l1', 'l': 'I1', '1': 'Il',
    'O': '0Q', '0': 'OQ', 'Q': 'O0',
    'S': '5', '5': 'S',
    'B': '8', '8': 'B',
    'Z': '2', '2': 'Z',
    'u': 'v', 'v': 'u',
    'm': 'n', 'n': 'm',
    'c': 'e', 'e': 'c',
    'g': 'q', 'q': 'g',
    '-': '_', '_': '-'
  };

  var LEN = 43;
  var ROUND_MS = 60000;
  var PENALTY_MS = 3000;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function randInt(n) {
    var b = new Uint32Array(1);
    (self.crypto || self.msCrypto).getRandomValues(b);
    return b[0] % n;
  }

  function randomFp() {
    var s = '';
    for (var i = 0; i < LEN; i++) s += B64.charAt(randInt(B64.length));
    return s;
  }

  /* How many characters differ, and whether the swap is a confusable one.
     Both tighten as the score climbs; the confusable stage is where accuracy
     actually falls, so it starts late enough that a player has already
     decided they are good at this. */
  function levelFor(score) {
    if (score < 4) return { diffs: 6, confusable: false, name: 'six characters' };
    if (score < 9) return { diffs: 4, confusable: false, name: 'four characters' };
    if (score < 15) return { diffs: 2, confusable: false, name: 'two characters' };
    if (score < 21) return { diffs: 1, confusable: false, name: 'one character' };
    return { diffs: 1, confusable: true, name: 'one confusable character' };
  }

  function mutate(s, level) {
    var chars = s.split('');
    var spots = [];
    var guard = 0;
    while (spots.length < level.diffs && guard++ < 400) {
      var i = randInt(LEN);
      if (spots.indexOf(i) !== -1) continue;
      var from = chars[i];
      var to;
      if (level.confusable) {
        var pool = CONFUSABLE[from];
        if (!pool) continue;                       // try another position
        to = pool.charAt(randInt(pool.length));
      } else {
        do { to = B64.charAt(randInt(B64.length)); } while (to === from);
      }
      chars[i] = to;
      spots.push(i);
    }
    /* If the confusable pass could not find enough positions — a string with
       no confusable characters in it is unlikely but possible — fall back to
       an ordinary swap rather than returning an identical pair, which would
       be scored as a lie. */
    if (!spots.length) {
      var j = randInt(LEN);
      var t;
      do { t = B64.charAt(randInt(B64.length)); } while (t === chars[j]);
      chars[j] = t;
      spots.push(j);
    }
    return { text: chars.join(''), spots: spots };
  }

  GameShell.define({
    id: 'game-fingerprint',
    slug: 'fingerprint',
    title: 'Fingerprint',
    bestKey: 'fingerprint',
    autoStart: false,
    pauseOnBlur: true,
    tapAction: false,
    startTitle: 'Fingerprint',
    startText: 'Two SSH key fingerprints. Same, or different? Your client asks you ' +
      'this every time you connect somewhere new. Sixty seconds, and the pairs get ' +
      'closer together as you go.',

    setup: function (g) {
      var board = g.board;
      var left = null, right = null, same = false, spots = [];
      var score = 0, wrong = 0, streak = 0, best = 0;
      var hard = { asked: 0, right: 0 };
      var remain = 0, running = false, locked = false;
      var fpA = null, fpB = null, verdict = null, timeBar = null;

      function build() {
        board.textContent = '';

        var wrap = el('div', 'fp-wrap');

        var bar = el('div', 'quiz-progress');
        timeBar = el('div', 'quiz-progress-bar');
        bar.appendChild(timeBar);
        wrap.appendChild(bar);

        var q = el('p', 'fp-prompt', 'Same fingerprint, or different?');
        wrap.appendChild(q);

        fpA = el('div', 'fp-line');
        fpB = el('div', 'fp-line');
        wrap.appendChild(fpA);
        wrap.appendChild(fpB);

        verdict = el('p', 'fp-verdict');
        verdict.setAttribute('role', 'status');
        verdict.setAttribute('aria-live', 'polite');
        wrap.appendChild(verdict);

        var row = el('div', 'fp-buttons');
        var bSame = el('button', 'quiz-option fp-btn', 'Same');
        var bDiff = el('button', 'quiz-option fp-btn', 'Different');
        bSame.type = 'button';
        bDiff.type = 'button';
        /* Both a key and a button, because this is played on a phone as much
           as at a desk and S/D is meaningless there. */
        bSame.addEventListener('click', function () { answer(true); });
        bDiff.addEventListener('click', function () { answer(false); });
        row.appendChild(bSame);
        row.appendChild(bDiff);
        wrap.appendChild(row);

        var hint = el('p', 'fp-hint', 'Keys: S or \u2190 for same, D or \u2192 for different.');
        wrap.appendChild(hint);

        board.appendChild(wrap);
      }

      /* S and D on the document rather than on the shell element, because the
         board is not itself focusable and a keystroke that lands on <body>
         would otherwise go nowhere — the same last-resort the shell keeps for
         its own keys. Guarded three ways so it can never steal a keystroke:
         only while a round is live, never with a modifier held, and never when
         the target is a field somebody is typing into. */
      function onKey(e) {
        if (!running || locked) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        var k = (e.key || '').toLowerCase();
        if (k === 's') { e.preventDefault(); answer(true); }
        else if (k === 'd') { e.preventDefault(); answer(false); }
      }
      document.addEventListener('keydown', onKey);

      /* Render a fingerprint, optionally marking the characters that differ.
         Built from spans rather than innerHTML: the strings are generated
         here, but a fingerprint field that parses markup is a bad habit to
         put in a file about SSH. */
      function paint(node, text, marks) {
        node.textContent = '';
        var prefix = el('span', 'fp-prefix', 'SHA256:');
        node.appendChild(prefix);
        for (var i = 0; i < text.length; i++) {
          if (marks && marks.indexOf(i) !== -1) {
            node.appendChild(el('span', 'fp-diff', text.charAt(i)));
          } else {
            node.appendChild(document.createTextNode(text.charAt(i)));
          }
        }
      }

      function deal() {
        locked = false;
        var level = levelFor(score);
        left = randomFp();
        /* Half the pairs match. Any other ratio and a player who always
           answers "different" beats one who looks. */
        same = randInt(2) === 0;
        if (same) { right = left; spots = []; }
        else {
          var m = mutate(left, level);
          right = m.text;
          spots = m.spots;
        }
        if (level.confusable) hard.asked++;
        paint(fpA, left, null);
        paint(fpB, right, null);
        verdict.textContent = '';
        verdict.className = 'fp-verdict';
      }

      function answer(saidSame) {
        if (!running || locked) return;
        locked = true;
        var correct = (saidSame === same);
        var level = levelFor(score);

        if (correct) {
          score++;
          streak++;
          if (streak > best) best = streak;
          if (level.confusable) hard.right++;
          verdict.textContent = same ? 'Yes — identical.' : 'Yes — different.';
          verdict.className = 'fp-verdict is-right';
          g.stat('score', score);
          g.stat('streak', streak);
          /* Show the difference even when they got it right: seeing WHERE it
             was is what makes the next pair readable. */
          if (!same) paint(fpB, right, spots);
          setTimeout(function () { if (running) deal(); }, same ? 260 : 620);
        } else {
          wrong++;
          streak = 0;
          remain -= PENALTY_MS;
          g.stat('streak', 0);
          if (same) {
            verdict.textContent = 'No — those were identical. −3s';
          } else {
            verdict.textContent = 'No — ' + spots.length +
              (spots.length === 1 ? ' character differs. −3s' : ' characters differ. −3s');
            paint(fpB, right, spots);
          }
          verdict.className = 'fp-verdict is-wrong';
          g.announce(verdict.textContent);
          setTimeout(function () { if (running) deal(); }, 1100);
        }
      }

      function finish() {
        running = false;
        var total = score + wrong;
        var acc = total ? Math.round((score / total) * 100) : 0;
        var hardAcc = hard.asked ? Math.round((hard.right / hard.asked) * 100) : null;

        board.textContent = '';
        var r = el('div', 'quiz-result');
        r.appendChild(el('div', 'quiz-result-title', score + ' correct in sixty seconds'));

        var body = el('p', 'quiz-result-body');
        body.appendChild(document.createTextNode(
          'Accuracy ' + acc + '% over ' + total + ' pair' + (total === 1 ? '' : 's') +
          '. Longest streak ' + best + '.'));
        r.appendChild(body);

        var note = el('p', 'quiz-result-body');
        if (hardAcc === null) {
          note.textContent = 'You did not reach the single-confusable-character pairs — ' +
            'those start at a score of 21. That is where this stops being easy.';
        } else if (hardAcc >= 90) {
          note.textContent = 'On the pairs differing by one confusable character you scored ' +
            hardAcc + '%, over ' + hard.asked + ' of them. That is genuinely unusual. ' +
            'Note that you were looking for a difference and knew one might be there — ' +
            'nobody connecting to a server at 03:00 is.';
        } else {
          note.textContent = 'On the pairs differing by one confusable character you scored ' +
            hardAcc + '%, over ' + hard.asked + ' of them. That is the number that matters, ' +
            'and it is why nobody actually verifies host keys by eye.';
        }
        r.appendChild(note);

        var why = el('p', 'quiz-result-body');
        why.appendChild(document.createTextNode('What to do instead: compare the whole ' +
          'string by pasting it, not by reading it; distribute known host keys through ' +
          'configuration management so the prompt never appears; or use an SSH ' +
          'certificate authority, so hosts are trusted by signature rather than by ' +
          'a human squinting at base64.'));
        r.appendChild(why);

        var more = el('p', 'quiz-more');
        var a = el('a', null, 'Compute a real fingerprint in the SSH key inspector');
        a.href = '/labs/ssh-keys';
        more.appendChild(a);
        r.appendChild(more);

        board.appendChild(r);
        g.over({ score: score });
      }

      return {
        reset: function () {
          score = 0; wrong = 0; streak = 0; best = 0;
          hard = { asked: 0, right: 0 };
          running = true;
          locked = false;
          remain = ROUND_MS;
          build();
          g.stat('score', 0);
          g.stat('streak', 0);
          g.stat('time', '60');
          deal();
        },

        /* The shell maps only the arrows, space, Enter and Escape before
           calling this, so a letter never arrives here — S and D are bound
           separately below. Left and right are the arrow equivalents and are
           what the on-screen pad would send. */
        key: function (name) {
          if (name === 'left') answer(true);
          else if (name === 'right') answer(false);
        },

        /* The clock counts DOWN THE STEPS the shell hands over, rather than
           reading Date.now(). The first version used a wall-clock deadline,
           which is wrong for two reasons that only appear once somebody plays
           it properly: this game sets pauseOnBlur, so a player who switches
           tabs comes back to a deadline that kept running while the game was
           frozen, and requestAnimationFrame does not fire in a hidden tab at
           all — so the round would silently lose every second spent away.
           Accumulating dt makes the clock measure time the player actually
           had. */
        update: function (dt) {
          if (!running) return;
          remain -= dt * 1000;
          if (remain <= 0) { remain = 0; finish(); return; }
          g.stat('time', Math.ceil(remain / 1000));
          if (timeBar) timeBar.style.width = Math.max(0, (remain / ROUND_MS) * 100) + '%';
        }
      };
    }
  });
})();

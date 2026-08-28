/* ==========================================================================
   memory.js — match the pairs, on three board sizes.
   --------------------------------------------------------------------------
   SHAPE IS THE IDENTITY, COLOUR IS ONLY REINFORCEMENT. A pair is two cards
   carrying the same silhouette; the colour is there to make scanning faster
   for people who can use it, and it is never the thing that decides a match.
   That is not a nicety — fifteen mutually distinguishable colours do not
   exist for a red-green colour-blind player, so a game whose pairs were
   "the two orange ones" would be a different, much harder game for roughly
   one man in twelve. The allocation follows from that: each shape owns one
   of eight colours, the shapes are grouped by colour, and a board of six or
   eight pairs is dealt one shape per group, so no colour ever appears twice.
   Only the fifteen-pair board reuses colours, and the shapes that share one
   are chosen to look nothing alike (a disc and a crescent, never a plus and
   a saltire).

   THE FLIP-BACK DELAY RUNS ON THE GAME CLOCK, NOT ON setTimeout. A mismatched
   pair stays visible for 0.9 s of update(dt), which the shell stops feeding
   the moment the tab is hidden or the window loses focus. With a timer the
   cards would flip themselves back while nobody was looking and the player
   would return to a board that had silently moved on; on the accumulator the
   peek and the clock can never disagree about how long you actually saw.

   BESTS ARE PER SIZE, so the shell's single best slot is repointed rather
   than duplicated: changing the board size rewrites g.bestKey and rereads
   g.best. Everything downstream — the comparison, the write, the "New best"
   badge on the end screen — then keeps working and stays correct, which it
   would not if this file kept its own records beside a shell record that
   compared a six-pair run against a fifteen-pair one.
   ========================================================================== */

(function () {
  'use strict';

  /* Based on the Okabe-Ito colour-blind-safe set. The two darkest entries
     (black and #0072B2) are swapped for white and a violet, because the card
     face is dark and those two disappeared into it. */
  var PALETTE = [
    '#e69f00', '#56b4e9', '#00b389', '#f0e442',
    '#cc79a7', '#d55e00', '#f8fafc', '#a78bfa'
  ];

  var COLOUR_NAME = [
    'amber', 'sky blue', 'green', 'yellow',
    'pink', 'vermillion', 'white', 'violet'
  ];

  /* Fifteen silhouettes, all drawn in a 24x24 box so they sit at the same
     visual weight. colour indexes PALETTE; the pairing is arranged so the
     two shapes sharing a colour are never near-rotations of each other. */
  var SHAPES = [
    { name: 'disc', colour: 0, art: '<circle cx="12" cy="12" r="8.6"/>' },
    { name: 'square', colour: 1, art: '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="1.6"/>' },
    { name: 'triangle', colour: 2, art: '<path d="M12 3 21.2 20.4H2.8z"/>' },
    { name: 'diamond', colour: 3, art: '<path d="M12 2.4 21.6 12 12 21.6 2.4 12z"/>' },
    { name: 'star', colour: 4, art: '<path d="M12 2.4l2.8 6.5 7 .6-5.3 4.7 1.6 6.9L12 17.4l-6.1 3.7 1.6-6.9L2.2 9.5l7-.6z"/>' },
    { name: 'heart', colour: 5, art: '<path d="M12 20.8S3.2 14.9 3.2 9.2A4.8 4.8 0 0 1 12 6.5a4.8 4.8 0 0 1 8.8 2.7c0 5.7-8.8 11.6-8.8 11.6z"/>' },
    { name: 'plus', colour: 6, art: '<path d="M9.4 2.8h5.2v6.6h6.6v5.2h-6.6v6.6H9.4v-6.6H2.8V9.4h6.6z"/>' },
    { name: 'hexagon', colour: 7, art: '<path d="M12 2.4 20.3 7.2v9.6L12 21.6 3.7 16.8V7.2z"/>' },
    { name: 'crescent', colour: 0, art: '<path d="M15 2.5a9.5 9.5 0 1 0 0 19 12 12 0 0 1 0-19z"/>' },
    { name: 'ring', colour: 1, art: '<path fill-rule="evenodd" d="M12 2.9a9.1 9.1 0 1 1 0 18.2 9.1 9.1 0 0 1 0-18.2zm0 4.6a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/>' },
    { name: 'hourglass', colour: 2, art: '<path d="M3.6 3h16.8l-6.7 9 6.7 9H3.6l6.7-9z"/>' },
    { name: 'bolt', colour: 3, art: '<path d="M13.8 2 4.8 13.9h5.3L9.3 22 19.2 9.8h-5.9z"/>' },
    { name: 'droplet', colour: 4, art: '<path d="M12 2.4c4.6 5.3 6.7 8.4 6.7 11.3a6.7 6.7 0 0 1-13.4 0c0-2.9 2.1-6 6.7-11.3z"/>' },
    { name: 'chevron', colour: 5, art: '<path d="M12 3.2 21.8 13l-3.3 3.3L12 9.8l-6.5 6.5L2.2 13z"/>' },
    { name: 'saltire', colour: 7, art: '<path d="M4.9 1.9 12 9l7.1-7.1 3.1 3.1L15.1 12l7.1 7.1-3.1 3.1L12 15.1l-7.1 7.1-3.1-3.1L8.9 12 1.8 4.9z"/>' }
  ];

  var SIZES = {
    small: { cols: 4, rows: 3, label: '4 by 3' },
    medium: { cols: 4, rows: 4, label: '4 by 4' },
    large: { cols: 6, rows: 5, label: '6 by 5' }
  };

  /* Long enough to read two shapes you were not expecting, short enough that
     a run of misses does not feel like waiting for a page to load. */
  var PEEK = 0.9;

  /* One point per move, one per five seconds. The exchange rate is arbitrary
     and there is no defending a particular number — it exists so that being
     slow and being careless cost something on the same scale instead of
     being two records nobody can compare. */
  var SECONDS_PER_POINT = 5;

  function groupsByColour() {
    var groups = [];
    var byIndex = {};
    for (var i = 0; i < SHAPES.length; i++) {
      var c = SHAPES[i].colour;
      if (byIndex[c] == null) { byIndex[c] = groups.length; groups.push([]); }
      groups[byIndex[c]].push(i);
    }
    return groups;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function clock(secs) {
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  GameShell.define({
    id: 'game-memory',
    slug: 'memory',
    title: 'Memory',
    bestKey: 'memory',
    bestOrder: 'low',
    formatBest: function (n) { return String(n); },
    startTitle: 'Memory',
    startText: 'Turn over two cards. Same shape, they stay up. Fewer moves and less time is a better score.',

    setup: function (g) {
      var boardEl = g.board;
      var size = 'medium';
      var cols = 4, rows = 4;
      var cards = [];           // { shape, up, done }
      var buttons = [];
      var faces = [];           // the span inside each button
      var painted = [];         // which shape each face currently shows, or -1
      var upList = [];
      var moves = 0;
      var elapsed = 0;
      var started = false;
      var peek = 0;
      var statusEl = null;

      var sizeSel = document.getElementById('game-size');
      var newBtn = document.getElementById('game-new');

      if (sizeSel) {
        size = g.load('size', 'medium');
        if (!SIZES[size]) size = 'medium';
        sizeSel.value = size;
        sizeSel.addEventListener('change', function () {
          size = SIZES[sizeSel.value] ? sizeSel.value : 'medium';
          g.save('size', size);
          g.start();
        });
      }
      if (newBtn) newBtn.addEventListener('click', function () { g.start(); });

      /* Point the shell's best machinery at this size's record. See the
         header: one slot, three boards, and a score that means nothing
         across them. */
      function retargetBest() {
        g.bestKey = 'memory.' + size;
        g.best = Number(GameShell.read(g.bestKey + '.best', 0)) || 0;
        g.stat('best', g.best ? g.best : '—');
      }

      function say(text) {
        if (statusEl) statusEl.textContent = text;
      }

      /* Deal one shape per pair. Under nine pairs every shape comes from a
         different colour group, so the board carries no repeated colour at
         all; the fifteen-pair board uses every shape and therefore repeats
         seven of the eight. */
      function pickShapes(pairs) {
        if (pairs >= SHAPES.length) {
          var all = [];
          for (var i = 0; i < SHAPES.length; i++) all.push(i);
          return all;
        }
        var groups = shuffle(groupsByColour());
        var out = [];
        for (var gi = 0; gi < pairs; gi++) {
          var group = groups[gi];
          out.push(group[Math.floor(Math.random() * group.length)]);
        }
        return out;
      }

      function deal() {
        var cfg = SIZES[size] || SIZES.medium;
        cols = cfg.cols;
        rows = cfg.rows;
        var pairs = (cols * rows) / 2;
        var chosen = pickShapes(pairs);
        var deck = [];
        for (var i = 0; i < chosen.length; i++) { deck.push(chosen[i]); deck.push(chosen[i]); }
        shuffle(deck);
        cards = [];
        for (var c = 0; c < deck.length; c++) cards.push({ shape: deck[c], up: false, done: false });
      }

      function label(i) {
        var card = cards[i];
        var where = 'Row ' + (Math.floor(i / cols) + 1) + ', column ' + (i % cols + 1);
        if (!card.up && !card.done) return where + ', face down';
        var shape = SHAPES[card.shape];
        var face = COLOUR_NAME[shape.colour] + ' ' + shape.name;
        return where + ', ' + face + (card.done ? ', matched' : '');
      }

      function build() {
        boardEl.innerHTML = '';
        boardEl.className = 'game-board board-memory';
        boardEl.setAttribute('data-size', size);
        boardEl.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
        boardEl.setAttribute('role', 'group');
        boardEl.setAttribute('aria-label', 'Memory board, ' + (SIZES[size] || SIZES.medium).label);

        buttons = [];
        faces = [];
        painted = [];

        for (var i = 0; i < cards.length; i++) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'mem-card';
          btn.setAttribute('data-i', String(i));
          var face = document.createElement('span');
          face.className = 'mem-face';
          face.setAttribute('aria-hidden', 'true');
          btn.appendChild(face);
          boardEl.appendChild(btn);
          buttons.push(btn);
          faces.push(face);
          painted.push(-1);
        }

        statusEl = document.createElement('p');
        statusEl.className = 'sr-only';
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        boardEl.appendChild(statusEl);
      }

      /* The face markup is written only when a card is actually turned over,
         and cleared when it goes back down. A face-down card therefore has
         nothing in it to read — in the accessibility tree or in the DOM. */
      function paintFace(i) {
        var card = cards[i];
        var want = (card.up || card.done) ? card.shape : -1;
        if (painted[i] === want) return;
        painted[i] = want;
        if (want < 0) { faces[i].innerHTML = ''; faces[i].style.color = ''; return; }
        var shape = SHAPES[want];
        faces[i].style.color = PALETTE[shape.colour];
        faces[i].innerHTML =
          '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" ' +
          'aria-hidden="true" focusable="false">' + shape.art + '</svg>';
      }

      function render() {
        for (var i = 0; i < buttons.length; i++) {
          var card = cards[i];
          var cls = 'mem-card';
          if (card.done) cls += ' is-done';
          else if (card.up) cls += ' is-up';
          if (buttons[i].className !== cls) buttons[i].className = cls;
          paintFace(i);
          buttons[i].setAttribute('aria-label', label(i));
          /* Matched cards leave the tab order: there is nothing left to do
             to them and stepping through eleven dead buttons to reach a live
             one is how keyboard play stops being worth it. */
          if (buttons[i].disabled !== card.done) buttons[i].disabled = card.done;
        }
      }

      /* Called after a match disables the card that had focus. Without it
         focus falls back to the document and the arrow keys stop working
         halfway through a run. */
      function rescueFocus(from) {
        /* The guard that used to stand here asked whether the ACTIVE element was
           disabled — and by the time this runs it never is. render() has
           already set disabled on the matched card, which makes the browser
           blur it, so document.activeElement is <body>; body.disabled is
           undefined, the guard read that as "something fine has focus" and
           returned without rescuing anything. It failed in precisely the case
           the comment above says it exists for.

           Whether the disabled card held focus is now decided by the caller,
           BEFORE render() blurs it, which is the only place the question can
           still be answered. */
        var next = nextPlayable(from);
        if (next >= 0) { try { buttons[next].focus({ preventScroll: true }); } catch (err) { buttons[next].focus(); } }
      }

      function nextPlayable(from) {
        for (var step = 1; step <= cards.length; step++) {
          var i = (from + step) % cards.length;
          if (!cards[i].done) return i;
        }
        return -1;
      }

      function hidePeeked() {
        for (var i = 0; i < upList.length; i++) cards[upList[i]].up = false;
        upList = [];
        peek = 0;
        render();
      }

      function flip(i) {
        if (g.state !== 'playing') return;
        var card = cards[i];
        if (card.done || card.up) return;

        /* A third card while a mismatch is still showing resolves it at once
           rather than being swallowed. Making the player wait out the peek
           punishes exactly the people who already know what they saw. */
        if (peek > 0) hidePeeked();

        card.up = true;
        upList.push(i);
        started = true;
        g.beep(430 + upList.length * 90, 0.04, 'sine', 0.04);

        if (upList.length === 2) {
          moves++;
          g.stat('moves', moves);
          var a = cards[upList[0]], b = cards[upList[1]];
          if (a.shape === b.shape) {
            a.done = true; b.done = true;
            var focused = upList[1];
            /* Read before render(): render() is what disables the card and
               therefore what destroys the answer. */
            var hadFocus = document.activeElement === buttons[focused];
            upList = [];
            render();
            if (hadFocus) rescueFocus(focused);
            g.beep(720, 0.06, 'sine');
            g.beep(960, 0.07, 'sine');
            say('Match: two ' + SHAPES[a.shape].name + 's.');
            found();
            return;
          }
          peek = PEEK;
          say('No match: ' + SHAPES[a.shape].name + ' and ' + SHAPES[b.shape].name + '.');
          g.beep(190, 0.08, 'square', 0.05);
        }
        render();
      }

      function pairsDone() {
        var n = 0;
        for (var i = 0; i < cards.length; i++) if (cards[i].done) n++;
        return n / 2;
      }

      function found() {
        var done = pairsDone();
        var total = cards.length / 2;
        g.stat('pairs', done + '/' + total);
        if (done < total) return;

        var secs = Math.floor(elapsed);
        var score = moves + Math.floor(secs / SECONDS_PER_POINT);
        g.over({
          won: true,
          score: score,
          title: 'Cleared',
          message: total + ' pairs in ' + moves + ' moves and ' + clock(secs) + ' — ' + score +
            ' points, on the ' + (SIZES[size] || SIZES.medium).label + ' board. The minimum possible is ' +
            total + ' moves.'
        });
      }

      /* Arrow keys move between cards. This has to live here rather than in
         the shell: the shell ignores any keystroke whose target is a button,
         which is right — a button's keys are its own business — so a grid
         built out of real buttons has to do its own two-dimensional walk. */
      boardEl.addEventListener('keydown', function (event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        var btn = event.target;
        if (!btn || !btn.getAttribute || btn.className.indexOf('mem-card') !== 0) return;
        var i = Number(btn.getAttribute('data-i'));
        var x = i % cols, y = Math.floor(i / cols);
        if (event.key === 'ArrowRight') x = (x + 1) % cols;
        else if (event.key === 'ArrowLeft') x = (x - 1 + cols) % cols;
        else if (event.key === 'ArrowDown') y = (y + 1) % rows;
        else if (event.key === 'ArrowUp') y = (y - 1 + rows) % rows;
        else return;
        event.preventDefault();
        var target = buttons[y * cols + x];
        if (target && !target.disabled) { try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); } }
      });

      boardEl.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('.mem-card') : null;
        if (!btn) return;
        flip(Number(btn.getAttribute('data-i')));
      });

      return {
        reset: function () {
          if (sizeSel && SIZES[sizeSel.value]) size = sizeSel.value;
          moves = 0;
          elapsed = 0;
          started = false;
          peek = 0;
          upList = [];
          deal();
          build();
          render();
          retargetBest();
          g.stat('moves', 0);
          g.stat('time', '0:00');
          g.stat('pairs', '0/' + (cards.length / 2));
          say('New board dealt: ' + (cards.length / 2) + ' pairs.');
        },

        /* Arrows pressed while the board itself holds focus — which is where
           the shell puts focus when a run starts — hand over to the cards. */
        key: function (name) {
          if (name !== 'up' && name !== 'down' && name !== 'left' && name !== 'right') return;
          if (document.activeElement !== boardEl) return;
          var first = nextPlayable(cards.length - 1);
          if (first >= 0) { try { buttons[first].focus({ preventScroll: true }); } catch (err) { buttons[first].focus(); } }
        },

        update: function (dt) {
          /* The clock starts on the first card, not on Play, so reading the
             board before you commit to it costs nothing. */
          if (started) {
            var was = Math.floor(elapsed);
            elapsed += dt;
            if (Math.floor(elapsed) !== was) g.stat('time', clock(elapsed));
          }
          if (peek > 0) {
            peek -= dt;
            if (peek <= 0) hidePeeked();
          }
        }
      };
    }
  });
})();

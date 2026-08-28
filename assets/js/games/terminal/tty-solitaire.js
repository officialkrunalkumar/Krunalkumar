/* ==========================================================================
   tty-solitaire.js — Klondike, on a character grid.
   --------------------------------------------------------------------------
   The rules are the ordinary ones and are not the interesting part. Three
   decisions about fitting a card game into five inputs and 72x24 cells are.

   1. THE CURSOR CARRIES A DEPTH, AND UP DOES TWO JOBS. A card game needs a
      two-dimensional selection — which pile, and how far down it you are
      grabbing — but the shell only ever sends up, down, left, right and
      action. So inside a tableau pile, up walks the cursor down into the
      face-up cards (grabbing a longer run with each press) and only leaves
      for the stock and foundations once the run is as long as the face-up
      cards allow. Mapping up straight to "go to the top row" would make
      moving anything but a single card impossible without a letter key,
      and there are no letter keys here by design.

   2. LONG PILES COMPRESS THEIR FACE-DOWN RUN. A tableau pile can reach
      nineteen cards — six face down and a full king-to-ace run on top —
      and there are only seventeen rows under the foundations. When a pile
      will not fit, the face-down cards collapse to one row reading [##6].
      Only they are ever compressed, because a face-down card carries no
      information except that it is there, whereas hiding a face-up one
      would hide a legal move.

   3. AUTO-PLAY ONLY SENDS SAFE CARDS. The button uses the standard safety
      rule: a card is safe once both opposite-colour foundations have
      reached one rank below it and the other same-colour foundation is
      within two. Under that rule the card can never be needed again to
      take a lower card in the tableau, so the button cannot lose you a
      game it would otherwise have won. Sending everything that merely
      fits is the usual shortcut and it quietly costs you runs.

   The foundations are fixed one to a suit rather than first-come. Nothing
   is lost — four suits, four piles — and it buys an empty foundation that
   can say which suit it is waiting for.
   ========================================================================== */

(function () {
  'use strict';

  /* Cell geometry. term-shell.js draws 8x16 logical units per cell; the
     pointer handler below has to undo that to find which card was hit. */
  var CW = 8;
  var CH = 16;

  var COLS = 72;
  var ROWS = 24;

  /* Seven columns five cells wide, nine apart, which leaves a free cell to
     the left of every card for the cursor marker. */
  var COLX = [6, 15, 24, 33, 42, 51, 60];
  var TOPY = 2;                 // stock, waste and the four foundations
  var LABELY = 3;
  var TABY = 6;                 // first row of the tableau
  var HINTY = ROWS - 1;
  var MAXROWS = HINTY - TABY;   // rows a single pile may occupy

  /* The top row sits over columns 0, 1, 3, 4, 5, 6 — the classic layout,
     with the gap where the deal used to be dealt from. */
  var TOPCOL = [0, 1, 3, 4, 5, 6];
  /* Leaving tableau column c upwards lands on this top-row slot. Column 2
     has nothing above it, so it borrows the waste. */
  var UPMAP = [0, 1, 1, 2, 3, 4, 5];

  var SUITS = ['♠', '♥', '♦', '♣'];
  var SUITNAME = ['spades', 'hearts', 'diamonds', 'clubs'];
  var RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var LEGEND = 'arrows move · action picks up and places · action on the deck deals';

  function isRed(suit) { return suit === 1 || suit === 2; }

  TermShell.define({
    id: 'game-tty-solitaire',
    slug: 'tty-solitaire',
    title: 'TTY Solitaire',
    cols: COLS,
    rows: ROWS,
    startTitle: 'TTY Solitaire',
    startText: 'Klondike, draw one. Arrows move the cursor, action picks a card up and puts it down.',

    setup: function (g, t) {
      var stock = [];
      var waste = [];
      var found = [[], [], [], []];      // one per suit, index === suit
      var tab = [[], [], [], [], [], [], []];
      var cur = { row: 0, i: 0, depth: 0 };
      var sel = null;                    // { from: 'waste'|'found'|'tab', pile, depth }
      var moves = 0;
      var msg = '';
      var msgT = 0;

      /* --------------------------------------------------------------
         Toolbar
         -------------------------------------------------------------- */
      var dealBtn = document.getElementById('game-deal');
      var autoBtn = document.getElementById('game-auto');

      /* Focus goes back to the playfield after a click, or the next arrow
         key lands on the button and the game stops answering. */
      function refocus() {
        if (!g.canvas) return;
        try { g.canvas.focus({ preventScroll: true }); } catch (err) { g.canvas.focus(); }
      }

      if (dealBtn) {
        dealBtn.addEventListener('click', function () {
          if (g.state !== 'playing') return;
          sel = null;
          deal();
          refocus();
        });
      }

      if (autoBtn) {
        autoBtn.addEventListener('click', function () {
          autoPlay();
          refocus();
        });
      }

      /* --------------------------------------------------------------
         Dealing
         -------------------------------------------------------------- */
      function newDeal() {
        var deck = [];
        var s, r, i, j;
        for (s = 0; s < 4; s++) {
          for (r = 1; r <= 13; r++) deck.push({ r: r, s: s, up: false });
        }
        g.shuffle(deck);

        found = [[], [], [], []];
        tab = [[], [], [], [], [], [], []];
        waste = [];
        for (i = 0; i < 7; i++) {
          for (j = 0; j <= i; j++) tab[i].push(deck.pop());
          tab[i][i].up = true;
        }
        stock = deck;                    // the twenty-four that are left
      }

      function deal() {
        var c;
        if (stock.length) {
          c = stock.pop();
          c.up = true;
          waste.push(c);
          countMove();
          g.beep(420, 0.03, 'sine', 0.04);
        } else if (waste.length) {
          /* Popping the waste onto the stock reverses it, which is what
             keeps the second pass through the deck in the same order as
             the first. */
          while (waste.length) {
            c = waste.pop();
            c.up = false;
            stock.push(c);
          }
          countMove();
          say('The waste is back under the deck.');
          g.beep(260, 0.05, 'sine', 0.04);
        } else {
          bad('Nothing left to deal.');
        }
      }

      /* --------------------------------------------------------------
         Rules
         -------------------------------------------------------------- */
      function canFound(f, card) {
        return card.s === f && found[f].length === card.r - 1;
      }

      function canTab(c, card) {
        var p = tab[c];
        if (!p.length) return card.r === 13;          // only a king starts a column
        var top = p[p.length - 1];
        return top.up && top.r === card.r + 1 && isRed(top.s) !== isRed(card.s);
      }

      /* A run is movable only if it is already a proper descending
         alternating sequence. Play keeps piles that way, but a deal that
         flipped two cards at once would not, so it is checked rather than
         assumed. */
      function validRun(p, from) {
        for (var i = from; i < p.length - 1; i++) {
          if (!p[i].up) return false;
          if (p[i].r !== p[i + 1].r + 1) return false;
          if (isRed(p[i].s) === isRed(p[i + 1].s)) return false;
        }
        return p.length ? p[p.length - 1].up : false;
      }

      function firstUp(p) {
        for (var i = 0; i < p.length; i++) if (p[i].up) return i;
        return p.length;
      }

      /* See decision 3 in the header. */
      function safeToSend(card) {
        if (card.r <= 2) return true;
        var opp = isRed(card.s) ? [0, 3] : [1, 2];
        var same = isRed(card.s) ? (card.s === 1 ? 2 : 1) : (card.s === 0 ? 3 : 0);
        return found[opp[0]].length >= card.r - 1 &&
               found[opp[1]].length >= card.r - 1 &&
               found[same].length >= card.r - 2;
      }

      /* --------------------------------------------------------------
         Scoring and status
         -------------------------------------------------------------- */
      function addPts(n) {
        g.setScore(Math.max(0, g.score + n));
      }

      function homeCount() {
        return found[0].length + found[1].length + found[2].length + found[3].length;
      }

      function countMove() {
        moves++;
        g.stat('moves', moves);
        g.stat('home', homeCount() + '/52');
      }

      function say(text) { msg = text; msgT = 2.6; }

      function bad(text) {
        say(text);
        g.beep(150, 0.05, 'square', 0.03);
      }

      function flip(c) {
        var p = tab[c];
        if (!p.length) return;
        var top = p[p.length - 1];
        if (top.up) return;
        top.up = true;
        addPts(5);
        g.beep(740, 0.05, 'sine', 0.04);
      }

      function checkWin() {
        if (homeCount() !== 52) return;
        g.over({
          won: true,
          score: g.score,
          title: 'All fifty-two home',
          message: 'Solved in ' + moves + ' moves.'
        });
        /* over() stops the loop, so without one last paint the board behind
           the overlay would be the frame before the winning card landed. */
        if (g.render) g.render();
      }

      /* --------------------------------------------------------------
         Selection and movement
         -------------------------------------------------------------- */
      function selCards() {
        if (!sel) return [];
        if (sel.from === 'waste') return [waste[waste.length - 1]];
        if (sel.from === 'found') return [found[sel.pile][found[sel.pile].length - 1]];
        return tab[sel.pile].slice(sel.depth);
      }

      function lift(count) {
        if (sel.from === 'waste') return [waste.pop()];
        if (sel.from === 'found') return [found[sel.pile].pop()];
        return tab[sel.pile].splice(sel.depth, count);
      }

      function place(kind, idx) {
        var cards = selCards();
        var moved = lift(cards.length);
        var i;
        if (kind === 'found') {
          found[idx].push(moved[0]);
          addPts(10);
          g.beep(880, 0.06, 'sine', 0.05);
        } else {
          for (i = 0; i < moved.length; i++) tab[idx].push(moved[i]);
          if (sel.from === 'waste') addPts(5);
          else if (sel.from === 'found') addPts(-15);
          g.beep(660, 0.05, 'sine', 0.05);
        }
        if (sel.from === 'tab') flip(sel.pile);
        sel = null;
        countMove();
        clampDepth();
        checkWin();
      }

      function pickUp(from, pile, depth) {
        sel = { from: from, pile: pile, depth: depth };
        g.beep(520, 0.04, 'sine', 0.05);
      }

      function actStock() {
        /* The deck is never a destination, so a press here can only mean
           "give me a card" — whatever was held is put back down first. */
        sel = null;
        deal();
      }

      function actWaste() {
        if (!sel) {
          if (!waste.length) { bad('The waste is empty.'); return; }
          pickUp('waste', 0, 0);
          return;
        }
        if (sel.from === 'waste') { sel = null; return; }
        bad('Cards never go back to the waste.');
      }

      function actFound(f) {
        var cards;
        if (!sel) {
          if (!found[f].length) { bad('Nothing on the ' + SUITNAME[f] + ' yet — it starts with the ace.'); return; }
          pickUp('found', f, 0);
          return;
        }
        if (sel.from === 'found' && sel.pile === f) { sel = null; return; }
        cards = selCards();
        if (cards.length !== 1) { bad('A foundation takes one card at a time.'); return; }
        if (!canFound(f, cards[0])) {
          bad(found[f].length
            ? 'The ' + SUITNAME[f] + ' want the ' + RANKS[found[f].length + 1] + ' next.'
            : 'A foundation starts with an ace of its own suit.');
          return;
        }
        place('found', f);
      }

      function actTab(c) {
        var p = tab[c];
        var cards;
        if (!sel) {
          if (!p.length) { bad('That column is empty. Only a king can start one.'); return; }
          if (cur.depth >= p.length || !p[cur.depth].up) { bad('That card is face down.'); return; }
          if (!validRun(p, cur.depth)) { bad('Those cards are not an alternating run.'); return; }
          pickUp('tab', c, cur.depth);
          return;
        }
        if (sel.from === 'tab' && sel.pile === c) { sel = null; return; }
        cards = selCards();
        if (!canTab(c, cards[0])) {
          bad(p.length
            ? 'A ' + RANKS[cards[0].r] + SUITS[cards[0].s] + ' does not sit on that.'
            : 'Only a king can go into an empty column.');
          return;
        }
        place('tab', c);
      }

      function act() {
        if (cur.row === 0) {
          if (cur.i === 0) { actStock(); return; }
          if (cur.i === 1) { actWaste(); return; }
          actFound(cur.i - 2);
          return;
        }
        actTab(cur.i);
      }

      /* --------------------------------------------------------------
         Auto-play
         -------------------------------------------------------------- */
      function trySafe() {
        var c, i, p;
        if (waste.length) {
          c = waste[waste.length - 1];
          if (canFound(c.s, c) && safeToSend(c)) {
            waste.pop();
            found[c.s].push(c);
            return true;
          }
        }
        for (i = 0; i < 7; i++) {
          p = tab[i];
          if (!p.length) continue;
          c = p[p.length - 1];
          if (!c.up || !canFound(c.s, c) || !safeToSend(c)) continue;
          p.pop();
          found[c.s].push(c);
          flip(i);
          return true;
        }
        return false;
      }

      function autoPlay() {
        if (g.state !== 'playing') return;
        var n = 0;
        sel = null;
        while (n < 52 && trySafe()) {
          n++;
          addPts(10);
          countMove();
        }
        if (!n) { bad('No card can go home safely yet.'); return; }
        say(n === 1 ? 'One card sent home.' : n + ' cards sent home.');
        g.beep(880, 0.07, 'sine', 0.05);
        clampDepth();
        checkWin();
      }

      /* --------------------------------------------------------------
         Cursor
         -------------------------------------------------------------- */
      function clampDepth() {
        if (cur.row !== 1) return;
        var p = tab[cur.i];
        cur.depth = p.length ? p.length - 1 : 0;
      }

      function moveCursor(name) {
        var p;
        if (name === 'left' || name === 'right') {
          var d = name === 'left' ? -1 : 1;
          if (cur.row === 0) cur.i = (cur.i + 6 + d) % 6;
          else cur.i = (cur.i + 7 + d) % 7;
          clampDepth();
          return;
        }
        if (name === 'up') {
          if (cur.row === 0) return;
          p = tab[cur.i];
          /* Deeper into the pile first, and out to the top row only when
             the whole face-up run is already held — decision 1. */
          if (p.length && cur.depth > firstUp(p)) { cur.depth--; return; }
          cur.row = 0;
          cur.i = UPMAP[cur.i];
          return;
        }
        if (cur.row === 0) {
          cur.row = 1;
          cur.i = TOPCOL[cur.i];
          clampDepth();
          return;
        }
        p = tab[cur.i];
        if (p.length && cur.depth < p.length - 1) cur.depth++;
      }

      /* --------------------------------------------------------------
         Layout: which row each card in a pile is drawn on.
         -------------------------------------------------------------- */
      function layout(p) {
        var down = firstUp(p);
        var compress = p.length > MAXROWS && down > 1;
        var ys = [];
        for (var i = 0; i < p.length; i++) {
          if (compress) ys.push(i < down ? TABY : TABY + 1 + (i - down));
          else ys.push(TABY + i);
        }
        return { ys: ys, down: down, compress: compress };
      }

      /* --------------------------------------------------------------
         Pointer. This moves the CURSOR only and never acts: the shell's
         own stage tap fires 'action' on pointerup, so a click lands on
         whatever it was pointing at and a tap on a phone does the same.
         Acting here as well would fire twice.
         -------------------------------------------------------------- */
      function hit(cx, cy) {
        var c = Math.round((cx - COLX[0]) / 9);
        var j, p, L, best, k;
        if (c < 0) c = 0;
        if (c > 6) c = 6;
        if (cy <= TOPY + 2) {
          for (j = 0; j < 6; j++) if (TOPCOL[j] === c) return { row: 0, i: j, depth: 0 };
          return { row: 0, i: 1, depth: 0 };          // the gap above column 2
        }
        p = tab[c];
        if (!p.length) return { row: 1, i: c, depth: 0 };
        L = layout(p);
        best = Math.min(L.down, p.length - 1);
        for (k = best; k < p.length; k++) if (L.ys[k] <= cy) best = k;
        return { row: 1, i: c, depth: best };
      }

      if (g.stage) {
        g.stage.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing') return;
          if (event.target.closest && event.target.closest('button, a, input, select')) return;
          var pt = g.pointAt(event);
          var h = hit(Math.floor(pt.x / CW), Math.floor(pt.y / CH));
          cur.row = h.row;
          cur.i = h.i;
          cur.depth = h.depth;
        });
      }

      /* --------------------------------------------------------------
         Drawing
         -------------------------------------------------------------- */
      function slot(term, x, y, inner, colour, bracket) {
        term.put(x, y, '[', bracket);
        term.text(x + 1, y, inner, colour);
        term.put(x + 4, y, ']', bracket);
      }

      /* Three cells: a right-aligned rank so the ten does not shunt the
         suit out of line, then the suit. */
      function face(card) {
        var r = RANKS[card.r];
        return (r.length === 1 ? ' ' + r : r) + SUITS[card.s];
      }

      function drawCard(term, x, y, card, bracket) {
        if (!card.up) { slot(term, x, y, '###', 'dim', bracket); return; }
        slot(term, x, y, face(card), isRed(card.s) ? 'red' : 'white', bracket);
      }

      function topBracket(i) {
        if (cur.row === 0 && cur.i === i) return 'yellow';
        if (sel && sel.from === 'waste' && i === 1) return 'cyan';
        if (sel && sel.from === 'found' && sel.pile === i - 2) return 'cyan';
        return 'dim';
      }

      function draw(term) {
        var i, c, p, L, k, b, x, y;
        term.clear();

        term.text(2, 0, 'TTY SOLITAIRE', 'green');
        if (sel) {
          var held = selCards();
          term.text(20, 0, 'holding ' + face(held[0]).replace(/^ /, '') +
            (held.length > 1 ? ' and ' + (held.length - 1) + ' more' : ''), 'cyan');
        }

        /* Stock. Face down while there are cards; empty and re-dealable
           once there are not, which the label under it spells out. */
        b = topBracket(0);
        if (stock.length) slot(term, COLX[0], TOPY, '###', 'dim', b);
        else slot(term, COLX[0], TOPY, '   ', 'dark', b);
        term.text(COLX[0], LABELY,
          stock.length ? stock.length + ' left' : (waste.length ? 'redeal' : ''), 'dim');

        /* Waste. */
        b = topBracket(1);
        if (waste.length) drawCard(term, COLX[1], TOPY, waste[waste.length - 1], b);
        else slot(term, COLX[1], TOPY, '   ', 'dark', b);

        /* Foundations, one per suit, each empty one showing what it wants. */
        for (i = 0; i < 4; i++) {
          x = COLX[TOPCOL[i + 2]];
          b = topBracket(i + 2);
          if (found[i].length) drawCard(term, x, TOPY, found[i][found[i].length - 1], b);
          else slot(term, x, TOPY, '  ' + SUITS[i], 'dark', b);
        }

        term.rect(2, 4, COLS - 4, 1, '─', 'dim');

        /* Tableau. */
        for (c = 0; c < 7; c++) {
          x = COLX[c];
          p = tab[c];
          if (!p.length) {
            slot(term, x, TABY, '   ', 'dark',
              cur.row === 1 && cur.i === c ? 'yellow' : 'dim');
            continue;
          }
          L = layout(p);
          if (L.compress) slot(term, x, TABY, '##' + L.down, 'dim', 'dim');
          for (k = L.compress ? L.down : 0; k < p.length; k++) {
            b = 'dim';
            if (sel && sel.from === 'tab' && sel.pile === c && k >= sel.depth) b = 'cyan';
            if (cur.row === 1 && cur.i === c && k === cur.depth) b = 'yellow';
            drawCard(term, x, L.ys[k], p[k], b);
          }
        }

        /* The cursor marker, in the free cell to the left of the card. */
        if (cur.row === 0) {
          term.put(COLX[TOPCOL[cur.i]] - 1, TOPY, '>', 'yellow');
        } else {
          p = tab[cur.i];
          y = TABY;
          if (p.length) {
            L = layout(p);
            y = L.ys[Math.min(cur.depth, p.length - 1)];
          }
          term.put(COLX[cur.i] - 1, y, '>', 'yellow');
        }

        term.text(2, HINTY, msgT > 0 ? msg : LEGEND, msgT > 0 ? 'yellow' : 'dim');
      }

      return {
        reset: function () {
          newDeal();
          sel = null;
          moves = 0;
          msg = '';
          msgT = 0;
          cur = { row: 0, i: 0, depth: 0 };
          g.stat('moves', 0);
          g.stat('home', '0/52');
        },

        key: function (name) {
          if (name === 'action') act();
          else moveCursor(name);
        },

        update: function (dt) {
          if (msgT > 0) msgT -= dt;
        },

        draw: draw
      };
    }
  });
})();

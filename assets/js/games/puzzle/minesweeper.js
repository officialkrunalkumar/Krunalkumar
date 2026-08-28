/* ==========================================================================
   minesweeper.js — Minesweeper with a guaranteed safe first click.
   --------------------------------------------------------------------------
   THE BOARD IS EMPTY UNTIL YOU OPEN IT. Mines are scattered on the first
   click, avoiding that cell AND its eight neighbours, so the opening move
   always reveals a region rather than ending the game. The original Windows
   version killed you on click one for years; every modern implementation
   does it this way, and it costs a single shuffle.

   Chording — clicking a revealed number that already carries exactly that
   many flags opens every remaining neighbour — is implemented because it is
   the whole skill of the game at speed. It will also happily detonate you
   if one of those flags is wrong, which is the point.

   Best times are kept PER DIFFICULTY, so the shell's single best-score slot
   is not used (bestKey is null in the manifest) and this file owns three
   separate records instead.

   EVERY CELL IS A REAL BUTTON, AND EXACTLY ONE OF THEM IS A TAB STOP. The
   button is the right element — a thing you click ought to be one, and it
   brings a focus ring, an accessible name and activation from Space and
   Enter with it — but leaving all of them tabbable, which is what this file
   did, puts 480 stops on an expert board between the toolbar and everything
   below it. Worse, all 480 were dead: the shell deliberately withholds Space
   and Enter from a focused <button>, on the grounds that activating a button
   is that button's own business, and this file listened for pointer events
   only. Focusable, interactive-looking, and answering nothing.

   So the board is walked with a cursor. Every cell carries tabindex -1
   except the one under the cursor, which carries 0 and is the single stop
   for the whole grid; the arrows move it, and the shell passes arrow keys
   through from a focused button precisely so that a grid built out of
   buttons can be walked. Space opens, arriving here as the browser's own
   activation of the focused cell. Enter flags, because a keyboard needs an
   equivalent of the right-click this game's whole flagging model rests on,
   and it is cancelled on keydown — left alone it would activate the button
   as well, and every flag would be followed by opening the cell under it.
   ========================================================================== */

(function () {
  'use strict';

  var LEVELS = {
    beginner: { w: 9, h: 9, mines: 10 },
    intermediate: { w: 16, h: 16, mines: 40 },
    expert: { w: 30, h: 16, mines: 99 }
  };

  var NUM_COLOR = {
    1: '#60a5fa', 2: '#4ade80', 3: '#f87171', 4: '#c084fc',
    5: '#fb923c', 6: '#22d3ee', 7: '#e2e8f0', 8: '#94a3b8'
  };

  GameShell.define({
    id: 'game-minesweeper',
    slug: 'minesweeper',
    /* The shell's single best slot is not used: this game keeps a best time
       per difficulty of its own, and the shell's slot has one number and no
       idea which level it came from.

       It must be written HERE, not only in the manifest. The shell reads
       'spec.bestKey === null ? null : (spec.bestKey || this.slug)', and
       leaving it off the spec makes it undefined rather than null — so the
       slot switched itself back on with bestOrder defaulting to 'high'.
       Since over() is handed a completion time in SECONDS, higher scored as
       better: a 55-second clear overwrote an 18-second one and lit up the
       'New best' badge on the player's slowest game of the day. The file
       header said this slot was off. It has not been off. */
    bestKey: null,
    title: 'Minesweeper',
    startTitle: 'Minesweeper',
    /* The keys are named here because the page's own control list is written
       for the mouse, and a keyboard player has no other way to learn that
       Enter is the flag. */
    startText: 'Click to open a cell, right-click to flag. On a keyboard the arrows move, Space opens and Enter flags. Your first click can never be a mine.',

    setup: function (g) {
      var level = 'beginner';
      var W = 9, H = 9, MINES = 10;
      var mine = [];          // bool per cell
      var open = [];          // bool per cell
      var flag = [];          // bool per cell
      var counts = [];        // adjacent mine count per cell
      var laid = false;       // have the mines been placed yet
      var elapsed = 0;
      var flagMode = false;
      var cellsEl = [];
      var boardEl = g.board;
      var cursor = 0;         // the cell the keyboard is sitting on
      var labels = [];        // last aria-label written per cell, to diff against
      var statusEl = null;    // sr-only live region for what focus cannot say
      /* Raised whenever the press that a click is about to arrive for has
         already been answered: by pointerdown, whose work is finished on
         pointerup, or by an Enter, whose activation of the button is
         cancelled but is not worth betting a flagged mine on. Lowered by that
         click, or by the next key on a cell. */
      /* When the last press was already served, as a TIMESTAMP rather than a
         flag. A flag could be raised by a gesture that never produces a
         click — a right-click yields contextmenu and nothing else — and then
         sat armed indefinitely, swallowing the next pointer-less activation.
         That is a click with no finger behind it: a screen reader's "press
         this", Voice Control, switch access, element.click(). Precisely the
         people this keyboard work is for would have found a cell that needed
         pressing twice. A real click follows its press within a few
         milliseconds, so anything older than the window below was never the
         click this guard was raised for. */
      var SPENT_MS = 700;
      var clickSpentAt = 0;

      var levelSel = document.getElementById('game-level');
      var flagBtn = document.getElementById('game-flag');
      var newBtn = document.getElementById('game-new');

      if (levelSel) {
        level = g.load('level', 'beginner');
        if (!LEVELS[level]) level = 'beginner';
        levelSel.value = level;
        levelSel.addEventListener('change', function () {
          level = levelSel.value;
          g.save('level', level);
          g.start();
        });
      }
      if (flagBtn) {
        flagBtn.addEventListener('click', function () {
          flagMode = !flagMode;
          flagBtn.setAttribute('aria-pressed', String(flagMode));
          flagBtn.title = flagMode ? 'Flag mode on — tap to flag' : 'Flag mode (or long-press a cell)';
        });
      }
      if (newBtn) newBtn.addEventListener('click', function () { g.start(); });

      function idx(x, y) { return y * W + x; }
      function inside(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }

      function neighbours(i) {
        var x = i % W, y = Math.floor(i / W), out = [];
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (inside(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
          }
        }
        return out;
      }

      /* Mines everywhere except `safe` and its neighbours. Shuffling the
         list of legal positions is O(n) and never retries — the naive
         "pick a cell, try again if taken" loop degenerates badly on expert,
         where 99 of 480 cells are mines. */
      function layMines(safe) {
        var banned = {};
        banned[safe] = true;
        var near = neighbours(safe);
        for (var n = 0; n < near.length; n++) banned[near[n]] = true;

        var pool = [];
        for (var i = 0; i < W * H; i++) if (!banned[i]) pool.push(i);
        for (var s = pool.length - 1; s > 0; s--) {
          var j = Math.floor(Math.random() * (s + 1));
          var t = pool[s]; pool[s] = pool[j]; pool[j] = t;
        }
        var count = Math.min(MINES, pool.length);
        for (var m = 0; m < count; m++) mine[pool[m]] = true;

        for (var c = 0; c < W * H; c++) {
          if (mine[c]) { counts[c] = -1; continue; }
          var near2 = neighbours(c);
          var k = 0;
          for (var q = 0; q < near2.length; q++) if (mine[near2[q]]) k++;
          counts[c] = k;
        }
        laid = true;
      }

      /* Flood fill from a zero cell. Iterative, not recursive: expert can
         open several hundred cells at once and a recursive fill would put
         that on the JS stack for no reason. */
      function reveal(i) {
        if (open[i] || flag[i]) return;
        var stack = [i];
        while (stack.length) {
          var cur = stack.pop();
          if (open[cur] || flag[cur]) continue;
          open[cur] = true;
          if (counts[cur] === 0) {
            var near = neighbours(cur);
            for (var n = 0; n < near.length; n++) {
              if (!open[near[n]] && !flag[near[n]]) stack.push(near[n]);
            }
          }
        }
      }

      function flagsAround(i) {
        var near = neighbours(i), k = 0;
        for (var n = 0; n < near.length; n++) if (flag[near[n]]) k++;
        return k;
      }

      function openCount() {
        var n = 0;
        for (var i = 0; i < W * H; i++) if (open[i]) n++;
        return n;
      }

      /* What a screen reader hears on the cell under the cursor. The position
         leads because it is the one thing the sighted player gets for free
         and the one thing the content cannot carry: a lone "3" says nothing
         about where you are on a board thirty columns wide. */
      function cellLabel(i) {
        var where = 'Row ' + (Math.floor(i / W) + 1) + ', column ' + (i % W + 1);
        if (flag[i] && !open[i]) return where + ', flagged';
        if (!open[i]) return where + ', covered';
        if (mine[i]) return where + ', mine';
        if (counts[i] > 0) return where + ', ' + counts[i] + (counts[i] === 1 ? ' mine nearby' : ' mines nearby');
        return where + ', empty';
      }

      /* Anything a move does BEYOND the cell you are standing on. Moving the
         cursor announces itself, because focus lands on a labelled button and
         the browser reads it out; a flood that opened forty cells, or the
         mine count going down, has nothing focus can say about it. */
      function say(text) {
        if (statusEl) statusEl.textContent = text;
      }

      /* Move the cursor, and with it the single cell that is in the tab
         order. `focusIt` is false on the pointer paths: the browser is
         already deciding where focus goes on a press — and on Safari it
         decides not to move it onto a button at all — so calling focus()
         into the middle of that is a fight with no prize. It is true on the
         arrow keys, which is what makes the cursor visible, since the ring
         is the cell's own :focus-visible and nothing else draws one. */
      function setCursor(i, focusIt) {
        if (i < 0 || i >= cellsEl.length) return;
        if (cursor !== i && cellsEl[cursor]) cellsEl[cursor].setAttribute('tabindex', '-1');
        cursor = i;
        cellsEl[i].setAttribute('tabindex', '0');
        if (!focusIt) return;
        try { cellsEl[i].focus({ preventScroll: true }); } catch (err) { cellsEl[i].focus(); }
      }

      /* One open can turn over four hundred cells, and the only thing focus
         can report is the cell that was pressed, so the size of what just
         happened is said out loud instead. */
      function announceOpen(i, before) {
        var opened = openCount() - before;
        say(cellLabel(i) + (opened > 1 ? '. ' + opened + ' cells opened.' : '.'));
      }

      function click(i) {
        if (g.state !== 'playing') return;
        var before = openCount();
        if (!laid) layMines(i);

        if (flag[i]) return;

        /* Chording: an already-open number with its full complement of
           flags opens everything else around it. */
        if (open[i]) {
          if (counts[i] > 0 && flagsAround(i) === counts[i]) {
            var near = neighbours(i);
            for (var n = 0; n < near.length; n++) {
              if (!flag[near[n]] && !open[near[n]]) {
                if (mine[near[n]]) { boom(near[n]); return; }
                reveal(near[n]);
              }
            }
            announceOpen(i, before);
            render();
            checkWin();
          }
          return;
        }

        if (mine[i]) { boom(i); return; }
        reveal(i);
        g.beep(520, 0.03, 'sine', 0.03);
        announceOpen(i, before);
        render();
        checkWin();
      }

      function toggleFlag(i) {
        if (g.state !== 'playing' || open[i]) return;
        flag[i] = !flag[i];
        g.beep(flag[i] ? 700 : 380, 0.04, 'sine', 0.04);
        render();
        say(cellLabel(i) + '. ' + updateMineCount() + ' unflagged.');
      }

      function boom(i) {
        open[i] = true;
        for (var c = 0; c < W * H; c++) if (mine[c]) open[c] = true;
        render();
        g.over({ message: 'Mine at ' + (i % W + 1) + ', ' + (Math.floor(i / W) + 1) + '.' });
      }

      function checkWin() {
        var hidden = 0;
        for (var i = 0; i < W * H; i++) if (!open[i] && !mine[i]) hidden++;
        if (hidden) return;
        for (var m = 0; m < W * H; m++) if (mine[m]) flag[m] = true;
        render();
        updateMineCount();

        var secs = Math.floor(elapsed);
        var key = 'best.' + level;
        var prev = Number(g.load(key, 0)) || 0;
        var isBest = !prev || secs < prev;
        if (isBest) { g.save(key, secs); showBest(); }
        g.over({
          won: true,
          score: secs,
          title: 'Cleared',
          message: 'Every mine found in ' + secs + ' seconds on ' + level + '.'
        });
      }

      function showBest() {
        var v = Number(g.load('best.' + level, 0)) || 0;
        g.stat('best', v ? v + 's' : '—');
      }

      /* Returns the figure as well as displaying it, so a flag can say how
         many are left without counting them a second time. */
      function updateMineCount() {
        var flags = 0;
        for (var i = 0; i < W * H; i++) if (flag[i]) flags++;
        var left = Math.max(0, MINES - flags);
        g.stat('mines', left);
        return left;
      }

      /* --------------------------------------------------------------
         DOM
         -------------------------------------------------------------- */
      function build() {
        if (!boardEl) return;
        boardEl.innerHTML = '';
        boardEl.className = 'game-board board-mines';
        boardEl.style.gridTemplateColumns = 'repeat(' + W + ', 1fr)';
        boardEl.setAttribute('data-size', level);
        /* A group and not a grid. role="grid" wants rows, and the rows here
           are a CSS repeat() over one flat list of cells, so claiming it
           would be describing a structure the DOM does not have. The label
           carries the keys because the page's visible list does not. */
        boardEl.setAttribute('role', 'group');
        boardEl.setAttribute('aria-label',
          'Minesweeper board, ' + W + ' by ' + H + '. Arrow keys move, Space opens, Enter flags.');
        cellsEl = [];
        labels = [];
        if (cursor >= W * H) cursor = 0;
        for (var i = 0; i < W * H; i++) {
          var el = document.createElement('button');
          el.type = 'button';
          el.className = 'cell-mine';
          el.setAttribute('data-i', String(i));
          /* The roving tab stop. See the header: every other cell is reachable
             with the arrows and none of them is worth a press of Tab. */
          el.setAttribute('tabindex', i === cursor ? '0' : '-1');
          boardEl.appendChild(el);
          cellsEl.push(el);
          labels.push('');
        }

        /* Absolutely positioned by .sr-only, so it is out of flow and the
           grid does not lay it out as a four hundred and eighty-first cell. */
        statusEl = document.createElement('p');
        statusEl.className = 'sr-only';
        statusEl.setAttribute('role', 'status');
        statusEl.setAttribute('aria-live', 'polite');
        boardEl.appendChild(statusEl);
      }

      function render() {
        for (var i = 0; i < cellsEl.length; i++) {
          var el = cellsEl[i];
          var cls = 'cell-mine';
          var text = '';
          if (flag[i] && !open[i]) { cls += ' is-flag'; text = '⚑'; }
          else if (open[i]) {
            cls += ' is-open';
            if (mine[i]) { cls += ' is-mine'; text = '✹'; }
            else if (counts[i] > 0) { text = String(counts[i]); }
          }
          if (el.className !== cls) el.className = cls;
          if (el.textContent !== text) el.textContent = text;
          /* A glyph is not a name: every covered cell is an empty button and
             they all sound identical, and "3" on its own is not a position.
             Diffed against the last one written because expert would
             otherwise rebuild four hundred and eighty accessibility nodes
             every time a single cell is opened. */
          var lab = cellLabel(i);
          if (labels[i] !== lab) { labels[i] = lab; el.setAttribute('aria-label', lab); }
          el.style.color = (open[i] && !mine[i] && counts[i] > 0) ? (NUM_COLOR[counts[i]] || '#e2e8f0') : '';
        }
      }

      if (boardEl) {
        var pressTimer = null;
        var longPressed = false;

        boardEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

        boardEl.addEventListener('pointerdown', function (e) {
          var btn = e.target.closest ? e.target.closest('.cell-mine') : null;
          if (!btn) return;
          var i = Number(btn.getAttribute('data-i'));
          longPressed = false;
          /* Arm the guard on the click listener below, and take the cursor to
             the cell being pressed so that a player who reaches for the mouse
             mid-game and then goes back to the arrows carries on from where
             they were last looking rather than from where they last were. */
          setCursor(i, false);
          /* The right-click leaves BEFORE the guard is armed. A secondary
             button produces contextmenu and never a click, so arming here
             raised a guard that no click would ever come to lower — and the
             next activation with no pointer behind it was swallowed
             instead. Arming below, on the path that really does end in a
             click, is what makes the guard mean what it says. */
          if (e.button === 2) { toggleFlag(i); longPressed = true; return; }
          clickSpentAt = Date.now();
          /* Long-press flags on a touchscreen. 420 ms is long enough not to
             fire on a normal tap and short enough not to feel stuck. */
          pressTimer = setTimeout(function () { longPressed = true; toggleFlag(i); }, 420);
        });

        var cancel = function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
        boardEl.addEventListener('pointerup', function (e) {
          cancel();
          var btn = e.target.closest ? e.target.closest('.cell-mine') : null;
          if (!btn || longPressed || e.button === 2) return;
          var i = Number(btn.getAttribute('data-i'));
          if (flagMode) toggleFlag(i);
          else click(i);
        });
        boardEl.addEventListener('pointerleave', cancel);
        boardEl.addEventListener('pointercancel', cancel);

        /* Keys that arrive with a CELL focused, which the shell will not
           answer: it passes the arrows through from a button on purpose, so
           that a grid like this one can be walked, and withholds Space and
           Enter because activating a focused button belongs to the button.
           Space is therefore left alone here and comes back as the click
           below, which is precisely the meaning wanted. Enter is taken and
           cancelled — it is the flag, and an uncancelled Enter would activate
           the button as well and open the cell that had just been flagged. */
        boardEl.addEventListener('keydown', function (e) {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          var btn = e.target && e.target.closest ? e.target.closest('.cell-mine') : null;
          if (!btn) return;
          /* Any key on a cell means the last press is over and done with, so
             the guard cannot be left armed by a pointerdown that never
             produced a click: a right-click, or a finger dragged off. */
          clickSpentAt = 0;
          if (e.key !== 'Enter') return;
          e.preventDefault();
          var i = Number(btn.getAttribute('data-i'));
          setCursor(i, false);
          toggleFlag(i);
          /* Cancelling the keydown is what stops the button activating on the
             same Enter, and it does. The guard is raised anyway because of
             what one leaked activation would cost: Enter on a flagged cell
             uncovers the flag, and a click behind it would then open the very
             mine the player had correctly marked and end the run. */
          clickSpentAt = Date.now();
        });

        /* Activation with no pointer behind it: Space on the focused cell,
           and a screen reader's own "press this". Mouse and touch were served
           on pointerup, so their click has to be dropped here or every press
           would count twice — and in flag mode counting twice means flagging
           and unflagging in one gesture, which looks like the button doing
           nothing at all. Two guards because neither is honest alone: detail
           is 0 only for a press no finger made, except on the engines that
           report 0 for a tap as well, and those are caught by the flag the
           pointerdown set. */
        boardEl.addEventListener('click', function (e) {
          var spent = (Date.now() - clickSpentAt) < SPENT_MS;
          clickSpentAt = 0;
          if (spent || e.detail !== 0) return;
          var btn = e.target && e.target.closest ? e.target.closest('.cell-mine') : null;
          if (!btn) return;
          var i = Number(btn.getAttribute('data-i'));
          setCursor(i, false);
          if (flagMode) toggleFlag(i);
          else click(i);
        });
      }

      return {
        reset: function () {
          var cfg = LEVELS[level] || LEVELS.beginner;
          W = cfg.w; H = cfg.h; MINES = cfg.mines;
          mine = []; open = []; flag = []; counts = [];
          for (var i = 0; i < W * H; i++) { mine.push(false); open.push(false); flag.push(false); counts.push(0); }
          laid = false;
          elapsed = 0;
          cursor = 0;
          g.stat('time', 0);
          updateMineCount();
          showBest();
          build();
          render();
        },

        /* Keys the shell did answer, which is every key that arrives while
           the BOARD holds focus rather than a cell — where the shell puts it
           when a run starts — and every arrow pressed on a focused cell,
           which it forwards. One path serves both, so the cursor moves the
           same way wherever the keystroke came from.

           The cursor CLAMPS at the edges rather than wrapping. Wrapping is
           right for a small board of cards, where the far side is a glance
           away; on expert it throws you twenty-nine columns across the board
           for one press of a key that meant "one to the left". */
        key: function (name, event) {
          if (!cellsEl.length) return;
          var x = cursor % W, y = Math.floor(cursor / W);
          if (name === 'left') x = Math.max(0, x - 1);
          else if (name === 'right') x = Math.min(W - 1, x + 1);
          else if (name === 'up') y = Math.max(0, y - 1);
          else if (name === 'down') y = Math.min(H - 1, y + 1);
          else if (name === 'action') {
            /* The shell folds Space and Enter onto one name but hands the
               original event over, and the two have to differ: a keyboard
               needs the right-click that flagging rests on, and Escape and
               the arrows are the only other keys the shell will ever bind.
               A press of the on-screen pad carries no key and means the
               ordinary thing.

               Focus is deliberately NOT moved onto the cell here. Space
               activates a button on the KEYUP, so a Space that opened a cell
               and then put focus on it would be answered a second time by
               the button it had just landed on. */
            if (event && event.key === 'Enter') toggleFlag(cursor);
            else if (flagMode) toggleFlag(cursor);
            else click(cursor);
            return;
          } else return;
          setCursor(idx(x, y), true);
        },

        update: function (dt) {
          /* The clock starts on the first click, not on Play — otherwise
             reading the rules costs you the record. */
          if (!laid) return;
          var was = Math.floor(elapsed);
          elapsed += dt;
          if (Math.floor(elapsed) !== was) g.stat('time', Math.floor(elapsed));
        }
      };
    }
  });
})();

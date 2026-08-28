/* ==========================================================================
   2048.js — the sliding tile puzzle.
   --------------------------------------------------------------------------
   DOM tiles rather than a canvas: the board is sixteen rectangles of text,
   which is what the DOM is for, and it gets readable numbers at any zoom
   plus real text selection for free.

   The two rules most hand-rolled copies get wrong, both enforced in slide():

     A tile merges at most once per move. Sliding four 2s left gives two 4s,
     never one 8. Without the `merged` flag the board collapses far too fast
     and the game stops being hard.

     A new tile appears only if something actually moved. Pressing into a
     wall must be a no-op; otherwise a player can fill their own board by
     pressing a direction that does nothing, and lose to the interface
     rather than to the puzzle.

   The board, score and move count are written to localStorage after every
   move, so an abandoned run is still there tomorrow.
   ========================================================================== */

(function () {
  'use strict';

  var N = 4;

  GameShell.define({
    id: 'game-2048',
    slug: '2048',
    title: '2048',
    startTitle: '2048',
    startText: 'Arrow keys, or swipe. Matching tiles merge; get one to 2048 and then keep going.',

    setup: function (g) {
      /* Read the saved board HERE, at setup, and not from the ready() hook.
         The shell's order is setup() -> reset() -> ready(), and reset() both
         clears the stored board and saves a fresh one over it. Reading in
         ready() therefore always found the board reset() had just dealt,
         which is why "your board is saved" -- printed in three places on
         this page -- had never once restored anything. setup() is the last
         moment the previous run still exists. */
      var pendingSave = g.load('board', null);
      /* Set by the New board button. Without it, holding pendingSave across
         the Play click would also make New board hand back the very board
         the player just asked to be rid of. */
      var forceFresh = false;
      var cells = [];         // N*N of 0 or a power of two
      var moves = 0;
      var prev = null;        // one step of undo: { cells, score, moves }
      var won = false;
      var boardEl = g.board;

      var undoBtn = document.getElementById('game-undo');
      var newBtn = document.getElementById('game-new');
      if (undoBtn) undoBtn.addEventListener('click', undo);
      if (newBtn) newBtn.addEventListener('click', function () { g.start(); });

      /* --------------------------------------------------------------
         Board state
         -------------------------------------------------------------- */
      function empty() {
        var out = [];
        for (var i = 0; i < N * N; i++) out.push(0);
        return out;
      }

      function freeCells() {
        var free = [];
        for (var i = 0; i < cells.length; i++) if (!cells[i]) free.push(i);
        return free;
      }

      function addTile() {
        var free = freeCells();
        if (!free.length) return;
        var at = free[Math.floor(Math.random() * free.length)];
        /* The classic 90/10 split. A board of nothing but 2s is a longer,
           duller game; all-4s is much too fast. */
        cells[at] = Math.random() < 0.9 ? 2 : 4;
      }

      /* Collapse one line toward index 0. Returns the new line and how much
         it scored. `merged` is the once-per-move flag. */
      function collapse(line) {
        var out = [];
        var gained = 0;
        var merged = false;
        for (var i = 0; i < line.length; i++) {
          var v = line[i];
          if (!v) continue;
          if (out.length && out[out.length - 1] === v && !merged) {
            out[out.length - 1] = v * 2;
            gained += v * 2;
            merged = true;
          } else {
            out.push(v);
            /* Only a merge sets the flag; a plain slide past a just-merged
               tile must be able to merge in turn. Resetting here is what
               makes [2,2,4,4] give [4,8] and not [4,4,4]. */
            merged = false;
          }
        }
        while (out.length < line.length) out.push(0);
        return { line: out, gained: gained };
      }

      /* Read a row or column in the direction of travel, collapse it, and
         write it back. One function for all four directions: `read` maps a
         position along the line to a board index. */
      function slide(dir) {
        var before = cells.join(',');
        var gained = 0;

        for (var k = 0; k < N; k++) {
          var line = [];
          var idx = [];
          for (var s = 0; s < N; s++) {
            var i;
            if (dir === 'left') i = k * N + s;
            else if (dir === 'right') i = k * N + (N - 1 - s);
            else if (dir === 'up') i = s * N + k;
            else i = (N - 1 - s) * N + k;
            idx.push(i);
            line.push(cells[i]);
          }
          var res = collapse(line);
          gained += res.gained;
          for (var w = 0; w < N; w++) cells[idx[w]] = res.line[w];
        }

        return { moved: cells.join(',') !== before, gained: gained };
      }

      function canMove() {
        for (var i = 0; i < cells.length; i++) {
          if (!cells[i]) return true;
          var r = Math.floor(i / N), c = i % N;
          if (c + 1 < N && cells[i] === cells[i + 1]) return true;
          if (r + 1 < N && cells[i] === cells[i + N]) return true;
        }
        return false;
      }

      function move(dir) {
        if (g.state !== 'playing') return;

        /* Snapshot before mutating, so undo restores exactly one move. */
        var snapshot = { cells: cells.slice(), score: g.score, moves: moves };
        var res = slide(dir);
        if (!res.moved) return;                 // no-op: no tile, no move count
        /* From here the run is the player's, not the restored snapshot's. */
        pendingSave = null;

        prev = snapshot;
        if (undoBtn) undoBtn.disabled = false;

        if (res.gained) { g.addScore(res.gained); g.beep(440 + Math.min(res.gained, 600), 0.05, 'sine'); }
        moves++;
        g.stat('moves', moves);
        addTile();
        render();
        save();

        if (!won) {
          for (var i = 0; i < cells.length; i++) {
            if (cells[i] >= 2048) {
              won = true;
              g.beep(880, 0.15, 'sine');
              /* Announced, not ended: the manifest promises the run carries
                 on, and 4096 is genuinely reachable from here. */
              flash('2048 reached — keep going');
              break;
            }
          }
        }

        if (!canMove()) {
          g.over({ message: 'No moves left after ' + moves + ' ' + (moves === 1 ? 'move' : 'moves') + '.' });
        }
      }

      function undo() {
        if (!prev || g.state !== 'playing') return;
        cells = prev.cells.slice();
        g.setScore(prev.score);
        moves = prev.moves;
        g.stat('moves', moves);
        prev = null;
        if (undoBtn) undoBtn.disabled = true;
        render();
        save();
      }

      /* --------------------------------------------------------------
         Persistence
         -------------------------------------------------------------- */
      function save() {
        g.save('board', JSON.stringify({ c: cells, s: g.score, m: moves, w: won }));
      }

      function restore(raw) {
        if (!raw) return false;
        try {
          var data = JSON.parse(raw);
          if (!data || !data.c || data.c.length !== N * N) return false;
          cells = data.c;
          g.setScore(data.s || 0);
          moves = data.m || 0;
          won = !!data.w;
          g.stat('moves', moves);
          return true;
        } catch (err) { return false; }
      }

      /* --------------------------------------------------------------
         Rendering
         -------------------------------------------------------------- */
      var tiles = [];

      function build() {
        if (!boardEl) return;
        boardEl.innerHTML = '';
        boardEl.className = 'game-board board-2048';
        tiles = [];
        for (var i = 0; i < N * N; i++) {
          var el = document.createElement('div');
          el.className = 'tile-2048';
          boardEl.appendChild(el);
          tiles.push(el);
        }
      }

      function render() {
        for (var i = 0; i < tiles.length; i++) {
          var v = cells[i];
          tiles[i].textContent = v ? String(v) : '';
          tiles[i].setAttribute('data-v', v ? String(Math.min(v, 4096)) : '0');
        }
      }

      var flashTimer = null;
      function flash(text) {
        if (!boardEl) return;
        var note = boardEl.parentNode.querySelector('.board-note');
        if (!note) {
          note = document.createElement('p');
          note.className = 'board-note';
          note.setAttribute('role', 'status');
          boardEl.parentNode.appendChild(note);
        }
        note.textContent = text;
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { note.textContent = ''; }, 2600);
      }

      /* --------------------------------------------------------------
         Swipe
         -------------------------------------------------------------- */
      if (boardEl) {
        var start = null;
        var restartBtn = document.getElementById('game-restart');
        if (restartBtn) restartBtn.addEventListener('click', function () { forceFresh = true; });

        boardEl.addEventListener('pointerdown', function (e) { start = { x: e.clientX, y: e.clientY }; });
        boardEl.addEventListener('pointerup', function (e) {
          if (!start) return;
          var dx = e.clientX - start.x, dy = e.clientY - start.y;
          start = null;
          if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
          if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
          else move(dy > 0 ? 'down' : 'up');
        });
      }

      build();

      return {
        reset: function () {
          /* The comment that used to sit here described this exactly, and the
             code below did the opposite: every start() wiped the saved board
             and dealt a new one, so the board restored a moment earlier by
             ready() was destroyed by the very click that meant "carry on".
             The page promises "your board is saved" in three places.

             Restart still gives a fresh board: pendingSave is consumed by the
             first reset and is null on every one after it. */
          /* Consumed once. "New board" and every later restart fall through
             to the fresh deal below, because pendingSave is null by then. */
          /* Deliberately NOT consumed here. The shell resets twice before a
             player touches anything -- once while constructing the game and
             again when Play is pressed -- so consuming on the first would let
             the second deal a fresh board over the restored one, which is the
             bug this whole path exists to fix. It is released by the first
             actual move, or by New board. */
          if (pendingSave && !forceFresh && restore(pendingSave)) {
            render();
            save();
            return;
          }
          pendingSave = null;
          forceFresh = false;
          cells = empty();
          moves = 0;
          won = false;
          prev = null;
          if (undoBtn) undoBtn.disabled = true;
          g.stat('moves', 0);
          addTile();
          addTile();
          render();
          save();
        },

        key: function (name) {
          if (name === 'up' || name === 'down' || name === 'left' || name === 'right') move(name);
        },

        /* Nothing animates on a clock, so there is no update() and no draw().
           The shell's loop still runs, harmlessly, and the board is
           re-rendered only when it changes. */
        /* No ready() hook: restoring happens in reset(), the only place that
           runs before anything can overwrite the save. */
      };
    }
  });
})();

/* ==========================================================================
   tetris.js — Tetris with a 7-bag randomiser.
   --------------------------------------------------------------------------
   The well is 10x20 cells of 20 logical units, drawn at x 10..210. The strip
   from 220 to 310 holds the next queue and the hold slot, which is why the
   canvas is 320 wide and not 200.

   THE BAG IS THE WHOLE POINT. Picking each piece at random independently
   means a real chance of no long bar for thirty pieces, and a player cannot
   plan against a distribution like that — they can only be annoyed by it.
   Shuffling all seven and dealing them out caps the worst drought at twelve
   (the tail of one bag plus the head of the next), and that guarantee is
   what makes stacking two pieces ahead a skill rather than a gamble.

   Rotation nudges the piece when the naive rotation collides: in place, then
   one left, one right, two left, two right, then up. First fit wins. This is
   a simplified SRS — the real kick tables are per-piece and per-transition —
   but it produces the behaviour that matters, which is that a rotation next
   to a wall or in a notch succeeds instead of silently failing.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 10;
  var ROWS = 20;
  var CELL = 20;
  var WELL_X = 10;
  var WELL_Y = 0;

  /* Shapes as matrices so rotation is a transpose-and-reverse rather than
     seven hand-written rotation tables. */
  var SHAPES = {
    I: { color: '#38bdf8', cells: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    O: { color: '#fbbf24', cells: [[1, 1], [1, 1]] },
    T: { color: '#c084fc', cells: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    S: { color: '#4ade80', cells: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    Z: { color: '#f87171', cells: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    J: { color: '#60a5fa', cells: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    L: { color: '#fb923c', cells: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] }
  };
  var NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  /* Line scores by count cleared, index 1..4, multiplied by level. */
  var LINE_SCORE = [0, 100, 300, 500, 800];

  function rotate(cells) {
    var n = cells.length;
    var out = [];
    for (var y = 0; y < n; y++) {
      out.push([]);
      for (var x = 0; x < n; x++) out[y].push(cells[n - 1 - x][y]);
    }
    return out;
  }

  function copy(cells) {
    var out = [];
    for (var y = 0; y < cells.length; y++) out.push(cells[y].slice());
    return out;
  }

  GameShell.define({
    id: 'game-tetris',
    slug: 'tetris',
    title: 'Tetris',
    width: 320,
    height: 400,
    startTitle: 'Tetris',
    startText: 'Arrows to move and rotate, Space to hard drop. The Hold button parks a piece for later.',

    setup: function (g) {
      var grid = [];          // ROWS x COLS of null or a colour
      var bag = [];
      var queue = [];         // the next three
      var piece = null;       // { name, cells, x, y, color }
      var hold = null;
      var holdUsed = false;
      var lines = 0;
      var level = 1;
      var fallAcc = 0;

      var holdBtn = document.getElementById('game-hold');
      if (holdBtn) holdBtn.addEventListener('click', doHold);

      function refillBag() {
        bag = NAMES.slice();
        /* Fisher-Yates. Math.random, not the seeded generator: a Tetris run
           should not be reproducible. */
        for (var i = bag.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
        }
      }

      function nextName() {
        if (!bag.length) refillBag();
        return bag.pop();
      }

      function spawn(name) {
        var shape = SHAPES[name];
        var cells = copy(shape.cells);
        var p = {
          name: name,
          cells: cells,
          color: shape.color,
          /* Centred, and one row above the ceiling for the tall pieces so a
             spawn does not immediately read as a collision. */
          x: Math.floor((COLS - cells.length) / 2),
          y: name === 'I' ? -1 : 0
        };
        return p;
      }

      function collides(p, nx, ny, cells) {
        cells = cells || p.cells;
        for (var y = 0; y < cells.length; y++) {
          for (var x = 0; x < cells.length; x++) {
            if (!cells[y][x]) continue;
            var gx = nx + x;
            var gy = ny + y;
            if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
            /* Above the ceiling is legal — that is where a piece spawns. */
            if (gy >= 0 && grid[gy][gx]) return true;
          }
        }
        return false;
      }

      function take() {
        while (queue.length < 4) queue.push(nextName());
        piece = spawn(queue.shift());
        holdUsed = false;
        /* Blocked at the spawn point: the well is full. */
        if (collides(piece, piece.x, piece.y)) {
          g.over({ message: lines + (lines === 1 ? ' line' : ' lines') + ' cleared. The well filled to the top.' });
          return false;
        }
        return true;
      }

      function doHold() {
        if (g.state !== 'playing' || !piece || holdUsed) return;
        var swap = hold;
        hold = piece.name;
        if (swap) {
          piece = spawn(swap);
          if (collides(piece, piece.x, piece.y)) {
            g.over({ message: 'Held piece could not be placed.' });
            return;
          }
        } else if (!take()) {
          return;
        }
        /* Set AFTER take(), which clears it — otherwise hold is free every
           piece and stops being a decision. */
        holdUsed = true;
        g.beep(520, 0.05, 'sine');
      }

      function lock() {
        for (var y = 0; y < piece.cells.length; y++) {
          for (var x = 0; x < piece.cells.length; x++) {
            if (!piece.cells[y][x]) continue;
            var gy = piece.y + y;
            if (gy < 0) continue;
            grid[gy][piece.x + x] = piece.color;
          }
        }

        var cleared = 0;
        for (var r = ROWS - 1; r >= 0; r--) {
          var full = true;
          for (var c = 0; c < COLS; c++) { if (!grid[r][c]) { full = false; break; } }
          if (!full) continue;
          grid.splice(r, 1);
          grid.unshift(new Array(COLS));
          cleared++;
          r++;            // re-test the row that just dropped into this index
        }

        if (cleared) {
          lines += cleared;
          g.addScore(LINE_SCORE[cleared] * level);
          g.stat('lines', lines);
          var newLevel = Math.min(15, Math.floor(lines / 10) + 1);
          if (newLevel !== level) { level = newLevel; g.stat('level', level); g.beep(880, 0.1, 'sine'); }
          g.beep(cleared === 4 ? 660 : 440, 0.09, 'square');
        }

        take();
      }

      /* Drop interval by level, in seconds. Roughly the classic curve. */
      function interval() {
        return Math.max(0.05, 0.8 - (level - 1) * 0.055);
      }

      function tryMove(dx, dy) {
        if (!piece) return false;
        if (collides(piece, piece.x + dx, piece.y + dy)) return false;
        piece.x += dx;
        piece.y += dy;
        return true;
      }

      function tryRotate() {
        if (!piece || piece.name === 'O') return;
        var turned = rotate(piece.cells);
        var kicks = [0, -1, 1, -2, 2];
        for (var i = 0; i < kicks.length; i++) {
          if (!collides(piece, piece.x + kicks[i], piece.y, turned)) {
            piece.x += kicks[i];
            piece.cells = turned;
            g.beep(300, 0.03, 'sine', 0.03);
            return;
          }
        }
        /* Last resort: one row up. Rescues a rotation in a floor notch. */
        if (!collides(piece, piece.x, piece.y - 1, turned)) {
          piece.y -= 1;
          piece.cells = turned;
        }
      }

      function hardDrop() {
        if (!piece) return;
        var dropped = 0;
        while (tryMove(0, 1)) dropped++;
        g.addScore(dropped * 2);
        g.beep(180, 0.05, 'square');
        lock();
      }

      function ghostY() {
        var y = piece.y;
        while (!collides(piece, piece.x, y + 1)) y++;
        return y;
      }

      /* -------------------------------------------------------------
         Drawing
         ------------------------------------------------------------- */
      function block(ctx, px, py, color, alpha) {
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        ctx.fillStyle = color;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        /* A lighter top edge so a field of same-coloured blocks still reads
           as individual cells rather than one slab. */
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(px + 1, py + 1, CELL - 2, 3);
        ctx.globalAlpha = 1;
      }

      function drawMini(ctx, name, cx, cy) {
        if (!name) return;
        var shape = SHAPES[name];
        var n = shape.cells.length;
        var s = 10;
        for (var y = 0; y < n; y++) {
          for (var x = 0; x < n; x++) {
            if (!shape.cells[y][x]) continue;
            ctx.fillStyle = shape.color;
            ctx.fillRect(cx + x * s, cy + y * s, s - 1, s - 1);
          }
        }
      }

      function draw(ctx) {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, 320, 400);

        // The well
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(WELL_X, WELL_Y, COLS * CELL, ROWS * CELL);
        ctx.strokeStyle = 'rgba(148,163,184,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 1; i < COLS; i++) {
          ctx.moveTo(WELL_X + i * CELL, WELL_Y);
          ctx.lineTo(WELL_X + i * CELL, WELL_Y + ROWS * CELL);
        }
        for (var j = 1; j < ROWS; j++) {
          ctx.moveTo(WELL_X, WELL_Y + j * CELL);
          ctx.lineTo(WELL_X + COLS * CELL, WELL_Y + j * CELL);
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(125,211,252,0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(WELL_X, WELL_Y, COLS * CELL, ROWS * CELL);

        // Settled blocks
        for (var y = 0; y < ROWS; y++) {
          for (var x = 0; x < COLS; x++) {
            if (grid[y][x]) block(ctx, WELL_X + x * CELL, WELL_Y + y * CELL, grid[y][x]);
          }
        }

        if (piece) {
          // Ghost first, so the live piece paints over it where they overlap
          var gy = ghostY();
          for (var py = 0; py < piece.cells.length; py++) {
            for (var px = 0; px < piece.cells.length; px++) {
              if (!piece.cells[py][px]) continue;
              var ry = gy + py;
              if (ry < 0) continue;
              block(ctx, WELL_X + (piece.x + px) * CELL, WELL_Y + ry * CELL, piece.color, 0.2);
            }
          }
          for (var cy2 = 0; cy2 < piece.cells.length; cy2++) {
            for (var cx2 = 0; cx2 < piece.cells.length; cx2++) {
              if (!piece.cells[cy2][cx2]) continue;
              var dy2 = piece.y + cy2;
              if (dy2 < 0) continue;
              block(ctx, WELL_X + (piece.x + cx2) * CELL, WELL_Y + dy2 * CELL, piece.color);
            }
          }
        }

        // Side panel
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px "Cascadia Code", Consolas, monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('NEXT', 224, 22);
        for (var q = 0; q < 3 && q < queue.length; q++) drawMini(ctx, queue[q], 224, 30 + q * 46);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('HOLD', 224, 200);
        if (hold) drawMini(ctx, hold, 224, 208);
        else {
          ctx.fillStyle = 'rgba(148,163,184,0.25)';
          ctx.fillRect(224, 208, 40, 30);
        }
      }

      return {
        reset: function () {
          grid = [];
          for (var y = 0; y < ROWS; y++) grid.push(new Array(COLS));
          bag = [];
          queue = [];
          hold = null;
          holdUsed = false;
          lines = 0;
          level = 1;
          fallAcc = 0;
          g.stat('lines', 0);
          g.stat('level', 1);
          take();
        },

        key: function (name) {
          if (!piece) return;
          if (name === 'left') tryMove(-1, 0);
          else if (name === 'right') tryMove(1, 0);
          else if (name === 'up') tryRotate();
          else if (name === 'down') { if (tryMove(0, 1)) { g.addScore(1); fallAcc = 0; } }
          else if (name === 'action') hardDrop();
        },

        update: function (dt) {
          if (!piece) return;
          fallAcc += dt;
          var step = interval();
          while (fallAcc >= step) {
            fallAcc -= step;
            if (!tryMove(0, 1)) { lock(); return; }
          }
        },

        draw: draw
      };
    }
  });
})();

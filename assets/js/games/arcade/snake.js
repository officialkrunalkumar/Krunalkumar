/* ==========================================================================
   snake.js — Snake.
   --------------------------------------------------------------------------
   Twenty by twenty on a 320-unit board, so every cell is 16 logical units and
   nothing ever lands on a half pixel.

   Three things here are not the naive version, and each fixes a specific way
   the naive version feels wrong:

   1. TURNS ARE QUEUED, NOT APPLIED. A keypress does not steer the snake; it
      pushes onto a short queue that the tick drains one entry at a time. Play
      the obvious way instead — write the direction straight into a variable —
      and a fast left-then-up at the top of a tick loses the left entirely,
      because both writes land before the snake has moved once. That is the
      "it didn't take my input" feeling every hand-rolled Snake has. Two
      entries is enough: it covers the double-turn that matters and refuses to
      bank a third that the player has already forgotten making.

   2. REVERSAL IS CHECKED AGAINST THE LAST MOVE, NOT THE PENDING ONE. The
      illegal move is turning back along the neck, and the neck is decided by
      the direction actually travelled, not by whatever is sitting in the
      queue. Check the queue instead and a queued left followed by a right
      cancels into a straight line the player never asked for.

   3. FOOD IS DRAWN FROM THE FREE CELLS. The usual approach picks a random
      cell and retries while it is inside the snake. At length 300 on a 400
      cell board that is a loop making hundreds of attempts for one placement,
      on the frame the player is least able to afford it. Collecting the free
      cells and indexing once is O(cells) every time, with no tail behaviour.

   ES5, as everything under assets/js is.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 20;
  var ROWS = 20;
  var CELL = 16;              // 20 * 16 = the 320-unit board declared in the manifest

  GameShell.define({
    id: 'game-snake',
    slug: 'snake',
    title: 'Snake',
    width: COLS * CELL,
    height: ROWS * CELL,
    pixel: true,
    startTitle: 'Snake',
    startText: 'Arrow keys, or the pad on a touchscreen. Your best score stays on this device.',

    setup: function (g) {
      var snake = [];
      var dir = { x: 1, y: 0 };
      var queue = [];
      var food = { x: 0, y: 0 };
      var acc = 0;
      var speed = 12;         // cells per second
      var wrap = false;
      var grew = 0;

      /* Toolbar. Both controls are read live rather than cached, so changing
         the speed mid-run takes effect on the next tick instead of the next
         game — which is what a player fiddling with a dropdown expects. */
      var speedSel = document.getElementById('game-speed');
      var wrapBtn = document.getElementById('game-wrap');

      if (speedSel) {
        speed = Number(speedSel.value) || 12;
        speedSel.addEventListener('change', function () {
          speed = Number(speedSel.value) || 12;
        });
      }

      if (wrapBtn) {
        wrap = g.load('wrap', 'off') === 'on';
        syncWrap();
        wrapBtn.addEventListener('click', function () {
          wrap = !wrap;
          g.save('wrap', wrap ? 'on' : 'off');
          syncWrap();
        });
      }

      function syncWrap() {
        if (!wrapBtn) return;
        wrapBtn.setAttribute('aria-pressed', String(wrap));
        wrapBtn.title = wrap ? 'Wrap-around walls (click for walls that kill)'
                             : 'Walls kill (click for wrap-around)';
      }

      function occupied(x, y) {
        for (var i = 0; i < snake.length; i++) {
          if (snake[i].x === x && snake[i].y === y) return true;
        }
        return false;
      }

      /* See decision 3 in the header. */
      function placeFood() {
        var free = [];
        for (var y = 0; y < ROWS; y++) {
          for (var x = 0; x < COLS; x++) {
            if (!occupied(x, y)) free.push(x * ROWS + y);
          }
        }
        if (!free.length) return false;         // board full: a genuine win
        var cell = free[Math.floor(Math.random() * free.length)];
        food.x = Math.floor(cell / ROWS);
        food.y = cell % ROWS;
        return true;
      }

      function reset() {
        snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
        dir = { x: 1, y: 0 };
        queue = [];
        acc = 0;
        grew = 0;
        g.stat('length', snake.length);
        placeFood();
      }

      /* One cell of movement. Split out of update() because update() is
         called at 120 Hz and this at `speed` Hz — keeping them separate is
         what makes the snake's pace independent of the frame rate. */
      function step() {
        if (queue.length) {
          var next = queue.shift();
          /* Reversal is illegal, and is measured against the direction
             actually travelled — decision 2. */
          if (!(next.x === -dir.x && next.y === -dir.y)) dir = next;
        }

        var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

        if (wrap) {
          if (head.x < 0) head.x = COLS - 1;
          else if (head.x >= COLS) head.x = 0;
          if (head.y < 0) head.y = ROWS - 1;
          else if (head.y >= ROWS) head.y = 0;
        } else if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
          g.over({ message: 'Into the wall at length ' + snake.length + '.' });
          return;
        }

        /* The tail cell is about to be vacated, so moving into it is legal
           unless the snake is growing this tick. Getting this wrong is why
           some copies kill you for following your own tail. */
        var ignoreTail = grew === 0;
        for (var i = 0; i < snake.length - (ignoreTail ? 1 : 0); i++) {
          if (snake[i].x === head.x && snake[i].y === head.y) {
            g.over({ message: 'You bit yourself at length ' + snake.length + '.' });
            return;
          }
        }

        snake.unshift(head);

        if (head.x === food.x && head.y === food.y) {
          grew += 1;
          g.addScore(10);
          g.stat('length', snake.length);
          g.beep(880, 0.06, 'square');
          if (!placeFood()) {
            g.over({ won: true, title: 'Board full', message: 'You filled all four hundred cells. That is the actual end of Snake.' });
            return;
          }
        }

        if (grew > 0) grew -= 1;
        else snake.pop();
      }

      /* -------------------------------------------------------------
         Drawing
         ------------------------------------------------------------- */
      function draw(ctx) {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

        /* A faint grid. It is the difference between judging a gap and
           guessing at one, especially on a phone. */
        ctx.strokeStyle = 'rgba(148,163,184,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 1; i < COLS; i++) {
          ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, ROWS * CELL);
          ctx.moveTo(0, i * CELL); ctx.lineTo(COLS * CELL, i * CELL);
        }
        ctx.stroke();

        if (!wrap) {
          ctx.strokeStyle = 'rgba(248,113,113,0.35)';
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, COLS * CELL - 2, ROWS * CELL - 2);
        }

        ctx.fillStyle = '#f87171';
        ctx.fillRect(food.x * CELL + 3, food.y * CELL + 3, CELL - 6, CELL - 6);

        for (var s = snake.length - 1; s >= 0; s--) {
          /* The body fades toward the tail, so at length sixty it is still
             obvious which end is which. */
          var t = s / Math.max(snake.length, 1);
          ctx.fillStyle = s === 0 ? '#bbf7d0' : 'rgba(74,222,128,' + (1 - t * 0.55).toFixed(3) + ')';
          ctx.fillRect(snake[s].x * CELL + 1, snake[s].y * CELL + 1, CELL - 2, CELL - 2);
        }
      }

      /* -------------------------------------------------------------
         Touch: swipe anywhere on the board, as well as the pad.
         ------------------------------------------------------------- */
      var touchStart = null;
      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          touchStart = { x: event.clientX, y: event.clientY };
        });
        g.canvas.addEventListener('pointerup', function (event) {
          if (!touchStart) return;
          var dx = event.clientX - touchStart.x;
          var dy = event.clientY - touchStart.y;
          touchStart = null;
          if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;   // a tap, not a swipe
          if (Math.abs(dx) > Math.abs(dy)) push(dx > 0 ? 'right' : 'left');
          else push(dy > 0 ? 'down' : 'up');
        });
      }

      function push(name) {
        var d = name === 'up' ? { x: 0, y: -1 }
              : name === 'down' ? { x: 0, y: 1 }
              : name === 'left' ? { x: -1, y: 0 }
              : name === 'right' ? { x: 1, y: 0 } : null;
        if (!d) return;
        /* Cap at two. See decision 1. */
        if (queue.length >= 2) return;
        var last = queue.length ? queue[queue.length - 1] : dir;
        if (d.x === last.x && d.y === last.y) return;           // same way: no-op
        queue.push(d);
      }

      return {
        reset: reset,

        key: function (name) { push(name); },

        update: function (dt) {
          acc += dt;
          var interval = 1 / speed;
          /* A while, not an if: at 18 cells a second on a 120 Hz step this
             is normally one iteration, but a frame that ran long must not
             leave the snake owing time it never repays. */
          while (acc >= interval) {
            acc -= interval;
            step();
            if (g.state !== 'playing') return;
          }
        },

        draw: draw
      };
    }
  });
})();

/* ==========================================================================
   breakout.js — Breakout with swept collision.
   --------------------------------------------------------------------------
   400x300 logical units. Bricks live in the top third, the bat on the floor.

   THE SWEEP IS THE REASON THIS FILE IS LONGER THAN IT LOOKS. The obvious
   implementation moves the ball then asks what it overlaps. At the speeds
   this reaches, one step is larger than a brick is thick, so the ball can
   arrive on the far side having overlapped nothing at any sampled instant
   and pass straight through a solid wall. It is the single commonest bug in
   a hand-written Breakout and it only shows up once the game is fast enough
   to be worth playing.

   So each step solves for the EARLIEST time in [0,1] at which the ball's
   path crosses a brick face, takes the closest one, moves the ball exactly
   there, reflects, and continues with the time that is left. Up to four
   bounces are resolved per step, which covers a corner pocket without
   letting a pathological case spin forever.
   ========================================================================== */

(function () {
  'use strict';

  var W = 400;
  var H = 300;
  var BAT_W = 62;
  var BAT_H = 8;
  var BAT_Y = H - 22;
  var R = 4;                    // ball radius

  var BRICK_W = 36;
  var BRICK_H = 12;
  var BRICK_TOP = 34;
  var BRICK_LEFT = 20;
  var COLS = 10;

  /* Six layouts. 0 empty, 1..3 hits required. Ten columns wide. */
  var LEVELS = [
    ['1111111111', '1111111111', '1111111111'],
    ['2222222222', '1111111111', '1111111111', '0110000110'],
    ['1221221221', '2112112112', '1221221221', '0011111100'],
    ['3333333333', '2222222222', '1111111111', '0110110110'],
    ['1010101010', '0303030303', '2121212121', '0303030303', '1010101010'],
    ['3223223223', '2332332332', '3223223223', '2332332332', '1111111111']
  ];

  var TINTS = { 1: '#4ade80', 2: '#fbbf24', 3: '#f87171' };

  GameShell.define({
    id: 'game-breakout',
    slug: 'breakout',
    title: 'Breakout',
    width: W,
    height: H,
    startTitle: 'Breakout',
    startText: 'Move with the arrows or your mouse. Space launches the ball. Where it hits the bat sets the angle.',

    setup: function (g) {
      var bricks = [];        // { x, y, hp }
      var bat = W / 2;
      var ball = { x: W / 2, y: BAT_Y - R - 1, vx: 0, vy: 0 };
      var stuck = true;       // sitting on the bat, waiting for a launch
      var lives = 3;
      var level = 0;
      var speed = 130;        // logical units per second

      function buildLevel(n) {
        bricks = [];
        var rows = LEVELS[n % LEVELS.length];
        for (var r = 0; r < rows.length; r++) {
          for (var c = 0; c < COLS; c++) {
            var hp = Number(rows[r].charAt(c));
            if (!hp) continue;
            bricks.push({
              x: BRICK_LEFT + c * BRICK_W,
              y: BRICK_TOP + r * BRICK_H,
              hp: hp
            });
          }
        }
      }

      function resetBall() {
        stuck = true;
        ball.x = bat;
        ball.y = BAT_Y - R - 1;
        ball.vx = 0;
        ball.vy = 0;
      }

      function launch() {
        if (!stuck) return;
        stuck = false;
        /* Always upward, at a slight angle so the first shot is not a
           vertical line the player has no way to influence. */
        var a = (-Math.PI / 2) + (Math.random() - 0.5) * 0.7;
        ball.vx = Math.cos(a) * speed;
        ball.vy = Math.sin(a) * speed;
        g.beep(520, 0.05, 'square');
      }

      /* Earliest crossing of the segment (x,y)->(x+dx,y+dy) with an
         axis-aligned box expanded by the ball radius. Returns { t, nx, ny }
         or null. This is a slab test: the interval of t during which the
         path is inside the box on each axis, intersected. */
      function sweep(x, y, dx, dy, bx, by, bw, bh) {
        var minX = bx - R, maxX = bx + bw + R;
        var minY = by - R, maxY = by + bh + R;

        var tEnterX, tExitX, tEnterY, tExitY;

        if (dx === 0) {
          if (x < minX || x > maxX) return null;
          tEnterX = -Infinity; tExitX = Infinity;
        } else {
          tEnterX = (minX - x) / dx;
          tExitX = (maxX - x) / dx;
          if (tEnterX > tExitX) { var tx = tEnterX; tEnterX = tExitX; tExitX = tx; }
        }

        if (dy === 0) {
          if (y < minY || y > maxY) return null;
          tEnterY = -Infinity; tExitY = Infinity;
        } else {
          tEnterY = (minY - y) / dy;
          tExitY = (maxY - y) / dy;
          if (tEnterY > tExitY) { var ty = tEnterY; tEnterY = tExitY; tExitY = ty; }
        }

        var tEnter = Math.max(tEnterX, tEnterY);
        var tExit = Math.min(tExitX, tExitY);
        if (tEnter > tExit || tExit < 0 || tEnter > 1) return null;

        /* Which axis was entered last is the face that was actually hit —
           this is what makes a corner reflect correctly instead of
           picking a side at random. */
        if (tEnterX > tEnterY) return { t: Math.max(tEnter, 0), nx: dx > 0 ? -1 : 1, ny: 0 };
        return { t: Math.max(tEnter, 0), nx: 0, ny: dy > 0 ? -1 : 1 };
      }

      function step(dt) {
        if (stuck) { ball.x = bat; ball.y = BAT_Y - R - 1; return; }

        var remaining = dt;
        var bounces = 0;

        while (remaining > 0 && bounces < 4) {
          var dx = ball.vx * remaining;
          var dy = ball.vy * remaining;

          var best = null;
          var bestBrick = -1;

          for (var i = 0; i < bricks.length; i++) {
            var hit = sweep(ball.x, ball.y, dx, dy, bricks[i].x, bricks[i].y, BRICK_W, BRICK_H);
            if (hit && (!best || hit.t < best.t)) { best = hit; bestBrick = i; }
          }

          /* The bat is swept too, for the same reason the bricks are: a
             fast ball can otherwise cross it entirely between two steps. */
          var batHit = ball.vy > 0
            ? sweep(ball.x, ball.y, dx, dy, bat - BAT_W / 2, BAT_Y, BAT_W, BAT_H)
            : null;
          if (batHit && (!best || batHit.t < best.t)) { best = batHit; bestBrick = -2; }

          if (!best) { ball.x += dx; ball.y += dy; break; }

          ball.x += dx * best.t;
          ball.y += dy * best.t;
          remaining *= (1 - best.t);

          if (bestBrick === -2) {
            /* The bat is a mirror, not a wall: the landing point decides
               the outgoing angle, so a flat rally is always breakable. */
            var offset = (ball.x - bat) / (BAT_W / 2);
            if (offset < -1) offset = -1;
            if (offset > 1) offset = 1;
            var angle = (-Math.PI / 2) + offset * 1.05;
            var sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
            ball.vx = Math.cos(angle) * sp;
            ball.vy = Math.sin(angle) * sp;
            ball.y = BAT_Y - R - 0.01;
            g.beep(300, 0.04, 'square');
          } else {
            var brick = bricks[bestBrick];
            brick.hp -= 1;
            g.addScore(10);
            if (brick.hp <= 0) {
              bricks.splice(bestBrick, 1);
              g.addScore(10);
              g.beep(660, 0.04, 'square');
            } else {
              g.beep(420, 0.03, 'square');
            }
            if (best.nx) ball.vx = -ball.vx;
            if (best.ny) ball.vy = -ball.vy;

            if (!bricks.length) {
              level++;
              if (level >= LEVELS.length) {
                g.over({ won: true, title: 'All six cleared', message: 'You finished every layout with ' + lives + ' ' + (lives === 1 ? 'life' : 'lives') + ' to spare.' });
                return;
              }
              g.stat('level', level + 1);
              speed = Math.min(230, speed + 12);
              buildLevel(level);
              resetBall();
              return;
            }
          }
          bounces++;
        }

        // Walls
        if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); g.beep(240, 0.03, 'square', 0.03); }
        if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); g.beep(240, 0.03, 'square', 0.03); }
        if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); g.beep(240, 0.03, 'square', 0.03); }

        // Floor
        if (ball.y > H + R) {
          lives -= 1;
          g.stat('lives', lives);
          if (lives <= 0) {
            g.over({ message: 'Out of lives on level ' + (level + 1) + '.' });
            return;
          }
          g.sweep(300, 140, 0.3);
          resetBall();
        }
      }

      /* Mouse steering. Bound to the canvas so it only applies over the
         playfield, and it moves the bat without needing a click. */
      if (g.canvas) {
        g.canvas.addEventListener('pointermove', function (event) {
          if (g.state !== 'playing') return;
          var p = g.pointAt(event);
          bat = Math.max(BAT_W / 2, Math.min(W - BAT_W / 2, p.x));
        });
        g.canvas.addEventListener('pointerdown', function () { launch(); });
      }

      function draw(ctx) {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, W, H);

        for (var i = 0; i < bricks.length; i++) {
          var b = bricks[i];
          ctx.fillStyle = TINTS[b.hp] || '#94a3b8';
          ctx.fillRect(b.x + 1, b.y + 1, BRICK_W - 2, BRICK_H - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fillRect(b.x + 1, b.y + 1, BRICK_W - 2, 2);
        }

        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(bat - BAT_W / 2, BAT_Y, BAT_W, BAT_H);

        ctx.beginPath();
        ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();

        if (stuck && g.state === 'playing') {
          ctx.fillStyle = 'rgba(226,232,240,0.75)';
          ctx.font = '11px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Space, or tap, to launch', W / 2, BAT_Y - 22);
        }
      }

      return {
        reset: function () {
          lives = 3;
          level = 0;
          speed = 130;
          bat = W / 2;
          g.stat('lives', 3);
          g.stat('level', 1);
          buildLevel(0);
          resetBall();
        },

        key: function (name) {
          if (name === 'action') launch();
        },

        update: function (dt) {
          /* Held arrows move the bat. Read from g.held so a held key
             produces smooth motion rather than OS key-repeat stutter. */
          var move = 300 * dt;
          if (g.held.left) bat -= move;
          if (g.held.right) bat += move;
          bat = Math.max(BAT_W / 2, Math.min(W - BAT_W / 2, bat));
          step(dt);
        },

        draw: draw
      };
    }
  });
})();

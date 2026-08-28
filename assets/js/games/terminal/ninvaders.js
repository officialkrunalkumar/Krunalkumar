/* ==========================================================================
   ninvaders.js — terminal Space Invaders.
   --------------------------------------------------------------------------
   The formation moves as ONE body: it steps sideways until any surviving
   alien touches an edge, then the whole block drops a row and reverses. That
   is why killing the outer columns first makes the swarm range wider and
   drop less often — a real tactic, and it falls out of the rule rather than
   being coded in.

   Speed is a function of how many are left, so the last alien is always the
   fastest. The original arcade machine got that behaviour by accident (fewer
   sprites meant a shorter draw loop); here it is deliberate.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 60;
  var ROWS = 24;
  var AL_COLS = 10;
  var AL_ROWS = 4;
  var SHIP_Y = ROWS - 3;

  var GLYPH = ['W', 'M', 'X', 'o'];               // by row, top scores most
  var TINT = ['magenta', 'red', 'yellow', 'green'];
  var VALUE = [40, 30, 20, 10];

  TermShell.define({
    id: 'game-ninvaders',
    slug: 'ninvaders',
    title: 'nInvaders',
    cols: COLS,
    rows: ROWS,
    startTitle: 'nInvaders',
    startText: 'Arrows to move, Space to fire. They speed up as you thin them out.',

    setup: function (g, t) {
      var aliens = [];        // { x, y, row, alive }
      var ax = 0;             // formation offset
      var ay = 0;
      var dir = 1;
      var stepAcc = 0;
      var ship = COLS / 2;
      var shots = [];         // player bullets { x, y }
      var bombs = [];         // alien bombs
      var lives = 3;
      var wave = 1;
      var bunkers = [];       // { x, y, hp }

      function buildWave() {
        aliens = [];
        for (var r = 0; r < AL_ROWS; r++) {
          for (var c = 0; c < AL_COLS; c++) {
            aliens.push({ cx: c * 4, cy: r * 2, row: r, alive: true });
          }
        }
        ax = 4;
        ay = 2;
        dir = 1;
        shots = [];
        bombs = [];
        bunkers = [];
        for (var b = 0; b < 4; b++) {
          for (var w = 0; w < 3; w++) {
            bunkers.push({ x: 8 + b * 14 + w, y: SHIP_Y - 3, hp: 3 });
          }
        }
      }

      function living() {
        var n = 0;
        for (var i = 0; i < aliens.length; i++) if (aliens[i].alive) n++;
        return n;
      }

      /* One sideways (or downward) step of the whole formation. */
      function stepFormation() {
        var minX = 999, maxX = -999, maxY = -999;
        for (var i = 0; i < aliens.length; i++) {
          if (!aliens[i].alive) continue;
          var x = ax + aliens[i].cx;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          var y = ay + aliens[i].cy;
          if (y > maxY) maxY = y;
        }
        if (minX === 999) return;

        if ((dir > 0 && maxX + dir >= COLS - 1) || (dir < 0 && minX + dir <= 1)) {
          dir = -dir;
          ay += 1;
          if (ay + maxY - (ay - 1) >= SHIP_Y - 1) { /* handled by the reach test below */ }
        } else {
          ax += dir;
        }

        // Reached the ship's row: the run is over regardless of lives.
        for (var k = 0; k < aliens.length; k++) {
          if (aliens[k].alive && ay + aliens[k].cy >= SHIP_Y - 1) {
            g.over({ message: 'They landed. Wave ' + wave + '.' });
            return;
          }
        }

        // Someone drops a bomb, more often as the wave thins.
        if (Math.random() < 0.35) {
          var shooters = [];
          for (var s = 0; s < aliens.length; s++) if (aliens[s].alive) shooters.push(aliens[s]);
          if (shooters.length) {
            var pick = shooters[Math.floor(Math.random() * shooters.length)];
            bombs.push({ x: ax + pick.cx, y: ay + pick.cy + 1 });
          }
        }
      }

      function hitBunker(x, y) {
        for (var i = 0; i < bunkers.length; i++) {
          if (bunkers[i].hp > 0 && bunkers[i].x === Math.round(x) && bunkers[i].y === Math.round(y)) {
            bunkers[i].hp--;
            return true;
          }
        }
        return false;
      }

      function loseLife(reason) {
        lives--;
        g.stat('lives', Math.max(0, lives));
        g.sweep(300, 100, 0.4);
        bombs = [];
        if (lives <= 0) g.over({ message: reason + ' on wave ' + wave + '.' });
      }

      return {
        reset: function () {
          lives = 3;
          wave = 1;
          ship = Math.floor(COLS / 2);
          stepAcc = 0;
          g.stat('lives', 3);
          g.stat('wave', 1);
          buildWave();
        },

        key: function (name) {
          if (name === 'action') {
            if (shots.length < 2) {                 // the original's two-shot limit
              shots.push({ x: ship, y: SHIP_Y - 1 });
              g.beep(880, 0.03, 'square', 0.03);
            }
          }
        },

        update: function (dt) {
          if (g.held.left) ship -= 26 * dt;
          if (g.held.right) ship += 26 * dt;
          ship = Math.max(1, Math.min(COLS - 2, ship));

          /* The fewer left, the faster they come. */
          var n = living();
          var interval = Math.max(0.09, 0.55 * (n / (AL_COLS * AL_ROWS)) + 0.08);
          stepAcc += dt;
          while (stepAcc >= interval) {
            stepAcc -= interval;
            stepFormation();
            if (g.state !== 'playing') return;
          }

          for (var s = shots.length - 1; s >= 0; s--) {
            shots[s].y -= 34 * dt;
            if (shots[s].y < 1) { shots.splice(s, 1); continue; }
            if (hitBunker(shots[s].x, shots[s].y)) { shots.splice(s, 1); continue; }
            var hit = false;
            for (var a = 0; a < aliens.length; a++) {
              if (!aliens[a].alive) continue;
              if (Math.round(shots[s].x) === ax + aliens[a].cx && Math.round(shots[s].y) === ay + aliens[a].cy) {
                aliens[a].alive = false;
                g.addScore(VALUE[aliens[a].row]);
                g.beep(440, 0.04, 'square');
                hit = true;
                break;
              }
            }
            if (hit) shots.splice(s, 1);
          }

          for (var b = bombs.length - 1; b >= 0; b--) {
            bombs[b].y += 13 * dt;
            if (bombs[b].y >= ROWS - 1) { bombs.splice(b, 1); continue; }
            if (hitBunker(bombs[b].x, bombs[b].y)) { bombs.splice(b, 1); continue; }
            if (Math.round(bombs[b].y) === SHIP_Y && Math.abs(bombs[b].x - ship) < 1.6) {
              bombs.splice(b, 1);
              loseLife('Shot down');
              if (g.state !== 'playing') return;
            }
          }

          if (!living()) {
            wave++;
            g.stat('wave', wave);
            g.addScore(150);
            g.beep(900, 0.15, 'sine');
            buildWave();
          }
        },

        draw: function (term) {
          term.clear();
          term.text(1, 0, 'nINVADERS', 'green');
          term.text(14, 0, 'score ' + g.score + '   wave ' + wave + '   lives ' + Math.max(0, lives), 'dim');

          for (var i = 0; i < aliens.length; i++) {
            if (!aliens[i].alive) continue;
            term.put(ax + aliens[i].cx, ay + aliens[i].cy, GLYPH[aliens[i].row], TINT[aliens[i].row]);
          }
          for (var b = 0; b < bunkers.length; b++) {
            if (bunkers[b].hp <= 0) continue;
            term.put(bunkers[b].x, bunkers[b].y, bunkers[b].hp === 3 ? '#' : bunkers[b].hp === 2 ? '=' : '-', 'dim');
          }
          for (var s = 0; s < shots.length; s++) term.put(Math.round(shots[s].x), Math.round(shots[s].y), '|', 'white');
          for (var m = 0; m < bombs.length; m++) term.put(Math.round(bombs[m].x), Math.round(bombs[m].y), '!', 'red');

          term.put(Math.round(ship) - 1, SHIP_Y, '/', 'cyan');
          term.put(Math.round(ship), SHIP_Y, 'A', 'cyan');
          term.put(Math.round(ship) + 1, SHIP_Y, '\\', 'cyan');
          for (var f = 0; f < COLS; f++) term.put(f, ROWS - 1, '=', 'dark');
        }
      };
    }
  });
})();

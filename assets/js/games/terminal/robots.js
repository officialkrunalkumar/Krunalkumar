/* ==========================================================================
   robots.js — the BSD games classic. They chase you; they cannot steer.
   --------------------------------------------------------------------------
   You move one square. Every robot then moves one square directly towards
   you. Robots that collide — with each other or with a wreck — become a
   wreck, and wrecks kill any robot that walks into them.

   So the whole game is a geometry problem: you are not running away, you are
   arranging collisions. The robots have no pathfinding at all, which is
   exactly what makes them exploitable, and realising that is the moment the
   game clicks.

   Two escapes, both from the original: a safe teleport (limited) and a
   random one (unlimited, and it can drop you next to a robot). "Wait" runs
   the clock to the end of the level and is how you score well once you have
   herded everything into one pile.
   ========================================================================== */

(function () {
  'use strict';

  var W = 58;
  var H = 20;
  var OX = 1;
  var OY = 2;

  TermShell.define({
    id: 'game-robots',
    slug: 'robots',
    title: 'Robots',
    cols: 60,
    rows: 24,
    startTitle: 'Robots',
    startText: 'Arrows move one square. Every robot moves one square towards you. Make them crash into each other.',

    setup: function (g, t) {
      var px = 0, py = 0;
      var robots = [];        // { x, y }
      var wrecks = {};        // "x,y" -> true
      var level = 1;
      var safeTeleports = 0;
      var waiting = false;
      var waitAcc = 0;
      var message = '';

      var teleBtn = document.getElementById('game-teleport');
      var waitBtn = document.getElementById('game-wait');
      if (teleBtn) teleBtn.addEventListener('click', function () { teleport(false); });
      if (waitBtn) waitBtn.addEventListener('click', startWait);

      function key(x, y) { return x + ',' + y; }
      function occupied(x, y) {
        if (wrecks[key(x, y)]) return true;
        for (var i = 0; i < robots.length; i++) if (robots[i].x === x && robots[i].y === y) return true;
        return false;
      }

      function buildLevel() {
        robots = [];
        wrecks = {};
        waiting = false;
        message = '';
        var count = Math.min(level * 4 + 4, 60);
        /* Place the player first, then robots anywhere else — the original
           allows a robot adjacent at the start, which is survivable and
           keeps the opening tense. */
        px = Math.floor(W / 2);
        py = Math.floor(H / 2);
        var placed = 0;
        var guard = 0;
        while (placed < count && guard < 5000) {
          guard++;
          var x = Math.floor(Math.random() * W);
          var y = Math.floor(Math.random() * H);
          if (x === px && y === py) continue;
          if (occupied(x, y)) continue;
          robots.push({ x: x, y: y });
          placed++;
        }
        g.stat('level', level);
        g.stat('robots', robots.length);
        g.stat('teleports', safeTeleports);
      }

      function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

      /* One turn: the player has already moved, now everything else does. */
      function advance() {
        var next = [];
        for (var i = 0; i < robots.length; i++) {
          next.push({
            x: robots[i].x + sign(px - robots[i].x),
            y: robots[i].y + sign(py - robots[i].y)
          });
        }

        /* Count how many robots land on each square. Two or more is a pile-
           up, and so is landing on an existing wreck. */
        var tally = {};
        for (var n = 0; n < next.length; n++) {
          var k = key(next[n].x, next[n].y);
          tally[k] = (tally[k] || 0) + 1;
        }

        var survivors = [];
        for (var r = 0; r < next.length; r++) {
          var k2 = key(next[r].x, next[r].y);
          if (tally[k2] > 1 || wrecks[k2]) {
            if (!wrecks[k2]) { wrecks[k2] = true; g.addScore(10); }
          } else {
            survivors.push(next[r]);
          }
        }
        robots = survivors;
        g.stat('robots', robots.length);

        // Caught?
        for (var c = 0; c < robots.length; c++) {
          if (robots[c].x === px && robots[c].y === py) {
            g.over({ message: 'Caught on level ' + level + ' with ' + robots.length + ' robots still moving.' });
            return false;
          }
        }
        if (wrecks[key(px, py)]) {
          g.over({ message: 'You walked into a wreck on level ' + level + '.' });
          return false;
        }

        if (!robots.length) {
          level++;
          safeTeleports += 1;
          g.addScore(level * 25);
          g.beep(880, 0.12, 'sine');
          message = 'Level cleared';
          buildLevel();
        }
        return true;
      }

      function move(dx, dy) {
        if (g.state !== 'playing' || waiting) return;
        var nx = px + dx, ny = py + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) return;
        if (wrecks[key(nx, ny)]) { message = 'A wreck is in the way'; return; }
        px = nx; py = ny;
        message = '';
        advance();
      }

      function teleport(safe) {
        if (g.state !== 'playing' || waiting) return;
        var guard = 0;
        while (guard < 4000) {
          guard++;
          var x = Math.floor(Math.random() * W);
          var y = Math.floor(Math.random() * H);
          if (occupied(x, y)) continue;
          if (safe) {
            /* A safe teleport must land somewhere no robot can reach next
               turn — that is what makes it worth hoarding. */
            var risky = false;
            for (var i = 0; i < robots.length; i++) {
              if (Math.abs(robots[i].x - x) <= 1 && Math.abs(robots[i].y - y) <= 1) { risky = true; break; }
            }
            if (risky) continue;
            safeTeleports--;
            g.stat('teleports', safeTeleports);
          }
          px = x; py = y;
          message = safe ? 'Safe teleport' : 'Teleported — good luck';
          g.beep(600, 0.06, 'sine');
          advance();
          return;
        }
        message = 'Nowhere to teleport to';
      }

      /* Wait runs turns automatically until the level ends, one way or the
         other. It is how you cash in a board you have already solved. */
      function startWait() {
        if (g.state !== 'playing' || !robots.length) return;
        waiting = true;
        waitAcc = 0;
        message = 'Waiting…';
      }

      return {
        reset: function () {
          level = 1;
          safeTeleports = 2;
          buildLevel();
        },

        key: function (name) {
          if (name === 'up') move(0, -1);
          else if (name === 'down') move(0, 1);
          else if (name === 'left') move(-1, 0);
          else if (name === 'right') move(1, 0);
          else if (name === 'action') {
            if (safeTeleports > 0) teleport(true);
            else teleport(false);
          }
        },

        update: function (dt) {
          if (!waiting) return;
          waitAcc += dt;
          while (waitAcc >= 0.08) {
            waitAcc -= 0.08;
            if (!robots.length) { waiting = false; break; }
            if (!advance()) { waiting = false; return; }
            if (g.state !== 'playing') { waiting = false; return; }
          }
        },

        draw: function (term) {
          term.clear();
          term.text(1, 0, 'ROBOTS', 'green');
          term.text(10, 0, 'level ' + level + '   left ' + robots.length +
                           '   safe teleports ' + safeTeleports + '   score ' + g.score, 'dim');

          term.box(OX - 1, OY - 1, W + 2, H + 2, 'dim');

          for (var k in wrecks) {
            if (!Object.prototype.hasOwnProperty.call(wrecks, k)) continue;
            var parts = k.split(',');
            term.put(OX + Number(parts[0]), OY + Number(parts[1]), '*', 'dark');
          }
          for (var i = 0; i < robots.length; i++) {
            term.put(OX + robots[i].x, OY + robots[i].y, '+', 'red');
          }
          term.put(OX + px, OY + py, '@', 'white');

          term.text(1, OY + H + 1, message || 'arrows move · space teleports', message ? 'yellow' : 'dim');
        }
      };
    }
  });
})();

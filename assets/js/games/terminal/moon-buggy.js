/* ==========================================================================
   moon-buggy.js — drive across the moon, jump the craters, shoot the rocks.
   --------------------------------------------------------------------------
   A rebuild of Jochen Voss's moon-buggy (1999), which is about as pure as a
   terminal game gets: one buggy, one ground line, and holes in it.

   THE GROUND IS A FUNCTION, NOT AN ARRAY. Terrain is generated from the
   absolute cell index through a seeded hash, so cell 40,000 is the same
   every time it is asked about and no history has to be kept. An endless
   runner that stores its terrain grows without bound; this one holds
   nothing but a distance counter.

   The buggy is fixed at column 8 and the world moves under it, which is how
   the original does it and the reason the jump arc can be tuned by feel
   rather than by chasing a camera.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 80;
  var ROWS = 24;
  var GROUND = 18;          // row the surface sits on
  var BUGGY_X = 8;

  /* FIVE cells wide, and the width matters more than it looks.
     The first version drew a 7-cell buggy and crashed only when BOTH ends
     were over a crater — but craters are 3 to 5 cells, so a 7-cell buggy
     always had at least one end on solid rock and calmly drove across every
     hole on the moon. The buggy has to be narrow enough to fall into the
     gaps it is asked to jump, so it is now narrower than the smallest
     crater, and the check below is a plain overlap. */
  var BUGGY_W = 5;

  /* Buggy art, three rows, five columns. Drawn from its bottom-left corner. */
  var BUGGY = [
    ' ___ ',
    '/---\\',
    'O---O'
  ];

  TermShell.define({
    id: 'game-moon-buggy',
    slug: 'moon-buggy',
    title: 'Moon buggy',
    cols: COLS,
    rows: ROWS,
    /* A tap on the playfield jumps. Action is the laser here, and on a phone
       the thing you urgently need is the jump, not the gun. */
    tapKey: 'up',
    startTitle: 'Moon buggy',
    startText: 'Up to jump, Space to fire. The craters will not move for you.',

    setup: function (g, t) {
      var dist = 0;           // cells travelled, fractional
      var speed = 14;         // cells per second
      var lives = 3;
      var jumpY = 0;          // height above the ground, in cells
      var jumpV = 0;
      var airborne = false;
      var lasers = [];        // { x, y } in world cells
      var rocks = {};         // world index -> true once shot
      var crashAt = -1;
      var crashTimer = 0;

      /* Deterministic terrain. mulberry-ish integer hash of the cell index:
         same input, same crater, forever. */
      function hash(n) {
        n = (n ^ 61) ^ (n >>> 16);
        n = n + (n << 3);
        n = n ^ (n >>> 4);
        n = Math.imul(n, 0x27d4eb2d);
        n = n ^ (n >>> 15);
        return (n >>> 0) / 4294967296;
      }

      /* Craters: runs of 3-5 missing cells, one candidate site every 26
         cells, taken about 42% of the time — so roughly one crater every
         60 metres.

         BOTH numbers are set against the jump, and the first version had
         them wrong in a way that made the game close to unwinnable. Sites
         were every 14 cells while a jump covers about 14, which meant the
         buggy routinely landed one cell short of the next hole and had to
         jump again on the frame it touched down. An autopilot with perfect
         knowledge of the terrain still died inside 150 metres. Spacing the
         sites at 26 leaves a full buggy-length of runway between landing
         and the next lip, which is the difference between a game that
         demands timing and one that demands luck.

         THE FIRST 90 CELLS ARE FLAT — about six seconds at the starting
         speed. The run-in used to be 40, so the first hole arrived two and
         a bit seconds in, before a new player had finished reading the
         screen, and the game opened by killing you for something you had
         not been shown yet. */
      function craterAt(i) {
        if (i < 90) return false;
        var block = Math.floor(i / 26);
        if (hash(block) > 0.42) return false;
        var start = block * 26 + 8;
        var width = 3 + Math.floor(hash(block + 7777) * 3);   // 3..5
        return i >= start && i < start + width;
      }

      /* Rocks are an occasional extra, NOT the main hazard — craters are.
         At the first density (2.5% of cells) a rock landed every 40 metres
         with two on screen at any moment, and an autopilot that jumped every
         crater perfectly still died to a rock inside two hundred metres.
         That made the rocks the game and the craters scenery, which is
         backwards. 0.4% puts one every 250 metres or so: something to notice
         and shoot, not a second thing to dodge every few seconds.

         They are also kept three cells clear of any crater, so the game
         never asks for a jump and a shot in the same moment — two correct
         inputs on one frame is a difficulty spike, not a skill test. */
      function rockAt(i) {
        if (i < 60) return false;
        if (rocks[i]) return false;                            // already shot
        for (var c = -3; c <= 3; c++) {
          if (craterAt(i + c)) return false;
        }
        return hash(i + 31337) > 0.996;
      }

      function reset() {
        dist = 0;
        speed = 14;
        lives = 3;
        jumpY = 0;
        jumpV = 0;
        airborne = false;
        lasers = [];
        rocks = {};
        crashAt = -1;
        crashTimer = 0;
        g.stat('lives', lives);
        g.stat('distance', 0);
      }

      function jump() {
        if (airborne || crashAt >= 0) return;
        airborne = true;
        /* Tuned against the widest crater. Airtime is 2v/g = 1.04 s, of
           which ~0.96 s is spent clear of the surface, so at the opening
           speed of 14 cells a second a jump covers about 13 cells. The
           worst case that has to be cleared is the buggy's 5 plus a 5-cell
           crater, so there is real margin — the difficulty is in timing the
           press, not in whether the jump is physically long enough. */
        jumpV = 12.5;
        g.beep(420, 0.06, 'square', 0.04);
      }

      function fire() {
        if (crashAt >= 0) return;
        if (lasers.length >= 3) return;                        // the original's limit
        lasers.push({ x: dist + BUGGY_X + BUGGY_W, y: GROUND - 1 - Math.round(jumpY) });
        g.beep(900, 0.03, 'square', 0.03);
      }

      function crash(reason) {
        if (crashAt >= 0) return;
        lives -= 1;
        g.stat('lives', Math.max(0, lives));
        crashAt = Math.floor(dist);
        crashTimer = 0.9;
        g.sweep(280, 90, 0.4);
        if (lives <= 0) {
          g.over({
            score: Math.floor(dist),
            message: reason + ' after ' + Math.floor(dist) + ' metres.'
          });
        }
      }

      return {
        reset: reset,

        key: function (name) {
          if (name === 'up') jump();
          else if (name === 'action') fire();
        },

        update: function (dt) {
          if (crashAt >= 0) {
            crashTimer -= dt;
            if (crashTimer <= 0 && g.state === 'playing') {
              /* Respawn a little way back, on ground that is definitely
                 flat, so you are not dropped straight into the crater
                 that just killed you. */
              crashAt = -1;
              dist = Math.max(0, dist - 12);
              /* Back up until every cell under the buggy is solid — the
                 same whole-width test the crash check uses, so a respawn
                 can never drop you straight back into the hole. */
              var safe = false, guard = 0;
              while (!safe && guard < 200) {
                safe = true; guard++;
                for (var c = 0; c < BUGGY_W; c++) {
                  if (craterAt(Math.floor(dist) + BUGGY_X + c)) { safe = false; break; }
                }
                if (!safe) dist -= 1;
                if (dist < 0) { dist = 0; break; }
              }
              jumpY = 0; jumpV = 0; airborne = false;
              lasers = [];
            }
            return;
          }

          dist += speed * dt;
          /* Capped at 22, not 30. Airtime is fixed, so a faster buggy jumps
             FURTHER — at 30 cells a second a jump covers 29 cells and can
             carry you from one crater straight into the next site 26 cells
             along, which is a death you cannot see coming or prevent. 22
             keeps the longest jump (about 21 cells) safely shorter than the
             gap between sites at every speed the game reaches. */
          speed = Math.min(22, 14 + dist / 500);              // gently faster
          g.stat('distance', Math.floor(dist));
          g.setScore(Math.floor(dist));

          if (airborne) {
            jumpY += jumpV * dt;
            jumpV -= 24 * dt;                                  // gravity
            if (jumpY <= 0) { jumpY = 0; jumpV = 0; airborne = false; }
          }

          // Lasers travel forward and pop the rock they meet
          for (var l = lasers.length - 1; l >= 0; l--) {
            lasers[l].x += 48 * dt;
            if (lasers[l].x > dist + COLS) { lasers.splice(l, 1); continue; }
            var cell = Math.round(lasers[l].x);
            if (rockAt(cell) && lasers[l].y === GROUND - 1) {
              rocks[cell] = true;
              lasers.splice(l, 1);
              g.addScore(25);
              g.beep(660, 0.05, 'square');
            }
          }

          /* Collision. ANY cell under the buggy being a crater is a fall —
             the road is cut, so there is nothing to drive on. The earlier
             version asked for both ends to be over the hole, which with a
             buggy wider than a crater was never true, so it drove over
             every one of them.

             jumpY has to be genuinely clear of the surface before the check
             is skipped, or a buggy one frame into its jump is still counted
             as grounded. Half a cell is enough to be unambiguous and small
             enough that a late jump still fails, which it should. */
          var left = Math.floor(dist) + BUGGY_X;
          var right = left + BUGGY_W - 1;
          if (jumpY < 0.5) {
            for (var x = left; x <= right; x++) {
              if (craterAt(x)) { crash('Into a crater'); return; }
              if (rockAt(x)) { crash('Hit a rock'); return; }
            }
          }
        },

        draw: function (term) {
          term.clear();

          // Stars, fixed to world position so they scroll with the surface
          for (var s = 0; s < COLS; s++) {
            var world = Math.floor(dist) + s;
            if (hash(world * 3 + 5) > 0.985) {
              term.put(s, 1 + Math.floor(hash(world * 7) * 10), '.', 'dim');
            }
          }

          term.text(2, 1, 'MOON BUGGY', 'dim');
          term.text(COLS - 22, 1, 'metres ' + Math.floor(dist), 'dim');
          term.text(COLS - 10, 1, 'buggies ' + Math.max(0, lives), 'dim');

          // The surface
          for (var i = 0; i < COLS; i++) {
            var world2 = Math.floor(dist) + i;
            if (craterAt(world2)) continue;
            term.put(i, GROUND, '_', 'grey');
            term.put(i, GROUND + 1, '#', 'dark');
            if (rockAt(world2)) term.put(i, GROUND - 1, '^', 'orange');
          }

          // Lasers
          for (var k = 0; k < lasers.length; k++) {
            term.put(Math.round(lasers[k].x - Math.floor(dist)), lasers[k].y, '-', 'red');
          }

          // The buggy
          var by = GROUND - 1 - Math.round(jumpY);
          if (crashAt >= 0) {
            term.text(BUGGY_X, by, '  ***  ', 'red');
            term.text(BUGGY_X, by - 1, ' *   * ', 'yellow');
            term.centre(GROUND + 4, lives > 0 ? 'CRASH — ' + lives + ' left' : 'CRASH', 'red');
          } else {
            for (var r = 0; r < BUGGY.length; r++) {
              term.text(BUGGY_X, by - (BUGGY.length - 1 - r), BUGGY[r], r === 2 ? 'yellow' : 'green');
            }
          }

          term.centre(ROWS - 2, '↑ jump    space fire', 'dim');
        }
      };
    }
  });
})();

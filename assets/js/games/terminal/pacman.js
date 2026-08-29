/* ==========================================================================
   pacman.js — Pac-Man on a character grid.
   --------------------------------------------------------------------------
   Three decisions carry this file.

   1. THE FOUR GHOSTS RUN FOUR DIFFERENT RULES, AND THAT IS THE GAME. Give
      every ghost the same "step towards Pac-Man" rule and you get a clump:
      four bodies on one tile, moving as one, trivially outrun by circling a
      block. Toru Iwatani's answer was to make each one wrong in a different
      direction, so the group covers ground no single rule would. Here:
      red walks at your tile; magenta walks at the tile four ahead of your
      nose, so it cuts you off rather than following; cyan alternates every
      six seconds between hunting you and retreating to its own corner, which
      is what periodically opens an escape route; orange mostly wanders at
      random and only sometimes remembers you exist. Together they surround.
      Separately, each is beatable — which is why the game is fair.

   2. THE TURN YOU ASKED FOR IS REMEMBERED FOR HALF A SECOND. Movement is
      tile-by-tile, so a turn pressed a few pixels before the junction would
      otherwise be thrown away and you would sail past the corner. The
      requested direction is held and applied on the first tick it becomes
      legal. It expires after 0.55 s on purpose: hold it forever and a turn
      you pressed and forgot fires at a junction three corridors later.

   3. THE HOUSE DOOR IS ONE-WAY BY ROLE, NOT BY GEOMETRY. The '-' tiles are
      walkable for a ghost that is still penned or is returning as eyes, and
      solid for everyone else — including a ghost that has already left. That
      one predicate is the whole ghost-house lifecycle: released ghosts head
      for the tile above the door and can never go back in, eaten ones head
      for the middle of the house and are re-penned when they arrive.

   ES5, as everything under assets/js is.
   ========================================================================== */

(function () {
  'use strict';

  /* 28 x 21. '#' wall, '.' dot, 'o' power pellet, '-' ghost-house door,
     ' ' walkable but empty. Row 11 has open ends: that is the tunnel. The
     two blank tiles in row 17 are where Pac-Man starts, so the dot count
     and the board agree without special-casing the start tile. */
  var MAZE = [
    '############################',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o####.#####.##.#####.####o#',
    '#.####.#####.##.#####.####.#',
    '#..........................#',
    '#.####.##.########.##.####.#',
    '#......##....##....##......#',
    '######.##### ## #####.######',
    '######.###        ###.######',
    '######.### ##--## ###.######',
    '     ..... #    # .....     ',
    '######.### ###### ###.######',
    '######.###        ###.######',
    '######.##### ## #####.######',
    '#............##............#',
    '#.####.#####.##.#####.####.#',
    '#o..##.......  .......##..o#',
    '###.##.##.########.##.##.###',
    '#......##....##....##......#',
    '############################'
  ];

  var W = 28;
  var H = 21;
  var OX = 1;              // the grid is 30 x 24; the maze sits inset by one
  var OY = 2;

  var HOME = { x: 13, y: 11 };    // middle of the house: where eyes return to
  var EXIT = { x: 13, y: 9 };     // the tile just above the door

  var UP = { x: 0, y: -1, face: '^' };
  var DOWN = { x: 0, y: 1, face: 'v' };
  var LEFT = { x: -1, y: 0, face: '<' };
  var RIGHT = { x: 1, y: 0, face: '>' };
  var DIRS = [UP, DOWN, LEFT, RIGHT];
  var BY_NAME = { up: UP, down: DOWN, left: LEFT, right: RIGHT };

  var FRIGHT = 6.5;        // seconds a pellet keeps the ghosts edible
  var BUFFER = 0.55;       // how long a requested turn is remembered
  var PAC_SPEED = 7.6;     // tiles per second

  TermShell.define({
    id: 'game-pacman',
    slug: 'pacman',
    title: 'Pac-Man',
    cols: 30,
    rows: 24,
    bestKey: 'pacman',
    startTitle: 'Pac-Man',
    startText: 'Arrows or the pad. Eat every dot. The four pellets in the corners make the ghosts edible for a few seconds.',

    setup: function (g) {
      var food = [];         // 0 empty, 1 dot, 2 power pellet
      var left = 0;
      var pellets = 0;
      var lives = 3;
      var pac = null;
      var ghosts = [];
      var want = null;
      var wantAge = 0;
      var mouth = true;
      var pacAcc = 0;
      var fright = 0;
      var chain = 0;         // ghosts eaten since the last pellet
      var freeze = 0;
      var blink = 0;
      var base = 6.6;        // ghost tiles per second

      /* Difficulty is read live rather than cached at reset, so a player who
         finds a run too fast can slow it down without losing the board. */
      var speedSel = document.getElementById('game-speed');
      if (speedSel) {
        base = Number(speedSel.value) || 6.6;
        speedSel.addEventListener('change', function () {
          base = Number(speedSel.value) || 6.6;
        });
      }

      function wrapX(x) {
        if (x < 0) return W - 1;
        if (x >= W) return 0;
        return x;
      }

      function tileAt(x, y) {
        if (y < 0 || y >= H) return '#';
        return MAZE[y].charAt(wrapX(x));
      }

      function inHouseBox(x, y) {
        return y === 11 && x >= 12 && x <= 15;
      }

      /* Pac-Man's rule: everything except walls and the door. */
      function pacCan(x, y) {
        var c = tileAt(x, y);
        return c !== '#' && c !== '-';
      }

      /* See decision 3 in the header. */
      function ghostCan(gh, x, y) {
        var c = tileAt(x, y);
        if (c === '#') return false;
        var privileged = gh.inHouse || gh.eaten;
        if (c === '-') return privileged;
        if (!privileged && inHouseBox(x, y)) return false;
        return true;
      }

      function mk(kind, colour, x, y, pen, penned, cx, cy) {
        return {
          kind: kind,
          colour: colour,
          x: x, y: y, px: x, py: y,
          dir: LEFT,
          acc: 0,
          pen: pen,
          inHouse: penned,
          eaten: false,
          spent: false,          // eaten once this fright window; revives dangerous
          bob: 1,
          away: false,
          timer: 0,
          corner: { x: cx, y: cy }
        };
      }

      /* Positions only — the board and the score survive a lost life. */
      function place() {
        pac = { x: 13, y: 17, px: 13, py: 17, dir: LEFT };
        want = null;
        wantAge = 0;
        mouth = true;
        pacAcc = 0;
        fright = 0;
        chain = 0;
        ghosts = [
          mk('chase', 'red', 13, 9, 0, false, 26, 1),
          mk('ahead', 'magenta', 12, 11, 2.0, true, 1, 1),
          mk('patrol', 'cyan', 14, 11, 5.0, true, 26, 19),
          mk('erratic', 'orange', 15, 11, 8.5, true, 1, 19)
        ];
      }

      function reset() {
        food = [];
        left = 0;
        pellets = 0;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var c = MAZE[y].charAt(x);
            var v = c === '.' ? 1 : (c === 'o' ? 2 : 0);
            food[y * W + x] = v;
            if (v) left++;
            if (v === 2) pellets++;
          }
        }
        lives = 3;
        blink = 0;
        place();
        freeze = 1.0;
        g.stat('lives', lives);
        g.stat('dots', left);
      }

      /* -------------------------------------------------------------
         Pac-Man
         ------------------------------------------------------------- */
      function stepPac() {
        /* The buffered turn, applied the moment it becomes legal — see
           decision 2. Applying it does not clear it; expiry does. */
        if (want && pacCan(pac.x + want.x, pac.y + want.y)) pac.dir = want;

        var nx = wrapX(pac.x + pac.dir.x);
        var ny = pac.y + pac.dir.y;
        if (!pacCan(nx, ny)) return;      // nose against a wall: stand still

        pac.px = pac.x;
        pac.py = pac.y;
        pac.x = nx;
        pac.y = ny;
        mouth = !mouth;                   // the chomp is tied to movement
        eat();
      }

      function eat() {
        var i = pac.y * W + pac.x;
        var v = food[i];
        if (!v) return;
        food[i] = 0;
        left--;
        g.stat('dots', left);

        if (v === 1) {
          g.addScore(10);
          g.beep(mouth ? 520 : 440, 0.025, 'square', 0.025);
        } else {
          g.addScore(50);
          pellets--;
          fright = FRIGHT;
          chain = 0;
          /* Every ghost turns round the instant a pellet goes. Without the
             reversal a ghost already on top of you simply eats you during
             the frightened window, which reads as a bug. A fresh pellet
             also re-arms any ghost spent during the previous window. */
          for (var k = 0; k < ghosts.length; k++) {
            ghosts[k].spent = false;
            turnRound(ghosts[k]);
          }
          g.beep(180, 0.22, 'sawtooth', 0.055);
        }

        if (!left) {
          g.over({
            won: true,
            score: g.score,
            title: 'Maze cleared',
            message: 'Every dot and all four pellets, with ' + lives + ' live' +
              (lives === 1 ? '' : 's') + ' left.'
          });
        }
      }

      function turnRound(gh) {
        if (gh.eaten || gh.pen > 0) return;
        var r = gh.dir === UP ? DOWN : gh.dir === DOWN ? UP : gh.dir === LEFT ? RIGHT : LEFT;
        if (ghostCan(gh, gh.x + r.x, gh.y + r.y)) gh.dir = r;
      }

      /* -------------------------------------------------------------
         Ghosts
         ------------------------------------------------------------- */
      /* Returns the tile a ghost is steering at, or null for "pick at
         random". This function is the whole difference between the four —
         see decision 1. */
      function targetFor(gh) {
        if (gh.eaten) return HOME;
        if (gh.inHouse) return EXIT;
        if (fright > 0 && !gh.spent) return null;
        if (gh.kind === 'chase') return pac;
        if (gh.kind === 'ahead') {
          return { x: pac.x + pac.dir.x * 4, y: pac.y + pac.dir.y * 4 };
        }
        if (gh.kind === 'patrol') return gh.away ? gh.corner : pac;
        /* Erratic. Mostly wandering, occasionally lucid — a purely random
           ghost never threatens anything and stops being a fourth player. */
        return Math.random() < 0.35 ? pac : null;
      }

      function bob(gh) {
        var nx = gh.x + gh.bob;
        if (nx < 12 || nx > 15) {
          gh.bob = -gh.bob;
          nx = gh.x + gh.bob;
        }
        gh.px = gh.x;
        gh.py = gh.y;
        gh.x = nx;
      }

      function stepGhost(gh) {
        if (gh.pen > 0) { bob(gh); return; }

        var opts = [];
        var i, d, nx, ny;
        for (i = 0; i < DIRS.length; i++) {
          d = DIRS[i];
          /* Never reverse mid-corridor. This is what stops a ghost jittering
             on the spot when two directions are equally close to the target,
             and it is why corridors funnel them into junctions at all. */
          if (d.x === -gh.dir.x && d.y === -gh.dir.y) continue;
          if (!ghostCan(gh, gh.x + d.x, gh.y + d.y)) continue;
          opts.push(d);
        }
        if (!opts.length) {
          d = gh.dir === UP ? DOWN : gh.dir === DOWN ? UP : gh.dir === LEFT ? RIGHT : LEFT;
          if (!ghostCan(gh, gh.x + d.x, gh.y + d.y)) return;   // walled in
          opts.push(d);
        }

        var target = targetFor(gh);
        var choice;
        if (!target) {
          choice = opts[Math.floor(Math.random() * opts.length)];
        } else {
          var bestD = Infinity;
          choice = opts[0];
          for (i = 0; i < opts.length; i++) {
            nx = wrapX(gh.x + opts[i].x);
            ny = gh.y + opts[i].y;
            var dx = nx - target.x;
            var dy = ny - target.y;
            var dd = dx * dx + dy * dy;
            if (dd < bestD) { bestD = dd; choice = opts[i]; }
          }
        }

        gh.dir = choice;
        gh.px = gh.x;
        gh.py = gh.y;
        gh.x = wrapX(gh.x + choice.x);
        gh.y = gh.y + choice.y;

        if (gh.inHouse && gh.y <= EXIT.y) gh.inHouse = false;
        if (gh.eaten && gh.x === HOME.x && gh.y === HOME.y) {
          gh.eaten = false;
          gh.inHouse = true;
          gh.pen = 1.2;
        }
      }

      function ghostStep(gh) {
        if (gh.eaten) return 1 / (base * 2.6);
        if (gh.pen > 0) return 1 / 3.5;
        if (fright > 0 && !gh.spent) return 1 / (base * 0.6);
        return 1 / base;
      }

      /* -------------------------------------------------------------
         Contact
         ------------------------------------------------------------- */
      /* Both bodies move a whole tile at a time, at different rates, so
         "same tile" is not enough: two things travelling towards each other
         can swap tiles in one step and never share one. The second clause is
         that swap. */
      function contact() {
        /* eat() can end the run one line above this call — the last dot
           goes down inside stepPac. Once the win has fired, lives and the
           score are final; a finished run must not be touched. */
        if (g.state !== 'playing') return;
        for (var i = 0; i < ghosts.length; i++) {
          var gh = ghosts[i];
          if (gh.eaten || gh.pen > 0) continue;
          var same = gh.x === pac.x && gh.y === pac.y;
          var swap = gh.x === pac.px && gh.y === pac.py &&
                     gh.px === pac.x && gh.py === pac.y;
          if (!same && !swap) continue;
          /* A ghost eaten and revived inside the same window comes back
             dangerous — the classic rule. Without it the same ghost can be
             run down again and again off one pellet and the chain never
             has to end. Only the next pellet makes it edible once more. */
          if (fright > 0 && !gh.spent) {
            chain++;
            var pts = chain >= 4 ? 1600 : 200 * Math.pow(2, chain - 1);
            g.addScore(pts);
            gh.eaten = true;
            gh.spent = true;
            g.beep(760 + chain * 120, 0.13, 'sine', 0.05);
          } else {
            die();
            return;
          }
        }
      }

      function die() {
        lives--;
        g.stat('lives', lives);
        g.beep(150, 0.45, 'sawtooth', 0.06);
        if (lives <= 0) {
          g.over({
            score: g.score,
            title: 'Caught',
            message: left + ' dot' + (left === 1 ? '' : 's') + ' still on the board.'
          });
          return;
        }
        place();
        freeze = 1.4;
      }

      /* -------------------------------------------------------------
         Touch: swipe the board as well as using the pad.
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
          if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
          if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
          else turn(dy > 0 ? 'down' : 'up');
        });
      }

      function turn(name) {
        var d = BY_NAME[name];
        if (!d) return;
        want = d;
        wantAge = 0;
      }

      /* -------------------------------------------------------------
         Drawing
         ------------------------------------------------------------- */
      function ghostGlyph(gh) {
        if (gh.eaten) return '"';
        return 'M';
      }

      function ghostColour(gh, flash) {
        if (gh.eaten) return 'dark';
        /* A revived ghost must not read as edible — blue on a ghost that
           kills you is worse than the chain bug it would advertise. */
        if (fright > 0 && !gh.spent && gh.pen <= 0) {
          return (fright < 1.8 && flash) ? 'white' : 'blue';
        }
        return gh.colour;
      }

      function draw(term) {
        term.clear();
        var flash = (Math.floor(blink * 5) % 2) === 0;

        term.text(1, 0, 'PAC-MAN', 'yellow');
        var hearts = '';
        for (var l = 0; l < lives; l++) hearts += 'C';
        term.text(10, 0, hearts, 'yellow');
        term.text(16, 0, 'dots ' + left, 'dim');

        for (var y = 0; y < H; y++) {
          var row = MAZE[y];
          for (var x = 0; x < W; x++) {
            var c = row.charAt(x);
            if (c === '#') { term.put(OX + x, OY + y, '#', 'dim'); continue; }
            if (c === '-') { term.put(OX + x, OY + y, '-', 'dark'); continue; }
            var v = food[y * W + x];
            if (v === 1) term.put(OX + x, OY + y, '.', 'grey');
            else if (v === 2 && flash) term.put(OX + x, OY + y, 'o', 'yellow');
          }
        }

        for (var i = 0; i < ghosts.length; i++) {
          var gh = ghosts[i];
          term.put(OX + gh.x, OY + gh.y, ghostGlyph(gh), ghostColour(gh, flash));
        }

        term.put(OX + pac.x, OY + pac.y, mouth ? pac.dir.face : 'O', 'yellow');

        if (freeze > 0 && g.state === 'playing') {
          term.centre(H + OY, 'READY', 'yellow');
        } else if (fright > 0) {
          term.centre(H + OY, 'RUN THEM DOWN  ' + fright.toFixed(1) + 's', 'blue');
        } else {
          /* Whatever goes here has to fit thirty columns. The pellet count is
             the one number that changes how you should be playing. */
          term.centre(H + OY, 'power pellets left: ' + pellets, 'dim');
        }
      }

      return {
        reset: reset,

        key: function (name) { turn(name); },

        update: function (dt) {
          blink += dt;

          if (freeze > 0) {
            freeze -= dt;
            if (freeze < 0) freeze = 0;
            return;
          }

          if (want) {
            wantAge += dt;
            if (wantAge > BUFFER) want = null;
          }
          if (fright > 0) {
            fright -= dt;
            if (fright <= 0) { fright = 0; chain = 0; }
          }

          var i, gh;
          for (i = 0; i < ghosts.length; i++) {
            gh = ghosts[i];
            if (gh.pen > 0) {
              gh.pen -= dt;
              if (gh.pen < 0) gh.pen = 0;
            }
            /* Only the cyan one keeps a mode clock; the other three are
               defined by a rule that never changes. */
            if (gh.kind === 'patrol' && !gh.eaten && !gh.inHouse && fright <= 0) {
              gh.timer += dt;
              if (gh.timer >= 6) {
                gh.timer = 0;
                gh.away = !gh.away;
                turnRound(gh);
              }
            }
          }

          var pacStep = 1 / PAC_SPEED;
          pacAcc += dt;
          var guard = 0;
          while (pacAcc >= pacStep && guard < 8) {
            pacAcc -= pacStep;
            guard++;
            stepPac();
            contact();
            if (g.state !== 'playing' || freeze > 0) return;
          }

          for (i = 0; i < ghosts.length; i++) {
            gh = ghosts[i];
            gh.acc += dt;
            guard = 0;
            var iv = ghostStep(gh);
            while (gh.acc >= iv && guard < 8) {
              gh.acc -= iv;
              guard++;
              stepGhost(gh);
              contact();
              if (g.state !== 'playing' || freeze > 0) return;
              iv = ghostStep(gh);
            }
          }
        },

        draw: draw
      };
    }
  });
})();

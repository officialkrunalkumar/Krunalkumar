/* ==========================================================================
   platformer.js — three tile levels, one jump button.
   --------------------------------------------------------------------------
   Two decisions here are the whole difference between this feeling like a
   platformer and feeling like a physics bug.

   1. COLLISION IS RESOLVED ONE AXIS AT A TIME. The player is moved along x,
      every solid tile it now overlaps is pushed out horizontally, and only
      then is it moved along y and pushed out vertically. The tempting
      version — add both components, find the overlapping tile, push out
      along whichever axis overlaps least — is the classic seam bug. Running
      across a flat floor made of separate tiles, the player sinks a fraction
      of a unit into the ground each frame under gravity; the next tile's
      overlap is then deeper vertically than horizontally along its left
      face, so the "smallest push" is sideways, and the runner stops dead on
      an invisible edge in the middle of a floor that is visibly flat. Doing
      x first means the vertical sink is not on the table when the horizontal
      question is asked, so a seam between two floor tiles cannot become a
      wall. It also makes the two cases mean different things, which is what
      you actually want: an x resolution is "you hit a wall", a y resolution
      downward is "you landed", and landing is the only one that clears the
      jump.

   2. THE JUMP HAS THREE FORGIVENESS RULES, and none of them are cheating.
      Coyote time keeps the jump legal for 90 ms after walking off a ledge;
      the input buffer keeps a jump pressed up to 120 ms before landing and
      fires it on touchdown; and releasing the button mid-rise clips the
      upward velocity rather than ignoring you, which is what makes a tapped
      jump short and a held one tall. Without the first two, every missed
      jump is one the player is certain they pressed — the press was real,
      it just landed in the two frames either side of contact. Sub-frame
      honesty, not generosity.

   Levels are arrays of strings, sixteen rows tall, read once into a tile
   grid with the coins, enemies, flag and spawn lifted out into objects. The
   strings stay the authoring format because a level you can see in the
   source is a level you can edit; nothing reads them again after load.

   ES5 throughout, as everything under assets/js is.
   ========================================================================== */

(function () {
  'use strict';

  var W = 480;
  var H = 320;
  var TILE = 20;

  /* Player box. Deliberately narrower than a tile so a one-tile gap between
     two blocks is a gap you can actually drop through. */
  var PW = 14;
  var PH = 18;

  /* Units per second and per second squared. GRAV and JUMP_V together fix
     the two numbers every level is built on: a full jump rises 109 units,
     which is five tiles and a fraction, so no climb ever asks for six; and
     it holds you up for 0.89 s, which at RUN_MAX carries you 116 units
     across, so no gap is ever wider than four tiles.

     The UNDERSIDE of a platform mattered more than its top, and getting it
     wrong is what set these numbers. With the low platforms three rows above
     the floor, a runner underneath one had 22 units of headroom — not enough
     of a hop to clear an enemy walking the other way, so meeting one in that
     shadow was a death with no move available. Five rows up leaves 62 units
     of headroom, which is a hop 63 units long: past a 16-unit enemy closing
     at 46, with room to spare. */
  var GRAV = 1100;
  var JUMP_V = 490;
  var JUMP_CUT = 150;        // upward speed the release clips you back to
  var RUN_MAX = 130;
  var RUN_ACC = 700;
  var AIR_ACC = 450;         // less grip in the air, so a jump commits you
  var FRICTION = 900;
  var MAX_FALL = 460;
  var COYOTE = 0.09;
  var BUFFER = 0.12;
  var STOMP_V = 300;         // the bounce off a flattened enemy

  var WALK_SPEED = 34;
  var HOP_SPEED = 46;
  var HOP_EVERY = 1.3;
  var HOP_V = 300;

  /* Camera dead zone: the player can move this far either side of centre
     before the view starts to follow. A camera hard-locked to the player
     slides under every small correction and makes reading a jump harder
     than making it. */
  var DEAD = 110;

  var L1 = [
    '                                                        ',
    '                                                        ',
    '                                                        ',
    '                                                        ',
    '                                                        ',
    '                       oo                               ',
    '                      ====                              ',
    '                                                        ',
    '                  oo              o          oe         ',
    '                 ====            ===         ===        ',
    '                                                        ',
    '             o              o           oo              ',
    '     ooo                                           oo   ',
    '  P                 e               h                F  ',
    '############   ############   ##########  ##############',
    '############   ############   ##########  ##############'
  ];
  var L2 = [
    '                                                                ',
    '                                                                ',
    '                                                                ',
    '                                                                ',
    '                                                                ',
    '                    o                                           ',
    '                   ===                                          ',
    '                                                                ',
    '                o                         oo           o        ',
    '               ===                       ====         ===       ',
    '                                                                ',
    '           o            o    oo      o           o              ',
    '    oo  o                    ## o            o             oo   ',
    '  P               h          ##  e            h           e  F  ',
    '##########   ##########   ##########   #########   #############',
    '##########   ##########   ##########   #########   #############'
  ];
  var L3 = [
    '                                                                        ',
    '                                                                        ',
    '                                                                        ',
    '                                                                        ',
    '                                                                        ',
    '                                    o                                   ',
    '                                   ===                                  ',
    '                                                                        ',
    '               o        o        o                      o         o     ',
    '              ===      ===      ===                    ===       ===    ',
    '                                                                        ',
    '     o    o        o        o           o    oo    o         o          ',
    '    o                                      o ##           o             ',
    '  P             e        h        e          ## h        e          e F ',
    '#########   ######   ######   #########   ########   #######   #########',
    '#########   ######   ######   #########   ########   #######   #########'
  ];

  var LEVELS = [L1, L2, L3];

  GameShell.define({
    id: 'game-platformer',
    slug: 'platformer',
    title: 'Platformer',
    width: W,
    height: H,
    pixel: true,
    bestKey: 'platformer',
    /* A tap on the playfield jumps. In a game whose entire input is "now",
       the thumb should not have to find a button in the corner. */
    tapKey: 'up',
    startTitle: 'Platformer',
    startText: 'Left and right to run, Up or Space to jump. Hold the button to jump higher. Land on an enemy to flatten it.',

    setup: function (g) {
      /* ---- level state, rebuilt by loadLevel ---- */
      var grid = [];            // terrain only: '#', '=' or ' '
      var cols = 0;
      var rows = 0;
      var coins = [];
      var foes = [];
      var flag = null;
      var spawn = { x: 40, y: 40 };

      /* ---- run state ---- */
      var level = 0;
      var lives = 3;
      var cam = 0;
      var clock = 0;            // drives the coin spin and both walk cycles

      var p = {
        x: 0, y: 0, py: 0, vx: 0, vy: 0,
        onGround: false, coyote: 0, buffer: 0, face: 1
      };

      /* Both jump inputs are tracked separately so letting go of one while
         still holding the other does not clip a jump the player is
         deliberately holding. */
      var jumpKeys = { up: false, action: false };
      var dying = 0;            // > 0 while the death hop plays out
      var winning = 0;          // > 0 while the flag animation plays out

      /* ----------------------------------------------------------------
         The tile grid
         ---------------------------------------------------------------- */
      function solidAt(cx, cy) {
        /* Off the sides is wall, off the bottom is not — falling out of the
           world has to stay possible, because that is what a pit is. */
        if (cx < 0 || cx >= cols) return true;
        if (cy < 0 || cy >= rows) return false;
        var ch = grid[cy].charAt(cx);
        return ch === '#' || ch === '=';
      }

      function loadLevel(index) {
        var src = LEVELS[index];
        rows = src.length;
        cols = 0;
        var y, x;
        for (y = 0; y < rows; y++) {
          if (src[y].length > cols) cols = src[y].length;
        }

        grid = [];
        coins = [];
        foes = [];
        flag = null;

        for (y = 0; y < rows; y++) {
          var line = src[y];
          var out = '';
          for (x = 0; x < cols; x++) {
            /* Rows are padded rather than trusted to be equal length: a
               level edited by hand loses a trailing space sooner or later,
               and a ragged row must not become a hole in the floor. */
            var ch = x < line.length ? line.charAt(x) : ' ';
            if (ch === '#' || ch === '=') {
              out += ch;
            } else {
              out += ' ';
              if (ch === 'o') {
                coins.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, got: false });
              } else if (ch === 'e' || ch === 'h') {
                foes.push({
                  kind: ch === 'e' ? 'walk' : 'hop',
                  x: x * TILE + 2, y: y * TILE + (ch === 'e' ? 4 : 6),
                  w: 16, h: ch === 'e' ? 16 : 14,
                  vx: (ch === 'e' ? -WALK_SPEED : -HOP_SPEED), vy: 0,
                  onGround: false, timer: 0, squash: 0, gone: false
                });
              } else if (ch === 'F') {
                flag = { x: x * TILE, y: y * TILE };
              } else if (ch === 'P') {
                spawn = { x: x * TILE + (TILE - PW) / 2, y: y * TILE + (TILE - PH) };
              }
            }
          }
          grid.push(out);
        }

        placePlayer();
        g.stat('level', (index + 1) + '/' + LEVELS.length);
        g.stat('lives', lives);
      }

      function placePlayer() {
        p.x = spawn.x;
        p.y = spawn.y;
        p.py = p.y;
        p.vx = 0;
        p.vy = 0;
        p.onGround = true;
        p.coyote = 0;
        p.buffer = 0;
        p.face = 1;
        dying = 0;
        winning = 0;
        cam = 0;
        followCamera(true);
      }

      function reset() {
        level = 0;
        lives = 3;
        clock = 0;
        jumpKeys.up = false;
        jumpKeys.action = false;
        loadLevel(0);
      }

      /* ----------------------------------------------------------------
         Movement. See decision 1 in the header for why these are two
         separate functions and not one.
         ---------------------------------------------------------------- */
      function moveX(dt) {
        p.x += p.vx * dt;
        var top = Math.floor(p.y / TILE);
        var bot = Math.floor((p.y + PH - 1) / TILE);
        var r;
        if (p.vx > 0) {
          var right = Math.floor((p.x + PW - 1) / TILE);
          for (r = top; r <= bot; r++) {
            if (solidAt(right, r)) { p.x = right * TILE - PW; p.vx = 0; break; }
          }
        } else if (p.vx < 0) {
          var left = Math.floor(p.x / TILE);
          for (r = top; r <= bot; r++) {
            if (solidAt(left, r)) { p.x = (left + 1) * TILE; p.vx = 0; break; }
          }
        }
      }

      function moveY(dt) {
        p.py = p.y;
        p.y += p.vy * dt;
        var left = Math.floor(p.x / TILE);
        var right = Math.floor((p.x + PW - 1) / TILE);
        var c;
        p.onGround = false;
        if (p.vy > 0) {
          var bot = Math.floor((p.y + PH - 1) / TILE);
          for (c = left; c <= right; c++) {
            if (solidAt(c, bot)) {
              p.y = bot * TILE - PH;
              p.vy = 0;
              p.onGround = true;
              break;
            }
          }
        } else if (p.vy < 0) {
          var top = Math.floor(p.y / TILE);
          for (c = left; c <= right; c++) {
            if (solidAt(c, top)) { p.y = (top + 1) * TILE; p.vy = 0; break; }
          }
        }

        /* GROUND PROBE. Without this, onGround is true about one frame in
           five while running along a flat floor, and that is not a rounding
           quibble — it is the difference between the controls working and
           not. Landing zeroes vy, but the very next step adds a step's worth
           of gravity again, the player sinks a fraction of a unit, and no
           tile is penetrated deeply enough to count as a landing until four
           or five steps later. Every frame in between is an air frame: no
           friction, air acceleration instead of ground acceleration, and a
           jump that only works because the coyote timer is papering over it.
           So after the resolution, look one unit under the feet and treat a
           solid tile there as contact. It also cancels the sink, which is
           why the sprite no longer shivers on a flat floor. */
        if (!p.onGround && p.vy >= 0) {
          var probe = Math.floor((p.y + PH + 1) / TILE);
          for (c = left; c <= right; c++) {
            if (solidAt(c, probe)) {
              p.y = probe * TILE - PH;
              p.vy = 0;
              p.onGround = true;
              break;
            }
          }
        }
      }

      function followCamera(snap) {
        var centre = p.x + PW / 2;
        var lo = W / 2 - DEAD / 2;
        var hi = W / 2 + DEAD / 2;
        if (snap) cam = centre - W / 2;
        else if (centre - cam < lo) cam = centre - lo;
        else if (centre - cam > hi) cam = centre - hi;
        var maxCam = cols * TILE - W;
        if (cam > maxCam) cam = maxCam;
        if (cam < 0) cam = 0;
      }

      /* ----------------------------------------------------------------
         Enemies
         ---------------------------------------------------------------- */
      function foeStep(f, dt) {
        f.vy += GRAV * dt;
        if (f.vy > MAX_FALL) f.vy = MAX_FALL;

        /* x first, same rule as the player. */
        f.x += f.vx * dt;
        var top = Math.floor(f.y / TILE);
        var bot = Math.floor((f.y + f.h - 1) / TILE);
        var r, hit = false;
        if (f.vx > 0) {
          var right = Math.floor((f.x + f.w - 1) / TILE);
          for (r = top; r <= bot; r++) {
            if (solidAt(right, r)) { f.x = right * TILE - f.w; hit = true; break; }
          }
        } else if (f.vx < 0) {
          var left = Math.floor(f.x / TILE);
          for (r = top; r <= bot; r++) {
            if (solidAt(left, r)) { f.x = (left + 1) * TILE; hit = true; break; }
          }
        }
        if (hit) f.vx = -f.vx;

        f.y += f.vy * dt;
        var lc = Math.floor(f.x / TILE);
        var rc = Math.floor((f.x + f.w - 1) / TILE);
        var c;
        f.onGround = false;
        if (f.vy > 0) {
          var fb = Math.floor((f.y + f.h - 1) / TILE);
          for (c = lc; c <= rc; c++) {
            if (solidAt(c, fb)) { f.y = fb * TILE - f.h; f.vy = 0; f.onGround = true; break; }
          }
        } else if (f.vy < 0) {
          var ft = Math.floor(f.y / TILE);
          for (c = lc; c <= rc; c++) {
            if (solidAt(c, ft)) { f.y = (ft + 1) * TILE; f.vy = 0; break; }
          }
        }
        /* The same ground probe the player gets. Enemies need it more, not
           less: the ledge test and the hopper's timer both run only while
           grounded, so without it a hopper hops a fifth as often as it is
           supposed to and a walker gets a fifth of the chances to notice the
           edge it is about to step off. */
        if (!f.onGround && f.vy >= 0) {
          var fp = Math.floor((f.y + f.h + 1) / TILE);
          for (c = lc; c <= rc; c++) {
            if (solidAt(c, fp)) { f.y = fp * TILE - f.h; f.vy = 0; f.onGround = true; break; }
          }
        }

        /* Turn at a ledge as well as at a wall, so nothing patrols itself
           into a pit while the player is three screens away and cannot see
           it happen. */
        if (f.onGround) {
          var ahead = f.vx > 0 ? Math.floor((f.x + f.w + 1) / TILE)
                               : Math.floor((f.x - 1) / TILE);
          var below = Math.floor((f.y + f.h + 1) / TILE);
          if (!solidAt(ahead, below)) f.vx = -f.vx;
        }

        if (f.kind === 'hop' && f.onGround) {
          f.timer += dt;
          if (f.timer >= HOP_EVERY) { f.timer = 0; f.vy = -HOP_V; }
        }
      }

      function overlaps(f) {
        return p.x < f.x + f.w && p.x + PW > f.x &&
               p.y < f.y + f.h && p.y + PH > f.y;
      }

      /* ----------------------------------------------------------------
         Losing and winning
         ---------------------------------------------------------------- */
      function hurt() {
        if (dying > 0 || winning > 0) return;
        dying = 0.95;
        p.vy = -300;
        p.vx = 0;
        lives -= 1;
        g.stat('lives', lives < 0 ? 0 : lives);
        g.sweep(340, 110, 0.4);
      }

      function afterDeath() {
        if (lives <= 0) {
          g.over({
            title: 'Out of lives',
            message: 'You got to level ' + (level + 1) + ' of ' + LEVELS.length + '.'
          });
          return;
        }
        loadLevel(level);
      }

      function reachedFlag() {
        winning = 1.1;
        p.vx = 0;
        g.addScore(250);
        g.sweep(420, 900, 0.4);
      }

      function afterWin() {
        level += 1;
        if (level >= LEVELS.length) {
          g.over({
            won: true,
            title: 'All three cleared',
            message: 'Flag on level three with ' + lives + ' ' +
              (lives === 1 ? 'life' : 'lives') + ' left.'
          });
          return;
        }
        loadLevel(level);
      }

      /* ----------------------------------------------------------------
         Drawing
         ---------------------------------------------------------------- */
      function drawBackground(ctx) {
        var sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#0b1020');
        sky.addColorStop(1, '#12283a');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        /* Two parallax layers at a third and a half of the camera speed.
           Each is drawn modulo its own spacing rather than as a long strip
           offset by the camera: a strip runs out the moment the camera has
           travelled further than the strip is long, and the hills quietly
           stop appearing halfway through a level. */
        var i, hx, slot;
        ctx.fillStyle = 'rgba(148,163,184,0.10)';
        var hillOff = (cam * 0.3) % 140;
        for (i = -1; i < 5; i++) {
          hx = i * 140 - hillOff;
          ctx.beginPath();
          ctx.moveTo(hx - 70, H - 40);
          ctx.lineTo(hx, H - 130);
          ctx.lineTo(hx + 70, H - 40);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(226,232,240,0.07)';
        var cloudOff = (cam * 0.5) % 190;
        var cloudBase = Math.floor((cam * 0.5) / 190);
        for (i = -1; i < 4; i++) {
          hx = i * 190 - cloudOff;
          /* The height comes from the cloud's absolute slot, not from the
             loop index, so a cloud keeps its own altitude as it scrolls
             instead of hopping when the modulo wraps. */
          slot = (((cloudBase + i) % 3) + 3) % 3;
          ctx.fillRect(hx, 34 + slot * 22, 46, 8);
          ctx.fillRect(hx + 12, 26 + slot * 22, 26, 8);
        }
      }

      function drawTiles(ctx) {
        var c0 = Math.floor(cam / TILE) - 1;
        var c1 = Math.ceil((cam + W) / TILE) + 1;
        for (var y = 0; y < rows; y++) {
          for (var x = c0; x <= c1; x++) {
            if (x < 0 || x >= cols) continue;
            var ch = grid[y].charAt(x);
            if (ch !== '#' && ch !== '=') continue;
            var sx = Math.round(x * TILE - cam);
            var sy = y * TILE;
            if (ch === '#') {
              ctx.fillStyle = '#1f3a2e';
              ctx.fillRect(sx, sy, TILE, TILE);
              /* Grass only on an exposed top, so a stack of ground reads as
                 solid earth rather than as a pile of separate lawns. */
              if (!solidAt(x, y - 1)) {
                ctx.fillStyle = '#4ade80';
                ctx.fillRect(sx, sy, TILE, 4);
              }
              ctx.fillStyle = 'rgba(2,6,23,0.35)';
              ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
            } else {
              ctx.fillStyle = '#3b3324';
              ctx.fillRect(sx, sy, TILE, TILE);
              ctx.fillStyle = '#fbbf24';
              ctx.fillRect(sx, sy, TILE, 3);
              ctx.fillStyle = 'rgba(251,191,36,0.25)';
              ctx.fillRect(sx + 2, sy + TILE - 4, TILE - 4, 2);
            }
          }
        }
      }

      function drawCoins(ctx) {
        for (var i = 0; i < coins.length; i++) {
          var c = coins[i];
          if (c.got) continue;
          var sx = c.x - cam;
          if (sx < -TILE || sx > W + TILE) continue;
          /* The spin is a cosine on the width. A coin that never turns
             reads as scenery; one that does reads as a pickup. */
          var half = Math.abs(Math.cos(clock * 3 + c.x * 0.05)) * 5 + 1;
          ctx.fillStyle = '#facc15';
          ctx.fillRect(Math.round(sx - half), Math.round(c.y - 6), Math.round(half * 2), 12);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fillRect(Math.round(sx - half) + 1, Math.round(c.y - 4), 1, 8);
        }
      }

      function drawFlag(ctx) {
        if (!flag) return;
        var sx = Math.round(flag.x + 6 - cam);
        if (sx < -60 || sx > W + 60) return;
        var base = flag.y + TILE;
        var top = base - TILE * 4;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(sx, top, 3, TILE * 4);
        ctx.fillStyle = winning > 0 ? '#4ade80' : '#f472b6';
        ctx.beginPath();
        ctx.moveTo(sx + 3, top + 3);
        ctx.lineTo(sx + 27, top + 11);
        ctx.lineTo(sx + 3, top + 19);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(sx - 4, base - 4, 11, 4);
      }

      function drawFoes(ctx) {
        for (var i = 0; i < foes.length; i++) {
          var f = foes[i];
          if (f.gone) continue;
          var sx = Math.round(f.x - cam);
          if (sx < -TILE * 2 || sx > W + TILE * 2) continue;
          var sy = Math.round(f.y);
          if (f.squash > 0) {
            ctx.fillStyle = f.kind === 'walk' ? '#7f1d1d' : '#4c1d95';
            ctx.fillRect(sx, sy + f.h - 5, f.w, 5);
            continue;
          }
          if (f.kind === 'walk') {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(sx, sy + 3, f.w, f.h - 3);
            ctx.fillStyle = '#7f1d1d';
            ctx.fillRect(sx + 2, sy, f.w - 4, 4);
            ctx.fillStyle = '#fee2e2';
            ctx.fillRect(sx + 3, sy + 6, 3, 3);
            ctx.fillRect(sx + f.w - 6, sy + 6, 3, 3);
            /* Feet alternate on a clock rather than on distance, so a walker
               boxed against a wall still looks like it is trying. */
            var swap = Math.floor(clock * 6) % 2 === 0;
            ctx.fillStyle = '#450a0a';
            ctx.fillRect(sx + (swap ? 0 : 4), sy + f.h - 3, 5, 3);
            ctx.fillRect(sx + f.w - (swap ? 9 : 5), sy + f.h - 3, 5, 3);
          } else {
            ctx.fillStyle = '#c084fc';
            ctx.fillRect(sx + 1, sy + 2, f.w - 2, f.h - 2);
            ctx.fillStyle = '#6b21a8';
            ctx.fillRect(sx + 2, sy, 3, 4);
            ctx.fillRect(sx + f.w - 5, sy, 3, 4);
            ctx.fillStyle = '#f5f3ff';
            ctx.fillRect(sx + 4, sy + 5, 3, 3);
            ctx.fillRect(sx + f.w - 7, sy + 5, 3, 3);
            ctx.fillStyle = '#4c1d95';
            ctx.fillRect(sx + 1, sy + f.h - 3, f.w - 2, 3);
          }
        }
      }

      function drawPlayer(ctx) {
        var sx = Math.round(p.x - cam);
        var sy = Math.round(p.y);
        if (dying > 0) ctx.globalAlpha = Math.floor(dying * 20) % 2 === 0 ? 1 : 0.35;
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(sx, sy + 6, PW, PH - 9);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(sx + 1, sy, PW - 2, 7);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(sx + (p.face > 0 ? PW - 5 : 2), sy + 2, 2, 3);
        ctx.fillStyle = '#1e3a8a';
        if (p.onGround && Math.abs(p.vx) > 8) {
          var step = Math.floor(clock * 12) % 2 === 0;
          ctx.fillRect(sx + (step ? 0 : 3), sy + PH - 3, 5, 3);
          ctx.fillRect(sx + PW - (step ? 8 : 5), sy + PH - 3, 5, 3);
        } else {
          ctx.fillRect(sx + 1, sy + PH - 3, 4, 3);
          ctx.fillRect(sx + PW - 5, sy + PH - 3, 4, 3);
        }
        ctx.globalAlpha = 1;
      }

      function draw(ctx) {
        drawBackground(ctx);
        drawTiles(ctx);
        drawCoins(ctx);
        drawFlag(ctx);
        drawFoes(ctx);
        drawPlayer(ctx);
      }

      /* ----------------------------------------------------------------
         The step
         ---------------------------------------------------------------- */
      function update(dt) {
        clock += dt;

        if (dying > 0) {
          /* The death hop falls through the floor on purpose: the world is
             over for this life, so nothing it contains should stop it. */
          p.vy += GRAV * dt;
          p.y += p.vy * dt;
          dying -= dt;
          if (dying <= 0) afterDeath();
          return;
        }

        if (winning > 0) {
          p.vy += GRAV * dt;
          if (p.vy > MAX_FALL) p.vy = MAX_FALL;
          moveY(dt);
          winning -= dt;
          if (winning <= 0) afterWin();
          return;
        }

        /* --- horizontal intent --- */
        var want = 0;
        if (g.held.left) want -= 1;
        if (g.held.right) want += 1;
        if (want !== 0) p.face = want;

        var acc = p.onGround ? RUN_ACC : AIR_ACC;
        if (want !== 0) {
          p.vx += want * acc * dt;
          if (p.vx > RUN_MAX) p.vx = RUN_MAX;
          if (p.vx < -RUN_MAX) p.vx = -RUN_MAX;
        } else if (p.onGround) {
          /* Friction on the ground only. Letting go in mid-air must not stop
             you dead, or every jump becomes a vertical one. */
          if (p.vx > 0) p.vx = Math.max(0, p.vx - FRICTION * dt);
          else if (p.vx < 0) p.vx = Math.min(0, p.vx + FRICTION * dt);
        }

        /* --- the jump --- */
        if (p.buffer > 0) p.buffer -= dt;
        if (p.coyote > 0) p.coyote -= dt;
        if (p.buffer > 0 && (p.onGround || p.coyote > 0)) {
          p.vy = -JUMP_V;
          p.onGround = false;
          p.buffer = 0;
          p.coyote = 0;
          g.beep(520, 0.07, 'square', 0.05);
        }
        if (p.vy < -JUMP_CUT && !jumpKeys.up && !jumpKeys.action) p.vy = -JUMP_CUT;

        p.vy += GRAV * dt;
        if (p.vy > MAX_FALL) p.vy = MAX_FALL;

        moveX(dt);
        moveY(dt);
        if (p.onGround) p.coyote = COYOTE;

        /* --- out of the world --- */
        if (p.y > rows * TILE + 10) { hurt(); return; }

        /* --- coins --- */
        var i;
        for (i = 0; i < coins.length; i++) {
          var c = coins[i];
          if (c.got) continue;
          if (p.x < c.x + 6 && p.x + PW > c.x - 6 &&
              p.y < c.y + 6 && p.y + PH > c.y - 6) {
            c.got = true;
            g.addScore(10);
            g.beep(1040, 0.05, 'square', 0.05);
          }
        }

        /* --- enemies --- */
        for (i = 0; i < foes.length; i++) {
          var f = foes[i];
          if (f.gone) continue;
          if (f.squash > 0) {
            f.squash -= dt;
            if (f.squash <= 0) f.gone = true;
            continue;
          }

          /* Only the ones near the view think. An enemy that patrolled for
             the ninety seconds you spent elsewhere is never where you left
             it, which makes a level impossible to learn. */
          if (f.x - cam > -60 && f.x - cam < W + 60) foeStep(f, dt);
          if (f.y > rows * TILE + 40) { f.gone = true; continue; }

          if (!overlaps(f)) continue;
          /* A stomp is decided by where the feet WERE, not by the current
             overlap: at 130 units a second a landing can bury the player
             half into an enemy in one step, and asking "were you above it
             last frame" is the only version that answers the same way at
             every frame rate. */
          if (p.vy > 0 && p.py + PH <= f.y + 7) {
            f.squash = 0.35;
            p.vy = -STOMP_V;
            p.py = p.y;
            g.addScore(100);
            g.beep(200, 0.09, 'square', 0.06);
          } else {
            hurt();
            return;
          }
        }

        /* --- the flag --- */
        if (flag) {
          var fx = flag.x + 2;
          var fy = flag.y + TILE - TILE * 4;
          if (p.x < fx + 16 && p.x + PW > fx && p.y < fy + TILE * 4 && p.y + PH > fy) {
            reachedFlag();
            return;
          }
        }

        followCamera(false);
      }

      return {
        reset: reset,

        key: function (name, event) {
          /* event.repeat is only ever true for a held keyboard key. The pad
             and the stage tap send pointer events, which have no such
             property, so this filters auto-repeat without also swallowing
             a genuine second tap. */
          if (event && event.repeat) return;
          if (name === 'up' || name === 'action') {
            jumpKeys[name] = true;
            p.buffer = BUFFER;
          }
        },

        release: function (name) {
          if (name === 'up' || name === 'action') jumpKeys[name] = false;
        },

        update: update,
        draw: draw
      };
    }
  });
})();

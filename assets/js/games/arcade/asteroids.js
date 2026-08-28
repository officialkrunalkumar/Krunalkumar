/* ==========================================================================
   asteroids.js — vector Asteroids, 640x480 logical units.
   --------------------------------------------------------------------------
   Two decisions here are not obvious, and both come from the same place: the
   playfield is a torus, not a rectangle.

   1. EVERY DISTANCE IS MEASURED THE SHORT WAY ROUND. Wrapping an object's
      position at the edge is the easy half. The hard half is that a rock at
      x=6 and a bullet at x=634 are eighteen units apart, not six hundred and
      twenty-eight, and a straight subtraction says otherwise. So nothing in
      this file ever compares raw coordinates: dist() folds each axis into the
      nearer half of the board first. Skip that and shots pass through rocks
      sitting on the seam, which is the one bug in a hand-written Asteroids
      that players notice and cannot describe.

   2. THINGS NEAR AN EDGE ARE PAINTED TWICE. The same rock has to be visibly
      half on the left and half on the right while it crosses, or the wrap
      reads as a teleport and you cannot judge what you are flying into.
      wrapped() draws its shape once at the real position and again shifted
      by a board width or height whenever the shape's radius reaches over a
      side, so the seam is invisible.

   The ship keeps its velocity when you stop thrusting. That is not a detail,
   it is the game: thrust adds to where you are already going, and there is
   only a light drag to bleed it off, so every burn has to be paid back later.

   Everything is stroked, nothing is filled, because that is what the original
   vector hardware could do and the shapes read better without weight.
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 480;
  var TAU = Math.PI * 2;

  var TURN = 3.5;             // radians per second
  var THRUST = 185;           // units per second squared
  var DRAG = 0.6;             // per second; sets the terminal speed at ~308
  var SHIP_R = 7;             // collision radius, smaller than the drawn hull

  var BULLET_SPEED = 420;
  var BULLET_LIFE = 1.15;     // ~485 units of travel, three quarters of the board
  var MAX_BULLETS = 4;        // the classic limit, and the reason range matters
  var FIRE_GAP = 0.12;

  var RADII = [0, 11, 21, 38];
  var SCORES = [0, 100, 50, 20];
  var EXTRA_LIFE = 10000;

  function dist(ax, ay, bx, by) {
    var dx = Math.abs(bx - ax);
    var dy = Math.abs(by - ay);
    if (dx > W / 2) dx = W - dx;
    if (dy > H / 2) dy = H - dy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* Signed shortest offset on one axis, used by the small saucer to work out
     which way the ship actually is when it is over the seam from here. */
  function delta(from, to, span) {
    var d = to - from;
    if (d > span / 2) d -= span;
    else if (d < -span / 2) d += span;
    return d;
  }

  function wrapPos(o) {
    if (o.x < 0) o.x += W; else if (o.x >= W) o.x -= W;
    if (o.y < 0) o.y += H; else if (o.y >= H) o.y -= H;
  }

  /* See decision 2. paint draws in local coordinates around the origin. */
  function wrapped(ctx, x, y, r, paint) {
    var xs = [x];
    if (x < r) xs.push(x + W);
    else if (x > W - r) xs.push(x - W);
    var ys = [y];
    if (y < r) ys.push(y + H);
    else if (y > H - r) ys.push(y - H);
    for (var i = 0; i < xs.length; i++) {
      for (var j = 0; j < ys.length; j++) {
        ctx.save();
        ctx.translate(xs[i], ys[j]);
        paint(ctx);
        ctx.restore();
      }
    }
  }

  function poly(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
    ctx.stroke();
  }

  GameShell.define({
    id: 'game-asteroids',
    slug: 'asteroids',
    title: 'Asteroids',
    width: W,
    height: H,
    bestKey: 'asteroids',
    startTitle: 'Asteroids',
    startText: 'Left and right turn, up thrusts, down is hyperspace, Space fires. The ship keeps whatever speed you gave it.',

    setup: function (g) {
      var ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, invuln: 0 };
      var rocks = [];
      var shots = [];         // { x, y, vx, vy, life, foe }
      var bits = [];          // explosion fragments
      var ufo = null;
      var lives = 3;
      var wave = 0;
      var clock = 0;
      var respawn = 0;
      var waveGap = 0;
      var fireGap = 0;
      var jumpGap = 0;
      var ufoGap = 0;
      var ufoPulse = 0;
      var nextLife = EXTRA_LIFE;
      var thrusting = false;

      /* ---------------------------------------------------------------
         Building things
         --------------------------------------------------------------- */
      function makeRock(x, y, size, vx, vy) {
        var shape = [];
        var n = 9 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) shape.push(0.74 + Math.random() * 0.42);
        return {
          x: x, y: y, vx: vx, vy: vy, size: size, r: RADII[size],
          shape: shape, rot: Math.random() * TAU,
          spin: (Math.random() - 0.5) * 1.5
        };
      }

      function rockSpeed(size) {
        var base = 24 + wave * 4;
        if (base > 62) base = 62;
        return base * (size === 3 ? 1 : size === 2 ? 1.5 : 2.1);
      }

      /* A new rock must not appear on top of the ship. Thirty tries is
         plenty on a board this size; the fallback keeps the wave honest
         rather than silently dropping a rock. */
      function spawnRock() {
        var x = 0, y = 0, ok = false;
        for (var i = 0; i < 30 && !ok; i++) {
          x = Math.random() * W;
          y = Math.random() * H;
          if (!ship.alive || dist(x, y, ship.x, ship.y) > 150) ok = true;
        }
        var ang = Math.random() * TAU;
        var sp = rockSpeed(3);
        rocks.push(makeRock(x, y, 3, Math.cos(ang) * sp, Math.sin(ang) * sp));
      }

      function startWave() {
        wave += 1;
        g.stat('wave', wave);
        var count = 3 + wave;
        if (count > 11) count = 11;
        for (var i = 0; i < count; i++) spawnRock();
      }

      function burst(x, y, n, spread) {
        for (var i = 0; i < n; i++) {
          var a = Math.random() * TAU;
          var sp = 30 + Math.random() * spread;
          bits.push({
            x: x, y: y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            a: Math.random() * TAU, len: 3 + Math.random() * 5,
            life: 0.5 + Math.random() * 0.6
          });
        }
      }

      /* ---------------------------------------------------------------
         The ship
         --------------------------------------------------------------- */
      function placeShip() {
        ship.x = W / 2;
        ship.y = H / 2;
        ship.vx = 0;
        ship.vy = 0;
        ship.a = -Math.PI / 2;
        ship.alive = true;
        ship.invuln = 2.4;
      }

      /* Respawning into a rock would be a death the player could not have
         avoided, so the centre has to be clear first — with a time limit,
         because a board full of slow rocks could otherwise stall forever. */
      function centreClear() {
        for (var i = 0; i < rocks.length; i++) {
          if (dist(W / 2, H / 2, rocks[i].x, rocks[i].y) < rocks[i].r + 70) return false;
        }
        if (ufo && dist(W / 2, H / 2, ufo.x, ufo.y) < 110) return false;
        for (var j = 0; j < shots.length; j++) {
          if (shots[j].foe && dist(W / 2, H / 2, shots[j].x, shots[j].y) < 60) return false;
        }
        return true;
      }

      function killShip() {
        if (!ship.alive || ship.invuln > 0) return;
        ship.alive = false;
        thrusting = false;
        burst(ship.x, ship.y, 11, 90);
        g.beep(90, 0.35, 'sawtooth', 0.07);
        lives -= 1;
        g.stat('lives', lives);
        respawn = 2;
      }

      function fire() {
        if (!ship.alive || fireGap > 0) return;
        var live = 0;
        for (var i = 0; i < shots.length; i++) if (!shots[i].foe) live++;
        if (live >= MAX_BULLETS) return;
        fireGap = FIRE_GAP;
        shots.push({
          x: ship.x + Math.cos(ship.a) * 12,
          y: ship.y + Math.sin(ship.a) * 12,
          /* The shot carries the ship's momentum as well as its own, so a
             forward burst never catches you up from behind. */
          vx: Math.cos(ship.a) * BULLET_SPEED + ship.vx,
          vy: Math.sin(ship.a) * BULLET_SPEED + ship.vy,
          life: BULLET_LIFE, foe: false
        });
        g.beep(760, 0.04, 'square', 0.035);
      }

      /* Hyperspace is a genuine gamble: it drops you somewhere at random and
         does not check what is already there. That is the deal. */
      function hyperspace() {
        if (!ship.alive || jumpGap > 0) return;
        jumpGap = 1.1;
        ship.x = 30 + Math.random() * (W - 60);
        ship.y = 30 + Math.random() * (H - 60);
        ship.vx = 0;
        ship.vy = 0;
        g.sweep(700, 180, 0.2);
      }

      /* ---------------------------------------------------------------
         The saucer
         --------------------------------------------------------------- */
      function armUfo() {
        ufoGap = 16 + Math.random() * 12;
      }

      function spawnUfo() {
        /* The small saucer aims; the large one sprays. It turns up more often
           as the score climbs, which is the only difficulty curve the game
           has once the rock count caps out. */
        var chance = 0.14 + g.score / 26000;
        if (chance > 0.75) chance = 0.75;
        var small = Math.random() < chance;
        var fromLeft = Math.random() < 0.5;
        ufo = {
          x: fromLeft ? -30 : W + 30,
          y: 50 + Math.random() * (H - 100),
          vx: (fromLeft ? 1 : -1) * (small ? 96 : 72),
          vy: 0,
          small: small,
          r: small ? 11 : 17,
          jink: 0.9,
          fireIn: small ? 0.7 : 1.1
        };
        ufoPulse = 0;
      }

      function dropUfo(scored) {
        if (!ufo) return;
        burst(ufo.x, ufo.y, 9, 80);
        if (scored) {
          g.addScore(ufo.small ? 1000 : 200);
          checkExtra();
        }
        g.beep(140, 0.16, 'sawtooth', 0.06);
        ufo = null;
        armUfo();
      }

      function ufoFire() {
        if (!ufo) return;
        var a;
        if (ufo.small && ship.alive) {
          /* Aim along the short way round, with an error that narrows as the
             score rises. It never becomes perfect. */
          var err = 0.5 - g.score / 45000;
          if (err < 0.06) err = 0.06;
          a = Math.atan2(delta(ufo.y, ship.y, H), delta(ufo.x, ship.x, W)) +
              (Math.random() - 0.5) * 2 * err;
        } else {
          a = Math.random() * TAU;
        }
        shots.push({
          x: ufo.x, y: ufo.y,
          vx: Math.cos(a) * 265, vy: Math.sin(a) * 265,
          life: 1.25, foe: true
        });
        g.beep(300, 0.05, 'square', 0.035);
      }

      /* ---------------------------------------------------------------
         Splitting and scoring
         --------------------------------------------------------------- */
      function checkExtra() {
        if (g.score < nextLife) return;
        nextLife += EXTRA_LIFE;
        lives += 1;
        g.stat('lives', lives);
        g.beep(1046, 0.12, 'sine', 0.05);
      }

      /* A large rock becomes two mediums, a medium two smalls, a small
         nothing at all. The children inherit the parent's heading, turned
         apart and sped up, so a hit visibly scatters rather than stalling. */
      function split(index, scored) {
        var rock = rocks[index];
        rocks.splice(index, 1);
        burst(rock.x, rock.y, 5 + rock.size * 2, 40 + rock.size * 14);
        g.beep(110 + (3 - rock.size) * 70, 0.09, 'sawtooth', 0.05);
        if (scored) {
          g.addScore(SCORES[rock.size]);
          checkExtra();
        }
        if (rock.size <= 1) return;
        var base = Math.atan2(rock.vy, rock.vx);
        var sp = rockSpeed(rock.size - 1);
        for (var i = 0; i < 2; i++) {
          var a = base + (i ? 1 : -1) * (0.4 + Math.random() * 0.7);
          rocks.push(makeRock(rock.x, rock.y, rock.size - 1,
            Math.cos(a) * sp, Math.sin(a) * sp));
        }
      }

      /* ---------------------------------------------------------------
         Frame
         --------------------------------------------------------------- */
      function update(dt) {
        clock += dt;
        if (fireGap > 0) fireGap -= dt;
        if (jumpGap > 0) jumpGap -= dt;

        /* Turning and thrust are read from the held-key map rather than from
           key events, so a held arrow steers smoothly instead of repeating at
           whatever rate the operating system decides. */
        if (ship.alive) {
          var turn = 0;
          if (g.held.left) turn -= 1;
          if (g.held.right) turn += 1;
          ship.a += turn * TURN * dt;

          thrusting = !!g.held.up;
          if (thrusting) {
            ship.vx += Math.cos(ship.a) * THRUST * dt;
            ship.vy += Math.sin(ship.a) * THRUST * dt;
          }
          /* The only thing that ever takes speed away. Without a drag term
             the ship reaches a speed no amount of counter-thrust can undo. */
          var keep = 1 - DRAG * dt;
          ship.vx *= keep;
          ship.vy *= keep;
          ship.x += ship.vx * dt;
          ship.y += ship.vy * dt;
          wrapPos(ship);
          if (ship.invuln > 0) ship.invuln -= dt;
        } else {
          respawn -= dt;
          if (respawn <= 0) {
            if (lives <= 0) {
              g.over({ score: g.score, message: 'You went down on wave ' + wave + '.' });
              return;
            }
            if (centreClear() || respawn < -4) placeShip();
          }
        }

        var i, j;

        for (i = 0; i < rocks.length; i++) {
          var r = rocks[i];
          r.x += r.vx * dt;
          r.y += r.vy * dt;
          r.rot += r.spin * dt;
          wrapPos(r);
        }

        for (i = shots.length - 1; i >= 0; i--) {
          var s = shots[i];
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.life -= dt;
          wrapPos(s);
          if (s.life <= 0) shots.splice(i, 1);
        }

        for (i = bits.length - 1; i >= 0; i--) {
          var b = bits[i];
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.life -= dt;
          wrapPos(b);
          if (b.life <= 0) bits.splice(i, 1);
        }

        /* Saucer. It crosses the board rather than wrapping, and leaves. */
        if (ufo) {
          ufo.jink -= dt;
          if (ufo.jink <= 0) {
            ufo.jink = 0.8 + Math.random() * 0.9;
            var pick = Math.random();
            ufo.vy = pick < 0.34 ? -46 : pick < 0.68 ? 46 : 0;
          }
          ufo.x += ufo.vx * dt;
          ufo.y += ufo.vy * dt;
          if (ufo.y < 20) ufo.y = 20;
          if (ufo.y > H - 20) ufo.y = H - 20;
          ufo.fireIn -= dt;
          if (ufo.fireIn <= 0) {
            ufo.fireIn = ufo.small ? 0.95 : 1.35;
            ufoFire();
          }
          ufoPulse -= dt;
          if (ufoPulse <= 0) {
            ufoPulse = 0.55;
            g.beep(ufo.small ? 320 : 175, 0.05, 'sine', 0.03);
          }
          if (ufo.x < -50 || ufo.x > W + 50) { ufo = null; armUfo(); }
        } else {
          ufoGap -= dt;
          if (ufoGap <= 0 && rocks.length) spawnUfo();
        }

        /* --- collisions ------------------------------------------------ */
        for (i = shots.length - 1; i >= 0; i--) {
          var sh = shots[i];
          var gone = false;
          for (j = rocks.length - 1; j >= 0 && !gone; j--) {
            if (dist(sh.x, sh.y, rocks[j].x, rocks[j].y) < rocks[j].r) {
              shots.splice(i, 1);
              /* A saucer shot that hits a rock still breaks it, but nobody
                 is paid for someone else's aim. */
              split(j, !sh.foe);
              gone = true;
            }
          }
          if (gone) continue;
          if (!sh.foe && ufo && dist(sh.x, sh.y, ufo.x, ufo.y) < ufo.r) {
            shots.splice(i, 1);
            dropUfo(true);
            continue;
          }
          if (sh.foe && ship.alive && ship.invuln <= 0 &&
              dist(sh.x, sh.y, ship.x, ship.y) < SHIP_R + 2) {
            shots.splice(i, 1);
            killShip();
          }
        }

        if (ufo) {
          for (j = rocks.length - 1; j >= 0; j--) {
            if (dist(ufo.x, ufo.y, rocks[j].x, rocks[j].y) < rocks[j].r + ufo.r) {
              split(j, false);
              dropUfo(false);
              break;
            }
          }
        }

        if (ship.alive && ship.invuln <= 0) {
          for (j = 0; j < rocks.length; j++) {
            if (dist(ship.x, ship.y, rocks[j].x, rocks[j].y) < rocks[j].r + SHIP_R) {
              split(j, true);
              killShip();
              break;
            }
          }
          if (ship.alive && ufo && dist(ship.x, ship.y, ufo.x, ufo.y) < ufo.r + SHIP_R) {
            dropUfo(false);
            killShip();
          }
        }

        /* --- next wave -------------------------------------------------- */
        if (!rocks.length) {
          if (waveGap <= 0) waveGap = 1.6;
          waveGap -= dt;
          if (waveGap <= 0) {
            waveGap = 0;
            startWave();
          }
        }
      }

      /* ---------------------------------------------------------------
         Drawing. Stroked outlines only.
         --------------------------------------------------------------- */
      var SHIP = [[11, 0], [-8, -7], [-5, 0], [-8, 7]];
      var FLAME = [[-6, -4], [-14, 0], [-6, 4]];

      function draw(ctx) {
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, W, H);
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        var i;

        ctx.strokeStyle = '#94a3b8';
        for (i = 0; i < rocks.length; i++) {
          (function (rock) {
            wrapped(ctx, rock.x, rock.y, rock.r + 2, function (c) {
              var pts = [];
              var n = rock.shape.length;
              for (var k = 0; k < n; k++) {
                var a = rock.rot + (k / n) * TAU;
                var rr = rock.r * rock.shape[k];
                pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
              }
              poly(c, pts, true);
            });
          })(rocks[i]);
        }

        ctx.strokeStyle = 'rgba(148,163,184,0.7)';
        for (i = 0; i < bits.length; i++) {
          (function (bit) {
            wrapped(ctx, bit.x, bit.y, 8, function (c) {
              c.globalAlpha = Math.max(0, Math.min(1, bit.life * 1.6));
              c.beginPath();
              c.moveTo(0, 0);
              c.lineTo(Math.cos(bit.a) * bit.len, Math.sin(bit.a) * bit.len);
              c.stroke();
              c.globalAlpha = 1;
            });
          })(bits[i]);
        }

        for (i = 0; i < shots.length; i++) {
          (function (s) {
            ctx.strokeStyle = s.foe ? '#f87171' : '#4ade80';
            wrapped(ctx, s.x, s.y, 5, function (c) {
              var m = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || 1;
              c.beginPath();
              c.moveTo(0, 0);
              c.lineTo(-(s.vx / m) * 4, -(s.vy / m) * 4);
              c.stroke();
            });
          })(shots[i]);
        }

        if (ufo) {
          ctx.strokeStyle = '#f87171';
          var k = ufo.small ? 0.66 : 1;
          ctx.save();
          ctx.translate(ufo.x, ufo.y);
          ctx.scale(k, k);
          poly(ctx, [[-16, -2], [-8, 3], [8, 3], [16, -2]], true);
          poly(ctx, [[-16, -2], [16, -2]], false);
          poly(ctx, [[-7, -2], [-4, -8], [4, -8], [7, -2]], false);
          poly(ctx, [[-8, 3], [-5, 8], [5, 8], [8, 3]], false);
          ctx.restore();
        }

        /* The invulnerable ship blinks rather than being drawn faintly: at
           this line width a faded outline is simply hard to see. */
        if (ship.alive && (ship.invuln <= 0 || Math.floor(clock * 9) % 2 === 0)) {
          ctx.strokeStyle = '#e2e8f0';
          wrapped(ctx, ship.x, ship.y, 16, function (c) {
            c.rotate(ship.a);
            poly(c, SHIP, true);
            /* The flame flickers, so thrust is legible as a state and not
               mistaken for part of the hull. */
            if (thrusting && Math.floor(clock * 22) % 2 === 0) {
              c.strokeStyle = '#fbbf24';
              poly(c, FLAME, false);
            }
          });
        }
      }

      return {
        reset: function () {
          rocks = [];
          shots = [];
          bits = [];
          ufo = null;
          lives = 3;
          wave = 0;
          clock = 0;
          respawn = 0;
          waveGap = 0;
          fireGap = 0;
          jumpGap = 0;
          nextLife = EXTRA_LIFE;
          thrusting = false;
          g.stat('lives', lives);
          placeShip();
          armUfo();
          startWave();
        },

        key: function (name) {
          if (name === 'action') fire();
          else if (name === 'down') hyperspace();
        },

        update: update,
        draw: draw
      };
    }
  });
})();

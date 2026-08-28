/* ==========================================================================
   rogue.js — a small roguelike: nine rooms, one lamp, one life.
   --------------------------------------------------------------------------
   Rooms are dug one per cell of a 3x3 grid and joined centre to centre. That
   is the oldest dungeon algorithm there is, and at this size it is still the
   right one: every level comes out connected by construction, so there is no
   generate-and-retry loop and no level that cannot be finished.

   Three decisions worth writing down.

   THE LAMP IS RAY-CAST, THE ROOM IS NOT. Sight is a Bresenham ray to every
   cell within five, which is what gives a corridor its one-square-at-a-time
   crawl. But standing inside a room lights the whole room regardless of that
   radius, and the override is deliberate — without it a twelve-by-four
   chamber is explored in fragments and you never see the thing walking
   across it, which is not how any of these games behaved. Doors block sight
   but not movement, so a room stays dark until you are standing in its
   doorway.

   THERE IS NO INVENTORY, AND THAT IS FORCED. The shell binds four arrows and
   one action key and no letters at all, on purpose. A pack you open with 'i'
   and drink from with 'q' has nowhere to live. So potions are drunk where
   they are found and a weapon is wielded only if it beats the one in hand.
   That removes a real layer of the original, and it is the only version of
   this game that is playable with a thumb pad.

   NOTHING RUNS ON A CLOCK. Every turn is a keystroke: the player acts, then
   the monsters act, then the frame is drawn. So this module returns no
   update hook at all and the shell's fixed timestep has nothing to do — a
   player can stare at a doorway for a minute and the dungeon waits.
   ========================================================================== */

(function () {
  'use strict';

  var MAPW = 70;
  var MAPH = 21;
  var MAPY = 1;                       // row 0 is the message line
  var GX = 3, GY = 3;                 // the cell grid the rooms are dug into
  var CELLW = Math.floor(MAPW / GX);  // 23
  var CELLH = Math.floor(MAPH / GY);  // 7

  var LAMP = 5;                       // how far the ray cast reaches
  var AGGRO = 8;                      // how far a monster notices you from
  var AMULET_DEPTH = 10;              // and every level below it

  /* Experience needed for level 2, 3, 4 ... Indexed by the level you are
     leaving, so NEED[1] is the cost of becoming level 2. */
  var NEED = [0, 10, 20, 40, 80, 160, 320, 640, 1300, 2600, 5200, 10400];

  var WEAPONS = [
    { name: 'dagger', dmg: 3 },
    { name: 'mace', dmg: 5 },
    { name: 'long sword', dmg: 7 },
    { name: 'two-handed sword', dmg: 9 }
  ];

  /* min is the shallowest level a thing appears on. A monster stops being
     generated four levels after that, which is what stops level nine being
     half rats. */
  var BESTIARY = [
    { ch: 'r', name: 'rat', hp: 4, atk: 3, xp: 1, min: 1, col: 'dim' },
    { ch: 'k', name: 'kobold', hp: 6, atk: 4, xp: 2, min: 1, col: 'green' },
    { ch: 'b', name: 'bat', hp: 5, atk: 3, xp: 2, min: 1, col: 'brown', erratic: true },
    { ch: 'j', name: 'jackal', hp: 7, atk: 4, xp: 3, min: 2, col: 'brown' },
    { ch: 'e', name: 'floating eye', hp: 8, atk: 2, xp: 4, min: 2, col: 'blue' },
    { ch: 'h', name: 'hobgoblin', hp: 11, atk: 5, xp: 6, min: 3, col: 'orange' },
    { ch: 'z', name: 'zombie', hp: 14, atk: 6, xp: 8, min: 4, col: 'grey' },
    { ch: 'o', name: 'orc', hp: 14, atk: 6, xp: 9, min: 4, col: 'red' },
    { ch: 'q', name: 'quagga', hp: 17, atk: 7, xp: 12, min: 5, col: 'orange' },
    { ch: 'C', name: 'centaur', hp: 22, atk: 8, xp: 16, min: 6, col: 'yellow' },
    { ch: 'T', name: 'troll', hp: 26, atk: 10, xp: 20, min: 6, col: 'red' },
    { ch: 'U', name: 'black unicorn', hp: 30, atk: 11, xp: 26, min: 7, col: 'magenta' },
    { ch: 'G', name: 'griffin', hp: 34, atk: 12, xp: 32, min: 8, col: 'cyan' },
    { ch: 'D', name: 'dragon', hp: 40, atk: 14, xp: 45, min: 9, col: 'red' }
  ];

  TermShell.define({
    id: 'game-rogue',
    slug: 'rogue',
    title: 'Rogue',
    cols: 70,
    rows: 24,
    bestKey: 'rogue',
    startTitle: 'Rogue',
    startText: 'Arrows move, and walking into a monster attacks it. Space rests a turn, or takes the stairs. One life.',

    setup: function (g) {
      var tiles = [];       // the level, one character per cell
      var seen = [];        // remembered: drawn dim once the lamp has left
      var vis = [];         // lit this turn
      var rooms = [];
      var items = [];
      var monsters = [];

      var px = 0, py = 0;
      var depth = 1;
      var hp = 16, maxhp = 16;
      var str = 0;          // flat damage bonus from potions
      var exp = 0, plevel = 1;
      var gold = 0;
      var weapon = WEAPONS[0];
      var turns = 0;
      var dead = false;
      var msg = '';
      var msgCol = 'white';

      function idx(x, y) { return y * MAPW + x; }
      function inside(x, y) { return x >= 0 && x < MAPW && y >= 0 && y < MAPH; }
      function tileAt(x, y) { return inside(x, y) ? tiles[idx(x, y)] : ' '; }

      function passable(x, y) {
        var t = tileAt(x, y);
        return t === '.' || t === '#' || t === '+' || t === '%';
      }

      /* A closed door blocks the eye but not the boot. See the header. */
      function blocksSight(x, y) {
        var t = tileAt(x, y);
        return t === ' ' || t === '-' || t === '|' || t === '+';
      }

      function say(text, colour) {
        msg = msg ? msg + '  ' + text : text;
        msgCol = colour || 'white';
      }

      /* ---------------------------------------------------------------
         Digging
         --------------------------------------------------------------- */
      function carveRoom(r) {
        var x, y;
        for (y = r.y - 1; y <= r.y + r.h; y++) {
          for (x = r.x - 1; x <= r.x + r.w; x++) {
            if (!inside(x, y)) continue;
            if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
              tiles[idx(x, y)] = '.';
            } else if (y === r.y - 1 || y === r.y + r.h) {
              tiles[idx(x, y)] = '-';
            } else {
              tiles[idx(x, y)] = '|';
            }
          }
        }
      }

      /* One cell of corridor. Rock becomes passage, a wall becomes a door,
         and anything already dug is left exactly as it was — which is what
         stops a corridor crossing a room from punching holes in its floor. */
      function dig(x, y) {
        if (!inside(x, y)) return;
        var t = tiles[idx(x, y)];
        if (t === ' ') tiles[idx(x, y)] = '#';
        else if (t === '-' || t === '|') tiles[idx(x, y)] = '+';
      }

      function run(x1, y1, x2, y2) {
        var s;
        if (y1 === y2) { for (s = Math.min(x1, x2); s <= Math.max(x1, x2); s++) dig(s, y1); }
        else { for (s = Math.min(y1, y2); s <= Math.max(y1, y2); s++) dig(x1, s); }
      }

      /* THREE SEGMENTS, NOT AN L, and the turn is always taken in the rock
         BETWEEN the two cells. A plain L from centre to centre eventually
         runs its long leg straight along a room's outer wall and converts
         the whole run into doors — a room with one open side and no way to
         tell where the doorway is. Turning in the gap means each leg meets
         a room square on its own centre line, so every room end of every
         corridor is exactly one door. */
      function connectH(a, b) {
        var y1 = a.y + (a.h >> 1), y2 = b.y + (b.h >> 1);
        var lo = a.x + a.w + 1, hi = b.x - 2;
        var mx = lo + g.rnd(Math.max(1, hi - lo + 1));
        run(a.x + (a.w >> 1), y1, mx, y1);
        run(mx, y1, mx, y2);
        run(mx, y2, b.x + (b.w >> 1), y2);
      }

      function connectV(a, b) {
        var x1 = a.x + (a.w >> 1), x2 = b.x + (b.w >> 1);
        var lo = a.y + a.h + 1, hi = b.y - 2;
        var my = lo + g.rnd(Math.max(1, hi - lo + 1));
        run(x1, a.y + (a.h >> 1), x1, my);
        run(x1, my, x2, my);
        run(x2, my, x2, b.y + (b.h >> 1));
      }

      function digLevel() {
        var i, gx, gy, cx, cy, rw, rh, r;
        tiles = [];
        seen = [];
        vis = [];
        for (i = 0; i < MAPW * MAPH; i++) { tiles.push(' '); seen.push(false); vis.push(false); }
        rooms = [];

        for (gy = 0; gy < GY; gy++) {
          for (gx = 0; gx < GX; gx++) {
            cx = gx * CELLW;
            cy = gy * CELLH;
            rw = 4 + g.rnd(9);            // 4..12, inside a 23-wide cell
            rh = 2 + g.rnd(CELLH - 4);    // 2..4, inside a 7-tall cell
            r = {
              x: cx + 1 + g.rnd(Math.max(1, CELLW - rw - 2)),
              y: cy + 1 + g.rnd(Math.max(1, CELLH - rh - 2)),
              w: rw, h: rh
            };
            carveRoom(r);
            rooms.push(r);
          }
        }

        /* Every room to its right-hand neighbour chains each row; one
           guaranteed vertical link per pair of rows joins the rows. The
           extra links are the loops, and a dungeon with no loops is a
           dungeon you can only ever back out of. */
        for (gy = 0; gy < GY; gy++) {
          for (gx = 0; gx < GX - 1; gx++) connectH(rooms[gy * GX + gx], rooms[gy * GX + gx + 1]);
        }
        for (gy = 0; gy < GY - 1; gy++) {
          var must = g.rnd(GX);
          for (gx = 0; gx < GX; gx++) {
            if (gx === must || g.rnd(10) < 4) {
              connectV(rooms[gy * GX + gx], rooms[(gy + 1) * GX + gx]);
            }
          }
        }
      }

      /* ---------------------------------------------------------------
         Populating
         --------------------------------------------------------------- */
      function itemAt(x, y) {
        for (var i = 0; i < items.length; i++) {
          if (items[i].x === x && items[i].y === y) return items[i];
        }
        return null;
      }

      function monsterAt(x, y) {
        for (var i = 0; i < monsters.length; i++) {
          if (monsters[i].x === x && monsters[i].y === y) return monsters[i];
        }
        return null;
      }

      function freeSpot(clearOfPlayer) {
        for (var tries = 0; tries < 240; tries++) {
          var r = rooms[g.rnd(rooms.length)];
          var x = r.x + g.rnd(r.w);
          var y = r.y + g.rnd(r.h);
          if (tiles[idx(x, y)] !== '.') continue;
          if (x === px && y === py) continue;
          if (clearOfPlayer && Math.abs(x - px) + Math.abs(y - py) < 5) continue;
          if (itemAt(x, y) || monsterAt(x, y)) continue;
          return { x: x, y: y };
        }
        return null;
      }

      function spawnMonster() {
        var pool = [];
        for (var i = 0; i < BESTIARY.length; i++) {
          var b = BESTIARY[i];
          if (b.min <= depth && b.min >= depth - 4) pool.push(b);
        }
        if (!pool.length) pool.push(BESTIARY[0]);
        var def = pool[g.rnd(pool.length)];
        var at = freeSpot(true);
        if (!at) return;
        /* A little extra meat per level below the one it first appears on,
           so a kobold on level five is still worth swinging at. */
        var bonus = Math.max(0, depth - def.min);
        monsters.push({
          x: at.x, y: at.y, ch: def.ch, name: def.name, col: def.col,
          hp: def.hp + bonus * 2, atk: def.atk + Math.floor(bonus / 2),
          xp: def.xp + bonus, erratic: !!def.erratic, awake: false
        });
      }

      function place(kind, extra) {
        var at = freeSpot(kind === 'gold' ? false : true);
        if (!at) return;
        var it = { x: at.x, y: at.y, kind: kind, seen: false };
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) it[k] = extra[k];
        }
        items.push(it);
      }

      function newLevel() {
        var i;
        digLevel();
        items = [];
        monsters = [];

        var si = g.rnd(rooms.length);
        var start = rooms[si];
        px = start.x + (start.w >> 1);
        py = start.y + (start.h >> 1);

        var ti = si;
        while (ti === si) ti = g.rnd(rooms.length);
        var far = rooms[ti];
        tiles[idx(far.x + g.rnd(far.w), far.y + g.rnd(far.h))] = '%';

        var piles = 2 + g.rnd(4);
        for (i = 0; i < piles; i++) place('gold', { amount: 5 + g.rnd(12 + depth * 8) });

        var potions = 1 + g.rnd(2);
        for (i = 0; i < potions; i++) {
          var roll = g.rnd(10);
          place('potion', { sub: roll < 6 ? 'healing' : (roll < 8 ? 'strength' : 'life') });
        }

        /* A weapon is rare on purpose. Finding the long sword should be the
           thing that changes a run, not a thing that happens every level. */
        if (g.rnd(10) < 4) {
          var tier = Math.min(WEAPONS.length - 1, 1 + g.rnd(Math.max(1, Math.floor(depth / 2))));
          place('weapon', { tier: tier });
        }

        if (depth >= AMULET_DEPTH) place('amulet', {});

        var n = Math.min(13, 4 + g.rnd(3) + Math.floor(depth / 2));
        for (i = 0; i < n; i++) spawnMonster();

        computeFov();
        g.stat('depth', depth);
        setScore();
      }

      /* ---------------------------------------------------------------
         Sight
         --------------------------------------------------------------- */
      function light(x, y) {
        if (!inside(x, y)) return;
        vis[idx(x, y)] = true;
        seen[idx(x, y)] = true;
      }

      /* Straight Bresenham, stopping on the first cell that blocks — that
         cell is still lit, because you can see the wall you cannot see
         through. */
      function ray(x1, y1) {
        var x = px, y = py;
        var dx = Math.abs(x1 - x), sx = px < x1 ? 1 : -1;
        var dy = -Math.abs(y1 - y), sy = py < y1 ? 1 : -1;
        var err = dx + dy;
        var guard = 0;
        while (guard++ < 64) {
          if (!(x === px && y === py)) {
            light(x, y);
            if (blocksSight(x, y)) return;
          }
          if (x === x1 && y === y1) return;
          var e2 = 2 * err;
          if (e2 >= dy) { err += dy; x += sx; }
          if (e2 <= dx) { err += dx; y += sy; }
        }
      }

      function roomAt(x, y) {
        for (var i = 0; i < rooms.length; i++) {
          var r = rooms[i];
          if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
        }
        return null;
      }

      function computeFov() {
        var i, x, y;
        for (i = 0; i < vis.length; i++) vis[i] = false;
        light(px, py);

        for (y = -LAMP; y <= LAMP; y++) {
          for (x = -LAMP; x <= LAMP; x++) {
            if (x * x + y * y > LAMP * LAMP + LAMP) continue;
            ray(px + x, py + y);
          }
        }

        var r = roomAt(px, py);
        if (r) {
          for (y = r.y - 1; y <= r.y + r.h; y++) {
            for (x = r.x - 1; x <= r.x + r.w; x++) light(x, y);
          }
        }
      }

      /* ---------------------------------------------------------------
         Score, levelling, death
         --------------------------------------------------------------- */
      function setScore() {
        g.setScore(gold + depth * 25);
      }

      /* Clamped, because the blow that kills you overshoots and a HUD
         reading -3/16 is a bug report waiting to happen. */
      function syncHp() {
        g.stat('hp', Math.max(0, hp) + '/' + maxhp);
      }

      function checkLevelUp() {
        while (plevel < NEED.length && exp >= NEED[plevel]) {
          plevel++;
          var gain = 3 + g.rnd(5);
          maxhp += gain;
          hp += gain;
          say('Welcome to experience level ' + plevel + '.', 'yellow');
          g.beep(700, 0.1, 'sine', 0.05);
        }
        syncHp();
      }

      function die(cause) {
        dead = true;
        setScore();
        g.over({
          score: gold + depth * 25,
          title: 'Killed on level ' + depth,
          message: cause + ' You had ' + gold + ' gold and reached level ' + depth + '.'
        });
      }

      /* ---------------------------------------------------------------
         Combat
         --------------------------------------------------------------- */
      function playerAttack(m) {
        if (g.rng() < 0.22) {
          say('You miss the ' + m.name + '.', 'grey');
          g.beep(180, 0.04, 'square', 0.03);
          return;
        }
        var dmg = 1 + g.rnd(weapon.dmg) + str;
        m.hp -= dmg;
        m.awake = true;
        g.beep(420, 0.05, 'square', 0.04);
        if (m.hp > 0) { say('You hit the ' + m.name + '.', 'white'); return; }
        for (var i = 0; i < monsters.length; i++) {
          if (monsters[i] === m) { monsters.splice(i, 1); break; }
        }
        exp += m.xp;
        say('You defeated the ' + m.name + '.', 'green');
        g.beep(560, 0.08, 'sine', 0.05);
        checkLevelUp();
      }

      function monsterAttack(m) {
        if (g.rng() < 0.32) { say('The ' + m.name + ' misses you.', 'grey'); return; }
        var dmg = 1 + g.rnd(m.atk);
        hp -= dmg;
        syncHp();
        g.beep(200, 0.06, 'sawtooth', 0.04);
        if (hp <= 0) { die('A ' + m.name + ' killed you.'); return; }
        say('The ' + m.name + ' hits you for ' + dmg + '.', hp <= maxhp / 4 ? 'red' : 'orange');
      }

      /* ---------------------------------------------------------------
         Monster turns
         --------------------------------------------------------------- */
      function stepToward(m) {
        var dx = px - m.x, dy = py - m.y;
        var order = [];
        if (Math.abs(dx) >= Math.abs(dy)) {
          order.push([dx > 0 ? 1 : -1, 0]);
          if (dy) order.push([0, dy > 0 ? 1 : -1]);
        } else {
          order.push([0, dy > 0 ? 1 : -1]);
          if (dx) order.push([dx > 0 ? 1 : -1, 0]);
        }
        for (var i = 0; i < order.length; i++) {
          var nx = m.x + order[i][0], ny = m.y + order[i][1];
          if (!passable(nx, ny)) continue;
          if (nx === px && ny === py) continue;
          if (monsterAt(nx, ny)) continue;
          m.x = nx; m.y = ny;
          return;
        }
      }

      function wander(m) {
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        var d = dirs[g.rnd(4)];
        var nx = m.x + d[0], ny = m.y + d[1];
        if (!passable(nx, ny)) return;
        if (nx === px && ny === py) return;
        if (monsterAt(nx, ny)) return;
        m.x = nx; m.y = ny;
      }

      function monstersAct() {
        /* Iterated over a copy: a monster can die mid-turn only through the
           player, but the array is spliced on death and a live index into a
           shrinking array skips whoever moved up. */
        var list = monsters.slice(0);
        for (var i = 0; i < list.length; i++) {
          if (dead) return;
          var m = list[i];
          var gap = Math.abs(m.x - px) + Math.abs(m.y - py);

          if (gap === 1) { monsterAttack(m); continue; }

          /* Sight is symmetric here: if your lamp reaches it, it can see
             you. Once woken it stays woken, which is what makes retreating
             down a corridor a real decision rather than a free escape. */
          if (!m.awake && vis[idx(m.x, m.y)] && gap <= AGGRO) m.awake = true;
          if (!m.awake) continue;

          if (m.erratic && g.rnd(2)) wander(m);
          else stepToward(m);
        }
      }

      function regenerate() {
        var every = Math.max(5, 14 - plevel);
        if (turns % every === 0 && hp < maxhp) { hp++; syncHp(); }
      }

      /* ---------------------------------------------------------------
         Player turns
         --------------------------------------------------------------- */
      function pickUp() {
        var it = itemAt(px, py);
        if (!it) return;
        var heal;

        if (it.kind === 'gold') {
          gold += it.amount;
          setScore();
          say('You pick up ' + it.amount + ' gold.', 'yellow');
          g.beep(880, 0.06, 'sine', 0.04);
        } else if (it.kind === 'potion') {
          if (it.sub === 'healing') {
            heal = 5 + g.rnd(6) + depth;
            if (hp + heal >= maxhp) { maxhp += 1; hp = maxhp; }
            else hp += heal;
            say('You drink a healing potion.', 'green');
          } else if (it.sub === 'strength') {
            str += 1;
            say('You drink a potion of strength. You feel stronger.', 'green');
          } else {
            maxhp += 4;
            hp = maxhp;
            say('You drink a potion of life. That was a good one.', 'green');
          }
          syncHp();
          g.beep(640, 0.09, 'sine', 0.05);
        } else if (it.kind === 'weapon') {
          var w = WEAPONS[it.tier];
          if (w.dmg > weapon.dmg) {
            weapon = w;
            say('You are now wielding a ' + w.name + '.', 'cyan');
            g.beep(520, 0.09, 'square', 0.05);
          } else {
            say('You find a ' + w.name + ' and leave it. Yours is better.', 'grey');
          }
        } else if (it.kind === 'amulet') {
          gold += 500;
          setScore();
          g.over({
            won: true,
            score: gold + depth * 25,
            title: 'The Amulet of Yendor',
            message: 'You have it, on level ' + depth + ', with ' + hp + ' hit points left.'
          });
          return;
        }

        for (var i = 0; i < items.length; i++) {
          if (items[i] === it) { items.splice(i, 1); break; }
        }
      }

      /* Returns true when the action cost a turn. Walking into a wall does
         not — a misfired arrow key should never hand the dungeon a free
         round of attacks. */
      function move(dx, dy) {
        var nx = px + dx, ny = py + dy;
        var m = monsterAt(nx, ny);
        if (m) { playerAttack(m); return true; }
        if (!passable(nx, ny)) {
          g.beep(140, 0.03, 'square', 0.02);
          return false;
        }
        px = nx;
        py = ny;
        pickUp();
        return true;
      }

      function descend() {
        if (tileAt(px, py) !== '%') {
          say('You rest.', 'grey');
          return true;
        }
        depth += 1;
        newLevel();
        msg = '';
        say('You climb down to level ' + depth + '.', 'cyan');
        if (depth >= AMULET_DEPTH) say('Something down here is glowing.', 'yellow');
        g.sweep(400, 200, 0.25);
        return false;   // the new level starts fresh; nothing gets a free swing
      }

      function turn(name) {
        if (g.state !== 'playing' || dead) return;
        msg = '';
        var spent = false;

        if (name === 'up') spent = move(0, -1);
        else if (name === 'down') spent = move(0, 1);
        else if (name === 'left') spent = move(-1, 0);
        else if (name === 'right') spent = move(1, 0);
        else if (name === 'action') spent = descend();

        if (g.state !== 'playing') return;

        if (spent) {
          turns++;
          monstersAct();
          if (dead) return;
          regenerate();
        }
        computeFov();
      }

      /* ---------------------------------------------------------------
         Drawing
         --------------------------------------------------------------- */
      var LIT = {
        '.': 'dim', '#': 'dim', '-': 'green', '|': 'green', '+': 'brown', '%': 'cyan'
      };
      var ITEM_CH = { gold: '*', potion: '!', weapon: ')', amulet: ',' };
      var ITEM_COL = { gold: 'yellow', potion: 'magenta', weapon: 'cyan', amulet: 'yellow' };

      function draw(term) {
        term.clear();
        var x, y, i, t;

        for (y = 0; y < MAPH; y++) {
          for (x = 0; x < MAPW; x++) {
            i = idx(x, y);
            t = tiles[i];
            if (t === ' ') continue;
            if (vis[i]) term.put(x, y + MAPY, t, LIT[t] || 'green');
            else if (seen[i]) term.put(x, y + MAPY, t, 'dark');
          }
        }

        for (i = 0; i < items.length; i++) {
          var it = items[i];
          var lit = vis[idx(it.x, it.y)];
          if (lit) it.seen = true;
          else if (!it.seen) continue;
          term.put(it.x, it.y + MAPY, ITEM_CH[it.kind], lit ? ITEM_COL[it.kind] : 'dark');
        }

        for (i = 0; i < monsters.length; i++) {
          var m = monsters[i];
          if (!vis[idx(m.x, m.y)]) continue;      // no map memory for things that move
          term.put(m.x, m.y + MAPY, m.ch, m.col);
        }

        term.put(px, py + MAPY, '@', 'white');

        if (msg) term.text(0, 0, msg.length > MAPW ? msg.slice(0, MAPW) : msg, msgCol);

        var status = 'Level ' + depth +
          '   Hp ' + Math.max(0, hp) + '(' + maxhp + ')' +
          '   Exp ' + plevel + '/' + exp +
          '   Gold ' + gold +
          '   ' + weapon.name + (str ? ' +' + str : '');
        term.text(0, 22, status, 'green');
        term.text(0, 23, 'Arrows move and attack.  Space rests, or descends on the %.', 'dim');
      }

      return {
        reset: function () {
          depth = 1;
          hp = 16; maxhp = 16;
          str = 0;
          exp = 0; plevel = 1;
          gold = 0;
          weapon = WEAPONS[0];
          turns = 0;
          dead = false;
          msg = '';
          newLevel();
          syncHp();
          say('You are on level 1 of the dungeon. Find the stairs.', 'white');
        },

        key: function (name) { turn(name); },

        draw: draw
      };
    }
  });
})();

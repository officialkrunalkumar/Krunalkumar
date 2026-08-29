/* ==========================================================================
   trek.js — Star Trek (Mike Mayfield, 1971).
   --------------------------------------------------------------------------
   An 8x8 galaxy of quadrants, each an 8x8 grid of sectors. Klingons, stars
   and a handful of starbases are scattered through it, and you have a fixed
   number of stardates to clear the fleet out.

   Two decisions here are not obvious, and both are worth the paragraph.

   1. THE COMMAND LINE IS GONE, REPLACED BY MODES. The original prompts
      "COMMAND?" and reads NAV, SRS, LRS, PHA, TOR, SHE, DOC. This shell binds
      no letter keys at all — deliberately, so that the typing games can exist
      on the same shell — so there is nothing to type a command with. Instead
      the orders sit in a row you walk along with left and right, and each one
      opens a mode where the arrows mean something specific: on the chart they
      move a warp cursor, in the sector they steer one square at a time, on
      the phasers they add and subtract energy, on the tube they swing the
      firing course round eight points. Every order therefore has a natural
      way to back out without doing anything — warp to the quadrant you are
      already in, fire nothing, transfer nothing — which is what replaces the
      Enter-on-an-empty-prompt escape the original relied on.

   2. A QUADRANT'S KLINGONS ARE REBUILT EVERY TIME YOU ARRIVE. The galaxy
      stores counts, not ships: how many klingons, whether there is a base,
      how many stars. Positions and klingon energy are generated on entry and
      thrown away on departure, exactly as the 1971 game did. It means a
      wounded klingon you warp away from is whole again when you come back,
      which sounds like a bug and is in fact the pressure that makes the game
      work: leaving a fight costs you the fight, so you finish what you start.

   Turn-based, so there is no update() hook at all — nothing moves between
   your orders, and the clock is the stardate, not the frame rate.
   ========================================================================== */

(function () {
  'use strict';

  var GW = 8;                 // quadrants across and down the galaxy
  var SW = 8;                 // sectors across and down a quadrant

  var MAX_ENERGY = 3000;
  var MAX_TORP = 10;
  var START_DATE = 2250;
  var SPAN = 40;              // stardates you are given to finish the job

  var IMPULSE_COST = 20;      // energy for one sector of impulse power

  /* Eight points of the compass, clockwise from north. The original took a
     course of 1 to 9 on a circle; eight cells is the same idea at the
     resolution a character grid can actually draw. */
  var DIR8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  var ARROW8 = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

  var ORDERS = [
    { id: 'warp', name: 'WARP' },
    { id: 'move', name: 'MOVE' },
    { id: 'phaser', name: 'PHASER' },
    { id: 'torpedo', name: 'TORPEDO' },
    { id: 'scan', name: 'L-SCAN' },
    { id: 'shields', name: 'SHIELDS' }
  ];

  TermShell.define({
    id: 'game-trek',
    slug: 'trek',
    title: 'Star Trek',
    cols: 70,
    rows: 24,
    bestKey: 'trek',
    tapAction: false,
    startTitle: 'Star Trek',
    startText: 'Sixty-four quadrants, a klingon fleet and forty stardates. Arrows choose an order, Space gives it.',

    setup: function (g, t) {
      var galaxy = [];        // 64 records: { k, b, s, known }
      var sector = [];        // 64 cells in the quadrant you are standing in
      var klingons = [];      // { x, y, e } for the current quadrant only
      var baseAt = null;      // { x, y } or null

      var qx = 0, qy = 0;     // quadrant
      var sx = 0, sy = 0;     // sector within it
      var energy = MAX_ENERGY;
      var shields = 0;
      var torps = MAX_TORP;
      var stardate = START_DATE;
      var endDate = START_DATE + SPAN;
      var totalK = 0;
      var docked = false;
      var lowWarned = false;

      var log = [];
      var mode = 'menu';      // menu | warp | move | phaser | torpedo | shields
      var sel = 0;            // which order is highlighted
      var cursor = { x: 0, y: 0 };   // warp cursor on the chart
      var amount = 0;         // phaser units, or the shield transfer
      var aim = 0;            // index into DIR8

      /* The one button in the toolbar: an escape hatch out of any mode for
         anybody who would rather not work out which no-op cancels it. */
      var cancelBtn = document.getElementById('game-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          if (g.state !== 'playing') return;
          mode = 'menu';
          say('Order withdrawn.', 'dim');
        });
      }

      function gi(x, y) { return y * GW + x; }
      function si(x, y) { return y * SW + x; }

      function say(line, tint) {
        log.push({ s: line, c: tint || 'green' });
        while (log.length > 5) log.shift();
      }

      function sync() {
        g.stat('stardate', stardate.toFixed(1));
        g.stat('energy', energy);
        g.stat('torps', torps);
        g.stat('klingons', totalK);
      }

      /* ---------------------------------------------------------------
         Building the galaxy and the quadrant you are inside.
         --------------------------------------------------------------- */
      function buildGalaxy() {
        var i;
        galaxy = [];
        for (i = 0; i < GW * GW; i++) {
          galaxy.push({ k: 0, b: 0, s: 1 + g.rnd(8), known: false });
        }

        totalK = 10 + g.rnd(5);
        var left = totalK;
        /* No more than three to a quadrant: four is unsurvivable on the
           energy budget and the original capped it for the same reason. */
        while (left > 0) {
          i = g.rnd(GW * GW);
          if (galaxy[i].k < 3) { galaxy[i].k++; left--; }
        }

        var bases = 3 + g.rnd(2);
        while (bases > 0) {
          i = g.rnd(GW * GW);
          if (!galaxy[i].b) { galaxy[i].b = 1; bases--; }
        }

        /* Start somewhere quiet. Warping in on top of three klingons before
           you have read the chart is a loss decided by the deal, not by you. */
        do { i = g.rnd(GW * GW); } while (galaxy[i].k > 0);
        qx = i % GW;
        qy = Math.floor(i / GW);
      }

      function placeAt(ch) {
        var free = [];
        for (var i = 0; i < SW * SW; i++) if (sector[i] === '.') free.push(i);
        if (!free.length) return -1;
        var idx = free[g.rnd(free.length)];
        sector[idx] = ch;
        return idx;
      }

      function enterQuadrant() {
        var q = galaxy[gi(qx, qy)];
        var i, idx;
        q.known = true;

        sector = [];
        for (i = 0; i < SW * SW; i++) sector.push('.');
        klingons = [];
        baseAt = null;

        idx = placeAt('E');
        sx = idx % SW;
        sy = Math.floor(idx / SW);

        for (i = 0; i < q.k; i++) {
          idx = placeAt('K');
          if (idx < 0) break;
          klingons.push({ x: idx % SW, y: Math.floor(idx / SW), e: 120 + g.rnd(140) });
        }
        if (q.b) {
          idx = placeAt('B');
          if (idx >= 0) baseAt = { x: idx % SW, y: Math.floor(idx / SW) };
        }
        for (i = 0; i < q.s; i++) placeAt('*');

        docked = false;
        dockCheck();
        if (klingons.length) {
          say('Condition red: ' + klingons.length + ' klingon' +
              (klingons.length === 1 ? '' : 's') + ' in this quadrant.', 'red');
          g.beep(180, 0.14, 'square', 0.05);
        }
      }

      /* ---------------------------------------------------------------
         The clock, damage, and the three ways a run ends.
         --------------------------------------------------------------- */
      function advance(days) {
        stardate += days;
        sync();
        if (stardate >= endDate) {
          say('The stardate has run out. Starfleet relieves you of command.', 'red');
          g.over({
            score: g.score,
            title: 'Out of time',
            message: totalK + ' klingons were still at large when the clock ran out.'
          });
        }
      }

      function damage(n) {
        if (shields >= n) { shields -= n; return; }
        n -= shields;
        shields = 0;
        energy -= n;
        if (energy < 0) energy = 0;
      }

      /* Called after every order that takes time. Docked means the base's
         own shields are over you, so nothing gets through. */
      function klingonsFire() {
        if (g.state !== 'playing' || docked || !klingons.length) return;
        for (var i = 0; i < klingons.length; i++) {
          var k = klingons[i];
          var d = Math.sqrt((k.x - sx) * (k.x - sx) + (k.y - sy) * (k.y - sy));
          var hit = Math.round((k.e * 0.4) / (1 + d * 0.4) * (0.8 + 0.4 * Math.random()));
          if (hit < 1) hit = 1;
          damage(hit);
          say('Hit from the klingon at ' + (k.x + 1) + ',' + (k.y + 1) + ' — ' + hit +
              ' units. Shields ' + shields + ', energy ' + energy + '.', 'red');
        }
        g.beep(120, 0.1, 'sawtooth', 0.05);
        sync();
        /* Destroyed means the hit went through the HULL — shields count.
           A captain who banks everything in the shields runs at energy 0
           on purpose, and a volley the shields fully absorbed was ending
           the game on that bookkeeping. Zero on both is the real verdict;
           energy 0 with shields up is strandCheck's business, not this. */
        if (energy <= 0 && shields <= 0) {
          g.over({ score: g.score, title: 'Enterprise destroyed', message: 'The last hit went through the hull.' });
        }
      }

      /* Below one impulse move's worth of energy the ship cannot reach a
         starbase, and a ship that cannot reach a starbase is lost however
         many torpedoes are still in the racks. Ending it here rather than
         letting the stardate run out is the difference between a verdict and
         twenty minutes of pressing buttons at a corpse. Shields count,
         because they can be transferred back. */
      function strandCheck() {
        if (g.state !== 'playing') return;
        if (energy + shields < IMPULSE_COST) {
          say('Out of energy, out of range of any starbase.', 'red');
          g.over({ score: g.score, title: 'Adrift', message: 'The Enterprise runs dry with ' + totalK + ' klingons left.' });
          return;
        }
        if (energy + shields < 400 && !docked && !lowWarned) {
          lowWarned = true;
          say('Energy low. Find a starbase and dock before it runs out.', 'orange');
        }
        if (energy + shields >= 900) lowWarned = false;
      }

      function dockCheck() {
        var near = !!baseAt && Math.abs(sx - baseAt.x) <= 1 && Math.abs(sy - baseAt.y) <= 1;
        if (near && !docked) {
          energy = MAX_ENERGY;
          torps = MAX_TORP;
          shields = 0;
          sync();
          say('Docked at the starbase. Refuelled, rearmed, shields down.', 'cyan');
          g.beep(660, 0.12, 'sine', 0.05);
        }
        docked = near;
      }

      function destroyKlingon(x, y) {
        for (var i = 0; i < klingons.length; i++) {
          if (klingons[i].x === x && klingons[i].y === y) { klingons.splice(i, 1); break; }
        }
        sector[si(x, y)] = '.';
        var q = galaxy[gi(qx, qy)];
        if (q.k > 0) q.k--;
        totalK--;
        g.addScore(100);
        sync();
        say('Klingon at sector ' + (x + 1) + ',' + (y + 1) + ' destroyed.', 'yellow');
        g.beep(320, 0.16, 'sawtooth', 0.05);
        if (totalK <= 0) {
          var spare = endDate - stardate;
          g.over({
            won: true,
            score: g.score + Math.round(Math.max(0, spare) * 30),
            title: 'Fleet destroyed',
            message: 'Every klingon accounted for, with ' + spare.toFixed(1) + ' stardates to spare.'
          });
        }
      }

      /* ---------------------------------------------------------------
         The orders themselves.
         --------------------------------------------------------------- */
      function warpTo(nx, ny) {
        var dx = nx - qx;
        var dy = ny - qy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) {
          mode = 'menu';
          say('Holding station in quadrant ' + (qx + 1) + ',' + (qy + 1) + '.', 'dim');
          return;
        }
        var cost = Math.round(50 * dist) + 20;
        if (cost > energy) {
          say('Warp to there needs ' + cost + ' units and you have ' + energy + '.', 'red');
          return;
        }
        energy -= cost;
        qx = nx;
        qy = ny;
        mode = 'menu';
        /* Said before the arrival, so the log reads in the order the events
           happened: you left, you arrived, and then somebody shot at you. */
        say('Warped to quadrant ' + (qx + 1) + ',' + (qy + 1) + ' for ' + cost + ' units.', 'green');
        enterQuadrant();
        sync();
        advance(dist);
        if (g.state !== 'playing') return;
        klingonsFire();
        strandCheck();
      }

      function impulse(dx, dy) {
        var nx = sx + dx;
        var ny = sy + dy;
        if (nx < 0 || nx >= SW || ny < 0 || ny >= SW) {
          say('That is the edge of the quadrant. Leaving it takes warp drive.', 'dim');
          return;
        }
        if (sector[si(nx, ny)] !== '.') {
          say('Blocked — something is occupying sector ' + (nx + 1) + ',' + (ny + 1) + '.', 'dim');
          return;
        }
        if (energy < IMPULSE_COST) {
          say('Not enough energy for impulse power.', 'red');
          strandCheck();
          return;
        }
        sector[si(sx, sy)] = '.';
        sx = nx;
        sy = ny;
        sector[si(sx, sy)] = 'E';
        energy -= IMPULSE_COST;
        sync();
        advance(0.05);
        if (g.state !== 'playing') return;
        dockCheck();
        klingonsFire();
        strandCheck();
      }

      function firePhasers(units) {
        mode = 'menu';
        if (units <= 0) { say('Phasers held.', 'dim'); return; }
        if (!klingons.length) { say('Nothing in range in this quadrant.', 'dim'); return; }
        if (units > energy) units = energy;

        energy -= units;
        var share = units / klingons.length;
        var targets = klingons.slice(0);
        say('Phasers fire: ' + units + ' units split ' + targets.length + ' ways.', 'yellow');
        g.beep(880, 0.1, 'square', 0.05);

        for (var i = 0; i < targets.length; i++) {
          var k = targets[i];
          var d = Math.sqrt((k.x - sx) * (k.x - sx) + (k.y - sy) * (k.y - sy));
          /* Energy spreads with range, which is the whole reason closing to
             point blank before firing is worth the hits you take doing it. */
          var hit = Math.round(share * (1 - 0.06 * d) * (0.85 + 0.3 * Math.random()));
          if (hit < 0) hit = 0;
          k.e -= hit;
          if (k.e <= 0) {
            destroyKlingon(k.x, k.y);
            if (g.state !== 'playing') return;
          } else {
            say('Klingon at ' + (k.x + 1) + ',' + (k.y + 1) + ' took ' + hit + ' units, ' + k.e + ' left.', 'orange');
          }
        }

        sync();
        advance(0.1);
        if (g.state !== 'playing') return;
        klingonsFire();
        strandCheck();
      }

      function fireTorpedo(dirIndex) {
        mode = 'menu';
        if (torps <= 0) { say('No torpedoes left.', 'red'); return; }
        torps--;
        sync();
        g.beep(520, 0.09, 'sine', 0.05);

        var d = DIR8[dirIndex];
        var x = sx;
        var y = sy;
        var hitSomething = false;
        for (var step = 0; step < SW; step++) {
          x += d[0];
          y += d[1];
          if (x < 0 || x >= SW || y < 0 || y >= SW) break;
          var c = sector[si(x, y)];
          if (c === 'K') {
            destroyKlingon(x, y);
            hitSomething = true;
            break;
          }
          if (c === '*') {
            say('The torpedo is absorbed by the star at ' + (x + 1) + ',' + (y + 1) + '.', 'dim');
            hitSomething = true;
            break;
          }
          if (c === 'B') {
            sector[si(x, y)] = '.';
            baseAt = null;
            docked = false;
            galaxy[gi(qx, qy)].b = 0;
            g.setScore(Math.max(0, g.score - 200));
            say('You have destroyed a starbase. Starfleet is not pleased.', 'red');
            hitSomething = true;
            break;
          }
        }
        if (!hitSomething) say('The torpedo runs out of the quadrant and is lost.', 'dim');
        if (g.state !== 'playing') return;

        advance(0.1);
        if (g.state !== 'playing') return;
        klingonsFire();
        strandCheck();
      }

      /* The long range scan reads the eight quadrants around you onto the
         chart and costs nothing, exactly as LRS did. The chart is permanent:
         what you scan stays scanned. */
      function longScan() {
        var found = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var x = qx + dx;
            var y = qy + dy;
            if (x < 0 || x >= GW || y < 0 || y >= GW) continue;
            if (!galaxy[gi(x, y)].known) found++;
            galaxy[gi(x, y)].known = true;
          }
        }
        say('Long range scan: ' + found + ' new quadrant' + (found === 1 ? '' : 's') + ' on the chart.', 'cyan');
        g.beep(440, 0.06, 'sine', 0.04);
      }

      function transfer(units) {
        mode = 'menu';
        if (units === 0) { say('Nothing transferred.', 'dim'); return; }
        if (units > 0) {
          if (units > energy) units = energy;
          energy -= units;
          shields += units;
          say(units + ' units to the shields. Shields ' + shields + ', energy ' + energy + '.', 'cyan');
        } else {
          var back = Math.min(-units, shields);
          shields -= back;
          energy += back;
          say(back + ' units back from the shields. Shields ' + shields + ', energy ' + energy + '.', 'cyan');
        }
        sync();
      }

      function openOrder() {
        var id = ORDERS[sel].id;
        if (id === 'warp') { mode = 'warp'; cursor.x = qx; cursor.y = qy; return; }
        if (id === 'move') { mode = 'move'; say('Impulse power. Arrows steer, Space stops.', 'dim'); return; }
        if (id === 'phaser') {
          if (!klingons.length) { say('No klingon in this quadrant to fire at.', 'dim'); return; }
          mode = 'phaser';
          amount = Math.min(500, energy);
          return;
        }
        if (id === 'torpedo') {
          if (torps <= 0) { say('No torpedoes left. Dock at a starbase.', 'red'); return; }
          mode = 'torpedo';
          aim = 2;
          return;
        }
        if (id === 'scan') { longScan(); return; }
        if (id === 'shields') { mode = 'shields'; amount = 0; return; }
      }

      /* ---------------------------------------------------------------
         Drawing.
         --------------------------------------------------------------- */
      function quadLabel() { return (qx + 1) + ',' + (qy + 1); }

      function drawSector(term) {
        term.box(1, 2, 30, 11, 'dim');
        term.text(3, 2, ' SHORT RANGE SCAN ' + quadLabel() + ' ', 'green');

        var x, y;
        for (x = 0; x < SW; x++) term.put(5 + x * 3, 3, String(x + 1), 'dark');
        for (y = 0; y < SW; y++) term.put(2, 4 + y, String(y + 1), 'dark');

        /* The torpedo course, drawn before the objects so a klingon sitting
           on the line still shows as a klingon. */
        if (mode === 'torpedo') {
          var d = DIR8[aim];
          var tx = sx, ty = sy;
          for (var s = 0; s < SW; s++) {
            tx += d[0]; ty += d[1];
            if (tx < 0 || tx >= SW || ty < 0 || ty >= SW) break;
            term.put(5 + tx * 3, 4 + ty, ARROW8[aim], 'yellow');
          }
        }

        for (y = 0; y < SW; y++) {
          for (x = 0; x < SW; x++) {
            var c = sector[si(x, y)];
            var cx = 4 + x * 3;
            var cy = 4 + y;
            if (c === 'E') {
              term.text(cx, cy, '<E>', mode === 'move' ? 'yellow' : 'white');
            } else if (c === 'K') {
              term.text(cx, cy, '+K+', 'red');
            } else if (c === 'B') {
              term.text(cx, cy, '>B<', 'cyan');
            } else if (c === '*') {
              term.put(cx + 1, cy, '*', 'yellow');
            } else if (mode !== 'torpedo' || term.at(cx + 1, cy) === ' ') {
              term.put(cx + 1, cy, '·', 'dark');
            }
          }
        }
      }

      function drawChart(term) {
        term.box(32, 2, 38, 11, 'dim');
        term.text(34, 2, ' GALAXY CHART ', 'green');

        var x, y;
        for (x = 0; x < GW; x++) term.put(37 + x * 4, 3, String(x + 1), 'dark');
        for (y = 0; y < GW; y++) term.put(34, 4 + y, String(y + 1), 'dark');

        for (y = 0; y < GW; y++) {
          for (x = 0; x < GW; x++) {
            var q = galaxy[gi(x, y)];
            var here = x === qx && y === qy;
            var cx = 36 + x * 4;
            var cy = 4 + y;
            var tint = 'dim';
            var txt = '...';
            if (q.known) {
              txt = String(q.k) + String(q.b) + String(Math.min(9, q.s));
              tint = q.k ? 'red' : (q.b ? 'cyan' : 'dim');
            } else {
              tint = 'dark';
            }
            if (here) tint = 'white';
            term.text(cx, cy, txt, tint);
            if (mode === 'warp' && cursor.x === x && cursor.y === y) {
              term.put(cx - 1, cy, '[', 'yellow');
              term.put(cx + 3, cy, ']', 'yellow');
            }
          }
        }
      }

      function drawOrders(term) {
        var x = 1;
        term.text(x, 20, 'ORDERS', 'dim');
        x += 7;
        for (var i = 0; i < ORDERS.length; i++) {
          var on = i === sel && mode === 'menu';
          var label = (on ? '[' : ' ') + ORDERS[i].name + (on ? ']' : ' ');
          term.text(x, 20, label, on ? 'white' : (i === sel ? 'green' : 'dim'));
          x += label.length + 1;
        }
      }

      function prompt() {
        if (mode === 'warp') {
          var dx = cursor.x - qx;
          var dy = cursor.y - qy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist === 0) return 'The cursor is on your own quadrant — Space holds station.';
          return 'Warp to ' + (cursor.x + 1) + ',' + (cursor.y + 1) + ': ' +
                 (Math.round(50 * dist) + 20) + ' units of energy, ' + dist.toFixed(1) + ' stardates.';
        }
        if (mode === 'move') {
          return 'Impulse power: ' + IMPULSE_COST + ' units a sector. Space returns to orders.';
        }
        if (mode === 'phaser') {
          return 'Fire ' + amount + ' units at ' + klingons.length + ' klingon' +
                 (klingons.length === 1 ? '' : 's') + ', ' + Math.round(amount / Math.max(1, klingons.length)) + ' each.';
        }
        if (mode === 'torpedo') {
          return 'Course ' + ARROW8[aim] + ' — ' + torps + ' torpedo' + (torps === 1 ? '' : 'es') + ' in the tubes.';
        }
        if (mode === 'shields') {
          if (amount >= 0) return 'Transfer ' + amount + ' units of energy into the shields.';
          return 'Take ' + (-amount) + ' units back out of the shields.';
        }
        return 'Choose an order. ' + (docked ? 'Docked at the starbase.' : 'Klingons here: ' + klingons.length + '.');
      }

      function hint() {
        if (mode === 'warp') return '←↑↓→ move the cursor     space engage';
        if (mode === 'move') return '←↑↓→ one sector          space done';
        if (mode === 'phaser') return '↑↓ ±100     ←→ ±500     space fire';
        if (mode === 'torpedo') return '←↑ swing left   →↓ swing right   space fire';
        if (mode === 'shields') return '↑↓ ±100 units      space transfer';
        return '← → choose an order     space give it     esc pause';
      }

      /* ---------------------------------------------------------------
         Hooks.
         --------------------------------------------------------------- */
      return {
        reset: function () {
          energy = MAX_ENERGY;
          shields = 0;
          torps = MAX_TORP;
          stardate = START_DATE;
          endDate = START_DATE + SPAN;
          docked = false;
          lowWarned = false;
          mode = 'menu';
          sel = 0;
          amount = 0;
          aim = 2;
          log = [];
          buildGalaxy();
          say('Mission: destroy the klingon fleet before stardate ' + endDate.toFixed(1) + '.', 'green');
          enterQuadrant();
          sync();
        },

        key: function (name) {
          if (g.state !== 'playing') return;

          if (mode === 'menu') {
            if (name === 'left') { sel = (sel + ORDERS.length - 1) % ORDERS.length; return; }
            if (name === 'right') { sel = (sel + 1) % ORDERS.length; return; }
            if (name === 'action') { openOrder(); }
            return;
          }

          if (mode === 'warp') {
            if (name === 'left') { cursor.x = Math.max(0, cursor.x - 1); return; }
            if (name === 'right') { cursor.x = Math.min(GW - 1, cursor.x + 1); return; }
            if (name === 'up') { cursor.y = Math.max(0, cursor.y - 1); return; }
            if (name === 'down') { cursor.y = Math.min(GW - 1, cursor.y + 1); return; }
            if (name === 'action') { warpTo(cursor.x, cursor.y); }
            return;
          }

          if (mode === 'move') {
            if (name === 'left') { impulse(-1, 0); return; }
            if (name === 'right') { impulse(1, 0); return; }
            if (name === 'up') { impulse(0, -1); return; }
            if (name === 'down') { impulse(0, 1); return; }
            if (name === 'action') { mode = 'menu'; }
            return;
          }

          if (mode === 'phaser') {
            if (name === 'up') { amount = Math.min(energy, amount + 100); return; }
            if (name === 'down') { amount = Math.max(0, amount - 100); return; }
            if (name === 'right') { amount = Math.min(energy, amount + 500); return; }
            if (name === 'left') { amount = Math.max(0, amount - 500); return; }
            if (name === 'action') { firePhasers(amount); }
            return;
          }

          if (mode === 'torpedo') {
            if (name === 'left' || name === 'up') { aim = (aim + DIR8.length - 1) % DIR8.length; return; }
            if (name === 'right' || name === 'down') { aim = (aim + 1) % DIR8.length; return; }
            if (name === 'action') { fireTorpedo(aim); }
            return;
          }

          if (mode === 'shields') {
            if (name === 'up') { amount = Math.min(energy, amount + 100); return; }
            if (name === 'down') { amount = Math.max(-shields, amount - 100); return; }
            if (name === 'action') { transfer(amount); }
          }
        },

        draw: function (term) {
          term.clear();

          term.text(1, 0, 'STAR TREK', 'green');
          term.text(13, 0, 'stardate ' + stardate.toFixed(1) + ' / ' + endDate.toFixed(1) +
                    '   klingons ' + totalK + '   score ' + g.score, 'dim');
          term.text(1, 1, 'energy ' + energy + '    shields ' + shields + '    torpedoes ' + torps +
                    '    ' + (docked ? 'DOCKED' : 'quadrant ' + quadLabel()), docked ? 'cyan' : 'dim');

          drawSector(term);
          drawChart(term);

          term.box(1, 13, 69, 7, 'dim');
          term.text(3, 13, ' LOG ', 'green');
          for (var i = 0; i < log.length; i++) {
            term.text(3, 14 + i, log[i].s, log[i].c);
          }

          drawOrders(term);
          term.text(1, 21, prompt(), mode === 'menu' ? 'dim' : 'yellow');
          term.text(1, 22, hint(), 'dark');
          term.text(1, 23, 'chart cell = klingons, starbases, stars    ... = not yet scanned', 'dark');
        }
      };
    }
  });
})();

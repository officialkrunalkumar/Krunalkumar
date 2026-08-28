/* ==========================================================================
   wumpus.js — Hunt the Wumpus (Gregory Yob, 1973).
   --------------------------------------------------------------------------
   Twenty rooms arranged as a dodecahedron: every room has exactly three
   tunnels, and the map is the SAME map the original used. That layout is the
   whole game — it is regular enough to reason about and irregular enough
   that you cannot picture it, so you deduce instead of navigating.

   You never see the cave. You get warnings from adjacent rooms, and from
   those you work out where the wumpus is, then shoot a crooked arrow through
   up to five rooms. Guess wrong often enough and you run out of arrows.

   Deduction, not reflexes — so there is no clock and no update loop.
   ========================================================================== */

(function () {
  'use strict';

  /* The canonical 1973 cave. Room n connects to CAVE[n]. */
  var CAVE = [
    [1, 4, 7], [0, 2, 9], [1, 3, 11], [2, 4, 13], [0, 3, 5],
    [4, 6, 14], [5, 7, 16], [0, 6, 8], [7, 9, 17], [1, 8, 10],
    [9, 11, 18], [2, 10, 12], [11, 13, 19], [3, 12, 14], [5, 13, 15],
    [14, 16, 19], [6, 15, 17], [8, 16, 18], [10, 17, 19], [12, 15, 18]
  ];

  TermShell.define({
    id: 'game-wumpus',
    slug: 'wumpus',
    title: 'Hunt the Wumpus',
    cols: 64,
    rows: 24,
    bestKey: 'wumpus',
    startTitle: 'Hunt the Wumpus',
    startText: 'Twenty rooms, three tunnels each. Read the warnings, work out where it sleeps, then shoot.',

    setup: function (g, t) {
      var you = 0;
      var wumpus = 0;
      var pits = [];
      var bats = [];
      var arrows = 5;
      var log = [];
      var mode = 'move';        // move | shoot
      var shotPath = [];
      var pick = 0;             // which of the three tunnels is highlighted

      var shootBtn = document.getElementById('game-shoot');
      if (shootBtn) shootBtn.addEventListener('click', toggleMode);

      function say(line, tint) {
        log.push({ s: line, c: tint || 'green' });
        while (log.length > 9) log.shift();
      }

      function place() {
        var free = [];
        for (var i = 1; i < 20; i++) free.push(i);      // room 0 is always yours
        for (var s = free.length - 1; s > 0; s--) {
          var j = Math.floor(Math.random() * (s + 1));
          var tmp = free[s]; free[s] = free[j]; free[j] = tmp;
        }
        wumpus = free.pop();
        pits = [free.pop(), free.pop()];
        bats = [free.pop(), free.pop()];
      }

      function near(room, what) {
        var links = CAVE[room];
        for (var i = 0; i < links.length; i++) {
          if (what.indexOf ? what.indexOf(links[i]) !== -1 : links[i] === what) return true;
        }
        return false;
      }

      function warn() {
        if (near(you, [wumpus])) say('You smell something terrible.', 'red');
        if (near(you, pits)) say('You feel a draught.', 'cyan');
        if (near(you, bats)) say('You hear wings flapping.', 'magenta');
      }

      function enter(room, byBat) {
        you = room;
        if (you === wumpus) {
          say('The wumpus is here. It eats you.', 'red');
          g.over({ score: g.score, message: 'Eaten in room ' + (you + 1) + '.' });
          return;
        }
        if (pits.indexOf(you) !== -1) {
          say('You fall into a bottomless pit.', 'red');
          g.over({ score: g.score, message: 'Fell into the pit in room ' + (you + 1) + '.' });
          return;
        }
        if (bats.indexOf(you) !== -1 && !byBat) {
          say('Giant bats carry you off somewhere else.', 'magenta');
          enter(Math.floor(Math.random() * 20), true);
          return;
        }
        g.addScore(5);
        warn();
      }

      function toggleMode() {
        if (g.state !== 'playing') return;
        mode = mode === 'move' ? 'shoot' : 'move';
        shotPath = [];
        pick = 0;
        say(mode === 'shoot' ? 'Arrow ready — pick a tunnel to send it down.' : 'Walking again.', 'yellow');
        if (shootBtn) shootBtn.textContent = mode === 'shoot' ? 'Cancel arrow' : 'Shoot an arrow';
      }

      /* A crooked arrow flies through up to five rooms, following the tunnel
         you chose and then wandering. Hitting yourself is possible, which is
         the original's cruellest and best rule. */
      function shoot(first) {
        arrows--;
        g.stat('arrows', arrows);
        var at = first;
        for (var step = 0; step < 5; step++) {
          if (at === wumpus) {
            say('Your arrow finds the wumpus. You win.', 'yellow');
            g.over({ won: true, score: g.score + 100, title: 'Wumpus down', message: 'Killed with ' + arrows + ' arrows left.' });
            return;
          }
          if (at === you) {
            say('Your own arrow comes back and hits you.', 'red');
            g.over({ score: g.score, message: 'Shot by your own arrow.' });
            return;
          }
          at = CAVE[at][Math.floor(Math.random() * 3)];
        }
        say('The arrow clatters away into the dark.', 'dim');

        /* A miss wakes it, and a woken wumpus moves. */
        if (Math.random() < 0.75) {
          wumpus = CAVE[wumpus][Math.floor(Math.random() * 3)];
          if (wumpus === you) {
            say('The noise wakes it — and it finds you.', 'red');
            g.over({ score: g.score, message: 'The wumpus woke and found you.' });
            return;
          }
        }
        if (arrows <= 0) {
          say('That was your last arrow.', 'red');
          g.over({ score: g.score, message: 'Out of arrows, and it is still down there.' });
          return;
        }
        mode = 'move';
        if (shootBtn) shootBtn.textContent = 'Shoot an arrow';
        warn();
      }

      return {
        reset: function () {
          you = 0;
          arrows = 5;
          log = [];
          mode = 'move';
          pick = 0;
          if (shootBtn) shootBtn.textContent = 'Shoot an arrow';
          place();
          g.stat('arrows', arrows);
          g.stat('room', 1);
          say('You are in the cave. Three tunnels lead out of every room.', 'dim');
          warn();
        },

        key: function (name) {
          if (g.state !== 'playing') return;
          if (name === 'left') { pick = (pick + 2) % 3; return; }
          if (name === 'right') { pick = (pick + 1) % 3; return; }
          if (name === 'up') { toggleMode(); return; }
          if (name === 'action' || name === 'down') {
            var target = CAVE[you][pick];
            if (mode === 'shoot') { shoot(target); }
            else { enter(target, false); }
            if (g.state === 'playing') g.stat('room', you + 1);
          }
        },

        draw: function (term) {
          term.clear();
          term.text(1, 0, 'HUNT THE WUMPUS', 'green');
          term.text(20, 0, 'room ' + (you + 1) + '   arrows ' + arrows + '   score ' + g.score, 'dim');

          term.box(1, 2, 62, 12, 'dim');
          for (var i = 0; i < log.length; i++) {
            term.text(3, 3 + i, log[i].s, log[i].c);
          }

          var links = CAVE[you];
          term.text(3, 16, 'Tunnels from room ' + (you + 1) + ':', 'dim');
          for (var k = 0; k < 3; k++) {
            var label = 'room ' + (links[k] + 1);
            var x = 3 + k * 16;
            term.text(x, 18, (k === pick ? '> ' : '  ') + label, k === pick ? 'white' : 'dim');
          }

          term.text(3, 20, mode === 'shoot' ? 'ARROW READY — enter sends it down the marked tunnel' : 'Walking — enter moves you',
                    mode === 'shoot' ? 'yellow' : 'dim');
          term.text(3, 22, '← → choose tunnel     ↑ toggle arrow     enter / space go', 'dim');
        }
      };
    }
  });
})();

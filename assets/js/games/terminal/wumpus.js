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

   THE SOUND IS THE WARNINGS, and that is not decoration here the way it is
   in most of this section. This game deliberately shows you nothing: the
   entire input is three sentences about what is next door, and every one of
   them is a sensation rather than a fact — a smell, a draught, wings. Those
   are sounds that were being printed as text because 1973 had no other
   channel. So each hazard gets a voice it does not share with anything
   else: a low growl for the wumpus, a long soft draught for a pit, four
   short beats for the bats. A player who learns the three can read a room
   without reading the log at all, which is the closest this can get to the
   game it was always describing.

   They are STAGGERED rather than played together. All three can be true at
   once, and three noise bursts inside the same twentieth of a second is one
   muddy noise from which nothing can be told apart — which would be worse
   than silence, because it looks like information and is not. The growl
   goes first every time: it is the one you would act on.

   There is no bed. A cave you cross one deliberate room at a time has no
   continuous condition to hold, and a drone under a game with no clock
   would only be there to prove the sound is working.
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

      /* ---------------------------------------------------------------
         The voices. See the header for why the warnings carry them.
         --------------------------------------------------------------- */

      function after(ms, fn) { setTimeout(fn, ms); }

      /* The wumpus: low, slow and lowpassed down to almost nothing by the
         end, which is what makes it read as something large in the dark
         rather than as a bass note. It is the loudest thing in the file on
         purpose — it is the only warning that means you may be about to
         lose the run on your next keypress. */
      function growl() {
        g.noise(0.5, { type: 'lowpass', freq: 190, to: 70, q: 1.6, level: 0.055 });
      }

      /* A pit: air moving somewhere you cannot see. Longer and quieter than
         the growl, and it barely moves — a draught you can hear clearly is
         a wind, and a wind is a way out rather than a hole. */
      function draught() {
        g.noise(0.85, { type: 'lowpass', freq: 330, to: 160, q: 0.6, level: 0.028 });
      }

      /* Bats: four beats rather than one sound, because a wingbeat is a
         rhythm and nothing else in this cave has one. The pitch climbs a
         little across the four so it reads as something approaching. */
      function wings(level) {
        for (var i = 0; i < 4; i++) {
          (function (n) {
            after(n * 85, function () {
              g.noise(0.05, {
                type: 'bandpass',
                freq: 880 + n * 95,
                to: 420,
                q: 2.4,
                level: level == null ? 0.032 : level
              });
            });
          })(i);
        }
      }

      /* One room crossed. Deliberately dull and dry: it happens more often
         than anything else here, and a footstep with any character to it
         would start competing with the three warnings that follow it. */
      function footstep() {
        g.noise(0.07, { type: 'lowpass', freq: 420, to: 180, q: 0.9, level: 0.03 });
      }

      /* Warnings are queued rather than played together — see the header.
         Four hundred milliseconds apart is enough to hear three of them as
         three, and short enough that the last one still lands before a
         player has decided which tunnel to take. */
      function heard(slot, voice) {
        if (!slot) voice();
        else after(slot * 420, voice);
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
        /* The growl claims slot zero whenever it is here at all, so the
           most urgent warning is never the one waiting behind two others. */
        var slot = 0;
        if (near(you, [wumpus])) { say('You smell something terrible.', 'red'); heard(slot++, growl); }
        if (near(you, pits)) { say('You feel a draught.', 'cyan'); heard(slot++, draught); }
        if (near(you, bats)) { say('You hear wings flapping.', 'magenta'); heard(slot++, wings); }
      }

      function enter(room, byBat) {
        you = room;
        if (you === wumpus) {
          say('The wumpus is here. It eats you.', 'red');
          /* The growl, but close and cut short rather than distant and
             fading. Same instrument as the warning so it is recognisably
             the thing that was being warned about. */
          g.noise(0.3, { type: 'lowpass', freq: 240, to: 60, q: 2.2, level: 0.07 });
          g.over({ score: g.score, message: 'Eaten in room ' + (you + 1) + '.' });
          return;
        }
        if (pits.indexOf(you) !== -1) {
          say('You fall into a bottomless pit.', 'red');
          /* A fall, which is a filter falling rather than a pitch falling —
             the shell's own game-over sweep is a note going down, and two
             falling notes on top of each other cancel each other out. */
          g.noise(0.7, { type: 'bandpass', freq: 1300, to: 120, q: 1.2, level: 0.05 });
          g.over({ score: g.score, message: 'Fell into the pit in room ' + (you + 1) + '.' });
          return;
        }
        if (bats.indexOf(you) !== -1 && !byBat) {
          say('Giant bats carry you off somewhere else.', 'magenta');
          /* Louder than the warning version, because this time they have
             got you rather than being somewhere next door. */
          wings(0.05);
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
        /* Up to arm, down to stand down. Which way the pair moves is the
           whole message, so a player who has stopped reading the bottom
           line still knows which mode they just put themselves in. */
        if (mode === 'shoot') { g.beep(520, 0.04, 'square', 0.03); after(60, function () { g.beep(780, 0.05, 'square', 0.03); }); }
        else { g.beep(700, 0.04, 'square', 0.025); after(60, function () { g.beep(460, 0.05, 'square', 0.025); }); }
        if (shootBtn) shootBtn.textContent = mode === 'shoot' ? 'Cancel arrow' : 'Shoot an arrow';
      }

      /* A crooked arrow flies through up to five rooms, following the tunnel
         you chose and then wandering. Hitting yourself is possible, which is
         the original's cruellest and best rule. */
      function shoot(first) {
        arrows--;
        g.stat('arrows', arrows);
        /* The loose. A filter opening upward is something leaving fast;
           run the same burst the other way and it arrives instead. */
        g.noise(0.22, { type: 'bandpass', freq: 260, to: 2400, q: 1.1, level: 0.045 });
        var at = first;
        for (var step = 0; step < 5; step++) {
          if (at === wumpus) {
            say('Your arrow finds the wumpus. You win.', 'yellow');
            /* The impact lands before the shell's victory sweep, so the hit
               and the verdict are two events rather than one noise. */
            g.noise(0.12, { type: 'lowpass', freq: 700, to: 160, q: 1.4, level: 0.06 });
            g.over({ won: true, score: g.score + 100, title: 'Wumpus down', message: 'Killed with ' + arrows + ' arrows left.' });
            return;
          }
          if (at === you) {
            say('Your own arrow comes back and hits you.', 'red');
            /* Short, hard and high — the cave's cruellest rule deserves to
               sound like a mistake rather than like a monster. */
            g.noise(0.09, { type: 'bandpass', freq: 1800, to: 500, q: 3, level: 0.06 });
            g.over({ score: g.score, message: 'Shot by your own arrow.' });
            return;
          }
          at = CAVE[at][Math.floor(Math.random() * 3)];
        }
        say('The arrow clatters away into the dark.', 'dim');
        /* Three thin scatters, thinning as they go: an arrow bouncing off
           rock somewhere you cannot see. */
        for (var c = 0; c < 3; c++) {
          (function (n) {
            after(120 + n * 110, function () {
              g.noise(0.04, { type: 'bandpass', freq: 2200 - n * 400, q: 5, level: 0.026 - n * 0.006 });
            });
          })(c);
        }

        /* A miss wakes it, and a woken wumpus moves. */
        if (Math.random() < 0.75) {
          wumpus = CAVE[wumpus][Math.floor(Math.random() * 3)];
          /* It moved, and you are told so whether or not it found you. A
             low roll under the clatter that has just finished: the map you
             were building in your head is now one room out of date, and
             that is worth hearing. */
          after(420, function () {
            g.noise(0.4, { type: 'lowpass', freq: 150, to: 80, q: 1.2, level: 0.03 });
          });
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
          /* Moving the marker between the three tunnels. Very quiet, and
             gated because a held arrow key repeats far faster than anyone
             needs to hear about. */
          if (name === 'left' || name === 'right') {
            pick = name === 'left' ? (pick + 2) % 3 : (pick + 1) % 3;
            if (g.gate('pick', 0.05)) g.beep(880, 0.02, 'square', 0.016);
            return;
          }
          if (name === 'up') { toggleMode(); return; }
          if (name === 'action' || name === 'down') {
            var target = CAVE[you][pick];
            if (mode === 'shoot') { shoot(target); }
            else { footstep(); enter(target, false); }
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

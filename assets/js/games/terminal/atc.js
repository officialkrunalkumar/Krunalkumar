/* ==========================================================================
   atc.js — Air Traffic Controller, after the BSD game.
   --------------------------------------------------------------------------
   Aircraft appear at the edge of the scope or sit waiting at an airport. Each
   one has a heading, an altitude and somewhere it has to be: out through a
   numbered exit at altitude nine, or down on an airport runway pointing the
   right way. Two of them within a cell of each other at the same altitude and
   the shift is over.

   Two decisions here are not obvious and both come from the same constraint —
   this shell binds four arrows and one Action, and nothing else:

   1. LEFT AND RIGHT TURN, THEY DO NOT STEER. A heading is state the aircraft
      keeps, so left and right rotate it 45 degrees and up and down move the
      commanded altitude. Spending the arrows on compass points instead would
      leave no key for altitude, and altitude is half the game. It also
      happens to be how the real instruction sounds: turn left, climb.

   2. A TAP ON THE RADAR AND THE ACTION BUTTON ARRIVE AS THE SAME COMMAND.
      The shell fires 'action' for both, and passes the event through. So the
      event is inspected: a press whose target sits inside the stage is a
      finger on the scope and selects the nearest blip, anything else is a
      keyboard or the pad and cycles to the next aircraft. One command, two
      sensible meanings, and no second button to explain.

   The collision test runs after every aircraft has moved, never during. Test
   inside the movement loop and whoever is early in the array is judged
   against positions the rest have not taken yet, which makes the same two
   aircraft crash or not depending on the order they happened to arrive in.
   ========================================================================== */

(function () {
  'use strict';

  var RW = 20;              // radar cells across
  var RH = 18;              // and down
  var OX = 2;               // term column of radar cell 0
  var OY = 2;               // term row of radar cell 0
  var PX = 45;              // first text column inside the flight-strip panel
  var LIMIT = 180;          // seconds in a shift
  var MAXP = 6;             // aircraft allowed on the scope at once

  /* Cells are two term columns wide, because term-shell.js draws an 8x16
     character and two of them side by side is the only way to get a square
     radar cell — and a radar with rectangular cells lies about distance. The
     second column is not wasted: it carries the altitude digit. */
  var CELLW = 2;

  var DX = [0, 1, 1, 1, 0, -1, -1, -1];
  var DY = [-1, -1, 0, 1, 1, 1, 0, -1];
  var ARROW = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  /* Eight exits on the border, each with the heading that leads out of it.
     An arriving aircraft enters on the reverse of that heading. */
  var EXITS = [
    { x: 4, y: 0, d: 0 },
    { x: 14, y: 0, d: 0 },
    { x: 19, y: 4, d: 2 },
    { x: 19, y: 13, d: 2 },
    { x: 14, y: 17, d: 4 },
    { x: 4, y: 17, d: 4 },
    { x: 0, y: 13, d: 6 },
    { x: 0, y: 4, d: 6 }
  ];

  /* Two airports, each with one runway. The d field is the heading an
     aircraft must be flying to land on it, and the heading it departs on. */
  var AIRPORTS = [
    { x: 7, y: 6, d: 2 },
    { x: 13, y: 11, d: 6 }
  ];

  var LEVELS = {
    '1': { tick: 2.2, gap: 7 },
    '2': { tick: 1.6, gap: 6 },
    '3': { tick: 1.2, gap: 5 }
  };

  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var RULE = '';
  (function () {
    for (var i = 0; i < 20; i++) RULE += '─';
  })();

  TermShell.define({
    id: 'game-atc',
    slug: 'atc',
    title: 'ATC',
    cols: 66,
    rows: 24,
    bestKey: 'atc',
    startTitle: 'Air traffic control',
    startText: 'Arrows turn the aircraft in white and change its altitude. Action picks the next one. Three minutes on the clock.',

    setup: function (g, t) {
      var planes = [];
      var selId = null;
      var clock = LIMIT;
      var shownSec = -1;
      var acc = 0;
      var since = 0;
      var nextLetter = 0;
      var safe = 0;
      var msg = '';
      var tint = 'dim';
      var level = LEVELS['1'];

      /* Read live rather than cached, so a player who finds level one dull
         gets busier traffic on the next arrival and not the next game. */
      var levelSel = document.getElementById('game-level');
      if (levelSel) {
        level = LEVELS[levelSel.value] || LEVELS['1'];
        levelSel.addEventListener('change', function () {
          level = LEVELS[levelSel.value] || LEVELS['1'];
        });
      }

      function say(s, colour) { msg = s; tint = colour || 'green'; }

      function clockText() {
        var s = Math.max(0, Math.ceil(clock));
        var m = Math.floor(s / 60);
        var r = s % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
      }

      function find(id) {
        for (var i = 0; i < planes.length; i++) {
          if (planes[i].id === id) return planes[i];
        }
        return null;
      }

      function inside(x, y) { return x >= 0 && x < RW && y >= 0 && y < RH; }

      function destLabel(p) {
        return p.destType === 'exit'
          ? 'exit ' + p.dest + ' at altitude 9'
          : 'airport ' + p.dest + ' heading ' + COMPASS[AIRPORTS[p.dest].d];
      }

      function shortDest(p) {
        return (p.destType === 'exit' ? 'exit ' : 'apt ') + p.dest;
      }

      /* Letters are reused once an aircraft is off the scope, but never while
         one is still wearing it — three minutes at level three is more than
         twenty-six arrivals. */
      function freeLetter() {
        for (var n = 0; n < 26; n++) {
          var ch = LETTERS.charAt((nextLetter + n) % 26);
          if (!find(ch)) { nextLetter = (nextLetter + n + 1) % 26; return ch; }
        }
        return '?';
      }

      function crowded(x, y, alt) {
        for (var i = 0; i < planes.length; i++) {
          var p = planes[i];
          if (Math.abs(p.alt - alt) > 1) continue;
          if (Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2) return true;
        }
        return false;
      }

      function airportFree(n) {
        for (var i = 0; i < planes.length; i++) {
          if (planes[i].x === AIRPORTS[n].x && planes[i].y === AIRPORTS[n].y) return false;
        }
        return true;
      }

      function spawn() {
        if (planes.length >= MAXP) return false;
        var p = null;
        var i;

        /* A third of arrivals are departures waiting on a runway. They cost
           nothing until you clear them to climb, which is what makes them a
           choice rather than another emergency. */
        if (Math.random() < 0.35) {
          var order = Math.random() < 0.5 ? [0, 1] : [1, 0];
          for (i = 0; i < order.length && !p; i++) {
            if (airportFree(order[i])) {
              p = {
                x: AIRPORTS[order[i]].x, y: AIRPORTS[order[i]].y,
                dir: AIRPORTS[order[i]].d, alt: 0, tgt: 0,
                ground: true, entry: -1
              };
            }
          }
        }

        if (!p) {
          var tries = 0;
          while (tries < 12 && !p) {
            tries++;
            var e = Math.floor(Math.random() * EXITS.length);
            if (crowded(EXITS[e].x, EXITS[e].y, 7)) continue;
            p = {
              x: EXITS[e].x, y: EXITS[e].y,
              dir: (EXITS[e].d + 4) % 8, alt: 7, tgt: 7,
              ground: false, entry: e
            };
          }
          if (!p) return false;
        }

        p.id = freeLetter();
        if (p.ground || Math.random() >= 0.4) {
          p.destType = 'exit';
          do {
            p.dest = Math.floor(Math.random() * EXITS.length);
          } while (p.dest === p.entry);
        } else {
          p.destType = 'apt';
          p.dest = Math.floor(Math.random() * AIRPORTS.length);
        }

        planes.push(p);
        if (!selId) selId = p.id;
        g.stat('planes', planes.length);
        if (g.state === 'playing') {
          say(p.id + ' on the scope, ' + destLabel(p) + '.', 'cyan');
          g.beep(520, 0.05, 'sine', 0.04);
        }
        return true;
      }

      function drop(p, i) {
        planes.splice(i, 1);
        g.stat('planes', planes.length);
        if (selId === p.id) selId = planes.length ? planes[0].id : null;
      }

      function lose(title, message) {
        g.over({ score: g.score, title: title, message: message });
      }

      /* One radar sweep. Altitude changes by one level, then the aircraft
         moves one cell along its heading — in that order, so an aircraft
         cleared to climb off a runway is already airborne over the next
         cell rather than dragging its wheels through it. */
      function tick() {
        var i, p, a, ex;

        for (i = planes.length - 1; i >= 0; i--) {
          p = planes[i];

          if (p.ground) {
            if (p.tgt <= 0) continue;         // still holding for clearance
            p.ground = false;
            p.alt = 1;
          } else if (p.tgt > p.alt) {
            p.alt++;
          } else if (p.tgt < p.alt) {
            p.alt--;
          }

          p.x += DX[p.dir];
          p.y += DY[p.dir];

          if (!inside(p.x, p.y)) {
            lose('Off the scope', p.id + ' left the radar without clearance, bound for ' + shortDest(p) + '.');
            return;
          }

          if (p.alt === 0) {
            a = p.destType === 'apt' ? AIRPORTS[p.dest] : null;
            if (a && p.x === a.x && p.y === a.y && p.dir === a.d) {
              drop(p, i);
              safe++;
              g.addScore(15);
              say(p.id + ' down at airport ' + p.dest + '.', 'green');
              g.beep(700, 0.07, 'sine', 0.05);
              g.beep(1040, 0.09, 'sine', 0.05);
              continue;
            }
            lose('Into the ground', p.id + ' reached altitude zero away from a runway.');
            return;
          }

          if (p.destType === 'exit' && p.alt === 9) {
            ex = EXITS[p.dest];
            if (p.x === ex.x && p.y === ex.y) {
              drop(p, i);
              safe++;
              g.addScore(10);
              say(p.id + ' away through exit ' + p.dest + '.', 'green');
              g.beep(880, 0.07, 'sine', 0.05);
              continue;
            }
          }
        }

        /* Separation, judged only once everybody has moved. */
        for (i = 0; i < planes.length; i++) {
          for (var j = i + 1; j < planes.length; j++) {
            var u = planes[i], v = planes[j];
            if (u.ground || v.ground || u.alt !== v.alt) continue;
            if (Math.abs(u.x - v.x) <= 1 && Math.abs(u.y - v.y) <= 1) {
              lose('Mid-air collision', u.id + ' and ' + v.id + ' met at altitude ' + u.alt + '.');
              return;
            }
          }
        }

        since++;
        if (since >= level.gap && spawn()) since = 0;
      }

      /* ---------------------------------------------------------------
         Selection. See decision 2 in the header.
         --------------------------------------------------------------- */
      function tapCell(event) {
        if (!event || event.clientX == null || !g.canvas) return null;
        var target = event.target;
        if (!target || !target.closest || !target.closest('.game-stage')) return null;
        /* Logical units back to radar cells. The 8 and the 16 are the
           character cell size term-shell.js draws with; it is fixed. */
        var pt = g.pointAt(event);
        var cx = (pt.x / 8 - OX) / CELLW;
        var cy = pt.y / 16 - OY;
        if (cx < -2 || cx > RW + 2 || cy < -2 || cy > RH + 2) return null;
        return { x: cx, y: cy };
      }

      function cycle() {
        if (!planes.length) { selId = null; say('Nothing on the scope.', 'dim'); return; }
        var at = -1;
        for (var i = 0; i < planes.length; i++) {
          if (planes[i].id === selId) { at = i; break; }
        }
        var p = planes[(at + 1) % planes.length];
        selId = p.id;
        say(p.id + ' selected — ' + destLabel(p) + '.', 'white');
        g.beep(660, 0.03, 'sine', 0.035);
      }

      function choose(event) {
        var tap = tapCell(event);
        if (!tap || !planes.length) { cycle(); return; }
        var best = null;
        var bestD = 1e9;
        for (var i = 0; i < planes.length; i++) {
          var d = Math.abs(planes[i].x - tap.x) + Math.abs(planes[i].y - tap.y);
          if (d < bestD) { bestD = d; best = planes[i]; }
        }
        selId = best.id;
        say(best.id + ' selected — ' + destLabel(best) + '.', 'white');
        g.beep(660, 0.03, 'sine', 0.035);
      }

      /* ---------------------------------------------------------------
         Drawing
         --------------------------------------------------------------- */
      function warnings() {
        var flag = {};
        for (var i = 0; i < planes.length; i++) {
          for (var j = i + 1; j < planes.length; j++) {
            var u = planes[i], v = planes[j];
            if (u.ground || v.ground) continue;
            if (Math.abs(u.alt - v.alt) > 1) continue;
            if (Math.abs(u.x - v.x) <= 2 && Math.abs(u.y - v.y) <= 2) {
              flag[u.id] = 1;
              flag[v.id] = 1;
            }
          }
        }
        return flag;
      }

      function strip(p, sel) {
        var s = (sel ? '>' : ' ') + p.id + ' ' + p.alt;
        s += p.tgt === p.alt ? '  ' : '→' + p.tgt;
        s += ' ' + ARROW[p.dir] + ' ' + shortDest(p);
        if (p.ground) s += ' hold';
        return s;
      }

      function draw(term) {
        var i, p, e, a, cx, cy, colour;
        term.clear();

        term.text(1, 0, 'ATC', 'green');
        term.text(5, 0, 'approach radar', 'dim');
        term.text(44, 0, 'time ' + clockText() + '   handled ' + safe, 'white');

        term.box(1, 1, 42, 20, 'dim');
        term.box(44, 1, 22, 20, 'dim');

        for (cy = 0; cy < RH; cy++) {
          for (cx = 0; cx < RW; cx++) {
            term.put(OX + cx * CELLW, OY + cy, '·', 'dark');
          }
        }

        var sel = find(selId);

        for (i = 0; i < EXITS.length; i++) {
          e = EXITS[i];
          colour = (sel && sel.destType === 'exit' && sel.dest === i) ? 'white' : 'cyan';
          term.put(OX + e.x * CELLW, OY + e.y, String(i), colour);
          term.put(OX + e.x * CELLW + 1, OY + e.y, ARROW[e.d], 'dim');
        }

        for (i = 0; i < AIRPORTS.length; i++) {
          a = AIRPORTS[i];
          colour = (sel && sel.destType === 'apt' && sel.dest === i) ? 'white' : 'yellow';
          term.put(OX + a.x * CELLW, OY + a.y, String(i), colour);
          term.put(OX + a.x * CELLW + 1, OY + a.y, ARROW[a.d], colour);
        }

        var flag = warnings();

        for (i = 0; i < planes.length; i++) {
          p = planes[i];
          colour = p.id === selId ? 'white'
                 : flag[p.id] ? 'red'
                 : p.ground ? 'yellow' : 'green';
          /* The only aircraft ever off the grid is the one that has just
             been lost over the edge, and the frame the player is left
             looking at should still say where. Clamped to the border cell
             rather than drawn at its real position, which would land on the
             box and read as a broken frame. */
          cx = Math.max(0, Math.min(RW - 1, p.x));
          cy = Math.max(0, Math.min(RH - 1, p.y));
          term.put(OX + cx * CELLW, OY + cy, p.id, colour);
          term.put(OX + cx * CELLW + 1, OY + cy, String(p.alt),
                   p.alt === p.tgt ? colour : 'orange');
        }

        /* The flight strips. Everything the aircraft will not tell you from
           its blip alone: what it has been told to do, and where it is
           supposed to end up. */
        term.text(PX, 2, ' ID ALT HDG DEST', 'dim');
        term.text(PX, 3, RULE, 'dim');
        for (i = 0; i < planes.length && i < MAXP; i++) {
          p = planes[i];
          colour = p.id === selId ? 'white' : flag[p.id] ? 'red' : p.ground ? 'yellow' : 'green';
          term.text(PX, 4 + i, strip(p, p.id === selId), colour);
        }

        term.text(PX, 11, 'AIRPORTS', 'yellow');
        for (i = 0; i < AIRPORTS.length; i++) {
          term.text(PX, 12 + i, i + ' ' + ARROW[AIRPORTS[i].d] + ' runway ' + COMPASS[AIRPORTS[i].d], 'dim');
        }
        term.text(PX, 15, 'EXITS 0-7, edge', 'cyan');
        term.text(PX, 16, 'out at altitude 9', 'dim');
        term.text(PX, 17, 'land at 0, on the', 'dim');
        term.text(PX, 18, 'runway heading', 'dim');

        if (sel) {
          term.text(1, 21, 'SEL ' + sel.id + '  alt ' + sel.alt + '→' + sel.tgt +
                            '  hdg ' + COMPASS[sel.dir] + '  for ' + destLabel(sel), 'white');
        } else {
          term.text(1, 21, 'No aircraft selected.', 'dim');
        }
        term.text(1, 22, '←→ turn 45°  ↑↓ altitude  Action or tap: next aircraft', 'dim');
        term.text(1, 23, msg, tint);
      }

      return {
        reset: function () {
          planes = [];
          selId = null;
          clock = LIMIT;
          shownSec = -1;
          acc = 0;
          since = 0;
          nextLetter = 0;
          safe = 0;
          if (levelSel) level = LEVELS[levelSel.value] || LEVELS['1'];
          g.stat('planes', 0);
          g.stat('time', clockText());
          spawn();
          spawn();
          say('Two inbound. Arrows command the aircraft in white.', 'dim');
        },

        key: function (name, event) {
          if (g.state !== 'playing') return;

          if (name === 'action') { choose(event); return; }

          var p = find(selId);
          if (!p) { say('Nothing on the scope to command.', 'dim'); return; }

          if (name === 'left' || name === 'right') {
            if (p.ground) {
              say(p.id + ' is on the runway — clear it to climb first.', 'yellow');
              g.beep(160, 0.05, 'square', 0.03);
              return;
            }
            p.dir = name === 'left' ? (p.dir + 7) % 8 : (p.dir + 1) % 8;
            say(p.id + ' turning ' + COMPASS[p.dir] + '.', 'white');
            g.beep(420, 0.03, 'sine', 0.035);
            return;
          }

          var want = p.tgt + (name === 'up' ? 1 : -1);
          if (want < 0 || want > 9) { g.beep(160, 0.05, 'square', 0.03); return; }
          p.tgt = want;
          say(p.id + (want > p.alt ? ' climbing to ' : want < p.alt ? ' descending to ' : ' levelling at ') +
              want + '.', 'white');
          g.beep(500 + want * 25, 0.03, 'sine', 0.035);
        },

        update: function (dt) {
          clock -= dt;
          if (clock <= 0) {
            clock = 0;
            g.stat('time', '0:00');
            g.over({
              won: true, score: g.score, title: 'Shift over',
              message: safe + (safe === 1 ? ' aircraft' : ' aircraft') + ' handled, none of them lost.'
            });
            return;
          }

          /* The HUD is only written when the displayed second changes —
             update() runs at 120 Hz and a clock does not. */
          var secs = Math.ceil(clock);
          if (secs !== shownSec) { shownSec = secs; g.stat('time', clockText()); }

          acc += dt;
          while (acc >= level.tick) {
            acc -= level.tick;
            tick();
            if (g.state !== 'playing') return;
          }
        },

        draw: draw
      };
    }
  });
})();

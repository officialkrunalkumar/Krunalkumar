/* ==========================================================================
   cbonsai.js — grow a bonsai in a terminal.
   --------------------------------------------------------------------------
   A recursive branch: step upward a few cells, lean a little, and sometimes
   split. Each branch carries a "life" that drains as it grows, and a branch
   whose life runs out becomes leaves. That single counter produces the whole
   shape — thick near the base because the trunk still has life left, sparse
   and leafy at the tips because the children inherited less.

   THE TREE IS SEEDED, so the same seed always grows the same tree. Without
   that you can never show anyone the one you liked, and "grow another" is
   the only interaction this has.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 72;
  var ROWS = 26;
  var BASE_Y = ROWS - 4;

  var LEAVES = ['&', '*', '~', '^'];

  TermShell.define({
    id: 'game-cbonsai',
    slug: 'cbonsai',
    title: 'cbonsai',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    /* Taps are ON: the page copy promises "tap the tree" grows another,
       and the key hook below already maps 'action' to plant(). This was
       tapAction: false, which made that promise a lie — the shell's tap
       detector already rejects swipes and long presses, so a stray scroll
       cannot plant one by accident. */

    setup: function (g, t) {
      var cells = [];             // { ch, tint } or null
      var seed = 1;
      var rng = Math.random;
      var pending = [];           // branches still to grow, for the animation
      var acc = 0;
      var growing = false;
      var live = true;

      var liveBtn = document.getElementById('game-live');
      var growBtn = document.getElementById('game-grow');
      if (growBtn) growBtn.addEventListener('click', function () { plant(); });

      /* The pressed state and the title are the only visible account of which
         way the next tree will grow, so both are written from `live` in one
         place rather than at each site that moves it. That matters because
         reset() puts slow growth back for a fresh run: with the button left
         untouched there, a restart could leave it still reading "Instant"
         over a flag that had gone back to true, and the visitor's next click
         then flipped `live` to false and wrote aria-pressed "false" over a
         "false" that was already there — a toggle that had plainly done
         nothing, on the one press where somebody was watching it. */
      function syncLive() {
        if (!liveBtn) return;
        liveBtn.setAttribute('aria-pressed', String(live));
        liveBtn.title = live ? 'Growing slowly' : 'Instant';
      }

      if (liveBtn) {
        liveBtn.addEventListener('click', function () {
          live = !live;
          syncLive();
        });
      }

      function mulberry(a) {
        return function () {
          a |= 0; a = (a + 0x6D2B79F5) | 0;
          var x = Math.imul(a ^ (a >>> 15), 1 | a);
          x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      }

      function clear() {
        cells = [];
        for (var i = 0; i < COLS * ROWS; i++) cells.push(null);
      }

      function put(x, y, ch, tint) {
        x = Math.round(x); y = Math.round(y);
        if (x < 1 || x >= COLS - 1 || y < 0 || y >= ROWS) return;
        cells[y * COLS + x] = { ch: ch, tint: tint };
      }

      /* One branch: walk upward, lean, occasionally split. `life` is the
         budget; children get less, which is what makes the crown sparse. */
      function grow(x, y, dx, life, depth) {
        var steps = Math.max(2, Math.floor(life * 0.55));
        for (var i = 0; i < steps; i++) {
          if (life <= 0) break;
          life -= 1;

          /* Lean drifts rather than jumping, so branches curve. */
          dx += (rng() - 0.5) * 0.9;
          dx = Math.max(-1.4, Math.min(1.4, dx));
          x += dx * 0.55;
          y -= 0.8;

          var ch = Math.abs(dx) > 0.8 ? (dx > 0 ? '\\' : '/')
                 : Math.abs(dx) > 0.3 ? (dx > 0 ? '\\' : '/') : '|';
          if (depth === 0 && i < 3) ch = '|';
          pending.push({ x: x, y: y, ch: ch, tint: depth === 0 ? 'brown' : 'brown' });

          /* Split. Deeper branches split more readily, which is what gives
             the crown its fan. */
          if (life > 3 && rng() < 0.18 + depth * 0.06 && depth < 4) {
            grow(x, y, dx > 0 ? -0.8 : 0.8, Math.floor(life * 0.62), depth + 1);
          }
          if (y < 1) break;
        }

        /* Out of life: leaves. A small cluster rather than one glyph, or
           the tips look like broken sticks. */
        var cluster = 3 + Math.floor(rng() * 4);
        for (var l = 0; l < cluster; l++) {
          pending.push({
            x: x + (rng() - 0.5) * 3.2,
            y: y + (rng() - 0.5) * 2.0,
            ch: LEAVES[Math.floor(rng() * LEAVES.length)],
            tint: rng() < 0.25 ? 'cyan' : 'green'
          });
        }
      }

      function plant(withSeed) {
        seed = withSeed == null ? Math.floor(Math.random() * 0x7fffffff) : withSeed;
        rng = mulberry(seed);
        clear();
        pending = [];
        grow(COLS / 2, BASE_Y, 0, 26, 0);
        /* Count the queue BEFORE a single part comes off it. flush() paints by
           emptying `pending`, so reading its length afterwards asked a queue
           that had just been consumed how much work was left and got the
           truthful answer, none — a tree fully drawn on screen reporting zero
           parts the moment instant growth was on. The figure is meant to be
           the size of the tree, which is the same number in both modes, so it
           is taken once here and held rather than re-read from a queue whose
           whole job is to shrink. */
        var parts = pending.length;
        growing = live;
        if (!live) { flush(); }
        acc = 0;
        g.stat('seed', seed.toString(36));
        g.stat('parts', parts);
      }

      function flush() {
        while (pending.length) {
          var p = pending.shift();
          put(p.x, p.y, p.ch, p.tint);
        }
        growing = false;
      }

      return {
        /* A restart is a fresh run, so slow growth comes back with it — but
           the button has to say so, or the flag and the control disagree from
           the first frame after Restart. */
        reset: function () { live = true; syncLive(); plant(); },

        key: function (name) { if (name === 'action') plant(); },

        update: function (dt) {
          if (!growing || !pending.length) { if (!pending.length) growing = false; return; }
          acc += dt;
          /* About sixty parts a second: slow enough to watch, fast enough
             that nobody waits. */
          while (acc >= 1 / 60 && pending.length) {
            acc -= 1 / 60;
            var p = pending.shift();
            put(p.x, p.y, p.ch, p.tint);
            if (p.ch === '&' || p.ch === '*') g.beep(500 + Math.random() * 300, 0.02, 'sine', 0.015);
          }
          if (!pending.length) growing = false;
        },

        draw: function (term) {
          term.clear();
          for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
              var c = cells[y * COLS + x];
              if (c) term.put(x, y, c.ch, c.tint);
            }
          }
          // The pot
          var px = Math.floor(COLS / 2) - 7;
          term.text(px, BASE_Y + 1, ':' + new Array(14).join('_') + ':', 'dim');
          term.text(px, BASE_Y + 2, ' \\' + new Array(13).join('~') + '/ ', 'brown');
          term.text(px, BASE_Y + 3, '  \\' + new Array(11).join('_') + '/  ', 'brown');
          term.text(2, ROWS - 1, 'seed ' + seed.toString(36) + '   space grows another', 'dim');
        }
      };
    }
  });
})();

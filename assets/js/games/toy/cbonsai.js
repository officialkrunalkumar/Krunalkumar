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

   THE SOUND IS THE SAME SHAPE AS THE TREE. Every leaf that lands strikes a
   note from a pentatonic scale, and which note is decided by how high up the
   leaf sits — the pot is the bottom of the scale, the top of the crown is
   the top — so the tune climbs as the tree does and belongs to the seed
   rather than to a random number. Pentatonic because one growth step can
   drop a cluster of leaves inside a few frames: any handful of notes from
   that scale is a chord, where a chromatic pick would sooner or later have
   landed a semitone clash and made the tree sound wrong. Under all of it is
   wind, which is a held bed and not an event, because a tree makes no sound
   of its own — what you hear standing near one is air moving through it, and
   there is more of that to hear the more canopy there is to move through.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 72;
  var ROWS = 26;
  var BASE_Y = ROWS - 4;

  var LEAVES = ['&', '*', '~', '^'];

  /* A minor pentatonic, A3 to A5, lowest first. Two octaves covers the whole
     frame: the bottom of the scale belongs to a leaf sitting level with the
     pot and the top to one against the ceiling. Minor rather than major
     because a major pentatonic on short plucked notes reads as a toy
     xylophone, and this is supposed to be a plant. */
  var SCALE = [
    220.00, 261.63, 293.66, 329.63, 392.00,
    440.00, 523.25, 587.33, 659.25, 783.99, 880.00
  ];

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
      var parts = 0;              // how long that queue was when the tree was planted
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

      /* ---------------------------------------------------------------
         Wind through the leaves. See the header.

         Noise through a highpass is the rustle; the lowpass above it is
         what stops it being tape hiss. A highpass on its own passes
         everything up to the Nyquist, and the top two octaves of white
         noise carry nothing that sounds like a leaf — they only make the
         layer read as a recording of an empty room.

         The gusts are TWO slow oscillators on the gain rather than one. A
         single LFO is a fan: the ear finds the period within a few breaths
         and stops hearing wind at all. Two whose rates do not divide into
         each other, about eleven seconds against twenty-seven, sum to a
         pattern that does not come round again for minutes. The base gain
         is deliberately larger than the two depths together, so the sum
         never crosses zero — below it the gusts would bounce back off
         silence instead of arriving at it, at twice the rate.
         --------------------------------------------------------------- */
      var wind = g.bed(function (a) {
        var ctx = a.ctx;

        var src = ctx.createBufferSource();
        src.buffer = a.noise();
        src.loop = true;

        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2400;
        hp.Q.value = 0.7;

        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 7000;
        lp.Q.value = 0.6;

        var gust = ctx.createGain();
        gust.gain.value = 0.5;

        /* Silent until something has been planted. plant() pushes the first
           real value, and it runs long before anyone can have unmuted. */
        var leaves = ctx.createGain();
        leaves.gain.value = 0;

        src.connect(hp);
        hp.connect(lp);
        lp.connect(gust);
        gust.connect(leaves);
        leaves.connect(a.out);
        src.start();

        function breath(rate, depth) {
          var lfo = ctx.createOscillator();
          var amt = ctx.createGain();
          lfo.frequency.value = rate;
          amt.gain.value = depth;
          lfo.connect(amt);
          amt.connect(gust.gain);
          lfo.start();
        }
        breath(0.091, 0.28);
        breath(0.037, 0.16);

        function ramp(param, value) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* Slow, because the thing being followed is a tree growing. Ramp
             this in a tenth of a second and a canopy that fills in over
             three seconds becomes a staircase of sixteen audible steps. */
          param.linearRampToValueAtTime(value, now + 0.45);
        }

        return {
          set: function (key, value) {
            if (key !== 'canopy') return;
            var k = Math.max(0, Math.min(1, value));
            /* Squared, so the first few branches barely register and the
               level arrives with the crown. Mapped straight, half the wind
               was already blowing while the tree was still a stick. */
            ramp(leaves.gain, 0.018 + k * k * 0.044);
            /* A full canopy is broader as well as louder, so the highpass
               opens downward to let the body of the rustle through. A bare
               trunk keeps the thin sound of air past a bare branch. */
            ramp(hp.frequency, 2400 - k * 900);
          }
        };
      });

      /* How much tree there is for the wind to move through, 0..1: the share
         of the planting queue that has been painted. Leaves are pushed as
         each branch runs out of life, and branches recurse in the middle of
         their own walk, so leaf parts are spread all through the queue
         rather than bunched at the end of it — which is what makes the
         painted share a fair reading of how much canopy is standing. */
      function grown() {
        if (!parts) return 0;
        return (parts - pending.length) / parts;
      }

      /* Gated, because update() paints sixty parts a second and each one of
         those would otherwise cancel the ramp the one before it started, so
         the level would crawl and never actually arrive. Five pushes a
         second is finer than the ramp is anyway. `force` is for the two
         moments the value has to be exact rather than merely soon: a tree
         just planted, and a tree that has finished growing. */
      function windLevel(force) {
        if (!force && !g.gate('wind', 0.2)) return;
        wind.set('canopy', grown());
      }

      /* A leaf, struck. The pitch comes from the leaf's HEIGHT, so the tune
         climbs with the tree — see the header.

         The level is 0.03, which is where the rest of the site's one-shots
         sit. What this replaced was a sine beep at 0.015: inaudible under a
         page on any speaker anybody actually owns, which made the sound
         button on this toy read as broken rather than as restrained.

         High notes get a shorter tail than low ones, and that is what stops
         a run of them smearing into a wash — leaves at the top ring briefly
         while the heavier notes near the trunk hang on underneath them.

         Gated at an eighth of a second. Roughly half the parts in the queue
         are leaves, so ungated this is thirty notes a second: past the point
         where they are separable, and past the shell's voice ceiling too.
         Eight a second leaves about five tails sounding together, and five
         notes of a pentatonic sounding together is the chord this is for. */
      function leafNote(p) {
        if (!g.gate('leaf', 0.12)) return;
        /* The height is stretched before it picks a note. Leaves never
           reach either end of the frame — the bottom rows are trunk, and only
           the tallest trees brush the top — so the raw fraction addressed the
           middle third of the scale and the two octaves either side of it were
           never heard. */
        var k = Math.max(0, Math.min(1, ((BASE_Y - p.y) / BASE_Y - 0.15) / 0.62));
        /* Height chooses the note and the COLUMN breaks the tie, one degree
           either way. Height alone was the honest mapping and it came out
           stuck: a crown is only a few rows deep, so most of a tree's leaves
           land inside one band of the scale and six in a row struck the same
           note six times, which reads as a jammed key rather than as a tree.
           A degree of a pentatonic is consonant with its neighbours on both
           sides, so opening the cluster out costs nothing and turns a repeat
           into a phrase. Taken from x rather than from Math.random because
           the tune is meant to belong to the seed. */
        var i = Math.round(k * (SCALE.length - 1)) + Math.abs(Math.round(p.x)) % 3 - 1;
        i = Math.max(0, Math.min(SCALE.length - 1, i));
        g.pluck(SCALE[i], 0.62 - k * 0.26, 0.03);
      }

      /* The tree is finished. One low note — the root of the same scale, an
         octave under the lowest leaf — left long enough that it decays into
         the wind rather than stopping, which is a tree settling rather than
         a chime announcing that a job has completed.

         Gated even though it fires once per tree, because "grow another" is
         a button as well as a spacebar. In Instant mode one press is a whole
         tree, and somebody leaning on either control stacks these into a
         drone. */
      function settle() {
        if (!g.gate('settle', 0.5)) return;
        g.pluck(SCALE[0] / 2, 1.5, 0.028);
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
           whole job is to shrink. The wind wants the same number for the
           same reason — its level is the share of that queue already
           painted — so the figure lives in the closure rather than in this
           call's frame. */
        parts = pending.length;
        growing = live;
        if (!live) { flush(); }
        acc = 0;
        /* A new tree resets the wind with it: back to a bare trunk under
           slow growth, straight to a full canopy when the whole thing
           arrives in a single frame. */
        windLevel(true);
        g.stat('seed', seed.toString(36));
        g.stat('parts', parts);
      }

      function flush() {
        while (pending.length) {
          var p = pending.shift();
          put(p.x, p.y, p.ch, p.tint);
        }
        growing = false;
        /* Instant mode arrives at the finished tree in one frame, so this is
           where the settling note belongs for that half of the toy; slow
           growth reaches the same moment inside update(). The leaves are
           deliberately NOT sounded here — two hundred notes struck in one
           frame is not a chord, it is a crash. */
        settle();
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
            /* Tint rather than glyph. Every leaf is green or cyan and every
               piece of branch is brown, where which of the four leaf
               characters a leaf happened to get is a drawing decision that
               has nothing to do with whether it should be heard. Testing the
               glyph left half the canopy silent for no reason anyone could
               have named. */
            if (p.tint !== 'brown') leafNote(p);
          }
          if (!pending.length) {
            growing = false;
            settle();
          }
          /* Forced on the last push of a run, so the wind lands exactly
             where the finished tree says it should rather than wherever the
             gate happened to leave it. */
          windLevel(!growing);
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

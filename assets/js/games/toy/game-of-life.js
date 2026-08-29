/* ==========================================================================
   game-of-life.js — Conway's Life.
   --------------------------------------------------------------------------
   Not a game: a zero-player automaton, which is exactly why it belongs in a
   section called toys. Four rules, no randomness after the seed, and
   behaviour nobody can predict from the rules alone.

   The grid WRAPS. An infinite plane is not available, and a bounded one
   quietly changes the rules at the edges — gliders die there, which makes
   the most famous pattern in the whole subject look broken. A torus keeps
   every cell with exactly eight neighbours.

   The SOUND is a sequencer rather than a set of effects, because a
   generation is a discrete event on a clock and that is what a sequencer
   is. A glider gun firing on a thirty-step period is a rhythm whether or
   not anyone plays it. So this toy gets NOTES: one plucked note per
   generation, drawn from a minor pentatonic, which is the scale in which
   no two degrees can clash — the board is choosing the notes and the board
   has no taste, and the scale is what stops that mattering. A note only
   sounds when the board actually changed, so a run that settles into still
   lifes falls silent by itself instead of ticking forever. Underneath it a
   pad of three detuned triangles opens and closes with the POPULATION, so
   a board that is dying goes dark as well as quiet.
   ========================================================================== */

(function () {
  'use strict';

  var W = 96;
  var H = 64;
  var CELL = 6;               // 96*6 = 576, 64*6 = 384

  /* Seeds worth having on a button. Coordinates are relative. */
  var PATTERNS = {
    glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
    gun: [
      [24, 0], [22, 1], [24, 1], [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
      [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3], [0, 4], [1, 4], [10, 4],
      [16, 4], [20, 4], [21, 4], [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5],
      [22, 5], [24, 5], [10, 6], [16, 6], [24, 6], [11, 7], [15, 7], [12, 8], [13, 8]
    ],
    pulsar: [
      [2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0],
      [0, 2], [5, 2], [7, 2], [12, 2], [0, 3], [5, 3], [7, 3], [12, 3],
      [0, 4], [5, 4], [7, 4], [12, 4], [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5],
      [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7],
      [0, 8], [5, 8], [7, 8], [12, 8], [0, 9], [5, 9], [7, 9], [12, 9],
      [0, 10], [5, 10], [7, 10], [12, 10], [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12]
    ],
    rpentomino: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]
  };

  GameShell.define({
    id: 'game-game-of-life',
    slug: 'game-of-life',
    title: 'Game of Life',
    width: W * CELL,
    height: H * CELL,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var cur = new Uint8Array(W * H);
      var next = new Uint8Array(W * H);
      var gen = 0;
      var acc = 0;
      var speed = 12;             // generations a second
      var running = true;
      var painting = 0;           // 1 = drawing alive, 2 = erasing

      /* What the most recent generation did, for the sound below. */
      var births = 0;             // cells born by that generation
      var changes = 0;            // cells that flipped, either way
      var still = false;          // the board has stopped, and has said so

      var speedSel = document.getElementById('game-speed');
      var patSel = document.getElementById('game-pattern');
      var runBtn = document.getElementById('game-run');
      var clearBtn = document.getElementById('game-clear');
      var randBtn = document.getElementById('game-random');

      if (speedSel) {
        speed = Number(speedSel.value) || 12;
        speedSel.addEventListener('change', function () { speed = Number(speedSel.value) || 12; });
      }
      if (patSel) patSel.addEventListener('change', function () { stamp(patSel.value); });
      if (runBtn) runBtn.addEventListener('click', function () {
        running = !running;
        /* 'Stop', not 'Pause': the shell's own Pause button sits two
           controls away, and two adjacent buttons both reading "Pause" —
           one freezing the loop, one the simulation — was a coin toss. */
        runBtn.textContent = running ? 'Stop' : 'Run';
      });
      if (clearBtn) clearBtn.addEventListener('click', function () { cur = new Uint8Array(W * H); gen = 0; });
      if (randBtn) randBtn.addEventListener('click', randomise);

      /* ---------------------------------------------------------------
         The pad. See the header.

         Three triangles, tuned to the root, the fifth and the octave, and
         deliberately NOT the third: a third would commit the drone to major
         or minor, and the melody above it is being written by an automaton
         that will happily sit on any degree of the scale for a minute. An
         open fifth agrees with all of them.

         Everything about it is steered by the population, and the cutoff is
         the part that carries. A crowded board is bright and present; a
         board with forty cells left is a muffled hum; a board with nothing
         left is very nearly nothing. That one mapping is what makes a dying
         board audibly die, which the notes on their own cannot do — a note
         says what the last generation did, the pad says how much world
         there still is.
         --------------------------------------------------------------- */
      var pad = g.bed(function (a) {
        var ctx = a.ctx;

        var mix = ctx.createGain();
        mix.gain.value = 0.12;

        var filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 140;
        /* Almost no resonance. A pad with a peak sitting on its cutoff
           whistles whenever the cutoff moves, and this cutoff is moving
           every time the population does, which is constantly. */
        filt.Q.value = 0.6;

        filt.connect(mix);
        mix.connect(a.out);

        /* Detune in CENTS, not in hertz. A fixed offset of a fraction of a
           hertz beats pleasantly at the root and is an audible warble an
           octave up; cents beat proportionally, which is what an ensemble
           of anything actually does.

           The higher voices are quieter, because every real sustaining
           instrument has less energy the further up it sits. Give all three
           the same gain and it stops being a pad and becomes three
           oscillators. */
        function layer(freq, cents, level) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          osc.detune.value = cents;
          gain.gain.value = level;
          osc.connect(gain);
          gain.connect(filt);
          osc.start();
        }

        layer(110, -7, 0.022);        // A2, the root
        layer(164.81, 6, 0.013);      // E3, the fifth
        layer(220, 11, 0.009);        // A3, the octave

        /* A breath roughly every fourteen seconds. A pulsar holds its
           population at exactly forty-eight cells for as long as you leave
           it running, so without this the pad under one of the two most
           famous patterns in the subject is a dead tone — and the ear stops
           hearing a dead tone inside about ten seconds. */
        var lfo = ctx.createOscillator();
        var depth = ctx.createGain();
        lfo.frequency.value = 0.071;
        depth.gain.value = 55;
        lfo.connect(depth);
        depth.connect(filt.frequency);
        lfo.start();

        function ramp(param, value) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          /* A third of a second. The population changes every generation
             and the pad must not follow it step for step, or a soup makes
             it flutter; this is slow enough to read as the weight of the
             board rather than as its arithmetic. */
          param.linearRampToValueAtTime(value, now + 0.34);
        }

        return {
          set: function (key, value) {
            if (key !== 'pop') return;
            /* Square-rooted, and measured against seven hundred cells
               rather than against the six thousand the grid holds. Life
               never fills a board — a random soup collapses to a few per
               cent of it within a hundred generations — so scaling against
               capacity would leave every board anyone actually watches in
               the bottom tenth of the range, and the mapping would be
               inaudible. */
            var k = Math.sqrt(Math.min(1, Math.max(0, value) / 700));
            /* Exponential in the cutoff, because brightness is heard the
               way pitch is: 140 Hz at empty, where the root is only just
               getting through, up to about 1.7 kHz at a crowded board. */
            ramp(filt.frequency, 140 * Math.pow(12, k));
            ramp(mix.gain, 0.12 + k * 0.88);
          }
        };
      });

      function idx(x, y) { return ((y + H) % H) * W + ((x + W) % W); }

      function randomise() {
        cur = new Uint8Array(W * H);
        for (var i = 0; i < cur.length; i++) cur[i] = Math.random() < 0.28 ? 1 : 0;
        gen = 0;
      }

      function stamp(name) {
        var pat = PATTERNS[name];
        if (!pat) return;
        cur = new Uint8Array(W * H);
        var ox = Math.floor(W / 2) - 18;
        var oy = Math.floor(H / 2) - 8;
        for (var i = 0; i < pat.length; i++) cur[idx(ox + pat[i][0], oy + pat[i][1])] = 1;
        gen = 0;
      }

      function step() {
        /* Reset per generation, not per frame. The accumulator can run
           several generations inside one frame, and a total across them
           would describe a generation that never happened. */
        births = 0;
        changes = 0;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var n = 0;
            for (var dy = -1; dy <= 1; dy++) {
              for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                n += cur[idx(x + dx, y + dy)];
              }
            }
            var alive = cur[y * W + x];
            /* The four rules, as one line: a live cell survives on 2 or 3,
               a dead cell is born on exactly 3. */
            var live = (alive && (n === 2 || n === 3)) || (!alive && n === 3) ? 1 : 0;
            next[y * W + x] = live;
            /* Counted here rather than by walking the two buffers again
               afterwards. This loop already holds the old cell and the
               new one; a second pass would be six thousand reads a
               generation, thirty times a second at Fast, to recover a
               number that was in hand and thrown away. */
            if (live !== alive) { changes++; if (live) births++; }
          }
        }
        var swap = cur; cur = next; next = swap;
        gen++;
      }

      /* A minor pentatonic, in semitones above the root. There is not a
         semitone step anywhere in it, which is the whole reason it is here:
         no two of these degrees can be struck in sequence or left ringing
         over each other and sound wrong, so the melody the board writes is
         consonant no matter what the board decides to do next. */
      var PENT = [0, 3, 5, 7, 10];

      /* A3. Low enough that the bottom octave is a warm pluck rather than a
         thud, high enough that the top of the third octave is still a note
         and not a whistle. */
      var ROOT = 220;

      /* One generation, heard. Two different quantities decide the note,
         and keeping them separate is the point.

         The DEGREE comes from the number of BIRTHS, modulo the scale. A
         linear or logarithmic map from births onto the ladder is the
         obvious alternative and it loses badly: a glider gun births between
         about two and ten cells a generation, so any smooth mapping folds
         its entire thirty-step cycle onto two or three neighbouring notes
         and the most rhythmically interesting object in the subject comes
         out as a stuck tick. Modulo spends the whole scale on that cycle,
         and because the births of a periodic pattern really are periodic,
         the phrase repeats exactly when the pattern does. A gun plays a
         thirty-step riff, a pulsar a three-note figure, a soup something
         that never comes round again.

         The REGISTER comes from the POPULATION, so the two never fight for
         the same note: the melody is what the last generation did, the
         octave is how much board there is. A run that starts as a soup and
         decays into a handful of still lifes descends as it dies. */
      function sound(stepped, alive) {
        /* The pad follows the population, but not at frame rate. Every ramp
           inside the bed cancels and restarts the one before it, so a
           parameter re-ramped sixty times a second sets off towards a new
           target every sixteen milliseconds and never arrives at any of
           them. Five times a second, against ramps of a third of a second,
           is a glide instead of a staircase. */
        if (g.gate('pad', 0.2)) pad.set('pop', alive);

        if (!stepped) return;

        if (!changes) {
          /* The board has stopped moving, and Life is deterministic: a
             generation identical to the one before it will be identical
             for ever. This is not a lull, it is the end of the run, and it
             is worth exactly one note rather than one per generation for as
             long as the tab is open. An octave below anything the melody
             can reach, and left to ring out. */
          if (!still) {
            still = true;
            g.pluck(ROOT / 2, 1.8, 0.03);
          }
          return;
        }
        still = false;

        /* Only every Nth generation gets a note. At Fast the board runs
           thirty generations a second, and thirty plucks a second is not a
           melody, it is a texture; the divisor keeps the pulse between four
           and eight notes a second at all three speeds. It divides the
           GENERATION COUNTER rather than gating on the clock because Life
           is already a sequencer and the notes have to land on its beat — a
           time-based gate whose interval does not divide the generation
           interval limps, letting three generations through and then two.
           The gate underneath is insurance rather than the rhythm: the
           accumulator is allowed to catch up on as many as eight
           generations inside one frame, and none of that should ever be
           audible as a burst. */
        var beat = speed > 20 ? 4 : (speed > 8 ? 2 : 1);
        if (gen % beat) return;
        if (!g.gate('gen', 0.1)) return;

        /* The thresholds are patterns, not round numbers. A glider is five
           cells and a pulsar forty-eight, so all the famous small objects
           play in the bottom octave where they sound like what they are,
           and only a real crowd — a fresh random fill, or a gun that has
           filled the torus with its own gliders — climbs to the top. */
        var oct = alive > 420 ? 2 : (alive > 60 ? 1 : 0);

        /* A high string rings shorter than a low one and reads louder at
           the same gain, so the top octave is given less of both. Without
           the taper a busy board is the only thing on the page you can
           hear. */
        g.pluck(ROOT * Math.pow(2, oct + PENT[births % PENT.length] / 12),
                0.55 - oct * 0.12, 0.032 - oct * 0.005);
      }

      if (g.canvas) {
        var paint = function (event) {
          if (!painting) return;
          var p = g.pointAt(event);
          var x = Math.floor(p.x / CELL);
          var y = Math.floor(p.y / CELL);
          if (x < 0 || x >= W || y < 0 || y >= H) return;
          cur[y * W + x] = painting === 1 ? 1 : 0;
        };
        g.canvas.addEventListener('pointerdown', function (event) {
          var p = g.pointAt(event);
          var x = Math.floor(p.x / CELL), y = Math.floor(p.y / CELL);
          /* Drawing on a live cell erases, on a dead one draws — so one
             gesture both adds and removes without a mode switch. */
          painting = (x >= 0 && x < W && y >= 0 && y < H && cur[y * W + x]) ? 2 : 1;
          paint(event);
        });
        g.canvas.addEventListener('pointermove', paint);
        g.canvas.addEventListener('pointerup', function () { painting = 0; });
        g.canvas.addEventListener('pointerleave', function () { painting = 0; });
      }

      return {
        reset: function () {
          stamp('gun');
          running = true;
          if (runBtn) runBtn.textContent = 'Stop';
          g.stat('gen', 0);
        },

        key: function (name) {
          if (name === 'action') {
            running = !running;
            if (runBtn) runBtn.textContent = running ? 'Stop' : 'Run';
          }
        },

        update: function (dt) {
          if (!running) return;
          acc += dt;
          var interval = 1 / speed;
          var guard = 0;
          while (acc >= interval && guard < 8) { acc -= interval; step(); guard++; }
          g.stat('gen', gen);
          var alive = 0;
          for (var i = 0; i < cur.length; i++) alive += cur[i];
          g.stat('alive', alive);
          sound(guard > 0, alive);
        },

        draw: function (ctx) {
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, W * CELL, H * CELL);
          ctx.fillStyle = '#86efac';
          for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
              if (!cur[y * W + x]) continue;
              ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
            }
          }
        }
      };
    }
  });
})();

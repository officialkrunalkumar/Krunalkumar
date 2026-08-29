/* ==========================================================================
   pipes.js — the pipes screensaver, in a terminal.
   --------------------------------------------------------------------------
   Each pipe walks a cell at a time and, occasionally, turns. The only real
   work is choosing the right box-drawing character for a corner, which
   depends on BOTH the direction it came from and the direction it is going.
   A lookup keyed on "from,to" is four lines and gets every corner right;
   guessing from the new direction alone gets half of them backwards, which
   is the single most common way a pipes clone looks wrong.

   The screen is never cleared. Pipes paint over each other and the picture
   accumulates until it is full, which is the whole appeal — so the buffer
   is only wiped when it gets too dense to read.

   The sound follows the picture. A pipe TURNING is the only thing that
   happens here, so a turn is the only thing that plays, and the note comes
   from the pipe's own colour — the same index into the same fixed list. A
   colour you can pick out of the tangle by eye can therefore be followed by
   ear as well. A straight step is silent: it is not an event, it is the
   pipe continuing. Sixty steps a second across eight pipes would be eighty
   corners a second, which no ear wants, so the notes are thinned to a
   ceiling of about eight and thinned harder the busier the settings get.
   Under all of it sits a room tone at the edge of audible, because a
   screensaver that falls completely silent between corners sounds switched
   off rather than calm.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 80;
  var ROWS = 26;

  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];    // N E S W

  /* "from,to" -> the character that joins them. `from` is the direction the
     pipe was travelling, `to` is the new one. */
  var CORNER = {
    '0,1': '┌', '0,3': '┐', '2,1': '└', '2,3': '┘',
    '1,0': '┘', '1,2': '┐', '3,0': '└', '3,2': '┌'
  };
  var STRAIGHT = { 0: '│', 2: '│', 1: '─', 3: '─' };

  var TINTS = ['green', 'cyan', 'blue', 'magenta', 'yellow', 'orange', 'white'];

  /* One note per tint, in the same order, so the pipe you are watching and
     the note you are hearing are the same fact. A minor pentatonic from A3
     to C5 rather than a chromatic run or an even spread in hertz: with four
     or eight pipes turning independently these land on top of each other
     constantly, and a pentatonic is the scale where that comes out as a
     chord instead of a cluster. Seven of them because there are seven
     tints — an eighth pipe wraps onto green and shares its note, which is
     the compromise the colours were already making. */
  var NOTES = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25];

  TermShell.define({
    id: 'game-pipes',
    slug: 'pipes',
    title: 'Pipes',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g, t) {
      var pipes = [];
      var chars = [];
      var tints = [];
      var filled = 0;
      var acc = 0;
      var speed = 26;              // cells a second
      var count = 4;

      var speedSel = document.getElementById('game-speed');
      var countSel = document.getElementById('game-count');
      if (speedSel) {
        speed = Number(speedSel.value) || 26;
        speedSel.addEventListener('change', function () { speed = Number(speedSel.value) || 26; });
      }
      if (countSel) {
        count = Number(countSel.value) || 4;
        countSel.addEventListener('change', function () { count = Number(countSel.value) || 4; seed(); });
      }

      /* ---------------------------------------------------------------
         The room.

         Nothing in this toy is continuous: a pipe between corners is doing
         nothing an ear can hear, and there is no density, heat or depth
         here worth putting under a moving filter. So the bed carries no
         information at all. Its only job is to stop the toy sounding
         switched off in the gaps between notes, which is why it sits at
         the edge of audible and is given nothing to steer it with.

         The hum is TWO sines half a hertz apart rather than one. A single
         sine held forever is a test tone and the ear files it as a fault
         within seconds; two drifting in and out of phase swell once every
         two seconds, and that is the whole difference between a room and a
         signal generator. Their levels are deliberately unequal — matched
         ones would cancel at the trough and throb rather than breathe.
         --------------------------------------------------------------- */
      g.bed(function (a) {
        var ctx = a.ctx;

        function tone(freq, level) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.value = level;
          osc.connect(gain);
          gain.connect(a.out);
          osc.start();
        }

        /* 55 Hz is an A, two octaves under the root of the scale the turns
           are drawn from. A room tone at an unrelated pitch is a drone
           quietly arguing with every note played over it, and the argument
           is audible long before the drone itself is. */
        tone(55, 0.022);
        tone(55.5, 0.009);

        /* An octave up and much quieter. 55 Hz is simply not there on a
           laptop or a phone, both of which give up well above it, so this
           partial is what carries the hum onto them; it is far enough down
           that on headphones it passes as part of the same note rather
           than as a second one. */
        tone(110, 0.006);

        /* The breath: noise with everything below 2 kHz taken out. Air in a
           room is the top of the spectrum and nothing else — leave the low
           end in and it stops being a room and becomes wind, which would
           also smother the hum it is meant to sit over. It is then held
           dead still on purpose: the beat in the hum is the only movement
           in here, and a second slow movement at a different rate reads as
           a fault in the audio rather than as a place. */
        var src = ctx.createBufferSource();
        src.buffer = a.noise();
        src.loop = true;
        var filt = ctx.createBiquadFilter();
        filt.type = 'highpass';
        filt.frequency.value = 2000;
        filt.Q.value = 0.7;
        var air = ctx.createGain();
        air.gain.value = 0.005;
        src.connect(filt);
        filt.connect(air);
        air.connect(a.out);
        src.start();

        /* No handle kept and no set() returned: there is nothing about this
           room that either select should be allowed to change. */
      });

      /* One corner, heard. The gate is the whole design problem.

         The raw rate is the two selects multiplied together and thinned by
         the one-in-six turn chance rolled in step(): four corners a second
         at twelve steps with two pipes, eighty at sixty steps with eight.
         No single interval suits both, so the ceiling moves with the
         settings — twelve notes a second when almost nothing is happening,
         falling to eight when everything is. At the sparse end the ceiling
         is well above the raw rate and every corner sounds; at the busy end
         nine corners in ten are dropped, and the eight a second that
         survive are still enough to hear the shape of the thing.

         One gate for all the pipes rather than one each. Per-pipe gates at
         the same interval would let eight pipes make eight times the noise,
         and the limit belongs on the ear, not on the pipe. */
      function turned(p) {
        var rate = speed * count * 0.17;

        /* Onto 0..1 on a log curve rather than a straight line: the range
           is a factor of twenty and the settings people actually sit on are
           all at the bottom of it. */
        var k = Math.max(0, Math.min(1, Math.log(rate / 4) / Math.log(20)));
        if (!g.gate('turn', 1 / (12 - k * 4))) return;

        var i = TINTS.indexOf(p.tint);
        if (i < 0) i = 0;

        /* The level falls twice over. High notes read as louder than low
           ones struck at the same gain, and the whole run drops as the
           screen gets busier, because a note arriving eight times a second
           has to be quieter than one arriving four times a minute.

           A fifth of a second of decay: long enough to be a note rather
           than a click, short enough that eight of them inside a second do
           not smear into a drone. Triangle rather than the softer sine,
           because the point of giving each pipe its own pitch is that you
           can pick one out, and a sine pluck at this level is too round to
           be told from its neighbour. */
        var level = (0.042 - i * 0.003) * (1 - k * 0.35);
        g.pluck(NOTES[i], 0.2, level, 'triangle');
      }

      /* The wipe, which is the only other thing that happens in here. A
         soft fall of filtered noise rather than the shell's sweep(): sweep
         is a sawtooth note, and a note would be heard as one more pipe
         arriving rather than as the screen being taken away. It can afford
         to be louder than a turn because it lands once every half a minute
         or so instead of eight times a second.

         Not gated. The condition that fires it sets filled back to zero, so
         it cannot repeat until the screen has filled up again. */
      function swept() {
        g.noise(0.45, {
          type: 'lowpass',
          freq: 1400,
          to: 140,
          q: 0.8,
          level: 0.05
        });
      }

      function seed() {
        pipes = [];
        for (var i = 0; i < count; i++) {
          pipes.push({
            x: Math.floor(Math.random() * COLS),
            y: Math.floor(Math.random() * ROWS),
            d: Math.floor(Math.random() * 4),
            tint: TINTS[i % TINTS.length]
          });
        }
      }

      function wipe() {
        chars = [];
        tints = [];
        for (var i = 0; i < COLS * ROWS; i++) { chars.push(' '); tints.push('green'); }
        filled = 0;
      }

      function step() {
        for (var i = 0; i < pipes.length; i++) {
          var p = pipes[i];
          var from = p.d;

          /* Turn about one step in six. Any more and it scribbles; any less
             and it is four straight lines. */
          if (Math.random() < 0.17) {
            var turn = Math.random() < 0.5 ? 1 : 3;
            p.d = (p.d + turn) % 4;
            turned(p);
          }

          var ch = from === p.d ? STRAIGHT[p.d] : CORNER[from + ',' + p.d];
          var idx = p.y * COLS + p.x;
          if (chars[idx] === ' ') filled++;
          chars[idx] = ch || STRAIGHT[p.d];
          tints[idx] = p.tint;

          p.x += DIRS[p.d][0];
          p.y += DIRS[p.d][1];

          /* Off the edge and back on the other side, with a fresh colour so
             the reappearance reads as a new pipe rather than a glitch. */
          if (p.x < 0) { p.x = COLS - 1; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
          if (p.x >= COLS) { p.x = 0; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
          if (p.y < 0) { p.y = ROWS - 1; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
          if (p.y >= ROWS) { p.y = 0; p.tint = TINTS[Math.floor(Math.random() * TINTS.length)]; }
        }

        /* Once it is too dense to read, start again. The original waits a
           fixed number of frames; going by coverage looks better because a
           slow run is not cut short. */
        if (filled > COLS * ROWS * 0.72) { wipe(); seed(); swept(); }
      }

      return {
        reset: function () { wipe(); seed(); },

        update: function (dt) {
          acc += dt;
          var interval = 1 / speed;
          var guard = 0;
          while (acc >= interval && guard < 40) { acc -= interval; step(); guard++; }
          g.stat('filled', Math.round((filled / (COLS * ROWS)) * 100) + '%');
        },

        draw: function (term) {
          term.clear();
          for (var y = 0; y < ROWS; y++) {
            for (var x = 0; x < COLS; x++) {
              var i = y * COLS + x;
              if (chars[i] === ' ') continue;
              term.put(x, y, chars[i], tints[i]);
            }
          }
          /* The heads, drawn brighter so you can follow one. */
          for (var p = 0; p < pipes.length; p++) {
            term.put(pipes[p].x, pipes[p].y, '●', 'white');
          }
        }
      };
    }
  });
})();

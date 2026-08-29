/* ==========================================================================
   falling-sand.js — a powder toy.
   --------------------------------------------------------------------------
   Four materials, one rule each, and everything interesting is emergent:
   sand piles into slopes because it only slips diagonally, water levels
   itself because it also moves sideways, and fire spreads only into wood.

   THE GRID IS SCANNED BOTTOM-UP. Scanning downward moves a grain, then meets
   it again one row lower and moves it again, so sand teleports to the floor
   in a single frame instead of falling. Going up means every cell is
   considered exactly once per frame, which is what makes it look like
   gravity rather than a glitch.

   SETTLED SAND IS SILENT, and that one fact is the whole sound design. The
   bed is not driven by how much sand exists, it is driven by how many cells
   actually MOVED in the last step — counted inside swap(), where a move
   already happens, so nothing sweeps the grid a second time to work out how
   loud the toy should be. Pour a pile and it rushes, let it settle and it
   dies away on its own, and no line of code anywhere says that it should.
   Water gets its own quieter layer underneath, because water burbles where
   sand hisses; blend the two into one hiss and you throw away the best
   moment the toy has, which is a pour landing in a pool.
   ========================================================================== */

(function () {
  'use strict';

  var W = 160;
  var H = 110;
  var CELL = 4;                 // 640 x 440

  var EMPTY = 0, SAND = 1, WATER = 2, WALL = 3, WOOD = 4, FIRE = 5, SMOKE = 6;

  var TINT = {};
  TINT[SAND] = '#e0b866';
  TINT[WATER] = '#38bdf8';
  TINT[WALL] = '#64748b';
  TINT[WOOD] = '#92400e';
  TINT[FIRE] = '#f97316';
  TINT[SMOKE] = '#475569';

  GameShell.define({
    id: 'game-falling-sand',
    slug: 'falling-sand',
    title: 'Falling sand',
    width: W * CELL,
    height: H * CELL,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      var grid = new Uint8Array(W * H);
      var life = new Uint8Array(W * H);       // fire and smoke burn down
      var tool = SAND;
      var brush = 3;
      var drawing = false;
      var lastPt = null;

      var toolSel = document.getElementById('game-tool');
      var brushSel = document.getElementById('game-brush');
      var clearBtn = document.getElementById('game-clear');

      var TOOLS = { sand: SAND, water: WATER, wall: WALL, wood: WOOD, fire: FIRE, eraser: EMPTY };
      if (toolSel) {
        tool = TOOLS[toolSel.value] != null ? TOOLS[toolSel.value] : SAND;
        /* The HUD cell has to follow the dropdown, or it sits on Sand for
           ever while you draw water and quietly contradicts the toolbar. */
        var showTool = function () {
          var name = toolSel.options[toolSel.selectedIndex].textContent;
          g.stat('tool', name);
        };
        showTool();
        toolSel.addEventListener('change', function () { tool = TOOLS[toolSel.value]; showTool(); });
      }
      if (brushSel) {
        brush = Number(brushSel.value) || 3;
        brushSel.addEventListener('change', function () { brush = Number(brushSel.value) || 3; });
      }
      if (clearBtn) clearBtn.addEventListener('click', function () {
        grid = new Uint8Array(W * H); life = new Uint8Array(W * H);
      });

      /* ---------------------------------------------------------------
         What the physics step hands to the ear. Three counters, all of
         them incremented where the thing they count already happens, and
         all of them cleared at the top of the step. There is deliberately
         no second pass over the grid: seventeen thousand cells a frame is
         cheap once and wasteful twice, and a sound design that costs a
         whole extra sweep of the simulation is a sound design that will be
         switched off.
         --------------------------------------------------------------- */
      var movedGrain = 0;         // sand cells that changed place this step
      var movedWater = 0;         // water cells that changed place this step
      var burning = 0;            // fire cells still alive this step

      /* The same two counts after smoothing, 0..1, and the last values the
         bed was actually told about. */
      var grainLevel = 0;
      var waterLevel = 0;
      var sentGrain = -1;
      var sentWater = -1;

      /* ---------------------------------------------------------------
         The bed. Two layers, because sand and water are not the same
         sound and folding them together loses the toy's best moment.

         HISS is bandpassed noise in the low treble, which is where a
         stream of grains actually lives. Both the centre and the width
         follow the pour: a trickle is a thin "sss" up near four kilohertz,
         a full pour is a broad rush an octave below it. Move only the gain
         and leave the filter parked and you have built a volume knob, not
         a pour — the character of falling sand changes with how much of it
         is falling, not just the level.

         BURBLE is lowpassed noise a couple of hundred hertz up, resonant,
         with a slow wobble on the cutoff. The wobble is the whole
         difference between water and a rumble, and its RATE is the part
         worth arguing about: a couple of cycles a second, which is roughly
         the speed water moves at. Rain's storm breathes once every sixteen
         seconds because weather is slow; borrow that number here and the
         pool reads as a distant engine.

         Neither layer has an LFO on its gain, and neither needs one. The
         number of moving cells already swings about from frame to frame,
         so the level shimmers by itself — out of the simulation rather
         than out of a decoration bolted on top of it.
         --------------------------------------------------------------- */
      var flow = g.bed(function (a) {
        var ctx = a.ctx;

        function layer(type, freq, q) {
          var src = ctx.createBufferSource();
          src.buffer = a.noise();
          src.loop = true;
          var filt = ctx.createBiquadFilter();
          filt.type = type;
          filt.frequency.value = freq;
          filt.Q.value = q;
          var gain = ctx.createGain();
          /* Built silent. The nodes appear the first time the visitor
             unmutes, which is quite likely to be in the middle of a pile
             already settling, and the layer must fade up out of nothing
             rather than punch in at whatever the level happened to be. */
          gain.gain.value = 0;
          src.connect(filt);
          filt.connect(gain);
          gain.connect(a.out);
          src.start();
          return { filt: filt, gain: gain };
        }

        var hiss = layer('bandpass', 3600, 1.4);
        var burble = layer('lowpass', 320, 2.2);

        var wobble = ctx.createOscillator();
        var depth = ctx.createGain();
        wobble.frequency.value = 1.4;
        depth.gain.value = 110;
        wobble.connect(depth);
        depth.connect(burble.filt.frequency);
        wobble.start();

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(value, now + secs);
        }

        return {
          set: function (key, value) {
            if (key === 'grain') {
              /* Gain is ramped faster than timbre. A pour has to be heard
                 starting on the frame it starts, but a filter chasing the
                 level at the same speed whistles as it moves. */
              ramp(hiss.gain.gain, value * 0.06, 0.12);
              ramp(hiss.filt.frequency, 3600 - value * 1400, 0.25);
              /* Narrow when barely anything is moving, wide open at a full
                 pour. A bandpass passes less power as its Q rises, so this
                 makes a trickle thinner AND quieter, which is the right
                 pair of things to happen at once. */
              ramp(hiss.filt.Q, 1.4 - value * 0.8, 0.25);
              return;
            }
            if (key === 'water') {
              ramp(burble.gain.gain, value * 0.045, 0.12);
              /* More water moving opens the cutoff, so a full pool is
                 fuller rather than merely louder. The wobble rides on top
                 of this: the LFO is connected to the same AudioParam and
                 sums with the ramp instead of fighting it. */
              ramp(burble.filt.frequency, 320 + value * 260, 0.25);
            }
          }
        };
      });

      /* Amplitude follows the SQUARE ROOT of the number of moving cells,
         not the count itself. Grains are independent sources, so they add
         as power rather than as pressure — twice the sand is about 1.4
         times the amplitude, not twice. That is a fact about noise and not
         a taste decision, and it is also what keeps a thin trickle clearly
         audible next to a pour with thirty times as many cells in it.

         The reference counts are the busiest honest moment for each
         material. The opening pile puts something like twelve hundred
         grains in the air at once, which is as loud as this toy ever
         legitimately gets. Water needs a lower number because a levelling
         pool only churns at its surface — the cells in the middle of it
         have nowhere to go and are correctly silent. */
      var GRAIN_REF = 1200;
      var WATER_REF = 700;

      function curve(count, ref) {
        var k = count / ref;
        return Math.sqrt(k > 1 ? 1 : k);
      }

      /* Everything the ear gets, once per physics step.

         The smoothing rises fast and falls slow, because that is the shape
         of the event. A pour is audible the instant the brush goes down,
         and a pile does not stop dead when you let go — it keeps shedding
         grains for a moment afterwards. A symmetric filter makes that tail
         sound like it was cut off, and no filter at all makes the hiss
         flutter, since the number of moving cells can swing by a third
         between one frame and the next. */
      function hear() {
        var grain = curve(movedGrain, GRAIN_REF);
        var water = curve(movedWater, WATER_REF);
        grainLevel += (grain - grainLevel) * (grain > grainLevel ? 0.4 : 0.07);
        waterLevel += (water - waterLevel) * (water > waterLevel ? 0.4 : 0.07);

        /* An exponential decay never actually arrives at zero, and a bed
           held open at a thousandth of full gain is a context that never
           gets to suspend itself. Below this it is inaudible anyway, so
           close it properly. */
        if (grainLevel < 0.001) grainLevel = 0;
        if (waterLevel < 0.001) waterLevel = 0;

        /* Only speak when the number has actually changed. A settled grid
           sends nothing at all, and a settled grid is what this toy is
           looking at for most of its life. */
        if (grainLevel !== sentGrain &&
            (grainLevel === 0 || Math.abs(grainLevel - sentGrain) > 0.004)) {
          sentGrain = grainLevel;
          flow.set('grain', grainLevel);
        }
        if (waterLevel !== sentWater &&
            (waterLevel === 0 || Math.abs(waterLevel - sentWater) > 0.004)) {
          sentWater = waterLevel;
          flow.set('water', waterLevel);
        }

        /* Fire crackles rather than hisses, so it stays a one-shot and
           never joins the bed. A third layer roaring under the fire would
           be wrong twice over: this fire is a few dozen short-lived cells
           rather than a bonfire, and a held roar would go on humming for
           as long as the last ember took to ramp away.

           The gate alone would give a tick every 110 ms exactly, which is
           a metronome. The coin flip in front of it is what makes the
           spacing irregular, which is the only way a crackle sounds like
           burning rather than like a clock. */
        if (burning > 0 && Math.random() < 0.3 && g.gate('crackle', 0.11)) {
          g.noise(0.03 + Math.random() * 0.035, {
            type: 'bandpass',
            freq: 900 + Math.random() * 1600,
            to: 400,
            q: 3,
            level: 0.03
          });
        }
      }

      /* One tick per stroke of the brush, pitched by material so the six
         tools are told apart by ear alone. The shape carries as much of
         that as the pitch does: stone is a hard short click low down, wood
         is resonant and mid, water is a falling blup, sand is a dry rustle
         at the top, fire is a wider crackle, and the eraser is a dull
         lowpassed brush stroke with no pitch to it at all.

         Levels sit near 0.03 rather than at the 0.07 ceiling because this
         one fires twelve times a second for as long as a drag lasts, and
         a sound that constant has to be quieter than a sound that is
         rare. */
      var TICK = {};
      TICK[SAND] = { type: 'bandpass', freq: 2400, to: 1600, q: 1.8, dur: 0.030, level: 0.030 };
      TICK[WATER] = { type: 'bandpass', freq: 800, to: 340, q: 5.0, dur: 0.055, level: 0.030 };
      TICK[WALL] = { type: 'bandpass', freq: 420, to: 260, q: 7.0, dur: 0.028, level: 0.032 };
      TICK[WOOD] = { type: 'bandpass', freq: 1150, to: 700, q: 6.0, dur: 0.045, level: 0.030 };
      TICK[FIRE] = { type: 'bandpass', freq: 1700, to: 900, q: 2.2, dur: 0.038, level: 0.030 };
      TICK[EMPTY] = { type: 'lowpass', freq: 300, to: 180, q: 1.0, dur: 0.045, level: 0.022 };

      function tick() {
        /* Twelve a second. A pointermove can arrive far more often than
           that on a trackpad, and one burst per event is a rattle. */
        if (!g.gate('brush', 0.083)) return;
        var s = TICK[tool];
        if (!s) return;
        /* Six per cent either way on the pitch. Fire the identical burst
           twelve times a second and the ear stops hearing sand and starts
           hearing one short recording being retriggered. */
        var wob = 0.94 + Math.random() * 0.12;
        g.noise(s.dur, {
          type: s.type,
          freq: s.freq * wob,
          to: s.to * wob,
          q: s.q,
          level: s.level
        });
      }

      function at(x, y) {
        if (x < 0 || x >= W || y < 0 || y >= H) return WALL;   // the world is boxed
        return grid[y * W + x];
      }
      function set(x, y, v) {
        if (x < 0 || x >= W || y < 0 || y >= H) return;
        grid[y * W + x] = v;
      }
      function swap(x1, y1, x2, y2) {
        var a = grid[y1 * W + x1];
        /* The entire input to the bed, taken here because here is where a
           cell demonstrably moved. Sand plunging through water counts as
           sand: a holds the cell the rule was written for, and the rush of
           the grain is what you hear over the water it displaced. Smoke
           and fire are counted by neither layer — a column of smoke
           drifting upward is silent, and letting it hold the hiss open
           would leave the toy whispering long after everything came to
           rest, which is exactly the failure this design exists to avoid. */
        if (a === SAND) movedGrain++;
        else if (a === WATER) movedWater++;
        grid[y1 * W + x1] = grid[y2 * W + x2];
        grid[y2 * W + x2] = a;
        var l = life[y1 * W + x1];
        life[y1 * W + x1] = life[y2 * W + x2];
        life[y2 * W + x2] = l;
      }

      function paintAt(px, py) {
        var cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
        for (var dy = -brush; dy <= brush; dy++) {
          for (var dx = -brush; dx <= brush; dx++) {
            if (dx * dx + dy * dy > brush * brush) continue;
            var x = cx + dx, y = cy + dy;
            if (x < 0 || x >= W || y < 0 || y >= H) continue;
            /* Powders are sparse when drawn, solids are not — a solid wall
               drawn at 60% density would leak. */
            if (tool === SAND || tool === WATER) { if (Math.random() < 0.65) set(x, y, tool); }
            else set(x, y, tool);
            if (tool === FIRE) life[y * W + x] = 40 + Math.floor(Math.random() * 40);
          }
        }
      }

      if (g.canvas) {
        var draw = function (event) {
          if (!drawing) return;
          var p = g.pointAt(event);
          /* Interpolate between samples, or a fast drag leaves dotted gaps. */
          if (lastPt) {
            var steps = Math.ceil(Math.max(Math.abs(p.x - lastPt.x), Math.abs(p.y - lastPt.y)) / (CELL * 0.8));
            for (var i = 0; i <= steps; i++) {
              var tt = steps ? i / steps : 0;
              paintAt(lastPt.x + (p.x - lastPt.x) * tt, lastPt.y + (p.y - lastPt.y) * tt);
            }
          } else paintAt(p.x, p.y);
          lastPt = p;
          tick();
        };
        g.canvas.addEventListener('pointerdown', function (e) { drawing = true; lastPt = null; draw(e); });
        g.canvas.addEventListener('pointermove', draw);
        g.canvas.addEventListener('pointerup', function () { drawing = false; lastPt = null; });
        g.canvas.addEventListener('pointerleave', function () { drawing = false; lastPt = null; });
      }

      function stepPhysics() {
        movedGrain = 0; movedWater = 0; burning = 0;
        /* Bottom-up. See the header. */
        for (var y = H - 1; y >= 0; y--) {
          /* Alternate the horizontal scan direction each row so piles do not
             lean consistently to the left. */
          var ltr = (y % 2) === 0;
          for (var k = 0; k < W; k++) {
            var x = ltr ? k : W - 1 - k;
            var v = grid[y * W + x];
            if (v === EMPTY || v === WALL || v === WOOD) continue;

            if (v === SAND) {
              if (at(x, y + 1) === EMPTY || at(x, y + 1) === WATER) { swap(x, y, x, y + 1); continue; }
              var dir = Math.random() < 0.5 ? -1 : 1;
              if (at(x + dir, y + 1) === EMPTY) { swap(x, y, x + dir, y + 1); continue; }
              if (at(x - dir, y + 1) === EMPTY) { swap(x, y, x - dir, y + 1); continue; }
              continue;
            }

            if (v === WATER) {
              if (at(x, y + 1) === EMPTY) { swap(x, y, x, y + 1); continue; }
              var d2 = Math.random() < 0.5 ? -1 : 1;
              if (at(x + d2, y + 1) === EMPTY) { swap(x, y, x + d2, y + 1); continue; }
              /* Sideways is what makes it level out instead of piling. */
              if (at(x + d2, y) === EMPTY) { swap(x, y, x + d2, y); continue; }
              if (at(x - d2, y) === EMPTY) { swap(x, y, x - d2, y); continue; }
              continue;
            }

            if (v === FIRE) {
              var i = y * W + x;
              if (--life[i] <= 0) { grid[i] = Math.random() < 0.4 ? SMOKE : EMPTY; life[i] = 60; continue; }
              burning++;
              /* Fire eats wood and is killed by water. */
              for (var dy = -1; dy <= 1; dy++) {
                for (var dx = -1; dx <= 1; dx++) {
                  var n = at(x + dx, y + dy);
                  if (n === WOOD && Math.random() < 0.06) {
                    set(x + dx, y + dy, FIRE);
                    life[(y + dy) * W + (x + dx)] = 40 + Math.floor(Math.random() * 40);
                  } else if (n === WATER) {
                    grid[i] = SMOKE; life[i] = 50;
                  }
                }
              }
              if (at(x, y - 1) === EMPTY && Math.random() < 0.3) swap(x, y, x, y - 1);
              continue;
            }

            if (v === SMOKE) {
              var si = y * W + x;
              if (--life[si] <= 0) { grid[si] = EMPTY; continue; }
              if (at(x, y - 1) === EMPTY) { swap(x, y, x, y - 1); continue; }
              var d3 = Math.random() < 0.5 ? -1 : 1;
              if (at(x + d3, y - 1) === EMPTY) swap(x, y, x + d3, y - 1);
            }
          }
        }
      }

      return {
        reset: function () {
          grid = new Uint8Array(W * H);
          life = new Uint8Array(W * H);
          /* A little scenery so the toy is not a blank rectangle. */
          for (var x = 30; x < 130; x++) set(x, 92, WALL);
          for (var w = 60; w < 100; w++) { set(w, 91, WOOD); set(w, 90, WOOD); }
          for (var s = 0; s < 2200; s++) set(50 + Math.floor(Math.random() * 60), Math.floor(Math.random() * 25), SAND);

          /* A restart must not inherit the hiss of the run before it, so
             the bed is told silence outright rather than being left to
             decay into it over the next quarter second. The opening pile
             then fades the layer up from nothing, which is what a pile
             starting to fall actually sounds like. */
          movedGrain = 0; movedWater = 0; burning = 0;
          grainLevel = 0; waterLevel = 0;
          sentGrain = 0; sentWater = 0;
          flow.set('grain', 0);
          flow.set('water', 0);
        },

        update: function () { stepPhysics(); hear(); },

        draw: function (ctx) {
          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, W * CELL, H * CELL);
          for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
              var v = grid[y * W + x];
              if (!v) continue;
              ctx.fillStyle = TINT[v];
              ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
            }
          }
        }
      };
    }
  });
})();

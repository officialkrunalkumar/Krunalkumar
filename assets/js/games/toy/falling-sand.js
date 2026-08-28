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
        };
        g.canvas.addEventListener('pointerdown', function (e) { drawing = true; lastPt = null; draw(e); });
        g.canvas.addEventListener('pointermove', draw);
        g.canvas.addEventListener('pointerup', function () { drawing = false; lastPt = null; });
        g.canvas.addEventListener('pointerleave', function () { drawing = false; lastPt = null; });
      }

      function stepPhysics() {
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
        },

        update: function () { stepPhysics(); },

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

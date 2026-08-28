/* ==========================================================================
   cmatrix.js — the falling glyph rain.
   --------------------------------------------------------------------------
   One column, one raindrop: a head position, a speed, and a trail length.
   The trail is drawn by walking back up from the head and fading, which is
   why it costs nothing — there is no history buffer, only arithmetic.

   The characters do not fall. Each cell holds a glyph that only changes
   occasionally; what moves is the bright head, and the illusion of falling
   text comes from the trail sweeping over cells whose contents were already
   there. That is how the original does it, and it is the difference between
   a screensaver and a scrolling buffer.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 80;
  var ROWS = 26;
  var GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>¦｜';

  TermShell.define({
    id: 'game-cmatrix',
    slug: 'cmatrix',
    title: 'cmatrix',
    cols: COLS,
    rows: ROWS,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g, t) {
      var drops = [];
      var cells = [];           // the glyph sitting in each cell
      var speedMul = 1;

      var speedSel = document.getElementById('game-speed');
      if (speedSel) {
        speedMul = Number(speedSel.value) || 1;
        speedSel.addEventListener('change', function () { speedMul = Number(speedSel.value) || 1; });
      }

      function glyph() { return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)); }

      function seedDrop(col, above) {
        return {
          col: col,
          y: above ? -Math.random() * ROWS * 1.6 : Math.random() * -ROWS,
          v: 6 + Math.random() * 16,
          len: 6 + Math.floor(Math.random() * 16)
        };
      }

      return {
        reset: function () {
          cells = [];
          for (var i = 0; i < COLS * ROWS; i++) cells.push(glyph());
          drops = [];
          for (var c = 0; c < COLS; c++) {
            /* Not every column has a drop at once — a solid wall of rain
               reads as static rather than as weather. */
            if (Math.random() < 0.62) drops.push(seedDrop(c, false));
          }
        },

        update: function (dt) {
          g.stat('drops', drops.length);
          for (var i = 0; i < drops.length; i++) {
            var d = drops[i];
            d.y += d.v * speedMul * dt;
            if (d.y - d.len > ROWS) {
              drops[i] = seedDrop(d.col, true);
            }
          }
          /* A few cells mutate every frame, so the field shimmers without
             the whole screen churning. */
          var churn = Math.ceil(COLS * ROWS * 0.012);
          for (var k = 0; k < churn; k++) {
            cells[Math.floor(Math.random() * cells.length)] = glyph();
          }
        },

        draw: function (term) {
          term.clear();
          for (var i = 0; i < drops.length; i++) {
            var d = drops[i];
            var head = Math.floor(d.y);
            for (var n = 0; n < d.len; n++) {
              var y = head - n;
              if (y < 0 || y >= ROWS) continue;
              var ch = cells[y * COLS + d.col];
              /* The head is white, the first few behind it bright, the tail
                 dim. Three bands is enough — a smooth gradient in a
                 sixteen-colour terminal was never the look. */
              var tint = n === 0 ? 'white' : n < d.len * 0.35 ? 'green' : 'dim';
              term.put(d.col, y, ch, tint);
            }
          }
        }
      };
    }
  });
})();

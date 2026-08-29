/* ==========================================================================
   term-shell.js — a character grid, for the terminal games.
   --------------------------------------------------------------------------
   moon-buggy, bastet, greed, robots, ninvaders and the rest were all written
   for a VT100: eighty columns, twenty-four rows, one character per cell, no
   pixels anywhere. Rebuilding each of them as a pixel game would throw away
   the thing that makes them what they are, and would mean every one of them
   reinventing text layout on a canvas.

   So this sits between game-shell.js and those games and gives them the
   machine they were written for: put(x, y, char, colour), and nothing else.
   A game here never touches a coordinate that is not a cell.

   WHY A CANVAS AND NOT A GRID OF <span>s
   A DOM character grid is 1,920 elements being restyled sixty times a
   second, which is exactly the workload the DOM is worst at. A canvas draws
   only the cells that are not blank — on a typical frame that is a couple of
   hundred fillText calls — and it inherits the shell's fullscreen fitting,
   its device-pixel handling and its fixed timestep for free.

   THE PALETTE IS FIXED AND DOES NOT FOLLOW THE THEME. #020617 ground,
   #86efac phosphor, the same values terminal.html and the lab terminals
   use, hard-coded for the same reason labs.css states at length: this is a
   screen being depicted, and a screen does not turn white because the page
   around it did.

   Cells are 8 x 16 logical units, so an 80x24 grid is 640x384 — a 5:3 box
   that fits a laptop and a phone in landscape without letterboxing to
   nothing. Games may ask for other sizes; moon-buggy is wider and shorter.
   ========================================================================== */

(function (root) {
  'use strict';

  var CW = 8;             // logical units per character cell, horizontally
  var CH = 16;            // and vertically

  /* The sixteen-colour palette every one of these games was written
     against, mapped to values that survive on this site's ground. Games
     name a colour, never a hex — so a future palette change is one edit
     here rather than thirty. */
  var COLORS = {
    green: '#86efac',     // the default phosphor
    /* Dim is still readable on the #020617 ground: the old #3f6b52
       measured 3.30:1 and the games put real content in dim — help
       lines, menus, inventory — so it has to clear WCAG's 4.5:1 for
       body text. #508a60 measures 4.94:1 and still reads as the quiet
       register next to the phosphor. Mirrored by hub.js's thumbnail
       painter (its local DIM), which must change with this. */
    dim: '#508a60',
    white: '#f8fafc',
    grey: '#94a3b8',
    dark: '#475569',
    red: '#f87171',
    yellow: '#fde047',
    blue: '#7dd3fc',
    cyan: '#67e8f9',
    magenta: '#f0abfc',
    orange: '#fb923c',
    brown: '#a16207'
  };

  function Term(g, cols, rows) {
    this.g = g;
    this.cols = cols;
    this.rows = rows;
    this.chars = [];
    this.colors = [];
    this.clear();
  }

  Term.prototype.clear = function (ch, color) {
    var n = this.cols * this.rows;
    for (var i = 0; i < n; i++) {
      this.chars[i] = ch || ' ';
      this.colors[i] = color || 'green';
    }
  };

  Term.prototype.put = function (x, y, ch, color) {
    x = x | 0; y = y | 0;
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
    var i = y * this.cols + x;
    this.chars[i] = ch;
    this.colors[i] = color || 'green';
  };

  Term.prototype.at = function (x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return ' ';
    return this.chars[y * this.cols + x];
  };

  Term.prototype.text = function (x, y, str, color) {
    str = String(str);
    for (var i = 0; i < str.length; i++) this.put(x + i, y, str.charAt(i), color);
  };

  /* Centred text, which every one of these games wants for its title and
     its game-over line. */
  Term.prototype.centre = function (y, str, color) {
    this.text(Math.floor((this.cols - String(str).length) / 2), y, str, color);
  };

  Term.prototype.rect = function (x, y, w, h, ch, color) {
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) this.put(x + i, y + j, ch, color);
    }
  };

  /* A single-line box, in the box-drawing characters these games used. */
  Term.prototype.box = function (x, y, w, h, color) {
    this.put(x, y, '┌', color);
    this.put(x + w - 1, y, '┐', color);
    this.put(x, y + h - 1, '└', color);
    this.put(x + w - 1, y + h - 1, '┘', color);
    for (var i = 1; i < w - 1; i++) {
      this.put(x + i, y, '─', color);
      this.put(x + i, y + h - 1, '─', color);
    }
    for (var j = 1; j < h - 1; j++) {
      this.put(x, y + j, '│', color);
      this.put(x + w - 1, y + j, '│', color);
    }
  };

  /* Paint the buffer. Blank cells are skipped, which is most of them. */
  Term.prototype.render = function (ctx) {
    var W = this.cols * CW;
    var H = this.rows * CH;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);

    /* A faint scanline wash. Two lines of code, and it is the difference
       between "monospace text on black" and "a terminal". */
    ctx.fillStyle = 'rgba(134, 239, 172, 0.028)';
    for (var s = 0; s < H; s += 4) ctx.fillRect(0, s, W, 1);

    ctx.font = '600 ' + (CH - 3) + 'px "Cascadia Code", "Fira Code", Consolas, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* Grouped by colour so the fillStyle is set a dozen times a frame
       rather than nineteen hundred. */
    var buckets = {};
    for (var i = 0; i < this.chars.length; i++) {
      var ch = this.chars[i];
      if (ch === ' ' || ch === undefined) continue;
      var key = this.colors[i] || 'green';
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(i);
    }

    for (var name in buckets) {
      if (!Object.prototype.hasOwnProperty.call(buckets, name)) continue;
      ctx.fillStyle = COLORS[name] || name;
      var list = buckets[name];
      for (var k = 0; k < list.length; k++) {
        var idx = list[k];
        var x = (idx % this.cols) * CW + CW / 2;
        var y = Math.floor(idx / this.cols) * CH + CH / 2 + 1;
        ctx.fillText(this.chars[idx], x, y);
      }
    }
  };

  /* ==================================================================
     define() — the same shape as GameShell.define, with a Term handed
     to setup() instead of raw pixels.
     ================================================================== */
  var TermShell = {
    COLORS: COLORS,

    define: function (spec) {
      var cols = spec.cols || 80;
      var rows = spec.rows || 24;

      root.GameShell.define({
        id: spec.id,
        slug: spec.slug,
        title: spec.title,
        width: cols * CW,
        height: rows * CH,
        pixel: false,
        rawInput: spec.rawInput,
        autoStart: spec.autoStart,
        bestKey: spec.bestKey,
        bestOrder: spec.bestOrder,
        formatBest: spec.formatBest,
        startTitle: spec.startTitle,
        startText: spec.startText,
        pauseOnBlur: spec.pauseOnBlur,
        /* Tap behaviour has to be forwarded like everything else on this list.
           It was not, and the omission was invisible in the source of every
           terminal game: they set the option, this dropped it, and the shell
           saw undefined and bound its default.

           The results were not subtle. Moon buggy asks for tapKey: 'up' so a
           thumb JUMPS; the default fired the laser instead, while the on-screen
           hint promised a jump. Hangman and adventure set tapAction: false and
           print that promise in their own copy — "a tap on the screen does
           nothing, so a stray thumb cannot cost you a guess" — and a tap spent
           a guess on the highlighted letter anyway. */
        tapAction: spec.tapAction,
        tapKey: spec.tapKey,

        setup: function (g) {
          var term = new Term(g, cols, rows);
          var hooks = spec.setup(g, term) || {};

          return {
            reset: hooks.reset,
            key: hooks.key,
            release: hooks.release,
            update: hooks.update,
            ended: hooks.ended,
            ready: hooks.ready,

            /* The game fills the buffer; this paints it. A game that wants
               to draw nothing but text never sees a canvas context. */
            draw: function (ctx) {
              if (hooks.draw) hooks.draw(term);
              term.render(ctx);
            }
          };
        }
      });
    }
  };

  root.TermShell = TermShell;
})(typeof self !== 'undefined' ? self : this);

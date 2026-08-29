/* ==========================================================================
   hub.js — the /games hub: type-to-filter, category chips, personal bests,
   and the little painted tile on every card.
   --------------------------------------------------------------------------
   lab-filter.js does the first of those four for /labs and this deliberately
   matches its behaviour — same debounce, same live count, same empty state
   pointing at the site-wide search. It is not shared code because the two
   pages disagree about what a card is: a lab card is text, a game card has a
   thumbnail and a best score, and folding both into one file would mean a
   parameter for every difference.

   THE TILES ARE PAINTED, NOT SHIPPED. Twenty-six screenshots would be about
   a megabyte of JPEG in a repository that currently holds no game art at
   all, and they would go stale the first time a palette changed. Each tile
   here is a dozen lines of canvas drawn from the same colours the game
   itself uses, costs nothing to store, and is redrawn correctly if the
   theme or the palette ever moves.

   The markup ships with a glyph tile already in it (see games.css), and the
   canvas is inserted BEFORE that glyph rather than replacing it. So a
   visitor with no JavaScript, a failed 2D context, or a very slow first
   paint sees a complete card at every moment — never an empty frame.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. Thumbnails
     ------------------------------------------------------------------
     Each painter draws into a 160x90 logical box. Keep them cheap: this
     runs once per card on a page that may hold thirty of them.
     ------------------------------------------------------------------ */
  var W = 160;
  var H = 90;

  function bg(ctx, tint) {
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(' + tint + ',0.16)');
    g.addColorStop(1, 'rgba(' + tint + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  var PAINT = {
    snake: function (ctx) {
      bg(ctx, '129,199,132');
      /* A short snake mid-turn, and the apple it is going for. Drawn on an
         8px grid so it reads as the same game the page runs. */
      var body = [[4, 6], [5, 6], [6, 6], [7, 6], [7, 5], [7, 4], [8, 4], [9, 4]];
      ctx.fillStyle = '#4ade80';
      for (var i = 0; i < body.length; i++) {
        ctx.fillRect(body[i][0] * 8 + 20, body[i][1] * 8 + 8, 7, 7);
      }
      ctx.fillStyle = '#86efac';
      ctx.fillRect(body[body.length - 1][0] * 8 + 20, body[body.length - 1][1] * 8 + 8, 7, 7);
      ctx.fillStyle = '#f87171';
      ctx.fillRect(13 * 8 + 20, 2 * 8 + 8, 7, 7);
    },

    tetris: function (ctx) {
      bg(ctx, '125,211,252');
      var cols = ['#38bdf8', '#a78bfa', '#fbbf24', '#4ade80', '#f87171'];
      /* A settled floor with one gap, and an S-piece on the way down. */
      var floor = [1, 1, 1, 0, 1, 1, 1, 1];
      for (var x = 0; x < 8; x++) {
        if (!floor[x]) continue;
        ctx.fillStyle = cols[x % cols.length];
        ctx.fillRect(44 + x * 9, 70, 8, 8);
        if (x % 3 === 0) ctx.fillRect(44 + x * 9, 61, 8, 8);
      }
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(62, 22, 8, 8);
      ctx.fillRect(71, 22, 8, 8);
      ctx.fillRect(71, 31, 8, 8);
      ctx.fillRect(80, 31, 8, 8);
    },

    breakout: function (ctx) {
      bg(ctx, '129,199,132');
      var rows = ['#f87171', '#fbbf24', '#4ade80'];
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 7; c++) {
          if (r === 0 && c === 3) continue;   // one already broken
          ctx.fillStyle = rows[r];
          ctx.globalAlpha = 0.9;
          ctx.fillRect(18 + c * 18, 16 + r * 10, 16, 8);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#7dd3fc';
      ctx.fillRect(64, 76, 32, 5);
      ctx.beginPath();
      ctx.arc(86, 60, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fill();
    },

    '2048': function (ctx) {
      bg(ctx, '125,211,252');
      var tiles = [[2, '#334155'], [4, '#3f5170'], [8, '#f59e0b'], [16, '#f97316']];
      for (var i = 0; i < 4; i++) {
        var x = 34 + (i % 2) * 46;
        var y = 16 + Math.floor(i / 2) * 32;
        ctx.fillStyle = tiles[i][1];
        ctx.fillRect(x, y, 42, 28);
        ctx.fillStyle = i > 1 ? '#0f172a' : '#e2e8f0';
        ctx.font = 'bold 15px "Cascadia Code", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(tiles[i][0]), x + 21, y + 15);
      }
    },

    minesweeper: function (ctx) {
      bg(ctx, '125,211,252');
      var nums = ['', '1', '2', '', '1', '', '', '3', ''];
      var colours = { '1': '#60a5fa', '2': '#4ade80', '3': '#f87171' };
      for (var i = 0; i < 9; i++) {
        var x = 46 + (i % 3) * 24;
        var y = 12 + Math.floor(i / 3) * 24;
        var open = nums[i] !== '' || i === 3;
        ctx.fillStyle = open ? '#1e293b' : '#334155';
        ctx.fillRect(x, y, 22, 22);
        if (nums[i]) {
          ctx.fillStyle = colours[nums[i]] || '#e2e8f0';
          ctx.font = 'bold 14px "Cascadia Code", Consolas, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(nums[i], x + 11, y + 12);
        }
      }
      /* One flag, so the tile says "minesweeper" and not "a grid". */
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.moveTo(96, 62); ctx.lineTo(108, 67); ctx.lineTo(96, 72);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(95, 62, 2, 16);
    },

    'typing-trainer': function (ctx) {
      bg(ctx, '196,149,248');
      /* Three lines of "text": the typed part bright, the rest dim, with a
         caret. Bars rather than glyphs so it reads at 160px wide. */
      var lines = [[10, 92], [10, 120], [10, 60]];
      for (var i = 0; i < lines.length; i++) {
        var y = 30 + i * 14;
        ctx.fillStyle = 'rgba(148,163,184,0.35)';
        ctx.fillRect(24, y, lines[i][1], 6);
        if (i === 0) { ctx.fillStyle = '#c084fc'; ctx.fillRect(24, y, 58, 6); }
      }
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(84, 27, 2, 12);
      ctx.fillStyle = '#c084fc';
      ctx.font = 'bold 13px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('72 wpm', 24, 20);
    },

    /* The terminal tiles share a ground and a font so the category reads as
       one machine on the hub, the way the games themselves do. */
    'moon-buggy': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#94a3b8';
      var ground = '____________       _________';
      ctx.fillText(ground, 12, 62);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('############       #########', 12, 70);
      ctx.fillStyle = '#86efac';
      ctx.fillText('  ___  ', 20, 38);
      ctx.fillText(' /---\\ ', 20, 46);
      ctx.fillStyle = '#fde047';
      ctx.fillText('O-----O', 20, 54);
      ctx.fillStyle = '#fb923c';
      ctx.fillText('^', 118, 54);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('. ', 130, 22);
      ctx.fillText('.', 40, 18);
    },

    bastet: function (ctx) {
      bg(ctx, '248,113,113');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      /* A well with an S-piece coming, which is the joke. */
      ctx.fillStyle = '#3f6b52';
      for (var r = 0; r < 6; r++) ctx.fillText('|                  |', 44, 22 + r * 10);
      ctx.fillStyle = '#4ade80';
      ctx.fillText('  [][]', 46, 30);
      ctx.fillText('[][]  ', 46, 38);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('[][]    [][][]', 46, 72);
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 10px "Cascadia Code", Consolas, monospace';
      ctx.fillText('worst', 108, 40);
      ctx.fillText('piece', 108, 52);
    },

    greed: function (ctx) {
      bg(ctx, '125,211,252');
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var rows = ['3 7 1 4 9 2', '8 2 @ 6 1 5', '1 9 4 3 7 2', '5 3 8 1 4 9'];
      var tint = ['#3f6b52', '#86efac', '#67e8f9', '#fde047'];
      for (var i = 0; i < rows.length; i++) {
        ctx.fillStyle = tint[i % tint.length];
        ctx.fillText(rows[i], 34, 26 + i * 15);
      }
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('@', 68, 41);
    },

    robots: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '11px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var grid = [
        '+  +   *  +',
        '  *   @    ',
        '+   *   +  '
      ];
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < grid[r].length; c++) {
          var ch = grid[r].charAt(c);
          if (ch === ' ') continue;
          ctx.fillStyle = ch === '@' ? '#f8fafc' : ch === '*' ? '#475569' : '#f87171';
          ctx.fillText(ch, 32 + c * 9, 30 + r * 16);
        }
      }
      ctx.fillStyle = '#3f6b52';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillText('they cannot steer', 80, 76);
    },

    typespeed: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      var words = [['chmod', 14, 20], ['iptables', 30, 34], ['grep', 52, 48], ['nonce', 20, 62]];
      for (var i = 0; i < words.length; i++) {
        ctx.fillStyle = i === 2 ? '#fde047' : '#86efac';
        ctx.fillText(words[i][0], words[i][1], words[i][2]);
      }
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(132, 10); ctx.lineTo(132, 72); ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('> gre_', 14, 80);
    },

    ninvaders: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '11px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var rows = [['W', '#f0abfc'], ['M', '#f87171'], ['X', '#fde047']];
      for (var r = 0; r < rows.length; r++) {
        ctx.fillStyle = rows[r][1];
        for (var c = 0; c < 7; c++) ctx.fillText(rows[r][0], 38 + c * 13, 20 + r * 13);
      }
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('|', 80, 60);
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('/A\\', 80, 74);
    },

    wumpus: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f87171';
      ctx.fillText('You smell something', 16, 22);
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('You feel a draught', 16, 38);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('rooms 3  11  19', 16, 58);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('> ', 16, 74);
      ctx.fillStyle = '#fde047';
      ctx.fillText('shoot 11', 28, 74);
    },

    'game-of-life': function (ctx) {
      bg(ctx, '196,149,248');
      /* A glider plus a block, on a visible lattice. */
      ctx.fillStyle = '#86efac';
      var cells = [[4, 1], [5, 2], [3, 3], [4, 3], [5, 3], [10, 4], [11, 4], [10, 5], [11, 5],
                   [14, 1], [15, 2], [13, 3], [14, 3], [15, 3]];
      for (var i = 0; i < cells.length; i++) {
        ctx.fillRect(18 + cells[i][0] * 7, 12 + cells[i][1] * 7, 6, 6);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.12)';
      ctx.lineWidth = 0.5;
      for (var x = 0; x <= 20; x++) { ctx.beginPath(); ctx.moveTo(18 + x * 7, 12); ctx.lineTo(18 + x * 7, 68); ctx.stroke(); }
      for (var y = 0; y <= 8; y++) { ctx.beginPath(); ctx.moveTo(18, 12 + y * 7); ctx.lineTo(158, 12 + y * 7); ctx.stroke(); }
      ctx.fillStyle = '#c084fc';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('gen 1204', 18, 80);
    },

    'falling-sand': function (ctx) {
      bg(ctx, '196,149,248');
      /* A sand pile over water, with a wall holding it. */
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(20, 62, 120, 14);
      ctx.fillStyle = '#e0b866';
      for (var i = 0; i < 320; i++) {
        var t = Math.random();
        var w = 46 * (1 - t);
        ctx.fillRect(80 + (Math.random() - 0.5) * w * 2, 62 - t * 34, 3, 3);
      }
      ctx.fillStyle = '#64748b';
      ctx.fillRect(20, 76, 120, 5);
      ctx.fillStyle = '#f97316';
      for (var f = 0; f < 16; f++) ctx.fillRect(124 + Math.random() * 12, 44 + Math.random() * 16, 3, 3);
    },

    boids: function (ctx) {
      bg(ctx, '196,149,248');
      /* A loose flock, all pointing roughly one way, tinted by heading. */
      for (var i = 0; i < 34; i++) {
        var a = -0.45 + (Math.random() - 0.5) * 0.5;
        var x = 16 + Math.random() * 130;
        var y = 18 + Math.random() * 56;
        var hue = Math.round(((a + Math.PI) / (Math.PI * 2)) * 300 + 160) % 360;
        ctx.fillStyle = 'hsl(' + hue + ', 80%, 68%)';
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
        ctx.lineTo(x + Math.cos(a + 2.5) * 4, y + Math.sin(a + 2.5) * 4);
        ctx.lineTo(x + Math.cos(a - 2.5) * 4, y + Math.sin(a - 2.5) * 4);
        ctx.closePath();
        ctx.fill();
      }
    },

    ludo: function (ctx) {
      bg(ctx, '250,204,21');
      var s = 74, ox = 43, oy = 8;
      var cell = s / 15;
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(ox, oy, s, s);
      /* Four yards, then the cross of the track. */
      var yards = [[0, 9, '#7f1d1d'], [0, 0, '#14532d'], [9, 0, '#78350f'], [9, 9, '#075985']];
      for (var i = 0; i < yards.length; i++) {
        ctx.fillStyle = yards[i][2];
        ctx.fillRect(ox + yards[i][0] * cell, oy + yards[i][1] * cell, 6 * cell, 6 * cell);
      }
      ctx.fillStyle = '#141f33';
      ctx.fillRect(ox + 6 * cell, oy, 3 * cell, s);
      ctx.fillRect(ox, oy + 6 * cell, s, 3 * cell);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(ox + 6 * cell, oy + 6 * cell, 3 * cell, 3 * cell);
      var toks = [[2.5, 11.5, '#f87171'], [4.5, 11.5, '#f87171'], [10.5, 2.5, '#fbbf24'], [7.5, 3.5, '#4ade80']];
      for (var t = 0; t < toks.length; t++) {
        ctx.beginPath();
        ctx.arc(ox + toks[t][0] * cell, oy + toks[t][1] * cell, cell * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = toks[t][2];
        ctx.fill();
      }
    },

    chess: function (ctx) {
      bg(ctx, '250,204,21');
      var s = 15;
      var ox = 45, oy = 8;
      for (var r = 0; r < 5; r++) {
        for (var f = 0; f < 5; f++) {
          ctx.fillStyle = ((r + f) % 2) === 0 ? '#8ca0b8' : '#41546e';
          ctx.fillRect(ox + f * s, oy + r * s, s, s);
        }
      }
      ctx.font = '13px "Segoe UI Symbol", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var men = [['♜', 0, 0, '#0f172a'], ['♞', 2, 0, '#0f172a'], ['♟', 1, 1, '#0f172a'],
                 ['♙', 3, 3, '#f8fafc'], ['♘', 1, 4, '#f8fafc'], ['♔', 3, 4, '#f8fafc']];
      for (var i = 0; i < men.length; i++) {
        ctx.fillStyle = men[i][3];
        ctx.fillText(men[i][0], ox + men[i][1] * s + s / 2, oy + men[i][2] * s + s / 2 + 1);
      }
      ctx.fillStyle = '#fde047';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillText('minimax', 80, 82);
    },

    carrom: function (ctx) {
      bg(ctx, '250,204,21');
      ctx.fillStyle = '#d8b483';
      ctx.fillRect(38, 8, 84, 74);
      ctx.strokeStyle = 'rgba(90,60,30,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(80, 45, 20, 0, Math.PI * 2); ctx.stroke();
      var corners = [[44, 14], [116, 14], [44, 76], [116, 76]];
      for (var i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(corners[i][0], corners[i][1], 6, 0, Math.PI * 2);
        ctx.fillStyle = '#160d06'; ctx.fill();
      }
      var coins = [[80, 45, '#b91c1c'], [72, 38, '#f5f0e6'], [88, 38, '#2b2b2b'],
                   [72, 52, '#2b2b2b'], [88, 52, '#f5f0e6'], [80, 32, '#f5f0e6']];
      for (var c = 0; c < coins.length; c++) {
        ctx.beginPath(); ctx.arc(coins[c][0], coins[c][1], 5, 0, Math.PI * 2);
        ctx.fillStyle = coins[c][2]; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(80, 70, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8'; ctx.fill();
    },

    'air-hockey': function (ctx) {
      bg(ctx, '129,199,132');
      ctx.fillStyle = '#123047';
      ctx.fillRect(52, 6, 56, 78);
      ctx.strokeStyle = 'rgba(125,211,252,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(52, 45); ctx.lineTo(108, 45); ctx.stroke();
      ctx.beginPath(); ctx.arc(80, 45, 13, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#020617';
      ctx.fillRect(66, 6, 28, 4); ctx.fillRect(66, 80, 28, 4);
      ctx.beginPath(); ctx.arc(80, 22, 8, 0, Math.PI * 2); ctx.fillStyle = '#f87171'; ctx.fill();
      ctx.beginPath(); ctx.arc(74, 68, 8, 0, Math.PI * 2); ctx.fillStyle = '#4ade80'; ctx.fill();
      ctx.beginPath(); ctx.arc(86, 52, 4, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill();
    },

    'tux-racer': function (ctx) {
      var sky = ctx.createLinearGradient(0, 0, 0, 34);
      sky.addColorStop(0, '#0b1220'); sky.addColorStop(1, '#1e3a5f');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 160, 34);
      ctx.fillStyle = '#e8f1ff'; ctx.fillRect(0, 34, 160, 56);
      /* The piste as a trapezium, narrowing to the horizon. */
      ctx.fillStyle = '#f7fbff';
      ctx.beginPath();
      ctx.moveTo(10, 90); ctx.lineTo(64, 34); ctx.lineTo(96, 34); ctx.lineTo(150, 90);
      ctx.closePath(); ctx.fill();
      var trees = [[42, 66, 12], [124, 72, 14], [66, 44, 6], [98, 46, 6]];
      for (var i = 0; i < trees.length; i++) {
        ctx.fillStyle = '#14532d';
        ctx.beginPath();
        ctx.moveTo(trees[i][0], trees[i][1] - trees[i][2] * 1.5);
        ctx.lineTo(trees[i][0] - trees[i][2] * 0.45, trees[i][1]);
        ctx.lineTo(trees[i][0] + trees[i][2] * 0.45, trees[i][1]);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#fb923c';
      ctx.beginPath(); ctx.ellipse(92, 62, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath(); ctx.ellipse(80, 78, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.ellipse(80, 80, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.ellipse(80, 71, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    },

    'phishing-or-not': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('from:', 14, 20);
      ctx.fillStyle = '#f87171';
      ctx.fillText('paypal-account-verify.com', 46, 20);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('Unusual sign-in blocked', 14, 38);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('confirm within 24 hours', 14, 52);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(44, 13, 100, 11);
      ctx.fillStyle = '#fb923c';
      ctx.font = 'bold 10px "Cascadia Code", Consolas, monospace';
      ctx.fillText('phish?', 14, 74);
    },

    'password-duel': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '11px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('P@ssw0rd2024', 80, 22);
      ctx.font = 'bold 22px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#fca5a5';
      ctx.fillText('1,482,905', 80, 48);
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('guesses', 80, 64);
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 10px "Segoe UI", sans-serif';
      ctx.fillText('CRACKED', 80, 80);
    },

    'subnet-sprint': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('hosts in a /26 ?', 80, 24);
      ctx.font = 'bold 26px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#86efac';
      ctx.fillText('62', 80, 50);
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#fb923c';
      ctx.fillText('1:47', 80, 74);
    },

    cmatrix: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var glyphs = 'ｱｲｳｴｵｶｷｸ0179:.=*+';
      for (var c = 0; c < 16; c++) {
        var head = 8 + Math.random() * 74;
        var len = 5 + Math.floor(Math.random() * 9);
        for (var n = 0; n < len; n++) {
          var y = head - n * 8;
          if (y < 4 || y > 86) continue;
          ctx.fillStyle = n === 0 ? '#f8fafc' : n < 3 ? '#86efac' : '#3f6b52';
          ctx.fillText(glyphs.charAt(Math.floor(Math.random() * glyphs.length)), 8 + c * 10, y);
        }
      }
    },

    pipes: function (ctx) {
      bg(ctx, '196,149,248');
      ctx.font = '11px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var tint = ['#86efac', '#67e8f9', '#7dd3fc', '#f0abfc'];
      var runs = [
        ['─────┐', 14, 22, 0], ['┌──┘', 62, 36, 1],
        ['│', 100, 50, 1], ['└────┐', 100, 64, 2], ['──┘', 30, 78, 3]
      ];
      for (var i = 0; i < runs.length; i++) {
        ctx.fillStyle = tint[runs[i][3]];
        var str = runs[i][0];
        for (var c = 0; c < str.length; c++) ctx.fillText(str.charAt(c), runs[i][1] + c * 8, runs[i][2]);
      }
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('●', 54, 78);
    },

    cbonsai: function (ctx) {
      bg(ctx, '196,149,248');
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var trunk = [[80, 74], [80, 66], [79, 58], [81, 50], [80, 42]];
      ctx.fillStyle = '#a16207';
      for (var i = 0; i < trunk.length; i++) ctx.fillText('|', trunk[i][0], trunk[i][1]);
      ctx.fillText('/', 72, 46); ctx.fillText('\\', 88, 46);
      ctx.fillText('/', 66, 38); ctx.fillText('\\', 94, 38);
      ctx.fillStyle = '#86efac';
      var leaves = [[60, 30], [70, 26], [80, 24], [90, 26], [100, 30], [64, 36], [96, 36], [74, 18], [86, 18]];
      for (var l = 0; l < leaves.length; l++) {
        ctx.fillStyle = l % 4 === 0 ? '#67e8f9' : '#86efac';
        ctx.fillText(l % 2 ? '&' : '*', leaves[l][0], leaves[l][1]);
      }
      ctx.fillStyle = '#3f6b52';
      ctx.fillText(':___________:', 80, 82);
    },

    'personality-test': function (ctx) {
      bg(ctx, '244,114,182');
      var rows = [['Openness', 0.78], ['Conscientious', 0.61], ['Extraversion', 0.34], ['Agreeable', 0.55]];
      ctx.font = '8px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (var i = 0; i < rows.length; i++) {
        var y = 20 + i * 17;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(rows[i][0], 12, y);
        ctx.fillStyle = 'rgba(148,163,184,0.25)';
        ctx.fillRect(74, y - 4, 72, 8);
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(74, y - 4, 72 * rows[i][1], 8);
      }
    },

    'cyber-hygiene': function (ctx) {
      bg(ctx, '244,114,182');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      /* A dial, three-quarters round. */
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(80, 54, 30, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
      ctx.strokeStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(80, 54, 30, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * 0.62); ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 20px "Cascadia Code", Consolas, monospace';
      ctx.fillText('62%', 80, 54);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillText('soft in places', 80, 84);
    },

    'reaction-time': function (ctx) {
      ctx.fillStyle = '#16a34a';
      ctx.fillRect(0, 0, 160, 90);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 26px "Segoe UI", sans-serif';
      ctx.fillText('NOW', 80, 40);
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = 'rgba(248,250,252,0.85)';
      ctx.fillText('213 · 247 · 198 ms', 80, 70);
    },

    'rock-paper-scissors': function (ctx) {
      bg(ctx, '244,114,182');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '26px "Segoe UI Symbol", "Segoe UI Emoji", sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('✊', 46, 38);
      ctx.fillText('✋', 114, 38);
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('you', 46, 60);
      ctx.fillText('it', 114, 60);
      ctx.fillStyle = '#fde047';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillText('it expected rock', 80, 80);
    },

    'aim-trainer': function (ctx) {
      bg(ctx, '244,114,182');
      ctx.strokeStyle = 'rgba(148,163,184,0.1)';
      ctx.lineWidth = 0.5;
      for (var x = 0; x < 160; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 90); ctx.stroke(); }
      for (var y = 0; y < 90; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(160, y); ctx.stroke(); }
      var r = 17;
      ctx.beginPath(); ctx.arc(96, 40, r, 0, Math.PI * 2); ctx.fillStyle = '#f87171'; ctx.fill();
      ctx.beginPath(); ctx.arc(96, 40, r * 0.62, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill();
      ctx.beginPath(); ctx.arc(96, 40, r * 0.28, 0, Math.PI * 2); ctx.fillStyle = '#f87171'; ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('18/30  misses 2', 10, 80);
    },

    'memory-span': function (ctx) {
      bg(ctx, '244,114,182');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 40px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('7', 80, 40);
      ctx.font = '13px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('4 9 2 · · ·', 80, 72);
      ctx.font = '8px "Segoe UI", sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('length 6', 80, 16);
    },

    'connect-four': function (ctx) {
      bg(ctx, '125,211,252');
      ctx.fillStyle = '#1d4ed8';
      ctx.fillRect(30, 16, 100, 68);
      var grid = [
        '.......',
        '.......',
        '...y...',
        '..ry...',
        '.yrry..',
        'rryrry.'
      ];
      for (var r = 0; r < grid.length; r++) {
        for (var c = 0; c < 7; c++) {
          var ch = grid[r].charAt(c);
          ctx.beginPath();
          ctx.arc(37 + c * 14, 23 + r * 11, 4.6, 0, Math.PI * 2);
          ctx.fillStyle = ch === 'r' ? '#f87171' : ch === 'y' ? '#fbbf24' : '#0b1220';
          ctx.fill();
        }
      }
    },

    sudoku: function (ctx) {
      bg(ctx, '125,211,252');
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(44, 8, 72, 72);
      var cells = ['5.3', '.7.', '9.1'];
      ctx.font = 'bold 13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) {
          var ch = cells[r].charAt(c);
          if (ch === '.') continue;
          ctx.fillStyle = (r + c) % 2 ? '#0369a1' : '#0f172a';
          ctx.fillText(ch, 56 + c * 24, 20 + r * 24);
        }
      }
      for (var k = 0; k <= 3; k++) {
        ctx.strokeStyle = k % 3 === 0 ? '#0f172a' : 'rgba(15,23,42,0.25)';
        ctx.lineWidth = k % 3 === 0 ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(44 + k * 24, 8); ctx.lineTo(44 + k * 24, 80); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(44, 8 + k * 24); ctx.lineTo(116, 8 + k * 24); ctx.stroke();
      }
    },

    'guess-the-algorithm': function (ctx) {
      bg(ctx, '244,162,97');
      /* A part-sorted chart with the two bars mid-comparison lit, which is
         the whole game in one picture. */
      var hs = [16, 31, 9, 44, 25, 53, 13, 38, 60, 21, 48, 29];
      for (var i = 0; i < hs.length; i++) {
        ctx.fillStyle = (i === 5 || i === 6) ? '#fbbf24' : '#4f7099';
        ctx.fillRect(14 + i * 11, 70 - hs[i], 8, hs[i]);
        ctx.fillStyle = 'rgba(248,250,252,0.16)';
        ctx.fillRect(14 + i * 11, 70 - hs[i], 8, 2);
      }
      ctx.fillStyle = 'rgba(148,163,184,0.3)';
      ctx.fillRect(14, 70, 132, 1);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('which sort?', 80, 82);
    },

    'ctf-arcade': function (ctx) {
      bg(ctx, '244,162,97');
      /* The whole game in one picture: a blob on top, the flag underneath,
         and a ladder of twelve pips showing how far you are up it. */
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('Q1RGe2Jhc2U2NF9p', 14, 24);
      ctx.fillStyle = '#fb923c';
      ctx.fillText('base64 >', 14, 41);
      ctx.font = 'bold 13px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#86efac';
      ctx.fillText('CTF{...}', 62, 42);
      for (var i = 0; i < 12; i++) {
        ctx.fillStyle = i < 5 ? '#fb923c' : 'rgba(148,163,184,0.28)';
        ctx.fillRect(14 + i * 11, 60, 8, 5);
      }
      ctx.font = '8px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('5 of 12 solved', 14, 80);
    },

    'guess-the-output': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('console.log(0.1 + 0.2)', 12, 16);
      var rows = [['0.3', 30, false], ['0.30000000000000004', 48, true], ['NaN', 66, false]];
      for (var i = 0; i < rows.length; i++) {
        var y = rows[i][1];
        var hit = rows[i][2];
        ctx.fillStyle = hit ? 'rgba(74,222,128,0.18)' : 'rgba(15,23,42,0.35)';
        ctx.fillRect(12, y - 7, 136, 15);
        ctx.strokeStyle = hit ? '#4ade80' : 'rgba(148,163,184,0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(12.5, y - 6.5, 135, 14);
        ctx.font = (hit ? 'bold 8px' : '8px') + ' "Cascadia Code", Consolas, monospace';
        ctx.fillStyle = hit ? '#86efac' : '#94a3b8';
        ctx.fillText(rows[i][0], 18, y);
      }
      ctx.font = 'bold 9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#fb923c';
      ctx.fillText('why?', 12, 82);
    },

    'assembly-puzzles': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.textBaseline = 'middle';
      ctx.font = '8px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('IN  R0', 12, 20);
      ctx.fillStyle = '#fb923c';
      ctx.fillText('loop:', 10, 33);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText('OUT R0', 18, 46);
      ctx.fillText('DEC R0', 18, 59);
      ctx.fillStyle = '#fb923c';
      ctx.fillText('JNE loop', 18, 72);
      var names = ['R0', 'R1', 'R2', 'R3'];
      var vals = ['3', '0', '12', '0'];
      for (var i = 0; i < 4; i++) {
        var y = 15 + i * 16;
        ctx.fillStyle = 'rgba(148,163,184,0.22)';
        ctx.fillRect(94, y, 54, 13);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(names[i], 98, y + 7);
        ctx.fillStyle = '#86efac';
        ctx.fillText(vals[i], 124, y + 7);
      }
    },

    'career-quiz': function (ctx) {
      bg(ctx, '244,114,182');
      /* Six tracks as bars, with the top two coloured — the same shape the
         result page ends on. */
      var rows = [['Security', 0.89], ['Infra', 0.67], ['Backend', 0.55], ['Data', 0.44], ['Product', 0.33], ['Frontend', 0.22]];
      ctx.font = '7px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (var i = 0; i < rows.length; i++) {
        var y = 14 + i * 13;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(rows[i][0], 10, y);
        ctx.fillStyle = 'rgba(148,163,184,0.22)';
        ctx.fillRect(56, y - 4, 92, 8);
        ctx.fillStyle = i < 2 ? '#f472b6' : '#64748b';
        ctx.fillRect(56, y - 4, 92 * rows[i][1], 8);
      }
    },

    'regex-golf': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 15px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('/^\\d+$/', 80, 20);
      /* The two columns the pattern is judged against: matched on the left,
         rejected on the right, which is the whole shape of the game. */
      ctx.textAlign = 'left';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      var hit = ['2048', '42', '90210'];
      var miss = ['x86', 'v2', '3com'];
      for (var i = 0; i < 3; i++) {
        var y = 44 + i * 14;
        ctx.fillStyle = '#86efac';
        ctx.fillText('✓', 16, y);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(hit[i], 28, y);
        ctx.fillStyle = '#fca5a5';
        ctx.fillText('✗', 88, y);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(miss[i], 100, y);
      }
    },

    'dev-personality': function (ctx) {
      bg(ctx, '244,114,182');
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.fillText('The gardener', 12, 17);
      var rows = [['gardener', 0.84, '#86efac'], ['architect', 0.58, '#7dd3fc'],
                  ['toolmaker', 0.4, '#c084fc'], ['shipper', 0.2, '#94a3b8']];
      ctx.font = '8px "Segoe UI", sans-serif';
      for (var i = 0; i < rows.length; i++) {
        var y = 38 + i * 14;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(rows[i][0], 12, y);
        ctx.fillStyle = 'rgba(148,163,184,0.25)';
        ctx.fillRect(66, y - 4, 80, 8);
        ctx.fillStyle = rows[i][2];
        ctx.fillRect(66, y - 4, 80 * rows[i][1], 8);
      }
    },

    'shell-quest': function (ctx) {
      bg(ctx, '244,162,97');
      ctx.font = '7px "Cascadia Code", Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      var rows = [
        ['forge:~$ ', 'ls -a', '#e2e8f0'],
        ['', '.config  notes  readme.txt', '#94a3b8'],
        ['forge:~$ ', 'cat .config/.keyring', '#e2e8f0'],
        ['', 'flag{dot-and-dash}', '#86efac']
      ];
      for (var i = 0; i < rows.length; i++) {
        var y = 18 + i * 14;
        var x = 12;
        if (rows[i][0]) {
          ctx.fillStyle = '#fb923c';
          ctx.fillText(rows[i][0], x, y);
          x += 38;
        }
        ctx.fillStyle = rows[i][2];
        ctx.fillText(rows[i][1], x, y);
      }

      ctx.fillStyle = '#fb923c';
      ctx.fillText('forge:~$', 12, 74);
      ctx.fillStyle = '#86efac';
      ctx.fillRect(52, 70, 4, 8);
    },

    'name-in-binary': function (ctx) {
      bg(ctx, '244,114,182');
      /* 'A' and 'l' in ASCII, so the tile is a real byte rather than decoration. */
      var bits = [0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 0];
      ctx.fillStyle = 'rgba(248,250,252,0.8)';
      ctx.fillRect(20, 18, 30, 4);
      ctx.fillRect(54, 16, 3, 8);
      for (var i = 0; i < bits.length; i++) {
        var col = i % 8;
        var row = (i / 8) | 0;
        ctx.fillStyle = bits[i] ? '#f8fafc' : 'rgba(248,250,252,0.22)';
        ctx.fillRect(20 + col * 15, 34 + row * 18, 11, 11);
      }
      ctx.fillStyle = 'rgba(248,250,252,0.45)';
      ctx.fillRect(20, 74, 100, 4);
    },

    'which-attack': function (ctx) {
      bg(ctx, '244,114,182');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.fillText('You are', 14, 19);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 15px "Cascadia Code", Consolas, monospace';
      ctx.fillText('PHISHING', 14, 38);
      var rows = [0.68, 0.44, 0.21];
      for (var i = 0; i < rows.length; i++) {
        var y = 56 + i * 12;
        ctx.fillStyle = 'rgba(148,163,184,0.25)';
        ctx.fillRect(14, y, 118, 6);
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(14, y, 118 * rows[i], 6);
      }
    },

    'birthday-facts': function (ctx) {
      bg(ctx, '244,114,182');
      /* A calendar leaf: two rings, a coloured band, one date, and the
         weekday underneath it — which is the game's whole output. */
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(60, 10, 4, 9);
      ctx.fillRect(96, 10, 4, 9);
      ctx.fillStyle = 'rgba(148,163,184,0.16)';
      ctx.fillRect(45, 16, 70, 62);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(45, 16, 70, 12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 26px "Cascadia Code", Consolas, monospace';
      ctx.fillText('17', 80, 46);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillText('Monday', 80, 66);
    },

    'memory': function (ctx) {
      bg(ctx, '125,211,252');
      var cols = 4, rows = 3, w = 28, h = 20, gx = 7, gy = 6;
      var x0 = (160 - (cols * w + (cols - 1) * gx)) / 2;
      var y0 = (90 - (rows * h + (rows - 1) * gy)) / 2;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var i = r * cols + c;
          var x = x0 + c * (w + gx);
          var y = y0 + r * (h + gy);
          /* Two cards turned over showing the SAME shape, because a grid of
             identical backs would not say what the game is. */
          var up = (i === 1 || i === 10);
          ctx.fillStyle = up ? '#0b1424' : '#16233b';
          ctx.fillRect(x, y, w, h);
          ctx.lineWidth = 1;
          ctx.strokeStyle = up ? '#38bdf8' : 'rgba(125,211,252,0.32)';
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          if (up) {
            ctx.fillStyle = '#e69f00';
            ctx.beginPath();
            ctx.arc(x + w / 2, y + h / 2, 6, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = 'rgba(125,211,252,0.22)';
            ctx.fillRect(x + w / 2 - 1.5, y + h / 2 - 1.5, 3, 3);
          }
        }
      }
    },

    'snakes-ladders': function (ctx) {
      bg(ctx, '125,211,252');
      var x0 = 44, y0 = 9, cell = 12, r, c, i, t;
      for (r = 0; r < 6; r++) {
        for (c = 0; c < 6; c++) {
          ctx.fillStyle = ((r + c) % 2) ? '#101c2f' : '#0b1524';
          ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
        }
      }
      /* One ladder and one snake is enough to say what the game is; a full
         ten-by-ten grid at this size is just texture. */
      ctx.strokeStyle = '#c98f4e';
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x0 + 8, y0 + 66); ctx.lineTo(x0 + 20, y0 + 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x0 + 14, y0 + 68); ctx.lineTo(x0 + 26, y0 + 32); ctx.stroke();
      for (i = 1; i < 4; i++) {
        t = i / 4;
        ctx.beginPath();
        ctx.moveTo(x0 + 8 + 12 * t, y0 + 66 - 36 * t);
        ctx.lineTo(x0 + 14 + 12 * t, y0 + 68 - 36 * t);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x0 + 60, y0 + 14);
      ctx.quadraticCurveTo(x0 + 78, y0 + 42, x0 + 44, y0 + 62);
      ctx.stroke();
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0 + 60, y0 + 14);
      ctx.quadraticCurveTo(x0 + 78, y0 + 42, x0 + 44, y0 + 62);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x0 + 60, y0 + 14, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#4ade80'; ctx.fill();
      ctx.beginPath(); ctx.arc(x0 + 10, y0 + 64, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#f87171'; ctx.fill();
      ctx.beginPath(); ctx.arc(x0 + 44, y0 + 62, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = '#c084fc'; ctx.fill();
    },

    'are-you-a-robot': function (ctx) {
      bg(ctx, '244,114,182');
      /* The tick box on the left and the grid it always leads to on the
         right, with the same three squares the second screen asks for. */
      ctx.strokeStyle = 'rgba(226,232,240,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 33, 24, 24);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(25, 45);
      ctx.lineTo(31, 51);
      ctx.lineTo(41, 36);
      ctx.stroke();
      var picked = { 0: 1, 2: 1, 5: 1 };
      for (var i = 0; i < 9; i++) {
        var x = 72 + (i % 3) * 21;
        var y = 14 + Math.floor(i / 3) * 21;
        ctx.fillStyle = picked[i] ? 'rgba(244,114,182,0.75)' : 'rgba(226,232,240,0.1)';
        ctx.fillRect(x, y, 18, 18);
        ctx.strokeStyle = 'rgba(244,114,182,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, 17, 17);
      }
    },

    'word-of-the-day': function (ctx) {
      bg(ctx, '125,211,252');
      /* Three rows closing in on TOKEN, and the marks are the ones the game
         would really give: STACK shares a misplaced T and a correct K,
         PROXY shares a misplaced O. */
      var rows = [
        ['STACK', '-Y--G'],
        ['PROXY', '--Y--'],
        ['TOKEN', 'GGGGG']
      ];
      ctx.font = 'bold 11px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var r = 0; r < rows.length; r++) {
        for (var c = 0; c < 5; c++) {
          var m = rows[r][1].charAt(c);
          var x = 22 + c * 24;
          var y = 8 + r * 26;
          ctx.fillStyle = m === 'G' ? '#15803d' : m === 'Y' ? '#b45309' : '#1e293b';
          ctx.fillRect(x, y, 20, 20);
          ctx.fillStyle = m === '-' ? '#94a3b8' : '#f8fafc';
          ctx.fillText(rows[r][0].charAt(c), x + 10, y + 11);
        }
      }
    },

    'arithmetic': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      /* The clock, most of the way through. */
      ctx.fillStyle = '#86efac';
      ctx.fillRect(16, 16, 78, 4);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(94, 16, 50, 4);
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#fb923c';
      ctx.fillText('49s', 122, 12);

      ctx.font = 'bold 16px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('17 × 6 =', 16, 48);
      ctx.fillStyle = '#fde047';
      ctx.fillText('102', 16 + ctx.measureText('17 × 6 = ').width, 48);

      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.fillStyle = '#86efac';
      ctx.fillText('81 ÷ 9 = 9    1.4s', 16, 68);
      ctx.fillStyle = '#f87171';
      ctx.fillText('7 × 8 = 54   was 56', 16, 80);
    },

    'hangman': function (ctx) {
      bg(ctx, '134,239,172');

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3f6b52';
      ctx.beginPath();
      ctx.moveTo(14, 76); ctx.lineTo(48, 76);
      ctx.moveTo(30, 76); ctx.lineTo(30, 16);
      ctx.lineTo(56, 16); ctx.lineTo(56, 26);
      ctx.stroke();

      ctx.strokeStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(56, 31, 5, 0, Math.PI * 2);
      ctx.moveTo(56, 36); ctx.lineTo(56, 50);
      ctx.moveTo(56, 40); ctx.lineTo(49, 46);
      ctx.moveTo(56, 40); ctx.lineTo(63, 46);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 11px "Cascadia Code", Consolas, monospace';
      ctx.fillText('C _ P H _ R', 76, 40);

      ctx.fillStyle = '#3f6b52';
      ctx.font = '600 8px "Cascadia Code", Consolas, monospace';
      ctx.fillText('A B C D E F G', 76, 62);
      ctx.fillText('H I J K L M N', 76, 74);

      ctx.fillStyle = '#fde047';
      ctx.fillText('[', 76, 62);
      ctx.fillStyle = '#86efac';
      ctx.fillText('A', 80, 62);
    },

    'gomoku': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var win = { '2,1': 1, '3,2': 1, '4,3': 1, '5,4': 1, '6,5': 1 };
      var mine = { '7,2': 1, '3,5': 1, '8,4': 1 };
      var theirs = { '4,1': 1, '5,2': 1, '6,3': 1, '3,4': 1, '2,5': 1, '7,4': 1, '5,6': 1 };
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 11; c++) {
          var k = c + ',' + r;
          var ch = '·';
          var col = 'rgba(134,239,172,0.28)';
          if (win[k]) { ch = 'X'; col = '#f8fafc'; }
          else if (mine[k]) { ch = 'X'; col = '#67e8f9'; }
          else if (theirs[k]) { ch = 'O'; col = '#fb923c'; }
          ctx.fillStyle = col;
          ctx.fillText(ch, 30 + c * 10, 16 + r * 10);
        }
      }
    },

    'pacman': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '12px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var rows = [
        '####.#####.####',
        '#.............#',
        '#.##.##.##.##.#',
        '#.............#',
        '####.#####.####'
      ];
      for (var y = 0; y < rows.length; y++) {
        for (var x = 0; x < rows[y].length; x++) {
          var ch = rows[y].charAt(x);
          ctx.fillStyle = ch === '#' ? '#3f6b52' : '#94a3b8';
          ctx.fillText(ch, 21 + x * 9, 19 + y * 14);
        }
      }
      ctx.fillStyle = '#fde047';
      ctx.fillText('o', 30, 61);
      ctx.fillText('<', 84, 33);
      ctx.fillStyle = '#f87171';
      ctx.fillText('M', 111, 33);
      ctx.fillStyle = '#f0abfc';
      ctx.fillText('M', 120, 33);
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('M', 57, 61);
      ctx.fillStyle = '#fb923c';
      ctx.fillText('M', 129, 61);
    },

    'tty-solitaire': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      /* Mirrors term-shell.js's COLORS.dim — the two must change together
         or the thumbnail stops looking like the game it advertises. */
      var DIM = '#508a60';
      var RED = '#f87171';
      var PALE = '#f8fafc';
      function tok(x, y, s, c) { ctx.fillStyle = c; ctx.fillText(s, x, y); }
      /* The top row: the deck, the waste, and two foundations started. */
      tok(8, 14, '[###]', DIM);
      tok(38, 14, '[ 9♥]', RED);
      tok(98, 14, '[ A♠]', PALE);
      tok(128, 14, '[ A♥]', RED);
      ctx.fillStyle = 'rgba(63,107,82,0.85)';
      ctx.fillRect(8, 23, 144, 1);
      tok(8, 34, '[ K♠]', PALE);
      tok(8, 44, '[ Q♥]', RED);
      tok(8, 54, '[ J♣]', PALE);
      tok(38, 34, '[###]', DIM);
      tok(38, 44, '[ 7♦]', RED);
      tok(68, 34, '[###]', DIM);
      tok(68, 44, '[###]', DIM);
      tok(68, 54, '[ 4♣]', PALE);
      tok(98, 34, '[10♥]', RED);
      tok(128, 34, '[###]', DIM);
      tok(128, 44, '[ 6♠]', PALE);
      tok(1, 54, '>', '#fde047');
      tok(8, 76, 'klondike, draw one', DIM);
    },

    atc: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#475569';
      var x, y;
      for (y = 0; y < 6; y++) {
        for (x = 0; x < 10; x++) ctx.fillText('·', 16 + x * 10, 18 + y * 12);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.30)';
      ctx.lineWidth = 1;
      ctx.strokeRect(8, 8, 106, 74);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('2→', 96, 18);
      ctx.fillStyle = '#fde047';
      ctx.fillText('0→', 38, 54);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('A7', 24, 30);
      ctx.fillStyle = '#f87171';
      ctx.fillText('B4', 66, 42);
      ctx.fillText('C4', 80, 42);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('ID ALT', 120, 18);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('>A 7→9', 120, 32);
      ctx.fillStyle = '#f87171';
      ctx.fillText(' B 4', 120, 46);
      ctx.fillText(' C 4', 120, 58);
    },

    'trek': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '8px "Cascadia Code", Consolas, monospace';

      ctx.fillStyle = '#3f6b52';
      var x, y;
      for (y = 0; y < 6; y++) {
        for (x = 0; x < 8; x++) ctx.fillText('·', 14 + x * 12, 30 + y * 10);
      }

      ctx.fillStyle = '#f87171';
      ctx.fillText('+K+', 33, 40);
      ctx.fillText('+K+', 85, 60);

      ctx.fillStyle = '#fde047';
      ctx.fillText('*', 62, 30);
      ctx.fillText('*', 26, 70);

      ctx.fillStyle = '#f8fafc';
      ctx.fillText('<E>', 57, 50);

      ctx.fillStyle = '#86efac';
      ctx.fillText('STAR TREK', 14, 18);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('stardate 2250.0', 76, 18);
    },

    'asciijump': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '10px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      /* The in-run dropping in from the left, the red lip, and a jumper
         already out over the hill: the three things the game is made of. */
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('\\\\', 8, 16);
      ctx.fillText('\\\\', 20, 24);
      ctx.fillText('\\\\', 32, 32);
      ctx.fillStyle = '#fde047';
      ctx.fillText('__', 44, 38);
      ctx.fillStyle = '#f87171';
      ctx.fillText('|', 58, 36);
      ctx.fillStyle = '#475569';
      ctx.fillText('. .', 58, 56);
      ctx.fillText('. . . ', 58, 64);
      ctx.fillText('. . . . . ', 58, 72);
      ctx.fillText('. . . . . . . ', 58, 80);
      ctx.fillText('. . . . . . . . . ', 58, 88);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('___', 58, 48);
      ctx.fillText('___', 76, 56);
      ctx.fillText('___', 94, 64);
      ctx.fillText('___', 112, 72);
      ctx.fillText('___', 130, 80);
      ctx.fillStyle = '#fde047';
      ctx.fillText('K', 118, 64);
      ctx.fillStyle = '#86efac';
      ctx.fillText('o', 92, 28);
      ctx.fillText('===', 84, 36);
    },

    adventure: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '8px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('The cross gallery', 14, 16);
      ctx.fillStyle = '#86efac';
      ctx.fillText('The air moves here, and what', 14, 30);
      ctx.fillText('comes back is sweet.', 14, 41);
      ctx.fillStyle = 'rgba(134,239,172,0.18)';
      ctx.fillRect(12, 50, 136, 1);
      ctx.fillStyle = '#fde047';
      ctx.fillText('▸', 14, 60);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('Go west', 24, 60);
      ctx.fillStyle = '#3f6b52';
      ctx.fillText('Light the lamp', 24, 72);
      ctx.fillText('Fit the wire gauze', 24, 84);
    },

    rain: function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var glyphs = ['|', '/', '-', '\\', '|', '/', '-', '\\'];
      /* The same tangent-by-octant rule the game uses, and the same 2:1
         squash, so the thumbnail is not lying about the shape. */
      function ripple(cx, cy, r, colour) {
        ctx.fillStyle = colour;
        var steps = Math.max(10, Math.round(r * 1.7));
        for (var i = 0; i < steps; i++) {
          var a = (i / steps) * Math.PI * 2 - Math.PI;
          var o = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
          ctx.fillText(glyphs[o], cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5);
        }
      }
      ripple(54, 50, 30, '#3f6b52');
      ripple(54, 50, 19, '#7dd3fc');
      ripple(54, 50, 9, '#67e8f9');
      ripple(118, 28, 15, '#3f6b52');
      ripple(118, 28, 7, '#f8fafc');
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('|', 26, 20);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText('|', 26, 29);
      ctx.fillStyle = '#67e8f9';
      ctx.fillText('|', 138, 60);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('o', 92, 76);
    },

    'aafire': function (ctx) {
      bg(ctx, '134,239,172');
      /* The same averaging pass the page runs, on a 26x11 grid, left to settle
         for thirty frames before it is drawn. */
      var C = 26, R = 11, i, x, y, n;
      var heat = [];
      for (i = 0; i < C * (R + 2); i++) heat.push(0);
      var ramp = ' .:^*xsS#$';
      var tint = ['', '#a16207', '#a16207', '#f87171', '#f87171', '#fb923c', '#fb923c', '#fde047', '#fde047', '#f8fafc'];
      for (var p = 0; p < 30; p++) {
        for (x = 0; x < C; x++) {
          var seed = Math.random() < 0.66 ? 0.75 + Math.random() * 0.25 : Math.random() * 0.3;
          heat[R * C + x] = seed;
          heat[(R + 1) * C + x] = seed;
        }
        for (y = 0; y < R; y++) {
          for (x = 0; x < C; x++) {
            var l = x > 0 ? heat[(y + 1) * C + x - 1] : 0;
            var r = x < C - 1 ? heat[(y + 1) * C + x + 1] : 0;
            var v = (l + heat[(y + 1) * C + x] + r + heat[(y + 2) * C + x]) / 4 - (0.045 + Math.random() * 0.075);
            heat[y * C + x] = v > 0 ? v : 0;
          }
        }
      }
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (y = 0; y < R; y++) {
        for (x = 0; x < C; x++) {
          n = Math.floor(heat[y * C + x] * 10);
          if (n < 1) continue;
          if (n > 9) n = 9;
          ctx.fillStyle = tint[n];
          ctx.fillText(ramp.charAt(n), 5 + x * 6, 8 + y * 7.4);
        }
      }
    },

    asteroids: function (ctx) {
      bg(ctx, '125,211,252');
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      /* Outlines only, the same way the game itself draws. */
      var jag = [1, 0.82, 1.12, 0.86, 1.04, 0.78, 1.08, 0.9];
      var rocks = [[34, 30, 16], [118, 60, 12], [96, 20, 9]];
      ctx.strokeStyle = '#94a3b8';
      for (var i = 0; i < rocks.length; i++) {
        ctx.beginPath();
        for (var k = 0; k < 8; k++) {
          var a = (k / 8) * Math.PI * 2 + i;
          var r = rocks[i][2] * jag[(k + i) % 8];
          var x = rocks[i][0] + Math.cos(a) * r;
          var y = rocks[i][1] + Math.sin(a) * r;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(70, 62);
      ctx.rotate(-1.05);
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-9, -8);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = '#fbbf24';
      ctx.beginPath();
      ctx.moveTo(-7, -5);
      ctx.lineTo(-16, 0);
      ctx.lineTo(-7, 5);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = '#4ade80';
      ctx.beginPath();
      ctx.moveTo(84, 46); ctx.lineTo(88, 41);
      ctx.moveTo(93, 34); ctx.lineTo(97, 29);
      ctx.stroke();
    },

    'flappy': function (ctx) {
      bg(ctx, '74,222,128');
      /* Two pipes with the gap stepping upward, and the bird between them —
         the tile has to read as "a gap to fly through", not as green bars. */
      var pipes = [[58, 34, 62], [112, 20, 48]];
      for (var i = 0; i < pipes.length; i++) {
        var x = pipes[i][0], top = pipes[i][1], bot = pipes[i][2];
        ctx.fillStyle = '#166534';
        ctx.fillRect(x, 0, 20, top);
        ctx.fillRect(x, bot, 20, 78 - bot);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x - 3, top - 6, 26, 6);
        ctx.fillRect(x - 3, bot, 26, 6);
      }
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 78, 160, 12);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, 78, 160, 2);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.ellipse(32, 50, 9, 7, 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(40, 48); ctx.lineTo(47, 51); ctx.lineTo(40, 54);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(36, 47, 1.6, 0, Math.PI * 2);
      ctx.fill();
    },

    'rogue': function (ctx) {
      bg(ctx, '134,239,172');
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      /* Two rooms, the corridor between them, and the four things the game
         is about: you, a kobold, gold and the stairs down. */
      var rows = [
        '--------            ------',
        '|......+############+....|',
        '|.@..%.|            |..k.|',
        '|.....*|            |....|',
        '--------            ------'
      ];
      var tint = { '@': '#f8fafc', '%': '#67e8f9', 'k': '#f87171', '*': '#fde047', '+': '#a16207' };
      for (var y = 0; y < rows.length; y++) {
        for (var x = 0; x < rows[y].length; x++) {
          var ch = rows[y].charAt(x);
          if (ch === ' ') continue;
          ctx.fillStyle = tint[ch] || (ch === '.' || ch === '#' ? '#3f6b52' : '#86efac');
          ctx.fillText(ch, 10 + x * 5.6, 24 + y * 11);
        }
      }
    },

    'platformer': function (ctx) {
      bg(ctx, '56,189,248');
      /* two runs of ground with a gap, the runner mid-jump over it */
      ctx.fillStyle = '#1f3a2e';
      ctx.fillRect(0, 70, 58, 20);
      ctx.fillRect(78, 70, 82, 20);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(0, 70, 58, 4);
      ctx.fillRect(78, 70, 82, 4);
      ctx.fillStyle = '#3b3324';
      ctx.fillRect(92, 38, 32, 10);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(92, 38, 32, 3);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(105, 22, 6, 12);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(128, 56, 14, 14);
      ctx.fillStyle = '#fee2e2';
      ctx.fillRect(131, 61, 3, 3);
      ctx.fillRect(137, 61, 3, 3);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(150, 32, 3, 38);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(153, 34, 7, 9);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(58, 46, 12, 12);
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(59, 39, 10, 7);
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(57, 58, 5, 3);
      ctx.fillRect(66, 58, 5, 3);
    },

    'love-calculator': function (ctx) {
      bg(ctx, '244,114,182');
      /* A heart, and the hash digits it is really made of. */
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      var cx = 80, cy = 40, s = 15;
      ctx.moveTo(cx, cy + s * 0.9);
      ctx.bezierCurveTo(cx - s * 1.6, cy - s * 0.2, cx - s * 0.6, cy - s * 1.3, cx, cy - s * 0.4);
      ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.3, cx + s * 1.6, cy - s * 0.2, cx, cy + s * 0.9);
      ctx.fill();
      ctx.fillStyle = 'rgba(226,232,240,0.55)';
      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('811c9dc5 · fnv1a', 80, 68);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 13px "Cascadia Code", Consolas, monospace';
      ctx.fillText('87%', 80, 20);
    }
  };

  function paintThumbs() {
    var wells = document.querySelectorAll('[data-thumb]');
    for (var i = 0; i < wells.length; i++) {
      var well = wells[i];
      var painter = PAINT[well.getAttribute('data-thumb')];
      if (!painter || well.querySelector('canvas')) continue;

      var canvas = document.createElement('canvas');
      /* A fixed 2x backing store rather than devicePixelRatio: these are
         decorative, they never resize, and asking for 3x on a phone would
         allocate thirty canvases nobody looks closely at. */
      canvas.width = W * 2;
      canvas.height = H * 2;
      canvas.setAttribute('aria-hidden', 'true');

      var ctx = canvas.getContext('2d');
      if (!ctx) continue;                       // leave the glyph tile alone
      ctx.scale(2, 2);
      ctx.imageSmoothingEnabled = false;
      try { painter(ctx); } catch (err) { continue; }

      /* Inserted first so the CSS sibling rule hides the glyph, and so the
         glyph is what shows if any of the above bailed out. */
      well.insertBefore(canvas, well.firstChild);
    }
  }

  /* ------------------------------------------------------------------
     2. Personal bests on the cards
     ------------------------------------------------------------------
     Read straight from the same localStorage keys game-shell.js writes.
     A card with no stored best is left empty, and games.css hides an empty
     one — "Best: 0" on twenty cards is noise, not information.
     ------------------------------------------------------------------ */
  /* How each stored best reads as a sentence. These MIRROR the
     spec.formatBest functions inside the game modules, which do not load
     on this page — so without them the card printed the raw stored value:
     a 953-second sudoku solve showed 'Best 953' instead of '15:53', and a
     reaction time lost its 'ms'. A slug missing here prints the raw
     number, which is correct for every game whose own page does the same.
     If a game's formatBest changes, its line here changes with it. */
  var BEST_FORMATS = {
    sudoku: function (n) {
      var m = Math.floor(n / 60), s = Math.floor(n % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    'reaction-time': function (n) { return n + ' ms'; },
    'aim-trainer': function (n) { return n + ' ms'; },
    asciijump: function (n) { return Number(n).toFixed(1); },
    'regex-golf': function (n) { return n + ' chars'; },
    'shell-quest': function (n) { return n + ' commands'; },
    'guess-the-algorithm': function (n) { return n + ' pts'; }
  };

  function fillBests() {
    var cells = document.querySelectorAll('[data-best]');
    for (var i = 0; i < cells.length; i++) {
      var slug = cells[i].getAttribute('data-best');
      var v;
      try { v = localStorage.getItem('game.' + slug + '.best'); } catch (err) { v = null; }
      /* The else-branch matters as much as the if. This only ever wrote a
         label, never removed one, and '.game-card-best:empty' is what hides
         an unused cell — so once a card said 'Best 4200' it said so forever.
         Clearing storage from the panel below repainted the cards and they
         kept displaying the numbers that had just been deleted, directly
         under a line reading 'Cleared 2 entries.' On the one feature whose
         entire purpose is that the claim can be checked on screen rather
         than believed, that is the only bug that really matters. */
      var n = Number(v);
      var shown = BEST_FORMATS[slug] ? BEST_FORMATS[slug](n) : v;
      cells[i].textContent = (v && n > 0) ? 'Best ' + shown : '';
    }
  }

  /* ------------------------------------------------------------------
     2b. The data panel
     ------------------------------------------------------------------
     Shows exactly what is in storage, clears it, and turns storage off
     altogether. The list is rendered from the real keys rather than from
     a description of them, so the page cannot drift out of step with
     what is actually held — which is the only version of this worth
     having.
     ------------------------------------------------------------------ */
  function wireDataPanel() {
    var panel = document.getElementById('data-panel');
    if (!panel || !window.GameStorage) return;
    var S = window.GameStorage;

    var table = document.getElementById('data-table');
    var rows = document.getElementById('data-rows');
    var empty = document.getElementById('data-empty');
    var clearBtn = document.getElementById('data-clear');
    var optBtn = document.getElementById('data-optout');
    var said = document.getElementById('data-said');

    /* Slug -> the name on the card, so the table reads "Moon buggy"
       rather than "moon-buggy". Built from the DOM that is already on
       the page instead of shipping a second copy of the list. */
    var names = {};
    var cards = document.querySelectorAll('.game-card[data-slug]');
    for (var i = 0; i < cards.length; i++) {
      var n = cards[i].querySelector('.game-card-name');
      names[cards[i].getAttribute('data-slug')] = n ? n.textContent.trim() : cards[i].getAttribute('data-slug');
    }

    var LABEL = {
      best: 'best score',
      board: 'saved board',
      history: 'past results',
      level: 'difficulty',
      mode: 'mode',
      players: 'player count',
      speed: 'speed',
      wrap: 'walls setting',
      duration: 'length',
      size: 'target size',
      depth: 'strength',
      streak: 'streak'
    };

    function render() {
      var on = S.enabled();
      var list = on ? S.list() : [];

      /* Emptied up front rather than only on the path that repopulates it.
         Hiding the table while leaving last render rows inside it looks
         identical until something un-hides it, and then the panel is
         confidently listing data that was deleted a minute ago. */
      if (rows) rows.innerHTML = '';

      if (optBtn) {
        optBtn.setAttribute('aria-pressed', String(!on));
        optBtn.textContent = on ? 'Store nothing at all' : 'Start storing again';
      }
      if (clearBtn) clearBtn.disabled = !on || list.length === 0;

      if (!on) {
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'Storage is off. Nothing is being kept, and best scores will not survive a reload.';
        }
        if (table) table.hidden = true;
        return;
      }

      if (!list.length) {
        if (empty) {
          empty.hidden = false;
          empty.textContent = 'Nothing is stored yet. Play something and this fills in.';
        }
        if (table) table.hidden = true;
        return;
      }

      if (empty) empty.hidden = true;
      if (table) table.hidden = false;
      if (!rows) return;
      for (var k = 0; k < list.length; k++) {
        var r = list[k];
        var tr = document.createElement('tr');
        var td1 = document.createElement('td');
        td1.textContent = names[r.slug] || r.slug || '(section)';
        var td2 = document.createElement('td');
        td2.textContent = LABEL[r.what] || r.what;
        var td3 = document.createElement('td');
        td3.className = 'data-value';
        td3.textContent = r.value;
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
        rows.appendChild(tr);
      }
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        var n = S.clearAll();
        if (said) said.textContent = n
          ? 'Cleared ' + n + ' ' + (n === 1 ? 'entry' : 'entries') + '.'
          : 'There was nothing to clear.';
        fillBests();
        render();
      });
    }

    if (optBtn) {
      optBtn.addEventListener('click', function () {
        var turningOff = S.enabled();
        S.setEnabled(!turningOff);
        if (said) said.textContent = turningOff
          ? 'Storage is off, and what was there has been deleted.'
          : 'Storage is on again. Nothing has been restored — it was deleted, not hidden.';
        fillBests();
        render();
      });
    }

    render();
  }

  /* ------------------------------------------------------------------
     3. Filter and category chips
     ------------------------------------------------------------------ */
  var input = document.getElementById('game-filter-input');
  var clear = document.getElementById('game-filter-clear');
  var emptyClear = document.getElementById('game-filter-empty-clear');
  var count = document.getElementById('game-filter-count');
  var empty = document.getElementById('game-filter-empty');
  var chips = document.getElementById('game-cats');

  var cards = [];
  var sections = [];
  var activeCat = null;

  function collect() {
    var nodes = document.querySelectorAll('.game-card[data-slug]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      /* The searchable text is built once. Doing it per keystroke across
         thirty cards is thirty DOM reads a character. */
      cards.push({
        el: el,
        cat: el.getAttribute('data-cat'),
        text: (el.textContent || '').toLowerCase().replace(/\s+/g, ' ')
      });
    }
    var secs = document.querySelectorAll('.section-card[id$="-games"]');
    for (var j = 0; j < secs.length; j++) sections.push(secs[j]);
  }

  function apply() {
    var q = (input ? input.value : '').trim().toLowerCase();
    var shown = 0;

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var okText = !q || c.text.indexOf(q) !== -1;
      var okCat = !activeCat || c.cat === activeCat;
      var on = okText && okCat;
      c.el.hidden = !on;
      if (on) shown++;
    }

    /* Hide a whole section once every card in it is filtered out, so the
       page does not end up with three headings above nothing. */
    for (var s = 0; s < sections.length; s++) {
      var any = sections[s].querySelector('.game-card:not([hidden])');
      sections[s].hidden = !any;
    }

    if (clear) clear.hidden = !q;
    if (empty) empty.hidden = shown !== 0;
    if (count) {
      count.textContent = (!q && !activeCat)
        ? ''
        : shown + (shown === 1 ? ' game' : ' games') + ' of ' + cards.length;
    }
  }

  /* A short debounce, matching lab-filter.js. Typing "minesweeper" should
     not run eleven passes over the card list. */
  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(apply, 90);
  }

  function reset() {
    if (input) { input.value = ''; input.focus(); }
    activeCat = null;
    syncChips();
    apply();
  }

  function syncChips() {
    if (!chips) return;
    var btns = chips.querySelectorAll('button[data-cat]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-cat') === activeCat));
    }
  }

  function init() {
    collect();
    if (!cards.length) return;

    if (input) {
      input.addEventListener('input', schedule);
      /* Escape clears rather than blurring: a filter box you cannot empty
         from the keyboard is a trap for anyone not using a mouse. */
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && input.value) { event.preventDefault(); reset(); }
      });
    }
    if (clear) clear.addEventListener('click', reset);
    if (emptyClear) emptyClear.addEventListener('click', reset);

    if (chips) {
      chips.addEventListener('click', function (event) {
        var btn = event.target.closest ? event.target.closest('button[data-cat]') : null;
        if (!btn) return;
        var cat = btn.getAttribute('data-cat');
        activeCat = activeCat === cat ? null : cat;   // clicking the active chip clears it
        syncChips();
        apply();
      });
    }

    paintThumbs();
    fillBests();
    wireDataPanel();
    apply();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

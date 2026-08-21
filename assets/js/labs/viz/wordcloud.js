/* ==========================================================================
   wordcloud.js — a word cloud generator: paste text, get a shaped, coloured
   cloud, download the PNG. Free, offline, no watermark.
   --------------------------------------------------------------------------
   The paid sites (wordart and the like) do one genuinely useful thing: pack
   words tightly into a shape, sized by how often each appears. There is no
   reason that has to cost money or upload your text to someone's server, so
   this does it in the browser and hands you a PNG.

   How it works, which is the interesting part:

   1. Count. The text is tokenised, stop words ("the", "and", "of"…) are
      dropped, and what remains is counted. A word's size is its frequency —
      the whole point of a word cloud is that the biggest word is the most
      common one, so the sizing is the message.

   2. Place, largest first, on a spiral. Each word starts at the centre and
      walks outward along an Archimedean spiral until it finds a spot where it
      overlaps nothing already placed. Biggest words go down first and claim
      the middle; smaller ones fill the gaps around them. This greedy
      spiral-packing is the same idea the well-known d3-cloud layout uses.

   3. Stay inside the shape. A heart, a circle, a star — each is a mask, a
      predicate that says whether a point is inside it. A candidate position is
      only accepted if the word's box sits within the mask, so the cloud takes
      the shape rather than merely being clipped to it.

   The layout is deterministic given a seed, so "regenerate" with the same seed
   is reproducible, and a new seed reshuffles. Text measurement is injected —
   the browser uses a real canvas, the test harness a cheap approximation — so
   the packing logic can be tested without a canvas at all.

   Nothing here opens a network connection. Your text never leaves the tab.
   ========================================================================== */

/* global LabVizMulti */
(function (root) {
  'use strict';

  /* A compact English stop-word list. Not exhaustive — just the words whose
     presence in a cloud says nothing, because they are in every text. */
  var STOPWORDS = ('a an and are as at be but by for if in into is it no not of on or such that ' +
    'the their then there these they this to was will with from we you your i he she his her our ' +
    'us them him has have had do does did can could would should may might must shall about above ' +
    'after again all also am any because been before being below between both each few more most ' +
    'other some than too very just once here how what when where which who whom why over under out ' +
    'up down off then so only own same s t don now').split(/\s+/);
  var STOP = {};
  STOPWORDS.forEach(function (w) { STOP[w] = true; });

  /* Split text into lowercase word tokens. Apostrophes inside a word are kept
     ("don't"), everything else is a boundary. */
  function tokenize(text) {
    var out = [];
    var re = /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
    var m;
    while ((m = re.exec(String(text))) !== null) {
      out.push(m[0].toLowerCase().replace(/[’]/g, "'"));
    }
    return out;
  }

  /* Count word frequencies, dropping stop words and anything shorter than
     minLength, and return them sorted most-frequent first. Ties break
     alphabetically so the result is deterministic. */
  function countWords(text, opts) {
    opts = opts || {};
    var minLength = opts.minLength || 2;
    var useStops = opts.stopwords !== false;
    var extraStops = {};
    (opts.extraStopwords || []).forEach(function (w) { extraStops[String(w).toLowerCase()] = true; });

    var counts = {};
    tokenize(text).forEach(function (w) {
      if (w.length < minLength) return;
      if (useStops && STOP[w]) return;
      if (extraStops[w]) return;
      counts[w] = (counts[w] || 0) + 1;
    });

    var list = Object.keys(counts).map(function (w) { return { word: w, count: counts[w] }; });
    list.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.word < b.word ? -1 : (a.word > b.word ? 1 : 0);
    });
    return list;
  }

  /* A tiny seeded PRNG (mulberry32), so a given seed always lays the cloud out
     the same way and "regenerate" is reproducible. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ======================================================================== */
  /*  SHAPE MASKS                                                             */
  /* ------------------------------------------------------------------------ */
  /*  Each mask takes normalised coordinates in [-1, 1] and says whether the   */
  /*  point is inside the shape. Layout accepts a word only if its whole box    */
  /*  is inside, so the cloud fills the shape instead of being clipped to it.   */
  /* ======================================================================== */

  var SHAPES = {
    rectangle: function () { return true; },
    circle: function (x, y) { return x * x + y * y <= 1; },
    ellipse: function (x, y) { return (x * x) / 1 + (y * y) / 0.64 <= 1; },
    heart: function (x, y) {
      // classic implicit heart curve; y flipped so the point is at the bottom
      var yy = -y * 1.1 + 0.35;
      var xx = x * 1.1;
      var a = xx * xx + yy * yy - 1;
      return a * a * a - xx * xx * yy * yy * yy <= 0;
    },
    star: function (x, y) {
      // five-pointed star by angular radius
      var ang = Math.atan2(y, x);
      var r = Math.sqrt(x * x + y * y);
      var spikes = 5;
      var step = Math.PI / spikes;
      var a = ang + Math.PI / 2;
      a = ((a % (2 * step)) + 2 * step) % (2 * step);
      var edge = Math.abs(a - step) / step;         // 0 at valley, 1 at point
      var rr = 0.42 + 0.58 * edge;
      return r <= rr;
    },
    diamond: function (x, y) { return Math.abs(x) + Math.abs(y) <= 1; },
    cloud: function (x, y) {
      // union of a few discs makes a lumpy cloud
      var discs = [[0, 0.1, 0.55], [-0.5, 0.2, 0.38], [0.5, 0.2, 0.38],
                   [-0.25, -0.15, 0.45], [0.25, -0.15, 0.45]];
      for (var i = 0; i < discs.length; i++) {
        var dx = x - discs[i][0], dy = y - discs[i][1];
        if (dx * dx + dy * dy <= discs[i][2] * discs[i][2]) return true;
      }
      return false;
    }
  };
  var SHAPE_ORDER = ['rectangle', 'circle', 'ellipse', 'heart', 'star', 'diamond', 'cloud'];

  /* Does a box (centre cx,cy, half-width hw, half-height hh, in pixels) sit
     inside the mask for a canvas of the given size? Sampled at the four
     corners and the centre, which is enough at word scale. */
  function boxInMask(mask, cx, cy, hw, hh, width, height) {
    if (mask === SHAPES.rectangle) return true;
    var pts = [[cx, cy], [cx - hw, cy - hh], [cx + hw, cy - hh],
               [cx - hw, cy + hh], [cx + hw, cy + hh]];
    for (var i = 0; i < pts.length; i++) {
      var nx = (pts[i][0] / width) * 2 - 1;
      var ny = (pts[i][1] / height) * 2 - 1;
      if (!mask(nx, ny)) return false;
    }
    return true;
  }

  function overlaps(a, b) {
    return !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
  }

  /* ======================================================================== */
  /*  PIXEL-COLLISION PACKER                                                  */
  /* ------------------------------------------------------------------------ */
  /*  The pretty word clouds (wordart, wordcloud2.js) do not pack bounding      */
  /*  boxes — they pack PIXELS. Each word is rasterised to a little sprite, and */
  /*  a word is placed only where its inked pixels miss every pixel already     */
  /*  down. That is what lets a 'j' tuck under a 'T' and the whole thing fill    */
  /*  a shape tightly instead of leaving rectangular gaps.                      */
  /*                                                                            */
  /*  makeSprite(word, fontSize, vertical) -> { gw, gh, cells } is injected:    */
  /*  the browser rasterises on a canvas and downsamples to the grid; the test  */
  /*  harness hands over a filled rectangle. So the packing — the part with the */
  /*  bugs — is tested without a canvas, while the real rendering stays sharp.  */
  /*                                                                            */
  /*  Words are also REPEATED to fill: after every distinct word is placed, the */
  /*  list is cycled at shrinking sizes until the shape is full. That is why a  */
  /*  single word, or a short phrase, still fills a heart instead of floating    */
  /*  alone in the middle.                                                      */
  /* ======================================================================== */

  function packCloud(items, opts, makeSprite, maskFn) {
    opts = opts || {};
    var width = opts.width || 960;
    var height = opts.height || 600;
    var grid = opts.gridSize || 4;               // px per collision cell
    var maxFont = opts.maxFont || 120;
    var minFont = opts.minFont || 12;
    var maxWords = opts.maxWords || 120;
    var rotate = opts.rotate !== false;
    var fill = opts.fill !== false;
    // The mask is a predicate over normalised coords in [-1, 1]. The browser
    // passes one backed by a rasterised shape (a real heart, a real star), so
    // the silhouette is crisp; the test harness passes the implicit SHAPES
    // functions, which are enough to exercise the packing.
    var mask = maskFn || SHAPES[opts.shape] || SHAPES.rectangle;
    var rand = rng(opts.seed || 1);

    var gw = Math.ceil(width / grid);
    var gh = Math.ceil(height / grid);
    var occ = new Uint8Array(gw * gh);           // 0 free, 1 taken

    // Block every cell that falls outside the shape, so words can only land
    // inside it — the mask becomes the container, not a crop.
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var nx = ((gx + 0.5) / gw) * 2 - 1;
        var ny = ((gy + 0.5) / gh) * 2 - 1;
        if (!mask(nx, ny)) occ[gy * gw + gx] = 1;
      }
    }

    var base = items.slice(0, maxWords);
    if (!base.length) return { placed: [], skipped: 0, width: width, height: height, coverage: 0 };
    var maxCount = base[0].count;
    var minCount = base[base.length - 1].count;

    function fontFor(count, scale) {
      var t = maxCount === minCount ? 0.72
            : (Math.sqrt(count) - Math.sqrt(minCount)) / (Math.sqrt(maxCount) - Math.sqrt(minCount));
      return Math.max(minFont, Math.round((minFont + t * (maxFont - minFont)) * (scale || 1)));
    }

    // Does the sprite fit at grid origin (ox, oy) with nothing already there?
    function fits(sprite, ox, oy) {
      if (ox < 0 || oy < 0 || ox + sprite.gw > gw || oy + sprite.gh > gh) return false;
      var c = sprite.cells;
      for (var y = 0; y < sprite.gh; y++) {
        var row = (oy + y) * gw + ox;
        var srow = y * sprite.gw;
        for (var x = 0; x < sprite.gw; x++) {
          if (c[srow + x] && occ[row + x]) return false;
        }
      }
      return true;
    }
    function stamp(sprite, ox, oy) {
      var c = sprite.cells;
      for (var y = 0; y < sprite.gh; y++) {
        var row = (oy + y) * gw + ox;
        var srow = y * sprite.gw;
        for (var x = 0; x < sprite.gw; x++) {
          if (c[srow + x]) occ[row + x] = 1;
        }
      }
    }

    var placed = [];
    var cx = gw / 2, cy = gh / 2;
    var aspect = gh / gw;

    /* Spiral a word out from the centre until its pixels find a free spot. */
    function place(word, fontSize, vertical, colorSeed) {
      var sprite = makeSprite(word, fontSize, vertical);
      if (!sprite || !sprite.gw || !sprite.gh) return false;
      if (sprite.gw > gw || sprite.gh > gh) return false;
      var start = rand() * Math.PI * 2;
      var maxSteps = 3200;
      for (var step = 0; step < maxSteps; step++) {
        var ang = start + step * 0.22;
        var r = 0.9 * ang;
        if (r > gw) break;
        var gx2 = Math.round(cx + r * Math.cos(ang) - sprite.gw / 2);
        var gy2 = Math.round(cy + r * Math.sin(ang) * aspect - sprite.gh / 2);
        if (fits(sprite, gx2, gy2)) {
          stamp(sprite, gx2, gy2);
          placed.push({
            word: word, fontSize: fontSize, vertical: vertical,
            x: (gx2 + sprite.gw / 2) * grid, y: (gy2 + sprite.gh / 2) * grid,
            colorSeed: colorSeed
          });
          return true;
        }
      }
      return false;
    }

    // Pass 1: every distinct word once, largest first.
    var skipped = 0;
    for (var i = 0; i < base.length; i++) {
      var vert = rotate && i > 0 && rand() < 0.22;
      if (!place(base[i].word, fontFor(base[i].count), vert, rand())) skipped++;
    }

    // Fill pass: keep cycling the words at shrinking sizes so the shape fills
    // up — this is what turns one word, or a short phrase, into a full cloud
    // rather than a lonely label. Stops when the words get too small or a whole
    // sweep places almost nothing.
    if (fill) {
      var scale = 0.62;
      var hardCap = Math.min(700, opts.fillCap || 700);
      var scaleGuard = 0;
      while (scale > 0.16 && placed.length < hardCap && scaleGuard < 24) {
        scaleGuard++;
        // At each size, keep cycling the words and dropping them into whatever
        // gaps remain until a whole sweep lands nothing — THEN shrink. This is
        // what lets a single word tile a heart rather than being placed once
        // and abandoned.
        var dry = 0, sweepGuard = 0;
        while (placed.length < hardCap && dry < 1 && sweepGuard < 400) {
          sweepGuard++;
          var sweepPlaced = 0;
          for (var j = 0; j < base.length && placed.length < hardCap; j++) {
            var fs = fontFor(base[j].count, scale);
            if (fs < minFont) continue;
            var v = rotate && rand() < 0.3;
            if (place(base[j].word, fs, v, rand())) sweepPlaced++;
          }
          if (sweepPlaced === 0) dry++;
        }
        scale *= 0.8;
      }
    }

    var used = 0, avail = 0;
    for (var k = 0; k < occ.length; k++) { if (occ[k]) used++; }
    // available cells are those inside the shape (initially free)
    var inside = 0;
    for (var gy3 = 0; gy3 < gh; gy3++) {
      for (var gx3 = 0; gx3 < gw; gx3++) {
        var nnx = ((gx3 + 0.5) / gw) * 2 - 1;
        var nny = ((gy3 + 0.5) / gh) * 2 - 1;
        if (mask(nnx, nny)) inside++;
      }
    }
    var coverage = inside ? Math.min(1, placedCells(occ, gw, gh, mask) / inside) : 0;

    return { placed: placed, skipped: skipped, width: width, height: height,
             coverage: coverage, total: placed.length };
  }

  // Count occupied cells that are inside the shape (i.e. actually filled by
  // words, not the blocked-out surround).
  function placedCells(occ, gw, gh, mask) {
    var n = 0;
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var nx = ((gx + 0.5) / gw) * 2 - 1;
        var ny = ((gy + 0.5) / gh) * 2 - 1;
        if (mask(nx, ny) && occ[gy * gw + gx]) n++;
      }
    }
    return n;
  }

  var CORE = {
    STOPWORDS: STOPWORDS, tokenize: tokenize, countWords: countWords,
    rng: rng, SHAPES: SHAPES, SHAPE_ORDER: SHAPE_ORDER,
    boxInMask: boxInMask, overlaps: overlaps, packCloud: packCloud
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof root.LabWordCloud === 'undefined') root.LabWordCloud = CORE;
  if (typeof document === 'undefined') return;

  /* ======================================================================== */
  /*  UI                                                                      */
  /* ======================================================================== */

  var C = {
    bg0: '#020617', bg1: '#0b1220', line: '#1c2b44',
    ink: '#e2e8f0', dim: '#94a3b8', faint: '#64748b',
    cyan: '#7dd3fc', blue: '#38bdf8', green: '#34d399', amber: '#fbbf24'
  };
  var FONT = "'Cascadia Code','Fira Code',Consolas,Menlo,monospace";

  function E(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  /* Colour palettes: each is a list of hex swatches a word is coloured from,
     picked by the word's stored colorSeed so re-rendering is stable. */
  var PALETTES = {
    ocean: { label: 'Ocean', bg: '#0b1220', colors: ['#38bdf8', '#7dd3fc', '#22d3ee', '#34d399', '#a5f3fc'] },
    ember: { label: 'Ember', bg: '#1a0f0a', colors: ['#fb923c', '#f97316', '#fbbf24', '#fca5a5', '#f472b6'] },
    forest: { label: 'Forest', bg: '#0a140d', colors: ['#34d399', '#4ade80', '#a3e635', '#86efac', '#22c55e'] },
    candy: { label: 'Candy', bg: '#1a0f1a', colors: ['#f472b6', '#a78bfa', '#38bdf8', '#fbbf24', '#fb7185'] },
    mono: { label: 'Mono', bg: '#0b1220', colors: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#7dd3fc', '#f1f5f9'] },
    sunset: { label: 'Sunset', bg: '#160b1a', colors: ['#f97316', '#fb7185', '#a78bfa', '#fbbf24', '#f472b6'] },
    light: { label: 'Light (dark ink)', bg: '#f8fafc', colors: ['#0f172a', '#1d4ed8', '#b91c1c', '#047857', '#7c3aed'] }
  };
  var PALETTE_ORDER = ['ocean', 'ember', 'forest', 'candy', 'sunset', 'mono', 'light'];

  var FONTS = {
    sans: { label: 'Sans', css: '700 %spx system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
    serif: { label: 'Serif', css: '700 %spx Georgia, "Times New Roman", serif' },
    mono: { label: 'Mono', css: "700 %spx 'Cascadia Code', 'Fira Code', Consolas, monospace" },
    round: { label: 'Rounded', css: '800 %spx "Trebuchet MS", "Segoe UI", sans-serif' },
    condensed: { label: 'Condensed', css: '700 %spx "Arial Narrow", "Roboto Condensed", sans-serif' }
  };
  var FONT_ORDER = ['sans', 'serif', 'mono', 'round', 'condensed'];

  var SAMPLE = 'The quick brown fox jumps over the lazy dog. A word cloud shows which words appear ' +
    'most often by making them bigger. Paste your own text — an essay, a speech, a set of reviews, ' +
    'a book chapter — and the most frequent words rise to the top, sized by how often they occur. ' +
    'Common filler words like the and of and to are removed automatically, so what remains is the ' +
    'vocabulary that actually characterises your text. Words words words, meaning meaning, shape ' +
    'shape shape, colour colour, cloud cloud cloud cloud.';

  var EXTRA_CSS = [
    '#wordcloudviz .wc-wrap{font:13px/1.55 ' + FONT + ';color:' + C.ink + ';}',
    '#wordcloudviz .wc-body{display:grid;grid-template-columns:minmax(0,20rem) minmax(0,1fr);align-items:start;}',
    '@media (max-width:900px){#wordcloudviz .wc-body{grid-template-columns:minmax(0,1fr);}}',
    '#wordcloudviz .wc-side{padding:12px;border-right:1px solid ' + C.line + ';background:rgba(11,18,32,.6);min-width:0;}',
    '@media (max-width:900px){#wordcloudviz .wc-side{border-right:0;border-bottom:1px solid ' + C.line + ';}}',
    '#wordcloudviz .wc-main{padding:12px;min-width:0;display:flex;flex-direction:column;gap:10px;}',
    '#wordcloudviz .wc-group{margin:0 0 12px;}',
    '#wordcloudviz .wc-gt{margin:0 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:' + C.faint + ';}',
    '#wordcloudviz .wc-text{width:100%;min-height:8rem;font:12px/1.5 system-ui,sans-serif;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:8px;resize:vertical;}',
    '#wordcloudviz .wc-field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 7px;}',
    '#wordcloudviz .wc-field label{font-size:12px;color:' + C.dim + ';}',
    '#wordcloudviz .wc-select{font:inherit;font-size:12px;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:5px 7px;max-width:11rem;}',
    '#wordcloudviz .wc-num{width:4.2rem;font:inherit;color:' + C.ink + ';background:#0d1729;border:1px solid #2a3d5c;border-radius:6px;padding:4px 6px;text-align:right;}',
    '#wordcloudviz .wc-range{width:9rem;accent-color:' + C.blue + ';}',
    '#wordcloudviz .wc-check{display:flex;align-items:center;gap:7px;font-size:12px;color:' + C.dim + ';margin:0 0 7px;cursor:pointer;}',
    '#wordcloudviz .wc-check input{accent-color:' + C.blue + ';}',
    '#wordcloudviz .wc-btn{font:inherit;font-size:12px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:7px;padding:8px 12px;cursor:pointer;}',
    '#wordcloudviz .wc-btn:hover{background:#213152;border-color:#40608f;}',
    '#wordcloudviz .wc-btn-primary{color:#04121f;background:' + C.cyan + ';border-color:' + C.cyan + ';font-weight:700;}',
    '#wordcloudviz .wc-btnrow{display:flex;flex-wrap:wrap;gap:6px;}',
    '#wordcloudviz .wc-hint{margin:6px 0 0;font-size:11px;line-height:1.55;color:' + C.faint + ';}',
    '#wordcloudviz .wc-shapes{display:flex;flex-wrap:wrap;gap:5px;}',
    '#wordcloudviz .wc-shape{font:inherit;font-size:11px;color:' + C.dim + ';background:#131f36;border:1px solid #253651;border-radius:7px;padding:6px 9px;cursor:pointer;}',
    '#wordcloudviz .wc-shape.on{color:#04121f;background:' + C.blue + ';border-color:' + C.blue + ';font-weight:700;}',
    '#wordcloudviz .wc-swatches{display:flex;gap:3px;}',
    '#wordcloudviz .wc-sw{width:14px;height:14px;border-radius:3px;}',
    '#wordcloudviz .wc-canvaswrap{border:1px solid ' + C.line + ';border-radius:10px;overflow:hidden;background:#0b1220;}',
    '#wordcloudviz .wc-canvas{display:block;width:100%;height:auto;}',
    '#wordcloudviz .wc-status{font-size:11px;color:' + C.faint + ';}',
    '#wordcloudviz .wc-note{min-height:1.6rem;padding:8px 11px;border-left:3px solid ' + C.cyan + ';background:rgba(125,211,252,.06);border-radius:0 8px 8px 0;font-size:12px;color:#cbd5e1;}'
  ].join('');

  function selectBox(options, value, onChange) {
    var el = E('select', 'wc-select');
    options.forEach(function (o) {
      var op = E('option', null, o.label);
      op.value = o.key;
      if (o.key === value) op.selected = true;
      el.appendChild(op);
    });
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }

  function WordCloudApp(mount) {
    var self = this;
    this.opts = {
      shape: 'circle', palette: 'ocean', font: 'sans',
      maxWords: 80, minFont: 16, maxFont: 110, rotate: true, stopwords: true,
      seed: 1, width: 960, height: 600
    };
    this.text = SAMPLE;

    var style = E('style');
    style.textContent = EXTRA_CSS;
    mount.appendChild(style);

    var wrap = E('div', 'wc-wrap');
    var body = E('div', 'wc-body');
    var side = E('div', 'wc-side');
    var main = E('div', 'wc-main');

    // --- text ---
    var gText = E('div', 'wc-group');
    gText.appendChild(E('p', 'wc-gt', 'Your text'));
    this.textArea = E('textarea', 'wc-text');
    this.textArea.value = this.text;
    this.textArea.spellcheck = false;
    gText.appendChild(this.textArea);
    var trow = E('div', 'wc-btnrow');
    trow.appendChild(this.btn('Clear', function () { self.textArea.value = ''; }));
    trow.appendChild(this.btn('Restore sample', function () { self.textArea.value = SAMPLE; }));
    gText.appendChild(trow);
    side.appendChild(gText);

    // --- shape ---
    var gShape = E('div', 'wc-group');
    gShape.appendChild(E('p', 'wc-gt', 'Shape'));
    var shapes = E('div', 'wc-shapes');
    this.shapeBtns = {};
    var shapeLabels = { rectangle: 'Rectangle', circle: 'Circle', ellipse: 'Ellipse',
      heart: 'Heart', star: 'Star', diamond: 'Diamond', cloud: 'Cloud' };
    SHAPE_ORDER.forEach(function (s) {
      var b = E('button', 'wc-shape' + (s === self.opts.shape ? ' on' : ''), shapeLabels[s]);
      b.type = 'button';
      b.addEventListener('click', function () {
        self.opts.shape = s;
        SHAPE_ORDER.forEach(function (k) { self.shapeBtns[k].className = 'wc-shape' + (k === s ? ' on' : ''); });
        self.generate();
      });
      self.shapeBtns[s] = b;
      shapes.appendChild(b);
    });
    gShape.appendChild(shapes);
    side.appendChild(gShape);

    // --- colours + font ---
    var gStyle = E('div', 'wc-group');
    gStyle.appendChild(E('p', 'wc-gt', 'Style'));
    var palField = E('div', 'wc-field');
    palField.appendChild(E('label', null, 'Colours'));
    palField.appendChild(selectBox(PALETTE_ORDER.map(function (k) { return { key: k, label: PALETTES[k].label }; }),
      this.opts.palette, function (v) { self.opts.palette = v; self.render(); }));
    gStyle.appendChild(palField);
    var fontField = E('div', 'wc-field');
    fontField.appendChild(E('label', null, 'Font'));
    fontField.appendChild(selectBox(FONT_ORDER.map(function (k) { return { key: k, label: FONTS[k].label }; }),
      this.opts.font, function (v) { self.opts.font = v; self.generate(); }));
    gStyle.appendChild(fontField);
    side.appendChild(gStyle);

    // --- tuning ---
    var gTune = E('div', 'wc-group');
    gTune.appendChild(E('p', 'wc-gt', 'Tuning'));
    var mwField = E('div', 'wc-field');
    mwField.appendChild(E('label', null, 'Max words'));
    this.maxWordsInput = E('input', 'wc-num');
    this.maxWordsInput.type = 'number';
    this.maxWordsInput.min = '5'; this.maxWordsInput.max = '200';
    this.maxWordsInput.value = String(this.opts.maxWords);
    this.maxWordsInput.addEventListener('change', function () {
      self.opts.maxWords = Math.max(5, Math.min(200, parseInt(self.maxWordsInput.value, 10) || 80));
      self.generate();
    });
    mwField.appendChild(this.maxWordsInput);
    gTune.appendChild(mwField);

    this.rotCheck = this.checkbox('Rotate some words', this.opts.rotate, function (v) {
      self.opts.rotate = v; self.generate();
    });
    gTune.appendChild(this.rotCheck);
    this.stopCheck = this.checkbox('Remove common filler words', this.opts.stopwords, function (v) {
      self.opts.stopwords = v; self.generate();
    });
    gTune.appendChild(this.stopCheck);
    side.appendChild(gTune);

    // --- actions ---
    var actions = E('div', 'wc-btnrow');
    actions.appendChild(this.btn('Generate', function () { self.opts.seed = 1; self.generate(); }, true));
    actions.appendChild(this.btn('Shuffle', function () { self.opts.seed = (self.opts.seed + 1) % 100000 + 1; self.generate(); }));
    this.dlBtn = this.btn('Download PNG', function () { self.download(); });
    actions.appendChild(this.dlBtn);
    side.appendChild(actions);
    side.appendChild(E('p', 'wc-hint', 'Everything happens in your browser — your text is never uploaded. ' +
      'The PNG downloads straight from the page.'));

    // --- canvas ---
    this.noteHost = E('div', 'wc-note');
    main.appendChild(this.noteHost);
    var cw = E('div', 'wc-canvaswrap');
    this.canvas = E('canvas', 'wc-canvas');
    /* The packer works in a fixed 960x600 logical space — every placement,
       font size and mask test is in those units — so both HiDPI sharpness and
       a usable export are the same one change: a bigger backing store with a
       matching transform in render(), no second coordinate system.

       The floor of 2 rather than plain devicePixelRatio is deliberate. The
       canvas is laid out at CSS width:100% of the main column, which on a
       desktop is already wider than 960, so even at DPR 1 a 960-wide buffer
       was being stretched; and the Download PNG button was handing back a
       960x600 image, too small to drop into a slide or print at any size.
       At 2 that becomes 1920x1200, which is usable for both. The cap of 3
       holds the buffer at 2880x1800 — around 20MB of pixels — past which
       toBlob stalls noticeably on modest hardware for detail nobody sees.
       Both attributes scale together, so the aspect ratio the CSS box derives
       from them is unchanged. */
    var dpr = window.devicePixelRatio || 1;
    this.scale = Math.max(2, Math.min(3, Math.round(dpr)));
    this.canvas.width = this.opts.width * this.scale;
    this.canvas.height = this.opts.height * this.scale;
    cw.appendChild(this.canvas);
    main.appendChild(cw);
    this.statusHost = E('div', 'wc-status');
    main.appendChild(this.statusHost);

    body.appendChild(side);
    body.appendChild(main);
    wrap.appendChild(body);
    mount.appendChild(wrap);

    this.generate();
  }

  WordCloudApp.prototype.btn = function (label, onClick, primary) {
    var b = E('button', 'wc-btn' + (primary ? ' wc-btn-primary' : ''), label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  WordCloudApp.prototype.checkbox = function (label, checked, onChange) {
    var l = E('label', 'wc-check');
    var box = E('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', function () { onChange(box.checked); });
    l.appendChild(box);
    l.appendChild(document.createTextNode(label));
    return l;
  };

  /* A sprite factory for the pixel packer: rasterise the word on a scratch
     canvas, then downsample to the packer's grid so collision is per-pixel but
     cheap. A one-cell dilation leaves a hair of breathing room between words so
     they do not visually touch. */
  WordCloudApp.prototype.spriteMaker = function (grid) {
    var fontCss = FONTS[this.opts.font].css;
    if (!this._tmp) { this._tmp = document.createElement('canvas'); }
    var tmp = this._tmp;
    var tctx = tmp.getContext('2d', { willReadFrequently: true });
    return function (word, fontSize, vertical) {
      tctx.font = fontCss.replace('%s', fontSize);
      var m = tctx.measureText(word);
      var pad = 3;
      var textW = Math.ceil(m.width) + pad * 2;
      var textH = Math.ceil(fontSize * 1.25) + pad * 2;
      var w = vertical ? textH : textW;
      var h = vertical ? textW : textH;
      if (w < 1 || h < 1) return null;
      tmp.width = w; tmp.height = h;
      tctx.clearRect(0, 0, w, h);
      tctx.font = fontCss.replace('%s', fontSize);
      tctx.textAlign = 'center';
      tctx.textBaseline = 'middle';
      tctx.fillStyle = '#fff';
      tctx.save();
      tctx.translate(w / 2, h / 2);
      if (vertical) tctx.rotate(-Math.PI / 2);
      tctx.fillText(word, 0, 0);
      tctx.restore();

      var img = tctx.getImageData(0, 0, w, h).data;
      var sgw = Math.max(1, Math.ceil(w / grid));
      var sgh = Math.max(1, Math.ceil(h / grid));
      var raw = new Uint8Array(sgw * sgh);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (img[(y * w + x) * 4 + 3] > 40) raw[Math.floor(y / grid) * sgw + Math.floor(x / grid)] = 1;
        }
      }
      // dilate by one cell so words keep a pixel of air between them
      var cells = new Uint8Array(sgw * sgh);
      for (var cy = 0; cy < sgh; cy++) {
        for (var cx = 0; cx < sgw; cx++) {
          if (!raw[cy * sgw + cx]) continue;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var ny = cy + dy, nx = cx + dx;
              if (ny >= 0 && ny < sgh && nx >= 0 && nx < sgw) cells[ny * sgw + nx] = 1;
            }
          }
        }
      }
      return { gw: sgw, gh: sgh, cells: cells };
    };
  };

  /* Raw polygon outline for the shapes that are not canvas primitives, in a
     y-up unit-ish space; the caller fits it to the canvas preserving aspect. */
  function shapePolygon(shape) {
    var pts = [], t, i;
    if (shape === 'heart') {
      // the classic parametric heart; y negated so the point sits at the bottom
      for (t = 0; t < Math.PI * 2; t += 0.04) {
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push([hx, hy]);
      }
    } else if (shape === 'star') {
      for (i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5;
        var r = (i % 2 === 0) ? 1 : 0.4;
        pts.push([Math.cos(a) * r, -Math.sin(a) * r]);
      }
    } else if (shape === 'diamond') {
      pts = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    }
    return pts;
  }

  /* Build a rasterised mask at the packer's grid resolution and return a
     predicate over normalised [-1,1] coords. Drawing the shape with real
     canvas paths — rather than an implicit inequality — is what makes a heart
     look like a heart and a star like a star. */
  WordCloudApp.prototype.buildMask = function (shape, gw, gh) {
    var c = document.createElement('canvas');
    c.width = gw; c.height = gh;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000';
    x.fillRect(0, 0, gw, gh);
    x.fillStyle = '#fff';
    var cx = gw / 2, cy = gh / 2;
    var mx = gw * 0.5 * 0.97, my = gh * 0.5 * 0.95;

    if (shape === 'rectangle') {
      x.fillRect(0, 0, gw, gh);
    } else if (shape === 'circle') {
      var r = Math.min(mx, my);
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    } else if (shape === 'ellipse') {
      x.beginPath(); x.ellipse(cx, cy, mx, my, 0, 0, Math.PI * 2); x.fill();
    } else if (shape === 'cloud') {
      [[0, 0.12, 0.55], [-0.5, 0.22, 0.4], [0.5, 0.22, 0.4],
       [-0.26, -0.16, 0.5], [0.28, -0.14, 0.5], [0, -0.05, 0.6]].forEach(function (d) {
        x.beginPath();
        x.ellipse(cx + d[0] * mx, cy - d[1] * my, d[2] * mx, d[2] * my, 0, 0, Math.PI * 2);
        x.fill();
      });
    } else {
      // polygon shapes, fitted to the box with aspect ratio preserved
      var pts = shapePolygon(shape);
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      pts.forEach(function (p) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      });
      var spanX = maxX - minX, spanY = maxY - minY;
      var scale = Math.min((mx * 2) / spanX, (my * 2) / spanY);
      var ox = cx - (minX + maxX) / 2 * scale;
      var oy = cy + (minY + maxY) / 2 * scale;   // + because canvas y is down and our y is up
      x.beginPath();
      pts.forEach(function (p, i) {
        var px = ox + p[0] * scale;
        var py = oy - p[1] * scale;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      });
      x.closePath();
      x.fill();
    }

    var d = x.getImageData(0, 0, gw, gh).data;
    var cells = new Uint8Array(gw * gh);
    for (var i = 0; i < gw * gh; i++) cells[i] = d[i * 4] > 128 ? 1 : 0;
    return function (nx, ny) {
      var gx = Math.floor((nx + 1) / 2 * gw);
      var gy = Math.floor((ny + 1) / 2 * gh);
      if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
      if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
      return cells[gy * gw + gx] === 1;
    };
  };

  WordCloudApp.prototype.generate = function () {
    this.text = this.textArea.value;
    this.items = countWords(this.text, { stopwords: this.opts.stopwords, minLength: 2 });
    if (!this.items.length) {
      this.result = { placed: [], skipped: 0, width: this.opts.width, height: this.opts.height, coverage: 0 };
      this.noteHost.textContent = 'Paste some text and press Generate. The most frequent words become the biggest.';
      this.render();
      return;
    }
    var grid = 4;
    var gw = Math.ceil(this.opts.width / grid), gh = Math.ceil(this.opts.height / grid);
    var maskFn = this.buildMask(this.opts.shape, gw, gh);
    this.result = packCloud(this.items, {
      width: this.opts.width, height: this.opts.height, shape: this.opts.shape,
      maxWords: this.opts.maxWords, minFont: this.opts.minFont, maxFont: this.opts.maxFont,
      rotate: this.opts.rotate, seed: this.opts.seed, gridSize: grid, fill: true
    }, this.spriteMaker(grid), maskFn);
    var top = this.items.slice(0, 3).map(function (w) { return w.word + ' (' + w.count + ')'; }).join(', ');
    this.noteHost.textContent = this.result.total + ' words placed from ' +
      this.items.length + ' unique (repeated to fill the shape). Most frequent: ' + top + '.';
    this.render();
  };

  WordCloudApp.prototype.render = function () {
    /* No willReadFrequently here, unlike the two scratch canvases that really
       do call getImageData: this one is only ever drawn to and handed to
       toBlob. The hint forces a software backing store, and the buffer is now
       four to nine times the pixels it used to be — exactly the case where
       giving up the GPU path costs the most. */
    var ctx = this.canvas.getContext('2d');
    var pal = PALETTES[this.opts.palette];
    var fontCss = FONTS[this.opts.font].css;
    // one transform, so everything below stays in the packer's 960x600 units
    var s = this.scale || 1;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, this.opts.width, this.opts.height);
    if (!this.result) return;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.result.placed.forEach(function (p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.vertical) ctx.rotate(-Math.PI / 2);
      ctx.font = fontCss.replace('%s', p.fontSize);
      ctx.fillStyle = pal.colors[Math.floor(p.colorSeed * pal.colors.length) % pal.colors.length];
      ctx.fillText(p.word, 0, 0);
      ctx.restore();
    });

    var cov = Math.round((this.result.coverage || 0) * 100);
    this.statusHost.textContent = this.canvas.width + '×' + this.canvas.height + ' px  ·  ' +
      cov + '% of the shape filled';
  };

  /* Export the canvas as a PNG the visitor can save. On a normally-served page
     an <a download> of a blob URL saves the file; there is no upload. */
  WordCloudApp.prototype.download = function () {
    var self = this;
    this.canvas.toBlob(function (blob) {
      if (!blob) { self.statusHost.textContent = 'Could not create the image on this browser.'; return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'wordcloud-' + self.opts.shape + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  };

  /* ======================================================================== */
  /*  BOOT                                                                    */
  /* ======================================================================== */

  var built = false;
  function boot() {
    if (built) return;
    var rootEl = document.getElementById('wordcloudviz');
    if (!rootEl) return;
    built = true;
    var mount = document.getElementById('viz-wordcloud-mount') || rootEl;
    clear(mount);
    try {
      // eslint-disable-next-line no-new
      new WordCloudApp(mount);
    } catch (err) {
      mount.appendChild(E('p', 'lab-proc-fallback',
        'The word cloud generator could not start in this browser (' + err.message +
        '). Please tell me, and mention which browser you are using.'));
    }
  }

  if (typeof root.LabViz !== 'undefined' && root.LabViz.define) {
    root.LabViz.define({ id: 'wordcloudviz', onReady: boot });
  } else if (document.readyState !== 'loading') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

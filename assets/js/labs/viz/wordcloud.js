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

   2. Place, largest first, by pixels. Every cell inside the shape is a
      candidate position, ordered nearest-the-centre first; a word takes the
      first one where none of ITS OWN INKED PIXELS touch a pixel already used.
      Testing pixels rather than boxes is what lets a small word tuck into the
      bowl of a big letter — the paid tools call this "words inside letters"
      and it is most of why their clouds look packed.

   3. Fill, down a ladder of sizes. After every distinct word is placed once,
      the list is cycled again at steadily smaller sizes, down to about 5px.
      That tail is not decoration: it is what traces the outline. Without small
      words a heart is a blob and a star is a lumpy asterisk, because nothing
      is small enough to reach into the cleft or the points.

   4. Stay inside the shape. A heart, a star, or any letter or emoji the
      machine can draw, is rasterised into a mask, and every cell outside it
      starts out marked as used — so the shape is the container the words grow
      into, not a crop applied afterwards.

   The layout is deterministic given a seed, so "regenerate" with the same seed
   is reproducible, and a new seed reshuffles. Text measurement is injected —
   the browser uses a real canvas, the test harness a cheap approximation — so
   the packing logic can be tested without a canvas at all.

   Nothing here opens a network connection. Your text never leaves the tab.
   ========================================================================== */

/* global LabViz */
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
     ("don't"), everything else is a boundary.

     Three strategies, best first. The original was a single [A-Za-z0-9] regex,
     which quietly produced an EMPTY CLOUD for anything that is not English:
     Chinese, Japanese, Hindi, Gujarati, Greek and Cyrillic matched nothing at
     all, and French or Spanish lost every accented word — "café" came out as
     "caf". A tool that offers to make a picture of your text should not
     silently ignore most of the world's text.

     Intl.Segmenter is the only one of the three that can split languages which
     do not put spaces between words, so it is preferred where it exists. */
  var segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    }
  } catch (e) { segmenter = null; }

  var UNICODE_WORD = null;
  try {
    UNICODE_WORD = new RegExp("[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*", 'gu');
  } catch (e2) { UNICODE_WORD = null; }

  function tokenize(text) {
    var out = [];
    var s = String(text);
    if (segmenter) {
      var it = segmenter.segment(s);
      // Symbol.iterator is how Segments is walked; for..of is not available in
      // this file's style, so drive the iterator directly.
      var iter = it[Symbol.iterator]();
      var step = iter.next();
      while (!step.done) {
        var seg = step.value;
        if (seg.isWordLike) out.push(seg.segment.toLowerCase().replace(/’/g, "'"));
        step = iter.next();
      }
      return out;
    }
    var re = UNICODE_WORD || /[A-Za-z0-9][A-Za-z0-9'’-]*/g;
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      out.push(m[0].toLowerCase().replace(/’/g, "'"));
      if (m[0].length === 0) re.lastIndex++;      // never spin on an empty match
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

    /* A single letter is noise in English, but a single character is an
       ordinary word in Chinese and Japanese, so the minimum length does not
       apply to them — otherwise the filter that exists to drop stray initials
       would throw away most of a Chinese text. */
    var IDEOGRAPH = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

    var counts = {};
    tokenize(text).forEach(function (w) {
      if (w.length < minLength && !IDEOGRAPH.test(w)) return;
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
    /* The floor for the fill pass's size ladder. Separate from minFont, which
       is the floor for the words the visitor actually chose: those stay
       readable, while the filler tail is allowed to get small enough to draw
       the outline. Below about 5px a word is a smudge rather than a word. */
    var fillMinFont = Math.max(5, opts.fillMinFont || 7);
    /* The set of angles, in degrees, a word may be drawn at; null means any
       angle at all. Sampled once per placement. */
    var angleSet = opts.angleSet === null ? null
                 : (opts.angleSet && opts.angleSet.length ? opts.angleSet : [0, 0, 0, 0, 0, 0, 0, 90]);
    function pickAngle() {
      if (!rotate) return 0;
      if (angleSet === null) return rand() * Math.PI * 2;
      return angleSet[Math.floor(rand() * angleSet.length) % angleSet.length] * Math.PI / 180;
    }
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

    /* A word's size from its frequency, in pixels. Deliberately NOT clamped to
       minFont: the fill pass walks this function down a ladder of shrinking
       sizes, and a clamp here silently flattened the whole tail of that ladder
       onto minFont — every rare word came out at exactly minFont at every rung,
       so each sweep re-tried sizes it had already placed, found nothing, and
       declared the level dry. The cloud therefore had no small words at all,
       which is what stopped the shapes reading: it is the tail of 6-12px words
       that traces a heart's cleft or a star's points. Callers apply their own
       floor — pass 1 uses minFont so every distinct word stays legible, the
       fill pass uses the much lower fillMinFont. */
    function fontFor(count, scale) {
      var t = maxCount === minCount ? 0.72
            : (Math.sqrt(count) - Math.sqrt(minCount)) / (Math.sqrt(maxCount) - Math.sqrt(minCount));
      return Math.round((minFont + t * (maxFont - minFont)) * (scale || 1));
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
    /* The number of full sprite-collision tests a word may pay for before it is
       given up on. This is the knob that bounds the whole layout: the fill pass
       only stops when a sweep places nothing, and such a sweep has paid this
       cost for every word in it. */
    var MAX_TRIES = opts.maxTries || 900;

    /* A ceiling on total collision tests for the whole layout.

       Needed because the fill pass stops on evidence, not on a count: it sweeps
       the word list until a sweep places nothing. With a large vocabulary that
       is a lot of sweeps of a lot of words, and a 3000-unique-word paste was
       taking six and a half seconds with the tab frozen for all of it.

       It is a count of tests rather than a stopwatch on purpose. A time budget
       would make the picture depend on how fast the machine is, and the seed is
       supposed to mean that the same text and the same seed give the same cloud
       anywhere — which is what makes "shuffle" a reversible decision. */
    var workBudget = opts.workBudget || 700000;
    var work = 0;

    /* CANDIDATE ANCHORS.

       Every cell inside the shape, ordered nearest-the-centre first, is a
       position a word may be centred on. Words walk this list and take the
       first spot they fit, which reproduces the familiar biggest-in-the-middle
       look without any spiral arithmetic.

       This replaces spiralling outward from the centre per word. A spiral has
       to trade off between sampling densely and reaching the rim: stepping
       along it by roughly a cell, reaching the far corner of a 320x200 grid
       costs around fifty thousand candidate positions, and doing that for every
       word of every sweep is not affordable. Stepping coarsely instead — which
       is what the original code did — leaves most of the board unoffered, and
       words that would have fitted somewhere simply do not get placed. The list
       has neither problem: it is built once, it covers every cell exactly once,
       and skipping an occupied cell costs a single array lookup. */
    var anchors = [];
    for (var ay0 = 0; ay0 < gh; ay0++) {
      for (var ax0 = 0; ax0 < gw; ax0++) {
        if (!occ[ay0 * gw + ax0]) anchors.push(ay0 * gw + ax0);
      }
    }
    // normalised distance, so the ordering is elliptical and matches the canvas
    // rather than being circular on a non-square board
    anchors.sort(function (a, b) {
      var axa = (a % gw - cx) / gw, aya = ((a / gw | 0) - cy) / gh;
      var axb = (b % gw - cx) / gw, ayb = ((b / gw | 0) - cy) / gh;
      return (axa * axa + aya * aya) - (axb * axb + ayb * ayb);
    });
    /* As the board fills, most of the list is occupied cells that every word
       walks past. Dropping them keeps later sweeps cheap. */
    function compactAnchors() {
      var out = [];
      for (var k = 0; k < anchors.length; k++) if (!occ[anchors[k]]) out.push(anchors[k]);
      anchors = out;
    }

    /* Spiral a word out from the centre until its pixels find a free spot.

       The angle step is 1/r rather than a constant. On an Archimedean spiral
       the distance between two samples an angle dø apart is about r·dø, so a
       constant step spreads the candidates further and further apart as the
       spiral winds out: at the old 0.22 rad, positions 200px from the centre
       were sampled every 44px. Anything that would have fitted in a gap
       between two of those samples was simply never offered it, which is why
       small words failed to find the crevices they were meant to fill and the
       outlines of the shapes stayed ragged. Stepping by 1/r keeps the samples
       roughly a cell apart the whole way out. */
    function place(word, fontSize, angle, colorSeed, spread) {
      var sprite = makeSprite(word, fontSize, angle);
      if (!sprite || !sprite.gw || !sprite.gh) return false;
      if (sprite.gw > gw || sprite.gh > gh) return false;
      // sprites from the browser are cropped to their ink and carry the offset
      // back to the text origin; the test harness's plain rectangles do not
      var offX = sprite.offX == null ? sprite.gw * grid / 2 : sprite.offX;
      var offY = sprite.offY == null ? sprite.gh * grid / 2 : sprite.offY;
      var n = anchors.length;
      if (!n) return false;
      /* Where in the ordered list to begin, and the walk wraps around so that
         wherever it starts it can still reach everywhere.

         The big words of pass 1 start at the front and so take the middle,
         which is the whole point of the ordering. Filler words start anywhere.
         That is not a cosmetic choice: a filler word may only pay for
         MAX_TRIES collision tests, and a nearly-full board is full of little
         free pockets too small for anything, so a word that always started at
         the centre spent its whole budget failing in the middle and never
         reached the edges. The shapes came out as rounded blobs with empty
         corners because of it. */
      var start = spread ? Math.floor(rand() * n) : Math.floor(rand() * Math.min(n, 48));
      var tested = 0;
      for (var i2 = 0; i2 < n && tested < MAX_TRIES; i2++) {
        var k = start + i2; if (k >= n) k -= n;
        var idx = anchors[k];
        if (occ[idx]) continue;                    // O(1); does not use up a try
        var gx2 = (idx % gw) - (sprite.gw >> 1);
        var gy2 = ((idx / gw) | 0) - (sprite.gh >> 1);
        tested++; work++;
        if (fits(sprite, gx2, gy2)) {
          stamp(sprite, gx2, gy2);
          placed.push({
            word: word, fontSize: fontSize, angle: angle,
            x: gx2 * grid + offX, y: gy2 * grid + offY,
            colorSeed: colorSeed
          });
          return true;
        }
      }
      return false;
    }

    // Pass 1: every distinct word once, largest first, never below minFont so
    // the words the visitor actually came for stay readable.
    var skipped = 0;
    for (var i = 0; i < base.length; i++) {
      // the single biggest word always lies flat; it is the one the reader
      // takes the cloud's meaning from, so it should never be on its side
      var ang0 = i === 0 ? 0 : pickAngle();
      if (!place(base[i].word, Math.max(minFont, fontFor(base[i].count)), ang0, rand())) skipped++;
    }

    /* Fill pass: walk DOWN A LADDER OF ABSOLUTE SIZES, and at each rung keep
       cycling the words into whatever gaps remain until a sweep lands nothing.
       Absolute sizes rather than a shrinking multiplier of each word's own size,
       because the multiplier version collapsed: every rare word bottomed out at
       the same clamped size on the first rung and the ladder stopped descending.

       The ladder is what makes the picture. A shape only reads — a heart's
       cleft, a star's points — when there is a smooth cascade of sizes with a
       tail small enough to trace the outline, so this runs from a little over
       half the largest word down to fillMinFont in gentle 0.82 steps. */
    if (fill) {
      var hardCap = opts.fillCap || 1400;
      /* The filler cycles the most frequent words only, not the whole
         vocabulary. Sweeping 200 words to find room for the two hundredth is
         most of the cost of a big paste, and the repeats that read well are the
         ones the reader already recognises from the large sizes — a cloud whose
         filler is a tail of words seen exactly once just looks noisy. */
      var fillWords = base.slice(0, Math.min(base.length, opts.fillVocab || 60));
      var rung = Math.round(maxFont * 0.55);
      var rungGuard = 0;
      while (rung >= fillMinFont && placed.length < hardCap && rungGuard < 40 && work < workBudget) {
        rungGuard++;
        /* Sweep the words repeatedly at this size, but DROP A WORD FROM THE
           RUNG THE FIRST TIME IT FAILS. Cells only ever go from free to taken,
           so a word that would not fit at this size a moment ago will not fit
           at this size now either — re-offering it is guaranteed wasted work,
           and re-offering it was most of the cost of the whole layout. The
           previous version instead swept until two consecutive sweeps placed
           nothing, which meant paying the full search cost for every word that
           could not fit, twice over, at every rung. */
        var alive = fillWords;
        while (alive.length && placed.length < hardCap && work < workBudget) {
          var next = [];
          for (var j = 0; j < alive.length && placed.length < hardCap; j++) {
            var fs = Math.min(rung, Math.max(fillMinFont, fontFor(alive[j].count, 0.9)));
            if (place(alive[j].word, fs, pickAngle(), rand(), true)) next.push(alive[j]);
          }
          alive = next;
        }
        compactAnchors();
        rung = Math.floor(rung * 0.82);
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
             coverage: coverage, total: placed.length, work: work };
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

  /* Colour palettes. Each is a background plus an ordered list of inks, and the
     order matters: colour is assigned BY SIZE RANK, so the first swatch is what
     the biggest, most-read words get and the last is what the small filler
     tail gets. Picking a colour at random per word — which is what this used to
     do — gives a cloud with no focal point, where a filler word can shout
     louder than the headline. Ranked assignment is why the reference clouds
     look composed rather than confetti.

     Light backgrounds come first because dark ink on white is what the
     reference work almost always is, and it is what prints and pastes into a
     slide without a fight. */
  var PALETTES = {
    ink:     { label: 'Ink on white', bg: '#ffffff', colors: ['#0f172a', '#1d4ed8', '#b91c1c', '#047857', '#7c3aed', '#c2410c', '#0e7490'] },
    bloom:   { label: 'Bloom', bg: '#ffffff', colors: ['#be123c', '#db2777', '#9333ea', '#4f46e5', '#0891b2', '#e11d48', '#7c3aed'] },
    meadow:  { label: 'Meadow', bg: '#ffffff', colors: ['#15803d', '#0f766e', '#4d7c0f', '#166534', '#0891b2', '#65a30d', '#047857'] },
    autumn:  { label: 'Autumn', bg: '#fffbf5', colors: ['#9a3412', '#b45309', '#a16207', '#c2410c', '#78350f', '#ca8a04', '#7c2d12'] },
    slate:   { label: 'Slate', bg: '#ffffff', colors: ['#0f172a', '#334155', '#475569', '#64748b', '#1e293b', '#94a3b8', '#334155'] },
    ocean:   { label: 'Ocean (dark)', bg: '#0b1220', colors: ['#7dd3fc', '#38bdf8', '#22d3ee', '#34d399', '#a5f3fc', '#67e8f9', '#5eead4'] },
    ember:   { label: 'Ember (dark)', bg: '#1a0f0a', colors: ['#fbbf24', '#fb923c', '#f97316', '#fca5a5', '#f472b6', '#fcd34d', '#fb7185'] },
    candy:   { label: 'Candy (dark)', bg: '#160b1a', colors: ['#f472b6', '#a78bfa', '#38bdf8', '#fbbf24', '#fb7185', '#c4b5fd', '#5eead4'] },
    mono:    { label: 'Mono (dark)', bg: '#0b1220', colors: ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#7dd3fc', '#cbd5e1', '#94a3b8'] }
  };
  var PALETTE_ORDER = ['ink', 'bloom', 'meadow', 'autumn', 'slate', 'ocean', 'ember', 'candy', 'mono'];

  /* How a word's colour is chosen. "rank" is the composed default described
     above; "random" is the old behaviour, kept because it genuinely suits a
     playful cloud; "single" is for when the cloud has to sit inside someone
     else's brand. */
  var COLOR_MODES = {
    rank:   { label: 'By word size' },
    random: { label: 'Mixed' },
    single: { label: 'One colour' }
  };
  var COLOR_MODE_ORDER = ['rank', 'random', 'single'];

  /* Which way up the words go. Both reference tools model this the same way and
     it is worth copying exactly: not a "rotate?" switch, but A SET OF ALLOWED
     ANGLES sampled once per word. Repeats in the list are how a set is
     weighted — 'Mostly horizontal' is seven noughts and a ninety, so roughly
     one word in eight stands up.

     The default is mostly-horizontal rather than the old quarter-of-everything:
     a cloud with a lot of words on their side reads as clutter, and the
     reference work is overwhelmingly flat with a few uprights for texture. */
  var ANGLE_SETS = {
    horizontal: { label: 'Horizontal', angles: [0] },
    mostly:     { label: 'Mostly horizontal', angles: [0, 0, 0, 0, 0, 0, 0, 90] },
    mixed:      { label: 'Mixed', angles: [0, 0, 0, 90] },
    crossing:   { label: 'Crossing', angles: [0, 90] },
    vertical:   { label: 'Vertical', angles: [90] },
    dancing:    { label: 'Dancing', angles: [-30, -15, 0, 0, 15, 30] },
    rising:     { label: 'Rising', angles: [0, 0, 15, 30, 45] },
    falling:    { label: 'Falling', angles: [0, 0, -15, -30, -45] },
    any:        { label: 'Any angle', angles: null }
  };
  var ANGLE_ORDER = ['mostly', 'horizontal', 'mixed', 'crossing', 'vertical',
    'dancing', 'rising', 'falling', 'any'];

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
    '#wordcloudviz .wc-shapes{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 8px;}',
    '#wordcloudviz .wc-sub{margin:0 0 4px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#5c6f8c;}',
    '#wordcloudviz .wc-glyph{width:5.5rem;text-align:center;font-size:15px;}',
    '#wordcloudviz .wc-emoji-wrap{max-height:15rem;overflow-y:auto;margin:2px 0 8px;padding-right:4px;}',
    '#wordcloudviz .wc-emoji{display:flex;flex-wrap:wrap;gap:3px;margin:0 0 7px;}',
    '#wordcloudviz .wc-em{font-size:17px;line-height:1;padding:3px 4px;background:#131f36;border:1px solid #253651;border-radius:6px;cursor:pointer;}',
    '#wordcloudviz .wc-em:hover{background:#213152;border-color:' + C.blue + ';}',
    '#wordcloudviz .wc-file{font:inherit;font-size:11px;color:' + C.dim + ';max-width:11rem;}',
    '#wordcloudviz .wc-file::file-selector-button{font:inherit;font-size:11px;color:#dfe8f6;background:#182339;border:1px solid #2c3d59;border-radius:6px;padding:4px 8px;margin-right:6px;cursor:pointer;}',
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
      shape: 'circle', palette: 'ink', font: 'sans', glyph: '★',
      colorMode: 'rank', angles: 'mostly', repeat: true, shapeTint: 0,
      maxWords: 80, minFont: 14, maxFont: 118, rotate: true, stopwords: true,
      /* 5px, the same floor wordclouds.com uses. This is the tail that traces
         the outline; at the old 16 the shapes did not read. */
      fillMinFont: 5,
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
    /* One grouped dropdown rather than a wall of chips. Fifty-odd shapes as
       buttons filled the sidebar and pushed everything else off the screen;
       as <optgroup>s the same list is one line tall, the groups are named, and
       it is the control people already know how to use. */
    var groups = [];
    SHAPE_ORDER_UI.forEach(function (s) {
      var g = SHAPE_DEFS[s].group;
      if (!groups.length || groups[groups.length - 1].name !== g) groups.push({ name: g, keys: [] });
      groups[groups.length - 1].keys.push(s);
    });
    var shapeField = E('div', 'wc-field');
    shapeField.appendChild(E('label', null, 'Shape'));
    var shapeSel = E('select', 'wc-select');
    shapeSel.setAttribute('aria-label', 'Cloud shape');
    groups.forEach(function (g) {
      var og = E('optgroup');
      og.label = g.name;
      g.keys.forEach(function (s) {
        var op = E('option', null, SHAPE_DEFS[s].label);
        op.value = s;
        if (s === self.opts.shape) op.selected = true;
        og.appendChild(op);
      });
      shapeSel.appendChild(og);
    });
    /* Any character as the silhouette. This is the entry that makes the shape
       list effectively unbounded — every emoji and letter the visitor's system
       can draw is a shape, which is how the big sites get their thousands. */
    var ogG = E('optgroup');
    ogG.label = 'Your own';
    [['glyph', 'Letter or emoji…'], ['image', 'A picture…']].forEach(function (o) {
      var opG = E('option', null, o[1]);
      opG.value = o[0];
      if (self.opts.shape === o[0]) opG.selected = true;
      ogG.appendChild(opG);
    });
    shapeSel.appendChild(ogG);
    this.shapeSel = shapeSel;
    function syncShapeRows() {
      self.glyphRow.style.display = (self.opts.shape === 'glyph') ? 'flex' : 'none';
      self.emojiWrap.style.display = (self.opts.shape === 'glyph') ? 'block' : 'none';
      self.imageRow.style.display = (self.opts.shape === 'image') ? 'block' : 'none';
    }
    this.syncShapeRows = syncShapeRows;
    shapeSel.addEventListener('change', function () {
      self.opts.shape = shapeSel.value;
      syncShapeRows();
      self.generate();
    });
    shapeField.appendChild(shapeSel);
    gShape.appendChild(shapeField);

    this.glyphRow = E('div', 'wc-field');
    this.glyphRow.style.display = this.opts.shape === 'glyph' ? 'flex' : 'none';
    this.glyphRow.appendChild(E('label', null, 'Character'));
    this.glyphInput = E('input', 'wc-num wc-glyph');
    this.glyphInput.type = 'text';
    this.glyphInput.value = this.opts.glyph;
    this.glyphInput.maxLength = 12;
    this.glyphInput.setAttribute('aria-label', 'Character or emoji to use as the shape');
    this.glyphInput.addEventListener('input', function () {
      self.opts.glyph = self.glyphInput.value || '★';
      if (self.opts.shape === 'glyph') self.generate();
    });
    this.glyphRow.appendChild(this.glyphInput);
    gShape.appendChild(this.glyphRow);

    /* A grid of emoji to pick from, so the character box is not a blank
       invitation to guess. Each one just writes into that same box. */
    this.emojiWrap = E('div', 'wc-emoji-wrap');
    this.emojiWrap.style.display = this.opts.shape === 'glyph' ? 'block' : 'none';
    EMOJI_SETS.forEach(function (set) {
      self.emojiWrap.appendChild(E('p', 'wc-sub', set.name));
      var row = E('div', 'wc-emoji');
      set.list.split(' ').forEach(function (ch) {
        if (!ch) return;
        var b = E('button', 'wc-em', ch);
        b.type = 'button';
        b.title = 'Use ' + ch + ' as the shape';
        b.addEventListener('click', function () {
          self.opts.glyph = ch;
          self.glyphInput.value = ch;
          self.opts.shape = 'glyph';
          self.shapeSel.value = 'glyph';
          self.syncShapeRows();
          self.generate();
        });
        row.appendChild(b);
      });
      self.emojiWrap.appendChild(row);
    });
    gShape.appendChild(this.emojiWrap);

    /* A picture of the visitor's own. Read in the tab, never uploaded. */
    this.imageRow = E('div', 'wc-imagerow');
    this.imageRow.style.display = this.opts.shape === 'image' ? 'block' : 'none';
    var fileField = E('div', 'wc-field');
    fileField.appendChild(E('label', null, 'Picture'));
    this.fileInput = E('input', 'wc-file');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.setAttribute('aria-label', 'Picture to use as the shape');
    this.fileInput.addEventListener('change', function () {
      var f = self.fileInput.files && self.fileInput.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var im = new Image();
        im.onload = function () {
          self.shapeImage = im;
          self.opts.shape = 'image';
          self.shapeSel.value = 'image';
          self.syncShapeRows();
          self.generate();
        };
        im.onerror = function () {
          self.noteHost.textContent = 'That file could not be read as a picture. Try a PNG or JPG.';
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    });
    fileField.appendChild(this.fileInput);
    this.imageRow.appendChild(fileField);
    var thrField = E('div', 'wc-field');
    thrField.appendChild(E('label', null, 'Edge'));
    this.thrInput = E('input', 'wc-range');
    this.thrInput.type = 'range';
    this.thrInput.min = '0'; this.thrInput.max = '100'; this.thrInput.step = '2';
    this.thrInput.value = '50';
    this.thrInput.setAttribute('aria-label', 'How much of the picture counts as the shape');
    this.thrInput.addEventListener('input', function () {
      self.opts.imageThreshold = parseInt(self.thrInput.value, 10);
      if (self.opts.shape === 'image') self.generate();
    });
    thrField.appendChild(this.thrInput);
    this.imageRow.appendChild(thrField);
    this.imageRow.appendChild(this.checkbox('Swap which part is the shape', false, function (v) {
      self.opts.imageInvert = v;
      if (self.opts.shape === 'image') self.generate();
    }));
    this.imageRow.appendChild(E('p', 'wc-hint',
      'Works best on a picture with a clear outline — a logo, a silhouette, a stencil, ' +
      'or a subject on a plain background. Drag Edge to take in more or less of it. ' +
      'The picture is read in this tab and never uploaded.'));
    gShape.appendChild(this.imageRow);

    /* Ghost the silhouette behind the words, the way WordArt's "shape image
       opacity" does. It earns its place on the shapes with thin limbs: a key
       or a music note is carried mostly by small words, and a faint fill
       behind them makes the object read at a glance instead of asking the
       viewer to assemble it. Zero by default, because on a round shape it is
       just haze. */
    var tintField = E('div', 'wc-field');
    tintField.appendChild(E('label', null, 'Shape behind'));
    this.tintInput = E('input', 'wc-range');
    this.tintInput.type = 'range';
    this.tintInput.min = '0'; this.tintInput.max = '60'; this.tintInput.step = '5';
    this.tintInput.value = String(Math.round(this.opts.shapeTint * 100));
    this.tintInput.setAttribute('aria-label', 'How strongly to show the shape behind the words');
    this.tintInput.addEventListener('input', function () {
      self.opts.shapeTint = parseInt(self.tintInput.value, 10) / 100;
      self.render();                       // paint-only; no need to lay out again
    });
    tintField.appendChild(this.tintInput);
    gShape.appendChild(tintField);
    side.appendChild(gShape);

    // --- colours + font ---
    var gStyle = E('div', 'wc-group');
    gStyle.appendChild(E('p', 'wc-gt', 'Style'));
    var palField = E('div', 'wc-field');
    palField.appendChild(E('label', null, 'Colours'));
    palField.appendChild(selectBox(PALETTE_ORDER.map(function (k) { return { key: k, label: PALETTES[k].label }; }),
      this.opts.palette, function (v) { self.opts.palette = v; self.render(); }));
    gStyle.appendChild(palField);
    var cmField = E('div', 'wc-field');
    cmField.appendChild(E('label', null, 'Colour by'));
    cmField.appendChild(selectBox(COLOR_MODE_ORDER.map(function (k) { return { key: k, label: COLOR_MODES[k].label }; }),
      this.opts.colorMode, function (v) { self.opts.colorMode = v; self.render(); }));
    gStyle.appendChild(cmField);
    var fontField = E('div', 'wc-field');
    fontField.appendChild(E('label', null, 'Font'));
    fontField.appendChild(selectBox(FONT_ORDER.map(function (k) { return { key: k, label: FONTS[k].label }; }),
      this.opts.font, function (v) { self.opts.font = v; self.generate(); }));
    gStyle.appendChild(fontField);
    var angField = E('div', 'wc-field');
    angField.appendChild(E('label', null, 'Word angles'));
    angField.appendChild(selectBox(ANGLE_ORDER.map(function (k) { return { key: k, label: ANGLE_SETS[k].label }; }),
      this.opts.angles, function (v) { self.opts.angles = v; self.generate(); }));
    gStyle.appendChild(angField);
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

    /* "Repeat words to fill the shape" is the difference between the two looks
       the reference tools offer, and both ship it as a switch: on, a short word
       list still fills a heart; off, every word appears exactly once and the
       size is a pure reading of the text. */
    this.repeatCheck = this.checkbox('Repeat words to fill the shape', this.opts.repeat, function (v) {
      self.opts.repeat = v; self.generate();
    });
    gTune.appendChild(this.repeatCheck);
    this.stopCheck = this.checkbox('Remove common filler words', this.opts.stopwords, function (v) {
      self.opts.stopwords = v; self.generate();
    });
    gTune.appendChild(this.stopCheck);
    side.appendChild(gTune);

    // --- actions ---
    var actions = E('div', 'wc-btnrow');
    /* The usage ping sits on these two buttons rather than inside generate()
       itself: build() calls generate() once on mount to draw the sample text,
       and every tuning control re-runs it as a redraw, so hooking the function
       would count the page painting its own default as a visitor using the
       lab. A press of Generate or Shuffle is unambiguous. */
    actions.appendChild(this.btn('Generate', function () {
      self.opts.seed = 1; self.generate();
      if (window.KSLab) window.KSLab.used('run');
    }, true));
    actions.appendChild(this.btn('Shuffle', function () {
      self.opts.seed = (self.opts.seed + 1) % 100000 + 1; self.generate();
      if (window.KSLab) window.KSLab.used('run');
    }));
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
     cheap.

     The important step is the CROP. A word is drawn into a box sized from
     measureText's advance width and a 1.25em line height, and that box is
     mostly air: measured across a range of real words and sizes, between 29%
     and 85% of it had no ink in it at all, the worst cases being exactly the
     small words that ought to be filling crevices. The packer treats a sprite
     as solid, so every word was reserving a slab of empty space roughly twice
     its own height — words could not nest under each other's ascenders, and
     nothing could sit close to the edge of the shape. Trimming the sprite to
     the pixels that actually have ink in them is what lets the cloud pack like
     the reference clouds do.

     Cropping moves the sprite's origin away from the text's drawing origin, so
     offX/offY carry the difference back to the caller; place() adds them to
     work out where fillText should actually go.

     Breathing room is a padding proportional to the font size rather than a
     fixed dilation of the grid. A one-cell dilation costs a fixed number of
     pixels on every side, which is a rounding error on a 90px word and a
     doubling on a 7px one — the small words were being held apart by their own
     height. */
  WordCloudApp.prototype.spriteMaker = function (grid) {
    var fontCss = FONTS[this.opts.font].css;
    if (!this._tmp) { this._tmp = document.createElement('canvas'); }
    var tmp = this._tmp;
    var tctx = tmp.getContext('2d', { willReadFrequently: true });
    /* The same word is asked for at the same size many times over as the fill
       pass sweeps, and rasterising is the expensive part, so sprites are
       memoised. The key includes the font because a font change rebuilds the
       whole maker anyway. */
    var cache = {};
    return function (word, fontSize, angle) {
      angle = angle || 0;
      var key = fontSize + '|' + angle.toFixed(3) + '|' + word;
      if (cache[key] !== undefined) return cache[key];
      tctx.font = fontCss.replace('%s', fontSize);
      var m = tctx.measureText(word);
      /* Air around the word, proportional to its size so that big and small
         words are separated by the same *visual* amount. The scratch box has to
         be big enough to hold it, plus a few pixels for glyph overshoot. */
      var air = Math.max(1, Math.round(fontSize * 0.09));
      var pad = air + 3;
      var textW = Math.ceil(m.width) + pad * 2;
      var textH = Math.ceil(fontSize * 1.35) + pad * 2;
      /* A box big enough for the text at ANY rotation: the rotated extents of a
         textW x textH rectangle. Cropping to the ink afterwards means the slack
         costs nothing in packing terms, only a slightly larger scratch to scan. */
      var ca = Math.abs(Math.cos(angle)), sa = Math.abs(Math.sin(angle));
      var w = Math.ceil(textW * ca + textH * sa);
      var h = Math.ceil(textW * sa + textH * ca);
      if (w < 1 || h < 1) return null;
      tmp.width = w; tmp.height = h;
      tctx.clearRect(0, 0, w, h);
      tctx.font = fontCss.replace('%s', fontSize);
      tctx.textAlign = 'center';
      tctx.textBaseline = 'middle';
      tctx.fillStyle = '#fff';
      tctx.save();
      tctx.translate(w / 2, h / 2);
      if (angle) tctx.rotate(-angle);
      tctx.fillText(word, 0, 0);
      tctx.restore();

      var img = tctx.getImageData(0, 0, w, h).data;
      // ink bounding box, in pixels
      var minX = w, maxX = -1, minY = h, maxY = -1, x, y;
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          if (img[(y * w + x) * 4 + 3] > 40) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) { cache[key] = null; return null; }   // nothing drew (e.g. a space)
      /* Reserve the air by growing the sprite a whole number of CELLS, and
         widen the crop by exactly that much so the growth is not clipped.
         When the air is thinner than one cell there is no growth at all: the
         downsample already rounds any part-inked cell up to fully occupied,
         which is itself up to a cell of separation, and a small word cannot
         afford to be held off by more than that — at 7px a single extra cell
         on each side would half again its own size. */
      var airCells = Math.floor(air / grid);
      var airPx = airCells * grid;
      minX = Math.max(0, minX - airPx); minY = Math.max(0, minY - airPx);
      maxX = Math.min(w - 1, maxX + airPx); maxY = Math.min(h - 1, maxY + airPx);

      var cx0 = Math.floor(minX / grid), cy0 = Math.floor(minY / grid);
      var cx1 = Math.floor(maxX / grid), cy1 = Math.floor(maxY / grid);
      var sgw = cx1 - cx0 + 1, sgh = cy1 - cy0 + 1;
      var cells = new Uint8Array(sgw * sgh);
      for (y = minY; y <= maxY; y++) {
        for (x = minX; x <= maxX; x++) {
          if (img[(y * w + x) * 4 + 3] > 40) {
            cells[(Math.floor(y / grid) - cy0) * sgw + (Math.floor(x / grid) - cx0)] = 1;
          }
        }
      }
      if (airCells > 0) {
        var grown = new Uint8Array(sgw * sgh);
        for (var gy = 0; gy < sgh; gy++) {
          for (var gx = 0; gx < sgw; gx++) {
            if (!cells[gy * sgw + gx]) continue;
            for (var dy = -airCells; dy <= airCells; dy++) {
              for (var dx = -airCells; dx <= airCells; dx++) {
                var ny = gy + dy, nx = gx + dx;
                if (ny >= 0 && ny < sgh && nx >= 0 && nx < sgw) grown[ny * sgw + nx] = 1;
              }
            }
          }
        }
        cells = grown;
      }
      cache[key] = {
        gw: sgw, gh: sgh, cells: cells,
        // where fillText's origin sits relative to the cropped sprite's corner
        offX: w / 2 - cx0 * grid,
        offY: h / 2 - cy0 * grid
      };
      return cache[key];
    };
  };

  /* ======================================================================== */
  /*  SHAPE LIBRARY                                                           */
  /* ------------------------------------------------------------------------ */
  /*  Each entry draws itself into a unit box: the drawing function is handed a */
  /*  context already translated and scaled so that (0,0) is the centre and the */
  /*  box runs -1..1 on the shorter axis. Everything is filled white on black   */
  /*  and then thresholded, so a shape can be any combination of paths, and     */
  /*  'destination-out' can punch holes.                                        */
  /*                                                                            */
  /*  A shape is only worth having if words can actually fill it and it is      */
  /*  still recognisable once they have: limbs thinner than a few words read as  */
  /*  ragged edges rather than as the thing. Thin-limbed shapes are therefore    */
  /*  stroked with a round join as well as filled.                              */
  /* ======================================================================== */

  // regular n-gon, first vertex pointing up
  function ngon(x, n, r) {
    x.beginPath();
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / n;
      var px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  }

  // n-pointed star, inner radius as a fraction of the outer
  function starPath(x, n, R, inner) {
    x.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = -Math.PI / 2 + i * Math.PI / n;
      var rr = (i % 2 === 0) ? R : R * inner;
      var px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.closePath(); x.fill();
  }

  function poly(x, pts) {
    x.beginPath();
    for (var i = 0; i < pts.length; i++) {
      if (i === 0) x.moveTo(pts[i][0], pts[i][1]); else x.lineTo(pts[i][0], pts[i][1]);
    }
    x.closePath(); x.fill();
  }

  // fill AND stroke, so limbs thinner than the stroke still hold words
  function thick(x, w, fn) {
    x.lineWidth = w; x.lineJoin = 'round'; x.lineCap = 'round';
    x.strokeStyle = x.fillStyle;
    fn();
    x.stroke();
  }

  var SHAPE_DEFS = {
    rectangle: { label: 'Rectangle', group: 'Basic', draw: function (x) { x.fillRect(-1.6, -1, 3.2, 2); } },
    circle:    { label: 'Circle', group: 'Basic', draw: function (x) { x.beginPath(); x.arc(0, 0, 1, 0, 6.2832); x.fill(); } },
    ellipse:   { label: 'Oval', group: 'Basic', draw: function (x) { x.beginPath(); x.ellipse(0, 0, 1.45, 1, 0, 0, 6.2832); x.fill(); } },
    square:    { label: 'Rounded square', group: 'Basic', draw: function (x) {
      var r = 0.28, s = 1;
      x.beginPath();
      x.moveTo(-s + r, -s); x.lineTo(s - r, -s); x.quadraticCurveTo(s, -s, s, -s + r);
      x.lineTo(s, s - r); x.quadraticCurveTo(s, s, s - r, s);
      x.lineTo(-s + r, s); x.quadraticCurveTo(-s, s, -s, s - r);
      x.lineTo(-s, -s + r); x.quadraticCurveTo(-s, -s, -s + r, -s);
      x.closePath(); x.fill();
    } },
    triangle:  { label: 'Triangle', group: 'Basic', draw: function (x) { ngon(x, 3, 1.15); } },
    diamond:   { label: 'Diamond', group: 'Basic', draw: function (x) { ngon(x, 4, 1.1); } },
    pentagon:  { label: 'Pentagon', group: 'Basic', draw: function (x) { ngon(x, 5, 1.08); } },
    hexagon:   { label: 'Hexagon', group: 'Basic', draw: function (x) { ngon(x, 6, 1.05); } },
    octagon:   { label: 'Octagon', group: 'Basic', draw: function (x) { ngon(x, 8, 1.03); } },

    heart:     { label: 'Heart', group: 'Love', draw: function (x) {
      /* the classic parametric heart, scaled into the unit box; a far cleaner
         outline than two arcs and a V, and it is the one everybody recognises */
      x.beginPath();
      for (var t = 0; t <= 6.2832; t += 0.02) {
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        if (t === 0) x.moveTo(hx / 16, hy / 15.5); else x.lineTo(hx / 16, hy / 15.5);
      }
      x.closePath(); x.fill();
    } },
    star:      { label: 'Star', group: 'Symbols', draw: function (x) { starPath(x, 5, 1.12, 0.44); } },
    star6:     { label: 'Six-point star', group: 'Symbols', draw: function (x) { starPath(x, 6, 1.08, 0.55); } },
    burst:     { label: 'Sparkle', group: 'Symbols', draw: function (x) { starPath(x, 12, 1.05, 0.72); } },
    ring:      { label: 'Ring', group: 'Symbols', draw: function (x) {
      x.beginPath(); x.arc(0, 0, 1, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(0, 0, 0.44, 0, 6.2832); x.fill(); x.restore();
    } },
    crescent:  { label: 'Crescent', group: 'Symbols', draw: function (x) {
      x.beginPath(); x.arc(0.1, 0, 1, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(0.62, -0.16, 0.86, 0, 6.2832); x.fill(); x.restore();
    } },
    arrow:     { label: 'Arrow', group: 'Symbols', draw: function (x) {
      poly(x, [[0, -1.1], [0.95, -0.05], [0.42, -0.05], [0.42, 1.1], [-0.42, 1.1], [-0.42, -0.05], [-0.95, -0.05]]);
    } },
    cross:     { label: 'Cross', group: 'Symbols', draw: function (x) {
      var a = 0.36, b = 1.08;
      poly(x, [[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]]);
    } },
    shield:    { label: 'Shield', group: 'Symbols', draw: function (x) {
      x.beginPath();
      x.moveTo(-0.92, -1); x.lineTo(0.92, -1); x.lineTo(0.92, 0.1);
      x.quadraticCurveTo(0.9, 0.86, 0, 1.15);
      x.quadraticCurveTo(-0.9, 0.86, -0.92, 0.1);
      x.closePath(); x.fill();
    } },
    bubble:    { label: 'Speech bubble', group: 'Symbols', draw: function (x) {
      var r = 0.3, l = -1.35, rr = 1.35, t = -1, b = 0.5;
      x.beginPath();
      x.moveTo(l + r, t); x.lineTo(rr - r, t); x.quadraticCurveTo(rr, t, rr, t + r);
      x.lineTo(rr, b - r); x.quadraticCurveTo(rr, b, rr - r, b);
      x.lineTo(-0.15, b); x.lineTo(-0.3, b + 0.62); x.lineTo(-0.62, b);
      x.lineTo(l + r, b); x.quadraticCurveTo(l, b, l, b - r);
      x.lineTo(l, t + r); x.quadraticCurveTo(l, t, l + r, t);
      x.closePath(); x.fill();
    } },
    crown:     { label: 'Crown', group: 'Symbols', draw: function (x) {
      poly(x, [[-1.15, -0.5], [-0.6, 0.1], [-0.35, -0.75], [0, 0.05], [0.35, -0.75], [0.6, 0.1], [1.15, -0.5],
               [0.95, 0.95], [-0.95, 0.95]]);
    } },
    bolt:      { label: 'Lightning', group: 'Symbols', draw: function (x) {
      poly(x, [[0.28, -1.15], [-0.72, 0.16], [-0.1, 0.16], [-0.34, 1.15], [0.72, -0.22], [0.06, -0.22]]);
    } },
    pin:       { label: 'Map pin', group: 'Symbols', draw: function (x) {
      x.beginPath(); x.arc(0, -0.3, 0.78, 0, 6.2832); x.fill();
      poly(x, [[-0.62, 0.16], [0.62, 0.16], [0, 1.2]]);
    } },

    cloud:     { label: 'Cloud', group: 'Nature', draw: function (x) {
      /* Overlapping discs sitting ON A FLAT BASE. The previous version placed
         its discs symmetrically about the centre, which produced a lumpy bowl
         rather than a cloud — a cloud is billows on top of a straight bottom. */
      [[-0.72, 0.12, 0.40], [-0.30, -0.20, 0.56], [0.18, -0.32, 0.50],
       [0.66, 0.02, 0.44], [1.00, 0.26, 0.28], [-1.02, 0.30, 0.26]]
        .forEach(function (d) { x.beginPath(); x.arc(d[0], d[1], d[2], 0, 6.2832); x.fill(); });
      x.fillRect(-1.05, 0.12, 2.1, 0.42);
    } },
    droplet:   { label: 'Droplet', group: 'Nature', draw: function (x) {
      x.beginPath();
      x.moveTo(0, -1.15);
      x.quadraticCurveTo(0.92, -0.05, 0.78, 0.44);
      x.arc(0, 0.44, 0.78, 0, Math.PI);
      x.quadraticCurveTo(-0.92, -0.05, 0, -1.15);
      x.closePath(); x.fill();
    } },
    flame:     { label: 'Flame', group: 'Nature', draw: function (x) {
      // a broad teardrop drawn point-up; the two-lobed version this replaces
      // came out looking like a wishbone once it was full of words
      x.beginPath();
      x.moveTo(0, -1.18);
      x.bezierCurveTo(0.58, -0.52, 0.98, 0.05, 0.66, 0.56);
      x.bezierCurveTo(0.40, 0.98, -0.40, 0.98, -0.66, 0.56);
      x.bezierCurveTo(-0.98, 0.05, -0.44, -0.44, 0, -1.18);
      x.closePath(); x.fill();
    } },
    leaf:      { label: 'Leaf', group: 'Nature', draw: function (x) {
      x.save(); x.rotate(-Math.PI / 4);
      x.beginPath();
      x.moveTo(0, -1.15);
      x.quadraticCurveTo(1.0, -0.2, 0, 1.15);
      x.quadraticCurveTo(-1.0, -0.2, 0, -1.15);
      x.closePath(); x.fill();
      x.restore();
    } },
    tree:      { label: 'Tree', group: 'Nature', draw: function (x) {
      // conifer: trunk, then three tiers each narrower and higher than the last
      x.fillRect(-0.17, 0.58, 0.34, 0.6);
      [[0.66, 0.95], [0.26, 0.79], [-0.14, 0.62]].forEach(function (t) {
        poly(x, [[-t[1], t[0]], [t[1], t[0]], [0, t[0] - 0.8]]);
      });
    } },
    apple:     { label: 'Apple', group: 'Nature', draw: function (x) {
      x.beginPath(); x.arc(-0.36, 0.16, 0.78, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.36, 0.16, 0.78, 0, 6.2832); x.fill();
      x.fillRect(-0.7, -0.4, 1.4, 0.9);
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(0, -1.06, 0.4, 0, 6.2832); x.fill(); x.restore();
      thick(x, 0.14, function () { x.beginPath(); x.moveTo(0.02, -0.85); x.quadraticCurveTo(0.2, -1.25, 0.5, -1.3); });
    } },
    butterfly: { label: 'Butterfly', group: 'Nature', draw: function (x) {
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
        x.save();
        x.translate(s[0] * 0.55, s[1] * 0.42);
        x.rotate(s[0] * s[1] * 0.5);
        x.beginPath(); x.ellipse(0, 0, 0.62, 0.44, 0, 0, 6.2832); x.fill();
        x.restore();
      });
      x.beginPath(); x.ellipse(0, 0, 0.12, 0.85, 0, 0, 6.2832); x.fill();
    } },
    fish:      { label: 'Fish', group: 'Nature', draw: function (x) {
      x.beginPath();
      x.moveTo(-0.5, 0); x.quadraticCurveTo(0.3, -0.95, 1.15, 0);
      x.quadraticCurveTo(0.3, 0.95, -0.5, 0);
      x.closePath(); x.fill();
      poly(x, [[-0.42, 0], [-1.25, -0.6], [-1.25, 0.6]]);
    } },
    paw:       { label: 'Paw print', group: 'Nature', draw: function (x) {
      x.beginPath(); x.ellipse(0, 0.48, 0.72, 0.6, 0, 0, 6.2832); x.fill();
      [[-0.78, -0.4], [-0.28, -0.82], [0.28, -0.82], [0.78, -0.4]].forEach(function (d) {
        x.beginPath(); x.ellipse(d[0], d[1], 0.3, 0.38, 0, 0, 6.2832); x.fill();
      });
    } },

    house:     { label: 'House', group: 'Objects', draw: function (x) {
      x.fillRect(-0.85, -0.05, 1.7, 1.1);
      poly(x, [[-1.15, 0], [1.15, 0], [0, -1.15]]);
    } },
    bulb:      { label: 'Light bulb', group: 'Objects', draw: function (x) {
      x.beginPath(); x.arc(0, -0.32, 0.8, 0, 6.2832); x.fill();
      poly(x, [[-0.46, 0.3], [0.46, 0.3], [0.32, 0.72], [-0.32, 0.72]]);
      x.fillRect(-0.3, 0.66, 0.6, 0.42);
    } },
    note:      { label: 'Music note', group: 'Objects', draw: function (x) {
      x.save(); x.translate(-0.35, 0.68); x.rotate(-0.35);
      x.beginPath(); x.ellipse(0, 0, 0.46, 0.34, 0, 0, 6.2832); x.fill(); x.restore();
      x.fillRect(0.02, -1.1, 0.2, 1.85);
      x.beginPath();
      x.moveTo(0.22, -1.1); x.quadraticCurveTo(0.95, -0.85, 0.8, -0.15);
      x.quadraticCurveTo(0.78, -0.62, 0.22, -0.72);
      x.closePath(); x.fill();
    } },
    key:       { label: 'Key', group: 'Objects', draw: function (x) {
      x.beginPath(); x.arc(-0.62, 0, 0.62, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(-0.62, 0, 0.26, 0, 6.2832); x.fill(); x.restore();
      x.fillRect(-0.05, -0.16, 1.3, 0.32);
      x.fillRect(0.72, 0.16, 0.16, 0.42);
      x.fillRect(1.06, 0.16, 0.16, 0.42);
    } },
    gift:      { label: 'Gift', group: 'Objects', draw: function (x) {
      x.fillRect(-0.95, -0.35, 1.9, 1.35);
      x.fillRect(-1.05, -0.62, 2.1, 0.34);
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.fillRect(-0.12, -0.62, 0.24, 1.62); x.restore();
      // bow
      x.beginPath(); x.ellipse(-0.3, -0.78, 0.3, 0.22, 0.5, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0.3, -0.78, 0.3, 0.22, -0.5, 0, 6.2832); x.fill();
    } },
    bell:      { label: 'Bell', group: 'Objects', draw: function (x) {
      x.beginPath();
      x.moveTo(-0.9, 0.55);
      x.quadraticCurveTo(-0.78, -0.55, 0, -0.85);
      x.quadraticCurveTo(0.78, -0.55, 0.9, 0.55);
      x.closePath(); x.fill();
      x.fillRect(-0.98, 0.5, 1.96, 0.22);
      x.beginPath(); x.arc(0, 0.86, 0.2, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, -0.92, 0.14, 0, 6.2832); x.fill();
    } },
    camera:    { label: 'Camera', group: 'Objects', draw: function (x) {
      x.fillRect(-1.05, -0.42, 2.1, 1.3);
      poly(x, [[-0.55, -0.42], [-0.38, -0.72], [0.16, -0.72], [0.33, -0.42]]);
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(0, 0.22, 0.42, 0, 6.2832); x.fill(); x.restore();
    } },
    gear:      { label: 'Gear', group: 'Objects', draw: function (x) {
      var teeth = 9;
      x.beginPath();
      for (var i = 0; i < teeth * 4; i++) {
        var a = i * 2 * Math.PI / (teeth * 4);
        var r = (i % 4 === 0 || i % 4 === 1) ? 1.05 : 0.8;
        var px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath(); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(0, 0, 0.34, 0, 6.2832); x.fill(); x.restore();
    } },

    /* --- Love ---------------------------------------------------------- */
    hearts2:   { label: 'Two hearts', group: 'Love', draw: function (x) {
      [[-0.42, 0.12, 0.62], [0.44, -0.10, 0.78]].forEach(function (h) {
        x.save(); x.translate(h[0], h[1]); x.scale(h[2], h[2]);
        x.beginPath();
        for (var t = 0; t <= 6.2832; t += 0.02) {
          var hx = 16 * Math.pow(Math.sin(t), 3);
          var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          if (t === 0) x.moveTo(hx / 16, hy / 15.5); else x.lineTo(hx / 16, hy / 15.5);
        }
        x.closePath(); x.fill(); x.restore();
      });
    } },
    heartBreak: { label: 'Broken heart', group: 'Love', draw: function (x) {
      x.beginPath();
      for (var t = 0; t <= 6.2832; t += 0.02) {
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        if (t === 0) x.moveTo(hx / 16, hy / 15.5); else x.lineTo(hx / 16, hy / 15.5);
      }
      x.closePath(); x.fill();
      // zigzag crack punched down the middle
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.lineWidth = 0.12; x.lineJoin = 'miter'; x.strokeStyle = '#000';
      x.beginPath();
      x.moveTo(0.02, -0.72); x.lineTo(-0.16, -0.24); x.lineTo(0.14, 0.02);
      x.lineTo(-0.12, 0.34); x.lineTo(0.06, 1.12);
      x.stroke(); x.restore();
    } },
    lips:      { label: 'Kiss', group: 'Love', draw: function (x) {
      x.beginPath();
      x.moveTo(0, -0.14);
      x.quadraticCurveTo(0.28, -0.62, 0.66, -0.44);
      x.quadraticCurveTo(1.05, -0.28, 1.1, 0.02);
      x.quadraticCurveTo(0.6, 0.72, 0, 0.8);
      x.quadraticCurveTo(-0.6, 0.72, -1.1, 0.02);
      x.quadraticCurveTo(-1.05, -0.28, -0.66, -0.44);
      x.quadraticCurveTo(-0.28, -0.62, 0, -0.14);
      x.closePath(); x.fill();
    } },
    infinity:  { label: 'Infinity', group: 'Love', draw: function (x) {
      thick(x, 0.42, function () {
        x.beginPath();
        x.moveTo(0, 0);
        x.bezierCurveTo(-0.35, -0.62, -1.15, -0.55, -1.15, 0);
        x.bezierCurveTo(-1.15, 0.55, -0.35, 0.62, 0, 0);
        x.bezierCurveTo(0.35, -0.62, 1.15, -0.55, 1.15, 0);
        x.bezierCurveTo(1.15, 0.55, 0.35, 0.62, 0, 0);
        x.closePath();
      });
    } },
    envelope:  { label: 'Love letter', group: 'Love', draw: function (x) {
      x.fillRect(-1.15, -0.72, 2.3, 1.5);
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.lineWidth = 0.09; x.strokeStyle = '#000'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(-1.15, -0.72); x.lineTo(0, 0.24); x.lineTo(1.15, -0.72); x.stroke();
      x.restore();
    } },
    ringGem:   { label: 'Diamond ring', group: 'Love', draw: function (x) {
      thick(x, 0.2, function () { x.beginPath(); x.arc(0, 0.3, 0.72, 0, 6.2832); });
      poly(x, [[-0.34, -0.52], [0.34, -0.52], [0.5, -0.24], [0, 0.16], [-0.5, -0.24]]);
    } },

    /* --- Cartoon ------------------------------------------------------- */
    smiley:    { label: 'Smiley', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.arc(0, 0, 1, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.ellipse(-0.36, -0.28, 0.13, 0.19, 0, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0.36, -0.28, 0.13, 0.19, 0, 0, 6.2832); x.fill();
      x.lineWidth = 0.15; x.lineCap = 'round'; x.strokeStyle = '#000';
      x.beginPath(); x.arc(0, 0.08, 0.56, 0.35, Math.PI - 0.35); x.stroke();
      x.restore();
    } },
    ghost:     { label: 'Ghost', group: 'Cartoon', draw: function (x) {
      x.beginPath();
      x.moveTo(-0.86, 1.0);
      x.lineTo(-0.86, -0.12);
      x.arc(0, -0.12, 0.86, Math.PI, 0);
      x.lineTo(0.86, 1.0);
      // scalloped hem
      x.lineTo(0.57, 0.72); x.lineTo(0.29, 1.0); x.lineTo(0, 0.72);
      x.lineTo(-0.29, 1.0); x.lineTo(-0.57, 0.72);
      x.closePath(); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.ellipse(-0.3, -0.2, 0.13, 0.18, 0, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0.3, -0.2, 0.13, 0.18, 0, 0, 6.2832); x.fill();
      x.restore();
    } },
    robot:     { label: 'Robot', group: 'Cartoon', draw: function (x) {
      x.fillRect(-0.06, -1.15, 0.12, 0.3);
      x.beginPath(); x.arc(0, -1.22, 0.15, 0, 6.2832); x.fill();
      var r = 0.2, l = -0.92, rr = 0.92, t = -0.85, b = 0.62;
      x.beginPath();
      x.moveTo(l + r, t); x.lineTo(rr - r, t); x.quadraticCurveTo(rr, t, rr, t + r);
      x.lineTo(rr, b - r); x.quadraticCurveTo(rr, b, rr - r, b);
      x.lineTo(l + r, b); x.quadraticCurveTo(l, b, l, b - r);
      x.lineTo(l, t + r); x.quadraticCurveTo(l, t, l + r, t);
      x.closePath(); x.fill();
      x.fillRect(-1.15, -0.42, 0.2, 0.62);
      x.fillRect(0.95, -0.42, 0.2, 0.62);
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(-0.36, -0.3, 0.16, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.36, -0.3, 0.16, 0, 6.2832); x.fill();
      x.fillRect(-0.42, 0.16, 0.84, 0.14); x.restore();
    } },
    bear:      { label: 'Bear', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.arc(-0.72, -0.66, 0.34, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.72, -0.66, 0.34, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, 0.06, 0.92, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(-0.32, -0.14, 0.11, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.32, -0.14, 0.11, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0, 0.3, 0.19, 0.14, 0, 0, 6.2832); x.fill(); x.restore();
    } },
    bunny:     { label: 'Bunny', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.ellipse(-0.34, -0.78, 0.19, 0.55, 0.1, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0.34, -0.78, 0.19, 0.55, -0.1, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, 0.32, 0.8, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(-0.28, 0.18, 0.1, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.28, 0.18, 0.1, 0, 6.2832); x.fill(); x.restore();
    } },
    snowman:   { label: 'Snowman', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.arc(0, -0.66, 0.42, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, 0.06, 0.58, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, 0.82, 0.72, 0, 6.2832); x.fill();
      thick(x, 0.08, function () {
        x.beginPath(); x.moveTo(-0.55, -0.05); x.lineTo(-1.1, -0.5);
        x.moveTo(0.55, -0.05); x.lineTo(1.1, -0.5);
      });
    } },
    balloon:   { label: 'Balloon', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.ellipse(0, -0.32, 0.72, 0.86, 0, 0, 6.2832); x.fill();
      poly(x, [[-0.12, 0.5], [0.12, 0.5], [0, 0.66]]);
      thick(x, 0.06, function () {
        x.beginPath(); x.moveTo(0, 0.62);
        x.bezierCurveTo(0.22, 0.86, -0.22, 1.0, 0.06, 1.2);
      });
    } },
    icecream:  { label: 'Ice cream', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.arc(-0.3, -0.5, 0.4, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.3, -0.5, 0.4, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, -0.8, 0.42, 0, 6.2832); x.fill();
      poly(x, [[-0.62, -0.18], [0.62, -0.18], [0, 1.15]]);
    } },
    rocket:    { label: 'Rocket', group: 'Cartoon', draw: function (x) {
      /* Nose cone on top of a STRAIGHT-SIDED body. Tapering the whole height,
         which is the obvious way to draw it, just produces a triangle with
         fins — the parallel sides are what say "rocket". */
      x.beginPath();
      x.moveTo(0, -1.05);
      x.quadraticCurveTo(0.64, -0.76, 0.64, -0.34);
      x.lineTo(0.64, 0.62);
      x.lineTo(-0.64, 0.62);
      x.lineTo(-0.64, -0.34);
      x.quadraticCurveTo(-0.64, -0.76, 0, -1.05);
      x.closePath(); x.fill();
      poly(x, [[-0.62, 0.14], [-1.0, 0.76], [-0.62, 0.66]]);
      poly(x, [[0.62, 0.14], [1.0, 0.76], [0.62, 0.66]]);
      x.fillRect(-0.42, 0.58, 0.84, 0.22);
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(0, -0.16, 0.26, 0, 6.2832); x.fill(); x.restore();
    } },
    pumpkin:   { label: 'Pumpkin', group: 'Cartoon', draw: function (x) {
      [[-0.5, 0.62], [0.5, 0.62], [-0.26, 0.86], [0.26, 0.86], [0, 0.95]].forEach(function (d) {
        x.beginPath(); x.ellipse(d[0], 0.08, d[1], 0.92, 0, 0, 6.2832); x.fill();
      });
      x.fillRect(-0.1, -1.0, 0.2, 0.24);
    } },
    alien:     { label: 'Alien', group: 'Cartoon', draw: function (x) {
      x.beginPath(); x.ellipse(0, -0.1, 0.85, 1.0, 0, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.ellipse(-0.36, -0.05, 0.2, 0.3, 0.35, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0.36, -0.05, 0.2, 0.3, -0.35, 0, 6.2832); x.fill();
      x.restore();
    } },
    teddy:     { label: 'Teddy bear', group: 'Cartoon', draw: function (x) {
      // ears, head, then a body with arms and legs off it
      x.beginPath(); x.arc(-0.40, -0.80, 0.21, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.40, -0.80, 0.21, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0, -0.56, 0.44, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0, 0.30, 0.52, 0.56, 0, 0, 6.2832); x.fill();
      x.save(); x.translate(-0.62, 0.16); x.rotate(-0.45);
      x.beginPath(); x.ellipse(0, 0, 0.20, 0.34, 0, 0, 6.2832); x.fill(); x.restore();
      x.save(); x.translate(0.62, 0.16); x.rotate(0.45);
      x.beginPath(); x.ellipse(0, 0, 0.20, 0.34, 0, 0, 6.2832); x.fill(); x.restore();
      x.beginPath(); x.ellipse(-0.32, 0.88, 0.25, 0.24, 0, 0, 6.2832); x.fill();
      x.beginPath(); x.ellipse(0.32, 0.88, 0.25, 0.24, 0, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(-0.16, -0.62, 0.07, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.16, -0.62, 0.07, 0, 6.2832); x.fill(); x.restore();
    } },
    cupcake:   { label: 'Cupcake', group: 'Cartoon', draw: function (x) {
      poly(x, [[-0.62, 0.06], [0.62, 0.06], [0.42, 1.0], [-0.42, 1.0]]);
      [[-0.38, -0.10, 0.36], [0.38, -0.10, 0.36], [0, -0.34, 0.44]].forEach(function (d) {
        x.beginPath(); x.arc(d[0], d[1], d[2], 0, 6.2832); x.fill();
      });
      x.beginPath(); x.arc(0, -0.86, 0.15, 0, 6.2832); x.fill();
    } },
    football:  { label: 'Football', group: 'Sport', draw: function (x) {
      x.beginPath(); x.arc(0, 0, 1, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      x.lineWidth = 0.09; x.lineJoin = 'round'; x.strokeStyle = '#000';
      // a centre pentagon and spokes, which is what makes it read as a ball
      x.beginPath();
      for (var i = 0; i < 5; i++) {
        var a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        var px = Math.cos(a) * 0.34, py = Math.sin(a) * 0.34;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath(); x.stroke();
      for (var j = 0; j < 5; j++) {
        var b = -Math.PI / 2 + j * 2 * Math.PI / 5;
        x.beginPath();
        x.moveTo(Math.cos(b) * 0.34, Math.sin(b) * 0.34);
        x.lineTo(Math.cos(b) * 0.98, Math.sin(b) * 0.98);
        x.stroke();
      }
      x.restore();
    } },
    medal:     { label: 'Medal', group: 'Sport', draw: function (x) {
      poly(x, [[-0.52, -1.05], [-0.16, -1.05], [0.12, -0.30], [-0.24, -0.30]]);
      poly(x, [[0.52, -1.05], [0.16, -1.05], [-0.12, -0.30], [0.24, -0.30]]);
      x.beginPath(); x.arc(0, 0.36, 0.66, 0, 6.2832); x.fill();
      x.save(); x.globalCompositeOperation = 'destination-out';
      // translate BEFORE the star, or it punches a hole out of the ribbons
      x.translate(0, 0.36);
      starPath(x, 5, 0.40, 0.45);
      x.restore();
    } },
    trophy:    { label: 'Trophy', group: 'Sport', draw: function (x) {
      x.beginPath();
      x.moveTo(-0.56, -0.86); x.lineTo(0.56, -0.86);
      x.quadraticCurveTo(0.52, 0.18, 0, 0.30);
      x.quadraticCurveTo(-0.52, 0.18, -0.56, -0.86);
      x.closePath(); x.fill();
      thick(x, 0.14, function () {
        x.beginPath(); x.arc(-0.72, -0.56, 0.28, Math.PI * 0.5, Math.PI * 1.5, true);
        x.moveTo(0.56, -0.72); x.arc(0.72, -0.56, 0.28, Math.PI * 1.5, Math.PI * 0.5);
      });
      x.fillRect(-0.14, 0.24, 0.28, 0.42);
      x.fillRect(-0.5, 0.62, 1.0, 0.26);
    } },
    umbrella:  { label: 'Umbrella', group: 'Objects', draw: function (x) {
      x.beginPath(); x.arc(0, 0.0, 1.0, Math.PI, 0);
      // scalloped lower edge
      for (var s = 0; s < 4; s++) {
        var xa = 1.0 - s * 0.5, xb = 1.0 - (s + 1) * 0.5;
        x.quadraticCurveTo((xa + xb) / 2, 0.26, xb, 0);
      }
      x.closePath(); x.fill();
      thick(x, 0.11, function () {
        x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 0.82);
        x.quadraticCurveTo(0, 1.12, -0.3, 1.06);
      });
    } },
    plane:     { label: 'Plane', group: 'Travel', draw: function (x) {
      x.beginPath();
      x.moveTo(0, -1.1);
      x.quadraticCurveTo(0.17, -0.72, 0.18, -0.22);
      x.lineTo(1.05, 0.30); x.lineTo(1.05, 0.52); x.lineTo(0.18, 0.28);
      x.lineTo(0.16, 0.72); x.lineTo(0.44, 0.96); x.lineTo(0.44, 1.08);
      x.lineTo(0, 0.94); x.lineTo(-0.44, 1.08); x.lineTo(-0.44, 0.96);
      x.lineTo(-0.16, 0.72); x.lineTo(-0.18, 0.28); x.lineTo(-1.05, 0.52);
      x.lineTo(-1.05, 0.30); x.lineTo(-0.18, -0.22);
      x.quadraticCurveTo(-0.17, -0.72, 0, -1.1);
      x.closePath(); x.fill();
    } },
    car:       { label: 'Car', group: 'Travel', draw: function (x) {
      x.beginPath();
      x.moveTo(-1.12, 0.34); x.lineTo(-0.98, -0.10);
      x.quadraticCurveTo(-0.90, -0.30, -0.66, -0.32);
      x.lineTo(-0.40, -0.62); x.lineTo(0.42, -0.62); x.lineTo(0.68, -0.32);
      x.quadraticCurveTo(0.92, -0.30, 1.00, -0.10);
      x.lineTo(1.12, 0.34); x.lineTo(1.12, 0.58); x.lineTo(-1.12, 0.58);
      x.closePath(); x.fill();
      x.beginPath(); x.arc(-0.66, 0.60, 0.29, 0, 6.2832); x.fill();
      x.beginPath(); x.arc(0.66, 0.60, 0.29, 0, 6.2832); x.fill();
    } },
    tshirt:    { label: 'T-shirt', group: 'Objects', draw: function (x) {
      x.beginPath();
      x.moveTo(-0.40, -0.78); x.lineTo(-1.05, -0.44); x.lineTo(-0.78, 0.02);
      x.lineTo(-0.58, -0.10); x.lineTo(-0.58, 0.96); x.lineTo(0.58, 0.96);
      x.lineTo(0.58, -0.10); x.lineTo(0.78, 0.02); x.lineTo(1.05, -0.44);
      x.lineTo(0.40, -0.78);
      x.quadraticCurveTo(0, -0.46, -0.40, -0.78);
      x.closePath(); x.fill();
    } }
  };

  /* ======================================================================== */
  /*  EMOJI SHAPES                                                            */
  /* ------------------------------------------------------------------------ */
  /*  The shapes above are hand-drawn, which is why they pack cleanly — but    */
  /*  hand-drawing is also why there are dozens of them rather than thousands.  */
  /*  Every emoji the visitor's machine can render is already a silhouette, and */
  /*  the glyph mask turns any of them into a shape at no drawing cost, so a    */
  /*  curated grid of them buys more breadth than the whole library above.      */
  /*  This is exactly how the big sites ship "thousands of shapes": they        */
  /*  threshold the alpha of an icon font.                                      */
  /*                                                                            */
  /*  Space-separated, because several of these are more than one code point    */
  /*  and splitting a string of them by character would tear them apart.        */
  /* ======================================================================== */
  var EMOJI_SETS = [
    { name: 'Love', list: '❤️ 🧡 💛 💚 💙 💜 🖤 💖 💕 💘 💝 💔 😍 🥰 😘 💐 🌹 💍 👩‍❤️‍👨' },
    { name: 'Faces', list: '😀 😄 😁 😂 🙂 😉 😊 😎 🤩 🥳 😇 🤗 🤔 😴 😱 🤯 🥺 😭 😡 🤠' },
    { name: 'Animals', list: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🦉 🦄 🐝 🦋 🐌 🐢 🐍 🐙 🦑 🦀 🐬 🐳 🦈 🐠 🦕 🦖 🐘 🦒 🦓 🐴 🐑 🦌' },
    { name: 'Nature', list: '🌲 🌳 🌴 🌵 🌱 🍀 🌷 🌸 🌹 🌻 🌼 🍁 🍂 🍄 ⭐ 🌟 ✨ ⚡ 🔥 💧 🌈 ☀️ 🌙 ⛅ ☁️ ❄️ ⛄ 🌊 🌍 🌋' },
    { name: 'Food', list: '🍎 🍏 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥝 🍅 🥕 🌽 🍕 🍔 🌭 🍟 🌮 🌯 🍿 🍩 🍪 🎂 🧁 🍰 🍦 🍭 🍫 ☕ 🍺 🍷' },
    { name: 'Sport & games', list: '⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🏆 🥇 🥈 🥉 🎯 🎮 🕹️ 🎲 ♟️ 🎳 ⛳ 🚴 🏊 🏋️' },
    { name: 'Travel', list: '🚗 🚕 🚌 🚑 🚒 🚜 🏎️ 🚂 ✈️ 🚀 🛸 🚁 ⛵ 🚢 🚲 🛴 🏠 🏰 🗽 🗼 🎡 ⛺ 🗺️' },
    { name: 'Objects', list: '💡 🔑 🔒 🔓 📱 💻 🖥️ ⌚ 📷 🎧 🎸 🎹 🥁 🎤 🎬 📚 📖 ✏️ 📌 📎 🔍 🧲 🔔 🕯️ 🧸 👑 💎 🎁 🎈 🛒 ⚙️ 🧪 🔬 🩺 💊' },
    { name: 'Party & seasons', list: '🎉 🎊 🎆 🎇 🎃 👻 💀 🎄 🎅 🤶 🦃 🐣 🥚 🎀 🍾 🥂' },
    { name: 'Symbols', list: '✅ ❌ ❓ ❗ ➕ ➖ ✖️ ♻️ ☮️ ☯️ ⚛️ ♾️ 💬 💭 🎵 🎶 ♠️ ♥️ ♦️ ♣️ ⬆️ ⬇️ ⭕ 🔷 🔶 🔺 ⏰ 📈 💰 💵 💳 🏦' }
  ];

  var SHAPE_ORDER_UI = ['rectangle', 'circle', 'ellipse', 'square', 'triangle', 'diamond',
    'pentagon', 'hexagon', 'octagon',
    'heart', 'hearts2', 'heartBreak', 'lips', 'infinity', 'envelope', 'ringGem',
    'star', 'star6', 'burst', 'ring', 'crescent', 'arrow', 'cross', 'shield',
    'bubble', 'crown', 'bolt', 'pin',
    'smiley', 'ghost', 'robot', 'teddy', 'bear', 'bunny', 'snowman', 'balloon',
    'icecream', 'cupcake', 'rocket', 'pumpkin', 'alien',
    'cloud', 'droplet', 'flame', 'leaf', 'tree', 'apple', 'butterfly', 'fish', 'paw',
    'house', 'bulb', 'note', 'key', 'gift', 'bell', 'camera', 'gear', 'umbrella', 'tshirt',
    'football', 'medal', 'trophy',
    'plane', 'car'];

  /* Draw a shape so that it FITS THE CANVAS, whatever box it actually occupies.

     The shapes are written in a notional unit box, but a good many of them
     deliberately reach outside it: the parametric heart's bottom point sits at
     y = +1.10, the droplet at +1.22, the map pin at +1.20, and the pointed
     n-gons at 1.15. Scaling the box straight onto the canvas half-height
     therefore pushed the bottom of those shapes past the bottom edge, where the
     mask was simply clipped — the heart lost the last 7 cells of its point, so
     the cloud came out flat-bottomed both on screen and in the exported PNG.

     Rather than hand-tuning every shape's numbers until they happen to fit —
     which breaks again the moment a shape is edited — draw once, measure the
     ink, and redraw at the scale that makes the measurement fit. Same approach
     the glyph mask already uses, and for the same reason: the only reliable
     description of how big a drawing is, is the drawing. */
  function drawFitted(x, gw, gh, drawFn) {
    var cx = gw / 2, cy = gh / 2;
    /* Probe at HALF the scale that would fill the frame. The measurement is
       taken from the canvas, so anything drawn beyond the edge is invisible to
       it and a shape that overflows would measure as merely "exactly the
       canvas" — the overflow that is the whole problem cannot be seen. At half
       scale every shape in the library lands well inside the frame, so the box
       that comes back is the true one. */
    var probe = Math.min(gw, gh) / 4;

    x.save(); x.translate(cx, cy); x.scale(probe, probe); drawFn(x); x.restore();

    var d = x.getImageData(0, 0, gw, gh).data;
    var x0 = gw, x1 = -1, y0 = gh, y1 = -1, px, py;
    for (py = 0; py < gh; py++) {
      for (px = 0; px < gw; px++) {
        if (d[(py * gw + px) * 4 + 3] > 128) {
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      }
    }
    x.clearRect(0, 0, gw, gh);
    if (x1 < 0) { x.fillRect(0, 0, gw, gh); return; }     // drew nothing; use the frame

    // uniform scale, so a circle stays round and a heart stays a heart
    var k = Math.min((gw * 0.98) / (x1 - x0 + 1), (gh * 0.98) / (y1 - y0 + 1));

    /* Re-place so the measured box lands centred. Under the probe transform a
       point maps to C + probe*p; under the new one to C2 + probe*k*p, so
       C2 = C - k*(boxCentre - C) puts the box's centre back on the canvas
       centre. */
    var bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
    x.save();
    x.translate(cx - k * (bcx - cx), cy - k * (bcy - cy));
    x.scale(probe * k, probe * k);
    drawFn(x);
    x.restore();
  }

  /* Build a rasterised mask at the packer's grid resolution and return a
     predicate over normalised [-1,1] coords. Drawing the shape with real
     canvas paths — rather than an implicit inequality — is what makes a heart
     look like a heart and a star like a star. */
  WordCloudApp.prototype.buildMask = function (shape, gw, gh) {
    var c = document.createElement('canvas');
    c.width = gw; c.height = gh;
    var x = c.getContext('2d', { willReadFrequently: true });
    /* Left TRANSPARENT rather than filled black, because the mask is read back
       from the alpha channel and not from a colour one.

       Colour emoji are the reason. A glyph like 🌳 ignores fillStyle entirely
       and paints itself in its own colours, so a mask thresholded on the red
       channel — as this was — saw a green tree as nearly black and produced an
       almost empty shape. Every green, blue or purple emoji was silently
       broken while the red and orange ones happened to work. Alpha is the one
       channel that means "the glyph covers this pixel" for both a flat white
       vector fill and a full-colour emoji. */
    x.fillStyle = '#fff';

    if (shape === 'glyph') {
      this.drawGlyphMask(x, gw, gh);
    } else if (shape === 'image') {
      this.drawImageMask(x, gw, gh);
    } else {
      var def = SHAPE_DEFS[shape] || SHAPE_DEFS.rectangle;
      drawFitted(x, gw, gh, def.draw);
    }

    /* Kept so render() can paint the silhouette behind the words. It is THIS
       canvas rather than a fresh higher-resolution redraw, so what is shown
       behind the words is exactly the mask the words were packed into — a
       redraw at another size would fit fractionally differently and words
       would sit a hair outside their own shape. */
    this.maskCanvas = c;

    var d = x.getImageData(0, 0, gw, gh).data;
    var cells = new Uint8Array(gw * gh);
    for (var i = 0; i < gw * gh; i++) cells[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    return function (nx, ny) {
      var gx = Math.floor((nx + 1) / 2 * gw);
      var gy = Math.floor((ny + 1) / 2 * gh);
      if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
      if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
      return cells[gy * gw + gx] === 1;
    };
  };

  /* Any character the visitor's machine can draw, used as the silhouette: a
     letter, a digit, an emoji, a symbol, a short word. This is the whole reason
     the shape list is not limited to what is hand-drawn above — the sites with
     "thousands of shapes" are, under the covers, doing exactly this with icon
     fonts. Draw it enormous, take its alpha, and it is a mask.

     Binary-searching the font size to fill the box matters: emoji, capitals and
     descenders all have wildly different ink extents for the same nominal size,
     so a fixed size gives a shape that is tiny in one case and clipped in the
     next. */
  WordCloudApp.prototype.drawGlyphMask = function (x, gw, gh) {
    var text = (this.opts.glyph || '★').slice(0, 12);
    var probe = document.createElement('canvas');
    probe.width = gw; probe.height = gh;
    var p = probe.getContext('2d', { willReadFrequently: true });
    var family = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",' +
                 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

    function inkBox(size) {
      p.clearRect(0, 0, gw, gh);
      p.font = '700 ' + size + 'px ' + family;
      p.textAlign = 'center'; p.textBaseline = 'middle';
      p.fillStyle = '#fff';
      p.fillText(text, gw / 2, gh / 2);
      var d = p.getImageData(0, 0, gw, gh).data;
      var x0 = gw, x1 = -1, y0 = gh, y1 = -1;
      for (var yy = 0; yy < gh; yy++) {
        for (var xx = 0; xx < gw; xx++) {
          if (d[(yy * gw + xx) * 4 + 3] > 60) {
            if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
            if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
          }
        }
      }
      return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }

    // grow from a small probe rather than search blind: one measurement at a
    // known size tells us the scale factor almost exactly, then one correction
    var base = Math.max(12, Math.round(Math.min(gw, gh) / 3));
    var b = inkBox(base);
    if (!b) { x.fillRect(0, 0, gw, gh); return; }        // nothing drew — fill the frame
    var k = Math.min((gw * 0.97) / b.w, (gh * 0.97) / b.h);
    var size = Math.max(8, Math.min(4000, Math.round(base * k)));
    var fit = inkBox(size) || b;

    x.save();
    x.font = '700 ' + size + 'px ' + family;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    // recentre on the ink, not on the em box
    x.fillText(text, gw / 2 + (gw / 2 - fit.cx), gh / 2 + (gh / 2 - fit.cy));
    x.restore();
  };

  /* A picture the visitor chose, turned into a silhouette. A logo, a pet, a
     signature, a country outline — anything with a clear shape in it.

     Two ways a picture says "this part is the shape", and which one applies is
     decided by looking rather than by asking: a PNG with transparency means it
     wherever it is opaque, and a photo or a flat JPEG means it wherever it is
     darker than its background. Getting that wrong inverts the whole image,
     hence the switch as well.

     The file is read with FileReader and drawn to a canvas in this tab. It is
     never uploaded — which is the same promise the rest of the tool makes, and
     matters more here, because people will drop in a company logo. */
  WordCloudApp.prototype.drawImageMask = function (x, gw, gh) {
    var img = this.shapeImage;
    if (!img || !img.width || !img.height) { x.fillRect(0, 0, gw, gh); return; }

    var scratch = document.createElement('canvas');
    scratch.width = gw; scratch.height = gh;
    var sx = scratch.getContext('2d', { willReadFrequently: true });
    var k = Math.min((gw * 0.98) / img.width, (gh * 0.98) / img.height);
    var dw = img.width * k, dh = img.height * k;
    sx.drawImage(img, (gw - dw) / 2, (gh - dh) / 2, dw, dh);

    var src = sx.getImageData(0, 0, gw, gh);
    var d = src.data;
    var i, n = gw * gh;

    /* The picture is fitted into the canvas, so unless its proportions match
       exactly there are bands of untouched canvas down the sides or along the
       top. Those pixels are transparent BLACK — alpha 0, rgb 0,0,0 — and a
       luminance test reads black as ink and calls them part of the shape. That
       alone turned every photo into a filled rectangle, whatever the threshold
       was. Anything the picture did not cover is outside, full stop. */
    var drawn = new Uint8Array(n);
    for (i = 0; i < n; i++) drawn[i] = d[i * 4 + 3] > 8 ? 1 : 0;

    /* Three ways a picture says which part is the shape, chosen by looking at
       the picture rather than by asking:

       ALPHA   a cut-out PNG — the shape is wherever it is opaque.
       KEY     a subject on a flat background (a logo, a sticker, a product
               shot): all four corners are near enough the same colour, so the
               shape is everything unlike that colour.
       INK     anything else — split light from dark, with the split point
               chosen by Otsu's method rather than a fixed number, because a
               fixed number is right for one picture and wrong for the next. */
    var clear = 0;
    for (i = 0; i < n; i++) if (drawn[i] && d[i * 4 + 3] < 200) clear++;
    var drawnCount = 0;
    for (i = 0; i < n; i++) if (drawn[i]) drawnCount++;
    var mode = (drawnCount && clear > drawnCount * 0.04) ? 'alpha' : null;

    function px(ix) { return [d[ix * 4], d[ix * 4 + 1], d[ix * 4 + 2]]; }
    function dist(a, b) {
      return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    }
    var key = null;
    if (!mode) {
      // corners of the picture itself, not of the canvas
      var x0 = 0, x1 = gw - 1, y0 = 0, y1 = gh - 1, r, c2;
      for (r = 0; r < gh; r++) { var any = false; for (c2 = 0; c2 < gw; c2++) if (drawn[r * gw + c2]) { any = true; break; } if (any) { y0 = r; break; } }
      for (r = gh - 1; r >= 0; r--) { var any2 = false; for (c2 = 0; c2 < gw; c2++) if (drawn[r * gw + c2]) { any2 = true; break; } if (any2) { y1 = r; break; } }
      for (c2 = 0; c2 < gw; c2++) { var any3 = false; for (r = 0; r < gh; r++) if (drawn[r * gw + c2]) { any3 = true; break; } if (any3) { x0 = c2; break; } }
      for (c2 = gw - 1; c2 >= 0; c2--) { var any4 = false; for (r = 0; r < gh; r++) if (drawn[r * gw + c2]) { any4 = true; break; } if (any4) { x1 = c2; break; } }
      var cs = [px(y0 * gw + x0), px(y0 * gw + x1), px(y1 * gw + x0), px(y1 * gw + x1)];
      var spread = 0;
      for (var a = 0; a < 4; a++) for (var b = a + 1; b < 4; b++) spread = Math.max(spread, dist(cs[a], cs[b]));
      if (spread < 60) {
        mode = 'key';
        key = [Math.round((cs[0][0] + cs[1][0] + cs[2][0] + cs[3][0]) / 4),
               Math.round((cs[0][1] + cs[1][1] + cs[2][1] + cs[3][1]) / 4),
               Math.round((cs[0][2] + cs[1][2] + cs[2][2] + cs[3][2]) / 4)];
      }
    }

    var cut;
    if (!mode) {
      mode = 'ink';
      // Otsu: the split that best separates the picture into two groups
      var hist = [], t;
      for (t = 0; t < 256; t++) hist[t] = 0;
      for (i = 0; i < n; i++) {
        if (!drawn[i]) continue;
        hist[Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2])]++;
      }
      var sum = 0;
      for (t = 0; t < 256; t++) sum += t * hist[t];
      var sumB = 0, wB = 0, best = -1;
      cut = 128;
      for (t = 0; t < 256; t++) {
        wB += hist[t];
        if (!wB) continue;
        var wF = drawnCount - wB;
        if (wF <= 0) break;
        sumB += t * hist[t];
        var mB = sumB / wB, mF = (sum - sumB) / wF;
        var between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; cut = t; }
      }
    }

    /* The slider. 50 leaves the automatic choice alone; moving it takes in more
       or less of the picture. This is the control the job actually needs — no
       automatic threshold is right for every image, and without a way to nudge
       it the only feedback is "that came out wrong". */
    var tune = (this.opts.imageThreshold == null ? 50 : this.opts.imageThreshold) - 50;
    if (mode === 'ink') cut = Math.max(2, Math.min(254, cut + tune * 1.8));
    var keyTol = Math.max(8, 60 + tune * 1.6);

    var out = x.createImageData(gw, gh);
    var o = out.data;
    var invert = !!this.opts.imageInvert;
    var inCount = 0;
    for (i = 0; i < n; i++) {
      var inside = false;
      if (drawn[i]) {
        if (mode === 'alpha') inside = d[i * 4 + 3] > 128;
        else if (mode === 'key') inside = dist(px(i), key) > keyTol;
        else inside = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) < cut;
        if (invert) inside = !inside;
      }
      if (inside) inCount++;
      o[i * 4] = 255; o[i * 4 + 1] = 255; o[i * 4 + 2] = 255;
      o[i * 4 + 3] = inside ? 255 : 0;
    }
    x.putImageData(out, 0, 0);

    // kept so generate() can say something useful when the result is unusable
    this.imageRead = { mode: mode, coverage: drawnCount ? inCount / drawnCount : 0 };
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
    /* 3px cells rather than 4. The collision grid is the resolution limit on how
       closely two words can sit and on how faithfully the edge of a shape can be
       followed, and a third off both is visible in the outline. */
    var grid = 3;
    var gw = Math.ceil(this.opts.width / grid), gh = Math.ceil(this.opts.height / grid);
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    var maskFn = this.buildMask(this.opts.shape, gw, gh);
    this.result = packCloud(this.items, {
      width: this.opts.width, height: this.opts.height, shape: this.opts.shape,
      maxWords: this.opts.maxWords, minFont: this.opts.minFont, maxFont: this.opts.maxFont,
      rotate: this.opts.rotate, seed: this.opts.seed, gridSize: grid,
      fill: this.opts.repeat !== false,
      fillMinFont: this.opts.fillMinFont,
      angleSet: ANGLE_SETS[this.opts.angles] ? ANGLE_SETS[this.opts.angles].angles : undefined
    }, this.spriteMaker(grid), maskFn);
    this.lastMs = (window.performance && performance.now) ? Math.round(performance.now() - t0) : null;
    var top = this.items.slice(0, 3).map(function (w) { return w.word + ' (' + w.count + ')'; }).join(', ');
    var note = this.result.total + ' words placed from ' + this.items.length +
      ' unique' + (this.opts.repeat === false ? '' : ' (repeated to fill the shape)') +
      '. Most frequent: ' + top + '.';
    /* Say so when a picture has not given us a shape, rather than quietly
       handing back a rectangle and leaving the visitor to wonder what they did
       wrong. A photograph that fills its own frame has no silhouette in it to
       find — no threshold can invent one — and that is worth saying plainly. */
    if (this.opts.shape === 'image' && this.imageRead) {
      var cov = this.imageRead.coverage;
      if (cov > 0.92) {
        note += ' — that picture came out almost solid, so the cloud is a rectangle. ' +
          'Drag Edge to the left, or use a picture with a clear outline against a plain background.';
      } else if (cov < 0.04) {
        note += ' — almost none of that picture registered as a shape. Drag Edge to the right, ' +
          'or tick "Swap which part is the shape".';
      }
    }
    this.noteHost.textContent = note;
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

    // the silhouette, faint, behind the words
    if (this.opts.shapeTint > 0 && this.maskCanvas) {
      /* Rebuilt every paint rather than cached. It is a 320x200 recolour, far
         cheaper than the layout that just ran, and caching it needs a key over
         the shape, the glyph, the palette and the canvas size — four things to
         get wrong for no measurable gain. */
      if (!this._tintCanvas) this._tintCanvas = document.createElement('canvas');
      var tc = this._tintCanvas;
      tc.width = this.maskCanvas.width; tc.height = this.maskCanvas.height;
      var tx = tc.getContext('2d');
      tx.clearRect(0, 0, tc.width, tc.height);
      tx.drawImage(this.maskCanvas, 0, 0);
      // recolour the white mask without touching its coverage
      tx.globalCompositeOperation = 'source-in';
      tx.fillStyle = pal.colors[0];
      tx.fillRect(0, 0, tc.width, tc.height);
      tx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = this.opts.shapeTint;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tc, 0, 0, this.opts.width, this.opts.height);
      ctx.restore();
    }

    /* Colour by size rank. The biggest words on the canvas take the first
       swatch, and the band walks down the palette as the words get smaller, so
       the picture has a hierarchy: the eye is pulled to the headline words
       rather than to whichever piece of filler happened to draw the loudest
       colour. The band is derived from the actual sizes present, not from
       frequency, so it stays right whatever the text is. */
    var mode = this.opts.colorMode || 'rank';
    var sizes = this.result.placed.map(function (p) { return p.fontSize; });
    var loSize = Math.min.apply(null, sizes.length ? sizes : [1]);
    var hiSize = Math.max.apply(null, sizes.length ? sizes : [1]);
    var nCol = pal.colors.length;
    function colorFor(p) {
      if (mode === 'single') return pal.colors[0];
      if (mode === 'random') return pal.colors[Math.floor(p.colorSeed * nCol) % nCol];
      var t = hiSize === loSize ? 0 : (hiSize - p.fontSize) / (hiSize - loSize);
      // a nudge from the word's own seed, so equal-sized words are not a
      // uniform block of one colour
      var i = Math.floor(t * (nCol - 0.001) + (p.colorSeed - 0.5) * 0.9);
      return pal.colors[Math.max(0, Math.min(nCol - 1, i))];
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.result.placed.forEach(function (p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.angle) ctx.rotate(-p.angle);
      ctx.font = fontCss.replace('%s', p.fontSize);
      ctx.fillStyle = colorFor(p);
      ctx.fillText(p.word, 0, 0);
      ctx.restore();
    });

    var cov = Math.round((this.result.coverage || 0) * 100);
    this.statusHost.textContent = this.canvas.width + '×' + this.canvas.height + ' px  ·  ' +
      cov + '% of the shape filled' +
      (this.lastMs != null ? '  ·  laid out in ' + this.lastMs + ' ms' : '');
  };

  /* Export the canvas as a PNG the visitor can save. On a normally-served page
     an <a download> of a blob URL saves the file; there is no upload. */
  WordCloudApp.prototype.download = function () {
    var self = this;
    this.canvas.toBlob(function (blob) {
      if (!blob) { self.statusHost.textContent = 'Could not create the image on this browser.'; return; }
      /* Counted here and not on the button press: a browser whose toBlob
         hands back nothing takes the early return above, so reaching this
         line means the visitor is actually holding a PNG — the same rule
         tool-shell.js applies to its produced files. */
      if (window.KSLab) window.KSLab.used('export');
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

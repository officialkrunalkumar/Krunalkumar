/* ==========================================================================
   kaleidoscope.js — a mirror barrel you can draw into.
   --------------------------------------------------------------------------
   THE INK DOES NOT LIVE ON THE GAME CANVAS. That is the first decision and
   everything else follows from it.

   The shell clears the canvas before every draw() — it has to, because every
   other toy in this section repaints a whole world each frame. A drawing that
   only exists for one frame is not a drawing, so the figure is kept in an
   off-screen buffer that nothing ever clears, and draw() does one thing with
   it: turns it a little and blits it. Which means the slow rotation of the
   whole figure costs one transform rather than a re-render of every stroke
   ever laid, and means the number of marks on the disc has no bearing at all
   on the frame time. Ten thousand strokes draw exactly as fast as one.

   It also decides where the pointer goes. A stroke is stamped into the buffer
   at the pointer's position ROTATED BACK by the current spin angle, so the
   mark lands under your cursor at the moment you make it and then drifts away
   with the rest of the figure. Stamping in screen space instead leaves every
   line bent by however far the barrel turned while you were drawing it, which
   reads as the toy fighting you rather than as a rotation.

   ONE PATH, EVERY COPY IN IT. A stroke at twenty-four segments with the
   mirror on is forty-eight little lines. The obvious version rotates the
   context and strokes once per copy, which is forty-eight beginPath/stroke
   pairs per pointer event and audibly stalls a trackpad drag. Instead the
   cosines and sines for the current fold are precomputed once when the
   segment count changes, all forty-eight lines go into a single path, and the
   path is stroked once — twice with the glow on. Two stroke calls an event,
   whatever the symmetry is set to.

   MIRROR VERSUS ROTATION IS A REAL DISTINCTION AND THE TOGGLE IS THERE TO
   SHOW IT. Rotation alone is the cyclic group: N copies of your stroke spun
   round the middle, and a spiral drawn under it comes out as a pinwheel that
   leans one way. Add the reflection and it becomes the dihedral group, 2N
   copies, and the figure loses its handedness — which is what an actual
   kaleidoscope's two mirrors do to the light. A real barrel cannot turn it
   off. This one can, and the difference is the most interesting thing on the
   page.

   THE AUTO PEN IS A FLOW FIELD IT CARRIES A HEADING THROUGH, AND IT TOOK
   THREE TRIES.

   A De Jong or Clifford map was the first attempt and is wrong here for a
   reason that has nothing to do with taste: those maps are ITERATED, so
   consecutive points are nowhere near each other and joining them draws
   chords across the disc rather than a stroke. What is wanted is a pen, so
   the attractor was rewritten as a velocity field and integrated — continuous
   by construction.

   That was still wrong, and watching it fail is the more useful half of this
   note. Left alone for half a minute the pen settled into a closed loop and
   redrew the same twelve-pointed star for as long as anybody cared to watch.
   That is not a tuning problem, it is Poincaré–Bendixson: put the pen exactly
   where the field says and the path has nothing available to it but fixed
   points, closed orbits, and approaches to one of the two. Drifting the
   coefficients deforms that orbit slowly; it does not break it.

   So the pen carries a HEADING. The field turns it rather than placing it,
   which puts the direction of travel into the state and takes the theorem out
   of the way. The first version of that made the field an acceleration
   against a linear drag, which is the textbook arrangement and produced a pen
   that crawled: the field reverses sign several times inside the drag's own
   time constant, so the two mostly cancel out. Steering and speed are
   different concerns, so they are now different terms — the field only turns,
   and a separate term holds the pen near a cruising speed. It wanders for as
   long as you leave it running and never quite repeats.

   A small constant swirl is added to the field on top of all that, because a
   pure field has fixed points, and a pen steered into one has nothing left to
   turn it until the coefficients drift out from under it.

   Sound is one soft note per mark, gated, and it is never a bed. Everything
   audible here is caused by a stroke happening, which is the definition of a
   one-shot; a held layer would mean the toy humming at an empty room, and an
   empty room is most of this toy's life. Pitch comes off the radius — the
   middle of the figure is the top of the scale — and the scale is pentatonic,
   so no two marks anywhere in the disc can disagree with each other.

   Nothing here flashes. Ink accumulates additively over several frames, the
   auto-mode fade is one twelve-thousandth of the alpha every half second, and
   the only instantaneous change of the whole field is the Clear button, which
   is a thing a visitor pressed. prefers-reduced-motion is honoured by putting
   the rotation slider itself to zero rather than by quietly ignoring it — see
   the note in reset().
   ========================================================================== */

(function () {
  'use strict';

  var W = 640;
  var H = 460;
  var TAU = Math.PI * 2;
  var CX = W / 2;
  var CY = H / 2;

  /* The disc the figure lives in. Half the short side is 230, and the twenty
     pixels held back are what let the whole figure turn without the rim ever
     leaving the frame: a rotation about the centre only stays inside a
     rectangle if the ink stays inside the inscribed circle. */
  var R = 210;

  /* The ink buffer is kept at twice the logical size. The shell caps its
     backing store at devicePixelRatio 2, so this is exactly the resolution a
     retina screen asks for and a straight downsample everywhere else. It also
     decides the export: the PNG comes out 1280 x 920 for nothing extra. Four
     times would be sharper on no display anybody owns and would cost 19 MB of
     texture to be sharper on it. */
  var SS = 2;

  /* Colour is a position on a cycle rather than a value picked per stroke, so
     a palette is a function of one number between 0 and 1. Mono moves
     lightness instead of hue, because that is the only way "no colour" can
     still be a cycle rather than a flat grey. */
  var PALETTES = {
    spectrum: { h: 0, span: 360, s: 84, l: 60, lswing: 6 },
    ember: { h: 344, span: 96, s: 92, l: 56, lswing: 10 },
    ice: { h: 168, span: 118, s: 86, l: 60, lswing: 8 },
    mono: { h: 210, span: 0, s: 0, l: 66, lswing: 26 }
  };

  function ink(pal, t, a) {
    var h = (pal.h + pal.span * t) % 360;
    var l = pal.l + pal.lswing * Math.sin(t * TAU);
    return 'hsla(' + h.toFixed(1) + ',' + pal.s + '%,' + l.toFixed(1) + '%,' + a.toFixed(3) + ')';
  }

  /* A minor pentatonic over three octaves, high to low. Written as
     frequencies because nothing in this file needs to name a note, and a
     table of numbers cannot disagree with itself about what A is. Descending,
     so index 0 is the centre of the figure and the last entry is the rim. */
  var SCALE = [
    987.77, 880.00, 783.99, 659.25, 587.33,
    523.25, 440.00, 392.00, 329.63, 293.66,
    261.63, 220.00, 196.00, 164.81, 146.83
  ];

  /* The auto pen is self-propelled: the field STEERS it and a separate term
     holds it near a cruising speed. The first version had the field
     accelerate it against a linear drag, which is the textbook arrangement
     and gave a pen that crawled — the field reverses sign several times
     inside the drag's own time constant, so the two mostly cancelled and
     thirty seconds of running produced 240 marks where it wanted several
     thousand. Steering and speed are separate concerns and are now separate
     terms.

     STEER is the turning force in units a second squared, and it is the one
     number here with a real trade-off: raise it and the pen turns tightly and
     works a small part of the disc over and over, lower it and it sails
     through the structure without being deflected by it at all. These three
     came out of simulating three minutes of pen at each of a dozen settings
     and counting how many twelve-pixel cells of the disc had been visited —
     300 with a loose hold covers better than twice as much ground as 380 with
     a tight one, which is not a difference anybody was going to see by eye in
     the time it takes to guess wrong.

     CRUISE is the speed it aims for, and HOLD is how quickly it gets back
     there, in reciprocal seconds — deliberately slack, so the pen still
     speeds up and slows down with the field. That variation is what the
     colour cycle and the brush width read; tighten HOLD and the auto figure
     comes out in one colour at one width. */
  var STEER = 300;
  var CRUISE = 165;
  var HOLD = 3;

  /* Shortest segment the auto pen will stamp. Below this the strokes overlap
     so heavily that the extra ones are invisible and only cost frame time;
     above about two the curve starts reading as a polygon. */
  var MIN_SEG = 1.2;

  /* The rotation the field is given whatever else it is doing, and it does
     two jobs. Near the middle it is insurance: a pure field has fixed points,
     and a pen steered into one sits there pumping ink into a single spot, so
     a small tangential term means the only place the field can vanish is the
     exact centre.

     Out near the rim it is doing something else entirely, and the toy is much
     better for it. Without the ramp the containment spring meets a pen coming
     at it head on, turns it round, and sends it back through the middle: the
     figure that produced was a wheel of straight radial spokes, over and over,
     because every stroke was a pen falling to the centre and being thrown out
     again. Giving the pen some angular momentum before it gets there makes it
     round the turn instead of rebounding off it, and the strokes come out as
     arcs. SWIRL_R is how much is added per unit of radius past SWIRL_FROM. */
  var SWIRL = 0.30;
  var SWIRL_R = 2.4;
  var SWIRL_FROM = 0.45;

  /* The containment spring: where it starts biting, as a fraction of the
     disc's radius, and how hard. Early and gentle rather than late and stiff,
     so the pen is turned over a long arc rather than stopped dead — the stiff
     version reflected it, which is where the spokes came from. */
  var HOME_FROM = 0.62;
  var HOME_K = 10;

  /* Top of the rotation slider, radians a second. 0.42 is a shade under a
     quarter turn a second at full tilt; past that the figure is a spinning
     wheel rather than a drifting one and drawing into it becomes a game of
     anticipation. */
  var MAX_SPIN = 0.42;

  /* The auto-mode fade. Applied twice a second rather than every frame, and
     this is not an optimisation — an alpha small enough to be invisible per
     frame at 60 Hz rounds to nothing in eight-bit destination alpha and the
     figure never fades at all. At this size and interval the half-life is
     about half a minute, so an unattended figure keeps roughly the last two
     minutes of its own history. A residue of a unit or two of alpha does
     survive the rounding; against this ground it is not visible, and Clear is
     there for when exact is what you want. */
  var FADE_EVERY = 0.5;
  var FADE_A = 0.012;

  /* Our own drawing work per frame, in milliseconds, measured rather than
     assumed — the blit, the ground, and every stamp since the last frame.
     Nine is a bit over half a 60 Hz frame, which leaves the browser the rest
     for compositing and for the page around the toy. Crossing it drops the
     glow pass and the smoothing on the blit, which together are most of the
     elastic cost; the figure is then flatter and still the same figure.
     Restoring at 4.5 rather than at 9 is the hysteresis that stops it
     oscillating on a machine sitting exactly at the budget. */
  var WORK_BUDGET = 9;
  var WORK_RESTORE = 4.5;

  var now = (window.performance && window.performance.now)
    ? function () { return window.performance.now(); }
    : function () { return +new Date(); };

  function clamp01(v) {
    if (!(v >= 0)) return 0;            // catches NaN as well as negatives
    return v > 1 ? 1 : v;
  }

  GameShell.define({
    id: 'game-kaleidoscope',
    slug: 'kaleidoscope',
    title: 'Kaleidoscope',
    width: W,
    height: H,
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    tapAction: false,

    setup: function (g) {
      /* Asked once. A visitor who has told their operating system they do not
         want movement has told every page on it, and re-reading the query per
         frame would only let it change under a toy already running. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var segments = 12;
      var mirror = true;
      var spinRate = 0.092;         // radians a second
      var brush = 2.9;              // logical units, before the speed term
      var pal = PALETTES.spectrum;
      var auto = true;

      var spin = 0;                 // where the whole figure has turned to
      var cyc = 0;                  // position on the palette, 0..1
      var penW = 2.9;               // the smoothed brush width
      var marks = 0;                // stamps laid since the last clear

      var drawing = false;          // a pointer is down and is the pen
      var captured = false;
      var lastPt = null;            // last stamped point, in FIGURE space
      var lastT = 0;

      var autoX = CX + R * 0.35;
      var autoY = CY;
      var autoPx = autoX;
      var autoPy = autoY;
      /* Started at cruising speed rather than at rest, so the first stroke
         is a stroke instead of the pen easing out of a standstill. */
      var autoVX = CRUISE;
      var autoVY = 0;
      var autoT = 0;
      var segLen = 0;
      var segTime = 0;
      var fadeAcc = 0;

      var quality = 1;              // 1: glow and smoothing. 0: neither.
      var workMs = 0;               // work booked against this frame
      var workEma = 5;
      var penLabel = '';
      var spinForced = false;       // reduced motion has zeroed the slider once

      var segIn = document.getElementById('game-segments');
      var mirrorBtn = document.getElementById('game-mirror');
      var spinIn = document.getElementById('game-spin');
      var brushIn = document.getElementById('game-brush');
      var palSel = document.getElementById('game-palette');
      var clearBtn = document.getElementById('game-clear');
      var saveBtn = document.getElementById('game-save');
      var autoBtn = document.getElementById('game-auto');

      /* ---------------------------------------------------------------
         The buffer. Created once, never resized, never cleared except by
         Clear and by a restart.

         The clip is set ONCE, immediately after the transform, and then
         left alone for the life of the page: a clip is part of the context
         state, nothing here ever calls save() on this context, and so every
         stroke for the rest of the session is cut to the disc for free. The
         alternative — clipping per stamp — is a save, an arc, a clip and a
         restore on every pointer event, for a boundary that never moves.

         Ink is drawn with 'lighter', the same additive rule disco.js uses
         for its beams: two strokes crossing brighten each other rather than
         one painting over the other, which is what light through coloured
         glass actually does and is the whole look of the thing.
         --------------------------------------------------------------- */
      var buf = document.createElement('canvas');
      buf.width = W * SS;
      buf.height = H * SS;
      var bctx = buf.getContext('2d');
      if (bctx) {
        bctx.setTransform(SS, 0, 0, SS, 0, 0);
        bctx.beginPath();
        bctx.arc(CX, CY, R, 0, TAU);
        bctx.clip();
        bctx.lineCap = 'round';
        bctx.lineJoin = 'round';
        bctx.globalCompositeOperation = 'lighter';
      }

      /* The fold, precomputed. Rebuilt only when the segment count changes,
         which is three or four times a session against sixty stamps a
         second — the entire reason a stroke costs two trigonometric lookups
         per copy rather than two calls to Math.cos. */
      var foldC = [];
      var foldS = [];
      function buildFold() {
        foldC = [];
        foldS = [];
        for (var k = 0; k < segments; k++) {
          var a = k * TAU / segments;
          foldC.push(Math.cos(a));
          foldS.push(Math.sin(a));
        }
      }

      function setPen(label) {
        if (label === penLabel) return;
        penLabel = label;
        g.stat('pen', label);
      }

      function sayFold() {
        g.stat('fold', (segments * (mirror ? 2 : 1)) + '-fold');
      }

      function saySpin() {
        var deg = Math.round(spinRate * 180 / Math.PI);
        g.stat('spin', deg + '°/s');
      }

      /* ---------------------------------------------------------------
         One stamp: your stroke and every copy of it, in a single path.

         `len` is the length of the segment being laid and it sets the
         alpha, which is not decoration. Ink is laid PER UNIT DISTANCE: a
         pointer resting still still fires sixty events a second, and at a
         fixed alpha under an additive composite that stacks sixty identical
         strokes on one spot and burns a white hole through the figure
         inside a second. Scaling the alpha by how far the pen actually
         moved makes a slow stroke and a fast one deposit the same amount of
         colour along the same line, which is what a pen does.
         --------------------------------------------------------------- */
      function stamp(x0, y0, x1, y1, w, len) {
        if (!bctx) return;
        var t0 = now();

        var ax = x0 - CX, ay = y0 - CY;
        var bx = x1 - CX, by = y1 - CY;
        var k, c, s;

        bctx.beginPath();
        for (k = 0; k < foldC.length; k++) {
          c = foldC[k];
          s = foldS[k];
          bctx.moveTo(CX + ax * c - ay * s, CY + ax * s + ay * c);
          bctx.lineTo(CX + bx * c - by * s, CY + bx * s + by * c);
          if (!mirror) continue;
          /* The reflection, taken across the x-axis and then carried round
             by the same fold angle. Reflect first and rotate second and the
             2N copies land as N mirror pairs, which is the dihedral group
             and is what two mirrors in a tube give you. Rotate first and the
             pairs come out straddling the wrong axis: the figure is still
             symmetric, and the seam falls in the middle of a wedge instead
             of on its edge, which reads as a mistake even to somebody who
             could not say why. */
          bctx.moveTo(CX + ax * c + ay * s, CY + ax * s - ay * c);
          bctx.lineTo(CX + bx * c + by * s, CY + bx * s - by * c);
        }

        var a = 0.20 + 0.55 * clamp01(len / 5);
        if (quality) {
          /* The halo. Same path, much wider, a twentieth of the alpha —
             under 'lighter' that is a soft bloom around the core rather than
             a fatter line, and it is the difference between coloured wire
             and coloured light. It is also the first thing dropped when the
             frame budget is missed, because it is the only pass here whose
             absence costs nothing but prettiness. */
          bctx.lineWidth = w * 3.4;
          bctx.strokeStyle = ink(pal, cyc, a * 0.13);
          bctx.stroke();
        }
        bctx.lineWidth = w;
        bctx.strokeStyle = ink(pal, cyc, a);
        bctx.stroke();

        workMs += now() - t0;
      }

      /* One soft note per mark, and never more than a few a second.

         Pitch is the radius: the centre of the figure is the top of the
         scale and the rim is the bottom, so a stroke travelling outward
         falls, which is the one mapping that does not have to be explained
         to anybody. The scale is pentatonic so that marks laid minutes apart
         in different parts of the disc still agree.

         The auto pen is gated three times harder than your hand is. It draws
         forever, and a toy left open in a tab is allowed to be heard as a
         wind chime rather than as a sequencer. */
      function note(speed, rad) {
        if (!g.gate('mark', auto && !drawing ? 0.30 : 0.085)) return;
        var t = clamp01(rad / R);
        var i = Math.round(t * (SCALE.length - 1));
        /* Quiet, and quieter still when the pen is barely moving. The
           shell's one-shots peak at 0.06; a sound this frequent has to sit
           well under that or it stops being an accompaniment. */
        var lvl = 0.011 + 0.024 * clamp01(speed / 380);
        g.pluck(SCALE[i], 0.55 + Math.random() * 0.35, lvl, 'sine');
      }

      /* Everything that lays ink comes through here — your pointer and the
         auto pen both — so the colour cycle, the width and the sound cannot
         drift apart between the two. */
      function mark(x0, y0, x1, y1, speed, dt) {
        /* The palette advances by a slow base drift plus a term in the
           speed, which is what "the colour cycles with how fast you draw"
           has to mean if it is to be true of a pen sitting still as well as
           of one being thrown across the disc. A fast stroke sweeps a third
           of the wheel in a second; a slow one stays in the same family of
           colours for ten. */
        cyc += dt * (0.045 + speed / 1400);
        cyc -= Math.floor(cyc);

        /* Faster is thinner, the way a real brush lifts as it accelerates.
           Smoothed, because the raw figure jitters by a factor of two
           between consecutive trackpad samples and an unsmoothed width
           turns a straight line into a string of beads. */
        var target = brush * (1 - 0.55 * clamp01(speed / 420));
        var k = 12 * dt;
        if (k > 1) k = 1;
        penW += (target - penW) * k;

        var dx = x1 - x0, dy = y1 - y0;
        stamp(x0, y0, x1, y1, penW, Math.sqrt(dx * dx + dy * dy));
        marks++;

        var rx = x1 - CX, ry = y1 - CY;
        note(speed, Math.sqrt(rx * rx + ry * ry));
      }

      function fade() {
        if (!bctx) return;
        var t0 = now();
        bctx.globalCompositeOperation = 'destination-out';
        bctx.fillStyle = 'rgba(0,0,0,' + FADE_A + ')';
        bctx.fillRect(0, 0, W, H);
        bctx.globalCompositeOperation = 'lighter';
        workMs += now() - t0;
      }

      function clearInk(quiet) {
        if (!bctx) return;
        /* clearRect rather than resetting buf.width, which would throw away
           the transform and the clip set up once at the top of setup(). It
           is cut to the disc like everything else, and the disc is the only
           place ink can be. */
        bctx.clearRect(0, 0, W, H);
        marks = 0;
        if (quiet) return;
        /* A breath rather than a bang. The screen has just gone dark in one
           frame, which is the loudest visual event this toy has, and the
           right sound for it is one that decays out of the way. */
        g.noise(0.38, { type: 'lowpass', freq: 1500, to: 180, q: 0.7, level: 0.030 });
        g.announce('Figure cleared.');
      }

      /* ---------------------------------------------------------------
         The auto pen.

         A velocity field, integrated. See the header for why an iterated
         attractor was thrown away: the maps everybody draws these things
         with jump between successive points, and a pen that teleports draws
         chords rather than curves.

         The four coefficients drift on slow sines whose periods share no
         common factor worth mentioning, so the field the pen is in keeps
         changing shape and never returns to a state it has been in. That is
         what makes the toy worth leaving open: a fixed field settles into a
         closed orbit within a minute and then redraws the same figure for
         as long as you let it.
         --------------------------------------------------------------- */
      function stepAuto(dt) {
        var nx = (autoX - CX) / R;
        var ny = (autoY - CY) / R;

        /* Four coefficients on slow sines whose periods share no useful
           common factor, so the field the pen is in never returns to a shape
           it has already been. They are held between roughly 1.5 and 5: below
           that there is barely one cell of structure across the disc and the
           pen just circles, above it the cells are smaller than the brush and
           the figure turns to felt. */
        var A = 3.1 + 1.5 * Math.sin(autoT * 0.037);
        var B = 2.6 + 1.3 * Math.sin(autoT * 0.029 + 1.7);
        var C = 3.4 + 1.6 * Math.sin(autoT * 0.021 + 3.1);
        var D = 2.4 + 1.1 * Math.sin(autoT * 0.017 + 0.6);

        var r = Math.sqrt(nx * nx + ny * ny);
        var sw = SWIRL + SWIRL_R * (r > SWIRL_FROM ? r - SWIRL_FROM : 0);

        var fx = Math.sin(A * ny) - Math.cos(B * nx) - ny * sw;
        var fy = Math.sin(C * nx) - Math.cos(D * ny) + nx * sw;
        /* Taken before the containment spring is added in, so the speed the
           pen aims for reads the FIELD rather than the wall: a pen being
           turned back from the rim should not also be told to hurry. */
        var fm = Math.sqrt(fx * fx + fy * fy);

        /* Containment, as a spring rather than as a wall. A hard clamp at the
           rim makes the pen slide along the boundary and draw a circle, which
           is the single least interesting figure available. */
        if (r > HOME_FROM && r > 0.0001) {
          var pull = (r - HOME_FROM) * HOME_K;
          fx -= (nx / r) * pull;
          fy -= (ny / r) * pull;
        }

        /* The field steers the pen, it does not place it. See the header: a
           velocity field on the plane can only ever produce fixed points and
           closed orbits, and this toy watched one settle into a star and
           redraw it for half a minute. Carrying a heading is what makes the
           path wander.

           Reduced motion slows the pen rather than stopping it. The pen IS
           the toy — a still kaleidoscope is a photograph — but there is no
           reason it has to race. */
        var slow = reduced ? 0.55 : 1;
        autoVX += fx * STEER * dt;
        autoVY += fy * STEER * dt;

        var sp = Math.sqrt(autoVX * autoVX + autoVY * autoVY);
        /* Only reachable if the steering has exactly cancelled the heading,
           which the swirl term is there to prevent — but a pen with no
           direction at all has no direction to be nudged in either, so it is
           given one rather than left to divide by zero. */
        if (sp < 0.001) { autoVX = CRUISE * slow; autoVY = 0; sp = autoVX; }

        /* Back toward cruising speed, faster where the field is strong. The
           variation is not decoration: it is the only thing the colour cycle
           and the brush width have to read when nobody is holding the
           pointer, and a pen at one fixed speed draws in one fixed colour at
           one fixed width. */
        var want = CRUISE * slow * (0.55 + 0.45 * clamp01(fm / 2));
        var k = HOLD * dt;
        if (k > 1) k = 1;
        var scale = 1 + (want / sp - 1) * k;
        autoVX *= scale;
        autoVY *= scale;
        sp *= scale;

        autoX += autoVX * dt;
        autoY += autoVY * dt;

        /* The backstop the spring should never need. A pen carrying enough
           speed into a stiffening spring can still overshoot the rim for a
           frame or two, and the clip would then quietly eat the stroke — the
           figure would appear to stall against an edge nobody can see.
           Bouncing the radial component instead keeps the stroke visible and
           reads as the mirror it is drawn inside. */
        var dxc = autoX - CX, dyc = autoY - CY;
        var rr = Math.sqrt(dxc * dxc + dyc * dyc);
        var lim = R * 0.985;
        if (rr > lim && rr > 0.0001) {
          autoX = CX + (dxc / rr) * lim;
          autoY = CY + (dyc / rr) * lim;
          var radial = (autoVX * dxc + autoVY * dyc) / rr;
          if (radial > 0) {
            autoVX -= 2 * radial * (dxc / rr);
            autoVY -= 2 * radial * (dyc / rr);
          }
        }

        var dx = autoX - autoPx, dy = autoY - autoPy;
        segLen = Math.sqrt(dx * dx + dy * dy);
        segTime += dt;
        if (segLen < MIN_SEG) return;

        mark(autoPx, autoPy, autoX, autoY, segTime > 0 ? segLen / segTime : sp, segTime);
        autoPx = autoX;
        autoPy = autoY;
        segTime = 0;
      }

      function setAuto(on) {
        auto = on;
        if (autoBtn) {
          autoBtn.setAttribute('aria-pressed', String(auto));
          autoBtn.title = auto ? 'Auto-draw is on — click to take the pen' : 'Auto-draw: let the toy draw itself';
        }
        if (auto) {
          /* Start the pen from where it stopped rather than from the middle,
             so switching the mode back on continues a figure instead of
             ruling a line in from the centre of it. */
          autoPx = autoX;
          autoPy = autoY;
          segTime = 0;
        }
        setPen(auto ? 'Auto' : (drawing ? 'Yours' : 'Idle'));
      }

      function setMirror(on) {
        mirror = on;
        if (mirrorBtn) {
          mirrorBtn.setAttribute('aria-pressed', String(mirror));
          mirrorBtn.title = mirror
            ? 'Mirror is on — every wedge is reflected as well as turned'
            : 'Mirror is off — the copies are turned only, so the figure keeps its handedness';
        }
        sayFold();
      }

      /* ---------------------------------------------------------------
         Saving the figure.

         Composed onto its own canvas rather than read back off the game's,
         for two reasons that both matter. The game canvas is whatever size
         the stage happens to be — a phone in portrait would export a
         340-pixel image — and the buffer is the real resolution, so the PNG
         comes out 1280 wide wherever it was made. And the buffer alone is
         ink on transparency: additive colour on nothing, which lands in a
         viewer with a white background as an invisible file. So the ground
         and the rim are painted under it, and the current rotation applied
         over it, and what is saved is what was on the screen.
         --------------------------------------------------------------- */
      function savePng() {
        var out = document.createElement('canvas');
        out.width = W * SS;
        out.height = H * SS;
        var octx = out.getContext('2d');
        if (!octx || !bctx) {
          g.announce('This browser could not produce the image.');
          return;
        }
        octx.setTransform(SS, 0, 0, SS, 0, 0);
        paintGround(octx);
        octx.save();
        octx.translate(CX, CY);
        octx.rotate(spin);
        octx.drawImage(buf, -CX, -CY, W, H);
        octx.restore();
        paintRim(octx, false);

        var name = 'kaleidoscope-' + segments + (mirror ? '-mirrored' : '-turned') + '.png';

        var deliver = function (href, revoke) {
          var a = document.createElement('a');
          a.href = href;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          if (revoke) window.setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
          g.announce('Saved the figure as ' + name + '.');
          g.pluck(659.25, 0.5, 0.030, 'sine');
        };

        /* toBlob where it exists, a data URL where it does not. The fallback
           is not theoretical: it is the path old WebKit and a handful of
           in-app browsers take, and a two-megabyte data URL is worth
           handing over on those rather than telling somebody their picture
           cannot be saved. Nothing is uploaded on either path — the file is
           built in the tab and handed to the browser's own downloader. */
        if (out.toBlob) {
          out.toBlob(function (blob) {
            if (!blob) { g.announce('This browser could not produce the image.'); return; }
            deliver(URL.createObjectURL(blob), true);
          }, 'image/png');
          return;
        }
        try {
          deliver(out.toDataURL('image/png'), false);
        } catch (err) {
          g.announce('This browser could not produce the image.');
        }
      }

      /* ---------------------------------------------------------------
         Controls. Every one of them also states what it did, because the
         HUD is the only place a visitor can check that a slider they moved
         did the thing the label promised.
         --------------------------------------------------------------- */
      function applySegments(n) {
        if (!(n >= 3)) n = 3;
        if (n > 24) n = 24;
        segments = Math.round(n);
        if (segIn && Number(segIn.value) !== segments) segIn.value = String(segments);
        buildFold();
        sayFold();
      }

      if (segIn) segIn.addEventListener('input', function () {
        applySegments(Number(segIn.value));
      });
      if (mirrorBtn) mirrorBtn.addEventListener('click', function () { setMirror(!mirror); });
      if (spinIn) spinIn.addEventListener('input', function () {
        spinRate = (Number(spinIn.value) / 100) * MAX_SPIN;
        if (!(spinRate > -MAX_SPIN * 1.01 && spinRate < MAX_SPIN * 1.01)) spinRate = 0;
        saySpin();
      });
      if (brushIn) brushIn.addEventListener('input', function () {
        brush = 0.8 + clamp01(Number(brushIn.value) / 100) * 5.2;
      });
      if (palSel) palSel.addEventListener('change', function () {
        pal = PALETTES[palSel.value] || PALETTES.spectrum;
      });
      if (clearBtn) clearBtn.addEventListener('click', function () { clearInk(false); });
      if (saveBtn) saveBtn.addEventListener('click', savePng);
      if (autoBtn) autoBtn.addEventListener('click', function () {
        setAuto(!auto);
        g.announce(auto ? 'Auto-draw on.' : 'Auto-draw off. The pen is yours.');
      });

      /* ---------------------------------------------------------------
         The pointer is the pen.

         Positions are rotated BACK through the current spin before they are
         stamped, so a mark lands under the cursor at the instant it is made.
         See the header.
         --------------------------------------------------------------- */
      function toFigure(p) {
        var c = Math.cos(-spin), s = Math.sin(-spin);
        var x = p.x - CX, y = p.y - CY;
        return { x: CX + x * c - y * s, y: CY + x * s + y * c };
      }

      if (g.canvas) {
        g.canvas.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing') return;
          /* Taking the pointer takes the pen. Two pens drawing into one
             figure fight over the same ink and over the same colour cycle,
             and the machine's stroke keeps cutting across yours — so the
             hand wins, and the auto button is how you hand it back. */
          if (auto) { setAuto(false); }
          drawing = true;
          setPen('Yours');
          var p = toFigure(g.pointAt(event));
          lastPt = p;
          lastT = now();
          /* A tap is a dot. The nudge is not superstition: a zero-length
             subpath with a round cap is drawn by some engines and skipped by
             others, so a tap either left a dot or left nothing depending on
             the browser. A hundredth of a unit is below any pixel and is
             unambiguously a line. */
          mark(p.x, p.y, p.x + 0.01, p.y, 0, 1 / 60);
          if (g.canvas.setPointerCapture) {
            try { g.canvas.setPointerCapture(event.pointerId); captured = true; }
            catch (err) { captured = false; }
          }
        });

        g.canvas.addEventListener('pointermove', function (event) {
          if (!drawing || g.state !== 'playing') return;
          var p = toFigure(g.pointAt(event));
          if (!lastPt) { lastPt = p; lastT = now(); return; }
          var t = now();
          var dt = (t - lastT) / 1000;
          /* A high-rate pointer delivers 200 samples a second and a stamp
             for each is 200 paths a second for a line the eye reads as one
             stroke. Returning WITHOUT moving lastPt is what makes this safe:
             the samples are not dropped, they are merged, and the next stamp
             covers the whole span at the right speed. */
          if (dt < 0.006) return;
          if (dt > 0.1) dt = 0.1;
          var dx = p.x - lastPt.x, dy = p.y - lastPt.y;
          var len = Math.sqrt(dx * dx + dy * dy);
          /* A resting hand is not a stroke. Below a third of a unit the
             movement is trackpad noise, and stamping it lays ink on one spot
             for as long as somebody holds still. */
          if (len < 0.35) return;
          mark(lastPt.x, lastPt.y, p.x, p.y, len / dt, dt);
          lastPt = p;
          lastT = t;
        });

        var lift = function (event) {
          if (!drawing) return;
          drawing = false;
          lastPt = null;
          if (captured && g.canvas.releasePointerCapture && event && event.pointerId != null) {
            try { g.canvas.releasePointerCapture(event.pointerId); } catch (err) { /* already gone */ }
          }
          captured = false;
          setPen(auto ? 'Auto' : 'Idle');
        };
        g.canvas.addEventListener('pointerup', lift);
        g.canvas.addEventListener('pointercancel', lift);
        /* Only meaningful when capture was refused. With the pointer
           captured, leaving the canvas fires nothing and the stroke
           correctly carries on — a drag that runs off the edge and back is
           one stroke, not two. */
        g.canvas.addEventListener('pointerleave', function (event) {
          if (!captured) lift(event);
        });
      }

      /* ---------------------------------------------------------------
         Painting. The ground and the rim are shared with the exporter, so
         a saved PNG cannot drift away from what was on the screen.
         --------------------------------------------------------------- */
      function paintGround(ctx) {
        ctx.fillStyle = '#05070f';
        ctx.fillRect(0, 0, W, H);
        /* A lit disc under the ink. Without it the figure floats in a black
           rectangle with no indication of where the mirrors end, and a
           stroke that vanishes at the rim reads as a bug rather than as an
           edge. */
        var gr = ctx.createRadialGradient(CX, CY, R * 0.12, CX, CY, R * 1.04);
        gr.addColorStop(0, 'rgba(30,41,59,0.55)');
        gr.addColorStop(0.72, 'rgba(15,23,42,0.40)');
        gr.addColorStop(1, 'rgba(2,6,23,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(CX, CY, R * 1.04, 0, TAU);
        ctx.fill();
      }

      function paintRim(ctx, withHint) {
        ctx.strokeStyle = 'rgba(148,163,184,0.24)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(CX, CY, R + 0.5, 0, TAU);
        ctx.stroke();
        if (!withHint || marks > 0) return;
        ctx.fillStyle = 'rgba(148,163,184,0.62)';
        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Drag anywhere in the disc to draw — or press Space and watch it draw itself', CX, H - 16);
        ctx.textAlign = 'left';
      }

      return {
        reset: function () {
          spin = 0;
          cyc = 0;
          drawing = false;
          captured = false;
          lastPt = null;
          autoX = CX + R * 0.35;
          autoY = CY;
          autoPx = autoX;
          autoPy = autoY;
          autoVX = CRUISE;
          autoVY = 0;
          autoT = 0;
          segTime = 0;
          fadeAcc = 0;
          workEma = 5;
          quality = 1;

          if (segIn) segments = Math.round(Number(segIn.value)) || 12;
          if (brushIn) brush = 0.8 + clamp01(Number(brushIn.value) / 100) * 5.2;
          if (palSel && PALETTES[palSel.value]) pal = PALETTES[palSel.value];
          penW = brush;

          if (spinIn) spinRate = (Number(spinIn.value) / 100) * MAX_SPIN;
          /* prefers-reduced-motion is answered by MOVING THE CONTROL, once,
             at boot. Quietly refusing to spin while the slider still shows
             a rotation is the failure disco.js documents on its strobe
             button: the visitor sees a control that does nothing and has no
             way to tell a preference from a bug. Zeroing the slider states
             the position, and leaves the visitor free to raise it — which is
             an explicit request, and outranks a system default. It happens
             once rather than on every restart, because overriding a choice
             somebody made after boot would be the same disrespect in the
             other direction. */
          if (reduced && !spinForced) {
            spinForced = true;
            spinRate = 0;
            if (spinIn) {
              spinIn.value = '0';
              spinIn.title = 'Rotation starts at zero because your system asks for reduced motion';
            }
          }

          /* A restart is a blank disc. There is no run to lose here and no
             score to reset, so the only thing "Restart" can honestly mean on
             a drawing toy is a clean sheet. */
          clearInk(true);

          applySegments(segments);
          setMirror(mirrorBtn ? mirrorBtn.getAttribute('aria-pressed') !== 'false' : true);
          setAuto(autoBtn ? autoBtn.getAttribute('aria-pressed') !== 'false' : true);
          saySpin();
        },

        key: function (name) {
          /* Space takes the machine on and off. It is the one gesture worth
             the only key the shell hands out for free. */
          if (name === 'action') {
            setAuto(!auto);
            g.announce(auto ? 'Auto-draw on.' : 'Auto-draw off. The pen is yours.');
            return;
          }
          /* The arrows drive the two settings whose effect is immediate and
             visible, and they drive them THROUGH the controls rather than
             around them — applySegments and the write below both put the new
             value back into the input, so the panel can never end up stating
             a symmetry or a speed the figure is not using. */
          if (name === 'left') { applySegments(segments - 1); return; }
          if (name === 'right') { applySegments(segments + 1); return; }
          if (name === 'up' || name === 'down') {
            var step = MAX_SPIN * 0.08 * (name === 'up' ? 1 : -1);
            spinRate += step;
            if (spinRate > MAX_SPIN) spinRate = MAX_SPIN;
            if (spinRate < -MAX_SPIN) spinRate = -MAX_SPIN;
            if (spinIn) spinIn.value = String(Math.round((spinRate / MAX_SPIN) * 100));
            saySpin();
          }
        },

        update: function (dt) {
          spin += spinRate * dt;
          if (spin >= TAU) spin -= TAU; else if (spin < 0) spin += TAU;

          if (!auto) return;
          autoT += dt;
          stepAuto(dt);
          /* The fade belongs to the mode that never stops. A figure you drew
             is yours and stays exactly as you left it; a figure a machine is
             still adding to has to lose its oldest ink at the rate it gains
             new ink, or an hour in a background tab is a solid white disc. */
          fadeAcc += dt;
          if (fadeAcc >= FADE_EVERY) { fadeAcc -= FADE_EVERY; fade(); }
        },

        draw: function (ctx) {
          var t0 = now();

          paintGround(ctx);

          ctx.save();
          ctx.translate(CX, CY);
          ctx.rotate(spin);

          /* The fold guides, drawn inside the rotation because the fold is a
             property of the figure and not of the frame around it. Faint
             enough to be scenery, and the only thing on the page that says
             where one wedge ends and the next begins before any ink exists. */
          ctx.strokeStyle = 'rgba(148,163,184,0.055)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (var k = 0; k < foldC.length; k++) {
            ctx.moveTo(0, 0);
            ctx.lineTo(foldC[k] * R, foldS[k] * R);
          }
          ctx.stroke();

          /* Smoothing off is the cheap half of the degrade. A rotated blit
             is resampled either way; asking for the nearest sample instead
             of a filtered one costs a visible shimmer on the strokes and
             buys back a chunk of the only fixed cost in this file. */
          ctx.imageSmoothingEnabled = !!quality;
          if (bctx) ctx.drawImage(buf, -CX, -CY, W, H);
          ctx.restore();

          paintRim(ctx, true);

          /* What our own drawing cost this frame: this function plus every
             stamp and fade booked since the last one. Measured rather than
             inferred from the frame interval, which on a 30 Hz panel would
             report a stall that is not there and degrade a toy that was
             running perfectly. */
          workMs += now() - t0;
          workEma += (workMs - workEma) * 0.08;
          workMs = 0;
          if (quality && workEma > WORK_BUDGET) quality = 0;
          else if (!quality && workEma < WORK_RESTORE) quality = 1;
        }
      };
    }
  });
})();

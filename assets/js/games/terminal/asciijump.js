/* ==========================================================================
   asciijump.js — ski jumping on a character grid.
   --------------------------------------------------------------------------
   After Peter Marschall's asciijump (2003). An in-run you tuck down, one
   instant at the lip that decides everything, and a flight you have to keep
   still while the air tries to tip you over.

   THE TAKEOFF WINDOW IS MEASURED IN SECONDS, NOT IN CELLS. A spatial window
   — "press while you are on these four columns" — is wider at 70 km/h than
   at 100, so it pays you for a slow in-run, which is the opposite of what a
   ski jump should reward. The window is time-to-lip, (RAMP_LEN - p) / v,
   graded against the press, and it is two-sided: firing after the edge has
   to remain possible, or "as late as you dare" costs nothing and everyone
   converges on simply holding until the ramp runs out. Pressing early does
   not launch you early — you leave the ramp when the ramp ends, having
   finished extending too soon to have anything left to spring with — which
   is why the pop is a multiplier on the launch rather than an event of its
   own. The error is then reported in seconds on the results panel, because a
   timing game that says only that you did badly is a slot machine.

   ONE BUTTON DOES BOTH THE HOLD AND THE TRIGGER, because the phone pad has
   one. Holding it tucks; letting go inside the window is the takeoff. A tap
   has to work too — the shell's tap-the-playfield gesture sends a press with
   no matching release, so a hold-only tuck would latch on for ever — hence
   the tuck is a toggle and a press inside the window also fires. Springing
   with no tuck loaded is capped at 45% pop, which is true of a real jumper
   and is also why mashing the button near the lip does not pay.
   ========================================================================== */

(function () {
  'use strict';

  var COLS = 72;
  var ROWS = 24;

  /* --- in-run. Tuned by simulation, not derived: the constants below put a
     tucked in-run at about 97 km/h over four and a half seconds, and an
     upright one at 75, which is the gap that makes the tuck worth holding. */
  var RAMP_LEN = 88;          // metres of in-run
  var ACC = 9.0;              // gravity along the ramp, m/s^2
  var DRAG_TUCK = 0.0105;     // quadratic drag coefficients
  var DRAG_UP = 0.020;
  var V_START = 6;

  /* --- the window, in seconds either side of the lip. */
  var ARM = 1.10;             // how early a press can count at all
  var EARLY_W = 0.55;
  var LATE_W = 0.26;
  var LATE_GRACE = 0.28;      // how long after the edge a press still counts
  var BASE_POP = 0.05;        // what you get for never pressing at all

  /* --- flight. */
  var GRAV = 9.81;
  var POP = 5.0;              // metres/second of lift from a perfect takeoff
  var LIP_DROP = 1.4;         // the lip points downhill, so you leave falling
  var IDEAL = 0.30;           // the lean the judges and the air both want
  var LIFT_MAX = 2.35;
  var VREF = 26;
  var DRAG_AIR = 0.0028;

  /* Lean is an INVERTED pendulum: leaning further makes you lean further
     still. Without that term the flight is a wind-buffeted stick that
     returns to centre by itself, and holding a line costs nothing. */
  var INSTAB = 1.5;
  var DAMP = 1.6;
  var TORQUE = 5.0;
  var LOST = 1.3;             // past this you are not landing this jump

  /* --- the hill. */
  var K_POINT = 90;
  var HILL_SIZE = 105;
  var PER_METRE = 2.0;
  var OUTRUN = 118;           // beyond here the hill is flat: nothing to land on
  var JUMPS = 3;

  /* --- the view. Two metres to a column, three to a row, which draws the
     landing hill at roughly the angle it has in life once the 8x16 cell
     aspect is taken into account. */
  var MX = 2;
  var MY = 3;
  var HILL_ROW = 17;          // the row the hill sits on directly under you
  var SKIER_COL = 17;
  var PANEL_ROW = 20;         // scenery stops here; the last three rows are HUD

  /* The in-run, drawn as a fixed diagonal. */
  var RAMP_X0 = 3, RAMP_Y0 = 4, RAMP_X1 = 46, RAMP_Y1 = 16, LIP_COL = 51;

  function hillY(x) {
    /* Left of the lip the profile climbs, so the flight view shows the ramp
       you came down instead of an unexplained flat shelf. */
    if (x <= 0) return -0.35 * x;
    if (x <= 10) return -0.32 * x;
    if (x <= 40) return -3.2 - 0.55 * (x - 10);
    if (x <= 100) return -19.7 - 0.62 * (x - 40);
    if (x <= OUTRUN) return -56.9 - 0.34 * (x - 100);
    return -63.02 - 0.04 * (x - OUTRUN);
  }

  function rampRow(c) {
    if (c <= RAMP_X1) {
      return RAMP_Y0 + Math.round((c - RAMP_X0) * (RAMP_Y1 - RAMP_Y0) / (RAMP_X1 - RAMP_X0));
    }
    return RAMP_Y1;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function half(v) { return Math.round(v * 2) / 2; }

  TermShell.define({
    id: 'game-asciijump',
    slug: 'asciijump',
    title: 'asciijump',
    cols: COLS,
    rows: ROWS,
    bestKey: 'asciijump',
    formatBest: function (n) { return Number(n).toFixed(1); },
    startTitle: 'asciijump',
    startText: 'Hold Space down the in-run to tuck, and let go at the lip. Three jumps, and the takeoff is the whole game.',

    setup: function (g) {
      var phase = 'ready';    // ready | inrun | flight | result
      var timer = 0;
      var jump = 0;           // 0-based index of the jump being taken
      var total = 0;
      var wind = 0;

      /* in-run state */
      var p = 0, v = V_START, tuckOn = false, tuckTime = 0;

      /* takeoff */
      var fired = false, offset = null, popUsed = BASE_POP, lipSpeed = 0;

      /* flight state */
      var x = 0, y = 0, vx = 0, vy = 0, air = 0, grace = 0;
      var lean = 0, leanV = 0, devSum = 0, ph1 = 0, ph2 = 0, lostIt = false;

      /* result of the jump just taken */
      var res = null;

      var shownSpeed = -1, shownDist = -1;

      function statSpeed(kmh) {
        var n = Math.round(kmh);
        if (n === shownSpeed) return;
        shownSpeed = n;
        g.stat('speed', n);
      }

      function statDist(m) {
        var n = Math.round(m * 2) / 2;
        if (n === shownDist) return;
        shownDist = n;
        g.stat('metres', n.toFixed(1));
      }

      /* --------------------------------------------------------------
         Phases
         -------------------------------------------------------------- */
      function beginRun() {
        jump = 0;
        total = 0;
        res = null;
        g.setScore(0);
        g.stat('score', '0.0');
        beginJump();
      }

      function beginJump() {
        phase = 'ready';
        timer = 1.4;
        p = 0;
        v = V_START;
        tuckOn = false;
        tuckTime = 0;
        fired = false;
        offset = null;
        popUsed = BASE_POP;
        lipSpeed = 0;
        lostIt = false;
        wind = Math.round((Math.random() * 3.2 - 1.6) * 10) / 10;
        shownSpeed = -1;
        shownDist = -1;
        statSpeed(0);
        statDist(0);
        g.stat('jump', (jump + 1) + '/' + JUMPS);
      }

      function launch() {
        phase = 'flight';
        lipSpeed = v;
        vx = v * (0.86 + 0.14 * popUsed);
        vy = popUsed * POP - LIP_DROP;
        x = 0;
        y = 0;
        air = 0;
        grace = 0;
        /* A slight forward lean off the lip, so the first correction is
           always yours rather than a recovery from a coin flip. */
        lean = 0.05;
        leanV = 0;
        devSum = 0;
        ph1 = Math.random() * 6.283;
        ph2 = Math.random() * 6.283;
        if (fired) g.beep(280 + popUsed * 620, 0.09, 'square', 0.05);
      }

      /* How much spring is left in the legs. A press with no tuck behind it
         is a stand-up, not a jump. */
      function spring() {
        return 0.45 + 0.55 * Math.min(1, tuckTime / 0.7);
      }

      function inWindow() {
        if (fired) return false;
        if (phase === 'inrun') return (RAMP_LEN - p) / Math.max(v, 1) <= ARM;
        if (phase === 'flight') return grace <= LATE_GRACE;
        return false;
      }

      function fire() {
        var off = phase === 'inrun' ? -(RAMP_LEN - p) / Math.max(v, 1) : grace;
        var w = off < 0 ? EARLY_W : LATE_W;
        var q = clamp(1 - Math.abs(off) / w, 0, 1);
        var pop = (0.12 + 0.88 * Math.pow(q, 0.85)) * spring();

        fired = true;
        offset = off;
        popUsed = pop;
        tuckOn = false;          // you have extended; there is no tuck left

        if (phase === 'flight') {
          /* A late takeoff is the same impulse, applied a moment after the
             edge instead of on it. */
          vy += (pop - BASE_POP) * POP;
          vx *= (0.86 + 0.14 * pop) / (0.86 + 0.14 * BASE_POP);
          g.beep(280 + pop * 620, 0.09, 'square', 0.05);
        }
      }

      function bandName() {
        if (offset === null) return 'no takeoff';
        var a = Math.abs(offset);
        var side = offset < 0 ? 'early' : 'late';
        if (a <= 0.05) return 'perfect';
        if (a <= 0.12) return 'a shade ' + side;
        if (a <= 0.24) return side;
        if (a <= 0.40) return 'well ' + side;
        return 'way ' + side;
      }

      function judge(base, fell) {
        var v2 = half(base + (Math.random() - 0.5) * 1.2);
        if (fell && v2 > 10) v2 = 10;
        return clamp(v2, 0, 20);
      }

      function land() {
        var d = Math.max(0, x);
        var devEnd = Math.abs(lean - IDEAL);
        var mean = air > 0.1 ? devSum / air : 1;

        /* Three ways to end up on your back: you lost the shape in the air,
           you arrived crooked, or you flew past the end of the hill and
           landed on ground that is no longer sloping away from you. */
        var fell = lostIt || devEnd > 0.55 || d > OUTRUN ||
                   (d > HILL_SIZE && devEnd > 0.22);
        var telemark = !fell && devEnd < 0.25 && mean < 0.28;

        var base = 20 - mean * 18 + (telemark ? 1.2 : 0) - (devEnd > 0.35 ? 2 : 0);
        var m1 = judge(base, fell), m2 = judge(base, fell), m3 = judge(base, fell);
        var style = m1 + m2 + m3;
        var dist = 60 + PER_METRE * (d - K_POINT);
        var points = Math.max(0, half(dist + style));

        total = half(total + points);
        g.setScore(total);
        g.stat('score', total.toFixed(1));
        statDist(d);

        res = {
          d: d, style: style, marks: [m1, m2, m3], dist: dist,
          points: points, fell: fell, telemark: telemark,
          lost: lostIt, band: bandName(), off: offset,
          speed: lipSpeed * 3.6
        };

        if (fell) g.sweep(300, 80, 0.4);
        else g.beep(telemark ? 760 : 560, 0.10, 'sine', 0.05);

        phase = 'result';
        timer = 3.0;
      }

      function nextJump() {
        jump += 1;
        if (jump >= JUMPS) {
          var msg = 'Three jumps, ' + total.toFixed(1) + ' points.';
          if (res) msg += ' The last one went ' + res.d.toFixed(1) + ' m.';
          g.over({
            won: total >= 320,
            score: total,
            title: total >= 320 ? 'On the podium' : 'Competition over',
            message: msg
          });
          return;
        }
        beginJump();
      }

      /* --------------------------------------------------------------
         Simulation
         -------------------------------------------------------------- */
      function stepInrun(dt) {
        if (tuckOn) tuckTime += dt;
        var k = tuckOn ? DRAG_TUCK : DRAG_UP;
        v += (ACC - k * v * v) * dt;
        p += v * dt;
        statSpeed(v * 3.6);
        if (p >= RAMP_LEN) { p = RAMP_LEN; launch(); }
      }

      function stepFlight(dt) {
        air += dt;
        if (!fired) grace += dt;

        /* Gusts grow with time in the air, so a long jump is harder to hold
           than a short one and the reward curve does not run away. */
        var amp = 1.0 + 0.60 * air;
        var gust = amp * Math.sin(air * 2.3 + ph1) + amp * 0.55 * Math.sin(air * 3.9 + ph2);
        var input = 0;
        if (g.held.left) input -= 1;
        if (g.held.right) input += 1;

        leanV += (gust + INSTAB * lean + input * TORQUE - DAMP * leanV) * dt;
        lean = clamp(lean + leanV * dt, -1.6, 1.6);

        var dev = Math.abs(lean - IDEAL);
        devSum += dev * dt;

        /* Headwind is airspeed, and airspeed is lift. It is deliberately
           worth only a few metres — enough to notice, not enough to decide
           a jump the takeoff already decided. */
        var airspeed = vx + wind;
        var q = clamp(1 - dev / 0.75, 0, 1);
        var lift = q * LIFT_MAX * (airspeed / VREF) * (airspeed / VREF);

        vx -= (DRAG_AIR + 0.0025 * dev) * vx * vx * dt;
        vy += (lift - GRAV) * dt;
        x += vx * dt;
        y += vy * dt;
        statDist(x);

        if (Math.abs(lean) >= LOST) { lostIt = true; land(); return; }
        if (y <= hillY(x)) land();
      }

      /* --------------------------------------------------------------
         Drawing
         -------------------------------------------------------------- */
      function header(term) {
        var line = 'asciijump   K' + K_POINT + '  HS' + HILL_SIZE + '   jump ' +
                   (jump + 1) + '/' + JUMPS + '   wind ';
        line += Math.abs(wind) < 0.15 ? 'calm'
              : Math.abs(wind).toFixed(1) + ' m/s ' + (wind > 0 ? 'head' : 'tail');
        term.text(1, 0, line, 'dim');
        term.text(1, 0, 'asciijump', 'green');
        if (phase === 'flight') {
          var d = x.toFixed(1) + ' m';
          term.text(COLS - 2 - d.length, 0, d, 'white');
        }
      }

      function drawInrun(term) {
        var c, r;
        for (c = RAMP_X0; c <= LIP_COL; c++) {
          r = rampRow(c);
          var onTable = c > RAMP_X1;
          term.put(c, r, onTable ? '_' : '\\', onTable ? 'yellow' : 'grey');
          /* Struts, so the in-run reads as a tower rather than a stray line. */
          if ((c - RAMP_X0) % 7 === 0) {
            for (var s = r + 1; s <= PANEL_ROW; s++) term.put(c, s, '|', 'dark');
          }
        }
        term.put(LIP_COL, RAMP_Y1 - 1, '|', 'red');
        term.put(LIP_COL, RAMP_Y1, '_', 'red');

        /* A stub of the landing hill, so the lip has somewhere to point. */
        for (c = LIP_COL + 1; c < COLS; c++) {
          r = RAMP_Y1 + 1 + Math.round((c - LIP_COL - 1) * 0.32);
          if (r <= PANEL_ROW) term.put(c, r, '\\', 'dim');
        }

        var col = Math.round(RAMP_X0 + (p / RAMP_LEN) * (LIP_COL - RAMP_X0));
        var row = rampRow(col);
        if (tuckOn) {
          term.put(col, row - 1, 'o', 'white');
          term.put(col + 1, row - 1, '_', 'white');
        } else {
          term.put(col, row - 2, 'o', 'white');
          term.put(col, row - 1, '|', 'white');
        }

        term.centre(22, tuckOn ? '[ T U C K ]' : '[ upright ]', tuckOn ? 'cyan' : 'dark');
        term.centre(23, 'hold to tuck   let go at the red lip', 'dim');
      }

      function drawFlight(term) {
        var camX = Math.max(-24, x - SKIER_COL * MX);
        var camY = hillY(x);
        var prev = -1;
        var c, r;

        for (c = 0; c < COLS; c++) {
          var wx = camX + c * MX;
          r = HILL_ROW - Math.round((hillY(wx) - camY) / MY);
          if (prev >= 0 && Math.abs(r - prev) > 1) {
            /* Fill the vertical run so a steep section is a slope and not a
               dotted line of orphaned cells. */
            var lo = Math.min(r, prev) + 1, hi = Math.max(r, prev) - 1;
            for (var f = lo; f <= hi; f++) {
              if (f <= PANEL_ROW) term.put(c, f, '\\', 'dim');
            }
          }
          prev = r;
          if (r > PANEL_ROW) continue;    // the hill has dropped out of view

          term.put(c, r, wx <= 0 ? '\\' : '_', wx <= 0 ? 'grey' : 'dim');

          /* Everything below the surface line is hill, and on a character
             grid empty space reads as sky. A half-density hatch is enough to
             say "ground" without turning the screen into a wall. */
          for (var b = r + 1; b <= PANEL_ROW; b++) {
            if ((c + b) % 2 === 0) term.put(c, b, '.', 'dark');
          }

          /* Ten-metre ticks, with the K-point and the hill size called out.
             The numbers go ABOVE the line because below it is now hatched. */
          var near = Math.round(wx / 10) * 10;
          if (Math.abs(wx - near) < MX / 2 && near > 0 && near < OUTRUN) {
            term.put(c, r, ':', 'grey');
            if (near % 30 === 0) term.text(c, r - 1, String(near), 'dark');
          }
          if (Math.abs(wx - K_POINT) < MX / 2) {
            term.put(c, r, 'K', 'yellow');
            term.put(c, r - 1, '|', 'yellow');
          }
          if (Math.abs(wx - HILL_SIZE) < MX / 2) {
            term.put(c, r, 'H', 'red');
            term.put(c, r - 1, '|', 'red');
          }
        }

        var sc = Math.round((x - camX) / MX);
        var sr = HILL_ROW - Math.round((y - camY) / MY);
        var dev = Math.abs(lean - IDEAL);
        var tone = lostIt ? 'red' : (dev < 0.25 ? 'white' : (dev < 0.6 ? 'cyan' : 'orange'));
        term.put(sc - 1, sr, '=', tone);
        term.put(sc, sr, '=', tone);
        term.put(sc + 1, sr, '=', tone);
        /* The head's offset from the skis IS the lean — the sprite is the
           instrument, and the meter below only confirms it. */
        var off = clamp(Math.round(lean * 2.2), -2, 2);
        term.put(sc + off, sr - 1, lostIt ? 'x' : 'o', tone);

        drawMeter(term);
      }

      function drawMeter(term) {
        var n = 21;
        var x0 = Math.floor((COLS - (n + 7)) / 2);
        var row = PANEL_ROW + 2;
        /* The bottom strip is cleared rather than drawn over: the hill runs
           through these rows and a meter with slope showing through it is
           unreadable at exactly the moment you need to read it. */
        term.rect(0, PANEL_ROW + 1, COLS, 3, ' ', 'dim');
        term.text(x0, row, 'LEAN', 'dim');
        term.put(x0 + 5, row, '[', 'dim');
        term.put(x0 + 6 + n, row, ']', 'dim');
        for (var i = 0; i < n; i++) term.put(x0 + 6 + i, row, '-', 'dark');
        var ideal = clamp(Math.round((IDEAL + 1.3) / 2.6 * (n - 1)), 0, n - 1);
        term.put(x0 + 6 + ideal, row, '|', 'green');
        var me = clamp(Math.round((lean + 1.3) / 2.6 * (n - 1)), 0, n - 1);
        var dev = Math.abs(lean - IDEAL);
        term.put(x0 + 6 + me, row, '#', dev < 0.25 ? 'green' : (dev < 0.6 ? 'yellow' : 'red'));
        term.centre(row + 1, '← nose up      nose down →', 'dim');
      }

      function drawReady(term) {
        var w = 34, h = 5;
        var bx = Math.floor((COLS - w) / 2), by = 8;
        term.rect(bx, by, w, h, ' ', 'green');
        term.box(bx, by, w, h, 'green');
        term.centre(by + 1, 'JUMP ' + (jump + 1) + ' OF ' + JUMPS, 'white');
        term.centre(by + 3, 'hold to tuck, let go at the lip', 'dim');
      }

      function drawResult(term) {
        var w = 46, h = 13;
        var bx = Math.floor((COLS - w) / 2), by = 5;
        term.rect(bx, by, w, h, ' ', 'green');
        term.box(bx, by, w, h, res.fell ? 'red' : 'green');
        var tx = bx + 3;

        term.text(tx, by + 1, 'JUMP ' + (jump + 1), 'white');
        if (res.lost) term.text(tx + 14, by + 1, 'LOST IT IN THE AIR', 'red');
        else if (res.fell) term.text(tx + 14, by + 1, 'FALL', 'red');
        else if (res.telemark) term.text(tx + 14, by + 1, 'TELEMARK', 'cyan');

        var when = res.off === null ? '' :
          '(' + Math.abs(res.off).toFixed(2) + ' s ' + (res.off < 0 ? 'early' : 'late') + ')';
        term.text(tx, by + 3, 'takeoff   ' + res.band, res.band === 'perfect' ? 'yellow' : 'white');
        term.text(tx + 10, by + 4, when, 'dim');
        term.text(tx, by + 5, 'in-run    ' + res.speed.toFixed(0) + ' km/h', 'white');
        term.text(tx, by + 6, 'distance  ' + res.d.toFixed(1) + ' m', 'white');
        term.text(tx, by + 7, 'style     ' + res.marks[0].toFixed(1) + '  ' +
          res.marks[1].toFixed(1) + '  ' + res.marks[2].toFixed(1) +
          '   = ' + res.style.toFixed(1), 'white');
        term.text(tx, by + 9, 'points    ' + res.dist.toFixed(1) + ' + ' +
          res.style.toFixed(1) + '  =  ' + res.points.toFixed(1), 'cyan');
        term.text(tx, by + 10, 'total     ' + total.toFixed(1), 'green');
      }

      return {
        reset: beginRun,

        key: function (name) {
          if (name !== 'action') return;
          if (inWindow()) fire();
          /* The tuck can be taken during the countdown as well as on the
             ramp, because holding the button before the gate opens is what
             everybody does and losing that press felt like a dropped input.
             It is a toggle rather than a hold so that a tap works: the
             shell's tap-the-playfield gesture sends a press with no
             matching release, and a hold-only tuck would latch on forever. */
          else if (phase === 'inrun' || phase === 'ready') tuckOn = !tuckOn;
        },

        release: function (name) {
          if (name !== 'action') return;
          if (inWindow()) fire();
          tuckOn = false;
        },

        update: function (dt) {
          if (phase === 'ready') {
            timer -= dt;
            if (timer <= 0) { phase = 'inrun'; }
          } else if (phase === 'inrun') {
            stepInrun(dt);
          } else if (phase === 'flight') {
            stepFlight(dt);
            /* A jump that has somehow not touched down in fifteen seconds is
               a bug, not a record. End it rather than loop forever. */
            if (phase === 'flight' && air > 15) land();
          } else if (phase === 'result') {
            timer -= dt;
            if (timer <= 0) nextJump();
          }
        },

        draw: function (term) {
          term.clear();
          header(term);
          /* The result panel sits over the LANDING, not over the next
             in-run: freezing the frame you just earned is the whole reason
             the panel pauses for three seconds. */
          if (phase === 'flight' || (phase === 'result' && res)) drawFlight(term);
          else drawInrun(term);
          if (phase === 'ready') drawReady(term);
          if (phase === 'result' && res) drawResult(term);
        }
      };
    }
  });
})();

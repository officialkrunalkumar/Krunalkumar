/* ==========================================================================
   sunflower.js — one number decides the whole picture.
   --------------------------------------------------------------------------
   Seed n is placed at angle n × TURN and radius c × √n. That is the entire
   model; there is no growth simulation, no packing solver and no collision
   test. Everything the toy shows falls out of the one angle in the slider.

   WHY √n AND NOT n. Equal-area rings. A disc of radius r has area πr², so
   fitting n seeds at a constant density needs r ∝ √n — and that single choice
   is what makes the pattern uniform from the middle to the rim instead of
   crowded in the centre and sparse outside. It also means the seed count
   changes the DENSITY and never the size of the figure, because c is derived
   from the target count so the last seed always lands on the rim.

   WHY THE ANGLE IS THE ONLY CONTROL THAT MATTERS. If the turn is a rational
   multiple of a full circle — say 137.5° ≈ 275/720 — then seed 720 lands
   exactly on top of seed 0 and the figure collapses into 720/gcd spokes with
   bare space between them. Every rational does this; the only question is how
   soon. So the good angles are the ones a fraction approximates badly, and
   the worst-approximated number there is is the golden ratio, whose continued
   fraction is all ones and therefore converges slower than any other. 360/φ²
   = 137.50776…° is that angle, and it is the one sunflowers, pinecones and
   pineapples actually use. Two tenths of a degree either side is enough to
   see it break.

   THE ARM COUNT IS COMPUTED, NOT LOOKED UP. The spiral arms the eye picks out
   are the denominators of the continued-fraction convergents of turn/360 —
   for the golden angle those denominators are the Fibonacci numbers, which is
   why sunflower arm counts are 34 and 55 and not 30 and 50. The HUD runs the
   expansion for whatever angle is set and reports the pair straddling √n,
   which is the pair visible at the rim. Type in a different angle and the
   readout follows it, because it is derived from the same number the picture
   is.

   THE FIGURE IS NOT REDRAWN TO TURN IT. It lives in an off-screen buffer that
   is rebuilt only when something about the arrangement changes; the slow
   rotation is one transform on the blit. Growing costs only the new seeds.
   Drifting is the one case that rebuilds every frame — the angle IS changing
   every frame then, so there is nothing to reuse — and 3,200 arcs is a
   comfortable frame at 60fps, which is why that is the ceiling.
   ========================================================================== */

/* global GameShell */
(function () {
  'use strict';

  var W = 640;
  var H = 460;
  var CX = W / 2;
  var CY = H / 2;
  var RIM = 206;                 // the figure's outer radius, in logical units

  /* 360/φ² to the precision a double can hold. Written out rather than
     computed so the number is greppable and so the slider's integer
     millidegrees have something exact to snap to. */
  var GOLDEN = 137.50776405003785;

  var MIN_TURN = 136000;         // millidegrees — the slider's own units
  var MAX_TURN = 139000;
  var MAX_SEEDS = 3200;

  /* Colour is a function of how far out the seed is, not of its index, so a
     change in seed count re-densifies the figure without repainting it in a
     different order. t is 0 at the middle and 1 at the rim. */
  var PALETTES = {
    spectrum: function (t) { return 'hsl(' + (196 + 286 * t) + ',74%,' + (52 + 8 * Math.sin(t * 9)) + '%)'; },
    ember:    function (t) { return 'hsl(' + (4 + 52 * t) + ',88%,' + (42 + 22 * t) + '%)'; },
    ice:      function (t) { return 'hsl(' + (208 - 46 * t) + ',72%,' + (40 + 32 * t) + '%)'; },
    mono:     function (t) { return 'hsl(186,14%,' + (34 + 50 * t) + '%)'; }
  };

  /* The denominators of the continued-fraction convergents of x, which for a
     phyllotaxis turn are exactly the spiral-arm counts that can be seen. The
     loop is the standard expansion; the only additions are a ceiling, so an
     angle that is very nearly rational cannot spin out thousands of useless
     terms, and a guard on the remainder, so an exactly rational one stops
     rather than dividing by zero. */
  function armCounts(x) {
    var out = [];
    var h0 = 1, h1 = 0, k0 = 0, k1 = 1;
    var v = x;
    for (var i = 0; i < 24; i++) {
      var a = Math.floor(v);
      var k2 = a * k0 + k1;
      var h2 = a * h0 + h1;
      if (k2 > MAX_SEEDS) break;
      if (k2 > 0) out.push(k2);
      h1 = h0; h0 = h2;
      k1 = k0; k0 = k2;
      var frac = v - a;
      if (frac < 1e-12) break;
      v = 1 / frac;
    }
    return out;
  }

  /* The pair straddling √n. Why √n: with radius ∝ √n the seeds sit roughly
     one unit apart everywhere, so the arms the eye follows at the rim are the
     ones whose count is near the number of seeds along a radius — and that is
     √n. A real sunflower head of about 2,000 seeds shows 34 and 55, which is
     what this returns for it. */
  function armLabel(turnDeg, seeds) {
    var qs = armCounts(turnDeg / 360);
    if (!qs.length) return '—';
    var pivot = Math.sqrt(Math.max(1, seeds));
    var below = null, above = null;
    for (var i = 0; i < qs.length; i++) {
      if (qs[i] <= pivot) below = qs[i];
      else { above = qs[i]; break; }
    }
    if (below && above) return below + ' & ' + above;
    return String(above || below);
  }

  GameShell.define({
    id: 'game-sunflower',
    slug: 'sunflower',
    title: 'Sunflower',
    width: W,
    height: H,

    /* Stated here as well as in the manifest because these are the four the
       SHELL reads at runtime, and build.js fails the deploy when the two
       disagree. There is no score in a spiral, so the Best slot is off; and a
       tap must do nothing, because the whole surface is a drag handle for the
       turn angle and a tap is the start of a drag. */
    bestKey: null,
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',

    autoStart: true,
    pauseOnBlur: false,

    setup: function (g) {
      /* Asked once. Someone who has told their operating system they do not
         want movement has told every page on it, and re-reading this per
         frame would only let it change under a toy already running. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var turn = GOLDEN;            // degrees between one seed and the next
      var target = 1800;            // seeds the figure is growing towards
      var grown = 0;                // seeds actually laid into the buffer
      var dot = 2.6;               // base seed radius, logical units
      var pal = PALETTES.spectrum;
      var palName = 'spectrum';

      var spin = 0;                 // where the whole figure has turned to
      var spinRate = 0.075;         // radians a second
      var drift = false;            // the angle walking on its own
      var driftDir = 1;
      var dirty = true;             // the arrangement changed: rebuild
      var driftForced = false;      // reduced motion has answered once

      var turnIn = document.getElementById('game-turn');
      var seedsIn = document.getElementById('game-seeds');
      var dotIn = document.getElementById('game-dot');
      var palSel = document.getElementById('game-palette');
      var driftBtn = document.getElementById('game-drift');
      var goldBtn = document.getElementById('game-golden');
      var saveBtn = document.getElementById('game-save');

      /* ---------------------------------------------------------------
         The buffer. Created once at device scale, never resized. The shell
         clears the visible canvas before every draw, so a figure that only
         existed there would live for one frame.
         --------------------------------------------------------------- */
      var buf = document.createElement('canvas');
      buf.width = W;
      buf.height = H;
      var bctx = buf.getContext('2d');

      function seedRadius(n) {
        // c is derived from the TARGET, so the outermost seed always lands on
        // the rim and the seed count changes density rather than size.
        return (RIM / Math.sqrt(Math.max(1, target))) * Math.sqrt(n);
      }

      /* Lay seeds [from, to) into the buffer. Growing calls this with the few
         that are new; a rebuild calls it once with all of them. */
      function lay(from, to) {
        if (!bctx) return;
        var step = turn * Math.PI / 180;
        for (var n = from; n < to; n++) {
          var r = seedRadius(n);
          var t = r / RIM;
          var a = n * step;
          var x = CX + r * Math.cos(a);
          var y = CY + r * Math.sin(a);
          bctx.beginPath();
          // Outer seeds are bigger, as they are in a real head: the young ones
          // are in the middle. It also keeps the centre from clogging.
          bctx.arc(x, y, dot * (0.42 + 0.78 * t), 0, 6.283185307179586);
          bctx.fillStyle = pal(t);
          bctx.fill();
        }
      }

      /* How many seeds are actually IN the buffer. Kept apart from `grown`
         because they answer different questions: grown is how far the growth
         has got, laid is how much of that has been painted. Growth advances
         one and the next frame catches the other up with the handful that are
         new; a rebuild sets laid back to zero and the same line repaints the
         lot. One code path, two costs. */
      var laid = 0;

      function sayTurn() {
        g.stat('turn', turn.toFixed(3) + '°');
        g.stat('arms', armLabel(turn, grown || target));
      }

      function setTurn(next, fromControl) {
        var lo = MIN_TURN / 1000, hi = MAX_TURN / 1000;
        turn = next < lo ? lo : (next > hi ? hi : next);
        if (!fromControl && turnIn) turnIn.value = String(Math.round(turn * 1000));
        dirty = true;
        sayTurn();
      }

      function setDrift(on, quiet) {
        drift = !!on;
        if (driftBtn) {
          driftBtn.setAttribute('aria-pressed', drift ? 'true' : 'false');
          driftBtn.title = drift
            ? 'The turn is walking on its own — click to stop it'
            : 'Let the turn walk on its own';
        }
        if (!quiet) g.announce(drift ? 'The turn is drifting.' : 'The turn is held.');
      }

      /* ---------------------------------------------------------------
         Controls
         --------------------------------------------------------------- */

      if (turnIn) {
        turnIn.addEventListener('input', function () {
          setDrift(false, true);
          setTurn((Number(turnIn.value) || 137508) / 1000, true);
          if (g.gate('turn', 0.35)) g.announce('Turn ' + turn.toFixed(3) + ' degrees.');
        });
      }

      if (seedsIn) {
        seedsIn.addEventListener('input', function () {
          var next = Number(seedsIn.value) || 1800;
          if (next > MAX_SEEDS) next = MAX_SEEDS;
          // Fewer seeds is not a rebuild of a smaller figure, it is the same
          // figure with the outer ones removed — but c depends on the target,
          // so both directions move every seed and both have to rebuild.
          target = next;
          if (grown > target) grown = target;
          dirty = true;
          g.stat('seeds', String(grown));
          sayTurn();
        });
      }

      if (dotIn) {
        dotIn.addEventListener('input', function () {
          dot = (Number(dotIn.value) || 26) / 10;
          dirty = true;
        });
      }

      if (palSel) {
        palSel.addEventListener('change', function () {
          palName = palSel.value;
          pal = PALETTES[palName] || PALETTES.spectrum;
          dirty = true;
        });
      }

      if (driftBtn) {
        driftBtn.addEventListener('click', function () { setDrift(!drift); });
      }

      if (goldBtn) {
        goldBtn.addEventListener('click', function () {
          setDrift(false, true);
          setTurn(GOLDEN, false);
          g.announce('Back to the golden angle, 137.508 degrees.');
          g.pluck(587.33, 0.45, 0.03, 'sine');
        });
      }

      /* ---------------------------------------------------------------
         The pointer is a fine control for the turn, because the slider
         cannot be one: the whole interesting range is three degrees wide
         and the arms reorganise inside a tenth of it. A drag across the
         canvas covers a fifth of a degree, which is roughly forty times
         finer than the same distance on the slider.
         --------------------------------------------------------------- */
      var dragging = false;
      var dragX = 0;
      var dragTurn = 0;

      g.canvas.addEventListener('pointerdown', function (event) {
        if (g.state !== 'playing') return;
        dragging = true;
        setDrift(false, true);
        var p = g.pointAt(event);
        dragX = p.x;
        dragTurn = turn;
        if (g.canvas.setPointerCapture) {
          try { g.canvas.setPointerCapture(event.pointerId); } catch (err) { /* not fatal */ }
        }
      });

      g.canvas.addEventListener('pointermove', function (event) {
        if (!dragging || g.state !== 'playing') return;
        var p = g.pointAt(event);
        setTurn(dragTurn + (p.x - dragX) * 0.0004, false);
        if (g.gate('drag', 0.5)) g.announce('Turn ' + turn.toFixed(3) + ' degrees.');
      });

      function endDrag() { dragging = false; }
      g.canvas.addEventListener('pointerup', endDrag);
      g.canvas.addEventListener('pointercancel', endDrag);
      g.canvas.addEventListener('pointerleave', endDrag);

      /* ---------------------------------------------------------------
         Saving. The figure is redrawn at 2x into a throwaway canvas rather
         than scaled up from the buffer, because these are circles and
         circles rescale badly. Nothing is uploaded: the file is built in
         the tab and handed to the browser's own downloader.
         --------------------------------------------------------------- */
      function save() {
        var SS = 2;
        var out = document.createElement('canvas');
        out.width = W * SS;
        out.height = H * SS;
        var octx = out.getContext('2d');
        if (!octx || !bctx) {
          g.announce('This browser could not produce the image.');
          return;
        }
        octx.setTransform(SS, 0, 0, SS, 0, 0);
        octx.fillStyle = '#080c15';
        octx.fillRect(0, 0, W, H);
        octx.translate(CX, CY);
        octx.rotate(spin);
        octx.drawImage(buf, -CX, -CY, W, H);

        var name = 'sunflower-' + turn.toFixed(3).replace('.', '-') + 'deg.png';
        var deliver = function (href, revoke) {
          var a = document.createElement('a');
          a.href = href;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          if (revoke) window.setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
          g.announce('Saved the figure as ' + name + '.');
          g.pluck(659.25, 0.5, 0.03, 'sine');
        };

        if (out.toBlob) {
          out.toBlob(function (blob) {
            if (!blob) { g.announce('This browser could not produce the image.'); return; }
            deliver(URL.createObjectURL(blob), true);
          }, 'image/png');
          return;
        }
        try { deliver(out.toDataURL('image/png'), false); }
        catch (err) { g.announce('This browser could not produce the image.'); }
      }

      if (saveBtn) saveBtn.addEventListener('click', save);

      return {
        reset: function () {
          grown = 0;
          spin = 0;
          dirty = true;

          if (turnIn) turn = (Number(turnIn.value) || 137508) / 1000;
          if (seedsIn) target = Math.min(MAX_SEEDS, Number(seedsIn.value) || 1800);
          if (dotIn) dot = (Number(dotIn.value) || 26) / 10;
          if (palSel) {
            palName = palSel.value;
            pal = PALETTES[palName] || PALETTES.spectrum;
          }

          /* Reduced motion is answered by MOVING THE CONTROL, not by quietly
             refusing to drift. A button showing "on" over a figure that never
             moves is indistinguishable from a bug. Once only: overriding a
             choice made after boot would be the same disrespect backwards. */
          if (reduced && !driftForced) {
            driftForced = true;
            spinRate = 0;
            setDrift(false, true);
            if (driftBtn) driftBtn.title = 'Drift starts off because your system asks for reduced motion';
          } else {
            setDrift(drift, true);
          }

          g.stat('seeds', '0');
          sayTurn();
        },

        key: function (name) {
          /* Arrows only — the shell binds no letters and neither does this.
             The step is a thousandth of a degree because that is the finest
             the slider can express, and at the golden angle it is already
             enough to see the outermost ring shear. */
          if (name === 'left') setTurn(turn - 0.001, false);
          else if (name === 'right') setTurn(turn + 0.001, false);
          else if (name === 'up' || name === 'down') {
            var next = target + (name === 'up' ? 200 : -200);
            target = Math.max(300, Math.min(MAX_SEEDS, next));
            if (grown > target) grown = target;
            if (seedsIn) seedsIn.value = String(target);
            dirty = true;
            g.stat('seeds', String(grown));
            if (g.gate('seeds', 0.6)) g.announce(target + ' seeds.');
            return;
          } else if (name === 'action') {
            setDrift(!drift);
            return;
          } else return;

          if (g.gate('turn', 0.6)) g.announce('Turn ' + turn.toFixed(3) + ' degrees.');
        },

        update: function (dt) {
          spin += spinRate * dt;
          if (spin > 6.283185307179586) spin -= 6.283185307179586;

          if (drift) {
            /* Slow enough to watch one family of arms hand over to the next.
               A hundredth of a degree a second crosses the interesting window
               in about twenty seconds, and bounces rather than wrapping so
               the reorganisation is seen in both directions. */
            var next = turn + driftDir * 0.012 * dt;
            if (next > 138.4) { next = 138.4; driftDir = -1; }
            else if (next < 136.6) { next = 136.6; driftDir = 1; }
            setTurn(next, false);
          }

          if (grown < target) {
            // About a second and a half from nothing to a full head, whatever
            // the count is, so the growth reads the same at 300 and at 3,200.
            grown = Math.min(target, grown + Math.ceil(target * dt / 1.5));
            if (g.gate('grow', 0.25)) g.stat('seeds', String(grown));
            if (grown === target) {
              g.stat('seeds', String(grown));
              sayTurn();
            }
          }
        },

        draw: function (ctx, w, h) {
          if (!bctx) {
            ctx.fillStyle = '#020617';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '15px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('This one needs a second 2D canvas, and this browser', w / 2, h / 2 - 10);
            ctx.fillText('will not give one. Nothing else on the page is affected.', w / 2, h / 2 + 12);
            return;
          }

          /* Three costs, and the common frame is the cheapest of them. A
             rebuild empties the buffer and repaints every seed, and only
             happens when the arrangement itself changed. Growth paints the
             handful that are new. A frame where neither is true — which is
             most of them — is one blit. */
          if (dirty) {
            bctx.clearRect(0, 0, W, H);
            laid = 0;
            dirty = false;
          }
          if (laid < grown) {
            lay(laid, grown);
            laid = grown;
          }

          ctx.fillStyle = '#080c15';
          ctx.fillRect(0, 0, w, h);

          ctx.save();
          ctx.translate(CX, CY);
          ctx.rotate(spin);
          ctx.drawImage(buf, -CX, -CY, W, H);
          ctx.restore();
        }
      };
    }
  });
})();

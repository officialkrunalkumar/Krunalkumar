/* ==========================================================================
   celebrate.js — the engine behind /birthday and /festival.
   --------------------------------------------------------------------------
   One canvas, ten particle styles, a reveal, a share bar, and the bit that
   wipes the query string off the address bar once the page has rendered.
   Both pages call KSCelebrate.mount() with a config and do nothing else;
   everything below is shared so the two scenes cannot drift apart.

   THREE THINGS HERE ARE NOT OBVIOUS AND ARE LOAD-BEARING.

   1. PARTICLES SETTLE, THEY DO NOT LOOP.
      The reason is in celebrate.css's header: this page gets screenshotted.
      An endless confetti loop means every screenshot catches debris in
      mid-air, which reads as noise rather than celebration. So the burst is
      finite — it spawns for a moment, falls, and comes to rest on the floor
      of the canvas, where it stays as part of the composition. After about
      four seconds the scene is a still image that happens to have arrived by
      animation. That is the whole design.

   2. REDUCED MOTION GETS THE SAME PICTURE, NOT AN EMPTY ONE.
      The obvious implementation of prefers-reduced-motion is "draw nothing",
      which hands the people who asked for less motion a blank stage and a
      worse birthday. Instead the simulation is stepped forward silently to
      its resting state and drawn ONCE. Same settled confetti, zero frames of
      animation. simulateToRest() below is that, and it is why the CSS file
      warns that the two halves have to stay in agreement.

   3. THE QUERY STRING IS WIPED, BUT THE LINK IS NOT LOST.
      The brief was that ?name= disappears once the page loads, which is right
      — the machinery should not be visible to the person being wished. But it
      breaks the obvious sharing move: open the link, copy the address bar,
      forward it, and the next person gets a bare /birthday. So the share
      button rebuilds the full URL from the values celebrate-guard.js parked
      on window.KSWish, which is why the guard keeps them instead of throwing
      them away after the redirect check.

   NOTHING IN THIS FILE EVER TOUCHES innerHTML. Every string that came from
   the URL reaches the DOM through textContent. See the threat model in
   celebrate-guard.js for why that is a rule rather than a preference.
   ========================================================================== */

(function () {
  'use strict';

  var REDUCED = false;
  try {
    REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* treat as full motion */ }

  /* ------------------------------------------------------------------------
     THE PARTICLE STYLES
     ------------------------------------------------------------------------
     Each style is a spawner plus a physics flavour. They share one update
     loop; what differs is how a particle is born and which forces apply. The
     festival dataset names one of these per festival, so adding a style here
     makes it available to every festival at once.

     `settles` marks the styles that come to rest on the floor and stay in
     frame. The ones that do not (rising sparks, lanterns, bubbles) fade out
     instead and are given a longer spawn window, so the scene is never empty
     when the shutter falls.
     -------------------------------------------------------------------- */
  var STYLES = {
    confetti:  { settles: true,  gravity: 0.062, drag: 0.988, spawn: 900,  count: 130 },
    petals:    { settles: true,  gravity: 0.021, drag: 0.994, spawn: 2600, count: 70 },
    snow:      { settles: true,  gravity: 0.016, drag: 0.996, spawn: 4200, count: 110 },
    leaves:    { settles: true,  gravity: 0.030, drag: 0.991, spawn: 2600, count: 60 },
    colorpuffs:{ settles: false, gravity: 0.004, drag: 0.975, spawn: 1500, count: 55 },
    sparks:    { settles: false, gravity: -0.028, drag: 0.982, spawn: 4200, count: 90 },
    lanterns:  { settles: false, gravity: -0.014, drag: 0.992, spawn: 4200, count: 34 },
    bubbles:   { settles: false, gravity: -0.020, drag: 0.990, spawn: 4200, count: 55 },
    balloons:  { settles: false, gravity: -0.012, drag: 0.994, spawn: 4600, count: 26 },
    fireworks: { settles: false, gravity: 0.030, drag: 0.968, spawn: 3200, count: 0 },
    stars:     { settles: false, gravity: 0, drag: 1, spawn: 0, count: 90 }
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function Scene(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.style = STYLES[config.particles] ? config.particles : 'confetti';
    this.spec = STYLES[this.style];
    this.colors = config.colors;
    this.parts = [];
    this.t = 0;
    this.spawned = 0;
    this.running = false;
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.resize();
  }

  /* devicePixelRatio sizing, capped at 2. An uncapped DPR on a 3x phone means
     a canvas with nine times the pixels of the layout box, which is where a
     mid-range Android starts dropping frames for no visible gain. */
  Scene.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = this.canvas.clientWidth || window.innerWidth;
    var h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /* Explicit sizing, for the export canvas. resize() reads clientWidth, which
     is 0 on a canvas that was never inserted into the document — the saver
     builds one at 1080x1920 off-DOM, so it needs to state the size itself. */
  Scene.prototype.resizeTo = function (w, h) {
    this.dpr = 1;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  Scene.prototype.spawn = function (n, originX, originY) {
    var style = this.style;
    for (var i = 0; i < n; i++) {
      if (this.parts.length > 420) return;   // hard ceiling, whatever the caller asks
      var p = {
        c: pick(this.colors),
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.14, 0.14),
        life: 1,
        fade: 0,
        shape: 'rect',
        wob: rand(0, Math.PI * 2),
        wobAmp: 0,
        settled: false
      };

      if (style === 'confetti') {
        p.x = originX !== undefined ? originX : rand(0, this.w);
        p.y = originY !== undefined ? originY : rand(-this.h * 0.35, -10);
        p.vx = rand(-1.5, 1.5);
        p.vy = rand(0.6, 3.2);
        p.size = rand(5, 11);
        p.shape = Math.random() < 0.3 ? 'circle' : 'rect';
      } else if (style === 'petals' || style === 'leaves') {
        p.x = rand(0, this.w);
        p.y = rand(-this.h * 0.3, -10);
        p.vx = rand(-0.5, 0.5);
        p.vy = rand(0.3, 1.1);
        p.size = style === 'leaves' ? rand(7, 13) : rand(6, 11);
        p.shape = 'petal';
        p.wobAmp = rand(0.4, 1.3);
      } else if (style === 'snow') {
        p.x = rand(0, this.w);
        p.y = rand(-this.h * 0.4, -10);
        p.vx = rand(-0.25, 0.25);
        p.vy = rand(0.25, 0.85);
        p.size = rand(2, 5.5);
        p.shape = 'circle';
        p.wobAmp = rand(0.2, 0.7);
      } else if (style === 'sparks') {
        /* Embers off a lamp: they start low and drift up, which is why the
           spec's gravity is negative. */
        p.x = rand(0, this.w);
        p.y = this.h + rand(0, 60);
        p.vx = rand(-0.35, 0.35);
        p.vy = rand(-0.5, -1.6);
        p.size = rand(1.6, 4);
        p.shape = 'glow';
        p.fade = rand(0.0035, 0.008);
        p.wobAmp = rand(0.2, 0.8);
      } else if (style === 'lanterns') {
        p.x = rand(0, this.w);
        p.y = this.h + rand(10, 200);
        p.vx = rand(-0.16, 0.16);
        p.vy = rand(-0.32, -0.85);
        p.size = rand(9, 17);
        p.shape = 'lantern';
        p.fade = rand(0.0012, 0.0028);
        p.wobAmp = rand(0.15, 0.5);
      } else if (style === 'balloons') {
        /* Fewer, larger and slower than anything else here — a balloon that
           moves like confetti stops reading as a balloon. The sway is what
           does the work; vr stays near zero because balloons do not tumble. */
        p.x = rand(0, this.w);
        p.y = this.h + rand(30, 320);
        p.vx = rand(-0.1, 0.1);
        p.vy = rand(-0.30, -0.72);
        p.size = rand(16, 30);
        p.shape = 'balloon';
        p.vr = rand(-0.006, 0.006);
        p.rot = rand(-0.12, 0.12);
        p.fade = rand(0.0009, 0.0020);
        p.wobAmp = rand(0.18, 0.55);
      } else if (style === 'bubbles') {
        p.x = rand(0, this.w);
        p.y = this.h + rand(0, 80);
        p.vx = rand(-0.2, 0.2);
        p.vy = rand(-0.4, -1.2);
        p.size = rand(4, 13);
        p.shape = 'bubble';
        p.fade = rand(0.002, 0.005);
        p.wobAmp = rand(0.3, 1);
      } else if (style === 'colorpuffs') {
        /* Holi: soft clouds of pigment that bloom and thin out. */
        p.x = originX !== undefined ? originX : rand(0, this.w);
        p.y = originY !== undefined ? originY : rand(this.h * 0.2, this.h);
        p.vx = rand(-1.4, 1.4);
        p.vy = rand(-1.4, 0.6);
        p.size = rand(16, 46);
        p.shape = 'puff';
        p.fade = rand(0.004, 0.009);
      } else if (style === 'fireworks') {
        p.x = originX;
        p.y = originY;
        var a = rand(0, Math.PI * 2);
        var sp = rand(1.2, 5.2);
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.size = rand(1.8, 3.6);
        p.shape = 'glow';
        p.fade = rand(0.008, 0.017);
      } else if (style === 'stars') {
        p.x = rand(0, this.w);
        p.y = rand(0, this.h);
        p.vx = 0;
        p.vy = 0;
        p.size = rand(0.8, 2.4);
        p.shape = 'glow';
        p.twinkle = rand(0, Math.PI * 2);
        p.twinkleSpeed = rand(0.012, 0.045);
      }

      this.parts.push(p);
    }
  };

  Scene.prototype.step = function () {
    var spec = this.spec;
    var floor = this.h + 20;
    var i, p;

    for (i = this.parts.length - 1; i >= 0; i--) {
      p = this.parts[i];

      if (this.style === 'stars') {
        p.twinkle += p.twinkleSpeed;
        continue;
      }

      if (p.settled) continue;

      p.vy += spec.gravity;
      p.vx *= spec.drag;
      p.vy *= spec.drag;

      if (p.wobAmp) {
        p.wob += 0.045;
        p.x += Math.sin(p.wob) * p.wobAmp * 0.5;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      if (p.fade) {
        p.life -= p.fade;
        if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      }

      /* Settling. The floor is just below the viewport so the pile reads as
         "off the bottom edge" rather than as a line of debris across the
         screen — the composition wants a hint of confetti at the margin, not
         a bar chart. */
      if (spec.settles && p.y >= floor - p.size * 2) {
        p.y = floor - p.size * 2;
        p.settled = true;
        p.vx = 0;
        p.vy = 0;
      }

      /* Anything that leaves sideways or rises off the top is gone. */
      if (p.x < -80 || p.x > this.w + 80 || p.y < -this.h * 0.8) {
        this.parts.splice(i, 1);
      }
    }
  };

  Scene.prototype.draw = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      var alpha = p.life;

      if (p.shape === 'glow' && p.twinkle !== undefined) {
        alpha = 0.35 + Math.sin(p.twinkle) * 0.35;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.translate(p.x, p.y);
      if (p.rot) ctx.rotate(p.rot);
      ctx.fillStyle = p.c;

      if (p.shape === 'rect') {
        /* Scaling Y by the cosine of the rotation is what sells a flat piece
           of paper tumbling in three dimensions from a two-dimensional draw:
           it goes edge-on and disappears, then opens out again. */
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.6)) * 0.85 + 0.15);
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      } else if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'petal') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size / 2, p.size / 3.4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'glow') {
        ctx.shadowBlur = p.size * 3.5;
        ctx.shadowColor = p.c;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'puff') {
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        g.addColorStop(0, p.c);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.5));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'bubble') {
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.4));
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === 'balloon') {
        /* Body, knot, string. The highlight is the detail that stops it
           looking like a coloured circle — a balloon is glossy, and one
           off-centre pale ellipse is the whole of that read. */
        var br = p.size / 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, br * 0.86, br, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(-br * 0.16, br * 0.94);
        ctx.lineTo(br * 0.16, br * 0.94);
        ctx.lineTo(0, br * 1.2);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.45));
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, br * 1.2);
        ctx.quadraticCurveTo(br * 0.42, br * 1.9, 0, br * 2.6);
        ctx.stroke();

        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.5));
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(-br * 0.3, -br * 0.34, br * 0.19, br * 0.28, -0.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'lantern') {
        ctx.shadowBlur = p.size * 2.2;
        ctx.shadowColor = p.c;
        ctx.beginPath();
        /* A sky lantern is a rounded box, not a circle — the silhouette is
           what makes it readable at 12px. */
        var w = p.size * 0.78, h = p.size;
        ctx.moveTo(-w / 2, -h / 2 + 2);
        ctx.quadraticCurveTo(0, -h / 2 - 3, w / 2, -h / 2 + 2);
        ctx.lineTo(w / 2 * 0.82, h / 2);
        ctx.lineTo(-w / 2 * 0.82, h / 2);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  };

  /* The reduced-motion path. Runs the same physics the animated version would
     run, for the time it would have taken to come to rest, and paints the
     result once. See note 2 in the header. */
  Scene.prototype.simulateToRest = function () {
    var spec = this.spec;
    if (spec.count) this.spawn(spec.count);

    if (this.style === 'fireworks') {
      for (var b = 0; b < 4; b++) {
        this.spawn(45, rand(this.w * 0.2, this.w * 0.8), rand(this.h * 0.15, this.h * 0.45));
      }
    }

    /* 260 steps is a shade over four seconds at 60fps — long enough for the
       heaviest style (confetti) to have finished falling. */
    var budget = spec.settles ? 260 : 90;
    for (var i = 0; i < budget; i++) this.step();

    /* Fading styles would be nearly invisible after 90 steps, so their
       remaining life is restored before the single paint. The still frame
       should show what the moving version shows at its best moment, not its
       last one. */
    if (!spec.settles) {
      for (var j = 0; j < this.parts.length; j++) {
        this.parts[j].life = Math.max(this.parts[j].life, 0.55);
      }
    }

    this.draw();
  };

  Scene.prototype.start = function () {
    var self = this;
    var spec = this.spec;
    var last = 0;

    if (REDUCED) { this.simulateToRest(); return; }

    this.running = true;
    if (this.style === 'stars') this.spawn(spec.count);

    /* Elapsed time is ACCUMULATED FROM CLAMPED FRAME DELTAS, not measured as
       (now - start), and that is not a stylistic preference — it is the fix
       for the commonest way this page is actually opened.

       A link arrives in WhatsApp. The tap opens it in a tab that is not yet
       frontmost, or the person switches away while it loads. requestAnimation-
       Frame does not fire in a hidden tab, so no frames run. With an absolute
       clock, by the time they look at it the spawn window (a few seconds) has
       long since expired against a wall clock that never stopped — the loop
       resumes, decides it is far too late to spawn anything, and they get an
       empty stage and no celebration at all.

       Summing per-frame deltas means hidden time simply does not pass: the
       spawn window is four seconds of FRAMES, wherever in wall-clock time
       they happen to fall. The clamp caps any single delta at 50ms so a long
       gap contributes one frame's worth rather than its whole duration. */
    var elapsed = 0;
    var prevTs = null;
    function frame(ts) {
      if (!self.running) return;
      if (prevTs === null) prevTs = ts;
      elapsed += Math.min(ts - prevTs, 50);
      prevTs = ts;

      /* Spawning is time-boxed. Once the window closes the existing particles
         finish their arc and the scene comes to rest — nothing respawns, and
         that is deliberate (note 1). */
      if (spec.spawn && elapsed < spec.spawn && self.style !== 'stars') {
        if (self.style === 'fireworks') {
          if (ts - last > 620) {
            last = ts;
            self.spawn(46, rand(self.w * 0.15, self.w * 0.85), rand(self.h * 0.12, self.h * 0.48));
          }
        } else {
          var per = Math.max(1, Math.round(spec.count / (spec.spawn / 16)));
          self.spawn(per);
        }
      }

      self.step();
      self.draw();
      window.requestAnimationFrame(frame);
    }

    /* The opening burst. Confetti gets most of its population immediately so
       the page is celebrating the instant it opens rather than a second
       later; the drifting styles fill in over their spawn window. */
    if (this.style === 'confetti') this.spawn(Math.round(spec.count * 0.55));
    if (this.style === 'colorpuffs') this.spawn(14);

    window.requestAnimationFrame(frame);
  };

  Scene.prototype.stop = function () { this.running = false; };

  /* A tap anywhere is another burst, at the point touched. The one piece of
     interactivity on the page, and it exists because everybody tries it. */
  Scene.prototype.burst = function (x, y) {
    if (REDUCED) return;
    if (this.style === 'stars') { this.spawn(18); return; }
    if (this.style === 'fireworks' || this.style === 'colorpuffs') {
      this.spawn(46, x, y);
    } else {
      this.spawn(40, x, y);
    }
    if (!this.running) { this.running = true; }
  };

  /* ------------------------------------------------------------------------
     THE SHARE BAR
     -------------------------------------------------------------------- */

  function buildUrl(q) {
    var p = new URLSearchParams();
    p.set('name', q.name);
    if (q.theme) p.set('theme', q.theme);
    if (q.from) p.set('from', q.from);
    return window.location.origin + window.location.pathname + '?' + p.toString();
  }

  function wireShare(url, title) {
    var copyBtn = document.querySelector('[data-c-copy]');
    var shareBtn = document.querySelector('[data-c-share]');

    /* navigator.share is the right control on a phone — it opens the real
       share sheet, so the link goes straight into WhatsApp. It does not exist
       on most desktops, so the button is only shown where it works rather
       than shown everywhere and failing on click. */
    if (shareBtn) {
      if (navigator.share) {
        shareBtn.hidden = false;
        shareBtn.addEventListener('click', function () {
          navigator.share({ title: title, text: title, url: url }).catch(function () {
            /* The user dismissed the sheet. Not an error. */
          });
        });
      } else {
        shareBtn.hidden = true;
      }
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var label = copyBtn.querySelector('[data-c-copy-label]');
        function done(ok) {
          if (!label) return;
          label.textContent = ok ? 'Link copied' : 'Press Ctrl+C';
          copyBtn.classList.toggle('is-done', ok);
          window.setTimeout(function () {
            label.textContent = 'Copy link';
            copyBtn.classList.remove('is-done');
          }, 2200);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallbackCopy(url, done); });
        } else {
          fallbackCopy(url, done);
        }
      });
    }
  }

  /* execCommand('copy') is deprecated and still the only thing that works on
     a page served without a secure context or in an older in-app browser —
     which is exactly where a forwarded WhatsApp link gets opened. */
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) {
      done(false);
    }
  }

  /* ========================================================================
     SAVE AS IMAGE
     ------------------------------------------------------------------------
     Draws the card again, natively, at 1080x1920 and hands it over as a PNG.

     WHY NOT SCREENSHOT THE DOM. The usual answer is html2canvas, and it is
     not available: the CSP is script-src 'self' with no CDN and this repo has
     no bundler. The other trick — serialising the DOM into an <svg>
     <foreignObject> and drawing that — taints the canvas in Safari and
     Firefox, so toBlob throws exactly where it is most needed, on a phone.

     Redrawing costs a second implementation of the composition, and that is a
     real maintenance tax: change a size in celebrate.css and this file does
     not follow. It is worth it anyway, because the output is BETTER than the
     screenshot it replaces — 1080x1920 exactly, no status bar, no address
     bar, no browser chrome, and the same on every device. A screenshot is
     whatever the phone happened to be showing.

     WHAT IS NOT DUPLICATED: the motif and the particles. The motif is the
     page's own <svg>, serialised with its CSS variables resolved (see
     inlineSvg); the particles are the same Scene class the live page uses,
     run to rest on the export canvas. So the two things most likely to drift
     cannot.
     ==================================================================== */

  var EXPORT_W = 1080;
  var EXPORT_H = 1920;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  /* An SVG referencing var(--c-accent) renders black once it is detached from
     the document that defines those variables. getComputedStyle resolves them
     against the LIVE element, so every paint attribute is copied across as a
     literal before serialising. Gradient stops need stop-color and
     stop-opacity handled the same way. */
  function inlineSvg(live) {
    var clone = live.cloneNode(true);
    var liveNodes = live.querySelectorAll('*');
    var cloneNodes = clone.querySelectorAll('*');

    for (var i = 0; i < liveNodes.length; i++) {
      var cs = window.getComputedStyle(liveNodes[i]);
      var t = cloneNodes[i];
      if (cs.fill && cs.fill !== 'none') t.setAttribute('fill', cs.fill);
      if (cs.stroke && cs.stroke !== 'none') t.setAttribute('stroke', cs.stroke);
      if (cs.stopColor) t.setAttribute('stop-color', cs.stopColor);
      if (cs.opacity && cs.opacity !== '1') t.setAttribute('opacity', cs.opacity);
      /* The flames animate via CSS that will not exist in the exported file.
         Freezing them at their resting transform is correct — the export is a
         still, and a half-flickered flame is not the frame anyone wants. */
      t.style.animation = 'none';
    }

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }

  function loadSvg(markup) {
    return new Promise(function (resolve) {
      var img = new Image();
      /* A data: URL rather than a blob: URL — img-src in the CSP allows data:
         and this avoids having to revoke anything. encodeURIComponent rather
         than btoa, because btoa throws on any non-Latin-1 character and these
         SVGs carry typographic quotes. */
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    });
  }

  /* Greedy wrap. Canvas has no text layout, and a name or blurb that runs off
     both edges is the one failure that would make the export worse than the
     screenshot. */
  function wrap(ctx, text, maxWidth) {
    var words = String(text || '').split(' ');
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var attempt = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(attempt).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function exportCard(config) {
    var cv = document.createElement('canvas');
    cv.width = EXPORT_W;
    cv.height = EXPORT_H;
    var ctx = cv.getContext('2d');

    var css = window.getComputedStyle(document.body);
    var v = function (n) { return css.getPropertyValue('--c-' + n).trim(); };
    var ground = v('ground') || '#0b1020';
    var glow = v('glow') || '#2a1a4a';
    var primary = v('primary');
    var secondary = v('secondary');
    var accent = v('accent');

    /* --- ground, matching the two radials in celebrate.css --- */
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

    function radial(cx, cy, r, colour, alpha) {
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, colour);
      g.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
      ctx.restore();
    }
    radial(EXPORT_W / 2, EXPORT_H * 0.10, EXPORT_W * 0.95, glow, 1);
    radial(EXPORT_W / 2, EXPORT_H * 1.02, EXPORT_W * 0.8, glow, 0.9);

    /* --- particles, from the same engine the page runs --- */
    var pcv = document.createElement('canvas');
    var scene = new Scene(pcv, { particles: config.particles, colors: config.colors });
    scene.resizeTo(EXPORT_W, EXPORT_H);
    scene.simulateToRest();
    ctx.drawImage(pcv, 0, 0);

    return Promise.resolve()
      .then(function () {
        var live = document.querySelector('.c-motif');
        if (!live) return null;
        /* The festival motif is an emoji in a <span>, not an <svg>. */
        if (live.tagName.toLowerCase() !== 'svg') return 'glyph';
        return loadSvg(inlineSvg(live));
      })
      .then(function (motif) {
        ctx.textAlign = 'center';
        var maxW = EXPORT_W - 160;
        var isFestival = config.mode === 'festival';

        /* MEASURE, THEN DRAW. The first version started at a fixed y and let
           the block fall where it fell, which put every card's content in the
           top half and left roughly 650px of empty plum below it — fine on a
           short name, ugly on every other. Nothing here can be known ahead of
           time (the motif's aspect ratio, how many lines the greeting wraps
           to, whether there is a from line), so the whole block is measured
           first and then centred in the space above the mark. */
        var motifW = 420;
        var motifH = 0;
        if (motif === 'glyph') motifH = 300;
        else if (motif) motifH = motifW * (motif.height / motif.width || 1);

        ctx.font = '800 ' + (isFestival ? 108 : 82) + 'px ' + FONT;
        var greetLines = wrap(ctx, config.greeting, maxW);
        var greetLH = isFestival ? 118 : 92;

        ctx.font = '800 130px ' + FONT;
        var nameLines = config.name ? wrap(ctx, config.name, maxW) : [];

        ctx.font = '36px ' + FONT;
        var blurbLines = config.blurb ? wrap(ctx, config.blurb, maxW - 80) : [];

        var total =
          (motifH ? motifH + 130 : 60) +
          (config.label ? 66 : 0) +
          greetLines.length * greetLH +
          (nameLines.length ? 26 + nameLines.length * 140 : 0) +
          (blurbLines.length ? 46 + blurbLines.length * 52 : 0) +
          (config.from ? 74 : 0);

        /* The mark occupies the bottom ~300px, so the block is centred in what
           is left. Nudged up by 40 because a block sitting on the exact
           optical centre reads as slightly low once the mark is under it. */
        var y = Math.max(160, (EXPORT_H - 300 - total) / 2 - 40);

        if (motif === 'glyph') {
          ctx.font = '300px ' + FONT;
          ctx.textBaseline = 'middle';
          ctx.fillText(config.glyph || '🎉', EXPORT_W / 2, y + motifH / 2);
          y += motifH + 130;
        } else if (motif) {
          ctx.drawImage(motif, (EXPORT_W - motifW) / 2, y, motifW, motifH);
          y += motifH + 130;
        } else {
          y += 60;
        }

        ctx.textBaseline = 'alphabetic';

        /* greeting — gradient fill, the same two stops as .c-greet. The
           baseline sits a line-height below y, which is why every block below
           advances BEFORE drawing rather than after. */
        if (config.label) {
          y += 46;
          ctx.font = '600 34px ' + FONT;
          ctx.fillStyle = 'rgba(255,255,255,0.62)';
          /* Canvas has no letter-spacing, and the eyebrow is tracked in CSS.
             Spacing the characters by hand is the only way to match it. */
          var chars = config.label.toUpperCase().split('');
          var track = 6;
          var wTot = chars.reduce(function (a, c) { return a + ctx.measureText(c).width + track; }, -track);
          var cx = (EXPORT_W - wTot) / 2;
          ctx.textAlign = 'left';
          chars.forEach(function (c) {
            ctx.fillText(c, cx, y);
            cx += ctx.measureText(c).width + track;
          });
          ctx.textAlign = 'center';
          y += 20;
        }

        ctx.font = '800 ' + (isFestival ? 108 : 82) + 'px ' + FONT;
        var gg = ctx.createLinearGradient(180, 0, EXPORT_W - 180, 0);
        gg.addColorStop(0, primary || '#fbbf24');
        gg.addColorStop(1, secondary || '#fb7185');
        ctx.fillStyle = gg;
        greetLines.forEach(function (ln) {
          y += greetLH;
          ctx.fillText(ln, EXPORT_W / 2, y);
        });

        /* name — solid, never the gradient; see the note on .c-name */
        if (nameLines.length) {
          y += 26;
          ctx.font = '800 130px ' + FONT;
          ctx.fillStyle = accent || '#fde68a';
          nameLines.forEach(function (ln) {
            y += 140;
            ctx.fillText(ln, EXPORT_W / 2, y);
          });
        }

        if (blurbLines.length) {
          y += 46;
          ctx.font = '36px ' + FONT;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          blurbLines.forEach(function (ln) {
            y += 52;
            ctx.fillText(ln, EXPORT_W / 2, y);
          });
        }

        if (config.from) {
          y += 74;
          ctx.font = 'italic 34px ' + FONT;
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.fillText('— from ' + config.from, EXPORT_W / 2, y);
        }

        /* The mark is pinned to the foot rather than following the flow, so it
           lands in the same place whatever length the name ran to. */
        ctx.font = '700 44px ui-monospace, "Cascadia Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText('KS_', EXPORT_W / 2, EXPORT_H - 150);

        ctx.font = '28px ' + FONT;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText('krunalkumar.dpdns.org', EXPORT_W / 2, EXPORT_H - 100);

        return new Promise(function (resolve) {
          cv.toBlob(function (blob) { resolve(blob); }, 'image/png');
        });
      });
  }

  function wireSave(config) {
    var btn = document.querySelector('[data-c-save]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var label = btn.querySelector('[data-c-save-label]');
      if (label) label.textContent = 'Saving…';
      btn.disabled = true;

      exportCard(config).then(function (blob) {
        if (!blob) throw new Error('no blob');
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = (config.mode === 'birthday'
          ? 'happy-birthday-' + (config.name || 'wish')
          : 'wish-' + (config.greeting || 'festival')
        ).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        /* Revoked on a delay rather than immediately: Safari has not always
           finished reading the blob by the time click() returns, and revoking
           too early gives a silently empty download. */
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        if (label) label.textContent = 'Saved';
      }).catch(function () {
        if (label) label.textContent = 'Could not save';
      }).then(function () {
        btn.disabled = false;
        window.setTimeout(function () {
          if (label) label.textContent = 'Save image';
        }, 2400);
      });
    });
  }

  /* ------------------------------------------------------------------------
     MOUNT
     -------------------------------------------------------------------- */

  function mount(config) {
    var wish = window.KSWish;
    if (!wish) return;   // guard redirected, or this page was opened wrong

    var body = document.body;
    body.setAttribute('data-mode', config.mode);
    if (config.scene) body.setAttribute('data-scene', config.scene);

    /* Festival palettes arrive as data rather than as CSS, so they are set as
       custom properties here. Birthday scenes come from the [data-scene]
       blocks in celebrate.css and set nothing. */
    if (config.palette) {
      for (var k in config.palette) {
        if (Object.prototype.hasOwnProperty.call(config.palette, k)) {
          body.style.setProperty('--c-' + k, config.palette[k]);
        }
      }
    }

    /* --- the words. textContent, always. --- */
    function put(sel, text) {
      var el = document.querySelector(sel);
      if (!el) return null;
      if (text) {
        el.textContent = text;
        el.hidden = false;
      } else {
        el.hidden = true;
      }
      return el;
    }

    put('[data-c-label]', config.label);
    put('[data-c-greet]', config.greeting);
    put('[data-c-name]', config.name);
    put('[data-c-blurb]', config.blurb);
    /* "— from X" rather than "with love, X". The same link gets sent by a
       sibling and by a manager, and only one of those two phrasings survives
       both. The neutral one is the one that always works. */
    put('[data-c-from]', config.from ? '— from ' + config.from : '');

    /* The tab title and the OG-less link preview text. Assigning to
       document.title is not an HTML sink, so this is safe. */
    document.title = config.title;

    var announce = document.querySelector('[data-c-announce]');
    if (announce) {
      announce.textContent = (config.label ? config.label + '. ' : '') +
        config.greeting + (config.name ? ', ' + config.name : '') +
        (config.blurb ? '. ' + config.blurb : '');
    }

    /* --- the scene --- */
    var canvas = document.querySelector('.c-sky');
    var scene = null;
    if (canvas && canvas.getContext) {
      scene = new Scene(canvas, { particles: config.particles, colors: config.colors });
      scene.start();

      var resizeTimer = null;
      window.addEventListener('resize', function () {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () { scene.resize(); }, 180);
      });

      /* NO visibilitychange HANDLER HERE, deliberately, and there used to be
         one that called scene.stop() when the tab went hidden.

         It looked correct — a background tab should not run a physics loop —
         and it was a bug. Browsers already suspend requestAnimationFrame in a
         hidden tab, so it bought nothing; and because stop() sets running to
         false, the queued frame callback returned early forever after. A link
         opened in a background tab, which is exactly how a forwarded WhatsApp
         link behaves, came back to a permanently dead scene: no confetti, no
         animation, just the words. The saving was zero and the cost was the
         celebration.

         Leaving RAF to the browser is both simpler and correct. Paired with
         the delta-accumulated clock in start(), a page that spends its first
         minute hidden still runs its full opening burst when it is looked at. */

      document.addEventListener('pointerdown', function (ev) {
        /* Not on the buttons — a tap meant for "copy link" should copy, not
           throw confetti at the cursor. */
        if (ev.target && ev.target.closest && ev.target.closest('.c-bar')) return;
        scene.burst(ev.clientX, ev.clientY);
      });
    }

    /* --- the reveal --- */
    var rise = document.querySelectorAll('[data-c-rise]');
    for (var i = 0; i < rise.length; i++) rise[i].classList.add('c-rise');

    /* --- share, then wipe --- */
    var url = buildUrl(wish.query);
    wireShare(url, config.title);
    wireSave(config);

    /* THE WIPE. Last, and only after everything above has rendered, so a
       visitor never sees a half-built page with a clean URL. replaceState
       rather than pushState: the query string should not become a history
       entry the Back button can return to.

       Wrapped because replaceState throws on a file:// origin, which is how
       this gets opened when somebody saves the page — and a thrown error here
       would take the rest of the mount down with it. */
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (e) { /* address bar keeps the query; nothing else breaks */ }
  }

  window.KSCelebrate = { mount: mount, reduced: REDUCED };
})();

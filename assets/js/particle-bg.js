/* --------------------------------------------------------------------------
   Wrapped in an IIFE like every other file in assets/js/. Before this, the
   top-level declarations here (prefersReducedMotion, canvas, revealTargets,
   revealEnabled, backToTopButton, toggleWhatsappBubble, and the hoisted
   initSiteChrome, which was a real window property) shared the one global
   scope with every other script on the page. A grep of the whole repo found
   nothing outside this file reading any of them — verify.js has its own local
   prefersReducedMotion, not this one — so none are exported deliberately and
   the wrapper takes them all private.
   -------------------------------------------------------------------------- */
(function () {
  'use strict';

  // Sampled at boot AND kept live: the OS-level switch can flip mid-visit
  // (macOS System Settings, Windows animation toggle, a battery-saver mode),
  // and CSS media queries respond instantly while a one-shot .matches read
  // does not. Every handler below that reads this variable at event time —
  // the animation loop, adjustSpeed, the greeting/glance callbacks, the
  // back-to-top scroll — picks up the change for free; the canvas block adds
  // its own change listener further down to restart or stop the loop.
  // Boot-time-only decisions (whether the pause button, the speed row and the
  // glance/greeting timers were built at all) deliberately stay as sampled:
  // rebuilding injected chrome mid-visit is not worth the machinery, and the
  // CSS reduced-motion rules already hide the pause button live.
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let prefersReducedMotion = reducedMotionQuery.matches;
  // addEventListener on a MediaQueryList is missing in older Safari; the flag
  // simply stays at its boot value there, which is exactly the old behaviour.
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', (event) => {
      prefersReducedMotion = event.matches;
    });
  }

  /* --------------------------------------------------------------------------
     Site chrome first — this is a resilience ordering, not a stylistic one.

     The hamburger, the mobile menu, the More dropdown and the copyright year all
     live in initSiteChrome() at the bottom of this file, and its bootstrap used
     to sit at the very bottom too. That made the entire site navigation depend on
     ~830 lines of decorative canvas code executing without throwing first: one
     unsupported call on an old device and a visitor would be left with a header
     that has no working menu at all.

     Splitting the chrome into its own file was measured and rejected — the whole
     file compiles in 0.8 ms (the chrome part is 0.1 ms of that), so a separate
     request would cost more than it saved. Running the bootstrap here costs
     nothing and removes the dependency entirely: initSiteChrome is a hoisted
     function declaration, and the only outer binding it touches is
     prefersReducedMotion, declared immediately above.

     Every page ships a static header (.noscript-header) that include-partials.js
     swaps for the canonical partial — wiring the chrome against the static copy
     would be thrown away in the swap. So initialize on the injected header, and
     only run immediately when no swap is pending.
     -------------------------------------------------------------------------- */
  if (document.querySelector('.site-header:not(.noscript-header)')) {
    initSiteChrome();
  } else {
    document.addEventListener('partials:loaded', initSiteChrome, { once: true });
  }

  // A hint for fellow console-openers. The terminal itself lives at /terminal.
  console.log('%c👀 curiosity opens consoles… it also opens /terminal', 'font-size:11px;font-style:italic;color:#7dd3fc;');
  console.log('%c⌨️  press . for the background controls — or run `magic` in /terminal', 'font-size:11px;font-style:italic;color:#7dd3fc;');

  // Assigned when the WhatsApp bubble is built near the bottom of this file. The
  // `b` shortcut belongs with the other background keys, which are wired up in
  // the canvas block below — long before the bubble exists.
  let toggleWhatsappBubble = null;

  const canvas = document.getElementById('bg-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let mouseX = 0;
    let mouseY = 0;
    let mouseActive = false;
    const particles = [];

    // Velocity ceiling, in px per 60fps tick. Only approached while the cursor
    // is pulling — free-drifting particles sit at their own cruise speed, which
    // is well below this.
    const MAX_SPEED = 0.95;

    // Visitor-adjustable density and speed (k/s and l/a, plus the settings
    // popover). Both are multipliers over the width-derived defaults rather than
    // absolute numbers: resizeCanvas recomputes the base count from the viewport
    // on every resize — and mobile browsers fire resize on every URL-bar
    // show/hide — so an absolute count would be wiped seconds after it was set.
    //
    // Deliberately not stored anywhere. This is a toy, and someone who cranks
    // the field to 460 dots should not carry that paint cost into every later
    // page. Reloading, or following any link, returns the background to default.
    const MIN_PARTICLES = 24;
    const DENSITY_STEP = 1.25;
    const SPEED_STEP = 1.3;
    const MIN_SPEED_SCALE = 0.25;
    const MAX_SPEED_SCALE = 2.5;
    let densityScale = 1;
    let speedScale = 1;

    // Low-end gate: on a machine reporting 4 cores or 2 GB of RAM, decoration
    // should not be the thing that eats them — start the field at half density.
    // Both properties are feature-detected because Firefox and Safari ship
    // neither; an absent value falls back high so it never triggers the gate.
    // Only the *starting* value moves: k/s and the settings popover multiply
    // densityScale from here, so a visitor who wants the full field is one
    // keypress away from it.
    if ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2) {
      densityScale = 0.5;
    }

    // WCAG 2.2.2 pause state — read before the loop starts so a visitor who
    // paused the animation on a previous page keeps it paused here. Scoped to
    // the tab session, like every other choice this script remembers: nothing
    // it stores outlives the visit.
    const PAUSE_KEY = 'bgAnimationPaused';
    let animationPaused = false;
    try {
      animationPaused = sessionStorage.getItem(PAUSE_KEY) === '1';
    } catch (error) {
      // Storage can be blocked (strict privacy modes) — default to animating.
    }

    // Assigned when the pause button is built. The `p` shortcut calls this exact
    // function rather than reimplementing the toggle, so the aria-pressed sync
    // and the stored pause state can never drift from what the button does.
    let togglePause = null;

    // The full-viewport gradient only depends on the canvas size, so it is
    // rebuilt on resize instead of being reallocated on every animation frame.
    let backgroundGradient = null;

    // The base gradient's stops are read from the CSS custom properties rather
    // than duplicated here. This canvas paints opaquely over the #bg-canvas CSS
    // gradient, so a hardcoded copy that drifted from main.css — or, worse, a
    // stale cached copy of one file paired with a fresh copy of the other —
    // would repaint the whole viewport in the wrong shade. Reading the token
    // makes main.css the single source of truth. The fallbacks only apply if the
    // stylesheet failed to load, in which case there is nothing to match anyway.
    function cssColor(name, fallback) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || fallback;
    }

    function buildGradients() {
      // Radius must equal the CSS twin's `farthest-side` (= max(w,h)/2), or the
      // first canvas frame visibly shifts the edge shading it paints over.
      backgroundGradient = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) / 2);
      backgroundGradient.addColorStop(0, cssColor('--bg-glow', 'rgba(25, 36, 55, 0.96)'));
      backgroundGradient.addColorStop(0.45, cssColor('--bg-mid', 'rgba(25, 36, 55, 0.96)'));
      backgroundGradient.addColorStop(1, cssColor('--bg-base', '#121b2c'));
    }

    // The gradient stops above are CSS custom properties, read once and baked
    // into a CanvasGradient. CSS restyles itself when data-theme flips; a canvas
    // does not. Without the observer further down, toggling to light left this
    // canvas painting the dark navy across the whole viewport while the text on
    // top of it went near-black — measured 1.01:1, the headline simply vanished.
    let particleLightness = 75;

    function syncThemeColours() {
      // 75% is a pastel that glows on the dark page and washes out on the light
      // one; 45% is the same hue with enough depth to read against paper.
      particleLightness =
        document.documentElement.getAttribute('data-theme') === 'light' ? 45 : 75;
      // Every cached fill string baked in the old lightness, so they are all
      // stale now. Dropped rather than rebuilt here: applyTheme repaints
      // immediately anyway, and drawFrame refills each one as it paints it.
      particles.forEach((particle) => {
        particle.color = null;
      });
    }

    function applyTheme() {
      syncThemeColours();
      buildGradients();
      // A pure repaint (dt 0). The animation loop cannot be relied on here: it
      // returns early while paused, and under prefers-reduced-motion the canvas
      // is a single static frame that would otherwise keep the old theme for the
      // rest of the visit.
      drawFrame(0);
    }

    // The default field: one dot per 7px of width, capped so an ultrawide
    // monitor does not pay for a field nobody reads as denser. A 375px phone
    // lands at ~53, a 1440px laptop at 200.
    function baseCount() {
      return Math.max(1, Math.min(200, Math.floor(width / 7)));
    }

    // Hand-tuned ceiling for `k`. Small screens are the ones that actually feel
    // a heavy field — weaker GPUs, and every dot is an arc() fill per frame — so
    // they top out far below the desktop limit.
    function maxCount() {
      return width < 700 ? 170 : 460;
    }

    function targetCount() {
      return Math.min(maxCount(), Math.max(MIN_PARTICLES, Math.round(baseCount() * densityScale)));
    }

    // Clamp the multiplier itself, not just the resulting count, so repeated
    // presses past the ceiling cannot bank up invisible headroom and leave the
    // first several presses of the opposite key looking dead.
    //
    // Only ever called from the density controls, never from resize. This
    // rewrites persistent state against the *current* width, so calling it on
    // resize would let a transient bad width corrupt the visitor's setting — a
    // 0-width first layout resolves baseCount() to 1 and pins the scale at 24,
    // which the next real resize then re-clamps straight to the ceiling.
    // resizeCanvas leaves the scale alone and lets targetCount clamp the count,
    // so a viewport change caps the field without destroying the chosen value:
    // shrink the window and the count drops, restore it and the density is back.
    function clampDensityScale() {
      const base = baseCount();
      densityScale = Math.min(maxCount() / base, Math.max(MIN_PARTICLES / base, densityScale));
    }

    // The fill string for one dot. hue and alpha are fixed at spawn and
    // particleLightness only moves on a theme flip, so the result is constant
    // between theme changes — see the `color` cache below.
    function particleColour(hue, alpha) {
      return `hsla(${hue}, 90%, ${particleLightness}%, ${alpha})`;
    }

    function spawnParticle() {
      // Direction is seeded randomly, then steered by the drift force and the
      // cursor. Magnitude is a per-particle constant so the field keeps a
      // varied, organic pace instead of every dot moving in lockstep — see
      // the speed handling in drawFrame.
      const angle = Math.random() * Math.PI * 2;
      const cruise = Math.random() * 0.2 + 0.18;
      const alpha = Math.random() * 0.7 + 0.2;
      const hue = 180 + Math.random() * 80;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * cruise,
        vy: Math.sin(angle) * cruise,
        cruise,
        radius: Math.random() * 1.5 + 0.4,
        alpha,
        hue,
        drift: Math.random() * 0.01 + 0.005,
        // Cached fill string. drawFrame used to build this hsla() from scratch
        // per particle per frame: at the 460-dot ceiling and 30fps that is
        // ~13,800 identical strings allocated and thrown away every second, for
        // a value with no per-frame input. Set to null wherever it can go stale
        // — currently only syncThemeColours, which moves particleLightness —
        // and drawFrame rebuilds it on that particle's next paint.
        color: particleColour(hue, alpha),
      };
    }

    // Grow or shrink the field to the current target. Shared by resize and by
    // the density controls, so both take the same path.
    function syncParticleCount() {
      const count = targetCount();
      if (particles.length > count) {
        particles.length = count;
      }
      while (particles.length < count) {
        particles.push(spawnParticle());
      }
    }

    function resizeCanvas() {
      // The backing store is sized in device pixels; every coordinate in this
      // file stays in CSS pixels. Without this the bitmap was one pixel per CSS
      // pixel and the browser upscaled it — on the 2x display this was measured
      // on (devicePixelRatio 2.0, 375x812 viewport) every 0.4-1.9px dot was
      // being drawn at half the resolution the screen can show, which is exactly
      // the size range where the softness is visible.
      //
      // Capped at 2 on purpose: a 3x phone would cost 2.25x the fill rate of 2x
      // — 460 arc() fills a frame is the ceiling here — for a difference nobody
      // resolves on a blurred ambient background.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      // The CSS size must be pinned explicitly. main.css sets #bg-canvas to
      // `position: fixed; inset: 0`, but a canvas is a *replaced* element, and
      // for those `width: auto` resolves to the intrinsic size (the width
      // attribute) rather than being solved from left/right — the over-
      // constrained `right` is simply dropped. Measured on the local preview
      // at 375x812 / dpr 2: with the backing store raised to 750 and no inline
      // style, getBoundingClientRect() reported 750x1624 CSS px, i.e. the
      // background painted at twice the viewport. These two lines restore the
      // exact geometry the file had before the dpr change.
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      // Writing canvas.width/height resets the whole context state, transform
      // included, so this has to come after them. setTransform rather than
      // scale(), because scale() would compound on every resize — and mobile
      // browsers fire resize on every URL-bar show/hide.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildGradients();

      // Keep existing particles across resizes — mobile browsers fire resize on
      // every URL-bar show/hide, and regenerating positions made the whole field
      // visibly teleport mid-scroll. Only grow or shrink to the target count.
      //
      // Pull kept particles back inside the new bounds first — one stranded far
      // outside after a viewport shrink is too slow to ever drift back.
      particles.forEach((particle) => {
        particle.x = Math.min(Math.max(particle.x, 0), width);
        particle.y = Math.min(Math.max(particle.y, 0), height);
      });
      syncParticleCount();
    }

    // dt is elapsed time normalised to a 60fps tick (1 == ~16.7ms), so positions
    // advance at the same perceived speed however often frames actually land.
    // dt 0 is a pure repaint: nothing moves (matters while paused).
    function drawFrame(dt) {
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = backgroundGradient;
      ctx.fillRect(0, 0, width, height);

      // The speed control scales the whole model — each particle's own cruise
      // speed and the ceiling together — so the field keeps its varied pace
      // instead of flattening toward one uniform velocity at the extremes.
      const speedCeiling = MAX_SPEED * speedScale;

      particles.forEach((particle, index) => {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;

        if ((particle.x < -20 && particle.vx < 0) || (particle.x > width + 20 && particle.vx > 0)) particle.vx *= -1;
        if ((particle.y < -20 && particle.vy < 0) || (particle.y > height + 20 && particle.vy > 0)) particle.vy *= -1;

        if (mouseActive) {
          const dx = mouseX - particle.x;
          const dy = mouseY - particle.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 220) {
            const force = (220 - distance) / 220;
            particle.vx += (dx / distance) * 0.03 * force * dt;
            particle.vy += (dy / distance) * 0.03 * force * dt;
          }
        }

        // Drift forces are dt-scaled like the positions above, so the velocity
        // model behaves the same at 30fps as it did at 60. They only steer
        // direction now — the magnitude is set immediately below.
        particle.vx += Math.sin((Date.now() * particle.drift) + index) * 0.0012 * dt;
        particle.vy += Math.cos((Date.now() * particle.drift) + index * 0.7) * 0.0012 * dt;

        // Speed is eased toward this particle's own cruise speed rather than
        // toward zero. The previous model multiplied by 0.98^dt every frame,
        // which bled all velocity away within about a second and left the field
        // effectively frozen — the oscillating drift alone sustained only
        // ~0.3 px/s, because it reverses long before any speed can build.
        // Energy picked up from the cursor decays back to cruise gradually, so
        // particles visibly accelerate as they are drawn in, then settle.
        const cruise = particle.cruise * speedScale;
        const speed = Math.hypot(particle.vx, particle.vy);
        if (speed > 1e-6) {
          const eased = speed > cruise
            ? Math.max(cruise, speed * Math.pow(0.98, dt))
            : cruise;
          const target = Math.min(eased, speedCeiling);
          particle.vx = (particle.vx / speed) * target;
          particle.vy = (particle.vy / speed) * target;
        }

        ctx.beginPath();
        if (!particle.color) {
          particle.color = particleColour(particle.hue, particle.alpha);
        }
        ctx.fillStyle = particle.color;
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // The loop is capped to ~30fps — plenty for a slow ambient drift, and half
    // the paint cost of a vsync-locked loop on 60Hz displays.
    const frameInterval = 1000 / 30;
    let lastFrameTime = 0;
    // Single-flight guard: pause→resume inside one frame must not stack a
    // second concurrent rAF loop on top of the still-pending callback.
    let framePending = false;

    function scheduleFrame() {
      if (!framePending) {
        framePending = true;
        requestAnimationFrame(animate);
      }
    }

    function animate(timestamp) {
      framePending = false;
      if (prefersReducedMotion || animationPaused) return;
      scheduleFrame();
      const elapsed = timestamp - lastFrameTime;
      if (elapsed < frameInterval) return;
      lastFrameTime = timestamp;
      // Clamp dt so a background-tab wake-up doesn't teleport the particles.
      drawFrame(Math.min(elapsed / (1000 / 60), 3));
    }

    // Watching the attribute rather than listening for a custom event from
    // theme.js keeps the two files independent: boot.js also sets data-theme
    // before first paint, and anything else that ever sets it is covered too.
    new MutationObserver(applyTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    let resizeFrame = null;
    window.addEventListener('resize', () => {
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = requestAnimationFrame(() => {
        resizeCanvas();
        // Repaint in the same frame: resizing the canvas clears it, and the
        // animation loop's own rAF callback has already run by this point, so
        // without this the cleared canvas would be the frame the user sees.
        drawFrame(0);
        // The count is width-derived, so the popover's readout goes stale on
        // resize even though the visitor changed nothing.
        syncPanel();
      });
    });
    window.addEventListener('mousemove', (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      mouseActive = true;
    });
    // mouseleave never bubbles to window — it must be observed on document,
    // otherwise the particles keep being pulled toward the last pointer position
    // after the cursor has left the browser window.
    document.addEventListener('mouseleave', () => {
      mouseActive = false;
    });

    syncThemeColours();
    resizeCanvas();
    // First paint is immediate and static; the loop takes over from there.
    drawFrame(0);
    // The ambient loop waits for window load + an idle slot: during page load
    // its rAF work competes with first paint on throttled phones (Lighthouse
    // attributed 0.5-0.8s of load-time main-thread work to it). The static
    // frame above already matches the CSS twin gradient, so the wait is
    // invisible. The pause button's resume path can still start the loop
    // earlier — that's user-initiated and fine.
    const startAmbientLoop = () => {
      if (!prefersReducedMotion && !animationPaused) {
        scheduleFrame();
      }
    };
    const queueAmbientStart = () => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(startAmbientLoop, { timeout: 2000 });
      } else {
        setTimeout(startAmbientLoop, 250);
      }
    };
    if (document.readyState === 'complete') {
      queueAmbientStart();
    } else {
      window.addEventListener('load', queueAmbientStart, { once: true });
      // Failsafe: one stalled subresource must not keep the scene frozen.
      setTimeout(startAmbientLoop, 4000);
    }

    // React to the OS reduced-motion switch flipping mid-visit. The shared
    // flag is already updated by the top-of-file listener (registered first,
    // so it has run by the time this one fires); this one takes the canvas
    // consequences. Flipping ON needs no explicit stop — animate() checks the
    // flag and returns without rescheduling — but repaint once so the frame
    // left behind is a deterministic static field rather than whatever
    // mid-pull state the loop happened to stop on. Flipping OFF restarts the
    // loop unless the visitor had paused it themselves; the clock reset
    // mirrors togglePause's resume path so the stopped stretch is not
    // counted as elapsed time.
    if (typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', () => {
        if (prefersReducedMotion) {
          drawFrame(0);
        } else if (!animationPaused) {
          lastFrameTime = performance.now();
          scheduleFrame();
        }
      });
    }

    // WCAG 2.2.2 pause control — auto-playing motion needs a way to stop it.
    // Under prefers-reduced-motion the canvas is already a single static frame,
    // so the button would be a no-op and is not rendered at all.
    if (!prefersReducedMotion) {
      const pauseButton = document.createElement('button');
      pauseButton.className = 'bg-pause-toggle';
      pauseButton.type = 'button';

      const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>';
      const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5v14l11-7z"/></svg>';

      // Constant label + aria-pressed for state. Swapping the label between
      // Pause/Resume while also toggling aria-pressed made screen readers
      // announce contradictions ("Resume…, pressed"); APG says pick one signal.
      pauseButton.setAttribute('aria-label', 'Pause background animation');

      function syncPauseButton() {
        pauseButton.setAttribute('aria-pressed', String(animationPaused));
        pauseButton.innerHTML = animationPaused ? playIcon : pauseIcon;
      }

      syncPauseButton();

      togglePause = function () {
        animationPaused = !animationPaused;
        syncPauseButton();
        try {
          if (animationPaused) {
            sessionStorage.setItem(PAUSE_KEY, '1');
          } else {
            sessionStorage.removeItem(PAUSE_KEY);
          }
        } catch (error) {
          // Storage blocked — the choice still applies for this page view.
        }
        if (!animationPaused) {
          // Reset the clock so the pause gap is not counted as elapsed time.
          lastFrameTime = performance.now();
          scheduleFrame();
        }
      };

      pauseButton.addEventListener('click', togglePause);

      document.body.appendChild(pauseButton);
    }

    // --- Visitor controls ------------------------------------------------------
    // Two ways in, one implementation behind them: the k/s/l/a/p keys and the
    // settings popover next to the pause button both call adjustDensity /
    // adjustSpeed / togglePause. The popover is not decoration — it is the
    // pointer and screen-reader path to the same controls, it carries the
    // off switch that WCAG 2.1.4 wants for single-character shortcuts, and it is
    // the only way anyone discovers the keys without opening a console.

    // One reused toast element rather than a node per press: holding a key
    // repeats at ~30/s and spawn-and-remove would thrash the DOM.
    const toast = document.createElement('div');
    toast.className = 'bg-hint-toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);

    let toastTimer = null;
    function showToast(message) {
      // The toast is part of the chrome, so it stays quiet until the chrome is
      // asked for. Pressing k with the controls hidden still adds dots — the
      // change is visible in the background itself.
      if (!controlsShown) return;
      // While the popover is open its own <output> elements show — and, being
      // implicit live regions, announce — the same values. A toast on top of it
      // would just be a second copy of what is already on screen.
      if (panel && !panel.hidden) return;
      toast.textContent = message;
      toast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('visible'), 1400);
    }

    const panel = document.createElement('div');
    panel.className = 'bg-settings-panel';
    panel.id = 'bg-settings-panel';
    panel.hidden = true;
    // Under prefers-reduced-motion the canvas is one static frame, so speed is
    // meaningless and pause has no button to drive — the density row is still
    // worth having, since a denser static field is a real, visible change.
    panel.innerHTML =
      '<p class="bg-settings-title">Background</p>' +
      '<div class="bg-settings-row">' +
        '<span>Dots</span>' +
        '<button type="button" data-bg-act="dots-down" aria-label="Fewer dots">&minus;</button>' +
        '<output class="bg-settings-value" data-bg-out="dots">0</output>' +
        '<button type="button" data-bg-act="dots-up" aria-label="More dots">+</button>' +
      '</div>' +
      (prefersReducedMotion ? '' :
      '<div class="bg-settings-row">' +
        '<span>Speed</span>' +
        '<button type="button" data-bg-act="speed-down" aria-label="Slower">&minus;</button>' +
        '<output class="bg-settings-value" data-bg-out="speed">1.00&times;</output>' +
        '<button type="button" data-bg-act="speed-up" aria-label="Faster">+</button>' +
      '</div>') +
      '<label class="bg-settings-check">' +
        '<input type="checkbox" data-bg-act="shortcuts"> Keyboard shortcuts' +
      '</label>' +
      // Every key governed by the checkbox above has to be listed here, or
      // switching shortcuts off would silently disable something unlisted.
      '<p class="bg-settings-keys">' + (prefersReducedMotion
        ? 'k / s dots · b chat bubble · w / d theme'
        : 'k / s dots · l / a speed · p pause · b chat bubble · w / d theme') + '</p>';

    const settingsToggle = document.createElement('button');
    settingsToggle.className = 'bg-settings-toggle';
    settingsToggle.type = 'button';
    settingsToggle.setAttribute('aria-expanded', 'false');
    settingsToggle.setAttribute('aria-controls', 'bg-settings-panel');
    settingsToggle.setAttribute('aria-label', 'Background settings');
    settingsToggle.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="6.2" width="18" height="1.6" rx="0.8"/>' +
      '<rect x="3" y="16.2" width="18" height="1.6" rx="0.8"/>' +
      '<circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></svg>';

    const dotsOut = panel.querySelector('[data-bg-out="dots"]');
    const speedOut = panel.querySelector('[data-bg-out="speed"]');
    const shortcutsBox = panel.querySelector('[data-bg-act="shortcuts"]');

    // Someone who turns the letter keys off wants them off for the rest of the
    // visit, not just this page — so this one survives navigation, in the same
    // tab-scoped storage as the pause state and the WhatsApp bubble's dismissal.
    // Dots and speed do not: those reset on every page load by design.
    const SHORTCUTS_KEY = 'bgShortcutsOff';
    let shortcutsEnabled = true;
    try {
      shortcutsEnabled = sessionStorage.getItem(SHORTCUTS_KEY) !== '1';
    } catch (error) {
      // Storage blocked — shortcuts stay on, and the checkbox still works for
      // this page view.
    }
    shortcutsBox.checked = shortcutsEnabled;

    function syncPanel() {
      dotsOut.textContent = String(targetCount());
      if (speedOut) {
        speedOut.textContent = speedScale.toFixed(2) + '×';
      }
    }

    function adjustDensity(direction) {
      const before = targetCount();
      densityScale *= direction > 0 ? DENSITY_STEP : 1 / DENSITY_STEP;
      clampDensityScale();
      syncParticleCount();
      // Repaint immediately. The loop would catch up within ~33ms, but it is not
      // running at all while paused or under prefers-reduced-motion, and there
      // the change would otherwise not appear until the next resize.
      drawFrame(0);
      const after = targetCount();
      showToast(after === before ? 'Dots: ' + after + ' (limit)' : 'Dots: ' + after);
      syncPanel();
    }

    function adjustSpeed(direction) {
      // Nothing is moving under reduced motion, so there is no speed to change.
      if (prefersReducedMotion) return;
      const before = speedScale;
      speedScale = Math.min(MAX_SPEED_SCALE, Math.max(MIN_SPEED_SCALE, speedScale * (direction > 0 ? SPEED_STEP : 1 / SPEED_STEP)));
      showToast('Speed: ' + speedScale.toFixed(2) + '×' + (speedScale === before ? ' (limit)' : ''));
      syncPanel();
    }

    // The dots/speed controls are the easter egg, so they stay out of the corner
    // until `.` asks for them. The pause button is not part of this — it is the
    // WCAG 2.2.2 escape hatch for auto-playing motion, and a control nobody can
    // find is not a mechanism to stop anything. It stays visible always.
    //
    // Revealing rides in sessionStorage so it survives a click through to the
    // next page; a visitor who went looking for the controls should not have to
    // go looking again on every page of the site.
    const CONTROLS_KEY = 'bgControlsShown';
    let controlsShown = false;
    try {
      controlsShown = sessionStorage.getItem(CONTROLS_KEY) === '1';
    } catch (error) {
      // Storage blocked — the controls start hidden and `.` still reveals them.
    }

    function setControlsShown(next) {
      controlsShown = next;
      document.body.classList.toggle('bg-controls-shown', controlsShown);
      try {
        if (controlsShown) {
          sessionStorage.setItem(CONTROLS_KEY, '1');
        } else {
          sessionStorage.removeItem(CONTROLS_KEY);
        }
      } catch (error) {
        // Storage blocked — the choice still applies for this page view.
      }
      if (!controlsShown) {
        setPanelOpen(false);
        toast.classList.remove('visible');
      }
    }

    function setPanelOpen(open) {
      panel.hidden = !open;
      settingsToggle.setAttribute('aria-expanded', String(open));
      if (open) {
        // The toggle reveals on keyboard focus even while hidden, so the panel
        // can be opened from a corner that looks empty. Pin the chrome open in
        // that case, or the toggle vanishes the moment focus moves inside.
        setControlsShown(true);
        syncPanel();
        toast.classList.remove('visible');
        // Send focus to the first control, the same way Mayuri's panel takes
        // focus on open: a popover that opens behind the focus point is easy
        // to miss entirely with a screen reader or a keyboard. The Escape
        // handler's hadFocus check hands focus back to the toggle on close.
        const firstControl = panel.querySelector('button, input');
        if (firstControl) firstControl.focus();
      }
    }

    settingsToggle.addEventListener('click', () => setPanelOpen(panel.hidden));

    panel.addEventListener('click', (event) => {
      const action = event.target.closest('[data-bg-act]');
      if (!action) return;
      switch (action.dataset.bgAct) {
        case 'dots-up': adjustDensity(1); break;
        case 'dots-down': adjustDensity(-1); break;
        case 'speed-up': adjustSpeed(1); break;
        case 'speed-down': adjustSpeed(-1); break;
        case 'shortcuts':
          shortcutsEnabled = action.checked;
          try {
            if (shortcutsEnabled) {
              sessionStorage.removeItem(SHORTCUTS_KEY);
            } else {
              sessionStorage.setItem(SHORTCUTS_KEY, '1');
            }
          } catch (error) {
            // Storage blocked — the choice still applies for this page view.
          }
          break;
        default: break;
      }
    });

    document.addEventListener('click', (event) => {
      if (panel.hidden) return;
      if (panel.contains(event.target) || settingsToggle.contains(event.target)) return;
      setPanelOpen(false);
    });

    // Anything with a caret in it means the visitor is typing, not steering the
    // background — shared by every key handler below.
    // [contenteditable] has more truthy spellings than "" and "true": CodeJar,
    // which powers the /labs editors, sets contenteditable="plaintext-only", and
    // that slipped straight past an equality-matched list — every letter below
    // was stealing keystrokes from anyone typing code. Matching "present and not
    // explicitly false" is the only form that cannot be out-guessed by a value
    // nobody thought of. #linux-terminal is listed separately because it is not
    // editable at all: it is a plain div that forwards keystrokes to an emulated
    // machine, so it owns its keyboard just as completely as a text field does.
    const EDITABLE = 'input, textarea, select, ' +
      '[contenteditable]:not([contenteditable="false"]), ' +
      '#linux-terminal, #dos-screen, #dos-text, .lab-editor';

    // Escape closes the popover whether or not the letter keys are switched on,
    // so this cannot live in the shortcut handler below. Focus goes back to the
    // toggle rather than being dropped on <body>.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || panel.hidden) return;
      const hadFocus = panel.contains(document.activeElement);
      setPanelOpen(false);
      if (hadFocus) settingsToggle.focus();
    });

    // `.` is also outside the shortcut handler, and outside its enabled check on
    // purpose: it is the way back to the popover, and the popover holds the
    // switch that turns the letter keys off. Gating it on that switch would let
    // a visitor lock themselves out of their own off switch.
    //
    // A period rather than a letter, so it cannot collide with the single-letter
    // quick-navigation keys screen readers bind in browse mode.
    document.addEventListener('keydown', (event) => {
      if (event.key !== '.') return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (event.target && event.target.closest && event.target.closest(EDITABLE)) return;
      // The same two game guards as the letter keys below. A period is real
      // input mid-run — the typing passages are ordinary prose — and the
      // off-switch argument above does not apply: a run always ends, so the
      // panel is never more than one game-over away.
      if (event.target && event.target.closest && event.target.closest('.game')) return;
      if (document.querySelector('.game[data-state="playing"]')) return;
      setControlsShown(!controlsShown);
      if (controlsShown) showToast('Controls shown · . to hide');
      event.preventDefault();
    });

    // Bare single letters, so everything that could be real typing is excluded
    // first. Modifier combos belong to the browser (Ctrl+S, Ctrl+A, Ctrl+L);
    // isComposing means an IME candidate window is open and the letter is part
    // of a word being composed; a caret inside any editable element means the
    // visitor is filling in the contact form. Keys pressed while browser chrome
    // holds focus — the address bar, the find bar — never reach the document at
    // all, so they need no handling here. Screen readers in browse mode capture
    // single letters as their own quick-nav keys and likewise never pass them on.
    document.addEventListener('keydown', (event) => {
      if (!shortcutsEnabled) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (typeof event.key !== 'string') return;
      if (event.target && event.target.closest && event.target.closest(EDITABLE)) return;

      // A game owns its keyboard. Two guards because the failure modes
      // differ: a key aimed inside the shell (focus on the canvas, the pad,
      // a toolbar button), and a key that fell through to <body> while a
      // run is live — game-shell.js stamps data-state on its root for
      // exactly this check. Without these, guessing "w" in Hangman both
      // registered the miss AND flipped the site to the light theme.
      if (event.target && event.target.closest && event.target.closest('.game')) return;
      if (document.querySelector('.game[data-state="playing"]')) return;

      switch (event.key.toLowerCase()) {
        case 'k': adjustDensity(1); break;
        case 's': adjustDensity(-1); break;
        case 'l': adjustSpeed(1); break;
        case 'a': adjustSpeed(-1); break;
        case 'p':
          // Absent under prefers-reduced-motion, where there is no pause button
          // because there is no animation to pause.
          if (!togglePause) return;
          togglePause();
          showToast(animationPaused ? 'Paused' : 'Playing');
          break;
        // `b` for bubble. This WAS `w`, and moved here when `w` and `d` were
        // given to the theme below — "w" was competing as the mnemonic for
        // both WhatsApp and white, and "b" for bubble is the clearer of the
        // two anyway. If you are looking for `w` because muscle memory or an
        // old note says so: it is this key now, and `magic` says so too.
        case 'b': {
          // Null only if the bubble was never built — it always is, but this
          // handler is wired before that code runs, so guard rather than assume.
          if (!toggleWhatsappBubble) return;
          const hidden = toggleWhatsappBubble();
          showToast(hidden ? 'WhatsApp hidden' : 'WhatsApp shown');
          break;
        }
        // Theme, from anywhere on the site. The toggle lives in the header, so
        // switching meant scrolling back up to it and then finding your place
        // again — on a long article that is enough friction that people simply
        // read on in the wrong theme. Two keys rather than one toggle because
        // "make this light" is the actual intent; pressing `w` should never
        // hand you dark because you misremembered what you were in.
        //
        // The work is done by theme.js, which owns persistence, the meta
        // theme-color and the toggle's label — see window.KSTheme there.
        case 'w':
        case 'd': {
          if (!window.KSTheme) return;
          const want = event.key.toLowerCase() === 'w' ? 'light' : 'dark';
          // Silent when it is already that theme: a toast saying "Light theme"
          // on a page that was light tells you nothing and covers the words.
          if (window.KSTheme.set(want)) {
            showToast(want === 'light' ? 'Light theme · d for dark' : 'Dark theme · w for light');
          }
          break;
        }
        default: return;
      }
      event.preventDefault();
    });

    syncPanel();
    // Applies the body class for a visitor who already revealed the controls
    // earlier in the same visit; a no-op on a first page load.
    setControlsShown(controlsShown);
    // Toggle BEFORE panel: sequential focus order is DOM order, so the popover
    // has to follow the button that expands it or Tab from the just-activated
    // toggle skips straight past its own controls. Both elements are
    // position: fixed (main.css pins the toggle to the corner and the panel
    // above it), so this order changes nothing visually.
    document.body.appendChild(settingsToggle);
    document.body.appendChild(panel);
  }

  // Above-the-fold hero blocks (.hero-copy, .hero-card, .page-hero) are left out
  // on purpose: they must be visible at first paint, so only content that starts
  // below the fold gets the scroll-reveal treatment.
  const revealTargets = document.querySelectorAll('.section-card, .info-card, .license-card, .project-item, .contact-links, .contact-actions, .interactive-strip');
  const revealEnabled = 'IntersectionObserver' in window;

  revealTargets.forEach((element) => {
    element.classList.add('reveal');
    if (revealEnabled) {
      element.classList.add('reveal-animated');
    }
  });

  if (revealEnabled) {
    const onReveal = (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    };

    const revealObserver = new IntersectionObserver(onReveal, { threshold: 0.12 });
    // An element taller than the viewport (e.g. a full blog post card on a
    // phone) can never reach 12% visibility, so it would stay hidden forever.
    // Such elements reveal as soon as any part of them enters the viewport.
    const tallRevealObserver = new IntersectionObserver(onReveal, { threshold: 0 });

    document.querySelectorAll('.reveal.reveal-animated').forEach((element) => {
      const isTallerThanViewport = element.offsetHeight > window.innerHeight * 0.8;
      (isTallerThanViewport ? tallRevealObserver : revealObserver).observe(element);
    });
  } else {
    document.querySelectorAll('.reveal').forEach((element) => {
      element.classList.add('is-visible');
    });
  }

  const backToTopButton = document.createElement('button');
  backToTopButton.className = 'back-to-top';
  backToTopButton.setAttribute('aria-label', 'Back to top');
  backToTopButton.innerHTML = '↑';
  backToTopButton.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  });
  document.body.appendChild(backToTopButton);

  // Mayuri — the assistant bubble in the bottom-right corner.
  //
  // WHAT IT IS, said plainly, because the shape of it invites a wrong guess:
  // this is a SIGNPOST, not a chatbot. Nothing here answers a question. It
  // asks which of four things you are here about and hands you to the right
  // form or to a real WhatsApp conversation with a person. The copy is written
  // to promise exactly that and no more — an assistant that looks like it will
  // answer and then cannot is worse than a plain link, which is what this
  // replaced.
  //
  // Built in JS, like the plain bubble before it, so a no-JS visitor gets
  // nothing rather than a dead panel. Giving them a working bubble would mean
  // static markup in all 288 page footers; the corner is decoration, and that
  // is not a trade worth making for it.
  //
  // Hideable two ways, both inherited from the bubble this grew out of: the ×,
  // and the `b` background shortcut, which unlike the × can also bring it
  // back. Either way the back-to-top button drops down to take the corner and
  // the choice lasts the visit. sessionStorage is wrapped in try/catch because
  // private modes block it.
  //
  // The global click listener below still books the WhatsApp link inside the
  // panel as whatsapp_link_click — it matches on href, so moving the link from
  // the bubble into a panel changed nothing about the reporting.
  {
    const WA_DISMISSED_KEY = 'waFloatDismissed';
    const GREETED_KEY = 'mayuriGreeted';
    // The message she hands over says where it came from. "I am on your
    // website" told Krunalkumar nothing he could not already see; naming
    // Mayuri tells him the person came through the corner rather than the
    // contact page, which is the one useful thing this link can carry.
    const WA_HREF = 'https://wa.me/918200713617?text=' +
      encodeURIComponent('Hi Krunalkumar, Mayuri sent me over from your website — I would like to talk.');

    let waHidden = false;
    try {
      waHidden = sessionStorage.getItem(WA_DISMISSED_KEY) === '1';
    } catch (e) { /* storage unavailable — fall back to per-page dismissal */ }

    // A peahen crest over a friendly face: mayuri is the peahen, so the name
    // and the picture say the same thing. Inline SVG rather than an image file
    // because it is theme-coloured, costs no request, and has to stay crisp at
    // 34px in a corner and 44px in the panel header.
    const AVATAR =
      '<svg class="mayuri-face" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      // Order matters: neck, then clothing, then the hair BEHIND the head, then
      // the face, then the hair in front. Drawn any other way the hair swallows
      // the throat and the head sits straight on the shoulders.
      '<path d="M27.6 41.5h8.8v10.5c0 2.4-2 4-4.4 4s-4.4-1.6-4.4-4z" fill="#eab89a"/>' +
      '<path d="M27.6 41.5h8.8v5c-2.6 1.7-6.2 1.7-8.8 0z" fill="#d7a181"/>' +
      // A plain tee — the kurta and dupatta that were here briefly read as fussy
      // at 54px, since a neckline, a gold band and a drape is more detail than a
      // circle this size can hold. Coral, not blue: the medallion behind her is
      // blue, and a blue shirt on it left her with no shoulders at all. Warm
      // against cool is also the one pairing that survives both themes.
      '<path d="M7 64c2.4-9.5 9-14 16-15.6 3.4 3.4 15 3.4 18 0C48 50 54.6 54.5 57 64z" fill="#ef7360"/>' +
      '<path d="M23 48.4c3 2.2 15 2.2 18 0l-2.6-1.2c-3 2-9.8 2-12.8 0z" fill="#cf5646"/>' +
      // The company mark on her shirt. Centred between the two side locks, which
      // is the only part of the shirt that is never covered at this size.
      // "KS" is type; the underscore is a drawn bar. The glyph sits on the
      // baseline in some fonts and below it in others, so at 6px it either
      // vanished or clipped against the bottom of the circle - a rectangle is
      // the same mark and always lands where it is put.
      '<text x="30.2" y="59.4" text-anchor="middle" fill="#fff1e6" opacity="0.96" ' +
        'font-family="Consolas, Menlo, monospace" font-size="6.6" font-weight="700" ' +
        'letter-spacing="0.5">KS</text>' +
      '<rect x="34.4" y="58.2" width="4.2" height="1.3" rx="0.65" fill="#fff1e6" opacity="0.96"/>' +
      '<g class="mayuri-head">' +
      // A lot of hair, and that is the point: a crown that overshoots the circle
      // and two long locks cropped by the medallion. Small hair on a round face
      // reads as a helmet.
      '<path d="M13 62C5.5 48 5 30 10 20 14.5 10.5 22 5 32 5s17.5 5.5 22 15c5 10 4.5 28-3 42l-8-2c5.5-11 6.5-25 3-33-2.5-6-8-9.5-14-9.5S20.5 21 18 27c-3.5 8-2.5 22 3 33z" fill="#241a2f"/>' +
      '<path d="M12.6 40c-3.4 12-3 23 .4 32l10-1.6c-3.4-9.6-4.4-20-3-31z" fill="#2e2240"/>' +
      '<path d="M51.4 40c3.4 12 3 23-.4 32l-10-1.6c3.4-9.6 4.4-20 3-31z" fill="#2e2240"/>' +
      // A sheen across the crown. Flat black hair was what made her look drawn
      // rather than lit.
      '<path d="M19 22c3.4-5.4 8-8.4 12.4-8.6-5.6 1.8-9.6 5.6-11.4 11.6-.6 2-1 4.2-1.2 6.4-.8-3.6-.6-6.8.2-9.4z" fill="#4a3a63" opacity="0.85"/>' +
      // Face: an oval that tapers to the chin rather than a plain ellipse, which
      // is most of the difference between a doll and a face.
      // Round, not tapered. The oval-with-a-chin version was more anatomical and
      // less cute, which is the wrong trade for a 54px face - roundness is most
      // of what makes one read as friendly.
      '<ellipse cx="32" cy="33.4" rx="13.7" ry="14.3" fill="#f8d4b6"/>' +
      '<ellipse cx="19.4" cy="34" rx="1.8" ry="2.7" fill="#f0c4a2"/>' +
      '<ellipse cx="44.6" cy="34" rx="1.8" ry="2.7" fill="#f0c4a2"/>' +
      // Jhumkas: a stud and a small bell under it. Two shapes is the least that
      // reads as an earring rather than a dot of paint.
      '<circle cx="19.2" cy="36.9" r="0.95" fill="#f4c84a"/>' +
      '<path d="M18.1 38.1h2.2l-.5 2.1h-1.2z" fill="#f4c84a"/>' +
      '<circle cx="44.8" cy="36.9" r="0.95" fill="#f4c84a"/>' +
      '<path d="M43.7 38.1h2.2l-.5 2.1h-1.2z" fill="#f4c84a"/>' +
      '<path d="M17.4 34c-.6-13.4 6.6-21.2 14.6-21.2S47.2 20.6 46.6 34c-1.6-7.3-4.8-11.6-8.3-13-2.6 3.7-10.2 5.3-14.8 2.9-3.3 1.8-6.2 5.4-6.1 10.1z" fill="#241a2f"/>' +
      '<path d="M17.6 25c-2.4 3.4-3.6 7.6-3.4 12.2-2.2-5.2-1.6-10.4 1-14.4z" fill="#241a2f"/>' +
      '<path d="M46.4 25c2.4 3.4 3.6 7.6 3.4 12.2 2.2-5.2 1.6-10.4-1-14.4z" fill="#241a2f"/>' +
      '<circle cx="32" cy="24.4" r="1.15" fill="#c0392b"/>' +
      '<path d="M23.6 27.4q3.4-2.3 6.6-.2" stroke="#3f2c4c" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      '<path d="M33.8 27.2q3.2-2.1 6.6.2" stroke="#3f2c4c" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
      // TWO faces are drawn, and CSS cross-fades between them. The resting one
      // blinks; the happy one appears while she is being tapped.
      //
      // It works this way because the first attempt STRETCHED the resting mouth
      // into a grin with a transform, and a scaled-up lip shape does not look
      // like a bigger smile - it looks like a mouth pulled out of shape, which
      // is exactly what it was. A delighted face is a different drawing, not a
      // distorted one.
      '<g class="mayuri-eyes">' +
        '<ellipse cx="26.9" cy="33.6" rx="2.65" ry="3.15" fill="#2e2036"/>' +
        '<ellipse cx="37.1" cy="33.6" rx="2.65" ry="3.15" fill="#2e2036"/>' +
        '<circle cx="27.7" cy="32.5" r="0.98" fill="#ffffff"/>' +
        '<circle cx="37.9" cy="32.5" r="0.98" fill="#ffffff"/>' +
        '<circle cx="26.1" cy="34.7" r="0.52" fill="#ffffff" opacity="0.72"/>' +
        '<circle cx="36.3" cy="34.7" r="0.52" fill="#ffffff" opacity="0.72"/>' +
        '<path d="M24.1 31.6q2.8-2.2 5.6-.5" stroke="#2e2036" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
        '<path d="M34.4 31.1q2.8-1.7 5.5.5" stroke="#2e2036" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
        '<path d="M23.9 31.4l-1.5-1" stroke="#2e2036" stroke-width="1.2" stroke-linecap="round"/>' +
        '<path d="M40.1 31.4l1.5-1" stroke="#2e2036" stroke-width="1.2" stroke-linecap="round"/>' +
      '</g>' +
      // Happy eyes: the upturned arcs everyone reads as delight.
      '<g class="mayuri-eyes-happy">' +
        '<path d="M24.3 34.6q2.6-3.7 5.2 0" stroke="#2e2036" stroke-width="1.9" fill="none" stroke-linecap="round"/>' +
        '<path d="M34.5 34.6q2.6-3.7 5.2 0" stroke="#2e2036" stroke-width="1.9" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      '<path d="M31.2 36.6q.9 1.3 1.8.2" stroke="#dda683" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="23.2" cy="38.4" rx="2.9" ry="1.8" fill="#ef8a8a" opacity="0.4"/>' +
      '<ellipse cx="40.8" cy="38.4" rx="2.9" ry="1.8" fill="#ef8a8a" opacity="0.4"/>' +
      // A simple upturned arc, not a pair of lips. The filled lip shape that
      // was here first was trying to be pretty and landed on sulky instead —
      // at 54px a mouth with volume reads as a pout, and the thing that reads
      // as a smile is a curve with round ends and nothing else in it.
      '<g class="mayuri-mouth">' +
        // Wide and softly curved: pleased to see you, not braced. Too deep and it
        // looks held; too shallow and she looks polite rather than glad. This sits
        // between the two, and the arc is wider than it is deep, which is the part
        // that makes it read as warm.
        '<path d="M28.9 40.9q3.1 2.9 6.2 0" stroke="#c4636a" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      // The open smile, with a tongue behind it so it reads as a laugh rather
      // than a hole.
      '<g class="mayuri-mouth-happy">' +
        '<path d="M27.9 39.9h8.2c0 3.9-1.9 6.2-4.1 6.2s-4.1-2.3-4.1-6.2z" fill="#a8434f"/>' +
        '<path d="M30 43.6q2-1.5 4 0c-.4 1.7-1.4 2.4-2 2.4s-1.6-.7-2-2.4z" fill="#f19aa2"/>' +
        '<path d="M27.9 39.9h8.2" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>' +
      '</g>' +
      /* The third face: hurt. Shown when somebody has been abusive and held
         there until they apologise.

         A full replacement group rather than an overlay, exactly like the happy
         pair — drawing sad brows on top of the ordinary ones left two sets of
         eyebrows fighting each other at 54px. What carries the expression is
         the brow, not the mouth: the inner ends lift and the outer ends fall,
         which is the one shape a face cannot make on purpose and everybody
         reads instantly. The mouth is the warm arc inverted, and nothing else
         changes — no tear, no colour shift. She is disappointed, not
         devastated, and the restraint is what keeps it from reading as a
         cartoon sulk. */
      '<g class="mayuri-eyes-sad">' +
        '<ellipse cx="26.9" cy="34.2" rx="2.45" ry="2.75" fill="#2e2036"/>' +
        '<ellipse cx="37.1" cy="34.2" rx="2.45" ry="2.75" fill="#2e2036"/>' +
        '<circle cx="27.6" cy="33.3" r="0.85" fill="#ffffff"/>' +
        '<circle cx="37.8" cy="33.3" r="0.85" fill="#ffffff"/>' +
        '<path d="M23.9 31.5q2.9 .1 5.8-1.9" stroke="#2e2036" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
        '<path d="M40.1 31.5q-2.9 .1-5.8-1.9" stroke="#2e2036" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      '<g class="mayuri-mouth-sad">' +
        '<path d="M28.9 42.6q3.1-2.9 6.2 0" stroke="#c4636a" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      /* And a fourth: unimpressed. Worn for the first warning, where "sad" is
         too much — she has been spoken to rudely once and is telling you so,
         not grieving about it.

         The difference from the sad face is entirely in the brows, and it is
         the opposite tilt: sad lifts the INNER ends, annoyance drops them. The
         mouth is a flat line rather than a frown, because a level mouth reads
         as withheld approval where a downturned one reads as hurt. Two shapes,
         four pixels apart, and everybody reads them correctly. */
      '<g class="mayuri-eyes-unhappy">' +
        '<ellipse cx="26.9" cy="33.9" rx="2.5" ry="2.6" fill="#2e2036"/>' +
        '<ellipse cx="37.1" cy="33.9" rx="2.5" ry="2.6" fill="#2e2036"/>' +
        '<circle cx="27.6" cy="33.1" r="0.88" fill="#ffffff"/>' +
        '<circle cx="37.8" cy="33.1" r="0.88" fill="#ffffff"/>' +
        '<path d="M23.9 30.3q2.9 .2 5.8 1.5" stroke="#2e2036" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
        '<path d="M40.1 30.3q-2.9 .2-5.8 1.5" stroke="#2e2036" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      '<g class="mayuri-mouth-unhappy">' +
        '<path d="M29.1 41.6h5.8" stroke="#c4636a" stroke-width="1.7" fill="none" stroke-linecap="round"/>' +
      '</g>' +
      // A peacock feather in her hair: mayuri is the peahen, so the name and the
      // picture say the same thing.
      '<g transform="translate(47.5 18) rotate(22)">' +
        '<ellipse rx="4.4" ry="6.2" fill="#1fb5a6"/>' +
        '<ellipse cy="0.6" rx="2.4" ry="3.5" fill="#2f6fd0"/>' +
        '<circle cy="1" r="1.5" fill="#f4c84a"/>' +
      '</g>' +
      '</g>' +
      '</svg>';

    const WA_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>';

    /* Which report form this page belongs to, if any. This used to be the
       backbone of a four-item route menu; the menu is gone and the fact is
       not, because the chat's fallback still wants it — "report a bug" answered
       on /labs/jwt should offer that lab's form, not a generic one.

       Never ?from=mayuri. That parameter already means something on the lab
       report form — it names the LAB a report came from, and the form prints
       "Reporting from the <name> playground." — so inventing a value for
       attribution would have invented a playground that does not exist.

       The slug comes from the page's OWN report button rather than from
       parsing location.pathname. That button is the page's own statement of
       which lab it is, written by the generator and kept correct by it; a
       pathname parse would re-derive the same fact independently and start
       disagreeing the day a URL and a slug stop matching. Reading what the
       page already says cannot drift.

       Where there is no such button — the two hubs, a blog post, the home
       page — this is empty and the fallback simply offers the person without
       a form, which is honest: she genuinely does not know which one you mean. */
    const own = (() => {
      const a = document.querySelector('a[href*="#lab-feedback"][href*="from="]');
      return a ? a.getAttribute('href') : '';
    })();
    // Game pages carry the same link with &area=games; that is what tells the
    // form to say "game" instead of "playground", and it is what decides the
    // wording of the report offer in the chat fallback.
    const ownIsGame = own.indexOf('area=games') !== -1;

    const wrap = document.createElement('div');
    wrap.className = 'mayuri-wrap';

    // ---- the greeting, collapsed form ------------------------------------
    // The SHORT hello. The full sentence lives inside the panel, where there
    // is room to read it and a reason to — out here it would be four lines of
    // text nobody asked for, floating over the page.
    //
    // Shown on every page load until she is OPENED: the suppression flag is
    // written when somebody meets her, not when she says hello — the timer
    // near the bottom of this block explains why it moved. It also never
    // covers the button, so somebody who wants the panel is not fighting a
    // toast to reach it.
    const greet = document.createElement('div');
    greet.className = 'mayuri-greet';
    greet.setAttribute('role', 'status');
    // hidden, not just opacity 0. The CSS hides the resting greeting visually
    // (opacity, pointer-events), but an opacity-hidden element still sits in
    // the accessibility tree — so "Hi, I am Mayuri!" was permanently present
    // on every page, including under prefers-reduced-motion where it never
    // appears at all. The attribute is managed across the whole lifecycle:
    // off just before the visible window opens (see the greeting timer at the
    // bottom of this block), back on when the window closes or she is opened,
    // and never removed under reduced motion.
    greet.hidden = true;
    // The salutation follows the VISITOR'S clock, not IST. The owner first
    // asked for IST, but the visitors are global, and a greeting pinned to one
    // timezone says "Good morning" to somebody reading at their 9pm — which
    // lands as a bug, not a warmth. new Date().getHours() is the reader's own
    // wall clock, the only clock a greeting can be right on.
    //
    // TWO LINES, and that is the owner's design, arrived at the honest way:
    // "Good afternoon, I am Mayuri!" measured 301-333px on one line against
    // the ~300px a 320px phone leaves, so a first pass shortened the words —
    // and "Morning!" alone read clipped, like she was in a hurry. Splitting
    // instead keeps the full salutation AND the classic hello, and the widest
    // line is now "Hi, I am Mayuri!" (~141px), untouchable by any viewport.
    // Late night (22:00-04:59) says "Up late?" — time-true where "Good
    // evening" at 2am would be false, and warmer than dropping the line.
    const hour = new Date().getHours();
    let daypart = 'Up late?';
    if (hour >= 5 && hour <= 11) daypart = 'Good morning';
    else if (hour >= 12 && hour <= 16) daypart = 'Good afternoon';
    else if (hour >= 17 && hour <= 21) daypart = 'Good evening';
    // Only the salutation line varies. The .mayuri-name span is untouched on
    // purpose: the ring and glow styling in main.css key off that class.
    greet.innerHTML = '<span class="mayuri-daypart">' + daypart + '</span><br>' +
      '<span>Hi, I am </span>' +
      '<span class="mayuri-name">Mayuri!</span>';

    // ---- the panel --------------------------------------------------------
    const panel = document.createElement('div');
    panel.className = 'mayuri-panel';
    panel.id = 'mayuri-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Mayuri — how can I help');
    panel.hidden = true;

    /* TWO DOORS, not four routes. The four were a menu of forms — a question
       about a lab, about a game, internships, everything else — and every one
       of them ended in the same place: a form somebody else reads later. They
       are kept below as the chat's own suggestions, where they are useful
       precisely when she has failed, rather than being the whole offer.

       What replaces them is a question and a person: ask me, or go straight to
       him. The `own` slug logic above still earns its keep — the chat uses it
       to route "report a bug in this lab" at the lab you are standing in. */
    panel.innerHTML =
      '<div class="mayuri-panel-head">' +
        '<span class="mayuri-avatar mayuri-avatar-lg">' + AVATAR + '</span>' +
        '<div>' +
          '<p class="mayuri-hello">Hi, I am Mayuri, personal assistant of Krunalkumar. ' +
            'I am here to help.</p>' +
          '<p class="mayuri-sub">Ask me about anything on this site. If I do not know, ' +
            'I will hand you straight to him.</p>' +
        '</div>' +
        '<button class="mayuri-panel-close" type="button" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="mayuri-menu">' +
        '<button class="mayuri-route mayuri-route-chat" type="button">' +
          '<span class="mayuri-route-label">Chat with me</span>' +
          /* Was a list of categories — labs, games, terms, what he does — which
             read as a filing cabinet and, worse, as a limit on what she would
             take. She will have a go at anything; the honest invitation is the
             short one. */
          '<span class="mayuri-route-note">Ask me anything</span>' +
        '</button>' +
        '<a class="mayuri-wa" href="' + WA_HREF + '" target="_blank" rel="noopener">' +
          WA_ICON + '<span>Message my boss directly</span>' +
        '</a>' +
      '</div>' +
      '<div class="mayuri-chat" hidden>' +
        '<div class="mayuri-chat-bar">' +
          '<button class="mayuri-chat-back" type="button">&larr; Back</button>' +
          '<button class="mayuri-chat-reset" type="button">Start over</button>' +
        '</div>' +
        '<div class="mayuri-log" role="log" aria-live="polite" aria-atomic="false"></div>' +
        '<form class="mayuri-form">' +
          '<label class="sr-only" for="mayuri-input">Ask Mayuri a question</label>' +
          '<input class="mayuri-input" id="mayuri-input" type="text" autocomplete="off" ' +
            'placeholder="Ask me anything about this site…">' +
          '<button class="mayuri-send" type="submit">Ask</button>' +
        '</form>' +
        '<a class="mayuri-chat-boss" href="' + WA_HREF + '" target="_blank" rel="noopener">' +
          'Rather talk to a person? Message my boss directly' +
        '</a>' +
      '</div>';

    // ---- the button -------------------------------------------------------
    const button = document.createElement('button');
    button.className = 'mayuri-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Open Mayuri, the help menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'mayuri-panel');
    button.innerHTML = '<span class="mayuri-avatar">' + AVATAR + '</span>';

    const close = document.createElement('button');
    close.className = 'whatsapp-float-close mayuri-dismiss';
    close.type = 'button';
    close.setAttribute('aria-label', 'Hide Mayuri for this visit');
    close.textContent = '\u00d7';

    // The dismiss cross is positioned against the BUTTON, not the corner, so
    // it lands on the button's own edge instead of floating a button-height
    // away from the thing it closes.
    const dock = document.createElement('div');
    dock.className = 'mayuri-dock';
    dock.appendChild(button);
    dock.appendChild(close);

    // ---- open / close -----------------------------------------------------
    let open = false;

    function setOpen(next) {
      // Captured before the panel is hidden: hiding a focused element drops
      // focus to <body>, so by the time the refocus decision below runs the
      // answer to "was focus in here?" would already be gone.
      const hadFocus = wrap.contains(document.activeElement);
      /* Closing her cancels any pending redirect. Without this, asking to be
         taken somewhere and then shutting the panel still moved the page a
         couple of seconds later, with nothing on screen to explain why. */
      if (!next) cancelNavTimers();
      open = next;
      panel.hidden = !open;
      wrap.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        greet.classList.remove('is-visible');
        // Out of the accessibility tree too, not just faded — the panel's own
        // greeting is about to be read, and a stale live region underneath it
        // would be announced alongside.
        greet.hidden = true;
        // She has been met. This is what suppresses the hello on later pages.
        try { sessionStorage.setItem(GREETED_KEY, '1'); } catch (e) {}
        // Focus the panel itself rather than the first link: landing on a
        // route makes it look chosen, and a screen reader should hear the
        // greeting before the options it introduces.
        panel.setAttribute('tabindex', '-1');
        panel.focus();
      } else if (hadFocus) {
        // Same rule as the bg-settings popover: hand focus back to the button
        // only when closing took it from inside the wrap. A click-away lands
        // ON something — often a form field — and that click focuses its
        // target before the document handler closes the panel, so an
        // unconditional refocus here used to steal the caret mid-click and
        // feed the next keystrokes to the single-letter background shortcuts.
        // Closes from the panel's own controls, or Escape while focus is
        // inside, still restore focus to the button exactly as before.
        button.focus();
      }
    }

    // A hop on every press. Deliberately driven by a class that is removed
    // when the animation ends rather than on a timer: a second click during
    // the first hop then restarts it cleanly instead of doing nothing
    // because the class was still on.
    button.addEventListener('click', () => {
      if (!prefersReducedMotion && !dock.classList.contains('is-sad')) {
        dock.classList.remove('is-cheering');
        void dock.offsetWidth;            // restart the animation
        dock.classList.add('is-cheering');
      }
      setOpen(!open);
    });
    dock.addEventListener('animationend', () => {
      dock.classList.remove('is-cheering');
      dock.classList.remove('is-waving');
    });

    // A finished game run that set a new personal best. game-shell.js fires
    // this document-level event and knows nothing about who listens — she
    // reacts to the EVENT, not to the game, so the engine never learns the
    // site chrome exists. The cheer is exactly the tap cheer above — remove,
    // force a reflow, re-add — and the animationend handler above already
    // takes the class off. Guards, belt-and-braces as everywhere else in
    // this file: waHidden is the live dismissal flag (the ×, the `b`
    // shortcut and sessionStorage all feed it), and with it set she is off
    // screen with nobody to cheer at; prefersReducedMotion is re-checked at
    // fire time like every other motion callback here, even though the CSS
    // gates the hop keyframe too. The dock itself cannot be missing — it is
    // built unconditionally a few lines up in this same closure.
    document.addEventListener('ks:game-newbest', () => {
      /* Not while she is hurt. The CSS already refuses the grin and the hop,
         but a cheer she cannot perform should not be started either. */
      if (waHidden || prefersReducedMotion || dock.classList.contains('is-sad')) return;
      dock.classList.remove('is-cheering');
      void dock.offsetWidth;            // restart the animation
      dock.classList.add('is-cheering');
    });

    /* She looks around while she waits. Random intervals and random targets,
       not a keyframe loop: anything on a fixed cycle reads as a tic within
       about three repeats, and the whole point is that you cannot predict where
       she looks next. One write on the dock drives both copies of her, since
       the custom properties inherit down to each .mayuri-head. Skipped while
       the tab is hidden — nobody is watching, and it would keep a timer warm
       on a backgrounded page for nothing. */
    if (!prefersReducedMotion) {
      const glance = () => {
        // The flag is live, so re-check it per glance: if the OS switch flips
        // mid-visit she stops looking around. The timer keeps re-arming — one
        // idle setTimeout every few seconds is cheaper than teardown/rebuild
        // machinery for a setting that flips back just as easily.
        if (!document.hidden && !prefersReducedMotion) {
          const r = (n) => (Math.random() * n * 2 - n).toFixed(2);
          dock.style.setProperty('--look-x', r(1.7) + 'px');
          dock.style.setProperty('--look-y', r(1.2) + 'px');
          dock.style.setProperty('--look-r', r(4.5) + 'deg');
        }
        setTimeout(glance, 1500 + Math.random() * 2800);
      };
      setTimeout(glance, 1100);
    }
    panel.querySelector('.mayuri-panel-close').addEventListener('click', () => setOpen(false));

    /* ---- the chat ---------------------------------------------------------
       The brain lives in assets/js/mayuri-chat.js and the corpus it reads is a
       202 KB gzipped JSON. Neither is touched until somebody actually presses
       "Chat with me" — the same rule site-search.js follows for its own index,
       and the reason this feature costs nothing on a page nobody chats on.

       Everything written into the log goes in as textContent. The corpus is
       stripped of markup at build time and it is all Krunalkumar's own prose,
       so this is belt and braces rather than a live risk — but a panel that
       renders strings from a fetched file has no business using innerHTML, and
       the day someone adds a field to the index is not the day to discover
       that. */
    const menuView = panel.querySelector('.mayuri-menu');
    const chatView = panel.querySelector('.mayuri-chat');
    const chatLog = panel.querySelector('.mayuri-log');
    const chatForm = panel.querySelector('.mayuri-form');
    const chatInput = panel.querySelector('.mayuri-input');
    let brainState = 'idle';   // idle | loading | ready | failed

    /* How long she waits before moving the page. Short enough not to feel like
       a hang, long enough to read the line and press Cancel. One constant, so
       it is one edit if it should be longer. */
    const NAV_DELAY = 2500;
    /* Pending redirects, cancelled when she is closed — see setOpen. */
    const navTimers = [];
    function cancelNavTimers() {
      while (navTimers.length) clearTimeout(navTimers.pop());
    }

    function bubble(who, text) {
      const row = document.createElement('div');
      row.className = 'mayuri-msg is-' + who;
      const body = document.createElement('p');
      body.className = 'mayuri-msg-text';
      body.textContent = text;
      row.appendChild(body);
      chatLog.appendChild(row);
      chatLog.scrollTop = chatLog.scrollHeight;
      return row;
    }

    function addLinks(row, links) {
      if (!links || !links.length) return;
      const bar = document.createElement('div');
      bar.className = 'mayuri-msg-links';
      links.forEach((l) => {
        const a = document.createElement('a');
        a.className = 'mayuri-msg-link';
        a.href = l.href;
        a.textContent = l.label;
        bar.appendChild(a);
      });
      row.appendChild(bar);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    /* Suggested follow-ups. They are buttons rather than links because they
       ask the next question here instead of navigating away — which is the
       whole point of the glossary's cross-references being in the index. */
    function addChips(row, chips) {
      if (!chips || !chips.length) return;
      const bar = document.createElement('div');
      bar.className = 'mayuri-msg-chips';
      chips.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mayuri-chip';
        b.textContent = c;
        b.addEventListener('click', () => { chatInput.value = c; submitQuestion(); });
        bar.appendChild(b);
      });
      row.appendChild(bar);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    /* The fallback, and the reason the whole thing is honest. When she has
       nothing, she says so and puts a person one tap away — she never
       guesses. On a security consultant's site a confident wrong answer costs
       more than an admission. */
    function addBossOffer(row, label) {
      const bar = document.createElement('div');
      bar.className = 'mayuri-msg-links';
      const a = document.createElement('a');
      a.className = 'mayuri-msg-link is-boss';
      a.href = WA_HREF;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label || 'Message my boss directly';
      bar.appendChild(a);
      /* On a lab or game page the report form is a better destination than a
         generic contact link, and `own` is the page's own statement of which
         one it is — the same value the four old routes used. */
      if (own) {
        const r = document.createElement('a');
        r.className = 'mayuri-msg-link';
        r.href = own;
        r.textContent = ownIsGame ? 'Report something about this game' : 'Report something about this lab';
        bar.appendChild(r);
      }
      row.appendChild(bar);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    /* She thinks before she speaks.
       ------------------------------------------------------------------------
       Retrieval is effectively instant — a linear pass over 1,723 entries is
       under a millisecond — and an answer that appears in the same frame as
       the question reads as a lookup table rather than a reply. The pause is
       not fake work; it is the beat that makes a conversation legible, and it
       also stops a long answer from landing before the eye has left the input.

       Scaled by answer length and clamped: a one-line definition should not
       sit behind the same wait as a paragraph, and nothing should wait longer
       than about a second. Under prefers-reduced-motion the dots do not bounce
       — but the pause stays, because the pause is pacing, not animation, and a
       reply with no indicator at all would look like a dropped message. */
    function typeThen(textLen, done) {
      const row = document.createElement('div');
      row.className = 'mayuri-msg is-bot';
      const bub = document.createElement('p');
      bub.className = 'mayuri-msg-text mayuri-typing';
      if (prefersReducedMotion) {
        bub.classList.add('is-static');
        bub.textContent = 'Typing…';
      } else {
        /* A static literal, never anything from the corpus. */
        bub.innerHTML = '<i></i><i></i><i></i>';
      }
      /* Hidden from assistive tech: the answer itself lands in the same polite
         live region a moment later, and announcing "typing" before every reply
         is noise rather than information. */
      row.setAttribute('aria-hidden', 'true');
      row.appendChild(bub);
      chatLog.appendChild(row);
      chatLog.scrollTop = chatLog.scrollHeight;
      const wait = Math.min(1150, Math.max(420, 320 + textLen * 5));
      setTimeout(() => { row.remove(); done(); }, wait);
    }

    /* Locked. The input STAYS — that is the whole point, since an apology has
       to be typeable — but the placeholder becomes the instruction and the
       door on the menu is marked. Hiding the field would have made the
       apology impossible and the lock permanent.

       Session-scoped by construction: the engine's flag lives in a closure
       that dies with the page, so a reload is a clean slate. Deliberate — see
       the note on ABUSE in mayuri-chat.js for the trade being made.

       The two doors get different treatment, and only one of them changes: the
       route to a human is never taken away. Somebody who has been rude to an
       assistant may still have a legitimate reason to reach Krunalkumar, and
       that is his call to make, not this widget's. */
    /* The face is its own state, separate from the lock, because the two do not
       coincide: she is hurt from the FIRST warning, while the chat is still
       open. Tying the expression to the lock left her smiling politely through
       the warning, which made the warning look like a formality.

       On the WRAP as well as the dock: she is drawn twice — the corner button
       and the panel header — and the panel is a sibling of the dock, not a
       child, so a dock-only class left the big face you are actually looking at
       still smiling while she refused to talk. The dock keeps its own copy
       because the animation kill and the dance guard are scoped to it. */
    /* Three moods, one function, so the states cannot overlap: setting one
       clears the others by construction rather than by remembering to.
       'unhappy' is the first warning — spoken to rudely once and saying so —
       and 'sad' is the lock. */
    function setMood(mood) {
      const sad = mood === 'sad';
      const unhappy = mood === 'unhappy';
      wrap.classList.toggle('is-sad', sad);
      wrap.classList.toggle('is-unhappy', unhappy);
      dock.classList.toggle('is-sad', sad);
      dock.classList.toggle('is-unhappy', unhappy);
      if (sad || unhappy) {
        dock.classList.remove('is-cheering');
        dock.classList.remove('is-waving');
        dock.classList.remove('is-dancing');
      }
    }

    function setLocked(on) {
      const door = panel.querySelector('.mayuri-route-chat');
      const note = panel.querySelector('.mayuri-route-note');
      if (on) setMood('sad');
      door.classList.toggle('is-locked', on);
      /* aria-disabled, NOT the disabled attribute: a disabled button cannot be
         clicked or focused, and clicking it is exactly how somebody gets back
         to the field to apologise. It reads as unavailable and still works. */
      door.setAttribute('aria-disabled', on ? 'true' : 'false');
      note.textContent = on ? 'Apologise to carry on' : 'Ask me anything';
      chatInput.placeholder = on
        ? 'Type sorry here to continue chatting with me'
        : 'Ask me anything about this site…';
      panel.querySelector('.mayuri-chat-reset').hidden = on;
    }

    function answer(r) {
      if (r.kind === 'empty') return;
      if (r.kind === 'abuse' || r.kind === 'abuse-lock' || r.kind === 'locked') {
        /* The warning sets the face without setting the lock — she is hurt but
           still listening, which is what a warning means. */
        if (r.sad === true) setMood(r.locked ? 'sad' : 'unhappy');
        const row = bubble('bot', r.text);
        if (r.locked) { setLocked(true); if (r.kind === 'abuse-lock') addBossOffer(row); }
        return;
      }
      if (r.kind === 'forgiven') {
        setLocked(false);
        setMood('normal');
        const row = bubble('bot', r.text);
        addChips(row, r.chips);
        return;
      }
      /* Said goodbye. She answers, then shows herself out — the pause is long
         enough to read the line and short enough not to feel like a hang. The
         conversation is discarded rather than parked, so opening her again is
         a clean start: somebody who ended a conversation and comes back later
         is starting a new one, and being handed yesterday's transcript is
         both odd and a small privacy leak on a shared machine. */
      if (r.kind === 'farewell') {
        bubble('bot', r.text);
        setTimeout(() => {
          setOpen(false);
          chatLog.textContent = '';
          chatStarted = false;
          leaveChat();
          if (window.MayuriChat) window.MayuriChat.reset();
        }, 1900);
        return;
      }
      /* Asked to be taken somewhere, so go — she does not hand over a button
         and wait to be pressed. The pause is long enough to read the sentence
         and to change your mind, and Cancel is there because a chat window
         that moves the page out from under you with no way to stop it is a
         trap, not a convenience.

         location.assign rather than replace: the back button must still work,
         or she has quietly eaten the visitor's history. */
      if (r.kind === 'navigate' && r.url) {
        const row = bubble('bot', r.text);
        const bar = document.createElement('div');
        bar.className = 'mayuri-msg-links';
        const stay = document.createElement('button');
        stay.type = 'button';
        stay.className = 'mayuri-chip';
        stay.textContent = 'Cancel, stay here';
        const now = document.createElement('a');
        now.className = 'mayuri-msg-link';
        now.href = r.url;
        now.textContent = 'Go now';
        bar.appendChild(now);
        bar.appendChild(stay);
        row.appendChild(bar);
        chatLog.scrollTop = chatLog.scrollHeight;

        const trip = setTimeout(() => { window.location.assign(r.url); }, NAV_DELAY);
        stay.addEventListener('click', () => {
          clearTimeout(trip);
          stay.disabled = true;
          stay.textContent = 'Staying here';
          bubble('bot', 'Of course — we will stay. What else can I help with?');
        });
        /* Closing her is also a change of mind: a timer that fires after the
           panel is gone would move the page for no visible reason. */
        navTimers.push(trip);
        return;
      }
      if (r.confident) {
        const row = bubble('bot', (r.title ? r.title + ' — ' : '') + r.text);
        addLinks(row, r.links);
        if (r.offerBoss) addBossOffer(row, 'Ask Krunalkumar directly');
        addChips(row, r.chips);
        return;
      }
      /* Two shades of "no", because they are different situations and telling
         them apart is most of being useful: "close, but I am not sure" still
         has pages worth offering, while "I genuinely do not have this" should
         not pretend otherwise. Both end at the same place — a person — because
         that is the honest end of a retrieval system's competence.

         NEITHER MENTIONS HOW SHE WORKS. These used to say the question was
         "outside what Krunalkumar has written here", which is true and is also
         not how an assistant talks: it explains her own machinery to somebody
         who asked about a subject, and it quietly blames the boss for not
         having written enough. An assistant says she does not have the
         information and fetches someone who does. */
      const row = bubble('bot',
        r.kind === 'weak'
          ? 'I am not sure I have the right answer for that. These are the closest things I can find — ' +
            'or I can pass you to my boss and you can ask him directly.'
          : 'I do not have this information, sorry. Let me redirect you to my boss — ' +
            'you can ask him directly and he will know.');
      addLinks(row, r.links);
      addBossOffer(row);
    }

    /* Ask, then show the answer after the pause. The lookup happens first and
       the result is held — computing it after the timer would make the wait a
       floor on top of the work rather than the whole of it, and would leave
       the door open to a slow frame landing the reply late. */
    function answerAfterPause(r) {
      if (r.kind === 'empty') return;
      typeThen(String(r.text || '').length, () => answer(r));
    }

    function submitQuestion() {
      const q = chatInput.value.trim();
      if (!q) return;
      bubble('me', q);
      chatInput.value = '';
      if (brainState === 'ready') { answerAfterPause(window.MayuriChat.ask(q)); return; }
      if (brainState === 'failed') {
        typeThen(90, () => {
          const row = bubble('bot', 'I could not load what I know — the connection dropped. Krunalkumar is still reachable.');
          addBossOffer(row);
        });
        return;
      }
      /* Asked while the corpus is still downloading: hold the question and
         answer it the moment the index lands, rather than dropping it or
         making them ask twice. */
      const waiting = bubble('bot', 'One moment — reading what I know…');
      loadBrain().then(() => {
        waiting.remove();
        /* No second pause here: the corpus download was the wait, and adding
           the conversational beat on top of it would read as a stall. */
        answer(window.MayuriChat.ask(q));
      }).catch(() => {
        waiting.remove();
        const row = bubble('bot', 'I could not load what I know. Krunalkumar is still reachable.');
        addBossOffer(row);
      });
    }

    let brainPromise = null;
    function loadBrain() {
      if (brainPromise) return brainPromise;
      brainState = 'loading';
      brainPromise = new Promise((resolve, reject) => {
        if (window.MayuriChat) { resolve(); return; }
        const s = document.createElement('script');
        s.src = '/assets/js/mayuri-chat.js';
        s.onload = () => (window.MayuriChat ? resolve() : reject(new Error('no MayuriChat')));
        s.onerror = () => reject(new Error('script failed'));
        document.head.appendChild(s);
      })
        .then(() => window.MayuriChat.load())
        .then(() => { brainState = 'ready'; })
        .catch((e) => {
          brainState = 'failed';
          /* Cleared so a later question retries instead of inheriting a
             rejected promise for the rest of the visit. */
          brainPromise = null;
          throw e;
        });
      return brainPromise;
    }

    /* Two bubbles, not one. The warm line and the offer of help are what a
       person says first; the caveat about where her answers come from is
       useful but it is not a greeting, and bolting it onto "good afternoon"
       made the opening read as terms and conditions. So she says hello, and
       the small print sits underneath in its own quieter line.

       The time of day comes from MayuriChat when it has loaded — which it
       usually has not yet, since the corpus download starts in the same
       breath — so there is a local copy of the same rule for the first paint.
       Same four bands; if you change one, change both. */
    function localDaypart() {
      const h = new Date().getHours();
      if (h < 5) return 'Hello';
      if (h < 12) return 'Good morning';
      if (h < 17) return 'Good afternoon';
      if (h < 22) return 'Good evening';
      return 'Hello';
    }

    function greetInChat() {
      const hello = (window.MayuriChat && window.MayuriChat.greeting)
        ? window.MayuriChat.greeting()
        : localDaypart() + '! I am Mayuri, Krunalkumar’s assistant. How can I help you today?';
      bubble('bot', hello);
      const row = bubble('bot',
        'Ask me about his work, the labs and games, or anything on this site. ' +
        'If I do not have the answer, I will pass you straight to him.');
      addChips(row, ['What is a fork bomb?', 'Do you offer internships?', 'What does Krunalkumar do?']);
    }

    let chatStarted = false;
    function enterChat() {
      menuView.hidden = true;
      chatView.hidden = false;
      panel.classList.add('is-chatting');
      if (!chatStarted) {
        chatStarted = true;
        /* Opening for the first time with an offence already on record — a
           previous visit, closed without apologising. She does not pretend it
           did not happen and she does not re-greet warmly; she says where
           things stand and what clears it. */
        if (panel.querySelector('.mayuri-route-chat').classList.contains('is-locked')) {
          bubble('bot',
            'Hello again. You were abusive to me last time, so I am not able to chat. ' +
            'Say sorry and we can carry on.');
        } else {
          greetInChat();
        }
        loadBrain().catch(() => {});
      } else if (window.MayuriChat && window.MayuriChat.isLocked && window.MayuriChat.isLocked()) {
        /* Came back through a locked door mid-visit. Say the one thing there is
           to say rather than re-greeting as though nothing happened. */
        bubble('bot', 'Type sorry here to continue chatting with me.');
      }
      /* Focus the field, not the panel: unlike the old menu — where landing on
         a route made it look chosen — the only thing to do here IS type. */
      chatInput.focus();
    }

    /* Back keeps the conversation and returns to the two doors; Start over
       throws the conversation away. Two controls because they are two
       different wishes — "I actually wanted the other button" and "forget all
       that, let me begin again" — and one control doing both would silently
       destroy a conversation somebody only meant to step out of. */
    function leaveChat() {
      chatView.hidden = true;
      menuView.hidden = false;
      panel.classList.remove('is-chatting');
      panel.querySelector('.mayuri-route-chat').focus();
    }

    function startOver() {
      chatLog.textContent = '';
      chatInput.value = '';
      /* The engine's one-slot topic memory has to go too, or the first
         question after a reset could still be resolved against the topic of
         the conversation that was just discarded. */
      if (window.MayuriChat) window.MayuriChat.reset();
      greetInChat();
      chatInput.focus();
    }

    panel.querySelector('.mayuri-route-chat').addEventListener('click', enterChat);
    panel.querySelector('.mayuri-chat-back').addEventListener('click', leaveChat);
    panel.querySelector('.mayuri-chat-reset').addEventListener('click', startOver);

    /* The conduct record is read HERE as well as in mayuri-chat.js, and the
       duplicated key name is deliberate. The brain is not loaded until
       somebody presses "Chat with me", so asking it would mean she looked
       perfectly cheerful on arrival and only remembered being sworn at once
       the chat opened — which is the wrong way round. This costs one
       localStorage read on page load and lets the face be right immediately.

       'mayuriConduct' must match CONDUCT_KEY in mayuri-chat.js. That file owns
       the rule and the writing; this is a read-only glance so the corner looks
       correct before the rule has loaded. */
    (function () {
      let recorded = null;
      try { recorded = localStorage.getItem('mayuriConduct'); } catch (e) { recorded = null; }
      const n = parseInt(recorded, 10);
      if (isFinite(n) && n > 0) setLocked(true);
    })();
    chatForm.addEventListener('submit', (e) => { e.preventDefault(); submitQuestion(); });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && open) setOpen(false);
    });

    /* Click-away, and NOT while a conversation is open. Checked against the
       whole wrap so a click on the button or inside the panel does not
       immediately close what it just opened.

       A menu should close when you click past it — that is what a menu is. A
       conversation should not: half a typed question and three answers worth
       reading are destroyed by one stray click on the page behind, and the
       page behind is full of things worth clicking. So the click-away holds
       for the two-door menu and stops applying the moment the chat is open,
       which leaves the × as the way out — plus Escape, which stays because it
       is a deliberate keypress rather than a slip, and because a dialog that
       swallows Escape is a dialog a keyboard cannot leave. */
    document.addEventListener('click', (event) => {
      if (!open || panel.classList.contains('is-chatting')) return;
      if (!wrap.contains(event.target)) setOpen(false);
    });

    // ---- dismissal, unchanged from the bubble this replaced ---------------
    function setWhatsappHidden(next) {
      waHidden = next;
      document.body.classList.toggle('wa-dismissed', waHidden);
      if (waHidden && open) setOpen(false);
      try {
        if (waHidden) {
          sessionStorage.setItem(WA_DISMISSED_KEY, '1');
        } else {
          sessionStorage.removeItem(WA_DISMISSED_KEY);
        }
      } catch (e) { /* storage unavailable — the choice lasts this page only */ }
    }

    close.addEventListener('click', () => {
      // The cross sits inside the wrap it is about to hide, so a keyboard
      // activation would otherwise drop focus onto <body> and the next Tab
      // would restart from the top of the page. Focus goes to the back-to-top
      // button when it is visible — it inherits this very corner once the
      // bubble is gone, so it is the nearest thing to "where you already
      // were" — and is otherwise just blurred, so focus lands on <body> by
      // choice rather than by the accident of display:none. Checked before
      // hiding, because hiding is what destroys the answer.
      if (wrap.contains(document.activeElement)) {
        if (backToTopButton.classList.contains('visible')) {
          backToTopButton.focus();
        } else if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
      }
      setWhatsappHidden(true);
    });

    // Handed to the `b` shortcut up in the canvas block, which runs earlier in
    // this file than the corner is built. Returns the new state so the caller
    // can say which way it went without reaching back in here.
    toggleWhatsappBubble = function () {
      setWhatsappHidden(!waHidden);
      return waHidden;
    };

    wrap.appendChild(greet);
    wrap.appendChild(panel);
    wrap.appendChild(dock);
    document.body.appendChild(wrap);
    setWhatsappHidden(waHidden);

    /* The hello, on every page load, five seconds, then gone. It used to be
       once a session, and the flag was written the moment it APPEARED - so a
       visitor who arrived on any page but the one they landed on first never
       saw it at all, and it looked like a feature that did not work.

       The flag still exists, but it is now set when she is OPENED, not when
       she says hello: somebody who has already met her does not need
       introducing again, and somebody who has not gets introduced wherever
       they came in. Skipped entirely under prefers-reduced-motion, since it
       slides in, and something that moves in a corner unasked is exactly what
       that setting is about. */
    if (!waHidden && !prefersReducedMotion) {
      let met = false;
      try {
        met = sessionStorage.getItem(GREETED_KEY) === '1';
      } catch (e) { met = false; }
      if (!met) {
        setTimeout(() => {
          // prefersReducedMotion is re-checked at fire time: the OS switch can
          // flip during the 1.6s delay, and a greeting that slides in is
          // exactly what it forbids.
          //
          // And no cheery hello for somebody who left without apologising.
          // "Hi, I am Mayuri!" waving in beside a sad face, from a character
          // who will refuse to speak the moment she is asked anything, is the
          // worst of both — she is either upset or she is not. Sad face,
          // nothing else. Re-read here rather than captured because the class
          // can be cleared by an apology inside this same 1.6s window.
          if (waHidden || open || prefersReducedMotion) return;
          if (wrap.classList.contains('is-sad')) return;
          dock.classList.add('is-waving');
          // Unhide BEFORE the visible class goes on: the role=status live
          // region announces content that appears inside it, and content
          // revealed by dropping [hidden] is what registers as appearing.
          // Outside this window the element carries [hidden], so the hello
          // only ever exists in the accessibility tree while it is genuinely
          // on screen.
          greet.hidden = false;
          greet.classList.add('is-visible');
          setTimeout(() => {
            greet.classList.remove('is-visible');
            // Safe to hide in the same tick: the 5s mayuri-greet-pop keyframe
            // ends at opacity 0 exactly as this timer fires, so there is no
            // fade left to cut off.
            greet.hidden = true;
          }, 5000);
        }, 1600);
      }
    }
  }

  window.addEventListener('scroll', () => {
    if (window.scrollY > 420) {
      backToTopButton.classList.add('visible');
    } else {
      backToTopButton.classList.remove('visible');
    }
  });

  // Conversion tracking: report high-intent clicks to Google Analytics.
  // Event delegation covers links anywhere on the page, including the
  // runtime-injected header/footer.
  document.addEventListener('click', (event) => {
    if (typeof gtag !== 'function') return;
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.href || '';
    // Blog share links must be checked first: the WhatsApp share target is a
    // wa.me URL, and the branch below would otherwise book it as an inbound
    // whatsapp_link_click — inflating a contact conversion with a share.
    const shareNetwork = link.getAttribute('data-share');
    if (shareNetwork) {
      gtag('event', 'article_share', { method: shareNetwork });
      return;
    }
    if (href.includes('calendar.app.google')) {
      gtag('event', 'book_call_click');
    } else if (href.startsWith('mailto:')) {
      gtag('event', 'email_click');
    } else if (href.includes('wa.me')) {
      gtag('event', 'whatsapp_link_click');
    } else if (href.includes('Krunalkumar-Shah-Resume.pdf')) {
      gtag('event', 'resume_download');
    } else if (href.includes('.pdf')) {
      // Any other PDF (currently the IJRAT research paper) — kept separate so
      // paper downloads can never inflate the resume conversion metric.
      gtag('event', 'pdf_download');
    }
  });

  // Header and footer are injected at runtime by assets/js/include-partials.js,
  // so everything that touches them initializes after 'partials:loaded' fires.
  function initSiteChrome() {
    // The brand name is a fixed colour in CSS and nothing here touches it.
    // This used to set --brand-hue to Math.random() * 360 on every page load,
    // which is why the wordmark was lime on one visit and olive on the next
    // and only rarely the sky blue the rest of the palette is built from. A
    // brand colour picked at random is not a brand colour; see the masthead
    // block in main.css for what replaced the gradient.
    const brand = document.querySelector('.brand');

    // 🥚 Six quick taps on the homepage portrait light the masthead up: the
    // keylines either side of the name start glowing and streaming, and the
    // cursor in the ks_ mark blinks through colours. That is the whole egg.
    // The NAME ITSELF DOES NOT MOVE — an earlier version wiggled the lockup
    // and a tilting header just looks broken. Six more taps calm it down.
    // Deliberately stores nothing (unlike the background controls): a reload
    // always resets it, like a wink should.
    //
    // IT IS ALL CSS NOW. This used to run a 260ms interval that threw
    // firecracker sparks over the header and jumped a --brand-hue at random;
    // both are gone, and with them the last timer. What is left is a class
    // toggle, so there is nothing to tick, nothing to clean up, and no way for
    // the egg to leak work into a backgrounded tab — the sparks needed a
    // document.hidden guard precisely because a hidden tab fires timers but
    // never completes animations, so their animationend cleanup never ran and
    // they piled up unbounded. Turning it off costs nothing but removing a
    // class. (.fx-spark and its keyframes stay in main.css: verify.js has its
    // own copy of that burst for the certificate celebration.)
    //
    // Skipped entirely under prefers-reduced-motion — this is the only guard
    // for it, so the CSS carries none of its own: not binding the handler
    // means .brand-dancing is never set and none of those rules can apply.
    const heroPortrait = document.querySelector('.hero-card img[src*="Krunal"]');
    if (brand && heroPortrait && !prefersReducedMotion) {
      let taps = 0;
      let lastTap = 0;
      let dancing = false;
      let reported = false;

      function setDancing(next) {
        dancing = next;
        brand.classList.toggle('brand-dancing', dancing);
        // Mayuri dances too — queried at toggle time rather than captured,
        // because her widget is built in a different closure and may have been
        // dismissed (no dock, nothing to do). The egg is already skipped
        // entirely under prefers-reduced-motion, and the CSS block guards the
        // animation besides, so this needs no motion check of its own.
        const mayuriDock = document.querySelector('.mayuri-dock');
        /* She sits this one out if she has been abused. The masthead egg still
           fires — the keylines and the cursor are the wordmark's business, not
           hers — but she takes no part in it: dancing while refusing to speak
           to somebody would read as not having minded. The class is withheld
           rather than only styled away so nothing else keyed to is-dancing can
           bring her along either. */
        if (mayuriDock && !mayuriDock.classList.contains('is-sad')) {
          mayuriDock.classList.toggle('is-dancing', dancing);
        } else if (mayuriDock) {
          mayuriDock.classList.remove('is-dancing');
        }
        if (dancing && !reported) {
          reported = true;
          if (typeof gtag === 'function') gtag('event', 'easter_egg_dance');
        }
      }

      heroPortrait.addEventListener('click', () => {
        const now = performance.now();
        // A pause over 1.5s restarts the count — the egg answers deliberate
        // tapping, not six stray clicks spread across a whole visit.
        taps = now - lastTap > 1500 ? 1 : taps + 1;
        lastTap = now;
        if (taps < 6) return;
        taps = 0;
        setDancing(!dancing);
      });
    }

    // Target only the year span — the rest of the copyright line is static text.
    document.querySelectorAll('.footer-bottom .copyright-year').forEach((element) => {
      element.textContent = new Date().getFullYear();
    });

    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-list');
    const navDropdown = document.querySelector('.nav-dropdown');
    const navDropdownToggle = navDropdown ? navDropdown.querySelector('.nav-dropdown-toggle') : null;
    const navDropdownMenu = navDropdown ? navDropdown.querySelector('.nav-dropdown-menu') : null;
    const navLinks = navMenu ? Array.from(navMenu.querySelectorAll('.nav-link')) : [];
    const mobileNavQuery = window.matchMedia('(max-width: 640px)');

    function closeMobileMenu() {
      if (!navToggle || !navMenu) return;
      navMenu.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.setAttribute('aria-label', 'Open navigation menu');
    }

    function closeDropdown() {
      if (!navDropdown || !navDropdownToggle) return;
      navDropdown.classList.remove('open');
      navDropdownToggle.setAttribute('aria-expanded', 'false');
    }

    if (navToggle && navMenu) {
      navToggle.addEventListener('click', () => {
        const isOpen = navMenu.classList.toggle('open');
        navToggle.classList.toggle('open', isOpen);
        navToggle.setAttribute('aria-expanded', String(isOpen));
        navToggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
      });

      navMenu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', closeMobileMenu);
      });
    }

    if (navDropdown && navDropdownToggle) {
      navDropdownToggle.addEventListener('click', () => {
        const isOpen = navDropdown.classList.toggle('open');
        navDropdownToggle.setAttribute('aria-expanded', String(isOpen));
      });

      // Close the More menu when keyboard focus tabs out of it, matching the
      // outside-click behavior pointer users get.
      navDropdown.addEventListener('focusout', () => {
        requestAnimationFrame(() => {
          if (!navDropdown.contains(document.activeElement)) closeDropdown();
        });
      });
    }

    function navRequiredWidth() {
      const gap = parseFloat(window.getComputedStyle(navMenu).columnGap) || 0;
      const items = Array.from(navMenu.children).filter((item) => !item.hidden);
      const width = items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0);
      return width + gap * Math.max(0, items.length - 1);
    }

    let lastNavContext = null;

    function navContext() {
      return navMenu.clientWidth + '|' + mobileNavQuery.matches;
    }

    function updateNavOverflow() {
      lastNavContext = navContext();
      closeDropdown();

      navLinks.forEach((link) => navMenu.insertBefore(link, navDropdown));
      navDropdown.hidden = true;

      if (!mobileNavQuery.matches && navRequiredWidth() > navMenu.clientWidth + 1) {
        navDropdown.hidden = false;
        for (let i = navLinks.length - 1; i > 0 && navRequiredWidth() > navMenu.clientWidth + 1; i -= 1) {
          navDropdownMenu.insertBefore(navLinks[i], navDropdownMenu.firstChild);
        }
      }

      navDropdown.classList.toggle('has-active', Boolean(navDropdownMenu.querySelector('.nav-link.active')));
    }

    if (navMenu && navDropdown && navDropdownMenu && navLinks.length) {
      navMenu.classList.add('priority-nav');
      updateNavOverflow();

      let navOverflowFrame = null;
      const scheduleNavOverflowUpdate = () => {
        if (navOverflowFrame) {
          cancelAnimationFrame(navOverflowFrame);
        }
        navOverflowFrame = requestAnimationFrame(() => {
          if (navContext() !== lastNavContext) {
            updateNavOverflow();
          }
        });
      };

      window.addEventListener('resize', scheduleNavOverflowUpdate);
      if (typeof ResizeObserver === 'function') {
        new ResizeObserver(scheduleNavOverflowUpdate).observe(navMenu);
      }

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(updateNavOverflow);
      }
    }

    document.addEventListener('click', (event) => {
      if (navDropdown && navDropdown.classList.contains('open') && !navDropdown.contains(event.target)) {
        closeDropdown();
      }
      if (navMenu && navMenu.classList.contains('open') && !event.target.closest('.nav')) {
        closeMobileMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // Closing a menu that contains the focused element would drop focus to
      // <body>; hand it back to the toggle that opened the menu instead.
      const dropdownHadFocus = navDropdown && navDropdown.classList.contains('open') && navDropdown.contains(document.activeElement);
      const menuHadFocus = navMenu && navMenu.classList.contains('open') && navMenu.contains(document.activeElement);
      closeDropdown();
      closeMobileMenu();
      if (dropdownHadFocus && navDropdownToggle) {
        navDropdownToggle.focus();
      } else if (menuHadFocus && navToggle) {
        navToggle.focus();
      }
    });
  }
}());

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A hint for fellow console-openers. The terminal itself lives at /terminal.
console.log('%c👀 curiosity opens consoles… it also opens /terminal', 'font-size:11px;font-style:italic;color:#7dd3fc;');
console.log('%c⌨️  press . for the background controls — or run `magic` in /terminal', 'font-size:11px;font-style:italic;color:#7dd3fc;');

// Assigned when the WhatsApp bubble is built near the bottom of this file. The
// `w` shortcut belongs with the other background keys, which are wired up in
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

  function spawnParticle() {
    // Direction is seeded randomly, then steered by the drift force and the
    // cursor. Magnitude is a per-particle constant so the field keeps a
    // varied, organic pace instead of every dot moving in lockstep — see
    // the speed handling in drawFrame.
    const angle = Math.random() * Math.PI * 2;
    const cruise = Math.random() * 0.2 + 0.18;
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * cruise,
      vy: Math.sin(angle) * cruise,
      cruise,
      radius: Math.random() * 1.5 + 0.4,
      alpha: Math.random() * 0.7 + 0.2,
      hue: 180 + Math.random() * 80,
      drift: Math.random() * 0.01 + 0.005,
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
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
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
      ctx.fillStyle = `hsla(${particle.hue}, 90%, 75%, ${particle.alpha})`;
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
      ? 'k / s dots · w chat bubble'
      : 'k / s dots · l / a speed · p pause · w chat bubble') + '</p>';

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
  const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

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
      case 'w': {
        // Null only if the bubble was never built — it always is, but this
        // handler is wired before that code runs, so guard rather than assume.
        if (!toggleWhatsappBubble) return;
        const hidden = toggleWhatsappBubble();
        showToast(hidden ? 'WhatsApp hidden' : 'WhatsApp shown');
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
  document.body.appendChild(panel);
  document.body.appendChild(settingsToggle);
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

// Floating WhatsApp chat bubble — opens a real conversation, no bot in between.
// Hideable two ways: the × on the bubble, and the `w` background shortcut,
// which unlike the × can also bring it back. Either way the back-to-top button
// drops down to take its corner, and the choice lasts the visit — the bubble
// returns once the tab is closed and the site is opened fresh. sessionStorage
// access is wrapped in try/catch because private modes can block storage.
// The global click listener below reports bubble clicks as whatsapp_link_click.
{
  const WA_DISMISSED_KEY = 'waFloatDismissed';
  let waHidden = false;
  try {
    waHidden = sessionStorage.getItem(WA_DISMISSED_KEY) === '1';
  } catch (e) { /* storage unavailable — fall back to per-page dismissal */ }

  // Always built, then hidden by a class when dismissed. The previous version
  // removed the node outright, which a toggle cannot undo without rebuilding
  // it; the stylesheet's display:none keeps it out of the tab order just as
  // removal did.
  {
    const whatsappWrap = document.createElement('div');
    whatsappWrap.className = 'whatsapp-float-wrap';

    const whatsappFloat = document.createElement('a');
    whatsappFloat.className = 'whatsapp-float';
    whatsappFloat.href = 'https://wa.me/918200713617?text=' +
      encodeURIComponent('Hello Krunalkumar, I am on your website and have a question.');
    whatsappFloat.target = '_blank';
    whatsappFloat.rel = 'noopener';
    whatsappFloat.setAttribute('aria-label', 'Chat with Krunalkumar on WhatsApp');
    whatsappFloat.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>';

    const whatsappClose = document.createElement('button');
    whatsappClose.className = 'whatsapp-float-close';
    whatsappClose.type = 'button';
    whatsappClose.setAttribute('aria-label', 'Hide the WhatsApp chat button');
    whatsappClose.textContent = '×';
    function setWhatsappHidden(next) {
      waHidden = next;
      document.body.classList.toggle('wa-dismissed', waHidden);
      try {
        if (waHidden) {
          sessionStorage.setItem(WA_DISMISSED_KEY, '1');
        } else {
          sessionStorage.removeItem(WA_DISMISSED_KEY);
        }
      } catch (e) { /* storage unavailable — the choice lasts this page only */ }
    }

    whatsappClose.addEventListener('click', () => setWhatsappHidden(true));

    // Handed to the `w` shortcut up in the canvas block, which runs earlier in
    // this file than the bubble is built. Returns the new state so the caller
    // can say which way it went without reaching back in here.
    toggleWhatsappBubble = function () {
      setWhatsappHidden(!waHidden);
      return waHidden;
    };

    whatsappWrap.appendChild(whatsappFloat);
    whatsappWrap.appendChild(whatsappClose);
    document.body.appendChild(whatsappWrap);
    setWhatsappHidden(waHidden);
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
  // Fresh gradient color for the brand name on every page load.
  const brand = document.querySelector('.brand');
  if (brand) {
    brand.style.setProperty('--brand-hue', Math.floor(Math.random() * 360));
  }

  // 🥚 Six quick taps on the homepage portrait put the brand name into dance
  // mode: the gradient bounces direction, the hue jumps at random, the name
  // wiggles, and firecracker sparks burst around it. Six more taps calm it
  // down. Deliberately stores nothing (unlike the background controls): a
  // reload always resets it, like a wink should. Skipped entirely under
  // prefers-reduced-motion — a party trick must never override that choice.
  const heroPortrait = document.querySelector('.hero-card img[src*="Krunal"]');
  if (brand && heroPortrait && !prefersReducedMotion) {
    const SPARK_COLORS = ['#7dd3fc', '#a855f7', '#4ade80', '#fbbf24', '#f87171', '#f8fafc'];
    let taps = 0;
    let lastTap = 0;
    let dancing = false;
    let danceTimer = null;
    let reported = false;

    function throwSparks() {
      // Rect is re-read every burst so sparks track the sticky header as the
      // page scrolls (position: fixed shares the viewport coordinate space).
      //
      // Skip while the tab is hidden: a background tab still fires the timer
      // but never completes CSS animations, so the animationend cleanup below
      // never runs and the sparks would pile up unbounded until the tab is
      // seen again. No sparks are visible there anyway.
      if (document.hidden) return;
      const rect = brand.getBoundingClientRect();
      for (let i = 0; i < 4; i += 1) {
        const spark = document.createElement('span');
        spark.className = 'fx-spark';
        spark.style.background = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
        spark.style.left = (rect.left + Math.random() * rect.width) + 'px';
        spark.style.top = (rect.top + Math.random() * rect.height) + 'px';
        const angle = Math.random() * Math.PI * 2;
        const distance = 30 + Math.random() * 70;
        // Slight upward bias: firecrackers pop up more than they fall.
        spark.style.setProperty('--dx', (Math.cos(angle) * distance) + 'px');
        spark.style.setProperty('--dy', (Math.sin(angle) * distance - 24) + 'px');
        spark.addEventListener('animationend', () => spark.remove());
        document.body.appendChild(spark);
      }
    }

    function setDancing(next) {
      dancing = next;
      brand.classList.toggle('brand-dancing', dancing);
      if (dancing) {
        // Random hue jumps, out of step with the CSS hue spin, so the colors
        // never settle into a predictable sweep.
        danceTimer = setInterval(() => {
          brand.style.setProperty('--brand-hue', Math.floor(Math.random() * 360));
          throwSparks();
        }, 260);
        if (!reported) {
          reported = true;
          if (typeof gtag === 'function') gtag('event', 'easter_egg_dance');
        }
      } else {
        clearInterval(danceTimer);
        danceTimer = null;
        // Leave the name on a fresh random hue as a parting souvenir.
        brand.style.setProperty('--brand-hue', Math.floor(Math.random() * 360));
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

// Every page ships a static header (.noscript-header) that include-partials.js
// swaps for the canonical partial — wiring the chrome against the static copy
// would be thrown away in the swap. Initialize on the injected header; only
// when no swap is pending (partial already in place) run immediately.
if (document.querySelector('.site-header:not(.noscript-header)')) {
  initSiteChrome();
} else {
  document.addEventListener('partials:loaded', initSiteChrome, { once: true });
}

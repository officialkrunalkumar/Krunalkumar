/* ==========================================================================
   fractal.js — an infinitely-zoomable Mandelbrot / Julia explorer on the GPU.
   --------------------------------------------------------------------------
   The Mandelbrot set is per-pixel embarrassingly parallel: every pixel runs
   the same escape-time loop on its own coordinate and never looks at its
   neighbours. That is exactly the shape a fragment shader is built for, so the
   whole set is computed on the GPU in one draw call. A CPU version — even a
   worker fanned across cores — spends its life re-painting one ImageData while
   the wheel is still turning; it cannot keep a zoom smooth. So this toy is the
   one place in Labs that reaches for WebGL instead of a Web Worker.

   Three decisions worth stating plainly:

   1. Single precision is the wall, and we say so. A fragment shader's floats
      are 32-bit (highp is still float32 in WebGL1). That is ~7 decimal digits,
      so once the view is a few times 10^5 across — a zoom of roughly 10^5 to
      10^6 — the coordinate feeding each pixel can no longer be told apart from
      its neighbour and the image goes blocky. Emulated double-float math in the
      shader could push that back, but it roughly quadruples the cost and still
      hits a wall a few decades deeper. The brief asked for honesty over a fake
      floor, so the readout escalates from a note to an amber to a red warning
      as you cross into the range where the pixelation is the arithmetic, not
      the fractal. The maths (center, span) is kept in JS doubles right up to
      the uniform upload; the loss happens on the GPU boundary, nowhere earlier.

   2. Julia's c is picked by hovering the Mandelbrot. Every point of the
      Mandelbrot set IS the c-parameter of a Julia set, and the Julias flip
      between connected and dust exactly as you cross the Mandelbrot boundary.
      So: hover the Mandelbrot to aim, flip the set selector to Julia, and the
      point you were last hovering becomes c. Flip back, hover elsewhere, flip
      again. Each set keeps its own pan/zoom so the toggle is a portal, not a
      reset. It is the most satisfying thing in here and it costs one variable.

   3. We render on demand, not in a rAF loop. A fractal is static until you
      touch it, and viz-shell is deliberate about not spinning the GPU behind
      an idle tab. So a draw is scheduled only when something actually changed
      (a pan, a zoom, a control) and coalesced to one frame — no perpetual loop
      burning battery on a picture that is not moving.

   No network, no eval, no new Function. WebGL and DOM only, ES5 in an IIFE.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  /* ---- defaults ---------------------------------------------------------- */
  var HARD_MAX = 1000;        // matches the shader's constant loop bound
  var DEFAULT_ITER = 250;
  var MIN_ITER = 50;
  var ZOOM_WHEEL = 0.85;      // per wheel notch
  var ZOOM_CLICK = 0.5;       // a click halves the view width toward the cursor
  /* The float32 wall is around halfHeight 5e-7; past ~1e-6 every pixel maps to
     the same coordinate and the whole screen collapses to one flat colour
     (black, if that region is interior) — which reads as "broken", not "deep".
     So the zoom stops at the last depth that still shows structure. The note
     explains why, rather than letting you fall into a black void. */
  var MIN_HH = 1.5e-6;
  var MAX_HH = 4.0;           // how far out you may pull back for context
  var DRAG_PX = 3;            // movement before a press counts as a drag not a click

  var PALETTES = ['Ultra', 'Fire', 'Ice', 'Rainbow', 'Greyscale'];
  var SETS = [['mandelbrot', 'Mandelbrot'], ['julia', 'Julia'],
              ['burningship', 'Burning Ship'], ['tricorn', 'Tricorn']];
  var SET_CODE = { mandelbrot: 0, julia: 1, burningship: 2, tricorn: 3 };

  // Reference framing per set. Zoom level is measured against the set's own
  // default half-height, so "x1" always means "the whole set in view".
  var DEFAULTS = {
    mandelbrot:  { cx: -0.5,  cy:  0.0,  hh: 1.25 },
    julia:       { cx:  0.0,  cy:  0.0,  hh: 1.40 },
    burningship: { cx: -0.4,  cy: -0.5,  hh: 0.85 },
    tricorn:     { cx:  0.0,  cy:  0.0,  hh: 1.70 }
  };

  /* ---- live state -------------------------------------------------------- */
  var set = 'mandelbrot';
  var center = { x: DEFAULTS.mandelbrot.cx, y: DEFAULTS.mandelbrot.cy };
  var halfHeight = DEFAULTS.mandelbrot.hh;
  var maxIter = DEFAULT_ITER;
  var paletteIdx = 0;
  var juliaC = { x: -0.8, y: 0.156 };          // pleasant default until you hover
  var hoverC = { x: -0.8, y: 0.156 };          // last Mandelbrot point under the cursor
  var saved = {};                               // per-set pan/zoom snapshots

  /* ---- DOM / GL handles -------------------------------------------------- */
  var canvas, gl, program, info;
  var uCenter, uSpan, uMaxIter, uSet, uJuliaC, uPalette;
  var elSet, elCenter, elZoom, elC, elNote;
  var started = false;
  var renderPending = false;

  /* ---- shader source (GLSL ES 1.00) ------------------------------------- */
  var VERT = [
    'attribute vec2 a_pos;',
    'varying vec2 v_uv;',
    'void main(){ v_uv = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',            // still float32 — the honest wall lives here
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 v_uv;',
    'uniform vec2 u_center;',
    'uniform vec2 u_span;',              // half-extents (x,y) of the view, complex units
    'uniform int  u_maxIter;',
    'uniform int  u_set;',               // 0 = mandelbrot, 1 = julia
    'uniform vec2 u_juliaC;',
    'uniform int  u_palette;',
    'const int HARD_MAX = 1000;',
    'const float LOG2 = 0.6931471805599453;',
    'const float TAU = 6.28318530718;',
    // Inigo Quilez cosine gradient: cheap, smooth, and its natural cycling
    // keeps colour bands visible at any depth instead of washing out.
    'vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b*cos(TAU*(c*t + d)); }',
    'vec3 palette(float it){',
    '  float t = it;',
    '  if (u_palette == 0) { return pal(t*0.020, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00,0.10,0.20)); }',
    '  else if (u_palette == 1) { return pal(t*0.020, vec3(0.5,0.25,0.10), vec3(0.5,0.30,0.15), vec3(1.0), vec3(0.00,0.08,0.16)); }',
    '  else if (u_palette == 2) { return pal(t*0.020, vec3(0.40,0.50,0.60), vec3(0.35,0.45,0.50), vec3(1.0), vec3(0.55,0.50,0.45)); }',
    '  else if (u_palette == 3) { return pal(t*0.025, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00,0.33,0.67)); }',
    '  float g = 0.5 + 0.5*cos(TAU*t*0.020); return vec3(g);',
    '}',
    'void main(){',
    '  vec2 c; vec2 z;',
    '  vec2 p = u_center + v_uv * u_span;',
    '  if (u_set == 1) { z = p; c = u_juliaC; } else { c = p; z = vec2(0.0); }',
    '  bool escaped = false;',
    '  float iterCount = 0.0;',
    // Loop bound must be a constant for GLSL ES 1.00; the uniform caps it with a
    // dynamic break, which ANGLE compiles fine (and does not try to unroll).
    '  for (int i = 0; i < HARD_MAX; i++) {',
    '    if (i >= u_maxIter) break;',
    // The real part is identical for all four sets (squares kill the sign).
    // The imaginary part is what distinguishes them:
    //   mandelbrot/julia:  2 x y            burning ship:  2 |x| |y|
    //   tricorn (conj):   -2 x y
    '    float x = z.x*z.x - z.y*z.y + c.x;',
    '    float y;',
    '    if (u_set == 2) { y = 2.0*abs(z.x)*abs(z.y) + c.y; }',
    '    else if (u_set == 3) { y = -2.0*z.x*z.y + c.y; }',
    '    else { y = 2.0*z.x*z.y + c.y; }',
    '    z = vec2(x, y);',
    '    float m2 = dot(z, z);',
    // Bailout at |z|>16 (m2>256), not 2. A generous radius makes the smooth
    // (fractional) iteration count accurate enough to kill the colour banding.
    '    if (m2 > 256.0) {',
    '      float log_zn = log(m2) * 0.5;',
    '      float nu = log(log_zn / LOG2) / LOG2;',
    '      iterCount = float(i) + 1.0 - nu;',
    '      escaped = true;',
    '      break;',
    '    }',
    '  }',
    '  if (!escaped) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }',   // interior stays black
    '  gl_FragColor = vec4(palette(iterCount), 1.0);',
    '}'
  ].join('\n');

  /* ---- tiny helpers ------------------------------------------------------ */
  function raf(fn) {
    if (typeof LabViz !== 'undefined' && LabViz && LabViz.raf) return LabViz.raf(fn);
    if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
    return window.setTimeout(function () { fn(Date.now()); }, 16);
  }
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function log10(x) { return Math.log(x) / Math.LN10; }

  /* ---- WebGL bring-up ---------------------------------------------------- */
  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var err = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('shader compile failed: ' + err);
    }
    return s;
  }

  function initGL() {
    var attrs = { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false };
    try {
      gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    } catch (e) { gl = null; }
    if (!gl) return false;

    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('program link failed: ' + gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    // Full-clip-space quad, two triangles. a_pos in [-1,1] doubles as v_uv.
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    uCenter  = gl.getUniformLocation(program, 'u_center');
    uSpan    = gl.getUniformLocation(program, 'u_span');
    uMaxIter = gl.getUniformLocation(program, 'u_maxIter');
    uSet     = gl.getUniformLocation(program, 'u_set');
    uJuliaC  = gl.getUniformLocation(program, 'u_juliaC');
    uPalette = gl.getUniformLocation(program, 'u_palette');
    return true;
  }

  /* ---- sizing ------------------------------------------------------------ */
  function resizeIfNeeded() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap: 3x phones would quadruple fragment work
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    // Bare test harness with no CSS box: give the canvas something to fill.
    if (!cw) { canvas.style.width = '100%'; cw = canvas.clientWidth; }
    if (!ch) { canvas.style.height = '480px'; ch = canvas.clientHeight; }
    var W = Math.max(1, Math.round(cw * dpr));
    var H = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== W)  canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
  }

  // Current half-extents of the view, honouring the drawing-buffer aspect.
  function spanNow() {
    var w = gl.drawingBufferWidth || 1, h = gl.drawingBufferHeight || 1;
    return { x: halfHeight * (w / h), y: halfHeight };
  }

  /* ---- render ------------------------------------------------------------ */
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    raf(function () { renderPending = false; draw(); });
  }

  function draw() {
    if (!gl) return;
    resizeIfNeeded();
    var sp = spanNow();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(uCenter, center.x, center.y);   // JS doubles narrowed to float32 here — the wall
    gl.uniform2f(uSpan, sp.x, sp.y);
    gl.uniform1i(uMaxIter, maxIter);
    gl.uniform1i(uSet, SET_CODE[set] || 0);
    gl.uniform2f(uJuliaC, juliaC.x, juliaC.y);
    gl.uniform1i(uPalette, paletteIdx);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    updateInfo();
  }

  /* ---- readout ----------------------------------------------------------- */
  function currentZoom() { return DEFAULTS[set].hh / halfHeight; }

  function fmtZoom(z) {
    if (z < 10)   return z.toFixed(2);
    if (z < 1e4)  return Math.round(z).toLocaleString();
    return z.toExponential(2);
  }

  function fmtComplex(x, y, dec) {
    var sign = y >= 0 ? ' + ' : ' − ';       // proper minus sign
    return x.toFixed(dec) + sign + Math.abs(y).toFixed(dec) + 'i';
  }

  function updateInfo() {
    if (!info) return;
    var z = currentZoom();
    // Show as many decimals as the zoom can meaningfully resolve (clamped to
    // what a float64 could ever hold), so the readout never claims false depth.
    var dec = Math.min(16, Math.max(4, Math.round(log10(z)) + 4));

    elSet.textContent = (set === 'julia' ? 'Julia' : 'Mandelbrot') + '   ·   ' + maxIter + ' iterations   ·   ' + PALETTES[paletteIdx];
    elCenter.textContent = 'center   ' + fmtComplex(center.x, center.y, dec);
    elZoom.textContent = 'zoom   ×' + fmtZoom(z);

    if (set === 'mandelbrot') {
      elC.textContent = 'hover c   ' + fmtComplex(hoverC.x, hoverC.y, 6) + '   →  switch to Julia to open it';
      elC.style.color = '#7dd3fc';
    } else if (set === 'julia') {
      elC.textContent = 'julia c   ' + fmtComplex(juliaC.x, juliaC.y, 6) + '   (hover the Mandelbrot, then switch, to change it)';
      elC.style.color = '#7dd3fc';
    } else {
      elC.textContent = (set === 'burningship' ? 'Burning Ship' : 'Tricorn') +
                        '   ·   a different iteration rule, same idea — scroll to zoom, drag to pan';
      elC.style.color = '#94a3b8';
    }

    // Honesty about the float32 floor, escalating as the clamp approaches. Zoom
    // stops at MIN_HH (~1.5e-6), so the strongest message fires just before it.
    if (halfHeight <= MIN_HH * 1.5) {
      elNote.textContent = 'Maximum zoom — this is as deep as single-precision GPU maths resolves. The blockiness is float32 hitting its ~7-digit limit, not the fractal running out of detail. Going deeper needs double precision, which browsers do not expose on the GPU. Reset and explore elsewhere — there is infinite structure at every scale.';
      elNote.style.color = '#f87171';
    } else if (halfHeight < 5e-5) {
      elNote.textContent = 'Detail is starting to soften: single-precision float on the GPU is nearing its ~7-digit limit. A little deeper is as far as it goes.';
      elNote.style.color = '#fbbf24';
    } else {
      elNote.textContent = 'Computed on the GPU in a fragment shader. Coordinates are single-precision float32 (~7 digits), so the zoom bottoms out around ×10^6 — a real hardware limit, not a bug. The interesting structure is everywhere, not just deep.';
      elNote.style.color = '#94a3b8';
    }
  }

  /* ---- coordinate mapping ------------------------------------------------ */
  function uvAtClient(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var px = (clientX - r.left) / r.width;
    var py = (clientY - r.top) / r.height;
    return { x: px * 2 - 1, y: 1 - py * 2 };     // flip Y: screen down, complex up
  }
  function complexAtClient(clientX, clientY) {
    var uv = uvAtClient(clientX, clientY);
    var sp = spanNow();
    return { x: center.x + uv.x * sp.x, y: center.y + uv.y * sp.y };
  }

  function clampHH() {
    if (halfHeight < MIN_HH) halfHeight = MIN_HH;
    if (halfHeight > MAX_HH) halfHeight = MAX_HH;
  }

  // Zoom by factor f keeping the complex point under (clientX,clientY) fixed.
  function zoomAtClient(clientX, clientY, f) {
    var uv = uvAtClient(clientX, clientY);
    var sp = spanNow();
    var cx = center.x + uv.x * sp.x;
    var cy = center.y + uv.y * sp.y;
    halfHeight *= f;
    clampHH();
    var sp2 = spanNow();
    center.x = cx - uv.x * sp2.x;
    center.y = cy - uv.y * sp2.y;
    requestRender();
  }

  function panPixels(dxPx, dyPx) {
    var r = canvas.getBoundingClientRect();
    var sp = spanNow();
    center.x -= (dxPx / r.width) * 2 * sp.x;
    center.y += (dyPx / r.height) * 2 * sp.y;   // screen down means the view moves up
  }

  /* ---- set switching (the hover-to-pick-c portal) ------------------------ */
  function loadSet(name) {
    var s = saved[name];
    if (!s) { var d = DEFAULTS[name]; s = { cx: d.cx, cy: d.cy, hh: d.hh, iter: maxIter }; }
    center.x = s.cx; center.y = s.cy; halfHeight = s.hh; maxIter = s.iter;
  }
  function switchSet(name) {
    if (name === set) return;
    saved[set] = { cx: center.x, cy: center.y, hh: halfHeight, iter: maxIter };
    set = name;
    if (name === 'julia') { juliaC = { x: hoverC.x, y: hoverC.y }; }   // adopt the point last hovered
    loadSet(name);
    syncControls();
    requestRender();
  }

  function resetView() {
    var d = DEFAULTS[set];
    center.x = d.cx; center.y = d.cy;
    halfHeight = d.hh;
    maxIter = DEFAULT_ITER;
    syncControls();
    requestRender();
  }

  /* ---- pointer / wheel / touch ------------------------------------------ */
  var down = false, dragging = false, lastX = 0, lastY = 0, startX = 0, startY = 0;
  var pinch = false, prevDist = 0, prevMid = null;

  function onMouseDown(e) {
    if (e.button !== 0) return;
    down = true; dragging = false;
    startX = lastX = e.clientX; startY = lastY = e.clientY;
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (down) {
      if (!dragging && (Math.abs(e.clientX - startX) > DRAG_PX || Math.abs(e.clientY - startY) > DRAG_PX)) dragging = true;
      if (dragging) {
        panPixels(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
        requestRender();
      }
    } else if (set === 'mandelbrot') {
      hoverC = complexAtClient(e.clientX, e.clientY);   // aim the future Julia
      updateInfo();                                     // text only, no redraw
    }
  }
  function onMouseUp(e) {
    if (!down) return;
    down = false;
    if (!dragging) {   // a click, not a drag: zoom toward it (shift/alt = out)
      var f = (e.shiftKey || e.altKey) ? (1 / ZOOM_CLICK) : ZOOM_CLICK;
      zoomAtClient(e.clientX, e.clientY, f);
    }
  }
  function onWheel(e) {
    e.preventDefault();
    zoomAtClient(e.clientX, e.clientY, e.deltaY < 0 ? ZOOM_WHEEL : 1 / ZOOM_WHEEL);
  }
  function onContextMenu(e) {
    e.preventDefault();                     // right-click zooms out at the cursor
    zoomAtClient(e.clientX, e.clientY, 1 / ZOOM_CLICK);
  }

  function touchDist(t) {
    var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function touchMid(t) {
    return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
  }
  function onTouchStart(e) {
    if (e.touches.length === 1) {
      down = true; dragging = true; pinch = false;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      down = false; pinch = true;
      prevDist = touchDist(e.touches); prevMid = touchMid(e.touches);
    }
    e.preventDefault();
  }
  function onTouchMove(e) {
    if (pinch && e.touches.length === 2) {
      var d = touchDist(e.touches), m = touchMid(e.touches);
      if (d > 0 && prevDist > 0) zoomAtClient(m.x, m.y, prevDist / d);
      if (prevMid) panPixels(m.x - prevMid.x, m.y - prevMid.y);
      prevDist = d; prevMid = m;
      requestRender();
    } else if (down && e.touches.length === 1) {
      panPixels(e.touches[0].clientX - lastX, e.touches[0].clientY - lastY);
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      requestRender();
    }
    e.preventDefault();
  }
  function onTouchEnd(e) {
    if (e.touches.length === 0) { down = false; pinch = false; }
    else if (e.touches.length === 1) {
      pinch = false; down = true;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    }
  }

  function onKeyDown(e) {
    var k = e.key;
    if (k === '+' || k === '=') { zoomCenter(ZOOM_WHEEL); e.preventDefault(); }
    else if (k === '-' || k === '_') { zoomCenter(1 / ZOOM_WHEEL); e.preventDefault(); }
    else if (k === 'ArrowLeft')  { panPixels(-40, 0); requestRender(); e.preventDefault(); }
    else if (k === 'ArrowRight') { panPixels(40, 0);  requestRender(); e.preventDefault(); }
    else if (k === 'ArrowUp')    { panPixels(0, -40); requestRender(); e.preventDefault(); }
    else if (k === 'ArrowDown')  { panPixels(0, 40);  requestRender(); e.preventDefault(); }
    else if (k === 'r' || k === 'R') { resetView(); e.preventDefault(); }
  }
  function zoomCenter(f) {
    halfHeight *= f; clampHH(); requestRender();
  }

  /* ---- controls ---------------------------------------------------------- */
  function selectEl(id) { return document.getElementById(id); }

  // Populate a <select> only if the page left it empty, so real markup wins.
  function fillSelect(sel, items, isPair) {
    if (!sel || sel.options.length) return;
    for (var i = 0; i < items.length; i++) {
      var o = document.createElement('option');
      if (isPair) { o.value = items[i][0]; o.textContent = items[i][1]; }
      else { o.value = String(i); o.textContent = items[i]; }
      sel.appendChild(o);
    }
  }

  // Keep the visible controls in step with state after a switch/reset.
  function syncControls() {
    var s = selectEl('viz-set');   if (s) s.value = set;
    var it = selectEl('viz-iter'); if (it) it.value = String(maxIter);
    var p = selectEl('viz-palette'); if (p) p.value = String(paletteIdx);
  }

  function buildInfo() {
    info = selectEl('viz-info');
    if (!info) return;
    info.textContent = '';
    elSet    = mk('div', 'viz-info-set');
    elCenter = mk('div', 'viz-info-center');
    elZoom   = mk('div', 'viz-info-zoom');
    elC      = mk('div', 'viz-info-c');
    elNote   = mk('div', 'viz-info-note');
    elCenter.style.fontVariantNumeric = 'tabular-nums';
    elZoom.style.fontVariantNumeric = 'tabular-nums';
    elNote.style.marginTop = '0.4rem';
    elNote.style.fontSize = '0.8em';
    elNote.style.lineHeight = '1.5';
    info.appendChild(elSet);
    info.appendChild(elCenter);
    info.appendChild(elZoom);
    info.appendChild(elC);
    info.appendChild(elNote);
  }

  function failMessage(msg) {
    var host = selectEl('viz-info') || selectEl('fractalviz');
    if (!host) return;
    var p = mk('div', null, msg);
    p.style.color = '#f87171';
    p.style.lineHeight = '1.6';
    host.appendChild(p);
  }

  /* ---- wiring ------------------------------------------------------------ */
  function boot() {
    if (started) return;
    started = true;

    canvas = selectEl('viz-canvas');
    if (!canvas) { failMessage('Fractal explorer: no <canvas id="viz-canvas"> on the page.'); return; }

    buildInfo();

    // WebGL is required — a CPU fallback could not keep a zoom smooth, so rather
    // than ship a slow lie we say plainly that the browser cannot run this.
    var ok = false;
    try { ok = initGL(); }
    catch (err) { failMessage('WebGL failed to start this explorer: ' + (err && err.message ? err.message : err)); return; }
    if (!ok) { failMessage('This browser did not give us a WebGL context, so the GPU fractal cannot run here. WebGL is required.'); return; }

    // Controls (populated only if the markup left them empty).
    fillSelect(selectEl('viz-set'), SETS, true);
    fillSelect(selectEl('viz-palette'), PALETTES, false);
    var iter = selectEl('viz-iter');
    if (iter) {
      if (!iter.min)  iter.min = String(MIN_ITER);
      if (!iter.max)  iter.max = String(HARD_MAX);
      if (!iter.step) iter.step = '10';
      iter.value = String(maxIter);
      iter.addEventListener('input', function () {
        var v = parseInt(iter.value, 10);
        if (isNaN(v)) v = DEFAULT_ITER;
        maxIter = Math.max(MIN_ITER, Math.min(HARD_MAX, v));
        requestRender();
      });
    }
    var setSel = selectEl('viz-set');
    if (setSel) setSel.addEventListener('change', function () { switchSet(setSel.value); });
    var palSel = selectEl('viz-palette');
    if (palSel) palSel.addEventListener('change', function () {
      var v = parseInt(palSel.value, 10);
      paletteIdx = isNaN(v) ? 0 : Math.max(0, Math.min(PALETTES.length - 1, v));
      requestRender();
    });
    var resetBtn = selectEl('viz-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetView);

    // Canvas interaction.
    canvas.style.touchAction = 'none';     // stop the browser hijacking touch gestures
    canvas.style.cursor = 'crosshair';
    if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);   // window so a drag survives leaving the canvas
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mousemove', onMouseMove);   // hover-to-pick needs canvas-local moves too
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    canvas.addEventListener('keydown', onKeyDown);

    window.addEventListener('resize', requestRender);
    if (window.ResizeObserver) {
      try { new window.ResizeObserver(requestRender).observe(canvas); } catch (e2) {}
    }

    // Survive a lost GPU context instead of freezing on a dead canvas.
    canvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); }, false);
    canvas.addEventListener('webglcontextrestored', function () {
      try { if (initGL()) requestRender(); } catch (e3) {}
    }, false);

    syncControls();
    requestRender();
  }

  /* ---- registration ------------------------------------------------------ */
  // viz-shell drives this: the gate fires onReady the moment consent exists,
  // and Ctrl/Cmd+Enter is bound to a live reset. If the shell is absent (a bare
  // test page), fall back to wiring ourselves once the DOM is ready.
  if (typeof LabViz !== 'undefined' && LabViz && LabViz.define) {
    LabViz.define({ id: 'fractalviz', run: resetView, onReady: boot });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

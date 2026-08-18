/* ==========================================================================
   shader.js — a live fragment-shader editor with instant WebGL output.
   --------------------------------------------------------------------------
   A Shadertoy in miniature: type GLSL on the left, see it running on a
   full-screen quad on the right, recompiled a third of a second after you
   stop typing. The whole point of a tool like this is the error path, so a
   few decisions are made around keeping that path honest.

   1. The textarea IS the shader. Nothing is prepended — no hidden precision
      line, no injected uniform block, no #version rewrite. The moment you
      splice your own lines above the user's, every compile error the driver
      reports points at the wrong line, and a shader editor that lies about
      line numbers is worse than none. So the examples carry their own
      `precision` and `uniform` declarations, the raw textarea text is what
      gets compiled, and "Line 12" in the error pane is genuinely line 12 in
      the box. The cost is a little boilerplate at the top of each example;
      the payoff is that the driver's line numbers land exactly.

   2. Shaders are authored in GLSL ES 1.00 (gl_FragColor, no #version line).
      That dialect compiles unchanged in both a WebGL1 and a WebGL2 context,
      so we can ask for webgl2 first for its nicer defaults and quietly fall
      back to webgl without the examples caring which one they got.

   3. A failed recompile keeps the last shader that DID compile running on
      the canvas. Blanking the screen to black the instant you make a typo is
      hostile — you lose your reference while you fix it. So a bad compile
      only updates the error pane; the good program keeps drawing until it is
      replaced by another good one.

   4. u_time is a paused clock, not a paused loop. Pause freezes the time
      uniform but the render keeps going, so a mouse-driven shader still
      tracks the cursor and a resize still reflows while time is held. Reset
      just sets the clock back to zero.

   No eval, no new Function, no network. GLSL is handed to the GPU driver
   through gl.shaderSource / gl.compileShader, which is a separate path from
   the JS engine and untouched by the page CSP — that is why a live code
   editor is possible here at all without unsafe-eval. Context loss (GPU
   reset, driver hiccup, a backgrounded tab reclaimed by the OS) is caught
   and the whole GL side is rebuilt on restore rather than left for dead.
   ========================================================================== */

/* global LabViz */
(function () {
  'use strict';

  var DEBOUNCE = 300;      // ms of quiet typing before a recompile fires
  var MAX_DPR = 2;         // cap device-pixel-ratio: a 3x phone raymarching is a heater

  /* The one fixed part of the pipeline. Two triangles as a strip, covering
     clip space from corner to corner, so the fragment shader runs once per
     pixel of the canvas and nothing else ever changes on the vertex side. */
  var VERT = [
    'attribute vec2 a_position;',
    'void main() {',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  function src(lines) { return lines.join('\n'); }

  /* ---- example shaders, each a complete GLSL ES 1.00 fragment shader ---- */
  var EXAMPLES = [
    {
      name: 'Plasma',
      code: src([
        '// Classic sum-of-sines plasma. Cheap, and it never stops moving.',
        'precision highp float;',
        'uniform float u_time;',
        'uniform vec2  u_resolution;',
        'uniform vec2  u_mouse;',
        '',
        'void main() {',
        '  vec2 uv = gl_FragCoord.xy / u_resolution.xy;',
        '  vec2 p  = uv * 8.0;',
        '  float t = u_time;',
        '  float v = sin(p.x + t);',
        '  v += sin((p.y + t) * 0.5);',
        '  v += sin((p.x + p.y + t) * 0.5);',
        '  p += 4.0 * vec2(sin(t * 0.3), cos(t * 0.2));',
        '  v += sin(sqrt(p.x * p.x + p.y * p.y + 1.0) + t);',
        '  v *= 0.5;',
        '  vec3 col = vec3(sin(v * 3.1416),',
        '                  sin(v * 3.1416 + 2.094),',
        '                  sin(v * 3.1416 + 4.188));',
        '  gl_FragColor = vec4(col * 0.5 + 0.5, 1.0);',
        '}'
      ])
    },
    {
      name: 'Raymarched sphere',
      code: src([
        '// Sphere traced with a signed distance field, one moving light,',
        '// finite-difference normals, a specular highlight and gamma at the end.',
        'precision highp float;',
        'uniform float u_time;',
        'uniform vec2  u_resolution;',
        'uniform vec2  u_mouse;',
        '',
        'float map(vec3 p) {',
        '  return length(p) - 1.0;          // sphere, radius 1, at the origin',
        '}',
        '',
        'vec3 calcNormal(vec3 p) {',
        '  vec2 e = vec2(0.001, 0.0);',
        '  return normalize(vec3(',
        '    map(p + e.xyy) - map(p - e.xyy),',
        '    map(p + e.yxy) - map(p - e.yxy),',
        '    map(p + e.yyx) - map(p - e.yyx)));',
        '}',
        '',
        'void main() {',
        '  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;',
        '  vec3 ro = vec3(0.0, 0.0, 3.0);   // camera',
        '  vec3 rd = normalize(vec3(uv, -1.5));',
        '  float t = 0.0;',
        '  float hit = -1.0;',
        '  for (int i = 0; i < 80; i++) {',
        '    vec3 p = ro + rd * t;',
        '    float d = map(p);',
        '    if (d < 0.001) { hit = t; break; }',
        '    t += d;',
        '    if (t > 20.0) break;',
        '  }',
        '  vec3 col = vec3(0.05, 0.06, 0.08);',
        '  if (hit > 0.0) {',
        '    vec3 p = ro + rd * hit;',
        '    vec3 n = calcNormal(p);',
        '    vec3 lp = vec3(3.0 * cos(u_time), 2.0, 3.0 * sin(u_time));',
        '    vec3 l  = normalize(lp - p);',
        '    float diff = max(dot(n, l), 0.0);',
        '    vec3 h = normalize(l - rd);',
        '    float spec = pow(max(dot(n, h), 0.0), 32.0);',
        '    col = vec3(0.2, 0.5, 0.9) * diff + vec3(1.0) * spec + 0.03;',
        '  }',
        '  col = pow(col, vec3(0.4545));    // linear -> sRGB',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ])
    },
    {
      name: 'Julia fractal',
      code: src([
        '// Julia set with a c that orbits the origin, so the fractal breathes.',
        '// Coloured by a smooth-ish escape count run through a cosine palette.',
        'precision highp float;',
        'uniform float u_time;',
        'uniform vec2  u_resolution;',
        'uniform vec2  u_mouse;',
        '',
        'const float MAX = 128.0;',
        '',
        'void main() {',
        '  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;',
        '  vec2 z = uv * 1.5;',
        '  vec2 c = 0.7885 * vec2(cos(u_time * 0.3), sin(u_time * 0.3));',
        '  float n = 0.0;',
        '  for (int i = 0; i < 128; i++) {',
        '    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;',
        '    if (dot(z, z) > 4.0) break;',
        '    n += 1.0;',
        '  }',
        '  float m = n / MAX;',
        '  vec3 col = 0.5 + 0.5 * cos(6.2831 * (m + vec3(0.0, 0.33, 0.67))',
        '                             + u_time * 0.2);',
        '  if (n >= MAX) col = vec3(0.0);   // inside the set',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ])
    },
    {
      name: 'Colour-cycling gradient',
      code: src([
        '// The smallest interesting shader: a full-screen cosine palette that',
        '// drifts in hue over time. Good first thing to poke at.',
        'precision highp float;',
        'uniform float u_time;',
        'uniform vec2  u_resolution;',
        'uniform vec2  u_mouse;',
        '',
        'void main() {',
        '  vec2 uv = gl_FragCoord.xy / u_resolution.xy;',
        '  vec3 col = 0.5 + 0.5 * cos(u_time + uv.xyx * 3.0 + vec3(0.0, 2.0, 4.0));',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ])
    },
    {
      name: 'Concentric circles (mouse)',
      code: src([
        '// Rings that radiate out from the pointer. Move the mouse over the',
        '// canvas; before you touch it, u_mouse is (0,0) so it sits at centre.',
        'precision highp float;',
        'uniform float u_time;',
        'uniform vec2  u_resolution;',
        'uniform vec2  u_mouse;',
        '',
        'void main() {',
        '  vec2 m = u_mouse;',
        '  if (m.x < 1.0 && m.y < 1.0) m = 0.5 * u_resolution;',
        '  float d = distance(gl_FragCoord.xy, m) / u_resolution.y;',
        '  float w = sin(d * 30.0 - u_time * 3.0);',
        '  float rings = smoothstep(0.4, 1.0, w);',
        '  vec3 base = 0.5 + 0.5 * cos(u_time * 0.5 + d * 6.0',
        '                              + vec3(0.0, 2.1, 4.2));',
        '  vec3 col = base * rings + 0.02;',
        '  col *= smoothstep(1.2, 0.0, d);  // fade toward the edges',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ])
    }
  ];

  /* ---- module-wide state ----------------------------------------------- */
  var canvas, codeEl, selEl, playBtn, resetBtn, errEl, fpsEl;
  var gl = null;
  var vs = null;            // the fixed vertex shader, kept across recompiles
  var program = null;       // the last program that linked cleanly
  var quadBuf = null;
  var uTime = null, uRes = null, uMouse = null;

  var simTime = 0;          // seconds on the shader clock
  var playing = true;
  var mouseX = 0, mouseY = 0;
  var lastNow = null;
  var frameCount = 0, fpsClock = null;
  var rafHandle = null, running = false;
  var contextLost = false;
  var debTimer = null;

  /* ---- error reporting -------------------------------------------------- */
  /* Drivers report GLSL errors as "ERROR: 0:LINE: message" — the 0 is the
     source-string index (always 0 for us, we compile one string), LINE is
     1-based into that string. We pull LINE out, print it plainly, and echo
     the offending source line underneath for context, since ES GLSL logs
     carry no column. Anything that doesn't match the shape is passed through
     verbatim so nothing the driver said is swallowed. */
  function showErrors(log, source) {
    var lines = source.split('\n');
    var raw = String(log || '').split('\n');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i];
      if (!line.replace(/\s/g, '')) continue;
      var m = line.match(/(?:ERROR|WARNING)\s*:\s*\d+\s*:\s*(\d+)\s*:\s*([\s\S]*)$/i);
      if (m) {
        var ln = parseInt(m[1], 10);
        out.push('Line ' + ln + ': ' + m[2]);
        if (lines[ln - 1] != null) out.push('  ' + (ln) + ' | ' + lines[ln - 1]);
      } else {
        out.push(line);
      }
    }
    if (!out.length) out.push('Shader failed to compile (no detail from driver).');
    errEl.textContent = out.join('\n');
    errEl.setAttribute('data-state', 'error');
  }

  function clearErrors() {
    errEl.textContent = '';
    errEl.setAttribute('data-state', 'ok');
  }

  /* ---- GL construction -------------------------------------------------- */
  function makeShader(type, source) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    return sh;
  }

  /* Build the parts that never depend on the user's text: the vertex shader
     and the quad buffer. Called once at start and again on context restore,
     because a lost context invalidates every GL object it ever handed out. */
  function buildStatic() {
    vs = makeShader(gl.VERTEX_SHADER, VERT);
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
  }

  /* Compile the fragment shader in `source`, link it, and — only if both
     succeed — swap it in for the running program. Returns true on success.
     On any failure the current program is left untouched. */
  function compile(source) {
    if (!gl || contextLost) return false;

    var fs = makeShader(gl.FRAGMENT_SHADER, source);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      var clog = gl.getShaderInfoLog(fs);
      gl.deleteShader(fs);
      showErrors(clog, source);
      return false;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(fs);   // flagged for delete; freed once detached from prog

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      var llog = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      showErrors(llog, source);
      return false;
    }

    if (program) gl.deleteProgram(program);
    program = prog;
    gl.useProgram(program);

    uTime  = gl.getUniformLocation(program, 'u_time');
    uRes   = gl.getUniformLocation(program, 'u_resolution');
    uMouse = gl.getUniformLocation(program, 'u_mouse');

    var loc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    clearErrors();
    return true;
  }

  /* ---- sizing ----------------------------------------------------------- */
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var w = Math.max(1, Math.floor((canvas.clientWidth || 1) * dpr));
    var h = Math.max(1, Math.floor((canvas.clientHeight || 1) * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  /* ---- the frame loop --------------------------------------------------- */
  function step(now) {
    if (!running) return;
    rafHandle = LabViz.raf(step);
    if (contextLost) return;

    resize();

    if (lastNow == null) lastNow = now;
    var dt = (now - lastNow) / 1000;
    lastNow = now;
    if (dt > 0.1) dt = 0.1;              // clamp jumps after a tab was hidden
    if (playing) simTime += dt;

    frameCount++;
    if (fpsClock == null) fpsClock = now;
    if (now - fpsClock >= 500) {
      if (fpsEl) fpsEl.textContent = String(Math.round(frameCount * 1000 / (now - fpsClock)));
      frameCount = 0;
      fpsClock = now;
    }

    if (!program) return;
    gl.useProgram(program);
    if (uTime  != null) gl.uniform1f(uTime, simTime);
    if (uRes   != null) gl.uniform2f(uRes, canvas.width, canvas.height);
    if (uMouse != null) gl.uniform2f(uMouse, mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function start() {
    if (running) return;
    running = true;
    lastNow = null;
    fpsClock = null;
    rafHandle = LabViz.raf(step);
  }

  function stop() {
    running = false;
    LabViz.cancelRaf(rafHandle);
    rafHandle = null;
  }

  /* ---- input plumbing --------------------------------------------------- */
  function scheduleCompile() {
    if (debTimer) clearTimeout(debTimer);
    debTimer = setTimeout(function () {
      debTimer = null;
      compile(codeEl.value);
    }, DEBOUNCE);
  }

  function loadExample(index, resetClock) {
    var ex = EXAMPLES[index];
    if (!ex) return;
    codeEl.value = ex.code;
    if (resetClock) simTime = 0;
    if (debTimer) { clearTimeout(debTimer); debTimer = null; }
    compile(ex.code);
  }

  function setPointerFromEvent(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var x = (clientX - rect.left) * (canvas.width / rect.width);
    var y = (clientY - rect.top) * (canvas.height / rect.height);
    mouseX = x;
    mouseY = canvas.height - y;   // flip: gl_FragCoord's origin is bottom-left
  }

  function wireEvents() {
    codeEl.addEventListener('input', scheduleCompile);

    if (selEl) selEl.addEventListener('change', function () {
      loadExample(parseInt(selEl.value, 10), true);
    });

    if (playBtn) playBtn.addEventListener('click', function () {
      playing = !playing;
      playBtn.textContent = playing ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-pressed', playing ? 'false' : 'true');
    });

    if (resetBtn) resetBtn.addEventListener('click', function () {
      simTime = 0;
    });

    canvas.addEventListener('mousemove', function (e) {
      setPointerFromEvent(e.clientX, e.clientY);
    });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches.length) {
        setPointerFromEvent(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    /* Context loss: stop the loop and say so. On restore, every GL object is
       gone, so rebuild the static parts and recompile whatever is currently
       in the textarea, then start drawing again. preventDefault on the loss
       event is what makes a restore possible at all. */
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      contextLost = true;
      stop();
      program = null;
      errEl.textContent =
        'WebGL context lost (GPU reset, or the tab was reclaimed while hidden).\n' +
        'Waiting for the browser to restore it…';
      errEl.setAttribute('data-state', 'error');
    }, false);

    canvas.addEventListener('webglcontextrestored', function () {
      contextLost = false;
      buildStatic();
      compile(codeEl.value);
      start();
    }, false);
  }

  /* ---- dropdown population --------------------------------------------- */
  /* Built from EXAMPLES rather than trusting markup, so the module works
     against a bare <select> and there is one source of truth for the list. */
  function fillExamples() {
    selEl.innerHTML = '';
    for (var i = 0; i < EXAMPLES.length; i++) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = EXAMPLES[i].name;
      selEl.appendChild(opt);
    }
  }

  /* ---- boot ------------------------------------------------------------- */
  function init() {
    canvas   = document.getElementById('viz-canvas');
    codeEl   = document.getElementById('viz-code');
    selEl    = document.getElementById('viz-example');
    playBtn  = document.getElementById('viz-playpause');
    resetBtn = document.getElementById('viz-reset');
    errEl    = document.getElementById('viz-errors');
    fpsEl    = document.getElementById('viz-fps');
    if (!canvas || !codeEl || !errEl) return;

    var attrs = { alpha: false, depth: false, stencil: false, antialias: true };
    try {
      gl = canvas.getContext('webgl2', attrs) ||
           canvas.getContext('webgl', attrs) ||
           canvas.getContext('experimental-webgl', attrs);
    } catch (err) {
      gl = null;
    }
    if (!gl) {
      errEl.textContent =
        'This browser did not give us a WebGL context, so there is nothing to\n' +
        'draw on. WebGL is usually disabled by a flag, a headless GPU, or a\n' +
        'blocklisted driver.';
      errEl.setAttribute('data-state', 'error');
      return;
    }

    if (selEl) fillExamples();
    buildStatic();
    wireEvents();

    /* Respect a shader the host page pre-filled; otherwise start on Plasma. */
    if (codeEl.value && codeEl.value.replace(/\s/g, '')) {
      compile(codeEl.value);
    } else {
      loadExample(0, true);
      if (selEl) selEl.value = '0';
    }

    if (playBtn) playBtn.textContent = playing ? 'Pause' : 'Play';
    start();
  }

  LabViz.define({
    id: 'shaderviz',
    /* Ctrl/Cmd + Enter forces a recompile now, skipping the debounce — the
       same "run" gesture the other labs bind. */
    run: function () {
      if (debTimer) { clearTimeout(debTimer); debTimer = null; }
      compile(codeEl.value);
    },
    onReady: init
  });
})();

/* ==========================================================================
   glossary-graph.js — the glossary drawn as the graph it already is.
   --------------------------------------------------------------------------
   IT READS THE PAGE, NOT A DATA FILE. Every node and every edge is already in
   the DOM: each term is a .glossary-item carrying its id and category, and
   every cross-reference is an anchor to #term-something. Fetching a JSON copy
   of the same thing would add a request, add bytes, and add the one failure
   this site keeps designing out — a second artefact that can disagree with
   the first. A graph built from the rendered list cannot describe a glossary
   the page does not have.

   THE SECTION STARTS HIDDEN and this file reveals it, the same arrangement
   glossary.js already uses for the filter controls. Without JavaScript a
   canvas is an empty grey box with a heading promising a diagram, which is
   worse than no section at all. The alphabetical list below it carries the
   same information either way, which is what makes hiding it acceptable.

   IT SETTLES AND STOPS. A force layout left running forever is a space heater
   that also drains a phone: after SETTLE ticks the simulation halts and the
   canvas keeps the last frame. Rearranging is a button, because a layout that
   quietly moves while you are reading it is worse than one that does not.

   O(n²) IS FINE HERE, DELIBERATELY. 179 nodes is 32,000 pair comparisons a
   tick, which a laptop does in well under a millisecond. A quadtree would be
   the right answer at ten thousand nodes and is unjustifiable complexity at
   this one. The glossary would have to grow fifty-fold before this mattered.

   ES5 house rules: no const, no let, no arrow functions.
   ========================================================================== */

(function () {
  'use strict';

  var section = document.getElementById('glossary-graph-section');
  var canvas = document.getElementById('glossary-graph');
  if (!section || !canvas || !canvas.getContext) return;

  var items = document.querySelectorAll('.glossary-item');
  if (items.length < 8) return;

  var readout = document.getElementById('ggraph-readout');
  var shake = document.getElementById('ggraph-shake');
  var caption = document.getElementById('ggraph-caption');
  var ctx = canvas.getContext('2d');

  var SETTLE = 320;
  var MAX_DPR = 2;

  /* Category colours. Hue only — lightness comes from the theme, so one set
     works on both grounds rather than needing a second palette. */
  var HUES = {
    security: 4, crypto: 275, network: 205, forensics: 32,
    systems: 155, dev: 320, compliance: 55, career: 185
  };

  /* ------------------------------------------------------------------
     Read the page
     ------------------------------------------------------------------ */
  var nodes = [];
  var index = {};
  var i;

  for (i = 0; i < items.length; i++) {
    var elItem = items[i];
    var id = elItem.id;
    if (!id) continue;
    var nameEl = elItem.querySelector('.glossary-term');
    var name = nameEl ? nameEl.childNodes[0].nodeValue : id;
    var node = {
      id: id,
      name: String(name).trim(),
      cat: elItem.getAttribute('data-cat') || 'dev',
      deg: 0,
      /* Seeded on a circle rather than at random: a random cloud takes far
         longer to untangle, and the same start every time means the same
         final layout, which makes the picture recognisable on a revisit. */
      x: 0, y: 0, vx: 0, vy: 0
    };
    index[id] = node;
    nodes.push(node);
  }

  var edges = [];
  for (i = 0; i < items.length; i++) {
    var from = index[items[i].id];
    if (!from) continue;
    var links = items[i].querySelectorAll('.glossary-see a[href^="#term-"]');
    for (var j = 0; j < links.length; j++) {
      var to = index[links[j].getAttribute('href').slice(1)];
      if (!to || to === from) continue;
      edges.push({ a: from, b: to });
      from.deg++;
      to.deg++;
    }
  }

  if (!edges.length) return;

  /* --------------------------------------------------------------------
     What gets drawn depends on how much room there is.

     A term with no cross-references at all is a dot floating on its own: it
     is in the list below, it is not in this graph, and drawing it adds
     nothing but clutter. Those go at every size.

     On a phone the column is about 290 pixels wide, and 179 nodes in that
     space is a smear no finger can hit — measured at 1.1px per dot before
     this existed. So narrow screens show only the terms the rest of the
     glossary keeps needing, which is both the readable subset and the
     interesting one. The caption says which, because a picture that quietly
     omits two-thirds of its subject without saying so is a lie.
     -------------------------------------------------------------------- */
  var allNodes = nodes;
  var allEdges = edges;

  function applyView(minDeg) {
    var keep = {};
    nodes = [];
    var k;
    for (k = 0; k < allNodes.length; k++) {
      if (allNodes[k].deg >= minDeg) { keep[allNodes[k].id] = 1; nodes.push(allNodes[k]); }
    }
    edges = [];
    for (k = 0; k < allEdges.length; k++) {
      if (keep[allEdges[k].a.id] && keep[allEdges[k].b.id]) edges.push(allEdges[k]);
    }
  }

  function minDegForWidth() {
    var w = canvas.getBoundingClientRect().width || 900;
    return w < 520 ? 3 : 1;
  }

  /* ------------------------------------------------------------------
     Layout
     ------------------------------------------------------------------ */
  var W = 900, H = 520;

  function seed() {
    for (var k = 0; k < nodes.length; k++) {
      var a = (k / nodes.length) * Math.PI * 2;
      nodes[k].x = W / 2 + Math.cos(a) * (H * 0.36);
      nodes[k].y = H / 2 + Math.sin(a) * (H * 0.36);
      nodes[k].vx = 0;
      nodes[k].vy = 0;
    }
  }

  function tick(heat) {
    var k, n, m, dx, dy, d2, d, f;

    /* Repulsion, every pair. */
    for (k = 0; k < nodes.length; k++) {
      n = nodes[k];
      for (var l = k + 1; l < nodes.length; l++) {
        m = nodes[l];
        dx = n.x - m.x; dy = n.y - m.y;
        d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = 0.1; dy = 0.1; d2 = 0.02; }
        if (d2 > 90000) continue;          /* far enough to ignore */
        f = 640 / d2;
        d = Math.sqrt(d2);
        n.vx += (dx / d) * f; n.vy += (dy / d) * f;
        m.vx -= (dx / d) * f; m.vy -= (dy / d) * f;
      }
    }

    /* Springs along cross-references. */
    for (k = 0; k < edges.length; k++) {
      var e = edges[k];
      dx = e.b.x - e.a.x; dy = e.b.y - e.a.y;
      d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      f = (d - 58) * 0.0055;
      e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f;
      e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
    }

    /* Gravity toward the middle, and damping. */
    for (k = 0; k < nodes.length; k++) {
      n = nodes[k];
      n.vx += (W / 2 - n.x) * 0.0016;
      n.vy += (H / 2 - n.y) * 0.0016;
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx * heat;
      n.y += n.vy * heat;
      if (n.x < 14) n.x = 14; if (n.x > W - 14) n.x = W - 14;
      if (n.y < 14) n.y = 14; if (n.y > H - 14) n.y = H - 14;
    }
  }

  /* ------------------------------------------------------------------
     Paint
     ------------------------------------------------------------------ */
  var hover = null;

  function ink() {
    /* Read the theme's own text colour rather than hard-coding two palettes;
       the toggle then works here for free. */
    var probe = getComputedStyle(document.body).color;
    return probe || '#c8d2e0';
  }

  /* How many graph units one CSS pixel is worth. The layout is computed in a
     fixed 900x520 space and drawn scaled to whatever width the column gives
     it, so on a phone one graph unit is a third of a pixel. Everything a
     finger or an eye has to find — the dot, the hit area — is therefore
     sized in screen pixels and converted back, or it silently shrinks to
     nothing on the devices where it is hardest to hit. */
  var unit = 1;

  function radius(n) {
    return (2.4 + Math.min(5.5, n.deg * 0.8)) * unit;
  }

  function paint() {
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var box = canvas.getBoundingClientRect();
    var cw = Math.max(320, Math.round(box.width));
    var ch = Math.round(cw * (H / W));

    if (canvas.width !== Math.round(cw * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.height = ch + 'px';
    }
    unit = W / cw;
    ctx.setTransform(dpr * (cw / W), 0, 0, dpr * (cw / W), 0, 0);
    ctx.clearRect(0, 0, W, H);

    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(130,150,180,0.28)';
    ctx.beginPath();
    for (var k = 0; k < edges.length; k++) {
      ctx.moveTo(edges[k].a.x, edges[k].a.y);
      ctx.lineTo(edges[k].b.x, edges[k].b.y);
    }
    ctx.stroke();

    for (k = 0; k < nodes.length; k++) {
      var n = nodes[k];
      var hue = HUES[n.cat] != null ? HUES[n.cat] : 210;
      var on = n === hover;
      ctx.fillStyle = 'hsl(' + hue + ',' + (on ? '85%,68%' : '62%,58%') + ')';
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius(n) * (on ? 1.6 : 1), 0, 6.283);
      ctx.fill();
    }

    if (hover) {
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      var label = hover.name;
      var wpx = ctx.measureText(label).width;
      var lx = Math.min(W - wpx - 14, Math.max(8, hover.x - wpx / 2));
      var ly = hover.y < 34 ? hover.y + 26 : hover.y - 14;
      ctx.fillStyle = 'rgba(10,14,22,0.86)';
      ctx.fillRect(lx - 6, ly - 14, wpx + 12, 20);
      ctx.fillStyle = '#f2f6fb';
      ctx.fillText(label, lx, ly);
    }
  }

  /* ------------------------------------------------------------------
     Run
     ------------------------------------------------------------------ */
  var running = false;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* SOLVED IN ONE GO, NOT ANIMATED FRAME BY FRAME.

     The first version ran the simulation on requestAnimationFrame so you
     could watch it untangle, which looked good and had a real hole in it: a
     tab that is not visible gets no frames, so a visitor who opened this
     page in a background tab — or behind a phone's lock screen — came back
     to a heading promising a diagram above a blank canvas, permanently,
     because the loop had never started and nothing would restart it.

     320 ticks over 179 nodes is a few tens of milliseconds. Doing it in one
     pass inside an idle callback keeps it off the critical path, always
     produces a picture, needs no animation frames, and cannot be left
     half-finished. The layout is deterministic, so it is the same picture
     the animation would have arrived at. */
  function solve() {
    var minDeg = minDegForWidth();
    applyView(minDeg);
    seed();
    for (var k = 0; k < SETTLE; k++) tick(1 - (k / SETTLE) * 0.95);
    paint();

    /* Two different reasons a term can be missing, and they must not be
       described by the same sentence. At full width the only ones left out
       are those with no cross-references, which have nothing to draw. On a
       narrow screen weakly-linked terms are dropped as well, and that IS a
       space decision — saying "no room" on a desktop where there is plenty
       would be a straightforwardly false caption. */
    if (caption) {
      var missing = allNodes.length - nodes.length;
      if (!missing) {
        caption.textContent = nodes.length + ' terms, ' + edges.length + ' cross-references.';
      } else if (minDeg <= 1) {
        caption.textContent = nodes.length + ' terms and ' + edges.length + ' cross-references. ' +
          missing + ' more have no cross-reference to draw, so they are in the list below only.';
      } else {
        caption.textContent = 'Narrow screen: showing the ' + nodes.length +
          ' most cross-referenced terms of ' + allNodes.length +
          '. Every term is in the list below.';
      }
    }
    running = false;
  }

  function run() {
    if (running) return;
    running = true;
    if (window.requestIdleCallback && !reduced) {
      requestIdleCallback(solve, { timeout: 800 });
    } else {
      solve();
    }
  }

  function at(event) {
    var box = canvas.getBoundingClientRect();
    var scale = W / box.width;
    var x = (event.clientX - box.left) * scale;
    var y = (event.clientY - box.top) * scale;
    /* 22 CSS pixels of tolerance, held constant in screen terms. In graph
       units that is 22 on a wide column and 66 on a phone, which is what
       keeps a dot tappable rather than a test of aim. */
    var tol = 22 * unit;
    var best = null, bestD = tol * tol;
    for (var k = 0; k < nodes.length; k++) {
      var dx = nodes[k].x - x, dy = nodes[k].y - y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = nodes[k]; }
    }
    return best;
  }

  canvas.addEventListener('pointermove', function (event) {
    var n = at(event);
    if (n === hover) return;
    hover = n;
    canvas.style.cursor = n ? 'pointer' : 'default';
    if (readout) {
      readout.textContent = n
        ? n.name + ' — ' + n.deg + ' connection' + (n.deg === 1 ? '' : 's')
        : '';
    }
    if (!running) paint();
  });

  canvas.addEventListener('pointerleave', function () {
    hover = null;
    if (readout) readout.textContent = '';
    if (!running) paint();
  });

  canvas.addEventListener('click', function (event) {
    var n = at(event);
    if (!n) return;
    var target = document.getElementById(n.id);
    if (!target) return;
    /* Jump to the entry rather than navigating: the graph is a way around
       the page it is on, not a link to somewhere else. */
    target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    location.hash = n.id;
  });

  if (shake) shake.addEventListener('click', run);

  var resizeGate = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeGate);
    resizeGate = window.setTimeout(function () { if (!running) paint(); }, 180);
  });

  section.hidden = false;
  run();
})();

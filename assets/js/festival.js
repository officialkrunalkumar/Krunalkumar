/* ==========================================================================
   festival.js — what /festival knows that /birthday does not.
   --------------------------------------------------------------------------
   Very little, and deliberately so. The festival table, the fuzzy resolver
   and the palette-per-festival live in festival-data.js (shared with the
   generator, so the preview cannot lie about what a festival looks like);
   the scene, particles, reveal and share bar live in celebrate.js. This file
   is the join between them.

   THE ONE REAL DECISION HERE is that /festival has no theme picker, unlike
   /birthday. The festival IS the theme — Diwali is lamplight and fireworks,
   Christmas is pine and snow, Yom Kippur is muted silver and still stars.
   Offering a second dial on top of that would let somebody send Yom Kippur
   in neon, which is exactly the kind of thing this page must not make
   possible. One concept per page.

   The palette therefore arrives as data and is set as CSS custom properties
   by celebrate.js, rather than as [data-scene] blocks the way birthday
   themes are — ninety palettes as CSS would be a stylesheet nobody could
   maintain. Both routes feed the same six variables.
   ========================================================================== */

(function () {
  'use strict';

  var wish = window.KSWish;
  if (!wish || !window.KSCelebrate || !window.KSFestivals) return;

  /* ?name= carries the festival here, not a person. The guard already
     sanitised it; resolve() does the rest and never throws — an unrecognised
     string comes back as a generic celebration addressed to whatever was
     typed, because there are thousands of festivals and a shrug is the wrong
     answer to a real one that simply is not in the table. */
  var scene = window.KSFestivals.scene(wish.name);

  /* The motif is the festival's emoji, set as text on the <span> the page
     ships in place of birthday's inline cake. An emoji rather than ninety
     hand-drawn SVGs: it is the one glyph set that already has a correct,
     recognisable symbol for every festival here, it renders in the visitor's
     own font so it looks native on their device, and it costs nothing. */
  var glyph = document.querySelector('[data-c-glyph]');
  if (glyph) glyph.textContent = scene.glyph;

  /* Days of mourning, atonement and remembrance. Set BEFORE mount so the
     festoon lights are gone on the first paint rather than twinkling for a
     frame and then withdrawing — on Ashura or Yom Kippur that single frame is
     exactly the thing this flag exists to prevent. celebrate.css keys the
     whole solemn treatment off this attribute. */
  if (scene.solemn) document.body.setAttribute('data-solemn', 'true');

  window.KSCelebrate.mount({
    mode: 'festival',
    greeting: scene.greeting,
    /* Carried for the image export, which draws the emoji with fillText
       rather than cloning the <span>. */
    glyph: scene.glyph,
    /* Empty for festivals whose greeting already names them, which is what
       keeps "Happy Diwali" from being captioned "Diwali". */
    label: scene.label,
    /* No separate name line — the greeting is the whole headline. celebrate.css
       gives .c-greet the display size when data-mode="festival". */
    name: '',
    blurb: scene.blurb,
    from: wish.from,
    palette: scene.palette,
    particles: scene.particles,
    colors: scene.colors,
    title: scene.greeting + (scene.known ? '' : '!')
  });
})();

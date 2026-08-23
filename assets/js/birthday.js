/* ==========================================================================
   birthday.js — what /birthday knows that /festival does not.
   --------------------------------------------------------------------------
   Almost nothing, which is the point: the scene, the particles, the reveal,
   the share bar and the URL wipe all live in celebrate.js. This file is the
   six themes, a line to say under the name, and the call that starts it.

   THE SIX THEMES are not colour swaps. Each pairs a palette (defined in
   celebrate.css under [data-scene]) with a particle style and a set of
   particle colours, and the three move together — candlelight drifts embers
   upward, blossom lets petals fall, neon throws fireworks. That is why the
   generator previews them rather than offering a list of names: "starlit"
   means nothing until you have seen that it is gold on midnight and is the
   one you send to your mother rather than to your flatmate.

   The particle COLOURS are listed here rather than read from the palette
   variables, because a particle field wants a wider spread than the three
   colours the type is built from — confetti in exactly two hues looks like a
   pattern rather than a party.
   ========================================================================== */

(function () {
  'use strict';

  var THEMES = {
    /* The default, and the one that suits the most people. Warm amber against
       a deep plum night: candles actually burning in a dark room. */
    candlelight: {
      particles: 'sparks',
      colors: ['#fbbf24', '#fde68a', '#fb7185', '#fcd34d', '#fff7ed']
    },

    /* Loud and young. What a seven-year-old should get. */
    confetti: {
      particles: 'confetti',
      colors: ['#38bdf8', '#f472b6', '#fef08a', '#4ade80', '#a78bfa', '#fb923c']
    },

    /* Balloons rising through a dusk sky. Slower and larger than anything
       else here — see the balloon spawner in celebrate.js for why. */
    balloons: {
      particles: 'balloons',
      colors: ['#f9a8d4', '#93c5fd', '#fef3c7', '#a7f3d0', '#fca5a5', '#c4b5fd']
    },

    /* Grown-up. Gold on midnight blue, no confetti anywhere — the one to send
       to a parent, a mentor or a boss without it reading as a party invite. */
    starlit: {
      particles: 'stars',
      colors: ['#fcd34d', '#fef9c3', '#a5b4fc', '#ffffff', '#fde68a']
    },

    /* Cherry blossom. Reads as affectionate rather than celebratory, which is
       exactly right for some people and completely wrong for others. */
    blossom: {
      particles: 'petals',
      colors: ['#fda4af', '#f0abfc', '#ffe4e6', '#fbcfe8', '#fecdd3']
    },

    /* On brand. The site's own cyan against near-black, for the people who
       would find a cake embarrassing. */
    neon: {
      particles: 'fireworks',
      colors: ['#22d3ee', '#e879f9', '#7dd3fc', '#a3e635', '#f0abfc']
    }
  };

  var DEFAULT_THEME = 'candlelight';

  /* One line under the name. Picked at random rather than fixed, so the
     handful of people who send several of these do not send the same card
     twice — and short, because the name is the message and this is the
     footnote. Deliberately free of "another year older" jokes: the same link
     gets sent to a nineteen-year-old and to somebody's grandmother. */
  var LINES = [
    'Wishing you a year that is kind to you.',
    'Here is to a year worth celebrating.',
    'May this year bring you everything you have been working toward.',
    'A whole year ahead, and it starts today.',
    'Wishing you health, good company and a very good year.',
    'May the year ahead be as good as you are to the people around you.',
    'Today is yours. Enjoy every hour of it.'
  ];

  var wish = window.KSWish;
  if (!wish || !window.KSCelebrate) return;

  /* An unknown ?theme= falls back rather than failing. Somebody will hand-edit
     the URL, and a wrong theme name should still produce a birthday page. */
  var themeName = Object.prototype.hasOwnProperty.call(THEMES, wish.theme) ? wish.theme : DEFAULT_THEME;
  var theme = THEMES[themeName];

  window.KSCelebrate.mount({
    mode: 'birthday',
    scene: themeName,
    greeting: 'Happy Birthday',
    name: wish.name,
    blurb: LINES[(Math.random() * LINES.length) | 0],
    from: wish.from,
    particles: theme.particles,
    colors: theme.colors,
    title: 'Happy Birthday, ' + wish.name + '!'
  });

  /* Exposed for the generator's preview, which renders the real thing in an
     iframe rather than reimplementing it — one source of truth for what a
     theme looks like, so a palette change cannot make the preview lie. */
  window.KSBirthdayThemes = THEMES;
})();

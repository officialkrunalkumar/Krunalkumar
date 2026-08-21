/* ==========================================================================
   einstein.js — the quotes on /einstein, and the small life in the lab.
   --------------------------------------------------------------------------
   EVERY QUOTE HERE IS SOURCED, and that is not pedantry. Einstein is the most
   misattributed person on the internet: a large share of what circulates under
   his name he never said. The buddha page cites every verse for exactly this
   reason, and a page of unsourced "Einstein quotes" would be the one thing on
   this site that could not survive being checked.

   Anything I could not tie to a letter, an interview or a published essay is
   not here. The ones people expect and will not find — the fish climbing a
   tree, insanity being repetition, compound interest as the eighth wonder,
   "if you can't explain it simply" — are listed in the markup as fakes,
   because saying what is false is as useful as saying what is true.
   ========================================================================== */

(function () {
  'use strict';

  var QUOTES = [
    {
      q: 'Imagination is more important than knowledge. For knowledge is limited, whereas imagination embraces the entire world, stimulating progress, giving birth to evolution.',
      s: 'Interview with George Sylvester Viereck, <em>Saturday Evening Post</em>, 26 October 1929'
    },
    {
      q: 'I have no special talent. I am only passionately curious.',
      s: 'Letter to Carl Seelig, 11 March 1952'
    },
    {
      q: 'The important thing is not to stop questioning. Curiosity has its own reason for existing.',
      s: '&ldquo;Old Man&rsquo;s Advice to Youth&rdquo;, <em>LIFE</em>, 2 May 1955'
    },
    {
      q: 'Try not to become a man of success, but rather try to become a man of value.',
      s: '<em>LIFE</em>, 2 May 1955'
    },
    {
      q: 'Life is like riding a bicycle. To keep your balance, you must keep moving.',
      s: 'Letter to his son Eduard, 5 February 1930'
    },
    {
      q: 'The whole of science is nothing more than a refinement of everyday thinking.',
      s: '&ldquo;Physics and Reality&rdquo;, <em>Journal of the Franklin Institute</em>, March 1936'
    },
    {
      q: 'Peace cannot be kept by force; it can only be achieved by understanding.',
      s: 'Collected in <em>Einstein on Peace</em> (1960), from his writing of the 1930s'
    },
    {
      q: 'The most beautiful experience we can have is the mysterious. It is the fundamental emotion which stands at the cradle of true art and true science.',
      s: '<em>The World As I See It</em> (1931)'
    },
    {
      q: 'A hundred times every day I remind myself that my inner and outer life are based on the labours of other men, living and dead.',
      s: '<em>The World As I See It</em> (1931)'
    },
    {
      q: 'Great spirits have always encountered violent opposition from mediocre minds.',
      s: 'Letter to Morris Raphael Cohen, 19 March 1940'
    },
    {
      q: 'Never lose a holy curiosity.',
      s: '&ldquo;Old Man&rsquo;s Advice to Youth&rdquo;, <em>LIFE</em>, 2 May 1955'
    },
    {
      q: 'The value of a man should be seen in what he gives and not in what he is able to receive.',
      s: '<em>LIFE</em>, 2 May 1955'
    },
    {
      q: 'Everything that is really great and inspiring is created by the individual who can labour in freedom.',
      s: '<em>Out of My Later Years</em> (1950)'
    },
    {
      q: 'Science without religion is lame, religion without science is blind.',
      s: '&ldquo;Science and Religion&rdquo; (1941), in <em>Out of My Later Years</em>'
    }
  ];

  var quoteEl = document.querySelector('.e-quote-text');
  var sourceEl = document.querySelector('.e-quote-source');
  var announce = document.querySelector('.e-announce');
  var card = document.querySelector('.e-quote');
  if (!quoteEl || !sourceEl) return;

  /* Never the same twice running. A random pick from fourteen repeats often
     enough to be noticed, and being shown the quote you just read is the one
     thing that makes a page like this feel broken. */
  var last = -1;

  function pick() {
    var i = Math.floor(Math.random() * QUOTES.length);
    if (QUOTES.length > 1) {
      while (i === last) i = Math.floor(Math.random() * QUOTES.length);
    }
    last = i;
    return QUOTES[i];
  }

  function show(quiet) {
    var item = pick();
    if (card) {
      card.classList.remove('is-fresh');
      void card.offsetWidth;          // reflow, so the animation restarts
      card.classList.add('is-fresh');
    }
    quoteEl.textContent = item.q;
    sourceEl.innerHTML = item.s;
    /* The live region carries the quote but not the citation markup — a screen
       reader announcing "em Saturday Evening Post em" helps nobody. */
    if (!quiet && announce) {
      announce.textContent = item.q + ' — ' + item.s.replace(/<[^>]+>/g, '');
    }
  }

  show(true);

  var btn = document.querySelector('.e-another');
  if (btn) btn.addEventListener('click', function () { show(); });

  /* The figure is a button too, the same way the buddha is. Somebody who wants
     another quote reaches for the picture before they read the label. */
  var figure = document.querySelector('.e-figure');
  if (figure) {
    figure.addEventListener('click', function () {
      figure.classList.remove('is-eureka');
      void figure.offsetWidth;
      figure.classList.add('is-eureka');
      show();
    });
  }

  /* Blink. Not on a timer alone — a perfectly regular blink is unsettling in a
     way people notice without being able to say why, so each one schedules the
     next at its own interval. */
  var eyes = document.querySelector('.e-eyes');
  if (eyes && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    (function blink() {
      window.setTimeout(function () {
        eyes.classList.add('is-blinking');
        window.setTimeout(function () { eyes.classList.remove('is-blinking'); }, 150);
        blink();
      }, 2600 + Math.random() * 4200);
    })();
  }
})();

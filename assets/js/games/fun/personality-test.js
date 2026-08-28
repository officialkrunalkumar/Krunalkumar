/* ==========================================================================
   personality-test.js — a short Big Five inventory.
   --------------------------------------------------------------------------
   BIG FIVE, NOT SIXTEEN TYPES. The four-letter type indicators are much more
   fun to share and have almost no predictive validity — they are not stable
   on retest and the dichotomies are not bimodal in the data. The five-factor
   model is the one psychometrics actually uses, and it is what serious
   employment assessments are built on, which is exactly what the person
   asking for "the test companies make you do" has in mind.

   Thirty items, six per trait, half of them REVERSE-KEYED: a question worded
   the opposite way that scores backwards. Without those, anyone who simply
   agrees with everything comes out identical to somebody thoughtful, and
   acquiescence bias becomes the thing being measured.

   The result says plainly that it is a short questionnaire and not a
   diagnosis. That matters more here than anywhere else on the site.
   ========================================================================== */

(function () {
  'use strict';

  var LIKERT = [
    { label: 'Strongly disagree', v: 1 },
    { label: 'Disagree', v: 2 },
    { label: 'Neither', v: 3 },
    { label: 'Agree', v: 4 },
    { label: 'Strongly agree', v: 5 }
  ];

  /* [statement, trait, reversed] */
  var ITEMS = [
    ['I start conversations with people I do not know.', 'E', false],
    ['I feel drained after a long evening with a crowd.', 'E', true],
    ['I am comfortable being the centre of attention.', 'E', false],
    ['I prefer to work quietly on my own.', 'E', true],
    ['I find it easy to introduce myself to strangers.', 'E', false],
    ['I keep in the background at gatherings.', 'E', true],

    ['I go out of my way to make people feel at ease.', 'A', false],
    ['I am quick to point out when somebody is wrong.', 'A', true],
    ['I take time to understand a view I disagree with.', 'A', false],
    ['I am not much interested in other people’s problems.', 'A', true],
    ['I give people the benefit of the doubt.', 'A', false],
    ['I can be blunt when somebody is wasting my time.', 'A', true],

    ['I finish what I start, even when it stops being interesting.', 'C', false],
    ['I leave things until the last possible moment.', 'C', true],
    ['I keep my work and my files in order.', 'C', false],
    ['I often forget to put things back where they belong.', 'C', true],
    ['I make plans and follow them through.', 'C', false],
    ['I get distracted partway through a task.', 'C', true],

    ['I stay calm when things go wrong unexpectedly.', 'N', true],
    ['I worry about things that may never happen.', 'N', false],
    ['I am upset by criticism for longer than I would like.', 'N', false],
    ['I recover quickly after a stressful day.', 'N', true],
    ['My mood can change quite suddenly.', 'N', false],
    ['I rarely feel anxious about the future.', 'N', true],

    ['I enjoy thinking about abstract ideas for their own sake.', 'O', false],
    ['I would rather stick with what I know works.', 'O', true],
    ['I like trying food, music or places I have never tried.', 'O', false],
    ['I find most art and poetry a bit pointless.', 'O', true],
    ['I ask questions about how things work underneath.', 'O', false],
    ['I am uncomfortable when a plan changes halfway.', 'O', true]
  ];

  var TRAITS = {
    O: { name: 'Openness', low: 'practical, prefers the proven', high: 'curious, drawn to the new' },
    C: { name: 'Conscientiousness', low: 'flexible, works in bursts', high: 'organised, finishes things' },
    E: { name: 'Extraversion', low: 'reserved, recharges alone', high: 'outgoing, energised by people' },
    A: { name: 'Agreeableness', low: 'direct, comfortable with friction', high: 'accommodating, avoids conflict' },
    N: { name: 'Emotional volatility', low: 'steady under pressure', high: 'reacts strongly, feels things fast' }
  };

  var ORDER = ['O', 'C', 'E', 'A', 'N'];

  /* Blend the two highest traits into a description, so two people with the
     same top trait do not get identical text. */
  function describe(pct) {
    var ranked = ORDER.slice().sort(function (a, b) { return pct[b] - pct[a]; });
    var top = ranked[0], second = ranked[1], bottom = ranked[4];
    var high = function (k) { return pct[k] >= 60; };
    var low = function (k) { return pct[k] <= 40; };

    var lines = [];
    if (high('C') && high('O')) lines.push('You want the new thing <em>and</em> you want it finished, which is a rarer combination than it sounds and an exhausting one to live with.');
    else if (high('C') && low('O')) lines.push('You get things done and you are not interested in reinventing how. That is what most work actually needs.');
    else if (high('O') && low('C')) lines.push('Plenty of ideas, fewer finished. Worth pairing yourself with somebody who closes things.');
    if (high('E') && high('A')) lines.push('People find you easy, and you find people easy. That is a real asset and it is also how you end up with everybody else’s work.');
    if (low('E') && high('C')) lines.push('You do your best work with the door shut, and it shows.');
    if (high('N')) lines.push('You feel things quickly. That is not a fault &mdash; it usually comes with noticing things other people miss &mdash; but it costs more on a bad week.');
    if (low('N')) lines.push('You are hard to rattle, which is worth a great deal in a crisis and can read as indifference when it is not.');
    if (low('A')) lines.push('You will say the awkward thing. Teams need one of you and rarely enjoy having two.');

    if (!lines.length) lines.push('You sit near the middle on most of these, which is where most people actually are &mdash; the extremes get written about because they are unusual, not because they are better.');

    return '<strong>' + TRAITS[top].name + '</strong> is your strongest reading, with <strong>' +
           TRAITS[second].name.toLowerCase() + '</strong> behind it and <strong>' +
           TRAITS[bottom].name.toLowerCase() + '</strong> lowest. ' + lines.join(' ');
  }

  var questions = [];
  for (var i = 0; i < ITEMS.length; i++) {
    (function (item) {
      var opts = [];
      for (var k = 0; k < LIKERT.length; k++) {
        var raw = LIKERT[k].v;
        /* Reverse-keyed items score 6 minus the answer, which is what stops
           "agree with everything" from producing a profile. */
        var value = item[2] ? (6 - raw) : raw;
        var scores = {};
        scores[item[1]] = value;
        opts.push({ label: LIKERT[k].label, scores: scores });
      }
      questions.push({ q: item[0], options: opts });
    })(ITEMS[i]);
  }

  GameShell.define({
    id: 'game-personality-test',
    slug: 'personality-test',
    title: 'Personality test',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      return QuizKit.mount(g, {
        questions: questions,
        result: function (totals) {
          /* Six items per trait, 1..5 each, so 6..30. Rescaled to 0..100. */
          var pct = {};
          for (var t = 0; t < ORDER.length; t++) {
            var raw = totals[ORDER[t]] || 6;
            pct[ORDER[t]] = Math.round(((raw - 6) / 24) * 100);
          }
          var bars = [];
          for (var b = 0; b < ORDER.length; b++) {
            var k = ORDER[b];
            bars.push({
              name: TRAITS[k].name,
              pct: pct[k],
              note: pct[k] >= 60 ? TRAITS[k].high : pct[k] <= 40 ? TRAITS[k].low : 'middling'
            });
          }
          return { title: 'Your five readings', body: describe(pct), bars: bars };
        },
        disclaimer: 'This is a thirty-item questionnaire, not an assessment. It measures how you answered ' +
          'today, which is not quite the same as what you are like &mdash; scores move with mood, and the ' +
          'shortest respectable version of this instrument is twice as long. Useful for reflection, useless ' +
          'for deciding anything about anybody. Nothing you answered left your browser.'
      });
    }
  });
})();

/* ==========================================================================
   career-quiz.js — which part of technology suits the way you work.
   --------------------------------------------------------------------------
   Two decisions worth writing down.

   THE QUESTION SET IS BALANCED BY CONSTRUCTION. Every question offers three
   options and each of the six tracks appears in exactly nine of the eighteen
   questions. That is what lets the bars mean something specific — a track's
   percentage is how often you picked it WHEN IT WAS OFFERED, not its share
   of your total points. Without the balance, whichever track happened to be
   listed most often would win most quizzes, and the result would be
   measuring the author rather than the reader.

   EVERY TRACK WRITE-UP CARRIES ITS TEDIUM. A careers quiz that lists only
   the good parts is an advert. The grind line is the one people actually
   need, because the difference between these jobs on a good day is small
   and the difference on a dull Tuesday is enormous.
   ========================================================================== */

(function () {
  'use strict';

  /* Order here is fixed: it decides tie-breaks and the order of the pair
     lookup keys below. */
  var TRACKS = [
    {
      key: 'security',
      name: 'Security',
      day: 'Reviewing somebody else’s design for what could be abused, triaging alerts, working out whether a report is a real problem or a scanner being loud, and writing findings up so that a team who did not plan for it will actually act.',
      grind: 'Most alerts are nothing. A lot of the role is asking other people to do unplanned work, being the person who says no, and gathering evidence for audits that nobody enjoys on either side.'
    },
    {
      key: 'backend',
      name: 'Backend',
      day: 'Modelling data, shaping the interfaces between services, and making things stay correct when there are far more of them than you tested with. Long stretches of reading code that already exists before writing any.',
      grind: 'Migrations that must not lose a row, dependency upgrades, and faults that only appear in production under load. The reward for good work is that nobody notices it.'
    },
    {
      key: 'frontend',
      name: 'Frontend',
      day: 'Building the screens people touch: the states nobody sketched — loading, empty, error, half-typed — keyboard and screen-reader behaviour, and the loop between a design and something real enough to argue about.',
      grind: 'The last tenth of the polish takes as long as the rest. Device and browser differences, the same form built again slightly differently, and a steady drip of small copy and spacing changes.'
    },
    {
      key: 'data',
      name: 'Data',
      day: 'Getting numbers out of systems that were not built to give them up, deciding whether an effect is real or noise, and explaining uncertainty to people who wanted one figure.',
      grind: 'Cleaning and reconciling takes most of the week. Two systems disagree and you have to decide which is wrong. Sometimes the number you produce is not the one the room was hoping for.'
    },
    {
      key: 'infrastructure',
      name: 'Infrastructure',
      day: 'Build and deploy pipelines, monitoring that fires for real reasons, permissions, capacity and cost. Turning things people do by hand into things nobody has to think about.',
      grind: 'On-call. Upgrades that buy no new features. Toil that comes back a quarter after you removed it, and a job that is invisible when it works and extremely visible for the twenty minutes it does not.'
    },
    {
      key: 'product',
      name: 'Product',
      day: 'Talking to users, to support and to sales, then deciding what not to build. Writing the problem down in one sentence, sequencing the work, and keeping a team pointed at the same thing.',
      grind: 'Meetings, and a queue of requests longer than any team can serve. You have very little authority and have to persuade instead, and when a bet does not land it does so in public.'
    }
  ];

  /* Pair notes, keyed by the two track indices in ascending order. Two
     tracks describe a job far better than one does — "security" alone covers
     a penetration tester and a compliance lead, who share almost nothing. */
  var PAIRS = {
    '0|1': 'Application security, or secure platform work — the people who can read the code well enough to say why the flaw is a flaw rather than just that a tool flagged it.',
    '0|2': 'The client-side and human end of security: session handling, what a browser gives away, and sign-in flows that survive somebody being fooled.',
    '0|3': 'Detection engineering, or fraud and abuse work, where most of the job is deciding which signals deserve to wake a human.',
    '0|4': 'Cloud security and identity: permissions, network boundaries, and the pipeline that has to enforce them without stopping everybody else working.',
    '0|5': 'Trust and safety, or security inside a customer-facing product, where the argument is as much about what to allow as about what to block.',
    '1|2': 'Full-stack product engineering, usually in a small team, where owning a feature end to end matters more than depth in either half.',
    '1|3': 'Data engineering — pipelines, schemas and correctness at volume, which is a backend job wearing a different hat.',
    '1|4': 'Platform engineering: the services and tooling other engineers build on, judged by how little they have to think about you.',
    '1|5': 'Technical product work, or an early engineer at a small company, where the shape of the system and the question of what to build are one conversation.',
    '2|3': 'Analytics interfaces and data visualisation — making a number legible without quietly making it a lie.',
    '2|4': 'Web performance and frontend platform work: build tooling, bundle size, and what actually loads on a cheap phone on a bad connection.',
    '2|5': 'Design engineering — living between the mock-up and the shipped screen, and usually the person who notices the empty state was never designed.',
    '3|4': 'Analytics or machine-learning platform work: keeping the pipelines, the compute and the bill upright so other people can ask questions.',
    '3|5': 'Product analytics and experimentation, where the real skill is telling a team clearly what the numbers cannot tell them.',
    '4|5': 'Developer experience and internal platforms, where your users are colleagues, they are technical, and they will tell you exactly what they think.'
  };

  /* Eighteen questions, three options each, every track in exactly nine.
     All of them ask about working style or about what you find satisfying.
     None of them asks whether you know something, because knowing a thing
     and enjoying it all day are unrelated, and a careers quiz that tests
     knowledge just tells you what you have already studied. */
  var Q = [
    { q: 'A week has gone well when…', o: [
      ['I found something everybody else had walked past', 'security'],
      ['the thing I built kept working while nobody thought about it', 'backend'],
      ['somebody used what I made without needing to be shown how', 'frontend']
    ] },
    { q: 'Somebody hands you a messy spreadsheet from another team. Your first instinct:', o: [
      ['work out what these numbers are actually counting', 'data'],
      ['write something so nobody has to do this by hand again', 'infrastructure'],
      ['ask what decision it is meant to inform', 'product']
    ] },
    { q: 'Which of these irritates you most?', o: [
      ['A process everyone follows that quietly protects nothing', 'security'],
      ['A chart with no axis labels being used to win an argument', 'data'],
      ['A button that does not look like a button', 'frontend']
    ] },
    { q: 'An afternoon opens up with nothing scheduled in it. You spend it…', o: [
      ['tidying a join between two parts of the system that never fitted', 'backend'],
      ['making the deploy faster, or one step less manual', 'infrastructure'],
      ['watching somebody use the thing and noting where they hesitate', 'product']
    ] },
    { q: 'The kind of problem you would happily chase for two days:', o: [
      ['why that request was allowed when it should not have been', 'security'],
      ['why it works on this machine and not that one', 'infrastructure'],
      ['why the totals drift by one, but only under load', 'backend']
    ] },
    { q: 'Which sentence would you most like to hear about your work?', o: [
      ['It feels quicker now.', 'frontend'],
      ['We stopped arguing once we saw your figures.', 'data'],
      ['We dropped that feature and nobody missed it.', 'product']
    ] },
    { q: 'In a planning meeting, you are usually the person who asks…', o: [
      ['what happens if somebody does this deliberately', 'security'],
      ['who this is for, and what they do instead today', 'product'],
      ['what happens when there are a hundred times more of them', 'backend']
    ] },
    { q: 'Pick the tedious job you would mind least:', o: [
      ['going through every screen on a small phone fixing what wraps badly', 'frontend'],
      ['reading logs until the pattern shows itself', 'infrastructure'],
      ['cleaning inconsistent records until the set can be trusted', 'data']
    ] },
    { q: 'How would you rather be judged?', o: [
      ['on what did not happen', 'security'],
      ['on something people can see and touch', 'frontend'],
      ['on how rarely anyone has to think about my part', 'infrastructure']
    ] },
    { q: 'You would rather spend a whole day…', o: [
      ['deciding the shape of the data before writing anything', 'backend'],
      ['finding out whether an effect is real or just noise', 'data'],
      ['sitting with three users and asking questions', 'product']
    ] },
    { q: 'A rule you would defend even when it makes you unpopular:', o: [
      ['no shared logins, not even for the small internal tool', 'security'],
      ['no number on a slide without saying where it came from', 'data'],
      ['nothing reaches production by hand', 'infrastructure']
    ] },
    { q: 'Which unfinished thing would nag at you on a Friday evening?', o: [
      ['an error path I know is not handled', 'backend'],
      ['a layout that jumps about while the page loads', 'frontend'],
      ['a feature we shipped that nobody has opened', 'product']
    ] },
    { q: 'Work is most enjoyable when it is…', o: [
      ['adversarial — somebody out there is trying to get past it', 'security'],
      ['structural — pieces that have to fit exactly', 'backend'],
      ['investigative — the answer is in there and does not want to come out', 'data']
    ] },
    { q: 'The compliment that would land best:', o: [
      ['It is genuinely nice to use.', 'frontend'],
      ['It has never once been down.', 'infrastructure'],
      ['You stopped us building the wrong thing.', 'product']
    ] },
    { q: 'How do you feel about being on call?', o: [
      ['Fine — an incident is when the work matters most', 'security'],
      ['I would rather nothing I make ever wakes anybody, me included', 'frontend'],
      ['Fine, as long as I own the code that pages me', 'backend']
    ] },
    { q: 'A month with no deadlines and nobody asking. You would…', o: [
      ['measure something nobody here has measured yet', 'data'],
      ['rebuild the dull plumbing that costs everyone an hour a week', 'infrastructure'],
      ['write down what we should stop doing, and argue for it', 'product']
    ] },
    { q: 'Which would you actually read from start to finish?', o: [
      ['a write-up of how a company was broken into', 'security'],
      ['another team’s post-mortem on an outage', 'infrastructure'],
      ['the method behind a result that surprised you', 'data']
    ] },
    { q: 'Given a vague brief, you start by…', o: [
      ['drawing the pieces and how they talk to each other', 'backend'],
      ['sketching a screen and seeing if it survives a real person', 'frontend'],
      ['pushing back until the problem fits in one sentence', 'product']
    ] }
  ];

  function trackIndex(key) {
    for (var i = 0; i < TRACKS.length; i++) {
      if (TRACKS[i].key === key) return i;
    }
    return -1;
  }

  /* How many questions each track was offered in. Counted from Q rather
     than written down, so editing a question cannot leave the percentages
     silently wrong. */
  function appearances() {
    var counts = {};
    var i, j;
    for (i = 0; i < TRACKS.length; i++) counts[TRACKS[i].key] = 0;
    for (i = 0; i < Q.length; i++) {
      for (j = 0; j < Q[i].o.length; j++) counts[Q[i].o[j][1]]++;
    }
    return counts;
  }

  var questions = Q.map(function (item) {
    return {
      q: item.q,
      options: item.o.map(function (o) {
        var s = {};
        s[o[1]] = 1;
        return { label: o[0], scores: s };
      })
    };
  });

  function trackBlock(t) {
    return '<span class="career-track">' +
      '<span class="career-track-name">' + t.name + '</span>' +
      '<span class="career-line">' + t.day + '</span>' +
      '<span class="career-grind">The dull part: ' + t.grind + '</span>' +
      '</span>';
  }

  GameShell.define({
    id: 'game-career-quiz',
    slug: 'career-quiz',
    title: 'Tech career quiz',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      return QuizKit.mount(g, {
        questions: questions,
        result: function (totals) {
          var counts = appearances();
          var rows = [];
          var i;

          for (i = 0; i < TRACKS.length; i++) {
            var key = TRACKS[i].key;
            var picked = totals[key] || 0;
            rows.push({
              track: TRACKS[i],
              order: i,
              picked: picked,
              offered: counts[key],
              pct: counts[key] ? (picked / counts[key]) * 100 : 0
            });
          }

          /* Ties break on the declared track order rather than on whatever
             order the sort happens to produce, so the same answers always
             give the same result. */
          rows.sort(function (a, b) {
            if (b.picked !== a.picked) return b.picked - a.picked;
            return a.order - b.order;
          });

          var first = rows[0];
          var second = rows[1];
          var pairKey = Math.min(first.order, second.order) + '|' + Math.max(first.order, second.order);

          var body = '<strong>' + first.track.name + ', then ' + second.track.name + '.</strong> ';
          body += 'You picked the ' + first.track.name.toLowerCase() + ' answer ' + first.picked +
            ' of the ' + first.offered + ' times it was on offer, and the ' +
            second.track.name.toLowerCase() + ' one ' + second.picked + ' of ' + second.offered + '.';

          /* A flat spread is a real outcome and should be said out loud
             rather than dressed up as a top-two. */
          if (first.picked - rows[rows.length - 1].picked <= 2) {
            body += ' Although your answers barely leaned anywhere — the six came out close enough that ' +
              'the order at the top is close to arbitrary. Read all of them.';
          } else if (rows[2].picked === second.picked) {
            body += ' ' + rows[2].track.name + ' tied for second, so treat that one as equally likely.';
          }

          body += '<span class="career-pair">' + (PAIRS[pairKey] || '') + '</span>';
          body += trackBlock(first.track);
          body += trackBlock(second.track);

          body += '<span class="career-honest">A quiz cannot tell you what to do for a living. Eighteen ' +
            'questions can only say which kind of work you find appealing to think about, which is not the ' +
            'same as what you are good at, what pays where you live, or what you will still want at forty. ' +
            'People also move between all six of these repeatedly, and the skills carry. The only test that ' +
            'settles it is doing a few weeks of the actual work — there is more on that in ' +
            '<a href="/blog/finding-the-right-career">finding the right career</a>, and the ' +
            '<a href="/internships">internships</a> here exist for exactly that reason.</span>';

          var bars = [];
          for (i = 0; i < rows.length; i++) {
            bars.push({
              name: rows[i].track.name,
              pct: rows[i].pct,
              note: 'picked ' + rows[i].picked + ' of ' + rows[i].offered
            });
          }

          return {
            title: first.track.name + ' and ' + second.track.name,
            body: body,
            bars: bars
          };
        },
        disclaimer: 'This measures preference, not aptitude, and it only knows the six tracks it was written ' +
          'with — there is no option here for QA, technical writing, support engineering, research or the ' +
          'dozen other jobs that keep software running. Each track appears in exactly nine questions so no ' +
          'result is favoured by the wording. Nothing you answered left your browser and nothing was stored.'
      });
    }
  });
})();

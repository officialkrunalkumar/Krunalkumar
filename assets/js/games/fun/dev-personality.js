/* ==========================================================================
   dev-personality.js — what kind of developer are you, roughly.
   --------------------------------------------------------------------------
   Two decisions worth writing down.

   THE SCORE IS A SHARE, NOT A TOTAL. The six archetypes are not offered an
   equal number of times — some questions have five plausible answers and
   some have six, and forcing every type into every question produced filler
   options nobody would ever pick. So each type's bar is its share of the
   points you actually awarded, which is comparable across a run no matter
   how the options fell. Sixteen questions, one dominant answer each, so an
   even spread lands near 17% and a strong type sits well above it.

   EVERY RESULT NAMES A FAILURE MODE. A type with only upside is flattery,
   and flattery is the reason these quizzes are worthless. The failure modes
   here are the real ones — the archaeologist who can explain the bad code
   but never changes it, the firefighter a team quietly comes to depend on
   instead of fixing causes — and they are the half of the result worth
   reading.
   ========================================================================== */

(function () {
  'use strict';

  var TYPES = {
    dig: {
      name: 'The archaeologist',
      good: 'You do not touch code until you know how it got that way. Git log, the closed pull requests, ' +
        'the ticket from four years ago that explains the strange branch &mdash; you read them, and you are ' +
        'usually the only person on the team who can say why anything is the way it is. That is worth more ' +
        'than it looks: most bad rewrites are somebody deleting a workaround whose reason was never written down.',
      flaw: 'You can spend a whole day proving why a line exists and still not change it. Understanding turns ' +
        'into deference &mdash; the history explains why the code is bad, it does not oblige you to keep it. ' +
        'And a reason from 2019 is not automatically a reason today.',
      low: 'You start from what the code does rather than why it does it, which is quicker until the day you ' +
        'remove something load-bearing.'
    },
    fire: {
      name: 'The firefighter',
      good: 'You are calm when the graphs go the wrong way, and you get sharper rather than vaguer at two in ' +
        'the morning. You think about failure before you think about features: what pages, what the rollback ' +
        'is, what happens when the dependency stops answering. Everyone is grateful for you about four times ' +
        'a year and mildly puzzled by you the rest of the time.',
      flaw: 'You are rewarded for the thing you should want less of. Teams learn they can rely on your ' +
        'recovery instead of fixing the cause, and the incident is more interesting than the boring change ' +
        'that would have prevented it. Watch for the week where you quietly enjoyed the outage.',
      low: 'You build for the working case. That is fine until you are the one holding the pager for it.'
    },
    grow: {
      name: 'The gardener',
      good: 'You leave things better than you found them, in small amounts, constantly. A rename here, a dead ' +
        'config path deleted there, a test around the bit everyone is frightened of. You are why the codebase ' +
        'has not rotted, and nobody will ever be able to point at the quarter you did it in, because it was ' +
        'all of them.',
      flaw: 'Tidying is infinitely available and always feels like progress. You can spend a fortnight ' +
        'improving code that was about to be deleted, and your reviews can turn into one more rename until ' +
        'the other person stops caring. Not every mess is yours to fix this week.',
      low: 'You work around what annoys you rather than fixing it, which is cheap each time and expensive ' +
        'in aggregate.'
    },
    plan: {
      name: 'The architect',
      good: 'You think in boundaries. Where does this decision belong, what does this module promise, what ' +
        'happens at the seam &mdash; and you would rather spend Tuesday getting the shape right than spend ' +
        'six months routing around a shape that is wrong. The interfaces you draw tend to still make sense ' +
        'when somebody else is holding them.',
      flaw: 'You design for the system you imagine in three years rather than the one in front of you. The ' +
        'abstraction added before the third real case usually fits none of them, and a diagram nobody updates ' +
        'is worse than no diagram, because people trust it.',
      low: 'You let the structure emerge, which works right up to the change that cuts across every layer at once.'
    },
    ship: {
      name: 'The shipper',
      good: 'You have a strong sense of what is actually required, and it is nearly always less than what was ' +
        'asked for. You cut scope without drama, get something real in front of someone, and learn more in a ' +
        'week of use than a month of discussion would have told you. Work that never leaves the branch teaches ' +
        'nobody anything, and you know it.',
      flaw: 'The interest on a shortcut is paid by whoever is on call, and often that is you in six months. ' +
        '"We will tidy it later" is a promise that needs calendar time nobody has booked. Your worst outcome ' +
        'is a product that works and a codebase that no longer lets you change it.',
      low: 'You would rather it were right than out, which is a real virtue until the thing you are polishing ' +
        'turns out to be the wrong thing.'
    },
    tool: {
      name: 'The toolmaker',
      good: 'You notice the third time you do something by hand, and then it never happens by hand again. ' +
        'Scripts, generators, a test harness that runs the flaky thing two hundred times overnight &mdash; you ' +
        'build the thing that builds the thing, and the rest of the team gets faster without quite noticing why.',
      flaw: 'Sometimes the automation takes longer than the task ever would have, and now it has a bug and a ' +
        'maintainer, and the maintainer is you. A bespoke tool only you understand is a bus factor of one ' +
        'wearing a productivity costume.',
      low: 'You will do the manual step again rather than stop to automate it, which is the right call about ' +
        'half of the time.'
    }
  };

  var ORDER = ['dig', 'fire', 'grow', 'plan', 'ship', 'tool'];

  var QUESTIONS = [
    {
      q: 'You inherit a service nobody has touched in two years. What is the first hour?',
      options: [
        { label: 'Read the commit log and the merged pull requests until I know how it got this shape.', scores: { dig: 3 } },
        { label: 'Run it, break it deliberately, and watch which part falls over first.', scores: { fire: 2, tool: 1 } },
        { label: 'Draw the boxes and the arrows until the shape makes sense to me.', scores: { plan: 3 } },
        { label: 'Rename the three worst things and get a test around the scary bit.', scores: { grow: 3 } },
        { label: 'Find the smallest change that closes the ticket and stop there.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'A test fails about one run in thirty. What do you actually do?',
      options: [
        { label: 'Re-run it with more logging until I catch it in the act.', scores: { dig: 2, fire: 1 } },
        { label: 'Write something that runs it two hundred times in parallel overnight.', scores: { tool: 3 } },
        { label: 'Fix the shared state it is racing on, which usually settles four other tests too.', scores: { grow: 3 } },
        { label: 'Quarantine it, open a ticket, attach the last five failures.', scores: { plan: 2, ship: 1 } },
        { label: 'Mark it retry-on-failure and get on with the actual work.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'Somebody proposes rewriting the whole thing. Your first question is:',
      options: [
        { label: '"What does the current one do that nobody has written down?"', scores: { dig: 3 } },
        { label: '"Which three problems does this fix, and could we fix them in place?"', scores: { grow: 2, plan: 1 } },
        { label: '"Who is on call for both systems during the changeover?"', scores: { fire: 3 } },
        { label: '"What is in front of a user in the first fortnight?"', scores: { ship: 3 } },
        { label: '"Where do the boundaries go this time?"', scores: { plan: 3 } },
        { label: '"I will build the migration tooling."', scores: { tool: 3 } }
      ]
    },
    {
      q: 'The pager goes off at two in the morning. Honestly, how does it feel?',
      options: [
        { label: 'I am awake before the second buzz and oddly focused.', scores: { fire: 3 } },
        { label: 'Irritated for a minute, then genuinely curious about what got us here.', scores: { dig: 3 } },
        { label: 'Fine, as long as the runbook is any good &mdash; and if it is not, I rewrite it afterwards.', scores: { tool: 2, fire: 1 } },
        { label: 'Quietly furious that this class of failure was possible at all.', scores: { plan: 2, grow: 1 } },
        { label: 'I patch it, I sleep, I write the proper fix into next week.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'Where does your best work usually show up?',
      options: [
        { label: 'In a diff that deletes more than it adds.', scores: { grow: 3 } },
        { label: 'In an interface other people built on for years without complaining.', scores: { plan: 3 } },
        { label: 'In a script the whole team now uses without thinking about it.', scores: { tool: 3 } },
        { label: 'In a feature people were using the week it landed.', scores: { ship: 3 } },
        { label: 'In a postmortem that killed a whole class of outage.', scores: { fire: 3 } },
        { label: 'In a comment that finally explains why, ten years late.', scores: { dig: 3 } }
      ]
    },
    {
      q: 'A colleague asks why a particular function is written in such a strange way.',
      options: [
        { label: 'I know already &mdash; there is a bug report behind it, and I can find it.', scores: { dig: 3 } },
        { label: 'I do not know, and I want to know before either of us touches it.', scores: { dig: 2, plan: 1 } },
        { label: 'It was a workaround during an incident. I was there.', scores: { fire: 3 } },
        { label: 'It does not matter much now &mdash; it is covered by tests, so we can change it safely.', scores: { grow: 2, ship: 1 } }
      ]
    },
    {
      q: 'An unclaimed Friday afternoon. What do you reach for?',
      options: [
        { label: 'Deleting a dead code path and the config that was feeding it.', scores: { grow: 3 } },
        { label: 'Marking up next quarter’s design document.', scores: { plan: 3 } },
        { label: 'Automating the release checklist so nobody runs it by hand again.', scores: { tool: 3 } },
        { label: 'Landing the small thing that has been sitting in review all week.', scores: { ship: 3 } },
        { label: 'Chasing down where an unexplained config value came from.', scores: { dig: 3 } },
        { label: 'Making the alerts that fire and mean nothing stop firing.', scores: { fire: 3 } }
      ]
    },
    {
      q: 'A three-hundred-line pull request lands on you, and it works.',
      options: [
        { label: 'Fine, if the commits tell the story in order.', scores: { dig: 2, ship: 1 } },
        { label: 'Fine, but I want the seams named before we add the next three hundred.', scores: { plan: 3 } },
        { label: 'I approve it and open a follow-up to tidy what it touched.', scores: { grow: 2, ship: 1 } },
        { label: 'It needs a rollback plan before it needs anything else.', scores: { fire: 3 } },
        { label: 'Ship it. Review nits are cheaper to settle once it is live.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'There is a new tool the team could adopt. What is your move?',
      options: [
        { label: 'I trial it on a branch this week and report back with numbers.', scores: { tool: 3 } },
        { label: 'I ask what it does to our failure modes and who owns it at 3am.', scores: { fire: 2, plan: 1 } },
        { label: 'I ask what we get to delete when it arrives.', scores: { grow: 3 } },
        { label: 'I read about how it has gone wrong for other people first.', scores: { dig: 3 } },
        { label: 'If it means we ship sooner, yes.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'You are asked for an estimate on unfamiliar work.',
      options: [
        { label: 'I quote the time to understand the existing behaviour first, separately.', scores: { dig: 3 } },
        { label: 'I cannot say until the shape is settled, and I will say so.', scores: { plan: 3 } },
        { label: 'Something usable in front of somebody by Thursday, then we talk again.', scores: { ship: 3 } },
        { label: 'I double it, because something will be on fire that week.', scores: { fire: 3 } },
        { label: 'A chunk of it goes on tooling that makes the rest quicker.', scores: { tool: 3 } }
      ]
    },
    {
      q: 'Documentation. Which one is actually you?',
      options: [
        { label: 'Notes I take while reading the code, tidied up afterwards.', scores: { dig: 3 } },
        { label: 'A decision record written before the code, because the reasons evaporate otherwise.', scores: { plan: 3 } },
        { label: 'I would rather rename things until the document is not needed.', scores: { grow: 3 } },
        { label: 'Generated from the source, or it goes stale within a month.', scores: { tool: 3 } },
        { label: 'The runbook. Everything else is a nice-to-have.', scores: { fire: 3 } },
        { label: 'The README, kept to one page, updated when it is wrong.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'Someone reports a bug you cannot reproduce at all.',
      options: [
        { label: 'I ask which version they are on and read everything that changed between.', scores: { dig: 3 } },
        { label: 'I add the logging that would have told us, ship it, and wait.', scores: { tool: 2, fire: 1 } },
        { label: 'I work out what state could differ between us and pin it down.', scores: { plan: 2, grow: 1 } },
        { label: 'I get on a call and watch them do it.', scores: { ship: 2, fire: 1 } }
      ]
    },
    {
      q: 'A dependency you rely on has just been declared unmaintained.',
      options: [
        { label: 'Read the open issues and the forks before deciding anything.', scores: { dig: 3 } },
        { label: 'Vendor it in and own it. It is four hundred lines.', scores: { tool: 2, grow: 1 } },
        { label: 'Replace it now, on purpose, rather than during an incident later.', scores: { fire: 3 } },
        { label: 'Wrap it behind our own interface so swapping it becomes a small job.', scores: { plan: 3 } },
        { label: 'Leave it. It works, and nothing about it changed today.', scores: { ship: 3 } }
      ]
    },
    {
      q: 'Which one genuinely annoys you most?',
      options: [
        { label: 'Decisions nobody wrote down.', scores: { dig: 3 } },
        { label: 'Doing the same manual step for the third time.', scores: { tool: 3 } },
        { label: 'Code that has got worse every quarter because nobody had the time.', scores: { grow: 3 } },
        { label: 'Alerts that fire and mean nothing.', scores: { fire: 3 } },
        { label: 'A quarter of planning with nothing in front of a user.', scores: { ship: 3 } },
        { label: 'A change that has to touch every layer because there are no boundaries.', scores: { plan: 3 } }
      ]
    },
    {
      q: 'In a code review, what do you look at first?',
      options: [
        { label: 'What this does when it fails at three in the morning.', scores: { fire: 3 } },
        { label: 'Whether the names will still make sense to me in a year.', scores: { grow: 2, dig: 1 } },
        { label: 'Whether the decision has been put in the right place.', scores: { plan: 3 } },
        { label: 'Whether it is small enough to land today.', scores: { ship: 3 } },
        { label: 'Whether the tests it adds actually run in CI.', scores: { tool: 3 } }
      ]
    },
    {
      q: 'Finish the sentence: I know a system properly once…',
      options: [
        { label: '…I have read how it got here.', scores: { dig: 3 } },
        { label: '…I have drawn it, and the drawing survived contact with the code.', scores: { plan: 3 } },
        { label: '…it has woken me up.', scores: { fire: 3 } },
        { label: '…I can change it without holding my breath.', scores: { grow: 3 } },
        { label: '…I have automated my way around its worst edges.', scores: { tool: 3 } },
        { label: '…I have shipped three things into it.', scores: { ship: 3 } }
      ]
    }
  ];

  GameShell.define({
    id: 'game-dev-personality',
    slug: 'dev-personality',
    title: 'What kind of developer are you',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      return QuizKit.mount(g, {
        questions: QUESTIONS,
        result: function (totals) {
          var sum = 0;
          var i;
          for (i = 0; i < ORDER.length; i++) sum += totals[ORDER[i]] || 0;
          if (sum <= 0) sum = 1;

          /* Sorted on raw points; ORDER only decides ties, so a tie is broken
             the same way every time rather than by object key order. */
          var ranked = ORDER.slice().sort(function (a, b) {
            return (totals[b] || 0) - (totals[a] || 0);
          });

          var top = TYPES[ranked[0]];
          var second = TYPES[ranked[1]];
          var bottom = TYPES[ranked[5]];
          var topPts = totals[ranked[0]] || 0;
          var secondPts = totals[ranked[1]] || 0;

          var bars = [];
          for (i = 0; i < ranked.length; i++) {
            var pts = totals[ranked[i]] || 0;
            bars.push({
              name: TYPES[ranked[i]].name.replace('The ', ''),
              pct: Math.round((pts / sum) * 100),
              note: i === 0 ? 'strongest' : (pts === 0 ? 'never once' : '')
            });
          }

          /* Two points apart over sixteen questions is inside the noise, so
             the write-up says so rather than crowning one of them. */
          var blend = topPts - secondPts <= 2
            ? 'You are close to an even split between <strong>' + top.name.toLowerCase() + '</strong> and <strong>' +
              second.name.toLowerCase() + '</strong> &mdash; two points apart over sixteen questions is not a ' +
              'real gap, so read both descriptions and take whichever one stings.'
            : '<strong>' + second.name + '</strong> is your second reading, which softens ' +
              'the first: it is the part of you that will notice when the main instinct is running away with you.';

          var body =
            '<span class="dev-line">' + top.good + '</span>' +
            '<span class="dev-flaw"><strong>Where it goes wrong.</strong> ' + top.flaw + '</span>' +
            '<span class="dev-line">' + blend + '</span>' +
            '<span class="dev-line">The reading you show least of is <strong>' + bottom.name.toLowerCase() +
            '</strong>. ' + bottom.low + '</span>';

          return { title: top.name, body: body, bars: bars };
        },
        disclaimer: 'This is a joke with a straight face. Sixteen questions cannot tell you what sort of ' +
          'developer you are, and the archetypes are made up &mdash; most people are three of them depending ' +
          'on the week, the codebase and how much sleep they had. Useful as a prompt for a conversation with ' +
          'your team, useless for hiring anybody. Nothing you answered left your browser.'
      });
    }
  });
})();

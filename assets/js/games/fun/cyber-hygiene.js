/* ==========================================================================
   cyber-hygiene.js — how hackable are you, honestly.
   --------------------------------------------------------------------------
   Fifteen questions about what you actually do, scored against what actually
   protects people. The weights are not evenly spread on purpose: unique
   passwords and multi-factor on email are worth several times more than
   antivirus or a VPN, because that is what the incident data says and the
   popular advice has it backwards.

   Every answer produces a specific next action rather than a grade. A score
   with no instruction attached is a horoscope.
   ========================================================================== */

(function () {
  'use strict';

  /* Each option carries points and, when it is not the best answer, the fix
     that would earn them. */
  var Q = [
    {
      q: 'Do you reuse the same password anywhere?',
      opts: [
        ['Every account has its own', 18, null],
        ['A few important ones are unique', 8, 'Reused passwords are how one breach becomes ten. A password manager fixes this in an afternoon.'],
        ['Mostly the same one or two', 0, 'This is the single largest risk on the list. One leaked site hands over everything else you own.']
      ]
    },
    {
      q: 'Is multi-factor turned on for your main email account?',
      opts: [
        ['Yes, with an app or a hardware key', 18, null],
        ['Yes, by SMS', 11, 'Better than nothing, but SIM swaps are real. Move to an authenticator app when you can.'],
        ['No', 0, 'Your email is the reset route to everything else. If you fix one thing today, fix this.']
      ]
    },
    {
      q: 'How do you store passwords?',
      opts: [
        ['A password manager', 14, null],
        ['The browser’s built-in one', 9, 'Fine, and much better than memory — just make sure the device itself is locked and the browser profile has a strong password.'],
        ['My head, or a notes file', 2, 'Human memory forces reuse, which is the real problem. A manager removes the reason to reuse.']
      ]
    },
    {
      q: 'When did you last install operating system updates?',
      opts: [
        ['They install automatically', 10, null],
        ['Within the last month', 6, 'Turn on automatic updates. Most exploited flaws were patched long before they were used.'],
        ['I postpone them', 0, 'The gap between a patch and your installing it is the window attackers actually use.']
      ]
    },
    {
      q: 'Would you notice a phishing email aimed at you personally?',
      opts: [
        ['I check the sending domain and hover links', 10, null],
        ['I would probably spot an obvious one', 5, 'Targeted phishing does not look obvious. Check the actual sending domain, not the display name.'],
        ['Honestly, probably not', 0, 'Try the phishing game on this site — the point of it is that the good ones look completely normal.']
      ]
    },
    {
      q: 'Do you know whether your email has been in a breach?',
      opts: [
        ['Yes, I have checked and changed those passwords', 8, null],
        ['I have checked but not changed anything', 3, 'Checking without rotating the password is knowing the door is open and leaving it.'],
        ['Never checked', 0, 'Worth five minutes. There is a breach checker in the Labs section here that does it without sending your address anywhere.']
      ]
    },
    {
      q: 'Is your phone locked with a PIN, pattern or biometric?',
      opts: [
        ['Yes, six digits or biometric', 8, null],
        ['Yes, a four-digit PIN', 5, 'Six digits is a hundred times harder to guess and costs you nothing.'],
        ['No lock', 0, 'Your phone is the second factor for everything. Unlocked, it is a skeleton key.']
      ]
    },
    {
      q: 'Do you back anything up?',
      opts: [
        ['Automatically, and I have restored from it', 10, null],
        ['Automatically, never tested it', 5, 'A backup you have never restored is a belief about a backup. Try one.'],
        ['No', 0, 'Ransomware and a dropped laptop have the same outcome without one.']
      ]
    },
    {
      q: 'What do you do on public wifi?',
      opts: [
        ['Use it normally — I check for HTTPS', 7, null],
        ['Avoid it entirely', 6, 'Reasonable, though HTTPS means public wifi is far less dangerous than it was in 2010.'],
        ['Use it for anything, without thinking', 3, 'Mostly fine now, but watch for certificate warnings and never click through one.']
      ]
    },
    {
      q: 'Do you check what permissions an app asks for?',
      opts: [
        ['Yes, and I deny what makes no sense', 7, null],
        ['Sometimes', 3, 'A torch app asking for contacts is telling you what it is for.'],
        ['I just tap accept', 0, 'The permission screen is the only point at which you get a say. After that it is not your data.']
      ]
    },
    {
      q: 'Where do you install software from?',
      opts: [
        ['Official stores and vendor sites only', 8, null],
        ['Usually official, sometimes a download site', 3, 'Bundled installers from download portals are one of the most reliable ways to get adware.'],
        ['Wherever the search result points', 0, 'Search ads for popular software are routinely bought by people impersonating it.']
      ]
    },
    {
      q: 'If somebody rang claiming to be your bank, what would you do?',
      opts: [
        ['Hang up and call the number on my card', 10, null],
        ['Ask them to prove who they are', 4, 'They will happily "prove" it. Caller ID is trivially spoofed — hanging up and dialling back is the only real check.'],
        ['Answer their questions', 0, 'This is the most successful attack there is, and it does not need any technology at all.']
      ]
    },
    {
      q: 'Do you have a recovery method set on your main accounts?',
      opts: [
        ['Yes, and I know it still works', 6, null],
        ['Yes, but it might be an old number', 2, 'A recovery route pointing at a number you no longer own is a way in for whoever owns it now.'],
        ['No idea', 0, 'Check it. Being locked out permanently is a more common disaster than being hacked.']
      ]
    },
    {
      q: 'Do you use the same email address for everything?',
      opts: [
        ['I use aliases or a separate address for signups', 6, null],
        ['One address, but a strong unique password', 4, 'Fine. Aliases mainly help you see who leaked you.'],
        ['One address everywhere, same as my bank', 1, 'Separating your financial email from your signup email is cheap and limits the blast radius.']
      ]
    },
    {
      q: 'Has anyone else got a login to one of your personal accounts?',
      opts: [
        ['No', 5, null],
        ['A family member, deliberately', 3, 'Fine if deliberate — just make sure it is not the recovery route as well.'],
        ['Probably, from years ago', 0, 'Old shared logins outlive the reason they were shared. Rotate them.']
      ]
    }
  ];

  var questions = Q.map(function (item) {
    return {
      q: item.q,
      options: item.opts.map(function (o, i) {
        return { label: o[0], scores: { pts: o[1], idx0: i === 0 ? 1 : 0 } };
      })
    };
  });

  GameShell.define({
    id: 'game-cyber-hygiene',
    slug: 'cyber-hygiene',
    title: 'How hackable are you',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      return QuizKit.mount(g, {
        questions: questions,
        result: function (totals, answers) {
          var max = 0;
          for (var i = 0; i < Q.length; i++) {
            var best = 0;
            for (var o = 0; o < Q[i].opts.length; o++) best = Math.max(best, Q[i].opts[o][1]);
            max += best;
          }
          var pts = totals.pts || 0;
          var pct = Math.round((pts / max) * 100);

          var band = pct >= 85 ? 'Hard work' : pct >= 65 ? 'Reasonably solid'
                   : pct >= 45 ? 'Soft in places' : 'Wide open';

          /* The fixes, worst first. This is the actual output — the score is
             just the thing that makes people read it. */
          var fixes = [];
          for (var qi = 0; qi < Q.length; qi++) {
            var pick = answers[qi];
            if (pick == null) continue;
            var opt = Q[qi].opts[pick];
            if (opt[2]) fixes.push({ gap: (function () {
              var b = 0;
              for (var k = 0; k < Q[qi].opts.length; k++) b = Math.max(b, Q[qi].opts[k][1]);
              return b - opt[1];
            })(), text: opt[2] });
          }
          fixes.sort(function (a, b) { return b.gap - a.gap; });

          var body = '<strong>' + band + ' &mdash; ' + pct + '%.</strong> ';
          if (!fixes.length) {
            body += 'Nothing on this list is working against you, which is genuinely unusual. ' +
                    'The remaining risk is the stuff no questionnaire catches: a supplier being breached, ' +
                    'or somebody phoning your mobile provider and pretending to be you.';
          } else {
            body += 'Here is what would move the number most, in order:';
            body += '<ol class="quiz-fixes">';
            for (var f = 0; f < Math.min(fixes.length, 5); f++) body += '<li>' + fixes[f].text + '</li>';
            body += '</ol>';
            if (fixes.length > 5) body += '<p class="quiz-more">' + (fixes.length - 5) + ' smaller things besides.</p>';
          }

          return {
            title: band,
            body: body,
            bars: [{ name: 'Overall', pct: pct, note: pts + ' of ' + max + ' points' }]
          };
        },
        disclaimer: 'Not an audit. It asks about habits, not about your actual systems, and the weights reflect ' +
          'what tends to matter rather than your particular situation. Nothing you answered left your browser.'
      });
    }
  });
})();

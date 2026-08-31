/* ==========================================================================
   social-engineering.js — eight live conversations, played from the
   defender's chair.
   --------------------------------------------------------------------------
   /games already has two games about phishing and they are both about MAIL.
   phishing-or-not is a specimen jar; phishing-inbox is the same judgement
   with a clock on it. Both give you a message, which is a thing that sits
   still while you read it. None of that is the hard case.

   The hard case is a person. A voice on the phone that gets annoyed when you
   check, a courier at the goods door at ten to five on a Friday, a message in
   a channel saying somebody you trust has already approved it. Nothing in
   those is checkable by hovering, and the pressure is not in the words — it
   is in the fact that a human being is waiting for you to answer.

   Five decisions, and they are the whole file.

   1. THE PLAYER IS ALWAYS THE DEFENDER. There is no attacker mode and there
      will not be one. Everything the other party says here is deliberately
      thin: a name, a hurry, a deadline, a reference you cannot reach. It is
      the SHAPE of these calls, which is the part worth recognising, and it
      stops well short of anything that could be lifted and reused. The depth
      in this file is all on the defender's side, where it is useful.

   2. TWO AXES, NOT ONE. Every reply is scored on whether the asset stayed
      protected AND on whether the reply was professionally acceptable, and
      the two are scored separately because they disagree constantly. Sending
      the payroll file to a director in a hurry is charming and a disaster.
      Slamming the door on a real fire-alarm engineer is safe and costs you
      the certification, the goodwill and — three weeks later — the sign-in
      process itself, because somebody senior will quietly decide it is the
      problem. A single number would average those two failures into
      something that looked like the same mistake. They are not.

      The best answers here are almost always the polite verification: ring
      back on a number you looked up, find the ticket, ask the named
      approver, offer to do the check yourself. Those score high on both.

   3. SOME OF THE CALLERS ARE GENUINE, AND REFUSING THEM COSTS ASSET POINTS
      AS WELL AS MANNERS. This is the part most awareness training gets
      wrong. A defender who blocks everything is the same failure mode as a
      firewall that drops everything: the traffic does not stop, it finds
      another route. Refuse a new starter with no route and somebody lends
      them a login by Thursday, and now an account in the audit trail is two
      people. That is a worse outcome than the one being avoided, so the
      scoring says so out loud rather than quietly rewarding paranoia.

      Three of the eight scenarios are genuine and a run always contains at
      least one. Which one is never announced.

   4. THERE IS NO CLOCK, AND THAT IS THE OPPOSITE OF incident-response.js.
      That game charges you simulated minutes for deliberating, because an
      incident really does move while you read. This one must not, because
      the entire defence against a pretext is being allowed to take the time
      — a game that punished reading would be teaching the attacker's lesson
      with the attacker's own instrument. The pressure in here is inside the
      fiction, where it belongs: the caller escalates, the deadline tightens,
      the person at the door gets friendlier. The player is never actually
      rushed.

   5. EVERY SCENARIO ENDS ON THE CONTROL THAT WOULD HAVE REMOVED IT. A
      callback rule, a named delegate, a visitor diary, a documented
      verification fallback. Not on what the player should have spotted —
      because the honest finding, every time, is that the individual was
      asked to be clever under pressure and the organisation should not have
      needed them to be. Blaming the person who was manipulated is both
      unkind and useless, and the debrief says that in as many words.

   Names, companies, buildings, purchase orders and phone numbers are all
   invented. Where a number is printed it comes from 0808 157 0000-0999, the
   block Ofcom reserves for drama and never allocates — the same rule
   phishing-inbox.js follows, and for the same reason: invented on this desk
   is a weaker claim than allocated to nobody.

   ES5 throughout, no network, no eval, arrows and Space/Enter/Escape only.
   ========================================================================== */

/* global GameShell */

(function () {
  'use strict';

  /* Every reply is rated 0..10 on each axis and the meters show the RUNNING
     MEAN, not a drifting total. A meter built from deltas was written first
     and it was quietly dishonest: twelve good answers pushed it against the
     100 ceiling, so the one turn where the player read out an authenticator
     code disappeared into the clamp. A mean of twelve ratings cannot hide a
     zero, which is the entire reason the number is worth printing. */
  var AXES = [
    { key: 'a', label: 'Asset protected', hint: 'higher is better',
      long: 'whether the thing the other party wanted stayed protected' },
    { key: 'p', label: 'Handled well', hint: 'higher is better',
      long: 'whether the reply was professionally acceptable, and left a real route' }
  ];

  /* Entities survive innerHTML and do not survive a screen reader. Stripping
     tags for announce() was not enough on its own — the live region was
     saying "and rsquo semicolon" in the middle of every sentence, because the
     prose here is written with &rsquo; rather than with escaped apostrophes.
     So the handful actually used are decoded as well. */
  var ENTITIES = [
    ['&rsquo;', '’'], ['&lsquo;', '‘'],
    ['&ldquo;', '“'], ['&rdquo;', '”'],
    ['&mdash;', '—'], ['&ndash;', '–'],
    ['&hellip;', '…'], ['&nbsp;', ' '], ['&pound;', '£'],
    ['&amp;', '&']
  ];

  function plain(html) {
    var out = String(html).replace(/<[^>]+>/g, '');
    for (var i = 0; i < ENTITIES.length; i++) {
      out = out.split(ENTITIES[i][0]).join(ENTITIES[i][1]);
    }
    return out;
  }

  function clamp10(v) {
    if (!(v > 0)) return 0;
    return v > 10 ? 10 : v;
  }

  /* ==================================================================
     The eight scenarios.
     ==================================================================
     kind     'attack' or 'genuine'. A run always contains at least one
              genuine one, and which it is is never signalled.
     channel  printed as the eyebrow, because a phone call and a person at
              a door are different problems wearing the same techniques.
     turns[]  each has the technique being used, the line the other party
              says, and three replies. tech is revealed AFTER the choice
              unless the coach toggle is on.
     opts     a and p are 0..10 on the two axes. A pivot is the short line
              the debrief prints for the replies that actually gave
              something away — only those, because a debrief that lists all
              twelve decisions as pivotal is a transcript, not a finding.
     truth    what was really going on, said plainly at the end.
     control  the one thing that removes the whole conversation.
     ================================================================== */

  var SCENARIOS = [

    /* ---------------------------------------------------------- attack 1 */
    {
      key: 'boardroom',
      kind: 'attack',
      channel: 'Phone call',
      name: 'Two minutes before the board',
      opening: 'Your desk phone rings at 08:52. The display shows an internal extension you do not recognise.',
      turns: [
        {
          tech: 'Authority',
          line: '&ldquo;It&rsquo;s Martin &mdash; Martin Doyle, finance director. I&rsquo;m outside the boardroom and I have two minutes. I need the payroll summary for the September run. Send it to my personal address, I&rsquo;m not on the laptop.&rdquo;',
          opts: [
            {
              label: 'Send it. He is the finance director and he is about to walk into a board meeting.',
              a: 0, p: 7,
              pivot: 'Sent payroll data to an unverified address on the strength of a name and a tone.',
              note: 'Nothing about that voice was checkable, and you have just posted the personal data of everybody in the company to an address you cannot confirm. The technique is <strong>authority</strong>: seniority is being offered as a substitute for identity, and the hurry is there so you do not notice the substitution. Note that this reply scores well on manners. That is exactly why it works.'
            },
            {
              label: '&ldquo;Of course &mdash; I&rsquo;ll ring you straight back on the number in the directory.&rdquo;',
              a: 10, p: 9,
              note: 'This is the answer and it costs about ninety seconds. A callback on a number you looked up yourself survives a spoofed display, a convincing voice and a name you recognise, because the attacker controls what they tell you and controls nothing you go and find. Notice what you did not do: you did not accuse anybody of anything, and you did not refuse.'
            },
            {
              label: '&ldquo;I can&rsquo;t send payroll to a personal address, but I&rsquo;ll put it in your work drive now and text the internal number to say it&rsquo;s there.&rdquo;',
              a: 10, p: 10,
              note: 'Better still. The data never leaves the place that logs who opened it, and a genuine Martin has his file inside a minute. If the caller was not Martin, the caller now has nothing and does not even know whether you suspected them. Solving the request by a route you already trust is almost always available, and it is almost never the first thing anybody thinks of.'
            }
          ]
        },
        {
          tech: 'Authority, escalated',
          line: '&ldquo;You&rsquo;re going to make me late for a board meeting over a spreadsheet? Fine &mdash; ring Nina in HR, she&rsquo;ll vouch for me. Actually no, there isn&rsquo;t time. Just send it.&rdquo;',
          opts: [
            {
              label: 'Send it. He offered a reference, which is not what a fraudster does.',
              a: 0, p: 6,
              pivot: 'Accepted a reference that was withdrawn in the same breath it was offered.',
              note: 'An offer you are not allowed to take up is not evidence, and withdrawing it half a second later is the tell. Anger at being verified is an instrument rather than a reaction: a real director who is late is annoyed at the meeting, not at the control. If irritation is enough to move you, irritation is all anybody needs to bring.'
            },
            {
              label: '&ldquo;I&rsquo;ll ring Nina. If she confirms, it&rsquo;s with you in three minutes.&rdquo;',
              a: 9, p: 8,
              note: 'Take the reference the caller offered. Either it confirms and you have spent three minutes, or the line goes dead &mdash; and a caller who hangs up when you accept their own suggestion has answered the question for you.'
            },
            {
              label: '&ldquo;I know you&rsquo;re pressed. I&rsquo;m following the callback rule anyway &mdash; it applies to everybody and it&rsquo;s quicker than it sounds.&rdquo;',
              a: 10, p: 10,
              note: 'Naming the rule moves the disagreement off you and onto the process, which is the only place it can be argued with fairly. It also hands a genuine colleague something to be annoyed at that is not a person, and that is worth more than it sounds on a Monday morning.'
            }
          ]
        },
        {
          tech: 'Urgency, manufactured',
          line: '&ldquo;The payroll cut-off is nine o&rsquo;clock. If this misses the run, four hundred people don&rsquo;t get paid on Friday, and I will be telling them exactly why.&rdquo;',
          opts: [
            {
              label: 'Send it. You cannot be the reason four hundred people go unpaid.',
              a: 0, p: 5,
              pivot: 'A manufactured deadline was enough to skip the check entirely.',
              note: 'The deadline is the payload. It was chosen because it makes checking feel enormously expensive and complying feel free, and it is nearly always invented. Very few real deadlines are destroyed by a four-minute callback, and the ones that genuinely are had a process failure a long way upstream of this phone call.'
            },
            {
              label: '&ldquo;Then we have eight minutes and a callback takes two. Stay on the line.&rdquo;',
              a: 10, p: 9,
              note: 'You accepted the deadline exactly as stated and did the check inside it, which removes the argument rather than winning it. If the deadline was real it is met. If it was invented it does not survive being taken seriously, which is the cheapest possible way to test one.'
            },
            {
              label: 'Put the phone down without another word and get on with your morning.',
              a: 8, p: 1,
              note: 'The data is safe, which is worth something real. But an unexplained hang-up is how a defender becomes the person colleagues quietly route around, and the next request like this simply goes to somebody who does not check. It also means nobody reports it &mdash; and this call should end with security knowing it happened, so that the fifth person who gets it is already expecting it.'
            }
          ]
        }
      ],
      truth: 'There is no Martin Doyle in the directory. The extension on the display was spoofed, and the name, the payroll run date and the cut-off time were all public: a company announcement, a supplier&rsquo;s case study and a job advert between them supplied everything the caller used.',
      control: 'A published callback rule for anything touching money or personal data: no inbound call is ever actioned, and ringing back is the polite default rather than an accusation. It removes this entire conversation, because it leaves nothing for a tone of voice to do.'
    },

    /* ---------------------------------------------------------- attack 2 */
    {
      key: 'servicedesk',
      kind: 'attack',
      channel: 'Phone call',
      name: 'Ticket 4412',
      opening: '&ldquo;Hi &mdash; it&rsquo;s Ravi from the service desk, I&rsquo;m picking up ticket 4412 about your mailbox.&rdquo; You did not raise a ticket. You do have a mailbox.',
      turns: [
        {
          tech: 'Familiarity',
          line: '&ldquo;You&rsquo;re on the Tuesday rota with Sam, right? Sam logged it for you after Monday&rsquo;s sync problem. I just need to get you back on the connector before the profile locks.&rdquo;',
          opts: [
            {
              label: 'He knows Sam, the rota and Monday&rsquo;s outage. Carry on with the call.',
              a: 2, p: 7,
              pivot: 'Treated knowing true things about you as proof of who was speaking.',
              note: 'Knowing true things about you is not identification, and it is the cheapest item on the attacker&rsquo;s list. A rota on a noticeboard, a whiteboard visible behind somebody in a photograph, a status page, a supplier naming the tool you use &mdash; an hour of public reading buys all of it. <strong>Familiarity</strong> works because it feels like something only an insider could know, and that feeling is the product being sold.'
            },
            {
              label: '&ldquo;I don&rsquo;t have a ticket open. What&rsquo;s the reference &mdash; I&rsquo;ll look it up my side.&rdquo;',
              a: 9, p: 9,
              note: 'The ticket is a check you can both see, and it lives on your side of the conversation. A genuine agent is pleased you looked; the reference either exists in your queue or it does not, and no amount of warmth changes which.'
            },
            {
              label: '&ldquo;I&rsquo;ll ring the service desk on the intranet number and ask for you by name.&rdquo;',
              a: 10, p: 8,
              note: 'Out of band, on a number the caller did not supply. Exactly the same move as the callback on a finance request, working for exactly the same reason.'
            }
          ]
        },
        {
          tech: 'Helpdesk reversal',
          line: '&ldquo;All right. Then read me the six-digit code that has just come up on your phone, so I can re-authorise the session.&rdquo;',
          opts: [
            {
              label: 'Read out the code. He is on the service desk and the code came from your own company&rsquo;s app.',
              a: 0, p: 6,
              pivot: 'Read a second-factor code aloud to an inbound caller.',
              note: 'That code is the second factor and it is yours alone. No service desk anywhere needs it: they can reset, revoke and re-enrol entirely from their side. &ldquo;Read me the code&rdquo; has one meaning &mdash; somebody is standing at a login prompt with your username and password and is one number short. A push notification you did not ask for means the password has already gone.'
            },
            {
              label: '&ldquo;Nobody from the service desk should be asking me for that. I&rsquo;m ending the call and reporting it.&rdquo;',
              a: 10, p: 8,
              note: 'Correct, and correct to say why. Ending a call is not rude when the request itself was the tell. Reporting it is the half almost everybody skips, and it is the half that turns one call somebody handled well into a warning everybody else gets before their own phone rings.'
            },
            {
              label: '&ldquo;I&rsquo;ll come down to the desk in person.&rdquo;',
              a: 9, p: 8,
              note: 'Safe, and it costs you a walk. It also declines the request without needing to win an argument, which is worth having in reserve: you never have to prove somebody is an attacker in order to decline to act on a phone call.'
            }
          ]
        },
        {
          tech: 'Authority and threat',
          line: '&ldquo;Your manager signed this off. If the profile locks, I have to escalate, and then it is your incident rather than mine.&rdquo;',
          opts: [
            {
              label: 'Give in. An escalation with your name on it is not worth the argument.',
              a: 0, p: 5,
              pivot: 'A threatened escalation closed the conversation down to the one option the caller wanted.',
              note: 'A threatened consequence is the same instrument as a deadline, turned round to point at you instead of at the business. Look at the shape of the call: every route out has been closed except the one the caller wants. Colleagues do not talk like that. Scripts do.'
            },
            {
              label: '&ldquo;Then escalate it. I&rsquo;ll write up what was asked for and my manager can read both.&rdquo;',
              a: 10, p: 8,
              note: 'An attacker cannot afford a written record and a genuine colleague has no reason to fear one. Inviting the escalation is the cheapest available test of which one you are talking to.'
            },
            {
              label: '&ldquo;I&rsquo;m going to hang up and ring the desk myself. If this is genuine we&rsquo;ll have it finished in five minutes.&rdquo;',
              a: 10, p: 10,
              note: 'Polite, specific, out of band, and it leaves the door open &mdash; which matters, because some of these calls really are the service desk. The version of you that slams the phone down on your own colleagues twice a month is a version people stop ringing, and then you find out about problems last.'
            }
          ]
        }
      ],
      truth: 'The ticket did not exist. The rota, the outage and Sam&rsquo;s name came off a public post and a status page. The code being asked for was arriving because somebody was already sitting at a login screen with a working password, and the second factor was the only thing left to get &mdash; which meant asking you for it nicely.',
      control: 'A standing rule, published where everybody can see it and repeated until it is boring: the service desk never asks for a code, a password or a screen share on an inbound call, and any caller who does is reported rather than argued with. The same conversation aimed at a phone shop is <a href="/blog/how-sim-swap-works">how a SIM swap works</a>, where the person being manipulated is a support agent doing their job properly.'
    },

    /* ---------------------------------------------------------- attack 3 */
    {
      key: 'coffee',
      kind: 'attack',
      channel: 'Walk-in',
      name: 'Coffee and a door',
      opening: '08:40 in the lobby. Somebody in a company-branded polo shirt is carrying two coffee trays, and their elbow is doing the work of a hand. Your pass is already out.',
      turns: [
        {
          tech: 'Reciprocity',
          line: '&ldquo;Oh &mdash; thank you, could you? These are for the Thursday stand-up and I&rsquo;m already late. Take one, honestly, there&rsquo;s a spare.&rdquo;',
          opts: [
            {
              label: 'Hold the door and take the spare coffee.',
              a: 2, p: 8,
              pivot: 'A small gift bought the door before anybody badged through it.',
              note: 'The coffee is not a bribe, it is a debt. <strong>Reciprocity</strong> works underneath the level at which you argue: somebody gives you a small thing, and refusing them the next small thing feels wildly disproportionate. It is the cheapest technique on the list to run and the hardest to notice, because the feeling it produces is a pleasant one.'
            },
            {
              label: 'Hold the door, decline the coffee, and stay at the reader: &ldquo;badge in and I&rsquo;ll hold it for you.&rdquo;',
              a: 9, p: 9,
              note: 'Helpful and still in control. Holding a door is not the problem; a door held <em>instead of</em> a badge is. Every pass through the reader is a line in the list of who was in the building, which is the thing that matters at four in the morning when somebody finally asks.'
            },
            {
              label: '&ldquo;Here, I&rsquo;ll take those off you while you badge in.&rdquo;',
              a: 10, p: 10,
              note: 'The best answer in the building and not a confrontation at all. You removed the reason not to badge, kept the record intact, and were the most helpful person in the lobby. Take the excuse away and the conversation never has to become about trust.'
            }
          ]
        },
        {
          tech: 'Social proof',
          line: '&ldquo;I&rsquo;m with the Dowsett fit-out crew, we&rsquo;ve been in all week &mdash; ask Amanda on the desk, she&rsquo;s been signing us in.&rdquo; Amanda does not start until nine.',
          opts: [
            {
              label: 'Fine. They have clearly been in all week.',
              a: 2, p: 7,
              pivot: 'Accepted a reference that could not be reached, from somebody who knew it could not be reached.',
              note: '&ldquo;Ask the person who is not here&rdquo; is the oldest reference in the trade. It is not really a lie, it is a bet that you will not wait &mdash; and <strong>social proof</strong> does the work: if everybody else has already accepted this, checking makes you the difficult one.'
            },
            {
              label: '&ldquo;No problem &mdash; reception opens at nine, I&rsquo;ll wait with you.&rdquo;',
              a: 9, p: 8,
              note: 'You have neither accused them nor admitted them. Waiting <em>with</em> somebody is the version of this that costs nothing socially, and twenty minutes in a lobby is a price a genuine contractor pays without thinking about it.'
            },
            {
              label: '&ldquo;Amanda&rsquo;s not in yet. I&rsquo;ll ring facilities and get you signed in properly.&rdquo;',
              a: 10, p: 10,
              note: 'You took their own reference seriously and did the work yourself. That is the whole trick of doing this well: the check is something you go and do, not something you demand from somebody standing in front of you.'
            }
          ]
        },
        {
          tech: 'Tailgating',
          line: 'You badge in. They step through behind you, coffee first, smiling. The door is already closing. Saying anything now means saying it to somebody&rsquo;s face.',
          opts: [
            {
              label: 'Say nothing. They are two feet behind you and the moment has gone.',
              a: 1, p: 6,
              pivot: 'The building&rsquo;s record of who was inside that morning is now wrong, and will stay wrong.',
              note: 'This is the honest option and it is what most people do. The discomfort is real, and it is precisely the material the technique is built from. Worth naming plainly: the reason this feels impossible is not that you are weak, it is that every social instinct you have is being used as the tool. Which is why the answer can never be &ldquo;be braver&rdquo; &mdash; it has to be a process, so that nobody has to be.'
            },
            {
              label: '&ldquo;Sorry &mdash; I can&rsquo;t badge anybody else through on mine. Reception at nine, and I&rsquo;ll walk you back down.&rdquo;',
              a: 10, p: 8,
              note: 'Awkward and right. Look at the shape of it: the refusal is about your badge rather than about them, which is the difference between a boundary and an accusation. Walking them back down is the part that stops it being cold.'
            },
            {
              label: 'Say nothing now, then ring facilities from your desk and describe exactly what happened.',
              a: 6, p: 8,
              note: 'Half a save, and enormously better than nothing. The person is inside, which is bad &mdash; but somebody knows within minutes, while the recording still exists and the coffee cups are still on a desk. A culture where that call is easy to make is worth more than a culture where nobody ever needs to make one, because the second sort does not exist.'
            }
          ]
        }
      ],
      truth: 'The polo shirt was ordered online and the coffee cost eleven pounds. The Dowsett fit-out crew is real, which is what made the reference work. Nobody in the lobby did anything a reasonable person would call stupid, and the building&rsquo;s record of who was inside that morning is simply wrong.',
      control: 'A visitor process that is somebody&rsquo;s job rather than everybody&rsquo;s judgement: contractors signed in against a named host, visitor passes that look visibly different from a distance, and a reader that counts people rather than door openings. Plus one published sentence &mdash; holding a door is fine as long as the person badges through it &mdash; which turns an awkward refusal into an ordinary thing to say.'
    },

    /* ---------------------------------------------------------- attack 4 */
    {
      key: 'approved',
      kind: 'attack',
      channel: 'Chat message',
      name: 'Priya already approved it',
      opening: 'A message lands in the vendor onboarding channel from a display name you half recognise. The profile picture is the company logo.',
      turns: [
        {
          tech: 'Social proof',
          line: '&ldquo;Hi &mdash; Priya has already approved the bank detail change for Kelso Interiors, she said you&rsquo;d do the update. She&rsquo;s on the flight to Cologne so she won&rsquo;t answer for a few hours. Invoice is due today.&rdquo;',
          opts: [
            {
              label: 'Do the update. Priya approved it and she is not reachable to ask twice.',
              a: 0, p: 7,
              pivot: 'Changed a supplier bank account on an approval nobody could check.',
              note: 'Three techniques in one message, each holding the others up: an approval you cannot verify, an approver who is conveniently unreachable, and a deadline. <strong>Social proof</strong> is the load-bearing one. It is not asking you to trust the sender, it is asking you to trust somebody you already trust, which is a very much easier thing to ask.'
            },
            {
              label: '&ldquo;I&rsquo;ll wait for Priya. Bank changes need her in writing.&rdquo;',
              a: 9, p: 5,
              note: 'Right on the asset and thin on the relationship. The supplier is now waiting with no route and no timescale, which is how a control acquires a reputation for being the reason nothing happens. One extra sentence about what you <em>will</em> do turns this into a complete answer.'
            },
            {
              label: '&ldquo;Bank changes go through a callback to the number on the contract, not the one on the invoice. I&rsquo;ll do that now and it should be settled this afternoon.&rdquo;',
              a: 10, p: 10,
              note: 'This is the one. It protects the money, it explains the rule so it does not read as suspicion of a person, and it names a timescale so the request does not simply vanish. A control that comes with a route through it is a control that people stop trying to get around.'
            }
          ]
        },
        {
          tech: 'Familiarity',
          line: '&ldquo;Sure &mdash; it&rsquo;s the usual C2 form, attached. Same as the Ferrers job last quarter. You can see it&rsquo;s the right template.&rdquo;',
          opts: [
            {
              label: 'The form is the right one and the old job reference checks out. Process it.',
              a: 0, p: 7,
              pivot: 'A correct template and a real old project name were accepted in place of a check.',
              note: 'The template proves that somebody has seen a template. Internal jargon, form numbers and old project names are findable, guessable, or supplied by one earlier conversation with somebody helpful. Familiarity is the residue of research, and here it is doing the same job the coffee did in the lobby.'
            },
            {
              label: '&ldquo;The form is right. The account number on it is new, so I&rsquo;ll ring the contract number before anything changes.&rdquo;',
              a: 10, p: 10,
              note: 'You separated the two claims: the paperwork is fine, and the bank account is the question. Almost every one of these is correct about everything except the single field that moves the money, which is why &ldquo;does it look right&rdquo; is the wrong test and &ldquo;did we confirm the one thing that changed&rdquo; is the right one.'
            },
            {
              label: '&ldquo;Which Ferrers job? I&rsquo;ll pull the file.&rdquo;',
              a: 7, p: 7,
              note: 'A fair probe and it will often end the conversation. It is weaker than the callback though, because it is a quiz &mdash; and somebody who has done their reading passes quizzes. Verification should never depend on you happening to know more than the person on the other end.'
            }
          ]
        },
        {
          tech: 'Urgency and offence',
          line: '&ldquo;This is a supplier we have used for nine years and you are accusing them of fraud over a form. If the payment misses today they stop the fit-out. Do you want to be the one who explains that?&rdquo;',
          opts: [
            {
              label: 'Process it. The relationship is worth more than a piece of paper.',
              a: 0, p: 6,
              pivot: 'A control was dropped because applying it was framed as an insult.',
              note: 'The last move in the set is reframing a control as an accusation. Nothing here accused anybody: a callback says the process does not act on <em>any</em> inbound instruction, which is not the same thing as not trusting a person. Saying that out loud usually ends the conversation, because there is no reply to it.'
            },
            {
              label: '&ldquo;Nobody is accusing anybody. The rule applies to every supplier including the ones we like, and it takes about ten minutes.&rdquo;',
              a: 10, p: 10,
              note: 'Possibly the most useful sentence in this whole game, and it works because it is true. A rule that applies to everybody is not an insult to anybody. It also takes the argument off you and puts it on the process, where being annoyed is not an effective way to win.'
            },
            {
              label: 'Escalate to your manager and say nothing more in the channel.',
              a: 9, p: 6,
              note: 'Safe and slow, and the right instinct when you are genuinely out of your depth. It stops being right when it becomes the only tool: escalating everything is how a control turns into a bottleneck, and how somebody two floors away eventually decides to work around you. Escalate the decision, not the conversation.'
            }
          ]
        }
      ],
      truth: 'Priya really was on that flight, and the itinerary was public. The account belonged to a mule account opened three weeks earlier. Kelso Interiors were owed the money and never received it, and nobody at either company did anything a reasonable person would not have done.',
      control: 'One written rule: bank details change only after a callback to the number held in the contract file &mdash; never a number printed on the invoice or pasted into the message &mdash; and the callback is made by somebody other than the person who received the request. It is boring, and it is the single control that stops nearly all of this.'
    },

    /* ---------------------------------------------------------- attack 5 */
    {
      key: 'riser',
      kind: 'attack',
      channel: 'At the door',
      name: 'The riser is out',
      opening: 'Two people in hi-vis at the goods door at 16:50 on a Friday. One has a clipboard, the other a tool case. Neither is on the list.',
      turns: [
        {
          tech: 'Familiarity',
          line: '&ldquo;We&rsquo;re here for the number two riser &mdash; plant room on the third, past the old server cage. Somebody logged the fault this morning.&rdquo;',
          opts: [
            {
              label: 'They know the building well enough to be from the building. Wave them in.',
              a: 1, p: 7,
              pivot: 'Knowing the layout was accepted as authorisation to be in it.',
              note: 'Knowing a building is not permission to be inside it, and a layout is among the easiest facts on earth to acquire: a fire plan by the lift, a photograph in a property listing, a lettings brochure, one honest conversation last week. The old server cage is exactly the sort of detail that feels like proof and is not.'
            },
            {
              label: '&ldquo;Who logged it? I&rsquo;ll find the job and get you signed in.&rdquo;',
              a: 9, p: 10,
              note: 'You asked for the one thing that cannot be fabricated on your side: a record you can open yourself. And you offered to do the work, so the question arrives as help rather than as suspicion.'
            },
            {
              label: '&ldquo;Wait here a moment &mdash; I&rsquo;ll ring the building manager.&rdquo;',
              a: 10, p: 8,
              note: 'Out of band, on a number of your choosing. Standing outside for four minutes is not an insult to anybody who genuinely has a job number.'
            }
          ]
        },
        {
          tech: 'Urgency, manufactured',
          line: '&ldquo;We&rsquo;re the out-of-hours crew and we&rsquo;re paid until five. After that the riser is somebody else&rsquo;s problem until Tuesday. Your call.&rdquo;',
          opts: [
            {
              label: 'Wave them in. Nobody wants the riser down all weekend.',
              a: 0, p: 6,
              pivot: 'A Friday-evening deadline did the work that a job number could not.',
              note: 'The deadline is doing exactly what the payroll cut-off did on the phone: making the check feel expensive and compliance feel free. And it is engineered. It arrives at ten to five on a Friday because that is the hour when the person who could confirm it has gone home, which is the actual reason for the timing.'
            },
            {
              label: '&ldquo;Then it waits until Tuesday. I can&rsquo;t sign in a job I can&rsquo;t find.&rdquo;',
              a: 10, p: 4,
              note: 'The asset is protected and that is most of the job. But if the work turns out to be genuine, what you have produced is a broken riser, an angry facilities manager and a persuasive argument for propping the goods door open next time. This is the right answer only when there is nothing else left to try.'
            },
            {
              label: '&ldquo;Give me four minutes. If I can reach anybody who confirms the job you&rsquo;re in, and if not I&rsquo;ll book you back in for Monday myself.&rdquo;',
              a: 10, p: 10,
              note: 'Both axes at once. You did not decide who they were, you decided what the process was &mdash; and a genuine crew gets a route that does not involve standing in the rain being disbelieved.'
            }
          ]
        },
        {
          tech: 'Reciprocity',
          line: '&ldquo;Look, you seem sound and I&rsquo;m not going to drop you in it. Point us at the stairs and we&rsquo;ll sign whatever you want on the way out.&rdquo;',
          opts: [
            {
              label: 'Point them at the stairs. They will sign on the way out.',
              a: 0, p: 7,
              pivot: 'Sign on the way out, which means sign never.',
              note: 'Sign on the way out is sign never, and &ldquo;I&rsquo;m not going to drop you in it&rdquo; is reciprocity again: a favour offered so that a favour can be asked. Notice how friendly the last move always is. The unpleasant approaches are easy to refuse, which is exactly why they are not the ones that work.'
            },
            {
              label: '&ldquo;Sign in first &mdash; it&rsquo;s ninety seconds and it means I&rsquo;m not the one explaining it on Monday.&rdquo;',
              a: 10, p: 9,
              note: 'Truthful and impersonal. Giving the real reason &mdash; the record, rather than your opinion of them &mdash; is very hard to argue with and gives nobody anything to take personally.'
            },
            {
              label: '&ldquo;No. Off site, please.&rdquo; Close the door.',
              a: 10, p: 2,
              note: 'The building is safe. If those two had been a genuine out-of-hours crew, the fault stays broken, facilities hear about it on Monday, and somebody quietly concludes that the sign-in process is the problem &mdash; which is how a control gets removed altogether. Being right and being unbearable is a real failure mode, not a hard-nosed virtue.'
            }
          ]
        }
      ],
      truth: 'No fault had been logged. The riser and the plant-room route came off a fire plan photographed in the lobby, and the hi-vis and clipboard together cost less than the coffee did. The out-of-hours story was timed for ten to five on a Friday because that is when there is nobody left to ring.',
      control: 'A works process with a job number attached to a named host, a rule that no contractor enters without one, and somebody reachable out of hours who can confirm one. The third part is the part everybody forgets, and it is the part that makes the first two survivable on a Friday evening.'
    },

    /* --------------------------------------------------------- genuine 1 */
    {
      key: 'newstarter',
      kind: 'genuine',
      channel: 'Chat message',
      name: 'The new starter',
      opening: 'A message from an internal account created eleven days ago. You do not recognise the name. Their manager is on annual leave.',
      turns: [
        {
          tech: 'A genuine request',
          line: '&ldquo;Hi &mdash; I started last week on the claims team and I still don&rsquo;t have access to the case system. My manager&rsquo;s on leave and the trainer says I should have had it on day one. Can you add me?&rdquo;',
          opts: [
            {
              label: 'Add them. Everything they said is consistent and they are obviously a new starter.',
              a: 2, p: 8,
              pivot: 'Granted access on a story, and happened to be right.',
              note: 'Everything they said may well be true, and none of it was checked. The instinct is generous and the outcome is an account granted on a narrative &mdash; which is the same outcome the finance call was after, arrived at more pleasantly. Being right about somebody by luck is not a control.'
            },
            {
              label: '&ldquo;I can&rsquo;t add you from a message, but I can get this moving today &mdash; your manager has a delegate who can approve it and I&rsquo;ll find out who.&rdquo;',
              a: 9, p: 10,
              note: 'This is the shape the whole game is arguing for: no to the shortcut, yes to the person, with a named next step and a timescale. It costs one lookup, and it means a new starter does not spend their second week concluding that the rules here are decoration.'
            },
            {
              label: '&ldquo;Access requests go through your manager. Come back when they&rsquo;re off leave.&rdquo;',
              a: 4, p: 1,
              pivot: 'Refused with no route, which moves the risk rather than removing it.',
              note: 'Technically correct and quietly expensive. What happens next is not that the new starter waits two weeks &mdash; it is that somebody on the claims team lends them a login so the work gets done, and now an account in the audit trail is two people. Refusing without offering a route does not remove risk. It moves it somewhere nobody can see it.'
            }
          ]
        },
        {
          tech: 'Real urgency',
          line: '&ldquo;The thing is I&rsquo;ve got a backlog assigned to me and a review on Friday. I&rsquo;m not trying to jump the queue, I just don&rsquo;t know who to ask.&rdquo;',
          opts: [
            {
              label: 'Lend them a login of your own so they can clear the backlog.',
              a: 0, p: 8,
              pivot: 'A shared credential, which ends the audit trail for everybody who touches it.',
              note: 'The kindest wrong answer available, and a common one. From this afternoon, nothing that account does can be attributed to a person &mdash; including anything done by whoever it gets passed to next. Helping is right. Helping by breaking the one mechanism that lets anybody reconstruct what happened is not.'
            },
            {
              label: '&ldquo;Here&rsquo;s the delegate&rsquo;s name and the request link. I&rsquo;ve flagged it as a new starter so it goes to the top of the queue.&rdquo;',
              a: 9, p: 10,
              note: 'Nothing was given away and the problem was actually solved, which is what most of a good defender&rsquo;s day looks like. Note that you spent effort rather than authority. That is usually the trade.'
            },
            {
              label: '&ldquo;That&rsquo;s frustrating. It still needs approval, but I&rsquo;ll chase it this afternoon and come back to you either way.&rdquo;',
              a: 9, p: 9,
              note: 'Also right, and &ldquo;either way&rdquo; is the part carrying the weight. A promise to come back even when the answer is no is what stops somebody going looking for a workaround while they wait.'
            }
          ]
        },
        {
          tech: 'The temptation to be the exception',
          line: '&ldquo;Honestly, where I worked before they&rsquo;d have just sorted this. Is there any way round it?&rdquo;',
          opts: [
            {
              label: 'Find a way round it. They are obviously genuine and it is obviously the right thing to do.',
              a: 1, p: 8,
              pivot: 'Made an exception on the strength of being sure, which is the thing attackers manufacture.',
              note: 'Obviously genuine is a feeling, and it is correct most of the time &mdash; which is precisely the problem. A control applied except when you are sure is a control an attacker only has to make you sure about. This person really was genuine. The next one, with the same story and the same warmth, is the one the process exists for.'
            },
            {
              label: '&ldquo;No, and I&rsquo;d say the same if you were the chief executive, which is rather the point of it. But I&rsquo;ll make sure it isn&rsquo;t slow.&rdquo;',
              a: 10, p: 10,
              note: 'A rule that applies to everybody, including the people it inconveniences, said kindly and with a commitment attached. That sentence is the entire defence against authority, delivered in advance and without an argument.'
            },
            {
              label: '&ldquo;There isn&rsquo;t. Sorry.&rdquo;',
              a: 8, p: 3,
              note: 'The answer is right and the delivery is a small debt you will pay later. This is the person who will hesitate before mentioning a strange phone call, because the last interaction with you was a door closing. Security depends far more on people volunteering odd things than on people obeying rules.'
            }
          ]
        }
      ],
      truth: 'Every word of it was true. Genuine requests arrive with real deadlines, a missing approver and a plausible story, because that is what the attacks are copied from &mdash; and a defender who has learned to refuse anything resembling an attack will refuse a great deal of ordinary work.',
      control: 'A named delegate recorded for every approver before anybody goes on leave, and a request route a new starter can find on day one. Almost all of the pressure in that conversation was somebody&rsquo;s absence, and none of it was anybody&rsquo;s fault.'
    },

    /* --------------------------------------------------------- genuine 2 */
    {
      key: 'alarm',
      kind: 'genuine',
      channel: 'At the door',
      name: 'The alarm engineer',
      opening: '08:05. A van outside, and an engineer at reception with a work order on a clipboard and a company ID on a lanyard.',
      turns: [
        {
          tech: 'A genuine request',
          line: '&ldquo;Morning &mdash; quarterly alarm test, panel&rsquo;s in the back corridor. It&rsquo;s booked in. Should take about two hours.&rdquo;',
          opts: [
            {
              label: 'Wave them through. Alarm testing is routine and the van is parked outside.',
              a: 2, p: 8,
              pivot: 'A van and a lanyard were treated as credentials.',
              note: 'A van and a lanyard are both purchasable, and &ldquo;it&rsquo;s booked in&rdquo; is a claim about <em>your</em> records rather than theirs. That this particular engineer is genuine is not something you knew at the moment you decided.'
            },
            {
              label: '&ldquo;Let me find the booking &mdash; what&rsquo;s it under?&rdquo; and open the diary.',
              a: 9, p: 10,
              note: 'The record on your side is the check. It takes a minute, it works identically whether the person is genuine or not, and a real engineer has been asked this at every building they have entered this month.'
            },
            {
              label: '&ldquo;I can&rsquo;t see anything for today. Bear with me &mdash; I&rsquo;ll ring facilities and get it confirmed.&rdquo;',
              a: 9, p: 9,
              note: '&ldquo;Bear with me&rdquo; is doing real work in that sentence. The difference between a check and an accusation is almost entirely whether the person is left standing there wondering what you think of them.'
            }
          ]
        },
        {
          tech: 'Where over-refusal becomes the risk',
          line: '&ldquo;It&rsquo;s under Halstead Fire, purchase order ends 118. If it doesn&rsquo;t happen today it&rsquo;s another six weeks, and you&rsquo;re out of certification in the meantime.&rdquo;',
          opts: [
            {
              label: '&ldquo;No PO in my system, no entry. Sorry.&rdquo;',
              a: 4, p: 1,
              pivot: 'Refused a checkable reference outright, which costs the control its authority.',
              note: 'The strict answer, and here it is the wrong one. The engineer is genuine, the certification lapse is real, and what happens next is that somebody senior overrules you in front of reception &mdash; after which the sign-in process has quietly lost its authority. A control that cannot survive being right about a real job does not last long enough to stop a fake one.'
            },
            {
              label: '&ldquo;That&rsquo;s enough to go on. I&rsquo;ll confirm the PO with facilities and get you signed in and escorted.&rdquo;',
              a: 10, p: 10,
              note: 'You took a checkable reference and used it. Everything about this is identical to refusing the crew at the goods door on Friday; only the outcome differs, because the check came back differently. That is what a process is for &mdash; it produces the right answer without requiring you to be a good judge of character.'
            },
            {
              label: '&ldquo;Come in and get started, I&rsquo;ll sort the paperwork behind you.&rdquo;',
              a: 1, p: 8,
              pivot: 'Paperwork behind you, which is the same hole as signing on the way out.',
              note: 'The paperwork behind you never happens. This is the identical failure to &ldquo;sign on the way out&rdquo;, arrived at from good intentions rather than under pressure, and it leaves an identical hole in the record.'
            }
          ]
        },
        {
          tech: 'What escorting is actually for',
          line: 'Confirmed. The engineer needs the back corridor, which is also where the comms cabinet lives.',
          opts: [
            {
              label: 'Hand over the master key and get on with your morning.',
              a: 1, p: 7,
              pivot: 'Verified was treated as supervised.',
              note: 'Verified is not the same as unsupervised, and this is where most sign-in processes stop caring. The comms cabinet in the same corridor is the entire reason escorting exists: nothing about being a genuine alarm engineer says anything at all about the rest of that room.'
            },
            {
              label: 'Escort them, unlock what they need, stay for the test.',
              a: 10, p: 9,
              note: 'Two hours of somebody&rsquo;s morning, which is the honest cost of doing this properly and the reason it is usually skipped. Where it genuinely cannot be staffed, the answer is a lock on the cabinet rather than a rule nobody follows.'
            },
            {
              label: 'Sign them in, point at the corridor, ask reception to keep an eye out.',
              a: 6, p: 8,
              note: 'Realistic, and much better than the master key. It is also how most buildings actually operate, so it is worth being honest about what it is: the residual risk here has not been removed, it has been accepted &mdash; which is fine, as long as somebody decided that on purpose rather than by drifting into it.'
            }
          ]
        }
      ],
      truth: 'Halstead Fire were contracted, booked and expected. The only thing wrong with that morning was that none of it had been written down anywhere the person at the door could see.',
      control: 'A visitor diary the front desk can actually read, carrying the contractor, the host and the PO before the van arrives &mdash; plus a standing answer for what to do when a genuine job is not in it, so that nobody is ever made to choose between the rules and the certification.'
    },

    /* --------------------------------------------------------- genuine 3 */
    {
      key: 'verify',
      kind: 'genuine',
      channel: 'Phone call',
      name: 'The caller who cannot verify',
      opening: 'You are on the support line today. The caller has just failed two of the three identity questions.',
      turns: [
        {
          tech: 'A genuine request, meeting a bad control',
          line: '&ldquo;I know, I&rsquo;m sorry &mdash; the surname is different because I got married, and the address is my mum&rsquo;s because I moved in March. It is definitely my account.&rdquo;',
          opts: [
            {
              label: 'Reset it. Nobody would invent that, and she is clearly upset.',
              a: 0, p: 8,
              pivot: 'Overrode verification on sympathy, which is the exact route these calls take.',
              note: 'This is the conversation a number takeover is won in, and it is won by sympathy rather than by lying well. Every detail offered is unverifiable and emotionally expensive to doubt, which is the design. What makes it genuinely hard is that the story is usually true: most people who fail verification are the customer.'
            },
            {
              label: '&ldquo;I can&rsquo;t reset on what we have, but there&rsquo;s another way to prove it &mdash; can I send a code to the number on the account?&rdquo;',
              a: 10, p: 10,
              note: 'An out-of-band check, initiated by you, against a detail already on the record that the caller cannot choose. Note that it is not a refusal: you moved the conversation onto evidence that means something instead of defending the three questions you happened to have.'
            },
            {
              label: '&ldquo;I&rsquo;m sorry, I can&rsquo;t help you.&rdquo; End the call.',
              a: 4, p: 1,
              pivot: 'A hard refusal with no route, which turns the control into a lottery over who answers next.',
              note: 'Safe, useless and expensive. She rings back in ten minutes and reaches somebody with a softer heart, which is the actual outcome of a refusal with no route: the control is now a lottery over which agent picks up. That is <a href="/blog/how-sim-swap-works">how a SIM swap works</a> in practice &mdash; the agent who eventually says yes is rarely careless, just the fifth one asked.'
            }
          ]
        },
        {
          tech: 'Distress, and it is real',
          line: '&ldquo;I&rsquo;ve been locked out four days. There&rsquo;s a hospital appointment letter in that account and I need it tomorrow.&rdquo;',
          opts: [
            {
              label: 'Override the check. The need is real and the story has been consistent throughout.',
              a: 0, p: 8,
              pivot: 'Consistency was accepted as evidence.',
              note: 'Consistency is not evidence &mdash; a story told twice is still a story. And the need being real says nothing about who is holding the phone. Everything you are feeling here is what an attacker would be trying to produce deliberately, which is exactly why this decision cannot be left to how a call feels.'
            },
            {
              label: '&ldquo;Let&rsquo;s try the code. If that fails there&rsquo;s a documented route with photo ID that takes about a day, and I&rsquo;ll start it now so you&rsquo;re not waiting on me.&rdquo;',
              a: 10, p: 10,
              note: 'A fallback that exists in writing is the difference between a good control and a cruel one. It means the agent never has to choose between the rules and a person in trouble &mdash; and that choice, made often enough, is what breaks every verification process eventually.'
            },
            {
              label: '&ldquo;Rules are rules.&rdquo;',
              a: 6, p: 0,
              pivot: 'A rule with no explanation and no route, which is a rule people learn to route around.',
              note: 'Three words that lose a customer and teach the next agent nothing. A rule with no route through it and no reason attached is a rule people learn to work around &mdash; and the person who works around it will be a colleague, not the caller.'
            }
          ]
        },
        {
          tech: 'Verification is a moment, not a state',
          line: 'The code arrives on the number held on the account and she reads it back correctly. Then: &ldquo;while you&rsquo;re there, can you add my husband so he can ring for me?&rdquo;',
          opts: [
            {
              label: 'Add him. She has just verified and it is a small thing.',
              a: 1, p: 8,
              pivot: 'Extended the account to somebody who had never been checked.',
              note: 'Verification is a moment, not a state. She proved she controls the number on file; her husband has proved nothing at all, and adding an authorised contact is precisely the sort of small permanent change these calls are aimed at. The account has quietly been extended to a person nobody has ever checked.'
            },
            {
              label: '&ldquo;That&rsquo;s a separate change and it needs him on the call or in writing. I&rsquo;ll send you what he has to do.&rdquo;',
              a: 10, p: 10,
              note: 'The right boundary in the right place, with a route attached. A verified caller may act on their own account; adding a person changes who may act on it in future, and that deserves its own check.'
            },
            {
              label: '&ldquo;Of course, no problem.&rdquo;',
              a: 0, p: 8,
              pivot: 'A second request inside one call was granted because refusing twice felt rude.',
              note: 'The same outcome as the reply above it, without even the pause. Worth naming what just happened: having said no once, saying no again in the same call feels twice as rude &mdash; and that arithmetic is the thing every single technique in this game is built on.'
            }
          ]
        }
      ],
      truth: 'She was the customer. The married name, the address and the four days were all true, and the code proved it in about forty seconds. Nothing about the call required a judgement of character. It required one check that pointed at something on the record rather than at something in the caller&rsquo;s memory.',
      control: 'A verification process with a documented fallback and a documented ceiling: what to do when the questions fail, and what an agent may never do however convincing the call. Both halves are needed &mdash; a process with no fallback produces cruelty, and a process with no ceiling produces a takeover.'
    }
  ];

  GameShell.define({
    id: 'game-social-engineering',
    slug: 'social-engineering',
    title: 'Social engineering',
    /* All four runtime fields are stated here even where they match the
       shell's own defaults. The manifest names them too, and build.js
       refuses the deploy when a behavioural field is set in one place and
       not the other — see doGamesManifestParity(). */
    bestKey: 'social-engineering',
    bestOrder: 'high',
    tapAction: false,
    tapKey: 'action',
    /* NOT paused on a tab switch. There is no clock in here, so nothing is
       owed when you come back — and covering a half-read scenario with a
       Paused panel, then moving the keyboard onto a Resume button, is a
       bigger interruption than the one it would be preventing. The bed goes
       quiet on a hidden tab regardless; the shell handles that separately. */
    pauseOnBlur: false,
    startTitle: 'The phone is ringing',
    startText: 'Short conversations under live pressure, played from the defender’s chair. Some of the ' +
      'callers are genuine. There is no clock, on purpose. Nothing is uploaded and nothing is stored ' +
      'but your best score, on this device.',

    setup: function (g) {
      /* Asked once rather than per frame, for the same reason
         incident-response.js asks once: the setting is about the visitor and
         not about this frame. It governs one thing here — whether the two
         meter bars ease or snap. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      /* THE BOARD. The manifest declares board: true so the generated page
         supplies a .game-board and no canvas. If it ever ships the other way
         round this game would render nothing at all, which is a worse
         failure than eight lines of belt and braces. */
      var host = g.board;
      if (!host) {
        host = document.createElement('div');
        host.className = 'game-board';
        if (g.canvas) g.canvas.hidden = true;
        (g.stage || g.el).appendChild(host);
        g.board = host;
        g.focusTarget = host;
        host.setAttribute('tabindex', '0');
      }
      host.style.display = 'block';
      host.style.width = '100%';
      host.style.maxWidth = '46rem';
      host.style.textAlign = 'left';

      var lengthSel = document.getElementById('game-length');
      var coachBtn = document.getElementById('game-coach');

      var S = null;              // the whole run, rebuilt by begin()
      var coach = false;         // name the technique BEFORE the reply
      var optBtns = [];
      var optIdx = 0;
      var barShown = [0, 0];     // eased meter values, one per AXES entry
      var barFills = [];
      var barNums = [];

      /* ---------------------------------------------------------------
         The room. A phone call under pressure is a CONDITION rather than a
         stream of events, so the ambience is a bed and not a series of
         one-shots: building air, the narrow band of an open handset line,
         and a slow pulse underneath. One steered value moves all three —
         how far into a scenario you are, mixed with how much has been given
         away — so the room tightens as the conversation does, without ever
         announcing that it has.

         Everything sits very low. This is a reading game, and a bed that
         competes with the text is a bed nobody keeps switched on. The
         one-shots on top of it are events: a reply chosen, a scenario
         closing.
         --------------------------------------------------------------- */
      var room = g.bed(function (a) {
        var ctx = a.ctx;

        var air = ctx.createBufferSource();
        air.buffer = a.noise();
        air.loop = true;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 330;
        /* Flat. Any resonance at all turns office air into a whistle, and a
           whistle is a kettle rather than a room. */
        lp.Q.value = 0.4;
        var airGain = ctx.createGain();
        airGain.gain.value = 0.024;
        air.connect(lp);
        lp.connect(airGain);
        airGain.connect(a.out);
        air.start();

        /* The line. The same shared noise buffer through a narrow bandpass
           around a telephone's band, which is what an open handset actually
           sounds like when nobody is talking. STARTED AT AN OFFSET: both
           layers read the same two-second buffer, and starting them together
           made one correlated hiss with an audible flange rather than two
           independent textures. */
        var line = ctx.createBufferSource();
        line.buffer = a.noise();
        line.loop = true;
        var bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1050;
        bp.Q.value = 3.2;
        var lineGain = ctx.createGain();
        lineGain.gain.value = 0.005;
        line.connect(bp);
        bp.connect(lineGain);
        lineGain.connect(a.out);
        line.start(0, 0.7);

        /* The pulse: one oscillator whose gain is opened and closed by an
           LFO, rather than a queue of one-shots. Two nodes for the whole run,
           nothing to stack up behind a hidden tab, and capped well under two
           a second at the top of its range — a heartbeat under the text, not
           a metronome over it. */
        var pulse = ctx.createOscillator();
        var pulseGain = ctx.createGain();
        var lfo = ctx.createOscillator();
        var depth = ctx.createGain();
        pulse.type = 'sine';
        pulse.frequency.value = 136;
        pulseGain.gain.value = 0;
        lfo.type = 'sine';
        lfo.frequency.value = 0.44;
        depth.gain.value = 0.0028;
        lfo.connect(depth);
        depth.connect(pulseGain.gain);
        pulse.connect(pulseGain);
        pulseGain.connect(a.out);
        pulse.start();
        lfo.start();

        function ramp(param, value, secs) {
          var t = ctx.currentTime;
          param.cancelScheduledValues(t);
          param.setValueAtTime(param.value, t);
          param.linearRampToValueAtTime(value, t + (secs == null ? 1.6 : secs));
        }

        return {
          set: function (key, value) {
            if (key !== 'pressure') return;
            var k = value < 0 ? 0 : (value > 1 ? 1 : value);
            /* Slow ramps. The thing being tracked moves in steps of a whole
               reply, and a fast ramp turns every click into an audible swell
               — which reads as the room reacting to the mouse. */
            ramp(lp.frequency, 300 + k * 620, 2.2);
            ramp(bp.frequency, 1000 + k * 420, 2.2);
            ramp(lfo.frequency, 0.44 + k * 0.9, 2.2);
            ramp(depth.gain, 0.0026 + k * 0.005, 2.2);
          }
        };
      });

      /* ---------------------------------------------------------------
         Scoring. Both meters are the running MEAN of the ratings given so
         far, out of 100 — see the note beside AXES for why this is not a
         drifting total.
         --------------------------------------------------------------- */
      function meter(key) {
        if (!S || !S.answered) return null;
        return (S.sum[key] / S.answered) * 10;
      }

      function composite() {
        var a = meter('a');
        var p = meter('p');
        if (a === null) return 0;
        return Math.round((a + p) / 2);
      }

      /* How tense the room is, 0..1. Rises through a scenario and rises
         again with anything already given away, so the bed and the
         scoreboard are reading the same run. */
      function pressure() {
        if (!S) return 0;
        var through = S.run.length ? (S.turn / Math.max(1, S.run[S.at].turns.length)) : 0;
        var a = meter('a');
        var given = a === null ? 0 : (100 - a) / 100;
        var k = through * 0.5 + given * 0.5;
        return k < 0 ? 0 : (k > 1 ? 1 : k);
      }

      /* ---------------------------------------------------------------
         Rendering. Everything is inline-styled: this game ships one file,
         and adding rules to the shared games.css for one page's benefit is
         how a stylesheet becomes nobody's.
         --------------------------------------------------------------- */
      var INK = 'var(--ink)';
      var INK3 = 'var(--ink-3)';
      var INK4 = 'var(--ink-4)';
      var LINE = 'rgb(var(--line-rgb) / 0.28)';
      var SHEET = 'rgb(var(--sheet-rgb) / 0.6)';
      var MONO = '\'Cascadia Code\',Consolas,monospace';

      function barColour(pct) {
        if (pct >= 66) return '#4ade80';
        if (pct >= 34) return '#fbbf24';
        return '#f87171';
      }

      /* COLOUR IS NEVER THE ONLY SIGNAL. Each bar carries the number, an
         aria-label saying which direction is good, and — once there is
         anything to say — a word for where it stands. */
      function barWord(pct) {
        if (pct >= 80) return 'strong';
        if (pct >= 60) return 'holding';
        if (pct >= 35) return 'slipping';
        return 'poor';
      }

      function metersHtml() {
        var out = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));' +
          'gap:0.55rem 1.2rem;margin:0 0 1rem;">';
        for (var i = 0; i < AXES.length; i++) {
          var ax = AXES[i];
          var live = meter(ax.key);
          var pct = Math.round(barShown[i]);
          var shown = live === null ? '&mdash;' : String(Math.round(live));
          var label = live === null
            ? ax.label + ', not scored yet, ' + ax.hint
            : ax.label + ' ' + Math.round(live) + ' out of 100, ' + barWord(pct) + ', ' + ax.hint;
          out +=
            '<div>' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.4rem;">' +
            '<span style="font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;color:' +
            INK4 + ';">' + ax.label + '</span>' +
            '<span data-se-num="' + i + '" style="font-family:' + MONO + ';font-size:0.82rem;color:' +
            INK + ';">' + shown + '</span>' +
            '</div>' +
            '<div role="img" aria-label="' + label + '" style="height:7px;margin-top:0.25rem;' +
            'border-radius:999px;background:rgba(148,163,184,0.18);overflow:hidden;">' +
            '<div data-se-bar="' + i + '" style="height:100%;width:' + (live === null ? 0 : pct) +
            '%;border-radius:999px;background:' + barColour(pct) + ';"></div>' +
            '</div></div>';
        }
        return out + '</div>';
      }

      function talkHtml() {
        var out = '<div style="margin:0 0 1rem;padding:0.75rem 0.9rem;background:' + SHEET +
          ';border:1px solid ' + LINE + ';border-radius:10px;">';
        for (var i = 0; i < S.talk.length; i++) {
          var t = S.talk[i];
          var who = t.who === 'you' ? 'You' : (t.who === 'scene' ? '' : 'Them');
          out += '<p style="display:flex;gap:0.6rem;margin:0 0 0.45rem;font-size:0.85rem;' +
            'line-height:1.6;color:' + (t.who === 'you' ? INK : INK3) + ';">' +
            '<span style="font-family:' + MONO + ';font-size:0.7rem;color:' + INK4 + ';' +
            'flex:0 0 2.6rem;text-transform:uppercase;letter-spacing:0.05em;">' + who + '</span>' +
            '<span>' + t.text + '</span></p>';
        }
        return out + '</div>';
      }

      function headerHtml() {
        var sc = S.run[S.at];
        return '<p style="margin:0 0 0.75rem;font-size:0.72rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">' + sc.channel + ' &middot; ' + sc.name +
          ' &middot; ' + (S.at + 1) + ' of ' + S.run.length + '</p>';
      }

      function techChip(tech) {
        return '<p style="margin:0 0 0.7rem;font-size:0.72rem;letter-spacing:0.05em;' +
          'text-transform:uppercase;color:' + INK4 + ';">Technique in play: <span style="color:' +
          INK + ';">' + tech + '</span></p>';
      }

      /* The board is rebuilt whole on every step, which is one innerHTML
         write every few seconds of play. The bars are painted from barShown
         rather than from the live mean, so a rebuild in the middle of an ease
         does not snap them to the destination and then animate backwards —
         that was the first version and it looked like a rendering fault. */
      function render() {
        var sc = S.run[S.at];
        var turn = sc.turns[S.turn];
        var i;

        S.opts = turn.opts;

        var html = headerHtml() + metersHtml() + talkHtml();
        if (coach) html += techChip(turn.tech);
        html += '<div role="group" aria-label="Choose your reply" style="display:grid;gap:0.5rem;">';
        for (i = 0; i < turn.opts.length; i++) {
          html +=
            '<button class="game-btn" type="button" data-se-opt="' + i + '" ' +
            'style="display:block;width:100%;text-align:left;padding:0.7rem 0.85rem;' +
            'font-size:0.88rem;line-height:1.55;white-space:normal;height:auto;">' +
            turn.opts[i].label + '</button>';
        }
        html += '</div><div data-se-note></div>';

        host.innerHTML = html;
        wireBars();
        wireOpts();
        g.stat('call', (S.at + 1) + '/' + S.run.length);
        g.stat('tech', coach ? turn.tech : '—');
      }

      function wireBars() {
        barFills = [];
        barNums = [];
        var fills = host.querySelectorAll('[data-se-bar]');
        var nums = host.querySelectorAll('[data-se-num]');
        var i;
        for (i = 0; i < fills.length; i++) barFills.push(fills[i]);
        for (i = 0; i < nums.length; i++) barNums.push(nums[i]);
      }

      function wireOpts() {
        optBtns = [];
        var nodes = host.querySelectorAll('[data-se-opt]');
        for (var i = 0; i < nodes.length; i++) {
          (function (node, pos) {
            optBtns.push(node);
            node.addEventListener('click', function () { choose(pos); });
            node.addEventListener('focus', function () { optIdx = pos; });
          })(nodes[i], i);
        }
        optIdx = 0;
      }

      /* The first arrow press SELECTS rather than moves. The shell puts the
         keyboard on the board when a run starts, so nothing in the group has
         focus at that moment, and treating Down as "one past the top" skipped
         the first reply entirely — which is the commonest way a keyboard
         player never reads the option a turn is really about. */
      function focusOpt(delta) {
        if (!optBtns.length) return;
        var active = document.activeElement;
        var on = -1;
        var i;
        for (i = 0; i < optBtns.length; i++) if (optBtns[i] === active) { on = i; break; }
        if (on < 0) optIdx = delta > 0 ? 0 : optBtns.length - 1;
        else optIdx = (on + delta + optBtns.length) % optBtns.length;
        try { optBtns[optIdx].focus({ preventScroll: true }); }
        catch (err) { optBtns[optIdx].focus(); }
      }

      function focusFirst() {
        if (!optBtns.length) return;
        try { optBtns[0].focus({ preventScroll: true }); }
        catch (err) { optBtns[0].focus(); }
      }

      /* ---------------------------------------------------------------
         The two-axis verdict, in words as well as in colour.
         --------------------------------------------------------------- */
      function verdictOf(opt) {
        if (opt.a <= 3) {
          return { word: 'You gave ground.', tone: '#f87171', bg: 'rgba(248,113,113,0.1)' };
        }
        if (opt.p <= 3) {
          return {
            word: 'Asset held — at a cost to the person on the other end.',
            tone: '#fbbf24', bg: 'rgba(251,191,36,0.1)'
          };
        }
        return { word: 'Held, and handled well.', tone: '#4ade80', bg: 'rgba(74,222,128,0.1)' };
      }

      function scoreLine(opt) {
        return '<p style="margin:0 0 0.7rem;font-family:' + MONO + ';font-size:0.75rem;color:' +
          INK4 + ';">Asset protected ' + opt.a + '/10 &nbsp;&middot;&nbsp; Handled well ' +
          opt.p + '/10</p>';
      }

      /* ---------------------------------------------------------------
         Choosing a reply.
         --------------------------------------------------------------- */
      function choose(pos) {
        if (!S || S.done || S.pending) return;
        var opt = S.opts[pos];
        if (!opt) return;
        var sc = S.run[S.at];
        var turn = sc.turns[S.turn];
        S.pending = true;

        S.talk.push({ who: 'you', text: opt.label });
        S.sum.a += clamp10(opt.a);
        S.sum.p += clamp10(opt.p);
        S.answered++;

        /* Per technique, so the debrief can say which pressure actually
           worked on this player rather than only printing one number. */
        if (!S.tech[turn.tech]) S.tech[turn.tech] = { n: 0, a: 0, p: 0 };
        S.tech[turn.tech].n++;
        S.tech[turn.tech].a += clamp10(opt.a);
        S.tech[turn.tech].p += clamp10(opt.p);

        if (opt.pivot) S.pivots.push({ where: sc.name, line: opt.pivot });

        g.setScore(composite());
        g.stat('tech', turn.tech);
        room.set('pressure', pressure());

        /* A struck note per reply, pitched by how it went. An event, so a
           one-shot — the held layer is the room, not the conversation. */
        g.pluck(opt.a <= 3 ? 196 : (opt.p <= 3 ? 262 : 392), 0.45, 0.05);

        var v = verdictOf(opt);
        var note = host.querySelector('[data-se-note]');
        var group = host.querySelector('[role="group"]');
        /* The consequence REPLACES the replies rather than appearing under
           them. Leaving the buttons on screen invited a second click on a
           decision already taken, and a conversation you can re-answer after
           seeing the outcome is not teaching anything. */
        if (group) group.hidden = true;
        if (note) {
          note.innerHTML =
            '<div style="margin-top:0.2rem;padding:0.85rem 0.95rem;border-radius:10px;' +
            'border-left:3px solid ' + v.tone + ';background:' + v.bg + ';">' +
            '<p style="margin:0 0 0.5rem;font-size:0.8rem;font-weight:600;color:' + INK + ';">' +
            v.word + '</p>' +
            (coach ? '' : techChip(turn.tech)) +
            scoreLine(opt) +
            '<p style="margin:0 0 0.85rem;font-size:0.87rem;line-height:1.65;color:' + INK3 + ';">' +
            opt.note + '</p>' +
            '<button class="btn btn-primary" type="button" data-se-next>Carry on</button></div>';
          var next = note.querySelector('[data-se-next]');
          next.addEventListener('click', advance);
          try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); }
        }

        g.announce(v.word + ' Technique: ' + turn.tech + '. ' + plain(opt.note));
      }

      function advance() {
        if (!S || S.done) return;
        S.pending = false;
        S.turn++;
        var sc = S.run[S.at];
        if (S.turn >= sc.turns.length) { wrap(); return; }
        S.talk.push({ who: 'them', text: sc.turns[S.turn].line });
        render();
        focusFirst();
      }

      /* ---------------------------------------------------------------
         The end of one scenario: what was really going on, and the control
         that would have removed the pressure entirely. Every scenario ends
         here — see decision 5 in the header.
         --------------------------------------------------------------- */
      function wrap() {
        var sc = S.run[S.at];
        S.controls.push({ name: sc.name, control: sc.control });

        g.noise(0.4, { type: 'lowpass', freq: 420, to: 120, q: 0.6, level: 0.045 });

        var html = headerHtml() + metersHtml() + talkHtml() +
          '<div style="padding:0.9rem 1rem;border-radius:10px;background:' + SHEET +
          ';border:1px solid ' + LINE + ';">' +
          '<h3 style="margin:0 0 0.4rem;font-size:0.95rem;color:' + INK + ';">' +
          (sc.kind === 'genuine' ? 'This one was genuine' : 'What was actually happening') + '</h3>' +
          '<p style="margin:0 0 0.9rem;font-size:0.87rem;line-height:1.65;color:' + INK3 + ';">' +
          sc.truth + '</p>' +
          '<h3 style="margin:0 0 0.4rem;font-size:0.95rem;color:' + INK + ';">' +
          'The control that removes this conversation</h3>' +
          '<p style="margin:0 0 0.9rem;font-size:0.87rem;line-height:1.65;color:' + INK3 + ';">' +
          sc.control + '</p>' +
          '<button class="btn btn-primary" type="button" data-se-next>' +
          (S.at + 1 >= S.run.length ? 'See the debrief' : 'Next conversation') + '</button></div>';

        host.innerHTML = html;
        wireBars();
        optBtns = [];
        S.pending = true;

        var next = host.querySelector('[data-se-next]');
        next.addEventListener('click', nextScenario);
        try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); }

        g.announce((sc.kind === 'genuine' ? 'That caller was genuine. ' : '') +
          plain(sc.truth) + ' The control: ' + plain(sc.control));
      }

      function nextScenario() {
        if (!S || S.done) return;
        S.pending = false;
        S.at++;
        if (S.at >= S.run.length) { finish(); return; }
        S.turn = 0;
        S.talk = [
          { who: 'scene', text: S.run[S.at].opening },
          { who: 'them', text: S.run[S.at].turns[0].line }
        ];
        room.set('pressure', pressure());
        render();
        focusFirst();
      }

      /* ---------------------------------------------------------------
         The debrief.
         --------------------------------------------------------------- */
      function finish() {
        S.done = true;
        var score = composite();
        /* over() does the real work — the best, the storage write, the
           announcement, the state change. Its overlay is a 26rem card and
           this report is a page, so ended() hides the card underneath. */
        g.over({
          score: score,
          won: score >= 70,
          title: 'Debrief',
          message: 'Scored ' + score + ' out of 100 across both axes.'
        });
      }

      function axisVerdict(key, pct) {
        if (key === 'a') {
          return pct >= 80 ? 'Nothing worth having left the building.'
               : pct >= 60 ? 'Mostly held. One or two answers gave something away.'
               : pct >= 35 ? 'Several assets went out on a story.'
               : 'Almost everything asked for was handed over.';
        }
        return pct >= 80 ? 'Polite, specific, and everybody was left with a route.'
             : pct >= 60 ? 'Reasonable. A few replies closed a door and offered nothing.'
             : pct >= 35 ? 'Blunt. Some of the people you refused needed an answer.'
             : 'A defender people will route around rather than ask.';
      }

      function report(score, isBest) {
        var i;
        var a = Math.round(meter('a') || 0);
        var p = Math.round(meter('p') || 0);

        var html =
          '<p style="margin:0 0 0.75rem;font-size:0.72rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">Debrief &middot; ' + S.run.length +
          ' conversations &middot; ' + S.answered + ' replies</p>' +
          '<h3 style="margin:0 0 0.15rem;font-size:1.3rem;color:' + INK + ';">' + score +
          ' out of 100' + (isBest ? ' <span style="font-size:0.75rem;color:#4ade80;">new best</span>' : '') +
          '</h3>' +
          '<p style="margin:0 0 1.1rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
          'The mean of the two axes, each of which is the mean of every reply you gave. They are ' +
          'scored separately because they disagree constantly &mdash; and a run that is strong on one ' +
          'and weak on the other is the interesting result, not a mistake.</p>';

        var vals = [a, p];
        for (i = 0; i < AXES.length; i++) {
          html +=
            '<div style="margin:0 0 0.85rem;">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;">' +
            '<span style="font-size:0.85rem;color:' + INK + ';">' + AXES[i].label +
            ' <span style="font-size:0.7rem;color:' + INK4 + ';">' + AXES[i].long + '</span></span>' +
            '<span style="font-family:' + MONO + ';font-size:0.85rem;color:' + INK + ';">' +
            vals[i] + '</span></div>' +
            '<div role="img" aria-label="' + AXES[i].label + ' ' + vals[i] + ' out of 100, ' +
            barWord(vals[i]) + '" style="height:7px;margin:0.25rem 0 0.3rem;border-radius:999px;' +
            'background:rgba(148,163,184,0.18);overflow:hidden;">' +
            '<div style="height:100%;width:' + vals[i] + '%;border-radius:999px;background:' +
            barColour(vals[i]) + ';"></div></div>' +
            '<p style="margin:0;font-size:0.8rem;line-height:1.55;color:' + INK3 + ';">' +
            axisVerdict(AXES[i].key, vals[i]) + '</p></div>';
        }

        html += '<h4 style="margin:1.2rem 0 0.5rem;font-size:0.95rem;color:' + INK + ';">' +
          'The techniques you met</h4><ul style="margin:0 0 0.6rem;padding-left:1.1rem;">';
        for (var name in S.tech) {
          if (!Object.prototype.hasOwnProperty.call(S.tech, name)) continue;
          var t = S.tech[name];
          var mean = Math.round((t.a / t.n) * 10);
          html += '<li style="margin:0 0 0.4rem;font-size:0.85rem;line-height:1.6;color:' + INK3 +
            ';"><strong style="color:' + INK + ';">' + name + '</strong> &mdash; ' + t.n +
            (t.n === 1 ? ' turn' : ' turns') + ', asset held ' + mean + ' out of 100 against it.</li>';
        }
        html += '</ul>';

        html += '<h4 style="margin:1.2rem 0 0.5rem;font-size:0.95rem;color:' + INK + ';">' +
          'Where something was given away</h4>';
        if (S.pivots.length) {
          html += '<ul style="margin:0 0 0.6rem;padding-left:1.1rem;">';
          for (i = 0; i < S.pivots.length; i++) {
            html += '<li style="margin:0 0 0.4rem;font-size:0.85rem;line-height:1.6;color:' + INK3 +
              ';"><span style="color:' + INK4 + ';">' + S.pivots[i].where + '</span> &mdash; ' +
              S.pivots[i].line + '</li>';
          }
          html += '</ul>';
        } else {
          html += '<p style="margin:0 0 0.6rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
            'Nothing was handed over on this run, and nobody was stonewalled into finding another ' +
            'route. That is the combination worth having, and it is harder than either half alone.</p>';
        }

        html += '<h4 style="margin:1.2rem 0 0.5rem;font-size:0.95rem;color:' + INK + ';">' +
          'The controls that would have removed the pressure</h4>' +
          '<ul style="margin:0 0 0.9rem;padding-left:1.1rem;">';
        for (i = 0; i < S.controls.length; i++) {
          html += '<li style="margin:0 0 0.5rem;font-size:0.85rem;line-height:1.6;color:' + INK3 +
            ';"><strong style="color:' + INK + ';">' + S.controls[i].name + '</strong> &mdash; ' +
            S.controls[i].control + '</li>';
        }
        html += '</ul>';

        /* The paragraph the whole game exists for. It is last because it is
           the thing worth being left holding. */
        html +=
          '<div style="margin-top:1.1rem;padding:0.9rem 1rem;border-radius:10px;background:' + SHEET +
          ';border:1px solid ' + LINE + ';">' +
          '<h4 style="margin:0 0 0.45rem;font-size:0.95rem;color:' + INK + ';">' +
          'The process, not the person</h4>' +
          '<p style="margin:0 0 0.6rem;font-size:0.85rem;line-height:1.65;color:' + INK3 + ';">' +
          'Every conversation in here ends on a control, and none of them end on what you should have ' +
          'spotted. That is deliberate. Each of these attacks works by asking one individual to be ' +
          'clever, alone, at speed, against somebody who has rehearsed &mdash; and the answer to that ' +
          'is never a better individual. It is a callback rule, a named approver, an out-of-band ' +
          'check, a visitor diary and a documented fallback, decided by daylight with more than one ' +
          'person in the room.</p>' +
          '<p style="margin:0 0 0.6rem;font-size:0.85rem;line-height:1.65;color:' + INK3 + ';">' +
          'Which is also why blaming the person who was manipulated is both unkind and useless. It is ' +
          'unkind because the techniques here are aimed squarely at ordinary decency &mdash; ' +
          'helpfulness, deference, not wanting to be rude to somebody carrying two coffees. It is ' +
          'useless because the next person to be shouted at for falling for one is the next person who ' +
          'quietly does not report one, and late reporting costs far more than the original mistake.</p>' +
          '<p style="margin:0;font-size:0.8rem;line-height:1.65;color:' + INK4 + ';">' +
          'Three things next door on this site. ' +
          '<a href="/blog/digital-arrest-scam-explained">The digital arrest scam explained</a> is ' +
          'authority and urgency run to their limit, on a call designed never to end. ' +
          '<a href="/blog/how-sim-swap-works">How a SIM swap works</a> is this game aimed at a support ' +
          'agent instead of at you. And <a href="/labs/osint-self-check">the OSINT self-check</a> shows ' +
          'what a stranger can read about you before they ring &mdash; which is where the ' +
          'uncomfortable familiarity in half of these conversations comes from.</p></div>' +
          '<div style="margin-top:1.1rem;display:flex;gap:0.6rem;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" type="button" data-se-again>Take another set</button>' +
          '<button class="game-btn" type="button" data-se-coach>' +
          (coach ? 'Turn the technique hints off' : 'Replay with the technique named first') +
          '</button></div>';

        host.innerHTML = html;
        barFills = [];
        barNums = [];
        optBtns = [];

        var again = host.querySelector('[data-se-again]');
        again.addEventListener('click', function () { g.start(); });
        host.querySelector('[data-se-coach]').addEventListener('click', function () {
          setCoach(!coach);
          g.start();
        });
        try { again.focus({ preventScroll: true }); } catch (err) { again.focus(); }
      }

      /* ---------------------------------------------------------------
         Controls in the toolbar.
         --------------------------------------------------------------- */
      function setCoach(on) {
        coach = !!on;
        if (coachBtn) {
          coachBtn.setAttribute('aria-pressed', String(coach));
          coachBtn.title = coach
            ? 'The technique is named before you reply'
            : 'The technique is named after you reply';
        }
        g.save('coach', coach ? 'on' : 'off');
      }

      if (coachBtn) {
        coachBtn.addEventListener('click', function () {
          setCoach(!coach);
          g.announce(coach
            ? 'Technique named before each reply.'
            : 'Technique named after each reply.');
          if (S && !S.done && !S.pending) { render(); focusFirst(); }
        });
      }

      if (lengthSel) {
        lengthSel.addEventListener('change', function () {
          g.save('length', lengthSel.value);
          /* A new length restarts, because there is no coherent way to
             lengthen a set somebody is halfway through. Announced rather
             than done silently: throwing away a half-finished run without
             saying so reads as a fault. */
          g.announce('Set length changed. Starting again.');
          g.start();
        });
      }

      function runLength() {
        var n = parseInt(lengthSel ? lengthSel.value : '4', 10);
        if (!(n > 0)) n = 4;
        return Math.min(n, SCENARIOS.length);
      }

      /* Draw the set. At least one of the conversations in every run is
         GENUINE, and which one is never signalled — a run of pure attacks
         would quietly teach that refusing everything is free, which is the
         single lesson this game is most anxious not to teach. With five
         attacks and three genuine in the pool, a four-draw comes up with no
         genuine about seven per cent of the time, so the swap below fires
         rarely and is not a thumb on the scale. */
      function buildRun() {
        var pool = SCENARIOS.slice();
        g.shuffle(pool);
        var want = runLength();
        var picked = pool.slice(0, want);
        var i;
        var hasGenuine = false;
        for (i = 0; i < picked.length; i++) {
          if (picked[i].kind === 'genuine') { hasGenuine = true; break; }
        }
        if (!hasGenuine) {
          for (i = want; i < pool.length; i++) {
            if (pool[i].kind !== 'genuine') continue;
            picked[picked.length - 1] = pool[i];
            break;
          }
        }
        g.shuffle(picked);
        return picked;
      }

      function begin() {
        S = {
          run: buildRun(),
          at: 0,
          turn: 0,
          answered: 0,
          sum: { a: 0, p: 0 },
          tech: {},
          pivots: [],
          controls: [],
          talk: [],
          opts: [],
          pending: false,
          done: false
        };
        S.talk = [
          { who: 'scene', text: S.run[0].opening },
          { who: 'them', text: S.run[0].turns[0].line }
        ];
        barShown[0] = 0;
        barShown[1] = 0;
        /* A dash rather than a nought. The shell writes stat('score', 0)
           inside start() before reset() runs, and a nought sitting under a
           conversation nobody has answered yet is a claim about a run that
           has not happened. */
        g.stat('score', '—');
        g.stat('tech', '—');
        room.set('pressure', 0);
        render();
      }

      return {
        ready: function () {
          /* The shell runs reset() during construction and ready() straight
             after, so a restored preference arrives one step too late: the
             board behind the Play screen was already built from whatever the
             select happened to default to. Restore, then build it again. */
          var savedCoach = g.load('coach', '');
          var savedLen = g.load('length', '');
          var moved = false;
          if (savedCoach === 'on' || savedCoach === 'off') setCoach(savedCoach === 'on');
          else setCoach(false);
          if (lengthSel && savedLen && lengthSel.value !== savedLen) {
            for (var i = 0; i < lengthSel.options.length; i++) {
              if (lengthSel.options[i].value !== savedLen) continue;
              lengthSel.value = savedLen;
              moved = true;
              break;
            }
          }
          if (moved || savedCoach === 'on') begin();
        },

        reset: begin,

        key: function (name) {
          if (!S || S.done) return;
          var next = host.querySelector('[data-se-next]');
          /* While a consequence or a scenario wrap is on screen the replies
             are gone but their buttons may still exist in the tree, so the
             arrows would happily move focus onto something nobody can see.
             There is exactly one thing to do here and it is Carry on. */
          if (S.pending) {
            if (name === 'action' && next) next.click();
            return;
          }
          if (name === 'up' || name === 'left') { focusOpt(-1); return; }
          if (name === 'down' || name === 'right') { focusOpt(1); return; }
          if (name === 'action' && optBtns.length) choose(optIdx);
        },

        update: function (dt) {
          if (!S || S.done || !barFills.length) return;
          for (var i = 0; i < barFills.length && i < AXES.length; i++) {
            var live = meter(AXES[i].key);
            if (live === null) continue;
            if (reduced) barShown[i] = live;
            else barShown[i] += (live - barShown[i]) * Math.min(1, 6 * dt);
            var pct = Math.round(barShown[i]);
            if (barFills[i].getAttribute('data-se-pct') === String(pct)) continue;
            barFills[i].setAttribute('data-se-pct', String(pct));
            barFills[i].style.width = pct + '%';
            barFills[i].style.background = barColour(pct);
            /* The figure travels with the bar rather than jumping to the
               final value the instant a reply lands. A number that has
               settled above a bar still moving is the pair visibly
               disagreeing about the same meter. */
            if (barNums[i]) barNums[i].textContent = String(pct);
          }
        },

        ended: function (score, isBest) {
          /* The shell has just opened its game-over card over the board. The
             debrief is two meters, a technique breakdown, a list of controls
             and three paragraphs; it does not fit in that card and must not
             sit behind it. */
          g.hideOverlay();
          report(score, isBest);
        }
      };
    }
  });
})();

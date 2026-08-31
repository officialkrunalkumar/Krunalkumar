/* ==========================================================================
   incident-response.js — a breach tabletop with a clock that does not stop.
   --------------------------------------------------------------------------
   THE CLOCK IS THE GAME. Everything else here is scaffolding around one
   claim: an incident is not a quiz with a right answer, it is a sequence of
   irreversible choices made on partial information while something else
   keeps moving. A version of this that paused the world between decisions
   was built first and it was worthless — with unlimited time every player
   images the disk, verifies the backup, briefs legal AND contains the host,
   because nothing costs anything. The whole subject disappears.

   So time is spent two ways and both are visible in the HUD:

     - EVERY OPTION COSTS MINUTES. Taking a memory capture before rebuilding
       is fifty-five minutes; rebuilding from the golden image is eight.
       That gap is the actual decision, and it is the one people get wrong.

     - DELIBERATION COSTS MINUTES TOO, at a quarter of a simulated minute
       per real second, capped at DRIFT_CAP per decision. The cap is not
       decoration: a player using a screen reader, or reading carefully
       because they are here to learn, must not be scored worse than a
       player who clicks fast. Sixty real seconds is the most any single
       decision can cost, and the Measured pressure setting turns the drift
       off entirely — which is the escape hatch, stated on the page.

   Attacker events fire off the same minute counter, so they can and do land
   WHILE a decision is open. That is the one mechanic that cannot be faked by
   text: watching \\FS-02 join the encryption while you are still reading the
   options is the lesson.

   ---- FOUR METERS THAT FIGHT ---------------------------------------------
   Containment, evidence preserved, business impact and regulatory exposure.
   Two want to be high, two want to be low, and almost nothing moves one
   without moving another the wrong way:

     pull the power on the host   containment ++   evidence ---  (RAM is gone)
     rebuild before imaging       business    ++   evidence ---
     watch it for twenty minutes  evidence    ++   business ---
     pull the whole server VLAN   containment ++   business ---
     tell staff before legal      (nothing)        exposure  ++

   There is deliberately NO dominant line. A run that maxes containment
   scores about the same as one that maxes evidence; the good runs are the
   ones that spend the cheap wins early and take the expensive trade
   knowingly. The after-action report says which trade was taken and what it
   cost, because a score alone teaches nothing — same rule phishing-or-not.js
   follows for its explanations.

   ---- WHY THE REPORT IS NOT IN THE OVERLAY -------------------------------
   The shell's game-over overlay is a 26rem card over a dimmed stage, which
   is the right shape for "Score 340. New best." and the wrong shape for
   four meters, a list of decision points and five lines about what an IR
   plan should have pre-decided. So over() is called for its real work —
   the best score, the storage write, the announcement — and the overlay is
   then hidden from hooks.ended() so the report underneath is readable. The
   report carries its own restart button, because hiding the overlay hides
   the shell's one.

   ---- THE LEGAL LINES ----------------------------------------------------
   Two real obligations are referenced and only two, because a training game
   that gets the law slightly wrong is worse than one that stays quiet:

     - CERT-In's April 2022 direction under section 70B(6) of the IT Act
       requires certain cyber incidents to be reported to CERT-In within SIX
       HOURS of noticing them. The six-hour event at minute 360 is that
       clock, and it runs from the first alert rather than from the moment
       anyone was sure.
     - GDPR Article 33 gives 72 HOURS from becoming aware of a personal-data
       breach to notify the supervisory authority. Seventy-two hours cannot
       be reached inside a run, so it is reported as a fraction used rather
       than simulated as an event.

   Both are stated as context. The report says in as many words that this is
   a training exercise and not legal advice, and no branch here tells anyone
   what their own duties are.
   ========================================================================== */

(function () {
  'use strict';

  /* Simulated minutes per real second of deliberation, and the ceiling on
     how many any one decision may cost. A quarter a second means the clock
     is visibly moving without being a stopwatch; sixty seconds of thinking
     is the most it can ever take off you. Both numbers were set by reading
     the longest beat aloud — about forty seconds — and leaving room. */
  var DRIFT_RATE = 0.25;
  var DRIFT_CAP = 15;

  /* Above this mean frame time the meter bars stop easing and snap. See the
     note in update(): the easing is sixty style writes a second across four
     elements, and it is the only thing in this file with a per-frame cost
     worth measuring. */
  var SLOW_FRAME_MS = 28;

  function clamp(v) {
    if (!(v > 0)) return 0;            // catches NaN as well as negatives
    return v > 100 ? 100 : v;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /* ==================================================================
     The two scenarios.
     ==================================================================
     A beat is a decision point. `when` on a beat removes it from the run
     entirely when an earlier choice has already answered it — that is where
     most of the branching lives, along with `when` on individual options and
     `text` written as a function of the flags.

     fx keys, kept to one letter because every option carries them:
       c  containment        higher is better
       e  evidence preserved higher is better
       b  business impact    lower is better
       r  regulatory exposure lower is better

     `pivot` marks the choices the after-action report names. Only the ones
     that genuinely turned the run are flagged — a report that lists all
     seven decisions as pivotal is a list, not a finding.
     ================================================================== */

  var RANSOMWARE = {
    key: 'ransomware',
    name: 'Ransomware on the file server',
    startMin: 134,                     // 02:14, a Saturday
    opening: 'It is 02:14 on a Saturday. You are the on-call responder for a ' +
      '400-person firm. Three things are on the console and only one of them matters.',
    beats: [
      {
        head: 'Three alerts, one of them real',
        text: function () {
          return 'The EDR has raised <strong>suspicious encryption behaviour</strong> on FS-01, the ' +
            'main file server: one detection, high confidence, twenty minutes old. The SIEM has ' +
            '<strong>340 failed VPN logons</strong> from thirty countries, still climbing. The backup ' +
            'appliance emailed <strong>&ldquo;job completed with warnings&rdquo;</strong> at 01:40. ' +
            'Nobody else is awake.';
        },
        opts: [
          {
            label: 'Work the 340 failed logons — that volume has to be the attack',
            cost: 35,
            fx: { c: 0, e: -2, b: 7, r: 4 },
            set: 'chasedNoise',
            pivot: 'Spent 35 minutes on the loudest alert while the real one ran.',
            note: 'It is a password spray from a botnet, and MFA has blocked every one of them — ' +
              'the same spray has been running for three weeks. Volume is not severity. While you ' +
              'read it, FS-01 encrypted another thirty thousand files.'
          },
          {
            label: 'Take the single EDR detection on FS-01 apart',
            cost: 10,
            fx: { c: 14, e: 8, b: 0, r: 0 },
            set: 'triaged',
            note: 'One process, spawned by a service account nobody recognises, walking the finance ' +
              'share and renaming as it goes. One high-confidence detection on one host beats three ' +
              'hundred low-confidence ones every time, and that is what triage means.'
          },
          {
            label: 'Ring the on-call infrastructure engineer and ask what changed tonight',
            cost: 16,
            fx: { c: 2, e: 4, b: 0, r: 0 },
            set: 'backupDoubt',
            note: 'Nothing changed tonight. But he says the backup job has warned every night for ' +
              'three weeks and the ticket for it is still open, which is a sentence you will want ' +
              'again in about an hour.'
          }
        ]
      },

      {
        head: 'FS-01 is still going',
        text: function (S) {
          return 'Roughly 900 files a minute, renamed to <code>.l0ck3d</code>. The EDR also shows RDP ' +
            'from FS-01 to three other servers inside the last twenty minutes' +
            (S.flags.chasedNoise ? ', two of which were clean when you started reading the VPN alerts' : '') +
            '. You can act on this host from the console without touching the building.';
        },
        opts: [
          {
            label: 'Network-isolate FS-01 from the EDR console — it stays powered',
            cost: 2,
            fx: { c: 44, e: -3, b: 9, r: -2 },
            set: 'contained',
            note: 'Encryption stops within seconds and the host stays up, so memory, the running ' +
              'process and its open handles survive for whoever images it. You lose the chance to ' +
              'watch the operator work, and the finance share is now offline for everybody.'
          },
          {
            label: 'Pull the power on FS-01 — nothing beats a machine that is off',
            cost: 3,
            fx: { c: 48, e: -26, b: 11, r: 3 },
            set: 'contained',
            setAlso: 'pulledPower',
            pivot: 'Powered off a live host, and every volatile artefact went with it.',
            note: 'It stops. So does everything in memory: the injected process, the operator&rsquo;s ' +
              'command history, the network connections, and — in perhaps one case in six — the key ' +
              'itself. This is the single most expensive reflex in incident response, and it feels ' +
              'like the most decisive thing you can do.'
          },
          {
            label: 'Watch it for twenty minutes to see where the operator goes next',
            cost: 22,
            fx: { c: -7, e: 16, b: 13, r: 2 },
            set: 'watched',
            note: 'You get the C2 address, the tooling, and the two accounts they are using — which ' +
              'is what makes the rest of the response possible instead of guesswork. It also costs ' +
              'twenty minutes of encryption and one more server. Sometimes this is the right call. ' +
              'It is never the free one.'
          },
          {
            label: 'Pull the whole server VLAN and argue about it in the morning',
            cost: 9,
            fx: { c: 52, e: 3, b: 27, r: -3 },
            set: 'contained',
            setAlso: 'backupSafe',
            pivot: 'Dropped the server VLAN: total containment, and the business went dark with it.',
            note: 'Nothing spreads any further, including to the backup appliance. Also nothing ' +
              'works: payroll, the warehouse scanners and the phone system are all on that VLAN, ' +
              'and Monday morning is now a separate incident.'
          }
        ]
      },

      {
        head: 'The finance director wants the share back',
        text: function (S) {
          if (!S.flags.contained) {
            return 'FS-01 is still encrypting and you have been watching it do so. You now know ' +
              'the C2 address and both accounts the operator is using, which is more than you knew ' +
              'twenty minutes ago, and 18,000 more files are gone.';
          }
          return 'It is ' + (S.flags.pulledPower ? 'a dark host in a rack' : 'a quarantined host') +
            ' with 260,000 encrypted files on it. The golden image would have FS-01 rebuilt and ' +
            'serving in under an hour. Nobody has taken a copy of anything yet.';
        },
        opts: [
          {
            /* Watching was a legitimate choice at the previous beat and it
               must not be a dead end: without this the only isolation option
               in the run had already gone by, and a player who took the
               evidence-first line could never contain at all. What it costs
               is that the twenty minutes are already spent. */
            label: 'Stop watching — isolate it now, you have seen enough',
            when: function (S) { return !S.flags.contained; },
            cost: 3,
            fx: { c: 40, e: 2, b: 12, r: -2 },
            set: 'contained',
            note: 'Encryption stops. The intelligence you bought with those twenty minutes is real ' +
              'and it will shape the rest of the response — and the twenty minutes are also real, ' +
              'and they are on the invoice as another eighteen thousand files.'
          },
          {
            label: 'Rebuild from the golden image now and get people working',
            cost: 50,
            fx: { c: 10, e: -30, b: -13, r: 8 },
            set: 'rebuiltFirst',
            pivot: 'Rebuilt the only affected host before imaging it.',
            note: 'The share is back by breakfast, and the only copy of the evidence has been ' +
              'formatted. In four days somebody will ask whether data left the building. There is ' +
              'now no artefact anywhere that can answer that, so the answer defaults to the one ' +
              'that costs the most: assume it did.'
          },
          {
            label: 'Disk image and memory capture first, then rebuild',
            cost: 55,
            fx: { c: 7, e: 24, b: 7, r: -6 },
            set: 'imaged',
            note: 'Fifty-five minutes and two terabytes of disk. It is also the difference between ' +
              '&ldquo;we can show what was accessed&rdquo; and &ldquo;we cannot rule anything out&rdquo;, ' +
              'and that difference is the whole of your regulatory position.'
          },
          {
            label: 'Touch nothing until the forensics vendor arrives',
            cost: 95,
            fx: { c: 4, e: 19, b: 17, r: -5 },
            set: 'imaged',
            note: 'Defensible, thorough, and an hour and a half of a Saturday spent waiting. The ' +
              'evidence is perfect and the finance director has now rung the chief executive.'
          }
        ]
      },

      {
        head: 'The backups',
        text: function (S) {
          return 'The appliance holds last night&rsquo;s job, the one that &ldquo;completed with ' +
            'warnings&rdquo;' + (S.flags.backupDoubt ? ' — the warning your engineer said has been open for three weeks' : '') +
            '. There is also an offline copy taken on Tuesday that nobody has restored from since ' +
            'the appliance was installed.';
        },
        opts: [
          {
            label: 'Start restoring from last night immediately',
            cost: 45,
            fx: { c: -7, e: -8, b: 29, r: 4 },
            set: 'restoredBlind',
            pivot: 'Restored from a backup nobody had verified.',
            note: 'The appliance was domain-joined and its service account is in the same directory ' +
              'the operator owns. Three of the five volumes in last night&rsquo;s job are already ' +
              'encrypted, and the restore has just written them back over the two that were not. ' +
              'This is the commonest way a bad night becomes a bad quarter.'
          },
          {
            label: 'Mount a copy read-only on an isolated host and verify a sample first',
            cost: 48,
            fx: { c: 5, e: 5, b: -9, r: -3 },
            set: 'backupSafe',
            note: 'Three of five volumes in last night&rsquo;s job are encrypted. Tuesday&rsquo;s ' +
              'offline copy is clean. You have lost four days of files and kept everything else, ' +
              'which is a result rather than a disaster.'
          },
          {
            label: 'Ask the vendor whether their appliance was domain-joined',
            cost: 28,
            fx: { c: 4, e: 2, b: -2, r: -1 },
            set: 'backupDoubt',
            note: 'It was, and its admin account sits in the same directory as everything else. ' +
              'That is the answer to why the job warned, and it is the reason &ldquo;we have ' +
              'backups&rdquo; is not the same sentence as &ldquo;we can recover&rdquo;.'
          }
        ]
      },

      {
        head: 'Four hundred people find out on Monday',
        text: function () {
          return 'Someone in the warehouse has already put a photograph of a locked screen in a ' +
            'WhatsApp group. Legal have not been briefed, the DPO is on leave, and the head of ' +
            'communications is asking for a paragraph she can send.';
        },
        opts: [
          {
            label: 'Send an all-staff email explaining what happened and what to do',
            cost: 20,
            fx: { c: -12, e: 0, b: 7, r: 15 },
            set: 'toldStaffFirst',
            pivot: 'Told 400 people before legal had seen a word of it.',
            note: 'Two problems, and the second is the expensive one. The operator still has access ' +
              'to mailboxes, so they have now read your assessment of them. And an unreviewed ' +
              'paragraph written at four in the morning is, from this moment, the first written ' +
              'account of the incident — it will be read back to you by a regulator, an insurer and ' +
              'possibly a court.'
          },
          {
            label: 'Brief legal and the DPO first, then a holding line with no detail',
            cost: 32,
            fx: { c: 4, e: 0, b: 2, r: -12 },
            set: 'legalFirst',
            note: '&ldquo;We are investigating a technical issue affecting file access. Do not use ' +
              'company systems until you hear from IT.&rdquo; It says nothing, which is the point: ' +
              'everything specific you say early is a fact you will have to stand behind later.'
          },
          {
            label: 'Say nothing to anyone until the picture is complete',
            cost: 65,
            fx: { c: 0, e: 0, b: 9, r: 9 },
            note: 'The picture is never complete. Meanwhile four hundred people are guessing in a ' +
              'group chat, and silence from you is not neutral — it is simply somebody else&rsquo;s ' +
              'version going first.'
          }
        ]
      },

      {
        head: 'The six-hour clock',
        text: function (S) {
          return 'You have known about this since 02:14, which is when the clock CERT-In cares ' +
            'about started. It is now ' + S.clockText + ', ' + S.elapsedText + ' in. ' +
            'You cannot yet say whether personal data left the building' +
            (S.flags.imaged ? ', though the image you took would let somebody find out' : '') + '.';
        },
        opts: [
          {
            label: 'File the CERT-In report now with what you actually know',
            cost: 25,
            fx: { c: 0, e: 0, b: 2, r: -24 },
            set: 'reported',
            note: 'The direction asks for a report within six hours of noticing the incident, not ' +
              'within six hours of understanding it. &ldquo;Ransomware on one file server, scope ' +
              'under investigation, next update at 14:00&rdquo; is a complete report. Waiting for ' +
              'certainty is how a technical incident becomes a compliance one as well.'
          },
          {
            label: 'Wait until you can describe the incident properly',
            cost: 40,
            fx: { c: 0, e: 0, b: 0, r: 7 },
            note: 'Every hour of waiting buys detail that the first report never asked for. ' +
              'The six-hour window does not pause while you improve your draft.'
          },
          {
            label: 'Ask legal whether it is reportable at all',
            cost: 35,
            fx: { c: 0, e: 0, b: 0, r: -3 },
            set: 'askedLegal',
            note: 'They say yes, on the CERT-In side, and that the GDPR question depends on whether ' +
              'personal data was accessed — which is exactly the question your evidence decisions ' +
              'have already answered for you, one way or the other. You have used 35 minutes to ' +
              'learn that you should have filed.'
          }
        ]
      },

      {
        head: 'Outside help, and who pays for it',
        text: function () {
          return 'The cyber policy is in a drawer. The forensics firm you like has a retainer with ' +
            'you. The operator has left a note with a contact address on it and a seven-day timer.';
        },
        opts: [
          {
            label: 'Ring the insurer&rsquo;s 24-hour line before engaging anyone',
            cost: 22,
            fx: { c: 4, e: 4, b: -11, r: -4 },
            set: 'insurer',
            note: 'The policy requires their panel firm, and costs incurred with anyone else before ' +
              'notification may not be covered. This is a boring clause that decides who pays for ' +
              'the next three weeks, and reading it at 06:00 is far too late to be reading it for ' +
              'the first time.'
          },
          {
            label: 'Bring in your retained forensics firm now and sort the paperwork later',
            cost: 18,
            fx: { c: 5, e: 12, b: 6, r: -3 },
            set: 'vendor',
            note: 'They are good, they are quick, and they are on site by nine. Whether the invoice ' +
              'is covered is now a conversation you will have with an insurer who was told after ' +
              'the fact.'
          },
          {
            label: 'Open a channel to the operator through a negotiator, to buy time and learn scope',
            cost: 55,
            fx: { c: 0, e: 7, b: -5, r: 4 },
            set: 'negotiated',
            note: 'Their proof-of-life file list is itself evidence of what they took, which is more ' +
              'than your logs currently show. Note what it does not do: it does not remove them ' +
              'from the network, it does not end a reporting duty, and in several jurisdictions ' +
              'payment itself carries sanctions exposure. Buying time is not the same as buying a fix.'
          },
          {
            label: 'Keep it in-house — it is one server',
            cost: 8,
            fx: { c: 0, e: -9, b: 8, r: 6 },
            note: 'It is one server that had domain credentials on it. The scope question outlives ' +
              'the recovery question by about three months, and nobody in the building has done ' +
              'this before.'
          }
        ]
      }
    ],

    /* The attacker's own schedule, in minutes from the first alert. Fired
       from advanceTo(), which means an event can land in the middle of a
       decision rather than politely between two of them. That is deliberate,
       and it is the only part of this file that makes a slow read feel like
       anything at all. */
    events: [
      {
        at: 30, unless: 'contained',
        text: 'FS-01 has finished the finance share and started on \\\\FS-02\\projects.',
        fx: { c: -8, e: 0, b: 9, r: 1 }
      },
      {
        at: 78, unless: 'backupSafe',
        text: 'The backup appliance&rsquo;s job history has been deleted. Its web console still loads; it just does not remember anything.',
        fx: { c: 0, e: -7, b: 8, r: 2 }
      },
      {
        at: 168,
        text: 'A ransom note is now on every screen in the building. A photograph of it is in a staff WhatsApp group, and from here you are not the first source any more.',
        fx: { c: 0, e: 0, b: 5, r: 6 }
      },
      {
        at: 360, unless: 'reported',
        text: 'Six hours since the first alert. That is the window CERT-In&rsquo;s direction asks incidents to be reported inside, and it has closed with nothing filed.',
        fx: { c: 0, e: 0, b: 0, r: 21 }
      }
    ],

    plan: [
      'Who may isolate a production host at 02:00 without ringing anyone, and who they tell afterwards. If that is undecided, the decision gets made by whoever is most tired.',
      'That the first responder images before rebuilding — written down, so it is a policy at three in the morning rather than a judgement call.',
      'Which backup copy is offline, and the date of the last test restore from it. &ldquo;We have backups&rdquo; is not a recovery plan; a tested restore is.',
      'Who files the CERT-In report, who has the login, and what the holding text says before anyone has to write it.',
      'The first all-staff message, drafted in advance and cleared by legal, so nobody composes a regulatory document at four in the morning.',
      'Whether the insurer is called before the forensics firm, because the policy has already decided that and nobody has read it.'
    ]
  };

  var BEC = {
    key: 'bec',
    name: 'Wire fraud through a compromised mailbox',
    startMin: 545,                     // 09:05, a Thursday
    opening: 'It is 09:05 on a Thursday. The finance manager has just noticed that a supplier&rsquo;s ' +
      'bank details changed last month — and that £312,000 went to the new account yesterday afternoon.',
    beats: [
      {
        head: 'What do you do in the first five minutes',
        text: function () {
          return 'Three things are in front of you. The payment went out at <strong>15:40 yesterday</strong>. ' +
            'The DLP console has been red since 08:20 over a spreadsheet mailed to a Gmail address. ' +
            'And nobody has yet looked at the finance manager&rsquo;s mailbox.';
        },
        opts: [
          {
            label: 'Work the DLP alert — data is actively leaving the company',
            cost: 65,
            fx: { c: 0, e: 0, b: 13, r: 3 },
            set: 'chasedNoise',
            pivot: 'Spent the first hour on a DLP alert while the recall window closed.',
            note: 'It is the warehouse supervisor mailing herself next week&rsquo;s rota, as she has ' +
              'every Thursday for two years. An hour and five minutes, and the only clock that ' +
              'mattered this morning was the one on the money.'
          },
          {
            label: 'Ring the bank&rsquo;s fraud line and ask for a recall now',
            cost: 6,
            fx: { c: 6, e: 0, b: -27, r: -2 },
            set: 'recallRequested',
            note: 'Recall is a race against the money being moved on, and it is usually lost within ' +
              'a day. You have asked before you can prove anything, which is correct: the bank can ' +
              'freeze and unfreeze, and you cannot un-send a payment.'
          },
          {
            label: 'Read the mailbox audit log for the finance manager first',
            cost: 26,
            fx: { c: 11, e: 14, b: 3, r: -2 },
            set: 'auditRead',
            note: 'A successful sign-in from a residential address in another country at 03:12, ' +
              'eleven days ago. No MFA prompt, because the account was on legacy authentication. ' +
              'You now know this is not a mistake by a supplier.'
          }
        ]
      },

      {
        head: 'The money',
        when: function (S) { return !S.flags.recallRequested; },
        text: function (S) {
          if (S.flags.moneyGone) {
            return 'The £312,000 has already been moved on through two further accounts and the ' +
              'recall window has closed. There is still a receiving account with a name on it, and ' +
              'a bank that has not yet been asked to do anything about it.';
          }
          return 'The payment left at 15:40 yesterday, which is ' + S.elapsedText + ' into your ' +
            'morning and rather longer into the fraud. Recall is a request, not a right, and it ' +
            'gets weaker by the hour.';
        },
        opts: [
          {
            label: 'Ring the bank&rsquo;s fraud line and ask for a recall',
            when: function (S) { return !S.flags.moneyGone; },
            cost: 6,
            fx: { c: 5, e: 0, b: -20, r: -2 },
            set: 'recallRequested',
            note: 'Made. Later than it could have been, and still worth making — recall attempts ' +
              'succeed often enough that not trying is never the answer.'
          },
          {
            label: 'Ring the bank anyway — freeze what is left and get it on record',
            when: function (S) { return !!S.flags.moneyGone; },
            cost: 12,
            fx: { c: 4, e: 6, b: -4, r: -3 },
            set: 'recallRequested',
            note: 'The money is not coming back through this call. What you get instead is the ' +
              'receiving account&rsquo;s details on a fraud report, a bank that will now talk to ' +
              'the police, and a written timestamp for the insurer. Recall was the prize; this is ' +
              'what is left of it, and it is not nothing.'
          },
          {
            label: 'Confirm the fraud internally first so you do not embarrass anyone',
            cost: 40,
            fx: { c: 2, e: 4, b: 13, r: 1 },
            note: 'Forty minutes of certainty, bought with the only asset that was still ' +
              'appreciating in the other direction. A wrongly requested recall costs a phone call; ' +
              'a late one costs the payment.'
          }
        ]
      },

      {
        head: 'The mailbox',
        text: function (S) {
          return (S.flags.auditRead ? 'Along with the 03:12 sign-in eleven days ago, there is'
                                    : 'The audit log shows a sign-in from a residential address abroad eleven days ago, and') +
            ' an inbox rule named <code>&ldquo;.&rdquo;</code> that moves anything containing ' +
            '&ldquo;invoice&rdquo;, &ldquo;bank&rdquo; or &ldquo;payment&rdquo; straight to RSS Feeds ' +
            'and marks it read. She has not seen a supplier email in eleven days without knowing it.';
        },
        opts: [
          {
            label: 'Delete the rule, reset her password, get her working again',
            cost: 10,
            fx: { c: 20, e: -24, b: -4, r: 6 },
            set: 'nukedRule',
            pivot: 'Deleted the inbox rule before exporting it.',
            note: 'The rule&rsquo;s creation timestamp was the one artefact that dated the ' +
              'compromise, and it is gone. Worse: a password reset on its own does not end a live ' +
              'session — the stolen token is still valid until it is revoked, so they may not even ' +
              'have noticed.'
          },
          {
            label: 'Export the audit log and the rule, then revoke sessions and reset with MFA re-registration',
            cost: 28,
            fx: { c: 30, e: 24, b: 2, r: -6 },
            set: 'contained',
            setAlso: 'evidenceKept',
            note: 'In that order, and the order is the whole answer. Export first because deleting ' +
              'is not reversible; revoke tokens because a reset alone leaves the session alive; ' +
              're-register MFA because the attacker may have enrolled their own authenticator, ' +
              'which is the step people miss.'
          },
          {
            label: 'Reset the password and move on — she needs her email',
            cost: 5,
            fx: { c: 8, e: -5, b: -2, r: 4 },
            note: 'The refresh token outlives the password. They are back in the mailbox inside the ' +
              'hour, and now they know somebody is looking.'
          }
        ]
      },

      {
        head: 'The supplier still thinks they are owed £312,000',
        text: function () {
          return 'The thread with the supplier is forty messages long and the attacker has been ' +
            'reading all of it. Their accounts department is chasing.';
        },
        opts: [
          {
            label: 'Reply on the existing thread to warn them the account is fraudulent',
            cost: 8,
            fx: { c: -14, e: 0, b: 8, r: 7 },
            set: 'repliedInThread',
            pivot: 'Warned the supplier inside a thread the attacker was reading.',
            note: 'They replied first. A lookalike domain — one character out — sent your finance ' +
              'team a message from &ldquo;the supplier&rdquo; saying the warning was itself a scam. ' +
              'Never conduct the response in the channel that is compromised.'
          },
          {
            label: 'Ring them on the number in the signed contract, not the one in the email',
            cost: 14,
            fx: { c: 14, e: 2, b: -7, r: -2 },
            set: 'calledSupplier',
            note: 'Out of band, from a source the attacker never touched. It turns out their own ' +
              'mailbox was the one compromised first, which reframes the whole incident and is ' +
              'something no amount of log reading on your side would have found.'
          },
          {
            label: 'Say nothing until you understand your own exposure',
            cost: 45,
            fx: { c: -5, e: 0, b: 10, r: 3 },
            note: 'While you work, the same fake account is quoted on their next two invoices.'
          }
        ]
      },

      {
        head: 'Is it one mailbox',
        text: function () {
          return 'You have one confirmed compromise and no idea whether it is the only one. There ' +
            'are 380 mailboxes in the tenant and a board meeting at two.';
        },
        opts: [
          {
            label: 'Search every mailbox for rules with the same shape',
            cost: 42,
            fx: { c: 24, e: 9, b: 2, r: -7 },
            set: 'scoped',
            note: 'Two more, both in accounts payable, both created the same week. Scope is the ' +
              'question a regulator asks first and the question an incident makes hardest to answer ' +
              'later — an hour spent on it now is an hour, not a fortnight.'
          },
          {
            label: 'Assume it is contained to the one account',
            cost: 3,
            fx: { c: -16, e: 0, b: 6, r: 6 },
            note: 'Assumption is not scope. It is the same claim, made without the search.'
          },
          {
            label: 'Force a password reset across the whole tenant this morning',
            cost: 35,
            fx: { c: 26, e: 3, b: 21, r: -4 },
            set: 'scoped',
            note: 'Effective and enormous. Three hundred and eighty people locked out at once on a ' +
              'trading day, a service desk with two staff, and — because you did not search first — ' +
              'still no idea which accounts were actually touched.'
          }
        ]
      },

      {
        head: 'The six-hour clock, and the other one',
        text: function (S) {
          return 'It is ' + S.clockText + ', ' + S.elapsedText + ' since you learned of this. ' +
            'The mailbox held payroll correspondence, passport scans for two visa applications and ' +
            'eleven years of client email' +
            (S.flags.evidenceKept ? ', and you have the audit export that shows what was opened' : '') + '.';
        },
        opts: [
          {
            label: 'File with CERT-In now, and start the GDPR Article 33 assessment in parallel',
            cost: 30,
            fx: { c: 0, e: 0, b: 2, r: -25 },
            set: 'reported',
            note: 'Two clocks, two different jobs. CERT-In&rsquo;s direction asks for a report within ' +
              'six hours of noticing certain incidents; Article 33 gives 72 hours from awareness to ' +
              'notify a supervisory authority about a personal-data breach. Running them in parallel ' +
              'is the only way both are made on time, because the second one needs the scope work ' +
              'the first one does not wait for.'
          },
          {
            label: 'Wait for the scope search to finish before filing anything',
            cost: 50,
            fx: { c: 0, e: 0, b: 0, r: 8 },
            note: 'An incomplete report filed on time can be updated. A complete report filed late ' +
              'cannot be made early.'
          },
          {
            label: 'Treat it as fraud rather than a data breach and report only to the bank',
            cost: 15,
            fx: { c: 0, e: 0, b: -2, r: 17 },
            pivot: 'Classified a mailbox compromise as pure fraud, so neither notification clock was started.',
            note: 'It is both. Somebody had eleven days of read access to a mailbox full of other ' +
              'people&rsquo;s personal data; the money is only the part that is easy to count.'
          }
        ]
      },

      {
        head: 'Before you go home',
        text: function () {
          return 'The immediate thing is done. What you do in the next hour decides whether this ' +
            'happens again in March.';
        },
        opts: [
          {
            label: 'Turn off legacy authentication and require MFA on every finance account today',
            cost: 40,
            fx: { c: 20, e: 0, b: 4, r: -6 },
            note: 'The sign-in got through because legacy protocols do not carry an MFA prompt. ' +
              'Closing that is the only action today that changes the odds tomorrow; everything else ' +
              'has been cleanup.'
          },
          {
            label: 'Add a verification step: no bank-detail change without a call to a number on file',
            cost: 25,
            fx: { c: 13, e: 0, b: 3, r: -5 },
            note: 'The control that would have stopped this is a process control, not a technical ' +
              'one, and it costs one phone call per change. Most wire fraud dies here.'
          },
          {
            label: 'Write it up on Monday — everyone has been at this for nine hours',
            cost: 5,
            fx: { c: -6, e: -5, b: 3, r: 5 },
            note: 'Fair, and the timeline you can reconstruct on Monday is meaningfully worse than ' +
              'the one you could write now. Notes are evidence too.'
          }
        ]
      }
    ],

    events: [
      /* Fifty-eight minutes, and that figure is the whole tuning of this
         scenario. The hour spent on the DLP alert is longer than the window,
         so the trap actually costs the money rather than merely being called
         a mistake afterwards; reading the mailbox audit first (26) and then
         ringing leaves room; ringing first is always safe. Under Measured
         pressure the window stretches to 93 minutes and every route makes it,
         which is the point of that setting. */
      {
        at: 58, unless: 'recallRequested', set: 'moneyGone',
        text: 'The bank calls back: the receiving account was emptied at 09:40 this morning and the funds have gone through two further accounts. Recall is no longer possible.',
        fx: { c: 0, e: 0, b: 38, r: 2 }
      },
      {
        at: 205, unless: 'scoped',
        text: 'A second invoice from the same supplier, quoting the same fraudulent account, has cleared approvals in accounts payable.',
        fx: { c: -9, e: 0, b: 14, r: 3 }
      },
      {
        at: 360, unless: 'reported',
        text: 'Six hours since you learned of this. That is the window CERT-In&rsquo;s direction asks incidents to be reported inside, and it has closed with nothing filed.',
        fx: { c: 0, e: 0, b: 0, r: 21 }
      }
    ],

    plan: [
      'That the bank is rung before the fraud is proven. The recall window is measured in hours and certainty is not available inside it.',
      'The order of operations on a compromised mailbox: export, revoke sessions, reset, re-register MFA. Deleting the rule first is the instinct, and it destroys the timeline.',
      'That the response never runs in the compromised channel. A supplier is warned on a number from the contract, not by replying to the thread.',
      'Who searches the other 380 mailboxes, and with what query, so scope is a task rather than an assumption.',
      'That a mailbox compromise is a personal-data question as well as a money question, and both clocks start at the same moment.',
      'Legacy authentication off and MFA on finance accounts, decided long before an incident makes it urgent.'
    ]
  };

  var SCENARIOS = { ransomware: RANSOMWARE, bec: BEC };

  /* Direction of travel per meter, and the label the board shows. Kept as one
     table because the meters panel, the after-action report and the composite
     score all read it — three places that must not be able to disagree about
     whether low exposure is good. */
  var METERS = [
    { key: 'c', label: 'Containment', good: 'high', hint: 'higher is better' },
    { key: 'e', label: 'Evidence', good: 'high', hint: 'higher is better' },
    { key: 'b', label: 'Business impact', good: 'low', hint: 'lower is better' },
    { key: 'r', label: 'Regulatory exposure', good: 'low', hint: 'lower is better' }
  ];

  GameShell.define({
    id: 'game-incident-response',
    slug: 'incident-response',
    title: 'Incident response',
    bestKey: 'incident-response',
    pauseOnBlur: true,
    tapAction: false,
    startTitle: 'The pager goes off',
    startText: 'A breach unfolds over simulated hours and every choice costs time you do not have. ' +
      'It is a training exercise, not legal advice, and nothing you do here leaves this page.',

    setup: function (g) {
      /* Asked once, for the same reason disco.js asks once: the setting is
         about the visitor, not about this frame, and re-reading it per frame
         would only let it change under a run already in progress. Here it
         governs one thing — whether the meter bars ease or snap. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      /* THE BOARD. The manifest declares board: true, so the generated page
         gives the shell a .game-board and no canvas. If that ever ships as a
         canvas page by mistake the game would render nothing at all, which is
         a worse failure than a few lines of belt and braces — so a missing
         board is built here and the canvas stood down. */
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

      var scenarioSel = document.getElementById('game-scenario');
      var pressureSel = document.getElementById('game-pressure');
      var logBtn = document.getElementById('game-log');

      /* Pressure scales when the attacker's scheduled events land and whether
         deliberation costs anything at all. Measured is the accessible
         setting and it is a real setting, not a courtesy: with drift off, a
         player who reads every word scores exactly what a player who skims
         does, and the only thing left costing time is the choices. */
      var PRESSURE = {
        measured: { scale: 1.6, drift: false, label: 'Measured' },
        standard: { scale: 1.0, drift: true, label: 'Standard' },
        aggressive: { scale: 0.62, drift: true, label: 'Aggressive' }
      };

      var S = null;                 // the whole run; rebuilt by reset()
      var showFullLog = false;
      var optBtns = [];
      var optIdx = 0;
      var barFills = [];            // the four meter fills, cached for update()
      var barNums = [];             // and the figure printed above each one
      var barShown = [0, 0, 0, 0];  // eased values, one per METERS entry
      var lastClock = '';
      var lastPhase = '';

      /* Rolling mean of real milliseconds between frames, sampled inside
         update(). The shell calls update() on a fixed 1/120 accumulator, so
         dt says nothing about how the machine is doing — but consecutive
         calls inside one frame are microseconds apart and calls either side
         of a frame boundary are not, which is the gap worth sampling. */
      var frameMs = 16;
      var wallLast = 0;

      function now() {
        return (window.performance && window.performance.now)
          ? window.performance.now() : +new Date();
      }

      /* ---------------------------------------------------------------
         The room. A night operations centre is a condition rather than a
         sequence of events, so it is a bed: air handling, a low mains hum,
         and a slow pulse from something in the rack. The pulse rate and the
         brightness of the air both follow one steered value — how far the
         attacker has got — so the room audibly tightens as the meters go
         the wrong way, without anything ever announcing that it has.

         Everything sits low. This is a reading game, and a bed that competes
         with the text is a bed nobody keeps switched on.
         --------------------------------------------------------------- */
      var room = g.bed(function (a) {
        var ctx = a.ctx;

        var air = ctx.createBufferSource();
        air.buffer = a.noise();
        air.loop = true;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 380;
        /* Flat. Any resonance at all turns building air into a whistle, and
           a whistle is a kettle rather than a server room. */
        lp.Q.value = 0.4;
        var airGain = ctx.createGain();
        airGain.gain.value = 0.028;
        air.connect(lp);
        lp.connect(airGain);
        airGain.connect(a.out);
        air.start();

        /* Fifty hertz, because that is what the mains hums at here, and a
           triangle rather than a sine because at 50 Hz a sine is inaudible on
           a laptop speaker and the layer may as well not exist. */
        var hum = ctx.createOscillator();
        var humGain = ctx.createGain();
        hum.type = 'triangle';
        hum.frequency.value = 50;
        humGain.gain.value = 0.006;
        hum.connect(humGain);
        humGain.connect(a.out);
        hum.start();

        /* The pulse. A gain being opened and closed by an LFO rather than a
           sequence of one-shots, so it costs two nodes for the whole run and
           cannot stack up behind a tab that was hidden. Capped well under two
           a second at the top of its range — it is a heartbeat under the
           text, not a metronome over it. */
        var pulseSrc = ctx.createOscillator();
        var pulseGain = ctx.createGain();
        var lfo = ctx.createOscillator();
        var lfoDepth = ctx.createGain();
        pulseSrc.type = 'sine';
        pulseSrc.frequency.value = 132;
        pulseGain.gain.value = 0.0;
        lfo.type = 'sine';
        lfo.frequency.value = 0.42;
        lfoDepth.gain.value = 0.004;
        lfo.connect(lfoDepth);
        lfoDepth.connect(pulseGain.gain);
        pulseSrc.connect(pulseGain);
        pulseGain.connect(a.out);
        pulseSrc.start();
        lfo.start();

        function ramp(param, value, secs) {
          var t = ctx.currentTime;
          param.cancelScheduledValues(t);
          param.setValueAtTime(param.value, t);
          param.linearRampToValueAtTime(value, t + (secs == null ? 1.2 : secs));
        }

        return {
          set: function (key, value) {
            if (key !== 'threat') return;
            var k = value < 0 ? 0 : (value > 1 ? 1 : value);
            /* Slow ramps, because the thing being tracked moves in steps of a
               whole decision. A fast ramp here turns every click into an
               audible swell, which reads as the room reacting to the mouse. */
            ramp(lp.frequency, 300 + k * 900, 2.0);
            ramp(lfo.frequency, 0.42 + k * 1.05, 2.0);
            ramp(lfoDepth.gain, 0.003 + k * 0.006, 2.0);
          }
        };
      });

      /* ---------------------------------------------------------------
         Clock and formatting.
         --------------------------------------------------------------- */
      function clockAt(min) {
        var t = Math.floor(S.sc.startMin + min) % 1440;
        return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
      }

      function elapsedText(min) {
        var m = Math.floor(min);
        var h = Math.floor(m / 60);
        if (h < 1) return m + ' minutes';
        var rem = m % 60;
        return h + (h === 1 ? ' hour' : ' hours') + (rem ? ' ' + rem + ' minutes' : '');
      }

      function composite() {
        return Math.round((S.c + S.e + (100 - S.b) + (100 - S.r)) / 4);
      }

      /* How far the wrong way this run has gone, 0..1. Feeds the bed only —
         the score is composite() and is worked out from the same four
         numbers, so the room and the scoreboard can never tell different
         stories about the same run. */
      function threat() {
        var t = (S.b + S.r + (100 - S.c)) / 300;
        return t < 0 ? 0 : (t > 1 ? 1 : t);
      }

      /* ---------------------------------------------------------------
         Rendering. Everything is inline-styled: this game ships one file and
         adding a rule to games.css for it would be editing a shared
         stylesheet for one page's benefit.
         --------------------------------------------------------------- */
      var INK = 'var(--ink)';
      var INK3 = 'var(--ink-3)';
      var INK4 = 'var(--ink-4)';
      var LINE = 'rgb(var(--line-rgb) / 0.28)';
      var SHEET = 'rgb(var(--sheet-rgb) / 0.6)';

      function barColour(pct, good) {
        var k = good === 'high' ? pct : 100 - pct;
        if (k >= 66) return '#4ade80';
        if (k >= 34) return '#fbbf24';
        return '#f87171';
      }

      function metersHtml() {
        var out = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr));' +
          'gap:0.55rem 1rem;margin:0 0 1rem;">';
        for (var i = 0; i < METERS.length; i++) {
          var m = METERS[i];
          var v = Math.round(S[m.key]);
          out +=
            '<div>' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.4rem;">' +
            '<span style="font-size:0.68rem;letter-spacing:0.06em;text-transform:uppercase;color:' + INK4 + ';">' +
            m.label + '</span>' +
            '<span data-ir-num="' + i + '" style="font-family:\'Cascadia Code\',Consolas,monospace;' +
            'font-size:0.82rem;color:' + INK + ';">' + v + '</span>' +
            '</div>' +
            '<div role="img" aria-label="' + m.label + ' ' + v + ' out of 100, ' + m.hint + '" ' +
            'style="height:7px;margin-top:0.25rem;border-radius:999px;background:rgba(148,163,184,0.18);' +
            'overflow:hidden;">' +
            '<div data-ir-bar="' + i + '" style="height:100%;width:' + v + '%;border-radius:999px;' +
            'background:' + barColour(v, m.good) + ';"></div>' +
            '</div>' +
            '</div>';
        }
        return out + '</div>';
      }

      function logHtml() {
        if (!S.log.length) return '';
        var from = showFullLog ? 0 : Math.max(0, S.log.length - 3);
        var out = '<ol style="list-style:none;margin:0 0 1rem;padding:0.7rem 0.85rem;' +
          'background:' + SHEET + ';border:1px solid ' + LINE + ';border-radius:10px;' +
          'max-height:' + (showFullLog ? '15rem' : 'none') + ';overflow:auto;">';
        if (!showFullLog && from > 0) {
          out += '<li style="font-size:0.72rem;color:' + INK4 + ';margin-bottom:0.4rem;">' +
            from + ' earlier ' + (from === 1 ? 'entry' : 'entries') + ' — the Timeline button shows them.</li>';
        }
        for (var i = from; i < S.log.length; i++) {
          var it = S.log[i];
          out += '<li style="display:flex;gap:0.6rem;margin:0 0 0.35rem;font-size:0.8rem;' +
            'line-height:1.5;color:' + (it.attacker ? '#fca5a5' : INK3) + ';">' +
            '<span style="font-family:\'Cascadia Code\',Consolas,monospace;color:' + INK4 + ';' +
            'flex:0 0 auto;">' + it.at + '</span><span>' + it.text + '</span></li>';
        }
        return out + '</ol>';
      }

      /* How many decisions are still to come, INCLUDING the one on screen.
         Counted from S.at rather than from zero, because a beat that has
         already been answered may now fail its own `when` — asking for the
         wire recall in the first beat removes the beat that offers it later —
         and counting those again put the denominator behind the numerator. */
      function beatsLeft() {
        var n = 0;
        for (var i = S.at; i < S.sc.beats.length; i++) {
          if (!S.sc.beats[i].when || S.sc.beats[i].when(S)) n++;
        }
        return n;
      }

      /* The board is rebuilt whole on every decision, which is one innerHTML
         write every thirty seconds or so of play. The per-frame path touches
         four style.width values and nothing else — see update(). */
      function render() {
        var beat = S.sc.beats[S.at];
        S.clockText = clockAt(S.minutes);
        S.elapsedText = elapsedText(S.minutes);

        var opts = [];
        var i;
        for (i = 0; i < beat.opts.length; i++) {
          if (!beat.opts[i].when || beat.opts[i].when(S)) opts.push(beat.opts[i]);
        }
        S.opts = opts;

        /* The scenario name and nothing else. An earlier version printed the
           clock and the elapsed time here too, and it was wrong within
           seconds: deliberation moves the clock, so the board header sat at
           09:05 while the HUD cell three inches above it read 09:12. One
           live clock, in the HUD, where the shell already owns it. */
        var html =
          '<p style="margin:0 0 0.75rem;font-size:0.72rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">' + S.sc.name + '</p>' +
          metersHtml() +
          '<div data-ir-log>' + logHtml() + '</div>' +
          '<h3 style="margin:0 0 0.5rem;font-size:1.02rem;color:' + INK + ';">' + beat.head + '</h3>' +
          '<p style="margin:0 0 1rem;font-size:0.9rem;line-height:1.65;color:' + INK3 + ';">' +
          beat.text(S) + '</p>' +
          '<div role="group" aria-label="What do you do" style="display:grid;gap:0.5rem;">';

        for (i = 0; i < opts.length; i++) {
          html +=
            '<button class="game-btn" type="button" data-ir-opt="' + i + '" ' +
            'style="display:block;width:100%;text-align:left;padding:0.7rem 0.85rem;' +
            'font-size:0.88rem;line-height:1.5;white-space:normal;height:auto;">' +
            opts[i].label +
            '<span style="display:block;margin-top:0.25rem;font-size:0.72rem;color:' + INK4 + ';">' +
            'costs ' + opts[i].cost + ' minutes</span>' +
            '</button>';
        }

        html += '</div><div data-ir-note></div>';
        host.innerHTML = html;

        cacheBars();
        optBtns = [];
        var nodes = host.querySelectorAll('[data-ir-opt]');
        for (i = 0; i < nodes.length; i++) {
          (function (node, pos) {
            optBtns.push(node);
            node.addEventListener('click', function () { choose(pos); });
            node.addEventListener('focus', function () { optIdx = pos; });
          })(nodes[i], i);
        }
        optIdx = 0;

        lastClock = S.clockText;
        g.stat('clock', S.clockText);
        setPhase();
      }

      function setPhase() {
        var txt = (S.answered + 1) + ' of ' + (S.answered + beatsLeft());
        if (txt === lastPhase) return;
        lastPhase = txt;
        g.stat('phase', txt);
      }

      /* Called only when the board has been rebuilt, never after a choice.
         An earlier version re-cached on every decision, which also re-seeded
         barShown from the live values — so the bars snapped to their new
         positions at exactly the moment the movement was worth seeing. */
      function cacheBars() {
        barFills = [];
        barNums = [];
        var fills = host.querySelectorAll('[data-ir-bar]');
        var nums = host.querySelectorAll('[data-ir-num]');
        var i;
        for (i = 0; i < fills.length; i++) barFills.push(fills[i]);
        for (i = 0; i < nums.length; i++) barNums.push(nums[i]);
        for (i = 0; i < METERS.length; i++) barShown[i] = S[METERS[i].key];
      }

      function refreshLog() {
        var slot = host.querySelector('[data-ir-log]');
        if (slot) slot.innerHTML = logHtml();
      }

      /* The first arrow press SELECTS rather than moves. The shell puts the
         keyboard on the board when a run starts, so at that point nothing in
         the group has focus and treating Down as "one past the top" skipped
         the first option entirely — the commonest way a keyboard player never
         sees the option the beat is really about. */
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

      /* ---------------------------------------------------------------
         Time, and the attacker moving inside it.
         --------------------------------------------------------------- */
      function push(text, attacker) {
        S.log.push({ at: clockAt(S.minutes), text: text, attacker: !!attacker });
      }

      function apply(fx) {
        if (!fx) return;
        S.c = clamp(S.c + (fx.c || 0));
        S.e = clamp(S.e + (fx.e || 0));
        S.b = clamp(S.b + (fx.b || 0));
        S.r = clamp(S.r + (fx.r || 0));
        g.setScore(composite());
        room.set('threat', threat());
      }

      /* Advance the simulated clock and let anything scheduled inside the
         span happen. Called from choose() with the cost of an action AND from
         update() with the deliberation drift, which is the entire reason an
         attacker event can land while a decision is still open. */
      function advanceTo(target) {
        if (target <= S.minutes) return;
        var events = S.sc.events;
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          var at = ev.at * S.scale;
          if (S.fired[i] || at > target) continue;
          if (ev.unless && S.flags[ev.unless]) { S.fired[i] = 1; continue; }
          S.fired[i] = 1;
          /* An event may change what the remaining beats are ABOUT, not just
             what the meters read. Without this the wire-recall beat still
             offered its full refund after the bank had already told you the
             account was empty — the trap cost the money and gave it back. */
          if (ev.set) S.flags[ev.set] = 1;
          /* Fired at the moment it was due rather than at the end of the
             span, so the log reads as a timeline instead of as a pile of
             things that all happened when you clicked. */
          var keep = S.minutes;
          S.minutes = at;
          push(ev.text, true);
          apply(ev.fx);
          S.minutes = keep;
          /* Repainted here and not only from choose(), because the event that
             matters most is the one that lands WHILE a decision is open — the
             meters moved and the timeline did not, so the thing the whole
             deliberation clock exists to show was invisible until the player
             clicked something. The log node is outside the options, so
             rewriting it cannot take the keyboard off a button. */
          refreshLog();
          g.announce(ev.text.replace(/<[^>]+>/g, ''));
          /* Gated: three events landing inside one long deliberation would
             otherwise be three thuds on top of each other. */
          if (g.gate('event', 1.2)) g.noise(0.5, { type: 'lowpass', freq: 320, to: 90, q: 0.6, level: 0.05 });
        }
        S.minutes = target;
        var ct = clockAt(S.minutes);
        if (ct !== lastClock) { lastClock = ct; g.stat('clock', ct); }
      }

      /* ---------------------------------------------------------------
         Making a choice.
         --------------------------------------------------------------- */
      function choose(pos) {
        if (S.done || S.pending) return;
        var opt = S.opts[pos];
        if (!opt) return;
        S.pending = true;
        S.drift = 0;

        push('<strong>You:</strong> ' + opt.label + '.');
        advanceTo(S.minutes + opt.cost);
        apply(opt.fx);
        if (opt.set) S.flags[opt.set] = 1;
        if (opt.setAlso) S.flags[opt.setAlso] = 1;
        if (opt.pivot) S.pivots.push({ at: clockAt(S.minutes), line: opt.pivot });
        S.answered++;

        g.pluck(opt.fx && (opt.fx.c || 0) > 8 ? 392 : 262, 0.4, 0.05);
        g.announce(opt.note.replace(/<[^>]+>/g, ''));

        /* The consequence replaces the options rather than appearing under
           them. Leaving the buttons on screen invited a second click on a
           decision already taken, and a tabletop where you can change your
           mind after seeing the outcome is not teaching anything. */
        var note = host.querySelector('[data-ir-note]');
        var group = host.querySelector('[role="group"]');
        if (group) group.hidden = true;
        if (note) {
          note.innerHTML =
            '<div style="margin-top:0.2rem;padding:0.85rem 0.95rem;border-radius:10px;' +
            'border-left:3px solid ' + (opt.pivot ? '#f87171' : 'var(--accent-1)') + ';' +
            'background:' + (opt.pivot ? 'rgba(248,113,113,0.1)' : 'rgba(148,163,184,0.1)') + ';">' +
            '<p style="margin:0 0 0.8rem;font-size:0.87rem;line-height:1.65;color:' + INK3 + ';">' +
            opt.note + '</p>' +
            '<button class="btn btn-primary" type="button" data-ir-next>Carry on</button>' +
            '</div>';
          var next = note.querySelector('[data-ir-next]');
          next.addEventListener('click', advance);
          try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); }
        }
        refreshLog();
      }

      function advance() {
        S.pending = false;
        do { S.at++; }
        while (S.at < S.sc.beats.length && S.sc.beats[S.at].when && !S.sc.beats[S.at].when(S));
        if (S.at >= S.sc.beats.length) { finish(); return; }
        render();
        try { optBtns[0].focus({ preventScroll: true }); } catch (err) { /* board keeps focus */ }
      }

      /* ---------------------------------------------------------------
         The after-action report.
         --------------------------------------------------------------- */
      function verdict(m, v) {
        var k = m.good === 'high' ? v : 100 - v;
        if (m.key === 'c') {
          return k >= 70 ? 'Stopped early, and it stayed stopped.'
               : k >= 40 ? 'Contained, but later than it could have been.'
               : 'It was still spreading when you were doing other things.';
        }
        if (m.key === 'e') {
          return k >= 70 ? 'An examiner could answer the scope question from what you kept.'
               : k >= 40 ? 'Partial. Some questions will be answered with an assumption.'
               : 'The artefacts that would have shown what happened are gone.';
        }
        if (m.key === 'b') {
          return k >= 70 ? 'The business took the smallest hit available on this path.'
               : k >= 40 ? 'Real disruption, some of it chosen and some of it drift.'
               : 'The response cost more than the incident would have on its own.';
        }
        return k >= 70 ? 'Clocks started on time and the record is defensible.'
             : k >= 40 ? 'Late in places. Answerable, with work.'
             : 'Notification was late or never started, which is its own incident.';
      }

      function finish() {
        S.done = true;
        var score = composite();
        /* over() does the real work — the best score, the storage write, the
           announcement, the state change. The overlay it opens is then hidden
           from hooks.ended(), because the report will not fit in a 26rem
           card. See the header. */
        g.over({
          score: score,
          won: score >= 70,
          title: 'After-action report',
          message: 'Scored ' + score + ' out of 100 across the four meters.'
        });
      }

      function report(score, isBest) {
        var i;
        var html =
          '<p style="margin:0 0 0.75rem;font-size:0.72rem;letter-spacing:0.07em;' +
          'text-transform:uppercase;color:' + INK4 + ';">After-action report &middot; ' +
          S.sc.name + ' &middot; ' + elapsedText(S.minutes) + ' of incident time</p>' +
          '<h3 style="margin:0 0 0.15rem;font-size:1.3rem;color:' + INK + ';">' + score + ' out of 100' +
          (isBest ? ' <span style="font-size:0.75rem;color:#4ade80;">new best</span>' : '') + '</h3>' +
          '<p style="margin:0 0 1.1rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
          'The mean of containment, evidence preserved, and the inverse of business impact and ' +
          'regulatory exposure. There is no line through this that maxes all four.</p>';

        for (i = 0; i < METERS.length; i++) {
          var m = METERS[i];
          var v = Math.round(S[m.key]);
          html +=
            '<div style="margin:0 0 0.75rem;">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:0.5rem;">' +
            '<span style="font-size:0.85rem;color:' + INK + ';">' + m.label +
            ' <span style="font-size:0.7rem;color:' + INK4 + ';">' + m.hint + '</span></span>' +
            '<span style="font-family:\'Cascadia Code\',Consolas,monospace;font-size:0.85rem;color:' +
            INK + ';">' + v + '</span></div>' +
            '<div style="height:7px;margin:0.25rem 0 0.3rem;border-radius:999px;' +
            'background:rgba(148,163,184,0.18);overflow:hidden;">' +
            '<div style="height:100%;width:' + v + '%;border-radius:999px;background:' +
            barColour(v, m.good) + ';"></div></div>' +
            '<p style="margin:0;font-size:0.8rem;line-height:1.55;color:' + INK3 + ';">' +
            verdict(m, v) + '</p></div>';
        }

        html += '<h4 style="margin:1.2rem 0 0.5rem;font-size:0.95rem;color:' + INK + ';">' +
          'The decisions that moved it</h4>';
        if (S.pivots.length) {
          html += '<ul style="margin:0 0 0.6rem;padding-left:1.1rem;">';
          for (i = 0; i < S.pivots.length; i++) {
            html += '<li style="margin:0 0 0.4rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
              '<span style="font-family:\'Cascadia Code\',Consolas,monospace;color:' + INK4 + ';">' +
              S.pivots[i].at + '</span> — ' + S.pivots[i].line + '</li>';
          }
          html += '</ul>';
        } else {
          html += '<p style="margin:0 0 0.6rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
            'None of the classic mistakes. You took the trades knowingly, which is the whole skill — ' +
            'the meters are still not all green, and on a real incident they never are.</p>';
        }

        html += '<h4 style="margin:1.2rem 0 0.5rem;font-size:0.95rem;color:' + INK + ';">' +
          'What a real IR plan would have pre-decided</h4>' +
          '<p style="margin:0 0 0.6rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
          'Every one of these is a decision somebody made here at speed, under pressure, alone. ' +
          'A plan does not make them better decisions; it makes them decisions that were already ' +
          'taken by daylight, by more than one person.</p><ul style="margin:0 0 0.9rem;padding-left:1.1rem;">';
        for (i = 0; i < S.sc.plan.length; i++) {
          html += '<li style="margin:0 0 0.4rem;font-size:0.85rem;line-height:1.6;color:' + INK3 + ';">' +
            S.sc.plan[i] + '</li>';
        }
        html += '</ul>';

        /* The two clocks, stated as context and nothing more. The percentage
           is arithmetic on this run's own elapsed time — 72 hours cannot be
           reached inside a session, so it is reported as a fraction used
           rather than simulated as an event that never fires. */
        var pct = Math.round((S.minutes / (72 * 60)) * 100);
        html +=
          '<div style="margin-top:1.1rem;padding:0.85rem 0.95rem;border-radius:10px;' +
          'background:' + SHEET + ';border:1px solid ' + LINE + ';">' +
          '<p style="margin:0 0 0.5rem;font-size:0.8rem;line-height:1.6;color:' + INK3 + ';">' +
          'Two real clocks were running behind this exercise. CERT-In&rsquo;s April 2022 direction, ' +
          'issued under section 70B(6) of the IT Act, asks for certain cyber incidents to be reported ' +
          'to CERT-In <strong>within six hours of noticing them</strong> — a window you ' +
          (S.flags.reported ? 'filed inside' : 'did not file inside') + ' on this run. ' +
          'Article 33 of the GDPR gives <strong>72 hours from becoming aware</strong> of a personal-data ' +
          'breach to notify the supervisory authority; this run used about ' + pct + '% of that.</p>' +
          '<p style="margin:0;font-size:0.78rem;line-height:1.6;color:' + INK4 + ';">' +
          'Stated as context. This is a training exercise, not legal advice, and which duties apply ' +
          'to a real organisation depends on where it operates and what data it holds — ask the ' +
          'people whose job that is, before you need them.</p></div>' +
          '<div style="margin-top:1.1rem;display:flex;gap:0.6rem;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" type="button" data-ir-again>Run it again</button>' +
          '<button class="game-btn" type="button" data-ir-swap>Try the other scenario</button></div>';

        host.innerHTML = html;
        barFills = [];

        var again = host.querySelector('[data-ir-again]');
        again.addEventListener('click', function () { g.start(); });
        host.querySelector('[data-ir-swap]').addEventListener('click', function () {
          if (scenarioSel) {
            scenarioSel.value = S.key === 'ransomware' ? 'bec' : 'ransomware';
            g.save('scenario', scenarioSel.value);
          }
          g.start();
        });
        try { again.focus({ preventScroll: true }); } catch (err) { again.focus(); }
      }

      /* ---------------------------------------------------------------
         Controls.
         --------------------------------------------------------------- */
      if (scenarioSel) {
        scenarioSel.addEventListener('change', function () {
          g.save('scenario', scenarioSel.value);
          /* A scenario change restarts, because there is no coherent way to
             swap the incident under a run in progress. Announced rather than
             done silently: throwing away someone's half-finished tabletop
             without saying so is the kind of thing that reads as a bug. */
          g.announce('Scenario changed. Starting a new incident.');
          g.start();
        });
      }
      if (pressureSel) {
        pressureSel.addEventListener('change', function () {
          g.save('pressure', pressureSel.value);
          var p = PRESSURE[pressureSel.value] || PRESSURE.standard;
          if (S) { S.scale = p.scale; S.drifts = p.drift; }
        });
      }
      if (logBtn) {
        logBtn.addEventListener('click', function () {
          showFullLog = !showFullLog;
          logBtn.setAttribute('aria-pressed', String(showFullLog));
          logBtn.title = showFullLog ? 'Timeline: showing every entry' : 'Timeline: showing the last three';
          if (!S || S.done) return;
          refreshLog();
        });
      }

      function begin() {
        var want = scenarioSel ? scenarioSel.value : 'ransomware';
          if (want === 'surprise' || !SCENARIOS[want]) {
            want = Math.random() < 0.5 ? 'ransomware' : 'bec';
          }
        var p = PRESSURE[pressureSel ? pressureSel.value : 'standard'] || PRESSURE.standard;

        S = {
          key: want,
          sc: SCENARIOS[want],
          at: 0,
          answered: 0,
          minutes: 0,
          /* Opening positions. Containment is nothing because nothing has
             been done yet; evidence is forty rather than a hundred because
             "what a forensic examiner could work with right now" is never
             everything — it is the logs that happen to be on by default. */
          c: 0, e: 40, b: 5, r: 15,
          flags: {},
          log: [],
          pivots: [],
          fired: {},
          opts: [],
          drift: 0,
          scale: p.scale,
          drifts: p.drift,
          pending: false,
          done: false,
          clockText: '',
          elapsedText: ''
        };

        lastClock = '';
        lastPhase = '';
        push(S.sc.opening);
        g.setScore(composite());
        room.set('threat', threat());
        render();
      }

      return {
        ready: function () {
          /* The shell runs reset() during construction and ready() after it,
             so a restored preference arrives one step too late: the board
             behind the Play screen had already been built from whatever the
             select happened to default to, and a visitor who last played the
             wire fraud was shown the ransomware brief under a dropdown
             reading "Wire fraud". Restore, then build it again. */
          var sc = g.load('scenario', '');
          var pr = g.load('pressure', '');
          var moved = false;
          if (scenarioSel && (sc === 'ransomware' || sc === 'bec' || sc === 'surprise') &&
              scenarioSel.value !== sc) { scenarioSel.value = sc; moved = true; }
          if (pressureSel && PRESSURE[pr] && pressureSel.value !== pr) {
            pressureSel.value = pr;
            moved = true;
          }
          if (moved) begin();
        },

        reset: begin,

        key: function (name) {
          /* The shell passes the arrows through from a focused button, so one
             handler covers both cases: keyboard on the board itself, and
             keyboard already sitting on an option. Space and Enter are NOT
             passed on from a button — they activate it — which is why 'action'
             here only has to cover the board-focused case. */
          if (!S || S.done) return;
          var next = host.querySelector('[data-ir-next]');
          /* While a consequence is on screen the options are hidden but the
             buttons still exist, so the arrows would happily move focus onto
             something nobody can see. There is exactly one thing to do here
             and it is Carry on. */
          if (S.pending) {
            if (name === 'action' && next) next.click();
            return;
          }
          if (name === 'up' || name === 'left') { focusOpt(-1); return; }
          if (name === 'down' || name === 'right') { focusOpt(1); return; }
          if (name === 'action' && optBtns.length) choose(optIdx);
        },

        update: function (dt) {
          if (!S || S.done) return;

          /* Frame time, measured rather than assumed. update() runs on a
             fixed 1/120 accumulator, so several calls arrive inside one frame
             microseconds apart and the gap across a frame boundary is the
             only honest sample in here. Anything over 400 ms is a tab coming
             back rather than a slow frame and is thrown away. */
          var w = now();
          var gap = w - wallLast;
          wallLast = w;
          if (gap > 1 && gap < 400) frameMs += (gap - frameMs) * 0.08;
          var smooth = !reduced && frameMs < SLOW_FRAME_MS;

          /* Deliberation. Only while a decision is actually open — reading
             the consequence of a choice already made costs nothing, because
             the alternative is a game that punishes people for reading the
             explanation it just wrote for them. */
          if (S.drifts && !S.pending && S.drift < DRIFT_CAP) {
            var add = dt * DRIFT_RATE;
            if (S.drift + add > DRIFT_CAP) add = DRIFT_CAP - S.drift;
            S.drift += add;
            advanceTo(S.minutes + add);
            S.clockText = clockAt(S.minutes);
          }

          /* The bars. Four style writes a frame while easing, and nothing
             else in this file has a per-frame cost at all — so this is the
             one thing worth degrading, and it degrades by snapping rather
             than by easing more coarsely: a bar that arrives late is a bar
             disagreeing with the number printed above it. */
          for (var i = 0; i < barFills.length && i < METERS.length; i++) {
            var target = S[METERS[i].key];
            if (smooth) barShown[i] += (target - barShown[i]) * Math.min(1, 6 * dt);
            else barShown[i] = target;
            var pct = Math.round(barShown[i]);
            if (barFills[i].getAttribute('data-ir-pct') === String(pct)) continue;
            barFills[i].setAttribute('data-ir-pct', String(pct));
            barFills[i].style.width = pct + '%';
            barFills[i].style.background = barColour(pct, METERS[i].good);
            /* The figure travels with the bar rather than jumping to the
               final value the instant a choice lands. A number that has
               already settled above a bar still moving is the pair visibly
               disagreeing about the same meter. */
            if (barNums[i]) barNums[i].textContent = String(pct);
          }
        },

        ended: function (score, isBest) {
          /* The shell has just opened its game-over card over the board. The
             report is four meters, a list of decision points and six lines of
             plan; it does not fit in that card and must not be behind it. */
          g.hideOverlay();
          report(score, isBest);
        }
      };
    }
  });
})();

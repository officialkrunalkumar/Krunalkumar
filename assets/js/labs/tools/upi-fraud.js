/* ==========================================================================
   upi-fraud.js — UPI and payment fraud in India, taken apart.
   --------------------------------------------------------------------------
   Almost every UPI fraud I have been asked about turns on one confusion, and
   it is not a technical one: people believe that receiving money can require
   an approval. It cannot. A collect request is a bill, a QR code is an address
   to pay to, and the six digits are only ever a signature on a debit. Explain
   that in a paragraph and it is forgotten by evening. Make somebody decide,
   round after round, whether the screen in front of them takes or gives, and
   the rule survives the phone call it needs to survive.

   Three deliberate limits on this file, because this subject deserves them:

   1. Every screen it draws is a diagram. The mock has a standing ribbon
      saying so, no field on it accepts input, and the thing that looks like a
      confirm button is a paragraph — not a button, not focusable, wired to
      nothing. There is no payment flow here to reverse-engineer.
   2. No real handles, no bank names, no logos. Where a payment app would show
      a UPI ID the diagram says the ID is withheld, which also makes the point
      that a display name is free text typed by whoever raised the request.
   3. The script walkthroughs describe the shape of each approach and the
      question that ends it. They do not describe how to run one, and the
      "moment money moves" beat is written from the victim's side of the
      screen on purpose.

   Everything is built in the page. No network request of any kind is made.
   ========================================================================== */

/* global LabTool */
(function () {
  'use strict';

  var mount = document.getElementById('upi-mount');
  if (!mount) return;

  function E(tag, cn, text) {
    var node = document.createElement(tag);
    if (cn) node.className = cn;
    if (text != null) node.textContent = text;
    return node;
  }

  function empty(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function para(host, cn, text) {
    host.appendChild(E('p', cn, text));
  }

  /* ------------------------------------------------------------------------
     A tab strip, used twice: once across the three panels and once down the
     side of the script list.

     Written as real ARIA tabs rather than a pile of show/hide buttons because
     the second use is a list of six long text panels, and without roving
     tabindex a keyboard user has to walk through all six triggers to reach the
     content of the one they picked.
     ------------------------------------------------------------------------ */
  function makeTabs(host, defs, idBase, vertical) {
    var strip = E('div', vertical ? 'upi-tabs upi-tabs-v' : 'upi-tabs');
    strip.setAttribute('role', 'tablist');
    if (vertical) strip.setAttribute('aria-orientation', 'vertical');
    var tabs = [];
    var panels = [];
    var bodies = E('div', vertical ? 'upi-bodies upi-bodies-v' : 'upi-bodies');

    function select(index, moveFocus) {
      var i;
      for (i = 0; i < tabs.length; i++) {
        var on = i === index;
        tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        tabs[i].tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
      }
      if (moveFocus) tabs[index].focus();
    }

    function onKey(index) {
      return function (ev) {
        var next = -1;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (index + 1) % tabs.length;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
        else if (ev.key === 'Home') next = 0;
        else if (ev.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        ev.preventDefault();
        select(next, true);
      };
    }

    defs.forEach(function (def, i) {
      var tab = E('button', 'upi-tab');
      tab.type = 'button';
      tab.id = idBase + '-tab-' + i;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', idBase + '-panel-' + i);
      tab.appendChild(E('span', 'upi-tab-n', String(i + 1)));
      var wrap = E('span', 'upi-tab-txt');
      wrap.appendChild(E('span', 'upi-tab-title', def.label));
      if (def.sub) wrap.appendChild(E('span', 'upi-tab-sub', def.sub));
      tab.appendChild(wrap);
      tab.addEventListener('click', function () { select(i, false); });
      tab.addEventListener('keydown', onKey(i));
      strip.appendChild(tab);
      tabs.push(tab);

      var panel = E('div', 'upi-panel');
      panel.id = idBase + '-panel-' + i;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      /* Only the text-only panels take focus themselves. APG asks for it where
         a panel holds nothing focusable, and asks against it where it does —
         panel one is all buttons, so a tab stop there is a stop on nothing. */
      if (def.textOnly) panel.tabIndex = 0;
      panel.hidden = true;
      bodies.appendChild(panel);
      panels.push(panel);
      if (def.build) def.build(panel);
    });

    host.appendChild(strip);
    host.appendChild(bodies);
    select(0, false);
    return panels;
  }

  /* ------------------------------------------------------------------------
     Panel 1 — collect request or credit?

     The rounds are ordered by how much of the screen is lying. The first two
     are honest screens; from there the requester-controlled text gets louder
     and the app-written line stays exactly where it was, which is the whole
     lesson. The tell index marks the row that settles it.
     ------------------------------------------------------------------------ */
  var SEND = 'send';
  var RECEIVE = 'receive';

  var ROUNDS = [
    {
      screen: 'Payment request',
      rows: [
        ['Requested by', 'RAJ ELECTRONICS'],
        ['UPI ID', 'withheld in this diagram'],
        ['Amount', '₹8,499'],
        ['Note from requester', 'Order #4471'],
        ['Expires in', '9 minutes']
      ],
      action: 'ENTER UPI PIN TO PAY ₹8,499',
      actionTell: true,
      answer: SEND,
      short: 'Money leaves. This is a bill.',
      why: [
        'A collect request is a bill somebody has raised against your account. Approving it debits you for the amount they chose.',
        'The line at the bottom is written by your own payments app and it says pay. Everything above it is text the requester typed.'
      ],
      rule: 'If a screen wants your UPI PIN, money is leaving. There is no exception to this.'
    },
    {
      screen: 'Transaction alert',
      rows: [
        ['Credited', '₹8,499'],
        ['From', 'ANITA S'],
        ['Reference', 'shown in your statement'],
        ['Your action', 'none required'],
        ['Balance', 'already updated']
      ],
      action: 'OK',
      actionTell: false,
      tell: 3,
      answer: RECEIVE,
      short: 'Money arrived. Nothing was asked of you.',
      why: [
        'This is what a real credit looks like: an announcement. By the time you are reading it, it has already happened.',
        'There is no button anywhere in UPI that makes an incoming payment occur. Receiving is passive.'
      ],
      rule: 'A genuine credit is news, not a decision.'
    },
    {
      screen: 'Payment request',
      rows: [
        ['Requested by', 'CUSTOMER CARE — REFUND DESK'],
        ['UPI ID', 'withheld in this diagram'],
        ['Note from requester', 'Approve to receive your refund'],
        ['Amount', '₹4,999']
      ],
      action: 'ENTER UPI PIN TO PAY ₹4,999',
      actionTell: true,
      answer: SEND,
      short: 'Money leaves. The word refund was typed by a stranger.',
      why: [
        'Both the name at the top and the note under it are free text, chosen by whoever raised the request. They can say anything, including refund.',
        'The line your app wrote has not changed since the first round, and it still says pay.'
      ],
      rule: 'Read the line your app wrote, not the line a stranger wrote.'
    },
    {
      screen: 'Scan and pay',
      rows: [
        ['Code resolves to', 'SHIVAM TRADERS'],
        ['UPI ID', 'withheld in this diagram'],
        ['Amount', '₹22,000 (fixed by the code)'],
        ['Purpose shown', 'Receive your winnings']
      ],
      action: 'ENTER UPI PIN TO PAY ₹22,000',
      actionTell: true,
      answer: SEND,
      short: 'Money leaves. A QR code is an address to pay to.',
      why: [
        'A UPI QR code carries a payee and, sometimes, an amount. Scanning one can start a payment out of your account and nothing else.',
        'No QR code pulls money in. If a buyer sends you a code and asks you to scan it, they are asking you to pay them.'
      ],
      rule: 'Nobody has ever received money by scanning a code.'
    },
    {
      screen: 'Request sent',
      rows: [
        ['You requested', '₹3,000'],
        ['From', 'ANITA S'],
        ['Status', 'waiting for her approval'],
        ['PIN prompt appears on', 'her phone, not yours']
      ],
      action: 'WAITING…',
      actionTell: false,
      tell: 3,
      answer: RECEIVE,
      short: 'Money arrives, if she approves. Nothing here can debit you.',
      why: [
        'This is the same collect mechanism as round one, pointed the other way. You raised it, so the approval screen appears on the other person’s phone.',
        'Which phone shows the PIN prompt is the entire question. That phone is the one the money leaves.'
      ],
      rule: 'Whoever is asked for a PIN is the one paying.'
    },
    {
      screen: 'Approve mandate',
      rows: [
        ['Mandate to', 'STREAM PLUS'],
        ['Debit today', '₹1'],
        ['Then', '₹4,999 every month until cancelled'],
        ['Approvals needed later', 'none'],
        ['Valid until', '2031']
      ],
      action: 'ENTER UPI PIN TO APPROVE MANDATE',
      actionTell: true,
      answer: SEND,
      short: 'Money leaves, once now and every month after.',
      why: [
        'An autopay mandate is one approval for an unlimited series of debits. The rupee today is the number you look at; the line under it is the number that matters.',
        'You are not approving a payment here. You are approving a standing permission to take payments, and after this screen nothing asks you again.'
      ],
      rule: 'One PIN, many debits. Read the "then" line before the "today" line.'
    },
    {
      screen: 'Payment request',
      rows: [
        ['Requested by', 'REFUND OFFICER — CREDITED'],
        ['Note from requester', '₹19,999 credited to your account'],
        ['Status shown in note', 'pending your approval'],
        ['Amount', '₹19,999'],
        ['UPI ID', 'withheld in this diagram']
      ],
      action: 'ENTER UPI PIN TO PAY ₹19,999',
      actionTell: true,
      answer: SEND,
      short: 'Money leaves. Credited and pending approval cannot both be true.',
      why: [
        'The word credited appears twice on this screen, and both times it is inside text the requester typed. The one line they cannot touch still says pay.',
        'A real credit is never pending your approval, because it is already done. That contradiction is the tell, and it is the most common frame in Indian payment fraud.'
      ],
      rule: 'Believe the PIN prompt. It is the only line on the screen the other party cannot write.'
    }
  ];

  function buildDecide(host) {
    var index = 0;
    var score = 0;
    var answered = false;
    var summarised = false;

    var head = E('div', 'upi-head');
    var progress = E('p', 'upi-progress');
    var tally = E('p', 'upi-tally');
    head.appendChild(progress);
    head.appendChild(tally);

    var stage = E('div', 'upi-stage');

    var ask = E('p', 'upi-ask', 'Does this screen take money out of your account, or put money into it?');
    var choices = E('div', 'upi-choices');
    var sendBtn = E('button', 'upi-choice', 'Money leaves my account');
    var recvBtn = E('button', 'upi-choice', 'Money arrives in my account');
    sendBtn.type = 'button';
    recvBtn.type = 'button';
    choices.appendChild(sendBtn);
    choices.appendChild(recvBtn);

    var verdict = E('p', 'upi-verdict');
    verdict.setAttribute('role', 'status');
    verdict.setAttribute('aria-live', 'polite');

    var explain = E('div', 'upi-explain');
    var nextWrap = E('div', 'upi-next');
    var nextBtn = E('button', 'upi-go', 'Next round');
    nextBtn.type = 'button';
    nextWrap.appendChild(nextBtn);
    nextWrap.hidden = true;

    var caption = E('p', 'upi-caption',
      'Every screen above is a diagram drawn by this page. It is not a payments app, ' +
      'no field on it accepts input, and nothing here sends anything anywhere.');

    function drawScreen(round) {
      empty(stage);
      var mock = E('figure', 'upi-mock');
      var ribbon = E('figcaption', 'upi-mock-ribbon', 'Illustration — not a real app');
      mock.appendChild(ribbon);
      mock.appendChild(E('p', 'upi-mock-title', round.screen));

      var list = E('dl', 'upi-rows');
      round.rows.forEach(function (row, i) {
        var line = E('div', 'upi-row');
        line.appendChild(E('dt', 'upi-row-k', row[0]));
        line.appendChild(E('dd', 'upi-row-v', row[1]));
        line.setAttribute('data-i', String(i));
        list.appendChild(line);
      });
      mock.appendChild(list);
      mock.appendChild(E('p', 'upi-mock-action', round.action));
      stage.appendChild(mock);
      return mock;
    }

    function markTell(mock, round) {
      var node;
      if (round.actionTell) {
        node = mock.querySelector('.upi-mock-action');
      } else if (typeof round.tell === 'number') {
        node = mock.querySelector('.upi-row[data-i="' + round.tell + '"]');
      }
      if (!node) return;
      node.className += ' is-tell';
      node.appendChild(E('span', 'upi-tellmark', 'the tell'));
    }

    function render() {
      var round = ROUNDS[index];
      answered = false;
      summarised = false;
      progress.textContent = 'Round ' + (index + 1) + ' of ' + ROUNDS.length;
      tally.textContent = score + ' right so far';
      var mock = drawScreen(round);
      mock.setAttribute('data-round', String(index));
      sendBtn.disabled = false;
      recvBtn.disabled = false;
      sendBtn.className = 'upi-choice';
      recvBtn.className = 'upi-choice';
      verdict.textContent = '';
      verdict.className = 'upi-verdict';
      empty(explain);
      nextWrap.hidden = true;
      ask.hidden = false;
      choices.hidden = false;
    }

    function finish() {
      summarised = true;
      empty(stage);
      empty(explain);
      ask.hidden = true;
      choices.hidden = true;
      progress.textContent = 'Finished';
      tally.textContent = score + ' of ' + ROUNDS.length + ' right';

      var done = E('div', 'upi-done');
      done.appendChild(E('h3', 'upi-done-h', 'One rule carries all seven'));
      para(done, 'upi-done-p',
        'The PIN is a signature on a debit. It authorises money leaving and it does ' +
        'nothing else, in any app, on any screen, for any reason anybody gives you. ' +
        'Receiving money in UPI needs no approval, no PIN, no scan and no link, ' +
        'because there is nothing to authorise — the money is simply there.');
      para(done, 'upi-done-p',
        'Everything else on a request screen — the name, the note, the reason, the ' +
        'word refund — is text the other party typed. Treat it as their claim, not as ' +
        'information.');
      stage.appendChild(done);

      verdict.className = 'upi-verdict';
      verdict.textContent = 'All seven rounds finished. ' + score + ' of ' +
        ROUNDS.length + ' right.';
      nextBtn.textContent = 'Start again';
      nextWrap.hidden = false;
    }

    function answer(choice) {
      if (answered) return;
      answered = true;
      var round = ROUNDS[index];
      var right = choice === round.answer;
      if (right) score += 1;
      tally.textContent = score + ' right so far';

      sendBtn.disabled = true;
      recvBtn.disabled = true;
      var picked = choice === SEND ? sendBtn : recvBtn;
      picked.className = 'upi-choice is-picked';
      var truth = round.answer === SEND ? sendBtn : recvBtn;
      truth.className += ' is-answer';

      markTell(stage.querySelector('.upi-mock'), round);

      verdict.className = 'upi-verdict ' + (right ? 'is-right' : 'is-wrong');
      verdict.textContent = (right ? 'Correct. ' : 'Not this one. ') + round.short;

      empty(explain);
      round.why.forEach(function (line) { para(explain, 'upi-why', line); });
      var rule = E('p', 'upi-rule');
      rule.appendChild(E('span', 'upi-rule-k', 'The rule'));
      rule.appendChild(document.createTextNode(round.rule));
      explain.appendChild(rule);

      nextBtn.textContent = index === ROUNDS.length - 1 ? 'See the summary' : 'Next round';
      nextWrap.hidden = false;
      nextBtn.focus();
    }

    sendBtn.addEventListener('click', function () { answer(SEND); });
    recvBtn.addEventListener('click', function () { answer(RECEIVE); });
    /* Three destinations behind one button, which is why the state is two
       explicit flags rather than something inferred from the text on it: the
       summary screen and the last round both sit at index 6, and reading the
       progress line to tell them apart would break the moment that wording
       changed. */
    nextBtn.addEventListener('click', function () {
      if (summarised) {
        index = 0;
        score = 0;
        render();
        sendBtn.focus();
        return;
      }
      if (index >= ROUNDS.length - 1) {
        finish();
        nextBtn.focus();
        return;
      }
      index += 1;
      render();
      sendBtn.focus();
    });

    host.appendChild(head);
    para(host, 'upi-lede',
      'One question, seven screens, and the same answer hiding in the same place ' +
      'every time. Decide before you scroll — guessing and being wrong is the ' +
      'point of the exercise, and it is cheaper here than at a counter.');
    host.appendChild(stage);
    host.appendChild(ask);
    host.appendChild(choices);
    host.appendChild(verdict);
    host.appendChild(explain);
    host.appendChild(nextWrap);
    host.appendChild(caption);
    render();
  }

  /* ------------------------------------------------------------------------
     Panel 2 — the six frames.

     Each is written as four beats because that is the shape every one of them
     has: something opens the conversation, something stops you leaving it, and
     then a single screen does the damage. The fourth beat is the only part
     that is any use in the moment, so it gets its own styling and its own
     heading. "What they need from you" is there because every script has one
     load-bearing dependency, and naming it turns a story into a defence.
     ------------------------------------------------------------------------ */
  var SCRIPTS = [
    {
      label: 'The fake refund',
      sub: 'Money you are owed',
      hook: 'It opens with them giving rather than asking. An order that failed, a train ticket cancelled, a double-charged electricity bill, a deposit the landlord is releasing. Being owed money switches off the part of you that checks, because on the face of it nothing is being requested.',
      pressure: 'A closing window and a patient, apologetic voice. The refund reference expires at six. The gateway batch closes tonight. They stay courteous the whole way, because courtesy is what stops you hanging up and calling the company on a number you already have.',
      moment: 'They raise a collect request, or send a QR code, or walk you into a payment screen, and call it the refund. What you approve is a debit. Often the first one is small and framed as verifying the account — that one exists to teach you the motion, not to take the money.',
      question: 'Which of us is about to type a PIN? If the answer is you, this is not a refund. A refund needs nothing from you at all.',
      need: 'Your approval on a screen they have no way of reaching themselves. That is the entire dependency.'
    },
    {
      label: 'Wrong number, sorry, send it back',
      sub: 'A credit you did not expect',
      hook: 'A small amount lands in your account, often genuinely, followed by a distressed message. Sent to the wrong number. Please return it. Sometimes a second voice calls, presenting as a bank officer, to confirm the story.',
      pressure: 'Decency and embarrassment, which are far stronger levers than fear. You are being asked to be a good person about somebody else’s mistake, and refusing feels like keeping what is not yours.',
      moment: 'The return goes out through their link, their QR or their request, and it goes to an account that is not the one that credited you. Two common endings: the amount you send back is quietly larger than what arrived, or the original credit is reversed later as a disputed transaction while your return has already left. There is a third and worse ending — if the money that reached you was itself stolen, passing it on has made your account a link in the chain, and it is your account that gets frozen.',
      question: 'Why is a bank not doing this? A genuine misdirected transfer is reversed by the sender’s bank, on the sender’s written request, with a reference number. It is never returned by a stranger with a link.',
      need: 'Your willingness to move money outside the banking process. Tell them to raise it with their own bank, keep the credit untouched, tell your bank about it, and stop replying.'
    },
    {
      label: 'The QR that will send you money',
      sub: 'Selling something online',
      hook: 'You have listed a sofa, a phone, a bike. A buyer appears quickly, agrees the price without haggling, and wants to settle immediately — which is already unusual enough to be worth noticing.',
      pressure: 'They are travelling, or their driver is downstairs, or they are being posted out tomorrow. The urgency is structural: it explains why they cannot meet, why they will not inspect, and why this has to happen in the next ten minutes.',
      moment: 'They send a QR code to receive the payment with, and ask you to scan it and enter your PIN. A QR code is an address to pay to. Scanning it and approving can only move money out of your account.',
      question: 'Show me the receive screen that asks for a PIN. There is not one, in any app. Receiving is passive — the money is simply there, and you find out afterwards.',
      need: 'Your belief that receiving requires an action. A single demonstration that it does not ends every version of this.'
    },
    {
      label: 'The dealer with posting orders',
      sub: 'A listing too good to leave',
      hook: 'A car, a bike, furniture, a flat, well under the going rate, posted by a seller who says they are armed forces or a government officer being posted out at short notice and must sell this week. A photograph in uniform and a picture of an identity card do most of the work.',
      pressure: 'Rank and hurry. The story is built so that checking feels like an insult, and a unit transport or a depot will deliver so you never have to see the item or the person. Somebody senior may call to vouch for them.',
      moment: 'Never one payment. A token to hold it, then transport, then insurance, then a refundable security deposit, then a clearance charge. Each is small against what you have already put in, which is exactly the design — by the third one you are not deciding to pay, you are protecting what you paid.',
      question: 'Am I paying for something I have not seen, to somebody I have not met? No canteen, depot or unit ships goods against an advance transfer to a personal account, and no posting order has ever required one.',
      need: 'The first small payment. Sunk cost does the rest, so the only payment that matters is the one you have not made yet. The same story runs against sellers too, with a forged payment screenshot in place of the token.'
    },
    {
      label: 'The helpline you found yourself',
      sub: 'You made the call',
      hook: 'Something went wrong with a delivery, a booking, a payment app, an account. You searched for the customer care number and rang what came up. Nobody called you. That is precisely why it works — every warning you have ever heard is about incoming calls.',
      pressure: 'The number sat on a page that looked official, in an advertisement above the results, or in a business listing anybody can suggest an edit to. The person answers in the company’s name, has a script, and is unhurried.',
      moment: 'A verification request for one or ten rupees to confirm the account is yours, or a push towards a screen-sharing app to process the refund. Either way you approve something. The small amount is not the point; the approval is, and so is what they watch you type next.',
      question: 'Where did this number actually come from? Support numbers live inside the app you already have installed, on the back of your card, or on your statement. A search result is not a source.',
      need: 'Your trust in a number you found rather than a number you were issued. Take the number from the account itself and the approach never starts.'
    },
    {
      label: 'The screen share',
      sub: 'Let me just see your screen',
      hook: 'Something has to be fixed and they need to look. A stuck refund, a KYC that will not go through, an app that keeps failing. They send a link to a genuine remote-support application from the real app store, which makes the request feel routine rather than strange.',
      pressure: 'Helpfulness, and a little technical embarrassment. You do not want to be the person who cannot follow simple instructions, and the app installs without a single warning that reads like a warning.',
      moment: 'With your screen visible they read the one-time password out of your notification bar, your balance, and your PIN as your thumb lands on it. With remote control they operate the banking app themselves while you watch. The debit does not feel like a debit, because you did not perform it.',
      question: 'Would my bank ask to watch me type my PIN? No employee of any bank, payment app, telecom operator or government office ever needs to see your screen. Not once, not to verify, not to help.',
      need: 'A remote-access application installed on your phone. If one is already there and you did not choose it deliberately, uninstalling it comes before every other step.'
    }
  ];

  function buildScripts(host) {
    para(host, 'upi-lede',
      'Six approaches, and between them they cover most of what actually reaches ' +
      'people here. They are not six tricks — they are one trick with six ways in, ' +
      'and the fourth beat is the part worth memorising.');

    var defs = SCRIPTS.map(function (s) {
      return {
        label: s.label,
        sub: s.sub,
        textOnly: true,
        build: function (panel) {
          panel.appendChild(E('h3', 'upi-script-h', s.label));
          beat(panel, 'The hook', s.hook);
          beat(panel, 'The pressure', s.pressure);
          beat(panel, 'Where the money actually moves', s.moment);
          var q = E('div', 'upi-beat upi-beat-q');
          q.appendChild(E('p', 'upi-beat-k', 'The one question that ends it'));
          q.appendChild(E('p', 'upi-beat-v', s.question));
          panel.appendChild(q);
          beat(panel, 'What they need from you', s.need);
        }
      };
    });

    function beat(panel, key, value) {
      var b = E('div', 'upi-beat');
      b.appendChild(E('p', 'upi-beat-k', key));
      b.appendChild(E('p', 'upi-beat-v', value));
      panel.appendChild(b);
    }

    var frame = E('div', 'upi-scriptframe');
    host.appendChild(frame);
    makeTabs(frame, defs, 'upi-script', true);
  }

  /* ------------------------------------------------------------------------
     Panel 3 — the first hour.

     The checklist is the only genuinely interactive part, and it is a
     checklist rather than prose for one reason: somebody using this panel is
     doing several things at once, badly, while upset. Ticking a line is how
     you keep your place.

     No stored state. A device shared with the person who was defrauded is the
     normal case, and a half-ticked recovery checklist waiting on the screen
     the next morning is not something this page should leave behind.
     ------------------------------------------------------------------------ */
  var BANDS = [
    ['First 60 minutes',
     'Money is layered onward within minutes — split, withdrawn, or converted. ' +
     'A hold placed now can catch whatever has not moved yet. This hour is worth ' +
     'more than the whole week after it.'],
    ['First 24 hours',
     'Most of it will have moved. Reporting still matters: it ties your complaint ' +
     'to others against the same accounts, and that is what gets numbers and ' +
     'accounts blocked before they reach the next person.'],
    ['Later than that',
     'File anyway. Late is not pointless. Your acknowledgement number is the anchor ' +
     'for every later conversation with a bank, an officer or a court.']
  ];

  var STEPS = [
    ['Stop paying.',
     'There is no unlock fee, no clearance charge and no refundable deposit that ends this. If somebody is still on the line, hang up. If a screen-sharing app is running, close it.'],
    ['Call 1930.',
     'The national cybercrime helpline, staffed around the clock. Behind it sits the reporting system that pushes your complaint out to the banks and payment intermediaries in the transaction chain, so funds still in transit can be held.'],
    ['File at cybercrime.gov.in.',
     'The National Cybercrime Reporting Portal takes every category and gives you an acknowledgement number. Keep that number. Every later conversation starts from it.'],
    ['Call your bank’s own fraud line, separately.',
     'The 1930 route reaches the bank, but the dispute still has to be raised on your account. Do it by phone and in writing, and get an acknowledgement with a timestamp.'],
    ['Cut off what they can still reach.',
     'Change the UPI PIN and the app passcode, remove any remote-access or screen-sharing app they had you install, cancel any autopay mandate you approved, and ask the bank to block the UPI facility or the account if you shared credentials.'],
    ['Write it all down while it is fresh.',
     'Numbers, names, times, amounts, the reference of every debit, and screenshots of the conversation before anyone deletes it. Do not rely on remembering any of it tomorrow.'],
    ['Go to the police as well.',
     'Your local cyber cell, or any police station. Under the Zero FIR principle no station can refuse you for being outside its jurisdiction — the FIR is registered and transferred.'],
    ['Look after the person, not only the money.',
     'People carry this badly, and shame is what keeps them quiet for three days while the money moves. Tele-MANAS, the national mental health helpline, is on 14416.'],
    ['Expect the second approach.',
     'Anybody who contacts you afterwards offering guaranteed recovery for an advance fee is running the follow-up, on a list of people known to have paid once. Real recovery goes through the bank, the police and the courts, and it never begins with a stranger’s call.']
  ];

  function buildFirstHour(host) {
    para(host, 'upi-lede',
      'Speed is the only lever you have here, and it is a real one. If there are ' +
      'two of you in the room, work the first four in parallel rather than in order.');

    var clock = E('div', 'upi-clock');
    BANDS.forEach(function (band) {
      var cell = E('div', 'upi-band');
      cell.appendChild(E('p', 'upi-band-k', band[0]));
      cell.appendChild(E('p', 'upi-band-v', band[1]));
      clock.appendChild(cell);
    });
    host.appendChild(clock);

    var numbers = E('div', 'upi-numbers');
    numbers.appendChild(numberCard('1930', 'tel:1930',
      'National cybercrime helpline. Call this first.'));
    numbers.appendChild(numberCard('cybercrime.gov.in', 'https://cybercrime.gov.in/',
      'National Cybercrime Reporting Portal. File here and keep the acknowledgement number.'));
    numbers.appendChild(numberCard('14416', 'tel:14416',
      'Tele-MANAS, the national mental health helpline, if somebody is in distress.'));
    host.appendChild(numbers);

    var listHead = E('div', 'upi-head');
    listHead.appendChild(E('p', 'upi-progress', 'The order to work in'));
    var count = E('p', 'upi-tally', '0 of ' + STEPS.length + ' ticked');
    count.setAttribute('aria-live', 'polite');
    listHead.appendChild(count);
    host.appendChild(listHead);

    var list = E('ul', 'upi-steps');
    var boxes = [];
    STEPS.forEach(function (step, i) {
      var item = E('li', 'upi-step');
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'upi-step-' + i;
      box.className = 'upi-check';
      var label = E('label', 'upi-step-label');
      label.htmlFor = box.id;
      label.appendChild(E('span', 'upi-step-n', String(i + 1)));
      label.appendChild(E('span', 'upi-step-t', step[0]));
      item.appendChild(box);
      item.appendChild(label);
      item.appendChild(E('p', 'upi-step-d', step[1]));
      list.appendChild(item);
      boxes.push(box);
      box.addEventListener('change', function () {
        var n = 0;
        boxes.forEach(function (b) { if (b.checked) n += 1; });
        count.textContent = n + ' of ' + STEPS.length + ' ticked';
        item.className = box.checked ? 'upi-step is-done' : 'upi-step';
      });
    });
    host.appendChild(list);

    var honest = E('div', 'upi-honest');
    honest.appendChild(E('h3', 'upi-honest-h', 'What recovery honestly looks like'));
    para(honest, 'upi-honest-p',
      'I am not going to tell you the money comes back, because often it does not, ' +
      'and every page that implies otherwise makes the honest version harder to accept.');
    para(honest, 'upi-honest-p',
      'Your complaint triggers holds down the chain of accounts the money passed ' +
      'through, and only the portion still sitting somewhere in that chain can be ' +
      'held. Anything already withdrawn in cash, converted, or moved out of the ' +
      'country is beyond the reach of a hold. That is why recovery rates fall so ' +
      'steeply with every hour of delay, and it is the whole argument for calling ' +
      '1930 before you do anything else.');
    para(honest, 'upi-honest-p',
      'A hold is also not a refund. Money frozen in a mule account is evidence in a ' +
      'live case, and getting it released to you generally needs a court order, ' +
      'which takes months. Partial recovery is the common good outcome. Full ' +
      'recovery happens and is not the norm, and nobody can promise it to you in ' +
      'advance — not the bank, not the police, and not me.');
    para(honest, 'upi-honest-p',
      'Two things stay worth doing even when the money is gone. Reporting builds ' +
      'the case against the network rather than only your case, and that is how ' +
      'accounts get blocked before they reach the next person. And the ' +
      'acknowledgement number is the anchor for any later claim, insurance ' +
      'question or restitution order.');
    host.appendChild(honest);

    para(host, 'upi-caption',
      'Procedures and helpline numbers change. If you are dealing with a live ' +
      'incident, treat 1930 and the portal as the authority and this page as a ' +
      'reminder of the order to do things in.');
  }

  function numberCard(name, href, note) {
    var card = E('div', 'upi-number');
    var link = E('a', 'upi-number-a', name);
    link.href = href;
    if (href.indexOf('http') === 0) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    card.appendChild(link);
    card.appendChild(E('p', 'upi-number-n', note));
    return card;
  }

  /* ---------------------------------------------------------------------- */

  function build() {
    empty(mount);
    makeTabs(mount, [
      { label: 'Collect request or credit?',
        sub: 'Seven screens, one question',
        build: buildDecide },
      { label: 'Anatomy of the script',
        sub: 'Six approaches, beat by beat',
        build: buildScripts },
      { label: 'The first hour',
        sub: 'What to do, in order',
        build: buildFirstHour }
    ], 'upi-main', false);
  }

  LabTool.define({
    id: 'upifraud',
    onReady: build
  });
})();

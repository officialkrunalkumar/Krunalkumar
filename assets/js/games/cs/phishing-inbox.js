/* ==========================================================================
   phishing-inbox.js — triage a mailbox against a clock, and be shown the
   signal you walked past.
   --------------------------------------------------------------------------
   /games already has phishing-or-not, which is a specimen jar: one message,
   two buttons, no clock, and all the time in the world to stare at a domain.
   That game is about judgement. This one is about the thing that actually
   goes wrong, which is that nobody has all the time in the world. A real
   mailbox arrives faster than it can be read, and the attack is written to
   survive four seconds of attention rather than four minutes.

   Four decisions follow from that, and they are the whole file.

   1. TWELVE OF THE THIRTY-FOUR MESSAGES ARE GENUINE, and several of them are
      the most alarming things in the deck: a password expiring in four hours,
      VPN access revoked overnight, a season ticket about to charge £412. A
      player who learns "flag everything" has learned to ignore the alerts
      that matter, which is a worse outcome than the one the game was meant to
      fix. So the scoring punishes a false alarm exactly as hard as a miss,
      and the per-category panel tracks Genuine as its own lure type — because
      for most people it is the one that fools them.

   2. THE LINK IS A CLAIM AND A DESTINATION, AND THEY ARE SEPARATE. Every
      message renders like a mail client: display name, real address, subject,
      body, and a link whose visible text is the brand's own address on the
      malicious ones. Where it actually goes is shown only when you hover it,
      focus it with the arrow keys, or tap it — the same bargain a browser's
      status bar makes. Half the deck cannot be called without paying that
      cost, and paying it burns clock, which is the trade the game is about.

   3. THE ANSWER IS SHOWN IN PLACE, NOT IN A PARAGRAPH UNDERNEATH. On calling
      a message, every signal is boxed where it sits — the doubled label in
      the address, the "our bank has changed" sentence, the redirect parameter
      hiding at the end of a legitimate-looking URL — and numbered against a
      one-line note beside it. A reason printed below a message teaches you
      the reason; a box drawn around four characters in the middle of a domain
      teaches you where to look next time.

   4. EVERY BRAND, DOMAIN, PERSON AND NUMBER IS INVENTED. The domains are all
      under .example, which is reserved by RFC 2606 and can never be
      registered by anyone; the IP addresses are from the RFC 5737
      documentation ranges. No real campaign is reproduced, no real company is
      named, and nothing in here resolves. The lesson is in the SHAPE of the
      thing, and the shape is what has been kept.

      The phone numbers get the same treatment, and they need it more than the
      domains do: a domain nobody can register is inert, but a plausible-
      looking number is one somebody rings. Three of the messages here print a
      number and the whole point of two of them is that the number is the
      payload — so all three come from 0808 157 0000-0999, the block Ofcom
      reserves for drama and never allocates. An earlier draft used ordinary
      0800 and 0330 numbers, which are real allocations: invented on this desk
      is not the same claim as guaranteed to belong to nobody, and only the
      second one is safe to print beside the words "call this".

   The deck runs eighteen messages out of thirty-four, drawn five from the
   obvious tier, six from the middle and seven from the subtle one, shuffled
   inside each. The ramp is real: tier one gives you a domain with the brand
   bolted on the front, tier three gives you a compromised colleague replying
   into a thread you were already in.
   ========================================================================== */

(function () {
  'use strict';

  var W = 720;
  var H = 520;

  /* Card and panel geometry, in logical units. Written out rather than
     computed so the layout can be read off the file. */
  var TOP_H = 38;             // client chrome strip
  var BAR_H = 4;              // the clock, immediately under it
  var PAD = 14;
  var CARD_X = PAD;
  var CARD_Y = TOP_H + BAR_H + 12;
  var CARD_W = 472;
  var SIDE_X = CARD_X + CARD_W + 12;
  var SIDE_W = W - SIDE_X - PAD;
  var BAND_H = 76;
  var BAND_Y = H - PAD - BAND_H;
  var CARD_H = BAND_Y - CARD_Y - 10;

  var UI = '"Segoe UI", system-ui, sans-serif';
  var MONO = 'Consolas, "Cascadia Code", "DejaVu Sans Mono", monospace';

  /* How many of each tier make up one run. Eighteen is about five minutes at
     the default clock, which is long enough for the ramp to be felt and short
     enough that a second run is a second run rather than a chore. */
  var DRAW = [5, 6, 7];

  /* Scoring. A call is worth 60 whatever else happens, the clock is worth up
     to 40 more, and a streak is worth up to 40 on top — so speed and nerve
     together are worth rather more than one extra correct call, which is the
     only way a triage drill can reward triage rather than deliberation. */
  var BASE = 60;
  var SPEED_MAX = 40;
  var STREAK_STEP = 8;
  var STREAK_MAX = 40;

  /* The lure types. Genuine is a category like any other and sits last, in
     the position the eye reads as the summary — because the accuracy figure
     next to it is the one most players are surprised by. */
  var CATS = [
    { k: 'cred', label: 'Credential' },
    { k: 'inv', label: 'Invoice' },
    { k: 'pay', label: 'Payroll' },
    { k: 'it', label: 'IT desk' },
    { k: 'mfa', label: 'MFA push' },
    { k: 'call', label: 'Callback' },
    { k: 'real', label: 'Genuine' }
  ];

  /* ------------------------------------------------------------------
     The deck.

     Fields: cat (lure type), tier (1 obvious, 3 subtle), name and addr (the
     display name and the address behind it — a mail client shows both, and
     the gap between them is a tell in its own right), subj, body, link
     ({ text, href } or null), phish, sig (the spans to box, in reading
     order), tell (the one line that settles it).

     `sig[].f` names the field the span lives in: name, addr, subj, body,
     link (the visible text) or href (the destination). `sig[].t` is the exact
     substring — matched with indexOf at draw time rather than stored as an
     offset, because an offset silently rots the first time a sentence is
     reworded and a missing match is invisible.
     ------------------------------------------------------------------ */
  var MSGS = [
    /* ---- tier 1: the domain is wrong and it is wrong loudly ---- */
    {
      cat: 'cred', tier: 1, phish: true,
      name: 'Ferrite Cloud Security',
      addr: 'security@ferrite-cloud-verify.example',
      subj: 'Your workspace will be closed in 24 hours',
      body: 'We detected a sign-in from an unrecognised device. Confirm your password within 24 hours or your workspace and every file in it will be permanently deleted.',
      link: { text: 'https://ferrite.example/verify', href: 'http://ferrite-cloud-verify.example/login' },
      sig: [
        { f: 'addr', t: 'ferrite-cloud-verify.example', note: 'The brand is bolted onto a name anyone can register.' },
        { f: 'href', t: 'ferrite-cloud-verify.example', note: 'The link says ferrite.example and goes somewhere else.' },
        { f: 'body', t: 'permanently deleted', note: 'A countdown exists to stop you checking.' }
      ],
      tell: 'The visible link and its destination disagree. Nothing the message says can outrank that.'
    },
    {
      cat: 'real', tier: 1, phish: false,
      name: 'Ferrite Cloud',
      addr: 'no-reply@mail.ferrite.example',
      subj: 'A new device signed in to your workspace',
      body: 'A Windows laptop in your usual city signed in with your security key. If that was you, there is nothing to do.',
      link: { text: 'https://ferrite.example/account/devices', href: 'https://ferrite.example/account/devices' },
      sig: [
        { f: 'addr', t: 'mail.ferrite.example', note: 'A subdomain only Ferrite can create.' },
        { f: 'body', t: 'there is nothing to do', note: 'An attacker never tells you to do nothing.' }
      ],
      tell: 'Genuine. Read right to left: the label before .example is ferrite, and mail. in front of it is theirs to hand out.'
    },
    {
      cat: 'inv', tier: 1, phish: true,
      name: 'Stembridge Supplies',
      addr: 'billing@stembridge-invoices.example',
      subj: 'Overdue invoice SB-40118 — final notice',
      body: 'Our bank has changed. Please settle the outstanding 8,420 to the new account today; the old account is closed and anything sent to it will be lost.',
      link: { text: 'https://stembridge.example/invoices/40118', href: 'https://stembridge-invoices.example/pay' },
      sig: [
        { f: 'addr', t: 'stembridge-invoices.example', note: 'Not the supplier you have been paying for years.' },
        { f: 'body', t: 'Our bank has changed', note: 'The most expensive sentence in business fraud.' }
      ],
      tell: 'A supplier changing bank details by email is verified by voice, on a number off an old invoice — never one in the new mail.'
    },
    {
      cat: 'pay', tier: 1, phish: true,
      name: 'Brightmoor HR',
      addr: 'hr@brightmoor-people.example',
      subj: 'Confirm your bank details for the July run',
      body: 'Payroll is migrating this week. Re-enter your account number and sort code on the new portal before Thursday, or July will be paid late.',
      link: { text: 'https://brightmoor.example/payroll', href: 'https://brightmoor-people.example/portal' },
      sig: [
        { f: 'addr', t: 'brightmoor-people.example', note: 'A hyphen is not a subdomain. Different owner.' },
        { f: 'body', t: 'Re-enter your account number', note: 'Payroll already holds this. It never re-asks by link.' }
      ],
      tell: 'Payroll diversion. Your salary is redirected once and nobody finds out until payday.'
    },
    {
      cat: 'it', tier: 1, phish: true,
      name: 'IT Service Desk',
      addr: 'helpdesk@brightmoor.example.support-desk.example',
      subj: 'Mailbox at 98% — messages will start bouncing',
      body: 'Your mailbox is nearly full. Sign in below to raise your quota, or incoming mail will be rejected from midnight.',
      link: { text: 'https://brightmoor.example/quota', href: 'https://brightmoor.example.support-desk.example/quota' },
      sig: [
        { f: 'addr', t: 'support-desk.example', note: 'The last two labels are the owner. This is not you.' },
        { f: 'href', t: 'brightmoor.example.support-desk', note: 'Your own domain, demoted to a subdomain of theirs.' }
      ],
      tell: 'Everything to the left of the last two labels is the attacker\'s to choose, and they chose your employer.'
    },
    {
      cat: 'mfa', tier: 1, phish: true,
      name: 'Orrery ID',
      addr: 'push@orrery-id-alerts.example',
      subj: 'Approve sign-in — attempt 7 of 7',
      body: 'Someone is trying to sign in as you from 203.0.113.44. Six prompts have already gone to your phone. Approve the next one to stop the notifications.',
      link: null,
      sig: [
        { f: 'addr', t: 'orrery-id-alerts.example', note: 'Not orrery.example, and not a subdomain of it.' },
        { f: 'body', t: 'Approve the next one to stop the notifications', note: 'The flood IS the attack. Approving ends it for them.' }
      ],
      tell: 'MFA fatigue. Deny it, then change the password — because somebody already has the old one, or there would be no prompts.'
    },
    {
      cat: 'call', tier: 1, phish: true,
      name: 'Northgate Pay',
      addr: 'receipts@northgate-billing.example',
      subj: 'Payment of 749.00 to Halden Rail confirmed',
      body: 'Your card ending 4417 was charged 749.00. If you did not authorise this, call our fraud line on 0808 157 0142 within 12 hours.',
      link: null,
      sig: [
        { f: 'addr', t: 'northgate-billing.example', note: 'Close to the brand, owned by somebody else.' },
        { f: 'body', t: 'call our fraud line on 0808 157 0142', note: 'The payload. There is no link because it does not need one.' }
      ],
      tell: 'Callback fraud: an alarming charge you never made, and a number that reaches the person who invented it.'
    },
    {
      cat: 'real', tier: 1, phish: false,
      name: 'Larkspur Post',
      addr: 'tracking@larkspur.example',
      subj: 'Parcel LK9920481 is out for delivery',
      body: 'Your parcel is on the van and should arrive before six. No signature is needed and no fee is outstanding.',
      link: { text: 'https://larkspur.example/track/LK9920481', href: 'https://larkspur.example/track/LK9920481' },
      sig: [
        { f: 'body', t: 'no fee is outstanding', note: 'The small fee is the whole courier scam. This one asks for nothing.' },
        { f: 'href', t: 'larkspur.example', note: 'Exactly the domain in the visible text.' }
      ],
      tell: 'Genuine, and deliberately dull. Most real mail is: no threat, no deadline, and a page you could have found yourself.'
    },

    /* ---- tier 2: the tell has moved off the sender and into the link ---- */
    {
      cat: 'cred', tier: 2, phish: true,
      name: 'Quillon Sign',
      addr: 'no-reply@quillon.example.docs-share.example',
      subj: 'Roland Pike shared "Q3 headcount.pdf" with you',
      body: 'The document is protected. Sign in with your work email to open it. This link expires in 48 hours.',
      link: { text: 'View document', href: 'https://quillon.example.docs-share.example/auth' },
      sig: [
        { f: 'addr', t: 'docs-share.example', note: 'The owned name, hiding behind two friendlier labels.' },
        { f: 'body', t: 'Sign in with your work email to open it', note: 'A document that demands a login is a login page.' }
      ],
      tell: 'The real Quillon opens the file and asks who you are afterwards, if at all. Sign-in first is the attack, every time.'
    },
    {
      cat: 'real', tier: 2, phish: false,
      name: 'Quillon Sign',
      addr: 'notify@quillon.example',
      subj: 'Dinah Okafor sent you a document to sign',
      body: 'Supplier agreement with Stembridge Supplies. You can read it in full before signing, and decline it if something is wrong.',
      link: { text: 'https://quillon.example/d/8f21ab', href: 'https://quillon.example/d/8f21ab' },
      sig: [
        { f: 'body', t: 'decline it if something is wrong', note: 'A way out. Attacks offer exactly one road.' },
        { f: 'addr', t: 'quillon.example', note: 'The brand itself, with nothing appended.' }
      ],
      tell: 'Genuine. It names a colleague you know, gives you a way to refuse, and the domain has nothing stuck to it.'
    },
    {
      cat: 'inv', tier: 2, phish: true,
      name: 'Roland Pike',
      addr: 'r.pike@brightmoor.example.finance-mail.example',
      subj: 'Re: Stembridge — can you handle this quietly',
      body: 'I am in back-to-back meetings all afternoon. Please push the Stembridge payment through today and do not copy anyone in yet; I will explain on Friday.',
      link: null,
      sig: [
        { f: 'addr', t: 'finance-mail.example', note: 'Your domain is only a label in front of theirs.' },
        { f: 'body', t: 'do not copy anyone in', note: 'Secrecy is the request, and it is the only unusual one.' }
      ],
      tell: 'Business email compromise: authority, urgency, secrecy, money, and nothing at all to hover over.'
    },
    {
      cat: 'it', tier: 2, phish: true,
      name: 'Marta Vogel (IT)',
      addr: 'm.vogel@brightmoor-it.example',
      subj: 'Laptop encryption check — five minutes',
      body: 'We are auditing disk encryption before the insurance renewal. Run the checker below and enter your usual password when it asks.',
      link: { text: 'https://brightmoor.example/it/encryption-check', href: 'https://brightmoor-it.example/check' },
      sig: [
        { f: 'addr', t: 'brightmoor-it.example', note: 'A plausible name your employer does not own.' },
        { f: 'body', t: 'enter your usual password', note: 'Internal IT can reset it. It never needs to be told it.' }
      ],
      tell: 'Anyone who has to ask for your password is somebody who cannot already change it, which rules out your own IT department.'
    },
    {
      cat: 'real', tier: 2, phish: false,
      name: 'Orrery ID',
      addr: 'security@orrery.example',
      subj: 'Your password expires in 4 hours',
      body: 'Brightmoor requires a change every 90 days. Change it now, or you will be locked out at six and will have to ring the service desk.',
      link: { text: 'https://brightmoor.orrery.example/change-password', href: 'https://brightmoor.orrery.example/change-password' },
      sig: [
        { f: 'href', t: 'brightmoor.orrery.example', note: 'brightmoor is a subdomain OF orrery.example — their tenant.' },
        { f: 'body', t: 'locked out at six', note: 'A real deadline. Deadlines are not evidence of anything.' }
      ],
      tell: 'Genuine, and the one most people call fake. Threat, deadline, password link — and the owned domain is still your own identity provider.'
    },
    {
      cat: 'mfa', tier: 2, phish: true,
      name: 'Orrery ID',
      addr: 'no-reply@orrery-id.example',
      subj: 'Was this you? Sign-in from Lisbon',
      body: 'Approve or deny this attempt. If you deny it, we will ask for the one-time code on your phone so we can confirm it was not you.',
      link: { text: 'Deny this sign-in', href: 'https://orrery-id.example/deny' },
      sig: [
        { f: 'addr', t: 'orrery-id.example', note: 'One hyphen from the real provider, and a different owner.' },
        { f: 'body', t: 'we will ask for the one-time code', note: 'Nobody legitimate ever asks for it. Not even to say no.' }
      ],
      tell: 'The Deny button is the hook. It opens a form that collects the code the attacker is sitting there waiting for.'
    },
    {
      cat: 'call', tier: 2, phish: true,
      name: 'Vantage Trust Bank',
      addr: 'alerts@vantagetrust.example',
      subj: 'Card blocked — call us to reactivate',
      body: 'We have blocked the card ending 8802 after unusual activity. Call 0808 157 0119 and quote reference 44-A. Do not use the number on the back of your card, that line is closed today.',
      link: null,
      sig: [
        { f: 'body', t: 'Do not use the number on the back of your card', note: 'The one sentence no bank has ever written.' },
        { f: 'addr', t: 'alerts@vantagetrust.example', note: 'Right domain, and forged. A From line is typed, not proved.' }
      ],
      tell: 'The domain is correct and it is still an attack. The whole message exists to steer you off the one number you can verify.'
    },
    {
      cat: 'pay', tier: 2, phish: true,
      name: 'Cobalt Payroll',
      addr: 'noreply@cobaltpayroll.example',
      subj: 'Your end-of-year statement is ready',
      body: 'Download your statement for 2025-26. You will be asked to confirm your national insurance number and bank account to unlock the file.',
      link: { text: 'https://cobaltpayroll.example/statement', href: 'https://cobalt-payroll.example/statement' },
      sig: [
        { f: 'href', t: 'cobalt-payroll.example', note: 'One hyphen away from the sender, and not the same place.' },
        { f: 'body', t: 'confirm your national insurance number', note: 'A document does not need your identity to open.' }
      ],
      tell: 'The address is right and the link is not. They are two separate claims, and only one of them can be checked.'
    },
    {
      cat: 'real', tier: 2, phish: false,
      name: 'Northgate Pay',
      addr: 'no-reply@northgatepay.example',
      subj: 'Payout of 2,180.00 is on its way',
      body: 'Your monthly payout has left us and should land within two working days. Nothing is needed from you.',
      link: { text: 'https://northgatepay.example/payouts', href: 'https://northgatepay.example/payouts' },
      sig: [
        { f: 'body', t: 'Nothing is needed from you', note: 'There is no action here to hijack.' },
        { f: 'href', t: 'northgatepay.example', note: 'Matches the sender exactly.' }
      ],
      tell: 'Genuine. Good news, nothing to do, exact domain — there is nothing in this shape for an attacker to win.'
    },
    {
      cat: 'real', tier: 2, phish: false,
      name: 'Brightmoor Security',
      addr: 'security@brightmoor.example',
      subj: 'We have disabled your VPN access',
      body: 'Your VPN certificate expired overnight and access is off until it is reissued. Raise a ticket in the service portal, or come and find us on the second floor.',
      link: { text: 'https://brightmoor.example/servicedesk', href: 'https://brightmoor.example/servicedesk' },
      sig: [
        { f: 'body', t: 'come and find us on the second floor', note: 'An offline route to the same outcome. Attackers have none.' },
        { f: 'addr', t: 'security@brightmoor.example', note: 'Your own domain, unhyphenated and unextended.' }
      ],
      tell: 'Genuine. It takes something away from you and still offers a fix that involves clicking nothing at all.'
    },
    {
      cat: 'cred', tier: 2, phish: true,
      name: 'Ferrite Cloud',
      addr: 'no-reply@ferrite.example',
      subj: 'Storage upgrade complete',
      body: 'Your workspace now has two terabytes. Have a look at the new sharing defaults when you get a moment.',
      link: { text: 'https://ferrite.example/settings/sharing', href: 'https://198.51.100.23/ferrite/settings' },
      sig: [
        { f: 'href', t: '198.51.100.23', note: 'A bare address. No service this size hands one to a customer.' },
        { f: 'body', t: 'when you get a moment', note: 'No urgency anywhere. Tone was never the tell.' }
      ],
      tell: 'Calm, plausible, no deadline — and the link is a raw IP address. Only one of those four facts is checkable.'
    },
    {
      cat: 'inv', tier: 2, phish: true,
      name: 'Pallas Mutual',
      addr: 'renewals@pallasmutual.example',
      subj: 'Policy BM-3391 renewal — invoice attached',
      body: 'Your renewal comes to 4,900. Please pay through the portal below. Note that our payment reference has changed this year.',
      link: { text: 'https://pallasmutual.example/pay/BM-3391', href: 'https://pallasmutual.example.invoice-portal.example/pay' },
      sig: [
        { f: 'href', t: 'invoice-portal.example', note: 'The owned label, last as always, and not the insurer.' },
        { f: 'body', t: 'payment reference has changed', note: 'Anything that changes where money lands is worth a phone call.' }
      ],
      tell: 'pallasmutual.example is sitting on somebody else\'s name. The last two labels are the only part that says who owns it.'
    },

    /* ---- tier 3: the sender is right, or the domain is, or both ---- */
    {
      cat: 'real', tier: 3, phish: false,
      name: 'Halden Rail',
      addr: 'no-reply@e.haldenrail.example',
      subj: 'Action needed: your season ticket renews tomorrow',
      body: 'We will charge 412 to your saved card tomorrow morning. You can cancel or change it any time before then.',
      link: { text: 'https://haldenrail.example/season/manage', href: 'https://haldenrail.example/season/manage' },
      sig: [
        { f: 'addr', t: 'e.haldenrail.example', note: 'Bulk-mail subdomains like e. and mail. are ordinary and theirs.' },
        { f: 'body', t: 'cancel or change it any time', note: 'Three ways out, all of them yours.' }
      ],
      tell: 'Genuine. "Action needed", a deadline and a sum of money — every fear signal at once, and the domain is still their own.'
    },
    {
      cat: 'it', tier: 3, phish: true,
      name: 'Brightmoor Service Desk',
      addr: 'servicedesk@brightrnoor.example',
      subj: 'Scheduled maintenance: re-authenticate before 09:00',
      body: 'We are moving mailboxes tonight. Please sign in once through the link below so that your session carries over to the new server.',
      link: { text: 'https://brightmoor.example/reauth', href: 'https://brightrnoor.example/reauth' },
      sig: [
        { f: 'addr', t: 'brightrnoor.example', note: 'r n, not m. At this size they are the same shape.' },
        { f: 'href', t: 'brightrnoor.example', note: 'The visible text has the m. The destination does not.' }
      ],
      tell: 'A homoglyph. "rn" reads as "m" in nearly every typeface — widen the letters, or paste the domain somewhere you can read it slowly.'
    },
    {
      cat: 'mfa', tier: 3, phish: true,
      name: 'Orrery ID',
      addr: 'no-reply@orrery.example',
      subj: 'Your recovery phone number was changed',
      body: 'If you made this change, no action is needed. If you did not, secure the account now.',
      link: { text: 'https://orrery.example/security', href: 'https://orrery.example.id-recovery.example/security' },
      sig: [
        { f: 'href', t: 'id-recovery.example', note: 'The real owner, standing where it always stands: last.' },
        { f: 'body', t: 'no action is needed', note: 'It has copied the reassuring line the genuine ones use.' }
      ],
      tell: 'Everything about it copies a real notice, including the calm. The destination is the only part that could not be copied.'
    },
    {
      cat: 'real', tier: 3, phish: false,
      name: 'Quillon Sign',
      addr: 'bounce+8f21ab@notify.quillon.example',
      subj: 'Reminder: one document is waiting',
      body: 'Dinah Okafor is still waiting on your signature for the Stembridge agreement.',
      link: { text: 'https://quillon.example/d/8f21ab', href: 'https://quillon.example/d/8f21ab' },
      sig: [
        { f: 'addr', t: 'bounce+8f21ab', note: 'A machine-looking local part is ordinary bounce handling.' },
        { f: 'addr', t: 'notify.quillon.example', note: 'And the domain after the @ is still theirs.' }
      ],
      tell: 'Genuine. Whatever sits before the @ can be anything at all — it is not a domain, and it proves nothing in either direction.'
    },
    {
      cat: 'cred', tier: 3, phish: true,
      name: 'Ferrite Cloud',
      addr: 'no-reply@ferrite.example',
      subj: 'Your file "Q3 model.xlsx" was shared outside Brightmoor',
      body: 'Someone in your workspace shared a file with an address outside the company. Review the share below.',
      link: { text: 'https://ferrite.example/share/review', href: 'https://ferrite.example/r?to=ferrite-login.example/auth' },
      sig: [
        { f: 'href', t: 'r?to=ferrite-login.example', note: 'An open redirect: it starts at ferrite and does not stay.' },
        { f: 'subj', t: 'shared outside Brightmoor', note: 'A genuinely alarming event, chosen because it is.' }
      ],
      tell: 'The domain is right and the destination is not. A redirect parameter carries you off the brand after the very first hop.'
    },
    {
      cat: 'inv', tier: 3, phish: true,
      name: 'Dinah Okafor',
      addr: 'd.okafor@brightmoor.example',
      subj: 'RE: RE: Stembridge remittance — updated details',
      body: 'Sorry for the delay on this. Ignore the account on the last invoice, our finance team have moved us over. New details are in the sheet below.',
      link: { text: 'https://ferrite.example/s/remittance', href: 'https://ferrite-share.example/s/remittance' },
      sig: [
        { f: 'addr', t: 'd.okafor@brightmoor.example', note: 'Genuinely hers. A stolen mailbox passes every sender check.' },
        { f: 'href', t: 'ferrite-share.example', note: 'The one thing she did not send.' }
      ],
      tell: 'Thread hijack from a colleague\'s own account. Nothing about the sender is wrong — the bank change is what you verify, by voice, on a number you already had.'
    },
    {
      cat: 'pay', tier: 3, phish: true,
      name: 'Sam Achebe',
      addr: 's.achebe@brightmoor.example',
      subj: 'change of bank',
      body: 'Hi, I moved banks over the weekend. Could you update my details before the run closes on Wednesday? Happy to confirm anything you need over email.',
      link: null,
      sig: [
        { f: 'body', t: 'before the run closes', note: 'The deadline is the payroll cut-off, not an invented one.' },
        { f: 'body', t: 'confirm anything you need over email', note: 'Offering to prove it using the channel already in doubt.' }
      ],
      tell: 'Payroll diversion by hand: no branding, no link, no urgency you can point at. The control is a callback on the number in the directory.'
    },
    {
      cat: 'real', tier: 3, phish: false,
      name: 'Orrery ID',
      addr: 'security@orrery.example',
      subj: 'New sign-in from 192.0.2.19',
      body: 'A sign-in to Brightmoor was approved from an address we have not seen before. If that was not you, revoke the session.',
      link: { text: 'https://brightmoor.orrery.example/sessions', href: 'https://brightmoor.orrery.example/sessions' },
      sig: [
        { f: 'subj', t: '192.0.2.19', note: 'An IP in the text is information, not a warning sign.' },
        { f: 'href', t: 'brightmoor.orrery.example', note: 'An IP in the LINK would have been the problem. This is a name.' }
      ],
      tell: 'Genuine. Seeing an address is not itself a tell — where it appears is the entire question.'
    },
    {
      cat: 'call', tier: 3, phish: true,
      name: 'Brightmoor Service Desk',
      addr: 'servicedesk@brightmoor.example',
      subj: 'Ticket BM-88214 — we tried to reach you',
      body: 'Following up the ticket you raised this morning. Please call the engineer directly on 0808 157 0188; the main line is on a backlog today.',
      link: null,
      sig: [
        { f: 'body', t: 'the ticket you raised this morning', note: 'You raised none. A checkable detail is the cheapest test there is.' },
        { f: 'body', t: 'call the engineer directly', note: 'A number that routes around the desk that could confirm it.' }
      ],
      tell: 'A vishing setup, from your own domain. The forged From line costs nothing; the ticket you never opened is what gives it away.'
    },
    {
      cat: 'it', tier: 3, phish: true,
      name: 'Orrery ID',
      addr: 'no-reply@orrery.example',
      subj: 'Your authenticator was removed',
      body: 'The MFA device on your account was removed at 02:14. If this was not you, restore it below before your next sign-in.',
      link: { text: 'https://orrery.example/mfa/restore', href: 'https://orrery-id.example/mfa/restore' },
      sig: [
        { f: 'href', t: 'orrery-id.example', note: 'A hyphen makes a new domain. A dot would have made a subdomain.' },
        { f: 'body', t: 'removed at 02:14', note: 'A precise time is free to invent and reads as evidence.' }
      ],
      tell: 'orrery.example and orrery-id.example are two owners. This is the pair people mix up most, and the reason is that a hyphen looks like punctuation.'
    },
    {
      cat: 'real', tier: 3, phish: false,
      name: 'Vantage Trust Bank',
      addr: 'statements@vantagetrust.example',
      subj: 'Unusual activity on the account ending 8802',
      body: 'We stopped two payments this morning and have not blocked your card. Check them in the app, or ring the number printed on the card itself.',
      link: { text: 'https://vantagetrust.example/app', href: 'https://vantagetrust.example/app' },
      sig: [
        { f: 'body', t: 'the number printed on the card itself', note: 'It sends you to something it cannot forge.' },
        { f: 'body', t: 'have not blocked your card', note: 'It removes the panic instead of manufacturing it.' }
      ],
      tell: 'Genuine, and it is the exact inverse of the callback lure: that one steers you off the number on your card, this one steers you onto it.'
    },
    {
      cat: 'cred', tier: 3, phish: true,
      name: 'Ferrite Cloud',
      addr: 'no-reply@ferríte.example',
      subj: 'Session expired — sign in to carry on',
      body: 'You were signed out of your workspace a few minutes ago. Sign in again to pick up where you left off.',
      link: { text: 'https://ferríte.example/signin', href: 'https://xn--ferrte-hva.example/signin' },
      sig: [
        { f: 'href', t: 'xn--ferrte-hva', note: 'The punycode behind the pretty spelling. A different registration.' },
        { f: 'addr', t: 'ferríte.example', note: 'One accented character, invisible at reading speed.' }
      ],
      tell: 'An internationalised domain. It renders as the brand and resolves somewhere else; the punycode in the status bar is the only honest spelling of it.'
    },
    {
      cat: 'real', tier: 3, phish: false,
      name: 'Orrery ID',
      addr: 'no-reply@orrery.example',
      subj: 'Three sign-in requests were not approved',
      body: 'We stopped prompting after three attempts and locked the account for fifteen minutes. Nothing is needed unless you were the one signing in.',
      link: { text: 'https://brightmoor.orrery.example/activity', href: 'https://brightmoor.orrery.example/activity' },
      sig: [
        { f: 'body', t: 'We stopped prompting after three attempts', note: 'A rate limit. Only the real provider can impose one.' },
        { f: 'href', t: 'brightmoor.orrery.example', note: 'Your tenant on their domain, as always.' }
      ],
      tell: 'Genuine, and the counterpart of the flood: the provider has stopped asking. An attacker needs the asking to continue.'
    },
    {
      cat: 'real', tier: 3, phish: false,
      name: 'Stembridge Supplies',
      addr: 'accounts@stembridge.example',
      subj: 'Invoice SB-40119 — same details as always',
      body: 'March delivery, 2,140, payable within 30 days. Our bank details are unchanged and are printed on the invoice as usual.',
      link: { text: 'https://stembridge.example/invoices/40119', href: 'https://stembridge.example/invoices/40119' },
      sig: [
        { f: 'body', t: 'Our bank details are unchanged', note: 'The sentence the fraud depends on nobody ever writing.' },
        { f: 'addr', t: 'accounts@stembridge.example', note: 'The supplier\'s own domain, plainly.' }
      ],
      tell: 'Genuine. A supplier stating that nothing has moved is doing the one thing that makes the invoice fraud above harder to land.'
    }
  ];

  /* ==================================================================
     Text measuring and wrapping.
     ==================================================================
     Wrapping records the SOURCE INDEX each line starts and ends at, not
     just the string, and that is what makes the in-place highlighting
     possible: a signal is a substring of the whole body, it can straddle a
     line break, and boxing it means intersecting its character range with
     each line's range. Storing only the rendered strings would leave no way
     to tell "our bank" on line two from "our bank" on line four.

     It relies on every body being single-spaced, which is why the deck above
     has no double spaces in it — a line is then exactly src.slice(a, b).
     ================================================================== */
  function wrap(ctx, src, maxW) {
    var out = [];
    var n = src.length;
    var i = 0;
    var a = -1, b = -1;
    while (i < n) {
      while (i < n && src.charAt(i) === ' ') i++;
      if (i >= n) break;
      var j = i;
      while (j < n && src.charAt(j) !== ' ') j++;
      if (a < 0) { a = i; b = j; }
      else if (ctx.measureText(src.slice(a, j)).width <= maxW) { b = j; }
      else {
        out.push({ a: a, b: b, text: src.slice(a, b) });
        a = i; b = j;
      }
      i = j;
    }
    if (a >= 0) out.push({ a: a, b: b, text: src.slice(a, b) });
    return out;
  }

  /* Shrink a font until a single line fits, down to a floor. Used for the
     status bar, where a punycode destination is half as long again as the
     name it is standing in for and truncating it would hide the one thing
     the player is being asked to read. */
  function fitFont(ctx, text, maxW, from, floor, family) {
    var size = from;
    while (size > floor) {
      ctx.font = size + 'px ' + family;
      if (ctx.measureText(text).width <= maxW) return size;
      size -= 0.5;
    }
    ctx.font = floor + 'px ' + family;
    return floor;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  GameShell.define({
    id: 'game-phishing-inbox',
    slug: 'phishing-inbox',
    title: 'Phishing inbox',
    width: W,
    height: H,
    bestKey: 'phishing-inbox',
    formatBest: function (n) { return n + ' pts'; },
    /* Taps are handled on the canvas below, because a tap has two meanings
       here — inspect this link, or move on — and the shell's one-gesture
       version cannot tell them apart. */
    tapAction: false,
    startTitle: 'Eighteen messages, one clock',
    startText: 'Left arrow or S sorts a message as safe, right arrow or P as phishing. Hover a link, or press up, to see where it really goes. Every brand and domain in here is invented and nothing links anywhere.',

    setup: function (g) {
      /* Asked once, for the same reason boids and disco ask once: the setting
         belongs to the operating system and re-reading it per frame only lets
         it change under a run already in progress. */
      var reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      var deck = [];
      var at = 0;
      var right = 0;
      var streak = 0;
      var best = 0;             // longest streak this run, for the summary
      var answered = null;      // null while live; { ok, timeout } after a call
      var budget = 20;          // seconds this message was given
      var left = 20;            // seconds remaining on it
      var clockOn = true;
      var revealAll = false;
      var inspect = false;      // the status bar is showing the destination
      var hovering = false;
      var arrive = 1;           // 0..1, the card settling in
      var tally = {};

      /* Layout is recomputed only when the message or the reveal state
         changes, never per frame. Wrapping eighteen lines of text costs a
         measureText per word per candidate line, which is fine once and
         wasteful sixty times a second for a picture that has not moved. */
      var laid = null;
      var laidFor = -1;
      var laidReveal = false;

      /* Rolling mean of how long draw() takes. See the note where it is
         used: past the threshold the gradients go and the flat fills stay,
         which is a picture that looks slightly plainer rather than a game
         that stutters. */
      var cost = 0;
      var lite = false;

      var clockSel = document.getElementById('game-clock');
      var revealBtn = document.getElementById('game-reveal');

      /* ---------------------------------------------------------------
         The room.

         An inbox is not a sequence of events, it is a place you sit in, so
         the held layer is the room around it: ventilation, and the mains
         hum every office has under the ventilation. Both are steered by one
         value — how far the clock has run down — because that is the only
         thing about this game that continues rather than happens.

         The pressure opens the noise filter and lifts the hum rather than
         adding anything new. A second layer arriving at ten seconds would
         be an event, and events are what the one-shots are for.
         --------------------------------------------------------------- */
      var room = g.bed(function (a) {
        var ctx = a.ctx;

        var air = ctx.createBufferSource();
        air.buffer = a.noise();
        air.loop = true;
        var lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        /* 320 Hz is where broadband noise stops sounding like a hiss and
           starts sounding like a room. Higher and it is a tape machine;
           much lower and there is nothing left to hear at all. */
        lp.frequency.value = 320;
        lp.Q.value = 0.4;
        var airGain = ctx.createGain();
        /* Looks large beside the shell's 0.06 ceiling on a one-shot and is
           not: a lowpass at 320 throws away most of white noise's power, so
           this arrives as an rms in the low thousandths. */
        airGain.gain.value = 0.045;
        air.connect(lp);
        lp.connect(airGain);
        airGain.connect(a.out);
        air.start();

        /* Mains hum: 50 Hz and its third harmonic, which is the pair that
           survives a laptop speaker. A pure 50 Hz sine on its own is
           inaudible on almost every machine this page runs on, so the
           harmonic is doing the work and the fundamental is doing the
           character. */
        var humGain = ctx.createGain();
        humGain.gain.value = 0.010;
        humGain.connect(a.out);
        function hum(freq, level) {
          var osc = ctx.createOscillator();
          var gn = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gn.gain.value = level;
          osc.connect(gn);
          gn.connect(humGain);
          osc.start();
        }
        hum(50, 1);
        hum(150, 0.5);

        function ramp(param, value, secs) {
          var now = ctx.currentTime;
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(value, now + (secs == null ? 0.4 : secs));
        }

        return {
          set: function (key, value) {
            if (key !== 'pressure') return;
            var k = value < 0 ? 0 : (value > 1 ? 1 : value);
            /* Both ends move, and neither moves far. The room is meant to
               tighten under the reader rather than announce itself: a fifth
               of an octave on the filter and a doubling of a hum already at
               the edge of audible is felt and not heard, which is the only
               honest way to put pressure into a sound. */
            ramp(lp.frequency, 320 + k * 260);
            ramp(humGain.gain, 0.010 + k * 0.011);
          }
        };
      });

      /* ---------------------------------------------------------------
         Deck building.
         --------------------------------------------------------------- */
      function shuffleInto(list, out, take) {
        var pool = list.slice();
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        var n = take < pool.length ? take : pool.length;
        for (var k = 0; k < n; k++) out.push(pool[k]);
      }

      function build() {
        var tiers = [[], [], []];
        for (var i = 0; i < MSGS.length; i++) tiers[MSGS[i].tier - 1].push(i);
        deck = [];
        /* Shuffled inside each tier and never across them. That is the ramp:
           the order changes every run, the difficulty curve does not. */
        for (var t = 0; t < 3; t++) shuffleInto(tiers[t], deck, DRAW[t]);
      }

      function readClock() {
        var v = clockSel ? Number(clockSel.value) : 20;
        if (!(v >= 0)) v = 20;                 // catches NaN as well as junk
        clockOn = v > 0;
        return clockOn ? v : 0;
      }

      /* The budget shortens as the tiers do their work — twenty seconds on a
         message whose domain is wrong at a glance is generous, and twenty on
         a thread hijack is about right. Written as a fraction of the run
         rather than off the tier so that changing DRAW cannot silently make
         the last third free. */
      function budgetFor(index) {
        var base = readClock();
        if (!base) return 0;
        var through = deck.length > 1 ? index / (deck.length - 1) : 0;
        return base * (1 - 0.25 * through);
      }

      function msg() { return MSGS[deck[at]]; }

      function present() {
        answered = null;
        inspect = false;
        hovering = false;
        laidFor = -1;
        arrive = reduced ? 1 : 0;
        budget = budgetFor(at);
        left = budget;
        room.set('pressure', 0);
        g.stat('seen', at + '/' + deck.length);

        var m = msg();
        /* The canvas is a role="img" snapshot, so without this the entire
           game is silent to a screen reader. Everything a sighted player can
           see before answering is read out, including the link's destination
           — a reader cannot hover, and withholding it would make the game
           unplayable rather than merely harder.

           Not at boot, though. reset() runs once from the constructor to
           build the frame behind the Play overlay, and speaking a whole
           message into the live region at page load would talk over the
           heading a screen reader had only just started, for a run nobody
           has begun. Same reasoning the shell gives for not announcing its
           own start overlay — and the arrival chime below is on the far side
           of this return for the same reason, because a page that makes a
           noise before anyone has pressed anything is a page people close. */
        if (g.state !== 'playing') return;
        g.announce('Message ' + (at + 1) + ' of ' + deck.length + '. From ' +
          m.name + ', ' + m.addr + '. Subject: ' + m.subj + '. ' + m.body +
          (m.link ? ' Link reading ' + m.link.text + ', which goes to ' + m.link.href + '.'
                  : ' No link in this one.') +
          ' Left or S for safe, right or P for phishing.');

        /* Two notes a fifth apart, quietly. A mail client's arrival sound is
           the one noise in an office nobody resents, and it has to stay on
           the right side of that at eighteen repetitions a run. */
        g.pluck(784, 0.16, 0.030, 'sine');
        g.pluck(1175, 0.22, 0.022, 'sine');
      }

      function score(m) {
        var pts = BASE;
        /* Speed is only worth anything when there is a clock to beat. With
           the clock off the call still scores its base and its streak, which
           keeps the accessible setting playable without making it the
           cheapest way to a high score. */
        if (clockOn && budget > 0) pts += Math.round(SPEED_MAX * (left / budget));
        var bonus = (streak - 1) * STREAK_STEP;
        if (bonus > STREAK_MAX) bonus = STREAK_MAX;
        if (bonus > 0) pts += bonus;
        return pts;
      }

      function record(ok) {
        var m = msg();
        var row = tally[m.cat];
        row.seen++;
        if (ok) row.right++;
      }

      function call(saidPhish) {
        if (g.state !== 'playing' || answered) return;
        var m = msg();
        var ok = saidPhish === m.phish;
        record(ok);
        if (ok) {
          right++;
          streak++;
          if (streak > best) best = streak;
          g.addScore(score(m));
          g.beep(880, 0.06, 'sine', 0.05);
          /* Every fifth in a row gets a second note on top rather than a
             different sound. A streak is the same event continuing, and
             changing the instrument at five would read as a new kind of
             thing having happened. */
          if (streak % 5 === 0) g.pluck(1318, 0.30, 0.035, 'triangle');
        } else {
          streak = 0;
          g.beep(180, 0.11, 'square', 0.05);
        }
        answered = { ok: ok, timeout: false };
        g.stat('streak', streak);
        g.stat('seen', (at + 1) + '/' + deck.length);
        laidFor = -1;
        room.set('pressure', 0);
        g.announce((ok ? 'Correct. ' : 'Wrong. ') + 'This one is ' +
          (m.phish ? 'phishing' : 'genuine') + '. ' + m.tell +
          ' Press space for the next message.');
      }

      function ranOut() {
        record(false);
        streak = 0;
        answered = { ok: false, timeout: true };
        g.stat('streak', streak);
        g.stat('seen', (at + 1) + '/' + deck.length);
        laidFor = -1;
        room.set('pressure', 0);
        g.sweep(300, 110, 0.4);
        var m = msg();
        g.announce('Out of time. This one is ' + (m.phish ? 'phishing' : 'genuine') +
          '. ' + m.tell + ' Press space for the next message.');
      }

      function next() {
        if (!answered) return;
        at++;
        if (at >= deck.length) { finish(); return; }
        present();
      }

      function finish() {
        /* Which lure type actually caught this player. Only categories seen
           at least twice are eligible, because one wrong call out of one is
           noise and naming it as a weakness would be a lie dressed as a
           diagnosis. */
        var worstCat = null;
        var worstRow = null;
        var worstRate = 2;
        var i, row;
        for (i = 0; i < CATS.length; i++) {
          row = tally[CATS[i].k];
          if (row.seen < 2) continue;
          var rate = row.right / row.seen;
          if (rate < worstRate) { worstRate = rate; worstCat = CATS[i]; worstRow = row; }
        }

        var pct = Math.round((right / deck.length) * 100);
        var line;
        if (worstCat && worstRate < 1) {
          line = worstCat.k === 'real'
            ? 'The genuine messages caught you ' + (worstRow.seen - worstRow.right) +
              ' times. Flagging everything is not caution, it is a habit of ignoring real alerts.'
            : worstCat.label + ' was your weakest at ' + worstRow.right + ' of ' +
              worstRow.seen + '. That is the lure to read twice next time.';
        } else if (pct === 100) {
          line = 'Every one, in order, against a clock. Nothing left to tell you.';
        } else {
          line = 'Clean across every lure type. The subtle tier is where the next run gets you.';
        }

        g.over({
          won: pct >= 75,
          score: g.score,
          title: right + ' of ' + deck.length + ' called right',
          message: line + ' Longest streak: ' + best + '.'
        });
      }

      function toggleInspect() {
        if (!msg().link) return;
        inspect = !inspect;
        laidFor = -1;
        /* A soft click rather than a note. Hovering a link in a real client
           makes no sound at all, and this is the smallest thing that still
           confirms the key did something on a keyboard, where there is no
           pointer to see move. */
        g.noise(0.04, { type: 'highpass', freq: 3400, q: 0.7, level: 0.025 });
        if (inspect) g.announce('Link goes to ' + msg().link.href);
      }

      /* ---------------------------------------------------------------
         Controls.
         --------------------------------------------------------------- */
      if (clockSel) {
        clockSel.addEventListener('change', function () {
          readClock();
          /* Deliberately NOT applied to the message on screen. Shortening
             the budget under a player who is halfway through reading is the
             one change that would feel like the game cheating, and there is
             no reading of "time per message" that means "including this
             one". */
          g.announce(clockOn
            ? 'Clock set to ' + clockSel.value + ' seconds, from the next message.'
            : 'Clock off from the next message. Speed points go with it.');
        });
      }

      if (revealBtn) {
        revealBtn.addEventListener('click', function () {
          revealAll = !revealAll;
          revealBtn.setAttribute('aria-pressed', String(revealAll));
          revealBtn.title = revealAll
            ? 'Link targets are pinned open — click to hide them again'
            : 'Show every link destination without hovering';
          laidFor = -1;
          g.announce(revealAll
            ? 'Link targets pinned open on every message.'
            : 'Link targets hidden again. Hover or press up to see one.');
        });
      }

      /* S and P, bound on the document because the shell's KEYMAP is four
         arrows, Space, Enter and Escape and deliberately contains no letter
         at all — so hooks.key() is never called for one and a page promising
         "S or P" would be promising a control that does not exist.

         Scoped the way disco.js scopes its strobe key: only while a run is
         live, and only when focus is inside this game or nowhere in
         particular. The extra clause below it is the part disco does not
         need — this game has a <select> in its toolbar, and a focused select
         treats a letter as "jump to the option starting with it". Without
         the guard, choosing a clock speed with the keyboard would sort the
         message underneath. */
      document.addEventListener('keydown', function (event) {
        var k = event.key;
        if (k !== 's' && k !== 'S' && k !== 'p' && k !== 'P') return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (g.state !== 'playing') return;
        var el = document.activeElement;
        if (el && el !== document.body) {
          if (!g.el.contains(el)) return;
          var tag = (el.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
          if (el.isContentEditable) return;
        }
        event.preventDefault();
        call(k === 'p' || k === 'P');
      });

      /* The pointer. Hovering the link shows where it goes, which is the
         bargain a browser's status bar makes and the reason half this deck
         cannot be called for free. */
      if (g.canvas) {
        g.canvas.addEventListener('pointermove', function (event) {
          if (!laid || !laid.linkBox) { hovering = false; return; }
          var p = g.pointAt(event);
          var b = laid.linkBox;
          var over = p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
          if (over !== hovering) { hovering = over; laidFor = -1; }
        });
        g.canvas.addEventListener('pointerleave', function () {
          if (hovering) { hovering = false; laidFor = -1; }
        });

        /* Touch has no hover, so a tap on the link is the same gesture, and
           a tap anywhere else is "next" once there is a verdict to move on
           from. This is why tapAction is off in the spec above: the shell's
           version fires one command for the whole stage and could not tell
           the two apart. */
        g.canvas.addEventListener('pointerdown', function (event) {
          if (g.state !== 'playing') return;
          var p = g.pointAt(event);
          var b = laid && laid.linkBox;
          if (b && p.x >= b.x - 6 && p.x <= b.x + b.w + 6 &&
              p.y >= b.y - 6 && p.y <= b.y + b.h + 6) {
            if (!inspect) toggleInspect();
            return;
          }
          if (answered) next();
        });
      }

      /* ==============================================================
         Layout. Built once per message per state change, cached in `laid`.
         ============================================================== */
      var LINE = 19;
      var STATUS_LEAD = 'Goes to ';

      function layout(ctx) {
        var innerX = CARD_X + PAD;
        var innerW = CARD_W - PAD * 2;
        var m = msg();
        var L = {
          m: m,
          innerX: innerX,
          innerW: innerW,
          nameY: CARD_Y + 27,
          addrY: CARD_Y + 46,
          ruleY: CARD_Y + 58,
          subjY: CARD_Y + 82,
          body: null,
          bodyY: CARD_Y + 108,
          linkY: 0,
          linkBox: null,
          hrefShown: false,
          /* The status bar's geometry is settled HERE rather than inside the
             function that paints it, because two callers need it and they
             run in the wrong order: the numbered boxes are drawn under the
             text, so boxesFor() has to know where a destination sits before
             drawStatus() has put one there. The first version left both to
             work it out for themselves and the box for an href signal
             landed a couple of centimetres to the left of the domain it was
             supposed to be pointing at. */
          statusY: CARD_Y + CARD_H - 16,
          hrefX: 0,
          hrefSize: 11
        };

        ctx.font = '12.5px ' + UI;
        L.body = wrap(ctx, m.body, innerW);
        L.linkY = L.bodyY + L.body.length * LINE + 16;

        if (m.link) {
          ctx.font = '12.5px ' + MONO;
          var lw = ctx.measureText(m.link.text).width;
          L.linkBox = { x: innerX - 3, y: L.linkY - 13, w: lw + 6, h: 20 };

          ctx.font = '11px ' + UI;
          var leadW = ctx.measureText(STATUS_LEAD).width;
          L.hrefX = innerX + leadW;
          /* A punycode destination is half as long again as the name it is
             standing in for, so the line is shrunk to fit rather than cut.
             Truncating it would hide the single detail the message turns on,
             which is the one thing this status bar exists to show. */
          L.hrefSize = fitFont(ctx, m.link.href, innerW - leadW - 4, 11, 8.5, MONO);
        }
        L.hrefShown = !!(m.link && (revealAll || hovering || inspect || answered));
        return L;
      }

      function ensure(ctx) {
        if (laidFor === at && laid && laidReveal === revealAll) return;
        laid = layout(ctx);
        laidFor = at;
        laidReveal = revealAll;
      }

      /* ==============================================================
         Signal boxes.
         ==============================================================
         A signal is a substring of one field. For the single-line fields the
         box is a prefix measurement; for the body it is the intersection of
         the signal's character range with each wrapped line's range, which
         is what lets a boxed phrase break across two lines and still be one
         highlight rather than a rectangle over the gap between them.

         Returns the boxes rather than drawing them, because the numbered
         badge has to go on the LAST box of a signal and the caller is the
         only thing that knows how many signals came before this one.
         ------------------------------------------------------------------ */
      function boxesFor(ctx, L, sig) {
        var out = [];
        var m = L.m;
        var idx, pre, x, w;

        function single(text, font, x0, y, size) {
          idx = text.indexOf(sig.t);
          if (idx < 0) return;
          ctx.font = font;
          pre = ctx.measureText(text.slice(0, idx)).width;
          w = ctx.measureText(sig.t).width;
          out.push({ x: x0 + pre - 2, y: y - size + 1, w: w + 4, h: size + 5 });
        }

        if (sig.f === 'name') single(m.name, 'bold 14.5px ' + UI, L.innerX, L.nameY, 14.5);
        else if (sig.f === 'addr') single(m.addr, '11.5px ' + MONO, L.innerX, L.addrY, 11.5);
        else if (sig.f === 'subj') single(m.subj, 'bold 14px ' + UI, L.innerX, L.subjY, 14);
        else if (sig.f === 'link' && m.link) single(m.link.text, '12.5px ' + MONO, L.innerX, L.linkY, 12.5);
        else if (sig.f === 'href' && m.link) {
          single(m.link.href, L.hrefSize + 'px ' + MONO, L.hrefX, L.statusY, L.hrefSize);
        } else if (sig.f === 'body') {
          idx = m.body.indexOf(sig.t);
          if (idx < 0) return out;
          var a = idx, b = idx + sig.t.length;
          ctx.font = '12.5px ' + UI;
          for (var i = 0; i < L.body.length; i++) {
            var line = L.body[i];
            var s = a > line.a ? a : line.a;
            var e = b < line.b ? b : line.b;
            if (e <= s) continue;
            pre = ctx.measureText(line.text.slice(0, s - line.a)).width;
            w = ctx.measureText(line.text.slice(s - line.a, e - line.a)).width;
            out.push({
              x: L.innerX + pre - 2,
              y: L.bodyY + i * LINE - 11.5,
              w: w + 4,
              h: 17
            });
          }
        }
        return out;
      }

      /* ==============================================================
         Drawing.
         ============================================================== */
      var INK = '#e2e8f0';
      var DIM = '#94a3b8';
      var FAINT = '#64748b';
      var LINK = '#7dd3fc';
      var GOOD = '#4ade80';
      var BAD = '#f87171';
      var WARN = '#fbbf24';

      function drawChrome(ctx) {
        ctx.fillStyle = '#0b1120';
        ctx.fillRect(0, 0, W, TOP_H);
        ctx.fillStyle = INK;
        ctx.font = 'bold 13px ' + UI;
        ctx.fillText('Postbox', PAD, 24);
        ctx.fillStyle = FAINT;
        ctx.font = '12px ' + UI;
        ctx.fillText('Brightmoor Analytics — Inbox', PAD + 66, 24);

        ctx.textAlign = 'right';
        ctx.fillStyle = DIM;
        ctx.fillText((at + 1) + ' of ' + deck.length, W - PAD, 24);
        ctx.textAlign = 'left';

        /* The clock. A bar rather than a number, because a bar is read
           without being looked at, and colour steps at a third and a sixth
           of the budget rather than a pulse — there is no flashing anywhere
           in this file and there is no reason for the one element that
           reports pressure to be the exception. */
        ctx.fillStyle = 'rgba(148,163,184,0.14)';
        ctx.fillRect(0, TOP_H, W, BAR_H);
        if (clockOn && !answered) {
          var frac = budget > 0 ? left / budget : 0;
          if (frac < 0) frac = 0;
          ctx.fillStyle = frac > 0.33 ? '#38bdf8' : (frac > 0.16 ? WARN : BAD);
          ctx.fillRect(0, TOP_H, W * frac, BAR_H);
        } else if (!clockOn) {
          ctx.fillStyle = 'rgba(56,189,248,0.35)';
          ctx.fillRect(0, TOP_H, W, BAR_H);
        }
      }

      function drawCard(ctx, L) {
        var m = L.m;

        ctx.save();
        /* A fade, and deliberately NOT a slide. The first version slid the
           card up ten pixels as it arrived, which looked better and put the
           link's hit box ten pixels away from the link for the first fifth
           of a second — a hover that did nothing, on the one gesture this
           game is built around. Everything inside this card is measured in
           absolute coordinates, so the only motion it can safely have is one
           that does not move anything. */
        ctx.globalAlpha = reduced ? 1 : arrive;

        if (lite) {
          ctx.fillStyle = '#0d1626';
        } else {
          var grd = ctx.createLinearGradient(0, CARD_Y, 0, CARD_Y + CARD_H);
          grd.addColorStop(0, '#101b2e');
          grd.addColorStop(1, '#0a1220');
          ctx.fillStyle = grd;
        }
        roundRect(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 10);
        ctx.fill();
        ctx.strokeStyle = answered
          ? (answered.ok ? 'rgba(74,222,128,0.55)' : 'rgba(248,113,113,0.55)')
          : 'rgba(148,163,184,0.22)';
        ctx.lineWidth = 1;
        ctx.stroke();

        /* Signal boxes go UNDER the text, so a highlight never fights the
           thing it is highlighting for contrast. */
        /* Two colour systems, and they answer different questions on
           purpose: the CARD BORDER is amber-green by whether YOU were right,
           the BOXES are amber-green by what the message turned out to BE.
           Getting a genuine message wrong therefore gives a red border round
           green boxes, which is exactly the state of affairs — you were
           wrong, and every highlighted thing is a reason to trust it. */
        var badges = [];
        if (answered) {
          var tint = m.phish ? 'rgba(251,191,36,0.20)' : 'rgba(74,222,128,0.17)';
          var edge = m.phish ? 'rgba(251,191,36,0.75)' : 'rgba(74,222,128,0.7)';
          for (var s = 0; s < m.sig.length; s++) {
            var boxes = boxesFor(ctx, L, m.sig[s]);
            for (var bi = 0; bi < boxes.length; bi++) {
              var bx = boxes[bi];
              ctx.fillStyle = tint;
              roundRect(ctx, bx.x, bx.y, bx.w, bx.h, 3);
              ctx.fill();
              ctx.strokeStyle = edge;
              ctx.stroke();
            }
            if (boxes.length) {
              var lastBox = boxes[boxes.length - 1];
              badges.push({ x: lastBox.x + lastBox.w + 8, y: lastBox.y + lastBox.h - 4, n: s + 1, c: edge });
            }
          }
        }

        ctx.fillStyle = INK;
        ctx.font = 'bold 14.5px ' + UI;
        ctx.fillText(m.name, L.innerX, L.nameY);

        ctx.fillStyle = DIM;
        ctx.font = '11.5px ' + MONO;
        ctx.fillText(m.addr, L.innerX, L.addrY);

        ctx.strokeStyle = 'rgba(148,163,184,0.16)';
        ctx.beginPath();
        ctx.moveTo(L.innerX, L.ruleY + 0.5);
        ctx.lineTo(L.innerX + L.innerW, L.ruleY + 0.5);
        ctx.stroke();

        ctx.fillStyle = INK;
        ctx.font = 'bold 14px ' + UI;
        ctx.fillText(m.subj, L.innerX, L.subjY);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '12.5px ' + UI;
        for (var i = 0; i < L.body.length; i++) {
          ctx.fillText(L.body[i].text, L.innerX, L.bodyY + i * LINE);
        }

        if (m.link) {
          ctx.fillStyle = LINK;
          ctx.font = '12.5px ' + MONO;
          ctx.fillText(m.link.text, L.innerX, L.linkY);
          var lw = ctx.measureText(m.link.text).width;
          ctx.strokeStyle = 'rgba(125,211,252,0.6)';
          ctx.beginPath();
          ctx.moveTo(L.innerX, L.linkY + 3.5);
          ctx.lineTo(L.innerX + lw, L.linkY + 3.5);
          ctx.stroke();
        } else {
          ctx.fillStyle = FAINT;
          ctx.font = 'italic 12px ' + UI;
          ctx.fillText('No link in this one.', L.innerX, L.linkY);
        }

        for (var b2 = 0; b2 < badges.length; b2++) {
          var bd = badges[b2];
          ctx.fillStyle = bd.c;
          ctx.beginPath();
          ctx.arc(bd.x, bd.y - 4, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#020617';
          ctx.font = 'bold 9px ' + UI;
          ctx.textAlign = 'center';
          ctx.fillText(String(bd.n), bd.x, bd.y - 1);
          ctx.textAlign = 'left';
        }

        drawStatus(ctx, L);
        ctx.restore();
      }

      /* The status bar along the foot of the card, which is the browser's
         own affordance and the reason this game has a hover at all. It says
         where the link goes only once the player has paid for it, and it
         says so in full — a truncated punycode destination would hide the
         single character the whole message turns on. */
      function drawStatus(ctx, L) {
        var m = L.m;
        ctx.fillStyle = 'rgba(2,6,23,0.55)';
        roundRect(ctx, CARD_X + 1, L.statusY - 14, CARD_W - 2, 29, 8);
        ctx.fill();

        if (!m.link) {
          ctx.fillStyle = FAINT;
          ctx.font = '11px ' + UI;
          ctx.fillText('Nothing to hover. Some of the costliest attacks have no link at all.',
            L.innerX, L.statusY);
          return;
        }

        if (!L.hrefShown) {
          ctx.fillStyle = FAINT;
          ctx.font = '11px ' + UI;
          ctx.fillText('Hover the link, press up, or tap it — to see where it really goes.',
            L.innerX, L.statusY);
          return;
        }

        ctx.fillStyle = DIM;
        ctx.font = '11px ' + UI;
        ctx.fillText(STATUS_LEAD, L.innerX, L.statusY);

        /* One colour before the call and a verdict colour after it. An
           earlier version tinted a mismatched destination pink the moment it
           was revealed, which quietly did the reading for the player: the
           whole exercise is comparing two strings yourself, and a game that
           compares them for you has removed the exercise and left the
           clicking. */
        ctx.font = L.hrefSize + 'px ' + MONO;
        ctx.fillStyle = answered ? (m.phish ? WARN : GOOD) : LINK;
        ctx.fillText(m.link.href, L.hrefX, L.statusY);
      }

      /* The panel that answers "which lure type keeps getting me". Live
         throughout rather than kept for the end screen: a breakdown you only
         see once the run is over is a report card, and a breakdown sitting
         beside the message you are reading is a warning. */
      function drawSide(ctx) {
        var y = CARD_Y + 6;
        ctx.fillStyle = FAINT;
        ctx.font = '10px ' + UI;
        ctx.fillText('ACCURACY BY LURE', SIDE_X, y);
        y += 16;

        for (var i = 0; i < CATS.length; i++) {
          var c = CATS[i];
          var row = tally[c.k];
          var seen = row.seen;
          ctx.fillStyle = seen ? '#cbd5e1' : '#475569';
          ctx.font = '11.5px ' + UI;
          ctx.fillText(c.label, SIDE_X, y + 10);
          ctx.textAlign = 'right';
          ctx.fillStyle = seen ? (row.right === seen ? GOOD : (row.right * 2 >= seen ? WARN : BAD)) : '#475569';
          ctx.font = '11.5px ' + MONO;
          ctx.fillText(seen ? row.right + '/' + seen : '—', SIDE_X + SIDE_W, y + 10);
          ctx.textAlign = 'left';

          ctx.fillStyle = 'rgba(148,163,184,0.14)';
          ctx.fillRect(SIDE_X, y + 16, SIDE_W, 3);
          if (seen) {
            ctx.fillStyle = row.right === seen ? GOOD : (row.right * 2 >= seen ? WARN : BAD);
            ctx.fillRect(SIDE_X, y + 16, SIDE_W * (row.right / seen), 3);
          }
          y += 28;
        }

        if (!answered) return;

        y += 6;
        ctx.strokeStyle = 'rgba(148,163,184,0.16)';
        ctx.beginPath();
        ctx.moveTo(SIDE_X, y + 0.5);
        ctx.lineTo(SIDE_X + SIDE_W, y + 0.5);
        ctx.stroke();
        y += 18;

        var m = msg();
        ctx.fillStyle = FAINT;
        ctx.font = '10px ' + UI;
        ctx.fillText(m.phish ? 'WHAT GAVE IT AWAY' : 'WHY IT IS GENUINE', SIDE_X, y);
        y += 16;

        var edge = m.phish ? WARN : GOOD;
        for (var s = 0; s < m.sig.length; s++) {
          ctx.fillStyle = edge;
          ctx.beginPath();
          ctx.arc(SIDE_X + 6, y + 2, 6.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#020617';
          ctx.font = 'bold 9px ' + UI;
          ctx.textAlign = 'center';
          ctx.fillText(String(s + 1), SIDE_X + 6, y + 5);
          ctx.textAlign = 'left';

          ctx.fillStyle = '#cbd5e1';
          ctx.font = '11px ' + UI;
          var lines = wrap(ctx, m.sig[s].note, SIDE_W - 20);
          for (var i2 = 0; i2 < lines.length; i2++) {
            ctx.fillText(lines[i2].text, SIDE_X + 20, y + 6 + i2 * 15);
          }
          y += lines.length * 15 + 12;
        }
      }

      function drawBand(ctx) {
        ctx.fillStyle = lite ? '#0b1424' : 'rgba(15,23,42,0.72)';
        roundRect(ctx, PAD, BAND_Y, W - PAD * 2, BAND_H, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(148,163,184,0.18)';
        ctx.stroke();

        var x = PAD + 16;

        if (!answered) {
          ctx.fillStyle = INK;
          ctx.font = 'bold 14px ' + UI;
          ctx.fillText('Sort it.', x, BAND_Y + 28);

          ctx.font = '12.5px ' + UI;
          ctx.fillStyle = GOOD;
          ctx.fillText('◀  or  S', x, BAND_Y + 52);
          ctx.fillStyle = DIM;
          ctx.fillText('safe', x + 66, BAND_Y + 52);
          ctx.fillStyle = BAD;
          ctx.fillText('▶  or  P', x + 128, BAND_Y + 52);
          ctx.fillStyle = DIM;
          ctx.fillText('phishing', x + 194, BAND_Y + 52);

          ctx.textAlign = 'right';
          ctx.fillStyle = FAINT;
          ctx.font = '11.5px ' + UI;
          ctx.fillText(clockOn
            ? Math.ceil(left) + 's left — the clock is worth up to ' + SPEED_MAX + ' points'
            : 'No clock. Base and streak still score.', W - PAD - 16, BAND_Y + 52);
          ctx.fillStyle = streak >= 3 ? WARN : FAINT;
          ctx.fillText(streak >= 2 ? streak + ' in a row' : '', W - PAD - 16, BAND_Y + 28);
          ctx.textAlign = 'left';
          return;
        }

        var m = msg();
        var head = answered.timeout ? 'Out of time' : (answered.ok ? 'Correct' : 'Not that one');
        ctx.fillStyle = answered.ok ? GOOD : BAD;
        ctx.font = 'bold 14px ' + UI;
        ctx.fillText(head, x, BAND_Y + 26);
        var hw = ctx.measureText(head).width;

        ctx.fillStyle = DIM;
        ctx.font = '13px ' + UI;
        ctx.fillText('— this one is ' + (m.phish ? 'phishing' : 'genuine') + '.', x + hw + 8, BAND_Y + 26);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '12px ' + UI;
        var lines = wrap(ctx, m.tell, W - PAD * 2 - 32);
        for (var i = 0; i < lines.length && i < 2; i++) {
          ctx.fillText(lines[i].text, x, BAND_Y + 46 + i * 16);
        }

        ctx.textAlign = 'right';
        ctx.fillStyle = FAINT;
        ctx.font = '11.5px ' + UI;
        ctx.fillText(at + 1 >= deck.length ? 'Space for the result' : 'Space, or tap, for the next one',
          W - PAD - 16, BAND_Y + 26);
        ctx.textAlign = 'left';
      }

      return {
        reset: function () {
          build();
          at = 0;
          right = 0;
          streak = 0;
          best = 0;
          lite = false;
          cost = 0;
          readClock();
          tally = {};
          for (var i = 0; i < CATS.length; i++) tally[CATS[i].k] = { right: 0, seen: 0 };
          g.stat('streak', 0);
          present();
        },

        key: function (name) {
          if (g.state !== 'playing') return;
          if (name === 'left') { call(false); return; }
          if (name === 'right') { call(true); return; }
          /* Up and down both inspect. There is one thing to look at, and
             making the player remember which of two adjacent keys reveals it
             would be a puzzle about the game rather than about the mail. */
          if (name === 'up' || name === 'down') { toggleInspect(); return; }
          if (name === 'action' && answered) next();
        },

        update: function (dt) {
          if (arrive < 1) {
            arrive += dt * 6;
            if (arrive > 1) arrive = 1;
          }
          if (answered || !clockOn) return;

          left -= dt;
          /* Pressure is the fraction of the budget already spent, squared —
             so the room tightens late rather than steadily. A linear ramp
             starts moving the moment the message appears, which reads as the
             sound following the bar rather than as time running out. */
          var spent = budget > 0 ? 1 - left / budget : 0;
          room.set('pressure', spent * spent);

          /* One tick a second in the last five, through the shell's gate so
             a slow frame cannot double one up. Deliberately quiet and
             deliberately not accelerating: a ticking clock that speeds up is
             a horror-film device, and this one only has to be countable. */
          if (left <= 5 && left > 0 && g.gate('tick', 0.9)) {
            g.beep(1500, 0.03, 'sine', 0.022);
          }

          if (left <= 0) { left = 0; ranOut(); }
        },

        draw: function (ctx) {
          var t0 = (window.performance && window.performance.now)
            ? window.performance.now() : 0;

          ctx.fillStyle = '#020617';
          ctx.fillRect(0, 0, W, H);
          if (!lite) {
            /* A cold wash from the top, so the client chrome sits on
               something rather than floating on black. First thing dropped
               when the frame gets expensive: it is the only fill here that
               costs a gradient and the only one nobody would miss. */
            var bg = ctx.createLinearGradient(0, 0, 0, H);
            bg.addColorStop(0, 'rgba(56,189,248,0.05)');
            bg.addColorStop(1, 'rgba(2,6,23,0)');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, W, H);
          }

          ctx.textBaseline = 'alphabetic';
          drawChrome(ctx);

          ensure(ctx);
          drawCard(ctx, laid);
          drawSide(ctx);
          drawBand(ctx);

          if (t0) {
            var ms = window.performance.now() - t0;
            /* An exponential mean over roughly the last thirty frames. A
               single expensive frame — a font finally loading, a tab coming
               back — must not strip the page's decoration permanently, and
               a mean this slow needs about half a second of genuinely bad
               frames before it crosses. Six milliseconds is the threshold
               because a 60 Hz budget is sixteen and this is one of several
               things sharing it. */
            cost += (ms - cost) * 0.07;
            if (!lite && cost > 6) lite = true;
            else if (lite && cost < 3.5) lite = false;
          }
        }
      };
    }
  });
})();

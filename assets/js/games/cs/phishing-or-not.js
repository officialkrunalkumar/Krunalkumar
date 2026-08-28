/* ==========================================================================
   phishing-or-not.js — twenty specimens, real or fake, and why.
   --------------------------------------------------------------------------
   The hard part of building this is not the phishing examples. It is the
   LEGITIMATE ones. A quiz where every genuine message is obviously genuine
   teaches "be suspicious", which people already are, and leaves them unable
   to say what they were suspicious of.

   So half the specimens here are real messages that contain the things
   people are told to fear: urgency, a link, a request to act. And several of
   the fakes contain none of those and are still fake. The only reliable
   signal is the one the explanations keep returning to — where the link
   actually goes, and whether the domain is one the sender could own.

   Every answer gets its reason immediately, right or wrong, because a quiz
   that only scores you teaches nothing.
   ========================================================================== */

(function () {
  'use strict';

  /* phish: true if it is an attack. `tell` is the thing that settles it. */
  var ITEMS = [
    {
      kind: 'email',
      from: 'security@paypal-account-verify.com',
      subject: 'Unusual sign-in blocked',
      body: 'We blocked a sign-in from a new device. If this was not you, confirm your identity within 24 hours or your account will be limited.',
      link: 'https://paypal-account-verify.com/secure/login',
      phish: true,
      tell: 'The domain is <code>paypal-account-verify.com</code>. That is not PayPal — it is somebody who registered a name with "paypal" in it, which anybody can do for a few pounds. The brand name before the last dot is what counts, and here the real domain is <code>paypal-account-verify</code>.'
    },
    {
      kind: 'email',
      from: 'no-reply@github.com',
      subject: 'A new SSH key was added to your account',
      body: 'A key with fingerprint SHA256:9dL... was added. If you did not add it, revoke it in your settings.',
      link: 'https://github.com/settings/keys',
      phish: false,
      tell: 'Genuine. It has urgency and a link, which is exactly why "urgency plus link equals phishing" is bad advice &mdash; real security notices are urgent by nature. The domain is <code>github.com</code> with nothing appended, and it tells you where to go rather than sending you there.'
    },
    {
      kind: 'sms',
      from: '+44 7700 900461',
      subject: 'Royal Mail',
      body: 'Your parcel is held. A £2.99 fee is due. Reschedule delivery:',
      link: 'https://royalmail-redelivery.info/pay',
      phish: true,
      tell: 'A tiny fee is the giveaway: it is small enough that people pay without thinking, and the point is your card details, not the £2.99. Royal Mail does not use <code>.info</code> domains, and no courier asks for card details by text.'
    },
    {
      kind: 'email',
      from: 'accounts@hdfcbank.net',
      subject: 'KYC update required',
      body: 'As per RBI guidelines your KYC is pending. Update today to avoid account suspension.',
      link: 'https://hdfcbank.net/kyc',
      phish: true,
      tell: 'HDFC Bank is <code>hdfcbank.com</code>. The <code>.net</code> is a different registration entirely and belongs to whoever bought it. Invoking a regulator is a standard pressure tactic &mdash; banks do not suspend accounts by email link.'
    },
    {
      kind: 'email',
      from: 'noreply@notifications.google.com',
      subject: 'Security alert: new device signed in',
      body: 'Your Google Account was signed in on a Windows device. If this was you, no action is needed.',
      link: 'https://myaccount.google.com/notifications',
      phish: false,
      tell: 'Genuine. <code>notifications.google.com</code> is a subdomain of <code>google.com</code> &mdash; read domains right-to-left, and the part immediately before the final <code>.com</code> is the one that is owned. And it explicitly says no action is needed, which an attacker never says.'
    },
    {
      kind: 'email',
      from: 'hr@yourcompany-payroll.com',
      subject: 'Updated salary structure — action required',
      body: 'Please review the revised salary bands and confirm your bank details on the portal before Friday.',
      link: 'https://yourcompany-payroll.com/login',
      phish: true,
      tell: 'Payroll diversion. It works because the subject is something you genuinely want to read. Your employer\'s HR does not live on a hyphenated look-alike domain, and no legitimate payroll process asks you to re-enter bank details from an email link.'
    },
    {
      kind: 'email',
      from: 'billing@amazon.co.uk',
      subject: 'Your order has shipped',
      body: 'Order 205-4471820-9931 is on its way. Track it in Your Orders.',
      link: 'https://www.amazon.co.uk/gp/your-account/order-history',
      phish: false,
      tell: 'Genuine, and deliberately dull. Most real mail is dull &mdash; it does not threaten you, does not rush you, and points at a page you could have reached yourself by typing the address.'
    },
    {
      kind: 'sms',
      from: 'VM-SBIINB',
      subject: 'Bank',
      body: 'Dear customer, your account will be blocked today. Update PAN immediately:',
      link: 'http://sbi-kyc-update.xyz',
      phish: true,
      tell: 'A plain <code>http://</code> link, a <code>.xyz</code> domain and a same-day threat. Also: a sender ID like <code>VM-SBIINB</code> can be spoofed trivially, so the name in the "from" field proves nothing at all.'
    },
    {
      kind: 'email',
      from: 'support@microsoft.com',
      subject: 'Your subscription will renew on 4 March',
      body: 'Microsoft 365 Family renews automatically. Manage or cancel your subscription any time.',
      link: 'https://account.microsoft.com/services',
      phish: false,
      tell: 'Genuine. Note that it gives you a way OUT &mdash; cancel any time. Attacks push you toward one action; real notices usually offer several, including doing nothing.'
    },
    {
      kind: 'email',
      from: 'ceo@gmai1.com',
      subject: 'Quick favour',
      body: 'Are you at your desk? I need you to arrange a transfer for a supplier before the end of day. Keep it between us for now.',
      link: null,
      phish: true,
      tell: 'Business email compromise, and there is no link to inspect at all &mdash; which is why "hover the link" is not a complete defence. The domain is <code>gmai1.com</code>, with the digit one. Secrecy plus urgency plus money is the pattern; the technology barely matters.'
    },
    {
      kind: 'email',
      from: 'noreply@linkedin.com',
      subject: 'You appeared in 9 searches this week',
      body: 'See who is looking at your profile.',
      link: 'https://www.linkedin.com/feed/',
      phish: false,
      tell: 'Genuine, and harmless engagement bait. Real marketing mail looks like this: low stakes, no threat, and a domain that matches the brand exactly.'
    },
    {
      kind: 'email',
      from: 'it-helpdesk@company.com',
      subject: 'Mailbox storage full — 98%',
      body: 'Your mailbox is nearly full. Click below to increase your quota, or incoming mail will bounce.',
      link: 'https://company.com.mailquota-support.net/increase',
      phish: true,
      tell: 'Look carefully: the domain is <code>mailquota-support.net</code>, and <code>company.com</code> is only a SUBDOMAIN sitting in front of it. Everything before the last two labels is attacker-controlled. This is the single most effective disguise there is.'
    },
    {
      kind: 'sms',
      from: '+91 98765 43210',
      subject: 'Unknown',
      body: 'Hi Mum, this is my new number, my old phone broke. Can you message me on WhatsApp?',
      link: null,
      phish: true,
      tell: 'The "hi mum" scam. No link, no technology, no urgency in the first message &mdash; that comes two messages later, after you have accepted who they are. The defence is to ring the old number.'
    },
    {
      kind: 'email',
      from: 'security@apple.com',
      subject: 'Your Apple ID was used to sign in to iCloud on a new iPhone',
      body: 'If you recently signed in, you can ignore this message.',
      link: 'https://appleid.apple.com',
      phish: false,
      tell: 'Genuine. <code>appleid.apple.com</code> is a subdomain of <code>apple.com</code>. And again the tell is what is missing: no deadline, no threat, and permission to ignore it.'
    },
    {
      kind: 'email',
      from: 'dhl-express@delivery-notice.co',
      subject: 'Customs duty unpaid — shipment on hold',
      body: 'Pay ₹342 customs charge to release your shipment. Failure to pay within 48 hours will return the item.',
      link: 'https://delivery-notice.co/dhl/pay',
      phish: true,
      tell: 'The brand is in the sender NAME, not the domain &mdash; the actual domain is <code>delivery-notice.co</code>. Small fee, tight deadline, card form at the end. Couriers bill the sender, not you by email.'
    },
    {
      kind: 'email',
      from: 'no-reply@stripe.com',
      subject: 'Payout of £1,240.00 sent',
      body: 'Your payout is on its way and should arrive in 1–2 business days.',
      link: 'https://dashboard.stripe.com/payouts',
      phish: false,
      tell: 'Genuine. Good news, no action, exact domain. Attackers rarely send good news with nothing to click, because there is nothing in it for them.'
    },
    {
      kind: 'email',
      from: 'admin@company.com',
      subject: 'Password expires today',
      body: 'Your network password expires in 4 hours. Reset it now to avoid being locked out.',
      link: 'https://company.okta.com/signin',
      phish: false,
      tell: 'Genuine, and it is the one most people call fake. It has a deadline and a password link, but <code>okta.com</code> is a real identity provider and <code>company.okta.com</code> is that company\'s tenant on it. Suspicion alone would have you fail this one.'
    },
    {
      kind: 'email',
      from: 'service@paypal.com',
      subject: 'You sent a payment of $499.99 to CryptoDeals Ltd',
      body: 'If you did not authorise this, call us immediately on +1 888 555 0142.',
      link: null,
      phish: true,
      tell: 'A refund scam, and the payload is the PHONE NUMBER. The domain is genuine because the message was sent through a real service, and there is no malicious link to find &mdash; ringing that number puts you through to the attacker. Always use the number on your card.'
    },
    {
      kind: 'email',
      from: 'noreply@google.com',
      subject: 'Someone has your password',
      body: 'Sign-in attempt was blocked. Your password may be compromised. Change it now.',
      link: 'https://accounts.google.com/signin/recovery',
      phish: false,
      tell: 'Genuine, and alarming on purpose. <code>accounts.google.com</code> is correct. The safest habit either way: do not click, open the site yourself, and check the security page &mdash; which reaches the same place.'
    },
    {
      kind: 'sms',
      from: 'AX-ICICIB',
      subject: 'Bank',
      body: 'Rs 45,000 debited from your a/c XX4471. If not you, click to reverse:',
      link: 'https://icici-reversal.duckdns.org',
      phish: true,
      tell: 'Panic plus a large number. <code>duckdns.org</code> is a free dynamic-DNS service &mdash; anybody can have a subdomain of it in seconds. No bank has ever hosted anything on one.'
    }
  ];

  GameShell.define({
    id: 'game-phishing-or-not',
    slug: 'phishing-or-not',
    title: 'Phishing or not',
    bestKey: 'phishing-or-not',
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      var order = [];
      var at = 0;
      var right = 0;
      var wrong = 0;
      var host = g.board;
      var answered = false;

      function shuffle() {
        order = [];
        for (var i = 0; i < ITEMS.length; i++) order.push(i);
        for (var s = order.length - 1; s > 0; s--) {
          var j = Math.floor(Math.random() * (s + 1));
          var t = order[s]; order[s] = order[j]; order[j] = t;
        }
      }

      function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function render() {
        if (at >= order.length) { finish(); return; }
        var it = ITEMS[order[at]];
        answered = false;

        var head = it.kind === 'sms'
          ? '<div class="phish-head"><span class="phish-kind">Text message</span><span class="phish-from">' + esc(it.from) + '</span></div>'
          : '<div class="phish-head"><span class="phish-kind">Email</span><span class="phish-from">' + esc(it.from) + '</span></div>';

        var subject = it.kind === 'sms' ? '' : '<p class="phish-subject">' + esc(it.subject) + '</p>';
        var link = it.link
          ? '<p class="phish-link">Link goes to: <code>' + esc(it.link) + '</code></p>'
          : '<p class="phish-link phish-nolink">No link in this one.</p>';

        host.className = 'game-board board-phish';
        host.innerHTML =
          '<div class="phish-card">' + head + subject +
          '<p class="phish-body">' + esc(it.body) + '</p>' + link + '</div>' +
          '<div class="phish-actions">' +
          '  <button class="game-btn phish-legit" type="button" id="phish-legit">Legitimate</button>' +
          '  <button class="game-btn phish-bad" type="button" id="phish-phish">Phishing</button>' +
          '</div>' +
          '<div class="phish-verdict" id="phish-verdict" hidden></div>';

        host.querySelector('#phish-legit').addEventListener('click', function () { answer(false); });
        host.querySelector('#phish-phish').addEventListener('click', function () { answer(true); });

        g.stat('seen', at + '/' + order.length);
        g.stat('right', right);
      }

      function answer(saidPhish) {
        if (answered) return;
        answered = true;
        var it = ITEMS[order[at]];
        var ok = saidPhish === it.phish;
        if (ok) { right++; g.beep(760, 0.06, 'sine'); g.addScore(10); }
        else { wrong++; g.beep(200, 0.09, 'square'); }
        g.stat('right', right);

        var v = host.querySelector('#phish-verdict');
        v.hidden = false;
        v.className = 'phish-verdict ' + (ok ? 'is-right' : 'is-wrong');
        v.innerHTML =
          '<p class="phish-call">' + (ok ? 'Correct' : 'Not quite') + ' &mdash; this one is <strong>' +
          (it.phish ? 'phishing' : 'legitimate') + '</strong>.</p>' +
          '<p class="phish-why">' + it.tell + '</p>' +
          '<button class="btn btn-primary" type="button" id="phish-next">Next</button>';
        v.querySelector('#phish-next').addEventListener('click', function () { at++; render(); });
        try { v.querySelector('#phish-next').focus({ preventScroll: true }); } catch (e) {}
      }

      function finish() {
        var pct = Math.round((right / order.length) * 100);
        g.over({
          won: pct >= 70,
          score: right,
          title: right + ' of ' + order.length,
          message: pct >= 90 ? 'You are reading the domain, not the tone. That is the whole skill.'
                 : pct >= 70 ? 'Solid. The ones people miss are usually the genuine messages that look alarming.'
                 : 'Worth another go — and notice how many of the fakes had no link at all to inspect.'
        });
      }

      return {
        reset: function () {
          shuffle();
          at = 0; right = 0; wrong = 0;
          g.setScore(0);
          render();
        }
      };
    }
  });
})();

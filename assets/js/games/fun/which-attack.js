/* ==========================================================================
   which-attack.js — which cyberattack are you. It is a joke with homework.
   --------------------------------------------------------------------------
   TWO DECISIONS WORTH EXPLAINING.

   Phishing and social engineering deliberately score each other. Every other
   pair of results here is disjoint, but phishing IS social engineering — the
   subset that arrives in writing — and a quiz that treats them as rivals
   teaches a taxonomy that would fall apart the first time somebody read a
   real incident report. So four options award a point to both.

   The tie-break is a fixed order, never random. Two people who answer
   identically must get the same attack, and so must the same person on a
   second run — a joke that changes its mind on reload stops being funny and
   starts looking broken. ATTACKS is that order.

   The questions are nonsense. The paragraph under each result is not: every
   one of them says how the attack actually works and what actually stops it,
   because that is the only part of this page anybody should keep.
   ========================================================================== */

(function () {
  'use strict';

  /* Also the tie-break order. See the header. */
  var ATTACKS = ['phish', 'social', 'brute', 'ddos', 'ransom', 'mitm', 'sqli', 'xss'];

  /* Bar labels and the runner-up mention. Kept apart from TITLES because the
     headline needs an article ("you are A DDoS") and a 7rem bar label has no
     room for one. */
  var NAMES = {
    phish: 'Phishing',
    social: 'Social engineering',
    brute: 'Brute force',
    ddos: 'DDoS',
    ransom: 'Ransomware',
    mitm: 'Man-in-the-middle',
    sqli: 'SQL injection',
    xss: 'Cross-site scripting'
  };

  var TITLES = {
    phish: 'You are phishing',
    social: 'You are social engineering',
    brute: 'You are a brute-force attack',
    ddos: 'You are a DDoS',
    ransom: 'You are ransomware',
    mitm: 'You are a man-in-the-middle',
    sqli: 'You are SQL injection',
    xss: 'You are cross-site scripting'
  };

  /* Short labels for the bars — one clause each, no room for more. */
  var BLURBS = {
    phish: 'a convincing message',
    social: 'the person, not the machine',
    brute: 'guessing, industrially',
    ddos: 'volume as a weapon',
    ransom: 'your files, held to a deadline',
    mitm: 'quietly in the middle',
    sqli: 'input read as instructions',
    xss: 'somebody else’s browser'
  };

  /* The joke, then the mechanism, then the defence. The last two are the
     part that has to be right. */
  var RESULTS = {
    phish: {
      line: 'You are patient, specific, and you write a lovely email.',
      joke: 'You do not break in. You are let in, by somebody who read your message and believed it, ' +
        'and you spent longer on the wording than they did on the reading.',
      fact: 'Phishing impersonates a sender the target already trusts so that the target does the ' +
        'damaging thing themselves &mdash; typing a password into a copy of a login page, or paying an ' +
        'invoice that was never owed. The reliable check is where the link actually goes: read the domain ' +
        'right to left, and the two labels before the final slash are the ones somebody had to buy. ' +
        'Passkeys and hardware security keys are the strongest defence, because they refuse to hand a ' +
        'credential to a site with the wrong domain even when the person has already been fooled.'
    },
    social: {
      line: 'You are charming, and that is the whole exploit.',
      joke: 'No malware, no code, no domain to inspect. Just a plausible person with a reason to be there ' +
        'and a deadline they invented on the walk over.',
      fact: 'Social engineering attacks the human process rather than the system: urgency, authority and ' +
        'familiarity, applied until somebody skips the step that would have caught it. Most of it is a ' +
        'phone call, and caller ID is trivially spoofed, so the defence is out-of-band verification &mdash; ' +
        'hang up and ring the number you already had, not the one you were just given. Anything that moves ' +
        'money or resets access should need a second person who was not part of the original conversation.'
    },
    brute: {
      line: 'You have no imagination and it has never once held you back.',
      joke: 'You will try everything. You will try it in alphabetical order. You have nowhere else to be ' +
        'and the electricity is not in your name.',
      fact: 'A brute-force attack simply guesses credentials until one works, and in practice most of what ' +
        'gets labelled brute force is credential stuffing: replaying username and password pairs leaked ' +
        'from some other breach, which works because people reuse them. Length beats complexity, so a long ' +
        'unique passphrase from a password manager is worth more than punctuation. Server-side, the ' +
        'defences are rate limiting, multi-factor authentication, and storing passwords with a slow hash ' +
        'such as bcrypt or Argon2 so a stolen database cannot be cracked at speed.'
    },
    ddos: {
      line: 'You are not subtle and you have never wanted to be.',
      joke: 'You bring everyone. You bring everyone again. You are the reason the queue outside is longer ' +
        'than the room.',
      fact: 'A distributed denial of service floods a target from many machines at once &mdash; usually a ' +
        'botnet of compromised devices &mdash; until legitimate requests cannot get served. Nothing is ' +
        'stolen and nothing is decrypted; the damage is purely to availability, which is why it is the one ' +
        'attack a business feels within minutes. It is absorbed rather than blocked: capacity spread across ' +
        'many locations, upstream scrubbing at the network provider, caching, and rate limits applied ' +
        'before the traffic ever reaches the application.'
    },
    ransom: {
      line: 'You take the whole thing hostage and then you send a countdown.',
      joke: 'Everything still exists. You have simply made it unreadable, priced the key, and set a clock ' +
        'that only you can see.',
      fact: 'Ransomware encrypts a victim’s files and sells back the key, and modern crews steal a copy ' +
        'first so they can also threaten to publish &mdash; which is why paying does not reliably end it. ' +
        'The actual countermeasure is backups that are offline or immutable and that somebody has genuinely ' +
        'restored from, because an untested backup is a belief rather than a plan. The way in is almost ' +
        'always mundane: an unpatched internet-facing service, or remote access with no multi-factor on it.'
    },
    mitm: {
      line: 'You never say anything yourself. You just carry it, slightly changed.',
      joke: 'Both of them think they are talking to each other. Both of them are right about half of it.',
      fact: 'A man-in-the-middle attacker sits in the network path and relays traffic, reading or altering ' +
        'it in transit &mdash; through a rogue wireless access point, ARP spoofing on a local network, or ' +
        'DNS answers that point somewhere else. Properly validated TLS defeats it, because the attacker ' +
        'cannot present a certificate for a domain they do not control. That is why clicking through a ' +
        'certificate warning is the one browser prompt that genuinely matters, and why HSTS exists: it ' +
        'stops the connection being quietly downgraded to plain HTTP in the first place.'
    },
    sqli: {
      line: 'You are pedantic about punctuation and it has made you dangerous.',
      joke: 'You were asked for a name. You gave a name, a closing quote, and a second opinion about what ' +
        'the rest of the sentence should say.',
      fact: 'SQL injection happens when user input is glued into a database query as text, so a quotation ' +
        'mark ends the value and everything after it is read as instructions rather than data. The fix is ' +
        'parameterised queries, also called prepared statements: the query structure is sent once and the ' +
        'values travel separately, so no input can ever become syntax. Filtering rude words is not a fix ' +
        'and never was. A database account with only the permissions it needs limits what a missed case ' +
        'can reach.'
    },
    xss: {
      line: 'You leave things behind for other people to find.',
      joke: 'You never attack anybody directly. You just write something down where somebody else will read ' +
        'it, and let their own browser do the rest.',
      fact: 'Cross-site scripting puts an attacker’s script into a page so that it runs in another ' +
        'visitor’s browser with that site’s privileges &mdash; stored in a comment, or reflected ' +
        'back out of a URL. From there it can read whatever that page can read, which is usually the ' +
        'session. The defence is escaping output for the context it lands in rather than sanitising input, ' +
        'a Content-Security-Policy that refuses to run injected script, and HttpOnly cookies so a stolen ' +
        'script cannot read the session token even if it does run.'
    }
  };

  /* [label, primary key, optional secondary key]. Primary scores 3, the
     secondary 1, and the only secondaries in the file are the phishing and
     social-engineering pairings explained in the header. */
  var Q = [
    ['You are not on the guest list. How do you get into the party?', [
      ['Tell the door I am with the caterers and look busy.', 'social'],
      ['Turn up with four hundred friends until the door stops working.', 'ddos'],
      ['Try every side door in the building, twice, all night.', 'brute'],
      ['Text the host from a number that looks like their sister’s.', 'phish', 'social']
    ]],
    ['A form asks for your name. You type…', [
      ['Robert\'); DROP TABLE students;--', 'sqli'],
      ['<script>alert(\'hello\')</script>', 'xss'],
      ['aaaa, then aaab, then aaac, until something gives.', 'brute'],
      ['The name of somebody the staff already trust.', 'social', 'phish']
    ]],
    ['How patient are you?', [
      ['None whatsoever. Volume is a strategy.', 'ddos'],
      ['Endless, as long as a machine is doing the waiting.', 'brute'],
      ['Patient enough to sit in the middle and just listen.', 'mitm'],
      ['Patient enough to rewrite one email fourteen times.', 'phish']
    ]],
    ['Two people are having a conversation. You…', [
      ['carry the messages between them, editing lightly', 'mitm'],
      ['talk over both of them until neither can hear anything', 'ddos'],
      ['join in as somebody they both vaguely remember', 'social'],
      ['keep a copy for later, when it will be worth more', 'ransom']
    ]],
    ['Your ideal Friday night?', [
      ['Locking every door in the house and leaving a note about the price of the keys.', 'ransom'],
      ['Reading somebody else’s post before they get to it.', 'mitm'],
      ['Writing one very convincing message to one very specific person.', 'phish'],
      ['Filling in one form field very carefully to see what falls out of the database.', 'sqli']
    ]],
    ['What is your relationship with rules?', [
      ['Rules are just input. Input can be escaped.', 'sqli'],
      ['Rules are for people who get asked. Nobody asks me.', 'social'],
      ['I obey every rule in turn until one of them lets me through.', 'brute'],
      ['I put my own note in the suggestion box and let the staff read it out.', 'xss']
    ]],
    ['A locked room. Go.', [
      ['Ten million keys and a long weekend.', 'brute'],
      ['Convince the keyholder that I am the fire inspector.', 'social'],
      ['Swap their key for one of mine while they are at lunch.', 'mitm'],
      ['Send them a photo of a door that looks exactly like theirs.', 'phish']
    ]],
    ['Somebody asks you for advice. You give them…', [
      ['something that runs quietly in their head next time they talk to someone else', 'xss'],
      ['a deadline and a number', 'ransom'],
      ['exactly what they wanted to hear, in their manager’s voice', 'phish', 'social'],
      ['so much advice that they stop being able to hear any of it', 'ddos']
    ]],
    ['How do you feel about crowds?', [
      ['The bigger the better. Rent one if you have to.', 'ddos'],
      ['I prefer one person, chosen carefully.', 'phish'],
      ['I like being the quiet one nobody counts, standing between two others.', 'mitm'],
      ['I like leaving something behind for the crowd to find.', 'xss']
    ]],
    ['Money. Discuss.', [
      ['I want it, and I want a deadline attached to it.', 'ransom'],
      ['I want you to type your card details in yourself.', 'phish'],
      ['I want the entire customer table, please.', 'sqli'],
      ['I want your session cookie. The money comes later.', 'xss']
    ]],
    ['Your greatest strength?', [
      ['Patience, and a large electricity bill.', 'brute'],
      ['Charm, mostly.', 'social'],
      ['Being in the middle of things.', 'mitm'],
      ['Getting other people to say it for me.', 'xss']
    ]],
    ['Somebody calls your bluff.', [
      ['I try a slightly different bluff. Then eight million more.', 'brute'],
      ['I apologise, hang up, and ring the next name on the list.', 'social'],
      ['I already have a copy of the files. Shall we start there?', 'ransom'],
      ['I ask the same question again with a quotation mark in it.', 'sqli']
    ]],
    ['You find a comments box on a website. Naturally you…', [
      ['leave something that runs when the next visitor reads it', 'xss'],
      ['close the quote and see what the database has to say', 'sqli'],
      ['leave a link that looks like the site’s own login page', 'phish'],
      ['post the same comment two hundred thousand times a second', 'ddos']
    ]],
    ['What breaks first when you walk into a room?', [
      ['Everybody’s Monday. And most of their weekend.', 'ransom'],
      ['The database.', 'sqli'],
      ['Somebody’s trust in somebody else.', 'social', 'phish'],
      ['The connection between two people who thought they were alone.', 'mitm']
    ]]
  ];

  var questions = [];
  for (var qi = 0; qi < Q.length; qi++) {
    (function (item) {
      var opts = [];
      for (var oi = 0; oi < item[1].length; oi++) {
        var row = item[1][oi];
        var scores = {};
        scores[row[1]] = 3;
        if (row[2]) scores[row[2]] = 1;
        opts.push({ label: row[0], scores: scores });
      }
      questions.push({ q: item[0], options: opts });
    })(Q[qi]);
  }

  GameShell.define({
    id: 'game-which-attack',
    slug: 'which-attack',
    title: 'Which cyberattack are you',
    bestKey: null,
    autoStart: true,
    pauseOnBlur: false,
    rawInput: true,

    setup: function (g) {
      return QuizKit.mount(g, {
        questions: questions,
        result: function (totals) {
          var ranked = ATTACKS.slice();
          ranked.sort(function (a, b) {
            var diff = (totals[b] || 0) - (totals[a] || 0);
            /* Fixed order breaks every tie, so the same answers always give
               the same attack. See the header. */
            if (diff !== 0) return diff;
            return ATTACKS.indexOf(a) - ATTACKS.indexOf(b);
          });

          var total = 0;
          for (var t = 0; t < ATTACKS.length; t++) total += totals[ATTACKS[t]] || 0;
          if (!total) total = 1;

          var top = ranked[0];
          var second = ranked[1];
          var r = RESULTS[top];

          var body = '<strong>' + r.line + '</strong> ' + r.joke +
            ' Your runner-up was <em>' + NAMES[second] + '</em>. ' + r.fact +
            ' All eight of these, and the families they belong to, are laid out in ' +
            '<a href="/blog/types-of-cyberattacks">types of cyberattacks, mapped</a>.';

          var bars = [];
          for (var b = 0; b < 5; b++) {
            var key = ranked[b];
            bars.push({
              name: NAMES[key],
              pct: Math.round(((totals[key] || 0) / total) * 100),
              note: BLURBS[key]
            });
          }

          return { title: TITLES[top], body: body, bars: bars };
        },
        disclaimer: 'This measures nothing. Fourteen silly questions cannot tell you anything about yourself, ' +
          'and there is no sense in which a person resembles a denial-of-service attack &mdash; the quiz is a ' +
          'delivery mechanism for the paragraph underneath the result, which is the accurate part. Nothing you ' +
          'answered left your browser.'
      });
    }
  });
})();

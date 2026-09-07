/* ==========================================================================
   mayuri-chat.js — the retrieval brain behind the corner assistant.
   --------------------------------------------------------------------------
   ES5, no dependencies, no network beyond one same-origin JSON fetch. There
   is no model here and no API call: every sentence Mayuri can say was written
   by hand somewhere on this site and collected into
   assets/data/mayuri-index.json by scripts/mayuri-index.js.

   WHY RETRIEVAL AND NOT A LANGUAGE MODEL. A browser can run one now — the CSP
   already allows 'wasm-unsafe-eval' for the labs — and it was considered and
   rejected on two counts. Weight: the smallest coherent chat model is around
   400 MB against an offline shell of 36 KB, on a site that deliberately threw
   away a 4.5 MB precache for being too heavy. And accuracy, which is the real
   objection: a small model knows nothing about this site, so asked which lab
   decodes a JWT it produces a fluent guess. Retrieval over 1,267 hand-written
   answers gets that right every time, and when it has nothing it can say so.
   On a security consultant's site, a confident wrong answer is worse than no
   answer, which is why the confidence floor below exists at all.

   THE SHAPE OF THE PROBLEM. The corpus is mostly FAQ pairs, and they are
   already questions. That turns "answer this" into "which of these 1,267
   questions is being asked", which is ordinary ranked retrieval rather than
   comprehension — the reason this works as well as it does is the shape of
   the data, not the cleverness of the code.

   Loaded on demand by particle-bg.js the first time somebody opens the chat,
   never on page load, and cached on use by the service worker like everything
   else. Exposes window.MayuriChat; renders nothing itself.
   ========================================================================== */

(function () {
  'use strict';

  var INDEX_URL = '/assets/data/mayuri-index.json';

  /* Field weights. A hit in a question or a term NAME is worth much more than
     a hit in the prose underneath it, because the name is what the thing IS
     and the prose is merely where it is discussed — "salt" in a definition
     body is usually an aside, "Salt" as a term is the answer. */
  var W_QUESTION = 3.4;
  var W_ANSWER = 1;
  var W_TERM = 4.2;
  var W_DEF = 1.1;
  var W_TITLE = 2.4;
  var W_DESC = 1;

  /* The confidence floor, and the single most important number in the file.
     Below it Mayuri says she does not know and offers a human instead.
     COVERAGE is what it measures: the share of the visitor's own content
     words that actually appear in the winning entry. Score alone is a bad
     judge — a long answer can accumulate points from common words while
     answering something else entirely — whereas coverage answers the question
     that matters, which is "are they even talking about this".

     Coverage is a RATIO plus a floor, because a ratio alone is worthless on a
     short query: "what is the capital of france" reduces to two content words,
     one of which ("capital") appears in a FAQ about password meters, and 1-of-2
     is a coverage of 0.5. That answered a question about France with advice on
     choosing passwords, at full confidence. Two content words have to land
     before anything is confident, whatever the ratio says. */
  var MIN_COVERAGE = 0.6;
  var MIN_COVERED = 2;
  var MIN_SCORE = 0.9;

  /* Navigational words, stripped from the QUERY only and never from the corpus.
     "which lab decodes a JWT" is three content words by the tokenizer's count
     but only two topics; leaving "lab" in the denominator dropped coverage to
     0.67 and lost a question whose correct answer — /labs/jwt — was sitting at
     the top of the ranking. These words say what KIND of thing is wanted, which
     the intent classifier already handles, so counting them twice only hurts.

     KEPT DELIBERATELY SHORT. The first version of this list also held site,
     page, open, read, use, work and teach — every one of which is topical on
     this site ("cross-site scripting", "page table", "open redirect",
     "read-only", "use after free"). Stripping "site" is what made "cross site
     scripting" match an air-hockey FAQ instead of the XSS entry. A word only
     belongs here if it names a PART OF THIS WEBSITE and could never be part of
     a question's subject. */
  var NAV = {};
  (function () {
    var w = ('lab labs game games tool tools show find take tell').split(' ');
    for (var i = 0; i < w.length; i++) NAV[stem(w[i])] = true;
  })();

  /* Stripped from an existence question only — see the note at the call site. */
  var EXIST_VERBS = {};
  (function () {
    var w = ('offer offers offering provide provides have has had do does run runs ' +
      'give gives take takes accept accepts sell sells build builds hire hiring ' +
      'available join apply enrol enroll signup ' +
      /* Category nouns, which name the SHAPE of the thing and not the thing.
         "Is there a mentorship programme" is asking about mentorship; leaving
         "programme" in cost half the coverage and, worse, prefix-matched
         "programmers" in a typing lab, which then won on score. */
      'programme programmes program programs course courses service services ' +
      'thing things option options offering offerings package packages plan plans').split(' ');
    for (var i = 0; i < w.length; i++) EXIST_VERBS[stem(w[i])] = true;
  })();

  /* Words that carry no topic. Kept deliberately short: an aggressive stop
     list eats the difference between "what is a salt" and "what is salting",
     and the scoring already discounts common words by inverse frequency, so
     this only has to remove the ones that appear in nearly every query. */
  var STOP = {};
  (function () {
    var w = ('a an the is are was were be been being do does did doing done ' +
      'i me my mine you your yours we our it its this that these those of to ' +
      'in on at for with about from by as and or if then than so what which ' +
      'who whom whose where when why how can could should would will shall ' +
      'may might must have has had there here get got give tell show know ' +
      'please thanks thank hey ok okay any some all not no yes').split(' ');
    for (var i = 0; i < w.length; i++) STOP[w[i]] = true;
  })();

  /* Deliberately not a real stemmer. Porter would collapse more pairs but it
     also collapses ones that matter here — "hashing" and "hash" should meet,
     "security" and "secure" are fine to meet, but a full stemmer turns
     "generate" into "gener" and stops matching the literal word a page uses.
     These four suffixes cover the plural/gerund cases that actually came up
     and nothing else. */
  function stem(w) {
    if (w.length > 5 && w.slice(-3) === 'ing') return w.slice(0, -3);
    if (w.length > 4 && w.slice(-2) === 'ed') return w.slice(0, -2);
    /* Only the -es that is really a syllable: buses, boxes, matches. The naive
       rule "strip es" turned "games" into "gam" while "game" stayed whole, so
       the singular and the plural of the commonest word on the site stopped
       matching each other. */
    if (w.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    /* Not every trailing s is a plural — cross, https, status, analysis. The
       earlier rule turned "cross" into "cros", which is how "cross site
       scripting" came to be answered by an air-hockey FAQ about crossing the
       halfway line. */
    if (w.length > 3 && w.slice(-1) === 's' && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      /* Keep + and # so "c++" and "c#" survive as themselves; they are real
         topics on this site and splitting them loses the page. */
      .replace(/[^a-z0-9+#\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(s, keepStop) {
    var raw = normalize(s).split(' ');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i];
      if (!w) continue;
      var s2 = stem(w);
      /* Tested before AND after stemming. Only the first was checked once, so
         "whats" survived as a content word (it is not in the list) and then
         stemmed to "what" — leaving "whats a CVE" as two tokens where one was
         noise, coverage of 0.5, and a refusal with the CVE entry sitting at
         the top of the ranking. */
      if (!keepStop && (STOP[w] || STOP[s2])) continue;
      out.push(s2);
    }
    return out;
  }

  /* ---- the corpus, flattened ------------------------------------------- */

  var docs = null;      // every answerable entry, one shape
  var df = null;        // document frequency per token, for idf
  var vocab = null;     // token -> true, for the typo pass
  var index = null;     // the raw file, kept for page lookups

  function addDoc(list, doc) {
    /* Two token bags per doc rather than one: the strong field (a question, a
       term name, a title) and the weak one (the prose). Scoring needs to know
       WHERE a word matched, so they cannot be merged. */
    doc.st = tokenize(doc.strong);
    doc.wt = tokenize(doc.weak);
    list.push(doc);
  }

  function buildDocs(data) {
    var list = [];
    var i;

    for (i = 0; i < data.faq.length; i++) {
      var f = data.faq[i];
      addDoc(list, {
        kind: 'faq', strong: f.q, weak: f.a,
        answer: f.a, title: f.q, url: f.u, page: f.t,
        ws: W_QUESTION, ww: W_ANSWER
      });
    }
    for (i = 0; i < data.terms.length; i++) {
      var t = data.terms[i];
      addDoc(list, {
        kind: 'term', strong: t.t, weak: t.d,
        answer: t.d, title: t.t, url: '/glossary#' + slug(t.t),
        lab: t.lab, post: t.post, see: t.see || [], cat: t.c,
        ws: W_TERM, ww: W_DEF
      });
    }
    for (i = 0; i < data.pages.length; i++) {
      var p = data.pages[i];
      addDoc(list, {
        kind: 'page', strong: (p.h || p.t) + ' ' + p.t, weak: p.d,
        answer: p.d, title: p.h || p.t,
        /* The <title> as well as the h1, because an h1 is often a sentence —
           /internships leads with "Two ways to work with me. Both end with
           real projects shipped." That is the right thing to READ and a poor
           label for a button, where "Internships & Mentorship" belongs. */
        short: p.t, url: p.u, section: p.s,
        ws: W_TITLE, ww: W_DESC
      });
    }

    /* Document frequency over the union of both bags, so a word occurring in
       one field or the other counts once for the purpose of rarity. */
    var freq = {};
    var vv = {};
    for (i = 0; i < list.length; i++) {
      var seen = {};
      var bags = [list[i].st, list[i].wt];
      for (var b = 0; b < bags.length; b++) {
        for (var k = 0; k < bags[b].length; k++) {
          var tok = bags[b][k];
          vv[tok] = true;
          if (!seen[tok]) { seen[tok] = true; freq[tok] = (freq[tok] || 0) + 1; }
        }
      }
    }
    docs = list;
    df = freq;
    vocab = vv;
  }

  function slug(s) {
    return normalize(s).replace(/\s+/g, '-');
  }

  function idf(tok) {
    var n = docs.length;
    var d = df[tok] || 0;
    /* Standard smoothed idf, floored at a small positive value so a word in
       every document still contributes a little rather than going negative
       and actively penalising the documents that contain it. */
    return Math.max(0.05, Math.log((n - d + 0.5) / (d + 0.5) + 1));
  }

  /* Exact matches, and failing that a prefix match of at least five characters
     in either direction.

     This exists because stemming can only go so far without doing damage.
     "decodes" reduces to "decode" and the page says "decoder"; no suffix rule
     joins those without also turning "server" into "serv" and "user" into
     "us". So "which lab decodes a JWT" scored 1-of-2 coverage and was refused,
     with the correct answer sitting at the top of the ranking — found, and
     thrown away by the confidence floor.

     Five characters is the floor because four lets "cache" reach "caching" but
     also lets "hash" reach "hashi", and the exact pass runs first so a real
     match is never displaced by a prefix one. Prefix hits are worth slightly
     less than exact, which is what keeps an exact match on top when both
     exist. */
  var PREFIX_MIN = 5;
  var PREFIX_WORTH = 0.75;

  function countIn(bag, tok) {
    var n = 0;
    var i;
    for (i = 0; i < bag.length; i++) if (bag[i] === tok) n++;
    if (n) return n;
    if (tok.length < PREFIX_MIN) return 0;
    var partial = 0;
    for (i = 0; i < bag.length; i++) {
      var w = bag[i];
      if (w.length < PREFIX_MIN) continue;
      if (w.indexOf(tok) === 0 || tok.indexOf(w) === 0) partial++;
    }
    return partial ? partial * PREFIX_WORTH : 0;
  }

  /* ---- typo tolerance --------------------------------------------------
     Only for words the corpus has never seen, only for words long enough for
     a near-miss to be meaningful, and only accepted on a strong trigram
     overlap. Cheap and conservative on purpose: silently rewriting a word the
     visitor actually meant is worse than failing to match it, because the
     failure is visible and the rewrite is not. */
  function trigrams(w) {
    var s = '  ' + w + ' ';
    var out = [];
    for (var i = 0; i < s.length - 2; i++) out.push(s.slice(i, i + 3));
    return out;
  }

  function nearestToken(tok) {
    if (tok.length < 4) return null;
    var a = trigrams(tok);
    var best = null;
    var bestScore = 0;
    for (var v in vocab) {
      if (!Object.prototype.hasOwnProperty.call(vocab, v)) continue;
      if (Math.abs(v.length - tok.length) > 3) continue;
      if (v.charAt(0) !== tok.charAt(0)) continue;   // keeps the scan small
      var b = trigrams(v);
      var hits = 0;
      for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) !== -1) hits++;
      var score = (2 * hits) / (a.length + b.length);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return bestScore >= 0.62 ? best : null;
  }

  /* ---- intent ----------------------------------------------------------
     Pattern matching, not classification. Each intent either answers on its
     own (a greeting) or biases the ranking towards one kind of document (a
     definition question towards glossary terms). Biasing rather than filtering
     matters: "what is HackLab" is phrased as a definition but the answer is a
     page, and a hard filter would have thrown that away. */
  /* ---- abuse ------------------------------------------------------------
     Whole words only, and a deliberately narrow list. A substring match would
     have her refuse to discuss Scunthorpe, and on a site whose subject is
     attacks and exploits the temptation to add "kill", "attack" or "hell" has
     to be resisted — every one of those appears in legitimate questions here
     ("kill a process", "attack surface", "hell of a lot of hashes").

     What is listed is abuse aimed at a person. The response escalates once and
     then stops the conversation, and the stop is SESSION-scoped on purpose:
     a permanent lock would mean one false positive costs somebody the site's
     help forever, and no wordlist is good enough to spend that. A reload
     clears it. If you want it harsher, move the flag to localStorage — the
     trade you are making is a stranger's access against a stranger's rudeness.

     There is no pretence of blocking anyone. She declines to continue, which
     is the only thing a page can honestly do. */
  /* SEVERE — sexual harassment, slurs and threats. These skip the warning
     entirely and lock on the first message, because "let me put that more
     politely next time" is not the correct response to being asked for nudes.
     A graduated warning is right for rudeness and wrong for this. */
  var SEVERE = {};
  (function () {
    var w = ('boob boobs boobies tit tits titty titties nipple nipples ' +
      'pussy penis vagina nude nudes horny cunt slut whore rape rapist ' +
      'molest paedophile pedophile ' +
      /* The Hindi entries here are the sexual and incestuous ones; the merely
         rude ones stay on the ordinary list below. */
      'bhenchod madarchod randi lauda').split(' ');
    for (var i = 0; i < w.length; i++) SEVERE[w[i]] = true;
  })();

  var SEVERE_PHRASES = [
    /* Possessive required on the ambiguous nouns: "show me the body" is a DOM
       question and "show me your body" is not. */
    /\b(see|show|send|want|give)( me)?\s+(your|ur)\s+(boob|boobs|tits|breast|breasts|ass|butt|nude|nudes|body|figure|bra|panty|panties)\b/,
    /\b(your|ur)\s+(boobs|tits|breasts|butt|figure|bra|panty|panties)\b/,
    /\bsend\s+(me\s+)?(your\s+|ur\s+)?(nudes?|pics?|photos?|selfies?)\b/,
    /\b(sleep|sex)\s+with\s+(you|u|me)\b/,
    /\b(kiss|date|marry|touch|hug)\s+(me|you|u)\b/,
    /\b(are|r)\s+(you|u)\s+(single|hot|sexy|naked|a virgin)\b/,
    /\b(you|u)\s+(are|r)\s+(sexy|hot|beautiful and|so hot)\b/,
    /\bi\s+(want|wanna)\s+(you|ur body|your body)\b/,
    /* Threats. "kill" and "hurt" alone are ordinary words on this site — "kill
       a process", "does it hurt performance" — so only the pointed forms. */
    /\b(kill|hurt|beat|stab|find|rape)\s+(you|u|him|krunalkumar)\b/,
    /\bi\s+will\s+(kill|hurt|beat|find|report|sue)\s+(you|u|him)\b/
  ];

  var ABUSE = {};
  (function () {
    var w = (
      /* Profanity and its usual spellings. */
      'fuck fucking fucked fucker fuckers fuckoff fuckyou fuk fuking fck fcking ' +
      'motherfucker motherfucking shit shite shitty shitshow bullshit crap crappy ' +
      'bitch bitches bastard bastards asshole assholes arsehole arse ' +
      'dick dickhead prick cock wanker tosser twat bollocks bugger ' +
      /* Slurs and dehumanising words. */
      'retard retarded spastic imbecile cretin ' +
      /* Plain insults aimed at a person. */
      'idiot idiots idiotic stupidity dumbass dimwit numbskull nitwit ' +
      'jerk douche douchebag scumbag pervert perv sicko freak ' +
      /* Hinglish. The sexual and incestuous ones are on the SEVERE list
         above; these are the ordinary insults. */
      'chutiya chutiye gandu gaandu harami haramkhor kutta kutte kamina kaminey ' +
      'saala saale bhosdike bhosdi bsdk chinal nalayak bewakoof pagal'
    ).split(' ');
    for (var i = 0; i < w.length; i++) ABUSE[w[i]] = true;
  })();

  /* Words held OUT of the lists above, each for a reason, because the
     temptation to add them will come back:
       garbage, trash   "garbage collection" is a topic here
       gross            "gross salary" is a field in /labs/salary-breakdown
       cheat            "cheat sheet"
       strip, naked     stripJsComments; a "naked domain" is a DNS term
       kill, attack     "kill a process", "attack surface"
       hell, damn       ordinary frustration, and "hell of a" is not abuse
       suck             only as "you suck", which is a phrase below
       mc, bc           an MC is a compere and BC is a date
     The rule that keeps this list honest is the sweep in the README: every
     one of the site's own 1,267 FAQ questions is fired at this filter, and a
     single hit is a false positive by definition. */

  /* Words that insult a PERSON but are ordinary otherwise, so they only count
     when aimed at one. Two of these were on the hard list and should never have
     been: "fraud" and "scam" are subjects on this site, and "what is UPI
     fraud" — a real question about a real blog post — was met with a demand
     for an apology. */
  var SOFT = {
    stupid: 1, dumb: 1, idiot: 1, moron: 1, nonsense: 1, rubbish: 1, bloody: 1,
    fake: 1, scam: 1, scammer: 1, fraud: 1, cheater: 1, liar: 1,
    useless: 1, worthless: 1, pathetic: 1, incompetent: 1, hopeless: 1,
    disgusting: 1, clown: 1, creepy: 1, annoying: 1, joker: 1
  };

  /* Aimed at a person — and the list stops at people on purpose. Adding "site"
     or "website" would catch "this site is garbage" and also break "how do I
     spot a fake website", which is a phishing question this site answers. That
     trade is not worth it: an insult aimed at the furniture is missed, and a
     real question keeps working. */
  var POINTED = /\b(you|your|yours|yourself|u|ur|he|his|him|himself|krunalkumar|krunal|mayuri|boss|assistant|sir)\b/;

  /* Phrases, which are the reliable half of this. A phrase can be unambiguous
     where a single word cannot: "shut up" and "you suck" have no innocent
     reading, so they need no pointed test and carry no false-positive risk. */
  var ABUSE_PHRASES = [
    /\bshut (up|it|the)\b/, /\bget lost\b/, /\bscrew (you|u|off)\b/, /\bgo to hell\b/,
    /\b(you|u|ur|your) (suck|stink|sucks)\b/, /\bpiss off\b/, /\bbuzz off\b/,
    /\bbugger off\b/, /\bsod off\b/, /\bknow(s)? nothing\b/, /\bno (fucking )?use\b/,
    /* Possessive required. Without it this caught "Are tutorials always a
       waste of time?", which is one of the site's own FAQ questions — a
       general observation is not an insult, "a waste of MY time" is. */
    /\b(waste of|wasting) (my|your|our) time\b/,
    /\bhate (you|u|him|krunalkumar|this)\b/,
    /\bshame on (you|him)\b/, /\bwho (the hell|do you think) you are\b/,
    /\b(you|he) (is|are|r) (a |so |such a )?(joke|fool|clown|loser|liar|idiot|moron)\b/,
    /\b(bloody|damn|fucking) (idiot|fool|useless|stupid|hell|thing)\b/,
    /\b(stop|quit) (talking|blabbering|wasting)\b/,
    /\byour? (boss|assistant) (is|are|sucks)\b.*\b(bad|useless|stupid|fraud|liar)\b/
  ];

  /* 0 = fine, 1 = rude, 2 = severe. Severity rather than a boolean because the
     two deserve different treatment: rudeness gets one warning, harassment
     gets none. */
  function abuseIn(q) {
    var s = normalize(q);
    var i;
    var words = s.split(' ');
    for (i = 0; i < words.length; i++) if (SEVERE[words[i]]) return 2;
    for (i = 0; i < SEVERE_PHRASES.length; i++) if (SEVERE_PHRASES[i].test(s)) return 2;
    for (i = 0; i < ABUSE_PHRASES.length; i++) if (ABUSE_PHRASES[i].test(s)) return 1;
    var pointed = POINTED.test(s);
    for (i = 0; i < words.length; i++) {
      var w = words[i];
      if (ABUSE[w]) return 1;
      if (SOFT[w] && pointed) return 1;
    }
    return 0;
  }

  /* Time of day from the visitor's own clock, which is the only one available
     and the right one anyway. */
  function daypart() {
    var h = new Date().getHours();
    if (h < 5) return 'Hello';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Hello';
  }

  /* ======================================================================
     Two answers Mayuri works out rather than looks up.
     ----------------------------------------------------------------------
     Everything else she says comes from the corpus: a question goes in, a
     ranked passage of Krunalkumar’s own writing comes out. These two
     cannot, because the answer does not exist until it is asked — the time
     changes every minute and nobody has written down what 17 × 23 is. They
     are computed, and they are the only two that are.
     ====================================================================== */

  /* THE CLOCK IS NOT ARITHMETIC ON A TABLE OF OFFSETS, which is the obvious
     way to do it and is wrong for a third of the year. The United States is
     UTC-6 in Chicago in January and UTC-5 in July, and a hardcoded -6 would
     be an hour out from March to November — every year, for eight months of
     it. Handing an IANA zone name to Intl.DateTimeFormat makes the browser
     use the same tz database the operating system trusts, which knows when
     each country moves its clocks and, when they change the rule, gets the
     correction with the browser update. It also produces the right
     abbreviation without a second table: CST in winter, CDT in summer.

     The list is short on purpose. It covers where the people who write to
     Krunalkumar actually are, and anything outside it is answered honestly
     with a pointer at the meeting planner, which does the whole world. */
  var PLACES = [
    { keys: ['india', 'indian', 'ist', 'bharat', 'delhi', 'mumbai', 'bombay', 'bengaluru',
             'bangalore', 'kolkata', 'calcutta', 'chennai', 'hyderabad', 'pune', 'surat',
             'ahmedabad', 'gujarat', 'noida', 'gurgaon', 'gurugram'],
      name: 'India', zones: [['', 'Asia/Kolkata']] },

    /* Four zones, because "what is the time in the US" has four answers and
       picking one would be a guess about which coast the asker meant. */
    { keys: ['us', 'usa', 'u s a', 'america', 'american', 'united states', 'states'],
      name: 'the United States',
      zones: [['Eastern', 'America/New_York'], ['Central', 'America/Chicago'],
              ['Mountain', 'America/Denver'], ['Pacific', 'America/Los_Angeles']] },

    { keys: ['uk', 'britain', 'british', 'england', 'london', 'scotland', 'wales'],
      name: 'the UK', zones: [['', 'Europe/London']] },
    { keys: ['uae', 'dubai', 'abu dhabi', 'emirates'],
      name: 'the UAE', zones: [['', 'Asia/Dubai']] },
    { keys: ['singapore', 'sg'], name: 'Singapore', zones: [['', 'Asia/Singapore']] },
    { keys: ['japan', 'tokyo', 'jst'], name: 'Japan', zones: [['', 'Asia/Tokyo']] },
    { keys: ['china', 'beijing', 'shanghai'], name: 'China', zones: [['', 'Asia/Shanghai']] },
    { keys: ['germany', 'berlin', 'france', 'paris', 'netherlands', 'amsterdam', 'spain',
             'madrid', 'italy', 'rome', 'europe', 'eu', 'cet'],
      name: 'central Europe', zones: [['', 'Europe/Berlin']] },
    { keys: ['canada', 'toronto', 'ontario'], name: 'Toronto', zones: [['', 'America/Toronto']] },
    { keys: ['vancouver', 'bc'], name: 'Vancouver', zones: [['', 'America/Vancouver']] },
    { keys: ['australia', 'sydney', 'melbourne'], name: 'Sydney', zones: [['', 'Australia/Sydney']] },
    { keys: ['new zealand', 'auckland'], name: 'Auckland', zones: [['', 'Pacific/Auckland']] },
    { keys: ['new york', 'nyc', 'ny', 'boston', 'miami', 'atlanta', 'est', 'edt'],
      name: 'New York', zones: [['', 'America/New_York']] },
    { keys: ['chicago', 'texas', 'dallas', 'houston', 'austin', 'cst', 'cdt'],
      name: 'Chicago', zones: [['', 'America/Chicago']] },
    { keys: ['denver', 'colorado', 'arizona', 'phoenix', 'mst', 'mdt'],
      name: 'Denver', zones: [['', 'America/Denver']] },
    { keys: ['california', 'san francisco', 'sf', 'los angeles', 'la', 'seattle', 'silicon valley',
             'pst', 'pdt'],
      name: 'California', zones: [['', 'America/Los_Angeles']] },
    { keys: ['pakistan', 'karachi', 'lahore'], name: 'Pakistan', zones: [['', 'Asia/Karachi']] },
    { keys: ['bangladesh', 'dhaka'], name: 'Bangladesh', zones: [['', 'Asia/Dhaka']] },
    { keys: ['nepal', 'kathmandu'], name: 'Nepal', zones: [['', 'Asia/Kathmandu']] },
    { keys: ['sri lanka', 'colombo'], name: 'Sri Lanka', zones: [['', 'Asia/Colombo']] },
    { keys: ['utc', 'gmt', 'zulu'], name: 'UTC', zones: [['', 'UTC']] }
  ];

  /* Countries whose name is not already a zone the runtime accepts. The tz
     database carries backward-compatibility links for a surprising number of
     them — Egypt, Japan, Turkey, Iran, Israel, Cuba, Poland, Portugal,
     Singapore, Iceland and more all resolve as they stand, which is checked
     at the bottom of zoneFor and costs nothing — so this list is only the
     ones that do not, and it stops well short of every country on earth
     because the city sweep below catches most of the rest. */
  var COUNTRIES = {
    nigeria: 'Africa/Lagos', kenya: 'Africa/Nairobi', ghana: 'Africa/Accra',
    ethiopia: 'Africa/Addis_Ababa', tanzania: 'Africa/Dar_es_Salaam',
    morocco: 'Africa/Casablanca', algeria: 'Africa/Algiers', tunisia: 'Africa/Tunis',
    'south africa': 'Africa/Johannesburg', brazil: 'America/Sao_Paulo',
    russia: 'Europe/Moscow', mexico: 'America/Mexico_City', argentina: 'America/Argentina/Buenos_Aires',
    chile: 'America/Santiago', colombia: 'America/Bogota', peru: 'America/Lima',
    germany: 'Europe/Berlin', france: 'Europe/Paris', italy: 'Europe/Rome',
    spain: 'Europe/Madrid', netherlands: 'Europe/Amsterdam', holland: 'Europe/Amsterdam',
    sweden: 'Europe/Stockholm', norway: 'Europe/Oslo', denmark: 'Europe/Copenhagen',
    finland: 'Europe/Helsinki', ireland: 'Europe/Dublin', greece: 'Europe/Athens',
    switzerland: 'Europe/Zurich', austria: 'Europe/Vienna', belgium: 'Europe/Brussels',
    'czech republic': 'Europe/Prague', czechia: 'Europe/Prague', hungary: 'Europe/Budapest',
    romania: 'Europe/Bucharest', ukraine: 'Europe/Kyiv',
    thailand: 'Asia/Bangkok', vietnam: 'Asia/Ho_Chi_Minh', malaysia: 'Asia/Kuala_Lumpur',
    indonesia: 'Asia/Jakarta', philippines: 'Asia/Manila', 'south korea': 'Asia/Seoul',
    korea: 'Asia/Seoul', china: 'Asia/Shanghai', taiwan: 'Asia/Taipei',
    'saudi arabia': 'Asia/Riyadh', saudi: 'Asia/Riyadh', qatar: 'Asia/Qatar',
    kuwait: 'Asia/Kuwait', oman: 'Asia/Muscat', bahrain: 'Asia/Bahrain',
    jordan: 'Asia/Amman', lebanon: 'Asia/Beirut', iraq: 'Asia/Baghdad',
    afghanistan: 'Asia/Kabul', myanmar: 'Asia/Yangon', burma: 'Asia/Yangon',
    maldives: 'Indian/Maldives', mauritius: 'Indian/Mauritius', fiji: 'Pacific/Fiji'
  };

  /* Every zone the runtime knows, keyed by the part people say. "Africa/Cairo"
     becomes "cairo", "America/Argentina/Buenos_Aires" becomes "buenos aires"
     as well as "argentina". Built once, on the first time question, because
     418 zones is not work to do at load for a feature most visitors never
     touch — and skipped entirely on a browser too old to enumerate them,
     where the curated list still answers. */
  var cityIndex = null;
  function cities() {
    if (cityIndex) return cityIndex;
    cityIndex = {};
    if (typeof Intl === 'undefined' || typeof Intl.supportedValuesOf !== 'function') return cityIndex;
    var all;
    try { all = Intl.supportedValuesOf('timeZone'); } catch (err) { return cityIndex; }
    for (var i = 0; i < all.length; i++) {
      var parts = all[i].split('/');
      for (var p = 1; p < parts.length; p++) {
        var key = parts[p].replace(/_/g, ' ').toLowerCase();
        // First one wins: Asia/Kolkata should not be reassigned by a later
        // zone that happens to share a segment.
        if (!cityIndex[key]) cityIndex[key] = all[i];
      }
    }
    return cityIndex;
  }

  function usableZone(tz) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(new Date());
      return true;
    } catch (err) { return false; }
  }

  /* Four passes, cheapest and most specific first. The curated list owns the
     places with more than one answer (the United States) and the ways people
     abbreviate (uk, uae, pst); everything after it is the database answering
     for itself, which is why "egypt", "nairobi" and "buenos aires" work
     without anyone having typed them here. */
  function zoneFor(where) {
    var w = String(where || '').trim().toLowerCase().replace(/^(the|in)\s+/, '');
    if (!w) return null;

    var curated = placeFor(w);
    if (curated) return curated;

    if (COUNTRIES[w] && usableZone(COUNTRIES[w])) {
      return { name: title(w), zones: [['', COUNTRIES[w]]] };
    }

    var byCity = cities()[w];
    if (byCity) return { name: title(w), zones: [['', byCity]] };

    /* Last: the name as a zone in its own right. This is what makes "egypt"
       and "japan" work with nothing written down for them — the tz database
       kept those as links when the zones were renamed after cities. */
    var direct = w.replace(/\s+/g, '_').replace(/(^|_)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
    if (usableZone(direct)) return { name: title(w), zones: [['', direct]] };

    return null;
  }

  function title(w) {
    return w.replace(/(^|[\s-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }

  function placeFor(where) {
    for (var i = 0; i < PLACES.length; i++) {
      var keys = PLACES[i].keys;
      for (var k = 0; k < keys.length; k++) {
        // Whole words only, so "la" does not match "lahore" and "sg" does
        // not match "sgt".
        if (new RegExp('(^|\\s)' + keys[k].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(where)) {
          return PLACES[i];
        }
      }
    }
    return null;
  }

  /* CLDR does not agree with itself about zone abbreviations, and which one
     you get depends on the locale you ask in. en-GB answers "GMT-7" for the
     American zones, which is correct and is not what anybody calls it; en-US
     answers "PDT". Ask both and take the first that is a NAME rather than an
     offset, keeping an offset only as the fallback for zones that genuinely
     have no short name in either.

     India is the one override. CLDR gives "GMT+5:30" in both locales, while
     every person asking this question calls it IST. The letters are
     ambiguous in the abstract — Irish and Israel Standard Time have the same
     three — but they are printed under the words "In India, right now", and
     the audience for this site is in the one that means +5:30.

       Both spellings of the Indian zone are listed because they are both
     live: the tz database renamed Calcutta to Kolkata in 2008 and kept the
     old name as a link, and Windows still reports Asia/Calcutta through
     resolvedOptions() on machines set to India — which is exactly the
     machine most likely to ask this. Keying only the new spelling printed
     GMT+5:30 to the people it was written for. */
  var ABBR = { 'Asia/Kolkata': 'IST', 'Asia/Calcutta': 'IST' };

  function zoneAbbr(d, tz) {
    if (ABBR[tz]) return ABBR[tz];
    var locales = ['en-US', 'en-GB'];
    var fallback = '';
    for (var l = 0; l < locales.length; l++) {
      try {
        var parts = new Intl.DateTimeFormat(locales[l], {
          timeZone: tz, timeZoneName: 'short', hour: 'numeric'
        }).formatToParts(d);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type !== 'timeZoneName') continue;
          var v = parts[i].value;
          if (!/^(?:GMT|UTC)/i.test(v)) return v;
          if (!fallback) fallback = v;
        }
      } catch (err) { /* try the other locale */ }
    }
    return fallback;
  }

  /* One reading of one clock. Every field comes from Intl so the tz database
     decides the offset, the abbreviation and whether it is even the same day
     over there — which it often is not, and is the detail people are
     usually asking about. */
  function clockIn(tz) {
    var d = new Date();
    try {
      var time = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
      }).format(d);
      var day = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, weekday: 'long', day: 'numeric', month: 'long'
      }).format(d);
      var abbr = zoneAbbr(d, tz);
      return { time: time.replace(/\s?(am|pm)/i, function (m) { return m.toLowerCase(); }), day: day, abbr: abbr };
    } catch (err) {
      /* A browser without the zone in its database, or without Intl at all.
         Saying so is better than printing the wrong hour with confidence. */
      return null;
    }
  }

  /* ARITHMETIC WITHOUT eval(). Not a preference: the site’s CSP allows
     \'wasm-unsafe-eval\' and nothing else, so eval and new Function are both
     blocked in the browser and the answer would be an exception. This is a
     plain recursive descent over the four operations, powers, brackets and a
     unary sign — about forty lines, no dependency, and it cannot execute
     anything because it never builds code, only numbers.

     It returns null for anything it does not fully understand, and the
     caller treats null as "not a sum" and carries on to the search. That is
     what keeps "python 3" and "version 2 of the api" out of the calculator. */
  function calc(src) {
    var s = String(src).replace(/[×x]/gi, '*').replace(/[÷]/g, '/').replace(/,/g, '');
    var i = 0;
    var bad = false;

    function ws() { while (i < s.length && s.charAt(i) === ' ') i++; }
    function eat(ch) { ws(); if (s.charAt(i) === ch) { i++; return true; } return false; }

    function atom() {
      ws();
      if (eat('(')) {
        var v = sum();
        if (!eat(')')) bad = true;
        return v;
      }
      var m = /^\d+(?:\.\d+)?|^\.\d+/.exec(s.slice(i));
      if (!m) { bad = true; return 0; }
      i += m[0].length;
      return parseFloat(m[0]);
    }

    function unary() {
      ws();
      if (eat('-')) return -unary();
      if (eat('+')) return unary();
      return atom();
    }

    /* Right associative, so 2^3^2 is 512 and not 64 — the same way a
       calculator and every maths textbook read it. */
    function power() {
      var base = unary();
      ws();
      if (eat('^')) return Math.pow(base, power());
      return base;
    }

    function product() {
      var v = power();
      for (;;) {
        ws();
        if (eat('*')) v *= power();
        else if (eat('/')) v /= power();
        else if (eat('%')) v %= power();
        else return v;
      }
    }

    function sum() {
      var v = product();
      for (;;) {
        ws();
        if (eat('+')) v += product();
        else if (eat('-')) v -= product();
        else return v;
      }
    }

    var out = sum();
    ws();
    if (bad || i < s.length) return null;          // trailing junk it could not read
    if (typeof out !== 'number' || !isFinite(out)) return null;
    return out;
  }

  /* The expression as the asker wrote it, minus the ways people wrap one in
     a sentence. Returns null when what is left is not arithmetic — which is
     nearly everything, so this runs before the corpus and costs a regex. */
  function sumIn(src) {
    // Raw text arrives here, capitals and all: lowercase a copy for the
    // leading-verb strip, and leave every operator alone.
    var t = String(src == null ? '' : src).toLowerCase().replace(/^(?:can you |could you |please |plz )?(?:do|calc|calculate|compute|solve|evaluate|work out|what(?:\'?s| is)|whats|how much is|answer)\s+/, '');
    t = t.replace(/[?=.\s]+$/, '').trim();
    if (!t || !/[-+*\/%^×÷]/.test(t)) return null;    // a bare number is not a sum
    if (!/^[-+*\/%^()., \d×÷x]+$/i.test(t)) return null;  // letters mean it is a question
    if (!/\d/.test(t)) return null;
    var v = calc(t);
    if (v === null) return null;
    return { expr: t, value: v };
  }

  /* Twelve significant figures, then the trailing zeros go. Enough that
     1/3 reads as a third and not as 0.3, few enough that 0.1 + 0.2 comes
     back as 0.3 rather than as the famous 0.30000000000000004 — which is a
     true fact about doubles and a wrong answer to the question asked. */
  function niceNumber(n) {
    if (Math.abs(n) >= 1e15 || (n !== 0 && Math.abs(n) < 1e-6)) return String(n);
    var r = Number(n.toPrecision(12));
    return String(r);
  }

  function intentOf(q) {
    var s = normalize(q);
    if (!s) return 'empty';
    if (abuseIn(q)) return 'abuse';
    if (/^(hi|hello|hey|yo|hiya|namaste|good (morning|afternoon|evening))\b/.test(s)) return 'greet';
    /* Before 'thanks', because "thanks, bye" is a goodbye and not a thank-you,
       and before the lock, because somebody leaving should be able to leave
       politely even mid-sanction — the record is untouched by it. */
    if (/(^|\b)(bye+|goodbye|good bye|cya|see ya|see you|ttyl|gtg|good ?night|nite|take care|farewell|alvida|khuda hafiz)\b/.test(s)) return 'bye';
    if (/^(that s all|thats all|that is all|i m done|im done|i am done|nothing else|no thanks|no thank you)\b/.test(s)) return 'bye';
    if (/^(thanks|thank you|ta|cheers|nice|cool|great|ok|okay)\b/.test(s) && s.length < 22) return 'thanks';
    if (/\b(who are you|what are you|your name|are you (a )?(bot|ai|human|real))\b/.test(s)) return 'identity';

    /* Two questions with computed answers, tested before anything that
       matches on subject words.

       THE CLOCK. "time" on its own is a trap: "time complexity" is a
       glossary term, and "response time" and "turnaround time" are both FAQ
       subjects. So the noun has to END the question, or be followed by a
       place — which is exactly what separates "what is the time" from
       "what is time complexity", and it is why these are anchored at both
       ends rather than searched for in the middle. */
    var tq = s.replace(/[?.!]+$/, '').trim();
    if (/^(?:what(?:\'?s| is)?\s+)?(?:the\s+)?(?:current\s+|local\s+)?(?:time|date)(?:\s+(?:now|today|here|right now))?$/.test(tq) ||
        /^what (?:time|day|date) is it(?:\s+(?:now|today|here))?$/.test(tq) ||
        /^(?:what(?:\'?s| is)?\s+)?(?:the\s+)?today\'?s? date$/.test(tq) ||
        /^what day is (?:it|today)$/.test(tq) ||
        /^(?:time|date) (?:now|today|here)$/.test(tq) ||
        /^(?:what(?:\'?s| is)?\s+)?(?:the\s+)?(?:current\s+|local\s+)?(?:time|date)\s+(?:in|at|over in)\s+[a-z][a-z .\'-]*$/.test(tq)) {
      return 'time';
    }

    /* THE SUM. Claimed only when the whole message parses as arithmetic, so
       the test IS the parse: "5+5" and "what is 2*(3+4)^2" are claimed,
       "python 3" and "http 2 vs 3" are not, because they hold letters and
       never reach the parser.

       On the RAW question, not the normalized one. normalize() keeps only
       letters, digits, + and # — so "2*(3+4)^2" reaches it as "2 3+4 2",
       with every operator that matters already deleted. The first version of
       this read the normalized string and could therefore only ever add. */
    if (sumIn(q)) return 'math';

    /* "Take me there" rather than "where is it", and checked EARLY — ahead of
       exists, commercial and contact. Those all match on subject words, and a
       request to be moved is about the verb: "go to contact" was being read as
       a question about how to get in touch, and "navigate to internships" as a
       question about whether internships exist. The phrasing here is
       unambiguous, so it gets first refusal.

       The verb list is anchored. It carried "open the" but not a bare
       "open", because "open redirect" is a security term with a glossary
       entry of its own and a navigation verb would have hijacked it. That
       cost more than it saved: "open python", "open sunflower" is how people
       actually ask, and they got a search result instead of the page. */
    if (/^(go to|goto|go into|take me to|take me|bring me to|navigate to|send me to|open the|jump to|redirect me to)\b/.test(s)) return 'navigate';

    /* Bare "open" — with the two subjects it would otherwise swallow named
       right here. They are the only ones: grepping every js, html and json
       on the site for a word following "open" turns up "open redirect" and
       "open source" and nothing else, so a lookahead is enough and a
       maintained exception list is not. The plural is covered because "open
       redirects" is the same question asked twice over.

       Something has to FOLLOW the verb. A bare "open" on its own names no
       destination, and sending it down this path would answer a question
       nobody asked with a page nobody chose. */
    if (/^open(?: up)? +(?!redirects?\b|sources?\b)\S/.test(s)) return 'navigate';
    if (/\b(take|bring) me to\b/.test(s)) return 'navigate';
    /* "Do you offer X" is a question about EXISTENCE, and it has to be caught
       before anything else claims it. The corpus has no FAQ answering "do you
       have this" — existence is answered by the page existing, so the FAQs on
       a topic are all about its DETAILS. Retrieval therefore found the closest
       detail and served it as the answer: "do you offer internships" came back
       "That is your college's decision — every institution applies its own
       internship policy", which answers a question nobody asked. These
       questions are answered from page cards, where the description is
       genuinely a statement of what is on offer. */
    if (/\b(do|does|did) (you|u|they|he|krunalkumar) (offer|provide|have|do|run|give|take|accept|teach|sell|build)\b/.test(s)) return 'exists';
    if (/\bis there (an?|any)\b/.test(s)) return 'exists';
    if (/\bare (you|u) (hiring|taking|accepting|offering|running|doing)\b/.test(s)) return 'exists';
    if (/\bcan (i|we) (do|join|apply|get|take|enrol|enroll|sign up)\b/.test(s)) return 'exists';

    /* Two tiers, because "price" on its own is not a question about this
       business. "bitcoin price prediction" routed to the services page under a
       single flat pattern — harmless but wrong, and the same pattern would
       catch "what is the price of a data breach", which is a real topic here.
       The money words therefore need a second-person framing to count; the
       engagement words are unambiguous on their own.

       Internships are carved out of the commercial tier deliberately: "are you
       hiring interns" is a question about the internship programme, and
       matching it on "hiring" answered it with a quote for consulting work. */
    if (/\b(intern|interns|internship|internships|mentorship|mentee)\b/.test(s)) return 'exists';
    if (/\b(hire|hiring|freelance|retainer|quote|quotation|engagement|onboard|consultanc(y|ies)|work with you)\b/.test(s)) return 'commercial';
    if (/\b(price|prices|pricing|cost|costs|rate|rates|budget|charge|charges|fee|fees|how much|day rate)\b/.test(s) &&
        /\b(you|your|yours|u)\b/.test(s)) return 'commercial';
    if (/\b(contact|email|e-mail|phone|call|whatsapp|reach|talk to|speak to|message)\b/.test(s)) return 'contact';
    if (/\b(what is|what are|what does|whats|define|definition|meaning|mean)\b/.test(s)) return 'define';
    if (/\b(where|which lab|which game|which page|find|show me|link|take me|is there)\b/.test(s)) return 'locate';
    return 'general';
  }

  /* ---- scoring --------------------------------------------------------- */

  /* How much of a STORED QUESTION the visitor actually mentioned.
     --------------------------------------------------------------------------
     Scoring used to measure overlap in one direction only — how much of the
     query appears in the entry — and that is half the question. "Do you offer
     internships?" was answered with "Will my college accept this internship
     for credit?", which shares the word "internship" and contributes college,
     accept and credit that nobody asked about. A narrow stored question was
     matching a broad asked one and being presented as its answer.

     So an entry whose own question is far more specific than what was asked
     gets held back. Only for FAQ entries: a glossary term's name is not a
     question, and a page title is not either, so measuring their "unasked"
     words would penalise them for being short. */
  function questionFit(doc, queryHas) {
    if (doc.kind !== 'faq' || !doc.st.length) return 1;
    var hit = 0;
    for (var i = 0; i < doc.st.length; i++) if (queryHas[doc.st[i]]) hit++;
    var frac = hit / doc.st.length;
    /* Floor at 0.35 rather than 0: a specific question is still often the
       right answer, and zeroing it would make the corpus's most detailed
       entries unreachable unless quoted almost verbatim. */
    return 0.35 + 0.65 * frac;
  }

  function score(queryTokens, doc, bias, queryHas) {
    var total = 0;
    var covered = 0;
    for (var i = 0; i < queryTokens.length; i++) {
      var tok = queryTokens[i];
      var inStrong = countIn(doc.st, tok);
      var inWeak = countIn(doc.wt, tok);
      if (!inStrong && !inWeak) continue;
      covered++;
      var w = idf(tok);
      /* Saturating term frequency: the second occurrence of a word says much
         less than the first, and without this a long answer that happens to
         repeat one query word outranks a short one that is exactly on topic. */
      var tfStrong = inStrong ? (1 + Math.log(inStrong)) : 0;
      var tfWeak = inWeak ? (1 + Math.log(inWeak)) : 0;
      total += w * (tfStrong * doc.ws + tfWeak * doc.ww);
    }
    if (!covered) return null;
    var coveredCount = covered;

    /* Length normalisation, gentle. Dividing by full length would push every
       answer towards one-line definitions; a square root keeps short entries
       competitive without making them automatic winners. */
    var len = doc.st.length + doc.wt.length;
    total = total / Math.sqrt(Math.max(6, len));

    /* An exact phrase hit in the strong field is the single most reliable
       signal in the whole scorer — somebody typing "fork bomb" who matches a
       term called "Fork bomb" is not ambiguous. */
    /* Coordination: an entry that matches EVERY word of the question beats one
       that matches half, and without this it did not. "Do you offer security
       reviews" put /labs/csp-playground first on the strength of
       "Content-Security-Policy" — one word of two — ahead of /services, whose
       description literally lists "security reviews" and covered both. Rare
       words carry so much idf that a single lucky hit could outweigh a
       complete match, which is the wrong trade for a question: a question is a
       conjunction, and an answer that ignores half of it is not an answer.
       Squared-ish rather than linear so the preference is decisive. */
    total *= Math.pow(coveredCount / queryTokens.length, 1.5);

    total *= bias(doc) * questionFit(doc, queryHas);
    return {
      doc: doc, score: total,
      coverage: coveredCount / queryTokens.length,
      covered: coveredCount,
      qlen: queryTokens.length
    };
  }

  function biasFor(intent, rawQuery) {
    var phrase = normalize(rawQuery);
    return function (doc) {
      var m = 1;
      if (intent === 'define' && doc.kind === 'term') m *= 1.5;
      if (intent === 'locate' && doc.kind === 'page') m *= 1.45;
      if (intent === 'general' && doc.kind === 'faq') m *= 1.12;
      /* An existence question wants the thing itself, so pages lead and the
         detail FAQs are pushed below them rather than out — they make good
         follow-ups once the visitor knows the thing exists. */
      /* Only a page is somewhere you can be taken. A glossary entry is an
         anchor on /glossary and an FAQ is a paragraph on a page, so neither is
         a destination in its own right — they are pushed right down rather
         than excluded, because a term still resolves to the glossary and that
         is a reasonable place to land. */
      if (intent === 'navigate') {
        if (doc.kind === 'page') m *= 2.8;
        else m *= 0.3;
      }
      if (intent === 'exists') {
        if (doc.kind === 'page') m *= 2.2;
        else if (doc.kind === 'faq') m *= 0.55;
        /* A blog post ABOUT a thing is not the thing. Pages alone were not
           enough: "can I do an internship with you" came back with an article
           on standing out in an internship interview, because a post title
           carries the word plainly while /internships leads with "Two ways to
           work with me" and keeps the word in its <title>. An offering lives
           on a site page; an article discusses one. */
        if (doc.section === 'Blog') m *= 0.4;
      }
      /* Phrase containment, checked on the normalised strong field so
         punctuation and case cannot break it. */
      var strong = normalize(doc.strong);
      if (phrase.length > 3 && strong.indexOf(phrase) !== -1) m *= 1.9;
      if (phrase === strong) m *= 2.6;
      return m;
    };
  }

  /* ---- where do you want to go? -----------------------------------------
     NAVIGATION IS NAME RESOLUTION, NOT RELEVANCE RANKING, and the first
     version of this got it wrong by feeding "go to labs" to the same BM25
     scorer everything else uses. That scorer weighs body prose by rarity, so
     the winner was /glossary — its h1 is "The words, and where to GO and see
     them", and "go" was still in the query. "take me to labs" did not resolve
     at all, because "take" was in the query and matched nothing.

     Asking to be taken somewhere is asking for a page BY NAME, so the fields
     that matter are the name-shaped ones: the URL's last segment, the title up
     to its dash, and the h1. Body text is irrelevant and actively harmful.

     The site's titles have a consistent shape — "Labs — Free Online
     Compilers", "Online C Compiler — Real clang" — so the part before the dash
     is usually the name. The slug is stronger still: /labs is "labs" and
     /labs/c is "c", which is why "go to c language" lands correctly once the
     word "language" is dropped. That dropping is a general rule rather than a
     synonym table: nobody has to maintain a list of the ways people say
     "page". */
  var NAV_VERBS = {};
  (function () {
    var w = ('go goto take bring navigate send jump redirect move visit view show open me us').split(' ');
    for (var i = 0; i < w.length; i++) NAV_VERBS[stem(w[i])] = true;
  })();

  /* Words that describe the KIND of destination rather than naming one.
     Deliberately excludes lab/labs/game/games, which ARE names here. */
  var DEST_NOISE = {};
  (function () {
    var w = ('language languages programming program page pages section part please now ' +
      'website site area screen').split(' ');
    for (var i = 0; i < w.length; i++) DEST_NOISE[stem(w[i])] = true;
  })();

  function lastSegment(u) {
    if (!u || u === '/') return 'home';
    var parts = u.replace(/^\//, '').split('/');
    return normalize(parts[parts.length - 1].replace(/-/g, ' '));
  }

  function titleHead(t) {
    return normalize(String(t || '').split(/[—–|:]/)[0]);
  }

  function depthOf(u) {
    if (!u || u === '/') return 0;
    return u.replace(/^\//, '').split('/').length;
  }

  /* Returns { url, name, score } or null. */
  function resolveDestination(rawQuery) {
    if (!index) return null;
    var words = normalize(rawQuery).split(' ');
    var kept = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!w) continue;
      var st = stem(w);
      if (NAV_VERBS[st] || DEST_NOISE[st]) continue;
      if (STOP[w] && kept.length === 0) continue;   // leading "the", "a", "to"
      if (STOP[w]) continue;
      kept.push(w);
    }
    var want = kept.join(' ');
    if (!want) return null;

    var best = null;
    for (var p = 0; p < index.pages.length; p++) {
      var page = index.pages[p];
      var seg = lastSegment(page.u);
      var head = titleHead(page.t);
      var h1 = normalize(page.h);
      var full = normalize(page.t);
      var s = 0;

      if (want === seg) s = 120;
      else if (want === head) s = 110;
      else if (want === h1) s = 100;
      else if (seg.length >= 3 && (seg.indexOf(want) === 0 || want.indexOf(seg) === 0)) s = 80;
      else if (head.indexOf(want) !== -1) s = 70;
      else if (h1.indexOf(want) !== -1 || full.indexOf(want) !== -1) s = 60;
      else {
        /* Every word of the request has to appear somewhere in the page's
           NAME. A partial name match is not a destination — it is a guess,
           and guessing wrong here does not mislead somebody, it moves them. */
        var hay = seg + ' ' + head + ' ' + h1 + ' ' + full;
        var hit = 0;
        for (var k = 0; k < kept.length; k++) if (hay.indexOf(kept[k]) !== -1) hit++;
        if (hit === kept.length) s = 40 + Math.round(15 * (hit / kept.length));
      }
      if (!s) continue;

      /* A hub beats a page inside it when both match the same name: somebody
         asking for "games" wants /games, not whichever game happens to rank.
         Shallower wins, gently, so it only decides genuine ties. */
      s += Math.max(0, 4 - depthOf(page.u));

      if (!best || s > best.score) {
        best = { url: page.u, name: page.t ? page.t.split(/[—–|]/)[0].trim() : page.u, score: s };
      }
    }
    /* 40 is "every word of the name was found". Below that she does not move
       anybody. */
    return (best && best.score >= 40) ? best : null;
  }

  /* ---- one-slot topic memory -------------------------------------------
     Enough to make "and how do I fix it?" resolve, and no more. A real
     dialogue state machine would be the wrong tool: this is a corner widget
     on a static site, and the failure mode of remembering too much is
     answering last question's topic to this question's words. So the carry
     only happens when the new query is too short to stand alone AND opens
     like a follow-up. */
  var lastTokens = [];

  /* ---- the conduct gate, and it is the one thing here that OUTLIVES the visit
     --------------------------------------------------------------------------
     localStorage, deliberately, and it is worth being explicit that this
     breaks the rule the rest of particle-bg.js keeps: every other preference
     that script remembers — the paused background, the hidden controls, the
     greeting — is sessionStorage, because none of it should follow anybody
     around. This does.

     The reason is that a session-scoped lock is not a lock. Closing the tab
     cleared it, so the sanction lasted exactly as long as the patience needed
     to press reload, and the honest description of it was "a pause". Held
     here, an unresolved offence is still unresolved tomorrow, and **only an
     apology clears it** — not time, not a reload, not a new tab.

     ANY recorded strike locks a NEW session. Within one conversation rudeness
     gets a warning first, because people misjudge a tone and correct
     themselves; but leaving without apologising means the matter was never
     settled, so coming back lands on the same closed door. Severe content —
     harassment, slurs, threats — never gets the warning at all.

     One number, three states: 0 clear, 1 warned, 2+ locked. It is the count
     rather than a boolean so the warning survives a reload too.

     If it will not write — private mode, storage disabled, quota — everything
     still works for the length of the visit and simply forgets afterwards.
     That is the correct failure direction: a gate that cannot persist should
     not also refuse to function. */
  var CONDUCT_KEY = 'mayuriConduct';
  var strikes = 0;
  var locked = false;

  (function () {
    var raw = null;
    try { raw = localStorage.getItem(CONDUCT_KEY); } catch (e) { raw = null; }
    var n = parseInt(raw, 10);
    strikes = (isFinite(n) && n > 0) ? n : 0;
    /* One strike on the record is enough to hold the door on a fresh visit. */
    locked = strikes >= 1;
  })();

  function saveConduct() {
    try {
      if (strikes > 0) localStorage.setItem(CONDUCT_KEY, String(strikes));
      else localStorage.removeItem(CONDUCT_KEY);
    } catch (e) { /* private mode: the gate holds for this visit only */ }
  }

  /* The way back. A lock with no exit is a punishment; a lock with an exit is
     a boundary, and a boundary is what was actually wanted. Generous on
     purpose — "sorry" anywhere in the sentence counts, and so does a mumbled
     "my bad" — because the point is the acknowledgement, not the wording, and
     a visitor who has apologised and is still refused has been trapped by a
     regex. */
  function isApology(q) {
    return /\b(sorry|sry|soz|apolog(y|ies|ise|ize|ised|ized|ising|izing)|my bad|forgive me|pardon me|pardon|i was wrong|didn.?t mean)\b/
      .test(normalize(q));
  }

  /* Genuine ellipsis only. This used to include bare "how" and "why", and that
     was a real bug with the worst possible symptom: "how do I crack a hash" is
     a complete question that merely begins with "how", so it was treated as a
     continuation of whatever came before, inherited that topic, and answered
     "what is a fork bomb" — confidently, because the carried tokens matched
     the carried topic perfectly. A follow-up marker has to be a word that
     cannot begin a standalone question. */
  function isFollowUp(s) {
    return /^(and|but|so|then|also|what about|how about|ok so)\b/.test(normalize(s));
  }

  /* ---- public ---------------------------------------------------------- */

  var loading = null;

  function load() {
    if (index) return okPromise(index);
    if (loading) return loading;
    loading = fetch(INDEX_URL, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('index ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.faq || !data.terms || !data.pages) throw new Error('index shape');
        index = data;
        buildDocs(data);
        return data;
      })
      .catch(function (e) {
        /* Cleared so a later attempt can retry rather than being stuck with a
           rejected promise for the rest of the visit — the panel offers a
           retry, and without this it would fail instantly forever. */
        loading = null;
        throw e;
      });
    return loading;
  }

  function okPromise(v) {
    return { then: function (f) { var r = f(v); return r && r.then ? r : okPromise(r); },
             catch: function () { return this; } };
  }

  function search(rawQuery, intent) {
    var qt = tokenize(rawQuery);

    /* Strip navigational words — but only if something topical survives.
       "labs" or "show me the games" is all navigation and no topic, and an
       empty query would answer nothing where the intent bias can still route
       it sensibly. */
    /* Navigation keeps them. In "go to labs" the word "labs" IS the
       destination, so stripping the navigational vocabulary would leave
       nothing to aim at — the very words that are noise in "which lab decodes
       a JWT" are the whole request here. */
    if (intent !== 'navigate') {
      var topical = [];
      for (var n = 0; n < qt.length; n++) if (!NAV[qt[n]]) topical.push(qt[n]);
      if (topical.length) qt = topical;
    }

    /* In an existence question the verb is part of the question's FORM, not
       its subject: "do you OFFER internships" is asking about internships.
       Left in, it halved coverage — one of two words matched — and the right
       answer was refused for being 0.5 against a floor of 0.6. Stripped only
       for this intent, because "how do I provide input to cin" is a real lab
       question where the verb carries meaning. */
    if (intent === 'exists') {
      var subjects = [];
      for (var v = 0; v < qt.length; v++) if (!EXIST_VERBS[qt[v]]) subjects.push(qt[v]);
      if (subjects.length) qt = subjects;
    }

    /* Typo pass, before the carry so a misspelt standalone question is still
       treated as standalone. */
    for (var i = 0; i < qt.length; i++) {
      if (!vocab[qt[i]]) {
        var near = nearestToken(qt[i]);
        if (near) qt[i] = near;
      }
    }

    if (qt.length < 3 && isFollowUp(rawQuery) && lastTokens.length) {
      qt = qt.concat(lastTokens);
    }
    if (!qt.length) return [];

    var queryHas = {};
    for (var h = 0; h < qt.length; h++) queryHas[qt[h]] = true;

    var bias = biasFor(intent, rawQuery);
    var hits = [];
    for (var d = 0; d < docs.length; d++) {
      var s = score(qt, docs[d], bias, queryHas);
      if (s) hits.push(s);
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, 6);
  }

  /* Answer shape handed to the panel. `confident` is what decides whether the
     panel shows an answer or the "message my boss" fallback, and it is the
     only thing the caller has to respect. */
  function ask(rawQuery) {
    var intent = intentOf(rawQuery);

    if (intent === 'empty') {
      return { confident: false, kind: 'empty', text: '', links: [], chips: [] };
    }

    /* A goodbye is honoured whatever state she is in, including a locked one,
       and it does NOT clear the record: somebody who swore and then left
       politely has still not apologised, and will meet the same closed door
       next time. Being allowed to leave gracefully costs nothing; being
       forgiven for leaving would cost the whole gate. */
    if (intent === 'bye') {
      return {
        confident: true, kind: 'farewell', endSession: true,
        text: locked
          ? 'Goodbye. Take care of yourself.'
          : 'Goodbye, and thank you for stopping by! Take care — I am here whenever you need me.',
        links: [], chips: []
      };
    }

    /* An apology after the WARNING, before any lock. Without this the strike
       sat on the record with no way to clear it and "sorry" fell through to
       ordinary retrieval — which answered a genuine apology with "I do not
       have this information, let me redirect you to my boss". Somebody
       putting things right should never be met with a shrug, and the strike
       has to be clearable at the point it is cheapest to clear. */
    if (!locked && strikes > 0 && isApology(rawQuery)) {
      strikes = 0;
      saveConduct();
      return {
        confident: true, kind: 'forgiven', sad: false,
        text: 'Thank you, I appreciate that. No hard feelings — what can I help you with?',
        links: [],
        chips: ['What is a fork bomb?', 'Do you offer internships?', 'What does Krunalkumar do?']
      };
    }

    /* Locked, and checked before almost everything else — including the abuse
       test, so that swearing at a locked chat gets the same steady request
       rather than stacking further punishment on someone already refused.
       Nothing but an apology moves from here. */
    if (locked) {
      if (isApology(rawQuery)) {
        locked = false;
        /* Strikes go back to zero with the apology, and the record is cleared
           from storage in the same breath — the apology is the ONLY thing that
           does this. Keeping a strike would mean a single further slip ends
           the chat instantly, which makes the apology worth nothing. */
        strikes = 0;
        saveConduct();
        return {
          confident: true, kind: 'forgiven', sad: false,
          text: 'Thank you, that is kind of you. Let us begin again — how can I help?',
          links: [],
          chips: ['What is a fork bomb?', 'Do you offer internships?', 'What does Krunalkumar do?']
        };
      }
      return {
        confident: true, kind: 'locked', locked: true,
        text: 'Type sorry here to continue chatting with me.',
        links: [], chips: []
      };
    }

    /* One clear warning for rudeness, none for harassment.
       ------------------------------------------------------------------------
       Severity decides whether a warning is offered at all. Ordinary rudeness
       gets exactly one, stated as a warning so there is no ambiguity about
       what happens next — people do misjudge a tone, and a stranger who is
       told plainly usually stops. Sexual harassment, a slur or a threat gets
       none: somebody asking an assistant for nudes has not misjudged anything.

       A mixed message is judged on its worst part, not its best. "I need help
       with JWT but you are fucking stupid" does not get the JWT half answered,
       because answering it would price the abuse at nothing.

       The strike is written to storage on the WARNING too, not just the lock.
       That is what stops the warning being free: leave now and come back, and
       the unresolved strike holds the door (see the note on CONDUCT_KEY), so
       the only way to clear it is still an apology. */
    if (intent === 'abuse') {
      var severity = abuseIn(rawQuery);
      if (severity >= 2) {
        strikes = 2;
        locked = true;
        saveConduct();
        return {
          confident: true, kind: 'abuse-lock', locked: true, sad: true, severe: true,
          text: 'That is completely unacceptable, and I will not be spoken to like that. ' +
                'This chat is closed until you apologise. May God bless you.',
          links: [], chips: []
        };
      }
      strikes++;
      saveConduct();
      if (strikes === 1) {
        return {
          confident: true, kind: 'abuse', sad: true,
          text: 'Please talk to me politely — this is your first warning. ' +
                'Ask me anything and I will gladly help, but I will not continue if that carries on.',
          links: [], chips: []
        };
      }
      locked = true;
      return {
        confident: true, kind: 'abuse-lock', locked: true, sad: true,
        text: 'I did warn you. I will not be spoken to like that, so this chat is closed until you ' +
              'apologise — say sorry and we can carry on. May God bless you.',
        links: [], chips: []
      };
    }
    if (intent === 'greet') {
      return {
        confident: true, kind: 'canned',
        text: 'Hello. Ask me anything about this site — a lab, a game, a term, ' +
              'what Krunalkumar does. If I do not have the answer I will hand you straight to him.',
        links: [], chips: ['What is a fork bomb?', 'Which lab decodes a JWT?', 'What does Krunalkumar do?']
      };
    }
    if (intent === 'time') {
      /* normalize() again rather than reaching for the copy intentOf made:
         ask() is handed the raw question and nothing else, and threading a
         second argument through for one caller would be a worse trade than
         a regex on a string this short. */
      var tq = normalize(rawQuery).replace(/[?.!]+$/, '').trim();
      var where = /\b(?:in|at|over in)\s+([a-z][a-z .\'-]*)$/.exec(tq);
      var here = clockIn(Intl && Intl.DateTimeFormat
        ? new Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');

      if (!where) {
        /* No place named: their own clock, with the day and date, because
           "what is the time" from someone checking a deadline wants to know
           which day it is here too. */
        if (!here) {
          return { confident: false, kind: 'canned', links: [], chips: [],
            text: 'Your browser will not tell me its clock, so I would only be guessing.' };
        }
        return {
          confident: true, kind: 'canned',
          text: 'It is ' + here.time + (here.abbr ? ' ' + here.abbr : '') + ' on ' + here.day + '.\n' +
                'That is your device\'s own clock — I have no server to ask.',
          links: [{ label: 'Compare zones in the meeting planner', href: '/labs/timezones' }],
          chips: ['What is the time in US?', 'What is the time in UK?']
        };
      }

      var place = zoneFor(where[1].trim());
      if (!place) {
        return {
          confident: false, kind: 'canned',
          text: 'I could not find a zone for “' + where[1].trim() + '”. A country or a big city usually works — or the meeting planner takes any of them.',
          links: [{ label: 'Open the timezone meeting planner', href: '/labs/timezones' }],
          chips: ['What is the time in US?', 'What is the time now?']
        };
      }

      var lines = [];
      for (var z = 0; z < place.zones.length; z++) {
        var c = clockIn(place.zones[z][1]);
        if (!c) continue;
        var label = place.zones[z][0];
        lines.push((label ? label + '  ' : '') + c.time + (c.abbr ? ' ' + c.abbr : '') +
                   '  ·  ' + c.day);
      }
      if (!lines.length) {
        return { confident: false, kind: 'canned', links: [], chips: [],
          text: 'This browser does not carry the timezone data I would need for that.' };
      }

      /* The reader's own clock is the useful half of the answer — the question
         behind "what is the time in California" is nearly always "can I call
         them now". It is dropped when it would only repeat a line already
         printed, which is what asking about your own country does. */
      var mine = here ? here.time + (here.abbr ? ' ' + here.abbr : '') : '';
      var sameClock = !!here && lines.join('\n').indexOf(mine) !== -1;

      return {
        confident: true, kind: 'canned',
        text: 'In ' + place.name + ', right now:\n' + lines.join('\n') +
              (here && !sameClock ? '\nYou are on ' + mine + '.' : ''),
        links: [{ label: 'Compare zones in the meeting planner', href: '/labs/timezones' }],
        chips: ['What is the time now?', 'What is the time in India?']
      };
    }

    if (intent === 'math') {
      var sum = sumIn(rawQuery);
      /* intentOf already parsed it once. If it will not parse now the input
         changed underneath us, which cannot happen — but answering with a
         wrong number would be worse than admitting it. */
      if (!sum) {
        return { confident: false, kind: 'canned', links: [], chips: [],
          text: 'I could not read that as a sum.' };
      }
      return {
        confident: true, kind: 'canned',
        text: sum.expr + ' = ' + niceNumber(sum.value),
        links: [], chips: []
      };
    }

    if (intent === 'thanks') {
      return { confident: true, kind: 'canned', text: 'Any time. Ask me something else, or go straight to Krunalkumar.', links: [], chips: [] };
    }
    if (intent === 'identity') {
      return {
        confident: true, kind: 'canned',
        /* Straight about not being an AI, because being asked directly is the
           one moment where explaining the machinery is the honest answer
           rather than deflection. Everywhere else she just answers. */
        text: 'I am Mayuri, Krunalkumar’s assistant. I am not an AI — I look your question up ' +
              'in his own answers and notes for this site, and when I cannot find it I say so ' +
              'and pass you to him.',
        links: [], chips: []
      };
    }

    if (!docs) {
      return { confident: false, kind: 'notready', text: '', links: [], chips: [] };
    }

    /* Resolved by name, before the ranked search runs at all — see the note on
       resolveDestination. If the name does not resolve she falls through to
       ordinary retrieval, which will at least offer the closest pages rather
       than moving somebody somewhere they did not ask for. */
    if (intent === 'navigate') {
      var dest = resolveDestination(rawQuery);
      if (dest) {
        return {
          confident: true, kind: 'navigate', url: dest.url,
          text: 'Okay — taking you to ' + dest.name + ' now.',
          links: [{ label: 'Go to ' + dest.name + ' now', href: dest.url }],
          chips: []
        };
      }
    }

    var hits = search(rawQuery, intent);
    if (!hits.length) return { confident: false, kind: 'nomatch', text: '', links: [], chips: [] };

    var top = hits[0];
    /* A one-word query can only ever cover one word, so the floor bends for
       it rather than making single-term lookups ("phishing", "bcrypt")
       permanently unanswerable. */
    var floor = Math.min(MIN_COVERED, top.qlen);
    var confident = top.covered >= floor &&
                    top.coverage >= MIN_COVERAGE &&
                    top.score >= MIN_SCORE;

    /* Money and "how do I reach you" are routed on INTENT, not on retrieval,
       and that is deliberate. The corpus does contain commercial FAQs, but it
       also contains the word "charge" in a lab about batteries and "hire" in a
       game about developer personalities — and a confident wrong answer to
       "can I hire you" costs an actual enquiry. So these two intents only ever
       answer from the corpus when the winning entry is itself a commercial
       page; otherwise they route to the pages that exist for exactly this and
       offer the human. */
    if ((intent === 'commercial' || intent === 'contact') &&
        !(confident && isCommercialUrl(top.doc.url))) {
      return {
        confident: true, kind: 'route',
        text: intent === 'commercial'
          ? 'Pricing depends on scope, and Krunalkumar quotes fixed-price once the work is scoped. ' +
            'The services page explains how that works — or ask him directly.'
          : 'The quickest route is a message to Krunalkumar himself.',
        links: intent === 'commercial'
          ? [{ label: 'How engagements work', href: '/services' }, { label: 'Contact form', href: '/contact#contact-form' }]
          : [{ label: 'Contact form', href: '/contact#contact-form' }],
        chips: [], offerBoss: true
      };
    }

    if (!confident) {
      /* Not confident, but the near-misses are still the best guesses on the
         site, so they are offered as links rather than thrown away. */
      return {
        confident: false, kind: 'weak', text: '',
        links: nearLinks(hits), chips: []
      };
    }

    lastTokens = top.doc.st.slice(0, 4);
    /* A commercial or contact question that DID find its page still gets the
       human offered alongside it. Answering "how do I contact you" with the
       contact page is correct, but it would be perverse for the one question
       that is explicitly about reaching a person to be the one answer with no
       button to reach him. */
    return dress(top.doc, hits, intent === 'commercial' || intent === 'contact');
  }

  /* The pages that exist to answer commercial questions. Kept as a list rather
     than a regex on "services" so /internships and /about count too. */
  function isCommercialUrl(u) {
    if (!u) return false;
    return u.indexOf('/services') === 0 || u.indexOf('/contact') === 0 ||
           u.indexOf('/internships') === 0 || u.indexOf('/about') === 0 ||
           u.indexOf('/client-reviews') === 0 || u.indexOf('/refund') === 0;
  }

  function nearLinks(hits) {
    var out = [];
    var seen = {};
    for (var i = 0; i < hits.length && out.length < 3; i++) {
      var d = hits[i].doc;
      if (!d.url || seen[d.url]) continue;
      seen[d.url] = true;
      out.push({ label: d.title, href: d.url });
    }
    return out;
  }

  /* Turn a winning document into an answer plus the routes around it. The
     glossary is where this pays off: a term carries the lab that demonstrates
     it and the post that explains it, so one definition becomes three useful
     places to go. That is the part that reads as intelligence, and it is
     nothing but a foreign key. */
  function dress(doc, hits, offerBoss) {
    var links = [];
    var chips = [];

    if (doc.kind === 'term') {
      if (doc.lab) links.push({ label: 'Try it: /labs/' + doc.lab, href: '/labs/' + doc.lab });
      if (doc.post) links.push({ label: 'Read: the full explanation', href: '/blog/' + doc.post });
      links.push({ label: 'Glossary entry', href: doc.url });
      for (var i = 0; i < doc.see.length && chips.length < 3; i++) {
        chips.push('What is ' + String(doc.see[i]).toLowerCase() + '?');
      }
    } else if (doc.kind === 'faq') {
      links.push({ label: doc.page || 'Read the page', href: doc.url });
    } else {
      links.push({ label: 'Open ' + (doc.short || doc.title), href: doc.url });
      /* A page answer offers that page's OWN questions as the next ones. This
         is what makes an existence answer land properly: "do you offer
         internships" replies with what is on offer, and then hands over the
         very FAQs — is it free, how does selection work — that used to be
         served as the answer to a question nobody asked. */
      for (var f = 0; f < index.faq.length && chips.length < 2; f++) {
        if (index.faq[f].u === doc.url) chips.push(index.faq[f].q);
      }
    }

    /* One alternative, when the runner-up is a genuinely different entry and
       close behind. More than one turns an answer back into a search result. */
    if (hits.length > 1 && hits[1].doc.url !== doc.url && hits[1].score > hits[0].score * 0.62) {
      chips.push(hits[1].doc.kind === 'term'
        ? 'What is ' + String(hits[1].doc.title).toLowerCase() + '?'
        : hits[1].doc.title);
    }

    return {
      confident: true,
      kind: doc.kind,
      text: doc.answer,
      title: doc.kind === 'term' ? doc.title : '',
      links: links.slice(0, 3),
      chips: chips.slice(0, 3),
      offerBoss: !!offerBoss
    };
  }

  function stats() {
    return docs
      ? { docs: docs.length, faq: index.faq.length, terms: index.terms.length, pages: index.pages.length }
      : null;
  }

  window.MayuriChat = {
    load: load,
    ask: ask,
    stats: stats,
    /* The opening line, built here rather than in the panel so the greeting
       and the answers share one voice — and so the time of day is read at the
       moment she speaks, not when the script happened to load. */
    greeting: function () {
      return daypart() + '! I am Mayuri, Krunalkumar’s assistant. How can I help you today?';
    },
    /* Strikes and the lock deliberately survive reset(): "Start over" clears
       the conversation, not the consequences of it — otherwise the lock is
       one button press from meaningless. */
    reset: function () { lastTokens = []; },
    /* So the panel can show the door as locked before anyone types. */
    isLocked: function () { return locked; },
    /* Ranked hits with their scores, for tuning the weights and the floor
       against a labelled set instead of by feel. Not used by the panel. */
    debug: function (q) {
      if (!docs) return null;
      var hits = search(q, intentOf(q));
      return {
        query: q, intent: intentOf(q), tokens: tokenize(q),
        hits: hits.map(function (h) {
          return {
            kind: h.doc.kind, title: h.doc.title, url: h.doc.url,
            score: Math.round(h.score * 1000) / 1000,
            covered: h.covered, qlen: h.qlen,
            coverage: Math.round(h.coverage * 100) / 100
          };
        })
      };
    }
  };
})();
